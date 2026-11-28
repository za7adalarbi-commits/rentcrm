import { crmCore, generateId, type AuthSession } from './auth.js';
import { ensureDbExecutor, runWithSavepoint, type DbClient, type DbExecutor } from './db.js';
import { logBackendError, redactSensitiveText } from './logger.js';
import {
  fetchRentalGateSnapshotReadOnly,
  ingestIncrementalSyncBatch,
  mapReservationRowToClient,
  type IntegrityRgSnapshotResult
} from './syncService.js';

const STALE_RUN_TIMEOUT_MINUTES = 10;

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function parseJsonSafe<T = any>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function assertDeveloperAccess(session: AuthSession): void {
  const role = str(session?.user?.role).toLowerCase();
  const canDev = crmCore && typeof crmCore.canUserPerform === 'function'
    ? crmCore.canUserPerform(session.user, 'manage_developer_tools')
    : false;
  if (role !== 'developer' || !canDev) {
    throw new Error('FORBIDDEN: قسم مراقبة سلامة البيانات متاح للمبرمج فقط.');
  }
}

async function logIntegrityActivity(
  client: DbClient,
  user: AuthSession['user'],
  actionType: string,
  entityId: string,
  details: string,
  diffs?: any[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const riyadh = crmCore && typeof crmCore.getRiyadhDateTimeParts === 'function'
    ? crmCore.getRiyadhDateTimeParts(nowIso)
    : { date: nowIso.slice(0, 10), time: nowIso.slice(11, 16) };
  await runWithSavepoint(
    client,
    'integrity_activity_log',
    () =>
      client.query(
        `INSERT INTO activity_log (
           id, user_id, user_name, user_role, action_type, entity_type, entity_id,
           details, changes, log_date, log_time, created_at
         ) VALUES ($1,$2,$3,$4,$5,'DataIntegrity',$6,$7,$8::jsonb,$9,$10,$11::timestamptz)`,
        [
          generateId('ACT'),
          str(user.id),
          str(user.name),
          str(user.role),
          actionType,
          str(entityId),
          str(details),
          JSON.stringify(Array.isArray(diffs) ? diffs : []),
          riyadh.date,
          riyadh.time,
          nowIso
        ]
      ),
    undefined
  );
}

async function readIntegritySettingsInternal(executor: DbClient): Promise<Record<string, any>> {
  const res = await executor.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'data_integrity_settings' LIMIT 1`
  ).catch(() => ({ rows: [] as Array<{ value: string }> }));
  const raw = res.rows[0]?.value;
  return crmCore.normalizeDataIntegritySettings(raw);
}

function summarizeNeonReservationStats(rows: Record<string, any>[], extCount: number) {
  let active = 0;
  let completed = 0;
  let cancelled = 0;
  let rejected = 0;
  let freshNew = 0;

  for (const r of rows) {
    const client = mapReservationRowToClient(r, false);
    const lc = typeof crmCore.getReservationLifecycleKind === 'function'
      ? crmCore.getReservationLifecycleKind(client)
      : 'active';
    const bucket = typeof crmCore.classifyReservationStatusBucket === 'function'
      ? crmCore.classifyReservationStatusBucket(client)
      : '';
    if (lc === 'cancelled') cancelled++;
    else if (lc === 'rejected') rejected++;
    else if (bucket === 'completed') completed++;
    else active++;
    if (bucket === 'new_pending') freshNew++;
  }

  return {
    total: rows.length,
    newCount: freshNew,
    activeCount: active,
    completedCount: completed,
    cancelledCount: cancelled,
    rejectedCount: rejected,
    extensionsCount: extCount
  };
}

function summarizeRgSnapshotStats(rg: IntegrityRgSnapshotResult) {
  let active = 0;
  let completed = 0;
  let cancelled = 0;
  let rejected = 0;
  let freshNew = 0;

  for (const r of rg.reservations || []) {
    const lc = typeof crmCore.classifyReservationLifecycle === 'function'
      ? crmCore.classifyReservationLifecycle(r)
      : 'active';
    const proj = crmCore.buildIntegrityRecordProjection(r, true);
    const bucket = typeof crmCore.classifyReservationStatusBucket === 'function'
      ? crmCore.classifyReservationStatusBucket({
          originalStatusCode: proj.statusCode,
          originalStatusAr: proj.statusAr,
          internalStatus: proj.statusAr
        })
      : '';
    if (lc === 'cancelled') cancelled++;
    else if (lc === 'rejected') rejected++;
    else if (bucket === 'completed') completed++;
    else active++;
    if (bucket === 'new_pending') freshNew++;
  }

  return {
    total: (rg.reservations || []).length,
    newCount: freshNew,
    activeCount: active,
    completedCount: completed,
    cancelledCount: cancelled,
    rejectedCount: rejected,
    extensionsCount: (rg.extensions || []).length
  };
}

function formatRunRow(row: any) {
  if (!row) return null;
  const summary = parseJsonSafe<Record<string, any>>(row.summary_json, {});
  return {
    id: str(row.id),
    runMode: str(row.run_mode || 'manual'),
    status: str(row.status || 'completed'),
    triggeredById: str(row.triggered_by_id),
    triggeredByName: str(row.triggered_by_name),
    scopes: parseJsonSafe<string[]>(row.scopes_json, []),
    summary,
    rgCount: num(row.rg_total_count ?? row.rg_count, 0),
    rgTotalCount: num(row.rg_total_count ?? row.rg_count, 0),
    neonCount: num(row.neon_total_count ?? row.neon_count, 0),
    neonTotalCount: num(row.neon_total_count ?? row.neon_count, 0),
    matchedCount: num(summary.matchedCount, 0),
    rgChecked: summary.rgChecked !== false,
    durationMs: num(row.duration_ms, 0),
    discrepanciesCount: num(row.discrepancies_count, 0),
    errorMessage: redactSensitiveText(str(row.error_message)),
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : str(row.started_at),
    finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : str(row.finished_at)
  };
}

function formatIssueRow(row: any) {
  return {
    id: str(row.id),
    runId: str(row.run_id),
    discrepancyType: str(row.discrepancy_type),
    typeLabelAr: crmCore.DATA_INTEGRITY_DISCREPANCY_TYPES?.[str(row.discrepancy_type)]?.labelAr || str(row.discrepancy_type),
    severity: str(row.severity || 'medium'),
    sourceScope: str(row.source_scope || 'reservations'),
    reservationId: str(row.reservation_id),
    reservationNumber: str(row.reservation_number),
    fieldName: str(row.field_name),
    rgValue: str(row.rg_value),
    neonValue: str(row.neon_value),
    rgSnapshot: parseJsonSafe<Record<string, any>>(row.rg_snapshot_json, {}),
    neonSnapshot: parseJsonSafe<Record<string, any>>(row.neon_snapshot_json, {}),
    resolutionStatus: str(row.resolution_status || 'open'),
    resolvedById: str(row.resolved_by_id),
    resolvedByName: str(row.resolved_by_name),
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : str(row.resolved_at),
    resolutionNote: str(row.resolution_note),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
  };
}

function formatActionRow(row: any) {
  return {
    id: str(row.id),
    issueId: str(row.issue_id),
    runId: str(row.run_id),
    reservationId: str(row.reservation_id),
    reservationNumber: str(row.reservation_number),
    actionType: str(row.action_type),
    actorId: str(row.actor_id),
    actorName: str(row.actor_name),
    beforeSnapshot: parseJsonSafe<Record<string, any>>(row.before_snapshot_json, {}),
    afterSnapshot: parseJsonSafe<Record<string, any>>(row.after_snapshot_json, {}),
    rollbackSupported: Boolean(row.rollback_supported),
    rolledBack: Boolean(row.rolled_back),
    rolledBackAt: row.rolled_back_at instanceof Date ? row.rolled_back_at.toISOString() : str(row.rolled_back_at),
    rolledBackByName: str(row.rolled_back_by_name),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at)
  };
}

export async function getDataIntegritySettings(executor: DbExecutor, session: AuthSession) {
  assertDeveloperAccess(session);
  const settings = await readIntegritySettingsInternal(executor);
  return { settings };
}

export async function saveDataIntegritySettings(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const next = crmCore.normalizeDataIntegritySettings(payload.settings || payload);
  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('data_integrity_settings', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(next), session.user.name]
    );
    await logIntegrityActivity(
      tx,
      session.user,
      'تحديث إعدادات مراقبة سلامة البيانات',
      'data_integrity_settings',
      `الوضع: ${next.mode} · الفاصل: ${next.intervalMinutes} دقيقة · النطاق: ${(next.scopes || []).join(', ')}`
    );
  });
  return { settings: next };
}

export async function controlDataIntegrityMonitor(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const cur = await readIntegritySettingsInternal(executor);
  const next = crmCore.normalizeDataIntegritySettings({
    ...cur,
    ...(payload.paused !== undefined ? { paused: Boolean(payload.paused) } : {}),
    ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
    ...(payload.intervalMinutes !== undefined ? { intervalMinutes: payload.intervalMinutes } : {})
  });
  return saveDataIntegritySettings(executor, session, { settings: next });
}

export async function getDataIntegrityReport(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const safeExec = ensureDbExecutor(executor);
  const settings = await readIntegritySettingsInternal(safeExec);
  const filterType = str(payload.discrepancyType);
  const filterStatus = str(payload.resolutionStatus);
  const search = str(payload.search).toLowerCase();
  const runId = str(payload.runId);
  const queryErrors: Array<{ step: string; message: string }> = [];

  const captureQuery = async <T = any>(step: string, fn: () => Promise<{ rows: T[] }>, fallbackRows: T[] = []) => {
    try {
      return await fn();
    } catch (err: any) {
      queryErrors.push({
        step,
        message: redactSensitiveText(err?.message || 'QUERY_FAILED').slice(0, 220)
      });
      return { rows: fallbackRows };
    }
  };

  const [runsRes, actionsRes, neonCountRes, extCountRes] = await Promise.all([
    captureQuery('runs', () => safeExec.query(`SELECT * FROM data_integrity_runs ORDER BY started_at DESC LIMIT 15`)),
    captureQuery('actions', () => safeExec.query(`SELECT * FROM data_integrity_actions ORDER BY created_at DESC LIMIT 40`)),
    captureQuery('neon_reservations', () =>
      safeExec.query(
        `SELECT id, reservation_number, source_reservation_id, internal_status, original_status_code, original_status_ar, is_source_cancelled, is_source_rejected, cancelled_at, rejected_at, end_date, extended_until_date
         FROM reservations
         WHERE deleted_at IS NULL
         LIMIT 20000`
      )
    ),
    captureQuery('extensions_count', () => safeExec.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`), [{ cnt: 0 }])
  ]);

  const runs = (runsRes.rows || []).map(formatRunRow).filter(Boolean) as any[];
  const latestAttempt = runs[0] || null;
  const activeRunningRun = runs.find((r) => r.status === 'running') || null;
  const lastValidRun = runs.find((r) => r.status === 'completed' || r.status === 'partial') || null;
  const activeRun = (runId ? runs.find((r) => r.id === runId) : null) || lastValidRun || latestAttempt || null;

  const issueClauses: string[] = [];
  const issueParams: any[] = [];
  if (activeRun?.id) {
    issueParams.push(activeRun.id);
    issueClauses.push(`run_id = $${issueParams.length}`);
  }
  if (filterType) {
    issueParams.push(filterType);
    issueClauses.push(`discrepancy_type = $${issueParams.length}`);
  }
  if (filterStatus) {
    issueParams.push(filterStatus);
    issueClauses.push(`resolution_status = $${issueParams.length}`);
  }
  const issueWhere = issueClauses.length ? `WHERE ${issueClauses.join(' AND ')}` : '';
  const issuesRes = await captureQuery('issues', () =>
    safeExec.query(
      `SELECT * FROM data_integrity_issues ${issueWhere} ORDER BY created_at DESC LIMIT 500`,
      issueParams
    )
  );

  let issues = (issuesRes.rows || []).map(formatIssueRow);
  if (search) {
    issues = issues.filter((it: any) =>
      `${it.reservationNumber} ${it.rgValue} ${it.neonValue} ${it.discrepancyType} ${it.typeLabelAr}`.toLowerCase().includes(search)
    );
  }

  const liveNeonStats = summarizeNeonReservationStats(neonCountRes.rows || [], num(extCountRes.rows[0]?.cnt, 0));

  return {
    settings,
    latestRun: activeRun,
    latestAttempt,
    activeRunningRun,
    runs,
    issues,
    actions: (actionsRes.rows || []).map(formatActionRow),
    liveNeonStats,
    queryErrors
  };
}

export async function runDataIntegrityCheck(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const safeExec = ensureDbExecutor(executor);
  const settings = await readIntegritySettingsInternal(safeExec);
  const runMode = str(payload.runMode || 'manual');
  if (settings.paused && !payload.force && runMode === 'scheduled') {
    return { skipped: true, reason: 'PAUSED', settings };
  }

  const scopes = Array.isArray(payload.scopes) && payload.scopes.length
    ? payload.scopes.map((s: any) => str(s)).filter(Boolean)
    : settings.scopes;
  const dateFrom = str(payload.dateFrom !== undefined ? payload.dateFrom : settings.dateFrom);
  const dateTo = str(payload.dateTo !== undefined ? payload.dateTo : settings.dateTo);

  const startedAtMs = Date.now();
  const startedIso = new Date(startedAtMs).toISOString();
  const runId = generateId('DIRUN');

  // Step 1: Atomically lock + expire stale running runs + guard concurrent runs
  const initRes = await safeExec.withTransaction(async (tx) => {
    await runWithSavepoint(
      tx,
      'di_svc_lock',
      () => tx.query(`SELECT pg_advisory_xact_lock(92847104)`),
      undefined
    );

    await tx.query(
      `UPDATE data_integrity_runs
       SET status = 'failed',
           finished_at = NOW(),
           error_message = COALESCE(NULLIF(error_message, ''), 'STALE_RUN_TIMEOUT')
       WHERE status = 'running'
         AND started_at < NOW() - ($1 || ' minutes')::interval`,
      [String(STALE_RUN_TIMEOUT_MINUTES)]
    );

    const activeQ = await tx.query(
      `SELECT id, run_mode, trigger_type, status, started_at, triggered_by_name
       FROM data_integrity_runs
       WHERE status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`
    );
    if (activeQ.rows.length > 0 && !payload.forceConcurrentCheck) {
      return { blockedBy: activeQ.rows[0] };
    }

    await tx.query(
      `INSERT INTO data_integrity_runs (
         id, trigger_type, run_mode, status, triggered_by_id, triggered_by_name, scopes_json, summary_json,
         rg_total_count, neon_total_count, reviewed_count, discrepancies_count, duration_ms, error_message, started_at, finished_at
       ) VALUES ($1,$2,$3,'running',$4,$5,$6::jsonb,'{}'::jsonb,0,0,0,0,0,'',$7::timestamptz,NULL)`,
      [
        runId,
        runMode,
        runMode,
        str(session.user.id),
        str(session.user.name || session.username),
        JSON.stringify(scopes),
        startedIso
      ]
    );
    return { blockedBy: null };
  });

  if (initRes.blockedBy) {
    return {
      skipped: true,
      reason: 'INTEGRITY_CHECK_IN_PROGRESS',
      blockedBy: formatRunRow(initRes.blockedBy),
      settings
    };
  }

  try {
    // Strictly read-only fetch from RG (or injected test snapshot) + strictly read-only select from Neon
    const rgSnapshot: IntegrityRgSnapshotResult = payload._mockRgSnapshot
      ? payload._mockRgSnapshot
      : await fetchRentalGateSnapshotReadOnly(safeExec, {
          scopes,
          dateFrom,
          dateTo,
          maxPages: Math.max(40, Math.ceil(num(settings.batchSize, 100) / 10))
        });

    const [neonResQ, neonExtCountQ, extByResQ] = await Promise.all([
      safeExec.query(`SELECT * FROM reservations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20000`),
      safeExec.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`),
      safeExec.query<{ reservation_id: string; cnt: number }>(
        `SELECT reservation_id, COUNT(*)::int AS cnt FROM extensions WHERE COALESCE(reservation_id, '') <> '' GROUP BY reservation_id`
      ).catch(() => ({ rows: [] as Array<{ reservation_id: string; cnt: number }> }))
    ]);

    const neonRows = neonResQ.rows || [];
    const neonExtCount = num(neonExtCountQ.rows[0]?.cnt, 0);
    const liveExtCountMap = new Map<string, number>();
    for (const row of extByResQ.rows || []) {
      const rid = str(row.reservation_id);
      if (rid) liveExtCountMap.set(rid, num(row.cnt, 0));
    }

    const neonClientRows = neonRows.map((r) => {
      const mapped = mapReservationRowToClient(r, false);
      const liveCnt = liveExtCountMap.get(str(r.id));
      if (liveCnt !== undefined && num(mapped.extensionsCount, 0) === 0 && liveCnt > 0) {
        mapped.extensionsCount = liveCnt;
      }
      return mapped;
    });

    const neonSummary = summarizeNeonReservationStats(neonRows, neonExtCount);
    const rgSummary = summarizeRgSnapshotStats(rgSnapshot);

    const cmpRes = crmCore.compareRgAndNeonReservations(
      rgSnapshot.reservations || [],
      neonClientRows
    );
    const cmpIssues: any[] = Array.isArray(cmpRes) ? cmpRes : (Array.isArray(cmpRes?.issues) ? cmpRes.issues : []);
    const matchedCount = num(cmpRes?.matchedCount, 0);

    const rawIssues: any[] = [...cmpIssues];
    const seenKeys = new Set(
      rawIssues.map((i) => `${str(i.discrepancyType)}|${str(i.reservationNumber || i.reservationId).replace(/^#+/, '')}|${str(i.fieldName)}`)
    );
    for (const r of neonRows) {
      const sid = str(r.source_reservation_id || r.reservation_number).replace(/^#+/, '');
      const cleanNum = str(r.reservation_number).replace(/^#+/, '');
      if (cleanNum && sid && cleanNum !== sid && /^RG-/i.test(cleanNum)) {
        const dk = `rg_number_in_reservation_number|${sid}|reservation_number`;
        if (!seenKeys.has(dk)) {
          seenKeys.add(dk);
          rawIssues.push({
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
    }

    const byType: Record<string, number> = {};
    for (const iss of rawIssues) {
      const dt = str(iss.discrepancyType);
      byType[dt] = (byType[dt] || 0) + 1;
    }

    const incompleteEndpoints = rgSnapshot.incompleteEndpoints || [];
    const runStatus = incompleteEndpoints.length > 0 ? 'partial' : 'completed';

    const summary = {
      rg: rgSummary,
      neon: neonSummary,
      byType,
      matchedCount,
      rgChecked: true,
      incompleteEndpoints,
      pagesFetched: rgSnapshot.pagesFetched || 0
    };
    const finishedAtMs = Date.now();
    const durationMs = Math.max(0, finishedAtMs - startedAtMs);
    const finishedIso = new Date(finishedAtMs).toISOString();

    await safeExec.withTransaction(async (tx) => {
      const existingOpenMap = new Map<string, string>();
      await runWithSavepoint(
        tx,
        'di_load_open_issues',
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
            const k = `${str(row.discrepancy_type)}|${str(row.reservation_number || row.reservation_id).replace(/^#+/, '')}|${str(row.field_name)}`;
            if (!existingOpenMap.has(k)) {
              existingOpenMap.set(k, str(row.id));
            }
          }
        },
        undefined
      );

      for (let idx = 0; idx < rawIssues.length; idx++) {
        const iss = rawIssues[idx];
        const dedupKey = `${str(iss.discrepancyType)}|${str(iss.reservationNumber || iss.reservationId).replace(/^#+/, '')}|${str(iss.fieldName)}`;
        const existingOpenId = existingOpenMap.get(dedupKey);
        await runWithSavepoint(
          tx,
          `di_iss_${idx}`,
          () => {
            if (existingOpenId) {
              return tx.query(
                `UPDATE data_integrity_issues
                 SET run_id = $2::text,
                     severity = $3::text,
                     source_scope = $4::text,
                     reservation_id = CASE WHEN COALESCE(reservation_id, '') = '' THEN $5::text ELSE reservation_id END,
                     rg_value = $6::text,
                     neon_value = $7::text,
                     rg_snapshot_json = $8::jsonb,
                     neon_snapshot_json = $9::jsonb,
                     last_checked_at = $10::timestamptz,
                     updated_at = $10::timestamptz
                 WHERE id = $1::text`,
                [
                  existingOpenId,
                  runId,
                  str(iss.severity || 'medium'),
                  str(iss.sourceScope || 'reservations'),
                  str(iss.reservationId),
                  str(iss.rgValue),
                  str(iss.neonValue),
                  JSON.stringify(iss.rgSnapshot || {}),
                  JSON.stringify(iss.neonSnapshot || {}),
                  finishedIso
                ]
              );
            }
            const newId = generateId('DISS');
            existingOpenMap.set(dedupKey, newId);
            return tx.query(
              `INSERT INTO data_integrity_issues (
                 id, run_id, discrepancy_type, severity, source_scope, reservation_id, reservation_number,
                 field_name, rg_value, neon_value, rg_snapshot_json, neon_snapshot_json,
                 resolution_status, last_checked_at, created_at, updated_at
               ) VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::jsonb,$12::jsonb,'open',$13::timestamptz,$13::timestamptz,$13::timestamptz)`,
              [
                newId,
                runId,
                str(iss.discrepancyType),
                str(iss.severity || 'medium'),
                str(iss.sourceScope || 'reservations'),
                str(iss.reservationId),
                str(iss.reservationNumber),
                str(iss.fieldName),
                str(iss.rgValue),
                str(iss.neonValue),
                JSON.stringify(iss.rgSnapshot || {}),
                JSON.stringify(iss.neonSnapshot || {}),
                finishedIso
              ]
            );
          },
          undefined
        );
      }

      await tx.query(
        `UPDATE data_integrity_runs
         SET status = $2::text,
             rg_total_count = $3::int,
             neon_total_count = $4::int,
             reviewed_count = $5::int,
             discrepancies_count = $6::int,
             summary_json = $7::jsonb,
             duration_ms = $8::int,
             finished_at = $9::timestamptz
         WHERE id = $1::text`,
        [
          runId,
          runStatus,
          rgSummary.total,
          neonSummary.total,
          Math.max(rgSummary.total, neonSummary.total),
          rawIssues.length,
          JSON.stringify(summary),
          durationMs,
          finishedIso
        ]
      );

      await logIntegrityActivity(
        tx,
        session.user,
        'فحص سلامة البيانات',
        runId,
        `الحالة: ${runStatus} · RG: ${rgSummary.total} حجز · Neon: ${neonSummary.total} حجز · مطابق: ${matchedCount} · الفروقات: ${rawIssues.length}`
      );
    });

    return getDataIntegrityReport(safeExec, session, { runId });
  } catch (err: any) {
    const cleanErr = redactSensitiveText(err?.message || 'DATA_INTEGRITY_ERROR').slice(0, 500);
    await safeExec
      .query(
        `UPDATE data_integrity_runs
         SET status = 'failed',
             finished_at = NOW(),
             duration_ms = $2,
             error_message = $3
         WHERE id = $1`,
        [runId, Math.max(0, Date.now() - startedAtMs), cleanErr]
      )
      .catch(() => undefined);
    await logBackendError(safeExec, 'integrityService', 'runDataIntegrityCheck', err, { runId, runMode, scopes });
    throw err;
  }
}

export async function recheckDataIntegrityRecord(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const issueId = str(payload.issueId);
  const reservationId = str(payload.reservationId);
  const reservationNumber = str(payload.reservationNumber);
  if (!issueId && !reservationId && !reservationNumber) {
    throw new Error('VALIDATION_ERROR: معرف المخالفة أو الحجز مطلوب لإعادة الفحص.');
  }

  let targetIssue: any = null;
  if (issueId) {
    const iq = await executor.query(`SELECT * FROM data_integrity_issues WHERE id = $1 LIMIT 1`, [issueId]);
    targetIssue = iq.rows[0] || null;
  }

  const lookupNum = reservationNumber || str(targetIssue?.reservation_number);
  const lookupId = reservationId || str(targetIssue?.reservation_id);

  const neonQ = await executor.query(
    `SELECT * FROM reservations WHERE deleted_at IS NULL AND (id = $1 OR reservation_number = $2 OR source_reservation_id = $1) LIMIT 1`,
    [lookupId || lookupNum, lookupNum || lookupId]
  );
  const neonRow = neonQ.rows[0] ? mapReservationRowToClient(neonQ.rows[0], false) : null;
  const sourceId = str(neonRow?.sourceReservationId || lookupId || lookupNum);

  const rgSnap = payload._mockRgSnapshot
    ? payload._mockRgSnapshot
    : await fetchRentalGateSnapshotReadOnly(executor, { singleSourceId: sourceId });
  const rgMatch = (rgSnap.reservations || [])[0] || null;

  const recheckCmp = crmCore.compareRgAndNeonReservations(
    rgMatch ? [rgMatch] : [],
    neonRow ? [neonRow] : []
  );
  const freshIssues: any[] = Array.isArray(recheckCmp) ? recheckCmp : (Array.isArray(recheckCmp?.issues) ? recheckCmp.issues : []);

  const rgProj = rgMatch ? crmCore.buildIntegrityRecordProjection(rgMatch, true) : null;
  const neonProj = neonRow ? crmCore.buildIntegrityRecordProjection(neonRow, false) : null;

  if (targetIssue && freshIssues.length === 0) {
    const nowIso = new Date().toISOString();
    await executor.query(
      `UPDATE data_integrity_issues
       SET resolution_status = 'resolved', resolved_by_id = $2, resolved_by_name = $3,
           resolved_at = $4::timestamptz, resolution_note = 'تم التحقق وإغلاق الفارق تلقائيًا بعد تطابق السجلين', updated_at = $4::timestamptz
       WHERE id = $1`,
      [targetIssue.id, session.user.id, session.user.name, nowIso]
    );
  }

  return {
    matched: freshIssues.length === 0,
    freshIssues,
    rgProjection: rgProj,
    neonProjection: neonProj
  };
}

export async function resolveDataIntegrityIssue(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const issueId = str(payload.issueId);
  const resolutionAction = str(payload.resolutionAction || 'preview');
  const previewOnly = Boolean(payload.previewOnly) || resolutionAction === 'preview';
  if (!issueId) throw new Error('VALIDATION_ERROR: معرف التنبيه مطلوب.');

  const iq = await executor.query(`SELECT * FROM data_integrity_issues WHERE id = $1 LIMIT 1`, [issueId]);
  const issueRow = iq.rows[0];
  if (!issueRow) throw new Error('NOT_FOUND: السجل المطلوب غير موجود.');

  const rgSnap = parseJsonSafe<Record<string, any>>(issueRow.rg_snapshot_json, {});
  const neonSnapStored = parseJsonSafe<Record<string, any>>(issueRow.neon_snapshot_json, {});
  const lookupKey = str(issueRow.reservation_number || issueRow.reservation_id);

  const curNeonQ = await executor.query(
    `SELECT * FROM reservations WHERE deleted_at IS NULL AND (id = $1 OR reservation_number = $2) LIMIT 1`,
    [str(issueRow.reservation_id), lookupKey]
  );
  const curNeonRaw = curNeonQ.rows[0] || null;
  const beforeSnapshot = curNeonRaw ? { ...curNeonRaw } : neonSnapStored;

  const rgProjection = Object.keys(rgSnap).length ? crmCore.buildIntegrityRecordProjection(rgSnap, true) : {};
  const neonProjection = curNeonRaw
    ? crmCore.buildIntegrityRecordProjection(mapReservationRowToClient(curNeonRaw, false), false)
    : neonSnapStored;

  if (previewOnly) {
    return {
      previewOnly: true,
      issue: formatIssueRow(issueRow),
      rgProjection,
      neonProjection,
      beforeSnapshot
    };
  }

  if (!payload.approved) {
    throw new Error('VALIDATION_ERROR: يجب تأكيد الموافقة اليدوية من المبرمج قبل تنفيذ أي تعديل.');
  }

  const allowedActions = new Set(['sync_from_rg', 'update_fields', 'mark_resolved', 'ignore', 'dedupe_inspect']);
  if (!allowedActions.has(resolutionAction)) {
    throw new Error('VALIDATION_ERROR: إجراء المعالجة المطلوب غير مدعوم.');
  }

  const nowIso = new Date().toISOString();
  let afterSnapshot: Record<string, any> = { ...beforeSnapshot };
  let rollbackSupported = false;

  if (resolutionAction === 'sync_from_rg' || resolutionAction === 'update_fields') {
    if (Object.keys(rgSnap).length === 0) {
      throw new Error('VALIDATION_ERROR: لا تتوفر لقطة صالحة من Rental Gate لتطبيق التحديث.');
    }
    if (curNeonRaw) {
      rollbackSupported = true;
      await executor.withTransaction(async (tx) => {
        const nextStatus = str(rgProjection.statusAr || curNeonRaw.internal_status);
        const nextCode = str(rgProjection.statusCode || curNeonRaw.original_status_code);
        const nextCustName = str(rgProjection.customerName || curNeonRaw.customer_name);
        const nextCustPhone = str(rgProjection.customerPhone || curNeonRaw.customer_phone);
        const nextStart = str(rgProjection.startDate || curNeonRaw.start_date);
        const nextEnd = str(rgProjection.endDate || curNeonRaw.end_date);
        const nextCar = str(rgProjection.carName || curNeonRaw.car_name);
        const nextComp = str(rgProjection.companyName || curNeonRaw.company_name);

        await tx.query(
          `UPDATE reservations
           SET original_status_code = $2::text,
               internal_status = $3::text,
               customer_name = $4::text,
               customer_phone = $5::text,
               start_date = $6::text,
               end_date = $7::text,
               car_name = $8::text,
               company_name = $9::text,
               last_update_text = $10::text,
               last_updated_by_id = $11::text,
               last_updated_by_name = $12::text,
               last_updated_at = $13::text,
               updated_at = $14::timestamptz
           WHERE id = $1::text`,
          [
            str(curNeonRaw.id),
            nextCode,
            nextStatus,
            nextCustName,
            nextCustPhone,
            nextStart,
            nextEnd,
            nextCar,
            nextComp,
            `مزامنة يدوية معتمدة من المبرمج عبر مراقبة سلامة البيانات`,
            str(session.user.id),
            str(session.user.name),
            nowIso,
            nowIso
          ]
        );
        const afterQ = await tx.query(`SELECT * FROM reservations WHERE id = $1 LIMIT 1`, [str(curNeonRaw.id)]);
        afterSnapshot = afterQ.rows[0] || {};
      });
    } else if (resolutionAction === 'sync_from_rg') {
      await ingestIncrementalSyncBatch(executor, {
        source: 'developer_integrity_repair',
        actor: { id: session.user.id, name: session.user.name, role: session.user.role },
        reservations: [rgSnap],
        extensions: []
      });
      const insertedQ = await executor.query(
        `SELECT * FROM reservations WHERE reservation_number = $1 OR source_reservation_id = $2 LIMIT 1`,
        [lookupKey, str(rgSnap.id || rgSnap.reservationId)]
      );
      afterSnapshot = insertedQ.rows[0] || rgProjection;
      rollbackSupported = false;
    }
  }

  const nextStatus = resolutionAction === 'ignore' ? 'ignored' : 'resolved';
  const actionId = generateId('DIACT');
  const note = str(payload.note || `إجراء: ${resolutionAction}`);

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `UPDATE data_integrity_issues
       SET resolution_status = $2::text, resolved_by_id = $3::text, resolved_by_name = $4::text,
           resolved_at = $5::timestamptz, resolution_note = $6::text, updated_at = $5::timestamptz
       WHERE id = $1::text`,
      [issueId, nextStatus, session.user.id, session.user.name, nowIso, note]
    );
    await tx.query(
      `INSERT INTO data_integrity_actions (
         id, issue_id, run_id, reservation_id, reservation_number, action_type,
         actor_id, actor_name, before_snapshot_json, after_snapshot_json,
         rollback_supported, rolled_back, created_at
       ) VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::jsonb,$10::jsonb,$11::boolean,FALSE,$12::timestamptz)`,
      [
        actionId,
        issueId,
        str(issueRow.run_id),
        str(afterSnapshot?.id || issueRow.reservation_id),
        lookupKey,
        resolutionAction,
        session.user.id,
        session.user.name,
        JSON.stringify(beforeSnapshot || {}),
        JSON.stringify(afterSnapshot || {}),
        rollbackSupported,
        nowIso
      ]
    );
    await logIntegrityActivity(
      tx,
      session.user,
      `معالجة سلامة البيانات (${resolutionAction})`,
      lookupKey || issueId,
      `${note}`
    );
  });

  return {
    resolved: true,
    actionId,
    rollbackSupported,
    issueId,
    resolutionStatus: nextStatus
  };
}

export async function rollbackDataIntegrityAction(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const actionId = str(payload.actionId);
  if (!actionId) throw new Error('VALIDATION_ERROR: معرف العملية مطلوب للتراجع.');

  const actQ = await executor.query(`SELECT * FROM data_integrity_actions WHERE id = $1 LIMIT 1`, [actionId]);
  const actRow = actQ.rows[0];
  if (!actRow) throw new Error('NOT_FOUND: سجل العملية غير موجود.');
  if (!actRow.rollback_supported) {
    throw new Error('VALIDATION_ERROR: هذه العملية لا تدعم التراجع التلقائي.');
  }
  if (actRow.rolled_back) {
    throw new Error('VALIDATION_ERROR: تم التراجع عن هذه العملية مسبقًا.');
  }

  const beforeSnap = parseJsonSafe<Record<string, any>>(actRow.before_snapshot_json, {});
  const resId = str(beforeSnap.id || actRow.reservation_id);
  if (!resId) throw new Error('VALIDATION_ERROR: لقطة ما قبل التعديل غير مكتملة.');

  const nowIso = new Date().toISOString();
  await executor.withTransaction(async (tx) => {
    await tx.query(
      `UPDATE reservations
       SET original_status_code = $2::text,
           internal_status = $3::text,
           customer_name = $4::text,
           customer_phone = $5::text,
           start_date = $6::text,
           end_date = $7::text,
           car_name = $8::text,
           company_name = $9::text,
           last_update_text = $10::text,
           last_updated_by_id = $11::text,
           last_updated_by_name = $12::text,
           last_updated_at = $13::text,
           updated_at = $14::timestamptz
       WHERE id = $1::text`,
      [
        resId,
        str(beforeSnap.original_status_code),
        str(beforeSnap.internal_status),
        str(beforeSnap.customer_name),
        str(beforeSnap.customer_phone),
        str(beforeSnap.start_date),
        str(beforeSnap.end_date),
        str(beforeSnap.car_name),
        str(beforeSnap.company_name),
        `تراجع المبرمج عن إجراء سلامة البيانات (${actionId})`,
        str(session.user.id),
        str(session.user.name),
        nowIso,
        nowIso
      ]
    );
    await tx.query(
      `UPDATE data_integrity_actions
       SET rolled_back = TRUE, rolled_back_at = $2::timestamptz, rolled_back_by_id = $3, rolled_back_by_name = $4
       WHERE id = $1`,
      [actionId, nowIso, session.user.id, session.user.name]
    );
    if (actRow.issue_id) {
      await tx.query(
        `UPDATE data_integrity_issues
         SET resolution_status = 'open', resolution_note = 'تم التراجع عن المعالجة السابقة', updated_at = $2::timestamptz
         WHERE id = $1`,
        [str(actRow.issue_id), nowIso]
      );
    }
    await logIntegrityActivity(
      tx,
      session.user,
      'تراجع عن تعديل سلامة البيانات',
      str(actRow.reservation_number || resId),
      `تم استرجاع بيانات الحجز قبل العملية ${actionId}`
    );
  });

  return { rolledBack: true, actionId, reservationId: resId };
}
