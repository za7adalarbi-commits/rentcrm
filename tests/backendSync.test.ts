import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, hashToken, normalizeLoginUsername, verifySharedSecret } from '../backend/auth';
import type { DbClient, DbExecutor, QueryResult } from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';
import { ingestIncrementalSyncBatch } from '../backend/syncService';

function createInMemoryMockExecutor(): DbExecutor & { state: Record<string, any[]> } {
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
      if (!existing) {
        state.settings.push({ key, value, updated_by, updated_at: new Date() });
      } else if (sql.includes('DO UPDATE')) {
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

    if (sql.startsWith('SELECT * FROM employees ORDER BY')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql === 'SELECT * FROM employees') {
      return { rows: state.employees as any[], rowCount: state.employees.length };
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
      const tHash = params[0];
      const ses = state.sessions.find((s) => s.token_hash === tHash);
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

    if (sql.startsWith('UPDATE sessions SET is_revoked = TRUE')) {
      for (const s of state.sessions) {
        if (s.token_hash === params[0] || s.employee_id === params[0]) s.is_revoked = true;
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sessions SET last_seen_at') || sql.startsWith('UPDATE employees SET last_activity') || sql.startsWith('UPDATE users SET last_activity')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], user_id: params[1], user_name: params[2], action_type: params[4], entity_id: params[6], created_at: new Date() });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM activity_log')) {
      return { rows: state.activity_log.slice(0, 8) as any[], rowCount: state.activity_log.length };
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
      } else {
        state.reservations[idx] = { ...rec, id: state.reservations[idx].id, created_at: state.reservations[idx].created_at };
        return { rows: [{ inserted: false }] as any[], rowCount: 1 };
      }
    }

    if (sql.startsWith('INSERT INTO extensions (')) {
      const ext = {
        id: params[0],
        extension_number: params[1],
        sequence_number: params[2],
        reservation_id: params[3],
        reservation_number: params[4],
        source_reservation_id: params[5],
        extension_type: params[6],
        extension_type_ar: params[7],
        status_code: params[8],
        status_ar: params[9],
        payment_status: params[10],
        payment_date: params[11],
        payment_method: params[12],
        extend_days: params[13],
        start_date: params[14],
        start_time: params[15],
        end_date: params[16],
        end_time: params[17],
        sub_total: params[18],
        vat_amount: params[19],
        amount: params[20],
        is_accepted_and_paid: params[21],
        synced_at: new Date(params[22])
      };
      const idx = state.extensions.findIndex((e) => e.extension_number === ext.extension_number);
      if (idx === -1) state.extensions.push(ext);
      else state.extensions[idx] = ext;
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO follow_ups')) {
      state.follow_ups.push({
        id: params[0], reservation_id: params[1], reservation_number: params[2], customer_name: params[3],
        employee_id: params[4], employee_name: params[5], status: params[6], action: params[7],
        notes: params[8], follow_up_date: params[9], follow_up_time: params[10], created_at: new Date(params[11])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO follow_up_history')) {
      state.follow_up_history.push({
        id: params[0], follow_up_id: params[1], reservation_id: params[2], reservation_number: params[3],
        employee_id: params[4], employee_name: params[5], change_type: params[6], previous_status: params[7],
        new_status: params[8], previous_action: params[9], new_action: params[10], previous_notes: params[11],
        new_notes: params[12], changed_at: new Date(params[13])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE reservations SET internal_status = $2')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.internal_status = params[1];
        r.last_update_text = params[2];
        r.last_updated_by_id = params[3];
        r.last_updated_by_name = params[4];
        r.last_updated_at = params[5];
        r.status_history = JSON.parse(params[6]);
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({
        id: params[0], entity_type: params[1], entity_id: params[2], action: params[3],
        payload: JSON.parse(params[4]), status: 'pending'
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sync_log')) {
      state.sync_log.push({
        id: params[0], triggered_by_id: params[1], triggered_by_name: params[2], status: 'success',
        imported_count: params[3], updated_count: params[4], extensions_count: params[5],
        pages_fetched: params[6], duration_ms: params[7], started_at: new Date(params[8]), finished_at: new Date(params[9])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{ source: params[0], last_status: 'success', last_batch_count: params[3] }];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM reservations')) {
      let list = state.reservations;
      if (params.length > 0 && String(params[0]).startsWith('%')) {
        const needle = String(params[0]).replace(/%/g, '').toLowerCase();
        list = list.filter((r) =>
          r.reservation_number.toLowerCase().includes(needle) ||
          r.customer_name.toLowerCase().includes(needle)
        );
      }
      return { rows: [{ cnt: String(list.length) }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups')) {
      let list = state.reservations;
      if (params.length > 2 && String(params[0]).startsWith('%')) {
        const needle = String(params[0]).replace(/%/g, '').toLowerCase();
        list = list.filter((r) =>
          r.reservation_number.toLowerCase().includes(needle) ||
          r.customer_name.toLowerCase().includes(needle)
        );
      }
      return {
        rows: list.map((r) => ({ ...r, is_followed: state.follow_ups.some((f) => f.reservation_id === r.id) })) as any[],
        rowCount: list.length
      };
    }

    if (sql.startsWith('SELECT id, start_date, created_at, internal_status')) {
      return { rows: state.reservations as any[], rowCount: state.reservations.length };
    }

    if (sql.startsWith('SELECT employee_name, follow_up_date FROM follow_ups')) {
      return { rows: state.follow_ups as any[], rowCount: state.follow_ups.length };
    }

    if (sql.startsWith('SELECT status, priority FROM problems')) {
      return { rows: state.problems as any[], rowCount: state.problems.length };
    }

    if (sql.startsWith("SELECT id, name, status FROM employees WHERE status = 'active'")) {
      return { rows: state.employees.filter((e) => e.status === 'active') as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM notifications')) {
      return { rows: state.notifications as any[], rowCount: state.notifications.length };
    }

    if (sql.startsWith('SELECT DISTINCT company_name')) {
      return { rows: [] as any[], rowCount: 0 };
    }

    if (sql.startsWith('SELECT DISTINCT branch_name')) {
      return { rows: [] as any[], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM sync_log ORDER BY')) {
      return { rows: state.sync_log as any[], rowCount: state.sync_log.length };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    state,
    query: runQuery,
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };
}

test('auth hashing matches Google Apps Script formula and verifySharedSecret is timing-safe', () => {
  const expected = crypto.createHash('sha256').update('S_ADMIN::RENTAL_GATE_CRM::Admin@123').digest('hex');
  assert.equal(hashPassword('Admin@123', 'S_ADMIN'), expected);
  assert.equal(hashToken('TOK_1'), crypto.createHash('sha256').update('TOKEN::TOK_1').digest('hex'));
  assert.equal(normalizeLoginUsername('Agent١٢'), 'agent12');

  assert.equal(verifySharedSecret('super-secret-key', 'super-secret-key'), true);
  assert.equal(verifySharedSecret('super-secret-wrong', 'super-secret-key'), false);
  assert.equal(verifySharedSecret('short', 'super-secret-key'), false);
  assert.equal(verifySharedSecret('', ''), false);
});

test('incremental sync maps pickup status to ناشط, prevents duplicates, and resolves conflicts cleanly', async () => {
  const db = createInMemoryMockExecutor();

  // 1) First incremental batch: new reservation with CONFIRMED + paid extension
  const firstSync = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        clientMobile: '0501234567',
        companyArName: 'ذيب لتأجير السيارات',
        receiveBranchArName: 'مطار الرياض',
        carNameAr: 'تويوتا كامري 2026',
        startDate: '2026-11-17T10:00:00',
        endDate: '2026-11-20T10:00:00',
        reservationDays: 3,
        reservationStatus: 'CONFIRMED',
        total: 900
      }
    ],
    extensions: [
      {
        extendId: 501,
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        extensionType: 'CLIENT',
        reservationStatus: 'PAID',
        extendDays: 2,
        startDate: '2026-11-20T10:00:00',
        endDate: '2026-11-22T10:00:00',
        total: 400
      }
    ]
  });

  assert.equal(firstSync.status, 'success');
  assert.equal(firstSync.importedCount, 1);
  assert.equal(firstSync.updatedCount, 0);
  assert.equal(firstSync.extensionsCount, 1);
  assert.equal(db.state.reservations.length, 1);
  assert.equal(db.state.reservations[0].internal_status, 'مؤكد');
  assert.equal(db.state.reservations[0].extensions_count, 1);
  assert.equal(db.state.reservations[0].extensions_amount, 400);
  assert.equal(db.state.reservations[0].total_amount, 1300);

  // Simulate staff follow-up updating internal_status without source change
  db.state.reservations[0].internal_status = 'تم التسليم';
  db.state.reservations[0].priority = 'مرتفع';
  db.state.reservations[0].assigned_employee_ids = ['EMP_AG1'];

  // 2) Re-sync same CONFIRMED reservation -> must NOT overwrite staff status/priority/assignments or duplicate row
  const unchangedSync = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        reservationStatus: 'CONFIRMED',
        total: 900
      }
    ]
  });
  assert.equal(unchangedSync.importedCount, 0);
  assert.equal(unchangedSync.updatedCount, 1);
  assert.equal(db.state.reservations.length, 1);
  assert.equal(db.state.reservations[0].internal_status, 'تم التسليم');
  assert.equal(db.state.reservations[0].priority, 'مرتفع');
  assert.deepEqual(db.state.reservations[0].assigned_employee_ids, ['EMP_AG1']);

  // 3) Re-sync when Rental Gate moves car to pickup (ACTIVE / PICKED_UP) -> maps to 'ناشط' & appends stage + follow_up_history
  await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        reservationStatus: 'ACTIVE',
        total: 900
      }
    ]
  });
  assert.equal(db.state.reservations[0].original_status_ar, 'ناشط');
  assert.equal(db.state.reservations[0].internal_status, 'ناشط');
  assert.equal(db.state.reservations[0].status_history.length, 2);
  assert.equal(db.state.reservations[0].status_history[1].newStatus, 'ناشط');
  assert.equal(db.state.follow_up_history.length, 1);
  assert.equal(db.state.follow_up_history[0].new_status, 'ناشط');
});

test('router handles login, RBAC enforcement, search, quick status update, dashboard ' + 'ناشط' + ' count, and Sheets mirror outbox', async () => {
  const db = createInMemoryMockExecutor();

  const ping = await dispatchCrmRequest(db, { action: 'ping' });
  assert.equal(ping.success, true);

  // Admin login
  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: 'Admin@123' }
  });
  assert.equal(adminLogin.success, true);
  const adminToken = adminLogin.data.token;
  assert.ok(adminToken.startsWith('SES_'));

  // Agent login + RBAC denial checks
  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: 'Agent@123' }
  });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;

  const forbiddenEmp = await dispatchCrmRequest(db, {
    action: 'createEmployee',
    token: agentToken,
    payload: { name: 'X', username: 'x', password: 'Password1' }
  });
  assert.equal(forbiddenEmp.success, false);
  assert.ok(String(forbiddenEmp.error).startsWith('FORBIDDEN'));

  const forbiddenSettings = await dispatchCrmRequest(db, {
    action: 'getSettings',
    token: agentToken
  });
  assert.equal(forbiddenSettings.success, false);
  assert.ok(String(forbiddenSettings.error).startsWith('FORBIDDEN'));

  // Sync reservation with PICKED_UP status -> ناشط
  await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 7711,
        reservationNumber: 'RG-7711',
        clientName: 'سلمان القحطاني',
        reservationStatus: 'PICKED_UP',
        total: 550
      }
    ]
  });

  // Search reservations via parameterized dispatcher
  const searchRes = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token: adminToken,
    payload: { search: 'RG-7711', page: 1, pageSize: 25 }
  });
  assert.equal(searchRes.success, true);
  assert.equal(searchRes.data.total, 1);
  assert.equal(searchRes.data.items[0].internalStatus, 'ناشط');

  // Dashboard tracks ناشط inside statusDistribution
  const dashRes = await dispatchCrmRequest(db, {
    action: 'getDashboard',
    token: adminToken
  });
  assert.equal(dashRes.success, true);
  assert.equal(dashRes.data.charts.statusDistribution['ناشط'], 1);

  // Quick update status enqueues Sheets backup mirror outbox
  const resId = searchRes.data.items[0].id;
  const updRes = await dispatchCrmRequest(db, {
    action: 'quickUpdateReservationStatus',
    token: agentToken,
    payload: { reservationId: resId, status: 'تم التسليم', note: 'تم التسليم بنجاح' }
  });
  assert.equal(updRes.success, true);
  assert.equal(updRes.data.reservation.internalStatus, 'تم التسليم');
  assert.equal(db.state.sheets_mirror_outbox.length >= 2, true);
});
