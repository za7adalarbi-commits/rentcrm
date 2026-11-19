/**
 * RENTAL GATE CRM — Unified Auto-Connect (Files + DB + GAS + Token), Connection & Sync Center
 */
(function (root) {
  'use strict';

  function esc(val) {
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function runWithLock(btnEl, lockKey, fn) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn);
    }
    return Promise.resolve().then(fn);
  }

  function renderCheckCard(title, item, okText, failText) {
    if (!item) return '';
    var ok = Boolean(item.connected || item.synced);
    var savedUnverified = Boolean(!ok && item.configured && item.verified === false);
    var statusLabel = ok ? okText : (savedUnverified ? 'تم الحفظ (دون فحص)' : (item.configured || item.attempted ? failText : 'غير مُعدّ'));
    var colorStyle = ok
      ? 'color:var(--status-success-text);'
      : (savedUnverified
          ? 'color:var(--status-info-text, var(--text-primary));'
          : (item.configured || item.attempted ? 'color:var(--status-danger-text);' : 'color:var(--text-muted);'));
    return '<div class="ac-check-item">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">' +
        '<strong>' + esc(title) + '</strong>' +
        '<span style="font-weight:700;font-size:11.5px;' + colorStyle + '">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<div style="color:var(--text-secondary);line-height:1.5;">' + esc(item.message || '-') + '</div>' +
    '</div>';
  }

  function renderAutoConnectResultHtml(data, wasLiveBefore, fallbackCfg) {
    if (!data && !fallbackCfg) return '';
    var files = (data && Array.isArray(data.updatedFiles)) ? data.updatedFiles : [];
    var checks = (data && data.checks) || {};
    var needRelogin = !wasLiveBefore && Boolean(
      (data && data.connectionConfig && (data.connectionConfig.backendApiUrl || data.connectionConfig.gasWebAppUrl)) ||
      (fallbackCfg && (fallbackCfg.gasWebAppUrl || fallbackCfg.backendApiUrl))
    );

    var html = '<div class="ac-result-panel">';
    if (files.length > 0) {
      html += '<div class="ac-files-bar">' +
        '<strong>الملفات التي تم تعديلها تلقائيًا:</strong> ' +
        files.map(function (f) { return '<span class="ac-file-chip mono" dir="ltr">' + esc(f) + '</span>'; }).join(' ') +
      '</div>';
    } else if (fallbackCfg && fallbackCfg.configJsText) {
      html += '<div class="ac-files-bar">' +
        '<strong>استضافة ساكنة (بدون خادم Node محلي):</strong> تم الحفظ في المتصفح ومزامنة Apps Script. يمكنك نسخ ملف <span class="mono" dir="ltr">assets/js/config.js</span> أدناه لرفعه للمستودع:' +
      '</div>' +
      '<textarea class="input mono" dir="ltr" rows="6" readonly style="font-size:11.5px;">' + esc(fallbackCfg.configJsText) + '</textarea>';
    }

    if (checks.database || checks.gas || checks.rentalGate || checks.gasRemoteSync) {
      html += '<div class="ac-check-grid">' +
        renderCheckCard('قاعدة البيانات (PostgreSQL)', checks.database, 'متصل ومهيأ', 'تعذر الاتصال') +
        renderCheckCard('Google Apps Script (/exec)', checks.gas, 'متصل', 'غير متصل') +
        renderCheckCard('توكن Rental Gate API', checks.rentalGate, 'صالح ومتصل', 'غير مؤكد') +
        renderCheckCard('مزامنة خصائص Apps Script', checks.gasRemoteSync, 'تم التحديث', 'يتطلب جلسة GAS') +
      '</div>';
    }

    if (needRelogin) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--border-hairline);">' +
        '<span style="font-size:12.5px;color:var(--text-primary);font-weight:600;">تم تفعيل الربط التلقائي للخادم الحي بنجاح. يمكنك الانتقال الآن لتسجيل الدخول على النظام المربوط.</span>' +
        '<button type="button" class="btn btn-primary btn-sm" id="btn-ac-switch-live">تفعيل والانتقال لتسجيل الدخول</button>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var user = root.RGAuth.getUser();
    var canAccessApi = root.RGCrmCore.canAccessApi(user);
    var canSync = root.RGCrmCore.canUserPerform(user, 'sync_data');
    var canManageSettings = root.RGCrmCore.canUserPerform(user, 'manage_settings');

    if (!canAccessApi && !canManageSettings) {
      container.innerHTML =
        '<div class="surface-card">' +
          '<h2 class="section-title">صلاحية مقيدة</h2>' +
          '<p class="section-subtitle">إعدادات النظام وربط API والمزامنة مخصصة للمدير العام والمشرف فقط.</p>' +
        '</div>';
      return;
    }

    var results = await Promise.all([
      root.RGApi.callApi('getSettings', {}),
      canSync ? root.RGApi.callApi('getSyncStatus', {}) : Promise.resolve({ success: true, data: { logs: [], lastSync: null } }),
      (canManageSettings && root.RGApi.getAutoConnectFileStatus) ? root.RGApi.getAutoConnectFileStatus() : Promise.resolve({ supported: false, data: null })
    ]);

    var settingsRes = results[0];
    var syncRes = results[1];
    var acStatusWrap = results[2] || { supported: false, data: null };
    var acStatus = acStatusWrap.data || null;

    var settings = (settingsRes.success && settingsRes.data) || {};
    var syncData = (syncRes.success && syncRes.data) || { logs: [], lastSync: null };
    var lastSync = syncData.lastSync;

    var autoSyncEnabled = settings.auto_sync_enabled !== undefined ? Boolean(settings.auto_sync_enabled) : (syncData.autoSyncEnabled !== false);
    var autoSyncHours = Number(settings.auto_sync_interval_hours || syncData.autoSyncIntervalHours || 12);

    var connInfo = root.RGApi.getConnectionInfo ? root.RGApi.getConnectionInfo() : { url: root.RGApi.getGasUrl(), source: '', defaultUrl: '' };
    var currentGasUrl = connInfo.url || (acStatus && acStatus.gas && acStatus.gas.url) || '';
    var currentBackendUrl = (root.RGApi.getBackendApiUrl && root.RGApi.getBackendApiUrl()) || (acStatus && acStatus.backend && acStatus.backend.apiUrl) || '';

    var sourceLabels = {
      global_config: 'ربط تلقائي عام للجميع (config.js / VITE_GAS_WEBAPP_URL)',
      query_param: 'ربط تلقائي عبر الرابط المشارك',
      local_storage: 'محفوظ في هذا المتصفح',
      local_sandbox: 'وضع المعاينة المحلية (تجاوز مؤقت)',
      sandbox: 'وضع المعاينة المحلية (Sandbox)'
    };

    var isGeneralManager = Boolean(user && root.RGCrmCore && root.RGCrmCore.ROLES && user.role === root.RGCrmCore.ROLES.GENERAL_MANAGER);
    var pullPresets = (root.RGCrmCore && root.RGCrmCore.PULL_DURATION_PRESETS) || [];
    var cacheStats = (root.RGApi && root.RGApi.getLocalCacheStats) ? root.RGApi.getLocalCacheStats() : { reservationsCount: 0, customersCount: 0, detailsCount: 0 };

    var dbConnected = Boolean(acStatus && acStatus.database && acStatus.database.connected);
    var dbConfigured = Boolean(acStatus && acStatus.database && acStatus.database.configured);
    var dbStatusText = dbConnected
      ? ('متصل (' + (acStatus.database.host || 'PostgreSQL') + ')')
      : (dbConfigured ? ('مُعدّ · غير متصل (' + (acStatus.database.host || 'DB') + ')') : 'غير مضبوط (محلي / Sheets)');

    var gasStatusText = currentGasUrl ? 'مربوط تلقائيًا (/exec)' : 'غير مضبوط بعد';
    var tokenConfigured = Boolean((acStatus && acStatus.rentalGate && acStatus.rentalGate.configured) || settings.hasRgToken);
    var tokenStatusText = tokenConfigured
      ? ('مضبوط بأمان ' + ((acStatus && acStatus.rentalGate && acStatus.rentalGate.maskedToken) ? acStatus.rentalGate.maskedToken : ''))
      : 'غير مضبوط بعد';

    container.innerHTML =
      (canManageSettings ? (
        '<section class="surface-card" id="auto-connect-card">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">الربط التلقائي الشامل (تحديث ملفات المشروع والنظام)</h2>' +
              '<p class="section-subtitle">أدخل بيانات الربط مرة واحدة هنا ليقوم النظام تلقائيًا بتحديث ملفات <span class="mono" dir="ltr">.env</span> و<span class="mono" dir="ltr">assets/js/config.js</span> وخصائص Apps Script دون تعديل يدوي في الملفات.</p>' +
            '</div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn" id="btn-ac-refresh-status">فحص الحالة الحالية</button>' +
            '</div>' +
          '</div>' +

          '<div class="ac-status-strip">' +
            '<div class="ac-status-box ' + (dbConnected ? 'is-ok' : (dbConfigured ? 'is-warn' : '')) + '">' +
              '<span class="ac-status-label">1. قاعدة البيانات (PostgreSQL / Neon)</span>' +
              '<span class="ac-status-val" id="ac-stat-db">' + esc(dbStatusText) + '</span>' +
            '</div>' +
            '<div class="ac-status-box ' + (currentGasUrl ? 'is-ok' : '') + '">' +
              '<span class="ac-status-label">2. API Google Apps Script</span>' +
              '<span class="ac-status-val" id="ac-stat-gas">' + esc(gasStatusText) + '</span>' +
            '</div>' +
            '<div class="ac-status-box ' + (tokenConfigured ? 'is-ok' : '') + '">' +
              '<span class="ac-status-label">3. توكن Rental Gate (RG_TOKEN)</span>' +
              '<span class="ac-status-val" id="ac-stat-token">' + esc(tokenStatusText) + '</span>' +
            '</div>' +
          '</div>' +

          '<form id="auto-connect-form" novalidate>' +
            '<div class="form-grid-2">' +
              '<div class="form-group">' +
                '<label class="form-label" for="ac-db-url">رابط قاعدة البيانات (<span class="mono" dir="ltr">DATABASE_URL</span>)' +
                  (acStatus && acStatus.database && acStatus.database.maskedUrl ? ' <span class="mono" dir="ltr" style="font-size:11px;color:var(--text-muted);">(' + esc(acStatus.database.maskedUrl) + ')</span>' : '') +
                '</label>' +
                '<div class="password-field-wrap">' +
                  '<input type="password" class="input mono" id="ac-db-url" dir="ltr" lang="en" autocomplete="off" spellcheck="false" placeholder="postgresql://user:password@host/dbname?sslmode=require">' +
                  '<button type="button" class="password-toggle-btn" id="toggle-ac-db-url" aria-label="إظهار رابط قاعدة البيانات">إظهار</button>' +
                '</div>' +
                '<span style="font-size:11px;color:var(--text-muted);">يُحفظ سرّيًا في <span class="mono" dir="ltr">.env</span> فقط ولا يُكتب في ملفات المتصفح العامة. اتركه فارغًا للإبقاء على القيمة المحفوظة حاليًا.</span>' +
              '</div>' +

              '<div class="form-group">' +
                '<label class="form-label" for="ac-gas-url">رابط Google Apps Script API (<span class="mono" dir="ltr">/exec</span>)</label>' +
                '<input type="url" class="input mono" id="ac-gas-url" dir="ltr" lang="en" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(currentGasUrl) + '">' +
                '<span style="font-size:11px;color:var(--text-muted);">يُكتب تلقائيًا في <span class="mono" dir="ltr">assets/js/config.js</span> و<span class="mono" dir="ltr">.env</span> لربط جميع المستخدمين تلقائيًا.</span>' +
              '</div>' +

              '<div class="form-group">' +
                '<label class="form-label" for="ac-rg-token">توكن Rental Gate API (<span class="mono" dir="ltr">RG_TOKEN / RENTAL_TOKEN</span>)' +
                  (acStatus && acStatus.rentalGate && acStatus.rentalGate.maskedToken ? ' <span class="mono" dir="ltr" style="font-size:11px;color:var(--text-muted);">(' + esc(acStatus.rentalGate.maskedToken) + ')</span>' : '') +
                '</label>' +
                '<div class="password-field-wrap">' +
                  '<input type="password" class="input mono" id="ac-rg-token" dir="ltr" lang="en" autocomplete="off" spellcheck="false" placeholder="الصق Bearer Token هنا ليُحفظ في .env وApps Script">' +
                  '<button type="button" class="password-toggle-btn" id="toggle-ac-rg-token" aria-label="إظهار توكن Rental Gate">إظهار</button>' +
                '</div>' +
              '</div>' +

              '<div class="form-group">' +
                '<label class="form-label" for="ac-backend-url">مسار Backend API للموقع (<span class="mono" dir="ltr">backendApiUrl</span>)</label>' +
                '<input type="text" class="input mono" id="ac-backend-url" dir="ltr" lang="en" autocomplete="off" spellcheck="false" placeholder="/api/crm (يتفعّل تلقائيًا عند ربط PostgreSQL)" value="' + esc(currentBackendUrl) + '">' +
              '</div>' +
            '</div>' +

            '<details style="margin-top:12px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
              '<summary style="cursor:pointer;font-weight:700;font-size:12.5px;">خيارات متقدمة (معرف Google Sheet، مزامنة Neon السحابية، وخصائص التحقق)</summary>' +
              '<div class="form-grid-2" style="margin-top:10px;">' +
                '<div class="form-group">' +
                  '<label class="form-label" for="ac-sheet-id">معرف Google Sheet (<span class="mono" dir="ltr">SPREADSHEET_ID</span>) — اختياري</label>' +
                  '<input type="text" class="input mono" id="ac-sheet-id" dir="ltr" lang="en" placeholder="1BxiMVs0XRA5..." value="' + esc((acStatus && acStatus.sync && acStatus.sync.spreadsheetId) || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label class="form-label" for="ac-sync-secret">مفتاح المزامنة السحابية (<span class="mono" dir="ltr">SYNC_API_SECRET</span>) — اختياري</label>' +
                  '<div class="password-field-wrap">' +
                    '<input type="password" class="input mono" id="ac-sync-secret" dir="ltr" lang="en" autocomplete="off" placeholder="' + ((acStatus && acStatus.sync && acStatus.sync.hasSecret) ? 'مضبوط حاليًا — اتركه فارغًا للإبقاء عليه' : 'يُولّد تلقائيًا عند الحاجة') + '">' +
                    '<button type="button" class="password-toggle-btn" id="toggle-ac-sync-secret" aria-label="إظهار مفتاح المزامنة">إظهار</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;">' +
                '<label class="checkbox-item"><input type="checkbox" id="ac-verify-conn" checked> فحص الاتصال بقاعدة البيانات وApps Script وRental Gate بعد الحفظ</label>' +
                '<label class="checkbox-item"><input type="checkbox" id="ac-sync-gas-props" checked> دفع التوكن والإعدادات إلى Google Apps Script تلقائيًا (إن توفرت الجلسة)</label>' +
              '</div>' +
            '</details>' +

            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;">' +
              '<div class="toolbar-row" style="margin-bottom:0;flex-wrap:wrap;">' +
                '<button type="submit" class="btn btn-primary" id="btn-run-auto-connect">ربط تلقائي وتحديث الملفات الآن</button>' +
              '</div>' +
              '<span style="font-size:11.5px;color:var(--text-muted);">وضع الخادم: <strong>' + (acStatusWrap.supported && acStatus && acStatus.filesWritable ? 'خادم Node (تحديث مباشر للملفات)' : 'متصفح / استضافة ساكنة') + '</strong></span>' +
            '</div>' +
          '</form>' +

          '<div id="ac-error-msg" class="form-error hidden" style="margin-top:10px;" role="alert"></div>' +
          '<div id="ac-result-panel" class="hidden"></div>' +
        '</section>'
      ) : '') +

      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">ربط Google Apps Script Web App (/exec)</h2>' +
          '<p class="section-subtitle">مخصص للمدير العام والمشرف فقط · الوضع الحالي: <strong>' + (root.RGApi.isLiveMode() ? 'متصل فعليًا بالخادم' : 'وضع المعاينة المحلية (Sandbox)') + '</strong> · المصدر: <strong>' + (sourceLabels[connInfo.source] || connInfo.source || 'تلقائي') + '</strong></p></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="set-gas-url">رابط Web App (/exec)</label>' +
            '<input class="input mono" id="set-gas-url" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(currentGasUrl) + '">' +
          '</div>' +
          '<div class="form-group" style="justify-content:flex-end;">' +
            '<div class="toolbar-row" style="margin-bottom:0;flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-primary" id="btn-save-gas-url">حفظ الرابط</button>' +
              '<button type="button" class="btn" id="btn-ping-gas-url">فحص رابط Apps Script</button>' +
              '<button type="button" class="btn btn-charcoal" id="btn-copy-autoconnect-link">نسخ رابط الربط التلقائي للفريق</button>' +
              (connInfo.defaultUrl && (connInfo.source === 'local_storage' || connInfo.source === 'local_sandbox') ? '<button type="button" class="btn" id="btn-restore-global-gas">استعادة الربط التلقائي العام</button>' : '') +
              '<button type="button" class="btn btn-danger" id="btn-clear-gas-url">العودة لوضع المعاينة</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="gas-ping-result" class="hidden" style="margin-top:10px;"></div>' +
        '<div id="autoconnect-share-wrap" class="hidden" style="margin-top:10px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
          '<div style="font-size:12px;font-weight:700;margin-bottom:6px;">رابط الدخول المربوط تلقائيًا (أي موظف يفتحه يرتبط بالخادم فورًا دون إدخال أي رابط):</div>' +
          '<input type="text" class="input mono" id="autoconnect-share-url" dir="ltr" readonly style="font-size:12px;">' +
        '</div>' +
        '<details style="margin-top:12px;padding:10px 12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
          '<summary style="cursor:pointer;font-weight:700;font-size:13px;">الربط التلقائي للجميع + خطوات تجهيز Rental Gate API وGoogle Apps Script</summary>' +
          '<div style="margin:10px 0 8px;padding:8px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-hairline);font-size:12.5px;line-height:1.75;">' +
            '<strong>كيف يرتبط كل من يدخل الموقع تلقائيًا دون إعداد في صفحة تسجيل الدخول؟</strong>' +
            '<ul style="margin:6px 0 0;padding-inline-start:18px;">' +
              '<li><strong>الطريقة الفورية من داخل الموقع:</strong> استخدم بطاقة <strong>الربط التلقائي الشامل</strong> أعلاه لتعديل <span class="mono" dir="ltr">.env</span> و<span class="mono" dir="ltr">assets/js/config.js</span> بضغطة واحدة.</li>' +
              '<li><strong>المشاركة الفورية للفريق:</strong> الصق رابط <span class="mono">/exec</span> أعلاه واضغط <strong>نسخ رابط الربط التلقائي للفريق</strong> وأرسله للموظفين.</li>' +
            '</ul>' +
          '</div>' +
          '<ol style="margin:8px 0 0;padding-inline-start:20px;font-size:12.5px;line-height:1.8;color:var(--text-secondary);">' +
            '<li>أنشئ مشروع Apps Script (أو من داخل Google Sheet عبر <strong>Extensions → Apps Script</strong>) وارفع ملفات مجلد <span class="mono">google-apps-script/</span> + <span class="mono">appsscript.json</span>.</li>' +
            '<li>شغّل الدالة <span class="mono">setupRentalGateDatabase()</span> مرة واحدة ووافق على الصلاحيات لإنشاء التبويبات وحساب المدير (<span class="mono">admin / Admin@123</span>).</li>' +
            '<li>اضغط <strong>Deploy → New deployment → Web app</strong> (Execute as: <strong>Me</strong> · Who has access: <strong>Anyone</strong>) وانسخ رابط <span class="mono">/exec</span>.</li>' +
            '<li>ألصق الرابط والتوكن ورابط قاعدة البيانات في مركز <strong>الربط التلقائي الشامل</strong> أعلاه واضغط «ربط تلقائي وتحديث الملفات الآن».</li>' +
          '</ol>' +
        '</details>' +
      '</div>' +

      (canSync ? (
        '<div class="surface-card">' +
          '<div class="section-header">' +
            '<div><h2 class="section-title">مزامنة بيانات Rental Gate API</h2>' +
            '<p class="section-subtitle">يتم السحب باستخدام <span class="mono" dir="ltr">RG_TOKEN</span> · الكاش المحلي (IndexedDB): <strong class="tabular-nums">' + cacheStats.reservationsCount + '</strong> حجز · <strong class="tabular-nums">' + cacheStats.customersCount + '</strong> عميل</p></div>' +
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
                  return '<option value="' + p.key + '">' + esc(p.label) + '</option>';
                }).join('') +
              '</select>' +
              '<div class="gm-pull-dates hidden" id="sync-pull-custom-dates">' +
                '<label class="gm-pull-date-field"><span>من تاريخ</span><input type="date" class="input" id="sync-pull-from" aria-label="من تاريخ للسحب"></label>' +
                '<label class="gm-pull-date-field"><span>إلى تاريخ</span><input type="date" class="input" id="sync-pull-to" aria-label="إلى تاريخ للسحب"></label>' +
              '</div>' +
            '</div>'
          ) : '') +
          '<div class="detail-summary-grid" style="margin-bottom:16px;">' +
            '<div class="detail-kv"><span class="detail-k">حالة الاتصال</span><span class="detail-v" id="sync-conn-status">' + (root.RGApi.isLiveMode() ? (settings.hasRgToken ? 'RG_TOKEN مضبوط في الخادم' : 'تحقق من RG_TOKEN في الإعدادات') : (settings.hasRgToken ? 'تم التحقق من صيغة التوكن (وضع المعاينة)' : 'وضع المعاينة المحلية')) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + (autoSyncEnabled ? ('مفعل — كل ' + autoSyncHours + ' ساعة') : 'متوقف حاليًا') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono">' + (lastSync ? esc(String(lastSync.finishedAt).replace('T', ' ').substring(0, 19)) : 'لم يتم السحب بعد') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">الحجوزات المستوردة / المحدثة / التمديدات</span><span class="detail-v tabular-nums">' + (lastSync ? (lastSync.importedCount + ' مستورد · ' + lastSync.updatedCount + ' محدث · ' + lastSync.extensionsCount + ' تمديد') : '0 / 0 / 0') + '</span></div>' +
          '</div>' +
          '<div style="margin-bottom:16px;padding:12px 14px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<label class="form-label" for="set-rg-token">ربط / تحديث توكن Rental Gate سريعًا (RG_TOKEN / RENTAL_TOKEN)</label>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">' +
              '<div class="password-field-wrap" style="flex:1;min-width:240px;">' +
                '<input type="password" class="input mono" id="set-rg-token" dir="ltr" autocomplete="off" spellcheck="false" placeholder="الصق Bearer Token هنا ليُحفظ في الخادم وScript Properties">' +
                '<button type="button" class="password-toggle-btn" id="toggle-rg-token" aria-label="إظهار التوكن">إظهار</button>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" id="btn-save-rg-token">حفظ التوكن الآن</button>' +
            '</div>' +
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
                    '<td class="mono">' + esc(l.id) + '</td>' +
                    '<td>' + esc(l.triggeredByName) + '</td>' +
                    '<td><span class="status-tag ' + (l.status === 'success' ? 'status-success' : 'status-danger') + '">' + (l.status === 'success' ? 'ناجح' : 'فشل') + '</span></td>' +
                    '<td class="tabular-nums">' + l.importedCount + '</td>' +
                    '<td class="tabular-nums">' + l.updatedCount + '</td>' +
                    '<td class="tabular-nums">' + l.extensionsCount + '</td>' +
                    '<td class="tabular-nums">' + l.pagesFetched + '</td>' +
                    '<td>' + esc(l.errorMessage || '-') + '</td>' +
                    '<td class="mono">' + esc(String(l.finishedAt || '').replace('T', ' ').substring(0, 16)) + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody></table></div>') +
        '</div>'
      ) : '') +

      (canManageSettings ? (
        '<form class="surface-card" id="sys-settings-form">' +
          '<div class="section-header"><div><h2 class="section-title">' + t('nav_settings') + ' العامة والتحديث التلقائي</h2><p class="section-subtitle">تُحفظ الإعدادات في قاعدة البيانات وتُحدّث مؤقت المزامنة تلقائيًا.</p></div></div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="set-company">اسم الشركة</label><input class="input" id="set-company" value="' + esc(settings.company_name || 'RENTAL GATE') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-ttl">مدة صلاحية الجلسة (ساعات)</label><input class="input tabular-nums" type="number" min="1" max="168" id="set-ttl" value="' + esc(settings.session_ttl_hours || 24) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-excluded">الحالات المستبعدة أثناء السحب (مفصولة بفاصلة)</label><input class="input mono" id="set-excluded" value="' + esc(Array.isArray(settings.excluded_statuses) ? settings.excluded_statuses.join(', ') : 'draft, test, abandoned') + '"></div>' +
            '<div class="form-group" style="justify-content:center;"><label class="checkbox-item"><input type="checkbox" id="set-agent-all"' + (settings.allow_agent_view_all ? ' checked' : '') + '> السماح لموظف خدمة العملاء باستعراض جميع الحجوزات</label></div>' +
          '</div>' +

          '<div style="margin-top:16px;padding:14px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<div><strong style="font-size:14px;">إعدادات التحديث التلقائي من Rental Gate API</strong>' +
              '<div style="font-size:12px;color:var(--text-muted);">يعمل تلقائيًا كل 12 ساعة افتراضيًا، ويمكنك تعديل الفترة هنا.</div></div>' +
              '<label class="checkbox-item" style="font-weight:700;"><input type="checkbox" id="set-auto-sync-enabled"' + (autoSyncEnabled ? ' checked' : '') + '> تفعيل التحديث التلقائي</label>' +
            '</div>' +
            '<div class="form-grid-2" style="align-items:end;">' +
              '<div class="form-group">' +
                '<label class="form-label" for="set-auto-sync-hours">فترة التحديث التلقائي (بالساعات)</label>' +
                '<input class="input tabular-nums" type="number" min="1" max="168" id="set-auto-sync-hours" value="' + esc(autoSyncHours) + '">' +
              '</div>' +
              '<div class="form-group">' +
                '<span class="form-label">اختيارات سريعة</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm auto-sync-preset" data-hours="1">كل ساعة</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset" data-hours="4">كل 4 ساعات</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset" data-hours="6">كل 6 ساعات</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset" data-hours="12">كل 12 ساعة (الافتراضي)</button>' +
                  '<button type="button" class="btn btn-sm auto-sync-preset" data-hours="24">كل 24 ساعة</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="margin-top:14px;"><button type="submit" class="btn btn-primary" id="btn-save-sys-settings">حفظ الإعدادات وتحديث المزامنة التلقائية</button></div>' +
        '</form>'
      ) : '');

    // Unified Auto-Connect event handlers
    var acForm = document.getElementById('auto-connect-form');
    if (acForm) {
      var bindToggle = function (inpId, btnId) {
        var inp = document.getElementById(inpId);
        var btn = document.getElementById(btnId);
        if (inp && btn) {
          btn.addEventListener('click', function () {
            var nextType = inp.type === 'password' ? 'text' : 'password';
            inp.type = nextType;
            btn.textContent = nextType === 'text' ? 'إخفاء' : 'إظهار';
          });
        }
      };
      bindToggle('ac-db-url', 'toggle-ac-db-url');
      bindToggle('ac-rg-token', 'toggle-ac-rg-token');
      bindToggle('ac-sync-secret', 'toggle-ac-sync-secret');

      var acErrBoxLive = document.getElementById('ac-error-msg');
      acForm.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          if (acErrBoxLive && !acErrBoxLive.classList.contains('hidden')) {
            acErrBoxLive.classList.add('hidden');
            acErrBoxLive.textContent = '';
          }
        });
      });

      var acDbInput = document.getElementById('ac-db-url');
      var acBackendInput = document.getElementById('ac-backend-url');
      if (acDbInput && acBackendInput) {
        acDbInput.addEventListener('input', function () {
          if (acDbInput.value.trim() && !acBackendInput.value.trim()) {
            acBackendInput.value = '/api/crm';
          }
        });
      }

      var refreshAcStatusBtn = document.getElementById('btn-ac-refresh-status');
      if (refreshAcStatusBtn) {
        refreshAcStatusBtn.addEventListener('click', function () {
          runWithLock(refreshAcStatusBtn, 'refreshAutoConnectStatus', async function () {
            await render(container, ctx);
            ctx.toast('تم تحديث حالة الربط.');
          });
        });
      }

      acForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var submitBtn = document.getElementById('btn-run-auto-connect');
        var errBox = document.getElementById('ac-error-msg');
        var resPanel = document.getElementById('ac-result-panel');
        errBox.classList.add('hidden');
        errBox.textContent = '';

        var payload = {
          databaseUrl: (document.getElementById('ac-db-url').value || '').trim(),
          gasWebAppUrl: (document.getElementById('ac-gas-url').value || '').trim(),
          rgToken: (document.getElementById('ac-rg-token').value || '').trim(),
          backendApiUrl: (document.getElementById('ac-backend-url').value || '').trim(),
          spreadsheetId: (document.getElementById('ac-sheet-id').value || '').trim(),
          syncSecret: (document.getElementById('ac-sync-secret').value || '').trim(),
          verifyConnections: document.getElementById('ac-verify-conn').checked,
          syncGasProperties: document.getElementById('ac-sync-gas-props').checked
        };

        if (root.RGCrmCore && root.RGCrmCore.normalizeAutoConnectPayload) {
          var check = root.RGCrmCore.normalizeAutoConnectPayload(payload);
          if (!check.valid) {
            errBox.textContent = check.errors.join(' · ');
            errBox.classList.remove('hidden');
            return;
          }
          payload = Object.assign(payload, check.normalized);
        }

        var hadLiveModeBefore = root.RGApi.isLiveMode();
        if (!hadLiveModeBefore && root.RGApi.getGasUrl() && root.RGApi.getToken()) {
          payload.gasToken = root.RGApi.getToken();
        } else if (root.RGApi.getGasUrl() && !root.RGApi.getBackendApiUrl() && root.RGApi.getToken()) {
          payload.gasToken = root.RGApi.getToken();
        }

        runWithLock(submitBtn, 'runAutoConnect', async function () {
          var prevText = submitBtn.textContent;
          submitBtn.textContent = 'جاري تطبيق الربط وتحديث الملفات...';
          try {
            var res = root.RGApi.runAutoConnect
              ? await root.RGApi.runAutoConnect(payload)
              : { success: false, serverFilesSupported: false, message: 'غير مدعوم' };

            if (res.success && res.data) {
              document.getElementById('ac-db-url').value = '';
              document.getElementById('ac-rg-token').value = '';
              document.getElementById('ac-sync-secret').value = '';

              var gasBox = document.getElementById('set-gas-url');
              if (gasBox && res.data.connectionConfig) {
                gasBox.value = res.data.connectionConfig.gasWebAppUrl || '';
              }
              if (res.data.connectionConfig && document.getElementById('ac-backend-url')) {
                document.getElementById('ac-backend-url').value = res.data.connectionConfig.backendApiUrl || '';
              }

              var st = res.data.status || {};
              var setBoxState = function (valEl, text, stateClass) {
                if (!valEl) return;
                valEl.textContent = text;
                var box = valEl.closest('.ac-status-box');
                if (box) {
                  box.classList.remove('is-ok', 'is-warn');
                  if (stateClass) box.classList.add(stateClass);
                }
              };
              var elDb = document.getElementById('ac-stat-db');
              var elGas = document.getElementById('ac-stat-gas');
              var elTok = document.getElementById('ac-stat-token');
              if (st.database) {
                setBoxState(
                  elDb,
                  st.database.connected
                    ? ('متصل (' + (st.database.host || 'PostgreSQL') + ')')
                    : (st.database.configured ? ('مُعدّ (' + (st.database.host || 'DB') + ')') : 'غير مضبوط'),
                  st.database.connected ? 'is-ok' : (st.database.configured ? 'is-warn' : '')
                );
              }
              if (st.gas) {
                setBoxState(elGas, st.gas.url ? 'مربوط تلقائيًا (/exec)' : 'غير مضبوط بعد', st.gas.url ? 'is-ok' : '');
              }
              if (st.rentalGate) {
                setBoxState(
                  elTok,
                  st.rentalGate.configured
                    ? ('مضبوط بأمان ' + (st.rentalGate.maskedToken || ''))
                    : 'غير مضبوط بعد',
                  st.rentalGate.configured ? 'is-ok' : ''
                );
              }

              resPanel.innerHTML = renderAutoConnectResultHtml(res.data, hadLiveModeBefore, null);
              resPanel.classList.remove('hidden');
              var switchBtn = document.getElementById('btn-ac-switch-live');
              if (switchBtn) {
                switchBtn.addEventListener('click', function () {
                  root.RGApi.setToken('');
                  root.RGAuth.setUser(null);
                  ctx.onAuthChanged();
                });
              }
              ctx.toast('تم تحديث الملفات والربط التلقائي بنجاح.');
            } else if (!res.serverFilesSupported) {
              // Graceful static/cloud fallback: apply in-browser + push to GAS if currently live on GAS
              if (root.RGApi.applyRuntimeConnection) {
                root.RGApi.applyRuntimeConnection({
                  gasWebAppUrl: payload.gasWebAppUrl,
                  backendApiUrl: payload.backendApiUrl
                });
              }
              if (payload.gasWebAppUrl && payload.syncGasProperties && root.RGApi.getToken()) {
                await root.RGApi.callApi('applyAutoConnectConfig', {
                  rgToken: payload.rgToken,
                  spreadsheetId: payload.spreadsheetId,
                  syncSecret: payload.syncSecret
                }).catch(function () {});
              }
              var cfgSnippet = (root.RGCrmCore && root.RGCrmCore.buildClientConfigJsContent)
                ? root.RGCrmCore.buildClientConfigJsContent({
                    gasWebAppUrl: payload.gasWebAppUrl,
                    backendApiUrl: payload.backendApiUrl
                  })
                : '';
              resPanel.innerHTML = renderAutoConnectResultHtml(null, hadLiveModeBefore, {
                gasWebAppUrl: payload.gasWebAppUrl,
                backendApiUrl: payload.backendApiUrl,
                configJsText: cfgSnippet
              });
              resPanel.classList.remove('hidden');
              ctx.toast('تم تطبيق الإعدادات محليًا وتوليد ملف config.js الجاهز.');
            } else {
              errBox.textContent = res.message || 'تعذر تنفيذ الربط التلقائي.';
              errBox.classList.remove('hidden');
            }
          } finally {
            if (submitBtn.isConnected !== false) submitBtn.textContent = prevText;
          }
        });
      });
    }

    document.getElementById('btn-save-gas-url').addEventListener('click', function () {
      var val = document.getElementById('set-gas-url').value.trim();
      var out = document.getElementById('gas-ping-result');
      if (val && root.RGCrmCore && root.RGCrmCore.validateGasUrl) {
        var check = root.RGCrmCore.validateGasUrl(val);
        if (!check.valid) {
          out.className = 'form-error';
          out.textContent = check.message;
          return;
        }
        val = check.normalized;
      }
      root.RGApi.setGasUrl(val);
      root.RGApi.setToken('');
      ctx.toast(val ? 'تم حفظ رابط Google Apps Script. يرجى تسجيل الدخول على الخادم الفعلي.' : 'تم التبديل إلى وضع المعاينة المحلية.');
      root.RGAuth.logout().then(function () { ctx.onAuthChanged(); });
    });

    document.getElementById('btn-clear-gas-url').addEventListener('click', function () {
      root.RGApi.setGasUrl('');
      root.RGApi.setToken('');
      ctx.toast('تم التبديل إلى وضع المعاينة المحلية.');
      ctx.onAuthChanged();
    });

    var restoreGlobalBtn = document.getElementById('btn-restore-global-gas');
    if (restoreGlobalBtn) {
      restoreGlobalBtn.addEventListener('click', function () {
        root.RGApi.setGasUrl('__DEFAULT__');
        root.RGApi.setToken('');
        ctx.toast('تمت استعادة الربط التلقائي العام.');
        ctx.onAuthChanged();
      });
    }

    document.getElementById('btn-copy-autoconnect-link').addEventListener('click', async function () {
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
        ctx.toast('تم نسخ رابط الربط التلقائي! أي موظف يفتحه يرتبط بالخادم مباشرة.');
      } catch (e) {
        ctx.toast('تم توليد رابط الربط التلقائي — انسخه من الحقل أسفله.');
      }
    });

    var pingGasBtn = document.getElementById('btn-ping-gas-url');
    pingGasBtn.addEventListener('click', function () {
      var val = document.getElementById('set-gas-url').value.trim();
      var out = document.getElementById('gas-ping-result');
      if (!val) {
        out.className = 'form-error';
        out.textContent = 'يرجى إدخال رابط Web App (/exec) أولاً.';
        return;
      }
      runWithLock(pingGasBtn, 'pingGasUrl', async function () {
        var res = await root.RGApi.pingGasUrl(val);
        out.className = res.success ? 'form-success' : 'form-error';
        out.textContent = res.message || (res.success ? 'الاتصال ناجح!' : 'فشل الاتصال.');
      });
    });

    var rgTokenInput = document.getElementById('set-rg-token');
    var toggleRgTokenBtn = document.getElementById('toggle-rg-token');
    if (rgTokenInput && toggleRgTokenBtn) {
      toggleRgTokenBtn.addEventListener('click', function () {
        var nextType = rgTokenInput.type === 'password' ? 'text' : 'password';
        rgTokenInput.type = nextType;
        toggleRgTokenBtn.textContent = nextType === 'text' ? 'إخفاء' : 'إظهار';
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
            var res = await root.RGApi.callApi('saveApiToken', { token: raw, testAfterSave: root.RGApi.isLiveMode() });
            if (res.success) {
              if (inp) inp.value = '';
              var connOk = res.data && res.data.connection ? res.data.connection.connected : null;
              var connStatus = document.getElementById('sync-conn-status');
              if (connStatus) {
                connStatus.textContent = connOk === true
                  ? 'متصل بنجاح (RG_TOKEN & RENTAL_TOKEN محفوظان)'
                  : 'تم حفظ RG_TOKEN & RENTAL_TOKEN';
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
            if (spPreset === 'custom' && !spFrom && !spTo) {
              ctx.toast('يرجى تحديد تاريخ البداية عند اختيار السحب من تاريخ معين.', true);
              syncNowBtn.textContent = prevText;
              return;
            }
            syncPayload = {
              preset: spPreset,
              dateFrom: spPreset === 'custom' ? spFrom : '',
              dateTo: spPreset === 'custom' ? spTo : ''
            };
          }
          var res = await root.RGApi.callApi('syncRentalGate', syncPayload);
          if (res.success) {
            ctx.toast('اكتملت المزامنة بنجاح.');
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
        var inp = document.getElementById('set-auto-sync-hours');
        var chk = document.getElementById('set-auto-sync-enabled');
        if (inp) inp.value = btn.getAttribute('data-hours');
        if (chk) chk.checked = true;
        container.querySelectorAll('.auto-sync-preset').forEach(function (b) {
          b.classList.toggle('btn-primary', b === btn);
        });
      });
    });

    var sysForm = document.getElementById('sys-settings-form');
    if (sysForm) {
      sysForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var submitBtn = document.getElementById('btn-save-sys-settings');
        runWithLock(submitBtn, 'updateSettings', async function () {
          var excluded = document.getElementById('set-excluded').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var autoEnabled = document.getElementById('set-auto-sync-enabled').checked;
          var autoHours = Math.max(1, Math.min(168, Number(document.getElementById('set-auto-sync-hours').value || 12)));
          var res = await root.RGApi.callApi('updateSettings', {
            company_name: document.getElementById('set-company').value,
            session_ttl_hours: Number(document.getElementById('set-ttl').value || 24),
            excluded_statuses: excluded,
            allow_agent_view_all: document.getElementById('set-agent-all').checked,
            auto_sync_enabled: autoEnabled,
            auto_sync_interval_hours: autoHours
          });
          if (res.success) {
            ctx.toast('تم حفظ الإعدادات وتحديث جدول التحديث التلقائي (' + (autoEnabled ? ('كل ' + autoHours + ' ساعة') : 'متوقف') + ').');
            render(container, ctx);
          } else {
            ctx.toast(res.message, true);
          }
        });
      });
    }
  }

  root.RGSettings = {
    render: render
  };
})(window);
