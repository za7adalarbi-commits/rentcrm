import test from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import type { DbClient, DbExecutor, QueryResult } from '../backend/dbCore';
import type { WorkerEnvBindings, WorkerExecutionContext } from '../backend/env';
import { handleWorkerFetch, handleWorkerScheduled, type WorkerTestHooks } from '../backend/worker';

function createWorkerMockExecutor(): DbExecutor & { state: Record<string, any[]>; closedCount: number } {
  const state: Record<string, any[]> = {
    employees: [],
    users: [],
    sessions: [],
    settings: [],
    roles: [],
    permissions: [],
    reservations: [],
    extensions: [],
    assignments: [],
    follow_ups: [],
    follow_up_history: [],
    problems: [],
    issues: [],
    problem_updates: [],
    activity_log: [],
    notifications: [],
    sync_log: [],
    sync_checkpoints: [],
    sheets_mirror_outbox: [],
    error_logs: []
  };

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.includes("to_regclass('public.employees')")) {
      return { rows: [{ reg: 'employees' }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees')) {
      return { rows: [{ cnt: String(state.employees.length) }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO employees')) {
      const [id, name, username, password_hash, salt, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
      if (!state.employees.some((e) => e.username === username)) {
        state.employees.push({
          id, name, username, password_hash, salt, phone, email, job_title, role,
          permissions: JSON.parse(permsJson), status: 'active', last_activity,
          created_at: new Date(created_at), updated_at: new Date(created_at)
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO users')) {
      const [id, name, username, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
      if (!state.users.some((u) => u.username === username)) {
        state.users.push({
          id, name, username, phone, email, job_title, role,
          permissions: JSON.parse(permsJson), status: 'active', last_activity,
          created_at: new Date(created_at), updated_at: new Date(created_at)
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO settings')) {
      const [key, value, updated_by = 'SYSTEM'] = params;
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) state.settings.push({ key, value, updated_by, updated_at: new Date() });
      else if (sql.includes('DO UPDATE')) {
        existing.value = value;
        existing.updated_by = updated_by;
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO roles')) {
      const [id, label, job_title, role, permsJson] = params;
      if (!state.roles.some((r) => r.id === id)) {
        state.roles.push({ id, label, job_title, role, permissions: JSON.parse(permsJson) });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const uname = String(params[0] || '').toLowerCase();
      return { rows: state.employees.filter((e) => e.username.toLowerCase() === uname) as any[], rowCount: 1 };
    }
    if (sql.startsWith("SELECT value FROM settings WHERE key = 'session_ttl_hours'")) {
      const row = state.settings.find((s) => s.key === 'session_ttl_hours');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT value FROM settings WHERE key = 'excluded_statuses'")) {
      const row = state.settings.find((s) => s.key === 'excluded_statuses');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('SELECT key, value FROM settings')) {
      return { rows: state.settings as any[], rowCount: state.settings.length };
    }
    if (sql.startsWith('INSERT INTO sessions')) {
      const [token_hash, employee_id, username, role, expires_at, created_at] = params;
      state.sessions.push({
        token_hash, employee_id, username, role,
        expires_at: new Date(expires_at), created_at: new Date(created_at),
        last_seen_at: new Date(created_at), is_revoked: false
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT s.token_hash, s.employee_id')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0]);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = state.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...ses,
          emp_id: emp.id,
          name: emp.name,
          emp_username: emp.username,
          phone: emp.phone,
          email: emp.email,
          job_title: emp.job_title,
          emp_role: emp.role,
          permissions: emp.permissions,
          emp_status: emp.status,
          last_activity: emp.last_activity,
          created_at: emp.created_at,
          updated_at: emp.updated_at
        }] as any[],
        rowCount: 1
      };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], user_id: params[1], action_type: params[4] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE reservation_number = ANY')) {
      const nums: string[] = params[0] || [];
      const rows = state.reservations.filter((r) => nums.includes(r.reservation_number));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
      const rows = state.reservations.filter((r) => r.id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO reservations (')) {
      const rec = {
        id: params[0],
        source_reservation_id: params[1],
        reservation_number: params[2],
        source_created_at: params[3],
        customer_name: params[4],
        customer_phone: params[5],
        customer_email: params[6],
        customer_id_number: params[7],
        company_name: params[8],
        branch_name: params[9],
        deliver_branch_name: params[10],
        car_name: params[11],
        plate_number: params[12],
        car_category: params[13],
        start_date: params[14],
        start_time: params[15],
        original_end_date: params[16],
        original_end_time: params[17],
        end_date: params[18],
        end_time: params[19],
        extended_until_date: params[20],
        extended_until_time: params[21],
        days_count: params[22],
        extended_days_count: params[23],
        total_days_count: params[24],
        original_status_code: params[25],
        original_status_ar: params[26],
        pickup_type_ar: params[27],
        return_type_ar: params[28],
        payment_method: params[29],
        payment_status: params[30],
        daily_price: params[31],
        discount_amount: params[32],
        vat_amount: params[33],
        base_amount: params[34],
        extensions_count: params[35],
        extensions_amount: params[36],
        total_amount: params[37],
        has_extensions: params[38],
        internal_status: params[39],
        priority: params[40],
        assigned_employee_ids: JSON.parse(params[41]),
        assigned_employee_names: JSON.parse(params[42]),
        last_update_text: params[43],
        last_updated_by_id: params[44],
        last_updated_by_name: params[45],
        last_updated_at: params[46],
        has_problem: params[47],
        created_at: new Date(params[48]),
        updated_at: new Date(params[49]),
        status_history: JSON.parse(params[50]),
        raw_json: params[51]
      };
      const idx = state.reservations.findIndex((r) => r.reservation_number === rec.reservation_number);
      if (idx === -1) {
        state.reservations.push(rec);
        return { rows: [{ inserted: true }] as any[], rowCount: 1 };
      }
      state.reservations[idx] = { ...rec, id: state.reservations[idx].id };
      return { rows: [{ inserted: false }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO follow_ups')) {
      state.follow_ups.push({ id: params[0], reservation_id: params[1], status: params[6] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO follow_up_history')) {
      state.follow_up_history.push({ id: params[0], reservation_id: params[2], new_status: params[8] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE reservations SET internal_status = $2')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.internal_status = params[1];
        r.last_update_text = params[2];
        r.status_history = JSON.parse(params[6]);
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({
        id: params[0], entity_type: params[1], entity_id: params[2], action: params[3],
        payload: JSON.parse(params[4]), status: 'pending', retry_count: 0
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM sheets_mirror_outbox')) {
      const pending = state.sheets_mirror_outbox.filter((o) => o.status === 'pending' || o.status === 'retry');
      return { rows: pending as any[], rowCount: pending.length };
    }
    if (sql.startsWith("UPDATE sheets_mirror_outbox SET status = 'sent'")) {
      const ids: string[] = params[0] || [];
      for (const o of state.sheets_mirror_outbox) {
        if (ids.includes(o.id)) o.status = 'sent';
      }
      return { rows: [], rowCount: ids.length };
    }
    if (sql.startsWith('INSERT INTO sync_log')) {
      state.sync_log.push({
        id: params[0], triggered_by_id: params[1], status: 'success',
        imported_count: params[3], updated_count: params[4], finished_at: new Date(params[9])
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT finished_at FROM sync_log WHERE status = 'success'")) {
      const latest = state.sync_log[state.sync_log.length - 1];
      return { rows: (latest ? [{ finished_at: latest.finished_at }] : []) as any[], rowCount: latest ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{ source: params[0], last_status: 'success', last_batch_count: params[3] }];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM sync_checkpoints WHERE source')) {
      return { rows: state.sync_checkpoints as any[], rowCount: state.sync_checkpoints.length };
    }

    return { rows: [], rowCount: 0 };
  }

  const exec: DbExecutor & { state: Record<string, any[]>; closedCount: number } = {
    state,
    closedCount: 0,
    query: runQuery,
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };
  return exec;
}

function makeCtx(): { ctx: WorkerExecutionContext; promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(p);
      }
    }
  };
}

test('Cloudflare Worker bundles cleanly via esbuild with zero Node pg/fs/createRequire runtime leakage', async () => {
  const result = await esbuild.build({
    entryPoints: ['backend/worker.ts'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['worker', 'browser', 'module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: [
      'node:async_hooks',
      'node:buffer',
      'node:crypto',
      'node:events',
      'node:net',
      'node:stream',
      'node:string_decoder',
      'node:tls',
      'node:url',
      'node:util'
    ]
  });

  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles.length === 1);
  const bundledInputs = Object.keys(result.metafile?.inputs || {});
  assert.equal(
    bundledInputs.some((p) => p.endsWith('backend/db.ts') || p.includes('node_modules/pg/')),
    false,
    `Worker bundle must not include Node pg driver or backend/db.ts. Found: ${bundledInputs.join(', ')}`
  );
  assert.equal(
    bundledInputs.some((p) => p.includes('@neondatabase/serverless')),
    true,
    'Worker bundle must use @neondatabase/serverless'
  );
  const code = result.outputFiles[0].text;
  assert.equal(code.includes('createRequire'), false, 'Worker bundle must not contain createRequire');
  assert.equal(code.includes('database/schema.sql'), false, 'Worker bundle must not depend on runtime schema.sql file');
});

test('Worker /api/health reports Cloudflare Workers runtime and Hyperdrive/DB state', async () => {
  const { ctx } = makeCtx();
  const resUnconfigured = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/health'),
    {},
    ctx
  );
  assert.equal(resUnconfigured.status, 200);
  const jsonUnconf: any = await resUnconfigured.json();
  assert.equal(jsonUnconf.ok, true);
  assert.equal(jsonUnconf.runtime, 'cloudflare-workers');
  assert.equal(jsonUnconf.databaseConfigured, false);

  const resConfigured = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/health'),
    { HYPERDRIVE: { connectionString: 'postgres://hyperdrive-proxy/neondb' } },
    ctx,
    {
      checkHealth: async (env) => ({
        databaseConfigured: true,
        connected: true,
        hyperdriveEnabled: Boolean(env.HYPERDRIVE?.connectionString)
      })
    }
  );
  const jsonConf: any = await resConfigured.json();
  assert.equal(jsonConf.connected, true);
  assert.equal(jsonConf.hyperdriveEnabled, true);
});

test('Worker enforces CORS allowlist on /api/* and delegates SPA routes to ASSETS', async () => {
  const { ctx } = makeCtx();
  const env: WorkerEnvBindings = {
    CORS_ALLOWED_ORIGINS: 'https://crm.example.com',
    ASSETS: {
      fetch: async (req) => new Response(`SPA:${new URL(req instanceof Request ? req.url : String(req)).pathname}`, { status: 200 })
    }
  };

  const blocked = await handleWorkerFetch(
    new Request('https://worker.example.dev/api/crm', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.net' }
    }),
    env,
    ctx
  );
  assert.equal(blocked.status, 403);

  const allowed = await handleWorkerFetch(
    new Request('https://worker.example.dev/api/crm', {
      method: 'OPTIONS',
      headers: { Origin: 'https://crm.example.com' }
    }),
    env,
    ctx
  );
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://crm.example.com');

  const spa = await handleWorkerFetch(
    new Request('https://worker.example.dev/reservations'),
    env,
    ctx
  );
  assert.equal(spa.status, 200);
  assert.equal(await spa.text(), 'SPA:/reservations');
});

test('Worker /api/sync and /api/crm preserve auth, incremental sync, outbox waitUntil flush, and cron trigger', async () => {
  const mockExec = createWorkerMockExecutor();
  const sentGasBatches: any[] = [];
  const hooks: WorkerTestHooks = {
    createExecutor: () => ({
      executor: mockExec,
      hyperdriveEnabled: false,
      close: async () => { mockExec.closedCount++; }
    }),
    fetchFn: (async (url: string, init?: RequestInit) => {
      if (String(url).includes('script.google.com')) {
        sentGasBatches.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ success: true, data: { applied: 1 } }), { status: 200 });
      }
      if (String(url).includes('reservations/filter')) {
        return new Response(JSON.stringify({
          content: [{
            id: 901,
            reservation_number: 'RG-CF-901',
            customer_name: 'عميل كلاودفلير',
            customer_phone: '0500000901',
            status: 'active',
            total_price: 900
          }],
          last: true
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [], last: true }), { status: 200 });
    }) as any
  };

  const env: WorkerEnvBindings = {
    DATABASE_URL: 'postgres://mock-neon/db?sslmode=require',
    SYNC_API_SECRET: 'cf-super-secret-2026',
    GAS_WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbMock/exec',
    RG_TOKEN: 'mock-rg-token-for-worker-cron'
  };

  // 1. Unauthorized /api/sync
  const c1 = makeCtx();
  const unauthSync = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': 'wrong' },
      body: JSON.stringify({ reservations: [] })
    }),
    env,
    c1.ctx,
    hooks
  );
  assert.equal(unauthSync.status, 401);

  // 2. Authorized incremental sync ingest
  const c2 = makeCtx();
  const okSync = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': 'cf-super-secret-2026' },
      body: JSON.stringify({
        source: 'google_apps_script',
        reservations: [{
          id: 'SRC_77',
          reservation_number: 'RG-77',
          customer_name: 'خالد',
          status: 'confirmed',
          total_price: 600
        }]
      })
    }),
    env,
    c2.ctx,
    hooks
  );
  assert.equal(okSync.status, 200);
  const okSyncJson: any = await okSync.json();
  assert.equal(okSyncJson.success, true);
  assert.equal(okSyncJson.data.importedCount, 1);

  // 3. Login via /api/crm & check getTriggerStatus + quickUpdateReservationStatus
  const c3 = makeCtx();
  const loginRes = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', payload: { username: 'admin', password: 'Admin@123' } })
    }),
    env,
    c3.ctx,
    hooks
  );
  const loginJson: any = await loginRes.json();
  assert.equal(loginJson.success, true);
  const token = loginJson.data.token;

  const c4 = makeCtx();
  const trigRes = await handleWorkerFetch(
    new Request('https://crm.example.workers.dev/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'getTriggerStatus', payload: {} })
    }),
    env,
    c4.ctx,
    hooks
  );
  const trigJson: any = await trigRes.json();
  assert.equal(trigJson.success, true);
  assert.equal(trigJson.data.count, 2);

  // 4. Mutation enqueues mirror outbox; scheduled cron flushes it & runs auto-sync when interval elapsed
  mockExec.state.reservations[0] && await mockExec.query(
    `INSERT INTO sheets_mirror_outbox (id, entity_type, entity_id, action, payload, status, retry_count, next_retry_at, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,'pending',0,NOW(),NOW())`,
    ['MIR_CF_1', 'Reservation', 'RES_RG-77', 'upsertReservation', JSON.stringify({ reservationNumber: 'RG-77', internalStatus: 'مؤكد' })]
  );

  // Force last sync timestamp to older than 12h so scheduled trigger fires pullFromRentalGateDirect
  mockExec.state.sync_log = [{ id: 'OLD', status: 'success', finished_at: new Date(Date.now() - 15 * 3600000) }];

  const c5 = makeCtx();
  const cronResult = await handleWorkerScheduled(
    { cron: '*/15 * * * *', scheduledTime: Date.now() },
    env,
    c5.ctx,
    hooks
  );
  assert.equal(cronResult.skipped, false);
  assert.equal(cronResult.outbox?.sent, 1);
  assert.equal(cronResult.autoSyncTriggered, true);
  assert.equal(sentGasBatches.length >= 1, true);
  assert.equal(mockExec.state.reservations.some((r) => r.reservation_number === 'RG-CF-901'), true);
  assert.ok(mockExec.closedCount >= 4, 'Request-scoped pools must close cleanly');
});
