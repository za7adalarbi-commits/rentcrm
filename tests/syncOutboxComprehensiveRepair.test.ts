import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { DbClient, DbExecutor, QueryResult, QueryResultRow } from '../backend/db';
import {
  backfillMissingOutboxIdempotencyKeys,
  computeOutboxBackoffSeconds,
  enqueueSheetsMirror,
  flushSheetsMirrorOutbox,
  OUTBOX_CANONICAL_STATUSES,
  OUTBOX_DEFAULT_BATCH_SIZE,
  OUTBOX_MAX_BATCH_SIZE,
  testOutboxSingleUpsert,
  testOutboxThreeWaySuite,
  verifyGasFrozenRowsProtection
} from '../backend/syncService';
import {
  backfillOutboxIdempotencyKeysAction,
  buildHealthErrorDigest,
  EXPECTED_MIGRATION_IDS,
  runDatabaseHealthCenterScan,
  testOutboxSingleUpsertAction,
  testOutboxThreeWaySuiteAction,
  verifyGasFrozenRowsProtectionAction
} from '../backend/healthCenter';

function createMockExecutor(
  handler: (sql: string, params?: any[], inTx?: boolean) => Promise<{ rows: any[]; rowCount: number }>
): DbExecutor {
  const runQuery = (inTx: boolean) => async <T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const res = await handler(sql, params, inTx);
    return res as QueryResult<T>;
  };
  return {
    query: runQuery(false),
    async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
      return fn({ query: runQuery(true) });
    }
  };
}

function loadHardenedGasSandbox(
  sheetRowsByName: Record<string, { frozenRows?: number; maxRows?: number; maxCols?: number; hasFilter?: boolean; rows: any[][] }>,
  scriptSecret = 'unified-32-char-secret-1234567890'
) {
  const deletedOps: Array<{ sheet: string; kind: 'deleteRow' | 'deleteRows'; start: number; count: number }> = [];
  const clearedRanges: Array<{ sheet: string; r: number; c: number; nr: number; nc: number }> = [];
  const insertOps: Array<{ sheet: string; kind: 'rows' | 'cols'; after: number; count: number }> = [];
  const propsStore: Record<string, string> = {
    SYNC_API_SECRET: scriptSecret,
    RG_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123'
  };
  const cacheStore = new Map<string, string>();

  const buildSheet = (name: string) => {
    const state = sheetRowsByName[name] || { frozenRows: 1, maxRows: 2, maxCols: 4, hasFilter: false, rows: [['id']] };
    let frozen = state.frozenRows ?? 1;
    let maxRows = state.maxRows ?? Math.max(state.rows.length, frozen + 1);
    let maxCols = state.maxCols ?? Math.max(4, state.rows[0]?.length || 1);
    return {
      getName: () => name,
      getFrozenRows: () => frozen,
      setFrozenRows: (n: number) => { frozen = n; },
      getMaxRows: () => maxRows,
      getLastRow: () => state.rows.length,
      getLastColumn: () => (state.rows[0]?.length || 1),
      getMaxColumns: () => maxCols,
      getFilter: () => (state.hasFilter ? { getRange: () => null } : null),
      insertRowsAfter: (afterPos: number, howMany: number) => {
        insertOps.push({ sheet: name, kind: 'rows', after: afterPos, count: howMany });
        maxRows += howMany;
      },
      insertColumnsAfter: (afterPos: number, howMany: number) => {
        insertOps.push({ sheet: name, kind: 'cols', after: afterPos, count: howMany });
        maxCols += howMany;
      },
      getRange: (r: number, c: number, nr = 1, nc = 1) => {
        const rangeObj: any = {
          getValues: () => {
            const out: any[][] = [];
            for (let i = 0; i < nr; i++) {
              const srcRow = state.rows[r - 1 + i] || [];
              const copy: any[] = [];
              for (let j = 0; j < nc; j++) copy.push(srcRow[c - 1 + j] ?? '');
              out.push(copy);
            }
            return out;
          },
          setValues: (vals: any[][]) => {
            if (r + vals.length - 1 > maxRows) {
              throw new Error(`Exceeds maxRows (${r + vals.length - 1} > ${maxRows})`);
            }
            if (c + (vals[0]?.length || 0) - 1 > maxCols) {
              throw new Error(`Exceeds maxCols (${c + (vals[0]?.length || 0) - 1} > ${maxCols})`);
            }
            for (let i = 0; i < vals.length; i++) {
              while (state.rows.length < r - 1 + i + 1) state.rows.push([]);
              for (let j = 0; j < vals[i].length; j++) state.rows[r - 1 + i][c - 1 + j] = vals[i][j];
            }
            return rangeObj;
          },
          clearContent: () => {
            clearedRanges.push({ sheet: name, r, c, nr, nc });
            for (let i = 0; i < nr; i++) {
              const idx = r - 1 + i;
              if (state.rows[idx]) {
                for (let j = 0; j < nc; j++) state.rows[idx][c - 1 + j] = '';
              }
            }
            while (state.rows.length > 1 && state.rows[state.rows.length - 1].every((v) => v === '' || v === null || v === undefined)) {
              state.rows.pop();
            }
            return rangeObj;
          },
          clearNote: () => rangeObj,
          setNumberFormat: () => rangeObj,
          setFontWeight: () => rangeObj,
          setBackground: () => rangeObj,
          setFontColor: () => rangeObj
        };
        return rangeObj;
      },
      deleteRow: (rowIdx: number) => {
        if (maxRows - 1 <= frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        deletedOps.push({ sheet: name, kind: 'deleteRow', start: rowIdx, count: 1 });
        state.rows.splice(rowIdx - 1, 1);
        maxRows -= 1;
      },
      deleteRows: (rowIdx: number, count: number) => {
        if (maxRows - count <= frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        deletedOps.push({ sheet: name, kind: 'deleteRows', start: rowIdx, count });
        state.rows.splice(rowIdx - 1, count);
        maxRows -= count;
      }
    };
  };

  const sheetsMap = new Map<string, ReturnType<typeof buildSheet>>();
  for (const name of Object.keys(sheetRowsByName)) sheetsMap.set(name, buildSheet(name));

  const rootDir = process.cwd();
  const dbGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'Database.gs'), 'utf8');
  const neonSyncGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'NeonSync.gs'), 'utf8');
  const codeGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'Code.gs'), 'utf8');

  const ctx: Record<string, any> = {
    console,
    Logger: { log: () => undefined },
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    encodeURIComponent,
    _rgRecordsCache: {},
    _rgDirtyCacheSheets: {},
    RG_HOT_PERSIST_CACHE_SHEETS: {},
    RG_DATE_ONLY_FIELDS: {},
    RG_TIME_ONLY_FIELDS: {},
    RG_SHEETS: {
      RESERVATIONS: 'Reservations',
      EXTENSIONS: 'Extensions',
      ASSIGNMENTS: 'Assignments',
      FOLLOWUPS: 'FollowUps',
      FOLLOWUP_HISTORY: 'FollowUpHistory',
      PROBLEMS: 'Problems',
      ISSUES: 'Issues',
      PROBLEM_UPDATES: 'ProblemUpdates',
      EMPLOYEES: 'Employees',
      USERS: 'Users',
      SETTINGS: 'Settings',
      NOTIFICATIONS: 'Notifications',
      CUSTOMERS: 'Customers'
    },
    normalizeStr: (v: unknown) => (v === null || v === undefined ? '' : String(v).trim()),
    nowIso: () => '2026-11-28T10:00:00.000Z',
    safeJsonParse: (txt: string, fb: any) => { try { return JSON.parse(txt); } catch { return fb; } },
    jsonResponse: (success: boolean, message: string, data: any) => ({
      getContent: () => JSON.stringify({ success, message, data })
    }),
    flushDirtyScriptCaches_: () => undefined,
    requireAuth: () => { throw new Error('MOCK_AUTH_REQUIRED'); },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => propsStore[k] ?? '',
        setProperty: (k: string, v: string) => { propsStore[k] = v; },
        setProperties: (obj: Record<string, string>) => { Object.assign(propsStore, obj); },
        deleteProperty: (k: string) => { delete propsStore[k]; }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getId: () => 'mock-ss-id',
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      }),
      openById: () => ({
        getId: () => 'mock-ss-id',
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => (cacheStore.has(k) ? cacheStore.get(k)! : null),
        put: (k: string, v: string) => { cacheStore.set(k, String(v)); },
        putAll: (obj: Record<string, string>) => {
          for (const [k, v] of Object.entries(obj || {})) cacheStore.set(k, String(v));
        },
        remove: (k: string) => { cacheStore.delete(k); }
      })
    },
    Utilities: {
      computeDigest: () => [1, 2, 3],
      DigestAlgorithm: { SHA_256: 'SHA_256' }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => undefined,
        tryLock: () => true,
        releaseLock: () => undefined
      })
    }
  };

  vm.createContext(ctx);
  vm.runInContext(dbGs, ctx);
  vm.runInContext(neonSyncGs, ctx);
  vm.runInContext(codeGs, ctx);
  return { ctx, deletedOps, clearedRanges, insertOps, propsStore, cacheStore, sheetsMap };
}

test('Repair A: enqueueSheetsMirror blocks deleteAllReservations automatically & schema parity holds', async () => {
  let insertCalled = false;
  const exec = createMockExecutor(async (sql) => {
    if (sql.includes('INSERT INTO sheets_mirror_outbox')) {
      insertCalled = true;
    }
    return { rows: [], rowCount: 0 };
  });

  const blocked = await enqueueSheetsMirror(exec, 'reservation', 'ALL', 'deleteAllReservations', { scope: 'all' });
  assert.equal(typeof blocked, 'object');
  assert.equal((blocked as any).enqueued, false, 'enqueueSheetsMirror must refuse bulk delete queueing');
  assert.equal((blocked as any).blocked, true, 'enqueueSheetsMirror must flag deleteAllReservations as blocked');
  assert.equal(insertCalled, false, 'INSERT INTO sheets_mirror_outbox must NEVER run for deleteAllReservations');

  const schemaSqlTs = await import('../backend/schemaSql');
  const rawSql = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  assert.equal(schemaSqlTs.SCHEMA_SQL.trim(), rawSql.trim(), 'backend/schemaSql.ts and database/schema.sql must match 100%');
  assert.ok(schemaSqlTs.SCHEMA_SQL.includes('correlation_id TEXT'));
  assert.ok(schemaSqlTs.SCHEMA_SQL.includes('batch_id TEXT'));
  assert.ok(OUTBOX_CANONICAL_STATUSES.includes('completed'));
  assert.ok(OUTBOX_CANONICAL_STATUSES.includes('dead_letter'));
  assert.equal(OUTBOX_DEFAULT_BATCH_SIZE, 8);
  assert.equal(OUTBOX_MAX_BATCH_SIZE, 10);
});

test('Repair B: Multi-batch clamp (8-10), Exponential Backoff + Jitter, cursor checkpoint & distributed worker lease lock', async () => {
  const b1 = computeOutboxBackoffSeconds(1, 0);
  const b2 = computeOutboxBackoffSeconds(2, 0.5);
  const b3 = computeOutboxBackoffSeconds(5, 1);
  assert.ok(b1 >= 30 && b1 <= 38);
  assert.ok(b2 >= 60 && b2 <= 75);
  assert.ok(b3 >= 480 && b3 <= 600);

  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'batch-secret-32-chars-xxxxxxxxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbBatchTest/exec';

  try {
    // 1. Distributed lease held by another active worker -> skips cleanly without dispatching GAS
    let gasDispatchedWhenLocked = false;
    const lockedExec = createMockExecutor(async (sql) => {
      if (sql.includes('INSERT INTO sync_worker_state') && sql.includes("'outbox_mirror'")) {
        return { rows: [], rowCount: 0 }; // conflict with fresh lease -> acquired = false
      }
      if (sql.includes('FROM sync_worker_state')) {
        return {
          rows: [{ id: 'outbox_mirror', is_syncing: true, stale: false, worker_heartbeat_at: new Date().toISOString() }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const resLocked = await flushSheetsMirrorOutbox(lockedExec, (async () => {
      gasDispatchedWhenLocked = true;
      return new Response('{}', { status: 200 });
    }) as any, { verifyAuthBeforeSend: false });
    assert.equal(gasDispatchedWhenLocked, false);
    assert.equal(resLocked.skippedByLock, true);

    // 2. Multi-batch clamping & incremental checkpoint persistence
    const claimedSizes: number[] = [];
    const savedCursors: string[] = [];
    let batchCounter = 0;
    const batchExec = createMockExecutor(async (sql, params) => {
      if (sql.includes("INSERT INTO sync_worker_state") && sql.includes("'outbox_mirror'")) {
        return { rows: [{ id: 'outbox_mirror' }], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const lim = Number(params?.[1] || 0);
        claimedSizes.push(lim);
        batchCounter += 1;
        if (batchCounter <= 2) {
          const rows = Array.from({ length: lim }, (_, idx) => ({
            id: `OBX_B${batchCounter}_${idx}`,
            entity_type: 'reservation',
            entity_id: `R-${batchCounter}-${idx}`,
            action: 'upsertReservation',
            payload: { reservationNumber: `R-${batchCounter}-${idx}` },
            idempotency_key: `key:${batchCounter}:${idx}`,
            retry_count: 0,
            status: 'processing'
          }));
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO sync_checkpoints')) {
        savedCursors.push(`${params?.[0]}:${params?.[5] || ''}`);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const okFetch = (async () => new Response(JSON.stringify({ success: true, data: { applied: 8, failedItems: [] } }), { status: 200 })) as any;
    const multiRes = await flushSheetsMirrorOutbox(batchExec, okFetch, {
      verifyAuthBeforeSend: false,
      batchSize: 50, // must clamp down to OUTBOX_MAX_BATCH_SIZE (10)
      maxBatches: 3
    });

    assert.equal(claimedSizes[0], 10, 'batchSize > 10 must clamp safely to 10');
    assert.equal(multiRes.batchesCompleted, 2);
    assert.equal(multiRes.sent, 20);
    assert.ok(savedCursors.some((c) => c.startsWith('google_sheets_mirror:OBX_B1_')), 'Checkpoint cursor must persist after Batch 1');
    assert.ok(savedCursors.some((c) => c.startsWith('google_sheets_mirror:OBX_B2_')), 'Checkpoint cursor must persist after Batch 2');
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('Repair C: Receipt verification reconciles already-applied retry rows & AbortError timeouts without duplicating writes', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'receipt-secret-32-chars-xxxxxxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbReceiptTest/exec';

  try {
    // 1. Pre-send reconciliation on retry_count > 0 row: receipt already exists -> completes cleanly WITHOUT re-sending
    let sentActions: string[] = [];
    let completedIds: string[] = [];
    const preExec = createMockExecutor(async (sql, params) => {
      if (sql.includes("INSERT INTO sync_worker_state") && sql.includes("'outbox_mirror'")) {
        return { rows: [{ id: 'outbox_mirror' }], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [{
            id: 'OBX_RETRY_1',
            entity_type: 'reservation',
            entity_id: 'RES-777',
            action: 'upsertReservation',
            payload: { reservationNumber: 'RES-777' },
            idempotency_key: 'res:RES-777:upsert',
            retry_count: 1,
            status: 'processing'
          }],
          rowCount: 1
        };
      }
      if (sql.includes("SET status = 'completed'") && sql.includes('ANY($1')) {
        completedIds = params?.[0] || [];
      }
      return { rows: [], rowCount: 1 };
    });

    const receiptFoundFetch = (async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sentActions.push(body.action);
      if (body.action === 'verifyOutboxReceipt') {
        return new Response(JSON.stringify({
          success: true,
          data: { found: ['res:RES-777:upsert'], receipts: { 'res:RES-777:upsert': { ok: true } } }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: { applied: 1 } }), { status: 200 });
    }) as any;

    const rPre = await flushSheetsMirrorOutbox(preExec, receiptFoundFetch, {
      verifyAuthBeforeSend: false,
      verifyReceiptOnAbort: true,
      maxBatches: 1
    });
    assert.deepEqual(sentActions, ['verifyOutboxReceipt']);
    assert.equal(sentActions.includes('syncFromNeonMirror'), false, 'Already-succeeded retry item must NEVER be re-sent');
    assert.deepEqual(completedIds, ['OBX_RETRY_1']);
    assert.equal(rPre.sent, 1);

    // 2. Post-AbortError reconciliation: request throws AbortError, then verifyOutboxReceipt confirms GAS succeeded -> marked completed!
    sentActions = [];
    completedIds = [];
    const abortExec = createMockExecutor(async (sql, params) => {
      if (sql.includes("INSERT INTO sync_worker_state") && sql.includes("'outbox_mirror'")) {
        return { rows: [{ id: 'outbox_mirror' }], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [{
            id: 'OBX_ABORT_2',
            entity_type: 'reservation',
            entity_id: 'RES-888',
            action: 'upsertReservation',
            payload: { reservationNumber: 'RES-888' },
            idempotency_key: 'res:RES-888:upsert',
            retry_count: 0,
            status: 'processing'
          }],
          rowCount: 1
        };
      }
      if (sql.includes("SET status = 'completed'") && sql.includes('ANY($1')) {
        completedIds = params?.[0] || [];
      }
      return { rows: [], rowCount: 1 };
    });

    const abortThenConfirmedFetch = (async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sentActions.push(body.action);
      if (body.action === 'syncFromNeonMirror') {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      }
      if (body.action === 'verifyOutboxReceipt') {
        return new Response(JSON.stringify({
          success: true,
          data: { found: ['res:RES-888:upsert'], receipts: { 'res:RES-888:upsert': { ok: true } } }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;

    const rAbort = await flushSheetsMirrorOutbox(abortExec, abortThenConfirmedFetch, {
      verifyAuthBeforeSend: false,
      verifyReceiptOnAbort: true,
      maxBatches: 1
    });
    assert.deepEqual(sentActions, ['syncFromNeonMirror', 'verifyOutboxReceipt']);
    assert.equal(rAbort.failed, 0, 'AbortError confirmed via receipt must NOT count as failure');
    assert.equal(rAbort.sent, 1);
    assert.deepEqual(completedIds, ['OBX_ABORT_2']);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('Repair D: testOutboxSingleUpsert runs real Outbox POST path & Health Center enforces developer RBAC and 10 explicit checks', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'upsert-test-secret-32-chars-xxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbRealUpsert/exec';

  try {
    let insertedOutbox: any = null;
    const outboxStatusUpdates: string[] = [];
    const seenPosts: any[] = [];

    const exec = createMockExecutor(async (sql, params) => {
      if (sql.includes('FROM reservations WHERE')) {
        return {
          rows: [{
            id: 'RES_REAL_1',
            reservation_number: '110554',
            source_reservation_id: '554',
            customer_name: 'عميل حقيقي',
            customer_phone: '0501234567',
            start_date: '2026-11-28',
            end_date: '2026-11-30',
            internal_status: 'متابعة',
            priority: 'عادي',
            total_amount: 900,
            assigned_employee_ids: [],
            assigned_employee_names: [],
            status_history: [],
            created_at: '2026-11-28T01:00:00.000Z',
            updated_at: '2026-11-28T02:00:00.000Z'
          }],
          rowCount: 1
        };
      }
      if (sql.includes("INSERT INTO sync_worker_state") && sql.includes("'outbox_mirror'")) {
        return { rows: [{ id: 'outbox_mirror' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO sheets_mirror_outbox')) {
        insertedOutbox = {
          id: params?.[0],
          entity_type: params?.[1],
          entity_id: params?.[2],
          action: params?.[3],
          payload: JSON.parse(String(params?.[4] || '{}')),
          idempotency_key: params?.[5],
          correlation_id: params?.[6],
          retry_count: 0,
          status: 'pending'
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return { rows: insertedOutbox ? [insertedOutbox] : [], rowCount: insertedOutbox ? 1 : 0 };
      }
      if (sql.includes("SET status = 'completed'")) {
        outboxStatusUpdates.push('completed');
      }
      return { rows: [], rowCount: 1 };
    });

    const realUpsertFetch = (async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      seenPosts.push({ headers: init?.headers || {}, body });
      if (body.action === 'verifyMirrorAuth') {
        return new Response(JSON.stringify({ success: true, data: { verified: true, authValid: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: { applied: 1, skipped: 0, deduplicated: 0, failedItems: [], gasScriptVersion: '2026-11-28-sync-repair-v4' }
      }), { status: 200 });
    }) as any;

    const testOut = await testOutboxSingleUpsert(exec, {}, realUpsertFetch);
    assert.equal(testOut.ok, true);
    assert.equal(testOut.reservationNumber, '110554');
    assert.equal(testOut.outboxStatus, 'completed');
    assert.ok(testOut.correlationId);
    assert.ok(outboxStatusUpdates.includes('completed'));
    const mirrorPost = seenPosts.find((p) => p.body.action === 'syncFromNeonMirror');
    assert.ok(mirrorPost, 'Real Outbox Upsert Test must send syncFromNeonMirror POST');
    assert.equal(mirrorPost.body.payload.syncSecret, 'upsert-test-secret-32-chars-xxxx');
    assert.equal(mirrorPost.headers['X-RG-Sync-Secret'], 'upsert-test-secret-32-chars-xxxx');
    assert.equal(mirrorPost.body.payload.items[0].action, 'upsertReservation');

    // Developer RBAC gate on testOutboxSingleUpsertAction
    const agentSess = { user: { id: 'U_AG', name: 'Agent', role: 'agent', permissions: [] } } as any;
    await assert.rejects(() => testOutboxSingleUpsertAction(exec, agentSess, {}, realUpsertFetch), /FORBIDDEN/);

    // Health Center: 10 checks + Direct Auth vs Actual Outbox Auth separation
    assert.ok(EXPECTED_MIGRATION_IDS.includes('2026_11_28_010_outbox_lifecycle_and_classification_repair'));
    assert.ok(EXPECTED_MIGRATION_IDS.includes('2026_11_28_011_outbox_correlation_batch_and_canonical_status'));

    const hcRuns: any[] = [];
    const hcExec = createMockExecutor(async (sql, params) => {
      if (sql.includes('INSERT INTO health_center_runs')) {
        hcRuns.unshift({
          id: params?.[0],
          scope: params?.[1],
          overall_status: params?.[2],
          triggered_by_id: params?.[3],
          triggered_by_name: params?.[4],
          duration_ms: params?.[5],
          summary_json: JSON.parse(String(params?.[6] || '{}')),
          sections_json: JSON.parse(String(params?.[7] || '{}')),
          error_message: '',
          started_at: params?.[8],
          finished_at: params?.[9]
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM health_center_runs')) {
        return { rows: hcRuns.slice(), rowCount: hcRuns.length };
      }
      if (sql.includes("FROM settings")) {
        return {
          rows: [
            { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/AKfycbRealUpsert/exec' },
            { key: 'sync_api_secret', value: 'upsert-test-secret-32-chars-xxxx' }
          ],
          rowCount: 2
        };
      }
      if (sql.includes("sent_cnt") && sql.includes("retry_with_error_cnt")) {
        return {
          rows: [{
            sent_cnt: 50,
            pending_cnt: 2,
            processing_cnt: 0,
            retry_cnt: 0,
            retry_with_error_cnt: 0,
            failed_cnt: 3,
            permanent_failed_cnt: 3,
            quarantined_bulk_cnt: 1,
            failed_attempts_cnt: 3,
            last_error_at: '2026-11-28T09:50:00.000Z',
            last_success_at: '2026-11-28T08:00:00.000Z',
            oldest_unsynced_at: '2026-11-28T09:40:00.000Z',
            oldest_pending_at: '2026-11-28T09:40:00.000Z',
            missing_idempotency_cnt: 0,
            stale_processing_cnt: 0,
            total_cnt: 55
          }],
          rowCount: 1
        };
      }
      if (sql.includes("AS category") && sql.includes("FROM sheets_mirror_outbox")) {
        return {
          rows: [{ category: 'auth', err: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.', cnt: 3, first_seen_at: '2026-11-28T09:00:00.000Z', last_seen_at: '2026-11-28T09:50:00.000Z' }],
          rowCount: 1
        };
      }
      if (sql.includes("FROM sync_checkpoints")) {
        return {
          rows: [{ source: 'google_apps_script_sheets', last_sync_at: '2026-11-28T08:00:00.000Z', last_status: 'ok', last_batch_count: 8, last_cursor: 'OBX_8', last_successful_at: '2026-11-28T08:00:00.000Z', meta: {} }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const devSess = { user: { id: 'U_DEV', name: 'Dev', role: 'developer', permissions: ['manage_developer_tools'] } } as any;
    const scanRep = await runDatabaseHealthCenterScan(hcExec, devSess, { section: 'sync_health', testLiveConnections: true, fetchFn: realUpsertFetch });
    const sy = scanRep.sections.sync_health;
    assert.equal(sy.tenPointChecks.length, 10);
    assert.equal(sy.liveChecks.gasMirrorAuth.authValid, true, 'Direct auth test passes');
    assert.equal(sy.outbox.actualOutboxAuth.valid, false, 'Real Outbox auth MUST remain false while active UNAUTHORIZED errors exist in Outbox');
    assert.equal(sy.tenPointChecks.find((c: any) => c.key === 'outbox_auth_health')?.status, 'critical');

    // Digest must keep gas_auth error ACTIVE even if direct GAS auth succeeded earlier
    const digest = buildHealthErrorDigest({ sync_health: sy, database_health: { recentErrors: [{ id: 'E1', action: 'outbox', context: 'outbox', message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.', createdAt: '2026-11-28T07:00:00.000Z' }] } });
    assert.ok(digest.active.some((g) => g.errorCategory === 'gas_auth'));
    assert.equal(digest.resolved.some((g) => g.errorCategory === 'gas_auth'), false);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('Repair E: GAS v4 persistent Outbox receipts, verifyOutboxReceipt, ensureSheetCapacity_, filter protection & SheetSyncMenu hygiene', () => {
  const secret = 'unified-32-char-secret-1234567890';
  const sandbox = loadHardenedGasSandbox({
    Reservations: {
      frozenRows: 1,
      maxRows: 2, // intentionally tight to verify ensureSheetCapacity_ grows before writing!
      maxCols: 4, // intentionally tight to verify ensureSheetSchemaColumns / ensureSheetCapacity_ grows columns!
      hasFilter: true,
      rows: [
        ['id', 'reservationNumber', 'customerName', 'assignedEmployeeIds'],
        ['RES-1', '1001', 'أحمد', '[]']
      ]
    },
    Problems: {
      frozenRows: 1,
      maxRows: 3,
      maxCols: 14,
      rows: [
        ['id', 'problemNumber', 'reservationId', 'reservationNumber', 'customerName', 'createdById', 'createdByName', 'assignedEmployeeIds', 'assignedEmployeeNames', 'description', 'priority', 'status', 'createdAt', 'updatedAt']
      ]
    },
    ProblemUpdates: {
      frozenRows: 1,
      maxRows: 3,
      maxCols: 4,
      hasFilter: true,
      rows: [
        ['id', 'problemId', 'note', 'createdAt'],
        ['PU1', 'PRB-DEL', 'a', '2026-01-01'],
        ['PU2', 'PRB-KEEP', 'b', '2026-01-02']
      ]
    }
  }, secret);

  // 1. upsertReservation persists across Cache clear & ensures sheet capacity + bumps v4
  const body1 = {
    action: 'syncFromNeonMirror',
    payload: {
      syncSecret: secret,
      correlationId: 'COR_GAS_V4',
      items: [
        {
          id: 'MIR_RES_2',
          idempotencyKey: 'res:1002:upsert:v1',
          action: 'upsertReservation',
          entityId: '1002',
          payload: { id: 'RES-2', reservationNumber: '1002', customerName: 'سارة' }
        }
      ]
    }
  };
  const r1 = JSON.parse(sandbox.ctx.doPost({ postData: { contents: JSON.stringify(body1) } }).getContent());
  assert.equal(r1.success, true);
  assert.equal(r1.data.applied, 1);
  assert.equal(r1.data.frozenRowsProtected, true);
  assert.equal(r1.data.gasScriptVersion, '2026-11-28-sync-repair-v4');
  assert.ok(sandbox.insertOps.some((op) => op.sheet === 'Reservations' && op.kind === 'rows'));
  assert.ok(sandbox.propsStore.NEON_OBX_RECEIPTS_V1.includes('res:1002:upsert:v1'));

  // Even if volatile script cache expires completely, persistent NEON_OBX_RECEIPTS_V1 deduplicates & verifyOutboxReceipt confirms it!
  sandbox.cacheStore.clear();
  const r2 = JSON.parse(sandbox.ctx.doPost({ postData: { contents: JSON.stringify(body1) } }).getContent());
  assert.equal(r2.data.deduplicated, 1);

  const rcResp = JSON.parse(sandbox.ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'verifyOutboxReceipt',
        payload: {
          syncSecret: secret,
          correlationId: 'COR_RC_1',
          idempotencyKeys: ['res:1002:upsert:v1', 'nonexistent:key']
        }
      })
    }
  }).getContent());
  assert.equal(rcResp.success, true);
  assert.deepEqual(rcResp.data.found, ['res:1002:upsert:v1']);
  assert.equal(rcResp.data.receipts['res:1002:upsert:v1'].entityId, '1002');
  assert.equal(rcResp.data.gasScriptVersion, '2026-11-28-sync-repair-v4');

  // 2. deleteRecordsWhere_ & safeDeleteSheetRows_ protect frozen rows AND active filters (0 physical deleteRow calls)
  const delCount = sandbox.ctx.deleteRecordsWhere_('ProblemUpdates', (r: any) => r.problemId === 'PRB-DEL');
  assert.equal(delCount, 1);
  assert.equal(sandbox.deletedOps.length, 0, 'Filtered/frozen sheet must compact via clearContent + setValues without physical row deletion');
  assert.equal(sandbox.sheetsMap.get('ProblemUpdates')!.getLastRow(), 2);

  // 3. Static safety check on SheetSyncMenu.gs & Database.gs: no sheet.clear() and no physical deleteRow/deleteRows calls
  const menuGs = fs.readFileSync(path.join(process.cwd(), 'google-apps-script', 'SheetSyncMenu.gs'), 'utf8');
  assert.equal(/\bsheet\.clear\s*\(/.test(menuGs), false, 'SheetSyncMenu.gs must NOT call sheet.clear()');
  assert.equal(/\bdataSheet\.clearContents\s*\(/.test(menuGs), false, 'SheetSyncMenu.gs must NOT call dataSheet.clearContents() over row 1');
  const dbGs = fs.readFileSync(path.join(process.cwd(), 'google-apps-script', 'Database.gs'), 'utf8');
  assert.equal(/\bsheet\.deleteRow(s)?\s*\(/.test(dbGs), false, 'Database.gs must NEVER call sheet.deleteRow or sheet.deleteRows');
});

test('Repair F: Safe 3-Way Outbox Suite (upsertReservation + appendFollowUp + upsertSetting) verifies GAS receipt before completion & enforces RBAC', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  try {
    process.env.SYNC_API_SECRET = 'three-way-outbox-secret-32-chars!!';
    process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbThreeWaySuite/exec';

    const outboxRows: any[] = [];
    const checkpoints: Record<string, any> = {};
    const seenPosts: any[] = [];

    const exec = createMockExecutor(async (sql, params) => {
      if (sql.includes("FROM settings")) {
        return {
          rows: [
            { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/AKfycbThreeWaySuite/exec' },
            { key: 'sync_api_secret', value: 'three-way-outbox-secret-32-chars!!' }
          ],
          rowCount: 2
        };
      }
      if (sql.includes('INSERT INTO sheets_mirror_outbox')) {
        outboxRows.push({
          id: params?.[0],
          entity_type: params?.[1],
          entity_id: params?.[2],
          action: params?.[3],
          payload: JSON.parse(String(params?.[4] || '{}')),
          idempotency_key: params?.[5],
          correlation_id: params?.[6],
          retry_count: 0,
          status: 'pending'
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const targetIds = Array.isArray(params?.[2]) ? params![2] : [];
        const matched = outboxRows.filter((r) => targetIds.includes(r.id));
        return { rows: matched, rowCount: matched.length };
      }
      if (sql.includes("SET status = 'completed'")) {
        const ids = Array.isArray(params?.[0]) ? params![0] : [];
        for (const r of outboxRows) {
          if (ids.includes(r.id)) r.status = 'completed';
        }
        return { rows: [], rowCount: ids.length };
      }
      if (sql.includes('SELECT id, status, last_error FROM sheets_mirror_outbox')) {
        const ids = Array.isArray(params?.[0]) ? params![0] : [];
        const matched = outboxRows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, status: r.status, last_error: '' }));
        return { rows: matched, rowCount: matched.length };
      }
      if (sql.includes('INSERT INTO sync_checkpoints')) {
        checkpoints[String(params?.[0] || '')] = {
          status: params?.[1],
          batchCount: params?.[2],
          meta: JSON.parse(String(params?.[4] || '{}'))
        };
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const threeWayFetch = (async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      seenPosts.push({ headers: init?.headers || {}, body });
      if (body.action === 'verifyMirrorAuth') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            verified: true,
            authValid: true,
            protectedMode: true,
            diagnostics: {
              secretMatch: true,
              receivedVia: 'payload.syncSecret',
              gasScriptVersion: '2026-11-28-sync-repair-v4'
            }
          }
        }), { status: 200 });
      }
      if (body.action === 'syncFromNeonMirror') {
        const items = body.payload?.items || [];
        return new Response(JSON.stringify({
          success: true,
          data: {
            applied: items.length,
            skipped: 0,
            deduplicated: 0,
            failedItems: [],
            receipts: items.map((i: any) => i.idempotencyKey),
            receiptCount: items.length,
            lastReceiptAt: '2026-11-28T11:00:00.000Z',
            protectedMode: true,
            frozenRowsProtected: true,
            receivedVia: 'payload.syncSecret',
            gasScriptVersion: '2026-11-28-sync-repair-v4'
          }
        }), { status: 200 });
      }
      if (body.action === 'verifyOutboxReceipt') {
        const keys = body.payload?.idempotencyKeys || [];
        return new Response(JSON.stringify({
          success: true,
          data: {
            found: keys,
            appliedKeys: keys,
            receipts: Object.fromEntries(keys.map((k: string) => [k, { ok: true, appliedAt: '2026-11-28T11:00:00.000Z' }])),
            gasScriptVersion: '2026-11-28-sync-repair-v4'
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, message: 'UNKNOWN' }), { status: 400 });
    }) as any;

    const suiteRes = await testOutboxThreeWaySuite(exec, { verifyReceiptWithGas: true }, threeWayFetch);
    assert.equal(suiteRes.ok, true);
    assert.equal(suiteRes.sent, 3);
    assert.equal(suiteRes.failed, 0);
    assert.equal(suiteRes.receiptVerifiedCount, 3);
    assert.equal(suiteRes.items.length, 3);
    assert.deepEqual(suiteRes.items.map((x) => x.action), ['upsertReservation', 'appendFollowUp', 'upsertSetting']);
    assert.deepEqual(suiteRes.items.map((x) => x.entityId), ['RG-HEALTH-TEST-1', 'FU_HEALTH_TEST_1', '__mirror_outbox_test_setting']);
    assert.ok(suiteRes.items.every((x) => x.outboxStatus === 'completed' && x.receiptConfirmed));
    assert.ok(checkpoints.google_apps_script_outbox_auth?.status === 'ok');
    assert.ok(checkpoints.google_apps_script_outbox_receipt?.status === 'ok');
    assert.equal(checkpoints.google_apps_script_outbox_receipt?.meta?.protectedMode, true);

    const mirrorPost = seenPosts.find((p) => p.body.action === 'syncFromNeonMirror');
    assert.ok(mirrorPost);
    assert.equal(mirrorPost.body.payload.syncSecret, 'three-way-outbox-secret-32-chars!!');
    assert.equal(mirrorPost.body.payload.items.length, 3);

    // Developer RBAC gate on new actions
    const supSess = { user: { id: 'U_SUP', name: 'Sup', role: 'supervisor', permissions: [] } } as any;
    await assert.rejects(() => testOutboxThreeWaySuiteAction(exec, supSess, {}, threeWayFetch), /FORBIDDEN/);
    await assert.rejects(() => verifyGasFrozenRowsProtectionAction(exec, supSess, threeWayFetch), /FORBIDDEN/);
    await assert.rejects(() => backfillOutboxIdempotencyKeysAction(exec, supSess), /FORBIDDEN/);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('Repair G: Live GAS verifyFrozenRowsProtection + deleteRecordByKey non-frozen safety + idempotency backfill + Health Center status guard', async () => {
  const secret = 'frozen-check-secret-32-chars-xxxx';
  const sandbox = loadHardenedGasSandbox({
    Reservations: {
      frozenRows: 1,
      maxRows: 3,
      maxCols: 4,
      hasFilter: true,
      rows: [
        ['id', 'reservationNumber', 'customerName', 'assignedEmployeeIds'],
        ['RES-1', '1001', 'أحمد', '[]']
      ]
    },
    FollowUps: {
      frozenRows: 1,
      maxRows: 2,
      maxCols: 4,
      rows: [
        ['id', 'reservationNumber', 'note', 'createdAt']
      ]
    },
    Settings: {
      frozenRows: 1,
      maxRows: 2,
      maxCols: 4,
      rows: [
        ['key', 'value', 'updatedBy', 'updatedAt'],
        ['only_setting', 'v1', 'sys', '2026-01-01']
      ]
    },
    Employees: {
      frozenRows: 1,
      maxRows: 2,
      maxCols: 3,
      rows: [
        ['id', 'name', 'role'],
        ['EMP-1', 'Dev', 'developer']
      ]
    },
    Problems: {
      frozenRows: 1,
      maxRows: 2,
      maxCols: 4,
      rows: [
        ['id', 'problemNumber', 'status', 'description']
      ]
    }
  }, secret);

  // 1. Live GAS verifyFrozenRowsProtection performs write+delete roundtrip without ANY physical deleteRow/deleteRows call!
  const frResp = JSON.parse(sandbox.ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'verifyFrozenRowsProtection',
        payload: { syncSecret: secret, correlationId: 'COR_FRZ_1' }
      })
    }
  }).getContent());
  assert.equal(frResp.success, true);
  assert.equal(frResp.data.ok, true);
  assert.equal(frResp.data.protectedMode, true);
  assert.equal(frResp.data.actualFrozenRowsTestPassed, true);
  assert.equal(frResp.data.deleteRowCallsBlocked, true);
  assert.equal(frResp.data.clearContentOnly, true);
  assert.equal(sandbox.deletedOps.length, 0, 'verifyFrozenRowsProtection & deleteRecordByKey MUST perform zero physical deleteRow/deleteRows calls');

  // Even deleting the LAST remaining data row in Settings must succeed without throwing non-frozen rows error
  const delOnly = sandbox.ctx.deleteRecordByKey('Settings', 'key', 'only_setting');
  assert.equal(delOnly, true);
  assert.equal(sandbox.deletedOps.length, 0);
  assert.equal(sandbox.sheetsMap.get('Settings')!.getFrozenRows(), 1);

  // 2. Backend verifyGasFrozenRowsProtection persists checkpoint + Idempotency backfill preserves retry_count
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  try {
    process.env.SYNC_API_SECRET = secret;
    process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbFrozenCheck/exec';

    const legacyRows = [
      { id: 'MIR_1', entity_type: 'Reservation', entity_id: '1001', action: 'upsertReservation', idempotency_key: '', retry_count: 5, status: 'dead_letter' },
      { id: 'MIR_2', entity_type: 'Setting', entity_id: 'k1', action: 'upsertSetting', idempotency_key: null, retry_count: 2, status: 'pending' },
      { id: 'MIR_3', entity_type: 'Reservation', entity_id: '1002', action: 'upsertReservation', idempotency_key: 'existing:key:3', retry_count: 0, status: 'completed' }
    ];
    const checkpoints: Record<string, any> = {};
    const healthRuns: any[] = [];
    const exec = createMockExecutor(async (sql, params) => {
      if (sql.includes("FROM settings")) {
        return {
          rows: [
            { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/AKfycbFrozenCheck/exec' },
            { key: 'sync_api_secret', value: secret }
          ],
          rowCount: 2
        };
      }
      if (sql.includes('UPDATE sheets_mirror_outbox') && sql.includes('idempotency_key = LEFT(')) {
        const updated: Array<{ id: string }> = [];
        for (const r of legacyRows) {
          if (!String(r.idempotency_key || '').trim()) {
            r.idempotency_key = `${r.entity_type}:${r.entity_id}:${r.action}:legacy:${r.id}`;
            updated.push({ id: r.id });
          }
        }
        return { rows: updated, rowCount: updated.length };
      }
      if (sql.includes('total_missing') && sql.includes('active_missing')) {
        const tot = legacyRows.filter((r) => !String(r.idempotency_key || '').trim()).length;
        const act = legacyRows.filter((r) => ['pending', 'processing', 'retry'].includes(r.status) && !String(r.idempotency_key || '').trim()).length;
        return { rows: [{ total_missing: tot, active_missing: act }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO sync_checkpoints')) {
        checkpoints[String(params?.[0] || '')] = {
          source: params?.[0],
          last_status: params?.[1],
          last_batch_count: params?.[2],
          last_error: params?.[3],
          meta: JSON.parse(String(params?.[4] || '{}')),
          last_sync_at: '2026-11-28T11:10:00.000Z',
          last_successful_at: params?.[1] === 'ok' ? '2026-11-28T11:10:00.000Z' : ''
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO health_center_runs')) {
        healthRuns.unshift({
          id: params?.[0],
          scope: params?.[1],
          overall_status: params?.[2],
          triggered_by_id: params?.[3],
          triggered_by_name: params?.[4],
          duration_ms: params?.[5],
          summary_json: params?.[6],
          sections_json: params?.[7],
          error_message: '',
          started_at: params?.[8],
          finished_at: params?.[9]
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM health_center_runs')) {
        return { rows: healthRuns, rowCount: healthRuns.length };
      }
      if (sql.includes('FROM sync_checkpoints')) {
        return { rows: Object.values(checkpoints), rowCount: Object.values(checkpoints).length };
      }
      if (sql.includes("sent_cnt") && sql.includes("missing_idempotency_total_cnt")) {
        return {
          rows: [{
            sent_cnt: 2529,
            pending_cnt: 69,
            processing_cnt: 0,
            retry_cnt: 64,
            retry_with_error_cnt: 64,
            failed_cnt: 1639,
            permanent_failed_cnt: 1500,
            quarantined_bulk_cnt: 32,
            missing_idempotency_cnt: 0,
            missing_idempotency_total_cnt: 0,
            stale_processing_cnt: 0,
            failed_attempts_cnt: 13417,
            last_error_at: '2026-11-28T10:00:00.000Z',
            last_success_at: '2026-11-28T11:05:00.000Z',
            oldest_unsynced_at: '2026-11-27T08:00:00.000Z',
            oldest_pending_at: '2026-11-28T09:00:00.000Z',
            total_cnt: 4301
          }],
          rowCount: 1
        };
      }
      if (sql.includes("AS category") && sql.includes("FROM sheets_mirror_outbox")) {
        return {
          rows: [
            { category: 'auth', err: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.', cnt: 1371, first_seen_at: '2026-11-27T08:00:00.000Z', last_seen_at: '2026-11-28T10:00:00.000Z' },
            { category: 'timeout', err: 'This operation was aborted', cnt: 203, first_seen_at: '2026-11-27T08:00:00.000Z', last_seen_at: '2026-11-28T10:00:00.000Z' },
            { category: 'sheet_frozen', err: 'Sorry, it is not possible to delete all non-frozen rows.', cnt: 129, first_seen_at: '2026-11-27T08:00:00.000Z', last_seen_at: '2026-11-28T10:00:00.000Z' }
          ],
          rowCount: 3
        };
      }
      return { rows: [], rowCount: 0 };
    });

    assert.ok(EXPECTED_MIGRATION_IDS.includes('2026_11_28_012_outbox_idempotency_backfill'));
    const bf = await backfillMissingOutboxIdempotencyKeys(exec);
    assert.equal(bf.updatedCount, 2);
    assert.equal(bf.remainingMissingTotal, 0);
    assert.equal(legacyRows[0].retry_count, 5, 'Backfill must NEVER reset retry_count');
    assert.equal(legacyRows[0].status, 'dead_letter', 'Backfill must NEVER mutate status');
    assert.ok(legacyRows[0].idempotency_key?.includes(':legacy:MIR_1'));

    const gasBridgeFetch = (async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const out = JSON.parse(sandbox.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
      return new Response(JSON.stringify(out), { status: 200 });
    }) as any;

    const devSess = { user: { id: 'U_DEV', name: 'Dev', role: 'developer', permissions: ['manage_developer_tools'] } } as any;
    const frVerify = await verifyGasFrozenRowsProtectionAction(exec, devSess, gasBridgeFetch);
    assert.equal(frVerify.ok, true);
    assert.equal(frVerify.protectedMode, true);
    assert.equal(frVerify.actualFrozenRowsTestPassed, true);

    const rep = await runDatabaseHealthCenterScan(exec, devSess, { section: 'sync_health', testLiveConnections: true, fetchFn: gasBridgeFetch });
    const sy = rep.sections.sync_health;
    assert.notEqual(sy.status, 'healthy', 'Sync Health MUST NOT return healthy while historical dead_letter/auth/frozen backlog remains');
    assert.equal(sy.outbox.frozenRowsProtection.protectedMode, true);
    assert.equal(sy.outbox.frozenRowsProtection.actualTestPassed, true);
    assert.equal(sy.outbox.frozenRowsProtection.frozenRowsErrorCount, 129);
    assert.equal(sy.outbox.actualOutboxAuth.valid, false);
    assert.equal(sy.outbox.actualOutboxAuth.liveValid, true, 'Direct/outbox live auth checkpoint is ok even while backlog=1371');
    assert.equal(sy.outbox.recoveryProgress.completed, 2529);
    assert.equal(sy.outbox.recoveryProgress.deadLetter, 1639);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});
