import { crmCore, generateId, type AuthSession } from './auth.js';
import { getPoolMetrics, runWithSavepoint, type DbClient, type DbExecutor } from './db.js';
import { redactSensitiveText } from './logger.js';
import { testRgApiConnectionSafe } from './rgApiClient.js';
import { SCHEMA_SQL } from './schemaSql.js';
import { getRgTokenDiagnostics, getSyncSecretDiagnostics, resolveServerConfig } from './serverConfig.js';
import {
  classifyOutboxMirrorError,
  fetchRentalGateSnapshotReadOnly,
  flushSheetsMirrorOutbox,
  reprocessFailedOutboxBatch,
  retryFailedSyncRecords,
  verifyGasMirrorAuth
} from './syncService.js';

export type HealthStatus = 'unknown' | 'healthy' | 'warning' | 'critical';
export type HealthSectionKey = 'database_health' | 'schema_integrity' | 'data_integrity' | 'sync_health';

export interface ExpectedColumnSpec {
  name: string;
  dataType: string;
}

export interface ExpectedConstraintSpec {
  kind: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY';
  columns: string[];
  refTable?: string;
}

export interface ExpectedTableSpec {
  name: string;
  columns: Map<string, ExpectedColumnSpec>;
  constraints: ExpectedConstraintSpec[];
  codeRefs: string[];
}

export interface ExpectedIndexSpec {
  name: string;
  table: string;
}

export interface ExpectedSchemaManifest {
  tables: Map<string, ExpectedTableSpec>;
  indexes: Map<string, ExpectedIndexSpec>;
  expectedMigrations: string[];
  expectedConstraintsCount: number;
}

export const EXPECTED_MIGRATION_IDS = [
  '2026_11_27_001_data_integrity_run_mode',
  '2026_11_27_002_normalize_rg_reservation_numbers',
  '2026_11_27_003_audit_schema_alignment_and_indexes',
  '2026_11_27_004_health_center_runs',
  '2026_11_27_005_audit_indexes_and_constraints',
  '2026_11_27_006_integrity_schema_and_extensions_recalc',
  '2026_11_27_007_customers_backfill_and_outbox_reliability',
  '2026_11_27_008_outbox_attempt_and_error_category'
];

export const TABLE_CODE_REFERENCES: Record<string, string[]> = {
  users: ['backend/auth.ts', 'backend/queries.ts'],
  employees: ['backend/auth.ts', 'backend/queries.ts', 'backend/syncService.ts'],
  reservations: ['backend/queries.ts', 'backend/syncService.ts', 'backend/dataIntegrity.ts', 'backend/integrityService.ts'],
  extensions: ['backend/queries.ts', 'backend/syncService.ts', 'backend/dataIntegrity.ts'],
  assignments: ['backend/queries.ts'],
  follow_ups: ['backend/queries.ts', 'backend/syncService.ts'],
  follow_up_history: ['backend/queries.ts'],
  problems: ['backend/queries.ts', 'backend/syncService.ts'],
  issues: ['backend/queries.ts'],
  problem_updates: ['backend/queries.ts'],
  activity_log: ['backend/queries.ts', 'backend/integrityService.ts', 'backend/healthCenter.ts'],
  notifications: ['backend/queries.ts', 'backend/db.ts'],
  notification_dismissals: ['backend/queries.ts', 'backend/db.ts'],
  settings: ['backend/queries.ts', 'backend/syncService.ts', 'backend/serverConfig.ts'],
  roles: ['backend/auth.ts', 'backend/queries.ts'],
  permissions: ['backend/auth.ts', 'backend/queries.ts'],
  sessions: ['backend/auth.ts', 'backend/db.ts'],
  sync_log: ['backend/queries.ts', 'backend/syncService.ts'],
  sync_checkpoints: ['backend/syncService.ts', 'backend/healthCenter.ts'],
  sheets_mirror_outbox: ['backend/syncService.ts', 'backend/healthCenter.ts'],
  error_logs: ['backend/logger.ts', 'backend/healthCenter.ts'],
  shift_announcements: ['backend/queries.ts'],
  employee_delegations: ['backend/auth.ts', 'backend/queries.ts'],
  reservation_locks: ['backend/queries.ts'],
  sync_tombstones: ['backend/queries.ts'],
  sync_worker_state: ['backend/syncService.ts', 'scripts/auto-sync-worker.ts'],
  schema_migrations: ['backend/db.ts', 'backend/healthCenter.ts'],
  customers: ['backend/queries.ts', 'backend/syncService.ts'],
  customer_note_statuses: ['backend/queries.ts'],
  customer_notes: ['backend/queries.ts'],
  customer_note_attachments: ['backend/queries.ts'],
  customer_note_history: ['backend/queries.ts'],
  data_integrity_runs: ['backend/dataIntegrity.ts', 'backend/integrityService.ts'],
  data_integrity_issues: ['backend/dataIntegrity.ts', 'backend/integrityService.ts'],
  data_integrity_actions: ['backend/dataIntegrity.ts', 'backend/integrityService.ts'],
  realtime_events: ['backend/realtime.ts', 'backend/queries.ts'],
  idempotency_requests: ['backend/cache.ts'],
  health_center_runs: ['backend/healthCenter.ts']
};

const KNOWN_NEON_SAMPLE_TABLES = new Set(['playing_with_neon']);

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

export function assertHealthCenterAccess(session: AuthSession): void {
  const role = str(session?.user?.role).toLowerCase();
  const canDev = crmCore && typeof crmCore.canUserPerform === 'function'
    ? crmCore.canUserPerform(session.user, 'manage_developer_tools')
    : false;
  if (role !== 'developer' || !canDev) {
    throw new Error('FORBIDDEN: مركز صحة قاعدة البيانات متاح للمبرمج (Developer) فقط.');
  }
}

export function normalizeHealthCenterSettings(raw: unknown): {
  autoRefreshEnabled: boolean;
  autoRefreshIntervalSec: number;
} {
  const parsed = parseJsonSafe<Record<string, any>>(raw, {});
  const rawSec = num(parsed.autoRefreshIntervalSec, 60);
  const clampedSec = Math.min(3600, Math.max(15, Math.round(rawSec)));
  return {
    autoRefreshEnabled: Boolean(parsed.autoRefreshEnabled),
    autoRefreshIntervalSec: clampedSec
  };
}

export function calculateHealthCenterOverallStatus(
  sections: Partial<Record<HealthSectionKey, { status?: HealthStatus | string }>>,
  errorDigest?: { active?: any[] } | null
): HealthStatus {
  const keys: HealthSectionKey[] = ['database_health', 'schema_integrity', 'data_integrity', 'sync_health'];
  const statuses = keys.map((k) => str(sections?.[k]?.status || 'unknown').toLowerCase() as HealthStatus);
  if (statuses.every((s) => s === 'unknown' || !s)) {
    return 'unknown';
  }
  if (statuses.some((s) => s === 'critical')) {
    return 'critical';
  }
  if (statuses.some((s) => s === 'warning')) {
    return 'warning';
  }
  if (errorDigest && Array.isArray(errorDigest.active) && errorDigest.active.length > 0) {
    return 'warning';
  }
  if (statuses.some((s) => s === 'healthy')) {
    return statuses.every((s) => s === 'healthy') ? 'healthy' : 'warning';
  }
  return 'unknown';
}

export function normalizePgColumnType(rawType: string): string {
  const lower = str(rawType).toLowerCase().replace(/\s+/g, ' ');
  if (!lower) return 'text';
  if (lower.startsWith('timestamptz') || lower.includes('timestamp with time zone')) return 'timestamp with time zone';
  if (lower.startsWith('timestamp')) return 'timestamp without time zone';
  if (lower.startsWith('numeric') || lower.startsWith('decimal')) return 'numeric';
  if (lower === 'int4' || lower === 'integer' || lower === 'serial') return 'integer';
  if (lower === 'int8' || lower === 'bigint' || lower === 'bigserial') return 'bigint';
  if (lower === 'bool' || lower === 'boolean') return 'boolean';
  if (lower.startsWith('varchar') || lower.startsWith('character varying')) return 'character varying';
  if (lower === 'jsonb') return 'jsonb';
  if (lower === 'text') return 'text';
  return lower;
}

export function parseSchemaManifestFromSql(sqlText: string = SCHEMA_SQL): ExpectedSchemaManifest {
  const tables = new Map<string, ExpectedTableSpec>();
  const indexes = new Map<string, ExpectedIndexSpec>();

  const cleaned = String(sqlText || '').replace(/--[^\n]*/g, '');

  const tableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRegex.exec(cleaned)) !== null) {
    const tblName = tm[1].toLowerCase();
    const body = tm[2];
    const prev = tables.get(tblName);
    const colMap = prev?.columns || new Map<string, ExpectedColumnSpec>();
    const constraints: ExpectedConstraintSpec[] = prev?.constraints ? [...prev.constraints] : [];
    const lines = body.split(/,\s*\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line) continue;

      const tblPk = line.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (tblPk) {
        constraints.push({
          kind: 'PRIMARY KEY',
          columns: tblPk[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean)
        });
        continue;
      }
      const tblUniq = line.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]+)\)/i);
      if (tblUniq) {
        constraints.push({
          kind: 'UNIQUE',
          columns: tblUniq[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean)
        });
        continue;
      }
      const tblFk = line.match(/^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-zA-Z0-9_]+)/i);
      if (tblFk) {
        constraints.push({
          kind: 'FOREIGN KEY',
          columns: tblFk[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean),
          refTable: tblFk[2].toLowerCase()
        });
        continue;
      }
      if (/^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|FOREIGN\s+KEY|CHECK)\b/i.test(line)) continue;

      const cm = line.match(/^"?([a-zA-Z0-9_]+)"?\s+([A-Za-z]+(?:\s+WITH\s+TIME\s+ZONE|\s+WITHOUT\s+TIME\s+ZONE|\s*\([^)]*\))?)/i);
      if (cm) {
        const colName = cm[1].toLowerCase();
        const normType = normalizePgColumnType(cm[2]);
        colMap.set(colName, { name: colName, dataType: normType });
        if (/\bPRIMARY\s+KEY\b/i.test(line)) {
          constraints.push({ kind: 'PRIMARY KEY', columns: [colName] });
        }
        if (/\bUNIQUE\b/i.test(line)) {
          constraints.push({ kind: 'UNIQUE', columns: [colName] });
        }
        const inlineRef = line.match(/\bREFERENCES\s+([a-zA-Z0-9_]+)/i);
        if (inlineRef) {
          constraints.push({ kind: 'FOREIGN KEY', columns: [colName], refTable: inlineRef[1].toLowerCase() });
        }
      }
    }
    tables.set(tblName, {
      name: tblName,
      columns: colMap,
      constraints,
      codeRefs: TABLE_CODE_REFERENCES[tblName] || ['backend/schemaSql.ts']
    });
  }

  const alterRegex = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?([a-zA-Z0-9_]+)"?\s+([A-Za-z]+(?:\s+WITH\s+TIME\s+ZONE|\s*\([^)]*\))?)/gi;
  let am: RegExpExecArray | null;
  while ((am = alterRegex.exec(cleaned)) !== null) {
    const tblName = am[1].toLowerCase();
    const colName = am[2].toLowerCase();
    const normType = normalizePgColumnType(am[3]);
    if (!tables.has(tblName)) {
      tables.set(tblName, {
        name: tblName,
        columns: new Map(),
        constraints: [],
        codeRefs: TABLE_CODE_REFERENCES[tblName] || ['backend/schemaSql.ts']
      });
    }
    tables.get(tblName)!.columns.set(colName, { name: colName, dataType: normType });
  }

  const idxRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)/gi;
  let im: RegExpExecArray | null;
  while ((im = idxRegex.exec(cleaned)) !== null) {
    const idxName = im[1].toLowerCase();
    const tblName = im[2].toLowerCase();
    indexes.set(idxName, { name: idxName, table: tblName });
  }

  const expectedConstraintsCount = Array.from(tables.values()).reduce((sum, t) => sum + t.constraints.length, 0);

  return {
    tables,
    indexes,
    expectedMigrations: [...EXPECTED_MIGRATION_IDS],
    expectedConstraintsCount
  };
}

export interface LiveColumnRecord {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable?: string;
}

export interface LiveIndexRecord {
  tablename: string;
  indexname: string;
}

export interface LiveConstraintRecord {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
}

export interface LiveFkDetailRecord {
  table_name: string;
  constraint_name: string;
  delete_rule?: string;
  convalidated?: boolean;
}

export function diffSchemaManifest(
  manifest: ExpectedSchemaManifest,
  liveTableNames: string[],
  liveColumns: LiveColumnRecord[],
  liveConstraints: LiveConstraintRecord[],
  liveIndexes: LiveIndexRecord[],
  appliedMigrations: Array<{ id: string; description?: string; applied_at?: any }>,
  liveFkDetails: LiveFkDetailRecord[] = []
) {
  const liveTableSet = new Set(liveTableNames.map((t) => str(t).toLowerCase()).filter(Boolean));
  const liveColsByTable = new Map<string, Map<string, { dataType: string; isNullable: boolean }>>();
  for (const col of liveColumns) {
    const t = str(col.table_name).toLowerCase();
    const c = str(col.column_name).toLowerCase();
    if (!t || !c) continue;
    if (!liveColsByTable.has(t)) liveColsByTable.set(t, new Map());
    liveColsByTable.get(t)!.set(c, {
      dataType: normalizePgColumnType(col.data_type),
      isNullable: str(col.is_nullable).toUpperCase() === 'YES'
    });
  }

  const liveIndexSet = new Set(liveIndexes.map((i) => str(i.indexname).toLowerCase()).filter(Boolean));
  const liveConstraintsByTable = new Map<string, Set<string>>();
  for (const con of liveConstraints || []) {
    const t = str(con.table_name).toLowerCase();
    const k = str(con.constraint_type).toUpperCase();
    if (!t || !k) continue;
    if (!liveConstraintsByTable.has(t)) liveConstraintsByTable.set(t, new Set());
    liveConstraintsByTable.get(t)!.add(k);
  }

  const missingTables: Array<{ table: string; codeRefs: string[] }> = [];
  const missingColumns: Array<{ table: string; column: string; expectedType: string; codeRefs: string[] }> = [];
  const extraColumns: Array<{ table: string; column: string; actualType: string }> = [];
  const typeMismatches: Array<{ table: string; column: string; expectedType: string; actualType: string; codeRefs: string[] }> = [];
  const extraTables: Array<{ table: string; isSampleTable: boolean; note: string }> = [];
  const missingIndexes: Array<{ index: string; table: string; codeRefs: string[] }> = [];
  const constraintMismatches: Array<{ table: string; constraintType: string; columns: string[]; refTable?: string; codeRefs: string[] }> = [];

  for (const [tblName, spec] of manifest.tables.entries()) {
    if (!liveTableSet.has(tblName)) {
      missingTables.push({ table: tblName, codeRefs: spec.codeRefs });
      continue;
    }
    const liveCols = liveColsByTable.get(tblName) || new Map();
    for (const [colName, colSpec] of spec.columns.entries()) {
      const liveCol = liveCols.get(colName);
      if (!liveCol) {
        missingColumns.push({
          table: tblName,
          column: colName,
          expectedType: colSpec.dataType,
          codeRefs: spec.codeRefs
        });
      } else if (
        colSpec.dataType &&
        liveCol.dataType &&
        colSpec.dataType !== liveCol.dataType &&
        !(colSpec.dataType === 'integer' && liveCol.dataType === 'bigint') &&
        !(colSpec.dataType === 'text' && liveCol.dataType === 'character varying')
      ) {
        typeMismatches.push({
          table: tblName,
          column: colName,
          expectedType: colSpec.dataType,
          actualType: liveCol.dataType,
          codeRefs: spec.codeRefs
        });
      }
    }

    for (const [liveColName, liveMeta] of liveCols.entries()) {
      if (!spec.columns.has(liveColName)) {
        extraColumns.push({
          table: tblName,
          column: liveColName,
          actualType: liveMeta.dataType
        });
      }
    }

    if (liveConstraints.length > 0 && Array.isArray(spec.constraints) && spec.constraints.length > 0) {
      const liveTypes = liveConstraintsByTable.get(tblName) || new Set<string>();
      for (const expCon of spec.constraints) {
        if (!liveTypes.has(expCon.kind)) {
          constraintMismatches.push({
            table: tblName,
            constraintType: expCon.kind,
            columns: expCon.columns,
            refTable: expCon.refTable,
            codeRefs: spec.codeRefs
          });
        }
      }
    }
  }

  for (const fk of liveFkDetails || []) {
    const tbl = str(fk.table_name).toLowerCase();
    const deleteRule = str(fk.delete_rule).toUpperCase();
    if (tbl === 'customer_note_history' && (deleteRule === 'CASCADE' || fk.convalidated === false)) {
      constraintMismatches.push({
        table: 'customer_note_history',
        constraintType: deleteRule === 'CASCADE' ? 'FOREIGN KEY (EXPECTED ON DELETE RESTRICT, FOUND CASCADE)' : 'FOREIGN KEY (NOT VALIDATED)',
        columns: ['note_id'],
        refTable: 'customer_notes',
        codeRefs: TABLE_CODE_REFERENCES.customer_note_history || ['backend/schemaSql.ts']
      });
    }
  }

  for (const lt of liveTableSet) {
    if (!manifest.tables.has(lt)) {
      const isSample = KNOWN_NEON_SAMPLE_TABLES.has(lt);
      extraTables.push({
        table: lt,
        isSampleTable: isSample,
        note: isSample ? 'جدول تجريبي افتراضي من Neon — لا يؤثر على التشغيل ولا يُحذف تلقائياً' : 'جدول غير معرّف في schemaSql.ts'
      });
    }
  }

  for (const [idxName, idxSpec] of manifest.indexes.entries()) {
    if (!liveIndexSet.has(idxName) && liveTableSet.has(idxSpec.table)) {
      missingIndexes.push({
        index: idxName,
        table: idxSpec.table,
        codeRefs: TABLE_CODE_REFERENCES[idxSpec.table] || ['backend/schemaSql.ts']
      });
    }
  }

  const appliedSet = new Set(appliedMigrations.map((m) => str(m.id)));
  const pendingMigrations = manifest.expectedMigrations.filter((id) => !appliedSet.has(id));

  const nonSampleExtraTables = extraTables.filter((t) => !t.isSampleTable);
  const missingPrimaryKey = constraintMismatches.some((c) => c.constraintType === 'PRIMARY KEY');
  let status: HealthStatus = 'healthy';
  if (missingTables.length > 0 || missingColumns.length > 0 || pendingMigrations.length > 0 || missingPrimaryKey) {
    status = 'critical';
  } else if (
    typeMismatches.length > 0 ||
    missingIndexes.length > 0 ||
    extraColumns.length > 0 ||
    nonSampleExtraTables.length > 0 ||
    constraintMismatches.length > 0
  ) {
    status = 'warning';
  }

  return {
    status,
    totalTables: liveTableSet.size,
    expectedTables: manifest.tables.size,
    totalColumns: liveColumns.length,
    expectedColumns: Array.from(manifest.tables.values()).reduce((sum, t) => sum + t.columns.size, 0),
    totalConstraints: liveConstraints.length,
    expectedConstraints: manifest.expectedConstraintsCount,
    totalIndexes: liveIndexes.length,
    missingTables,
    missingColumns,
    extraTables,
    extraColumns,
    typeMismatches,
    missingIndexes,
    constraintMismatches,
    appliedMigrationsCount: appliedMigrations.length,
    pendingMigrations,
    migrations: appliedMigrations.map((m) => ({
      id: str(m.id),
      description: str(m.description),
      appliedAt: m.applied_at instanceof Date ? m.applied_at.toISOString() : str(m.applied_at)
    }))
  };
}

async function logHealthCenterActivity(
  executor: DbClient,
  user: AuthSession['user'],
  actionType: string,
  entityId: string,
  details: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const riyadh = crmCore && typeof crmCore.getRiyadhDateTimeParts === 'function'
    ? crmCore.getRiyadhDateTimeParts(nowIso)
    : { date: nowIso.slice(0, 10), time: nowIso.slice(11, 16) };
  await runWithSavepoint(
    executor,
    'hc_activity_log',
    () =>
      executor.query(
        `INSERT INTO activity_log (
           id, user_id, user_name, user_role, action_type, entity_type, entity_id,
           details, changes, log_date, log_time, created_at
         ) VALUES ($1,$2,$3,$4,$5,'DbHealthCenter',$6,$7,'[]'::jsonb,$8,$9,$10::timestamptz)`,
        [
          generateId('ACT'),
          str(user.id),
          str(user.name || user.username),
          str(user.role),
          actionType,
          str(entityId),
          redactSensitiveText(details).slice(0, 500),
          riyadh.date,
          riyadh.time,
          nowIso
        ]
      ),
    undefined
  );
}

async function collectDatabaseHealth(executor: DbExecutor) {
  const t0 = Date.now();
  let connected = false;
  let latencyMs = 0;
  let pgVersion = '';
  let dbName = '';
  let probeError = '';

  try {
    const pingQ = await executor.query<{ ok: number; pg_version: string; db_name: string }>(
      `SELECT 1 AS ok, version() AS pg_version, current_database() AS db_name`
    );
    latencyMs = Math.max(1, Date.now() - t0);
    connected = Boolean(pingQ.rows?.[0]?.ok);
    pgVersion = str(pingQ.rows?.[0]?.pg_version).split(',')[0];
    dbName = str(pingQ.rows?.[0]?.db_name);
  } catch (err: any) {
    latencyMs = Math.max(0, Date.now() - t0);
    connected = false;
    probeError = redactSensitiveText(err?.message || 'CONNECTION_FAILED').slice(0, 300);
  }

  const poolMetrics = getPoolMetrics();

  const queryErrors: Array<{ step: string; message: string }> = [];
  const capDb = async <T = any>(step: string, fn: () => Promise<{ rows: T[] }>, fallbackRows: T[] = []) => {
    try {
      return await fn();
    } catch (err: any) {
      queryErrors.push({ step, message: redactSensitiveText(err?.message || 'QUERY_FAILED').slice(0, 220) });
      return { rows: fallbackRows };
    }
  };

  let maxConnections = 0;
  let activityStats = { total: 0, active: 0, idle: 0, idleInTransaction: 0, waiting: 0, longestQueryMs: 0 };
  let dbStats = { commits: 0, rollbacks: 0, deadlocks: 0, cacheHitRatioPct: 100, dbSizeBytes: 0, dbSizeMb: 0 };
  let slowQueries: any[] = [];
  let pgStatStatementsAvailable = false;
  let tableStats: any[] = [];
  let recentErrors: any[] = [];
  let errorCounts = { total24h: 0, total7d: 0, sqlErrors: 0, txErrors: 0, syncErrors: 0, activeSinceLastClean: 0 };
  let lastSuccessAt = connected ? new Date().toISOString() : '';
  let lastConnectionError: any = null;
  let active24hCount = 0;
  let activeTxErrors = 0;
  let recentUnresolvedErrors: any[] = [];

  if (connected) {
    try {
      const [maxConnQ, actQ, dbStatQ, tblStatQ, errQ, errSummaryQ, prevOkQ] = await Promise.all([
        capDb('max_connections', () => executor.query<{ max_conn: number }>(`SELECT current_setting('max_connections')::int AS max_conn`), [{ max_conn: 0 }]),
        capDb('pg_stat_activity', () => executor.query<{
          state: string;
          wait_event_type: string | null;
          cnt: number;
          max_dur_ms: number;
        }>(
          `SELECT COALESCE(state, 'unknown') AS state,
                  wait_event_type,
                  COUNT(*)::int AS cnt,
                  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000), 0)::int AS max_dur_ms
           FROM pg_stat_activity
           WHERE datname = current_database()
           GROUP BY 1, 2`
        )),
        capDb('pg_stat_database', () => executor.query<{
          xact_commit: string;
          xact_rollback: string;
          blks_hit: string;
          blks_read: string;
          deadlocks: string;
          db_size_bytes: string;
        }>(
          `SELECT xact_commit::text, xact_rollback::text, blks_hit::text, blks_read::text,
                  deadlocks::text, pg_database_size(current_database())::text AS db_size_bytes
           FROM pg_stat_database
           WHERE datname = current_database()
           LIMIT 1`
        )),
        capDb('pg_stat_user_tables', () => executor.query<{
          table_name: string;
          live_rows: string;
          dead_tuples: string;
          seq_scan: string;
          idx_scan: string;
          total_bytes: string;
          last_analyze: any;
        }>(
          `SELECT relname AS table_name,
                  n_live_tup::text AS live_rows,
                  n_dead_tup::text AS dead_tuples,
                  seq_scan::text AS seq_scan,
                  idx_scan::text AS idx_scan,
                  pg_total_relation_size(relid)::text AS total_bytes,
                  last_autoanalyze AS last_analyze
           FROM pg_stat_user_tables
           ORDER BY pg_total_relation_size(relid) DESC
           LIMIT 20`
        )),
        capDb('error_logs', () => executor.query(
          `SELECT id, context, action, message, stack, created_at
           FROM error_logs
           ORDER BY created_at DESC
           LIMIT 30`
        )),
        capDb('error_summary', () => executor.query<{
          total_24h: number;
          total_7d: number;
          sql_errs: number;
          tx_errs: number;
          sync_errs: number;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS total_24h,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS total_7d,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND (message ~* 'column |relation |syntax error|constraint|type |SQL|psycopg|pg|postgres'))::int AS sql_errs,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND (message ~* 'transaction is aborted|25P02|deadlock|serialization|ROLLBACK'))::int AS tx_errs,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND (context ~* 'sync' OR action ~* 'sync|pull'))::int AS sync_errs
           FROM error_logs`
        )),
        capDb('prev_health_run', () => executor.query<{ finished_at: any }>(
          `SELECT finished_at FROM health_center_runs WHERE overall_status <> 'critical' ORDER BY finished_at DESC NULLS LAST LIMIT 1`
        ))
      ]);

      maxConnections = num(maxConnQ.rows?.[0]?.max_conn, 0);

      for (const r of actQ.rows || []) {
        const st = str(r.state);
        const cnt = num(r.cnt, 0);
        activityStats.total += cnt;
        if (st === 'active') activityStats.active += cnt;
        else if (st === 'idle') activityStats.idle += cnt;
        else if (st === 'idle in transaction') activityStats.idleInTransaction += cnt;
        if (r.wait_event_type && st === 'active') activityStats.waiting += cnt;
        if (st === 'active') {
          activityStats.longestQueryMs = Math.max(activityStats.longestQueryMs, num(r.max_dur_ms, 0));
        }
      }

      const dRow = dbStatQ.rows?.[0];
      if (dRow) {
        const hit = num(dRow.blks_hit, 0);
        const read = num(dRow.blks_read, 0);
        const totalBlk = hit + read;
        const sizeBytes = num(dRow.db_size_bytes, 0);
        dbStats = {
          commits: num(dRow.xact_commit, 0),
          rollbacks: num(dRow.xact_rollback, 0),
          deadlocks: num(dRow.deadlocks, 0),
          cacheHitRatioPct: totalBlk > 0 ? Math.round((hit / totalBlk) * 10000) / 100 : 100,
          dbSizeBytes: sizeBytes,
          dbSizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100
        };
      }

      tableStats = (tblStatQ.rows || []).map((t) => {
        const seq = num(t.seq_scan, 0);
        const idx = num(t.idx_scan, 0);
        const bytes = num(t.total_bytes, 0);
        return {
          tableName: str(t.table_name),
          liveRows: num(t.live_rows, 0),
          deadTuples: num(t.dead_tuples, 0),
          seqScan: seq,
          idxScan: idx,
          sizeKb: Math.round((bytes / 1024) * 10) / 10,
          lastAnalyze: t.last_analyze instanceof Date ? t.last_analyze.toISOString() : str(t.last_analyze)
        };
      });

      const es = errSummaryQ.rows?.[0];
      if (es) {
        errorCounts = {
          total24h: num(es.total_24h, 0),
          total7d: num(es.total_7d, 0),
          sqlErrors: num(es.sql_errs, 0),
          txErrors: num(es.tx_errs, 0),
          syncErrors: num(es.sync_errs, 0),
          activeSinceLastClean: 0
        };
      }

      recentErrors = (errQ.rows || []).map((e) => {
        const cleanMsg = redactSensitiveText(e.message);
        const cleanStack = redactSensitiveText(e.stack);
        const isTx = /transaction is aborted|25P02|deadlock|ROLLBACK/i.test(cleanMsg);
        const isSql = /column |relation |syntax error|constraint|type |postgres|sql/i.test(cleanMsg);
        return {
          id: str(e.id),
          context: str(e.context),
          action: str(e.action),
          category: isTx ? 'transaction' : (isSql ? 'sql' : 'runtime'),
          message: cleanMsg,
          stack: cleanStack,
          createdAt: e.created_at instanceof Date ? e.created_at.toISOString() : str(e.created_at)
        };
      });

      lastConnectionError = recentErrors.find((e) => /connect|timeout|pool|DATABASE|25P02|sql/i.test(`${e.context} ${e.message}`)) || null;
      const prevCleanRaw = prevOkQ.rows?.[0]?.finished_at;
      const prevCleanMs = prevCleanRaw ? new Date(prevCleanRaw).getTime() : 0;
      if (!lastSuccessAt && prevCleanRaw) {
        lastSuccessAt = prevCleanRaw instanceof Date ? prevCleanRaw.toISOString() : str(prevCleanRaw);
      }

      // Only unresolved/new errors after the previous clean health run should turn status into warning
      const prevBaselineMs = prevCleanMs > 0 ? prevCleanMs : 0;
      recentUnresolvedErrors = prevBaselineMs > 0
        ? recentErrors.filter((e) => {
            const ems = Date.parse(e.createdAt || '');
            return Number.isFinite(ems) && ems > prevBaselineMs;
          })
        : recentErrors;
      active24hCount = prevBaselineMs > 0 ? recentUnresolvedErrors.length : errorCounts.total24h;
      activeTxErrors = prevBaselineMs > 0
        ? recentUnresolvedErrors.filter((e) => e.category === 'transaction').length
        : errorCounts.txErrors;
      errorCounts.activeSinceLastClean = active24hCount;

      try {
        const pssQ = await executor.query<{
          query: string;
          calls: string;
          mean_exec_time: number;
          max_exec_time: number;
        }>(
          `SELECT LEFT(query, 240) AS query, calls::text,
                  ROUND(mean_exec_time::numeric, 2)::float AS mean_exec_time,
                  ROUND(max_exec_time::numeric, 2)::float AS max_exec_time
           FROM pg_stat_statements
           WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
             AND mean_exec_time > 50
           ORDER BY mean_exec_time DESC
           LIMIT 10`
        );
        pgStatStatementsAvailable = true;
        slowQueries = (pssQ.rows || []).map((q) => ({
          source: 'pg_stat_statements',
          query: redactSensitiveText(q.query),
          calls: num(q.calls, 0),
          meanMs: num(q.mean_exec_time, 0),
          maxMs: num(q.max_exec_time, 0)
        }));
      } catch {
        pgStatStatementsAvailable = false;
        const activeSlowQ = await capDb('pg_stat_activity_slow', () => executor.query<{ pid: number; state: string; dur_ms: number; query: string }>(
          `SELECT pid, COALESCE(state,'') AS state,
                  COALESCE(EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000, 0)::int AS dur_ms,
                  LEFT(query, 220) AS query
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND pid <> pg_backend_pid()
             AND NOW() - query_start > INTERVAL '500 milliseconds'
           ORDER BY dur_ms DESC
           LIMIT 10`
        ));
        slowQueries = (activeSlowQ.rows || []).map((q) => ({
          source: 'pg_stat_activity',
          query: redactSensitiveText(q.query),
          calls: 1,
          meanMs: num(q.dur_ms, 0),
          maxMs: num(q.dur_ms, 0)
        }));
      }
    } catch (innerErr: any) {
      probeError = redactSensitiveText(innerErr?.message || 'HEALTH_COLLECT_ERROR').slice(0, 300);
    }
  }

  let status: HealthStatus = 'healthy';
  if (!connected) {
    status = 'critical';
  } else if (
    activityStats.idleInTransaction > 2 ||
    poolMetrics.waitingCount > 0 ||
    dbStats.deadlocks > 0 ||
    activeTxErrors > 0 ||
    latencyMs > 2500
  ) {
    status = latencyMs > 5000 || dbStats.deadlocks > 0 ? 'critical' : 'warning';
  } else if (
    active24hCount > 0 ||
    latencyMs > 800 ||
    dbStats.cacheHitRatioPct < 90 ||
    queryErrors.length > 0 ||
    Boolean(probeError)
  ) {
    status = 'warning';
  }

  const checkedAt = new Date().toISOString();
  const latestFailure = probeError
    ? { message: probeError, at: checkedAt, category: 'connection' }
    : (recentUnresolvedErrors[0] || null);
  const errorCategory = !connected
    ? 'connection'
    : (activeTxErrors > 0
      ? 'transaction'
      : (queryErrors.length > 0 ? 'query' : (active24hCount > 0 ? 'runtime' : 'none')));
  const recommendedAction = !connected
    ? 'تحقق من متغير DATABASE_URL واتصال خادم Neon PostgreSQL.'
    : (activeTxErrors > 0
      ? 'راجع سجل أخطاء المعاملات (25P02 / Deadlock) وأعد تشغيل الاستعلام المتأثر.'
      : (active24hCount > 0
        ? 'تم رصد أخطاء حديثة في الخادم بعد آخر فحص؛ راجع أحدث السجلات أسفل البطاقة.'
        : ''));

  return {
    status,
    checkedAt,
    connected,
    latencyMs,
    pgVersion,
    dbName,
    probeError,
    queryErrors,
    pool: poolMetrics,
    connections: {
      maxConnections,
      ...activityStats
    },
    databaseStats: dbStats,
    pgStatStatementsAvailable,
    slowQueries,
    tableStats,
    errorCounts,
    recentErrors,
    lastSuccessAt,
    lastConnectionError,
    lastSuccessfulCheck: lastSuccessAt,
    latestFailure,
    errorCategory,
    affectedComponent: 'neon_postgresql',
    errorCount: active24hCount + queryErrors.length + (probeError ? 1 : 0),
    recommendedAction,
    repairHistory: []
  };
}

async function collectSchemaIntegrity(executor: DbExecutor) {
  const manifest = parseSchemaManifestFromSql(SCHEMA_SQL);
  const queryErrors: Array<{ step: string; message: string }> = [];
  const capSchema = async <T = any>(step: string, fn: () => Promise<{ rows: T[] }>, fallbackRows: T[] = []) => {
    try {
      return await fn();
    } catch (err: any) {
      queryErrors.push({ step, message: redactSensitiveText(err?.message || 'SCHEMA_QUERY_FAILED').slice(0, 220) });
      return { rows: fallbackRows };
    }
  };

  const [tblQ, colQ, conQ, fkQ, idxQ, migQ] = await Promise.all([
    capSchema('tables', () =>
      executor.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
      )
    ),
    capSchema('columns', () =>
      executor.query<LiveColumnRecord>(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
         ORDER BY table_name, ordinal_position`
      )
    ),
    capSchema('constraints', () =>
      executor.query<LiveConstraintRecord>(
        `SELECT table_name, constraint_name, constraint_type
         FROM information_schema.table_constraints
         WHERE table_schema = 'public'
         ORDER BY table_name, constraint_name`
      )
    ),
    capSchema('fk_rules', () =>
      executor.query<LiveFkDetailRecord>(
        `SELECT tc.table_name, tc.constraint_name, rc.delete_rule, pgc.convalidated
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = tc.constraint_schema
          AND rc.constraint_name = tc.constraint_name
         LEFT JOIN pg_constraint pgc
           ON pgc.conname = tc.constraint_name
          AND pgc.connamespace = 'public'::regnamespace
         WHERE tc.table_schema = 'public'
           AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.table_name, tc.constraint_name`
      )
    ),
    capSchema('indexes', () =>
      executor.query<LiveIndexRecord>(
        `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`
      )
    ),
    capSchema('migrations', () =>
      executor.query<{ id: string; description: string; applied_at: any }>(
        `SELECT id, description, applied_at FROM schema_migrations ORDER BY applied_at ASC`
      )
    )
  ]);

  const diff = diffSchemaManifest(
    manifest,
    (tblQ.rows || []).map((r) => r.table_name),
    colQ.rows || [],
    conQ.rows || [],
    idxQ.rows || [],
    migQ.rows || [],
    fkQ.rows || []
  );

  let finalStatus: HealthStatus = diff.status;
  if (queryErrors.some((e) => e.step === 'tables' || e.step === 'columns')) {
    finalStatus = 'unknown';
  } else if (queryErrors.length > 0 && finalStatus === 'healthy') {
    finalStatus = 'warning';
  }

  const checkedAt = new Date().toISOString();
  const schemaDiffCount =
    diff.missingTables.length +
    diff.missingColumns.length +
    diff.constraintMismatches.length +
    diff.missingIndexes.length +
    diff.typeMismatches.length +
    diff.pendingMigrations.length;
  const schemaLatestFailure =
    diff.missingTables[0] ||
    diff.missingColumns[0] ||
    diff.constraintMismatches[0] ||
    diff.pendingMigrations[0] ||
    queryErrors[0] ||
    null;

  return {
    checkedAt,
    ...diff,
    status: finalStatus,
    queryErrors,
    lastSuccessfulCheck: finalStatus === 'healthy' ? checkedAt : '',
    latestFailure: schemaLatestFailure,
    errorCategory: diff.missingTables.length || diff.missingColumns.length
      ? 'schema_missing'
      : (diff.constraintMismatches.length
        ? 'schema_constraint'
        : (diff.pendingMigrations.length ? 'pending_migration' : (queryErrors.length ? 'query' : 'none'))),
    affectedComponent: 'postgresql_schema',
    errorCount: schemaDiffCount + queryErrors.length,
    recommendedAction: diff.pendingMigrations.length
      ? 'نفّذ الترحيلات المعلقة (Migrations) أو أعد تشغيل تهيئة القاعدة الآمنة.'
      : ((diff.missingTables.length || diff.missingColumns.length || diff.constraintMismatches.length)
        ? 'تأكد من مطابقة بنية Neon مع مخطط schemaSql.ts.'
        : ''),
    repairHistory: migQ.rows || []
  };
}

async function collectDataIntegritySection(executor: DbExecutor, compareWithRg: boolean) {
  const queryErrors: Array<{ step: string; message: string }> = [];
  const capDi = async <T = any>(step: string, fn: () => Promise<{ rows: T[] }>, fallbackRows: T[] = []) => {
    try {
      return await fn();
    } catch (err: any) {
      queryErrors.push({ step, message: redactSensitiveText(err?.message || 'QUERY_FAILED').slice(0, 220) });
      return { rows: fallbackRows };
    }
  };

  const [countsQ, dupSrcQ, swappedRgQ, orphanExtQ, orphanFuQ, incompleteCustQ, extMismatchQ, extMismatchTotalQ, dualFlagQ, latestDiQ, openDiIssuesQ] = await Promise.all([
    capDi('counts', () =>
      executor.query<{
        reservations_cnt: number;
        customers_cnt: number;
        extensions_cnt: number;
        follow_ups_cnt: number;
        problems_cnt: number;
        notes_cnt: number;
        active_notifs_cnt: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM reservations WHERE deleted_at IS NULL) AS reservations_cnt,
           (SELECT COUNT(*)::int FROM customers) AS customers_cnt,
           (SELECT COUNT(*)::int FROM extensions) AS extensions_cnt,
           (SELECT COUNT(*)::int FROM follow_ups) AS follow_ups_cnt,
           (SELECT COUNT(*)::int FROM problems WHERE deleted_at IS NULL) AS problems_cnt,
           (SELECT COUNT(*)::int FROM customer_notes WHERE deleted_at IS NULL) AS notes_cnt,
           (SELECT COUNT(*)::int FROM notifications WHERE deleted_at IS NULL) AS active_notifs_cnt`
      )
    ),
    capDi('duplicates', () =>
      executor.query<{ source_reservation_id: string; cnt: number }>(
        `SELECT source_reservation_id, COUNT(*)::int AS cnt
         FROM reservations
         WHERE deleted_at IS NULL AND COALESCE(source_reservation_id, '') <> ''
         GROUP BY source_reservation_id
         HAVING COUNT(*) > 1
         LIMIT 25`
      )
    ),
    capDi('swapped_rg_numbers', () =>
      executor.query<{ id: string; reservation_number: string; source_reservation_id: string; reference_number: string }>(
        `SELECT id, reservation_number, source_reservation_id, reference_number
         FROM reservations
         WHERE deleted_at IS NULL
           AND COALESCE(source_reservation_id, '') <> ''
           AND UPPER(TRIM(COALESCE(reservation_number, ''))) LIKE 'RG-%'
           AND reservation_number <> source_reservation_id
         LIMIT 30`
      )
    ),
    capDi('orphan_extensions', () =>
      executor.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM extensions e
         LEFT JOIN reservations r ON r.id = e.reservation_id
         WHERE e.reservation_id IS NULL OR r.id IS NULL`
      ),
      [{ cnt: 0 }]
    ),
    capDi('orphan_children', () =>
      executor.query<{ orphan_follow_ups: number; orphan_assignments: number; orphan_notes: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM follow_ups f LEFT JOIN reservations r ON r.id = f.reservation_id WHERE r.id IS NULL) AS orphan_follow_ups,
           (SELECT COUNT(*)::int FROM assignments a LEFT JOIN reservations r ON r.id = a.reservation_id WHERE r.id IS NULL) AS orphan_assignments,
           (SELECT COUNT(*)::int FROM customer_notes n LEFT JOIN customers c ON c.id = n.customer_id WHERE n.deleted_at IS NULL AND c.id IS NULL) AS orphan_notes`
      ),
      [{ orphan_follow_ups: 0, orphan_assignments: 0, orphan_notes: 0 }]
    ),
    capDi('incomplete_customers', () =>
      executor.query<{ missing_id: number; missing_phone: number; missing_email: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(TRIM(id_number), '') IN ('', '-', '—', '0', 'غير متاح', 'غير محدد'))::int AS missing_id,
           COUNT(*) FILTER (WHERE COALESCE(TRIM(phone), '') = '')::int AS missing_phone,
           COUNT(*) FILTER (WHERE COALESCE(TRIM(email), '') = '')::int AS missing_email
         FROM customers`
      ),
      [{ missing_id: 0, missing_phone: 0, missing_email: 0 }]
    ),
    capDi('extensions_count_mismatches', () =>
      executor.query<{ reservation_number: string; stored_cnt: number; actual_cnt: number }>(
        `SELECT r.reservation_number, r.extensions_count::int AS stored_cnt, COUNT(e.id)::int AS actual_cnt
         FROM reservations r
         LEFT JOIN extensions e ON e.reservation_id = r.id
         WHERE r.deleted_at IS NULL
         GROUP BY r.id, r.reservation_number, r.extensions_count
         HAVING COALESCE(r.extensions_count, 0) <> COUNT(e.id)
         LIMIT 25`
      )
    ),
    capDi('extensions_count_mismatches_total', () =>
      executor.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM (
           SELECT r.id
           FROM reservations r
           LEFT JOIN extensions e ON e.reservation_id = r.id
           WHERE r.deleted_at IS NULL
           GROUP BY r.id, r.extensions_count
           HAVING COALESCE(r.extensions_count, 0) <> COUNT(e.id)
         ) sub`
      ),
      [{ cnt: 0 }]
    ),
    capDi('dual_lifecycle_flags', () =>
      executor.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM reservations WHERE deleted_at IS NULL AND COALESCE(is_source_cancelled, FALSE) = TRUE AND COALESCE(is_source_rejected, FALSE) = TRUE`
      ),
      [{ cnt: 0 }]
    ),
    capDi('latest_di_run', () =>
      executor.query(
        `SELECT * FROM data_integrity_runs WHERE status IN ('completed', 'partial') ORDER BY started_at DESC LIMIT 1`
      )
    ),
    capDi('open_di_issues', () =>
      executor.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM data_integrity_issues WHERE resolution_status = 'open'`
      ),
      [{ cnt: 0 }]
    )
  ]);

  const counts = countsQ.rows?.[0] || ({} as any);
  const orphanChildren = orphanFuQ.rows?.[0] || ({ orphan_follow_ups: 0, orphan_assignments: 0, orphan_notes: 0 } as any);
  const custQuality = incompleteCustQ.rows?.[0] || ({ missing_id: 0, missing_phone: 0, missing_email: 0 } as any);
  const latestDi = latestDiQ.rows?.[0] || null;
  const openDiIssues = num(openDiIssuesQ.rows?.[0]?.cnt, 0);

  let rgComparison: any = {
    checkedLive: false,
    rgTotalCount: latestDi ? num(latestDi.rg_total_count, 0) : null,
    neonTotalCount: num(counts.reservations_cnt, 0),
    matchedCount: latestDi ? num(parseJsonSafe<any>(latestDi.summary_json, {})?.matchedCount, 0) : null,
    missingFromNeonCount: null,
    extraInNeonCount: null,
    mismatchedFieldsCount: openDiIssues > 0 ? openDiIssues : null,
    diffPreview: [],
    error: ''
  };

  if (compareWithRg) {
    try {
      const rgSnap = await fetchRentalGateSnapshotReadOnly(executor, {
        scopes: ['reservations', 'extensions', 'cancelled', 'company_changes'],
        maxPages: 80
      });
      const neonResQ = await executor.query(
        `SELECT id, source_reservation_id, reservation_number, reference_number, internal_status, original_status_code, original_status_ar,
                is_source_cancelled, is_source_rejected, customer_name, customer_phone, start_date, end_date, car_name, company_name, extensions_count
         FROM reservations
         WHERE deleted_at IS NULL`
      );
      const cmpOut = typeof crmCore?.compareRgAndNeonReservations === 'function'
        ? crmCore.compareRgAndNeonReservations(rgSnap.reservations || [], neonResQ.rows || [])
        : { issues: [], matchedCount: 0, missingInNeonCount: 0, missingInRgCount: 0, mismatchedCount: 0 };
      const allIssues: any[] = Array.isArray(cmpOut) ? cmpOut : (Array.isArray(cmpOut?.issues) ? cmpOut.issues : []);
      const incompleteEps = rgSnap.incompleteEndpoints || [];
      const filteredIssues = incompleteEps.length > 0
        ? allIssues.filter((i) => i.discrepancyType !== 'missing_in_rg')
        : allIssues;

      const missingCnt = filteredIssues.filter((i) => i.discrepancyType === 'missing_in_neon').length;
      const extraCnt = filteredIssues.filter((i) => i.discrepancyType === 'missing_in_rg' || i.discrepancyType === 'extra_in_neon').length;
      const mismatchCnt = filteredIssues.filter((i) =>
        i.discrepancyType !== 'missing_in_neon' &&
        i.discrepancyType !== 'missing_in_rg' &&
        i.discrepancyType !== 'extra_in_neon'
      ).length;

      const preview = filteredIssues.slice(0, 40).map((it) => ({
        type: str(it.discrepancyType),
        reservationNumber: str(it.reservationNumber),
        fieldName: str(it.fieldName),
        rgValue: str(it.rgValue),
        neonValue: str(it.neonValue)
      }));

      rgComparison = {
        checkedLive: true,
        rgTotalCount: (rgSnap.reservations || []).length,
        neonTotalCount: num(counts.reservations_cnt, 0),
        matchedCount: num(cmpOut?.matchedCount, 0),
        missingFromNeonCount: missingCnt,
        extraInNeonCount: extraCnt,
        mismatchedFieldsCount: mismatchCnt,
        incompleteEndpoints: incompleteEps,
        diffPreview: preview,
        error: ''
      };
    } catch (rgErr: any) {
      rgComparison.error = redactSensitiveText(rgErr?.message || 'RG_COMPARE_FAILED').slice(0, 260);
    }
  }

  const duplicateCount = (dupSrcQ.rows || []).length;
  const swappedCount = (swappedRgQ.rows || []).length;
  const orphanExtensions = num(orphanExtQ.rows?.[0]?.cnt, 0);
  const orphanChildrenTotal = num(orphanChildren.orphan_follow_ups, 0) + num(orphanChildren.orphan_assignments, 0) + num(orphanChildren.orphan_notes, 0);
  const extCounterMismatchCount = Math.max(
    (extMismatchQ.rows || []).length,
    num(extMismatchTotalQ.rows?.[0]?.cnt, 0)
  );
  const missingPhoneCount = num(custQuality.missing_phone, 0);
  const missingIdNumberCount = num(custQuality.missing_id, 0);
  const missingEmailCount = num(custQuality.missing_email, 0);
  const dualLifecycleFlagsCount = num(dualFlagQ.rows?.[0]?.cnt, 0);
  const missingFromNeonCnt = num(rgComparison.missingFromNeonCount, 0);
  const mismatchedFieldsCnt = num(rgComparison.mismatchedFieldsCount, 0);
  const hasIncompleteRgEndpoints = Array.isArray(rgComparison.incompleteEndpoints) && rgComparison.incompleteEndpoints.length > 0;

  let status: HealthStatus = 'healthy';
  if (
    duplicateCount > 0 ||
    swappedCount > 0 ||
    orphanExtensions > 0 ||
    orphanChildrenTotal > 0 ||
    missingFromNeonCnt > 0
  ) {
    status = (duplicateCount > 0 || missingFromNeonCnt > 5 || orphanChildrenTotal > 0) ? 'critical' : 'warning';
  } else if (
    extCounterMismatchCount > 0 ||
    dualLifecycleFlagsCount > 0 ||
    openDiIssues > 0 ||
    mismatchedFieldsCnt > 0 ||
    missingPhoneCount > 0 ||
    hasIncompleteRgEndpoints ||
    Boolean(rgComparison.error) ||
    queryErrors.length > 0
  ) {
    status = 'warning';
  } else if (!rgComparison.checkedLive && !latestDi) {
    status = 'warning';
  }

  const diCheckedAt = new Date().toISOString();
  const diTotalErrors =
    duplicateCount +
    swappedCount +
    orphanExtensions +
    orphanChildrenTotal +
    missingFromNeonCnt +
    openDiIssues +
    queryErrors.length +
    (rgComparison.error ? 1 : 0);
  const diErrorCategory = rgComparison.error
    ? (/401|403|NO_RG_TOKEN/i.test(rgComparison.error) ? 'rg_auth' : 'rg_sync_compare')
    : (duplicateCount > 0 || orphanExtensions > 0 || orphanChildrenTotal > 0 ? 'data_anomaly' : 'none');

  return {
    status,
    checkedAt: diCheckedAt,
    queryErrors,
    lastSuccessfulCheck: latestDi?.finished_at
      ? (latestDi.finished_at instanceof Date ? latestDi.finished_at.toISOString() : str(latestDi.finished_at))
      : (status === 'healthy' ? diCheckedAt : ''),
    latestFailure: rgComparison.error
      ? { message: rgComparison.error, at: diCheckedAt }
      : (queryErrors[0] || null),
    errorCategory: diErrorCategory,
    affectedComponent: 'data_integrity',
    errorCount: diTotalErrors,
    recommendedAction: /401|403|NO_RG_TOKEN/i.test(str(rgComparison.error))
      ? 'تحقق من صلاحية توكن Rental Gate (RG_TOKEN) في الإعدادات أو متغيرات البيئة ثم أعد الفحص.'
      : (openDiIssues > 0
        ? 'راجع الفروقات المفتوحة واعتمد الإصلاحات من لوحة سلامة البيانات.'
        : ''),
    repairHistory: latestDi ? [latestDi] : [],
    counts: {
      reservations: num(counts.reservations_cnt, 0),
      customers: num(counts.customers_cnt, 0),
      extensions: num(counts.extensions_cnt, 0),
      followUps: num(counts.follow_ups_cnt, 0),
      problems: num(counts.problems_cnt, 0),
      customerNotes: num(counts.notes_cnt, 0),
      activeNotifications: num(counts.active_notifs_cnt, 0)
    },
    anomalies: {
      duplicateBookings: dupSrcQ.rows || [],
      swappedRgNumbers: swappedRgQ.rows || [],
      orphanExtensionsCount: orphanExtensions,
      orphanChildren: {
        followUps: num(orphanChildren.orphan_follow_ups, 0),
        assignments: num(orphanChildren.orphan_assignments, 0),
        customerNotes: num(orphanChildren.orphan_notes, 0)
      },
      incompleteCustomers: {
        missingIdNumber: missingIdNumberCount,
        missingPhone: missingPhoneCount,
        missingEmail: missingEmailCount
      },
      customerQuality: {
        required: {
          missingPhone: missingPhoneCount
        },
        optionalSourceGaps: {
          missingIdNumber: missingIdNumberCount,
          missingEmail: missingEmailCount
        }
      },
      extensionCountMismatches: extMismatchQ.rows || [],
      extensionCountMismatchesTotal: extCounterMismatchCount,
      dualLifecycleFlagsCount,
      openIntegrityIssuesCount: openDiIssues
    },
    latestIntegrityRun: latestDi ? {
      id: str(latestDi.id),
      status: str(latestDi.status),
      runMode: str(latestDi.run_mode),
      rgTotalCount: num(latestDi.rg_total_count, 0),
      neonTotalCount: num(latestDi.neon_total_count, 0),
      discrepanciesCount: num(latestDi.discrepancies_count, 0),
      startedAt: latestDi.started_at instanceof Date ? latestDi.started_at.toISOString() : str(latestDi.started_at),
      finishedAt: latestDi.finished_at instanceof Date ? latestDi.finished_at.toISOString() : str(latestDi.finished_at)
    } : null,
    rgComparison
  };
}

async function collectSyncHealth(
  executor: DbExecutor,
  opts: { testLiveConnections?: boolean; fetchFn?: typeof fetch } = {}
) {
  const queryErrors: Array<{ step: string; message: string }> = [];
  const capSync = async <T = any>(step: string, fn: () => Promise<{ rows: T[] }>, fallbackRows: T[] = []) => {
    try {
      return await fn();
    } catch (err: any) {
      queryErrors.push({ step, message: redactSensitiveText(err?.message || 'SYNC_QUERY_FAILED').slice(0, 220) });
      return { rows: fallbackRows };
    }
  };

  const [workerQ, logsQ, cpQ, outboxCountsQ, outboxErrBreakdownQ, outboxCatStatsQ, outboxRecentErrQ, lastOutboxSentQ, syncSecretDiag, rgTokenDiag, serverCfg] = await Promise.all([
    capSync('sync_worker_state', () => executor.query(`SELECT * FROM sync_worker_state WHERE id = 'primary' LIMIT 1`)),
    capSync('sync_log', () => executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20`)),
    capSync('sync_checkpoints', () => executor.query(`SELECT * FROM sync_checkpoints ORDER BY updated_at DESC LIMIT 20`)),
    capSync('outbox_counts', () =>
      executor.query<{
        sent_cnt: number;
        pending_cnt: number;
        processing_cnt: number;
        retry_cnt: number;
        failed_cnt: number;
        permanent_failed_cnt: number;
        oldest_unsynced_at: any;
        total_cnt: number;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_cnt,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_cnt,
           COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_cnt,
           COUNT(*) FILTER (WHERE status = 'retry')::int AS retry_cnt,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_cnt,
           COUNT(*) FILTER (
             WHERE status = 'failed'
               AND (
                 COALESCE(error_category, '') IN ('auth', 'sheet_frozen', 'validation')
                 OR COALESCE(last_error, '') ~* 'UNAUTHORIZED|SYNC_API_SECRET|FORBIDDEN|non-frozen|INVALID_GAS_URL|VALIDATION_ERROR|BLOCKED_BULK_DELETE|HTTP_400|HTTP_401|HTTP_403|HTTP_404|HTTP_422'
               )
           )::int AS permanent_failed_cnt,
           MIN(created_at) FILTER (WHERE status IN ('pending', 'processing', 'retry', 'failed')) AS oldest_unsynced_at,
           COUNT(*)::int AS total_cnt
         FROM sheets_mirror_outbox`
      ).catch(() =>
        executor.query<{
          sent_cnt: number;
          pending_cnt: number;
          processing_cnt: number;
          retry_cnt: number;
          failed_cnt: number;
          permanent_failed_cnt: number;
          oldest_unsynced_at: any;
          total_cnt: number;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_cnt,
             COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_cnt,
             COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_cnt,
             COUNT(*) FILTER (WHERE status = 'retry')::int AS retry_cnt,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_cnt,
             COUNT(*) FILTER (
               WHERE status = 'failed'
                 AND COALESCE(last_error, '') ~* 'UNAUTHORIZED|SYNC_API_SECRET|FORBIDDEN|non-frozen|INVALID_GAS_URL|VALIDATION_ERROR|BLOCKED_BULK_DELETE|HTTP_400|HTTP_401|HTTP_403|HTTP_404|HTTP_422'
             )::int AS permanent_failed_cnt,
             MIN(created_at) FILTER (WHERE status IN ('pending', 'processing', 'retry', 'failed')) AS oldest_unsynced_at,
             COUNT(*)::int AS total_cnt
           FROM sheets_mirror_outbox`
        )
      ),
      [{ sent_cnt: 0, pending_cnt: 0, processing_cnt: 0, retry_cnt: 0, failed_cnt: 0, permanent_failed_cnt: 0, oldest_unsynced_at: null, total_cnt: 0 }]
    ),
    capSync('outbox_breakdown', () =>
      executor.query<{ err: string; cnt: number }>(
        `SELECT COALESCE(NULLIF(TRIM(last_error), ''), 'UNKNOWN_ERROR') AS err, COUNT(*)::int AS cnt
         FROM sheets_mirror_outbox
         WHERE status IN ('failed', 'retry')
         GROUP BY 1
         ORDER BY cnt DESC
         LIMIT 10`
      )
    ),
    capSync('outbox_category_stats', () =>
      executor.query<{ category: string; err: string; cnt: number; first_seen_at: any; last_seen_at: any }>(
        `SELECT
           COALESCE(NULLIF(TRIM(error_category), ''), 'unknown') AS category,
           MIN(COALESCE(NULLIF(TRIM(last_error), ''), 'UNKNOWN_ERROR')) AS err,
           COUNT(*)::int AS cnt,
           MIN(created_at) AS first_seen_at,
           MAX(COALESCE(last_attempt_at, updated_at, created_at)) AS last_seen_at
         FROM sheets_mirror_outbox
         WHERE status IN ('failed', 'retry')
         GROUP BY 1
         ORDER BY cnt DESC
         LIMIT 12`
      ).catch(() => ({ rows: [] as any[] }))
    ),
    capSync('outbox_recent_errors', () =>
      executor.query<{ id: string; entity_type: string; entity_id: string; action: string; status: string; retry_count: number; last_error: string; updated_at: any }>(
        `SELECT id, entity_type, entity_id, action, status, retry_count, last_error, updated_at
         FROM sheets_mirror_outbox
         WHERE status IN ('failed', 'retry')
         ORDER BY updated_at DESC
         LIMIT 20`
      )
    ),
    capSync('outbox_last_sent', () =>
      executor.query<{ sent_at: any; updated_at: any }>(
        `SELECT COALESCE(synced_at, processed_at, updated_at) AS sent_at, updated_at
         FROM sheets_mirror_outbox
         WHERE status = 'sent'
         ORDER BY COALESCE(synced_at, processed_at, updated_at) DESC NULLS LAST
         LIMIT 1`
      )
    ),
    getSyncSecretDiagnostics(executor).catch(() => ({
      configured: false,
      source: 'none' as const,
      length: 0,
      hasEnvWhitespace: false,
      hasQuotes: false,
      hasWhitespace: false
    })),
    getRgTokenDiagnostics(executor).catch(() => ({
      configured: false,
      source: 'none' as const,
      length: 0,
      hasQuotes: false,
      hasWhitespace: false,
      hasBearerPrefix: false
    })),
    resolveServerConfig(executor).catch(() => ({
      rgApiBaseUrl: '',
      rgToken: '',
      gasWebAppUrl: '',
      syncApiSecret: '',
      neonSyncUrl: ''
    }))
  ]);

  let liveChecks: {
    checked: boolean;
    rentalGateAuth: any;
    gasMirrorAuth: any;
  } = {
    checked: false,
    rentalGateAuth: null,
    gasMirrorAuth: null
  };

  if (opts.testLiveConnections || opts.fetchFn) {
    liveChecks.checked = true;
    const hasRgCreds = Boolean(serverCfg.rgToken);
    const hasGasCreds = Boolean(serverCfg.gasWebAppUrl && serverCfg.syncApiSecret);
    const [rgRes, gasRes] = await Promise.all([
      hasRgCreds || opts.fetchFn
        ? testRgApiConnectionSafe(executor, { checkAllEndpoints: false, fetchFn: opts.fetchFn }).catch((e: any) => ({
            ok: false,
            authValid: null,
            configured: hasRgCreds,
            message: redactSensitiveText(e?.message || 'RG_PROBE_ERROR'),
            endpoints: []
          }))
        : Promise.resolve(null),
      hasGasCreds || opts.fetchFn
        ? verifyGasMirrorAuth(executor, opts.fetchFn || fetch).catch((e: any) => ({
            ok: false,
            authValid: null,
            statusCode: 0,
            configured: hasGasCreds,
            legacyGasScript: false,
            message: redactSensitiveText(e?.message || 'GAS_PROBE_ERROR')
          }))
        : Promise.resolve(null)
    ]);
    liveChecks.rentalGateAuth = rgRes;
    liveChecks.gasMirrorAuth = gasRes;
  }

  const w = workerQ.rows?.[0] || null;
  const logs = (logsQ.rows || []).map((l) => ({
    id: str(l.id),
    status: str(l.status),
    triggeredByName: str(l.triggered_by_name),
    importedCount: num(l.imported_count, 0),
    updatedCount: num(l.updated_count, 0),
    extensionsCount: num(l.extensions_count, 0),
    pagesFetched: num(l.pages_fetched, 0),
    durationMs: num(l.duration_ms, 0),
    errorMessage: redactSensitiveText(l.error_message),
    startedAt: l.started_at instanceof Date ? l.started_at.toISOString() : str(l.started_at),
    finishedAt: l.finished_at instanceof Date ? l.finished_at.toISOString() : str(l.finished_at)
  }));

  const checkpoints = (cpQ.rows || []).map((cp) => ({
    source: str(cp.source),
    lastStatus: str(cp.last_status),
    lastBatchCount: num(cp.last_batch_count, 0),
    lastCursor: str(cp.last_cursor),
    lastError: redactSensitiveText(cp.last_error),
    lastSyncAt: cp.last_sync_at instanceof Date ? cp.last_sync_at.toISOString() : str(cp.last_sync_at),
    lastSuccessfulAt: cp.last_successful_at instanceof Date ? cp.last_successful_at.toISOString() : str(cp.last_successful_at)
  }));

  const ob = outboxCountsQ.rows?.[0] || ({
    sent_cnt: 0,
    pending_cnt: 0,
    processing_cnt: 0,
    retry_cnt: 0,
    failed_cnt: 0,
    permanent_failed_cnt: 0,
    oldest_unsynced_at: null,
    total_cnt: 0
  } as any);
  const outboxCategoryBreakdown = (outboxCatStatsQ.rows || []).map((c: any) => ({
    category: str(c.category || 'unknown'),
    sampleError: redactSensitiveText(c.err),
    count: num(c.cnt, 0),
    firstSeenAt: c.first_seen_at instanceof Date ? c.first_seen_at.toISOString() : str(c.first_seen_at),
    lastSeenAt: c.last_seen_at instanceof Date ? c.last_seen_at.toISOString() : str(c.last_seen_at)
  }));
  const outboxBreakdown = (outboxErrBreakdownQ.rows || []).map((b) => {
    const cleanErr = redactSensitiveText(b.err);
    const cls = classifyOutboxMirrorError(cleanErr, 0);
    return {
      error: cleanErr,
      category: cls.category,
      count: num(b.cnt, 0),
      isTransient: !cls.permanent
    };
  });
  const outboxRecentErrors = (outboxRecentErrQ.rows || []).map((e) => ({
    id: str(e.id),
    entityType: str(e.entity_type),
    entityId: str(e.entity_id),
    action: str(e.action),
    status: str(e.status),
    retryCount: num(e.retry_count, 0),
    error: redactSensitiveText(e.last_error),
    updatedAt: e.updated_at instanceof Date ? e.updated_at.toISOString() : str(e.updated_at)
  }));

  const rgCp = checkpoints.find((c) => /rental_gate/i.test(c.source));
  const sheetsCp = checkpoints.find((c) => /sheet|gas|apps_script/i.test(c.source));
  const gasAuthCp = checkpoints.find((c) => c.source === 'google_apps_script_auth');
  const lastSuccessLog = logs.find((l) => l.status === 'success');
  const lastOutboxRow = lastOutboxSentQ.rows?.[0];
  const lastOutboxSentAt = lastOutboxRow?.sent_at instanceof Date
    ? lastOutboxRow.sent_at.toISOString()
    : (lastOutboxRow?.updated_at instanceof Date ? lastOutboxRow.updated_at.toISOString() : str(lastOutboxRow?.sent_at || lastOutboxRow?.updated_at));
  const oldestUnsyncedIso = ob.oldest_unsynced_at instanceof Date
    ? ob.oldest_unsynced_at.toISOString()
    : str(ob.oldest_unsynced_at);
  const oldestUnsyncedAgeMinutes = oldestUnsyncedIso
    ? Math.max(0, Math.round((Date.now() - new Date(oldestUnsyncedIso).getTime()) / 60000))
    : 0;

  const lastSuccessBySource = {
    rentalGateApi: rgCp?.lastSuccessfulAt || (w?.last_success_at instanceof Date ? w.last_success_at.toISOString() : str(w?.last_success_at)) || lastSuccessLog?.finishedAt || '',
    neonPostgres: lastSuccessLog?.finishedAt || (w?.last_success_at instanceof Date ? w.last_success_at.toISOString() : str(w?.last_success_at)) || '',
    googleAppsScriptSheets: sheetsCp?.lastSuccessfulAt || lastOutboxSentAt || ''
  };

  const failedOutbox = num(ob.failed_cnt, 0);
  const permanentFailedOutbox = num(ob.permanent_failed_cnt, 0);
  const processingOutbox = num(ob.processing_cnt, 0);
  const pendingOutbox = num(ob.pending_cnt, 0) + num(ob.retry_cnt, 0) + processingOutbox;
  const consecutiveErrors = num(w?.consecutive_errors, 0);
  const lastLog = logs[0] || null;
  const lastSyncFailed = lastLog && lastLog.status !== 'success';
  const missingMirrorSecretWithQueue = !syncSecretDiag.configured && (pendingOutbox > 0 || failedOutbox > 0);
  const hasSecretFormattingWarning = Boolean(
    syncSecretDiag.hasEnvWhitespace ||
    syncSecretDiag.hasQuotes ||
    syncSecretDiag.hasWhitespace ||
    rgTokenDiag.hasQuotes ||
    rgTokenDiag.hasWhitespace
  );
  const rgAuthFailedLive = liveChecks.rentalGateAuth?.authValid === false;
  const gasAuthFailedLive = liveChecks.gasMirrorAuth?.authValid === false;
  const deploySkewWarning = liveChecks.gasMirrorAuth?.legacyGasScript
    ? str(liveChecks.gasMirrorAuth.message)
    : (gasAuthCp && gasAuthCp.lastStatus === 'warning' && /قديمة|verifyMirrorAuth/i.test(gasAuthCp.lastError)
      ? gasAuthCp.lastError
      : '');

  let status: HealthStatus = 'healthy';
  if (
    consecutiveErrors >= 3 ||
    (lastSyncFailed && !w?.last_success_at) ||
    rgAuthFailedLive ||
    (gasAuthFailedLive && permanentFailedOutbox > 0)
  ) {
    status = 'critical';
  } else if (
    failedOutbox > 0 ||
    pendingOutbox > 20 ||
    consecutiveErrors > 0 ||
    lastSyncFailed ||
    missingMirrorSecretWithQueue ||
    hasSecretFormattingWarning ||
    gasAuthFailedLive ||
    Boolean(deploySkewWarning) ||
    queryErrors.length > 0
  ) {
    status = 'warning';
  } else if (!w && logs.length === 0 && checkpoints.length === 0) {
    status = 'warning';
  }

  const syncCheckedAt = new Date().toISOString();
  const latestSyncFailureMsg =
    (rgAuthFailedLive ? str(liveChecks.rentalGateAuth?.message) : '') ||
    (gasAuthFailedLive ? str(liveChecks.gasMirrorAuth?.message) : '') ||
    str(w?.last_error) ||
    (lastSyncFailed ? lastLog?.errorMessage : '') ||
    str(outboxRecentErrors[0]?.error);

  const syncErrorCategory = rgAuthFailedLive
    ? 'rg_auth'
    : (gasAuthFailedLive
      ? 'gas_auth'
      : (/401|403|NO_RG_TOKEN|Token is malformed/i.test(latestSyncFailureMsg)
        ? 'rg_auth'
        : (/UNAUTHORIZED|SYNC_API_SECRET/i.test(latestSyncFailureMsg)
          ? 'gas_auth'
          : (permanentFailedOutbox > 0
            ? 'outbox_permanent'
            : (failedOutbox > 0 ? 'outbox_retry' : (consecutiveErrors > 0 ? 'worker_sync' : 'none'))))));

  const syncRecommendedAction = rgAuthFailedLive || /401|403|NO_RG_TOKEN|Token is malformed/i.test(latestSyncFailureMsg)
    ? 'حدّث RG_TOKEN في متغيرات البيئة (Vercel) وScript Properties وتأكد من عدم وجود مسافات أو علامات اقتباس أو تكرار Bearer.'
    : (gasAuthFailedLive || /UNAUTHORIZED|SYNC_API_SECRET/i.test(latestSyncFailureMsg)
      ? 'طابِق SYNC_API_SECRET بين Backend (Vercel/.env) وGoogle Apps Script (Script Properties) وأعد نشر GAS قبل إعادة محاولة Outbox.'
      : (failedOutbox > 0
        ? 'راجع تصنيف أخطاء Outbox الفاشلة وتحقق من مصادقة GAS ثم أعد المعالجة على دفعات صغيرة آمنة.'
        : (deploySkewWarning || (hasSecretFormattingWarning
          ? 'يحتوي توكن أو مفتاح المزامنة على مسافات أو علامات اقتباس في البيئة — يتم تنظيفه تلقائياً لكن يُنصح بتنظيف القيمة المخزنة.'
          : ''))));

  return {
    status,
    checkedAt: syncCheckedAt,
    queryErrors,
    liveChecks,
    deploySkewWarning,
    lastSuccessBySource,
    lastSuccessfulCheck: lastSuccessBySource.rentalGateApi || lastSuccessBySource.neonPostgres || '',
    latestFailure: latestSyncFailureMsg
      ? {
          message: redactSensitiveText(latestSyncFailureMsg),
          at: (w?.last_run_at instanceof Date ? w.last_run_at.toISOString() : str(w?.last_run_at)) ||
            lastLog?.finishedAt ||
            outboxRecentErrors[0]?.updatedAt ||
            syncCheckedAt
        }
      : null,
    errorCategory: syncErrorCategory,
    affectedComponent: 'sync_pipeline',
    errorCount: failedOutbox + consecutiveErrors + queryErrors.length + (rgAuthFailedLive ? 1 : 0) + (gasAuthFailedLive ? 1 : 0),
    recommendedAction: syncRecommendedAction,
    repairHistory: logs.slice(0, 5),
    syncSecretDiagnostics: {
      configured: Boolean(syncSecretDiag.configured),
      source: syncSecretDiag.source,
      length: num(syncSecretDiag.length, 0),
      hasEnvWhitespace: Boolean(syncSecretDiag.hasEnvWhitespace),
      hasQuotes: Boolean(syncSecretDiag.hasQuotes),
      hasWhitespace: Boolean(syncSecretDiag.hasWhitespace)
    },
    rgTokenDiagnostics: {
      configured: Boolean(rgTokenDiag.configured),
      source: rgTokenDiag.source,
      length: num(rgTokenDiag.length, 0),
      hasQuotes: Boolean(rgTokenDiag.hasQuotes),
      hasWhitespace: Boolean(rgTokenDiag.hasWhitespace),
      hasBearerPrefix: Boolean(rgTokenDiag.hasBearerPrefix)
    },
    worker: w ? {
      status: str(w.status || 'stopped'),
      isSyncing: Boolean(w.is_syncing),
      autoSyncEnabled: Boolean(w.auto_sync_enabled),
      intervalSeconds: num(w.interval_seconds, 0),
      lastRunAt: w.last_run_at instanceof Date ? w.last_run_at.toISOString() : str(w.last_run_at),
      lastSuccessAt: w.last_success_at instanceof Date ? w.last_success_at.toISOString() : str(w.last_success_at),
      nextRunAt: w.next_run_at instanceof Date ? w.next_run_at.toISOString() : str(w.next_run_at),
      lastDurationMs: num(w.last_duration_ms, 0),
      lastImportedCount: num(w.last_imported_count, 0),
      lastUpdatedCount: num(w.last_updated_count, 0),
      lastExtensionsCount: num(w.last_extensions_count, 0),
      errorCount: num(w.error_count, 0),
      consecutiveErrors,
      lastError: redactSensitiveText(w.last_error),
      lastTriggerType: str(w.last_trigger_type),
      workerHeartbeatAt: w.worker_heartbeat_at instanceof Date ? w.worker_heartbeat_at.toISOString() : str(w.worker_heartbeat_at)
    } : null,
    latestSync: lastLog,
    recentLogs: logs,
    checkpoints,
    outbox: {
      total: num(ob.total_cnt, 0),
      sent: num(ob.sent_cnt, 0),
      pending: num(ob.pending_cnt, 0),
      processing: processingOutbox,
      retry: num(ob.retry_cnt, 0),
      failed: failedOutbox,
      permanentFailed: permanentFailedOutbox,
      oldestUnsyncedAt: oldestUnsyncedIso,
      oldestUnsyncedAgeMinutes,
      errorBreakdown: outboxBreakdown,
      categoryBreakdown: outboxCategoryBreakdown,
      recentErrors: outboxRecentErrors
    }
  };
}

export interface HealthErrorGroup {
  id: string;
  bucket: 'active' | 'historical' | 'resolved';
  errorCategory: string;
  affectedService: string;
  sampleMessage: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSuccessfulOperation: string;
  suggestedFix: string;
}

export interface HealthErrorDigest {
  active: HealthErrorGroup[];
  historical: HealthErrorGroup[];
  resolved: HealthErrorGroup[];
  counts: { active: number; historical: number; resolved: number };
}

function normalizeErrSignature(msg: string): string {
  return redactSensitiveText(msg)
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[^\s]*/g, '<TS>')
    .replace(/\b[A-Z]{2,6}_[A-Z0-9_]{6,}\b/g, '<ID>')
    .replace(/\$\d+/g, '$N')
    .replace(/\b\d+\b/g, '#')
    .trim()
    .slice(0, 140);
}

function inferAffectedServiceAndFix(context: string, action: string, msg: string): {
  category: string;
  service: string;
  fix: string;
} {
  const combined = `${context} ${action} ${msg}`;
  if (/RG_API_HTTP_401|Token is malformed|NO_RG_TOKEN|rgApiClient|pullFromRentalGate/i.test(combined)) {
    return {
      category: 'rg_auth',
      service: 'Rental Gate API',
      fix: 'تأكد من صحة RG_TOKEN وتنسيقه بدون علامات اقتباس أو مسافات أو تكرار Bearer في بيئة الإنتاج وScript Properties.'
    };
  }
  if (/UNAUTHORIZED|SYNC_API_SECRET|verifyGasMirrorAuth|google_apps_script_auth/i.test(combined)) {
    return {
      category: 'gas_auth',
      service: 'Google Apps Script',
      fix: 'طابِق SYNC_API_SECRET بين Backend (Vercel/.env) وScript Properties في Apps Script ثم اختبر المصادقة.'
    };
  }
  if (/non-frozen/i.test(combined)) {
    return {
      category: 'sheet_frozen',
      service: 'Google Sheets Mirror',
      fix: 'حدّث Database.gs وReservations.gs لحماية الصفوف المجمدة واستخدام clearContent() قبل أي حذف.'
    };
  }
  if (/inconsistent types deduced|parameter \$\d+|25P02|sql|postgres|syntax error/i.test(combined)) {
    return {
      category: 'sql_parameter',
      service: 'Neon PostgreSQL',
      fix: 'تأكد من إضافة التحويل الصريح للأنواع (::text / ::timestamptz / ::int) في الاستعلام المتأثر.'
    };
  }
  if (/outbox|flushSheetsMirrorOutbox/i.test(combined)) {
    return {
      category: 'sync_outbox',
      service: 'Google Apps Script / Outbox',
      fix: 'تحقق من مصادقة GAS ورابط Web App ثم أعد معالجة الدفعات الفاشلة تدريجياً.'
    };
  }
  return {
    category: 'runtime',
    service: context || 'CRM Backend',
    fix: 'راجع سجل الخطأ وأعد تشغيل الفحص بعد تطبيق التحديث.'
  };
}

export function buildHealthErrorDigest(
  sections: Partial<Record<HealthSectionKey, any>> = {},
  nowIso = new Date().toISOString()
): HealthErrorDigest {
  const activeMap = new Map<string, HealthErrorGroup>();
  const historicalMap = new Map<string, HealthErrorGroup>();
  const resolvedMap = new Map<string, HealthErrorGroup>();

  const pushGroup = (targetMap: Map<string, HealthErrorGroup>, g: HealthErrorGroup) => {
    const key = `${g.bucket}|${g.affectedService}|${g.errorCategory}|${normalizeErrSignature(g.sampleMessage)}`;
    const prev = targetMap.get(key);
    if (!prev) {
      targetMap.set(key, { ...g, sampleMessage: redactSensitiveText(g.sampleMessage).slice(0, 260) });
      return;
    }
    prev.occurrences += g.occurrences;
    if (g.firstSeenAt && (!prev.firstSeenAt || g.firstSeenAt < prev.firstSeenAt)) prev.firstSeenAt = g.firstSeenAt;
    if (g.lastSeenAt && (!prev.lastSeenAt || g.lastSeenAt > prev.lastSeenAt)) prev.lastSeenAt = g.lastSeenAt;
    if (g.lastSuccessfulOperation && (!prev.lastSuccessfulOperation || g.lastSuccessfulOperation > prev.lastSuccessfulOperation)) {
      prev.lastSuccessfulOperation = g.lastSuccessfulOperation;
    }
  };

  const dbH = sections.database_health || {};
  const scH = sections.schema_integrity || {};
  const diH = sections.data_integrity || {};
  const syH = sections.sync_health || {};

  const lastRgSuccess = str(syH?.lastSuccessBySource?.rentalGateApi);
  const lastNeonSuccess = str(syH?.lastSuccessBySource?.neonPostgres || dbH?.lastSuccessAt);
  const lastGasSuccess = str(syH?.lastSuccessBySource?.googleAppsScriptSheets);

  // 1. Outbox failures (always ACTIVE until outbox rows leave failed/retry)
  const catStats: any[] = Array.isArray(syH?.outbox?.categoryBreakdown) ? syH.outbox.categoryBreakdown : [];
  if (catStats.length > 0) {
    for (const c of catStats) {
      const cat = str(c.category || 'unknown');
      const info = inferAffectedServiceAndFix('outbox', cat, str(c.sampleError));
      pushGroup(activeMap, {
        id: `ERR_OBX_${cat}`,
        bucket: 'active',
        errorCategory: cat === 'unknown' ? info.category : cat,
        affectedService: info.service,
        sampleMessage: str(c.sampleError || 'OUTBOX_FAILED'),
        occurrences: Math.max(1, num(c.count, 1)),
        firstSeenAt: str(c.firstSeenAt || nowIso),
        lastSeenAt: str(c.lastSeenAt || nowIso),
        lastSuccessfulOperation: lastGasSuccess,
        suggestedFix: info.fix
      });
    }
  } else if (Array.isArray(syH?.outbox?.errorBreakdown)) {
    for (const b of syH.outbox.errorBreakdown) {
      const info = inferAffectedServiceAndFix('outbox', str(b.category), str(b.error));
      pushGroup(activeMap, {
        id: `ERR_OBX_BRK`,
        bucket: 'active',
        errorCategory: str(b.category || info.category),
        affectedService: info.service,
        sampleMessage: str(b.error),
        occurrences: Math.max(1, num(b.count, 1)),
        firstSeenAt: str(syH.outbox.oldestUnsyncedAt || nowIso),
        lastSeenAt: nowIso,
        lastSuccessfulOperation: lastGasSuccess,
        suggestedFix: info.fix
      });
    }
  }

  // 2. Live auth probes & RG compare errors
  if (syH?.liveChecks?.rentalGateAuth?.authValid === false) {
    pushGroup(activeMap, {
      id: 'ERR_LIVE_RG_AUTH',
      bucket: 'active',
      errorCategory: 'rg_auth',
      affectedService: 'Rental Gate API',
      sampleMessage: str(syH.liveChecks.rentalGateAuth.message || 'RG_API_HTTP_401'),
      occurrences: 1,
      firstSeenAt: str(syH.checkedAt || nowIso),
      lastSeenAt: str(syH.checkedAt || nowIso),
      lastSuccessfulOperation: lastRgSuccess,
      suggestedFix: 'حدّث RG_TOKEN في متغيرات البيئة وScript Properties وتأكد من إزالة علامات الاقتباس وBearer المكررة.'
    });
  }
  if (syH?.liveChecks?.gasMirrorAuth?.authValid === false) {
    pushGroup(activeMap, {
      id: 'ERR_LIVE_GAS_AUTH',
      bucket: 'active',
      errorCategory: 'gas_auth',
      affectedService: 'Google Apps Script',
      sampleMessage: str(syH.liveChecks.gasMirrorAuth.message || 'UNAUTHORIZED: SYNC_API_SECRET mismatch'),
      occurrences: 1,
      firstSeenAt: str(syH.checkedAt || nowIso),
      lastSeenAt: str(syH.checkedAt || nowIso),
      lastSuccessfulOperation: lastGasSuccess,
      suggestedFix: 'طابِق SYNC_API_SECRET في Vercel/Backend وGoogle Apps Script Script Properties ثم أعد اختبار المصادقة.'
    });
  }
  if (syH?.deploySkewWarning) {
    pushGroup(activeMap, {
      id: 'ERR_GAS_DEPLOY_SKEW',
      bucket: 'active',
      errorCategory: 'deploy_skew',
      affectedService: 'Google Apps Script',
      sampleMessage: str(syH.deploySkewWarning),
      occurrences: 1,
      firstSeenAt: str(syH.checkedAt || nowIso),
      lastSeenAt: str(syH.checkedAt || nowIso),
      lastSuccessfulOperation: lastGasSuccess,
      suggestedFix: 'انسخ تحديثات Code.gs وNeonSync.gs وDatabase.gs إلى محرر Google Apps Script ثم أنشئ Deployment جديداً.'
    });
  }
  if (diH?.rgComparison?.error) {
    const msg = str(diH.rgComparison.error);
    const info = inferAffectedServiceAndFix('data_integrity', 'rg_compare', msg);
    pushGroup(activeMap, {
      id: 'ERR_DI_RG',
      bucket: 'active',
      errorCategory: info.category,
      affectedService: info.service,
      sampleMessage: msg,
      occurrences: 1,
      firstSeenAt: str(diH.checkedAt || nowIso),
      lastSeenAt: str(diH.checkedAt || nowIso),
      lastSuccessfulOperation: lastRgSuccess,
      suggestedFix: info.fix
    });
  }

  // 3. Schema integrity active issues
  const schemaDiffCount =
    (scH?.missingTables?.length || 0) +
    (scH?.missingColumns?.length || 0) +
    (scH?.pendingMigrations?.length || 0) +
    (scH?.constraintMismatches?.length || 0);
  if (schemaDiffCount > 0) {
    pushGroup(activeMap, {
      id: 'ERR_SCHEMA_DIFF',
      bucket: 'active',
      errorCategory: 'schema_integrity',
      affectedService: 'Neon PostgreSQL Schema',
      sampleMessage: `اختلاف بنية القاعدة: جداول مفقودة=${scH?.missingTables?.length || 0} · أعمدة=${scH?.missingColumns?.length || 0} · قيود=${scH?.constraintMismatches?.length || 0} · migrations معلقة=${scH?.pendingMigrations?.length || 0}`,
      occurrences: schemaDiffCount,
      firstSeenAt: str(scH.checkedAt || nowIso),
      lastSeenAt: str(scH.checkedAt || nowIso),
      lastSuccessfulOperation: lastNeonSuccess,
      suggestedFix: 'شغّل التهيئة والترحيلات الآمنة (Migrations) أو طابق Schema مع backend/schemaSql.ts.'
    });
  }

  // 4. Sync logs & checkpoints
  const logs: any[] = Array.isArray(syH?.recentLogs) ? syH.recentLogs : [];
  const newestSuccessLogAt = str(logs.find((l) => l.status === 'success')?.finishedAt || lastRgSuccess);
  for (const log of logs) {
    if (!log || log.status === 'success') continue;
    const msg = str(log.errorMessage || `SYNC_${log.status}`);
    const logAt = str(log.finishedAt || log.startedAt || nowIso);
    const isSupersededBySuccess = Boolean(newestSuccessLogAt && logAt && newestSuccessLogAt > logAt);
    const info = inferAffectedServiceAndFix('sync_log', log.status, msg);
    const bucket: 'active' | 'resolved' = isSupersededBySuccess ? 'resolved' : 'active';
    pushGroup(bucket === 'resolved' ? resolvedMap : activeMap, {
      id: `ERR_SYNCLOG_${str(log.id)}`,
      bucket,
      errorCategory: info.category,
      affectedService: info.service,
      sampleMessage: msg,
      occurrences: 1,
      firstSeenAt: logAt,
      lastSeenAt: logAt,
      lastSuccessfulOperation: newestSuccessLogAt,
      suggestedFix: info.fix
    });
  }

  // 5. Server error_logs grouped into Active vs Historical vs Resolved
  const dbRecentErrs: any[] = Array.isArray(dbH?.recentErrors) ? dbH.recentErrors : [];
  for (const er of dbRecentErrs) {
    if (!er) continue;
    const msg = str(er.message);
    if (!msg) continue;
    const erAt = str(er.createdAt || nowIso);
    const info = inferAffectedServiceAndFix(str(er.context), str(er.action), msg);
    const serviceSuccessAt = /Rental Gate/i.test(info.service)
      ? lastRgSuccess
      : (/Apps Script|Sheets|Outbox/i.test(info.service) ? lastGasSuccess : lastNeonSuccess);
    const isResolvedBySuccess = Boolean(serviceSuccessAt && erAt && serviceSuccessAt > erAt);
    const erMs = Date.parse(erAt);
    const isOldHistorical = Number.isFinite(erMs) && Date.now() - erMs > 24 * 60 * 60 * 1000;
    const bucket: 'active' | 'historical' | 'resolved' = isResolvedBySuccess
      ? 'resolved'
      : (isOldHistorical ? 'historical' : 'active');
    const targetMap = bucket === 'active' ? activeMap : (bucket === 'historical' ? historicalMap : resolvedMap);
    pushGroup(targetMap, {
      id: `ERR_LOG_${str(er.id)}`,
      bucket,
      errorCategory: info.category,
      affectedService: info.service,
      sampleMessage: msg,
      occurrences: 1,
      firstSeenAt: erAt,
      lastSeenAt: erAt,
      lastSuccessfulOperation: serviceSuccessAt,
      suggestedFix: info.fix
    });
  }

  const sortRecent = (a: HealthErrorGroup, b: HealthErrorGroup) => b.lastSeenAt.localeCompare(a.lastSeenAt);
  const active = Array.from(activeMap.values()).sort(sortRecent);
  const historical = Array.from(historicalMap.values()).sort(sortRecent);
  const resolved = Array.from(resolvedMap.values()).sort(sortRecent);

  return {
    active,
    historical,
    resolved,
    counts: {
      active: active.length,
      historical: historical.length,
      resolved: resolved.length
    }
  };
}

function formatHealthRunRow(row: any) {
  if (!row) return null;
  const sections = parseJsonSafe<Record<string, any>>(row.sections_json, {});
  const summary = parseJsonSafe<Record<string, any>>(row.summary_json, {});
  const errorDigest = summary.errorDigest && typeof summary.errorDigest === 'object'
    ? summary.errorDigest
    : buildHealthErrorDigest(sections, row.finished_at instanceof Date ? row.finished_at.toISOString() : str(row.finished_at));
  return {
    id: str(row.id),
    scope: str(row.scope || 'all'),
    overallStatus: str(row.overall_status || 'unknown') as HealthStatus,
    triggeredById: str(row.triggered_by_id),
    triggeredByName: str(row.triggered_by_name),
    durationMs: num(row.duration_ms, 0),
    summary,
    sections,
    errorDigest,
    errorMessage: redactSensitiveText(row.error_message),
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : str(row.started_at),
    finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : str(row.finished_at)
  };
}

export async function getDatabaseHealthCenterReport(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertHealthCenterAccess(session);
  const runId = str(payload.runId);

  const [runsQ, setQ] = await Promise.all([
    executor.query(`SELECT * FROM health_center_runs ORDER BY started_at DESC LIMIT 20`).catch(() => ({ rows: [] as any[] })),
    executor.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'db_health_center_settings' LIMIT 1`).catch(() => ({ rows: [] as any[] }))
  ]);

  const history = (runsQ.rows || []).map(formatHealthRunRow).filter(Boolean) as any[];
  const activeRun = (runId ? history.find((r) => r.id === runId) : null) || history[0] || null;
  const settings = normalizeHealthCenterSettings(setQ.rows?.[0]?.value);

  const emptySection = { status: 'unknown' as HealthStatus, checkedAt: '' };
  const sections = activeRun
    ? activeRun.sections
    : {
        database_health: { ...emptySection },
        schema_integrity: { ...emptySection },
        data_integrity: { ...emptySection },
        sync_health: { ...emptySection }
      };

  const errorDigest = activeRun?.errorDigest || buildHealthErrorDigest(sections);
  const overallStatus = activeRun ? calculateHealthCenterOverallStatus(sections, errorDigest) : 'unknown';

  return {
    overallStatus,
    hasScanned: Boolean(activeRun),
    latestRun: activeRun,
    history,
    sections,
    errorDigest,
    settings,
    poolSnapshot: getPoolMetrics()
  };
}

export async function runDatabaseHealthCenterScan(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertHealthCenterAccess(session);
  const reqScope = str(payload.section || payload.scope || 'all').toLowerCase();
  const validScopes = new Set(['all', 'database_health', 'schema_integrity', 'data_integrity', 'sync_health']);
  const scope = validScopes.has(reqScope) ? reqScope : 'all';
  const compareWithRg = payload.compareWithRg !== undefined
    ? Boolean(payload.compareWithRg)
    : (scope === 'all' || scope === 'data_integrity');
  const testLiveConnections = payload.testLiveConnections !== undefined
    ? Boolean(payload.testLiveConnections)
    : Boolean(payload.compareWithRg === true);

  const startedAtMs = Date.now();
  const startedIso = new Date(startedAtMs).toISOString();
  const runId = generateId('DHC');

  const prevRunQ = await executor.query(
    `SELECT * FROM health_center_runs ORDER BY started_at DESC LIMIT 1`
  ).catch(() => ({ rows: [] as any[] }));
  const prevSections = prevRunQ.rows?.[0]
    ? parseJsonSafe<Record<string, any>>(prevRunQ.rows[0].sections_json, {})
    : {};

  const sections: Record<string, any> = {
    database_health: prevSections.database_health || { status: 'unknown', checkedAt: '' },
    schema_integrity: prevSections.schema_integrity || { status: 'unknown', checkedAt: '' },
    data_integrity: prevSections.data_integrity || { status: 'unknown', checkedAt: '' },
    sync_health: prevSections.sync_health || { status: 'unknown', checkedAt: '' }
  };

  if (scope === 'all' || scope === 'database_health') {
    sections.database_health = await collectDatabaseHealth(executor);
  }
  if (scope === 'all' || scope === 'schema_integrity') {
    sections.schema_integrity = await collectSchemaIntegrity(executor);
  }
  if (scope === 'all' || scope === 'data_integrity') {
    sections.data_integrity = await collectDataIntegritySection(executor, compareWithRg);
  }
  if (scope === 'all' || scope === 'sync_health') {
    sections.sync_health = await collectSyncHealth(executor, { testLiveConnections });
  }

  const errorDigest = buildHealthErrorDigest(sections, new Date().toISOString());
  const overallStatus = calculateHealthCenterOverallStatus(sections, errorDigest);
  const finishedAtMs = Date.now();
  const durationMs = Math.max(1, finishedAtMs - startedAtMs);
  const finishedIso = new Date(finishedAtMs).toISOString();

  const summary = {
    scope,
    overallStatus,
    latencyMs: num(sections.database_health?.latencyMs, 0),
    totalTables: num(sections.schema_integrity?.totalTables, 0),
    totalColumns: num(sections.schema_integrity?.totalColumns, 0),
    totalConstraints: num(sections.schema_integrity?.totalConstraints, 0),
    constraintMismatchesCount: (sections.schema_integrity?.constraintMismatches || []).length,
    missingColumnsCount: (sections.schema_integrity?.missingColumns || []).length,
    reservationsCount: num(sections.data_integrity?.counts?.reservations, 0),
    failedOutboxCount: num(sections.sync_health?.outbox?.failed, 0),
    activeErrorsCount: errorDigest.counts.active,
    historicalErrorsCount: errorDigest.counts.historical,
    resolvedErrorsCount: errorDigest.counts.resolved,
    errorDigest,
    durationMs
  };

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO health_center_runs (
         id, scope, overall_status, triggered_by_id, triggered_by_name, duration_ms,
         summary_json, sections_json, error_message, started_at, finished_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'',$9::timestamptz,$10::timestamptz)`,
      [
        runId,
        scope,
        overallStatus,
        str(session.user.id),
        str(session.user.name || session.username),
        durationMs,
        JSON.stringify(summary),
        JSON.stringify(sections),
        startedIso,
        finishedIso
      ]
    );
    await logHealthCenterActivity(
      tx,
      session.user,
      `فحص مركز صحة قاعدة البيانات (${scope})`,
      runId,
      `الحالة: ${overallStatus} · المدة: ${durationMs}ms · الجداول: ${summary.totalTables} · أخطاء نشطة: ${errorDigest.counts.active}`
    );
  });

  return getDatabaseHealthCenterReport(executor, session, { runId });
}

export async function saveHealthCenterSettings(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertHealthCenterAccess(session);
  const next = normalizeHealthCenterSettings(payload.settings || payload);
  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('db_health_center_settings', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(next), str(session.user.name || session.username)]
    );
    await logHealthCenterActivity(
      tx,
      session.user,
      'تحديث إعدادات مركز صحة قاعدة البيانات',
      'db_health_center_settings',
      `التحديث التلقائي: ${next.autoRefreshEnabled ? 'مفعل' : 'متوقف'} · كل ${next.autoRefreshIntervalSec} ثانية`
    );
  });
  return { settings: next };
}

export async function verifyGasMirrorAuthAction(
  executor: DbExecutor,
  session: AuthSession
) {
  assertHealthCenterAccess(session);
  const authResult = await verifyGasMirrorAuth(executor);
  await logHealthCenterActivity(
    executor,
    session.user,
    'فحص مصادقة Google Apps Script',
    'google_apps_script_auth',
    authResult.message
  );
  return authResult;
}

export async function retryHealthCenterFailedSync(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertHealthCenterAccess(session);
  const mode = str(payload.mode || 'outbox_transient').toLowerCase();
  const limit = Math.min(25, Math.max(1, num(payload.limit || payload.batchSize, 15)));

  if (mode === 'rg_missing_records') {
    const syncRes = await retryFailedSyncRecords(executor, session.user, payload);
    await logHealthCenterActivity(
      executor,
      session.user,
      'إعادة محاولة المزامنة من مركز صحة قاعدة البيانات',
      'rg_missing_records',
      `استعادة السجلات الناقصة من Rental Gate API`
    );
    return { mode, syncRes };
  }

  const cfg = await resolveServerConfig(executor).catch(() => ({ gasWebAppUrl: '', syncApiSecret: '' } as any));
  const gasConfigured = Boolean(str(cfg.gasWebAppUrl) && str(cfg.syncApiSecret));

  if (gasConfigured || mode === 'outbox_batch' || mode === 'outbox_auth' || mode === 'outbox_sheet_frozen') {
    const batchMode = mode === 'outbox_auth'
      ? 'auth'
      : (mode === 'outbox_sheet_frozen'
        ? 'sheet_frozen'
        : (mode === 'outbox_all_failed' ? 'all' : 'transient'));
    const batchRes = await reprocessFailedOutboxBatch(executor, {
      mode: batchMode,
      batchSize: limit,
      maxBatches: Math.min(5, Math.max(1, num(payload.maxBatches, 1)))
    });
    if (batchRes.haltedByAuth) {
      throw new Error(batchRes.authCheck?.message || 'UNAUTHORIZED: تعذر التحقق من SYNC_API_SECRET في Google Apps Script.');
    }
    await logHealthCenterActivity(
      executor,
      session.user,
      'إعادة معالجة دفعة Outbox الآمنة',
      mode,
      `أُعيدت جدولة ${batchRes.requeuedCount} عملية · أُرسل: ${batchRes.sent} · فشل: ${batchRes.failed}`
    );
    return {
      mode,
      requeuedCount: batchRes.requeuedCount,
      flushResult: {
        sent: batchRes.sent,
        failed: batchRes.failed,
        skipped: false,
        haltedByAuth: batchRes.haltedByAuth
      },
      authCheck: batchRes.authCheck
    };
  }

  // Fallback for offline/unit tests where GAS URL is not configured in DB settings
  const whereTransient = mode === 'outbox_all_failed'
    ? `status IN ('failed', 'retry')`
    : `status IN ('failed', 'retry') AND COALESCE(last_error, '') !~* 'UNAUTHORIZED|SYNC_API_SECRET|FORBIDDEN|non-frozen|INVALID_GAS_URL|VALIDATION_ERROR|BLOCKED_BULK_DELETE|HTTP_400|HTTP_401|HTTP_403|HTTP_404|HTTP_422'`;

  const resetQ = await executor.query<{ id: string }>(
    `WITH picked AS (
       SELECT id FROM sheets_mirror_outbox
       WHERE ${whereTransient}
       ORDER BY created_at ASC, id ASC
       LIMIT $1
     )
     UPDATE sheets_mirror_outbox o
     SET status = 'pending',
         retry_count = 0,
         next_retry_at = NOW(),
         locked_at = NULL,
         worker_id = '',
         updated_at = NOW()
     FROM picked
     WHERE o.id = picked.id
     RETURNING o.id`,
    [limit]
  );
  const requeuedCount = (resetQ.rows || []).length;
  const flushResult = { sent: 0, failed: 0, skipped: true };

  await logHealthCenterActivity(
    executor,
    session.user,
    'إعادة محاولة Outbox المزامنة',
    mode,
    `تمت إعادة جدولة ${requeuedCount} عملية · أُرسل: 0 (GAS غير مهيأ)`
  );

  return {
    mode,
    requeuedCount,
    flushResult
  };
}
