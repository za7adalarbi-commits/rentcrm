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
    var autoSyncHours = Number(settings.auto_sync_interval_hours || syncData.autoSyncIntervalHours || 12);

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

    container.innerHTML =
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
            '<li>أنشئ مشروع Apps Script (أو من داخل Google Sheet عبر <strong>Extensions → Apps Script</strong>) وارفع ملفات مجلد <span class="mono">google-apps-script/</span> + <span class="mono">appsscript.json</span>.</li>' +
            '<li>انشر المشروع كـ <strong>Web App</strong> (Execute as: <strong>Me</strong> · Who has access: <strong>Anyone</strong>) وانسخ رابط <span class="mono">/exec</span>.</li>' +
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
                '<label class="gm-pull-date-field"><span>من تاريخ</span><input type="date" class="input" id="sync-pull-from" aria-label="من تاريخ للسحب"></label>' +
                '<label class="gm-pull-date-field"><span>إلى تاريخ</span><input type="date" class="input" id="sync-pull-to" aria-label="إلى تاريخ للسحب"></label>' +
              '</div>' +
            '</div>'
          ) : '') +
          '<div class="detail-summary-grid" style="margin-bottom:16px;">' +
            '<div class="detail-kv"><span class="detail-k">حالة الاتصال</span><span class="detail-v" id="sync-conn-status">' + (isBackendConnected || root.RGApi.isLiveMode() ? (hasRgToken ? 'RG_TOKEN محفوظ ومربوط تلقائيًا' : 'يرجى حفظ RG_TOKEN') : (settings.sandbox_has_rg_token ? 'تم التحقق من صيغة التوكن (وضع المعاينة)' : 'وضع المعاينة المحلية')) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + (autoSyncEnabled ? ('مفعل — كل ' + autoSyncHours + ' ساعة') : 'متوقف حاليًا') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono">' + (lastSync ? String(lastSync.finishedAt).replace('T', ' ').substring(0, 19) : 'لم يتم السحب بعد') + '</span></div>' +
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
                    '<td class="mono">' + String(l.finishedAt || '').replace('T', ' ').substring(0, 16) + '</td>' +
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
              '<div style="font-size:12px;color:var(--text-muted);">يعمل تلقائيًا كل 12 ساعة افتراضيًا عبر Trigger في Google Apps Script، ويمكنك تعديل الفترة هنا.</div></div>' +
              '<label class="checkbox-item" style="font-weight:700;"><input type="checkbox" id="set-auto-sync-enabled"' + (autoSyncEnabled ? ' checked' : '') + '> تفعيل التحديث التلقائي</label>' +
            '</div>' +
            '<div class="form-grid-2" style="align-items:end;">' +
              '<div class="form-group">' +
                '<label class="form-label" for="set-auto-sync-hours">فترة التحديث التلقائي (بالساعات)</label>' +
                '<input class="input tabular-nums" type="number" min="1" max="168" id="set-auto-sync-hours" value="' + autoSyncHours + '">' +
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

    bindPasswordToggle('setup-database-url', 'toggle-setup-db-url');
    bindPasswordToggle('setup-rg-token', 'toggle-setup-rg-token');
    bindPasswordToggle('setup-sync-secret', 'toggle-setup-sync-secret');
    bindPasswordToggle('setup-admin-password', 'toggle-setup-admin-password');
    bindPasswordToggle('set-rg-token', 'toggle-rg-token');

    var saveGasBtn = document.getElementById('btn-save-gas-url');
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
        ctx.toast('تم نسخ رابط الربط التلقائي! أي موظف يفتحه يتصل بالخادم مباشرة.');
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
