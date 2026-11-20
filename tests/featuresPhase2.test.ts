import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

function createSandboxApiHarness() {
  const storage = new Map<string, string>();
  const mockLocalStorage = {
    getItem(k: string) {
      return storage.has(k) ? storage.get(k)! : null;
    },
    setItem(k: string, v: string) {
      storage.set(k, String(v));
    },
    removeItem(k: string) {
      storage.delete(k);
    }
  };

  const sandboxWindow: Record<string, any> = {
    location: { search: '?sandbox=1', pathname: '/', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/?sandbox=1' },
    history: { replaceState() {} },
    localStorage: mockLocalStorage,
    RG_APP_CONFIG: { mode: 'sandbox', gasWebAppUrl: '', backendApiUrl: '' },
    RGCrmCore: core,
    dispatchEvent() {}
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;

  const context = vm.createContext({
    window: sandboxWindow,
    self: sandboxWindow,
    globalThis: sandboxWindow,
    localStorage: mockLocalStorage,
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

  const apiCode = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');
  vm.runInContext(apiCode, context);
  return { api: sandboxWindow.RGApi, storage };
}

test('Feature 1: formatBookingSummaryText produces complete bilingual booking summary', () => {
  const sample = {
    reservationNumber: 'RG-9910',
    customerName: 'فهد القحطاني',
    customerPhone: '+966501234567',
    carName: 'هيونداي سوناتا 2025',
    plateNumber: 'أ ب ج 1234',
    companyName: 'بدجت السعودية',
    branchName: 'مطار الملك خالد',
    startDate: '2026-11-19',
    extendedUntilDate: '2026-11-24',
    totalAmount: 1450,
    internalStatus: 'تم الحجز'
  };

  const ar = core.formatBookingSummaryText(sample, 'ar');
  assert.match(ar, /RG-9910/);
  assert.match(ar, /فهد القحطاني/);
  assert.match(ar, /\+966501234567/);
  assert.match(ar, /هيونداي سوناتا 2025/);
  assert.match(ar, /أ ب ج 1234/);
  assert.match(ar, /بدجت السعودية — مطار الملك خالد/);
  assert.match(ar, /1450 ر\.س/);

  const en = core.formatBookingSummaryText(sample, 'en');
  assert.match(en, /Booking #: RG-9910/);
  assert.match(en, /Plate: أ ب ج 1234/);
  assert.match(en, /Total: 1450 SAR/);
});

test('Feature 4: formatDirectCallTelHref strips +966/00966/966 and prepends prefix 90', () => {
  assert.equal(core.formatDirectCallTelHref('+966501234567', '90'), 'tel:900501234567');
  assert.equal(core.formatDirectCallTelHref('00966 55 987 6543', '90'), 'tel:900559876543');
  assert.equal(core.formatDirectCallTelHref('966541112233', '90'), 'tel:900541112233');
  assert.equal(core.formatDirectCallTelHref('0501234567', '90'), 'tel:900501234567');
  assert.equal(core.formatDirectCallTelHref('٠٥٠١٢٣٤٥٦٧', '90'), 'tel:900501234567');
  assert.equal(core.formatDirectCallDisplayNumber('+966501234567', '90'), '900501234567');
  assert.equal(core.formatDirectCallTelHref('', '90'), '');
});

test('Feature 7: computeSharedAssignmentInfo distinguishes exclusive, shared, and unassigned states', () => {
  const ex = core.computeSharedAssignmentInfo(['EMP_AG1'], ['سارة الحربي'], 'EMP_AG1', 'ar');
  assert.equal(ex.status, 'exclusive');
  assert.equal(ex.badgeAr, 'حصري لك');

  const sh1 = core.computeSharedAssignmentInfo(['EMP_AG1', 'EMP_AG2'], ['سارة الحربي', 'خالد الدوسري'], 'EMP_AG1', 'ar');
  assert.equal(sh1.status, 'shared');
  assert.equal(sh1.colleagueCount, 1);
  assert.equal(sh1.badgeAr, 'مشترك مع خالد الدوسري');

  const sh2 = core.computeSharedAssignmentInfo(['EMP_AG1', 'EMP_AG2', 'EMP_SUP1'], ['سارة', 'خالد', 'نورة'], 'EMP_AG1', 'en');
  assert.equal(sh2.status, 'shared');
  assert.equal(sh2.badgeEn, 'Shared with 2 colleagues');

  const un = core.computeSharedAssignmentInfo([], [], 'EMP_AG1', 'ar');
  assert.equal(un.status, 'unassigned');
});

test('Feature 9: computeProblemsPer100Bookings accurately computes overall, company, and branch rates & severities', () => {
  const reservations = [
    { id: 'R1', reservationNumber: 'B1', companyName: 'شركة ألف', branchName: 'فرع الرياض' },
    { id: 'R2', reservationNumber: 'B2', companyName: 'شركة ألف', branchName: 'فرع الرياض' },
    { id: 'R3', reservationNumber: 'B3', companyName: 'شركة ألف', branchName: 'فرع جدة' },
    { id: 'R4', reservationNumber: 'B4', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R5', reservationNumber: 'B5', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R6', reservationNumber: 'B6', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R7', reservationNumber: 'B7', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R8', reservationNumber: 'B8', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R9', reservationNumber: 'B9', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R10', reservationNumber: 'B10', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R11', reservationNumber: 'B11', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R12', reservationNumber: 'B12', companyName: 'شركة باء', branchName: 'فرع الدمام' },
    { id: 'R13', reservationNumber: 'B13', companyName: 'شركة باء', branchName: 'فرع الدمام' }
  ];
  const problems = [
    { id: 'P1', reservationId: 'R1', status: 'جديدة' }, // شركة ألف / الرياض -> 1/2 = 50/100 (danger)
    { id: 'P2', reservationId: 'R4', status: 'تم الحل' } // شركة باء / الدمام -> 1/10 = 10/100 (warning)
  ];

  const report = core.computeProblemsPer100Bookings(reservations, problems);
  assert.equal(report.overall.totalBookings, 13);
  assert.equal(report.overall.problemsCount, 2);
  assert.equal(report.overall.openProblemsCount, 1);
  assert.equal(report.overall.resolvedProblemsCount, 1);
  assert.equal(report.byCompany[0].companyName, 'شركة ألف');
  assert.equal(report.byCompany[0].ratePer100, 33.3);
  assert.equal(report.byCompany[0].severity, 'danger');
  assert.equal(report.byCompany[1].companyName, 'شركة باء');
  assert.equal(report.byCompany[1].ratePer100, 10);
  assert.equal(report.byCompany[1].severity, 'warning');
  assert.equal(report.byBranch[0].branchName, 'فرع الرياض');
  assert.equal(report.byBranch[0].ratePer100, 50);

  // Toggle visibility state normalization & bilingual labels
  assert.equal(core.normalizeProblemRateVisibility(null), true);
  assert.equal(core.normalizeProblemRateVisibility(undefined), true);
  assert.equal(core.normalizeProblemRateVisibility('true'), true);
  assert.equal(core.normalizeProblemRateVisibility('false'), false);
  assert.equal(core.normalizeProblemRateVisibility(false), false);
  assert.equal(core.normalizeProblemRateVisibility('0'), false);
  assert.equal(core.normalizeProblemRateVisibility('hidden'), false);
  assert.match(core.formatProblemRateToggleLabel(true, 'ar'), /إخفاء/);
  assert.match(core.formatProblemRateToggleLabel(false, 'ar'), /إظهار/);
  assert.match(core.formatProblemRateToggleLabel(true, 'en'), /Hide/);
  assert.match(core.formatProblemRateToggleLabel(false, 'en'), /Show/);

  const problemsJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/problems.js'), 'utf8');
  assert.match(problemsJs, /id="prb-toggle-rates-btn"/);
  assert.match(problemsJs, /id="prb-hide-rates-inline-btn"/);
  assert.match(problemsJs, /PROBLEM_RATE_VISIBILITY_STORAGE_KEY/);
});

test('Sandbox E2E: Features 2, 3, 5, 6, 8, and 10 enforce RBAC, caps, notifications, and settings propagation', async () => {
  const { api } = createSandboxApiHarness();

  // 1. Log in as supervisor first
  const supLogin = await api.callApi('login', { username: 'supervisor', password: 'Super@123' });
  assert.equal(supLogin.success, true);
  assert.equal(supLogin.data.user.role, 'supervisor');
  api.setToken(supLogin.data.token);

  const listRes = await api.callApi('getReservations', { page: 1, pageSize: 20 });
  assert.equal(listRes.success, true);
  const resIds: string[] = listRes.data.items.map((r: any) => r.id);
  assert.ok(resIds.length >= 4);
  const targetResId = resIds[0];

  // Feature 2: Supervisor CAN save pinned note
  const pinSave = await api.callApi('saveReservationPinnedNote', {
    reservationId: targetResId,
    note: 'تنبيه مشرف: يجب تسليم السيارة بمطار الرياض مع تأمين شامل'
  });
  assert.equal(pinSave.success, true);
  assert.match(pinSave.data.reservation.pinnedNote, /تنبيه مشرف/);

  const detAfterPin = await api.callApi('getReservationDetails', { reservationId: targetResId });
  assert.equal(detAfterPin.success, true);
  assert.match(detAfterPin.data.reservation.pinnedNote, /تنبيه مشرف/);

  // Feature 10: manage_settings is general_manager-only; supervisor gets FORBIDDEN, admin updates preset -> 'small'
  const supUpdAttempt = await api.callApi('updateSettings', { ui_simplification: { preset: 'small' } });
  assert.equal(supUpdAttempt.success, false);
  assert.equal(supUpdAttempt.error, 'FORBIDDEN');

  const adminLogin = await api.callApi('login', { username: 'admin', password: 'Admin@123', includeBootstrap: false });
  assert.equal(adminLogin.success, true);
  api.setToken(adminLogin.data.token);

  const updSettings = await api.callApi('updateSettings', {
    ui_simplification: { preset: 'small' }
  });
  assert.equal(updSettings.success, true);
  assert.equal(updSettings.data.ui_simplification.preset, 'small');
  assert.equal(updSettings.data.ui_simplification.hideSecondaryCarMeta, true);
  assert.equal(updSettings.data.ui_simplification.hideDrawerCharts, true);

  // Restore supervisor token for adding @mention follow-up
  api.setToken(supLogin.data.token);

  // Add a follow-up mentioning agent1 so agent1 receives it in @mention tab (Feature 3)
  const fuMention = await api.callApi('addFollowUp', {
    reservationId: targetResId,
    status: 'معلق',
    action: 'توجيه لمتابعة العميل @agent1',
    notes: 'الرجاء الاتصال بالعميل فوراً'
  });
  assert.equal(fuMention.success, true);

  // 2. Log in as agent1
  const agLogin = await api.callApi('login', { username: 'agent1', password: 'Agent@123', includeBootstrap: true });
  assert.equal(agLogin.success, true);
  assert.equal(agLogin.data.user.role, 'agent');
  api.setToken(agLogin.data.token);

  // Feature 10 propagation: agent bootstrap receives uiSimplification = small
  const boot = await api.callApi('getAppBootstrap', { range: '30d' });
  assert.equal(boot.success, true);
  assert.equal(boot.data.uiSimplification.preset, 'small');
  assert.equal(boot.data.uiSimplification.hideFinancialBreakdown, true);

  // Feature 2 RBAC: Agent MUST NOT be able to edit/save pinned note
  const agentPinAttempt = await api.callApi('saveReservationPinnedNote', {
    reservationId: targetResId,
    note: 'محاولة تعديل من موظف'
  });
  assert.equal(agentPinAttempt.success, false);
  assert.equal(agentPinAttempt.error, 'FORBIDDEN');

  // Feature 3: getMyFollowUps returns mentionFollowUps targeted at agent1
  const myFu = await api.callApi('getMyFollowUps', {});
  assert.equal(myFu.success, true);
  assert.ok(Array.isArray(myFu.data.mentionFollowUps));
  assert.ok(myFu.data.mentionFollowUps.some((f: any) => f.reservationId === targetResId && String(f.action).includes('@agent1')));

  // Feature 5: recordNoAnswerFollowUp increments counter atomically and updates lastUpdateText
  const na1 = await api.callApi('recordNoAnswerFollowUp', { reservationId: targetResId });
  assert.equal(na1.success, true);
  assert.equal(na1.data.noAnswerCount, 1);
  assert.match(na1.data.followUp.action, /لم يرد.*#1/);

  const na2 = await api.callApi('recordNoAnswerFollowUp', { reservationId: targetResId });
  assert.equal(na2.success, true);
  assert.equal(na2.data.noAnswerCount, 2);
  assert.match(na2.data.followUp.action, /لم يرد.*#2/);

  // Feature 6: togglePinnedCriticalReservation enforces strict cap of 3
  for (let i = 0; i < 3; i++) {
    const pRes = await api.callApi('togglePinnedCriticalReservation', { reservationId: resIds[i], pin: true });
    assert.equal(pRes.success, true);
    assert.equal(pRes.data.pinnedCriticalIds.length, i + 1);
  }
  const p4 = await api.callApi('togglePinnedCriticalReservation', { reservationId: resIds[3], pin: true });
  assert.equal(p4.success, false);
  assert.equal(p4.error, 'VALIDATION_ERROR');
  assert.match(String(p4.message || ''), /3/);

  // Unpinning one allows pinning the 4th
  const unpin0 = await api.callApi('togglePinnedCriticalReservation', { reservationId: resIds[0], pin: false });
  assert.equal(unpin0.success, true);
  assert.equal(unpin0.data.pinnedCriticalIds.length, 2);
  const p4Retry = await api.callApi('togglePinnedCriticalReservation', { reservationId: resIds[3], pin: true });
  assert.equal(p4Retry.success, true);
  assert.equal(p4Retry.data.pinnedCriticalIds.length, 3);

  // Feature 8: When Supervisor resolves problem ('تم الحل'), reservation's assigned employees (agent1) receive notification
  await api.callApi('claimReservation', { reservationId: targetResId });
  const supLogin2 = await api.callApi('login', { username: 'supervisor', password: 'Super@123' });
  api.setToken(supLogin2.data.token);

  const createdPrb = await api.callApi('createProblem', {
    reservationId: targetResId,
    description: 'مشكلة اختبار تنبيه الحل',
    priority: 'مرتفع'
  });
  assert.equal(createdPrb.success, true);
  const prbId = createdPrb.data.id;

  const resolvedPrb = await api.callApi('updateProblem', {
    problemId: prbId,
    status: 'تم الحل',
    priority: 'مرتفع',
    note: 'تم معالجة المشكلة بالكامل'
  });
  assert.equal(resolvedPrb.success, true);

  // Switch back to agent1 and check notifications for type === 'problem_resolved'
  api.setToken(agLogin.data.token);
  const notifs = await api.callApi('getNotifications', {});
  assert.equal(notifs.success, true);
  assert.ok(
    notifs.data.items.some((n: any) => n.type === 'problem_resolved' && n.entityId === prbId),
    'Assigned employee on reservation should receive problem_resolved notification'
  );
});

test('UI Simplification exposes all site sections, features, and CSS toggles cleanly', async () => {
  assert.ok(Array.isArray(core.UI_SIMPLIFICATION_GROUPS) && core.UI_SIMPLIFICATION_GROUPS.length >= 5);
  assert.ok(Array.isArray(core.UI_SIMPLIFICATION_OPTIONS) && core.UI_SIMPLIFICATION_OPTIONS.length >= 45);

  const groupIds = new Set(core.UI_SIMPLIFICATION_GROUPS.map((g: any) => g.id));
  const seenKeys = new Set<string>();
  const seenClasses = new Set<string>();
  const dashCss = fs.readFileSync(path.resolve(process.cwd(), 'assets/css/dashboard.css'), 'utf8');

  for (const opt of core.UI_SIMPLIFICATION_OPTIONS) {
    assert.ok(groupIds.has(opt.group), `Option ${opt.key} must belong to a valid group`);
    assert.ok(!seenKeys.has(opt.key), `Duplicate option key: ${opt.key}`);
    assert.ok(!seenClasses.has(opt.cssClass), `Duplicate CSS class: ${opt.cssClass}`);
    seenKeys.add(opt.key);
    seenClasses.add(opt.cssClass);
    assert.ok(dashCss.includes(`html.${opt.cssClass}`), `Missing CSS visibility rule for html.${opt.cssClass}`);
  }

  // Verify custom selection toggles arbitrary section/feature flags and persists through Sandbox settings + bootstrap
  const customPayload: Record<string, any> = {
    preset: 'custom',
    hideNavReports: true,
    hideDashHeroKpis: true,
    hideResTodayTab: true,
    hideDrawerPinnedNote: true,
    hideMyfuMentionsTab: true,
    hideProblemsRateIndicator: true,
    hideRolePresetsSection: true
  };
  const normCustom = core.normalizeUiSimplificationSettings(customPayload);
  assert.equal(normCustom.preset, 'custom');
  assert.equal(normCustom.hideNavReports, true);
  assert.equal(normCustom.hideDashHeroKpis, true);
  assert.equal(normCustom.hideResTodayTab, true);
  assert.equal(normCustom.hideDrawerPinnedNote, true);
  assert.equal(normCustom.hideMyfuMentionsTab, true);
  assert.equal(normCustom.hideProblemsRateIndicator, true);
  assert.equal(normCustom.hideRolePresetsSection, true);
  assert.equal(normCustom.hideNavProblems, false);

  const { api } = createSandboxApiHarness();
  const adminLogin = await api.callApi('login', { username: 'admin', password: 'Admin@123' });
  assert.equal(adminLogin.success, true);
  api.setToken(adminLogin.data.token);

  const upd = await api.callApi('updateSettings', { ui_simplification: customPayload });
  assert.equal(upd.success, true);
  assert.equal(upd.data.ui_simplification.hideNavReports, true);
  assert.equal(upd.data.ui_simplification.hideMyfuMentionsTab, true);

  const boot = await api.callApi('getAppBootstrap', { range: '30d' });
  assert.equal(boot.success, true);
  assert.equal(boot.data.uiSimplification.preset, 'custom');
  assert.equal(boot.data.uiSimplification.hideProblemsRateIndicator, true);
  assert.equal(boot.data.uiSimplification.hideDrawerPinnedNote, true);
  assert.equal(boot.data.uiSimplification.hideRolePresetsSection, true);
});

test('Shared module mirrors remain byte-identical', () => {
  const pairs: Array<[string, string]> = [
    ['assets/js/core.js', 'backend/coreBridge.cjs'],
    ['assets/js/app.js', 'src/assets/js/app.js'],
    ['assets/js/employees.js', 'src/assets/js/employees.js']
  ];
  for (const [a, b] of pairs) {
    const contentA = fs.readFileSync(path.resolve(process.cwd(), a), 'utf8');
    const contentB = fs.readFileSync(path.resolve(process.cwd(), b), 'utf8');
    assert.equal(contentA, contentB, `${a} and ${b} must remain byte-identical`);
  }
});
