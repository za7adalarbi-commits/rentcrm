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

test('Phase 1: resolveEffectivePermissions 2-arg signature & canUserViewDashboardSection strict enforcement', () => {
  assert.equal(core.DASHBOARD_PERMISSION_KEYS.length, 10);

  // 2-arg signature with explicit array
  const customExplicit = ['view_dashboard', 'dash_perms_configured', 'dash_view_hero_kpis'];
  assert.deepEqual(core.resolveEffectivePermissions('agent', customExplicit), customExplicit);

  // 2-arg signature without optionalPerms falls back to role matrix
  const agentDefaults = core.resolveEffectivePermissions('agent');
  assert.ok(agentDefaults.includes('view_dashboard'));
  assert.ok(agentDefaults.includes('dash_view_radar'));

  // Configured empty dashboard permissions (marker present, zero dash_view_* keys) strictly hides all sections
  const strippedDashUser = {
    role: 'agent',
    permissions: ['view_dashboard', 'dash_perms_configured', 'add_followup']
  };
  for (const key of core.DASHBOARD_PERMISSION_KEYS) {
    assert.equal(
      core.canUserViewDashboardSection(strippedDashUser, key),
      false,
      `Expected ${key} to be hidden when dash_perms_configured is set without it`
    );
  }

  // Selective dashboard permissions show only granted sections
  const selectiveUser = {
    role: 'supervisor',
    permissions: ['view_dashboard', 'dash_perms_configured', 'dash_view_hero_kpis', 'dash_view_radar']
  };
  assert.equal(core.canUserViewDashboardSection(selectiveUser, 'dash_view_hero_kpis'), true);
  assert.equal(core.canUserViewDashboardSection(selectiveUser, 'dash_view_radar'), true);
  assert.equal(core.canUserViewDashboardSection(selectiveUser, 'dash_view_heatmap'), false);
  assert.equal(core.canUserViewDashboardSection(selectiveUser, 'dash_view_handover'), false);

  // Legacy user with view_dashboard and no dash_perms_configured / no dash_view_* stays backwards-compatible
  const legacyUser = {
    role: 'agent',
    permissions: ['view_dashboard', 'add_followup']
  };
  assert.equal(core.canUserViewDashboardSection(legacyUser, 'dash_view_hero_kpis'), true);
  assert.equal(core.canUserViewDashboardSection(legacyUser, 'dash_view_heatmap'), true);

  // Missing view_dashboard hides everything
  assert.equal(
    core.canUserViewDashboardSection({ role: 'agent', permissions: ['dash_view_hero_kpis'] }, 'dash_view_hero_kpis'),
    false
  );
});

test('Phase 2: Layout prefs normalization, Drag & Drop reordering, moveOrderItem, and protected routes', () => {
  const norm = core.normalizeUserLayoutPrefs({
    navOrder: ['reservations', 'dashboard', 'unknown-route', 'reservations'],
    hiddenRoutes: ['dashboard', 'settings', 'reports', 'reports', 'bad-route'],
    dashOrder: ['bottom_bento', 'hero_kpis', 'invalid_sec'],
    dashHidden: ['peak_heatmap', 'invalid_sec', 'peak_heatmap']
  });

  // All canonical routes preserved once, starting with requested valid order
  assert.equal(norm.navOrder.length, core.NAV_ROUTE_IDS.length);
  assert.equal(norm.navOrder[0], 'reservations');
  assert.equal(norm.navOrder[1], 'dashboard');
  assert.ok(!norm.navOrder.includes('unknown-route'));

  // Protected routes ('dashboard', 'settings') can NEVER be hidden
  assert.deepEqual(norm.hiddenRoutes, ['reports']);
  assert.ok(!norm.hiddenRoutes.includes('dashboard'));
  assert.ok(!norm.hiddenRoutes.includes('settings'));

  // Dashboard order & hidden normalized cleanly
  assert.equal(norm.dashOrder.length, core.DASHBOARD_SECTION_DEFS.length);
  assert.equal(norm.dashOrder[0], 'bottom_bento');
  assert.equal(norm.dashOrder[1], 'hero_kpis');
  assert.deepEqual(norm.dashHidden, ['peak_heatmap']);

  // Drag & Drop reordering + up/down directional move
  const reordered = core.reorderListByDragDrop(['a', 'b', 'c', 'd'], 'd', 'b');
  assert.deepEqual(reordered, ['a', 'd', 'b', 'c']);
  assert.deepEqual(core.reorderListByDragDrop(['a', 'b', 'c'], 'a', 'missing'), ['a', 'b', 'c']);

  assert.deepEqual(core.moveOrderItem(['a', 'b', 'c'], 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(core.moveOrderItem(['a', 'b', 'c'], 'a', 'up'), ['a', 'b', 'c']);
  assert.deepEqual(core.moveOrderItem(['a', 'b', 'c'], 'b', 'down'), ['a', 'c', 'b']);
  assert.deepEqual(core.moveOrderItem(['a', 'b', 'c'], 'c', 'down'), ['a', 'b', 'c']);
});

test('Phase 3: Scoped reservation deletion filtering & validation (all / month / year)', () => {
  const monthScope = core.normalizeDeleteReservationsScope({ scope: 'month', yearMonth: '2026-11' });
  assert.equal(monthScope.scope, 'month');
  assert.equal(monthScope.year, 2026);
  assert.equal(monthScope.month, 11);
  assert.equal(monthScope.ym, '2026-11');

  const yearScope = core.normalizeDeleteReservationsScope({ scope: 'year', year: '٢٠٢٥' });
  assert.equal(yearScope.scope, 'year');
  assert.equal(yearScope.year, 2025);

  const sampleList = [
    { id: '1', startDate: '2026-11-05' },
    { id: '2', startDate: '2026-10-12' },
    { id: '3', sourceCreatedAt: '2025-07-19T10:00:00Z' },
    { id: '4', createdAt: '2026-11-28T08:00:00Z' }
  ];

  assert.deepEqual(
    core.filterReservationsForDeleteScope(sampleList, monthScope).map((r: any) => r.id),
    ['1', '4']
  );
  assert.deepEqual(
    core.filterReservationsForDeleteScope(sampleList, yearScope).map((r: any) => r.id),
    ['3']
  );
  assert.equal(core.filterReservationsForDeleteScope(sampleList, { scope: 'all' }).length, 4);

  // Validation rejects incomplete month/year scopes
  const badMonth = core.validateDeleteAllReservationsConfirmation({
    scope: 'month',
    yearMonth: '',
    acknowledged: true,
    confirmPhrase: core.DELETE_ALL_RESERVATIONS_PHRASE,
    password: 'Admin@123'
  });
  assert.equal(badMonth.valid, false);

  const badYear = core.validateDeleteAllReservationsConfirmation({
    scope: 'year',
    year: '1990',
    acknowledged: true,
    confirmPhrase: core.DELETE_ALL_RESERVATIONS_PHRASE,
    password: 'Admin@123'
  });
  assert.equal(badYear.valid, false);

  const goodMonth = core.validateDeleteAllReservationsConfirmation({
    scope: 'month',
    yearMonth: '2026-11',
    acknowledged: true,
    confirmPhrase: core.DELETE_ALL_RESERVATIONS_PHRASE,
    password: 'Admin@123'
  });
  assert.equal(goodMonth.valid, true);
});

test('Phase 4: normalizeExcelCellDate & parseImportedReservationRows support Arabic/English headers, serial dates, and upsert stats', () => {
  // Excel serial date 46000 -> 2025-12-09 (since 25569 = 1970-01-01)
  assert.equal(core.normalizeExcelCellDate(46000), '2025-12-09');
  assert.equal(core.normalizeExcelCellDate('19/11/2026'), '2026-11-19');
  assert.equal(core.normalizeExcelCellDate('٢٠٢٦/١١/٢٠'), '2026-11-20');
  assert.equal(core.normalizeExcelCellDate(new Date('2026-08-15T12:00:00Z')), '2026-08-15');

  const existing = [
    {
      id: 'RES_EXIST_1',
      reservationNumber: 'RG-1001',
      customerName: 'عميل قديم',
      customerPhone: '+966500000001',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      internalStatus: 'تم الحجز',
      totalAmount: 500
    }
  ];

  const rawRows = [
    // Row 1: Arabic headers -> updates existing RG-1001
    {
      'رقم الحجز': 'RG-1001',
      'اسم العميل': 'خالد العتيبي',
      'الجوال': '٠٥٥١١١٢٢٣٣',
      'الشركة': 'ذيب لتأجير السيارات',
      'الفرع': 'الرياض - المطار',
      'السيارة': 'تويوتا كامري 2025',
      'رقم اللوحة': 'س ع د 4455',
      'بداية الحجز': '19/11/2026',
      'نهاية الحجز': '22/11/2026',
      'الإجمالي': '900'
    },
    // Row 2: English headers -> creates new booking
    {
      'Booking #': 'RG-NEW-202',
      'Customer Name': 'Sara Al-Harbi',
      'Mobile': '+966509998877',
      'Company': 'Budget KSA',
      'Branch': 'Jeddah Airport',
      'Car': 'Mazda 6',
      'Start Date': 46345, // serial
      'Days': 4,
      'Total (SAR)': 1200,
      'Status': 'نشط الآن'
    },
    // Row 3: Completely blank -> skipped silently
    {
      'رقم الحجز': '',
      'اسم العميل': ''
    },
    // Row 4: Missing both customer name and booking number while having start date -> error + skipped
    {
      'بداية الحجز': '2026-11-25'
    }
  ];

  const parsed = core.parseImportedReservationRows(rawRows, existing, { id: 'EMP_ADMIN', name: 'المدير' });
  assert.equal(parsed.totalRead, 4);
  assert.equal(parsed.validRows.length, 2);
  assert.equal(parsed.updateCount, 1);
  assert.equal(parsed.newCount, 1);
  assert.equal(parsed.skippedRows, 2);
  assert.equal(parsed.errors.length, 1);

  const updated = parsed.validRows[0];
  assert.equal(updated.id, 'RES_EXIST_1');
  assert.equal(updated.customerName, 'خالد العتيبي');
  assert.equal(updated.customerPhone, '0551112233');
  assert.equal(updated.startDate, '2026-11-19');
  assert.equal(updated.endDate, '2026-11-22');
  assert.equal(updated.daysCount, 3);
  assert.equal(updated.totalAmount, 900);

  const inserted = parsed.validRows[1];
  assert.equal(inserted.reservationNumber, 'RG-NEW-202');
  assert.equal(inserted.internalStatus, 'نشط الآن');
  assert.equal(inserted.daysCount, 4);
  assert.equal(inserted.totalAmount, 1200);
});

test('Sandbox E2E: saveUserLayoutPrefs, previewDeleteReservations, scoped deleteAllReservations + export, and importReservationsFromExcel', async () => {
  assert.ok(core.getCacheInvalidationScopes('saveUserLayoutPrefs').includes('dashboard'));
  const { api } = createSandboxApiHarness();

  const adminLogin = await api.callApi('login', { username: 'admin', password: 'Admin@123' });
  assert.equal(adminLogin.success, true);
  api.setToken(adminLogin.data.token);

  // 1. Save layout preferences and verify bootstrap returns them
  const savedLayout = await api.callApi('saveUserLayoutPrefs', {
    navOrder: ['reservations', 'my-followups', 'dashboard', 'settings'],
    hiddenRoutes: ['activity', 'dashboard'], // 'dashboard' must be stripped as protected
    dashOrder: ['expiry_radar', 'hero_kpis'],
    dashHidden: ['peak_heatmap']
  });
  assert.equal(savedLayout.success, true);
  assert.equal(savedLayout.data.layoutPrefs.navOrder[0], 'reservations');
  assert.deepEqual(savedLayout.data.layoutPrefs.hiddenRoutes, ['activity']);
  assert.equal(savedLayout.data.layoutPrefs.dashOrder[0], 'expiry_radar');
  assert.deepEqual(savedLayout.data.layoutPrefs.dashHidden, ['peak_heatmap']);

  const boot = await api.callApi('getAppBootstrap', { range: '30d' });
  assert.equal(boot.success, true);
  assert.equal(boot.data.layoutPrefs.navOrder[0], 'reservations');
  assert.deepEqual(boot.data.layoutPrefs.hiddenRoutes, ['activity']);

  // 2. Import reservations via Excel payload (one in 2024-05, one in 2026-11)
  const beforeRes = await api.callApi('getReservations', { page: 1, pageSize: 100 });
  const initialCount = beforeRes.data.items.length;

  const imp = await api.callApi('importReservationsFromExcel', {
    rows: [
      {
        reservationNumber: 'IMP-2024-01',
        customerName: 'مستأجر أرشيف 2024',
        customerPhone: '0501112233',
        carName: 'هيونداي النترا',
        startDate: '2024-05-10',
        endDate: '2024-05-14',
        totalAmount: 780
      },
      {
        reservationNumber: 'IMP-2026-99',
        customerName: 'مستأجر حالي 2026',
        customerPhone: '0554445566',
        carName: 'كيا K5',
        startDate: '2026-11-18',
        endDate: '2026-11-20',
        totalAmount: 650
      }
    ]
  });
  assert.equal(imp.success, true);
  assert.equal(imp.data.importedCount, 2);
  assert.equal(imp.data.updatedCount, 0);
  assert.equal(imp.data.totalProcessed, 2);

  const afterImpRes = await api.callApi('getReservations', { page: 1, pageSize: 100 });
  assert.equal(afterImpRes.data.items.length, initialCount + 2);

  // 3. Preview scoped deletion for month 2024-05 -> should match exactly 1 record
  const prevMonth = await api.callApi('previewDeleteReservations', {
    scope: 'month',
    yearMonth: '2024-05'
  });
  assert.equal(prevMonth.success, true);
  assert.equal(prevMonth.data.count, 1);

  // 4. Execute scoped deletion for month 2024-05 -> deletes only 1 and returns exportedRows
  const delMonth = await api.callApi('deleteAllReservations', {
    scope: 'month',
    yearMonth: '2024-05',
    acknowledged: true,
    confirmPhrase: core.DELETE_ALL_RESERVATIONS_PHRASE,
    password: 'Admin@123'
  });
  assert.equal(delMonth.success, true);
  assert.equal(delMonth.data.deletedReservationsCount, 1);
  assert.equal(delMonth.data.scope.scope, 'month');
  assert.ok(Array.isArray(delMonth.data.exportedRows) && delMonth.data.exportedRows.length === 1);
  assert.equal(delMonth.data.exportedRows[0].reservationNumber, 'IMP-2024-01');

  const afterScopedDel = await api.callApi('getReservations', { page: 1, pageSize: 100 });
  assert.equal(afterScopedDel.data.items.length, initialCount + 1);
  assert.ok(afterScopedDel.data.items.some((r: any) => r.reservationNumber === 'IMP-2026-99'));
  assert.ok(!afterScopedDel.data.items.some((r: any) => r.reservationNumber === 'IMP-2024-01'));
});

test('Phase 3+: computeDashboardSectionSpans avoids grid holes & getFirstAllowedRoute handles missing view_dashboard', () => {
  // Adjacent daily_chart + recent_activity share 7/5 split
  const adj = core.computeDashboardSectionSpans(['hero_kpis', 'daily_chart', 'recent_activity', 'charts_grid']);
  assert.equal(adj.hero_kpis, 'dash-sec-full');
  assert.equal(adj.daily_chart, 'dash-sec-half-wide');
  assert.equal(adj.recent_activity, 'dash-sec-half-narrow');
  assert.equal(adj.charts_grid, 'dash-sec-full');

  // Separated or solo cards automatically become full-width (no empty grid hole!)
  const sep = core.computeDashboardSectionSpans(['daily_chart', 'hero_kpis', 'recent_activity']);
  assert.equal(sep.daily_chart, 'dash-sec-full');
  assert.equal(sep.recent_activity, 'dash-sec-full');

  const solo = core.computeDashboardSectionSpans(['daily_chart', 'charts_grid']);
  assert.equal(solo.daily_chart, 'dash-sec-full');

  // Safe first-route fallback when view_dashboard is revoked
  const noDashUser = { role: 'agent', permissions: ['dash_perms_configured', 'add_followup'] };
  const route1 = core.getFirstAllowedRoute(noDashUser, { navOrder: ['dashboard', 'reservations', 'settings'], hiddenRoutes: [] });
  assert.equal(route1, 'reservations');

  const hiddenResUser = { role: 'agent', permissions: ['dash_perms_configured', 'add_followup'] };
  const route2 = core.getFirstAllowedRoute(hiddenResUser, { navOrder: ['dashboard', 'reservations', 'my-followups'], hiddenRoutes: ['reservations'] });
  assert.equal(route2, 'my-followups');
});

test('Sandbox & GAS parity: safe directory getEmployees, Permissions.gs 9 keys, and GAS routes', async () => {
  const { api } = createSandboxApiHarness();
  const adminLogin = await api.callApi('login', { username: 'admin', password: 'Admin@123' });
  assert.equal(adminLogin.success, true);
  api.setToken(adminLogin.data.token);

  // Create limited agent without view_employees or view_dashboard
  const created = await api.callApi('createEmployee', {
    name: 'موظف محدود اختبار',
    username: 'limited_emp_p3',
    password: 'User@1234',
    role: 'agent',
    permissions: ['dash_perms_configured', 'add_followup', 'quick_update_status']
  });
  assert.equal(created.success, true);

  const limitedLogin = await api.callApi('login', { username: 'limited_emp_p3', password: 'User@1234' });
  assert.equal(limitedLogin.success, true);
  api.setToken(limitedLogin.data.token);

  // Non-admin calling getEmployees receives active safe directory instead of FORBIDDEN
  const dirRes = await api.callApi('getEmployees', {});
  assert.equal(dirRes.success, true);
  assert.equal(dirRes.data.directoryOnly, true);
  assert.ok(Array.isArray(dirRes.data.items) && dirRes.data.items.length > 0);
  assert.equal(dirRes.data.rolePresets, undefined);

  // GAS files parity checks
  const permsGs = fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/Permissions.gs'), 'utf8');
  for (const key of core.DASHBOARD_PERMISSION_KEYS) {
    assert.ok(permsGs.includes(key), `Permissions.gs must include ${key}`);
  }
  assert.ok(permsGs.includes('canUserViewDashboardSection'), 'Permissions.gs must define canUserViewDashboardSection');

  const codeGs = fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/Code.gs'), 'utf8');
  assert.ok(codeGs.includes("case 'saveUserLayoutPrefs':"));
  assert.ok(codeGs.includes("case 'previewDeleteReservations':"));
  assert.ok(codeGs.includes("case 'importReservationsFromExcel':"));

  const settingsGs = fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/Settings.gs'), 'utf8');
  assert.ok(settingsGs.includes('function saveUserLayoutPrefs('));

  const resGs = fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/Reservations.gs'), 'utf8');
  assert.ok(resGs.includes('function previewDeleteReservations('));
  assert.ok(resGs.includes('function importReservationsFromExcel('));
  assert.ok(!/\bupdateRecordsWhere\s*\(/.test(resGs), 'Reservations.gs must use updateRecordsWhere_, not updateRecordsWhere');
  assert.ok(!/\bgetSheet\s*\(/.test(resGs), 'Reservations.gs must not call undefined getSheet()');
});

test('Shared module mirrors remain byte-identical across Phase 3 edits', () => {
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
