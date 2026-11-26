/**
 * RENTAL GATE CRM — My Follow-Ups (with Self-Unclaim & Quick Status) & Team Follow-Ups Views
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

  function fmtMention(text, employees) {
    if (root.RGCrmMentions && root.RGCrmMentions.renderHighlightedText) {
      return root.RGCrmMentions.renderHighlightedText(text, employees, esc);
    }
    return esc(text);
  }

  function fmtTime(val, ctx) {
    if (!val) return '';
    if (ctx && typeof ctx.formatTime === 'function') return ctx.formatTime(val);
    if (root.RGApp && typeof root.RGApp.formatTime === 'function') return root.RGApp.formatTime(val);
    if (root.RGCrmCore && root.RGCrmCore.formatTimePreference) {
      var tf = (root.RGApp && root.RGApp.getTimeFormat) ? root.RGApp.getTimeFormat() : '24h';
      return root.RGCrmCore.formatTimePreference(val, tf, (ctx && ctx.lang) || 'ar');
    }
    return String(val);
  }

  function statusClass(status) {
    if (['مؤكد', 'مقبول', 'تم الحجز', 'تم التسليم', 'تم الاستلام', 'تم التسليم من قبل السائق', 'تم الإرجاع', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مدفوع بالمحفظة', 'معتمد إداريًا'].indexOf(status) !== -1) return 'status-success';
    if (['نشط الآن', 'قيد الانتظار', 'في الطريق', 'جديد', 'تم التمديد', 'تم التمديد تلقائيًا', 'تم تغيير الموقع', 'تم الإنشاء', 'ناشط', 'نشط', 'بدأ التنفيذ', 'قيد التنفيذ', 'جاهز للاستلام'].indexOf(status) !== -1) return 'status-info';
    if (['معلق', 'بانتظار الدفع', 'لم يتم الحجز'].indexOf(status) !== -1) return 'status-warning';
    if (['ملغي', 'تم الإلغاء', 'مرفوض', 'غير مدفوع'].indexOf(status) !== -1) return 'status-danger';
    return 'status-neutral';
  }

  async function renderMyFollowUps(container, ctx) {
    var t = ctx.t;
    var isEn = ctx.lang === 'en';
    var fuState = ctx.state.myFollowUps || { tab: 'assigned' };
    ctx.state.myFollowUps = fuState;
    if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();

    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps = Boolean(empState && empState.loaded && Array.isArray(empState.items) && empState.items.length > 0);
    var [res, empRes] = await Promise.all([
      root.RGApi.callApi('getMyFollowUps', { abortKey: 'fu:my' }),
      hasPreloadedEmps ? Promise.resolve({ success: true, data: { items: empState.items } }) : root.RGApi.callApi('getEmployees', {})
    ]);
    if (res && res.aborted) return;
    if (!res || !res.success) {
      container.innerHTML =
        '<div class="surface-card">' +
          '<div class="section-header"><div><h2 class="section-title">' + t('nav_my_followups') + '</h2></div></div>' +
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load My Follow-Ups' : 'تعذر تحميل متابعاتي') + '</div>' +
              '<div class="rg-error-banner-msg">' + esc((res && res.message) || 'تعذر تحميل البيانات.') + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="myfu-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
          '</div>' +
        '</div>';
      var myfuRetry = document.getElementById('myfu-retry-btn');
      if (myfuRetry) myfuRetry.addEventListener('click', function () { renderMyFollowUps(container, ctx); });
      return;
    }

    var core = root.RGCrmCore || {};
    var currentUser = root.RGAuth.getUser() || {};
    var currentEmpId = currentUser.id || '';
    var canEditAnyFollowUp = Boolean(core.canUserPerform && core.canUserPerform(currentUser, 'edit_any_followup'));
    var canViewMentionsTab = !core.canUserViewSubSection || core.canUserViewSubSection(currentUser, 'sub_view_myfu_mentions');
    var canViewFuHistory = !core.canUserViewSubSection || core.canUserViewSubSection(currentUser, 'sub_view_myfu_history');
    var canExportPdf = !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_pdf');
    var canExportExcel = !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_excel');
    if (!canViewMentionsTab && fuState.tab === 'mentions') {
      fuState.tab = 'assigned';
      if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
    }
    var employees = (empRes.success && empRes.data && empRes.data.items) || [];
    var assigned = [];
    var followUps = [];
    var mentionFollowUps = [];
    var maxPins = core.MAX_PINNED_CRITICAL_RESERVATIONS || 3;
    var pinnedIds = [];
    var assignedById = {};
    var pinnedReservations = [];
    var activeMyFuSeq = 0;

    function syncMyFuData(data) {
      var d = data || {};
      assigned = d.assignedReservations || [];
      followUps = d.followUps || [];
      mentionFollowUps = canViewMentionsTab
        ? (Array.isArray(d.mentionFollowUps)
          ? d.mentionFollowUps
          : (core.filterMentionFollowUps ? core.filterMentionFollowUps(followUps, currentUser, employees) : []))
        : [];
      pinnedIds = Array.isArray(d.pinnedCriticalIds) ? d.pinnedCriticalIds.slice(0, maxPins) : [];
      assignedById = {};
      assigned.forEach(function (r) {
        if (r && r.id) assignedById[r.id] = r;
      });
      pinnedReservations = pinnedIds.map(function (id) { return assignedById[id]; }).filter(Boolean);
    }

    syncMyFuData(res.data);

    function renderDirectCallBtn(r) {
      if (!r || typeof r !== 'object') return '';
      var phone = r.customerPhone;
      var href = core.formatDirectCallTelHref ? core.formatDirectCallTelHref(phone, '9') : '';
      if (!href) return '';
      var disp = core.formatDirectCallDisplayNumber ? core.formatDirectCallDisplayNumber(phone, '9') : href.replace(/^tel:/, '');
      return '<a class="btn btn-sm rg-tel-btn" href="' + esc(href) + '" title="' + esc(disp) + '"' +
        ' data-call-res-id="' + esc(r.id || '') + '"' +
        ' data-call-res-num="' + esc(r.reservationNumber || '') + '"' +
        ' data-call-customer="' + esc(r.customerName || '') + '"' +
        ' data-call-phone="' + esc(phone || '') + '"' +
        ' data-call-status="' + esc(r.internalStatus || '') + '">' +
        '<span aria-hidden="true">📞</span> ' + (isEn ? 'Call 9' : 'اتصال 9') +
      '</a>';
    }

    function renderSharedBadge(r) {
      if (!core.computeSharedAssignmentInfo) return '';
      var info = core.computeSharedAssignmentInfo(r.assignedEmployeeIds, r.assignedEmployeeNames, currentEmpId, ctx.lang);
      return '<span class="rg-shared-badge is-' + esc(info.status) + '" title="' + esc((r.assignedEmployeeNames || []).join('، ')) + '">' + esc(info.badge) + '</span>';
    }

    function renderPinnedStripHtml() {
      return '<div class="rg-pinned-critical-strip" id="myfu-pinned-strip">' +
        '<div class="rg-pinned-critical-head">' +
          '<div>' +
            '<strong>' + (isEn ? 'Pinned Critical Bookings' : 'الحجوزات الحرجة المثبتة أعلى القائمة') + '</strong>' +
            '<span class="rg-attempt-badge tabular-nums" style="margin-inline-start:8px;">' + pinnedReservations.length + ' / ' + maxPins + '</span>' +
          '</div>' +
          '<span style="font-size:12px;color:var(--text-muted);">' +
            (isEn ? 'Pin up to 3 urgent bookings for immediate follow-up' : 'يمكنك تثبيت حتى 3 حجوزات حرجة لسرعة الوصول والمتابعة') +
          '</span>' +
        '</div>' +
        (pinnedReservations.length === 0
          ? '<div class="empty-state" style="padding:12px;font-size:12.5px;">' + (isEn ? 'No pinned critical bookings yet — click the Pin button on any booking row below.' : 'لا توجد حجوزات حرجة مثبتة حاليًا — اضغط زر «تثبيت حرج» في أي صف أدناه.') + '</div>'
          : '<div class="rg-pinned-critical-grid">' + pinnedReservations.map(function (r) {
              var noAnsCount = Number(r.noAnswerCount || 0);
              return '<article class="rg-pinned-critical-card" data-res-id="' + esc(r.id) + '">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn-link-inline mono myfu-open" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber) + '</button>' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                    '<span class="status-tag ' + statusClass(r.internalStatus) + '">' + esc(r.internalStatus) + '</span>' +
                    '<button type="button" class="btn btn-sm rg-pin-btn is-pinned myfu-pin-toggle" data-id="' + esc(r.id) + '" title="' + (isEn ? 'Unpin' : 'إلغاء التثبيت') + '">📌 ' + (isEn ? 'Unpin' : 'إلغاء التثبيت') + '</button>' +
                  '</div>' +
                '</div>' +
                '<div style="font-weight:700;font-size:13.5px;">' + esc(r.customerName) + ' · <span class="mono cell-phone" dir="ltr" style="font-size:12px;">' + esc(r.customerPhone) + '</span></div>' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);">' +
                  '<span>' + esc(r.carName) + ' (' + esc(r.companyName) + ')</span>' +
                  renderSharedBadge(r) +
                '</div>' +
                '<div class="cell-clamp-2" style="font-size:12px;color:var(--text-secondary);">' + esc(r.lastUpdateText || '-') + '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto;">' +
                  '<button type="button" class="btn btn-sm btn-primary myfu-open" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                  renderDirectCallBtn(r) +
                  '<button type="button" class="btn btn-sm rg-no-answer-btn myfu-no-answer" data-id="' + esc(r.id) + '">' +
                    (isEn ? 'No Answer' : 'لم يرد') + ' <span class="rg-attempt-badge tabular-nums">' + noAnsCount + '</span>' +
                  '</button>' +
                '</div>' +
              '</article>';
            }).join('') + '</div>') +
      '</div>';
    }

    function renderAssignedTabHtml() {
      return renderPinnedStripHtml() +
        (assigned.length === 0
          ? '<div class="empty-state">لا توجد حجوزات مستلمة في قائمتك حاليًا — يمكنك استلام أي حجز من صفحة الحجوزات مباشرة.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>رقم الحجز</th><th>العميل والمشاركة</th><th>الجوال والاتصال</th><th>الشركة والسيارة</th><th>الحالة الداخلية</th><th>آخر تحديث</th><th>إجراءات</th>' +
            '</tr></thead><tbody>' +
              assigned.map(function (r) {
                var isPinned = pinnedIds.indexOf(r.id) !== -1;
                var noAnsCount = Number(r.noAnswerCount || 0);
                var atPinCap = !isPinned && pinnedIds.length >= maxPins;
                return '<tr data-myfu-row="' + esc(r.id) + '">' +
                  '<td class="mono" style="white-space:nowrap;">' +
                    '<div><strong dir="ltr">' + esc(r.reservationNumber) + '</strong></div>' +
                    (r.pinnedNote ? '<div class="cell-sub" style="color:var(--brand-primary);font-weight:700;">📌 ملاحظة مثبتة</div>' : '') +
                  '</td>' +
                  '<td>' +
                    '<div class="cell-primary">' + esc(r.customerName) + '</div>' +
                    '<div class="cell-badges">' + renderSharedBadge(r) + '</div>' +
                  '</td>' +
                  '<td class="mono">' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                      '<span class="cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span>' +
                      renderDirectCallBtn(r) +
                    '</div>' +
                  '</td>' +
                  '<td>' +
                    '<div class="cell-primary">' + esc(r.companyName) + '</div>' +
                    '<div class="cell-sub">' + esc(r.carName) + '</div>' +
                  '</td>' +
                  '<td>' +
                    ((core.isInactiveReservation && core.isInactiveReservation(r))
                      ? ('<span class="status-tag status-danger">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span>')
                      : ('<select class="quick-status-select myfu-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة ' + esc(r.reservationNumber) + '">' +
                          (core.getWorkflowStatusOptions ? core.getWorkflowStatusOptions(r.internalStatus) : (core.MANUAL_WORKFLOW_STATUS_OPTIONS || core.FOLLOWUP_STATUSES)).map(function (s) {
                            return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                          }).join('') +
                        '</select>')) +
                  '</td>' +
                  '<td class="myfu-last-update-cell"><div class="cell-clamp-2" title="' + esc(r.lastUpdateText || '') + '">' + esc(r.lastUpdateText || '-') + '</div></td>' +
                  '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn btn-sm btn-primary myfu-open" data-id="' + esc(r.id) + '">متابعة / تفاصيل</button>' +
                    '<button type="button" class="btn btn-sm rg-no-answer-btn myfu-no-answer" data-id="' + esc(r.id) + '" title="' + (isEn ? 'Log No Answer & increment counter' : 'تسجيل لم يرد ورفع العداد') + '">' +
                      (isEn ? 'No Answer' : 'لم يرد') + ' <span class="rg-attempt-badge tabular-nums">' + noAnsCount + '</span>' +
                    '</button>' +
                    '<button type="button" class="btn btn-sm rg-pin-btn myfu-pin-toggle' + (isPinned ? ' is-pinned' : '') + '" data-id="' + esc(r.id) + '"' + (atPinCap ? ' data-cap-reached="true"' : '') + '>' +
                      (isPinned ? ('📌 ' + (isEn ? 'Pinned' : 'مثبت')) : ('📌 ' + (isEn ? 'Pin' : 'تثبيت حرج'))) +
                    '</button>' +
                    '<button type="button" class="btn btn-sm btn-danger myfu-unclaim" data-id="' + esc(r.id) + '">إلغاء الاستلام</button>' +
                  '</div></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>');
    }

    function renderMentionsTabHtml() {
      if (mentionFollowUps.length === 0) {
        return '<div class="empty-state" id="myfu-mentions-empty">' +
          (isEn ? 'No follow-ups mentioning you via @mention yet.' : 'لا توجد متابعات تحتوي على إشارة @mention موجهة إليك حاليًا.') +
        '</div>';
      }
      return '<div class="timeline-list" id="myfu-mentions-list">' + mentionFollowUps.map(function (f) {
        var canDeleteThisFu = Boolean(canEditAnyFollowUp || (f.employeeId && f.employeeId === currentEmpId));
        return '<div class="timeline-item rg-mention-fu-item">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<button type="button" class="btn-link-inline mono myfu-open" data-id="' + esc(f.reservationId) + '"><span dir="ltr">' + esc(f.reservationNumber || f.reservationId) + '</span> — ' + esc(f.customerName || '-') + '</button>' +
              '<span class="status-tag status-info">@Mention</span>' +
              '<span style="font-size:12px;color:var(--text-muted);">' + (isEn ? 'By: ' : 'بواسطة: ') + '<strong>' + esc(f.employeeName || '-') + '</strong></span>' +
            '</div>' +
            '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
          '</div>' +
          '<div>' + fmtMention(f.action, employees) + '</div>' +
          (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + fmtMention(f.notes, employees) + '</div>' : '') +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<div class="meta-inline mono" style="white-space:nowrap;"><span>' + esc((core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + '</span><span>·</span><span dir="ltr">' + esc(fmtTime(f.followUpTime, ctx)) + '</span></div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
              (canDeleteThisFu ? '<button type="button" class="btn btn-sm btn-danger myfu-delete-fu" data-fu-id="' + esc(f.id) + '" data-res-id="' + esc(f.reservationId) + '" data-confirm="0" aria-label="' + (isEn ? 'Delete follow-up' : 'حذف المتابعة') + '">' + (isEn ? 'Delete' : 'حذف') + '</button>' : '') +
              '<button type="button" class="btn btn-sm btn-primary myfu-open" data-id="' + esc(f.reservationId) + '">' + (isEn ? 'Open Booking' : 'فتح الحجز') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function renderHistoryCardHtml() {
      if (fuState.tab === 'mentions' || !canViewFuHistory) return '';
      return '<div class="surface-card" id="myfu-history-card">' +
        '<div class="section-header"><h3 class="section-title">سجل متابعاتي السابقة</h3></div>' +
        (followUps.length === 0
          ? '<div class="empty-state">لم تقم بتسجيل أي متابعات بعد.</div>'
          : '<div class="timeline-list">' + followUps.map(function (f) {
              var canDeleteThisFu = Boolean(canEditAnyFollowUp || (f.employeeId && f.employeeId === currentEmpId));
              return '<div class="timeline-item">' +
                '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn-link-inline mono myfu-open" data-id="' + esc(f.reservationId) + '"><span dir="ltr">' + esc(f.reservationNumber) + '</span> — ' + esc(f.customerName) + '</button>' +
                  '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
                '</div>' +
                '<div>' + fmtMention(f.action, employees) + '</div>' +
                (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + fmtMention(f.notes, employees) + '</div>' : '') +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<div class="meta-inline mono" style="white-space:nowrap;"><span>' + esc((core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + '</span><span>·</span><span dir="ltr">' + esc(fmtTime(f.followUpTime, ctx)) + '</span></div>' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                    (canDeleteThisFu ? '<button type="button" class="btn btn-sm btn-danger myfu-delete-fu" data-fu-id="' + esc(f.id) + '" data-res-id="' + esc(f.reservationId) + '" data-confirm="0" aria-label="' + (isEn ? 'Delete follow-up' : 'حذف المتابعة') + '">' + (isEn ? 'Delete' : 'حذف') + '</button>' : '') +
                    '<button type="button" class="btn btn-sm myfu-open" data-id="' + esc(f.reservationId) + '">تفاصيل الحجز</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
            }).join('') + '</div>') +
      '</div>';
    }

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_my_followups') + '</h2><p class="section-subtitle" id="myfu-subtitle"></p></div>' +
          '<div class="toolbar-actions">' +
            ((root.RGExportMenu && (canExportPdf || canExportExcel))
              ? root.RGExportMenu.renderHtml({
                  wrapId: 'myfu-export-wrap',
                  btnId: 'myfu-export-btn',
                  small: true,
                  canPdf: canExportPdf,
                  canExcel: canExportExcel,
                  lang: ctx.lang
                })
              : (canExportPdf ? '<button type="button" class="btn btn-sm btn-charcoal" id="myfu-export-pdf">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' : '')) +
            '<button type="button" class="btn btn-sm' + (assigned.length > 0 ? '' : ' hidden') + '" id="myfu-ics-btn">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' +
            '<div class="segmented-control" id="myfu-tabs" role="tablist" aria-label="تبويبات متابعاتي">' +
              '<button type="button" class="segmented-btn' + (fuState.tab !== 'mentions' ? ' active' : '') + '" data-myfu-tab="assigned">' +
                (isEn ? 'My Bookings' : 'حجوزاتي المستلمة') + ' (<span class="tabular-nums" id="myfu-tab-count-assigned">' + assigned.length + '</span>)' +
              '</button>' +
              (canViewMentionsTab ? (
                '<button type="button" class="segmented-btn' + (fuState.tab === 'mentions' ? ' active' : '') + '" data-myfu-tab="mentions">' +
                  (isEn ? '@Mentions Received' : 'إشارات @Mention') + ' (<span class="tabular-nums" id="myfu-tab-count-mentions">' + mentionFollowUps.length + '</span>)' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="myfu-content-region"></div>' +
      '</div>' +
      '<div id="myfu-history-host"></div>';

    function runWithLock(btnEl, lockKey, fn, opts) {
      if (root.RGApp && root.RGApp.withActionLock) {
        return root.RGApp.withActionLock(btnEl, lockKey, fn, opts);
      }
      return Promise.resolve().then(fn);
    }

    function updateHeaderMeta() {
      var subEl = container.querySelector('#myfu-subtitle');
      if (subEl) {
        subEl.innerHTML = 'الحجوزات المستلمة والمسندة إليك (<strong class="tabular-nums">' + assigned.length + '</strong>)' +
          (canViewMentionsTab ? (' · إشارات @Mention الواردة (<strong class="tabular-nums">' + mentionFollowUps.length + '</strong>)') : '');
      }
      var icsEl = container.querySelector('#myfu-ics-btn');
      if (icsEl) icsEl.classList.toggle('hidden', assigned.length === 0);
      var cntAssigned = container.querySelector('#myfu-tab-count-assigned');
      if (cntAssigned) cntAssigned.textContent = String(assigned.length);
      var cntMentions = container.querySelector('#myfu-tab-count-mentions');
      if (cntMentions) cntMentions.textContent = String(mentionFollowUps.length);
      container.querySelectorAll('[data-myfu-tab]').forEach(function (tabBtn) {
        var isMent = tabBtn.getAttribute('data-myfu-tab') === 'mentions';
        tabBtn.classList.toggle('active', isMent ? fuState.tab === 'mentions' : fuState.tab !== 'mentions');
      });
    }

    function paintMyFollowUpsContent() {
      updateHeaderMeta();
      pinnedReservations = pinnedIds.map(function (id) { return assignedById[id]; }).filter(Boolean);
      var contentRegion = container.querySelector('#myfu-content-region');
      if (contentRegion) {
        contentRegion.innerHTML = (fuState.tab === 'mentions' && canViewMentionsTab)
          ? renderMentionsTabHtml()
          : renderAssignedTabHtml();
      }
      var histHost = container.querySelector('#myfu-history-host');
      if (histHost) {
        histHost.innerHTML = renderHistoryCardHtml();
      }
      bindDynamicContentEvents();
    }

    function bindDynamicContentEvents() {
      container.querySelectorAll('.myfu-pin-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          if (!rid) return;
          var isPinnedNow = pinnedIds.indexOf(rid) !== -1;
          if (!isPinnedNow && pinnedIds.length >= maxPins) {
            ctx.toast('الحد الأقصى للحجوزات الحرجة المثبتة هو ' + maxPins + ' حجوزات فقط — قم بإلغاء تثبيت حجز آخر أولاً.', true);
            return;
          }
          runWithLock(btn, 'togglePinnedCritical:' + rid, function () {
            var prevPinnedIds = pinnedIds.slice();
            if (isPinnedNow) {
              pinnedIds = pinnedIds.filter(function (id) { return id !== rid; });
            } else {
              pinnedIds = [rid].concat(pinnedIds).slice(0, maxPins);
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('togglePinnedCriticalReservation', { reservationId: rid, pin: !isPinnedNow }, currentUser);
            }
            btn.setAttribute('data-pinned', !isPinnedNow ? '1' : '0');
            btn.classList.toggle('is-pinned', !isPinnedNow);
            ctx.toast(!isPinnedNow ? 'تم تثبيت الحجز في قائمة الحالات الحرجة.' : 'تم إلغاء تثبيت الحجز الحرج.');
            paintMyFollowUpsContent();
            return root.RGApi.callApi('togglePinnedCriticalReservation', {
              reservationId: rid,
              pin: !isPinnedNow,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (!resp || !resp.success) {
                pinnedIds = prevPinnedIds;
                ctx.toast((resp && resp.message) || 'تعذر تحديث قائمة التثبيت.', true);
                paintMyFollowUpsContent();
              }
            }).catch(function () {
              pinnedIds = prevPinnedIds;
              ctx.toast('تعذر الاتصال بالخادم أثناء تحديث التثبيت.', true);
              paintMyFollowUpsContent();
            });
          }, { spamAction: 'togglePinnedCriticalReservation', spamSig: rid + ':' + (!isPinnedNow) });
        });
      });

      container.querySelectorAll('.myfu-no-answer').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          if (!rid) return;
          runWithLock(btn, 'recordNoAnswer:' + rid, function () {
            var targetRec = assignedById[rid] || null;
            var prevNa = targetRec ? Math.max(0, Number(targetRec.noAnswerCount || 0)) : 0;
            var prevLastTxt = targetRec ? (targetRec.lastUpdateText || '') : '';
            var nextCount = prevNa + 1;
            var nextActionTxt = (core && core.buildNoAnswerActionText)
              ? core.buildNoAnswerActionText(nextCount, 'ar')
              : ('محاولة اتصال — لم يرد (المحاولة #' + nextCount + ')');
            if (targetRec) {
              targetRec.noAnswerCount = nextCount;
              targetRec.lastUpdateText = nextActionTxt;
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('recordNoAnswerFollowUp', { reservationId: rid }, currentUser);
            }
            var rowEl = btn.closest('tr');
            if (rowEl) {
              var lastEl = rowEl.querySelector('.myfu-last-update-cell .cell-clamp-2');
              if (lastEl) lastEl.textContent = nextActionTxt;
              var badgeEl = rowEl.querySelector('.rg-attempt-badge');
              if (badgeEl) {
                badgeEl.textContent = String(nextCount);
              }
            }
            ctx.toast('تم تسجيل محاولة اتصال — لم يرد (المحاولة #' + nextCount + ')');
            return root.RGApi.callApi('recordNoAnswerFollowUp', {
              reservationId: rid,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                if (targetRec) {
                  targetRec.noAnswerCount = prevNa;
                  targetRec.lastUpdateText = prevLastTxt;
                }
                ctx.toast((resp && resp.message) || 'تعذر تسجيل محاولة الاتصال.', true);
                refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
              }
            }).catch(function () {
              if (targetRec) {
                targetRec.noAnswerCount = prevNa;
                targetRec.lastUpdateText = prevLastTxt;
              }
              ctx.toast('تعذر الاتصال بالخادم أثناء تسجيل المحاولة.', true);
              refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
            });
          }, { spamAction: 'recordNoAnswerFollowUp', spamSig: rid });
        });
      });

      container.querySelectorAll('.myfu-quick-status').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var rid = sel.getAttribute('data-id');
          var nextStatus = sel.value;
          var targetRes = assignedById[rid] || null;
          var prevStatus = (targetRes && targetRes.internalStatus) || '';
          var prevLastText = (targetRes && targetRes.lastUpdateText) || '-';
          var expectedUpdatedAt = (targetRes && (targetRes.updatedAt || targetRes.lastUpdatedAt)) || '';
          runWithLock(sel, 'quickUpdateReservationStatus:' + rid, function () {
            if (targetRes) {
              targetRes.internalStatus = nextStatus;
              targetRes.lastUpdateText = 'تحديث سريع للحالة إلى: ' + nextStatus;
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
                reservationId: rid,
                status: nextStatus
              }, currentUser);
            }
            ctx.toast('تم تحديث حالة الحجز إلى: ' + nextStatus);
            var rowEl = sel.closest('tr');
            var lastEl = rowEl ? rowEl.querySelector('.myfu-last-update-cell .cell-clamp-2') : null;
            if (lastEl) {
              lastEl.textContent = 'تحديث سريع للحالة إلى: ' + nextStatus;
            }
            return root.RGApi.callApi('quickUpdateReservationStatus', {
              reservationId: rid,
              status: nextStatus,
              expectedUpdatedAt: expectedUpdatedAt,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                if (targetRes) {
                  targetRes.internalStatus = prevStatus;
                  targetRes.lastUpdateText = prevLastText;
                }
                if (prevStatus) sel.value = prevStatus;
                if (lastEl) lastEl.textContent = prevLastText;
                ctx.toast((resp && resp.message) || 'تعذر تحديث الحالة.', true);
                refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
              }
            }).catch(function () {
              if (targetRes) {
                targetRes.internalStatus = prevStatus;
                targetRes.lastUpdateText = prevLastText;
              }
              if (prevStatus) sel.value = prevStatus;
              if (lastEl) lastEl.textContent = prevLastText;
              ctx.toast('تعذر الاتصال بالخادم أثناء تحديث الحالة.', true);
            });
          }, { spamAction: 'quickUpdateReservationStatus', spamSig: rid + ':' + nextStatus }).then(function (lockRes) {
            if (lockRes && lockRes.spamBlocked && prevStatus) {
              sel.value = prevStatus;
            }
          });
        });
      });

      container.querySelectorAll('.myfu-unclaim').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          runWithLock(btn, 'unclaimReservation:' + rid, function () {
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('unclaimReservation', { reservationId: rid }, currentUser);
            }
            assigned = assigned.filter(function (x) { return x && x.id !== rid; });
            delete assignedById[rid];
            pinnedIds = pinnedIds.filter(function (id) { return id !== rid; });
            var rowEl = btn.closest('tr');
            if (rowEl && rowEl.parentNode) {
              rowEl.parentNode.removeChild(rowEl);
            }
            var pinnedCard = container.querySelector('.rg-pinned-critical-card[data-res-id="' + rid + '"]');
            if (pinnedCard && pinnedCard.parentNode) {
              pinnedCard.parentNode.removeChild(pinnedCard);
            }
            updateHeaderMeta();
            ctx.toast('تم إلغاء استلام الحجز.');
            return root.RGApi.callApi('unclaimReservation', {
              reservationId: rid,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || 'تعذر إلغاء الاستلام.', true);
                refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
              }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء إلغاء الاستلام.', true);
              refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
            });
          }, { spamAction: 'unclaimReservation', spamSig: rid });
        });
      });

      container.querySelectorAll('.myfu-open').forEach(function (btn) {
        btn.addEventListener('click', function () {
          root.RGReservations.openReservationDrawer(btn.getAttribute('data-id'), ctx, employees, function () {
            refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
          });
        });
      });

      container.querySelectorAll('.myfu-delete-fu').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.getAttribute('data-confirm') !== '1') {
            btn.setAttribute('data-confirm', '1');
            btn.textContent = isEn ? 'Confirm?' : 'تأكيد الحذف؟';
            setTimeout(function () {
              if (document.body.contains(btn)) {
                btn.setAttribute('data-confirm', '0');
                btn.textContent = isEn ? 'Delete' : 'حذف';
              }
            }, 4000);
            return;
          }
          var fuId = btn.getAttribute('data-fu-id');
          var resId = btn.getAttribute('data-res-id') || '';
          if (!fuId) return;
          runWithLock(btn, 'deleteFollowUp:' + fuId, function () {
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('deleteFollowUp', { followUpId: fuId, reservationId: resId }, currentUser);
            }
            followUps = followUps.filter(function (x) { return x && x.id !== fuId; });
            mentionFollowUps = mentionFollowUps.filter(function (x) { return x && x.id !== fuId; });
            paintMyFollowUpsContent();
            ctx.toast(isEn ? 'Follow-up deleted.' : 'تم حذف المتابعة بنجاح.');
            return root.RGApi.callApi('deleteFollowUp', {
              followUpId: fuId,
              reservationId: resId,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || (isEn ? 'Failed to delete follow-up.' : 'تعذر حذف المتابعة.'), true);
                refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
              }
            }).catch(function () {
              ctx.toast(isEn ? 'Network error deleting follow-up.' : 'تعذر الاتصال بالخادم أثناء حذف المتابعة.', true);
              refreshMyFollowUpsData({ silentRefresh: true, forceRefresh: true });
            });
          }, { spamAction: 'deleteFollowUp', spamSig: 'deleteFollowUp:' + fuId });
        });
      });
    }

    async function refreshMyFollowUpsData(refreshOpts) {
      var rOpts = refreshOpts || {};
      var seq = ++activeMyFuSeq;
      if (rOpts.prefetchedData && !rOpts.forceRefresh) {
        syncMyFuData(rOpts.prefetchedData);
        paintMyFollowUpsContent();
        return;
      }
      var nextRes = await root.RGApi.callApi('getMyFollowUps', {
        forceRefresh: Boolean(rOpts.forceRefresh),
        silentRefresh: rOpts.silentRefresh !== false,
        abortKey: 'fu:my'
      });
      if (seq !== activeMyFuSeq || !container.isConnected) return;
      if (nextRes && nextRes.aborted) return;
      if (nextRes && nextRes.success && nextRes.data) {
        syncMyFuData(nextRes.data);
        paintMyFollowUpsContent();
      }
    }

    paintMyFollowUpsContent();

    container.querySelectorAll('[data-myfu-tab]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        var nextTab = tabBtn.getAttribute('data-myfu-tab') === 'mentions' ? 'mentions' : 'assigned';
        if (fuState.tab !== nextTab) {
          fuState.tab = nextTab;
          if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintMyFollowUpsContent();
        }
      });
    });

    function buildMyFuColsAndRows() {
      var myCols = [
        { key: 'reservationNumber', label: isEn ? 'Booking #' : 'رقم الحجز', formatType: 'ltr', widthWeight: 1.0 },
        { key: 'customerName', label: isEn ? 'Customer' : 'العميل', widthWeight: 1.3 },
        { key: 'customerPhone', label: isEn ? 'Phone' : 'الجوال', formatType: 'ltr', widthWeight: 1.05 },
        { key: 'carName', label: isEn ? 'Vehicle' : 'السيارة', widthWeight: 1.2 },
        { key: 'internalStatus', label: isEn ? 'Status' : 'الحالة', widthWeight: 0.95 },
        { key: 'noAnswerCount', label: isEn ? 'No Answer' : 'لم يرد', formatType: 'number', summable: true, widthWeight: 0.65 },
        { key: 'lastUpdateText', label: isEn ? 'Last Update' : 'آخر تحديث', widthWeight: 1.8 }
      ];
      var myRows = assigned.map(function (r) {
        return {
          reservationNumber: r.reservationNumber || '-',
          customerName: r.customerName || '-',
          customerPhone: r.customerPhone || '-',
          carName: r.carName || '-',
          internalStatus: r.internalStatus || r.originalStatusAr || '-',
          noAnswerCount: Number(r.noAnswerCount || 0),
          lastUpdateText: r.lastUpdateText || '-'
        };
      });
      return { myCols: myCols, myRows: myRows };
    }

    function triggerMyFuPdf() {
      if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
        ctx.toast(isEn ? 'PDF Studio is unavailable.' : 'وحدة تصدير PDF غير متاحة.', true);
        return;
      }
      var dataMy = buildMyFuColsAndRows();
      var pdfRows = dataMy.myRows.map(function (r) {
        return Object.assign({}, r, { noAnswerCount: String(r.noAnswerCount) });
      });
      var myNotes = followUps.filter(function (f) { return Boolean(f.notes || f.action); }).map(function (f) {
        var headerLine = (f.reservationNumber || '-') + ' — ' + (f.customerName || '-') + ' [' + (f.status || '-') + '] (' + (f.followUpDate || '-') + ' ' + fmtTime(f.followUpTime, ctx) + ')';
        return headerLine + '\n' + (f.action || '') + (f.notes ? ('\n' + f.notes) : '');
      });
      root.RGReports.openPdfStudio({
        ctx: ctx,
        title: isEn ? ('My Follow-Ups — ' + (currentUser.name || '')) : ('تقرير متابعاتي — ' + (currentUser.name || '')),
        filename: 'rental-gate-my-followups.pdf',
        scopeKey: 'my_followups',
        availableColumns: dataMy.myCols,
        columns: dataMy.myCols,
        rows: pdfRows,
        summaryItems: [
          { label: isEn ? 'My Assigned Bookings' : 'حجوزاتي المستلمة', value: String(assigned.length) },
          { label: isEn ? 'Pinned Critical' : 'الحجوزات المثبتة', value: String(pinnedReservations.length) },
          { label: isEn ? 'Follow-Up Log Entries' : 'سجلات المتابعة', value: String(followUps.length) }
        ],
        extraSections: myNotes.length ? [{
          title: isEn ? ('Follow-Up Actions & Notes (' + myNotes.length + ')') : ('تفاصيل وملاحظات المتابعات (' + myNotes.length + ')'),
          isNotes: true,
          lines: myNotes
        }] : [],
        initialSettings: { orientation: 'landscape', paperSize: 'a4' }
      });
    }

    async function triggerMyFuExcel() {
      if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') {
        ctx.toast(isEn ? 'Excel export module is unavailable.' : 'وحدة تصدير Excel غير متاحة.', true);
        return;
      }
      var dataMy = buildMyFuColsAndRows();
      var repTitle = isEn ? ('My Follow-Ups — ' + (currentUser.name || '')) : ('تقرير متابعاتي — ' + (currentUser.name || ''));
      var fuLogCols = [
        { key: 'reservationNumber', label: isEn ? 'Booking #' : 'رقم الحجز', formatType: 'ltr' },
        { key: 'customerName', label: isEn ? 'Customer' : 'العميل' },
        { key: 'status', label: isEn ? 'Status' : 'الحالة' },
        { key: 'action', label: isEn ? 'Action' : 'الإجراء' },
        { key: 'notes', label: isEn ? 'Notes' : 'الملاحظات' },
        { key: 'dateTimeText', label: isEn ? 'Date & Time' : 'التاريخ والوقت', formatType: 'ltr' }
      ];
      var fuLogRows = followUps.map(function (f) {
        var dStr = (core && core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-';
        return {
          reservationNumber: f.reservationNumber || '-',
          customerName: f.customerName || '-',
          status: f.status || '-',
          action: f.action || '-',
          notes: f.notes || '-',
          dateTimeText: dStr + (f.followUpTime ? (' ' + fmtTime(f.followUpTime, ctx)) : '')
        };
      });
      var sheets = [{
        name: isEn ? 'My Bookings' : 'حجوزاتي المستلمة',
        title: repTitle,
        summaryItems: [
          { label: isEn ? 'My Assigned Bookings' : 'حجوزاتي المستلمة', value: assigned.length },
          { label: isEn ? 'Pinned Critical' : 'الحجوزات المثبتة', value: pinnedReservations.length },
          { label: isEn ? 'Follow-Up Entries' : 'سجلات المتابعة', value: followUps.length }
        ],
        headers: dataMy.myCols,
        rows: dataMy.myRows
      }];
      if (fuLogRows.length || assigned.length === 0) {
        sheets.push({
          name: isEn ? 'Follow-Up Log' : 'سجل متابعاتي',
          title: isEn ? 'My Follow-Up Log & Notes' : 'سجل وملاحظات متابعاتي',
          headers: fuLogCols,
          rows: fuLogRows
        });
      }
      await root.RGReports.exportExcelWorkbook(sheets, 'rental-gate-my-followups.xlsx', {
        lang: ctx.lang,
        title: repTitle
      });
      ctx.toast(isEn ? 'My Follow-Ups exported to Excel.' : 'تم تصدير متابعاتي إلى ملف Excel بنجاح.');
    }

    var myFuExportWrap = document.getElementById('myfu-export-wrap');
    if (myFuExportWrap && root.RGExportMenu) {
      root.RGExportMenu.bind(myFuExportWrap, {
        onPdf: triggerMyFuPdf,
        onExcel: triggerMyFuExcel,
        onError: function (err) {
          ctx.toast((err && err.message) || (isEn ? 'Export failed.' : 'تعذر تنفيذ التصدير.'), true);
        }
      });
    }
    var myFuPdfBtn = document.getElementById('myfu-export-pdf');
    if (myFuPdfBtn) {
      myFuPdfBtn.addEventListener('click', triggerMyFuPdf);
    }

    var myFuIcsBtn = document.getElementById('myfu-ics-btn');
    if (myFuIcsBtn) {
      myFuIcsBtn.addEventListener('click', function () {
        if (!core.buildReservationIcsEvents || !core.buildIcsCalendarContent) return;
        var events = [];
        assigned.forEach(function (r) {
          events = events.concat(core.buildReservationIcsEvents(r, ctx.lang || 'ar'));
        });
        if (!events.length) {
          ctx.toast('لا توجد مواعيد متاحة للتصدير.', true);
          return;
        }
        var ics = core.buildIcsCalendarContent(events, 'Rental Gate My Follow-Ups');
        if (ctx.downloadIcsFile) {
          ctx.downloadIcsFile('my-followups-schedule.ics', ics);
        } else if (root.RGApp && root.RGApp.downloadIcsFile) {
          root.RGApp.downloadIcsFile('my-followups-schedule.ics', ics);
        }
        ctx.toast('تم تصدير جدول متابعاتك إلى تقويم .ics.');
      });
    }

    function scheduleMyFuRefreshWhenIdle(rOpts) {
      var activeEl = document.activeElement;
      if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
        if (!container._rgPendingMyFuDelta) {
          container._rgPendingMyFuDelta = true;
          container.addEventListener('focusout', function onBlurMyFuDelta() {
            setTimeout(function () {
              if (!container || !container.isConnected) return;
              var curAct = document.activeElement;
              if (curAct && container.contains(curAct) && /^(INPUT|TEXTAREA|SELECT)$/.test(curAct.tagName)) {
                container.addEventListener('focusout', onBlurMyFuDelta, { once: true });
                return;
              }
              container._rgPendingMyFuDelta = false;
              refreshMyFollowUpsData(rOpts || { silentRefresh: true, forceRefresh: true }).catch(function () {});
            }, 120);
          }, { once: true });
        }
        return Promise.resolve();
      }
      return refreshMyFollowUpsData(rOpts || { silentRefresh: true, forceRefresh: true });
    }

    container._rgRefreshDataOnly = function (refreshOpts) {
      var rOpts = refreshOpts || {};
      if (!rOpts.manual) {
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
          return scheduleMyFuRefreshWhenIdle({ silentRefresh: true, forceRefresh: true });
        }
      }
      return refreshMyFollowUpsData({
        silentRefresh: rOpts.silent !== false,
        forceRefresh: Boolean(rOpts.forceRefresh),
        prefetchedData: rOpts.prefetchedData
      });
    };

    if (!container._rgMyFuDeltaBound) {
      container._rgMyFuDeltaBound = true;
      var onMyFuDelta = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onMyFuDelta);
          return;
        }
        var d = (ev && ev.detail) || {};
        var relevant = Boolean(
          (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
          (Array.isArray(d.deletedFollowUpIds) && d.deletedFollowUpIds.length > 0) ||
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
          (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
          (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
          Boolean(d.deletedAllReservationsBefore) ||
          Boolean(d.changedSettings)
        );
        if (!relevant) return;
        scheduleMyFuRefreshWhenIdle({ silentRefresh: true, forceRefresh: true }).catch(function () {});
      };
      document.addEventListener('rg:deltasync', onMyFuDelta);
    }
  }

  async function renderTeamFollowUps(container, ctx) {
    var t = ctx.t;
    var isEn = ctx.lang === 'en';
    var core = root.RGCrmCore || {};
    var state = ctx.state.teamFollowUps || { employeeId: '', status: '', date: '' };
    ctx.state.teamFollowUps = state;
    if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();

    var empState2 = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps2 = Boolean(empState2 && empState2.loaded && Array.isArray(empState2.items) && empState2.items.length > 0);
    var [empRes, fuRes, empDetailRes] = await Promise.all([
      hasPreloadedEmps2 ? Promise.resolve({ success: true, data: { items: empState2.items } }) : root.RGApi.callApi('getEmployees', {}),
      root.RGApi.callApi('getTeamFollowUps', Object.assign({}, state, { abortKey: 'fu:team' })),
      state.employeeId ? root.RGApi.callApi('getEmployeeDetails', { employeeId: state.employeeId, abortKey: 'fu:empDet' }) : Promise.resolve(null)
    ]);
    if (fuRes && fuRes.aborted) return;
    var employees = (empRes.success && empRes.data && empRes.data.items) || [];
    var fuLoadErr = (!fuRes || !fuRes.success) ? ((fuRes && fuRes.message) || 'تعذر تحميل متابعات الفريق.') : '';
    var items = (fuRes && fuRes.success && fuRes.data && fuRes.data.items) || [];
    var empDetails = (empDetailRes && empDetailRes.success) ? empDetailRes.data : null;

    var currentUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var currentEmpIdTeam = (currentUser && currentUser.id) || '';
    var canEditAnyFollowUpTeam = Boolean(currentUser && core && core.canUserPerform && core.canUserPerform(currentUser, 'edit_any_followup'));
    var canReassign = Boolean(currentUser && core && core.canUserPerform && core.canUserPerform(currentUser, 'assign_employees'));
    var canExportPdfTeam = !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_pdf');
    var canExportExcelTeam = !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_excel');
    var activeTfuSeq = 0;

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_team_followups') + '</h2><p class="section-subtitle">سجل متابعات الفريق بالكامل — اضغط على أي حجز للاطلاع على كامل التفاصيل</p></div>' +
          '<div class="toolbar-actions">' +
            ((root.RGExportMenu && (canExportPdfTeam || canExportExcelTeam))
              ? root.RGExportMenu.renderHtml({
                  wrapId: 'tfu-export-wrap',
                  btnId: 'tfu-export-btn',
                  small: true,
                  canPdf: canExportPdfTeam,
                  canExcel: canExportExcelTeam,
                  lang: ctx.lang
                })
              : (canExportPdfTeam ? '<button type="button" class="btn btn-sm btn-charcoal" id="tfu-export-pdf">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' : '')) +
            (canReassign ? '<button type="button" class="btn btn-sm" id="tfu-bulk-reassign-btn">🔄 تحويل جماعي للوردية</button>' : '') +
            '<button type="button" class="btn btn-sm btn-primary' + (state.employeeId ? '' : ' hidden') + '" id="tfu-open-emp-profile">فتح ملف عملاء الموظف بالكامل</button>' +
          '</div>' +
        '</div>' +
        '<div class="filter-grid">' +
          '<select class="select" id="tfu-emp" aria-label="الموظف"><option value="">جميع الموظفين</option>' +
            employees.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.employeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') +
          '</select>' +
          '<select class="select" id="tfu-status" aria-label="الحالة"><option value="">جميع الحالات</option>' +
            (core.WORKFLOW_STATUS_OPTIONS || core.FOLLOWUP_STATUSES || []).map(function (s) { return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
          '</select>' +
          '<input type="date" class="input" id="tfu-date" value="' + esc(state.date || '') + '" aria-label="التاريخ">' +
          '<button type="button" class="btn btn-sm" id="tfu-reset">إعادة ضبط</button>' +
        '</div>' +
        '<div id="tfu-results-region"></div>' +
      '</div>';

    function paintTeamFollowUpsResults() {
      var empBtn = container.querySelector('#tfu-open-emp-profile');
      if (empBtn) {
        empBtn.classList.toggle('hidden', !state.employeeId);
      }
      var resultsRegion = container.querySelector('#tfu-results-region');
      if (!resultsRegion) return;

      resultsRegion.innerHTML =
        (empDetails ? (
          '<div style="margin-bottom:18px;">' +
            '<h3 style="margin:0 0 10px;font-size:14.5px;">عملاء وحجوزات ' + esc(empDetails.employee.name) + ' (' + empDetails.assignedReservations.length + ')</h3>' +
            (empDetails.assignedReservations.length === 0
              ? '<div class="empty-state" style="padding:16px;">لا توجد حجوزات مسندة لهذا الموظف.</div>'
              : '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">' +
                  empDetails.assignedReservations.map(function (r) {
                    var story = r.latestFollowUp ? (r.latestFollowUp.status + ': ' + r.latestFollowUp.action) : (r.lastUpdateText || 'بانتظار المتابعة');
                    return '<button type="button" class="interactive-res-card tfu-open-res" data-res-id="' + esc(r.id) + '">' +
                      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;">' +
                        '<strong class="mono" dir="ltr">' + esc(r.reservationNumber) + '</strong>' +
                        '<span class="status-tag ' + statusClass(r.internalStatus) + '">' + esc(r.internalStatus) + '</span>' +
                      '</div>' +
                      '<div style="font-weight:600;">' + esc(r.customerName) + ' <span class="mono cell-phone" dir="ltr" style="font-size:12px;color:var(--text-muted);">(' + esc(r.customerPhone) + ')</span></div>' +
                      '<div class="res-story-box"><strong>ما حدث:</strong> ' + fmtMention(story, employees) + '</div>' +
                      '<div style="font-size:12px;color:var(--brand-primary);font-weight:700;">عرض تفاصيل الحجز ←</div>' +
                    '</button>';
                  }).join('') +
                '</div>') +
          '</div>'
        ) : '') +
        (fuLoadErr
          ? '<div class="rg-error-banner" role="alert"><div class="rg-error-banner-body"><div class="rg-error-banner-title">' + (isEn ? 'Failed to load follow-ups' : 'تعذر تحميل المتابعات') + '</div><div class="rg-error-banner-msg">' + esc(fuLoadErr) + '</div></div><button type="button" class="btn btn-sm btn-primary" id="tfu-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button></div>'
          : (items.length === 0
          ? '<div class="empty-state">لا توجد متابعات مطابقة.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>رقم الحجز</th><th>العميل</th><th>الموظف</th><th>الحالة</th><th>الإجراء</th><th>الملاحظات</th><th>التاريخ والوقت</th><th>تفاصيل الحجز</th>' +
            '</tr></thead><tbody>' +
              items.map(function (f) {
                var canDeleteTeamFu = Boolean(canEditAnyFollowUpTeam || (f.employeeId && f.employeeId === currentEmpIdTeam));
                return '<tr>' +
                  '<td class="mono"><button type="button" class="btn-link-inline tfu-open-res" dir="ltr" data-res-id="' + esc(f.reservationId) + '">' + esc(f.reservationNumber) + '</button></td>' +
                  '<td>' + esc(f.customerName) + '</td>' +
                  '<td><button type="button" class="btn-link-inline tfu-open-emp" data-emp-id="' + esc(f.employeeId) + '">' + esc(f.employeeName) + '</button></td>' +
                  '<td><span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span></td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(f.action || '') + '">' + fmtMention(f.action, employees) + '</div></td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(f.notes || '') + '">' + (f.notes ? fmtMention(f.notes, employees) : '-') + '</div></td>' +
                  '<td class="mono tabular-nums" dir="ltr" style="white-space:nowrap;">' + esc((core && core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + (f.followUpTime ? ' ' + esc(fmtTime(f.followUpTime, ctx)) : '') + '</td>' +
                  '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn btn-sm btn-primary tfu-open-res" data-res-id="' + esc(f.reservationId) + '">التفاصيل</button>' +
                    (canDeleteTeamFu ? '<button type="button" class="btn btn-sm btn-danger tfu-delete-fu" data-fu-id="' + esc(f.id) + '" data-res-id="' + esc(f.reservationId) + '" data-confirm="0" aria-label="' + (isEn ? 'Delete follow-up' : 'حذف المتابعة') + '">' + (isEn ? 'Delete' : 'حذف') + '</button>' : '') +
                  '</div></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>'));

      var tfuRetryBtn = resultsRegion.querySelector('#tfu-retry-btn');
      if (tfuRetryBtn) {
        tfuRetryBtn.addEventListener('click', function () {
          refreshTeamFollowUpsRegion({ forceRefresh: true });
        });
      }

      resultsRegion.querySelectorAll('.tfu-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          root.RGReservations.openReservationDrawer(btn.getAttribute('data-res-id'), ctx, employees, function () {
            refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
          });
        });
      });

      resultsRegion.querySelectorAll('.tfu-open-emp').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var eid = btn.getAttribute('data-emp-id');
          if (root.RGEmployees && root.RGEmployees.openEmployeeDetailsDrawer) {
            root.RGEmployees.openEmployeeDetailsDrawer(eid, ctx, employees, function () {
              refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
            });
          }
        });
      });

      resultsRegion.querySelectorAll('.tfu-delete-fu').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.getAttribute('data-confirm') !== '1') {
            btn.setAttribute('data-confirm', '1');
            btn.textContent = isEn ? 'Confirm?' : 'تأكيد الحذف؟';
            setTimeout(function () {
              if (document.body.contains(btn)) {
                btn.setAttribute('data-confirm', '0');
                btn.textContent = isEn ? 'Delete' : 'حذف';
              }
            }, 4000);
            return;
          }
          var fuId = btn.getAttribute('data-fu-id');
          var resId = btn.getAttribute('data-res-id') || '';
          if (!fuId) return;
          var execLock = function (fn) {
            if (root.RGApp && root.RGApp.withActionLock) {
              return root.RGApp.withActionLock(btn, 'deleteFollowUp:' + fuId, fn, { spamAction: 'deleteFollowUp', spamSig: 'deleteFollowUp:' + fuId });
            }
            return Promise.resolve().then(fn);
          };
          execLock(function () {
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('deleteFollowUp', { followUpId: fuId, reservationId: resId }, currentUser);
            }
            items = items.filter(function (x) { return x && x.id !== fuId; });
            paintTeamFollowUpsResults();
            ctx.toast(isEn ? 'Follow-up deleted.' : 'تم حذف المتابعة بنجاح.');
            return root.RGApi.callApi('deleteFollowUp', {
              followUpId: fuId,
              reservationId: resId,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || (isEn ? 'Failed to delete follow-up.' : 'تعذر حذف المتابعة.'), true);
                refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
              }
            }).catch(function () {
              ctx.toast(isEn ? 'Network error deleting follow-up.' : 'تعذر الاتصال بالخادم أثناء حذف المتابعة.', true);
              refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
            });
          });
        });
      });
    }

    async function refreshTeamFollowUpsRegion(refreshOpts) {
      var rOpts = refreshOpts || {};
      var seq = ++activeTfuSeq;
      var resultsRegion = container.querySelector('#tfu-results-region');
      if (resultsRegion && !rOpts.silentRefresh && items.length === 0) {
        resultsRegion.innerHTML = '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
      }

      if (rOpts.prefetchedData && Array.isArray(rOpts.prefetchedData.items) && !rOpts.forceRefresh) {
        var nextEmpDetail = state.employeeId
          ? await root.RGApi.callApi('getEmployeeDetails', { employeeId: state.employeeId, silentRefresh: true, abortKey: 'fu:empDet' })
          : null;
        if (seq !== activeTfuSeq || !container.isConnected) return;
        items = (core && core.filterTeamFollowUpsList)
          ? core.filterTeamFollowUpsList(rOpts.prefetchedData.items, state)
          : rOpts.prefetchedData.items;
        fuLoadErr = '';
        empDetails = (nextEmpDetail && nextEmpDetail.success) ? nextEmpDetail.data : null;
        paintTeamFollowUpsResults();
        return;
      }

      var [nextFuRes, nextEmpDetailRes] = await Promise.all([
        root.RGApi.callApi('getTeamFollowUps', Object.assign({}, state, {
          forceRefresh: Boolean(rOpts.forceRefresh),
          silentRefresh: Boolean(rOpts.silentRefresh),
          abortKey: 'fu:team'
        })),
        state.employeeId
          ? root.RGApi.callApi('getEmployeeDetails', {
              employeeId: state.employeeId,
              forceRefresh: Boolean(rOpts.forceRefresh),
              silentRefresh: Boolean(rOpts.silentRefresh),
              abortKey: 'fu:empDet'
            })
          : Promise.resolve(null)
      ]);
      if (seq !== activeTfuSeq || !container.isConnected) return;
      if (nextFuRes && nextFuRes.aborted) return;

      if (nextFuRes && nextFuRes.success && nextFuRes.data) {
        fuLoadErr = '';
        items = nextFuRes.data.items || [];
      } else if (!rOpts.silentRefresh || items.length === 0) {
        fuLoadErr = (nextFuRes && nextFuRes.message) || 'تعذر تحميل متابعات الفريق.';
      }
      empDetails = (nextEmpDetailRes && nextEmpDetailRes.success) ? nextEmpDetailRes.data : (state.employeeId ? empDetails : null);
      paintTeamFollowUpsResults();
    }

    paintTeamFollowUpsResults();

    ['tfu-emp', 'tfu-status', 'tfu-date'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        state.employeeId = document.getElementById('tfu-emp').value;
        state.status = document.getElementById('tfu-status').value;
        state.date = document.getElementById('tfu-date').value;
        if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
        refreshTeamFollowUpsRegion();
      });
    });

    document.getElementById('tfu-reset').addEventListener('click', function () {
      state.employeeId = '';
      state.status = '';
      state.date = '';
      document.getElementById('tfu-emp').value = '';
      document.getElementById('tfu-status').value = '';
      document.getElementById('tfu-date').value = '';
      if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
      refreshTeamFollowUpsRegion();
    });

    var openEmpBtn = document.getElementById('tfu-open-emp-profile');
    if (openEmpBtn && root.RGEmployees && root.RGEmployees.openEmployeeDetailsDrawer) {
      openEmpBtn.addEventListener('click', function () {
        root.RGEmployees.openEmployeeDetailsDrawer(state.employeeId, ctx, employees, function () {
          refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
        });
      });
    }

    function buildTeamFuPayload() {
      var tfuCols = [
        { key: 'reservationNumber', label: isEn ? 'Booking #' : 'رقم الحجز', formatType: 'ltr', widthWeight: 0.95 },
        { key: 'customerName', label: isEn ? 'Customer' : 'العميل', widthWeight: 1.2 },
        { key: 'employeeName', label: isEn ? 'Employee' : 'الموظف', widthWeight: 1.0 },
        { key: 'status', label: isEn ? 'Status' : 'الحالة', widthWeight: 0.9 },
        { key: 'action', label: isEn ? 'Action' : 'الإجراء', widthWeight: 1.5 },
        { key: 'notes', label: isEn ? 'Notes' : 'الملاحظات', widthWeight: 1.6 },
        { key: 'dateTimeText', label: isEn ? 'Date & Time' : 'التاريخ والوقت', formatType: 'ltr', widthWeight: 1.1 }
      ];
      var tfuRows = items.map(function (f) {
        var dStr = (core && core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-';
        return {
          reservationNumber: f.reservationNumber || '-',
          customerName: f.customerName || '-',
          employeeName: f.employeeName || '-',
          status: f.status || '-',
          action: f.action || '-',
          notes: f.notes || '-',
          dateTimeText: dStr + (f.followUpTime ? (' ' + fmtTime(f.followUpTime, ctx)) : '')
        };
      });
      var uniqueBookingsCount = Object.keys(items.reduce(function (m, x) { if (x.reservationId || x.reservationNumber) m[x.reservationId || x.reservationNumber] = 1; return m; }, {})).length;
      var notesRecordedCount = items.filter(function (f) { return Boolean(String(f.notes || '').trim()); }).length;
      var filterParts = [
        state.employeeId ? ((isEn ? 'Employee: ' : 'الموظف: ') + ((employees.find(function (e) { return e.id === state.employeeId; }) || {}).name || state.employeeId)) : '',
        state.status ? ((isEn ? 'Status: ' : 'الحالة: ') + state.status) : ''
      ].filter(Boolean).join(' · ');
      return {
        tfuCols: tfuCols,
        tfuRows: tfuRows,
        uniqueBookingsCount: uniqueBookingsCount,
        notesRecordedCount: notesRecordedCount,
        periodText: state.date || (isEn ? 'All Dates' : 'كافة التواريخ'),
        filtersText: filterParts
      };
    }

    function triggerTeamFuPdf() {
      if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
        ctx.toast(isEn ? 'PDF Studio is unavailable.' : 'وحدة تصدير PDF غير متاحة.', true);
        return;
      }
      var dataTfu = buildTeamFuPayload();
      var tfuNoteLines = items.filter(function (f) { return Boolean(String(f.notes || '').trim()); }).map(function (f) {
        return (f.reservationNumber || '-') + ' | ' + (f.employeeName || '-') + ' (' + (f.customerName || '-') + '):\n' + String(f.notes || '').trim();
      });
      root.RGReports.openPdfStudio({
        ctx: ctx,
        title: isEn ? 'Team Follow-Ups Report' : 'تقرير متابعات الفريق',
        filename: 'rental-gate-team-followups.pdf',
        scopeKey: 'team_followups',
        availableColumns: dataTfu.tfuCols,
        columns: dataTfu.tfuCols,
        rows: dataTfu.tfuRows,
        summaryItems: [
          { label: isEn ? 'Total Follow-Ups' : 'إجمالي المتابعات', value: String(items.length) },
          { label: isEn ? 'Unique Bookings' : 'الحجوزات المشمولة', value: String(dataTfu.uniqueBookingsCount) },
          { label: isEn ? 'Notes Recorded' : 'سجلات بملاحظات', value: String(dataTfu.notesRecordedCount) }
        ],
        extraSections: tfuNoteLines.length ? [{
          title: isEn ? ('Full Follow-Up Notes (' + tfuNoteLines.length + ')') : ('الملاحظات الكاملة للمتابعات (' + tfuNoteLines.length + ')'),
          isNotes: true,
          lines: tfuNoteLines
        }] : [],
        initialSettings: { orientation: 'landscape', paperSize: 'a4' }
      });
    }

    async function triggerTeamFuExcel() {
      if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') {
        ctx.toast(isEn ? 'Excel export module is unavailable.' : 'وحدة تصدير Excel غير متاحة.', true);
        return;
      }
      var dataTfu = buildTeamFuPayload();
      var repTitle = isEn ? 'Team Follow-Ups Report' : 'تقرير متابعات الفريق';
      await root.RGReports.exportExcelWorkbook([{
        name: isEn ? 'Team Follow-Ups' : 'متابعات الفريق',
        title: repTitle,
        periodText: dataTfu.periodText,
        filtersText: dataTfu.filtersText,
        summaryItems: [
          { label: isEn ? 'Total Follow-Ups' : 'إجمالي المتابعات', value: items.length },
          { label: isEn ? 'Unique Bookings' : 'الحجوزات المشمولة', value: dataTfu.uniqueBookingsCount },
          { label: isEn ? 'Notes Recorded' : 'سجلات بملاحظات', value: dataTfu.notesRecordedCount }
        ],
        headers: dataTfu.tfuCols,
        rows: dataTfu.tfuRows
      }], 'rental-gate-team-followups.xlsx', {
        lang: ctx.lang,
        title: repTitle,
        periodText: dataTfu.periodText,
        filtersText: dataTfu.filtersText
      });
      ctx.toast(isEn ? 'Team Follow-Ups exported to Excel.' : 'تم تصدير متابعات الفريق إلى ملف Excel بنجاح.');
    }

    var tfuExportWrap = document.getElementById('tfu-export-wrap');
    if (tfuExportWrap && root.RGExportMenu) {
      root.RGExportMenu.bind(tfuExportWrap, {
        onPdf: triggerTeamFuPdf,
        onExcel: triggerTeamFuExcel,
        onError: function (err) {
          ctx.toast((err && err.message) || (isEn ? 'Export failed.' : 'تعذر تنفيذ التصدير.'), true);
        }
      });
    }
    var tfuPdfBtn = document.getElementById('tfu-export-pdf');
    if (tfuPdfBtn) {
      tfuPdfBtn.addEventListener('click', triggerTeamFuPdf);
    }

    var tfuBulkBtn = document.getElementById('tfu-bulk-reassign-btn');
    if (tfuBulkBtn && root.RGEmployees && root.RGEmployees.openBulkReassignModal) {
      tfuBulkBtn.addEventListener('click', function () {
        root.RGEmployees.openBulkReassignModal(employees, ctx, function () {
          refreshTeamFollowUpsRegion({ silentRefresh: true, forceRefresh: true });
        }, state.employeeId);
      });
    }

    function scheduleTeamFuRefreshWhenIdle(rOpts) {
      var activeEl = document.activeElement;
      if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
        if (!container._rgPendingTeamFuDelta) {
          container._rgPendingTeamFuDelta = true;
          container.addEventListener('focusout', function onBlurTeamFuDelta() {
            setTimeout(function () {
              if (!container || !container.isConnected) return;
              var curAct = document.activeElement;
              if (curAct && container.contains(curAct) && /^(INPUT|TEXTAREA|SELECT)$/.test(curAct.tagName)) {
                container.addEventListener('focusout', onBlurTeamFuDelta, { once: true });
                return;
              }
              container._rgPendingTeamFuDelta = false;
              refreshTeamFollowUpsRegion(rOpts || { silentRefresh: true, forceRefresh: true }).catch(function () {});
            }, 120);
          }, { once: true });
        }
        return Promise.resolve();
      }
      return refreshTeamFollowUpsRegion(rOpts || { silentRefresh: true, forceRefresh: true });
    }

    container._rgRefreshDataOnly = function (refreshOpts) {
      var rOpts = refreshOpts || {};
      if (!rOpts.manual) {
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
          return scheduleTeamFuRefreshWhenIdle({ silentRefresh: true, forceRefresh: true });
        }
      }
      return refreshTeamFollowUpsRegion({
        silentRefresh: rOpts.silent !== false,
        forceRefresh: rOpts.forceRefresh !== false,
        prefetchedData: rOpts.prefetchedData
      });
    };

    if (!container._rgTeamFuDeltaBound) {
      container._rgTeamFuDeltaBound = true;
      var onTeamFuDelta = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onTeamFuDelta);
          return;
        }
        var d = (ev && ev.detail) || {};
        var relevant = Boolean(
          (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
          (Array.isArray(d.deletedFollowUpIds) && d.deletedFollowUpIds.length > 0) ||
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
          (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
          (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
          Boolean(d.deletedAllReservationsBefore) ||
          Boolean(d.changedSettings)
        );
        if (!relevant) return;
        if (
          core &&
          typeof core.reapplyFollowUpDeltaToFilteredList === 'function' &&
          ((Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
           (Array.isArray(d.deletedFollowUpIds) && d.deletedFollowUpIds.length > 0)) &&
          !d.deletedAllReservationsBefore
        ) {
          var fuDeltaArr = core.reapplyFollowUpDeltaToFilteredList(items, d.changedFollowUps, d.deletedReservationIds, state, d.deletedFollowUpIds);
          if (Array.isArray(fuDeltaArr)) {
            items = fuDeltaArr;
            fuLoadErr = '';
            paintTeamFollowUpsResults();
          }
        }
        scheduleTeamFuRefreshWhenIdle({ silentRefresh: true, forceRefresh: true }).catch(function () {});
      };
      document.addEventListener('rg:deltasync', onTeamFuDelta);
    }
  }

  root.RGFollowUps = {
    renderMyFollowUps: renderMyFollowUps,
    renderTeamFollowUps: renderTeamFollowUps
  };
})(window);
