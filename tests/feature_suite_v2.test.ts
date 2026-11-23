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

test('Developer role has top-level privileges across routes, actions, and UI simplification catalog', () => {
  assert.equal(core.ROLES.DEVELOPER, 'developer');
  assert.equal(core.isPrivilegedRole('developer'), true);
  assert.equal(core.isPrivilegedRole('general_manager'), true);
  assert.equal(core.isPrivilegedRole('supervisor'), false);

  const devUser = { id: 'EMP_DEV', role: 'developer', permissions: ['all'] };
  assert.equal(core.canUserPerform(devUser, 'manage_settings'), true);
  assert.equal(core.canUserPerform(devUser, 'bulk_reassign_reservations'), true);
  assert.equal(core.canUserPerform(devUser, 'impersonate_role'), true);
  assert.equal(core.canUserPerform(devUser, 'manage_developer_tools'), true);
  assert.equal(core.canUserPerform(devUser, 'manage_api_connection'), true);
  assert.equal(core.canUserPerform(devUser, 'manage_role_ui_defaults'), true);
  assert.equal(core.canUserPerform(devUser, 'manage_announcements'), true);
  assert.equal(core.canUserPerform(devUser, 'delete_reservations'), true);
  assert.equal(core.canUserPerform(devUser, 'any_future_arbitrary_action'), true);

  const gmDefaults = core.ROLE_PERMISSION_MATRIX.general_manager;
  assert.ok(gmDefaults.includes('manage_api_connection'));
  assert.ok(gmDefaults.includes('manage_role_ui_defaults'));
  assert.ok(gmDefaults.includes('manage_announcements'));
  assert.ok(gmDefaults.includes('delete_reservations'));
  assert.equal(gmDefaults.includes('manage_developer_tools'), false);

  const devDefaults = core.ROLE_PERMISSION_MATRIX.developer;
  assert.ok(devDefaults.includes('manage_developer_tools'));

  for (const routeId of core.NAV_ROUTE_IDS) {
    assert.equal(core.canUserViewRoute(devUser, routeId), true, `Developer must access route ${routeId}`);
  }

  assert.ok(Array.isArray(core.UI_SIMPLIFICATION_OPTIONS));
  assert.ok(core.UI_SIMPLIFICATION_OPTIONS.length >= 55, `Expected >= 55 UI simplification options, got ${core.UI_SIMPLIFICATION_OPTIONS.length}`);
});

test('Granular section permissions control route visibility when perms_sections_configured is active', () => {
  const restrictedAgent = {
    id: 'EMP_AG1',
    role: 'agent',
    permissions: [
      'perms_sections_configured',
      'view_dashboard',
      'view_reservations',
      'view_my_followups'
    ]
  };

  assert.equal(core.canUserViewRoute(restrictedAgent, 'dashboard'), true);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'reservations'), true);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'my-followups'), true);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'reports'), false);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'problems'), false);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'settings'), false);
  assert.equal(core.canUserViewRoute(restrictedAgent, 'team-followups'), false);
});

test('Impersonation / Preview Role enforces hierarchy and resolves target employee/preset permissions', () => {
  const devActor = { id: 'EMP_DEV', name: 'Dev', role: 'developer' };
  const gmActor = { id: 'EMP_GM', name: 'GM', role: 'general_manager' };
  const supActor = { id: 'EMP_SUP', name: 'Sup', role: 'supervisor' };
  const agentActor = { id: 'EMP_AG', name: 'Agent', role: 'agent' };

  assert.equal(core.canUserImpersonate(devActor), true);
  assert.equal(core.canUserImpersonate(gmActor), true);
  assert.equal(core.canUserImpersonate(supActor), true);
  assert.equal(core.canUserImpersonate(agentActor), false);

  assert.deepEqual(core.getAllowedPreviewRoles(devActor), ['agent', 'supervisor', 'general_manager', 'developer']);
  assert.deepEqual(core.getAllowedPreviewRoles(gmActor), ['agent', 'supervisor', 'general_manager']);
  assert.deepEqual(core.getAllowedPreviewRoles(supActor), ['agent', 'supervisor']);

  // GM must NOT preview Developer
  assert.equal(core.resolvePreviewUserSession(gmActor, { role: 'developer' }, [], []), null);
  assert.equal(core.resolvePreviewUserSession(gmActor, { role: 'developer', customPermissions: ['all'] }, [], []), null);

  // Supervisor previewing specific agent inherits exact agent permissions
  const emps = [
    { id: 'EMP_A1', name: 'سارة', username: 'sara', role: 'agent', permissions: ['view_dashboard', 'view_reservations', 'perms_sections_configured'] },
    { id: 'EMP_DEV', name: 'المبرمج', username: 'developer', role: 'developer', permissions: ['all'] }
  ];
  const supPreviewAgent = core.resolvePreviewUserSession(supActor, { employeeId: 'EMP_A1' }, emps, []);
  assert.ok(supPreviewAgent);
  assert.equal(supPreviewAgent.isPreviewSession, true);
  assert.equal(supPreviewAgent.role, 'agent');
  assert.equal(supPreviewAgent.id, 'EMP_A1');
  assert.equal(core.canUserViewRoute(supPreviewAgent, 'employees'), false);

  // Draft customPermissions and customLabel work when editing unsaved employee/job preset
  const draftPreview = core.resolvePreviewUserSession(gmActor, {
    role: 'agent',
    customLabel: 'مسوّدة وظيفة استعلام فقط',
    customPermissions: ['perms_sections_configured', 'view_dashboard', 'view_reports']
  }, emps, []);
  assert.ok(draftPreview);
  assert.equal(draftPreview.name, 'معاينة: مسوّدة وظيفة استعلام فقط');
  assert.equal(draftPreview.jobTitle, 'مسوّدة وظيفة استعلام فقط');
  assert.equal(draftPreview.role, 'agent');
  assert.equal(core.canUserViewRoute(draftPreview, 'reports'), true);
  assert.equal(core.canUserViewRoute(draftPreview, 'reservations'), false);

  // Supervisor must NOT preview Developer employee
  assert.equal(core.resolvePreviewUserSession(supActor, { employeeId: 'EMP_DEV' }, emps, []), null);
});

test('Centralized Role UI Defaults normalize and override global settings per role', () => {
  const normalized = core.normalizeRoleUiDefaults({
    agent: {
      enabled: true,
      forceForRole: true,
      visibleCols: ['reservationNumber', 'customerName', 'internalStatus'],
      uiSimplification: {
        preset: 'small',
        hideNavReports: true,
        hideDashLeaderboard: true
      }
    }
  });

  assert.equal(normalized.agent.enabled, true);
  assert.equal(normalized.agent.forceForRole, true);
  assert.deepEqual(normalized.agent.visibleCols, ['reservationNumber', 'customerName', 'internalStatus']);
  assert.equal(normalized.agent.uiSimplification.preset, 'small');
  assert.equal(normalized.agent.uiSimplification.hideNavReports, true);
  assert.equal(normalized.agent.uiSimplification.hideDashLeaderboard, true);

  const globalSimp = { preset: 'full' };
  const agentResolved = core.resolveRoleUiDefaultsForUser({ id: 'E1', role: 'agent' }, normalized, globalSimp);
  assert.equal(agentResolved.hasRoleOverride, true);
  assert.equal(agentResolved.forceForRole, true);
  assert.equal(agentResolved.uiSimplification.preset, 'small');
  assert.deepEqual(agentResolved.visibleCols, ['reservationNumber', 'customerName', 'internalStatus']);

  const supResolved = core.resolveRoleUiDefaultsForUser({ id: 'E2', role: 'supervisor' }, normalized, globalSimp);
  assert.equal(supResolved.hasRoleOverride, false);
  assert.equal(supResolved.forceForRole, false);
});

test('Shift Handover PDF payload separates Pickups and Returns when splitPickupsAndReturns is enabled', () => {
  const today = new Date().toISOString().slice(0, 10);
  const summary = core.computeShiftHandoverSummary({
    reservations: [
      {
        id: 'R1',
        reservationNumber: 'RG-101',
        customerName: 'أحمد خالد',
        carName: 'Camry',
        companyName: 'Budget',
        branchName: 'المطار',
        startDate: today,
        startTime: '10:00',
        endDate: '2099-01-10',
        endTime: '12:00',
        internalStatus: 'قيد الانتظار'
      },
      {
        id: 'R2',
        reservationNumber: 'RG-102',
        customerName: 'فهد علي',
        carName: 'Elantra',
        companyName: 'Hertz',
        branchName: 'الرياض',
        deliverBranchName: 'جدة',
        startDate: '2020-01-01',
        startTime: '09:00',
        endDate: today,
        endTime: '15:30',
        internalStatus: 'قيد المتابعة'
      }
    ],
    problems: [],
    followUps: [],
    preset: 'today'
  });

  const payload = core.buildShiftHandoverPdfPayload(summary, 'ar', {
    pdfVisibility: {
      includeTodayMovements: true,
      splitPickupsAndReturns: true
    }
  });

  assert.ok(Array.isArray(payload.tables), 'Expected tables array in handover PDF payload');
  const pickupsTable = payload.tables.find((t: any) => t.kind === 'pickups');
  const returnsTable = payload.tables.find((t: any) => t.kind === 'returns');
  assert.ok(pickupsTable, 'Expected pickups table');
  assert.ok(returnsTable, 'Expected returns table');
  assert.equal(pickupsTable.rows.length, 1);
  assert.equal(pickupsTable.rows[0].reservationNumber, 'RG-101');
  assert.equal(returnsTable.rows.length, 1);
  assert.equal(returnsTable.rows[0].reservationNumber, 'RG-102');
});

test('Anti-Spam guard blocks duplicate identical payloads, allows exempt actions, and enforces burst limit', () => {
  const stateObj: any = {};

  // Exempt read/lock actions bypass guard
  assert.equal(core.evaluateSpamGuard(stateObj, 'getReservations', 'sig-get', { nowMs: 1000 }).allowed, true);
  assert.equal(core.evaluateSpamGuard(stateObj, 'getReservations', 'sig-get', { nowMs: 1005 }).allowed, true);

  // Duplicate mutation blocked inside duplicateWindowMs
  const first = core.evaluateSpamGuard(stateObj, 'addFollowUp', 'fu|R1|note', { nowMs: 2000, duplicateWindowMs: 1500 });
  assert.equal(first.allowed, true);
  const dup = core.evaluateSpamGuard(stateObj, 'addFollowUp', 'fu|R1|note', { nowMs: 2200, duplicateWindowMs: 1500 });
  assert.equal(dup.allowed, false);
  assert.equal(dup.reason, 'DUPLICATE_SUBMISSION');

  // Allowed again after duplicateWindowMs expires
  const afterWindow = core.evaluateSpamGuard(stateObj, 'addFollowUp', 'fu|R1|note', { nowMs: 3600, duplicateWindowMs: 1500 });
  assert.equal(afterWindow.allowed, true);

  // Burst rate limit enforced
  const burstState: any = {};
  for (let i = 0; i < 5; i++) {
    assert.equal(core.evaluateSpamGuard(burstState, 'updateReservation', `sig-${i}`, { nowMs: 5000 + i * 10, maxBurst: 5, burstWindowMs: 5000 }).allowed, true);
  }
  const blockedBurst = core.evaluateSpamGuard(burstState, 'updateReservation', 'sig-overflow', { nowMs: 5060, maxBurst: 5, burstWindowMs: 5000 });
  assert.equal(blockedBurst.allowed, false);
  assert.equal(blockedBurst.reason, 'RATE_LIMITED');
});

test('Employee Leaderboard ranks active staff by follow-ups, closures, and problem resolutions', () => {
  const emps = [
    { id: 'E1', name: 'نورة', role: 'agent', status: 'active' },
    { id: 'E2', name: 'خالد', role: 'agent', status: 'active' },
    { id: 'E3', name: 'موقوف', role: 'agent', status: 'disabled' }
  ];
  const reservations = [
    { id: 'R1', assignedEmployeeIds: ['E1'], internalStatus: 'تم الإرجاع' },
    { id: 'R2', assignedEmployeeIds: ['E1'], internalStatus: 'تم الاستلام' },
    { id: 'R3', assignedEmployeeIds: ['E2'], internalStatus: 'قيد الانتظار' }
  ];
  const followUps = [
    { id: 'F1', employeeId: 'E1' },
    { id: 'F2', employeeId: 'E1' },
    { id: 'F3', employeeId: 'E2' }
  ];
  const problems = [
    { id: 'P1', assignedEmployeeIds: ['E1'], status: 'مغلقة' }
  ];

  const board = core.computeEmployeeLeaderboard(emps, reservations, followUps, problems, { limit: 10 });
  assert.equal(board.length, 2, 'Disabled employee must be excluded');
  assert.equal(board[0].employeeId, 'E1');
  assert.equal(board[0].rank, 1);
  assert.equal(board[0].completionRate, 100);
  assert.equal(board[1].employeeId, 'E2');
  assert.equal(board[1].rank, 2);
});

test('Sandbox API supports developer login, bulkReassignReservations, role_ui_defaults, and duplicate spam protection', async () => {
  const { api } = createSandboxApiHarness();
  const devLogin = await api.callApi('login', { username: 'developer', password: 'Dev@123' });
  assert.equal(devLogin.success, true);
  assert.equal(devLogin.data.user.role, 'developer');
  api.setToken(devLogin.data.token);

  const dashRes = await api.callApi('getDashboard', { range: '30d' });
  assert.equal(dashRes.success, true);
  assert.ok(Array.isArray(dashRes.data.leaderboard), 'Dashboard should include leaderboard array');

  const resListResp = await api.callApi('getReservations', { page: 1, pageSize: 20 });
  assert.equal(resListResp.success, true);
  const firstTwoIds = (resListResp.data.items || []).slice(0, 2).map((r: any) => r.id);
  assert.equal(firstTwoIds.length, 2);

  const empResp = await api.callApi('getEmployees', {});
  assert.equal(empResp.success, true);
  const targetAgent = (empResp.data.items || []).find((e: any) => e.role === 'agent');
  assert.ok(targetAgent);

  // Bulk Reassign
  const bulkResp = await api.callApi('bulkReassignSelectedReservations', {
    reservationIds: firstTwoIds,
    targetEmployeeId: targetAgent.id,
    mode: 'replace'
  });
  assert.equal(bulkResp.success, true);
  assert.equal(bulkResp.data.updatedCount, 2);

  // Save Role UI Defaults
  const updRoleDefaults = await api.callApi('updateSettings', {
    role_ui_defaults: {
      agent: {
        enabled: true,
        forceForRole: true,
        visibleCols: ['reservationNumber', 'customerName', 'internalStatus'],
        uiSimplification: { preset: 'small' }
      }
    }
  });
  assert.equal(updRoleDefaults.success, true);
  assert.equal(updRoleDefaults.data.role_ui_defaults.agent.enabled, true);

  // Rapid duplicate identical follow-up triggers sandbox anti-spam guard
  const fu1 = await api.callApi('addFollowUp', {
    reservationId: firstTwoIds[0],
    status: 'معلق',
    action: 'ملاحظة سريعة',
    notes: 'اختبار مانع التكرار'
  });
  assert.equal(fu1.success, true);

  const fuDup = await api.callApi('addFollowUp', {
    reservationId: firstTwoIds[0],
    status: 'معلق',
    action: 'ملاحظة سريعة',
    notes: 'اختبار مانع التكرار'
  });
  assert.equal(fuDup.success, false);
  assert.match(String(fuDup.error || fuDup.message || ''), /DUPLICATE|RATE|Spam|التكرار/i);
});
