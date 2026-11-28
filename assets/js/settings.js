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
    var isDeveloperUser = Boolean(user && root.RGCrmCore && root.RGCrmCore.ROLES && user.role === root.RGCrmCore.ROLES.DEVELOPER);
    var canAccessApi = root.RGCrmCore.canAccessApi(user);
    var canSync = root.RGCrmCore.canUserPerform(user, 'sync_data');
    var canManageSettings = root.RGCrmCore.canUserPerform(user, 'manage_settings');
    var canCustomizeUi = Boolean(user && (
      user.role === 'developer' ||
      user.role === 'general_manager' ||
      root.RGCrmCore.canUserPerform(user, 'customize_ui') ||
      root.RGCrmCore.canUserPerform(user, 'manage_role_ui_defaults')
    ));
    var canManageRoleUiDefaults = canCustomizeUi || canManageSettings;
    var canManageCustomerNotesAdmin = Boolean(isDeveloperUser || canManageSettings || (root.RGCrmCore && (
      root.RGCrmCore.canUserPerform(user, 'manage_customer_notes_settings') ||
      root.RGCrmCore.canUserPerform(user, 'manage_customer_note_statuses') ||
      root.RGCrmCore.canUserPerform(user, 'manage_customer_notes_buttons')
    )));
    var cachedEmpData = root.RGApi.getCachedData ? root.RGApi.getCachedData('getEmployees', {}, true) : null;
    var personalCardHtml = buildPersonalAccountCardHtml(user, ctx);

    if (!canAccessApi && !canManageSettings && !canManageRoleUiDefaults && !canManageCustomerNotesAdmin) {
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
    var syncLogs = Array.isArray(syncData.logs) ? syncData.logs : [];
    var caps = (capsRes && capsRes.success && capsRes.data) ? capsRes.data : {};
    var lastSync = syncData.lastSync || null;

    var autoSyncEnabled = settings.auto_sync_enabled !== undefined ? Boolean(settings.auto_sync_enabled) : (syncData.autoSyncEnabled !== false);
    var autoSyncNorm = (root.RGCrmCore && root.RGCrmCore.normalizeAutoSyncIntervalSeconds)
      ? root.RGCrmCore.normalizeAutoSyncIntervalSeconds({
          auto_sync_interval_seconds: settings.auto_sync_interval_seconds !== undefined ? settings.auto_sync_interval_seconds : syncData.autoSyncIntervalSeconds,
          auto_sync_interval_value: settings.auto_sync_interval_value !== undefined ? settings.auto_sync_interval_value : syncData.autoSyncIntervalValue,
          auto_sync_interval_unit: settings.auto_sync_interval_unit !== undefined ? settings.auto_sync_interval_unit : syncData.autoSyncIntervalUnit,
          auto_sync_interval_hours: settings.auto_sync_interval_hours !== undefined ? settings.auto_sync_interval_hours : syncData.autoSyncIntervalHours,
          auto_sync_interval_minutes: settings.auto_sync_interval_minutes !== undefined ? settings.auto_sync_interval_minutes : syncData.autoSyncIntervalMinutes
        })
      : { intervalSeconds: 43200, value: 12, unit: 'hours', hours: 12, minutes: 0 };
    var formatIntervalSecondsAr = function (secOrObj) {
      if (root.RGCrmCore && root.RGCrmCore.formatAutoSyncIntervalSecondsAr) {
        return root.RGCrmCore.formatAutoSyncIntervalSecondsAr(secOrObj);
      }
      var sVal = typeof secOrObj === 'number' ? secOrObj : autoSyncNorm.intervalSeconds;
      if (sVal < 60) return 'كل ' + sVal + ' ثانية';
      if (sVal < 3600) return 'كل ' + Math.round(sVal / 60) + ' دقيقة';
      return 'كل ' + Math.round(sVal / 3600) + ' ساعة';
    };
    var autoSyncBadgeText = autoSyncEnabled ? ('مفعل — ' + formatIntervalSecondsAr(autoSyncNorm.intervalSeconds)) : 'متوقف حاليًا';
    var workerTelemetry = (syncData && syncData.worker && typeof syncData.worker === 'object')
      ? syncData.worker
      : {
          status: autoSyncEnabled ? ((syncData.consecutiveErrors > 0 && syncData.lastError) ? 'error' : 'running') : 'stopped',
          isSyncing: Boolean(syncData.isSyncing),
          autoSyncEnabled: autoSyncEnabled,
          intervalSeconds: autoSyncNorm.intervalSeconds,
          intervalValue: autoSyncNorm.value,
          intervalUnit: autoSyncNorm.unit,
          lastRunAt: syncData.lastRunAt || (lastSync && (lastSync.startedAt || lastSync.finishedAt)) || '',
          lastSuccessAt: syncData.lastSuccessAt || '',
          nextRunAt: autoSyncEnabled ? (syncData.nextRunAt || '') : null,
          lastDurationMs: Number(syncData.lastDurationMs || (lastSync && lastSync.durationMs) || 0),
          importedCount: Number(lastSync ? lastSync.importedCount : 0),
          updatedCount: Number(lastSync ? lastSync.updatedCount : 0),
          extensionsCount: Number(lastSync ? lastSync.extensionsCount : 0),
          errorCount: Number(syncData.errorCount || 0),
          consecutiveErrors: Number(syncData.consecutiveErrors || 0),
          lastError: String(syncData.lastError || ''),
          lastTriggerType: ''
        };
    var autoSyncQuickPresets = [
      { value: 1, unit: 'seconds', label: 'كل ثانية' },
      { value: 5, unit: 'seconds', label: '5 ثوانٍ' },
      { value: 15, unit: 'seconds', label: '15 ثانية' },
      { value: 30, unit: 'seconds', label: '30 ثانية' },
      { value: 1, unit: 'minutes', label: 'دقيقة واحدة' },
      { value: 5, unit: 'minutes', label: '5 دقائق' },
      { value: 15, unit: 'minutes', label: '15 دقيقة' },
      { value: 1, unit: 'hours', label: 'ساعة واحدة' },
      { value: 6, unit: 'hours', label: '6 ساعات' },
      { value: 12, unit: 'hours', label: '12 ساعة' }
    ];

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
    var canViewDevIntegrity = Boolean(isDeveloperUser && root.RGCrmCore && root.RGCrmCore.canUserPerform(user, 'manage_developer_tools'));
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
      { key: 'customerIdNumber', label: 'رقم الهوية' },
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
        '</div>' +
        '<div class="surface-card rg-dev-shortcuts-card" id="dev-call-shortcuts-card">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">تحكم المبرمج في اختصارات نافذة ما بعد الاتصال</h2>' +
              '<p class="section-subtitle">أضف اختصارات جديدة، عدّل التسميات أو الحالة المرتبطة، رتب الأزرار، أو احذف أي اختصار يظهر للفريق بعد الضغط على زر الاتصال.</p>' +
            '</div>' +
            '<span class="status-tag status-info">CALL SHORTCUTS</span>' +
          '</div>' +
          '<div id="dev-call-shortcuts-host"></div>' +
        '</div>' +
        (canViewDevIntegrity ? (
          '<div class="surface-card" id="dev-outbox-preview-card" style="border-top:3px solid var(--brand-primary);margin-bottom:16px;">' +
            '<div class="section-header">' +
              '<div>' +
                '<h2 class="section-title">معاينة Outbox والتحكم في مزامنة Google Sheets وتدقيق التواريخ (Phase 1–2 Preview)</h2>' +
                '<p class="section-subtitle">وضع معاينة وقراءة فقط (Read-Only): تحليل طابور sheets_mirror_outbox وحجم البيانات المؤرشفة المقدّر وحالة المزامنة وتدقيق closed_at بدون أي حذف أو تعديل فعلي.</p>' +
              '</div>' +
              '<span class="status-tag status-warning">PHASE 2 PREVIEW ONLY</span>' +
            '</div>' +
            '<div id="dev-outbox-preview-host"><div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></div>' +
          '</div>' +
          '<div class="surface-card" id="dev-health-center-card" style="border-top:3px solid var(--brand-primary);margin-bottom:16px;">' +
            '<div class="section-header">' +
              '<div>' +
                '<h2 class="section-title">Database Health Center — مركز صحة قاعدة البيانات</h2>' +
                '<p class="section-subtitle">مراقبة حقيقية وشاملة لصحة Neon PostgreSQL، تطابق الجداول والأعمدة والقيود، سلامة البيانات مقارنة بـ Rental Gate API، وسلامة المزامنة وOutbox (مخصص للمبرمج فقط).</p>' +
              '</div>' +
              '<span class="status-tag status-danger">DEVELOPER ONLY</span>' +
            '</div>' +
            '<div id="dev-health-center-host"><div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></div>' +
          '</div>' +
          '<div class="surface-card" id="dev-integrity-card" style="border-top:3px solid var(--brand-primary);margin-bottom:16px;">' +
            '<div class="section-header">' +
              '<div>' +
                '<h2 class="section-title">مراقبة سلامة البيانات ومقارنة RG API وNeon PostgreSQL</h2>' +
                '<p class="section-subtitle">أداة مخصصة للمبرمج فقط لمقارنة بيانات الحجوزات والتمديدات والإلغاءات وتعديلات الشركات بين المصدر وقاعدة البيانات، مع معاينة الفروقات والموافقة الصريحة والتراجع.</p>' +
              '</div>' +
              '<span class="status-tag status-danger">DEVELOPER ONLY</span>' +
            '</div>' +
            '<div id="dev-integrity-host"><div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></div>' +
          '</div>'
        ) : '')
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
          '<button type="button" class="btn" id="btn-check-app-update">فحص التحديثات الآن</button>' +
          '<button type="button" class="btn" id="btn-show-sync-diagnostics">سجل التحديث والمزامنة</button>' +
          '<button type="button" class="btn btn-danger" id="btn-clear-browser-cache">مسح كاش المتصفح بالكامل</button>' +
        '</div>' +

        '<div id="conn-test-results" class="hidden" style="margin-top:12px;display:grid;gap:8px;"></div>' +
        '<div id="sync-diag-results" class="hidden" style="margin-top:10px;display:grid;gap:6px;"></div>' +
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

      ((canSync || canManageSettings) ? (
        '<div class="surface-card" id="settings-sync-card">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">السحب التلقائي ومراقبة المزامنة — Rental Gate API</h2>' +
              '<p class="section-subtitle">يعمل السحب التلقائي في الخلفية عبر الخادم وقاعدة بيانات Neon PostgreSQL بشكل مستقل تماماً عن فتح المتصفح · الكاش المحلي: <strong class="tabular-nums">' + cacheStats.reservationsCount + '</strong> حجز · <strong class="tabular-nums">' + cacheStats.customersCount + '</strong> عميل</p>' +
            '</div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn" id="btn-test-rg">اختبار الاتصال بـ Rental Gate</button>' +
              (canSync ? '<button type="button" class="btn btn-primary" id="btn-sync-now">سحب فوري الآن</button>' : '') +
            '</div>' +
          '</div>' +

          '<div class="rg-sync-monitor-panel" id="sync-monitor-panel" aria-live="polite">' +
            '<div class="rg-sync-monitor-head">' +
              '<div class="rg-sync-monitor-title-wrap">' +
                '<h3 class="rg-sync-monitor-title">لوحة مراقبة المزامنة</h3>' +
                '<span class="rg-sync-monitor-sub">تحديث لحظي تلقائي لحالة السحب في الخلفية دون إعادة تحميل الصفحة</span>' +
              '</div>' +
              '<div class="rg-sync-monitor-badges">' +
                '<span class="status-tag ' + (workerTelemetry.status === 'stopped' ? 'status-warning' : (workerTelemetry.status === 'error' ? 'status-danger' : 'status-success')) + '" id="sync-monitor-status-badge">' +
                  (workerTelemetry.status === 'stopped' ? 'متوقف' : (workerTelemetry.status === 'error' ? 'خطأ' : 'يعمل')) +
                '</span>' +
                '<span class="status-tag status-info rg-sync-pulling-pill' + (workerTelemetry.isSyncing ? '' : ' hidden') + '" id="sync-monitor-active-pill">جاري السحب الآن...</span>' +
              '</div>' +
            '</div>' +

            '<div class="rg-sync-monitor-grid">' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">حالة السحب التلقائي</span>' +
                '<strong class="rg-sync-metric-v" id="sync-monitor-state-text">' +
                  (workerTelemetry.status === 'stopped' ? 'متوقف' : (workerTelemetry.status === 'error' ? 'خطأ — إعادة محاولة مجدولة' : 'يعمل تلقائياً')) +
                '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">الفترة الزمنية المحددة</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-interval">' + escapeHtml(formatIntervalSecondsAr(workerTelemetry.intervalSeconds || autoSyncNorm.intervalSeconds)) + '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">وقت آخر مزامنة</span>' +
                '<strong class="rg-sync-metric-v mono tabular-nums" dir="ltr" id="sync-monitor-last-run">' + (workerTelemetry.lastRunAt ? escapeHtml(formatSettingDateTime(workerTelemetry.lastRunAt, ctx)) : 'لم يتم السحب بعد') + '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">المزامنة القادمة / العد التنازلي</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-next-run">' +
                  (autoSyncEnabled && workerTelemetry.nextRunAt
                    ? ('<span id="sync-monitor-countdown" class="mono rg-sync-countdown-main" dir="ltr">...</span><span class="rg-sync-next-ts mono" dir="ltr">' + escapeHtml(formatSettingDateTime(workerTelemetry.nextRunAt, ctx)) + '</span>')
                    : 'متوقف') +
                '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">الحجوزات الجديدة</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-imported">' + Number(workerTelemetry.importedCount || 0) + '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">الحجوزات المحدثة</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-updated">' + Number(workerTelemetry.updatedCount || 0) + '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">التمديدات الجديدة</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-extensions">' + Number(workerTelemetry.extensionsCount || 0) + '</strong>' +
              '</div>' +
              '<div class="rg-sync-metric-card">' +
                '<span class="rg-sync-metric-k">الأخطاء / مدة آخر عملية</span>' +
                '<strong class="rg-sync-metric-v tabular-nums" id="sync-monitor-errors-duration">' +
                  Number(workerTelemetry.errorCount || 0) + ' خطأ · ' +
                  (Number(workerTelemetry.lastDurationMs || 0) > 0 ? ((Number(workerTelemetry.lastDurationMs) / 1000).toFixed(1) + ' ث') : '-') +
                '</strong>' +
              '</div>' +
            '</div>' +

            '<div class="rg-sync-error-banner' + (workerTelemetry.lastError ? '' : ' hidden') + '" id="sync-monitor-error-box" role="alert">' +
              '<strong>آخر رسالة خطأ:</strong> <span id="sync-monitor-last-error">' + escapeHtml(workerTelemetry.lastError || '') + '</span>' +
            '</div>' +
          '</div>' +

          (canManageSettings ? (
            '<form class="rg-autosync-settings-box" id="auto-sync-settings-form" novalidate>' +
              '<div class="rg-autosync-settings-head">' +
                '<div>' +
                  '<h3 class="rg-autosync-title">إعدادات المزامنة التلقائية <span dir="ltr">(Automatic Sync Settings)</span></h3>' +
                  '<p class="rg-autosync-subtitle">تحكم مرن بفترة السحب من ثانية واحدة وحتى 12 ساعة · تُحفظ في Neon PostgreSQL وتُطبَّق فوراً لجميع المستخدمين والأجهزة دون إعادة تشغيل.</p>' +
                '</div>' +
                '<label class="rg-autosync-toggle" for="set-auto-sync-enabled">' +
                  '<input type="checkbox" id="set-auto-sync-enabled"' + (autoSyncEnabled ? ' checked' : '') + '>' +
                  '<span>تفعيل السحب التلقائي</span>' +
                '</label>' +
              '</div>' +

              '<div class="rg-autosync-inputs-grid">' +
                '<div class="form-group">' +
                  '<label class="form-label" for="set-auto-sync-value">الفترة الزمنية (قيمة مخصصة)</label>' +
                  '<input class="input tabular-nums" type="number" min="1" step="1" id="set-auto-sync-value" value="' + escapeHtml(autoSyncNorm.value) + '" placeholder="مثال: 15">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label class="form-label" for="set-auto-sync-unit">وحدة الزمن</label>' +
                  '<select class="select" id="set-auto-sync-unit">' +
                    '<option value="seconds"' + (autoSyncNorm.unit === 'seconds' ? ' selected' : '') + '>الثواني</option>' +
                    '<option value="minutes"' + (autoSyncNorm.unit === 'minutes' ? ' selected' : '') + '>الدقائق</option>' +
                    '<option value="hours"' + (autoSyncNorm.unit === 'hours' ? ' selected' : '') + '>الساعات</option>' +
                  '</select>' +
                '</div>' +
                '<div class="form-group rg-autosync-preview-group">' +
                  '<span class="form-label">معاينة الجدولة</span>' +
                  '<div class="rg-autosync-preview-box" id="auto-sync-live-preview">' + escapeHtml(autoSyncBadgeText) + '</div>' +
                '</div>' +
              '</div>' +

              '<div class="rg-autosync-presets-wrap">' +
                '<span class="form-label">اختصارات سريعة (اختياري — يمكن إدخال أي قيمة مخصصة أعلاه)</span>' +
                '<div class="rg-autosync-presets-row" id="auto-sync-presets-row">' +
                  autoSyncQuickPresets.map(function (pr) {
                    var isMatch = Number(autoSyncNorm.value) === Number(pr.value) && autoSyncNorm.unit === pr.unit;
                    return '<button type="button" class="btn btn-sm auto-sync-preset' + (isMatch ? ' btn-primary' : '') + '" data-value="' + pr.value + '" data-unit="' + pr.unit + '">' + escapeHtml(pr.label) + '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +

              '<div id="auto-sync-validation-msg" class="hidden" role="alert" style="margin-top:8px;"></div>' +

              '<div class="rg-autosync-footer">' +
                '<span class="rg-autosync-hint">الحد المسموح: من <strong>ثانية واحدة</strong> (1 ثانية) وحتى <strong>12 ساعة</strong> (43,200 ثانية).</span>' +
                '<button type="submit" class="btn btn-primary" id="btn-save-auto-sync">حفظ إعدادات المزامنة التلقائية</button>' +
              '</div>' +
            '</form>'
          ) : (
            '<div class="detail-summary-grid" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">' +
              '<div class="detail-kv"><span class="detail-k">جدولة المزامنة التلقائية</span><span class="detail-v" id="sync-auto-badge-ro">' + escapeHtml(autoSyncBadgeText) + '</span></div>' +
            '</div>'
          )) +

          (isGeneralManager && canSync ? (
            '<div class="gm-pull-bar" id="sync-gm-pull-bar" style="margin-bottom:14px;">' +
              '<span class="gm-pull-label">تخصيص مدة السحب الفوري (المدير العام):</span>' +
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

          '<div class="detail-summary-grid" style="margin-bottom:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">' +
            '<div class="detail-kv"><span class="detail-k">حالة توكن Rental Gate</span><span class="detail-v" id="sync-conn-status">' + (isBackendConnected || root.RGApi.isLiveMode() ? (hasRgToken ? 'مضبوط ومربوط في الخادم' : 'غير مضبوط في متغيرات البيئة') : 'وضع المعاينة المحلية') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + escapeHtml(autoSyncBadgeText) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono" dir="ltr" id="sync-summary-last-pull">' + (lastSync ? escapeHtml(formatSettingDateTime(lastSync.finishedAt, ctx)) : 'لم يتم السحب بعد') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">ملخص آخر سحب (جديد / محدث / تمديد)</span><span class="detail-v tabular-nums" id="sync-summary-counts">' + (lastSync ? (lastSync.importedCount + ' جديد · ' + lastSync.updatedCount + ' محدث · ' + lastSync.extensionsCount + ' تمديد') : '0 / 0 / 0') + '</span></div>' +
          '</div>' +

          '<div id="sync-reconciliation-host">' +
          (function () {
            var rec = syncData.lastReconciliation;
            if (!rec || typeof rec !== 'object') return '';
            var failedCnt = Number(rec.failedCount || 0);
            var missingCnt = Number(rec.missingLocalCount || 0);
            var eligibleGap = Number(rec.eligibleCountGap || 0);
            var unfetchedGap = Number(rec.unfetchedSourceGap || 0);
            var incEps = Array.isArray(rec.incompleteEndpoints) ? rec.incompleteEndpoints : [];
            var bfFailed = Array.isArray(rec.backfillFailedIds) ? rec.backfillFailedIds : [];
            var missingIds = Array.isArray(rec.missingSourceIds) ? rec.missingSourceIds : [];
            var missingEligIds = Array.isArray(rec.missingEligibleIds) ? rec.missingEligibleIds : [];
            var failedRecs = Array.isArray(rec.failedRecords) ? rec.failedRecords : [];
            var sb = rec.sourceBreakdown || null;
            var srcElig = Number(rec.sourceEligibleCount !== undefined ? rec.sourceEligibleCount : ((sb && sb.sourceEligibleCount) || 0));
            var dbElig = Number(rec.dbEligibleCount !== undefined ? rec.dbEligibleCount : 0);
            var recIncomplete = rec.syncComplete === false || failedCnt > 0 || missingCnt > 0 || eligibleGap > 0 || missingEligIds.length > 0 || unfetchedGap > 0 || incEps.length > 0 || bfFailed.length > 0;
            var parts = [];
            if (sb && Number(sb.uniqueSourceTotal || 0) > 0) {
              parts.push('إجمالي المصدر الفريد: <strong>' + Number(sb.uniqueSourceTotal) + '</strong>');
              var canListCnt = Number(sb.cancelledListCount !== undefined ? sb.cancelledListCount : (sb.effectiveCancelledCount || 0));
              var rejListCnt = Number(sb.rejectedListCount !== undefined ? sb.rejectedListCount : (sb.effectiveRejectedCount || 0));
              parts.push('التصنيف: <strong>' + Number(sb.activeOrOtherCount || 0) + '</strong> مستحق · <strong>' + canListCnt + '</strong> ملغي · <strong>' + rejListCnt + '</strong> مرفوض');
            } else if (Number(rec.totalInSource || 0) > 0) {
              parts.push('إجمالي المصدر: <strong>' + Number(rec.totalInSource) + '</strong>');
            }
            if (srcElig > 0 || dbElig > 0) {
              parts.push('المستحقة (CRM / المصدر): <strong style="color:' + (eligibleGap === 0 && missingEligIds.length === 0 ? 'var(--success,#16a34a)' : 'var(--danger,#ef4444)') + ';">' + dbElig + ' / ' + srcElig + '</strong>');
            }
            if (rec.fetchedCount !== undefined) {
              parts.push('المسحوب: <strong>' + Number(rec.fetchedCount || 0) + '</strong>');
            }
            if (rec.savedOrUpdatedCount !== undefined) {
              parts.push('المعالج (جديد/محدث): <strong>' + Number(rec.savedOrUpdatedCount || 0) + '</strong>');
            }
            if (rec.dbTotalReservations !== undefined) {
              parts.push('الإجمالي بقاعدة البيانات: <strong>' + Number(rec.dbTotalReservations || 0) + '</strong>');
            }
            if (Number(rec.duplicateHandledCount || 0) > 0) {
              parts.push('تكرار مُعالج: <strong>' + Number(rec.duplicateHandledCount) + '</strong>');
            }
            if (Number(rec.excludedFilteredCount || 0) > 0) {
              parts.push('مستبعد بالإعدادات: <strong>' + Number(rec.excludedFilteredCount) + '</strong>');
            }
            if (recIncomplete) {
              parts.push('<span style="color:var(--danger,#ef4444);font-weight:700;">تحذير عدم اكتمال المطابقة: فشل ' + failedCnt + ' · ناقص محلياً ' + missingCnt + (eligibleGap > 0 ? (' · فرق المستحقة ' + eligibleGap) : '') + (unfetchedGap > 0 ? (' · فجوة مصدر غير مجلوبة ' + unfetchedGap) : '') + (incEps.length ? (' · واجهات ناقصة: ' + escapeHtml(incEps.join(' | '))) : '') + '</span>');
            } else if (parts.length > 0) {
              parts.push('<span style="color:var(--success,#16a34a);font-weight:600;">✓ مكتمل ومطابق 100%</span>');
            }
            var extraDetails = '';
            var combinedMissingAll = Array.from(new Set(missingIds.concat(bfFailed).concat(missingEligIds)));
            if (combinedMissingAll.length > 0) {
              extraDetails += '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-hairline);">' +
                '<strong>المعرفات الناقصة/المتأثرة (' + combinedMissingAll.length + '):</strong> ' +
                '<span class="mono" dir="ltr" style="word-break:break-all;">' + escapeHtml(combinedMissingAll.slice(0, 40).join(', ')) + (combinedMissingAll.length > 40 ? (' ... (+' + (combinedMissingAll.length - 40) + ')') : '') + '</span>' +
              '</div>';
            }
            if (failedRecs.length > 0) {
              extraDetails += '<div style="margin-top:6px;">' +
                '<strong>سجلات فاشلة (' + failedRecs.length + '):</strong> ' +
                failedRecs.slice(0, 12).map(function (fr) {
                  var fId = fr.sourceReservationId || fr.reservationNumber || fr.identifier || '-';
                  return '<span class="mono" dir="ltr" style="display:inline-block;margin:2px 4px 0 0;padding:1px 6px;border-radius:4px;background:rgba(239,68,68,0.1);color:var(--danger,#ef4444);">' +
                    escapeHtml(String(fId) + ' [' + String(fr.stage || 'save') + ': ' + String(fr.reason || 'ERROR') + ']') +
                  '</span>';
                }).join('') +
              '</div>';
            }
            var retryActionHtml = recIncomplete
              ? '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm btn-primary" id="btn-retry-failed-sync">إعادة معالجة السجلات الفاشلة/الناقصة</button>' +
                '</div>'
              : '';
            if (!parts.length && !extraDetails) return '';
            return '<div id="sync-reconciliation-summary" style="margin-bottom:14px;padding:10px 12px;border:1px solid ' + (recIncomplete ? 'var(--danger,#ef4444)' : 'var(--border-hairline)') + ';border-radius:var(--radius-sm);background:var(--bg-surface-subtle);font-size:12.5px;color:var(--text-secondary);line-height:1.65;">' +
              '<div>' + parts.join(' · ') + '</div>' +
              extraDetails +
              retryActionHtml +
            '</div>';
          })() +
          '</div>' +
          '<div id="sync-action-msg" class="hidden" style="margin-bottom:14px;"></div>' +
          '<h3 style="margin:0 0 10px;font-size:14.5px;">سجل عمليات السحب (SyncLog)</h3>' +
          '<div id="sync-log-table-host">' +
          (syncLogs.length === 0
            ? '<div class="empty-state" style="padding:20px;">لا توجد عمليات مزامنة مسجلة بعد.</div>'
            : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
                '<th>المعرف</th><th>المنفذ</th><th>الحالة</th><th>مستورد</th><th>محدث</th><th>تمديدات</th><th>الصفحات</th><th>الرسالة</th><th>التوقيت</th>' +
              '</tr></thead><tbody>' +
                syncLogs.map(function (l) {
                  var stCls = l.status === 'success' ? 'status-success' : (l.status === 'partial' ? 'status-warning' : 'status-danger');
                  var stText = l.status === 'success' ? 'ناجح' : (l.status === 'partial' ? 'غير مكتمل' : 'فشل');
                  return '<tr>' +
                    '<td class="mono">' + l.id + '</td>' +
                    '<td>' + escapeHtml(l.triggeredByName || '') + '</td>' +
                    '<td><span class="status-tag ' + stCls + '">' + stText + '</span></td>' +
                    '<td class="tabular-nums">' + l.importedCount + '</td>' +
                    '<td class="tabular-nums">' + l.updatedCount + '</td>' +
                    '<td class="tabular-nums">' + l.extensionsCount + '</td>' +
                    '<td class="tabular-nums">' + l.pagesFetched + '</td>' +
                    '<td>' + escapeHtml(l.errorMessage || '-') + '</td>' +
                    '<td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(l.finishedAt, ctx)) + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody></table></div>') +
          '</div>' +
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

      ((canManageSettings || canManageRoleUiDefaults) ? (
        '<form class="surface-card" id="sys-settings-form">' +
          '<div class="section-header"><div><h2 class="section-title">' + (canManageSettings ? (t('nav_settings') + ' العامة وتخصيص الواجهة') : 'تخصيص الواجهة وإظهار/إخفاء الأقسام') + '</h2><p class="section-subtitle">' + (canManageSettings ? 'تُحفظ الإعدادات مركزيًا وتُعمَّم على كافة المستخدمين، بينما يتم ضبط مؤقت السحب التلقائي من قسم «إعدادات المزامنة التلقائية» أعلاه.' : 'إدارة ظهور وإخفاء الأقسام والأزرار وإعدادات كل دور.') + '</p></div>' +
            (canCustomizeUi && !isDeveloperUser ? '<button type="button" class="btn btn-sm" id="btn-dev-open-sections">تخصيص الأقسام والواجهة لكل موظف</button>' : '') +
          '</div>' +
          (canManageSettings ? (
            '<div class="form-grid-2">' +
              '<div class="form-group"><label class="form-label" for="set-company">اسم الشركة</label><input class="input" id="set-company" value="' + escapeHtml(settings.company_name || 'RENTAL GATE') + '"></div>' +
              '<div class="form-group"><label class="form-label" for="set-ttl">مدة صلاحية الجلسة (ساعات)</label><input class="input tabular-nums" type="number" min="1" max="168" id="set-ttl" value="' + (settings.session_ttl_hours || 24) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="set-excluded">الحالات المستبعدة أثناء السحب (مفصولة بفاصلة — لا يشمل الملغي أو المرفوض)</label><input class="input mono" id="set-excluded" value="' + escapeHtml(Array.isArray(settings.excluded_statuses) ? settings.excluded_statuses.filter(function (s) { return !(root.RGCrmCore && ((root.RGCrmCore.isRejectedStatus && root.RGCrmCore.isRejectedStatus(s)) || (root.RGCrmCore.isCancelledStatus && root.RGCrmCore.isCancelledStatus(s)))); }).join(', ') : 'draft, test, abandoned') + '"></div>' +
              '<div class="form-group" style="justify-content:center;"><label class="checkbox-item"><input type="checkbox" id="set-agent-all"' + (settings.allow_agent_view_all ? ' checked' : '') + '> السماح لموظف خدمة العملاء باستعراض جميع الحجوزات</label></div>' +
            '</div>'
          ) : '') +

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
                '<button type="button" class="btn btn-sm" id="btn-ui-restore-defaults">استعادة الإعدادات الافتراضية</button>' +
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
              '<button type="submit" class="btn btn-primary" id="btn-save-sys-settings">' + (canManageSettings ? 'حفظ الإعدادات العامة والواجهة' : 'حفظ تخصيصات الواجهة والأدوار') + '</button>' +
              (canPreviewSettings
                ? '<button type="button" class="btn rg-preview-inline-btn" id="btn-preview-role-defaults">👁️ معاينة النظام بدور: موظف خدمة العملاء</button>'
                : '') +
            '</div>' +
          '</div>' +
        '</form>' +
        (canManageCustomerNotesAdmin ? (
          '<div class="surface-card" id="customer-notes-admin-card" style="border-top:3px solid var(--brand-primary);">' +
            '<div class="section-header">' +
              '<div>' +
                '<h2 class="section-title">إدارة قسم ملاحظات العملاء وقسم العملاء (Admin Control)</h2>' +
                '<p class="section-subtitle">التحكم المركزي في الحالات الديناميكية، مصفوفة الأزرار الـ 14 والصلاحيات، قواعد الإضافة والمرفقات، الإشعارات، سجل النشاط، وخيارات قسم العملاء.</p>' +
              '</div>' +
              '<span class="status-tag status-info">NOTES &amp; CUSTOMERS ADMIN</span>' +
            '</div>' +
            '<div id="customer-notes-admin-host"><div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></div>' +
          '</div>'
        ) : '') +
        (canManageSettings ? (
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
        ) : '')
      ) : (
        canManageCustomerNotesAdmin ? (
          '<div class="surface-card" id="customer-notes-admin-card" style="border-top:3px solid var(--brand-primary);">' +
            '<div class="section-header">' +
              '<div>' +
                '<h2 class="section-title">إدارة قسم ملاحظات العملاء وقسم العملاء (Admin Control)</h2>' +
                '<p class="section-subtitle">التحكم المركزي في الحالات الديناميكية، مصفوفة الأزرار الـ 14 والصلاحيات، قواعد الإضافة والمرفقات، الإشعارات، سجل النشاط، وخيارات قسم العملاء.</p>' +
              '</div>' +
              '<span class="status-tag status-info">NOTES &amp; CUSTOMERS ADMIN</span>' +
            '</div>' +
            '<div id="customer-notes-admin-host"><div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></div>' +
          '</div>'
        ) : ''
      ));

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

    var devShortcutsHost = document.getElementById('dev-call-shortcuts-host');
    if (isDeveloperUser && devShortcutsHost && root.RGApp && typeof root.RGApp.mountCallShortcutsControlPanel === 'function') {
      root.RGApp.mountCallShortcutsControlPanel(devShortcutsHost, ctx, {});
    }

    var devOutboxHost = document.getElementById('dev-outbox-preview-host');
    if (canViewDevIntegrity && devOutboxHost) {
      mountDeveloperOutboxPreviewPanel(devOutboxHost, ctx);
    }

    var devHealthHost = document.getElementById('dev-health-center-host');
    if (canViewDevIntegrity && devHealthHost) {
      mountDatabaseHealthCenterPanel(devHealthHost, ctx);
    }

    var devIntegrityHost = document.getElementById('dev-integrity-host');
    if (canViewDevIntegrity && devIntegrityHost) {
      mountDeveloperIntegrityMonitorPanel(devIntegrityHost, ctx);
    }

    var notesAdminHost = document.getElementById('customer-notes-admin-host');
    if (canManageCustomerNotesAdmin && notesAdminHost) {
      mountCustomerNotesAdminPanel(notesAdminHost, user, ctx);
    }

    if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
      root.RGCrmDropdowns.enhanceAll(container);
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

    var checkAppUpdateBtn = document.getElementById('btn-check-app-update');
    if (checkAppUpdateBtn) {
      checkAppUpdateBtn.addEventListener('click', function () {
        runWithLock(checkAppUpdateBtn, 'checkAppUpdate', async function () {
          var prevText = checkAppUpdateBtn.textContent;
          checkAppUpdateBtn.textContent = 'جاري الفحص...';
          setDiagResult('app_update', 'نظام تحديث التطبيق التلقائي', 'pending', 'جاري التحقق من أحدث إصدار متاح على الخادم...', 0);
          var t0 = Date.now();
          try {
            var updRes = (root.RGApp && typeof root.RGApp.checkForUpdates === 'function')
              ? await root.RGApp.checkForUpdates({ trigger: 'manual', manual: true })
              : { updated: false, status: 'unavailable' };
            var ms = Math.max(1, Date.now() - t0);
            if (updRes && updRes.updated) {
              setDiagResult('app_update', 'نظام تحديث التطبيق التلقائي', 'ok', 'تم العثور على إصدار جديد (' + (updRes.remoteVersion || '') + ') — جاري التحديث التلقائي الآن.', ms);
            } else if (updRes && updRes.upToDate) {
              setDiagResult('app_update', 'نظام تحديث التطبيق التلقائي', 'ok', 'التطبيق يعمل على أحدث إصدار (' + (updRes.currentVersion || '') + ').', ms);
            } else if (updRes && updRes.deferred) {
              setDiagResult('app_update', 'نظام تحديث التطبيق التلقائي', 'pending', 'يتوفر إصدار جديد (' + (updRes.remoteVersion || '') + ') وسيُطبّق تلقائياً فور حفظ التعديلات الجارية.', ms);
            } else {
              setDiagResult('app_update', 'نظام تحديث التطبيق التلقائي', 'fail', 'تعذر التحقق من ملف الإصدار في الخادم (' + ((updRes && updRes.status) || 'unknown') + ').', ms);
            }
          } finally {
            if (checkAppUpdateBtn.isConnected !== false) checkAppUpdateBtn.textContent = prevText;
          }
        });
      });
    }

    var syncDiagEl = document.getElementById('sync-diag-results');
    var showSyncDiagBtn = document.getElementById('btn-show-sync-diagnostics');

    function renderSyncDiagPanel() {
      if (!syncDiagEl || syncDiagEl.classList.contains('hidden')) return;
      var summary = (root.RGApp && typeof root.RGApp.getSyncStatusSummary === 'function')
        ? root.RGApp.getSyncStatusSummary()
        : {};
      var logs = (root.RGApp && typeof root.RGApp.getSyncDiagnostics === 'function')
        ? root.RGApp.getSyncDiagnostics()
        : [];
      if (!Array.isArray(logs)) logs = [];
      var channelLabel = summary.offline
        ? 'غير متصل (Offline)'
        : (summary.sseConnected ? 'بث فوري (SSE Live)' : 'مزامنة سريعة تلقائية (Polling 3s)');
      var channelCls = summary.offline
        ? 'status-danger'
        : (summary.networkDegraded ? 'status-warning' : 'status-success');
      var headerHtml =
        '<div style="padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<strong style="font-size:13px;">حالة المزامنة والإصدار</strong>' +
            '<span class="status-tag ' + channelCls + '">' + escapeHtml(channelLabel) + '</span>' +
            '<span class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-secondary);">v=' + escapeHtml(summary.currentVersion || 'dev') + '</span>' +
            (summary.offlineQueueCount > 0 ? ('<span class="status-tag status-warning">طابور معلق: ' + summary.offlineQueueCount + '</span>') : '') +
          '</div>' +
          '<div class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-muted);">sync#' + escapeHtml(String(summary.lastSyncVersion || 0)) + (summary.lastDeltaSyncAt ? (' · ' + escapeHtml(summary.lastDeltaSyncAt.slice(11, 19))) : '') + '</div>' +
        '</div>';
      var rowsHtml = logs.length === 0
        ? '<div style="padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);font-size:12.5px;color:var(--text-muted);">لا توجد أحداث مسجلة بعد في هذه الجلسة.</div>'
        : logs.slice(0, 20).map(function (item) {
            var lvCls = item.level === 'warn' || item.level === 'error' ? 'status-warning' : 'status-info';
            return '<div style="padding:8px 10px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;flex-wrap:wrap;">' +
                '<span class="status-tag ' + lvCls + '">' + escapeHtml(item.kind || 'sync') + '</span>' +
                '<span style="font-size:12.5px;color:var(--text-primary);">' + escapeHtml(item.message || '') + '</span>' +
                (item.detail ? ('<span class="mono" dir="ltr" style="font-size:11px;color:var(--text-muted);">' + escapeHtml(item.detail) + '</span>') : '') +
              '</div>' +
              '<span class="mono" dir="ltr" style="font-size:11px;color:var(--text-muted);">' + escapeHtml(String(item.time || '').slice(11, 19)) + '</span>' +
            '</div>';
          }).join('');
      syncDiagEl.innerHTML = headerHtml + rowsHtml;
    }

    if (showSyncDiagBtn && syncDiagEl) {
      showSyncDiagBtn.addEventListener('click', function () {
        var willShow = syncDiagEl.classList.contains('hidden');
        syncDiagEl.classList.toggle('hidden', !willShow);
        showSyncDiagBtn.textContent = willShow ? 'إخفاء سجل التحديث والمزامنة' : 'سجل التحديث والمزامنة';
        if (willShow) renderSyncDiagPanel();
      });
    }

    if (!container._rgSyncDiagBound) {
      container._rgSyncDiagBound = true;
      var onSyncDiagUpdate = function () {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:syncdiagupdate', onSyncDiagUpdate);
          return;
        }
        renderSyncDiagPanel();
      };
      document.addEventListener('rg:syncdiagupdate', onSyncDiagUpdate);
    }

    var monitorState = {
      status: workerTelemetry.status || 'running',
      isSyncing: Boolean(workerTelemetry.isSyncing),
      autoSyncEnabled: Boolean(autoSyncEnabled),
      intervalSeconds: Number(workerTelemetry.intervalSeconds || autoSyncNorm.intervalSeconds || 43200),
      lastRunAt: workerTelemetry.lastRunAt || '',
      nextRunAt: autoSyncEnabled ? (workerTelemetry.nextRunAt || '') : '',
      lastDurationMs: Number(workerTelemetry.lastDurationMs || 0),
      importedCount: Number(workerTelemetry.importedCount || 0),
      updatedCount: Number(workerTelemetry.updatedCount || 0),
      extensionsCount: Number(workerTelemetry.extensionsCount || 0),
      errorCount: Number(workerTelemetry.errorCount || 0),
      consecutiveErrors: Number(workerTelemetry.consecutiveErrors || 0),
      lastError: String(workerTelemetry.lastError || '')
    };

    function formatCountdownDisplay(targetIso) {
      if (!targetIso) return 'متوقف';
      var ts = Date.parse(String(targetIso));
      if (!isFinite(ts)) return '-';
      var diffSec = Math.ceil((ts - Date.now()) / 1000);
      if (monitorState.isSyncing && diffSec <= 0) return 'جاري السحب...';
      if (diffSec <= 0) return 'خلال ثوانٍ';
      if (diffSec < 60) return 'بعد ' + diffSec + ' ث';
      var hrs = Math.floor(diffSec / 3600);
      var mins = Math.floor((diffSec % 3600) / 60);
      var secs = diffSec % 60;
      if (hrs > 0) {
        return 'بعد ' + String(hrs).padStart(2, '0') + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      }
      return 'بعد ' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    function updateCountdownNode() {
      var countdownEl = document.getElementById('sync-monitor-countdown');
      if (!countdownEl) return;
      if (!monitorState.autoSyncEnabled || !monitorState.nextRunAt) {
        countdownEl.textContent = 'متوقف';
        return;
      }
      countdownEl.textContent = formatCountdownDisplay(monitorState.nextRunAt);
    }

    if (container._rgAutoSyncTimerId) {
      clearInterval(container._rgAutoSyncTimerId);
      container._rgAutoSyncTimerId = null;
    }
    updateCountdownNode();
    container._rgAutoSyncTimerId = setInterval(function () {
      if (!container || !container.isConnected) {
        clearInterval(container._rgAutoSyncTimerId);
        container._rgAutoSyncTimerId = null;
        return;
      }
      updateCountdownNode();
    }, 1000);

    function renderSyncLogsTableHtml(logsList) {
      var list = Array.isArray(logsList) ? logsList : [];
      if (!list.length) {
        return '<div class="empty-state" style="padding:20px;">لا توجد عمليات مزامنة مسجلة بعد.</div>';
      }
      return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        '<th>المعرف</th><th>المنفذ</th><th>الحالة</th><th>مستورد</th><th>محدث</th><th>تمديدات</th><th>الصفحات</th><th>الرسالة</th><th>التوقيت</th>' +
      '</tr></thead><tbody>' +
        list.map(function (l) {
          var stCls = l.status === 'success' ? 'status-success' : (l.status === 'partial' ? 'status-warning' : 'status-danger');
          var stText = l.status === 'success' ? 'ناجح' : (l.status === 'partial' ? 'غير مكتمل' : 'فشل');
          return '<tr>' +
            '<td class="mono">' + escapeHtml(l.id) + '</td>' +
            '<td>' + escapeHtml(l.triggeredByName || '') + '</td>' +
            '<td><span class="status-tag ' + stCls + '">' + stText + '</span></td>' +
            '<td class="tabular-nums">' + Number(l.importedCount || 0) + '</td>' +
            '<td class="tabular-nums">' + Number(l.updatedCount || 0) + '</td>' +
            '<td class="tabular-nums">' + Number(l.extensionsCount || 0) + '</td>' +
            '<td class="tabular-nums">' + Number(l.pagesFetched || 0) + '</td>' +
            '<td>' + escapeHtml(l.errorMessage || '-') + '</td>' +
            '<td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(l.finishedAt, ctx)) + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';
    }

    function updateSyncMonitorDom(workerPatch, fullSyncPayload) {
      if (workerPatch && typeof workerPatch === 'object') {
        if (workerPatch.status !== undefined) monitorState.status = workerPatch.status;
        if (workerPatch.isSyncing !== undefined) monitorState.isSyncing = Boolean(workerPatch.isSyncing);
        if (workerPatch.autoSyncEnabled !== undefined) monitorState.autoSyncEnabled = Boolean(workerPatch.autoSyncEnabled);
        if (workerPatch.intervalSeconds !== undefined) monitorState.intervalSeconds = Number(workerPatch.intervalSeconds || monitorState.intervalSeconds);
        if (workerPatch.lastRunAt !== undefined) monitorState.lastRunAt = workerPatch.lastRunAt || '';
        if (workerPatch.nextRunAt !== undefined) monitorState.nextRunAt = workerPatch.nextRunAt || '';
        if (workerPatch.lastDurationMs !== undefined) monitorState.lastDurationMs = Number(workerPatch.lastDurationMs || 0);
        if (workerPatch.importedCount !== undefined) monitorState.importedCount = Number(workerPatch.importedCount || 0);
        if (workerPatch.updatedCount !== undefined) monitorState.updatedCount = Number(workerPatch.updatedCount || 0);
        if (workerPatch.extensionsCount !== undefined) monitorState.extensionsCount = Number(workerPatch.extensionsCount || 0);
        if (workerPatch.errorCount !== undefined) monitorState.errorCount = Number(workerPatch.errorCount || 0);
        if (workerPatch.consecutiveErrors !== undefined) monitorState.consecutiveErrors = Number(workerPatch.consecutiveErrors || 0);
        if (workerPatch.lastError !== undefined) monitorState.lastError = String(workerPatch.lastError || '');
      }
      if (!monitorState.autoSyncEnabled) {
        monitorState.status = 'stopped';
        monitorState.nextRunAt = '';
      } else if (!monitorState.status || monitorState.status === 'stopped') {
        monitorState.status = (monitorState.consecutiveErrors > 0 && monitorState.lastError) ? 'error' : 'running';
      }

      var statusBadge = document.getElementById('sync-monitor-status-badge');
      var activePill = document.getElementById('sync-monitor-active-pill');
      var stateTextEl = document.getElementById('sync-monitor-state-text');
      var intervalEl = document.getElementById('sync-monitor-interval');
      var lastRunEl = document.getElementById('sync-monitor-last-run');
      var nextRunWrap = document.getElementById('sync-monitor-next-run');
      var importedEl = document.getElementById('sync-monitor-imported');
      var updatedEl = document.getElementById('sync-monitor-updated');
      var extensionsEl = document.getElementById('sync-monitor-extensions');
      var errDurEl = document.getElementById('sync-monitor-errors-duration');
      var errBoxEl = document.getElementById('sync-monitor-error-box');
      var errTextEl = document.getElementById('sync-monitor-last-error');
      var autoBadgeEl = document.getElementById('sync-auto-badge');
      var sumLastPullEl = document.getElementById('sync-summary-last-pull');
      var sumCountsEl = document.getElementById('sync-summary-counts');

      if (statusBadge) {
        statusBadge.className = 'status-tag ' + (monitorState.status === 'stopped' ? 'status-warning' : (monitorState.status === 'error' ? 'status-danger' : 'status-success'));
        statusBadge.textContent = monitorState.status === 'stopped' ? 'متوقف' : (monitorState.status === 'error' ? 'خطأ' : 'يعمل');
      }
      if (activePill) {
        activePill.classList.toggle('hidden', !monitorState.isSyncing);
      }
      if (stateTextEl) {
        stateTextEl.textContent = monitorState.status === 'stopped'
          ? 'متوقف'
          : (monitorState.status === 'error' ? 'خطأ — إعادة محاولة مجدولة' : 'يعمل تلقائياً');
      }
      var ivLabel = formatIntervalSecondsAr(monitorState.intervalSeconds);
      if (intervalEl) intervalEl.textContent = ivLabel;
      if (autoBadgeEl) autoBadgeEl.textContent = monitorState.autoSyncEnabled ? ('مفعل — ' + ivLabel) : 'متوقف حاليًا';
      if (lastRunEl) {
        lastRunEl.textContent = monitorState.lastRunAt ? formatSettingDateTime(monitorState.lastRunAt, ctx) : 'لم يتم السحب بعد';
      }
      if (nextRunWrap) {
        if (monitorState.autoSyncEnabled && monitorState.nextRunAt) {
          nextRunWrap.innerHTML =
            '<span id="sync-monitor-countdown" class="mono rg-sync-countdown-main" dir="ltr">' + escapeHtml(formatCountdownDisplay(monitorState.nextRunAt)) + '</span>' +
            '<span class="rg-sync-next-ts mono" dir="ltr">' + escapeHtml(formatSettingDateTime(monitorState.nextRunAt, ctx)) + '</span>';
        } else {
          nextRunWrap.textContent = 'متوقف';
        }
      }
      if (importedEl) importedEl.textContent = String(monitorState.importedCount);
      if (updatedEl) updatedEl.textContent = String(monitorState.updatedCount);
      if (extensionsEl) extensionsEl.textContent = String(monitorState.extensionsCount);
      if (errDurEl) {
        errDurEl.textContent = monitorState.errorCount + ' خطأ · ' +
          (monitorState.lastDurationMs > 0 ? ((monitorState.lastDurationMs / 1000).toFixed(1) + ' ث') : '-');
      }
      if (errBoxEl && errTextEl) {
        errTextEl.textContent = monitorState.lastError || '';
        errBoxEl.classList.toggle('hidden', !monitorState.lastError);
      }

      if (fullSyncPayload && typeof fullSyncPayload === 'object') {
        var latestLog = fullSyncPayload.lastSync || (Array.isArray(fullSyncPayload.logs) && fullSyncPayload.logs[0]) || null;
        if (sumLastPullEl && latestLog) {
          sumLastPullEl.textContent = formatSettingDateTime(latestLog.finishedAt, ctx);
        }
        if (sumCountsEl && latestLog) {
          sumCountsEl.textContent = Number(latestLog.importedCount || 0) + ' جديد · ' + Number(latestLog.updatedCount || 0) + ' محدث · ' + Number(latestLog.extensionsCount || 0) + ' تمديد';
        }
        var logsHost = document.getElementById('sync-log-table-host');
        if (logsHost && Array.isArray(fullSyncPayload.logs)) {
          logsHost.innerHTML = renderSyncLogsTableHtml(fullSyncPayload.logs);
        }
      }
    }

    var monitorRefreshInFlight = null;
    var monitorRefreshTimer = null;
    function refreshSyncMonitorFromServer() {
      if (!canSync) return Promise.resolve();
      if (monitorRefreshInFlight) return monitorRefreshInFlight;
      monitorRefreshInFlight = root.RGApi.callApi('getSyncStatus', { forceRefresh: true }).then(function (sRes) {
        if (sRes && sRes.success && sRes.data && container && container.isConnected) {
          updateSyncMonitorDom(sRes.data.worker || sRes.data, sRes.data);
        }
      }).catch(function () {}).finally(function () {
        monitorRefreshInFlight = null;
      });
      return monitorRefreshInFlight;
    }

    if (!container._rgSettingsDeltaBound) {
      container._rgSettingsDeltaBound = true;
      var onSettingsDeltaSync = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onSettingsDeltaSync);
          return;
        }
        var d = (ev && ev.detail) || {};
        if (d.syncWorkerState && typeof d.syncWorkerState === 'object') {
          updateSyncMonitorDom(d.syncWorkerState, null);
        }
        var hasMonitorDelta = Boolean(
          d.syncStatusChanged ||
          d.syncWorkerState ||
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0)
        );
        if (hasMonitorDelta && !(d.changedSettings || d.changedRoles || d.changedDelegations || d.deletedAllReservationsBefore)) {
          if (monitorRefreshTimer) clearTimeout(monitorRefreshTimer);
          monitorRefreshTimer = setTimeout(function () {
            refreshSyncMonitorFromServer();
          }, 250);
          return;
        }
        if (!(d.changedSettings || d.changedRoles || d.changedDelegations || d.deletedAllReservationsBefore)) return;
        var modalRoot = document.getElementById('modal-root');
        if (modalRoot && modalRoot.firstElementChild) return;
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
          if (hasMonitorDelta) refreshSyncMonitorFromServer();
          return;
        }
        render(container, ctx).catch(function () {});
      };
      document.addEventListener('rg:deltasync', onSettingsDeltaSync);
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
            var failedCount = Number(d.failedCount || 0);
            var missingCount = Number(d.missingLocalCount || 0);
            var eligibleGap = Number(d.eligibleCountGap || 0);
            var missingElig = Array.isArray(d.missingEligibleIds) ? d.missingEligibleIds : [];
            var unfetchedGap = Number(d.unfetchedSourceGap || 0);
            var incompleteEps = Array.isArray(d.incompleteEndpoints) ? d.incompleteEndpoints : [];
            var backfillFailed = Array.isArray(d.backfillFailedIds) ? d.backfillFailedIds : [];
            var isIncomplete = d.syncComplete === false || failedCount > 0 || missingCount > 0 || eligibleGap > 0 || missingElig.length > 0 || unfetchedGap > 0 || incompleteEps.length > 0 || backfillFailed.length > 0;
            var sb = d.sourceBreakdown || null;
            var diagHint = '';
            if (imported === 0 && updated === 0 && !isIncomplete) {
              var fetched = d.fetchedCount || 0;
              if (fetched > 0 && d.excludedFilteredCount === fetched) {
                diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعدت جميعها حسب الحالات المستبعدة';
              } else if (fetched > 0 && d.rangeFilteredCount > 0) {
                diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعد ' + d.rangeFilteredCount + ' خارج النطاق المحدد';
              } else if (fetched === 0) {
                diagHint = ' — أرجعت الواجهة 0 حجز لهذا الحساب/الفترة';
              }
            }
            if (isIncomplete) {
              var warnParts = [];
              if (failedCount > 0) warnParts.push('فشل: ' + failedCount);
              if (missingCount > 0) warnParts.push('ناقص بالتحقق: ' + missingCount);
              if (eligibleGap > 0) warnParts.push('فرق المستحقة: ' + eligibleGap + ' (' + Number(d.dbEligibleCount || 0) + '/' + Number(d.sourceEligibleCount || 0) + ')');
              if (unfetchedGap > 0) warnParts.push('فجوة مصدر: ' + unfetchedGap);
              if (backfillFailed.length > 0) warnParts.push('تعذر جلب تفاصيل: ' + backfillFailed.length);
              if (incompleteEps.length > 0) warnParts.push('واجهات غير مكتملة: ' + incompleteEps.join(', '));
              ctx.toast('تحذير: المزامنة غير مكتملة (' + warnParts.join(' · ') + ') — تم حفظ ' + (imported + updated) + ' سجل', true);
            } else {
              var eligHint = Number(d.sourceEligibleCount || 0) > 0
                ? (' · المستحقة ' + Number(d.dbEligibleCount || 0) + '/' + Number(d.sourceEligibleCount || 0))
                : '';
              var overlapHint = (sb && Number(sb.uniqueSourceTotal || 0) > 0)
                ? (' · الإجمالي ' + sb.uniqueSourceTotal + '/' + sb.uniqueSourceTotal + eligHint)
                : eligHint;
              ctx.toast('اكتملت المزامنة والتحقق بنجاح: ' + imported + ' جديد · ' + updated + ' محدث · ' + exts + ' تمديد' + overlapHint + diagHint);
            }
            if (syncNowBtn.isConnected !== false) syncNowBtn.textContent = prevText;
            var autoUnsavedDirty = Boolean(
              typeof captureAutoSyncSnapshot === 'function' &&
              autoSyncForm &&
              captureAutoSyncSnapshot() !== initialAutoSyncSnapshot
            );
            var sysUnsavedDirty = Boolean(
              typeof captureSysSnapshot === 'function' &&
              sysForm &&
              captureSysSnapshot() !== initialSysSnapshot
            );
            if (autoUnsavedDirty || sysUnsavedDirty) {
              await refreshSyncMonitorFromServer();
            } else {
              render(container, ctx);
            }
          } else {
            var msg = document.getElementById('sync-action-msg');
            if (msg) {
              msg.className = 'form-error';
              msg.textContent = res.message;
            }
            if (syncNowBtn.isConnected !== false) syncNowBtn.textContent = prevText;
          }
        });
      });
    }

    var retryFailedBtn = document.getElementById('btn-retry-failed-sync');
    if (retryFailedBtn) {
      retryFailedBtn.addEventListener('click', function () {
        runWithLock(retryFailedBtn, 'retryFailedSyncRecords', async function () {
          var prevText = retryFailedBtn.textContent;
          retryFailedBtn.textContent = 'جاري إعادة المعالجة...';
          var res = await root.RGApi.callApi('retryFailedSyncRecords', {});
          if (res.success && res.data) {
            var d = res.data;
            var stillIncomplete = d.syncComplete === false || Number(d.failedCount || 0) > 0 || Number(d.missingLocalCount || 0) > 0 || Number(d.unfetchedSourceGap || 0) > 0;
            if (stillIncomplete) {
              ctx.toast('تمت إعادة المحاولة وما زال هناك نقص (' + Number(d.missingLocalCount || 0) + ' ناقص · ' + Number(d.failedCount || 0) + ' فشل)', true);
            } else {
              ctx.toast('تمت إعادة معالجة السجلات الناقصة بنجاح واكتمل التطابق (' + Number(d.dbTotalReservations || 0) + ' حجز).');
            }
            render(container, ctx);
          } else {
            ctx.toast((res && res.message) || 'تعذر إعادة معالجة السجلات الفاشلة.', true);
            if (retryFailedBtn.isConnected !== false) retryFailedBtn.textContent = prevText;
          }
        });
      });
    }

    var autoSyncForm = document.getElementById('auto-sync-settings-form');
    var autoEnabledInput = document.getElementById('set-auto-sync-enabled');
    var autoValueInput = document.getElementById('set-auto-sync-value');
    var autoUnitSelect = document.getElementById('set-auto-sync-unit');
    var autoPreviewEl = document.getElementById('auto-sync-live-preview');
    var autoValidationMsgEl = document.getElementById('auto-sync-validation-msg');

    function validateAutoSyncFormInputs(showErrorMsg) {
      var isEn = autoEnabledInput ? Boolean(autoEnabledInput.checked) : true;
      var rawVal = autoValueInput ? autoValueInput.value : '';
      var rawUnit = autoUnitSelect ? autoUnitSelect.value : 'seconds';
      var check = (root.RGCrmCore && root.RGCrmCore.validateAutoSyncInterval)
        ? root.RGCrmCore.validateAutoSyncInterval({ value: rawVal, unit: rawUnit })
        : (function () {
            var n = Number(rawVal);
            var mult = rawUnit === 'hours' ? 3600 : (rawUnit === 'minutes' ? 60 : 1);
            var sec = n * mult;
            if (!isFinite(n) || rawVal === '' || sec < 1) {
              return { valid: false, error: 'الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).', intervalSeconds: 1, value: n, unit: rawUnit, hours: 0, minutes: 1 };
            }
            if (sec > 43200) {
              return { valid: false, error: 'الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).', intervalSeconds: 43200, value: n, unit: rawUnit, hours: 12, minutes: 0 };
            }
            var rSec = Math.round(sec);
            var tMin = Math.max(1, Math.round(rSec / 60));
            return { valid: true, error: '', intervalSeconds: rSec, value: n, unit: rawUnit, hours: Math.floor(tMin / 60), minutes: tMin % 60 };
          })();

      container.querySelectorAll('.auto-sync-preset').forEach(function (b) {
        var bVal = Number(b.getAttribute('data-value') || 0);
        var bUnit = b.getAttribute('data-unit') || 'seconds';
        b.classList.toggle('btn-primary', check.valid && Number(rawVal) === bVal && rawUnit === bUnit);
      });

      if (autoPreviewEl) {
        if (!check.valid) {
          autoPreviewEl.textContent = 'قيمة غير صالحة (المسموح: 1 ثانية – 12 ساعة)';
          autoPreviewEl.classList.add('is-invalid');
        } else {
          autoPreviewEl.classList.remove('is-invalid');
          autoPreviewEl.textContent = isEn ? ('مفعل — ' + formatIntervalSecondsAr(check.intervalSeconds)) : ('متوقف (' + formatIntervalSecondsAr(check.intervalSeconds) + ')');
        }
      }

      if (autoValidationMsgEl) {
        if (!check.valid && showErrorMsg) {
          autoValidationMsgEl.className = 'form-error';
          autoValidationMsgEl.textContent = check.error;
        } else {
          autoValidationMsgEl.className = 'hidden';
          autoValidationMsgEl.textContent = '';
        }
      }

      return Object.assign({ enabled: isEn }, check);
    }

    container.querySelectorAll('.auto-sync-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pVal = btn.getAttribute('data-value') || '1';
        var pUnit = btn.getAttribute('data-unit') || 'seconds';
        if (autoValueInput) autoValueInput.value = pVal;
        if (autoUnitSelect) autoUnitSelect.value = pUnit;
        if (autoEnabledInput) autoEnabledInput.checked = true;
        validateAutoSyncFormInputs(false);
      });
    });

    if (autoEnabledInput) {
      autoEnabledInput.addEventListener('change', function () {
        validateAutoSyncFormInputs(false);
      });
    }
    if (autoValueInput) {
      autoValueInput.addEventListener('input', function () {
        var v = validateAutoSyncFormInputs(false);
        if (!v.valid && autoValidationMsgEl) {
          autoValidationMsgEl.className = 'form-error';
          autoValidationMsgEl.textContent = v.error;
        }
      });
    }
    if (autoUnitSelect) {
      autoUnitSelect.addEventListener('change', function () {
        validateAutoSyncFormInputs(true);
      });
    }

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

    var uiRestoreBtn = document.getElementById('btn-ui-restore-defaults');
    if (uiRestoreBtn) {
      uiRestoreBtn.addEventListener('click', function () {
        runWithLock(uiRestoreBtn, 'restoreUiDefaults:all', async function () {
          var res = await root.RGApi.callApi('restoreUiDefaults', { scope: 'all', clearEmployees: false, _spamChecked: true });
          if (!res || !res.success) {
            ctx.toast((res && res.message) || 'تعذر استعادة الإعدادات الافتراضية.', true);
            return;
          }
          var d = res.data || {};
          if (d.role_ui_defaults) {
            if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(d.role_ui_defaults);
            else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(d.role_ui_defaults);
          }
          if (d.ui_simplification) {
            if (ctx.applyUiSimplification) ctx.applyUiSimplification(d.ui_simplification);
            else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(d.ui_simplification);
          }
          clearSettingsUnsavedGuard();
          ctx.toast('تمت استعادة الإعدادات الافتراضية للواجهة بنجاح.');
          render(container, ctx);
        });
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
            '<button type="button" class="btn btn-sm" id="btn-role-ui-restore-tab">استعادة الافتراضي لهذا الدور</button>' +
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
      var roleRestoreTabBtn = document.getElementById('btn-role-ui-restore-tab');
      if (roleRestoreTabBtn) {
        roleRestoreTabBtn.addEventListener('click', function () {
          runWithLock(roleRestoreTabBtn, 'restoreRoleUi:' + activeRoleDefaultTab, async function () {
            var res = await root.RGApi.callApi('restoreUiDefaults', {
              scope: 'role',
              role: activeRoleDefaultTab,
              _spamChecked: true
            });
            if (!res || !res.success) {
              ctx.toast((res && res.message) || 'تعذر استعادة الافتراضي لهذا الدور.', true);
              return;
            }
            var d = res.data || {};
            if (d.role_ui_defaults) {
              roleUiDefaultsDraft = (root.RGCrmCore && root.RGCrmCore.normalizeRoleUiDefaults)
                ? root.RGCrmCore.normalizeRoleUiDefaults(d.role_ui_defaults)
                : d.role_ui_defaults;
              if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(roleUiDefaultsDraft);
              else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(roleUiDefaultsDraft);
            }
            ctx.toast('تمت استعادة الإعدادات الافتراضية لهذا الدور.');
            renderRoleDefaultsEditor();
          });
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

      var prevUiSimp = (root.RGApp && root.RGApp.getUiSimplification) ? root.RGApp.getUiSimplification() : null;
      var prevRoleDefaults = (root.RGApp && root.RGApp.getRoleUiDefaults) ? root.RGApp.getRoleUiDefaults() : null;

      if (!canManageSettings) {
        if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(normRoleDefaults);
        else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(normRoleDefaults);
        if (ctx.applyUiSimplification) ctx.applyUiSimplification(normUiSimp);
        else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(normUiSimp);
        clearSettingsUnsavedGuard();
        var uiOnlyRes = await root.RGApi.callApi('saveRoleUiDefaults', {
          ui_simplification: normUiSimp,
          role_ui_defaults: normRoleDefaults,
          _spamChecked: true
        });
        if (uiOnlyRes && uiOnlyRes.success) {
          ctx.toast('تم حفظ تخصيصات الواجهة وإعدادات الأدوار بنجاح.');
          if (!skipReload) render(container, ctx);
          return true;
        }
        if (prevRoleDefaults && ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(prevRoleDefaults);
        if (prevUiSimp && ctx.applyUiSimplification) ctx.applyUiSimplification(prevUiSimp);
        ctx.toast((uiOnlyRes && uiOnlyRes.message) || 'تعذر حفظ تخصيصات الواجهة.', true);
        return false;
      }

      var excluded = (document.getElementById('set-excluded').value || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) {
        if (!s) return false;
        if (root.RGCrmCore && ((root.RGCrmCore.isRejectedStatus && root.RGCrmCore.isRejectedStatus(s)) || (root.RGCrmCore.isCancelledStatus && root.RGCrmCore.isCancelledStatus(s)))) {
          return false;
        }
        return !/^(cancelled|canceled|rejected|declined|refused|ملغي|ملغى|تم الإلغاء|مرفوض)$/i.test(s);
      });

      if (ctx.setRoleUiDefaults) ctx.setRoleUiDefaults(normRoleDefaults);
      else if (root.RGApp && root.RGApp.setRoleUiDefaults) root.RGApp.setRoleUiDefaults(normRoleDefaults);

      if (ctx.applyUiSimplification) ctx.applyUiSimplification(normUiSimp);
      else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(normUiSimp);

      clearSettingsUnsavedGuard();
      ctx.toast('تم حفظ الإعدادات العامة وتخصيصات الواجهة والأدوار بنجاح.');

      var res = await root.RGApi.callApi('updateSettings', {
        _keepOptimisticCache: true,
        _spamChecked: true,
        company_name: document.getElementById('set-company').value,
        session_ttl_hours: Number(document.getElementById('set-ttl').value || 24),
        excluded_statuses: excluded,
        allow_agent_view_all: document.getElementById('set-agent-all').checked,
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

    async function saveAutoSyncSettingsCore(skipReload) {
      var check = validateAutoSyncFormInputs(true);
      if (!check.valid) {
        ctx.toast(check.error, true);
        if (autoValueInput) autoValueInput.focus();
        return false;
      }

      var saveAutoBtn = document.getElementById('btn-save-auto-sync');
      var prevBtnTxt = saveAutoBtn ? saveAutoBtn.textContent : '';
      if (saveAutoBtn) saveAutoBtn.textContent = 'جاري الحفظ والتطبيق...';

      try {
        var res = await root.RGApi.callApi('updateSettings', {
          _spamChecked: true,
          auto_sync_enabled: check.enabled,
          auto_sync_interval_seconds: check.intervalSeconds,
          auto_sync_interval_value: check.value,
          auto_sync_interval_unit: check.unit,
          auto_sync_interval_hours: check.hours,
          auto_sync_interval_minutes: check.minutes
        });
        if (!res || !res.success) {
          var errMsg = (res && res.message) || 'تعذر حفظ إعدادات المزامنة التلقائية.';
          if (autoValidationMsgEl) {
            autoValidationMsgEl.className = 'form-error';
            autoValidationMsgEl.textContent = errMsg.replace(/^VALIDATION_ERROR:\s*/i, '');
          }
          ctx.toast(errMsg, true);
          return false;
        }
        initialAutoSyncSnapshot = captureAutoSyncSnapshot();
        var nextWorkerPatch = (res.data && res.data.syncWorkerState) ? res.data.syncWorkerState : {
          autoSyncEnabled: check.enabled,
          intervalSeconds: check.intervalSeconds,
          status: check.enabled ? (monitorState.consecutiveErrors > 0 && monitorState.lastError ? 'error' : 'running') : 'stopped',
          nextRunAt: check.enabled ? new Date(Date.now() + check.intervalSeconds * 1000).toISOString() : ''
        };
        updateSyncMonitorDom(nextWorkerPatch, null);
        if (autoValidationMsgEl) {
          autoValidationMsgEl.className = 'form-success';
          autoValidationMsgEl.textContent = check.enabled
            ? ('تم حفظ المزامنة التلقائية وتطبيقها فوراً (' + formatIntervalSecondsAr(check.intervalSeconds) + ').')
            : 'تم إيقاف المزامنة التلقائية وتطبيق التغيير فوراً لجميع المستخدمين.';
        }
        ctx.toast(check.enabled
          ? ('تم حفظ وتطبيق المزامنة التلقائية فوراً (' + formatIntervalSecondsAr(check.intervalSeconds) + ').')
          : 'تم إيقاف المزامنة التلقائية وحفظ الإعداد في قاعدة البيانات.');
        await refreshSyncMonitorFromServer();
        if (!skipReload && !captureSysSnapshotDirty()) {
          // Keep in-place smoothly without form flash
        }
        return true;
      } finally {
        if (saveAutoBtn && saveAutoBtn.isConnected !== false) saveAutoBtn.textContent = prevBtnTxt;
      }
    }

    if (autoSyncForm) {
      autoSyncForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var saveAutoBtn = document.getElementById('btn-save-auto-sync');
        runWithLock(saveAutoBtn, 'updateAutoSyncSettings', function () {
          return saveAutoSyncSettingsCore(true);
        });
      });
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

    function captureAutoSyncSnapshot() {
      if (!autoSyncForm) return '';
      return JSON.stringify({
        autoEnabled: Boolean(autoEnabledInput && autoEnabledInput.checked),
        autoValue: autoValueInput ? String(autoValueInput.value || '') : '',
        autoUnit: autoUnitSelect ? String(autoUnitSelect.value || 'seconds') : 'seconds'
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
        uiPreset: uiPresetSelect ? uiPresetSelect.value : 'full',
        uiFlags: uiFlags,
        roleUiDefaults: roleUiDefaultsDraft
      });
    }
    function captureSysSnapshotDirty() {
      return Boolean(sysForm && captureSysSnapshot() !== initialSysSnapshot);
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
    var initialAutoSyncSnapshot = captureAutoSyncSnapshot();
    var initialSysSnapshot = captureSysSnapshot();
    var initialHoSnapshot = captureHoSnapshot();

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: 'إعدادات النظام والأدوار',
        isDirty: function () {
          if (!container || !container.isConnected) return false;
          var tokEl = document.getElementById('set-rg-token');
          if (tokEl && String(tokEl.value || '').trim().length > 0) return true;
          if (autoSyncForm && captureAutoSyncSnapshot() !== initialAutoSyncSnapshot) return true;
          if (sysForm && captureSysSnapshot() !== initialSysSnapshot) return true;
          if (hoForm && captureHoSnapshot() !== initialHoSnapshot) return true;
          return false;
        },
        onSave: async function () {
          var ok = true;
          if (autoSyncForm && captureAutoSyncSnapshot() !== initialAutoSyncSnapshot) {
            ok = await saveAutoSyncSettingsCore(true);
            if (!ok) return false;
            initialAutoSyncSnapshot = captureAutoSyncSnapshot();
          }
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
                  var backupTitle = 'نسخة احتياطية قبل الحذف — الحجوزات (' + tag + ')';
                  await root.RGReports.exportExcelWorkbook([{
                    name: 'Deleted_Reservations',
                    title: backupTitle,
                    periodText: tag === 'all' ? 'كافة الحجوزات' : tag,
                    headers: cols,
                    rows: exportedRows
                  }], fname, {
                    title: backupTitle,
                    periodText: tag === 'all' ? 'كافة الحجوزات' : tag
                  });
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

  async function mountCustomerNotesAdminPanel(hostEl, user, ctx) {
    if (!hostEl) return;
    var core = root.RGCrmCore;
    var isDev = Boolean(user && core && core.ROLES && user.role === core.ROLES.DEVELOPER);
    var canCfg = Boolean(isDev || (core && (core.canUserPerform(user, 'manage_customer_notes_settings') || core.canUserPerform(user, 'manage_settings'))));
    var canStatuses = Boolean(isDev || canCfg || (core && core.canUserPerform(user, 'manage_customer_note_statuses')));
    var canButtons = Boolean(isDev || canCfg || (core && core.canUserPerform(user, 'manage_customer_notes_buttons')));

    var state = {
      tab: canCfg ? 'general' : (canStatuses ? 'statuses' : 'buttons'),
      loading: true,
      config: core && core.normalizeCustomerNotesConfig ? core.normalizeCustomerNotesConfig({}) : {},
      statuses: core && Array.isArray(core.CUSTOMER_NOTE_DEFAULT_STATUSES) ? core.CUSTOMER_NOTE_DEFAULT_STATUSES.slice() : []
    };

    var ATT_TYPES = [
      { mime: 'image/png', label: 'صور PNG' },
      { mime: 'image/jpeg', label: 'صور JPG / JPEG' },
      { mime: 'image/webp', label: 'صور WebP' },
      { mime: 'application/pdf', label: 'ملفات PDF' },
      { mime: 'text/plain', label: 'ملفات نصية TXT' }
    ];
    var ROLES_META = [
      { key: 'developer', label: 'مبرمج' },
      { key: 'general_manager', label: 'مدير عام' },
      { key: 'supervisor', label: 'مشرف' },
      { key: 'agent', label: 'موظف' }
    ];
    var CUST_SECTION_LABELS = [
      { key: 'enableView', label: 'تفعيل قسم العملاء في النظام' },
      { key: 'enableAddCustomer', label: 'السماح بإضافة عميل جديد' },
      { key: 'enableEditCustomer', label: 'السماح بتعديل بيانات العميل' },
      { key: 'showSensitiveIds', label: 'عرض أرقام الهوية/الجواز للمخولين' },
      { key: 'showBookingsTab', label: 'إظهار تبويب الحجوزات في ملف العميل' },
      { key: 'showExtensionsTab', label: 'إظهار تبويب التمديدات في ملف العميل' },
      { key: 'showProblemsTab', label: 'إظهار تبويب الشكاوى والمشكلات' },
      { key: 'enableSearch', label: 'تفعيل البحث في دليل العملاء' },
      { key: 'enableFilters', label: 'تفعيل فلاتر حالات الحجز والتاريخ' },
      { key: 'enableInternalNotes', label: 'تفعيل الملاحظات الداخلية في ملف العميل' },
      { key: 'enableActivityLog', label: 'إظهار تبويب الخط الزمني وسجل النشاط' },
      { key: 'enableExport', label: 'إتاحة تصدير بيانات العملاء (PDF / Excel)' },
      { key: 'enablePrint', label: 'إتاحة طباعة بطاقة العميل' },
      { key: 'enableStatusManagement', label: 'إتاحة تغيير حالة العميل' }
    ];

    function syncDraftFromDom() {
      if (!hostEl) return;
      var cfg = state.config;
      if (state.tab === 'general') {
        var g = cfg.general;
        var elEn = hostEl.querySelector('#cna-gen-enabled');
        var elTitle = hostEl.querySelector('#cna-gen-title');
        var elPage = hostEl.querySelector('#cna-gen-pagesize');
        var elSort = hostEl.querySelector('#cna-gen-sort');
        var elMax = hostEl.querySelector('#cna-gen-maxres');
        var elSearch = hostEl.querySelector('#cna-gen-search');
        var elFilt = hostEl.querySelector('#cna-gen-filters');
        var elRet = hostEl.querySelector('#cna-gen-retention');
        if (elEn) g.enabled = Boolean(elEn.checked);
        if (elTitle) g.sectionTitle = String(elTitle.value || '').trim() || 'ملاحظات العملاء';
        if (elPage) g.pageSize = Math.max(5, Math.min(100, Number(elPage.value || 20)));
        if (elSort) g.defaultSort = String(elSort.value || 'newest');
        if (elMax) g.maxResults = Math.max(20, Math.min(1000, Number(elMax.value || 200)));
        if (elSearch) g.enableSearch = Boolean(elSearch.checked);
        if (elFilt) g.enableFilters = Boolean(elFilt.checked);
        if (elRet) g.retentionDays = Math.max(0, Number(elRet.value || 0));
      } else if (state.tab === 'buttons') {
        var catalog = (core && core.CUSTOMER_NOTES_BUTTON_CATALOG) || [];
        catalog.forEach(function (meta) {
          var b = cfg.buttons[meta.key];
          if (!b) return;
          var vis = hostEl.querySelector('.cna-btn-vis[data-key="' + meta.key + '"]');
          var en = hostEl.querySelector('.cna-btn-en[data-key="' + meta.key + '"]');
          var conf = hostEl.querySelector('.cna-btn-conf[data-key="' + meta.key + '"]');
          var logA = hostEl.querySelector('.cna-btn-log[data-key="' + meta.key + '"]');
          var noti = hostEl.querySelector('.cna-btn-noti[data-key="' + meta.key + '"]');
          if (vis) b.visible = Boolean(vis.checked);
          if (en) b.enabled = Boolean(en.checked);
          if (conf) b.requireConfirmation = Boolean(conf.checked);
          if (logA) b.logActivity = Boolean(logA.checked);
          if (noti) b.showSuccessNotification = Boolean(noti.checked);
          var rolesChecked = Array.prototype.slice.call(hostEl.querySelectorAll('.cna-btn-role[data-key="' + meta.key + '"]:checked')).map(function (c) { return c.value; });
          if (hostEl.querySelector('.cna-btn-role[data-key="' + meta.key + '"]')) {
            b.allowedRoles = rolesChecked;
          }
          var editClosed = hostEl.querySelector('.cna-btn-edit-closed[data-key="' + meta.key + '"]');
          var editOther = hostEl.querySelector('.cna-btn-edit-other[data-key="' + meta.key + '"]');
          var delClosed = hostEl.querySelector('.cna-btn-del-closed[data-key="' + meta.key + '"]');
          if (editClosed) b.allowEditAfterClose = Boolean(editClosed.checked);
          if (editOther) b.allowAgentEditOther = Boolean(editOther.checked);
          if (delClosed) b.allowDeleteAfterClose = Boolean(delClosed.checked);
        });
      } else if (state.tab === 'rules') {
        var an = cfg.addNote;
        var mapAddBool = {
          '#cna-add-req-title': 'requiredTitle',
          '#cna-add-req-res': 'requiredReservation',
          '#cna-add-standalone': 'allowStandalone',
          '#cna-add-res-linked': 'allowReservationLinked',
          '#cna-add-cust-only': 'allowCustomerOnly',
          '#cna-add-prb-linked': 'allowProblemLinked',
          '#cna-add-internal': 'allowInternalNotes',
          '#cna-add-editable': 'editableAfterSave'
        };
        Object.keys(mapAddBool).forEach(function (sel) {
          var el = hostEl.querySelector(sel);
          if (el) an[mapAddBool[sel]] = Boolean(el.checked);
        });
        var elMaxL = hostEl.querySelector('#cna-add-maxlen');
        var elAttMb = hostEl.querySelector('#cna-add-attmb');
        if (elMaxL) an.maxLength = Math.max(50, Math.min(20000, Number(elMaxL.value || 4000)));
        if (elAttMb) an.maxAttachmentSizeMb = Math.max(1, Math.min(25, Number(elAttMb.value || 5)));
        var attChecks = hostEl.querySelectorAll('.cna-add-atttype');
        if (attChecks.length) {
          an.allowedAttachmentTypes = Array.prototype.slice.call(attChecks).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        }

        var nf = cfg.notifications;
        var mapNfBool = {
          '#cna-nf-add': 'onAdd',
          '#cna-nf-status': 'onStatusChange',
          '#cna-nf-assign': 'onAssign',
          '#cna-nf-reply': 'onReplyUpdate',
          '#cna-nf-close': 'onClose'
        };
        Object.keys(mapNfBool).forEach(function (sel) {
          var el = hostEl.querySelector(sel);
          if (el) nf[mapNfBool[sel]] = Boolean(el.checked);
        });
        var nfRoles = hostEl.querySelectorAll('.cna-nf-role');
        if (nfRoles.length) {
          nf.notifyRoles = Array.prototype.slice.call(nfRoles).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        }

        var al = cfg.activityLog;
        var mapAlBool = {
          '#cna-al-add': 'trackAdd',
          '#cna-al-edit': 'trackEdit',
          '#cna-al-del': 'trackDelete',
          '#cna-al-status': 'trackStatusChange',
          '#cna-al-assign': 'trackAssign',
          '#cna-al-att': 'trackAttachments',
          '#cna-al-oldnew': 'includeOldNewValues',
          '#cna-al-src': 'includeSourceSection'
        };
        Object.keys(mapAlBool).forEach(function (sel) {
          var el = hostEl.querySelector(sel);
          if (el) al[mapAlBool[sel]] = Boolean(el.checked);
        });

        var cs = cfg.customersSection;
        hostEl.querySelectorAll('.cna-cs-chk').forEach(function (c) {
          var k = c.getAttribute('data-cs-key');
          if (k) cs[k] = Boolean(c.checked);
        });
      }
    }

    function openStatusEditorModal(existingStatus) {
      var modalRoot = document.getElementById('modal-root');
      if (!modalRoot) return;
      var isEdit = Boolean(existingStatus && existingStatus.id);
      var st = existingStatus || { id: '', name: '', description: '', color: '#3b82f6', sortOrder: 90, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: false };
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="cna-status-modal" role="dialog" aria-modal="true">' +
          '<form class="modal-panel" id="cna-status-form" style="max-width:520px;">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title">' + (isEdit ? 'تعديل حالة ملاحظة' : 'إضافة حالة ملاحظة جديدة') + '</h3>' +
              '<button type="button" class="btn btn-sm" id="cna-st-close">إغلاق</button>' +
            '</div>' +
            '<div class="form-grid-2">' +
              '<div class="form-group"><label class="form-label" for="cna-st-name">اسم الحالة *</label><input class="input" id="cna-st-name" required value="' + escapeHtml(st.name || '') + '" placeholder="مثال: متابعة عاجلة"></div>' +
              '<div class="form-group"><label class="form-label" for="cna-st-color">اللون المميز</label><input type="color" class="input" id="cna-st-color" style="height:40px;padding:4px;" value="' + escapeHtml(st.color || '#3b82f6') + '"></div>' +
              '<div class="form-group"><label class="form-label" for="cna-st-order">ترتيب العرض</label><input type="number" class="input tabular-nums" id="cna-st-order" min="0" max="9999" value="' + Number(st.sortOrder || 100) + '"></div>' +
              '<div class="form-group" style="justify-content:flex-end;">' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-st-active"' + (st.isActive !== false ? ' checked' : '') + '> <span>حالة نشطة (تظهر للملاحظات الجديدة)</span></label>' +
              '</div>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="cna-st-desc">وصف الحالة</label><input class="input" id="cna-st-desc" value="' + escapeHtml(st.description || '') + '" placeholder="وصف موجز لاستخدام هذه الحالة"></div>' +
            '<div class="checkbox-grid" style="margin-top:8px;">' +
              '<label class="checkbox-item"><input type="checkbox" id="cna-st-default"' + (st.isDefault ? ' checked' : '') + '> <span>الحالة الافتراضية</span></label>' +
              '<label class="checkbox-item"><input type="checkbox" id="cna-st-agent"' + (st.allowAgentSelect !== false ? ' checked' : '') + '> <span>متاحة لموظف خدمة العملاء</span></label>' +
              '<label class="checkbox-item"><input type="checkbox" id="cna-st-closed"' + (st.isClosedStatus ? ' checked' : '') + '> <span>تُعد حالة إغلاق / أرشفة</span></label>' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" id="cna-st-cancel">إلغاء</button>' +
              '<button type="submit" class="btn btn-primary" id="cna-st-save">حفظ الحالة</button>' +
            '</div>' +
          '</form>' +
        '</div>';
      var closeM = function () { modalRoot.innerHTML = ''; };
      modalRoot.querySelector('#cna-st-close').addEventListener('click', closeM);
      modalRoot.querySelector('#cna-st-cancel').addEventListener('click', closeM);
      modalRoot.querySelector('#cna-status-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var nameVal = String(modalRoot.querySelector('#cna-st-name').value || '').trim();
        if (!nameVal) { ctx.toast('اسم الحالة مطلوب.', true); return; }
        var saveBtn = modalRoot.querySelector('#cna-st-save');
        runWithLock(saveBtn, 'saveCustomerNoteStatus', async function () {
          var res = await root.RGApi.callApi('saveCustomerNoteStatus', {
            id: isEdit ? st.id : '',
            name: nameVal,
            description: String(modalRoot.querySelector('#cna-st-desc').value || '').trim(),
            color: String(modalRoot.querySelector('#cna-st-color').value || '#3b82f6'),
            sortOrder: Number(modalRoot.querySelector('#cna-st-order').value || 100),
            isActive: Boolean(modalRoot.querySelector('#cna-st-active').checked),
            isDefault: Boolean(modalRoot.querySelector('#cna-st-default').checked),
            allowAgentSelect: Boolean(modalRoot.querySelector('#cna-st-agent').checked),
            isClosedStatus: Boolean(modalRoot.querySelector('#cna-st-closed').checked)
          });
          if (res && res.success) {
            if (res.data && Array.isArray(res.data.statuses)) state.statuses = res.data.statuses;
            if (root.RGApp && typeof root.RGApp.setCustomerNoteStatuses === 'function') {
              root.RGApp.setCustomerNoteStatuses(state.statuses);
            }
            closeM();
            ctx.toast(res.message || 'تم حفظ حالة الملاحظة بنجاح.');
            renderPanel();
          } else {
            ctx.toast((res && res.message) || 'تعذر حفظ الحالة.', true);
          }
        });
      });
    }

    function openDeleteStatusModal(st) {
      var modalRoot = document.getElementById('modal-root');
      if (!modalRoot) return;
      var alternatives = state.statuses.filter(function (s) { return s.id !== st.id && s.isActive; });
      if (!alternatives.length) {
        ctx.toast('يجب إبقاء حالة نشطة واحدة على الأقل كبديل قبل الحذف.', true);
        return;
      }
      var hasLinked = Number(st.notesCount || 0) > 0;
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="cna-del-status-modal" role="dialog" aria-modal="true">' +
          '<form class="modal-panel" id="cna-del-st-form" style="max-width:480px;">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title" style="color:var(--status-danger-text,#f43f5e);">حذف الحالة: ' + escapeHtml(st.name) + '</h3>' +
              '<button type="button" class="btn btn-sm" id="cna-del-close">إغلاق</button>' +
            '</div>' +
            '<p style="font-size:13px;line-height:1.7;">' +
              (hasLinked
                ? ('توجد <strong>' + Number(st.notesCount || 0) + '</strong> ملاحظة مرتبطة بهذه الحالة. اختر الحالة البديلة لنقل الملاحظات تلقائياً قبل الحذف:')
                : 'سيتم حذف هذه الحالة من القائمة. يمكنك أيضاً تحديد حالة بديلة احتياطياً لأي ملاحظات مرتبطة:') +
            '</p>' +
            '<div class="form-group">' +
              '<label class="form-label" for="cna-del-repl">الحالة البديلة للملاحظات المرتبطة *</label>' +
              '<select class="select" id="cna-del-repl">' +
                alternatives.map(function (a) {
                  return '<option value="' + escapeHtml(a.id) + '" data-color="' + escapeHtml(a.color) + '">' + escapeHtml(a.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" id="cna-del-cancel">إلغاء</button>' +
              '<button type="submit" class="btn btn-danger" id="cna-del-confirm">تأكيد الحذف والترحيل</button>' +
            '</div>' +
          '</form>' +
        '</div>';
      if (root.RGCrmDropdowns && root.RGCrmDropdowns.enhanceAll) root.RGCrmDropdowns.enhanceAll(modalRoot);
      var closeM = function () { modalRoot.innerHTML = ''; };
      modalRoot.querySelector('#cna-del-close').addEventListener('click', closeM);
      modalRoot.querySelector('#cna-del-cancel').addEventListener('click', closeM);
      modalRoot.querySelector('#cna-del-st-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var replId = String(modalRoot.querySelector('#cna-del-repl').value || '');
        var confBtn = modalRoot.querySelector('#cna-del-confirm');
        runWithLock(confBtn, 'deleteCustomerNoteStatus:' + st.id, async function () {
          var res = await root.RGApi.callApi('deleteCustomerNoteStatus', {
            id: st.id,
            replacementStatusId: replId
          });
          if (res && res.success) {
            if (res.data && Array.isArray(res.data.statuses)) state.statuses = res.data.statuses;
            if (root.RGApp && typeof root.RGApp.setCustomerNoteStatuses === 'function') {
              root.RGApp.setCustomerNoteStatuses(state.statuses);
            }
            closeM();
            ctx.toast(res.message || 'تم حذف الحالة وترحيل الملاحظات المرتبطة.');
            renderPanel();
          } else {
            ctx.toast((res && res.message) || 'تعذر حذف الحالة.', true);
          }
        });
      });
    }

    function renderPanel() {
      if (!hostEl.isConnected) return;
      if (state.loading) {
        hostEl.innerHTML = '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
        return;
      }
      var cfg = state.config;
      var g = cfg.general;
      var an = cfg.addNote;
      var nf = cfg.notifications;
      var al = cfg.activityLog;
      var cs = cfg.customersSection;
      var catalog = (core && core.CUSTOMER_NOTES_BUTTON_CATALOG) || [];

      var tabsHtml =
        '<div class="rg-admin-tabs-bar">' +
          (canCfg ? '<button type="button" class="btn btn-sm ' + (state.tab === 'general' ? 'btn-primary' : '') + ' cna-tab-btn" data-tab="general">الإعدادات العامة</button>' : '') +
          (canStatuses ? '<button type="button" class="btn btn-sm ' + (state.tab === 'statuses' ? 'btn-primary' : '') + ' cna-tab-btn" data-tab="statuses">الحالات (' + state.statuses.length + ')</button>' : '') +
          (canButtons ? '<button type="button" class="btn btn-sm ' + (state.tab === 'buttons' ? 'btn-primary' : '') + ' cna-tab-btn" data-tab="buttons">مصفوفة الأزرار (14)</button>' : '') +
          (canCfg ? '<button type="button" class="btn btn-sm ' + (state.tab === 'rules' ? 'btn-primary' : '') + ' cna-tab-btn" data-tab="rules">قواعد الإضافة والإشعارات وقسم العملاء</button>' : '') +
        '</div>';

      var bodyHtml = '';
      if (state.tab === 'general') {
        bodyHtml =
          '<div class="form-grid-3">' +
            '<div class="form-group"><label class="form-label" for="cna-gen-title">عنوان القسم</label><input class="input" id="cna-gen-title" value="' + escapeHtml(g.sectionTitle) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="cna-gen-sort">الترتيب الافتراضي للملاحظات</label>' +
              '<select class="select" id="cna-gen-sort">' +
                '<option value="newest"' + (g.defaultSort === 'newest' ? ' selected' : '') + '>الأحدث أولاً</option>' +
                '<option value="oldest"' + (g.defaultSort === 'oldest' ? ' selected' : '') + '>الأقدم أولاً</option>' +
                '<option value="updated"' + (g.defaultSort === 'updated' ? ' selected' : '') + '>آخر تحديث</option>' +
                '<option value="status"' + (g.defaultSort === 'status' ? ' selected' : '') + '>حسب الحالة</option>' +
              '</select>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="cna-gen-pagesize">عدد الملاحظات بالصفحة</label><input type="number" class="input tabular-nums" id="cna-gen-pagesize" min="5" max="100" value="' + g.pageSize + '"></div>' +
            '<div class="form-group"><label class="form-label" for="cna-gen-maxres">الحد الأقصى للنتائج</label><input type="number" class="input tabular-nums" id="cna-gen-maxres" min="20" max="1000" value="' + g.maxResults + '"></div>' +
            '<div class="form-group"><label class="form-label" for="cna-gen-retention">مدة الاحتفاظ بالأرشيف (أيام / 0 = دائم)</label><input type="number" class="input tabular-nums" id="cna-gen-retention" min="0" max="3650" value="' + g.retentionDays + '"></div>' +
          '</div>' +
          '<div class="checkbox-grid" style="margin-top:8px;">' +
            '<label class="checkbox-item"><input type="checkbox" id="cna-gen-enabled"' + (g.enabled ? ' checked' : '') + '> <span>تفعيل قسم ملاحظات العملاء على مستوى النظام</span></label>' +
            '<label class="checkbox-item"><input type="checkbox" id="cna-gen-search"' + (g.enableSearch ? ' checked' : '') + '> <span>تفعيل مربع البحث السريع</span></label>' +
            '<label class="checkbox-item"><input type="checkbox" id="cna-gen-filters"' + (g.enableFilters ? ' checked' : '') + '> <span>تفعيل الفلاتر المتقدمة</span></label>' +
          '</div>';
      } else if (state.tab === 'statuses') {
        bodyHtml =
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
            '<span style="font-size:12.5px;color:var(--text-muted);">الحالات غير النشطة تبقى ظاهرة على الملاحظات القديمة لكن يُمنع اختيارها للملاحظات الجديدة.</span>' +
            '<button type="button" class="btn btn-sm btn-primary" id="cna-add-status-btn">+ إضافة حالة جديدة</button>' +
          '</div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>الحالة</th><th>الوصف</th><th>الترتيب</th><th>التصنيف</th><th>الملاحظات</th><th>إجراءات</th></tr></thead><tbody>' +
            state.statuses.map(function (st) {
              return '<tr>' +
                '<td><span class="rg-note-status-badge" style="--status-color:' + escapeHtml(st.color) + ';"><span class="rg-note-status-dot" style="background:' + escapeHtml(st.color) + ';"></span>' + escapeHtml(st.name) + '</span>' +
                  (st.isDefault ? ' <span class="status-tag status-info">افتراضية</span>' : '') +
                '</td>' +
                '<td style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(st.description || '-') + '</td>' +
                '<td class="tabular-nums">' + Number(st.sortOrder || 0) + '</td>' +
                '<td>' +
                  '<span class="status-tag ' + (st.isActive ? 'status-success' : 'status-danger') + '">' + (st.isActive ? 'نشطة' : 'معطلة') + '</span> ' +
                  (st.isClosedStatus ? '<span class="status-tag status-info">إغلاق</span> ' : '') +
                  (st.allowAgentSelect === false ? '<span class="status-tag status-warning">إدارية فقط</span>' : '') +
                '</td>' +
                '<td class="tabular-nums">' + Number(st.notesCount || 0) + '</td>' +
                '<td><div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm cna-st-edit-btn" data-id="' + escapeHtml(st.id) + '">تعديل</button>' +
                  '<button type="button" class="btn btn-sm cna-st-toggle-btn" data-id="' + escapeHtml(st.id) + '">' + (st.isActive ? 'تعطيل' : 'تفعيل') + '</button>' +
                  '<button type="button" class="btn btn-sm btn-danger cna-st-del-btn" data-id="' + escapeHtml(st.id) + '">حذف</button>' +
                '</div></td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>';
      } else if (state.tab === 'buttons') {
        bodyHtml =
          '<div class="table-wrap"><table class="table"><thead><tr><th>الزر / الإجراء</th><th>ظاهر</th><th>مفعل</th><th>تأكيد</th><th>تسجيل سجل</th><th>إشعار</th><th>الأدوار المخولة</th><th>قواعد إضافية</th></tr></thead><tbody>' +
            catalog.map(function (meta) {
              var b = cfg.buttons[meta.key] || {};
              var roles = Array.isArray(b.allowedRoles) ? b.allowedRoles : [];
              var extraHtml = '-';
              if (meta.key === 'edit_note') {
                extraHtml =
                  '<label class="checkbox-item" style="font-size:11.5px;"><input type="checkbox" class="cna-btn-edit-closed" data-key="edit_note"' + (b.allowEditAfterClose ? ' checked' : '') + '> بعد الإغلاق</label>' +
                  '<label class="checkbox-item" style="font-size:11.5px;"><input type="checkbox" class="cna-btn-edit-other" data-key="edit_note"' + (b.allowAgentEditOther ? ' checked' : '') + '> تعديل ملاحظة الغير</label>';
              } else if (meta.key === 'delete_note') {
                extraHtml = '<label class="checkbox-item" style="font-size:11.5px;"><input type="checkbox" class="cna-btn-del-closed" data-key="delete_note"' + (b.allowDeleteAfterClose ? ' checked' : '') + '> حذف بعد الإغلاق</label>';
              }
              return '<tr>' +
                '<td><strong>' + escapeHtml(meta.labelAr) + '</strong><div class="mono" style="font-size:11px;color:var(--text-muted);">' + escapeHtml(meta.key) + '</div></td>' +
                '<td><input type="checkbox" class="cna-btn-vis" data-key="' + escapeHtml(meta.key) + '"' + (b.visible !== false ? ' checked' : '') + ' aria-label="إظهار ' + escapeHtml(meta.labelAr) + '"></td>' +
                '<td><input type="checkbox" class="cna-btn-en" data-key="' + escapeHtml(meta.key) + '"' + (b.enabled !== false ? ' checked' : '') + ' aria-label="تفعيل ' + escapeHtml(meta.labelAr) + '"></td>' +
                '<td><input type="checkbox" class="cna-btn-conf" data-key="' + escapeHtml(meta.key) + '"' + (b.requireConfirmation ? ' checked' : '') + ' aria-label="تأكيد ' + escapeHtml(meta.labelAr) + '"></td>' +
                '<td><input type="checkbox" class="cna-btn-log" data-key="' + escapeHtml(meta.key) + '"' + (b.logActivity !== false ? ' checked' : '') + ' aria-label="سجل ' + escapeHtml(meta.labelAr) + '"></td>' +
                '<td><input type="checkbox" class="cna-btn-noti" data-key="' + escapeHtml(meta.key) + '"' + (b.showSuccessNotification !== false ? ' checked' : '') + ' aria-label="إشعار ' + escapeHtml(meta.labelAr) + '"></td>' +
                '<td><div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  ROLES_META.map(function (rm) {
                    return '<label class="checkbox-item" style="font-size:11.5px;"><input type="checkbox" class="cna-btn-role" data-key="' + escapeHtml(meta.key) + '" value="' + escapeHtml(rm.key) + '"' + (roles.indexOf(rm.key) !== -1 ? ' checked' : '') + '> ' + escapeHtml(rm.label) + '</label>';
                  }).join('') +
                '</div></td>' +
                '<td>' + extraHtml + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>';
      } else {
        bodyHtml =
          '<div style="display:flex;flex-direction:column;gap:14px;">' +
            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
              '<strong style="display:block;margin-bottom:8px;">قواعد الإضافة والمرفقات (addNote)</strong>' +
              '<div class="form-grid-2" style="margin-bottom:8px;">' +
                '<div class="form-group"><label class="form-label" for="cna-add-maxlen">أقصى عدد حروف للملاحظة</label><input type="number" class="input tabular-nums" id="cna-add-maxlen" min="50" max="20000" value="' + an.maxLength + '"></div>' +
                '<div class="form-group"><label class="form-label" for="cna-add-attmb">أقصى حجم للمرفق (MB)</label><input type="number" class="input tabular-nums" id="cna-add-attmb" min="1" max="25" value="' + an.maxAttachmentSizeMb + '"></div>' +
              '</div>' +
              '<div class="checkbox-grid">' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-req-title"' + (an.requiredTitle ? ' checked' : '') + '> <span>عنوان الملاحظة إلزامي</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-req-res"' + (an.requiredReservation ? ' checked' : '') + '> <span>الربط بحجز إلزامي</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-standalone"' + (an.allowStandalone ? ' checked' : '') + '> <span>السماح بملاحظات مستقلة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-res-linked"' + (an.allowReservationLinked ? ' checked' : '') + '> <span>السماح بالربط بالحجوزات</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-cust-only"' + (an.allowCustomerOnly ? ' checked' : '') + '> <span>السماح بملاحظات العميل فقط</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-prb-linked"' + (an.allowProblemLinked ? ' checked' : '') + '> <span>السماح بالربط بالمشكلات</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-internal"' + (an.allowInternalNotes ? ' checked' : '') + '> <span>السماح بالملاحظات الداخلية</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-add-editable"' + (an.editableAfterSave ? ' checked' : '') + '> <span>السماح بالتعديل بعد الحفظ</span></label>' +
              '</div>' +
              '<div style="margin-top:8px;"><span class="form-label">أنواع المرفقات المسموحة:</span><div class="checkbox-grid">' +
                ATT_TYPES.map(function (at) {
                  var chk = (an.allowedAttachmentTypes || []).indexOf(at.mime) !== -1;
                  return '<label class="checkbox-item"><input type="checkbox" class="cna-add-atttype" value="' + escapeHtml(at.mime) + '"' + (chk ? ' checked' : '') + '> <span>' + escapeHtml(at.label) + '</span></label>';
                }).join('') +
              '</div></div>' +
            '</div>' +

            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
              '<strong style="display:block;margin-bottom:8px;">الإشعارات وسجل النشاط (Notifications &amp; Activity Log)</strong>' +
              '<div class="checkbox-grid">' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-nf-add"' + (nf.onAdd ? ' checked' : '') + '> <span>إشعار عند إضافة ملاحظة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-nf-status"' + (nf.onStatusChange ? ' checked' : '') + '> <span>إشعار عند تغيير الحالة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-nf-assign"' + (nf.onAssign ? ' checked' : '') + '> <span>إشعار عند إسناد مهمة متابعة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-nf-reply"' + (nf.onReplyUpdate ? ' checked' : '') + '> <span>إشعار عند تعديل الملاحظة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-nf-close"' + (nf.onClose ? ' checked' : '') + '> <span>إشعار عند إغلاق الملاحظة</span></label>' +
              '</div>' +
              '<div style="margin-top:8px;"><span class="form-label">الأدوار المستلمة للإشعارات:</span><div class="checkbox-grid">' +
                ROLES_META.map(function (rm) {
                  var chk = (nf.notifyRoles || []).indexOf(rm.key) !== -1;
                  return '<label class="checkbox-item"><input type="checkbox" class="cna-nf-role" value="' + escapeHtml(rm.key) + '"' + (chk ? ' checked' : '') + '> <span>' + escapeHtml(rm.label) + '</span></label>';
                }).join('') +
              '</div></div>' +
              '<div class="checkbox-grid" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-hairline);">' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-add"' + (al.trackAdd ? ' checked' : '') + '> <span>تتبع الإضافة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-edit"' + (al.trackEdit ? ' checked' : '') + '> <span>تتبع التعديل</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-del"' + (al.trackDelete ? ' checked' : '') + '> <span>تتبع الحذف</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-status"' + (al.trackStatusChange ? ' checked' : '') + '> <span>تتبع تغيير الحالة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-assign"' + (al.trackAssign ? ' checked' : '') + '> <span>تتبع الإسناد</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-att"' + (al.trackAttachments ? ' checked' : '') + '> <span>تتبع المرفقات</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-oldnew"' + (al.includeOldNewValues ? ' checked' : '') + '> <span>تسجيل القيمة القديمة والجديدة</span></label>' +
                '<label class="checkbox-item"><input type="checkbox" id="cna-al-src"' + (al.includeSourceSection ? ' checked' : '') + '> <span>تسجيل القسم المصدر</span></label>' +
              '</div>' +
            '</div>' +

            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
              '<strong style="display:block;margin-bottom:8px;">خيارات قسم العملاء (Customers Section)</strong>' +
              '<div class="checkbox-grid">' +
                CUST_SECTION_LABELS.map(function (csl) {
                  return '<label class="checkbox-item"><input type="checkbox" class="cna-cs-chk" data-cs-key="' + escapeHtml(csl.key) + '"' + (cs[csl.key] !== false ? ' checked' : '') + '> <span>' + escapeHtml(csl.label) + '</span></label>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</div>';
      }

      var saveBtnHtml = (state.tab !== 'statuses' && (canCfg || canButtons))
        ? '<div style="margin-top:14px;display:flex;justify-content:flex-end;"><button type="button" class="btn btn-primary" id="cna-save-config-btn">حفظ إعدادات ملاحظات العملاء وقسم العملاء</button></div>'
        : '';

      hostEl.innerHTML = tabsHtml + bodyHtml + saveBtnHtml;

      if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
        root.RGCrmDropdowns.enhanceAll(hostEl);
      }

      hostEl.querySelectorAll('.cna-tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          syncDraftFromDom();
          state.tab = btn.getAttribute('data-tab') || 'general';
          renderPanel();
        });
      });

      var addStBtn = hostEl.querySelector('#cna-add-status-btn');
      if (addStBtn) {
        addStBtn.addEventListener('click', function () { openStatusEditorModal(null); });
      }
      hostEl.querySelectorAll('.cna-st-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sid = btn.getAttribute('data-id');
          var stObj = state.statuses.find(function (s) { return s.id === sid; });
          if (stObj) openStatusEditorModal(stObj);
        });
      });
      hostEl.querySelectorAll('.cna-st-toggle-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sid = btn.getAttribute('data-id');
          var stObj = state.statuses.find(function (s) { return s.id === sid; });
          if (!stObj) return;
          runWithLock(btn, 'toggleCustomerNoteStatus:' + sid, async function () {
            var res = await root.RGApi.callApi('toggleCustomerNoteStatus', { id: sid, isActive: !stObj.isActive });
            if (res && res.success) {
              if (res.data && Array.isArray(res.data.statuses)) state.statuses = res.data.statuses;
              if (root.RGApp && typeof root.RGApp.setCustomerNoteStatuses === 'function') {
                root.RGApp.setCustomerNoteStatuses(state.statuses);
              }
              ctx.toast(res.message || 'تم تحديث حالة التفعيل.');
              renderPanel();
            } else {
              ctx.toast((res && res.message) || 'تعذر تحديث الحالة.', true);
            }
          });
        });
      });
      hostEl.querySelectorAll('.cna-st-del-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sid = btn.getAttribute('data-id');
          var stObj = state.statuses.find(function (s) { return s.id === sid; });
          if (stObj) openDeleteStatusModal(stObj);
        });
      });

      var saveCfgBtn = hostEl.querySelector('#cna-save-config-btn');
      if (saveCfgBtn) {
        saveCfgBtn.addEventListener('click', function () {
          syncDraftFromDom();
          runWithLock(saveCfgBtn, 'saveCustomerNotesConfig', async function () {
            var res = await root.RGApi.callApi('saveCustomerNotesConfig', { config: state.config });
            if (res && res.success) {
              if (res.data && res.data.config) {
                state.config = core && core.normalizeCustomerNotesConfig
                  ? core.normalizeCustomerNotesConfig(res.data.config)
                  : res.data.config;
              }
              if (root.RGApp && typeof root.RGApp.setCustomerNotesConfig === 'function') {
                root.RGApp.setCustomerNotesConfig(state.config);
              }
              ctx.toast(res.message || 'تم حفظ إعدادات ملاحظات العملاء وقسم العملاء بنجاح.');
              renderPanel();
            } else {
              ctx.toast((res && res.message) || 'تعذر حفظ الإعدادات.', true);
            }
          });
        });
      }
    }

    renderPanel();
    try {
      var res = await root.RGApi.callApi('getCustomerNotesConfig', { abortKey: 'set:notesConfig' });
      if (res && res.aborted) return;
      if (res && res.success && res.data) {
        if (res.data.config) {
          state.config = core && core.normalizeCustomerNotesConfig
            ? core.normalizeCustomerNotesConfig(res.data.config)
            : res.data.config;
        }
        if (Array.isArray(res.data.statuses)) {
          state.statuses = res.data.statuses;
        }
      }
    } catch (_e) {}
    state.loading = false;
    renderPanel();
  }

  async function mountDeveloperIntegrityMonitorPanel(hostEl, ctx) {
    if (!hostEl) return;
    var core = root.RGCrmCore;
    var SCOPES_META = [
      { key: 'reservations', label: 'الحجوزات' },
      { key: 'extensions', label: 'التمديدات' },
      { key: 'cancelled', label: 'الإلغاءات والرفض' },
      { key: 'company_changes', label: 'تغييرات شركات التأجير' }
    ];
    var state = {
      loading: true,
      report: null,
      filters: { discrepancyType: '', resolutionStatus: 'open', search: '' }
    };

    async function loadReport() {
      state.loading = true;
      renderIntegrityPanel();
      try {
        var res = await root.RGApi.callApi('getDataIntegrityReport', Object.assign({ abortKey: 'set:integrity' }, state.filters));
        if (res && res.aborted) return;
        if (res && res.success && res.data) {
          state.report = res.data;
        } else if (ctx && ctx.toast && res && res.message) {
          ctx.toast(res.message, true);
        }
      } catch (_e) {}
      state.loading = false;
      renderIntegrityPanel();
    }

    function openIntegrityDiffModal(issueId) {
      var modalRoot = document.getElementById('modal-root');
      if (!modalRoot) return;
      root.RGApi.callApi('resolveDataIntegrityIssue', { issueId: issueId, previewOnly: true }).then(function (res) {
        if (!res || !res.success || !res.data) {
          ctx.toast((res && res.message) || 'تعذر تحميل معاينة الفروقات.', true);
          return;
        }
        var d = res.data;
        var rgP = d.rgProjection || {};
        var nP = d.neonProjection || {};
        var iss = d.issue || {};
        var COMP_FIELDS = [
          { key: 'reservationNumber', label: 'رقم الحجز' },
          { key: 'statusCode', label: 'رمز الحالة الأصلي' },
          { key: 'statusAr', label: 'الحالة العربية' },
          { key: 'customerName', label: 'اسم العميل' },
          { key: 'customerPhone', label: 'رقم الجوال' },
          { key: 'startDate', label: 'تاريخ الاستلام' },
          { key: 'endDate', label: 'تاريخ الإرجاع الفعلي' },
          { key: 'carName', label: 'السيارة' },
          { key: 'companyName', label: 'شركة التأجير' },
          { key: 'extensionsCount', label: 'عدد التمديدات' }
        ];
        modalRoot.innerHTML =
          '<div class="modal-backdrop" id="di-diff-modal" role="dialog" aria-modal="true">' +
            '<form class="modal-panel" id="di-diff-form" style="max-width:740px;">' +
              '<div class="modal-header">' +
                '<h3 class="modal-title">معاينة الفروقات وإصلاح السجل: <span class="mono">' + escapeHtml(iss.reservationNumber || iss.reservationId) + '</span></h3>' +
                '<button type="button" class="btn btn-sm" id="di-diff-close">إغلاق</button>' +
              '</div>' +
              '<div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:10px;">نوع التعارض: <strong>' + escapeHtml(iss.typeLabelAr || iss.discrepancyType) + '</strong></div>' +
              '<div class="table-wrap"><table class="rg-diff-table"><thead><tr><th>الحقل</th><th>قيمة Rental Gate API</th><th>قيمة Neon PostgreSQL</th></tr></thead><tbody>' +
                COMP_FIELDS.map(function (cf) {
                  var vRg = String(rgP[cf.key] !== undefined ? rgP[cf.key] : '-');
                  var vNe = String(nP[cf.key] !== undefined ? nP[cf.key] : '-');
                  var isDiff = vRg !== vNe;
                  return '<tr class="' + (isDiff ? 'is-diff' : '') + '"><td><strong>' + escapeHtml(cf.label) + '</strong></td><td>' + escapeHtml(vRg || '-') + '</td><td>' + escapeHtml(vNe || '-') + '</td></tr>';
                }).join('') +
              '</tbody></table></div>' +
              '<div class="form-grid-2" style="margin-top:12px;">' +
                '<div class="form-group"><label class="form-label" for="di-res-action">إجراء المعالجة</label>' +
                  '<select class="select" id="di-res-action">' +
                    '<option value="sync_from_rg">مزامنة وتحديث السجل من Rental Gate API</option>' +
                    '<option value="update_fields">تحديث الحقول المتعارضة فقط</option>' +
                    '<option value="mark_resolved">اعتماد السجل كمحلول</option>' +
                    '<option value="ignore">تجاهل التعارض</option>' +
                  '</select>' +
                '</div>' +
                '<div class="form-group"><label class="form-label" for="di-res-note">ملاحظة المبرمج (اختياري)</label>' +
                  '<input class="input" id="di-res-note" placeholder="سبب الإجراء أو ملاحظة التوثيق...">' +
                '</div>' +
              '</div>' +
              '<label class="checkbox-item" style="margin-top:8px;font-weight:700;"><input type="checkbox" id="di-approve-chk"> <span>أوافق بصفتي المبرمج على تنفيذ هذا التعديل بعد معاينة الفروقات أعلاه</span></label>' +
              '<div class="modal-footer">' +
                '<button type="button" class="btn" id="di-diff-cancel">إلغاء</button>' +
                '<button type="submit" class="btn btn-primary" id="di-exec-btn" disabled>تنفيذ الإجراء المعتمد</button>' +
              '</div>' +
            '</form>' +
          '</div>';
        if (root.RGCrmDropdowns && root.RGCrmDropdowns.enhanceAll) root.RGCrmDropdowns.enhanceAll(modalRoot);
        var closeM = function () { modalRoot.innerHTML = ''; };
        modalRoot.querySelector('#di-diff-close').addEventListener('click', closeM);
        modalRoot.querySelector('#di-diff-cancel').addEventListener('click', closeM);
        var appChk = modalRoot.querySelector('#di-approve-chk');
        var execBtn = modalRoot.querySelector('#di-exec-btn');
        appChk.addEventListener('change', function () { execBtn.disabled = !appChk.checked; });
        modalRoot.querySelector('#di-diff-form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (!appChk.checked) {
            ctx.toast('يرجى تحديد موافقة المبرمج الصريحة قبل التنفيذ.', true);
            return;
          }
          var actionVal = String(modalRoot.querySelector('#di-res-action').value || 'sync_from_rg');
          var noteVal = String(modalRoot.querySelector('#di-res-note').value || '').trim();
          runWithLock(execBtn, 'resolveDataIntegrityIssue:' + issueId, async function () {
            var execRes = await root.RGApi.callApi('resolveDataIntegrityIssue', {
              issueId: issueId,
              resolutionAction: actionVal,
              note: noteVal,
              approved: true
            });
            if (execRes && execRes.success) {
              closeM();
              ctx.toast(execRes.message || 'تم تنفيذ الإجراء وتسجيل نقطة التراجع.');
              loadReport();
            } else {
              ctx.toast((execRes && execRes.message) || 'تعذر تنفيذ الإجراء.', true);
            }
          });
        });
      });
    }

    function renderIntegrityPanel() {
      if (!hostEl.isConnected) return;
      if (state.loading && !state.report) {
        hostEl.innerHTML = '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
        return;
      }
      var rep = state.report || {};
      var intSettings = (core && core.normalizeDataIntegritySettings) ? core.normalizeDataIntegritySettings(rep.settings) : (rep.settings || {});
      var liveStats = rep.liveNeonStats || {};
      var latestRun = rep.latestRun || null;
      var latestAttempt = rep.latestAttempt || latestRun || null;
      var activeRunningRun = rep.activeRunningRun || null;
      var diQueryErrors = Array.isArray(rep.queryErrors) ? rep.queryErrors : [];
      var issues = Array.isArray(rep.issues) ? rep.issues : [];
      var actions = Array.isArray(rep.actions) ? rep.actions : [];
      var typeCatalog = (core && core.DATA_INTEGRITY_DISCREPANCY_TYPES) || {};

      var attemptAlertHtml = '';
      if (activeRunningRun) {
        attemptAlertHtml +=
          '<div class="rg-hc-alert-box is-warning" style="margin-bottom:10px;">' +
            '<div><strong>فحص قيد التنفيذ حالياً:</strong> بدأ منذ <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(activeRunningRun.startedAt, ctx)) + '</span> بواسطة ' + escapeHtml(activeRunningRun.triggeredByName || '-') + '.</div>' +
          '</div>';
      }
      if (latestAttempt && (latestAttempt.status === 'failed' || latestAttempt.status === 'partial')) {
        var attIsFail = latestAttempt.status === 'failed';
        var attErrTxt = latestAttempt.errorMessage || (attIsFail ? 'تعذر إتمام الفحص عبر Rental Gate API.' : 'اكتمل الفحص جزئياً بسبب عدم اكتمال بعض نقاط نهاية RG API.');
        attemptAlertHtml +=
          '<div class="rg-hc-alert-box ' + (attIsFail ? '' : 'is-warning') + '" style="margin-bottom:10px;">' +
            '<div style="flex:1;min-width:220px;">' +
              '<strong>' + (attIsFail ? 'فشل آخر محاولة فحص:' : 'تحذير — آخر فحص مكتمل جزئياً:') + '</strong> ' +
              escapeHtml(attErrTxt) +
              ' <span class="mono" dir="ltr" style="font-size:11px;opacity:.85;">(' + escapeHtml(formatSettingDateTime(latestAttempt.finishedAt || latestAttempt.startedAt, ctx)) + ')</span>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="di-copy-attempt-err-btn">نسخ تفاصيل الخطأ</button>' +
          '</div>';
      }
      if (diQueryErrors.length) {
        attemptAlertHtml +=
          '<div class="rg-hc-alert-box is-warning" style="margin-bottom:10px;">' +
            '<div><strong>تحذير استعلامات المراقبة (' + diQueryErrors.length + '):</strong> ' + escapeHtml(diQueryErrors.map(function (q) { return q.step + ': ' + q.message; }).join(' | ')) + '</div>' +
          '</div>';
      }

      var latestRunStatusLbl = latestRun
        ? (latestRun.status === 'partial' ? 'مكتمل جزئياً' : (latestRun.status === 'failed' ? 'فشل' : 'مكتمل'))
        : '';
      var latestRunStatusCls = latestRun
        ? (latestRun.status === 'partial' ? 'status-warning' : (latestRun.status === 'failed' ? 'status-danger' : 'status-success'))
        : 'status-neutral';
      var latestRgChecked = latestRun ? (latestRun.rgChecked !== false && Number(latestRun.rgCount || 0) >= 0) : false;

      hostEl.innerHTML =
        '<div class="rg-integrity-summary-grid">' +
          '<div class="rg-integrity-stat"><span class="k">إجمالي الحجوزات في Neon</span><span class="v tabular-nums">' + Number(liveStats.total || 0) + '</span></div>' +
          '<div class="rg-integrity-stat"><span class="k">الحجوزات النشطة</span><span class="v tabular-nums">' + Number(liveStats.activeCount || 0) + '</span></div>' +
          '<div class="rg-integrity-stat"><span class="k">الحجوزات المنتهية</span><span class="v tabular-nums">' + Number(liveStats.completedCount || 0) + '</span></div>' +
          '<div class="rg-integrity-stat"><span class="k">الملغاة</span><span class="v tabular-nums">' + Number(liveStats.cancelledCount || 0) + '</span></div>' +
          '<div class="rg-integrity-stat"><span class="k">المرفوضة</span><span class="v tabular-nums">' + Number(liveStats.rejectedCount || 0) + '</span></div>' +
          '<div class="rg-integrity-stat"><span class="k">التمديدات</span><span class="v tabular-nums">' + Number(liveStats.extensionsCount || 0) + '</span></div>' +
        '</div>' +

        attemptAlertHtml +

        (latestRun ? (
          '<div style="padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);margin-bottom:12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;font-size:12.5px;">' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
              '<span class="status-tag ' + latestRunStatusCls + '">' + escapeHtml(latestRunStatusLbl) + '</span>' +
              '<span>آخر فحص صالح: <strong dir="ltr">' + escapeHtml(formatSettingDateTime(latestRun.finishedAt || latestRun.startedAt, ctx)) + '</strong> (' + escapeHtml(latestRun.runMode === 'scheduled' ? 'مجدول' : 'يدوي') + ')</span>' +
            '</div>' +
            '<span>' +
              'Rental Gate API: <strong class="tabular-nums">' + (latestRgChecked ? Number(latestRun.rgCount || 0) : 'غير مفحوص') + '</strong>' +
              ' · Neon: <strong class="tabular-nums">' + Number(latestRun.neonCount || 0) + '</strong>' +
              ' · المتطابقة: <strong class="tabular-nums">' + Number(latestRun.matchedCount || 0) + '</strong>' +
              ' · الفروقات المكتشفة: <strong class="tabular-nums">' + Number(latestRun.discrepanciesCount || 0) + '</strong>' +
              (latestRun.durationMs ? (' · المدة: <strong class="mono tabular-nums" dir="ltr">' + Number(latestRun.durationMs) + 'ms</strong>') : '') +
            '</span>' +
          '</div>'
        ) : '<div style="padding:10px 12px;border:1px dashed var(--border-strong);border-radius:var(--radius-sm);margin-bottom:12px;font-size:12.5px;color:var(--text-muted);">لم يتم تسجيل أي فحص مقارنة مكتمل حتى الآن — اضغط "فحص الآن (قراءة فقط)" لبدء أول مقارنة مع Rental Gate API.</div>') +

        '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);margin-bottom:12px;">' +
          '<div class="form-grid-4">' +
            '<div class="form-group"><label class="form-label" for="di-mode">وضع المراقبة</label>' +
              '<select class="select" id="di-mode">' +
                '<option value="manual"' + (intSettings.mode === 'manual' ? ' selected' : '') + '>يدوي (عند الطلب فقط)</option>' +
                '<option value="scheduled"' + (intSettings.mode === 'scheduled' ? ' selected' : '') + '>مجدول تلقائياً</option>' +
              '</select>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="di-interval">الفاصل الزمني (دقائق)</label><input type="number" class="input tabular-nums" id="di-interval" min="5" max="1440" value="' + Number(intSettings.intervalMinutes || 60) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="di-date-from">من تاريخ</label><input type="date" class="input mono" id="di-date-from" dir="ltr" value="' + escapeHtml(intSettings.dateFrom || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="di-date-to">إلى تاريخ</label><input type="date" class="input mono" id="di-date-to" dir="ltr" value="' + escapeHtml(intSettings.dateTo || '') + '"></div>' +
          '</div>' +
          '<div class="checkbox-grid" style="margin-top:8px;">' +
            SCOPES_META.map(function (sc) {
              var chk = (intSettings.scopes || []).indexOf(sc.key) !== -1;
              return '<label class="checkbox-item"><input type="checkbox" class="di-scope-chk" value="' + escapeHtml(sc.key) + '"' + (chk ? ' checked' : '') + '> <span>' + escapeHtml(sc.label) + '</span></label>';
            }).join('') +
          '</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button type="button" class="btn btn-primary btn-sm" id="di-run-now-btn">فحص الآن (قراءة فقط)</button>' +
            '<button type="button" class="btn btn-sm" id="di-save-sched-btn">حفظ الجدولة والنطاق</button>' +
            '<button type="button" class="btn btn-sm ' + (intSettings.paused ? 'btn-primary' : 'btn-danger') + '" id="di-pause-btn">' + (intSettings.paused ? 'استئناف المراقبة' : 'إيقاف المراقبة مؤقتاً') + '</button>' +
            '<span class="status-tag ' + (intSettings.paused ? 'status-warning' : 'status-success') + '">' + (intSettings.paused ? 'متوقفة مؤقتاً' : 'نشطة') + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="toolbar-row" style="margin-bottom:10px;flex-wrap:wrap;">' +
          '<input type="search" class="input" id="di-filter-search" style="max-width:220px;" placeholder="بحث برقم الحجز..." value="' + escapeHtml(state.filters.search) + '">' +
          '<select class="select" id="di-filter-type" style="max-width:240px;">' +
            '<option value="">كل أنواع التعارضات</option>' +
            Object.keys(typeCatalog).map(function (tk) {
              return '<option value="' + escapeHtml(tk) + '"' + (state.filters.discrepancyType === tk ? ' selected' : '') + '>' + escapeHtml(typeCatalog[tk].labelAr || tk) + '</option>';
            }).join('') +
          '</select>' +
          '<select class="select" id="di-filter-status" style="max-width:180px;">' +
            '<option value="open"' + (state.filters.resolutionStatus === 'open' ? ' selected' : '') + '>المفتوحة فقط</option>' +
            '<option value="resolved"' + (state.filters.resolutionStatus === 'resolved' ? ' selected' : '') + '>المحلولة</option>' +
            '<option value="ignored"' + (state.filters.resolutionStatus === 'ignored' ? ' selected' : '') + '>المتجاهلة</option>' +
            '<option value=""' + (state.filters.resolutionStatus === '' ? ' selected' : '') + '>الكل</option>' +
          '</select>' +
          '<button type="button" class="btn btn-sm" id="di-apply-filters-btn">تطبيق الفلاتر</button>' +
        '</div>' +

        '<div class="table-wrap"><table class="table"><thead><tr><th>رقم الحجز</th><th>نوع التعارض</th><th>الحقل</th><th>قيمة RG API</th><th>قيمة Neon</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>' +
          (issues.length
            ? issues.map(function (iss) {
                var stCls = iss.resolutionStatus === 'resolved' ? 'status-success' : (iss.resolutionStatus === 'ignored' ? 'status-info' : 'status-danger');
                var stLbl = iss.resolutionStatus === 'resolved' ? 'محلولة' : (iss.resolutionStatus === 'ignored' ? 'متجاهلة' : 'مفتوحة');
                return '<tr>' +
                  '<td class="mono">' + escapeHtml(iss.reservationNumber || iss.reservationId || '-') + '</td>' +
                  '<td>' + escapeHtml(iss.typeLabelAr || iss.discrepancyType) + '</td>' +
                  '<td class="mono" dir="ltr">' + escapeHtml(iss.fieldName || '-') + '</td>' +
                  '<td style="font-size:12px;">' + escapeHtml(iss.rgValue || '-') + '</td>' +
                  '<td style="font-size:12px;">' + escapeHtml(iss.neonValue || '-') + '</td>' +
                  '<td><span class="status-tag ' + stCls + '">' + stLbl + '</span></td>' +
                  '<td><div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn btn-sm btn-primary di-preview-btn" data-id="' + escapeHtml(iss.id) + '">معاينة وإصلاح</button>' +
                    '<button type="button" class="btn btn-sm di-recheck-btn" data-id="' + escapeHtml(iss.id) + '" data-res-id="' + escapeHtml(iss.reservationId || '') + '">إعادة فحص</button>' +
                  '</div></td>' +
                '</tr>';
              }).join('')
            : '<tr><td colspan="7" class="empty-state">لا توجد فروقات أو تعارضات مطابقة حالياً.</td></tr>') +
        '</tbody></table></div>' +

        (actions.length ? (
          '<div style="margin-top:14px;">' +
            '<h4 style="margin:0 0 8px;font-size:13.5px;">سجل عمليات الإصلاح وإمكانية التراجع (Rollback)</h4>' +
            '<div class="table-wrap"><table class="table"><thead><tr><th>رقم الحجز</th><th>الإجراء</th><th>بواسطة</th><th>التاريخ</th><th>الحالة / التراجع</th></tr></thead><tbody>' +
              actions.slice(0, 15).map(function (act) {
                return '<tr>' +
                  '<td class="mono">' + escapeHtml(act.reservationNumber || act.reservationId || '-') + '</td>' +
                  '<td>' + escapeHtml(act.actionType || '-') + '</td>' +
                  '<td>' + escapeHtml(act.actorName || '-') + '</td>' +
                  '<td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(act.createdAt, ctx)) + '</td>' +
                  '<td>' +
                    (act.rolledBack
                      ? '<span class="status-tag status-info">تم التراجع</span>'
                      : (act.rollbackSupported
                          ? '<button type="button" class="btn btn-sm btn-danger di-rollback-btn" data-action-id="' + escapeHtml(act.id) + '">تراجع (Rollback)</button>'
                          : '<span class="status-tag status-success">منفذة</span>')) +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>' +
          '</div>'
        ) : '');

      if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
        root.RGCrmDropdowns.enhanceAll(hostEl);
      }

      var runNowBtn = hostEl.querySelector('#di-run-now-btn');
      if (runNowBtn) {
        runNowBtn.addEventListener('click', function () {
          var selectedScopes = Array.prototype.slice.call(hostEl.querySelectorAll('.di-scope-chk:checked')).map(function (c) { return c.value; });
          runWithLock(runNowBtn, 'runDataIntegrityCheck', async function () {
            var res = await root.RGApi.callApi('runDataIntegrityCheck', { runMode: 'manual', scopes: selectedScopes });
            if (res && res.success) {
              ctx.toast(res.message || 'اكتمل فحص سلامة البيانات.');
              loadReport();
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ الفحص.', true);
            }
          });
        });
      }

      var saveSchedBtn = hostEl.querySelector('#di-save-sched-btn');
      if (saveSchedBtn) {
        saveSchedBtn.addEventListener('click', function () {
          var selectedScopes = Array.prototype.slice.call(hostEl.querySelectorAll('.di-scope-chk:checked')).map(function (c) { return c.value; });
          runWithLock(saveSchedBtn, 'saveDataIntegritySettings', async function () {
            var res = await root.RGApi.callApi('saveDataIntegritySettings', {
              mode: String(hostEl.querySelector('#di-mode').value || 'manual'),
              intervalMinutes: Number(hostEl.querySelector('#di-interval').value || 60),
              dateFrom: String(hostEl.querySelector('#di-date-from').value || ''),
              dateTo: String(hostEl.querySelector('#di-date-to').value || ''),
              scopes: selectedScopes,
              paused: Boolean(intSettings.paused)
            });
            if (res && res.success) {
              ctx.toast(res.message || 'تم حفظ إعدادات الجدولة.');
              loadReport();
            } else {
              ctx.toast((res && res.message) || 'تعذر حفظ الإعدادات.', true);
            }
          });
        });
      }

      var pauseBtn = hostEl.querySelector('#di-pause-btn');
      if (pauseBtn) {
        pauseBtn.addEventListener('click', function () {
          runWithLock(pauseBtn, 'controlDataIntegrityMonitor', async function () {
            var res = await root.RGApi.callApi('controlDataIntegrityMonitor', { paused: !intSettings.paused });
            if (res && res.success) {
              ctx.toast(res.message || 'تم تحديث حالة المراقبة.');
              loadReport();
            } else {
              ctx.toast((res && res.message) || 'تعذر تحديث الحالة.', true);
            }
          });
        });
      }

      var applyFiltBtn = hostEl.querySelector('#di-apply-filters-btn');
      if (applyFiltBtn) {
        applyFiltBtn.addEventListener('click', function () {
          state.filters = {
            search: String((hostEl.querySelector('#di-filter-search') || {}).value || '').trim(),
            discrepancyType: String((hostEl.querySelector('#di-filter-type') || {}).value || ''),
            resolutionStatus: String((hostEl.querySelector('#di-filter-status') || {}).value || '')
          };
          loadReport();
        });
      }

      hostEl.querySelectorAll('.di-preview-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openIntegrityDiffModal(btn.getAttribute('data-id') || '');
        });
      });

      hostEl.querySelectorAll('.di-recheck-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var iid = btn.getAttribute('data-id') || '';
          var rid = btn.getAttribute('data-res-id') || '';
          runWithLock(btn, 'recheckDataIntegrityRecord:' + iid, async function () {
            var res = await root.RGApi.callApi('recheckDataIntegrityRecord', { issueId: iid, reservationId: rid });
            if (res && res.success) {
              ctx.toast(res.data && res.data.matched ? 'تطابق السجلان وتم إغلاق الفارق تلقائياً.' : 'تمت إعادة الفحص وما زال التعارض قائماً.');
              loadReport();
            } else {
              ctx.toast((res && res.message) || 'تعذر إعادة الفحص.', true);
            }
          });
        });
      });

      hostEl.querySelectorAll('.di-rollback-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var aid = btn.getAttribute('data-action-id') || '';
          runWithLock(btn, 'rollbackDataIntegrityAction:' + aid, async function () {
            var res = await root.RGApi.callApi('rollbackDataIntegrityAction', { actionId: aid });
            if (res && res.success) {
              ctx.toast(res.message || 'تم التراجع عن التعديل بنجاح.');
              loadReport();
            } else {
              ctx.toast((res && res.message) || 'تعذر التراجع عن العملية.', true);
            }
          });
        });
      });
      var copyErrBtn = hostEl.querySelector('#di-copy-attempt-err-btn');
      if (copyErrBtn && latestAttempt) {
        copyErrBtn.addEventListener('click', function () {
          var payloadStr = JSON.stringify({
            runId: latestAttempt.id,
            status: latestAttempt.status,
            startedAt: latestAttempt.startedAt,
            finishedAt: latestAttempt.finishedAt,
            errorMessage: latestAttempt.errorMessage || '',
            queryErrors: diQueryErrors
          }, null, 2);
          copyToClipboardSafe(payloadStr, 'تفاصيل خطأ فحص سلامة البيانات', ctx);
        });
      }
    }

    loadReport();
  }

  function copyToClipboardSafe(text, label, ctx) {
    var val = String(text || '');
    if (!val) {
      if (ctx && ctx.toast) ctx.toast('لا توجد تفاصيل لنسخها.', true);
      return;
    }
    var onDone = function () {
      if (ctx && ctx.toast) ctx.toast('تم نسخ ' + (label || 'التفاصيل') + ' إلى الحافظة.');
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(val).then(onDone).catch(function () {
        fallbackCopyText(val);
        onDone();
      });
    } else {
      fallbackCopyText(val);
      onDone();
    }
  }

  function fallbackCopyText(val) {
    try {
      var ta = document.createElement('textarea');
      ta.value = val;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_e) {}
  }

  async function mountDatabaseHealthCenterPanel(hostEl, ctx) {
    if (!hostEl) return;
    var state = {
      loading: true,
      report: null,
      selectedRunId: '',
      compareWithRg: true,
      timerId: null
    };

    var STATUS_META = {
      healthy: { label: 'Healthy — سليم', short: 'Healthy', cls: 'is-healthy' },
      warning: { label: 'Warning — تحذير', short: 'Warning', cls: 'is-warning' },
      critical: { label: 'Critical — حرج', short: 'Critical', cls: 'is-critical' },
      unknown: { label: 'Unknown — غير معروف', short: 'Unknown', cls: 'is-unknown' }
    };

    function badgeHtml(status) {
      var key = String(status || 'unknown').toLowerCase();
      var meta = STATUS_META[key] || STATUS_META.unknown;
      return '<span class="rg-hc-status-badge ' + meta.cls + '">' + escapeHtml(meta.label) + '</span>';
    }

    function clearTimer() {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
    }

    function syncAutoRefreshTimer() {
      clearTimer();
      if (!hostEl.isConnected) return;
      var rep = state.report || {};
      var setObj = rep.settings || {};
      if (!setObj.autoRefreshEnabled) return;
      var sec = Math.min(3600, Math.max(15, Math.round(Number(setObj.autoRefreshIntervalSec || 60))));
      state.timerId = setInterval(function () {
        if (!hostEl.isConnected) {
          clearTimer();
          return;
        }
        loadHealthReport(state.selectedRunId, true);
      }, sec * 1000);
    }

    async function loadHealthReport(runId, silent) {
      if (!silent) {
        state.loading = true;
        renderHealthPanel();
      }
      try {
        var res = await root.RGApi.callApi('getDatabaseHealthCenterReport', {
          abortKey: 'set:hc',
          runId: runId || state.selectedRunId || ''
        });
        if (res && res.aborted) return;
        if (res && res.success && res.data) {
          state.report = res.data;
          if (!state.selectedRunId && res.data.latestRun && res.data.latestRun.id) {
            state.selectedRunId = res.data.latestRun.id;
          }
          syncAutoRefreshTimer();
        } else if (!silent && ctx && ctx.toast && res && res.message) {
          ctx.toast(res.message, true);
        }
      } catch (_e) {}
      state.loading = false;
      renderHealthPanel();
    }

    function buildErrorBundleText(rep) {
      var secs = (rep && rep.sections) || {};
      var dbH = secs.database_health || {};
      var scH = secs.schema_integrity || {};
      var diH = secs.data_integrity || {};
      var syH = secs.sync_health || {};
      var bundle = {
        generatedAt: new Date().toISOString(),
        overallStatus: rep && rep.hasScanned ? rep.overallStatus : 'unknown',
        runId: rep && rep.latestRun ? rep.latestRun.id : null,
        errorDigest: (rep && rep.errorDigest) || { active: [], historical: [], resolved: [], counts: { active: 0, historical: 0, resolved: 0 } },
        databaseHealth: {
          status: dbH.status,
          probeError: dbH.probeError || '',
          queryErrors: dbH.queryErrors || [],
          lastConnectionError: dbH.lastConnectionError || null,
          recentErrors: (dbH.recentErrors || []).slice(0, 15)
        },
        schemaIntegrity: {
          status: scH.status,
          queryErrors: scH.queryErrors || [],
          missingTables: scH.missingTables || [],
          missingColumns: scH.missingColumns || [],
          extraColumns: scH.extraColumns || [],
          typeMismatches: scH.typeMismatches || [],
          constraintMismatches: scH.constraintMismatches || [],
          missingIndexes: scH.missingIndexes || [],
          pendingMigrations: scH.pendingMigrations || []
        },
        dataIntegrity: {
          status: diH.status,
          queryErrors: diH.queryErrors || [],
          rgError: (diH.rgComparison && diH.rgComparison.error) || '',
          anomalies: diH.anomalies || {}
        },
        syncHealth: {
          status: syH.status,
          queryErrors: syH.queryErrors || [],
          liveChecks: syH.liveChecks || null,
          tenPointSummary: syH.tenPointSummary || null,
          tenPointChecks: syH.tenPointChecks || [],
          lastSuccessfulUpsert: syH.lastSuccessfulUpsert || null,
          deploySkewWarning: syH.deploySkewWarning || '',
          workerLastError: syH.worker ? syH.worker.lastError : '',
          outboxCategoryBreakdown: (syH.outbox && syH.outbox.categoryBreakdown) || [],
          outboxErrorBreakdown: (syH.outbox && syH.outbox.errorBreakdown) || [],
          outboxRecentErrors: (syH.outbox && syH.outbox.recentErrors) || []
        }
      };
      return JSON.stringify(bundle, null, 2);
    }

    function openErrorDetailsModal(rep) {
      var modalRoot = document.getElementById('modal-root');
      if (!modalRoot) return;
      var txt = buildErrorBundleText(rep);
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="hc-err-modal" role="dialog" aria-modal="true">' +
          '<div class="modal-panel" style="max-width:780px;">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title">تفاصيل الأخطاء والاختلافات التقنية للمبرمج</h3>' +
              '<button type="button" class="btn btn-sm" id="hc-err-close">إغلاق</button>' +
            '</div>' +
            '<p style="margin:0;font-size:12px;color:var(--text-secondary);">جميع بيانات الاعتماد وروابط الاتصال السرية محجوبة تلقائياً.</p>' +
            '<pre class="mono" dir="ltr" style="max-height:55vh;overflow:auto;padding:12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--bg-surface-subtle);font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere;">' + escapeHtml(txt) + '</pre>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn btn-primary" id="hc-err-copy">نسخ تفاصيل الخطأ</button>' +
              '<button type="button" class="btn" id="hc-err-cancel">إغلاق</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      var closeM = function () { modalRoot.innerHTML = ''; };
      modalRoot.querySelector('#hc-err-close').addEventListener('click', closeM);
      modalRoot.querySelector('#hc-err-cancel').addEventListener('click', closeM);
      modalRoot.querySelector('#hc-err-copy').addEventListener('click', function () {
        copyToClipboardSafe(txt, 'تقرير الأخطاء التقنية', ctx);
      });
    }

    function exportHealthJson(rep) {
      try {
        var jsonText = JSON.stringify(rep, null, 2);
        var blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var dt = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = url;
        a.download = 'rg-database-health-' + dt + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        if (ctx && ctx.toast) ctx.toast('تم تصدير تقرير JSON بنجاح.');
      } catch (_e) {
        if (ctx && ctx.toast) ctx.toast('تعذر تصدير ملف JSON.', true);
      }
    }

    function exportHealthPdf(rep) {
      if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
        if (ctx && ctx.toast) ctx.toast('وحدة تصدير PDF غير متاحة حالياً.', true);
        return;
      }
      var secs = (rep && rep.sections) || {};
      var dbH = secs.database_health || {};
      var scH = secs.schema_integrity || {};
      var diH = secs.data_integrity || {};
      var syH = secs.sync_health || {};
      var hasScanned = Boolean(rep && rep.hasScanned);
      var ov = hasScanned ? (rep.overallStatus || 'unknown') : 'unknown';
      var latestRun = rep && rep.latestRun ? rep.latestRun : null;

      var sectionRows = [
        {
          section: '1. صحة قاعدة البيانات (Database Health)',
          status: dbH.status || 'unknown',
          metrics: 'الاتصال: ' + (dbH.connected ? 'متصل' : 'غير متصل') + ' · Latency: ' + Number(dbH.latencyMs || 0) + 'ms · أخطاء SQL/TX: ' + Number((dbH.errorCounts && dbH.errorCounts.sqlErrors) || 0) + '/' + Number((dbH.errorCounts && dbH.errorCounts.txErrors) || 0),
          checkedAt: formatSettingDateTime(dbH.checkedAt, ctx)
        },
        {
          section: '2. تطابق الجداول والأعمدة (Schema Integrity)',
          status: scH.status || 'unknown',
          metrics: 'الجداول: ' + Number(scH.totalTables || 0) + '/' + Number(scH.expectedTables || 0) + ' · أعمدة مفقودة: ' + Number((scH.missingColumns || []).length) + ' · قيود مفقودة: ' + Number((scH.constraintMismatches || []).length),
          checkedAt: formatSettingDateTime(scH.checkedAt, ctx)
        },
        {
          section: '3. سلامة البيانات (Data Integrity)',
          status: diH.status || 'unknown',
          metrics: 'Neon: ' + Number((diH.counts && diH.counts.reservations) || 0) + ' · RG API: ' + ((diH.rgComparison && diH.rgComparison.rgTotalCount !== null && diH.rgComparison.rgTotalCount !== undefined) ? diH.rgComparison.rgTotalCount : 'غير مفحوص') + ' · مكرر: ' + Number(((diH.anomalies && diH.anomalies.duplicateBookings) || []).length),
          checkedAt: formatSettingDateTime(diH.checkedAt, ctx)
        },
        {
          section: '4. سلامة المزامنة (Sync Health)',
          status: syH.status || 'unknown',
          metrics: 'Worker: ' + ((syH.worker && syH.worker.status) || '-') + ' · Outbox فاشلة: ' + Number((syH.outbox && syH.outbox.failed) || 0) + ' · معلقة: ' + (Number((syH.outbox && syH.outbox.pending) || 0) + Number((syH.outbox && syH.outbox.retry) || 0)),
          checkedAt: formatSettingDateTime(syH.checkedAt, ctx)
        }
      ];

      var diffRows = [];
      (scH.missingTables || []).forEach(function (x) {
        diffRows.push({ category: 'جدول مفقود', target: x.table, details: (x.codeRefs || []).join(', ') });
      });
      (scH.missingColumns || []).forEach(function (x) {
        diffRows.push({ category: 'عمود مفقود', target: x.table + '.' + x.column, details: 'النوع المتوقع: ' + x.expectedType });
      });
      (scH.constraintMismatches || []).forEach(function (x) {
        diffRows.push({ category: 'قيد/علاقة مفقودة', target: x.table + ' (' + x.constraintType + ')', details: (x.columns || []).join(', ') });
      });
      ((diH.rgComparison && diH.rgComparison.diffPreview) || []).slice(0, 20).forEach(function (d) {
        diffRows.push({ category: 'تعارض بيانات RG/Neon', target: (d.reservationNumber || '-') + ' · ' + (d.fieldName || d.type), details: 'RG: ' + (d.rgValue || '-') + ' | Neon: ' + (d.neonValue || '-') });
      });
      ((syH.outbox && syH.outbox.recentErrors) || []).slice(0, 15).forEach(function (o) {
        diffRows.push({ category: 'خطأ Outbox', target: o.entityType + ':' + o.entityId, details: o.error || o.status });
      });

      root.RGReports.openPdfStudio({
        title: 'تقرير مركز صحة قاعدة البيانات — Database Health Center',
        filename: 'database-health-center-' + new Date().toISOString().slice(0, 10) + '.pdf',
        lang: 'ar',
        scopeKey: 'db_health_center',
        summaryItems: [
          { label: 'التقييم العام', value: (STATUS_META[ov] && STATUS_META[ov].short) || ov },
          { label: 'آخر فحص', value: latestRun ? formatSettingDateTime(latestRun.finishedAt || latestRun.startedAt, ctx) : 'لم يُنفذ بعد' },
          { label: 'حالة Neon PostgreSQL', value: dbH.connected ? ('متصل (' + Number(dbH.latencyMs || 0) + 'ms)') : 'غير متصل' },
          { label: 'الجداول / الأعمدة', value: Number(scH.totalTables || 0) + ' / ' + Number(scH.totalColumns || 0) },
          { label: 'حجوزات Neon / RG', value: Number((diH.counts && diH.counts.reservations) || 0) + ' / ' + ((diH.rgComparison && diH.rgComparison.rgTotalCount !== null && diH.rgComparison.rgTotalCount !== undefined) ? diH.rgComparison.rgTotalCount : '-') },
          { label: 'مهام Outbox الفاشلة', value: String(Number((syH.outbox && syH.outbox.failed) || 0)) }
        ],
        columns: [
          { key: 'section', label: 'القسم' },
          { key: 'status', label: 'الحالة' },
          { key: 'metrics', label: 'المؤشرات الرئيسية' },
          { key: 'checkedAt', label: 'تاريخ الفحص' }
        ],
        rows: sectionRows,
        tables: diffRows.length ? [{
          title: 'الاختلافات والأخطاء المرصودة',
          columns: [
            { key: 'category', label: 'التصنيف' },
            { key: 'target', label: 'العنصر / المرجع' },
            { key: 'details', label: 'التفاصيل' }
          ],
          rows: diffRows
        }] : [],
        extraSections: [{
          title: 'آخر مزامنة ناجحة حسب المصدر',
          lines: [
            'Rental Gate API: ' + formatSettingDateTime(syH.lastSuccessBySource && syH.lastSuccessBySource.rentalGateApi, ctx),
            'Neon PostgreSQL: ' + formatSettingDateTime(syH.lastSuccessBySource && syH.lastSuccessBySource.neonPostgres, ctx),
            'Google Apps Script / Sheets: ' + formatSettingDateTime(syH.lastSuccessBySource && syH.lastSuccessBySource.googleAppsScriptSheets, ctx)
          ]
        }],
        initialSettings: { paperSize: 'a4', orientation: 'landscape' },
        ctx: ctx
      });
    }

    function renderHealthPanel() {
      if (!hostEl.isConnected) {
        clearTimer();
        return;
      }
      if (state.loading && !state.report) {
        hostEl.innerHTML = '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
        return;
      }
      var rep = state.report || {};
      var hasScanned = Boolean(rep.hasScanned);
      var overallStatus = hasScanned ? String(rep.overallStatus || 'unknown').toLowerCase() : 'unknown';
      if (!hasScanned && overallStatus === 'healthy') overallStatus = 'unknown';
      var latestRun = rep.latestRun || null;
      var history = Array.isArray(rep.history) ? rep.history : [];
      var secs = rep.sections || {};
      var dbH = secs.database_health || { status: 'unknown' };
      var scH = secs.schema_integrity || { status: 'unknown' };
      var diH = secs.data_integrity || { status: 'unknown' };
      var syH = secs.sync_health || { status: 'unknown' };
      var hcSet = rep.settings || { autoRefreshEnabled: false, autoRefreshIntervalSec: 60 };
      var poolSnap = rep.poolSnapshot || dbH.pool || {};

      var dbConns = dbH.connections || {};
      var dbPool = dbH.pool || {};
      var dbStats = dbH.databaseStats || {};
      var dbErrCounts = dbH.errorCounts || {};
      var slowQueries = Array.isArray(dbH.slowQueries) ? dbH.slowQueries : [];
      var recentDbErrs = Array.isArray(dbH.recentErrors) ? dbH.recentErrors : [];

      var missingTables = Array.isArray(scH.missingTables) ? scH.missingTables : [];
      var missingCols = Array.isArray(scH.missingColumns) ? scH.missingColumns : [];
      var extraCols = Array.isArray(scH.extraColumns) ? scH.extraColumns : [];
      var extraTables = Array.isArray(scH.extraTables) ? scH.extraTables : [];
      var typeMismatches = Array.isArray(scH.typeMismatches) ? scH.typeMismatches : [];
      var constraintMismatches = Array.isArray(scH.constraintMismatches) ? scH.constraintMismatches : [];
      var missingIndexes = Array.isArray(scH.missingIndexes) ? scH.missingIndexes : [];
      var pendingMigrations = Array.isArray(scH.pendingMigrations) ? scH.pendingMigrations : [];
      var appliedMigrations = Array.isArray(scH.migrations) ? scH.migrations : [];

      var diCounts = diH.counts || {};
      var diAnom = diH.anomalies || {};
      var diOrphChild = diAnom.orphanChildren || {};
      var diIncCust = diAnom.incompleteCustomers || {};
      var diCustQual = diAnom.customerQuality || {
        required: { missingPhone: Number(diIncCust.missingPhone || 0) },
        optionalSourceGaps: {
          missingIdNumber: Number(diIncCust.missingIdNumber || 0),
          missingEmail: Number(diIncCust.missingEmail || 0)
        }
      };
      var diLatest = diH.latestIntegrityRun || null;
      var rgCmp = diH.rgComparison || {};

      var syWorker = syH.worker || null;
      var syOutbox = syH.outbox || {};
      var syCheckpoints = Array.isArray(syH.checkpoints) ? syH.checkpoints : [];
      var syErrBreak = Array.isArray(syOutbox.errorBreakdown) ? syOutbox.errorBreakdown : [];
      var syCatBreak = Array.isArray(syOutbox.categoryBreakdown) ? syOutbox.categoryBreakdown : [];
      var syRecentErrs = Array.isArray(syOutbox.recentErrors) ? syOutbox.recentErrors : [];
      var sySources = syH.lastSuccessBySource || {};
      var syLive = syH.liveChecks || {};
      var syTenChecks = Array.isArray(syH.tenPointChecks) ? syH.tenPointChecks : [];
      var syTenSummary = syH.tenPointSummary || { total: syTenChecks.length, healthy: 0, warning: 0, critical: 0 };
      var syLastUpsert = syH.lastSuccessfulUpsert || {};
      var errDigest = rep.errorDigest || { active: [], historical: [], resolved: [], counts: { active: 0, historical: 0, resolved: 0 } };
      var activeDigest = Array.isArray(errDigest.active) ? errDigest.active : [];
      var historicalDigest = Array.isArray(errDigest.historical) ? errDigest.historical : [];
      var resolvedDigest = Array.isArray(errDigest.resolved) ? errDigest.resolved : [];

      var totalSchemaDiffs = missingTables.length + missingCols.length + extraCols.length +
        extraTables.filter(function (t) { return !t.isSampleTable; }).length +
        typeMismatches.length + constraintMismatches.length + missingIndexes.length + pendingMigrations.length;

      var orphanTotal = Number(diOrphChild.followUps || 0) + Number(diOrphChild.assignments || 0) + Number(diOrphChild.customerNotes || 0);

      hostEl.innerHTML =
        '<div class="rg-hc-shell">' +
          '<div class="rg-hc-banner ' + ((STATUS_META[overallStatus] && STATUS_META[overallStatus].cls) || 'is-unknown') + '" id="hc-overall-banner">' +
            '<div class="rg-hc-banner-main">' +
              '<div class="rg-hc-banner-title-row">' +
                '<h3 class="rg-hc-banner-title">Overall Database Health</h3>' +
                badgeHtml(overallStatus) +
              '</div>' +
              '<div class="rg-hc-banner-meta">' +
                (latestRun
                  ? ('<span>آخر فحص: <strong dir="ltr">' + escapeHtml(formatSettingDateTime(latestRun.finishedAt || latestRun.startedAt, ctx)) + '</strong></span>' +
                     '<span>النطاق: <strong>' + escapeHtml(latestRun.scope || 'all') + '</strong></span>' +
                     '<span>المدة: <strong class="mono tabular-nums" dir="ltr">' + Number(latestRun.durationMs || 0) + 'ms</strong></span>' +
                     '<span>بواسطة: <strong>' + escapeHtml(latestRun.triggeredByName || '-') + '</strong></span>')
                  : '<span>لم يتم تنفيذ أي فحص فعلي بعد — لا تُعرض حالة Healthy قبل اكتمال الفحص الحقيقي.</span>') +
                '<span>Pool: <strong class="mono tabular-nums" dir="ltr">' + Number(poolSnap.totalCount || 0) + '/' + Number(poolSnap.maxPoolSize || 0) + '</strong></span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="rg-hc-controls-bar">' +
            '<div class="rg-hc-controls-group">' +
              '<button type="button" class="btn btn-primary btn-sm" id="hc-scan-all-btn">فحص شامل لجميع الأقسام</button>' +
              '<label class="checkbox-item" style="margin:0;"><input type="checkbox" id="hc-compare-rg-chk"' + (state.compareWithRg ? ' checked' : '') + '> <span>مقارنة حية مع RG API</span></label>' +
            '</div>' +
            '<div class="rg-hc-controls-group">' +
              '<select class="select" id="hc-history-select" aria-label="سجل الفحوصات السابقة" style="min-width:220px;">' +
                (history.length
                  ? history.map(function (h) {
                      var sel = (latestRun && latestRun.id === h.id) ? ' selected' : '';
                      return '<option value="' + escapeHtml(h.id) + '"' + sel + '>' + escapeHtml(formatSettingDateTime(h.finishedAt || h.startedAt, ctx) + ' · ' + h.scope + ' (' + h.overallStatus + ')') + '</option>';
                    }).join('')
                  : '<option value="">سجل الفحوصات السابقة (فارغ)</option>') +
              '</select>' +
              '<button type="button" class="btn btn-sm" id="hc-view-errors-btn">تفاصيل الأخطاء</button>' +
              '<button type="button" class="btn btn-sm" id="hc-copy-errors-btn">نسخ الأخطاء للمبرمج</button>' +
              '<button type="button" class="btn btn-sm" id="hc-export-json-btn">تصدير JSON</button>' +
              '<button type="button" class="btn btn-sm" id="hc-export-pdf-btn">تصدير PDF</button>' +
            '</div>' +
          '</div>' +

          '<div class="rg-hc-autorefresh-bar">' +
            '<label class="checkbox-item" style="margin:0;"><input type="checkbox" id="hc-autorefresh-chk"' + (hcSet.autoRefreshEnabled ? ' checked' : '') + '> <span>تفعيل التحديث التلقائي للعرض كل</span></label>' +
            '<input type="number" class="input tabular-nums" id="hc-autorefresh-sec" min="15" max="3600" style="width:90px;" value="' + Number(hcSet.autoRefreshIntervalSec || 60) + '" aria-label="الفاصل بالثواني">' +
            '<span style="color:var(--text-muted);">ثانية (15–3600)</span>' +
            '<button type="button" class="btn btn-sm" id="hc-save-settings-btn">حفظ الإعداد</button>' +
          '</div>' +

          (function () {
            function renderDigestList(items, rowCls, emptyText) {
              if (!items.length) {
                return '<div style="font-size:12px;color:var(--text-muted);">' + escapeHtml(emptyText) + '</div>';
              }
              return '<div class="rg-hc-scroll-list">' +
                items.slice(0, 12).map(function (it) {
                  return '<div class="rg-hc-issue-row ' + rowCls + '">' +
                    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                      '<strong>[' + escapeHtml(it.errorCategory || 'runtime') + '] ' + escapeHtml(it.affectedService || '-') + '</strong>' +
                      '<span class="tabular-nums" style="font-size:11.5px;">التكرار: ' + Number(it.occurrences || 1) + '</span>' +
                    '</div>' +
                    '<div class="mono" dir="ltr" style="font-size:11px;overflow-wrap:anywhere;">' + escapeHtml(it.sampleMessage || '') + '</div>' +
                    '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);">' +
                      '<span>أول رصد: <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(it.firstSeenAt, ctx)) + '</span></span>' +
                      '<span>آخر رصد: <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(it.lastSeenAt, ctx)) + '</span></span>' +
                      '<span>آخر نجاح: <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(it.lastSuccessfulOperation, ctx)) + '</span></span>' +
                    '</div>' +
                    (it.suggestedFix ? ('<div style="font-size:11.5px;color:var(--text-secondary);"><strong>الإصلاح المقترح:</strong> ' + escapeHtml(it.suggestedFix) + '</div>') : '') +
                  '</div>';
                }).join('') +
              '</div>';
            }
            return '<section class="rg-hc-section-card ' + (activeDigest.length ? 'is-warning' : 'is-healthy') + '" id="hc-error-digest-card" style="margin-bottom:14px;">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">تصنيف الأخطاء: نشطة vs تاريخية vs محلولة</h4>' +
                  '<p class="rg-hc-section-sub">فصل الأعطال النشطة التي تمنع حالة Healthy عن السجلات التاريخية أو الأخطاء التي تلتها عمليات ناجحة.</p>' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
                  '<span class="rg-hc-status-badge ' + (activeDigest.length ? 'is-critical' : 'is-healthy') + '">نشطة: ' + activeDigest.length + '</span>' +
                  '<span class="rg-hc-status-badge ' + (historicalDigest.length ? 'is-warning' : 'is-unknown') + '">تاريخية: ' + historicalDigest.length + '</span>' +
                  '<span class="rg-hc-status-badge is-healthy">محلولة: ' + resolvedDigest.length + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>أخطاء نشطة حالياً (' + activeDigest.length + ')</span></div>' +
                renderDigestList(activeDigest, 'is-critical', 'لا توجد أخطاء نشطة في الفحص الحالي.') +
              '</div>' +
              (historicalDigest.length ? (
                '<div class="rg-hc-subbox">' +
                  '<div class="rg-hc-subbox-head"><span>أخطاء تاريخية (أقدم من 24 ساعة) (' + historicalDigest.length + ')</span></div>' +
                  renderDigestList(historicalDigest, 'is-warning', '') +
                '</div>'
              ) : '') +
              (resolvedDigest.length ? (
                '<div class="rg-hc-subbox">' +
                  '<div class="rg-hc-subbox-head"><span>أخطاء سابقة تم تجاوزها بنجاح لاحق (' + resolvedDigest.length + ')</span></div>' +
                  renderDigestList(resolvedDigest, '', '') +
                '</div>'
              ) : '') +
            '</section>';
          })() +

          '<div class="rg-hc-sections-grid">' +

            // 1. Database Health
            '<section class="rg-hc-section-card ' + ((STATUS_META[dbH.status] && STATUS_META[dbH.status].cls) || 'is-unknown') + '" id="hc-sec-database">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">1. Database Health — صحة قاعدة البيانات</h4>' +
                  '<p class="rg-hc-section-sub">' + escapeHtml(dbH.pgVersion || 'Neon PostgreSQL') + (dbH.dbName ? (' · ' + escapeHtml(dbH.dbName)) : '') + '</p>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
                  badgeHtml(dbH.status || 'unknown') +
                  '<button type="button" class="btn btn-sm hc-rescan-btn" data-section="database_health">إعادة فحص</button>' +
                '</div>' +
              '</div>' +
              (dbH.probeError ? '<div class="rg-hc-alert-box"><div><strong>خطأ الاتصال/الفحص:</strong> ' + escapeHtml(dbH.probeError) + '</div></div>' : '') +
              (dbH.recommendedAction ? '<div class="rg-hc-alert-box is-warning"><div><strong>الإجراء الموصى به:</strong> ' + escapeHtml(dbH.recommendedAction) + '</div></div>' : '') +
              ((dbH.queryErrors && dbH.queryErrors.length) ? '<div class="rg-hc-alert-box is-warning"><div><strong>تعذر بعض استعلامات المراقبة:</strong> ' + escapeHtml(dbH.queryErrors.map(function (q) { return q.step + ': ' + q.message; }).join(' | ')) + '</div></div>' : '') +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">حالة الاتصال بـ Neon</span><span class="rg-hc-kv-v ' + (dbH.connected ? 'is-success' : 'is-danger') + '">' + (hasScanned && dbH.checkedAt ? (dbH.connected ? 'متصل' : 'غير متصل') : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">زمن الاستجابة</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + (dbH.checkedAt ? (Number(dbH.latencyMs || 0) + ' ms') : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Connection Pool</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + Number(dbPool.totalCount || 0) + '/' + Number(dbPool.maxPoolSize || 0) + ' (idle ' + Number(dbPool.idleCount || 0) + ', wait ' + Number(dbPool.waitingCount || 0) + ')</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الاتصالات النشطة</span><span class="rg-hc-kv-v tabular-nums">' + Number(dbConns.active || 0) + ' / ' + Number(dbConns.maxConnections || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">حالة الاستعلامات</span><span class="rg-hc-kv-v tabular-nums">انتظار ' + Number(dbConns.waiting || 0) + ' · Tx معلقة ' + Number(dbConns.idleInTransaction || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أطول استعلام نشط</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + Number(dbConns.longestQueryMs || 0) + ' ms</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أخطاء SQL (7 أيام)</span><span class="rg-hc-kv-v tabular-nums ' + (Number(dbErrCounts.sqlErrors || 0) > 0 ? 'is-danger' : '') + '">' + Number(dbErrCounts.sqlErrors || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أخطاء Transactions</span><span class="rg-hc-kv-v tabular-nums ' + (Number(dbErrCounts.txErrors || 0) > 0 ? 'is-danger' : '') + '">' + Number(dbErrCounts.txErrors || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">استهلاك القاعدة / Cache Hit</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + Number(dbStats.dbSizeMb || 0) + ' MB · ' + Number(dbStats.cacheHitRatioPct || 0) + '%</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Commits / Rollbacks / Deadlocks</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + Number(dbStats.commits || 0) + ' / ' + Number(dbStats.rollbacks || 0) + ' / ' + Number(dbStats.deadlocks || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر اتصال ناجح</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(formatSettingDateTime(dbH.lastSuccessAt, ctx)) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر خطأ اتصال</span><span class="rg-hc-kv-v" style="font-size:11.5px;">' + escapeHtml(dbH.lastConnectionError ? (dbH.lastConnectionError.message || '').slice(0, 70) : 'لا يوجد') + '</span></div>' +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>الاستعلامات البطيئة (' + slowQueries.length + ')</span><span class="mono" style="font-size:11px;color:var(--text-muted);">' + (dbH.pgStatStatementsAvailable ? 'pg_stat_statements' : 'pg_stat_activity') + '</span></div>' +
                (slowQueries.length
                  ? '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>الاستعلام</th><th>Calls</th><th>Mean</th><th>Max</th></tr></thead><tbody>' +
                      slowQueries.slice(0, 6).map(function (sq) {
                        return '<tr><td class="mono" dir="ltr" style="max-width:260px;overflow-wrap:anywhere;">' + escapeHtml(sq.query || '') + '</td><td class="tabular-nums">' + Number(sq.calls || 0) + '</td><td class="mono tabular-nums" dir="ltr">' + Number(sq.meanMs || 0) + 'ms</td><td class="mono tabular-nums" dir="ltr">' + Number(sq.maxMs || 0) + 'ms</td></tr>';
                      }).join('') +
                    '</tbody></table></div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">لا توجد استعلامات بطيئة مرصودة حالياً.</div>') +
              '</div>' +
              (recentDbErrs.length ? (
                '<div class="rg-hc-subbox">' +
                  '<div class="rg-hc-subbox-head"><span>أحدث أخطاء الخادم وSQL (' + recentDbErrs.length + ')</span><button type="button" class="btn btn-sm hc-copy-db-errs">نسخ</button></div>' +
                  '<div class="rg-hc-scroll-list">' +
                    recentDbErrs.slice(0, 8).map(function (er) {
                      return '<div class="rg-hc-issue-row ' + (er.category === 'transaction' || er.category === 'sql' ? 'is-critical' : 'is-warning') + '">' +
                        '<div style="display:flex;justify-content:space-between;gap:6px;"><strong>[' + escapeHtml(er.category || 'runtime') + '] ' + escapeHtml(er.action || er.context || '-') + '</strong><span class="mono" dir="ltr" style="font-size:11px;color:var(--text-muted);">' + escapeHtml(formatSettingDateTime(er.createdAt, ctx)) + '</span></div>' +
                        '<div style="overflow-wrap:anywhere;">' + escapeHtml(er.message || '') + '</div>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                '</div>'
              ) : '') +
            '</section>' +

            // 2. Schema Integrity
            '<section class="rg-hc-section-card ' + ((STATUS_META[scH.status] && STATUS_META[scH.status].cls) || 'is-unknown') + '" id="hc-sec-schema">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">2. Schema Integrity — تطابق الجداول والأعمدة</h4>' +
                  '<p class="rg-hc-section-sub">مقارنة البنية الفعلية في Neon مع مخطط الكود (schemaSql.ts + Migrations)</p>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
                  badgeHtml(scH.status || 'unknown') +
                  '<button type="button" class="btn btn-sm hc-rescan-btn" data-section="schema_integrity">إعادة فحص</button>' +
                '</div>' +
              '</div>' +
              ((scH.queryErrors && scH.queryErrors.length) ? '<div class="rg-hc-alert-box is-warning"><div><strong>ملاحظة استعلام Schema:</strong> ' + escapeHtml(scH.queryErrors.map(function (q) { return q.step + ': ' + q.message; }).join(' | ')) + '</div></div>' : '') +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">إجمالي الجداول (فعلي / متوقع)</span><span class="rg-hc-kv-v tabular-nums">' + Number(scH.totalTables || 0) + ' / ' + Number(scH.expectedTables || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">إجمالي الأعمدة (فعلي / متوقع)</span><span class="rg-hc-kv-v tabular-nums">' + Number(scH.totalColumns || 0) + ' / ' + Number(scH.expectedColumns || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الجداول المفقودة</span><span class="rg-hc-kv-v tabular-nums ' + (missingTables.length ? 'is-danger' : 'is-success') + '">' + missingTables.length + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الأعمدة المفقودة</span><span class="rg-hc-kv-v tabular-nums ' + (missingCols.length ? 'is-danger' : 'is-success') + '">' + missingCols.length + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الأعمدة الزائدة</span><span class="rg-hc-kv-v tabular-nums ' + (extraCols.length ? 'is-warning' : '') + '">' + extraCols.length + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">اختلاف أنواع البيانات</span><span class="rg-hc-kv-v tabular-nums ' + (typeMismatches.length ? 'is-warning' : '') + '">' + typeMismatches.length + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">اختلاف القيود والعلاقات</span><span class="rg-hc-kv-v tabular-nums ' + (constraintMismatches.length ? 'is-danger' : 'is-success') + '">' + constraintMismatches.length + ' <span style="font-size:11px;font-weight:500;">(' + Number(scH.totalConstraints || 0) + '/' + Number(scH.expectedConstraints || 0) + ')</span></span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Indexes المفقودة (من ' + Number(scH.totalIndexes || 0) + ')</span><span class="rg-hc-kv-v tabular-nums ' + (missingIndexes.length ? 'is-warning' : 'is-success') + '">' + missingIndexes.length + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">حالة Migrations</span><span class="rg-hc-kv-v tabular-nums ' + (pendingMigrations.length ? 'is-danger' : 'is-success') + '">' + Number(scH.appliedMigrationsCount || 0) + ' مطبق · ' + pendingMigrations.length + ' معلق</span></div>' +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>اختلافات Schema بين التطبيق وNeon (' + totalSchemaDiffs + ')</span></div>' +
                (totalSchemaDiffs > 0
                  ? '<div class="rg-hc-scroll-list">' +
                      missingTables.map(function (m) {
                        return '<div class="rg-hc-issue-row is-critical"><strong>جدول مفقود: <span class="mono">' + escapeHtml(m.table) + '</span></strong><span class="rg-hc-code-refs">' + escapeHtml((m.codeRefs || []).join(' · ')) + '</span></div>';
                      }).join('') +
                      missingCols.map(function (c) {
                        return '<div class="rg-hc-issue-row is-critical"><strong>عمود مفقود: <span class="mono">' + escapeHtml(c.table + '.' + c.column) + '</span> (' + escapeHtml(c.expectedType) + ')</strong><span class="rg-hc-code-refs">' + escapeHtml((c.codeRefs || []).join(' · ')) + '</span></div>';
                      }).join('') +
                      constraintMismatches.map(function (cm) {
                        return '<div class="rg-hc-issue-row ' + (cm.constraintType === 'PRIMARY KEY' ? 'is-critical' : 'is-warning') + '"><strong>قيد/علاقة مفقودة: <span class="mono">' + escapeHtml(cm.table) + '</span> — ' + escapeHtml(cm.constraintType) + ' (' + escapeHtml((cm.columns || []).join(', ')) + (cm.refTable ? (' -> ' + escapeHtml(cm.refTable)) : '') + ')</strong><span class="rg-hc-code-refs">' + escapeHtml((cm.codeRefs || []).join(' · ')) + '</span></div>';
                      }).join('') +
                      typeMismatches.map(function (tm) {
                        return '<div class="rg-hc-issue-row is-warning"><strong>اختلاف نوع عمود: <span class="mono">' + escapeHtml(tm.table + '.' + tm.column) + '</span></strong><span>المتوقع: <code dir="ltr">' + escapeHtml(tm.expectedType) + '</code> · الفعلي: <code dir="ltr">' + escapeHtml(tm.actualType) + '</code></span><span class="rg-hc-code-refs">' + escapeHtml((tm.codeRefs || []).join(' · ')) + '</span></div>';
                      }).join('') +
                      missingIndexes.map(function (ix) {
                        return '<div class="rg-hc-issue-row is-warning"><strong>Index مفقود: <span class="mono">' + escapeHtml(ix.index) + '</span> على <span class="mono">' + escapeHtml(ix.table) + '</span></strong><span class="rg-hc-code-refs">' + escapeHtml((ix.codeRefs || []).join(' · ')) + '</span></div>';
                      }).join('') +
                      extraCols.map(function (ec) {
                        return '<div class="rg-hc-issue-row is-warning"><strong>عمود زائد في Neon: <span class="mono">' + escapeHtml(ec.table + '.' + ec.column) + '</span> (' + escapeHtml(ec.actualType) + ')</strong></div>';
                      }).join('') +
                      extraTables.filter(function (et) { return !et.isSampleTable; }).map(function (et) {
                        return '<div class="rg-hc-issue-row is-warning"><strong>جدول زائد: <span class="mono">' + escapeHtml(et.table) + '</span></strong><span>' + escapeHtml(et.note || '') + '</span></div>';
                      }).join('') +
                      pendingMigrations.map(function (pm) {
                        return '<div class="rg-hc-issue-row is-critical"><strong>Migration معلق: <span class="mono">' + escapeHtml(pm) + '</span></strong><span class="rg-hc-code-refs">backend/db.ts</span></div>';
                      }).join('') +
                    '</div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">' + (hasScanned && scH.totalTables > 0 ? 'جميع الجداول والأعمدة والقيود والـ Indexes والـ Migrations متطابقة مع الكود.' : 'بانتظار تنفيذ الفحص الفعلي لـ Neon PostgreSQL.') + '</div>') +
                (extraTables.filter(function (t) { return t.isSampleTable; }).length ? '<div style="font-size:11px;color:var(--text-muted);">ملاحظة: يوجد جدول Neon التجريبي (' + escapeHtml(extraTables.filter(function (t) { return t.isSampleTable; }).map(function (t) { return t.table; }).join(', ')) + ') ولا يؤثر على CRM.</div>' : '') +
              '</div>' +
              (appliedMigrations.length ? (
                '<div class="rg-hc-subbox">' +
                  '<div class="rg-hc-subbox-head"><span>سجل Migrations المطبقة (' + appliedMigrations.length + ')</span></div>' +
                  '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>المعرف</th><th>الوصف</th><th>التاريخ</th></tr></thead><tbody>' +
                    appliedMigrations.slice(-6).reverse().map(function (mg) {
                      return '<tr><td class="mono" dir="ltr">' + escapeHtml(mg.id) + '</td><td>' + escapeHtml(mg.description || '-') + '</td><td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(mg.appliedAt, ctx)) + '</td></tr>';
                    }).join('') +
                  '</tbody></table></div>' +
                '</div>'
              ) : '') +
            '</section>' +

            // 3. Data Integrity
            '<section class="rg-hc-section-card is-full-span ' + ((STATUS_META[diH.status] && STATUS_META[diH.status].cls) || 'is-unknown') + '" id="hc-sec-data">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">3. Data Integrity — سلامة البيانات</h4>' +
                  '<p class="rg-hc-section-sub">فحص البيانات ومقارنة الحجوزات والتمديدات بين Neon وRental Gate API (قراءة فقط)</p>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
                  badgeHtml(diH.status || 'unknown') +
                  '<button type="button" class="btn btn-sm hc-rescan-btn" data-section="data_integrity">إعادة فحص</button>' +
                '</div>' +
              '</div>' +
              (rgCmp.error ? '<div class="rg-hc-alert-box is-warning"><div><strong>تعذر مقارنة RG API الحية:</strong> ' + escapeHtml(rgCmp.error) + '</div></div>' : '') +
              (diH.recommendedAction ? '<div class="rg-hc-alert-box is-warning"><div><strong>الإجراء الموصى به:</strong> ' + escapeHtml(diH.recommendedAction) + '</div></div>' : '') +
              ((diH.queryErrors && diH.queryErrors.length) ? '<div class="rg-hc-alert-box is-warning"><div><strong>تحذير استعلامات سلامة البيانات:</strong> ' + escapeHtml(diH.queryErrors.map(function (q) { return q.step + ': ' + q.message; }).join(' | ')) + '</div></div>' : '') +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحجوزات: RG API / Neon</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + (rgCmp.rgTotalCount !== null && rgCmp.rgTotalCount !== undefined ? rgCmp.rgTotalCount : 'غير مفحوص') + ' / ' + Number(diCounts.reservations || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">المتطابقة بين المصدرين</span><span class="rg-hc-kv-v tabular-nums">' + (rgCmp.matchedCount !== null && rgCmp.matchedCount !== undefined ? rgCmp.matchedCount : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحجوزات المفقودة في Neon</span><span class="rg-hc-kv-v tabular-nums ' + (Number(rgCmp.missingFromNeonCount || 0) > 0 ? 'is-danger' : '') + '">' + (rgCmp.missingFromNeonCount !== null && rgCmp.missingFromNeonCount !== undefined ? rgCmp.missingFromNeonCount : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحجوزات المكررة</span><span class="rg-hc-kv-v tabular-nums ' + ((diAnom.duplicateBookings || []).length ? 'is-danger' : 'is-success') + '">' + Number((diAnom.duplicateBookings || []).length) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">اختلاف بيانات وحالات</span><span class="rg-hc-kv-v tabular-nums ' + (Number(rgCmp.mismatchedFieldsCount || 0) > 0 ? 'is-warning' : '') + '">' + (rgCmp.mismatchedFieldsCount !== null && rgCmp.mismatchedFieldsCount !== undefined ? rgCmp.mismatchedFieldsCount : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أرقام RG المتبادلة (#)</span><span class="rg-hc-kv-v tabular-nums ' + ((diAnom.swappedRgNumbers || []).length ? 'is-warning' : '') + '">' + Number((diAnom.swappedRgNumbers || []).length) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">التمديدات غير المرتبطة</span><span class="rg-hc-kv-v tabular-nums ' + (Number(diAnom.orphanExtensionsCount || 0) > 0 ? 'is-danger' : 'is-success') + '">' + Number(diAnom.orphanExtensionsCount || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">سجلات العملاء (جوال إلزامي / فجوات مصدر RG)</span><span class="rg-hc-kv-v tabular-nums">جوال مفقود ' + Number((diCustQual.required && diCustQual.required.missingPhone) || 0) + ' · اختياري (هوية ' + Number((diCustQual.optionalSourceGaps && diCustQual.optionalSourceGaps.missingIdNumber) || 0) + ' / بريد ' + Number((diCustQual.optionalSourceGaps && diCustQual.optionalSourceGaps.missingEmail) || 0) + ')</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تعارضات السلامة المفتوحة</span><span class="rg-hc-kv-v tabular-nums ' + (Number(diAnom.openIntegrityIssuesCount || 0) > 0 ? 'is-warning' : 'is-success') + '">' + Number(diAnom.openIntegrityIssuesCount || 0) + (diAnom.openIssuesBySeverity ? (' <span style="font-size:11px;font-weight:500;">(حرج ' + Number(diAnom.openIssuesBySeverity.critical || 0) + ' · عالٍ ' + Number(diAnom.openIssuesBySeverity.high || 0) + ' · متوسط ' + Number(diAnom.openIssuesBySeverity.medium || 0) + ')</span>') : '') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">العلاقات المكسورة بين الجداول</span><span class="rg-hc-kv-v tabular-nums ' + (orphanTotal > 0 ? 'is-danger' : 'is-success') + '">' + orphanTotal + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تعارض عداد التمديدات / الأعلام</span><span class="rg-hc-kv-v tabular-nums">' + Number((diAnom.extensionCountMismatches || []).length) + ' / ' + Number(diAnom.dualLifecycleFlagsCount || 0) + '</span></div>' +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head">' +
                  '<span>نتائج آخر فحص مقارنة (' + (diLatest ? escapeHtml(formatSettingDateTime(diLatest.finishedAt || diLatest.startedAt, ctx)) : 'لم يُنفذ') + ')</span>' +
                  '<button type="button" class="btn btn-sm" id="hc-goto-integrity-btn">فتح لوحة معاينة الفروقات والموافقة</button>' +
                '</div>' +
                ((rgCmp.diffPreview && rgCmp.diffPreview.length)
                  ? '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>رقم الحجز</th><th>النوع / الحقل</th><th>RG API</th><th>Neon</th></tr></thead><tbody>' +
                      rgCmp.diffPreview.slice(0, 12).map(function (d) {
                        return '<tr><td class="mono">' + escapeHtml(d.reservationNumber || '-') + '</td><td>' + escapeHtml((d.type || '') + (d.fieldName ? (' · ' + d.fieldName) : '')) + '</td><td>' + escapeHtml(d.rgValue || '-') + '</td><td>' + escapeHtml(d.neonValue || '-') + '</td></tr>';
                      }).join('') +
                    '</tbody></table></div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">' + (rgCmp.checkedLive ? 'لا توجد فروقات غير متطابقة في المعاينة الحية الحالية.' : 'فعّل "مقارنة حية مع RG API" واضغط إعادة فحص لعرض الفروقات الفورية دون أي تعديل تلقائي.') + '</div>') +
              '</div>' +
            '</section>' +

            // 4. Sync Health
            '<section class="rg-hc-section-card is-full-span ' + ((STATUS_META[syH.status] && STATUS_META[syH.status].cls) || 'is-unknown') + '" id="hc-sec-sync">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">4. Sync Health — سلامة المزامنة</h4>' +
                  '<p class="rg-hc-section-sub">RG API · Backend · Neon PostgreSQL · Apps Script / Sheets · Outbox</p>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
                  badgeHtml(syH.status || 'unknown') +
                  '<button type="button" class="btn btn-sm hc-rescan-btn" data-section="sync_health">إعادة فحص</button>' +
                '</div>' +
              '</div>' +
              ((syWorker && syWorker.lastError) ? '<div class="rg-hc-alert-box is-warning"><div><strong>آخر خطأ في عامل المزامنة:</strong> ' + escapeHtml(syWorker.lastError) + '</div></div>' : '') +
              (syH.deploySkewWarning ? '<div class="rg-hc-alert-box is-warning"><div><strong>تنبيه توافق نشر Apps Script:</strong> ' + escapeHtml(syH.deploySkewWarning) + '</div></div>' : '') +
              (Number(syOutbox.quarantinedBulkDelete || 0) > 0 ? '<div class="rg-hc-alert-box is-warning"><div><strong>حماية الحجوزات:</strong> تم عزل <span class="tabular-nums">' + Number(syOutbox.quarantinedBulkDelete || 0) + '</span> عملية <code dir="ltr">deleteAllReservations</code> في Outbox ولن يتم تنفيذها أو إعادة جدولتها تلقائياً.</div></div>' : '') +
              (function () {
                var gf = syH.gasAuthFlowDiagnostics || {};
                var sec = gf.secret || {};
                var gUrl = gf.gasUrl || {};
                var envInfo = gf.environment || {};
                var vEnv = envInfo.vercelEnv || gf.vercelEnv || '';
                var warnings = [];
                if (sec.envVsDbConflict) warnings.push('يوجد تعارض بين SYNC_API_SECRET في متغيرات البيئة والقيمة المخزنة في قاعدة البيانات — تأكد من تطابق Vercel Production وdb_settings.');
                if (gUrl.envVsDbConflict) warnings.push('يوجد تعارض بين GAS_WEBAPP_URL في متغيرات البيئة والقيمة المخزنة في قاعدة البيانات — تحقق من Deployment ID النشط.');
                if (sec.dbDecryptFailed) warnings.push('تعذر فك تشفير sync_api_secret_enc في db_settings (تحقق من RG_ENCRYPTION_KEY).');
                if (vEnv && vEnv !== 'production' && vEnv !== 'local') warnings.push('بيئة التشغيل المبلّغ عنها ليست Production (' + vEnv + ').');
                return warnings.length
                  ? '<div class="rg-hc-alert-box is-warning"><div><strong>تشخيص تدفق مصادقة GAS:</strong> ' + escapeHtml(warnings.join(' | ')) + '</div></div>'
                  : '';
              })() +
              (syH.recommendedAction ? '<div class="rg-hc-alert-box is-warning"><div><strong>الإجراء الموصى به:</strong> ' + escapeHtml(syH.recommendedAction) + '</div></div>' : '') +
              ((syH.queryErrors && syH.queryErrors.length) ? '<div class="rg-hc-alert-box is-warning"><div><strong>تحذير استعلام المزامنة:</strong> ' + escapeHtml(syH.queryErrors.map(function (q) { return q.step + ': ' + q.message; }).join(' | ')) + '</div></div>' : '') +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">حالة المزامنة الحالية</span><span class="rg-hc-kv-v">' + escapeHtml(syWorker ? (syWorker.isSyncing ? 'قيد التنفيذ' : syWorker.status) : 'غير متوفر') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر مزامنة ناجحة</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(formatSettingDateTime(syWorker && syWorker.lastSuccessAt, ctx)) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">وقت المزامنة القادمة</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(syWorker && syWorker.autoSyncEnabled ? formatSettingDateTime(syWorker.nextRunAt, ctx) : 'متوقفة') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">مدة آخر عملية مزامنة</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr">' + Number((syWorker && syWorker.lastDurationMs) || (syH.latestSync && syH.latestSync.durationMs) || 0) + ' ms</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">السجلات المسحوبة / الجديدة</span><span class="rg-hc-kv-v tabular-nums">' + Number((syWorker && syWorker.lastImportedCount) || (syH.latestSync && syH.latestSync.importedCount) || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحجوزات المحدّثة / التمديدات</span><span class="rg-hc-kv-v tabular-nums">' + Number((syWorker && syWorker.lastUpdatedCount) || (syH.latestSync && syH.latestSync.updatedCount) || 0) + ' / ' + Number((syWorker && syWorker.lastExtensionsCount) || (syH.latestSync && syH.latestSync.extensionsCount) || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Transactional Outbox (مكتمل / Dead Letter / محجور)</span><span class="rg-hc-kv-v tabular-nums ' + (Number(syOutbox.failed || 0) > 0 ? 'is-danger' : 'is-success') + '">' + Number(syOutbox.completed || syOutbox.sent || 0) + ' / ' + Number(syOutbox.deadLetter !== undefined ? syOutbox.deadLetter : (syOutbox.failed || 0)) + ' <span style="font-size:11px;font-weight:500;">(من ' + Number(syOutbox.total || 0) + (Number(syOutbox.quarantinedBulkDelete || 0) > 0 ? (' · محجور ' + Number(syOutbox.quarantinedBulkDelete || 0)) : '') + ')</span></span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">دورة حياة Outbox (انتظار / معالجة / إعادة)</span><span class="rg-hc-kv-v tabular-nums">' +
                  Number((syOutbox.lifecycle && syOutbox.lifecycle.pending) !== undefined ? syOutbox.lifecycle.pending : (syOutbox.pending || 0)) + ' / ' +
                  Number((syOutbox.lifecycle && syOutbox.lifecycle.processing) !== undefined ? syOutbox.lifecycle.processing : (syOutbox.processing || 0)) + ' / ' +
                  Number((syOutbox.lifecycle && syOutbox.lifecycle.retry) !== undefined ? syOutbox.lifecycle.retry : (syOutbox.retry || 0)) +
                  ' <span style="font-size:11px;font-weight:500;">(فترة كتابة: ' + Number(syOutbox.lastDurationMs || 0) + ' ms)</span>' +
                '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تصنيف أخطاء Outbox النشطة</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:11.5px;">' +
                  'auth=' + Number(syOutbox.authErrorCount || (syOutbox.categoryCounts && syOutbox.categoryCounts.auth) || 0) +
                  ' · timeout=' + Number(syOutbox.timeoutCount || (syOutbox.categoryCounts && syOutbox.categoryCounts.timeout) || 0) +
                  ' · frozen=' + Number(syOutbox.frozenRowsErrorCount || (syOutbox.categoryCounts && syOutbox.categoryCounts.sheet_frozen) || 0) +
                  ' · val=' + Number(syOutbox.validationErrorCount || (syOutbox.categoryCounts && syOutbox.categoryCounts.validation) || 0) +
                  ' · unk=' + Number(syOutbox.unknownErrorCount || (syOutbox.categoryCounts && syOutbox.categoryCounts.unknown) || 0) +
                '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر كتابة Mirror ناجحة / فشل / أقدم معلق</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11px;">' +
                  escapeHtml(formatSettingDateTime(syOutbox.lastSuccessfulMirrorWrite || syOutbox.lastSuccessAt, ctx)) + ' / ' +
                  escapeHtml(formatSettingDateTime(syOutbox.lastFailedMirrorWrite || syOutbox.lastErrorAt, ctx)) + ' / ' +
                  escapeHtml(formatSettingDateTime(syOutbox.oldestPendingAt || syOutbox.oldestUnsyncedAt, ctx)) +
                '</span></div>' +
                (function () {
                  var fp = syOutbox.frozenRowsProtection || {};
                  var rp = syOutbox.recoveryProgress || {};
                  var gr = syOutbox.lastSuccessfulGasReceipt || {};
                  var fpModeLabel = fp.protectedMode ? 'Protected' : 'Unprotected';
                  var fpTestLabel = fp.actualTestPassed === true ? 'ناجح' : (fp.actualTestPassed === false ? 'فاشل' : 'لم يُختبر');
                  var fpErrCount = Number(fp.frozenRowsErrorCount !== undefined ? fp.frozenRowsErrorCount : (syOutbox.frozenRowsErrorCount || 0));
                  var fpText = fpModeLabel + ' · اختبار: ' + fpTestLabel + ' · أخطاء: ' + fpErrCount;
                  var fpCls = fp.actualTestPassed === false || (!fp.protectedMode && Number(syOutbox.frozenRowsErrorCount || 0) > 0)
                    ? 'is-danger'
                    : (fp.protectedMode && fp.actualTestPassed === true ? 'is-success' : '');
                  var missTot = Number(syOutbox.missingIdempotencyKeys || 0);
                  var missAct = Number(syOutbox.missingIdempotencyActive || 0);
                  var rpPct = Number(rp.completionPercent !== undefined ? rp.completionPercent : 0);
                  var rpRem = Number(rp.recoverableRemaining !== undefined ? rp.recoverableRemaining : 0);
                  var receiptText = gr && gr.at
                    ? (formatSettingDateTime(gr.at, ctx) + (gr.correlationId ? (' · ' + gr.correlationId) : '') + (gr.gasScriptVersion ? (' · ' + gr.gasScriptVersion) : ''))
                    : 'لا يوجد إيصال مسجل بعد';
                  return '<div class="rg-hc-kv"><span class="rg-hc-kv-k">حماية الصفوف المجمدة</span><span class="rg-hc-kv-v ' + fpCls + '" style="font-size:11.5px;overflow-wrap:break-word;">' + escapeHtml(fpText) + '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تقدم استرداد Outbox</span><span class="rg-hc-kv-v tabular-nums" style="font-size:11.5px;overflow-wrap:break-word;">' +
                      rpPct + '% مكتمل · متبقي: ' + rpRem + ' · ناقص: ' + missTot + ' (نشط: ' + missAct + ')' +
                    '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر إيصال GAS ناجح</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11px;overflow-wrap:break-word;">' + escapeHtml(receiptText) + '</span></div>';
                })() +
                (function () {
                  var rgLive = syLive.rentalGateAuth;
                  var gasLive = syLive.gasMirrorAuth;
                  var actualOutboxAuth = syOutbox.actualOutboxAuth || {};
                  var rgText = !syLive.checked || !rgLive
                    ? 'لم يُختبر حياً'
                    : (rgLive.authValid === true ? 'متصل وصالح' : (rgLive.authValid === false ? ('فشل: ' + (rgLive.message || '401')) : (rgLive.message || 'غير محدد')));
                  var gasText = !syLive.checked || !gasLive
                    ? 'لم يُختبر حياً'
                    : (gasLive.authValid === true ? 'مطابق وصالح (Direct)' : (gasLive.legacyGasScript ? 'نسخة GAS قديمة' : (gasLive.authValid === false ? ('غير متطابق: ' + (gasLive.message || '401')) : (gasLive.message || 'غير محدد'))));
                  var liveStTxt = actualOutboxAuth.liveValid === true ? 'حي: صالح' : (actualOutboxAuth.liveValid === false ? 'حي: مرفوض' : 'حي: بانتظار اختبار');
                  var actualAuthText = actualOutboxAuth.valid === false
                    ? (liveStTxt + ' · Backlog: ' + Number(actualOutboxAuth.activeAuthErrors || 0))
                    : (actualOutboxAuth.valid === true
                      ? ('ناجح (آخر كتابة: ' + formatSettingDateTime(actualOutboxAuth.lastSuccessfulMirrorWrite, ctx) + ')')
                      : 'بانتظار تنفيذ كتابة فعلية');
                  var rgCls = rgLive && rgLive.authValid === true ? 'is-success' : (rgLive && rgLive.authValid === false ? 'is-danger' : '');
                  var gasCls = gasLive && gasLive.authValid === true ? 'is-success' : (gasLive && (gasLive.authValid === false || gasLive.legacyGasScript) ? 'is-danger' : '');
                  var actualAuthCls = actualOutboxAuth.valid === false ? 'is-danger' : (actualOutboxAuth.valid === true ? 'is-success' : '');
                  return '<div class="rg-hc-kv"><span class="rg-hc-kv-k">مصادقة RG API الحي</span><span class="rg-hc-kv-v ' + rgCls + '" style="font-size:11.5px;">' + escapeHtml(rgText) + '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Direct GAS Auth</span><span class="rg-hc-kv-v ' + gasCls + '" style="font-size:11.5px;">' + escapeHtml(gasText) + '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Outbox Auth (حي / Backlog)</span><span class="rg-hc-kv-v ' + actualAuthCls + '" style="font-size:11.5px;">' + escapeHtml(actualAuthText) + '</span></div>';
                })() +
                (function () {
                  var rtd = syH.rgTokenDiagnostics || {};
                  var ssd = syH.syncSecretDiagnostics || {};
                  var gf = syH.gasAuthFlowDiagnostics || {};
                  var gUrl = gf.gasUrl || {};
                  var gasLiveDiag = (syLive.gasMirrorAuth && syLive.gasMirrorAuth.diagnostics && syLive.gasMirrorAuth.diagnostics.gasDiagnostics) || null;
                  var rgNotes = [];
                  if (rtd.hasQuotes) rgNotes.push('علامات اقتباس');
                  if (rtd.hasWhitespace) rgNotes.push('مسافات');
                  if (rtd.hasBearerPrefix) rgNotes.push('بادئة Bearer');
                  var syncNotes = [];
                  if (ssd.hasQuotes) syncNotes.push('اقتباس');
                  if (ssd.hasWhitespace || ssd.hasEnvWhitespace || ssd.hasLeadingOrTrailingWhitespace) syncNotes.push('مسافات');
                  if (ssd.hasNewlines) syncNotes.push('أسطر');
                  if (ssd.hasInvisibleChars) syncNotes.push('محارف خفية');
                  if (ssd.dbDecryptFailed) syncNotes.push('فشل فك التشفير');
                  if (ssd.envVsDbConflict) syncNotes.push('تعارض ENV/DB');
                  var gasNotes = [];
                  if (gUrl.deploymentIdHint) gasNotes.push('id=' + gUrl.deploymentIdHint);
                  if (gUrl.wasNormalized) gasNotes.push('normalized');
                  if (gUrl.envVsDbConflict) gasNotes.push('تعارض رابط ENV/DB');
                  var gasTel = syH.gasAuthTelemetry || {};
                  var envInfo = gf.environment || {};
                  var runtimeLbl = gasTel.runtimePlatform || envInfo.runtimePlatform || (envInfo.vercelEnv || gf.vercelEnv || 'local');
                  if (gasTel.gasScriptVersion || (gasLiveDiag && gasLiveDiag.gasScriptVersion)) gasNotes.push('ver=' + (gasTel.gasScriptVersion || gasLiveDiag.gasScriptVersion));
                  if (gasTel.receivedVia || (gasLiveDiag && gasLiveDiag.receivedVia)) gasNotes.push('via=' + (gasTel.receivedVia || gasLiveDiag.receivedVia));
                  if (typeof gasTel.secretMatch === 'boolean') gasNotes.push('match=' + gasTel.secretMatch);
                  if (gasTel.correlationId) gasNotes.push('cid=' + gasTel.correlationId);
                  return '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تشخيص RG_TOKEN (بدون كشف)</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' +
                    (rtd.configured ? (escapeHtml(rtd.source || 'configured') + ' · len=' + Number(rtd.length || 0) + (rgNotes.length ? ' · ' + escapeHtml(rgNotes.join(', ')) : '')) : 'غير مهيأ') +
                    '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تشخيص SYNC_API_SECRET</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' +
                    (ssd.configured ? (escapeHtml(ssd.source || 'configured') + ' · len=' + Number(ssd.length || 0) + (syncNotes.length ? ' · ' + escapeHtml(syncNotes.join(', ')) : '')) : 'غير مهيأ') +
                    '</span></div>' +
                    '<div class="rg-hc-kv"><span class="rg-hc-kv-k">مسار GAS Web App وبيئة التشغيل</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' +
                    (gUrl.configured ? (escapeHtml(gUrl.source || 'configured') + ' · ' + escapeHtml(runtimeLbl + '/' + (envInfo.vercelEnv || gf.vercelEnv || 'local')) + (gasNotes.length ? ' · ' + escapeHtml(gasNotes.join(' · ')) : '')) : 'غير مهيأ') +
                    '</span></div>';
                })() +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>آخر مزامنة ناجحة لكل مصدر</span></div>' +
                '<div class="rg-hc-source-grid">' +
                  '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Rental Gate API</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(formatSettingDateTime(sySources.rentalGateApi, ctx)) + '</span></div>' +
                  '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Neon PostgreSQL</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(formatSettingDateTime(sySources.neonPostgres, ctx)) + '</span></div>' +
                  '<div class="rg-hc-kv"><span class="rg-hc-kv-k">Google Apps Script / Sheets</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:11.5px;">' + escapeHtml(formatSettingDateTime(sySources.googleAppsScriptSheets, ctx)) + '</span></div>' +
                '</div>' +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>حالة Checkpoints (' + syCheckpoints.length + ')</span></div>' +
                (syCheckpoints.length
                  ? '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>المصدر</th><th>الحالة</th><th>الدفعة</th><th>آخر نجاح</th></tr></thead><tbody>' +
                      syCheckpoints.slice(0, 8).map(function (cp) {
                        return '<tr><td class="mono" dir="ltr">' + escapeHtml(cp.source) + '</td><td>' + escapeHtml(cp.lastStatus || '-') + '</td><td class="tabular-nums">' + Number(cp.lastBatchCount || 0) + '</td><td class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(cp.lastSuccessfulAt || cp.lastSyncAt, ctx)) + '</td></tr>';
                      }).join('') +
                    '</tbody></table></div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">لا توجد Checkpoints مسجلة بعد.</div>') +
              '</div>' +
              '<div class="rg-hc-subbox" id="hc-ten-point-checks">' +
                '<div class="rg-hc-subbox-head">' +
                  '<span>فحوصات تشخيص المزامنة وOutbox العشرة (' + Number(syTenChecks.length || 0) + ')</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
                    '<span class="rg-hc-status-badge is-healthy">سليم: ' + Number(syTenSummary.healthy || 0) + '</span>' +
                    (Number(syTenSummary.warning || 0) > 0 ? '<span class="rg-hc-status-badge is-warning">تحذير: ' + Number(syTenSummary.warning || 0) + '</span>' : '') +
                    (Number(syTenSummary.critical || 0) > 0 ? '<span class="rg-hc-status-badge is-critical">حرج: ' + Number(syTenSummary.critical || 0) + '</span>' : '') +
                  '</div>' +
                '</div>' +
                (syLastUpsert && syLastUpsert.at
                  ? '<div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:8px;">آخر Upsert مكتمل عبر Outbox: <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(syLastUpsert.at, ctx)) + '</span>' + (syLastUpsert.entityId ? (' · الحجز: <strong class="mono" dir="ltr">' + escapeHtml(syLastUpsert.entityId) + '</strong>') : '') + (syLastUpsert.correlationId ? (' · <span class="mono" dir="ltr">' + escapeHtml(syLastUpsert.correlationId) + '</span>') : '') + '</div>'
                  : '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">لم يُسجّل بعد تنفيذ upsertReservation ناجح ومكتمل عبر Outbox — استخدم زر اختبار Upsert الحقيقي أدناه للتحقق من المسار الكامل.</div>') +
                (syTenChecks.length
                  ? '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>#</th><th>الفحص</th><th>الحالة</th><th>النتيجة</th></tr></thead><tbody>' +
                      syTenChecks.map(function (chk) {
                        var stCls = chk.status === 'healthy' ? 'is-healthy' : (chk.status === 'critical' ? 'is-critical' : 'is-warning');
                        return '<tr>' +
                          '<td class="tabular-nums">' + Number(chk.number || 0) + '</td>' +
                          '<td class="mono" dir="ltr" style="font-size:11.5px;white-space:nowrap;">' + escapeHtml(chk.title || chk.key) + '</td>' +
                          '<td><span class="rg-hc-status-badge ' + stCls + '">' + escapeHtml(chk.status || 'unknown') + '</span></td>' +
                          '<td style="font-size:11.5px;">' + escapeHtml(chk.summary || '') + (chk.recommendation ? ('<div style="color:var(--text-muted);margin-top:2px;">' + escapeHtml(chk.recommendation) + '</div>') : '') + '</td>' +
                        '</tr>';
                      }).join('') +
                    '</tbody></table></div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">اضغط "فحص شامل لجميع الأقسام" أو "إعادة فحص" لتشغيل الفحوصات العشرة الحية.</div>') +
              '</div>' +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head">' +
                  '<span>أخطاء المزامنة وإعادة المعالجة التدريجية الآمنة (دفعات 8–10 لمنع المهلة والتكرار)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn btn-sm" id="hc-verify-gas-auth-btn">فحص مطابقة SYNC_API_SECRET مع GAS</button>' +
                    '<button type="button" class="btn btn-sm" id="hc-probe-gas-safe-btn">اختبار كتابة Settings آمن</button>' +
                    '<button type="button" class="btn btn-sm btn-primary" id="hc-test-outbox-upsert-btn">اختبار Upsert حقيقي عبر Outbox</button>' +
                    '<button type="button" class="btn btn-sm btn-primary" id="hc-test-outbox-three-way-btn">اختبار Outbox ثلاثي آمن (Res + FU + Setting)</button>' +
                    '<button type="button" class="btn btn-sm" id="hc-verify-frozen-rows-btn">اختبار حماية الصفوف المجمدة الفعلي (GAS)</button>' +
                    '<button type="button" class="btn btn-sm" id="hc-backfill-idempotency-btn">إكمال مفاتيح Idempotency الناقصة</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_batch">معالجة دفعة Outbox الآمنة (8)</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_auth">إعادة معالجة أخطاء المصادقة (8)</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_sheet_frozen">إعادة معالجة أخطاء الصفوف المجمدة (8)</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_timeout">إعادة معالجة أخطاء المهلة (8)</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_validation">إعادة معالجة أخطاء التحقق الآمنة (8)</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="outbox_transient">إعادة محاولة Outbox المؤقتة</button>' +
                    '<button type="button" class="btn btn-sm hc-retry-sync-btn" data-mode="rg_missing_records">استعادة السجلات الناقصة من RG</button>' +
                  '</div>' +
                '</div>' +
                (syCatBreak.length
                  ? '<div class="rg-hc-scroll-list" style="margin-bottom:8px;">' +
                      syCatBreak.map(function (cb) {
                        return '<div class="rg-hc-issue-row ' + (cb.category === 'transient' ? 'is-warning' : 'is-critical') + '">' +
                          '<div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;">' +
                            '<strong>تصنيف Outbox: <span class="mono" dir="ltr">' + escapeHtml(cb.category || 'unknown') + '</span></strong>' +
                            '<span class="tabular-nums">العدد: ' + Number(cb.count || 0) + ' · آخر محاولة: <span class="mono" dir="ltr">' + escapeHtml(formatSettingDateTime(cb.lastSeenAt, ctx)) + '</span></span>' +
                          '</div>' +
                          '<div class="mono" dir="ltr" style="font-size:11px;overflow-wrap:anywhere;">' + escapeHtml(cb.sampleError || '') + '</div>' +
                        '</div>';
                      }).join('') +
                    '</div>'
                  : '') +
                (syErrBreak.length
                  ? '<div class="rg-hc-scroll-list">' +
                      syErrBreak.map(function (eb) {
                        return '<div class="rg-hc-issue-row ' + (eb.isTransient ? 'is-warning' : 'is-critical') + '">' +
                          '<div style="display:flex;justify-content:space-between;gap:6px;"><strong>' + (eb.isTransient ? 'خطأ مؤقت قابل للإعادة' : 'خطأ صلاحيات/إعداد/ورقة') + '</strong><span class="tabular-nums">العدد: ' + Number(eb.count || 0) + '</span></div>' +
                          '<div class="mono" dir="ltr" style="font-size:11px;overflow-wrap:anywhere;">' + escapeHtml(eb.error || '') + '</div>' +
                        '</div>';
                      }).join('') +
                    '</div>'
                  : (syRecentErrs.length
                      ? '<div class="rg-hc-scroll-list">' + syRecentErrs.slice(0, 6).map(function (re) { return '<div class="rg-hc-issue-row is-warning"><span class="mono" dir="ltr">' + escapeHtml(re.entityType + ':' + re.entityId + ' — ' + re.error) + '</span></div>'; }).join('') + '</div>'
                      : (!syCatBreak.length ? '<div style="font-size:12px;color:var(--text-muted);">لا توجد أخطاء Outbox فاشلة حالياً.</div>' : ''))) +
              '</div>' +
            '</section>' +

          '</div>' +
        '</div>';

      if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
        root.RGCrmDropdowns.enhanceAll(hostEl);
      }

      var scanAllBtn = hostEl.querySelector('#hc-scan-all-btn');
      var compareChk = hostEl.querySelector('#hc-compare-rg-chk');
      if (compareChk) {
        compareChk.addEventListener('change', function () {
          state.compareWithRg = Boolean(compareChk.checked);
        });
      }
      if (scanAllBtn) {
        scanAllBtn.addEventListener('click', function () {
          runWithLock(scanAllBtn, 'hc:scanAll', async function () {
            var res = await root.RGApi.callApi('runDatabaseHealthCenterScan', {
              section: 'all',
              compareWithRg: state.compareWithRg
            });
            if (res && res.success && res.data) {
              state.report = res.data;
              state.selectedRunId = res.data.latestRun ? res.data.latestRun.id : '';
              syncAutoRefreshTimer();
              renderHealthPanel();
              ctx.toast('اكتمل الفحص الشامل لمركز صحة قاعدة البيانات.');
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ الفحص الشامل.', true);
            }
          });
        });
      }

      hostEl.querySelectorAll('.hc-rescan-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sec = btn.getAttribute('data-section') || 'all';
          runWithLock(btn, 'hc:scan:' + sec, async function () {
            var res = await root.RGApi.callApi('runDatabaseHealthCenterScan', {
              section: sec,
              compareWithRg: state.compareWithRg
            });
            if (res && res.success && res.data) {
              state.report = res.data;
              state.selectedRunId = res.data.latestRun ? res.data.latestRun.id : '';
              syncAutoRefreshTimer();
              renderHealthPanel();
              ctx.toast('تمت إعادة فحص القسم بنجاح.');
            } else {
              ctx.toast((res && res.message) || 'تعذر إعادة فحص القسم.', true);
            }
          });
        });
      });

      var histSel = hostEl.querySelector('#hc-history-select');
      if (histSel) {
        histSel.addEventListener('change', function () {
          var rid = String(histSel.value || '');
          if (!rid) return;
          state.selectedRunId = rid;
          loadHealthReport(rid, false);
        });
      }

      var viewErrBtn = hostEl.querySelector('#hc-view-errors-btn');
      if (viewErrBtn) {
        viewErrBtn.addEventListener('click', function () { openErrorDetailsModal(rep); });
      }
      var copyAllErrBtn = hostEl.querySelector('#hc-copy-errors-btn');
      if (copyAllErrBtn) {
        copyAllErrBtn.addEventListener('click', function () {
          copyToClipboardSafe(buildErrorBundleText(rep), 'تفاصيل أخطاء مركز صحة قاعدة البيانات', ctx);
        });
      }
      var copyDbErrBtn = hostEl.querySelector('.hc-copy-db-errs');
      if (copyDbErrBtn) {
        copyDbErrBtn.addEventListener('click', function () {
          copyToClipboardSafe(JSON.stringify(recentDbErrs, null, 2), 'أخطاء قاعدة البيانات', ctx);
        });
      }
      var expJsonBtn = hostEl.querySelector('#hc-export-json-btn');
      if (expJsonBtn) {
        expJsonBtn.addEventListener('click', function () { exportHealthJson(rep); });
      }
      var expPdfBtn = hostEl.querySelector('#hc-export-pdf-btn');
      if (expPdfBtn) {
        expPdfBtn.addEventListener('click', function () { exportHealthPdf(rep); });
      }

      var saveSetBtn = hostEl.querySelector('#hc-save-settings-btn');
      if (saveSetBtn) {
        saveSetBtn.addEventListener('click', function () {
          var arEnabled = Boolean((hostEl.querySelector('#hc-autorefresh-chk') || {}).checked);
          var arSec = Number((hostEl.querySelector('#hc-autorefresh-sec') || {}).value || 60);
          runWithLock(saveSetBtn, 'hc:saveSettings', async function () {
            var res = await root.RGApi.callApi('saveHealthCenterSettings', {
              autoRefreshEnabled: arEnabled,
              autoRefreshIntervalSec: arSec
            });
            if (res && res.success) {
              if (!state.report) state.report = {};
              state.report.settings = (res.data && res.data.settings) || { autoRefreshEnabled: arEnabled, autoRefreshIntervalSec: arSec };
              syncAutoRefreshTimer();
              ctx.toast(res.message || 'تم حفظ إعدادات التحديث التلقائي.');
            } else {
              ctx.toast((res && res.message) || 'تعذر حفظ الإعدادات.', true);
            }
          });
        });
      }

      var gotoIntBtn = hostEl.querySelector('#hc-goto-integrity-btn');
      if (gotoIntBtn) {
        gotoIntBtn.addEventListener('click', function () {
          var el = document.getElementById('dev-integrity-card');
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }

      var verifyGasBtn = hostEl.querySelector('#hc-verify-gas-auth-btn');
      if (verifyGasBtn) {
        verifyGasBtn.addEventListener('click', function () {
          runWithLock(verifyGasBtn, 'hc:verifyGasAuth', async function () {
            var res = await root.RGApi.callApi('verifyGasMirrorAuth', {});
            if (res && res.success && res.data) {
              var d = res.data;
              ctx.toast(d.message || (d.authValid ? 'تمت مطابقة SYNC_API_SECRET بنجاح.' : 'فشل التحقق من SYNC_API_SECRET.'), !(d.ok && d.authValid !== false));
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر اختبار مصادقة Google Apps Script.', true);
            }
          });
        });
      }

      var probeGasBtn = hostEl.querySelector('#hc-probe-gas-safe-btn');
      if (probeGasBtn) {
        probeGasBtn.addEventListener('click', function () {
          runWithLock(probeGasBtn, 'hc:probeGasSafe', async function () {
            var res = await root.RGApi.callApi('probeGasSheetsMirror', { writeProbe: true });
            if (res && res.success && res.data) {
              var d = res.data;
              ctx.toast(d.message || (d.ok ? 'نجح اختبار القراءة والكتابة الآمن في GAS.' : 'تعذر اختبار GAS الآمن.'), !d.ok);
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ الاختبار الآمن للورقة.', true);
            }
          });
        });
      }

      var testOutboxUpsertBtn = hostEl.querySelector('#hc-test-outbox-upsert-btn');
      if (testOutboxUpsertBtn) {
        testOutboxUpsertBtn.addEventListener('click', function () {
          runWithLock(testOutboxUpsertBtn, 'hc:testOutboxUpsert', async function () {
            var res = await root.RGApi.callApi('testOutboxSingleUpsert', {});
            if (res && res.success && res.data) {
              var d = res.data;
              var summaryMsg = d.ok
                ? ('نجح اختبار Upsert الحقيقي عبر Outbox للحجز ' + (d.reservationNumber || '-') + ' (cid: ' + (d.correlationId || '-') + ')')
                : ('فشل اختبار Upsert عبر Outbox (' + (d.errorCategory || d.outboxStatus || 'error') + '): ' + (d.errorMessage || res.message || ''));
              ctx.toast(summaryMsg, !d.ok);
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ اختبار Upsert عبر Outbox.', true);
            }
          });
        });
      }

      var testOutboxThreeWayBtn = hostEl.querySelector('#hc-test-outbox-three-way-btn');
      if (testOutboxThreeWayBtn) {
        testOutboxThreeWayBtn.addEventListener('click', function () {
          runWithLock(testOutboxThreeWayBtn, 'hc:testOutboxThreeWay', async function () {
            var res = await root.RGApi.callApi('testOutboxThreeWaySuite', {});
            if (res && res.success && res.data) {
              var d = res.data;
              var msg3 = d.ok
                ? ('نجح الاختبار الثلاثي لـ Outbox (' + Number(d.sent || 0) + '/3 · receipts=' + Number(d.receiptVerifiedCount || 0) + '/3 · cid=' + (d.correlationId || '-') + ')')
                : ('فشل الاختبار الثلاثي لـ Outbox: ' + (d.errorMessage || res.message || ''));
              ctx.toast(msg3, !d.ok);
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ اختبار Outbox الثلاثي.', true);
            }
          });
        });
      }

      var verifyFrozenBtn = hostEl.querySelector('#hc-verify-frozen-rows-btn');
      if (verifyFrozenBtn) {
        verifyFrozenBtn.addEventListener('click', function () {
          runWithLock(verifyFrozenBtn, 'hc:verifyFrozenRows', async function () {
            var res = await root.RGApi.callApi('verifyGasFrozenRowsProtection', {});
            if (res && res.success && res.data) {
              var d = res.data;
              ctx.toast(d.message || (d.ok ? 'نجح اختبار حماية الصفوف المجمدة.' : 'فشل اختبار حماية الصفوف المجمدة.'), !d.ok);
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر تنفيذ اختبار حماية الصفوف المجمدة.', true);
            }
          });
        });
      }

      var backfillIdempBtn = hostEl.querySelector('#hc-backfill-idempotency-btn');
      if (backfillIdempBtn) {
        backfillIdempBtn.addEventListener('click', function () {
          runWithLock(backfillIdempBtn, 'hc:backfillIdemp', async function () {
            var res = await root.RGApi.callApi('backfillOutboxIdempotencyKeys', {});
            if (res && res.success && res.data) {
              var d = res.data;
              ctx.toast('تم إكمال ' + Number(d.updatedCount || 0) + ' مفتاح Idempotency (المتبقي الناقص: ' + Number(d.remainingMissingTotal || 0) + ').');
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر إكمال مفاتيح Idempotency.', true);
            }
          });
        });
      }

      hostEl.querySelectorAll('.hc-retry-sync-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mode = btn.getAttribute('data-mode') || 'outbox_transient';
          var batchLimit = mode === 'rg_missing_records' ? 15 : 8;
          runWithLock(btn, 'hc:retry:' + mode, async function () {
            var res = await root.RGApi.callApi('retryHealthCenterFailedSync', { mode: mode, limit: batchLimit, maxBatches: 1 });
            if (res && res.success) {
              ctx.toast(res.message || 'تمت إعادة محاولة العمليات الفاشلة بأمان.');
              loadHealthReport('', true);
            } else {
              ctx.toast((res && res.message) || 'تعذر إعادة المحاولة.', true);
            }
          });
        });
      });
    }

    loadHealthReport('', false);
  }

  function formatBytesHuman(bytesVal) {
    var b = Number(bytesVal || 0);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function mountDeveloperOutboxPreviewPanel(hostEl, ctx) {
    if (!hostEl) return;
    var state = {
      loading: true,
      outboxData: null,
      syncData: null,
      loadError: '',
      activeTab: 'outbox',
      filters: {
        status: 'all',
        classification: 'all',
        actionType: 'all',
        search: '',
        dateFrom: '',
        dateTo: '',
        olderThanDays: 0,
        page: 1,
        pageSize: 25
      }
    };

    function openPayloadInspector(item) {
      var modalRoot = document.getElementById('modal-root');
      if (!modalRoot || !item) return;
      var prettyPayload = '';
      try {
        prettyPayload = typeof item.payload === 'string'
          ? JSON.stringify(JSON.parse(item.payload), null, 2)
          : JSON.stringify(item.payload || {}, null, 2);
      } catch (_e) {
        prettyPayload = String(item.payload || '');
      }
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="ob-prev-inspect-modal" role="dialog" aria-modal="true">' +
          '<div class="modal-panel" style="max-width:740px;">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title">معاينة حمولة Outbox (قراءة فقط) — <span class="mono" dir="ltr">' + escapeHtml(item.id || '') + '</span></h3>' +
              '<button type="button" class="btn btn-sm" id="ob-prev-inspect-close">إغلاق</button>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;">' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الإجراء / الكيان</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:12px;">' + escapeHtml((item.action || '-') + ' · ' + (item.entityType || '-')) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحالة القياسية / الأصلية</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:12px;">' + escapeHtml((item.canonicalStatus || '-') + ' (' + (item.rawStatus || '-') + ')') + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">التصنيف في المعاينة</span><span class="rg-hc-kv-v" style="font-size:12px;">' + escapeHtml(item.classificationLabelAr || '-') + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">الحجم المقدّر</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:12px;">' + escapeHtml(formatBytesHuman(item.estimatedPayloadBytes)) + '</span></div>' +
            '</div>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px;">' + escapeHtml(item.reasonAr || '') + '</p>' +
            (item.lastError ? '<div class="rg-hc-alert-box" style="margin-bottom:10px;"><div><strong>آخر خطأ:</strong> <span class="mono" dir="ltr">' + escapeHtml(item.lastError) + '</span></div></div>' : '') +
            '<pre class="rg-obp-json-pre" dir="ltr">' + escapeHtml(prettyPayload) + '</pre>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" id="ob-prev-inspect-close-2">إغلاق</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      var closeM = function () { modalRoot.innerHTML = ''; };
      modalRoot.querySelector('#ob-prev-inspect-close').addEventListener('click', closeM);
      modalRoot.querySelector('#ob-prev-inspect-close-2').addEventListener('click', closeM);
    }

    function downloadPreviewJson() {
      if (!state.outboxData && !state.syncData) return;
      try {
        var exportObj = {
          exportedAt: new Date().toISOString(),
          phase: 'Phase 1-2 Read-Only Preview',
          outboxCleanupPreview: state.outboxData,
          sheetsSyncControlStatus: state.syncData
        };
        var blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rg-outbox-sync-preview-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ctx.toast('تم تصدير تقرير المعاينة (JSON) بدون أي تعديل على قاعدة البيانات.');
      } catch (_e) {
        ctx.toast('تعذر تصدير ملف المعاينة.', true);
      }
    }

    async function loadPreviewData(showToast) {
      if (!hostEl.isConnected) return;
      state.loading = true;
      state.loadError = '';
      renderPreviewPanel();
      try {
        var filterPayload = {
          status: state.filters.status,
          classification: state.filters.classification,
          actionType: state.filters.actionType === 'all' ? '' : state.filters.actionType,
          search: state.filters.search,
          dateFrom: state.filters.dateFrom,
          dateTo: state.filters.dateTo,
          olderThanDays: state.filters.olderThanDays,
          page: state.filters.page,
          pageSize: state.filters.pageSize,
          abortKey: 'dev-outbox-preview'
        };
        var results = await Promise.all([
          root.RGApi.callApi('getOutboxCleanupPreview', filterPayload),
          root.RGApi.callApi('getSheetsSyncControlStatus', { abortKey: 'dev-sheets-sync-status' })
        ]);
        var obRes = results[0];
        var syRes = results[1];
        if (obRes && obRes.success && obRes.data) {
          state.outboxData = obRes.data;
        } else {
          state.loadError = (obRes && obRes.message) || 'تعذر تحميل معاينة Outbox.';
        }
        if (syRes && syRes.success && syRes.data) {
          state.syncData = syRes.data;
        } else if (!state.loadError && syRes && !syRes.success) {
          state.loadError = syRes.message || 'تعذر تحميل حالة المزامنة.';
        }
        if (showToast && !state.loadError) {
          ctx.toast('تم تحديث بيانات المعاينة بنجاح (قراءة فقط).');
        }
      } catch (err) {
        state.loadError = (err && err.message) || 'حدث خطأ أثناء تحميل بيانات المعاينة.';
      } finally {
        state.loading = false;
        renderPreviewPanel();
      }
    }

    function renderPreviewPanel() {
      if (!hostEl.isConnected) return;
      if (state.loading && !state.outboxData && !state.syncData) {
        hostEl.innerHTML = '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
        return;
      }

      var ob = state.outboxData || {};
      var sy = state.syncData || {};
      var sum = ob.summary || {};
      var stCnt = sum.statusCounts || {};
      var clCnt = sum.classificationCounts || {};
      var pg = ob.pagination || { page: 1, pageSize: 25, totalFiltered: 0, totalPages: 1 };
      var items = Array.isArray(ob.items) ? ob.items : [];
      var breakdown = Array.isArray(ob.breakdown) ? ob.breakdown : [];
      var facets = ob.facets || { actions: [], entityTypes: [] };
      var baseline = ob.dataBaselineCounts || {};
      var tsFindings = Array.isArray(ob.timestampAuditFindings) ? ob.timestampAuditFindings : [];
      var rgSync = sy.rentalGateSync || {};
      var gsSync = sy.googleSheetsSync || {};
      var isSandbox = Boolean(ob.isSandboxMode || sy.isSandboxMode);

      var syncStatusBadgeCls = gsSync.state === 'paused'
        ? 'is-warning'
        : (gsSync.state === 'active' ? 'is-healthy' : (gsSync.state === 'sandbox' ? 'is-unknown' : 'is-warning'));

      var tabsHtml =
        '<div class="rg-obp-tabs" role="tablist">' +
          '<button type="button" class="rg-obp-tab ' + (state.activeTab === 'outbox' ? 'is-active' : '') + '" data-obp-tab="outbox">معاينة وتنظيف Outbox (<span class="tabular-nums">' + Number(sum.total || 0) + '</span>)</button>' +
          '<button type="button" class="rg-obp-tab ' + (state.activeTab === 'sync' ? 'is-active' : '') + '" data-obp-tab="sync">تحكم مزامنة Google Sheets (معاينة)</button>' +
          '<button type="button" class="rg-obp-tab ' + (state.activeTab === 'audit' ? 'is-active' : '') + '" data-obp-tab="audit">تدقيق closed_at وخط الأساس (<span class="tabular-nums">' + tsFindings.length + '</span>)</button>' +
        '</div>';

      var bannerHtml =
        '<div class="rg-hc-banner ' + (isSandbox ? 'is-warning' : 'is-healthy') + '">' +
          '<div class="rg-hc-banner-main">' +
            '<div class="rg-hc-banner-title-row">' +
              '<h3 class="rg-hc-banner-title">وضع المعاينة غير التعديلية — Phase 1–2 Read-Only</h3>' +
              '<span class="rg-hc-status-badge ' + (isSandbox ? 'is-warning' : 'is-healthy') + '">' + (isSandbox ? 'SANDBOX PREVIEW' : 'NEON LIVE READ-ONLY') + '</span>' +
            '</div>' +
            '<div class="rg-hc-banner-meta">' +
              '<span>' + escapeHtml(ob.sandboxNotice || ob.mutationsDisabledReason || 'لا يتم تنفيذ أي حذف أو أرشفة أو إيقاف مزامنة إلا بعد موافقتك على المرحلة 3.') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="rg-hc-controls-group">' +
            '<button type="button" class="btn btn-sm btn-primary" id="obp-refresh-btn"' + (state.loading ? ' disabled' : '') + '>' + (state.loading ? 'جاري التحديث...' : 'تحديث المعاينة') + '</button>' +
            '<button type="button" class="btn btn-sm" id="obp-export-btn">تصدير تقرير المعاينة (JSON)</button>' +
          '</div>' +
        '</div>';

      var errHtml = state.loadError
        ? '<div class="rg-hc-alert-box"><div><strong>تنبيه تحميل المعاينة:</strong> ' + escapeHtml(state.loadError) + '</div></div>'
        : '';

      var bodyHtml = '';

      if (state.activeTab === 'outbox') {
        var actionOpts = '<option value="all">كل الإجراءات</option>' +
          (facets.actions || []).map(function (a) {
            return '<option value="' + escapeHtml(a) + '"' + (state.filters.actionType === a ? ' selected' : '') + '>' + escapeHtml(a) + '</option>';
          }).join('');

        bodyHtml =
          '<div class="rg-obp-kpi-grid">' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">إجمالي عمليات Outbox</span><span class="rg-hc-kv-v tabular-nums">' + Number(sum.total || 0) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">مكتملة (Completed / Sent)</span><span class="rg-hc-kv-v is-success tabular-nums">' + Number(stCnt.completed || 0) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">فاشلة نهائياً (Dead Letter)</span><span class="rg-hc-kv-v ' + (Number(stCnt.dead_letter || 0) > 0 ? 'is-danger' : '') + ' tabular-nums">' + Number(stCnt.dead_letter || 0) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">إعادة محاولة (Retry)</span><span class="rg-hc-kv-v ' + (Number(stCnt.retry || 0) > 0 ? 'is-warning' : '') + ' tabular-nums">' + Number(stCnt.retry || 0) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">منتظرة / قيد التنفيذ</span><span class="rg-hc-kv-v tabular-nums">' + (Number(stCnt.pending || 0) + Number(stCnt.processing || 0)) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آمن للأرشفة (المرحلة 3)</span><span class="rg-hc-kv-v is-success tabular-nums">' + Number(clCnt.safeToArchive || 0) + '</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">نتائج غير مؤكدة / مراجعة</span><span class="rg-hc-kv-v ' + (Number(clCnt.manualReview || 0) > 0 ? 'is-warning' : '') + ' tabular-nums">' + Number(clCnt.manualReview || 0) + ' (' + Number(clCnt.uncertainResult || 0) + ' غير مؤكد)</span></div>' +
            '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أقدم عملية مسجلة</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:12px;">' + escapeHtml(sum.oldestCreatedAt ? formatSettingDateTime(sum.oldestCreatedAt, ctx) : '-') + '</span></div>' +
          '</div>' +

          '<div class="rg-hc-subbox">' +
            '<div class="rg-hc-subbox-head">' +
              '<span>تقدير حجم البيانات القابلة للأرشفة مقابل حجم الجدول الفعلي</span>' +
              '<span class="mono tabular-nums" dir="ltr" style="font-size:11.5px;">Safe Payload: ' + escapeHtml(formatBytesHuman(sum.estimatedSafeArchivePayloadBytes)) + ' · Total Payload: ' + escapeHtml(formatBytesHuman(sum.estimatedTotalPayloadBytes)) + (sum.tableTotalBytes !== null && sum.tableTotalBytes !== undefined ? (' · Table Relation: ' + escapeHtml(formatBytesHuman(sum.tableTotalBytes))) : '') + '</span>' +
            '</div>' +
            '<p style="margin:0;font-size:12px;color:var(--text-secondary);">' + escapeHtml(ob.spaceEstimationNote || '') + '</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:4px;">' +
              '<button type="button" class="btn btn-sm" disabled title="مغلق في المرحلة 2 (معاينة فقط)">معاينة الأرشفة التعديلية (مغلق حتى المرحلة 3)</button>' +
              '<button type="button" class="btn btn-sm" disabled title="مغلق في المرحلة 2 (معاينة فقط)">تنفيذ التنظيف (مغلق حتى المرحلة 3)</button>' +
            '</div>' +
          '</div>' +

          (breakdown.length ? (
            '<div class="rg-hc-subbox">' +
              '<div class="rg-hc-subbox-head"><span>توزيع العمليات حسب نوع الإجراء والكيان</span><span class="tabular-nums">' + breakdown.length + ' فئة</span></div>' +
              '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>Action</th><th>Entity</th><th>الإجمالي</th><th>مكتمل</th><th>فاشل</th><th>إعادة/انتظار</th><th>آمن للأرشفة</th><th>مراجعة</th><th>حجم البيانات</th></tr></thead><tbody>' +
                breakdown.map(function (b) {
                  return '<tr>' +
                    '<td class="mono" dir="ltr">' + escapeHtml(b.action) + '</td>' +
                    '<td class="mono" dir="ltr">' + escapeHtml(b.entityType) + '</td>' +
                    '<td class="tabular-nums">' + Number(b.totalCount || 0) + '</td>' +
                    '<td class="tabular-nums">' + Number(b.completedCount || 0) + '</td>' +
                    '<td class="tabular-nums">' + Number(b.deadLetterCount || 0) + '</td>' +
                    '<td class="tabular-nums">' + (Number(b.retryCount || 0) + Number(b.pendingCount || 0) + Number(b.processingCount || 0)) + '</td>' +
                    '<td class="tabular-nums">' + Number(b.safeToArchiveCount || 0) + '</td>' +
                    '<td class="tabular-nums">' + Number(b.manualReviewCount || 0) + '</td>' +
                    '<td class="mono tabular-nums" dir="ltr">' + escapeHtml(formatBytesHuman(b.estimatedPayloadBytes)) + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody></table></div>' +
            '</div>'
          ) : '') +

          '<div class="rg-obp-filters">' +
            '<input type="search" class="input" id="obp-search-input" placeholder="بحث بالمعرف أو رقم الحجز أو الخطأ..." value="' + escapeHtml(state.filters.search) + '">' +
            '<select class="select" id="obp-status-select">' +
              '<option value="all"' + (state.filters.status === 'all' ? ' selected' : '') + '>كل الحالات</option>' +
              '<option value="completed"' + (state.filters.status === 'completed' ? ' selected' : '') + '>completed / sent</option>' +
              '<option value="dead_letter"' + (state.filters.status === 'dead_letter' ? ' selected' : '') + '>dead_letter / failed</option>' +
              '<option value="retry"' + (state.filters.status === 'retry' ? ' selected' : '') + '>retry</option>' +
              '<option value="pending"' + (state.filters.status === 'pending' ? ' selected' : '') + '>pending</option>' +
              '<option value="processing"' + (state.filters.status === 'processing' ? ' selected' : '') + '>processing</option>' +
            '</select>' +
            '<select class="select" id="obp-class-select">' +
              '<option value="all"' + (state.filters.classification === 'all' ? ' selected' : '') + '>كل التصنيفات</option>' +
              '<option value="safe_to_archive"' + (state.filters.classification === 'safe_to_archive' ? ' selected' : '') + '>آمن للأرشفة (Safe)</option>' +
              '<option value="keep_active"' + (state.filters.classification === 'keep_active' ? ' selected' : '') + '>يبقى نشطاً (Keep Active)</option>' +
              '<option value="manual_review"' + (state.filters.classification === 'manual_review' ? ' selected' : '') + '>مراجعة يدوية (Manual Review)</option>' +
              '<option value="uncertain_result"' + (state.filters.classification === 'uncertain_result' ? ' selected' : '') + '>نتائج غير مؤكدة فقط</option>' +
            '</select>' +
            '<select class="select" id="obp-action-select">' + actionOpts + '</select>' +
            '<select class="select" id="obp-age-select">' +
              '<option value="0"' + (Number(state.filters.olderThanDays) === 0 ? ' selected' : '') + '>أي عمر (بدون قيد أيام)</option>' +
              '<option value="7"' + (Number(state.filters.olderThanDays) === 7 ? ' selected' : '') + '>أقدم من 7 أيام</option>' +
              '<option value="14"' + (Number(state.filters.olderThanDays) === 14 ? ' selected' : '') + '>أقدم من 14 يوماً</option>' +
              '<option value="30"' + (Number(state.filters.olderThanDays) === 30 ? ' selected' : '') + '>أقدم من 30 يوماً</option>' +
            '</select>' +
            '<input type="date" class="input" id="obp-date-from" value="' + escapeHtml(state.filters.dateFrom) + '" title="من تاريخ">' +
            '<input type="date" class="input" id="obp-date-to" value="' + escapeHtml(state.filters.dateTo) + '" title="إلى تاريخ">' +
            '<button type="button" class="btn btn-sm btn-primary" id="obp-apply-filters-btn">تطبيق</button>' +
          '</div>' +

          (items.length ? (
            '<div class="table-wrap"><table class="rg-hc-table-mini"><thead><tr><th>ID</th><th>Action / Entity</th><th>الحالة</th><th>تصنيف الأمان</th><th>المحاولات</th><th>تاريخ الإيصال / الإنشاء</th><th>الحجم</th><th>التشخيص</th><th>معاينة</th></tr></thead><tbody>' +
              items.map(function (it, idx) {
                var clsBadge = it.classification === 'safe_to_archive'
                  ? 'status-success'
                  : (it.classification === 'keep_active' ? 'status-info' : 'status-warning');
                return '<tr>' +
                  '<td class="mono" dir="ltr">' + escapeHtml(it.id || '-') + '</td>' +
                  '<td class="mono" dir="ltr">' + escapeHtml((it.action || '-') + ' · ' + (it.entityType || '-') + ':' + (it.entityId || '-')) + '</td>' +
                  '<td class="mono" dir="ltr">' + escapeHtml(it.canonicalStatus + (it.rawStatus && it.rawStatus !== it.canonicalStatus ? (' (' + it.rawStatus + ')') : '')) + '</td>' +
                  '<td><span class="status-tag ' + clsBadge + '">' + escapeHtml(it.classificationLabelAr || it.classification) + '</span></td>' +
                  '<td class="tabular-nums">' + Number(it.retryCount || 0) + '/' + Number(it.maxRetries || 5) + '</td>' +
                  '<td class="mono tabular-nums" dir="ltr">' + escapeHtml(formatSettingDateTime(it.completionTimestamp || it.createdAt, ctx)) + '</td>' +
                  '<td class="mono tabular-nums" dir="ltr">' + escapeHtml(formatBytesHuman(it.estimatedPayloadBytes)) + '</td>' +
                  '<td>' + escapeHtml(it.reasonAr || it.lastError || '-') + '</td>' +
                  '<td><button type="button" class="btn btn-sm obp-inspect-row-btn" data-row-idx="' + idx + '">عرض Payload</button></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>'
          ) : (
            '<div class="empty-state" style="padding:18px;">' +
              (isSandbox
                ? 'لا توجد سجلات محلية في طابور Outbox بوضع Sandbox الحالي — عند التشغيل على Neon PostgreSQL ستظهر هنا السجلات الحقيقية مقسمة ومصنفة مع البحث والصفحات.'
                : 'لا توجد سجلات Outbox مطابقة لمعايير التصفية الحالية.') +
            '</div>'
          )) +

          '<div class="rg-obp-pagination">' +
            '<span style="font-size:12px;color:var(--text-secondary);">عرض صفحة <strong class="tabular-nums">' + Number(pg.page || 1) + '</strong> من <strong class="tabular-nums">' + Number(pg.totalPages || 1) + '</strong> · إجمالي النتائج المصفّاة: <strong class="tabular-nums">' + Number(pg.totalFiltered || 0) + '</strong></span>' +
            '<div class="rg-hc-controls-group">' +
              '<button type="button" class="btn btn-sm" id="obp-prev-page"' + (Number(pg.page || 1) <= 1 ? ' disabled' : '') + '>السابق</button>' +
              '<button type="button" class="btn btn-sm" id="obp-next-page"' + (Number(pg.page || 1) >= Number(pg.totalPages || 1) ? ' disabled' : '') + '>التالي</button>' +
            '</div>' +
          '</div>';
      } else if (state.activeTab === 'sync') {
        bodyHtml =
          '<div class="rg-hc-sections-grid">' +
            '<div class="rg-hc-section-card ' + syncStatusBadgeCls + '">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">مزامنة Google Sheets Mirror (المرآة فقط)</h4>' +
                  '<p class="rg-hc-section-sub">فصل كامل عن مزامنة Rental Gate API — المعاينة الحالية قراءة فقط.</p>' +
                '</div>' +
                '<span class="rg-hc-status-badge ' + syncStatusBadgeCls + '">' + escapeHtml(gsSync.stateLabelAr || 'غير محدد') + '</span>' +
              '</div>' +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">العمليات المنتظرة</span><span class="rg-hc-kv-v tabular-nums">' + Number(gsSync.pendingCount || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">العمليات المكتملة</span><span class="rg-hc-kv-v is-success tabular-nums">' + Number(gsSync.completedCount || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">العمليات الفاشلة</span><span class="rg-hc-kv-v ' + (Number(gsSync.failedCount || 0) > 0 ? 'is-danger' : '') + ' tabular-nums">' + Number(gsSync.failedCount || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">المتراكمة أثناء الإيقاف</span><span class="rg-hc-kv-v tabular-nums">' + Number(gsSync.accumulatedDuringPause || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر محاولة</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:12px;">' + escapeHtml(gsSync.lastAttemptAt ? formatSettingDateTime(gsSync.lastAttemptAt, ctx) : '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر نجاح</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:12px;">' + escapeHtml(gsSync.lastSuccessAt ? formatSettingDateTime(gsSync.lastSuccessAt, ctx) : '-') + '</span></div>' +
              '</div>' +
              (gsSync.lastError ? '<div class="rg-hc-alert-box"><div><strong>آخر خطأ في Google Sheets Mirror:</strong> <span class="mono" dir="ltr">' + escapeHtml(gsSync.lastError) + '</span></div></div>' : '') +
              '<div class="rg-hc-subbox">' +
                '<div class="rg-hc-subbox-head"><span>أزرار التحكم المؤجلة للمرحلة 3</span><span>Preview Locked</span></div>' +
                '<p style="margin:0;font-size:12px;color:var(--text-secondary);">' + escapeHtml(sy.controlsLockedNote || '') + '</p>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm" disabled>إيقاف مزامنة Google Sheets مؤقتاً (Phase 3)</button>' +
                  '<button type="button" class="btn btn-sm" disabled>استئناف مزامنة Google Sheets (Phase 3)</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="rg-hc-section-card ' + (rgSync.autoSyncEnabled ? 'is-healthy' : 'is-warning') + '">' +
              '<div class="rg-hc-section-head">' +
                '<div>' +
                  '<h4 class="rg-hc-section-title">مزامنة Rental Gate API (تبقى مستقلة تماماً)</h4>' +
                  '<p class="rg-hc-section-sub">تعمل عبر Neon PostgreSQL بشكل مستقل ولا تتأثر بإيقاف مرآة Google Sheets في المرحلة 3.</p>' +
                '</div>' +
                '<span class="rg-hc-status-badge ' + (rgSync.autoSyncEnabled ? 'is-healthy' : 'is-warning') + '">' + (rgSync.autoSyncEnabled ? 'AUTO SYNC ON' : 'MANUAL') + '</span>' +
              '</div>' +
              '<div class="rg-hc-kv-grid">' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">فاصل السحب المجدول</span><span class="rg-hc-kv-v mono" dir="ltr" style="font-size:12px;">' + escapeHtml(rgSync.pullInterval || '-') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">تهيئة RG_TOKEN</span><span class="rg-hc-kv-v">' + (rgSync.rgTokenConfigured ? 'مضبوط' : 'غير مضبوط') + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">أخطاء متتالية</span><span class="rg-hc-kv-v tabular-nums">' + Number(rgSync.consecutiveErrors || 0) + '</span></div>' +
                '<div class="rg-hc-kv"><span class="rg-hc-kv-k">آخر نجاح سحب RG</span><span class="rg-hc-kv-v mono tabular-nums" dir="ltr" style="font-size:12px;">' + escapeHtml(rgSync.lastSuccessAt ? formatSettingDateTime(rgSync.lastSuccessAt, ctx) : '-') + '</span></div>' +
              '</div>' +
              (rgSync.lastError ? '<div class="rg-hc-alert-box is-warning"><div><strong>آخر تنبيه سحب RG:</strong> <span class="mono" dir="ltr">' + escapeHtml(rgSync.lastError) + '</span></div></div>' : '') +
            '</div>' +
          '</div>';
      } else {
        bodyHtml =
          '<div class="rg-hc-subbox">' +
            '<div class="rg-hc-subbox-head"><span>خط الأساس للبيانات الأساسية (محمية 100% من أي مسح أو تنظيف)</span><span>Core CRM Tables</span></div>' +
            '<div class="rg-hc-kv-grid">' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">reservations</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.reservations || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">customers</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.customers || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">extensions</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.extensions || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">follow_ups</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.followUps || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">problems</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.problems || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">customer_notes</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.customerNotes || 0) + '</span></div>' +
              '<div class="rg-hc-kv"><span class="rg-hc-kv-k">notifications</span><span class="rg-hc-kv-v tabular-nums">' + Number(baseline.notifications || 0) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="rg-hc-scroll-list" style="max-height:none;">' +
            tsFindings.map(function (f) {
              var isCrit = f.severity === 'critical';
              return '<div class="rg-hc-issue-row ' + (isCrit ? 'is-critical' : '') + '">' +
                '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">' +
                  '<strong>' + escapeHtml(f.issueTitleAr || '') + '</strong>' +
                  '<span class="status-tag ' + (isCrit ? 'status-danger' : 'status-success') + '">' + escapeHtml(f.statusAr || '') + '</span>' +
                '</div>' +
                '<div class="rg-hc-code-refs">' + escapeHtml(f.tableName + '.' + f.columnName + ' (' + f.schemaType + ') · ' + f.codeLocation) + '</div>' +
                '<div style="color:var(--text-secondary);">' + escapeHtml(f.detailAr || '') + '</div>' +
                '<div style="color:var(--text-primary);font-weight:600;">التوصية: ' + escapeHtml(f.recommendedFixAr || '') + '</div>' +
              '</div>';
            }).join('') +
          '</div>';
      }

      hostEl.innerHTML = '<div class="rg-hc-shell">' + bannerHtml + errHtml + tabsHtml + bodyHtml + '</div>';

      hostEl.querySelectorAll('.rg-obp-tab').forEach(function (tabBtn) {
        tabBtn.addEventListener('click', function () {
          state.activeTab = tabBtn.getAttribute('data-obp-tab') || 'outbox';
          renderPreviewPanel();
        });
      });

      var refBtn = hostEl.querySelector('#obp-refresh-btn');
      if (refBtn) {
        refBtn.addEventListener('click', function () {
          runWithLock(refBtn, 'obp:refresh', function () { return loadPreviewData(true); });
        });
      }
      var expBtn = hostEl.querySelector('#obp-export-btn');
      if (expBtn) {
        expBtn.addEventListener('click', downloadPreviewJson);
      }

      var applyBtn = hostEl.querySelector('#obp-apply-filters-btn');
      function applyFiltersAndReload() {
        var sInp = hostEl.querySelector('#obp-search-input');
        var stSel = hostEl.querySelector('#obp-status-select');
        var clSel = hostEl.querySelector('#obp-class-select');
        var acSel = hostEl.querySelector('#obp-action-select');
        var agSel = hostEl.querySelector('#obp-age-select');
        var dfInp = hostEl.querySelector('#obp-date-from');
        var dtInp = hostEl.querySelector('#obp-date-to');
        state.filters.search = sInp ? String(sInp.value || '').trim() : '';
        state.filters.status = stSel ? String(stSel.value || 'all') : 'all';
        state.filters.classification = clSel ? String(clSel.value || 'all') : 'all';
        state.filters.actionType = acSel ? String(acSel.value || 'all') : 'all';
        state.filters.olderThanDays = agSel ? Number(agSel.value || 0) : 0;
        state.filters.dateFrom = dfInp ? String(dfInp.value || '') : '';
        state.filters.dateTo = dtInp ? String(dtInp.value || '') : '';
        state.filters.page = 1;
        loadPreviewData(false);
      }
      if (applyBtn) applyBtn.addEventListener('click', applyFiltersAndReload);
      var searchInp = hostEl.querySelector('#obp-search-input');
      if (searchInp) {
        searchInp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            applyFiltersAndReload();
          }
        });
      }
      ['#obp-status-select', '#obp-class-select', '#obp-action-select', '#obp-age-select'].forEach(function (sel) {
        var el = hostEl.querySelector(sel);
        if (el) el.addEventListener('change', applyFiltersAndReload);
      });

      var prevBtn = hostEl.querySelector('#obp-prev-page');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (state.filters.page > 1) {
            state.filters.page -= 1;
            loadPreviewData(false);
          }
        });
      }
      var nextBtn = hostEl.querySelector('#obp-next-page');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          state.filters.page += 1;
          loadPreviewData(false);
        });
      }

      hostEl.querySelectorAll('.obp-inspect-row-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-row-idx'));
          if (Number.isFinite(idx) && items[idx]) openPayloadInspector(items[idx]);
        });
      });

      if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
        root.RGCrmDropdowns.enhanceAll(hostEl);
      }
    }

    loadPreviewData(false);
  }

  root.RGSettings = {
    render: render
  };
})(window);
