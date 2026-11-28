import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import core from '../backend/coreBridge.cjs';
import { hashToken } from '../backend/auth.js';
import {
  deterministicCustomerId,
  extractCustomerDraftFromReservation,
  formatCustomerSummaryRow
} from '../backend/customerHelpers.js';
import { dispatchCrmRequest } from '../backend/router.js';

function bootSandboxApi() {
  const storage = new Map<string, string>();
  const sandboxWindow: Record<string, any> = {
    location: {
      search: '?sandbox=1',
      pathname: '/',
      hash: '',
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000/?sandbox=1'
    },
    navigator: { onLine: true },
    RG_APP_CONFIG: { mode: 'sandbox', gasWebAppUrl: '', backendApiUrl: '' },
    localStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k: string) => (storage.has(`sess:${k}`) ? storage.get(`sess:${k}`)! : null),
      setItem: (k: string, v: string) => storage.set(`sess:${k}`, String(v)),
      removeItem: (k: string) => storage.delete(`sess:${k}`)
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts: any = {}) {
        this.type = type;
        this.detail = opts.detail;
      }
    }
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;
  sandboxWindow.globalThis = sandboxWindow;

  const ctx = vm.createContext({
    window: sandboxWindow,
    self: sandboxWindow,
    globalThis: sandboxWindow,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    Error,
    EventSource: undefined,
    fetch: undefined
  });

  const coreCode = fs.readFileSync(path.resolve('assets/js/core.js'), 'utf8');
  const apiCode = fs.readFileSync(path.resolve('assets/js/api.js'), 'utf8');
  vm.runInContext(coreCode, ctx);
  vm.runInContext(apiCode, ctx);
  return {
    api: sandboxWindow.RGApi,
    core: sandboxWindow.RGCrmCore,
    storage
  };
}

function createRbacMockExecutor() {
  const tokenRestricted = 'tok_restricted_agent';
  const tokenCustomerAgent = 'tok_customer_agent';
  const tokenSupervisor = 'tok_supervisor';
  const tokenAdmin = 'tok_admin';

  const restrictedPerms = ['view_dashboard', 'view_reservations', 'add_followup'];
  const customerAgentPerms = [
    'view_dashboard',
    'view_reservations',
    'view_customers',
    'sub_view_cust_dashboard',
    'sub_view_cust_complaints',
    'sub_view_cust_timeline',
    'edit_customer_details',
    'add_customer_note',
    'act_edit_customer',
    'act_add_customer_note'
  ];

  const employees = [
    {
      id: 'EMP_ADM',
      name: 'المدير العام',
      username: 'admin',
      phone: '+966500000001',
      email: 'admin@rg.local',
      job_title: 'General Manager',
      role: 'general_manager',
      permissions: core.ROLE_PERMISSION_MATRIX.general_manager.slice(),
      status: 'active'
    },
    {
      id: 'EMP_SUP',
      name: 'المشرف العام',
      username: 'supervisor',
      phone: '+966500000002',
      email: 'sup@rg.local',
      job_title: 'Supervisor',
      role: 'supervisor',
      permissions: core.ROLE_PERMISSION_MATRIX.supervisor.slice(),
      status: 'active'
    },
    {
      id: 'EMP_CUST',
      name: 'موظف خدمة العملاء',
      username: 'custagent',
      phone: '+966500000003',
      email: 'cust@rg.local',
      job_title: 'Customer Agent',
      role: 'agent',
      permissions: customerAgentPerms,
      status: 'active'
    },
    {
      id: 'EMP_REST',
      name: 'موظف مقيد',
      username: 'restricted',
      phone: '+966500000004',
      email: 'rest@rg.local',
      job_title: 'Restricted',
      role: 'agent',
      permissions: restrictedPerms,
      status: 'active'
    }
  ];

  const sessions = [
    { token: tokenAdmin, emp: employees[0] },
    { token: tokenSupervisor, emp: employees[1] },
    { token: tokenCustomerAgent, emp: employees[2] },
    { token: tokenRestricted, emp: employees[3] }
  ].map((entry) => ({
    token_hash: hashToken(entry.token),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    is_revoked: false,
    employee_id: entry.emp.id,
    username: entry.emp.username,
    role: entry.emp.role,
    emp_id: entry.emp.id,
    name: entry.emp.name,
    emp_username: entry.emp.username,
    email: entry.emp.email,
    phone: entry.emp.phone,
    job_title: entry.emp.job_title,
    emp_role: entry.emp.role,
    permissions: entry.emp.permissions,
    emp_status: 'active',
    ui_overrides: {}
  }));

  const state: Record<string, any[]> = {
    customers: [
      {
        id: 'CUS_1',
        customer_key: 'PH_966501112233',
        full_name: 'فهد بن سعيد القحطاني',
        phone: '+966501112233',
        country_code: '+966',
        normalized_phone: '966501112233',
        email: 'fahad@example.com',
        id_number: '1044556677',
        id_type: 'هوية وطنية',
        status: 'نشط',
        status_override: false,
        assigned_employee_id: 'EMP_CUST',
        assigned_employee_name: 'موظف خدمة العملاء',
        notes: 'عميل دائم',
        tags: ['VIP'],
        source: 'sync',
        last_contact_at: '2026-11-25T10:00:00.000Z',
        created_at: new Date('2026-11-20T08:00:00.000Z'),
        updated_at: new Date('2026-11-25T10:00:00.000Z')
      }
    ],
    customer_notes: [],
    reservations: [
      {
        id: 'RES_1',
        reservation_number: 'RG-7701',
        customer_id: 'CUS_1',
        customer_name: 'فهد بن سعيد القحطاني',
        customer_phone: '+966501112233',
        customer_email: 'fahad@example.com',
        customer_id_number: '1044556677',
        company_name: 'بدجت',
        branch_name: 'الرياض',
        car_name: 'Camry 2026',
        start_date: '2026-11-22',
        end_date: '2026-11-28',
        original_status_code: 'active',
        original_status_ar: 'نشط الآن',
        internal_status: 'تم التسليم',
        total_amount: 1400,
        paid_amount: 1400,
        extensions_count: 1,
        extensions_amount: 300,
        has_extensions: true,
        has_problem: false,
        is_source_cancelled: false,
        is_source_rejected: false,
        assigned_employee_ids: ['EMP_CUST'],
        assigned_employee_names: ['موظف خدمة العملاء'],
        created_at: new Date('2026-11-21T09:00:00.000Z'),
        updated_at: new Date('2026-11-25T10:00:00.000Z')
      }
    ],
    employees,
    problems: [],
    follow_ups: [],
    activity_log: []
  };

  const query = async (rawSql: string, params: any[] = []) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();

    if (sql.includes('FROM sessions s') && sql.includes('token_hash = $1')) {
      const th = String(params[0] || '');
      const hit = sessions.find((s) => s.token_hash === th);
      return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('UPDATE sessions SET last_seen_at')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM reservations WHERE id = $1')) {
      const hit = state.reservations.find((r) => r.id === params[0]);
      return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM customers WHERE id = $1')) {
      const hit = state.customers.find((c) => c.id === params[0]);
      return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM customers WHERE customer_key = $1')) {
      const hit = state.customers.find((c) => c.customer_key === params[0]);
      return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO customers')) {
      const rec = {
        id: params[0],
        customer_key: params[1],
        full_name: params[2],
        phone: params[3],
        country_code: params[4],
        normalized_phone: params[5],
        email: params[6],
        id_number: params[7],
        id_type: params[8],
        status: params[9],
        status_override: params[10],
        assigned_employee_id: params[11],
        assigned_employee_name: params[12],
        notes: params[13],
        tags: JSON.parse(params[14] || '[]'),
        source: params[15],
        created_at: new Date(params[16]),
        updated_at: new Date(params[16])
      };
      state.customers.push(rec);
      return { rows: [rec], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO customer_notes')) {
      const note = {
        id: params[0],
        customer_id: params[1],
        reservation_id: params[2],
        reservation_number: params[3],
        note_type: params[4],
        content: params[5],
        created_by_id: params[6],
        created_by_name: params[7],
        created_at: new Date(params[8]),
        updated_at: new Date(params[8])
      };
      state.customer_notes.push(note);
      return { rows: [note], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE customers SET last_contact_at')) {
      const cust = state.customers.find((c) => c.id === params[0]);
      if (cust) {
        if (params[1]) cust.last_contact_at = params[2];
        cust.updated_at = new Date(params[2]);
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ action: params[4], entity: params[5] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, name FROM employees WHERE id = $1')) {
      const emp = employees.find((e) => e.id === params[0]);
      return emp ? { rows: [{ id: emp.id, name: emp.name }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM employees')) {
      return { rows: employees, rowCount: employees.length };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    tokens: { tokenAdmin, tokenSupervisor, tokenCustomerAgent, tokenRestricted },
    state,
    executor: {
      query,
      withTransaction: async (fn: (client: any) => Promise<any>) => fn({ query })
    }
  };
}

test('core customer helpers extract country codes, detect ID types, build canonical keys, and redact ID numbers', () => {
  const sa = core.extractPhoneCountryCode('0501234567');
  assert.equal(sa.countryCode, '+966');
  assert.equal(sa.normalizedPhone, '966501234567');

  const eg = core.extractPhoneCountryCode('+20 100 222 3344');
  assert.equal(eg.countryCode, '+20');
  assert.equal(eg.normalizedPhone, '201002223344');

  assert.equal(core.detectCustomerIdType('1044556677'), 'هوية وطنية');
  assert.equal(core.detectCustomerIdType('2144556677'), 'إقامة');
  assert.equal(core.detectCustomerIdType('A1234567'), 'جواز سفر');

  assert.equal(
    core.buildCustomerCanonicalKey({ phone: '+966501234567', idNumber: '1044556677', name: 'Test' }),
    'PH_966501234567'
  );
  assert.equal(
    core.buildCustomerCanonicalKey('+966501234567', '1044556677', 'Test'),
    'PH_966501234567'
  );
  assert.equal(
    core.buildCustomerCanonicalKey({ idNumber: '1044556677', name: 'Test' }),
    'ID_1044556677'
  );
  assert.equal(
    core.buildCustomerCanonicalKey({ email: 'USER@EXAMPLE.COM', name: 'Test' }),
    'EM_user@example.com'
  );

  assert.equal(
    core.computeCustomerLifecycleStatus({ totalBookings: 2, activeBookingsCount: 0, openProblemsCount: 1 }),
    'لديه مشكلة'
  );
  assert.equal(
    core.computeCustomerLifecycleStatus({ totalBookings: 3, activeBookingsCount: 0, openProblemsCount: 0 }),
    'متكرر'
  );
  assert.equal(
    core.computeCustomerLifecycleStatus({ totalBookings: 1, activeBookingsCount: 1, openProblemsCount: 0 }),
    'نشط'
  );

  const agentNoId = { role: 'agent', permissions: ['view_customers'] };
  const agentWithId = { role: 'agent', permissions: ['view_customers', 'view_customer_id'] };
  const redacted = core.redactCustomerSensitiveFields({ id: 'CUS_1', idNumber: '1044556677', idType: 'هوية وطنية' }, agentNoId);
  assert.equal(redacted.idNumber, '');
  assert.equal(redacted.idType, '');

  const visible = core.redactCustomerSensitiveFields({ id: 'CUS_1', idNumber: '1044556677', idType: 'هوية وطنية' }, agentWithId);
  assert.equal(visible.idNumber, '1044556677');
  assert.equal(visible.idType, 'هوية وطنية');
});

test('EMPLOYEE_SECTION_GROUPS includes customer module permissions and backend customerHelpers extract consistent drafts', () => {
  const mainGroup = core.EMPLOYEE_SECTION_GROUPS.find((g: any) => g.id === 'main_sections');
  const subGroup = core.EMPLOYEE_SECTION_GROUPS.find((g: any) => g.id === 'sub_sections');
  const actGroup = core.EMPLOYEE_SECTION_GROUPS.find((g: any) => g.id === 'table_actions');
  assert.ok(mainGroup.items.some((i: any) => i.key === 'view_customers'));
  assert.ok(subGroup.items.some((i: any) => i.key === 'sub_view_cust_dashboard'));
  assert.ok(subGroup.items.some((i: any) => i.key === 'sub_view_cust_complaints'));
  assert.ok(subGroup.items.some((i: any) => i.key === 'sub_view_cust_timeline'));
  assert.ok(actGroup.items.some((i: any) => i.key === 'act_edit_customer'));
  assert.ok(actGroup.items.some((i: any) => i.key === 'act_assign_customer'));
  assert.ok(actGroup.items.some((i: any) => i.key === 'act_add_customer_note'));

  assert.equal(core.ROLE_PERMISSION_MATRIX.general_manager.includes('view_customers'), true);
  assert.equal(core.ROLE_PERMISSION_MATRIX.general_manager.includes('act_close_delete_ticket'), true);
  assert.equal(core.ROLE_PERMISSION_MATRIX.supervisor.includes('view_customers'), true);
  assert.equal(core.ROLE_PERMISSION_MATRIX.agent.includes('view_customers'), true);

  const draft = extractCustomerDraftFromReservation({
    id: 'RES_1',
    reservationNumber: 'RG-100',
    customerName: 'خالد السبيعي',
    customerPhone: '0551122334',
    customerEmail: 'khalid@mail.com',
    customerIdNumber: '1099887766'
  });
  assert.equal(draft.customerKey, 'PH_966551122334');
  assert.equal(draft.id, deterministicCustomerId(draft.customerKey));
  assert.equal(draft.countryCode, '+966');
  assert.equal(draft.idType, 'هوية وطنية');

  const formatted = formatCustomerSummaryRow(
    { id: draft.id, customer_key: draft.customerKey, full_name: 'خالد السبيعي', id_number: '1099887766', bookings_count: 2 },
    { role: 'agent', permissions: ['view_customers'] }
  );
  assert.equal(formatted.idNumber, '');
  assert.equal(formatted.bookingsCount, 2);
});

test('sandbox RGApi handles full customer lifecycle, search, complaints, notes, timeline, and report redaction', async () => {
  const { api } = bootSandboxApi();

  const loginRes = await api.callApi('login', { username: 'admin', password: 'Admin@123' });
  assert.equal(loginRes.success, true, 'Sandbox admin login succeeds');

  const listRes = await api.callApi('getCustomers', { page: 1, limit: 25 });
  assert.equal(listRes.success, true);
  assert.ok(listRes.data.items.length > 0, 'Sandbox seeds customers from reservations');
  assert.ok(typeof listRes.data.kpis.totalCustomers === 'number');
  assert.ok(typeof listRes.data.kpis.repeatCustomers === 'number');
  assert.ok(typeof listRes.data.kpis.withExtensionsCustomers === 'number');
  assert.ok(Array.isArray(listRes.data.recentCustomers));

  const target = listRes.data.items[0];
  const detailRes = await api.callApi('getCustomerDetails', { customerId: target.id });
  assert.equal(detailRes.success, true);
  assert.equal(detailRes.data.customer.id, target.id);
  assert.ok(Array.isArray(detailRes.data.reservations));
  assert.ok(Array.isArray(detailRes.data.timeline));
  assert.ok(detailRes.data.financialSummary && typeof detailRes.data.financialSummary.totalAmount === 'number');

  // Search by phone
  if (target.phone) {
    const phoneDigits = String(target.phone).replace(/\D/g, '').slice(-6);
    const searchRes = await api.callApi('getCustomers', { search: phoneDigits, page: 1, limit: 20 });
    assert.equal(searchRes.success, true);
    assert.ok(searchRes.data.items.some((c: any) => c.id === target.id));
  }

  // Create customer
  const createRes = await api.callApi('createCustomer', {
    fullName: 'نورة عبدالرحمن الزهراني',
    phone: '+966509988776',
    email: 'noura.test@example.com',
    idNumber: '1088776655',
    notes: 'عميلة جديدة من اختبار النظام'
  });
  assert.equal(createRes.success, true);
  const createdId = createRes.data.id;
  assert.ok(createdId);
  assert.equal(createRes.data.countryCode, '+966');
  assert.equal(createRes.data.idType, 'هوية وطنية');

  // Update profile + add note
  const updRes = await api.callApi('updateCustomerProfile', {
    customerId: createdId,
    fullName: 'نورة عبدالرحمن الزهراني - متكرر',
    status: 'متكرر',
    tags: ['متكرر', 'تواصل سريع']
  });
  assert.equal(updRes.success, true);
  assert.equal(updRes.data.customer.status, 'متكرر');

  const noteRes = await api.callApi('addCustomerNote', {
    customerId: createdId,
    noteType: 'مكالمة',
    content: 'تم التواصل هاتفياً لتأكيد باقة الإيجار'
  });
  assert.equal(noteRes.success, true);

  // Create complaint linked directly to customer
  const compRes = await api.callApi('createProblem', {
    customerId: createdId,
    customerName: 'نورة عبدالرحمن الزهراني - VIP',
    ticketType: 'شكوى',
    category: 'شكوى عميل',
    priority: 'مرتفع',
    description: 'تأخر في تجهيز السيارة بالفرع'
  });
  assert.equal(compRes.success, true);
  assert.equal(compRes.data.customerId, createdId);
  assert.equal(compRes.data.ticketType, 'شكوى');

  // Re-fetch details and verify complaint & note appear in profile & timeline
  const createdDetail = await api.callApi('getCustomerDetails', { customerId: createdId });
  assert.equal(createdDetail.success, true);
  assert.ok(createdDetail.data.notes.some((n: any) => n.content.includes('تم التواصل هاتفياً')));
  assert.ok(createdDetail.data.problems.some((p: any) => p.ticketType === 'شكوى'));
  assert.ok(createdDetail.data.timeline.length >= 2);

  // Reports endpoint supports 'customers'
  const repRes = await api.callApi('getReports', { reportType: 'customers' });
  assert.equal(repRes.success, true);
  assert.equal(repRes.data.reportType, 'customers');
  assert.ok(Array.isArray(repRes.data.rows));
  assert.ok(repRes.data.rows.some((r: any) => r.id === createdId));
});

test('backend dispatchCrmRequest enforces granular RBAC on customer & follow-up/problem endpoints', async () => {
  const { tokens, executor } = createRbacMockExecutor();

  // Restricted agent cannot view customers
  const deniedList = await dispatchCrmRequest(executor, {
    action: 'getCustomers',
    token: tokens.tokenRestricted,
    payload: {}
  });
  assert.equal(deniedList.success, false);
  assert.match(String(deniedList.message), /FORBIDDEN|صلاحية/);

  // Restricted agent cannot view team follow-ups or problems without route permission
  const deniedFollowUps = await dispatchCrmRequest(executor, {
    action: 'getTeamFollowUps',
    token: tokens.tokenRestricted,
    payload: {}
  });
  assert.equal(deniedFollowUps.success, false);
  assert.match(String(deniedFollowUps.message), /FORBIDDEN|صلاحية/);

  const deniedProblems = await dispatchCrmRequest(executor, {
    action: 'getProblems',
    token: tokens.tokenRestricted,
    payload: {}
  });
  assert.equal(deniedProblems.success, false);
  assert.match(String(deniedProblems.message), /FORBIDDEN|صلاحية/);

  // Customer agent without act_assign_customer cannot assign customer employee
  const deniedAssign = await dispatchCrmRequest(executor, {
    action: 'assignCustomerEmployee',
    token: tokens.tokenCustomerAgent,
    payload: { customerId: 'CUS_1', employeeId: 'EMP_SUP' }
  });
  assert.equal(deniedAssign.success, false);
  assert.match(String(deniedAssign.message), /FORBIDDEN|صلاحية/);

  // Customer agent WITH edit_customer_details & add_customer_note can create customer & add note
  const created = await dispatchCrmRequest(executor, {
    action: 'createCustomer',
    token: tokens.tokenCustomerAgent,
    payload: {
      fullName: 'عبدالعزيز الشمري',
      phone: '+966552233445',
      idNumber: '1012345678'
    }
  });
  assert.equal(created.success, true);
  // Customer agent lacks view_customer_id -> returned idNumber is redacted
  assert.equal(created.data.idNumber, '');
  assert.equal(created.data.idType, '');

  const noteAdded = await dispatchCrmRequest(executor, {
    action: 'addCustomerNote',
    token: tokens.tokenCustomerAgent,
    payload: {
      customerId: created.data.id,
      noteType: 'مكالمة',
      content: 'متابعة ترحيبية مع العميل @supervisor'
    }
  });
  assert.equal(noteAdded.success, true);
  assert.equal(noteAdded.data.note.noteType, 'مكالمة');
});

test('customer_notes.closed_at normalization & SQL parameter types strictly enforce TIMESTAMPTZ / real NULL', async () => {
  const { normalizeOptionalTimestamptz, addCustomerNote, updateCustomerNote } = await import('../backend/queries.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  assert.equal(normalizeOptionalTimestamptz(null), null);
  assert.equal(normalizeOptionalTimestamptz(undefined), null);
  assert.equal(normalizeOptionalTimestamptz(''), null);
  assert.equal(normalizeOptionalTimestamptz('   '), null);
  assert.equal(normalizeOptionalTimestamptz('null'), null);
  assert.equal(normalizeOptionalTimestamptz('NULL'), null);
  assert.equal(normalizeOptionalTimestamptz('undefined'), null);
  const dt = new Date('2026-11-27T12:30:00.000Z');
  assert.equal(normalizeOptionalTimestamptz(dt), '2026-11-27T12:30:00.000Z');
  assert.equal(normalizeOptionalTimestamptz('2026-11-27T15:30:00+03:00'), '2026-11-27T12:30:00.000Z');
  assert.throws(() => normalizeOptionalTimestamptz('not-a-valid-date'), /VALIDATION_ERROR/);

  const capturedQueries: Array<{ sql: string; params: any[] }> = [];
  const notesRows: Record<string, any> = {};
  const statusRows = [
    {
      id: 'CNST_NEW',
      name: 'جديدة',
      description: 'جديدة',
      color: '#3B82F6',
      sort_order: 1,
      is_active: true,
      is_default: true,
      allow_agent_select: true,
      is_closed_status: false
    },
    {
      id: 'CNST_CLOSED',
      name: 'مغلقة',
      description: 'مغلقة',
      color: '#10B981',
      sort_order: 2,
      is_active: true,
      is_default: false,
      allow_agent_select: true,
      is_closed_status: true
    }
  ];

  const mockDb: any = {
    async query(sql: string, params: any[] = []) {
      const clean = sql.replace(/\s+/g, ' ').trim();
      capturedQueries.push({ sql: clean, params });
      if (clean.includes('FROM settings')) return { rows: [], rowCount: 0 };
      if (clean.includes('SELECT COUNT(*)::text AS cnt FROM customer_note_statuses')) return { rows: [{ cnt: '2' }], rowCount: 1 };
      if (clean.includes('FROM customer_note_statuses')) return { rows: statusRows, rowCount: statusRows.length };
      if (clean.includes('FROM customers WHERE id = $1')) return { rows: [{ id: 'CUS_1', full_name: 'عميل تجريبي' }], rowCount: 1 };
      if (clean.startsWith('INSERT INTO customer_notes')) {
        assert.match(clean, /\$17::timestamptz/, 'addCustomerNote INSERT must cast closed_at ($17) as ::timestamptz');
        assert.doesNotMatch(clean, /\$17::text/, 'addCustomerNote INSERT must never cast closed_at ($17) as ::text');
        const row = {
          id: params[0],
          customer_id: params[1],
          reservation_id: params[2],
          reservation_number: params[3],
          problem_id: params[4],
          problem_number: params[5],
          title: params[6],
          note_type: params[7],
          content: params[8],
          status_id: params[9],
          status_name: params[10],
          status_color: params[11],
          assigned_employee_id: params[12],
          assigned_employee_name: params[13],
          is_internal: params[14],
          is_closed: params[15],
          closed_at: params[16],
          closed_by_id: params[17],
          closed_by_name: params[18],
          source_section: params[19],
          created_by_id: params[20],
          created_by_name: params[21],
          updated_by_id: params[20],
          updated_by_name: params[21],
          created_at: params[22],
          updated_at: params[22]
        };
        notesRows[row.id] = row;
        return { rows: [row], rowCount: 1 };
      }
      if (clean.startsWith('SELECT * FROM customer_notes WHERE id = $1')) {
        const hit = notesRows[params[0]];
        return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (clean.startsWith('UPDATE customer_notes SET title = $2')) {
        assert.match(clean, /closed_at = CASE[\s\S]*\$13::timestamptz/, 'updateCustomerNote must cast closed_at as ::timestamptz');
        const hit = notesRows[params[0]];
        if (hit) {
          hit.title = params[1];
          hit.note_type = params[2];
          hit.content = params[3];
          hit.status_id = params[4];
          hit.status_name = params[5];
          hit.status_color = params[6];
          hit.is_internal = params[7];
          hit.is_closed = params[8];
          hit.closed_at = params[8] ? (params[12] || hit.closed_at || params[11]) : null;
          hit.closed_by_id = params[8] ? (hit.closed_by_id || params[9]) : '';
          hit.closed_by_name = params[8] ? (hit.closed_by_name || params[10]) : '';
          hit.updated_by_id = params[9];
          hit.updated_by_name = params[10];
          hit.updated_at = params[11];
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async withTransaction(fn: (tx: any) => Promise<any>) {
      return fn(mockDb);
    }
  };

  const session: any = {
    token: 'tok-1',
    user: { id: 'EMP_ADM', name: 'مشرف النظام', role: 'general_manager', permissions: core.ROLE_PERMISSION_MATRIX.general_manager.slice() }
  };

  // 1) Open note -> closed_at param ($17, index 16) is real null
  const openRes = await addCustomerNote(mockDb, session, {
    customerId: 'CUS_1',
    title: 'ملاحظة مفتوحة',
    content: 'متابعة حجز العميل',
    noteType: 'ملاحظة',
    statusId: 'CNST_NEW',
    closedAt: 'null',
    isInternal: true
  });
  const openInsert = capturedQueries.find((q) => q.sql.startsWith('INSERT INTO customer_notes'));
  assert.ok(openInsert);
  assert.equal(openInsert.params[16], null);
  assert.equal(openRes.note.isClosed, false);
  assert.equal(openRes.note.closedAt, '');
  assert.equal(openRes.note.isInternal, true);

  // 2) Update note to Closed -> closed_at gets valid ISO timestamp & closed_by_* populated
  const updClosed = await updateCustomerNote(mockDb, session, {
    noteId: openRes.note.id,
    statusId: 'CNST_CLOSED',
    content: 'تم إغلاق المتابعة بنجاح'
  });
  assert.equal(updClosed.note.isClosed, true);
  assert.ok(updClosed.note.closedAt && !Number.isNaN(Date.parse(updClosed.note.closedAt)));
  assert.equal(updClosed.note.closedById, 'EMP_ADM');

  // 3) Check frontend knowledgeBase.js uses RGApi.callApi and zero RGApi.call(
  const kbJs = fs.readFileSync(path.join(process.cwd(), 'assets', 'js', 'knowledgeBase.js'), 'utf8');
  assert.equal(/\bRGApi\.call\s*\(/.test(kbJs), false, 'knowledgeBase.js must never call nonexistent RGApi.call(');
  assert.match(kbJs, /\bRGApi\.callApi\s*\(/, 'knowledgeBase.js must invoke RGApi.callApi(');
});

