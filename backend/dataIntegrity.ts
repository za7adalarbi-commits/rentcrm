import { crmCore, generateId, requireApiAccess, type AuthSession } from './auth.js';
import { ensureDbExecutor, runWithSavepoint, type DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { buildRentalGateEndpointUrl, normalizeRgApiBaseUrl, resolveServerConfig } from './serverConfig.js';
import { extractRentalGatePagePayload } from './syncService.js';

export type DataIntegrityScope = 'reservations' | 'extensions' | 'cancelled' | 'company_changes';

export interface DataIntegrityIssueDraft {
  reservationId: string;
  reservationNumber: string;
  discrepancyType: string;
  severity: 'low' | 'medium' | 'high';
  sourceScope: string;
  fieldName: string;
  rgValue: string;
  neonValue: string;
  rgSnapshot: Record<string, any>;
  neonSnapshot: Record<string, any>;
}

const VALID_SCOPES: DataIntegrityScope[] = ['reservations', 'extensions', 'cancelled', 'company_changes'];
const STALE_RUN_TIMEOUT_MINUTES = 10;

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeRunMode(raw: unknown): 'manual' | 'scheduled' | 'auto' {
  const clean = str(raw).toLowerCase();
  if (clean === 'scheduled' || clean === 'auto') return clean;
  return 'manual';
}

function normalizeScopes(raw: unknown): DataIntegrityScope[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...VALID_SCOPES];
  }
  const clean = raw
    .map((x) => str(x).toLowerCase())
    .filter((x): x is DataIntegrityScope => (VALID_SCOPES as string[]).includes(x));
  return clean.length > 0 ? Array.from(new Set(clean)) : [...VALID_SCOPES];
}

function cleanKey(v: unknown): string {
  return String(v ?? '').trim().replace(/^#+/, '').trim();
}

async function fetchRgEndpointAll(
  baseApi: string,
  headers: Record<string, string>,
  endpoint: string,
  fetchFn: typeof fetch,
  pageSize = 200,
  maxPages = 80
): Promise<{ items: any[]; ok: boolean; reportedTotal: number | null; error: string }> {
  const items: any[] = [];
  const seenKeys = new Set<string>();
  let reportedTotal: number | null = null;
  let error = '';
  let firstPageSigs: string[] = [];
  let zeroBased = true;
  let nextUrlOverride = '';
  let nextCursor = '';
  const normalizedBase = normalizeRgApiBaseUrl(baseApi);
  const baseWithSlash = `${normalizedBase}/`;
  let baseOrigin = '';
  try {
    baseOrigin = new URL(normalizedBase).origin;
  } catch {
    baseOrigin = '';
  }

  for (let iter = 0; iter < maxPages; iter++) {
    const pageNum = zeroBased ? iter : iter + 1;
    let url = buildRentalGateEndpointUrl(normalizedBase, endpoint, { page: pageNum, size: pageSize });
    if (nextUrlOverride) {
      url = nextUrlOverride;
    } else if (nextCursor) {
      url = buildRentalGateEndpointUrl(normalizedBase, endpoint, { page: pageNum, size: pageSize, cursor: nextCursor });
    }

    let resp: Response | null = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await fetchFn(url, { method: 'GET', headers });
        if (resp.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        break;
      } catch (err: any) {
        lastErr = err;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
      }
    }

    if (!resp) {
      error = str(lastErr?.message || 'FETCH_ERROR').slice(0, 200);
      return { items, ok: false, reportedTotal, error };
    }
    if (!resp.ok) {
      error = `HTTP_${resp.status}`;
      return { items, ok: false, reportedTotal, error };
    }

    try {
      const json: any = await resp.json();
      const parsed = extractRentalGatePagePayload(json, pageNum, pageSize);
      if (parsed.hasExplicitTotalElements) {
        reportedTotal = Math.max(reportedTotal ?? 0, parsed.totalElements);
      }

      const batchSigs = parsed.rows.map(
        (row: any) =>
          cleanKey(row?.extendId || row?.extensionNumber || row?.extension_number) ||
          cleanKey(crmCore.extractSourceReservationId(row) || row?.reservationId || row?.id || crmCore.extractReservationNumber(row))
      );

      if (iter === 0) {
        firstPageSigs = batchSigs.filter(Boolean);
      } else if (
        iter === 1 &&
        zeroBased &&
        firstPageSigs.length > 0 &&
        batchSigs.length > 0 &&
        batchSigs.length === firstPageSigs.length &&
        batchSigs.every((sig: string, idx: number) => sig && sig === firstPageSigs[idx])
      ) {
        // Clamp 1-based API where page=0 and page=1 return identical page 1 records
        zeroBased = false;
        const page2Num = 2;
        if (parsed.totalPages && page2Num > parsed.totalPages) break;
        if (reportedTotal !== null && items.length >= reportedTotal) break;
        const p2Url = buildRentalGateEndpointUrl(normalizedBase, endpoint, { page: page2Num, size: pageSize });
        const p2Resp = await fetchFn(p2Url, { method: 'GET', headers });
        if (!p2Resp.ok) {
          error = `HTTP_${p2Resp.status}`;
          return { items, ok: false, reportedTotal, error };
        }
        const p2Json: any = await p2Resp.json();
        const p2Parsed = extractRentalGatePagePayload(p2Json, page2Num, pageSize);
        let p2Added = 0;
        for (const row of p2Parsed.rows) {
          const k =
            cleanKey(row?.extendId || row?.extensionNumber || row?.extension_number) ||
            cleanKey(crmCore.extractSourceReservationId(row) || row?.reservationId || row?.id || crmCore.extractReservationNumber(row));
          if (k) {
            if (seenKeys.has(k)) continue;
            seenKeys.add(k);
          }
          items.push(row);
          p2Added++;
        }
        if (p2Parsed.nextPageUrl) {
          try {
            const u = new URL(p2Parsed.nextPageUrl, baseWithSlash);
            if (!baseOrigin || u.origin === baseOrigin) nextUrlOverride = u.toString();
          } catch {
            nextUrlOverride = '';
          }
        } else {
          nextUrlOverride = '';
        }
        nextCursor = p2Parsed.nextCursor || '';
        const p2HasMore =
          Boolean(nextUrlOverride || nextCursor) ||
          (reportedTotal !== null && reportedTotal > 0 && items.length < reportedTotal && p2Parsed.rows.length > 0) ||
          Boolean(p2Parsed.totalPages && page2Num < p2Parsed.totalPages && p2Parsed.rows.length > 0);
        if (p2Parsed.rows.length === 0 || (p2Parsed.isLast && !p2HasMore) || (p2Added === 0 && !p2HasMore)) {
          break;
        }
        continue;
      }

      let added = 0;
      for (const row of parsed.rows) {
        const key =
          cleanKey(row?.extendId || row?.extensionNumber || row?.extension_number) ||
          cleanKey(crmCore.extractSourceReservationId(row) || row?.reservationId || row?.id || crmCore.extractReservationNumber(row));
        if (key) {
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
        }
        items.push(row);
        added++;
      }

      if (parsed.nextPageUrl) {
        try {
          const u = new URL(parsed.nextPageUrl, baseWithSlash);
          nextUrlOverride = !baseOrigin || u.origin === baseOrigin ? u.toString() : '';
        } catch {
          nextUrlOverride = '';
        }
      } else {
        nextUrlOverride = '';
      }
      nextCursor = parsed.nextCursor || '';

      const effectivePageOneBased = zeroBased ? iter + 1 : pageNum;
      const hasMore =
        Boolean(nextUrlOverride || nextCursor) ||
        (reportedTotal !== null && reportedTotal > 0 && items.length < reportedTotal && parsed.rows.length > 0) ||
        Boolean(parsed.totalPages && effectivePageOneBased < parsed.totalPages && parsed.rows.length > 0);
      if (parsed.rows.length === 0 || (parsed.isLast && !hasMore) || (added === 0 && !hasMore)) {
        break;
      }
    } catch (err: any) {
      error = str(err?.message || 'FETCH_PARSE_ERROR').slice(0, 200);
      return { items, ok: false, reportedTotal, error };
    }
  }

  return {
    items,
    ok: reportedTotal === null || reportedTotal <= 0 || items.length >= reportedTotal,
    reportedTotal,
    error
  };
}

export async function runDataIntegrityCheck(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {},
  fetchFn: typeof fetch = fetch
): Promise<{
  skipped: boolean;
  reason?: string;
  run: Record<string, any>;
  issues: DataIntegrityIssueDraft[];
  summary: Record<string, any>;
}> {
  requireApiAccess(session);
  const safeExec = ensureDbExecutor(executor);
  const runMode = normalizeRunMode(payload.runMode || payload.run_mode);
  const triggerType = str(payload.triggerType || payload.trigger_type || runMode) || 'manual';
  const scopes = normalizeScopes(payload.scopes);
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const runId = generateId('DIR');

  // Step 1: Atomically check concurrency & register run with `run_mode`
  const initResult = await safeExec.withTransaction(async (tx) => {
    await runWithSavepoint(
      tx,
      'di_advisory_lock',
      () => tx.query(`SELECT pg_advisory_xact_lock(92847103)`),
      undefined
    );

    // Expire any stale 'running' runs older than STALE_RUN_TIMEOUT_MINUTES
    await tx.query(
      `UPDATE data_integrity_runs
       SET status = 'failed',
           finished_at = NOW(),
           error_message = COALESCE(NULLIF(error_message, ''), 'STALE_RUN_TIMEOUT')
       WHERE status = 'running'
         AND started_at < NOW() - ($1 || ' minutes')::interval`,
      [String(STALE_RUN_TIMEOUT_MINUTES)]
    );

    const activeRes = await tx.query(
      `SELECT id, run_mode, trigger_type, status, started_at, triggered_by_name
       FROM data_integrity_runs
       WHERE status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`
    );
    if (activeRes.rows.length > 0 && !payload.forceConcurrentCheck) {
      return { blockedBy: activeRes.rows[0] };
    }

    await tx.query(
      `INSERT INTO data_integrity_runs (
         id, trigger_type, run_mode, status, started_at,
         rg_total_count, neon_total_count, reviewed_count, discrepancies_count,
         summary_json, scopes_json, error_message, triggered_by_id, triggered_by_name
       ) VALUES (
         $1, $2, $3, 'running', $4::timestamptz,
         0, 0, 0, 0,
         '{}'::jsonb, $5::jsonb, '', $6, $7
       )`,
      [
        runId,
        triggerType,
        runMode,
        startedAtIso,
        JSON.stringify(scopes),
        str(session.user.id),
        str(session.user.name || session.username)
      ]
    );
    return { blockedBy: null };
  });

  if (initResult.blockedBy) {
    return {
      skipped: true,
      reason: 'INTEGRITY_CHECK_IN_PROGRESS',
      run: initResult.blockedBy,
      issues: [],
      summary: { activeRunId: initResult.blockedBy.id }
    };
  }

  try {
    const cfg = await resolveServerConfig(safeExec);
    const rgBaseUrl = str(cfg.rgApiBaseUrl).replace(/\/+$/, '');
    const rgToken = str(cfg.rgToken).replace(/^Bearer\s+/i, '').trim();

    const dbResRows = await safeExec.query<{
      id: string;
      source_reservation_id: string;
      reservation_number: string;
      reference_number: string;
      original_status_code: string;
      original_status_ar: string;
      internal_status: string;
      is_source_cancelled: boolean | null;
      is_source_rejected: boolean | null;
      rcc_status: string;
      customer_name?: string;
      customer_phone?: string;
      start_date?: string;
      end_date?: string;
      car_name?: string;
      company_name?: string;
      extensions_count?: number;
    }>(
      `SELECT id, source_reservation_id, reservation_number, reference_number,
              original_status_code, original_status_ar, internal_status,
              is_source_cancelled, is_source_rejected, rcc_status,
              customer_name, customer_phone, start_date, end_date,
              car_name, company_name, extensions_count
       FROM reservations
       WHERE deleted_at IS NULL`
    );
    const neonReservations = dbResRows.rows || [];

    const dbExtCountRes = await safeExec.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`);
    const neonExtensionsCount = Number(dbExtCountRes.rows?.[0]?.cnt || 0);

    const issues: DataIntegrityIssueDraft[] = [];
    const seenIssueKeys = new Set<string>();
    const pushIssue = (iss: DataIntegrityIssueDraft) => {
      const dedupKey = `${iss.discrepancyType}|${cleanKey(iss.reservationNumber) || cleanKey(iss.reservationId)}|${iss.fieldName}`;
      if (seenIssueKeys.has(dedupKey)) return;
      seenIssueKeys.add(dedupKey);
      issues.push(iss);
    };

    for (const r of neonReservations) {
      const sid = cleanKey(r.source_reservation_id || r.reservation_number);
      const cleanNum = cleanKey(r.reservation_number);
      if (cleanNum && sid && cleanNum !== sid && /^RG-/i.test(cleanNum)) {
        pushIssue({
          reservationId: str(r.id),
          reservationNumber: sid,
          discrepancyType: 'rg_number_in_reservation_number',
          severity: 'medium',
          sourceScope: 'reservations',
          fieldName: 'reservation_number',
          rgValue: sid,
          neonValue: cleanNum,
          rgSnapshot: { sourceReservationId: sid },
          neonSnapshot: { id: r.id, reservationNumber: cleanNum, referenceNumber: r.reference_number }
        });
      }
    }

    let rgTotalCount = 0;
    let reviewedCount = neonReservations.length;
    let rgExtensionsCount = 0;
    let rgCancelledCount = 0;
    let rgCompanyChangesCount = 0;
    let matchedCount = 0;
    let rgChecked = false;
    let runStatus: 'completed' | 'partial' = 'completed';
    const scopeResults: Record<string, any> = {};

    if (rgBaseUrl && rgToken) {
      const headers = {
        Authorization: `Bearer ${rgToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };

      const wantRes = scopes.includes('reservations');
      const wantExt = scopes.includes('extensions');
      const wantCan = scopes.includes('cancelled');
      const wantRcc = scopes.includes('company_changes');

      const [resOut, extOut, canOut, rccOut] = await Promise.all([
        wantRes ? fetchRgEndpointAll(rgBaseUrl, headers, 'reservations/filter', fetchFn) : Promise.resolve(null),
        wantExt ? fetchRgEndpointAll(rgBaseUrl, headers, 'reservation-extends/filter', fetchFn) : Promise.resolve(null),
        wantCan ? fetchRgEndpointAll(rgBaseUrl, headers, 'admin/cancelled-reservations', fetchFn) : Promise.resolve(null),
        wantRcc ? fetchRgEndpointAll(rgBaseUrl, headers, 'reservation-company-changes/admin/filter', fetchFn) : Promise.resolve(null)
      ]);

      if (resOut) {
        scopeResults.reservations = { ok: resOut.ok, count: resOut.items.length, reportedTotal: resOut.reportedTotal, error: resOut.error };
        if (!resOut.ok && resOut.items.length === 0) {
          throw new Error(`RG_INTEGRITY_FETCH_FAILED: ${resOut.error || 'تعذر جلب الحجوزات من Rental Gate API'}`);
        }
        rgChecked = true;
        rgTotalCount = resOut.reportedTotal ?? resOut.items.length;
        reviewedCount = Math.max(rgTotalCount, neonReservations.length);
        if (!resOut.ok) {
          runStatus = 'partial';
        }

        const cmpOut = typeof crmCore?.compareRgAndNeonReservations === 'function'
          ? crmCore.compareRgAndNeonReservations(resOut.items, neonReservations)
          : { issues: [], matchedCount: 0 };
        const cmpIssues: any[] = Array.isArray(cmpOut) ? cmpOut : (Array.isArray(cmpOut?.issues) ? cmpOut.issues : []);
        matchedCount = Number(cmpOut?.matchedCount || 0);

        for (const ci of cmpIssues) {
          if (!resOut.ok && ci.discrepancyType === 'missing_in_rg') continue;
          pushIssue({
            reservationId: str(ci.reservationId),
            reservationNumber: str(ci.reservationNumber),
            discrepancyType: str(ci.discrepancyType),
            severity: (ci.severity === 'high' || ci.severity === 'low' ? ci.severity : 'medium'),
            sourceScope: str(ci.sourceScope || 'reservations'),
            fieldName: str(ci.fieldName),
            rgValue: str(ci.rgValue),
            neonValue: str(ci.neonValue),
            rgSnapshot: ci.rgSnapshot || {},
            neonSnapshot: ci.neonSnapshot || {}
          });
        }
      }

      if (extOut) {
        rgExtensionsCount = extOut.reportedTotal ?? extOut.items.length;
        scopeResults.extensions = { ok: extOut.ok, count: rgExtensionsCount, neonCount: neonExtensionsCount, error: extOut.error };
        if (!extOut.ok) runStatus = 'partial';
        if (extOut.ok && rgExtensionsCount !== neonExtensionsCount) {
          pushIssue({
            reservationId: '',
            reservationNumber: '',
            discrepancyType: 'extensions_count_mismatch',
            severity: 'medium',
            sourceScope: 'extensions',
            fieldName: 'count',
            rgValue: String(rgExtensionsCount),
            neonValue: String(neonExtensionsCount),
            rgSnapshot: { totalExtensions: rgExtensionsCount },
            neonSnapshot: { totalExtensions: neonExtensionsCount }
          });
        }
      }

      if (canOut) {
        rgCancelledCount = canOut.reportedTotal ?? canOut.items.length;
        scopeResults.cancelled = { ok: canOut.ok, count: rgCancelledCount, error: canOut.error };
        if (!canOut.ok) runStatus = 'partial';
      }
      if (rccOut) {
        rgCompanyChangesCount = rccOut.reportedTotal ?? rccOut.items.length;
        scopeResults.company_changes = { ok: rccOut.ok, count: rgCompanyChangesCount, error: rccOut.error };
        if (!rccOut.ok) runStatus = 'partial';
      }
    } else {
      scopeResults.mode = 'neon_local_audit_only';
    }

    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const finishedAtIso = new Date().toISOString();
    const summary = {
      runMode,
      triggerType,
      scopes,
      rgChecked,
      rgTotalCount,
      neonTotalCount: neonReservations.length,
      matchedCount,
      rgExtensionsCount,
      neonExtensionsCount,
      rgCancelledCount,
      rgCompanyChangesCount,
      discrepanciesCount: issues.length,
      scopeResults
    };

    const finalizedRun = await safeExec.withTransaction(async (tx) => {
      if (issues.length > 0) {
        const openIssueMap = new Map<string, string>();
        await runWithSavepoint(
          tx,
          'di_open_dedup_lookup',
          async () => {
            const openQ = await tx.query<{
              id: string;
              discrepancy_type: string;
              reservation_number: string;
              reservation_id: string;
              field_name: string;
            }>(
              `SELECT id, discrepancy_type, reservation_number, reservation_id, field_name
               FROM data_integrity_issues
               WHERE resolution_status = 'open'`
            );
            for (const row of openQ.rows || []) {
              const dk = `${str(row.discrepancy_type)}|${cleanKey(row.reservation_number || row.reservation_id)}|${str(row.field_name)}`;
              if (!openIssueMap.has(dk)) openIssueMap.set(dk, str(row.id));
            }
          },
          undefined
        );

        for (let idx = 0; idx < issues.length; idx++) {
          const iss = issues[idx];
          const dk = `${str(iss.discrepancyType)}|${cleanKey(iss.reservationNumber || iss.reservationId)}|${str(iss.fieldName)}`;
          const existingOpenId = openIssueMap.get(dk);
          await runWithSavepoint(
            tx,
            `di_issue_${idx}`,
            () => {
              if (existingOpenId) {
                return tx.query(
                  `UPDATE data_integrity_issues
                   SET run_id = $2,
                       severity = $3,
                       source_scope = $4,
                       rg_value = $5,
                       neon_value = $6,
                       rg_snapshot_json = $7::jsonb,
                       neon_snapshot_json = $8::jsonb,
                       last_checked_at = NOW(),
                       updated_at = NOW()
                   WHERE id = $1`,
                  [
                    existingOpenId,
                    runId,
                    iss.severity,
                    iss.sourceScope,
                    iss.rgValue,
                    iss.neonValue,
                    JSON.stringify(iss.rgSnapshot || {}),
                    JSON.stringify(iss.neonSnapshot || {})
                  ]
                );
              }
              const newId = generateId('DII');
              openIssueMap.set(dk, newId);
              return tx.query(
                `INSERT INTO data_integrity_issues (
                   id, run_id, reservation_id, reservation_number, discrepancy_type, severity,
                   source_scope, field_name, rg_value, neon_value, rg_snapshot_json, neon_snapshot_json,
                   resolution_status, last_checked_at, created_at, updated_at
                 ) VALUES (
                   $1, $2, $3, $4, $5, $6,
                   $7, $8, $9, $10, $11::jsonb, $12::jsonb,
                   'open', NOW(), NOW(), NOW()
                 )`,
                [
                  newId,
                  runId,
                  iss.reservationId,
                  iss.reservationNumber,
                  iss.discrepancyType,
                  iss.severity,
                  iss.sourceScope,
                  iss.fieldName,
                  iss.rgValue,
                  iss.neonValue,
                  JSON.stringify(iss.rgSnapshot || {}),
                  JSON.stringify(iss.neonSnapshot || {})
                ]
              );
            },
            undefined
          );
        }
      }

      const updRes = await tx.query(
        `UPDATE data_integrity_runs
         SET status = $2,
             finished_at = $3::timestamptz,
             duration_ms = $4,
             rg_total_count = $5,
             neon_total_count = $6,
             reviewed_count = $7,
             discrepancies_count = $8,
             summary_json = $9::jsonb
         WHERE id = $1
         RETURNING *`,
        [
          runId,
          runStatus,
          finishedAtIso,
          durationMs,
          rgTotalCount,
          neonReservations.length,
          reviewedCount,
          issues.length,
          JSON.stringify(summary)
        ]
      );
      return updRes.rows[0];
    });

    return {
      skipped: false,
      run: finalizedRun,
      issues,
      summary
    };
  } catch (err: any) {
    const errMsg = str(err?.message || 'DATA_INTEGRITY_ERROR').slice(0, 500);
    await safeExec
      .query(
        `UPDATE data_integrity_runs
         SET status = 'failed',
             finished_at = NOW(),
             duration_ms = $2,
             error_message = $3
         WHERE id = $1`,
        [runId, Math.max(0, Date.now() - startedAtMs), errMsg]
      )
      .catch(() => undefined);
    await logBackendError(safeExec, 'dataIntegrity', 'runDataIntegrityCheck', err, { runId, runMode, scopes });
    throw err;
  }
}

export async function getDataIntegrityStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireApiAccess(session);
  const safeExec = ensureDbExecutor(executor);
  const limit = Math.min(50, Math.max(1, Number(payload.limit || 15) || 15));
  const [runsRes, issuesRes, actionsRes] = await Promise.all([
    safeExec.query(`SELECT * FROM data_integrity_runs ORDER BY started_at DESC LIMIT $1`, [limit]),
    safeExec.query(
      `SELECT * FROM data_integrity_issues
       WHERE resolution_status = 'open'
       ORDER BY updated_at DESC LIMIT 100`
    ),
    safeExec.query(`SELECT * FROM data_integrity_actions ORDER BY created_at DESC LIMIT 30`)
  ]);
  return {
    runs: runsRes.rows,
    openIssues: issuesRes.rows,
    recentActions: actionsRes.rows,
    latestRun: runsRes.rows[0] || null
  };
}

export async function resolveDataIntegrityIssue(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireApiAccess(session);
  const safeExec = ensureDbExecutor(executor);
  const issueId = str(payload.issueId || payload.id);
  if (!issueId) {
    throw new Error('VALIDATION_ERROR: معرف مشكلة سلامة البيانات مطلوب.');
  }
  const nextStatus = str(payload.resolutionStatus || 'resolved') || 'resolved';
  const note = str(payload.resolutionNote || payload.note);

  return safeExec.withTransaction(async (tx) => {
    const curRes = await tx.query(`SELECT * FROM data_integrity_issues WHERE id = $1 FOR UPDATE`, [issueId]);
    const issue = curRes.rows[0];
    if (!issue) {
      throw new Error('NOT_FOUND: السجل غير موجود في مشاكل سلامة البيانات.');
    }
    const updRes = await tx.query(
      `UPDATE data_integrity_issues
       SET resolution_status = $2,
           resolved_by_id = $3,
           resolved_by_name = $4,
           resolved_at = NOW(),
           resolution_note = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [issueId, nextStatus, str(session.user.id), str(session.user.name || session.username), note]
    );
    const updated = updRes.rows[0];
    await tx.query(
      `INSERT INTO data_integrity_actions (
         id, issue_id, run_id, reservation_id, reservation_number, action_type,
         before_snapshot_json, after_snapshot_json, actor_id, actor_name, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,NOW())`,
      [
        generateId('DIA'),
        issueId,
        str(issue.run_id),
        str(issue.reservation_id),
        str(issue.reservation_number),
        `issue_${nextStatus}`,
        JSON.stringify(issue),
        JSON.stringify(updated),
        str(session.user.id),
        str(session.user.name || session.username)
      ]
    );
    return { issue: updated };
  });
}
