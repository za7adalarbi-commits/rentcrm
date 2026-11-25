import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadCoreAndApi(currentUser: any = { id: 'EMP_1', name: 'Ahmed', role: 'employee' }) {
  const corePath = path.resolve(process.cwd(), 'assets/js/core.js');
  const apiPath = path.resolve(process.cwd(), 'assets/js/api.js');
  const coreCode = fs.readFileSync(corePath, 'utf8');
  const apiCode = fs.readFileSync(apiPath, 'utf8');

  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k)
  };
  const sessionStore = new Map<string, string>();
  const sessionStorageMock = {
    getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
    setItem: (k: string, v: string) => sessionStore.set(k, String(v)),
    removeItem: (k: string) => sessionStore.delete(k)
  };

  const dispatchedEvents: Array<{ type: string; detail: any }> = [];
  const sandbox: any = {
    console,
    Date,
    Math,
    JSON,
    Promise,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
    navigator: { onLine: true },
    CustomEvent: function CustomEvent(type: string, init: any) {
      return { type, detail: init ? init.detail : undefined };
    },
    document: {
      dispatchEvent: (ev: any) => {
        dispatchedEvents.push({ type: ev.type, detail: ev.detail });
      }
    },
    location: { protocol: 'http:', host: 'localhost:3000', pathname: '/', search: '' },
    window: null as any,
    globalThis: null as any
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.RGAuth = {
    getUser: () => currentUser
  };

  vm.createContext(sandbox);
  vm.runInContext(coreCode, sandbox);
  vm.runInContext(apiCode, sandbox);

  return {
    core: sandbox.RGCrmCore,
    api: sandbox.RGApi,
    dispatchedEvents,
    sandbox
  };
}

test('buildReservationQueryPayload strips UI-only keys and preserves backend filter/sort/page params', () => {
  const { core } = loadCoreAndApi();
  const rawState = {
    viewMode: 'all',
    todayFilter: 'all',
    radarFilter: 'all',
    displayMode: 'calendar',
    calendarGranularity: 'month',
    calendarDate: '2026-04-01',
    calendarIncludeCancelled: true,
    calendarFocusDate: '2026-04-12',
    radarWindowHours: 24,
    page: 2,
    pageSize: 50,
    search: '  أحمد  ',
    reservationNumber: '  RG-204  ',
    status: 'مؤكد',
    company: 'يلو',
    branch: 'الرياض',
    priority: 'مرتفع',
    employeeId: 'EMP_2',
    unfollowedOnly: true,
    hasProblemsOnly: true,
    sortBy: 'startDate',
    sortDir: 'asc'
  };

  const payload = core.buildReservationQueryPayload(rawState);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    page: 2,
    pageSize: 50,
    search: 'أحمد',
    reservationNumber: 'RG-204',
    status: 'مؤكد',
    company: 'يلو',
    branch: 'الرياض',
    priority: 'مرتفع',
    employeeId: 'EMP_2',
    dateFrom: '',
    dateTo: '',
    timeField: 'both',
    timeFrom: '',
    timeTo: '',
    unfollowedOnly: true,
    hasProblemsOnly: true,
    overdueUnpaidOnly: false,
    sortBy: 'startDate',
    sortDir: 'asc'
  });

  // buildApiCacheKey stays identical when only UI display keys differ
  const keyA = core.buildApiCacheKey('getReservations', Object.assign({}, payload, { displayMode: 'table', calendarGranularity: 'week' }));
  const keyB = core.buildApiCacheKey('getReservations', Object.assign({}, payload, { displayMode: 'calendar', calendarGranularity: 'month' }));
  assert.equal(keyA, keyB);
});

test('reapplyReservationDeltaToFilteredList rejects non-matching additions, drops non-matching edits, and counts additions/removals', () => {
  const { core } = loadCoreAndApi();
  const baseItems = [
    {
      id: 'RES_1',
      reservationNumber: 'BK-101',
      customerName: 'سارة علي',
      customerPhone: '0501111111',
      companyName: 'يلو',
      branchName: 'الرياض',
      internalStatus: 'مؤكد',
      priority: 'عادي',
      assignedEmployeeIds: ['EMP_1'],
      assignedEmployeeNames: ['أحمد'],
      lastUpdatedAt: '2026-04-10T10:00:00Z'
    },
    {
      id: 'RES_2',
      reservationNumber: 'BK-102',
      customerName: 'سارة محمد',
      customerPhone: '0502222222',
      companyName: 'يلو',
      branchName: 'جدة',
      internalStatus: 'مؤكد',
      priority: 'مرتفع',
      assignedEmployeeIds: ['EMP_1'],
      assignedEmployeeNames: ['أحمد'],
      lastUpdatedAt: '2026-04-10T09:00:00Z'
    }
  ];

  const filters = { status: 'مؤكد', company: 'يلو', search: 'سارة', page: 1, pageSize: 20 };

  // 1) Delta adds a non-matching booking (status=ملغي) and a matching booking (BK-103), while RES_1 is edited to ملغي
  const res1 = core.reapplyReservationDeltaToFilteredList(
    baseItems,
    [
      { ...baseItems[0], internalStatus: 'ملغي', lastUpdatedAt: '2026-04-10T11:00:00Z' },
      {
        id: 'RES_3',
        reservationNumber: 'BK-103',
        customerName: 'سارة خالد',
        companyName: 'يلو',
        internalStatus: 'مؤكد',
        lastUpdatedAt: '2026-04-10T11:05:00Z'
      },
      {
        id: 'RES_4',
        reservationNumber: 'BK-104',
        customerName: 'أحمد يونس',
        companyName: 'ذيب',
        internalStatus: 'مؤكد',
        lastUpdatedAt: '2026-04-10T11:10:00Z'
      }
    ],
    [],
    filters
  );

  assert.deepEqual(Array.from(res1.items, (x: any) => x.id), ['RES_3', 'RES_2']);
  assert.equal(res1.removedCount, 1);
  assert.equal(res1.addedCount, 1);

  // 2) Deletion removes RES_2 cleanly
  const res2 = core.reapplyReservationDeltaToFilteredList(res1.items, [], ['RES_2'], filters);
  assert.deepEqual(Array.from(res2.items, (x: any) => x.id), ['RES_3']);
  assert.equal(res2.removedCount, 1);

  // 3) Re-assigning away from EMP_1 drops row when employeeId='EMP_1' filter is active
  const res3 = core.reapplyReservationDeltaToFilteredList(
    baseItems,
    [{ ...baseItems[0], assignedEmployeeIds: ['EMP_9'], assignedEmployeeNames: ['موظف آخر'] }],
    [],
    { employeeId: 'EMP_1' }
  );
  assert.deepEqual(Array.from(res3.items, (x: any) => x.id), ['RES_2']);
  assert.equal(res3.removedCount, 1);
});

test('filterProblemsList and reapplyProblemDeltaToFilteredList apply status, priority, employeeId, and search consistently', () => {
  const { core } = loadCoreAndApi();
  const problems = [
    {
      id: 'PRB_1',
      problemNumber: 'P-1001',
      reservationId: 'RES_1',
      reservationNumber: 'BK-101',
      customerName: 'خالد الحربي',
      description: 'تأخر استلام السيارة',
      status: 'جديدة',
      priority: 'مرتفع',
      assignedEmployeeIds: ['EMP_1'],
      updatedAt: '2026-04-10T10:00:00Z'
    },
    {
      id: 'PRB_2',
      problemNumber: 'P-1002',
      reservationId: 'RES_2',
      reservationNumber: 'BK-102',
      customerName: 'نايف السالم',
      description: 'استفسار فواتير',
      status: 'جديدة',
      priority: 'عادي',
      assignedEmployeeIds: ['EMP_2'],
      updatedAt: '2026-04-10T09:00:00Z'
    }
  ];

  const filters = { status: 'جديدة', priority: 'مرتفع', employeeId: 'EMP_1', search: 'BK-101' };
  const initialFiltered = core.filterProblemsList(problems, filters);
  assert.deepEqual(Array.from(initialFiltered, (p: any) => p.id), ['PRB_1']);

  // Closing PRB_1 removes it immediately from filtered list; adding non-matching PRB_3 does not inject it
  const afterDelta = core.reapplyProblemDeltaToFilteredList(
    initialFiltered,
    [
      { ...problems[0], status: 'مغلقة', updatedAt: '2026-04-10T11:00:00Z' },
      { ...problems[1], id: 'PRB_3', problemNumber: 'P-1003', priority: 'مرتفع', employeeId: 'EMP_2', assignedEmployeeIds: ['EMP_2'] }
    ],
    [],
    filters
  );
  assert.equal(afterDelta.length, 0);
});

test('filterTeamFollowUpsList and reapplyFollowUpDeltaToFilteredList apply employeeId, status, date, and search filters', () => {
  const { core } = loadCoreAndApi();
  const list = [
    {
      id: 'FU_1',
      reservationId: 'RES_1',
      reservationNumber: 'BK-201',
      customerName: 'فهد القحطاني',
      employeeId: 'EMP_1',
      employeeName: 'أحمد',
      status: 'مؤكد',
      action: 'اتصال بالعميل',
      notes: 'تم التأكيد',
      followUpDate: '2026-04-15',
      createdAt: '2026-04-15T09:00:00Z'
    }
  ];

  const filters = { employeeId: 'EMP_1', status: 'مؤكد', date: '2026-04-15' };
  assert.equal(core.filterTeamFollowUpsList(list, filters).length, 1);

  const afterDelta = core.reapplyFollowUpDeltaToFilteredList(
    list,
    [
      {
        id: 'FU_2',
        reservationId: 'RES_2',
        reservationNumber: 'BK-202',
        customerName: 'سعد',
        employeeId: 'EMP_2',
        status: 'مؤكد',
        followUpDate: '2026-04-15',
        createdAt: '2026-04-15T10:00:00Z'
      },
      {
        id: 'FU_3',
        reservationId: 'RES_3',
        reservationNumber: 'BK-203',
        customerName: 'عمر',
        employeeId: 'EMP_1',
        status: 'مؤكد',
        followUpDate: '2026-04-15',
        createdAt: '2026-04-15T11:00:00Z'
      }
    ],
    ['RES_1'],
    filters
  );

  // RES_1 deleted, FU_2 doesn't match EMP_1, FU_3 matches all filters
  assert.deepEqual(Array.from(afterDelta, (x: any) => x.id), ['FU_3']);
});

test('api.js applyDeltaSyncToCache and applyOptimisticMutation preserve active filter boundaries on cached queries', () => {
  const { api } = loadCoreAndApi({ id: 'EMP_1', name: 'Ahmed', role: 'employee' });

  const confirmedRes = {
    id: 'RES_1',
    reservationNumber: 'BK-501',
    customerName: 'عميل مؤكد',
    companyName: 'يلو',
    internalStatus: 'مؤكد',
    assignedEmployeeIds: ['EMP_1'],
    assignedEmployeeNames: ['Ahmed'],
    lastUpdatedAt: '2026-04-10T08:00:00Z'
  };
  const pendingRes = {
    id: 'RES_2',
    reservationNumber: 'BK-502',
    customerName: 'عميل معلق',
    companyName: 'ذيب',
    internalStatus: 'معلق',
    assignedEmployeeIds: [],
    assignedEmployeeNames: [],
    lastUpdatedAt: '2026-04-10T08:00:00Z'
  };

  // Seed both filtered and unfiltered cached getReservations queries
  api.primeCache('getReservations', { page: 1, pageSize: 20, status: 'مؤكد' }, {
    items: [confirmedRes],
    total: 1,
    page: 1,
    pageSize: 20
  });
  api.primeCache('getReservations', { page: 1, pageSize: 20 }, {
    items: [confirmedRes, pendingRes],
    total: 2,
    page: 1,
    pageSize: 20
  });

  // Seed filtered problems cache (status=جديدة)
  api.primeCache('getProblems', { status: 'جديدة', priority: '', employeeId: '', search: '' }, {
    items: [{
      id: 'PRB_1',
      problemNumber: 'P-1',
      reservationId: 'RES_1',
      reservationNumber: 'BK-501',
      customerName: 'عميل مؤكد',
      description: 'مشكلة',
      status: 'جديدة',
      priority: 'عادي',
      assignedEmployeeIds: ['EMP_1'],
      updatedAt: '2026-04-10T08:00:00Z'
    }]
  });

  // 1) Delta sync brings a new cancelled reservation + a new confirmed reservation
  api.applyDeltaSyncToCache({
    changedReservations: [
      { id: 'RES_3', reservationNumber: 'BK-503', customerName: 'عميل ملغي', companyName: 'ذيب', internalStatus: 'ملغي', lastUpdatedAt: '2026-04-10T09:00:00Z' },
      { id: 'RES_4', reservationNumber: 'BK-504', customerName: 'عميل جديد', companyName: 'يلو', internalStatus: 'مؤكد', lastUpdatedAt: '2026-04-10T09:05:00Z' }
    ]
  });

  const filteredAfterDelta = api.getCachedData('getReservations', { page: 1, pageSize: 20, status: 'مؤكد' }, true);
  assert.ok(filteredAfterDelta);
  assert.deepEqual(Array.from(filteredAfterDelta.items, (r: any) => r.id), ['RES_4', 'RES_1']);
  assert.equal(filteredAfterDelta.total, 2);

  const unfilteredAfterDelta = api.getCachedData('getReservations', { page: 1, pageSize: 20 }, true);
  assert.equal(unfilteredAfterDelta.items.length, 4);

  // 2) Blocked manual transition ('ملغي') is ignored by applyOptimisticMutation, while allowed active status ('تم التسليم') drops from status='مؤكد' filtered cache
  api.applyOptimisticMutation('quickUpdateReservationStatus', { reservationId: 'RES_1', status: 'ملغي' }, { id: 'EMP_1', name: 'Ahmed' });
  const afterBlockedOpt = api.getCachedData('getReservations', { page: 1, pageSize: 20, status: 'مؤكد' }, true);
  assert.deepEqual(Array.from(afterBlockedOpt.items, (r: any) => r.id), ['RES_4', 'RES_1']);

  api.applyOptimisticMutation('quickUpdateReservationStatus', { reservationId: 'RES_1', status: 'تم التسليم' }, { id: 'EMP_1', name: 'Ahmed' });
  const filteredAfterOpt = api.getCachedData('getReservations', { page: 1, pageSize: 20, status: 'مؤكد' }, true);
  assert.deepEqual(Array.from(filteredAfterOpt.items, (r: any) => r.id), ['RES_4']);
  assert.equal(filteredAfterOpt.total, 1);

  const unfilteredAfterOpt = api.getCachedData('getReservations', { page: 1, pageSize: 20 }, true);
  const res1Unfiltered = unfilteredAfterOpt.items.find((r: any) => r.id === 'RES_1');
  assert.equal(res1Unfiltered.internalStatus, 'تم التسليم');

  // 3) Optimistic problem close drops PRB_1 from status=جديدة filtered cache
  api.applyOptimisticMutation('updateProblem', { problemId: 'PRB_1', status: 'مغلقة', priority: 'عادي' }, { id: 'EMP_1', name: 'Ahmed' });
  const prbFilteredAfterOpt = api.getCachedData('getProblems', { status: 'جديدة', priority: '', employeeId: '', search: '' }, true);
  assert.equal(prbFilteredAfterOpt.items.length, 0);
});
