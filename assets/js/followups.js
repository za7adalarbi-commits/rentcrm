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
    var canViewMentionsTab = !core.canUserViewSubSection || core.canUserViewSubSection(currentUser, 'sub_view_myfu_mentions');
    var canViewFuHistory = !core.canUserViewSubSection || core.canUserViewSubSection(currentUser, 'sub_view_myfu_history');
    if (!canViewMentionsTab && fuState.tab === 'mentions') {
      fuState.tab = 'assigned';
    }
    var employees = (empRes.success && empRes.data.items) || [];
    var assigned = res.data.assignedReservations || [];
    var followUps = res.data.followUps || [];
    var mentionFollowUps = canViewMentionsTab
      ? (Array.isArray(res.data.mentionFollowUps)
        ? res.data.mentionFollowUps
        : (core.filterMentionFollowUps ? core.filterMentionFollowUps(followUps, currentUser, employees) : []))
      : [];
    var maxPins = core.MAX_PINNED_CRITICAL_RESERVATIONS || 3;
    var pinnedIds = Array.isArray(res.data.pinnedCriticalIds) ? res.data.pinnedCriticalIds.slice(0, maxPins) : [];

    var assignedById = {};
    assigned.forEach(function (r) {
      if (r && r.id) assignedById[r.id] = r;
    });
    var pinnedReservations = pinnedIds.map(function (id) { return assignedById[id]; }).filter(Boolean);

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
                    '<select class="quick-status-select myfu-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة ' + esc(r.reservationNumber) + '">' +
                      (core.getWorkflowStatusOptions ? core.getWorkflowStatusOptions(r.internalStatus) : core.FOLLOWUP_STATUSES).map(function (s) {
                        return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                      }).join('') +
                    '</select>' +
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
            '<button type="button" class="btn btn-sm btn-primary myfu-open" data-id="' + esc(f.reservationId) + '">' + (isEn ? 'Open Booking' : 'فتح الحجز') + '</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_my_followups') + '</h2><p class="section-subtitle">الحجوزات المستلمة والمسندة إليك (<strong class="tabular-nums">' + assigned.length + '</strong>)' + (canViewMentionsTab ? (' · إشارات @Mention الواردة (<strong class="tabular-nums">' + mentionFollowUps.length + '</strong>)') : '') + '</p></div>' +
          '<div class="toolbar-actions">' +
            (assigned.length > 0 ? '<button type="button" class="btn btn-sm" id="myfu-ics-btn">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' : '') +
            '<div class="segmented-control" id="myfu-tabs" role="tablist" aria-label="تبويبات متابعاتي">' +
              '<button type="button" class="segmented-btn' + (fuState.tab !== 'mentions' ? ' active' : '') + '" data-myfu-tab="assigned">' +
                (isEn ? 'My Bookings' : 'حجوزاتي المستلمة') + ' (<span class="tabular-nums">' + assigned.length + '</span>)' +
              '</button>' +
              (canViewMentionsTab ? (
                '<button type="button" class="segmented-btn' + (fuState.tab === 'mentions' ? ' active' : '') + '" data-myfu-tab="mentions">' +
                  (isEn ? '@Mentions Received' : 'إشارات @Mention') + ' (<span class="tabular-nums">' + mentionFollowUps.length + '</span>)' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        ((fuState.tab === 'mentions' && canViewMentionsTab) ? renderMentionsTabHtml() : renderAssignedTabHtml()) +
      '</div>' +
      ((fuState.tab !== 'mentions' && canViewFuHistory) ? (
        '<div class="surface-card" id="myfu-history-card">' +
          '<div class="section-header"><h3 class="section-title">سجل متابعاتي السابقة</h3></div>' +
          (followUps.length === 0
            ? '<div class="empty-state">لم تقم بتسجيل أي متابعات بعد.</div>'
            : '<div class="timeline-list">' + followUps.map(function (f) {
                return '<div class="timeline-item">' +
                  '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn-link-inline mono myfu-open" data-id="' + esc(f.reservationId) + '"><span dir="ltr">' + esc(f.reservationNumber) + '</span> — ' + esc(f.customerName) + '</button>' +
                    '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
                  '</div>' +
                  '<div>' + fmtMention(f.action, employees) + '</div>' +
                  (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + fmtMention(f.notes, employees) + '</div>' : '') +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                    '<div class="meta-inline mono" style="white-space:nowrap;"><span>' + esc((core.formatDisplayDate ? core.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + '</span><span>·</span><span dir="ltr">' + esc(fmtTime(f.followUpTime, ctx)) + '</span></div>' +
                    '<button type="button" class="btn btn-sm myfu-open" data-id="' + esc(f.reservationId) + '">تفاصيل الحجز</button>' +
                  '</div>' +
                '</div>';
              }).join('') + '</div>') +
        '</div>'
      ) : '');

    function runWithLock(btnEl, lockKey, fn, opts) {
      if (root.RGApp && root.RGApp.withActionLock) {
        return root.RGApp.withActionLock(btnEl, lockKey, fn, opts);
      }
      return Promise.resolve().then(fn);
    }

    container.querySelectorAll('[data-myfu-tab]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        var nextTab = tabBtn.getAttribute('data-myfu-tab') === 'mentions' ? 'mentions' : 'assigned';
        if (fuState.tab !== nextTab) {
          fuState.tab = nextTab;
          renderMyFollowUps(container, ctx);
        }
      });
    });

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
          renderMyFollowUps(container, ctx);
          return root.RGApi.callApi('togglePinnedCriticalReservation', {
            reservationId: rid,
            pin: !isPinnedNow,
            _keepOptimisticCache: true,
            _spamChecked: true
          }).then(function (resp) {
            if (!resp || !resp.success) {
              pinnedIds = prevPinnedIds;
              ctx.toast((resp && resp.message) || 'تعذر تحديث قائمة التثبيت.', true);
              renderMyFollowUps(container, ctx);
            }
          }).catch(function () {
            pinnedIds = prevPinnedIds;
            ctx.toast('تعذر الاتصال بالخادم أثناء تحديث التثبيت.', true);
            renderMyFollowUps(container, ctx);
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
              renderMyFollowUps(container, ctx);
            }
          }).catch(function () {
            if (targetRec) {
              targetRec.noAnswerCount = prevNa;
              targetRec.lastUpdateText = prevLastTxt;
            }
            ctx.toast('تعذر الاتصال بالخادم أثناء تسجيل المحاولة.', true);
            renderMyFollowUps(container, ctx);
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
              renderMyFollowUps(container, ctx);
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
          var rowEl = btn.closest('tr');
          if (rowEl && rowEl.parentNode) {
            rowEl.parentNode.removeChild(rowEl);
          }
          var pinnedCard = container.querySelector('.rg-pinned-critical-card[data-res-id="' + rid + '"]');
          if (pinnedCard && pinnedCard.parentNode) {
            pinnedCard.parentNode.removeChild(pinnedCard);
          }
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
              renderMyFollowUps(container, ctx);
            }
          }).catch(function () {
            ctx.toast('تعذر الاتصال بالخادم أثناء إلغاء الاستلام.', true);
            renderMyFollowUps(container, ctx);
          });
        }, { spamAction: 'unclaimReservation', spamSig: rid });
      });
    });

    container.querySelectorAll('.myfu-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.RGReservations.openReservationDrawer(btn.getAttribute('data-id'), ctx, employees, function () {
          renderMyFollowUps(container, ctx);
        });
      });
    });
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
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0)
        );
        if (!relevant) return;
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) return;
        renderMyFollowUps(container, ctx);
      };
      document.addEventListener('rg:deltasync', onMyFuDelta);
    }
  }

  async function renderTeamFollowUps(container, ctx) {
    var t = ctx.t;
    var isEn = ctx.lang === 'en';
    var state = ctx.state.teamFollowUps || { employeeId: '', status: '', date: '' };
    ctx.state.teamFollowUps = state;

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
    var canReassign = Boolean(currentUser && root.RGCrmCore && root.RGCrmCore.canUserPerform(currentUser, 'assign_employees'));

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_team_followups') + '</h2><p class="section-subtitle">سجل متابعات الفريق بالكامل — اضغط على أي حجز للاطلاع على كامل التفاصيل</p></div>' +
          '<div class="toolbar-actions">' +
            (canReassign ? '<button type="button" class="btn btn-sm" id="tfu-bulk-reassign-btn">🔄 تحويل جماعي للوردية</button>' : '') +
            (state.employeeId ? '<button type="button" class="btn btn-sm btn-primary" id="tfu-open-emp-profile">فتح ملف عملاء الموظف بالكامل</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="filter-grid">' +
          '<select class="select" id="tfu-emp" aria-label="الموظف"><option value="">جميع الموظفين</option>' +
            employees.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.employeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') +
          '</select>' +
          '<select class="select" id="tfu-status" aria-label="الحالة"><option value="">جميع الحالات</option>' +
            (root.RGCrmCore.WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) { return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
          '</select>' +
          '<input type="date" class="input" id="tfu-date" value="' + esc(state.date || '') + '" aria-label="التاريخ">' +
          '<button type="button" class="btn btn-sm" id="tfu-reset">إعادة ضبط</button>' +
        '</div>' +
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
                return '<tr>' +
                  '<td class="mono"><button type="button" class="btn-link-inline tfu-open-res" dir="ltr" data-res-id="' + esc(f.reservationId) + '">' + esc(f.reservationNumber) + '</button></td>' +
                  '<td>' + esc(f.customerName) + '</td>' +
                  '<td><button type="button" class="btn-link-inline tfu-open-emp" data-emp-id="' + esc(f.employeeId) + '">' + esc(f.employeeName) + '</button></td>' +
                  '<td><span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span></td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(f.action || '') + '">' + fmtMention(f.action, employees) + '</div></td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(f.notes || '') + '">' + (f.notes ? fmtMention(f.notes, employees) : '-') + '</div></td>' +
                  '<td class="mono tabular-nums" dir="ltr" style="white-space:nowrap;">' + esc((root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + (f.followUpTime ? ' ' + esc(fmtTime(f.followUpTime, ctx)) : '') + '</td>' +
                  '<td class="table-actions-cell"><button type="button" class="btn btn-sm btn-primary tfu-open-res" data-res-id="' + esc(f.reservationId) + '">التفاصيل</button></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>')) +
      '</div>';

    var tfuRetryBtn = document.getElementById('tfu-retry-btn');
    if (tfuRetryBtn) {
      tfuRetryBtn.addEventListener('click', function () {
        renderTeamFollowUps(container, ctx);
      });
    }

    ['tfu-emp', 'tfu-status', 'tfu-date'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        state.employeeId = document.getElementById('tfu-emp').value;
        state.status = document.getElementById('tfu-status').value;
        state.date = document.getElementById('tfu-date').value;
        renderTeamFollowUps(container, ctx);
      });
    });

    document.getElementById('tfu-reset').addEventListener('click', function () {
      state.employeeId = '';
      state.status = '';
      state.date = '';
      renderTeamFollowUps(container, ctx);
    });

    var openEmpBtn = document.getElementById('tfu-open-emp-profile');
    if (openEmpBtn && root.RGEmployees && root.RGEmployees.openEmployeeDetailsDrawer) {
      openEmpBtn.addEventListener('click', function () {
        root.RGEmployees.openEmployeeDetailsDrawer(state.employeeId, ctx, employees, function () {
          renderTeamFollowUps(container, ctx);
        });
      });
    }

    var tfuBulkBtn = document.getElementById('tfu-bulk-reassign-btn');
    if (tfuBulkBtn && root.RGEmployees && root.RGEmployees.openBulkReassignModal) {
      tfuBulkBtn.addEventListener('click', function () {
        root.RGEmployees.openBulkReassignModal(employees, ctx, function () {
          renderTeamFollowUps(container, ctx);
        }, state.employeeId);
      });
    }

    container.querySelectorAll('.tfu-open-res').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.RGReservations.openReservationDrawer(btn.getAttribute('data-res-id'), ctx, employees, function () {
          renderTeamFollowUps(container, ctx);
        });
      });
    });

    container.querySelectorAll('.tfu-open-emp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var eid = btn.getAttribute('data-emp-id');
        if (root.RGEmployees && root.RGEmployees.openEmployeeDetailsDrawer) {
          root.RGEmployees.openEmployeeDetailsDrawer(eid, ctx, employees, function () {
            renderTeamFollowUps(container, ctx);
          });
        }
      });
    });

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
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0)
        );
        if (!relevant) return;
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) return;
        renderTeamFollowUps(container, ctx);
      };
      document.addEventListener('rg:deltasync', onTeamFuDelta);
    }
  }

  root.RGFollowUps = {
    renderMyFollowUps: renderMyFollowUps,
    renderTeamFollowUps: renderTeamFollowUps
  };
})(window);
