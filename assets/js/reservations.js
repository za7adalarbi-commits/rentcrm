/**
 * RENTAL GATE CRM — Reservations Grid, Self-Claim, Quick Status, Supervisor Controls & PDF Export
 */
(function (root) {
  'use strict';

  var ALL_COLUMNS = [
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

  var REJECTED_COLUMNS = [
    { key: 'reservationNumber', label: 'رقم الحجز', sortable: true },
    { key: 'customerName', label: 'اسم العميل', sortable: true },
    { key: 'companyName', label: 'الشركة', sortable: true },
    { key: 'newCompanyName', label: 'الشركة الجديدة', sortable: false },
    { key: 'rejectionReason', label: 'سبب الرفض', sortable: false },
    { key: 'internalStatus', label: 'الحالة', sortable: true },
    { key: 'refundAmount', label: 'الاسترداد', sortable: false },
    { key: 'rejectedByName', label: 'التأكيد بواسطة', sortable: false },
    { key: 'rejectedAt', label: 'التاريخ', sortable: true }
  ];

  var CANCELLED_COLUMNS = [
    { key: 'reservationNumber', label: 'رقم الحجز', sortable: true },
    { key: 'referenceNumber', label: 'الرقم المرجعي', sortable: true },
    { key: 'customerName', label: 'اسم العميل', sortable: true },
    { key: 'customerPhone', label: 'جوال العميل', sortable: true },
    { key: 'carName', label: 'السيارة', sortable: true },
    { key: 'paidAmount', label: 'المبلغ المدفوع', sortable: true },
    { key: 'cancellationReason', label: 'سبب الإلغاء', sortable: false },
    { key: 'deliveryFailureReason', label: 'سبب فشل التوصيل', sortable: false },
    { key: 'driverNotes', label: 'ملاحظات السائق', sortable: false },
    { key: 'sourceCreatedAt', label: 'تاريخ الحجز', sortable: true },
    { key: 'startDate', label: 'تاريخ البداية', sortable: true },
    { key: 'cancelledAt', label: 'تاريخ الإلغاء', sortable: true },
    { key: 'internalStatus', label: 'حالة الحجز', sortable: true }
  ];


  var DEFAULT_VISIBLE_COLS = [
    'reservationNumber',
    'customerName',
    'carName',
    'startDate',
    'totalAmount',
    'originalStatusAr',
    'internalStatus'
  ];

  var COLS_STORAGE_KEY = 'rg_crm_visible_cols_v4';

  function loadSavedVisibleCols(currentUser) {
    var roleUiRes = (root.RGApp && typeof root.RGApp.getEffectiveRoleUiResolution === 'function')
      ? root.RGApp.getEffectiveRoleUiResolution(currentUser)
      : null;
    var parsed = null;
    var hasLocal = false;
    try {
      var raw = localStorage.getItem(COLS_STORAGE_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) hasLocal = true;
      }
    } catch (_e) {}
    if (roleUiRes && roleUiRes.hasRoleOverride && (roleUiRes.forceForRole || !hasLocal)) {
      return roleUiRes.visibleCols.slice();
    }
    if (hasLocal) return parsed;
    return DEFAULT_VISIBLE_COLS.slice();
  }

  function esc(val) {
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCarNameDisplay(name) {
    var s = String(name || '').trim();
    if (!s) return '-';
    return s
      .replace(/\s*[-–—]+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function statusClass(status) {
    if (['مؤكد', 'مقبول', 'تم الحجز', 'تم التسليم', 'تم الاستلام', 'تم التسليم من قبل السائق', 'تم الإرجاع', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مدفوع بالمحفظة', 'معتمد إداريًا'].indexOf(status) !== -1) return 'status-success';
    if (['نشط الآن', 'قيد الانتظار', 'في الطريق', 'جديد', 'تم التمديد', 'تم التمديد تلقائيًا', 'تم تغيير الموقع', 'تم الإنشاء', 'ناشط', 'نشط', 'بدأ التنفيذ', 'قيد التنفيذ', 'جاهز للاستلام'].indexOf(status) !== -1) return 'status-info';
    if (['معلق', 'بانتظار الدفع', 'لم يتم الحجز'].indexOf(status) !== -1) return 'status-warning';
    if (['ملغي', 'تم الإلغاء', 'مرفوض', 'غير مدفوع'].indexOf(status) !== -1) return 'status-danger';
    if (['منتهي', 'مكتمل', 'لم يحضر', 'مسودة'].indexOf(status) !== -1) return 'status-neutral';
    return 'status-neutral';
  }

  function priorityClass(prio) {
    if (prio === 'مرتفع') return 'status-danger';
    if (prio === 'متوسط') return 'status-warning';
    return 'status-neutral';
  }

  function formatDateOnly(val) {
    if (!val) return '-';
    if (root.RGCrmCore && root.RGCrmCore.formatDisplayDate) {
      return root.RGCrmCore.formatDisplayDate(val) || '-';
    }
    return String(val).substring(0, 10);
  }

  function activeTimeFormat() {
    return (root.RGApp && typeof root.RGApp.getTimeFormat === 'function') ? root.RGApp.getTimeFormat() : '24h';
  }

  function activeTimezoneMode() {
    return (root.RGApp && typeof root.RGApp.getTimezoneMode === 'function') ? root.RGApp.getTimezoneMode() : 'both';
  }

  function renderBookingTimezoneHtml(dateStr, timeStr, options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var lang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
    var core = root.RGCrmCore;
    if (core && typeof core.buildBookingTimezoneDisplay === 'function') {
      var info = core.buildBookingTimezoneDisplay(dateStr, timeStr, {
        lang: lang,
        timeFormat: activeTimeFormat(),
        timezoneMode: opts.timezoneMode || activeTimezoneMode(),
        compact: Boolean(opts.compact),
        timeOnly: Boolean(opts.timeOnly)
      });
      if (!info.hasTime) {
        if (opts.timeOnly) return '';
        return info.saDate ? '<span class="mono tabular-nums" dir="ltr">' + esc(info.saDate) + '</span>' : '-';
      }
      return '<span class="rg-tz-stack' + (opts.compact ? ' is-compact' : '') + '">' +
        info.entries.map(function (entry) {
          return '<span class="rg-tz-line is-' + esc(entry.zone) + '">' +
            '<span class="rg-tz-val mono tabular-nums" dir="ltr">' + esc(entry.valueText) + '</span>' +
            '<span class="rg-tz-tag">' + esc(entry.label) + '</span>' +
          '</span>';
        }).join('') +
      '</span>';
    }
    var dTxt = dateStr ? formatDateOnly(dateStr) : '';
    var tTxt = timeStr ? formatTimeOnly(timeStr, lang) : '';
    if (opts.timeOnly) return tTxt ? '<span class="mono tabular-nums" dir="ltr">' + esc(tTxt) + '</span>' : '';
    return '<span class="mono tabular-nums" dir="ltr">' + esc([dTxt, tTxt].filter(Boolean).join(' · ') || '-') + '</span>';
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

  function runWithLock(btnEl, lockKey, fn, opts) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn, opts);
    }
    return Promise.resolve().then(fn);
  }

  function isProblemClosed(status) {
    return root.RGCrmCore && root.RGCrmCore.isProblemClosedStatus
      ? root.RGCrmCore.isProblemClosedStatus(status)
      : (status === 'مغلقة' || status === 'تم الحل');
  }

  function copyTextToClipboard(text) {
    var str = String(text || '');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(str).catch(function () {
        return fallbackCopyText(str);
      });
    }
    return Promise.resolve(fallbackCopyText(str));
  }

  function fallbackCopyText(str) {
    try {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var isEn = ctx.lang === 'en';
    var currentUser = root.RGAuth.getUser();
    var currentEmpId = currentUser ? currentUser.id : '';

    var defaultCols = loadSavedVisibleCols(currentUser);
    var state = Object.assign({
      search: '', reservationNumber: '', company: '', branch: '', status: '', employeeId: '', priority: '',
      dateFrom: '', dateTo: '', timeField: 'both', timeFrom: '', timeTo: '',
      unfollowedOnly: false, hasProblemsOnly: false, overdueUnpaidOnly: false,
      sortBy: 'sourceOrder', sortDir: 'asc', explicitSort: false, page: 1, pageSize: 20,
      visibleCols: defaultCols,
      selectedResIds: {},
      viewMode: 'all',
      radarFilter: 'all',
      radarSearch: '',
      todayFilter: 'all',
      todaySearch: '',
      todayTimeFrom: '',
      todayTimeTo: ''
    }, ctx.state.reservations || {});
    if (!Array.isArray(state.visibleCols) || state.visibleCols.length === 0) {
      state.visibleCols = defaultCols;
    }
    if (!state.selectedResIds || typeof state.selectedResIds !== 'object') {
      state.selectedResIds = {};
    }
    var selectedResIds = state.selectedResIds;
    var canViewId = !root.RGCrmCore || !root.RGCrmCore.canUserViewCustomerId || root.RGCrmCore.canUserViewCustomerId(currentUser);
    var canViewTodayTab = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(currentUser, 'sub_view_today_tab');
    var canViewRadarTab = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(currentUser, 'sub_view_radar_tab');
    var canViewCancelledTab = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(currentUser, 'sub_view_cancelled_tab');
    var canViewRejectedTab = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(currentUser, 'sub_view_rejected_tab');
    var VALID_VIEW_MODES = ['all', 'today', 'radar', 'rejected', 'cancelled'];
    if (state.viewMode === 'active' || VALID_VIEW_MODES.indexOf(state.viewMode) === -1) state.viewMode = 'all';
    if (state.viewMode === 'today' && !canViewTodayTab) state.viewMode = 'all';
    if (state.viewMode === 'radar' && !canViewRadarTab) state.viewMode = 'all';
    if (state.viewMode === 'cancelled' && !canViewCancelledTab) state.viewMode = 'all';
    if (state.viewMode === 'rejected' && !canViewRejectedTab) state.viewMode = 'all';
    ctx.state.reservations = state;
    if (ctx.saveRouteFilters) ctx.saveRouteFilters();

    function getActiveLifecycleFilter() {
      if (state.viewMode === 'cancelled' || state.viewMode === 'rejected') {
        return state.viewMode;
      }
      return 'all';
    }

    function isListViewMode(vm) {
      return vm === 'all' || vm === 'rejected' || vm === 'cancelled';
    }

    function doesResMatchViewLifecycle(rec, lifecycleMode) {
      if (!rec) return false;
      var life = String(lifecycleMode || 'active').toLowerCase();
      if (life === 'all') return true;
      var coreRef = root.RGCrmCore;
      if (life === 'rejected') {
        return (coreRef && typeof coreRef.isInRejectedTab === 'function')
          ? coreRef.isInRejectedTab(rec)
          : ((coreRef && typeof coreRef.isRejectedStatus === 'function')
              ? coreRef.isRejectedStatus(rec)
              : (coreRef && coreRef.classifyReservationLifecycle ? coreRef.classifyReservationLifecycle(rec) === 'rejected' : false));
      }
      if (life === 'cancelled') {
        return (coreRef && typeof coreRef.isCancelledStatus === 'function')
          ? coreRef.isCancelledStatus(rec)
          : (coreRef && coreRef.classifyReservationLifecycle ? coreRef.classifyReservationLifecycle(rec) === 'cancelled' : false);
      }
      if (coreRef && typeof coreRef.isInactiveReservation === 'function') {
        return !coreRef.isInactiveReservation(rec);
      }
      var cls = (coreRef && typeof coreRef.classifyReservationLifecycle === 'function')
        ? coreRef.classifyReservationLifecycle(rec)
        : 'active';
      return cls === 'active';
    }

    function getQueryPayload(extra) {
      var core = root.RGCrmCore;
      var base = (core && core.buildReservationQueryPayload)
        ? core.buildReservationQueryPayload(state)
        : Object.assign({ page: 1, pageSize: 20 }, state);
      var life = getActiveLifecycleFilter();
      return extra ? Object.assign({}, base, { lifecycle: life }, extra) : Object.assign({}, base, { lifecycle: life });
    }

    function checkHasActiveResFilters() {
      var core = root.RGCrmCore;
      return (core && core.hasActiveReservationFilters)
        ? core.hasActiveReservationFilters(state)
        : Boolean(
            state.search || state.reservationNumber || state.company || state.branch || state.status || state.employeeId ||
            state.priority || state.dateFrom || state.dateTo || state.timeFrom || state.timeTo ||
            state.unfollowedOnly || state.hasProblemsOnly || state.overdueUnpaidOnly
          );
    }

    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps = Boolean(empState && empState.loaded && Array.isArray(empState.items) && empState.items.length > 0);
    var [empRes, resData] = await Promise.all([
      hasPreloadedEmps ? Promise.resolve({ success: true, data: { items: empState.items } }) : root.RGApi.callApi('getEmployees', {}),
      root.RGApi.callApi('getReservations', getQueryPayload({ abortKey: 'res:list' }))
    ]);
    if (resData && resData.aborted) return;

    var employees = (empRes.success && empRes.data && empRes.data.items) || [];
    var activeEmployeesList = employees.filter(function (e) { return e && e.status === 'active'; });
    var initialLoadError = (!resData || !resData.success) ? ((resData && resData.message) || 'تعذر تحميل قائمة الحجوزات.') : '';
    var payload = (resData && resData.success && resData.data) || { items: [], total: 0, page: 1, totalPages: 1, facets: { companies: [], branches: [] } };
    var currentItems = payload.items || [];
    var currentTotalPages = payload.totalPages || 1;
    var facets = payload.facets || { companies: [], branches: [] };

    var canAction = function (actKey) {
      return !root.RGCrmCore || !root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(currentUser, actKey);
    };
    var canPullReservations = Boolean(currentUser && root.RGCrmCore.canUserPerform(currentUser, 'pull_reservations') && canAction('act_pull_reservations'));
    var canImportExcel = Boolean(currentUser && (root.RGCrmCore.canUserPerform(currentUser, 'pull_reservations') || root.RGCrmCore.canUserPerform(currentUser, 'manage_settings')) && canAction('act_import_excel'));
    var canBulkReassign = Boolean(
      currentUser &&
      root.RGCrmCore &&
      (root.RGCrmCore.canUserPerform(currentUser, 'assign_employees') ||
       (root.RGCrmCore.isPrivilegedRole && root.RGCrmCore.isPrivilegedRole(currentUser))) &&
      canAction('act_bulk_reassign')
    );
    var canHandoverPdf = Boolean(root.RGHandover && canAction('act_handover_pdf'));
    var canResColumns = canAction('act_res_columns');
    var canExportExcel = canAction('act_export_excel');
    var canExportPdf = canAction('act_export_pdf');
    var canClaimButtons = canAction('act_claim_reservation');
    var canLookupIdBtn = Boolean(
      root.RGInactive && currentUser && root.RGCrmCore &&
      (!root.RGCrmCore.canUserViewCustomerId || root.RGCrmCore.canUserViewCustomerId(currentUser)) &&
      canAction('act_customer_id_lookup')
    );
    var isGeneralManager = Boolean(
      currentUser &&
      (currentUser.role === root.RGCrmCore.ROLES.GENERAL_MANAGER ||
       currentUser.role === root.RGCrmCore.ROLES.DEVELOPER)
    );
    var pullPresets = (root.RGCrmCore && root.RGCrmCore.PULL_DURATION_PRESETS) || [];
    var pullPresetState = state.pullPreset || 'all';

    var TODAY_CAL_PREFS_KEY = 'rg_crm_today_cal_prefs_v1';
    function loadTodayCalPrefs() {
      try {
        var raw = localStorage.getItem(TODAY_CAL_PREFS_KEY);
        return raw ? (JSON.parse(raw) || {}) : {};
      } catch (_e) {
        return {};
      }
    }
    function saveTodayCalPrefs() {
      try {
        localStorage.setItem(TODAY_CAL_PREFS_KEY, JSON.stringify({
          todayDisplayMode: state.todayDisplayMode === 'list' ? 'list' : 'calendar',
          todayCalendarGranularity: state.todayCalendarGranularity || 'month'
        }));
      } catch (_e) {}
    }

    var savedTodayCal = loadTodayCalPrefs();
    if (state.todayDisplayMode !== 'calendar' && state.todayDisplayMode !== 'list') {
      state.todayDisplayMode = savedTodayCal.todayDisplayMode === 'list' ? 'list' : 'calendar';
    }
    var rawCalGran = state.todayCalendarGranularity || savedTodayCal.todayCalendarGranularity || 'month';
    state.todayCalendarGranularity = (root.RGCrmCore && root.RGCrmCore.normalizeCalendarGranularity)
      ? root.RGCrmCore.normalizeCalendarGranularity(rawCalGran)
      : ((rawCalGran === 'day' || rawCalGran === 'week') ? rawCalGran : 'month');

    if (!state.todayCalendarAnchorDate) {
      state.todayCalendarAnchorDate = (root.RGCrmCore && root.RGCrmCore.getRiyadhTodayDateStr)
        ? root.RGCrmCore.getRiyadhTodayDateStr()
        : new Date().toISOString().substring(0, 10);
    }
    if (!state.todayCalendarEventFilter) {
      state.todayCalendarEventFilter = 'all';
    }
    if (state.todayCalendarSearch === undefined) {
      state.todayCalendarSearch = '';
    }

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">' + t('nav_reservations') + '</h2>' +
            '<p class="section-subtitle">' + (isEn ? 'Matching results:' : 'إجمالي النتائج المطابقة:') + ' <strong class="tabular-nums" id="res-total-count">' + payload.total + '</strong> · ' + (isEn ? 'Claim bookings, track pickups/returns & calendar, or monitor 24h expiry radar' : 'يمكنك استلام أي حجز، متابعة التسليم والاستلام والتقويم، أو مراقبة رادار الانتهاء') + '</p>' +
          '</div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            (canLookupIdBtn ? '<button type="button" class="btn btn-sm btn-charcoal rg-ui-res-id-lookup" id="res-id-lookup-btn">🪪 ' + (isEn ? 'National ID Lookup' : 'بحث برقم الهوية') + '</button>' : '') +
            (canHandoverPdf ? '<button type="button" class="btn btn-sm rg-ui-handover-btn" id="res-handover-btn">' + (isEn ? 'Shift Handover (PDF)' : 'تسليم الوردية (PDF)') + '</button>' : '') +
            (canPullReservations ? '<button type="button" class="btn btn-charcoal rg-ui-res-pull-btn" id="res-pull-btn" title="جلب أحدث الحجوزات والتمديدات">' + t('pull_reservations') + '</button>' : '') +
            (canImportExcel ? '<button type="button" class="btn rg-ui-res-import-btn" id="res-import-xlsx">' + (isEn ? 'Import Excel' : 'استيراد من Excel') + '</button>' : '') +
            (canResColumns ? '<button type="button" class="btn rg-ui-res-cols-btn" id="res-cols-btn">' + t('toggle_columns') + '</button>' : '') +
            ((root.RGExportMenu && (canExportPdf || canExportExcel))
              ? root.RGExportMenu.renderHtml({
                  wrapId: 'res-export-wrap',
                  btnId: 'res-export-btn',
                  extraWrapClass: 'rg-ui-res-export-wrap',
                  canPdf: canExportPdf,
                  canExcel: canExportExcel,
                  lang: ctx.lang
                })
              : ((canExportPdf ? '<button type="button" class="btn btn-charcoal rg-ui-res-export-pdf-btn" id="res-export-pdf">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' : '') +
                 (canExportExcel ? '<button type="button" class="btn btn-primary rg-ui-res-export-btn" id="res-export-xlsx">' + t('export_excel') + '</button>' : ''))) +
          '</div>' +
        '</div>' +
        '<div class="res-view-tabs" role="tablist" aria-label="' + (isEn ? 'Reservations View' : 'تبويبات الحجوزات') + '">' +
          '<button type="button" class="res-view-tab' + (state.viewMode === 'all' ? ' is-active' : '') + '" data-res-view="all" role="tab" aria-selected="' + (state.viewMode === 'all') + '">' +
            '<span>' + (isEn ? 'All Reservations' : 'جميع الحجوزات') + '</span>' +
            '<span class="res-tab-count tabular-nums" data-testid="all-tab-count" id="res-all-tab-count">—</span>' +
          '</button>' +
          (canViewTodayTab ? (
            '<button type="button" class="res-view-tab' + (state.viewMode === 'today' ? ' is-active' : '') + '" data-res-view="today" role="tab" aria-selected="' + (state.viewMode === 'today') + '">' +
              '<span>' + (isEn ? 'Pickups & Returns' : 'التسليم والاستلام') + '</span>' +
              '<span class="res-tab-count tabular-nums" data-testid="today-tab-count" id="res-today-tab-count">—</span>' +
            '</button>'
          ) : '') +
          (canViewRadarTab ? (
            '<button type="button" class="res-view-tab' + (state.viewMode === 'radar' ? ' is-active' : '') + '" data-res-view="radar" role="tab" aria-selected="' + (state.viewMode === 'radar') + '">' +
              '<span>' + (isEn ? '24h Expiry Radar' : 'رادار انتهاء الحجوزات (24 ساعة)') + '</span>' +
              '<span class="res-tab-count tabular-nums" data-testid="radar-tab-count" id="res-radar-tab-count">—</span>' +
            '</button>'
          ) : '') +
          (canViewRejectedTab ? (
            '<button type="button" class="res-view-tab' + (state.viewMode === 'rejected' ? ' is-active' : '') + '" data-res-view="rejected" role="tab" aria-selected="' + (state.viewMode === 'rejected') + '">' +
              '<span>' + (isEn ? 'Rejected Reservations' : 'الحجوزات المرفوضة') + '</span>' +
              '<span class="res-tab-count tabular-nums" data-testid="rejected-tab-count" id="res-rejected-tab-count">—</span>' +
            '</button>'
          ) : '') +
          (canViewCancelledTab ? (
            '<button type="button" class="res-view-tab' + (state.viewMode === 'cancelled' ? ' is-active' : '') + '" data-res-view="cancelled" role="tab" aria-selected="' + (state.viewMode === 'cancelled') + '">' +
              '<span>' + (isEn ? 'Cancelled Reservations' : 'الحجوزات الملغاة') + '</span>' +
              '<span class="res-tab-count tabular-nums" data-testid="cancelled-tab-count" id="res-cancelled-tab-count">—</span>' +
            '</button>'
          ) : '') +
        '</div>' +
        '<div id="res-all-view"' + (!isListViewMode(state.viewMode) ? ' class="hidden"' : '') + '>' +
          (canPullReservations && isGeneralManager ? (
            '<div class="gm-pull-bar" id="res-gm-pull-bar">' +
              '<span class="gm-pull-label">تخصيص مدة سحب الحجوزات (المدير العام):</span>' +
              '<select class="select" id="res-pull-preset" aria-label="مدة السحب">' +
                pullPresets.map(function (p) {
                  return '<option value="' + esc(p.key) + '"' + (pullPresetState === p.key ? ' selected' : '') + '>' + esc(p.label) + '</option>';
                }).join('') +
              '</select>' +
              '<div class="gm-pull-dates' + (pullPresetState === 'custom' ? '' : ' hidden') + '" id="res-pull-custom-dates">' +
                '<label class="gm-pull-date-field"><span>من تاريخ</span><input type="date" class="input" id="res-pull-from" data-rg-range-pair="res-pull-range" data-rg-range-role="start" value="' + esc(state.pullFrom || '') + '" aria-label="من تاريخ للسحب"></label>' +
                '<label class="gm-pull-date-field"><span>إلى تاريخ</span><input type="date" class="input" id="res-pull-to" data-rg-range-pair="res-pull-range" data-rg-range-role="end" value="' + esc(state.pullTo || '') + '" aria-label="إلى تاريخ للسحب"></label>' +
              '</div>' +
            '</div>'
          ) : '') +
          '<div class="rg-res-search-row">' +
            '<div class="rg-res-search-field">' +
              '<span class="rg-res-search-icon" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
              '</span>' +
              '<input type="search" class="input" id="res-search" placeholder="' + t('search_placeholder') + '" aria-label="' + t('search_placeholder') + '" value="' + esc(state.search || '') + '">' +
            '</div>' +
            '<div class="rg-res-search-field rg-res-number-search-field">' +
              '<span class="rg-res-search-icon rg-res-hash-badge" aria-hidden="true">#</span>' +
              '<input type="search" class="input rg-res-number-input" id="res-number-search" placeholder="' + t('res_number_search_placeholder') + '" aria-label="' + t('res_number_search_label') + '" value="' + esc(state.reservationNumber || '') + '">' +
            '</div>' +
          '</div>' +
          '<div class="filter-grid filter-grid-4 rg-res-core-filter-grid">' +
            '<select class="select" id="res-company" aria-label="' + t('company') + '"><option value="">' + t('all_companies') + '</option>' +
              ((state.company && facets.companies.indexOf(state.company) === -1 ? [state.company] : []).concat(facets.companies || [])).map(function (c) { return '<option value="' + esc(c) + '"' + (state.company === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-branch" aria-label="' + t('branch') + '"><option value="">' + t('all_branches') + '</option>' +
              ((state.branch && facets.branches.indexOf(state.branch) === -1 ? [state.branch] : []).concat(facets.branches || [])).map(function (b) { return '<option value="' + esc(b) + '"' + (state.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-status" aria-label="' + t('status') + '"><option value="">' + t('all_statuses') + '</option>' +
              (root.RGCrmCore.WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) { return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-emp" aria-label="' + t('employee') + '"><option value="">' + t('all_employees') + '</option>' +
              employees.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.employeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          '<div class="rg-res-extra-filter-grid rg-ui-res-extra-filter">' +
            '<select class="select" id="res-prio" aria-label="' + t('priority') + '"><option value="">' + t('all_priorities') + '</option>' +
              root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + esc(p) + '"' + (state.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
            '</select>' +
            '<div class="rg-res-date-field" id="res-from-wrap">' +
              '<label class="rg-res-date-label" for="res-from"><span>' + (isEn ? 'Start Date (Optional)' : 'من تاريخ (البداية · اختياري)') + '</span></label>' +
              '<input type="date" class="input" id="res-from" data-rg-range-pair="res-filter-range" data-rg-range-role="start" value="' + esc(state.dateFrom || '') + '" aria-label="' + t('from_date') + '">' +
            '</div>' +
            '<div class="rg-res-date-field" id="res-to-wrap">' +
              '<label class="rg-res-date-label" for="res-to">' +
                '<span>' + (isEn ? 'End Date (Works Standalone)' : 'تاريخ النهاية (يعمل بمفرده)') + '</span>' +
                '<span class="rg-res-standalone-tag" id="res-to-standalone-tag">' + (isEn ? 'Standalone ✓' : 'مستقل ✓') + '</span>' +
              '</label>' +
              '<input type="date" class="input" id="res-to" data-rg-range-pair="res-filter-range" data-rg-range-role="end" value="' + esc(state.dateTo || '') + '" aria-label="' + t('to_date') + '">' +
            '</div>' +
          '</div>' +
          '<div class="rg-date-filter-hint rg-ui-res-extra-filter" id="res-date-filter-hint" role="status" aria-live="polite"></div>' +
          '<div class="toolbar-row rg-ui-res-extra-filter" style="flex-wrap:wrap;">' +
            '<select class="select" id="res-time-field" aria-label="' + (isEn ? 'Time Filter Field' : 'نوع وقت الحركة') + '" style="width:auto;min-width:170px;">' +
              '<option value="both"' + (state.timeField === 'both' ? ' selected' : '') + '>' + (isEn ? 'Pickup or Return Time' : 'وقت التسليم أو الاستلام') + '</option>' +
              '<option value="start"' + (state.timeField === 'start' ? ' selected' : '') + '>' + (isEn ? 'Pickup Time (Start)' : 'وقت التسليم (البداية)') + '</option>' +
              '<option value="end"' + (state.timeField === 'end' ? ' selected' : '') + '>' + (isEn ? 'Return Time (End)' : 'وقت الاستلام / الإرجاع') + '</option>' +
            '</select>' +
            '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-secondary);">' +
              '<span>' + (isEn ? 'From:' : 'من الساعة:') + '</span>' +
              '<input type="time" class="input mono" id="res-time-from" value="' + esc(state.timeFrom || '') + '" style="width:128px;min-height:34px;">' +
            '</label>' +
            '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-secondary);">' +
              '<span>' + (isEn ? 'To:' : 'إلى الساعة:') + '</span>' +
              '<input type="time" class="input mono" id="res-time-to" value="' + esc(state.timeTo || '') + '" style="width:128px;min-height:34px;">' +
            '</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="res-unfollowed"' + (state.unfollowedOnly ? ' checked' : '') + '> ' + t('unfollowed_only') + '</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="res-problems"' + (state.hasProblemsOnly ? ' checked' : '') + '> ' + t('has_problems_only') + '</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="res-overdue-unpaid"' + (state.overdueUnpaidOnly ? ' checked' : '') + '> ' + (isEn ? 'Overdue Return (No Paid Ext.)' : 'المتأخرة عن الإرجاع (بدون تمديد مدفوع)') + '</label>' +
            '<button type="button" class="btn btn-sm" id="res-reset-filters">' + t('reset_filters') + '</button>' +
          '</div>' +
          '<div id="res-cols-panel" class="surface-card hidden" style="margin-bottom:14px;padding:12px;">' +
            '<div class="cols-panel-header">' +
              '<span>اختر الأعمدة الظاهرة في الجدول</span>' +
              '<button type="button" class="btn btn-sm" id="res-cols-reset">استعادة العرض المرتب</button>' +
            '</div>' +
            '<div class="checkbox-grid">' +
              ALL_COLUMNS.filter(function (col) { return col.key !== 'customerIdNumber' || canViewId; }).map(function (col) {
                var checked = state.visibleCols.indexOf(col.key) !== -1 ? 'checked' : '';
                return '<label class="checkbox-item"><input type="checkbox" class="res-col-toggle" value="' + col.key + '" ' + checked + '> ' + col.label + '</label>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div id="res-sync-warning-banner" class="hidden" style="margin-bottom:12px;"></div>' +
          '<div id="res-lifecycle-banner" class="hidden" style="margin-bottom:12px;"></div>' +
          '<div id="res-table-region"></div>' +
        '</div>' +
        '<div id="res-today-view"' + (state.viewMode === 'today' ? '' : ' class="hidden"') + '></div>' +
        '<div id="res-radar-view"' + (state.viewMode === 'radar' ? '' : ' class="hidden"') + '></div>' +
      '</div>';

    var activeFetchSeq = 0;

    function isDedicatedLifecycleSchemaMode() {
      return state.viewMode === 'rejected' || state.viewMode === 'cancelled';
    }

    function syncColsButtonVisibility() {
      var dedicated = isDedicatedLifecycleSchemaMode();
      var colsBtn = document.getElementById('res-cols-btn');
      var colsPanel = document.getElementById('res-cols-panel');
      if (colsBtn) colsBtn.classList.toggle('hidden', dedicated);
      if (colsPanel && dedicated) colsPanel.classList.add('hidden');
    }

    function buildTableRegionHtml(data) {
      var list = data.items || [];
      var isRejectedSchema = state.viewMode === 'rejected';
      var isCancelledSchema = state.viewMode === 'cancelled';
      var isDedicatedSchema = isRejectedSchema || isCancelledSchema;
      var sanitizeSourceReason = function (val) {
        if (root.RGCrmCore && typeof root.RGCrmCore.sanitizeReasonText === 'function') {
          return root.RGCrmCore.sanitizeReasonText(val);
        }
        var s = String(val || '').trim();
        if (!s || s === '-' || s === '—' || s === 'غير متاح' || s === 'غير محدد' || /^(n\/a|na|null|undefined|none)$/i.test(s)) return '';
        return s;
      };
      var resolveRowSourceReason = function (item, kind) {
        var direct = sanitizeSourceReason(kind === 'rejected' ? item.rejectionReason : item.cancellationReason);
        if (direct) return direct;
        var rawText = String(item.rawJson || '').trim();
        if (rawText.charAt(0) === '{' && root.RGCrmCore) {
          try {
            var parsedRaw = JSON.parse(rawText);
            return kind === 'rejected'
              ? (root.RGCrmCore.extractRejectionReason ? root.RGCrmCore.extractRejectionReason(parsedRaw, null) : '')
              : (root.RGCrmCore.extractCancellationReason ? root.RGCrmCore.extractCancellationReason(parsedRaw, null) : '');
          } catch (_e) {}
        }
        return '';
      };
      var emptyReasonLabel = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
      var notRecordedLabel = isEn ? 'Not recorded in source' : 'غير مسجل في المصدر';
      var notTransferredLabel = isEn ? 'Not transferred' : 'لم يتم التحويل';
      var noRefundLabel = isEn ? 'No refund recorded' : 'لا يوجد استرداد مسجل';
      var noDriverNotesLabel = isEn ? 'No driver notes' : 'لا توجد ملاحظات مسجلة';
      var noDeliveryFailLabel = isEn ? 'No failure recorded' : 'لم يُسجّل فشل توصيل';
      var visibleCols = isRejectedSchema
        ? REJECTED_COLUMNS.slice()
        : (isCancelledSchema
            ? CANCELLED_COLUMNS.slice()
            : ALL_COLUMNS.filter(function (c) {
                if (c.key === 'customerIdNumber' && !canViewId) return false;
                return state.visibleCols.indexOf(c.key) !== -1;
              }));
      var colVisible = {};
      visibleCols.forEach(function (c) { colVisible[c.key] = true; });
      var showBulkCol = Boolean(canBulkReassign && !isDedicatedSchema);
      var selectedIdsList = showBulkCol ? Object.keys(selectedResIds).filter(function (k) { return Boolean(selectedResIds[k]); }) : [];
      var allPageSelected = showBulkCol && list.length > 0 && list.every(function (x) { return Boolean(selectedResIds[x.id]); });

      var bulkBarHtml = showBulkCol ? (
        '<div id="res-bulk-action-bar" class="rg-bulk-bar rg-ui-res-bulk' + (selectedIdsList.length === 0 ? ' hidden' : '') + '">' +
          '<div class="rg-bulk-bar-info">' +
            '<span class="rg-bulk-count-badge tabular-nums" id="res-bulk-count">' + selectedIdsList.length + '</span>' +
            '<span>' + (isEn ? 'selected reservations ready for bulk reassign' : 'حجز محدد — إعادة توزيع جماعي:') + '</span>' +
          '</div>' +
          '<div class="rg-bulk-bar-controls">' +
            '<select class="select" id="res-bulk-target-emp" aria-label="' + (isEn ? 'Target Employee' : 'الموظف المستلم') + '">' +
              activeEmployeesList.map(function (emp) {
                return '<option value="' + esc(emp.id) + '">' + esc(emp.name) + '</option>';
              }).join('') +
            '</select>' +
            '<select class="select" id="res-bulk-mode" aria-label="' + (isEn ? 'Assignment Mode' : 'نمط التوزيع') + '">' +
              '<option value="replace">' + (isEn ? 'Replace existing assignees' : 'استبدال الإسناد الحالي بالموظف') + '</option>' +
              '<option value="add">' + (isEn ? 'Add alongside current' : 'إضافة مع الموظفين الحاليين') + '</option>' +
            '</select>' +
            '<button type="button" class="btn btn-sm btn-primary" id="res-bulk-apply-btn"' + (activeEmployeesList.length ? '' : ' disabled') + '>' + (isEn ? 'Apply Reassign' : 'تنفيذ التوزيع الجماعي') + '</button>' +
            '<button type="button" class="btn btn-sm" id="res-bulk-clear-btn">' + (isEn ? 'Clear Selection' : 'إلغاء التحديد') + '</button>' +
          '</div>' +
        '</div>'
      ) : '';

      var cleanSearchEmpty = [String(state.search || '').trim(), String(state.reservationNumber || '').trim()].filter(Boolean).join(' · ');
      return bulkBarHtml + (list.length === 0
        ? '<div class="empty-state">' +
            (cleanSearchEmpty
              ? (isEn
                  ? ('No bookings matched search «' + esc(cleanSearchEmpty) + '». <button type="button" class="btn btn-sm" id="res-empty-clear-search">Clear Search</button>')
                  : ('لا توجد نتائج مطابقة للبحث «' + esc(cleanSearchEmpty) + '». <button type="button" class="btn btn-sm" id="res-empty-clear-search">مسح البحث</button>'))
              : (isEn ? 'No bookings match the current filters.' : 'لا توجد حجوزات مطابقة للفلاتر الحالية.')) +
          '</div>'
        : '<div class="table-wrap"><table class="data-table' + (isDedicatedSchema ? ' rg-lifecycle-table' : '') + '"><thead><tr>' +
            (showBulkCol ? '<th class="res-bulk-th rg-ui-res-bulk"><input type="checkbox" id="res-bulk-select-all" aria-label="' + (isEn ? 'Select all on page' : 'تحديد كل الحجوزات في الصفحة') + '"' + (allPageSelected ? ' checked' : '') + '></th>' : '') +
            visibleCols.map(function (c) {
              var isSortable = c.sortable !== false;
              var arrow = (isSortable && state.sortBy === c.key) ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
              return isSortable
                ? '<th class="sortable" data-sort="' + c.key + '">' + c.label + arrow + '</th>'
                : '<th>' + c.label + '</th>';
            }).join('') +
            '<th>' + (isDedicatedSchema ? (isEn ? 'Actions' : 'الأوامر') : 'إجراءات') + '</th>' +
          '</tr></thead><tbody>' +
            list.map(function (r) {
              var assignedIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];
              var assignedNames = Array.isArray(r.assignedEmployeeNames) ? r.assignedEmployeeNames : [];
              var isMine = currentEmpId && assignedIds.indexOf(currentEmpId) !== -1;
              var overdueInfo = (root.RGCrmCore && root.RGCrmCore.isReservationOverdueUnpaid)
                ? root.RGCrmCore.isReservationOverdueUnpaid(r, r.extensions)
                : null;
              var locksList = (ctx.getActiveLocks ? ctx.getActiveLocks() : (root.RGApp && root.RGApp.getActiveLocks ? root.RGApp.getActiveLocks() : [])) || [];
              var colleagueLock = locksList.find(function (l) {
                return l && l.reservationId === r.id && l.lockedById !== currentEmpId;
              });

              var tds = visibleCols.map(function (c) {
                var extCount = Number(r.extensionsCount || (r.hasExtensions ? 1 : 0));
                if (c.key === 'reservationNumber') {
                  var badgeHtml = '';
                  if (!isDedicatedSchema) {
                    if (extCount > 0) badgeHtml += '<span class="status-tag status-info tabular-nums">تمديد ×' + extCount + '</span>';
                    if (r.hasProblem) badgeHtml += '<span class="status-tag status-danger">مشكلة</span>';
                    if (overdueInfo && overdueInfo.isOverdueUnpaid) {
                      badgeHtml += '<span class="rg-overdue-badge" title="' + esc(isEn ? 'Overdue return without paid extension' : 'متأخرة عن الإرجاع بدون تمديد مدفوع') + '">⏰ <span dir="ltr">' + esc(isEn ? overdueInfo.labelEn : overdueInfo.labelAr) + '</span></span>';
                    }
                    if (colleagueLock) {
                      badgeHtml += '<span class="rg-softlock-chip" title="' + esc(isEn ? ('Editing by ' + colleagueLock.lockedByName) : ('يتابعه حالياً: ' + colleagueLock.lockedByName)) + '">🔒 ' + esc(colleagueLock.lockedByName) + '</span>';
                    }
                  }
                  return '<td class="mono cell-res-num">' +
                    '<div class="cell-res-head"><button type="button" class="btn-link-inline btn-open-res" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber || notRecordedLabel) + '</button></div>' +
                    (badgeHtml ? '<div class="cell-badges">' + badgeHtml + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'referenceNumber') {
                  var refVal = r.referenceNumber || r.sourceReservationId || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (refVal ? '<span dir="ltr">' + esc(String(refVal)) + '</span>' : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') +
                  '</td>';
                }
                if (c.key === 'customerName') {
                  var showSubPhone = !colVisible.customerPhone && r.customerPhone;
                  var showSubId = !colVisible.customerIdNumber && canViewId && r.customerIdNumber;
                  return '<td class="cell-customer">' +
                    '<div class="cell-primary"><button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName || notRecordedLabel) + '</button></div>' +
                    ((showSubPhone || showSubId) ? (
                      '<div class="cell-sub">' +
                        (showSubPhone ? '<span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span>' : '') +
                        (showSubPhone && showSubId ? ' <span>·</span> ' : '') +
                        (showSubId ? '<span class="mono">' + (isEn ? 'ID: ' : 'هوية: ') + '<span dir="ltr">' + esc(String(r.customerIdNumber)) + '</span></span>' : '') +
                      '</div>'
                    ) : '') +
                  '</td>';
                }
                if (c.key === 'customerPhone') {
                  return '<td class="mono"><span class="cell-phone" dir="ltr">' + esc(r.customerPhone || (isDedicatedSchema ? notRecordedLabel : '-')) + '</span></td>';
                }
                if (c.key === 'customerIdNumber') {
                  return '<td class="mono" style="white-space:nowrap;"><span dir="ltr">' + esc(r.customerIdNumber ? String(r.customerIdNumber) : '-') + '</span></td>';
                }
                if (c.key === 'companyName') {
                  var compNum = r.companyNumber ? String(r.companyNumber).trim() : '';
                  return '<td class="cell-company">' +
                    '<div class="cell-primary">' + esc(r.companyName || notRecordedLabel) + '</div>' +
                    (isDedicatedSchema && compNum ? '<div class="cell-sub mono" dir="ltr">#' + esc(compNum) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'newCompanyName') {
                  var newCompVal = sanitizeSourceReason(r.newCompanyName);
                  return '<td>' + (newCompVal ? esc(newCompVal) : '<span style="color:var(--text-muted);">' + esc(notTransferredLabel) + '</span>') + '</td>';
                }
                if (c.key === 'rejectionReason') {
                  var rejReason = resolveRowSourceReason(r, 'rejected');
                  return '<td><div class="cell-clamp-2" title="' + esc(rejReason || emptyReasonLabel) + '">' +
                    (rejReason ? esc(rejReason) : '<span style="color:var(--text-muted);font-size:12px;">' + esc(emptyReasonLabel) + '</span>') +
                  '</div></td>';
                }
                if (c.key === 'refundAmount') {
                  var hasRefundVal = r.refundAmount !== undefined && r.refundAmount !== null && r.refundAmount !== '';
                  var refAmt = Number(r.refundAmount || 0);
                  var payStLower = String(r.paymentStatus || '').toLowerCase();
                  var isRefundState = payStLower.indexOf('مسترد') !== -1 || payStLower.indexOf('refund') !== -1;
                  var refundDisplay = (refAmt > 0 || (hasRefundVal && refAmt === 0 && isRefundState))
                    ? ('<strong>' + refAmt + ' ر.س</strong>')
                    : '<span style="color:var(--text-muted);">' + esc(noRefundLabel) + '</span>';
                  return '<td class="tabular-nums" style="white-space:nowrap;">' + refundDisplay + '</td>';
                }
                if (c.key === 'rejectedByName') {
                  var rejActor = String(r.rejectedByName || r.lastUpdatedByName || '').trim();
                  return '<td>' + (rejActor ? esc(rejActor) : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') + '</td>';
                }
                if (c.key === 'rejectedAt') {
                  var rejAtVal = r.rejectedAt || r.lastUpdatedAt || r.createdAt || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (rejAtVal ? esc(formatTimestamp(rejAtVal, ctx.lang)) : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') +
                  '</td>';
                }
                if (c.key === 'paidAmount') {
                  var rawPaid = Number(r.paidAmount || 0);
                  var pStLower = String(r.paymentStatus || '').toLowerCase();
                  var isPaidOrRefunded = pStLower.indexOf('مدفوع') !== -1 || pStLower.indexOf('paid') !== -1 || pStLower.indexOf('مسترد') !== -1 || pStLower.indexOf('refund') !== -1;
                  var effectivePaid = rawPaid > 0 ? rawPaid : (isPaidOrRefunded && Number(r.totalAmount || 0) > 0 ? Number(r.totalAmount) : 0);
                  return '<td class="tabular-nums" style="white-space:nowrap;">' +
                    (effectivePaid > 0 ? ('<strong>' + effectivePaid + ' ر.س</strong>') : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') +
                  '</td>';
                }
                if (c.key === 'cancellationReason') {
                  var canReason = resolveRowSourceReason(r, 'cancelled');
                  return '<td><div class="cell-clamp-2" title="' + esc(canReason || emptyReasonLabel) + '">' +
                    (canReason ? esc(canReason) : '<span style="color:var(--text-muted);font-size:12px;">' + esc(emptyReasonLabel) + '</span>') +
                  '</div></td>';
                }
                if (c.key === 'deliveryFailureReason') {
                  var delFail = sanitizeSourceReason(r.deliveryFailureReason);
                  return '<td><div class="cell-clamp-2" title="' + esc(delFail || noDeliveryFailLabel) + '">' +
                    (delFail ? esc(delFail) : '<span style="color:var(--text-muted);">' + esc(noDeliveryFailLabel) + '</span>') +
                  '</div></td>';
                }
                if (c.key === 'driverNotes') {
                  var drvNotes = sanitizeSourceReason(r.driverNotes);
                  return '<td><div class="cell-clamp-2" title="' + esc(drvNotes || noDriverNotesLabel) + '">' +
                    (drvNotes ? esc(drvNotes) : '<span style="color:var(--text-muted);">' + esc(noDriverNotesLabel) + '</span>') +
                  '</div></td>';
                }
                if (c.key === 'sourceCreatedAt') {
                  var bookedAt = r.sourceCreatedAt || r.createdAt || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (bookedAt ? esc(formatTimestamp(bookedAt, ctx.lang)) : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') +
                  '</td>';
                }
                if (c.key === 'cancelledAt') {
                  var canAtVal = r.cancelledAt || r.lastUpdatedAt || r.updatedAt || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (canAtVal ? esc(formatTimestamp(canAtVal, ctx.lang)) : '<span style="color:var(--text-muted);">' + esc(notRecordedLabel) + '</span>') +
                  '</td>';
                }
                if (c.key === 'carName') {
                  var carLabel = r.carName ? formatCarNameDisplay(r.carName) : notRecordedLabel;
                  var metaParts = [];
                  if (!isDedicatedSchema) {
                    if (!colVisible.companyName && r.companyName) metaParts.push(r.companyName);
                    if (!colVisible.branchName && r.branchName) metaParts.push(r.branchName);
                  }
                  return '<td class="cell-car">' +
                    '<div class="cell-primary cell-car-name" title="' + esc(r.carName || '') + '">' + esc(carLabel) + '</div>' +
                    (metaParts.length ? '<div class="cell-sub">' + esc(metaParts.join(' · ')) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'originalStatusAr') {
                  var coreRefSt = root.RGCrmCore;
                  var isRejCell = Boolean(coreRefSt && coreRefSt.isRejectedStatus && coreRefSt.isRejectedStatus(r));
                  var isCanCell = Boolean(coreRefSt && coreRefSt.isCancelledStatus && coreRefSt.isCancelledStatus(r));
                  var rowLifeCls = (state.viewMode === 'rejected' && isRejCell)
                    ? 'rejected'
                    : ((state.viewMode === 'cancelled' && isCanCell)
                        ? 'cancelled'
                        : (isRejCell ? 'rejected' : (isCanCell ? 'cancelled' : ((coreRefSt && coreRefSt.classifyReservationLifecycle) ? coreRefSt.classifyReservationLifecycle(r) : 'active'))));
                  var lifeSourceNote = rowLifeCls === 'rejected'
                    ? ((String(r.rccStatus || '').toUpperCase() === 'COMPANY_CHANGED'
                        ? (isEn ? 'Company Changed / Rejected' : 'محوّل لشركة أخرى بعد الرفض/انتهاء المهلة')
                        : (isEn ? 'Site Rejected' : 'مرفوض من الموقع')) + (r.rejectionReason ? (' · ' + r.rejectionReason) : (r.newCompanyName ? (' · ' + r.newCompanyName) : '')))
                    : (rowLifeCls === 'cancelled'
                        ? ((isEn ? 'Customer Cancelled' : 'ملغي من العميل') + (r.cancellationReason ? (' · ' + r.cancellationReason) : ''))
                        : '');
                  return '<td><span class="status-tag ' + statusClass(r.originalStatusAr || (rowLifeCls === 'rejected' ? 'مرفوض' : (rowLifeCls === 'cancelled' ? 'ملغي' : ''))) + '">' +
                    esc(r.originalStatusAr || (rowLifeCls === 'rejected' ? 'مرفوض' : (rowLifeCls === 'cancelled' ? 'ملغي' : '-'))) +
                    '</span>' +
                    (lifeSourceNote ? '<div class="cell-sub" title="' + esc(lifeSourceNote) + '">' + esc(lifeSourceNote) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'internalStatus') {
                  if (isDedicatedSchema) {
                    var dedicatedStatusLabel = r.originalStatusAr || r.internalStatus || (isRejectedSchema ? 'مرفوض' : 'ملغي');
                    return '<td><span class="status-tag ' + statusClass(dedicatedStatusLabel) + '">' + esc(dedicatedStatusLabel) + '</span></td>';
                  }
                  var subAssignee = !colVisible.assignedEmployeeNames
                    ? (assignedNames.length ? assignedNames.join('، ') : 'متاح للاستلام')
                    : '';
                  var rowIsInactive = Boolean(root.RGCrmCore && root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(r));
                  if (rowIsInactive) {
                    return '<td>' +
                      '<span class="status-tag ' + statusClass(r.internalStatus) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span>' +
                      (subAssignee ? '<div class="cell-sub" title="' + esc(subAssignee) + '">' + esc(subAssignee) + '</div>' : '') +
                    '</td>';
                  }
                  var isStatusLocked = Boolean(root.RGApp && root.RGApp.isActionLocked && root.RGApp.isActionLocked('quickUpdateReservationStatus:' + r.id));
                  return '<td>' +
                    '<select class="quick-status-select tbl-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة الحجز ' + esc(r.reservationNumber) + '"' + (isStatusLocked ? ' disabled aria-busy="true"' : '') + '>' +
                      (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : (root.RGCrmCore.MANUAL_WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES)).map(function (s) {
                        return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                      }).join('') +
                    '</select>' +
                    (subAssignee ? '<div class="cell-sub" title="' + esc(subAssignee) + '">' + esc(subAssignee) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'priority') {
                  return '<td><span class="status-tag ' + priorityClass(r.priority) + '">' + esc(r.priority || 'عادي') + '</span></td>';
                }
                if (c.key === 'assignedEmployeeNames') {
                  if (!assignedNames.length) {
                    return '<td><span class="status-tag status-neutral">متاح للاستلام</span></td>';
                  }
                  return '<td><div class="cell-emp-chips">' +
                    assignedNames.map(function (n, idx) {
                      var isSelf = currentEmpId && assignedIds[idx] === currentEmpId;
                      return '<span class="status-tag ' + (isSelf ? 'status-success' : 'status-info') + '">' + esc(n) + '</span>';
                    }).join('') +
                  '</div></td>';
                }
                if (c.key === 'startDate') {
                  if (isDedicatedSchema && !r.startDate) {
                    return '<td class="tabular-nums" style="white-space:nowrap;"><span style="color:var(--text-muted);">-</span></td>';
                  }
                  var totStartDays = Number(r.totalDaysCount || r.daysCount || 1);
                  var periodParts = [];
                  if (!isDedicatedSchema) {
                    if (!colVisible.endDate && r.endDate) periodParts.push('حتى ' + formatDateOnly(r.endDate));
                    if (!colVisible.daysCount) periodParts.push(totStartDays + ' يوم');
                  }
                  return '<td class="tabular-nums" style="white-space:nowrap;">' +
                    (r.startTime
                      ? renderBookingTimezoneHtml(r.startDate, r.startTime, { compact: true })
                      : '<div class="cell-primary mono" dir="ltr">' + esc(formatDateOnly(r.startDate)) + '</div>') +
                    (periodParts.length ? '<div class="cell-sub">' + esc(periodParts.join(' · ')) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'endDate') {
                  var endTm = r.endTime || r.originalEndTime || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (endTm
                      ? renderBookingTimezoneHtml(r.endDate, endTm, { compact: true })
                      : '<div>' + esc(formatDateOnly(r.endDate)) + '</div>') +
                  '</td>';
                }
                if (c.key === 'daysCount') {
                  var totDays = Number(r.totalDaysCount || r.daysCount || 1);
                  var extDays = Number(r.extendedDaysCount || 0);
                  return '<td class="tabular-nums" style="white-space:nowrap;"><div>' + totDays + ' يوم</div>' +
                    (extDays > 0 ? '<div class="time-sub">أساسي ' + Number(r.daysCount || 1) + ' + تمديد ' + extDays + '</div>' : '') + '</td>';
                }
                if (c.key === 'extensionsCount') {
                  return extCount > 0
                    ? '<td class="tabular-nums"><span class="status-tag status-info">ممدد ×' + extCount + '</span></td>'
                    : '<td class="tabular-nums">-</td>';
                }
                if (c.key === 'extendedUntilDate') {
                  if (!r.extendedUntilDate) return '<td class="mono tabular-nums">-</td>';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                    (r.extendedUntilTime
                      ? renderBookingTimezoneHtml(r.extendedUntilDate, r.extendedUntilTime, { compact: true })
                      : '<div>' + esc(formatDateOnly(r.extendedUntilDate)) + '</div>') +
                  '</td>';
                }
                if (c.key === 'extensionsAmount') {
                  var extAmtCol = Number(r.extensionsAmount || 0);
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' + (extAmtCol > 0 ? (extAmtCol + ' ر.س') : '-') + '</td>';
                }
                if (c.key === 'totalAmount') {
                  var extAmt = Number(r.extensionsAmount || 0);
                  var showExtSub = (!colVisible.extensionsCount && extCount > 0) || (!colVisible.extensionsAmount && extAmt > 0);
                  return '<td class="tabular-nums" style="white-space:nowrap;">' +
                    '<div class="cell-primary"><strong>' + Number(r.totalAmount || 0) + ' ر.س</strong></div>' +
                    (showExtSub ? '<div class="cell-sub">تمديد ×' + extCount + (extAmt > 0 ? ' (+' + extAmt + ' ر.س)' : '') + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'lastUpdateText') {
                  var txt = r.lastUpdateText || '-';
                  var metaUpd = [];
                  if (!colVisible.lastUpdatedByName && r.lastUpdatedByName) metaUpd.push(r.lastUpdatedByName);
                  if (!colVisible.lastUpdatedAt && r.lastUpdatedAt) metaUpd.push(formatTimestamp(r.lastUpdatedAt));
                  return '<td>' +
                    '<div class="cell-clamp-2" title="' + esc(txt) + '">' + esc(txt) + '</div>' +
                    (metaUpd.length ? '<div class="cell-sub tabular-nums">' + esc(metaUpd.join(' · ')) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'lastUpdatedAt') {
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc(formatTimestamp(r.lastUpdatedAt)) + '</td>';
                }
                return '<td class="tabular-nums">' + esc(r[c.key] || '-') + '</td>';
              }).join('');

              var isClaimLocked = Boolean(
                root.RGApp &&
                root.RGApp.isActionLocked &&
                (root.RGApp.isActionLocked('claimReservation:' + r.id) || root.RGApp.isActionLocked('unclaimReservation:' + r.id))
              );
              var rowIsInactiveBtn = Boolean(isDedicatedSchema || (root.RGCrmCore && root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(r)));
              var claimBtnHtml = (canClaimButtons && !rowIsInactiveBtn)
                ? (isMine
                  ? '<button type="button" class="btn btn-sm btn-danger btn-unclaim-res" data-id="' + esc(r.id) + '" title="إلغاء الاستلام من حسابك"' + (isClaimLocked ? ' disabled aria-busy="true"' : '') + '>مستلم ✓ · إلغاء</button>'
                  : '<button type="button" class="btn btn-sm btn-charcoal btn-claim-res" data-id="' + esc(r.id) + '" title="استلام الحجز عندي للمتابعة"' + (isClaimLocked ? ' disabled aria-busy="true"' : '') + '>استلام عندي</button>')
                : '';

              return '<tr data-res-id="' + esc(r.id) + '" class="' +
                (!isDedicatedSchema && overdueInfo && overdueInfo.isOverdueUnpaid ? 'is-overdue-unpaid ' : '') +
                (showBulkCol && selectedResIds[r.id] ? 'is-selected-row' : '') + '">' +
                (showBulkCol ? '<td class="res-bulk-td rg-ui-res-bulk"><input type="checkbox" class="res-row-select-chk" data-id="' + esc(r.id) + '" aria-label="تحديد الحجز ' + esc(r.reservationNumber) + '"' + (selectedResIds[r.id] ? ' checked' : '') + '></td>' : '') +
                tds +
                '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                  claimBtnHtml +
                  '<button type="button" class="btn btn-sm btn-primary btn-open-res" data-id="' + esc(r.id) + '">التفاصيل</button>' +
                '</div></td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>') +
        '<div class="pagination-bar">' +
          '<span>صفحة <strong class="tabular-nums">' + (data.page || 1) + '</strong> من <strong class="tabular-nums">' + (data.totalPages || 1) + '</strong></span>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            '<button type="button" class="btn btn-sm" id="res-prev"' + ((data.page || 1) <= 1 ? ' disabled' : '') + '>السابق</button>' +
            '<button type="button" class="btn btn-sm" id="res-next"' + ((data.page || 1) >= (data.totalPages || 1) ? ' disabled' : '') + '>التالي</button>' +
          '</div>' +
        '</div>';
    }

    function bindTableRegionEvents(region) {
      var wrap = region.querySelector('.table-wrap');
      var tbl = region.querySelector('.data-table');
      if (wrap && tbl && tbl.scrollWidth > wrap.clientWidth + 4) {
        tbl.classList.add('has-sticky-actions');
      }

      if (canBulkReassign) {
        var syncBulkBarUi = function () {
          var bar = region.querySelector('#res-bulk-action-bar');
          var countEl = region.querySelector('#res-bulk-count');
          var selectAllEl = region.querySelector('#res-bulk-select-all');
          var rowChks = Array.prototype.slice.call(region.querySelectorAll('.res-row-select-chk'));
          var selCount = Object.keys(selectedResIds).filter(function (k) { return Boolean(selectedResIds[k]); }).length;
          if (countEl) countEl.textContent = String(selCount);
          if (bar) bar.classList.toggle('hidden', selCount === 0);
          if (selectAllEl) {
            selectAllEl.checked = rowChks.length > 0 && rowChks.every(function (c) { return c.checked; });
          }
        };

        var selectAllChk = region.querySelector('#res-bulk-select-all');
        if (selectAllChk) {
          selectAllChk.addEventListener('change', function () {
            var checked = Boolean(selectAllChk.checked);
            region.querySelectorAll('.res-row-select-chk').forEach(function (chk) {
              var rid = chk.getAttribute('data-id');
              chk.checked = checked;
              if (rid) {
                if (checked) selectedResIds[rid] = true;
                else delete selectedResIds[rid];
              }
              var tr = chk.closest('tr');
              if (tr) tr.classList.toggle('is-selected-row', checked);
            });
            syncBulkBarUi();
          });
        }

        region.querySelectorAll('.res-row-select-chk').forEach(function (chk) {
          chk.addEventListener('change', function () {
            var rid = chk.getAttribute('data-id');
            if (rid) {
              if (chk.checked) selectedResIds[rid] = true;
              else delete selectedResIds[rid];
            }
            var tr = chk.closest('tr');
            if (tr) tr.classList.toggle('is-selected-row', Boolean(chk.checked));
            syncBulkBarUi();
          });
        });

        var bulkClearBtn = region.querySelector('#res-bulk-clear-btn');
        if (bulkClearBtn) {
          bulkClearBtn.addEventListener('click', function () {
            Object.keys(selectedResIds).forEach(function (k) { delete selectedResIds[k]; });
            region.querySelectorAll('.res-row-select-chk').forEach(function (chk) {
              chk.checked = false;
              var tr = chk.closest('tr');
              if (tr) tr.classList.remove('is-selected-row');
            });
            syncBulkBarUi();
          });
        }

        var bulkApplyBtn = region.querySelector('#res-bulk-apply-btn');
        if (bulkApplyBtn) {
          bulkApplyBtn.addEventListener('click', function () {
            var targetEmpSel = region.querySelector('#res-bulk-target-emp');
            var modeSel = region.querySelector('#res-bulk-mode');
            var toEmployeeId = targetEmpSel ? targetEmpSel.value : '';
            var modeVal = (modeSel && modeSel.value === 'add') ? 'add' : 'replace';
            var idsList = Object.keys(selectedResIds).filter(function (k) { return Boolean(selectedResIds[k]); });
            if (!idsList.length) {
              ctx.toast(isEn ? 'Select at least one reservation first.' : 'يرجى تحديد حجز واحد على الأقل أولاً.', true);
              return;
            }
            if (!toEmployeeId) {
              ctx.toast(isEn ? 'Select target employee first.' : 'يرجى اختيار الموظف المستلم.', true);
              return;
            }
            var targetEmpObj = employees.find(function (e) { return e && e.id === toEmployeeId; });
            var targetEmpName = (targetEmpObj && targetEmpObj.name) || toEmployeeId;
            var bulkSpamSig = toEmployeeId + ':' + modeVal + ':' + idsList.slice().sort().join(',');
            runWithLock(bulkApplyBtn, 'bulkReassignSelectedReservations:' + toEmployeeId, function () {
              var prevItems = currentItems.slice();
              var prevSelected = Object.assign({}, selectedResIds);
              var idMap = {};
              idsList.forEach(function (idVal) { idMap[idVal] = true; });
              var nowIso = new Date().toISOString();
              var changedBulkItems = [];
              currentItems = currentItems.map(function (item) {
                if (!item || !idMap[item.id]) return item;
                var curIds = Array.isArray(item.assignedEmployeeIds) ? item.assignedEmployeeIds.slice() : [];
                var curNames = Array.isArray(item.assignedEmployeeNames) ? item.assignedEmployeeNames.slice() : [];
                var nextIds, nextNames;
                if (modeVal === 'add') {
                  nextIds = curIds.slice();
                  nextNames = curNames.slice();
                  if (nextIds.indexOf(toEmployeeId) === -1) {
                    nextIds.push(toEmployeeId);
                    nextNames.push(targetEmpName);
                  }
                } else {
                  nextIds = [toEmployeeId];
                  nextNames = [targetEmpName];
                }
                var updatedBulk = Object.assign({}, item, {
                  assignedEmployeeIds: nextIds,
                  assignedEmployeeNames: nextNames,
                  updatedAt: nowIso
                });
                changedBulkItems.push(updatedBulk);
                return updatedBulk;
              });
              if (Array.isArray(radarRawReservations)) {
                radarRawReservations = radarRawReservations.map(function (item) {
                  var updatedMatch = item && idMap[item.id] ? changedBulkItems.find(function (x) { return x && x.id === item.id; }) : null;
                  return updatedMatch ? Object.assign({}, item, updatedMatch) : item;
                });
                paintRadarView();
                paintTodayView();
              }
              Object.keys(selectedResIds).forEach(function (k) { delete selectedResIds[k]; });
              if (root.RGApi && root.RGApi.applyOptimisticMutation) {
                root.RGApi.applyOptimisticMutation('bulkReassignSelectedReservations', {
                  reservationIds: idsList,
                  targetEmployeeId: toEmployeeId,
                  targetEmployeeName: targetEmpName,
                  mode: modeVal
                }, currentUser);
              }
              if (changedBulkItems.length && checkHasActiveResFilters()) {
                currentItems = prevItems;
                applyLocalResChangesToTable(changedBulkItems);
              } else {
                paintCurrentItems();
              }
              ctx.toast(isEn
                ? ('Reassigned ' + idsList.length + ' reservation(s) to ' + targetEmpName + '.')
                : ('تمت إعادة توزيع ' + idsList.length + ' حجز إلى ' + targetEmpName + ' بنجاح.'));
              return root.RGApi.callApi('bulkReassignSelectedReservations', {
                reservationIds: idsList,
                targetEmployeeId: toEmployeeId,
                mode: modeVal,
                _keepOptimisticCache: true,
                _spamChecked: true
              }).then(function (resp) {
                if (resp && resp.success) {
                  ctx.refreshNotifications();
                } else {
                  currentItems = prevItems;
                  Object.keys(prevSelected).forEach(function (k) { selectedResIds[k] = prevSelected[k]; });
                  paintCurrentItems();
                  ctx.toast((resp && resp.message) || 'تعذر تنفيذ إعادة التوزيع الجماعي.', true);
                }
              }).catch(function () {
                currentItems = prevItems;
                Object.keys(prevSelected).forEach(function (k) { selectedResIds[k] = prevSelected[k]; });
                paintCurrentItems();
                ctx.toast('تعذر الاتصال بالخادم أثناء التوزيع الجماعي.', true);
              });
            }, { spamAction: 'bulkReassignSelectedReservations', spamSig: bulkSpamSig });
          });
        }
      }

      region.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var col = th.getAttribute('data-sort');
          if (state.sortBy === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortBy = col; state.sortDir = 'desc'; }
          state.explicitSort = true;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          refreshTableRegion();
        });
      });

      var prevBtn = region.querySelector('#res-prev');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (state.page > 1) {
            state.page--;
            if (ctx.saveRouteFilters) ctx.saveRouteFilters();
            refreshTableRegion();
          }
        });
      }
      var nextBtn = region.querySelector('#res-next');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (state.page < currentTotalPages) {
            state.page++;
            if (ctx.saveRouteFilters) ctx.saveRouteFilters();
            refreshTableRegion();
          }
        });
      }

      region.querySelectorAll('.tbl-quick-status').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var rid = sel.getAttribute('data-id');
          var nextStatus = sel.value;
          var targetItemPre = currentItems.find(function (x) { return x && x.id === rid; });
          var prevStatusVal = (targetItemPre && targetItemPre.internalStatus) || '';
          runWithLock(sel, 'quickUpdateReservationStatus:' + rid, function () {
            var prevItems = currentItems.slice();
            var targetItem = prevItems.find(function (x) { return x && x.id === rid; });
            var expectedUpdatedAt = (targetItem && (targetItem.updatedAt || targetItem.lastUpdatedAt)) || '';
            var nowIso = new Date().toISOString();
            var actionText = 'تحديث سريع للحالة إلى: ' + nextStatus;
            var updatedPatch = {
              internalStatus: nextStatus,
              lastUpdateText: actionText,
              lastUpdatedById: currentEmpId || (targetItem && targetItem.lastUpdatedById),
              lastUpdatedByName: (currentUser && currentUser.name) || (targetItem && targetItem.lastUpdatedByName),
              lastUpdatedAt: nowIso,
              isFollowed: true
            };
            var updatedQuickRes = targetItem ? Object.assign({}, targetItem, updatedPatch) : null;
            if (Array.isArray(radarRawReservations)) {
              radarRawReservations = radarRawReservations.map(function (item) {
                return item && item.id === rid ? Object.assign({}, item, updatedPatch) : item;
              });
              paintRadarView();
              paintTodayView();
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
                reservationId: rid,
                status: nextStatus
              }, currentUser);
            }
            if (updatedQuickRes && checkHasActiveResFilters()) {
              applyLocalResChangesToTable([updatedQuickRes]);
            } else {
              currentItems = currentItems.map(function (item) {
                return item.id === rid ? Object.assign({}, item, updatedPatch) : item;
              });
              paintCurrentItems();
            }
            ctx.toast('تم تحديث حالة الحجز إلى: ' + nextStatus);
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
                currentItems = prevItems;
                paintCurrentItems();
                if (resp && resp.error === 'CONFLICT_STALE_DATA') {
                  ctx.toast(resp.message || 'تم تعديل هذا الحجز من مستخدم آخر، جاري تحديث البيانات...', true);
                  refreshTableRegion({ forceRefresh: true, silentRefresh: true });
                  refreshRadarData(false, { forceRefresh: true });
                } else {
                  ctx.toast((resp && resp.message) || 'تعذر تحديث حالة الحجز.', true);
                }
              }
            }).catch(function () {
              currentItems = prevItems;
              paintCurrentItems();
              ctx.toast('تعذر الاتصال بالخادم أثناء تحديث الحالة.', true);
            });
          }, { spamAction: 'quickUpdateReservationStatus', spamSig: rid + ':' + nextStatus }).then(function (lockRes) {
            if (lockRes && lockRes.spamBlocked && prevStatusVal) {
              sel.value = prevStatusVal;
            }
          }).finally(function () {
            var liveSel = region.querySelector('.tbl-quick-status[data-id="' + rid + '"]');
            if (liveSel && (!root.RGApp || !root.RGApp.isActionLocked || !root.RGApp.isActionLocked('quickUpdateReservationStatus:' + rid))) {
              liveSel.disabled = false;
              liveSel.removeAttribute('aria-busy');
            }
          });
        });
      });

      region.querySelectorAll('.btn-claim-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          runWithLock(btn, 'claimReservation:' + rid, function () {
            var prevItems = currentItems.slice();
            var patchedItem = null;
            var nextClaimedList = currentItems.map(function (item) {
              if (item.id !== rid) return item;
              var claimed = root.RGCrmCore.claimReservationRecord(item, currentUser);
              patchedItem = Object.assign({}, item, {
                assignedEmployeeIds: claimed.assignedEmployeeIds,
                assignedEmployeeNames: claimed.assignedEmployeeNames
              });
              return patchedItem;
            });
            if (patchedItem && Array.isArray(radarRawReservations)) {
              radarRawReservations = radarRawReservations.map(function (item) {
                return item && item.id === rid ? Object.assign({}, item, patchedItem) : item;
              });
              paintRadarView();
              paintTodayView();
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('claimReservation', { reservationId: rid }, currentUser);
            }
            if (patchedItem && checkHasActiveResFilters()) {
              applyLocalResChangesToTable([patchedItem]);
            } else {
              currentItems = nextClaimedList;
              paintCurrentItems();
            }
            ctx.toast('تم استلام الحجز في قائمتك بنجاح.');
            return root.RGApi.callApi('claimReservation', {
              reservationId: rid,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                currentItems = prevItems;
                paintCurrentItems();
                ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true);
              }
            }).catch(function () {
              currentItems = prevItems;
              paintCurrentItems();
              ctx.toast('تعذر الاتصال بالخادم أثناء استلام الحجز.', true);
            });
          }, { spamAction: 'claimReservation', spamSig: rid }).finally(function () {
            var liveBtn = region.querySelector('.btn-claim-res[data-id="' + rid + '"], .btn-unclaim-res[data-id="' + rid + '"]');
            if (liveBtn && (!root.RGApp || !root.RGApp.isActionLocked || (!root.RGApp.isActionLocked('claimReservation:' + rid) && !root.RGApp.isActionLocked('unclaimReservation:' + rid)))) {
              liveBtn.disabled = false;
              liveBtn.removeAttribute('aria-busy');
            }
          });
        });
      });

      region.querySelectorAll('.btn-unclaim-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          runWithLock(btn, 'unclaimReservation:' + rid, function () {
            var prevItems = currentItems.slice();
            var patchedItem = null;
            var nextUnclaimedList = currentItems.map(function (item) {
              if (item.id !== rid) return item;
              var unclaimed = root.RGCrmCore.unclaimReservationRecord(item, currentEmpId);
              patchedItem = Object.assign({}, item, {
                assignedEmployeeIds: unclaimed.assignedEmployeeIds,
                assignedEmployeeNames: unclaimed.assignedEmployeeNames
              });
              return patchedItem;
            });
            if (patchedItem && Array.isArray(radarRawReservations)) {
              radarRawReservations = radarRawReservations.map(function (item) {
                return item && item.id === rid ? Object.assign({}, item, patchedItem) : item;
              });
              paintRadarView();
              paintTodayView();
            }
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('unclaimReservation', { reservationId: rid }, currentUser);
            }
            if (patchedItem && checkHasActiveResFilters()) {
              applyLocalResChangesToTable([patchedItem]);
            } else {
              currentItems = nextUnclaimedList;
              paintCurrentItems();
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
                currentItems = prevItems;
                paintCurrentItems();
                ctx.toast((resp && resp.message) || 'تعذر إلغاء استلام الحجز.', true);
              }
            }).catch(function () {
              currentItems = prevItems;
              paintCurrentItems();
              ctx.toast('تعذر الاتصال بالخادم أثناء إلغاء الاستلام.', true);
            });
          }, { spamAction: 'unclaimReservation', spamSig: rid }).finally(function () {
            var liveBtn = region.querySelector('.btn-claim-res[data-id="' + rid + '"], .btn-unclaim-res[data-id="' + rid + '"]');
            if (liveBtn && (!root.RGApp || !root.RGApp.isActionLocked || (!root.RGApp.isActionLocked('claimReservation:' + rid) && !root.RGApp.isActionLocked('unclaimReservation:' + rid)))) {
              liveBtn.disabled = false;
              liveBtn.removeAttribute('aria-busy');
            }
          });
        });
      });

      region.querySelectorAll('.btn-open-res').forEach(function (btn) {
        var rid = btn.getAttribute('data-id');
        btn.addEventListener('click', function () {
          openReservationDrawer(rid, ctx, employees, function (updatedRes) {
            syncLocalReservationSnapshot(updatedRes);
          });
        });
      });

      var clearSearchEmptyBtn = region.querySelector('#res-empty-clear-search');
      if (clearSearchEmptyBtn) {
        clearSearchEmptyBtn.addEventListener('click', function () {
          var sEl = document.getElementById('res-search');
          var nEl = document.getElementById('res-number-search');
          if (sEl) sEl.value = '';
          if (nEl) nEl.value = '';
          state.search = '';
          state.reservationNumber = '';
          state.page = 1;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          refreshTableRegion({ forceRefresh: true });
        });
      }
    }

    var lastPaintedSearch = String(state.search || '').trim();
    var lastPaintedResNumber = String(state.reservationNumber || '').trim();

    function updateDateFilterHint() {
      var hintEl = container.querySelector('#res-date-filter-hint');
      var toWrap = container.querySelector('#res-to-wrap');
      var fromWrap = container.querySelector('#res-from-wrap');
      var fromEl = document.getElementById('res-from');
      var toEl = document.getElementById('res-to');
      var dFrom = String((fromEl ? fromEl.value : state.dateFrom) || '').trim();
      var dTo = String((toEl ? toEl.value : state.dateTo) || '').trim();
      var isStandaloneEnd = Boolean(dTo && !dFrom);
      if (toWrap) toWrap.classList.toggle('is-standalone-end-active', isStandaloneEnd);
      if (fromWrap) fromWrap.classList.toggle('is-range-start-active', Boolean(dFrom));
      if (!hintEl) return;
      hintEl.classList.toggle('is-standalone-end-active', isStandaloneEnd);
      hintEl.classList.toggle('is-range-active', Boolean(dFrom && dTo));

      if (isStandaloneEnd) {
        hintEl.innerHTML =
          '<span class="rg-date-filter-dot" aria-hidden="true"></span>' +
          '<span class="rg-date-filter-text">' +
            (isEn
              ? ('<strong>Standalone End Date Active:</strong> Showing only bookings ending on <span class="mono" dir="ltr">' + esc(dTo) + '</span> (no Start Date needed).')
              : ('<strong>وضع تاريخ النهاية المستقل مفعّل:</strong> يعرض النظام الحجوزات المنتهية تحديداً بتاريخ <span class="mono" dir="ltr">' + esc(dTo) + '</span> بدون الحاجة لتاريخ بداية.')) +
          '</span>' +
          '<button type="button" class="btn btn-sm rg-date-hint-clear" id="res-clear-to-only">' + (isEn ? 'Clear End Date' : 'مسح تاريخ النهاية') + '</button>';
        var clrToBtn = hintEl.querySelector('#res-clear-to-only');
        if (clrToBtn) {
          clrToBtn.addEventListener('click', function () {
            if (toEl) toEl.value = '';
            state.dateTo = '';
            if (root.RGCrmDatePicker && root.RGCrmDatePicker.enhanceAll) {
              root.RGCrmDatePicker.enhanceAll(container);
            }
            applyFilterChange();
          });
        }
      } else if (dFrom && dTo) {
        hintEl.innerHTML =
          '<span class="rg-date-filter-dot" aria-hidden="true"></span>' +
          '<span class="rg-date-filter-text">' +
            (isEn
              ? ('<strong>Start Date Range:</strong> Showing bookings starting from <span class="mono" dir="ltr">' + esc(dFrom) + '</span> to <span class="mono" dir="ltr">' + esc(dTo) + '</span>.')
              : ('<strong>نطاق تاريخ البداية:</strong> عرض الحجوزات التي تبدأ من <span class="mono" dir="ltr">' + esc(dFrom) + '</span> إلى <span class="mono" dir="ltr">' + esc(dTo) + '</span>.')) +
          '</span>';
      } else if (dFrom) {
        hintEl.innerHTML =
          '<span class="rg-date-filter-dot" aria-hidden="true"></span>' +
          '<span class="rg-date-filter-text">' +
            (isEn
              ? ('<strong>Start Date Filter:</strong> Showing bookings starting from <span class="mono" dir="ltr">' + esc(dFrom) + '</span> onwards.')
              : ('<strong>فلتر البداية فقط:</strong> عرض الحجوزات التي تبدأ من تاريخ <span class="mono" dir="ltr">' + esc(dFrom) + '</span> فأعلى.')) +
          '</span>';
      } else {
        hintEl.innerHTML =
          '<span class="rg-date-filter-dot" aria-hidden="true"></span>' +
          '<span class="rg-date-filter-text">' +
            (isEn
              ? 'Tip: <strong>End Date</strong> works independently — select it alone without a Start Date to list bookings ending on that exact date.'
              : 'معلومة: يمكنك اختيار <strong>تاريخ النهاية</strong> بمفرده (بدون تاريخ بداية) للبحث عن الحجوزات المنتهية في هذا التاريخ المحدد.') +
          '</span>';
      }
    }

    function paintTableError(msg) {
      var region = container.querySelector('#res-table-region');
      if (!region) return;
      region.innerHTML =
        '<div class="rg-error-banner" role="alert">' +
          '<div class="rg-error-banner-body">' +
            '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load reservations' : 'تعذر تحميل الحجوزات') + '</div>' +
            '<div class="rg-error-banner-msg">' + esc(msg || (isEn ? 'Please retry.' : 'يرجى إعادة المحاولة.')) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-primary" id="res-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
        '</div>';
      var rBtn = document.getElementById('res-retry-btn');
      if (rBtn) {
        rBtn.addEventListener('click', function () {
          refreshTableRegion({ forceRefresh: true });
        });
      }
    }

    function updateLifecycleBanner() {
      var bannerEl = container.querySelector('#res-lifecycle-banner');
      if (!bannerEl) return;
      if (state.viewMode === 'cancelled') {
        bannerEl.classList.remove('hidden');
        bannerEl.innerHTML =
          '<div class="rg-error-banner rg-lifecycle-banner-card" style="border-color:rgba(217,119,6,0.34);background:rgba(217,119,6,0.08);">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title" style="color:var(--text-primary);">' + (isEn ? 'Cancelled by Customer (Synced from Rental Gate)' : 'الحجوزات الملغاة من العميل (مزامنة تلقائياً من Rental Gate)') + '</div>' +
              '<div class="rg-error-banner-msg">' + (isEn ? 'Showing bookings cancelled by customers on the external site. Status updates are controlled by Rental Gate sync.' : 'تعرض هذه القائمة الحجوزات التي ألغاها العميل في الموقع الخارجي، وتُحدَّث حالاتها تلقائياً عبر المزامنة بدون رفض أو إلغاء يدوي.') + '</div>' +
            '</div>' +
          '</div>';
      } else if (state.viewMode === 'rejected') {
        bannerEl.classList.remove('hidden');
        bannerEl.innerHTML =
          '<div class="rg-error-banner rg-lifecycle-banner-card" style="border-color:rgba(217,31,43,0.32);background:rgba(217,31,43,0.07);">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title" style="color:var(--text-primary);">' + (isEn ? 'Rejected by Site (Synced from Rental Gate)' : 'الحجوزات المرفوضة من الموقع (مزامنة تلقائياً من Rental Gate)') + '</div>' +
              '<div class="rg-error-banner-msg">' + (isEn ? 'Showing bookings rejected by Rental Gate / providers on the external site.' : 'تعرض هذه القائمة الحجوزات المرفوضة من الموقع الخارجي مع أسباب الرفض وبيانات العميل الكاملة.') + '</div>' +
            '</div>' +
          '</div>';
      } else if (state.viewMode === 'all') {
        bannerEl.classList.remove('hidden');
        bannerEl.innerHTML =
          '<div class="rg-error-banner rg-lifecycle-banner-card" style="border-color:var(--border-hairline);background:var(--bg-surface-subtle);">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title" style="color:var(--text-primary);">' + (isEn ? 'All Reservations (Active, Cancelled & Rejected)' : 'جميع الحجوزات (النشطة والملغاة والمرفوضة)') + '</div>' +
              '<div class="rg-error-banner-msg">' + (isEn ? 'Unified view displaying every reservation pulled from Rental Gate across all statuses.' : 'عرض موحد لكافة الحجوزات المسحوبة من الموقع الخارجي بجميع حالاتها.') + '</div>' +
            '</div>' +
          '</div>';
      } else {
        bannerEl.classList.add('hidden');
        bannerEl.innerHTML = '';
      }
    }

    function updateLifecycleCountsUi(countsObj) {
      if (!countsObj || typeof countsObj !== 'object') return;
      var map = {
        all: 'res-all-tab-count',
        today: 'res-today-tab-count',
        radar: 'res-radar-tab-count',
        rejected: 'res-rejected-tab-count',
        cancelled: 'res-cancelled-tab-count'
      };
      Object.keys(map).forEach(function (k) {
        if (countsObj[k] === undefined || countsObj[k] === null) return;
        var el = container.querySelector('#' + map[k]);
        if (el) el.textContent = String(Number(countsObj[k] || 0));
      });
    }

    function paintTableRegion(data) {
      var region = container.querySelector('#res-table-region');
      if (!region) return;
      lastPaintedSearch = String(state.search || '').trim();
      lastPaintedResNumber = String(state.reservationNumber || '').trim();
      currentItems = data.items || [];
      currentTotalPages = data.totalPages || 1;
      if (data.page && Number(data.page) > 0) {
        state.page = Math.max(1, Math.min(currentTotalPages, Number(data.page)));
      } else if (state.page > currentTotalPages) {
        state.page = Math.max(1, currentTotalPages);
      }
      var totalEl = container.querySelector('#res-total-count');
      if (totalEl) totalEl.textContent = String(data.total || 0);
      if (data.lifecycleCounts) {
        updateLifecycleCountsUi(data.lifecycleCounts);
      }
      syncColsButtonVisibility();
      updateLifecycleBanner();
      region.innerHTML = buildTableRegionHtml(data);
      bindTableRegionEvents(region);
    }

    function paintCurrentItems(overrideTotal) {
      var totalVal = overrideTotal !== undefined
        ? Number(overrideTotal)
        : Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length);
      paintTableRegion({
        items: currentItems,
        total: totalVal,
        page: state.page,
        totalPages: currentTotalPages
      });
    }

    function applyLocalResChangesToTable(changedList, deletedIds) {
      var core = root.RGCrmCore;
      var totalEl = container.querySelector('#res-total-count');
      var curTotal = Number((totalEl && totalEl.textContent) || currentItems.length);
      var delIdsList = Array.isArray(deletedIds) ? deletedIds : [];
      var curLifeMode = getActiveLifecycleFilter();
      if (core && core.reapplyReservationDeltaToFilteredList && checkHasActiveResFilters()) {
        var filterPayload = getQueryPayload();
        var userCtx = {
          role: (currentUser && currentUser.role) || 'agent',
          employeeId: currentEmpId,
          allowAgentViewAll: true,
          user: currentUser
        };
        var res = core.reapplyReservationDeltaToFilteredList(currentItems, changedList || [], delIdsList, filterPayload, [], userCtx);
        var pageSize = Math.max(1, Number(state.pageSize || 20));
        var nextTotal = Math.max(res.items.length, curTotal - res.removedCount + res.addedCount);
        currentItems = res.items.slice(0, pageSize);
        currentTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
        paintTableRegion({
          items: currentItems,
          total: nextTotal,
          page: Math.min(state.page, currentTotalPages),
          totalPages: currentTotalPages
        });
        if (currentTotalPages > 1 || (res.removedCount > 0 && curTotal > pageSize)) {
          refreshTableRegion({ silentRefresh: true });
        }
        return;
      }
      var delSet = {};
      delIdsList.forEach(function (id) { if (id) delSet[id] = true; });
      var byIdChg = {};
      (changedList || []).forEach(function (ch) {
        if (ch && ch.id) byIdChg[ch.id] = ch;
      });
      var matchedAny = false;
      var removedCount = 0;
      var nextList = [];
      currentItems.forEach(function (it) {
        if (it && delSet[it.id]) {
          matchedAny = true;
          removedCount += 1;
          return;
        }
        if (it && byIdChg[it.id]) {
          matchedAny = true;
          var mergedIt = Object.assign({}, it, byIdChg[it.id]);
          if (!doesResMatchViewLifecycle(mergedIt, curLifeMode)) {
            removedCount += 1;
            return;
          }
          nextList.push(mergedIt);
          return;
        }
        if (it && !doesResMatchViewLifecycle(it, curLifeMode)) {
          removedCount += 1;
          return;
        }
        nextList.push(it);
      });
      currentItems = nextList;
      if (matchedAny) {
        paintCurrentItems(Math.max(currentItems.length, curTotal - removedCount));
      } else {
        refreshTableRegion({ silentRefresh: true });
      }
    }

    function syncLocalReservationSnapshot(updatedRes) {
      var core = root.RGCrmCore;
      var isNowInactive = Boolean(updatedRes && core && core.isInactiveReservation && core.isInactiveReservation(updatedRes));
      if (updatedRes && updatedRes.id) {
        applyLocalResChangesToTable([updatedRes]);
        if (Array.isArray(radarRawReservations)) {
          if (isNowInactive) {
            radarRawReservations = radarRawReservations.filter(function (it) { return it && it.id !== updatedRes.id; });
          } else {
            radarRawReservations = radarRawReservations.map(function (it) {
              return (it && it.id === updatedRes.id) ? Object.assign({}, it, updatedRes) : it;
            });
          }
          paintRadarView();
          paintTodayView();
        }
        if (Array.isArray(calendarRawItems)) {
          if (isNowInactive) {
            calendarRawItems = calendarRawItems.filter(function (it) { return it && it.id !== updatedRes.id; });
          } else {
            calendarRawItems = calendarRawItems.map(function (it) {
              return (it && it.id === updatedRes.id) ? Object.assign({}, it, updatedRes) : it;
            });
          }
          if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
            paintTodayView();
          }
        }
      } else {
        refreshTableRegion({ silentRefresh: true });
      }
    }

    function preFilterVisibleItemsForSearch() {
      var core = root.RGCrmCore;
      var curSearchClean = String(state.search || '').trim();
      var curResNumberClean = String(state.reservationNumber || '').trim();
      var region = container.querySelector('#res-table-region');
      if (!region) return;
      if ((curSearchClean || curResNumberClean) && core && core.filterReservations && currentItems.length > 0) {
        var userCtx = {
          role: (currentUser && currentUser.role) || 'agent',
          employeeId: currentEmpId,
          allowAgentViewAll: true,
          user: currentUser
        };
        var strictMatches = core.filterReservations(currentItems, [], getQueryPayload(), userCtx);
        if (strictMatches.length > 0) {
          currentItems = strictMatches;
          region.innerHTML = buildTableRegionHtml({
            items: strictMatches,
            total: strictMatches.length,
            page: 1,
            totalPages: 1
          });
          bindTableRegionEvents(region);
          return;
        }
      }
      currentItems = [];
      region.innerHTML = '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
    }

    async function refreshTableRegion(opts) {
      var o = opts || {};
      var seq = ++activeFetchSeq;
      var region = container.querySelector('#res-table-region');
      var curSearchClean = String(state.search || '').trim();
      var curResNumberClean = String(state.reservationNumber || '').trim();
      var searchChanged = (curSearchClean !== lastPaintedSearch) || (curResNumberClean !== lastPaintedResNumber);
      if (searchChanged && !o.silentRefresh) {
        preFilterVisibleItemsForSearch();
      } else if (region && !o.silentRefresh && currentItems.length === 0) {
        region.innerHTML = '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
      }
      var queryPayload = getQueryPayload({
        forceRefresh: Boolean(o.forceRefresh || searchChanged),
        silentRefresh: Boolean(o.silentRefresh),
        abortKey: 'res:list'
      });
      var resp = await root.RGApi.callApi('getReservations', queryPayload);
      if (seq !== activeFetchSeq || !container.isConnected) return;
      if (resp && resp.aborted) return;
      if (resp && resp.success && resp.data) {
        var nextTotalPages = Math.max(1, Number(resp.data.totalPages || 1));
        if (!o._clampRetried && state.page > nextTotalPages && Number(resp.data.total || 0) > 0) {
          state.page = nextTotalPages;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          return refreshTableRegion(Object.assign({}, o, { _clampRetried: true, forceRefresh: true }));
        }
        paintTableRegion(resp.data);
      } else if (searchChanged || (!o.silentRefresh && currentItems.length === 0)) {
        currentItems = [];
        paintTableError((resp && resp.message) || 'تعذر تحميل الحجوزات.');
      } else if (!o.silentRefresh && ctx && ctx.toast) {
        ctx.toast((resp && resp.message) || 'تعذر تحديث الحجوزات.', true);
      }
    }

    updateDateFilterHint();
    if (initialLoadError) {
      paintTableError(initialLoadError);
    } else {
      paintTableRegion(payload);
    }

    function paintSyncWarningBannerFromReport(rec) {
      var syncWarnBanner = container.querySelector('#res-sync-warning-banner');
      if (!syncWarnBanner) return;
      if (!rec || typeof rec !== 'object') {
        syncWarnBanner.classList.add('hidden');
        syncWarnBanner.innerHTML = '';
        return;
      }
      var failedCount = Number(rec.failedCount || 0);
      var missingCount = Number(rec.missingLocalCount || 0);
      var eligibleGap = Number(rec.eligibleCountGap || 0);
      var missingElig = Array.isArray(rec.missingEligibleIds) ? rec.missingEligibleIds : [];
      var unfetchedGap = Number(rec.unfetchedSourceGap || 0);
      var incompleteEps = Array.isArray(rec.incompleteEndpoints) ? rec.incompleteEndpoints : [];
      var backfillFailed = Array.isArray(rec.backfillFailedIds) ? rec.backfillFailedIds : [];
      var missingIdsList = Array.isArray(rec.missingSourceIds) ? rec.missingSourceIds : [];
      var isIncomplete = rec.syncComplete === false || failedCount > 0 || missingCount > 0 || eligibleGap > 0 || missingElig.length > 0 || unfetchedGap > 0 || incompleteEps.length > 0 || backfillFailed.length > 0;
      if (!isIncomplete) {
        syncWarnBanner.classList.add('hidden');
        syncWarnBanner.innerHTML = '';
        return;
      }
      var warnParts = [];
      if (failedCount > 0) warnParts.push('فشل ' + failedCount);
      if (missingCount > 0) warnParts.push('ناقص ' + missingCount);
      if (eligibleGap > 0) warnParts.push('فرق المستحقة ' + eligibleGap + ' (' + Number(rec.dbEligibleCount || 0) + '/' + Number(rec.sourceEligibleCount || 0) + ')');
      if (unfetchedGap > 0) warnParts.push('فجوة مصدر ' + unfetchedGap);
      if (backfillFailed.length > 0) warnParts.push('فشل جلب ' + backfillFailed.length);
      if (incompleteEps.length > 0) warnParts.push('واجهات غير مكتملة: ' + incompleteEps.length);
      var combinedMissingIds = Array.from(new Set(missingIdsList.concat(backfillFailed).concat(missingElig)));
      var idPreview = combinedMissingIds.length
        ? (' · المعرفات: ' + combinedMissingIds.slice(0, 8).join(', ') + (combinedMissingIds.length > 8 ? (' (+' + (combinedMissingIds.length - 8) + ')') : ''))
        : '';
      syncWarnBanner.classList.remove('hidden');
      syncWarnBanner.innerHTML =
        '<div class="rg-error-banner" role="alert" style="border-color:rgba(217,31,43,0.38);background:rgba(217,31,43,0.06);">' +
          '<div class="rg-error-banner-body">' +
            '<div class="rg-error-banner-title">' + (isEn ? 'Sync Reconciliation Mismatch' : 'تحذير عدم تطابق أعداد السحب مع المصدر') + '</div>' +
            '<div class="rg-error-banner-msg">' + esc(warnParts.join(' · ') + idPreview) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-primary" id="res-retry-failed-sync-btn">' + (isEn ? 'Retry Missing Records' : 'إعادة معالجة السجلات الناقصة') + '</button>' +
        '</div>';
      var resRetryBtn = syncWarnBanner.querySelector('#res-retry-failed-sync-btn');
      if (resRetryBtn) {
        resRetryBtn.addEventListener('click', function () {
          runWithLock(resRetryBtn, 'retryFailedSyncRecords', async function () {
            var rPrev = resRetryBtn.textContent;
            resRetryBtn.textContent = isEn ? 'Retrying...' : 'جاري إعادة المعالجة...';
            var rResp = await root.RGApi.callApi('retryFailedSyncRecords', {});
            if (rResp && rResp.success && rResp.data) {
              var rd = rResp.data;
              var stillGap = rd.syncComplete === false || Number(rd.failedCount || 0) > 0 || Number(rd.missingLocalCount || 0) > 0 || Number(rd.eligibleCountGap || 0) > 0 || Number(rd.unfetchedSourceGap || 0) > 0;
              if (!stillGap) {
                syncWarnBanner.classList.add('hidden');
                syncWarnBanner.innerHTML = '';
                ctx.toast(isEn ? 'Missing records recovered successfully.' : 'تمت إعادة معالجة السجلات الناقصة واكتمل التطابق بنجاح.');
              } else {
                paintSyncWarningBannerFromReport(rd);
                ctx.toast(isEn ? 'Some records still missing after retry.' : 'ما زال هناك نقص بعد إعادة المحاولة.', true);
                if (resRetryBtn.isConnected !== false) resRetryBtn.textContent = rPrev;
              }
              refreshTableRegion({ forceRefresh: true });
            } else {
              ctx.toast((rResp && rResp.message) || 'تعذر إعادة معالجة السجلات الفاشلة.', true);
              if (resRetryBtn.isConnected !== false) resRetryBtn.textContent = rPrev;
            }
          });
        });
      }
    }

    if (canPullReservations || isGeneralManager) {
      root.RGApi.callApi('getSyncStatus', { silentRefresh: true, abortKey: 'res:syncWarn' }).then(function (sRes) {
        if (!container.isConnected || !sRes || !sRes.success || !sRes.data) return;
        if (sRes.data.lastReconciliation) {
          paintSyncWarningBannerFromReport(sRes.data.lastReconciliation);
        }
      }).catch(function () {});
    }

    function applyFilterChange() {
      state.search = document.getElementById('res-search').value;
      var resNumInp = document.getElementById('res-number-search');
      state.reservationNumber = resNumInp ? resNumInp.value : '';
      state.company = document.getElementById('res-company').value;
      state.branch = document.getElementById('res-branch').value;
      state.status = document.getElementById('res-status').value;
      state.employeeId = document.getElementById('res-emp').value;
      state.priority = document.getElementById('res-prio').value;
      state.dateFrom = document.getElementById('res-from').value;
      state.dateTo = document.getElementById('res-to').value;
      var tfEl = document.getElementById('res-time-field');
      var tfFromEl = document.getElementById('res-time-from');
      var tfToEl = document.getElementById('res-time-to');
      var ovEl = document.getElementById('res-overdue-unpaid');
      state.timeField = tfEl ? tfEl.value : 'both';
      state.timeFrom = tfFromEl ? tfFromEl.value : '';
      state.timeTo = tfToEl ? tfToEl.value : '';
      state.unfollowedOnly = document.getElementById('res-unfollowed').checked;
      state.hasProblemsOnly = document.getElementById('res-problems').checked;
      state.overdueUnpaidOnly = Boolean(ovEl && ovEl.checked);
      state.page = 1;
      updateDateFilterHint();
      if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      refreshTableRegion();
    }

    var searchTimer = null;
    var resSearchEl = document.getElementById('res-search');
    resSearchEl.addEventListener('input', function () {
      state.search = this.value;
      state.page = 1;
      if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      preFilterVisibleItemsForSearch();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilterChange, 180);
    });
    resSearchEl.addEventListener('search', function () {
      clearTimeout(searchTimer);
      applyFilterChange();
    });
    resSearchEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        clearTimeout(searchTimer);
        applyFilterChange();
      }
    });

    var resNumberSearchEl = document.getElementById('res-number-search');
    if (resNumberSearchEl) {
      resNumberSearchEl.addEventListener('input', function () {
        state.reservationNumber = this.value;
        state.page = 1;
        if (ctx.saveRouteFilters) ctx.saveRouteFilters();
        preFilterVisibleItemsForSearch();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilterChange, 180);
      });
      resNumberSearchEl.addEventListener('search', function () {
        clearTimeout(searchTimer);
        applyFilterChange();
      });
      resNumberSearchEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          clearTimeout(searchTimer);
          applyFilterChange();
        }
      });
    }

    ['res-from', 'res-to'].forEach(function (id) {
      var dEl = document.getElementById(id);
      if (dEl) {
        dEl.addEventListener('input', updateDateFilterHint);
      }
    });

    ['res-company', 'res-branch', 'res-status', 'res-emp', 'res-prio', 'res-from', 'res-to', 'res-time-field', 'res-time-from', 'res-time-to', 'res-unfollowed', 'res-problems', 'res-overdue-unpaid'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', applyFilterChange);
    });

    document.getElementById('res-reset-filters').addEventListener('click', function () {
      Object.assign(state, { search: '', reservationNumber: '', company: '', branch: '', status: '', employeeId: '', priority: '', dateFrom: '', dateTo: '', timeField: 'both', timeFrom: '', timeTo: '', unfollowedOnly: false, hasProblemsOnly: false, overdueUnpaidOnly: false, sortBy: 'sourceOrder', sortDir: 'asc', explicitSort: false, page: 1 });
      document.getElementById('res-search').value = '';
      var resNumResetEl = document.getElementById('res-number-search');
      if (resNumResetEl) resNumResetEl.value = '';
      document.getElementById('res-company').value = '';
      document.getElementById('res-branch').value = '';
      document.getElementById('res-status').value = '';
      document.getElementById('res-emp').value = '';
      document.getElementById('res-prio').value = '';
      document.getElementById('res-from').value = '';
      document.getElementById('res-to').value = '';
      if (root.RGCrmDatePicker && root.RGCrmDatePicker.enhanceAll) {
        root.RGCrmDatePicker.enhanceAll(container);
      }
      var tfEl = document.getElementById('res-time-field');
      var tfFromEl = document.getElementById('res-time-from');
      var tfToEl = document.getElementById('res-time-to');
      var ovEl = document.getElementById('res-overdue-unpaid');
      if (tfEl) tfEl.value = 'both';
      if (tfFromEl) tfFromEl.value = '';
      if (tfToEl) tfToEl.value = '';
      document.getElementById('res-unfollowed').checked = false;
      document.getElementById('res-problems').checked = false;
      if (ovEl) ovEl.checked = false;
      updateDateFilterHint();
      if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      refreshTableRegion({ forceRefresh: true });
      ctx.toast(ctx.lang === 'en' ? 'Filters reset.' : 'تمت إعادة ضبط جميع الفلاتر.');
    });

    var colsBtnEl = document.getElementById('res-cols-btn');
    if (colsBtnEl) {
      colsBtnEl.addEventListener('click', function () {
        var panel = document.getElementById('res-cols-panel');
        if (panel) panel.classList.toggle('hidden');
      });
    }

    container.querySelectorAll('.res-col-toggle').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var next = Array.from(container.querySelectorAll('.res-col-toggle:checked')).map(function (el) { return el.value; });
        if (next.length > 0) {
          state.visibleCols = next;
          localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
          paintTableRegion({
            items: currentItems,
            total: Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length),
            page: state.page,
            totalPages: currentTotalPages
          });
        }
      });
    });

    var colsResetBtn = document.getElementById('res-cols-reset');
    if (colsResetBtn) {
      colsResetBtn.addEventListener('click', function () {
        var roleResetRes = (root.RGApp && typeof root.RGApp.getEffectiveRoleUiResolution === 'function')
          ? root.RGApp.getEffectiveRoleUiResolution(currentUser)
          : null;
        state.visibleCols = (roleResetRes && roleResetRes.hasRoleOverride && Array.isArray(roleResetRes.visibleCols) && roleResetRes.visibleCols.length)
          ? roleResetRes.visibleCols.slice()
          : DEFAULT_VISIBLE_COLS.slice();
        try {
          localStorage.removeItem(COLS_STORAGE_KEY);
        } catch (_e) {}
        container.querySelectorAll('.res-col-toggle').forEach(function (chk) {
          chk.checked = state.visibleCols.indexOf(chk.value) !== -1;
        });
        paintTableRegion({
          items: currentItems,
          total: Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length),
          page: state.page,
          totalPages: currentTotalPages
        });
        ctx.toast('تمت استعادة العرض المرتب للأعمدة الأساسية.');
      });
    }

    var pullPresetEl = document.getElementById('res-pull-preset');
    var pullDatesWrap = document.getElementById('res-pull-custom-dates');
    var pullFromEl = document.getElementById('res-pull-from');
    var pullToEl = document.getElementById('res-pull-to');
    if (pullPresetEl && pullDatesWrap) {
      pullPresetEl.addEventListener('change', function () {
        state.pullPreset = pullPresetEl.value;
        pullDatesWrap.classList.toggle('hidden', pullPresetEl.value !== 'custom');
        if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      });
    }
    if (pullFromEl) {
      pullFromEl.addEventListener('change', function () {
        state.pullFrom = pullFromEl.value;
        if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      });
    }
    if (pullToEl) {
      pullToEl.addEventListener('change', function () {
        state.pullTo = pullToEl.value;
        if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      });
    }

    var pullBtn = document.getElementById('res-pull-btn');
    if (pullBtn) {
      pullBtn.addEventListener('click', function () {
        runWithLock(pullBtn, 'pullReservations', async function () {
          var prevLabel = pullBtn.textContent;
          pullBtn.textContent = ctx.lang === 'en' ? 'Pulling reservations...' : 'جاري سحب الحجوزات...';
          try {
            var pullPayload = {};
            if (isGeneralManager && pullPresetEl) {
              var chosenPreset = pullPresetEl.value || 'all';
              var chosenFrom = pullFromEl ? pullFromEl.value : '';
              var chosenTo = pullToEl ? pullToEl.value : '';
              if (chosenPreset === 'custom') {
                if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates && pullDatesWrap) {
                  var pullCheck = root.RGCrmDatePicker.validateContainerDates(pullDatesWrap);
                  if (!pullCheck.valid) {
                    ctx.toast(pullCheck.message || 'يرجى التحقق من صحة تواريخ السحب.', true);
                    return;
                  }
                }
                if (!chosenFrom && !chosenTo) {
                  ctx.toast('يرجى تحديد تاريخ البداية أو تاريخ النهاية على الأقل.', true);
                  return;
                }
              }
              pullPayload = {
                preset: chosenPreset,
                dateFrom: chosenPreset === 'custom' ? chosenFrom : '',
                dateTo: chosenPreset === 'custom' ? chosenTo : ''
              };
            }
            var resp = await root.RGApi.callApi('pullReservations', pullPayload);
            if (resp.success && resp.data) {
              var d = resp.data;
              var rangeNote = '';
              if (d.appliedRange && d.appliedRange.hasCustomRange && (d.appliedRange.dateFrom || d.appliedRange.dateTo)) {
                if (d.appliedRange.dateFrom && d.appliedRange.dateTo) {
                  rangeNote = ' (' + d.appliedRange.dateFrom + ' → ' + d.appliedRange.dateTo + ')';
                } else if (d.appliedRange.dateFrom) {
                  rangeNote = ' (من ' + d.appliedRange.dateFrom + ')';
                } else {
                  rangeNote = ' (حتى ' + d.appliedRange.dateTo + ')';
                }
              }
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
              var missingIdsList = Array.isArray(d.missingSourceIds) ? d.missingSourceIds : [];
              var isIncomplete = d.syncComplete === false || failedCount > 0 || missingCount > 0 || eligibleGap > 0 || missingElig.length > 0 || unfetchedGap > 0 || incompleteEps.length > 0 || backfillFailed.length > 0;
              var sb = d.sourceBreakdown || null;
              var diagHint = '';
              if (imported === 0 && updated === 0 && !isIncomplete) {
                var fetched = d.fetchedCount || 0;
                if (fetched > 0 && d.excludedFilteredCount === fetched) {
                  diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعدت جميعها حسب الحالات المستبعدة في الإعدادات';
                } else if (fetched > 0 && d.rangeFilteredCount > 0) {
                  diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعد ' + d.rangeFilteredCount + ' خارج النطاق الزمني المحدد';
                } else if (fetched === 0) {
                  diagHint = ' — أرجعت الواجهة 0 حجز لهذا الحساب/الفترة';
                }
              }
              paintSyncWarningBannerFromReport(isIncomplete ? d : null);
              if (isIncomplete) {
                var warnParts = [];
                if (failedCount > 0) warnParts.push('فشل ' + failedCount);
                if (missingCount > 0) warnParts.push('ناقص ' + missingCount);
                if (eligibleGap > 0) warnParts.push('فرق المستحقة ' + eligibleGap + ' (' + Number(d.dbEligibleCount || 0) + '/' + Number(d.sourceEligibleCount || 0) + ')');
                if (unfetchedGap > 0) warnParts.push('فجوة مصدر ' + unfetchedGap);
                if (backfillFailed.length > 0) warnParts.push('فشل جلب ' + backfillFailed.length);
                if (incompleteEps.length > 0) warnParts.push('واجهات غير مكتملة: ' + incompleteEps.length);
                var combinedMissingIds = Array.from(new Set(missingIdsList.concat(backfillFailed).concat(missingElig)));
                var idPreview = combinedMissingIds.length
                  ? (' · المعرفات: ' + combinedMissingIds.slice(0, 8).join(', ') + (combinedMissingIds.length > 8 ? (' (+' + (combinedMissingIds.length - 8) + ')') : ''))
                  : '';
                var warnMsg = ctx.lang === 'en'
                  ? ('Incomplete pull' + rangeNote + ': ' + imported + ' new · ' + updated + ' updated · ' + warnParts.join(' · ') + idPreview)
                  : ('تحذير: السحب غير مكتمل' + rangeNote + ' (' + warnParts.join(' · ') + ') — تم حفظ ' + (imported + updated) + ' سجل' + idPreview);
                ctx.toast(warnMsg, true);
              } else {
                var eligHint = Number(d.sourceEligibleCount || 0) > 0
                  ? (ctx.lang === 'en'
                      ? (' · eligible ' + Number(d.dbEligibleCount || 0) + '/' + Number(d.sourceEligibleCount || 0))
                      : (' · المستحقة ' + Number(d.dbEligibleCount || 0) + '/' + Number(d.sourceEligibleCount || 0)))
                  : '';
                var overlapHint = (sb && Number(sb.uniqueSourceTotal || 0) > 0)
                  ? (ctx.lang === 'en'
                      ? (' · ' + sb.uniqueSourceTotal + '/' + sb.uniqueSourceTotal + ' unique' + eligHint)
                      : (' · ' + sb.uniqueSourceTotal + '/' + sb.uniqueSourceTotal + ' إجمالي فريد' + eligHint))
                  : eligHint;
                var msg = ctx.lang === 'en'
                  ? ('Pulled reservations' + rangeNote + ': ' + imported + ' new · ' + updated + ' updated · ' + exts + ' extensions' + overlapHint)
                  : ('تم سحب الحجوزات والتحقق بنجاح' + rangeNote + ': ' + imported + ' جديد · ' + updated + ' محدث · ' + exts + ' تمديد' + overlapHint + diagHint);
                ctx.toast(msg);
              }
              ctx.refreshNotifications();
              refreshTableRegion({ forceRefresh: true });
              refreshRadarData();
              if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
                ensureTodayCalendarLoaded({ forceRefresh: true });
              } else {
                calendarRawItems = null;
                calendarLoadedWindow = { from: '', to: '' };
              }
            } else {
              ctx.toast((resp && resp.message) || 'تعذر سحب الحجوزات.', true);
            }
          } finally {
            pullBtn.textContent = prevLabel;
          }
        });
      });
    }

    function buildResExportMeta() {
      var selectedItems = currentItems.filter(function (row) { return Boolean(selectedResIds[row.id]); });
      var sourceRows = selectedItems.length > 0 ? selectedItems : currentItems;
      var tabTitleAr = state.viewMode === 'rejected'
        ? 'تقرير الحجوزات المرفوضة'
        : (state.viewMode === 'cancelled' ? 'تقرير الحجوزات الملغاة' : 'تقرير جدول الحجوزات');
      var tabTitleEn = state.viewMode === 'rejected'
        ? 'Rejected Reservations Report'
        : (state.viewMode === 'cancelled' ? 'Cancelled Reservations Report' : 'Reservations Report');
      var periodStr = (state.dateFrom || state.dateTo)
        ? ((state.dateFrom || '...') + ' → ' + (state.dateTo || '...'))
        : (isEn ? 'All Dates / Active Filter View' : 'كافة التواريخ / حسب الفلتر النشط');
      var filtersArr = [
        selectedItems.length > 0 ? ((isEn ? 'Selected Only: ' : 'محددة فقط: ') + selectedItems.length) : '',
        state.company ? ((isEn ? 'Company: ' : 'الشركة: ') + state.company) : '',
        state.branch ? ((isEn ? 'Branch: ' : 'الفرع: ') + state.branch) : '',
        state.status ? ((isEn ? 'Status: ' : 'الحالة: ') + state.status) : '',
        state.employeeId ? ((isEn ? 'Employee: ' : 'الموظف: ') + ((employees.find(function (e) { return e.id === state.employeeId; }) || {}).name || state.employeeId)) : '',
        state.priority ? ((isEn ? 'Priority: ' : 'الأولوية: ') + state.priority) : '',
        state.search ? ((isEn ? 'Search: ' : 'البحث: ') + state.search) : '',
        state.reservationNumber ? ((isEn ? 'Booking #: ' : 'رقم الحجز: ') + state.reservationNumber) : '',
        state.unfollowedOnly ? (isEn ? 'Unfollowed Only' : 'بانتظار المتابعة فقط') : '',
        state.hasProblemsOnly ? (isEn ? 'Has Problems' : 'تحتوي مشكلات') : '',
        state.overdueUnpaidOnly ? (isEn ? 'Overdue Unpaid' : 'متأخرة الدفع') : ''
      ].filter(Boolean);
      return {
        selectedItems: selectedItems,
        sourceRows: sourceRows,
        tabTitleAr: tabTitleAr,
        tabTitleEn: tabTitleEn,
        periodStr: periodStr,
        filtersStr: filtersArr.join(' · ')
      };
    }

    async function resolveExportSourceRows(metaExp) {
      if (metaExp.selectedItems && metaExp.selectedItems.length > 0) {
        return metaExp.selectedItems;
      }
      var totalMatched = Number(payload.total || 0);
      if (totalMatched <= currentItems.length && Number(state.page || 1) === 1 && currentTotalPages <= 1) {
        return currentItems.slice();
      }
      if (typeof ctx.toast === 'function') {
        ctx.toast(isEn ? 'Preparing all matching records for export...' : 'جاري تجهيز جميع السجلات المطابقة للتصدير...');
      }
      var collected = [];
      var seenIds = {};
      var pageNum = 1;
      var totalPagesExp = 1;
      var chunkSize = 200;
      while (pageNum <= totalPagesExp && pageNum <= 25) {
        var qExp = getQueryPayload({
          page: pageNum,
          pageSize: chunkSize,
          exportMode: true,
          abortKey: ''
        });
        var expResp = await root.RGApi.callApi('getReservations', qExp);
        if (!expResp || !expResp.success || !expResp.data) break;
        var batch = Array.isArray(expResp.data.items) ? expResp.data.items : [];
        batch.forEach(function (row) {
          var rk = String((row && (row.id || row.reservationNumber)) || '');
          if (rk && seenIds[rk]) return;
          if (rk) seenIds[rk] = true;
          collected.push(row);
        });
        totalPagesExp = Math.max(1, Number(expResp.data.totalPages || 1));
        if (batch.length < chunkSize) break;
        pageNum += 1;
      }
      return collected.length ? collected : currentItems.slice();
    }

    async function triggerResExcelExport() {
      var metaExp = buildResExportMeta();
      var fullSourceRows = await resolveExportSourceRows(metaExp);
      var exportHeaders = state.viewMode === 'rejected'
        ? REJECTED_COLUMNS.slice()
        : (state.viewMode === 'cancelled'
            ? CANCELLED_COLUMNS.slice()
            : ALL_COLUMNS.filter(function (col) { return col.key !== 'customerIdNumber' || canViewId; }));
      var exportSheetName = state.viewMode === 'rejected'
        ? (isEn ? 'Rejected' : 'الحجوزات المرفوضة')
        : (state.viewMode === 'cancelled' ? (isEn ? 'Cancelled' : 'الحجوزات الملغاة') : (isEn ? 'Reservations' : 'جدول الحجوزات'));
      var emptyReasonExp = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
      var coreRef = root.RGCrmCore || {};
      var exportRows = fullSourceRows.map(function (row) {
        var copy = Object.assign({}, row);
        if (state.viewMode === 'rejected') {
          copy.rejectionReason = (coreRef.sanitizeReasonText ? coreRef.sanitizeReasonText(copy.rejectionReason) : String(copy.rejectionReason || '').trim()) || emptyReasonExp;
        } else if (state.viewMode === 'cancelled') {
          copy.cancellationReason = (coreRef.sanitizeReasonText ? coreRef.sanitizeReasonText(copy.cancellationReason) : String(copy.cancellationReason || '').trim()) || emptyReasonExp;
        }
        return copy;
      });
      var repTitleFull = isEn ? metaExp.tabTitleEn : metaExp.tabTitleAr;
      var totalAmtSum = Math.round(exportRows.reduce(function (s, r) { return s + Number(r.totalAmount || 0); }, 0) * 100) / 100;
      var extAmtSum = Math.round(exportRows.reduce(function (s, r) { return s + Number(r.extensionsAmount || 0); }, 0) * 100) / 100;
      var summaryItems = [
        { label: isEn ? 'Matching Results' : 'إجمالي النتائج المطابقة', value: Number(payload.total || exportRows.length) },
        { label: isEn ? 'Exported Rows' : 'الصفوف المصدرة', value: exportRows.length },
        { label: isEn ? 'Active Tab' : 'التبويب النشط', value: repTitleFull }
      ];
      if (state.viewMode !== 'rejected' && state.viewMode !== 'cancelled') {
        summaryItems.push({ label: isEn ? 'Total Amount' : 'إجمالي المبالغ', value: totalAmtSum.toLocaleString('en-US') });
        if (extAmtSum > 0) {
          summaryItems.push({ label: isEn ? 'Extensions Amount' : 'مبالغ التمديد', value: extAmtSum.toLocaleString('en-US') });
        }
      }
      await root.RGReports.exportExcelWorkbook([{
        name: exportSheetName,
        title: repTitleFull,
        periodText: metaExp.periodStr,
        filtersText: metaExp.filtersStr,
        summaryItems: summaryItems,
        headers: exportHeaders,
        rows: exportRows
      }], 'rental-gate-reservations.xlsx', {
        lang: ctx.lang,
        title: repTitleFull,
        periodText: metaExp.periodStr,
        filtersText: metaExp.filtersStr
      });
      ctx.toast(isEn ? 'Reservations exported to Excel successfully.' : 'تم تصدير جدول الحجوزات إلى Excel بنجاح.');
    }

    async function triggerResPdfExport() {
      if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
        ctx.toast(isEn ? 'PDF Studio is unavailable.' : 'وحدة معاينة وتصدير PDF غير متاحة.', true);
        return;
      }
      var metaExp = buildResExportMeta();
      var fullSourceRows = await resolveExportSourceRows(metaExp);
      var activeCols = state.viewMode === 'rejected'
        ? REJECTED_COLUMNS.slice()
        : (state.viewMode === 'cancelled'
            ? CANCELLED_COLUMNS.slice()
            : ALL_COLUMNS.filter(function (c) {
                if (c.key === 'customerIdNumber' && !canViewId) return false;
                return state.visibleCols.indexOf(c.key) !== -1;
              }));
      var allScopeCols = state.viewMode === 'rejected'
        ? REJECTED_COLUMNS.slice()
        : (state.viewMode === 'cancelled'
            ? CANCELLED_COLUMNS.slice()
            : ALL_COLUMNS.filter(function (c) { return c.key !== 'customerIdNumber' || canViewId; }));
      var emptyReasonExp = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
      var corePdfRef = root.RGCrmCore || {};
      var pdfRows = fullSourceRows.map(function (row) {
        var copy = Object.assign({}, row);
        copy.startDate = formatDateOnly(row.startDate);
        copy.endDate = formatDateOnly(row.endDate);
        copy.extendedUntilDate = row.extendedUntilDate ? formatDateOnly(row.extendedUntilDate) : '-';
        copy.lastUpdatedAt = row.lastUpdatedAt ? formatTimestamp(row.lastUpdatedAt, ctx.lang) : '-';
        copy.sourceCreatedAt = row.sourceCreatedAt ? formatTimestamp(row.sourceCreatedAt, ctx.lang) : '-';
        copy.rejectedAt = row.rejectedAt ? formatTimestamp(row.rejectedAt, ctx.lang) : '-';
        copy.cancelledAt = row.cancelledAt ? formatTimestamp(row.cancelledAt, ctx.lang) : '-';
        copy.assignedEmployeeNames = Array.isArray(row.assignedEmployeeNames) && row.assignedEmployeeNames.length
          ? row.assignedEmployeeNames.join('، ')
          : (isEn ? 'Unassigned' : 'متاح للاستلام');
        if (state.viewMode === 'rejected') {
          copy.rejectionReason = (corePdfRef.sanitizeReasonText ? corePdfRef.sanitizeReasonText(copy.rejectionReason) : String(copy.rejectionReason || '').trim()) || emptyReasonExp;
        } else if (state.viewMode === 'cancelled') {
          copy.cancellationReason = (corePdfRef.sanitizeReasonText ? corePdfRef.sanitizeReasonText(copy.cancellationReason) : String(copy.cancellationReason || '').trim()) || emptyReasonExp;
        }
        return copy;
      });
      var scopeKey = 'reservations_' + (state.viewMode || 'all');
      root.RGReports.openPdfStudio({
        ctx: ctx,
        title: isEn ? metaExp.tabTitleEn : metaExp.tabTitleAr,
        filename: 'rental-gate-' + scopeKey + '.pdf',
        scopeKey: scopeKey,
        availableColumns: allScopeCols.map(function (c) {
          return {
            key: c.key,
            label: c.label,
            visible: activeCols.some(function (ac) { return ac.key === c.key; }),
            widthWeight: (c.key === 'customerName' || c.key === 'carName' || c.key === 'lastUpdateText' || c.key === 'rejectionReason' || c.key === 'cancellationReason' || c.key === 'driverNotes') ? 1.4 : 1
          };
        }),
        columns: activeCols.map(function (c) {
          return {
            key: c.key,
            label: c.label,
            formatType: (c.key === 'reservationNumber' || c.key === 'customerPhone' || c.key === 'customerIdNumber' || c.key === 'startDate' || c.key === 'endDate') ? 'ltr' : undefined,
            widthWeight: (c.key === 'customerName' || c.key === 'carName' || c.key === 'lastUpdateText' || c.key === 'rejectionReason' || c.key === 'cancellationReason' || c.key === 'driverNotes') ? 1.4 : 1
          };
        }),
        rows: pdfRows,
        summaryItems: [
          { label: isEn ? 'Matching Results' : 'إجمالي النتائج المطابقة', value: String(payload.total || pdfRows.length) },
          { label: isEn ? 'Exported Rows' : 'الصفوف المصدرة', value: String(pdfRows.length) },
          { label: isEn ? 'Active Tab' : 'التبويب النشط', value: isEn ? metaExp.tabTitleEn : metaExp.tabTitleAr }
        ],
        initialSettings: { orientation: 'landscape', paperSize: 'a4' }
      });
    }

    var resExportWrap = document.getElementById('res-export-wrap');
    if (resExportWrap && root.RGExportMenu) {
      root.RGExportMenu.bind(resExportWrap, {
        onPdf: triggerResPdfExport,
        onExcel: triggerResExcelExport,
        onError: function (err) {
          ctx.toast((err && err.message) || (isEn ? 'Export failed.' : 'تعذر تنفيذ التصدير.'), true);
        }
      });
    }

    var exportBtn = document.getElementById('res-export-xlsx');
    if (exportBtn) {
      exportBtn.addEventListener('click', triggerResExcelExport);
    }
    var exportPdfBtn = document.getElementById('res-export-pdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', triggerResPdfExport);
    }

    var importBtn = document.getElementById('res-import-xlsx');
    if (importBtn) {
      importBtn.addEventListener('click', function () {
        openImportExcelModal(ctx, function () {
          refreshTableRegion();
          refreshRadarData();
          if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
            ensureTodayCalendarLoaded({ forceRefresh: true });
          } else {
            calendarRawItems = null;
            calendarLoadedWindow = { from: '', to: '' };
          }
        }, currentItems);
      });
    }

    var handoverBtn = document.getElementById('res-handover-btn');
    if (handoverBtn && root.RGHandover) {
      handoverBtn.addEventListener('click', function () {
        root.RGHandover.openHandoverModal(ctx);
      });
    }

    var calendarRawItems = null;
    var calendarLoadError = '';
    var calendarFetchSeq = 0;
    var calendarLoadedWindow = { from: '', to: '' };

    function resolveActiveCalendarFetchRange(overrideFrom, overrideTo) {
      var core = root.RGCrmCore;
      var anchorIso = state.todayCalendarAnchorDate || (core && core.getRiyadhTodayDateStr ? core.getRiyadhTodayDateStr() : new Date().toISOString().substring(0, 10));
      var win = (core && core.buildCalendarPeriodWindow)
        ? core.buildCalendarPeriodWindow(anchorIso, 'month', { weekStartsOn: 6 })
        : { startIso: anchorIso, endIso: anchorIso };
      return {
        fromIso: overrideFrom || win.startIso || anchorIso,
        toIso: overrideTo || win.endIso || anchorIso
      };
    }

    function formatCalPeriodTitle(win) {
      if (!win) return '';
      if (win.granularity === 'month') {
        return isEn
          ? ((win.monthNameEn || '') + ' ' + (win.year || ''))
          : ((win.monthNameAr || '') + ' ' + (win.year || ''));
      }
      if (!Array.isArray(win.days) || win.days.length === 0) return '';
      if (win.granularity === 'day') {
        var d0 = win.days[0];
        return isEn
          ? (d0.weekdayEn + ' · ' + d0.shortDateEn + ' ' + d0.year)
          : (d0.weekdayAr + ' · ' + d0.shortDateAr + ' ' + d0.year);
      }
      var first = win.days[0];
      var last = win.days[win.days.length - 1];
      return isEn
        ? (first.shortDateEn + ' – ' + last.shortDateEn + ' ' + last.year)
        : (first.shortDateAr + ' – ' + last.shortDateAr + ' ' + last.year);
    }

    function renderCalEventCardHtml(ev, compactMode) {
      var typeMeta = ev.type === 'pickup'
        ? { cls: 'is-pickup', label: isEn ? 'Pickup' : 'استلام' }
        : (ev.type === 'extension'
          ? { cls: 'is-extension', label: isEn ? 'Extension' : 'تمديد' }
          : { cls: 'is-return', label: isEn ? 'Return' : 'إرجاع' });
      var timeDisplay = ev.timeStr ? formatTimeOnly(ev.timeStr, ctx.lang) : '';
      var metaLine = [formatCarNameDisplay(ev.carName), ev.branchName].filter(Boolean).join(' · ');
      var stateCls = ev.isOverdue ? ' is-overdue' : (ev.isCompleted ? ' is-completed' : '');
      var stateTagHtml = ev.isOverdue
        ? '<span class="rg-cal-state-tag is-overdue">' + (isEn ? 'Overdue' : 'متأخر') + '</span>'
        : (ev.isCompleted ? '<span class="rg-cal-state-tag is-completed">' + (isEn ? 'Done' : 'منجز') + '</span>' : '');
      var extMeta = ev.type === 'extension' && (ev.extensionDays > 0 || ev.extensionNumber)
        ? ('<span class="rg-cal-ext-meta tabular-nums">' +
            (ev.extensionNumber ? esc(ev.extensionNumber) + ' ' : '') +
            (ev.extensionDays > 0 ? ('+' + ev.extensionDays + (isEn ? 'd' : 'ي')) : '') +
          '</span>')
        : '';

      if (compactMode) {
        return '<button type="button" class="rg-cal-month-ev ' + typeMeta.cls + stateCls + '" data-res-id="' + esc(ev.reservationId) + '" title="' + esc(typeMeta.label + ' · ' + ev.reservationNumber + ' · ' + (ev.customerName || '-') + (timeDisplay ? (' · ' + timeDisplay) : '')) + '">' +
          '<span class="rg-cal-dot ' + typeMeta.cls + '" aria-hidden="true"></span>' +
          '<span class="rg-cal-month-ev-time mono tabular-nums" dir="ltr">' + esc(timeDisplay || ev.timeStr || '') + '</span>' +
          '<span class="rg-cal-month-ev-title">' + esc(ev.customerName !== '-' ? ev.customerName : ev.reservationNumber) + '</span>' +
        '</button>';
      }

      return '<button type="button" class="rg-cal-event-card ' + typeMeta.cls + stateCls + '" data-res-id="' + esc(ev.reservationId) + '" title="' + esc(ev.reservationNumber + ' · ' + ev.customerName) + '">' +
        '<div class="rg-cal-event-top">' +
          '<span class="rg-cal-event-type ' + typeMeta.cls + '">' + esc(typeMeta.label) + '</span>' +
          stateTagHtml +
          '<span class="rg-cal-event-time mono tabular-nums" dir="ltr">' + esc(timeDisplay || ev.timeStr || '') + '</span>' +
        '</div>' +
        '<div class="rg-cal-event-head">' +
          '<span class="rg-cal-event-num mono tabular-nums" dir="ltr">' + esc(ev.reservationNumber) + '</span>' +
          extMeta +
        '</div>' +
        '<div class="rg-cal-event-cust">' + esc(ev.customerName || '-') + '</div>' +
        (metaLine ? '<div class="rg-cal-event-car">' + esc(metaLine) + '</div>' : '') +
      '</button>';
    }

    async function ensureTodayCalendarLoaded(opts) {
      var o = opts || {};
      var force = Boolean(o.forceRefresh);
      var rangeReq = resolveActiveCalendarFetchRange(o.fromIso, o.toIso);
      var windowCovered = Boolean(
        calendarLoadedWindow.from &&
        calendarLoadedWindow.to &&
        rangeReq.fromIso >= calendarLoadedWindow.from &&
        rangeReq.toIso <= calendarLoadedWindow.to
      );
      if (!force && Array.isArray(calendarRawItems) && windowCovered) {
        if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
          paintTodayView();
        }
        return;
      }
      if (!force && !checkHasActiveResFilters() && !initialLoadError && Number(payload.total || 0) <= currentItems.length && Number(payload.total || 0) > 0) {
        calendarLoadError = '';
        calendarRawItems = currentItems.slice();
        calendarLoadedWindow = { from: '0000-01-01', to: '9999-12-31' };
        if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
          paintTodayView();
        }
        return;
      }
      var seq = ++calendarFetchSeq;
      calendarLoadError = '';
      var resp = await root.RGApi.callApi('getReservations', {
        lifecycle: 'active',
        calendarMode: true,
        calendarFrom: rangeReq.fromIso,
        calendarTo: rangeReq.toIso,
        page: 1,
        pageSize: 2500,
        forceRefresh: force,
        silentRefresh: Boolean(o.silentRefresh),
        abortKey: 'res:todayCalendar'
      });
      if (seq !== calendarFetchSeq || !container.isConnected) return;
      if (resp && resp.aborted) return;
      if (resp && resp.success && resp.data) {
        calendarLoadError = '';
        calendarRawItems = Array.isArray(resp.data.items) ? resp.data.items : [];
        calendarLoadedWindow = { from: rangeReq.fromIso, to: rangeReq.toIso };
      } else if (!Array.isArray(calendarRawItems)) {
        calendarLoadError = (resp && resp.message) || (isEn ? 'Failed to load calendar data.' : 'تعذر تحميل بيانات التقويم.');
      }
      if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
        paintTodayView();
      }
      if (o.showToast && resp && resp.success) {
        ctx.toast(isEn ? 'Pickups & Returns calendar updated.' : 'تم تحديث تقويم التسليم والاستلام بنجاح.');
      }
    }

    function buildTodayCalendarContext() {
      var core = root.RGCrmCore;
      var gran = (core && core.normalizeCalendarGranularity)
        ? core.normalizeCalendarGranularity(state.todayCalendarGranularity)
        : (state.todayCalendarGranularity || 'week');
      var anchorIso = state.todayCalendarAnchorDate || (core && core.getRiyadhTodayDateStr ? core.getRiyadhTodayDateStr() : new Date().toISOString().substring(0, 10));
      var win = (core && core.buildCalendarPeriodWindow)
        ? core.buildCalendarPeriodWindow(anchorIso, gran, { weekStartsOn: 6 })
        : { granularity: gran, anchorIso: anchorIso, todayIso: anchorIso, startIso: anchorIso, endIso: anchorIso, prevAnchorIso: anchorIso, nextAnchorIso: anchorIso, weekdayHeaders: [], days: [] };
      var extracted = (core && core.extractReservationCalendarEvents)
        ? core.extractReservationCalendarEvents(calendarRawItems || [], win.startIso, win.endIso, {
            eventType: state.todayCalendarEventFilter || 'all',
            search: state.todayCalendarSearch || '',
            nowMs: Date.now()
          })
        : { events: [], byDate: {}, counts: { total: 0, pickup: 0, return: 0, extension: 0, completed: 0, overdue: 0 } };
      return { gran: gran, win: win, extracted: extracted };
    }

    function renderTodayCalendarBodyHtml(ctxCal) {
      if (calendarRawItems === null) {
        if (calendarLoadError) {
          return '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load calendar' : 'تعذر تحميل التقويم الزمني') + '</div>' +
              '<div class="rg-error-banner-msg">' + esc(calendarLoadError) + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="today-cal-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
          '</div>';
        }
        return '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
      }

      var gran = ctxCal.gran;
      var win = ctxCal.win;
      var extracted = ctxCal.extracted;
      var bodyHtml = '';
      if (gran === 'day') {
        var dayMeta = win.days[0] || { iso: win.startIso, weekdayAr: '', weekdayEn: '', shortDateAr: win.startIso, shortDateEn: win.startIso, isToday: false };
        var dayEvents = extracted.byDate[dayMeta.iso] || [];
        var eventsByHour = {};
        dayEvents.forEach(function (ev) {
          var hr = typeof ev.hourSlot === 'number' && ev.hourSlot >= 0 && ev.hourSlot <= 23 ? ev.hourSlot : 9;
          if (!eventsByHour[hr]) eventsByHour[hr] = [];
          eventsByHour[hr].push(ev);
        });
        var visibleHours = [];
        for (var h = 0; h < 24; h++) {
          if ((h >= 7 && h <= 22) || (eventsByHour[h] && eventsByHour[h].length > 0)) {
            visibleHours.push(h);
          }
        }
        bodyHtml =
          '<div class="rg-cal-day-banner' + (dayMeta.isToday ? ' is-today' : '') + '">' +
            '<div>' +
              '<strong>' + esc(isEn ? (dayMeta.weekdayEn + ' · ' + dayMeta.shortDateEn) : (dayMeta.weekdayAr + ' · ' + dayMeta.shortDateAr)) + '</strong>' +
              (dayMeta.isToday ? ' <span class="rg-cal-today-tag">' + (isEn ? 'Today' : 'اليوم') + '</span>' : '') +
            '</div>' +
            '<span class="rg-cal-day-count tabular-nums">' + dayEvents.length + ' ' + (isEn ? 'movements' : 'حركة') + '</span>' +
          '</div>' +
          (dayEvents.length === 0
            ? '<div class="empty-state" style="margin-top:10px;">' + (isEn ? 'No pickups, returns, or extensions scheduled on this day.' : 'لا توجد مواعيد استلام أو إرجاع أو تمديدات في هذا اليوم.') + '</div>'
            : '') +
          '<div class="rg-cal-day-timeline">' +
            visibleHours.map(function (hr) {
              var hh = String(hr).padStart(2, '0') + ':00';
              var lblTime = formatTimeOnly(hh, ctx.lang) || hh;
              var slotEvents = eventsByHour[hr] || [];
              return '<div class="rg-cal-hour-row' + (slotEvents.length === 0 ? ' is-empty' : ' has-events') + '">' +
                '<div class="rg-cal-hour-label mono tabular-nums" dir="ltr">' + esc(lblTime) + '</div>' +
                '<div class="rg-cal-hour-slot">' +
                  (slotEvents.length > 0
                    ? slotEvents.map(function (ev) { return renderCalEventCardHtml(ev, false); }).join('')
                    : '<span class="rg-cal-hour-empty-line" aria-hidden="true"></span>') +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>';
      } else if (gran === 'month') {
        var headers = Array.isArray(win.weekdayHeaders) ? win.weekdayHeaders : [];
        var MAX_MONTH_CELL_EVENTS = 3;
        bodyHtml =
          '<div class="rg-cal-month-wrap">' +
            '<div class="rg-cal-month-weekdays">' +
              headers.map(function (wh) {
                return '<div class="rg-cal-month-weekday">' + esc(isEn ? wh.weekdayEn : wh.weekdayAr) + '</div>';
              }).join('') +
            '</div>' +
            '<div class="rg-cal-month-grid">' +
              win.days.map(function (day) {
                var dayList = extracted.byDate[day.iso] || [];
                var visibleList = dayList.slice(0, MAX_MONTH_CELL_EVENTS);
                var overflowCount = Math.max(0, dayList.length - MAX_MONTH_CELL_EVENTS);
                var pickupCnt = 0;
                var returnCnt = 0;
                var extCnt = 0;
                dayList.forEach(function (ev) {
                  if (ev.type === 'pickup') pickupCnt += 1;
                  else if (ev.type === 'return') returnCnt += 1;
                  else if (ev.type === 'extension') extCnt += 1;
                });
                var cellClasses = 'rg-cal-month-cell' +
                  (day.isCurrentMonth === false ? ' is-outside' : '') +
                  (day.isToday ? ' is-today' : '') +
                  (dayList.length > 0 ? ' has-events' : '');
                return '<section class="' + cellClasses + '" data-cal-date="' + esc(day.iso) + '">' +
                  '<div class="rg-cal-month-cell-head">' +
                    '<button type="button" class="rg-cal-month-day-btn tabular-nums" data-cal-open-day="' + esc(day.iso) + '" title="' + esc(isEn ? ('Open day ' + day.iso) : ('عرض تفاصيل يوم ' + day.shortDateAr)) + '">' +
                      '<span>' + esc(day.day) + '</span>' +
                      (day.isToday ? '<span class="rg-cal-today-tag">' + (isEn ? 'Today' : 'اليوم') + '</span>' : '') +
                    '</button>' +
                    (dayList.length > 0
                      ? '<button type="button" class="rg-cal-month-total tabular-nums" data-cal-open-day="' + esc(day.iso) + '" aria-label="' + esc(dayList.length + ' ' + (isEn ? 'movements' : 'حركة')) + '">' + dayList.length + '</button>'
                      : '') +
                  '</div>' +
                  '<div class="rg-cal-month-cell-events">' +
                    visibleList.map(function (ev) { return renderCalEventCardHtml(ev, true); }).join('') +
                    (overflowCount > 0
                      ? '<button type="button" class="rg-cal-month-more tabular-nums" data-cal-open-day="' + esc(day.iso) + '">' +
                          (isEn ? ('+' + overflowCount + ' more') : ('+' + overflowCount + ' أخرى')) +
                        '</button>'
                      : '') +
                  '</div>' +
                  (dayList.length > 0
                    ? '<button type="button" class="rg-cal-month-mobile-dots" data-cal-open-day="' + esc(day.iso) + '" aria-label="' + esc(dayList.length + ' ' + (isEn ? 'movements — open day' : 'حركة — فتح جدول اليوم')) + '">' +
                        (pickupCnt > 0 ? '<span class="rg-cal-m-badge is-pickup tabular-nums">' + pickupCnt + '</span>' : '') +
                        (returnCnt > 0 ? '<span class="rg-cal-m-badge is-return tabular-nums">' + returnCnt + '</span>' : '') +
                        (extCnt > 0 ? '<span class="rg-cal-m-badge is-extension tabular-nums">' + extCnt + '</span>' : '') +
                      '</button>'
                    : '') +
                '</section>';
              }).join('') +
            '</div>' +
          '</div>';
      } else {
        bodyHtml =
          '<div class="rg-cal-week-grid">' +
            win.days.map(function (day) {
              var dayList = extracted.byDate[day.iso] || [];
              return '<section class="rg-cal-day-col' + (day.isToday ? ' is-today' : '') + '" data-cal-date="' + esc(day.iso) + '">' +
                '<header class="rg-cal-day-head">' +
                  '<button type="button" class="rg-cal-day-head-btn" data-cal-open-day="' + esc(day.iso) + '" title="' + esc(isEn ? 'Open hourly view for this day' : 'فتح جدول الساعات لهذا اليوم') + '">' +
                    '<div class="rg-cal-day-head-main">' +
                      '<span class="rg-cal-day-name">' + esc(isEn ? day.weekdayEn : day.weekdayAr) + '</span>' +
                      '<span class="rg-cal-day-date tabular-nums">' + esc(isEn ? day.shortDateEn : day.shortDateAr) + '</span>' +
                    '</div>' +
                    '<div class="rg-cal-day-head-meta">' +
                      (day.isToday ? '<span class="rg-cal-today-tag">' + (isEn ? 'Today' : 'اليوم') + '</span>' : '') +
                      '<span class="rg-cal-day-count tabular-nums">' + dayList.length + '</span>' +
                    '</div>' +
                  '</button>' +
                '</header>' +
                '<div class="rg-cal-day-body">' +
                  (dayList.length === 0
                    ? '<div class="rg-cal-empty-day">' + (isEn ? 'No movements' : 'لا توجد مواعيد') + '</div>'
                    : dayList.map(function (ev) { return renderCalEventCardHtml(ev, false); }).join('')) +
                '</div>' +
              '</section>';
            }).join('') +
          '</div>';
      }
      return bodyHtml;
    }

    function renderTodayCalendarShellHtml(ctxCal) {
      var gran = ctxCal.gran;
      var win = ctxCal.win;
      var counts = (ctxCal.extracted && ctxCal.extracted.counts) || { total: 0, pickup: 0, return: 0, extension: 0 };
      var evTypeFilter = state.todayCalendarEventFilter || 'all';
      return '<div class="rg-cal-shell" id="today-calendar-shell">' +
        '<div class="rg-cal-toolbar">' +
          '<div class="rg-cal-nav-group">' +
            '<button type="button" class="btn btn-sm" id="today-cal-prev-btn">' + (isEn ? 'Previous' : 'السابق') + '</button>' +
            '<button type="button" class="btn btn-sm btn-charcoal" id="today-cal-today-btn">' + (isEn ? 'Today' : 'اليوم') + '</button>' +
            '<button type="button" class="btn btn-sm" id="today-cal-next-btn">' + (isEn ? 'Next' : 'التالي') + '</button>' +
            '<h3 class="rg-cal-period-title" id="today-cal-period-title">' + esc(formatCalPeriodTitle(win)) + '</h3>' +
          '</div>' +
          '<div class="rg-cal-gran-group">' +
            '<div class="rg-cal-gran-switch" role="group" aria-label="' + (isEn ? 'Calendar Scale' : 'نطاق التقويم') + '">' +
              '<button type="button" class="rg-cal-gran-btn' + (gran === 'month' ? ' is-active' : '') + '" data-cal-gran="month">' + (isEn ? 'Monthly' : 'شهري') + '</button>' +
              '<button type="button" class="rg-cal-gran-btn' + (gran === 'week' ? ' is-active' : '') + '" data-cal-gran="week">' + (isEn ? 'Weekly' : 'أسبوعي') + '</button>' +
              '<button type="button" class="rg-cal-gran-btn' + (gran === 'day' ? ' is-active' : '') + '" data-cal-gran="day">' + (isEn ? 'Daily' : 'يومي') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="rg-cal-subbar">' +
          '<div class="rg-cal-legend" role="group" aria-label="' + (isEn ? 'Calendar Movement Types' : 'أنواع المواعيد') + '">' +
            '<button type="button" class="rg-cal-filter-chip' + (evTypeFilter === 'all' ? ' is-active' : '') + '" data-cal-type="all">' +
              '<span>' + (isEn ? 'All' : 'الكل') + '</span> <strong class="tabular-nums" data-cal-count="total">' + counts.total + '</strong>' +
            '</button>' +
            '<button type="button" class="rg-cal-filter-chip is-pickup' + (evTypeFilter === 'pickup' ? ' is-active' : '') + '" data-cal-type="pickup">' +
              '<span class="rg-cal-dot is-pickup" aria-hidden="true"></span>' +
              '<span>' + (isEn ? 'Pickups' : 'التسليم / الاستلام') + '</span> <strong class="tabular-nums" data-cal-count="pickup">' + counts.pickup + '</strong>' +
            '</button>' +
            '<button type="button" class="rg-cal-filter-chip is-return' + (evTypeFilter === 'return' ? ' is-active' : '') + '" data-cal-type="return">' +
              '<span class="rg-cal-dot is-return" aria-hidden="true"></span>' +
              '<span>' + (isEn ? 'Returns' : 'الإرجاع') + '</span> <strong class="tabular-nums" data-cal-count="return">' + counts.return + '</strong>' +
            '</button>' +
            '<button type="button" class="rg-cal-filter-chip is-extension' + (evTypeFilter === 'extension' ? ' is-active' : '') + '" data-cal-type="extension">' +
              '<span class="rg-cal-dot is-extension" aria-hidden="true"></span>' +
              '<span>' + (isEn ? 'Extensions' : 'التمديدات') + '</span> <strong class="tabular-nums" data-cal-count="extension">' + counts.extension + '</strong>' +
            '</button>' +
          '</div>' +
          '<div class="rg-cal-actions">' +
            '<input type="search" class="input" id="today-cal-search" placeholder="' + (isEn ? 'Search in calendar...' : 'بحث في التقويم...') + '" value="' + esc(state.todayCalendarSearch || '') + '">' +
            '<button type="button" class="btn btn-sm" id="today-cal-ics-btn" title="' + (isEn ? 'Export visible calendar events (.ics)' : 'تصدير مواعيد التقويم الظاهرة (.ics)') + '">📅 ' + (isEn ? 'Export .ics' : 'تقويم .ics') + '</button>' +
            '<button type="button" class="btn btn-sm" id="today-cal-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث') + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="today-cal-body-host"></div>' +
      '</div>';
    }

    function bindTodayCalendarToolbarEvents(calShell) {
      var prevBtn = calShell.querySelector('#today-cal-prev-btn');
      var todayBtn = calShell.querySelector('#today-cal-today-btn');
      var nextBtn = calShell.querySelector('#today-cal-next-btn');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          var liveWin = buildTodayCalendarContext().win;
          state.todayCalendarAnchorDate = liveWin.prevAnchorIso;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
          ensureTodayCalendarLoaded({ silentRefresh: true });
        });
      }
      if (todayBtn) {
        todayBtn.addEventListener('click', function () {
          var liveWin = buildTodayCalendarContext().win;
          state.todayCalendarAnchorDate = liveWin.todayIso;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
          ensureTodayCalendarLoaded({ silentRefresh: true });
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          var liveWin = buildTodayCalendarContext().win;
          state.todayCalendarAnchorDate = liveWin.nextAnchorIso;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
          ensureTodayCalendarLoaded({ silentRefresh: true });
        });
      }

      calShell.querySelectorAll('[data-cal-gran]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rawG = btn.getAttribute('data-cal-gran');
          state.todayCalendarGranularity = (rawG === 'day' || rawG === 'month') ? rawG : 'week';
          saveTodayCalPrefs();
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
          ensureTodayCalendarLoaded({ silentRefresh: true });
        });
      });

      calShell.querySelectorAll('[data-cal-type]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.todayCalendarEventFilter = btn.getAttribute('data-cal-type') || 'all';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        });
      });

      var calSearchEl = calShell.querySelector('#today-cal-search');
      if (calSearchEl) {
        var syncCalSearch = function () {
          state.todayCalendarSearch = calSearchEl.value;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        };
        calSearchEl.addEventListener('input', syncCalSearch);
        calSearchEl.addEventListener('search', syncCalSearch);
      }

      var calIcsBtn = calShell.querySelector('#today-cal-ics-btn');
      if (calIcsBtn) {
        calIcsBtn.addEventListener('click', function () {
          var core = root.RGCrmCore;
          if (!core || !core.buildIcsCalendarContent) return;
          var liveCtx = buildTodayCalendarContext();
          var evs = ((liveCtx.extracted && liveCtx.extracted.events) || []).map(function (ev, idx) {
            var kindLbl = ev.type === 'pickup'
              ? (isEn ? 'Pickup' : 'تسليم')
              : (ev.type === 'extension' ? (isEn ? 'Extension' : 'تمديد') : (isEn ? 'Return' : 'إرجاع'));
            return {
              uid: 'rg-cal-' + (ev.eventKey || idx) + '@rentalgate.crm',
              startDate: ev.dateIso,
              startTime: ev.timeStr || '09:00',
              summary: '[' + kindLbl + '] #' + (ev.reservationNumber || ev.reservationId) + ' — ' + (ev.customerName || '-'),
              description: [ev.carName, ev.customerPhone, ev.status].filter(Boolean).join(' | '),
              location: [ev.companyName, ev.branchName].filter(Boolean).join(' — ')
            };
          });
          if (!evs.length) {
            ctx.toast(isEn ? 'No calendar events in the current view to export.' : 'لا توجد مواعيد في العرض الحالي لتصديرها.', true);
            return;
          }
          var icsStr = core.buildIcsCalendarContent(evs, 'Rental Gate CRM — Pickups & Returns');
          var dlFn = (ctx.downloadIcsFile) || (root.RGApp && root.RGApp.downloadIcsFile);
          if (dlFn) {
            dlFn('rg-calendar-' + ((liveCtx.win && liveCtx.win.startIso) || 'schedule') + '.ics', icsStr);
            ctx.toast(isEn ? 'Calendar (.ics) file downloaded.' : 'تم تصدير التقويم بصيغة (.ics).');
          }
        });
      }

      var calRefreshBtn = calShell.querySelector('#today-cal-refresh-btn');
      if (calRefreshBtn) {
        calRefreshBtn.addEventListener('click', function () {
          ensureTodayCalendarLoaded({ forceRefresh: true, showToast: true });
        });
      }
    }

    function bindTodayCalendarBodyEvents(bodyHost) {
      var retryBtn = bodyHost.querySelector('#today-cal-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          ensureTodayCalendarLoaded({ forceRefresh: true });
        });
        return;
      }

      bodyHost.querySelectorAll('[data-cal-open-day]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var targetIso = btn.getAttribute('data-cal-open-day');
          if (!targetIso) return;
          state.todayCalendarAnchorDate = targetIso;
          state.todayCalendarGranularity = 'day';
          saveTodayCalPrefs();
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
          ensureTodayCalendarLoaded({ silentRefresh: true });
        });
      });

      bodyHost.querySelectorAll('.rg-cal-event-card, .rg-cal-month-ev').forEach(function (card) {
        card.addEventListener('click', function () {
          var rid = card.getAttribute('data-res-id');
          if (!rid) return;
          openReservationDrawer(rid, ctx, employees, function (updatedRes) {
            syncLocalReservationSnapshot(updatedRes);
          });
        });
      });
    }

    var radarRawReservations = null;
    var radarLoadError = '';
    var radarFetchSeq = 0;

    function buildRadarShellHtml() {
      return '<div class="radar-summary-bar" id="radar-summary-bar">' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Total in Radar' : 'إجمالي التنبيهات') + '</span><strong class="tabular-nums" data-radar-stat="total">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-warning"><span class="radar-stat-label">' + (isEn ? 'Critical ≤ 6h' : 'عاجل ≤ 6 ساعات') + '</span><strong class="tabular-nums" data-radar-stat="critical6h">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-danger"><span class="radar-stat-label">' + (isEn ? 'Overdue Unclosed' : 'منتهية لم تُغلق') + '</span><strong class="tabular-nums" data-radar-stat="expired">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-info"><span class="radar-stat-label">' + (isEn ? 'Extended Contracts' : 'عقود ممددة') + '</span><strong class="tabular-nums" data-radar-stat="extended">0</strong></div>' +
        '</div>' +
        '<div class="radar-toolbar">' +
          '<div class="segmented-control" role="group" aria-label="' + (isEn ? 'Urgency filter' : 'تصفية الاستعجال') + '">' +
            '<button type="button" class="segmented-btn" data-radar-filter="all">' + (isEn ? 'All' : 'الكل') + ' (<span data-radar-btn-cnt="all">0</span>)</button>' +
            '<button type="button" class="segmented-btn" data-radar-filter="critical_6h">' + (isEn ? '≤ 6 Hours' : 'أقل من 6 ساعات') + ' (<span data-radar-btn-cnt="critical_6h">0</span>)</button>' +
            '<button type="button" class="segmented-btn" data-radar-filter="expired_unclosed">' + (isEn ? 'Overdue Unclosed' : 'منتهية غير مغلقة') + ' (<span data-radar-btn-cnt="expired_unclosed">0</span>)</button>' +
          '</div>' +
          '<div class="radar-search-wrap">' +
            '<input type="search" class="input" id="radar-search-input" placeholder="' + (isEn ? 'Filter expiring bookings...' : 'بحث في رادار الانتهاء...') + '" value="' + esc(state.radarSearch || '') + '">' +
            '<button type="button" class="btn btn-sm" id="radar-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث') + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="radar-results-host"></div>';
    }

    function bindRadarToolbarEvents(radarWrap) {
      radarWrap.querySelectorAll('[data-radar-filter]').forEach(function (fBtn) {
        fBtn.addEventListener('click', function () {
          state.radarFilter = fBtn.getAttribute('data-radar-filter') || 'all';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintRadarView();
        });
      });

      var radarSearchEl = radarWrap.querySelector('#radar-search-input');
      if (radarSearchEl) {
        var onRadarSearchChange = function () {
          state.radarSearch = radarSearchEl.value;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintRadarView();
        };
        radarSearchEl.addEventListener('input', onRadarSearchChange);
        radarSearchEl.addEventListener('search', onRadarSearchChange);
      }

      var radarRefreshBtn = radarWrap.querySelector('#radar-refresh-btn');
      if (radarRefreshBtn) {
        radarRefreshBtn.addEventListener('click', function () {
          refreshRadarData(true);
        });
      }
    }

    function paintRadarView() {
      var radarWrap = document.getElementById('res-radar-view');
      var badgeEl = document.getElementById('res-radar-tab-count');
      if (!radarWrap) return;

      var core = root.RGCrmCore;
      var summary = (core && core.computeExpiryRadarSummary)
        ? core.computeExpiryRadarSummary(radarRawReservations || [], Date.now(), {
            subFilter: state.radarFilter,
            search: state.radarSearch
          })
        : { items: [], totalCount: 0, upcoming24hCount: 0, critical6hCount: 0, expiredUnclosedCount: 0, extendedInRadarCount: 0 };

      if (badgeEl && radarRawReservations !== null) {
        badgeEl.textContent = String(summary.totalCount || 0);
      }
      if (state.viewMode !== 'radar') return;

      var resultsHost = radarWrap.querySelector('#radar-results-host');
      if (!resultsHost) {
        radarWrap.innerHTML = buildRadarShellHtml();
        bindRadarToolbarEvents(radarWrap);
        resultsHost = radarWrap.querySelector('#radar-results-host');
      }

      var statMap = {
        total: summary.totalCount || 0,
        critical6h: summary.critical6hCount || 0,
        expired: summary.expiredUnclosedCount || 0,
        extended: summary.extendedInRadarCount || 0
      };
      Object.keys(statMap).forEach(function (k) {
        var el = radarWrap.querySelector('[data-radar-stat="' + k + '"]');
        if (el) el.textContent = String(statMap[k]);
      });
      var btnCntMap = {
        all: summary.totalCount || 0,
        critical_6h: summary.critical6hCount || 0,
        expired_unclosed: summary.expiredUnclosedCount || 0
      };
      radarWrap.querySelectorAll('[data-radar-filter]').forEach(function (fBtn) {
        var key = fBtn.getAttribute('data-radar-filter') || 'all';
        fBtn.classList.toggle('active', state.radarFilter === key);
        var cntEl = fBtn.querySelector('[data-radar-btn-cnt="' + key + '"]');
        if (cntEl) cntEl.textContent = String(btnCntMap[key] || 0);
      });
      var radarSearchInp = radarWrap.querySelector('#radar-search-input');
      if (radarSearchInp && document.activeElement !== radarSearchInp && radarSearchInp.value !== (state.radarSearch || '')) {
        radarSearchInp.value = state.radarSearch || '';
      }

      if (radarRawReservations === null) {
        if (radarLoadError) {
          resultsHost.innerHTML =
            '<div class="rg-error-banner" role="alert">' +
              '<div class="rg-error-banner-body">' +
                '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load 24h Radar' : 'تعذر تحميل رادار 24 ساعة') + '</div>' +
                '<div class="rg-error-banner-msg">' + esc(radarLoadError) + '</div>' +
              '</div>' +
              '<button type="button" class="btn btn-sm btn-primary" id="radar-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
            '</div>';
          var rRetry = resultsHost.querySelector('#radar-retry-btn');
          if (rRetry) rRetry.addEventListener('click', function () { refreshRadarData(true, { forceRefresh: true }); });
          return;
        }
        resultsHost.innerHTML = '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div></div>';
        return;
      }

      var rowsHtml = '';
      if (!summary.items.length) {
        rowsHtml = '<div class="empty-state">' +
          (isEn ? 'No reservations matching the 24h expiry radar filters right now.' : 'لا توجد حجوزات تقترب من الانتهاء مطابقة للفلتر الحالي.') +
        '</div>';
      } else {
        rowsHtml =
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>' + (isEn ? 'Booking #' : 'رقم الحجز') + '</th>' +
            '<th>' + (isEn ? 'Customer & Phone' : 'العميل والجوال') + '</th>' +
            '<th>' + (isEn ? 'Vehicle & Branch' : 'المركبة والشركة') + '</th>' +
            '<th>' + (isEn ? 'Effective End' : 'موعد الانتهاء الفعلي') + '</th>' +
            '<th>' + (isEn ? 'Time Left / Overdue' : 'المتبقي / التأخير') + '</th>' +
            '<th>' + (isEn ? 'Status' : 'الحالة') + '</th>' +
            '<th>' + (isEn ? 'Outreach & Actions' : 'التواصل والإجراء') + '</th>' +
          '</tr></thead><tbody>' +
          summary.items.map(function (entry) {
            var r = entry.reservation || {};
            var remLabel = isEn ? entry.remainingLabelEn : entry.remainingLabelAr;
            var toneCls = entry.bucket === 'expired_unclosed'
              ? 'radar-countdown-expired'
              : (entry.bucket === 'critical_6h' ? 'radar-countdown-critical' : 'radar-countdown-soon');
            var waPhone = (core && core.normalizeWhatsappPhone) ? core.normalizeWhatsappPhone(r.customerPhone) : '';
            var msgText = (core && core.buildExtensionOfferMessage)
              ? core.buildExtensionOfferMessage(r, ctx.lang, { agentName: currentUser && currentUser.name })
              : '';
            var waHref = waPhone ? ('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(msgText)) : '';

            return '<tr data-radar-res-id="' + esc(r.id) + '">' +
              '<td class="mono cell-res-num">' +
                '<div class="cell-res-head"><button type="button" class="btn-link-inline radar-open-res" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber || r.id) + '</button></div>' +
                '<div class="cell-badges">' +
                  (entry.isExtended ? '<span class="status-tag status-info">' + (isEn ? 'Extended' : 'ممدد') + '</span>' : '') +
                  (r.hasProblem ? '<span class="status-tag status-danger">' + (isEn ? 'Problem' : 'مشكلة') + '</span>' : '') +
                '</div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary"><button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName || '-') + '</button></div>' +
                '<div class="cell-sub"><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary">' + esc(formatCarNameDisplay(r.carName)) + '</div>' +
                '<div class="cell-sub">' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</td>' +
              '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                (entry.effectiveEndTime
                  ? renderBookingTimezoneHtml(entry.effectiveEndDate, entry.effectiveEndTime, { compact: true })
                  : '<div>' + esc(formatDateOnly(entry.effectiveEndDate)) + '</div>') +
              '</td>' +
              '<td style="white-space:nowrap;">' +
                '<span class="radar-countdown ' + toneCls + ' tabular-nums">' + esc(remLabel) + '</span>' +
              '</td>' +
              '<td><span class="status-tag ' + statusClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span></td>' +
              '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                '<button type="button" class="btn btn-sm btn-primary radar-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                '<button type="button" class="btn btn-sm radar-copy-offer" data-id="' + esc(r.id) + '">' + (isEn ? 'Copy Offer' : 'نسخ التمديد') + '</button>' +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal rg-ui-wa-btn" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
                  : '') +
              '</div></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }

      resultsHost.innerHTML = rowsHtml;

      resultsHost.querySelectorAll('.radar-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          openReservationDrawer(rid, ctx, employees, function (updatedRes) {
            syncLocalReservationSnapshot(updatedRes);
          });
        });
      });

      resultsHost.querySelectorAll('.radar-copy-offer').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          var match = (radarRawReservations || []).find(function (x) { return x && x.id === rid; });
          if (!match) return;
          var textMsg = (core && core.buildExtensionOfferMessage)
            ? core.buildExtensionOfferMessage(match, ctx.lang, { agentName: currentUser && currentUser.name })
            : (match.reservationNumber + ' — ' + match.customerName);
          copyTextToClipboard(textMsg).then(function () {
            ctx.toast(isEn ? 'Extension outreach message copied.' : 'تم نسخ رسالة عرض التمديد بنجاح.');
          });
        });
      });
    }

    function buildTodayModeBarHtml() {
      return '<div class="rg-today-mode-bar" id="today-mode-bar">' +
        '<div class="rg-cal-gran-switch" role="tablist" aria-label="' + (isEn ? 'Pickups & Returns Display Mode' : 'طريقة عرض التسليم والاستلام') + '">' +
          '<button type="button" role="tab" aria-selected="' + (state.todayDisplayMode === 'calendar') + '" class="rg-cal-gran-btn' + (state.todayDisplayMode === 'calendar' ? ' is-active' : '') + '" data-today-mode="calendar">' +
            '📅 ' + (isEn ? 'Calendar (Month / Week / Day)' : 'التقويم (شهري / أسبوعي / يومي)') +
          '</button>' +
          '<button type="button" role="tab" aria-selected="' + (state.todayDisplayMode !== 'calendar') + '" class="rg-cal-gran-btn' + (state.todayDisplayMode !== 'calendar' ? ' is-active' : '') + '" data-today-mode="list">' +
            (isEn ? 'Today\'s Schedule' : 'جدول اليوم') +
          '</button>' +
        '</div>' +
        '<div class="rg-today-mode-hint" id="today-mode-hint">' +
          (state.todayDisplayMode === 'calendar'
            ? (isEn ? 'Interactive calendar for pickups, returns & extensions' : 'عرض تفاعلي لمواعيد التسليم والاستلام والتمديدات')
            : (isEn ? 'Live schedule of pickups and returns scheduled for today' : 'متابعة جدول التسليم والاستلام المجدول لليوم')) +
        '</div>' +
      '</div>';
    }

    function buildTodayListShellHtml() {
      return '<div class="radar-summary-bar" id="today-list-summary-bar">' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Today Movements' : 'إجمالي حركات اليوم') + '</span><strong class="tabular-nums" data-today-stat="total">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-info"><span class="radar-stat-label">' + (isEn ? 'Pickups Today' : 'التسليم اليوم') + '</span><strong class="tabular-nums" data-today-stat="pickup">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-warning"><span class="radar-stat-label">' + (isEn ? 'Returns Today' : 'الإرجاع اليوم') + '</span><strong class="tabular-nums" data-today-stat="return">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-danger"><span class="radar-stat-label">' + (isEn ? 'Delayed' : 'متأخر عن الوقت') + '</span><strong class="tabular-nums" data-today-stat="overdue">0</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Completed' : 'مكتمل') + '</span><strong class="tabular-nums" data-today-stat="completed">0</strong></div>' +
        '</div>' +
        '<div class="radar-toolbar" id="today-list-toolbar" style="flex-wrap:wrap;">' +
          '<div class="segmented-control" role="group" aria-label="' + (isEn ? 'Movement filter' : 'تصفية حركات اليوم') + '">' +
            '<button type="button" class="segmented-btn" data-today-filter="all">' + (isEn ? 'All' : 'الكل') + ' (<span data-today-btn-cnt="all">0</span>)</button>' +
            '<button type="button" class="segmented-btn" data-today-filter="pickup">' + (isEn ? 'Pickups' : 'التسليم اليوم') + ' (<span data-today-btn-cnt="pickup">0</span>)</button>' +
            '<button type="button" class="segmented-btn" data-today-filter="return">' + (isEn ? 'Returns' : 'الإرجاع اليوم') + ' (<span data-today-btn-cnt="return">0</span>)</button>' +
          '</div>' +
          '<div class="radar-search-wrap" style="flex-wrap:wrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);"><span>' + (isEn ? 'From:' : 'من:') + '</span><input type="time" class="input mono" id="today-time-from" value="' + esc(state.todayTimeFrom || '') + '" style="width:118px;min-height:34px;"></label>' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);"><span>' + (isEn ? 'To:' : 'إلى:') + '</span><input type="time" class="input mono" id="today-time-to" value="' + esc(state.todayTimeTo || '') + '" style="width:118px;min-height:34px;"></label>' +
            '<button type="button" class="btn btn-sm" id="today-clear-time-btn" style="display:' + ((state.todayTimeFrom || state.todayTimeTo) ? '' : 'none') + ';">' + (isEn ? 'Clear Time' : 'مسح الوقت') + '</button>' +
            '<input type="search" class="input" id="today-search-input" placeholder="' + (isEn ? 'Search today\'s schedule...' : 'بحث في جدول اليوم...') + '" value="' + esc(state.todaySearch || '') + '">' +
            '<button type="button" class="btn btn-sm" id="today-ics-btn" title="' + (isEn ? 'Export Today Schedule to Google Calendar (.ics)' : 'تصدير جدول اليوم إلى تقويم Google (.ics)') + '">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' +
            '<button type="button" class="btn btn-sm" id="today-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث') + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="today-list-body-host"></div>';
    }

    function bindTodayListToolbarEvents(contentHost) {
      var core = root.RGCrmCore;
      contentHost.querySelectorAll('[data-today-filter]').forEach(function (fBtn) {
        fBtn.addEventListener('click', function () {
          state.todayFilter = fBtn.getAttribute('data-today-filter') || 'all';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        });
      });

      var todayTimeFromEl = contentHost.querySelector('#today-time-from');
      var todayTimeToEl = contentHost.querySelector('#today-time-to');
      if (todayTimeFromEl) {
        todayTimeFromEl.addEventListener('change', function () {
          state.todayTimeFrom = todayTimeFromEl.value || '';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        });
      }
      if (todayTimeToEl) {
        todayTimeToEl.addEventListener('change', function () {
          state.todayTimeTo = todayTimeToEl.value || '';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        });
      }
      var todayClearTimeBtn = contentHost.querySelector('#today-clear-time-btn');
      if (todayClearTimeBtn) {
        todayClearTimeBtn.addEventListener('click', function () {
          state.todayTimeFrom = '';
          state.todayTimeTo = '';
          if (todayTimeFromEl) todayTimeFromEl.value = '';
          if (todayTimeToEl) todayTimeToEl.value = '';
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        });
      }
      var todayIcsBtn = contentHost.querySelector('#today-ics-btn');
      if (todayIcsBtn) {
        todayIcsBtn.addEventListener('click', function () {
          if (!core || !core.buildTodayScheduleIcsEvents || !core.buildIcsCalendarContent) return;
          var liveSummary = core.computeTodayMovementsSummary
            ? core.computeTodayMovementsSummary(radarRawReservations || [], Date.now(), {
                subFilter: state.todayFilter,
                search: state.todaySearch,
                timeFrom: state.todayTimeFrom,
                timeTo: state.todayTimeTo
              })
            : { items: [], todayDate: '' };
          var evs = core.buildTodayScheduleIcsEvents(liveSummary, ctx.lang);
          if (!evs.length) {
            ctx.toast(isEn ? 'No movements in the filtered today schedule to export.' : 'لا توجد حركات في الجدول المصفى لتصديرها إلى التقويم.', true);
            return;
          }
          var icsStr = core.buildIcsCalendarContent(evs, 'Rental Gate CRM — Today');
          var dlFn = (ctx.downloadIcsFile) || (root.RGApp && root.RGApp.downloadIcsFile);
          if (dlFn) {
            dlFn('rg-today-schedule-' + (liveSummary.todayDate || 'today') + '.ics', icsStr);
            ctx.toast(isEn ? 'Calendar (.ics) file downloaded.' : 'تم تصدير جدول اليوم بصيغة تقويم (.ics).');
          }
        });
      }

      var todaySearchEl = contentHost.querySelector('#today-search-input');
      if (todaySearchEl) {
        var syncTodaySearch = function () {
          state.todaySearch = todaySearchEl.value;
          if (ctx.saveRouteFilters) ctx.saveRouteFilters();
          paintTodayView();
        };
        todaySearchEl.addEventListener('input', syncTodaySearch);
        todaySearchEl.addEventListener('search', syncTodaySearch);
      }

      var todayRefreshBtn = contentHost.querySelector('#today-refresh-btn');
      if (todayRefreshBtn) {
        todayRefreshBtn.addEventListener('click', function () {
          refreshRadarData(true);
        });
      }
    }

    function bindTodayListBodyEvents(bodyHost) {
      var tRetry = bodyHost.querySelector('#today-retry-btn');
      if (tRetry) {
        tRetry.addEventListener('click', function () { refreshRadarData(true, { forceRefresh: true }); });
      }
      bodyHost.querySelectorAll('.today-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          openReservationDrawer(rid, ctx, employees, function (updatedRes) {
            syncLocalReservationSnapshot(updatedRes);
          });
        });
      });
      bodyHost.querySelectorAll('.today-claim-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          var target = (radarRawReservations || []).find(function (x) { return x && x.id === rid; });
          if (!target || !currentUser) return;
          runWithLock(btn, 'claimReservation:' + rid, function () {
            var prevAssignedIds = Array.isArray(target.assignedEmployeeIds) ? target.assignedEmployeeIds.slice() : [];
            var prevAssignedNames = Array.isArray(target.assignedEmployeeNames) ? target.assignedEmployeeNames.slice() : [];
            var claimed = root.RGCrmCore.claimReservationRecord(target, currentUser);
            target.assignedEmployeeIds = claimed.assignedEmployeeIds;
            target.assignedEmployeeNames = claimed.assignedEmployeeNames;
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('claimReservation', { reservationId: rid }, currentUser);
            }
            syncLocalReservationSnapshot(target);
            ctx.toast(isEn ? 'Reservation claimed successfully.' : 'تم استلام الحجز في قائمتك بنجاح.');
            return root.RGApi.callApi('claimReservation', {
              reservationId: rid,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                target.assignedEmployeeIds = prevAssignedIds;
                target.assignedEmployeeNames = prevAssignedNames;
                syncLocalReservationSnapshot(target);
                ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true);
              }
            }).catch(function () {
              target.assignedEmployeeIds = prevAssignedIds;
              target.assignedEmployeeNames = prevAssignedNames;
              syncLocalReservationSnapshot(target);
              ctx.toast('تعذر الاتصال بالخادم أثناء استلام الحجز.', true);
            });
          }, { spamAction: 'claimReservation', spamSig: rid });
        });
      });
    }

    function paintTodayView() {
      var todayWrap = document.getElementById('res-today-view');
      var badgeEl = document.getElementById('res-today-tab-count');
      if (!todayWrap) return;

      var core = root.RGCrmCore;
      var summary = (core && core.computeTodayMovementsSummary)
        ? core.computeTodayMovementsSummary(radarRawReservations || [], Date.now(), {
            subFilter: state.todayFilter,
            search: state.todaySearch,
            timeFrom: state.todayTimeFrom,
            timeTo: state.todayTimeTo
          })
        : { todayDate: '', items: [], totalCount: 0, pickupCount: 0, returnCount: 0, pendingPickupCount: 0, pendingReturnCount: 0, overdueCount: 0, completedCount: 0 };

      if (badgeEl && radarRawReservations !== null) {
        badgeEl.textContent = String(summary.totalCount || 0);
      }
      if (state.viewMode !== 'today') return;

      var contentHost = todayWrap.querySelector('#today-content-host');
      if (!contentHost) {
        todayWrap.innerHTML = buildTodayModeBarHtml() + '<div id="today-content-host"></div>';
        todayWrap.querySelectorAll('[data-today-mode]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var nextMode = btn.getAttribute('data-today-mode') === 'calendar' ? 'calendar' : 'list';
            if (state.todayDisplayMode === nextMode) return;
            state.todayDisplayMode = nextMode;
            saveTodayCalPrefs();
            if (nextMode === 'calendar' && calendarRawItems === null) {
              ensureTodayCalendarLoaded({ forceRefresh: false });
            }
            paintTodayView();
          });
        });
        contentHost = todayWrap.querySelector('#today-content-host');
      }

      todayWrap.querySelectorAll('[data-today-mode]').forEach(function (btn) {
        var isCalMode = btn.getAttribute('data-today-mode') === 'calendar';
        var isAct = state.todayDisplayMode === 'calendar' ? isCalMode : !isCalMode;
        btn.classList.toggle('is-active', isAct);
        btn.setAttribute('aria-selected', String(isAct));
      });
      var modeHintEl = todayWrap.querySelector('#today-mode-hint');
      if (modeHintEl) {
        modeHintEl.textContent = state.todayDisplayMode === 'calendar'
          ? (isEn ? 'Interactive calendar for pickups, returns & extensions' : 'عرض تفاعلي لمواعيد التسليم والاستلام والتمديدات')
          : (isEn ? 'Live schedule of pickups and returns scheduled for today' : 'متابعة جدول التسليم والاستلام المجدول لليوم');
      }

      if (state.todayDisplayMode === 'calendar') {
        if (calendarRawItems === null && !calendarLoadError) {
          ensureTodayCalendarLoaded({ forceRefresh: false });
        }
        var ctxCal = buildTodayCalendarContext();
        var calShell = contentHost.querySelector('#today-calendar-shell');
        if (!calShell) {
          contentHost.innerHTML = renderTodayCalendarShellHtml(ctxCal);
          calShell = contentHost.querySelector('#today-calendar-shell');
          if (calShell) bindTodayCalendarToolbarEvents(calShell);
        }
        if (calShell) {
          var periodTitleEl = calShell.querySelector('#today-cal-period-title');
          if (periodTitleEl) periodTitleEl.textContent = formatCalPeriodTitle(ctxCal.win);
          calShell.querySelectorAll('[data-cal-gran]').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-cal-gran') === ctxCal.gran);
          });
          var calCounts = (ctxCal.extracted && ctxCal.extracted.counts) || { total: 0, pickup: 0, return: 0, extension: 0 };
          var evTypeFilter = state.todayCalendarEventFilter || 'all';
          calShell.querySelectorAll('[data-cal-type]').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-cal-type') === evTypeFilter);
          });
          Object.keys(calCounts).forEach(function (ck) {
            var cel = calShell.querySelector('[data-cal-count="' + ck + '"]');
            if (cel) cel.textContent = String(calCounts[ck] || 0);
          });
          var calSearchInp = calShell.querySelector('#today-cal-search');
          if (calSearchInp && document.activeElement !== calSearchInp && calSearchInp.value !== (state.todayCalendarSearch || '')) {
            calSearchInp.value = state.todayCalendarSearch || '';
          }
          var calBodyHost = calShell.querySelector('#today-cal-body-host');
          if (calBodyHost) {
            calBodyHost.innerHTML = renderTodayCalendarBodyHtml(ctxCal);
            bindTodayCalendarBodyEvents(calBodyHost);
          }
        }
        return;
      }

      var listBodyHost = contentHost.querySelector('#today-list-body-host');
      if (!listBodyHost) {
        contentHost.innerHTML = buildTodayListShellHtml();
        bindTodayListToolbarEvents(contentHost);
        listBodyHost = contentHost.querySelector('#today-list-body-host');
      }

      var todayStatMap = {
        total: summary.totalCount || 0,
        pickup: summary.pickupCount || 0,
        return: summary.returnCount || 0,
        overdue: summary.overdueCount || 0,
        completed: summary.completedCount || 0
      };
      Object.keys(todayStatMap).forEach(function (tk) {
        var el = contentHost.querySelector('[data-today-stat="' + tk + '"]');
        if (el) el.textContent = String(todayStatMap[tk]);
      });
      var todayBtnCnts = {
        all: summary.totalCount || 0,
        pickup: summary.pickupCount || 0,
        return: summary.returnCount || 0
      };
      contentHost.querySelectorAll('[data-today-filter]').forEach(function (fBtn) {
        var key = fBtn.getAttribute('data-today-filter') || 'all';
        fBtn.classList.toggle('active', state.todayFilter === key);
        var cntEl = fBtn.querySelector('[data-today-btn-cnt="' + key + '"]');
        if (cntEl) cntEl.textContent = String(todayBtnCnts[key] || 0);
      });
      var clearTimeBtnEl = contentHost.querySelector('#today-clear-time-btn');
      if (clearTimeBtnEl) {
        clearTimeBtnEl.style.display = (state.todayTimeFrom || state.todayTimeTo) ? '' : 'none';
      }
      var tFromInp = contentHost.querySelector('#today-time-from');
      if (tFromInp && document.activeElement !== tFromInp && tFromInp.value !== (state.todayTimeFrom || '')) {
        tFromInp.value = state.todayTimeFrom || '';
      }
      var tToInp = contentHost.querySelector('#today-time-to');
      if (tToInp && document.activeElement !== tToInp && tToInp.value !== (state.todayTimeTo || '')) {
        tToInp.value = state.todayTimeTo || '';
      }
      var tSearchInp = contentHost.querySelector('#today-search-input');
      if (tSearchInp && document.activeElement !== tSearchInp && tSearchInp.value !== (state.todaySearch || '')) {
        tSearchInp.value = state.todaySearch || '';
      }

      if (radarRawReservations === null) {
        if (radarLoadError) {
          listBodyHost.innerHTML =
            '<div class="rg-error-banner" role="alert">' +
              '<div class="rg-error-banner-body">' +
                '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load Today\'s Pickups & Returns' : 'تعذر تحميل جدول التسليم والاستلام لليوم') + '</div>' +
                '<div class="rg-error-banner-msg">' + esc(radarLoadError) + '</div>' +
              '</div>' +
              '<button type="button" class="btn btn-sm btn-primary" id="today-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
            '</div>';
          bindTodayListBodyEvents(listBodyHost);
          return;
        }
        listBodyHost.innerHTML = '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div></div>';
        return;
      }

      var rowsHtml = '';
      if (!summary.items.length) {
        rowsHtml = '<div class="empty-state">' +
          (isEn ? 'No pickups or returns scheduled for today matching the filter.' : 'لا توجد عمليات تسليم أو إرجاع مجدولة لليوم مطابقة للفلتر الحالي.') +
        '</div>';
      } else {
        var desktopRows = [];
        var mobileCards = [];
        summary.items.forEach(function (entry) {
          var r = entry.reservation || {};
          var isPickup = entry.movementType === 'pickup';
          var moveLabel = isPickup
            ? (isEn ? 'Pickup Today' : 'تسليم اليوم')
            : (isEn ? 'Return Today' : 'إرجاع اليوم');
          var moveTone = isPickup ? 'status-info' : 'status-warning';
          var timingStateHtml = entry.isCompleted
            ? '<span class="status-tag status-success">' + (isEn ? 'Done' : 'مكتمل') + '</span>'
            : (entry.isOverdue
                ? '<span class="status-tag status-danger">' + (isEn ? 'Delayed' : 'متأخر عن الموعد') + '</span>'
                : '<span class="status-tag status-neutral">' + (isEn ? 'Scheduled' : 'مجدول') + '</span>');
          var assignedIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];
          var isMine = currentEmpId && assignedIds.indexOf(currentEmpId) !== -1;
          var waPhone = (core && core.normalizeWhatsappPhone) ? core.normalizeWhatsappPhone(r.customerPhone) : '';
          var schedTimeDisp = formatTimeOnly(entry.scheduledTime || '', ctx.lang);
          var waText = isPickup
            ? (isEn
                ? ('Hello ' + (r.customerName || '') + ', reminder for your vehicle pickup (' + (r.carName || '') + ') today at ' + schedTimeDisp + ' — Booking #' + (r.reservationNumber || ''))
                : ('مرحباً ' + (r.customerName || 'عميلنا الكريم') + '، نذكّركم بموعد استلام مركبتكم (' + (r.carName || '') + ') اليوم الساعة ' + schedTimeDisp + ' للحجز رقم ' + (r.reservationNumber || '') + '.'))
            : (core && core.buildExtensionOfferMessage ? core.buildExtensionOfferMessage(r, ctx.lang, { agentName: currentUser && currentUser.name }) : '');
          var waHref = waPhone ? ('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(waText)) : '';
          var telHref = (core && core.formatDirectCallTelHref) ? core.formatDirectCallTelHref(r.customerPhone, '9') : '';
          var telDisp = (core && core.formatDirectCallDisplayNumber) ? core.formatDirectCallDisplayNumber(r.customerPhone, '9') : '';
          var rowStateCls = entry.isOverdue ? ' is-overdue' : (entry.isCompleted ? ' is-done' : '');
          var schedTzHtml = entry.scheduledTime
            ? renderBookingTimezoneHtml(summary.todayDate || '', entry.scheduledTime, { timeOnly: true, compact: true })
            : '<span class="mono" dir="ltr">-</span>';

          desktopRows.push(
            '<tr data-today-key="' + esc(entry.key) + '" class="today-move-row' + rowStateCls + '">' +
              '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                '<div class="today-time-slot has-tz-stack">' + schedTzHtml + '</div>' +
                '<div class="cell-badges" style="margin-top:4px;">' + timingStateHtml + '</div>' +
              '</td>' +
              '<td style="white-space:nowrap;">' +
                '<span class="status-tag ' + moveTone + '">' + esc(moveLabel) + '</span>' +
                (entry.isExtended ? '<div class="cell-sub">' + (isEn ? 'After Extension' : 'بعد التمديد') + '</div>' : '') +
              '</td>' +
              '<td class="mono cell-res-num">' +
                '<div class="cell-res-head"><button type="button" class="btn-link-inline today-open-res" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber || r.id) + '</button></div>' +
                '<div class="cell-sub rg-ui-field-car-meta">' + esc(isPickup ? (r.pickupTypeAr || '-') : (r.returnTypeAr || '-')) + '</div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary"><button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName || '-') + '</button></div>' +
                '<div class="cell-sub"><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary">' + esc(formatCarNameDisplay(r.carName)) + (r.plateNumber ? ' · <span class="mono">' + esc(r.plateNumber) + '</span>' : '') + '</div>' +
                '<div class="cell-sub">' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</td>' +
              '<td><span class="status-tag ' + statusClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span></td>' +
              '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                '<button type="button" class="btn btn-sm btn-primary today-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                (canClaimButtons && !isMine
                  ? '<button type="button" class="btn btn-sm today-claim-btn" data-id="' + esc(r.id) + '">' + (isEn ? 'Claim' : 'استلام عندي') + '</button>'
                  : '') +
                (telHref
                  ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 9' : 'اتصال 9') + '</a>'
                  : '') +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal rg-ui-wa-btn" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
                  : '') +
              '</div></td>' +
            '</tr>'
          );

          mobileCards.push(
            '<article data-today-key="' + esc(entry.key) + '" class="today-mobile-card' + rowStateCls + '">' +
              '<div class="today-mobile-card-top">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<div class="today-time-slot has-tz-stack">' + schedTzHtml + '</div>' +
                  timingStateHtml +
                  '<span class="status-tag ' + moveTone + '">' + esc(moveLabel) + '</span>' +
                '</div>' +
                '<span class="status-tag ' + statusClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span>' +
              '</div>' +
              '<div class="today-mobile-card-mid">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn-link-inline today-open-res mono" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber || r.id) + '</button>' +
                  '<span class="cell-sub rg-ui-field-car-meta">' + esc(isPickup ? (r.pickupTypeAr || '-') : (r.returnTypeAr || '-')) + (entry.isExtended ? ' · ' + (isEn ? 'After Extension' : 'بعد التمديد') : '') + '</span>' +
                '</div>' +
                '<div class="cell-primary"><button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName || '-') + '</button> · <span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
                '<div class="cell-sub">' + esc(formatCarNameDisplay(r.carName)) + ' · ' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</div>' +
              '<div class="today-mobile-card-actions">' +
                '<button type="button" class="btn btn-sm btn-primary today-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                (canClaimButtons && !isMine
                  ? '<button type="button" class="btn btn-sm today-claim-btn" data-id="' + esc(r.id) + '">' + (isEn ? 'Claim' : 'استلام عندي') + '</button>'
                  : '') +
                (telHref
                  ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 9' : 'اتصال 9') + '</a>'
                  : '') +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal rg-ui-wa-btn" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
                  : '') +
              '</div>' +
            '</article>'
          );
        });

        rowsHtml =
          '<div class="table-wrap today-desktop-table"><table class="data-table"><thead><tr>' +
            '<th>' + (isEn ? 'Scheduled Time' : 'الموعد بالساعة') + '</th>' +
            '<th>' + (isEn ? 'Movement' : 'نوع الحركة') + '</th>' +
            '<th>' + (isEn ? 'Booking #' : 'رقم الحجز') + '</th>' +
            '<th>' + (isEn ? 'Customer & Phone' : 'العميل والجوال') + '</th>' +
            '<th>' + (isEn ? 'Vehicle & Branch' : 'المركبة والفرع') + '</th>' +
            '<th>' + (isEn ? 'Status' : 'الحالة') + '</th>' +
            '<th>' + (isEn ? 'Actions' : 'الإجراءات') + '</th>' +
          '</tr></thead><tbody>' + desktopRows.join('') + '</tbody></table></div>' +
          '<div class="today-mobile-cards">' + mobileCards.join('') + '</div>';
      }

      listBodyHost.innerHTML = rowsHtml;
      bindTodayListBodyEvents(listBodyHost);
    }

    function extractRadarItemsFromData(data) {
      if (!data || typeof data !== 'object') return null;
      if (Array.isArray(data.items)) return data.items;
      var byId = {};
      var list = [];
      var collect = function (arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (entry) {
          var r = (entry && entry.reservation && entry.reservation.id) ? entry.reservation : entry;
          if (r && r.id && !byId[r.id]) {
            byId[r.id] = true;
            list.push(r);
          }
        });
      };
      if (data.todaySummary) {
        collect(data.todaySummary.allItems);
        collect(data.todaySummary.items);
      }
      if (data.radarSummary) {
        collect(data.radarSummary.allItems);
        collect(data.radarSummary.items);
      }
      if (list.length > 0 || (data.counts && Number(data.counts.todayTotal || 0) === 0 && Number(data.counts.radarTotal || 0) === 0)) {
        return list;
      }
      return null;
    }

    async function refreshRadarData(showToast, extraOpts) {
      var seq = ++radarFetchSeq;
      var opts = extraOpts || {};
      var core = root.RGCrmCore;
      var todayDateStr = (core && core.getRiyadhDateString) ? core.getRiyadhDateString() : '';
      radarLoadError = '';
      if (state.viewMode === 'radar' && radarRawReservations === null) {
        paintRadarView();
      } else if (state.viewMode === 'today' && radarRawReservations === null) {
        paintTodayView();
      }
      try {
        var resp = await root.RGApi.callApi('getTodayAndRadar', {
          todayDate: todayDateStr,
          nowMs: Date.now(),
          silentRefresh: true,
          forceRefresh: Boolean(showToast || opts.forceRefresh),
          abortKey: 'res:todayRadar'
        });
        if (seq !== radarFetchSeq || !container.isConnected) return;
        if (resp && resp.aborted) return;
        var extracted = (resp && resp.success && resp.data) ? extractRadarItemsFromData(resp.data) : null;
        if (extracted !== null) {
          radarLoadError = '';
          radarRawReservations = extracted;
        } else if (!checkHasActiveResFilters() && !initialLoadError && currentItems.length > 0 && Number(payload.total || 0) <= currentItems.length) {
          radarLoadError = '';
          radarRawReservations = currentItems.filter(function (it) {
            return it && !(core && core.isInactiveReservation && core.isInactiveReservation(it));
          });
        } else if (radarRawReservations === null) {
          radarLoadError = (resp && resp.message) || 'تعذر تحميل بيانات اليوم والرادار.';
          var tb = document.getElementById('res-today-tab-count');
          var rb = document.getElementById('res-radar-tab-count');
          if (tb) tb.textContent = '!';
          if (rb) rb.textContent = '!';
        }
        paintRadarView();
        paintTodayView();
        if (showToast && resp && resp.success) {
          ctx.toast(state.viewMode === 'today'
            ? (isEn ? 'Today\'s pickups & returns updated.' : 'تم تحديث جدول التسليم والاستلام لليوم.')
            : (isEn ? '24h Expiry Radar updated.' : 'تم تحديث رادار الانتهاء بنجاح.'));
        }
      } catch (_e) {
        if (seq !== radarFetchSeq || !container.isConnected) return;
        if (radarRawReservations === null) {
          if (!checkHasActiveResFilters() && !initialLoadError && currentItems.length > 0 && Number(payload.total || 0) <= currentItems.length) {
            radarLoadError = '';
            radarRawReservations = currentItems.filter(function (it) {
              return it && !(core && core.isInactiveReservation && core.isInactiveReservation(it));
            });
          } else {
            radarLoadError = 'تعذر الاتصال بالخادم أثناء تحميل بيانات اليوم والرادار.';
          }
        }
        paintRadarView();
        paintTodayView();
      }
    }

    var idLookupTopBtn = document.getElementById('res-id-lookup-btn');
    if (idLookupTopBtn && root.RGInactive && root.RGInactive.openNationalIdLookupModal) {
      idLookupTopBtn.addEventListener('click', function () {
        root.RGInactive.openNationalIdLookupModal(ctx, '');
      });
    }

    function setViewMode(nextMode) {
      var targetMode = VALID_VIEW_MODES.indexOf(nextMode) !== -1 ? nextMode : 'all';
      if (targetMode === 'today' && !canViewTodayTab) targetMode = 'all';
      if (targetMode === 'radar' && !canViewRadarTab) targetMode = 'all';
      if (targetMode === 'cancelled' && !canViewCancelledTab) targetMode = 'all';
      if (targetMode === 'rejected' && !canViewRejectedTab) targetMode = 'all';
      var listModeChanged = isListViewMode(targetMode) && targetMode !== state.viewMode;
      state.viewMode = targetMode;
      if (listModeChanged) state.page = 1;
      if (ctx.saveRouteFilters) ctx.saveRouteFilters();
      var allViewEl = document.getElementById('res-all-view');
      var todayViewEl = document.getElementById('res-today-view');
      var radarViewEl = document.getElementById('res-radar-view');
      if (allViewEl) allViewEl.classList.toggle('hidden', !isListViewMode(state.viewMode));
      if (todayViewEl) todayViewEl.classList.toggle('hidden', state.viewMode !== 'today');
      if (radarViewEl) radarViewEl.classList.toggle('hidden', state.viewMode !== 'radar');
      syncColsButtonVisibility();
      container.querySelectorAll('[data-res-view]').forEach(function (tabBtn) {
        var isAct = tabBtn.getAttribute('data-res-view') === state.viewMode;
        tabBtn.classList.toggle('is-active', isAct);
        tabBtn.setAttribute('aria-selected', String(isAct));
      });
      if (state.viewMode === 'radar') {
        if (radarRawReservations === null) refreshRadarData(false);
        else paintRadarView();
      } else if (state.viewMode === 'today') {
        if (state.todayDisplayMode === 'calendar' && calendarRawItems === null) {
          ensureTodayCalendarLoaded({ forceRefresh: false });
        }
        if (radarRawReservations === null) refreshRadarData(false);
        else paintTodayView();
      } else {
        updateLifecycleBanner();
        refreshTableRegion({ forceRefresh: Boolean(listModeChanged), silentRefresh: !listModeChanged });
      }
    }

    container.querySelectorAll('[data-res-view]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        setViewMode(tabBtn.getAttribute('data-res-view'));
      });
    });

    if (canViewTodayTab || canViewRadarTab) {
      if (!checkHasActiveResFilters() && !initialLoadError && currentItems.length > 0 && Number(payload.total || 0) <= currentItems.length) {
        var activeOnlyForOps = currentItems.filter(function (it) {
          return it && !(root.RGCrmCore && root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(it));
        });
        radarRawReservations = activeOnlyForOps.slice();
        calendarRawItems = activeOnlyForOps.slice();
        calendarLoadedWindow = { from: '0000-01-01', to: '9999-12-31' };
        paintRadarView();
        paintTodayView();
      } else {
        refreshRadarData(false);
        if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
          ensureTodayCalendarLoaded({ forceRefresh: false });
        }
      }
    }

    var runPendingResDelta = function (opts) {
      if (!container || !container.isConnected) return Promise.resolve();
      var o = opts || {};
      var silent = o.silent !== false;
      var force = o.forceRefresh !== false;
      var tablePromise = (o.prefetchedData && Array.isArray(o.prefetchedData.items))
        ? Promise.resolve().then(function () {
            var pTotalPages = Math.max(1, Number(o.prefetchedData.totalPages || 1));
            if (state.page > pTotalPages && Number(o.prefetchedData.total || 0) > 0) {
              state.page = pTotalPages;
              if (ctx.saveRouteFilters) ctx.saveRouteFilters();
              return refreshTableRegion({ silentRefresh: silent, forceRefresh: true });
            }
            paintTableRegion(o.prefetchedData);
          })
        : refreshTableRegion({ silentRefresh: silent, forceRefresh: force });
      return Promise.all([
        tablePromise,
        refreshRadarData(false, { forceRefresh: force }),
        (state.viewMode === 'today' && state.todayDisplayMode === 'calendar')
          ? ensureTodayCalendarLoaded({ silentRefresh: silent, forceRefresh: force })
          : Promise.resolve().then(function () { calendarRawItems = null; calendarLoadedWindow = { from: '', to: '' }; })
      ]).catch(function () {});
    };

    var scheduleResRefreshWhenIdle = function (opts) {
      var activeEl = document.activeElement;
      var editingControl = Boolean(activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName));
      if (editingControl && !(opts && opts.manual)) {
        if (!container._rgPendingResDelta) {
          container._rgPendingResDelta = true;
          container.addEventListener('focusout', function onBlurResDelta() {
            setTimeout(function () {
              if (!container || !container.isConnected) return;
              var curAct = document.activeElement;
              var stillEditing = Boolean(curAct && container.contains(curAct) && /^(INPUT|TEXTAREA|SELECT)$/.test(curAct.tagName));
              if (stillEditing) {
                container.addEventListener('focusout', onBlurResDelta, { once: true });
                return;
              }
              container._rgPendingResDelta = false;
              runPendingResDelta(opts);
            }, 120);
          }, { once: true });
        }
        return Promise.resolve();
      }
      return runPendingResDelta(opts);
    };

    container._rgRefreshDataOnly = function (opts) {
      return scheduleResRefreshWhenIdle(opts || { silent: true, forceRefresh: true });
    };

    var resDeltaState = { todayRadarCounts: null };

    if (!container._rgResDeltaBound) {
      container._rgResDeltaBound = true;
      var onResDeltaSync = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onResDeltaSync);
          return;
        }
        var d = (ev && ev.detail) || {};
        var core = root.RGCrmCore;
        var hasResChanges = Boolean(
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
          (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
          (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
          (Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0) ||
          (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
          (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
          Boolean(d.deletedAllReservationsBefore) ||
          Boolean(d.changedSettings) ||
          Boolean(d.changedDelegations) ||
          Boolean(d.changedRoles)
        );
        var prevRadarJson = resDeltaState.todayRadarCounts ? JSON.stringify(resDeltaState.todayRadarCounts) : null;
        var nextRadarJson = d.todayRadarCounts ? JSON.stringify(d.todayRadarCounts) : null;
        var radarCountsChanged = Boolean(nextRadarJson && prevRadarJson !== nextRadarJson);
        if (nextRadarJson) resDeltaState.todayRadarCounts = d.todayRadarCounts;
        if (!hasResChanges && !radarCountsChanged) return;

        var chgResList = Array.isArray(d.changedReservations) ? d.changedReservations : [];
        var delResIds = Array.isArray(d.deletedReservationIds) ? d.deletedReservationIds : [];
        if ((chgResList.length > 0 || delResIds.length > 0) && !d.deletedAllReservationsBefore) {
          applyLocalResChangesToTable(chgResList, delResIds);
          if (core && core.mergeDeltaRecords) {
            var delSet = {};
            delResIds.forEach(function (id) { if (id) delSet[id] = true; });
            if (Array.isArray(radarRawReservations)) {
              radarRawReservations = core.mergeDeltaRecords(radarRawReservations, chgResList, 'id');
              radarRawReservations = radarRawReservations.filter(function (it) {
                return it && !delSet[it.id] && !(core.isInactiveReservation && core.isInactiveReservation(it));
              });
              paintRadarView();
              if (state.todayDisplayMode !== 'calendar') paintTodayView();
            }
            if (Array.isArray(calendarRawItems)) {
              calendarRawItems = core.mergeDeltaRecords(calendarRawItems, chgResList, 'id');
              calendarRawItems = calendarRawItems.filter(function (it) {
                return it && !delSet[it.id] && !(core.isInactiveReservation && core.isInactiveReservation(it));
              });
              if (state.viewMode === 'today' && state.todayDisplayMode === 'calendar') {
                paintTodayView();
              }
            }
          }
        }
        scheduleResRefreshWhenIdle({ silent: true, forceRefresh: true });
      };
      document.addEventListener('rg:deltasync', onResDeltaSync);
    }

    if (!container._rgResPrefsBound) {
      container._rgResPrefsBound = true;
      var onResPersonalPrefs = function () {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:personalprefschange', onResPersonalPrefs);
          return;
        }
        paintCurrentItems();
        if (state.viewMode === 'today') {
          paintTodayView();
        }
      };
      document.addEventListener('rg:personalprefschange', onResPersonalPrefs);
    }
  }

  async function openReservationDrawer(reservationId, ctx, employees, onUpdated, opts) {
    function resolveEmployeesPool(explicit) {
      if (Array.isArray(explicit) && explicit.length) return explicit.slice();
      if (root.RGApp && root.RGApp.getEmployeesState) {
        var st = root.RGApp.getEmployeesState();
        if (st && Array.isArray(st.items) && st.items.length) return st.items.slice();
      }
      if (root.RGApi && root.RGApi.getCachedData) {
        var cached = root.RGApi.getCachedData('getEmployees', {}, true);
        if (cached && Array.isArray(cached.items) && cached.items.length) return cached.items.slice();
      }
      return [];
    }
    var isEn = Boolean((ctx && ctx.lang === 'en') || (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en'));
    var resolvedEmployees = resolveEmployeesPool(employees);
    var modalRoot = document.getElementById('modal-root');
    var instant = (root.RGApi && root.RGApi.getInstantReservationDetails)
      ? root.RGApi.getInstantReservationDetails(reservationId)
      : null;
    var d = (instant && instant.data && instant.data.reservation) ? instant.data : null;

    if (!d) {
      modalRoot.innerHTML =
        '<div class="drawer-backdrop" id="res-drawer-backdrop" data-res-id="' + esc(reservationId) + '" role="dialog" aria-modal="true">' +
          '<div class="drawer-panel">' +
            '<div class="modal-header">' +
              '<div><h3 class="modal-title">جاري فتح تفاصيل الحجز...</h3></div>' +
              '<button type="button" class="btn btn-sm" id="drawer-skeleton-close">إغلاق</button>' +
            '</div>' +
            '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-grid"><div class="rg-skeleton-box"></div><div class="rg-skeleton-box"></div><div class="rg-skeleton-box"></div></div></div>' +
          '</div>' +
        '</div>';
      var skClose = document.getElementById('drawer-skeleton-close');
      if (skClose) skClose.addEventListener('click', function () { modalRoot.innerHTML = ''; });
      var detailRes = await root.RGApi.callApi('getReservationDetails', { reservationId: reservationId });
      if (!detailRes.success) {
        if (document.getElementById('res-drawer-backdrop')) modalRoot.innerHTML = '';
        ctx.toast(detailRes.message, true);
        return;
      }
      var curBackdrop = document.getElementById('res-drawer-backdrop');
      if (!curBackdrop || curBackdrop.getAttribute('data-res-id') !== String(reservationId)) return;
      d = detailRes.data;
    }

    var user = root.RGAuth.getUser();
    var canDrawerAct = function (actKey) {
      return !root.RGCrmCore || !root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(user, actKey);
    };
    var canAssign = root.RGCrmCore.canUserPerform(user, 'assign_employees');
    var canEditReservation = root.RGCrmCore.canUserPerform(user, 'edit_reservation_details');
    var canEditAnyFollowUp = root.RGCrmCore.canUserPerform(user, 'edit_any_followup');
    var canEditTicket = root.RGCrmCore.canUserPerform(user, 'edit_ticket_details');
    var canExportPdfBtn = canDrawerAct('act_export_pdf');
    var canExportExcelBtn = canDrawerAct('act_export_excel');
    var canReportProblemBtn = canDrawerAct('act_report_problem');
    var canClaimDrawerBtn = canDrawerAct('act_claim_reservation');
    var canCloseTicketDrawerBtn = canDrawerAct('act_close_delete_ticket');

    function notifyParentUpdated(updatedObj) {
      if (updatedObj && typeof updatedObj === 'object' && updatedObj.id && d && d.reservation) {
        d.reservation = Object.assign({}, d.reservation, updatedObj);
      }
      if (onUpdated) onUpdated((updatedObj && typeof updatedObj === 'object' && updatedObj.id) ? updatedObj : (d && d.reservation ? d.reservation : null));
    }

    function reopenSelf(updatedObj) {
      if (updatedObj === null) {
        var openBd = document.getElementById('res-drawer-backdrop');
        if (openBd && openBd.getAttribute('data-res-id') === String(d.reservation.id)) {
          root.RGApi.callApi('getReservationDetails', { reservationId: d.reservation.id, forceRefresh: true }).then(function (fresh) {
            if (fresh && fresh.success && fresh.data && fresh.data.reservation) {
              d = fresh.data;
              paintDrawer();
              notifyParentUpdated(d.reservation);
            }
          }).catch(function () {});
        } else {
          notifyParentUpdated(null);
        }
        return;
      }
      if (updatedObj && typeof updatedObj === 'object') {
        var resPatch = (updatedObj.reservation && typeof updatedObj.reservation === 'object' && updatedObj.reservation.id)
          ? updatedObj.reservation
          : (updatedObj.id ? updatedObj : null);
        if (resPatch && d && d.reservation) {
          d.reservation = Object.assign({}, d.reservation, resPatch);
        }
        if (updatedObj.followUp && updatedObj.followUp.id && Array.isArray(d.followUps)) {
          var matchedFu = false;
          d.followUps = d.followUps.map(function (f) {
            if (f && f.id === updatedObj.followUp.id) {
              matchedFu = true;
              return Object.assign({}, f, updatedObj.followUp);
            }
            return f;
          });
          if (!matchedFu) {
            d.followUps = [updatedObj.followUp].concat(d.followUps);
          }
        }
      }
      notifyParentUpdated(d && d.reservation ? d.reservation : null);
      if (typeof startDrawerLifecycle === 'function') {
        startDrawerLifecycle();
      }
      paintDrawer();
    }

    function buildStatusStagesHtml(r) {
      var stages = (root.RGCrmCore && root.RGCrmCore.normalizeStatusHistory)
        ? root.RGCrmCore.normalizeStatusHistory(r.statusHistory)
        : (Array.isArray(r.statusHistory) ? r.statusHistory : []);
      if (stages.length === 0) {
        stages = [{
          stageNumber: 1,
          source: 'api_pull',
          previousStatus: '',
          newStatus: r.internalStatus || r.originalStatusAr || 'تم الإنشاء',
          changedAt: r.createdAt || r.lastUpdatedAt || '',
          changedByName: r.lastUpdatedByName || 'النظام',
          note: r.lastUpdateText || 'الحالة الأولية المسجلة'
        }];
      }
      return '<div class="surface-card rg-ui-drawer-stages" style="padding:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<h4 style="margin:0;font-size:14px;">مراحل الحالة وتطور الحجز (<span class="tabular-nums">' + stages.length + '</span>)</h4>' +
          '<span style="font-size:12px;color:var(--text-muted);">تسلسل كامل لتغيرات الحالة من المنصة والمتابعات</span>' +
        '</div>' +
        '<ol class="stage-timeline">' +
          stages.map(function (st, idx) {
            var srcLabel = (root.RGCrmCore && root.RGCrmCore.formatStatusStageSourceLabel)
              ? root.RGCrmCore.formatStatusStageSourceLabel(st.source)
              : 'تحديث الحالة';
            var isLatest = idx === stages.length - 1;
            return '<li class="stage-item' + (isLatest ? ' is-latest' : '') + '">' +
              '<div class="stage-item-head">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<span class="stage-badge">المرحلة ' + Number(st.stageNumber || (idx + 1)) + '</span>' +
                  '<span class="status-tag ' + statusClass(st.newStatus) + '">' + esc(st.newStatus) + '</span>' +
                  (st.previousStatus && st.previousStatus !== st.newStatus ? '<span class="stage-prev">من: ' + esc(st.previousStatus) + '</span>' : '') +
                '</div>' +
                '<span class="status-tag status-neutral">' + esc(srcLabel) + '</span>' +
              '</div>' +
              (st.note ? '<div class="stage-note">' + esc(st.note) + '</div>' : '') +
              '<div class="meta-inline"><span>بواسطة: ' + esc(st.changedByName || 'النظام') + '</span><span>·</span><span class="mono tabular-nums">' + esc(formatTimestamp(st.changedAt)) + '</span></div>' +
            '</li>';
          }).join('') +
        '</ol>' +
      '</div>';
    }

    function fmtMentionText(text) {
      if (root.RGCrmMentions && root.RGCrmMentions.renderHighlightedText) {
        return root.RGCrmMentions.renderHighlightedText(text, resolvedEmployees, esc);
      }
      return esc(text);
    }

    function buildExtensionsSectionHtml(r, extensions) {
      var list = Array.isArray(extensions) ? extensions : [];
      var comp = (root.RGCrmCore && root.RGCrmCore.computeExtensionComparisonSummary)
        ? root.RGCrmCore.computeExtensionComparisonSummary(r, list)
        : null;
      var extSummary = (root.RGCrmCore && root.RGCrmCore.summarizeReservationExtensions)
        ? root.RGCrmCore.summarizeReservationExtensions(list, r, r.extendedUntilDate || r.endDate, r.extendedUntilTime || r.endTime)
        : null;
      var extCount = Number((comp && comp.extensionsCount) || (extSummary && extSummary.extensionsCount) || r.extensionsCount || list.length || 0);
      var extDays = Number((comp && comp.extendedDays) || (extSummary && extSummary.extendedDaysCount) || r.extendedDaysCount || 0);
      var extAmount = Number((comp && comp.extensionsAmount) || (extSummary && extSummary.extensionsAmount) || r.extensionsAmount || 0);
      var extUntilDate = (comp && comp.effectiveEndDate) || (extSummary && extSummary.extendedUntilDate) || r.extendedUntilDate || (extCount > 0 ? r.endDate : '');
      var extUntilTime = (comp && comp.effectiveEndTime) || (extSummary && extSummary.extendedUntilTime) || r.extendedUntilTime || (extCount > 0 ? r.endTime : '');
      var items = (comp && comp.extensions && comp.extensions.length)
        ? comp.extensions
        : ((extSummary && extSummary.extensions && extSummary.extensions.length) ? extSummary.extensions : list);

      var origEndDate = (comp && comp.originalEndDate) || formatDateOnly(r.originalEndDate || r.endDate);
      var origEndTime = (comp && comp.originalEndTime) || r.originalEndTime || r.endTime || '';
      var baseDays = comp ? comp.baseDays : Number(r.daysCount || 1);
      var totalDaysComp = comp ? comp.totalDays : (baseDays + extDays);
      var baseAmt = comp ? comp.baseAmount : Number(r.baseAmount || 0);
      var totalAmt = comp ? comp.totalAmount : Number(r.totalAmount || (baseAmt + extAmount));
      var deltaPct = comp ? comp.amountDeltaPct : 0;
      var hasExtended = comp ? comp.hasExtensions : (extCount > 0 || extDays > 0);

      var curLabel = isEn ? 'SAR' : 'ر.س';
      var dayUnit = isEn ? 'd' : 'يوم';
      var comparisonHtml =
        '<div class="ext-compare-card" data-testid="extension-comparison-card">' +
          '<div class="ext-compare-head">' +
            '<div>' +
              '<strong class="ext-compare-title">' + (isEn ? 'Extensions & Modifications Quick Comparison' : 'المقارنة السريعة للتمديدات والتعديلات') + '</strong>' +
              '<span class="ext-compare-sub">' + (isEn ? 'Original contract vs. extended return schedule & total amount' : 'الفرق بين العقد الأصلي والموعد والتكلفة بعد التمديد') + '</span>' +
            '</div>' +
            '<span class="status-tag ' + (hasExtended ? 'status-info' : 'status-neutral') + ' tabular-nums">' +
              (hasExtended
                ? ('+' + extDays + (isEn ? ' extra days · +' : ' يوم إضافي · +') + extAmount + ' ' + curLabel + (deltaPct > 0 ? ' (+' + deltaPct + '%)' : ''))
                : (isEn ? 'No extensions — original schedule' : 'بدون تمديد — على الموعد الأصلي')) +
            '</span>' +
          '</div>' +
          '<div class="ext-compare-grid">' +
            '<div class="ext-compare-col is-original">' +
              '<span class="ext-compare-col-label">' + (isEn ? 'Original Contract (Before Extension)' : 'العقد الأصلي (قبل التمديد)') + '</span>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Original Return Date' : 'تاريخ الإرجاع الأصلي') + '</span><strong>' + renderBookingTimezoneHtml(origEndDate, origEndTime, { compact: false }) + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Base Days' : 'الأيام الأساسية') + '</span><strong class="tabular-nums">' + baseDays + ' ' + dayUnit + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Base Amount' : 'قيمة العقد الأساسي') + '</span><strong class="mono tabular-nums">' + baseAmt + ' ' + curLabel + '</strong></div>' +
            '</div>' +
            '<div class="ext-compare-col is-extended">' +
              '<span class="ext-compare-col-label">' + (hasExtended ? (isEn ? 'After Extension & Modification' : 'بعد التمديد والتعديل') : (isEn ? 'Current Contract Status' : 'الوضع الحالي للعقد')) + '</span>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Extended Return Date' : 'تاريخ الإرجاع الممدد') + '</span><strong>' + (hasExtended && extUntilDate ? renderBookingTimezoneHtml(extUntilDate, extUntilTime, { compact: false }) : (isEn ? 'Not extended' : 'لم يُمدد')) + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Total Duration' : 'إجمالي المدة') + '</span><strong class="tabular-nums">' + totalDaysComp + ' ' + dayUnit + (extDays > 0 ? ' <span class="ext-delta-inline">(+' + extDays + ')</span>' : '') + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Final Total' : 'الإجمالي النهائي') + '</span><strong class="mono tabular-nums">' + totalAmt + ' ' + curLabel + (extAmount > 0 ? ' <span class="ext-delta-inline">(+' + extAmount + ' ' + curLabel + ')</span>' : '') + '</strong></div>' +
            '</div>' +
          '</div>' +
        '</div>';

      return '<div class="surface-card" id="drawer-extensions-section" style="padding:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<h4 style="margin:0;font-size:14px;">' + (isEn ? 'Extensions Audit & Details' : 'سجل التعديلات وتفاصيل التمديدات') + ' (<span class="tabular-nums">' + extCount + '</span>)</h4>' +
          '<span style="font-size:12px;color:var(--text-muted);">' + (isEn ? 'Extension count, date comparison, and cost breakdown' : 'عدد مرات التمديد، مقارنة التواريخ، وتكلفة كل تمديد') + '</span>' +
        '</div>' +
        comparisonHtml +
        '<div class="ext-summary-strip">' +
          '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extensions Count' : 'كم مرة ممدد') + '</span><span class="detail-v tabular-nums">' + extCount + ' ' + (isEn ? (extCount === 1 ? 'time' : 'times') : (extCount === 1 ? 'مرة' : 'مرات')) + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extended Days' : 'إجمالي أيام التمديد') + '</span><span class="detail-v tabular-nums">' + extDays + ' ' + dayUnit + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extensions Amount' : 'إجمالي سعر التمديد') + '</span><span class="detail-v mono tabular-nums">' + extAmount + ' ' + curLabel + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extended Until' : 'التمديد لحد') + '</span><span class="detail-v">' + (extUntilDate ? renderBookingTimezoneHtml(extUntilDate, extUntilTime, { compact: false }) : (isEn ? 'None' : 'لا يوجد تمديد')) + '</span></div>' +
        '</div>' +
        (items.length === 0
          ? '<div style="margin-top:10px;font-size:13px;color:var(--text-muted);">' + (isEn ? 'No extensions recorded for this reservation yet.' : 'لا توجد تمديدات مسجلة لهذا الحجز حتى الآن.') + '</div>'
          : '<div class="ext-list">' +
              items.map(function (ex, idx) {
                var seq = Number(ex.sequenceNumber || (idx + 1));
                var typeLbl = ex.extensionTypeAr || (root.RGCrmCore && root.RGCrmCore.translateExtensionType ? root.RGCrmCore.translateExtensionType(ex.extensionType) : (ex.extensionType || (isEn ? 'Extension' : 'تمديد')));
                var payStAr = ex.paymentStatus
                  ? (root.RGCrmCore && root.RGCrmCore.translateOriginalStatus ? root.RGCrmCore.translateOriginalStatus(ex.paymentStatus) : ex.paymentStatus)
                  : '';
                var payLabel = ex.paymentMethod ? (ex.paymentMethod + (payStAr ? ' (' + payStAr + ')' : '')) : (payStAr || '-');
                var vatNote = (Number(ex.subTotal || 0) > 0 || Number(ex.vatAmount || 0) > 0)
                  ? ((isEn ? 'Net ' : 'صافي ') + Number(ex.subTotal || 0) + (isEn ? ' + VAT ' : ' + ضريبة ') + Number(ex.vatAmount || 0))
                  : '';
                return '<div class="ext-item">' +
                  '<div class="ext-item-head">' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                      '<span class="stage-badge">#' + seq + '</span>' +
                      '<strong class="mono">' + esc(ex.extensionNumber || ('EXT-' + seq)) + '</strong>' +
                      '<span class="status-tag status-info">' + esc(typeLbl) + '</span>' +
                      (ex.statusAr ? '<span class="status-tag ' + statusClass(ex.statusAr) + '">' + esc(ex.statusAr) + '</span>' : '') +
                    '</div>' +
                    '<strong class="mono tabular-nums" style="color:var(--brand-primary);font-size:14px;">' + Number(ex.amount || 0) + ' ' + curLabel + '</strong>' +
                  '</div>' +
                  '<div class="meta-inline">' +
                    renderBookingTimezoneHtml(ex.startDate, ex.startTime, { compact: true }) + ' <span>←</span> ' + renderBookingTimezoneHtml(ex.endDate, ex.endTime, { compact: true }) +
                    '<span>·</span>' +
                    '<span class="tabular-nums"><strong>' + Number(ex.extendDays || 0) + '</strong> ' + dayUnit + '</span>' +
                    (vatNote ? '<span>·</span><span class="tabular-nums">' + esc(vatNote) + '</span>' : '') +
                    (payLabel !== '-' ? '<span>·</span><span>' + (isEn ? 'Payment: ' : 'الدفع: ') + esc(payLabel) + '</span>' : '') +
                    (ex.paymentDate ? '<span>·</span><span class="mono tabular-nums">' + esc(formatTimestamp(ex.paymentDate)) + '</span>' : '') +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>') +
      '</div>';
    }

    var drawerLockInfo = null;
    var remoteConflictInfo = null;
    var isPaintingDrawer = false;
    var drawerCleanedUp = false;
    var lockHeartbeatTimer = null;
    var modalObserver = null;

    function cleanupDrawerLifecycle() {
      if (drawerCleanedUp) return;
      drawerCleanedUp = true;
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      }
      if (lockHeartbeatTimer) {
        clearInterval(lockHeartbeatTimer);
        lockHeartbeatTimer = null;
      }
      if (modalObserver) {
        try { modalObserver.disconnect(); } catch (_e) {}
        modalObserver = null;
      }
      document.removeEventListener('rg:deltasync', onDeltaSyncDrawer);
      document.removeEventListener('rg:personalprefschange', onPersonalPrefsDrawer);
      if (root.Chart && typeof root.Chart.getChart === 'function') {
        ['res-drawer-chart-finance', 'res-drawer-chart-activity'].forEach(function (cid) {
          var el = document.getElementById(cid);
          var existing = el ? root.Chart.getChart(el) : null;
          if (existing) {
            try { existing.destroy(); } catch (_e) {}
          }
        });
      }
      if (root.RGApi && root.RGApi.callApi && d && d.reservation && d.reservation.id) {
        root.RGApi.callApi('releaseReservationLock', { reservationId: d.reservation.id, silentRefresh: true }).catch(function () {});
      }
    }

    function requestDrawerExit(proceedFn) {
      if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
        root.RGApp.requestCloseWithGuard(proceedFn);
      } else if (typeof proceedFn === 'function') {
        proceedFn();
      }
    }

    function onPersonalPrefsDrawer() {
      if (drawerCleanedUp) return;
      var curBackdrop = document.getElementById('res-drawer-backdrop');
      if (!curBackdrop || curBackdrop.getAttribute('data-res-id') !== String(d.reservation.id)) return;
      var activeEl = document.activeElement;
      var isTyping = activeEl && modalRoot.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName);
      if (!isTyping) paintDrawer();
    }

    function onDeltaSyncDrawer(ev) {
      if (drawerCleanedUp || !ev || !ev.detail || ev.detail.localMutation) return;
      var det = ev.detail;
      var curBackdrop = document.getElementById('res-drawer-backdrop');
      if (!curBackdrop || curBackdrop.getAttribute('data-res-id') !== String(d.reservation.id)) return;
      var curResId = String(d.reservation.id);

      var wasDeleted = Boolean(det.deletedAllReservationsBefore) || (
        Array.isArray(det.deletedReservationIds) &&
        det.deletedReservationIds.some(function (did) { return String(did) === curResId; })
      );
      if (wasDeleted) {
        cleanupDrawerLifecycle();
        curBackdrop.remove();
        if (ctx && typeof ctx.toast === 'function') {
          ctx.toast(isEn ? 'This reservation was removed from the database.' : 'تم حذف هذا الحجز من قاعدة البيانات.');
        }
        return;
      }

      if (Array.isArray(det.locks)) {
        var foundLock = det.locks.find(function (l) {
          return l && l.reservationId === d.reservation.id && user && l.lockedById !== user.id;
        });
        if (JSON.stringify(foundLock || null) !== JSON.stringify(drawerLockInfo || null)) {
          drawerLockInfo = foundLock || null;
          var bannerHost = document.getElementById('drawer-softlock-host');
          if (bannerHost) {
            bannerHost.innerHTML = drawerLockInfo
              ? ('<div class="rg-softlock-banner" role="status">🔒 ' + (isEn ? ('Currently being followed up by ' + esc(drawerLockInfo.lockedByName)) : ('يقوم ' + esc(drawerLockInfo.lockedByName) + ' حالياً بمتابعة هذا الحجز')) + '</div>')
              : '';
          }
        }
      }

      var changedRes = Array.isArray(det.changedReservations)
        ? det.changedReservations.find(function (x) { return x && String(x.id) === curResId; })
        : null;
      var changedResFollowUp = Array.isArray(det.changedFollowUps)
        ? det.changedFollowUps.some(function (f) { return f && String(f.reservationId) === curResId && (!user || String(f.employeeId || '') !== String(user.id || '')); })
        : false;
      var changedResProblem = Array.isArray(det.changedProblems)
        ? det.changedProblems.some(function (p) { return p && String(p.reservationId) === curResId; })
        : false;
      var deletedResProblem = Array.isArray(det.deletedProblemIds) && Array.isArray(d.problems)
        ? d.problems.some(function (p) { return p && det.deletedProblemIds.some(function (dpid) { return String(dpid) === String(p.id); }); })
        : false;
      var deletedResFollowUp = Array.isArray(det.deletedFollowUpIds) && Array.isArray(d.followUps)
        ? d.followUps.some(function (f) { return f && det.deletedFollowUpIds.some(function (dfuid) { return String(dfuid) === String(f.id); }); })
        : false;

      var hasResUpdate = Boolean(
        (changedRes && changedRes.updatedAt && changedRes.updatedAt !== d.reservation.updatedAt && (!user || changedRes.lastUpdatedById !== user.id)) ||
        changedResFollowUp ||
        changedResProblem ||
        deletedResProblem ||
        deletedResFollowUp
      );
      if (hasResUpdate) {
        var byName = (changedRes && changedRes.lastUpdatedByName) || (isEn ? 'colleague' : 'زميل');
        var activeEl = document.activeElement;
        var isTypingInDrawer = Boolean(activeEl && modalRoot.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName));
        if (!isTypingInDrawer) {
          root.RGApi.callApi('getReservationDetails', { reservationId: curResId, forceRefresh: true, silentRefresh: true }).then(function (fresh) {
            if (drawerCleanedUp) return;
            var latestBackdrop = document.getElementById('res-drawer-backdrop');
            if (!latestBackdrop || latestBackdrop.getAttribute('data-res-id') !== curResId) return;
            if (fresh && fresh.success && fresh.data && fresh.data.reservation) {
              remoteConflictInfo = null;
              d = fresh.data;
              paintDrawer();
            }
          }).catch(function () {});
          return;
        }
        remoteConflictInfo = { byName: byName, updatedAt: (changedRes && changedRes.updatedAt) || new Date().toISOString() };
        var cHost = document.getElementById('drawer-conflict-host');
        if (cHost) {
          cHost.innerHTML =
            '<div class="rg-conflict-banner" role="alert">' +
              '<span>⚡ ' + (isEn ? ('This booking was updated by ' + esc(byName) + '.') : ('تم تحديث هذا الحجز بواسطة ' + esc(byName) + '.')) + '</span>' +
              '<button type="button" class="btn btn-sm btn-primary" id="drawer-reload-conflict-btn">' + (isEn ? 'Reload Latest' : 'اضغط للتحديث') + '</button>' +
            '</div>';
          var rBtn = document.getElementById('drawer-reload-conflict-btn');
          if (rBtn) {
            rBtn.addEventListener('click', async function () {
              remoteConflictInfo = null;
              var fresh = await root.RGApi.callApi('getReservationDetails', { reservationId: curResId, forceRefresh: true });
              if (fresh && fresh.success && fresh.data && fresh.data.reservation) {
                d = fresh.data;
                paintDrawer();
              }
            });
          }
        }
      }
    }

    function paintDrawer() {
      isPaintingDrawer = true;
      var r = d.reservation;
      var core = root.RGCrmCore || {};
      var assignedIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];
      var assignedNames = Array.isArray(r.assignedEmployeeNames) ? r.assignedEmployeeNames : [];
      var isClaimedByMe = assignedIds.indexOf(user.id) !== -1;
      var extCount = Number(r.extensionsCount || (Array.isArray(d.extensions) ? d.extensions.length : 0) || (r.hasExtensions ? 1 : 0));
      var extDays = Number(r.extendedDaysCount || 0);
      var totalDays = Number(r.totalDaysCount || ((Number(r.daysCount || 1)) + extDays));
      var origEndD = r.originalEndDate || r.endDate;
      var origEndT = r.originalEndTime || r.endTime || '';
      var hasExtended = extCount > 0 || Boolean(r.extendedUntilDate);
      var extUntilD = r.extendedUntilDate || (hasExtended ? r.endDate : '');
      var extUntilT = r.extendedUntilTime || (hasExtended ? r.endTime : '');

      var telHref = core.formatDirectCallTelHref ? core.formatDirectCallTelHref(r.customerPhone, '9') : '';
      var telDisp = core.formatDirectCallDisplayNumber ? core.formatDirectCallDisplayNumber(r.customerPhone, '9') : '';
      var sharedInfo = core.computeSharedAssignmentInfo
        ? core.computeSharedAssignmentInfo(assignedIds, assignedNames, user.id, ctx.lang)
        : null;
      var canPinNote = Boolean(
        user &&
        (user.role === 'supervisor' || user.role === 'general_manager') &&
        (!core.canUserPerform || core.canUserPerform(user, 'pin_reservation_note'))
      );
      var pinnedNoteText = String(r.pinnedNote || '').trim();
      var noAnswerCount = Number(r.noAnswerCount || 0);
      var overdueInfo = core.isReservationOverdueUnpaid ? core.isReservationOverdueUnpaid(r, d.extensions) : null;

      var canViewId = !core.canUserViewCustomerId || core.canUserViewCustomerId(user);
      var isRejRow = Boolean(core.isRejectedStatus ? core.isRejectedStatus(r) : (core.classifyReservationLifecycle && core.classifyReservationLifecycle(r) === 'rejected'));
      var isCanRow = Boolean(core.isCancelledStatus ? core.isCancelledStatus(r) : (core.classifyReservationLifecycle && core.classifyReservationLifecycle(r) === 'cancelled'));
      var isResInactiveNow = Boolean(isRejRow || isCanRow);
      var lifecycleKindNow = isRejRow ? 'rejected' : (isCanRow ? 'cancelled' : 'active');

      modalRoot.innerHTML =
        '<div class="drawer-backdrop" id="res-drawer-backdrop" data-res-id="' + esc(r.id) + '" role="dialog" aria-modal="true" aria-labelledby="drawer-res-title">' +
          '<div class="drawer-panel">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title mono" id="drawer-res-title">' + (isEn ? 'Booking' : 'حجز') + ' <span dir="ltr">' + esc(r.reservationNumber) + '</span>' +
                  (r.sourceReservationId ? ' <span class="status-tag status-neutral" dir="ltr">RG #' + esc(r.sourceReservationId) + '</span>' : '') +
                  (overdueInfo && overdueInfo.isOverdueUnpaid ? ' <span class="rg-overdue-badge">⏰ <span dir="ltr">' + esc(isEn ? overdueInfo.labelEn : overdueInfo.labelAr) + '</span></span>' : '') +
                '</h3>' +
                '<div class="meta-inline">' +
                  '<button type="button" class="rg-customer-link" data-cust-id="' + esc(r.customerId || '') + '" data-res-id="' + esc(r.id) + '" data-phone="' + esc(r.customerPhone || '') + '">' + esc(r.customerName) + '</button><span>·</span><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span>' +
                  (r.customerEmail ? '<span class="rg-ui-field-customer-extra"><span>·</span><span class="mono" dir="ltr">' + esc(r.customerEmail) + '</span></span>' : '') +
                  (canViewId && r.customerIdNumber ? '<span class="rg-ui-field-customer-extra"><span>·</span><span class="mono">' + (isEn ? 'ID: ' : 'هوية: ') + '<span dir="ltr">' + esc(String(r.customerIdNumber)) + '</span></span></span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="toolbar-row" style="margin-bottom:0;">' +
                (opts && opts.onBack ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-back-btn">' + esc(opts.backLabel || (isEn ? 'Back' : 'العودة لملف الموظف')) + '</button>' : '') +
                '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-copy-summary-btn">' + (isEn ? 'Copy Summary' : 'نسخ ملخص الحجز') + '</button>' +
                (telHref ? '<a class="btn btn-sm rg-tel-btn" id="drawer-direct-call-link" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 9' : 'اتصال 9') + '</a>' : '') +
                (canPinNote ? '<button type="button" class="btn btn-sm btn-warning" id="drawer-header-pin-note-btn">📌 ' + (isEn ? 'Supervisor Pinned Note' : 'ملاحظة مشرف/مدير مثبتة') + '</button>' : '') +
                '<button type="button" class="btn btn-sm" id="drawer-ics-btn" title="' + (isEn ? 'Add pickup & return to Google Calendar (.ics)' : 'إضافة موعد الاستلام والتسليم للتقويم (.ics)') + '">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' +
                (canEditReservation ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-edit-res-btn">' + (isEn ? 'Edit Booking' : 'تعديل تفاصيل الحجز') + '</button>' : '') +
                ((root.RGExportMenu && (canExportPdfBtn || canExportExcelBtn))
                  ? root.RGExportMenu.renderHtml({
                      wrapId: 'drawer-export-wrap',
                      btnId: 'drawer-export-btn',
                      small: true,
                      canPdf: canExportPdfBtn,
                      canExcel: canExportExcelBtn,
                      lang: ctx.lang
                    })
                  : (canExportPdfBtn ? '<button type="button" class="btn btn-sm btn-primary" id="drawer-pdf-btn">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' : '')) +
                (canReportProblemBtn ? '<button type="button" class="btn btn-sm btn-danger" id="drawer-problem-btn">' + (isEn ? 'Report Problem' : 'تحويل إلى مشكلة') + '</button>' : '') +
                '<button type="button" class="btn btn-sm" id="drawer-close-btn">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
              '</div>' +
            '</div>' +
            (isResInactiveNow ? (
              '<div class="rg-error-banner" style="margin-bottom:10px;border-color:' + (isRejRow ? 'rgba(217,31,43,0.32)' : 'rgba(217,119,6,0.36)') + ';background:' + (isRejRow ? 'rgba(217,31,43,0.07)' : 'rgba(217,119,6,0.08)') + ';">' +
                '<div class="rg-error-banner-body">' +
                  '<div class="rg-error-banner-title" style="color:var(--text-primary);">' +
                    (isRejRow && isCanRow
                      ? (isEn ? 'Rejected by Company & Cancelled by Customer (Synced from Rental Gate)' : 'حجز مرفوض من الشركة ثم ملغي من العميل (مزامنة تلقائياً من Rental Gate)')
                      : (isRejRow
                          ? (String(r.rccStatus || '').toUpperCase() === 'COMPANY_CHANGED'
                              ? (isEn ? 'Company Changed / Transferred After Rejection or Timeout (Synced from Rental Gate)' : 'حجز محوّل لشركة أخرى بعد الرفض/انتهاء المهلة (مزامنة تلقائياً من Rental Gate)')
                              : (isEn ? 'Rejected by Site (Synced from Rental Gate)' : 'حجز مرفوض من الموقع (مزامنة تلقائياً من Rental Gate)'))
                          : (isEn ? 'Cancelled by Customer (Synced from Rental Gate)' : 'حجز ملغي من العميل (مزامنة تلقائياً من Rental Gate)'))) +
                  '</div>' +
                  '<div class="rg-error-banner-msg">' +
                    (isRejRow
                      ? ((r.rejectionReason ? ('السبب: ' + esc(r.rejectionReason)) : '') + (r.newCompanyName ? (' · الشركة الجديدة: ' + esc(r.newCompanyName)) : '') + (r.rejectedByName ? (' · بواسطة: ' + esc(r.rejectedByName)) : ''))
                      : '') +
                    ((isRejRow && isCanRow && r.cancellationReason) ? ' | ' : '') +
                    (isCanRow
                      ? ((r.cancellationReason ? ('سبب الإلغاء: ' + esc(r.cancellationReason)) : '') + (r.cancelledByName ? (' · بواسطة: ' + esc(r.cancelledByName)) : ''))
                      : '') +
                  '</div>' +
                '</div>' +
              '</div>'
            ) : '') +

            '<div id="drawer-softlock-host">' +
              (drawerLockInfo
                ? ('<div class="rg-softlock-banner" role="status">🔒 ' + (isEn ? ('Currently being followed up by ' + esc(drawerLockInfo.lockedByName)) : ('يقوم ' + esc(drawerLockInfo.lockedByName) + ' حالياً بمتابعة هذا الحجز')) + '</div>')
                : '') +
            '</div>' +
            '<div id="drawer-conflict-host">' +
              (remoteConflictInfo
                ? ('<div class="rg-conflict-banner" role="alert"><span>⚡ ' + (isEn ? ('This booking was updated by ' + esc(remoteConflictInfo.byName) + '.') : ('تم تحديث هذا الحجز بواسطة ' + esc(remoteConflictInfo.byName) + '.')) + '</span><button type="button" class="btn btn-sm btn-primary" id="drawer-reload-conflict-btn">' + (isEn ? 'Reload Latest' : 'اضغط للتحديث') + '</button></div>')
                : '') +
            '</div>' +

            ((pinnedNoteText || canPinNote) ? (
              '<div class="rg-pinned-note-card" id="drawer-pinned-note-card">' +
                '<div class="rg-pinned-note-head">' +
                  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                    '<span class="rg-pinned-note-badge">📌 ' + (isEn ? 'Pinned Note' : 'ملاحظة مثبتة') + '</span>' +
                    (r.pinnedNoteByName ? '<span class="rg-pinned-note-meta">' + (isEn ? 'By ' : 'بواسطة ') + esc(r.pinnedNoteByName) + (r.pinnedNoteUpdatedAt ? (' · ' + esc(formatTimestamp(r.pinnedNoteUpdatedAt))) : '') + '</span>' : '') +
                  '</div>' +
                  (canPinNote ? '<span style="font-size:11.5px;color:var(--text-muted);">' + (isEn ? 'Supervisor / Manager Only' : 'صلاحية المشرف والمدير العام فقط') + '</span>' : '') +
                '</div>' +
                (pinnedNoteText
                  ? '<div class="rg-pinned-note-body" id="drawer-pinned-note-text">' + fmtMentionText(pinnedNoteText) + '</div>'
                  : '<div style="font-size:12.5px;color:var(--text-muted);">' + (isEn ? 'No pinned note added yet. Write an urgent instruction above.' : 'لا توجد ملاحظة مثبتة بعد — أضف تنبيهاً مهماً يظهر أعلى الحجز فور فتحه.') + '</div>') +
                (canPinNote ? (
                  '<form id="drawer-pinned-note-form" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' +
                    '<textarea class="textarea" id="drawer-pinned-note-input" rows="2" placeholder="' + (isEn ? 'Write or update pinned note...' : 'اكتب أو عدّل الملاحظة المثبتة أعلى الحجز...') + '">' + esc(pinnedNoteText) + '</textarea>' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                      '<button type="submit" class="btn btn-sm btn-primary" id="drawer-save-pinned-note-btn">' + (pinnedNoteText ? (isEn ? 'Update Pinned Note' : 'تحديث الملاحظة المثبتة') : (isEn ? 'Pin Note' : 'تثبيت الملاحظة')) + '</button>' +
                      (pinnedNoteText ? '<button type="button" class="btn btn-sm btn-danger" id="drawer-clear-pinned-note-btn">' + (isEn ? 'Remove Pin' : 'إزالة الملاحظة المثبتة') + '</button>' : '') +
                    '</div>' +
                  '</form>'
                ) : '') +
              '</div>'
            ) : '') +

            // Interactive Self-Service Claim / Unclaim & Quick Status Bar
            '<div class="glass-subcard" style="padding:14px;display:flex;flex-direction:column;gap:12px;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<span class="status-tag ' + statusClass(r.internalStatus) + '">' + esc(r.internalStatus) + '</span>' +
                  '<span class="status-tag ' + priorityClass(r.priority) + '">الأولوية: ' + esc(r.priority || 'عادي') + '</span>' +
                  (sharedInfo ? '<span class="rg-shared-badge is-' + esc(sharedInfo.status) + '">' + esc(sharedInfo.badge) + '</span>' : '') +
                  (extCount > 0 ? '<span class="status-tag status-info tabular-nums">ممدد ' + extCount + '× (' + Number(r.extensionsAmount || 0) + ' ر.س)</span>' : '') +
                  '<span style="font-size:12.5px;color:var(--text-secondary);">المستلمون حاليًا: <strong class="tabular-nums">' + assignedIds.length + '</strong></span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm rg-no-answer-btn" id="drawer-no-answer-btn"' + ((root.RGApp && root.RGApp.isActionLocked && root.RGApp.isActionLocked('recordNoAnswer:' + r.id)) ? ' disabled aria-busy="true"' : '') + '>' +
                    (isEn ? 'No Answer' : 'لم يرد') + ' <span class="rg-attempt-badge tabular-nums" id="drawer-no-answer-count">' + noAnswerCount + '</span>' +
                  '</button>' +
                  (canClaimDrawerBtn
                    ? (isClaimedByMe
                      ? '<button type="button" class="btn btn-sm btn-danger" id="drawer-unclaim-btn"' + ((root.RGApp && root.RGApp.isActionLocked && (root.RGApp.isActionLocked('claimReservation:' + r.id) || root.RGApp.isActionLocked('unclaimReservation:' + r.id))) ? ' disabled aria-busy="true"' : '') + '>إلغاء الاستلام من عندي</button>'
                      : '<button type="button" class="btn btn-sm btn-primary" id="drawer-claim-btn"' + ((root.RGApp && root.RGApp.isActionLocked && (root.RGApp.isActionLocked('claimReservation:' + r.id) || root.RGApp.isActionLocked('unclaimReservation:' + r.id))) ? ' disabled aria-busy="true"' : '') + '>استلام الحجز عندي</button>')
                    : '') +
                '</div>' +
              '</div>' +
              '<div class="quick-status-bar grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)_auto] gap-2 items-center">' +
                '<select class="select" id="drawer-quick-status" aria-label="تحديث الحالة السريع"' + (isResInactiveNow ? ' disabled' : '') + '>' +
                  (core.getWorkflowStatusOptions ? core.getWorkflowStatusOptions(r.internalStatus) : (core.MANUAL_WORKFLOW_STATUS_OPTIONS || core.FOLLOWUP_STATUSES)).map(function (s) {
                    return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                  }).join('') +
                '</select>' +
                '<input class="input" id="drawer-quick-note" placeholder="' + (isResInactiveNow ? 'الحجز مرفوض أو ملغي من الموقع — الحالة محمية من التعديل اليدوي' : 'ملاحظة سريعة اختيارية عند تغيير الحالة...') + '"' + (isResInactiveNow ? ' disabled' : '') + '>' +
                '<button type="button" class="btn btn-charcoal" id="drawer-quick-status-btn"' + (isResInactiveNow ? ' disabled' : '') + '>تحديث الحالة الآن</button>' +
              '</div>' +
            '</div>' +

            '<div class="detail-summary-grid">' +
              '<div class="detail-kv"><span class="detail-k">الشركة / فرع الاستلام</span><span class="detail-v">' + esc(r.companyName) + ' — ' + esc(r.branchName) +
                (r.deliverBranchName && r.deliverBranchName !== r.branchName ? ' (التسليم: ' + esc(r.deliverBranchName) + ')' : '') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">السيارة والفئة واللوحة</span><span class="detail-v">' + esc(r.carName) +
                (r.carCategory ? '<span class="rg-ui-field-car-meta"> · ' + esc(r.carCategory) + '</span>' : '') + ' (' + esc(r.plateNumber || '-') + ')</span></div>' +
              '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Booking Start' : 'بداية الحجز') + '</span><span class="detail-v">' +
                renderBookingTimezoneHtml(r.startDate, r.startTime, { compact: false }) + '</span>' +
                (r.sourceCreatedAt ? '<span class="time-sub">' + (isEn ? 'Created at platform: ' : 'أُنشئ بالمنصة: ') + '<span class="mono" dir="ltr">' + esc(formatTimestamp(r.sourceCreatedAt, ctx.lang)) + '</span></span>' : '') + '</div>' +
              '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Original End' : 'نهاية الحجز الأصلية') + '</span><span class="detail-v">' +
                renderBookingTimezoneHtml(origEndD, origEndT, { compact: false }) +
                '<span class="time-sub">(' + Number(r.daysCount || 1) + ' ' + (isEn ? 'base days' : 'يوم أساسي') + ')</span></span></div>' +
              '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extended Until (Actual Return)' : 'التمديد لحد (الإرجاع الفعلي)') + '</span><span class="detail-v">' +
                (extUntilD ? renderBookingTimezoneHtml(extUntilD, extUntilT, { compact: false }) : (isEn ? 'No extension' : 'لا يوجد تمديد')) + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">ملخص التمديد</span><span class="detail-v tabular-nums">' +
                (extCount > 0 ? (extCount + ' مرات · ' + extDays + ' يوم إضافي · ' + Number(r.extensionsAmount || 0) + ' ر.س') : 'غير ممدد') + '</span></div>' +
              '<div class="detail-kv rg-ui-field-car-meta"><span class="detail-k">الاستلام / التسليم</span><span class="detail-v">' + esc(r.pickupTypeAr) + ' / ' + esc(r.returnTypeAr) + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">حالة المنصة / الداخلية</span><span class="detail-v">' + esc(r.originalStatusAr) +
                (r.originalStatusCode ? ' <span class="mono">(' + esc(r.originalStatusCode) + ')</span>' : '') + ' / ' + esc(r.internalStatus) + '</span></div>' +
              '<div class="detail-kv rg-ui-field-finance"><span class="detail-k">الدفع والتفصيل المالي</span><span class="detail-v tabular-nums">' +
                esc(r.paymentMethod || '-') + (r.paymentStatus ? ' (' + esc(r.paymentStatus) + ')' : '') +
                (Number(r.dailyPrice || 0) > 0 ? ' · يومي ' + Number(r.dailyPrice) + ' ر.س' : '') +
                (Number(r.vatAmount || 0) > 0 ? ' · ضريبة ' + Number(r.vatAmount) : '') +
                (Number(r.discountAmount || 0) > 0 ? ' · خصم ' + Number(r.discountAmount) : '') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Last Update' : 'آخر تحديث') + '</span><span class="detail-v">' + fmtMentionText(r.lastUpdateText || '-') + '</span></div>' +
              ((r.referenceNumber || isCanRow) ? '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Reference #' : 'الرقم المرجعي') + '</span><span class="detail-v"><span class="mono" dir="ltr">' + esc(r.referenceNumber || r.sourceReservationId || (isEn ? 'Not recorded' : 'غير مسجل في المصدر')) + '</span></span></div>' : '') +
              ((Number(r.paidAmount || 0) > 0 || isCanRow) ? '<div class="detail-kv rg-ui-field-finance"><span class="detail-k">' + (isEn ? 'Paid Amount' : 'المبلغ المدفوع') + '</span><span class="detail-v tabular-nums">' + (Number(r.paidAmount || 0) > 0 ? (Number(r.paidAmount) + ' ر.س') : (isEn ? 'Not recorded / 0' : 'غير مسجل في المصدر')) + '</span></div>' : '') +
              (isRejRow ? (
                (function () {
                  var dClean = function (v) {
                    return (core && core.sanitizeReasonText) ? core.sanitizeReasonText(v) : String(v || '').trim();
                  };
                  var dEmptyReason = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
                  var dRejReason = dClean(r.rejectionReason);
                  var dNewComp = dClean(r.newCompanyName);
                  return '<div class="detail-kv"><span class="detail-k">الشركة الجديدة</span><span class="detail-v">' + esc(dNewComp || (isEn ? 'Not transferred' : 'لم يتم التحويل')) + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">سبب الرفض</span><span class="detail-v">' + (dRejReason ? esc(dRejReason) : '<span style="color:var(--text-muted);">' + esc(dEmptyReason) + '</span>') + '</span></div>' +
                    '<div class="detail-kv rg-ui-field-finance"><span class="detail-k">الاسترداد</span><span class="detail-v tabular-nums">' + (Number(r.refundAmount || 0) > 0 ? (Number(r.refundAmount) + ' ر.س') : (isEn ? 'No refund recorded' : 'لا يوجد استرداد مسجل')) + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">التأكيد بواسطة</span><span class="detail-v">' + esc(r.rejectedByName || r.lastUpdatedByName || (isEn ? 'Not recorded' : 'غير مسجل في المصدر')) + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">تاريخ الرفض</span><span class="detail-v"><span class="mono" dir="ltr">' + esc((r.rejectedAt || r.lastUpdatedAt) ? formatTimestamp(r.rejectedAt || r.lastUpdatedAt, ctx.lang) : (isEn ? 'Not recorded' : 'غير مسجل في المصدر')) + '</span></span></div>';
                }())
              ) : '') +
              (isCanRow ? (
                (function () {
                  var dClean = function (v) {
                    return (core && core.sanitizeReasonText) ? core.sanitizeReasonText(v) : String(v || '').trim();
                  };
                  var dEmptyReason = isEn ? 'No reason recorded in source for this booking' : 'لم يُسجّل سبب في المصدر لهذا الحجز';
                  var dCanReason = dClean(r.cancellationReason);
                  var dDelFail = dClean(r.deliveryFailureReason);
                  var dDrvNotes = dClean(r.driverNotes);
                  return '<div class="detail-kv"><span class="detail-k">سبب الإلغاء</span><span class="detail-v">' + (dCanReason ? esc(dCanReason) : '<span style="color:var(--text-muted);">' + esc(dEmptyReason) + '</span>') + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">سبب فشل التوصيل</span><span class="detail-v">' + esc(dDelFail || (isEn ? 'No failure recorded' : 'لم يُسجّل فشل توصيل')) + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">ملاحظات السائق</span><span class="detail-v">' + esc(dDrvNotes || (isEn ? 'No driver notes' : 'لا توجد ملاحظات مسجلة')) + '</span></div>' +
                    '<div class="detail-kv"><span class="detail-k">تاريخ الإلغاء</span><span class="detail-v"><span class="mono" dir="ltr">' + esc((r.cancelledAt || r.lastUpdatedAt) ? formatTimestamp(r.cancelledAt || r.lastUpdatedAt, ctx.lang) : (isEn ? 'Not recorded' : 'غير مسجل في المصدر')) + '</span></span></div>';
                }())
              ) : '') +
            '</div>' +

            buildStatusStagesHtml(r) +

            // Collaborator Chips + Individual Removal (Supervisor/GM) + Self Unclaim reminder
            '<div class="surface-card rg-ui-drawer-collab" style="padding:14px;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
                '<h4 style="margin:0;font-size:14px;">' + (isEn ? 'Assigned Staff' : 'الموظفون المشاركون في متابعة الحجز') + ' (' + assignedIds.length + ')</h4>' +
                '<span style="font-size:12px;color:var(--text-muted);">' + (isEn ? 'Multiple agents can collaborate on the same booking' : 'يمكن لأكثر من موظف استلام ومتابعة نفس الحجز معًا') + '</span>' +
              '</div>' +
              (assignedIds.length === 0
                ? '<div style="font-size:13px;color:var(--text-muted);">' + (isEn ? 'No assignees yet.' : 'لا يوجد موظفون مستلمون بعد — اضغط «استلام الحجز عندي» أعلاه للبدء فورًا.') + '</div>'
                : '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
                    assignedIds.map(function (empId, idx) {
                      var empName = assignedNames[idx] || empId;
                      var isSelf = empId === user.id;
                      return '<span class="collab-chip">' +
                        '<span>' + esc(empName) + (isSelf ? (isEn ? ' (You)' : ' (أنت)') : '') + '</span>' +
                        (canAssign
                          ? '<button type="button" class="collab-chip-remove drawer-remove-emp" data-emp-id="' + esc(empId) + '" data-emp-name="' + esc(empName) + '" title="' + (isEn ? 'Remove ' : 'إزالة إسناد ') + esc(empName) + '" aria-label="' + (isEn ? 'Remove ' : 'إزالة إسناد ') + esc(empName) + '">✕</button>'
                          : '') +
                      '</span>';
                    }).join('') +
                  '</div>') +
            '</div>' +

            '<div class="kpi-grid-3 rg-ui-drawer-kpis">' +
              '<div class="kpi-card"><span class="kpi-label">' + (isEn ? 'Total Days' : 'إجمالي الأيام') + '</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + totalDays + '</span>' +
                (extDays > 0 ? '<span class="time-sub">' + Number(r.daysCount || 1) + (isEn ? ' base + ' : ' أساسي + ') + extDays + (isEn ? ' ext' : ' تمديد') + '</span>' : '') + '</div>' +
              '<div class="kpi-card rg-ui-field-finance"><span class="kpi-label">' + (isEn ? 'Base Amount' : 'المبلغ الأساسي') + '</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.baseAmount || 0) + '</span></div>' +
              '<div class="kpi-card rg-ui-field-finance"><span class="kpi-label">' + (isEn ? 'Extensions' : 'سعر التمديد') + ' (' + extCount + '×)</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.extensionsAmount || 0) + '</span></div>' +
              '<div class="kpi-card kpi-success"><span class="kpi-label">' + (isEn ? 'Total (SAR)' : 'الإجمالي (ر.س)') + '</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.totalAmount || 0) + '</span></div>' +
              '<div class="kpi-card"><span class="kpi-label">' + (isEn ? 'Follow-Ups' : 'المتابعات') + '</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + d.followUps.length + '</span></div>' +
              '<div class="kpi-card ' + (d.problems.length ? 'kpi-danger' : '') + '"><span class="kpi-label">' + (isEn ? 'Problems' : 'المشكلات') + '</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + d.problems.length + '</span></div>' +
            '</div>' +

            buildExtensionsSectionHtml(r, d.extensions) +

            '<div class="charts-grid rg-ui-drawer-charts">' +
              '<div class="chart-card"><h4 class="chart-card-title">حالة الحجز والتفصيل المالي</h4><div class="chart-canvas-wrap" style="height:190px;"><canvas id="res-drawer-chart-finance"></canvas></div></div>' +
              '<div class="chart-card"><h4 class="chart-card-title">أداء الموظفين ونشاط الحجز</h4><div class="chart-canvas-wrap" style="height:190px;"><canvas id="res-drawer-chart-activity"></canvas></div></div>' +
            '</div>' +

            (canAssign ? (
              '<div class="surface-card rg-ui-drawer-collab" style="padding:14px;">' +
                '<h4 style="margin:0 0 10px;font-size:14px;">إدارة الإسناد من المشرف / المدير (تحديد متعدد)</h4>' +
                '<div class="checkbox-grid">' +
                  resolvedEmployees.filter(function (e) { return e.status === 'active'; }).map(function (emp) {
                    var checked = assignedIds.indexOf(emp.id) !== -1 ? 'checked' : '';
                    return '<label class="checkbox-item"><input type="checkbox" class="drawer-assign-chk" value="' + esc(emp.id) + '" ' + checked + '> ' + esc(emp.name) + '</label>';
                  }).join('') +
                '</div>' +
                '<div style="margin-top:10px;"><button type="button" class="btn btn-sm btn-primary" id="drawer-save-assign">حفظ الإسناد</button></div>' +
              '</div>'
            ) : '') +

            '<form class="surface-card" id="drawer-fu-form" style="padding:14px;display:flex;flex-direction:column;gap:10px;">' +
              '<h4 style="margin:0;font-size:14px;">إضافة متابعة جديدة (متاحة دون انتظار الإسناد)</h4>' +
              '<div class="form-grid-2">' +
                '<div class="form-group"><label class="form-label" for="fu-status">حالة المتابعة</label>' +
                  '<select class="select" id="fu-status"' + (isResInactiveNow ? ' disabled' : '') + '>' +
                    (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : (root.RGCrmCore.MANUAL_WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES)).map(function (s) {
                      return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                    }).join('') +
                  '</select></div>' +
                '<div class="form-group"><label class="form-label" for="fu-action">الإجراء المتخذ</label>' +
                  '<input class="input" id="fu-action" placeholder="مثال: التواصل مع العميل لتأكيد الاستلام" required></div>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="fu-notes">الملاحظات</label>' +
                '<textarea class="textarea" id="fu-notes" placeholder="تفاصيل إضافية..."></textarea></div>' +
              '<div id="fu-form-error" class="form-error hidden"></div>' +
              '<div><button type="submit" class="btn btn-primary" id="fu-submit-btn">حفظ المتابعة</button></div>' +
            '</form>' +

            '<div class="rg-ui-drawer-timeline">' +
              '<h4 style="margin:0 0 10px;font-size:14px;">سجل المتابعات والملاحظات (' + d.followUps.length + ')</h4>' +
              (d.followUps.length === 0
                ? '<div class="empty-state" style="padding:20px;">لا توجد متابعات مسجلة لهذا الحجز بعد.</div>'
                : '<div class="timeline-list">' + d.followUps.map(function (f) {
                    var canEditThisFu = canEditAnyFollowUp || f.employeeId === user.id;
                    return '<div class="timeline-item">' +
                      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<strong>' + esc(f.employeeName) + '</strong>' +
                        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                          '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
                          (canEditThisFu ? '<button type="button" class="btn btn-sm btn-edit-fu" data-fu-id="' + esc(f.id) + '">' + (isEn ? 'Edit' : 'تعديل') + '</button>' : '') +
                          (canEditThisFu ? '<button type="button" class="btn btn-sm btn-danger btn-delete-fu" data-fu-id="' + esc(f.id) + '" data-confirm="0" aria-label="' + (isEn ? 'Delete follow-up' : 'حذف المتابعة') + '">' + (isEn ? 'Delete' : 'حذف') + '</button>' : '') +
                        '</div>' +
                      '</div>' +
                      '<div>' + fmtMentionText(f.action) + '</div>' +
                      (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + fmtMentionText(f.notes) + '</div>' : '') +
                      '<div class="meta-inline mono"><span>' + esc(formatDateOnly(f.followUpDate)) + '</span><span>·</span><span dir="ltr">' + esc(formatTimeOnly(f.followUpTime, ctx.lang)) + '</span></div>' +
                    '</div>';
                  }).join('') + '</div>') +
            '</div>' +

            (d.problems.length ? (
              '<div class="rg-ui-drawer-timeline">' +
                '<h4 style="margin:0 0 10px;font-size:14px;">المشكلات / التذاكر المرتبطة بالحجز (' + d.problems.length + ')</h4>' +
                '<div class="timeline-list">' + d.problems.map(function (p) {
                  var prbClosed = isProblemClosed(p.status);
                  return '<div class="timeline-item">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                      '<strong class="mono">' + esc(p.problemNumber) + '</strong>' +
                      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<span class="status-tag ' + priorityClass(p.priority) + '">' + esc(p.priority) + '</span>' +
                        '<span class="status-tag ' + (prbClosed ? 'status-success' : 'status-info') + '">' + esc(p.status) + '</span>' +
                        ((!prbClosed && canCloseTicketDrawerBtn) ? '<button type="button" class="btn btn-sm btn-danger btn-close-prb-in-drawer" data-prb-id="' + esc(p.id) + '">إغلاق المشكلة</button>' : '') +
                        (canCloseTicketDrawerBtn ? '<button type="button" class="btn btn-sm btn-danger btn-delete-prb-in-drawer" data-prb-id="' + esc(p.id) + '" data-prb-num="' + esc(p.problemNumber) + '" data-confirm="0" aria-label="حذف المشكلة ' + esc(p.problemNumber) + '">حذف</button>' : '') +
                        '<button type="button" class="btn btn-sm btn-primary btn-edit-prb-in-drawer" data-prb-id="' + esc(p.id) + '">' +
                          (canEditTicket ? 'تعديل التذكرة' : 'تحديث التذكرة') +
                        '</button>' +
                      '</div>' +
                    '</div>' +
                    '<div>' + fmtMentionText(p.description) + '</div>' +
                    '<div class="meta-inline"><span>بواسطة: ' + esc(p.createdByName) + '</span><span>·</span><span>المسؤولون: ' + esc((p.assignedEmployeeNames || []).join('، ') || '-') + '</span></div>' +
                  '</div>';
                }).join('') + '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>';

      isPaintingDrawer = false;
      var initialPinnedNote = String(r.pinnedNote || '').trim();
      if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
        root.RGApp.setUnsavedGuard({
          label: (isEn ? 'Booking #' : 'الحجز رقم ') + (r.reservationNumber || r.id),
          isDirty: function () {
            if (drawerCleanedUp) return false;
            var bd = document.getElementById('res-drawer-backdrop');
            if (!bd || bd.getAttribute('data-res-id') !== String(r.id)) return false;
            var actEl = document.getElementById('fu-action');
            var notesEl = document.getElementById('fu-notes');
            var qNoteEl = document.getElementById('drawer-quick-note');
            var pinEl = document.getElementById('drawer-pinned-note-input');
            if (actEl && String(actEl.value || '').trim().length > 0) return true;
            if (notesEl && String(notesEl.value || '').trim().length > 0) return true;
            if (qNoteEl && String(qNoteEl.value || '').trim().length > 0) return true;
            if (pinEl && String(pinEl.value || '').trim() !== initialPinnedNote) return true;
            return false;
          },
          onSave: async function () {
            var actEl = document.getElementById('fu-action');
            var notesEl = document.getElementById('fu-notes');
            var qNoteEl = document.getElementById('drawer-quick-note');
            var pinEl = document.getElementById('drawer-pinned-note-input');
            var actVal = actEl ? String(actEl.value || '').trim() : '';
            var notesVal = notesEl ? String(notesEl.value || '').trim() : '';
            var qVal = qNoteEl ? String(qNoteEl.value || '').trim() : '';
            var pinVal = pinEl ? String(pinEl.value || '').trim() : initialPinnedNote;
            if (notesVal && !actVal) {
              actVal = notesVal;
            }
            if (actVal) {
              var fuStatusVal = (document.getElementById('fu-status') && document.getElementById('fu-status').value) || r.internalStatus;
              if (root.RGApi.applyOptimisticMutation) {
                root.RGApi.applyOptimisticMutation('addFollowUp', {
                  reservationId: r.id,
                  status: fuStatusVal,
                  action: actVal,
                  notes: notesVal
                }, user);
              }
              var saveFuResp = await root.RGApi.callApi('addFollowUp', {
                reservationId: r.id,
                status: fuStatusVal,
                action: actVal,
                notes: notesVal,
                _keepOptimisticCache: true
              });
              if (!saveFuResp || !saveFuResp.success) {
                ctx.toast((saveFuResp && saveFuResp.message) || 'تعذر حفظ المتابعة.', true);
                return false;
              }
              notifyParentUpdated();
              ctx.toast('تم حفظ المتابعة بنجاح.');
              return true;
            }
            if (qVal) {
              var qsVal = (document.getElementById('drawer-quick-status') && document.getElementById('drawer-quick-status').value) || r.internalStatus;
              if (root.RGApi.applyOptimisticMutation) {
                root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
                  reservationId: r.id,
                  status: qsVal,
                  note: qVal
                }, user);
              }
              var saveQsResp = await root.RGApi.callApi('quickUpdateReservationStatus', {
                reservationId: r.id,
                status: qsVal,
                note: qVal,
                expectedUpdatedAt: r.updatedAt || r.lastUpdatedAt || '',
                _keepOptimisticCache: true
              });
              if (!saveQsResp || !saveQsResp.success) {
                ctx.toast((saveQsResp && saveQsResp.message) || 'تعذر تحديث الحالة.', true);
                return false;
              }
              notifyParentUpdated();
              ctx.toast('تم تحديث الحالة والملاحظة بنجاح.');
              return true;
            }
            if (pinEl && pinVal !== initialPinnedNote) {
              if (root.RGApi.applyOptimisticMutation) {
                root.RGApi.applyOptimisticMutation('saveReservationPinnedNote', { reservationId: r.id, note: pinVal }, user);
              }
              var savePinResp = await root.RGApi.callApi('saveReservationPinnedNote', {
                reservationId: r.id,
                note: pinVal,
                _keepOptimisticCache: true
              });
              if (!savePinResp || !savePinResp.success) {
                ctx.toast((savePinResp && savePinResp.message) || 'تعذر حفظ الملاحظة المثبتة.', true);
                return false;
              }
              notifyParentUpdated();
              ctx.toast('تم حفظ الملاحظة المثبتة.');
              return true;
            }
            return true;
          },
          onDiscard: function () {
            cleanupDrawerLifecycle();
            modalRoot.innerHTML = '';
          }
        });
      }

      var drawerBackdropEl = document.getElementById('res-drawer-backdrop');
      if (drawerBackdropEl) {
        drawerBackdropEl.addEventListener('click', function (ev) {
          if (ev.target === drawerBackdropEl) {
            requestDrawerExit(function () {
              cleanupDrawerLifecycle();
              modalRoot.innerHTML = '';
            });
          }
        });
      }

      document.getElementById('drawer-close-btn').addEventListener('click', function () {
        requestDrawerExit(function () {
          cleanupDrawerLifecycle();
          modalRoot.innerHTML = '';
        });
      });
      var backBtn = document.getElementById('drawer-back-btn');
      if (backBtn && opts && opts.onBack) {
        backBtn.addEventListener('click', function () {
          requestDrawerExit(function () {
            cleanupDrawerLifecycle();
            opts.onBack();
          });
        });
      }
      var pinHdrBtn = document.getElementById('drawer-header-pin-note-btn');
      if (pinHdrBtn) {
        pinHdrBtn.addEventListener('click', function () {
          var card = document.getElementById('drawer-pinned-note-card');
          var inp = document.getElementById('drawer-pinned-note-input');
          if (card && typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          if (inp) {
            setTimeout(function () { try { inp.focus(); } catch (_e) {} }, 120);
          }
        });
      }
      var icsBtn = document.getElementById('drawer-ics-btn');
      if (icsBtn) {
        icsBtn.addEventListener('click', function () {
          if (!core || !core.buildReservationIcsEvents || !core.buildIcsCalendarContent) return;
          var evs = core.buildReservationIcsEvents(r, ctx.lang);
          var icsStr = core.buildIcsCalendarContent(evs, 'Rental Gate CRM #' + (r.reservationNumber || r.id));
          var dlFn = (ctx.downloadIcsFile) || (root.RGApp && root.RGApp.downloadIcsFile);
          if (dlFn) {
            dlFn('rg-booking-' + (r.reservationNumber || r.id) + '.ics', icsStr);
            ctx.toast(isEn ? 'Booking calendar events (.ics) downloaded.' : 'تم تنزيل مواعيد الحجز بصيغة تقويم (.ics).');
          }
        });
      }
      var reloadConflictBtn = document.getElementById('drawer-reload-conflict-btn');
      if (reloadConflictBtn) {
        reloadConflictBtn.addEventListener('click', async function () {
          remoteConflictInfo = null;
          var fresh = await root.RGApi.callApi('getReservationDetails', { reservationId: r.id, forceRefresh: true });
          if (fresh && fresh.success && fresh.data && fresh.data.reservation) {
            d = fresh.data;
            paintDrawer();
          }
        });
      }

      var claimBtn = document.getElementById('drawer-claim-btn');
      if (claimBtn) {
        claimBtn.addEventListener('click', function () {
          runWithLock(claimBtn, 'claimReservation:' + r.id, function () {
            var claimed = root.RGCrmCore.claimReservationRecord(r, user);
            d.reservation = Object.assign({}, r, {
              assignedEmployeeIds: claimed.assignedEmployeeIds,
              assignedEmployeeNames: claimed.assignedEmployeeNames
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('claimReservation', { reservationId: r.id }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم استلام الحجز في قائمتك بنجاح.');
            return root.RGApi.callApi('claimReservation', { reservationId: r.id, _keepOptimisticCache: true, _spamChecked: true }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'claimReservation', spamSig: r.id }).finally(function () {
            var b = document.getElementById('drawer-claim-btn') || document.getElementById('drawer-unclaim-btn');
            if (b && (!root.RGApp || !root.RGApp.isActionLocked || (!root.RGApp.isActionLocked('claimReservation:' + r.id) && !root.RGApp.isActionLocked('unclaimReservation:' + r.id)))) {
              b.disabled = false;
              b.removeAttribute('aria-busy');
            }
          });
        });
      }

      var unclaimBtn = document.getElementById('drawer-unclaim-btn');
      if (unclaimBtn) {
        unclaimBtn.addEventListener('click', function () {
          runWithLock(unclaimBtn, 'unclaimReservation:' + r.id, function () {
            var unclaimed = root.RGCrmCore.unclaimReservationRecord(r, user.id);
            d.reservation = Object.assign({}, r, {
              assignedEmployeeIds: unclaimed.assignedEmployeeIds,
              assignedEmployeeNames: unclaimed.assignedEmployeeNames
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('unclaimReservation', { reservationId: r.id }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم إلغاء استلام الحجز من حسابك.');
            return root.RGApi.callApi('unclaimReservation', { reservationId: r.id, _keepOptimisticCache: true, _spamChecked: true }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إلغاء الاستلام.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'unclaimReservation', spamSig: r.id }).finally(function () {
            var b = document.getElementById('drawer-claim-btn') || document.getElementById('drawer-unclaim-btn');
            if (b && (!root.RGApp || !root.RGApp.isActionLocked || (!root.RGApp.isActionLocked('claimReservation:' + r.id) && !root.RGApp.isActionLocked('unclaimReservation:' + r.id)))) {
              b.disabled = false;
              b.removeAttribute('aria-busy');
            }
          });
        });
      }

      var quickBtn = document.getElementById('drawer-quick-status-btn');
      if (quickBtn) {
        quickBtn.addEventListener('click', function () {
          var nextStatus = document.getElementById('drawer-quick-status').value;
          if (isResInactiveNow || (root.RGCrmCore && root.RGCrmCore.isManualBlockedWorkflowStatus && root.RGCrmCore.isManualBlockedWorkflowStatus(nextStatus))) {
            ctx.toast('الحالات المرفوضة والملغاة تتم مزامنتها من Rental Gate فقط ولا يمكن تعديلها يدوياً.', true);
            return;
          }
          var quickNote = String(document.getElementById('drawer-quick-note').value || '').trim();
          var expectedUpdatedAt = r.updatedAt || r.lastUpdatedAt || '';
          runWithLock(quickBtn, 'quickUpdateReservationStatus:' + r.id, function () {
            var now = new Date();
            var nowIso = now.toISOString();
            var actionText = 'تحديث سريع للحالة إلى: ' + nextStatus;
            var quickLastText = quickNote ? (actionText + ' — ' + quickNote) : actionText;
            var nextQuickStages = (root.RGCrmCore && root.RGCrmCore.appendStatusStageEntry)
              ? root.RGCrmCore.appendStatusStageEntry(r.statusHistory || [], {
                  source: 'quick_status',
                  previousStatus: r.internalStatus || '',
                  newStatus: nextStatus,
                  changedAt: nowIso,
                  changedById: user.id,
                  changedByName: user.name,
                  note: quickLastText
                })
              : (r.statusHistory || []);
            var optFu = {
              id: 'FU_OPT_' + Date.now(),
              reservationId: r.id,
              reservationNumber: r.reservationNumber,
              customerName: r.customerName,
              employeeId: user.id,
              employeeName: user.name,
              status: nextStatus,
              action: actionText,
              notes: quickNote,
              followUpDate: nowIso.substring(0, 10),
              followUpTime: now.toTimeString().substring(0, 8),
              createdAt: nowIso
            };
            d.reservation = Object.assign({}, r, {
              internalStatus: nextStatus,
              lastUpdateText: quickLastText,
              lastUpdatedById: user.id,
              lastUpdatedByName: user.name,
              lastUpdatedAt: nowIso,
              statusHistory: nextQuickStages
            });
            d.followUps = [optFu].concat(d.followUps || []);
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
                reservationId: r.id,
                status: nextStatus,
                note: quickNote
              }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم تحديث حالة الحجز إلى: ' + nextStatus);
            return root.RGApi.callApi('quickUpdateReservationStatus', {
              reservationId: r.id,
              status: nextStatus,
              note: quickNote,
              expectedUpdatedAt: expectedUpdatedAt,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر تحديث الحالة.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'quickUpdateReservationStatus', spamSig: r.id + ':' + nextStatus + ':' + quickNote });
        });
      }

      var editResBtn = document.getElementById('drawer-edit-res-btn');
      if (editResBtn) {
        editResBtn.addEventListener('click', function () {
          openEditReservationModal(r, ctx, reopenSelf, reopenSelf);
        });
      }

      modalRoot.querySelectorAll('.drawer-remove-emp').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var empId = btn.getAttribute('data-emp-id');
          var empName = btn.getAttribute('data-emp-name');
          runWithLock(btn, 'removeAssignment:' + r.id + ':' + empId, function () {
            var nextIds = [];
            var nextNames = [];
            assignedIds.forEach(function (idItem, idx) {
              if (idItem !== empId) {
                nextIds.push(idItem);
                if (assignedNames[idx]) nextNames.push(assignedNames[idx]);
              }
            });
            d.reservation = Object.assign({}, r, {
              assignedEmployeeIds: nextIds,
              assignedEmployeeNames: nextNames
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('removeAssignment', {
                reservationId: r.id,
                employeeId: empId
              }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تمت إزالة ' + empName + ' من الحجز.');
            return root.RGApi.callApi('removeAssignment', {
              reservationId: r.id,
              employeeId: empId,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إزالة الموظف.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'removeAssignment', spamSig: r.id + ':' + empId });
        });
      });

      var saveAssignBtn = document.getElementById('drawer-save-assign');
      if (saveAssignBtn) {
        saveAssignBtn.addEventListener('click', function () {
          var checkedIds = Array.from(modalRoot.querySelectorAll('.drawer-assign-chk:checked')).map(function (c) { return c.value; });
          var baseIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds.slice() : [];
          var ids = baseIds.slice();
          checkedIds.forEach(function (eid) {
            if (ids.indexOf(eid) === -1) ids.push(eid);
          });
          runWithLock(saveAssignBtn, 'assignEmployees:' + r.id, function () {
            var names = ids.map(function (eid) {
              var idxOld = baseIds.indexOf(eid);
              var emp = resolvedEmployees.find(function (e) { return e.id === eid; });
              return (emp && emp.name) || (idxOld !== -1 && assignedNames[idxOld]) || eid;
            });
            d.reservation = Object.assign({}, r, {
              assignedEmployeeIds: ids,
              assignedEmployeeNames: names
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('assignEmployees', {
                reservationId: r.id,
                employeeIds: ids
              }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم تحديث الموظفين المسؤولين عن الحجز.');
            return root.RGApi.callApi('assignEmployees', {
              reservationId: r.id,
              employeeIds: ids,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر حفظ الإسناد.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'assignEmployees', spamSig: r.id + ':' + ids.slice().sort().join(',') });
        });
      }

      document.getElementById('drawer-fu-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var errEl = document.getElementById('fu-form-error');
        errEl.classList.add('hidden');
        var fuStatus = isResInactiveNow ? r.internalStatus : document.getElementById('fu-status').value;
        if (!isResInactiveNow && root.RGCrmCore && root.RGCrmCore.isManualBlockedWorkflowStatus && root.RGCrmCore.isManualBlockedWorkflowStatus(fuStatus)) {
          errEl.textContent = 'الحالات المرفوضة والملغاة تتم مزامنتها من الموقع فقط ولا يمكن اختيارها يدوياً.';
          errEl.classList.remove('hidden');
          return;
        }
        var fuAction = String(document.getElementById('fu-action').value || '').trim();
        var fuNotes = String(document.getElementById('fu-notes').value || '').trim();
        if (!fuAction) {
          errEl.textContent = 'يرجى كتابة الإجراء المتخذ.';
          errEl.classList.remove('hidden');
          return;
        }
        var fuSubmitBtn = document.getElementById('fu-submit-btn');
        runWithLock(fuSubmitBtn, 'addFollowUp:' + r.id, function () {
          var now = new Date();
          var nowIso = now.toISOString();
          var optFu = {
            id: 'FU_OPT_' + Date.now(),
            reservationId: r.id,
            reservationNumber: r.reservationNumber,
            customerName: r.customerName,
            employeeId: user.id,
            employeeName: user.name,
            status: fuStatus,
            action: fuAction,
            notes: fuNotes,
            followUpDate: nowIso.substring(0, 10),
            followUpTime: now.toTimeString().substring(0, 8),
            createdAt: nowIso
          };
          var fuLastTxt = fuAction + (fuNotes ? ' — ' + fuNotes : '');
          var nextFuStages = (root.RGCrmCore && root.RGCrmCore.appendStatusStageEntry)
            ? root.RGCrmCore.appendStatusStageEntry(r.statusHistory || [], {
                source: 'followup',
                previousStatus: r.internalStatus || '',
                newStatus: fuStatus,
                changedAt: nowIso,
                changedById: user.id,
                changedByName: user.name,
                note: fuLastTxt
              })
            : (r.statusHistory || []);
          d.reservation = Object.assign({}, r, {
            internalStatus: fuStatus,
            lastUpdateText: fuLastTxt,
            lastUpdatedById: user.id,
            lastUpdatedByName: user.name,
            lastUpdatedAt: nowIso,
            statusHistory: nextFuStages
          });
          d.followUps = [optFu].concat(d.followUps || []);
          if (root.RGApi.applyOptimisticMutation) {
            root.RGApi.applyOptimisticMutation('addFollowUp', {
              reservationId: r.id,
              status: fuStatus,
              action: fuAction,
              notes: fuNotes
            }, user);
          }
          paintDrawer();
          notifyParentUpdated();
          ctx.toast('تمت إضافة المتابعة بنجاح.');
          return root.RGApi.callApi('addFollowUp', {
            reservationId: r.id,
            status: fuStatus,
            action: fuAction,
            notes: fuNotes,
            _keepOptimisticCache: true,
            _spamChecked: true
          }).then(function (resp) {
            if (resp && resp.success) ctx.refreshNotifications();
            else { ctx.toast((resp && resp.message) || 'تعذر حفظ المتابعة.', true); reopenSelf(null); }
          }).catch(function () {
            ctx.toast('تعذر الاتصال بالخادم أثناء حفظ المتابعة.', true);
            reopenSelf(null);
          });
        }, { spamAction: 'addFollowUp', spamSig: r.id + ':' + fuStatus + ':' + fuAction + ':' + fuNotes });
      });

      modalRoot.querySelectorAll('.btn-edit-fu').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var fuId = btn.getAttribute('data-fu-id');
          var fu = d.followUps.find(function (x) { return x.id === fuId; });
          if (fu) openEditFollowUpModal(fu, r, ctx, reopenSelf, reopenSelf);
        });
      });

      modalRoot.querySelectorAll('.btn-delete-fu').forEach(function (btn) {
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
          var fu = (d.followUps || []).find(function (x) { return x && x.id === fuId; });
          if (!fu) return;
          runWithLock(btn, 'deleteFollowUp:' + fuId, function () {
            var delPayload = {
              followUpId: fuId,
              reservationId: r.id
            };
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('deleteFollowUp', delPayload, user);
            }
            var nextFus = (d.followUps || []).filter(function (it) { return it && it.id !== fuId; });
            d.followUps = nextFus;
            var latestNextFu = nextFus[0] || null;
            var coreObj = root.RGCrmCore || {};
            var isInactiveCur = Boolean(coreObj.isInactiveReservation && coreObj.isInactiveReservation(r));
            var resPatchLocal = {
              isFollowed: nextFus.length > 0,
              lastUpdatedAt: new Date().toISOString()
            };
            if (latestNextFu) {
              resPatchLocal.lastUpdateText = latestNextFu.action + (latestNextFu.notes ? ' — ' + latestNextFu.notes : '');
              if (!isInactiveCur && latestNextFu.status) {
                resPatchLocal.internalStatus = latestNextFu.status;
              }
            } else {
              resPatchLocal.lastUpdateText = isInactiveCur ? r.lastUpdateText : '';
              if (!isInactiveCur) {
                resPatchLocal.internalStatus = 'بانتظار المتابعة';
              }
            }
            d.reservation = Object.assign({}, r, resPatchLocal);
            paintDrawer();
            notifyParentUpdated();
            ctx.toast(isEn ? 'Follow-up deleted.' : 'تم حذف المتابعة بنجاح.');
            return root.RGApi.callApi('deleteFollowUp', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, delPayload)).then(function (resp) {
              if (resp && resp.success) {
                if (resp.data && resp.data.reservation && d && d.reservation) {
                  d.reservation = Object.assign({}, d.reservation, resp.data.reservation);
                  notifyParentUpdated(d.reservation);
                  paintDrawer();
                }
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || (isEn ? 'Failed to delete follow-up.' : 'تعذر حذف المتابعة.'), true);
                reopenSelf(null);
              }
            }).catch(function () {
              ctx.toast(isEn ? 'Network error deleting follow-up.' : 'تعذر الاتصال بالخادم أثناء حذف المتابعة.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'deleteFollowUp', spamSig: 'deleteFollowUp:' + fuId });
        });
      });

      modalRoot.querySelectorAll('.btn-close-prb-in-drawer').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var prbId = btn.getAttribute('data-prb-id');
          var prb = d.problems.find(function (x) { return x.id === prbId; });
          if (!prb) return;
          runWithLock(btn, 'updateProblem:' + prbId, function () {
            var closePayload = {
              problemId: prbId,
              status: 'مغلقة',
              priority: prb.priority || 'متوسط',
              note: 'تم إغلاق المشكلة'
            };
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('updateProblem', closePayload, user);
            }
            d.problems = (d.problems || []).map(function (it) {
              if (it.id !== prbId) return it;
              return root.RGCrmCore && root.RGCrmCore.applyOptimisticProblemPatch
                ? root.RGCrmCore.applyOptimisticProblemPatch(it, closePayload, user, employees)
                : Object.assign({}, it, { status: 'مغلقة' });
            });
            d.reservation = Object.assign({}, r, {
              hasProblem: d.problems.some(function (it) { return !isProblemClosed(it.status); })
            });
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم إغلاق المشكلة ' + prb.problemNumber + ' بنجاح.');
            return root.RGApi.callApi('updateProblem', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, closePayload)).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إغلاق المشكلة.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء إغلاق المشكلة.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'updateProblem', spamSig: prbId + ':مغلقة' });
        });
      });

      modalRoot.querySelectorAll('.btn-delete-prb-in-drawer').forEach(function (btn) {
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
          var prbId = btn.getAttribute('data-prb-id');
          var prb = d.problems.find(function (x) { return x.id === prbId; });
          if (!prb) return;
          runWithLock(btn, 'deleteProblem:' + prbId, function () {
            var delPayload = {
              problemId: prbId,
              expectedUpdatedAt: prb.updatedAt || '',
              reservationId: r.id
            };
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('deleteProblem', delPayload, user);
            }
            d.problems = (d.problems || []).filter(function (it) { return it.id !== prbId; });
            d.problemUpdates = (d.problemUpdates || []).filter(function (u) { return u.problemId !== prbId; });
            d.reservation = Object.assign({}, r, {
              hasProblem: d.problems.some(function (it) { return !isProblemClosed(it.status); })
            });
            paintDrawer();
            notifyParentUpdated();
            ctx.toast((isEn ? 'Deleted problem ' : 'تم حذف المشكلة ') + (prb.problemNumber || '') + (isEn ? '.' : ' بنجاح.'));
            return root.RGApi.callApi('deleteProblem', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, delPayload)).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر حذف المشكلة.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء حذف المشكلة.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'deleteProblem', spamSig: 'deleteProblem:' + prbId });
        });
      });

      modalRoot.querySelectorAll('.btn-edit-prb-in-drawer').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var prbId = btn.getAttribute('data-prb-id');
          var prb = d.problems.find(function (x) { return x.id === prbId; });
          if (prb && root.RGProblems && root.RGProblems.openProblemUpdateModal) {
            var enriched = Object.assign({}, prb, {
              updates: (d.problemUpdates || []).filter(function (u) { return u.problemId === prb.id; })
            });
            root.RGProblems.openProblemUpdateModal(enriched, resolvedEmployees, ctx, function (savedPrb) {
              if (savedPrb && savedPrb._deletedProblemId) notifyParentUpdated();
              reopenSelf(savedPrb);
            }, reopenSelf);
          }
        });
      });

      var copySummaryBtn = document.getElementById('drawer-copy-summary-btn');
      if (copySummaryBtn) {
        copySummaryBtn.addEventListener('click', function () {
          var summaryText = core.formatBookingSummaryText
            ? core.formatBookingSummaryText(r, ctx.lang, { timeFormat: activeTimeFormat(), timezoneMode: activeTimezoneMode() })
            : (r.reservationNumber + ' — ' + r.customerName + ' — ' + r.carName);
          copyTextToClipboard(summaryText).then(function () {
            ctx.toast(isEn ? 'Full booking summary copied.' : 'تم نسخ ملخص الحجز الكامل بنجاح.');
          });
        });
      }

      var noAnsBtn = document.getElementById('drawer-no-answer-btn');
      if (noAnsBtn) {
        noAnsBtn.addEventListener('click', function () {
          runWithLock(noAnsBtn, 'recordNoAnswer:' + r.id, function () {
            var now = new Date();
            var nowIso = now.toISOString();
            var nextCount = Number(r.noAnswerCount || 0) + 1;
            var actionText = core.buildNoAnswerActionText
              ? core.buildNoAnswerActionText(nextCount, ctx.lang)
              : ('محاولة اتصال — لم يرد (المحاولة #' + nextCount + ')');
            var optFu = {
              id: 'FU_OPT_' + Date.now(),
              reservationId: r.id,
              reservationNumber: r.reservationNumber,
              customerName: r.customerName,
              employeeId: user.id,
              employeeName: user.name,
              status: r.internalStatus || 'تم الإنشاء',
              action: actionText,
              notes: '',
              followUpDate: nowIso.substring(0, 10),
              followUpTime: now.toTimeString().substring(0, 8),
              createdAt: nowIso
            };
            d.reservation = Object.assign({}, r, {
              noAnswerCount: nextCount,
              lastUpdateText: actionText,
              lastUpdatedById: user.id,
              lastUpdatedByName: user.name,
              lastUpdatedAt: nowIso
            });
            d.followUps = [optFu].concat(d.followUps || []);
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('recordNoAnswerFollowUp', { reservationId: r.id }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم تسجيل محاولة اتصال — لم يرد (المحاولة #' + nextCount + ')');
            return root.RGApi.callApi('recordNoAnswerFollowUp', {
              reservationId: r.id,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر تسجيل محاولة الاتصال.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'recordNoAnswerFollowUp', spamSig: r.id }).finally(function () {
            var b = document.getElementById('drawer-no-answer-btn');
            if (b && (!root.RGApp || !root.RGApp.isActionLocked || !root.RGApp.isActionLocked('recordNoAnswer:' + r.id))) {
              b.disabled = false;
              b.removeAttribute('aria-busy');
            }
          });
        });
      }

      if (canPinNote) {
        var pinnedForm = document.getElementById('drawer-pinned-note-form');
        var savePinnedNoteValue = function (noteVal, triggerBtn) {
          var clean = String(noteVal || '').trim();
          var nowIso = new Date().toISOString();
          runWithLock(triggerBtn, 'savePinnedNote:' + r.id, function () {
            d.reservation = Object.assign({}, r, {
              pinnedNote: clean,
              pinnedNoteById: clean ? user.id : '',
              pinnedNoteByName: clean ? user.name : '',
              pinnedNoteUpdatedAt: clean ? nowIso : ''
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('saveReservationPinnedNote', { reservationId: r.id, note: clean }, user);
            }
            paintDrawer();
            notifyParentUpdated();
            ctx.toast(clean ? 'تم حفظ الملاحظة المثبتة أعلى الحجز.' : 'تمت إزالة الملاحظة المثبتة.');
            return root.RGApi.callApi('saveReservationPinnedNote', {
              reservationId: r.id,
              note: clean,
              _keepOptimisticCache: true,
              _spamChecked: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر حفظ الملاحظة المثبتة.', true); reopenSelf(null); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf(null);
            });
          }, { spamAction: 'saveReservationPinnedNote', spamSig: r.id + ':' + clean });
        };
        if (pinnedForm) {
          pinnedForm.addEventListener('submit', function (ev) {
            ev.preventDefault();
            var inp = document.getElementById('drawer-pinned-note-input');
            savePinnedNoteValue(inp ? inp.value : '', document.getElementById('drawer-save-pinned-note-btn'));
          });
        }
        var clearPinnedBtn = document.getElementById('drawer-clear-pinned-note-btn');
        if (clearPinnedBtn) {
          clearPinnedBtn.addEventListener('click', function () {
            savePinnedNoteValue('', clearPinnedBtn);
          });
        }
      }

      if (root.RGCrmMentions && root.RGCrmMentions.attach) {
        var getPool = function () { return resolvedEmployees; };
        var pinnedInp = document.getElementById('drawer-pinned-note-input');
        if (pinnedInp) root.RGCrmMentions.attach(pinnedInp, getPool);
        root.RGCrmMentions.attach(document.getElementById('drawer-quick-note'), getPool);
        root.RGCrmMentions.attach(document.getElementById('fu-action'), getPool);
        root.RGCrmMentions.attach(document.getElementById('fu-notes'), getPool);
      }

      var drawerPrbBtn = document.getElementById('drawer-problem-btn');
      if (drawerPrbBtn) {
        drawerPrbBtn.addEventListener('click', function () {
          requestDrawerExit(function () {
            cleanupDrawerLifecycle();
            openCreateProblemModal(r, resolvedEmployees, ctx, function (optPrb) {
              if (optPrb) {
                notifyParentUpdated(Object.assign({}, r, { hasProblem: true }));
              } else {
                reopenSelf();
              }
            }, reopenSelf);
          });
        });
      }

      var drawerCharts = renderDrawerCharts(d);

      var drawerExportWrap = document.getElementById('drawer-export-wrap');
      if (drawerExportWrap && root.RGExportMenu) {
        root.RGExportMenu.bind(drawerExportWrap, {
          onPdf: function () {
            requestDrawerExit(function () {
              cleanupDrawerLifecycle();
              openSingleReservationPdfModal(d, ctx, drawerCharts, reopenSelf);
            });
          },
          onExcel: function () {
            return exportSingleReservationExcel(d, ctx);
          },
          onError: function (err) {
            ctx.toast((err && err.message) || (isEn ? 'Export failed.' : 'تعذر تنفيذ التصدير.'), true);
          }
        });
      }
      var drawerPdfBtn = document.getElementById('drawer-pdf-btn');
      if (drawerPdfBtn) {
        drawerPdfBtn.addEventListener('click', function () {
          requestDrawerExit(function () {
            cleanupDrawerLifecycle();
            openSingleReservationPdfModal(d, ctx, drawerCharts, reopenSelf);
          });
        });
      }
    }

    function startDrawerLifecycle() {
      if (!drawerCleanedUp && lockHeartbeatTimer) return;
      drawerCleanedUp = false;
      document.removeEventListener('rg:deltasync', onDeltaSyncDrawer);
      document.removeEventListener('rg:personalprefschange', onPersonalPrefsDrawer);
      document.addEventListener('rg:deltasync', onDeltaSyncDrawer);
      document.addEventListener('rg:personalprefschange', onPersonalPrefsDrawer);
      if (typeof MutationObserver !== 'undefined') {
        if (modalObserver) {
          try { modalObserver.disconnect(); } catch (_e) {}
        }
        modalObserver = new MutationObserver(function () {
          if (isPaintingDrawer || drawerCleanedUp) return;
          var bd = document.getElementById('res-drawer-backdrop');
          if (!bd || bd.getAttribute('data-res-id') !== String(d.reservation.id)) {
            cleanupDrawerLifecycle();
          }
        });
        modalObserver.observe(modalRoot, { childList: true });
      }
      if (root.RGApi && root.RGApi.callApi) {
        if (lockHeartbeatTimer) clearInterval(lockHeartbeatTimer);
        lockHeartbeatTimer = setInterval(function () {
          if (drawerCleanedUp) return;
          var bd = document.getElementById('res-drawer-backdrop');
          if (!bd || bd.getAttribute('data-res-id') !== String(d.reservation.id)) {
            cleanupDrawerLifecycle();
            return;
          }
          root.RGApi.callApi('acquireReservationLock', { reservationId: d.reservation.id, silentRefresh: true }).catch(function () {});
        }, 45000);
      }
    }

    paintDrawer();
    drawerCleanedUp = true;
    startDrawerLifecycle();
    if (root.RGApi && root.RGApi.callApi) {
      root.RGApi.callApi('acquireReservationLock', { reservationId: d.reservation.id, silentRefresh: true }).then(function (lockRes) {
        if (drawerCleanedUp) return;
        if (lockRes && lockRes.success && lockRes.data && lockRes.data.lock && !lockRes.data.acquired) {
          drawerLockInfo = lockRes.data.lock;
          var host = document.getElementById('drawer-softlock-host');
          if (host) {
            host.innerHTML = '<div class="rg-softlock-banner" role="status">🔒 ' + (isEn ? ('Currently being followed up by ' + esc(drawerLockInfo.lockedByName)) : ('يقوم ' + esc(drawerLockInfo.lockedByName) + ' حالياً بمتابعة هذا الحجز')) + '</div>';
          }
        }
      }).catch(function () {});
    }

    if (!resolvedEmployees.length && root.RGApi && root.RGApi.callApi) {
      root.RGApi.callApi('getEmployees', { silentRefresh: true }).then(function (empRes) {
        if (!empRes || !empRes.success || !empRes.data || !Array.isArray(empRes.data.items)) return;
        resolvedEmployees = empRes.data.items.slice();
        if (root.RGApp && root.RGApp.syncEmployeesStateFromPayload) {
          root.RGApp.syncEmployeesStateFromPayload(empRes.data);
        }
        var curBackdrop = document.getElementById('res-drawer-backdrop');
        if (!curBackdrop) return;
        var openResId = curBackdrop.getAttribute('data-res-id');
        if (openResId !== String(d.reservation.id) && openResId !== String(reservationId)) return;
        var activeEl = document.activeElement;
        var isTyping = activeEl && modalRoot.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName);
        if (!isTyping) paintDrawer();
      }).catch(function () {});
    }

    if (instant && (instant.isPartial || instant.isStale)) {
      root.RGApi.callApi('getReservationDetails', { reservationId: reservationId, silentRefresh: true }).then(function (freshRes) {
        if (!freshRes || !freshRes.success || !freshRes.data || !freshRes.data.reservation) return;
        var curBackdrop = document.getElementById('res-drawer-backdrop');
        if (!curBackdrop) return;
        var openResId = curBackdrop.getAttribute('data-res-id');
        if (openResId !== String(d.reservation.id) && openResId !== String(reservationId)) return;
        var activeEl = document.activeElement;
        var isTyping = activeEl && modalRoot.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName);
        if (isTyping) return;
        d = freshRes.data;
        paintDrawer();
      }).catch(function () {});
    }
  }

  function openEditReservationModal(reservation, ctx, onSaved, onCancel) {
    var curUserEdit = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var canEditCustomerId = !root.RGCrmCore || !root.RGCrmCore.canUserViewCustomerId || root.RGCrmCore.canUserViewCustomerId(curUserEdit);
    var modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="res-edit-title">' +
        '<form class="modal-panel" id="res-edit-form">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="res-edit-title">تعديل تفاصيل الحجز <span class="mono">' + esc(reservation.reservationNumber) + '</span></h3>' +
              '<div class="meta-inline"><span>تحكم المشرف والمدير العام في كامل بيانات الحجز والتمديدات والحالة</span></div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="res-edit-cancel">رجوع</button>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="re-customer">اسم العميل</label><input class="input" id="re-customer" value="' + esc(reservation.customerName) + '" required></div>' +
            '<div class="form-group"><label class="form-label" for="re-phone">رقم الجوال</label><input class="input mono" id="re-phone" value="' + esc(reservation.customerPhone) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-email">بريد العميل</label><input class="input mono" id="re-email" value="' + esc(reservation.customerEmail || '') + '"></div>' +
            (canEditCustomerId ? '<div class="form-group"><label class="form-label" for="re-idnum">رقم الهوية / الإقامة</label><input class="input mono" id="re-idnum" value="' + esc(reservation.customerIdNumber || '') + '"></div>' : '') +
            '<div class="form-group"><label class="form-label" for="re-company">شركة التأجير</label><input class="input" id="re-company" value="' + esc(reservation.companyName) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-branch">فرع الاستلام</label><input class="input" id="re-branch" value="' + esc(reservation.branchName) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-deliv-branch">فرع التسليم</label><input class="input" id="re-deliv-branch" value="' + esc(reservation.deliverBranchName || reservation.branchName || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-car">السيارة</label><input class="input" id="re-car" value="' + esc(reservation.carName) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-car-cat">فئة السيارة</label><input class="input" id="re-car-cat" value="' + esc(reservation.carCategory || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-plate">رقم اللوحة</label><input class="input" id="re-plate" value="' + esc(reservation.plateNumber) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-start">تاريخ البداية</label><input type="date" class="input" id="re-start" data-rg-range-pair="res-edit-range" data-rg-range-role="start" value="' + esc(formatDateOnly(reservation.startDate) === '-' ? '' : formatDateOnly(reservation.startDate)) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-start-time">وقت البداية</label><input class="input mono" id="re-start-time" placeholder="14:30" value="' + esc(reservation.startTime || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-end">نهاية الحجز الفعلية</label><input type="date" class="input" id="re-end" data-rg-range-pair="res-edit-range" data-rg-range-role="end" value="' + esc(formatDateOnly(reservation.endDate) === '-' ? '' : formatDateOnly(reservation.endDate)) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-ext-until">التمديد لحد</label><input type="date" class="input" id="re-ext-until" value="' + esc(formatDateOnly(reservation.extendedUntilDate) === '-' ? '' : formatDateOnly(reservation.extendedUntilDate)) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-pickup">نوع الاستلام</label><input class="input" id="re-pickup" value="' + esc(reservation.pickupTypeAr) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-return">نوع التسليم</label><input class="input" id="re-return" value="' + esc(reservation.returnTypeAr) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-pay-method">طريقة الدفع</label><input class="input" id="re-pay-method" value="' + esc(reservation.paymentMethod || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-pay-status">حالة الدفع</label><input class="input" id="re-pay-status" value="' + esc(reservation.paymentStatus || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-status">الحالة الداخلية</label>' +
              '<select class="select" id="re-status"' + ((root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(reservation)) ? ' disabled' : '') + '>' +
                (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(reservation.internalStatus) : (root.RGCrmCore.MANUAL_WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES)).map(function (s) {
                  return '<option value="' + esc(s) + '"' + (reservation.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                }).join('') +
              '</select></div>' +
            '<div class="form-group"><label class="form-label" for="re-prio">الأولوية</label>' +
              '<select class="select" id="re-prio">' +
                root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) {
                  return '<option value="' + esc(p) + '"' + (reservation.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>';
                }).join('') +
              '</select></div>' +
          '</div>' +
          '<div class="form-grid-3">' +
            '<div class="form-group"><label class="form-label" for="re-days">الأيام الأساسية</label><input type="number" min="1" class="input mono" id="re-days" value="' + Number(reservation.daysCount || 1) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-ext-days">أيام التمديد</label><input type="number" min="0" class="input mono" id="re-ext-days" value="' + Number(reservation.extendedDaysCount || 0) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-ext-count">عدد مرات التمديد</label><input type="number" min="0" class="input mono" id="re-ext-count" value="' + Number(reservation.extensionsCount || 0) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-base">المبلغ الأساسي (ر.س)</label><input type="number" step="0.01" class="input mono" id="re-base" value="' + Number(reservation.baseAmount || 0) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-ext">سعر التمديد (ر.س)</label><input type="number" step="0.01" class="input mono" id="re-ext" value="' + Number(reservation.extensionsAmount || 0) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-total">الإجمالي النهائي (ر.س)</label><input type="number" step="0.01" class="input mono" id="re-total" value="' + Number(reservation.totalAmount || 0) + '"></div>' +
          '</div>' +
          '<div class="form-group"><label class="form-label" for="re-last">آخر تحديث / ملخص</label><input class="input" id="re-last" value="' + esc(reservation.lastUpdateText || '') + '"></div>' +
          '<div id="res-edit-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="submit" class="btn btn-primary" id="res-edit-save">حفظ تعديلات الحجز</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    var baseEl = document.getElementById('re-base');
    var extEl = document.getElementById('re-ext');
    var totalEl = document.getElementById('re-total');
    function syncTotal() {
      totalEl.value = String(Math.round((Number(baseEl.value || 0) + Number(extEl.value || 0)) * 100) / 100);
    }
    baseEl.addEventListener('input', syncTotal);
    extEl.addEventListener('input', syncTotal);

    var editResFieldIds = [
      're-customer', 're-phone', 're-email', 're-idnum', 're-company', 're-branch', 're-deliv-branch',
      're-car', 're-car-cat', 're-plate', 're-start', 're-start-time', 're-end', 're-ext-until',
      're-pickup', 're-return', 're-pay-method', 're-pay-status', 're-status', 're-prio',
      're-days', 're-ext-days', 're-ext-count', 're-base', 're-ext', 're-total', 're-last'
    ];
    var snapshotEditResValues = function () {
      return editResFieldIds.map(function (fid) {
        var el = document.getElementById(fid);
        return el ? String(el.value || '') : '';
      }).join('\x00');
    };
    var initialEditResSnapshot = snapshotEditResValues();

    function buildEditResPayload() {
      var baseDaysVal = Math.max(1, Number(document.getElementById('re-days').value || 1));
      var extDaysVal = Math.max(0, Number(document.getElementById('re-ext-days').value || 0));
      return {
        reservationId: reservation.id,
        expectedUpdatedAt: reservation.updatedAt || reservation.lastUpdatedAt || '',
        customerName: document.getElementById('re-customer').value,
        customerPhone: document.getElementById('re-phone').value,
        customerEmail: document.getElementById('re-email').value,
        customerIdNumber: (canEditCustomerId && document.getElementById('re-idnum')) ? document.getElementById('re-idnum').value : undefined,
        companyName: document.getElementById('re-company').value,
        branchName: document.getElementById('re-branch').value,
        deliverBranchName: document.getElementById('re-deliv-branch').value,
        carName: document.getElementById('re-car').value,
        carCategory: document.getElementById('re-car-cat').value,
        plateNumber: document.getElementById('re-plate').value,
        startDate: document.getElementById('re-start').value,
        startTime: document.getElementById('re-start-time').value,
        endDate: document.getElementById('re-end').value,
        extendedUntilDate: document.getElementById('re-ext-until').value,
        pickupTypeAr: document.getElementById('re-pickup').value,
        returnTypeAr: document.getElementById('re-return').value,
        paymentMethod: document.getElementById('re-pay-method').value,
        paymentStatus: document.getElementById('re-pay-status').value,
        internalStatus: document.getElementById('re-status').value,
        priority: document.getElementById('re-prio').value,
        daysCount: baseDaysVal,
        extendedDaysCount: extDaysVal,
        totalDaysCount: baseDaysVal + extDaysVal,
        extensionsCount: Math.max(0, Number(document.getElementById('re-ext-count').value || 0)),
        baseAmount: Number(baseEl.value || 0),
        extensionsAmount: Number(extEl.value || 0),
        totalAmount: Number(totalEl.value || 0),
        lastUpdateText: document.getElementById('re-last').value
      };
    }

    function executeEditResSave(fromGuard) {
      var formEl = document.getElementById('res-edit-form');
      if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates && formEl) {
        var dateCheck = root.RGCrmDatePicker.validateContainerDates(formEl);
        if (!dateCheck.valid) {
          var errBox = document.getElementById('res-edit-err');
          if (errBox) {
            errBox.textContent = dateCheck.message || 'يرجى تصحيح صيغة التاريخ المدخل.';
            errBox.classList.remove('hidden');
          }
          return Promise.resolve(false);
        }
      }
      var editUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
      var payload = buildEditResPayload();
      var isResCurrentlyInactive = Boolean(root.RGCrmCore && root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(reservation));
      if (isResCurrentlyInactive) {
        payload.internalStatus = reservation.internalStatus;
      } else if (root.RGCrmCore && root.RGCrmCore.isManualBlockedWorkflowStatus && root.RGCrmCore.isManualBlockedWorkflowStatus(payload.internalStatus)) {
        var errBoxBlocked = document.getElementById('res-edit-err');
        if (errBoxBlocked) {
          errBoxBlocked.textContent = 'لا يمكن تحويل الحجز يدوياً إلى مرفوض أو ملغي.';
          errBoxBlocked.classList.remove('hidden');
        }
        return Promise.resolve(false);
      }
      if (!String(payload.customerName || '').trim()) {
        var errBoxName = document.getElementById('res-edit-err');
        if (errBoxName) {
          errBoxName.textContent = 'يرجى إدخال اسم العميل.';
          errBoxName.classList.remove('hidden');
        }
        return Promise.resolve(false);
      }
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      }
      if (root.RGApi && root.RGApi.applyOptimisticMutation) {
        root.RGApi.applyOptimisticMutation('updateReservationDetails', payload, editUser);
      }
      var patchedResObj = Object.assign({}, reservation, payload, {
        updatedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        lastUpdatedByName: (editUser && editUser.name) || reservation.lastUpdatedByName
      });
      ctx.toast('تم حفظ تعديلات تفاصيل الحجز بنجاح.');
      if (!fromGuard) {
        if (onSaved) onSaved(patchedResObj);
        else modalRoot.innerHTML = '';
      }
      return root.RGApi.callApi('updateReservationDetails', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, payload)).then(function (res) {
        if (res && res.success) {
          ctx.refreshNotifications();
          return true;
        }
        ctx.toast((res && res.message) || 'تعذر حفظ التعديلات على الخادم.', true);
        if (onSaved) onSaved(null);
        return false;
      }).catch(function () {
        ctx.toast('تعذر الاتصال بالخادم أثناء حفظ التعديلات.', true);
        if (onSaved) onSaved(null);
        return false;
      });
    }

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: 'تعديل تفاصيل الحجز ' + (reservation.reservationNumber || ''),
        isDirty: function () {
          var form = document.getElementById('res-edit-form');
          if (!form) return false;
          return snapshotEditResValues() !== initialEditResSnapshot;
        },
        onSave: function () { return executeEditResSave(true); },
        onDiscard: function () {
          if (onCancel) onCancel();
          else modalRoot.innerHTML = '';
        }
      });
    }

    document.getElementById('res-edit-cancel').addEventListener('click', function () {
      var proceed = function () {
        if (onCancel) onCancel();
        else modalRoot.innerHTML = '';
      };
      if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
        root.RGApp.requestCloseWithGuard(proceed);
      } else {
        proceed();
      }
    });

    document.getElementById('res-edit-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var saveBtn = document.getElementById('res-edit-save');
      var sigPayload = buildEditResPayload();
      var fullSig = [
        sigPayload.reservationId,
        sigPayload.customerName,
        sigPayload.customerPhone,
        sigPayload.carName,
        sigPayload.plateNumber,
        sigPayload.startDate,
        sigPayload.endDate,
        sigPayload.extendedUntilDate,
        sigPayload.internalStatus,
        sigPayload.priority,
        sigPayload.totalAmount,
        sigPayload.lastUpdateText
      ].join('|');
      runWithLock(saveBtn, 'updateReservationDetails:' + reservation.id, function () {
        return executeEditResSave(false);
      }, { spamAction: 'updateReservationDetails', spamSig: fullSig });
    });
  }

  function openEditFollowUpModal(followUp, reservation, ctx, onSaved, onCancel) {
    var modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="fu-edit-title">' +
        '<form class="modal-panel" id="fu-edit-form">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="fu-edit-title">تعديل التحديث والمتابعة — <span class="mono">' + esc(reservation.reservationNumber) + '</span></h3>' +
              '<div class="meta-inline"><span>الموظف: ' + esc(followUp.employeeName) + '</span><span>·</span><span class="mono" dir="ltr">' + esc(formatDateOnly(followUp.followUpDate)) + ' ' + esc(formatTimeOnly(followUp.followUpTime, ctx.lang)) + '</span></div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="fu-edit-cancel">رجوع</button>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="fue-status">الحالة</label>' +
              '<select class="select" id="fue-status"' + ((root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(reservation)) ? ' disabled' : '') + '>' +
                (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(followUp.status) : (root.RGCrmCore.MANUAL_WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES)).map(function (s) {
                  return '<option value="' + esc(s) + '"' + (followUp.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                }).join('') +
              '</select></div>' +
            '<div class="form-group"><label class="form-label" for="fue-action">الإجراء المتخذ</label>' +
              '<input class="input" id="fue-action" value="' + esc(followUp.action) + '" required></div>' +
          '</div>' +
          '<div class="form-group"><label class="form-label" for="fue-notes">الملاحظات</label>' +
            '<textarea class="textarea" id="fue-notes">' + esc(followUp.notes || '') + '</textarea></div>' +
          '<label class="checkbox-item"><input type="checkbox" id="fue-sync" checked> مزامنة الحالة وآخر تحديث مع بطاقة الحجز الرئيسية</label>' +
          '<div id="fu-edit-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="submit" class="btn btn-primary" id="fu-edit-save-btn">حفظ التعديل</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    if (root.RGCrmMentions && root.RGCrmMentions.attach) {
      root.RGCrmMentions.attach(document.getElementById('fue-action'));
      root.RGCrmMentions.attach(document.getElementById('fue-notes'));
    }

    var snapshotFuEdit = function () {
      var st = document.getElementById('fue-status');
      var ac = document.getElementById('fue-action');
      var nt = document.getElementById('fue-notes');
      var sy = document.getElementById('fue-sync');
      return [st ? st.value : '', ac ? ac.value : '', nt ? nt.value : '', sy ? String(Boolean(sy.checked)) : ''].join('\x00');
    };
    var initialFuSnapshot = snapshotFuEdit();

    function executeFuEditSave(fromGuard) {
      var isFuResInactive = Boolean(root.RGCrmCore && root.RGCrmCore.isInactiveReservation && root.RGCrmCore.isInactiveReservation(reservation));
      var stVal = isFuResInactive ? followUp.status : document.getElementById('fue-status').value;
      var actVal = String(document.getElementById('fue-action').value || '').trim();
      var notesVal = document.getElementById('fue-notes').value;
      var syncVal = isFuResInactive ? false : document.getElementById('fue-sync').checked;
      if (!isFuResInactive && root.RGCrmCore && root.RGCrmCore.isManualBlockedWorkflowStatus && root.RGCrmCore.isManualBlockedWorkflowStatus(stVal)) {
        var errFuBlocked = document.getElementById('fu-edit-err');
        if (errFuBlocked) {
          errFuBlocked.textContent = 'لا يمكن تحويل الحالة يدوياً إلى مرفوض أو ملغي.';
          errFuBlocked.classList.remove('hidden');
        }
        return Promise.resolve(false);
      }
      if (!actVal) {
        var errFu = document.getElementById('fu-edit-err');
        if (errFu) {
          errFu.textContent = 'يرجى كتابة الإجراء المتخذ.';
          errFu.classList.remove('hidden');
        }
        return Promise.resolve(false);
      }
      var fuUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
      var fuPayload = {
        followUpId: followUp.id,
        status: stVal,
        action: actVal,
        notes: notesVal,
        syncToReservation: syncVal
      };
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      }
      if (root.RGApi && root.RGApi.applyOptimisticMutation) {
        root.RGApi.applyOptimisticMutation('updateFollowUp', fuPayload, fuUser);
      }
      var patchedFuObj = Object.assign({}, followUp, {
        status: stVal,
        action: actVal,
        notes: notesVal
      });
      var patchedResFromFu = syncVal ? Object.assign({}, reservation, {
        internalStatus: stVal,
        lastUpdateText: actVal + (notesVal ? ' — ' + notesVal : ''),
        lastUpdatedAt: new Date().toISOString(),
        lastUpdatedByName: (fuUser && fuUser.name) || reservation.lastUpdatedByName
      }) : undefined;
      ctx.toast('تم تعديل سجل المتابعة بنجاح.');
      if (!fromGuard) {
        if (onSaved) onSaved({ followUp: patchedFuObj, reservation: patchedResFromFu });
        else modalRoot.innerHTML = '';
      }
      return root.RGApi.callApi('updateFollowUp', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, fuPayload)).then(function (res) {
        if (res && res.success) {
          ctx.refreshNotifications();
          return true;
        }
        ctx.toast((res && res.message) || 'تعذر حفظ تعديل المتابعة.', true);
        if (onSaved) onSaved(null);
        return false;
      }).catch(function () {
        ctx.toast('تعذر الاتصال بالخادم أثناء حفظ المتابعة.', true);
        if (onSaved) onSaved(null);
        return false;
      });
    }

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: 'تعديل المتابعة #' + (reservation.reservationNumber || ''),
        isDirty: function () {
          var form = document.getElementById('fu-edit-form');
          if (!form) return false;
          return snapshotFuEdit() !== initialFuSnapshot;
        },
        onSave: function () { return executeFuEditSave(true); },
        onDiscard: function () {
          if (onCancel) onCancel();
          else modalRoot.innerHTML = '';
        }
      });
    }

    document.getElementById('fu-edit-cancel').addEventListener('click', function () {
      var proceed = function () {
        if (onCancel) onCancel();
        else modalRoot.innerHTML = '';
      };
      if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
        root.RGApp.requestCloseWithGuard(proceed);
      } else {
        proceed();
      }
    });

    document.getElementById('fu-edit-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var saveFuBtn = document.getElementById('fu-edit-save-btn');
      runWithLock(saveFuBtn, 'updateFollowUp:' + followUp.id, function () {
        return executeFuEditSave(false);
      }, { spamAction: 'updateFollowUp', spamSig: followUp.id + ':' + document.getElementById('fue-status').value + ':' + document.getElementById('fue-action').value });
    });
  }

  function renderDrawerCharts(details) {
    var r = details.reservation;

    function paintCharts() {
      if (!root.Chart) return;
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var reduced = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var txtColor = isDark ? '#E5E7EB' : '#292929';
      var mutedColor = isDark ? '#9CA3AF' : '#686868';
      var gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(41,41,41,0.08)';
      var segBorder = isDark ? '#1E1E21' : '#FFFFFF';
      var charcoalSeg = isDark ? '#8A8A8A' : '#292929';
      var tooltipOpt = {
        backgroundColor: 'rgba(41, 41, 41, 0.96)',
        titleColor: '#FFFFFF',
        bodyColor: '#F3F4F6',
        borderColor: 'rgba(217, 31, 43, 0.45)',
        borderWidth: 1,
        cornerRadius: 11,
        padding: 10,
        titleFont: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '700' },
        bodyFont: { family: "'IBM Plex Sans Arabic', sans-serif" },
        callbacks: {
          label: function (ctxItem) {
            var arr = (ctxItem.dataset && Array.isArray(ctxItem.dataset.data)) ? ctxItem.dataset.data : [];
            var total = arr.reduce(function (acc, val) { return acc + Math.max(0, Number(val || 0)); }, 0);
            var val = Number(ctxItem.raw !== undefined ? ctxItem.raw : 0);
            var pct = total > 0 ? Math.round((val / total) * 100) : 0;
            var lbl = ctxItem.label || ctxItem.dataset.label || '';
            return ' ' + (lbl ? lbl + ': ' : '') + val + ' (' + pct + '%)';
          }
        }
      };

      var finEl = document.getElementById('res-drawer-chart-finance');
      if (finEl && finEl.isConnected) {
        if (typeof root.Chart.getChart === 'function') {
          var existingFin = root.Chart.getChart(finEl);
          if (existingFin) existingFin.destroy();
        }
        new root.Chart(finEl.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: ['المبلغ الأساسي', 'التمديدات المعتمدة'],
            datasets: [{
              data: [Number(r.baseAmount || 0), Number(r.extensionsAmount || 0)],
              backgroundColor: [charcoalSeg, '#D91F2B'],
              borderColor: segBorder,
              borderWidth: 2.5,
              hoverOffset: 8
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduced ? false : { animateRotate: true, animateScale: true, duration: 720, easing: 'easeOutQuart' },
            cutout: '66%',
            plugins: {
              legend: { position: 'bottom', labels: { color: txtColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } } },
              tooltip: tooltipOpt
            }
          }
        });
      }

      var empFollowUpCounts = {};
      (r.assignedEmployeeNames || []).forEach(function (name) {
        empFollowUpCounts[name] = 0;
      });
      details.followUps.forEach(function (f) {
        var n = f.employeeName || 'غير محدد';
        empFollowUpCounts[n] = (empFollowUpCounts[n] || 0) + 1;
      });

      var actLabels = Object.keys(empFollowUpCounts);
      var actValues = actLabels.map(function (k) { return empFollowUpCounts[k]; });
      if (actLabels.length === 0) {
        actLabels = ['المتابعات', 'المشكلات', 'التمديدات'];
        actValues = [details.followUps.length, details.problems.length, details.extensions.length];
      } else {
        actLabels.push('المشكلات');
        actValues.push(details.problems.length);
      }

      var actEl = document.getElementById('res-drawer-chart-activity');
      if (actEl && actEl.isConnected) {
        if (typeof root.Chart.getChart === 'function') {
          var existingAct = root.Chart.getChart(actEl);
          if (existingAct) existingAct.destroy();
        }
        new root.Chart(actEl.getContext('2d'), {
          type: 'bar',
          data: {
            labels: actLabels,
            datasets: [{
              label: 'النشاط',
              data: actValues,
              backgroundColor: actLabels.map(function (lbl, idx) {
                return lbl === 'المشكلات' ? '#D91F2B' : (idx % 2 === 0 ? charcoalSeg : '#10B981');
              }),
              borderRadius: 8,
              borderSkipped: false,
              maxBarThickness: 38
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduced ? false : {
              duration: 600,
              easing: 'easeOutQuart',
              delay: function (context) {
                return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 70 : 0;
              }
            },
            plugins: { legend: { display: false }, tooltip: tooltipOpt },
            scales: {
              x: { ticks: { color: txtColor, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { display: false } },
              y: { ticks: { color: mutedColor, precision: 0, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { color: gridColor }, beginAtZero: true, grace: '15%' }
            }
          }
        });
      }
    }

    if (root.Chart) {
      paintCharts();
    } else if (typeof root.RGEnsureChartLoaded === 'function') {
      root.RGEnsureChartLoaded().then(paintCharts).catch(function () {});
    }

    function fallbackCapture(el, title) {
      if (!el || !el.width || !el.height) return null;
      if (root.RGReports && typeof root.RGReports.captureChartForPdf === 'function') {
        return root.RGReports.captureChartForPdf(el, title);
      }
      var off = document.createElement('canvas');
      off.width = Math.max(1, el.width || 600);
      off.height = Math.max(1, el.height || 300);
      var octx = off.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, off.width, off.height);
      octx.drawImage(el, 0, 0, off.width, off.height);
      return { title: title, dataUrl: off.toDataURL('image/jpeg', 0.85) };
    }

    return {
      getImages: function () {
        var finEl = document.getElementById('res-drawer-chart-finance');
        var actEl = document.getElementById('res-drawer-chart-activity');
        return [
          fallbackCapture(finEl, 'حالة الحجز والتفصيل المالي (' + r.internalStatus + ')'),
          fallbackCapture(actEl, 'أداء الموظفين ونشاط الحجز')
        ].filter(Boolean);
      }
    };
  }

  function openCreateProblemModal(reservation, employees, ctx, onCreated, onCancel) {
    var modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="prb-create-title">' +
        '<form class="modal-panel" id="prb-create-form">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="prb-create-title">تحويل الحجز ' + esc(reservation.reservationNumber) + ' إلى مشكلة</h3>' +
            '<button type="button" class="btn btn-sm" id="prb-cancel">إغلاق</button>' +
          '</div>' +
          '<div class="form-group"><label class="form-label" for="prb-priority">الأولوية</label>' +
            '<select class="select" id="prb-priority">' +
              '<option value="عادي">عادي</option>' +
              '<option value="متوسط" selected>متوسط</option>' +
              '<option value="مرتفع">مرتفع (يرسل إشعارًا فوريًا للمشرفين)</option>' +
            '</select></div>' +
          '<div class="form-group"><label class="form-label" for="prb-desc">وصف المشكلة</label>' +
            '<textarea class="textarea" id="prb-desc" required placeholder="اشرح تفاصيل المشكلة بوضوح..."></textarea></div>' +
          '<div class="form-group"><span class="form-label">إسناد إلى الموظفين</span><div class="checkbox-grid">' +
            employees.filter(function (e) { return e.status === 'active'; }).map(function (emp) {
              return '<label class="checkbox-item"><input type="checkbox" class="prb-emp-chk" value="' + esc(emp.id) + '"> ' + esc(emp.name) + '</label>';
            }).join('') +
          '</div></div>' +
          '<div id="prb-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="submit" class="btn btn-primary">حفظ المشكلة</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    if (root.RGCrmMentions && root.RGCrmMentions.attach) {
      root.RGCrmMentions.attach(document.getElementById('prb-desc'), function () { return employees; });
    }

    var submitBtn = modalRoot.querySelector('#prb-create-form button[type="submit"]');
    var handledCreate = false;

    document.getElementById('prb-cancel').addEventListener('click', function () {
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });

    document.getElementById('prb-create-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (handledCreate) return;

      var prioVal = document.getElementById('prb-priority').value;
      var descVal = String(document.getElementById('prb-desc').value || '').trim();
      if (!descVal) {
        var errEl = document.getElementById('prb-err');
        errEl.textContent = 'يرجى إدخال وصف المشكلة.';
        errEl.classList.remove('hidden');
        return;
      }

      handledCreate = true;
      var empIds = Array.from(modalRoot.querySelectorAll('.prb-emp-chk:checked')).map(function (c) { return c.value; });
      var user = root.RGAuth.getUser();
      var empNames = empIds.map(function (eid) {
        var found = employees.find(function (e) { return e.id === eid; });
        return found ? found.name : '';
      }).filter(Boolean);
      var nowIso = new Date().toISOString();
      var optPrb = {
        id: 'PRB_OPT_' + Date.now(),
        problemNumber: 'PRB-' + String(Date.now()).slice(-6),
        reservationId: reservation.id,
        reservationNumber: reservation.reservationNumber,
        customerName: reservation.customerName,
        createdById: (user && user.id) || '',
        createdByName: (user && user.name) || 'الموظف',
        assignedEmployeeIds: empIds.length ? empIds : [(user && user.id) || ''],
        assignedEmployeeNames: empNames.length ? empNames : [(user && user.name) || ''],
        description: descVal,
        priority: prioVal,
        status: 'جديدة',
        createdAt: nowIso,
        updatedAt: nowIso,
        updates: []
      };

      runWithLock(submitBtn, 'createProblem:' + reservation.id, function () {
        modalRoot.innerHTML = '';
        if (root.RGApi.applyOptimisticMutation) {
          root.RGApi.applyOptimisticMutation('createProblem', {
            reservationId: reservation.id,
            reservationNumber: reservation.reservationNumber,
            customerName: reservation.customerName,
            priority: prioVal,
            description: descVal,
            assignedEmployeeIds: empIds,
            _optimisticProblem: optPrb
          }, user);
        }
        if (onCreated) onCreated(optPrb);
        ctx.toast('تم إنشاء المشكلة وتسجيلها بنجاح.');

        return root.RGApi.callApi('createProblem', {
          reservationId: reservation.id,
          priority: prioVal,
          description: descVal,
          assignedEmployeeIds: empIds,
          _keepOptimisticCache: true,
          _spamChecked: true
        }).then(function (res) {
          if (res && res.success) {
            ctx.refreshNotifications();
          } else {
            ctx.toast((res && res.message) || 'تعذر مزامنة المشكلة مع الخادم.', true);
            if (onCreated) onCreated(null);
          }
        }).catch(function () {
          ctx.toast('تعذر الاتصال بالخادم أثناء حفظ المشكلة.', true);
          if (onCreated) onCreated(null);
        });
      }, { spamAction: 'createProblem', spamSig: reservation.id + ':' + prioVal + ':' + descVal });
    });
  }

  async function exportSingleReservationExcel(details, ctx) {
    if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') {
      if (ctx && ctx.toast) ctx.toast('وحدة تصدير Excel غير متاحة.', true);
      return;
    }
    var r = (details && details.reservation) || {};
    var isEn = Boolean(ctx && ctx.lang === 'en');
    var repTitle = isEn
      ? ('Booking File #' + (r.reservationNumber || r.id || ''))
      : ('ملف الحجز رقم ' + (r.reservationNumber || r.id || ''));
    var periodTxt = (r.startDate || r.endDate)
      ? (formatDateOnly(r.startDate) + ' → ' + formatDateOnly(r.extendedUntilDate || r.endDate))
      : '-';

    var detailCols = ALL_COLUMNS.filter(function (col) {
      if (col.key !== 'customerIdNumber') return true;
      var u = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
      return !root.RGCrmCore || !root.RGCrmCore.canUserViewCustomerId || root.RGCrmCore.canUserViewCustomerId(u);
    });
    var detailRow = Object.assign({}, r, {
      assignedEmployeeNames: Array.isArray(r.assignedEmployeeNames) && r.assignedEmployeeNames.length
        ? r.assignedEmployeeNames.join('، ')
        : (isEn ? 'Unassigned' : 'متاح للاستلام')
    });
    var sheets = [{
      name: isEn ? 'Booking Summary' : 'بيانات الحجز',
      title: repTitle,
      periodText: periodTxt,
      summaryItems: [
        { label: isEn ? 'Days' : 'عدد الأيام', value: Number(r.daysCount || 0) },
        { label: isEn ? 'Total (SAR)' : 'الإجمالي', value: Number(r.totalAmount || 0) },
        { label: isEn ? 'Follow-Ups' : 'المتابعات', value: Array.isArray(details.followUps) ? details.followUps.length : 0 },
        { label: isEn ? 'Problems' : 'المشكلات', value: Array.isArray(details.problems) ? details.problems.length : 0 }
      ],
      headers: detailCols,
      rows: [detailRow]
    }];

    var exts = Array.isArray(details.extensions) ? details.extensions : [];
    if (exts.length) {
      sheets.push({
        name: isEn ? 'Extensions' : 'التمديدات',
        title: repTitle + ' — ' + (isEn ? 'Extensions' : 'التمديدات'),
        periodText: periodTxt,
        headers: [
          { key: 'extensionNumber', label: isEn ? 'Extension #' : 'رقم التمديد', formatType: 'ltr' },
          { key: 'extendDays', label: isEn ? 'Days' : 'الأيام', formatType: 'number', summable: true },
          { key: 'extendAmount', label: isEn ? 'Amount' : 'المبلغ', formatType: 'number', summable: true },
          { key: 'newEndDate', label: isEn ? 'New End Date' : 'تاريخ الانتهاء الجديد', formatType: 'date' },
          { key: 'status', label: isEn ? 'Status' : 'الحالة' },
          { key: 'notes', label: isEn ? 'Notes' : 'الملاحظات' }
        ],
        rows: exts
      });
    }

    var fus = Array.isArray(details.followUps) ? details.followUps : [];
    if (fus.length) {
      sheets.push({
        name: isEn ? 'Follow-Ups' : 'المتابعات',
        title: repTitle + ' — ' + (isEn ? 'Follow-Ups' : 'سجل المتابعات'),
        periodText: periodTxt,
        headers: [
          { key: 'employeeName', label: isEn ? 'Employee' : 'الموظف' },
          { key: 'status', label: isEn ? 'Status' : 'الحالة' },
          { key: 'action', label: isEn ? 'Action' : 'الإجراء' },
          { key: 'notes', label: isEn ? 'Notes' : 'الملاحظات' },
          { key: 'followUpDate', label: isEn ? 'Date' : 'التاريخ', formatType: 'date' },
          { key: 'followUpTime', label: isEn ? 'Time' : 'الوقت', formatType: 'time' }
        ],
        rows: fus
      });
    }

    var prbs = Array.isArray(details.problems) ? details.problems : [];
    if (prbs.length) {
      sheets.push({
        name: isEn ? 'Problems' : 'المشكلات',
        title: repTitle + ' — ' + (isEn ? 'Problems' : 'سجل المشكلات'),
        periodText: periodTxt,
        headers: [
          { key: 'problemNumber', label: isEn ? 'Ticket #' : 'رقم المشكلة', formatType: 'ltr' },
          { key: 'priority', label: isEn ? 'Priority' : 'الأولوية' },
          { key: 'status', label: isEn ? 'Status' : 'الحالة' },
          { key: 'employeeName', label: isEn ? 'Assigned To' : 'المسؤول' },
          { key: 'description', label: isEn ? 'Description & Notes' : 'وصف المشكلة والملاحظات' },
          { key: 'createdAt', label: isEn ? 'Created At' : 'تاريخ التسجيل', formatType: 'datetime' }
        ],
        rows: prbs
      });
    }

    await root.RGReports.exportExcelWorkbook(sheets, 'rental-gate-booking-' + (r.reservationNumber || r.id || 'file') + '.xlsx', {
      lang: ctx && ctx.lang,
      title: repTitle,
      periodText: periodTxt
    });
    if (ctx && ctx.toast) {
      ctx.toast(isEn ? 'Booking file exported to Excel.' : 'تم تصدير ملف الحجز إلى Excel بنجاح.');
    }
  }

  function openSingleReservationPdfModal(details, ctx, drawerCharts, onCancel) {
    var r = details.reservation;
    var isEn = ctx && ctx.lang === 'en';
    var capturedCharts = drawerCharts && drawerCharts.getImages ? drawerCharts.getImages() : [];
    var modalRoot = document.getElementById('modal-root');

    var initialSettings = (root.RGPdfControls && root.RGPdfControls.createDefaultState)
      ? root.RGPdfControls.createDefaultState({ paperSize: 'a4', orientation: 'portrait' }, 'single_reservation')
      : { targetPages: 2, preset: 'balanced', optimizeFileSize: true, quality: 'balanced', paperSize: 'a4', orientation: 'portrait' };

    function calcSingleStats() {
      var cCounters = document.getElementById('spdf-counters');
      var cCharts = document.getElementById('spdf-charts');
      var cFu = document.getElementById('spdf-followups');
      var cStages = document.getElementById('spdf-stages');
      var cProb = document.getElementById('spdf-problems');
      var cCust = document.getElementById('spdf-customer');
      var cBook = document.getElementById('spdf-booking');
      var cStaff = document.getElementById('spdf-staff');
      var cLast = document.getElementById('spdf-last');

      var incCounters = cCounters ? cCounters.checked : true;
      var incCharts = cCharts ? cCharts.checked : true;
      var incFu = cFu ? cFu.checked : true;
      var incStages = cStages ? cStages.checked : true;
      var incProb = cProb ? cProb.checked : true;
      var incCust = cCust ? cCust.checked : true;
      var incBook = cBook ? cBook.checked : true;
      var incStaff = cStaff ? cStaff.checked : true;
      var incLast = cLast ? cLast.checked : true;

      var summaryCount = (incCounters ? 5 : 0) + (incCust ? 1 : 0) + (incBook ? 3 : 0) + (incStaff ? 1 : 0) + (incLast ? 1 : 0);
      var stagesLen = Array.isArray(r.statusHistory) ? r.statusHistory.length : 0;
      var extLen = Array.isArray(details.extensions) ? details.extensions.length : 0;
      var fuLen = Array.isArray(details.followUps) ? details.followUps.length : 0;
      var probLen = (Array.isArray(details.problems) ? details.problems.length : 0) + (Array.isArray(details.problemUpdates) ? details.problemUpdates.length : 0);

      var secCount = (incStages && stagesLen ? 1 : 0) + (incBook && extLen ? 1 : 0) + (incFu && fuLen ? 1 : 0) + (incProb && probLen ? 1 : 0);
      var linesCount = (incStages ? stagesLen : 0) + (incBook ? extLen : 0) + (incFu ? fuLen : 0) + (incProb ? probLen : 0);
      return {
        rowCount: 0,
        columnCount: 0,
        kpiCount: summaryCount,
        wideSummaryCount: incCounters ? 2 : 0,
        extraSectionsCount: secCount,
        extraLinesCount: linesCount,
        chartCount: incCharts ? capturedCharts.length : 0
      };
    }

    var initStats = {
      rowCount: 0,
      columnCount: 0,
      kpiCount: 11,
      wideSummaryCount: 2,
      extraSectionsCount: (details.followUps.length ? 1 : 0) + (details.problems.length ? 1 : 0) + (details.extensions.length ? 1 : 0) + ((r.statusHistory && r.statusHistory.length) ? 1 : 0),
      extraLinesCount: details.followUps.length + details.problems.length + (details.problemUpdates ? details.problemUpdates.length : 0) + details.extensions.length + (r.statusHistory ? r.statusHistory.length : 0),
      chartCount: capturedCharts.length
    };

    var advancedExtras =
      '<div class="rg-pdf-adv-section">' +
        '<div class="form-group" style="margin-bottom:10px;">' +
          '<label class="form-label" for="spdf-title">' + (isEn ? 'Report Title' : 'عنوان التقرير') + '</label>' +
          '<input class="input" id="spdf-title" value="' + (isEn ? ('Reservation File #' + esc(r.reservationNumber)) : ('ملف الحجز رقم ' + esc(r.reservationNumber))) + '">' +
        '</div>' +
        '<div class="form-label" style="margin-bottom:8px;">' + (isEn ? 'Included Report Sections:' : 'اختر البيانات المراد تضمينها في التقرير:') + '</div>' +
        '<div class="checkbox-grid">' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-counters" checked> ' + (isEn ? 'Counters & Financial Summary' : 'العدادات والملخص المالي') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-charts" checked> ' + (isEn ? 'Mini Charts' : 'الرسوم البيانية المصغرة') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-followups" checked> ' + (isEn ? 'Follow-Ups' : 'المتابعات') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-stages" checked> ' + (isEn ? 'Status Stages' : 'مراحل تطور الحالة') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-notes" checked> ' + (isEn ? 'Notes' : 'الملاحظات') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-problems" checked> ' + (isEn ? 'Problems & Updates' : 'المشكلات وتحديثاتها') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-customer" checked> ' + (isEn ? 'Customer Details' : 'بيانات العميل') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-booking" checked> ' + (isEn ? 'Booking & Extensions' : 'بيانات الحجز والتمديدات') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-staff" checked> ' + (isEn ? 'Assigned Staff' : 'الموظفون المسؤولون') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="spdf-last" checked> ' + (isEn ? 'Last Update' : 'آخر تحديث') + '</label>' +
        '</div>' +
      '</div>';

    var controlsHtml = (root.RGPdfControls && root.RGPdfControls.renderPanelHtml)
      ? root.RGPdfControls.renderPanelHtml({
          mode: 'modal',
          idPrefix: 'rg-spdf-ctrl',
          lang: ctx.lang,
          scopeKey: 'single_reservation',
          settings: initialSettings,
          contentStats: initStats,
          advancedExtraHtml: advancedExtras
        })
      : advancedExtras;

    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="single-pdf-title">' +
        '<div class="modal-panel modal-panel-wide">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="single-pdf-title">' + (isEn ? ('PDF Export & Optimization — ' + esc(r.reservationNumber)) : ('إعدادات وتصدير PDF للحجز ' + esc(r.reservationNumber))) + '</h3>' +
            '<button type="button" class="btn btn-sm" id="spdf-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +
          '<div class="kpi-grid-4">' +
            '<div class="kpi-card"><span class="kpi-label">' + (isEn ? 'Days' : 'أيام الحجز') + '</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + Number(r.daysCount || 0) + '</span></div>' +
            '<div class="kpi-card kpi-success"><span class="kpi-label">' + (isEn ? 'Total (SAR)' : 'الإجمالي (ر.س)') + '</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + Number(r.totalAmount || 0) + '</span></div>' +
            '<div class="kpi-card"><span class="kpi-label">' + (isEn ? 'Follow-Ups' : 'المتابعات') + '</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + details.followUps.length + '</span></div>' +
            '<div class="kpi-card ' + (details.problems.length ? 'kpi-danger' : '') + '"><span class="kpi-label">' + (isEn ? 'Problems' : 'المشكلات') + '</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + details.problems.length + '</span></div>' +
          '</div>' +
          controlsHtml +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="spdf-download-btn">' + (isEn ? 'Download PDF' : 'تحميل PDF') + '</button>' +
            '<button type="button" class="btn btn-primary" id="spdf-export">' + (isEn ? 'Preview PDF' : 'معاينة PDF') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var pdfPanelEl = document.getElementById('rg-spdf-ctrl');
    var pdfCtrl = (root.RGPdfControls && pdfPanelEl)
      ? root.RGPdfControls.mount(pdfPanelEl, {
          lang: ctx.lang,
          scopeKey: 'single_reservation',
          initialSettings: initialSettings,
          contentStats: initStats
        })
      : null;

    modalRoot.querySelectorAll('#rg-spdf-ctrl input[type="checkbox"]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        if (pdfCtrl) pdfCtrl.setContentStats(calcSingleStats());
      });
    });

    document.getElementById('spdf-close').addEventListener('click', function () {
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });

    function createSinglePdfSnapshot() {
      var baseSettings = pdfCtrl ? pdfCtrl.getSettings() : initialSettings;
      var incCounters = document.getElementById('spdf-counters').checked;
      var incCharts = document.getElementById('spdf-charts').checked;
      var incFollowUps = document.getElementById('spdf-followups').checked;
      var incStages = document.getElementById('spdf-stages') ? document.getElementById('spdf-stages').checked : true;
      var incNotes = document.getElementById('spdf-notes').checked;
      var incProblems = document.getElementById('spdf-problems').checked;
      var incCustomer = document.getElementById('spdf-customer').checked;
      var incBooking = document.getElementById('spdf-booking').checked;
      var incStaff = document.getElementById('spdf-staff').checked;
      var incLast = document.getElementById('spdf-last').checked;
      var spdfTitleVal = document.getElementById('spdf-title').value || ('ملف الحجز رقم ' + r.reservationNumber);
      var spdfFilename = 'reservation-' + r.reservationNumber + '.pdf';

      var summary = [];
      var spdfExtCount = Number(r.extensionsCount || (details.extensions ? details.extensions.length : 0) || 0);
      var spdfTotalDays = Number(r.totalDaysCount || r.daysCount || 0);
      if (incCounters) {
        summary.push({ label: 'أيام الحجز', value: spdfTotalDays + ' يوم (' + Number(r.daysCount || 1) + ' + ' + Number(r.extendedDaysCount || 0) + ' تمديد)' });
        summary.push({ label: 'التمديدات', value: spdfExtCount + ' مرات · ' + Number(r.extensionsAmount || 0) + ' ر.س' });
        summary.push({ label: 'الأساسي / التمديد / الإجمالي', value: r.baseAmount + ' + ' + r.extensionsAmount + ' = ' + r.totalAmount + ' ر.س' });
        summary.push({ label: 'عداد المتابعات', value: details.followUps.length });
        summary.push({ label: 'عداد المشكلات', value: details.problems.length });
      }
      if (incCustomer) {
        summary.push({ label: 'العميل', value: r.customerName + ' (' + r.customerPhone + ')' });
      }
      if (incBooking) {
        summary.push({ label: 'الشركة والفرع', value: r.companyName + ' — ' + r.branchName });
        summary.push({ label: 'السيارة والفترة', value: r.carName + ' | ' + formatDateOnly(r.startDate) + ' → ' + formatDateOnly(r.endDate) + (r.extendedUntilDate ? ' (ممدد لحد ' + formatDateOnly(r.extendedUntilDate) + ')' : '') });
        summary.push({ label: 'الدفع والحالة', value: (r.paymentMethod || '-') + ' (' + (r.paymentStatus || '-') + ') | ' + r.originalStatusAr });
      }
      if (incStaff) {
        summary.push({ label: 'الموظفون المسؤولون', value: (r.assignedEmployeeNames || []).join('، ') || 'غير مسند' });
      }
      if (incLast) {
        summary.push({ label: 'آخر تحديث', value: r.lastUpdatedByName + ': ' + r.lastUpdateText });
      }

      var extraSections = [];
      var pdfStages = (root.RGCrmCore && root.RGCrmCore.normalizeStatusHistory)
        ? root.RGCrmCore.normalizeStatusHistory(r.statusHistory)
        : (Array.isArray(r.statusHistory) ? r.statusHistory : []);
      if (incStages && pdfStages.length) {
        extraSections.push({
          title: 'مراحل الحالة وتطور الحجز (' + pdfStages.length + ')',
          lines: pdfStages.map(function (st, idx) {
            return 'المرحلة ' + (st.stageNumber || (idx + 1)) + ' | ' +
              (st.previousStatus ? (st.previousStatus + ' ← ') : '') + st.newStatus +
              ' | ' + (st.changedByName || 'النظام') + ' (' + formatTimestamp(st.changedAt) + ')' +
              (st.note ? ' — ' + st.note : '');
          })
        });
      }
      if (incBooking && details.extensions.length) {
        extraSections.push({
          title: 'سجل وتفاصيل التمديدات المعتمدة والمدفوعة (' + details.extensions.length + ')',
          lines: details.extensions.map(function (ex, idx) {
            return '#' + (ex.sequenceNumber || (idx + 1)) + ' | ' + ex.extensionNumber +
              (ex.extensionTypeAr ? ' (' + ex.extensionTypeAr + ')' : '') +
              ' | ' + ex.extendDays + ' يوم (' + formatDateOnly(ex.startDate) + ' → ' + formatDateOnly(ex.endDate) + ') | ' + ex.amount + ' ر.س' +
              (ex.paymentMethod ? ' — ' + ex.paymentMethod : '');
          })
        });
      }
      if (incFollowUps && details.followUps.length) {
        extraSections.push({
          title: 'سجل المتابعات (' + details.followUps.length + ')',
          lines: details.followUps.map(function (f) {
            return formatDateOnly(f.followUpDate) + ' ' + formatTimeOnly(f.followUpTime, ctx.lang) + ' | ' + f.employeeName + ' [' + f.status + ']: ' + f.action + (incNotes && f.notes ? ' — ملاحظة: ' + f.notes : '');
          })
        });
      } else if (incNotes) {
        var noteLines = details.followUps.filter(function (f) { return Boolean(f.notes); }).map(function (f) {
          return formatDateOnly(f.followUpDate) + ' | ' + f.employeeName + ': ' + f.notes;
        });
        if (noteLines.length) {
          extraSections.push({
            title: 'الملاحظات المسجلة (' + noteLines.length + ')',
            isNotes: true,
            lines: noteLines
          });
        }
      }
      if (incNotes && !incFollowUps) {
        // already handled above; if incFollowUps is checked and there are standalone note lines, also offer notes block
      }
      if (incNotes && incFollowUps) {
        var dedicatedNotes = details.followUps.filter(function (f) { return Boolean(f.notes); }).map(function (f) {
          return formatDateOnly(f.followUpDate) + ' | ' + f.employeeName + ':\n' + f.notes;
        });
        if (dedicatedNotes.length) {
          extraSections.push({
            title: 'ملاحظات الحجز الكاملة (' + dedicatedNotes.length + ')',
            isNotes: true,
            lines: dedicatedNotes
          });
        }
      }
      if (incProblems && details.problems.length) {
        extraSections.push({
          title: 'المشكلات المرتبطة وتحديثاتها (' + details.problems.length + ')',
          lines: details.problems.map(function (p) {
            return p.problemNumber + ' [' + p.priority + ' / ' + p.status + ']: ' + p.description;
          }).concat((details.problemUpdates || []).map(function (u) {
            return 'تحديث (' + u.employeeName + '): ' + u.newStatus + ' — ' + u.note;
          }))
        });
      }

      var statsSnapshot = {
        rowCount: 0,
        columnCount: 0,
        kpiCount: summary.length,
        wideSummaryCount: incCounters ? 2 : 0,
        extraSectionsCount: extraSections.length,
        extraLinesCount: extraSections.reduce(function (sum, sec) { return sum + (sec.lines ? sec.lines.length : 0); }, 0),
        chartCount: incCharts ? capturedCharts.length : 0
      };

      return {
        title: spdfTitleVal,
        filename: spdfFilename,
        baseSettings: baseSettings,
        stats: statsSnapshot,
        generate: function (liveSettings, signal, previewMode) {
          var s = Object.assign({}, baseSettings, liveSettings || {});
          var user = root.RGAuth.getUser();
          return root.RGReports.exportArabicPdfDocument(Object.assign({}, s, {
            title: spdfTitleVal,
            scopeKey: 'single_reservation',
            lang: ctx.lang,
            exporterName: user ? user.name : '',
            summaryItems: summary,
            extraSections: extraSections,
            chartImages: incCharts ? capturedCharts : [],
            filename: spdfFilename,
            signal: signal,
            previewOnly: Boolean(previewMode)
          }));
        }
      };
    }

    var spdfExportBtn = document.getElementById('spdf-export');
    spdfExportBtn.addEventListener('click', function () {
      var snap = createSinglePdfSnapshot();
      runWithLock(spdfExportBtn, 'singlePdf:' + r.id, async function () {
        if (root.RGPdfPreview && typeof root.RGPdfPreview.open === 'function') {
          await root.RGPdfPreview.open({
            title: snap.title,
            filename: snap.filename,
            scopeKey: 'single_reservation',
            initialSettings: snap.baseSettings,
            getContentStats: function () { return snap.stats; },
            generatePdf: function (liveSettings, signal) {
              return snap.generate(liveSettings, signal, true);
            },
            onSettingsChange: function (nextSettings) {
              if (pdfCtrl) pdfCtrl.setSettings(nextSettings, true);
            },
            onDownloadToast: function (meta) {
              var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
              ctx.toast(isEn
                ? ('Downloaded reservation PDF (' + meta.pages + ' pages · ' + kb + ' KB).')
                : ('تم تحميل ملف الحجز PDF (' + meta.pages + ' صفحة · ' + kb + ' KB).'));
            }
          });
        } else {
          await snap.generate(snap.baseSettings, null, false);
          ctx.toast('تم تصدير ملف الحجز بصيغة PDF مع العدادات والرسوم البيانية.');
          if (onCancel) onCancel();
          else modalRoot.innerHTML = '';
        }
      });
    });

    var spdfDlBtn = document.getElementById('spdf-download-btn');
    if (spdfDlBtn) {
      spdfDlBtn.addEventListener('click', function () {
        var snap = createSinglePdfSnapshot();
        runWithLock(spdfDlBtn, 'singlePdfDl:' + r.id, async function () {
          var meta = await snap.generate(snap.baseSettings, null, false);
          var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
          ctx.toast(isEn
            ? ('Downloaded reservation PDF (' + meta.pages + ' pages · ' + kb + ' KB).')
            : ('تم تصدير ملف الحجز PDF (' + meta.pages + ' صفحة · ' + kb + ' KB).'));
          if (onCancel) onCancel();
          else modalRoot.innerHTML = '';
        });
      });
    }
  }

  function openImportExcelModal(ctx, onImported, knownExistingRows) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var isEn = ctx && ctx.lang === 'en';
    var currentUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var loadedRawRows = [];
    var parsedPreview = null;

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="import-excel-modal" role="dialog" aria-modal="true" aria-labelledby="imp-xls-title">' +
        '<div class="modal-panel" style="max-width:780px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="imp-xls-title">' + (isEn ? 'Import Reservations from Excel' : 'استيراد حجوزات من ملف Excel') + '</h3>' +
              '<p class="section-subtitle">' + (isEn ? 'Supports .xlsx, .xls, or .csv with Arabic or English headers (automatically updates matching Reservation # or adds new ones).' : 'يدعم ملفات .xlsx و .xls و .csv بالعناوين العربية أو الإنجليزية (يُحدّث أرقام الحجوزات الموجودة تلقائياً ويضيف الجديدة).') + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="imp-xls-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<div class="form-group">' +
              '<label class="form-label" for="res-imp-file">' + (isEn ? 'Select Excel File' : 'اختر ملف الحجوزات (.xlsx / .xls / .csv)') + '</label>' +
              '<input type="file" class="input" id="res-imp-file" accept=".xlsx,.xls,.csv">' +
            '</div>' +
            '<div id="res-imp-summary" class="hidden" style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);"></div>' +
            '<div id="res-imp-preview" class="hidden"></div>' +
            '<div id="res-imp-error" class="form-error hidden"></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="imp-xls-cancel">' + (isEn ? 'Cancel' : 'إلغاء') + '</button>' +
            '<button type="button" class="btn btn-primary" id="res-imp-submit" disabled>' + (isEn ? 'Confirm Import' : 'تأكيد استيراد الحجوزات') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var fileInput = document.getElementById('res-imp-file');
    var sumEl = document.getElementById('res-imp-summary');
    var prevEl = document.getElementById('res-imp-preview');
    var errEl = document.getElementById('res-imp-error');
    var submitBtn = document.getElementById('res-imp-submit');

    function closeModal() {
      modalRoot.innerHTML = '';
    }
    document.getElementById('imp-xls-close').addEventListener('click', closeModal);
    document.getElementById('imp-xls-cancel').addEventListener('click', closeModal);

    fileInput.addEventListener('change', async function () {
      errEl.classList.add('hidden');
      errEl.textContent = '';
      sumEl.classList.add('hidden');
      prevEl.classList.add('hidden');
      submitBtn.disabled = true;
      loadedRawRows = [];
      parsedPreview = null;

      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        if (!root.RGReports || !root.RGReports.readExcelWorkbookRows) {
          throw new Error('وحدة قراءة Excel غير جاهزة.');
        }
        var wbData = await root.RGReports.readExcelWorkbookRows(file);
        loadedRawRows = wbData.rows || [];
        if (!loadedRawRows.length) {
          throw new Error('الملف لا يحتوي على أي صفوف بيانات.');
        }
        if (root.RGCrmCore && root.RGCrmCore.parseImportedReservationRows) {
          parsedPreview = root.RGCrmCore.parseImportedReservationRows(
            loadedRawRows,
            Array.isArray(knownExistingRows) ? knownExistingRows : [],
            currentUser
          );
        } else {
          parsedPreview = { totalRead: loadedRawRows.length, validRows: loadedRawRows, skippedRows: 0, newCount: loadedRawRows.length, updateCount: 0, errors: [] };
        }

        sumEl.innerHTML =
          '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;">' +
            '<span><strong>' + (isEn ? 'Sheet:' : 'الورقة:') + '</strong> ' + esc(wbData.sheetName || '-') + '</span>' +
            '<span><strong>' + (isEn ? 'Total rows:' : 'إجمالي الصفوف:') + '</strong> <span class="tabular-nums">' + parsedPreview.totalRead + '</span></span>' +
            '<span style="color:var(--status-success-text);"><strong>' + (isEn ? 'Valid:' : 'صالح للاستيراد:') + '</strong> <span class="tabular-nums">' + parsedPreview.validRows.length + '</span></span>' +
            '<span><strong>' + (isEn ? 'New:' : 'جديد:') + '</strong> <span class="tabular-nums">' + parsedPreview.newCount + '</span></span>' +
            '<span><strong>' + (isEn ? 'Updates:' : 'تحديث:') + '</strong> <span class="tabular-nums">' + parsedPreview.updateCount + '</span></span>' +
            (parsedPreview.skippedRows ? '<span style="color:var(--status-warning-text);"><strong>' + (isEn ? 'Skipped:' : 'تم تخطيه:') + '</strong> <span class="tabular-nums">' + parsedPreview.skippedRows + '</span></span>' : '') +
          '</div>';
        sumEl.classList.remove('hidden');

        if (parsedPreview.validRows.length > 0) {
          var sample = parsedPreview.validRows.slice(0, 5);
          prevEl.innerHTML =
            '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>رقم الحجز</th><th>العميل</th><th>الجوال</th><th>السيارة</th><th>الشركة</th><th>البداية</th><th>الإجمالي</th><th>الحالة</th>' +
            '</tr></thead><tbody>' +
              sample.map(function (r) {
                return '<tr>' +
                  '<td class="mono" dir="ltr">' + esc(r.reservationNumber) + '</td>' +
                  '<td>' + esc(r.customerName) + '</td>' +
                  '<td class="mono" dir="ltr">' + esc(r.customerPhone || '-') + '</td>' +
                  '<td>' + esc(r.carName) + '</td>' +
                  '<td>' + esc(r.companyName) + '</td>' +
                  '<td class="mono" dir="ltr">' + esc(r.startDate) + '</td>' +
                  '<td class="tabular-nums">' + Number(r.totalAmount || 0) + '</td>' +
                  '<td><span class="status-tag status-info">' + esc(r.internalStatus) + '</span></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>' +
            (parsedPreview.validRows.length > 5 ? '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">يتم عرض أول 5 سجلات فقط للمعاينة من أصل ' + parsedPreview.validRows.length + ' سجل.</div>' : '');
          prevEl.classList.remove('hidden');
          submitBtn.disabled = false;
        } else {
          errEl.textContent = 'لم يتم العثور على صفوف صالحة تحتوي على رقم حجز أو اسم عميل.';
          errEl.classList.remove('hidden');
        }
      } catch (err) {
        errEl.textContent = (err && err.message) || 'تعذر قراءة ملف Excel.';
        errEl.classList.remove('hidden');
      }
    });

    submitBtn.addEventListener('click', function () {
      if (!loadedRawRows.length) return;
      runWithLock(submitBtn, 'importReservationsFromExcel', async function () {
        var prevTxt = submitBtn.textContent;
        submitBtn.textContent = isEn ? 'Importing...' : 'جاري استيراد الحجوزات...';
        try {
          var res = await root.RGApi.callApi('importReservationsFromExcel', { rows: loadedRawRows });
          if (res && res.success && res.data) {
            closeModal();
            if (ctx && ctx.refreshNotifications) ctx.refreshNotifications();
            if (ctx && ctx.toast) {
              ctx.toast(res.message || ('تم استيراد ' + (res.data.importedCount || 0) + ' حجز وتحديث ' + (res.data.updatedCount || 0) + ' حجز بنجاح.'));
            }
            if (typeof onImported === 'function') onImported(res.data);
          } else {
            errEl.textContent = (res && res.message) || 'تعذر استيراد ملف الحجوزات.';
            errEl.classList.remove('hidden');
          }
        } finally {
          if (submitBtn.isConnected !== false) submitBtn.textContent = prevTxt;
        }
      });
    });
  }

  root.RGReservations = {
    render: render,
    openReservationDrawer: openReservationDrawer,
    openImportExcelModal: openImportExcelModal
  };
})(window);
