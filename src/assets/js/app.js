/**
 * RENTAL GATE CRM — Main Application Controller, Routing, i18n, Theme & Notifications
 */
(function (root) {
  'use strict';

  var PREFS_KEY = 'rg_crm_user_prefs';
  var UI_SIMP_STORAGE_KEY = 'rg_crm_ui_simplification_v1';
  var ROUTE_FILTERS_STORAGE_KEY = 'rg_crm_route_filters_v1';
  var VALID_ROUTES = ['dashboard', 'reservations', 'my-followups', 'team-followups', 'problems', 'reports', 'employees', 'activity', 'settings'];

  function saveRouteFilters(userOverride) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var u = userOverride || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
      var uid = u && u.id ? String(u.id).trim() : '';
      if (!uid) return;
      var payload = { userId: uid, filters: {} };
      if (state.dashboard && typeof state.dashboard === 'object') {
        payload.filters.dashboard = {
          range: state.dashboard.range || '30d',
          dateFrom: state.dashboard.dateFrom || '',
          dateTo: state.dashboard.dateTo || ''
        };
      }
      if (state.reservations && typeof state.reservations === 'object') {
        var r = state.reservations;
        var resFilters = (root.RGCrmCore && root.RGCrmCore.buildReservationQueryPayload)
          ? root.RGCrmCore.buildReservationQueryPayload(r)
          : {
              search: r.search || '',
              reservationNumber: r.reservationNumber || '',
              company: r.company || '',
              branch: r.branch || '',
              status: r.status || '',
              employeeId: r.employeeId || '',
              priority: r.priority || '',
              dateFrom: r.dateFrom || '',
              dateTo: r.dateTo || '',
              timeField: r.timeField || 'both',
              timeFrom: r.timeFrom || '',
              timeTo: r.timeTo || '',
              unfollowedOnly: Boolean(r.unfollowedOnly),
              hasProblemsOnly: Boolean(r.hasProblemsOnly),
              overdueUnpaidOnly: Boolean(r.overdueUnpaidOnly),
              sortBy: r.sortBy || 'sourceOrder',
              sortDir: (!r.sortBy || r.sortBy === 'sourceOrder') ? (r.sortDir === 'desc' ? 'desc' : 'asc') : (r.sortDir === 'asc' ? 'asc' : 'desc'),
              page: Math.max(1, Number(r.page || 1)),
              pageSize: Math.max(1, Number(r.pageSize || 20))
            };
        payload.filters.reservations = Object.assign(resFilters, {
          explicitSort: Boolean(r.explicitSort),
          viewMode: r.viewMode || 'all',
          radarFilter: r.radarFilter || 'all',
          radarSearch: r.radarSearch || '',
          todayFilter: r.todayFilter || 'all',
          todaySearch: r.todaySearch || '',
          todayTimeFrom: r.todayTimeFrom || '',
          todayTimeTo: r.todayTimeTo || '',
          todayCalendarEventFilter: r.todayCalendarEventFilter || 'all',
          todayCalendarSearch: r.todayCalendarSearch || '',
          todayCalendarAnchorDate: r.todayCalendarAnchorDate || '',
          pullPreset: r.pullPreset || 'all',
          pullFrom: r.pullFrom || '',
          pullTo: r.pullTo || ''
        });
      }
      if (state.problems && typeof state.problems === 'object') {
        payload.filters.problems = {
          status: state.problems.status || '',
          priority: state.problems.priority || '',
          employeeId: state.problems.employeeId || '',
          search: state.problems.search || ''
        };
      }
      if (state.teamFollowUps && typeof state.teamFollowUps === 'object') {
        payload.filters.teamFollowUps = {
          employeeId: state.teamFollowUps.employeeId || '',
          status: state.teamFollowUps.status || '',
          date: state.teamFollowUps.date || ''
        };
      }
      if (state.myFollowUps && typeof state.myFollowUps === 'object') {
        payload.filters.myFollowUps = {
          tab: state.myFollowUps.tab === 'mentions' ? 'mentions' : 'assigned'
        };
      }
      if (state.reports && typeof state.reports === 'object') {
        payload.filters.reports = {
          reportType: state.reports.reportType || 'all_reservations',
          dateFrom: state.reports.dateFrom || '',
          dateTo: state.reports.dateTo || '',
          employeeId: state.reports.employeeId || '',
          company: state.reports.company || '',
          branch: state.reports.branch || ''
        };
      }
      sessionStorage.setItem(ROUTE_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch (_eRf) {}
  }

  function restoreRouteFilters(user) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var uid = user && user.id ? String(user.id).trim() : '';
      if (!uid) return;
      var raw = sessionStorage.getItem(ROUTE_FILTERS_STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.userId !== uid || !parsed.filters || typeof parsed.filters !== 'object') return;
      var f = parsed.filters;
      if (f.dashboard && typeof f.dashboard === 'object' && !state.dashboard) {
        state.dashboard = Object.assign({ range: '30d', dateFrom: '', dateTo: '' }, f.dashboard);
      }
      if (f.reservations && typeof f.reservations === 'object' && !state.reservations) {
        var restoredResFilters = Object.assign({}, f.reservations);
        if (!restoredResFilters.sortBy || (restoredResFilters.sortBy === 'lastUpdatedAt' && !restoredResFilters.explicitSort)) {
          restoredResFilters.sortBy = 'sourceOrder';
          restoredResFilters.sortDir = 'asc';
        }
        if (!restoredResFilters.viewMode || restoredResFilters.viewMode === 'active') {
          restoredResFilters.viewMode = 'all';
        }
        state.reservations = restoredResFilters;
      }
      if (f.problems && typeof f.problems === 'object' && !state.problems) {
        state.problems = Object.assign({ status: '', priority: '', employeeId: '', search: '' }, f.problems);
      }
      if (f.teamFollowUps && typeof f.teamFollowUps === 'object' && !state.teamFollowUps) {
        state.teamFollowUps = Object.assign({ employeeId: '', status: '', date: '' }, f.teamFollowUps);
      }
      if (f.myFollowUps && typeof f.myFollowUps === 'object' && !state.myFollowUps) {
        state.myFollowUps = Object.assign({ tab: 'assigned' }, f.myFollowUps);
      }
      if (f.reports && typeof f.reports === 'object' && !state.reports) {
        state.reports = Object.assign({ reportType: 'all_reservations', rows: [] }, f.reports);
      }
    } catch (_eRfLoad) {}
  }

  function clearRouteFiltersStorage() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(ROUTE_FILTERS_STORAGE_KEY);
      }
    } catch (_eRfClr) {}
  }

  var vendorScriptPromises = {};

  function escapeHtml(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function assetUrl(rel) {
    if (root.RGCrmCore && root.RGCrmCore.resolveAssetUrl) {
      return root.RGCrmCore.resolveAssetUrl(rel, root.__RG_BASE_URL__);
    }
    return './' + String(rel || '').replace(/^\/+/, '');
  }

  function loadVendorScript(rel) {
    var rawUrl = assetUrl(rel);
    var url = (root.RGCrmCore && root.RGCrmCore.buildCacheBustedUrl)
      ? root.RGCrmCore.buildCacheBustedUrl(rawUrl, root.__RG_BUILD_VERSION__)
      : rawUrl;
    if (vendorScriptPromises[url]) return vendorScriptPromises[url];
    vendorScriptPromises[url] = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-rg-vendor="' + rel + '"]');
      if (existing) {
        if (existing.getAttribute('data-loaded') === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () {
          delete vendorScriptPromises[url];
          reject(new Error('تعذر تحميل المكتبة: ' + rel));
        }, { once: true });
        return;
      }
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-rg-vendor', rel);
      s.onload = function () {
        s.setAttribute('data-loaded', 'true');
        resolve();
      };
      s.onerror = function () {
        delete vendorScriptPromises[url];
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('تعذر تحميل المكتبة: ' + rel));
      };
      document.head.appendChild(s);
    });
    return vendorScriptPromises[url];
  }

  root.RGLoadVendorScript = loadVendorScript;

  function ensureChartLoaded() {
    if (root.Chart) return Promise.resolve();
    return loadVendorScript('assets/vendor/chart.umd.min.js').then(function () {
      if (!root.Chart) throw new Error('تعذر تحميل مكتبة الرسوم البيانية (Chart.js).');
    });
  }
  root.RGEnsureChartLoaded = ensureChartLoaded;

  function resolveInitialRoute() {
    var redirected = '';
    try {
      redirected = sessionStorage.getItem('rg_crm_redirect_route') || '';
      if (redirected) sessionStorage.removeItem('rg_crm_redirect_route');
    } catch (e) {}
    var rawHash = window.location.hash || (redirected ? '#' + redirected : '');
    if (String(rawHash).toLowerCase().indexOf('inactive-reservations') !== -1) {
      rawHash = '#reservations';
    }
    if (root.RGCrmCore && root.RGCrmCore.resolveRouteFromLocation) {
      return root.RGCrmCore.resolveRouteFromLocation(
        window.location.pathname,
        rawHash,
        window.location.search,
        root.__RG_BASE_URL__ || '/',
        VALID_ROUTES,
        'dashboard'
      );
    }
    return 'dashboard';
  }

  function getDefaultSystemTheme() {
    try {
      return (root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (_e2) {
      return 'light';
    }
  }

  function getUserPrefsStorageKey(user) {
    var uid = user && user.id ? String(user.id).trim() : '';
    return uid ? ('rg_crm_user_prefs_u_' + uid) : PREFS_KEY;
  }

  function loadPerUserPrefs(user) {
    var uid = user && user.id ? String(user.id).trim() : '';
    if (!uid) return {};
    try {
      var raw = localStorage.getItem('rg_crm_user_prefs_u_' + uid);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_e) {
      return {};
    }
  }

  function loadInitialPrefs() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    } catch (_e) {
      saved = {};
    }
    var resolvedTheme = (saved.theme === 'dark' || saved.theme === 'light') ? saved.theme : getDefaultSystemTheme();
    var normTimeFmt = (root.RGCrmCore && root.RGCrmCore.normalizeTimeFormat)
      ? root.RGCrmCore.normalizeTimeFormat(saved.timeFormat)
      : (saved.timeFormat === '12h' ? '12h' : '24h');
    var normNavPos = (root.RGCrmCore && root.RGCrmCore.normalizeSidebarPosition)
      ? root.RGCrmCore.normalizeSidebarPosition(saved.sidebarPosition)
      : ((saved.sidebarPosition === 'top' || saved.sidebarPosition === 'bottom') ? saved.sidebarPosition : 'side');
    var normTzMode = (root.RGCrmCore && root.RGCrmCore.normalizeTimezoneMode)
      ? root.RGCrmCore.normalizeTimezoneMode(saved.timezoneMode)
      : ((saved.timezoneMode === 'sa' || saved.timezoneMode === 'eg') ? saved.timezoneMode : 'both');
    var normResView = (root.RGCrmCore && root.RGCrmCore.normalizeReservationsDisplayMode)
      ? root.RGCrmCore.normalizeReservationsDisplayMode(saved.reservationsDisplayMode)
      : (saved.reservationsDisplayMode === 'calendar' ? 'calendar' : 'table');
    var normCalGran = (root.RGCrmCore && root.RGCrmCore.normalizeCalendarGranularity)
      ? root.RGCrmCore.normalizeCalendarGranularity(saved.calendarGranularity)
      : ((saved.calendarGranularity === 'day' || saved.calendarGranularity === 'month') ? saved.calendarGranularity : 'week');
    return {
      lang: saved.lang === 'en' ? 'en' : 'ar',
      theme: resolvedTheme,
      sidebarCollapsed: Boolean(saved.sidebarCollapsed),
      timeFormat: normTimeFmt,
      sidebarPosition: normNavPos,
      timezoneMode: normTzMode,
      reservationsDisplayMode: normResView,
      calendarGranularity: normCalGran
    };
  }

  function normalizeUiSimpFallback(raw) {
    if (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings) {
      return root.RGCrmCore.normalizeUiSimplificationSettings(raw);
    }
    var obj = (raw && typeof raw === 'object') ? raw : {};
    var out = Object.assign({}, obj, {
      preset: obj.preset || 'full',
      hideSecondaryCarMeta: Boolean(obj.hideSecondaryCarMeta),
      hideCustomerContactExtras: Boolean(obj.hideCustomerContactExtras),
      hideFinancialBreakdown: Boolean(obj.hideFinancialBreakdown),
      hideDrawerCharts: Boolean(obj.hideDrawerCharts),
      hideDashboardRadar: Boolean(obj.hideDashboardRadar),
      hideDashboardHeatmap: Boolean(obj.hideDashboardHeatmap)
    });
    return out;
  }

  function loadUiSimplification() {
    try {
      var raw = localStorage.getItem(UI_SIMP_STORAGE_KEY);
      return normalizeUiSimpFallback(raw ? JSON.parse(raw) : {});
    } catch (_e) {
      return normalizeUiSimpFallback({});
    }
  }

  var LAYOUT_PREFS_STORAGE_KEY = 'rg_crm_layout_prefs_v1';

  function getLayoutStorageKey(user) {
    var uid = user && user.id ? String(user.id).trim() : '';
    return uid ? ('rg_crm_layout_prefs_u_' + uid) : LAYOUT_PREFS_STORAGE_KEY;
  }

  function normalizeLayoutPrefsFallback(raw) {
    if (root.RGCrmCore && root.RGCrmCore.normalizeUserLayoutPrefs) {
      return root.RGCrmCore.normalizeUserLayoutPrefs(raw);
    }
    var obj = (raw && typeof raw === 'object') ? raw : {};
    var rt = String(obj.theme || '').trim().toLowerCase();
    var rl = String(obj.lang || '').trim().toLowerCase();
    return {
      navOrder: Array.isArray(obj.navOrder) ? obj.navOrder.slice() : [],
      hiddenRoutes: Array.isArray(obj.hiddenRoutes) ? obj.hiddenRoutes.slice() : [],
      dashOrder: Array.isArray(obj.dashOrder) ? obj.dashOrder.slice() : [],
      dashHidden: Array.isArray(obj.dashHidden) ? obj.dashHidden.slice() : [],
      timeFormat: obj.timeFormat === '12h' ? '12h' : '24h',
      sidebarPosition: (obj.sidebarPosition === 'top' || obj.sidebarPosition === 'bottom') ? obj.sidebarPosition : 'side',
      timezoneMode: (obj.timezoneMode === 'sa' || obj.timezoneMode === 'eg') ? obj.timezoneMode : 'both',
      reservationsDisplayMode: obj.reservationsDisplayMode === 'calendar' ? 'calendar' : 'table',
      calendarGranularity: (obj.calendarGranularity === 'day' || obj.calendarGranularity === 'month') ? obj.calendarGranularity : 'week',
      theme: (rt === 'dark' || rt === 'light') ? rt : '',
      lang: (rl === 'ar' || rl === 'en') ? rl : '',
      sidebarCollapsed: Boolean(obj.sidebarCollapsed === true || obj.sidebarCollapsed === 'true')
    };
  }

  function loadLayoutPrefs(user) {
    try {
      var key = getLayoutStorageKey(user);
      var raw = localStorage.getItem(key);
      if (!raw && (!user || !user.id)) {
        raw = localStorage.getItem(LAYOUT_PREFS_STORAGE_KEY);
      }
      return normalizeLayoutPrefsFallback(raw ? JSON.parse(raw) : {});
    } catch (_e) {
      return normalizeLayoutPrefsFallback({});
    }
  }

  function normalizeHandoverSettingsSafe(raw) {
    if (root.RGCrmCore && root.RGCrmCore.normalizeHandoverSettings) {
      return root.RGCrmCore.normalizeHandoverSettings(raw);
    }
    var obj = (raw && typeof raw === 'object') ? raw : {};
    return {
      defaultPreset: obj.defaultPreset || '8h',
      defaultTimeFrom: obj.defaultTimeFrom || '',
      defaultTimeTo: obj.defaultTimeTo || '',
      includeTodayMovements: obj.includeTodayMovements !== false,
      includePending: obj.includePending !== false,
      includeClosed: obj.includeClosed !== false,
      includeOpenProblems: obj.includeOpenProblems !== false,
      includeExpiring24h: obj.includeExpiring24h !== false,
      autoIncludeNotes: obj.autoIncludeNotes !== false
    };
  }

  var state = {
    route: resolveInitialRoute(),
    prefs: loadInitialPrefs(),
    uiSimplification: loadUiSimplification(),
    roleUiDefaults: {},
    previewSession: null,
    layoutPrefs: loadLayoutPrefs(null),
    notifications: { items: [], unreadCount: 0 },
    announcements: [],
    activeLocks: [],
    handoverSettings: normalizeHandoverSettingsSafe({}),
    callWrapupShortcutsConfig: null,
    lastDeltaSyncAt: '',
    offlineQueue: { count: 0, items: [] },
    deferredInstallPrompt: null,
    dismissedAnnIds: {},
    employees: {
      items: [],
      rolePresets: [],
      customPermissions: [],
      loading: false,
      loaded: false,
      error: '',
      lastUpdatedAt: ''
    }
  };
  var lastOpenCallInfo = null;
  var PREVIEW_SESSION_STORAGE_KEY = 'rg_crm_preview_role_v1';
  var activeUnsavedGuard = null;
  var authPreviewBridgeInstalled = false;
  var routeRenderSeq = 0;
  var activeActionLocks = {};
  var autoRefreshTimer = null;
  var deltaSyncTimer = null;
  var sseSource = null;
  var sseReconnectTimer = null;
  var deltaDebounceTimer = null;
  var autoRefreshListenersBound = false;
  var isAutoRefreshInFlight = false;
  var isDeltaSyncInFlight = false;
  var lastHiddenAt = 0;
  var lastFingerprints = { notifications: '', routes: {}, announcements: '', locks: '' };
  var employeeSubscribers = [];
  var tabInstanceId = 'TAB_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  root.__RG_TAB_ID__ = tabInstanceId;
  var syncDiagnostics = [];
  var sseConnected = false;
  var sseErrorCount = 0;
  var consecutiveSyncErrors = 0;
  var networkDegraded = false;
  var lastSyncVersion = 0;
  var lastVersionCheckAt = '';
  var lastCheckedRemoteVersion = '';
  var lastUpdateStatus = 'idle';
  var isVersionCheckInFlight = false;
  var isUpdateReloadInFlight = false;
  var versionCheckTimer = null;
  var pendingUpdateDeferTimer = null;
  var notifiedUnsavedUpdateVer = '';
  var syncBroadcastChannel = null;
  var BC_PING_KEY = 'rg_crm_bc_ping';
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncBroadcastChannel = new BroadcastChannel('rg_crm_sync_v1');
    }
  } catch (_bcErr) {
    syncBroadcastChannel = null;
  }

  function broadcastTabSync(detail) {
    try {
      var msg = {
        type: 'rg_crm_sync',
        originTabId: tabInstanceId,
        action: (detail && detail.action) || '',
        reservationId: (detail && detail.reservationId) || '',
        scopes: (detail && Array.isArray(detail.scopes)) ? detail.scopes : [],
        at: Date.now()
      };
      if (syncBroadcastChannel) {
        syncBroadcastChannel.postMessage(msg);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BC_PING_KEY, JSON.stringify(msg));
      }
    } catch (_e) {}
  }

  function handleSiblingTabMessage(msg) {
    if (!msg || msg.originTabId === tabInstanceId) return;
    if (Array.isArray(msg.scopes) && msg.scopes.length > 0 && root.RGApi) {
      if (typeof root.RGApi.markScopesStale === 'function') root.RGApi.markScopesStale(msg.scopes);
      else if (typeof root.RGApi.clearCache === 'function') root.RGApi.clearCache(msg.scopes);
    }
    scheduleDebouncedDeltaSync();
  }

  function getEmployeesState() {
    var emp = state.employees || {};
    return {
      items: Array.isArray(emp.items) ? emp.items.slice() : [],
      rolePresets: Array.isArray(emp.rolePresets) ? emp.rolePresets.slice() : [],
      customPermissions: Array.isArray(emp.customPermissions) ? emp.customPermissions.slice() : [],
      loading: Boolean(emp.loading),
      loaded: Boolean(emp.loaded),
      error: String(emp.error || ''),
      lastUpdatedAt: String(emp.lastUpdatedAt || '')
    };
  }

  function notifyEmployeesSubscribers() {
    var snapshot = getEmployeesState();
    employeeSubscribers.slice().forEach(function (listener) {
      try {
        if (typeof listener === 'function') listener(snapshot);
      } catch (e) {}
    });
  }

  function subscribeEmployees(listener) {
    if (typeof listener !== 'function') return function () {};
    employeeSubscribers.push(listener);
    return function unsubscribe() {
      employeeSubscribers = employeeSubscribers.filter(function (fn) { return fn !== listener; });
    };
  }

  function setEmployeesState(patch) {
    if (!patch || typeof patch !== 'object') return getEmployeesState();
    state.employees = Object.assign({}, state.employees, patch);
    notifyEmployeesSubscribers();
    return getEmployeesState();
  }

  function syncEmployeesStateFromPayload(data) {
    if (!data || typeof data !== 'object') return getEmployeesState();
    var nextPatch = {
      loading: false,
      loaded: true,
      error: '',
      lastUpdatedAt: new Date().toISOString()
    };
    if (Array.isArray(data.items)) nextPatch.items = data.items.slice();
    if (data.rolePresets !== undefined) {
      nextPatch.rolePresets = (root.RGCrmCore && root.RGCrmCore.normalizeRolePresets)
        ? root.RGCrmCore.normalizeRolePresets(data.rolePresets)
        : (Array.isArray(data.rolePresets) ? data.rolePresets.slice() : []);
    }
    if (Array.isArray(data.customPermissions)) {
      nextPatch.customPermissions = data.customPermissions.slice();
    }
    return setEmployeesState(nextPatch);
  }

  function resetEmployeesState() {
    state.employees = {
      items: [],
      rolePresets: [],
      customPermissions: [],
      loading: false,
      loaded: false,
      error: '',
      lastUpdatedAt: ''
    };
    notifyEmployeesSubscribers();
  }

  async function loadEmployeesState(opts) {
    var reqOpts = opts && typeof opts === 'object' ? opts : {};
    if (!reqOpts.silent) {
      setEmployeesState({ loading: true, error: '' });
    }
    var res = await root.RGApi.callApi('getEmployees', reqOpts.silent ? { silentRefresh: true } : {});
    if (!res || !res.success) {
      var errMsg = (res && res.message) || 'تعذر تحميل قائمة الموظفين.';
      setEmployeesState({ loading: false, error: errMsg });
      return res || { success: false, message: errMsg };
    }
    syncEmployeesStateFromPayload(res.data || {});
    return res;
  }

  async function deleteEmployeeFromState(empId, currentUser) {
    var targetId = String(empId || '').trim();
    if (!targetId) return { success: false, message: 'معرّف الموظف غير صالح.' };

    var prevItems = (state.employees && Array.isArray(state.employees.items)) ? state.employees.items.slice() : [];
    var nextItems = prevItems.filter(function (emp) { return emp && emp.id !== targetId; });

    setEmployeesState({
      items: nextItems,
      lastUpdatedAt: new Date().toISOString()
    });

    if (root.RGApi && root.RGApi.applyOptimisticMutation) {
      root.RGApi.applyOptimisticMutation('deleteEmployee', { employeeId: targetId }, currentUser);
    }

    try {
      var res = await root.RGApi.callApi('deleteEmployee', {
        employeeId: targetId,
        _keepOptimisticCache: true
      });
      if (!res || !res.success) {
        setEmployeesState({ items: prevItems });
        if (root.RGApi && root.RGApi.invalidateScopes) {
          root.RGApi.invalidateScopes(['employees']);
        }
        return res || { success: false, message: 'تعذر حذف الموظف.' };
      }
      if (res.data && Array.isArray(res.data.items)) {
        syncEmployeesStateFromPayload(res.data);
      }
      if (root.RGApi && root.RGApi.invalidateScopes) {
        root.RGApi.invalidateScopes(['employees', 'reservations', 'problems', 'dashboard', 'activity', 'reports']);
      }
      refreshNotifications({ silent: true }).catch(function () {});
      return res;
    } catch (err) {
      setEmployeesState({ items: prevItems });
      return { success: false, message: (err && err.message) || 'تعذر الاتصال بالخادم أثناء حذف الموظف.' };
    }
  }

  async function toggleEmployeeStatusInState(empId, nextStatus, currentUser) {
    var targetId = String(empId || '').trim();
    if (!targetId) return { success: false, message: 'معرّف الموظف غير صالح.' };

    var prevItems = (state.employees && Array.isArray(state.employees.items)) ? state.employees.items.slice() : [];
    var nowIso = new Date().toISOString();
    var nextItems = prevItems.map(function (emp) {
      return (emp && emp.id === targetId) ? Object.assign({}, emp, { status: nextStatus, updatedAt: nowIso }) : emp;
    });

    setEmployeesState({
      items: nextItems,
      lastUpdatedAt: nowIso
    });

    if (root.RGApi && root.RGApi.applyOptimisticMutation) {
      root.RGApi.applyOptimisticMutation('disableEmployee', {
        employeeId: targetId,
        status: nextStatus
      }, currentUser);
    }

    try {
      var res = await root.RGApi.callApi('disableEmployee', {
        employeeId: targetId,
        status: nextStatus,
        _keepOptimisticCache: true
      });
      if (!res || !res.success) {
        setEmployeesState({ items: prevItems });
        return res || { success: false, message: 'تعذر تحديث حالة الموظف.' };
      }
      return res;
    } catch (err) {
      setEmployeesState({ items: prevItems });
      return { success: false, message: (err && err.message) || 'تعذر الاتصال بالخادم أثناء تحديث حالة الموظف.' };
    }
  }

  function upsertEmployeeInState(employeeObj) {
    if (!employeeObj || typeof employeeObj !== 'object' || !employeeObj.id) return getEmployeesState();
    var prevItems = (state.employees && Array.isArray(state.employees.items)) ? state.employees.items.slice() : [];
    var foundIdx = prevItems.findIndex(function (emp) { return emp && emp.id === employeeObj.id; });
    var nextItems = prevItems.slice();
    if (foundIdx >= 0) {
      nextItems[foundIdx] = Object.assign({}, prevItems[foundIdx], employeeObj);
    } else {
      nextItems.push(employeeObj);
    }
    return setEmployeesState({
      items: nextItems,
      loaded: true,
      error: '',
      lastUpdatedAt: new Date().toISOString()
    });
  }

  function removeEmployeeLocal(empId) {
    var targetId = String(empId || '').trim();
    if (!targetId) return getEmployeesState();
    var prevItems = (state.employees && Array.isArray(state.employees.items)) ? state.employees.items.slice() : [];
    var nextItems = prevItems.filter(function (emp) { return emp && emp.id !== targetId; });
    return setEmployeesState({
      items: nextItems,
      lastUpdatedAt: new Date().toISOString()
    });
  }

  function computeFingerprintSafe(data) {
    if (root.RGCrmCore && root.RGCrmCore.computeDataFingerprint) {
      return root.RGCrmCore.computeDataFingerprint(data);
    }
    return '';
  }

  var uiActionSpamState = { timestamps: [], signatures: {} };

  function checkActionSpam(action, signature, opts) {
    var act = String(action || '').trim();
    if (!act || !root.RGCrmCore || typeof root.RGCrmCore.evaluateSpamGuard !== 'function') {
      return { allowed: true, reason: '', waitMs: 0 };
    }
    var o = opts || {};
    var sig = String(signature || act);
    var res = root.RGCrmCore.evaluateSpamGuard(uiActionSpamState, act, sig, {
      duplicateWindowMs: o.duplicateWindowMs || 1200,
      burstWindowMs: o.burstWindowMs || 10000,
      maxBurst: o.maxBurst || 25
    });
    if (!res.allowed && !o.silentToast) {
      toast(res.message || 'تم إرسال نفس العملية قبل لحظات، تم منع التكرار التلقائي (مانع Spam).', true);
    }
    return res;
  }

  function withActionLock(btnEl, lockKey, fn, opts) {
    var o = opts || {};
    var key = String(lockKey || '');
    if (key && activeActionLocks[key]) {
      if (o.spamAction && !o.silentToast) {
        toast('جاري تنفيذ العملية بالفعل، تم منع التكرار (مانع Spam).', true);
      }
      return activeActionLocks[key];
    }
    if (o.spamAction) {
      var spRes = checkActionSpam(o.spamAction, o.spamSig || key || o.spamAction, o.spamOpts);
      if (!spRes.allowed) {
        return Promise.resolve({
          success: false,
          spamBlocked: true,
          waitMs: spRes.waitMs || 1200,
          message: spRes.message || 'تم منع التكرار التلقائي (مانع Spam).'
        });
      }
    }
    var prevDisabled = btnEl ? Boolean(btnEl.disabled) : false;
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.setAttribute('aria-busy', 'true');
    }
    var p = Promise.resolve().then(fn).finally(function () {
      if (key) delete activeActionLocks[key];
      if (btnEl && btnEl.isConnected !== false) {
        btnEl.disabled = prevDisabled;
        btnEl.removeAttribute('aria-busy');
      }
    });
    if (key) activeActionLocks[key] = p;
    return p;
  }

  function isActionLocked(lockKey) {
    var key = String(lockKey || '');
    return Boolean(key && activeActionLocks[key]);
  }

  function getRoleUiDefaults() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults) {
      state.roleUiDefaults = root.RGCrmCore.normalizeRoleUiDefaults(state.roleUiDefaults);
    }
    return state.roleUiDefaults || {};
  }

  function setRoleUiDefaults(rawDefaults) {
    state.roleUiDefaults = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
      ? root.RGCrmCore.normalizeRoleUiDefaults(rawDefaults)
      : (rawDefaults && typeof rawDefaults === 'object' ? rawDefaults : {});
    applyUiSimplification(state.uiSimplification, true);
    return state.roleUiDefaults;
  }

  function getStatsControlConfig() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeStatsControlConfig) {
      state.statsControlConfig = root.RGCrmCore.normalizeStatsControlConfig(state.statsControlConfig);
    }
    return state.statsControlConfig || { excludedFromStatsEmployeeIds: [] };
  }

  function setStatsControlConfig(rawCfg) {
    state.statsControlConfig = (root.RGCrmCore && root.RGCrmCore.normalizeStatsControlConfig)
      ? root.RGCrmCore.normalizeStatsControlConfig(rawCfg)
      : (rawCfg && typeof rawCfg === 'object' ? rawCfg : { excludedFromStatsEmployeeIds: [] });
    return state.statsControlConfig;
  }

  function getCallWrapupShortcutsConfig() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeCallWrapupShortcutsConfig) {
      state.callWrapupShortcutsConfig = root.RGCrmCore.normalizeCallWrapupShortcutsConfig(state.callWrapupShortcutsConfig);
      return state.callWrapupShortcutsConfig;
    }
    return state.callWrapupShortcutsConfig || { items: [], customized: false, updatedAt: '', updatedBy: '' };
  }

  function getActiveCallWrapupShortcuts() {
    var cfg = getCallWrapupShortcutsConfig();
    return Array.isArray(cfg.items) ? cfg.items : [];
  }

  function setCallWrapupShortcutsConfig(rawCfg) {
    state.callWrapupShortcutsConfig = (root.RGCrmCore && root.RGCrmCore.normalizeCallWrapupShortcutsConfig)
      ? root.RGCrmCore.normalizeCallWrapupShortcutsConfig(rawCfg)
      : (rawCfg && typeof rawCfg === 'object' ? rawCfg : { items: [], customized: false, updatedAt: '', updatedBy: '' });
    if (document.getElementById('rg-call-wrapup-bar') && lastOpenCallInfo) {
      openCallWrapUpBar(lastOpenCallInfo);
    }
    return state.callWrapupShortcutsConfig;
  }

  function getEffectiveRoleUiResolution(userOverride) {
    var u = userOverride || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    var baseUi = normalizeUiSimpFallback(state.uiSimplification);
    var activeDefaults = (state.previewSession && state.previewSession.draftRoleUiDefaults)
      ? state.previewSession.draftRoleUiDefaults
      : state.roleUiDefaults;
    if (u && root.RGCrmCore && root.RGCrmCore.resolveRoleUiDefaultsForUser) {
      return root.RGCrmCore.resolveRoleUiDefaultsForUser(u, activeDefaults, baseUi);
    }
    return {
      role: (u && u.role) || 'agent',
      hasRoleOverride: false,
      forceForRole: false,
      uiSimplification: baseUi,
      visibleCols: (root.RGCrmCore && root.RGCrmCore.DEFAULT_RESERVATIONS_VISIBLE_COLS)
        ? root.RGCrmCore.DEFAULT_RESERVATIONS_VISIBLE_COLS.slice()
        : ['reservationNumber', 'customerName', 'carName', 'startDate', 'totalAmount', 'originalStatusAr', 'internalStatus']
    };
  }

  function getUiSimplification() {
    var resolved = getEffectiveRoleUiResolution();
    return Object.assign({}, normalizeUiSimpFallback(resolved && resolved.uiSimplification ? resolved.uiSimplification : state.uiSimplification));
  }

  function applyUiSimplification(rawCfg, skipPersist) {
    var cfg = normalizeUiSimpFallback(rawCfg || state.uiSimplification);
    state.uiSimplification = cfg;
    if (!skipPersist) {
      try {
        localStorage.setItem(UI_SIMP_STORAGE_KEY, JSON.stringify(cfg));
      } catch (_e) {}
    }
    var resolved = getEffectiveRoleUiResolution();
    var effectiveCfg = normalizeUiSimpFallback(resolved && resolved.uiSimplification ? resolved.uiSimplification : cfg);
    var html = document.documentElement;
    if (html && html.classList) {
      var opts = (root.RGCrmCore && Array.isArray(root.RGCrmCore.UI_SIMPLIFICATION_OPTIONS))
        ? root.RGCrmCore.UI_SIMPLIFICATION_OPTIONS
        : [
            { key: 'hideSecondaryCarMeta', cssClass: 'rg-ui-hide-car-meta' },
            { key: 'hideCustomerContactExtras', cssClass: 'rg-ui-hide-customer-extra' },
            { key: 'hideFinancialBreakdown', cssClass: 'rg-ui-hide-finance' },
            { key: 'hideDrawerCharts', cssClass: 'rg-ui-hide-drawer-charts' },
            { key: 'hideDashboardRadar', cssClass: 'rg-ui-hide-dash-radar' },
            { key: 'hideDashboardHeatmap', cssClass: 'rg-ui-hide-dash-heatmap' }
          ];
      opts.forEach(function (item) {
        if (item && item.cssClass) {
          html.classList.toggle(item.cssClass, Boolean(effectiveCfg[item.key]));
        }
      });
    }
    return effectiveCfg;
  }

  function getLayoutPrefs(user) {
    var u = user || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    if (!state.layoutPrefs || !Array.isArray(state.layoutPrefs.navOrder) || state.layoutPrefs.navOrder.length === 0) {
      state.layoutPrefs = loadLayoutPrefs(u);
    } else {
      state.layoutPrefs = normalizeLayoutPrefsFallback(state.layoutPrefs);
    }
    return Object.assign({}, state.layoutPrefs, {
      navOrder: state.layoutPrefs.navOrder.slice(),
      hiddenRoutes: state.layoutPrefs.hiddenRoutes.slice(),
      dashOrder: state.layoutPrefs.dashOrder.slice(),
      dashHidden: state.layoutPrefs.dashHidden.slice()
    });
  }

  function getTimeFormat() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeTimeFormat) {
      return root.RGCrmCore.normalizeTimeFormat(state.prefs.timeFormat);
    }
    return state.prefs.timeFormat === '12h' ? '12h' : '24h';
  }

  function getSidebarPosition() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeSidebarPosition) {
      return root.RGCrmCore.normalizeSidebarPosition(state.prefs.sidebarPosition);
    }
    return (state.prefs.sidebarPosition === 'top' || state.prefs.sidebarPosition === 'bottom') ? state.prefs.sidebarPosition : 'side';
  }

  function getTimezoneMode() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeTimezoneMode) {
      return root.RGCrmCore.normalizeTimezoneMode(state.prefs.timezoneMode);
    }
    return (state.prefs.timezoneMode === 'sa' || state.prefs.timezoneMode === 'eg') ? state.prefs.timezoneMode : 'both';
  }

  function getReservationsDisplayMode() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeReservationsDisplayMode) {
      return root.RGCrmCore.normalizeReservationsDisplayMode(state.prefs.reservationsDisplayMode);
    }
    return state.prefs.reservationsDisplayMode === 'calendar' ? 'calendar' : 'table';
  }

  function getCalendarGranularity() {
    if (root.RGCrmCore && root.RGCrmCore.normalizeCalendarGranularity) {
      return root.RGCrmCore.normalizeCalendarGranularity(state.prefs.calendarGranularity);
    }
    return (state.prefs.calendarGranularity === 'day' || state.prefs.calendarGranularity === 'month') ? state.prefs.calendarGranularity : 'week';
  }

  function formatTimePref(val, langOverride) {
    if (val === null || val === undefined || val === '') return '';
    var lang = langOverride || state.prefs.lang || 'ar';
    var tf = getTimeFormat();
    if (root.RGCrmCore && root.RGCrmCore.formatTimePreference) {
      return root.RGCrmCore.formatTimePreference(val, tf, lang) || String(val);
    }
    return String(val);
  }

  function formatDateTimePref(val, langOverride) {
    if (val === null || val === undefined || val === '') return '';
    var lang = langOverride || state.prefs.lang || 'ar';
    var tf = getTimeFormat();
    if (root.RGCrmCore && root.RGCrmCore.formatDateTimePreference) {
      return root.RGCrmCore.formatDateTimePreference(val, tf, lang) || String(val);
    }
    if (root.RGCrmCore && root.RGCrmCore.formatDisplayDateTime) {
      return root.RGCrmCore.formatDisplayDateTime(val) || String(val);
    }
    return String(val).replace('T', ' ').substring(0, 16);
  }

  function hydrateLayoutPrefsFromServer(raw, user) {
    var u = user || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    var localUserLayout = loadLayoutPrefs(u);
    var localUserPrefs = loadPerUserPrefs(u);
    var norm = normalizeLayoutPrefsFallback(raw || localUserLayout);

    if (u && u.id) {
      var nextTime = (raw && (raw.timeFormat === '12h' || raw.timeFormat === '24h'))
        ? raw.timeFormat
        : ((localUserPrefs.timeFormat === '12h' || localUserPrefs.timeFormat === '24h') ? localUserPrefs.timeFormat : norm.timeFormat);
      var nextPos = (raw && (raw.sidebarPosition === 'side' || raw.sidebarPosition === 'top' || raw.sidebarPosition === 'bottom'))
        ? raw.sidebarPosition
        : ((localUserPrefs.sidebarPosition === 'side' || localUserPrefs.sidebarPosition === 'top' || localUserPrefs.sidebarPosition === 'bottom') ? localUserPrefs.sidebarPosition : norm.sidebarPosition);
      var nextTz = (raw && (raw.timezoneMode === 'both' || raw.timezoneMode === 'sa' || raw.timezoneMode === 'eg'))
        ? raw.timezoneMode
        : ((localUserPrefs.timezoneMode === 'both' || localUserPrefs.timezoneMode === 'sa' || localUserPrefs.timezoneMode === 'eg') ? localUserPrefs.timezoneMode : norm.timezoneMode);
      var nextTheme = (raw && (raw.theme === 'dark' || raw.theme === 'light'))
        ? raw.theme
        : ((localUserPrefs.theme === 'dark' || localUserPrefs.theme === 'light') ? localUserPrefs.theme : getDefaultSystemTheme());
      var nextLang = (raw && (raw.lang === 'ar' || raw.lang === 'en'))
        ? raw.lang
        : ((localUserPrefs.lang === 'ar' || localUserPrefs.lang === 'en') ? localUserPrefs.lang : 'ar');
      var nextCollapsed = (raw && typeof raw === 'object' && raw.sidebarCollapsed !== undefined)
        ? Boolean(raw.sidebarCollapsed)
        : Boolean(localUserPrefs.sidebarCollapsed || localUserLayout.sidebarCollapsed);

      var nextResView = (raw && (raw.reservationsDisplayMode === 'table' || raw.reservationsDisplayMode === 'calendar'))
        ? raw.reservationsDisplayMode
        : ((localUserPrefs.reservationsDisplayMode === 'table' || localUserPrefs.reservationsDisplayMode === 'calendar') ? localUserPrefs.reservationsDisplayMode : norm.reservationsDisplayMode);
      var nextCalGran = (raw && (raw.calendarGranularity === 'week' || raw.calendarGranularity === 'day' || raw.calendarGranularity === 'month'))
        ? raw.calendarGranularity
        : ((localUserPrefs.calendarGranularity === 'week' || localUserPrefs.calendarGranularity === 'day' || localUserPrefs.calendarGranularity === 'month') ? localUserPrefs.calendarGranularity : norm.calendarGranularity);

      state.prefs.timeFormat = nextTime;
      state.prefs.sidebarPosition = nextPos;
      state.prefs.timezoneMode = nextTz;
      state.prefs.reservationsDisplayMode = nextResView;
      state.prefs.calendarGranularity = nextCalGran;
      state.prefs.theme = nextTheme;
      state.prefs.lang = nextLang;
      state.prefs.sidebarCollapsed = nextCollapsed;
      savePrefs(u);
      applyThemeAndLang();
      syncThemeButtonsUI();
    } else if (raw && typeof raw === 'object') {
      if (raw.timeFormat === '12h' || raw.timeFormat === '24h') state.prefs.timeFormat = raw.timeFormat;
      if (raw.sidebarPosition === 'side' || raw.sidebarPosition === 'top' || raw.sidebarPosition === 'bottom') state.prefs.sidebarPosition = raw.sidebarPosition;
      if (raw.timezoneMode === 'both' || raw.timezoneMode === 'sa' || raw.timezoneMode === 'eg') state.prefs.timezoneMode = raw.timezoneMode;
      if (raw.reservationsDisplayMode === 'table' || raw.reservationsDisplayMode === 'calendar') state.prefs.reservationsDisplayMode = raw.reservationsDisplayMode;
      if (raw.calendarGranularity === 'week' || raw.calendarGranularity === 'day' || raw.calendarGranularity === 'month') state.prefs.calendarGranularity = raw.calendarGranularity;
      if (raw.theme === 'dark' || raw.theme === 'light') state.prefs.theme = raw.theme;
      if (raw.lang === 'ar' || raw.lang === 'en') state.prefs.lang = raw.lang;
      if (raw.sidebarCollapsed !== undefined) state.prefs.sidebarCollapsed = Boolean(raw.sidebarCollapsed);
      savePrefs(null);
      applyThemeAndLang();
      syncThemeButtonsUI();
    }

    norm.timeFormat = getTimeFormat();
    norm.sidebarPosition = getSidebarPosition();
    norm.timezoneMode = getTimezoneMode();
    norm.reservationsDisplayMode = getReservationsDisplayMode();
    norm.calendarGranularity = getCalendarGranularity();
    norm.theme = state.prefs.theme === 'dark' ? 'dark' : 'light';
    norm.lang = state.prefs.lang === 'en' ? 'en' : 'ar';
    norm.sidebarCollapsed = Boolean(state.prefs.sidebarCollapsed);
    state.layoutPrefs = norm;
    try {
      localStorage.setItem(getLayoutStorageKey(u), JSON.stringify(norm));
    } catch (_e) {}
    return norm;
  }

  var saveLayoutPrefsTimer = null;
  async function saveLayoutPrefs(patch, opts) {
    var o = opts || {};
    var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var cur = getLayoutPrefs(u);
    var merged = Object.assign({}, cur, patch || {});
    if (merged.timeFormat === undefined) merged.timeFormat = getTimeFormat();
    if (merged.sidebarPosition === undefined) merged.sidebarPosition = getSidebarPosition();
    if (merged.timezoneMode === undefined) merged.timezoneMode = getTimezoneMode();
    if (merged.reservationsDisplayMode === undefined) merged.reservationsDisplayMode = getReservationsDisplayMode();
    if (merged.calendarGranularity === undefined) merged.calendarGranularity = getCalendarGranularity();
    if (merged.theme === undefined) merged.theme = state.prefs.theme === 'dark' ? 'dark' : 'light';
    if (merged.lang === undefined) merged.lang = state.prefs.lang === 'en' ? 'en' : 'ar';
    if (merged.sidebarCollapsed === undefined) merged.sidebarCollapsed = Boolean(state.prefs.sidebarCollapsed);
    var next = normalizeLayoutPrefsFallback(merged);
    state.layoutPrefs = next;
    try {
      localStorage.setItem(getLayoutStorageKey(u), JSON.stringify(next));
      if (!u || !u.id) {
        localStorage.setItem(LAYOUT_PREFS_STORAGE_KEY, JSON.stringify(next));
      }
    } catch (_e) {}

    if (o.reRenderNav !== false && u) {
      refreshSidebarNavDom(u);
    }
    if (o.persist !== false && root.RGApi && root.RGApi.callApi && u) {
      if (o.immediate) {
        if (saveLayoutPrefsTimer) { clearTimeout(saveLayoutPrefsTimer); saveLayoutPrefsTimer = null; }
        try { await root.RGApi.callApi('saveUserLayoutPrefs', next); } catch (_err) {}
      } else {
        if (saveLayoutPrefsTimer) clearTimeout(saveLayoutPrefsTimer);
        saveLayoutPrefsTimer = setTimeout(function () {
          saveLayoutPrefsTimer = null;
          root.RGApi.callApi('saveUserLayoutPrefs', Object.assign({}, state.layoutPrefs || next, { _spamChecked: true })).catch(function () {});
        }, 200);
      }
    }
    return next;
  }

  async function setPersonalPreferences(patch, opts) {
    var p = patch && typeof patch === 'object' ? patch : {};
    var o = opts || {};
    var prevTime = getTimeFormat();
    var prevPos = getSidebarPosition();
    var prevTz = getTimezoneMode();
    var prevResView = getReservationsDisplayMode();
    var prevCalGran = getCalendarGranularity();
    var prevLang = state.prefs.lang;
    var prevTheme = state.prefs.theme;

    if (p.timeFormat !== undefined) {
      state.prefs.timeFormat = (root.RGCrmCore && root.RGCrmCore.normalizeTimeFormat)
        ? root.RGCrmCore.normalizeTimeFormat(p.timeFormat)
        : (p.timeFormat === '12h' ? '12h' : '24h');
    }
    if (p.sidebarPosition !== undefined) {
      state.prefs.sidebarPosition = (root.RGCrmCore && root.RGCrmCore.normalizeSidebarPosition)
        ? root.RGCrmCore.normalizeSidebarPosition(p.sidebarPosition)
        : ((p.sidebarPosition === 'top' || p.sidebarPosition === 'bottom') ? p.sidebarPosition : 'side');
    }
    if (p.timezoneMode !== undefined) {
      state.prefs.timezoneMode = (root.RGCrmCore && root.RGCrmCore.normalizeTimezoneMode)
        ? root.RGCrmCore.normalizeTimezoneMode(p.timezoneMode)
        : ((p.timezoneMode === 'sa' || p.timezoneMode === 'eg') ? p.timezoneMode : 'both');
    }
    if (p.reservationsDisplayMode !== undefined) {
      state.prefs.reservationsDisplayMode = (root.RGCrmCore && root.RGCrmCore.normalizeReservationsDisplayMode)
        ? root.RGCrmCore.normalizeReservationsDisplayMode(p.reservationsDisplayMode)
        : (p.reservationsDisplayMode === 'calendar' ? 'calendar' : 'table');
    }
    if (p.calendarGranularity !== undefined) {
      state.prefs.calendarGranularity = (root.RGCrmCore && root.RGCrmCore.normalizeCalendarGranularity)
        ? root.RGCrmCore.normalizeCalendarGranularity(p.calendarGranularity)
        : ((p.calendarGranularity === 'day' || p.calendarGranularity === 'month') ? p.calendarGranularity : 'week');
    }
    if (p.theme === 'dark' || p.theme === 'light') {
      state.prefs.theme = p.theme;
    }
    if (p.lang === 'ar' || p.lang === 'en') {
      state.prefs.lang = p.lang;
    }
    if (p.sidebarCollapsed !== undefined) {
      state.prefs.sidebarCollapsed = Boolean(p.sidebarCollapsed);
    }

    var nextTime = getTimeFormat();
    var nextPos = getSidebarPosition();
    var nextTz = getTimezoneMode();
    var nextResView = getReservationsDisplayMode();
    var nextCalGran = getCalendarGranularity();
    var nextTheme = state.prefs.theme === 'dark' ? 'dark' : 'light';
    var nextLang = state.prefs.lang === 'en' ? 'en' : 'ar';

    savePrefs();
    applyThemeAndLang();
    syncThemeButtonsUI();

    if (prevTheme !== nextTheme) {
      var ctxTheme = buildAppCtx();
      if (root.RGDashboard && typeof root.RGDashboard.refreshTheme === 'function') {
        try { root.RGDashboard.refreshTheme(ctxTheme); } catch (_e) {}
      }
      if (root.RGReports && typeof root.RGReports.refreshTheme === 'function') {
        try { root.RGReports.refreshTheme(ctxTheme); } catch (_e2) {}
      }
      try {
        document.dispatchEvent(new CustomEvent('rg:themechange', { detail: { theme: nextTheme } }));
      } catch (_e3) {}
    }

    if (nextPos !== 'side') {
      var sb = document.getElementById('app-sidebar');
      var ov = document.getElementById('sidebar-overlay');
      if (sb) sb.classList.remove('mobile-open');
      if (ov) ov.classList.remove('active');
    }
    if (prevPos !== nextPos) {
      closeProfileMenu();
    }

    try {
      document.dispatchEvent(new CustomEvent('rg:personalprefschange', {
        detail: {
          timeFormat: nextTime,
          sidebarPosition: nextPos,
          timezoneMode: nextTz,
          reservationsDisplayMode: nextResView,
          calendarGranularity: nextCalGran,
          theme: nextTheme,
          lang: nextLang
        }
      }));
    } catch (_evErr) {}

    var curUser = root.RGAuth && root.RGAuth.getUser && root.RGAuth.getUser();
    var wasPersonalModalOpen = Boolean(document.getElementById('personal-settings-modal'));
    if (o.reRender !== false && curUser) {
      if (prevLang !== nextLang) {
        renderAppShell(curUser);
        if (wasPersonalModalOpen) {
          openPersonalAccountSettingsModal();
        }
        renderRoute().catch(function () {});
      } else if (prevTime !== nextTime || prevTz !== nextTz || ((prevResView !== nextResView || prevCalGran !== nextCalGran) && state.route === 'reservations' && !o.skipRouteRerender)) {
        renderRoute().catch(function () {});
      }
    }

    if (o.persist !== false) {
      saveLayoutPrefs({
        timeFormat: nextTime,
        sidebarPosition: nextPos,
        timezoneMode: nextTz,
        reservationsDisplayMode: nextResView,
        calendarGranularity: nextCalGran,
        theme: nextTheme,
        lang: nextLang,
        sidebarCollapsed: Boolean(state.prefs.sidebarCollapsed)
      }, { reRenderNav: false, persist: true }).catch(function () {});
    }
    return {
      timeFormat: nextTime,
      sidebarPosition: nextPos,
      timezoneMode: nextTz,
      reservationsDisplayMode: nextResView,
      calendarGranularity: nextCalGran,
      theme: nextTheme,
      lang: nextLang
    };
  }

  function canManageAnnouncements(user) {
    var u = user || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    if (!u) return false;
    if (root.RGCrmCore && root.RGCrmCore.isPrivilegedRole && root.RGCrmCore.isPrivilegedRole(u)) return true;
    return u.role === 'supervisor' || u.role === 'general_manager' || u.role === 'developer';
  }

  function getHandoverSettings() {
    state.handoverSettings = normalizeHandoverSettingsSafe(state.handoverSettings);
    return Object.assign({}, state.handoverSettings);
  }

  function setHandoverSettings(raw) {
    state.handoverSettings = normalizeHandoverSettingsSafe(raw);
    return Object.assign({}, state.handoverSettings);
  }

  function getAnnouncements() {
    return Array.isArray(state.announcements) ? state.announcements.slice() : [];
  }

  function setAnnouncements(items) {
    state.announcements = Array.isArray(items) ? items.slice() : [];
    lastFingerprints.announcements = computeFingerprintSafe(state.announcements);
    renderShiftAnnouncementBanner();
    return state.announcements.slice();
  }

  function getActiveLocks() {
    var nowMs = Date.now();
    state.activeLocks = (Array.isArray(state.activeLocks) ? state.activeLocks : []).filter(function (lk) {
      if (!lk || !lk.reservationId) return false;
      var expMs = lk.expiresAt ? Date.parse(lk.expiresAt) : 0;
      return !expMs || expMs > nowMs;
    });
    return state.activeLocks.slice();
  }

  function setActiveLocks(items) {
    state.activeLocks = Array.isArray(items) ? items.slice() : [];
    lastFingerprints.locks = computeFingerprintSafe(state.activeLocks);
    return getActiveLocks();
  }

  function downloadIcsFile(filename, icsContent) {
    var safeName = String(filename || 'rental-gate-calendar.ics').replace(/[^a-zA-Z0-9._-]+/g, '-');
    if (!/\.ics$/i.test(safeName)) safeName += '.ics';
    var blob = new Blob([String(icsContent || '')], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  function isStandalonePwa() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator && window.navigator.standalone === true) return true;
    } catch (_e) {}
    return false;
  }

  function isIosDevice() {
    try {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    } catch (_e) {
      return false;
    }
  }

  function openPwaInstallGuideModal() {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = state.prefs.lang === 'en';
    var ios = isIosDevice();
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="rg-pwa-guide-modal" role="dialog" aria-modal="true" aria-labelledby="rg-pwa-guide-title">' +
        '<div class="modal-panel" style="max-width:480px;">' +
          '<div class="modal-header">' +
            '<div><h3 class="modal-title" id="rg-pwa-guide-title">' + (isEn ? 'Install RENTAL GATE CRM App' : 'تثبيت تطبيق RENTAL GATE CRM') + '</h3>' +
            '<p class="section-subtitle">' + (isEn ? 'Use offline caching, fast launch, and home-screen access.' : 'استفد من العمل دون اتصال والوصول السريع من الشاشة الرئيسية.') + '</p></div>' +
            '<button type="button" class="btn btn-sm" data-modal-close id="rg-pwa-guide-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +
          '<div class="glass-subcard" style="padding:14px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.65;">' +
            (ios
              ? ('<div><strong>' + (isEn ? 'iPhone / iPad (Safari):' : 'أجهزة iPhone وiPad (Safari):') + '</strong></div>' +
                 '<ol style="margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:6px;">' +
                   '<li>' + (isEn ? 'Tap the Share button at the bottom bar of Safari.' : 'اضغط على أيقونة المشاركة (Share) أسفل متصفح Safari.') + '</li>' +
                   '<li>' + (isEn ? 'Select "Add to Home Screen".' : 'اختر "إضافة إلى الصفحة الرئيسية" (Add to Home Screen).') + '</li>' +
                   '<li>' + (isEn ? 'Tap "Add" in the top corner.' : 'اضغط "إضافة" ليظهر التطبيق كبرنامج مستقل.') + '</li>' +
                 '</ol>')
              : ('<div><strong>' + (isEn ? 'Desktop / Android Browser:' : 'المتصفح (سطح المكتب / Android):') + '</strong></div>' +
                 '<p style="margin:0;">' + (isEn
                   ? 'Click the "Install app" icon in your browser address bar, or open the browser menu (⋮) and choose "Install RENTAL GATE CRM".'
                   : 'اضغط على أيقونة التثبيت في شريط العنوان أعلى المتصفح، أو افتح قائمة المتصفح (⋮) واختر "تثبيت التطبيق".') + '</p>')) +
          '</div>' +
        '</div>' +
      '</div>';
    var closeBtn = document.getElementById('rg-pwa-guide-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { modalRoot.innerHTML = ''; });
  }

  async function openPwaInstallFlow() {
    if (state.deferredInstallPrompt && typeof state.deferredInstallPrompt.prompt === 'function') {
      try {
        await state.deferredInstallPrompt.prompt();
        var res = await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        if (res && res.outcome === 'accepted') {
          toast(state.prefs.lang === 'en' ? 'App installation started.' : 'تم بدء تثبيت التطبيق بنجاح.');
        }
        return;
      } catch (_e) {}
    }
    openPwaInstallGuideModal();
  }

  function renderShiftAnnouncementBanner() {
    var host = document.getElementById('rg-shift-announcement-banner');
    if (!host) return;
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!user) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    var isEn = state.prefs.lang === 'en';
    var nowMs = Date.now();
    var active = (Array.isArray(state.announcements) ? state.announcements : []).filter(function (a) {
      if (!a || a.isActive === false) return false;
      if (state.dismissedAnnIds[a.id]) return false;
      if (a.startsAt) {
        var sMs = Date.parse(a.startsAt);
        if (!isNaN(sMs) && nowMs < sMs) return false;
      }
      if (a.expiresAt) {
        var eMs = Date.parse(a.expiresAt);
        if (!isNaN(eMs) && nowMs > eMs) return false;
      }
      return true;
    });

    if (active.length === 0) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }

    var canManage = canManageAnnouncements(user);
    host.classList.remove('hidden');
    host.innerHTML = active.map(function (a, idx) {
      var tone = (a.tone === 'danger' || a.tone === 'info' || a.tone === 'warning') ? a.tone : 'warning';
      var toneIcon = tone === 'danger' ? '🚨' : (tone === 'info' ? 'ℹ️' : '📢');
      return '<div class="rg-shift-banner is-' + escapeHtml(tone) + '" data-ann-id="' + escapeHtml(a.id) + '" role="region" aria-label="' + (isEn ? 'Shift Announcement' : 'تعميم الوردية') + '">' +
        '<div class="rg-shift-banner-main">' +
          '<span class="rg-shift-banner-icon" aria-hidden="true">' + toneIcon + '</span>' +
          '<div class="rg-shift-banner-text">' +
            (a.title ? '<strong class="rg-shift-banner-title">' + escapeHtml(a.title) + ':</strong> ' : '') +
            '<span>' + escapeHtml(a.message) + '</span>' +
            '<span class="rg-shift-banner-meta"> — ' + escapeHtml(a.createdByName || '') + (a.expiresAt ? (' · ' + (isEn ? 'Until ' : 'حتى ') + escapeHtml(formatDateTimePref(a.expiresAt))) : '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="rg-shift-banner-actions">' +
          (canManage && idx === 0
            ? '<button type="button" class="btn btn-sm" id="rg-ann-banner-manage-btn">' + (isEn ? 'Manage' : 'إدارة التعميمات') + '</button>'
            : '') +
          '<button type="button" class="btn btn-sm rg-ann-dismiss-btn" data-dismiss-ann="' + escapeHtml(a.id) + '" aria-label="' + (isEn ? 'Dismiss' : 'إخفاء مؤقت') + '">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var mgrBtn = document.getElementById('rg-ann-banner-manage-btn');
    if (mgrBtn) {
      mgrBtn.addEventListener('click', function () {
        openAnnouncementsManager();
      });
    }
    host.querySelectorAll('[data-dismiss-ann]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-dismiss-ann');
        if (id) state.dismissedAnnIds[id] = true;
        renderShiftAnnouncementBanner();
      });
    });
  }

  async function openAnnouncementsManager() {
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!canManageAnnouncements(user)) {
      toast('إدارة تعميمات وإعلانات الوردية متاحة للمشرف والمدير العام فقط.', true);
      return;
    }
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = state.prefs.lang === 'en';
    var res = await root.RGApi.callApi('getAnnouncements', {});
    var allItems = (res && res.success && res.data && Array.isArray(res.data.items)) ? res.data.items : getAnnouncements();
    if (res && res.success && res.data && Array.isArray(res.data.activeItems)) {
      setAnnouncements(res.data.activeItems);
    }

    var editingId = '';
    function renderMgrModal(items) {
      var list = Array.isArray(items) ? items : [];
      var editItem = editingId ? list.find(function (x) { return x.id === editingId; }) : null;
      var expVal = editItem && editItem.expiresAt ? String(editItem.expiresAt).slice(0, 16) : '';
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="rg-announcements-modal" role="dialog" aria-modal="true" aria-labelledby="rg-ann-mgr-title">' +
          '<div class="modal-panel" style="max-width:720px;max-height:90vh;overflow-y:auto;">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title" id="rg-ann-mgr-title">' + (isEn ? 'Shift Announcements & Team Broadcasts' : 'إدارة إعلانات وتعميمات الوردية') + '</h3>' +
                '<p class="section-subtitle">' + (isEn ? 'Pinned at the top of the workspace for all team members.' : 'تظهر مثبتة أعلى النظام لجميع الموظفين في الوردية فوراً.') + '</p>' +
              '</div>' +
              '<button type="button" class="btn btn-sm" data-modal-close id="rg-ann-mgr-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
            '</div>' +
            '<form id="rg-ann-form" class="glass-subcard" style="padding:14px;display:flex;flex-direction:column;gap:10px;">' +
              '<div class="form-grid-2">' +
                '<div class="form-group"><label class="form-label" for="ann-title">' + (isEn ? 'Short Title' : 'عنوان مختصر (اختياري)') + '</label>' +
                '<input class="input" id="ann-title" value="' + escapeHtml(editItem ? editItem.title : '') + '" placeholder="' + (isEn ? 'e.g. Airport Branch Alert' : 'مثال: تنبيه فرع المطار') + '"></div>' +
                '<div class="form-group"><label class="form-label" for="ann-tone">' + (isEn ? 'Priority / Tone' : 'نوع التنبيه') + '</label>' +
                '<select class="select" id="ann-tone">' +
                  '<option value="warning"' + (!editItem || editItem.tone === 'warning' ? ' selected' : '') + '>' + (isEn ? 'Operational Warning' : 'تنبيه تشغيلي (أصفر)') + '</option>' +
                  '<option value="danger"' + (editItem && editItem.tone === 'danger' ? ' selected' : '') + '>' + (isEn ? 'Urgent / Critical' : 'عاجل / إيقاف خدمة (أحمر)') + '</option>' +
                  '<option value="info"' + (editItem && editItem.tone === 'info' ? ' selected' : '') + '>' + (isEn ? 'Information Notice' : 'إشعار عام (أزرق)') + '</option>' +
                '</select></div>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="ann-message">' + (isEn ? 'Announcement Text' : 'نص التعميم') + '</label>' +
              '<textarea class="textarea" id="ann-message" rows="2" required placeholder="' + (isEn ? 'Write broadcast message...' : 'مثال: شركة X أوقفت التسليم في فرع المطار اليوم...') + '">' + escapeHtml(editItem ? editItem.message : '') + '</textarea></div>' +
              '<div class="form-grid-2" style="align-items:end;">' +
                '<div class="form-group"><label class="form-label" for="ann-expires">' + (isEn ? 'Auto-Expire At (Optional)' : 'انتهاء تلقائي في (اختياري)') + '</label>' +
                '<input type="datetime-local" class="input mono" dir="ltr" id="ann-expires" value="' + escapeHtml(expVal) + '"></div>' +
                '<div class="toolbar-row" style="margin-bottom:0;justify-content:flex-end;">' +
                  '<label class="checkbox-item"><input type="checkbox" id="ann-pinned"' + (!editItem || editItem.isPinned !== false ? ' checked' : '') + '> ' + (isEn ? 'Pinned' : 'تثبيت أعلى الشاشة') + '</label>' +
                  (editingId ? '<button type="button" class="btn btn-sm" id="ann-reset-edit">' + (isEn ? 'Cancel Edit' : 'إلغاء التعديل') + '</button>' : '') +
                  '<button type="submit" class="btn btn-primary" id="ann-save-btn">' + (editingId ? (isEn ? 'Update Broadcast' : 'حفظ التعديل') : (isEn ? 'Publish Broadcast' : 'نشر التعميم للجميع')) + '</button>' +
                '</div>' +
              '</div>' +
            '</form>' +
            '<div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">' +
              '<strong style="font-size:13.5px;">' + (isEn ? 'Published Broadcasts' : 'التعميمات المسجلة') + ' (' + list.length + ')</strong>' +
              (list.length === 0
                ? '<div class="empty-state" style="padding:18px;">' + (isEn ? 'No shift announcements yet.' : 'لا توجد تعميمات وردية منشورة حالياً.') + '</div>'
                : list.map(function (a) {
                    var tCls = a.tone === 'danger' ? 'status-danger' : (a.tone === 'info' ? 'status-info' : 'status-warning');
                    return '<div class="glass-subcard" style="padding:11px 13px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
                      '<div style="flex:1;min-width:220px;">' +
                        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">' +
                          '<span class="status-tag ' + tCls + '">' + escapeHtml(a.tone === 'danger' ? 'عاجل' : (a.tone === 'info' ? 'معلومة' : 'تنبيه')) + '</span>' +
                          '<span class="status-tag ' + (a.isActive !== false ? 'status-success' : 'status-muted') + '">' + (a.isActive !== false ? 'نشط' : 'موقوف') + '</span>' +
                          (a.title ? '<strong>' + escapeHtml(a.title) + '</strong>' : '') +
                        '</div>' +
                        '<div style="font-size:13px;">' + escapeHtml(a.message) + '</div>' +
                        '<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">بواسطة: ' + escapeHtml(a.createdByName || '-') + (a.expiresAt ? (' · ينتهي: ' + escapeHtml(formatDateTimePref(a.expiresAt))) : '') + '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                        '<button type="button" class="btn btn-sm" data-ann-toggle="' + escapeHtml(a.id) + '">' + (a.isActive !== false ? 'إيقاف' : 'تفعيل') + '</button>' +
                        '<button type="button" class="btn btn-sm" data-ann-edit="' + escapeHtml(a.id) + '">تعديل</button>' +
                        '<button type="button" class="btn btn-sm btn-danger" data-ann-del="' + escapeHtml(a.id) + '">حذف</button>' +
                      '</div>' +
                    '</div>';
                  }).join('')) +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('rg-ann-mgr-close').addEventListener('click', function () { modalRoot.innerHTML = ''; });
      var resetEditBtn = document.getElementById('ann-reset-edit');
      if (resetEditBtn) {
        resetEditBtn.addEventListener('click', function () {
          editingId = '';
          renderMgrModal(list);
        });
      }

      var form = document.getElementById('rg-ann-form');
      if (form) {
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var saveBtn = document.getElementById('ann-save-btn');
          var msg = String(document.getElementById('ann-message').value || '').trim();
          if (!msg) {
            toast('نص التعميم مطلوب.', true);
            return;
          }
          var rawExp = String(document.getElementById('ann-expires').value || '').trim();
          var expiresIso = '';
          if (rawExp) {
            var d = new Date(rawExp);
            expiresIso = !isNaN(d.getTime()) ? d.toISOString() : rawExp;
          }
          withActionLock(saveBtn, 'saveAnnouncement', async function () {
            var r = await root.RGApi.callApi('saveAnnouncement', {
              id: editingId || undefined,
              title: String(document.getElementById('ann-title').value || '').trim(),
              message: msg,
              tone: document.getElementById('ann-tone').value,
              isPinned: Boolean(document.getElementById('ann-pinned').checked),
              isActive: true,
              expiresAt: expiresIso
            });
            if (!r || !r.success) {
              toast((r && r.message) || 'تعذر حفظ التعميم.', true);
              return;
            }
            editingId = '';
            state.dismissedAnnIds = {};
            if (r.data && Array.isArray(r.data.activeItems)) setAnnouncements(r.data.activeItems);
            toast('تم حفظ التعميم وتحديثه لجميع الفريق.');
            renderMgrModal((r.data && r.data.items) || []);
          });
        });
      }

      modalRoot.querySelectorAll('[data-ann-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          editingId = btn.getAttribute('data-ann-edit') || '';
          renderMgrModal(list);
        });
      });

      modalRoot.querySelectorAll('[data-ann-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-ann-toggle');
          var target = list.find(function (x) { return x.id === id; });
          if (!target) return;
          withActionLock(btn, 'toggleAnn:' + id, async function () {
            var r = await root.RGApi.callApi('saveAnnouncement', {
              id: target.id,
              title: target.title,
              message: target.message,
              tone: target.tone,
              isPinned: target.isPinned !== false,
              isActive: target.isActive === false,
              expiresAt: target.expiresAt || ''
            });
            if (!r || !r.success) {
              toast((r && r.message) || 'تعذر تحديث التعميم.', true);
              return;
            }
            if (r.data && Array.isArray(r.data.activeItems)) setAnnouncements(r.data.activeItems);
            toast(target.isActive === false ? 'تم تفعيل التعميم.' : 'تم إيقاف التعميم.');
            renderMgrModal((r.data && r.data.items) || []);
          });
        });
      });

      modalRoot.querySelectorAll('[data-ann-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-ann-del');
          withActionLock(btn, 'delAnn:' + id, async function () {
            var r = await root.RGApi.callApi('deleteAnnouncement', { id: id });
            if (!r || !r.success) {
              toast((r && r.message) || 'تعذر حذف التعميم.', true);
              return;
            }
            if (r.data && Array.isArray(r.data.activeItems)) setAnnouncements(r.data.activeItems);
            if (editingId === id) editingId = '';
            toast('تم حذف التعميم.');
            renderMgrModal((r.data && r.data.items) || []);
          });
        });
      });
    }

    renderMgrModal(allItems);
  }

  function isAppOfflineNow() {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('rg_crm_force_offline') === '1') return true;
    } catch (_e) {}
    return false;
  }

  async function updateOfflineBanner() {
    var host = document.getElementById('rg-offline-banner');
    var qStatus = (root.RGApi && typeof root.RGApi.getOfflineQueueStatus === 'function')
      ? await root.RGApi.getOfflineQueueStatus().catch(function () { return { count: 0, items: [] }; })
      : { count: 0, items: [] };
    state.offlineQueue = qStatus;
    if (!host) return;
    var offline = isAppOfflineNow();
    var count = Number(qStatus.count || 0);
    if (!offline && count === 0) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    var isEn = state.prefs.lang === 'en';
    host.classList.remove('hidden');
    host.innerHTML =
      '<div class="rg-offline-bar ' + (offline ? 'is-offline' : 'is-pending') + '" role="status">' +
        '<div class="rg-offline-bar-main">' +
          '<span aria-hidden="true">' + (offline ? '📡' : '🔄') + '</span>' +
          '<span>' + (offline
            ? (isEn ? 'Offline Mode — Cached reservations available; changes are queued automatically.' : 'وضع عدم الاتصال — يمكنك استعراض الحجوزات المخبأة وحفظ التعديلات في طابور المزامنة تلقائياً.')
            : (isEn ? ('Connection restored — ' + count + ' queued change(s) ready to sync.') : ('تمت استعادة الاتصال — لديك ' + count + ' عملية محفوظة بانتظار المزامنة.'))) +
          '</span>' +
          (count > 0 ? ('<span class="status-tag status-warning tabular-nums">' + count + ' ' + (isEn ? 'queued' : 'معلق') + '</span>') : '') +
        '</div>' +
        '<div class="rg-offline-bar-actions">' +
          (count > 0
            ? '<button type="button" class="btn btn-sm btn-primary" id="rg-sync-offline-btn"' + (offline ? ' disabled' : '') + '>' + (isEn ? 'Sync Now' : 'مزامنة الآن') + '</button>'
            : '') +
        '</div>' +
      '</div>';

    var syncBtn = document.getElementById('rg-sync-offline-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        withActionLock(syncBtn, 'syncOfflineQueue', async function () {
          if (!root.RGApi || typeof root.RGApi.syncOfflineQueue !== 'function') return;
          var sRes = await root.RGApi.syncOfflineQueue();
          await updateOfflineBanner();
          if (sRes && sRes.synced > 0) {
            toast(isEn ? ('Synced ' + sRes.synced + ' offline operations.') : ('تمت مزامنة ' + sRes.synced + ' عملية مؤجلة بنجاح.'));
            refreshCurrentRouteAndNotifications({ manual: true }).catch(function () {});
          } else if (sRes && sRes.offline) {
            toast(isEn ? 'Still offline.' : 'ما زال الاتصال غير متاح.', true);
          }
        });
      });
    }
  }

  function closeCallWrapUpBar() {
    lastOpenCallInfo = null;
    var existing = document.getElementById('rg-call-wrapup-bar');
    if (existing) existing.remove();
  }

  function mountCallShortcutsControlPanel(hostEl, ctxArg, opts) {
    if (!hostEl) return;
    var options = opts || {};
    var realU = getRealUser();
    if (!realU || realU.role !== 'developer') {
      hostEl.innerHTML = '<div class="empty-state" style="padding:14px;">التحكم في اختصارات نافذة الاتصال متاح لحساب المبرمج فقط.</div>';
      return;
    }

    var core = root.RGCrmCore;
    var isEn = state.prefs.lang === 'en';
    var editingKey = '';
    var workingCfg = core && core.normalizeCallWrapupShortcutsConfig
      ? core.normalizeCallWrapupShortcutsConfig(getCallWrapupShortcutsConfig())
      : { items: [], customized: false, updatedAt: '', updatedBy: '' };
    var workflowOpts = (core && Array.isArray(core.MANUAL_WORKFLOW_STATUS_OPTIONS))
      ? core.MANUAL_WORKFLOW_STATUS_OPTIONS
      : ((core && typeof core.getWorkflowStatusOptions === 'function')
          ? core.getWorkflowStatusOptions('')
          : ['قيد الانتظار', 'تم الحجز', 'تم التسليم', 'تم الاستلام', 'تم الإنشاء', 'تم التمديد', 'لم يتم الحجز']);

    async function persistShortcutsConfig(nextCfg, triggerBtn, successMsg) {
      return withActionLock(triggerBtn, 'saveCallWrapupShortcuts', async function () {
        var res = await root.RGApi.callApi('updateSettings', {
          call_wrapup_shortcuts: nextCfg
        });
        if (!res || !res.success) {
          toast((res && res.message) || (isEn ? 'Failed to save shortcuts.' : 'تعذر حفظ اختصارات الاتصال.'), true);
          return false;
        }
        var savedCfg = (res.data && res.data.call_wrapup_shortcuts) ? res.data.call_wrapup_shortcuts : nextCfg;
        workingCfg = (core && core.normalizeCallWrapupShortcutsConfig)
          ? core.normalizeCallWrapupShortcutsConfig(savedCfg)
          : savedCfg;
        setCallWrapupShortcutsConfig(workingCfg);
        if (root.RGApi && root.RGApi.invalidateScopes) {
          root.RGApi.invalidateScopes(['settings', 'dashboard']);
        }
        document.dispatchEvent(new CustomEvent('rg:deltasync', {
          detail: { localMutation: true, changedSettings: true, callWrapupShortcuts: workingCfg }
        }));
        document.dispatchEvent(new CustomEvent('rg:mutationcomplete', {
          detail: { action: 'updateSettings', scopes: ['settings'] }
        }));
        toast(successMsg || (isEn ? 'Call shortcuts saved & synced.' : 'تم حفظ اختصارات الاتصال ومزامنتها فوراً.'));
        if (typeof options.onSaved === 'function') {
          options.onSaved(workingCfg);
        }
        renderPanel();
        return true;
      });
    }

    function renderPanel() {
      var list = Array.isArray(workingCfg.items) ? workingCfg.items : [];
      var editItem = editingKey ? list.find(function (x) { return x && x.key === editingKey; }) : null;
      if (editingKey && !editItem) editingKey = '';

      var rowsHtml = list.length === 0
        ? '<div class="rg-dev-shortcuts-empty">' +
            (isEn
              ? 'No shortcuts currently active. Add a custom shortcut below or restore defaults.'
              : 'لا توجد اختصارات مفعّلة حالياً. يمكنك إضافة اختصار جديد أدناه أو استعادة الافتراضية.') +
          '</div>'
        : '<div class="rg-dev-shortcuts-list">' +
            list.map(function (item, idx) {
              var badgeTxt = item.isNoAnswer
                ? (isEn ? 'No Answer Log' : 'تسجيل لم يرد')
                : (item.suggestedStatus
                    ? ((isEn ? 'Status: ' : 'الحالة: ') + item.suggestedStatus)
                    : (isEn ? 'Keep Current Status' : 'إبقاء الحالة الحالية'));
              var toneCls = item.variant === 'danger'
                ? 'status-danger'
                : (item.variant === 'primary' ? 'status-info' : 'status-neutral');
              return '<div class="rg-dev-shortcut-row' + (editingKey === item.key ? ' is-editing' : '') + '" data-sc-key="' + escapeHtml(item.key) + '">' +
                '<div class="rg-dev-shortcut-main">' +
                  '<div class="rg-dev-shortcut-title">' +
                    '<span class="mono rg-dev-shortcut-idx">' + (idx + 1) + '.</span>' +
                    '<strong>' + escapeHtml(item.labelAr) + '</strong>' +
                    (item.labelEn && item.labelEn !== item.labelAr ? '<span class="rg-dev-shortcut-en" dir="ltr">(' + escapeHtml(item.labelEn) + ')</span>' : '') +
                    '<span class="status-tag ' + toneCls + '">' + escapeHtml(badgeTxt) + '</span>' +
                  '</div>' +
                  '<div class="rg-dev-shortcut-sub">' + escapeHtml(item.actionTextAr || '') + '</div>' +
                '</div>' +
                '<div class="rg-dev-shortcut-actions">' +
                  '<button type="button" class="btn btn-sm rg-sc-move-up" data-sc-key="' + escapeHtml(item.key) + '"' + (idx === 0 ? ' disabled' : '') + ' title="' + (isEn ? 'Move Up' : 'تحريك لأعلى') + '">↑</button>' +
                  '<button type="button" class="btn btn-sm rg-sc-move-down" data-sc-key="' + escapeHtml(item.key) + '"' + (idx === list.length - 1 ? ' disabled' : '') + ' title="' + (isEn ? 'Move Down' : 'تحريك لأسفل') + '">↓</button>' +
                  '<button type="button" class="btn btn-sm rg-sc-edit" data-sc-key="' + escapeHtml(item.key) + '">' + (isEn ? 'Edit' : 'تعديل') + '</button>' +
                  '<button type="button" class="btn btn-sm btn-danger rg-sc-delete" data-sc-key="' + escapeHtml(item.key) + '">' + (isEn ? 'Remove' : 'إزالة') + '</button>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>';

      hostEl.innerHTML =
        '<div class="rg-dev-shortcuts-panel">' +
          '<div class="rg-dev-shortcuts-top">' +
            '<div class="rg-dev-shortcuts-meta">' +
              '<span class="status-tag ' + (workingCfg.customized ? 'status-info' : 'status-neutral') + '">' +
                (workingCfg.customized
                  ? (isEn ? 'Custom List' : 'قائمة مخصصة')
                  : (isEn ? 'Default List' : 'القائمة الافتراضية')) +
              '</span>' +
              '<span class="rg-dev-shortcuts-count tabular-nums">' +
                (isEn ? (list.length + ' active shortcut(s)') : (list.length + ' اختصار مفعل')) +
              '</span>' +
            '</div>' +
            '<button type="button" class="btn btn-sm rg-sc-reset-defaults">' +
              (isEn ? 'Restore Defaults' : 'استعادة الافتراضية') +
            '</button>' +
          '</div>' +
          rowsHtml +
          '<form class="rg-dev-shortcut-form" autocomplete="off">' +
            '<div class="rg-dev-shortcut-form-head">' +
              '<strong>' + (editItem
                ? (isEn ? 'Edit Shortcut' : 'تعديل الاختصار المحدد')
                : (isEn ? 'Add New Post-Call Shortcut' : 'إضافة اختصار جديد لنافذة الاتصال')) + '</strong>' +
              (editItem
                ? '<button type="button" class="btn btn-sm rg-sc-cancel-edit">' + (isEn ? 'Cancel Edit' : 'إلغاء التعديل') + '</button>'
                : '') +
            '</div>' +
            '<div class="rg-dev-shortcut-form-grid">' +
              '<label class="form-field">' +
                '<span>' + (isEn ? 'Button Label (Arabic) *' : 'اسم الزر (عربي) *') + '</span>' +
                '<input type="text" class="input rg-sc-inp-ar" maxlength="80" required placeholder="' + (isEn ? 'e.g. Sent Payment Link' : 'مثال: تم إرسال رابط الدفع') + '" value="' + escapeHtml(editItem ? editItem.labelAr : '') + '">' +
              '</label>' +
              '<label class="form-field">' +
                '<span>' + (isEn ? 'Button Label (English)' : 'اسم الزر (إنجليزي - اختياري)') + '</span>' +
                '<input type="text" class="input rg-sc-inp-en" dir="ltr" maxlength="80" placeholder="Payment Link Sent" value="' + escapeHtml(editItem && editItem.labelEn !== editItem.labelAr ? editItem.labelEn : '') + '">' +
              '</label>' +
              '<label class="form-field">' +
                '<span>' + (isEn ? 'Target Booking Status' : 'حالة الحجز المرتبطة (اختياري)') + '</span>' +
                '<select class="select rg-sc-inp-status"' + (editItem && editItem.isNoAnswer ? ' disabled' : '') + '>' +
                  '<option value="">' + (isEn ? 'Keep current status' : 'بدون تغيير حالة الحجز') + '</option>' +
                  workflowOpts.map(function (st) {
                    return '<option value="' + escapeHtml(st) + '"' + (editItem && editItem.suggestedStatus === st ? ' selected' : '') + '>' + escapeHtml(st) + '</option>';
                  }).join('') +
                '</select>' +
              '</label>' +
              '<label class="form-field">' +
                '<span>' + (isEn ? 'Button Style' : 'لون / نمط الزر') + '</span>' +
                '<select class="select rg-sc-inp-variant">' +
                  '<option value="neutral"' + (!editItem || editItem.variant === 'neutral' ? ' selected' : '') + '>' + (isEn ? 'Standard' : 'قياسي (محايد)') + '</option>' +
                  '<option value="primary"' + (editItem && editItem.variant === 'primary' ? ' selected' : '') + '>' + (isEn ? 'Primary (Highlighted)' : 'رئيسي (مميز)') + '</option>' +
                  '<option value="danger"' + (editItem && editItem.variant === 'danger' ? ' selected' : '') + '>' + (isEn ? 'Alert / No Answer' : 'تنبيه / لم يرد') + '</option>' +
                '</select>' +
              '</label>' +
              '<label class="form-field rg-dev-shortcut-wide">' +
                '<span>' + (isEn ? 'Logged Follow-up Action Text' : 'نص الإجراء المسجل في سجل المتابعة (اختياري)') + '</span>' +
                '<input type="text" class="input rg-sc-inp-action" maxlength="140" placeholder="' + (isEn ? 'Auto-generated if left blank' : 'يُنشأ تلقائياً إذا تُرك فارغاً') + '" value="' + escapeHtml(editItem ? editItem.actionTextAr : '') + '">' +
              '</label>' +
            '</div>' +
            '<div class="rg-dev-shortcut-form-foot">' +
              '<label class="checkbox-item">' +
                '<input type="checkbox" class="rg-sc-inp-noanswer"' + (editItem && editItem.isNoAnswer ? ' checked' : '') + '> ' +
                (isEn ? 'Treat as "No Answer" attempt counter' : 'احتساب كمحاولة اتصال "لم يرد" في العداد') +
              '</label>' +
              '<button type="submit" class="btn btn-primary rg-sc-submit-btn">' +
                (editItem ? (isEn ? 'Save Shortcut Changes' : 'حفظ التعديلات') : (isEn ? 'Add Shortcut' : '+ إضافة اختصار')) +
              '</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      var statusSel = hostEl.querySelector('.rg-sc-inp-status');
      var noAnsChk = hostEl.querySelector('.rg-sc-inp-noanswer');
      if (noAnsChk && statusSel) {
        noAnsChk.addEventListener('change', function () {
          statusSel.disabled = noAnsChk.checked;
          if (noAnsChk.checked) statusSel.value = '';
        });
      }

      var cancelEditBtn = hostEl.querySelector('.rg-sc-cancel-edit');
      if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', function () {
          editingKey = '';
          renderPanel();
        });
      }

      hostEl.querySelectorAll('.rg-sc-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          editingKey = btn.getAttribute('data-sc-key') || '';
          renderPanel();
          var arInp = hostEl.querySelector('.rg-sc-inp-ar');
          if (arInp) arInp.focus();
        });
      });

      hostEl.querySelectorAll('.rg-sc-delete').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var delKey = btn.getAttribute('data-sc-key') || '';
          if (!delKey || !core || !core.removeCallWrapupShortcut) return;
          var nextCfg = core.removeCallWrapupShortcut(workingCfg, delKey);
          if (editingKey === delKey) editingKey = '';
          persistShortcutsConfig(nextCfg, btn, isEn ? 'Shortcut removed.' : 'تمت إزالة الاختصار وحفظ التغيير.');
        });
      });

      hostEl.querySelectorAll('.rg-sc-move-up, .rg-sc-move-down').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var moveKey = btn.getAttribute('data-sc-key') || '';
          var dir = btn.classList.contains('rg-sc-move-up') ? -1 : 1;
          var curItems = (workingCfg.items || []).slice();
          var curIdx = curItems.findIndex(function (x) { return x && x.key === moveKey; });
          var nextIdx = curIdx + dir;
          if (curIdx === -1 || nextIdx < 0 || nextIdx >= curItems.length) return;
          var tmp = curItems[curIdx];
          curItems[curIdx] = curItems[nextIdx];
          curItems[nextIdx] = tmp;
          var nextCfg = core && core.normalizeCallWrapupShortcutsConfig
            ? core.normalizeCallWrapupShortcutsConfig({ items: curItems, customized: true })
            : { items: curItems, customized: true };
          persistShortcutsConfig(nextCfg, btn, isEn ? 'Shortcut order updated.' : 'تم تحديث ترتيب الاختصارات.');
        });
      });

      var resetBtn = hostEl.querySelector('.rg-sc-reset-defaults');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          if (!core || !core.resetCallWrapupShortcutsConfig) return;
          editingKey = '';
          var nextCfg = core.resetCallWrapupShortcutsConfig();
          persistShortcutsConfig(nextCfg, resetBtn, isEn ? 'Default shortcuts restored.' : 'تمت استعادة الاختصارات الافتراضية.');
        });
      }

      var formEl = hostEl.querySelector('.rg-dev-shortcut-form');
      if (formEl) {
        formEl.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var arVal = String((hostEl.querySelector('.rg-sc-inp-ar') && hostEl.querySelector('.rg-sc-inp-ar').value) || '').trim();
          var enVal = String((hostEl.querySelector('.rg-sc-inp-en') && hostEl.querySelector('.rg-sc-inp-en').value) || '').trim();
          var stVal = String((hostEl.querySelector('.rg-sc-inp-status') && hostEl.querySelector('.rg-sc-inp-status').value) || '').trim();
          var varVal = String((hostEl.querySelector('.rg-sc-inp-variant') && hostEl.querySelector('.rg-sc-inp-variant').value) || 'neutral').trim();
          var actVal = String((hostEl.querySelector('.rg-sc-inp-action') && hostEl.querySelector('.rg-sc-inp-action').value) || '').trim();
          var isNoAns = Boolean(hostEl.querySelector('.rg-sc-inp-noanswer') && hostEl.querySelector('.rg-sc-inp-noanswer').checked);
          if (!arVal) {
            toast(isEn ? 'Arabic button label is required.' : 'يرجى كتابة اسم الاختصار بالعربية.', true);
            return;
          }
          var submitBtn = hostEl.querySelector('.rg-sc-submit-btn');
          try {
            var nextCfg = core.upsertCallWrapupShortcut(workingCfg, {
              key: editingKey || undefined,
              labelAr: arVal,
              labelEn: enVal || arVal,
              suggestedStatus: isNoAns ? '' : stVal,
              variant: varVal,
              actionTextAr: actVal || ('نتيجة المكالمة: ' + arVal),
              isNoAnswer: isNoAns
            });
            var wasEditing = Boolean(editingKey);
            editingKey = '';
            persistShortcutsConfig(
              nextCfg,
              submitBtn,
              wasEditing
                ? (isEn ? 'Shortcut updated.' : 'تم تعديل الاختصار وحفظه.')
                : (isEn ? 'Shortcut added.' : 'تمت إضافة الاختصار الجديد.')
            );
          } catch (err) {
            toast((err && err.message) || 'تعذر حفظ الاختصار.', true);
          }
        });
      }
    }

    renderPanel();
  }

  function openDeveloperCallShortcutsModal(ctxArg, onSaved) {
    var realU = getRealUser();
    if (!realU || realU.role !== 'developer') {
      toast('التحكم في اختصارات نافذة الاتصال متاح للمبرمج فقط.', true);
      return;
    }
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = state.prefs.lang === 'en';
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="sc-mgr-backdrop">' +
        '<div class="modal-panel rg-dev-shortcuts-modal" role="dialog" aria-modal="true" aria-label="' + (isEn ? 'Manage Post-Call Shortcuts' : 'إدارة اختصارات نافذة الاتصال') + '">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h2 class="modal-title">' + (isEn ? 'Post-Call Shortcuts Control (Developer)' : 'إدارة اختصارات نافذة الاتصال (المبرمج)') + '</h2>' +
              '<p class="section-subtitle">' + (isEn ? 'Add, edit, remove, or reorder the quick outcome buttons shown after clicking Call.' : 'إضافة أو تعديل أو إزالة أو ترتيب أزرار الاختصارات السريعة التي تظهر بعد ضغط زر الاتصال لجميع الموظفين.') + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="sc-mgr-close" aria-label="' + (isEn ? 'Close' : 'إغلاق') + '">✕</button>' +
          '</div>' +
          '<div class="modal-body" id="sc-mgr-body"></div>' +
        '</div>' +
      '</div>';

    var closeModal = function () {
      modalRoot.innerHTML = '';
    };
    var scBackdrop = document.getElementById('sc-mgr-backdrop');
    if (scBackdrop) {
      scBackdrop.addEventListener('click', function (ev) {
        if (ev.target === scBackdrop) closeModal();
      });
    }
    var closeBtn = document.getElementById('sc-mgr-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    var host = document.getElementById('sc-mgr-body');
    if (host) {
      mountCallShortcutsControlPanel(host, ctxArg || buildAppCtx(), {
        onSaved: function (cfg) {
          if (typeof onSaved === 'function') onSaved(cfg);
        }
      });
    }
  }

  function openCallWrapUpBar(callInfo) {
    var curUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!curUser || !callInfo || !callInfo.reservationId) return;
    lastOpenCallInfo = Object.assign({}, callInfo);
    var existing = document.getElementById('rg-call-wrapup-bar');
    if (existing) existing.remove();

    var isEn = state.prefs.lang === 'en';
    var isDeveloper = Boolean(getRealUser() && getRealUser().role === 'developer' && curUser.role === 'developer');
    var outcomes = getActiveCallWrapupShortcuts();

    var bar = document.createElement('div');
    bar.id = 'rg-call-wrapup-bar';
    bar.className = 'rg-call-wrapup-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', isEn ? 'Call Wrap-Up Bar' : 'نافذة أثناء المكالمة');
    bar.innerHTML =
      '<div class="rg-call-wrapup-head">' +
        '<div class="rg-call-wrapup-meta">' +
          '<span class="rg-call-wrapup-badge">📞 ' + (isEn ? 'Call Active' : 'أثناء / بعد المكالمة') + '</span>' +
          '<strong>' + escapeHtml(callInfo.customerName || '-') + '</strong>' +
          '<span class="mono">#' + escapeHtml(callInfo.reservationNumber || callInfo.reservationId) + '</span>' +
          (callInfo.phone ? ('<span class="mono" dir="ltr">' + escapeHtml(callInfo.phone) + '</span>') : '') +
        '</div>' +
        '<div class="rg-call-wrapup-head-actions">' +
          (isDeveloper
            ? ('<button type="button" class="btn btn-sm rg-wrapup-manage-btn" id="rg-wrapup-manage-btn">' + (isEn ? 'Manage Shortcuts' : 'إدارة الاختصارات') + '</button>')
            : '') +
          '<button type="button" class="btn btn-sm" id="rg-wrapup-close" aria-label="' + (isEn ? 'Close' : 'إغلاق') + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="rg-call-wrapup-note-row">' +
        '<input type="text" class="input" id="rg-wrapup-note" placeholder="' + (isEn ? 'Optional quick call note...' : 'ملاحظة سريعة اختيارية عن المكالمة...') + '">' +
      '</div>' +
      '<div class="rg-call-wrapup-actions">' +
        (outcomes.length > 0
          ? outcomes.map(function (out) {
              var cls = out.variant === 'danger' || out.isNoAnswer
                ? 'btn-danger'
                : (out.variant === 'primary' || out.key === 'confirmed' || out.key === 'extending_24h' ? 'btn-primary' : '');
              return '<button type="button" class="btn btn-sm ' + cls + ' rg-wrapup-outcome-btn" data-outcome-key="' + escapeHtml(out.key) + '">' +
                escapeHtml(isEn ? (out.labelEn || out.labelAr) : out.labelAr) +
              '</button>';
            }).join('')
          : '<div class="rg-call-wrapup-empty">' + (isEn ? 'No quick shortcuts configured.' : 'لا توجد اختصارات سريعة مفعّلة حالياً.') + '</div>') +
      '</div>';

    document.body.appendChild(bar);

    var closeBtn = document.getElementById('rg-wrapup-close');
    if (closeBtn) closeBtn.addEventListener('click', closeCallWrapUpBar);

    var manageBtn = document.getElementById('rg-wrapup-manage-btn');
    if (manageBtn && isDeveloper) {
      manageBtn.addEventListener('click', function () {
        openDeveloperCallShortcutsModal(buildAppCtx(), function () {
          if (lastOpenCallInfo) openCallWrapUpBar(lastOpenCallInfo);
        });
      });
    }

    bar.querySelectorAll('.rg-wrapup-outcome-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var oKey = btn.getAttribute('data-outcome-key');
        var outcome = outcomes.find(function (x) { return x.key === oKey; });
        if (!outcome) return;
        var extraNote = String((document.getElementById('rg-wrapup-note') && document.getElementById('rg-wrapup-note').value) || '').trim();
        withActionLock(btn, 'callWrapUp:' + callInfo.reservationId + ':' + oKey, async function () {
          var res;
          if (outcome.isNoAnswer) {
            res = await root.RGApi.callApi('recordNoAnswerFollowUp', {
              reservationId: callInfo.reservationId,
              notes: extraNote
            });
          } else {
            var nextStatus = outcome.suggestedStatus || callInfo.currentStatus || 'قيد الانتظار';
            if (root.RGCrmCore && ((root.RGCrmCore.isValidWorkflowStatus && !root.RGCrmCore.isValidWorkflowStatus(nextStatus)) ||
                (root.RGCrmCore.isManualBlockedWorkflowStatus && root.RGCrmCore.isManualBlockedWorkflowStatus(nextStatus)))) {
              nextStatus = 'قيد الانتظار';
            }
            res = await root.RGApi.callApi('addFollowUp', {
              reservationId: callInfo.reservationId,
              status: nextStatus,
              action: outcome.actionTextAr,
              notes: extraNote || outcome.labelAr
            });
          }
          if (!res || !res.success) {
            toast((res && res.message) || 'تعذر تسجيل نتيجة المكالمة.', true);
            return;
          }
          if (res.queuedOffline || res.offlineQueued) {
            toast('تم حفظ نتيجة المكالمة في طابور عدم الاتصال للمزامنة تلقائياً.');
          } else {
            toast('تم تسجيل نتيجة المكالمة: ' + outcome.labelAr);
          }
          closeCallWrapUpBar();
          if (root.RGApi && root.RGApi.invalidateScopes) {
            root.RGApi.invalidateScopes(['reservations', 'followUps', 'dashboard', 'activity']);
          }
          document.dispatchEvent(new CustomEvent('rg:deltasync', {
            detail: { localMutation: true, reservationId: callInfo.reservationId }
          }));
          refreshCurrentRouteAndNotifications({ manual: true }).catch(function () {});
        });
      });
    });
  }

  function buildAppCtx() {
    return {
      t: t,
      lang: state.prefs.lang,
      state: state,
      appState: root.RGApp,
      toast: toast,
      refreshNotifications: refreshNotifications,
      getUiSimplification: getUiSimplification,
      applyUiSimplification: applyUiSimplification,
      getRoleUiDefaults: getRoleUiDefaults,
      setRoleUiDefaults: setRoleUiDefaults,
      getStatsControlConfig: getStatsControlConfig,
      setStatsControlConfig: setStatsControlConfig,
      getCallWrapupShortcutsConfig: getCallWrapupShortcutsConfig,
      setCallWrapupShortcutsConfig: setCallWrapupShortcutsConfig,
      getActiveCallWrapupShortcuts: getActiveCallWrapupShortcuts,
      mountCallShortcutsControlPanel: mountCallShortcutsControlPanel,
      openDeveloperCallShortcutsModal: openDeveloperCallShortcutsModal,
      getEffectiveRoleUiResolution: getEffectiveRoleUiResolution,
      getRealUser: getRealUser,
      getPreviewState: getPreviewState,
      startPreviewSession: startPreviewSession,
      stopPreviewSession: stopPreviewSession,
      openPreviewRoleModal: openPreviewRoleModal,
      setUnsavedGuard: setUnsavedGuard,
      clearUnsavedGuard: clearUnsavedGuard,
      requestCloseWithGuard: requestCloseWithGuard,
      getLayoutPrefs: getLayoutPrefs,
      saveLayoutPrefs: saveLayoutPrefs,
      getTimeFormat: getTimeFormat,
      getSidebarPosition: getSidebarPosition,
      getTimezoneMode: getTimezoneMode,
      getReservationsDisplayMode: getReservationsDisplayMode,
      getCalendarGranularity: getCalendarGranularity,
      setPersonalPreferences: setPersonalPreferences,
      formatTime: formatTimePref,
      formatDateTime: formatDateTimePref,
      getAnnouncements: getAnnouncements,
      setAnnouncements: setAnnouncements,
      openAnnouncementsManager: openAnnouncementsManager,
      canManageAnnouncements: canManageAnnouncements,
      getActiveLocks: getActiveLocks,
      setActiveLocks: setActiveLocks,
      getHandoverSettings: getHandoverSettings,
      setHandoverSettings: setHandoverSettings,
      downloadIcsFile: downloadIcsFile,
      openCallWrapUpBar: openCallWrapUpBar,
      updateOfflineBanner: updateOfflineBanner,
      openPwaInstallFlow: openPwaInstallFlow,
      toggleEmployeeStatusInState: toggleEmployeeStatusInState,
      deleteEmployeeFromState: deleteEmployeeFromState,
      upsertEmployeeInState: upsertEmployeeInState,
      removeEmployeeLocal: removeEmployeeLocal,
      openPersonalAccountSettingsModal: function (onUpdated) {
        openPersonalAccountSettingsModal(onUpdated);
      },
      openScreenOrganizerModal: function () {
        var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
        if (u) openScreenOrganizerModal(u);
      },
      withActionLock: withActionLock,
      isActionLocked: isActionLocked,
      saveRouteFilters: function () { saveRouteFilters(); },
      onAuthChanged: bootAuthenticatedApp
    };
  }

  var I18N = {
    ar: {
      brand: 'RENTAL GATE CRM',
      nav_dashboard: 'لوحة التحكم',
      nav_reservations: 'الحجوزات',
      nav_inactive_reservations: 'الحجوزات غير الفعالة',
      nav_my_followups: 'متابعاتي',
      nav_team_followups: 'متابعات الفريق',
      nav_problems: 'المشكلات',
      nav_reports: 'التقارير والإحصائيات',
      nav_employees: 'الموظفون',
      nav_activity: 'سجل النشاطات',
      nav_settings: 'الإعدادات',
      nav_group_ops: 'العمليات الرئيسية',
      nav_group_admin: 'التحليلات والإدارة',
      topbar_search_placeholder: 'بحث سريع برقم الحجز، العميل، الهوية، الجوال، الشركة أو السيارة...',
      dash_welcome: 'مرحباً بعودتك، ',
      dash_sub_ops: 'ملخص الأداء التشغيلي ومتابعات الحجوزات الفورية',
      recent_activity: 'أحدث النشاطات',
      recent_reservations: 'أحدث الحجوزات',
      active_problems: 'المشكلات النشطة',
      quick_actions: 'مركز الإجراءات السريعة',
      quick_actions_sub: 'انتقل فوراً لإدارة الحجوزات اليومية أو تصدير التقارير التنفيذية.',
      view_all: 'عرض الكل',
      open_reservations: 'إدارة الحجوزات',
      open_reports: 'التقارير والتصدير',
      logout: 'تسجيل الخروج',
      theme_dark: 'الوضع الليلي',
      theme_light: 'الوضع النهاري',
      lang_toggle: 'EN',
      time_filter: 'الفلتر الزمني',
      range_today: 'اليوم',
      range_7d: 'آخر 7 أيام',
      range_30d: 'آخر 30 يومًا',
      range_month: 'هذا الشهر',
      range_custom: 'نطاق مخصص',
      from_date: 'من تاريخ',
      to_date: 'إلى تاريخ',
      apply: 'تطبيق',
      kpi_total: 'إجمالي الحجوزات',
      kpi_today: 'حجوزات اليوم',
      kpi_new: 'الحجوزات الجديدة',
      kpi_open_problems: 'المشكلات المفتوحة',
      kpi_high_problems: 'المشكلات المرتفعة',
      kpi_today_followups: 'المتابعات اليوم',
      chart_status_dist: 'توزيع الحجوزات حسب الحالة',
      chart_emp_perf: 'أداء الموظفين (المتابعات)',
      chart_daily_fu: 'المتابعات اليومية',
      chart_prb_prio: 'المشكلات حسب الأولوية',
      chart_prb_open_closed: 'المشكلات المفتوحة والمغلقة',
      chart_res_company: 'الحجوزات حسب الشركات',
      chart_emp_comp: 'مقارنة نشاط الموظفين',
      followups_count: 'عدد المتابعات',
      daily_followups: 'المتابعات اليومية',
      problems: 'المشكلات',
      open_problems: 'مفتوحة',
      closed_problems: 'مغلقة / تم الحل',
      reservations: 'الحجوزات',
      assigned_reservations: 'الحجوزات المسندة',
      toggle_columns: 'إظهار / إخفاء الأعمدة',
      pull_reservations: 'سحب الحجوزات',
      export_excel: 'تصدير Excel',
      search_placeholder: 'بحث برقم الحجز، الاسم، الهوية، الجوال، الشركة أو السيارة...',
      res_number_search_placeholder: 'بحث برقم الحجز...',
      res_number_search_label: 'بحث برقم الحجز',
      company: 'الشركة',
      branch: 'الفرع',
      status: 'الحالة',
      employee: 'الموظف',
      priority: 'الأولوية',
      all_companies: 'جميع الشركات',
      all_branches: 'جميع الفروع',
      all_statuses: 'جميع الحالات',
      all_employees: 'جميع الموظفين',
      all_priorities: 'جميع الأولويات',
      unfollowed_only: 'الحجوزات غير المتابعة',
      has_problems_only: 'الحجوزات التي تحتوي على مشكلات',
      reset_filters: 'إعادة ضبط',
      reports_subtitle: 'إعداد وتصدير تقارير Excel وPDF الاحترافية بدعم العربية RTL',
      export_settings_btn: 'إعدادات التصدير (Excel / PDF)',
      generate_report: 'تحديث التقرير',
      refresh: 'تحديث',
      refresh_done: 'تم تحديث البيانات'
    },
    en: {
      brand: 'RENTAL GATE CRM',
      nav_dashboard: 'Dashboard',
      nav_reservations: 'Reservations',
      nav_inactive_reservations: 'Inactive Reservations',
      nav_my_followups: 'My Follow-Ups',
      nav_team_followups: 'Team Follow-Ups',
      nav_problems: 'Problems',
      nav_reports: 'Reports & Export',
      nav_employees: 'Employees',
      nav_activity: 'Activity Log',
      nav_settings: 'Settings & Sync',
      nav_group_ops: 'Core Operations',
      nav_group_admin: 'Analytics & Admin',
      topbar_search_placeholder: 'Quick search booking #, customer, ID, phone, company, car...',
      dash_welcome: 'Welcome back, ',
      dash_sub_ops: 'Real-time CRM operations & reservation pipeline overview',
      recent_activity: 'Recent Activity',
      recent_reservations: 'Recent Reservations',
      active_problems: 'Active Problems',
      quick_actions: 'Command Center',
      quick_actions_sub: 'Jump straight into active reservations or generate formatted CRM reports.',
      view_all: 'View All',
      open_reservations: 'Reservations',
      open_reports: 'Reports & Export',
      logout: 'Sign Out',
      theme_dark: 'Dark Mode',
      theme_light: 'Light Mode',
      lang_toggle: 'عربي',
      time_filter: 'Time Range',
      range_today: 'Today',
      range_7d: 'Last 7 Days',
      range_30d: 'Last 30 Days',
      range_month: 'This Month',
      range_custom: 'Custom',
      from_date: 'From',
      to_date: 'To',
      apply: 'Apply',
      kpi_total: 'Total Reservations',
      kpi_today: "Today's Reservations",
      kpi_new: 'New Reservations',
      kpi_open_problems: 'Open Problems',
      kpi_high_problems: 'High-Priority Problems',
      kpi_today_followups: "Today's Follow-Ups",
      chart_status_dist: 'Reservations by Status',
      chart_emp_perf: 'Employee Performance',
      chart_daily_fu: 'Daily Follow-Ups',
      chart_prb_prio: 'Problems by Priority',
      chart_prb_open_closed: 'Open vs Closed Problems',
      chart_res_company: 'Reservations by Company',
      chart_emp_comp: 'Employee Activity Comparison',
      followups_count: 'Follow-Ups',
      daily_followups: 'Daily Follow-Ups',
      problems: 'Problems',
      open_problems: 'Open',
      closed_problems: 'Closed / Resolved',
      reservations: 'Reservations',
      assigned_reservations: 'Assigned Reservations',
      toggle_columns: 'Columns',
      pull_reservations: 'Pull Reservations',
      export_excel: 'Export Excel',
      search_placeholder: 'Search booking #, name, ID, phone, company, or car...',
      res_number_search_placeholder: 'Search by reservation #...',
      res_number_search_label: 'Search by reservation number',
      company: 'Company',
      branch: 'Branch',
      status: 'Status',
      employee: 'Employee',
      priority: 'Priority',
      all_companies: 'All Companies',
      all_branches: 'All Branches',
      all_statuses: 'All Statuses',
      all_employees: 'All Employees',
      all_priorities: 'All Priorities',
      unfollowed_only: 'Unfollowed Only',
      has_problems_only: 'With Problems Only',
      reset_filters: 'Reset Filters',
      reports_subtitle: 'Configure and export formatted Excel & RTL Arabic PDF reports',
      export_settings_btn: 'Export Settings (Excel / PDF)',
      generate_report: 'Refresh Report',
      refresh: 'Refresh',
      refresh_done: 'Data refreshed'
    }
  };

  function t(key) {
    var dict = I18N[state.prefs.lang] || I18N.ar;
    return dict[key] || key;
  }

  function savePrefs(userOverride) {
    try {
      var serialized = JSON.stringify(state.prefs);
      localStorage.setItem(PREFS_KEY, serialized);
      var u = userOverride || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
      if (u && u.id) {
        localStorage.setItem(getUserPrefsStorageKey(u), serialized);
      }
    } catch (_e) {}
  }

  function applyThemeAndLang() {
    var html = document.documentElement;
    html.setAttribute('lang', state.prefs.lang === 'en' ? 'en' : 'ar');
    html.setAttribute('dir', state.prefs.lang === 'en' ? 'ltr' : 'rtl');
    html.setAttribute('data-theme', state.prefs.theme === 'dark' ? 'dark' : 'light');
    html.setAttribute('data-nav-pos', getSidebarPosition());
    html.setAttribute('data-time-format', getTimeFormat());
    html.setAttribute('data-timezone-mode', getTimezoneMode());
    html.setAttribute('data-reservations-view', getReservationsDisplayMode());
    if (state.prefs.theme === 'dark') html.classList.add('dark');
    else html.classList.remove('dark');
    applyUiSimplification(state.uiSimplification, true);
  }

  function toast(message, isError) {
    var stack = document.getElementById('toast-stack');
    if (!stack) return;
    while (stack.children.length >= 2) {
      stack.removeChild(stack.firstChild);
    }
    var el = document.createElement('div');
    el.className = 'toast-item';
    if (isError) {
      el.style.borderColor = 'var(--status-danger-border)';
      el.style.color = 'var(--status-danger-text)';
    }
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  async function refreshNotifications(opts) {
    if (!root.RGAuth.getUser()) return;
    var payload = (opts && opts.silent) ? { silentRefresh: true } : {};
    var res = await root.RGApi.callApi('getNotifications', payload);
    if (res && res.success && res.data) {
      applyNotificationsState(res.data);
    }
  }

  function buildThemeToggleHtml(theme, compactOnly) {
    var isDark = theme === 'dark';
    var nextLabel = isDark ? t('theme_light') : t('theme_dark');
    var sunIcon = '<svg class="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
    var moonIcon = '<svg class="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var iconMarkup = '<span class="theme-toggle-icon-wrap" aria-hidden="true">' + sunIcon + moonIcon + '</span>';
    if (compactOnly) {
      return iconMarkup + '<span class="theme-toggle-label">' + nextLabel + '</span>';
    }
    return iconMarkup + '<span class="topbar-desktop-only theme-toggle-label">' + nextLabel + '</span>';
  }

  function syncThemeButtonsUI() {
    var theme = state.prefs.theme === 'dark' ? 'dark' : 'light';
    var nextLabel = theme === 'dark' ? t('theme_light') : t('theme_dark');

    var topBtn = document.getElementById('theme-toggle-btn');
    if (topBtn) {
      topBtn.setAttribute('aria-label', nextLabel);
      topBtn.setAttribute('title', nextLabel);
      topBtn.setAttribute('data-theme-state', theme);
      var lbl = topBtn.querySelector('.theme-toggle-label');
      if (lbl) lbl.textContent = nextLabel;
    }

    var loginBtn = document.getElementById('login-theme-btn');
    if (loginBtn) {
      loginBtn.setAttribute('aria-label', nextLabel);
      loginBtn.setAttribute('title', nextLabel);
      loginBtn.setAttribute('data-theme-state', theme);
      var lLbl = loginBtn.querySelector('.theme-toggle-label');
      if (lLbl) lLbl.textContent = nextLabel;
    }

    var profileThemeLabel = document.querySelector('#profile-theme-btn .rg-profile-theme-label');
    if (profileThemeLabel) {
      profileThemeLabel.textContent = nextLabel;
    }
  }

  function commitThemeChange(nextTheme) {
    state.prefs.theme = nextTheme === 'dark' ? 'dark' : 'light';
    savePrefs();
    applyThemeAndLang();
    syncThemeButtonsUI();

    var ctx = buildAppCtx();
    if (root.RGDashboard && typeof root.RGDashboard.refreshTheme === 'function') {
      try { root.RGDashboard.refreshTheme(ctx); } catch (_e) {}
    }
    if (root.RGReports && typeof root.RGReports.refreshTheme === 'function') {
      try { root.RGReports.refreshTheme(ctx); } catch (_e2) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('rg:themechange', { detail: { theme: state.prefs.theme } }));
    } catch (_e3) {}

    var curU = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (curU && curU.id) {
      saveLayoutPrefs({ theme: state.prefs.theme }, { reRenderNav: false, persist: true }).catch(function () {});
    }
  }

  function toggleThemeWithReveal(triggerEl) {
    var nextTheme = state.prefs.theme === 'dark' ? 'light' : 'dark';
    var reduced = false;
    try {
      reduced = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_e) {}

    if (reduced || typeof document.startViewTransition !== 'function') {
      commitThemeChange(nextTheme);
      return;
    }

    var x = Math.round((window.innerWidth || 1280) / 2);
    var y = 32;
    if (triggerEl && typeof triggerEl.getBoundingClientRect === 'function') {
      var rect = triggerEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        x = Math.round(rect.left + rect.width / 2);
        y = Math.round(rect.top + rect.height / 2);
      }
    }

    var vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var endRadius = Math.ceil(Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)));

    document.documentElement.classList.add('rg-theme-transitioning');

    var transition;
    try {
      transition = document.startViewTransition(function () {
        commitThemeChange(nextTheme);
      });
    } catch (_err) {
      document.documentElement.classList.remove('rg-theme-transitioning');
      commitThemeChange(nextTheme);
      return;
    }

    transition.ready.then(function () {
      document.documentElement.animate(
        {
          clipPath: [
            'circle(0px at ' + x + 'px ' + y + 'px)',
            'circle(' + endRadius + 'px at ' + x + 'px ' + y + 'px)'
          ]
        },
        {
          duration: 220,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    }).catch(function () {});

    transition.finished.finally(function () {
      document.documentElement.classList.remove('rg-theme-transitioning');
    });
  }

  function closeProfileMenu() {
    var existing = document.getElementById('rg-profile-menu');
    var trigger = document.getElementById('user-profile-menu-btn');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (existing) {
      existing.remove();
      return true;
    }
    return false;
  }

  function toggleProfileMenu() {
    var existing = document.getElementById('rg-profile-menu');
    if (existing) {
      closeProfileMenu();
      return;
    }

    var existingNotif = document.getElementById('notif-popover');
    if (existingNotif) existingNotif.remove();

    var trigger = document.getElementById('user-profile-menu-btn');
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!trigger || !user) return;

    var roleLabels = root.RGCrmCore.ROLE_LABELS[state.prefs.lang] || root.RGCrmCore.ROLE_LABELS.ar;
    var isEn = state.prefs.lang === 'en';

    var menu = document.createElement('div');
    menu.id = 'rg-profile-menu';
    menu.className = 'rg-profile-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', isEn ? 'User Menu' : 'قائمة المستخدم');

    var delNoteHtml = user.activeDelegation
      ? ('<div style="margin-top:4px;font-size:11px;font-weight:700;color:var(--brand-primary);">' +
          (isEn ? 'Temp Supervisor until ' : 'تفويض مشرف مؤقت حتى ') +
          escapeHtml(formatDateTimePref(user.activeDelegation.expiresAt)) +
         '</div>')
      : '';
    var showInstallBtn = !isStandalonePwa();

    menu.innerHTML =
      '<div class="rg-profile-menu-head">' +
        '<div class="sidebar-user-avatar" style="width:38px;height:38px;">' + String(user.name || 'U').charAt(0) + '</div>' +
        '<div style="min-width:0;flex:1;">' +
          '<div class="sidebar-user-name">' + escapeHtml(user.name) + '</div>' +
          '<div class="sidebar-user-role" style="font-size:11px;">' + (roleLabels[user.role] || user.role) + (user.username ? ' · <span class="mono" dir="ltr" style="unicode-bidi:isolate;">@' + escapeHtml(user.username) + '</span>' : '') + '</div>' +
          delNoteHtml +
        '</div>' +
      '</div>' +
      '<div class="rg-profile-menu-items">' +
        '<button type="button" class="rg-menu-item rg-ui-profile-personal" role="menuitem" id="profile-personal-settings-btn">' +
          renderIcon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z') +
          '<span>' + (isEn ? 'Personal Account Settings' : 'إعدادات الحساب الشخصي') + '</span>' +
        '</button>' +
        (((getRealUser() || user).role === 'developer')
          ? '<button type="button" class="rg-menu-item rg-ui-edit-dev-btn" role="menuitem" id="profile-edit-developer-btn">' +
              renderIcon('M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z') +
              '<span>' + (isEn ? 'Edit Developer Data' : 'تعديل بيانات المبرمج') + '</span>' +
            '</button>'
          : '') +
        (isNavRouteAllowedForUser({ id: 'my-followups' }, user)
          ? '<button type="button" class="rg-menu-item" role="menuitem" data-profile-route="my-followups">' +
              renderIcon('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11') +
              '<span>' + t('nav_my_followups') + '</span>' +
            '</button>'
          : '') +
        (isNavRouteAllowedForUser({ id: 'settings' }, user)
          ? '<button type="button" class="rg-menu-item" role="menuitem" data-profile-route="settings">' +
              renderIcon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z') +
              '<span>' + t('nav_settings') + '</span>' +
            '</button>'
          : '') +
        (showInstallBtn
          ? ('<button type="button" class="rg-menu-item" role="menuitem" id="profile-pwa-install-btn">' +
               renderIcon('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3') +
               '<span>' + (isEn ? 'Install App (PWA)' : 'تثبيت التطبيق على الجهاز (PWA)') + '</span>' +
             '</button>')
          : '') +
        '<button type="button" class="rg-menu-item" role="menuitem" id="profile-theme-btn">' +
          renderIcon(state.prefs.theme === 'dark'
            ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
            : 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z') +
          '<span class="rg-profile-theme-label">' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '</span>' +
        '</button>' +
        '<button type="button" class="rg-menu-item" role="menuitem" id="profile-lang-btn">' +
          renderIcon('M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0v20M2 12h20') +
          '<span>' + (isEn ? 'العربية (RTL)' : 'English (LTR)') + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="rg-profile-menu-foot">' +
        '<button type="button" class="rg-menu-item is-danger" role="menuitem" id="profile-logout-btn">' +
          renderIcon('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9') +
          '<span>' + t('logout') + '</span>' +
        '</button>' +
      '</div>';

    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');

    var rect = trigger.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var menuW = Math.min(268, vw - 20);
    var isRtl = document.documentElement.getAttribute('dir') !== 'ltr';
    var leftPos = isRtl ? (rect.right - menuW) : rect.left;
    if (leftPos + menuW > vw - 10) leftPos = vw - 10 - menuW;
    if (leftPos < 10) leftPos = 10;
    var menuH = menu.offsetHeight || 290;
    var navPos = getSidebarPosition();
    var openBelow = navPos === 'top' || (rect.top < menuH + 22 && (vh - rect.bottom) >= menuH + 22);
    var topPos = openBelow
      ? Math.min(vh - menuH - 12, rect.bottom + 8)
      : Math.max(12, Math.min(vh - menuH - 12, rect.top - menuH - 10));

    menu.style.width = menuW + 'px';
    menu.style.left = Math.round(leftPos) + 'px';
    menu.style.top = Math.round(topPos) + 'px';

    var profPersonalBtn = document.getElementById('profile-personal-settings-btn');
    if (profPersonalBtn) {
      profPersonalBtn.addEventListener('click', function () {
        closeProfileMenu();
        var sb = document.getElementById('app-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
        openPersonalAccountSettingsModal();
      });
    }

    var profEditDevBtn = document.getElementById('profile-edit-developer-btn');
    if (profEditDevBtn) {
      profEditDevBtn.addEventListener('click', function () {
        closeProfileMenu();
        var sb = document.getElementById('app-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
        if (root.RGEmployees && typeof root.RGEmployees.openEditDeveloperModal === 'function') {
          root.RGEmployees.openEditDeveloperModal(buildAppCtx(), function () { renderRoute(); });
        }
      });
    }

    var profPwaBtn = document.getElementById('profile-pwa-install-btn');
    if (profPwaBtn) {
      profPwaBtn.addEventListener('click', function () {
        closeProfileMenu();
        openPwaInstallFlow();
      });
    }

    menu.querySelectorAll('[data-profile-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = btn.getAttribute('data-profile-route');
        closeProfileMenu();
        var sb = document.getElementById('app-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
        requestCloseWithGuard(function () {
          state.route = r;
          renderRoute();
        });
      });
    });

    var profThemeBtn = document.getElementById('profile-theme-btn');
    if (profThemeBtn) {
      profThemeBtn.addEventListener('click', function () {
        closeProfileMenu();
        toggleThemeWithReveal(document.getElementById('theme-toggle-btn') || trigger);
      });
    }

    var profLangBtn = document.getElementById('profile-lang-btn');
    if (profLangBtn) {
      profLangBtn.addEventListener('click', function () {
        closeProfileMenu();
        var topLang = document.getElementById('lang-toggle-btn');
        if (topLang) topLang.click();
      });
    }

    var profLogoutBtn = document.getElementById('profile-logout-btn');
    if (profLogoutBtn) {
      profLogoutBtn.addEventListener('click', function () {
        closeProfileMenu();
        var topLogout = document.getElementById('logout-btn');
        if (topLogout) topLogout.click();
      });
    }
  }

  function closeNotificationsPopover() {
    var pop = document.getElementById('notif-popover');
    var toggleBtn = document.getElementById('notif-toggle-btn');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    if (pop) {
      pop.remove();
      return true;
    }
    return false;
  }

  function toggleNotificationsPopover() {
    var existing = document.getElementById('notif-popover');
    if (existing) {
      closeNotificationsPopover();
      return;
    }
    closeProfileMenu();
    if (root.RGCrmDropdowns && root.RGCrmDropdowns.closeActive) {
      root.RGCrmDropdowns.closeActive();
    }

    var toggleBtn = document.getElementById('notif-toggle-btn');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');

    var pop = document.createElement('div');
    pop.id = 'notif-popover';
    pop.className = 'notif-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', state.prefs.lang === 'en' ? 'Notifications' : 'الإشعارات');
    var items = state.notifications.items || [];
    var escNotif = function (val) {
      return String(val === null || val === undefined ? '' : val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    pop.innerHTML =
      '<div class="notif-popover-head">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<strong>' + (state.prefs.lang === 'en' ? 'Notifications' : 'الإشعارات') + '</strong>' +
          '<span class="status-tag status-danger tabular-nums">' + (state.notifications.unreadCount || 0) + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-sm" id="notif-mark-all">' + (state.prefs.lang === 'en' ? 'Mark all read' : 'تحديد الكل كمقروء') + '</button>' +
      '</div>' +
      (items.length === 0
        ? '<div class="empty-state" style="padding:20px;">' + (state.prefs.lang === 'en' ? 'No notifications right now.' : 'لا توجد إشعارات حاليًا.') + '</div>'
        : items.map(function (n) {
            var target = (root.RGCrmCore && root.RGCrmCore.resolveNotificationTarget)
              ? root.RGCrmCore.resolveNotificationTarget(n)
              : { kind: 'none', entityId: '' };
            var isMention = n.type === 'mention';
            var actionHint = target.kind === 'problem'
              ? ('<span style="font-size:11px;color:var(--brand-primary);font-weight:700;">' + (state.prefs.lang === 'en' ? 'View problem →' : 'اضغط لاستعراض المشكلة ←') + '</span>')
              : (target.kind === 'reservation' ? ('<span style="font-size:11px;color:var(--brand-primary);font-weight:700;">' + (state.prefs.lang === 'en' ? 'Open booking →' : 'اضغط لفتح الحجز ←') + '</span>') : '');
            return '<button type="button" class="notif-item' + (n.isRead ? '' : ' unread') + (isMention ? ' is-mention' : '') + '" data-nid="' + escNotif(n.id) + '" style="text-align:start;font-family:inherit;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;">' +
                '<strong>' + escNotif(n.title) + '</strong>' +
                (isMention ? '<span class="rg-mention-badge">@</span>' : '') +
              '</div>' +
              '<span style="font-size:12.5px;color:var(--text-secondary);">' + escNotif(n.message) + '</span>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;">' +
                '<span class="mono" style="font-size:11px;color:var(--text-muted);">' + escNotif(formatDateTimePref(n.createdAt)) + '</span>' +
                actionHint +
              '</div>' +
            '</button>';
          }).join(''));

    document.body.appendChild(pop);

    document.getElementById('notif-mark-all').addEventListener('click', function () {
      var markBtn = document.getElementById('notif-mark-all');
      withActionLock(markBtn, 'markNotificationRead:ALL', function () {
        var nextItems = (state.notifications.items || []).map(function (n) {
          return Object.assign({}, n, { isRead: true });
        });
        applyNotificationsState({ items: nextItems, unreadCount: 0 });
        if (root.RGApi.applyOptimisticMutation) {
          root.RGApi.applyOptimisticMutation('markNotificationRead', { markAll: true });
        }
        closeNotificationsPopover();
        return root.RGApi.callApi('markNotificationRead', { markAll: true, _keepOptimisticCache: true });
      });
    });

    pop.querySelectorAll('[data-nid]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nid = btn.getAttribute('data-nid');
        var notif = items.find(function (x) { return x.id === nid; }) || null;
        closeNotificationsPopover();

        if (notif && !notif.isRead) {
          var nextItems = (state.notifications.items || []).map(function (n) {
            return n.id === nid ? Object.assign({}, n, { isRead: true }) : n;
          });
          var nextUnread = nextItems.filter(function (n) { return !n.isRead; }).length;
          applyNotificationsState({ items: nextItems, unreadCount: nextUnread });
          if (root.RGApi.applyOptimisticMutation) {
            root.RGApi.applyOptimisticMutation('markNotificationRead', { notificationId: nid });
          }
          root.RGApi.callApi('markNotificationRead', { notificationId: nid, _keepOptimisticCache: true }).catch(function () {});
        }

        if (!notif) return;
        var target = (root.RGCrmCore && root.RGCrmCore.resolveNotificationTarget)
          ? root.RGCrmCore.resolveNotificationTarget(notif)
          : { kind: 'none', entityId: '' };

        var ctx = buildAppCtx();
        if (target.kind === 'problem' && root.RGProblems && root.RGProblems.openProblemById) {
          if (state.route !== 'problems') {
            state.route = 'problems';
            renderRoute();
          }
          root.RGProblems.openProblemById(target.entityId, ctx, function () {
            if (state.route === 'problems') renderRoute();
          });
        } else if (target.kind === 'reservation' && root.RGReservations && root.RGReservations.openReservationDrawer) {
          var empCached = root.RGApi.getCachedData ? root.RGApi.getCachedData('getEmployees', {}, true) : null;
          var emps = (empCached && empCached.items) || [];
          root.RGReservations.openReservationDrawer(target.entityId, ctx, emps, function () {
            renderRoute();
          });
        }
      });
    });
  }

  async function renderActivityLog(container, ctx) {
    var res = await root.RGApi.callApi('getActivityLogs', { abortKey: 'act:logs' });
    if (res && res.aborted) return;
    if (!res || !res.success) {
      var errMsg = (res && res.message) || 'تعذر تحميل سجل النشاطات.';
      container.innerHTML =
        '<div class="surface-card">' +
          '<div class="section-header"><div><h2 class="section-title">' + ctx.t('nav_activity') + '</h2></div></div>' +
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">تعذر تحميل البيانات</div>' +
              '<div class="rg-error-banner-msg">' + escapeHtml(errMsg) + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="act-retry-btn">إعادة المحاولة</button>' +
          '</div>' +
        '</div>';
      var actRetryBtn = document.getElementById('act-retry-btn');
      if (actRetryBtn) {
        actRetryBtn.addEventListener('click', function () {
          renderActivityLog(container, ctx);
        });
      }
      return;
    }
    var items = (res.data && res.data.items) || [];
    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header"><div><h2 class="section-title">' + ctx.t('nav_activity') + '</h2><p class="section-subtitle">سجل غير قابل للتعديل أو الحذف لجميع عمليات النظام مع مقارنة القيم قبل وبعد التعديل.</p></div></div>' +
        (items.length === 0
          ? '<div class="empty-state">لا توجد نشاطات مسجلة.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>المستخدم</th><th>نوع العملية</th><th>العنصر المرتبط</th><th>التفاصيل والفروقات (قبل ← بعد)</th><th>التاريخ</th><th>الوقت</th>' +
            '</tr></thead><tbody>' +
              items.map(function (l) {
                var changes = Array.isArray(l.changes) ? l.changes : [];
                var diffsHtml = changes.length > 0
                  ? ('<div class="rg-audit-diffs">' +
                      changes.map(function (ch) {
                        return '<span class="rg-diff-chip">' +
                          '<span class="rg-diff-label">' + escapeHtml(ch.label || ch.field || '') + ':</span> ' +
                          '<span class="rg-diff-before">' + escapeHtml(ch.before != null ? ch.before : '-') + '</span>' +
                          '<span class="rg-diff-arrow" aria-hidden="true">←</span>' +
                          '<span class="rg-diff-after">' + escapeHtml(ch.after != null ? ch.after : '-') + '</span>' +
                        '</span>';
                      }).join('') +
                    '</div>')
                  : '';
                return '<tr>' +
                  '<td><strong>' + escapeHtml(l.userName) + '</strong></td>' +
                  '<td><span class="status-tag status-info">' + escapeHtml(l.actionType) + '</span></td>' +
                  '<td class="mono">' + escapeHtml(l.entityType ? l.entityType + ': ' + l.entityId : '-') + '</td>' +
                  '<td><div>' + escapeHtml(l.details || '-') + '</div>' + diffsHtml + '</td>' +
                  '<td class="mono tabular-nums" style="white-space:nowrap;">' + escapeHtml(root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(l.logDate) : l.logDate) + '</td>' +
                  '<td class="mono tabular-nums" style="white-space:nowrap;">' + escapeHtml(ctx.formatTime ? ctx.formatTime(l.logTime) : l.logTime) + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>') +
      '</div>';
  }

  function cleanAutoBindQueryFromAddressBar() {
    try {
      if (!window.location.search || !window.history || !window.history.replaceState) return;
      var q = window.location.search.replace(/^\?/, '').split('&').filter(function (part) {
        var k = part.split('=')[0];
        return k && k !== 'gasUrl' && k !== 'gas' && k !== 'api';
      });
      var nextSearch = q.length ? ('?' + q.join('&')) : '';
      var nextUrl = window.location.pathname + nextSearch + (window.location.hash || '');
      window.history.replaceState(null, '', nextUrl);
    } catch (e) {}
  }

  function clearUiSimplificationClasses() {
    var html = document.documentElement;
    if (!html || !html.classList) return;
    Array.from(html.classList).forEach(function (cls) {
      if (cls && cls.indexOf('rg-ui-hide-') === 0) {
        html.classList.remove(cls);
      }
    });
  }

  function renderLoginScreen() {
    clearUiSimplificationClasses();
    var appRoot = document.getElementById('app-root');
    var connInfo = root.RGApi.getConnectionInfo ? root.RGApi.getConnectionInfo() : { url: root.RGApi.getGasUrl(), source: '', defaultUrl: '' };
    var isBackendLive = Boolean(root.RGApi.isBackendConnected && root.RGApi.isBackendConnected());
    var isLive = Boolean(isBackendLive || connInfo.url);
    var isEn = state.prefs.lang === 'en';
    cleanAutoBindQueryFromAddressBar();
    if (isLive && root.RGApi.warmUpGas) {
      root.RGApi.warmUpGas();
    }

    var eyeIconSvg = '<svg class="auth-eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

    appRoot.innerHTML =
      '<main class="auth-screen">' +
        '<section class="auth-shell">' +
          '<div class="auth-form-panel">' +
            '<div class="auth-form-container">' +
              '<header class="auth-panel-topbar">' +
                '<div class="auth-panel-brand">' +
                  '<div class="auth-panel-logo-wrap"><img src="' + assetUrl('assets/images/logo.png') + '" alt="RENTAL GATE" class="auth-panel-logo"></div>' +
                  '<div class="auth-panel-brand-copy">' +
                    '<span class="auth-panel-brand-name" dir="ltr">RENTAL GATE</span>' +
                    '<span class="auth-panel-brand-sub" dir="ltr">Rental Gate CRM</span>' +
                  '</div>' +
                '</div>' +
                '<div class="auth-toolbar-mini">' +
                  '<button type="button" class="btn btn-sm theme-toggle-btn" id="login-theme-btn" data-theme-state="' + (state.prefs.theme === 'dark' ? 'dark' : 'light') + '" aria-label="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '" title="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '">' + buildThemeToggleHtml(state.prefs.theme, true) + '</button>' +
                  '<button type="button" class="btn btn-sm" id="login-lang-btn">' + t('lang_toggle') + '</button>' +
                '</div>' +
              '</header>' +
              '<div class="auth-form-core">' +
                '<div class="auth-form-header">' +
                  '<h1>' + (isEn ? 'Sign In' : 'تسجيل الدخول') + '</h1>' +
                  '<p>' + (isEn ? 'Enter your work account credentials to continue' : 'أدخل بيانات حسابك الوظيفي للمتابعة') + '</p>' +
                '</div>' +
                '<form id="login-form" novalidate class="auth-login-form">' +
                  '<div class="form-group">' +
                    '<label class="form-label" for="login-username">' + (isEn ? 'Username' : 'اسم المستخدم') + '</label>' +
                    '<input class="input mono auth-input" id="login-username" dir="ltr" lang="en" autocapitalize="none" spellcheck="false" autocomplete="username" placeholder="admin" required>' +
                  '</div>' +
                  '<div class="form-group">' +
                    '<label class="form-label" for="login-password">' + (isEn ? 'Password' : 'كلمة المرور') + '</label>' +
                    '<div class="password-field-wrap">' +
                      '<input class="input auth-input" type="password" id="login-password" dir="ltr" lang="en" autocomplete="current-password" placeholder="••••••••" required>' +
                      '<button type="button" class="password-toggle-btn" id="toggle-login-password" aria-label="' + (isEn ? 'Show password' : 'إظهار كلمة المرور') + '">' + eyeIconSvg + '<span class="auth-pwd-toggle-text">' + (isEn ? 'Show' : 'إظهار') + '</span></button>' +
                    '</div>' +
                  '</div>' +
                  '<div id="login-error" class="form-error hidden" role="alert"></div>' +
                  '<button type="submit" class="btn btn-primary auth-submit-btn" id="login-submit-btn">' + (isEn ? 'Sign In to System' : 'دخول إلى النظام') + '</button>' +
                '</form>' +
                (!isLive ? (
                  '<div class="auth-mode-box">' +
                    '<div class="auth-demo-quick">' +
                      '<button type="button" class="btn btn-sm demo-fill-btn" data-u="developer" data-p="Dev@123">' + (isEn ? 'Developer' : 'المبرمج (developer)') + '</button>' +
                      '<button type="button" class="btn btn-sm demo-fill-btn" data-u="admin" data-p="Admin@123">' + (isEn ? 'Admin' : 'المدير (admin)') + '</button>' +
                      '<button type="button" class="btn btn-sm demo-fill-btn" data-u="supervisor" data-p="Super@123">' + (isEn ? 'Supervisor' : 'المشرف (supervisor)') + '</button>' +
                      '<button type="button" class="btn btn-sm demo-fill-btn" data-u="agent1" data-p="Agent@123">' + (isEn ? 'Agent' : 'موظف (agent1)') + '</button>' +
                    '</div>' +
                  '</div>'
                ) : '') +
              '</div>' +
              '<footer class="auth-panel-footer">' +
                '<div class="rg-powered-by rg-powered-by-auth" dir="ltr">powerd by zeyad</div>' +
              '</footer>' +
            '</div>' +
          '</div>' +
          '<div class="auth-brand-panel">' +
            '<img src="' + assetUrl('assets/images/login-bg.png') + '" alt="" class="auth-brand-bg-img" aria-hidden="true">' +
            '<div class="auth-visual-stage">' +
              '<div class="auth-visual-wordmark">' +
                '<div class="auth-visual-brand-title" dir="ltr">RENTAL GATE</div>' +
                '<div class="auth-visual-brand-rule" aria-hidden="true"></div>' +
                '<p class="auth-visual-brand-sub">' + (isEn ? 'Reservations & Customer Operations CRM' : 'نظام إدارة الحجوزات وخدمة العملاء') + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="auth-visual-pillars" aria-label="System Capabilities">' +
              '<span>' + (isEn ? 'Live Reservations' : 'حجوزات فورية') + '</span>' +
              '<span class="auth-pillar-sep" aria-hidden="true"></span>' +
              '<span>' + (isEn ? 'Team Follow-Ups' : 'متابعات الفريق') + '</span>' +
              '<span class="auth-pillar-sep" aria-hidden="true"></span>' +
              '<span>' + (isEn ? 'Executive Reports' : 'تقارير تنفيذية') + '</span>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</main>';

    var brandBgImg = document.querySelector('.auth-brand-bg-img');
    if (brandBgImg) {
      var bgFallbacks = ['assets/images/login-bg.jpg', 'assets/images/login-bg.webp', 'assets/images/login-bg.jpeg'];
      var bgIdx = 0;
      brandBgImg.addEventListener('error', function () {
        if (bgIdx < bgFallbacks.length) {
          brandBgImg.src = assetUrl(bgFallbacks[bgIdx++]);
        }
      });
    }

    var loginThemeBtn = document.getElementById('login-theme-btn');
    if (loginThemeBtn) {
      loginThemeBtn.addEventListener('click', function () {
        toggleThemeWithReveal(loginThemeBtn);
      });
    }

    document.getElementById('login-lang-btn').addEventListener('click', function () {
      state.prefs.lang = state.prefs.lang === 'ar' ? 'en' : 'ar';
      savePrefs();
      applyThemeAndLang();
      renderLoginScreen();
    });

    var pwdInput = document.getElementById('login-password');
    var pwdToggleBtn = document.getElementById('toggle-login-password');
    if (pwdInput && pwdToggleBtn) {
      pwdToggleBtn.addEventListener('click', function () {
        var nextType = pwdInput.type === 'password' ? 'text' : 'password';
        pwdInput.type = nextType;
        var lblEl = pwdToggleBtn.querySelector('.auth-pwd-toggle-text');
        var nextText = nextType === 'text' ? (isEn ? 'Hide' : 'إخفاء') : (isEn ? 'Show' : 'إظهار');
        if (lblEl) {
          lblEl.textContent = nextText;
        } else {
          pwdToggleBtn.textContent = nextText;
        }
        pwdToggleBtn.setAttribute('aria-label', nextType === 'text' ? (isEn ? 'Hide password' : 'إخفاء كلمة المرور') : (isEn ? 'Show password' : 'إظهار كلمة المرور'));
      });
    }

    async function performLoginSubmit() {
      var errEl = document.getElementById('login-error');
      var submitBtn = document.getElementById('login-submit-btn');
      var uEl = document.getElementById('login-username');
      var pEl = document.getElementById('login-password');
      if (!errEl || !submitBtn || !uEl || !pEl) return;

      errEl.classList.add('hidden');
      errEl.textContent = '';

      var u = (root.RGCrmCore && root.RGCrmCore.normalizeLoginUsername)
        ? root.RGCrmCore.normalizeLoginUsername(uEl.value)
        : String(uEl.value || '').trim();
      var p = String(pEl.value || '');
      if (!u || !p) {
        errEl.textContent = isEn ? 'Please enter your username and password.' : 'يرجى إدخال اسم المستخدم وكلمة المرور.';
        errEl.classList.remove('hidden');
        if (!u) uEl.focus();
        else pEl.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = isEn ? 'Signing in...' : 'جاري الدخول...';
      var dashRange = (state.dashboard && state.dashboard.range) || '30d';
      var res = await root.RGAuth.login(u, p, { range: dashRange });

      if (!res || !res.success) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEn ? 'Sign In to System' : 'دخول إلى النظام';
        var rawMsg = (res && res.message) || (isEn ? 'Unable to sign in. Please verify your credentials.' : 'تعذر تسجيل الدخول، يرجى التحقق من البيانات.');
        if (isLive && rawMsg.indexOf('اسم المستخدم أو كلمة المرور غير صحيحة') !== -1) {
          errEl.textContent = rawMsg + ' لا يوجد حساب مسجّل بهذه البيانات، يرجى التأكد من صحة بيانات الدخول أو التواصل مع المبرمج للتحقق من المشكلة.';
        } else {
          errEl.textContent = rawMsg;
        }
        errEl.classList.remove('hidden');
        return;
      }
      await bootAuthenticatedApp();
    }

    document.querySelectorAll('.demo-fill-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('login-username').value = btn.getAttribute('data-u');
        document.getElementById('login-password').value = btn.getAttribute('data-p');
        performLoginSubmit();
      });
    });

    document.getElementById('login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      performLoginSubmit();
    });
  }

  var NAV_ITEMS = [
    { id: 'dashboard', key: 'nav_dashboard', group: 'ops', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { id: 'reservations', key: 'nav_reservations', group: 'ops', icon: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z' },
    { id: 'my-followups', key: 'nav_my_followups', group: 'ops', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    { id: 'team-followups', key: 'nav_team_followups', group: 'ops', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm14 14v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'problems', key: 'nav_problems', group: 'ops', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
    { id: 'reports', key: 'nav_reports', group: 'admin', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
    { id: 'employees', key: 'nav_employees', group: 'admin', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
    { id: 'activity', key: 'nav_activity', group: 'admin', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'settings', key: 'nav_settings', group: 'admin', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }
  ];

  function renderIcon(pathData) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + pathData + '"/></svg>';
  }

  function buildLoadingSkeletonHtml(title, routeId) {
    var rId = String(routeId || '');
    var headerRow =
      '<div class="rg-skeleton-interactive rg-skeleton-toolbar">' +
        '<div style="display:flex;flex-direction:column;gap:8px;min-width:180px;flex:1;">' +
          '<div class="rg-skeleton-line lg"></div>' +
          '<div class="rg-skeleton-line sm"></div>' +
        '</div>' +
        '<div class="rg-skeleton-pills">' +
          '<div class="rg-skeleton-pill"></div>' +
          '<div class="rg-skeleton-pill"></div>' +
          '<div class="rg-skeleton-pill"></div>' +
        '</div>' +
      '</div>';

    var bodyHtml = '';
    if (rId === 'dashboard') {
      bodyHtml =
        '<div class="rg-skeleton-kpis">' +
          '<div class="rg-skeleton-interactive rg-skeleton-kpi"><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line md"></div></div>' +
          '<div class="rg-skeleton-interactive rg-skeleton-kpi"><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line md"></div></div>' +
          '<div class="rg-skeleton-interactive rg-skeleton-kpi"><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line md"></div></div>' +
          '<div class="rg-skeleton-interactive rg-skeleton-kpi"><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line md"></div></div>' +
        '</div>' +
        '<div class="rg-skeleton-split">' +
          '<div class="rg-skeleton-interactive rg-skeleton-panel"><div class="rg-skeleton-line md"></div><div class="rg-skeleton-box" style="height:175px;"></div></div>' +
          '<div class="rg-skeleton-interactive rg-skeleton-panel"><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>' +
        '</div>';
    } else if (rId === 'reservations' || rId === 'employees' || rId === 'activity' || rId === 'problems') {
      var rows = '';
      for (var i = 0; i < 5; i++) {
        rows +=
          '<div class="rg-skeleton-table-row">' +
            '<div class="rg-skeleton-line md"></div>' +
            '<div class="rg-skeleton-line lg" style="width:78%;"></div>' +
            '<div class="rg-skeleton-line sm" style="width:70%;"></div>' +
            '<div class="rg-skeleton-line sm" style="width:65%;"></div>' +
            '<div class="rg-skeleton-line sm" style="width:55%;"></div>' +
          '</div>';
      }
      bodyHtml =
        '<div class="rg-skeleton-interactive rg-skeleton-table-rows">' +
          rows +
        '</div>';
    } else if (rId === 'reports') {
      bodyHtml =
        '<div class="rg-skeleton-split">' +
          '<div class="rg-skeleton-interactive rg-skeleton-panel"><div class="rg-skeleton-line md"></div><div class="rg-skeleton-box" style="height:160px;"></div></div>' +
          '<div class="rg-skeleton-interactive rg-skeleton-panel"><div class="rg-skeleton-line md"></div><div class="rg-skeleton-box" style="height:160px;"></div></div>' +
        '</div>' +
        '<div class="rg-skeleton-interactive rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
    } else {
      bodyHtml =
        '<div class="rg-skeleton-interactive rg-skeleton-card">' +
          '<div class="rg-skeleton-line lg"></div>' +
          '<div class="rg-skeleton-line sm"></div>' +
          '<div class="rg-skeleton-grid">' +
            '<div class="rg-skeleton-box"></div>' +
            '<div class="rg-skeleton-box"></div>' +
            '<div class="rg-skeleton-box"></div>' +
          '</div>' +
        '</div>';
    }

    return '<div class="rg-skeleton-shell" aria-busy="true" aria-label="جاري تحميل ' + escapeHtml(title || '') + '">' +
      headerRow +
      bodyHtml +
    '</div>';
  }

  function bindSkeletonPointerGlow(containerEl) {
    if (!containerEl) return;
    var shell = containerEl.querySelector('.rg-skeleton-shell');
    if (!shell || shell._rgGlowBound) return;
    shell._rgGlowBound = true;
    shell.addEventListener('pointermove', function (ev) {
      var rect = shell.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var xPct = Math.max(0, Math.min(100, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
      var yPct = Math.max(0, Math.min(100, Math.round(((ev.clientY - rect.top) / rect.height) * 100)));
      shell.style.setProperty('--rg-mx', xPct + '%');
      shell.style.setProperty('--rg-my', yPct + '%');
    }, { passive: true });
  }

  function animateProgressiveReveal(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    var reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    var targets = rootEl.querySelectorAll('.dash-sec-wrap, .kpi-hero-card, .kpi-strip-card, .surface-card, .chart-card, .glass-subcard, .rg-stats-ctrl-row');
    var maxItems = Math.min(targets.length, 14);
    for (var i = 0; i < maxItems; i++) {
      var el = targets[i];
      if (!el || el.classList.contains('hidden')) continue;
      el.style.setProperty('--rg-idx', String(i));
      el.classList.remove('rg-reveal-item');
      void el.offsetWidth;
      el.classList.add('rg-reveal-item');
    }
  }

  function getRoutePrimaryRequest(routeId) {
    var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    switch (routeId) {
      case 'dashboard': {
        var d = state.dashboard || { range: '30d', dateFrom: '', dateTo: '' };
        return {
          action: 'getDashboard',
          payload: { range: d.range || '30d', dateFrom: d.dateFrom || '', dateTo: d.dateTo || '' }
        };
      }
      case 'reservations': {
        var resSt = state.reservations || {};
        var vmPre = resSt.viewMode;
        var lifePre = (vmPre === 'rejected' || vmPre === 'cancelled') ? vmPre : 'all';
        return {
          action: 'getReservations',
          payload: (root.RGCrmCore && root.RGCrmCore.buildReservationQueryPayload)
            ? root.RGCrmCore.buildReservationQueryPayload(Object.assign({}, resSt, { lifecycle: lifePre }))
            : Object.assign({ page: 1, pageSize: 20, lifecycle: lifePre }, resSt)
        };
      }
      case 'my-followups':
        return { action: 'getMyFollowUps', payload: {} };
      case 'team-followups':
        return {
          action: 'getTeamFollowUps',
          payload: Object.assign({ employeeId: '', status: '', date: '' }, state.teamFollowUps || {})
        };
      case 'problems':
        return {
          action: 'getProblems',
          payload: Object.assign({ status: '', priority: '', employeeId: '', search: '' }, state.problems || {})
        };
      case 'reports': {
        var rep = state.reports || { reportType: 'all_reservations' };
        var rf = document.getElementById('rep-from');
        var rt = document.getElementById('rep-to');
        var re = document.getElementById('rep-emp');
        var rc = document.getElementById('rep-company');
        var rb = document.getElementById('rep-branch');
        return {
          action: 'getReports',
          payload: {
            reportType: rep.reportType || 'all_reservations',
            dateFrom: rep.dateFrom !== undefined ? (rep.dateFrom || '') : (rf ? rf.value : ''),
            dateTo: rep.dateTo !== undefined ? (rep.dateTo || '') : (rt ? rt.value : ''),
            employeeId: rep.employeeId !== undefined ? (rep.employeeId || '') : (re ? re.value : ''),
            company: rep.company !== undefined ? (rep.company || '') : (rc ? rc.value : ''),
            branch: rep.branch !== undefined ? (rep.branch || '') : (rb ? rb.value : ''),
            logExport: false
          }
        };
      }
      case 'employees':
        if (u && root.RGCrmCore && root.RGCrmCore.canUserViewRoute && root.RGCrmCore.canUserViewRoute(u, 'employees')) {
          return { action: 'getEmployees', payload: {} };
        }
        return null;
      case 'activity':
        return { action: 'getActivityLogs', payload: {} };
      default:
        return null;
    }
  }

  async function renderActiveRouteView(slot, ctx, routeOpts) {
    var curUser = root.RGAuth.getUser();
    var rOpts = routeOpts || {};
    if (!state.route) {
      slot.innerHTML =
        '<div class="surface-card">' +
          '<div class="empty-state" style="padding:36px 18px;">' +
            (state.prefs.lang === 'en'
              ? 'No sections are currently enabled for this account. Please contact your manager or developer.'
              : 'لا توجد أقسام مفعلة لهذا الحساب حالياً. يرجى مراجعة المدير أو المبرمج لتفعيل الأقسام المطلوبة.') +
          '</div>' +
        '</div>';
      return;
    }
    switch (state.route) {
      case 'dashboard':
        await root.RGDashboard.render(slot, ctx, { silent: Boolean(rOpts.silent) });
        break;
      case 'reservations':
        await root.RGReservations.render(slot, ctx);
        break;
      case 'my-followups':
        await root.RGFollowUps.renderMyFollowUps(slot, ctx);
        break;
      case 'team-followups':
        await root.RGFollowUps.renderTeamFollowUps(slot, ctx);
        break;
      case 'problems':
        await root.RGProblems.render(slot, ctx);
        break;
      case 'reports':
        await root.RGReports.render(slot, ctx);
        break;
      case 'employees':
        await root.RGEmployees.render(slot, ctx);
        break;
      case 'activity':
        await renderActivityLog(slot, ctx);
        break;
      case 'settings': {
        if (!curUser) {
          renderLoginScreen();
          break;
        }
        await root.RGSettings.render(slot, ctx);
        break;
      }
      default:
        await root.RGDashboard.render(slot, ctx, { silent: Boolean(rOpts.silent) });
    }
    var req = getRoutePrimaryRequest(state.route);
    if (req && root.RGApi && root.RGApi.getCachedData) {
      var cached = root.RGApi.getCachedData(req.action, req.payload, true);
      if (cached) {
        lastFingerprints.routes[state.route] = computeFingerprintSafe(cached);
      }
    }
  }

  function resolveSafeRouteForUser(routeId, user, lp) {
    if (String(routeId || '') === 'inactive-reservations') routeId = 'reservations';
    if (!user) return routeId || 'dashboard';
    var navItem = NAV_ITEMS.find(function (n) { return n.id === routeId; });
    var hiddenRoutes = (lp && Array.isArray(lp.hiddenRoutes)) ? lp.hiddenRoutes : [];
    var protectedRoutes = (root.RGCrmCore && root.RGCrmCore.PROTECTED_NAV_ROUTES) || ['dashboard', 'settings'];
    if (navItem && isNavRouteAllowedForUser(navItem, user)) {
      if (protectedRoutes.indexOf(routeId) !== -1 || hiddenRoutes.indexOf(routeId) === -1) {
        return routeId;
      }
    }
    if (root.RGCrmCore && root.RGCrmCore.getFirstAllowedRoute) {
      return root.RGCrmCore.getFirstAllowedRoute(user, lp);
    }
    return 'reservations';
  }

  async function renderRoute() {
    var container = document.getElementById('page-content');
    var heading = document.getElementById('page-heading');
    if (!container) return;

    var curUser = root.RGAuth.getUser();
    var activeLayoutPrefs = getLayoutPrefs(curUser);
    state.route = resolveSafeRouteForUser(state.route, curUser, activeLayoutPrefs);
    saveRouteFilters(curUser);

    if (window.location.hash !== '#' + state.route) {
      try {
        window.history.replaceState(null, '', '#' + state.route);
      } catch (e) {
        window.location.hash = state.route;
      }
    }

    var seq = ++routeRenderSeq;
    if (root.RGCrmDropdowns && root.RGCrmDropdowns.closeActive) root.RGCrmDropdowns.closeActive();
    closeProfileMenu();
    closeNotificationsPopover();
    root.RGDashboard.destroyCharts();
    if (root.RGReports && typeof root.RGReports.destroyCharts === 'function') {
      root.RGReports.destroyCharts();
    }
    var navItem = NAV_ITEMS.find(function (n) { return n.id === state.route; }) || NAV_ITEMS[0];
    var routeTitle = t(navItem.key);
    if (heading) heading.textContent = routeTitle;

    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-route') === state.route);
    });

    var slot = document.createElement('div');
    slot.className = 'route-view';
    container.innerHTML = '';
    container.appendChild(slot);

    var isInstantlyReady = false;
    var primReq = getRoutePrimaryRequest(state.route);
    if (state.route === 'settings') {
      isInstantlyReady = !curUser || !root.RGCrmCore.canAccessApi(curUser) || Boolean(primReq && root.RGApi && root.RGApi.hasCached && root.RGApi.hasCached(primReq.action, primReq.payload));
    } else if (state.route === 'employees') {
      isInstantlyReady = Boolean(state.employees && state.employees.loaded);
    } else if (primReq && root.RGApi) {
      isInstantlyReady = Boolean(
        (root.RGApi.hasCached && root.RGApi.hasCached(primReq.action, primReq.payload)) ||
        (root.RGApi.getCachedData && root.RGApi.getCachedData(primReq.action, primReq.payload, true))
      );
    }

    if (!isInstantlyReady) {
      slot.innerHTML = buildLoadingSkeletonHtml(routeTitle, state.route);
      bindSkeletonPointerGlow(slot);
    }

    var ctx = buildAppCtx();

    try {
      await renderActiveRouteView(slot, ctx, { silent: false });
      animateProgressiveReveal(slot);
    } catch (err) {
      slot.innerHTML =
        '<div class="surface-card">' +
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">تعذر عرض الصفحة</div>' +
              '<div class="rg-error-banner-msg">' + escapeHtml((err && err.message) || 'حدث خطأ أثناء عرض الصفحة.') + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="route-retry-btn">إعادة المحاولة</button>' +
          '</div>' +
        '</div>';
      var routeRetry = document.getElementById('route-retry-btn');
      if (routeRetry) {
        routeRetry.addEventListener('click', function () { renderRoute(); });
      }
    }
  }

  function isNavRouteAllowedForUser(item, user) {
    if (!item || !user) return false;
    if (root.RGCrmCore && root.RGCrmCore.canUserViewRoute) {
      return root.RGCrmCore.canUserViewRoute(user, item.id);
    }
    if (item.id === 'dashboard' && !root.RGCrmCore.canUserPerform(user, 'view_dashboard')) {
      return false;
    }
    if (item.id === 'employees' && !root.RGCrmCore.canUserPerform(user, 'view_employees') && !(root.RGCrmCore && root.RGCrmCore.isPrivilegedRole && root.RGCrmCore.isPrivilegedRole(user))) {
      return false;
    }
    return true;
  }

  function getOrderedNavItemsForUser(user, includeHidden) {
    var lp = getLayoutPrefs(user);
    var orderMap = {};
    (lp.navOrder || []).forEach(function (id, idx) { orderMap[id] = idx; });
    var hiddenSet = {};
    (lp.hiddenRoutes || []).forEach(function (id) { hiddenSet[id] = true; });
    var protectedList = (root.RGCrmCore && root.RGCrmCore.PROTECTED_NAV_ROUTES) || ['dashboard', 'settings'];

    return NAV_ITEMS.filter(function (item) {
      if (!isNavRouteAllowedForUser(item, user)) return false;
      if (!includeHidden && hiddenSet[item.id] && protectedList.indexOf(item.id) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var ia = orderMap[a.id] !== undefined ? orderMap[a.id] : 999;
      var ib = orderMap[b.id] !== undefined ? orderMap[b.id] : 999;
      return ia - ib;
    });
  }

  function buildSidebarNavInnerHtml(user) {
    var ordered = getOrderedNavItemsForUser(user, false);
    var isEn = state.prefs.lang === 'en';
    var custLabel = isEn ? 'Organize Screens' : 'ترتيب وإخفاء الشاشات';
    return '<div class="nav-group-label">' + (isEn ? 'Screens' : 'الشاشات') + '</div>' +
      ordered.map(function (item) {
        var lbl = t(item.key);
        return '<button type="button" class="nav-item' + (item.id === state.route ? ' active' : '') + '" data-route="' + item.id + '" title="' + lbl + '" aria-label="' + lbl + '" data-tooltip="' + lbl + '">' +
          '<span class="nav-icon">' + renderIcon(item.icon) + '</span>' +
          '<span class="nav-label">' + lbl + '</span>' +
        '</button>';
      }).join('') +
      '<button type="button" class="nav-item nav-customize-btn" id="sidebar-customize-screens-btn" title="' + custLabel + '" aria-label="' + custLabel + '" data-tooltip="' + custLabel + '">' +
        '<span class="nav-icon">' + renderIcon('M4 6h16M4 12h10M4 18h16M19 10v6M16 13h6') + '</span>' +
        '<span class="nav-label">' + custLabel + '</span>' +
      '</button>';
  }

  function bindSidebarNavEvents(user) {
    var overlay = document.getElementById('sidebar-overlay');
    var sidebar = document.getElementById('app-sidebar');
    document.querySelectorAll('.sidebar-nav .nav-item[data-route]').forEach(function (btn) {
      btn.addEventListener('pointerenter', function () {
        prefetchRouteData(btn.getAttribute('data-route'));
      }, { passive: true });
      btn.addEventListener('focus', function () {
        prefetchRouteData(btn.getAttribute('data-route'));
      }, { passive: true });
      btn.addEventListener('click', function () {
        var targetRoute = btn.getAttribute('data-route');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        if (state.route === targetRoute) return;
        requestCloseWithGuard(function () {
          state.route = targetRoute;
          renderRoute();
        });
      });
    });

    var customScreensBtn = document.getElementById('sidebar-customize-screens-btn');
    if (customScreensBtn) {
      customScreensBtn.addEventListener('click', function () {
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        openScreenOrganizerModal(user || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null));
      });
    }
  }

  function refreshSidebarNavDom(user) {
    var navEl = document.querySelector('#app-sidebar .sidebar-nav');
    if (!navEl) return;
    navEl.innerHTML = buildSidebarNavInnerHtml(user);
    bindSidebarNavEvents(user);
  }

  function openPersonalAccountSettingsModal(onUpdated) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = state.prefs.lang === 'en';
    var user = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var curTimeFmt = getTimeFormat();
    var curNavPos = getSidebarPosition();
    var curTzMode = getTimezoneMode();
    var curTheme = state.prefs.theme === 'dark' ? 'dark' : 'light';
    var curLang = state.prefs.lang === 'en' ? 'en' : 'ar';

    function formatLiveSample(fmt) {
      var now = new Date();
      var riyadh = new Date(now.getTime() + 3 * 3600000);
      var hhmm = riyadh.toISOString().substring(11, 16);
      if (root.RGCrmCore && root.RGCrmCore.formatTimePreference) {
        return root.RGCrmCore.formatTimePreference(hhmm, fmt, state.prefs.lang);
      }
      return hhmm;
    }

    function formatLiveTzSample(tzM, fmt) {
      var now = new Date();
      var riyadh = new Date(now.getTime() + 3 * 3600000);
      var dStr = riyadh.toISOString().substring(0, 10);
      var tStr = riyadh.toISOString().substring(11, 16);
      if (root.RGCrmCore && root.RGCrmCore.buildBookingTimezoneDisplay) {
        var disp = root.RGCrmCore.buildBookingTimezoneDisplay(dStr, tStr, {
          lang: state.prefs.lang,
          timeFormat: fmt,
          timezoneMode: tzM,
          compact: true,
          timeOnly: true
        });
        if (disp && disp.entries && disp.entries.length) {
          return disp.entries.map(function (e) {
            return e.label + ': ' + e.valueText;
          }).join(' | ');
        }
      }
      return formatLiveSample(fmt);
    }

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="personal-settings-modal" role="dialog" aria-modal="true" aria-labelledby="personal-settings-title">' +
        '<div class="modal-panel rg-personal-modal" style="max-width:650px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="personal-settings-title">' + (isEn ? 'Personal Account Settings' : 'إعدادات الحساب الشخصي') + '</h3>' +
              '<p class="section-subtitle">' + (isEn
                ? ('Customize theme, language, booking timezone, time display, and navigation for your account' + (user && user.name ? (' (' + user.name + ')') : '') + '. Saved automatically.')
                : ('خصص المظهر واللغة وتوقيت مواعيد الحجوزات وطريقة عرض الوقت وموضع شريط التنقل لحسابك' + (user && user.name ? (' (' + user.name + ')') : '') + ' مع الحفظ التلقائي.')) + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="personal-settings-close" data-modal-close aria-label="' + (isEn ? 'Close' : 'إغلاق') + '">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +

          '<div class="rg-personal-section">' +
            '<div class="rg-personal-sec-head">' +
              '<div>' +
                '<div class="rg-personal-sec-title">' + (isEn ? 'Appearance & Language' : 'المظهر واللغة') + '</div>' +
                '<div class="rg-personal-sec-sub">' + (isEn ? 'Saved per employee account across devices.' : 'تُحفظ تلقائيًا داخل حساب الموظف وتبقى محفوظة عند التحديث أو تسجيل الدخول.') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="rg-choice-grid rg-choice-grid-2" role="radiogroup" aria-label="' + (isEn ? 'Theme' : 'المظهر') + '" style="margin-bottom:10px;">' +
              '<button type="button" class="rg-choice-card' + (curTheme === 'light' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTheme === 'light' ? 'true' : 'false') + '" data-theme-choice="light">' +
                '<div class="rg-choice-card-top"><span class="rg-choice-title">' + (isEn ? 'Light Mode' : 'الوضع النهاري') + '</span></div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curTheme === 'dark' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTheme === 'dark' ? 'true' : 'false') + '" data-theme-choice="dark">' +
                '<div class="rg-choice-card-top"><span class="rg-choice-title">' + (isEn ? 'Dark Mode' : 'الوضع الليلي') + '</span></div>' +
              '</button>' +
            '</div>' +
            '<div class="rg-choice-grid rg-choice-grid-2" role="radiogroup" aria-label="' + (isEn ? 'Language' : 'اللغة') + '">' +
              '<button type="button" class="rg-choice-card' + (curLang === 'ar' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curLang === 'ar' ? 'true' : 'false') + '" data-lang-choice="ar">' +
                '<div class="rg-choice-card-top"><span class="rg-choice-title">العربية (RTL)</span></div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curLang === 'en' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curLang === 'en' ? 'true' : 'false') + '" data-lang-choice="en">' +
                '<div class="rg-choice-card-top"><span class="rg-choice-title">English (LTR)</span></div>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="rg-personal-section">' +
            '<div class="rg-personal-sec-head">' +
              '<div>' +
                '<div class="rg-personal-sec-title">' + (isEn ? 'Time Display Format' : 'طريقة عرض الوقت') + '</div>' +
                '<div class="rg-personal-sec-sub">' + (isEn ? 'Applied across bookings, follow-ups, radar, activity logs, and reports.' : 'يُطبق فوراً على الحجوزات والمتابعات والرادار وسجل النشاطات والتقارير.') + '</div>' +
              '</div>' +
              '<span class="status-tag status-info mono tabular-nums" id="personal-time-preview" dir="ltr">' + formatLiveSample(curTimeFmt) + '</span>' +
            '</div>' +
            '<div class="rg-choice-grid rg-choice-grid-2" role="radiogroup" aria-label="' + (isEn ? 'Time Display Format' : 'طريقة عرض الوقت') + '">' +
              '<button type="button" class="rg-choice-card' + (curTimeFmt === '12h' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTimeFmt === '12h' ? 'true' : 'false') + '" data-time-choice="12h">' +
                '<div class="rg-choice-card-top">' +
                  '<span class="rg-choice-title">' + (isEn ? '12-Hour Format' : 'نظام 12 ساعة') + '</span>' +
                  '<span class="rg-choice-badge mono tabular-nums">2:35 ' + (isEn ? 'PM' : 'م') + '</span>' +
                '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Displays AM / PM (e.g. 9:15 AM · 11:40 PM)' : 'يعرض التوقيت بصيغة صباحاً / مساءً (ص / م)') + '</div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curTimeFmt === '24h' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTimeFmt === '24h' ? 'true' : 'false') + '" data-time-choice="24h">' +
                '<div class="rg-choice-card-top">' +
                  '<span class="rg-choice-title">' + (isEn ? '24-Hour Format' : 'نظام 24 ساعة') + '</span>' +
                  '<span class="rg-choice-badge mono tabular-nums">14:35</span>' +
                '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Standard 24h clock (00:00 – 23:59)' : 'يعرض التوقيت بنظام 24 ساعة القياسي (00:00 – 23:59)') + '</div>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="rg-personal-section">' +
            '<div class="rg-personal-sec-head">' +
              '<div>' +
                '<div class="rg-personal-sec-title">' + (isEn ? 'Booking Timezone Display' : 'توقيت مواعيد الحجوزات') + '</div>' +
                '<div class="rg-personal-sec-sub">' + (isEn ? 'Choose to show Original Saudi Time, Egypt Time, or Both together under each booking appointment.' : 'اختر إظهار التوقيت الأصلي السعودي أو التوقيت المصري أو كلاهما معاً تحت مواعيد الحجز.') + '</div>' +
              '</div>' +
              '<span class="status-tag status-info tabular-nums" id="personal-tz-preview">' + formatLiveTzSample(curTzMode, curTimeFmt) + '</span>' +
            '</div>' +
            '<div class="rg-choice-grid rg-choice-grid-3" role="radiogroup" aria-label="' + (isEn ? 'Booking Timezone Display' : 'توقيت مواعيد الحجوزات') + '">' +
              '<button type="button" class="rg-choice-card' + (curTzMode === 'both' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTzMode === 'both' ? 'true' : 'false') + '" data-tz-choice="both">' +
                '<div class="rg-choice-card-top">' +
                  '<span class="rg-choice-title">' + (isEn ? 'Both Together' : 'كلاهما معاً') + '</span>' +
                  '<span class="rg-choice-badge mono">SA + EG</span>' +
                '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Original Saudi Time with Egypt Time below it' : 'إظهار التوقيت الأصلي السعودي وتحته التوقيت المصري') + '</div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curTzMode === 'eg' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTzMode === 'eg' ? 'true' : 'false') + '" data-tz-choice="eg">' +
                '<div class="rg-choice-card-top">' +
                  '<span class="rg-choice-title">' + (isEn ? 'Egypt Time Only' : 'التوقيت المصري فقط') + '</span>' +
                  '<span class="rg-choice-badge mono">EG</span>' +
                '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Show booking times converted to Egypt time' : 'إظهار مواعيد الحجوزات بالتوقيت المصري فقط') + '</div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curTzMode === 'sa' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curTzMode === 'sa' ? 'true' : 'false') + '" data-tz-choice="sa">' +
                '<div class="rg-choice-card-top">' +
                  '<span class="rg-choice-title">' + (isEn ? 'Saudi Time Only' : 'التوقيت السعودي فقط') + '</span>' +
                  '<span class="rg-choice-badge mono">SA</span>' +
                '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Show Original Saudi Time only' : 'إظهار التوقيت الأصلي السعودي فقط') + '</div>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="rg-personal-section">' +
            '<div class="rg-personal-sec-head">' +
              '<div>' +
                '<div class="rg-personal-sec-title">' + (isEn ? 'Navigation Bar Position' : 'موضع شريط التنقل (السيد بار)') + '</div>' +
                '<div class="rg-personal-sec-sub">' + (isEn ? 'Top and Bottom modes display clean section icons without text labels.' : 'في وضعي الأعلى والأسفل يظهر الشريط كأيقونات فقط للانتقال السريع بين الأقسام بدون كتابة.') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="rg-choice-grid rg-choice-grid-3" role="radiogroup" aria-label="' + (isEn ? 'Navigation Bar Position' : 'موضع شريط التنقل') + '">' +
              '<button type="button" class="rg-choice-card' + (curNavPos === 'side' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curNavPos === 'side' ? 'true' : 'false') + '" data-pos-choice="side">' +
                '<div class="rg-pos-wireframe is-side" aria-hidden="true"><span class="wf-bar"></span><span class="wf-body"></span></div>' +
                '<div class="rg-choice-title">' + (isEn ? 'Side Bar' : 'على الجانب') + '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Full sidebar with labels' : 'قائمة جانبية بالأيقونات والأسماء') + '</div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curNavPos === 'top' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curNavPos === 'top' ? 'true' : 'false') + '" data-pos-choice="top">' +
                '<div class="rg-pos-wireframe is-top" aria-hidden="true"><span class="wf-bar"><i></i><i></i><i></i><i></i></span><span class="wf-body"></span></div>' +
                '<div class="rg-choice-title">' + (isEn ? 'Top (Icons)' : 'في الأعلى') + '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Icon-only top bar' : 'شريط علوي أيقونات بدون كتابة') + '</div>' +
              '</button>' +
              '<button type="button" class="rg-choice-card' + (curNavPos === 'bottom' ? ' is-selected' : '') + '" role="radio" aria-checked="' + (curNavPos === 'bottom' ? 'true' : 'false') + '" data-pos-choice="bottom">' +
                '<div class="rg-pos-wireframe is-bottom" aria-hidden="true"><span class="wf-body"></span><span class="wf-bar"><i></i><i></i><i></i><i></i></span></div>' +
                '<div class="rg-choice-title">' + (isEn ? 'Bottom (Icons)' : 'في الأسفل') + '</div>' +
                '<div class="rg-choice-desc">' + (isEn ? 'Icon-only bottom dock' : 'شريط سفلي أيقونات بدون كتابة') + '</div>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="modal-footer" style="justify-content:space-between;">' +
            '<button type="button" class="btn btn-sm" id="personal-settings-reset">' + (isEn ? 'Reset Defaults' : 'استعادة الافتراضي') + '</button>' +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn btn-primary" id="personal-settings-done">' + (isEn ? 'Save & Done' : 'حفظ وإغلاق') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var previewEl = document.getElementById('personal-time-preview');
    var tzPreviewEl = document.getElementById('personal-tz-preview');
    function syncModalSelections() {
      var tf = getTimeFormat();
      var np = getSidebarPosition();
      var tz = getTimezoneMode();
      var th = state.prefs.theme === 'dark' ? 'dark' : 'light';
      var lg = state.prefs.lang === 'en' ? 'en' : 'ar';
      if (previewEl) previewEl.textContent = formatLiveSample(tf);
      if (tzPreviewEl) tzPreviewEl.textContent = formatLiveTzSample(tz, tf);
      modalRoot.querySelectorAll('[data-theme-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-theme-choice') === th;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      modalRoot.querySelectorAll('[data-lang-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-lang-choice') === lg;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      modalRoot.querySelectorAll('[data-time-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-time-choice') === tf;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      modalRoot.querySelectorAll('[data-tz-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-tz-choice') === tz;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      modalRoot.querySelectorAll('[data-pos-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-pos-choice') === np;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    }

    var pendingSavePromise = null;
    function applyInstantPref(patch) {
      pendingSavePromise = setPersonalPreferences(patch, { reRender: true, persist: true }).then(function () {
        if (typeof onUpdated === 'function') {
          onUpdated({
            timeFormat: getTimeFormat(),
            sidebarPosition: getSidebarPosition(),
            timezoneMode: getTimezoneMode(),
            reservationsDisplayMode: getReservationsDisplayMode(),
            calendarGranularity: getCalendarGranularity(),
            theme: state.prefs.theme,
            lang: state.prefs.lang
          });
        }
      });
      syncModalSelections();
    }

    modalRoot.querySelectorAll('[data-theme-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ theme: btn.getAttribute('data-theme-choice') });
      });
    });

    modalRoot.querySelectorAll('[data-lang-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ lang: btn.getAttribute('data-lang-choice') });
      });
    });

    modalRoot.querySelectorAll('[data-time-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ timeFormat: btn.getAttribute('data-time-choice') });
      });
    });

    modalRoot.querySelectorAll('[data-tz-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ timezoneMode: btn.getAttribute('data-tz-choice') });
      });
    });

    modalRoot.querySelectorAll('[data-pos-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ sidebarPosition: btn.getAttribute('data-pos-choice') });
      });
    });

    var resetBtn = document.getElementById('personal-settings-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        applyInstantPref({ timeFormat: '24h', sidebarPosition: 'side', timezoneMode: 'both', theme: 'light', lang: 'ar', sidebarCollapsed: false });
        toast(isEn ? 'Personal preferences reset to defaults.' : 'تمت استعادة الإعدادات الشخصية للافتراضي.');
      });
    }

    function closeAndAcknowledge() {
      modalRoot.innerHTML = '';
      toast(isEn ? 'Personal account preferences saved.' : 'تم حفظ إعدادات الحساب الشخصي.');
    }

    var closeBtn = document.getElementById('personal-settings-close');
    var doneBtn = document.getElementById('personal-settings-done');
    if (closeBtn) closeBtn.addEventListener('click', function () { modalRoot.innerHTML = ''; });
    if (doneBtn) doneBtn.addEventListener('click', closeAndAcknowledge);
  }

  function openScreenOrganizerModal(user) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot || !user) return;
    var isEn = state.prefs.lang === 'en';
    var lp = getLayoutPrefs(user);
    var protectedList = (root.RGCrmCore && root.RGCrmCore.PROTECTED_NAV_ROUTES) || ['dashboard', 'settings'];
    var allowedIds = {};
    NAV_ITEMS.forEach(function (it) { if (isNavRouteAllowedForUser(it, user)) allowedIds[it.id] = it; });

    var draftOrder = (lp.navOrder || []).filter(function (id) { return Boolean(allowedIds[id]); });
    NAV_ITEMS.forEach(function (it) { if (allowedIds[it.id] && draftOrder.indexOf(it.id) === -1) draftOrder.push(it.id); });
    var draftHidden = {};
    (lp.hiddenRoutes || []).forEach(function (id) { if (protectedList.indexOf(id) === -1) draftHidden[id] = true; });
    var draggedId = '';

    function renderOrganizer() {
      modalRoot.innerHTML =
        '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="nav-org-title">' +
          '<div class="modal-panel" style="max-width:560px;">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title" id="nav-org-title">' + (isEn ? 'Customize Sidebar Screens' : 'ترتيب وإخفاء الشاشات الجانبية') + '</h3>' +
                '<p class="section-subtitle">' + (isEn ? 'Drag rows or use arrows to reorder screens, and toggle visibility. Saved to your account.' : 'اسحب أي شاشة لتغيير ترتيبها أو استخدم الأسهم وأزرار الإخفاء والإظهار. يُحفظ الترتيب لحسابك تلقائياً.') + '</p>' +
              '</div>' +
              '<button type="button" class="btn btn-sm" id="nav-org-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
            '</div>' +
            '<div class="rg-org-list" id="nav-org-list">' +
              draftOrder.map(function (id, idx) {
                var item = allowedIds[id];
                if (!item) return '';
                var isProt = protectedList.indexOf(id) !== -1;
                var isHidden = !isProt && Boolean(draftHidden[id]);
                return '<div class="rg-org-row' + (isHidden ? ' is-hidden-item' : '') + '" draggable="true" data-org-id="' + id + '">' +
                  '<div class="rg-org-row-start">' +
                    '<span class="rg-drag-handle" title="' + (isEn ? 'Drag to reorder' : 'اسحب للترتيب') + '" aria-hidden="true">⋮⋮</span>' +
                    '<span class="nav-icon">' + renderIcon(item.icon) + '</span>' +
                    '<div>' +
                      '<div class="rg-org-title">' + t(item.key) + (isProt ? ' <span class="status-tag status-info" style="font-size:10px;">' + (isEn ? 'Required' : 'أساسية') + '</span>' : '') + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="rg-org-row-actions">' +
                    '<button type="button" class="btn btn-sm rg-org-up" data-id="' + id + '" ' + (idx === 0 ? 'disabled' : '') + ' title="' + (isEn ? 'Move Up' : 'لأعلى') + '">▲</button>' +
                    '<button type="button" class="btn btn-sm rg-org-down" data-id="' + id + '" ' + (idx === draftOrder.length - 1 ? 'disabled' : '') + ' title="' + (isEn ? 'Move Down' : 'لأسفل') + '">▼</button>' +
                    '<label class="checkbox-item" style="margin:0;font-size:12px;">' +
                      '<input type="checkbox" class="rg-org-vis" data-id="' + id + '"' + (!isHidden ? ' checked' : '') + (isProt ? ' disabled' : '') + '> ' +
                      '<span>' + (isHidden ? (isEn ? 'Hidden' : 'مخفية') : (isEn ? 'Visible' : 'ظاهرة')) + '</span>' +
                    '</label>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="modal-footer" style="justify-content:space-between;">' +
              '<button type="button" class="btn btn-sm" id="nav-org-reset">' + (isEn ? 'Reset Default Order' : 'استعادة الترتيب الافتراضي') + '</button>' +
              '<div style="display:flex;gap:8px;">' +
                '<button type="button" class="btn" id="nav-org-cancel">' + (isEn ? 'Cancel' : 'إلغاء') + '</button>' +
                '<button type="button" class="btn btn-primary" id="nav-org-save">' + (isEn ? 'Save Layout' : 'حفظ الترتيب') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('nav-org-close').addEventListener('click', function () { modalRoot.innerHTML = ''; });
      document.getElementById('nav-org-cancel').addEventListener('click', function () { modalRoot.innerHTML = ''; });

      modalRoot.querySelectorAll('.rg-org-up').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (root.RGCrmCore && root.RGCrmCore.moveOrderItem) {
            draftOrder = root.RGCrmCore.moveOrderItem(draftOrder, btn.getAttribute('data-id'), 'up');
            renderOrganizer();
          }
        });
      });

      modalRoot.querySelectorAll('.rg-org-down').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (root.RGCrmCore && root.RGCrmCore.moveOrderItem) {
            draftOrder = root.RGCrmCore.moveOrderItem(draftOrder, btn.getAttribute('data-id'), 'down');
            renderOrganizer();
          }
        });
      });

      modalRoot.querySelectorAll('.rg-org-vis').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-id');
          if (cb.checked) delete draftHidden[id];
          else draftHidden[id] = true;
          renderOrganizer();
        });
      });

      modalRoot.querySelectorAll('.rg-org-row[draggable="true"]').forEach(function (row) {
        row.addEventListener('dragstart', function (ev) {
          draggedId = row.getAttribute('data-org-id') || '';
          row.classList.add('is-dragging');
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', draggedId);
          }
        });
        row.addEventListener('dragover', function (ev) {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
          row.classList.add('is-drop-target');
        });
        row.addEventListener('dragleave', function () {
          row.classList.remove('is-drop-target');
        });
        row.addEventListener('drop', function (ev) {
          ev.preventDefault();
          row.classList.remove('is-drop-target');
          var targetId = row.getAttribute('data-org-id') || '';
          var srcId = draggedId || (ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '');
          if (srcId && targetId && srcId !== targetId && root.RGCrmCore && root.RGCrmCore.reorderListByDragDrop) {
            draftOrder = root.RGCrmCore.reorderListByDragDrop(draftOrder, srcId, targetId);
            renderOrganizer();
          }
        });
        row.addEventListener('dragend', function () {
          draggedId = '';
          modalRoot.querySelectorAll('.rg-org-row').forEach(function (r) {
            r.classList.remove('is-dragging', 'is-drop-target');
          });
        });

        var handle = row.querySelector('.rg-drag-handle');
        if (handle) {
          handle.addEventListener('pointerdown', function (ev) {
            if (ev.pointerType === 'mouse') return;
            ev.preventDefault();
            var srcId = row.getAttribute('data-org-id') || '';
            var dropTargetId = '';
            row.classList.add('is-dragging');
            function onMove(mv) {
              var el = document.elementFromPoint(mv.clientX, mv.clientY);
              var targetRow = el && el.closest ? el.closest('.rg-org-row[data-org-id]') : null;
              modalRoot.querySelectorAll('.rg-org-row').forEach(function (r) { r.classList.remove('is-drop-target'); });
              if (targetRow && targetRow !== row) {
                dropTargetId = targetRow.getAttribute('data-org-id') || '';
                targetRow.classList.add('is-drop-target');
              } else {
                dropTargetId = '';
              }
            }
            function onUp() {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
              document.removeEventListener('pointercancel', onUp);
              modalRoot.querySelectorAll('.rg-org-row').forEach(function (r) { r.classList.remove('is-dragging', 'is-drop-target'); });
              if (srcId && dropTargetId && srcId !== dropTargetId && root.RGCrmCore && root.RGCrmCore.reorderListByDragDrop) {
                draftOrder = root.RGCrmCore.reorderListByDragDrop(draftOrder, srcId, dropTargetId);
                renderOrganizer();
              }
            }
            document.addEventListener('pointermove', onMove, { passive: true });
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
          });
        }
      });

      document.getElementById('nav-org-reset').addEventListener('click', function () {
        draftOrder = NAV_ITEMS.filter(function (it) { return Boolean(allowedIds[it.id]); }).map(function (it) { return it.id; });
        draftHidden = {};
        renderOrganizer();
      });

      var saveBtn = document.getElementById('nav-org-save');
      saveBtn.addEventListener('click', function () {
        withActionLock(saveBtn, 'saveNavOrganizer', async function () {
          var fullOrder = draftOrder.slice();
          NAV_ITEMS.forEach(function (it) { if (fullOrder.indexOf(it.id) === -1) fullOrder.push(it.id); });
          var hiddenList = Object.keys(draftHidden).filter(function (k) { return draftHidden[k]; });
          var saved = await saveLayoutPrefs({ navOrder: fullOrder, hiddenRoutes: hiddenList });
          modalRoot.innerHTML = '';
          toast(isEn ? 'Screen layout saved.' : 'تم حفظ ترتيب وظهور الشاشات.');
          if (protectedList.indexOf(state.route) === -1 && hiddenList.indexOf(state.route) !== -1) {
            state.route = resolveSafeRouteForUser('', user, saved);
            renderRoute();
          }
        });
      });
    }

    renderOrganizer();
  }

  function getConfirmRoot() {
    var el = document.getElementById('rg-confirm-root');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'rg-confirm-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function closeConfirmModal() {
    var el = document.getElementById('rg-confirm-root');
    if (el && el.firstElementChild) {
      el.innerHTML = '';
      return true;
    }
    return false;
  }

  function setUnsavedGuard(guard) {
    if (!guard || typeof guard.isDirty !== 'function') {
      activeUnsavedGuard = null;
      return;
    }
    activeUnsavedGuard = guard;
  }

  function clearUnsavedGuard() {
    activeUnsavedGuard = null;
    closeConfirmModal();
  }

  function requestCloseWithGuard(proceedFn) {
    var nextStep = typeof proceedFn === 'function' ? proceedFn : function () {};
    var guard = activeUnsavedGuard;
    var dirty = false;
    try {
      dirty = Boolean(guard && typeof guard.isDirty === 'function' && guard.isDirty());
    } catch (_e) {
      dirty = false;
    }
    if (!dirty) {
      clearUnsavedGuard();
      nextStep();
      return;
    }

    var cRoot = getConfirmRoot();
    if (!cRoot) {
      clearUnsavedGuard();
      nextStep();
      return;
    }
    var isEn = state.prefs.lang === 'en';
    var hasSave = typeof guard.onSave === 'function';
    var areaLabel = guard.label ? String(guard.label) : '';
    cRoot.innerHTML =
      '<div class="modal-backdrop rg-confirm-backdrop" id="rg-unsaved-confirm-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="rg-unsaved-title">' +
        '<div class="modal-panel rg-confirm-panel" style="max-width:460px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="rg-unsaved-title">' + (isEn ? 'Unsaved Changes Detected' : 'تنبيه: توجد تعديلات أو ملاحظات غير محفوظة') + '</h3>' +
              (areaLabel ? '<p class="section-subtitle">' + escapeHtml(areaLabel) + '</p>' : '') +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="rg-confirm-stay-x" aria-label="' + (isEn ? 'Stay' : 'متابعة التعديل') + '">✕</button>' +
          '</div>' +
          '<div class="rg-confirm-body">' +
            (isEn
              ? 'You have unsaved notes or edits that have not been submitted yet. Would you like to save them before closing, discard them, or continue editing?'
              : 'هناك نص مكتوب أو تعديلات غير محفوظة لم يتم إرسالها بعد. هل تريد حفظها قبل الإغلاق أم تجاهل التغييرات؟') +
          '</div>' +
          '<div class="modal-footer rg-confirm-actions">' +
            '<button type="button" class="btn" id="rg-confirm-stay-btn">' + (isEn ? 'Continue Editing' : 'متابعة التعديل') + '</button>' +
            '<button type="button" class="btn btn-danger" id="rg-confirm-discard-btn">' + (isEn ? 'Discard & Close' : 'تجاهل التغييرات والمتابعة') + '</button>' +
            (hasSave
              ? '<button type="button" class="btn btn-primary" id="rg-confirm-save-btn">' + (isEn ? 'Save & Continue' : 'حفظ التعديلات والمتابعة') + '</button>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';

    var stayBtn = document.getElementById('rg-confirm-stay-btn');
    var stayX = document.getElementById('rg-confirm-stay-x');
    var discardBtn = document.getElementById('rg-confirm-discard-btn');
    var saveBtn = document.getElementById('rg-confirm-save-btn');

    if (stayBtn) stayBtn.addEventListener('click', closeConfirmModal);
    if (stayX) stayX.addEventListener('click', closeConfirmModal);
    if (discardBtn) {
      discardBtn.addEventListener('click', function () {
        var onDisc = guard && guard.onDiscard;
        clearUnsavedGuard();
        if (typeof onDisc === 'function') {
          try { onDisc(); } catch (_e) {}
        }
        nextStep();
      });
    }
    if (saveBtn && hasSave) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        try {
          var ok = await guard.onSave();
          if (ok === false) {
            saveBtn.disabled = false;
            return;
          }
          clearUnsavedGuard();
          nextStep();
        } catch (err) {
          saveBtn.disabled = false;
          toast((err && err.message) || 'تعذر حفظ التعديلات.', true);
        }
      });
    }
  }

  function installAuthPreviewBridge() {
    if (authPreviewBridgeInstalled || !root.RGAuth) return;
    authPreviewBridgeInstalled = true;
    var origGetUser = root.RGAuth.getUser;
    var origSetUser = root.RGAuth.setUser;
    var origUpdateUser = root.RGAuth.updateCurrentUser;
    var origLogout = root.RGAuth.logout;

    root.RGAuth.getRealUser = function () {
      return state.previewSession && state.previewSession.realUser
        ? state.previewSession.realUser
        : origGetUser();
    };
    root.RGAuth.getUser = function () {
      if (state.previewSession && state.previewSession.previewUser) {
        return state.previewSession.previewUser;
      }
      return origGetUser();
    };
    root.RGAuth.updateCurrentUser = function (patch) {
      var updated = origUpdateUser ? origUpdateUser(patch) : origGetUser();
      if (state.previewSession && updated && state.previewSession.realUser && state.previewSession.realUser.id === updated.id) {
        state.previewSession.realUser = updated;
      }
      return updated;
    };
    root.RGAuth.setUser = function (u) {
      origSetUser(u);
      if (!u) {
        state.previewSession = null;
        try { sessionStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY); } catch (_e) {}
      } else if (state.previewSession) {
        state.previewSession.realUser = u;
        if (root.RGCrmCore && root.RGCrmCore.resolvePreviewUserSession) {
          var refreshed = root.RGCrmCore.resolvePreviewUserSession(
            u,
            state.previewSession.spec,
            (state.employees && state.employees.items) || [],
            (state.employees && state.employees.rolePresets) || []
          );
          if (refreshed) state.previewSession.previewUser = refreshed;
          else state.previewSession = null;
        }
      }
    };
    root.RGAuth.logout = async function () {
      state.previewSession = null;
      try { sessionStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY); } catch (_e) {}
      return origLogout();
    };
  }

  function getRealUser() {
    if (state.previewSession && state.previewSession.realUser) {
      return state.previewSession.realUser;
    }
    if (root.RGAuth && typeof root.RGAuth.getRealUser === 'function') {
      return root.RGAuth.getRealUser();
    }
    return root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
  }

  function getPreviewState() {
    if (!state.previewSession || !state.previewSession.previewUser) {
      return { active: false, spec: null, previewUser: null, realUser: getRealUser() };
    }
    return {
      active: true,
      spec: Object.assign({}, state.previewSession.spec),
      previewUser: Object.assign({}, state.previewSession.previewUser),
      realUser: state.previewSession.realUser
    };
  }

  function renderPreviewRoleBanner() {
    var host = document.getElementById('rg-preview-role-banner');
    if (!host) return;
    if (!state.previewSession || !state.previewSession.previewUser) {
      host.innerHTML = '';
      host.classList.add('hidden');
      document.documentElement.classList.remove('rg-preview-mode-active');
      return;
    }
    var pu = state.previewSession.previewUser;
    var isEn = state.prefs.lang === 'en';
    var roleLabels = (root.RGCrmCore && root.RGCrmCore.ROLE_LABELS && (root.RGCrmCore.ROLE_LABELS[state.prefs.lang] || root.RGCrmCore.ROLE_LABELS.ar)) || {};
    var targetDesc = pu.previewMode === 'employee'
      ? (pu.name + ' (' + (roleLabels[pu.role] || pu.role) + ')')
      : (roleLabels[pu.role] || pu.role);
    document.documentElement.classList.add('rg-preview-mode-active');
    host.classList.remove('hidden');
    host.innerHTML =
      '<div class="rg-preview-banner" role="status" aria-live="polite">' +
        '<div class="rg-preview-banner-main">' +
          '<span class="rg-preview-pill">' + (isEn ? 'PREVIEW MODE' : 'وضع المحاكاة') + '</span>' +
          '<span class="rg-preview-banner-text">' +
            (isEn
              ? ('You are previewing the CRM as <strong>' + escapeHtml(targetDesc) + '</strong>. Navigation, widgets, and actions reflect this role.')
              : ('وضع المحاكاة — أنت تعاين النظام الآن بصلاحيات <strong>' + escapeHtml(targetDesc) + '</strong>')) +
          '</span>' +
        '</div>' +
        '<div class="rg-preview-banner-actions">' +
          '<button type="button" class="btn btn-sm" id="rg-change-preview-btn">' + (isEn ? 'Switch Role' : 'تغيير المعاينة') + '</button>' +
          '<button type="button" class="btn btn-sm btn-primary" id="rg-stop-preview-btn">' + (isEn ? 'Exit Preview' : 'إنهاء المحاكاة') + '</button>' +
        '</div>' +
      '</div>';

    var changeBtn = document.getElementById('rg-change-preview-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () { openPreviewRoleModal(); });
    }
    var stopBtn = document.getElementById('rg-stop-preview-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () { stopPreviewSession(); });
    }
  }

  async function startPreviewSession(spec) {
    installAuthPreviewBridge();
    var realUser = getRealUser();
    if (!realUser || !root.RGCrmCore || !root.RGCrmCore.canUserImpersonate || !root.RGCrmCore.canUserImpersonate(realUser)) {
      toast('وضع المحاكاة متاح للمشرف والمدير العام والمبرمج فقط.', true);
      return false;
    }
    if (!state.employees || !state.employees.loaded) {
      await loadEmployeesState({ silent: true }).catch(function () {});
    }
    var previewUser = root.RGCrmCore.resolvePreviewUserSession(
      realUser,
      spec,
      (state.employees && state.employees.items) || [],
      (state.employees && state.employees.rolePresets) || []
    );
    if (!previewUser) {
      toast('تعذر تفعيل وضع المحاكاة للدور أو الحساب المحدد.', true);
      return false;
    }
    var draftRoleUi = (spec && spec.draftRoleUiDefaults && root.RGCrmCore.normalizeRoleUiDefaults)
      ? root.RGCrmCore.normalizeRoleUiDefaults(spec.draftRoleUiDefaults)
      : null;
    clearUnsavedGuard();
    var mRoot = document.getElementById('modal-root');
    if (mRoot) mRoot.innerHTML = '';
    state.previewSession = {
      spec: Object.assign({}, spec),
      realUser: realUser,
      previewUser: previewUser,
      draftRoleUiDefaults: draftRoleUi
    };
    try {
      sessionStorage.setItem(PREVIEW_SESSION_STORAGE_KEY, JSON.stringify(spec));
    } catch (_e) {}
    applyUiSimplification(state.uiSimplification, true);
    var safeRoute = resolveSafeRouteForUser(state.route, previewUser, getLayoutPrefs(previewUser));
    state.route = safeRoute;
    renderAppShell(previewUser);
    await renderRoute();
    toast('تم تفعيل وضع المحاكاة: ' + (previewUser.name || previewUser.role));
    return true;
  }

  async function stopPreviewSession(silent) {
    var realUser = getRealUser();
    state.previewSession = null;
    try {
      sessionStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
    } catch (_e) {}
    applyUiSimplification(state.uiSimplification, true);
    if (realUser) {
      renderAppShell(realUser);
      await renderRoute();
    }
    if (!silent) {
      toast('تم إنهاء وضع المحاكاة والعودة إلى حسابك الفعلي.');
    }
  }

  async function openPreviewRoleModal(preselectSpec) {
    var realUser = getRealUser();
    if (!realUser || !root.RGCrmCore || !root.RGCrmCore.canUserImpersonate || !root.RGCrmCore.canUserImpersonate(realUser)) {
      toast('وضع المحاكاة متاح للمشرف والمدير العام والمبرمج فقط.', true);
      return;
    }
    if (!state.employees || !state.employees.loaded) {
      await loadEmployeesState({ silent: true }).catch(function () {});
    }
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = state.prefs.lang === 'en';
    var allowedRoles = root.RGCrmCore.getAllowedPreviewRoles ? root.RGCrmCore.getAllowedPreviewRoles(realUser) : ['agent', 'supervisor'];
    var roleLabels = (root.RGCrmCore.ROLE_LABELS && (root.RGCrmCore.ROLE_LABELS[state.prefs.lang] || root.RGCrmCore.ROLE_LABELS.ar)) || {};
    var presets = (state.employees && Array.isArray(state.employees.rolePresets) ? state.employees.rolePresets : []).filter(function (p) {
      return p && allowedRoles.indexOf(p.role) !== -1;
    });
    var emps = (state.employees && Array.isArray(state.employees.items) ? state.employees.items : []).filter(function (e) {
      return e && e.id !== realUser.id && allowedRoles.indexOf(e.role) !== -1;
    });

    var initMode = (preselectSpec && preselectSpec.employeeId) ? 'employee' : ((preselectSpec && preselectSpec.presetId) ? 'preset' : 'role');
    var initRole = (preselectSpec && preselectSpec.role) || (allowedRoles[0] || 'agent');
    var initPresetId = (preselectSpec && preselectSpec.presetId) || (presets[0] ? presets[0].id : '');
    var initEmpId = (preselectSpec && preselectSpec.employeeId) || (emps[0] ? emps[0].id : '');

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="rg-preview-role-modal" role="dialog" aria-modal="true" aria-labelledby="rg-preview-modal-title">' +
        '<form class="modal-panel" id="rg-preview-role-form" style="max-width:560px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="rg-preview-modal-title">' + (isEn ? 'Impersonation / Role Preview Mode' : 'وضع المحاكاة (معاينة النظام بصلاحيات أخرى)') + '</h3>' +
              '<p class="section-subtitle">' + (isEn ? 'Preview screens, buttons, and role UI defaults exactly as another employee sees them without changing your login token.' : 'عاين الواجهة والأقسام والأزرار وإعدادات الواجهة الافتراضية تماماً كما يراها الدور أو الموظف المحدد.') + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="rg-preview-modal-close" data-modal-close>' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">' + (isEn ? 'Preview Source' : 'نطاق المحاكاة') + '</label>' +
            '<div class="segmented-control" id="rg-preview-mode-tabs">' +
              '<button type="button" class="segmented-btn' + (initMode === 'role' ? ' active' : '') + '" data-p-mode="role">' + (isEn ? 'By Role' : 'حسب الدور') + '</button>' +
              '<button type="button" class="segmented-btn' + (initMode === 'preset' ? ' active' : '') + '" data-p-mode="preset"' + (presets.length ? '' : ' disabled') + '>' + (isEn ? 'By Preset' : 'حسب القالب') + '</button>' +
              '<button type="button" class="segmented-btn' + (initMode === 'employee' ? ' active' : '') + '" data-p-mode="employee"' + (emps.length ? '' : ' disabled') + '>' + (isEn ? 'Specific Employee' : 'موظف محدد') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="form-group' + (initMode === 'role' ? '' : ' hidden') + '" id="rg-preview-role-wrap">' +
            '<label class="form-label" for="rg-preview-role-select">' + (isEn ? 'Target Role' : 'اختر الدور المطلوب معاينته') + '</label>' +
            '<select class="select" id="rg-preview-role-select">' +
              allowedRoles.map(function (r) {
                return '<option value="' + escapeHtml(r) + '"' + (r === initRole ? ' selected' : '') + '>' + escapeHtml(roleLabels[r] || r) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group' + (initMode === 'preset' ? '' : ' hidden') + '" id="rg-preview-preset-wrap">' +
            '<label class="form-label" for="rg-preview-preset-select">' + (isEn ? 'Target Role Preset' : 'اختر قالب الصلاحيات') + '</label>' +
            '<select class="select" id="rg-preview-preset-select">' +
              presets.map(function (p) {
                return '<option value="' + escapeHtml(p.id) + '" data-role="' + escapeHtml(p.role) + '"' + (p.id === initPresetId ? ' selected' : '') + '>' + escapeHtml(p.label) + ' (' + escapeHtml(roleLabels[p.role] || p.role) + ')</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group' + (initMode === 'employee' ? '' : ' hidden') + '" id="rg-preview-emp-wrap">' +
            '<label class="form-label" for="rg-preview-emp-select">' + (isEn ? 'Target Employee Account' : 'اختر حساب الموظف للمحاكاة') + '</label>' +
            '<select class="select" id="rg-preview-emp-select">' +
              emps.map(function (e) {
                return '<option value="' + escapeHtml(e.id) + '"' + (e.id === initEmpId ? ' selected' : '') + '>' + escapeHtml(e.name) + ' — ' + escapeHtml(roleLabels[e.role] || e.role) + ' (@' + escapeHtml(e.username) + ')</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="modal-footer" style="justify-content:space-between;">' +
            (state.previewSession
              ? '<button type="button" class="btn btn-danger" id="rg-preview-exit-modal-btn">' + (isEn ? 'Exit Current Preview' : 'إنهاء المحاكاة الحالية') + '</button>'
              : '<span></span>') +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn" id="rg-preview-cancel-btn" data-modal-close>' + (isEn ? 'Cancel' : 'إلغاء') + '</button>' +
              '<button type="submit" class="btn btn-primary" id="rg-preview-start-btn">' + (isEn ? 'Start Preview' : 'بدء المحاكاة الآن') + '</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</div>';

    var currentMode = initMode;
    var roleWrap = document.getElementById('rg-preview-role-wrap');
    var presetWrap = document.getElementById('rg-preview-preset-wrap');
    var empWrap = document.getElementById('rg-preview-emp-wrap');

    modalRoot.querySelectorAll('#rg-preview-mode-tabs [data-p-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        currentMode = btn.getAttribute('data-p-mode') || 'role';
        modalRoot.querySelectorAll('#rg-preview-mode-tabs [data-p-mode]').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        if (roleWrap) roleWrap.classList.toggle('hidden', currentMode !== 'role');
        if (presetWrap) presetWrap.classList.toggle('hidden', currentMode !== 'preset');
        if (empWrap) empWrap.classList.toggle('hidden', currentMode !== 'employee');
      });
    });

    var closeModal = function () { modalRoot.innerHTML = ''; };
    document.getElementById('rg-preview-modal-close').addEventListener('click', closeModal);
    document.getElementById('rg-preview-cancel-btn').addEventListener('click', closeModal);
    var exitModalBtn = document.getElementById('rg-preview-exit-modal-btn');
    if (exitModalBtn) {
      exitModalBtn.addEventListener('click', function () {
        closeModal();
        stopPreviewSession();
      });
    }

    document.getElementById('rg-preview-role-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var spec = {};
      if (currentMode === 'employee') {
        spec.employeeId = (document.getElementById('rg-preview-emp-select') || {}).value || '';
      } else if (currentMode === 'preset') {
        var pSel = document.getElementById('rg-preview-preset-select');
        spec.presetId = pSel ? pSel.value : '';
        var opt = pSel && pSel.options && pSel.selectedIndex >= 0 ? pSel.options[pSel.selectedIndex] : null;
        spec.role = opt ? (opt.getAttribute('data-role') || 'agent') : 'agent';
      } else {
        spec.role = (document.getElementById('rg-preview-role-select') || {}).value || 'agent';
      }
      closeModal();
      await startPreviewSession(spec);
    });
  }

  function renderAppShell(user) {
    var appRoot = document.getElementById('app-root');
    var roleLabels = root.RGCrmCore.ROLE_LABELS[state.prefs.lang] || root.RGCrmCore.ROLE_LABELS.ar;
    var collapsedClass = state.prefs.sidebarCollapsed ? ' collapsed' : '';
    var isEn = state.prefs.lang === 'en';
    var realUser = getRealUser();
    var canAnnMgr = canManageAnnouncements(user);
    var canPreview = Boolean(realUser && root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realUser));
    var isPreviewActive = Boolean(state.previewSession && state.previewSession.previewUser);
    var delBadge = user.activeDelegation
      ? ('<div class="rg-delegation-pill">' + (isEn ? 'Delegated Supervisor' : 'تفويض مشرف مؤقت') + '</div>')
      : '';

    appRoot.innerHTML =
      '<div class="app-shell">' +
        '<div class="sidebar-overlay" id="sidebar-overlay"></div>' +
        '<aside class="sidebar' + collapsedClass + '" id="app-sidebar" aria-label="القائمة الرئيسية">' +
          '<div class="sidebar-brand">' +
            '<a href="#dashboard" class="sidebar-brand-link" id="brand-home-link">' +
              '<img src="' + assetUrl('assets/images/logo.png') + '" alt="Rental Gate">' +
              '<div class="sidebar-brand-text">' +
                '<div class="sidebar-brand-title">RENTAL GATE</div>' +
                '<div class="sidebar-brand-sub">ROYAL RED CRM</div>' +
              '</div>' +
            '</a>' +
            '<button type="button" class="sidebar-collapse-btn rg-ui-sidebar-collapse" id="sidebar-collapse-btn" aria-label="طي القائمة" title="طي / توسيع القائمة">' +
              renderIcon('M4 6h16M4 12h16M4 18h16') +
            '</button>' +
          '</div>' +
          '<nav class="sidebar-nav">' +
            buildSidebarNavInnerHtml(user) +
          '</nav>' +
          '<div class="sidebar-footer">' +
            '<button type="button" class="sidebar-footer-card" id="user-profile-menu-btn" aria-haspopup="menu" aria-expanded="false" title="' + escapeHtml(user.name) + '">' +
              '<div class="sidebar-user-avatar">' + escapeHtml(String(user.name || 'U').charAt(0)) + '</div>' +
              '<div class="sidebar-user-meta">' +
                '<div class="sidebar-user-name">' + escapeHtml(user.name) + '</div>' +
                '<div class="sidebar-user-role">' + escapeHtml(roleLabels[user.role] || user.role) + '</div>' +
                delBadge +
              '</div>' +
              '<span class="sidebar-user-chevron" aria-hidden="true">' + renderIcon('M6 9l6 6 6-6') + '</span>' +
            '</button>' +
            '<div class="rg-powered-by rg-powered-by-sidebar" dir="ltr">powerd by zeyad</div>' +
          '</div>' +
        '</aside>' +
        '<div class="main-column">' +
          '<header class="topbar">' +
            '<div class="topbar-start">' +
              '<button type="button" class="btn btn-icon mobile-menu-btn" id="mobile-menu-btn" aria-label="فتح القائمة">' + renderIcon('M4 6h16M4 12h16M4 18h16') + '</button>' +
              '<h1 class="page-heading" id="page-heading">' + t('nav_dashboard') + '</h1>' +
              '<form class="topbar-search-form rg-ui-topbar-search" id="topbar-search-form" role="search">' +
                '<span class="topbar-search-icon" aria-hidden="true">' + renderIcon('M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z') + '</span>' +
                '<input type="search" class="topbar-search-input" id="topbar-quick-search" placeholder="' + t('topbar_search_placeholder') + '" aria-label="' + t('topbar_search_placeholder') + '">' +
                '<span class="topbar-search-kbd" aria-hidden="true">Ctrl+K</span>' +
              '</form>' +
            '</div>' +
            '<div class="topbar-actions">' +
              ((root.RGInactive && (!root.RGCrmCore || ((!root.RGCrmCore.canUserViewCustomerId || root.RGCrmCore.canUserViewCustomerId(user)) && (!root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(user, 'act_customer_id_lookup')))))
                ? '<button type="button" class="btn btn-sm rg-ui-res-id-lookup" id="topbar-id-lookup-btn" aria-label="' + (isEn ? 'ID Lookup' : 'بحث برقم الهوية') + '" title="' + (isEn ? 'Search customer by National ID' : 'البحث عن عميل وحجوزاته برقم الهوية') + '">' +
                    renderIcon('M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm11 17l-4.35-4.35') +
                    '<span class="topbar-desktop-only">' + (isEn ? 'ID Lookup' : 'بحث بالهوية') + '</span>' +
                  '</button>'
                : '') +
              (canPreview
                ? '<button type="button" class="btn btn-sm rg-ui-preview-role-btn' + (isPreviewActive ? ' btn-primary' : '') + '" id="topbar-preview-role-btn" aria-label="' + (isEn ? 'Preview Role' : 'وضع المحاكاة') + '" title="' + (isEn ? 'Preview system as another role or employee' : 'معاينة النظام بصلاحيات دور أو موظف آخر') + '">' +
                    renderIcon('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z') +
                    '<span class="topbar-desktop-only">' + (isEn ? 'Preview Role' : 'وضع المحاكاة') + '</span>' +
                  '</button>'
                : '') +
              (canAnnMgr
                ? '<button type="button" class="btn btn-icon rg-ui-topbar-ann-btn" id="announcements-mgr-btn" aria-label="' + (isEn ? 'Shift Announcements' : 'تعميمات وإعلانات الوردية') + '" title="' + (isEn ? 'Shift Announcements' : 'تعميمات وإعلانات الوردية') + '">' +
                    renderIcon('M3 11l18-5v12L3 14v-3zm8 4v5a2 2 0 0 1-4 0v-5') +
                  '</button>'
                : '') +
              '<button type="button" class="btn btn-icon rg-ui-topbar-refresh" id="refresh-view-btn" aria-label="' + t('refresh') + '" title="' + t('refresh') + '">' +
                renderIcon('M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15') +
              '</button>' +
              '<button type="button" class="btn btn-icon rg-ui-topbar-notif" id="notif-toggle-btn" aria-label="الإشعارات" aria-haspopup="dialog" aria-expanded="false">' +
                renderIcon('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0') +
                '<span class="notif-count hidden" id="notif-badge">0</span>' +
              '</button>' +
              '<button type="button" class="btn btn-sm theme-toggle-btn rg-ui-topbar-theme" id="theme-toggle-btn" data-theme-state="' + (state.prefs.theme === 'dark' ? 'dark' : 'light') + '" aria-label="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '" title="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '">' +
                buildThemeToggleHtml(state.prefs.theme, false) +
              '</button>' +
              '<button type="button" class="btn btn-sm rg-ui-topbar-lang" id="lang-toggle-btn">' + t('lang_toggle') + '</button>' +
              '<button type="button" class="btn btn-sm btn-danger rg-ui-logout-btn" id="logout-btn">' +
                '<span class="topbar-mobile-only">' + (isEn ? 'Exit' : 'خروج') + '</span>' +
                '<span class="topbar-desktop-only">' + t('logout') + '</span>' +
              '</button>' +
            '</div>' +
          '</header>' +
          '<div id="rg-preview-role-banner" class="rg-preview-banner-host hidden"></div>' +
          '<div id="rg-shift-announcement-banner" class="rg-shift-banner-host rg-ui-topbar-ann-host hidden"></div>' +
          '<div id="rg-offline-banner" class="rg-offline-banner-host hidden"></div>' +
          '<main class="page-content" id="page-content"></main>' +
          '<footer class="rg-shell-attribution"><span class="rg-powered-by" dir="ltr">powerd by zeyad</span></footer>' +
        '</div>' +
      '</div>';

    renderPreviewRoleBanner();
    renderShiftAnnouncementBanner();
    updateOfflineBanner();

    var idLookupTopBtn = document.getElementById('topbar-id-lookup-btn');
    if (idLookupTopBtn && root.RGInactive && typeof root.RGInactive.openNationalIdLookupModal === 'function') {
      idLookupTopBtn.addEventListener('click', function () {
        root.RGInactive.openNationalIdLookupModal(buildAppCtx(), '');
      });
    }

    var previewTopBtn = document.getElementById('topbar-preview-role-btn');
    if (previewTopBtn) {
      previewTopBtn.addEventListener('click', function () {
        openPreviewRoleModal();
      });
    }

    var annMgrTopBtn = document.getElementById('announcements-mgr-btn');
    if (annMgrTopBtn) {
      annMgrTopBtn.addEventListener('click', function () {
        openAnnouncementsManager();
      });
    }

    var quickSearchForm = document.getElementById('topbar-search-form');
    var quickSearchInput = document.getElementById('topbar-quick-search');
    if (quickSearchForm && quickSearchInput) {
      quickSearchForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var q = String(quickSearchInput.value || '').trim();
        state.reservations = Object.assign({}, state.reservations || {}, {
          search: q,
          company: '',
          branch: '',
          status: '',
          employeeId: '',
          priority: '',
          dateFrom: '',
          dateTo: '',
          timeField: 'both',
          timeFrom: '',
          timeTo: '',
          unfollowedOnly: false,
          hasProblemsOnly: false,
          overdueUnpaidOnly: false,
          page: 1,
          viewMode: 'all'
        });
        saveRouteFilters();
        state.route = 'reservations';
        quickSearchInput.blur();
        renderRoute();
      });
    }

    document.getElementById('sidebar-collapse-btn').addEventListener('click', function () {
      state.prefs.sidebarCollapsed = !state.prefs.sidebarCollapsed;
      savePrefs();
      var sb = document.getElementById('app-sidebar');
      sb.classList.toggle('collapsed', state.prefs.sidebarCollapsed);
      saveLayoutPrefs({ sidebarCollapsed: Boolean(state.prefs.sidebarCollapsed) }, { reRenderNav: false, persist: true }).catch(function () {});
    });

    var overlay = document.getElementById('sidebar-overlay');
    var sidebar = document.getElementById('app-sidebar');
    document.getElementById('mobile-menu-btn').addEventListener('click', function () {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
    });
    overlay.addEventListener('click', function () {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
    });

    var brandHomeLink = document.getElementById('brand-home-link');
    if (brandHomeLink) {
      brandHomeLink.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        var curU = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : user;
        var homeRoute = resolveSafeRouteForUser('dashboard', curU, getLayoutPrefs(curU));
        if (!homeRoute) return;
        if (state.route === homeRoute) {
          var pc = document.getElementById('page-content');
          if (pc && typeof pc.scrollTo === 'function') pc.scrollTo({ top: 0, behavior: 'smooth' });
          if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
          renderRoute();
          return;
        }
        requestCloseWithGuard(function () {
          state.route = homeRoute;
          renderRoute();
        });
      });
    }

    bindSidebarNavEvents(user);

    var refreshBtn = document.getElementById('refresh-view-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        withActionLock(refreshBtn, 'manualRefresh', async function () {
          refreshBtn.classList.add('rg-spinning');
          try {
            await refreshCurrentRouteAndNotifications({ manual: true });
            toast(t('refresh_done'));
          } finally {
            refreshBtn.classList.remove('rg-spinning');
          }
        });
      });
    }

    var profileMenuBtn = document.getElementById('user-profile-menu-btn');
    if (profileMenuBtn) {
      profileMenuBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleProfileMenu();
      });
    }

    document.getElementById('notif-toggle-btn').addEventListener('click', toggleNotificationsPopover);

    var themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', function () {
        toggleThemeWithReveal(themeToggleBtn);
      });
    }

    document.getElementById('lang-toggle-btn').addEventListener('click', function () {
      state.prefs.lang = state.prefs.lang === 'ar' ? 'en' : 'ar';
      savePrefs();
      applyThemeAndLang();
      saveLayoutPrefs({ lang: state.prefs.lang }, { reRenderNav: false, persist: true }).catch(function () {});
      renderAppShell(user);
      renderRoute();
    });

    document.getElementById('logout-btn').addEventListener('click', function () {
      requestCloseWithGuard(async function () {
        clearUnsavedGuard();
        closeProfileMenu();
        closeNotificationsPopover();
        closeCallWrapUpBar();
        stopAutoRefreshLoop();
        state.route = 'dashboard';
        state.previewSession = null;
        state.layoutPrefs = normalizeLayoutPrefsFallback({});
        state.announcements = [];
        state.activeLocks = [];
        state.lastDeltaSyncAt = '';
        delete state.reservations;
        delete state.reports;
        delete state.problems;
        delete state.followups;
        delete state.teamFollowUps;
        delete state.myFollowUps;
        delete state.dashboard;
        clearRouteFiltersStorage();
        state.notifications = { items: [], unreadCount: 0 };
        resetEmployeesState();
        state.uiSimplification = normalizeUiSimpFallback({});
        clearUiSimplificationClasses();
        await root.RGAuth.logout();
        renderLoginScreen();
      });
    });
  }

  function applyNotificationsState(data) {
    if (!data) return;
    state.notifications = data;
    lastFingerprints.notifications = computeFingerprintSafe(data);
    var badge = document.getElementById('notif-badge');
    if (badge) {
      var count = data.unreadCount || 0;
      badge.textContent = String(count);
      badge.classList.toggle('hidden', count === 0);
    }
  }

  function canRunSilentAutoRefreshNow() {
    var activeEl = document.activeElement;
    var isInputFocused = Boolean(activeEl && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName));
    var isModalOpen = Boolean(document.querySelector('#modal-root > *, #rg-handover-root > *, #rg-pdf-preview-root > *, #rg-datepicker-portal > *, #notif-popover'));
    var isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    var isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    var hasActiveLocks = Object.keys(activeActionLocks).length > 0;
    if (root.RGCrmCore && root.RGCrmCore.shouldAutoRefreshNow) {
      return root.RGCrmCore.shouldAutoRefreshNow({
        isModalOpen: isModalOpen,
        isInputFocused: isInputFocused,
        isOffline: isOffline,
        isHidden: isHidden,
        hasActiveLocks: hasActiveLocks
      });
    }
    return !isModalOpen && !isInputFocused && !isOffline && !isHidden && !hasActiveLocks;
  }

  async function refreshCurrentRouteAndNotifications(opts) {
    var options = opts || {};
    var curUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!curUser) return;
    if (!options.manual && !canRunSilentAutoRefreshNow()) return;
    if (!options.manual && isAutoRefreshInFlight) return;

    isAutoRefreshInFlight = true;
    try {
      var activeRoute = state.route;
      var req = getRoutePrimaryRequest(activeRoute);

      var [notifRes, routeRes] = await Promise.all([
        root.RGApi.callApi('getNotifications', { silentRefresh: true }),
        req
          ? root.RGApi.callApi(req.action, Object.assign({}, req.payload, { silentRefresh: true }))
          : Promise.resolve(null)
      ]);

      if (!root.RGAuth || !root.RGAuth.getUser()) return;
      if (!options.manual && !canRunSilentAutoRefreshNow()) return;

      if (notifRes && notifRes.success && notifRes.data) {
        var nextNotifFp = computeFingerprintSafe(notifRes.data);
        if (nextNotifFp !== lastFingerprints.notifications) {
          applyNotificationsState(notifRes.data);
        }
      }

      if (state.route !== activeRoute) return;

      if (req && routeRes && routeRes.success && routeRes.data) {
        if (activeRoute === 'employees') {
          syncEmployeesStateFromPayload(routeRes.data);
        }
        var nextRouteFp = computeFingerprintSafe(routeRes.data);
        var prevRouteFp = lastFingerprints.routes[activeRoute];
        if (options.manual || nextRouteFp !== prevRouteFp) {
          lastFingerprints.routes[activeRoute] = nextRouteFp;
          var container = document.getElementById('page-content');
          var slot = container ? container.querySelector('.route-view') : null;
          if (slot && typeof slot._rgRefreshDataOnly === 'function') {
            await slot._rgRefreshDataOnly({
              silent: !options.manual,
              manual: Boolean(options.manual),
              prefetchedData: routeRes.data
            });
          } else if (slot) {
            await renderActiveRouteView(slot, buildAppCtx(), { silent: false });
          } else {
            await renderRoute();
          }
        }
      } else if (options.manual) {
        var manualContainer = document.getElementById('page-content');
        var manualSlot = manualContainer ? manualContainer.querySelector('.route-view') : null;
        if (manualSlot && typeof manualSlot._rgRefreshDataOnly === 'function') {
          await manualSlot._rgRefreshDataOnly({ silent: false, manual: true, forceRefresh: true });
        } else {
          await renderRoute();
        }
      }
    } finally {
      isAutoRefreshInFlight = false;
    }
  }

  var seenSseEventIds = {};
  var seenSseEventOrder = [];
  var lastDeltaRadarCountsSnap = null;

  function pushSyncDiagnostic(kind, level, message, detail) {
    try {
      var core = root.RGCrmCore;
      var entry = {
        kind: kind || 'sync',
        level: level || 'info',
        message: message || '',
        detail: detail || ''
      };
      if (core && typeof core.appendSyncDiagnosticLog === 'function') {
        syncDiagnostics = core.appendSyncDiagnosticLog(syncDiagnostics, entry, 80);
      } else if (entry.message) {
        syncDiagnostics = [Object.assign({ id: 'LOG_' + Date.now(), time: new Date().toISOString() }, entry)].concat(syncDiagnostics).slice(0, 80);
      }
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('rg:syncdiagupdate', {
          detail: { logs: syncDiagnostics.slice(), entry: syncDiagnostics[0] || null }
        }));
      }
    } catch (_eDiag) {}
  }

  function getSyncDiagnostics() {
    return syncDiagnostics.slice();
  }

  function getSyncStatusSummary() {
    return {
      currentVersion: String(root.__RG_BUILD_VERSION__ || 'dev'),
      lastCheckedRemoteVersion: lastCheckedRemoteVersion,
      lastVersionCheckAt: lastVersionCheckAt,
      lastUpdateStatus: lastUpdateStatus,
      sseConnected: sseConnected,
      sseErrorCount: sseErrorCount,
      consecutiveSyncErrors: consecutiveSyncErrors,
      networkDegraded: networkDegraded,
      lastSyncVersion: lastSyncVersion,
      lastDeltaSyncAt: state.lastDeltaSyncAt || '',
      offline: isAppOfflineNow(),
      offlineQueueCount: Number((state.offlineQueue && state.offlineQueue.count) || 0)
    };
  }

  var AUTO_UPDATE_ATTEMPT_KEY = 'rg_crm_auto_update_attempt';
  var JUST_UPDATED_KEY = 'rg_crm_just_updated_to';

  function purgeAppCachesForReload() {
    var ops = [];
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('rg_crm_swr_v1');
      }
    } catch (_eS) {}
    try {
      if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
        ops.push(caches.keys().then(function (names) {
          return Promise.all((names || []).map(function (name) {
            return caches.delete(name).catch(function () {});
          }));
        }).catch(function () {}));
      }
    } catch (_eC) {}
    try {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        ops.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          (regs || []).forEach(function (reg) {
            if (reg && reg.waiting) {
              try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_eP) {}
            }
          });
        }).catch(function () {}));
      }
    } catch (_eSw) {}
    return Promise.all(ops).catch(function () {});
  }

  async function fetchRemoteVersionManifest() {
    if (typeof fetch !== 'function') return null;
    var ts = Date.now();
    var core = root.RGCrmCore;
    var candidates = ['/api/version?_ts=' + ts, assetUrl('version.json') + '?_ts=' + ts];
    for (var i = 0; i < candidates.length; i++) {
      var u = candidates[i];
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_e) {} }, 6000) : null;
      try {
        var opts = { method: 'GET', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } };
        if (ctrl) opts.signal = ctrl.signal;
        var resp = await fetch(u, opts);
        if (timer) clearTimeout(timer);
        if (!resp || !resp.ok) continue;
        var cType = resp.headers && resp.headers.get ? String(resp.headers.get('content-type') || '').toLowerCase() : '';
        var text = await resp.text();
        var trimmed = String(text || '').trim();
        if (!trimmed || trimmed.charAt(0) === '<' || cType.indexOf('text/html') !== -1) continue;
        var json = JSON.parse(trimmed);
        var norm = (core && typeof core.normalizeVersionManifest === 'function')
          ? core.normalizeVersionManifest(json)
          : { version: String((json && (json.version || json.buildId)) || '').trim(), buildId: String((json && (json.buildId || json.version)) || '').trim(), builtAt: String((json && json.builtAt) || '') };
        if (norm && norm.version) return norm;
      } catch (_err) {
        if (timer) clearTimeout(timer);
      }
    }
    return null;
  }

  function performSafeAutoReload(targetVersion, trigger) {
    if (isUpdateReloadInFlight) return;
    isUpdateReloadInFlight = true;
    lastUpdateStatus = 'updating';
    if (pendingUpdateDeferTimer) {
      clearTimeout(pendingUpdateDeferTimer);
      pendingUpdateDeferTimer = null;
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(AUTO_UPDATE_ATTEMPT_KEY, JSON.stringify({ version: targetVersion, at: Date.now() }));
        sessionStorage.setItem(JUST_UPDATED_KEY, String(targetVersion || ''));
      }
    } catch (_eSess) {}
    try {
      if (typeof localStorage !== 'undefined' && targetVersion) {
        localStorage.setItem('rg_crm_client_build', String(targetVersion));
      }
    } catch (_eLoc) {}
    pushSyncDiagnostic('update', 'info', 'تم اكتشاف إصدار جديد (' + targetVersion + ') — جاري التحديث وإعادة التحميل تلقائياً', 'Trigger: ' + String(trigger || 'auto'));
    stopAutoRefreshLoop();
    toast((state.prefs.lang === 'en') ? 'New update detected — refreshing automatically...' : 'يتوفر إصدار جديد من النظام — جاري التحديث التلقائي...');
    purgeAppCachesForReload().finally(function () {
      setTimeout(function () {
        try {
          window.location.reload();
        } catch (_eRel) {
          window.location.href = window.location.href;
        }
      }, 450);
    });
  }

  async function checkForUpdates(opts) {
    var options = opts || {};
    if (isUpdateReloadInFlight) return { updated: true, status: 'reloading' };
    if (isAppOfflineNow()) return { updated: false, status: 'offline' };
    if (isVersionCheckInFlight && !options.manual) return { updated: false, status: 'busy' };

    isVersionCheckInFlight = true;
    var core = root.RGCrmCore;
    var curVer = String(root.__RG_BUILD_VERSION__ || '').trim();
    try {
      if (typeof root.__RG_CHECK_SW_UPDATE__ === 'function') {
        root.__RG_CHECK_SW_UPDATE__().catch(function () {});
      }
      var manifest = await fetchRemoteVersionManifest();
      lastVersionCheckAt = new Date().toISOString();
      var remVer = String((manifest && manifest.version) || options.remoteVersionHint || '').trim();
      if (remVer) lastCheckedRemoteVersion = remVer;

      if (!remVer) {
        lastUpdateStatus = 'unavailable';
        if (options.manual) {
          pushSyncDiagnostic('update', 'warn', 'تعذر قراءة ملف بيان الإصدار من الخادم', 'Trigger: ' + String(options.trigger || 'manual'));
        }
        return { updated: false, status: 'unavailable', currentVersion: curVer };
      }

      var lastAttempt = { version: '', at: 0 };
      try {
        var rawAtt = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AUTO_UPDATE_ATTEMPT_KEY) : '';
        if (rawAtt) lastAttempt = JSON.parse(rawAtt) || lastAttempt;
      } catch (_eAtt) {}

      var hasInFlightMut = Boolean(root.RGApi && typeof root.RGApi.hasInFlightMutations === 'function' && root.RGApi.hasInFlightMutations());
      var hasUnsaved = Boolean(activeUnsavedGuard && typeof activeUnsavedGuard.isDirty === 'function' && activeUnsavedGuard.isDirty());

      var decision = (core && typeof core.shouldTriggerAutoUpdateReload === 'function')
        ? core.shouldTriggerAutoUpdateReload({
            currentVersion: curVer,
            remoteVersion: remVer,
            isUpdating: isUpdateReloadInFlight,
            lastAttemptVer: lastAttempt.version,
            lastAttemptAt: lastAttempt.at,
            cooldownMs: 30000,
            hasInFlightMutations: hasInFlightMut,
            hasUnsavedChanges: hasUnsaved,
            ignoreUnsaved: Boolean(options.ignoreUnsaved)
          })
        : {
            shouldReload: Boolean(curVer && remVer && curVer !== 'dev' && remVer !== 'dev' && curVer !== remVer && !hasInFlightMut && !hasUnsaved),
            reason: (curVer === remVer) ? 'up_to_date' : 'new_version_detected',
            targetVersion: remVer,
            deferMs: 2500
          };

      if (decision.shouldReload) {
        performSafeAutoReload(decision.targetVersion || remVer, options.trigger || 'version_check');
        return { updated: true, status: 'reloading', currentVersion: curVer, remoteVersion: remVer };
      }

      if (decision.reason === 'up_to_date') {
        lastUpdateStatus = 'up_to_date';
        if (options.manual) {
          pushSyncDiagnostic('update', 'info', 'التطبيق يعمل على أحدث إصدار متاح (' + curVer + ')', 'Trigger: ' + String(options.trigger || 'manual'));
        }
        return { updated: false, upToDate: true, status: 'up_to_date', currentVersion: curVer, remoteVersion: remVer };
      }

      if (decision.reason === 'cooldown_antiloop') {
        lastUpdateStatus = 'cooldown';
        pushSyncDiagnostic('update', 'warn', 'تم تأجيل إعادة التحميل التلقائي مؤقتاً لمنع التكرار السريع (' + remVer + ')', 'Wait: ' + Math.round(Number(decision.waitMs || 0) / 1000) + 's');
        return { updated: false, status: 'cooldown', currentVersion: curVer, remoteVersion: remVer };
      }

      if (decision.reason === 'inflight_mutations' || decision.reason === 'unsaved_changes') {
        lastUpdateStatus = 'deferred';
        pushSyncDiagnostic('update', 'warn', 'تحديث جديد متاح (' + remVer + ') — مؤجل لحين انتهاء التعديلات الجارية', decision.reason);
        if (decision.reason === 'unsaved_changes' && notifiedUnsavedUpdateVer !== remVer) {
          notifiedUnsavedUpdateVer = remVer;
          toast((state.prefs.lang === 'en') ? 'Update available — will apply automatically once unsaved edits are completed.' : 'يتوفر إصدار جديد — سيتم التحديث تلقائياً فور حفظ أو إغلاق التعديلات الحالية.');
        }
        if (pendingUpdateDeferTimer) clearTimeout(pendingUpdateDeferTimer);
        pendingUpdateDeferTimer = setTimeout(function () {
          pendingUpdateDeferTimer = null;
          checkForUpdates({ trigger: 'deferred_retry', remoteVersionHint: remVer }).catch(function () {});
        }, Number(decision.deferMs || 2500));
        return { updated: false, deferred: true, status: decision.reason, currentVersion: curVer, remoteVersion: remVer };
      }

      return { updated: false, status: decision.reason || 'skipped', currentVersion: curVer, remoteVersion: remVer };
    } finally {
      isVersionCheckInFlight = false;
    }
  }

  function handleSwControllerChange() {
    if (isUpdateReloadInFlight) return;
    var hasInFlightMut = Boolean(root.RGApi && typeof root.RGApi.hasInFlightMutations === 'function' && root.RGApi.hasInFlightMutations());
    var hasUnsaved = Boolean(activeUnsavedGuard && typeof activeUnsavedGuard.isDirty === 'function' && activeUnsavedGuard.isDirty());
    if (hasInFlightMut || hasUnsaved) {
      pushSyncDiagnostic('update', 'warn', 'تم تفعيل عامل الخدمة الجديد (Service Worker) — في انتظار انتهاء التعديلات للتحديث', '');
      if (pendingUpdateDeferTimer) clearTimeout(pendingUpdateDeferTimer);
      pendingUpdateDeferTimer = setTimeout(function () {
        pendingUpdateDeferTimer = null;
        handleSwControllerChange();
      }, 2500);
      return;
    }
    pushSyncDiagnostic('update', 'info', 'تم تفعيل إصدار جديد من Service Worker — جاري تحديث الواجهة تلقائياً', 'controllerchange');
    performSafeAutoReload(lastCheckedRemoteVersion || String(root.__RG_BUILD_VERSION__ || ''), 'sw_controllerchange');
  }

  root.RGUpdateManager = {
    checkForUpdates: checkForUpdates,
    handleSwControllerChange: handleSwControllerChange,
    getStatus: getSyncStatusSummary
  };

  function recordSseEventOnce(evData) {
    if (!evData || typeof evData !== 'object') return true;
    var key = String(evData.version || evData.at || '') + ':' + String(evData.type || '') + ':' + String(evData.action || '');
    if (key === '::') return true;
    if (seenSseEventIds[key]) return false;
    seenSseEventIds[key] = true;
    seenSseEventOrder.push(key);
    if (seenSseEventOrder.length > 100) {
      var oldest = seenSseEventOrder.shift();
      delete seenSseEventIds[oldest];
    }
    return true;
  }

  function scheduleNextDeltaPoll() {
    if (deltaSyncTimer) {
      clearTimeout(deltaSyncTimer);
      deltaSyncTimer = null;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (isAppOfflineNow()) return;
    var curUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!curUser) return;
    var core = root.RGCrmCore;
    var delayMs = (core && typeof core.computeAdaptiveSyncDelay === 'function')
      ? core.computeAdaptiveSyncDelay({
          isOnline: !isAppOfflineNow(),
          isVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
          sseConnected: sseConnected,
          consecutiveErrors: consecutiveSyncErrors,
          sseHeartbeatMs: 15000,
          fallbackPollMs: 3000
        })
      : (sseConnected ? 15000 : 3000);
    if (!delayMs || delayMs <= 0) return;
    deltaSyncTimer = setTimeout(function () {
      deltaSyncTimer = null;
      runDeltaSync().catch(function () {});
    }, delayMs);
  }

  async function syncSettingsChangesSilently(curUser) {
    try {
      if (!root.RGApi || !root.RGApi.callApi) return;
      var sRes = await root.RGApi.callApi('getSettings', { forceRefresh: true, silentRefresh: true });
      if (!sRes || !sRes.success || !sRes.data) return;
      var sData = sRes.data;
      if (sData.role_ui_defaults) {
        setRoleUiDefaults(sData.role_ui_defaults);
      }
      if (sData.stats_control_config) {
        setStatsControlConfig(sData.stats_control_config);
      }
      if (sData.call_wrapup_shortcuts) {
        setCallWrapupShortcutsConfig(sData.call_wrapup_shortcuts);
      }
      if (sData.ui_simplification) {
        applyUiSimplification(sData.ui_simplification, true);
      }
      if (sData.handover_settings) {
        setHandoverSettings(sData.handover_settings);
      }
      if (curUser) {
        refreshSidebarNavDom(curUser);
      }
    } catch (_eSet) {}
  }

  async function runDeltaSync() {
    var curUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (!curUser) return;
    if (isAppOfflineNow()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (isDeltaSyncInFlight) return;

    isDeltaSyncInFlight = true;
    try {
      var res = await root.RGApi.callApi('getDeltaSync', {
        updatedAfter: state.lastDeltaSyncAt || '',
        silentRefresh: true
      });
      if (!res || !res.success || !res.data) {
        consecutiveSyncErrors += 1;
        if (consecutiveSyncErrors === 1 || !networkDegraded) {
          networkDegraded = true;
          pushSyncDiagnostic('sync', 'warn', 'تعثر فحص المزامنة اللحظية — ستُعاد المحاولة تلقائياً', (res && res.message) || (res && res.error) || 'SYNC_RETRY');
        }
        return;
      }
      var wasRecovering = consecutiveSyncErrors > 0 || networkDegraded;
      consecutiveSyncErrors = 0;
      networkDegraded = false;
      var d = res.data;
      if (d.serverTime) state.lastDeltaSyncAt = d.serverTime;
      if (typeof d.syncVersion === 'number' && d.syncVersion > lastSyncVersion) {
        lastSyncVersion = d.syncVersion;
      }

      var prevRole = curUser.role;
      var prevDelId = curUser.activeDelegation ? curUser.activeDelegation.id : '';
      var prevPermsStr = JSON.stringify((curUser.permissions || []).slice().sort());
      var prevOvStr = JSON.stringify(curUser.uiOverrides || {});

      if (root.RGApi && typeof root.RGApi.applyDeltaSyncToCache === 'function') {
        root.RGApi.applyDeltaSyncToCache(d);
      }

      if (d.notifications) {
        var nextNotifFp = computeFingerprintSafe(d.notifications);
        if (nextNotifFp !== lastFingerprints.notifications) {
          applyNotificationsState(d.notifications);
        }
      }
      if (Array.isArray(d.announcements)) {
        var nextAnnFp = computeFingerprintSafe(d.announcements);
        if (nextAnnFp !== lastFingerprints.announcements) {
          setAnnouncements(d.announcements);
        }
      }
      if (Array.isArray(d.locks)) {
        setActiveLocks(d.locks);
      }

      var deltaUiCfg = d.clientUiConfig && typeof d.clientUiConfig === 'object' ? d.clientUiConfig : null;
      var nextRoleDefaults = d.roleUiDefaults || (deltaUiCfg && deltaUiCfg.roleUiDefaults) || null;
      var nextUiSimp = d.uiSimplification || (deltaUiCfg && deltaUiCfg.uiSimplification) || null;
      var uiCfgChanged = false;
      if (nextRoleDefaults) {
        var prevRoleDefFp = computeFingerprintSafe(state.roleUiDefaults || {});
        setRoleUiDefaults(nextRoleDefaults);
        if (computeFingerprintSafe(state.roleUiDefaults || {}) !== prevRoleDefFp) {
          uiCfgChanged = true;
        }
      }
      if (nextUiSimp) {
        var prevUiSimpFp = computeFingerprintSafe(state.uiSimplification || {});
        applyUiSimplification(nextUiSimp, true);
        if (computeFingerprintSafe(state.uiSimplification || {}) !== prevUiSimpFp) {
          uiCfgChanged = true;
        }
      }
      if (deltaUiCfg && deltaUiCfg.statsControlConfig) {
        setStatsControlConfig(deltaUiCfg.statsControlConfig);
      }
      if (deltaUiCfg && deltaUiCfg.handoverSettings) {
        setHandoverSettings(deltaUiCfg.handoverSettings);
      }

      var userShellChanged = false;
      if (d.user && root.RGAuth && typeof root.RGAuth.setUser === 'function') {
        var nextDelId = d.user.activeDelegation ? d.user.activeDelegation.id : '';
        var nextPermsStr = JSON.stringify((d.user.permissions || []).slice().sort());
        var nextOvStr = JSON.stringify(d.user.uiOverrides || {});
        if (d.user.role !== prevRole || prevDelId !== nextDelId || prevPermsStr !== nextPermsStr || prevOvStr !== nextOvStr) {
          userShellChanged = true;
          root.RGAuth.setUser(d.user);
        }
      }
      if (userShellChanged || uiCfgChanged) {
        var effectiveShellUser = d.user || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : curUser);
        applyUiSimplification(state.uiSimplification, true);
        var hasOpenModalNow = Boolean(document.getElementById('modal-root') && document.getElementById('modal-root').firstElementChild);
        if (hasOpenModalNow) {
          refreshSidebarNavDom(effectiveShellUser);
        } else {
          renderAppShell(effectiveShellUser);
          renderRoute().catch(function () {});
        }
      }

      if (d.callWrapupShortcuts) {
        setCallWrapupShortcutsConfig(d.callWrapupShortcuts);
      }
      if (d.changedSettings) {
        syncSettingsChangesSilently(d.user || curUser).catch(function () {});
      }

      var hasEmployeeChanges = Boolean(
        (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
        (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
        Boolean(d.changedDelegations) ||
        Boolean(d.changedRoles)
      );
      if (hasEmployeeChanges && state.employees && state.employees.loaded) {
        var prevEmpItems = Array.isArray(state.employees.items) ? state.employees.items.slice() : [];
        var mergedEmps = (root.RGCrmCore && root.RGCrmCore.mergeDeltaRecords && Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0)
          ? root.RGCrmCore.mergeDeltaRecords(prevEmpItems, d.changedEmployees, 'id')
          : prevEmpItems;
        if (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) {
          var delEmpMap = {};
          d.deletedEmployeeIds.forEach(function (did) { if (did) delEmpMap[String(did)] = true; });
          mergedEmps = mergedEmps.filter(function (emp) { return emp && !delEmpMap[String(emp.id)]; });
        }
        setEmployeesState({
          items: mergedEmps,
          lastUpdatedAt: new Date().toISOString()
        });
      }

      var prevDeltaMeta = {
        todayRadarCounts: lastDeltaRadarCountsSnap,
        announcementsFp: lastFingerprints.announcements
      };
      var hasChanges = (root.RGCrmCore && typeof root.RGCrmCore.hasMeaningfulDeltaChanges === 'function')
        ? root.RGCrmCore.hasMeaningfulDeltaChanges(d, prevDeltaMeta)
        : Boolean(
            (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
            (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
            (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
            (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
            (Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0) ||
            hasEmployeeChanges ||
            Boolean(d.changedSettings) ||
            Boolean(d.deletedAllReservationsBefore) ||
            (Array.isArray(d.deletedAnnouncementIds) && d.deletedAnnouncementIds.length > 0)
          );
      if (d.todayRadarCounts && typeof d.todayRadarCounts === 'object') {
        lastDeltaRadarCountsSnap = Object.assign({}, d.todayRadarCounts);
      }

      if (hasChanges && root.RGApi) {
        var scopesToInvalidate = ['dashboard', 'activity', 'reports', 'todayRadar', 'followUps'];
        if ((Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0)) {
          scopesToInvalidate.push('problems', 'reservations', 'notifications');
        }
        if ((Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) || d.deletedAllReservationsBefore) {
          scopesToInvalidate.push('reservations', 'followUps', 'problems');
        }
        if ((Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) || d.changedDelegations || d.changedRoles) {
          scopesToInvalidate.push('employees');
        }
        if (d.changedSettings) {
          scopesToInvalidate.push('settings', 'employees');
        }
        if (d.deletedAllReservationsBefore && root.RGApi.clearCache) {
          root.RGApi.clearCache(scopesToInvalidate);
        } else if (typeof root.RGApi.markScopesStale === 'function') {
          root.RGApi.markScopesStale(scopesToInvalidate);
        } else if (root.RGApi.invalidateScopes) {
          root.RGApi.invalidateScopes(scopesToInvalidate);
        }
      }

      if (hasChanges) {
        pushSyncDiagnostic(
          'delta',
          'info',
          'تمت مزامنة تحديثات لحظية من الخادم',
          'Res:' + ((d.changedReservations && d.changedReservations.length) || 0) +
          ' · FU:' + ((d.changedFollowUps && d.changedFollowUps.length) || 0) +
          ' · Prb:' + ((d.changedProblems && d.changedProblems.length) || 0)
        );
      }

      document.dispatchEvent(new CustomEvent('rg:deltasync', { detail: d }));

      if (wasRecovering) {
        pushSyncDiagnostic('sync', 'info', 'تمت استعادة المزامنة مع الخادم وتحديث البيانات', '');
        if (root.RGApi && typeof root.RGApi.syncOfflineQueue === 'function') {
          root.RGApi.syncOfflineQueue().then(function () { updateOfflineBanner().catch(function () {}); }).catch(function () {});
        }
        refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
      } else if (hasChanges && canRunSilentAutoRefreshNow()) {
        if (state.route === 'activity' || state.route === 'reports') {
          refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
        }
      }
    } catch (err) {
      consecutiveSyncErrors += 1;
      if (!networkDegraded) {
        networkDegraded = true;
        pushSyncDiagnostic('sync', 'warn', 'انقطاع مؤقت في الاتصال أثناء المزامنة', (err && err.message) || 'NETWORK_ERROR');
      }
    } finally {
      isDeltaSyncInFlight = false;
      scheduleNextDeltaPoll();
    }
  }

  function scheduleDebouncedDeltaSync() {
    if (deltaDebounceTimer) clearTimeout(deltaDebounceTimer);
    deltaDebounceTimer = setTimeout(function () {
      deltaDebounceTimer = null;
      runDeltaSync().catch(function () {});
    }, 180);
  }

  function stopSseConnection() {
    sseConnected = false;
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }
    if (sseSource) {
      try { sseSource.close(); } catch (_e) {}
      sseSource = null;
    }
  }

  function handleIncomingSseEvent(ev) {
    var evData = null;
    if (ev && ev.data) {
      try { evData = JSON.parse(ev.data); } catch (_e) { evData = null; }
    }
    if (ev && ev.type === 'ready' && evData && evData.appVersion) {
      checkForUpdates({ trigger: 'sse_ready', remoteVersionHint: evData.appVersion }).catch(function () {});
      return;
    }
    if (evData && !recordSseEventOnce(evData)) return;

    var curUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    if (evData && curUser && evData.actorId && String(evData.actorId) === String(curUser.id)) {
      if (Array.isArray(evData.scopes) && evData.scopes.length && root.RGApi) {
        if (typeof root.RGApi.markScopesStale === 'function') root.RGApi.markScopesStale(evData.scopes);
        else if (root.RGApi.clearCache) root.RGApi.clearCache(evData.scopes);
      }
      if (evData.originTabId && evData.originTabId === tabInstanceId) {
        return;
      }
    }

    scheduleDebouncedDeltaSync();
  }

  function startSseConnection() {
    stopSseConnection();
    if (typeof EventSource === 'undefined') return;
    if (!root.RGApi || !root.RGApi.isBackendConnected || !root.RGApi.isBackendConnected()) return;
    var token = root.RGApi.getToken ? root.RGApi.getToken() : '';
    if (!token || isAppOfflineNow()) return;

    try {
      var src = new EventSource('/api/events?token=' + encodeURIComponent(token));
      sseSource = src;
      src.addEventListener('open', function () {
        var wasDisconnected = sseErrorCount > 0;
        sseConnected = true;
        sseErrorCount = 0;
        scheduleNextDeltaPoll();
        if (wasDisconnected) {
          pushSyncDiagnostic('sse', 'info', 'تمت استعادة قناة البث اللحظي (SSE)', '');
          runDeltaSync().catch(function () {});
        }
      });
      src.addEventListener('ready', handleIncomingSseEvent);
      src.addEventListener('crm', handleIncomingSseEvent);
      src.addEventListener('delta', handleIncomingSseEvent);
      src.addEventListener('announcement', handleIncomingSseEvent);
      src.addEventListener('lock', handleIncomingSseEvent);
      src.addEventListener('settings', handleIncomingSseEvent);
      src.onerror = function () {
        stopSseConnection();
        sseErrorCount += 1;
        if (sseErrorCount === 1) {
          pushSyncDiagnostic('sse', 'info', 'تم تفعيل وضع المزامنة السريعة التلقائي (Polling 3s)', 'SSE fallback');
        }
        scheduleNextDeltaPoll();
        if (root.RGAuth && root.RGAuth.getUser && root.RGAuth.getUser() && !isAppOfflineNow() && (!document || document.visibilityState !== 'hidden')) {
          var backoffMs = Math.min(30000, 3000 * Math.pow(2, Math.min(3, sseErrorCount - 1)));
          sseReconnectTimer = setTimeout(startSseConnection, backoffMs);
        }
      };
    } catch (_e) {}
  }

  function stopAutoRefreshLoop() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (deltaSyncTimer) {
      clearTimeout(deltaSyncTimer);
      deltaSyncTimer = null;
    }
    if (versionCheckTimer) {
      clearInterval(versionCheckTimer);
      versionCheckTimer = null;
    }
    stopSseConnection();
  }

  function scheduleRefreshInterval() {
    stopAutoRefreshLoop();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    autoRefreshTimer = setInterval(function () {
      refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
    }, 60000);
    versionCheckTimer = setInterval(function () {
      checkForUpdates({ trigger: 'periodic' }).catch(function () {});
    }, 45000);
    startSseConnection();
    scheduleNextDeltaPoll();
  }

  function startAutoRefreshLoop() {
    scheduleRefreshInterval();
    checkForUpdates({ trigger: 'boot' }).catch(function () {});

    if (!autoRefreshListenersBound) {
      autoRefreshListenersBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          lastHiddenAt = Date.now();
          stopAutoRefreshLoop();
          return;
        }
        if (document.visibilityState === 'visible') {
          scheduleRefreshInterval();
          checkForUpdates({ trigger: 'visibility' }).catch(function () {});
          runDeltaSync().catch(function () {});
          if (lastHiddenAt && (Date.now() - lastHiddenAt >= 5000)) {
            lastHiddenAt = 0;
            refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
          }
        }
      });
      window.addEventListener('focus', function () {
        if (document && document.visibilityState === 'hidden') return;
        checkForUpdates({ trigger: 'focus' }).catch(function () {});
      });
      document.addEventListener('rg:versionmismatch', function (ev) {
        var det = (ev && ev.detail) || {};
        checkForUpdates({ trigger: 'header_mismatch', remoteVersionHint: det.remoteVersion || '' }).catch(function () {});
      });
      document.addEventListener('rg:swupdatefound', function () {
        checkForUpdates({ trigger: 'sw_updatefound' }).catch(function () {});
      });
      document.addEventListener('rg:swcontrollerchange', function () {
        handleSwControllerChange();
      });
      document.addEventListener('rg:optimisticrollback', function (ev) {
        var det = (ev && ev.detail) || {};
        pushSyncDiagnostic('conflict', 'warn', 'تم التراجع عن تعديل محلي لعدم حفظه على الخادم ومزامنة الحالة الصحيحة', String(det.action || ''));
        toast((state.prefs.lang === 'en') ? 'Change was not confirmed on server — synchronized latest database state.' : 'تعذر اعتماد التعديل أو تم تغييره من مستخدم آخر — تمت مزامنة أحدث بيانات من الخادم.', true);
        runDeltaSync().catch(function () {});
        refreshCurrentRouteAndNotifications({ manual: true }).catch(function () {});
      });
      document.addEventListener('rg:networkstate', function (ev) {
        var det = (ev && ev.detail) || {};
        updateOfflineBanner().catch(function () {});
        if (det.online === false) {
          pushSyncDiagnostic('network', 'warn', 'انقطاع الاتصال بالخادم — تفعيل الوضع المؤقت وإعادة المحاولة التلقائية', String(det.reason || ''));
        } else if (det.online === true) {
          pushSyncDiagnostic('network', 'info', 'استعادة الاتصال بالخادم — جاري مزامنة التغييرات وفحص التحديثات', String(det.reason || ''));
          if (root.RGApi && typeof root.RGApi.syncOfflineQueue === 'function') {
            root.RGApi.syncOfflineQueue().then(function () { updateOfflineBanner().catch(function () {}); }).catch(function () {});
          }
          runDeltaSync().catch(function () {});
          checkForUpdates({ trigger: 'network_recovered' }).catch(function () {});
        }
      });
      window.addEventListener('online', function () {
        updateOfflineBanner().catch(function () {});
        pushSyncDiagnostic('network', 'info', 'عودة اتصال الإنترنت — مزامنة الطابور المحلي وفحص الإصدار', '');
        if (root.RGApi && typeof root.RGApi.syncOfflineQueue === 'function') {
          root.RGApi.syncOfflineQueue().then(function (sRes) {
            updateOfflineBanner().catch(function () {});
            if (sRes && sRes.synced > 0) {
              toast('تمت استعادة الاتصال ومزامنة ' + sRes.synced + ' عملية مؤجلة.');
            }
          }).catch(function () {});
        }
        scheduleRefreshInterval();
        checkForUpdates({ trigger: 'online' }).catch(function () {});
        runDeltaSync().catch(function () {});
        refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
      });
      window.addEventListener('offline', function () {
        updateOfflineBanner().catch(function () {});
        pushSyncDiagnostic('network', 'warn', 'تم فقدان الاتصال بالإنترنت (Offline Mode)', '');
        stopSseConnection();
      });
      window.addEventListener('rg:offlinequeuechange', function () {
        updateOfflineBanner().catch(function () {});
      });
      if (syncBroadcastChannel) {
        syncBroadcastChannel.onmessage = function (ev) {
          handleSiblingTabMessage(ev && ev.data);
        };
      }
      document.addEventListener('rg:mutationcomplete', function (ev) {
        broadcastTabSync((ev && ev.detail) || {});
      });
      window.addEventListener('storage', function (ev) {
        if (!ev || !ev.key) return;
        if (ev.key === BC_PING_KEY && ev.newValue) {
          try { handleSiblingTabMessage(JSON.parse(ev.newValue)); } catch (_eBc) {}
          return;
        }
        if (String(ev.key).indexOf('rg_crm_sandbox') !== -1) {
          scheduleDebouncedDeltaSync();
        }
      });
    }
  }

  function prefetchRouteData(routeId) {
    if (!root.RGApi || !root.RGApi.hasCached || !root.RGAuth) return;
    var u = root.RGAuth.getUser();
    if (!u) return;

    var action = '';
    var payload = {};
    switch (routeId) {
      case 'reservations':
        action = 'getReservations';
        payload = { page: 1, pageSize: 20, lifecycle: 'active' };
        break;
      case 'my-followups':
        action = 'getMyFollowUps';
        break;
      case 'team-followups':
        action = 'getTeamFollowUps';
        break;
      case 'problems':
        action = 'getProblems';
        break;
      case 'reports':
        action = 'getReports';
        payload = {
          reportType: 'all_reservations',
          dateFrom: '',
          dateTo: '',
          employeeId: '',
          company: '',
          branch: '',
          logExport: false
        };
        break;
      case 'employees':
        if (root.RGCrmCore && root.RGCrmCore.canUserPerform(u, 'view_employees')) {
          action = 'getEmployees';
        }
        break;
      case 'activity':
        action = 'getActivityLogs';
        payload = {};
        break;
      case 'settings':
        if (root.RGCrmCore && (root.RGCrmCore.canAccessApi(u) || root.RGCrmCore.canUserPerform(u, 'manage_settings'))) {
          action = 'getSettings';
        }
        break;
    }
    if (!action || root.RGApi.hasCached(action, payload)) return;
    root.RGApi.callApi(action, payload).catch(function () {});
  }

  function scheduleBackgroundPrefetch() {
    // Disabled eager 2,500-row warmLocalReservationsCache on boot to reduce bandwidth & DB load.
  }

  function hydrateRealtimeBootstrapState(bData) {
    if (!bData || typeof bData !== 'object') return;
    if (bData.roleUiDefaults || (bData.settings && bData.settings.role_ui_defaults)) {
      state.roleUiDefaults = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
        ? root.RGCrmCore.normalizeRoleUiDefaults(bData.roleUiDefaults || (bData.settings && bData.settings.role_ui_defaults))
        : (bData.roleUiDefaults || (bData.settings && bData.settings.role_ui_defaults) || {});
    }
    if (bData.statsControlConfig || (bData.settings && bData.settings.stats_control_config)) {
      setStatsControlConfig(bData.statsControlConfig || (bData.settings && bData.settings.stats_control_config));
    }
    if (bData.callWrapupShortcuts || (bData.settings && bData.settings.call_wrapup_shortcuts)) {
      setCallWrapupShortcutsConfig(bData.callWrapupShortcuts || (bData.settings && bData.settings.call_wrapup_shortcuts));
    }
    if (bData.uiSimplification) {
      applyUiSimplification(bData.uiSimplification);
    } else {
      applyUiSimplification(state.uiSimplification, true);
    }
    if (bData.handoverSettings) {
      setHandoverSettings(bData.handoverSettings);
    } else if (bData.settings && bData.settings.handover_settings) {
      setHandoverSettings(bData.settings.handover_settings);
    }
    if (Array.isArray(bData.announcements)) {
      setAnnouncements(bData.announcements);
    }
    if (Array.isArray(bData.activeLocks)) {
      setActiveLocks(bData.activeLocks);
    }
    state.lastDeltaSyncAt = bData.serverTime || new Date().toISOString();
  }

  function restorePersistedPreviewIfAllowed(realUser) {
    if (!realUser || !root.RGCrmCore || !root.RGCrmCore.canUserImpersonate || !root.RGCrmCore.canUserImpersonate(realUser)) {
      state.previewSession = null;
      return realUser;
    }
    try {
      var rawSpec = sessionStorage.getItem(PREVIEW_SESSION_STORAGE_KEY);
      if (rawSpec) {
        var parsedSpec = JSON.parse(rawSpec);
        if (parsedSpec && root.RGCrmCore.resolvePreviewUserSession) {
          var pu = root.RGCrmCore.resolvePreviewUserSession(
            realUser,
            parsedSpec,
            (state.employees && state.employees.items) || [],
            (state.employees && state.employees.rolePresets) || []
          );
          if (pu) {
            state.previewSession = { spec: parsedSpec, realUser: realUser, previewUser: pu };
            applyUiSimplification(state.uiSimplification, true);
            return pu;
          }
        }
      }
    } catch (_e) {}
    return realUser;
  }

  async function bootAuthenticatedApp() {
    installAuthPreviewBridge();
    if (root.RGApi && root.RGApi.ready) {
      await root.RGApi.ready();
    }
    var dashRange = (state.dashboard && state.dashboard.range) || '30d';
    var consumed = root.RGAuth.consumeBootstrap ? root.RGAuth.consumeBootstrap() : null;
    var user = getRealUser();

    if (user && consumed && consumed.data) {
      if (root.RGAuth.primeBootstrapCaches) {
        root.RGAuth.primeBootstrapCaches(consumed.data, consumed.range || dashRange);
      }
      if (consumed.data.employees) syncEmployeesStateFromPayload(consumed.data.employees);
      hydrateRealtimeBootstrapState(consumed.data);
      user = restorePersistedPreviewIfAllowed(user);
      restoreRouteFilters(user);
      hydrateLayoutPrefsFromServer(consumed.data.layoutPrefs, user);
      renderAppShell(user);
      if (consumed.data.notifications) applyNotificationsState(consumed.data.notifications);
      await renderRoute();
      startAutoRefreshLoop();
      if (root.RGApi && root.RGApi.hasCached && !root.RGApi.hasCached('getTodayAndRadar', {})) {
        root.RGApi.callApi('getTodayAndRadar', {
          todayDate: (root.RGCrmCore && root.RGCrmCore.getRiyadhDateString) ? root.RGCrmCore.getRiyadhDateString() : '',
          nowMs: Date.now(),
          silentRefresh: true
        }).catch(function () {});
      }
      return;
    }

    if (!user && root.RGApi.getToken && root.RGApi.getToken()) {
      var bootRes = await root.RGApi.callApi('getAppBootstrap', { range: dashRange });
      var bootUser = (bootRes && bootRes.success && bootRes.data)
        ? (bootRes.data.user || (bootRes.data.me && bootRes.data.me.user) || null)
        : null;
      if (bootUser) {
        user = bootUser;
        if (root.RGAuth.setUser) root.RGAuth.setUser(user);
        if (root.RGAuth.primeBootstrapCaches) {
          root.RGAuth.primeBootstrapCaches(Object.assign({ user: bootUser }, bootRes.data), dashRange);
        }
        if (bootRes.data.employees) syncEmployeesStateFromPayload(bootRes.data.employees);
        hydrateRealtimeBootstrapState(bootRes.data);
        user = restorePersistedPreviewIfAllowed(user);
        restoreRouteFilters(user);
        hydrateLayoutPrefsFromServer(bootRes.data.layoutPrefs, user);
        renderAppShell(user);
        if (bootRes.data.notifications) applyNotificationsState(bootRes.data.notifications);
        await renderRoute();
        startAutoRefreshLoop();
        if (root.RGApi && root.RGApi.hasCached && !root.RGApi.hasCached('getTodayAndRadar', {})) {
          root.RGApi.callApi('getTodayAndRadar', {
            todayDate: (root.RGCrmCore && root.RGCrmCore.getRiyadhDateString) ? root.RGCrmCore.getRiyadhDateString() : '',
            nowMs: Date.now(),
            silentRefresh: true
          }).catch(function () {});
        }
        return;
      }
      if (bootRes && String(bootRes.error || '').indexOf('UNAUTHORIZED') === 0) {
        root.RGApi.setToken('');
        if (root.RGAuth.setUser) root.RGAuth.setUser(null);
        stopAutoRefreshLoop();
        renderLoginScreen();
        return;
      }
    }

    if (!user) {
      user = await root.RGAuth.restoreSession();
    }
    if (!user) {
      stopAutoRefreshLoop();
      renderLoginScreen();
      return;
    }

    var restoredUiCfg = (root.RGAuth && root.RGAuth.consumeRestoredUiConfig)
      ? root.RGAuth.consumeRestoredUiConfig()
      : null;
    if (restoredUiCfg && restoredUiCfg.roleUiDefaults) {
      setRoleUiDefaults(restoredUiCfg.roleUiDefaults);
    }
    if (restoredUiCfg && restoredUiCfg.uiSimplification) {
      applyUiSimplification(restoredUiCfg.uiSimplification, true);
    } else {
      applyUiSimplification(state.uiSimplification, true);
    }
    restoreRouteFilters(user);
    hydrateLayoutPrefsFromServer(
      (root.RGAuth && root.RGAuth.consumeRestoredLayoutPrefs) ? root.RGAuth.consumeRestoredLayoutPrefs() : null,
      user
    );
    renderAppShell(user);
    await Promise.all([
      renderRoute(),
      refreshNotifications(),
      root.RGApi.callApi('getAnnouncements', { silentRefresh: true }).then(function (r) {
        if (r && r.success && r.data && Array.isArray(r.data.activeItems)) setAnnouncements(r.data.activeItems);
      }).catch(function () {}),
      root.RGApi.callApi('getReservationLocks', { silentRefresh: true }).then(function (r) {
        if (r && r.success && r.data && Array.isArray(r.data.items)) setActiveLocks(r.data.items);
      }).catch(function () {})
    ]);
    state.lastDeltaSyncAt = new Date().toISOString();
    startAutoRefreshLoop();
    if (root.RGApi && root.RGApi.hasCached && !root.RGApi.hasCached('getTodayAndRadar', {})) {
      root.RGApi.callApi('getTodayAndRadar', {
        todayDate: (root.RGCrmCore && root.RGCrmCore.getRiyadhDateString) ? root.RGCrmCore.getRiyadhDateString() : '',
        nowMs: Date.now(),
        silentRefresh: true
      }).catch(function () {});
    }
  }

  root.RGApp = {
    withActionLock: withActionLock,
    isActionLocked: isActionLocked,
    checkActionSpam: checkActionSpam,
    applyNotificationsState: applyNotificationsState,
    refreshNotifications: refreshNotifications,
    refreshSidebarNavDom: refreshSidebarNavDom,
    renderAppShell: renderAppShell,
    syncCurrentUserShell: function (updatedUser) {
      if (!updatedUser) return;
      var activeUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : updatedUser;
      var isSelfUpdate = Boolean(activeUser && activeUser.id === updatedUser.id && !activeUser.isPreviewSession);
      var resolvedActive = isSelfUpdate ? updatedUser : activeUser;
      if (isSelfUpdate && root.RGAuth && typeof root.RGAuth.setUser === 'function') {
        root.RGAuth.setUser(updatedUser);
      }
      var nameEls = document.querySelectorAll('#user-profile-menu-btn .sidebar-user-name');
      nameEls.forEach(function (el) { el.textContent = resolvedActive.name || ''; });
      var avatarEls = document.querySelectorAll('#user-profile-menu-btn .sidebar-user-avatar');
      avatarEls.forEach(function (el) { el.textContent = String(resolvedActive.name || 'U').charAt(0); });
      refreshSidebarNavDom(resolvedActive);
      var nextSafeRoute = resolveSafeRouteForUser(state.route, resolvedActive, getLayoutPrefs(resolvedActive));
      if (nextSafeRoute !== state.route) {
        state.route = nextSafeRoute;
        renderRoute().catch(function () {});
      }
    },
    getUiSimplification: getUiSimplification,
    applyUiSimplification: applyUiSimplification,
    getRoleUiDefaults: getRoleUiDefaults,
    setRoleUiDefaults: setRoleUiDefaults,
    getStatsControlConfig: getStatsControlConfig,
    setStatsControlConfig: setStatsControlConfig,
    animateProgressiveReveal: animateProgressiveReveal,
    getEffectiveRoleUiResolution: getEffectiveRoleUiResolution,
    getRealUser: getRealUser,
    getPreviewState: getPreviewState,
    startPreviewSession: startPreviewSession,
    stopPreviewSession: stopPreviewSession,
    openPreviewRoleModal: openPreviewRoleModal,
    setUnsavedGuard: setUnsavedGuard,
    clearUnsavedGuard: clearUnsavedGuard,
    requestCloseWithGuard: requestCloseWithGuard,
    getLayoutPrefs: getLayoutPrefs,
    saveLayoutPrefs: saveLayoutPrefs,
    getTimeFormat: getTimeFormat,
    getSidebarPosition: getSidebarPosition,
    getTimezoneMode: getTimezoneMode,
    getReservationsDisplayMode: getReservationsDisplayMode,
    getCalendarGranularity: getCalendarGranularity,
    setPersonalPreferences: setPersonalPreferences,
    formatTime: formatTimePref,
    formatDateTime: formatDateTimePref,
    getAnnouncements: getAnnouncements,
    setAnnouncements: setAnnouncements,
    openAnnouncementsManager: openAnnouncementsManager,
    canManageAnnouncements: canManageAnnouncements,
    getActiveLocks: getActiveLocks,
    setActiveLocks: setActiveLocks,
    getHandoverSettings: getHandoverSettings,
    setHandoverSettings: setHandoverSettings,
    downloadIcsFile: downloadIcsFile,
    openCallWrapUpBar: openCallWrapUpBar,
    updateOfflineBanner: updateOfflineBanner,
    openPwaInstallFlow: openPwaInstallFlow,
    runDeltaSync: runDeltaSync,
    checkForUpdates: checkForUpdates,
    getSyncDiagnostics: getSyncDiagnostics,
    getSyncStatusSummary: getSyncStatusSummary,
    pushSyncDiagnostic: pushSyncDiagnostic,
    openPersonalAccountSettingsModal: openPersonalAccountSettingsModal,
    openScreenOrganizerModal: openScreenOrganizerModal,
    getEmployeesState: getEmployeesState,
    setEmployeesState: setEmployeesState,
    subscribeEmployees: subscribeEmployees,
    syncEmployeesStateFromPayload: syncEmployeesStateFromPayload,
    loadEmployeesState: loadEmployeesState,
    deleteEmployeeFromState: deleteEmployeeFromState,
    toggleEmployeeStatusInState: toggleEmployeeStatusInState,
    upsertEmployeeInState: upsertEmployeeInState,
    getCallWrapupShortcutsConfig: getCallWrapupShortcutsConfig,
    setCallWrapupShortcutsConfig: setCallWrapupShortcutsConfig,
    getActiveCallWrapupShortcuts: getActiveCallWrapupShortcuts,
    mountCallShortcutsControlPanel: mountCallShortcutsControlPanel,
    openDeveloperCallShortcutsModal: openDeveloperCallShortcutsModal
  };

  document.addEventListener('rg:unauthorized', function () {
    stopAutoRefreshLoop();
    clearRouteFiltersStorage();
    resetEmployeesState();
    renderLoginScreen();
  });

  window.addEventListener('hashchange', function () {
    var curU = root.RGAuth.getUser();
    if (!curU) return;
    var hashRaw = String(window.location.hash || '');
    if (hashRaw.toLowerCase().indexOf('inactive-reservations') !== -1) hashRaw = '#reservations';
    var nextRoute = root.RGCrmCore && root.RGCrmCore.resolveRouteFromLocation
      ? root.RGCrmCore.resolveRouteFromLocation(window.location.pathname, hashRaw, window.location.search, root.__RG_BASE_URL__ || '/', VALID_ROUTES, 'dashboard')
      : 'dashboard';
    nextRoute = resolveSafeRouteForUser(nextRoute, curU, getLayoutPrefs(curU));
    if (nextRoute !== state.route) {
      requestCloseWithGuard(function () {
        state.route = nextRoute;
        renderRoute();
      });
    }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (activeUnsavedGuard && typeof activeUnsavedGuard.isDirty === 'function') {
      try {
        if (activeUnsavedGuard.isDirty()) {
          ev.preventDefault();
          ev.returnValue = '';
        }
      } catch (_e) {}
    }
  });

  function closeTopmostOverlay() {
    if (closeConfirmModal()) {
      return true;
    }
    if (root.RGCrmDatePicker && root.RGCrmDatePicker.closeActive && root.RGCrmDatePicker.closeActive()) {
      return true;
    }
    if (root.RGCrmDropdowns && root.RGCrmDropdowns.closeActive && root.RGCrmDropdowns.closeActive()) {
      return true;
    }
    if (closeProfileMenu()) {
      return true;
    }
    if (closeNotificationsPopover()) {
      return true;
    }
    if (root.RGPdfPreview && root.RGPdfPreview.isOpen && root.RGPdfPreview.isOpen()) {
      root.RGPdfPreview.close();
      return true;
    }
    var modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.firstElementChild) {
      var closeBtn = modalRoot.querySelector('#drawer-close-btn, #res-drawer-close, #emp-drawer-close, #prb-upd-close, #res-edit-cancel, #fu-edit-cancel, #prb-loading-cancel, #emp-cancel, #preset-modal-cancel, #personal-settings-close, #del-all-res-close, #perms-cat-close, #ann-mgr-close, #rg-preview-modal-close, #exp-close, #sc-mgr-close, [data-modal-close]');
      if (closeBtn && typeof closeBtn.click === 'function') {
        closeBtn.click();
      } else {
        requestCloseWithGuard(function () {
          modalRoot.innerHTML = '';
        });
      }
      return true;
    }
    var hoRoot = document.getElementById('rg-handover-root');
    if (hoRoot && hoRoot.firstElementChild) {
      var hoCloseBtn = hoRoot.querySelector('#handover-close-btn');
      if (hoCloseBtn && typeof hoCloseBtn.click === 'function') {
        hoCloseBtn.click();
      } else if (root.RGHandover && typeof root.RGHandover.closeModal === 'function') {
        root.RGHandover.closeModal();
      }
      return true;
    }
    return false;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      closeTopmostOverlay();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && String(ev.key || '').toLowerCase() === 'k') {
      var quickSearchEl = document.getElementById('topbar-quick-search');
      if (quickSearchEl) {
        ev.preventDefault();
        quickSearchEl.focus();
        quickSearchEl.select();
      }
    }
  });

  document.addEventListener('click', function (ev) {
    var telEl = ev.target && ev.target.closest ? ev.target.closest('a.rg-tel-btn') : null;
    if (telEl) {
      var callResId = telEl.getAttribute('data-call-res-id') || '';
      if (callResId) {
        openCallWrapUpBar({
          reservationId: callResId,
          reservationNumber: telEl.getAttribute('data-call-res-num') || '',
          customerName: telEl.getAttribute('data-call-customer') || '',
          phone: telEl.getAttribute('data-call-phone') || '',
          currentStatus: telEl.getAttribute('data-call-status') || ''
        });
      }
    }
    var pop = document.getElementById('notif-popover');
    var toggleBtn = document.getElementById('notif-toggle-btn');
    if (pop && !pop.contains(ev.target) && (!toggleBtn || !toggleBtn.contains(ev.target))) {
      closeNotificationsPopover();
    }
    var profMenu = document.getElementById('rg-profile-menu');
    var profBtn = document.getElementById('user-profile-menu-btn');
    if (profMenu && !profMenu.contains(ev.target) && (!profBtn || !profBtn.contains(ev.target))) {
      closeProfileMenu();
    }
    var target = ev.target;
    if (target && target.id === 'rg-unsaved-confirm-backdrop') {
      closeConfirmModal();
      return;
    }
    if (target && target.classList && (target.classList.contains('drawer-backdrop') || target.classList.contains('modal-backdrop'))) {
      if (ev.target === target) {
        closeTopmostOverlay();
      }
    }
  });

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    state.deferredInstallPrompt = ev;
  });

  document.addEventListener('DOMContentLoaded', function () {
    applyThemeAndLang();
    try {
      var justUpdatedVer = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(JUST_UPDATED_KEY) : '';
      if (justUpdatedVer) {
        sessionStorage.removeItem(JUST_UPDATED_KEY);
        pushSyncDiagnostic('update', 'info', 'اكتمل التحديث التلقائي إلى الإصدار ' + justUpdatedVer, '');
        setTimeout(function () {
          toast((state.prefs.lang === 'en') ? ('Updated automatically to version ' + justUpdatedVer) : ('تم تحديث النظام تلقائياً إلى أحدث إصدار (' + justUpdatedVer + ')'));
        }, 650);
      }
    } catch (_eBootUpd) {}
    bootAuthenticatedApp().catch(function (err) {
      toast((err && err.message) || 'تعذر تهيئة التطبيق.', true);
    });
  });
})(window);
