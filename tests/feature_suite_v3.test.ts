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
  vm.runInContext(apiCode, context, { filename: 'assets/js/api.js' });
  return { api: sandboxWindow.RGApi, window: sandboxWindow, storage };
}

test('Section hide/show permissions cover all 9 routes including employees & general_manager', () => {
  assert.ok(core.SECTION_VIEW_PERMISSION_KEYS.includes('view_employees'));
  assert.ok(core.SECTION_VIEW_PERMISSION_KEYS.includes('view_settings'));
  assert.equal(core.ROUTE_PERMISSION_MAP.dashboard, 'view_dashboard');

  const customGm = {
    id: 'EMP_GM_CUSTOM',
    role: 'general_manager',
    permissions: [
      'perms_sections_configured',
      'view_reservations',
      'view_reports'
    ]
  };
  assert.equal(core.canUserViewRoute(customGm, 'dashboard'), false);
  assert.equal(core.canUserViewRoute(customGm, 'employees'), false);
  assert.equal(core.canUserViewRoute(customGm, 'settings'), false);
  assert.equal(core.canUserViewRoute(customGm, 'reservations'), true);
  assert.equal(core.canUserViewRoute(customGm, 'reports'), true);
  assert.equal(core.getFirstAllowedRoute(customGm), 'reservations');

  const settingsOnlyGm = {
    id: 'EMP_GM_SET',
    role: 'general_manager',
    permissions: [
      'perms_sections_configured',
      'view_settings'
    ]
  };
  assert.equal(core.getFirstAllowedRoute(settingsOnlyGm), 'settings');

  const zeroSectionsUser = {
    id: 'EMP_NONE',
    role: 'agent',
    permissions: ['perms_sections_configured']
  };
  for (const r of core.NAV_ROUTE_IDS) {
    assert.equal(core.canUserViewRoute(zeroSectionsUser, r), false, `Route ${r} must be hidden`);
  }
  assert.equal(core.getFirstAllowedRoute(zeroSectionsUser), '');
});

test('All 19 new UI Simplification options exist with unique keys & cssClasses and normalize properly', () => {
  const expectedNewKeys = [
    'hideSidebarCollapseBtn',
    'hideProfilePersonalBtn',
    'hideLogoutBtn',
    'hideDashTimeFilter',
    'hideDashViewAllBtns',
    'hideResResetBtn',
    'hideTodayRefreshBtn',
    'hideRadarWhatsappBtns',
    'hideDrawerHeaderPinBtn',
    'hideDrawerAddFollowupForm',
    'hideDrawerEditFollowupBtns',
    'hideMyfuIcsBtn',
    'hideTeamFuBulkBtn',
    'hideProblemsResetBtn',
    'hideReportsTypeTabs',
    'hideEmployeesAddBtn',
    'hideEmployeesRowActions',
    'hideSettingsDiagnostics',
    'hideSettingsDangerZone'
  ];

  const allKeys = core.UI_SIMPLIFICATION_OPTIONS.map((o: any) => o.key);
  const allCss = core.UI_SIMPLIFICATION_OPTIONS.map((o: any) => o.cssClass);
  assert.equal(new Set(allKeys).size, allKeys.length, 'UI option keys must be unique');
  assert.equal(new Set(allCss).size, allCss.length, 'UI option cssClasses must be unique');

  for (const k of expectedNewKeys) {
    assert.ok(allKeys.includes(k), `Missing UI simplification key: ${k}`);
  }

  const normalized = core.normalizeUiSimplificationSettings({
    hideSidebarCollapseBtn: true,
    hideDashTimeFilter: true,
    hideEmployeesAddBtn: true,
    hideSettingsDangerZone: true
  });
  assert.equal(normalized.hideSidebarCollapseBtn, true);
  assert.equal(normalized.hideDashTimeFilter, true);
  assert.equal(normalized.hideEmployeesAddBtn, true);
  assert.equal(normalized.hideSettingsDangerZone, true);
  assert.equal(normalized.hideLogoutBtn, false);
});

test('Developer self-edit in sandbox updates username & password while preserving active session', async () => {
  const { api } = createSandboxApiHarness();

  // Sign in as Developer
  const loginDev = await api.callApi('login', { username: 'developer', password: 'Dev@123' });
  assert.equal(loginDev.success, true);
  const activeToken = loginDev.data.token;
  const devEmp = loginDev.data.user;
  assert.equal(devEmp.role, 'developer');

  // General Manager must NOT be able to edit Developer
  const loginGm = await api.callApi('login', { username: 'admin', password: 'Admin@123' });
  assert.equal(loginGm.success, true);
  const gmToken = loginGm.data.token;

  api.setToken(gmToken);
  const gmAttempt = await api.callApi('updateEmployee', {
    employeeId: devEmp.id,
    name: 'Hacked Dev',
    role: 'agent',
    status: 'active'
  });
  assert.equal(gmAttempt.success, false);

  // Switch back to Developer session and update own username, name & password
  api.setToken(activeToken);
  const dupAttempt = await api.callApi('updateEmployee', {
    employeeId: devEmp.id,
    name: devEmp.name,
    username: 'admin',
    role: 'developer',
    status: 'active'
  });
  assert.equal(dupAttempt.success, false, 'Duplicate username must be rejected');

  const selfUpdate = await api.callApi('updateEmployee', {
    employeeId: devEmp.id,
    name: 'المبرمج الرئيسي',
    username: 'dev_master',
    phone: '0555551234',
    email: 'leaddev@rentalgate.sa',
    jobTitle: 'مهندس النظام الرئيسي',
    role: 'developer',
    status: 'active',
    newPassword: 'NewDev@2026!'
  });
  assert.equal(selfUpdate.success, true);
  assert.equal(selfUpdate.data.username, 'dev_master');
  assert.equal(selfUpdate.data.name, 'المبرمج الرئيسي');

  // Verify current session token is STILL valid after changing own password
  const meAfter = await api.callApi('getMe', {});
  assert.equal(meAfter.success, true, 'Active Developer session must remain valid after self password update');
  assert.equal(meAfter.data.user.username, 'dev_master');

  // Verify new credentials work for fresh sign-in
  const relogin = await api.callApi('login', { username: 'dev_master', password: 'NewDev@2026!' });
  assert.equal(relogin.success, true);
});

test('Anti-spam guard prevents rapid duplicates & callApi respects _spamChecked', async () => {
  const state = { timestamps: [], signatures: {} };
  const r1 = core.evaluateSpamGuard(state, 'claimReservation', 'RES_1', {
    nowMs: 10000,
    duplicateWindowMs: 1200,
    burstWindowMs: 10000,
    maxBurst: 5
  });
  assert.equal(r1.allowed, true);

  // Exact duplicate within duplicateWindowMs -> blocked
  const r2 = core.evaluateSpamGuard(state, 'claimReservation', 'RES_1', {
    nowMs: 10300,
    duplicateWindowMs: 1200,
    burstWindowMs: 10000,
    maxBurst: 5
  });
  assert.equal(r2.allowed, false);
  assert.equal(r2.reason, 'DUPLICATE_SUBMISSION');

  // Different target at same timestamp -> allowed immediately!
  const r3 = core.evaluateSpamGuard(state, 'claimReservation', 'RES_2', {
    nowMs: 10350,
    duplicateWindowMs: 1200,
    burstWindowMs: 10000,
    maxBurst: 5
  });
  assert.equal(r3.allowed, true);

  // Pre-checked UI actions pass _spamChecked: true and do not trigger double-block in callApi
  const { api } = createSandboxApiHarness();
  const loginRes = await api.callApi('login', { username: 'developer', password: 'Dev@123' });
  assert.equal(loginRes.success, true);
  api.setToken(loginRes.data.token);
  const resList = await api.callApi('getReservations', { page: 1, pageSize: 5 });
  assert.equal(resList.success, true);
  const firstResId = resList.data.items[0].id;
  const claimRes = await api.callApi('claimReservation', { reservationId: firstResId, _spamChecked: true });
  assert.equal(claimRes.success, true);
});
