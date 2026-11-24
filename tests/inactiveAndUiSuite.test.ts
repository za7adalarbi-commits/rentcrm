import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

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

test('Core National ID normalization, lifecycle classification, redaction, and customer deduplication', () => {
  assert.equal(core.normalizeNationalId('١٠٦-٧٢٣ ١٨٤٥'), '1067231845');
  assert.equal(core.normalizeNationalId('۱۰۶۷۲۳۱۸۴۵'), '1067231845');

  assert.equal(core.isRejectedStatus('مرفوض'), true);
  assert.equal(core.isRejectedStatus('rejected'), true);
  assert.equal(core.isCancelledStatus('تم الإلغاء'), true);
  assert.equal(core.isCancelledStatus('cancelled'), true);

  assert.equal(core.isInactiveReservation({ internalStatus: 'مرفوض' }), true);
  assert.equal(core.isInactiveReservation({ internalStatus: 'تم الإلغاء' }), true);
  assert.equal(core.isInactiveReservation({ statusCode: 'rejected', internalStatus: 'قيد المتابعة' }), true);
  assert.equal(core.isInactiveReservation({ internalStatus: 'تم التأكيد' }), false);

  assert.equal(core.getReservationLifecycleKind({ internalStatus: 'مرفوض' }), 'rejected');
  assert.equal(core.getReservationLifecycleKind({ internalStatus: 'تم الإلغاء' }), 'cancelled');
  assert.equal(core.getReservationLifecycleKind({ internalStatus: 'تم التأكيد' }), 'active');

  const agentRestricted = { role: 'agent', permissions: ['view_reservations'] };
  const adminWithId = { role: 'general_manager', permissions: ['view_customer_id'] };
  assert.equal(core.canUserViewCustomerId(agentRestricted), false);
  assert.equal(core.canUserViewCustomerId(adminWithId), true);

  const sampleRes = { id: 'R1', customerName: 'عميل', customerIdNumber: '1067231845', company: 'يولو' };
  assert.equal(core.redactReservationSensitiveFields(sampleRes, agentRestricted).customerIdNumber, '');
  assert.equal(core.redactReservationSensitiveFields(sampleRes, adminWithId).customerIdNumber, '1067231845');

  const grouped = core.groupCustomerLookupResults([
    { id: 'R1', reservationNumber: '1001', customerName: 'أحمد العتيبي', customerPhone: '0501234567', customerEmail: 'a@test.com', customerIdNumber: '١٠٦٧٢٣١٨٤٥', internalStatus: 'تم التأكيد', startDate: '2026-11-24', totalAmount: 500 },
    { id: 'R2', reservationNumber: '1002', customerName: 'أحمد العتيبي', customerPhone: '0501234567', customerIdNumber: '1067231845', internalStatus: 'مرفوض', startDate: '2026-11-20', totalAmount: 300 },
    { id: 'R3', reservationNumber: '1003', customerName: 'أحمد العتيبي', customerPhone: '0501234567', customerIdNumber: '1067231845', internalStatus: 'تم الإلغاء', startDate: '2026-11-18', totalAmount: 200 },
    { id: 'R4', reservationNumber: '1004', customerName: 'عميل آخر', customerPhone: '0550000000', customerIdNumber: '2222222222', internalStatus: 'تم التأكيد', startDate: '2026-11-22', totalAmount: 400 }
  ], '1067231845');

  assert.equal(grouped.found, true);
  assert.equal(grouped.customer.nationalId, '1067231845');
  assert.equal(grouped.customer.name, 'أحمد العتيبي');
  assert.equal(grouped.stats.totalCount, 3);
  assert.equal(grouped.stats.activeCount, 1);
  assert.equal(grouped.stats.rejectedCount, 1);
  assert.equal(grouped.stats.cancelledCount, 1);
  assert.equal(grouped.activeReservations.length, 1);
  assert.equal(grouped.inactiveReservations.length, 2);

  const emptyLookup = core.groupCustomerLookupResults([], '0000000000');
  assert.equal(emptyLookup.found, false);
  assert.equal(emptyLookup.customer, null);
});

test('Sync merge & auto-reconciliation never reactivate rejected or cancelled reservations', () => {
  const existingRejected = {
    id: 'RES_REJ_1',
    reservationNumber: '8881',
    internalStatus: 'مرفوض',
    rejectionReason: 'رفض من الشركة',
    rejectedByName: 'المدير العام',
    rejectedAt: '2026-11-24T10:00:00.000Z',
    newCompanyName: 'Badger',
    refundAmount: 450,
    carStatusAtRequest: 'متاحة',
    statusCode: 'confirmed'
  };
  const incomingActivePayload = {
    id: 'RES_REJ_1',
    reservationNumber: '8881',
    statusCode: 'confirmed',
    statusAr: 'مؤكد',
    internalStatus: 'تم التأكيد'
  };

  assert.equal(core.shouldAutoReconcileSyncedStatus('مرفوض', 'confirmed'), false);
  assert.equal(core.shouldAutoReconcileSyncedStatus('تم الإلغاء', 'active'), false);
  const merged = core.mergeSyncedReservation(existingRejected, incomingActivePayload);
  assert.equal(merged.internalStatus, 'مرفوض');
  assert.equal(merged.rejectionReason, 'رفض من الشركة');
  assert.equal(merged.newCompanyName, 'Badger');
  assert.equal(core.isInactiveReservation(merged), true);
});

test('UI overrides precedence, Developer protection, and inactive.js / index.html / CSS wiring', () => {
  const roleDefaults = {
    agent: {
      enabled: true,
      forceForRole: false,
      uiSimplification: { preset: 'custom', hideResRejectBtn: true, hideNavInactiveReservations: false }
    }
  };
  const agentUser = {
    id: 'EMP_AG1',
    role: 'agent',
    uiOverrides: { hideResRejectBtn: false, hideResIdLookup: true }
  };
  const resolvedAgent = core.resolveRoleUiDefaultsForUser(agentUser, roleDefaults, {});
  assert.equal(resolvedAgent.uiSimplification.hideResRejectBtn, false);
  assert.equal(resolvedAgent.uiSimplification.hideResIdLookup, true);

  const devUser = {
    id: 'EMP_DEV',
    role: 'developer',
    uiOverrides: { hideResRejectBtn: true, hideNavInactiveReservations: true }
  };
  const resolvedDev = core.resolveRoleUiDefaultsForUser(devUser, roleDefaults, { hideNavInactiveReservations: true });
  assert.equal(resolvedDev.uiSimplification.hideNavInactiveReservations, false);
  assert.equal(resolvedDev.uiSimplification.hideResRejectBtn, false);

  const html = readRepoFile('index.html');
  assert.match(html, /assets\/js\/inactive\.js/);

  const css = readRepoFile('assets/css/dashboard.css');
  for (const cls of [
    'rg-ui-hide-nav-inactive-reservations',
    'rg-ui-hide-res-rejected-tab',
    'rg-ui-hide-res-id-lookup',
    'rg-ui-hide-res-reject-btn',
    'rg-ui-hide-res-cancel-btn'
  ]) {
    assert.ok(css.includes(`html.${cls}`), `Expected CSS class ${cls} in dashboard.css`);
  }
});

test('Sandbox E2E: reject, cancel, restore, inactive filters, National ID lookup, RBAC, and UI overrides', async () => {
  const { api } = createSandboxHarness();

  const adminLogin = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(adminLogin.success, true);

  // Pull active list and pickup/return feed before mutations
  const activeBefore = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'active' });
  assert.equal(activeBefore.success, true);
  assert.ok(activeBefore.data.items.length >= 2);

  const firstRes = activeBefore.data.items[0];
  const secondRes = activeBefore.data.items[1];

  // 1) Reject first reservation
  const rejRes = await api.callApi('rejectReservation', {
    reservationId: firstRes.id,
    rejectionReason: 'تأخر التسليم من الشركة',
    companyNumber: 'CMP-778',
    newCompanyName: 'شركة بديل للسيارات',
    carStatusAtRequest: 'متاحة عند الطلب',
    refundAmount: 650,
    note: 'تحويل فوري'
  });
  assert.equal(rejRes.success, true);
  assert.equal(rejRes.data.reservation.internalStatus, 'مرفوض');
  assert.equal(rejRes.data.reservation.newCompanyName, 'شركة بديل للسيارات');
  assert.equal(rejRes.data.reservation.refundAmount, 650);

  // 2) Cancel second reservation
  const canRes = await api.callApi('cancelReservation', {
    reservationId: secondRes.id,
    cancellationReason: 'طلب العميل الإلغاء',
    note: 'إلغاء مؤكد'
  });
  assert.equal(canRes.success, true);
  assert.equal(canRes.data.reservation.internalStatus, 'تم الإلغاء');

  // 3) Neither rejected nor cancelled booking appears in active list OR today movements
  const activeAfter = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'active', forceRefresh: true });
  const activeIds = new Set(activeAfter.data.items.map((r: any) => r.id));
  assert.equal(activeIds.has(firstRes.id), false);
  assert.equal(activeIds.has(secondRes.id), false);

  const todayAfter = await api.callApi('getTodayAndRadar', { forceRefresh: true });
  assert.equal(todayAfter.success, true);
  const pickupReturnIds = new Set([
    ...(todayAfter.data.pickups || []),
    ...(todayAfter.data.returns || []),
    ...(todayAfter.data.todayItems || []),
    ...(todayAfter.data.radarItems || [])
  ].map((r: any) => r.id));
  assert.equal(pickupReturnIds.has(firstRes.id), false);
  assert.equal(pickupReturnIds.has(secondRes.id), false);

  // 4) Both appear in their dedicated inactive sub-tabs with preserved details
  const rejTab = await api.callApi('getInactiveReservations', { subTab: 'rejected', companyNumber: 'CMP-778' });
  assert.equal(rejTab.success, true);
  assert.equal(rejTab.data.items.some((r: any) => r.id === firstRes.id && r.newCompanyName === 'شركة بديل للسيارات'), true);

  const canTab = await api.callApi('getInactiveReservations', { subTab: 'cancelled' });
  assert.equal(canTab.success, true);
  assert.equal(canTab.data.items.some((r: any) => r.id === secondRes.id), true);

  // 5) National ID lookup with Arabic digits returns single deduplicated profile & both active+inactive bookings
  if (firstRes.customerIdNumber) {
    const arabicId = String(firstRes.customerIdNumber).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    const lookupRes = await api.callApi('searchCustomerByNationalId', { nationalId: arabicId });
    assert.equal(lookupRes.success, true);
    assert.equal(lookupRes.data.found, true);
    assert.equal(lookupRes.data.customer.nationalId, core.normalizeNationalId(firstRes.customerIdNumber));
    assert.ok(lookupRes.data.inactiveReservations.some((r: any) => r.id === firstRes.id));
  }
  const emptyLookup = await api.callApi('searchCustomerByNationalId', { nationalId: '0000000000' });
  assert.equal(emptyLookup.success, true);
  assert.equal(emptyLookup.data.found, false);

  // 6) Restore returns booking back to Active Reservations
  const restRes = await api.callApi('restoreReservation', { reservationId: firstRes.id, targetStatus: 'قيد المتابعة' });
  assert.equal(restRes.success, true);
  const activeRestored = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'active', forceRefresh: true });
  assert.equal(activeRestored.data.items.some((r: any) => r.id === firstRes.id), true);

  // 7) UI overrides & Restore Defaults work for GM, while Developer account stays protected
  const empRes = await api.callApi('getEmployees', {});
  const agentEmp = empRes.data.items.find((e: any) => e.username === 'agent1');
  const devEmp = empRes.data.items.find((e: any) => e.role === 'developer');
  assert.ok(agentEmp);
  assert.ok(devEmp);

  const ovSave = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: agentEmp.id,
    uiOverrides: { hideResIdLookup: true, hideResRejectBtn: true }
  });
  assert.equal(ovSave.success, true);
  assert.equal(ovSave.data.employee.uiOverrides.hideResIdLookup, true);

  const devProtectAttempt = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: devEmp.id,
    uiOverrides: { hideNavInactiveReservations: true }
  });
  assert.equal(devProtectAttempt.success, false);
  assert.equal(devProtectAttempt.error, 'FORBIDDEN');

  const roleUiSave = await api.callApi('saveRoleUiDefaults', {
    role_ui_defaults: {
      agent: { enabled: true, forceForRole: false, uiSimplification: { preset: 'custom', hideResCancelBtn: true } }
    },
    ui_simplification: { preset: 'custom', hideDashboardHeatmap: true }
  });
  assert.equal(roleUiSave.success, true);
  assert.equal(roleUiSave.data.role_ui_defaults.agent.uiSimplification.hideResCancelBtn, true);

  const restoreAll = await api.callApi('restoreUiDefaults', { scope: 'all', clearEmployees: true });
  assert.equal(restoreAll.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(restoreAll.data.role_ui_defaults)), {});

  // 8) Restricted agent RBAC checks & Customer ID redaction
  const agentLogin = await api.callApi('login', { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' });
  assert.equal(agentLogin.success, true);
  const agentList = await api.callApi('getReservations', { page: 1, pageSize: 20, lifecycle: 'active' });
  assert.equal(agentList.success, true);
  assert.equal(agentList.data.items.every((r: any) => !r.customerIdNumber), true);

  const deniedLookup = await api.callApi('searchCustomerByNationalId', { nationalId: '1067231845' });
  assert.equal(deniedLookup.success, false);
  assert.equal(deniedLookup.error, 'FORBIDDEN');

  const deniedReject = await api.callApi('rejectReservation', { reservationId: firstRes.id, rejectionReason: 'اختبار' });
  assert.equal(deniedReject.success, false);
});

test('National ID leading zeros, partial multi-customer lookup separation, and non-destructive re-sync', () => {
  // Leading zeros must remain intact as String (never converted to Number)
  assert.equal(core.normalizeNationalId('0098765432'), '0098765432');
  assert.equal(core.normalizeNationalId('٠٠٩٨٧٦٥٤٣٢'), '0098765432');

  const extId = core.extractCustomerNationalId({ customer: { national_id: '٠٠٤٥٦٧٨٩٠١' } }, null);
  assert.equal(extId, '0045678901');
  assert.equal(typeof extId, 'string');

  // Re-sync backfill preserves existing ID when incoming payload omits it, and updates when missing
  const oldWithoutId = {
    id: 'RES_BACKFILL_1',
    reservationNumber: '9001',
    customerName: 'عميل قديم',
    customerIdNumber: '',
    internalStatus: 'تم التأكيد',
    originalStatusCode: 'confirmed'
  };
  const backfilled = core.mergeSyncedReservation(
    oldWithoutId,
    { id: '9001', reservationNumber: '9001', clientNationalId: '0011223344', status: 'confirmed' },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(backfilled.customerIdNumber, '0011223344');

  const preservedAfterEmptySync = core.mergeSyncedReservation(
    backfilled,
    { id: '9001', reservationNumber: '9001', status: 'confirmed' },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(preservedAfterEmptySync.customerIdNumber, '0011223344');

  // Partial National ID search (>=4 digits) returns distinct customer profiles without mixing bookings
  const partialRes = core.groupCustomerLookupResults([
    { id: 'P1', reservationNumber: '501', customerName: 'فهد القحطاني', customerPhone: '0501111111', customerIdNumber: '0045123456', internalStatus: 'تم التأكيد' },
    { id: 'P2', reservationNumber: '502', customerName: 'فهد القحطاني', customerPhone: '0501111111', customerIdNumber: '0045123456', internalStatus: 'مرفوض' },
    { id: 'P3', reservationNumber: '503', customerName: 'خالد الشمري', customerPhone: '0552222222', customerIdNumber: '1045123999', internalStatus: 'تم الإلغاء' }
  ], '4512');

  assert.equal(partialRes.found, true);
  assert.equal(partialRes.customers.length, 2);
  assert.equal(partialRes.totalMatches, 3);
  assert.equal(partialRes.customers[0].nationalId, '0045123456');
  assert.equal(partialRes.customers[0].reservations.length, 2);
  assert.equal(partialRes.customers[1].nationalId, '1045123999');
  assert.equal(partialRes.customers[1].reservations.length, 1);
});

test('Sandbox E2E: UI overrides persist across logout/login & active fast-query never leaks inactive bookings', async () => {
  const { api } = createSandboxHarness();
  await api.ready();

  const gmLogin = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(gmLogin.success, true);

  // Import Excel with mixed active/rejected/cancelled rows -> getReservations must stay strictly active
  const beforeList = await api.callApi('getReservations', { page: 1, pageSize: 100 });
  assert.equal(beforeList.success, true);
  assert.equal(beforeList.data.items.some((r: any) => core.isInactiveReservation(r)), false);

  const empRes = await api.callApi('getEmployees', {});
  const agentEmp = empRes.data.items.find((e: any) => e.username === 'agent1');
  assert.ok(agentEmp);

  // Save UI overrides for agent1
  const saveOv = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: agentEmp.id,
    uiOverrides: { hideNavReports: true, hideResRejectBtn: true }
  });
  assert.equal(saveOv.success, true);

  // Logout & login as agent1 -> overrides persist on session user and resolve cleanly
  await api.callApi('logout', {});
  const agentLogin = await api.callApi('login', { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' });
  assert.equal(agentLogin.success, true);
  const resolvedAgentUi = core.resolveRoleUiDefaultsForUser(agentLogin.data.user, {}, {});
  assert.equal(resolvedAgentUi.uiSimplification.hideNavReports, true);
  assert.equal(resolvedAgentUi.uiSimplification.hideResRejectActionBtn, true);

  // Developer user remains immune to UI hide flags
  const devResolved = core.resolveRoleUiDefaultsForUser(
    { id: 'DEV1', role: 'developer', uiOverrides: { hideNavReports: true, hideNavSettings: true } },
    { developer: { enabled: true, forceForRole: true, uiSimplification: { hideNavReports: true } } },
    { hideNavReports: true }
  );
  assert.equal(devResolved.uiSimplification.hideNavReports, false);
});

