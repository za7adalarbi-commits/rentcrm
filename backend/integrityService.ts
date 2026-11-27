import { crmCore, generateId, type AuthSession } from './auth.js';
import type { DbClient, DbExecutor } from './db.js';
import {
  fetchRentalGateSnapshotReadOnly,
  ingestIncrementalSyncBatch,
  mapReservationRowToClient,
  type IntegrityRgSnapshotResult
} from './syncService.js';

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
  await client.query(
    `INSERT INTO activity_log (
       id, user_id, user_name, user_role, action_type, entity_type, entity_id,
       details, changes_json, log_date, log_time, created_at
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
  ).catch(() => undefined);
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
  return {
    id: str(row.id),
    runMode: str(row.run_mode || 'manual'),
    status: str(row.status || 'completed'),
    triggeredById: str(row.triggered_by_id),
    triggeredByName: str(row.triggered_by_name),
    scopes: parseJsonSafe<string[]>(row.scopes_json, []),
    summary: parseJsonSafe<Record<string, any>>(row.summary_json, {}),
    rgCount: num(row.rg_count, 0),
    neonCount: num(row.neon_count, 0),
    discrepanciesCount: num(row.discrepancies_count, 0),
    errorMessage: str(row.error_message),
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
  const settings = await readIntegritySettingsInternal(executor);
  const filterType = str(payload.discrepancyType);
  const filterStatus = str(payload.resolutionStatus);
  const search = str(payload.search).toLowerCase();
  const runId = str(payload.runId);

  const [runsRes, actionsRes, neonCountRes, extCountRes] = await Promise.all([
    executor.query(`SELECT * FROM data_integrity_runs ORDER BY started_at DESC LIMIT 12`).catch(() => ({ rows: [] as any[] })),
    executor.query(`SELECT * FROM data_integrity_actions ORDER BY created_at DESC LIMIT 40`).catch(() => ({ rows: [] as any[] })),
    executor.query(`SELECT id, reservation_number, source_reservation_id, internal_status, original_status_code, original_status_ar, is_source_cancelled, is_source_rejected, cancelled_at, rejected_at, end_date, extended_until_date FROM reservations LIMIT 20000`).catch(() => ({ rows: [] as any[] })),
    executor.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`).catch(() => ({ rows: [{ cnt: 0 }] }))
  ]);

  const runs = runsRes.rows.map(formatRunRow).filter(Boolean);
  const activeRun = (runId ? runs.find((r: any) => r.id === runId) : null) || runs[0] || null;

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
  const issuesRes = await executor.query(
    `SELECT * FROM data_integrity_issues ${issueWhere} ORDER BY created_at DESC LIMIT 500`,
    issueParams
  ).catch(() => ({ rows: [] as any[] }));

  let issues = issuesRes.rows.map(formatIssueRow);
  if (search) {
    issues = issues.filter((it: any) =>
      `${it.reservationNumber} ${it.rgValue} ${it.neonValue} ${it.discrepancyType} ${it.typeLabelAr}`.toLowerCase().includes(search)
    );
  }

  const liveNeonStats = summarizeNeonReservationStats(neonCountRes.rows || [], num(extCountRes.rows[0]?.cnt, 0));

  return {
    settings,
    latestRun: activeRun,
    runs,
    issues,
    actions: actionsRes.rows.map(formatActionRow),
    liveNeonStats
  };
}

export async function runDataIntegrityCheck(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperAccess(session);
  const settings = await readIntegritySettingsInternal(executor);
  const runMode = str(payload.runMode || 'manual');
  if (settings.paused && !payload.force && runMode === 'scheduled') {
    return { skipped: true, reason: 'PAUSED', settings };
  }

  const scopes = Array.isArray(payload.scopes) && payload.scopes.length
    ? payload.scopes.map((s: any) => str(s)).filter(Boolean)
    : settings.scopes;
  const dateFrom = str(payload.dateFrom !== undefined ? payload.dateFrom : settings.dateFrom);
  const dateTo = str(payload.dateTo !== undefined ? payload.dateTo : settings.dateTo);

  const startedIso = new Date().toISOString();
  const runId = generateId('DIRUN');

  // Strictly read-only fetch from RG (or injected test snapshot) + strictly read-only select from Neon
  const rgSnapshot: IntegrityRgSnapshotResult = payload._mockRgSnapshot
    ? payload._mockRgSnapshot
    : await fetchRentalGateSnapshotReadOnly(executor, {
        scopes,
        dateFrom,
        dateTo,
        maxPages: Math.max(10, Math.ceil(num(settings.batchSize, 100) / 10))
      });

  const neonResQ = await executor.query(`SELECT * FROM reservations ORDER BY updated_at DESC LIMIT 20000`);
  const neonExtCountQ = await executor.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM extensions`);
  const neonRows = neonResQ.rows || [];
  const neonExtCount = num(neonExtCountQ.rows[0]?.cnt, 0);

  const neonSummary = summarizeNeonReservationStats(neonRows, neonExtCount);
  const rgSummary = summarizeRgSnapshotStats(rgSnapshot);

  const cmpRes = crmCore.compareRgAndNeonReservations(
    rgSnapshot.reservations || [],
    neonRows.map((r) => mapReservationRowToClient(r, false))
  );
  const rawIssues: any[] = Array.isArray(cmpRes) ? cmpRes : (Array.isArray(cmpRes?.issues) ? cmpRes.issues : []);

  const byType: Record<string, number> = {};
  for (const iss of rawIssues) {
    const dt = str(iss.discrepancyType);
    byType[dt] = (byType[dt] || 0) + 1;
  }

  const summary = {
    rg: rgSummary,
    neon: neonSummary,
    byType,
    incompleteEndpoints: rgSnapshot.incompleteEndpoints || [],
    pagesFetched: rgSnapshot.pagesFetched || 0
  };
  const finishedIso = new Date().toISOString();

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO data_integrity_runs (
         id, run_mode, status, triggered_by_id, triggered_by_name, scopes_json, summary_json,
         rg_count, neon_count, discrepancies_count, error_message, started_at, finished_at
       ) VALUES ($1,$2,'completed',$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,'',$10::timestamptz,$11::timestamptz)`,
      [
        runId,
        runMode,
        session.user.id,
        session.user.name,
        JSON.stringify(scopes),
        JSON.stringify(summary),
        rgSummary.total,
        neonSummary.total,
        rawIssues.length,
        startedIso,
        finishedIso
      ]
    );

    for (const iss of rawIssues) {
      await tx.query(
        `INSERT INTO data_integrity_issues (
           id, run_id, discrepancy_type, severity, source_scope, reservation_id, reservation_number,
           field_name, rg_value, neon_value, rg_snapshot_json, neon_snapshot_json,
           resolution_status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,'open',$13::timestamptz,$13::timestamptz)`,
        [
          generateId('DISS'),
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
    }

    await logIntegrityActivity(
      tx,
      session.user,
      'فحص سلامة البيانات',
      runId,
      `RG: ${rgSummary.total} حجز · Neon: ${neonSummary.total} حجز · الفروقات المكتشفة: ${rawIssues.length}`
    );
  });

  return getDataIntegrityReport(executor, session, { runId });
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
    `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $2 OR source_reservation_id = $1 LIMIT 1`,
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
    `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $2 LIMIT 1`,
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
           SET original_status_code = $2,
               internal_status = $3,
               customer_name = $4,
               customer_phone = $5,
               start_date = $6,
               end_date = $7,
               car_name = $8,
               company_name = $9,
               last_update_text = $10,
               last_updated_by_id = $11,
               last_updated_by_name = $12,
               last_updated_at = $13,
               updated_at = $13::timestamptz
           WHERE id = $1`,
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
            session.user.id,
            session.user.name,
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
       SET resolution_status = $2, resolved_by_id = $3, resolved_by_name = $4,
           resolved_at = $5::timestamptz, resolution_note = $6, updated_at = $5::timestamptz
       WHERE id = $1`,
      [issueId, nextStatus, session.user.id, session.user.name, nowIso, note]
    );
    await tx.query(
      `INSERT INTO data_integrity_actions (
         id, issue_id, run_id, reservation_id, reservation_number, action_type,
         actor_id, actor_name, before_snapshot_json, after_snapshot_json,
         rollback_supported, rolled_back, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,FALSE,$12::timestamptz)`,
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
       SET original_status_code = $2,
           internal_status = $3,
           customer_name = $4,
           customer_phone = $5,
           start_date = $6,
           end_date = $7,
           car_name = $8,
           company_name = $9,
           last_update_text = $10,
           last_updated_by_id = $11,
           last_updated_by_name = $12,
           last_updated_at = $13,
           updated_at = $13::timestamptz
       WHERE id = $1`,
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
        session.user.id,
        session.user.name,
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
