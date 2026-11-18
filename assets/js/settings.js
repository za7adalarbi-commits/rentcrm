/**
 * RENTAL GATE CRM — System Settings, GAS /exec Connection & Rental Gate API Sync Center
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

  function queueStatusBadge(status) {
    if (status === 'synced') return '<span class="status-tag status-success">متزامن</span>';
    if (status === 'processing') return '<span class="status-tag status-info">جاري المعالجة</span>';
    if (status === 'failed') return '<span class="status-tag status-danger">فشل</span>';
    return '<span class="status-tag status-warning">قيد الانتظار</span>';
  }

  function buildQueueTableHtml(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return '<div class="empty-state" style="padding:18px;">لا توجد عمليات مسجلة في طابور المزامنة الفورية بعد.</div>';
    }
    return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>الكيان</th><th>المعرف</th><th>العملية</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>التوقيت</th>' +
      '</tr></thead><tbody>' +
      items.map(function (it) {
        var ts = it.syncedAt || it.updatedAt || it.createdAt || '';
        return '<tr>' +
          '<td>' + esc(it.entityType) + '</td>' +
          '<td class="mono">' + esc(it.recordId || it.entityId) + '</td>' +
          '<td><span class="status-tag status-neutral mono">' + esc(it.operation || it.action) + '</span></td>' +
          '<td>' + queueStatusBadge(it.status) + '</td>' +
          '<td class="mono tabular-nums">' + Number(it.retryCount || 0) + ' / ' + Number(it.maxRetries || 8) + '</td>' +
          '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(it.lastError || '') + '">' + esc(it.lastError || '-') + '</td>' +
          '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc(String(ts).replace('T', ' ').substring(0, 19)) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function runWithLock(btnEl, lockKey, fn) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn);
    }
    return Promise.resolve().then(fn);
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
      canSync ? root.RGApi.callApi('getSyncStatus', {}) : Promise.resolve({ success: true, data: { logs: [], lastSync: null } })
    ]);

    var settingsRes = results[0];
    var syncRes = results[1];
    var settings = (settingsRes.success && settingsRes.data) || {};
    var syncData = (syncRes.success && syncRes.data) || { logs: [], lastSync: null };
    var lastSync = syncData.lastSync;

    var autoSyncEnabled = settings.auto_sync_enabled !== undefined ? Boolean(settings.auto_sync_enabled) : (syncData.autoSyncEnabled !== false);
    var autoSyncHours = Number(settings.auto_sync_interval_hours || syncData.autoSyncIntervalHours || 12);

    var connInfo = root.RGApi.getConnectionInfo ? root.RGApi.getConnectionInfo() : { url: root.RGApi.getGasUrl(), source: '', defaultUrl: '' };
    var currentGasUrl = connInfo.url || '';
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
    var queueSummary = syncData.queue || { counts: { pending: 0, processing: 0, synced: 0, failed: 0, total: 0 }, items: [], gasConfigured: false };
    var qCounts = queueSummary.counts || { pending: 0, processing: 0, synced: 0, failed: 0, total: 0 };
    var rtStatus = (root.RGApi && root.RGApi.getRealtimeStatus) ? root.RGApi.getRealtimeStatus() : { connected: false, mode: 'idle' };

    container.innerHTML =
      (canSync ? (
        '<div class="surface-card" id="sync-queue-monitor-card">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">طابور المزامنة الفورية — Neon ↔ Google Sheets</h2>' +
              '<p class="section-subtitle">النمط: Transactional Outbox + بث فوري (SSE: <strong>' + (rtStatus.connected ? 'متصل' : esc(rtStatus.mode || 'احتياطي')) + '</strong>) + مزامنة دلتا احتياطية كل دقيقة</p>' +
            '</div>' +
            '<div class="toolbar-row" style="margin-bottom:0;flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-primary" id="btn-flush-queue">معالجة الطابور الآن</button>' +
              '<button type="button" class="btn btn-charcoal" id="btn-retry-queue">إعادة محاولة الفاشلة</button>' +
              '<button type="button" class="btn" id="btn-delta-backup">تشغيل المزامنة الاحتياطية (Delta)</button>' +
            '</div>' +
          '</div>' +
          '<div class="kpi-grid-4" style="margin-bottom:14px;">' +
            '<div class="kpi-card"><span class="kpi-label">قيد الانتظار (Pending)</span><span class="kpi-value tabular-nums" id="sq-cnt-pending">' + Number(qCounts.pending || 0) + '</span></div>' +
            '<div class="kpi-card"><span class="kpi-label">جاري المعالجة (Processing)</span><span class="kpi-value tabular-nums" id="sq-cnt-processing">' + Number(qCounts.processing || 0) + '</span></div>' +
            '<div class="kpi-card kpi-success"><span class="kpi-label">متزامن (Synced)</span><span class="kpi-value tabular-nums" id="sq-cnt-synced">' + Number(qCounts.synced || 0) + '</span></div>' +
            '<div class="kpi-card ' + (Number(qCounts.failed || 0) > 0 ? 'kpi-danger' : '') + '"><span class="kpi-label">فشل (Failed)</span><span class="kpi-value tabular-nums" id="sq-cnt-failed">' + Number(qCounts.failed || 0) + '</span></div>' +
          '</div>' +
          '<div id="sync-queue-msg" class="hidden" style="margin-bottom:10px;"></div>' +
          '<div id="sync-queue-table-wrap">' + buildQueueTableHtml(queueSummary.items || []) + '</div>' +
        '</div>'
      ) : '') +

      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">ربط Google Apps Script Web App (/exec)</h2>' +
          '<p class="section-subtitle">مخصص للمدير العام والمشرف فقط · الوضع الحالي: <strong>' + (root.RGApi.isLiveMode() ? 'متصل فعليًا بـ Google Apps Script & Google Sheets' : 'وضع المعاينة المحلية (Sandbox)') + '</strong> · المصدر: <strong>' + (sourceLabels[connInfo.source] || connInfo.source || 'تلقائي') + '</strong></p></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="set-gas-url">رابط Web App (/exec)</label>' +
            '<input class="input mono" id="set-gas-url" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="' + currentGasUrl + '">' +
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
              '<li><strong>الطريقة الدائمة للموقع بالكامل:</strong> أضف متغير المستودع <span class="mono" dir="ltr">VITE_GAS_WEBAPP_URL</span> في GitHub (<strong>Settings → Secrets and variables → Actions → Variables</strong>) أو ضع الرابط مرة واحدة داخل <span class="mono" dir="ltr">assets/js/config.js</span>.</li>' +
              '<li><strong>الطريقة الفورية لمشاركة الفريق:</strong> الصق رابط <span class="mono">/exec</span> أعلاه واضغط <strong>نسخ رابط الربط التلقائي للفريق</strong> وأرسله للموظفين؛ بمجرد فتح الرابط يُحفظ تلقائيًا لكل موظف.</li>' +
            '</ul>' +
          '</div>' +
          '<ol style="margin:8px 0 0;padding-inline-start:20px;font-size:12.5px;line-height:1.8;color:var(--text-secondary);">' +
            '<li>أنشئ مشروع Apps Script (أو من داخل Google Sheet عبر <strong>Extensions → Apps Script</strong>) وارفع ملفات مجلد <span class="mono">google-apps-script/</span> الـ 16 ملف <span class="mono">.gs</span> + <span class="mono">appsscript.json</span>.</li>' +
            '<li>من <strong>Project Settings → Script Properties</strong> أضف <span class="mono">RG_TOKEN</span> (رمز Rental Gate Bearer Token)، ويمكنك اختياريًا إضافة <span class="mono">SPREADSHEET_ID</span> (وإلا سيتم إنشاؤه تلقائيًا).</li>' +
            '<li>شغّل الدالة <span class="mono">setupRentalGateDatabase()</span> مرة واحدة ووافق على الصلاحيات لإنشاء التبويبات وحساب المدير (<span class="mono">admin / Admin@123</span>) وتفعيل السحب التلقائي كل 12 ساعة.</li>' +
            '<li>اضغط <strong>Deploy → New deployment → Web app</strong> (Execute as: <strong>Me</strong> · Who has access: <strong>Anyone</strong>) وانسخ رابط <span class="mono">/exec</span> والصقه أعلاه ثم اضغط «حفظ الرابط».</li>' +
            '<li>بعد تسجيل الدخول بالخادم الفعلي، افتح هذه الصفحة واضغط <strong>اختبار الاتصال</strong> ثم <strong>سحب الحجوزات الآن</strong> (أو زر «سحب الحجوزات» من صفحة الحجوزات).</li>' +
          '</ol>' +
        '</details>' +
      '</div>' +

      (canSync ? (
        '<div class="surface-card">' +
          '<div class="section-header">' +
            '<div><h2 class="section-title">مزامنة بيانات Rental Gate API</h2>' +
            '<p class="section-subtitle">يتم السحب حصريًا عبر Google Apps Script باستخدام RG_TOKEN المحفوظ في Script Properties · الكاش المحلي (IndexedDB): <strong class="tabular-nums">' + cacheStats.reservationsCount + '</strong> حجز · <strong class="tabular-nums">' + cacheStats.customersCount + '</strong> عميل</p></div>' +
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
            '<div class="detail-kv"><span class="detail-k">حالة الاتصال</span><span class="detail-v" id="sync-conn-status">' + (root.RGApi.isLiveMode() ? (settings.hasRgToken ? 'RG_TOKEN مضبوط في Apps Script' : 'تحقق من RG_TOKEN في Script Properties') : (settings.hasRgToken ? 'تم التحقق من صيغة التوكن (وضع المعاينة)' : 'وضع المعاينة المحلية')) + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">جدولة التحديث التلقائي</span><span class="detail-v" id="sync-auto-badge">' + (autoSyncEnabled ? ('مفعل — كل ' + autoSyncHours + ' ساعة') : 'متوقف حاليًا') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">آخر تاريخ سحب</span><span class="detail-v mono">' + (lastSync ? String(lastSync.finishedAt).replace('T', ' ').substring(0, 19) : 'لم يتم السحب بعد') + '</span></div>' +
            '<div class="detail-kv"><span class="detail-k">الحجوزات المستوردة / المحدثة / التمديدات</span><span class="detail-v tabular-nums">' + (lastSync ? (lastSync.importedCount + ' مستورد · ' + lastSync.updatedCount + ' محدث · ' + lastSync.extensionsCount + ' تمديد') : '0 / 0 / 0') + '</span></div>' +
          '</div>' +
          '<div style="margin-bottom:16px;padding:12px 14px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
            '<label class="form-label" for="set-rg-token">ربط / تحديث توكن Rental Gate (RG_TOKEN / RENTAL_TOKEN)</label>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">' +
              '<div class="password-field-wrap" style="flex:1;min-width:240px;">' +
                '<input type="password" class="input mono" id="set-rg-token" dir="ltr" autocomplete="off" spellcheck="false" placeholder="الصق Bearer Token هنا ليُحفظ في Script Properties (RG_TOKEN & RENTAL_TOKEN)">' +
                '<button type="button" class="password-toggle-btn" id="toggle-rg-token" aria-label="إظهار التوكن">إظهار</button>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" id="btn-save-rg-token">حفظ التوكن في Apps Script</button>' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">يُحفظ التوكن بأمان داخل Script Properties في Google Apps Script ولا يظهر للمتصفح أو في ملفات الموقع العامة.</div>' +
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
          '<div class="section-header"><div><h2 class="section-title">' + t('nav_settings') + ' العامة والتحديث التلقائي</h2><p class="section-subtitle">تُحفظ الإعدادات في تبويب Settings وتُحدّث مؤقت Apps Script تلقائيًا.</p></div></div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="set-company">اسم الشركة</label><input class="input" id="set-company" value="' + (settings.company_name || 'RENTAL GATE') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-ttl">مدة صلاحية الجلسة (ساعات)</label><input class="input tabular-nums" type="number" min="1" max="168" id="set-ttl" value="' + (settings.session_ttl_hours || 24) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="set-excluded">الحالات المستبعدة أثناء السحب (مفصولة بفاصلة)</label><input class="input mono" id="set-excluded" value="' + (Array.isArray(settings.excluded_statuses) ? settings.excluded_statuses.join(', ') : 'draft, test, abandoned') + '"></div>' +
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

    function applyQueueSummaryToDom(qData) {
      if (!qData) return;
      var c = qData.counts || {};
      var elP = document.getElementById('sq-cnt-pending');
      var elPr = document.getElementById('sq-cnt-processing');
      var elS = document.getElementById('sq-cnt-synced');
      var elF = document.getElementById('sq-cnt-failed');
      var tblWrap = document.getElementById('sync-queue-table-wrap');
      if (elP) elP.textContent = String(Number(c.pending || 0));
      if (elPr) elPr.textContent = String(Number(c.processing || 0));
      if (elS) elS.textContent = String(Number(c.synced || 0));
      if (elF) elF.textContent = String(Number(c.failed || 0));
      if (tblWrap && Array.isArray(qData.items)) {
        tblWrap.innerHTML = buildQueueTableHtml(qData.items);
      }
    }

    var flushQueueBtn = document.getElementById('btn-flush-queue');
    if (flushQueueBtn) {
      flushQueueBtn.addEventListener('click', function () {
        runWithLock(flushQueueBtn, 'processSyncQueue', async function () {
          var prevTxt = flushQueueBtn.textContent;
          flushQueueBtn.textContent = 'جاري المعالجة...';
          try {
            var res = await root.RGApi.callApi('processSyncQueue', {});
            var msgEl = document.getElementById('sync-queue-msg');
            if (res && res.success) {
              applyQueueSummaryToDom(res.data);
              var flushed = (res.data && res.data.flush) ? res.data.flush : {};
              if (msgEl) {
                msgEl.className = 'form-success';
                msgEl.textContent = flushed.skipped
                  ? 'تمت معالجة الوضع المحلي (GAS_WEBAPP_URL أو SYNC_API_SECRET غير مضبوط على الخادم).'
                  : ('اكتملت المعالجة: ' + Number(flushed.synced || 0) + ' متزامن · ' + Number(flushed.retried || 0) + ' إعادة جدولة · ' + Number(flushed.failed || 0) + ' فشل');
              }
              ctx.toast('تمت معالجة طابور المزامنة.');
            } else if (msgEl) {
              msgEl.className = 'form-error';
              msgEl.textContent = (res && res.message) || 'تعذر معالجة الطابور.';
            }
          } finally {
            if (flushQueueBtn.isConnected !== false) flushQueueBtn.textContent = prevTxt;
          }
        });
      });
    }

    var retryQueueBtn = document.getElementById('btn-retry-queue');
    if (retryQueueBtn) {
      retryQueueBtn.addEventListener('click', function () {
        runWithLock(retryQueueBtn, 'retryFailedSyncItems', async function () {
          var res = await root.RGApi.callApi('retryFailedSyncItems', {});
          var msgEl = document.getElementById('sync-queue-msg');
          if (res && res.success) {
            applyQueueSummaryToDom(res.data);
            if (msgEl) {
              msgEl.className = 'form-success';
              msgEl.textContent = 'تمت إعادة جدولة العمليات الفاشلة (' + Number((res.data && res.data.resetCount) || 0) + ') ومعالجتها.';
            }
            ctx.toast('تمت إعادة جدولة العمليات الفاشلة.');
          } else if (msgEl) {
            msgEl.className = 'form-error';
            msgEl.textContent = (res && res.message) || 'تعذر إعادة المحاولة.';
          }
        });
      });
    }

    var deltaBackupBtn = document.getElementById('btn-delta-backup');
    if (deltaBackupBtn) {
      deltaBackupBtn.addEventListener('click', function () {
        runWithLock(deltaBackupBtn, 'runBackupDeltaSync', async function () {
          var prevTxt = deltaBackupBtn.textContent;
          deltaBackupBtn.textContent = 'جاري فحص الدلتا...';
          try {
            var res = await root.RGApi.callApi('runBackupDeltaSync', { pullRentalGate: false });
            var msgEl = document.getElementById('sync-queue-msg');
            if (res && res.success) {
              applyQueueSummaryToDom((res.data && res.data.queue) || res.data);
              if (msgEl) {
                msgEl.className = 'form-success';
                msgEl.textContent = 'اكتملت المزامنة الاحتياطية بنظام الدلتا (التغييرات غير المتزامنة فقط).';
              }
              ctx.toast('تمت المزامنة الاحتياطية (Delta) بنجاح.');
            } else if (msgEl) {
              msgEl.className = 'form-error';
              msgEl.textContent = (res && res.message) || 'تعذر تشغيل المزامنة الاحتياطية.';
            }
          } finally {
            if (deltaBackupBtn.isConnected !== false) deltaBackupBtn.textContent = prevTxt;
          }
        });
      });
    }
  }

  if (typeof window !== 'undefined' && !root.__rgSettingsRealtimeBound) {
    root.__rgSettingsRealtimeBound = true;
    window.addEventListener('rg:realtime-event', function (e) {
      var ev = e && e.detail;
      if (!ev || ev.entityType !== 'SyncQueue') return;
      var card = document.getElementById('sync-queue-monitor-card');
      if (!card || !root.RGApi) return;
      root.RGApi.callApi('getSyncQueueStatus', { silentRefresh: true }).then(function (resp) {
        if (!resp || !resp.success || !resp.data) return;
        if (!document.getElementById('sync-queue-monitor-card')) return;
        var c = resp.data.counts || {};
        var elP = document.getElementById('sq-cnt-pending');
        var elPr = document.getElementById('sq-cnt-processing');
        var elS = document.getElementById('sq-cnt-synced');
        var elF = document.getElementById('sq-cnt-failed');
        var tblWrap = document.getElementById('sync-queue-table-wrap');
        if (elP) elP.textContent = String(Number(c.pending || 0));
        if (elPr) elPr.textContent = String(Number(c.processing || 0));
        if (elS) elS.textContent = String(Number(c.synced || 0));
        if (elF) elF.textContent = String(Number(c.failed || 0));
        if (tblWrap && Array.isArray(resp.data.items)) {
          tblWrap.innerHTML = buildQueueTableHtml(resp.data.items);
        }
      }).catch(function () {});
    });
  }

  root.RGSettings = {
    render: render
  };
})(window);
