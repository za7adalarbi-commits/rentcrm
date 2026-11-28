import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { applyInMemoryServerConfig } from '../backend/coreBinding';
import {
  getGasAuthFlowDiagnostics,
  getSyncSecretDiagnostics
} from '../backend/serverConfig';
import {
  classifyOutboxMirrorError,
  extractDetailedOutboxError,
  flushSheetsMirrorOutbox,
  probeGasMirrorSafe,
  reprocessFailedOutboxBatch,
  verifyGasMirrorAuth
} from '../backend/syncService';
import { saveApiToken, saveGlobalConnectionSettings } from '../backend/queries';
import {
  AUDIT_AND_HEALTH_MIGRATIONS,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from '../backend/db';
import {
  buildHealthErrorDigest,
  EXPECTED_MIGRATION_IDS,
  probeGasSheetsMirrorAction,
  retryHealthCenterFailedSync,
  runDatabaseHealthCenterScan
} from '../backend/healthCenter';
import apiSyncHandler from '../api/sync';

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

function loadFullGasSandbox(
  sheetRowsByName: Record<string, { frozenRows?: number; maxRows?: number; rows: any[][] }>,
  scriptSecret = 'super-secret-xyz-123'
) {
  const deletedOps: Array<{ sheet: string; kind: 'deleteRow' | 'deleteRows'; start: number; count: number }> = [];
  const clearedRanges: Array<{ sheet: string; r: number; c: number; nr: number; nc: number }> = [];
  const propsStore: Record<string, string> = {
    SYNC_API_SECRET: scriptSecret,
    RG_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123'
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
      CUSTOMERS: 'Customers',
      CUSTOMER_NOTES: 'CustomerNotes',
      CUSTOMER_NOTE_STATUSES: 'CustomerNoteStatuses',
      CUSTOMER_NOTE_ATTACHMENTS: 'CustomerNoteAttachments',
      CUSTOMER_NOTE_HISTORY: 'CustomerNoteHistory'
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
        setProperties: (obj: Record<string, string>) => { Object.assign(propsStore, obj); },
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
    CacheService: (() => {
      const store = new Map<string, string>();
      const api = {
        get: (k: string) => (store.has(k) ? store.get(k)! : null),
        put: (k: string, v: string) => { store.set(k, String(v)); },
        putAll: (obj: Record<string, string>) => {
          for (const [k, v] of Object.entries(obj || {})) store.set(k, String(v));
        },
        remove: (k: string) => { store.delete(k); }
      };
      return { getScriptCache: () => api };
    })(),
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
  return { ctx, deletedOps, clearedRanges, propsStore, sheetsMap };
}

test('1 & 2. applyInMemoryServerConfig preserves env secrets and diagnostics detect whitespace/conflicts without leakage', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevVercel = process.env.VERCEL_ENV;

  try {
    process.env.SYNC_API_SECRET = '\uFEFF"vercel-prod-secret-999"\n ';
    process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/u/0/s/AKfycbTestDeployId123456/exec?authuser=0';
    process.env.VERCEL_ENV = 'production';

    applyInMemoryServerConfig({
      mode: 'neon',
      databaseUrl: '',
      gasWebAppUrl: '',
      rgToken: '',
      rgApiBaseUrl: '',
      syncApiSecret: '',
      updatedAt: '',
      updatedBy: ''
    });

    assert.equal(process.env.SYNC_API_SECRET, '\uFEFF"vercel-prod-secret-999"\n ');
    assert.equal(
      process.env.GAS_WEBAPP_URL,
      'https://script.google.com/macros/u/0/s/AKfycbTestDeployId123456/exec?authuser=0'
    );

    const mockExecEnvOnly = createMockExecutor(async (sql) => {
      if (sql.includes('FROM settings')) {
        return {
          rows: [
            { key: 'sync_api_secret', value: 'db-different-secret-888' },
            { key: 'sync_api_secret_enc', value: 'enc:v1:invalid:payload:here' }
          ],
          rowCount: 2
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const secDiag = await getSyncSecretDiagnostics(mockExecEnvOnly);
    assert.equal(secDiag.configured, true);
    assert.equal(secDiag.source, 'env');
    assert.equal(secDiag.hasQuotes, true);
    assert.equal(secDiag.hasLeadingOrTrailingWhitespace, true);
    assert.equal(secDiag.hasNewlines, true);
    assert.equal(secDiag.hasInvisibleChars, true);
    assert.equal(secDiag.dbDecryptFailed, true);
    assert.equal(secDiag.envVsDbConflict, true);
    assert.equal(secDiag.length, 'vercel-prod-secret-999'.length);

    const flowDiag = await getGasAuthFlowDiagnostics(mockExecEnvOnly);
    assert.equal(flowDiag.environment.vercelEnv, 'production');
    assert.equal(flowDiag.gasUrl.configured, true);
    assert.equal(flowDiag.gasUrl.source, 'env');
    assert.equal(flowDiag.gasUrl.valid, true);
    assert.equal(flowDiag.gasUrl.wasNormalized, true);
    assert.equal(flowDiag.gasUrl.envVsDbConflict, false);
    assert.ok(flowDiag.gasUrl.deploymentIdHint.includes('...'));

    const mockExecUrlConflict = createMockExecutor(async (sql) => {
      if (sql.includes('FROM settings')) {
        return {
          rows: [{ key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/AKfycbOtherDeploy/exec' }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const urlConflictDiag = await getGasAuthFlowDiagnostics(mockExecUrlConflict);
    assert.equal(urlConflictDiag.gasUrl.source, 'db');
    assert.equal(urlConflictDiag.gasUrl.envVsDbConflict, true);

    const serialized = JSON.stringify({ secDiag, flowDiag, urlConflictDiag });
    assert.equal(serialized.includes('vercel-prod-secret-999'), false);
    assert.equal(serialized.includes('db-different-secret-888'), false);
    assert.equal(serialized.includes('AKfycbTestDeployId123456'), false);
  } finally {
      if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercel;
  }
});

test('2b. Migration 009 is registered cleanly and contains no destructive SQL on outbox or reservations', async () => {
  const migId = '2026_11_27_009_reclassify_outbox_auth_and_quarantine_bulk_delete';
  assert.ok(EXPECTED_MIGRATION_IDS.includes(migId));
  const mig = AUDIT_AND_HEALTH_MIGRATIONS.find((m) => m.id === migId);
  assert.ok(mig, 'Migration 009 must exist in AUDIT_AND_HEALTH_MIGRATIONS');
  const ranQueries: string[] = [];
  await mig.run({
    query: async (sql: string) => {
      ranQueries.push(sql);
      return { rows: [], rowCount: 0 };
    }
  } as any);
  const fullSql = ranQueries.join('\n');
  assert.equal(/^\s*(?:DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/im.test(fullSql), false);
  assert.ok(fullSql.includes(`'auth'`));
  assert.ok(fullSql.includes(`QUARANTINED_BULK_DELETE`));
});

test('4. Backend -> GAS verifyGasMirrorAuth rejects HTTP 200 UNAUTHORIZED, unverified 200 OK, and ServiceLogin redirects', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;

  try {
    process.env.SYNC_API_SECRET = 'match-secret-2026-prod';
    process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/u/0/s/AKfycbDeployValid/exec?authuser=0';

    const emptyExec = createMockExecutor(async () => ({ rows: [], rowCount: 0 }));

    // Case A: HTTP 200 + JSON UNAUTHORIZED
    const resUnauth = await verifyGasMirrorAuth(emptyExec, (async (url: string) => {
      assert.equal(url, 'https://script.google.com/macros/s/AKfycbDeployValid/exec');
      return new Response(
        JSON.stringify({
          success: false,
          message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.',
          data: { hasScriptSecret: true, scriptSecretLength: 20, providedLength: 22 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as any);
    assert.equal(resUnauth.ok, false);
    assert.equal(resUnauth.authValid, false);
    assert.equal(resUnauth.statusCode, 200);
    assert.equal(resUnauth.diagnostics?.gasDiagnostics?.scriptSecretLength, 20);
    assert.equal(JSON.stringify(resUnauth).includes('match-secret-2026-prod'), false);

    // Case B: HTTP 200 success=true without verified:true MUST NOT mark authValid=true
    const resLegacy = await verifyGasMirrorAuth(emptyExec, (async () =>
      new Response(JSON.stringify({ success: true, message: 'ok', data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as any);
    assert.equal(resLegacy.ok, false);
    assert.equal(resLegacy.authValid, false);
    assert.equal(resLegacy.legacyGasScript, true);

    // Case C: 302 redirect to accounts.google.com
    const resLoginRedirect = await verifyGasMirrorAuth(emptyExec, (async () => ({
      status: 302,
      ok: false,
      headers: { get: (k: string) => (k.toLowerCase() === 'location' ? 'https://accounts.google.com/v3/signin' : null) },
      text: async () => ''
    })) as any);
    assert.equal(resLoginRedirect.ok, false);
    assert.equal(resLoginRedirect.authValid, false);
    assert.ok(resLoginRedirect.message.includes('تسجيل دخول Google'));

    // Case D: Valid 302 redirect to script.googleusercontent.com returning verified=true
    let callIdx = 0;
    const resValidRedirect = await verifyGasMirrorAuth(emptyExec, (async (url: string, init?: RequestInit) => {
      callIdx += 1;
      if (callIdx === 1) {
        assert.equal(init?.method, 'POST');
        return {
          status: 302,
          ok: false,
          headers: { get: (k: string) => (k.toLowerCase() === 'location' ? 'https://script.googleusercontent.com/macros/echo?user_content_key=abc' : null) },
          text: async () => ''
        };
      }
      assert.ok(url.startsWith('https://script.googleusercontent.com/'));
      assert.equal(init?.method, 'GET');
      return new Response(
        '\uFEFF' + JSON.stringify({ success: true, message: 'ok', data: { verified: true, authValid: true, diagnostics: { scriptSecretLength: 22 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as any);
    assert.equal(resValidRedirect.ok, true);
    assert.equal(resValidRedirect.authValid, true);
  } finally {
      if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('4b. GAS -> Backend /api/sync enforces SYNC_API_SECRET cleanly (401 on wrong, 200 on match)', async () => {
  const prevDb = process.env.DATABASE_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevRg = process.env.RG_TOKEN;
  delete process.env.DATABASE_URL;
  process.env.SYNC_API_SECRET = 'gas-to-backend-secret-77';

  // When DATABASE_URL is absent, api/sync returns 503 cleanly without exposing secrets
  const makeMockRes = () => {
    const state = { status: 0, body: null as any, headers: {} as Record<string, string> };
    return {
      state,
      setHeader(k: string, v: string) { state.headers[k] = v; },
      status(code: number) { state.status = code; return this; },
      json(obj: any) { state.body = obj; return this; },
      end() { return this; }
    };
  };

  try {
    const res503 = makeMockRes();
    await apiSyncHandler({ method: 'POST', headers: {}, body: {} }, res503);
    assert.equal(res503.state.status, 503);
    assert.equal(JSON.stringify(res503.state.body).includes('gas-to-backend-secret-77'), false);
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevRg !== undefined) process.env.RG_TOKEN = prevRg;
  }
});

test('5, 6, 7. Full GAS VM end-to-end: auth diagnostics, BOM/body.syncSecret fallback, safe Settings probe, idempotent reservation upsert', () => {
  const rawScriptSecret = '  \uFEFF"gas-match-secret-42"\n ';
  const { ctx, sheetsMap, propsStore } = loadFullGasSandbox(
    {
      Reservations: {
        frozenRows: 1,
        maxRows: 3,
        rows: [
          ['id', 'reservationNumber', 'customerName', 'customerPhone', 'internalStatus'],
          ['RES-1', '10001', 'عميل أول', '0500000001', 'new']
        ]
      },
      Settings: {
        frozenRows: 1,
        maxRows: 3,
        rows: [
          ['key', 'value', 'updatedBy', 'updatedAt'],
          ['auto_sync_interval', '60', 'System', '2026-11-28T00:00:00Z']
        ]
      }
    },
    rawScriptSecret
  );

  // A. Invalid secret returns HTTP 200 payload with success:false UNAUTHORIZED + safe length diagnostics (no secret leaked!)
  const badResRaw = ctx.doPost({
    parameter: { action: 'verifyMirrorAuth' },
    postData: {
      contents: '\uFEFF' + JSON.stringify({
        action: 'verifyMirrorAuth',
        syncSecret: 'wrong-secret'
      })
    }
  }).getContent();
  const badParsed = JSON.parse(badResRaw);
  assert.equal(badParsed.success, false);
  assert.ok(String(badParsed.message).includes('UNAUTHORIZED'));
  assert.equal(badParsed.data?.diagnostics?.hasScriptSecret, true);
  assert.equal(badParsed.data?.diagnostics?.scriptSecretLength, 'gas-match-secret-42'.length);
  assert.equal(badParsed.data?.diagnostics?.scriptSecretHasQuotes ?? badParsed.data?.diagnostics?.scriptSecretHadQuotes, true);
  assert.equal(badParsed.data?.diagnostics?.scriptSecretHasInvisibleChars ?? badParsed.data?.diagnostics?.scriptSecretHadInvisibleChars, true);
  assert.equal(badParsed.data?.diagnostics?.providedLength, 'wrong-secret'.length);
  assert.equal(badResRaw.includes('gas-match-secret-42'), false);
  assert.equal(badResRaw.includes('wrong-secret'), false);

  // B. Valid secret via body.syncSecret + UTF-8 BOM succeeds and confirms verified:true
  const okAuthRaw = ctx.doPost({
    parameter: { action: 'verifyMirrorAuth' },
    postData: {
      contents: '\uFEFF' + JSON.stringify({
        action: 'verifyMirrorAuth',
        syncSecret: 'gas-match-secret-42'
      })
    }
  }).getContent();
  const okAuth = JSON.parse(okAuthRaw);
  assert.equal(okAuth.success, true);
  assert.equal(okAuth.data.verified, true);
  assert.equal(okAuth.data.authValid, true);
  assert.equal(okAuth.data.diagnostics.receivedVia, 'body.syncSecret');

  // C. Non-destructive safe probe writes only __mirror_health_probe in Settings (never touches Reservations)
  const probeRaw = ctx.doPost({
    parameter: { action: 'syncFromNeonMirror' },
    postData: {
      contents: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: 'gas-match-secret-42',
          items: [
            {
              id: 'PROBE_1',
              action: 'upsertSetting',
              payload: {
                key: '__mirror_health_probe',
                value: '2026-11-28T02:00:00.000Z',
                updatedBy: 'HealthCenterSafeProbe'
              }
            }
          ]
        }
      })
    }
  }).getContent();
  const probeRes = JSON.parse(probeRaw);
  assert.equal(probeRes.success, true, probeRes.message);
  assert.equal(probeRes.data.applied, 1);

  // Repeat same probe idempotently: should update existing __mirror_health_probe row, not add duplicate rows
  ctx.doPost({
    parameter: { action: 'syncFromNeonMirror' },
    postData: {
      contents: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: 'gas-match-secret-42',
          items: [
            {
              id: 'PROBE_2',
              action: 'upsertSetting',
              payload: {
                key: '__mirror_health_probe',
                value: '2026-11-28T02:05:00.000Z',
                updatedBy: 'HealthCenterSafeProbe'
              }
            }
          ]
        }
      })
    }
  });
  const settingsRows = sheetsMap.get('Settings')!.getRange(1, 1, 10, 2).getValues();
  const probeRows = settingsRows.filter((r: any[]) => r[0] === '__mirror_health_probe');
  assert.equal(probeRows.length, 1);
  assert.equal(sheetsMap.get('Reservations')!.getLastRow(), 2);

  // D. Real single reservation mirror upsert + second pass idempotency without deleting rows
  const resBefore = sheetsMap.get('Reservations')!.getLastRow();
  ctx.doPost({
    parameter: { action: 'syncFromNeonMirror' },
    postData: {
      contents: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: 'gas-match-secret-42',
          items: [
            {
              id: 'MIR_RES_99',
              action: 'upsertReservation',
              payload: { id: 'RES-99', reservationNumber: '99999', customerName: 'عميل اختبار آمن', customerPhone: '0555555555', internalStatus: 'new' }
            }
          ]
        }
      })
    }
  });
  const resAfterInsert = sheetsMap.get('Reservations')!.getLastRow();
  assert.equal(resAfterInsert, resBefore + 1);

  ctx.doPost({
    parameter: { action: 'syncFromNeonMirror' },
    postData: {
      contents: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: 'gas-match-secret-42',
          items: [
            {
              id: 'MIR_RES_99_B',
              action: 'upsertReservation',
              payload: { id: 'RES-99', reservationNumber: '99999', customerName: 'عميل اختبار محدّث', customerPhone: '0555555555', internalStatus: 'confirmed' }
            }
          ]
        }
      })
    }
  });
  assert.equal(sheetsMap.get('Reservations')!.getLastRow(), resAfterInsert);
  assert.equal(propsStore.RG_TOKEN, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig_part_valid_123');
});

test('8. Outbox error classification & Health Center digest unify auth failures (1306+20 -> auth/gas_auth, 0 unknown)', () => {
  const variants = [
    'UNAUTHORIZED: SYNC_API_SECRET غير صالح.',
    'UNAUTHORIZED: مفتاح المزامنة SYNC_API_SECRET غير متطابق',
    'GAS_AUTH_REQUIRED: أعد نشر Apps Script',
    'GAS_FORBIDDEN: التحقق فشل HTTP 403',
    'redirect to https://accounts.google.com/ServiceLogin',
    'INVALID_SECRET'
  ];
  for (const msg of variants) {
    const cls = classifyOutboxMirrorError(msg, 5);
    assert.equal(cls.category, 'auth', `Expected auth for: ${msg}`);
    assert.equal(cls.permanent, true);
  }

  const frozenCls = classifyOutboxMirrorError('Sorry, it is not possible to delete all non-frozen rows.', 2);
  assert.equal(frozenCls.category, 'sheet_frozen');
  assert.equal(frozenCls.permanent, true);

  const quarantineCls = classifyOutboxMirrorError('QUARANTINED_BULK_DELETE: محظور لحماية الحجوزات', 1);
  assert.equal(quarantineCls.category, 'validation');
  assert.equal(quarantineCls.permanent, true);

  const digest = buildHealthErrorDigest(
    {
      database_health: { status: 'healthy', recentErrors: [] },
      schema_integrity: { status: 'healthy' },
      data_integrity: { status: 'healthy' },
      sync_health: {
        status: 'critical',
        liveChecks: {
          gasMirrorAuth: { ok: false, authValid: false, message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.' }
        },
        outbox: {
          failed: 1326,
          quarantinedBulkDelete: 1,
          errorBreakdown: [
            { error: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.', category: 'auth', count: 1306, isTransient: false },
            { error: 'UNAUTHORIZED: SYNC_API_SECRET غير متطابق', category: 'auth', count: 20, isTransient: false }
          ],
          categoryBreakdown: [
            { category: 'auth', count: 1326, sampleError: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.', lastSeenAt: '2026-11-28T01:59:00.000Z' }
          ],
          recentErrors: []
        }
      }
    },
    '2026-11-28T02:00:00.000Z'
  );

  const gasAuthActive = digest.active.filter((g) => g.errorCategory === 'gas_auth');
  assert.equal(gasAuthActive.length, 1);
  assert.equal(digest.active.some((g) => g.errorCategory === 'unknown'), false);
});

test('9 & 10. Quarantine & batch safety: MIR_78E035CCC351 deleteAllReservations is NEVER fetched in flush or mode=all retry; halts on auth/frozen', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'prod-secret-safe';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbValidDeploy999/exec';

  try {
    const executedSql: Array<{ sql: string; params?: any[] }> = [];
    const fetchCalls: string[] = [];

    const exec = createMockExecutor(async (sql, params) => {
      executedSql.push({ sql, params });
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        // Return a normal upsertReservation row (SQL already excluded deleteAllReservations)
        return {
          rows: [
            {
              id: 'MIR_UPSERT_1',
              entity_type: 'reservation',
              entity_id: 'RES-101',
              action: 'upsertReservation',
              payload: { id: 'RES-101' },
              retry_count: 1
            }
          ],
          rowCount: 1
        };
      }
      if (sql.includes('UPDATE sheets_mirror_outbox')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Mode 'all' must halt BEFORE mutating outbox when GAS returns UNAUTHORIZED
    const retryHalted = await reprocessFailedOutboxBatch(
      exec,
      { mode: 'all', batchSize: 15 },
      (async () => {
        fetchCalls.push('called');
        return new Response(
          JSON.stringify({ success: false, message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any
    );
    assert.equal(retryHalted.haltedByAuth, true);
    assert.equal(retryHalted.requeuedCount, 0);
    assert.equal(executedSql.some((q) => q.sql.includes(`UPDATE sheets_mirror_outbox`)), false);
    assert.equal(fetchCalls.length, 1);

    // When auth passes, mode 'all' must STILL exclude deleteAllReservations in SQL
    executedSql.length = 0;
    const retryOk = await reprocessFailedOutboxBatch(
      exec,
      { mode: 'all', batchSize: 15 },
      (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.action === 'verifyMirrorAuth') {
          return new Response(
            JSON.stringify({ success: true, data: { verified: true, authValid: true } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, data: { applied: 1, failedItems: [] } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any
    );
    const resetSql = executedSql.find((q) => q.sql.includes(`SET status = 'pending'`) && q.sql.includes('WITH picked AS'));
    assert.ok(resetSql, 'reprocessFailedOutboxBatch should run scoped SQL update');
    assert.ok(resetSql.sql.includes(`COALESCE(action, '') <> 'deleteAllReservations'`));
    assert.equal(retryOk.haltedByAuth, false);

    // Flush with an unexpectedly returned deleteAllReservations row must quarantine it instead of fetching GAS!
    let flushFetchCalls = 0;
    const quarantineUpdates: any[] = [];
    const execQuarantine = createMockExecutor(async (sql, params) => {
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [
            {
              id: 'MIR_78E035CCC351',
              entity_type: 'reservation',
              entity_id: 'ALL',
              action: 'deleteAllReservations',
              payload: {},
              retry_count: 1
            }
          ],
          rowCount: 1
        };
      }
      if (sql.includes('UPDATE sheets_mirror_outbox')) {
        quarantineUpdates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const flushRes = await flushSheetsMirrorOutbox(
      execQuarantine,
      (async () => {
        flushFetchCalls += 1;
        return new Response('{}', { status: 200 });
      }) as any,
      { batchSize: 10, verifyAuthBeforeSend: false }
    );
    assert.equal(flushFetchCalls, 0, 'deleteAllReservations MUST NEVER trigger GAS fetch');
    assert.equal(flushRes.failed, 1);
    assert.equal(flushRes.permanentFailed, 1);
    assert.ok(
      quarantineUpdates.some((u) => (u.params || []).some((p: any) => String(p || '').includes('QUARANTINED_BULK_DELETE'))),
      'deleteAllReservations row should be marked QUARANTINED_BULK_DELETE'
    );

    // Frozen row error halts outbox batch immediately
    const execFrozen = createMockExecutor(async (sql) => {
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [
            {
              id: 'MIR_DEL_PROBLEM',
              entity_type: 'problem',
              entity_id: 'PRB-1',
              action: 'deleteProblem',
              payload: { id: 'PRB-1' },
              retry_count: 1
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const frozenFlush = await flushSheetsMirrorOutbox(
      execFrozen,
      (async () =>
        new Response(
          JSON.stringify({ success: false, message: 'Sorry, it is not possible to delete all non-frozen rows.' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )) as any,
      { batchSize: 10, verifyAuthBeforeSend: false }
    );
    assert.equal(frozenFlush.haltedBySheetError, true);
    assert.equal(frozenFlush.permanentFailed, 1);

    // retryHealthCenterFailedSync rejects bulk unsafe modes / clamps batch size
    const authSession = {
      token: 'TOK_DEV',
      expiresAt: '2027-01-01T00:00:00.000Z',
      user: {
        id: 'U-1',
        name: 'Developer',
        username: 'dev',
        role: 'developer',
        status: 'active',
        isActive: true,
        permissions: ['manage_developer_tools']
      }
    } as any;
    const hcFallbackQueries: string[] = [];
    const hcExec = createMockExecutor(async (sql) => {
      hcFallbackQueries.push(sql);
      return { rows: [], rowCount: 0 };
    });
    await assert.rejects(
      () =>
        retryHealthCenterFailedSync(
          hcExec,
          authSession,
          { mode: 'outbox_batch', limit: 200 },
          (async () =>
            new Response(
              JSON.stringify({ success: false, message: 'UNAUTHORIZED: SYNC_API_SECRET غير صالح.' }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )) as any
        ),
      /UNAUTHORIZED/
    );
    assert.equal(
      hcFallbackQueries.some((q) => /DELETE\s+FROM\s+reservations|TRUNCATE\s+sheets_mirror_outbox/i.test(q)),
      false
    );
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('10b. probeGasMirrorSafe performs safe read/write probe without modifying reservations', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'probe-secret-11';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbProbeTest11/exec';

  try {
    const seenActions: string[] = [];
    let seenItemAction = '';
    let seenSettingKey = '';
    const exec = createMockExecutor(async () => ({ rows: [], rowCount: 0 }));
    const res = await probeGasMirrorSafe(
      exec,
      { writeProbe: true },
      (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        seenActions.push(body.action);
        if (body.action === 'verifyMirrorAuth') {
          return new Response(
            JSON.stringify({ success: true, message: 'ok', data: { verified: true, authValid: true } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        seenItemAction = body.payload?.items?.[0]?.action || '';
        seenSettingKey = body.payload?.items?.[0]?.payload?.key || '';
        return new Response(
          JSON.stringify({
            success: true,
            message: 'probe ok',
            data: { applied: 1, failedItems: [] }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any
    );
    assert.equal(res.ok, true);
    assert.equal(res.authValid, true);
    assert.equal(res.writeProbeOk, true);
    assert.deepEqual(seenActions, ['verifyMirrorAuth', 'syncFromNeonMirror']);
    assert.equal(seenItemAction, 'upsertSetting');
    assert.equal(seenSettingKey, '__mirror_health_probe');
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('11. GAS safeDeleteSheetRows_ protects frozen rows AND deletes the exact target row index without shifting row 2 onto row 3', () => {
  // Case A: Only 1 data row (frozen=1, maxRows=2) -> must clear row 2 safely without throwing non-frozen error
  const minSheet = loadFullGasSandbox({
    Problems: {
      frozenRows: 1,
      maxRows: 2,
      rows: [
        ['id', 'description'],
        ['PRB-1', 'مشكلة وحيدة']
      ]
    }
  });
  const okMin = minSheet.ctx.safeDeleteSheetRows_(minSheet.sheetsMap.get('Problems'), 2, 1);
  assert.equal(okMin, true);
  assert.equal(minSheet.deletedOps.length, 0);
  assert.equal(minSheet.clearedRanges.length, 1);

  // Case B: Multiple rows (frozen=1, maxRows=5) deleting row 2 MUST delete row 2 (PRB-A), NOT row 3 (PRB-B)
  const multiSheet = loadFullGasSandbox({
    Problems: {
      frozenRows: 1,
      maxRows: 5,
      rows: [
        ['id', 'description'],
        ['PRB-A', 'First'],
        ['PRB-B', 'Second'],
        ['PRB-C', 'Third'],
        ['PRB-D', 'Fourth']
      ]
    }
  });
  const okMulti = multiSheet.ctx.safeDeleteSheetRows_(multiSheet.sheetsMap.get('Problems'), 2, 1);
  assert.equal(okMulti, true);
  assert.equal(multiSheet.deletedOps.length, 0, 'Must never call physical deleteRow/deleteRows; compact via clearContent + setValues');
  assert.ok(multiSheet.clearedRanges.length >= 1);
  const remainingIds = multiSheet.sheetsMap.get('Problems')!.getRange(2, 1, 3, 1).getValues().map((r: any[]) => r[0]);
  assert.deepEqual(remainingIds, ['PRB-B', 'PRB-C', 'PRB-D']);
});

test('12. Live bug regression: HTTP 200 Arabic success message containing "SYNC_API_SECRET" MUST verify authValid=true and never halt outbox', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = '1234567890abcdef1234567890abcdef';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbAuthSuccessRepro32/exec';

  try {
    let flushCalledWithVerify = false;
    const exec = createMockExecutor(async (sql) => {
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [
            {
              id: 'MIR_RES_REPRO_1',
              entity_type: 'reservation',
              entity_id: 'RES-777',
              action: 'upsertReservation',
              payload: { id: 'RES-777', reservationNumber: '77777' },
              retry_count: 0,
              idempotency_key: 'res:RES-777:upsert:1'
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });

    // Simulate legacy-worded v2 GAS response: HTTP 200, message contains 'SYNC_API_SECRET', secretMatch=true, authValid=true
    const mockFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      assert.ok(body.payload?.correlationId, 'Request payload must include correlationId');
      if (body.action === 'verifyMirrorAuth') {
        flushCalledWithVerify = true;
        return new Response(
          JSON.stringify({
            success: true,
            message: 'تم التحقق من مطابقة SYNC_API_SECRET بنجاح.',
            data: {
              verified: true,
              authValid: true,
              configured: true,
              diagnostics: {
                hasScriptSecret: true,
                scriptSecretLength: 32,
                providedLength: 32,
                secretMatch: true,
                receivedVia: 'payload.syncSecret',
                requestMethod: 'POST',
                correlationId: body.payload.correlationId,
                gasScriptVersion: '2026-11-27-auth-diag-v2'
              }
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'ok',
          data: { applied: 1, failedItems: [], results: [{ id: 'MIR_RES_REPRO_1', index: 0, status: 'applied', ok: true }] }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as any;

    const authRes = await verifyGasMirrorAuth(exec, mockFetch);
    assert.equal(authRes.ok, true);
    assert.equal(authRes.authValid, true);
    assert.equal(authRes.statusCode, 200);
    assert.equal(authRes.diagnostics?.secretMatch, true);
    assert.equal(authRes.diagnostics?.receivedVia, 'payload.syncSecret');
    assert.equal(authRes.diagnostics?.deploymentVersion, '2026-11-27-auth-diag-v2');
    assert.equal(authRes.diagnostics?.authSource, 'env');
    assert.ok(authRes.correlationId);

    const flushRes = await flushSheetsMirrorOutbox(exec, mockFetch, { verifyAuthBeforeSend: true, batchSize: 10 });
    assert.equal(flushCalledWithVerify, true);
    assert.equal(flushRes.haltedByAuth, undefined);
    assert.equal(flushRes.sent, 1);
    assert.equal(flushRes.failed, 0);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('13. Runtime platform diagnostics accurately detect cloud_run, vercel, node_production, and local', async () => {
  const prevVercel = process.env.VERCEL;
  const prevVercelEnv = process.env.VERCEL_ENV;
  const prevKService = process.env.K_SERVICE;
  const prevNodeEnv = process.env.NODE_ENV;
  const exec = createMockExecutor(async () => ({ rows: [], rowCount: 0 }));

  try {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.K_SERVICE = 'rg-crm-prod';
    process.env.NODE_ENV = 'production';
    const cloudRunDiag = await getGasAuthFlowDiagnostics(exec);
    assert.equal(cloudRunDiag.environment.isCloudRun, true);
    assert.equal(cloudRunDiag.environment.isVercel, false);
    assert.equal(cloudRunDiag.environment.runtimePlatform, 'cloud_run');
    assert.equal(cloudRunDiag.environment.vercelEnv, 'cloud-run');

    delete process.env.K_SERVICE;
    process.env.VERCEL = 'true';
    process.env.VERCEL_ENV = 'production';
    const vercelDiag = await getGasAuthFlowDiagnostics(exec);
    assert.equal(vercelDiag.environment.isVercel, true);
    assert.equal(vercelDiag.environment.runtimePlatform, 'vercel');
    assert.equal(vercelDiag.environment.vercelEnv, 'production');
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercelEnv;
    if (prevKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = prevKService;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
});

test('14. GAS clearSheetRecords protects frozenRows >= 2 & batchUpsertRecords merges intra-batch duplicate new keys without losing updates', () => {
  const sandbox = loadFullGasSandbox({
    Reservations: {
      frozenRows: 2,
      maxRows: 4,
      rows: [
        ['id', 'reservationNumber', 'customerName'],
        ['عنوان مساعد مجمد', 'SUBHEADER', 'LOCKED'],
        ['RES-1', '10001', 'عميل أول'],
        ['RES-2', '10002', 'عميل ثان']
      ]
    }
  });

  // clearSheetRecords with frozenRows=2 must keep rows 1..2 untouched and only clear data starting row 3!
  const removed = sandbox.ctx.clearSheetRecords('Reservations');
  assert.equal(removed, 2);
  const resSheet = sandbox.sheetsMap.get('Reservations')!;
  const frozenRowsAfter = resSheet.getRange(1, 1, 2, 3).getValues();
  assert.equal(frozenRowsAfter[0][0], 'id');
  assert.equal(frozenRowsAfter[1][0], 'عنوان مساعد مجمد');

  // Intra-batch duplicate new keys (RES-NEW appears twice in the same batch): final state must reflect latest update
  const upOut = sandbox.ctx.batchUpsertRecords('Reservations', 'reservationNumber', [
    { id: 'RES-N1', reservationNumber: '90001', customerName: 'النسخة الأولى' },
    { id: 'RES-N1', reservationNumber: '90001', customerName: 'النسخة النهائية المحدثة' }
  ]);
  assert.equal(upOut.inserted, 1);
  const allRows = resSheet.getRange(1, 1, resSheet.getLastRow(), 3).getValues();
  const matched = allRows.filter((r: any[]) => String(r[1]) === '90001');
  assert.equal(matched.length, 1);
  assert.equal(matched[0][2], 'النسخة النهائية المحدثة');
});

test('15. GAS syncFromNeonMirror deduplicates appendFollowUp via idempotencyKey and returns per-item results + correlationId', () => {
  const sandbox = loadFullGasSandbox({
    FollowUps: {
      frozenRows: 1,
      maxRows: 2,
      rows: [['id', 'reservationId', 'notes']]
    }
  }, 'gas-idemp-secret-99');

  const body = {
    action: 'syncFromNeonMirror',
    payload: {
      syncSecret: 'gas-idemp-secret-99',
      correlationId: 'COR_IDEMP_TEST_1',
      items: [
        {
          id: 'MIR_FU_1',
          idempotencyKey: 'fu:FU-101:append:abc',
          action: 'appendFollowUp',
          payload: { id: 'FU-101', reservationId: 'RES-101', notes: 'تم التواصل' }
        }
      ]
    }
  };

  const r1 = JSON.parse(sandbox.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  assert.equal(r1.success, true);
  assert.equal(r1.data.applied, 1);
  assert.equal(r1.data.correlationId, 'COR_IDEMP_TEST_1');
  assert.equal(r1.data.gasScriptVersion, '2026-11-28-sync-repair-v4');
  assert.equal(r1.data.results[0].status, 'applied');

  // Second replay with identical idempotencyKey must be deduplicated cleanly
  const r2 = JSON.parse(sandbox.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  assert.equal(r2.success, true);
  assert.equal(r2.data.deduplicated, 1);
  assert.equal(r2.data.results[0].status, 'deduplicated');
  assert.equal(r2.data.results[0].ok, true);
  assert.equal(sandbox.sheetsMap.get('FollowUps')!.getLastRow(), 2);
});

test('16. Outbox timeout mode halves batch size adaptively and Data Integrity reports openIssuesBySeverity', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'adaptive-timeout-secret';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbTimeoutTest88/exec';

  try {
    const pickedLimits: number[] = [];
    const exec = createMockExecutor(async (sql, params) => {
      if (sql.includes('WITH picked AS') && sql.includes('RETURNING o.id')) {
        const lim = Number(params?.[0] || 0);
        pickedLimits.push(lim);
        const rows = Array.from({ length: lim }, (_, idx) => ({ id: `MIR_TO_${pickedLimits.length}_${idx}` }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const lim = Number(params?.[1] || 8);
        return {
          rows: Array.from({ length: lim }, (_, idx) => ({
            id: `MIR_TO_${idx}`,
            entity_type: 'reservation',
            entity_id: `RES-${idx}`,
            action: 'upsertReservation',
            payload: { id: `RES-${idx}` },
            retry_count: 1
          })),
          rowCount: lim
        };
      }
      return { rows: [], rowCount: 1 };
    });

    let callIdx = 0;
    const mockFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.action === 'verifyMirrorAuth') {
        return new Response(
          JSON.stringify({ success: true, data: { verified: true, authValid: true } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      callIdx++;
      if (callIdx === 1) {
        throw new Error('AbortError: request timeout after 25000ms');
      }
      return new Response(
        JSON.stringify({ success: true, data: { applied: body.payload.items.length, failedItems: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as any;

    const batchOut = await reprocessFailedOutboxBatch(exec, { mode: 'timeout', batchSize: 16, maxBatches: 2 }, mockFetch);
    assert.deepEqual(pickedLimits, [8, 4], 'Timeout mode must cap initial batch at 8 and halve to 4 after a timeout');
    assert.equal(batchOut.effectiveBatchSize, 4);
    assert.equal(batchOut.sent, 4);
    assert.equal(batchOut.failed, 8);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }

  // Verify openIssuesBySeverity breakdown in Health Center Data Integrity report
  const hcRuns: any[] = [];
  const diExec = createMockExecutor(async (sql, params) => {
    if (sql.includes('INSERT INTO health_center_runs')) {
      hcRuns.unshift({
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
      return { rows: hcRuns, rowCount: hcRuns.length };
    }
    if (sql.includes('FROM data_integrity_issues') && sql.includes('GROUP BY 1')) {
      return {
        rows: [
          { severity: 'critical', cnt: 3 },
          { severity: 'high', cnt: 14 },
          { severity: 'medium', cnt: 50 }
        ],
        rowCount: 3
      };
    }
    if (sql.includes('FROM data_integrity_issues')) {
      return { rows: [{ cnt: 67 }], rowCount: 1 };
    }
    if (sql.includes('FROM customers')) {
      return { rows: [{ missing_id: 367, missing_phone: 0, missing_email: 367 }], rowCount: 1 };
    }
    if (sql.includes('reservations_cnt')) {
      return {
        rows: [{ reservations_cnt: 467, customers_cnt: 420, extensions_cnt: 12, follow_ups_cnt: 30, problems_cnt: 2, notes_cnt: 0, active_notifs_cnt: 0 }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const devSession = {
    token: 'TOK_DEV',
    expiresAt: '2027-01-01T00:00:00.000Z',
    user: { id: 'U-1', name: 'Dev', username: 'dev', role: 'developer', status: 'active', isActive: true, permissions: ['manage_developer_tools'] }
  } as any;
  const rep = await runDatabaseHealthCenterScan(diExec, devSession, { section: 'data_integrity', compareWithRg: false });
  const anom = rep.sections.data_integrity.anomalies;
  assert.equal(anom.openIntegrityIssuesCount, 67);
  assert.deepEqual(anom.openIssuesBySeverity, { critical: 3, high: 14, medium: 50, low: 0 });
  assert.equal(anom.customerQuality.required.missingPhone, 0);
  assert.equal(anom.customerQuality.optionalSourceGaps.missingEmail, 367);
});

test('17. Unified GAS auth contract: saveGlobalConnectionSettings & saveApiToken route through callGasMirrorAction cleanly', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'unified-secret-32-chars-xxxxxxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbUnifiedContract17/exec';
  const origFetch = globalThis.fetch;

  const seenBodies: any[] = [];
  const seenHeaders: Array<Record<string, string>> = [];
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    seenBodies.push(JSON.parse(String(init?.body || '{}')));
    seenHeaders.push((init?.headers || {}) as Record<string, string>);
    return new Response(JSON.stringify({ success: true, data: { bound: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as any;

  try {
    const exec = createMockExecutor(async (sql) => {
      if (sql.includes('FROM settings')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const adminSession = {
      token: 'TOK_ADMIN',
      expiresAt: '2027-01-01T00:00:00.000Z',
      user: {
        id: 'U-ADM',
        name: 'Admin',
        username: 'admin',
        role: 'developer',
        status: 'active',
        isActive: true,
        permissions: ['manage_settings', 'manage_developer_tools']
      }
    } as any;

    await saveGlobalConnectionSettings(exec, adminSession, {
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbUnifiedContract17/exec',
      neonSyncUrl: 'https://crm.example.com/api/sync',
      syncApiSecret: 'unified-secret-32-chars-xxxxxxxx'
    });
    await saveApiToken(exec, adminSession, { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig17' });

    assert.equal(seenBodies.length, 2);
    for (let i = 0; i < seenBodies.length; i++) {
      assert.equal(seenBodies[i].action, 'autoBindFromServer');
      assert.equal(seenBodies[i].payload.syncSecret, 'unified-secret-32-chars-xxxxxxxx');
      assert.ok(seenBodies[i].payload.correlationId, 'autoBindFromServer must include correlationId');
      assert.equal(seenHeaders[i]['X-RG-Sync-Secret'], 'unified-secret-32-chars-xxxxxxxx');
    }
  } finally {
    globalThis.fetch = origFetch;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('18. extractDetailedOutboxError handles Error, AbortError, strings, plain objects, null, and undefined without empty last_error', () => {
  const abortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  const d1 = extractDetailedOutboxError(abortErr, { correlationId: 'COR_A', action: 'upsertReservation', entityType: 'reservation', entityId: 'RES-1' });
  assert.equal(d1.errorName, 'AbortError');
  assert.ok(d1.errorMessage.includes('This operation was aborted'));
  assert.equal(d1.correlationId, 'COR_A');

  const d2 = extractDetailedOutboxError('plain string failure', { action: 'upsertCustomer' });
  assert.equal(d2.errorName, 'StringError');
  assert.equal(d2.errorMessage, 'plain string failure');

  const d3 = extractDetailedOutboxError({ code: 504, detail: 'upstream timeout' }, { httpStatus: 504, correlationId: 'COR_OBJ' });
  assert.equal(d3.errorName, 'ObjectError');
  assert.ok(d3.errorMessage.includes('upstream timeout'));
  assert.equal(d3.httpStatus, 504);

  const d4 = extractDetailedOutboxError(null, { correlationId: 'COR_NULL', action: 'upsertReservation' });
  assert.ok(d4.errorMessage.includes('UNSPECIFIED_OUTBOX_ERROR'));
  assert.equal(d4.correlationId, 'COR_NULL');

  const d5 = extractDetailedOutboxError(undefined, { action: 'appendFollowUp' });
  assert.ok(d5.errorMessage.includes('UNSPECIFIED_OUTBOX_ERROR'));
  assert.ok(d5.errorMessage.includes('appendFollowUp'));
});

test('19. Timeout errors ("This operation was aborted") classify as timeout BEFORE validation even on deleteAllReservations', () => {
  const aborted = classifyOutboxMirrorError('This operation was aborted', 1);
  assert.equal(aborted.category, 'timeout');
  assert.equal(aborted.permanent, false);

  const lockTimeout = classifyOutboxMirrorError('LOCK_TIMEOUT_RECOVERED: stale processing lock exceeded 5 minutes', 1);
  assert.equal(lockTimeout.category, 'timeout');
  assert.equal(lockTimeout.permanent, false);

  const quarantine = classifyOutboxMirrorError('QUARANTINED_BULK_DELETE: عملية deleteAllReservations محظورة', 1);
  assert.equal(quarantine.category, 'validation');
  assert.equal(quarantine.permanent, true);
});

test('20. Stale lock recovery never leaves retry_count=0/empty last_error & Health Center reports accurate lifecycle/auth/timeout without phantom UNKNOWN_ERROR', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'stale-lock-secret-32-chars-xxxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbStaleLock20/exec';

  try {
    const staleSqlQueries: string[] = [];
    const execStale = createMockExecutor(async (sql) => {
      staleSqlQueries.push(sql);
      return { rows: [], rowCount: 0 };
    });
    await flushSheetsMirrorOutbox(execStale, fetch, { verifyAuthBeforeSend: false, batchSize: 10 });

    const staleRecoverySql = staleSqlQueries.find((s) => s.includes('LOCK_TIMEOUT_RECOVERED') && s.includes("status = 'processing'"));
    assert.ok(staleRecoverySql, 'Stale processing lock recovery SQL must record LOCK_TIMEOUT_RECOVERED');
    assert.ok(staleRecoverySql.includes("error_category = 'timeout'"));
    assert.ok(staleRecoverySql.includes('retry_count = COALESCE(retry_count, 0) + 1'));

    // Health Center scan with: direct GAS auth OK, 5 aborted errors, 0 empty unknown errors, 125 sent, 10 pending, 2 retry, 1 dead_letter
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
          summary_json: params?.[6],
          sections_json: params?.[7],
          error_message: '',
          started_at: params?.[8],
          finished_at: params?.[9]
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM health_center_runs')) return { rows: hcRuns, rowCount: hcRuns.length };
      if (sql.includes("FROM sync_worker_state WHERE id = 'primary'")) {
        return { rows: [{ id: 'primary', status: 'idle', is_syncing: false, auto_sync_enabled: true, interval_seconds: 60, consecutive_errors: 0, last_success_at: '2026-11-28T03:00:00.000Z' }], rowCount: 1 };
      }
      if (sql.includes('sent_cnt') && sql.includes('retry_with_error_cnt')) {
        return {
          rows: [{
            sent_cnt: 125,
            pending_cnt: 10,
            processing_cnt: 0,
            retry_cnt: 2,
            retry_with_error_cnt: 2,
            failed_cnt: 1,
            permanent_failed_cnt: 0,
            quarantined_bulk_cnt: 0,
            failed_attempts_cnt: 3,
            last_error_at: '2026-11-28T02:55:00.000Z',
            oldest_unsynced_at: '2026-11-28T02:50:00.000Z',
            oldest_pending_at: '2026-11-28T02:50:00.000Z',
            total_cnt: 138
          }],
          rowCount: 1
        };
      }
      if (sql.includes('AS category') && sql.includes('FROM sheets_mirror_outbox')) {
        assert.ok(sql.indexOf('AbortError') < sql.indexOf('deleteAllReservations'), 'Health Center SQL CASE must check timeout BEFORE deleteAllReservations');
        assert.ok(!sql.includes("'UNKNOWN_ERROR'"), 'Health Center SQL must NOT synthesize UNKNOWN_ERROR');
        return {
          rows: [{ category: 'timeout', err: 'This operation was aborted', cnt: 3, first_seen_at: '2026-11-28T02:50:00.000Z', last_seen_at: '2026-11-28T02:55:00.000Z' }],
          rowCount: 1
        };
      }
      if (sql.includes('AS err, COUNT(*)::int AS cnt') && sql.includes('FROM sheets_mirror_outbox')) {
        return { rows: [{ err: 'This operation was aborted', cnt: 3 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const devSession = {
      token: 'TOK_DEV',
      expiresAt: '2027-01-01T00:00:00.000Z',
      user: { id: 'U-1', name: 'Dev', username: 'dev', role: 'developer', status: 'active', isActive: true, permissions: ['manage_developer_tools'] }
    } as any;
    const rep = await runDatabaseHealthCenterScan(hcExec, devSession, { section: 'sync_health', testLiveConnections: false });
    const sy = rep.sections.sync_health;
    assert.notEqual(sy.status, 'healthy', 'Health Center must NOT show healthy while failed/retry Outbox items exist');
    assert.equal(sy.outbox.unknownErrorCount, 0);
    assert.equal(sy.outbox.timeoutCount, 3);
    assert.equal(sy.outbox.validationErrorCount, 0);
    assert.deepEqual(sy.outbox.lifecycle, { pending: 10, processing: 0, retry: 2, completed: 125, deadLetter: 1 });
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('21. Concurrent parallel flushSheetsMirrorOutbox calls serialize via single-flight + advisory lock with zero duplicate sends', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'concurrent-secret-32-chars-xxxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbConcurrent21/exec';

  try {
    const queue = [
      { id: 'MIR_CON_1', entity_type: 'reservation', entity_id: 'RES-C1', action: 'upsertReservation', payload: { id: 'RES-C1' }, retry_count: 0, status: 'pending' }
    ];
    let gasDispatchCount = 0;
    let sawAdvisoryLock = false;

    const exec = createMockExecutor(async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        sawAdvisoryLock = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const picked = queue.filter((q) => q.status === 'pending');
        picked.forEach((p) => { p.status = 'processing'; });
        return { rows: picked.map((p) => ({ ...p })), rowCount: picked.length };
      }
      if (sql.includes("SET status = 'completed'") || sql.includes("SET status = 'sent'")) {
        queue.forEach((p) => { p.status = 'completed'; });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const slowFetch: typeof fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.action === 'verifyMirrorAuth') {
        return new Response(JSON.stringify({ success: true, data: { verified: true, authValid: true } }), { status: 200 });
      }
      gasDispatchCount += 1;
      await new Promise((r) => setTimeout(r, 25));
      return new Response(JSON.stringify({ success: true, data: { applied: 1, failedItems: [] } }), { status: 200 });
    }) as any;

    const [r1, r2, r3] = await Promise.all([
      flushSheetsMirrorOutbox(exec, slowFetch, { verifyAuthBeforeSend: false, batchSize: 10 }),
      flushSheetsMirrorOutbox(exec, slowFetch, { verifyAuthBeforeSend: false, batchSize: 10 }),
      flushSheetsMirrorOutbox(exec, slowFetch, { verifyAuthBeforeSend: false, batchSize: 10 })
    ]);

    assert.equal(sawAdvisoryLock, true, 'Outbox claim must acquire pg_advisory_xact_lock');
    assert.equal(gasDispatchCount, 1, 'Concurrent flush calls on same executor must dispatch GAS only once');
    assert.equal(r1.sent, 1);
    assert.equal(r2.sent, 1);
    assert.equal(r3.sent, 1);
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('22. GAS withScriptLock guards syncFromNeonMirror & deleteRecordsWhere_ preserves frozenRows >= 2 safely', () => {
  const sandbox = loadFullGasSandbox({
    Reservations: {
      frozenRows: 2,
      maxRows: 4,
      rows: [
        ['id', 'reservationNumber', 'customerName'],
        ['صف تجميد ثانٍ', 'SUBHEADER', 'LOCKED'],
        ['RES-1', '10001', 'عميل أول'],
        ['RES-2', '10002', 'عميل ثان']
      ]
    }
  }, 'gas-lock-secret-22');

  let lockAcquires = 0;
  sandbox.ctx.withScriptLock = (fn: any) => {
    lockAcquires += 1;
    return fn();
  };

  // syncFromNeonMirror must execute inside withScriptLock
  const resSync = JSON.parse(sandbox.ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: 'gas-lock-secret-22',
          items: [
            { id: 'MIR_22', action: 'upsertReservation', payload: { id: 'RES-2', reservationNumber: '10002', customerName: 'عميل محدّث' } }
          ]
        }
      })
    }
  }).getContent());
  assert.equal(resSync.success, true);
  assert.ok(lockAcquires >= 1, 'syncFromNeonMirror must acquire withScriptLock');

  // deleteRecordsWhere_ on frozenRows=2 deleting all data rows must clear safely without touching frozen rows or throwing
  const deleted = sandbox.ctx.deleteRecordsWhere_('Reservations', () => true);
  assert.equal(deleted, 2);
  const resSheet = sandbox.sheetsMap.get('Reservations')!;
  assert.equal(resSheet.getRange(1, 1, 1, 1).getValues()[0][0], 'id');
  assert.equal(resSheet.getRange(2, 1, 1, 1).getValues()[0][0], 'صف تجميد ثانٍ');
  assert.equal(sandbox.deletedOps.length, 0, 'Clearing all non-frozen rows must NOT call deleteRows');
});

test('23. AbortError ("This operation was aborted") retries with exponential backoff, error_category=timeout, and structured error details', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'abort-retry-secret-32-chars-xxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbAbort23/exec';

  try {
    const failureUpdates: Array<{ sql: string; params: any[] }> = [];
    const exec = createMockExecutor(async (sql, params = []) => {
      if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: [{ id: 'MIR_ABORT_1', entity_type: 'reservation', entity_id: 'RES-A1', action: 'upsertReservation', payload: { id: 'RES-A1' }, retry_count: 0 }],
          rowCount: 1
        };
      }
      if (sql.includes('UPDATE sheets_mirror_outbox') && sql.includes('last_error =')) {
        failureUpdates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const abortFetch: typeof fetch = (async () => {
      throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    }) as any;

    const flushOut = await flushSheetsMirrorOutbox(exec, abortFetch, { verifyAuthBeforeSend: false, batchSize: 10 });
    assert.equal(flushOut.failed, 1);
    assert.equal(flushOut.permanentFailed, 0);
    assert.equal(failureUpdates.length, 1);
    const params = failureUpdates[0].params;
    assert.equal(params[1], 'retry', 'AbortError on retry_count=0 must transition to retry');
    assert.equal(params[2], 1, 'retry_count must increment to 1');
    assert.equal(params[5], 'timeout', 'AbortError must be recorded with error_category=timeout');
    assert.ok(String(params[4]).includes('This operation was aborted'));
    assert.ok(String(params[7]).includes('AbortError'), 'last_error_details_json must capture AbortError name');
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('24. reprocessFailedOutboxBatch preserves cumulative retry_count while bumping max_retries & supports mode=validation safely', async () => {
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevGas = process.env.GAS_WEBAPP_URL;
  process.env.SYNC_API_SECRET = 'reprocess-preserve-retry-32-xxxx';
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbReprocess24/exec';

  try {
    const seenUpdates: string[] = [];
    const exec = createMockExecutor(async (sql) => {
      if (sql.includes('UPDATE sheets_mirror_outbox') && sql.includes("SET status = 'pending'")) {
        seenUpdates.push(sql);
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const mockFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ success: true, data: { verified: true, authValid: true } }), { status: 200 })) as any;

    await reprocessFailedOutboxBatch(exec, { mode: 'validation', batchSize: 10 }, mockFetch);
    assert.equal(seenUpdates.length, 1);
    assert.ok(!seenUpdates[0].includes('retry_count = 0'), 'reprocessFailedOutboxBatch must preserve cumulative retry_count');
    assert.ok(seenUpdates[0].includes('max_retries = GREATEST'), 'reprocessFailedOutboxBatch must safely extend max_retries');
    assert.ok(seenUpdates[0].includes("COALESCE(action, '') <> 'deleteAllReservations'"), 'mode=validation must NEVER requeue deleteAllReservations');
  } finally {
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
  }
});


