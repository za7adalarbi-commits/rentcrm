import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  INITIAL_SYNC_OVERLAY_STATE,
  formatElapsedSeconds,
  getSyncActionCopy,
  isSyncOverlayVisible,
  reduceSyncOverlayState,
  shouldTrackGlobalSync,
} from '../src/utils/syncOverlayState';

function loadCoreAndApiSandbox() {
  const coreCode = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const apiCode = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');

  const dispatchedEvents: Array<{ name: string; detail: any }> = [];
  const docEvents: Array<{ name: string; detail: any }> = [];
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();

  function CustomEventPoly(this: any, name: string, init?: { detail?: any }) {
    this.type = name;
    this.detail = init && init.detail ? init.detail : null;
  }

  const windowObj: any = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000', pathname: '/', search: '?sandbox=1' },
    CustomEvent: CustomEventPoly,
    RG_APP_CONFIG: { mode: 'sandbox' },
    dispatchEvent(ev: any) {
      dispatchedEvents.push({ name: ev.type || ev.name, detail: ev.detail });
      return true;
    },
    addEventListener() {},
  };

  const documentObj: any = {
    documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
    dispatchEvent(ev: any) {
      docEvents.push({ name: ev.type || ev.name, detail: ev.detail });
      return true;
    },
    addEventListener() {},
  };

  const sandbox: any = {
    window: windowObj,
    document: documentObj,
    localStorage: {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => localStore.set(k, String(v)),
      removeItem: (k: string) => localStore.delete(k),
    },
    sessionStorage: {
      getItem: (k: string) => sessionStore.get(k) ?? null,
      setItem: (k: string, v: string) => sessionStore.set(k, String(v)),
      removeItem: (k: string) => sessionStore.delete(k),
    },
    navigator: { onLine: true },
    CustomEvent: CustomEventPoly,
    RG_APP_CONFIG: { mode: 'sandbox' },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    RegExp,
    Error,
    AbortController: globalThis.AbortController,
  };
  sandbox.globalThis = sandbox;
  windowObj.window = windowObj;

  vm.createContext(sandbox);
  vm.runInContext(coreCode, sandbox);
  windowObj.RGCrmCore = sandbox.RGCrmCore || windowObj.RGCrmCore;
  sandbox.RGAuth = windowObj.RGAuth = {
    getUser: () => ({ id: 'EMP_ADMIN', name: 'مدير النظام', role: 'super_admin', username: 'admin' }),
  };
  vm.runInContext(apiCode, sandbox);

  return {
    core: windowObj.RGCrmCore || sandbox.RGCrmCore,
    api: windowObj.RGApi || sandbox.RGApi,
    dispatchedEvents,
    docEvents,
  };
}

function loadFullGasEnvironment() {
  const gasDir = path.resolve(process.cwd(), 'google-apps-script');
  const orderedFiles = [
    'Utils.gs',
    'Database.gs',
    'Settings.gs',
    'AuditLog.gs',
    'Permissions.gs',
    'Notifications.gs',
    'Auth.gs',
    'Employees.gs',
    'FollowUps.gs',
    'Problems.gs',
    'RentalGateAPI.gs',
    'Reservations.gs',
    'Dashboard.gs',
    'Reports.gs',
    'Export.gs',
    'Triggers.gs',
    'NeonSync.gs',
    'SheetSyncMenu.gs',
    'Code.gs',
  ];

  const propsStore: Record<string, string> = {};
  const cacheStore: Record<string, string> = {};
  const sheets = new Map<string, { name: string; grid: unknown[][] }>();

  function getOrCreateSheet(name: string) {
    if (!sheets.has(name)) sheets.set(name, { name, grid: [] });
    const sh = sheets.get(name)!;
    const api: any = {
      getName: () => sh.name,
      getLastRow: () => sh.grid.length,
      getLastColumn: () => sh.grid.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => Math.max(sh.grid.length, 50),
      getMaxColumns: () => Math.max(sh.grid.reduce((m, r) => Math.max(m, r.length), 0), 40),
      setFrozenRows: () => api,
      setRightToLeft: () => api,
      autoResizeColumns: () => api,
      setColumnWidth: () => api,
      deleteRow: (rowIdx: number) => {
        if (rowIdx >= 1 && rowIdx <= sh.grid.length) sh.grid.splice(rowIdx - 1, 1);
      },
      deleteRows: (rowIdx: number, count: number) => {
        sh.grid.splice(Math.max(0, rowIdx - 1), count);
      },
      appendRow: (row: unknown[]) => {
        sh.grid.push(row.slice());
      },
      clearContents: () => {
        sh.grid = [];
      },
      getRange: (row: number, col: number, numRows = 1, numCols = 1) => {
        const rangeObj: any = {
          setValues: (vals: unknown[][]) => {
            for (let r = 0; r < vals.length; r++) {
              const targetRow = row - 1 + r;
              while (sh.grid.length <= targetRow) sh.grid.push([]);
              for (let c = 0; c < vals[r].length; c++) {
                sh.grid[targetRow][col - 1 + c] = vals[r][c];
              }
            }
            return rangeObj;
          },
          setValue: (val: unknown) => {
            const targetRow = row - 1;
            while (sh.grid.length <= targetRow) sh.grid.push([]);
            sh.grid[targetRow][col - 1] = val;
            return rangeObj;
          },
          getValues: () => {
            const out: unknown[][] = [];
            for (let r = 0; r < numRows; r++) {
              const srcRow = sh.grid[row - 1 + r] || [];
              const rowOut: unknown[] = [];
              for (let c = 0; c < numCols; c++) {
                rowOut.push(srcRow[col - 1 + c] !== undefined ? srcRow[col - 1 + c] : '');
              }
              out.push(rowOut);
            }
            return out;
          },
          getValue: () => {
            const srcRow = sh.grid[row - 1] || [];
            return srcRow[col - 1] !== undefined ? srcRow[col - 1] : '';
          },
          setFontWeight: () => rangeObj,
          setFontColor: () => rangeObj,
          setFontFamily: () => rangeObj,
          setFontSize: () => rangeObj,
          setBackground: () => rangeObj,
          setHorizontalAlignment: () => rangeObj,
          setVerticalAlignment: () => rangeObj,
          setNumberFormat: () => rangeObj,
          setWrap: () => rangeObj,
          setBorder: () => rangeObj,
          setDataValidation: () => rangeObj,
          clearFormat: () => rangeObj,
          clearDataValidations: () => rangeObj,
        };
        return rangeObj;
      },
    };
    return api;
  }

  const spreadsheet: any = {
    getSheetByName: (name: string) => (sheets.has(name) ? getOrCreateSheet(name) : null),
    insertSheet: (name: string) => getOrCreateSheet(name),
    getSheets: () => Array.from(sheets.keys()).map((k) => getOrCreateSheet(k)),
    getSpreadsheetTimeZone: () => 'Asia/Riyadh',
    getId: () => 'MOCK_SS_1',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/MOCK_SS_1/edit',
    deleteSheet: (sh: any) => { if (sh && sh.getName) sheets.delete(sh.getName()); },
    toast: () => {},
  };

  const sandbox: any = {
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Riyadh' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt: string) => ({
        _txt: txt,
        setMimeType() { return this; },
        getContent: () => txt,
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in propsStore ? propsStore[k] : null),
        setProperty: (k: string, v: string) => { propsStore[k] = String(v); },
        setProperties: (obj: Record<string, string>) => Object.assign(propsStore, obj),
        deleteProperty: (k: string) => { delete propsStore[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => (k in cacheStore ? cacheStore[k] : null),
        put: (k: string, v: string) => { cacheStore[k] = String(v); },
        remove: (k: string) => { delete cacheStore[k]; },
        getAll: (keys: string[]) => {
          const out: Record<string, string> = {};
          keys.forEach((k) => { if (k in cacheStore) out[k] = cacheStore[k]; });
          return out;
        },
        putAll: (obj: Record<string, string>) => Object.assign(cacheStore, obj),
        removeAll: (keys: string[]) => keys.forEach((k) => { delete cacheStore[k]; }),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => true,
        releaseLock: () => {},
      }),
    },
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      base64Encode: (inp: unknown) => Buffer.from(typeof inp === 'string' ? inp : (inp as Uint8Array)).toString('base64'),
      base64EncodeWebSafe: (inp: unknown) => Buffer.from(typeof inp === 'string' ? inp : (inp as Uint8Array)).toString('base64url'),
      base64Decode: (b64: string) => Array.from(Buffer.from(b64, 'base64')),
      newBlob: (data: unknown) => ({
        getBytes: () => Array.from(Buffer.from(String(data))),
        getDataAsString: () => Buffer.isBuffer(data) || Array.isArray(data) ? Buffer.from(data as any).toString('utf8') : String(data),
      }),
      gzip: (blob: any) => ({
        getBytes: () => Array.from(Buffer.from(blob.getDataAsString ? blob.getDataAsString() : String(blob))),
      }),
      ungzip: (blob: any) => ({
        getDataAsString: () => Buffer.from(blob.getBytes()).toString('utf8'),
      }),
      computeDigest: (_alg: unknown, val: string) =>
        Array.from(crypto.createHash('sha256').update(String(val)).digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      formatDate: (d: Date, _tz: string, fmt: string) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        if (fmt === 'HH:mm') return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        return d.toISOString();
      },
      getUuid: () => 'UUID_' + Math.random().toString(36).slice(2, 10),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      newDataValidation: () => {
        const b: any = { requireValueInList: () => b, requireDate: () => b, setAllowInvalid: () => b, setHelpText: () => b, build: () => ({}) };
        return b;
      },
      BorderStyle: { SOLID_MEDIUM: 'SOLID_MEDIUM' },
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }), everyMinutes: () => ({ create: () => {} }) }) }),
      deleteTrigger: () => {},
    },
    UrlFetchApp: {
      fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
      fetchAll: (reqs: any[]) => reqs.map(() => ({ getResponseCode: () => 200, getContentText: () => '{}' })),
    },
    console, Date, Math, Number, String, Array, Object, JSON, RegExp, Error,
  };

  vm.createContext(sandbox);
  for (const file of orderedFiles) {
    const code = fs.readFileSync(path.join(gasDir, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }

  function invoke(action: string, token = '', payload: Record<string, unknown> = {}) {
    const res = sandbox.doPost({
      postData: { contents: JSON.stringify({ action, token, payload }) },
    });
    return JSON.parse(res.getContent());
  }

  return { sandbox, invoke, sheets, cacheStore };
}

test('syncOverlayState tracks foreground API syncs, ignores background polling, and manages dismiss lifecycle', () => {
  assert.equal(shouldTrackGlobalSync('syncRentalGate', {}), true);
  assert.equal(shouldTrackGlobalSync('pullReservations', {}), true);
  assert.equal(shouldTrackGlobalSync('syncLocalCache', {}), true);
  assert.equal(shouldTrackGlobalSync('applyUnifiedConnectionSetup', {}), true);
  assert.equal(shouldTrackGlobalSync('importReservationsFromExcel', {}), true);
  assert.equal(shouldTrackGlobalSync('deleteAllReservations', {}), true);
  assert.equal(shouldTrackGlobalSync('bulkReassignEmployeeReservations', {}), true);
  assert.equal(shouldTrackGlobalSync('syncOfflineQueue', {}), true);
  assert.equal(shouldTrackGlobalSync('getDashboard', { showGlobalLoading: true }), true);

  assert.equal(shouldTrackGlobalSync('pullReservations', { silentRefresh: true }), false);
  assert.equal(shouldTrackGlobalSync('syncLocalCache', { backgroundSync: true }), false);
  assert.equal(shouldTrackGlobalSync('getDeltaSync', {}), false);
  assert.equal(shouldTrackGlobalSync('getNotifications', {}), false);
  assert.equal(shouldTrackGlobalSync('getReservationLocks', {}), false);

  const arCopy = getSyncActionCopy('pullReservations', 'ar');
  const enCopy = getSyncActionCopy('pullReservations', 'en');
  assert.match(arCopy.title, /الحجوزات/);
  assert.match(enCopy.title, /Reservations/);

  let state = INITIAL_SYNC_OVERLAY_STATE;
  assert.equal(isSyncOverlayVisible(state), false);

  state = reduceSyncOverlayState(state, { type: 'start', requestId: 'S1', action: 'pullReservations', nowMs: 1000 });
  assert.equal(isSyncOverlayVisible(state), true);
  assert.equal(state.activeTasks.length, 1);

  // Duplicate requestId does not double-count
  state = reduceSyncOverlayState(state, { type: 'start', requestId: 'S1', action: 'pullReservations', nowMs: 1200 });
  assert.equal(state.activeTasks.length, 1);

  // Concurrent second sync task
  state = reduceSyncOverlayState(state, { type: 'start', requestId: 'S2', action: 'syncLocalCache', nowMs: 1500 });
  assert.equal(state.activeTasks.length, 2);

  // Dismiss hides overlay for active batch while tasks finish
  state = reduceSyncOverlayState(state, { type: 'dismiss', nowMs: 2000 });
  assert.equal(isSyncOverlayVisible(state), false);
  assert.equal(state.activeTasks.length, 2);

  // Ending only one task keeps batch dismissed
  state = reduceSyncOverlayState(state, { type: 'end', requestId: 'S1', nowMs: 2500 });
  assert.equal(state.activeTasks.length, 1);
  assert.equal(isSyncOverlayVisible(state), false);

  // Ending last task resets dismissedBatchAt so subsequent sync renders overlay again
  state = reduceSyncOverlayState(state, { type: 'end', requestId: 'S2', nowMs: 3000 });
  assert.equal(state.activeTasks.length, 0);
  assert.equal(isSyncOverlayVisible(state), false);

  state = reduceSyncOverlayState(state, { type: 'start', requestId: 'S3', action: 'syncRentalGate', nowMs: 4000 });
  assert.equal(isSyncOverlayVisible(state), true);

  assert.equal(formatElapsedSeconds(1000, 3500, 'ar'), '2.5 ث');
  assert.equal(formatElapsedSeconds(1000, 14500, 'en'), '13s');
});

test('Sandbox api.js: getTodayAndRadar returns items, nowMs ignored in cache key, delta changedEmployees populated, and rg:syncprogress emits safely', async () => {
  const { core, api, dispatchedEvents } = loadCoreAndApiSandbox();

  // nowMs must not create duplicate orphan cache keys for getTodayAndRadar
  const k1 = core.buildApiCacheKey('', 'tok', 'getTodayAndRadar', { todayDate: '2026-11-20', nowMs: 1000001 });
  const k2 = core.buildApiCacheKey('', 'tok', 'getTodayAndRadar', { todayDate: '2026-11-20', nowMs: 9999999 });
  assert.equal(k1, k2);

  const loginRes = await api.callApi('login', { username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(loginRes.success, true, JSON.stringify(loginRes));
  api.setToken(loginRes.data.token);

  const todayStr = new Date().toISOString().slice(0, 10);
  const trRes = await api.callApi('getTodayAndRadar', { todayDate: todayStr, nowMs: Date.now() });
  assert.equal(trRes.success, true, JSON.stringify(trRes));
  assert.ok(Array.isArray(trRes.data.items), 'getTodayAndRadar must include top-level items array');
  assert.ok(trRes.data.counts && typeof trRes.data.counts.todayTotal === 'number');
  assert.ok(trRes.data.todaySummary && Array.isArray(trRes.data.todaySummary.allItems));
  assert.ok(trRes.data.radarSummary && Array.isArray(trRes.data.radarSummary.allItems));

  // Verify delta sync tracks updated employee metadata in sandbox
  const syncSince = new Date(Date.now() - 5000).toISOString();
  const emps = await api.callApi('getEmployees', {});
  const targetEmp = emps.data.items.find((e: any) => e.id !== 'EMP_ADMIN');
  if (targetEmp) {
    await api.callApi('updateEmployee', {
      id: targetEmp.id,
      name: targetEmp.name + ' (محدث)',
      phone: targetEmp.phone || '0500000000',
    });
    const delta = await api.callApi('getDeltaSync', { updatedAfter: syncSince });
    assert.equal(delta.success, true);
    assert.ok(Array.isArray(delta.data.changedEmployees));
    assert.ok(delta.data.changedEmployees.some((e: any) => e.id === targetEmp.id));
    assert.equal('passwordHash' in delta.data.changedEmployees[0], false);
  }

  // Foreground sync process emits start & end events; silentRefresh does NOT
  dispatchedEvents.length = 0;
  await api.callApi('syncLocalCache', { forceRefresh: true });
  const syncStarts = dispatchedEvents.filter((e) => e.name === 'rg:syncprogress' && e.detail.phase === 'start');
  const syncEnds = dispatchedEvents.filter((e) => e.name === 'rg:syncprogress' && e.detail.phase === 'end');
  assert.equal(syncStarts.length, 1);
  assert.equal(syncStarts[0].detail.action, 'syncLocalCache');
  assert.equal(syncEnds.length, 1);

  dispatchedEvents.length = 0;
  await api.callApi('syncLocalCache', { silentRefresh: true, forceRefresh: true });
  await api.callApi('getDeltaSync', { updatedAfter: syncSince });
  assert.equal(dispatchedEvents.filter((e) => e.name === 'rg:syncprogress').length, 0);
});

test('GAS Backend: all 12 new handlers + Today/Radar + Filters + Activity + Handover settings work end-to-end in strict ES5 VM', () => {
  const { invoke } = loadFullGasEnvironment();

  const ping = invoke('ping');
  assert.equal(ping.success, true);

  const login = invoke('login', '', {
    username: 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  });
  assert.equal(login.success, true, JSON.stringify(login));
  const token = login.data.token;

  // 1. Settings include handover_settings
  const settingsRes = invoke('getSettings', token);
  assert.equal(settingsRes.success, true);
  assert.ok('handover_settings' in settingsRes.data);

  // 2. Announcements CRUD
  const savedAnn = invoke('saveAnnouncement', token, {
    title: 'تعميم اختبار',
    message: 'يرجى متابعة حجوزات اليوم بدقة',
    tone: 'warning',
    isPinned: true,
  });
  assert.equal(savedAnn.success, true, savedAnn.message);
  assert.ok(savedAnn.data.announcement && savedAnn.data.announcement.id);
  const savedAnnId = savedAnn.data.announcement.id;
  const annList = invoke('getAnnouncements', token);
  assert.equal(annList.success, true);
  assert.equal(annList.data.items.length, 1);
  const delAnn = invoke('deleteAnnouncement', token, { id: savedAnnId });
  assert.equal(delAnn.success, true);
  assert.equal(invoke('getAnnouncements', token).data.items.length, 0);

  // 3. Delegations CRUD
  const emps = invoke('getEmployees', token);
  const agent = emps.data.items.find((e: any) => e.role === 'agent') || emps.data.items[0];
  const savedDel = invoke('saveDelegation', token, {
    delegateEmployeeId: agent.id,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    reason: 'مناوبة',
  });
  assert.equal(savedDel.success, true, savedDel.message);
  const dels = invoke('getDelegations', token);
  assert.equal(dels.success, true);
  assert.ok(dels.data.items.length >= 1);
  const revDel = invoke('revokeDelegation', token, { id: savedDel.data.delegation.id });
  assert.equal(revDel.success, true);

  // 4. Import reservations with pinned/no-answer/today dates, then test getTodayAndRadar & locks & filters & delta
  const todayStr = new Date().toISOString().slice(0, 10);
  const soonIso = new Date(Date.now() + 2 * 3600000).toISOString();
  const imp = invoke('importReservationsFromExcel', token, {
    rows: [
      {
        reservationNumber: 'GAS-1001',
        customerName: 'عميل تجريبي',
        customerPhone: '0501112233',
        companyName: 'بدجت',
        branchName: 'الرياض',
        carName: 'إلنترا',
        startDate: todayStr,
        startTime: '11:00',
        endDate: soonIso.slice(0, 10),
        endTime: soonIso.slice(11, 16),
        internalStatus: 'تم التسليم',
        paymentStatus: 'غير مدفوع',
        totalAmount: 500,
        paidAmount: 0,
      },
    ],
  });
  assert.equal(imp.success, true);

  const listAll = invoke('getReservations', token, { page: 1, pageSize: 50 });
  assert.equal(listAll.success, true);
  assert.ok(listAll.data.items.length >= 1);
  const resId = listAll.data.items[0].id;

  // Test Today & Radar endpoint
  const tr = invoke('getTodayAndRadar', token, { todayDate: todayStr, nowMs: Date.now() });
  assert.equal(tr.success, true);
  assert.ok(Array.isArray(tr.data.items));
  assert.ok(tr.data.counts.todayTotal >= 1);

  // Test Reservation Locks
  const acq = invoke('acquireReservationLock', token, { reservationId: resId, mode: 'editing' });
  assert.equal(acq.success, true);
  const locks = invoke('getReservationLocks', token);
  assert.equal(locks.success, true);
  assert.ok(locks.data.items.some((l: any) => l.reservationId === resId));
  const rel = invoke('releaseReservationLock', token, { reservationId: resId });
  assert.equal(rel.success, true);

  // Test getDeltaSync
  const delta = invoke('getDeltaSync', token, { updatedAfter: new Date(Date.now() - 60000).toISOString() });
  assert.equal(delta.success, true);
  assert.ok(Array.isArray(delta.data.changedReservations));
  assert.ok(delta.data.todayRadarCounts && typeof delta.data.todayRadarCounts.todayTotal === 'number');

  // Test Activity Logs date/search filters
  const logs = invoke('getActivityLogs', token, { dateFrom: todayStr, dateTo: todayStr, search: '' });
  assert.equal(logs.success, true);
  assert.ok(Array.isArray(logs.data.items));

  // Test getReservations extended filters (timeFrom, hasExtensions)
  const timeFiltered = invoke('getReservations', token, { timeFrom: '10:00', timeTo: '12:00' });
  assert.equal(timeFiltered.success, true);
  assert.ok(timeFiltered.data.items.some((r: any) => r.id === resId));
});
