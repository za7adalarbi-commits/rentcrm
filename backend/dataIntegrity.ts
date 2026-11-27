import { crmCore, generateId, requireApiAccess, type AuthSession } from './auth.js';
import { ensureDbExecutor, runWithSavepoint, type DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { resolveServerConfig } from './serverConfig.js';
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

async function fetchRgEndpointAll(
  baseApi: string,
  headers: Record<string, string>,
  endpoint: string,
  fetchFn: typeof fetch,
  pageSize = 200,
  maxPages = 40
): Promise<{ items: any[]; ok: boolean; reportedTotal: number | null; error: string }> {
  const items: any[] = [];
  const seenKeys = new Set<string>();
  let reportedTotal: number | null = null;
  let error = '';

  for (let page = 0; page < maxPages; page++) {
    const url = `${baseApi}/${endpoint}?page=${page}&size=${pageSize}`;
    try {
      const resp = await fetchFn(url, { method: 'GET', headers });
      if (!resp.ok) {
        error = `HTTP_${resp.status}`;
        return { items, ok: false, reportedTotal, error };
      }
      const json: any = await resp.json();
      const parsed = extractRentalGatePagePayload(json, page, pageSize);
      if (parsed.hasExplicitTotalElements) {
        reportedTotal = Math.max(reportedTotal ?? 0, parsed.totalElements);
      }
      let added = 0;
      for (const row of parsed.rows) {
        const key =
          str(row?.extendId || row?.extensionNumber || row?.extension_number) ||
          str(crmCore.extractSourceReservationId(row) || row?.reservationId || row?.id || crmCore.extractReservationNumber(row));
        if (key) {
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
        }
        items.push(row);
        added++;
      }
      const hasMore = reportedTotal !== null && reportedTotal > 0 && items.length < reportedTotal && parsed.rows.length > 0;
      if (parsed.rows.length === 0 || (parsed.isLast && !hasMore) || (added === 0 && !hasMore)) {
        break;
      }
    } catch (err: any) {
      error = str(err?.message || 'FETCH_ERROR').slice(0, 200);
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
    }>(
      `SELECT id, source_reservation_id, reservation_number, reference_number,
              original_status_code, original_status_ar, internal_status,
              is_source_cancelled, is_source_rejected, rcc_status
       FROM reservations`
    );
    const neonReservations = dbResRows.rows || [];

    const dbExtCountRes = await safeExec.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`);
    const neonExtensionsCount = Number(dbExtCountRes.rows?.[0]?.cnt || 0);

    const issues: DataIntegrityIssueDraft[] = [];
    const neonBySrcId = new Map<string, typeof neonReservations[number]>();
    for (const r of neonReservations) {
      const sid = str(r.source_reservation_id || r.reservation_number);
      if (sid) neonBySrcId.set(sid, r);
      const cleanNum = str(r.reservation_number);
      if (cleanNum && sid && cleanNum !== sid && /^RG-/i.test(cleanNum)) {
        issues.push({
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

    let rgTotalCount = neonReservations.length;
    let reviewedCount = neonReservations.length;
    let rgExtensionsCount = neonExtensionsCount;
    let rgCancelledCount = 0;
    let rgCompanyChangesCount = 0;
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
        rgTotalCount = resOut.reportedTotal ?? resOut.items.length;
        reviewedCount = Math.max(rgTotalCount, neonReservations.length);
        const rgSrcSet = new Set<string>();
        for (const item of resOut.items) {
          const sid = str(crmCore.extractSourceReservationId(item) || item?.reservationId || item?.id);
          if (!sid) continue;
          rgSrcSet.add(sid);
          const dbRow = neonBySrcId.get(sid);
          if (!dbRow) {
            issues.push({
              reservationId: '',
              reservationNumber: sid,
              discrepancyType: 'missing_in_neon',
              severity: 'high',
              sourceScope: 'reservations',
              fieldName: 'source_reservation_id',
              rgValue: sid,
              neonValue: '',
              rgSnapshot: { reservationId: sid, status: item?.reservationStatus || item?.status || '' },
              neonSnapshot: {}
            });
          }
        }
        if (resOut.ok && resOut.items.length > 0) {
          for (const dbRow of neonReservations) {
            const sid = str(dbRow.source_reservation_id);
            if (sid && !rgSrcSet.has(sid)) {
              issues.push({
                reservationId: str(dbRow.id),
                reservationNumber: str(dbRow.reservation_number || sid),
                discrepancyType: 'extra_in_neon',
                severity: 'low',
                sourceScope: 'reservations',
                fieldName: 'source_reservation_id',
                rgValue: '',
                neonValue: sid,
                rgSnapshot: {},
                neonSnapshot: { id: dbRow.id, reservationNumber: dbRow.reservation_number, status: dbRow.internal_status }
              });
            }
          }
        }
      }

      if (extOut) {
        rgExtensionsCount = extOut.reportedTotal ?? extOut.items.length;
        scopeResults.extensions = { ok: extOut.ok, count: rgExtensionsCount, neonCount: neonExtensionsCount, error: extOut.error };
        if (extOut.ok && rgExtensionsCount !== neonExtensionsCount) {
          issues.push({
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
      }
      if (rccOut) {
        rgCompanyChangesCount = rccOut.reportedTotal ?? rccOut.items.length;
        scopeResults.company_changes = { ok: rccOut.ok, count: rgCompanyChangesCount, error: rccOut.error };
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
      rgTotalCount,
      neonTotalCount: neonReservations.length,
      rgExtensionsCount,
      neonExtensionsCount,
      rgCancelledCount,
      rgCompanyChangesCount,
      discrepanciesCount: issues.length,
      scopeResults
    };

    const finalizedRun = await safeExec.withTransaction(async (tx) => {
      if (issues.length > 0) {
        for (let idx = 0; idx < issues.length; idx++) {
          const iss = issues[idx];
          await runWithSavepoint(
            tx,
            `di_issue_${idx}`,
            () =>
              tx.query(
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
                  generateId('DII'),
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
              ),
            undefined
          );
        }
      }

      const updRes = await tx.query(
        `UPDATE data_integrity_runs
         SET status = 'completed',
             finished_at = $2::timestamptz,
             duration_ms = $3,
             rg_total_count = $4,
             neon_total_count = $5,
             reviewed_count = $6,
             discrepancies_count = $7,
             summary_json = $8::jsonb
         WHERE id = $1
         RETURNING *`,
        [
          runId,
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
