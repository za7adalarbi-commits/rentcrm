import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import type { DbClient, DbExecutor, QueryResult } from '../backend/db';
import type { AuthSession } from '../backend/auth';
import {
  buildPgSearchCondition,
  getAppBootstrap,
  getDeltaSync,
  getSettings,
  updateSettings
} from '../backend/queries';

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

function createSettingsMockExecutor(): DbExecutor & { settingsRows: Map<string, { key: string; value: string; updated_by: string; updated_at: Date }> } {
  const settingsRows = new Map<string, { key: string; value: string; updated_by: string; updated_at: Date }>();
  const employees = [
    {
      id: 'EMP_DEV',
      name: 'مبرمج النظام',
      username: 'developer',
      role: 'developer',
      status: 'active',
      permissions: JSON.stringify(['manage_settings', 'view_reservations', 'manage_employees']),
      delegation_config: '{}',
      layout_prefs: '{}'
    },
    {
      id: 'EMP_AGENT',
      name: 'موظف مبيعات',
      username: 'agent1',
      role: 'agent',
      status: 'active',
      permissions: JSON.stringify(['view_reservations', 'add_followup']),
      delegation_config: '{}',
      layout_prefs: '{}'
    }
  ];

  async function runQuery(sql: string, params: any[] = []): Promise<QueryResult<any>> {
    const q = sql.trim();

    if (/SELECT\s+key,\s*value(?:\s*,\s*updated_at)?\s+FROM\s+settings/i.test(q)) {
      return {
        rows: Array.from(settingsRows.values()).map((r) => ({
          key: r.key,
          value: r.value,
          updated_at: r.updated_at
        })),
        rowCount: settingsRows.size
      };
    }

    if (/SELECT\s+MAX\(updated_at\)\s+AS\s+(settings_updated_at|max_upd)\s+FROM\s+settings/i.test(q)) {
      let maxTs: Date | null = null;
      for (const r of settingsRows.values()) {
        if (!maxTs || r.updated_at.getTime() > maxTs.getTime()) maxTs = r.updated_at;
      }
      return { rows: [{ settings_updated_at: maxTs, max_upd: maxTs }], rowCount: 1 };
    }

    if (/INSERT\s+INTO\s+settings/i.test(q)) {
      const key = String(params[0] || '');
      const value = String(params[1] || '');
      const updatedBy = String(params[2] || 'system');
      settingsRows.set(key, { key, value, updated_by: updatedBy, updated_at: new Date() });
      return { rows: [], rowCount: 1 };
    }

    if (/SELECT\s+\*\s+FROM\s+employees/i.test(q)) {
      return { rows: employees.slice(), rowCount: employees.length };
    }

    if (/INSERT\s+INTO\s+(?:sheets_mirror_outbox|activity_log)/i.test(q)) {
      return { rows: [], rowCount: 1 };
    }

    if (/FROM\s+sync_log/i.test(q)) {
      return { rows: [], rowCount: 0 };
    }

    if (/FROM\s+announcements/i.test(q)) {
      return { rows: [], rowCount: 0 };
    }

    if (/FROM\s+reservations/i.test(q) || /FROM\s+follow_ups/i.test(q) || /FROM\s+problems/i.test(q) || /FROM\s+notifications/i.test(q) || /FROM\s+sync_tombstones/i.test(q)) {
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  const client: DbClient = {
    query: runQuery
  };

  return {
    settingsRows,
    query: runQuery,
    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      return fn(client);
    }
  };
}

function makeSession(role: 'developer' | 'general_manager' | 'supervisor' | 'agent', perms: string[]): AuthSession {
  const id = 'USR_' + role.toUpperCase();
  const nowIso = new Date().toISOString();
  return {
    tokenHash: 'tok_' + role,
    employeeId: id,
    username: role,
    role,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id,
      name: role === 'developer' ? 'المبرمج' : 'مستخدم ' + role,
      username: role,
      phone: '',
      email: '',
      jobTitle: '',
      role,
      permissions: perms,
      status: 'active',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  };
}

test('Mirror files stay byte-for-byte identical across all copies', () => {
  assert.equal(readRepoFile('assets/js/core.js'), readRepoFile('backend/coreBridge.cjs'));
  assert.equal(readRepoFile('assets/js/app.js'), readRepoFile('src/assets/js/app.js'));
  assert.equal(readRepoFile('assets/js/employees.js'), readRepoFile('src/assets/js/employees.js'));
});

test('Search normalization converts Arabic forms, Eastern/Persian digits, and blocks cross-field bleed', () => {
  assert.equal(core.normalizeSearchText('  أَحْمَدُ  إبراهيم ١٢٣  '), 'احمد ابراهيم 123');
  assert.equal(core.normalizeSearchText('فاطمة مصطفى ۰۹۸'), 'فاطمه مصطفي 098');
  assert.deepEqual(core.tokenizeSearchQuery('  أحمد   ٤٥ '), ['احمد', '45']);

  // No cross-field string concatenation bleed: ending of field A + start of field B must NOT match as one token
  assert.equal(core.matchesSearchFields(['RG-100', 'محمد علي'], '100محمد'), false);
  assert.equal(core.matchesSearchFields(['RG-100', 'محمد علي'], '100 علي'), true);
  assert.equal(core.matchesSearchFields(['شركة الوفاق', 'تويوتا كامري'], 'الوفاق كامري'), true);
  assert.equal(core.matchesSearchFields(['شركة الوفاق', 'تويوتا كامري'], 'الوفاق نيسان'), false);
});

test('Strict search across filterReservations, filterProblemsList, filterTeamFollowUpsList, calendar & radar', () => {
  const sampleRes = [
    {
      id: 'R1',
      reservationNumber: 'RG-9001',
      customerName: 'إبراهيم الدوسري',
      customerPhone: '0551234567',
      carName: 'هيونداي سوناتا',
      plateNumber: 'أ ب ج 1234',
      companyName: 'ذيب لتأجير السيارات',
      branchName: 'مطار الرياض',
      startDate: '2026-11-20',
      startTime: '10:00',
      endDate: '2026-11-25',
      endTime: '14:00',
      internalStatus: 'تم الحجز'
    },
    {
      id: 'R2',
      reservationNumber: 'RG-9002',
      customerName: 'فهد القحطاني',
      customerPhone: '0507654321',
      carName: 'كيا سبورتاج',
      plateNumber: 'س ع د 5555',
      companyName: 'بدجت',
      branchName: 'جدة',
      startDate: '2026-11-21',
      startTime: '12:00',
      endDate: '2026-11-26',
      endTime: '18:00',
      internalStatus: 'تم الحجز'
    }
  ];

  // Standalone End Date without Start Date
  const endOnly = core.filterReservations(sampleRes, [], { dateTo: '2026-11-25' });
  assert.deepEqual(endOnly.map((r: any) => r.id), ['R1']);

  // Eastern digits + normalized Alef
  const bySearch = core.filterReservations(sampleRes, [], { search: 'ابراهيم ٩٠٠١' });
  assert.deepEqual(bySearch.map((r: any) => r.id), ['R1']);

  // Unrelated token returns 0 rows
  assert.equal(core.filterReservations(sampleRes, [], { search: 'RG-9999' }).length, 0);

  // Calendar events strict search
  const calEvents = core.extractReservationCalendarEvents(sampleRes, '2026-11-01', '2026-11-30', { search: 'القحطاني' });
  assert.ok(calEvents.events.length > 0);
  assert.ok(calEvents.events.every((ev: any) => ev.reservationId === 'R2'));
  assert.equal(core.extractReservationCalendarEvents(sampleRes, '2026-11-01', '2026-11-30', { search: 'غير_موجود' }).events.length, 0);

  // Pickups & Returns strict search
  const todaySummary = core.computeTodayMovementsSummary(
    sampleRes,
    new Date('2026-11-20T08:00:00Z').getTime(),
    { todayDate: '2026-11-20', search: 'سوناتا' }
  );
  assert.deepEqual(todaySummary.items.map((item: any) => item.reservation.id), ['R1']);
  assert.equal(
    core.computeTodayMovementsSummary(
      sampleRes,
      new Date('2026-11-20T08:00:00Z').getTime(),
      { todayDate: '2026-11-20', search: 'سبورتاج' }
    ).items.length,
    0
  );

  // Expiry radar strict search
  const nowMs = new Date('2026-11-25T10:00:00Z').getTime();
  const radarHit = core.computeExpiryRadarSummary(
    [{ ...sampleRes[0], endDate: '2026-11-25', endTime: '16:00' }, { ...sampleRes[1], endDate: '2026-11-25', endTime: '16:00' }],
    nowMs,
    { search: 'إبراهيم' }
  );
  assert.deepEqual(radarHit.items.map((x: any) => x.reservation.id), ['R1']);

  // Problems strict search
  const prbList = [
    { id: 'P1', problemNumber: 'PRB-101', reservationNumber: 'RG-9001', customerName: 'إبراهيم الدوسري', description: 'تأخر التسليم', status: 'جديدة', priority: 'مرتفع' },
    { id: 'P2', problemNumber: 'PRB-102', reservationNumber: 'RG-9002', customerName: 'فهد القحطاني', description: 'استبدال المركبة', status: 'مغلقة', priority: 'عادي' }
  ];
  assert.deepEqual(core.filterProblemsList(prbList, { search: '١٠١' }).map((p: any) => p.id), ['P1']);
  assert.equal(core.filterProblemsList(prbList, { search: 'ابراهيم استبدال' }).length, 0);

  // Team Follow-ups strict search
  const fuList = [
    { id: 'F1', reservationNumber: 'RG-9001', customerName: 'إبراهيم', employeeName: 'أحمد', action: 'تأكيد الموعد', notes: 'تم التواصل' },
    { id: 'F2', reservationNumber: 'RG-9002', customerName: 'فهد', employeeName: 'سارة', action: 'متابعة دفع', notes: 'بانتظار السداد' }
  ];
  assert.deepEqual(core.filterTeamFollowUpsList(fuList, { search: 'ابراهيم تواصل' }).map((f: any) => f.id), ['F1']);
  assert.equal(core.filterTeamFollowUpsList(fuList, { search: 'ابراهيم ساره' }).length, 0);
});

test('buildPgSearchCondition builds parameterized TRANSLATE ILIKE tokens safely', () => {
  const params: any[] = [];
  const clause = buildPgSearchCondition(['r.reservation_number', 'r.customer_name'], 'أحمد ٥٠% _', params);
  assert.ok(clause.includes("TRANSLATE(COALESCE(r.reservation_number, '')"));
  assert.ok(clause.includes("ESCAPE '!'"));
  assert.ok(clause.includes(' AND '));
  assert.deepEqual(params, ['%احمد%', '%50!%%', '%!_%']);
});

test('Standalone End Date UI helper & indicator present in reservations.js, datepicker.js, and style.css', () => {
  const resJs = readRepoFile('assets/js/reservations.js');
  const dpJs = readRepoFile('assets/js/datepicker.js');
  const css = readRepoFile('assets/css/style.css');
  assert.ok(resJs.includes('id="res-date-filter-hint"'));
  assert.ok(resJs.includes('id="res-to-standalone-tag"'));
  assert.ok(resJs.includes('updateDateFilterHint'));
  assert.ok(dpJs.includes('rg-dp-range-hint'));
  assert.ok(css.includes('.rg-res-date-field.is-standalone-end-active'));
  assert.ok(css.includes('.rg-date-filter-hint.is-end-only'));
});

test('Call wrap-up shortcuts add/edit/remove/reset works cleanly and allows removing all default shortcuts', () => {
  const initial = core.normalizeCallWrapupShortcutsConfig(null);
  assert.equal(initial.customized, false);
  assert.ok(initial.items.length >= 4);

  // Add a custom shortcut
  const afterAdd = core.upsertCallWrapupShortcut(initial, {
    labelAr: 'تم إرسال رابط السداد',
    labelEn: 'Payment Link Sent',
    suggestedStatus: 'تم الحجز',
    actionTextAr: 'أرسلنا رابط السداد للعميل',
    variant: 'primary'
  });
  assert.equal(afterAdd.customized, true);
  assert.equal(afterAdd.items.length, initial.items.length + 1);
  const customItem = afterAdd.items[afterAdd.items.length - 1];
  assert.equal(customItem.labelAr, 'تم إرسال رابط السداد');

  // Remove EVERY shortcut one by one (including defaults) -> customized empty array stays empty!
  let cur = afterAdd;
  for (const item of afterAdd.items) {
    cur = core.removeCallWrapupShortcut(cur, item.key);
  }
  assert.equal(cur.customized, true);
  assert.equal(cur.items.length, 0);

  // Re-normalizing persisted empty customized list must NOT silently restore defaults
  const rehydrated = core.normalizeCallWrapupShortcutsConfig(JSON.stringify(cur));
  assert.equal(rehydrated.customized, true);
  assert.equal(rehydrated.items.length, 0);

  // Reset restores defaults cleanly
  const reset = core.resetCallWrapupShortcutsConfig();
  assert.equal(reset.customized, false);
  assert.equal(reset.items.length, core.DEFAULT_CALL_WRAPUP_OUTCOMES.length);
});

test('Backend updateSettings enforces Developer-only RBAC for call_wrapup_shortcuts and propagates to all roles', async () => {
  const executor = createSettingsMockExecutor();
  const devSession = makeSession('developer', ['manage_settings', 'view_reservations']);
  const gmSession = makeSession('general_manager', ['manage_settings', 'view_reservations']);
  const agentSession = makeSession('agent', ['view_reservations']);

  // Non-developer (even General Manager with manage_settings) cannot modify call_wrapup_shortcuts
  await assert.rejects(
    () => updateSettings(executor, gmSession, {
      call_wrapup_shortcuts: { customized: true, items: [{ key: 'x', labelAr: 'تجربة' }] }
    }),
    /FORBIDDEN/
  );

  // Developer can add/remove and persist custom shortcuts (removing defaults)
  const customCfg = core.removeCallWrapupShortcut(
    core.upsertCallWrapupShortcut(null, { labelAr: 'تأكيد استلام المطار', suggestedStatus: 'تم التسليم', variant: 'primary' }),
    'callback_later'
  );
  const updated = await updateSettings(executor, devSession, { call_wrapup_shortcuts: customCfg });
  assert.equal(updated.call_wrapup_shortcuts.customized, true);
  assert.ok(updated.call_wrapup_shortcuts.items.some((s: any) => s.labelAr === 'تأكيد استلام المطار'));
  assert.equal(updated.call_wrapup_shortcuts.items.some((s: any) => s.key === 'callback_later'), false);

  // Settings endpoint returns the updated shortcuts
  const fetchedSettings = await getSettings(executor, gmSession);
  assert.ok(fetchedSettings.call_wrapup_shortcuts.items.some((s: any) => s.labelAr === 'تأكيد استلام المطار'));

  // Bootstrap and DeltaSync return callWrapupShortcuts even to Agent role
  const agentBoot = await getAppBootstrap(executor, agentSession, {});
  assert.ok(agentBoot.callWrapupShortcuts);
  assert.ok(agentBoot.callWrapupShortcuts.items.some((s: any) => s.labelAr === 'تأكيد استلام المطار'));
  assert.equal(agentBoot.callWrapupShortcuts.items.some((s: any) => s.key === 'callback_later'), false);

  const delta = await getDeltaSync(executor, agentSession, {});
  assert.equal(delta.changedSettings, true);
  assert.ok(delta.callWrapupShortcuts);
  assert.ok(delta.callWrapupShortcuts.items.some((s: any) => s.labelAr === 'تأكيد استلام المطار'));
});

test('Sandbox api.js enforces strict search and Developer-only call shortcuts sync', async () => {
  const { api } = createSandboxApiHarness();

  // 1. Login as non-developer (agent)
  const agentLogin = await api.callApi('login', { username: 'agent1', password: 'Agent@123' });
  if (agentLogin.success) {
    api.setToken(agentLogin.data.token);
    const forbiddenResp = await api.callApi('updateSettings', {
      call_wrapup_shortcuts: { customized: true, items: [] }
    });
    assert.equal(forbiddenResp.success, false);
    assert.match(String(forbiddenResp.message || ''), /للمبرمج فقط|المبرمج فقط|غير مصرح/);
  }

  // 2. Login as developer
  const devLogin = await api.callApi('login', { username: 'developer', password: 'Dev@123' });
  assert.equal(devLogin.success, true);
  api.setToken(devLogin.data.token);

  const customCfg = core.upsertCallWrapupShortcut(null, {
    labelAr: 'تحويل لقسم VIP',
    suggestedStatus: 'مؤكد',
    variant: 'primary'
  });
  const saveResp = await api.callApi('updateSettings', { call_wrapup_shortcuts: customCfg });
  assert.equal(saveResp.success, true);

  const bootResp = await api.callApi('getAppBootstrap', {});
  assert.equal(bootResp.success, true);
  assert.ok(bootResp.data.callWrapupShortcuts.items.some((x: any) => x.labelAr === 'تحويل لقسم VIP'));

  const deltaResp = await api.callApi('getDeltaSync', {});
  assert.equal(deltaResp.success, true);
  assert.ok(deltaResp.data.callWrapupShortcuts.items.some((x: any) => x.labelAr === 'تحويل لقسم VIP'));

  // Non-existent search query must return 0 reservations & 0 problems in sandbox
  const emptyResSearch = await api.callApi('getReservations', { search: 'zzz_non_existent_query_777', page: 1, pageSize: 25 });
  assert.equal(emptyResSearch.success, true);
  assert.equal(emptyResSearch.data.items.length, 0);

  const emptyPrbSearch = await api.callApi('getProblems', { search: 'zzz_non_existent_query_777' });
  assert.equal(emptyPrbSearch.success, true);
  assert.equal(emptyPrbSearch.data.items.length, 0);
});
