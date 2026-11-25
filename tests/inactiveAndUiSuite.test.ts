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

test('Sync merge reconciles to authoritative external status without leaving conflicting lifecycle timestamps', () => {
  const existingActive = {
    id: 'RES_SYNC_1',
    reservationNumber: '8881',
    internalStatus: 'قيد الانتظار',
    originalStatusCode: 'pending',
    originalStatusAr: 'قيد الانتظار',
    lastUpdateText: 'تم السحب من Rental Gate بالحالة: قيد الانتظار'
  };
  const incomingRejected = {
    id: 'RES_SYNC_1',
    reservationNumber: '8881',
    status: 'rejected',
    rejectionReason: 'تأخر التسليم من الشركة',
    newCompanyName: 'Badger',
    refundAmount: 450
  };
  const mergedRejected = core.mergeSyncedReservation(existingActive, incomingRejected, [], { id: 'SYNC', name: 'Sync' });
  assert.equal(mergedRejected.internalStatus, 'مرفوض');
  assert.equal(core.getReservationLifecycleKind(mergedRejected), 'rejected');
  assert.ok(mergedRejected.rejectedAt);
  assert.equal(mergedRejected.cancelledAt, '');
  assert.equal(mergedRejected.rejectionReason, 'تأخر التسليم من الشركة');

  // If external Rental Gate later updates status to cancelled or active, sync reflects external status cleanly and clears rejectedAt
  const incomingCancelled = {
    id: 'RES_SYNC_1',
    reservationNumber: '8881',
    status: 'cancelled',
    cancellationReason: 'إلغاء من العميل'
  };
  const mergedCancelled = core.mergeSyncedReservation(mergedRejected, incomingCancelled, [], { id: 'SYNC', name: 'Sync' });
  assert.equal(mergedCancelled.internalStatus, 'ملغي');
  assert.equal(core.getReservationLifecycleKind(mergedCancelled), 'cancelled');
  assert.equal(mergedCancelled.rejectedAt, '');
  assert.ok(mergedCancelled.cancelledAt);

  // Conflicting status/timestamp combinations obey authoritative external status without swapping across tabs
  assert.equal(core.classifyReservationLifecycle({
    originalStatusCode: 'cancelled',
    internalStatus: 'مرفوض',
    rejectedAt: '2026-11-24T10:00:00Z'
  }), 'cancelled');
  assert.equal(core.classifyReservationLifecycle({
    originalStatusCode: 'confirmed',
    internalStatus: 'تم التأكيد',
    rejectedAt: '2026-11-24T10:00:00Z'
  }), 'active');
  assert.equal(core.isManualBlockedWorkflowStatus('مرفوض'), true);
  assert.equal(core.isManualBlockedWorkflowStatus('تم الإلغاء'), true);
  assert.equal(core.isManualBlockedWorkflowStatus('تم التأكيد'), false);
  assert.equal(core.getWorkflowStatusOptions('مرفوض').includes('مرفوض'), false);
});

test('UI overrides precedence, Developer protection, unified navigation removal of inactive-reservations, and CSS wiring', () => {
  const roleDefaults = {
    agent: {
      enabled: true,
      forceForRole: false,
      uiSimplification: { preset: 'custom', hideResCancelledTab: true, hideResRejectedTab: false }
    }
  };
  const agentUser = {
    id: 'EMP_AG1',
    role: 'agent',
    uiOverrides: { hideResCancelledTab: false, hideResIdLookup: true }
  };
  const resolvedAgent = core.resolveRoleUiDefaultsForUser(agentUser, roleDefaults, {});
  assert.equal(resolvedAgent.uiSimplification.hideResCancelledTab, false);
  assert.equal(resolvedAgent.uiSimplification.hideResIdLookup, true);

  const devUser = {
    id: 'EMP_DEV',
    role: 'developer',
    uiOverrides: { hideResCancelledTab: true, hideResRejectedTab: true }
  };
  const resolvedDev = core.resolveRoleUiDefaultsForUser(devUser, roleDefaults, { hideResRejectedTab: true });
  assert.equal(resolvedDev.uiSimplification.hideResRejectedTab, false);
  assert.equal(resolvedDev.uiSimplification.hideResCancelledTab, false);

  const html = readRepoFile('index.html');
  assert.equal(html.includes('href="#inactive-reservations"'), false);

  const appJs = readRepoFile('assets/js/app.js');
  assert.equal(appJs.includes("'inactive-reservations':"), false);
  assert.equal(appJs.includes("id: 'inactive-reservations'"), false);
  assert.ok(appJs.includes("viewMode: 'all'"));

  const reservationsJs = readRepoFile('assets/js/reservations.js');
  assert.equal(reservationsJs.includes('res-active-tab-count'), false);
  assert.equal(reservationsJs.includes('data-res-view="active"'), false);
  assert.ok(reservationsJs.includes("viewMode: 'all'"));

  const tabMatches = Array.from(reservationsJs.matchAll(/data-res-view="(all|today|radar|rejected|cancelled)"/g)).map((m) => m[1]);
  assert.deepEqual(tabMatches, ['all', 'today', 'radar', 'rejected', 'cancelled']);

  assert.ok(reservationsJs.includes('REJECTED_COLUMNS'));
  assert.ok(reservationsJs.includes('CANCELLED_COLUMNS'));
  assert.ok(reservationsJs.includes("label: 'الشركة الجديدة'"));
  assert.ok(reservationsJs.includes("label: 'التأكيد بواسطة'"));
  assert.ok(reservationsJs.includes("label: 'الرقم المرجعي'"));
  assert.ok(reservationsJs.includes("label: 'سبب فشل التوصيل'"));
  assert.ok(reservationsJs.includes("label: 'ملاحظات السائق'"));
  assert.ok(reservationsJs.includes('لم يُسجّل سبب في المصدر لهذا الحجز'));
  assert.equal(reservationsJs.includes("var naText = isEn ? 'N/A' : 'غير متاح';"), false);
  assert.equal(reservationsJs.includes('naText'), false);
  assert.ok(reservationsJs.includes('rg-lifecycle-table'));
  assert.ok(reservationsJs.includes('rg-lifecycle-banner-card'));

  const css = readRepoFile('assets/css/dashboard.css');
  for (const cls of [
    'rg-ui-hide-res-rejected-tab',
    'rg-ui-hide-res-cancelled-tab',
    'rg-ui-hide-res-id-lookup'
  ]) {
    assert.ok(css.includes(`html.${cls}`), `Expected CSS class ${cls} in dashboard.css`);
  }
  assert.equal(css.includes('rg-ui-hide-nav-inactive-reservations'), false);
  assert.equal(css.includes('rg-ui-hide-res-reject-btn'), false);
  assert.equal(css.includes('rg-ui-hide-res-cancel-btn'), false);
});

test('Sandbox E2E: unified lifecycle tabs, forbidden manual reject/cancel/restore, National ID lookup, RBAC, and UI overrides', async () => {
  const { api } = createSandboxHarness();

  const adminLogin = await api.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(adminLogin.success, true);

  // 1) Active list returns active bookings only + full lifecycleCounts, while cancelled & rejected appear under dedicated lifecycle tabs
  const activeList = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'active' });
  assert.equal(activeList.success, true);
  assert.ok(activeList.data.items.length >= 2);
  assert.equal(activeList.data.items.some((r: any) => core.isInactiveReservation(r)), false);
  assert.ok(activeList.data.lifecycleCounts);
  assert.ok(activeList.data.lifecycleCounts.rejected >= 2);
  assert.ok(activeList.data.lifecycleCounts.cancelled >= 2);

  const rejectedList = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'rejected' });
  assert.equal(rejectedList.success, true);
  assert.ok(rejectedList.data.items.length >= 2);
  assert.equal(rejectedList.data.items.every((r: any) => core.classifyReservationLifecycle(r) === 'rejected'), true);

  const cancelledList = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'cancelled' });
  assert.equal(cancelledList.success, true);
  assert.ok(cancelledList.data.items.length >= 2);
  assert.equal(cancelledList.data.items.every((r: any) => core.classifyReservationLifecycle(r) === 'cancelled'), true);

  // Verify distinct Booking # and Reference # on Sandbox Rejected & Cancelled fixtures
  const r1006 = cancelledList.data.items.find((r: any) => r.id === 'RES_1006');
  const r1011 = cancelledList.data.items.find((r: any) => r.id === 'RES_1011');
  const r1010 = rejectedList.data.items.find((r: any) => r.id === 'RES_1010');
  const r1012 = rejectedList.data.items.find((r: any) => r.id === 'RES_1012');
  assert.equal(r1006?.reservationNumber, 'RG-2026-8846');
  assert.equal(r1006?.referenceNumber, 'RG-CAN-884601');
  assert.equal(r1011?.reservationNumber, '885101');
  assert.equal(r1011?.referenceNumber, 'RG-CAN-885101');
  assert.equal(r1010?.reservationNumber, 'RG-2026-8850');
  assert.equal(r1010?.referenceNumber, 'RG-DEC-885001');
  assert.equal(r1012?.reservationNumber, '885201');
  assert.equal(r1012?.referenceNumber, '');

  const allList = await api.callApi('getReservations', { page: 1, pageSize: 100, lifecycle: 'all' });
  assert.equal(allList.success, true);
  assert.equal(
    allList.data.total,
    activeList.data.lifecycleCounts.active + activeList.data.lifecycleCounts.rejected + activeList.data.lifecycleCounts.cancelled
  );
  assert.equal(typeof activeList.data.lifecycleCounts.today, 'number');
  assert.equal(typeof activeList.data.lifecycleCounts.radar, 'number');
  assert.equal(allList.data.lifecycleCounts.all, allList.data.total);

  const firstActive = activeList.data.items[0];
  const firstRejected = rejectedList.data.items[0];
  const firstCancelled = cancelledList.data.items[0];

  // 2) Manual reject, cancel, restore, and manual status transitions into rejected/cancelled or out of inactive are strictly forbidden
  const rejRes = await api.callApi('rejectReservation', { reservationId: firstActive.id, rejectionReason: 'اختبار' });
  assert.equal(rejRes.success, false);
  assert.equal(rejRes.error, 'FORBIDDEN_MANUAL_ACTION');

  const canRes = await api.callApi('cancelReservation', { reservationId: firstActive.id, cancellationReason: 'اختبار' });
  assert.equal(canRes.success, false);
  assert.equal(canRes.error, 'FORBIDDEN_MANUAL_ACTION');

  const restRes = await api.callApi('restoreReservation', { reservationId: firstRejected.id, targetStatus: 'قيد المتابعة' });
  assert.equal(restRes.success, false);
  assert.equal(restRes.error, 'FORBIDDEN_MANUAL_ACTION');

  const quickRejAttempt = await api.callApi('quickUpdateReservationStatus', { reservationId: firstActive.id, status: 'مرفوض' });
  assert.equal(quickRejAttempt.success, false);
  assert.equal(quickRejAttempt.error, 'FORBIDDEN_MANUAL_ACTION');

  const quickCanAttempt = await api.callApi('quickUpdateReservationStatus', { reservationId: firstActive.id, status: 'تم الإلغاء' });
  assert.equal(quickCanAttempt.success, false);
  assert.equal(quickCanAttempt.error, 'FORBIDDEN_MANUAL_ACTION');

  const editInactiveAttempt = await api.callApi('quickUpdateReservationStatus', { reservationId: firstCancelled.id, status: 'تم التأكيد' });
  assert.equal(editInactiveAttempt.success, false);
  assert.equal(editInactiveAttempt.error, 'FORBIDDEN_MANUAL_ACTION');

  // 3) Neither rejected nor cancelled bookings appear in today movements or 24h radar
  const todayAfter = await api.callApi('getTodayAndRadar', { forceRefresh: true });
  assert.equal(todayAfter.success, true);
  const pickupReturnIds = new Set([
    ...(todayAfter.data.pickups || []),
    ...(todayAfter.data.returns || []),
    ...(todayAfter.data.todayItems || []),
    ...(todayAfter.data.radarItems || [])
  ].map((r: any) => r.id));
  assert.equal(pickupReturnIds.has(firstRejected.id), false);
  assert.equal(pickupReturnIds.has(firstCancelled.id), false);

  // 4) National ID lookup with Arabic digits & leading zeros returns single deduplicated profile
  const leadingZeroRow = allList.data.items.find((r: any) => r.customerIdNumber === '0098765432');
  assert.ok(leadingZeroRow);
  const arabicId = '٠٠٩٨٧٦٥٤٣٢';
  const lookupRes = await api.callApi('searchCustomerByNationalId', { nationalId: arabicId });
  assert.equal(lookupRes.success, true);
  assert.equal(lookupRes.data.found, true);
  assert.equal(lookupRes.data.customer.nationalId, '0098765432');

  const noIdRow = allList.data.items.find((r: any) => r.id === 'RES_1005');
  assert.ok(noIdRow);
  assert.equal(noIdRow.customerIdNumber, '');

  const emptyLookup = await api.callApi('searchCustomerByNationalId', { nationalId: '0000000000' });
  assert.equal(emptyLookup.success, true);
  assert.equal(emptyLookup.data.found, false);

  // 5) UI overrides & Restore Defaults work for GM, while Developer account stays protected
  const empRes = await api.callApi('getEmployees', {});
  const agentEmp = empRes.data.items.find((e: any) => e.username === 'agent1');
  const devEmp = empRes.data.items.find((e: any) => e.role === 'developer');
  assert.ok(agentEmp);
  assert.ok(devEmp);

  const ovSave = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: agentEmp.id,
    uiOverrides: { hideResIdLookup: true, hideResCancelledTab: true }
  });
  assert.equal(ovSave.success, true);
  assert.equal(ovSave.data.employee.uiOverrides.hideResIdLookup, true);
  assert.equal(ovSave.data.employee.uiOverrides.hideResCancelledTab, true);

  const devProtectAttempt = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: devEmp.id,
    uiOverrides: { hideResCancelledTab: true }
  });
  assert.equal(devProtectAttempt.success, false);
  assert.equal(devProtectAttempt.error, 'FORBIDDEN');

  const roleUiSave = await api.callApi('saveRoleUiDefaults', {
    role_ui_defaults: {
      agent: { enabled: true, forceForRole: false, uiSimplification: { preset: 'custom', hideResCancelledTab: true } }
    },
    ui_simplification: { preset: 'custom', hideDashboardHeatmap: true }
  });
  assert.equal(roleUiSave.success, true);
  assert.equal(roleUiSave.data.role_ui_defaults.agent.uiSimplification.hideResCancelledTab, true);

  const restoreAll = await api.callApi('restoreUiDefaults', { scope: 'all', clearEmployees: true });
  assert.equal(restoreAll.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(restoreAll.data.role_ui_defaults)), {});

  // 6) Restricted agent RBAC checks & Customer ID redaction
  const agentLogin = await api.callApi('login', { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' });
  assert.equal(agentLogin.success, true);
  const agentList = await api.callApi('getReservations', { page: 1, pageSize: 20, lifecycle: 'active' });
  assert.equal(agentList.success, true);
  assert.equal(agentList.data.items.every((r: any) => !r.customerIdNumber), true);

  const deniedLookup = await api.callApi('searchCustomerByNationalId', { nationalId: '0098765432' });
  assert.equal(deniedLookup.success, false);
  assert.equal(deniedLookup.error, 'FORBIDDEN');
});

test('National ID leading zeros, cross-customer phone mismatch isolation, and non-destructive re-sync', () => {
  // Leading zeros must remain intact as String (never converted to Number)
  assert.equal(core.normalizeNationalId('0098765432'), '0098765432');
  assert.equal(core.normalizeNationalId('٠٠٩٨٧٦٥٤٣٢'), '0098765432');

  const extId = core.extractCustomerNationalId({ customer: { national_id: '٠٠٤٥٦٧٨٩٠١' } }, null);
  assert.equal(extId, '0045678901');
  assert.equal(typeof extId, 'string');

  // Re-sync backfill updates when missing, preserves when same customer, clears when customer phone changed (no cross-client leak)
  const oldWithoutId = {
    id: 'RES_BACKFILL_1',
    reservationNumber: '9001',
    customerName: 'عميل قديم',
    customerPhone: '0501111111',
    customerIdNumber: '',
    internalStatus: 'تم التأكيد',
    originalStatusCode: 'confirmed'
  };
  const backfilled = core.mergeSyncedReservation(
    oldWithoutId,
    { id: '9001', reservationNumber: '9001', clientMobile: '0501111111', clientNationalId: '0011223344', status: 'confirmed' },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(backfilled.customerIdNumber, '0011223344');

  const preservedSameCustomer = core.mergeSyncedReservation(
    backfilled,
    { id: '9001', reservationNumber: '9001', clientMobile: '0501111111', status: 'confirmed' },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(preservedSameCustomer.customerIdNumber, '0011223344');

  const clearedDifferentCustomer = core.extractCustomerNationalId(
    { reservationNumber: '9001', clientMobile: '0559998888' },
    backfilled
  );
  assert.equal(clearedDifferentCustomer, '');

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

  const beforeList = await api.callApi('getReservations', { page: 1, pageSize: 100 });
  assert.equal(beforeList.success, true);
  assert.equal(beforeList.data.items.some((r: any) => core.isInactiveReservation(r)), false);

  const empRes = await api.callApi('getEmployees', {});
  const agentEmp = empRes.data.items.find((e: any) => e.username === 'agent1');
  assert.ok(agentEmp);

  const saveOv = await api.callApi('saveEmployeeUiOverrides', {
    employeeId: agentEmp.id,
    uiOverrides: { hideNavReports: true, hideResCancelledTab: true }
  });
  assert.equal(saveOv.success, true);

  await api.callApi('logout', {});
  const agentLogin = await api.callApi('login', { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' });
  assert.equal(agentLogin.success, true);
  const resolvedAgentUi = core.resolveRoleUiDefaultsForUser(agentLogin.data.user, {}, {});
  assert.equal(resolvedAgentUi.uiSimplification.hideNavReports, true);
  assert.equal(resolvedAgentUi.uiSimplification.hideResCancelledTab, true);

  const devResolved = core.resolveRoleUiDefaultsForUser(
    { id: 'DEV1', role: 'developer', uiOverrides: { hideNavReports: true, hideNavSettings: true } },
    { developer: { enabled: true, forceForRole: true, uiSimplification: { hideNavReports: true } } },
    { hideNavReports: true }
  );
  assert.equal(devResolved.uiSimplification.hideNavReports, false);
});

test('National ID nested objects, junk placeholder filtering, sync actor fallback, and coreBridge parity', () => {
  const bridgeCore = require('../backend/coreBridge.cjs');
  assert.equal(typeof bridgeCore.extractCustomerNationalId, 'function');

  // Junk placeholders must be ignored instead of stored as National IDs
  assert.equal(core.extractCustomerNationalId({ customerIdNumber: '0000000000', customer: { national_id: 'غير متاح' } }, null), '');
  assert.equal(core.extractCustomerNationalId({ clientInfo: { id_number: '٠٠١٢٣٤٥٦٧٨' } }, null), '0012345678');
  assert.equal(bridgeCore.extractCustomerNationalId({ clientInfo: { id_number: '٠٠١٢٣٤٥٦٧٨' } }, null), '0012345678');

  // Actor fallback for rejected reservations supports confirmedByName / actionByName
  const mergedRejected = core.mergeSyncedReservation(
    { id: 'RES_REJ_9', reservationNumber: '7771', internalStatus: 'قيد الانتظار', originalStatusCode: 'pending' },
    {
      id: 'RES_REJ_9',
      reservationNumber: '7771',
      status: 'rejected',
      rejectionReason: 'السيارة غير متوفرة',
      confirmedByName: 'مشرف المنصة',
      actionAt: '2026-11-24T11:30:00Z'
    },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(mergedRejected.rejectedByName, 'مشرف المنصة');
  assert.equal(mergedRejected.rejectedAt, '2026-11-24T11:30:00Z');
  assert.equal(core.classifyReservationLifecycle(mergedRejected), 'rejected');
});

test('Reason extraction isolates per-booking reasons, strips placeholder strings, and never falls back to lastUpdateText in UI', () => {
  // Placeholder values must never masquerade as reasons
  assert.equal(core.sanitizeReasonText('غير متاح'), '');
  assert.equal(core.sanitizeReasonText('N/A'), '');
  assert.equal(core.sanitizeReasonText('-'), '');
  assert.equal(core.sanitizeReasonText('لا يوجد'), '');
  assert.equal(core.sanitizeReasonText('انتهاء صلاحية العرض'), 'انتهاء صلاحية العرض');

  // Nested reason object & statusHistory extraction
  const fromNestedRej = core.extractRejectionReason({
    rejection: { reasonAr: 'رفض المزود لعدم توفر السيارة' }
  });
  assert.equal(fromNestedRej, 'رفض المزود لعدم توفر السيارة');

  const fromHistoryCan = core.extractCancellationReason({
    statusHistory: [
      { status: 'confirmed', note: 'تم التأكيد' },
      { status: 'cancelled_by_customer', note: 'طلب العميل الإلغاء قبل الموعد' }
    ]
  });
  assert.equal(fromHistoryCan, 'طلب العميل الإلغاء قبل الموعد');

  // Per-booking isolation in mergeSyncedReservation: booking B must never inherit booking A reason,
  // and updating one booking without a reason preserves its own existing genuine reason unless booking changed
  const mergedWithNewReason = core.mergeSyncedReservation(
    {
      id: 'RES_A',
      reservationNumber: '101',
      rejectionReason: 'غير متاح',
      internalStatus: 'مرفوض'
    },
    {
      id: '101',
      reservationNumber: '101',
      status: 'rejected_by_provider',
      cancelReason: 'عدم توفر الفئة بالفرع'
    },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(mergedWithNewReason.rejectionReason, 'عدم توفر الفئة بالفرع');
  assert.equal(core.classifyReservationLifecycle(mergedWithNewReason), 'rejected');

  // Authoritative external active status overrides stale internal_status / stale cancelledAt
  const reconciledActive = core.mergeSyncedReservation(
    {
      id: 'RES_RECON_1',
      reservationNumber: '202',
      internalStatus: 'تم الإلغاء',
      originalStatusCode: 'cancelled',
      cancelledAt: '2026-11-20T10:00:00Z'
    },
    {
      id: '202',
      reservationNumber: '202',
      status: 'confirmed'
    },
    [],
    { id: 'SYNC', name: 'Sync' }
  );
  assert.equal(core.classifyReservationLifecycle(reconciledActive), 'active');
  assert.equal(reconciledActive.internalStatus, 'مؤكد');
  assert.equal(reconciledActive.cancelledAt, '');

  // UI files must never show blanket 'غير متاح' for missing reasons or reuse lastUpdateText as a reason
  const reservationsJs = readRepoFile('assets/js/reservations.js');
  const inactiveJs = readRepoFile('assets/js/inactive.js');
  assert.equal(reservationsJs.includes("var naText = isEn ? 'N/A' : 'غير متاح';"), false);
  assert.equal(reservationsJs.includes("|| 'غير متاح'"), false);
  assert.ok(reservationsJs.includes('لم يُسجّل سبب في المصدر لهذا الحجز'));
  assert.equal(inactiveJs.includes('r.rejectionReason || r.lastUpdateText'), false);
  assert.equal(inactiveJs.includes('b.rejectionReason || b.lastUpdateText'), false);
  assert.equal(inactiveJs.includes('r.cancellationReason || r.lastUpdateText'), false);
  assert.equal(inactiveJs.includes('b.cancellationReason || b.lastUpdateText'), false);
  assert.ok(inactiveJs.includes('لم يُسجّل سبب في المصدر لهذا الحجز'));
});



