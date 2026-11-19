import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('translates reservation statuses and delivery types accurately', () => {
  assert.equal(core.translateOriginalStatus('confirmed'), 'مؤكد');
  assert.equal(core.translateOriginalStatus('delivered'), 'تم التسليم');
  assert.equal(core.translateOriginalStatus('cancelled'), 'ملغي');
  assert.equal(core.translateOriginalStatus('active'), 'ناشط');
  assert.equal(core.translateOriginalStatus('picked_up'), 'ناشط');
  assert.equal(core.translateOriginalStatus('received'), 'ناشط');
  assert.equal(core.translateOriginalStatus('on_rent'), 'ناشط');
  assert.equal(core.translateOriginalStatus('rented'), 'ناشط');
  assert.equal(core.translateOriginalStatus('started'), 'بدأ التنفيذ');
  assert.equal(core.translateDeliveryType('airport'), 'توصيل للمطار');
  assert.equal(core.translateDeliveryType('branch'), 'استلام من الفرع');
});

test('filters extensions to accepted and paid only and computes total amount', () => {
  assert.equal(core.isExtensionAcceptedAndPaid({ status: 'accepted', payment_status: 'paid' }), true);
  assert.equal(core.isExtensionAcceptedAndPaid({ status: 'pending', payment_status: 'paid' }), false);
  assert.equal(core.isExtensionAcceptedAndPaid({ status: 'accepted', payment_status: 'unpaid' }), false);

  const total = core.computeTotalAmount(1250.5, [
    { amount: 250 },
    { amount: 149.5 }
  ]);
  assert.equal(total, 1650);
});

test('mergeSyncedReservation preserves internal follow-up status, priority, and assigned employees', () => {
  const existing = {
    id: 'RES_101',
    reservationNumber: 'RG-9001',
    internalStatus: 'تم التسليم',
    priority: 'مرتفع',
    assignedEmployeeIds: ['EMP_1', 'EMP_2'],
    assignedEmployeeNames: ['سارة العتيبي', 'خالد الحربي'],
    lastUpdateText: 'تم تسليم السيارة للعميل في المطار',
    lastUpdatedById: 'EMP_1',
    lastUpdatedByName: 'سارة العتيبي',
    lastUpdatedAt: '2026-11-15T10:00:00.000Z',
    hasProblem: true,
    createdAt: '2026-11-14T09:00:00.000Z'
  };

  const merged = core.mergeSyncedReservation(
    existing,
    {
      reservation_number: 'RG-9001',
      customer_name: 'فهد القحطاني',
      status: 'active',
      total_price: 1500,
      pickup_type: 'airport'
    },
    [{ amount: 300 }],
    { id: 'EMP_ADMIN', name: 'المدير العام' }
  );

  assert.equal(merged.internalStatus, 'تم التسليم');
  assert.equal(merged.priority, 'مرتفع');
  assert.deepEqual(merged.assignedEmployeeIds, ['EMP_1', 'EMP_2']);
  assert.equal(merged.hasProblem, true);
  assert.equal(merged.hasExtensions, true);
  assert.equal(merged.extensionsAmount, 300);
  assert.equal(merged.totalAmount, 1800);
});

test('RBAC permission matrix enforces strict role boundaries', () => {
  assert.equal(core.canUserPerform('general_manager', 'manage_employees'), true);
  assert.equal(core.canUserPerform('general_manager', 'manage_settings'), true);
  assert.equal(core.canUserPerform('supervisor', 'assign_employees'), true);
  assert.equal(core.canUserPerform('supervisor', 'manage_employees'), false);
  assert.equal(core.canUserPerform('agent', 'add_followup'), true);
  assert.equal(core.canUserPerform('agent', 'assign_employees'), false);
  assert.equal(core.canUserPerform('agent', 'sync_data'), false);
});

test('filterReservations and computeDashboardMetrics handle unfollowed, problems, and KPIs', () => {
  const reservations = [
    {
      id: 'R1', reservationNumber: 'RG-1', customerName: 'أحمد', companyName: 'بدجت',
      branchName: 'الرياض', startDate: '2026-11-16', internalStatus: 'تم الحجز',
      priority: 'عادي', assignedEmployeeIds: ['E1'], hasProblem: false, createdAt: '2026-11-16T08:00:00Z'
    },
    {
      id: 'R2', reservationNumber: 'RG-2', customerName: 'منى', companyName: 'ذيب',
      branchName: 'جدة', startDate: '2026-11-15', internalStatus: 'تم الإنشاء',
      priority: 'مرتفع', assignedEmployeeIds: ['E2'], hasProblem: true, createdAt: '2026-11-15T08:00:00Z'
    }
  ];
  const followUps = [
    { id: 'F1', reservationId: 'R1', employeeName: 'سارة', followUpDate: '2026-11-16' }
  ];
  const problems = [
    { id: 'P1', priority: 'مرتفع', status: 'جديدة' },
    { id: 'P2', priority: 'عادي', status: 'مغلقة' }
  ];
  const employees = [
    { id: 'E1', name: 'سارة', status: 'active' },
    { id: 'E2', name: 'خالد', status: 'active' }
  ];

  const unfollowed = core.filterReservations(reservations, followUps, { unfollowedOnly: true });
  assert.equal(unfollowed.length, 1);
  assert.equal(unfollowed[0].id, 'R2');

  const dash = core.computeDashboardMetrics(reservations, followUps, problems, employees, {}, '2026-11-16');
  assert.equal(dash.kpis.totalReservations, 2);
  assert.equal(dash.kpis.todayReservations, 1);
  assert.equal(dash.kpis.openProblems, 1);
  assert.equal(dash.kpis.highProblems, 1);
  assert.equal(dash.kpis.todayFollowUps, 1);
});

test('multi-employee self-claim, unclaim, and supervisor edit RBAC work correctly', () => {
  const res = {
    id: 'R10',
    assignedEmployeeIds: ['EMP_1'],
    assignedEmployeeNames: ['خالد الحربي']
  };

  // Second agent can claim without overwriting the first employee
  const claimed = core.claimReservationRecord(res, { id: 'EMP_2', name: 'نورة القحطاني' });
  assert.equal(claimed.added, true);
  assert.deepEqual(claimed.assignedEmployeeIds, ['EMP_1', 'EMP_2']);
  assert.deepEqual(claimed.assignedEmployeeNames, ['خالد الحربي', 'نورة القحطاني']);

  // Duplicate claim is idempotent
  const duplicate = core.claimReservationRecord(claimed, { id: 'EMP_2', name: 'نورة القحطاني' });
  assert.equal(duplicate.added, false);
  assert.deepEqual(duplicate.assignedEmployeeIds, ['EMP_1', 'EMP_2']);

  // Unclaim removes only the requesting employee
  const unclaimed = core.unclaimReservationRecord(claimed, 'EMP_1');
  assert.equal(unclaimed.removed, true);
  assert.deepEqual(unclaimed.assignedEmployeeIds, ['EMP_2']);
  assert.deepEqual(unclaimed.assignedEmployeeNames, ['نورة القحطاني']);

  // RBAC checks
  assert.equal(core.canUserPerform('agent', 'claim_reservation'), true);
  assert.equal(core.canUserPerform('agent', 'unclaim_reservation'), true);
  assert.equal(core.canUserPerform('agent', 'quick_update_status'), true);
  assert.equal(core.canUserPerform('agent', 'edit_reservation_details'), false);
  assert.equal(core.canUserPerform('supervisor', 'edit_reservation_details'), true);
  assert.equal(core.canUserPerform('supervisor', 'edit_ticket_details'), true);
  assert.equal(core.canUserPerform('supervisor', 'edit_any_followup'), true);
});

test('custom employee permissions, job presets, and strict Manager/Supervisor API access', () => {
  const seniorPreset = core.JOB_ROLE_PRESETS.find((p: any) => p.id === 'agent_senior');
  assert.ok(seniorPreset);
  const customAgent = {
    role: 'agent',
    permissions: seniorPreset.permissions
  };
  assert.equal(core.canUserPerform(customAgent, 'view_employees'), true);
  assert.equal(core.canUserPerform(customAgent, 'edit_any_followup'), true);
  assert.equal(core.canUserPerform(customAgent, 'manage_employees'), false);

  // API access strictly limited to general_manager & supervisor
  assert.equal(core.canAccessApi('general_manager'), true);
  assert.equal(core.canAccessApi('supervisor'), true);
  assert.equal(core.canAccessApi('agent'), false);
  assert.equal(core.canUserPerform({ role: 'agent', permissions: ['sync_data', 'view_dashboard'] }, 'sync_data'), false);
  assert.equal(core.canUserPerform({ role: 'supervisor', permissions: ['sync_data', 'view_dashboard'] }, 'sync_data'), true);

  // Pull reservations on Reservations page allowed for employees by default & toggleable, without granting API access
  assert.equal(core.canUserPerform('agent', 'pull_reservations'), true);
  assert.equal(core.canUserPerform('supervisor', 'pull_reservations'), true);
  assert.equal(core.canUserPerform('general_manager', 'pull_reservations'), true);
  assert.equal(core.canUserPerform({ role: 'agent', permissions: ['view_dashboard'] }, 'pull_reservations'), false);
});

test('editable ready-made role presets and custom permission catalog CRUD work securely', () => {
  // 1) Add a new preset with agent role -> strips sync_data automatically
  const created = core.upsertRolePreset(core.JOB_ROLE_PRESETS, {
    label: 'وردية مسائية VIP',
    jobTitle: 'أخصائي VIP',
    role: 'agent',
    permissions: ['view_dashboard', 'pull_reservations', 'sync_data']
  });
  assert.equal(created.isNew, true);
  assert.equal(created.saved.label, 'وردية مسائية VIP');
  assert.equal(created.saved.permissions.includes('sync_data'), false);
  assert.equal(created.saved.permissions.includes('pull_reservations'), true);

  // 2) Rename & edit permissions of the preset
  const edited = core.upsertRolePreset(created.presets, {
    id: created.saved.id,
    label: 'فريق كبار العملاء المعدل',
    jobTitle: 'أخصائي كبار العملاء',
    role: 'supervisor',
    permissions: ['view_dashboard', 'sync_data', 'view_employees']
  });
  assert.equal(edited.isNew, false);
  assert.equal(edited.saved.label, 'فريق كبار العملاء المعدل');
  assert.equal(edited.saved.permissions.includes('sync_data'), true);

  // 3) Delete preset
  const afterDelete = core.removeRolePreset(edited.presets, created.saved.id);
  assert.equal(afterDelete.some((p: any) => p.id === created.saved.id), false);

  // 4) Custom permission catalog: add, rename built-in, and remove
  const addedPerm = core.upsertPermissionDefinition([], { label: 'اعتماد خصم خاص', group: 'الحجوزات' });
  assert.equal(addedPerm.catalog.some((c: any) => c.label === 'اعتماد خصم خاص' && c.isCustom), true);

  const renamedBuiltIn = core.upsertPermissionDefinition(addedPerm.customPermissions, {
    key: 'pull_reservations',
    label: 'جلب الحجوزات الفوري',
    group: 'الحجوزات'
  });
  const pulledItem = renamedBuiltIn.catalog.find((c: any) => c.key === 'pull_reservations');
  assert.equal(pulledItem.label, 'جلب الحجوزات الفوري');
  assert.equal(pulledItem.isRenamed, true);

  const removedCustom = core.removePermissionDefinition(renamedBuiltIn.customPermissions, addedPerm.saved.key);
  assert.equal(removedCustom.catalog.some((c: any) => c.key === addedPerm.saved.key), false);
});

test('resolveAssetUrl and resolveRouteFromLocation handle GitHub Pages /RENT-CRM/ subpath and fallback routes', () => {
  assert.equal(core.resolveAssetUrl('assets/images/logo.png', '/RENT-CRM/'), '/RENT-CRM/assets/images/logo.png');
  assert.equal(core.resolveAssetUrl('/assets/images/logo.png', '/RENT-CRM'), '/RENT-CRM/assets/images/logo.png');
  assert.equal(core.resolveAssetUrl('assets/images/logo.png', './'), './assets/images/logo.png');

  assert.equal(
    core.resolveRouteFromLocation('/RENT-CRM/', '#reservations', '', '/RENT-CRM/'),
    'reservations'
  );
  assert.equal(
    core.resolveRouteFromLocation('/RENT-CRM/team-followups', '', '', '/RENT-CRM/'),
    'team-followups'
  );
  assert.equal(
    core.resolveRouteFromLocation('/RENT-CRM/', '', '?route=employees', '/RENT-CRM/'),
    'employees'
  );
  assert.equal(
    core.resolveRouteFromLocation('/RENT-CRM/unknown-page', '', '', '/RENT-CRM/'),
    'dashboard'
  );
});

test('dedupeReservationsByNumber and dedupeExtensionsByNumber eliminate duplicate records by business key', () => {
  const resDeduped = core.dedupeReservationsByNumber([
    { reservation_number: 'RG-100', customer_name: 'أحمد', total_price: 500 },
    { reservation_number: 'RG-101', customer_name: 'سارة', total_price: 700 },
    { reservation_number: 'RG-100', customer_name: 'أحمد المحدث', total_price: 550 }
  ]);
  assert.equal(resDeduped.length, 2);
  assert.equal(resDeduped[0].customer_name, 'أحمد المحدث');
  assert.equal(resDeduped[1].reservation_number, 'RG-101');

  const extDeduped = core.dedupeExtensionsByNumber([
    { extension_number: 'EXT-1', amount: 100 },
    { extension_number: 'EXT-1', amount: 150 },
    { extension_number: 'EXT-2', amount: 200 }
  ]);
  assert.equal(extDeduped.length, 2);
  assert.equal(extDeduped[0].amount, 150);
  assert.equal(extDeduped[1].extension_number, 'EXT-2');
});

test('validateGasUrl, extractGasUrlFromSearch, buildGasFetchOptions, and parseGasResponseText handle GAS transport reliably', () => {
  assert.equal(core.validateGasUrl('').isSandbox, true);
  assert.equal(core.validateGasUrl('https://docs.google.com/spreadsheets/d/123/edit').valid, false);
  assert.equal(core.validateGasUrl('https://script.google.com/macros/s/abc/dev').valid, false);
  assert.equal(core.validateGasUrl('https://script.google.com/macros/s/AKfycb123/exec').valid, true);

  assert.equal(
    core.extractGasUrlFromSearch('?gasUrl=' + encodeURIComponent('https://script.google.com/macros/s/AKfycb123/exec')),
    'https://script.google.com/macros/s/AKfycb123/exec'
  );
  assert.equal(core.extractGasUrlFromSearch('?gasUrl=https://script.google.com/macros/s/AKfycb123/dev'), '');

  const fetchOpts = core.buildGasFetchOptions('login', '', { username: 'admin', password: 'Admin@123' });
  assert.equal(fetchOpts.method, 'POST');
  assert.equal(fetchOpts.redirect, 'follow');
  assert.equal(fetchOpts.credentials, 'omit');
  assert.equal(fetchOpts.headers['Content-Type'], 'text/plain;charset=utf-8');

  const htmlResp = core.parseGasResponseText('<!doctype html><html><body>Sign in</body></html>', 200);
  assert.equal(htmlResp.success, false);
  assert.equal(htmlResp.error, 'HTML_RESPONSE');

  const okResp = core.parseGasResponseText('{"success":true,"message":"ok","data":{"token":"SES_1"}}', 200);
  assert.equal(okResp.success, true);
  assert.equal(okResp.data.token, 'SES_1');
});

test('API cache policy, stable cache key generation, and mutation invalidation scopes', () => {
  const empPolicy = core.getApiCachePolicy('getEmployees');
  const resPolicy = core.getApiCachePolicy('getReservations');
  assert.equal(empPolicy.cacheable, true);
  assert.equal(empPolicy.ttlMs >= 300000, true);
  assert.equal(resPolicy.cacheable, true);
  assert.equal(resPolicy.ttlMs >= 60000, true);
  assert.equal(core.getApiCachePolicy('pullReservations').cacheable, false);
  assert.equal(core.getApiCachePolicy('login').cacheable, false);
  assert.equal(core.getApiCachePolicy('saveApiToken').cacheable, false);

  const key1 = core.buildApiCacheKey('https://script.google.com/macros/s/abc/exec', 'TOK_1', 'getReservations', {
    page: 1,
    search: 'RG',
    visibleCols: ['reservationNumber', 'customerName']
  });
  const key2 = core.buildApiCacheKey('https://script.google.com/macros/s/abc/exec', 'TOK_1', 'getReservations', {
    search: 'RG',
    page: 1,
    visibleCols: ['reservationNumber']
  });
  assert.equal(key1, key2);

  const keyOtherUser = core.buildApiCacheKey('https://script.google.com/macros/s/abc/exec', 'TOK_2', 'getReservations', {
    page: 1,
    search: 'RG'
  });
  assert.notEqual(key1, keyOtherUser);

  const pullScopes = core.getCacheInvalidationScopes('pullReservations');
  assert.equal(pullScopes.includes('reservations'), true);
  assert.equal(pullScopes.includes('dashboard'), true);
  assert.equal(core.getCacheInvalidationScopes('login').includes('*'), true);
  const saveTokenScopes = core.getCacheInvalidationScopes('saveApiToken');
  assert.equal(saveTokenScopes.includes('settings'), true);
  assert.equal(saveTokenScopes.includes('sync'), true);
});

test('supports real Rental Gate OpenAPI ReservationSummaryForFilterDto and ReservationExtendFilterResponseDTO shapes', () => {
  assert.equal(core.translateOriginalStatus('IN_PROGRESS'), 'قيد التنفيذ');
  assert.equal(core.translateOriginalStatus('STARTED'), 'بدأ التنفيذ');
  assert.equal(core.translateDeliveryType('MY_LOCATION'), 'توصيل لموقع العميل');

  assert.equal(core.isExtensionAcceptedAndPaid({
    extendId: 255,
    reservationStatus: 'PAID',
    paymentDate: '2026-11-15T10:00:00Z',
    rejectedByUserId: null
  }), true);
  assert.equal(core.isExtensionAcceptedAndPaid({
    extendId: 252,
    reservationStatus: 'ADMIN_APPROVED',
    paymentDate: null,
    rejectedByUserId: null
  }), true);
  assert.equal(core.isExtensionAcceptedAndPaid({
    extendId: 254,
    reservationStatus: 'CREATED',
    paymentDate: null
  }), false);
  assert.equal(core.isExtensionAcceptedAndPaid({
    extendId: 249,
    reservationStatus: 'DECLINED',
    rejectedByUserId: 65,
    rejectionReason: 'timeout'
  }), false);

  const synced = core.mergeSyncedReservation(
    null,
    {
      reservationId: 832,
      clientName: 'سعود الشمري',
      clientMobile: '0550001122',
      companyArName: 'يلو لتأجير السيارات',
      receiveBranchArName: 'مطار الملك خالد - الرياض',
      carNameAr: 'تويوتا كامري',
      startDate: '2026-11-14T10:00:00Z',
      endDate: '2026-11-16T10:00:00Z',
      reservationDays: 2,
      reservationStatus: 'STARTED',
      receiveType: 'AIRPORT',
      deliverType: 'BRANCH',
      total: 29.13,
      extended: true,
      extensionsTotal: 259.89
    },
    [{ total: 173.26 }, { total: 86.63 }],
    { id: 'EMP_1', name: 'النظام' }
  );

  assert.equal(synced.reservationNumber, '832');
  assert.equal(synced.customerName, 'سعود الشمري');
  assert.equal(synced.companyName, 'يلو لتأجير السيارات');
  assert.equal(synced.originalStatusAr, 'بدأ التنفيذ');
  assert.equal(synced.pickupTypeAr, 'توصيل للمطار');
  assert.equal(synced.baseAmount, 29.13);
  assert.equal(synced.extensionsAmount, 259.89);
  assert.equal(synced.totalAmount, 289.02);
  assert.equal(synced.internalStatus, 'بدأ التنفيذ');
  assert.equal(synced.statusHistory.length, 1);
  assert.equal(synced.statusHistory[0].newStatus, 'بدأ التنفيذ');
  assert.equal(synced.statusHistory[0].source, 'api_pull');
});

test('formatDisplayDate and formatDisplayDateTime normalize Google Sheets UTC midnight ISO strings without off-by-one shifts', () => {
  assert.equal(core.formatDisplayDate('2026-11-16T22:00:00.000Z'), '2026-11-17');
  assert.equal(core.formatDisplayDate('2026-11-17T22:00:00.000Z'), '2026-11-18');
  assert.equal(core.formatDisplayDate('2026-11-17T15:24:00'), '2026-11-17');
  assert.equal(core.formatDisplayDate('2026-11-17'), '2026-11-17');
  assert.equal(core.formatDisplayDateTime('2026-11-16T22:00:00.000Z'), '2026-11-17 01:00');
  assert.equal(core.formatDisplayDateTime('2026-11-17T15:24:00'), '2026-11-17 15:24');

  const bsPolicy = core.getApiCachePolicy('getAppBootstrap');
  assert.equal(bsPolicy.cacheable, true);
  assert.equal(bsPolicy.ttlMs >= 30000, true);
});

test('normalizeLoginUsername trims, converts Arabic-Indic digits, and lowercases', () => {
  assert.equal(core.normalizeLoginUsername('  Admin  '), 'admin');
  assert.equal(core.normalizeLoginUsername('Agent١٢'), 'agent12');
  assert.equal(core.normalizeLoginUsername('USER۰۹'), 'user09');
  assert.equal(core.normalizeLoginUsername(''), '');
});

test('getReportColumns and formatReportCellValue return localized Arabic labels and formatted values for all report types', () => {
  const empCols = core.getReportColumns('employee_performance');
  assert.ok(empCols.some((c: any) => c.key === 'employeeName' && c.label === 'اسم الموظف'));
  assert.ok(empCols.some((c: any) => c.key === 'role' && c.label === 'الدور الوظيفي'));

  const empRow = {
    employeeName: 'سارة العتيبي',
    jobTitle: 'مشرف جودة',
    role: 'supervisor',
    assignedReservations: 12,
    followUpsCount: 25,
    problemsCount: 2,
    lastActivity: '2026-11-16T22:00:00.000Z'
  };
  assert.equal(core.formatReportCellValue(empCols.find((c: any) => c.key === 'role'), empRow, 'ar'), 'المشرف');
  assert.equal(core.formatReportCellValue(empCols.find((c: any) => c.key === 'lastActivity'), empRow, 'ar'), '2026-11-17 01:00');

  const prbCols = core.getReportColumns('problems');
  assert.ok(prbCols.some((c: any) => c.key === 'problemNumber' && c.label === 'رقم المشكلة'));
  assert.equal(
    core.formatReportCellValue(
      prbCols.find((c: any) => c.key === 'assignedEmployeeNames'),
      { assignedEmployeeNames: ['سارة', 'خالد'] },
      'ar'
    ),
    'سارة، خالد'
  );

  const fuCols = core.getReportColumns('followups_log');
  assert.ok(fuCols.some((c: any) => c.key === 'action' && c.label === 'الإجراء المتخذ'));
  const extCols = core.getReportColumns('extensions');
  assert.ok(extCols.some((c: any) => c.key === 'extendDays' && c.label === 'أيام التمديد'));
});

test('computePdfColumnWidths and bidi helpers produce accurate column widths and LTR-isolated Arabic strings', () => {
  const cols = core.getReportColumns('all_reservations').slice(0, 6);
  const widths = core.computePdfColumnWidths(cols, 1000);
  assert.equal(widths.length, 6);
  const sum = widths.reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(sum - 1000) < 0.01);
  assert.ok(widths.every((w: number) => w >= 50));

  assert.equal(core.isPureLtrText('RG-2026-1001'), true);
  assert.equal(core.isPureLtrText('2026-11-17 14:30'), true);
  assert.equal(core.isPureLtrText('تم تأكيد الحجز RG-2026-1001'), false);

  const bidi = core.formatBidiPdfText('تأكيد حجز RG-2026-1001 للعميل');
  assert.ok(bidi.includes('\u2066RG-2026-1001\u2069'));
  const brandBidi = core.formatBidiPdfText('تقرير جميع الحجوزات — Rental Gate');
  assert.ok(brandBidi.includes('\u2066Rental Gate\u2069'));
  assert.equal(core.formatBidiPdfText('RG-2026-1001'), 'RG-2026-1001');
});

test('buildCompressedExcelSheets supports optional non-mandatory compression with 1 to 10 sheets max and zero data loss', () => {
  const sampleHeaders = [
    { key: 'id', label: 'الرقم' },
    { key: 'note', label: 'الملاحظة' }
  ];
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: `RG-${i + 1}`,
    note: `ملاحظة   رقم   ${i + 1}`
  }));

  // 1) Compression OFF: leaves single sheet untouched without preformatted packing
  const offResult = core.buildCompressedExcelSheets([{ name: 'الحجوزات', headers: sampleHeaders, rows }], {
    compressEnabled: false,
    targetSheets: 3
  });
  assert.equal(offResult.length, 1);
  assert.equal(offResult[0].preformattedAoa, null);
  assert.equal(offResult[0].rows.length, 23);

  // 2) Compression ON with targetSheets = 3: splits 23 rows cleanly across 3 sheets without losing any row
  const split3 = core.buildCompressedExcelSheets([{ name: 'الحجوزات', headers: sampleHeaders, rows }], {
    compressEnabled: true,
    targetSheets: 3
  });
  assert.equal(split3.length, 3);
  const totalSplitRows = split3.reduce((acc: number, s: any) => acc + s.rows.length, 0);
  assert.equal(totalSplitRows, 23);
  assert.equal(split3[0].preformattedAoa[1][1], 'ملاحظة رقم 1');

  // 3) Compression ON with targetSheets > 10 clamps strictly to max 10 sheets
  const clampedMax = core.buildCompressedExcelSheets([{ name: 'الحجوزات', headers: sampleHeaders, rows }], {
    compressEnabled: true,
    targetSheets: 25
  });
  assert.equal(clampedMax.length, 10);
  assert.equal(clampedMax.reduce((acc: number, s: any) => acc + s.rows.length, 0), 23);

  // 4) Compression ON with targetSheets < 1 clamps strictly to 1 sheet
  const clampedMin = core.buildCompressedExcelSheets([{ name: 'الحجوزات', headers: sampleHeaders, rows }], {
    compressEnabled: true,
    targetSheets: 0
  });
  assert.equal(clampedMin.length, 1);
  assert.equal(clampedMin[0].rows.length, 23);

  // 5) Multi-sheet packing (4 sheets compressed down into 2 sheets max)
  const multi = [
    { name: 'ملخص', headers: sampleHeaders, rows: rows.slice(0, 2) },
    { name: 'تقرير', headers: sampleHeaders, rows: rows.slice(2, 5) },
    { name: 'متابعات', headers: sampleHeaders, rows: rows.slice(5, 8) },
    { name: 'مشكلات', headers: sampleHeaders, rows: rows.slice(8, 10) }
  ];
  const packed2 = core.buildCompressedExcelSheets(multi, { compressEnabled: true, targetSheets: 2 });
  assert.equal(packed2.length, 2);
  assert.equal(packed2[0].rows.length, 2);
  assert.equal(packed2[1].rows.length, 8);
  assert.ok(packed2[1].preformattedAoa.some((r: any) => String(r[0]).includes('--- تقرير ---')));
  assert.ok(packed2[1].preformattedAoa.some((r: any) => String(r[0]).includes('--- مشكلات ---')));
});

test('resolveGasConnection, buildAutoConnectShareUrl, and payload helpers enable zero-config automatic binding', () => {
  const globalUrl = 'https://script.google.com/macros/s/AKfycbGlobalDefault123/exec';
  const queryUrl = 'https://script.google.com/macros/s/AKfycbTeamLink456/exec';

  // 1) Visitor with empty localStorage automatically connects to globalUrl without touching login screen
  const autoRes = core.resolveGasConnection('', '', globalUrl);
  assert.equal(autoRes.url, globalUrl);
  assert.equal(autoRes.source, 'global_config');
  assert.equal(autoRes.persist, false);

  // 2) Shared ?gasUrl=... link takes priority and flags persistence to localStorage
  const qpRes = core.resolveGasConnection('?gasUrl=' + encodeURIComponent(queryUrl), '', globalUrl);
  assert.equal(qpRes.url, queryUrl);
  assert.equal(qpRes.source, 'query_param');
  assert.equal(qpRes.persist, true);

  // 3) Explicit ?sandbox=1 preview does not overwrite stored/global binding
  const sbParam = core.resolveGasConnection('?sandbox=1', queryUrl, globalUrl);
  assert.equal(sbParam.url, '');
  assert.equal(sbParam.source, 'sandbox_param');

  // 4) Local sandbox sentinel overrides global default until cleared via ?gasUrl=default
  const localSb = core.resolveGasConnection('', '__SANDBOX__', globalUrl);
  assert.equal(localSb.url, '');
  assert.equal(localSb.source, 'local_sandbox');
  assert.equal(localSb.defaultUrl, globalUrl);

  const resetDef = core.resolveGasConnection('?gasUrl=default', '__SANDBOX__', globalUrl);
  assert.equal(resetDef.url, globalUrl);
  assert.equal(resetDef.clearStored, true);
  assert.equal(resetDef.source, 'global_config');

  // 5) Share URL generator & compact payload / timeout selection
  const shareUrl = core.buildAutoConnectShareUrl('https://team.github.io', '/RENT-CRM/', globalUrl);
  assert.equal(shareUrl, 'https://team.github.io/RENT-CRM/?gasUrl=' + encodeURIComponent(globalUrl));
  assert.equal(core.buildAutoConnectShareUrl('https://team.github.io', '/', 'https://script.google.com/macros/s/abc/dev'), '');

  const compacted = core.compactGasPayload({ search: 'RG', visibleCols: ['a', 'b'], unused: undefined, page: 1 });
  assert.deepEqual(compacted, { search: 'RG', page: 1 });
  assert.equal(core.getGasActionTimeoutMs('pullReservations') >= 90000, true);
  assert.equal(core.getGasActionTimeoutMs('getDashboard') <= 40000, true);
});

test('mutation deduplication lock keys, notification target routing, and optimistic problem updates work reliably', () => {
  assert.equal(core.buildMutationLockKey('claimReservation', { reservationId: 'RES_1' }), 'claimReservation:RES_1');
  assert.equal(core.buildMutationLockKey('claimReservation', { reservationId: 'RES_1' }), 'claimReservation:RES_1');
  assert.notEqual(core.buildMutationLockKey('claimReservation', { reservationId: 'RES_1' }), 'claimReservation:RES_2');
  assert.equal(core.buildMutationLockKey('updateProblem', { problemId: 'PRB_201' }), 'updateProblem:PRB_201');
  assert.equal(core.buildMutationLockKey('markNotificationRead', { markAll: true }), 'markNotificationRead:ALL');
  assert.equal(core.buildMutationLockKey('markNotificationRead', { notificationId: 'NTF_1' }), 'markNotificationRead:NTF_1');

  assert.deepEqual(
    core.resolveNotificationTarget({ entityType: 'Problem', entityId: 'PRB_201', type: 'high_priority_problem' }),
    { kind: 'problem', entityId: 'PRB_201', route: 'problems' }
  );
  assert.deepEqual(
    core.resolveNotificationTarget({ entityType: '', entityId: 'PRB_5', type: 'new_problem' }),
    { kind: 'problem', entityId: 'PRB_5', route: 'problems' }
  );
  assert.deepEqual(
    core.resolveNotificationTarget({ entityType: 'Reservation', entityId: 'RES_1001', type: 'new_assignment' }),
    { kind: 'reservation', entityId: 'RES_1001', route: 'reservations' }
  );

  assert.equal(core.isProblemClosedStatus('مغلقة'), true);
  assert.equal(core.isProblemClosedStatus('تم الحل'), true);
  assert.equal(core.isProblemClosedStatus('قيد المعالجة'), false);

  const original = {
    id: 'PRB_201',
    problemNumber: 'PRB-884301',
    reservationNumber: 'RG-2026-8843',
    customerName: 'ماجد',
    description: 'السيارة غير متوفرة',
    priority: 'مرتفع',
    status: 'جديدة',
    assignedEmployeeIds: ['EMP_1'],
    assignedEmployeeNames: ['سارة'],
    updates: []
  };
  const patched = core.applyOptimisticProblemPatch(
    original,
    { status: 'مغلقة' },
    { id: 'EMP_ADMIN', name: 'فهد' }
  );
  assert.equal(patched.status, 'مغلقة');
  assert.equal(patched.updates.length, 1);
  assert.equal(patched.updates[0].newStatus, 'مغلقة');
  assert.equal(patched.updates[0].note, 'تم إغلاق المشكلة');
  assert.equal(core.getApiCachePolicy('getProblemDetails').cacheable, true);
});

test('computeDataFingerprint, shouldAutoRefreshNow, silentRefresh cache keys, and keepalive work as expected', () => {
  const dashA = { kpis: { totalReservations: 10, openProblems: 2 }, charts: { statusDistribution: { 'تم الحجز': 4 } } };
  const dashB = { charts: { statusDistribution: { 'تم الحجز': 4 } }, kpis: { openProblems: 2, totalReservations: 10 } };
  const dashChanged = { kpis: { totalReservations: 11, openProblems: 2 }, charts: { statusDistribution: { 'تم الحجز': 4 } } };

  assert.equal(core.computeDataFingerprint(dashA), core.computeDataFingerprint(dashB));
  assert.notEqual(core.computeDataFingerprint(dashA), core.computeDataFingerprint(dashChanged));

  const notifsA = { unreadCount: 1, items: [{ id: 'N1', isRead: false }] };
  const notifsRead = { unreadCount: 0, items: [{ id: 'N1', isRead: true }] };
  assert.notEqual(core.computeDataFingerprint(notifsA), core.computeDataFingerprint(notifsRead));

  assert.equal(core.shouldAutoRefreshNow({
    isModalOpen: false,
    isInputFocused: false,
    isOffline: false,
    isHidden: false,
    hasActiveLocks: false
  }), true);
  assert.equal(core.shouldAutoRefreshNow({ isModalOpen: true }), false);
  assert.equal(core.shouldAutoRefreshNow({ isInputFocused: true }), false);
  assert.equal(core.shouldAutoRefreshNow({ isOffline: true }), false);
  assert.equal(core.shouldAutoRefreshNow({ isHidden: true }), false);
  assert.equal(core.shouldAutoRefreshNow({ hasActiveLocks: true }), false);

  const keyNormal = core.buildApiCacheKey('https://script.google.com/macros/s/abc/exec', 'TOK_1', 'getDashboard', { range: '30d' });
  const keySilent = core.buildApiCacheKey('https://script.google.com/macros/s/abc/exec', 'TOK_1', 'getDashboard', { range: '30d', silentRefresh: true });
  assert.equal(keyNormal, keySilent);

  const smallFetch = core.buildGasFetchOptions('getDashboard', 'TOK_1', { range: '30d', silentRefresh: true });
  assert.equal(smallFetch.keepalive, true);
  assert.equal(smallFetch.body.includes('silentRefresh'), false);

  const bigFetch = core.buildGasFetchOptions('syncRentalGate', 'TOK_1', { big: 'x'.repeat(65000) });
  assert.equal(bigFetch.keepalive, undefined);
});

test('mergeSyncedReservation records status stages on re-pull and preserves history on employee updates', () => {
  const initial = core.mergeSyncedReservation(
    null,
    {
      reservationId: 901,
      reservationNumber: 'RG-2026-9001',
      clientName: 'عمر العتيبي',
      clientMobile: '0501112233',
      companyArName: 'ذيب',
      receiveBranchArName: 'مطار الرياض',
      carNameAr: 'سوناتا',
      startDate: '2026-11-17T08:00:00Z',
      endDate: '2026-11-19T08:00:00Z',
      reservationDays: 2,
      reservationStatus: 'PENDING',
      total: 400
    },
    [],
    { id: 'EMP_ADMIN', name: 'فهد' }
  );
  assert.equal(initial.internalStatus, 'قيد الانتظار');
  assert.equal(initial.statusHistory.length, 1);

  // Re-pull with identical source status -> should NOT duplicate api_pull stage
  const unchangedPull = core.mergeSyncedReservation(
    initial,
    {
      reservationId: 901,
      reservationNumber: 'RG-2026-9001',
      clientName: 'عمر العتيبي',
      clientMobile: '0501112233',
      reservationStatus: 'PENDING',
      total: 400
    },
    [],
    { id: 'EMP_ADMIN', name: 'فهد' }
  );
  assert.equal(unchangedPull.statusHistory.length, 1);
  assert.equal(unchangedPull.internalStatus, 'قيد الانتظار');

  // Re-pull with progressed source status CONFIRMED -> updates status & adds Stage 2
  const confirmedPull = core.mergeSyncedReservation(
    unchangedPull,
    {
      reservationId: 901,
      reservationNumber: 'RG-2026-9001',
      clientName: 'عمر العتيبي',
      clientMobile: '0501112233',
      reservationStatus: 'CONFIRMED',
      total: 400
    },
    [],
    { id: 'EMP_ADMIN', name: 'فهد' }
  );
  assert.equal(confirmedPull.internalStatus, 'مؤكد');
  assert.equal(confirmedPull.originalStatusCode, 'confirmed');
  assert.equal(confirmedPull.statusHistory.length, 2);
  assert.equal(confirmedPull.statusHistory[1].previousStatus, 'قيد الانتظار');
  assert.equal(confirmedPull.statusHistory[1].newStatus, 'مؤكد');
  assert.equal(confirmedPull.statusHistory[1].source, 'api_pull');

  // Re-pull with STARTED -> updates status & adds Stage 3
  const startedPull = core.mergeSyncedReservation(
    confirmedPull,
    {
      reservationId: 901,
      reservationNumber: 'RG-2026-9001',
      clientName: 'عمر العتيبي',
      clientMobile: '0501112233',
      reservationStatus: 'STARTED',
      total: 400
    },
    [],
    { id: 'EMP_ADMIN', name: 'فهد' }
  );
  assert.equal(startedPull.internalStatus, 'بدأ التنفيذ');
  assert.equal(startedPull.statusHistory.length, 3);
  assert.equal(startedPull.statusHistory[2].stageNumber, 3);
  assert.equal(startedPull.statusHistory[2].previousStatus, 'مؤكد');
  assert.equal(startedPull.statusHistory[2].newStatus, 'بدأ التنفيذ');

  assert.equal(core.isValidWorkflowStatus('مؤكد'), true);
  assert.equal(core.isValidWorkflowStatus('بدأ التنفيذ'), true);
  assert.equal(core.isValidWorkflowStatus('تم التسليم'), true);
  assert.equal(core.isValidWorkflowStatus('INVALID_STATUS'), false);
  assert.ok(core.getWorkflowStatusOptions('مؤكد').includes('بدأ التنفيذ'));
  assert.equal(core.formatStatusStageSourceLabel('api_pull'), 'سحب من Rental Gate');
});

test('resolvePullDateRange, filterSourceReservationsByPullRange, buildCustomersIndexFromReservations, and mergeReservationBatch work accurately', () => {
  const allRange = core.resolvePullDateRange({ preset: 'all' }, '2026-11-17');
  assert.equal(allRange.hasCustomRange, false);
  assert.equal(allRange.dateFrom, '');

  const sevenDays = core.resolvePullDateRange({ preset: '7d' }, '2026-11-17');
  assert.equal(sevenDays.hasCustomRange, true);
  assert.equal(sevenDays.dateFrom, '2026-11-11');
  assert.equal(sevenDays.dateTo, '2026-11-17');

  const customFromOnly = core.resolvePullDateRange({ preset: 'custom', dateFrom: '2026-11-15' }, '2026-11-17');
  assert.equal(customFromOnly.hasCustomRange, true);
  assert.equal(customFromOnly.dateFrom, '2026-11-15');
  assert.equal(customFromOnly.dateTo, '2026-11-17');

  const sampleApiItems = [
    { reservationId: 1, reservationDate: '2026-11-10T10:00:00' },
    { reservationId: 2, reservationDate: '2026-11-15T12:00:00' },
    { reservationId: 3, reservationDate: '2026-11-17T09:30:00' }
  ];
  const filtered = core.filterSourceReservationsByPullRange(sampleApiItems, customFromOnly);
  assert.deepEqual(filtered.map((x: any) => x.reservationId), [2, 3]);

  const customers = core.buildCustomersIndexFromReservations([
    { id: 'R1', reservationNumber: '101', customerName: 'أحمد علي', customerPhone: '0501112233', totalAmount: 500, startDate: '2026-11-10', companyName: 'ذيب', internalStatus: 'مؤكد' },
    { id: 'R2', reservationNumber: '102', customerName: 'أحمد علي', customerPhone: '0501112233', totalAmount: 300, startDate: '2026-11-16', companyName: 'بدجت', internalStatus: 'تم الحجز' },
    { id: 'R3', reservationNumber: '103', customerName: 'سارة محمد', customerPhone: '0559988776', totalAmount: 900, startDate: '2026-11-17', companyName: 'يلو', internalStatus: 'قيد الانتظار' }
  ]);
  assert.equal(customers.length, 2);
  const ahmed = customers.find((c: any) => c.customerPhone === '0501112233');
  assert.ok(ahmed);
  assert.equal(ahmed.totalBookings, 2);
  assert.equal(ahmed.totalSpent, 800);
  assert.equal(ahmed.latestReservationNumber, '102');

  const merged = core.mergeReservationBatch(
    [{ id: 'R1', reservationNumber: '101', internalStatus: 'قيد الانتظار' }],
    [{ id: 'R1', reservationNumber: '101', internalStatus: 'مؤكد' }, { id: 'R2', reservationNumber: '102', internalStatus: 'تم الحجز' }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r: any) => r.id === 'R1').internalStatus, 'مؤكد');
});

test('summarizeReservationExtensions and mergeSyncedReservation capture exact extension count, amounts, types, and extended-until dates', () => {
  assert.equal(core.translateExtensionType('CLIENT'), 'تمديد بواسطة العميل');
  assert.equal(core.translateExtensionType('AUTOMATIC'), 'تمديد تلقائي');
  assert.equal(core.extractTimeOnly('2026-11-17T14:30:00Z'), '17:30');
  assert.equal(core.extractTimeOnly('2026-11-17T14:30:00'), '14:30');

  const exts = [
    {
      extensionNumber: 'EXT-700-2',
      extensionType: 'AUTOMATIC',
      statusCode: 'automatically_extended',
      paymentStatus: 'paid_by_wallet',
      extendDays: 2,
      startDate: '2026-11-21T14:30:00',
      endDate: '2026-11-23T14:30:00',
      subTotal: 452.17,
      vatAmount: 67.83,
      amount: 520
    },
    {
      extensionNumber: 'EXT-700-1',
      extensionType: 'CLIENT',
      statusCode: 'accepted',
      paymentStatus: 'paid',
      extendDays: 1,
      startDate: '2026-11-20T14:30:00',
      endDate: '2026-11-21T14:30:00',
      subTotal: 243.48,
      vatAmount: 36.52,
      amount: 280
    }
  ];

  const summary = core.summarizeReservationExtensions(exts, { actualEndDate: '2026-11-23T14:30:00' }, '2026-11-20', '14:30');
  assert.equal(summary.extensionsCount, 2);
  assert.equal(summary.extendedDaysCount, 3);
  assert.equal(summary.extensionsAmount, 800);
  assert.equal(summary.extendedUntilDate, '2026-11-23');
  assert.equal(summary.extendedUntilTime, '14:30');
  assert.equal(summary.extensions[0].extensionNumber, 'EXT-700-1');
  assert.equal(summary.extensions[0].extensionTypeAr, 'تمديد بواسطة العميل');
  assert.equal(summary.extensions[1].extensionNumber, 'EXT-700-2');
  assert.equal(summary.extensions[1].extensionTypeAr, 'تمديد تلقائي');

  const merged = core.mergeSyncedReservation(
    null,
    {
      reservationId: 77701,
      reservationNumber: 'RG-2026-77701',
      reservationDate: '2026-11-16T09:15:00Z',
      clientName: 'خالد السالم',
      clientMobile: '0501234567',
      clientEmail: 'k@example.sa',
      companyArName: 'ذيب لتأجير السيارات',
      receiveBranchArName: 'مطار الرياض',
      deliverBranchArName: 'فرع العليا',
      carNameAr: 'هيونداي سوناتا 2026',
      carCategoryAr: 'سيدان متوسطة',
      plateNumber: 'أ ب ج 1234',
      startDate: '2026-11-17T14:30:00',
      endDate: '2026-11-20T14:30:00',
      actualEndDate: '2026-11-23T14:30:00',
      reservationDays: 3,
      reservationStatus: 'EXTENDED',
      paymentType: 'مدى',
      paymentStatus: 'paid',
      dailyPrice: 300,
      discount: 50,
      vat: 146.09,
      total: 1120
    },
    exts,
    { id: 'EMP_ADMIN', name: 'فهد' }
  );

  assert.equal(merged.sourceReservationId, '77701');
  assert.equal(merged.startDate, '2026-11-17');
  assert.equal(merged.startTime, '14:30');
  assert.equal(merged.originalEndDate, '2026-11-20');
  assert.equal(merged.originalEndTime, '14:30');
  assert.equal(merged.extendedUntilDate, '2026-11-23');
  assert.equal(merged.extendedUntilTime, '14:30');
  assert.equal(merged.endDate, '2026-11-23');
  assert.equal(merged.daysCount, 3);
  assert.equal(merged.extendedDaysCount, 3);
  assert.equal(merged.totalDaysCount, 6);
  assert.equal(merged.extensionsCount, 2);
  assert.equal(merged.extensionsAmount, 800);
  assert.equal(merged.baseAmount, 1120);
  assert.equal(merged.totalAmount, 1920);
  assert.equal(merged.hasExtensions, true);
  assert.equal(merged.deliverBranchName, 'فرع العليا');
  assert.equal(merged.carCategory, 'سيدان متوسطة');
});

test('parseBackendResponseText prevents Unexpected end of JSON input on empty, HTML, and malformed responses', () => {
  const empty500 = core.parseBackendResponseText('', 500, 'application/json');
  assert.equal(empty500.success, false);
  assert.equal(empty500.error, 'EMPTY_RESPONSE');
  assert.ok(empty500.message.includes('HTTP 500'));

  const empty504 = core.parseBackendResponseText('   ', 504, '');
  assert.equal(empty504.success, false);
  assert.equal(empty504.error, 'GATEWAY_ERROR');

  const empty404 = core.parseBackendResponseText('', 404, '');
  assert.equal(empty404.success, false);
  assert.equal(empty404.error, 'BACKEND_NOT_FOUND');

  const htmlResp = core.parseBackendResponseText('<!doctype html><html><body>Error</body></html>', 502, 'text/html');
  assert.equal(htmlResp.success, false);
  assert.equal(htmlResp.error, 'HTML_RESPONSE');

  const badJson = core.parseBackendResponseText('FUNCTION_INVOCATION_FAILED', 500, 'text/plain');
  assert.equal(badJson.success, false);
  assert.equal(badJson.error, 'INVALID_JSON');

  const validErr = core.parseBackendResponseText('{"success":false,"message":"DATABASE_UNCONFIGURED","data":null,"error":"DATABASE_UNCONFIGURED"}', 503, 'application/json');
  assert.equal(validErr.success, false);
  assert.equal(validErr.error, 'DATABASE_UNCONFIGURED');

  const validOk = core.parseBackendResponseText('{"success":true,"message":"OK","data":{"ok":true},"error":null}', 200, 'application/json');
  assert.equal(validOk.success, true);
  assert.equal(validOk.data.ok, true);
});

test('dedupe helpers retain Rental Gate DTOs keyed only by reservationId/extendId and deleteEmployee scopes/locks are registered', () => {
  const rgDtos = core.dedupeReservationsByNumber([
    { reservationId: 9101, clientName: 'محمد', reservationStatus: 'CONFIRMED', total: 450 },
    { reservationId: 9102, clientName: 'نورة', reservationStatus: 'STARTED', total: 650 },
    { reservation_id: 9101, clientName: 'محمد المحدث', reservationStatus: 'ACTIVE', total: 500 }
  ]);
  assert.equal(rgDtos.length, 2);
  assert.equal(rgDtos[0].clientName, 'محمد المحدث');
  assert.equal(rgDtos[1].reservationId, 9102);

  const extDtos = core.dedupeExtensionsByNumber([
    { extendId: 301, reservationId: 9101, total: 150 },
    { extend_id: 301, reservationId: 9101, total: 200 },
    { extendId: 302, reservationId: 9102, total: 300 }
  ]);
  assert.equal(extDtos.length, 2);
  assert.equal(extDtos[0].total, 200);
  assert.equal(extDtos[1].extendId, 302);

  const delScopes = core.getCacheInvalidationScopes('deleteEmployee');
  assert.equal(delScopes.includes('employees'), true);
  assert.equal(delScopes.includes('dashboard'), true);
  assert.equal(core.buildMutationLockKey('deleteEmployee', { employeeId: 'EMP_42' }), 'deleteEmployee:EMP_42');
});

