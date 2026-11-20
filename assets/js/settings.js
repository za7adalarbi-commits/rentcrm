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

  function formatPersonalSummaryLabels(tf, np, lang) {
    var isEn = lang === 'en';
    var timeTxt = tf === '12h'
      ? (isEn ? '12-Hour (AM/PM)' : 'نظام 12 ساعة (ص / م)')
      : (isEn ? '24-Hour Clock' : 'نظام 24 ساعة');
    var posTxt = np === 'top'
      ? (isEn ? 'Top Bar (Icons Only)' : 'في الأعلى (أيقونات فقط)')
      : (np === 'bottom'
          ? (isEn ? 'Bottom Dock (Icons Only)' : 'في الأسفل (أيقونات فقط)')
          : (isEn ? 'Side Bar' : 'على الجانب'));
    return { timeTxt: timeTxt, posTxt: posTxt };
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
    var labels = formatPersonalSummaryLabels(tf, np, ctx && ctx.lang);
    var userName = (user && user.name) ? user.name : '';
    return '<div class="surface-card rg-personal-entry-card" id="personal-settings-card">' +
      '<div class="section-header" style="margin-bottom:12px;">' +
        '<div>' +
          '<h2 class="section-title">' + (isEn ? 'Personal Account Settings' : 'الحساب الشخصي وتفضيلات العرض') + '</h2>' +
          '<p class="section-subtitle">' + (isEn
            ? ('Control your preferred 12h/24h time format and Top, Side, or Bottom icon navigation bar' + (userName ? (' — ' + escapeHtml(userName)) : '') + '.')
            : ('تحكم في طريقة عرض الوقت (12 أو 24 ساعة) وموضع شريط الأقسام (على الجانب أو في الأعلى أو في الأسفل كأيقونات بدون كتابة)' + (userName ? (' — ' + escapeHtml(userName)) : '') + '.')) + '</p>' +
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
    var onPersonalChange = function (ev) {
      if (!container || !container.isConnected) {
        document.removeEventListener('rg:personalprefschange', onPersonalChange);
        return;
      }
      var det = (ev && ev.detail) || {};
      var tf = det.timeFormat || ((ctx && ctx.getTimeFormat) ? ctx.getTimeFormat() : '24h');
      var np = det.sidebarPosition || ((ctx && ctx.getSidebarPosition) ? ctx.getSidebarPosition() : 'side');
      var labels = formatPersonalSummaryLabels(tf, np, ctx && ctx.lang);
      var timeEl = document.getElementById('personal-summary-time');
      var posEl = document.getElementById('personal-summary-pos');
      if (timeEl) timeEl.textContent = labels.timeTxt;
      if (posEl) posEl.textContent = labels.posTxt;
    };
    document.addEventListener('rg:personalprefschange', onPersonalChange);
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var user = root.RGAuth.getUser();
    var canAccessApi = root.RGCrmCore.canAccessApi(user);
    var canSync = root.RGCrmCore.canUserPerform(user, 'sync_data');
    var canManageSettings = root.RGCrmCore.canUserPerform(user, 'manage_settings');
    var personalCardHtml = buildPersonalAccountCardHtml(user, ctx);

    if (!canAccessApi && !canManageSettings) {
      container.innerHTML =
        personalCardHtml +
        '<div class="surface-card">' +
          '<h2 class="section-title">إعدادات النظام والربط</h2>' +
          '<p class="section-subtitle">إعدادات النظام وربط API والمزامنة مخصصة للمدير العام والمشرف فقط، بينما تبقى إعدادات الحساب الشخصي متاحة لك أعلاه.</p>' +
        '</div>';
      bindPersonalAccountCard(container, ctx);
      return;
    }

    var results = await Promise.all([
      root.RGApi.callApi('getSettings', {}),
      canSync ? root.RGApi.callApi('getSyncStatus', {}) : Promise.resolve({ success: true, data: { logs: [], lastSync: null } }),
      root.RGApi.getSetupCapabilities ? root.RGApi.getSetupCapabilities().catch(function () { return { success: false }; }) : Promise.resolve({ success: false })
    ]);

    var settingsRes = results[0];
    var syncRes = results[1];
    var capsRes = results[2];
    var settings = (settingsRes.success && settingsRes.data) || {};
    var syncData = (syncRes.success && syncRes.data) || { logs: [], lastSync: null };
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
    var hasSyncSecret = Boolean(settings.hasSyncSecret || caps.hasSyncSecret);
    var writableCoreFiles = settings.writableCoreFiles !== undefined ? Boolean(settings.writableCoreFiles) : (caps.writableCoreFiles !== false);
    var currentRgBaseUrl = String(settings.rg_api_base_url || caps.rgApiBaseUrl || 'https://api.rentalgate.net/api').trim();

    var sourceLabels = {
      global_config: 'ربط تلقائي ثابت في الكود الأساسي (config.js / قاعدة البيانات)',
      query_param: 'ربط تلقائي عبر الرابط المشارك',
      local_storage: 'محفوظ في هذا المتصفح',
      local_sandbox: 'وضع المعاينة المحلية (تجاوز مؤقت)',
      sandbox: 'وضع المعاينة المحلية (Sandbox)'
    };
    var connModeSubtitle = isBackendConnected
      ? ('الوضع الحالي: <strong>متصل بقاعدة البيانات السحابية (Neon PostgreSQL)</strong> · الكود الأساسي: <strong>' + (writableCoreFiles ? 'قابل للتعديل والتثبيت التلقائي' : 'استضافة سحابية (Neon العالمية)') + '</strong>')
      : ('الوضع الحالي: <strong>' + (root.RGApi.isLiveMode() ? 'متصل بـ Google Apps Script & Google Sheets' : 'وضع المعاينة المحلية (Sandbox)') + '</strong> · المصدر: <strong>' + (sourceLabels[connInfo.source] || connInfo.source || 'تلقائي') + '</strong>');

    var isGeneralManager = Boolean(user && root.RGCrmCore && root.RGCrmCore.ROLES && user.role === root.RGCrmCore.ROLES.GENERAL_MANAGER);
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

    container.innerHTML =
      personalCardHtml +
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">مركز الوضع والربط الشامل (تثبيت تلقائي في الكود الأساسي)</h2>' +
            '<p class="section-subtitle">' + connModeSubtitle + '</p>' +
          '</div>' +
        '</div>' +

        '<div class="detail-summary-grid" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));">' +
          '<div class="detail-kv"><span class="detail-k">وضع التشغيل الحالي</span><span class="detail-v">' + (activeMode === 'neon' ? 'Neon PostgreSQL + Apps Script' : (activeMode === 'gas' ? 'Google Apps Script مباشر' : 'وضع المعاينة المحلية')) + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">قاعدة البيانات (Neon)</span><span class="detail-v" style="font-size:12.5px;overflow-wrap:anywhere;">' + (hasDatabaseUrl ? ('متصلة <span class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-secondary);">(' + escapeHtml((maskedDbUrl || '').replace(/^postgres(ql)?:\/\/\*\*\*@/i, '')) + ')</span>') : 'غير مربوطة بعد') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">توكن Rental Gate</span><span class="detail-v">' + (hasRgToken ? 'محفوظ ومشفر' : 'غير محفوظ بعد') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">تثبيت الكود الأساسي</span><span class="detail-v">' + (writableCoreFiles ? 'مفعل (config.js + fixedConfig.ts)' : 'حفظ عالمي في Neon') + '</span></div>' +
        '</div>' +

        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="setup-mode">وضع تشغيل النظام للجميع</label>' +
            '<select class="select" id="setup-mode">' +
              '<option value="neon"' + (activeMode === 'neon' ? ' selected' : '') + '>سحابي: Neon PostgreSQL + Apps Script</option>' +
              '<option value="gas"' + (activeMode === 'gas' ? ' selected' : '') + '>مباشر: Google Apps Script &amp; Sheets</option>' +
              '<option value="sandbox"' + (activeMode === 'sandbox' ? ' selected' : '') + '>محلي: وضع المعاينة (Sandbox)</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="set-gas-url">رابط Google Apps Script Web App (/exec)</label>' +
            '<input class="input mono" id="set-gas-url" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="' + escapeHtml(currentGasUrl) + '">' +
          '</div>' +
        '</div>' +

        (canManageSettings ? (
          '<div id="setup-neon-fields" class="form-grid-2" style="margin-top:12px;">' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-database-url">رابط قاعدة بيانات Neon PostgreSQL (DATABASE_URL)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="setup-database-url" dir="ltr" autocomplete="off" spellcheck="false" placeholder="' + (hasDatabaseUrl ? 'مضبوط حاليًا — اتركه فارغًا للإبقاء عليه أو الصق رابطًا جديدًا' : 'postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require') + '">' +
                '<button type="button" class="password-toggle-btn" id="toggle-setup-db-url" aria-label="إظهار رابط قاعدة البيانات">إظهار</button>' +
              '</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-rg-token">توكن Rental Gate API (RG_TOKEN)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="setup-rg-token" dir="ltr" autocomplete="off" spellcheck="false" placeholder="' + (hasRgToken ? 'محفوظ ومشفر — اتركه فارغًا للإبقاء عليه أو الصق توكن جديد' : 'الصق Bearer Token هنا ليُحفظ مشفرًا ويُثبت تلقائيًا') + '">' +
                '<button type="button" class="password-toggle-btn" id="toggle-setup-rg-token" aria-label="إظهار التوكن">إظهار</button>' +
              '</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-rg-api-base">رابط واجهة Rental Gate API الأساسي</label>' +
              '<input class="input mono" id="setup-rg-api-base" dir="ltr" value="' + escapeHtml(currentRgBaseUrl) + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-sync-secret">مفتاح المزامنة الآمنة (SYNC_API_SECRET)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="setup-sync-secret" dir="ltr" autocomplete="off" spellcheck="false" placeholder="' + (hasSyncSecret ? 'مولد ومحفوظ تلقائيًا — اتركه فارغًا للإبقاء عليه' : 'اتركه فارغًا ليتم توليده وتثبيته تلقائيًا') + '">' +
                '<button type="button" class="password-toggle-btn" id="toggle-setup-sync-secret" aria-label="إظهار مفتاح المزامنة">إظهار</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="setup-admin-verify-wrap" class="form-grid-2' + (!isBackendConnected ? '' : ' hidden') + '" style="margin-top:10px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-admin-username">حساب المدير العام للتأكيد (عند التحويل من المعاينة أو Apps Script)</label>' +
              '<input type="text" class="input mono" id="setup-admin-username" dir="ltr" autocomplete="username" value="' + escapeHtml((user && user.username) || 'admin') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="setup-admin-password">كلمة مرور المدير العام في Neon (التحقق)</label>' +
              '<div class="password-field-wrap">' +
                '<input type="password" class="input mono" id="setup-admin-password" dir="ltr" autocomplete="current-password" placeholder="أدخل كلمة مرور المدير (الافتراضية Admin@123)">' +
                '<button type="button" class="password-toggle-btn" id="toggle-setup-admin-password" aria-label="إظهار كلمة مرور المدير">إظهار</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:10px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<label class="checkbox-item" style="font-weight:700;flex-wrap:wrap;">' +
              '<input type="checkbox" id="setup-persist-core"' + (writableCoreFiles ? ' checked' : '') + '>' +
              '<span>تعديل وتثبيت الإعدادات في الكود الأساسي لتصبح ثابتة دائمًا:</span>' +
              '<span class="mono" dir="ltr" style="font-size:12px;color:var(--text-secondary);">assets/js/config.js · backend/fixedConfig.ts · .env</span>' +
            '</label>' +
          '</div>'
        ) : '') +

        '<div class="toolbar-row" style="margin-top:12px;margin-bottom:0;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-primary" id="btn-save-gas-url">حفظ وربط وتثبيت في الكود الأساسي</button>' +
          '<button type="button" class="btn" id="btn-ping-gas-url">فحص رابط Apps Script</button>' +
          '<button type="button" class="btn btn-charcoal" id="btn-copy-autoconnect-link">نسخ رابط الربط التلقائي للفريق</button>' +
          (!isBackendConnected && connInfo.defaultUrl && (connInfo.source === 'local_storage' || connInfo.source === 'local_sandbox') ? '<button type="button" class="btn" id="btn-restore-global-gas">استعادة الربط التلقائي العام</button>' : '') +
          '<button type="button" class="btn btn-danger" id="btn-clear-gas-url">العودة لوضع المعاينة</button>' +
        '</div>' +

        '<div id="gas-ping-result" class="hidden" style="margin-top:10px;"></div>' +
        '<div id="setup-core-files-report" class="hidden" style="margin-top:10px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);font-size:12.5px;"></div>' +
        '<div id="autoconnect-share-wrap" class="hidden" style="margin-top:10px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
          '<div style="font-size:12px;font-weight:700;margin-bottom:6px;">رابط الدخول المربوط تلقائيًا (أي موظف يفتحه يرتبط بالخادم فورًا دون إدخال أي رابط):</div>' +
          '<input type="text" class="input mono" id="autoconnect-share-url" dir="ltr" readonly style="font-size:12px;">' +
        '</div>' +
        '<details style="margin-top:12px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
          '<summary style="cursor:pointer;font-weight:700;font-size:13px;">الربط التلقائي للجميع + خطوات تجهيز Rental Gate API وGoogle Apps Script</summary>' +
          '<div style="margin:10px 0 8px;padding:8px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-hairline);font-size:12.5px;line-height:1.75;">' +
            '<strong>كيف يتم تثبيت كل شيء تلقائيًا من هذه الصفحة؟</strong>' +
            '<ul style="margin:6px 0 0;padding-inline-start:18px;">' +
              '<li>بمجرد الضغط على <strong>حفظ وربط وتثبيت في الكود الأساسي</strong>، يختبر النظام الاتصال بـ Neon ويهيئ الجداول تلقائيًا، ويحفظ الإعدادات مشفرة في قاعدة البيانات، ويدفع مفاتيح المزامنة إلى Google Apps Script.</li>' +
              '<li>على البيئة المحلية/الخادم القابل للكتابة يتم تعديل <span class="mono" dir="ltr">assets/js/config.js</span> و<span class="mono" dir="ltr">backend/fixedConfig.ts</span> و<span class="mono" dir="ltr">.env</span> مباشرةً لتصبح ثابتة في الكود الأساسي حتى بعد إعادة البناء أو الرفع.</li>' +
            '</ul>' +
          '</div>' +
          '<ol style="margin:8px 0 0;padding-inline-start:20px;font-size:12.5px;line-height:1.8;color:var(--text-secondary);">' +
            '<li>أنشئ مشروع Apps Script (أو من داخل Google Sheet عبر <strong>Extensions → Apps Script</strong>) وارفع <strong>كامل</strong> ملفات مجلد <span class="mono">google-apps-script/</span> (وعلى رأسها <span class="mono">Code.gs</span> الذي يحتوي على <span class="mono">doGet</span> و<span class="mono">doPost</span>) + <span class="mono">appsscript.json</span> ثم احفظ (<span class="mono">Ctrl+S</span>).</li>' +
            '<li>انشر المشروع كـ <strong>Web App</strong> (Execute as: <strong>Me</strong> · Who has access: <strong>Anyone</strong>) وانسخ رابط <span class="mono">/exec</span>. عند تعديل أي ملف لاحقاً اختر <strong>Deploy → Manage deployments → Edit → Version: New version → Deploy</strong> لتجنب خطأ <span class="mono" dir="ltr">Script function not found: doGet</span>.</li>' +
            '<li>أدخل رابط Neon ورابط <span class="mono">/exec</span> وتوكن <span class="mono">RG_TOKEN</span> أعلاه ثم اضغط <strong>حفظ وربط وتثبيت في الكود الأساسي</strong>.</li>' +
            '<li>بعد الربط، اضغط <strong>اختبار الاتصال</strong> ثم <strong>سحب الحجوزات الآن</strong>.</li>' +
          '</ol>' +
        '</details>' +
      '</div>' +

      (canSync ? (
        '<div class="surface-card">' +
          '<div class="section-header">' +
            '<div><h2 class="section-title">مزامنة بيانات Rental Gate API</h2>' +
            '<p class="section-subtitle">يتم السحب عبر الخادم السحابي وGoogle Apps Script · الكاش المحلي (IndexedDB): <strong class="tabular-nums">' + cacheStats.reservationsCount + '</strong> حجز · <strong class="tabular-nums">' + cacheStats.customersCount + '</strong> عميل</p></div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn" id="btn-test-rg">اختبار الاتصال</button>' +
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
            '<div class="detail-kv"><span class="detail-k">حالة الاتصال</span><span class="detail-v" id="sync-conn-status">' + (isBackendConnected || root.RGApi.isLiveMode() ? (hasRgToken ? 'RG_TOKEN محفوظ ومربوط تلقائيًا' : 'يرجى حفظ RG_TOKEN') : (settings.sandbox_has_rg_token ? 'تم التحقق من صيغة التوكن (وضع المعاينة)' : 'وضع المعاينة المحلية')) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + escapeHtml(autoSyncBadgeText) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono" dir="ltr">' + (lastSync ? escapeHtml(formatSettingDateTime(lastSync.finishedAt, ctx)) : 'لم يتم السحب بعد') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">الحجوزات المستوردة / المحدثة / التمديدات</span><span class="detail-v tabular-nums">' + (lastSync ? (lastSync.importedCount + ' مستورد · ' + lastSync.updatedCount + ' محدث · ' + lastSync.extensionsCount + ' تمديد') : '0 / 0 / 0') + '</span></div>' +
          '</div>' +
          '<div style="margin-bottom:16px;padding:12px 14px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<label class="form-label" for="set-rg-token">تحديث سريع لتوكن Rental Gate (RG_TOKEN / RENTAL_TOKEN)</label>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">' +
              '<div class="password-field-wrap" style="flex:1;min-width:240px;">' +
                '<input type="password" class="input mono" id="set-rg-token" dir="ltr" autocomplete="off" spellcheck="false" placeholder="الصق Bearer Token هنا ليُحفظ مشفرًا ويُدفع لـ Apps Script تلقائيًا">' +
                '<button type="button" class="password-toggle-btn" id="toggle-rg-token" aria-label="إظهار التوكن">إظهار</button>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" id="btn-save-rg-token">حفظ التوكن وتحديث الربط</button>' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">يُشفر التوكن بـ AES-256-GCM داخل Neon ويُدفع تلقائيًا إلى Script Properties ولا يظهر في المتصفح أو الملفات العامة.</div>' +
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

          '<div style="margin-top:14px;"><button type="submit" class="btn btn-primary" id="btn-save-sys-settings">حفظ الإعدادات وتحديث المزامنة التلقائية</button></div>' +
        '</form>' +
        '<div class="surface-card" id="danger-zone-reservations-card" style="border-top:3px solid var(--status-danger-text, #f43f5e);">' +
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

    bindPasswordToggle('setup-database-url', 'toggle-setup-db-url');
    bindPasswordToggle('setup-rg-token', 'toggle-setup-rg-token');
    bindPasswordToggle('setup-sync-secret', 'toggle-setup-sync-secret');
    bindPasswordToggle('setup-admin-password', 'toggle-setup-admin-password');
    bindPasswordToggle('set-rg-token', 'toggle-rg-token');

    var saveGasBtn = document.getElementById('btn-save-gas-url');
    if (saveGasBtn) {
    saveGasBtn.addEventListener('click', function () {
      var modeEl = document.getElementById('setup-mode');
      var selectedMode = modeEl ? modeEl.value : (isBackendConnected ? 'neon' : 'gas');
      var gasVal = document.getElementById('set-gas-url').value.trim();
      var dbUrlEl = document.getElementById('setup-database-url');
      var dbUrlVal = dbUrlEl ? dbUrlEl.value.trim() : '';
      var rgTokEl = document.getElementById('setup-rg-token');
      var rgTokVal = rgTokEl ? rgTokEl.value.trim() : '';
      var rgBaseEl = document.getElementById('setup-rg-api-base');
      var rgBaseVal = rgBaseEl ? rgBaseEl.value.trim() : '';
      var syncSecretEl = document.getElementById('setup-sync-secret');
      var syncSecretVal = syncSecretEl ? syncSecretEl.value.trim() : '';
      var adminVerifyWrap = document.getElementById('setup-admin-verify-wrap');
      var adminUserEl = document.getElementById('setup-admin-username');
      var adminPwdEl = document.getElementById('setup-admin-password');
      var adminUsernameVal = adminUserEl ? adminUserEl.value.trim() : ((user && user.username) || 'admin');
      var adminPasswordVal = adminPwdEl ? adminPwdEl.value : '';
      var persistCoreEl = document.getElementById('setup-persist-core');
      var persistCore = persistCoreEl ? Boolean(persistCoreEl.checked) : true;

      var out = document.getElementById('gas-ping-result');
      var reportBox = document.getElementById('setup-core-files-report');

      if (gasVal && root.RGCrmCore && root.RGCrmCore.validateGasUrl) {
        var check = root.RGCrmCore.validateGasUrl(gasVal);
        if (!check.valid) {
          out.className = 'form-error';
          out.textContent = check.message;
          return;
        }
        gasVal = check.normalized;
      }

      if (selectedMode === 'gas' && !gasVal) {
        out.className = 'form-error';
        out.textContent = 'يرجى إدخال رابط Google Apps Script (/exec) لتفعيل وضع Google Apps Script.';
        return;
      }

      if (selectedMode === 'neon' && !dbUrlVal && !hasDatabaseUrl) {
        out.className = 'form-error';
        out.textContent = 'يرجى إدخال رابط قاعدة بيانات Neon PostgreSQL (DATABASE_URL) أولاً.';
        return;
      }

      runWithLock(saveGasBtn, 'applyUnifiedSetup', async function () {
        var prevText = saveGasBtn.textContent;
        saveGasBtn.textContent = 'جاري الاختبار والربط وتثبيت الكود...';
        try {
          if (root.RGApi.applyUnifiedSetup) {
            var res = await root.RGApi.applyUnifiedSetup({
              mode: selectedMode,
              databaseUrl: dbUrlVal,
              gasWebAppUrl: gasVal,
              keepExistingGasUrl: selectedMode !== 'sandbox' && Boolean(gasVal),
              rgToken: rgTokVal,
              rgApiBaseUrl: rgBaseVal,
              syncApiSecret: syncSecretVal,
              persistCoreFiles: persistCore,
              adminUsername: adminUsernameVal,
              adminPassword: adminPasswordVal,
              actorRole: user ? user.role : '',
              actorName: user ? user.name : '',
              siteOrigin: window.location.origin
            });

            if (res && !res.staticHostOnly) {
              if (res.success && res.data) {
                if (dbUrlEl) dbUrlEl.value = '';
                if (rgTokEl) rgTokEl.value = '';
                if (syncSecretEl) syncSecretEl.value = '';
                if (adminPwdEl) adminPwdEl.value = '';

                out.className = 'form-success';
                out.textContent = res.data.message || 'تم الحفظ والربط وتثبيت الإعدادات بنجاح.';

                if (reportBox) {
                  var filesList = Array.isArray(res.data.updatedFiles) ? res.data.updatedFiles : [];
                  if (filesList.length > 0) {
                    reportBox.classList.remove('hidden');
                    reportBox.innerHTML =
                      '<strong>تم تعديل ملفات الكود الأساسي بنجاح:</strong> ' +
                      '<span class="mono" dir="ltr">' + escapeHtml(filesList.join(' · ')) + '</span>';
                  } else if (res.data.needsVercelEnvVar) {
                    reportBox.classList.remove('hidden');
                    reportBox.innerHTML =
                      '<strong>تم الاختبار والربط بـ Neon على الجلسة الحالية، ولكن يلزم خطوة واحدة لتثبيته دائمًا على Vercel:</strong>' +
                      '<div style="margin-top:6px;color:var(--text-secondary);line-height:1.7;">أضف المتغير <span class="mono" dir="ltr">DATABASE_URL</span> في لوحة Vercel ← <strong>Settings → Environment Variables</strong> ثم اضغط <strong>Redeploy</strong> حتى لا ينقطع الاتصال بعد إعادة تشغيل السيرفر.</div>' +
                      '<div style="margin-top:8px;"><button type="button" class="btn btn-primary btn-sm" id="btn-proceed-neon-login">الانتقال الآن لشاشة تسجيل الدخول في Neon</button></div>';
                  } else if (res.data.readOnlyFilesystem && res.data.generatedConfigJs) {
                    reportBox.classList.remove('hidden');
                    reportBox.innerHTML =
                      '<strong>تم الحفظ عالميًا في Neon PostgreSQL لجميع المستخدمين.</strong>' +
                      '<div style="margin-top:4px;color:var(--text-muted);">ملاحظة: استضافة Vercel للقراءة فقط لا تعدل الملفات أثناء التشغيل، لكن الموقع يقرأ الإعدادات من Neon تلقائيًا لكل زائر.</div>';
                  } else {
                    reportBox.classList.add('hidden');
                  }
                }

                var switchedAuthRealm = (selectedMode === 'neon' && !isBackendConnected) || (selectedMode === 'gas' && isBackendConnected) || (selectedMode === 'sandbox' && (isBackendConnected || root.RGApi.isLiveMode()));
                ctx.toast(res.data.coreFilesUpdated ? 'تم الحفظ وتعديل الكود الأساسي ليكون ثابتًا!' : 'تم الحفظ والربط التلقائي بنجاح!');

                if (res.data.needsVercelEnvVar && switchedAuthRealm) {
                  var proceedBtn = document.getElementById('btn-proceed-neon-login');
                  if (proceedBtn) {
                    proceedBtn.addEventListener('click', async function () {
                      root.RGApi.setToken('');
                      await root.RGAuth.logout().catch(function () {});
                      ctx.onAuthChanged();
                    });
                  }
                  return;
                }

                if (switchedAuthRealm) {
                  root.RGApi.setToken('');
                  await root.RGAuth.logout().catch(function () {});
                  ctx.onAuthChanged();
                  return;
                }
                render(container, ctx);
                return;
              }

              var errCode = String((res && (res.error || res.message)) || '');
              if (errCode.indexOf('ADMIN_VERIFY_REQUIRED') !== -1 || errCode.indexOf('كلمة مرور المدير') !== -1) {
                if (adminVerifyWrap) adminVerifyWrap.classList.remove('hidden');
                if (adminPwdEl) adminPwdEl.focus();
              }
              out.className = 'form-error';
              out.textContent = (res && res.message) || 'تعذر حفظ إعدادات الربط.';
              return;
            }
          }

          // Pure static hosting fallback (no Node/Vercel backend available on origin)
          root.RGApi.setGasUrl(selectedMode === 'sandbox' ? '' : gasVal);
          root.RGApi.setToken('');
          ctx.toast(selectedMode !== 'sandbox' && gasVal
            ? 'تم حفظ رابط Google Apps Script. يرجى تسجيل الدخول على الخادم الفعلي.'
            : 'تم التبديل إلى وضع المعاينة المحلية.');
          root.RGAuth.logout().then(function () { ctx.onAuthChanged(); });
        } finally {
          if (saveGasBtn.isConnected !== false) saveGasBtn.textContent = prevText;
        }
      });
    });
    }

    var clearGasBtn = document.getElementById('btn-clear-gas-url');
    if (clearGasBtn) {
      clearGasBtn.addEventListener('click', function () {
        root.RGApi.setGasUrl('');
        root.RGApi.setToken('');
        ctx.toast('تم التبديل إلى وضع المعاينة المحلية.');
        ctx.onAuthChanged();
      });
    }

    var restoreGlobalBtn = document.getElementById('btn-restore-global-gas');
    if (restoreGlobalBtn) {
      restoreGlobalBtn.addEventListener('click', function () {
        root.RGApi.setGasUrl('__DEFAULT__');
        root.RGApi.setToken('');
        ctx.toast('تمت استعادة الربط التلقائي العام.');
        ctx.onAuthChanged();
      });
    }

    var copyAutoconnectBtn = document.getElementById('btn-copy-autoconnect-link');
    if (copyAutoconnectBtn) {
      copyAutoconnectBtn.addEventListener('click', async function () {
        var raw = document.getElementById('set-gas-url').value.trim();
        var out = document.getElementById('gas-ping-result');
        var shareUrl = (root.RGCrmCore && root.RGCrmCore.buildAutoConnectShareUrl)
          ? root.RGCrmCore.buildAutoConnectShareUrl(window.location.origin, window.location.pathname, raw)
          : '';
        if (!shareUrl) {
          out.className = 'form-error';
          out.textContent = 'أدخل رابط Google Apps Script (/exec) صالحاً أولاً لتوليد رابط الربط التلقائي.';
          return;
        }
        var wrap = document.getElementById('autoconnect-share-wrap');
        var shareInput = document.getElementById('autoconnect-share-url');
        if (wrap && shareInput) {
          shareInput.value = shareUrl;
          wrap.classList.remove('hidden');
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareUrl);
          } else if (shareInput) {
            shareInput.select();
            document.execCommand('copy');
          }
          ctx.toast('تم نسخ رابط الربط التلقائي! أي موظف يفتحه يتصل بالخادم مباشرة.');
        } catch (e) {
          ctx.toast('تم توليد رابط الربط التلقائي — انسخه من الحقل أسفله.');
        }
      });
    }

    var pingGasBtn = document.getElementById('btn-ping-gas-url');
    if (pingGasBtn) {
      pingGasBtn.addEventListener('click', function () {
        var inp = document.getElementById('set-gas-url');
        var val = inp ? inp.value.trim() : '';
        var out = document.getElementById('gas-ping-result');
        if (!val) {
          out.className = 'form-error';
          out.textContent = 'يرجى إدخال رابط Web App (/exec) أولاً.';
          return;
        }
        if (root.RGCrmCore && root.RGCrmCore.validateGasUrl) {
          var vCheck = root.RGCrmCore.validateGasUrl(val);
          if (vCheck.valid && vCheck.normalized && inp && vCheck.normalized !== val) {
            val = vCheck.normalized;
            inp.value = val;
          }
        }
        runWithLock(pingGasBtn, 'pingGasUrl', async function () {
          var prevText = pingGasBtn.textContent;
          pingGasBtn.textContent = 'جاري الفحص...';
          out.className = 'glass-subcard';
          out.style.padding = '10px 12px';
          out.textContent = 'جاري فحص الاتصال برابط Google Apps Script...';
          try {
            var res = await root.RGApi.pingGasUrl(val);
            out.style.padding = '';
            out.className = res.success ? 'form-success' : 'form-error';
            out.textContent = res.message || (res.success ? 'الاتصال ناجح!' : 'فشل الاتصال.');
          } finally {
            if (pingGasBtn.isConnected !== false) pingGasBtn.textContent = prevText;
          }
        });
      });
    }

    var saveRgTokenBtn = document.getElementById('btn-save-rg-token');
    if (saveRgTokenBtn) {
      saveRgTokenBtn.addEventListener('click', function () {
        var inp = document.getElementById('set-rg-token');
        var msg = document.getElementById('sync-action-msg');
        var raw = inp ? inp.value.trim() : '';
        if (!raw) {
          msg.className = 'form-error';
          msg.textContent = 'يرجى لصق التوكن أولاً ثم الضغط على حفظ.';
          return;
        }
        runWithLock(saveRgTokenBtn, 'saveApiToken', async function () {
          var prevText = saveRgTokenBtn.textContent;
          saveRgTokenBtn.textContent = 'جاري الحفظ...';
          try {
            var res = await root.RGApi.callApi('saveApiToken', {
              token: raw,
              testAfterSave: isBackendConnected || root.RGApi.isLiveMode(),
              siteOrigin: window.location.origin
            });
            if (res.success) {
              if (inp) inp.value = '';
              var connOk = res.data && res.data.connection ? res.data.connection.connected : null;
              var connStatus = document.getElementById('sync-conn-status');
              if (connStatus) {
                connStatus.textContent = connOk === true
                  ? 'متصل بنجاح (RG_TOKEN محفوظ ومربوط)'
                  : 'تم حفظ RG_TOKEN وتحديث الربط';
              }
              msg.className = connOk === false ? 'form-error' : 'form-success';
              msg.textContent = (res.data && res.data.connection && res.data.connection.message) || res.message || 'تم حفظ التوكن بنجاح.';
              ctx.toast('تم حفظ التوكن بنجاح.');
            } else {
              msg.className = 'form-error';
              msg.textContent = res.message || 'تعذر حفظ التوكن.';
            }
          } finally {
            if (saveRgTokenBtn.isConnected !== false) saveRgTokenBtn.textContent = prevText;
          }
        });
      });
    }

    var testRgBtn = document.getElementById('btn-test-rg');
    if (testRgBtn) {
      testRgBtn.addEventListener('click', function () {
        var msg = document.getElementById('sync-action-msg');
        runWithLock(testRgBtn, 'testConnection', async function () {
          var res = await root.RGApi.callApi('testConnection', {});
          msg.className = (res.success && res.data && res.data.connected) ? 'form-success' : 'form-error';
          msg.textContent = (res.data && res.data.message) || res.message;
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
                ctx.toast('يرجى تحديد تاريخ البداية عند اختيار السحب من تاريخ معين.', true);
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

    var sysForm = document.getElementById('sys-settings-form');
    if (sysForm) {
      sysForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var hoursEl = document.getElementById('set-auto-sync-hours');
        var minutesEl = document.getElementById('set-auto-sync-minutes');
        var rawHours = Number(hoursEl && hoursEl.value !== '' ? hoursEl.value : 0);
        var rawMinutes = Number(minutesEl && minutesEl.value !== '' ? minutesEl.value : 0);
        var autoEnabled = document.getElementById('set-auto-sync-enabled').checked;

        if (autoEnabled && (!isFinite(rawHours) || rawHours <= 0) && (!isFinite(rawMinutes) || rawMinutes <= 0)) {
          ctx.toast('يرجى تحديد مدة لا تقل عن دقيقة واحدة للتحديث التلقائي.', true);
          if (minutesEl) minutesEl.focus();
          return;
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

        var submitBtn = document.getElementById('btn-save-sys-settings');
        runWithLock(submitBtn, 'updateSettings', async function () {
          var excluded = document.getElementById('set-excluded').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var res = await root.RGApi.callApi('updateSettings', {
            company_name: document.getElementById('set-company').value,
            session_ttl_hours: Number(document.getElementById('set-ttl').value || 24),
            excluded_statuses: excluded,
            allow_agent_view_all: document.getElementById('set-agent-all').checked,
            auto_sync_enabled: autoEnabled,
            auto_sync_interval_hours: normInterval.hours,
            auto_sync_interval_minutes: normInterval.minutes,
            ui_simplification: normUiSimp
          });
          if (res.success) {
            var appliedUi = (res.data && res.data.ui_simplification) ? res.data.ui_simplification : normUiSimp;
            if (ctx.applyUiSimplification) ctx.applyUiSimplification(appliedUi);
            else if (root.RGApp && root.RGApp.applyUiSimplification) root.RGApp.applyUiSimplification(appliedUi);
            ctx.toast('تم حفظ الإعدادات وتبسيط الواجهة وتحديث المزامنة التلقائية (' + (autoEnabled ? formatIntervalAr(normInterval.hours, normInterval.minutes) : 'متوقف') + ').');
            render(container, ctx);
          } else {
            ctx.toast(res.message, true);
          }
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
