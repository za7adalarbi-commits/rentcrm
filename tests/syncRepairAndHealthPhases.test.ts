import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  buildRgAuthHeaders,
  buildRgHttpError,
  normalizeRgToken,
  resolveSafeRgEndpointUrl,
  testRgApiConnectionSafe,
  validateRgToken
} from '../backend/rgApiClient';
import {
  buildRentalGateEndpointUrl,
  normalizeRgApiBaseUrl
} from '../backend/coreBinding';
import type { DbClient, DbExecutor, QueryResult, QueryResultRow } from '../backend/db';
import {
  classifyOutboxMirrorError,
  flushSheetsMirrorOutbox,
  reprocessFailedOutboxBatch,
  verifyGasMirrorAuth
} from '../backend/syncService';
import {
  buildHealthErrorDigest,
  calculateHealthCenterOverallStatus,
  EXPECTED_MIGRATION_IDS
} from '../backend/healthCenter';
import { SCHEMA_SQL } from '../backend/schemaSql';

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

function loadFullGasSandbox(sheetRowsByName: Record<string, { frozenRows?: number; maxRows?: number; rows: any[][] }>) {
  const deletedOps: Array<{ sheet: string; kind: 'deleteRow' | 'deleteRows'; start: number; count: number }> = [];
  const clearedRanges: Array<{ sheet: string; r: number; c: number; nr: number; nc: number }> = [];
  const propsStore: Record<string, string> = {
    SYNC_API_SECRET: 'super-secret-xyz-123',
    RG_TOKEN: '  "Bearer Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123" \n'
  };

  const buildSheet = (name: string) => {
    const state = sheetRowsByName[name] || { frozenRows: 1, maxRows: 2, rows: [['id']] };
    const frozen = state.frozenRows ?? 1;
    let maxRows = state.maxRows ?? Math.max(state.rows.length, frozen + 1);
    return {
      getName: () => name,
      getFrozenRows: () => frozen,
      getMaxRows: () => maxRows,
      getLastRow: () => state.rows.length,
      getLastColumn: () => (state.rows[0]?.length || 1),
      getMaxColumns: () => Math.max(20, state.rows[0]?.length || 1),
      setFrozenRows: () => undefined,
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
            for (let i = 0; i < vals.length; i++) {
              while (state.rows.length < r - 1 + i + 1) state.rows.push([]);
              for (let j = 0; j < vals[i].length; j++) state.rows[r - 1 + i][c - 1 + j] = vals[i][j];
            }
            maxRows = Math.max(maxRows, state.rows.length);
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
        if (maxRows - 1 <= frozen) {
          throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        }
        deletedOps.push({ sheet: name, kind: 'deleteRow', start: rowIdx, count: 1 });
        state.rows.splice(rowIdx - 1, 1);
        maxRows -= 1;
      },
      deleteRows: (rowIdx: number, count: number) => {
        if (maxRows - count <= frozen) {
          throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        }
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
  const rgApiGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'RentalGateAPI.gs'), 'utf8');
  const resGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'Reservations.gs'), 'utf8');

  const ctx: Record<string, any> = {
    console,
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
      RESERVATIONS: 'الحجوزات',
      EXTENSIONS: 'التمديدات',
      ASSIGNMENTS: 'التوزيعات',
      FOLLOWUPS: 'المتابعات',
      FOLLOWUP_HISTORY: 'سجل المتابعات',
      PROBLEMS: 'المشاكل',
      ISSUES: 'المشاكل_قديم',
      PROBLEM_UPDATES: 'تحديثات المشاكل',
      EMPLOYEES: 'الموظفين',
      USERS: 'المستخدمين',
      SETTINGS: 'الإعدادات',
      NOTIFICATIONS: 'الإشعارات',
      CUSTOMERS: 'العملاء',
      CUSTOMER_NOTES: 'ملاحظات العملاء',
      CUSTOMER_NOTE_STATUSES: 'حالات ملاحظات العملاء',
      CUSTOMER_NOTE_ATTACHMENTS: 'مرفقات ملاحظات العملاء',
      CUSTOMER_NOTE_HISTORY: 'سجل ملاحظات العملاء'
    },
    normalizeStr: (v: unknown) => (v === null || v === undefined ? '' : String(v).trim()),
    nowIso: () => '2026-11-28T02:00:00.000Z',
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
        deleteProperty: (k: string) => { delete propsStore[k]; }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getId: () => 'mock-spreadsheet-id',
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      }),
      openById: () => ({
        getId: () => 'mock-spreadsheet-id',
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => undefined,
        remove: () => undefined
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
  vm.runInContext(rgApiGs, ctx);
  vm.runInContext(resGs, ctx);
  return { ctx, deletedOps, clearedRanges, propsStore };
}

test('Phase 1 & 5: rgApiClient normalizes tokens, prevents double Bearer, deduplicates URLs, and never leaks secrets', async () => {
  const sampleJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZy11c2VyIn0.signature12345';
  const dirtyToken = `  "Bearer Bearer ${sampleJwt}" \n`;
  assert.equal(normalizeRgToken(dirtyToken), sampleJwt);

  const validCheck = validateRgToken(dirtyToken);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.hadBearerPrefix, true);
  assert.equal(validCheck.hadQuotesOrWhitespace, true);

  const headers = buildRgAuthHeaders(dirtyToken);
  assert.equal(headers.Authorization, `Bearer ${sampleJwt}`);
  assert.equal(headers.Authorization.match(/Bearer /g)?.length, 1);

  assert.equal(validateRgToken('').reasonCode, 'EMPTY');
  assert.equal(validateRgToken('eyJhbGciOiJIUzI1NiJ9.broken').reasonCode, 'MALFORMED_JWT');
  assert.throws(() => buildRgAuthHeaders('eyJhbGciOiJIUzI1NiJ9.broken'), /RG_TOKEN_MALFORMED/);

  // Phase 5: Base URL and endpoint deduplication
  assert.equal(normalizeRgApiBaseUrl('https://api.rentalgate.net/api/api/'), 'https://api.rentalgate.net/api');
  assert.equal(
    resolveSafeRgEndpointUrl('https://api.rentalgate.net/api/api/reservations/filter', 'reservations/filter', { page: 0, size: 1 }),
    'https://api.rentalgate.net/api/reservations/filter?page=0&size=1'
  );
  assert.equal(
    buildRentalGateEndpointUrl('https://api.rentalgate.net/api/admin/cancelled-reservations', '/api/admin/cancelled-reservations'),
    'https://api.rentalgate.net/api/admin/cancelled-reservations'
  );

  // Error never leaks token
  const err401 = buildRgHttpError(401, 'Token is malformed', 'reservations/filter');
  assert.ok(err401.message.includes('RG_API_HTTP_401'));
  assert.ok(!err401.message.includes(sampleJwt));

  // Connection probe stops early on 401 and sets authValid: false
  const exec = createMockExecutor(async (sql) => {
    if (sql.includes('FROM settings')) {
      return {
        rows: [
          { key: 'rg_token', value: dirtyToken },
          { key: 'rg_api_base_url', value: 'https://api.rentalgate.net/api/api' }
        ],
        rowCount: 2
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const calledUrls: string[] = [];
  const fakeFetch = (async (url: any) => {
    calledUrls.push(String(url));
    return new Response(JSON.stringify({ message: 'Token is malformed' }), { status: 401 });
  }) as typeof fetch;

  const probeFail = await testRgApiConnectionSafe(exec, { fetchFn: fakeFetch, checkAllEndpoints: true });
  assert.equal(probeFail.connected, false);
  assert.equal(probeFail.authValid, false);
  assert.equal(calledUrls.length, 1);
  assert.equal(calledUrls[0], 'https://api.rentalgate.net/api/reservations/filter?page=0&size=1');
  assert.ok(!JSON.stringify(probeFail).includes(sampleJwt));
});

test('Phase 2 & 6: GAS auth verification halts outbox batch on mismatch and preserves failed rows', async () => {
  const outboxRows = [
    {
      id: 'OBX_1',
      idempotency_key: 'IDEMP_1',
      entity_type: 'reservation',
      entity_id: 'RES_1',
      action: 'upsert',
      payload: '{}',
      status: 'failed',
      retry_count: 2,
      last_error: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.',
      created_at: '2026-11-28T00:00:00Z'
    }
  ];
  let mutatedOutbox = false;

  const exec = createMockExecutor(async (sql) => {
    if (sql.includes('FROM settings')) {
      return {
        rows: [
          { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/test/exec' },
          { key: 'sync_api_secret', value: 'backend-secret-123' }
        ],
        rowCount: 2
      };
    }
    if (sql.includes('UPDATE sheets_mirror_outbox')) {
      mutatedOutbox = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM sheets_mirror_outbox')) {
      return { rows: outboxRows, rowCount: outboxRows.length };
    }
    return { rows: [], rowCount: 0 };
  });

  const fetch401 = (async () =>
    new Response(JSON.stringify({ success: false, message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.' }), { status: 200 })
  ) as typeof fetch;

  const authCheck = await verifyGasMirrorAuth(exec, fetch401);
  assert.equal(authCheck.ok, false);
  assert.equal(authCheck.authValid, false);

  // Batch reprocessing must halt BEFORE modifying/requeuing outbox rows
  const batchHalted = await reprocessFailedOutboxBatch(exec, { mode: 'auth', batchSize: 15 }, fetch401);
  assert.equal(batchHalted.haltedByAuth, true);
  assert.equal(batchHalted.requeuedCount, 0);
  assert.equal(mutatedOutbox, false);
  assert.equal(outboxRows[0].status, 'failed');

  // Legacy deploy skew detection (UNKNOWN_ACTION)
  const fetchLegacy = (async () =>
    new Response(JSON.stringify({ success: false, error: 'UNKNOWN_ACTION' }), { status: 200 })
  ) as typeof fetch;
  const legacyRes = await verifyGasMirrorAuth(exec, fetchLegacy);
  assert.equal(legacyRes.legacyGasScript, true);

  // When auth succeeds, reprocessFailedOutboxBatch requeues and sends batch safely
  let requeued = false;
  let sentCount = 0;
  const execSuccess = createMockExecutor(async (sql) => {
    if (sql.includes('FROM settings')) {
      return {
        rows: [
          { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/test/exec' },
          { key: 'sync_api_secret', value: 'backend-secret-123' }
        ],
        rowCount: 2
      };
    }
    if (sql.includes('FROM candidate') && sql.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: outboxRows, rowCount: 1 };
    }
    if (sql.includes('WITH picked AS')) {
      requeued = true;
      return { rows: [{ id: 'OBX_1' }], rowCount: 1 };
    }
    if (sql.includes("SET status = 'sent'")) {
      sentCount += 1;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const fetchOk = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.action === 'verifyMirrorAuth') {
      return new Response(JSON.stringify({ success: true, data: { authValid: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: { applied: 1, failedItems: [] } }), { status: 200 });
  }) as typeof fetch;

  const batchOk = await reprocessFailedOutboxBatch(execSuccess, { mode: 'auth', batchSize: 15 }, fetchOk);
  assert.equal(batchOk.haltedByAuth, false);
  assert.equal(batchOk.requeuedCount, 1);
  assert.equal(batchOk.sent, 1);
  assert.equal(requeued, true);
  assert.equal(sentCount, 1);

  // Error classification covers Phases 2, 3, 6
  assert.deepEqual(classifyOutboxMirrorError('Sorry, it is not possible to delete all non-frozen rows.', 200), {
    category: 'sheet_frozen',
    permanent: true
  });
  assert.deepEqual(classifyOutboxMirrorError('UNAUTHORIZED: SYNC_API_SECRET غير صالح.', 200), {
    category: 'auth',
    permanent: true
  });

  // flushSheetsMirrorOutbox halts before claiming when verifyAuthBeforeSend is true
  let txCalled = false;
  const haltExec: DbExecutor = {
    query: exec.query,
    async withTransaction() {
      txCalled = true;
      return [] as any;
    }
  };
  const haltedFlush = await flushSheetsMirrorOutbox(haltExec, fetch401, { verifyAuthBeforeSend: true });
  assert.equal(haltedFlush.haltedByAuth, true);
  assert.equal(txCalled, false);
});

test('Phase 6 & 9: Schema includes outbox error_category/last_attempt_at and Health Digest separates active/historical/resolved', () => {
  assert.ok(SCHEMA_SQL.includes('error_category TEXT'));
  assert.ok(SCHEMA_SQL.includes('last_attempt_at TIMESTAMPTZ'));
  assert.ok(EXPECTED_MIGRATION_IDS.includes('2026_11_27_008_outbox_attempt_and_error_category'));

  const nowIso = '2026-11-28T02:00:00.000Z';
  const digest = buildHealthErrorDigest(
    {
      database_health: {
        status: 'warning',
        lastSuccessAt: '2026-11-28T01:55:00.000Z',
        recentErrors: [
          {
            id: 'ERR_OLD_SQL',
            context: 'integrityService',
            action: 'runDataIntegrityCheck',
            message: 'inconsistent types deduced for parameter $13',
            createdAt: '2026-11-25T10:00:00.000Z'
          },
          {
            id: 'ERR_ACTIVE',
            context: 'syncService',
            action: 'flushSheetsMirrorOutbox',
            message: 'GAS timeout temporary',
            createdAt: '2026-11-28T01:58:00.000Z'
          }
        ]
      },
      schema_integrity: { status: 'healthy', missingTables: [], missingColumns: [], pendingMigrations: [], constraintMismatches: [] },
      data_integrity: { status: 'healthy' },
      sync_health: {
        status: 'critical',
        checkedAt: nowIso,
        lastSuccessBySource: {
          rentalGateApi: '2026-11-27T18:00:00.000Z',
          neonPostgres: '2026-11-28T01:55:00.000Z',
          googleAppsScriptSheets: '2026-11-27T12:00:00.000Z'
        },
        liveChecks: {
          checked: true,
          rentalGateAuth: { authValid: false, message: 'RG_API_HTTP_401: Token is malformed' },
          gasMirrorAuth: { authValid: false, message: 'UNAUTHORIZED: SYNC_API_SECRET' }
        },
        outbox: {
          failed: 1306,
          categoryBreakdown: [
            {
              category: 'auth',
              sampleError: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.',
              count: 1306,
              firstSeenAt: '2026-11-27T13:00:00.000Z',
              lastSeenAt: '2026-11-28T01:02:00.000Z'
            }
          ]
        }
      }
    },
    nowIso
  );

  assert.ok(digest.active.length >= 3);
  assert.equal(digest.resolved.length, 1); // old SQL error resolved by newer neonPostgres success
  assert.equal(digest.active[0].suggestedFix.length > 0, true);
  assert.equal(digest.active.some((a) => a.errorCategory === 'rg_auth'), true);
  assert.equal(digest.active.some((a) => (a.errorCategory === 'auth' || a.errorCategory === 'gas_auth') && a.occurrences >= 1306), true);

  // Must NEVER return healthy when active errors exist
  const overall = calculateHealthCenterOverallStatus(
    {
      database_health: { status: 'healthy' },
      schema_integrity: { status: 'healthy' },
      data_integrity: { status: 'healthy' },
      sync_health: { status: 'healthy' }
    },
    digest
  );
  assert.notEqual(overall, 'healthy');
});

test('GAS VM (Phases 1, 2, 3, 5): Endpoints are full URLs, verifyMirrorAuth enforces secret, and delete never fails on non-frozen rows', () => {
  const sheetData = {
    Reservations: {
      frozenRows: 1,
      maxRows: 2,
      rows: [
        ['id', 'sourceReservationId', 'reservationNumber', 'customerName'],
        ['RES_1', '1001', '1001', 'عميل تجريبي']
      ]
    }
  };
  const { ctx, deletedOps, clearedRanges } = loadFullGasSandbox(sheetData);

  // Phase 1 & 5: RentalGateAPI.gs endpoints restored properly and URL builder deduplicates
  assert.equal(ctx.RG_RESERVATIONS_API, 'https://api.rentalgate.net/api/reservations/filter');
  assert.equal(ctx.RG_COMPANY_CHANGES_API, 'https://api.rentalgate.net/api/reservation-company-changes/admin/filter');
  assert.equal(ctx.RG_CANCELLED_API, 'https://api.rentalgate.net/api/admin/cancelled-reservations');
  assert.equal(
    ctx.buildRgEndpointUrlGs_('https://api.rentalgate.net/api/api/reservations/filter', 'reservations/filter'),
    'https://api.rentalgate.net/api/reservations/filter'
  );
  assert.equal(ctx.getRgToken(), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123');
  const builtReq = ctx.buildRentalGateRequest_(ctx.RG_RESERVATIONS_API, ctx.getRgToken(), 0, 50);
  assert.equal(builtReq.url, 'https://api.rentalgate.net/api/reservations/filter?page=0&size=50');
  assert.equal(builtReq.headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123');

  // Phase 2: Code.gs verifyMirrorAuth action verifies SYNC_API_SECRET cleanly
  const badAuthRes = JSON.parse(
    ctx.handleApiRequest({ parameter: {}, postData: { contents: JSON.stringify({ action: 'verifyMirrorAuth', payload: { syncSecret: 'wrong' } }) } }, 'POST').getContent()
  );
  assert.equal(badAuthRes.success, false);
  assert.ok(String(badAuthRes.message).includes('UNAUTHORIZED'));

  const okAuthRes = JSON.parse(
    ctx.handleApiRequest({ parameter: {}, postData: { contents: JSON.stringify({ action: 'verifyMirrorAuth', payload: { syncSecret: 'super-secret-xyz-123' } }) } }, 'POST').getContent()
  );
  assert.equal(okAuthRes.success, true);
  assert.equal(okAuthRes.data.verified, true);

  // Phase 3: Deleting last non-frozen row never throws 'delete all non-frozen rows'
  const deleted = ctx.deleteRecordByKey('Reservations', 'reservationNumber', '1001');
  assert.equal(deleted, true);
  assert.equal(deletedOps.length, 0); // did not attempt illegal physical row delete
  assert.ok(clearedRanges.length >= 1); // safely cleared content instead
});
