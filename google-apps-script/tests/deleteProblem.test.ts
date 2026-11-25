import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import core from '../backend/coreBridge.cjs';
import { dispatchCrmRequest } from '../backend/router.js';
import { hashPassword, hashToken } from '../backend/auth.js';

function createDeleteProblemMockExecutor() {
  const state = {
    reservations: [
      {
        id: 'RES_1',
        reservation_number: '1159',
        customer_name: 'عميل تجريبي',
        customer_phone: '+966500000001',
        customer_id_number: '1010101010',
        car_name: 'Toyota Yaris',
        car_plate: 'ABC 123',
        branch: 'الرياض',
        company: 'AlRehab',
        status_ar: 'نشط',
        status_code: 'active',
        total_amount: 350,
        start_date: '2026-11-24',
        end_date: '2026-11-26',
        internal_status: 'لم يتم المتابعة',
        has_problem: true,
        assigned_employee_ids: [],
        assigned_employee_names: [],
        status_history: [],
        source_order: 1,
        created_at: new Date('2026-11-23T08:00:00Z'),
        updated_at: new Date('2026-11-23T08:00:00Z')
      }
    ] as any[],
    employees: [
      {
        id: 'EMP_ADMIN',
        name: 'General Manager',
        username: 'admin',
        phone: '+966500000000',
        email: 'admin@rg.local',
        job_title: 'المدير العام',
        role: 'general_manager',
        permissions: core.ROLE_PERMISSION_MATRIX.general_manager.slice(),
        status: 'active',
        last_activity: '',
        created_at: new Date('2026-11-01T00:00:00Z'),
        updated_at: new Date('2026-11-01T00:00:00Z')
      },
      {
        id: 'EMP_NO_DEL',
        name: 'Restricted Agent',
        username: 'restricted',
        phone: '+966500000002',
        email: 'restricted@rg.local',
        job_title: 'موظف',
        role: 'agent',
        permissions: core.applyEmployeeSectionToggle('agent', core.ROLE_PERMISSION_MATRIX.agent, 'act_close_delete_ticket', false),
        status: 'active',
        last_activity: '',
        created_at: new Date('2026-11-01T00:00:00Z'),
        updated_at: new Date('2026-11-01T00:00:00Z')
      }
    ] as any[],
    users: [] as any[],
    sessions: [] as any[],
    problems: [
      {
        id: 'PRB_1',
        problem_number: 'PRB-1001',
        reservation_id: 'RES_1',
        reservation_number: '1159',
        customer_name: 'عميل تجريبي',
        created_by_id: 'EMP_ADMIN',
        created_by_name: 'General Manager',
        assigned_employee_ids: ['EMP_ADMIN'],
        assigned_employee_names: ['General Manager'],
        description: 'مشكلة أولى في الحجز',
        priority: 'مرتفع',
        status: 'جديدة',
        created_at: new Date('2026-11-23T09:00:00Z'),
        updated_at: new Date('2026-11-23T09:00:00Z')
      },
      {
        id: 'PRB_2',
        problem_number: 'PRB-1002',
        reservation_id: 'RES_1',
        reservation_number: '1159',
        customer_name: 'عميل تجريبي',
        created_by_id: 'EMP_ADMIN',
        created_by_name: 'General Manager',
        assigned_employee_ids: ['EMP_ADMIN'],
        assigned_employee_names: ['General Manager'],
        description: 'مشكلة ثانية في الحجز',
        priority: 'متوسط',
        status: 'قيد المعالجة',
        created_at: new Date('2026-11-23T09:10:00Z'),
        updated_at: new Date('2026-11-23T09:10:00Z')
      }
    ] as any[],
    issues: [
      { id: 'PRB_1' },
      { id: 'PRB_2' }
    ] as any[],
    problem_updates: [
      { id: 'PRBU_1', problem_id: 'PRB_1', note: 'initial', created_at: new Date('2026-11-23T09:00:00Z') },
      { id: 'PRBU_2', problem_id: 'PRB_2', note: 'initial 2', created_at: new Date('2026-11-23T09:10:00Z') }
    ] as any[],
    notifications: [
      { id: 'NTF_1', recipient_employee_id: 'EMP_ADMIN', entity_type: 'Problem', entity_id: 'PRB_1', is_read: false, created_at: new Date() }
    ] as any[],
    activity_log: [] as any[],
    sync_tombstones: [] as any[],
    sheets_mirror_outbox: [] as any[],
    settings: [] as any[],
    employee_delegations: [] as any[],
    announcements: [] as any[],
    reservation_locks: [] as any[],
    follow_ups: [] as any[],
    idempotency_keys: [] as any[]
  };

  for (const emp of state.employees) {
    const salt = 'salt_' + emp.id;
    state.users.push({ id: emp.id, username: emp.username, password_hash: hashPassword('Pass@123', salt), salt });
    state.sessions.push({
      token_hash: hashToken('tok_' + emp.id),
      employee_id: emp.id,
      username: emp.username,
      role: emp.role,
      expires_at: new Date(Date.now() + 3600_000),
      is_revoked: false,
      last_seen_at: new Date()
    });
  }

  const query = async (rawSql: string, params: any[] = []) => {
    const sql = String(rawSql || '').trim().replace(/\s+/g, ' ');
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM sessions s JOIN employees e')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0] && !s.is_revoked);
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
        }],
        rowCount: 1
      };
    }
    if (sql.startsWith('SELECT * FROM employee_delegations')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT key, value FROM settings')) return { rows: state.settings, rowCount: state.settings.length };
    if (sql.startsWith('SELECT value FROM settings WHERE key =')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('INSERT INTO settings')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT * FROM problems WHERE id = $1')) {
      const found = state.problems.find((p) => p.id === params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.startsWith('DELETE FROM problem_updates WHERE problem_id = $1')) {
      state.problem_updates = state.problem_updates.filter((u) => u.problem_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM notifications WHERE entity_type = $1 AND entity_id = $2')) {
      state.notifications = state.notifications.filter((n) => !(n.entity_type === params[0] && n.entity_id === params[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM problems WHERE id = $1')) {
      const before = state.problems.length;
      state.problems = state.problems.filter((p) => p.id !== params[0]);
      return { rows: [], rowCount: before - state.problems.length };
    }
    if (sql.startsWith('DELETE FROM issues WHERE id = $1')) {
      state.issues = state.issues.filter((i) => i.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT COUNT(*)::text AS cnt FROM problems WHERE reservation_id = $1")) {
      const cnt = state.problems.filter((p) => p.reservation_id === params[0] && p.status !== 'مغلقة' && p.status !== 'تم الحل').length;
      return { rows: [{ cnt: String(cnt) }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE reservations SET has_problem = $2')) {
      const res = state.reservations.find((r) => r.id === params[0]);
      if (res) {
        res.has_problem = Boolean(params[1]);
        res.updated_at = new Date(params[2]);
      }
      return { rows: [], rowCount: res ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO sync_tombstones')) {
      const ids: string[] = params[0] || [];
      const entityType = params[1];
      const entityIds: string[] = params[3] || [];
      entityIds.forEach((eid, idx) => {
        state.sync_tombstones.push({
          id: ids[idx] || `TMB_${idx}`,
          entity_type: entityType,
          entity_id: eid,
          deleted_at: new Date()
        });
      });
      return { rows: [], rowCount: entityIds.length };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], action_type: params[4], entity_type: params[5], entity_id: params[6], details: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({ id: params[0], entity_type: params[1], entity_id: params[2], action: params[3], payload: JSON.parse(params[4]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT entity_type, entity_id, deleted_at FROM sync_tombstones')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.sync_tombstones.filter((t) => Date.parse(t.deleted_at.toISOString()) > sinceMs);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT r.*, EXISTS')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM follow_ups')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM problems WHERE updated_at >')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM employees WHERE updated_at >')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM notifications')) return { rows: state.notifications, rowCount: state.notifications.length };
    if (sql.includes('FROM announcements')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM reservation_locks')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id, updated_at FROM settings')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM reservations')) return { rows: state.reservations, rowCount: state.reservations.length };
    if (sql.startsWith('SELECT * FROM problems')) return { rows: state.problems, rowCount: state.problems.length };
    return { rows: [], rowCount: 0 };
  };

  const executor: any = {
    query,
    withTransaction: async (fn: (client: any) => Promise<any>) => fn({ query })
  };

  return { executor, state };
}

test('core reapplyProblemDeltaToFilteredList, scopes, and locks support deleteProblem', () => {
  const list = [
    { id: 'PRB_1', problemNumber: 'PRB-1', reservationId: 'RES_1', customerName: 'A', status: 'جديدة', priority: 'مرتفع', description: 'first' },
    { id: 'PRB_2', problemNumber: 'PRB-2', reservationId: 'RES_1', customerName: 'B', status: 'مغلقة', priority: 'عادي', description: 'second' }
  ];

  const afterDel = core.reapplyProblemDeltaToFilteredList(list, [], [], {}, ['PRB_1']);
  assert.deepEqual(afterDel.map((x: any) => x.id), ['PRB_2']);

  assert.ok(core.getCacheInvalidationScopes('deleteProblem').includes('problems'));
  assert.ok(core.getCacheInvalidationScopes('deleteProblem').includes('reservations'));
  assert.equal(core.buildMutationLockKey('deleteProblem', { problemId: 'PRB_1' }), 'deleteProblem:PRB_1');
  assert.equal(core.hasMeaningfulDeltaChanges({ deletedProblemIds: ['PRB_1'] }), true);
});

test('backend deleteProblem enforces permissions, cascades cleanly, updates reservation hasProblem, records tombstone, and emits deletedProblemIds', async () => {
  const { executor, state } = createDeleteProblemMockExecutor();

  // 1) Restricted agent without act_close_delete_ticket is forbidden
  const forbiddenRes = await dispatchCrmRequest(executor, {
    action: 'deleteProblem',
    token: 'tok_EMP_NO_DEL',
    payload: { problemId: 'PRB_1' }
  });
  assert.equal(forbiddenRes.success, false);
  assert.match(String(forbiddenRes.message), /FORBIDDEN|صلاحية/);
  assert.equal(state.problems.length, 2);

  // 2) Admin deletes PRB_1 while PRB_2 stays open -> has_problem stays true
  const del1 = await dispatchCrmRequest(executor, {
    action: 'deleteProblem',
    token: 'tok_EMP_ADMIN',
    payload: { problemId: 'PRB_1' }
  });
  assert.equal(del1.success, true);
  assert.equal(del1.data.deleted, true);
  assert.equal(del1.data.id, 'PRB_1');
  assert.equal(del1.data.hasOpenProblemsOnReservation, true);
  assert.equal(state.problems.map((p) => p.id).join(','), 'PRB_2');
  assert.equal(state.issues.map((i) => i.id).join(','), 'PRB_2');
  assert.equal(state.problem_updates.some((u) => u.problem_id === 'PRB_1'), false);
  assert.equal(state.notifications.some((n) => n.entity_id === 'PRB_1'), false);
  assert.equal(state.reservations[0].has_problem, true);
  assert.equal(state.sheets_mirror_outbox.some((m) => m.action === 'deleteProblem' && m.entity_id === 'PRB_1'), true);
  assert.equal(state.activity_log.some((a) => a.action_type === 'حذف مشكلة' && a.entity_id === 'PRB-1001'), true);

  // 3) Admin deletes PRB_2 (last open problem) -> has_problem flips to false
  const del2 = await dispatchCrmRequest(executor, {
    action: 'deleteProblem',
    token: 'tok_EMP_ADMIN',
    payload: { problemId: 'PRB_2' }
  });
  assert.equal(del2.success, true);
  assert.equal(del2.data.hasOpenProblemsOnReservation, false);
  assert.equal(state.reservations[0].has_problem, false);

  // 4) getDeltaSync exposes deletedProblemIds for other connected clients
  const delta = await dispatchCrmRequest(executor, {
    action: 'getDeltaSync',
    token: 'tok_EMP_ADMIN',
    payload: { updatedAfter: new Date(Date.now() - 60_000).toISOString() }
  });
  assert.equal(delta.success, true);
  assert.deepEqual(delta.data.deletedProblemIds.sort(), ['PRB_1', 'PRB_2']);
});

test('frontend sandbox deleteProblem & UI modules render delete buttons next to each problem', async () => {
  const storage = new Map<string, string>();
  const events: string[] = [];
  const sandboxWindow: Record<string, any> = {
    location: { search: '?sandbox=1', pathname: '/', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/?sandbox=1' },
    navigator: { onLine: true },
    RG_APP_CONFIG: { mode: 'sandbox', gasWebAppUrl: '', backendApiUrl: '' },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k: string) => storage.get('s:' + k) ?? null,
      setItem: (k: string, v: string) => storage.set('s:' + k, String(v)),
      removeItem: (k: string) => storage.delete('s:' + k)
    },
    document: {
      dispatchEvent: (ev: any) => events.push(String(ev?.type || ''))
    },
    CustomEvent: class CustomEventPoly {
      type: string;
      detail: any;
      constructor(type: string, init?: { detail?: any }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    Date, Math, JSON, Array, Object, Number, String, Boolean, RegExp, Error, Promise, setTimeout, clearTimeout
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;
  sandboxWindow.globalThis = sandboxWindow;

  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');
  const problemsSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/problems.js'), 'utf8');
  const reservationsSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/reservations.js'), 'utf8');

  vm.createContext(sandboxWindow);
  vm.runInContext(coreSrc, sandboxWindow);
  vm.runInContext(apiSrc, sandboxWindow);

  const api = sandboxWindow.RGApi;
  const loginRes = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(loginRes.success, true);

  const listBefore = await api.callApi('getProblems', {});
  assert.equal(listBefore.success, true);
  assert.ok(listBefore.data.items.length > 0);
  const targetPrb = listBefore.data.items[0];

  // Optimistic removal updates cached getProblems immediately
  api.applyOptimisticMutation('deleteProblem', { problemId: targetPrb.id, reservationId: targetPrb.reservationId }, loginRes.data.user);
  const cachedAfterOpt = api.getCachedData('getProblems', {}, true);
  assert.equal(cachedAfterOpt.items.some((x: any) => x.id === targetPrb.id), false);

  // Sandbox backend delete succeeds
  const delRes = await api.callApi('deleteProblem', { problemId: targetPrb.id, _keepOptimisticCache: true, _spamChecked: true });
  assert.equal(delRes.success, true);
  assert.equal(delRes.data.deleted, true);

  const listAfter = await api.callApi('getProblems', { forceRefresh: true });
  assert.equal(listAfter.data.items.some((x: any) => x.id === targetPrb.id), false);

  // Delta sync tombstone removes cached problem
  if (listAfter.data.items.length > 0) {
    const secondPrb = listAfter.data.items[0];
    const deltaOut = api.applyDeltaSyncToCache({
      syncVersion: Date.now(),
      changedProblems: [],
      deletedProblemIds: [secondPrb.id]
    });
    assert.ok(deltaOut.changedScopes.includes('problems'));
    const cachedAfterDelta = api.getCachedData('getProblems', {}, true);
    assert.equal(cachedAfterDelta.items.some((x: any) => x.id === secondPrb.id), false);
  }

  // UI modules expose per-row delete controls in both Problems table and Reservation drawer
  assert.match(problemsSrc, /btn-delete-prb/);
  assert.match(problemsSrc, /prb-delete-ticket-btn/);
  assert.match(reservationsSrc, /btn-delete-prb-in-drawer/);
});
