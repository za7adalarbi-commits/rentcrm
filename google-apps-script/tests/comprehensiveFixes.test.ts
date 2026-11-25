import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { crmCore, hashPassword, hashToken } from '../backend/auth';
import { type DbClient, type DbExecutor, type QueryResult } from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';
import { ingestIncrementalSyncBatch, pullFromRentalGateDirect } from '../backend/syncService';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function createSandboxHarness() {
  const storage = new Map<string, string>();
  const sessionMap = new Map<string, string>();
  const events: Array<{ type: string; detail: any }> = [];
  const sandboxWindow: Record<string, any> = {
    location: { search: '?sandbox=1', pathname: '/', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/?sandbox=1' },
    history: { replaceState() {} },
    navigator: { onLine: true },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k: string) => sessionMap.get(k) ?? null,
      setItem: (k: string, v: string) => sessionMap.set(k, String(v)),
      removeItem: (k: string) => sessionMap.delete(k)
    },
    RG_APP_CONFIG: { mode: 'sandbox', gasWebAppUrl: '', backendApiUrl: '' },
    RGCrmCore: core,
    dispatchEvent() {}
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;
  sandboxWindow.globalThis = sandboxWindow;

  const context = vm.createContext({
    window: sandboxWindow,
    self: sandboxWindow,
    globalThis: sandboxWindow,
    localStorage: sandboxWindow.localStorage,
    sessionStorage: sandboxWindow.sessionStorage,
    navigator: sandboxWindow.navigator,
    document: {
      dispatchEvent(ev: any) {
        events.push({ type: ev?.type || '', detail: ev?.detail });
      }
    },
    CustomEvent: class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts?: any) {
        this.type = type;
        this.detail = opts?.detail;
      }
    },
    URL,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    RegExp,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    console
  });

  vm.runInContext(readRepoFile('assets/js/api.js'), context, { filename: 'assets/js/api.js' });
  return { api: sandboxWindow.RGApi, window: sandboxWindow, events };
}

function createTargetedMockExecutor(): DbExecutor & { state: Record<string, any[]> } {
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

    if (sql.startsWith('CREATE INDEX IF NOT EXISTS') || sql.includes("to_regclass('public.employees')")) {
      return { rows: [{ reg: 'employees' }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees WHERE role')) {
      const cnt = state.employees.filter((e) => e.role === 'general_manager' && e.status === 'active' && e.id !== params[0]).length;
      return { rows: [{ cnt: String(cnt) }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees')) {
      return { rows: [{ cnt: String(state.employees.length) }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO employees')) {
      const hasUiOv = sql.includes('ui_overrides');
      if (hasUiOv) {
        const [id, name, username, password_hash, salt, phone, email, job_title, role, permsJson, uiOvJson, last_activity, created_at] = params;
        if (!state.employees.some((e) => e.username === username)) {
          state.employees.push({
            id, name, username, password_hash, salt, phone, email, job_title, role,
            permissions: JSON.parse(permsJson), ui_overrides: JSON.parse(uiOvJson || '{}'),
            status: 'active', last_activity, created_at: new Date(created_at), updated_at: new Date(created_at)
          });
        }
      } else {
        const [id, name, username, password_hash, salt, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
        if (!state.employees.some((e) => e.username === username)) {
          state.employees.push({
            id, name, username, password_hash, salt, phone, email, job_title, role,
            permissions: JSON.parse(permsJson), ui_overrides: {},
            status: 'active', last_activity, created_at: new Date(created_at), updated_at: new Date(created_at)
          });
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO users')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO settings')) {
      const litMatch = sql.match(/VALUES\s*\(\s*'([^']+)'\s*,/i);
      const key = litMatch ? litMatch[1] : params[0];
      const value = litMatch ? params[0] : params[1];
      const updated_by = (litMatch ? params[1] : params[2]) || 'SYSTEM';
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) state.settings.push({ key, value, updated_by, updated_at: new Date() });
      else if (sql.includes('DO UPDATE')) { existing.value = value; existing.updated_by = updated_by; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO roles')) {
      const [id, label, job_title, role, permsJson] = params;
      if (!state.roles.some((r) => r.id === id)) state.roles.push({ id, label, job_title, role, permissions: JSON.parse(permsJson) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM roles')) return { rows: state.roles as any[], rowCount: state.roles.length };
    if (sql.startsWith('SELECT * FROM permissions')) return { rows: state.permissions as any[], rowCount: state.permissions.length };
    if (sql.startsWith('SELECT key, value FROM settings')) return { rows: state.settings as any[], rowCount: state.settings.length };
    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const u = String(params[0] || '').toLowerCase();
      const rows = state.employees.filter((e) => String(e.username || '').toLowerCase() === u);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT id FROM employees WHERE LOWER(username)')) {
      const u = String(params[0] || '').toLowerCase();
      const rows = state.employees.filter((e) => String(e.username || '').toLowerCase() === u && e.id !== params[1]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE id = $1')) {
      const rows = state.employees.filter((e) => e.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT id, name, username, role, job_title, status FROM employees WHERE status')) {
      const rows = state.employees.filter((e) => e.status === 'active');
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM employees ORDER')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }
    if (sql.startsWith('SELECT id, name, username, role, job_title, status FROM employees')) {
      return { rows: state.employees.filter((e) => e.status === 'active') as any[], rowCount: state.employees.length };
    }
    if (sql.startsWith('SELECT id, name, username, role, status FROM employees')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }
    if (sql.startsWith('UPDATE employees SET ui_overrides')) {
      const [id, uiOvJson] = params;
      const emp = state.employees.find((e) => e.id === id);
      if (emp) emp.ui_overrides = JSON.parse(uiOvJson || '{}');
      return { rows: [], rowCount: emp ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE employees SET name = $2')) {
      const [id, name, username, phone, email, job_title, role, permsJson, uiOvJson, status, password_hash, salt, updated_at] = params;
      const emp = state.employees.find((e) => e.id === id);
      if (emp) {
        emp.name = name;
        emp.username = username;
        emp.phone = phone;
        emp.email = email;
        emp.job_title = job_title;
        emp.role = role;
        emp.permissions = JSON.parse(permsJson || '[]');
        emp.ui_overrides = JSON.parse(uiOvJson || '{}');
        emp.status = status;
        emp.password_hash = password_hash;
        emp.salt = salt;
        emp.updated_at = new Date(updated_at);
      }
      return { rows: [], rowCount: emp ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE users SET ui_overrides') || sql.startsWith('UPDATE users SET name = $2')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO sessions')) {
      const [token_hash, employee_id, username, role, expires_at] = params;
      state.sessions.push({ token_hash, employee_id, username, role, expires_at, is_revoked: false, last_seen_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM sessions s JOIN employees e ON e.id = s.employee_id')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0]);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = state.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          token_hash: ses.token_hash,
          employee_id: ses.employee_id,
          username: ses.username,
          role: ses.role,
          expires_at: ses.expires_at,
          is_revoked: ses.is_revoked,
          last_seen_at: ses.last_seen_at,
          emp_id: emp.id,
          name: emp.name,
          emp_username: emp.username,
          phone: emp.phone,
          email: emp.email,
          job_title: emp.job_title,
          emp_role: emp.role,
          permissions: emp.permissions,
          ui_overrides: emp.ui_overrides,
          emp_status: emp.status,
          last_activity: emp.last_activity,
          created_at: emp.created_at,
          updated_at: emp.updated_at
        }] as any[],
        rowCount: 1
      };
    }
    if (sql.startsWith('UPDATE sessions SET')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM employee_delegations')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM notifications')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM announcements')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM reservation_locks')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO activity_log') || sql.startsWith('INSERT INTO sheets_mirror_outbox') || sql.startsWith('INSERT INTO sync_log') || sql.startsWith('INSERT INTO sync_checkpoints')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE reservation_number = ANY') || sql.startsWith('SELECT * FROM reservations WHERE source_reservation_id')) {
      const lookupSet = new Set((params[0] || []).map(String));
      const idSet = new Set((params[1] || []).map(String));
      const matched = state.reservations.filter(
        (r) => lookupSet.has(String(r.reservation_number)) || lookupSet.has(String(r.source_reservation_id)) || idSet.has(String(r.id))
      );
      return { rows: matched as any[], rowCount: matched.length };
    }
    if (sql.startsWith('UPDATE assignments SET reservation_id')) {
      const [pid, pnum, dupIds] = params;
      const set = new Set(dupIds || []);
      for (const a of state.assignments) if (set.has(a.reservation_id)) { a.reservation_id = pid; a.reservation_number = pnum; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE follow_ups SET reservation_id')) {
      const [pid, pnum, dupIds] = params;
      const set = new Set(dupIds || []);
      for (const f of state.follow_ups) if (set.has(f.reservation_id)) { f.reservation_id = pid; f.reservation_number = pnum; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE follow_up_history SET reservation_id')) {
      const [pid, pnum, dupIds] = params;
      const set = new Set(dupIds || []);
      for (const h of state.follow_up_history) if (set.has(h.reservation_id)) { h.reservation_id = pid; h.reservation_number = pnum; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE problems SET reservation_id')) {
      const [pid, pnum, dupIds] = params;
      const set = new Set(dupIds || []);
      for (const p of state.problems) if (set.has(p.reservation_id)) { p.reservation_id = pid; p.reservation_number = pnum; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE extensions SET reservation_id')) {
      const [pid, pnum, dupIds] = params;
      const set = new Set(dupIds || []);
      for (const e of state.extensions) if (set.has(e.reservation_id)) { e.reservation_id = pid; e.reservation_number = pnum; }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM reservations WHERE id = ANY')) {
      const set = new Set(params[0] || []);
      state.reservations = state.reservations.filter((r) => !set.has(r.id));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE reservations SET customer_id_number')) {
      const [id, cid, pnote, hasPrb] = params;
      const r = state.reservations.find((x) => x.id === id);
      if (r) { r.customer_id_number = cid; r.pinned_note = pnote; r.has_problem = hasPrb; }
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO reservations (')) {
      const ids: string[] = params[0] || [];
      const srcIds: string[] = params[1] || [];
      const resNums: string[] = params[2] || [];
      const names: string[] = params[4] || [];
      const idNums: string[] = params[7] || [];
      const codes: string[] = params[25] || [];
      const ars: string[] = params[26] || [];
      const intSts: string[] = params[39] || [];
      for (let i = 0; i < ids.length; i++) {
        const idx = state.reservations.findIndex((r) => r.reservation_number === resNums[i]);
        const prev = idx >= 0 ? state.reservations[idx] : null;
        const row = {
          id: ids[i],
          source_reservation_id: srcIds[i],
          reservation_number: resNums[i],
          customer_name: names[i],
          customer_id_number: idNums[i] || prev?.customer_id_number || '',
          original_status_code: codes[i],
          original_status_ar: ars[i],
          internal_status: intSts[i],
          pinned_note: prev?.pinned_note || '',
          has_problem: Boolean(prev?.has_problem),
          assigned_employee_ids: prev?.assigned_employee_ids || [],
          assigned_employee_names: prev?.assigned_employee_names || [],
          created_at: prev?.created_at || new Date(),
          updated_at: new Date()
        };
        if (idx >= 0) {
          state.reservations[idx] = { ...prev, ...row, id: prev.id };
        } else {
          state.reservations.push(row);
        }
      }
      return { rows: [], rowCount: ids.length };
    }
    if (sql.includes('COUNT(*)::int AS cnt') || sql.includes('COUNT(*)::int AS total_cnt')) {
      return { rows: [{ cnt: 0, total_cnt: state.reservations.length, today_cnt: 0, cancelled_cnt: 0, rejected_cnt: 0 }] as any[], rowCount: 1 };
    }
    if (sql.includes('COUNT(*)::text AS cnt')) {
      return { rows: [{ cnt: String(state.reservations.length) }] as any[], rowCount: 1 };
    }
    return { rows: [] as any[], rowCount: 0 };
  }

  const client: DbClient = {
    query: runQuery
  };
  return {
    state,
    query: runQuery,
    withTransaction: async <T>(fn: (tx: DbClient) => Promise<T>) => fn(client)
  };
}

test('UI override precedence: developer immunity, individual override over roleUiDefaults, and getFirstAllowedRoute', () => {
  const uiCtx = {
    uiSimplification: {
      hideNavProblems: true,
      hideNavReports: false,
      hideResRejectedTab: true
    },
    roleUiDefaults: {
      agent: {
        enabled: true,
        uiSimplification: {
          hideNavProblems: false,
          hideNavReports: true,
          hideResRejectedTab: true,
          hideResPullBtn: true
        }
      }
    }
  };

  // Developer is never hidden by uiSimplification, roleUiDefaults, or even personal uiOverrides
  const devUser = {
    id: 'EMP_DEV',
    role: 'developer',
    permissions: ['all'],
    uiOverrides: { hideNavProblems: true, hideNavReports: true, hideResRejectedTab: true }
  };
  assert.equal(core.isUiOptionHiddenForUser(devUser, 'hideNavProblems', uiCtx), false);
  assert.equal(core.canUserViewRoute(devUser, 'problems', uiCtx), true);
  assert.equal(core.canUserViewSubSection(devUser, 'sub_view_rejected_tab', uiCtx), true);

  // Agent with role defaults active (reports hidden, problems shown by role override of global) + individual override
  const agentUser = {
    id: 'EMP_AG1',
    role: 'agent',
    permissions: ['view_dashboard', 'view_reservations', 'view_problems', 'view_reports', 'export_reports', 'pull_reservations'],
    uiOverrides: {
      hideNavReports: false, // individual override explicitly re-enables reports despite roleUiDefaults
      hideNavActivity: true  // individual override hides activity
    }
  };
  assert.equal(core.canUserViewRoute(agentUser, 'problems', uiCtx), true);
  assert.equal(core.canUserViewRoute(agentUser, 'reports', uiCtx), true);
  assert.equal(core.canUserViewRoute(agentUser, 'activity', uiCtx), false);
  assert.equal(core.canUserViewSubSection(agentUser, 'sub_view_rejected_tab', uiCtx), false);
  assert.equal(core.canUserUseActionButton(agentUser, 'act_pull_reservations', uiCtx), false);

  // If dashboard is removed via section permissions for agent, getFirstAllowedRoute resolves cleanly to the first visible route
  const dashHiddenUser = {
    id: 'EMP_AG2',
    role: 'agent',
    permissions: ['perms_sections_configured', 'view_reservations', 'view_my_followups'],
    uiOverrides: {}
  };
  assert.equal(core.canUserViewRoute(dashHiddenUser, 'dashboard', uiCtx), false);
  assert.equal(core.getFirstAllowedRoute(dashHiddenUser, uiCtx), 'reservations');
});

test('dedupeEmployeesList removes optimistic EMP_OPT placeholders shadowed by persisted accounts', () => {
  const mixed = [
    { id: 'EMP_OPT_170001', username: 'Sami.Ali', name: 'سامي علي', _optimistic: true },
    { id: 'EMP_170002', username: 'sami.ali', name: 'سامي علي' },
    { id: 'EMP_OPT_170003', username: 'pending.user', name: 'موظف معلق', _optimistic: true }
  ];
  const deduped = core.dedupeEmployeesList(mixed);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((e: any) => e.id), ['EMP_170002', 'EMP_OPT_170003']);
});

test('Backend queries enforce UI override & RBAC routes/tabs with FORBIDDEN and keep getAppBootstrap resilient', async () => {
  const db = createTargetedMockExecutor();
  await dispatchCrmRequest(db, { action: 'ping' });

  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(adminLogin.success, true);
  const adminToken = adminLogin.data.token;

  // Save role defaults hiding reports for agents, plus individual override on agent1 hiding dashboard, problems, rejected tab, and bulk reassign
  const saveRoleRes = await dispatchCrmRequest(db, {
    action: 'saveRoleUiDefaults',
    token: adminToken,
    payload: {
      roleUiDefaults: {
        agent: {
          enabled: true,
          uiSimplification: { hideNavReports: true, hideResCancelledTab: true }
        }
      }
    }
  });
  assert.equal(saveRoleRes.success, true);

  const saveEmpRes = await dispatchCrmRequest(db, {
    action: 'saveEmployeeUiOverrides',
    token: adminToken,
    payload: {
      employeeId: 'EMP_AG1',
      uiOverrides: {
        hideNavProblems: true,
        hideResRejectedTab: true,
        hideResBulkReassign: true
      }
    }
  });
  assert.equal(saveEmpRes.success, true);

  // Give agent1 broad RBAC permissions except view_dashboard so dashboard is blocked via section perms while other routes/tabs are blocked via UI overrides
  await dispatchCrmRequest(db, {
    action: 'updateEmployee',
    token: adminToken,
    payload: {
      employeeId: 'EMP_AG1',
      permissions: ['perms_sections_configured', 'view_reservations', 'view_problems', 'view_reports', 'export_reports', 'assign_employees']
    }
  });

  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' }
  });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;

  // getMe exposes roleUiDefaults & uiSimplification & user.uiOverrides
  const meRes = await dispatchCrmRequest(db, { action: 'getMe', token: agentToken });
  assert.equal(meRes.success, true);
  assert.equal(meRes.data.user.uiOverrides.hideNavProblems, true);
  assert.equal(meRes.data.roleUiDefaults.agent.uiSimplification.hideNavReports, true);

  // getAppBootstrap succeeds for restricted agent instead of failing with FORBIDDEN on dashboard/employees
  const bootRes = await dispatchCrmRequest(db, { action: 'getAppBootstrap', token: agentToken });
  assert.equal(bootRes.success, true);
  assert.equal(bootRes.data.dashboard, null);

  // Direct API bypass attempts must fail with FORBIDDEN
  const dashAttempt = await dispatchCrmRequest(db, { action: 'getDashboard', token: agentToken });
  assert.equal(dashAttempt.success, false);
  assert.match(String(dashAttempt.error), /^FORBIDDEN:/);

  const prbAttempt = await dispatchCrmRequest(db, { action: 'getProblems', token: agentToken });
  assert.equal(prbAttempt.success, false);
  assert.match(String(prbAttempt.error), /^FORBIDDEN:/);

  const repAttempt = await dispatchCrmRequest(db, { action: 'getReports', token: agentToken });
  assert.equal(repAttempt.success, false);
  assert.match(String(repAttempt.error), /^FORBIDDEN:/);

  const rejTabAttempt = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token: agentToken,
    payload: { lifecycle: 'rejected' }
  });
  assert.equal(rejTabAttempt.success, false);
  assert.match(String(rejTabAttempt.error), /^FORBIDDEN:/);

  const inactiveTabAttempt = await dispatchCrmRequest(db, {
    action: 'getInactiveReservations',
    token: agentToken,
    payload: { subTab: 'cancelled' }
  });
  assert.equal(inactiveTabAttempt.success, false);
  assert.match(String(inactiveTabAttempt.error), /^FORBIDDEN:/);

  const bulkAttempt = await dispatchCrmRequest(db, {
    action: 'bulkReassignSelectedReservations',
    token: agentToken,
    payload: { reservationIds: ['RES_1'], targetEmployeeId: 'EMP_AG2' }
  });
  assert.equal(bulkAttempt.success, false);
  assert.match(String(bulkAttempt.error), /^FORBIDDEN:/);

  // Allowed active reservations still succeed
  const okActiveRes = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token: agentToken,
    payload: { lifecycle: 'active' }
  });
  assert.equal(okActiveRes.success, true);
});

test('Sandbox api.js enforces UI overrides FORBIDDEN, returns getMe defaults, and deduplicates created employees', async () => {
  const { api } = createSandboxHarness();

  const adminLogin = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(adminLogin.success, true);

  // Creating an employee immediately followed by getEmployees returns exactly 1 row for the new username (no EMP_OPT duplicate)
  const createRes = await api.callApi('createEmployee', {
    name: 'فيصل العتيبي',
    username: 'faisal.test',
    password: 'Password@123',
    role: 'agent',
    permissions: ['view_dashboard', 'view_reservations', 'view_problems', 'export_reports']
  });
  assert.equal(createRes.success, true);

  const empListRes = await api.callApi('getEmployees', { forceRefresh: true });
  assert.equal(empListRes.success, true);
  const faisalRows = (empListRes.data.items || []).filter((e: any) => String(e.username).toLowerCase() === 'faisal.test');
  assert.equal(faisalRows.length, 1);

  // Hide problems + rejected tab via personal uiOverrides and hide reports via roleUiDefaults
  await api.callApi('saveEmployeeUiOverrides', {
    employeeId: faisalRows[0].id,
    uiOverrides: { hideNavProblems: true, hideResRejectedTab: true }
  });
  await api.callApi('saveRoleUiDefaults', {
    roleUiDefaults: { agent: { enabled: true, uiSimplification: { hideNavReports: true } } }
  });

  await api.callApi('logout', {});
  const faisalLogin = await api.callApi('login', { username: 'faisal.test', password: 'Password@123' });
  assert.equal(faisalLogin.success, true);

  const me = await api.callApi('getMe', {});
  assert.equal(me.success, true);
  assert.equal(me.data.roleUiDefaults.agent.uiSimplification.hideNavReports, true);

  const prbRes = await api.callApi('getProblems', {});
  assert.equal(prbRes.success, false);
  assert.equal(prbRes.error, 'FORBIDDEN');

  const repRes = await api.callApi('getReports', {});
  assert.equal(repRes.success, false);
  assert.equal(repRes.error, 'FORBIDDEN');

  const rejRes = await api.callApi('getReservations', { lifecycle: 'rejected' });
  assert.equal(rejRes.success, false);
  assert.equal(rejRes.error, 'FORBIDDEN');
});

test('Sync canonical deduplication collapses overlapping 447->355 pulls, supports >100 backfills, and consolidates duplicate DB rows', async () => {
  // 1. Pre-existing duplicate rows sharing same source_reservation_id are consolidated cleanly preserving customer_id_number & pinned_note and repointing FKs
  const db = createTargetedMockExecutor();
  db.state.reservations.push(
    {
      id: 'RES_DUP_A',
      source_reservation_id: '777001',
      reservation_number: 'RG-777001',
      customer_name: 'أحمد الاختبار',
      customer_id_number: '1099887766',
      pinned_note: '',
      has_problem: false,
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: new Date('2026-11-01T10:00:00Z'),
      updated_at: new Date('2026-11-01T10:00:00Z')
    },
    {
      id: 'RES_DUP_B',
      source_reservation_id: '777001',
      reservation_number: '#RG-777001',
      customer_name: 'أحمد الاختبار',
      customer_id_number: '',
      pinned_note: 'ملاحظة مهمة يجب الحفاظ عليها',
      has_problem: true,
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: new Date('2026-11-02T10:00:00Z'),
      updated_at: new Date('2026-11-02T10:00:00Z')
    }
  );
  db.state.follow_ups.push({ id: 'FU_1', reservation_id: 'RES_DUP_B', reservation_number: '#RG-777001' });
  db.state.problems.push({ id: 'PRB_1', reservation_id: 'RES_DUP_B', reservation_number: '#RG-777001' });

  await ingestIncrementalSyncBatch(db, {
    source: 'unit_consolidation',
    reservations: [
      { id: 777001, reservationNumber: 'RG-777001', clientName: 'أحمد الاختبار', status: 'confirmed', startDate: '2026-11-20' }
    ],
    extensions: [],
    pagesFetched: 1
  });

  const rows777 = db.state.reservations.filter((r) => String(r.source_reservation_id) === '777001');
  assert.equal(rows777.length, 1);
  assert.equal(rows777[0].customer_id_number, '1099887766');
  assert.equal(rows777[0].pinned_note, 'ملاحظة مهمة يجب الحفاظ عليها');
  assert.equal(db.state.follow_ups[0].reservation_id, 'RES_DUP_A');
  assert.equal(db.state.problems[0].reservation_id, 'RES_DUP_A');

  // 2. Canonical core.dedupeReservationsByNumber collapses duplicates sharing sourceReservationId even when reservationNumber formatting differs
  const mixedDup = [
    { id: 'RES_1', sourceReservationId: '501', reservationNumber: 'RG-501', customerName: 'عميل 501', customerPhone: '' },
    { id: 'RES_2', sourceReservationId: '501', reservationNumber: '#RG-501', customerName: '', customerPhone: '0550000501' }
  ];
  const dedupedRes = core.dedupeReservationsByNumber(mixedDup);
  assert.equal(dedupedRes.length, 1);
  assert.equal(dedupedRes[0].customerPhone, '0550000501');

  // 3. Direct pull: 447 overlapping items across paginated endpoints collapse cleanly into 355 canonical bookings,
  //    AND >100 backfill items (120 IDs) are fetched without hitting a 100-item cap
  const pullDb = createTargetedMockExecutor();
  await dispatchCrmRequest(pullDb, { action: 'ping' });

  // Build 355 canonical records (235 active, 60 rejected, 60 cancelled). 120 rejected/cancelled will appear only in status filter endpoints with sparse fields, triggering >100 ID backfill!
  const all355: any[] = [];
  for (let i = 1; i <= 355; i++) {
    const srcId = 80000 + i;
    const status = i <= 235 ? 'confirmed' : (i <= 295 ? 'rejected' : 'cancelled_by_customer');
    all355.push({
      id: srcId,
      reservationNumber: `RG-${srcId}`,
      clientName: `Customer ${i}`,
      status,
      startDate: '2026-11-20',
      total: 100 + i
    });
  }
  // Active + mixed pages contain first 235 active PLUS 92 overlapping duplicate representations (with `#RG-` prefix & different field aliases) -> total 447 yielded items across pages!
  const mainEndpointItems = [
    ...all355.slice(0, 235),
    ...all355.slice(0, 92).map((item) => ({
      ...item,
      reservationNumber: `#${item.reservationNumber}` // same source ID 80001..80092 formatted differently
    }))
  ];
  const rejectedSparse = all355.slice(235, 295).map((item) => ({
    id: item.id + 500000,
    reservationId: item.id,
    reservationNumber: item.reservationNumber,
    status: item.status
  }));
  const cancelledSparse = all355.slice(295, 355).map((item) => ({
    id: item.id + 600000,
    reservationId: item.id,
    reservationNumber: item.reservationNumber,
    status: item.status
  }));

  const prevToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_447_355';
  const backfilledIds = new Set<string>();

  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    const pathName = u.pathname;
    const page = Number(u.searchParams.get('page') || '0');
    const pageSize = 100;

    if (pathName.includes('/reservations/filter')) {
      const items = mainEndpointItems.slice(page * pageSize, (page + 1) * pageSize);
      const totalPages = Math.max(1, Math.ceil(mainEndpointItems.length / pageSize));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: mainEndpointItems.length } }),
        text: async () => JSON.stringify({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: mainEndpointItems.length } })
      } as any;
    }

    if (pathName.includes('/admin/cancelled-reservations')) {
      const items = cancelledSparse.slice(page * pageSize, (page + 1) * pageSize);
      const totalPages = Math.max(1, Math.ceil(cancelledSparse.length / pageSize));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: cancelledSparse.length } }),
        text: async () => JSON.stringify({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: cancelledSparse.length } })
      } as any;
    }

    if (pathName.includes('/reservation-company-changes/admin/filter')) {
      const items = rejectedSparse.slice(page * pageSize, (page + 1) * pageSize);
      const totalPages = Math.max(1, Math.ceil(rejectedSparse.length / pageSize));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: rejectedSparse.length } }),
        text: async () => JSON.stringify({ data: { items, current_page: page + 1, last_page: totalPages, totalItems: rejectedSparse.length } })
      } as any;
    }

    const detailMatch = pathName.match(/\/reservations\/(\d+)/);
    if (detailMatch) {
      const idStr = detailMatch[1];
      backfilledIds.add(idStr);
      const found = all355.find((x) => String(x.id) === idStr);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: found ? { ...found, rejectionReason: 'سبب مسترجع من التفاصيل', cancellationReason: 'سبب إلغاء مسترجع من التفاصيل' } : null }),
        text: async () => JSON.stringify({ data: found || null })
      } as any;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { items: [], totalItems: 0, totalPages: 1 } }),
      text: async () => JSON.stringify({ data: { items: [], totalItems: 0, totalPages: 1 } })
    } as any;
  }) as any;

  try {
    const pullRes = await pullFromRentalGateDirect(
      pullDb,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 20 },
      mockFetch
    );
    assert.equal(pullRes.fetchedCount, 355);
    assert.equal(pullDb.state.reservations.length, 355);
    // Confirm >100 backfill items (120 sparse rejected+cancelled records) were backfilled completely
    assert.equal(backfilledIds.size, 120);
  } finally {
    if (prevToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevToken;
  }
});
