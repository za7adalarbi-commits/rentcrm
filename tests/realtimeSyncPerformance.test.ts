import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ensureCacheSyncFreshness,
  getCachedOrLoad,
  getLocalCacheVersion,
  invalidateAndBumpVersion,
  invalidateScopes,
  runWithIdempotency
} from '../backend/cache';
import type { DbExecutor, QueryResult } from '../backend/db';
import { broadcastCrmEvent, subscribeCrmEvents, type CrmRealtimeEvent } from '../backend/realtime';
import { dispatchCrmRequest } from '../backend/router';

function loadCoreFromDisk() {
  const corePath = path.resolve(process.cwd(), 'assets/js/core.js');
  const code = fs.readFileSync(corePath, 'utf8');
  const sandbox: any = { window: {}, globalThis: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.RGCrmCore || sandbox.window.RGCrmCore;
}

function createRealtimeTestExecutor(): DbExecutor & {
  state: {
    employees: any[];
    users: any[];
    settings: any[];
    roles: any[];
    permissions: any[];
    sessions: any[];
    reservations: any[];
    follow_ups: any[];
    problems: any[];
    activity_log: any[];
    notifications: any[];
    announcements: any[];
    locks: any[];
  };
} {
  const state = {
    employees: [] as any[],
    users: [] as any[],
    settings: [] as any[],
    roles: [] as any[],
    permissions: [] as any[],
    sessions: [] as any[],
    reservations: [] as any[],
    follow_ups: [] as any[],
    problems: [] as any[],
    activity_log: [] as any[],
    notifications: [] as any[],
    announcements: [] as any[],
    locks: [] as any[]
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
          id,
          name,
          username,
          password_hash,
          salt,
          phone,
          email,
          job_title,
          role,
          permissions: JSON.parse(permsJson),
          status: 'active',
          last_activity,
          created_at: new Date(created_at),
          updated_at: new Date(created_at)
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO users')) {
      const [id, name, username, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
      if (!state.users.some((u) => u.username === username)) {
        state.users.push({
          id,
          name,
          username,
          phone,
          email,
          job_title,
          role,
          permissions: JSON.parse(permsJson),
          status: 'active',
          last_activity,
          created_at: new Date(created_at),
          updated_at: new Date(created_at)
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO settings')) {
      const [key, value, updated_by = 'SYSTEM'] = params;
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) {
        state.settings.push({ key, value, updated_by, updated_at: new Date() });
      } else if (sql.includes('DO UPDATE')) {
        if (key === 'crm_sync_version') {
          const nextNum = Math.max(Number(existing.value || 0) + 1, Number(value || 0));
          existing.value = String(nextNum);
        } else {
          existing.value = value;
        }
        existing.updated_by = updated_by;
        existing.updated_at = new Date();
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
    if (sql.startsWith('SELECT key, value FROM settings')) {
      const filterKeys = Array.isArray(params[0]) ? params[0] : null;
      const rows = filterKeys ? state.settings.filter((s) => filterKeys.includes(s.key)) : state.settings;
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const uname = String(params[0] || '').toLowerCase();
      const rows = state.employees.filter((e) => e.username.toLowerCase() === uname);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM employees WHERE id = $1')) {
      const rows = state.employees.filter((e) => e.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO sessions')) {
      const [token_hash, employee_id, username, role, expires_at, created_at] = params;
      state.sessions.push({
        token_hash,
        employee_id,
        username,
        role,
        expires_at: new Date(expires_at),
        created_at: new Date(created_at),
        last_seen_at: new Date(created_at),
        is_revoked: false
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT s.token_hash, s.employee_id')) {
      const tHash = params[0];
      const ses = state.sessions.find((s) => s.token_hash === tHash && !s.is_revoked);
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
    if (sql.startsWith('UPDATE sessions SET last_seen_at') || sql.startsWith('UPDATE employees SET last_activity') || sql.startsWith('UPDATE users SET last_activity')) {
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
    if (sql.startsWith('INSERT INTO follow_ups')) {
      state.follow_ups.push({
        id: params[0],
        reservation_id: params[1],
        reservation_number: params[2],
        customer_name: params[3],
        employee_id: params[4],
        employee_name: params[5],
        status: params[6],
        action: params[7],
        notes: params[8],
        follow_up_date: params[9],
        follow_up_time: params[10],
        created_at: new Date(params[11])
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({
        id: params[0],
        user_id: params[1],
        user_name: params[2],
        user_role: params[3],
        action_type: params[4],
        entity_type: params[5],
        entity_id: params[6],
        details: params[7],
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT r.* FROM reservations r WHERE')) {
      const todayStr = String(params[0] || '');
      const minDate = String(params[1] || '');
      const maxDate = String(params[2] || '');
      const filtered = state.reservations.filter((r) =>
        r.start_date === todayStr ||
        (r.end_date >= minDate && r.end_date <= maxDate) ||
        (r.extended_until_date && r.extended_until_date >= minDate && r.extended_until_date <= maxDate)
      );
      return { rows: filtered as any[], rowCount: filtered.length };
    }
    if (sql.startsWith('SELECT DISTINCT reservation_id FROM follow_ups WHERE reservation_id = ANY')) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [];
      const seen = Array.from(new Set(state.follow_ups.filter((f) => ids.includes(f.reservation_id)).map((f) => f.reservation_id)));
      return { rows: seen.map((reservation_id) => ({ reservation_id })) as any[], rowCount: seen.length };
    }
    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups') && sql.includes('WHERE r.updated_at >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.reservations
        .filter((r) => Date.parse(r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)) > sinceMs)
        .map((r) => ({ ...r, is_followed: state.follow_ups.some((f) => f.reservation_id === r.id) }));
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM follow_ups WHERE created_at >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.follow_ups.filter((f) => Date.parse(f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at)) > sinceMs);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM problems WHERE updated_at >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.problems.filter((p) => Date.parse(p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at)) > sinceMs);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT id, name, username, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at FROM employees WHERE updated_at >')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.employees.filter((e) => Date.parse(e.updated_at instanceof Date ? e.updated_at.toISOString() : String(e.updated_at)) > sinceMs);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT * FROM notifications')) {
      return { rows: state.notifications as any[], rowCount: state.notifications.length };
    }
    if (sql.startsWith('SELECT * FROM shift_announcements')) {
      return { rows: state.announcements as any[], rowCount: state.announcements.length };
    }
    if (sql.startsWith('DELETE FROM reservation_locks')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM reservation_locks')) {
      return { rows: state.locks as any[], rowCount: state.locks.length };
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

test('ServerCache deduplicates single-flight loads, invalidates scopes, and bumps cross-instance sync version', async () => {
  const sharedSettings: Array<{ key: string; value: string }> = [];
  const makeExec = (): DbExecutor => ({
    async query<T extends Record<string, any> = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT key, value FROM settings')) {
        return { rows: sharedSettings.slice() as any[], rowCount: sharedSettings.length };
      }
      if (s.startsWith('INSERT INTO settings')) {
        const key = String(params[0]);
        const value = String(params[1]);
        const cur = sharedSettings.find((x) => x.key === key);
        if (!cur) sharedSettings.push({ key, value });
        else cur.value = String(Math.max(Number(cur.value || 0) + 1, Number(value || 0)));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async withTransaction<T>(fn: any): Promise<T> {
      return fn(this);
    }
  });

  const execA = makeExec();
  const execB = makeExec();
  let loadsA = 0;

  // Single-flight concurrent deduplication on execA
  const [v1, v2] = await Promise.all([
    getCachedOrLoad(execA, { scope: 'dashboard', key: 'kpi:1', ttlMs: 30000 }, async () => {
      loadsA += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { total: 42 };
    }),
    getCachedOrLoad(execA, { scope: 'dashboard', key: 'kpi:1', ttlMs: 30000 }, async () => {
      loadsA += 1;
      return { total: 99 };
    })
  ]);
  assert.equal(loadsA, 1);
  assert.deepEqual(v1, { total: 42 });
  assert.deepEqual(v2, { total: 42 });

  // Scoped invalidation keeps unrelated scope entries intact
  await getCachedOrLoad(execA, { scope: 'settings', key: 'cfg', ttlMs: 30000 }, async () => ({ ok: true }));
  invalidateScopes(execA, ['dashboard']);
  let reloadedDash = false;
  await getCachedOrLoad(execA, { scope: 'dashboard', key: 'kpi:1', ttlMs: 30000 }, async () => {
    reloadedDash = true;
    return { total: 43 };
  });
  assert.equal(reloadedDash, true);

  let reloadedSettings = false;
  await getCachedOrLoad(execA, { scope: 'settings', key: 'cfg', ttlMs: 30000 }, async () => {
    reloadedSettings = true;
    return { ok: false };
  });
  assert.equal(reloadedSettings, false);

  // Simulated cross-instance mutation on execB bumps persistent crm_sync_version
  const bumpedVer = await invalidateAndBumpVersion(execB, ['reservations'], true);
  assert.ok(bumpedVer > 0);
  assert.equal(getLocalCacheVersion(execB), bumpedVer);
  const syncedVer = await ensureCacheSyncFreshness(execA, true);
  assert.equal(syncedVer, bumpedVer);
});

test('runWithIdempotency replays cached response for repeated clientRequestId and cleans up on error', async () => {
  const exec = {} as object;
  let calls = 0;

  const first = await runWithIdempotency(exec, 'U1', 'addFollowUp', 'REQ_SAME_1', async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { id: `FU_${calls}` };
  });
  const second = await runWithIdempotency(exec, 'U1', 'addFollowUp', 'REQ_SAME_1', async () => {
    calls += 1;
    return { id: `FU_${calls}` };
  });

  assert.equal(calls, 1);
  assert.deepEqual(first, { id: 'FU_1' });
  assert.deepEqual(second, { id: 'FU_1' });

  await assert.rejects(
    runWithIdempotency(exec, 'U1', 'addFollowUp', 'REQ_FAIL_1', async () => {
      throw new Error('BOOM');
    }),
    /BOOM/
  );

  // Retry after failure executes cleanly rather than replaying stale failure
  const recovered = await runWithIdempotency(exec, 'U1', 'addFollowUp', 'REQ_FAIL_1', async () => ({ id: 'FU_RECOVERED' }));
  assert.deepEqual(recovered, { id: 'FU_RECOVERED' });
});

test('getTodayAndRadar computes full-DB counts across >250 records without 200-row truncation', async () => {
  const exec = createRealtimeTestExecutor();
  const loginRes = await dispatchCrmRequest(exec, {
    action: 'login',
    payload: { username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  const todayStr = new Date().toISOString().slice(0, 10);
  const soonDate = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
  const soonTime = new Date(Date.now() + 2 * 3600000).toISOString().slice(11, 16);

  for (let i = 1; i <= 260; i++) {
    exec.state.reservations.push({
      id: `RES_BULK_${i}`,
      source_reservation_id: String(i),
      reservation_number: `R-${1000 + i}`,
      customer_name: `عميل ${i}`,
      customer_phone: `050000${String(i).padStart(4, '0')}`,
      company_name: 'شركة الاختبار',
      branch_name: 'الرياض',
      deliver_branch_name: 'الرياض',
      car_name: 'كامري',
      start_date: todayStr,
      start_time: '10:00',
      original_end_date: soonDate,
      original_end_time: soonTime,
      end_date: soonDate,
      end_time: soonTime,
      extended_until_date: '',
      extended_until_time: '',
      days_count: 2,
      extended_days_count: 0,
      total_days_count: 2,
      original_status_code: 'confirmed',
      original_status_ar: 'تم التسليم',
      internal_status: i % 2 === 0 ? 'تم التسليم' : 'تم الحجز',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      status_history: [],
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  const res = await dispatchCrmRequest(exec, {
    action: 'getTodayAndRadar',
    token,
    payload: { todayDate: todayStr, nowMs: Date.now() }
  });
  assert.equal(res.success, true);
  assert.ok(res.data.counts.todayTotal >= 250, `Expected >=250 today items without 200-row cap, got ${res.data.counts.todayTotal}`);
});

test('dispatchCrmRequest broadcasts SSE delta event, enforces optimistic lock CONFLICT_STALE_DATA, and feeds getDeltaSync', async () => {
  const exec = createRealtimeTestExecutor();
  const loginRes = await dispatchCrmRequest(exec, {
    action: 'login',
    payload: { username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  const token = loginRes.data.token;

  const initialTime = new Date(Date.now() - 60000);
  exec.state.reservations.push({
    id: 'RES_LOCK_1',
    source_reservation_id: '555',
    reservation_number: '555001',
    customer_name: 'سعد العتيبي',
    customer_phone: '0551234567',
    company_name: 'المفتاح',
    branch_name: 'جدة',
    deliver_branch_name: 'جدة',
    car_name: 'سوناتا',
    start_date: new Date().toISOString().slice(0, 10),
    start_time: '09:00',
    end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    end_time: '09:00',
    extended_until_date: '',
    extended_until_time: '',
    internal_status: 'تم الحجز',
    priority: 'عادي',
    assigned_employee_ids: [],
    assigned_employee_names: [],
    status_history: [],
    created_at: initialTime,
    updated_at: initialTime
  });

  const events: CrmRealtimeEvent[] = [];
  const unsubscribe = subscribeCrmEvents((ev) => events.push(ev));

  try {
    const syncBefore = new Date(Date.now() - 5000).toISOString();
    const updRes = await dispatchCrmRequest(exec, {
      action: 'quickUpdateReservationStatus',
      token,
      payload: {
        reservationId: 'RES_LOCK_1',
        status: 'تم التسليم',
        note: 'تسليم العميل',
        expectedUpdatedAt: initialTime.toISOString()
      }
    });
    assert.equal(updRes.success, true);
    assert.equal(updRes.data.reservation.internalStatus, 'تم التسليم');

    // Broadcasted SSE event includes action, scopes, entityIds, actorId, and version
    assert.ok(events.length >= 1);
    const ev = events[events.length - 1];
    assert.equal(ev.action, 'quickUpdateReservationStatus');
    assert.equal(ev.type, 'delta');
    assert.equal(ev.actorId, 'EMP_ADMIN');
    assert.ok(Array.isArray(ev.entityIds) && ev.entityIds.includes('RES_LOCK_1'));
    assert.ok(typeof ev.version === 'number' && ev.version > 0);

    // Concurrent user attempting update with stale expectedUpdatedAt gets CONFLICT_STALE_DATA
    const staleRes = await dispatchCrmRequest(exec, {
      action: 'quickUpdateReservationStatus',
      token,
      payload: {
        reservationId: 'RES_LOCK_1',
        status: 'تم الاستلام',
        expectedUpdatedAt: initialTime.toISOString()
      }
    });
    assert.equal(staleRes.success, false);
    assert.match(String(staleRes.error), /^CONFLICT_STALE_DATA/);

    // Duplicate addFollowUp clientRequestId only inserts 1 followUp record
    const fuCountBefore = exec.state.follow_ups.length;
    await dispatchCrmRequest(exec, {
      action: 'addFollowUp',
      token,
      payload: {
        reservationId: 'RES_LOCK_1',
        status: 'نشط الآن',
        action: 'اتصال أول',
        clientRequestId: 'REQ_DUP_FU_1'
      }
    });
    await dispatchCrmRequest(exec, {
      action: 'addFollowUp',
      token,
      payload: {
        reservationId: 'RES_LOCK_1',
        status: 'نشط الآن',
        action: 'اتصال أول',
        clientRequestId: 'REQ_DUP_FU_1'
      }
    });
    assert.equal(exec.state.follow_ups.length, fuCountBefore + 1);

    // getDeltaSync returns updated reservations, follow-ups, changedEmployees, todayRadarCounts, and syncVersion
    const deltaRes = await dispatchCrmRequest(exec, {
      action: 'getDeltaSync',
      token,
      payload: { updatedAfter: syncBefore }
    });
    assert.equal(deltaRes.success, true);
    assert.ok(deltaRes.data.changedReservations.some((r: any) => r.id === 'RES_LOCK_1'));
    assert.ok(deltaRes.data.changedFollowUps.length >= 1);
    assert.ok(Array.isArray(deltaRes.data.changedEmployees));
    assert.ok(deltaRes.data.todayRadarCounts && typeof deltaRes.data.todayRadarCounts.todayTotal === 'number');
    assert.ok(Number(deltaRes.data.syncVersion) > 0);
  } finally {
    unsubscribe();
  }
});

test('broadcastCrmEvent fans out realtime events and removes unsubscribed listeners', () => {
  const seen: string[] = [];
  const unsub = subscribeCrmEvents((ev) => seen.push(ev.action));
  broadcastCrmEvent({ type: 'delta', action: 'testEvent1', at: new Date().toISOString() });
  unsub();
  broadcastCrmEvent({ type: 'delta', action: 'testEvent2', at: new Date().toISOString() });
  assert.deepEqual(seen, ['testEvent1']);
});

test('core.mergeDeltaRecords and core.resolveAsyncViewState handle delta patching & loading/error/empty states', () => {
  const core = loadCoreFromDisk();
  assert.equal(typeof core.mergeDeltaRecords, 'function');
  assert.equal(typeof core.resolveAsyncViewState, 'function');

  const merged = core.mergeDeltaRecords(
    [
      { id: '1', name: 'A', status: 'جديدة' },
      { id: '2', name: 'B', status: 'مغلقة' }
    ],
    [
      { id: '2', status: 'قيد المعالجة' },
      { id: '3', name: 'C', status: 'جديدة' }
    ],
    'id'
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, '3');
  assert.equal(merged.find((x: any) => x.id === '2').status, 'قيد المعالجة');
  assert.equal(merged.find((x: any) => x.id === '2').name, 'B');

  assert.equal(core.resolveAsyncViewState({ items: [], loading: true, hasLoaded: false }), 'loading');
  assert.equal(core.resolveAsyncViewState({ items: [{ id: '1' }], loading: true, hasLoaded: true }), 'ready');
  assert.equal(core.resolveAsyncViewState({ items: [], loading: false, hasLoaded: true, error: 'NETWORK_ERROR' }), 'error');
  assert.equal(core.resolveAsyncViewState({ items: [], loading: false, hasLoaded: true, error: '' }), 'empty');

  const apiCode = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');
  assert.match(apiCode, /invalidateScopes:\s*clearCache/);
});
