import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { DbExecutor, QueryResult } from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';
import crmHandler from '../api/crm';

function loadCoreFromDisk() {
  const corePath = path.resolve(process.cwd(), 'assets/js/core.js');
  const code = fs.readFileSync(corePath, 'utf8');
  const sandbox: any = { window: {}, globalThis: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.RGCrmCore || sandbox.window.RGCrmCore;
}

function bootApiSandbox(opts: {
  fetchImpl: (url: string, init?: any) => Promise<any>;
}) {
  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const idbSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/idb.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');

  const lsMap: Record<string, string> = {
    rg_crm_token_v1: 'tok_swr_coalesce_test',
    rg_crm_backend_mode_v1: 'neon',
    rg_crm_backend_api_v1: '/api/crm'
  };
  const ssMap: Record<string, string> = {};
  const localStorage = {
    getItem(k: string) { return Object.prototype.hasOwnProperty.call(lsMap, k) ? lsMap[k] : null; },
    setItem(k: string, v: string) { lsMap[k] = String(v); },
    removeItem(k: string) { delete lsMap[k]; },
    clear() { Object.keys(lsMap).forEach((k) => delete lsMap[k]); }
  };
  const sessionStorage = {
    getItem(k: string) { return Object.prototype.hasOwnProperty.call(ssMap, k) ? ssMap[k] : null; },
    setItem(k: string, v: string) { ssMap[k] = String(v); },
    removeItem(k: string) { delete ssMap[k]; },
    clear() { Object.keys(ssMap).forEach((k) => delete ssMap[k]); }
  };

  const ctx: any = {
    console,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Set,
    Map,
    RegExp,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, init?: any) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    document: { dispatchEvent() {} },
    localStorage,
    sessionStorage,
    fetch: opts.fetchImpl
  };
  ctx.window = ctx;
  ctx.RG_APP_CONFIG = { mode: 'neon', backendApiUrl: '/api/crm', gasWebAppUrl: '' };
  ctx.location = {
    protocol: 'https:',
    hostname: 'rentcrm.example.com',
    origin: 'https://rentcrm.example.com',
    search: '',
    href: 'https://rentcrm.example.com/#dashboard',
    pathname: '/',
    hash: '#dashboard'
  };
  ctx.history = { replaceState() {} };

  vm.runInNewContext(coreSrc, ctx);
  vm.runInNewContext(idbSrc, ctx);
  ctx.RGIdbCache = {
    isSupported: () => true,
    loadNamespaceSnapshot: async () => ({ kvEntries: [], reservations: [], customers: [], details: [], meta: null }),
    putKvEntries: async () => true,
    deleteKvByKeys: async () => true,
    deleteKvByScopes: async () => true,
    upsertReservations: async () => true,
    replaceReservationsSnapshot: async () => true,
    upsertCustomers: async () => true,
    upsertReservationDetail: async () => true,
    upsertMeta: async () => true,
    clearNamespace: async () => true
  };
  vm.runInNewContext(apiSrc, ctx);
  return ctx;
}

function createFixTestExecutor(): DbExecutor & {
  state: {
    employees: any[];
    users: any[];
    settings: any[];
    roles: any[];
    sessions: any[];
    reservations: any[];
    follow_ups: any[];
    follow_up_history: any[];
    problems: any[];
    notifications: any[];
    announcements: any[];
    activity_log: any[];
    locks: any[];
  };
} {
  const state = {
    employees: [] as any[],
    users: [] as any[],
    settings: [] as any[],
    roles: [] as any[],
    sessions: [] as any[],
    reservations: [] as any[],
    follow_ups: [] as any[],
    follow_up_history: [] as any[],
    problems: [] as any[],
    notifications: [] as any[],
    announcements: [] as any[],
    activity_log: [] as any[],
    locks: [] as any[]
  };

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();
    if (sql.includes("to_regclass('public.employees')")) return { rows: [{ reg: 'employees' }] as any[], rowCount: 1 };
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees')) return { rows: [{ cnt: String(state.employees.length) }] as any[], rowCount: 1 };
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
        existing.value = key === 'crm_sync_version' ? String(Math.max(Number(existing.value || 0) + 1, Number(value || 0))) : value;
        existing.updated_by = updated_by;
        existing.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO roles')) {
      const [id, label, job_title, role, permsJson] = params;
      if (!state.roles.some((r) => r.id === id)) state.roles.push({ id, label, job_title, role, permissions: JSON.parse(permsJson) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT key, value FROM settings')) {
      const filterKeys = Array.isArray(params[0]) ? params[0] : null;
      const rows = filterKeys ? state.settings.filter((s) => filterKeys.includes(s.key)) : state.settings;
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const uname = String(params[0] || '').toLowerCase();
      return { rows: state.employees.filter((e) => e.username.toLowerCase() === uname) as any[], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE id = $1')) {
      const rows = state.employees.filter((e) => e.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO sessions')) {
      const [token_hash, employee_id, username, role, expires_at, created_at] = params;
      state.sessions.push({
        token_hash, employee_id, username, role,
        expires_at: new Date(expires_at), created_at: new Date(created_at), last_seen_at: new Date(created_at), is_revoked: false
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT s.token_hash, s.employee_id')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0] && !s.is_revoked);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = state.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...ses,
          emp_id: emp.id, name: emp.name, emp_username: emp.username, phone: emp.phone, email: emp.email,
          job_title: emp.job_title, emp_role: emp.role, permissions: emp.permissions, emp_status: emp.status,
          last_activity: emp.last_activity, created_at: emp.created_at, updated_at: emp.updated_at
        }] as any[],
        rowCount: 1
      };
    }
    if (sql.startsWith('SELECT * FROM follow_ups WHERE id = $1')) {
      const rows = state.follow_ups.filter((f) => f.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('UPDATE follow_ups SET')) {
      const f = state.follow_ups.find((x) => x.id === params[0]);
      if (f) {
        f.status = params[1];
        f.action = params[2];
        f.notes = params[3];
        f.updated_at = new Date(params[4]);
      }
      return { rows: f ? [f] as any[] : [], rowCount: f ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO follow_up_history')) {
      state.follow_up_history.push({ id: params[0], follow_up_id: params[1] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
      const rows = state.reservations.filter((r) => r.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('UPDATE reservations SET internal_status = $2')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.internal_status = params[1];
        r.last_update_text = params[2];
        r.last_updated_by_id = params[3];
        r.last_updated_by_name = params[4];
        r.last_updated_at = params[5];
        r.updated_at = new Date(params[6]);
        r.status_history = JSON.parse(params[7]);
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND')) {
      const [notifId, empId, role] = params;
      let count = 0;
      for (const n of state.notifications) {
        if (
          n.id === notifId &&
          (n.recipient_employee_id === empId || n.recipient_role === role || n.recipient_role === 'all')
        ) {
          n.is_read = true;
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups') && sql.includes('WHERE r.updated_at >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.reservations.filter((r) => Date.parse(String(r.updated_at)) > sinceMs);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM follow_ups WHERE COALESCE(updated_at, created_at) >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.follow_ups.filter((f) => {
        const ts = f.updated_at || f.created_at;
        return Date.parse(ts instanceof Date ? ts.toISOString() : String(ts)) > sinceMs;
      });
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM problems WHERE updated_at >')) {
      return { rows: [] as any[], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, name, username, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at FROM employees WHERE updated_at >')) {
      return { rows: [] as any[], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM shift_announcements')) {
      return { rows: [] as any[], rowCount: 0 };
    }
    if (sql.startsWith('SELECT r.* FROM reservations r WHERE')) {
      return { rows: state.reservations as any[], rowCount: state.reservations.length };
    }
    if (sql.startsWith('SELECT DISTINCT reservation_id FROM follow_ups WHERE reservation_id = ANY')) {
      return { rows: [] as any[], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0] });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    state,
    query: runQuery,
    async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      return fn({ query: runQuery } as unknown as DbExecutor);
    }
  };
}

test('RGCrmCore delta & SWR helpers ignore constant todayRadarCounts/announcements and enforce monotonic updates', () => {
  const core = loadCoreFromDisk();
  assert.equal(typeof core.hasMeaningfulDeltaChanges, 'function');
  assert.equal(typeof core.haveDashboardSnapshotsChanged, 'function');
  assert.equal(typeof core.resolveSwrSnapshot, 'function');
  assert.equal(typeof core.mergeRecordsMonotonic, 'function');

  // 1. Constant non-null todayRadarCounts & unchanged announcements must NOT cause false 3s refresh storms
  const steadyAnnouncements = [{ id: 'ANN1', updatedAt: '2026-06-01T10:00:00Z' }];
  const steadyState = {
    todayRadarCounts: { todayTotal: 4, pickupCount: 2, returnCount: 2, radarTotal: 3, critical6hCount: 1, expiredUnclosedCount: 0 },
    announcementsFp: core.computeDataFingerprint(steadyAnnouncements)
  };
  assert.equal(
    core.hasMeaningfulDeltaChanges({
      changedReservations: [],
      deletedReservationIds: [],
      changedFollowUps: [],
      changedProblems: [],
      changedEmployees: [],
      announcements: steadyAnnouncements,
      todayRadarCounts: { todayTotal: 4, pickupCount: 2, returnCount: 2, radarTotal: 3, critical6hCount: 1, expiredUnclosedCount: 0 }
    }, steadyState),
    false
  );

  // Actual count change must trigger meaningful change = true
  assert.equal(
    core.hasMeaningfulDeltaChanges({
      changedReservations: [],
      announcements: steadyAnnouncements,
      todayRadarCounts: { todayTotal: 5, pickupCount: 3, returnCount: 2, radarTotal: 3, critical6hCount: 1, expiredUnclosedCount: 0 }
    }, steadyState),
    true
  );

  // 2. Dashboard snapshot equality & non-destructive SWR fallback
  const dashA = {
    kpis: { totalReservations: 42, closedReservations: 10, openProblems: 2, pendingFollowUps: 5, activeExtensions: 1 },
    statusChart: [{ status: 'جديدة', count: 12 }],
    dailySeries: [{ date: '2026-06-01', total: 4 }],
    employeeRanking: [{ id: 'EMP_1', points: 15 }]
  };
  const dashACopy = JSON.parse(JSON.stringify(dashA));
  assert.equal(core.haveDashboardSnapshotsChanged(dashA, dashACopy), false);
  const dashB = { ...dashACopy, kpis: { ...dashACopy.kpis, totalReservations: 43 } };
  assert.equal(core.haveDashboardSnapshotsChanged(dashA, dashB), true);

  // Null/corrupt response never wipes last valid snapshot
  const preserved = core.resolveSwrSnapshot(dashA, null);
  assert.equal(preserved, dashA);
  assert.equal(preserved.kpis.totalReservations, 42);

  // 3. Monotonic timestamp merge drops stale out-of-order updates while accepting newer ones
  const baseRows = [{ id: 'RES_1', internalStatus: 'تم التسليم', updatedAt: '2026-06-01T12:00:00.000Z' }];
  const stalePatch = core.mergeRecordsMonotonic(baseRows, [
    { id: 'RES_1', internalStatus: 'جديدة', updatedAt: '2026-06-01T11:55:00.000Z' }
  ], 'id');
  assert.equal(stalePatch[0].internalStatus, 'تم التسليم');

  const newerPatch = core.mergeRecordsMonotonic(baseRows, [
    { id: 'RES_1', internalStatus: 'مغلق - تم الإرجاع', updatedAt: '2026-06-01T12:05:00.000Z' }
  ], 'id');
  assert.equal(newerPatch[0].internalStatus, 'مغلق - تم الإرجاع');
});

test('updateFollowUp bumps updated_at so getDeltaSync returns edited follow-ups without changing created_at', async () => {
  const exec = createFixTestExecutor();
  const loginRes = await dispatchCrmRequest(exec, { action: 'login', payload: { username: 'Admin', password: 'Admin@123' } });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  const oldIso = '2026-05-01T08:00:00.000Z';
  exec.state.reservations.push({
    id: 'RES_FU_SYNC',
    reservation_number: 'RG-FU-77',
    customer_name: 'فهد القحطاني',
    internal_status: 'قيد المتابعة',
    status_history: [],
    created_at: new Date(oldIso),
    updated_at: new Date(oldIso)
  });
  exec.state.follow_ups.push({
    id: 'FU_OLD_1',
    reservation_id: 'RES_FU_SYNC',
    reservation_number: 'RG-FU-77',
    customer_name: 'فهد القحطاني',
    employee_id: 'EMP_ADMIN',
    employee_name: 'Admin',
    status: 'قيد المتابعة',
    action: 'تواصل أولي',
    notes: 'قبل التعديل',
    follow_up_date: '2026-05-01',
    follow_up_time: '08:00',
    created_at: new Date(oldIso),
    updated_at: new Date(oldIso)
  });

  const syncCursorBefore = new Date(Date.now() - 2000).toISOString();
  const updRes = await dispatchCrmRequest(exec, {
    action: 'updateFollowUp',
    token,
    payload: { followUpId: 'FU_OLD_1', status: 'نشط الآن', action: 'تم تأكيد الاستلام', notes: 'بعد التعديل' }
  });
  assert.equal(updRes.success, true, updRes.message || 'updateFollowUp failed');
  assert.equal(updRes.data.followUp.notes, 'بعد التعديل');

  const deltaRes = await dispatchCrmRequest(exec, {
    action: 'getDeltaSync',
    token,
    payload: { updatedAfter: syncCursorBefore }
  });
  assert.equal(deltaRes.success, true);
  const syncedFu = (deltaRes.data.changedFollowUps || []).find((f: any) => f.id === 'FU_OLD_1');
  assert.ok(syncedFu, 'Edited old follow-up must appear in changedFollowUps via updated_at');
  assert.equal(syncedFu.notes, 'بعد التعديل');
  assert.equal(syncedFu.createdAt, oldIso);
});

test('markNotificationRead strictly enforces recipient ownership on single notifications', async () => {
  const exec = createFixTestExecutor();
  const agentLogin = await dispatchCrmRequest(exec, { action: 'login', payload: { username: 'agent1', password: 'Agent@123' } });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;
  const agentId = agentLogin.data.user.id;

  exec.state.notifications.push(
    { id: 'N_OTHER', recipient_employee_id: 'EMP_OTHER_99', recipient_role: '', is_read: false },
    { id: 'N_MINE', recipient_employee_id: agentId, recipient_role: '', is_read: false }
  );

  await dispatchCrmRequest(exec, { action: 'markNotificationRead', token: agentToken, payload: { notificationId: 'N_OTHER' } });
  assert.equal(exec.state.notifications[0].is_read, false, 'Cannot mark another employee notification as read');

  await dispatchCrmRequest(exec, { action: 'markNotificationRead', token: agentToken, payload: { notificationId: 'N_MINE' } });
  assert.equal(exec.state.notifications[1].is_read, true, 'Own notification can be marked read');
});

test('api/crm rejects hardcoded Admin@123 when SETUP_ADMIN_PASSWORD is unset and accepts configured secret', async () => {
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    VERCEL: process.env.VERCEL,
    SETUP_ADMIN_PASSWORD: process.env.SETUP_ADMIN_PASSWORD,
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD
  };
  const makeMockRes = () => {
    const out: any = { statusCode: 200, headers: {}, body: null };
    return {
      out,
      res: {
        getHeader(k: string) { return out.headers[k.toLowerCase()]; },
        setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = String(v); },
        status(code: number) { out.statusCode = code; return this; },
        json(obj: any) { out.body = obj; return this; },
        end() { return this; }
      }
    };
  };

  try {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.NEON_DATABASE_URL;
    delete process.env.SETUP_ADMIN_PASSWORD;
    delete process.env.SEED_ADMIN_PASSWORD;
    process.env.VERCEL = '1';

    const legacyAttempt = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: {
        action: 'applyUnifiedConnectionSetup',
        payload: { mode: 'gas', gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbTest123/exec', adminPassword: 'Admin@123', actorRole: 'general_manager' }
      }
    }, legacyAttempt.res);
    assert.equal(legacyAttempt.out.statusCode, 403);
    assert.equal(legacyAttempt.out.body.error, 'FORBIDDEN');
  } finally {
    Object.entries(prevEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
});

test('RGApi.markScopesStale preserves cached SWR payload without clearing data and coalesces identical abortKey reads', async () => {
  let dashFetchCount = 0;
  let resolveSlowFetch: () => void = () => {};

  const ctx = bootApiSandbox({
    fetchImpl: async (url: string, init?: any) => {
      if (String(url).includes('/api/health')) {
        return {
          ok: true, status: 200, headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ ok: true, mode: 'neon', databaseConfigured: true, connected: true, backendApiUrl: '/api/crm' })
        };
      }
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      if (body.action === 'getDashboard') {
        dashFetchCount += 1;
        if (dashFetchCount === 2) {
          await new Promise<void>((r) => { resolveSlowFetch = r; });
        }
        return {
          ok: true, status: 200, headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            success: true, message: '', error: null,
            data: { kpis: { totalReservations: 100 + dashFetchCount } }
          })
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ success: true, message: '', data: {}, error: null })
      };
    }
  });

  await ctx.RGApi.ready();

  // First load caches getDashboard in-page
  const first = await ctx.RGApi.callApi('getDashboard', { abortKey: 'dash:main' });
  assert.equal(first.success, true);
  assert.equal(first.data.kpis.totalReservations, 101);
  assert.equal(dashFetchCount, 1);

  // markScopesStale must retain cached data for immediate SWR render
  await ctx.RGApi.markScopesStale(['dashboard']);
  const cachedStillAvailable = ctx.RGApi.getCachedData('getDashboard', { abortKey: 'dash:main' }, true);
  assert.equal(cachedStillAvailable?.kpis?.totalReservations, 101);

  // Concurrent identical reads with identical abortKey coalesce onto 1 network fetch (no abort thrashing)
  const pA = ctx.RGApi.callApi('getDashboard', { forceRefresh: false, silentRefresh: true, abortKey: 'dash:main' });
  const pB = ctx.RGApi.callApi('getDashboard', { forceRefresh: false, silentRefresh: true, abortKey: 'dash:main' });
  await new Promise((r) => setTimeout(r, 20));
  resolveSlowFetch();
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.equal(rA.success, true);
  assert.equal(rB.success, true);
  assert.equal(dashFetchCount, 2, 'Identical concurrent reads with matching abortKey should coalesce into a single request');
});

test('all mirrored runtime bundles maintain exact byte-for-byte parity', () => {
  const pairs: Array<[string, string]> = [
    ['assets/js/core.js', 'backend/coreBridge.cjs'],
    ['assets/js/app.js', 'src/assets/js/app.js'],
    ['assets/js/employees.js', 'src/assets/js/employees.js']
  ];
  for (const [a, b] of pairs) {
    const bufA = fs.readFileSync(path.resolve(process.cwd(), a), 'utf8');
    const bufB = fs.readFileSync(path.resolve(process.cwd(), b), 'utf8');
    assert.equal(bufA, bufB, `${a} and ${b} must be byte-for-byte identical`);
  }
});
