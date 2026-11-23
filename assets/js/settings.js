/**
 * RENTAL GATE CRM — Unified Mode, Core Code Binding, GAS /exec Connection & Rental Gate API Sync Center
 */
(function (root) {
  'use strict';

  function runWithLock(btnEl, lockKey, fn) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn);
    }
    return Promise.resolve().then(fn);
  }

  function escapeHtml(val) {
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function bindPasswordToggle(inputId, btnId) {
    var inp = document.getElementById(inputId);
    var btn = document.getElementById(btnId);
    if (!inp || !btn) return;
    btn.addEventListener('click', function () {
      var nextType = inp.type === 'password' ? 'text' : 'password';
      inp.type = nextType;
      btn.textContent = nextType === 'text' ? 'إخفاء' : 'إظهار';
    });
  }

  function formatPersonalSummaryLabels(tf, np, lang, tzMode) {
    var isEn = lang === 'en';
    var timeTxt = tf === '12h'
      ? (isEn ? '12-Hour (AM/PM)' : 'نظام 12 ساعة (ص / م)')
      : (isEn ? '24-Hour Clock' : 'نظام 24 ساعة');
    var posTxt = np === 'top'
      ? (isEn ? 'Top Bar (Icons Only)' : 'في الأعلى (أيقونات فقط)')
      : (np === 'bottom'
          ? (isEn ? 'Bottom Dock (Icons Only)' : 'في الأسفل (أيقونات فقط)')
          : (isEn ? 'Side Bar' : 'على الجانب'));
    var tzTxt = tzMode === 'sa'
      ? (isEn ? 'Original Saudi Time Only' : 'التوقيت الأصلي السعودي فقط')
      : (tzMode === 'eg'
          ? (isEn ? 'Egypt Time Only' : 'التوقيت المصري فقط')
          : (isEn ? 'Both (Saudi Orig. + Egypt)' : 'كلاهما معاً (السعودي + المصري)'));
    return { timeTxt: timeTxt, posTxt: posTxt, tzTxt: tzTxt };
  }

  function formatSettingDateTime(val, ctx) {
    if (!val) return '-';
    if (ctx && typeof ctx.formatDateTime === 'function') {
      return ctx.formatDateTime(val) || '-';
    }
    if (root.RGCrmCore && root.RGCrmCore.formatDateTimePreference) {
      var tf = (root.RGApp && root.RGApp.getTimeFormat) ? root.RGApp.getTimeFormat() : '24h';
      return root.RGCrmCore.formatDateTimePreference(val, tf, (ctx && ctx.lang) || 'ar') || '-';
    }
    return String(val).replace('T', ' ').substring(0, 16);
  }

  function buildPersonalAccountCardHtml(user, ctx) {
    var isEn = ctx && ctx.lang === 'en';
    var tf = (ctx && ctx.getTimeFormat) ? ctx.getTimeFormat() : ((root.RGApp && root.RGApp.getTimeFormat) ? root.RGApp.getTimeFormat() : '24h');
    var np = (ctx && ctx.getSidebarPosition) ? ctx.getSidebarPosition() : ((root.RGApp && root.RGApp.getSidebarPosition) ? root.RGApp.getSidebarPosition() : 'side');
    var tz = (ctx && ctx.getTimezoneMode) ? ctx.getTimezoneMode() : ((root.RGApp && root.RGApp.getTimezoneMode) ? root.RGApp.getTimezoneMode() : 'both');
    var labels = formatPersonalSummaryLabels(tf, np, ctx && ctx.lang, tz);
    var userName = (user && user.name) ? user.name : '';
    return '<div class="surface-card rg-personal-entry-card" id="personal-settings-card">' +
      '<div class="section-header" style="margin-bottom:12px;">' +
        '<div>' +
          '<h2 class="section-title">' + (isEn ? 'Personal Account Settings' : 'الحساب الشخصي وتفضيلات العرض') + '</h2>' +
          '<p class="section-subtitle">' + (isEn
            ? ('Control your preferred 12h/24h time format, Saudi/Egypt booking timezone, and navigation bar' + (userName ? (' — ' + escapeHtml(userName)) : '') + '.')
            : ('تحكم في طريقة عرض الوقت (12 أو 24 ساعة) وتوقيت مواعيد الحجوزات وموضع الشريط' + (userName ? (' — ' + escapeHtml(userName)) : '') + '.')) + '</p>' +
        '</div>' +
        '<div class="toolbar-row" style="margin-bottom:0;">' +
          '<button type="button" class="btn btn-primary" id="btn-open-personal-settings">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>' +
            '<span>' + (isEn ? 'Personal Account Settings' : 'إعدادات الحساب الشخصي') + '</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="rg-personal-summary-chips">' +
        '<div class="rg-personal-chip">' +
          '<span class="rg-personal-chip-k">' + (isEn ? 'Time Display' : 'نظام عرض الوقت') + '</span>' +
          '<strong class="rg-personal-chip-v" id="personal-summary-time">' + escapeHtml(labels.timeTxt) + '</strong>' +
        '</div>' +
        '<div class="rg-personal-chip">' +
          '<span class="rg-personal-chip-k">' + (isEn ? 'Booking Timezone' : 'توقيت مواعيد الحجوزات') + '</span>' +
          '<strong class="rg-personal-chip-v" id="personal-summary-tz">' + escapeHtml(labels.tzTxt) + '</strong>' +
        '</div>' +
        '<div class="rg-personal-chip">' +
          '<span class="rg-personal-chip-k">' + (isEn ? 'Navigation Bar' : 'موضع الشريط الجانبي') + '</span>' +
          '<strong class="rg-personal-chip-v" id="personal-summary-pos">' + escapeHtml(labels.posTxt) + '</strong>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bindPersonalAccountCard(container, ctx) {
    var btn = document.getElementById('btn-open-personal-settings');
    if (btn) {
      btn.addEventListener('click', function () {
        if (ctx && typeof ctx.openPersonalAccountSettingsModal === 'function') {
          ctx.openPersonalAccountSettingsModal();
        } else if (root.RGApp && typeof root.RGApp.openPersonalAccountSettingsModal === 'function') {
          root.RGApp.openPersonalAccountSettingsModal();
        }
      });
    }
    if (container && !container._rgSettingsPrefsBound) {
      container._rgSettingsPrefsBound = true;
      var onPersonalChange = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:personalprefschange', onPersonalChange);
          container._rgSettingsPrefsBound = false;
          return;
        }
        var det = (ev && ev.detail) || {};
        var tf = det.timeFormat || ((ctx && ctx.getTimeFormat) ? ctx.getTimeFormat() : '24h');
        var np = det.sidebarPosition || ((ctx && ctx.getSidebarPosition) ? ctx.getSidebarPosition() : 'side');
        var tz = det.timezoneMode || ((ctx && ctx.getTimezoneMode) ? ctx.getTimezoneMode() : 'both');
        var labels = formatPersonalSummaryLabels(tf, np, ctx && ctx.lang, tz);
        var timeEl = document.getElementById('personal-summary-time');
        var tzEl = document.getElementById('personal-summary-tz');
        var posEl = document.getElementById('personal-summary-pos');
        if (timeEl) timeEl.textContent = labels.timeTxt;
        if (tzEl) tzEl.textContent = labels.tzTxt;
        if (posEl) posEl.textContent = labels.posTxt;
      };
      document.addEventListener('rg:personalprefschange', onPersonalChange);
    }
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var user = root.RGAuth.getUser();
    var canAccessApi = root.RGCrmCore.canAccessApi(user);
    var canSync = root.RGCrmCore.canUserPerform(user, 'sync_data');
    var canManageSettings = root.RGCrmCore.canUserPerform(user, 'manage_settings');
    var canManageRoleUiDefaults = root.RGCrmCore.canUserPerform(user, 'manage_role_ui_defaults') || canManageSettings;
    var cachedEmpData = root.RGApi.getCachedData ? root.RGApi.getCachedData('getEmployees', {}, true) : null;
    var personalCardHtml = buildPersonalAccountCardHtml(user, ctx);

    if (!canAccessApi && !canManageSettings && !canManageRoleUiDefaults) {
      container.innerHTML =
        personalCardHtml +
        '<div class="surface-card">' +
          '<h2 class="section-title">إعدادات النظام وفحص الاتصال</h2>' +
          '<p class="section-subtitle">إعدادات النظام واختبارات الاتصال والمزامنة مخصصة للمبرمج والمدير العام والمشرف فقط، بينما تبقى إعدادات الحساب الشخصي متاحة لك أعلاه.</p>' +
        '</div>';
      bindPersonalAccountCard(container, ctx);
      return;
    }

    var [settingsRes, syncRes, capsRes, empPresetsRes] = await Promise.all([
      root.RGApi.callApi('getSettings', { abortKey: 'set:main' }),
      canSync ? root.RGApi.callApi('getSyncStatus', { abortKey: 'set:sync' }) : Promise.resolve({ success: true, data: { logs: [], lastSync: null } }),
      root.RGApi.getSetupCapabilities ? root.RGApi.getSetupCapabilities().catch(function () { return { success: false }; }) : Promise.resolve({ success: false }),
      cachedEmpData
        ? Promise.resolve({ success: true, data: cachedEmpData })
        : ((canManageSettings || canManageRoleUiDefaults)
            ? root.RGApi.callApi('getEmployees', { silentRefresh: true }).catch(function () { return { success: false }; })
            : Promise.resolve({ success: false }))
    ]);
    if (settingsRes && settingsRes.aborted) return;

    if (!settingsRes || !settingsRes.success) {
      container.innerHTML =
        personalCardHtml +
        '<div class="surface-card">' +
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">تعذر تحميل إعدادات النظام</div>' +
              '<div class="rg-error-banner-msg">' + escapeHtml((settingsRes && settingsRes.message) || 'تعذر تحميل إعدادات الخادم.') + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="set-retry-btn">إعادة المحاولة</button>' +
          '</div>' +
        '</div>';
      bindPersonalAccountCard(container, ctx);
      var setRetryBtn = document.getElementById('set-retry-btn');
      if (setRetryBtn) setRetryBtn.addEventListener('click', function () { render(container, ctx); });
      return;
    }

    var settings = (settingsRes.success && settingsRes.data) || {};
    var syncData = (syncRes && syncRes.success && syncRes.data) || { logs: [], lastSync: null };
    var caps = (capsRes && capsRes.success && capsRes.data) ? capsRes.data : {};
    var lastSync = syncData.lastSync;

    var autoSyncEnabled = settings.auto_sync_enabled !== undefined ? Boolean(settings.auto_sync_enabled) : (syncData.autoSyncEnabled !== false);
    var rawSyncHours = settings.auto_sync_interval_hours !== undefined ? settings.auto_sync_interval_hours : syncData.autoSyncIntervalHours;
    var rawSyncMinutes = settings.auto_sync_interval_minutes !== undefined ? settings.auto_sync_interval_minutes : syncData.autoSyncIntervalMinutes;
    var autoSyncInterval = (root.RGCrmCore && root.RGCrmCore.normalizeAutoSyncInterval)
      ? root.RGCrmCore.normalizeAutoSyncInterval(rawSyncHours, rawSyncMinutes)
      : { hours: Number(rawSyncHours !== undefined ? rawSyncHours : 12), minutes: Number(rawSyncMinutes || 0), totalMinutes: 720 };
    var autoSyncHours = autoSyncInterval.hours;
    var autoSyncMinutes = autoSyncInterval.minutes;
    var formatIntervalAr = function (h, m) {
      if (root.RGCrmCore && root.RGCrmCore.formatAutoSyncIntervalAr) {
        return root.RGCrmCore.formatAutoSyncIntervalAr(h, m);
      }
      return 'كل ' + h + ' ساعة' + (m > 0 ? (' و' + m + ' دقيقة') : '');
    };
    var autoSyncBadgeText = autoSyncEnabled ? ('مفعل — ' + formatIntervalAr(autoSyncHours, autoSyncMinutes)) : 'متوقف حاليًا';

    var isBackendConnected = Boolean(root.RGApi.isBackendConnected && root.RGApi.isBackendConnected());
    var connInfo = root.RGApi.getConnectionInfo ? root.RGApi.getConnectionInfo() : { url: root.RGApi.getGasUrl(), source: '', defaultUrl: '' };
    var currentGasUrl = (isBackendConnected && settings.gas_webapp_url !== undefined)
      ? (settings.gas_webapp_url || '')
      : (caps.gasWebAppUrl || connInfo.url || '');

    var activeMode = String(
      settings.connection_mode ||
      caps.mode ||
      (root.RGApi.getActiveMode && root.RGApi.getActiveMode()) ||
      (isBackendConnected ? 'neon' : (root.RGApi.isLiveMode() ? 'gas' : 'sandbox'))
    ).trim().toLowerCase();
    if (activeMode !== 'neon' && activeMode !== 'gas' && activeMode !== 'sandbox') {
      activeMode = isBackendConnected ? 'neon' : (root.RGApi.isLiveMode() ? 'gas' : 'sandbox');
    }

    var hasDatabaseUrl = Boolean(settings.hasDatabaseUrl || caps.hasDatabaseUrl);
    var maskedDbUrl = String(settings.maskedDatabaseUrl || caps.maskedDatabaseUrl || '').trim();
    var hasRgToken = Boolean(settings.hasDirectToken || settings.hasRgToken || caps.hasRgToken);
    var hasGasUrl = Boolean(currentGasUrl || caps.hasEnvGasUrl);
    var isVercelServerless = Boolean(caps.isServerless);
    var isVercelProxyAlive = Boolean(isVercelServerless || (root.RGApi && root.RGApi.isVercelProxyAvailable && root.RGApi.isVercelProxyAvailable()));
    var hasEnvGasUrl = Boolean(caps.hasEnvGasUrl);

    var connModeSubtitle = isBackendConnected
      ? ('الوضع الحالي: <strong>متصل بقاعدة البيانات السحابية (Neon PostgreSQL)</strong> · وسيط الخادم: <strong>' + (isVercelProxyAlive ? 'مفعّل (/api/crm)' : 'استضافة محلية') + '</strong>')
      : ('الوضع الحالي: <strong>' + (root.RGApi.isLiveMode() ? 'متصل بـ Google Apps Script (/exec)' : 'وضع المعاينة المحلية (Sandbox)') + '</strong>');

    var isGeneralManager = Boolean(
      user && root.RGCrmCore && (
        (typeof root.RGCrmCore.isPrivilegedRole === 'function' && root.RGCrmCore.isPrivilegedRole(user)) ||
        (root.RGCrmCore.ROLES && (user.role === root.RGCrmCore.ROLES.GENERAL_MANAGER || user.role === root.RGCrmCore.ROLES.DEVELOPER))
      )
    );
    var isDeveloperUser = Boolean(user && root.RGCrmCore && root.RGCrmCore.ROLES && user.role === root.RGCrmCore.ROLES.DEVELOPER);
    var pullPresets = (root.RGCrmCore && root.RGCrmCore.PULL_DURATION_PRESETS) || [];
    var cacheStats = (root.RGApi && root.RGApi.getLocalCacheStats) ? root.RGApi.getLocalCacheStats() : { reservationsCount: 0, customersCount: 0, detailsCount: 0 };
    var uiPresetsMap = (root.RGCrmCore && root.RGCrmCore.TEAM_UI_PRESETS) || {};
    var uiGroupsList = (root.RGCrmCore && Array.isArray(root.RGCrmCore.UI_SIMPLIFICATION_GROUPS))
      ? root.RGCrmCore.UI_SIMPLIFICATION_GROUPS
      : [];
    var uiOptionsList = (root.RGCrmCore && Array.isArray(root.RGCrmCore.UI_SIMPLIFICATION_OPTIONS))
      ? root.RGCrmCore.UI_SIMPLIFICATION_OPTIONS
      : [
          { key: 'hideSecondaryCarMeta', legacyId: 'set-ui-hide-car-meta', group: 'drawer', labelAr: 'إخفاء فئة السيارة وتفاصيل الاستلام/التسليم الثانوية' },
          { key: 'hideCustomerContactExtras', legacyId: 'set-ui-hide-customer-extra', group: 'drawer', labelAr: 'إخفاء البريد الإلكتروني ورقم الهوية من رأس الحجز' },
          { key: 'hideFinancialBreakdown', legacyId: 'set-ui-hide-finance', group: 'drawer', labelAr: 'إخفاء التفصيل المالي اليومي والضريبة والخصم' },
          { key: 'hideDrawerCharts', legacyId: 'set-ui-hide-drawer-charts', group: 'drawer', labelAr: 'إخفاء الرسوم البيانية داخل تفاصيل الحجز' },
          { key: 'hideDashboardRadar', legacyId: 'set-ui-hide-dash-radar', group: 'dashboard', labelAr: 'إخفاء رادار 24 ساعة في لوحة التحكم' },
          { key: 'hideDashboardHeatmap', legacyId: 'set-ui-hide-dash-heatmap', group: 'dashboard', labelAr: 'إخفاء مصفوفة ساعات الذروة من لوحة التحكم والتقارير' }
        ];
    var uiSimp = (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings)
      ? root.RGCrmCore.normalizeUiSimplificationSettings(settings.ui_simplification)
      : { preset: 'full', hideSecondaryCarMeta: false, hideCustomerContactExtras: false, hideFinancialBreakdown: false, hideDrawerCharts: false, hideDashboardRadar: false, hideDashboardHeatmap: false };
    var initialHiddenCount = uiOptionsList.filter(function (opt) { return Boolean(uiSimp[opt.key]); }).length;

    var roleUiDefaultsDraft = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
      ? root.RGCrmCore.normalizeRoleUiDefaults(
          settings.role_ui_defaults ||
          (ctx && ctx.getRoleUiDefaults && ctx.getRoleUiDefaults()) ||
          (root.RGApp && root.RGApp.getRoleUiDefaults && root.RGApp.getRoleUiDefaults()) ||
          {}
        )
      : {};
    var activeRoleDefaultTab = 'agent';
    var ROLE_UI_COLS = [
      { key: 'reservationNumber', label: 'رقم الحجز' },
      { key: 'customerName', label: 'اسم العميل' },
      { key: 'customerPhone', label: 'الجوال' },
      { key: 'companyName', label: 'الشركة' },
      { key: 'branchName', label: 'الفرع' },
      { key: 'carName', label: 'السيارة' },
      { key: 'startDate', label: 'بداية الحجز' },
      { key: 'endDate', label: 'نهاية الحجز' },
      { key: 'daysCount', label: 'الأيام' },
      { key: 'extensionsCount', label: 'عدد التمديدات' },
      { key: 'extendedUntilDate', label: 'التمديد لحد' },
      { key: 'extensionsAmount', label: 'سعر التمديد' },
      { key: 'totalAmount', label: 'الإجمالي' },
      { key: 'originalStatusAr', label: 'الحالة الأصلية' },
      { key: 'internalStatus', label: 'المتابعة الداخلية' },
      { key: 'assignedEmployeeNames', label: 'الموظفون المسؤولون' },
      { key: 'priority', label: 'الأولوية' },
      { key: 'lastUpdateText', label: 'آخر تحديث' },
      { key: 'lastUpdatedByName', label: 'آخر موظف' },
      { key: 'lastUpdatedAt', label: 'التاريخ والوقت' }
    ];
    var ROLE_TABS_META = [
      { key: 'agent', label: 'موظف خدمة العملاء' },
      { key: 'supervisor', label: 'المشرف' },
      { key: 'general_manager', label: 'المدير العام' },
      { key: 'developer', label: 'المبرمج' }
    ];
    var rolePresetsList = (root.RGCrmCore && root.RGCrmCore.normalizeRolePresets)
      ? root.RGCrmCore.normalizeRolePresets(empPresetsRes && empPresetsRes.success && empPresetsRes.data ? empPresetsRes.data.rolePresets : null)
      : [];
    var realSetActor = (root.RGApp && root.RGApp.getPreviewState) ? root.RGApp.getPreviewState().realUser : user;
    var canPreviewSettings = Boolean(realSetActor && root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realSetActor));
    var allowedPreviewRolesSettings = (root.RGCrmCore && root.RGCrmCore.getAllowedPreviewRoles)
      ? root.RGCrmCore.getAllowedPreviewRoles(realSetActor)
      : [];

    var hoPresets = (root.RGCrmCore && root.RGCrmCore.SHIFT_HANDOVER_PRESETS) || [
      { key: '8h', labelAr: 'آخر 8 ساعات', labelEn: 'Last 8 Hours' },
      { key: '12h', labelAr: 'آخر 12 ساعة', labelEn: 'Last 12 Hours' },
      { key: 'today', labelAr: 'وردية اليوم', labelEn: "Today's Shift" },
      { key: 'yesterday', labelAr: 'وردية الأمس', labelEn: "Yesterday's Shift" },
      { key: 'custom', labelAr: 'نطاق مخصص', labelEn: 'Custom Range' }
    ];
    var hoSettings = (root.RGCrmCore && root.RGCrmCore.normalizeHandoverSettings)
      ? root.RGCrmCore.normalizeHandoverSettings(settings.handover_settings)
      : {
          defaultPreset: '8h',
          defaultTimeFrom: '',
          defaultTimeTo: '',
          includeTodayMovements: true,
          includePending: true,
          includeClosed: true,
          includeOpenProblems: true,
          includeExpiring24h: true,
          autoIncludeNotes: true
        };
    var canOpenAnnouncements = (ctx && typeof ctx.canManageAnnouncements === 'function' && ctx.canManageAnnouncements()) ||
      (root.RGApp && typeof root.RGApp.canManageAnnouncements === 'function' && root.RGApp.canManageAnnouncements()) ||
      canAccessApi || canManageSettings;

    container.innerHTML =
      personalCardHtml +
      (isDeveloperUser ? (
        '<div class="surface-card rg-dev-badge-card" style="border-top:3px solid var(--brand-primary);margin-bottom:16px;">' +
          '<div class="section-header" style="margin-bottom:0;">' +
            '<div>' +
              '<h2 class="section-title">وضع المبرمج (صلاحيات الإدارة التقنية الكاملة)</h2>' +
              '<p class="section-subtitle">أنت تستخدم حساب المبرمج المسؤول عن الإعدادات، الربط البرمجي، الأعمدة الافتراضية لكل دور، وحماية حسابات النظام.</p>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-sm" id="btn-dev-open-sections">إظهار / إخفاء الأقسام لكل موظف</button>' +
              '<button type="button" class="btn btn-sm btn-primary" id="btn-edit-developer-data">تعديل بيانات المبرمج</button>' +
              '<span class="status-tag status-danger">DEVELOPER</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="surface-card" id="dev-stats-control-card" style="border-top:3px solid var(--brand-primary);margin-bottom:16px;">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">تحكم المبرمج في الإحصائيات — من يظهر ومن يشاهد</h2>' +
              '<p class="section-subtitle">تحكم مستقل في الموظفين الذين تظهر أرقامهم وأسماؤهم في لوحة الصدارة والتقارير، ومن يملك صلاحية مشاهدة الإحصائيات.</p>' +
            '</div>' +
            '<span class="status-tag status-info">DEVELOPER STATS</span>' +
          '</div>' +
          '<div id="dev-stats-control-host">' +
            '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>' +
          '</div>' +
        '</div>'
      ) : '') +
      '<div class="surface-card" id="connection-diagnostics-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">مركز اختبار وفحص الاتصالات (Connection Diagnostics)</h2>' +
            '<p class="section-subtitle">' + connModeSubtitle + '</p>' +
          '</div>' +
        '</div>' +

        '<div class="detail-summary-grid" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">' +
          '<div class="detail-kv"><span class="detail-k">وضع التشغيل</span><span class="detail-v">' + (activeMode === 'neon' ? 'Neon PostgreSQL + Apps Script' : (activeMode === 'gas' ? 'Google Apps Script (/exec)' : 'وضع المعاينة المحلية')) + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">الخادم والوسيط (/api/crm)</span><span class="detail-v">' + (isVercelProxyAlive ? (hasEnvGasUrl ? 'مفعّل + GAS مضبوط' : 'مفعّل وجاهز') : 'استضافة بدون وسيط خادم') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">قاعدة البيانات (Neon)</span><span class="detail-v" style="font-size:12.5px;overflow-wrap:anywhere;">' + (hasDatabaseUrl ? ('مضبوطة <span class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-secondary);">(' + escapeHtml((maskedDbUrl || '').replace(/^postgres(ql)?:\/\/\*\*\*@/i, '')) + ')</span>') : 'غير مضبوطة في الخادم') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">Google Apps Script</span><span class="detail-v">' + (hasGasUrl ? 'مضبوط في بيئة الخادم' : 'غير مضبوط') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">توكن Rental Gate</span><span class="detail-v">' + (hasRgToken ? 'مضبوط ومحفوظ بالخادم' : 'غير مضبوط') + '</span></div>' +
        '</div>' +

        '<div style="margin-bottom:14px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);font-size:12.5px;color:var(--text-secondary);line-height:1.65;">' +
          'تمت إزالة جميع نماذج ربط قاعدة البيانات و<span class="mono" dir="ltr">Google Apps Script</span> و<span class="mono" dir="ltr">Vercel</span> من واجهة الموقع؛ تُضبط هذه المتغيرات من بيئة الخادم فقط، وتُستخدم الأزرار التالية لفحص الاتصال ومسح كاش المتصفح، مع إتاحة تحديث توكن <span class="mono" dir="ltr">RG_TOKEN</span> فقط.' +
        '</div>' +

        '<div class="toolbar-row rg-ui-set-diag" style="margin-top:0;margin-bottom:0;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-primary" id="btn-test-all-connections">فحص جميع الاتصالات</button>' +
          '<button type="button" class="btn" id="btn-test-server-health">فحص الخادم (/api/health)</button>' +
          '<button type="button" class="btn" id="btn-test-neon-db">فحص قاعدة البيانات (Neon)</button>' +
          '<button type="button" class="btn" id="btn-ping-gas-url">فحص Google Apps Script</button>' +
          '<button type="button" class="btn" id="btn-test-rg-top">فحص Rental Gate API</button>' +
          '<button type="button" class="btn btn-danger" id="btn-clear-browser-cache">مسح كاش المتصفح بالكامل</button>' +
        '</div>' +

        '<div id="conn-test-results" class="hidden" style="margin-top:12px;display:grid;gap:8px;"></div>' +
      '</div>' +

      (canManageSettings ? (
        '<form class="surface-card" id="rg-token-settings-form">' +
          '<div class="section-header" style="margin-bottom:12px;">' +
            '<div>' +
              '<h2 class="section-title">تحديث توكن Rental Gate API (<span class="mono" dir="ltr">RG_TOKEN</span>)</h2>' +
              '<p class="section-subtitle">الربط الوحيد المتاح عبر الإعدادات: أدخل التوكن ليُحفظ مشفرًا في الخادم مع اختباره تلقائيًا.</p>' +
            '</div>' +
            '<span class="status-tag ' + (hasRgToken ? 'status-success' : 'status-warning') + '">' + (hasRgToken ? 'مضبوط بالخادم' : 'غير مضبوط') + '</span>' +
          '</div>' +
          '<div class="form-grid-2" style="align-items:end;">' +
            '<div class="form-group">' +
              '<label class="form-label" for="set-rg-token">توكن Rental Gate API (<span class="mono" dir="ltr">RG_TOKEN</span>)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="set-rg-token" dir="ltr" lang="en" autocomplete="off" spellcheck="false" placeholder="ألصق التوكن هنا بدون مسافات...">' +
                '<button type="button" class="password-toggle-btn" id="btn-toggle-rg-token" aria-label="إظهار التوكن">إظهار</button>' +
              '</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<div class="toolbar-row" style="margin-bottom:0;">' +
                '<button type="submit" class="btn btn-primary" id="btn-save-rg-token">حفظ واختبار التوكن</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="rg-token-action-msg" class="hidden" style="margin-top:10px;"></div>' +
        '</form>'
      ) : '') +

      (canSync ? (
        '<div class="surface-card" id="settings-sync-card">' +
          '<div class="section-header">' +
            '<div><h2 class="section-title">مزامنة بيانات Rental Gate API</h2>' +
            '<p class="section-subtitle">يتم السحب عبر الخادم السحابي وGoogle Apps Script · الكاش المحلي (IndexedDB): <strong class="tabular-nums">' + cacheStats.reservationsCount + '</strong> حجز · <strong class="tabular-nums">' + cacheStats.customersCount + '</strong> عميل</p></div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn" id="btn-test-rg">اختبار الاتصال بـ Rental Gate</button>' +
              '<button type="button" class="btn btn-primary" id="btn-sync-now">سحب الحجوزات الآن</button>' +
            '</div>' +
          '</div>' +
          (isGeneralManager ? (
            '<div class="gm-pull-bar" id="sync-gm-pull-bar" style="margin-bottom:14px;">' +
              '<span class="gm-pull-label">تخصيص مدة السحب (المدير العام):</span>' +
              '<select class="select" id="sync-pull-preset" aria-label="مدة السحب">' +
                pullPresets.map(function (p) {
                  return '<option value="' + p.key + '">' + p.label + '</option>';
                }).join('') +
              '</select>' +
              '<div class="gm-pull-dates hidden" id="sync-pull-custom-dates">' +
                '<label class="gm-pull-date-field"><span>من تاريخ</span><input type="date" class="input" id="sync-pull-from" data-rg-range-pair="sync-pull-range" data-rg-range-role="start" aria-label="من تاريخ للسحب"></label>' +
                '<label class="gm-pull-date-field"><span>إلى تاريخ</span><input type="date" class="input" id="sync-pull-to" data-rg-range-pair="sync-pull-range" data-rg-range-role="end" aria-label="إلى تاريخ للسحب"></label>' +
              '</div>' +
            '</div>'
          ) : '') +
          '<div class="detail-summary-grid" style="margin-bottom:16px;">' +
            '<div class="detail-kv"><span class="detail-k">حالة توكن Rental Gate</span><span class="detail-v" id="sync-conn-status">' + (isBackendConnected || root.RGApi.isLiveMode() ? (hasRgToken ? 'مضبوط ومربوط في الخادم' : 'غير مضبوط في متغيرات البيئة') : 'وضع المعاينة المحلية') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + escapeHtml(autoSyncBadgeText) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono" dir="ltr">' + (lastSync ? escapeHtml(formatSettingDateTime(lastSync.finishedAt, ctx)) : 'لم يتم السحب بعد') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">الحجوزات المستوردة / المحدثة / التمديدات</span><span class="detail-v tabular-nums">' + (lastSync ? (lastSync.importedCount + ' مستورد · ' + lastSync.updatedCount + ' محدث · ' + lastSync.extensionsCount + ' تمديد') : '0 / 0 / 0') + '</span></div>' +
          '</div>' +
          '<div id="sync-action-msg" class="hidden" style="margin-bottom:14px;"></div>' +
          '<h3 style="margin:0 0 10px;font-size:14.5px;">سجل عمليات السحب (SyncLog)</h3>' +
          (syncData.logs.length === 0
            ? '<div class="empty-state" style="padding:20px;">لا توجد عمليات مزامنة مسجلة بعد.</div>'
            : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
                '<th>المعرف</th><th>المنفذ</th><th>الحالة</th><th>مستورد</th><th>محدث</th><th>تمديدات</th><th>الصفحات</th><th>الرسالة</th><th>التوقيت</th>' +
              '</tr></thead><tbody>' +
                syncData.logs.map(function (l) {
                  return '<tr>' +
                    '<td class="mono">' + l.id + '</td>' +
                    '<td>' + l.triggeredByName + '</td>' +
                    '<td><span class="status-tag ' + (l.status === 'success' ? 'status-success' : 'status-danger') + '">' + (l.status === 'success' ? 'ناجح' : 'فشل') + '</span></td>' +
                    '<td class="tabular-nums">' + l.importedCount + '</td>' +
                    '<td class="tabular-nums">' + l.updatedCount + '</td>' +
                    '<td class="tabular-nums">' + l.extensionsCount + '</td>' +
                    '<td class="tabular-nums">' + l.pagesFetched + '</td>' +
                    '<td>' + (l.errorMessage || '-') + '</td>' +
                    '<td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(l.finishedAt, ctx)) + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody></table></div>') +
        '</div>'
      ) : '') +

      '<form class="surface-card" id="set-handover-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">إعدادات تسليم الوردية وتعميمات الفريق</h2>' +
            '<p class="section-subtitle">تخصيص النطاق الافتراضي والساعات المحددة (من الساعة - إلى الساعة) والأقسام المضمنة في ملخص وملف PDF تسليم الوردية، وإدارة لوحة إعلانات الوردية.</p>' +
          '</div>' +
          (canOpenAnnouncements ? (
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn btn-primary" id="btn-open-announcements-mgr">📢 إدارة إعلانات وتعميمات الوردية</button>' +
            '</div>'
          ) : '') +
        '</div>' +
        '<div class="form-grid-3">' +
          '<div class="form-group">' +
            '<label class="form-label" for="ho-set-preset">النطاق الزمني الافتراضي للوردية</label>' +
            '<select class="select" id="ho-set-preset">' +
              hoPresets.map(function (p) {
                return '<option value="' + escapeHtml(p.key) + '"' + (hoSettings.defaultPreset === p.key ? ' selected' : '') + '>' + escapeHtml(p.labelAr) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ho-set-time-from">من الساعة (اختياري)</label>' +
            '<input type="time" class="input mono" id="ho-set-time-from" dir="ltr" value="' + escapeHtml(hoSettings.defaultTimeFrom || '') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ho-set-time-to">إلى الساعة (اختياري)</label>' +
            '<input type="time" class="input mono" id="ho-set-time-to" dir="ltr" value="' + escapeHtml(hoSettings.defaultTimeTo || '') + '">' +
          '</div>' +
        '</div>' +
        '<div class="rg-handover-toggles-grid">' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-today"' + (hoSettings.includeTodayMovements ? ' checked' : '') + '> تضمين قسم التسليم والاستلام اليوم في الملخص والـ PDF</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-pending"' + (hoSettings.includePending ? ' checked' : '') + '> تضمين الحجوزات قيد الانتظار / المتابعة</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-closed"' + (hoSettings.includeClosed ? ' checked' : '') + '> تضمين الحجوزات المغلقة في الوردية</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-problems"' + (hoSettings.includeOpenProblems ? ' checked' : '') + '> تضمين المشكلات المفتوحة</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-expiring"' + (hoSettings.includeExpiring24h ? ' checked' : '') + '> تضمين تنبيهات انتهاء 24 ساعة</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="ho-inc-notes"' + (hoSettings.autoIncludeNotes ? ' checked' : '') + '> إبراز ملاحظات المشرف المثبتة وتوجيهات التسليم</label>' +
        '</div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="submit" class="btn btn-primary" id="btn-save-handover-settings">حفظ إعدادات تسليم الوردية</button>' +
        '</div>' +
      '</form>' +

      (canManageSettings ? (
        '<form class="surface-card" id="sys-settings-form">' +
          '<div class="section-header"><div><h2 class="section-title">' + t('nav_settings') + ' العامة والتحديث التلقائي</h2><p class="section-subtitle">تُحفظ الإعدادات مركزيًا وتُحدّث مؤقت Apps Script تلقائيًا.</p></div></div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="set-company">اسم الشركة</label><input class="input" id="set-company" value="' + escapeHtml(settings.company_name || 'RENTAL GATE') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-ttl">مدة صلاحية الجلسة (ساعات)</label><input class="input tabular-nums" type="number" min="1" max="168" id="set-ttl" value="' + (settings.session_ttl_hours || 24) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-excluded">الحالات المستبعدة أثناء السحب (مفصولة بفاصلة)</label><input class="input mono" id="set-excluded" value="' + escapeHtml(Array.isArray(settings.excluded_statuses) ? settings.excluded_statuses.join(', ') : 'draft, test, abandoned') + '"></div>' +
            '<div class="form-group" style="justify-content:center;"><label class="checkbox-item"><input type="checkbox" id="set-agent-all"' + (settings.allow_agent_view_all ? ' checked' : '') + '> السماح لموظف خدمة العملاء باستعراض جميع الحجوزات</label></div>' +
          '</div>' +

          '<div style="margin-top:16px;padding:14px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<div><strong style="font-size:14px;">إعدادات التحديث التلقائي من Rental Gate API</strong>' +
              '<div style="font-size:12px;color:var(--text-muted);">يعمل تلقائيًا كل 12 ساعة افتراضيًا عبر Trigger في Google Apps Script، ويمكنك تعديل الفترة بالساعات والدقائق هنا.</div></div>' +
              '<label class="checkbox-item" style="font-weight:700;"><input type="checkbox" id="set-auto-sync-enabled"' + (autoSyncEnabled ? ' checked' : '') + '> تفعيل التحديث التلقائي</label>' +
            '</div>' +
            '<div class="form-grid-2" style="align-items:end;">' +
              '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
                '<div class="form-group">' +
                  '<label class="form-label" for="set-auto-sync-hours">فترة التحديث (الساعات)</label>' +
                  '<input class="input tabular-nums" type="number" min="0" max="168" id="set-auto-sync-hours" value="' + autoSyncHours + '">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label class="form-label" for="set-auto-sync-minutes">فترة التحديث (الدقائق)</label>' +
                  '<input class="input tabular-nums" type="number" min="0" max="59" id="set-auto-sync-minutes" value="' + autoSyncMinutes + '">' +
                '</div>' +
              '</div>' +
              '<div class="form-group">' +
                '<span class="form-label">اختيارات سريعة</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 0 && autoSyncMinutes === 5 ? ' btn-primary' : '') + '" data-hours="0" data-minutes="5">كل 5 دقائق</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 0 && autoSyncMinutes === 15 ? ' btn-primary' : '') + '" data-hours="0" data-minutes="15">كل 15 دقيقة</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 0 && autoSyncMinutes === 30 ? ' btn-primary' : '') + '" data-hours="0" data-minutes="30">كل 30 دقيقة</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 1 && autoSyncMinutes === 0 ? ' btn-primary' : '') + '" data-hours="1" data-minutes="0">كل ساعة</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 6 && autoSyncMinutes === 0 ? ' btn-primary' : '') + '" data-hours="6" data-minutes="0">كل 6 ساعات</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 12 && autoSyncMinutes === 0 ? ' btn-primary' : '') + '" data-hours="12" data-minutes="0">كل 12 ساعة (الافتراضي)</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset' + (autoSyncHours === 24 && autoSyncMinutes === 0 ? ' btn-primary' : '') + '" data-hours="24" data-minutes="0">كل 24 ساعة</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="rg-ui-simp-panel" id="set-ui-simplification-panel">' +
            '<div class="rg-ui-simp-header">' +
              '<div>' +
                '<strong style="font-size:14px;">خيارات تبسيط الواجهة وإظهار/إخفاء الأقسام والميزات (UI Simplification)</strong>' +
                '<div style="font-size:12px;color:var(--text-muted);">تحكم كامل في إظهار أو إخفاء أي صفحة، أداة، حقل، أو قسم في الموقع لجميع الموظفين (مع بقاء صفحة الإعدادات متاحة دائماً).</div>' +
              '</div>' +
              '<span class="status-tag status-info tabular-nums" id="set-ui-hidden-summary">مخفي حاليًا: ' + initialHiddenCount + ' / ' + uiOptionsList.length + '</span>' +
            '</div>' +
            '<div class="rg-ui-simp-controls">' +
              '<div class="form-group" style="flex:1;min-width:240px;">' +
                '<label class="form-label" for="set-ui-preset">نمط حجم الفريق أو التخصيص</label>' +
                '<select class="select" id="set-ui-preset">' +
                  ['full', 'medium', 'small', 'custom'].map(function (pid) {
                    var pr = uiPresetsMap[pid] || { id: pid, labelAr: pid };
                    return '<option value="' + escapeHtml(pid) + '"' + (uiSimp.preset === pid ? ' selected' : '') + '>' + escapeHtml(pr.labelAr || pid) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-group" style="flex:1;min-width:200px;">' +
                '<label class="form-label" for="set-ui-filter-input">بحث في الأقسام والميزات</label>' +
                '<input type="search" class="input" id="set-ui-filter-input" placeholder="ابحث مثل: رادار، PDF، مصفوفة، لم يرد، القوالب...">' +
              '</div>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-sm" id="btn-ui-show-all">إظهار الكل</button>' +
                '<button type="button" class="btn btn-sm btn-danger" id="btn-ui-hide-all">إخفاء الكل</button>' +
              '</div>' +
            '</div>' +
            '<div class="rg-ui-groups-stack" id="set-ui-flags-grid">' +
              (uiGroupsList.length ? uiGroupsList : [{ id: 'all', labelAr: 'كافة خيارات الواجهة' }]).map(function (grp, gIdx) {
                var grpOpts = uiOptionsList.filter(function (o) { return grp.id === 'all' || o.group === grp.id; });
                if (!grpOpts.length) return '';
                var grpHiddenCount = grpOpts.filter(function (o) { return Boolean(uiSimp[o.key]); }).length;
                return '<details class="rg-ui-group-card" data-ui-group-card="' + escapeHtml(grp.id) + '"' + (gIdx < 2 || grpHiddenCount > 0 ? ' open' : '') + '>' +
                  '<summary class="rg-ui-group-summary">' +
                    '<span class="rg-ui-group-title">' + escapeHtml(grp.labelAr) + '</span>' +
                    '<span class="rg-ui-group-count tabular-nums" data-ui-group-count="' + escapeHtml(grp.id) + '">مخفي: ' + grpHiddenCount + ' / ' + grpOpts.length + '</span>' +
                  '</summary>' +
                  '<div class="rg-ui-group-body">' +
                    '<div class="rg-ui-group-actions">' +
                      '<button type="button" class="btn btn-sm rg-ui-group-show-btn" data-group="' + escapeHtml(grp.id) + '">إظهار هذه المجموعة</button>' +
                      '<button type="button" class="btn btn-sm rg-ui-group-hide-btn" data-group="' + escapeHtml(grp.id) + '">إخفاء هذه المجموعة</button>' +
                    '</div>' +
                    '<div class="checkbox-grid">' +
                      grpOpts.map(function (opt) {
                        var inputId = opt.legacyId || ('set-ui-flag-' + opt.key);
                        var isChecked = Boolean(uiSimp[opt.key]);
                        var searchText = (opt.labelAr || '') + ' ' + (opt.labelEn || '') + ' ' + opt.key;
                        return '<label class="checkbox-item rg-ui-opt-item" data-search-text="' + escapeHtml(searchText.toLowerCase()) + '">' +
                          '<input type="checkbox" id="' + escapeHtml(inputId) + '" class="ui-simp-flag" data-ui-key="' + escapeHtml(opt.key) + '" data-ui-group="' + escapeHtml(grp.id) + '"' + (isChecked ? ' checked' : '') + '> ' +
                          '<span>' + escapeHtml(opt.labelAr) + '</span>' +
                        '</label>';
                      }).join('') +
                    '</div>' +
                  '</div>' +
                '</details>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="rg-ui-simp-panel rg-role-defaults-panel" id="set-role-ui-defaults-panel">' +
            '<div class="rg-ui-simp-header">' +
              '<div>' +
                '<strong style="font-size:14px;">التحكم المركزي بإعدادات الواجهة الافتراضية لكل دور (Role UI Defaults)</strong>' +
                '<div style="font-size:12px;color:var(--text-muted);">اضبط نمط التبسيط والأعمدة الافتراضية لجدول الحجوزات لكل دور (موظف / مشرف / مدير / مبرمج)، مع خيار الفرض المركزي ومنع التجاوز المحلي.</div>' +
              '</div>' +
              '<div class="rg-role-tabs" id="set-role-ui-tabs">' +
                ROLE_TABS_META.map(function (rt) {
                  var rCfg = roleUiDefaultsDraft[rt.key] || {};
                  return '<button type="button" class="btn btn-sm rg-role-tab-btn' + (activeRoleDefaultTab === rt.key ? ' btn-primary' : '') + '" data-role-tab="' + escapeHtml(rt.key) + '">' +
                    escapeHtml(rt.label) + (rCfg.enabled ? ' ✓' : '') +
                  '</button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div id="set-role-ui-editor-body"></div>' +
          '</div>' +

          '<div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<button type="submit" class="btn btn-primary" id="btn-save-sys-settings">حفظ الإعدادات وتحديث المزامنة التلقائية</button>' +
              (canPreviewSettings
                ? '<button type="button" class="btn rg-preview-inline-btn" id="btn-preview-role-defaults">👁️ معاينة النظام بدور: موظف خدمة العملاء</button>'
                : '') +
            '</div>' +
          '</div>' +
        '</form>' +
        '<div class="surface-card rg-ui-set-danger" id="danger-zone-reservations-card" style="border-top:3px solid var(--status-danger-text, #f43f5e);">' +
          '<div class="section-header" style="margin-bottom:8px;">' +
            '<div>' +
              '<h2 class="section-title" style="color:var(--status-danger-text, #f43f5e);">إدارة بيانات الحجوزات (الاستيراد والحذف الآمن)</h2>' +
              '<p class="section-subtitle">استورد الحجوزات مباشرة من ملف Excel، أو احذف الحجوزات حسب شهر محدد أو سنة محددة أو الكل مع تصدير نسخة Excel احتياطية تلقائياً قبل المسح.</p>' +
            '</div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn" id="btn-import-excel-reservations">استيراد حجوزات من Excel</button>' +
              '<button type="button" class="btn btn-danger" id="btn-delete-all-reservations">حذف الحجوزات (شهر / سنة / الكل)</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      ) : '');

    bindPersonalAccountCard(container, ctx);

    var editDevBtn = document.getElementById('btn-edit-developer-data');
    if (editDevBtn) {
      editDevBtn.addEventListener('click', function () {
        if (root.RGEmployees && typeof root.RGEmployees.openEditDeveloperModal === 'function') {
          root.RGEmployees.openEditDeveloperModal(ctx, function () {
            render(container, ctx);
          });
        }
      });
    }

    var devOpenSectionsBtn = document.getElementById('btn-dev-open-sections');
    if (devOpenSectionsBtn) {
      devOpenSectionsBtn.addEventListener('click', function () {
        if (root.RGEmployees && typeof root.RGEmployees.openEmployeeSectionsModal === 'function') {
          var empList = (root.RGApp && typeof root.RGApp.getEmployeesState === 'function')
            ? (root.RGApp.getEmployeesState().items || [])
            : [];
          root.RGEmployees.openEmployeeSectionsModal(null, empList, ctx, function () {
            render(container, ctx);
          });
        }
      });
    }

    var devStatsHost = document.getElementById('dev-stats-control-host');
    if (isDeveloperUser && devStatsHost && root.RGEmployees && typeof root.RGEmployees.mountStatsControlPanel === 'function') {
      (async function () {
        try {
          var emps = (root.RGApp && typeof root.RGApp.getEmployeesState === 'function')
            ? (root.RGApp.getEmployeesState().items || [])
            : [];
          if (!emps.length && root.RGApi) {
            var eResp = await root.RGApi.callApi('getEmployees', { silentRefresh: true });
            if (eResp && eResp.success && eResp.data && Array.isArray(eResp.data.items)) {
              emps = eResp.data.items;
              if (root.RGApp && typeof root.RGApp.syncEmployeesStateFromPayload === 'function') {
                root.RGApp.syncEmployeesStateFromPayload(eResp.data);
              }
            }
          }
          if (!devStatsHost.isConnected) return;
          root.RGEmployees.mountStatsControlPanel(devStatsHost, emps, ctx, {
            saveBtnId: 'btn-save-dev-stats-control'
          });
        } catch (_e) {
          if (devStatsHost.isConnected) {
            devStatsHost.innerHTML = '<div class="empty-state" style="padding:14px;">تعذر تحميل قائمة الموظفين لتحكم الإحصائيات.</div>';
          }
        }
      })();
    }

    if (root.RGApp && typeof root.RGApp.animateProgressiveReveal === 'function') {
      root.RGApp.animateProgressiveReveal(container);
    }

    var connResultsEl = document.getElementById('conn-test-results');
    var diagCardsByKey = {};

    function renderDiagCards() {
      if (!connResultsEl) return;
      var keys = Object.keys(diagCardsByKey);
      if (!keys.length) {
        connResultsEl.classList.add('hidden');
        connResultsEl.innerHTML = '';
        return;
      }
      connResultsEl.classList.remove('hidden');
      connResultsEl.innerHTML = keys.map(function (k) {
        var item = diagCardsByKey[k];
        var tagCls = item.status === 'ok'
          ? 'status-success'
          : (item.status === 'pending' ? 'status-info' : 'status-danger');
        var tagLabel = item.status === 'ok'
          ? 'ناجح'
          : (item.status === 'pending' ? 'جاري الاختبار...' : 'فشل');
        var latencyBadge = typeof item.latencyMs === 'number' && item.latencyMs > 0
          ? ('<span class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-muted);">' + item.latencyMs + 'ms</span>')
          : '';
        return '<div style="padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
              '<strong style="font-size:13px;">' + escapeHtml(item.label) + '</strong>' +
              '<span class="status-tag ' + tagCls + '">' + tagLabel + '</span>' +
              latencyBadge +
            '</div>' +
            '<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.6;">' + escapeHtml(item.message || '') + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function setDiagResult(key, label, status, message, latencyMs) {
      diagCardsByKey[key] = {
        label: label,
        status: status,
        message: message,
        latencyMs: latencyMs
      };
      renderDiagCards();
    }

    async function runServerHealthTest() {
      setDiagResult('server', 'الخادم (/api/health)', 'pending', 'جاري فحص نقطة الخادم...', 0);
      var res = root.RGApi.testServerHealth
        ? await root.RGApi.testServerHealth()
        : { success: false, message: 'دالة فحص الخادم غير متاحة.', data: null };
      setDiagResult('server', 'الخادم (/api/health)', res.success ? 'ok' : 'fail', res.message || '', res.data && res.data.latencyMs);
      return res;
    }

    async function runNeonDbTest() {
      setDiagResult('neon', 'قاعدة البيانات (Neon PostgreSQL)', 'pending', 'جاري اختبار الاتصال بقاعدة البيانات...', 0);
      var res = root.RGApi.testDatabaseHealth
        ? await root.RGApi.testDatabaseHealth()
        : { success: false, message: 'دالة اختبار قاعدة البيانات غير متاحة.', data: null };
      setDiagResult('neon', 'قاعدة البيانات (Neon PostgreSQL)', res.success ? 'ok' : 'fail', res.message || '', res.data && res.data.latencyMs);
      return res;
    }

    async function runGasPingTest() {
      setDiagResult('gas', 'Google Apps Script (/exec)', 'pending', 'جاري فحص رابط Google Apps Script من الخادم...', 0);
      var startedAt = Date.now();
      var res = await root.RGApi.pingGasUrl('');
      var elapsed = Date.now() - startedAt;
      setDiagResult('gas', 'Google Apps Script (/exec)', res && res.success ? 'ok' : 'fail', (res && res.message) || (res && res.success ? 'الاتصال ناجح!' : 'فشل الاتصال.'), elapsed);
      return res;
    }

    async function runRgApiTest() {
      setDiagResult('rg', 'Rental Gate API (RG_TOKEN)', 'pending', 'جاري اختبار الاتصال بواجهة Rental Gate...', 0);
      var startedAt = Date.now();
      var res = await root.RGApi.callApi('testConnection', {});
      var elapsed = Date.now() - startedAt;
      var ok = Boolean(res && res.success && res.data && res.data.connected);
      var msgText = (res && res.data && res.data.message) || (res && res.message) || (ok ? 'الاتصال ناجح!' : 'فشل الاتصال.');
      setDiagResult('rg', 'Rental Gate API (RG_TOKEN)', ok ? 'ok' : 'fail', msgText, elapsed);
      return res;
    }

    var testAllBtn = document.getElementById('btn-test-all-connections');
    if (testAllBtn) {
      testAllBtn.addEventListener('click', function () {
        runWithLock(testAllBtn, 'testAllConnections', async function () {
          var prevText = testAllBtn.textContent;
          testAllBtn.textContent = 'جاري الفحص الشامل...';
          try {
            await Promise.all([
              runServerHealthTest(),
              runNeonDbTest(),
              runGasPingTest(),
              runRgApiTest()
            ]);
          } finally {
            if (testAllBtn.isConnected !== false) testAllBtn.textContent = prevText;
          }
        });
      });
    }

    var testHealthBtn = document.getElementById('btn-test-server-health');
    if (testHealthBtn) {
      testHealthBtn.addEventListener('click', function () {
        runWithLock(testHealthBtn, 'testServerHealth', async function () {
          var prevText = testHealthBtn.textContent;
          testHealthBtn.textContent = 'جاري الاختبار...';
          try {
            await runServerHealthTest();
          } finally {
            if (testHealthBtn.isConnected !== false) testHealthBtn.textContent = prevText;
          }
        });
      });
    }

    var testNeonBtn = document.getElementById('btn-test-neon-db');
    if (testNeonBtn) {
      testNeonBtn.addEventListener('click', function () {
        runWithLock(testNeonBtn, 'testDatabaseHealth', async function () {
          var prevText = testNeonBtn.textContent;
          testNeonBtn.textContent = 'جاري الاختبار...';
          try {
            await runNeonDbTest();
          } finally {
            if (testNeonBtn.isConnected !== false) testNeonBtn.textContent = prevText;
          }
        });
      });
    }

    var pingGasBtn = document.getElementById('btn-ping-gas-url');
    if (pingGasBtn) {
      pingGasBtn.addEventListener('click', function () {
        runWithLock(pingGasBtn, 'pingGasUrl', async function () {
          var prevText = pingGasBtn.textContent;
          pingGasBtn.textContent = 'جاري الاختبار...';
          try {
            await runGasPingTest();
          } finally {
            if (pingGasBtn.isConnected !== false) pingGasBtn.textContent = prevText;
          }
        });
      });
    }

    var testRgTopBtn = document.getElementById('btn-test-rg-top');
    if (testRgTopBtn) {
      testRgTopBtn.addEventListener('click', function () {
        runWithLock(testRgTopBtn, 'testConnectionTop', async function () {
          var prevText = testRgTopBtn.textContent;
          testRgTopBtn.textContent = 'جاري الفحص...';
          try {
            await runRgApiTest();
          } finally {
            if (testRgTopBtn.isConnected !== false) testRgTopBtn.textContent = prevText;
          }
        });
      });
    }

    var clearBrowserCacheBtn = document.getElementById('btn-clear-browser-cache');
    if (clearBrowserCacheBtn) {
      clearBrowserCacheBtn.addEventListener('click', function () {
        runWithLock(clearBrowserCacheBtn, 'wipeAllBrowserCaches', async function () {
          var prevText = clearBrowserCacheBtn.textContent;
          clearBrowserCacheBtn.textContent = 'جاري مسح الكاش...';
          setDiagResult('cache', 'كاش المتصفح (IndexedDB + CacheStorage)', 'pending', 'جاري تفريغ الكاش والملفات المخزنة وإعادة المزامنة...', 0);
          try {
            var cleared = (root.RGApi && root.RGApi.wipeAllBrowserCaches)
              ? await root.RGApi.wipeAllBrowserCaches({ preserveAuth: true })
              : null;
            var summaryMsg = cleared
              ? ('تم مسح كاش المتصفح بالكامل (IndexedDB: ' + (cleared.indexedDb ? 'مفرغ' : 'نظيف') + ' · CacheStorage: ' + Number(cleared.cacheStorage || 0) + ' · Session: ' + (cleared.sessionStorage ? 'مفرغ' : 'نظيف') + ').')
              : 'تم مسح كاش الذاكرة المحلية بنجاح.';
            setDiagResult('cache', 'كاش المتصفح (IndexedDB + CacheStorage)', 'ok', summaryMsg, 1);
            ctx.toast('تم مسح كاش المتصفح بالكامل وإعادة المزامنة مع الخادم.');
            await render(container, ctx);
          } catch (err) {
            setDiagResult('cache', 'كاش المتصفح (IndexedDB + CacheStorage)', 'fail', (err && err.message) || 'تعذر مسح كاش المتصفح.', 0);
            ctx.toast((err && err.message) || 'تعذر مسح كاش المتصفح.', true);
          } finally {
            if (clearBrowserCacheBtn.isConnected !== false) clearBrowserCacheBtn.textContent = prevText;
          }
        });
      });
    }

    bindPasswordToggle('set-rg-token', 'btn-toggle-rg-token');
    var rgTokenForm = document.getElementById('rg-token-settings-form');
    if (rgTokenForm) {
      rgTokenForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var tokInput = document.getElementById('set-rg-token');
        var tokMsgEl = document.getElementById('rg-token-action-msg');
        var saveTokBtn = document.getElementById('btn-save-rg-token');
        var rawTok = String((tokInput && tokInput.value) || '').trim().replace(/^Bearer\s+/i, '');
        if (!rawTok || rawTok.length < 15 || /\s/.test(rawTok)) {
          if (tokMsgEl) {
            tokMsgEl.className = 'form-error';
            tokMsgEl.textContent = 'صيغة التوكن غير صالحة. يرجى لصق التوكن كاملاً بدون مسافات (15 حرفاً على الأقل).';
          }
          if (tokInput) tokInput.focus();
          return;
        }
        runWithLock(saveTokBtn, 'saveApiToken', async function () {
          var prevText = saveTokBtn ? saveTokBtn.textContent : '';
          if (saveTokBtn) saveTokBtn.textContent = 'جاري الحفظ والاختبار...';
          try {
            var res = await root.RGApi.callApi('saveApiToken', {
              token: rawTok,
              rgToken: rawTok,
              siteOrigin: window.location.origin,
              testAfterSave: true
            });
            if (res && res.success) {
              if (tokInput) tokInput.value = '';
              var connRes = res.data && res.data.connection;
              var connOk = Boolean(connRes && connRes.connected);
              var msgText = (connRes && connRes.message)
                ? ('تم حفظ التوكن بنجاح — ' + connRes.message)
                : (res.message || 'تم حفظ توكن Rental Gate بنجاح.');
              if (tokMsgEl) {
                tokMsgEl.className = (!connRes || connOk) ? 'form-success' : 'form-error';
                tokMsgEl.textContent = msgText;
              }
              ctx.toast(msgText);
              await render(container, ctx);
            } else {
              if (tokMsgEl) {
                tokMsgEl.className = 'form-error';
                tokMsgEl.textContent = (res && res.message) || 'تعذر حفظ التوكن.';
              }
              ctx.toast((res && res.message) || 'تعذر حفظ التوكن.', true);
            }
          } finally {
            if (saveTokBtn && saveTokBtn.isConnected !== false) saveTokBtn.textContent = prevText;
          }
        });
      });
    }

    var testRgBtn = document.getElementById('btn-test-rg');
    if (testRgBtn) {
      testRgBtn.addEventListener('click', function () {
        var msg = document.getElementById('sync-action-msg');
        runWithLock(testRgBtn, 'testConnection', async function () {
          var prevText = testRgBtn.textContent;
          testRgBtn.textContent = 'جاري الاختبار...';
          try {
            var res = await root.RGApi.callApi('testConnection', {});
            msg.className = (res.success && res.data && res.data.connected) ? 'form-success' : 'form-error';
            msg.textContent = (res.data && res.data.message) || res.message;
          } finally {
            if (testRgBtn.isConnected !== false) testRgBtn.textContent = prevText;
          }
        });
      });
    }

    var syncPresetEl = document.getElementById('sync-pull-preset');
    var syncDatesWrap = document.getElementById('sync-pull-custom-dates');
    var syncFromEl = document.getElementById('sync-pull-from');
    var syncToEl = document.getElementById('sync-pull-to');
    if (syncPresetEl && syncDatesWrap) {
      syncPresetEl.addEventListener('change', function () {
        syncDatesWrap.classList.toggle('hidden', syncPresetEl.value !== 'custom');
      });
    }

    var syncNowBtn = document.getElementById('btn-sync-now');
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', function () {
        runWithLock(syncNowBtn, 'syncRentalGate', async function () {
          var prevText = syncNowBtn.textContent;
          syncNowBtn.textContent = 'جاري السحب...';
          var syncPayload = {};
          if (isGeneralManager && syncPresetEl) {
            var spPreset = syncPresetEl.value || 'all';
            var spFrom = syncFromEl ? syncFromEl.value : '';
            var spTo = syncToEl ? syncToEl.value : '';
            if (spPreset === 'custom') {
              if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates && syncDatesWrap) {
                var syncCheck = root.RGCrmDatePicker.validateContainerDates(syncDatesWrap);
                if (!syncCheck.valid) {
                  ctx.toast(syncCheck.message || 'يرجى التحقق من صحة تواريخ السحب.', true);
                  syncNowBtn.textContent = prevText;
                  return;
                }
              }
              if (!spFrom && !spTo) {
                ctx.toast('يرجى تحديد تاريخ البداية أو تاريخ النهاية على الأقل.', true);
                syncNowBtn.textContent = prevText;
                return;
              }
            }
            syncPayload = {
              preset: spPreset,
              dateFrom: spPreset === 'custom' ? spFrom : '',
              dateTo: spPreset === 'custom' ? spTo : ''
            };
          }
          var res = await root.RGApi.callApi('syncRentalGate', syncPayload);
          if (res.success) {
            var d = res.data || {};
            var imported = d.importedCount || 0;
            var updated = d.updatedCount || 0;
            var exts = d.extensionsCount || 0;
            var diagHint = '';
            if (imported === 0 && updated === 0) {
              var fetched = d.fetchedCount || 0;
              if (fetched > 0 && d.excludedFilteredCount === fetched) {
                diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعدت جميعها حسب الحالات المستبعدة';
              } else if (fetched > 0 && d.rangeFilteredCount > 0) {
                diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعد ' + d.rangeFilteredCount + ' خارج النطاق المحدد';
              } else if (fetched === 0) {
                diagHint = ' — أرجعت الواجهة 0 حجز لهذا الحساب/الفترة';
              }
            }
            ctx.toast('اكتملت المزامنة بنجاح: ' + imported + ' جديد · ' + updated + ' محدث · ' + exts + ' تمديد' + diagHint);
            render(container, ctx);
          } else {
            var msg = document.getElementById('sync-action-msg');
            msg.className = 'form-error';
            msg.textContent = res.message;
            if (syncNowBtn.isConnected !== false) syncNowBtn.textContent = prevText;
          }
        });
      });
    }

    container.querySelectorAll('.auto-sync-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inpH = document.getElementById('set-auto-sync-hours');
        var inpM = document.getElementById('set-auto-sync-minutes');
        var chk = document.getElementById('set-auto-sync-enabled');
        if (inpH) inpH.value = btn.getAttribute('data-hours') || '0';
        if (inpM) inpM.value = btn.getAttribute('data-minutes') || '0';
        if (chk) chk.checked = true;
        container.querySelectorAll('.auto-sync-preset').forEach(function (b) {
          b.classList.toggle('btn-primary', b === btn);
        });
      });
    });

    var uiPresetSelect = document.getElementById('set-ui-preset');
    var uiFlagEls = Array.prototype.slice.call(container.querySelectorAll('.ui-simp-flag'));
    var uiSummaryBadge = document.getElementById('set-ui-hidden-summary');
    var uiFilterInput = document.getElementById('set-ui-filter-input');

    function updateUiSimpCounters() {
      var totalCount = uiFlagEls.length;
      var checkedCount = uiFlagEls.filter(function (c) { return c.checked; }).length;
      if (uiSummaryBadge) {
        uiSummaryBadge.textContent = 'مخفي حاليًا: ' + checkedCount + ' / ' + totalCount;
      }
      container.querySelectorAll('[data-ui-group-count]').forEach(function (badge) {
        var grpId = badge.getAttribute('data-ui-group-count');
        var grpFlags = uiFlagEls.filter(function (c) { return c.getAttribute('data-ui-group') === grpId; });
        var grpChecked = grpFlags.filter(function (c) { return c.checked; }).length;
        badge.textContent = 'مخفي: ' + grpChecked + ' / ' + grpFlags.length;
      });
    }

    if (uiPresetSelect) {
      uiPresetSelect.addEventListener('change', function () {
        var pid = uiPresetSelect.value;
        var presetDef = uiPresetsMap[pid];
        if (!presetDef || pid === 'custom') return;
        uiFlagEls.forEach(function (chk) {
          var key = chk.getAttribute('data-ui-key');
          if (key) chk.checked = Boolean(presetDef[key]);
        });
        updateUiSimpCounters();
      });
    }

    uiFlagEls.forEach(function (chk) {
      chk.addEventListener('change', function () {
        if (uiPresetSelect && uiPresetSelect.value !== 'custom') {
          uiPresetSelect.value = 'custom';
        }
        updateUiSimpCounters();
      });
    });

    var uiShowAllBtn = document.getElementById('btn-ui-show-all');
    if (uiShowAllBtn) {
      uiShowAllBtn.addEventListener('click', function () {
        uiFlagEls.forEach(function (chk) { chk.checked = false; });
        if (uiPresetSelect) uiPresetSelect.value = 'full';
        updateUiSimpCounters();
      });
    }

    var uiHideAllBtn = document.getElementById('btn-ui-hide-all');
    if (uiHideAllBtn) {
      uiHideAllBtn.addEventListener('click', function () {
        uiFlagEls.forEach(function (chk) { chk.checked = true; });
        if (uiPresetSelect) uiPresetSelect.value = 'custom';
        updateUiSimpCounters();
      });
    }

    container.querySelectorAll('.rg-ui-group-show-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var grpId = btn.getAttribute('data-group');
        uiFlagEls.forEach(function (chk) {
          if (chk.getAttribute('data-ui-group') === grpId) chk.checked = false;
        });
        var anyChecked = uiFlagEls.some(function (c) { return c.checked; });
        if (uiPresetSelect) uiPresetSelect.value = anyChecked ? 'custom' : 'full';
        updateUiSimpCounters();
      });
    });

    container.querySelectorAll('.rg-ui-group-hide-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var grpId = btn.getAttribute('data-group');
        uiFlagEls.forEach(function (chk) {
          if (chk.getAttribute('data-ui-group') === grpId) chk.checked = true;
        });
        if (uiPresetSelect) uiPresetSelect.value = 'custom';
        updateUiSimpCounters();
      });
    });

    if (uiFilterInput) {
      uiFilterInput.addEventListener('input', function () {
        var q = String(uiFilterInput.value || '').trim().toLowerCase();
        container.querySelectorAll('[data-ui-group-card]').forEach(function (card) {
          var items = Array.prototype.slice.call(card.querySelectorAll('.rg-ui-opt-item'));
          var visibleCount = 0;
          items.forEach(function (item) {
            var txt = item.getAttribute('data-search-text') || '';
            var match = !q || txt.indexOf(q) !== -1;
            item.classList.toggle('hidden', !match);
            if (match) visibleCount += 1;
          });
          card.classList.toggle('hidden', Boolean(q) && visibleCount === 0);
          if (q && visibleCount > 0) card.open = true;
        });
      });
    }

    var roleEditorBody = document.getElementById('set-role-ui-editor-body');
    var roleTabsWrap = document.getElementById('set-role-ui-tabs');

    function renderRoleDefaultsEditor() {
      if (!roleEditorBody) return;
      var curCfg = roleUiDefaultsDraft[activeRoleDefaultTab] || {
        enabled: false,
        forceForRole: false,
        uiSimplification: null,
        visibleCols: (root.RGCrmCore && root.RGCrmCore.DEFAULT_RESERVATIONS_VISIBLE_COLS) ? root.RGCrmCore.DEFAULT_RESERVATIONS_VISIBLE_COLS.slice() : ['reservationNumber', 'customerName', 'carName', 'startDate', 'totalAmount', 'originalStatusAr', 'internalStatus']
      };
      var roleUiObj = curCfg.uiSimplification || (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings ? root.RGCrmCore.normalizeUiSimplificationSettings({ preset: 'full' }) : { preset: 'full' });
      var roleCols = Array.isArray(curCfg.visibleCols) ? curCfg.visibleCols : [];
      if (roleTabsWrap) {
        roleTabsWrap.querySelectorAll('.rg-role-tab-btn').forEach(function (btn) {
          var rKey = btn.getAttribute('data-role-tab');
          var rtMeta = ROLE_TABS_META.find(function (m) { return m.key === rKey; });
          var cfgItem = roleUiDefaultsDraft[rKey] || {};
          btn.classList.toggle('btn-primary', rKey === activeRoleDefaultTab);
          if (rtMeta) btn.textContent = rtMeta.label + (cfgItem.enabled ? ' ✓' : '');
        });
      }

      var matchingJobs = rolePresetsList.filter(function (p) { return p && p.role === activeRoleDefaultTab; });
      var activeRoleMeta = ROLE_TABS_META.find(function (m) { return m.key === activeRoleDefaultTab; }) || { key: activeRoleDefaultTab, label: activeRoleDefaultTab };

      var previewFooterBtn = document.getElementById('btn-preview-role-defaults');
      if (previewFooterBtn) {
        var canPreviewTab = allowedPreviewRolesSettings.indexOf(activeRoleDefaultTab) !== -1;
        previewFooterBtn.textContent = '👁️ معاينة النظام بدور: ' + activeRoleMeta.label;
        previewFooterBtn.disabled = !canPreviewTab;
        previewFooterBtn.title = canPreviewTab
          ? ('معاينة النظام مباشرة بإعدادات وأعمدة دور ' + activeRoleMeta.label)
          : 'لا يمكنك محاكاة هذا الدور';
      }

      roleEditorBody.innerHTML =
        '<div class="rg-role-defaults-body">' +
          (activeRoleDefaultTab === 'developer'
            ? '<div class="rg-dev-role-note"><strong>صلاحيات المبرمج الكاملة:</strong> يمتلك المبرمج كافة الصلاحيات البرمجية وإدارة الموقع والإعدادات والربط التقني وفحص الخادم وقاعدة البيانات والأعمدة الافتراضية، مع إمكانية معاينة أي دور أو وظيفة.</div>'
            : '') +
          '<div class="rg-role-toggles-row">' +
            '<label class="checkbox-item" style="font-weight:700;"><input type="checkbox" id="role-ui-enabled"' + (curCfg.enabled ? ' checked' : '') + '> تفعيل إعدادات واجهة خاصة بهذا الدور</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="role-ui-force"' + (curCfg.forceForRole ? ' checked' : '') + '> فرض الأعمدة والإعدادات ومنع التجاوز المحلي للموظفين</label>' +
          '</div>' +
          '<div class="rg-role-jobs-strip">' +
            '<div class="rg-role-jobs-head"><strong>الوظائف المرتبطة بهذا الدور (' + matchingJobs.length + '):</strong></div>' +
            (matchingJobs.length
              ? '<div class="rg-role-jobs-list">' + matchingJobs.map(function (jp) {
                  var canPrevJob = canPreviewSettings && allowedPreviewRolesSettings.indexOf(jp.role) !== -1;
                  return '<div class="rg-role-job-chip">' +
                    '<div class="rg-role-job-info"><strong>' + escapeHtml(jp.label) + '</strong><span>' + escapeHtml(jp.jobTitle) + ' · <span class="tabular-nums">' + ((jp.permissions || []).length) + ' صلاحية</span></span></div>' +
                    (canPrevJob
                      ? '<button type="button" class="btn btn-sm rg-role-job-preview-btn" data-preset-id="' + escapeHtml(jp.id) + '" data-role="' + escapeHtml(jp.role) + '" data-label="' + escapeHtml(jp.label) + '">👁️ معاينة الوظيفة</button>'
                      : '') +
                  '</div>';
                }).join('') + '</div>'
              : '<span style="font-size:12px;color:var(--text-muted);">لا توجد قوالب وظائف مرتبطة بهذا الدور حالياً (يمكنك إضافتها من شاشة الموظفين).</span>') +
          '</div>' +
          '<div class="form-grid-2" style="margin-top:4px;">' +
            '<div class="form-group">' +
              '<label class="form-label" for="role-ui-preset">نمط تبسيط الواجهة الافتراضي للدور</label>' +
              '<select class="select" id="role-ui-preset">' +
                ['full', 'medium', 'small', 'custom'].map(function (pid) {
                  var pr = uiPresetsMap[pid] || { id: pid, labelAr: pid };
                  return '<option value="' + escapeHtml(pid) + '"' + (roleUiObj.preset === pid ? ' selected' : '') + '>' + escapeHtml(pr.labelAr || pid) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="role-ui-flag-filter">تصفية خيارات التبسيط للدور</label>' +
              '<input type="search" class="input" id="role-ui-flag-filter" placeholder="ابحث لإظهار أو إخفاء أزرار معينة لهذا الدور...">' +
            '</div>' +
          '</div>' +
          '<details class="rg-ui-group-card" style="margin-top:8px;" open>' +
            '<summary class="rg-ui-group-summary"><span class="rg-ui-group-title">الأعمدة الافتراضية لجدول الحجوزات لهذا الدور</span><span class="rg-ui-group-count tabular-nums">' + roleCols.length + ' / ' + ROLE_UI_COLS.length + '</span></summary>' +
            '<div class="rg-ui-group-body">' +
              '<div class="checkbox-grid">' +
                ROLE_UI_COLS.map(function (col) {
                  var isChk = roleCols.indexOf(col.key) !== -1;
                  return '<label class="checkbox-item"><input type="checkbox" class="role-ui-col-chk" value="' + escapeHtml(col.key) + '"' + (isChk ? ' checked' : '') + '> <span>' + escapeHtml(col.label) + '</span></label>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</details>' +
          '<details class="rg-ui-group-card" style="margin-top:8px;">' +
            '<summary class="rg-ui-group-summary"><span class="rg-ui-group-title">خيارات إظهار/إخفاء العناصر الخاصة بهذا الدور</span><span class="rg-ui-group-count tabular-nums" id="role-ui-flags-cnt">' + uiOptionsList.filter(function (o) { return Boolean(roleUiObj[o.key]); }).length + ' / ' + uiOptionsList.length + ' مخفي</span></summary>' +
            '<div class="rg-ui-group-body">' +
              '<div class="checkbox-grid" id="role-ui-flags-grid">' +
                uiOptionsList.map(function (opt) {
                  var isOn = Boolean(roleUiObj[opt.key]);
                  var sTxt = ((opt.labelAr || '') + ' ' + (opt.labelEn || '') + ' ' + opt.key).toLowerCase();
                  return '<label class="checkbox-item role-ui-opt-item" data-search="' + escapeHtml(sTxt) + '">' +
                    '<input type="checkbox" class="role-ui-flag-chk" value="' + escapeHtml(opt.key) + '"' + (isOn ? ' checked' : '') + '> <span>' + escapeHtml(opt.labelAr) + '</span>' +
                  '</label>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</details>' +
        '</div>';

      var ensureRoleDraftObj = function () {
        if (!roleUiDefaultsDraft[activeRoleDefaultTab]) {
          roleUiDefaultsDraft[activeRoleDefaultTab] = { enabled: false, forceForRole: false, uiSimplification: null, visibleCols: ROLE_UI_COLS.slice(0, 7).map(function (c) { return c.key; }) };
        }
        return roleUiDefaultsDraft[activeRoleDefaultTab];
      };

      roleEditorBody.querySelectorAll('.rg-role-job-preview-btn').forEach(function (jBtn) {
        jBtn.addEventListener('click', function () {
          var pId = jBtn.getAttribute('data-preset-id') || '';
          var pRole = jBtn.getAttribute('data-role') || activeRoleDefaultTab;
          var pLabel = jBtn.getAttribute('data-label') || '';
          if (root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
            root.RGApp.startPreviewSession({
              role: pRole,
              presetId: pId,
              customLabel: pLabel,
              draftRoleUiDefaults: roleUiDefaultsDraft
            });
          }
        });
      });

      var enChk = document.getElementById('role-ui-enabled');
      var forceChk = document.getElementById('role-ui-force');
      var rPreset = document.getElementById('role-ui-preset');
      var rFilter = document.getElementById('role-ui-flag-filter');

      if (enChk) {
        enChk.addEventListener('change', function () {
          ensureRoleDraftObj().enabled = Boolean(enChk.checked);
          renderRoleDefaultsEditor();
        });
      }
      if (forceChk) {
        forceChk.addEventListener('change', function () {
          var d = ensureRoleDraftObj();
          d.forceForRole = Boolean(forceChk.checked);
          if (d.forceForRole && !d.enabled) {
            d.enabled = true;
            renderRoleDefaultsEditor();
          }
        });
      }
      if (rPreset) {
        rPreset.addEventListener('change', function () {
          var pid = rPreset.value;
          var d = ensureRoleDraftObj();
          var base = uiPresetsMap[pid] || { preset: pid };
          d.uiSimplification = (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings)
            ? root.RGCrmCore.normalizeUiSimplificationSettings(Object.assign({ preset: pid }, base))
            : Object.assign({ preset: pid }, base);
          d.enabled = true;
          renderRoleDefaultsEditor();
        });
      }
      if (rFilter) {
        rFilter.addEventListener('input', function () {
          var q = String(rFilter.value || '').trim().toLowerCase();
          var grid = document.getElementById('role-ui-flags-grid');
          if (!grid) return;
          grid.querySelectorAll('.role-ui-opt-item').forEach(function (lbl) {
            var s = lbl.getAttribute('data-search') || '';
            lbl.classList.toggle('hidden', Boolean(q) && s.indexOf(q) === -1);
          });
          var detailsWrap = grid.closest('details');
          if (q && detailsWrap) detailsWrap.open = true;
        });
      }

      roleEditorBody.querySelectorAll('.role-ui-col-chk').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var d = ensureRoleDraftObj();
          var selected = Array.prototype.slice.call(roleEditorBody.querySelectorAll('.role-ui-col-chk:checked')).map(function (x) { return x.value; });
          if (selected.length === 0) {
            cb.checked = true;
            ctx.toast('يجب الإبقاء على عمود واحد على الأقل.', true);
            return;
          }
          d.visibleCols = selected;
          d.enabled = true;
          renderRoleDefaultsEditor();
        });
      });

      roleEditorBody.querySelectorAll('.role-ui-flag-chk').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var d = ensureRoleDraftObj();
          var nextUi = Object.assign({}, d.uiSimplification || { preset: 'custom' }, { preset: 'custom' });
          roleEditorBody.querySelectorAll('.role-ui-flag-chk').forEach(function (x) {
            nextUi[x.value] = Boolean(x.checked);
          });
          d.uiSimplification = (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings)
            ? root.RGCrmCore.normalizeUiSimplificationSettings(nextUi)
            : nextUi;
          d.enabled = true;
          var cntEl = document.getElementById('role-ui-flags-cnt');
          if (cntEl) {
            var hCnt = uiOptionsList.filter(function (o) { return Boolean(d.uiSimplification[o.key]); }).length;
            cntEl.textContent = hCnt + ' / ' + uiOptionsList.length + ' مخفي';
          }
          if (rPreset) rPreset.value = 'custom';
          if (enChk && !enChk.checked) {
            enChk.checked = true;
            if (roleTabsWrap) renderRoleDefaultsEditor();
          }
        });
      });
    }

    if (roleTabsWrap) {
      roleTabsWrap.querySelectorAll('.rg-role-tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeRoleDefaultTab = btn.getAttribute('data-role-tab') || 'agent';
          renderRoleDefaultsEditor();
        });
      });
    }
    renderRoleDefaultsEditor();

    var previewRoleDefaultsBtn = document.getElementById('btn-preview-role-defaults');
    if (previewRoleDefaultsBtn) {
      previewRoleDefaultsBtn.addEventListener('click', function () {
        if (allowedPreviewRolesSettings.indexOf(activeRoleDefaultTab) === -1) {
          ctx.toast('لا يمكنك محاكاة هذا الدور.', true);
          return;
        }
        var normDraftRoleUi = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
          ? root.RGCrmCore.normalizeRoleUiDefaults(roleUiDefaultsDraft)
          : roleUiDefaultsDraft;
        if (root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
          root.RGApp.startPreviewSession({
            role: activeRoleDefaultTab,
            draftRoleUiDefaults: normDraftRoleUi
          });
        }
      });
    }

    function clearSettingsUnsavedGuard() {
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      } else if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
        root.RGApp.setUnsavedGuard(null);
      }
    }

    async function saveSystemSettingsCore(skipReload) {
      var hoursEl = document.getElementById('set-auto-sync-hours');
      var minutesEl = document.getElementById('set-auto-sync-minutes');
      var rawHours = Number(hoursEl && hoursEl.value !== '' ? hoursEl.value : 0);
      var rawMinutes = Number(minutesEl && minutesEl.value !== '' ? minutesEl.value : 0);
      var autoEnabled = Boolean((document.getElementById('set-auto-sync-enabled') || {}).checked);

      if (autoEnabled && (!isFinite(rawHours) || rawHours <= 0) && (!isFinite(rawMinutes) || rawMinutes <= 0)) {
        ctx.toast('يرجى تحديد مدة لا تقل عن دقيقة واحدة للتحديث التلقائي.', true);
        if (minutesEl) minutesEl.focus();
        return false;
      }

      var normInterval = (root.RGCrmCore && root.RGCrmCore.normalizeAutoSyncInterval)
        ? root.RGCrmCore.normalizeAutoSyncInterval(rawHours, rawMinutes)
        : { hours: Math.max(0, Math.min(168, Math.round(rawHours || 0))), minutes: Math.max(0, Math.min(59, Math.round(rawMinutes || 0))) };

      var nextUiRaw = {
        preset: uiPresetSelect ? uiPresetSelect.value : 'full'
      };
      uiFlagEls.forEach(function (chk) {
        var key = chk.getAttribute('data-ui-key');
        if (key) nextUiRaw[key] = Boolean(chk.checked);
      });
      var normUiSimp = (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings)
        ? root.RGCrmCore.normalizeUiSimplificationSettings(nextUiRaw)
        : nextUiRaw;
      var normRoleDefaults = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
        ? root.RGCrmCore.normalizeRoleUiDefaults(roleUiDefaultsDraft)
        : roleUiDefaultsDraft;

      var excluded = (document.getElementById('set-excluded').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var prevUiSimp = (root.RGApp && root.RGApp.getUiSimplification) ? root.RGApp.getUiSimplification() : null;
      var prevRoleDefaults = (root.RGApp && root.RGApp.getRoleUiDefaults) ? root.RGApp.getRoleUiDefaults() : null;

      if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(normRoleDefaults);
      else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(normRoleDefaults);

      if (ctx.applyUiSimplification) ctx.applyUiSimplification(normUiSimp);
      else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(normUiSimp);

      clearSettingsUnsavedGuard();
      ctx.toast('تم حفظ الإعدادات وإعدادات الأدوار وتحديث المزامنة التلقائية (' + (autoEnabled ? formatIntervalAr(normInterval.hours, normInterval.minutes) : 'متوقف') + ').');

      var res = await root.RGApi.callApi('updateSettings', {
        _keepOptimisticCache: true,
        _spamChecked: true,
        company_name: document.getElementById('set-company').value,
        session_ttl_hours: Number(document.getElementById('set-ttl').value || 24),
        excluded_statuses: excluded,
        allow_agent_view_all: document.getElementById('set-agent-all').checked,
        auto_sync_enabled: autoEnabled,
        auto_sync_interval_hours: normInterval.hours,
        auto_sync_interval_minutes: normInterval.minutes,
        ui_simplification: normUiSimp,
        role_ui_defaults: normRoleDefaults
      });
      if (res.success) {
        var appliedRoleDefaults = (res.data && res.data.role_ui_defaults) ? res.data.role_ui_defaults : normRoleDefaults;
        if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(appliedRoleDefaults);
        else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(appliedRoleDefaults);

        var appliedUi = (res.data && res.data.ui_simplification) ? res.data.ui_simplification : normUiSimp;
        if (ctx.applyUiSimplification) ctx.applyUiSimplification(appliedUi);
        else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(appliedUi);
        if (!skipReload) render(container, ctx);
        return true;
      }
      if (prevRoleDefaults) {
        if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(prevRoleDefaults);
        else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(prevRoleDefaults);
      }
      if (prevUiSimp) {
        if (ctx.applyUiSimplification) ctx.applyUiSimplification(prevUiSimp);
        else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(prevUiSimp);
      }
      ctx.toast(res.message, true);
      return false;
    }

    var sysForm = document.getElementById('sys-settings-form');
    if (sysForm) {
      sysForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var submitBtn = document.getElementById('btn-save-sys-settings');
        runWithLock(submitBtn, 'updateSettings', function () {
          return saveSystemSettingsCore(false);
        });
      });
    }

    var deleteAllBtn = document.getElementById('btn-delete-all-reservations');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', function () {
        openDeleteAllReservationsModal(container, ctx);
      });
    }
    var importExcelBtn = document.getElementById('btn-import-excel-reservations');
    if (importExcelBtn) {
      importExcelBtn.addEventListener('click', function () {
        if (root.RGReservations && typeof root.RGReservations.openImportExcelModal === 'function') {
          root.RGReservations.openImportExcelModal(ctx, function () {
            render(container, ctx);
          });
        }
      });
    }

    var openAnnMgrBtn = document.getElementById('btn-open-announcements-mgr');
    if (openAnnMgrBtn) {
      openAnnMgrBtn.addEventListener('click', function () {
        if (ctx && typeof ctx.openAnnouncementsManager === 'function') {
          ctx.openAnnouncementsManager();
        } else if (root.RGApp && typeof root.RGApp.openAnnouncementsManager === 'function') {
          root.RGApp.openAnnouncementsManager();
        }
      });
    }

    async function saveHandoverSettingsCore(skipReload) {
      var rawNextHo = {
        defaultPreset: (document.getElementById('ho-set-preset') || {}).value || '8h',
        defaultTimeFrom: (document.getElementById('ho-set-time-from') || {}).value || '',
        defaultTimeTo: (document.getElementById('ho-set-time-to') || {}).value || '',
        includeTodayMovements: Boolean((document.getElementById('ho-inc-today') || {}).checked),
        includePending: Boolean((document.getElementById('ho-inc-pending') || {}).checked),
        includeClosed: Boolean((document.getElementById('ho-inc-closed') || {}).checked),
        includeOpenProblems: Boolean((document.getElementById('ho-inc-problems') || {}).checked),
        includeExpiring24h: Boolean((document.getElementById('ho-inc-expiring') || {}).checked),
        autoIncludeNotes: Boolean((document.getElementById('ho-inc-notes') || {}).checked)
      };
      var nextHo = (root.RGCrmCore && root.RGCrmCore.normalizeHandoverSettings)
        ? root.RGCrmCore.normalizeHandoverSettings(rawNextHo)
        : rawNextHo;
      var res = await root.RGApi.callApi('updateSettings', {
        handover_settings: nextHo
      });
      if (res && res.success) {
        var applied = (res.data && res.data.handover_settings) ? res.data.handover_settings : nextHo;
        if (ctx && typeof ctx.setHandoverSettings === 'function') {
          ctx.setHandoverSettings(applied);
        } else if (root.RGApp && typeof root.RGApp.setHandoverSettings === 'function') {
          root.RGApp.setHandoverSettings(applied);
        }
        clearSettingsUnsavedGuard();
        ctx.toast('تم حفظ إعدادات تسليم الوردية وتعميمها بنجاح.');
        if (!skipReload) render(container, ctx);
        return true;
      }
      ctx.toast((res && res.message) || 'تعذر حفظ إعدادات تسليم الوردية.', true);
      return false;
    }

    var hoForm = document.getElementById('set-handover-card');
    if (hoForm) {
      hoForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var saveHoBtn = document.getElementById('btn-save-handover-settings');
        runWithLock(saveHoBtn, 'updateHandoverSettings', function () {
          return saveHandoverSettingsCore(false);
        });
      });
    }

    function captureSysSnapshot() {
      if (!sysForm) return '';
      var uiFlags = {};
      uiFlagEls.forEach(function (chk) {
        var k = chk.getAttribute('data-ui-key');
        if (k) uiFlags[k] = Boolean(chk.checked);
      });
      return JSON.stringify({
        company: (document.getElementById('set-company') || {}).value || '',
        ttl: (document.getElementById('set-ttl') || {}).value || '',
        excluded: (document.getElementById('set-excluded') || {}).value || '',
        agentAll: Boolean((document.getElementById('set-agent-all') || {}).checked),
        autoEnabled: Boolean((document.getElementById('set-auto-sync-enabled') || {}).checked),
        autoHours: (document.getElementById('set-auto-sync-hours') || {}).value || '0',
        autoMinutes: (document.getElementById('set-auto-sync-minutes') || {}).value || '0',
        uiPreset: uiPresetSelect ? uiPresetSelect.value : 'full',
        uiFlags: uiFlags,
        roleUiDefaults: roleUiDefaultsDraft
      });
    }
    function captureHoSnapshot() {
      if (!hoForm) return '';
      return JSON.stringify({
        preset: (document.getElementById('ho-set-preset') || {}).value || '8h',
        timeFrom: (document.getElementById('ho-set-time-from') || {}).value || '',
        timeTo: (document.getElementById('ho-set-time-to') || {}).value || '',
        today: Boolean((document.getElementById('ho-inc-today') || {}).checked),
        pending: Boolean((document.getElementById('ho-inc-pending') || {}).checked),
        closed: Boolean((document.getElementById('ho-inc-closed') || {}).checked),
        problems: Boolean((document.getElementById('ho-inc-problems') || {}).checked),
        expiring: Boolean((document.getElementById('ho-inc-expiring') || {}).checked),
        notes: Boolean((document.getElementById('ho-inc-notes') || {}).checked)
      });
    }
    var initialSysSnapshot = captureSysSnapshot();
    var initialHoSnapshot = captureHoSnapshot();

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: 'إعدادات النظام والأدوار',
        isDirty: function () {
          if (!container || !container.isConnected) return false;
          var tokEl = document.getElementById('set-rg-token');
          if (tokEl && String(tokEl.value || '').trim().length > 0) return true;
          if (sysForm && captureSysSnapshot() !== initialSysSnapshot) return true;
          if (hoForm && captureHoSnapshot() !== initialHoSnapshot) return true;
          return false;
        },
        onSave: async function () {
          var ok = true;
          if (sysForm && captureSysSnapshot() !== initialSysSnapshot) {
            ok = await saveSystemSettingsCore(true);
            if (!ok) return false;
            initialSysSnapshot = captureSysSnapshot();
          }
          if (hoForm && captureHoSnapshot() !== initialHoSnapshot) {
            ok = await saveHandoverSettingsCore(true);
            if (!ok) return false;
            initialHoSnapshot = captureHoSnapshot();
          }
          clearSettingsUnsavedGuard();
          return true;
        },
        onDiscard: function () {
          clearSettingsUnsavedGuard();
        }
      });
    }
  }

  function openDeleteAllReservationsModal(container, ctx) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var requiredPhrase = (root.RGCrmCore && root.RGCrmCore.DELETE_ALL_RESERVATIONS_PHRASE) || 'حذف جميع الحجوزات';
    var nowDate = new Date();
    var curYear = String(nowDate.getFullYear());
    var curMonth = curYear + '-' + String(nowDate.getMonth() + 1).padStart(2, '0');

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="delete-all-reservations-modal" role="dialog" aria-modal="true" aria-labelledby="del-all-res-title">' +
        '<form class="modal-panel" id="del-all-res-form" style="max-width:560px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="del-all-res-title" style="color:var(--status-danger-text, #f43f5e);">تأكيد أمان: حذف الحجوزات وتصدير نسخة Excel تلقائياً</h3>' +
            '<button type="button" class="btn btn-sm" id="del-all-res-close" data-modal-close aria-label="إغلاق">إغلاق</button>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:14px;">' +
            '<div style="padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--status-danger-border);background:var(--status-danger-bg);font-size:13px;line-height:1.7;">' +
              '<strong style="color:var(--status-danger-text, #f43f5e);display:block;margin-bottom:4px;">تحذير أمني هام — سيتم تصدير نسخة Excel تلقائياً قبل الحذف النهائي</strong>' +
              'اختر نطاق الحذف (شهر محدد أو سنة محددة أو جميع الحجوزات). يتم تنزيل ملف Excel بالحجوزات المحذوفة تلقائياً عند إتمام الحذف.' +
            '</div>' +

            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);display:flex;flex-direction:column;gap:10px;">' +
              '<label class="form-label" style="margin:0;">نطاق الحذف المطلوب</label>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                '<label class="checkbox-item" style="margin:0;"><input type="radio" name="del-res-scope" value="all" checked> <span>حذف جميع الحجوزات</span></label>' +
                '<label class="checkbox-item" style="margin:0;"><input type="radio" name="del-res-scope" value="month"> <span>حذف شهر محدد</span></label>' +
                '<label class="checkbox-item" style="margin:0;"><input type="radio" name="del-res-scope" value="year"> <span>حذف سنة محددة</span></label>' +
              '</div>' +
              '<div id="del-res-month-wrap" class="form-group hidden" style="margin:0;">' +
                '<label class="form-label" for="del-res-month">اختر الشهر (YYYY-MM)</label>' +
                '<input type="month" class="input mono" id="del-res-month" dir="ltr" value="' + curMonth + '">' +
              '</div>' +
              '<div id="del-res-year-wrap" class="form-group hidden" style="margin:0;">' +
                '<label class="form-label" for="del-res-year">أدخل السنة (YYYY)</label>' +
                '<input type="number" class="input mono" id="del-res-year" dir="ltr" min="2000" max="2100" value="' + curYear + '">' +
              '</div>' +
              '<div id="del-res-scope-preview" style="font-size:12.5px;font-weight:700;color:var(--brand-primary);">جاري احتساب السجلات المطابقة...</div>' +
            '</div>' +

            '<label class="checkbox-item" style="font-weight:600;align-items:flex-start;line-height:1.6;">' +
              '<input type="checkbox" id="del-all-res-ack">' +
              '<span>أقر بأنني أتحمل مسؤولية حذف الحجوزات ضمن النطاق المحدد وأدرك أنه لا يمكن التراجع عن هذا الإجراء.</span>' +
            '</label>' +
            '<div class="form-group">' +
              '<label class="form-label" for="del-all-res-phrase">اكتب عبارة التأكيد التالية بدقة: <strong class="mono" style="color:var(--status-danger-text, #f43f5e);user-select:all;">' + escapeHtml(requiredPhrase) + '</strong></label>' +
              '<input type="text" class="input" id="del-all-res-phrase" autocomplete="off" spellcheck="false" placeholder="اكتب: ' + escapeHtml(requiredPhrase) + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="del-all-res-password">كلمة مرور حسابك الحالي (للتحقق الأمني)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="del-all-res-password" dir="ltr" autocomplete="current-password" placeholder="أدخل كلمة مرور حسابك">' +
                '<button type="button" class="password-toggle-btn" id="toggle-del-all-res-password" aria-label="إظهار كلمة المرور">إظهار</button>' +
              '</div>' +
            '</div>' +
            '<div id="del-all-res-error" class="form-error hidden" role="alert"></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="del-all-res-cancel" data-modal-close>إلغاء</button>' +
            '<button type="submit" class="btn btn-danger" id="del-all-res-confirm" disabled>تأكيد الحذف وتصدير Excel</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    bindPasswordToggle('del-all-res-password', 'toggle-del-all-res-password');

    var ackEl = document.getElementById('del-all-res-ack');
    var phraseEl = document.getElementById('del-all-res-phrase');
    var pwdEl = document.getElementById('del-all-res-password');
    var errEl = document.getElementById('del-all-res-error');
    var confirmBtn = document.getElementById('del-all-res-confirm');
    var formEl = document.getElementById('del-all-res-form');
    var monthWrap = document.getElementById('del-res-month-wrap');
    var yearWrap = document.getElementById('del-res-year-wrap');
    var monthInput = document.getElementById('del-res-month');
    var yearInput = document.getElementById('del-res-year');
    var previewEl = document.getElementById('del-res-scope-preview');
    var previewSeq = 0;
    var hasZeroMatches = false;

    function getScopePayload() {
      var checkedRadio = formEl.querySelector('input[name="del-res-scope"]:checked');
      var sc = checkedRadio ? checkedRadio.value : 'all';
      var ymVal = monthInput ? String(monthInput.value || '').trim() : '';
      return {
        scope: sc,
        yearMonth: sc === 'month' ? ymVal : '',
        month: ymVal,
        year: yearInput ? String(yearInput.value || '').trim() : ''
      };
    }

    async function refreshScopePreview() {
      var seq = ++previewSeq;
      var sc = getScopePayload();
      if (monthWrap) monthWrap.classList.toggle('hidden', sc.scope !== 'month');
      if (yearWrap) yearWrap.classList.toggle('hidden', sc.scope !== 'year');
      if (previewEl) {
        previewEl.style.color = 'var(--brand-primary)';
        previewEl.textContent = 'جاري احتساب السجلات المطابقة...';
      }
      try {
        var prevRes = await root.RGApi.callApi('previewDeleteReservations', sc);
        if (seq !== previewSeq || !previewEl || !previewEl.isConnected) return;
        if (prevRes && prevRes.success && prevRes.data) {
          var c = Number(prevRes.data.count || 0);
          var tot = Number(prevRes.data.totalReservations || 0);
          var scopeTxt = sc.scope === 'month' ? ('لشهر ' + (sc.month || '-')) : (sc.scope === 'year' ? ('لسنة ' + (sc.year || '-')) : 'الكل');
          hasZeroMatches = c <= 0;
          if (hasZeroMatches) {
            previewEl.style.color = 'var(--status-warning-text, #d97706)';
            previewEl.textContent = 'لا توجد حجوزات مطابقة (' + scopeTxt + ') من أصل ' + tot + ' حجز — لا يوجد ما يتم حذفه.';
          } else {
            previewEl.style.color = 'var(--brand-primary)';
            previewEl.textContent = 'السجلات المطابقة (' + scopeTxt + '): ' + c + ' من أصل ' + tot + ' حجز — سيتم تصدير نسخة Excel تلقائياً عند الحذف.';
          }
        } else {
          hasZeroMatches = false;
          previewEl.style.color = 'var(--text-muted)';
          previewEl.textContent = 'تعذر معاينة عدد السجلات.';
        }
      } catch (_e) {
        if (seq === previewSeq && previewEl) {
          hasZeroMatches = false;
          previewEl.style.color = 'var(--text-muted)';
          previewEl.textContent = 'تعذر معاينة عدد السجلات.';
        }
      }
      updateConfirmValidity(false);
    }

    formEl.querySelectorAll('input[name="del-res-scope"]').forEach(function (rad) {
      rad.addEventListener('change', refreshScopePreview);
    });
    if (monthInput) monthInput.addEventListener('change', refreshScopePreview);
    if (yearInput) yearInput.addEventListener('input', refreshScopePreview);
    refreshScopePreview();

    function closeModal() {
      if (modalRoot) modalRoot.innerHTML = '';
    }

    var closeBtn = document.getElementById('del-all-res-close');
    var cancelBtn = document.getElementById('del-all-res-cancel');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    function updateConfirmValidity(clearError) {
      var isAck = Boolean(ackEl && ackEl.checked);
      var phraseVal = phraseEl ? String(phraseEl.value || '').trim() : '';
      var pwdVal = pwdEl ? String(pwdEl.value || '') : '';
      var ready = !hasZeroMatches && isAck && phraseVal === requiredPhrase && pwdVal.length > 0;
      if (confirmBtn) confirmBtn.disabled = !ready;
      if (clearError && errEl && !errEl.classList.contains('hidden')) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
      }
    }

    if (ackEl) ackEl.addEventListener('change', function () { updateConfirmValidity(true); });
    if (phraseEl) phraseEl.addEventListener('input', function () { updateConfirmValidity(true); });
    if (pwdEl) pwdEl.addEventListener('input', function () { updateConfirmValidity(true); });

    if (formEl) {
      formEl.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var scPayload = getScopePayload();
        var payload = Object.assign({}, scPayload, {
          acknowledged: Boolean(ackEl && ackEl.checked),
          confirmPhrase: phraseEl ? String(phraseEl.value || '').trim() : '',
          password: pwdEl ? String(pwdEl.value || '') : ''
        });
        if (root.RGCrmCore && root.RGCrmCore.validateDeleteAllReservationsConfirmation) {
          var check = root.RGCrmCore.validateDeleteAllReservationsConfirmation(payload);
          if (!check.valid) {
            if (errEl) {
              errEl.textContent = check.message;
              errEl.classList.remove('hidden');
            }
            return;
          }
        }

        runWithLock(confirmBtn, 'deleteAllReservations', async function () {
          var prevText = confirmBtn ? confirmBtn.textContent : '';
          if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'جاري الحذف وتصدير Excel...';
          }
          try {
            var res = await root.RGApi.callApi('deleteAllReservations', payload);
            if (res && res.success) {
              var count = (res.data && res.data.deletedReservationsCount) || 0;
              var exportedRows = (res.data && Array.isArray(res.data.exportedRows)) ? res.data.exportedRows : [];
              var autoExported = false;
              var exportFailed = false;
              if (exportedRows.length > 0 && root.RGReports && typeof root.RGReports.exportExcelWorkbook === 'function') {
                try {
                  var tag = scPayload.scope === 'month' ? ('month-' + scPayload.month) : (scPayload.scope === 'year' ? ('year-' + scPayload.year) : 'all');
                  var fname = 'rental-gate-deleted-' + tag + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
                  var cols = Array.isArray(root.RGReports.RESERVATION_COLUMNS) ? root.RGReports.RESERVATION_COLUMNS.slice() : Object.keys(exportedRows[0] || {});
                  await root.RGReports.exportExcelWorkbook([{
                    name: 'Deleted_Reservations',
                    headers: cols,
                    rows: exportedRows
                  }], fname);
                  autoExported = true;
                } catch (_expErr) {
                  exportFailed = true;
                }
              }
              closeModal();
              if (exportFailed) {
                ctx.toast('تم حذف ' + count + ' حجز، لكن تعذر تنزيل ملف Excel التلقائي.', true);
              } else {
                ctx.toast(
                  autoExported
                    ? ('تم حذف ' + count + ' حجز وتصدير نسخة Excel الاحتياطية تلقائياً.')
                    : ('تم حذف ' + count + ' حجز وتنظيف الذاكرة المؤقتة بنجاح.')
                );
              }
              render(container, ctx);
              return;
            }
            if (errEl) {
              var rawMsg = String((res && res.message) || 'تعذر تنفيذ عملية الحذف.');
              errEl.textContent = rawMsg.replace(/^(VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN):\s*/i, '');
              errEl.classList.remove('hidden');
            }
          } finally {
            if (confirmBtn && confirmBtn.isConnected !== false) {
              confirmBtn.textContent = prevText;
              updateConfirmValidity(false);
            }
          }
        });
      });
    }
  }

  root.RGSettings = {
    render: render
  };
})(window);
