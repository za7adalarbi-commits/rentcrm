/**
 * RENTAL GATE CRM — Main Application Controller, Routing, i18n, Theme & Notifications
 */
(function (root) {
  'use strict';

  var PREFS_KEY = 'rg_crm_user_prefs';
  var UI_SIMP_STORAGE_KEY = 'rg_crm_ui_simplification_v1';
  var VALID_ROUTES = ['dashboard', 'reservations', 'my-followups', 'team-followups', 'problems', 'reports', 'employees', 'activity', 'settings'];

  var vendorScriptPromises = {};

  function assetUrl(rel) {
    if (root.RGCrmCore && root.RGCrmCore.resolveAssetUrl) {
      return root.RGCrmCore.resolveAssetUrl(rel, root.__RG_BASE_URL__);
    }
    return './' + String(rel || '').replace(/^\/+/, '');
  }

  function loadVendorScript(rel) {
    var url = assetUrl(rel);
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

  function resolveInitialRoute() {
    var redirected = '';
    try {
      redirected = sessionStorage.getItem('rg_crm_redirect_route') || '';
      if (redirected) sessionStorage.removeItem('rg_crm_redirect_route');
    } catch (e) {}
    if (root.RGCrmCore && root.RGCrmCore.resolveRouteFromLocation) {
      return root.RGCrmCore.resolveRouteFromLocation(
        window.location.pathname,
        window.location.hash || (redirected ? '#' + redirected : ''),
        window.location.search,
        root.__RG_BASE_URL__ || '/',
        VALID_ROUTES,
        'dashboard'
      );
    }
    return 'dashboard';
  }

  function loadInitialPrefs() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    } catch (_e) {
      saved = {};
    }
    var resolvedTheme = (saved.theme === 'dark' || saved.theme === 'light') ? saved.theme : '';
    if (!resolvedTheme) {
      try {
        resolvedTheme = (root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      } catch (_e2) {
        resolvedTheme = 'light';
      }
    }
    var normTimeFmt = (root.RGCrmCore && root.RGCrmCore.normalizeTimeFormat)
      ? root.RGCrmCore.normalizeTimeFormat(saved.timeFormat)
      : (saved.timeFormat === '12h' ? '12h' : '24h');
    var normNavPos = (root.RGCrmCore && root.RGCrmCore.normalizeSidebarPosition)
      ? root.RGCrmCore.normalizeSidebarPosition(saved.sidebarPosition)
      : ((saved.sidebarPosition === 'top' || saved.sidebarPosition === 'bottom') ? saved.sidebarPosition : 'side');
    return {
      lang: saved.lang === 'en' ? 'en' : 'ar',
      theme: resolvedTheme,
      sidebarCollapsed: Boolean(saved.sidebarCollapsed),
      timeFormat: normTimeFmt,
      sidebarPosition: normNavPos
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
    return {
      navOrder: Array.isArray(obj.navOrder) ? obj.navOrder.slice() : [],
      hiddenRoutes: Array.isArray(obj.hiddenRoutes) ? obj.hiddenRoutes.slice() : [],
      dashOrder: Array.isArray(obj.dashOrder) ? obj.dashOrder.slice() : [],
      dashHidden: Array.isArray(obj.dashHidden) ? obj.dashHidden.slice() : [],
      timeFormat: obj.timeFormat === '12h' ? '12h' : '24h',
      sidebarPosition: (obj.sidebarPosition === 'top' || obj.sidebarPosition === 'bottom') ? obj.sidebarPosition : 'side'
    };
  }

  function loadLayoutPrefs(user) {
    try {
      var key = getLayoutStorageKey(user);
      var raw = localStorage.getItem(key) || (user ? localStorage.getItem(LAYOUT_PREFS_STORAGE_KEY) : '');
      return normalizeLayoutPrefsFallback(raw ? JSON.parse(raw) : {});
    } catch (_e) {
      return normalizeLayoutPrefsFallback({});
    }
  }

  var state = {
    route: resolveInitialRoute(),
    prefs: loadInitialPrefs(),
    uiSimplification: loadUiSimplification(),
    layoutPrefs: loadLayoutPrefs(null),
    notifications: { items: [], unreadCount: 0 },
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
  var routeRenderSeq = 0;
  var activeActionLocks = {};
  var autoRefreshTimer = null;
  var autoRefreshListenersBound = false;
  var isAutoRefreshInFlight = false;
  var lastHiddenAt = 0;
  var lastFingerprints = { notifications: '', routes: {} };
  var employeeSubscribers = [];

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

  function computeFingerprintSafe(data) {
    if (root.RGCrmCore && root.RGCrmCore.computeDataFingerprint) {
      return root.RGCrmCore.computeDataFingerprint(data);
    }
    return '';
  }

  function withActionLock(btnEl, lockKey, fn) {
    var key = String(lockKey || '');
    if (key && activeActionLocks[key]) {
      return activeActionLocks[key];
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

  function getUiSimplification() {
    state.uiSimplification = normalizeUiSimpFallback(state.uiSimplification);
    return Object.assign({}, state.uiSimplification);
  }

  function applyUiSimplification(rawCfg, skipPersist) {
    var cfg = normalizeUiSimpFallback(rawCfg || state.uiSimplification);
    state.uiSimplification = cfg;
    if (!skipPersist) {
      try {
        localStorage.setItem(UI_SIMP_STORAGE_KEY, JSON.stringify(cfg));
      } catch (_e) {}
    }
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
          html.classList.toggle(item.cssClass, Boolean(cfg[item.key]));
        }
      });
    }
    return cfg;
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
    var norm = normalizeLayoutPrefsFallback(raw || loadLayoutPrefs(u));
    if (raw && typeof raw === 'object') {
      if (raw.timeFormat === '12h' || raw.timeFormat === '24h') {
        state.prefs.timeFormat = raw.timeFormat;
      }
      if (raw.sidebarPosition === 'side' || raw.sidebarPosition === 'top' || raw.sidebarPosition === 'bottom') {
        state.prefs.sidebarPosition = raw.sidebarPosition;
      }
      savePrefs();
      applyThemeAndLang();
    }
    norm.timeFormat = getTimeFormat();
    norm.sidebarPosition = getSidebarPosition();
    state.layoutPrefs = norm;
    try {
      localStorage.setItem(getLayoutStorageKey(u), JSON.stringify(norm));
    } catch (_e) {}
    return norm;
  }

  async function saveLayoutPrefs(patch, opts) {
    var o = opts || {};
    var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var cur = getLayoutPrefs(u);
    var merged = Object.assign({}, cur, patch || {});
    if (merged.timeFormat === undefined) merged.timeFormat = getTimeFormat();
    if (merged.sidebarPosition === undefined) merged.sidebarPosition = getSidebarPosition();
    var next = normalizeLayoutPrefsFallback(merged);
    state.layoutPrefs = next;
    try {
      localStorage.setItem(getLayoutStorageKey(u), JSON.stringify(next));
      localStorage.setItem(LAYOUT_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch (_e) {}

    if (o.reRenderNav !== false && u) {
      refreshSidebarNavDom(u);
    }
    if (o.persist !== false && root.RGApi && root.RGApi.callApi && u) {
      try {
        await root.RGApi.callApi('saveUserLayoutPrefs', next);
      } catch (_err) {}
    }
    return next;
  }

  async function setPersonalPreferences(patch, opts) {
    var p = patch && typeof patch === 'object' ? patch : {};
    var o = opts || {};
    var prevTime = getTimeFormat();
    var prevPos = getSidebarPosition();

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

    var nextTime = getTimeFormat();
    var nextPos = getSidebarPosition();

    savePrefs();
    applyThemeAndLang();

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
        detail: { timeFormat: nextTime, sidebarPosition: nextPos }
      }));
    } catch (_evErr) {}

    if (o.reRender !== false && prevTime !== nextTime && root.RGAuth && root.RGAuth.getUser && root.RGAuth.getUser()) {
      await renderRoute();
    }

    if (o.persist !== false) {
      await saveLayoutPrefs({ timeFormat: nextTime, sidebarPosition: nextPos }, { reRenderNav: false, persist: true });
    }
    return { timeFormat: nextTime, sidebarPosition: nextPos };
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
      getLayoutPrefs: getLayoutPrefs,
      saveLayoutPrefs: saveLayoutPrefs,
      getTimeFormat: getTimeFormat,
      getSidebarPosition: getSidebarPosition,
      setPersonalPreferences: setPersonalPreferences,
      formatTime: formatTimePref,
      formatDateTime: formatDateTimePref,
      openPersonalAccountSettingsModal: function (onUpdated) {
        openPersonalAccountSettingsModal(onUpdated);
      },
      openScreenOrganizerModal: function () {
        var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
        if (u) openScreenOrganizerModal(u);
      },
      withActionLock: withActionLock,
      onAuthChanged: bootAuthenticatedApp
    };
  }

  var I18N = {
    ar: {
      brand: 'RENTAL GATE CRM',
      nav_dashboard: 'لوحة التحكم',
      nav_reservations: 'الحجوزات',
      nav_my_followups: 'متابعاتي',
      nav_team_followups: 'متابعات الفريق',
      nav_problems: 'المشكلات',
      nav_reports: 'التقارير والإحصائيات',
      nav_employees: 'الموظفون',
      nav_activity: 'سجل النشاطات',
      nav_settings: 'الإعدادات',
      nav_group_ops: 'العمليات الرئيسية',
      nav_group_admin: 'التحليلات والإدارة',
      topbar_search_placeholder: 'بحث سريع برقم الحجز، العميل، الجوال...',
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
      search_placeholder: 'بحث برقم الحجز، العميل، الجوال، السيارة...',
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
      nav_my_followups: 'My Follow-Ups',
      nav_team_followups: 'Team Follow-Ups',
      nav_problems: 'Problems',
      nav_reports: 'Reports & Export',
      nav_employees: 'Employees',
      nav_activity: 'Activity Log',
      nav_settings: 'Settings & Sync',
      nav_group_ops: 'Core Operations',
      nav_group_admin: 'Analytics & Admin',
      topbar_search_placeholder: 'Quick search reservations, customer, phone...',
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
      search_placeholder: 'Search reservation #, customer, phone, car...',
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

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  }

  function applyThemeAndLang() {
    var html = document.documentElement;
    html.setAttribute('lang', state.prefs.lang === 'en' ? 'en' : 'ar');
    html.setAttribute('dir', state.prefs.lang === 'en' ? 'ltr' : 'rtl');
    html.setAttribute('data-theme', state.prefs.theme === 'dark' ? 'dark' : 'light');
    html.setAttribute('data-nav-pos', getSidebarPosition());
    html.setAttribute('data-time-format', getTimeFormat());
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
          duration: 580,
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

    menu.innerHTML =
      '<div class="rg-profile-menu-head">' +
        '<div class="sidebar-user-avatar" style="width:38px;height:38px;">' + String(user.name || 'U').charAt(0) + '</div>' +
        '<div style="min-width:0;flex:1;">' +
          '<div class="sidebar-user-name">' + user.name + '</div>' +
          '<div class="sidebar-user-role" style="font-size:11px;">' + (roleLabels[user.role] || user.role) + (user.username ? ' · <span class="mono" dir="ltr" style="unicode-bidi:isolate;">@' + user.username + '</span>' : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rg-profile-menu-items">' +
        '<button type="button" class="rg-menu-item" role="menuitem" id="profile-personal-settings-btn">' +
          renderIcon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z') +
          '<span>' + (isEn ? 'Personal Account Settings' : 'إعدادات الحساب الشخصي') + '</span>' +
        '</button>' +
        '<button type="button" class="rg-menu-item" role="menuitem" data-profile-route="my-followups">' +
          renderIcon('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11') +
          '<span>' + t('nav_my_followups') + '</span>' +
        '</button>' +
        '<button type="button" class="rg-menu-item" role="menuitem" data-profile-route="settings">' +
          renderIcon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z') +
          '<span>' + t('nav_settings') + '</span>' +
        '</button>' +
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
    var menuH = menu.offsetHeight || 270;
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

    menu.querySelectorAll('[data-profile-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = btn.getAttribute('data-profile-route');
        closeProfileMenu();
        var sb = document.getElementById('app-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
        state.route = r;
        renderRoute();
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
    var res = await root.RGApi.callApi('getActivityLogs', {});
    if (!res.success) {
      container.innerHTML = '<div class="form-error">' + res.message + '</div>';
      return;
    }
    var items = res.data.items || [];
    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header"><div><h2 class="section-title">' + ctx.t('nav_activity') + '</h2><p class="section-subtitle">سجل غير قابل للتعديل أو الحذف لجميع عمليات النظام.</p></div></div>' +
        (items.length === 0
          ? '<div class="empty-state">لا توجد نشاطات مسجلة.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>المستخدم</th><th>نوع العملية</th><th>العنصر المرتبط</th><th>التفاصيل</th><th>التاريخ</th><th>الوقت</th>' +
            '</tr></thead><tbody>' +
              items.map(function (l) {
                return '<tr>' +
                  '<td><strong>' + l.userName + '</strong></td>' +
                  '<td><span class="status-tag status-info">' + l.actionType + '</span></td>' +
                  '<td class="mono">' + (l.entityType ? l.entityType + ': ' + l.entityId : '-') + '</td>' +
                  '<td>' + (l.details || '-') + '</td>' +
                  '<td class="mono tabular-nums" style="white-space:nowrap;">' + (root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(l.logDate) : l.logDate) + '</td>' +
                  '<td class="mono tabular-nums" style="white-space:nowrap;">' + (ctx.formatTime ? ctx.formatTime(l.logTime) : l.logTime) + '</td>' +
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

  function renderLoginScreen() {
    var appRoot = document.getElementById('app-root');
    var connInfo = root.RGApi.getConnectionInfo ? root.RGApi.getConnectionInfo() : { url: root.RGApi.getGasUrl(), source: '', defaultUrl: '' };
    var isBackendLive = Boolean(root.RGApi.isBackendConnected && root.RGApi.isBackendConnected());
    var isLive = Boolean(isBackendLive || connInfo.url);
    cleanAutoBindQueryFromAddressBar();
    if (isLive && root.RGApi.warmUpGas) {
      root.RGApi.warmUpGas();
    }

    appRoot.innerHTML =
      '<main class="auth-screen">' +
        '<section class="auth-shell">' +
          '<div class="auth-brand-panel">' +
            '<div class="auth-brand-top">' +
              '<img src="' + assetUrl('assets/images/logo.png') + '" alt="Rental Gate Logo" class="auth-logo">' +
              '<div><h1 class="auth-brand-title">RENTAL GATE CRM</h1><p class="auth-brand-sub">نظام إدارة خدمة العملاء والحجوزات</p></div>' +
            '</div>' +
            '<p class="auth-summary">منصة متكاملة لإدارة حجوزات Rental Gate، متابعات الموظفين المتعددة، المشكلات ذات الأولوية، والتقارير الاحترافية عبر Google Sheets وGoogle Apps Script.</p>' +
            '<ul class="auth-highlights">' +
              '<li>سحب الحجوزات والتمديدات المعتمدة من Rental Gate API بأمان</li>' +
              '<li>متابعات مستقلة لكل موظف دون استبدال أو تعارض كتابة</li>' +
              '<li>إشعارات فورية للمشكلات مرتفعة الأولوية وسجل نشاطات موثق</li>' +
            '</ul>' +
          '</div>' +
          '<div class="auth-form-panel">' +
            '<div class="auth-form-header">' +
              '<div><h2>تسجيل الدخول</h2><p>أدخل بيانات حسابك الوظيفي للمتابعة</p></div>' +
              '<div class="auth-toolbar-mini">' +
                '<button type="button" class="btn btn-sm theme-toggle-btn" id="login-theme-btn" data-theme-state="' + (state.prefs.theme === 'dark' ? 'dark' : 'light') + '" aria-label="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '" title="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '">' + buildThemeToggleHtml(state.prefs.theme, true) + '</button>' +
                '<button type="button" class="btn btn-sm" id="login-lang-btn">' + t('lang_toggle') + '</button>' +
              '</div>' +
            '</div>' +
            '<form id="login-form" novalidate style="display:flex;flex-direction:column;gap:14px;">' +
              '<div class="form-group"><label class="form-label" for="login-username">اسم المستخدم</label><input class="input mono" id="login-username" dir="ltr" lang="en" autocapitalize="none" spellcheck="false" autocomplete="username" placeholder="admin" required></div>' +
              '<div class="form-group">' +
                '<label class="form-label" for="login-password">كلمة المرور</label>' +
                '<div class="password-field-wrap">' +
                  '<input class="input" type="password" id="login-password" dir="ltr" lang="en" autocomplete="current-password" placeholder="••••••••" required>' +
                  '<button type="button" class="password-toggle-btn" id="toggle-login-password" aria-label="إظهار كلمة المرور">إظهار</button>' +
                '</div>' +
              '</div>' +
              '<div id="login-error" class="form-error hidden" role="alert"></div>' +
              '<button type="submit" class="btn btn-primary" id="login-submit-btn">دخول إلى النظام</button>' +
            '</form>' +
            '<div class="auth-mode-box">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                '<div><strong>حالة الخادم:</strong> ' + (isBackendLive ? 'متصل تلقائيًا بقاعدة البيانات السحابية' : (isLive ? 'متصل تلقائيًا بـ Google Apps Script' : 'معاينة محلية (Sandbox)')) + '</div>' +
                (!isLive && connInfo.defaultUrl ? '<button type="button" class="btn btn-sm btn-primary" id="login-restore-default-gas">تفعيل الربط التلقائي للخادم</button>' : '') +
              '</div>' +
              (!isLive ? (
                '<div class="auth-demo-quick">' +
                  '<button type="button" class="btn btn-sm demo-fill-btn" data-u="admin" data-p="Admin@123">دخول كمدير (admin)</button>' +
                  '<button type="button" class="btn btn-sm demo-fill-btn" data-u="supervisor" data-p="Super@123">دخول كمشرف (supervisor)</button>' +
                  '<button type="button" class="btn btn-sm demo-fill-btn" data-u="agent1" data-p="Agent@123">دخول كموظف (agent1)</button>' +
                '</div>' +
                '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);line-height:1.6;">' +
                  'يتم ربط الخادم تلقائيًا من داخل <strong>الإعدادات</strong> (بعد دخول المدير) أو عبر <span class="mono" dir="ltr">assets/js/config.js</span> دون الحاجة لإدخاله عند تسجيل الدخول.' +
                '</div>'
              ) : (
                '<div class="glass-subcard" style="margin-top:8px;padding:10px 12px;font-size:12px;line-height:1.6;color:var(--text-secondary);">' +
                  'النظام مربوط تلقائيًا بالخادم. أدخل حسابك الوظيفي المسجل في <strong>الموظفين</strong> للدخول مباشرة.' +
                '</div>'
              )) +
            '</div>' +
          '</div>' +
        '</section>' +
      '</main>';

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
        pwdToggleBtn.textContent = nextType === 'text' ? 'إخفاء' : 'إظهار';
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
        errEl.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور.';
        errEl.classList.remove('hidden');
        if (!u) uEl.focus();
        else pEl.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري الدخول...';
      var dashRange = (state.dashboard && state.dashboard.range) || '30d';
      var res = await root.RGAuth.login(u, p, { range: dashRange });

      if (!res || !res.success) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'دخول إلى النظام';
        var rawMsg = (res && res.message) || 'تعذر تسجيل الدخول، يرجى التحقق من البيانات.';
        if (isLive && rawMsg.indexOf('اسم المستخدم أو كلمة المرور غير صحيحة') !== -1) {
          errEl.textContent = rawMsg + ' تأكد من صحة بيانات الحساب الوظيفي المسجل في صفحة الموظفين (الحساب المبدئي للتهيئة الأولى هو admin / Admin@123).';
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

    var restoreDefaultBtn = document.getElementById('login-restore-default-gas');
    if (restoreDefaultBtn) {
      restoreDefaultBtn.addEventListener('click', function () {
        root.RGApi.setGasUrl('__DEFAULT__');
        root.RGApi.setToken('');
        toast('تمت استعادة الربط التلقائي بالخادم.');
        renderLoginScreen();
      });
    }

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

  function buildLoadingSkeletonHtml(title) {
    return '<div class="surface-card rg-skeleton-card" aria-busy="true" aria-label="جاري تحميل ' + title + '">' +
      '<div class="rg-skeleton-line lg"></div>' +
      '<div class="rg-skeleton-line sm"></div>' +
      '<div class="rg-skeleton-grid">' +
        '<div class="rg-skeleton-box"></div>' +
        '<div class="rg-skeleton-box"></div>' +
        '<div class="rg-skeleton-box"></div>' +
      '</div>' +
    '</div>';
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
      case 'reservations':
        return {
          action: 'getReservations',
          payload: Object.assign({ page: 1, pageSize: 20 }, state.reservations || {})
        };
      case 'my-followups':
        return { action: 'getMyFollowUps', payload: {} };
      case 'team-followups':
        return { action: 'getTeamFollowUps', payload: {} };
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
            dateFrom: rf ? rf.value : '',
            dateTo: rt ? rt.value : '',
            employeeId: re ? re.value : '',
            company: rc ? rc.value : '',
            branch: rb ? rb.value : '',
            logExport: false
          }
        };
      }
      case 'employees':
        if (u && root.RGCrmCore && root.RGCrmCore.canUserPerform(u, 'view_employees')) {
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
    } else if (primReq && root.RGApi && root.RGApi.hasCached) {
      isInstantlyReady = Boolean(root.RGApi.hasCached(primReq.action, primReq.payload));
    }

    var skeletonTimer = isInstantlyReady ? null : setTimeout(function () {
      if (seq === routeRenderSeq && slot.parentNode === container && slot.childElementCount === 0) {
        slot.innerHTML = buildLoadingSkeletonHtml(routeTitle);
      }
    }, 85);

    var ctx = buildAppCtx();

    try {
      await renderActiveRouteView(slot, ctx, { silent: false });
    } catch (err) {
      slot.innerHTML = '<div class="form-error">' + ((err && err.message) || 'حدث خطأ أثناء عرض الصفحة.') + '</div>';
    } finally {
      if (skeletonTimer) clearTimeout(skeletonTimer);
    }
  }

  function isNavRouteAllowedForUser(item, user) {
    if (!item || !user) return false;
    if (item.id === 'dashboard' && !root.RGCrmCore.canUserPerform(user, 'view_dashboard')) {
      return false;
    }
    if (item.id === 'employees' && !root.RGCrmCore.canUserPerform(user, 'view_employees') && user.role !== root.RGCrmCore.ROLES.GENERAL_MANAGER) {
      return false;
    }
    if (item.id === 'settings') {
      return true;
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
        state.route = targetRoute;
        renderRoute();
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

    function formatLiveSample(fmt) {
      var now = new Date();
      var riyadh = new Date(now.getTime() + 3 * 3600000);
      var hhmm = riyadh.toISOString().substring(11, 16);
      if (root.RGCrmCore && root.RGCrmCore.formatTimePreference) {
        return root.RGCrmCore.formatTimePreference(hhmm, fmt, state.prefs.lang);
      }
      return hhmm;
    }

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="personal-settings-modal" role="dialog" aria-modal="true" aria-labelledby="personal-settings-title">' +
        '<div class="modal-panel rg-personal-modal" style="max-width:600px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="personal-settings-title">' + (isEn ? 'Personal Account Settings' : 'إعدادات الحساب الشخصي') + '</h3>' +
              '<p class="section-subtitle">' + (isEn
                ? ('Customize how time and navigation appear for your account' + (user && user.name ? (' (' + user.name + ')') : '') + '. Applies instantly.')
                : ('خصص طريقة عرض الوقت وموضع شريط التنقل لحسابك' + (user && user.name ? (' (' + user.name + ')') : '') + ' مع تطبيق فوري.')) + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="personal-settings-close" data-modal-close aria-label="' + (isEn ? 'Close' : 'إغلاق') + '">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
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
    function syncModalSelections() {
      var tf = getTimeFormat();
      var np = getSidebarPosition();
      if (previewEl) previewEl.textContent = formatLiveSample(tf);
      modalRoot.querySelectorAll('[data-time-choice]').forEach(function (btn) {
        var active = btn.getAttribute('data-time-choice') === tf;
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
        if (typeof onUpdated === 'function') onUpdated({ timeFormat: getTimeFormat(), sidebarPosition: getSidebarPosition() });
      });
      syncModalSelections();
    }

    modalRoot.querySelectorAll('[data-time-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyInstantPref({ timeFormat: btn.getAttribute('data-time-choice') });
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
        applyInstantPref({ timeFormat: '24h', sidebarPosition: 'side' });
        toast(isEn ? 'Personal preferences reset to defaults.' : 'تمت استعادة الإعدادات الشخصية للافتراضي.');
      });
    }

    function closeAndAcknowledge() {
      Promise.resolve(pendingSavePromise).finally(function () {
        modalRoot.innerHTML = '';
        toast(isEn ? 'Personal account preferences saved.' : 'تم حفظ إعدادات الحساب الشخصي.');
      });
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

  function renderAppShell(user) {
    var appRoot = document.getElementById('app-root');
    var roleLabels = root.RGCrmCore.ROLE_LABELS[state.prefs.lang] || root.RGCrmCore.ROLE_LABELS.ar;
    var collapsedClass = state.prefs.sidebarCollapsed ? ' collapsed' : '';

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
            '<button type="button" class="sidebar-collapse-btn" id="sidebar-collapse-btn" aria-label="طي القائمة" title="طي / توسيع القائمة">' +
              renderIcon('M4 6h16M4 12h16M4 18h16') +
            '</button>' +
          '</div>' +
          '<nav class="sidebar-nav">' +
            buildSidebarNavInnerHtml(user) +
          '</nav>' +
          '<div class="sidebar-footer">' +
            '<button type="button" class="sidebar-footer-card" id="user-profile-menu-btn" aria-haspopup="menu" aria-expanded="false" title="' + user.name + '">' +
              '<div class="sidebar-user-avatar">' + String(user.name || 'U').charAt(0) + '</div>' +
              '<div class="sidebar-user-meta">' +
                '<div class="sidebar-user-name">' + user.name + '</div>' +
                '<div class="sidebar-user-role">' + (roleLabels[user.role] || user.role) + '</div>' +
              '</div>' +
              '<span class="sidebar-user-chevron" aria-hidden="true">' + renderIcon('M6 9l6 6 6-6') + '</span>' +
            '</button>' +
          '</div>' +
        '</aside>' +
        '<div class="main-column">' +
          '<header class="topbar">' +
            '<div class="topbar-start">' +
              '<button type="button" class="btn btn-icon mobile-menu-btn" id="mobile-menu-btn" aria-label="فتح القائمة">' + renderIcon('M4 6h16M4 12h16M4 18h16') + '</button>' +
              '<h1 class="page-heading" id="page-heading">' + t('nav_dashboard') + '</h1>' +
              '<form class="topbar-search-form" id="topbar-search-form" role="search">' +
                '<span class="topbar-search-icon" aria-hidden="true">' + renderIcon('M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z') + '</span>' +
                '<input type="search" class="topbar-search-input" id="topbar-quick-search" placeholder="' + t('topbar_search_placeholder') + '" aria-label="' + t('topbar_search_placeholder') + '">' +
                '<span class="topbar-search-kbd" aria-hidden="true">Ctrl+K</span>' +
              '</form>' +
            '</div>' +
            '<div class="topbar-actions">' +
              '<button type="button" class="btn btn-icon" id="refresh-view-btn" aria-label="' + t('refresh') + '" title="' + t('refresh') + '">' +
                renderIcon('M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15') +
              '</button>' +
              '<button type="button" class="btn btn-icon" id="notif-toggle-btn" aria-label="الإشعارات" aria-haspopup="dialog" aria-expanded="false">' +
                renderIcon('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0') +
                '<span class="notif-count hidden" id="notif-badge">0</span>' +
              '</button>' +
              '<button type="button" class="btn btn-sm theme-toggle-btn" id="theme-toggle-btn" data-theme-state="' + (state.prefs.theme === 'dark' ? 'dark' : 'light') + '" aria-label="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '" title="' + (state.prefs.theme === 'dark' ? t('theme_light') : t('theme_dark')) + '">' +
                buildThemeToggleHtml(state.prefs.theme, false) +
              '</button>' +
              '<button type="button" class="btn btn-sm" id="lang-toggle-btn">' + t('lang_toggle') + '</button>' +
              '<button type="button" class="btn btn-sm btn-danger" id="logout-btn">' +
                '<span class="topbar-mobile-only">' + (state.prefs.lang === 'en' ? 'Exit' : 'خروج') + '</span>' +
                '<span class="topbar-desktop-only">' + t('logout') + '</span>' +
              '</button>' +
            '</div>' +
          '</header>' +
          '<main class="page-content" id="page-content"></main>' +
        '</div>' +
      '</div>';

    var quickSearchForm = document.getElementById('topbar-search-form');
    var quickSearchInput = document.getElementById('topbar-quick-search');
    if (quickSearchForm && quickSearchInput) {
      quickSearchForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var q = String(quickSearchInput.value || '').trim();
        state.reservations = Object.assign({}, state.reservations || {}, { search: q, page: 1 });
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
      renderAppShell(user);
      renderRoute();
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      closeProfileMenu();
      closeNotificationsPopover();
      stopAutoRefreshLoop();
      state.route = 'dashboard';
      delete state.reservations;
      delete state.reports;
      delete state.problems;
      delete state.followups;
      state.notifications = { items: [], unreadCount: 0 };
      resetEmployeesState();
      await root.RGAuth.logout();
      renderLoginScreen();
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
          if (slot) {
            await renderActiveRouteView(slot, buildAppCtx(), { silent: false });
          } else {
            await renderRoute();
          }
        }
      } else if (options.manual) {
        await renderRoute();
      }
    } finally {
      isAutoRefreshInFlight = false;
    }
  }

  function stopAutoRefreshLoop() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function scheduleRefreshInterval() {
    stopAutoRefreshLoop();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    autoRefreshTimer = setInterval(function () {
      refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
    }, 60000);
  }

  function startAutoRefreshLoop() {
    scheduleRefreshInterval();

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
          if (lastHiddenAt && (Date.now() - lastHiddenAt >= 30000)) {
            lastHiddenAt = 0;
            refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
          }
        }
      });
      window.addEventListener('online', function () {
        scheduleRefreshInterval();
        refreshCurrentRouteAndNotifications({ manual: false }).catch(function () {});
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
        payload = { page: 1, pageSize: 20 };
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

  async function bootAuthenticatedApp() {
    if (root.RGApi && root.RGApi.ready) {
      await root.RGApi.ready();
    }
    var dashRange = (state.dashboard && state.dashboard.range) || '30d';
    var consumed = root.RGAuth.consumeBootstrap ? root.RGAuth.consumeBootstrap() : null;
    var user = root.RGAuth.getUser ? root.RGAuth.getUser() : null;

    if (user && consumed && consumed.data) {
      if (root.RGAuth.primeBootstrapCaches) {
        root.RGAuth.primeBootstrapCaches(consumed.data, consumed.range || dashRange);
      }
      if (consumed.data.uiSimplification) {
        applyUiSimplification(consumed.data.uiSimplification);
      }
      hydrateLayoutPrefsFromServer(consumed.data.layoutPrefs, user);
      if (consumed.data.employees) syncEmployeesStateFromPayload(consumed.data.employees);
      renderAppShell(user);
      if (consumed.data.notifications) applyNotificationsState(consumed.data.notifications);
      await renderRoute();
      startAutoRefreshLoop();
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
        if (bootRes.data.uiSimplification) {
          applyUiSimplification(bootRes.data.uiSimplification);
        }
        hydrateLayoutPrefsFromServer(bootRes.data.layoutPrefs, user);
        if (bootRes.data.employees) syncEmployeesStateFromPayload(bootRes.data.employees);
        renderAppShell(user);
        if (bootRes.data.notifications) applyNotificationsState(bootRes.data.notifications);
        await renderRoute();
        startAutoRefreshLoop();
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

    hydrateLayoutPrefsFromServer(null, user);
    renderAppShell(user);
    await Promise.all([
      renderRoute(),
      refreshNotifications()
    ]);
    startAutoRefreshLoop();
  }

  root.RGApp = {
    withActionLock: withActionLock,
    applyNotificationsState: applyNotificationsState,
    refreshNotifications: refreshNotifications,
    getUiSimplification: getUiSimplification,
    applyUiSimplification: applyUiSimplification,
    getLayoutPrefs: getLayoutPrefs,
    saveLayoutPrefs: saveLayoutPrefs,
    getTimeFormat: getTimeFormat,
    getSidebarPosition: getSidebarPosition,
    setPersonalPreferences: setPersonalPreferences,
    formatTime: formatTimePref,
    formatDateTime: formatDateTimePref,
    openPersonalAccountSettingsModal: openPersonalAccountSettingsModal,
    openScreenOrganizerModal: openScreenOrganizerModal,
    getEmployeesState: getEmployeesState,
    setEmployeesState: setEmployeesState,
    subscribeEmployees: subscribeEmployees,
    syncEmployeesStateFromPayload: syncEmployeesStateFromPayload,
    loadEmployeesState: loadEmployeesState,
    deleteEmployeeFromState: deleteEmployeeFromState,
    toggleEmployeeStatusInState: toggleEmployeeStatusInState,
    upsertEmployeeInState: upsertEmployeeInState
  };

  document.addEventListener('rg:unauthorized', function () {
    stopAutoRefreshLoop();
    resetEmployeesState();
    renderLoginScreen();
  });

  window.addEventListener('hashchange', function () {
    var curU = root.RGAuth.getUser();
    if (!curU) return;
    var nextRoute = root.RGCrmCore && root.RGCrmCore.resolveRouteFromLocation
      ? root.RGCrmCore.resolveRouteFromLocation(window.location.pathname, window.location.hash, window.location.search, root.__RG_BASE_URL__ || '/', VALID_ROUTES, 'dashboard')
      : 'dashboard';
    nextRoute = resolveSafeRouteForUser(nextRoute, curU, getLayoutPrefs(curU));
    if (nextRoute !== state.route) {
      state.route = nextRoute;
      renderRoute();
    }
  });

  function closeTopmostOverlay() {
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
      var closeBtn = modalRoot.querySelector('#drawer-close-btn, #res-drawer-close, #emp-drawer-close, #prb-upd-close, #res-edit-cancel, #fu-edit-cancel, #prb-loading-cancel, #emp-cancel, #exp-close, [data-modal-close]');
      if (closeBtn && typeof closeBtn.click === 'function') {
        closeBtn.click();
      } else {
        modalRoot.innerHTML = '';
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
    if (target && target.classList && (target.classList.contains('drawer-backdrop') || target.classList.contains('modal-backdrop'))) {
      if (ev.target === target) {
        closeTopmostOverlay();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    applyThemeAndLang();
    bootAuthenticatedApp().catch(function (err) {
      toast((err && err.message) || 'تعذر تهيئة التطبيق.', true);
    });
  });
})(window);
