/**
 * RENTAL GATE CRM — Inactive Reservations (Rejected & Cancelled), Actions & National ID Lookup
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

  function formatDateTimeCell(iso, lang) {
    if (!iso) return '-';
    if (root.RGApp && typeof root.RGApp.formatDateTime === 'function') {
      return root.RGApp.formatDateTime(iso, lang) || '-';
    }
    if (root.RGCrmCore && typeof root.RGCrmCore.formatDisplayDateTime === 'function') {
      return root.RGCrmCore.formatDisplayDateTime(iso) || '-';
    }
    return String(iso).replace('T', ' ').substring(0, 16);
  }

  function formatMoney(val, isEn) {
    var num = Number(val || 0);
    if (!isFinite(num)) num = 0;
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 }) + (isEn ? ' SAR' : ' ر.س');
  }

  function statusTagHtml(statusVal) {
    var st = String(statusVal || '-').trim() || '-';
    var cls = 'status-neutral';
    if (['مرفوض', 'مرفوضة', 'تم الرفض', 'ملغي', 'تم الإلغاء', 'ملغى'].indexOf(st) !== -1) {
      cls = 'status-danger';
    } else if (['معلق', 'بانتظار الدفع', 'استرداد جزئي'].indexOf(st) !== -1) {
      cls = 'status-warning';
    } else if (['مسترد', 'تم الاسترداد', 'مكتمل'].indexOf(st) !== -1) {
      cls = 'status-success';
    }
    return '<span class="status-tag ' + cls + '">' + esc(st) + '</span>';
  }

  function getActionLock(btnEl, key, fn, opts) {
    if (root.RGApp && typeof root.RGApp.withActionLock === 'function') {
      return root.RGApp.withActionLock(btnEl, key, fn, opts);
    }
    return Promise.resolve().then(fn);
  }

  function canViewIdNumber(user) {
    var core = root.RGCrmCore;
    if (!user) return false;
    if (core && typeof core.canUserViewCustomerId === 'function') {
      return core.canUserViewCustomerId(user);
    }
    return Boolean(user.role === 'developer' || user.role === 'general_manager');
  }

  function canUseAction(user, actKey) {
    var core = root.RGCrmCore;
    if (!user) return false;
    if (core && typeof core.canUserUseActionButton === 'function') {
      return core.canUserUseActionButton(user, actKey);
    }
    return true;
  }

  function canRejectBookings(_user) {
    return false;
  }

  function canCancelBookings(_user) {
    return false;
  }

  function canRestoreBookings(_user) {
    return false;
  }

  function openRejectModal(_reservation, ctx) {
    var isEn = ctx && ctx.lang === 'en';
    if (ctx && ctx.toast) {
      ctx.toast(isEn ? 'Manual booking rejection is disabled. Statuses are synced from Rental Gate.' : 'تم إيقاف الرفض اليدوي للحجوزات — تتم مزامنة الحالات المرفوضة تلقائياً من Rental Gate.', true);
    }
    return;
  }

  function openCancelModal(_reservation, ctx) {
    var isEn = ctx && ctx.lang === 'en';
    if (ctx && ctx.toast) {
      ctx.toast(isEn ? 'Manual booking cancellation is disabled. Statuses are synced from Rental Gate.' : 'تم إيقاف الإلغاء اليدوي للحجوزات — تتم مزامنة الحجوزات الملغاة تلقائياً من Rental Gate.', true);
    }
    return;
  }

  function openNationalIdLookupModal(ctx, initialQuery) {
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var core = root.RGCrmCore;
    var isEn = ctx && ctx.lang === 'en';
    if (!canViewIdNumber(user) || !canUseAction(user, 'act_customer_id_lookup')) {
      if (ctx && ctx.toast) {
        ctx.toast(isEn ? 'FORBIDDEN: You are not authorized to view customer National ID numbers.' : 'غير مصرح: ليس لديك صلاحية البحث برقم الهوية الوطنية أو الاطلاع عليها.', true);
      }
      return;
    }

    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;

    var curQuery = String(initialQuery || '').trim();
    var lastData = null;
    var lastError = '';
    var isLoading = false;

    function bindLookupResultButtons(scopeEl) {
      if (!scopeEl) return;
      scopeEl.querySelectorAll('.rg-id-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-res-id');
          if (!rid || !root.RGReservations || typeof root.RGReservations.openReservationDrawer !== 'function') return;
          root.RGReservations.openReservationDrawer(rid, ctx, [], null, {
            backLabel: isEn ? 'Back to ID Lookup' : 'العودة لنتائج بحث الهوية',
            onBack: function () {
              openNationalIdLookupModal(ctx, curQuery);
            }
          });
        });
      });
    }

    function updateLookupBody() {
      var bodyEl = document.getElementById('rg-id-lookup-body');
      var submitBtn = document.getElementById('rg-id-lookup-submit');
      if (submitBtn) {
        submitBtn.disabled = isLoading;
        submitBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        submitBtn.textContent = isLoading ? (isEn ? 'Searching...' : 'جاري البحث...') : (isEn ? 'Search ID' : 'بحث برقم الهوية');
      }
      if (!bodyEl) {
        drawLookupModal();
        return;
      }
      bodyEl.innerHTML = buildLookupBodyHtml();
      bindLookupResultButtons(bodyEl);
    }

    function drawLookupModal() {
      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="rg-id-lookup-backdrop" role="dialog" aria-modal="true" aria-labelledby="rg-id-lookup-title">' +
          '<div class="modal-panel" style="max-width:840px;">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title" id="rg-id-lookup-title">' + (isEn ? 'Customer Lookup by National ID' : 'البحث عن عميل برقم الهوية الوطنية') + '</h3>' +
                '<div class="meta-inline"><span>' + (isEn ? 'Supports Arabic & English digits · Deduplicated customer profile with all active & inactive bookings' : 'يدعم الأرقام العربية والإنجليزية · عرض ملف عميل واحد موحد مع جميع حجوزاته النشطة وغير الفعالة') + '</span></div>' +
              '</div>' +
              '<button type="button" class="btn btn-sm" id="rg-id-lookup-close" data-modal-close>' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
            '</div>' +
            '<form id="rg-id-lookup-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">' +
              '<input type="search" class="input mono" id="rg-id-lookup-input" style="flex:1;min-width:220px;" dir="ltr" value="' + esc(curQuery) + '" placeholder="' + (isEn ? 'Enter National ID (e.g. 1067231845)...' : 'أدخل رقم الهوية الوطنية أو جزء منه (4 أرقام فأكثر)...') + '">' +
              '<button type="submit" class="btn btn-charcoal" id="rg-id-lookup-submit"' + (isLoading ? ' disabled aria-busy="true"' : '') + '>' + (isLoading ? (isEn ? 'Searching...' : 'جاري البحث...') : (isEn ? 'Search ID' : 'بحث برقم الهوية')) + '</button>' +
            '</form>' +
            '<div id="rg-id-lookup-body">' + buildLookupBodyHtml() + '</div>' +
          '</div>' +
        '</div>';

      var closeMe = function () { modalRoot.innerHTML = ''; };
      var backdrop = document.getElementById('rg-id-lookup-backdrop');
      if (backdrop) {
        backdrop.addEventListener('click', function (ev) {
          if (ev.target === backdrop) closeMe();
        });
      }
      var cBtn = document.getElementById('rg-id-lookup-close');
      if (cBtn) cBtn.addEventListener('click', closeMe);

      var formEl = document.getElementById('rg-id-lookup-form');
      var inpEl = document.getElementById('rg-id-lookup-input');
      if (inpEl) {
        setTimeout(function () { try { inpEl.focus(); } catch (_e) {} }, 20);
      }
      if (formEl) {
        formEl.addEventListener('submit', function (ev) {
          ev.preventDefault();
          curQuery = inpEl ? String(inpEl.value || '').trim() : '';
          executeLookup();
        });
      }

      bindLookupResultButtons(modalRoot);
    }

    function buildLookupBodyHtml() {
      if (isLoading) {
        return '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line md"></div></div>';
      }
      if (lastError) {
        return '<div class="rg-error-banner" role="alert"><div class="rg-error-banner-body"><div class="rg-error-banner-msg">' + esc(lastError) + '</div></div></div>';
      }
      if (!lastData) {
        return '<div class="empty-state" style="padding:26px;">' + (isEn ? 'Enter at least 4 digits of a National ID number to look up the customer profile and all reservations.' : 'أدخل 4 أرقام على الأقل من رقم الهوية الوطنية لاسترجاع ملف العميل الموحد وجميع حجوزاته.') + '</div>';
      }
      var customers = Array.isArray(lastData.customers) ? lastData.customers : [];
      var bookings = Array.isArray(lastData.reservations) ? lastData.reservations : [];
      if (customers.length === 0 && bookings.length === 0) {
        return '<div class="empty-state" style="padding:28px;">' +
          (isEn ? 'No customer or reservations found matching National ID: ' : 'لا توجد نتائج مطابقة لرقم الهوية: ') +
          '<strong class="mono" dir="ltr">' + esc(lastData.query || curQuery) + '</strong>' +
        '</div>';
      }

      return customers.map(function (cust) {
        var custBookings = Array.isArray(cust.reservations) ? cust.reservations : bookings;
        return '<div class="glass-subcard" style="padding:14px;margin-bottom:12px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
            '<div>' +
              '<div style="font-size:15px;font-weight:700;color:var(--text-primary);"><button type="button" class="rg-customer-link" data-cust-id="' + esc(cust.customerId || '') + '" data-res-id="' + esc((custBookings[0] && custBookings[0].id) || '') + '" data-phone="' + esc(cust.customerPhone || '') + '">' + esc(cust.customerName || '-') + '</button></div>' +
              '<div class="meta-inline">' +
                '<span>' + (isEn ? 'ID:' : 'رقم الهوية:') + ' <strong class="mono" dir="ltr">' + esc(cust.customerIdNumber || '-') + '</strong></span>' +
                (cust.customerPhone ? '<span>·</span><span class="mono" dir="ltr">' + esc(cust.customerPhone) + '</span>' : '') +
                (cust.customerEmail ? '<span>·</span><span class="mono" dir="ltr">' + esc(cust.customerEmail) + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
              '<span class="status-tag status-info tabular-nums">' + (isEn ? 'Total:' : 'الإجمالي:') + ' ' + Number(cust.totalBookings || custBookings.length) + '</span>' +
              '<span class="status-tag status-success tabular-nums">' + (isEn ? 'Active:' : 'النشطة:') + ' ' + Number(cust.activeCount || 0) + '</span>' +
              '<span class="status-tag status-danger tabular-nums">' + (isEn ? 'Inactive:' : 'غير الفعالة:') + ' ' + Number(cust.inactiveCount || 0) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>' + (isEn ? 'Booking #' : 'رقم الحجز') + '</th>' +
            '<th>' + (isEn ? 'Company / Car' : 'الشركة / السيارة') + '</th>' +
            '<th>' + (isEn ? 'Dates' : 'التواريخ') + '</th>' +
            '<th>' + (isEn ? 'Lifecycle & Status' : 'التصنيف والحالة') + '</th>' +
            '<th>' + (isEn ? 'Notes / Reason' : 'السبب / الملاحظة') + '</th>' +
            '<th>' + (isEn ? 'Details' : 'التفاصيل') + '</th>' +
          '</tr></thead><tbody>' +
            custBookings.map(function (b) {
              var lc = (core && core.getReservationLifecycleKind) ? core.getReservationLifecycleKind(b) : 'active';
              var lcBadge = lc === 'rejected'
                ? '<span class="status-tag status-danger">' + (isEn ? 'Rejected' : 'مرفوض') + '</span>'
                : (lc === 'cancelled'
                    ? '<span class="status-tag status-warning">' + (isEn ? 'Cancelled' : 'ملغي') + '</span>'
                    : '<span class="status-tag status-success">' + (isEn ? 'Active' : 'نشط') + '</span>');
              var cleanReasonFn = (core && core.sanitizeReasonText) ? core.sanitizeReasonText : function (v) { return String(v || '').trim(); };
              var emptyReasonHint = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
              var reasonTxt = lc === 'rejected'
                ? (cleanReasonFn(b.rejectionReason) || emptyReasonHint)
                : (lc === 'cancelled' ? (cleanReasonFn(b.cancellationReason) || emptyReasonHint) : (b.lastUpdateText || '-'));
              return '<tr>' +
                '<td class="mono" dir="ltr"><strong>' + esc(b.reservationNumber || b.id) + '</strong></td>' +
                '<td><div>' + esc(b.companyName || '-') + '</div><div class="cell-sub">' + esc(b.carName || '-') + '</div></td>' +
                '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc(String(b.startDate || '-').substring(0, 10)) + ' → ' + esc(String(b.endDate || '-').substring(0, 10)) + '</td>' +
                '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + lcBadge + statusTagHtml(b.internalStatus || b.originalStatusAr) + '</div></td>' +
                '<td>' + esc(reasonTxt) + '</td>' +
                '<td><button type="button" class="btn btn-sm btn-primary rg-id-open-res" data-res-id="' + esc(b.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button></td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>' +
        '</div>';
      }).join('');
    }

    async function executeLookup() {
      var norm = core && core.normalizeNationalId ? core.normalizeNationalId(curQuery) : curQuery.replace(/\D/g, '');
      if (!norm || norm.length < 4) {
        lastError = isEn ? 'Please enter at least 4 digits of a National ID number.' : 'يرجى إدخال 4 أرقام على الأقل من رقم الهوية للبحث.';
        lastData = null;
        updateLookupBody();
        return;
      }
      isLoading = true;
      lastError = '';
      updateLookupBody();
      var resp = await root.RGApi.callApi('searchCustomerByNationalId', { nationalId: norm, forceRefresh: true });
      isLoading = false;
      if (!resp || !resp.success) {
        lastError = (resp && resp.message) || (isEn ? 'Failed to search National ID.' : 'تعذر تنفيذ البحث برقم الهوية.');
        lastData = null;
      } else {
        lastData = resp.data || { customers: [], reservations: [], totalMatches: 0, query: norm };
      }
      updateLookupBody();
    }

    drawLookupModal();
    if (curQuery) {
      executeLookup();
    }
  }

  function buildPageNumbers(curPage, totalPages) {
    var pages = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (curPage > 3) pages.push('...');
    var start = Math.max(2, curPage - 1);
    var end = Math.min(totalPages - 1, curPage + 1);
    for (var j = start; j <= end; j++) pages.push(j);
    if (curPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  }

  function renderRejectedPanel(hostEl, ctx, opts) {
    if (!hostEl) return;
    var options = opts || {};
    var mode = options.mode === 'cancelled' ? 'cancelled' : 'rejected';
    var isCancelled = mode === 'cancelled';
    var isEn = ctx && ctx.lang === 'en';
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var core = root.RGCrmCore;

    var state = Object.assign({
      search: '',
      reservationNumber: '',
      companyNumber: '',
      company: '',
      newCompanyName: '',
      status: '',
      reason: '',
      dateFrom: '',
      dateTo: '',
      actionBy: '',
      filtersExpanded: false,
      expandedIds: {},
      page: 1,
      pageSize: 10
    }, options.state || {});

    var currentItems = [];
    var currentTotal = 0;
    var currentTotalPages = 1;
    var currentFacets = { companies: [], newCompanies: [], reasons: [], statuses: [], employees: [] };
    var fetchSeq = 0;
    var searchDebounce = null;

    var canExport = canUseAction(user, 'act_export_excel');
    var canExportPdf = canUseAction(user, 'act_export_pdf');
    var canRestore = false;
    var allowIdView = canViewIdNumber(user);

    var reasonOptionsBase = isCancelled
      ? ((core && core.CANCELLATION_REASONS_LIST) || [])
      : ((core && core.REJECTION_REASONS_LIST) || []);
    var statusOptionsBase = isCancelled
      ? ((core && core.CANCELLED_STATUS_VALUES) || ['تم الإلغاء', 'ملغي'])
      : ((core && core.REJECTED_STATUS_VALUES) || ['مرفوض', 'مرفوضة', 'تم الرفض']);

    function buildQueryPayload(extra) {
      return Object.assign({
        subTab: mode,
        lifecycle: mode,
        search: state.search || '',
        reservationNumber: state.reservationNumber || '',
        companyNumber: state.companyNumber || '',
        company: state.company || '',
        newCompanyName: state.newCompanyName || '',
        status: state.status || '',
        rejectionReason: !isCancelled ? (state.reason || '') : '',
        cancellationReason: isCancelled ? (state.reason || '') : '',
        dateFrom: state.dateFrom || '',
        dateTo: state.dateTo || '',
        actionBy: state.actionBy || '',
        page: state.page || 1,
        pageSize: state.pageSize || 10,
        abortKey: 'inactive:' + mode
      }, extra || {});
    }

    function renderShell() {
      var reasonLbl = isCancelled ? (isEn ? 'Cancellation Reason' : 'سبب الإلغاء') : (isEn ? 'Rejection Reason' : 'سبب الرفض');
      hostEl.innerHTML =
        '<div class="rg-inactive-panel" data-inactive-mode="' + esc(mode) + '">' +
          '<div class="rg-inactive-toolbar">' +
            '<div class="rg-inactive-toolbar-filters">' +
              '<button type="button" class="btn rg-inactive-filter-toggle' + (state.filtersExpanded ? ' is-open' : '') + '" id="inact-toggle-filters">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>' +
                '<span>' + (isEn ? 'Filters' : 'تصفية') + '</span>' +
              '</button>' +
              '<div class="rg-inactive-field">' +
                '<span class="rg-inactive-field-lbl">' + (isEn ? 'Quick Search' : 'بحث شامل') + '</span>' +
                '<input type="search" class="input rg-inactive-inp" id="inact-f-search" value="' + esc(state.search) + '" placeholder="' + (isEn ? (allowIdView ? 'Name, ID, phone, car...' : 'Name, phone, car...') : (allowIdView ? 'الاسم، الهوية، الجوال، السيارة' : 'الاسم، الجوال، السيارة')) + '">' +
              '</div>' +
              '<div class="rg-inactive-field">' +
                '<span class="rg-inactive-field-lbl">' + (isEn ? 'Booking #' : 'رقم الحجز') + '</span>' +
                '<input type="search" class="input mono rg-inactive-inp" id="inact-f-resnum" value="' + esc(state.reservationNumber) + '" placeholder="' + (isEn ? 'Booking #...' : 'رقم الحجز') + '">' +
              '</div>' +
              '<div class="rg-inactive-field">' +
                '<span class="rg-inactive-field-lbl">' + (isEn ? 'Company #' : 'رقم الشركة') + '</span>' +
                '<input type="search" class="input mono rg-inactive-inp" id="inact-f-cmpnum" value="' + esc(state.companyNumber) + '" placeholder="' + (isEn ? 'Company #...' : 'رقم الشركة') + '">' +
              '</div>' +
              '<div class="rg-inactive-field">' +
                '<span class="rg-inactive-field-lbl">' + (isEn ? 'Old Company' : 'اسم الشركة القديمة') + '</span>' +
                '<input type="search" class="input rg-inactive-inp" id="inact-f-oldcmp" value="' + esc(state.company) + '" placeholder="' + (isEn ? 'Old company...' : 'الشركة القديمة') + '">' +
              '</div>' +
              '<div class="rg-inactive-field">' +
                '<span class="rg-inactive-field-lbl">' + (isEn ? 'New Company' : 'اسم الشركة الجديدة') + '</span>' +
                '<input type="search" class="input rg-inactive-inp" id="inact-f-newcmp" value="' + esc(state.newCompanyName) + '" placeholder="' + (isEn ? 'New company...' : 'الشركة الجديدة') + '">' +
              '</div>' +
              '<button type="button" class="btn btn-charcoal rg-inactive-search-btn" id="inact-search-btn">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
                '<span>' + (isEn ? 'Search' : 'بحث') + '</span>' +
              '</button>' +
              '<button type="button" class="btn btn-sm" id="inact-reset-btn">' + (isEn ? 'Reset' : 'إعادة ضبط') + '</button>' +
            '</div>' +
            '<div class="rg-inactive-toolbar-actions">' +
              '<button type="button" class="btn rg-inactive-refresh-btn" id="inact-refresh-btn">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' +
                '<span>' + (isEn ? 'Refresh' : 'تحديث') + '</span>' +
              '</button>' +
              ((root.RGExportMenu && (canExportPdf || canExport))
                ? root.RGExportMenu.renderHtml({
                    wrapId: 'inact-export-wrap',
                    btnId: 'inact-export-btn-menu',
                    canPdf: canExportPdf,
                    canExcel: canExport,
                    lang: ctx.lang
                  })
                : ((canExportPdf ? '<button type="button" class="btn btn-primary" id="inact-export-pdf"><span>' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</span></button>' : '') +
                   (canExport ? '<button type="button" class="btn btn-charcoal rg-ui-res-export-btn" id="inact-export-btn"><span>' + (isEn ? 'Export Excel' : 'تصدير Excel') + '</span></button>' : ''))) +
            '</div>' +
          '</div>' +
          '<div class="rg-inactive-adv-filters' + (state.filtersExpanded ? '' : ' hidden') + '" id="inact-adv-filters">' +
            '<div class="form-group" style="margin:0;">' +
              '<label class="form-label" for="inact-f-status">' + (isEn ? 'Booking Status' : 'حالة الحجز') + '</label>' +
              '<select class="select" id="inact-f-status"><option value="">' + (isEn ? 'All Statuses' : 'جميع الحالات') + '</option></select>' +
            '</div>' +
            '<div class="form-group" style="margin:0;">' +
              '<label class="form-label" for="inact-f-reason">' + reasonLbl + '</label>' +
              '<select class="select" id="inact-f-reason"><option value="">' + (isEn ? 'All Reasons' : 'جميع الأسباب') + '</option></select>' +
            '</div>' +
            '<div class="form-group" style="margin:0;">' +
              '<label class="form-label" for="inact-f-from">' + (isEn ? 'From Date' : 'من تاريخ') + '</label>' +
              '<input type="date" class="input" id="inact-f-from" value="' + esc(state.dateFrom) + '">' +
            '</div>' +
            '<div class="form-group" style="margin:0;">' +
              '<label class="form-label" for="inact-f-to">' + (isEn ? 'To Date' : 'إلى تاريخ') + '</label>' +
              '<input type="date" class="input" id="inact-f-to" value="' + esc(state.dateTo) + '">' +
            '</div>' +
            '<div class="form-group" style="margin:0;">' +
              '<label class="form-label" for="inact-f-emp">' + (isEn ? 'Confirmed By' : 'الموظف المسؤول') + '</label>' +
              '<select class="select" id="inact-f-emp"><option value="">' + (isEn ? 'All Employees' : 'جميع الموظفين') + '</option></select>' +
            '</div>' +
          '</div>' +
          '<div id="inact-table-host">' +
            '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>' +
          '</div>' +
        '</div>';

      bindToolbarEvents();
    }

    function syncDropdownOptions() {
      var stSel = hostEl.querySelector('#inact-f-status');
      if (stSel) {
        var stSet = {};
        statusOptionsBase.concat(currentFacets.statuses || []).forEach(function (s) { if (s) stSet[s] = true; });
        if (state.status) stSet[state.status] = true;
        stSel.innerHTML = '<option value="">' + (isEn ? 'All Statuses' : 'جميع الحالات') + '</option>' +
          Object.keys(stSet).map(function (s) {
            return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
          }).join('');
      }
      var rsSel = hostEl.querySelector('#inact-f-reason');
      if (rsSel) {
        var rsSet = {};
        reasonOptionsBase.concat(currentFacets.reasons || []).forEach(function (r) { if (r) rsSet[r] = true; });
        if (state.reason) rsSet[state.reason] = true;
        rsSel.innerHTML = '<option value="">' + (isEn ? 'All Reasons' : 'جميع الأسباب') + '</option>' +
          Object.keys(rsSet).map(function (r) {
            return '<option value="' + esc(r) + '"' + (state.reason === r ? ' selected' : '') + '>' + esc(r) + '</option>';
          }).join('');
      }
      var empSel = hostEl.querySelector('#inact-f-emp');
      if (empSel) {
        var empSet = {};
        (currentFacets.employees || []).forEach(function (e) { if (e) empSet[e] = true; });
        if (state.actionBy) empSet[state.actionBy] = true;
        empSel.innerHTML = '<option value="">' + (isEn ? 'All Employees' : 'جميع الموظفين') + '</option>' +
          Object.keys(empSet).sort().map(function (e) {
            return '<option value="' + esc(e) + '"' + (state.actionBy === e ? ' selected' : '') + '>' + esc(e) + '</option>';
          }).join('');
      }
    }

    function syncFilterInputsFromDom() {
      var v = function (sel) {
        var el = hostEl.querySelector(sel);
        return el ? String(el.value || '').trim() : '';
      };
      state.search = v('#inact-f-search');
      state.reservationNumber = v('#inact-f-resnum');
      state.companyNumber = v('#inact-f-cmpnum');
      state.company = v('#inact-f-oldcmp');
      state.newCompanyName = v('#inact-f-newcmp');
      state.status = v('#inact-f-status');
      state.reason = v('#inact-f-reason');
      state.dateFrom = v('#inact-f-from');
      state.dateTo = v('#inact-f-to');
      state.actionBy = v('#inact-f-emp');
    }

    function paintTable(errorMsg) {
      var tblHost = hostEl.querySelector('#inact-table-host');
      if (!tblHost) return;
      if (errorMsg) {
        tblHost.innerHTML =
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body"><div class="rg-error-banner-msg">' + esc(errorMsg) + '</div></div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="inact-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
          '</div>';
        var rBtn = tblHost.querySelector('#inact-retry-btn');
        if (rBtn) rBtn.addEventListener('click', function () { loadData({ forceRefresh: true }); });
        return;
      }

      var reasonHdr = isCancelled ? (isEn ? 'Cancellation Reason' : 'سبب الإلغاء') : (isEn ? 'Rejection Reason' : 'سبب الرفض');
      var dateHdr = isCancelled ? (isEn ? 'Cancelled At' : 'تاريخ الإلغاء') : (isEn ? 'Rejected At' : 'تاريخ الرفض');
      var tableColCount = allowIdView ? 12 : 11;

      var rowsHtml = currentItems.length === 0
        ? '<tr><td colspan="' + tableColCount + '"><div class="empty-state" style="padding:30px;">' +
            (isCancelled
              ? (isEn ? 'No cancelled reservations match the current filters.' : 'لا توجد حجوزات ملغاة مطابقة للفلاتر الحالية.')
              : (isEn ? 'No rejected reservations match the current filters.' : 'لا توجد حجوزات مرفوضة مطابقة للفلاتر الحالية.')) +
          '</div></td></tr>'
        : currentItems.map(function (r) {
            var isOpen = Boolean(state.expandedIds[r.id]);
            var sanitizeInactReason = function (val) {
              if (core && typeof core.sanitizeReasonText === 'function') {
                return core.sanitizeReasonText(val);
              }
              var s = String(val || '').trim();
              if (!s || s === '-' || s === '—' || s === 'غير متاح' || s === 'غير محدد' || /^(n\/a|na|null|undefined|none)$/i.test(s)) return '';
              return s;
            };
            var reasonVal = isCancelled
              ? sanitizeInactReason(r.cancellationReason)
              : sanitizeInactReason(r.rejectionReason);
            if (!reasonVal && r.rawJson && String(r.rawJson).trim().charAt(0) === '{' && core) {
              try {
                var parsedRawRow = JSON.parse(String(r.rawJson));
                reasonVal = isCancelled
                  ? (core.extractCancellationReason ? core.extractCancellationReason(parsedRawRow, null) : '')
                  : (core.extractRejectionReason ? core.extractRejectionReason(parsedRawRow, null) : '');
              } catch (_rawErr) {}
            }
            var emptyReasonText = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
            var actorVal = isCancelled
              ? (r.cancelledByName || r.lastUpdatedByName || '-')
              : (r.rejectedByName || r.lastUpdatedByName || '-');
            var actionAtVal = isCancelled
              ? (r.cancelledAt || r.lastUpdatedAt || r.updatedAt)
              : (r.rejectedAt || r.lastUpdatedAt || r.updatedAt);

            var mainRow =
              '<tr data-inact-row="' + esc(r.id) + '" class="' + (isOpen ? 'is-expanded-parent' : '') + '">' +
                '<td class="mono cell-res-num" style="white-space:nowrap;">' +
                  '<div class="rg-inact-resnum-cell">' +
                    '<button type="button" class="rg-expand-circle-btn inact-toggle-row" data-id="' + esc(r.id) + '" aria-expanded="' + String(isOpen) + '" title="' + (isEn ? 'Expand Details' : 'عرض التفاصيل السريعة') + '">' + (isOpen ? '−' : '+') + '</button>' +
                    '<button type="button" class="btn-link-inline rg-inact-resnum-link inact-open-drawer" data-id="' + esc(r.id) + '" dir="ltr">' + esc(r.reservationNumber || r.id) + '</button>' +
                  '</div>' +
                '</td>' +
                '<td>' +
                  '<div class="cell-primary"><button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName || '-') + '</button></div>' +
                  (r.customerPhone ? '<div class="cell-sub mono" dir="ltr">' + esc(r.customerPhone) + '</div>' : '') +
                '</td>' +
                (allowIdView ? '<td class="mono" dir="ltr" style="white-space:nowrap;">' + esc(r.customerIdNumber || '-') + '</td>' : '') +
                '<td>' +
                  '<div class="cell-primary">' + esc(r.companyName || '-') + '</div>' +
                  (r.companyNumber ? '<div class="cell-sub mono" dir="ltr">#' + esc(r.companyNumber) + '</div>' : '') +
                '</td>' +
                '<td>' + esc(sanitizeInactReason(r.newCompanyName) || (isEn ? 'Not transferred' : 'لم يتم التحويل')) + '</td>' +
                '<td><span class="rg-inact-reason-txt"' + (reasonVal ? '' : ' style="color:var(--text-muted);font-size:12px;"') + '>' + esc(reasonVal || emptyReasonText) + '</span></td>' +
                '<td>' + statusTagHtml(r.internalStatus || r.originalStatusAr) + '</td>' +
                '<td>' + esc(r.carStatusAtRequest || r.originalStatusAr || '-') + '</td>' +
                '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc(formatMoney(r.refundAmount || 0, isEn)) + '</td>' +
                '<td>' + esc(actorVal) + '</td>' +
                '<td class="mono tabular-nums" style="min-width:84px;line-height:1.35;">' + esc(formatDateTimeCell(actionAtVal, ctx && ctx.lang)) + '</td>' +
                '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap;">' +
                  '<button type="button" class="btn btn-sm btn-primary inact-open-drawer" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                '</div></td>' +
              '</tr>';

            var detailRow = isOpen
              ? ('<tr class="rg-inact-detail-subrow" data-inact-detail="' + esc(r.id) + '"><td colspan="' + tableColCount + '">' +
                  '<div class="rg-inact-subdetail-grid">' +
                    '<div><span class="detail-k">' + (isEn ? 'Vehicle & Plate' : 'المركبة واللوحة') + ':</span> <span class="detail-v">' + esc(r.carName || '-') + (r.plateNumber ? ' (' + esc(r.plateNumber) + ')' : '') + '</span></div>' +
                    '<div><span class="detail-k">' + (isEn ? 'Branch' : 'الفرع') + ':</span> <span class="detail-v">' + esc(r.branchName || '-') + '</span></div>' +
                    '<div><span class="detail-k">' + (isEn ? 'Booking Period' : 'فترة الحجز') + ':</span> <span class="detail-v mono" dir="ltr">' + esc(String(r.startDate || '-').substring(0, 10)) + ' → ' + esc(String(r.endDate || '-').substring(0, 10)) + '</span></div>' +
                    '<div><span class="detail-k">' + (isEn ? 'Original Total' : 'إجمالي الحجز') + ':</span> <span class="detail-v tabular-nums">' + esc(formatMoney(r.totalAmount || 0, isEn)) + '</span></div>' +
                    (allowIdView && r.customerIdNumber
                      ? '<div><span class="detail-k">' + (isEn ? 'National ID' : 'رقم الهوية') + ':</span> <span class="detail-v mono" dir="ltr">' + esc(r.customerIdNumber) + '</span></div>'
                      : '') +
                    '<div style="grid-column:1 / -1;"><span class="detail-k">' + (isEn ? 'Audit Summary' : 'آخر تحديث وسجل الإجراء') + ':</span> <span class="detail-v">' + esc(r.lastUpdateText || '-') + '</span></div>' +
                  '</div>' +
                '</td></tr>')
              : '';

            return mainRow + detailRow;
          }).join('');

      var pageNums = buildPageNumbers(state.page, currentTotalPages);
      var pagesHtml = pageNums.map(function (p) {
        if (p === '...') return '<span class="rg-page-ellipsis">…</span>';
        return '<button type="button" class="rg-page-btn' + (p === state.page ? ' is-active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }).join('');

      tblHost.innerHTML =
        '<div class="table-wrap rg-inactive-table-wrap">' +
          '<table class="data-table has-sticky-actions rg-inactive-table">' +
            '<thead><tr>' +
              '<th>' + (isEn ? 'Booking #' : 'رقم الحجز') + '</th>' +
              '<th>' + (isEn ? 'Customer' : 'العميل والجوال') + '</th>' +
              (allowIdView ? '<th>' + (isEn ? 'National ID' : 'رقم الهوية') + '</th>' : '') +
              '<th>' + (isEn ? 'Company' : 'الشركة') + '</th>' +
              '<th>' + (isEn ? 'New Company' : 'الشركة الجديدة') + '</th>' +
              '<th>' + reasonHdr + '</th>' +
              '<th>' + (isEn ? 'Status' : 'حالة الحجز') + '</th>' +
              '<th>' + (isEn ? 'Car Status' : 'حالة السيارة') + '</th>' +
              '<th>' + (isEn ? 'Refund' : 'الاسترداد') + '</th>' +
              '<th>' + (isEn ? 'Confirmed By' : 'الموظف المسؤول') + '</th>' +
              '<th>' + dateHdr + '</th>' +
              '<th>' + (isEn ? 'Actions' : 'الإجراءات') + '</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="rg-inactive-pagination">' +
          '<div class="rg-inactive-total-label">' + (isEn ? 'Total' : 'إجمالي') + ' <strong class="tabular-nums">' + currentTotal + '</strong> ' + (isEn ? 'items' : 'عنصر') + '</div>' +
          '<div class="rg-inactive-pages-group">' +
            '<button type="button" class="rg-page-btn" id="inact-page-prev"' + (state.page <= 1 ? ' disabled' : '') + '>‹</button>' +
            pagesHtml +
            '<button type="button" class="rg-page-btn" id="inact-page-next"' + (state.page >= currentTotalPages ? ' disabled' : '') + '>›</button>' +
            '<select class="select rg-page-size-sel" id="inact-page-size" aria-label="' + (isEn ? 'Rows per page' : 'عدد الصفوف') + '">' +
              [10, 20, 50].map(function (sz) {
                return '<option value="' + sz + '"' + (Number(state.pageSize) === sz ? ' selected' : '') + '>' + sz + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
        '</div>';

      bindTableEvents(tblHost);
    }

    function bindTableEvents(tblHost) {
      tblHost.querySelectorAll('.inact-toggle-row').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          state.expandedIds[id] = !state.expandedIds[id];
          paintTable();
        });
      });

      tblHost.querySelectorAll('.inact-open-drawer').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          if (id && root.RGReservations && typeof root.RGReservations.openReservationDrawer === 'function') {
            root.RGReservations.openReservationDrawer(id, ctx, [], function () {
              loadData({ forceRefresh: true, silentRefresh: true });
            });
          }
        });
      });

      var prevBtn = tblHost.querySelector('#inact-page-prev');
      var nextBtn = tblHost.querySelector('#inact-page-next');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (state.page > 1) { state.page -= 1; loadData(); }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (state.page < currentTotalPages) { state.page += 1; loadData(); }
        });
      }
      tblHost.querySelectorAll('.rg-page-btn[data-page]').forEach(function (pBtn) {
        pBtn.addEventListener('click', function () {
          var targetP = Number(pBtn.getAttribute('data-page') || 1);
          if (targetP && targetP !== state.page) {
            state.page = targetP;
            loadData();
          }
        });
      });
      var psSel = tblHost.querySelector('#inact-page-size');
      if (psSel) {
        psSel.addEventListener('change', function () {
          state.pageSize = Math.max(1, Number(psSel.value || 10));
          state.page = 1;
          loadData();
        });
      }
    }

    function bindToolbarEvents() {
      var togBtn = hostEl.querySelector('#inact-toggle-filters');
      var advPanel = hostEl.querySelector('#inact-adv-filters');
      if (togBtn && advPanel) {
        togBtn.addEventListener('click', function () {
          state.filtersExpanded = !state.filtersExpanded;
          advPanel.classList.toggle('hidden', !state.filtersExpanded);
          togBtn.classList.toggle('is-open', state.filtersExpanded);
        });
      }

      var searchBtn = hostEl.querySelector('#inact-search-btn');
      if (searchBtn) {
        searchBtn.addEventListener('click', function () {
          syncFilterInputsFromDom();
          state.page = 1;
          loadData({ forceRefresh: true });
        });
      }

      var resetBtn = hostEl.querySelector('#inact-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          state.search = '';
          state.reservationNumber = '';
          state.companyNumber = '';
          state.company = '';
          state.newCompanyName = '';
          state.status = '';
          state.reason = '';
          state.dateFrom = '';
          state.dateTo = '';
          state.actionBy = '';
          state.page = 1;
          ['#inact-f-search', '#inact-f-resnum', '#inact-f-cmpnum', '#inact-f-oldcmp', '#inact-f-newcmp', '#inact-f-status', '#inact-f-reason', '#inact-f-from', '#inact-f-to', '#inact-f-emp'].forEach(function (sel) {
            var el = hostEl.querySelector(sel);
            if (el) el.value = '';
          });
          loadData({ forceRefresh: true });
        });
      }

      var refreshBtn = hostEl.querySelector('#inact-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          syncFilterInputsFromDom();
          loadData({ forceRefresh: true, showToast: true });
        });
      }

      async function triggerInactiveExcelExport() {
        var reasonCol = isCancelled
          ? { key: 'cancellationReason', label: isEn ? 'Cancellation Reason' : 'سبب الإلغاء' }
          : { key: 'rejectionReason', label: isEn ? 'Rejection Reason' : 'سبب الرفض' };
        var actorCol = isCancelled
          ? { key: 'cancelledByName', label: isEn ? 'Confirmed By' : 'الموظف الذي أكد الإجراء' }
          : { key: 'rejectedByName', label: isEn ? 'Confirmed By' : 'الموظف الذي أكد الإجراء' };
        var dateCol = isCancelled
          ? { key: 'cancelledAt', label: isEn ? 'Cancellation Date' : 'تاريخ ووقت الإلغاء', formatType: 'datetime' }
          : { key: 'rejectedAt', label: isEn ? 'Rejection Date' : 'تاريخ ووقت الرفض', formatType: 'datetime' };
        var headers = [
          { key: 'reservationNumber', label: isEn ? 'Booking #' : 'رقم الحجز', formatType: 'ltr' },
          { key: 'customerName', label: isEn ? 'Customer Name' : 'اسم العميل' }
        ];
        if (allowIdView) {
          headers.push({ key: 'customerIdNumber', label: isEn ? 'National ID' : 'رقم الهوية', formatType: 'ltr' });
        }
        headers = headers.concat([
          { key: 'customerPhone', label: isEn ? 'Phone' : 'رقم الجوال', formatType: 'ltr' },
          { key: 'companyName', label: isEn ? 'Company' : 'الشركة' },
          { key: 'newCompanyName', label: isEn ? 'New Company' : 'الشركة الجديدة' },
          reasonCol,
          { key: 'internalStatus', label: isEn ? 'Status' : 'حالة الحجز' },
          { key: 'carStatusAtRequest', label: isEn ? 'Car Status at Request' : 'حالة حجز السيارة عند الطلب' },
          { key: 'refundAmount', label: isEn ? 'Refund Amount' : 'مبلغ الاسترداد', formatType: 'number', summable: true },
          actorCol,
          dateCol
        ]);
        if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') {
          if (ctx && ctx.toast) ctx.toast(isEn ? 'Excel export is unavailable.' : 'وحدة تصدير Excel غير متاحة.', true);
          return;
        }
        var emptyReasonExp = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
        var exportRows = currentItems.map(function (row) {
          var copy = Object.assign({}, row);
          if (isCancelled) {
            copy.cancellationReason = (core && core.sanitizeReasonText ? core.sanitizeReasonText(copy.cancellationReason) : String(copy.cancellationReason || '').trim()) || emptyReasonExp;
          } else {
            copy.rejectionReason = (core && core.sanitizeReasonText ? core.sanitizeReasonText(copy.rejectionReason) : String(copy.rejectionReason || '').trim()) || emptyReasonExp;
          }
          return copy;
        });
        var repTitle = isCancelled
          ? (isEn ? 'Cancelled Reservations Report' : 'تقرير الحجوزات الملغاة')
          : (isEn ? 'Rejected Reservations Report' : 'تقرير الحجوزات المرفوضة');
        var periodTxt = (state.dateFrom || state.dateTo)
          ? ((state.dateFrom || '...') + ' → ' + (state.dateTo || '...'))
          : (isEn ? 'All Dates / Active View' : 'كافة التواريخ / العرض الحالي');
        var activeFiltersList = [
          state.company ? ((isEn ? 'Company: ' : 'الشركة: ') + state.company) : '',
          state.newCompanyName ? ((isEn ? 'New Company: ' : 'الشركة الجديدة: ') + state.newCompanyName) : '',
          state.status ? ((isEn ? 'Status: ' : 'الحالة: ') + state.status) : '',
          state.reason ? ((isEn ? 'Reason: ' : 'السبب: ') + state.reason) : '',
          state.search ? ((isEn ? 'Search: ' : 'البحث: ') + state.search) : ''
        ].filter(Boolean).join(' · ');

        await root.RGReports.exportExcelWorkbook([{
          name: isCancelled ? (isEn ? 'Cancelled Bookings' : 'الحجوزات الملغاة') : (isEn ? 'Rejected Bookings' : 'الحجوزات المرفوضة'),
          title: repTitle,
          periodText: periodTxt,
          filtersText: activeFiltersList,
          summaryItems: [
            { label: isEn ? 'Total Matching' : 'إجمالي المطابق', value: Number(currentTotal || exportRows.length) },
            { label: isEn ? 'Exported Rows' : 'الصفوف المصدرة', value: exportRows.length }
          ],
          headers: headers,
          rows: exportRows
        }], isCancelled ? 'rental-gate-cancelled-reservations.xlsx' : 'rental-gate-rejected-reservations.xlsx', {
          lang: ctx && ctx.lang,
          title: repTitle,
          periodText: periodTxt,
          filtersText: activeFiltersList
        });
        if (ctx && ctx.toast) ctx.toast(isEn ? 'Exported to Excel.' : 'تم تصدير البيانات إلى ملف Excel بنجاح.');
      }

      function triggerInactivePdfExport() {
        if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
          if (ctx && ctx.toast) ctx.toast(isEn ? 'PDF Studio is unavailable.' : 'وحدة تصدير PDF غير متاحة.', true);
          return;
        }
        var reasonKey = isCancelled ? 'cancellationReason' : 'rejectionReason';
        var reasonCol = { key: reasonKey, label: isCancelled ? (isEn ? 'Cancellation Reason' : 'سبب الإلغاء') : (isEn ? 'Rejection Reason' : 'سبب الرفض'), widthWeight: 1.8 };
        var actorCol = { key: isCancelled ? 'cancelledByName' : 'rejectedByName', label: isEn ? 'Confirmed By' : 'تأكيد بواسطة', widthWeight: 1.0 };
        var dateCol = { key: isCancelled ? 'cancelledAtText' : 'rejectedAtText', label: isCancelled ? (isEn ? 'Cancellation Date' : 'تاريخ الإلغاء') : (isEn ? 'Rejection Date' : 'تاريخ الرفض'), formatType: 'ltr', widthWeight: 1.0 };
        var cols = [
          { key: 'reservationNumber', label: isEn ? 'Booking #' : 'رقم الحجز', formatType: 'ltr', widthWeight: 1.0 },
          { key: 'customerName', label: isEn ? 'Customer Name' : 'اسم العميل', widthWeight: 1.25 }
        ];
        if (allowIdView) {
          cols.push({ key: 'customerIdNumber', label: isEn ? 'National ID' : 'رقم الهوية', formatType: 'ltr', widthWeight: 1.0 });
        }
        cols = cols.concat([
          { key: 'customerPhone', label: isEn ? 'Phone' : 'الجوال', formatType: 'ltr', widthWeight: 1.0 },
          { key: 'companyName', label: isEn ? 'Company' : 'الشركة', widthWeight: 1.05 },
          reasonCol,
          { key: 'internalStatus', label: isEn ? 'Status' : 'الحالة', widthWeight: 0.9 },
          actorCol,
          dateCol
        ]);
        var emptyReasonExp = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
        var pdfRows = currentItems.map(function (row) {
          var copy = Object.assign({}, row);
          var cleanR = (core && core.sanitizeReasonText ? core.sanitizeReasonText(copy[reasonKey]) : String(copy[reasonKey] || '').trim()) || emptyReasonExp;
          copy[reasonKey] = cleanR;
          copy.cancelledAtText = row.cancelledAt ? String(row.cancelledAt).replace('T', ' ').substring(0, 16) : '-';
          copy.rejectedAtText = row.rejectedAt ? String(row.rejectedAt).replace('T', ' ').substring(0, 16) : '-';
          return copy;
        });
        var fullReasons = currentItems.map(function (row) {
          var rawR = (core && core.sanitizeReasonText ? core.sanitizeReasonText(row[reasonKey]) : String(row[reasonKey] || '').trim());
          var drvN = (core && core.sanitizeReasonText ? core.sanitizeReasonText(row.driverNotes) : String(row.driverNotes || '').trim());
          if (!rawR && !drvN) return '';
          return (row.reservationNumber || '-') + ' — ' + (row.customerName || '-') + ':\n' + [rawR, drvN ? ((isEn ? 'Driver notes: ' : 'ملاحظات السائق: ') + drvN) : ''].filter(Boolean).join('\n');
        }).filter(Boolean);
        var scopeKey = 'inactive_' + mode;
        root.RGReports.openPdfStudio({
          ctx: ctx,
          title: isCancelled ? (isEn ? 'Cancelled Reservations Report' : 'تقرير الحجوزات الملغاة') : (isEn ? 'Rejected Reservations Report' : 'تقرير الحجوزات المرفوضة'),
          filename: 'rental-gate-' + scopeKey + '.pdf',
          scopeKey: scopeKey,
          availableColumns: cols,
          columns: cols,
          rows: pdfRows,
          summaryItems: [
            { label: isEn ? 'Total Matching' : 'إجمالي المطابق', value: String(currentTotal || pdfRows.length) },
            { label: isEn ? 'Exported Page Rows' : 'الصفوف المعروضة', value: String(pdfRows.length) }
          ],
          extraSections: fullReasons.length ? [{
            title: isCancelled ? (isEn ? 'Full Cancellation Reasons & Driver Notes' : 'أسباب الإلغاء وملاحظات السائق الكاملة') : (isEn ? 'Full Rejection Reasons & Notes' : 'أسباب الرفض والملاحظات الكاملة'),
            isNotes: true,
            lines: fullReasons
          }] : [],
          initialSettings: { orientation: 'landscape', paperSize: 'a4' }
        });
      }

      var inactExportWrap = hostEl.querySelector('#inact-export-wrap');
      if (inactExportWrap && root.RGExportMenu) {
        root.RGExportMenu.bind(inactExportWrap, {
          onPdf: triggerInactivePdfExport,
          onExcel: triggerInactiveExcelExport,
          onError: function (err) {
            if (ctx && ctx.toast) ctx.toast((err && err.message) || 'تعذر التصدير.', true);
          }
        });
      }

      var exportBtn = hostEl.querySelector('#inact-export-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', triggerInactiveExcelExport);
      }
      var exportPdfBtn = hostEl.querySelector('#inact-export-pdf');
      if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', triggerInactivePdfExport);
      }

      ['#inact-f-search', '#inact-f-resnum', '#inact-f-cmpnum', '#inact-f-oldcmp', '#inact-f-newcmp'].forEach(function (sel) {
        var inp = hostEl.querySelector(sel);
        if (!inp) return;
        inp.addEventListener('input', function () {
          syncFilterInputsFromDom();
          state.page = 1;
          clearTimeout(searchDebounce);
          searchDebounce = setTimeout(function () { loadData(); }, 220);
        });
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            clearTimeout(searchDebounce);
            syncFilterInputsFromDom();
            state.page = 1;
            loadData({ forceRefresh: true });
          }
        });
      });

      ['#inact-f-status', '#inact-f-reason', '#inact-f-from', '#inact-f-to', '#inact-f-emp'].forEach(function (sel) {
        var el = hostEl.querySelector(sel);
        if (!el) return;
        el.addEventListener('change', function () {
          syncFilterInputsFromDom();
          state.page = 1;
          loadData();
        });
      });
    }

    async function loadData(loadOpts) {
      var lo = loadOpts || {};
      var seq = ++fetchSeq;
      var resp = await root.RGApi.callApi('getInactiveReservations', buildQueryPayload({
        forceRefresh: Boolean(lo.forceRefresh),
        silentRefresh: Boolean(lo.silentRefresh)
      }));
      if (seq !== fetchSeq || !hostEl.isConnected) return;
      if (resp && resp.aborted) return;
      if (!resp || !resp.success || !resp.data) {
        paintTable((resp && resp.message) || (isEn ? 'Failed to load inactive reservations.' : 'تعذر تحميل الحجوزات غير الفعالة.'));
        return;
      }
      currentItems = Array.isArray(resp.data.items) ? resp.data.items : [];
      currentTotal = Number(resp.data.total || 0);
      currentTotalPages = Math.max(1, Number(resp.data.totalPages || 1));
      if (state.page > currentTotalPages) state.page = currentTotalPages;
      currentFacets = resp.data.facets || currentFacets;
      syncDropdownOptions();
      paintTable();
      if (lo.showToast && ctx && ctx.toast) {
        ctx.toast(isEn ? 'List refreshed.' : 'تم تحديث القائمة بنجاح.');
      }
      if (typeof options.onCountChange === 'function') {
        options.onCountChange(mode, currentTotal);
      }
    }

    var onExternalUpdate = function () {
      if (!hostEl.isConnected) {
        document.removeEventListener('rg:deltasync', onExternalUpdate);
        document.removeEventListener('rg:optimisticmutation', onExternalUpdate);
        return;
      }
      loadData({ forceRefresh: true, silentRefresh: true });
    };
    document.removeEventListener('rg:deltasync', onExternalUpdate);
    document.removeEventListener('rg:optimisticmutation', onExternalUpdate);
    document.addEventListener('rg:deltasync', onExternalUpdate);
    document.addEventListener('rg:optimisticmutation', onExternalUpdate);

    renderShell();
    loadData({ forceRefresh: Boolean(options.forceRefresh) });
  }

  async function render(container, ctx) {
    if (!container) return;
    var isEn = ctx && ctx.lang === 'en';
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var core = root.RGCrmCore;

    if (!user || !core || !core.canUserPerform(user, 'view_reservations')) {
      container.innerHTML =
        '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' +
          (isEn ? 'You do not have permission to view Reservations.' : 'ليس لديك صلاحية عرض الحجوزات.') +
        '</div></div>';
      return;
    }

    var canRejected = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_rejected_tab');
    var canCancelled = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cancelled_tab');
    if (!canRejected && !canCancelled) {
      container.innerHTML =
        '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' +
          (isEn ? 'All sub-tabs in this section are disabled for your account.' : 'جميع تبويبات هذا القسم مخفية عن حسابك حالياً.') +
        '</div></div>';
      return;
    }

    var state = (ctx && ctx.state && ctx.state.inactiveReservations) ? ctx.state.inactiveReservations : { subTab: 'rejected' };
    if (state.subTab !== 'rejected' && state.subTab !== 'cancelled') state.subTab = 'rejected';
    if (state.subTab === 'rejected' && !canRejected) state.subTab = 'cancelled';
    if (state.subTab === 'cancelled' && !canCancelled) state.subTab = 'rejected';
    if (ctx && ctx.state) ctx.state.inactiveReservations = state;

    var showLookupBtn = canViewIdNumber(user) && canUseAction(user, 'act_customer_id_lookup');

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">' + (isEn ? 'Inactive Reservations' : 'الحجوزات غير الفعالة') + '</h2>' +
            '<p class="section-subtitle">' + (isEn ? 'Synced archive for rejected and cancelled bookings with complete customer data and audit logs' : 'سجل متكامل للحجوزات المرفوضة والملغاة المزامنة من الموقع الخارجي مع حفظ كامل البيانات وسجل الإجراءات') + '</p>' +
          '</div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            (showLookupBtn
              ? '<button type="button" class="btn btn-charcoal rg-ui-res-id-lookup" id="inact-id-lookup-btn">🪪 ' + (isEn ? 'National ID Lookup' : 'بحث برقم الهوية الوطنية') + '</button>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="res-view-tabs" role="tablist" aria-label="' + (isEn ? 'Inactive Reservations Tabs' : 'تبويبات الحجوزات غير الفعالة') + '">' +
          (canRejected ? (
            '<button type="button" class="res-view-tab' + (state.subTab === 'rejected' ? ' is-active' : '') + '" data-inact-tab="rejected" data-res-view="rejected" role="tab" aria-selected="' + (state.subTab === 'rejected') + '">' +
              '<span>' + (isEn ? 'Rejected Reservations' : 'الحجوزات المرفوضة') + '</span>' +
              '<span class="res-tab-count tabular-nums" id="inact-cnt-rejected">—</span>' +
            '</button>'
          ) : '') +
          (canCancelled ? (
            '<button type="button" class="res-view-tab' + (state.subTab === 'cancelled' ? ' is-active' : '') + '" data-inact-tab="cancelled" role="tab" aria-selected="' + (state.subTab === 'cancelled') + '">' +
              '<span>' + (isEn ? 'Cancelled Reservations' : 'الحجوزات الملغاة') + '</span>' +
              '<span class="res-tab-count tabular-nums" id="inact-cnt-cancelled">—</span>' +
            '</button>'
          ) : '') +
        '</div>' +
        '<div id="inact-panel-host"></div>' +
      '</div>';

    var lookupBtn = document.getElementById('inact-id-lookup-btn');
    if (lookupBtn) {
      lookupBtn.addEventListener('click', function () {
        openNationalIdLookupModal(ctx, '');
      });
    }

    function updateTabBadge(tabMode, countVal) {
      var bEl = document.getElementById(tabMode === 'cancelled' ? 'inact-cnt-cancelled' : 'inact-cnt-rejected');
      if (bEl) bEl.textContent = String(countVal || 0);
    }

    if (canRejected) {
      root.RGApi.callApi('getInactiveReservations', { subTab: 'rejected', page: 1, pageSize: 1, silentRefresh: true })
        .then(function (r) { if (r && r.success && r.data) updateTabBadge('rejected', r.data.total || 0); })
        .catch(function () {});
    }
    if (canCancelled) {
      root.RGApi.callApi('getInactiveReservations', { subTab: 'cancelled', page: 1, pageSize: 1, silentRefresh: true })
        .then(function (r) { if (r && r.success && r.data) updateTabBadge('cancelled', r.data.total || 0); })
        .catch(function () {});
    }

    function mountActiveSubTab() {
      var host = document.getElementById('inact-panel-host');
      if (!host) return;
      renderRejectedPanel(host, ctx, {
        mode: state.subTab,
        onCountChange: updateTabBadge
      });
    }

    container.querySelectorAll('[data-inact-tab]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        var nextTab = tabBtn.getAttribute('data-inact-tab') === 'cancelled' ? 'cancelled' : 'rejected';
        if (nextTab === 'rejected' && !canRejected) return;
        if (nextTab === 'cancelled' && !canCancelled) return;
        state.subTab = nextTab;
        container.querySelectorAll('[data-inact-tab]').forEach(function (b) {
          var act = b.getAttribute('data-inact-tab') === state.subTab;
          b.classList.toggle('is-active', act);
          b.setAttribute('aria-selected', String(act));
        });
        mountActiveSubTab();
      });
    });

    container._rgRefreshDataOnly = function () {
      mountActiveSubTab();
    };

    mountActiveSubTab();
  }

  root.RGInactive = {
    render: render,
    renderRejectedPanel: renderRejectedPanel,
    openRejectModal: openRejectModal,
    openCancelModal: openCancelModal,
    openNationalIdLookupModal: openNationalIdLookupModal
  };
})(window);
