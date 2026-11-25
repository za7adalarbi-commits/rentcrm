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

  const events: Array<{ type: string; detail: any }> = [];
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

  const apiCode = readRepoFile('assets/js/api.js');
  vm.runInContext(apiCode, context, { filename: 'assets/js/api.js' });
  return { api: sandboxWindow.RGApi, window: sandboxWindow, storage, events };
}

test('Mirror files stay byte-for-byte identical (coreBridge, app.js, employees.js)', () => {
  assert.equal(readRepoFile('assets/js/core.js'), readRepoFile('backend/coreBridge.cjs'));
  assert.equal(readRepoFile('assets/js/app.js'), readRepoFile('src/assets/js/app.js'));
  assert.equal(readRepoFile('assets/js/employees.js'), readRepoFile('src/assets/js/employees.js'));
});

test('Every UI_SIMPLIFICATION_OPTIONS entry has unique key/cssClass and matching rule in dashboard.css', () => {
  const css = readRepoFile('assets/css/dashboard.css');
  const options = core.UI_SIMPLIFICATION_OPTIONS || [];
  assert.ok(options.length >= 60, 'Expected full UI_SIMPLIFICATION_OPTIONS list including new settings toggles');

  const keys = options.map((o: any) => o.key);
  const cssClasses = options.map((o: any) => o.cssClass);
  assert.equal(new Set(keys).size, keys.length, 'UI option keys must be unique');
  assert.equal(new Set(cssClasses).size, cssClasses.length, 'UI option cssClasses must be unique');

  for (const opt of options) {
    assert.ok(
      css.includes(`html.${opt.cssClass}`),
      `Missing CSS hide rule for UI simplification class: html.${opt.cssClass}`
    );
  }

  const requiredNewKeys = [
    'hideDrawerClaimBtns',
    'hideDrawerBackBtn',
    'hideProblemsManageBtns',
    'hideProblemsOpenResBtn',
    'hideEmpManagePermsBtn',
    'hideEmpRolePresetBtns',
    'hideEditDeveloperBtn',
    'hidePersonalSettingsCardBtn',
    'hideNotifMarkAllBtn',
    'hideProfileInstallAppBtn',
    'hideProfileThemeBtn',
    'hideProfileLangBtn',
    'hideProfileLogoutBtn',
    'hideSettingsRgTokenCard',
    'hideSettingsSyncSection',
    'hideSettingsHandoverCard',
    'hideSettingsRoleUiDefaults'
  ];
  for (const k of requiredNewKeys) {
    assert.ok(keys.includes(k), `Missing new UI simplification toggle: ${k}`);
  }

  const norm = core.normalizeUiSimplificationSettings({
    hideEditDeveloperBtn: true,
    hideDrawerClaimBtns: true,
    hideSettingsSyncSection: true
  });
  assert.equal(norm.hideEditDeveloperBtn, true);
  assert.equal(norm.hideDrawerClaimBtns, true);
  assert.equal(norm.hideSettingsSyncSection, true);
  assert.equal(norm.hideDrawerBackBtn, false);
});

test('Sub-section permissions (canUserViewSubSection) enforce granular show/hide across roles', () => {
  assert.equal(core.SUBSECTION_VIEW_PERMISSION_KEYS.length, 8);

  // Configured supervisor with only Today tab and Reports charts enabled
  const customSup = {
    id: 'EMP_SUP_SUB',
    role: 'supervisor',
    permissions: [
      'perms_sections_configured',
      'perms_subsections_configured',
      'view_reservations',
      'view_reports',
      'sub_view_today_tab',
      'sub_view_rep_charts'
    ]
  };
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_today_tab'), true);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_radar_tab'), false);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_myfu_mentions'), false);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_myfu_history'), false);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_prb_rates'), false);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_rep_charts'), true);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_emp_delegations'), false);
  assert.equal(core.canUserViewSubSection(customSup, 'sub_view_emp_presets'), false);

  // Configured user with zero sub-sections enabled
  const noneUser = {
    id: 'EMP_NONE_SUB',
    role: 'general_manager',
    permissions: ['perms_sections_configured', 'perms_subsections_configured', 'view_reservations']
  };
  for (const subKey of core.SUBSECTION_VIEW_PERMISSION_KEYS) {
    assert.equal(core.canUserViewSubSection(noneUser, subKey), false, `Sub-section ${subKey} must be hidden`);
  }

  // Legacy agent without perms_subsections_configured keeps non-privileged default sub-sections
  const legacyAgent = {
    id: 'EMP_LEGACY_AGENT',
    role: 'agent',
    permissions: ['view_reservations', 'view_my_followups']
  };
  assert.equal(core.canUserViewSubSection(legacyAgent, 'sub_view_today_tab'), true);
  assert.equal(core.canUserViewSubSection(legacyAgent, 'sub_view_radar_tab'), true);
  assert.equal(core.canUserViewSubSection(legacyAgent, 'sub_view_myfu_mentions'), true);

  // Configured agent with perms_subsections_configured hides ungranted sub-sections
  const configuredAgent = {
    id: 'EMP_CFG_AGENT',
    role: 'agent',
    permissions: ['perms_subsections_configured', 'view_reservations', 'sub_view_today_tab']
  };
  assert.equal(core.canUserViewSubSection(configuredAgent, 'sub_view_today_tab'), true);
  assert.equal(core.canUserViewSubSection(configuredAgent, 'sub_view_emp_presets'), false);
});

test('Anti-spam guard removes __seq bypass in api.js and backend router enforces idempotency', () => {
  const apiJs = readRepoFile('assets/js/api.js');
  const routerTs = readRepoFile('backend/router.ts');
  assert.equal(apiJs.includes('repeatableActionSeq'), false, 'Spam bypass repeatableActionSeq must be removed');
  assert.equal(apiJs.includes('clone.__seq'), false, '__seq bypass must be removed');
  assert.ok(routerTs.includes('runWithIdempotency'), 'Backend router must use runWithIdempotency');
});

test('Dashboard Leaderboard returns closedCount & closedBookingsCount and filters by date range in sandbox', async () => {
  const lbDirect = core.computeEmployeeLeaderboard(
    [
      { id: 'E1', name: 'أحمد', role: 'agent', status: 'active' },
      { id: 'E2', name: 'سارة', role: 'supervisor', status: 'active' }
    ],
    [
      { id: 'R1', assignedEmployeeIds: ['E1'], internalStatus: 'تم التسليم', originalStatusAr: 'منتهي' },
      { id: 'R2', assignedEmployeeIds: ['E1', 'E2'], internalStatus: 'تم الحجز' }
    ],
    [
      { id: 'F1', employeeId: 'E1', employeeName: 'أحمد' },
      { id: 'F2', employeeId: 'E1', employeeName: 'أحمد' }
    ],
    [
      { id: 'P1', assignedEmployeeIds: ['E2'], status: 'مغلقة' }
    ]
  );

  assert.equal(lbDirect[0].employeeId, 'E1');
  assert.equal(lbDirect[0].closedCount, 1);
  assert.equal(lbDirect[0].closedBookingsCount, 1);
  assert.equal(lbDirect[1].closedCount, 0);
  assert.equal(lbDirect[1].closedBookingsCount, 0);

  const { api } = createSandboxApiHarness();
  const loginRes = await api.callApi('login', { username: 'developer', password: 'Dev@123' });
  assert.equal(loginRes.success, true);
  api.setToken(loginRes.data.token);

  const futureDash = await api.callApi('getDashboard', {
    range: 'custom',
    dateFrom: '2099-01-01',
    dateTo: '2099-01-02'
  });
  assert.equal(futureDash.success, true);
  const futureLb = futureDash.data.leaderboard || [];
  assert.ok(Array.isArray(futureLb));
  for (const row of futureLb) {
    assert.equal(row.followUpsCount, 0, 'Future date range must yield 0 follow-ups for leaderboard');
    assert.equal(row.assignedCount, 0, 'Future date range must yield 0 assigned reservations for leaderboard');
    assert.equal(row.closedBookingsCount, row.closedCount);
  }
});

test('Edit Developer Data buttons exist in Settings, Employees, and Profile Menu', () => {
  const settingsJs = readRepoFile('assets/js/settings.js');
  const employeesJs = readRepoFile('assets/js/employees.js');
  const appJs = readRepoFile('assets/js/app.js');

  assert.ok(settingsJs.includes('id="btn-edit-developer-data"'));
  assert.ok(employeesJs.includes('id="emp-edit-dev-btn"'));
  assert.ok(employeesJs.includes('emp-edit-dev-btn'));
  assert.ok(appJs.includes('id="profile-edit-developer-btn"'));
});
