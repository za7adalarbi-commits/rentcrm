import test from 'node:test';
import assert from 'node:assert/strict';
import { crmCore, type AuthSession } from '../backend/auth';
import {
  createPgExecutor,
  ensureDbExecutor,
  normalizeSwappedRgReservationNumbers,
  runVersionedMigrations,
  runWithSavepoint,
  type DbClient,
  type DbExecutor,
  type QueryResult
} from '../backend/db';
import {
  getDataIntegrityStatus,
  resolveDataIntegrityIssue,
  runDataIntegrityCheck
} from '../backend/dataIntegrity';
import { dispatchCrmRequest } from '../backend/router';
import { extractSyncReservationNumber } from '../backend/syncService';

function createAdminSession(): AuthSession {
  const nowIso = new Date().toISOString();
  return {
    tokenHash: 'test-token-hash',
    employeeId: 'EMP_ADMIN',
    username: 'admin',
    role: 'general_manager',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: 'EMP_ADMIN',
      name: 'Admin User',
      username: 'admin',
      phone: '',
      email: '',
      jobTitle: 'General Manager',
      role: 'general_manager',
      permissions: ['view_reservations', 'sync_data', 'view_reports', 'manage_settings', 'api_integration'],
      status: 'active',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  };
}

test('createPgExecutor.withTransaction rolls back immediately on SQL error, blocks post-error queries inside tx, and releases dirty clients on ROLLBACK failure', async () => {
  const executedSql: string[] = [];
  const releaseCalls: any[] = [];
  let inPgTx = false;
  let abortedInPg = false;

  const fakePoolHappyRb = {
    async query(sql: string) {
      executedSql.push(sql);
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    async connect() {
      return {
        async query(sql: string) {
          executedSql.push(sql);
          const upper = sql.trim().toUpperCase();
          if (upper === 'BEGIN') {
            inPgTx = true;
            abortedInPg = false;
            return { rows: [], rowCount: 0 };
          }
          if (upper === 'ROLLBACK' || upper === 'COMMIT') {
            inPgTx = false;
            abortedInPg = false;
            return { rows: [], rowCount: 0 };
          }
          if (abortedInPg) {
            const err: any = new Error('current transaction is aborted, commands ignored until end of transaction block');
            err.code = '25P02';
            throw err;
          }
          if (sql.includes('TRIGGER_SQL_ERROR')) {
            if (inPgTx) abortedInPg = true;
            const err: any = new Error('CASE types text and timestamp with time zone cannot be matched');
            err.code = '42804';
            throw err;
          }
          return { rows: [{ ok: true }], rowCount: 1 };
        },
        release(err?: Error) {
          releaseCalls.push(err ?? null);
        }
      };
    }
  };

  const exec = createPgExecutor(fakePoolHappyRb as any);
  let blockedAfterErrorMsg = '';
  await assert.rejects(
    async () => {
      await exec.withTransaction(async (tx) => {
        try {
          await tx.query('SELECT TRIGGER_SQL_ERROR');
        } catch {
          // Even if caller catches the error inside tx, subsequent unsafe query must NOT hit PostgreSQL directly
          try {
            await tx.query('SELECT 1');
          } catch (followErr: any) {
            blockedAfterErrorMsg = String(followErr?.message || '');
          }
        }
      });
    },
    /TRANSACTION_ABORTED/
  );

  assert.match(blockedAfterErrorMsg, /TRANSACTION_ABORTED/);
  assert.ok(executedSql.includes('ROLLBACK'), 'Expected ROLLBACK to be issued');
  assert.ok(!executedSql.includes('COMMIT'), 'Expected COMMIT never to be issued on aborted transaction');
  assert.deepEqual(releaseCalls, [null], 'Clean rollback should release client normally');

  // Now simulate ROLLBACK itself failing: client.release(err) must receive the error so pg.Pool destroys socket
  const dirtyReleaseCalls: any[] = [];
  const fakePoolBrokenRb = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(sql: string) {
          const upper = sql.trim().toUpperCase();
          if (upper === 'BEGIN') return { rows: [], rowCount: 0 };
          if (upper === 'ROLLBACK') throw new Error('SOCKET_CLOSED_DURING_ROLLBACK');
          throw new Error('INNER_FAILURE');
        },
        release(err?: Error) {
          dirtyReleaseCalls.push(err ?? null);
        }
      };
    }
  };

  const brokenExec = createPgExecutor(fakePoolBrokenRb as any);
  await assert.rejects(
    () =>
      brokenExec.withTransaction(async (tx) => {
        await tx.query('SELECT 1');
      }),
    /INNER_FAILURE/
  );
  assert.equal(dirtyReleaseCalls.length, 1);
  assert.ok(dirtyReleaseCalls[0] instanceof Error, 'Expected client.release(err) to destroy broken socket');
  assert.match(dirtyReleaseCalls[0].message, /SOCKET_CLOSED_DURING_ROLLBACK/);
});

test('runWithSavepoint handles 25P01 outside tx, isolates inner SQL failures inside tx via ROLLBACK TO SAVEPOINT, and ensures non-tx DbClient wrapping via ensureDbExecutor', async () => {
  const sqlLog: string[] = [];
  let inTx = false;
  let txAborted = false;
  let savepointActive = false;

  const poolMock = {
    async query(sql: string) {
      sqlLog.push(sql);
      if (/^SAVEPOINT\b/i.test(sql.trim()) && !inTx) {
        const e: any = new Error('SAVEPOINT can only be used in transaction blocks');
        e.code = '25P01';
        throw e;
      }
      return { rows: [{ direct: true }], rowCount: 1 };
    },
    async connect() {
      return {
        async query(sql: string) {
          sqlLog.push(sql);
          const trimmed = sql.trim();
          if (trimmed === 'BEGIN') {
            inTx = true;
            txAborted = false;
            savepointActive = false;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
            inTx = false;
            txAborted = false;
            savepointActive = false;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed.startsWith('SAVEPOINT ')) {
            if (txAborted) {
              const e: any = new Error('current transaction is aborted');
              e.code = '25P02';
              throw e;
            }
            savepointActive = true;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed.startsWith('ROLLBACK TO SAVEPOINT ')) {
            if (savepointActive) {
              txAborted = false;
              savepointActive = false;
            }
            return { rows: [], rowCount: 0 };
          }
          if (trimmed.startsWith('RELEASE SAVEPOINT ')) {
            savepointActive = false;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed.includes('OPTIONAL_FAIL')) {
            txAborted = true;
            throw new Error('optional relation failed');
          }
          return { rows: [{ committedQueryOk: true }], rowCount: 1 };
        },
        release() {}
      };
    }
  };

  const exec = createPgExecutor(poolMock as any);

  // Outside transaction (25P01) executes fn directly
  const outsideOut = await runWithSavepoint(exec, 'outside_step', async () => {
    const r = await exec.query('SELECT 1');
    return r.rows[0].direct;
  });
  assert.equal(outsideOut, true);

  // Inside transaction: inner optional failure is rolled back to savepoint, then outer tx continues and commits cleanly
  const txOut = await exec.withTransaction(async (tx) => {
    const fallbackVal = await runWithSavepoint(
      tx,
      'optional_step',
      async () => {
        await tx.query('SELECT OPTIONAL_FAIL');
        return 'never';
      },
      'RECOVERED_VIA_SAVEPOINT'
    );
    const afterRes = await tx.query('SELECT AFTER_OK');
    return { fallbackVal, after: afterRes.rows[0] };
  });

  assert.equal(txOut.fallbackVal, 'RECOVERED_VIA_SAVEPOINT');
  assert.deepEqual(txOut.after, { committedQueryOk: true });
  assert.ok(sqlLog.includes('COMMIT'), 'Outer transaction should commit cleanly after savepoint rollback');
  assert.ok(!sqlLog.includes('ROLLBACK'), 'Outer transaction should not full-rollback when savepoint isolated failure');

  // ensureDbExecutor wraps a plain DbClient cleanly
  const plainClient: DbClient = {
    async query(text: string): Promise<QueryResult> {
      return { rows: [{ sql: text }], rowCount: 1 };
    }
  };
  const wrapped = ensureDbExecutor(plainClient);
  assert.equal(typeof wrapped.withTransaction, 'function');
});

test('extractSyncReservationNumber, normalizeSwappedRgReservationNumbers, and crmCore.filterReservations resolve booking #474 (FINISHED + COMPANY_CHANGED)', async () => {
  const raw474 = {
    reservationId: 474,
    reservationStatus: 'FINISHED',
    rccStatus: 'COMPANY_CHANGED',
    referenceNumber: 'RG-20261014-215136-5432',
    clientName: 'عميل 474'
  };
  assert.equal(extractSyncReservationNumber(raw474), '474');

  // Explicit reservationNumber like 'RG-459-100' or 'REF-123' must remain intact
  assert.equal(
    extractSyncReservationNumber({ reservationId: 99, reservationNumber: 'RG-459-100', referenceNumber: 'RG-459-100' }),
    'RG-459-100'
  );

  // normalizeSwappedRgReservationNumbers repairs stored DB rows without touching extensions.reservation_number
  const dbState = {
    reservations: [
      {
        id: 'RES_RG-20261014-215136-5432',
        source_reservation_id: '474',
        reservation_number: 'RG-20261014-215136-5432',
        reference_number: 'RG-20261014-215136-5432'
      },
      {
        id: 'RES_1252',
        source_reservation_id: '1252',
        reservation_number: '1252',
        reference_number: 'RG-20261120-100000-1111'
      }
    ],
    assignments: [{ id: 'A1', reservation_id: 'RES_RG-20261014-215136-5432', reservation_number: 'RG-20261014-215136-5432' }],
    follow_ups: [],
    follow_up_history: [],
    problems: [{ id: 'P1', reservation_id: 'RES_RG-20261014-215136-5432', reservation_number: 'RG-20261014-215136-5432' }],
    issues: [],
    problem_updates: [{ id: 'PU1', reservation_number: 'RG-20261014-215136-5432' }],
    customer_notes: [],
    extensions: [{ id: 'EXT_152', reservation_id: 'RES_RG-20261014-215136-5432', reservation_number: 'RG-20261014-215136-5432' }]
  };

  const mockNormClient: DbClient = {
    async query(sql: string, params: any[] = []): Promise<QueryResult> {
      const s = sql.trim();
      if (/^(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)/i.test(s)) {
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('SELECT id, source_reservation_id, reservation_number, reference_number')) {
        return {
          rows: dbState.reservations.filter(
            (r) =>
              r.source_reservation_id &&
              r.reservation_number !== r.source_reservation_id &&
              r.reservation_number.toUpperCase().startsWith('RG-')
          ),
          rowCount: 1
        };
      }
      if (s === 'SELECT reservation_number FROM reservations') {
        return { rows: dbState.reservations.map((r) => ({ reservation_number: r.reservation_number })), rowCount: dbState.reservations.length };
      }
      if (s.startsWith('UPDATE reservations')) {
        const [id, targetNum, targetRef] = params;
        const row = dbState.reservations.find((r) => r.id === id);
        if (row) {
          row.reservation_number = targetNum;
          if (!row.reference_number || row.reference_number === targetNum) row.reference_number = targetRef;
        }
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('UPDATE problem_updates SET reservation_number = $1')) {
        const [targetNum, oldNum] = params;
        for (const r of dbState.problem_updates) {
          if (r.reservation_number === oldNum) r.reservation_number = targetNum;
        }
        return { rows: [], rowCount: 1 };
      }
      const m = s.match(/^UPDATE\s+([a-z_]+)\s+SET\s+reservation_number/i);
      if (m) {
        const tbl = m[1] as keyof typeof dbState;
        const [resId, targetNum, oldNum] = params;
        const list = (dbState[tbl] as any[]) || [];
        for (const row of list) {
          if (row.reservation_id === resId || row.reservation_number === oldNum) {
            row.reservation_number = targetNum;
          }
        }
        return { rows: [], rowCount: list.length };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const repaired = await normalizeSwappedRgReservationNumbers(mockNormClient);
  assert.equal(repaired, 1);
  assert.equal(dbState.reservations[0].reservation_number, '474');
  assert.equal(dbState.reservations[0].reference_number, 'RG-20261014-215136-5432');
  assert.equal(dbState.assignments[0].reservation_number, '474');
  assert.equal(dbState.problems[0].reservation_number, '474');
  assert.equal(dbState.problem_updates[0].reservation_number, '474');
  // extensions.reservation_number keeps 'RG-...' natively
  assert.equal(dbState.extensions[0].reservation_number, 'RG-20261014-215136-5432');

  // Filter matching by booking number, sourceReservationId, and referenceNumber
  const normalizedRow = {
    id: 'RES_RG-20261014-215136-5432',
    reservationNumber: '474',
    sourceReservationId: '474',
    referenceNumber: 'RG-20261014-215136-5432',
    originalStatusCode: 'finished',
    internalStatus: 'تم انهاء الحجز'
  };
  const preNormRow = {
    id: 'RES_RG-20261014-215136-5432',
    reservationNumber: 'RG-20261014-215136-5432',
    sourceReservationId: '474',
    referenceNumber: 'RG-20261014-215136-5432',
    originalStatusCode: 'finished',
    internalStatus: 'تم انهاء الحجز'
  };
  assert.equal(crmCore.filterReservations([normalizedRow], [], { reservationNumber: '474' }).length, 1);
  assert.equal(crmCore.filterReservations([normalizedRow], [], { reservationNumber: 'RG-20261014-215136-5432' }).length, 1);
  assert.equal(crmCore.filterReservations([preNormRow], [], { reservationNumber: '474' }).length, 1);
});

test('runDataIntegrityCheck, concurrency guard, resolveDataIntegrityIssue, and router dispatch work end-to-end with run_mode', async () => {
  const runs: any[] = [];
  const issues: any[] = [];
  const actions: any[] = [];
  const appliedMigs: any[] = [];
  let hasRunModeColumn = false;

  const mockExec: DbExecutor = {
    async query(sql: string, params: any[] = []): Promise<QueryResult> {
      const s = sql.trim();
      if (/^(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)/i.test(s)) return { rows: [], rowCount: 0 };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
      if (s.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
      if (s === 'SELECT id FROM schema_migrations') return { rows: appliedMigs.map((m) => ({ id: m.id })), rowCount: appliedMigs.length };
      if (s.startsWith('CREATE TABLE IF NOT EXISTS data_integrity_runs')) {
        hasRunModeColumn = true;
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('ALTER TABLE data_integrity_runs ADD COLUMN IF NOT EXISTS run_mode')) {
        hasRunModeColumn = true;
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('CREATE INDEX IF NOT EXISTS')) return { rows: [], rowCount: 0 };
      if (s.startsWith('INSERT INTO schema_migrations')) {
        const [id, description] = params;
        if (!appliedMigs.some((m) => m.id === id)) appliedMigs.push({ id, description });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT id, source_reservation_id, reservation_number, reference_number') && s.includes("LIKE 'RG-%'")) {
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('UPDATE data_integrity_runs') && s.includes('STALE_RUN_TIMEOUT')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('SELECT id, run_mode, trigger_type, status')) {
        return { rows: runs.filter((r) => r.status === 'running'), rowCount: runs.filter((r) => r.status === 'running').length };
      }
      if (s.startsWith('INSERT INTO data_integrity_runs')) {
        if (!hasRunModeColumn) throw new Error('column "run_mode" of relation "data_integrity_runs" does not exist');
        const [id, trigger_type, run_mode, started_at, scopes_json, triggered_by_id, triggered_by_name] = params;
        runs.push({
          id,
          trigger_type,
          run_mode,
          status: 'running',
          started_at,
          scopes_json,
          triggered_by_id,
          triggered_by_name,
          rg_total_count: 0,
          neon_total_count: 0,
          reviewed_count: 0,
          discrepancies_count: 0,
          error_message: ''
        });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT key, value FROM settings')) return { rows: [], rowCount: 0 };
      if (s.startsWith('SELECT id, source_reservation_id')) {
        return {
          rows: [
            {
              id: 'RES_RG_BAD',
              source_reservation_id: '474',
              reservation_number: 'RG-20261014-215136-5432',
              reference_number: 'RG-20261014-215136-5432',
              original_status_code: 'FINISHED',
              original_status_ar: 'تم انهاء الحجز',
              internal_status: 'تم انهاء الحجز',
              is_source_cancelled: false,
              is_source_rejected: false,
              rcc_status: 'COMPANY_CHANGED'
            }
          ],
          rowCount: 1
        };
      }
      if (s.startsWith('SELECT COUNT(*)::int AS cnt FROM extensions')) return { rows: [{ cnt: 1 }], rowCount: 1 };
      if (s.startsWith('INSERT INTO data_integrity_issues')) {
        const [
          id, run_id, reservation_id, reservation_number, discrepancy_type, severity,
          source_scope, field_name, rg_value, neon_value, rg_snapshot_json, neon_snapshot_json
        ] = params;
        issues.push({
          id,
          run_id,
          reservation_id,
          reservation_number,
          discrepancy_type,
          severity,
          source_scope,
          field_name,
          rg_value,
          neon_value,
          rg_snapshot_json,
          neon_snapshot_json,
          resolution_status: 'open'
        });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('UPDATE data_integrity_runs') && s.includes("status = 'completed'")) {
        const [id, finished_at, duration_ms, rg_total_count, neon_total_count, reviewed_count, discrepancies_count, summary_json] = params;
        const row = runs.find((r) => r.id === id);
        if (row) {
          Object.assign(row, {
            status: 'completed',
            finished_at,
            duration_ms,
            rg_total_count,
            neon_total_count,
            reviewed_count,
            discrepancies_count,
            summary_json
          });
        }
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (s.startsWith('UPDATE data_integrity_runs') && s.includes("status = 'failed'")) {
        const [id, duration_ms, error_message] = params;
        const row = runs.find((r) => r.id === id);
        if (row) Object.assign(row, { status: 'failed', duration_ms, error_message });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT * FROM data_integrity_runs')) return { rows: runs.slice().reverse(), rowCount: runs.length };
      if (s.startsWith('SELECT * FROM data_integrity_issues') && s.includes("resolution_status = 'open'")) {
        const open = issues.filter((i) => i.resolution_status === 'open');
        return { rows: open, rowCount: open.length };
      }
      if (s.startsWith('SELECT * FROM data_integrity_issues WHERE id = $1')) {
        const found = issues.filter((i) => i.id === params[0]);
        return { rows: found, rowCount: found.length };
      }
      if (s.startsWith('UPDATE data_integrity_issues')) {
        const [id, resolution_status, resolved_by_id, resolved_by_name, resolution_note] = params;
        const found = issues.find((i) => i.id === id);
        if (found) Object.assign(found, { resolution_status, resolved_by_id, resolved_by_name, resolution_note });
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (s.startsWith('INSERT INTO data_integrity_actions')) {
        actions.push({ id: params[0], issue_id: params[1], action_type: params[5] });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT * FROM data_integrity_actions')) return { rows: actions, rowCount: actions.length };
      return { rows: [], rowCount: 0 };
    },
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn(this);
    }
  };

  const migs1 = await runVersionedMigrations(mockExec);
  assert.deepEqual(migs1, ['2026_11_27_001_data_integrity_run_mode', '2026_11_27_002_normalize_rg_reservation_numbers']);
  assert.equal(hasRunModeColumn, true);

  // Re-running migrations is idempotent
  const migs2 = await runVersionedMigrations(mockExec);
  assert.deepEqual(migs2, []);

  const session = createAdminSession();
  const mockFetch = (async () => ({
    ok: true,
    status: 200,
    async json() {
      return { content: [{ reservationId: 474, reservationStatus: 'FINISHED' }], totalElements: 1, last: true };
    }
  })) as any;

  const res = await runDataIntegrityCheck(mockExec, session, { runMode: 'scheduled', scopes: ['reservations'] }, mockFetch);
  assert.equal(res.skipped, false);
  assert.equal(res.run.run_mode, 'scheduled');
  assert.equal(res.run.status, 'completed');
  assert.equal(res.issues.length, 1);
  assert.equal(res.issues[0].discrepancyType, 'rg_number_in_reservation_number');
  assert.equal(res.issues[0].reservationNumber, '474');

  // Concurrency guard blocks a new check when an active 'running' record exists
  runs.push({ id: 'DIR_ACTIVE', status: 'running', run_mode: 'manual', trigger_type: 'manual', started_at: new Date().toISOString() });
  const blocked = await runDataIntegrityCheck(mockExec, session, { runMode: 'manual' });
  assert.equal(blocked.skipped, true);
  assert.equal(blocked.reason, 'INTEGRITY_CHECK_IN_PROGRESS');

  // Query open issues & resolve atomically with audit trail
  const statusOut = await getDataIntegrityStatus(mockExec, session, {});
  assert.equal(statusOut.openIssues.length, 1);
  const resolvedOut = await resolveDataIntegrityIssue(mockExec, session, {
    issueId: statusOut.openIssues[0].id,
    resolutionStatus: 'resolved',
    resolutionNote: 'تم التصحيح'
  });
  assert.equal(resolvedOut.issue.resolution_status, 'resolved');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action_type, 'issue_resolved');

  // Verify dispatchCrmRequest responds cleanly for ping and routes data integrity actions
  const pingRes = await dispatchCrmRequest(mockExec, { action: 'ping' });
  assert.equal(pingRes.success, true);
});

test('queries.getReservations and getInactiveReservations filter payload.reservationNumber across reservation_number, source_reservation_id, and reference_number', async () => {
  const { getReservations, getInactiveReservations } = await import('../backend/queries');
  const seenSql: string[] = [];
  const spyExec: DbExecutor = {
    async query(sql: string): Promise<QueryResult> {
      seenSql.push(sql);
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn(this);
    }
  };
  const session = createAdminSession();
  await getReservations(spyExec, session, { reservationNumber: '474', limit: 10 });
  await getInactiveReservations(spyExec, session, { subTab: 'rejected', reservationNumber: '474', limit: 10 });

  const mainResSql = seenSql.find((s) => s.includes('FROM reservations r') && s.includes('source_reservation_id'));
  assert.ok(mainResSql, 'Expected reservations query');
  assert.match(mainResSql, /r\.reservation_number/);
  assert.match(mainResSql, /r\.source_reservation_id/);
  assert.match(mainResSql, /r\.reference_number/);
});
