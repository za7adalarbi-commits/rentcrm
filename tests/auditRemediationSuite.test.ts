import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { getRiyadhDateTimeParts, hashPassword, normalizeLoginUsername, type AuthSession } from '../backend/auth';
import type { DbClient, DbExecutor, QueryResult } from '../backend/db';
import {
  addFollowUp,
  createEmployee,
  deleteEmployee,
  disableEmployee,
  getReservations,
  recordNoAnswerFollowUp,
  updateEmployee
} from '../backend/queries';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function createTargetedMockExecutor(): DbExecutor & { state: Record<string, any[]> } {
  const state: Record<string, any[]> = {
    employees: [],
    users: [],
    sessions: [],
    settings: [],
    reservations: [],
    extensions: [],
    assignments: [],
    follow_ups: [],
    follow_up_history: [],
    problems: [],
    activity_log: [],
    notifications: [],
    sheets_mirror_outbox: [],
    sync_log: [],
    error_logs: []
  };

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT key, value FROM settings')) {
      return { rows: state.settings as any[], rowCount: state.settings.length };
    }

    if (sql === 'SELECT * FROM employees' || sql.startsWith('SELECT * FROM employees ORDER BY')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql.startsWith('SELECT * FROM employees WHERE id = $1')) {
      const rows = state.employees.filter((e) => e.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees WHERE role')) {
      const excludeId = params[0];
      const cnt = state.employees.filter(
        (e) => e.role === 'general_manager' && e.status === 'active' && e.id !== excludeId
      ).length;
      return { rows: [{ cnt: String(cnt) }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO employees')) {
      const [id, name, username, password_hash, salt, phone, email, job_title, role, permsJson, uiJson, last_activity, created_at] = params;
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
        ui_overrides: JSON.parse(uiJson || '{}'),
        status: 'active',
        last_activity,
        created_at: new Date(created_at),
        updated_at: new Date(created_at)
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO users')) {
      const [id, name, username, phone, email, job_title, role, permsJson, uiJson, last_activity, created_at] = params;
      state.users.push({
        id,
        name,
        username,
        phone,
        email,
        job_title,
        role,
        permissions: JSON.parse(permsJson),
        ui_overrides: JSON.parse(uiJson || '{}'),
        status: 'active',
        last_activity,
        created_at: new Date(created_at),
        updated_at: new Date(created_at)
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE employees SET name = $2')) {
      const emp = state.employees.find((e) => e.id === params[0]);
      if (emp) {
        emp.name = params[1];
        emp.username = params[2];
        emp.phone = params[3];
        emp.email = params[4];
        emp.job_title = params[5];
        emp.role = params[6];
        emp.permissions = JSON.parse(params[7]);
        emp.ui_overrides = JSON.parse(params[8] || '{}');
        emp.status = params[9];
        emp.password_hash = params[10];
        emp.salt = params[11];
        emp.updated_at = new Date(params[12]);
      }
      return { rows: [], rowCount: emp ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE users SET name = $2')) {
      const usr = state.users.find((u) => u.id === params[0]);
      if (usr) {
        usr.name = params[1];
        usr.username = params[2];
        usr.phone = params[3];
        usr.email = params[4];
        usr.job_title = params[5];
        usr.role = params[6];
        usr.permissions = JSON.parse(params[7]);
        usr.ui_overrides = JSON.parse(params[8] || '{}');
        usr.status = params[9];
        usr.updated_at = new Date(params[10]);
      }
      return { rows: [], rowCount: usr ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE sessions SET is_revoked = TRUE')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM sessions WHERE employee_id')) {
      state.sessions = state.sessions.filter((s) => s.employee_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM assignments WHERE employee_id')) {
      state.assignments = state.assignments.filter((a) => a.employee_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, assigned_employee_ids, assigned_employee_names FROM reservations')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, assigned_employee_ids, assigned_employee_names FROM problems')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('DELETE FROM users WHERE id = $1')) {
      state.users = state.users.filter((u) => u.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM employees WHERE id = $1')) {
      state.employees = state.employees.filter((e) => e.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      const hasChanges = sql.includes('changes');
      state.activity_log.push({
        id: params[0],
        user_id: params[1],
        action_type: params[4],
        entity_type: params[5],
        entity_id: params[6],
        details: params[7],
        log_date: hasChanges ? params[9] : params[8],
        log_time: hasChanges ? params[10] : params[9]
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({ id: params[0], entity_type: params[1], action: params[3] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1')) {
      const rows = state.reservations.filter((r) => r.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('UPDATE reservations SET')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.last_update_text = params[1];
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
    if (sql.startsWith('INSERT INTO follow_up_history')) {
      state.follow_up_history.push({ id: params[0], follow_up_id: params[1] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS total_cnt')) {
      return {
        rows: [{
          total_cnt: String(state.reservations.length),
          active_cnt: String(state.reservations.length),
          cancelled_cnt: '0',
          rejected_cnt: '0'
        }] as any[],
        rowCount: 1
      };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM reservations')) {
      return { rows: [{ cnt: String(state.reservations.length) }] as any[], rowCount: 1 };
    }
    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups')) {
      const pageSize = Number(params[params.length - 2] || 25);
      const offset = Number(params[params.length - 1] || 0);
      const list = state.reservations.slice(offset, offset + pageSize);
      return {
        rows: list.map((r) => ({ ...r, is_followed: false })) as any[],
        rowCount: list.length
      };
    }
    if (sql.startsWith('SELECT * FROM extensions')) {
      const resIds: string[] = Array.isArray(params[0]) ? params[0] : [];
      const resNums: string[] = Array.isArray(params[1]) ? params[1] : [];
      const rows = state.extensions.filter(
        (ex) => resIds.includes(ex.reservation_id) || resNums.includes(ex.reservation_number)
      );
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith('SELECT DISTINCT company_name') || sql.startsWith('SELECT DISTINCT branch_name')) {
      return { rows: [], rowCount: 0 };
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

function createSandboxHarness(fixedNowIso?: string) {
  const storage = new Map<string, string>();
  const sessionMap = new Map<string, string>();
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

  let CustomDate: any = Date;
  if (fixedNowIso) {
    const fixedMs = new Date(fixedNowIso).getTime();
    const RealDate = Date;
    CustomDate = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(fixedMs);
        else super(...(args as [any]));
      }
      static now() {
        return fixedMs;
      }
    };
  }

  const context = vm.createContext({
    window: sandboxWindow,
    self: sandboxWindow,
    globalThis: sandboxWindow,
    localStorage: sandboxWindow.localStorage,
    sessionStorage: sandboxWindow.sessionStorage,
    navigator: sandboxWindow.navigator,
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts?: any) {
        this.type = type;
        this.detail = opts?.detail;
      }
    },
    URL,
    Date: CustomDate,
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
  return { api: sandboxWindow.RGApi, window: sandboxWindow };
}

test('Riyadh UTC+3 timezone normalization across midnight rollover in core, backend, and sandbox', async () => {
  // 2026-11-25T21:30:00Z in UTC is already 2026-11-26 00:30:00 in Asia/Riyadh (UTC+3)
  const rolloverUtc = '2026-11-25T21:30:00.000Z';
  const riyadhParts = getRiyadhDateTimeParts(rolloverUtc);
  assert.equal(riyadhParts.date, '2026-11-26');
  assert.equal(riyadhParts.time, '00:30:00');

  const extracted = core.extractDayAndHourFromDateValue(rolloverUtc);
  // 2026-11-26 in Asia/Riyadh is Thursday (getUTCDay() === 4), 00:30 local
  assert.equal(extracted.dayIndex, 4);
  assert.equal(extracted.hour, 0);

  // Wall-clock naive strings keep literal dayIndex & hour without host-timezone shifting
  const naive = core.extractDayAndHourFromDateValue('2026-11-26 14:15:00');
  assert.equal(naive.dayIndex, 4);
  assert.equal(naive.hour, 14);

  // getRiyadhTodayDateStr & computeDashboardMetrics & computeTodayMovementsSummary compute "today" in Asia/Riyadh
  const rolloverNowMs = new Date(rolloverUtc).getTime();
  const riyadhToday = core.getRiyadhTodayDateStr(rolloverNowMs);
  assert.equal(riyadhToday, '2026-11-26');
  const dashMetrics = core.computeDashboardMetrics(
    [
      { id: 'R_TODAY', startDate: '2026-11-26', internalStatus: 'مؤكد', totalAmount: 200 },
      { id: 'R_YESTERDAY', startDate: '2026-11-25', internalStatus: 'مؤكد', totalAmount: 100 }
    ],
    [{ id: 'F1', followUpDate: '2026-11-26', employeeId: 'EMP_1', employeeName: 'Test' }],
    [],
    [],
    null,
    riyadhToday,
    { nowMs: rolloverNowMs }
  );
  assert.equal(dashMetrics.kpis.todayReservations, 1);
  assert.equal(dashMetrics.kpis.todayFollowUps, 1);
  assert.equal(dashMetrics.charts.dailyFollowUps['2026-11-26'], 1);

  const movements = core.computeTodayMovementsSummary(
    [
      { id: 'P1', reservationNumber: '101', startDate: '2026-11-26', startTime: '09:00', endDate: '2026-11-28', internalStatus: 'مؤكد' },
      { id: 'P2', reservationNumber: '102', startDate: '2026-11-24', endDate: '2026-11-26', endTime: '12:00', internalStatus: 'تم التسليم' }
    ],
    rolloverNowMs
  );
  assert.equal(movements.todayDate, '2026-11-26');
  assert.equal(movements.pickupCount, 1);
  assert.equal(movements.returnCount, 1);

  // Mock Date in backend for addFollowUp & recordNoAnswerFollowUp
  const RealDate = Date;
  const fixedMs = new RealDate(rolloverUtc).getTime();
  (globalThis as any).Date = class extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixedMs);
      else super(...(args as [any]));
    }
    static now() {
      return fixedMs;
    }
  };
  try {
    const db = createTargetedMockExecutor();
    db.state.reservations.push({
      id: 'RES_TZ',
      reservation_number: 'TZ-99',
      customer_name: 'عميل التوقيت',
      internal_status: 'تم الإنشاء',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      status_history: []
    });
    const session: AuthSession = {
      tokenHash: 'TH1',
      employeeId: 'EMP_ADM',
      username: 'admin',
      role: 'general_manager',
      expiresAt: '2027-01-01T00:00:00Z',
      user: {
        id: 'EMP_ADM',
        name: 'مدير عام',
        username: 'admin',
        phone: '',
        email: '',
        jobTitle: 'GM',
        role: 'general_manager',
        permissions: ['all'],
        status: 'active',
        lastActivity: '',
        createdAt: '',
        updatedAt: ''
      }
    };

    const fuRes = await addFollowUp(db, session, {
      reservationId: 'RES_TZ',
      status: 'تم الحجز',
      action: 'اتصال',
      notes: 'تأكيد الموعد'
    });
    assert.equal(fuRes.followUp.followUpDate, '2026-11-26');
    assert.equal(fuRes.followUp.followUpTime, '00:30:00');
    assert.equal(db.state.activity_log[0].log_date, '2026-11-26');
    assert.equal(db.state.activity_log[0].log_time, '00:30:00');

    const noAnsRes = await recordNoAnswerFollowUp(db, session, {
      reservationId: 'RES_TZ',
      notes: 'لم يرد'
    });
    assert.equal(noAnsRes.followUp.followUpDate, '2026-11-26');
    assert.equal(noAnsRes.followUp.followUpTime, '00:30:00');
  } finally {
    globalThis.Date = RealDate;
  }

  // Sandbox runtime Date during UTC midnight rollover logs 2026-11-26 in Riyadh
  const { api } = createSandboxHarness(rolloverUtc);
  const sbLogin = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(sbLogin.success, true);
  const sbFu = await api.callApi('addFollowUp', {
    reservationId: 'RES_1001',
    status: 'تم الحجز',
    action: 'اتصال هاتفي',
    notes: 'اختبار التوقيت'
  });
  assert.equal(sbFu.success, true);
  assert.equal(sbFu.data.followUpDate, '2026-11-26');
  assert.equal(sbFu.data.followUpTime, '00:30:00');
});

test('Calendar mode removes 200-row cap, hydrates extensions, and tags overdue/completed events', async () => {
  const eventsSummary = core.extractReservationCalendarEvents(
    [
      {
        id: 'CAL_OVERDUE',
        reservationNumber: 'C-1',
        customerName: 'عميل متأخر',
        carName: 'كامري',
        startDate: '2026-11-20',
        startTime: '10:00',
        endDate: '2026-11-22',
        endTime: '10:00',
        internalStatus: 'تم التسليم',
        priority: 'عاجل'
      },
      {
        id: 'CAL_EXTENDED',
        reservationNumber: 'C-2',
        customerName: 'عميل ممدد',
        carName: 'سوناتا',
        startDate: '2026-11-20',
        startTime: '10:00',
        endDate: '2026-11-22',
        endTime: '10:00',
        internalStatus: 'تم التسليم',
        extensions: [
          {
            id: 'EX_1',
            extendDays: 3,
            startDate: '2026-11-22',
            endDate: '2026-11-25',
            endTime: '10:00',
            isAcceptedAndPaid: true,
            paymentStatus: 'مدفوع'
          }
        ]
      },
      {
        id: 'CAL_DONE',
        reservationNumber: 'C-3',
        customerName: 'عميل منجز',
        carName: 'أكسنت',
        startDate: '2026-11-20',
        startTime: '09:00',
        endDate: '2026-11-23',
        endTime: '18:00',
        internalStatus: 'تم الإرجاع'
      }
    ],
    '2026-11-20',
    '2026-11-26',
    {
      nowMs: new Date('2026-11-25T10:00:00.000Z').getTime()
    }
  );

  const overdueReturnEv = eventsSummary.events.find((e: any) => e.reservationId === 'CAL_OVERDUE' && e.type === 'return');
  assert.ok(overdueReturnEv);
  assert.equal(overdueReturnEv.isOverdue, true);
  assert.equal(overdueReturnEv.isCompleted, false);
  assert.equal(overdueReturnEv.priority, 'عاجل');

  const extendedReturnEv = eventsSummary.events.find((e: any) => e.reservationId === 'CAL_EXTENDED' && e.type === 'extension');
  assert.ok(extendedReturnEv);
  assert.equal(extendedReturnEv.dateIso, '2026-11-25');

  const doneReturnEv = eventsSummary.events.find((e: any) => e.reservationId === 'CAL_DONE' && e.type === 'return');
  assert.ok(doneReturnEv);
  assert.equal(doneReturnEv.isCompleted, true);
  assert.equal(doneReturnEv.isOverdue, false);
  assert.ok(eventsSummary.counts.overdue >= 1);
  assert.ok(eventsSummary.counts.completed >= 1);

  // Backend calendarMode returns >200 records without truncation and attaches extensions
  const db = createTargetedMockExecutor();
  for (let i = 1; i <= 225; i++) {
    db.state.reservations.push({
      id: `RES_BULK_${i}`,
      source_reservation_id: String(10000 + i),
      reservation_number: `B-${i}`,
      customer_name: `عميل ${i}`,
      start_date: '2026-11-25',
      end_date: '2026-11-27',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      status_history: [],
      created_at: new Date('2026-11-24T10:00:00Z'),
      updated_at: new Date('2026-11-24T10:00:00Z')
    });
  }
  db.state.extensions.push({
    id: 'EXT_225',
    extension_number: 'EXT-225',
    sequence_number: 1,
    reservation_id: 'RES_BULK_1',
    reservation_number: 'B-1',
    source_reservation_id: '10001',
    extend_days: 2,
    start_date: '2026-11-27',
    end_date: '2026-11-29',
    is_accepted_and_paid: true
  });

  const adminSession: AuthSession = {
    tokenHash: 'TH_ADM',
    employeeId: 'EMP_ADM',
    username: 'admin',
    role: 'general_manager',
    expiresAt: '2027-01-01T00:00:00Z',
    user: {
      id: 'EMP_ADM',
      name: 'Admin',
      username: 'admin',
      phone: '',
      email: '',
      jobTitle: 'GM',
      role: 'general_manager',
      permissions: ['all'],
      status: 'active',
      lastActivity: '',
      createdAt: '',
      updatedAt: ''
    }
  };

  const calRes = await getReservations(db, adminSession, {
    calendarMode: true,
    calendarFrom: '2026-11-01',
    calendarTo: '2026-11-30',
    pageSize: 2500
  });
  assert.equal(calRes.items.length, 225);
  assert.equal(calRes.items[0].extensions?.length, 1);

  const exportRes = await getReservations(db, adminSession, {
    exportMode: true,
    page: 1,
    pageSize: 250
  });
  assert.equal(exportRes.items.length, 225);

  // Verify frontend wiring for full-window calendar loading, overdue/completed tags, paginated export, and reports filter passthrough
  const reservationsJs = readRepoFile('assets/js/reservations.js');
  assert.ok(reservationsJs.includes('resolveActiveCalendarFetchRange'));
  assert.ok(reservationsJs.includes('calendarMode: true'));
  assert.ok(reservationsJs.includes('resolveExportSourceRows'));
  assert.ok(reservationsJs.includes('exportMode: true'));
  assert.ok(reservationsJs.includes('is-overdue'));
  assert.ok(reservationsJs.includes('is-completed'));

  const reportsJs = readRepoFile('assets/js/reports.js');
  const fuBlocks = reportsJs.split("callApi('getTeamFollowUps'").slice(1);
  assert.equal(fuBlocks.length, 4);
  for (const blk of fuBlocks) {
    const snippet = blk.slice(0, 220);
    assert.ok(snippet.includes('employeeId:'), 'reports.js getTeamFollowUps must pass employeeId');
    assert.ok(snippet.includes('dateFrom:'), 'reports.js getTeamFollowUps must pass dateFrom');
    assert.ok(snippet.includes('dateTo:'), 'reports.js getTeamFollowUps must pass dateTo');
  }
});

test('Employee deduplication, clientRequestId idempotency, and developer account RBAC safeguards', async () => {
  assert.equal(core.normalizeEmployeeEmail('  User.Test@Example.COM '), 'user.test@example.com');
  assert.equal(core.normalizeEmployeePhone('0501234567'), '0501234567');
  assert.equal(core.normalizeEmployeePhone('+966501234567'), '0501234567');
  assert.equal(core.normalizeEmployeePhone('00966-٥٠١٢٣٤٥٦٧'), '0501234567');

  const db = createTargetedMockExecutor();
  const makeEmp = (id: string, username: string, role: string, phone: string, email: string) => ({
    id,
    name: username,
    username,
    password_hash: hashPassword('Pass@123', 'SALT'),
    salt: 'SALT',
    phone,
    email,
    job_title: role,
    role,
    permissions: ['all'],
    ui_overrides: {},
    status: 'active',
    last_activity: '',
    created_at: new Date(),
    updated_at: new Date()
  });

  db.state.employees.push(
    makeEmp('EMP_DEV1', 'dev1', 'developer', '0500000001', 'dev1@rentalgate.sa'),
    makeEmp('EMP_DEV2', 'dev2', 'developer', '0500000002', 'dev2@rentalgate.sa'),
    makeEmp('EMP_GM1', 'gm1', 'general_manager', '0500000003', 'gm1@rentalgate.sa'),
    makeEmp('EMP_AG1', 'agent1', 'agent', '0501234567', 'agent1@rentalgate.sa')
  );

  const mkSession = (emp: any): AuthSession => ({
    tokenHash: `T_${emp.id}`,
    employeeId: emp.id,
    username: emp.username,
    role: emp.role,
    expiresAt: '2027-01-01T00:00:00Z',
    user: {
      id: emp.id,
      name: emp.name,
      username: emp.username,
      phone: emp.phone,
      email: emp.email,
      jobTitle: emp.job_title,
      role: emp.role,
      permissions: ['all'],
      status: 'active',
      lastActivity: '',
      createdAt: '',
      updatedAt: ''
    }
  });

  const devSession = mkSession(db.state.employees[0]);
  const gmSession = mkSession(db.state.employees[2]);

  // Idempotent createEmployee via clientRequestId creates exactly 1 row even when invoked twice
  const firstCreate = await createEmployee(db, gmSession, {
    name: 'سارة الدوسري',
    username: 'Sara_Agent',
    password: 'Password@123',
    phone: '0551112233',
    email: 'Sara@RentalGate.sa',
    role: 'agent',
    clientRequestId: 'REQ_EMP_IDEM_1'
  });
  const secondCreate = await createEmployee(db, gmSession, {
    name: 'سارة الدوسري',
    username: 'Sara_Agent',
    password: 'Password@123',
    phone: '0551112233',
    email: 'Sara@RentalGate.sa',
    role: 'agent',
    clientRequestId: 'REQ_EMP_IDEM_1'
  });
  assert.equal(firstCreate.id, secondCreate.id);
  assert.equal(db.state.employees.filter((e) => e.username === 'sara_agent').length, 1);

  // Duplicate normalized username (Arabic numerals/case), email, and canonical Saudi phone rejected
  await assert.rejects(
    () =>
      createEmployee(db, gmSession, {
        name: 'Duplicate User',
        username: 'Agent١',
        password: 'Password@123',
        role: 'agent'
      }),
    /DUPLICATE_USERNAME/
  );
  await assert.rejects(
    () =>
      createEmployee(db, gmSession, {
        name: 'Duplicate Email',
        username: 'newuser_em',
        password: 'Password@123',
        email: 'SARA@rentalgate.sa',
        role: 'agent'
      }),
    /DUPLICATE_EMAIL/
  );
  await assert.rejects(
    () =>
      createEmployee(db, gmSession, {
        name: 'Duplicate Phone',
        username: 'newuser_ph',
        password: 'Password@123',
        phone: '+966551112233',
        role: 'agent'
      }),
    /DUPLICATE_PHONE/
  );

  // GM cannot create, edit, disable, or delete a developer account
  await assert.rejects(
    () =>
      createEmployee(db, gmSession, {
        name: 'Rogue Dev',
        username: 'roguedev',
        password: 'Password@123',
        role: 'developer'
      }),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => updateEmployee(db, gmSession, { employeeId: 'EMP_DEV2', name: 'Hacked' }),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => disableEmployee(db, gmSession, { employeeId: 'EMP_DEV2', status: 'disabled' }),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => deleteEmployee(db, gmSession, { employeeId: 'EMP_DEV2' }),
    /FORBIDDEN/
  );

  // Last-active GM cannot be deleted or demoted
  await assert.rejects(
    () => deleteEmployee(db, devSession, { employeeId: 'EMP_GM1' }),
    /FORBIDDEN/
  );

  // Developer cannot self-delete, CAN delete secondary developer, and CANNOT delete/demote last active developer
  await assert.rejects(
    () => deleteEmployee(db, devSession, { employeeId: 'EMP_DEV1' }),
    /FORBIDDEN/
  );
  const delSecDev = await deleteEmployee(db, devSession, { employeeId: 'EMP_DEV2' });
  assert.equal(delSecDev.deleted, true);

  await assert.rejects(
    () => updateEmployee(db, devSession, { employeeId: 'EMP_DEV1', role: 'agent' }),
    /FORBIDDEN/
  );

  // Sandbox parity verification for employee dedupe & secondary developer cleanup
  const { api } = createSandboxHarness();
  const devLogin = await api.callApi('login', { username: 'developer', password: process.env.RG_SEED_DEV_PASSWORD || 'Dev@123' });
  assert.equal(devLogin.success, true);
  const sbDev2 = await api.callApi('createEmployee', {
    name: 'مبرمج احتياطي',
    username: 'dev_backup',
    password: 'DevPassword@1',
    phone: '0598765432',
    email: 'devbackup@rentalgate.sa',
    role: 'developer',
    clientRequestId: 'SB_REQ_DEV2'
  });
  assert.equal(sbDev2.success, true);

  // Replay with same clientRequestId succeeds idempotently (bypassing 1200ms UI double-click debounce via _replayingOfflineQueue)
  const sbDev2Replay = await api.callApi('createEmployee', {
    name: 'مبرمج احتياطي',
    username: 'dev_backup',
    password: 'DevPassword@1',
    phone: '0598765432',
    email: 'devbackup@rentalgate.sa',
    role: 'developer',
    clientRequestId: 'SB_REQ_DEV2',
    _replayingOfflineQueue: true
  });
  assert.equal(sbDev2Replay.success, true);
  assert.equal(sbDev2Replay.data.id, sbDev2.data.id);

  // Duplicate phone in international format blocked in sandbox
  const sbDupPhone = await api.callApi('createEmployee', {
    name: 'مكرر جوال',
    username: 'unique_u99',
    password: 'Password@123',
    phone: '+966598765432',
    role: 'agent'
  });
  assert.equal(sbDupPhone.success, false);
  assert.equal(sbDupPhone.error, 'DUPLICATE');
  assert.ok(String(sbDupPhone.message).includes('الجوال'));

  // Developer can delete secondary developer in sandbox
  const sbDelSec = await api.callApi('deleteEmployee', { employeeId: sbDev2.data.id });
  assert.equal(sbDelSec.success, true);
});
