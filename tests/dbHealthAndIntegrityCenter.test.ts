import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crmCore, hashToken, type AuthSession } from '../backend/auth';
import {
  AUDIT_AND_HEALTH_MIGRATIONS,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from '../backend/db';
import { SCHEMA_SQL } from '../backend/schemaSql';
import { redactSensitiveText } from '../backend/logger';
import { getDataIntegrityReport, runDataIntegrityCheck } from '../backend/integrityService';
import { fetchRentalGateSnapshotReadOnly } from '../backend/syncService';
import { dispatchCrmRequest } from '../backend/router';
import {
  calculateHealthCenterOverallStatus,
  diffSchemaManifest,
  getDatabaseHealthCenterReport,
  parseSchemaManifestFromSql,
  retryHealthCenterFailedSync,
  runDatabaseHealthCenterScan
} from '../backend/healthCenter';

function makeSession(role: string, permissions: string[] = []): AuthSession {
  const nowIso = new Date().toISOString();
  return {
    tokenHash: 'test-hash',
    employeeId: `EMP_${role.toUpperCase()}`,
    username: role,
    role,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: `EMP_${role.toUpperCase()}`,
      name: `${role} User`,
      username: role,
      phone: '',
      email: '',
      jobTitle: role,
      role,
      permissions,
      status: 'active',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  };
}

function createDevSession(): AuthSession {
  return makeSession('developer', ['manage_developer_tools', 'manage_settings', 'sync_data', 'view_reservations']);
}

function createMockExecutor(
  handler: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>
): DbExecutor {
  const query = async <T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const res = await handler(sql, params);
    return res as QueryResult<T>;
  };
  return {
    query,
    async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
      return fn({ query });
    }
  };
}

test('schemaSql.ts matches database/schema.sql and coreBridge.cjs matches assets/js/core.js', () => {
  const rootDir = process.cwd();
  const schemaDisk = fs.readFileSync(path.join(rootDir, 'database', 'schema.sql'), 'utf8').trim();
  assert.equal(SCHEMA_SQL.trim(), schemaDisk, 'Expected backend/schemaSql.ts to match database/schema.sql');

  const coreDisk = fs.readFileSync(path.join(rootDir, 'assets', 'js', 'core.js'), 'utf8').trim();
  const bridgeDisk = fs.readFileSync(path.join(rootDir, 'backend', 'coreBridge.cjs'), 'utf8').trim();
  assert.equal(bridgeDisk, coreDisk, 'Expected backend/coreBridge.cjs to stay synchronized with assets/js/core.js');

  assert.ok(
    AUDIT_AND_HEALTH_MIGRATIONS.some((m) => m.id === '2026_11_27_005_audit_indexes_and_constraints'),
    'Expected migration 005 in AUDIT_AND_HEALTH_MIGRATIONS'
  );
});

test('compareRgAndNeonReservations matches swapped #474 and RG-... keys accurately without false zero/missing', () => {
  const rgRows = [
    {
      id: 474,
      reservation_number: 'RG-20261014-215136-5432',
      reference_number: '474',
      status: 'confirmed',
      status_ar: 'مؤكد',
      customer: { name: 'أحمد خالد', mobile: '0501234567' },
      pickup_date: '2026-10-14',
      return_date: '2026-10-18',
      car: { name: 'Camry 2026' },
      company: { name: 'Al Wefaq' },
      extensions_count: 1
    }
  ];
  const neonRows = [
    {
      id: 'RES_474',
      reservationNumber: '#474',
      sourceReservationId: 'RG-20261014-215136-5432',
      referenceNumber: '474',
      originalStatusCode: 'confirmed',
      originalStatusAr: 'مؤكد',
      customerName: 'أحمد خالد',
      customerPhone: '0501234567',
      startDate: '2026-10-14',
      endDate: '2026-10-18',
      carName: 'Camry 2026',
      companyName: 'Al Wefaq',
      extensionsCount: 1
    }
  ];

  const cmp = crmCore.compareRgAndNeonReservations(rgRows, neonRows);
  assert.equal(cmp.matchedCount, 1);
  assert.equal(cmp.missingInNeonCount, 0);
  assert.equal(cmp.missingInRgCount, 0);
  assert.equal(cmp.issues.length, 0);
});

test('fetchRentalGateSnapshotReadOnly clamps duplicated page probes and throws on primary endpoint HTTP 500', async () => {
  const mockExec = createMockExecutor(async (sql) => {
    if (sql.includes('FROM settings')) {
      return { rows: [{ key: 'rg_direct_token', value: 'secret-token-xyz' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  // Duplicate page detection: page 1 and page 2 return same item -> stops cleanly at 1 unique item
  let callCount = 0;
  const dupFetch: typeof fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [{ id: 101, reservation_number: 'RG-101', status: 'confirmed' }]
        };
      }
    } as any;
  };

  const snapOk = await fetchRentalGateSnapshotReadOnly(
    mockExec,
    { scopes: ['reservations'], maxPages: 5 },
    dupFetch
  );
  assert.equal(snapOk.reservations.length, 1);
  assert.ok(callCount <= 2, 'Should clamp repeated pages cleanly instead of looping maxPages times');

  // Primary failure: must throw instead of silently returning 0 rows
  const failFetch: typeof fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return 'RG upstream HTTP 500';
    }
  } as any);

  await assert.rejects(
    () =>
      fetchRentalGateSnapshotReadOnly(
        mockExec,
        { scopes: ['reservations'], maxPages: 3 },
        failFetch
      ),
    /RG_API_HTTP_500|HTTP 500/i
  );
});

test('integrityService.runDataIntegrityCheck marks run as failed on RG error and getDataIntegrityReport preserves last valid baseline', async () => {
  const runsStore: any[] = [
    {
      id: 'DIRUN_PREV_OK',
      trigger_type: 'manual',
      run_mode: 'manual',
      status: 'completed',
      triggered_by_id: 'EMP_DEVELOPER',
      triggered_by_name: 'Dev',
      scopes_json: ['reservations'],
      summary_json: { matchedCount: 12, rgChecked: true },
      rg_total_count: 12,
      neon_total_count: 12,
      reviewed_count: 12,
      discrepancies_count: 0,
      duration_ms: 420,
      error_message: '',
      started_at: '2026-11-27T10:00:00.000Z',
      finished_at: '2026-11-27T10:00:01.000Z'
    }
  ];
  const loggedErrors: any[] = [];

  const mockExec = createMockExecutor(async (sql, params = []) => {
    if (sql.includes('FROM settings')) {
      return { rows: [{ key: 'data_integrity_settings', value: '{}' }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO data_integrity_runs')) {
      runsStore.unshift({
        id: params[0],
        trigger_type: params[1],
        run_mode: params[2],
        status: 'running',
        triggered_by_id: params[3],
        triggered_by_name: params[4],
        scopes_json: JSON.parse(params[5] || '[]'),
        summary_json: {},
        rg_total_count: 0,
        neon_total_count: 0,
        reviewed_count: 0,
        discrepancies_count: 0,
        duration_ms: 0,
        error_message: '',
        started_at: params[6],
        finished_at: null
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE data_integrity_runs') && sql.includes("status = 'failed'")) {
      const target = runsStore.find((r) => r.id === params[0]);
      if (target) {
        target.status = 'failed';
        target.error_message = params[1];
        target.duration_ms = params[2];
        target.finished_at = params[3];
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO error_logs')) {
      loggedErrors.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM data_integrity_runs') && sql.includes("status IN ('completed', 'partial')")) {
      return { rows: runsStore.filter((r) => r.status === 'completed' || r.status === 'partial'), rowCount: 1 };
    }
    if (sql.includes('FROM data_integrity_runs') && sql.includes("status = 'running'")) {
      return { rows: runsStore.filter((r) => r.status === 'running'), rowCount: 0 };
    }
    if (sql.includes('FROM data_integrity_runs')) {
      return { rows: runsStore, rowCount: runsStore.length };
    }
    return { rows: [], rowCount: 0 };
  });

  const devSession = createDevSession();
  const prevToken = process.env.RG_TOKEN;
  delete process.env.RG_TOKEN;
  try {
    await assert.rejects(
      () => runDataIntegrityCheck(mockExec, devSession, { runMode: 'manual' }),
      /RG_TOKEN/i
    );
  } finally {
    if (prevToken !== undefined) process.env.RG_TOKEN = prevToken;
  }

  assert.equal(runsStore[0].status, 'failed', 'Failed RG check must mark run status=failed instead of completed with 0');
  assert.ok(loggedErrors.length >= 1, 'Failed integrity run must log to error_logs');

  const report = await getDataIntegrityReport(mockExec, devSession);
  assert.equal(report.latestRun?.id, 'DIRUN_PREV_OK', 'latestRun should preserve the last valid baseline');
  assert.equal(report.latestAttempt?.status, 'failed', 'latestAttempt should surface the failed attempt explicitly');
});

test('router enforces developer-only RBAC for Database Health Center & Data Integrity', async () => {
  const agentToken = 'agent-token-test-hc';
  const agentTokenHash = hashToken(agentToken);
  const futureIso = new Date(Date.now() + 3600_000).toISOString();

  const mockExec = createMockExecutor(async (sql) => {
    if (sql.includes('to_regclass(')) {
      return { rows: [{ reg: 'employees', all_ok: true }], rowCount: 1 };
    }
    if (sql.includes('COUNT(*)::int AS cnt FROM employees')) {
      return { rows: [{ cnt: 1 }], rowCount: 1 };
    }
    if (sql.includes('FROM sessions') && sql.includes('JOIN employees')) {
      return {
        rows: [{
          token_hash: agentTokenHash,
          employee_id: 'EMP_AGENT_1',
          username: 'agent1',
          role: 'agent',
          expires_at: futureIso,
          id: 'EMP_AGENT_1',
          name: 'Agent One',
          emp_username: 'agent1',
          phone: '',
          email: '',
          job_title: 'Agent',
          emp_role: 'agent',
          permissions_json: ['view_reservations'],
          status: 'active',
          ui_overrides_json: {},
          ui_overrides_updated_at: null,
          last_activity: futureIso,
          created_at: futureIso,
          updated_at: futureIso
        }],
        rowCount: 1
      };
    }
    if (sql.includes('FROM roles')) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  for (const action of [
    'getDatabaseHealthCenterReport',
    'runDatabaseHealthCenterScan',
    'saveHealthCenterSettings',
    'retryHealthCenterFailedSync',
    'getDataIntegrityReport',
    'runDataIntegrityCheck'
  ]) {
    const res = await dispatchCrmRequest(mockExec, { action, token: agentToken, payload: {} });
    assert.equal(res.success, false, `Expected ${action} to fail for agent`);
    assert.equal(res.error, 'FORBIDDEN', `Expected FORBIDDEN for ${action}, got: ${res.message}`);
  }
});

test('healthCenter starts as unknown before any real scan and detects schema constraint/column diffs', () => {
  assert.equal(
    calculateHealthCenterOverallStatus({
      database_health: { status: 'unknown' },
      schema_integrity: { status: 'unknown' },
      data_integrity: { status: 'unknown' },
      sync_health: { status: 'unknown' }
    }),
    'unknown'
  );
  assert.equal(
    calculateHealthCenterOverallStatus({
      database_health: { status: 'healthy' },
      schema_integrity: { status: 'warning' },
      data_integrity: { status: 'healthy' },
      sync_health: { status: 'healthy' }
    }),
    'warning'
  );
  assert.equal(
    calculateHealthCenterOverallStatus({
      database_health: { status: 'healthy' },
      schema_integrity: { status: 'critical' },
      data_integrity: { status: 'healthy' },
      sync_health: { status: 'healthy' }
    }),
    'critical'
  );

  const manifest = parseSchemaManifestFromSql(SCHEMA_SQL);
  assert.ok(manifest.tables.has('reservations'), 'Manifest should include reservations');
  assert.ok(manifest.tables.has('health_center_runs'), 'Manifest should include health_center_runs');
  assert.ok(manifest.expectedConstraintsCount > 20, 'Manifest should extract table constraints');

  const diff = diffSchemaManifest(
    manifest,
    Array.from(manifest.tables.keys()),
    [{ table_name: 'reservations', column_name: 'id', data_type: 'text', is_nullable: 'NO' }],
    [{ table_name: 'users', constraint_name: 'users_pkey', constraint_type: 'PRIMARY KEY' }],
    [],
    []
  );
  assert.equal(diff.status, 'critical');
  assert.ok(diff.missingColumns.length > 0, 'Should flag missing columns');
  assert.ok(
    diff.constraintMismatches.some((c) => c.table === 'reservations' && c.constraintType === 'PRIMARY KEY'),
    'Should flag missing PRIMARY KEY constraint'
  );
  assert.ok(diff.pendingMigrations.length > 0, 'Should flag pending migrations');
});

test('healthCenter queries sync_worker_state id=primary, returns unknown when unscanned, redacts secrets, and retries safely', async () => {
  const devSession = createDevSession();
  const seenSql: string[] = [];
  let retryUpdatedIds: string[] = [];

  const mockExec = createMockExecutor(async (sql) => {
    seenSql.push(sql);
    if (sql.includes('FROM health_center_runs')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT 1 AS ok')) {
      return { rows: [{ ok: 1, pg_version: 'PostgreSQL 16.4', db_name: 'neondb' }], rowCount: 1 };
    }
    if (sql.includes("FROM sync_worker_state WHERE id = 'primary'")) {
      return {
        rows: [{
          id: 'primary',
          status: 'idle',
          is_syncing: false,
          auto_sync_enabled: true,
          interval_seconds: 60,
          last_run_at: '2026-11-27T12:00:00.000Z',
          last_success_at: '2026-11-27T12:00:00.000Z',
          next_run_at: '2026-11-27T12:01:00.000Z',
          last_duration_ms: 850,
          last_imported_count: 5,
          last_updated_count: 2,
          last_extensions_count: 1,
          error_count: 0,
          consecutive_errors: 0,
          last_error: ''
        }],
        rowCount: 1
      };
    }
    if (sql.includes('UPDATE sheets_mirror_outbox')) {
      retryUpdatedIds = ['OUTBOX_1', 'OUTBOX_2'];
      return { rows: [{ id: 'OUTBOX_1' }, { id: 'OUTBOX_2' }], rowCount: 2 };
    }
    if (sql.includes('FROM sheets_mirror_outbox') && sql.includes("status IN ('pending', 'retry')")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const initialReport = await getDatabaseHealthCenterReport(mockExec, devSession);
  assert.equal(initialReport.hasScanned, false);
  assert.equal(initialReport.overallStatus, 'unknown', 'Must NEVER report healthy before an actual scan runs');

  await runDatabaseHealthCenterScan(mockExec, devSession, { section: 'sync_health' });
  assert.ok(
    seenSql.some((s) => s.includes("sync_worker_state WHERE id = 'primary'")),
    'collectSyncHealth must query row id = primary'
  );
  assert.ok(
    !seenSql.some((s) => s.includes("sync_worker_state WHERE id = 'default'")),
    'collectSyncHealth must NOT query stale id = default'
  );

  const retryRes = await retryHealthCenterFailedSync(mockExec, devSession, { mode: 'outbox_transient', limit: 10 });
  assert.equal(retryRes.requeuedCount, 2);
  assert.equal(retryUpdatedIds.length, 2);

  // Secret redaction check
  const leaked = 'Failed connecting postgres://user:SuperSecretPass@ep-foo.neon.tech/neondb with Bearer eyJhbGciOiJIUzI1NiJ9';
  const redacted = redactSensitiveText(leaked);
  assert.ok(!redacted.includes('SuperSecretPass'), 'Password in connection string must be redacted');
  assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'), 'Bearer token must be redacted');
});
