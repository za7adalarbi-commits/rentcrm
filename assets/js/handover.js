/**
 * RENTAL GATE CRM — End-of-Shift Handover Summary & PDF Generator
 * Aggregates Closed Contracts, Pending/Follow-up Bookings, Open Problems,
 * and 24-Hour Expiring Contracts with integrated Smart PDF Compression & Preview.
 */
(function (root) {
  'use strict';

  var ROOT_ID = 'rg-handover-root';
  var activeInstance = null;

  function esc(val) {
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureRoot() {
    var el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ROOT_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  function statusTagClass(status) {
    var s = String(status || '');
    if (['تم الاستلام', 'تم الإرجاع', 'منتهي', 'مكتمل', 'تم التسليم', 'تم التمديد', 'مغلق', 'مغلقة', 'تم الحل'].indexOf(s) !== -1) {
      return 'status-success';
    }
    if (['تم الإلغاء', 'ملغي', 'مرتفع', 'جديدة'].indexOf(s) !== -1) {
      return 'status-danger';
    }
    if (['قيد الانتظار', 'معلق', 'بانتظار الدفع', 'بانتظار الشركة', 'قيد المعالجة', 'متوسط'].indexOf(s) !== -1) {
      return 'status-warning';
    }
    return 'status-info';
  }

  function priorityTagClass(prio) {
    if (prio === 'مرتفع') return 'status-danger';
    if (prio === 'متوسط') return 'status-warning';
    return 'status-neutral';
  }

  function activeTimeFormat() {
    return (root.RGApp && typeof root.RGApp.getTimeFormat === 'function') ? root.RGApp.getTimeFormat() : '24h';
  }

  function formatTimestamp(iso, lang) {
    if (!iso) return '-';
    if (root.RGApp && typeof root.RGApp.formatDateTime === 'function') {
      return root.RGApp.formatDateTime(iso, lang) || '-';
    }
    if (root.RGCrmCore && root.RGCrmCore.formatDateTimePreference) {
      return root.RGCrmCore.formatDateTimePreference(iso, activeTimeFormat(), lang || 'ar') || '-';
    }
    if (root.RGCrmCore && root.RGCrmCore.formatDisplayDateTime) {
      return root.RGCrmCore.formatDisplayDateTime(iso) || '-';
    }
    return String(iso).replace('T', ' ').substring(0, 16);
  }

  function formatTimeOnly(val, lang) {
    if (!val) return '';
    if (root.RGApp && typeof root.RGApp.formatTime === 'function') {
      return root.RGApp.formatTime(val, lang);
    }
    if (root.RGCrmCore && root.RGCrmCore.formatTimePreference) {
      return root.RGCrmCore.formatTimePreference(val, activeTimeFormat(), lang || 'ar');
    }
    return String(val);
  }

  function formatDateOnly(val) {
    if (!val) return '-';
    if (root.RGCrmCore && root.RGCrmCore.formatDisplayDate) {
      return root.RGCrmCore.formatDisplayDate(val) || '-';
    }
    return String(val).substring(0, 10);
  }

  function closeModal() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.innerHTML = '';
    if (activeInstance && activeInstance.restoreFocusEl && activeInstance.restoreFocusEl.isConnected) {
      try { activeInstance.restoreFocusEl.focus({ preventScroll: true }); } catch (_e) {}
    }
    activeInstance = null;
  }

  async function openHandoverModal(ctx, initialOpts) {
    var appCtx = ctx || (root.RGApp && root.RGApp.buildCtx ? root.RGApp.buildCtx() : { lang: 'ar', toast: function () {} });
    var isEn = (appCtx.lang || document.documentElement.getAttribute('lang')) === 'en';
    var opts = initialOpts || {};
    var core = root.RGCrmCore;
    var user = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;

    var savedHo = (core && core.normalizeHandoverSettings)
      ? core.normalizeHandoverSettings(
          (appCtx.getHandoverSettings && appCtx.getHandoverSettings()) ||
          (root.RGApp && root.RGApp.getHandoverSettings && root.RGApp.getHandoverSettings())
        )
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

    var HANDOVER_PDF_VIS_STORAGE_KEY = 'rg_crm_handover_pdf_vis_v1';

    function loadSavedPdfVisibility() {
      var stored = null;
      try {
        var raw = localStorage.getItem(HANDOVER_PDF_VIS_STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (_e) {}
      if (core && core.normalizeHandoverPdfVisibility) {
        return core.normalizeHandoverPdfVisibility(stored, savedHo);
      }
      return Object.assign({
        includeSummaryKpis: true,
        includeCustomerPhone: true,
        colCategory: true,
        colReservationNumber: true,
        colCustomerName: true,
        colCarName: true,
        colStatus: true,
        colPriority: true,
        colLastUpdate: true
      }, savedHo, stored || {});
    }

    function persistPdfVisibility(vis) {
      try {
        localStorage.setItem(HANDOVER_PDF_VIS_STORAGE_KEY, JSON.stringify(vis));
      } catch (_e) {}
    }

    var rootEl = ensureRoot();
    var state = {
      preset: opts.preset || savedHo.defaultPreset || '8h',
      dateFrom: opts.dateFrom || '',
      dateTo: opts.dateTo || '',
      timeFrom: opts.timeFrom !== undefined ? opts.timeFrom : (savedHo.defaultTimeFrom || ''),
      timeTo: opts.timeTo !== undefined ? opts.timeTo : (savedHo.defaultTimeTo || ''),
      handoverSettings: savedHo,
      pdfVisibility: loadSavedPdfVisibility(),
      staffName: (user && user.name) || (isEn ? 'Shift Supervisor' : 'مشرف الوردية'),
      notes: '',
      activeTab: opts.activeTab || 'today',
      loading: true,
      dataset: {
        reservations: [],
        problems: [],
        followUps: [],
        employees: []
      },
      summary: null,
      pdfCtrl: null,
      pdfSettings: (root.RGPdfControls && root.RGPdfControls.createDefaultState)
        ? root.RGPdfControls.createDefaultState({ paperSize: 'a4', orientation: 'landscape', targetPages: 2 })
        : { targetPages: 2, preset: 'balanced', optimizeFileSize: true, quality: 'balanced', paperSize: 'a4', orientation: 'landscape' },
      restoreFocusEl: document.activeElement
    };
    activeInstance = state;

    var presets = (core && core.SHIFT_HANDOVER_PRESETS) || [
      { key: '8h', labelAr: 'آخر 8 ساعات', labelEn: 'Last 8 Hours' },
      { key: '12h', labelAr: 'آخر 12 ساعة', labelEn: 'Last 12 Hours' },
      { key: 'today', labelAr: 'وردية اليوم', labelEn: "Today's Shift" },
      { key: 'yesterday', labelAr: 'وردية الأمس', labelEn: "Yesterday's Shift" },
      { key: 'custom', labelAr: 'نطاق مخصص', labelEn: 'Custom Range' }
    ];

    function recomputeSummary() {
      if (core && core.computeShiftHandoverSummary) {
        state.summary = core.computeShiftHandoverSummary({
          reservations: state.dataset.reservations,
          problems: state.dataset.problems,
          followUps: state.dataset.followUps,
          preset: state.preset,
          dateFrom: state.dateFrom,
          dateTo: state.dateTo,
          timeFrom: state.timeFrom,
          timeTo: state.timeTo,
          handoverSettings: state.handoverSettings,
          staffName: state.staffName,
          notes: state.notes
        });
      } else {
        state.summary = {
          shiftWindow: { labelAr: 'آخر 8 ساعات', labelEn: 'Last 8 Hours' },
          handoverSettings: state.handoverSettings,
          closedReservations: [],
          pendingReservations: [],
          openProblems: [],
          expiring24h: [],
          todayMovements: [],
          shiftFollowUps: [],
          counts: {
            closedCount: 0,
            pendingCount: 0,
            openProblemsCount: 0,
            highPriorityProblemsCount: 0,
            expiring24hCount: 0,
            followUpsCount: 0,
            todayMovementsCount: 0
          }
        };
      }
      if (state.pdfCtrl) {
        state.pdfCtrl.setContentStats(getContentStatsForSummary(state.summary));
      }
    }

    function getContentStatsForSummary(summary) {
      var s = summary || state.summary || {};
      var c = s.counts || {};
      var vis = state.pdfVisibility || {};
      var showTable = Boolean(vis.includePending || vis.includeClosed);
      var colKeys = ['colCategory', 'colReservationNumber', 'colCustomerName', 'colCarName', 'colStatus', 'colPriority', 'colLastUpdate'];
      var visibleColsCount = showTable ? colKeys.filter(function (k) { return vis[k] !== false; }).length : 0;
      var rowsCount = (visibleColsCount > 0)
        ? ((vis.includePending ? (c.pendingCount || 0) : 0) + (vis.includeClosed ? (c.closedCount || 0) : 0))
        : 0;
      var todayLen = vis.includeTodayMovements ? ((s.todayMovements && s.todayMovements.length) || 0) : 0;
      var prbLen = vis.includeOpenProblems ? ((s.openProblems && s.openProblems.length) || 0) : 0;
      var expLen = vis.includeExpiring24h ? ((s.expiring24h && s.expiring24h.length) || 0) : 0;
      var extraCount = (todayLen ? 1 : 0) + (prbLen ? 1 : 0) + (expLen ? 1 : 0);
      var extraLines = todayLen + prbLen + expLen;
      return {
        rowCount: rowsCount,
        columnCount: visibleColsCount,
        kpiCount: vis.includeSummaryKpis ? 7 : 0,
        wideSummaryCount: (vis.autoIncludeNotes && state.notes && state.notes.trim().length > 26) ? 1 : 0,
        extraSectionsCount: extraCount,
        extraLinesCount: extraLines,
        chartCount: 0
      };
    }

    var PDF_SECTION_TOGGLES = [
      { key: 'includeSummaryKpis', ar: 'بطاقة الملخص والأرقام', en: 'Summary KPIs' },
      { key: 'includeTodayMovements', ar: 'التسليم والاستلام اليوم', en: "Today's Movements" },
      { key: 'includePending', ar: 'قيد الانتظار / المتابعة', en: 'Pending Bookings' },
      { key: 'includeClosed', ar: 'الحجوزات المغلقة', en: 'Closed Bookings' },
      { key: 'includeOpenProblems', ar: 'المشكلات المفتوحة', en: 'Open Problems' },
      { key: 'includeExpiring24h', ar: 'تنبيهات الانتهاء 24س', en: 'Expiring ≤ 24h' },
      { key: 'autoIncludeNotes', ar: 'ملاحظات التسليم', en: 'Handover Notes' }
    ];

    var PDF_DETAIL_TOGGLES = [
      { key: 'colCategory', ar: 'عمود التصنيف', en: 'Category Col' },
      { key: 'colReservationNumber', ar: 'رقم الحجز', en: 'Booking # Col' },
      { key: 'colCustomerName', ar: 'اسم العميل', en: 'Customer Col' },
      { key: 'includeCustomerPhone', ar: 'جوال العميل', en: 'Customer Phone' },
      { key: 'colCarName', ar: 'السيارة', en: 'Vehicle Col' },
      { key: 'colStatus', ar: 'الحالة', en: 'Status Col' },
      { key: 'colPriority', ar: 'الأولوية', en: 'Priority Col' },
      { key: 'colLastUpdate', ar: 'آخر تحديث / إجراء', en: 'Last Update Col' }
    ];

    function hasAnyVisiblePdfSection() {
      var vis = state.pdfVisibility || {};
      return PDF_SECTION_TOGGLES.some(function (t) { return Boolean(vis[t.key]); });
    }

    function syncVisibilityUi() {
      var vis = state.pdfVisibility || {};
      var secCount = 0;
      var detCount = 0;
      PDF_SECTION_TOGGLES.forEach(function (t) {
        if (vis[t.key]) secCount += 1;
      });
      PDF_DETAIL_TOGGLES.forEach(function (t) {
        if (vis[t.key]) detCount += 1;
      });

      rootEl.querySelectorAll('.ho-vis-btn[data-vis-key]').forEach(function (btn) {
        var k = btn.getAttribute('data-vis-key');
        var isOn = Boolean(vis[k]);
        btn.classList.toggle('is-on', isOn);
        btn.classList.toggle('is-off', !isOn);
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        var mark = btn.querySelector('.ho-vis-mark');
        if (mark) mark.textContent = isOn ? '✓' : '✕';
      });

      var counterEl = rootEl.querySelector('#ho-pdf-vis-counter');
      if (counterEl) {
        var tableHidden = !vis.includePending && !vis.includeClosed;
        if (secCount === 0) {
          counterEl.textContent = isEn ? 'All sections hidden — choose at least 1 section' : 'جميع الأقسام مخفية — اختر قسماً واحداً على الأقل';
          counterEl.className = 'ho-pdf-vis-counter is-warn';
        } else {
          counterEl.textContent = isEn
            ? ('Visible: ' + secCount + '/' + PDF_SECTION_TOGGLES.length + ' sections · ' + detCount + '/' + PDF_DETAIL_TOGGLES.length + ' details' + (tableHidden ? ' (table off)' : ''))
            : ('المحتوى المحدد للتصدير: ' + secCount + ' من ' + PDF_SECTION_TOGGLES.length + ' أقسام · ' + detCount + ' من ' + PDF_DETAIL_TOGGLES.length + ' تفاصيل' + (tableHidden ? ' (الجدول مخفي)' : ''));
          counterEl.className = 'ho-pdf-vis-counter';
        }
      }

      if (state.pdfCtrl) {
        state.pdfCtrl.setContentStats(getContentStatsForSummary(state.summary));
      }
    }

    function renderActiveTabListHtml() {
      if (state.loading) {
        return '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div></div>';
      }
      var s = state.summary;
      if (!s) return '';

      if (state.activeTab === 'today') {
        var mvs = s.todayMovements || [];
        if (!mvs.length) {
          return '<div class="empty-state" style="padding:20px;">' + (isEn ? 'No pickups or returns scheduled for today in this time range.' : 'لا توجد حركات تسليم أو استلام اليوم ضمن نطاق الوقت المحدد.') + '</div>';
        }
        return '<div class="handover-list">' + mvs.map(function (it) {
          var r = it.reservation || {};
          var isPickup = it.movementType === 'pickup';
          var kindLabel = isPickup ? (isEn ? 'Pickup' : 'تسليم') : (isEn ? 'Return' : 'استلام');
          var kindCls = isPickup ? 'status-info' : 'status-warning';
          var stateBadge = it.isCompleted
            ? '<span class="status-tag status-success">' + (isEn ? 'Done' : 'مكتمل') + '</span>'
            : (it.isOverdue
              ? '<span class="status-tag status-danger">' + (isEn ? 'Overdue' : 'متأخر') + '</span>'
              : '<span class="status-tag status-neutral">' + (isEn ? 'Scheduled' : 'مجدول') + '</span>');
          var telHref = (core && core.formatDirectCallTelHref) ? core.formatDirectCallTelHref(r.customerPhone, '90') : '';
          return '<div class="handover-row">' +
            '<button type="button" class="handover-row-main handover-open-res" data-res-id="' + esc(r.id) + '" style="background:transparent;border:0;padding:0;text-align:start;cursor:pointer;">' +
              '<div class="handover-row-top">' +
                '<span class="status-tag ' + kindCls + '">' + esc(kindLabel) + '</span>' +
                '<span class="today-time-slot tabular-nums" dir="ltr">' + esc(formatTimeOnly(it.scheduledTime, appCtx.lang)) + '</span>' +
                '<strong class="mono" dir="ltr">' + esc(r.reservationNumber || r.id) + '</strong>' +
                '<span class="handover-row-customer">' + esc(r.customerName || '-') + '</span>' +
              '</div>' +
              '<div class="handover-row-sub">' +
                esc(r.carName || '-') + ' · ' + esc(r.companyName || '-') + ' — ' + esc(isPickup ? (r.branchName || '-') : (r.deliverBranchName || r.branchName || '-')) +
                (r.customerPhone ? ' · <span class="mono" dir="ltr">' + esc(r.customerPhone) + '</span>' : '') +
              '</div>' +
            '</button>' +
            '<div class="handover-row-end">' +
              stateBadge +
              (telHref ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || '') + '" data-call-customer="' + esc(r.customerName || '') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '">📞 ' + (isEn ? 'Call 90' : 'اتصال 90') + '</a>' : '') +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      if (state.activeTab === 'pending') {
        var pend = s.pendingReservations || [];
        if (!pend.length) {
          return '<div class="empty-state" style="padding:20px;">' + (isEn ? 'No pending reservations requiring follow-up.' : 'لا توجد حجوزات قيد الانتظار أو تحتاج متابعة حالياً.') + '</div>';
        }
        return '<div class="handover-list">' + pend.map(function (r) {
          var assigned = Array.isArray(r.assignedEmployeeNames) && r.assignedEmployeeNames.length
            ? r.assignedEmployeeNames.join('، ')
            : (isEn ? 'Unassigned' : 'غير مسند');
          return '<button type="button" class="handover-row handover-open-res" data-res-id="' + esc(r.id) + '">' +
            '<div class="handover-row-main">' +
              '<div class="handover-row-top">' +
                '<strong class="mono" dir="ltr">' + esc(r.reservationNumber || r.id) + '</strong>' +
                '<span class="handover-row-customer">' + esc(r.customerName || '-') + '</span>' +
                (r.hasProblem ? '<span class="status-tag status-danger">' + (isEn ? 'Problem' : 'مشكلة') + '</span>' : '') +
              '</div>' +
              '<div class="handover-row-sub">' +
                esc(r.carName || '-') + ' · ' + esc(assigned) + (r.lastUpdateText ? ' · ' + esc(r.lastUpdateText) : '') +
              '</div>' +
            '</div>' +
            '<div class="handover-row-end">' +
              '<span class="status-tag ' + statusTagClass(r.internalStatus) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span>' +
              '<span class="status-tag ' + priorityTagClass(r.priority) + '">' + esc(r.priority || 'عادي') + '</span>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
      }

      if (state.activeTab === 'problems') {
        var prbs = s.openProblems || [];
        if (!prbs.length) {
          return '<div class="empty-state" style="padding:20px;">' + (isEn ? 'No open problems to hand over.' : 'لا توجد مشكلات مفتوحة لتسليمها للوردية التالية.') + '</div>';
        }
        return '<div class="handover-list">' + prbs.map(function (p) {
          return '<button type="button" class="handover-row handover-open-prb" data-prb-id="' + esc(p.id) + '">' +
            '<div class="handover-row-main">' +
              '<div class="handover-row-top">' +
                '<strong class="mono" dir="ltr">' + esc(p.problemNumber || p.id) + '</strong>' +
                '<span class="mono" dir="ltr" style="color:var(--text-muted);font-size:12px;">' + esc(p.reservationNumber || '') + '</span>' +
                '<span class="handover-row-customer">' + esc(p.customerName || '-') + '</span>' +
              '</div>' +
              '<div class="handover-row-sub">' + esc(p.description || '-') + '</div>' +
            '</div>' +
            '<div class="handover-row-end">' +
              '<span class="status-tag ' + statusTagClass(p.status) + '">' + esc(p.status || '-') + '</span>' +
              '<span class="status-tag ' + priorityTagClass(p.priority) + '">' + esc(p.priority || 'عادي') + '</span>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
      }

      if (state.activeTab === 'closed') {
        var closed = s.closedReservations || [];
        if (!closed.length) {
          return '<div class="empty-state" style="padding:20px;">' + (isEn ? 'No reservations closed inside this shift window.' : 'لا توجد حجوزات مغلقة ضمن نطاق الوردية المحدد.') + '</div>';
        }
        return '<div class="handover-list">' + closed.map(function (r) {
          return '<button type="button" class="handover-row handover-open-res" data-res-id="' + esc(r.id) + '">' +
            '<div class="handover-row-main">' +
              '<div class="handover-row-top">' +
                '<strong class="mono" dir="ltr">' + esc(r.reservationNumber || r.id) + '</strong>' +
                '<span class="handover-row-customer">' + esc(r.customerName || '-') + '</span>' +
              '</div>' +
              '<div class="handover-row-sub">' +
                esc(r.carName || '-') + ' · ' + esc(r.lastUpdatedByName || '-') + ' · ' +
                '<span class="mono tabular-nums" dir="ltr">' + esc(formatTimestamp(r.lastUpdatedAt || r.updatedAt, appCtx.lang)) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="handover-row-end">' +
              '<span class="status-tag ' + statusTagClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
      }

      var exp = s.expiring24h || [];
      if (!exp.length) {
        return '<div class="empty-state" style="padding:20px;">' + (isEn ? 'No reservations expiring within the next 24 hours.' : 'لا توجد حجوزات تقترب من الانتهاء خلال 24 ساعة.') + '</div>';
      }
      return '<div class="handover-list">' + exp.map(function (entry) {
        var r = entry.reservation || {};
        var remLabel = isEn ? entry.remainingLabelEn : entry.remainingLabelAr;
        var toneCls = entry.bucket === 'expired_unclosed' ? 'status-danger' : (entry.bucket === 'critical_6h' ? 'status-warning' : 'status-info');
        return '<button type="button" class="handover-row handover-open-res" data-res-id="' + esc(r.id) + '">' +
          '<div class="handover-row-main">' +
            '<div class="handover-row-top">' +
              '<strong class="mono" dir="ltr">' + esc(r.reservationNumber || r.id) + '</strong>' +
              '<span class="handover-row-customer">' + esc(r.customerName || '-') + '</span>' +
              (entry.isExtended ? '<span class="status-tag status-info">' + (isEn ? 'Extended' : 'ممدد') + '</span>' : '') +
            '</div>' +
            '<div class="handover-row-sub">' +
              esc(r.carName || '-') + ' · ' +
              '<span class="mono tabular-nums" dir="ltr">' + esc(formatDateOnly(entry.effectiveEndDate)) + (entry.effectiveEndTime ? ' ' + esc(formatTimeOnly(entry.effectiveEndTime, appCtx.lang)) : '') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="handover-row-end">' +
            '<span class="status-tag ' + toneCls + ' tabular-nums">' + esc(remLabel) + '</span>' +
          '</div>' +
        '</button>';
      }).join('') + '</div>';
    }

    function updateDynamicSections() {
      if (activeInstance !== state) return;
      recomputeSummary();
      var s = state.summary;
      var counts = s.counts || {};
      var winLabel = isEn ? (s.shiftWindow.labelEn || '') : (s.shiftWindow.labelAr || '');

      var subEl = rootEl.querySelector('#handover-window-sub');
      if (subEl) subEl.textContent = winLabel;

      var setTxt = function (id, val) {
        var el = rootEl.querySelector('#' + id);
        if (el) el.textContent = String(val);
      };
      setTxt('ho-kpi-today', counts.todayMovementsCount || 0);
      setTxt('ho-kpi-closed', counts.closedCount || 0);
      setTxt('ho-kpi-pending', counts.pendingCount || 0);
      setTxt('ho-kpi-problems', counts.openProblemsCount || 0);
      setTxt('ho-kpi-expiring', counts.expiring24hCount || 0);
      setTxt('ho-meta-fu', counts.followUpsCount || 0);
      setTxt('ho-meta-active', counts.activeHealthyCount || 0);

      setTxt('ho-tab-cnt-today', counts.todayMovementsCount || 0);
      setTxt('ho-tab-cnt-pending', counts.pendingCount || 0);
      setTxt('ho-tab-cnt-problems', counts.openProblemsCount || 0);
      setTxt('ho-tab-cnt-closed', counts.closedCount || 0);
      setTxt('ho-tab-cnt-expiring', counts.expiring24hCount || 0);

      var listWrap = rootEl.querySelector('#handover-tab-body');
      if (listWrap) {
        listWrap.innerHTML = renderActiveTabListHtml();
        bindRowHandlers(listWrap);
      }
    }

    function bindRowHandlers(scopeEl) {
      if (!scopeEl) return;
      scopeEl.querySelectorAll('.handover-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-res-id');
          if (root.RGReservations && root.RGReservations.openReservationDrawer) {
            root.RGReservations.openReservationDrawer(rid, appCtx, state.dataset.employees, function () {
              reloadData();
            });
          }
        });
      });
      scopeEl.querySelectorAll('.handover-open-prb').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pid = btn.getAttribute('data-prb-id');
          if (root.RGProblems && root.RGProblems.openProblemById) {
            root.RGProblems.openProblemById(pid, appCtx, function () {
              reloadData();
            });
          }
        });
      });
    }

    function buildHandoverPdfConfig(liveSettings) {
      recomputeSummary();
      var payload = (core && core.buildShiftHandoverPdfPayload)
        ? core.buildShiftHandoverPdfPayload(state.summary, appCtx.lang || 'ar', {
            timeFormat: activeTimeFormat(),
            handoverSettings: state.handoverSettings,
            pdfVisibility: state.pdfVisibility
          })
        : { title: 'Shift Handover', filename: 'shift-handover.pdf', summaryItems: [], columns: [], rows: [], extraSections: [] };
      var s = Object.assign({}, state.pdfSettings, liveSettings || {});
      return Object.assign({}, payload, {
        paperSize: s.paperSize,
        orientation: s.orientation,
        targetPages: s.targetPages,
        preset: s.preset,
        optimizeFileSize: s.optimizeFileSize,
        quality: s.quality,
        lang: appCtx.lang || 'ar',
        dir: isEn ? 'ltr' : 'rtl',
        exporterName: state.staffName || (user ? user.name : '')
      });
    }

    function renderShell() {
      recomputeSummary();
      var s = state.summary;
      var counts = s.counts || {};
      var winLabel = isEn ? (s.shiftWindow.labelEn || '') : (s.shiftWindow.labelAr || '');

      var pdfPanelHtml = (root.RGPdfControls && root.RGPdfControls.renderPanelHtml)
        ? root.RGPdfControls.renderPanelHtml({
            mode: 'modal',
            idPrefix: 'rg-handover-pdfc',
            lang: appCtx.lang || 'ar',
            settings: state.pdfSettings,
            contentStats: getContentStatsForSummary(s)
          })
        : '';

      rootEl.innerHTML =
        '<div class="modal-backdrop rg-handover-backdrop" id="rg-handover-backdrop" role="dialog" aria-modal="true" aria-labelledby="handover-modal-title">' +
          '<div class="modal-panel modal-panel-wide">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title" id="handover-modal-title">' + (isEn ? 'Shift Handover Summary' : 'ملخص تسليم الوردية') + '</h3>' +
                '<div class="meta-inline">' +
                  '<span id="handover-window-sub">' + esc(winLabel) + '</span>' +
                  '<span>·</span>' +
                  '<span>' + (isEn ? 'Follow-ups:' : 'متابعات الوردية:') + ' <strong class="tabular-nums" id="ho-meta-fu">' + (counts.followUpsCount || 0) + '</strong></span>' +
                  '<span>·</span>' +
                  '<span>' + (isEn ? 'Active OK:' : 'نشطة مستقرة:') + ' <strong class="tabular-nums" id="ho-meta-active">' + (counts.activeHealthyCount || 0) + '</strong></span>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<button type="button" class="btn btn-sm" id="handover-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث البيانات') + '</button>' +
                '<button type="button" class="btn btn-sm" id="handover-close-btn">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
              '</div>' +
            '</div>' +

            '<div class="handover-controls-grid">' +
              '<div class="form-group">' +
                '<label class="form-label" for="handover-preset">' + (isEn ? 'Shift Window' : 'نطاق الوردية') + '</label>' +
                '<select class="select" id="handover-preset">' +
                  presets.map(function (p) {
                    var lbl = isEn ? p.labelEn : p.labelAr;
                    return '<option value="' + esc(p.key) + '"' + (state.preset === p.key ? ' selected' : '') + '>' + esc(lbl) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label class="form-label" for="handover-staff">' + (isEn ? 'Outgoing Supervisor' : 'مسؤول تسليم الوردية') + '</label>' +
                '<input type="text" class="input" id="handover-staff" value="' + esc(state.staffName) + '">' +
              '</div>' +
            '</div>' +

            '<div class="handover-custom-dates' + (state.preset === 'custom' ? '' : ' hidden') + '" id="handover-custom-dates">' +
              '<div class="form-group"><label class="form-label" for="handover-from">' + (isEn ? 'From Date' : 'من تاريخ') + '</label><input type="date" class="input" id="handover-from" data-rg-range-pair="handover-range" data-rg-range-role="start" value="' + esc(state.dateFrom) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="handover-to">' + (isEn ? 'To Date' : 'إلى تاريخ') + '</label><input type="date" class="input" id="handover-to" data-rg-range-pair="handover-range" data-rg-range-role="end" value="' + esc(state.dateTo) + '"></div>' +
            '</div>' +

            '<div class="handover-time-range" id="handover-time-range-row">' +
              '<div class="form-group"><label class="form-label" for="handover-time-from">' + (isEn ? 'From Hour' : 'من الساعة') + '</label><input type="time" class="input mono" id="handover-time-from" dir="ltr" value="' + esc(state.timeFrom) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="handover-time-to">' + (isEn ? 'To Hour' : 'إلى الساعة') + '</label><input type="time" class="input mono" id="handover-time-to" dir="ltr" value="' + esc(state.timeTo) + '"></div>' +
              '<div class="form-group handover-time-clear-wrap"><button type="button" class="btn btn-sm" id="handover-clear-time-btn">' + (isEn ? 'Reset Hours' : 'مسح الساعات') + '</button></div>' +
            '</div>' +

            '<div class="handover-kpi-grid handover-kpi-grid-5">' +
              '<button type="button" class="handover-kpi-box is-today" data-ho-jump="today">' +
                '<span class="handover-kpi-lbl">' + (isEn ? "Today's Pickups & Returns" : 'التسليم والاستلام اليوم') + '</span>' +
                '<strong class="handover-kpi-val tabular-nums" id="ho-kpi-today">' + (counts.todayMovementsCount || 0) + '</strong>' +
              '</button>' +
              '<button type="button" class="handover-kpi-box is-success" data-ho-jump="closed">' +
                '<span class="handover-kpi-lbl">' + (isEn ? 'Closed in Shift' : 'الحجوزات المغلقة') + '</span>' +
                '<strong class="handover-kpi-val tabular-nums" id="ho-kpi-closed">' + (counts.closedCount || 0) + '</strong>' +
              '</button>' +
              '<button type="button" class="handover-kpi-box is-warning" data-ho-jump="pending">' +
                '<span class="handover-kpi-lbl">' + (isEn ? 'Pending / Action' : 'قيد الانتظار / المتابعة') + '</span>' +
                '<strong class="handover-kpi-val tabular-nums" id="ho-kpi-pending">' + (counts.pendingCount || 0) + '</strong>' +
              '</button>' +
              '<button type="button" class="handover-kpi-box is-danger" data-ho-jump="problems">' +
                '<span class="handover-kpi-lbl">' + (isEn ? 'Open Problems' : 'المشكلات المفتوحة') + '</span>' +
                '<strong class="handover-kpi-val tabular-nums" id="ho-kpi-problems">' + (counts.openProblemsCount || 0) + '</strong>' +
              '</button>' +
              '<button type="button" class="handover-kpi-box is-info" data-ho-jump="expiring">' +
                '<span class="handover-kpi-lbl">' + (isEn ? 'Expiring ≤ 24h' : 'تنتهي خلال 24 ساعة') + '</span>' +
                '<strong class="handover-kpi-val tabular-nums" id="ho-kpi-expiring">' + (counts.expiring24hCount || 0) + '</strong>' +
              '</button>' +
            '</div>' +

            '<div class="handover-tabs" role="tablist">' +
              '<button type="button" class="handover-tab-btn' + (state.activeTab === 'today' ? ' is-active' : '') + '" data-ho-tab="today">' +
                (isEn ? "Today's Pickups & Returns" : 'التسليم والاستلام اليوم') + ' (<span class="tabular-nums" id="ho-tab-cnt-today">' + (counts.todayMovementsCount || 0) + '</span>)' +
              '</button>' +
              '<button type="button" class="handover-tab-btn' + (state.activeTab === 'pending' ? ' is-active' : '') + '" data-ho-tab="pending">' +
                (isEn ? 'Pending' : 'قيد الانتظار') + ' (<span class="tabular-nums" id="ho-tab-cnt-pending">' + (counts.pendingCount || 0) + '</span>)' +
              '</button>' +
              '<button type="button" class="handover-tab-btn' + (state.activeTab === 'problems' ? ' is-active' : '') + '" data-ho-tab="problems">' +
                (isEn ? 'Open Problems' : 'المشكلات المفتوحة') + ' (<span class="tabular-nums" id="ho-tab-cnt-problems">' + (counts.openProblemsCount || 0) + '</span>)' +
              '</button>' +
              '<button type="button" class="handover-tab-btn' + (state.activeTab === 'closed' ? ' is-active' : '') + '" data-ho-tab="closed">' +
                (isEn ? 'Closed' : 'المغلقة في الوردية') + ' (<span class="tabular-nums" id="ho-tab-cnt-closed">' + (counts.closedCount || 0) + '</span>)' +
              '</button>' +
              '<button type="button" class="handover-tab-btn' + (state.activeTab === 'expiring' ? ' is-active' : '') + '" data-ho-tab="expiring">' +
                (isEn ? 'Expiring 24h' : 'تنبيهات الانتهاء 24س') + ' (<span class="tabular-nums" id="ho-tab-cnt-expiring">' + (counts.expiring24hCount || 0) + '</span>)' +
              '</button>' +
            '</div>' +

            '<div id="handover-tab-body">' + renderActiveTabListHtml() + '</div>' +

            '<div class="form-group">' +
              '<label class="form-label" for="handover-notes">' + (isEn ? 'Handover Notes for Incoming Shift (included in PDF)' : 'ملاحظات التسليم للوردية التالية (تُدرج في ملف PDF)') + '</label>' +
              '<textarea class="textarea" id="handover-notes" rows="2" placeholder="' + (isEn ? 'Key follow-ups, pending vehicle deliveries, or escalations for next shift...' : 'اكتب أبرز التوجيهات أو الحالات العاجلة لتنبيه موظف الوردية التالية...') + '">' + esc(state.notes) + '</textarea>' +
            '</div>' +

            '<div class="ho-pdf-vis-card" id="handover-pdf-visibility-card">' +
              '<div class="ho-pdf-vis-head">' +
                '<div>' +
                  '<strong class="ho-pdf-vis-title">' + (isEn ? 'Customize PDF Content (Show / Hide)' : 'تخصيص محتوى PDF (ماذا يظهر وماذا لا يظهر)') + '</strong>' +
                  '<div class="ho-pdf-vis-counter" id="ho-pdf-vis-counter"></div>' +
                '</div>' +
                '<div class="ho-pdf-vis-presets">' +
                  '<button type="button" class="btn btn-sm" id="ho-vis-preset-all">' + (isEn ? 'Show All' : 'إظهار الكل') + '</button>' +
                  '<button type="button" class="btn btn-sm" id="ho-vis-preset-essential">' + (isEn ? 'Essential Only' : 'الأساسيات فقط') + '</button>' +
                  '<button type="button" class="btn btn-sm" id="ho-vis-preset-default">' + (isEn ? 'Saved Defaults' : 'الافتراضي') + '</button>' +
                '</div>' +
              '</div>' +
              '<div class="ho-pdf-vis-group">' +
                '<span class="ho-pdf-vis-group-lbl">' + (isEn ? 'Report Sections:' : 'أقسام التقرير:') + '</span>' +
                '<div class="ho-pdf-vis-grid">' +
                  PDF_SECTION_TOGGLES.map(function (t) {
                    var on = Boolean(state.pdfVisibility[t.key]);
                    return '<button type="button" class="ho-vis-btn ' + (on ? 'is-on' : 'is-off') + '" data-vis-key="' + esc(t.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
                      '<span class="ho-vis-mark" aria-hidden="true">' + (on ? '✓' : '✕') + '</span>' +
                      '<span>' + esc(isEn ? t.en : t.ar) + '</span>' +
                    '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +
              '<div class="ho-pdf-vis-group">' +
                '<span class="ho-pdf-vis-group-lbl">' + (isEn ? 'Table Columns & Phone Details:' : 'الأعمدة والتفاصيل في الجدول:') + '</span>' +
                '<div class="ho-pdf-vis-grid">' +
                  PDF_DETAIL_TOGGLES.map(function (t) {
                    var on = Boolean(state.pdfVisibility[t.key]);
                    return '<button type="button" class="ho-vis-btn ' + (on ? 'is-on' : 'is-off') + '" data-vis-key="' + esc(t.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
                      '<span class="ho-vis-mark" aria-hidden="true">' + (on ? '✓' : '✕') + '</span>' +
                      '<span>' + esc(isEn ? t.en : t.ar) + '</span>' +
                    '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>' +

            pdfPanelHtml +

            '<div class="modal-footer">' +
              '<button type="button" class="btn" id="handover-pdf-download-btn">' + (isEn ? 'Download Handover PDF' : 'تحميل PDF مباشرة') + '</button>' +
              '<button type="button" class="btn btn-primary" id="handover-pdf-preview-btn">' + (isEn ? 'Preview & Export PDF' : 'معاينة وتصدير PDF') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      var backdrop = document.getElementById('rg-handover-backdrop');
      if (backdrop) {
        backdrop.addEventListener('click', function (ev) {
          if (ev.target === backdrop) closeModal();
        });
      }
      var closeBtn = document.getElementById('handover-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', closeModal);

      var refreshBtn = document.getElementById('handover-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          reloadData(true);
        });
      }

      var presetEl = document.getElementById('handover-preset');
      var customDatesEl = document.getElementById('handover-custom-dates');
      var fromEl = document.getElementById('handover-from');
      var toEl = document.getElementById('handover-to');

      if (presetEl) {
        presetEl.addEventListener('change', function () {
          state.preset = presetEl.value || '8h';
          if (customDatesEl) customDatesEl.classList.toggle('hidden', state.preset !== 'custom');
          updateDynamicSections();
        });
      }
      if (fromEl) {
        fromEl.addEventListener('change', function () {
          state.dateFrom = fromEl.value;
          if (state.preset === 'custom') updateDynamicSections();
        });
      }
      if (toEl) {
        toEl.addEventListener('change', function () {
          state.dateTo = toEl.value;
          if (state.preset === 'custom') updateDynamicSections();
        });
      }

      var timeFromEl = document.getElementById('handover-time-from');
      var timeToEl = document.getElementById('handover-time-to');
      var clearTimeBtn = document.getElementById('handover-clear-time-btn');
      if (timeFromEl) {
        timeFromEl.addEventListener('change', function () {
          state.timeFrom = timeFromEl.value || '';
          updateDynamicSections();
        });
      }
      if (timeToEl) {
        timeToEl.addEventListener('change', function () {
          state.timeTo = timeToEl.value || '';
          updateDynamicSections();
        });
      }
      if (clearTimeBtn) {
        clearTimeBtn.addEventListener('click', function () {
          state.timeFrom = '';
          state.timeTo = '';
          if (timeFromEl) timeFromEl.value = '';
          if (timeToEl) timeToEl.value = '';
          updateDynamicSections();
        });
      }

      var staffEl = document.getElementById('handover-staff');
      if (staffEl) {
        staffEl.addEventListener('input', function () {
          state.staffName = staffEl.value;
        });
      }

      var notesEl = document.getElementById('handover-notes');
      if (notesEl) {
        notesEl.addEventListener('input', function () {
          state.notes = notesEl.value;
          recomputeSummary();
        });
      }

      function setActiveTab(tabKey) {
        state.activeTab = tabKey;
        rootEl.querySelectorAll('[data-ho-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-ho-tab') === tabKey);
        });
        var bodyEl = rootEl.querySelector('#handover-tab-body');
        if (bodyEl) {
          bodyEl.innerHTML = renderActiveTabListHtml();
          bindRowHandlers(bodyEl);
        }
      }

      rootEl.querySelectorAll('[data-ho-tab]').forEach(function (b) {
        b.addEventListener('click', function () {
          setActiveTab(b.getAttribute('data-ho-tab'));
        });
      });

      rootEl.querySelectorAll('[data-ho-jump]').forEach(function (b) {
        b.addEventListener('click', function () {
          setActiveTab(b.getAttribute('data-ho-jump'));
        });
      });

      var pdfPanelEl = document.getElementById('rg-handover-pdfc');
      if (root.RGPdfControls && pdfPanelEl) {
        state.pdfCtrl = root.RGPdfControls.mount(pdfPanelEl, {
          lang: appCtx.lang || 'ar',
          initialSettings: state.pdfSettings,
          contentStats: getContentStatsForSummary(s),
          onChange: function (nextSettings) {
            state.pdfSettings = nextSettings;
          }
        });
      }

      rootEl.querySelectorAll('.ho-vis-btn[data-vis-key]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-vis-key');
          if (!key) return;
          state.pdfVisibility[key] = !state.pdfVisibility[key];
          persistPdfVisibility(state.pdfVisibility);
          syncVisibilityUi();
        });
      });

      var presetAllBtn = document.getElementById('ho-vis-preset-all');
      if (presetAllBtn) {
        presetAllBtn.addEventListener('click', function () {
          var allVis = {};
          PDF_SECTION_TOGGLES.concat(PDF_DETAIL_TOGGLES).forEach(function (t) { allVis[t.key] = true; });
          state.pdfVisibility = (core && core.normalizeHandoverPdfVisibility)
            ? core.normalizeHandoverPdfVisibility(allVis, savedHo)
            : allVis;
          persistPdfVisibility(state.pdfVisibility);
          syncVisibilityUi();
        });
      }

      var presetEssentialBtn = document.getElementById('ho-vis-preset-essential');
      if (presetEssentialBtn) {
        presetEssentialBtn.addEventListener('click', function () {
          var ess = {
            includeSummaryKpis: true,
            includeTodayMovements: true,
            includePending: true,
            includeClosed: false,
            includeOpenProblems: true,
            includeExpiring24h: true,
            autoIncludeNotes: true,
            includeCustomerPhone: true,
            colCategory: true,
            colReservationNumber: true,
            colCustomerName: true,
            colCarName: false,
            colStatus: true,
            colPriority: true,
            colLastUpdate: true
          };
          state.pdfVisibility = (core && core.normalizeHandoverPdfVisibility)
            ? core.normalizeHandoverPdfVisibility(ess, savedHo)
            : ess;
          persistPdfVisibility(state.pdfVisibility);
          syncVisibilityUi();
        });
      }

      var presetDefaultBtn = document.getElementById('ho-vis-preset-default');
      if (presetDefaultBtn) {
        presetDefaultBtn.addEventListener('click', function () {
          try { localStorage.removeItem(HANDOVER_PDF_VIS_STORAGE_KEY); } catch (_e) {}
          state.pdfVisibility = (core && core.normalizeHandoverPdfVisibility)
            ? core.normalizeHandoverPdfVisibility({}, savedHo)
            : loadSavedPdfVisibility();
          syncVisibilityUi();
        });
      }

      syncVisibilityUi();
      bindRowHandlers(rootEl.querySelector('#handover-tab-body'));

      var previewBtn = document.getElementById('handover-pdf-preview-btn');
      if (previewBtn) {
        previewBtn.addEventListener('click', function () {
          if (!hasAnyVisiblePdfSection()) {
            if (appCtx.toast) appCtx.toast(isEn ? 'Select at least one section to include in PDF.' : 'يرجى تحديد قسم واحد على الأقل لإظهاره في ملف PDF.', true);
            return;
          }
          if (!root.RGReports || !root.RGReports.exportArabicPdfDocument) {
            if (appCtx.toast) appCtx.toast(isEn ? 'PDF generator is unavailable.' : 'وحدة تصدير PDF غير متاحة.', true);
            return;
          }
          var runPreview = async function () {
            try {
              var snapSettings = state.pdfCtrl ? state.pdfCtrl.getSettings() : state.pdfSettings;
              if (root.RGPdfPreview && typeof root.RGPdfPreview.open === 'function') {
                await root.RGPdfPreview.open({
                  title: isEn ? 'Shift Handover Report' : 'ملخص تسليم الوردية',
                  filename: buildHandoverPdfConfig(snapSettings).filename,
                  initialSettings: snapSettings,
                  getContentStats: function () {
                    recomputeSummary();
                    return getContentStatsForSummary(state.summary);
                  },
                  generatePdf: function (liveSettings, signal) {
                    var cfg = buildHandoverPdfConfig(liveSettings);
                    cfg.signal = signal;
                    cfg.previewOnly = true;
                    return root.RGReports.exportArabicPdfDocument(cfg);
                  },
                  onSettingsChange: function (nextSettings) {
                    state.pdfSettings = nextSettings;
                    if (state.pdfCtrl) state.pdfCtrl.setSettings(nextSettings, true);
                  },
                  onDownloadToast: function (meta) {
                    var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
                    if (appCtx.toast) {
                      appCtx.toast(isEn
                        ? ('Downloaded Handover PDF (' + meta.pages + ' pages · ' + kb + ' KB).')
                        : ('تم تحميل ملخص تسليم الوردية (' + meta.pages + ' صفحة · ' + kb + ' KB).'));
                    }
                  }
                });
              } else {
                var cfg = buildHandoverPdfConfig(snapSettings);
                var meta = await root.RGReports.exportArabicPdfDocument(cfg);
                var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
                if (appCtx.toast) appCtx.toast('تم تصدير ملخص تسليم الوردية (' + meta.pages + ' صفحة · ' + kb + ' KB).');
              }
            } catch (err) {
              if (err && err.name === 'AbortError') return;
              if (appCtx.toast) appCtx.toast((err && err.message) || (isEn ? 'Failed to generate Handover PDF.' : 'تعذر إنشاء ملف PDF لتسليم الوردية.'), true);
            }
          };
          if (appCtx.withActionLock) {
            appCtx.withActionLock(previewBtn, 'handover:previewPdf', runPreview);
          } else {
            runPreview();
          }
        });
      }

      var dlBtn = document.getElementById('handover-pdf-download-btn');
      if (dlBtn) {
        dlBtn.addEventListener('click', function () {
          if (!hasAnyVisiblePdfSection()) {
            if (appCtx.toast) appCtx.toast(isEn ? 'Select at least one section to include in PDF.' : 'يرجى تحديد قسم واحد على الأقل لإظهاره في ملف PDF.', true);
            return;
          }
          if (!root.RGReports || !root.RGReports.exportArabicPdfDocument) return;
          var runDl = async function () {
            try {
              var snapSettings = state.pdfCtrl ? state.pdfCtrl.getSettings() : state.pdfSettings;
              var cfg = buildHandoverPdfConfig(snapSettings);
              var meta = await root.RGReports.exportArabicPdfDocument(cfg);
              var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
              if (appCtx.toast) {
                appCtx.toast(isEn
                  ? ('Downloaded Handover PDF (' + meta.pages + ' pages · ' + kb + ' KB).')
                  : ('تم تحميل ملخص تسليم الوردية (' + meta.pages + ' صفحة · ' + kb + ' KB).'));
              }
            } catch (err) {
              if (appCtx.toast) appCtx.toast((err && err.message) || (isEn ? 'Failed to export Handover PDF.' : 'تعذر تصدير ملف PDF.'), true);
            }
          };
          if (appCtx.withActionLock) {
            appCtx.withActionLock(dlBtn, 'handover:downloadPdf', runDl);
          } else {
            runDl();
          }
        });
      }
    }

    async function reloadData(showToast) {
      try {
        var [resResp, prbResp, fuResp, empResp] = await Promise.all([
          root.RGApi.callApi('getReservations', { page: 1, pageSize: 200, silentRefresh: true }),
          root.RGApi.callApi('getProblems', { silentRefresh: true }),
          root.RGApi.callApi('getTeamFollowUps', { silentRefresh: true }),
          root.RGApi.callApi('getEmployees', { silentRefresh: true })
        ]);
        if (activeInstance !== state) return;
        state.loading = false;
        state.dataset = {
          reservations: (resResp && resResp.success && resResp.data && resResp.data.items) || [],
          problems: (prbResp && prbResp.success && prbResp.data && prbResp.data.items) || [],
          followUps: (fuResp && fuResp.success && fuResp.data && fuResp.data.items) || [],
          employees: (empResp && empResp.success && empResp.data && empResp.data.items) || []
        };
        updateDynamicSections();
        if (showToast && appCtx.toast) {
          appCtx.toast(isEn ? 'Shift handover data refreshed.' : 'تم تحديث بيانات تسليم الوردية.');
        }
      } catch (_err) {
        if (activeInstance !== state) return;
        state.loading = false;
        updateDynamicSections();
      }
    }

    renderShell();
    await reloadData(false);
  }

  document.addEventListener('keydown', function (ev) {
    if (!activeInstance || ev.key !== 'Escape') return;
    if (root.RGPdfPreview && root.RGPdfPreview.isOpen && root.RGPdfPreview.isOpen()) return;
    var modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.children.length > 0) return;
    ev.preventDefault();
    closeModal();
  });

  root.RGHandover = {
    openHandoverModal: openHandoverModal,
    closeModal: closeModal
  };
})(window);
