/**
 * RENTAL GATE CRM — Reservations Grid, Self-Claim, Quick Status, Supervisor Controls & PDF Export
 */
(function (root) {
  'use strict';

  var ALL_COLUMNS = [
    { key: 'reservationNumber', label: 'رقم الحجز' },
    { key: 'customerName', label: 'اسم العميل' },
    { key: 'customerPhone', label: 'الجوال' },
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

  function loadSavedVisibleCols() {
    try {
      var parsed = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) || 'null');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_e) {}
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

  function runWithLock(btnEl, lockKey, fn) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn);
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

    var defaultCols = loadSavedVisibleCols();
    var state = Object.assign({
      search: '', company: '', branch: '', status: '', employeeId: '', priority: '',
      dateFrom: '', dateTo: '', timeField: 'both', timeFrom: '', timeTo: '',
      unfollowedOnly: false, hasProblemsOnly: false, overdueUnpaidOnly: false,
      sortBy: 'lastUpdatedAt', sortDir: 'desc', page: 1, pageSize: 20,
      visibleCols: defaultCols,
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
    if (state.viewMode !== 'radar' && state.viewMode !== 'today') state.viewMode = 'all';
    ctx.state.reservations = state;

    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps = Boolean(empState && empState.loaded && Array.isArray(empState.items) && empState.items.length > 0);
    var [empRes, resData] = await Promise.all([
      hasPreloadedEmps ? Promise.resolve({ success: true, data: { items: empState.items } }) : root.RGApi.callApi('getEmployees', {}),
      root.RGApi.callApi('getReservations', state)
    ]);

    var employees = (empRes.success && empRes.data.items) || [];
    var payload = (resData.success && resData.data) || { items: [], total: 0, page: 1, totalPages: 1, facets: { companies: [], branches: [] } };
    var currentItems = payload.items || [];
    var currentTotalPages = payload.totalPages || 1;
    var facets = payload.facets || { companies: [], branches: [] };

    var canPullReservations = Boolean(currentUser && root.RGCrmCore.canUserPerform(currentUser, 'pull_reservations'));
    var canImportExcel = Boolean(currentUser && (canPullReservations || root.RGCrmCore.canUserPerform(currentUser, 'manage_settings')));
    var isGeneralManager = Boolean(currentUser && currentUser.role === root.RGCrmCore.ROLES.GENERAL_MANAGER);
    var pullPresets = (root.RGCrmCore && root.RGCrmCore.PULL_DURATION_PRESETS) || [];
    var pullPresetState = state.pullPreset || 'all';

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">' + t('nav_reservations') + '</h2>' +
            '<p class="section-subtitle">' + (isEn ? 'Matching results:' : 'إجمالي النتائج المطابقة:') + ' <strong class="tabular-nums" id="res-total-count">' + payload.total + '</strong> · ' + (isEn ? 'Claim bookings, track today\'s pickups/returns, or monitor 24h expiry radar' : 'يمكنك استلام أي حجز، متابعة جدول التسليم والاستلام لليوم، أو مراقبة رادار الانتهاء') + '</p>' +
          '</div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            (root.RGHandover ? '<button type="button" class="btn btn-sm" id="res-handover-btn">' + (isEn ? 'Shift Handover (PDF)' : 'تسليم الوردية (PDF)') + '</button>' : '') +
            (canPullReservations ? '<button type="button" class="btn btn-charcoal" id="res-pull-btn" title="جلب أحدث الحجوزات والتمديدات">' + t('pull_reservations') + '</button>' : '') +
            (canImportExcel ? '<button type="button" class="btn" id="res-import-xlsx">' + (isEn ? 'Import Excel' : 'استيراد من Excel') + '</button>' : '') +
            '<button type="button" class="btn" id="res-cols-btn">' + t('toggle_columns') + '</button>' +
            '<button type="button" class="btn btn-primary" id="res-export-xlsx">' + t('export_excel') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="res-view-tabs" role="tablist" aria-label="' + (isEn ? 'Reservations View' : 'عرض الحجوزات') + '">' +
          '<button type="button" class="res-view-tab' + (state.viewMode === 'all' ? ' is-active' : '') + '" data-res-view="all" role="tab" aria-selected="' + (state.viewMode === 'all') + '">' +
            (isEn ? 'All Reservations' : 'كل الحجوزات') +
          '</button>' +
          '<button type="button" class="res-view-tab' + (state.viewMode === 'today' ? ' is-active' : '') + '" data-res-view="today" role="tab" aria-selected="' + (state.viewMode === 'today') + '">' +
            '<span>' + (isEn ? 'Today\'s Pickups & Returns' : 'التسليم والاستلام اليوم') + '</span>' +
            '<span class="res-tab-count tabular-nums" data-testid="today-tab-count" id="res-today-tab-count">0</span>' +
          '</button>' +
          '<button type="button" class="res-view-tab' + (state.viewMode === 'radar' ? ' is-active' : '') + '" data-res-view="radar" role="tab" aria-selected="' + (state.viewMode === 'radar') + '">' +
            '<span>' + (isEn ? '24h Expiry Radar' : 'رادار انتهاء الحجوزات (24 ساعة)') + '</span>' +
            '<span class="res-tab-count tabular-nums" data-testid="radar-tab-count" id="res-radar-tab-count">0</span>' +
          '</button>' +
        '</div>' +
        '<div id="res-all-view"' + (state.viewMode !== 'all' ? ' class="hidden"' : '') + '>' +
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
          '<div class="filter-grid filter-grid-4">' +
            '<input type="search" class="input" id="res-search" placeholder="' + t('search_placeholder') + '" value="' + esc(state.search || '') + '">' +
            '<select class="select" id="res-company" aria-label="' + t('company') + '"><option value="">' + t('all_companies') + '</option>' +
              facets.companies.map(function (c) { return '<option value="' + esc(c) + '"' + (state.company === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-branch" aria-label="' + t('branch') + '"><option value="">' + t('all_branches') + '</option>' +
              facets.branches.map(function (b) { return '<option value="' + esc(b) + '"' + (state.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-status" aria-label="' + t('status') + '"><option value="">' + t('all_statuses') + '</option>' +
              (root.RGCrmCore.WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) { return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select" id="res-emp" aria-label="' + t('employee') + '"><option value="">' + t('all_employees') + '</option>' +
              employees.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.employeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') +
            '</select>' +
            '<select class="select rg-ui-res-extra-filter" id="res-prio" aria-label="' + t('priority') + '"><option value="">' + t('all_priorities') + '</option>' +
              root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + esc(p) + '"' + (state.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
            '</select>' +
            '<input type="date" class="input rg-ui-res-extra-filter" id="res-from" data-rg-range-pair="res-filter-range" data-rg-range-role="start" value="' + esc(state.dateFrom || '') + '" aria-label="' + t('from_date') + '">' +
            '<input type="date" class="input rg-ui-res-extra-filter" id="res-to" data-rg-range-pair="res-filter-range" data-rg-range-role="end" value="' + esc(state.dateTo || '') + '" aria-label="' + t('to_date') + '">' +
          '</div>' +
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
              ALL_COLUMNS.map(function (col) {
                var checked = state.visibleCols.indexOf(col.key) !== -1 ? 'checked' : '';
                return '<label class="checkbox-item"><input type="checkbox" class="res-col-toggle" value="' + col.key + '" ' + checked + '> ' + col.label + '</label>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div id="res-table-region"></div>' +
        '</div>' +
        '<div id="res-today-view"' + (state.viewMode === 'today' ? '' : ' class="hidden"') + '></div>' +
        '<div id="res-radar-view"' + (state.viewMode === 'radar' ? '' : ' class="hidden"') + '></div>' +
      '</div>';

    var activeFetchSeq = 0;

    function buildTableRegionHtml(data) {
      var list = data.items || [];
      var visibleCols = ALL_COLUMNS.filter(function (c) { return state.visibleCols.indexOf(c.key) !== -1; });
      var colVisible = {};
      visibleCols.forEach(function (c) { colVisible[c.key] = true; });
      return (list.length === 0
        ? '<div class="empty-state">لا توجد حجوزات مطابقة للفلاتر الحالية.</div>'
        : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            visibleCols.map(function (c) {
              var arrow = state.sortBy === c.key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
              return '<th class="sortable" data-sort="' + c.key + '">' + c.label + arrow + '</th>';
            }).join('') +
            '<th>إجراءات</th>' +
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
                  if (extCount > 0) badgeHtml += '<span class="status-tag status-info tabular-nums">تمديد ×' + extCount + '</span>';
                  if (r.hasProblem) badgeHtml += '<span class="status-tag status-danger">مشكلة</span>';
                  if (overdueInfo && overdueInfo.isOverdueUnpaid) {
                    badgeHtml += '<span class="rg-overdue-badge" title="' + esc(isEn ? 'Overdue return without paid extension' : 'متأخرة عن الإرجاع بدون تمديد مدفوع') + '">⏰ <span dir="ltr">' + esc(isEn ? overdueInfo.labelEn : overdueInfo.labelAr) + '</span></span>';
                  }
                  if (colleagueLock) {
                    badgeHtml += '<span class="rg-softlock-chip" title="' + esc(isEn ? ('Editing by ' + colleagueLock.lockedByName) : ('يتابعه حالياً: ' + colleagueLock.lockedByName)) + '">🔒 ' + esc(colleagueLock.lockedByName) + '</span>';
                  }
                  return '<td class="mono cell-res-num">' +
                    '<div class="cell-res-head"><button type="button" class="btn-link-inline btn-open-res" dir="ltr" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber) + '</button></div>' +
                    (badgeHtml ? '<div class="cell-badges">' + badgeHtml + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'customerName') {
                  var showSubPhone = !colVisible.customerPhone && r.customerPhone;
                  return '<td class="cell-customer">' +
                    '<div class="cell-primary">' + esc(r.customerName || '-') + '</div>' +
                    (showSubPhone ? '<div class="cell-sub"><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span></div>' : '') +
                  '</td>';
                }
                if (c.key === 'customerPhone') {
                  return '<td class="mono"><span class="cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></td>';
                }
                if (c.key === 'carName') {
                  var carLabel = formatCarNameDisplay(r.carName);
                  var metaParts = [];
                  if (!colVisible.companyName && r.companyName) metaParts.push(r.companyName);
                  if (!colVisible.branchName && r.branchName) metaParts.push(r.branchName);
                  return '<td class="cell-car">' +
                    '<div class="cell-primary cell-car-name" title="' + esc(r.carName || '') + '">' + esc(carLabel) + '</div>' +
                    (metaParts.length ? '<div class="cell-sub">' + esc(metaParts.join(' · ')) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'originalStatusAr') {
                  return '<td><span class="status-tag ' + statusClass(r.originalStatusAr) + '">' + esc(r.originalStatusAr || '-') + '</span></td>';
                }
                if (c.key === 'internalStatus') {
                  var subAssignee = !colVisible.assignedEmployeeNames
                    ? (assignedNames.length ? assignedNames.join('، ') : 'متاح للاستلام')
                    : '';
                  return '<td>' +
                    '<select class="quick-status-select tbl-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة الحجز ' + esc(r.reservationNumber) + '">' +
                      (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
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
                  var totStartDays = Number(r.totalDaysCount || r.daysCount || 1);
                  var periodParts = [];
                  if (!colVisible.endDate && r.endDate) periodParts.push('حتى ' + formatDateOnly(r.endDate));
                  if (!colVisible.daysCount) periodParts.push(totStartDays + ' يوم');
                  return '<td class="tabular-nums" style="white-space:nowrap;">' +
                    '<div class="cell-primary mono" dir="ltr">' + esc(formatDateOnly(r.startDate)) + (r.startTime ? ' <span class="time-sub">' + esc(formatTimeOnly(r.startTime, ctx.lang)) + '</span>' : '') + '</div>' +
                    (periodParts.length ? '<div class="cell-sub">' + esc(periodParts.join(' · ')) + '</div>' : '') +
                  '</td>';
                }
                if (c.key === 'endDate') {
                  var endTm = r.endTime || r.originalEndTime || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;"><div>' + esc(formatDateOnly(r.endDate)) + '</div>' +
                    (endTm ? '<div class="time-sub" dir="ltr">' + esc(formatTimeOnly(endTm, ctx.lang)) + '</div>' : '') + '</td>';
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
                  return '<td class="mono tabular-nums" style="white-space:nowrap;"><div>' + esc(formatDateOnly(r.extendedUntilDate)) + '</div>' +
                    (r.extendedUntilTime ? '<div class="time-sub" dir="ltr">' + esc(formatTimeOnly(r.extendedUntilTime, ctx.lang)) + '</div>' : '') + '</td>';
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

              var claimBtnHtml = isMine
                ? '<button type="button" class="btn btn-sm btn-danger btn-unclaim-res" data-id="' + esc(r.id) + '" title="إلغاء الاستلام من حسابك">مستلم ✓ · إلغاء</button>'
                : '<button type="button" class="btn btn-sm btn-charcoal btn-claim-res" data-id="' + esc(r.id) + '" title="استلام الحجز عندي للمتابعة">استلام عندي</button>';

              return '<tr data-res-id="' + esc(r.id) + '" class="' + (overdueInfo && overdueInfo.isOverdueUnpaid ? 'is-overdue-unpaid' : '') + '">' + tds +
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

      region.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var col = th.getAttribute('data-sort');
          if (state.sortBy === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortBy = col; state.sortDir = 'desc'; }
          refreshTableRegion();
        });
      });

      var prevBtn = region.querySelector('#res-prev');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (state.page > 1) { state.page--; refreshTableRegion(); }
        });
      }
      var nextBtn = region.querySelector('#res-next');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (state.page < currentTotalPages) { state.page++; refreshTableRegion(); }
        });
      }

      region.querySelectorAll('.tbl-quick-status').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var rid = sel.getAttribute('data-id');
          var nextStatus = sel.value;
          runWithLock(sel, 'quickUpdateReservationStatus:' + rid, function () {
            var nowIso = new Date().toISOString();
            var actionText = 'تحديث سريع للحالة إلى: ' + nextStatus;
            currentItems = currentItems.map(function (item) {
              if (item.id !== rid) return item;
              return Object.assign({}, item, {
                internalStatus: nextStatus,
                lastUpdateText: actionText,
                lastUpdatedById: currentEmpId || item.lastUpdatedById,
                lastUpdatedByName: (currentUser && currentUser.name) || item.lastUpdatedByName,
                lastUpdatedAt: nowIso,
                isFollowed: true
              });
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
                reservationId: rid,
                status: nextStatus
              }, currentUser);
            }
            paintCurrentItems();
            ctx.toast('تم تحديث حالة الحجز إلى: ' + nextStatus);
            return root.RGApi.callApi('quickUpdateReservationStatus', {
              reservationId: rid,
              status: nextStatus,
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || 'تعذر تحديث حالة الحجز.', true);
                refreshTableRegion();
              }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء تحديث الحالة.', true);
              refreshTableRegion();
            });
          });
        });
      });

      region.querySelectorAll('.btn-claim-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          runWithLock(btn, 'claimReservation:' + rid, function () {
            currentItems = currentItems.map(function (item) {
              if (item.id !== rid) return item;
              var claimed = root.RGCrmCore.claimReservationRecord(item, currentUser);
              return Object.assign({}, item, {
                assignedEmployeeIds: claimed.assignedEmployeeIds,
                assignedEmployeeNames: claimed.assignedEmployeeNames
              });
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('claimReservation', { reservationId: rid }, currentUser);
            }
            paintCurrentItems();
            ctx.toast('تم استلام الحجز في قائمتك بنجاح.');
            return root.RGApi.callApi('claimReservation', {
              reservationId: rid,
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true);
                refreshTableRegion();
              }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء استلام الحجز.', true);
              refreshTableRegion();
            });
          });
        });
      });

      region.querySelectorAll('.btn-unclaim-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          runWithLock(btn, 'unclaimReservation:' + rid, function () {
            currentItems = currentItems.map(function (item) {
              if (item.id !== rid) return item;
              var unclaimed = root.RGCrmCore.unclaimReservationRecord(item, currentEmpId);
              return Object.assign({}, item, {
                assignedEmployeeIds: unclaimed.assignedEmployeeIds,
                assignedEmployeeNames: unclaimed.assignedEmployeeNames
              });
            });
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('unclaimReservation', { reservationId: rid }, currentUser);
            }
            paintCurrentItems();
            ctx.toast('تم إلغاء استلام الحجز.');
            return root.RGApi.callApi('unclaimReservation', {
              reservationId: rid,
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
              } else {
                ctx.toast((resp && resp.message) || 'تعذر إلغاء استلام الحجز.', true);
                refreshTableRegion();
              }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم أثناء إلغاء الاستلام.', true);
              refreshTableRegion();
            });
          });
        });
      });

      region.querySelectorAll('.btn-open-res').forEach(function (btn) {
        var rid = btn.getAttribute('data-id');
        btn.addEventListener('click', function () {
          openReservationDrawer(rid, ctx, employees, function () {
            refreshTableRegion();
          });
        });
      });
    }

    function paintTableRegion(data) {
      var region = container.querySelector('#res-table-region');
      if (!region) return;
      currentItems = data.items || [];
      currentTotalPages = data.totalPages || 1;
      var totalEl = container.querySelector('#res-total-count');
      if (totalEl) totalEl.textContent = String(data.total || 0);
      region.innerHTML = buildTableRegionHtml(data);
      bindTableRegionEvents(region);
    }

    function paintCurrentItems() {
      paintTableRegion({
        items: currentItems,
        total: Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length),
        page: state.page,
        totalPages: currentTotalPages
      });
    }

    async function refreshTableRegion(opts) {
      var seq = ++activeFetchSeq;
      var queryPayload = (opts && opts.forceRefresh)
        ? Object.assign({}, state, { forceRefresh: true })
        : state;
      var resp = await root.RGApi.callApi('getReservations', queryPayload);
      if (seq !== activeFetchSeq) return;
      if (resp && resp.success && resp.data) {
        paintTableRegion(resp.data);
      }
    }

    paintTableRegion(payload);

    function applyFilterChange() {
      state.search = document.getElementById('res-search').value;
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
      refreshTableRegion();
    }

    var searchTimer = null;
    document.getElementById('res-search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilterChange, 220);
    });

    ['res-company', 'res-branch', 'res-status', 'res-emp', 'res-prio', 'res-from', 'res-to', 'res-time-field', 'res-time-from', 'res-time-to', 'res-unfollowed', 'res-problems', 'res-overdue-unpaid'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', applyFilterChange);
    });

    document.getElementById('res-reset-filters').addEventListener('click', function () {
      Object.assign(state, { search: '', company: '', branch: '', status: '', employeeId: '', priority: '', dateFrom: '', dateTo: '', timeField: 'both', timeFrom: '', timeTo: '', unfollowedOnly: false, hasProblemsOnly: false, overdueUnpaidOnly: false, page: 1 });
      document.getElementById('res-search').value = '';
      document.getElementById('res-company').value = '';
      document.getElementById('res-branch').value = '';
      document.getElementById('res-status').value = '';
      document.getElementById('res-emp').value = '';
      document.getElementById('res-prio').value = '';
      document.getElementById('res-from').value = '';
      document.getElementById('res-to').value = '';
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
      refreshTableRegion();
    });

    document.getElementById('res-cols-btn').addEventListener('click', function () {
      document.getElementById('res-cols-panel').classList.toggle('hidden');
    });

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
        state.visibleCols = DEFAULT_VISIBLE_COLS.slice();
        localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(state.visibleCols));
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
      });
    }
    if (pullFromEl) {
      pullFromEl.addEventListener('change', function () { state.pullFrom = pullFromEl.value; });
    }
    if (pullToEl) {
      pullToEl.addEventListener('change', function () { state.pullTo = pullToEl.value; });
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
                  ctx.toast('يرجى تحديد تاريخ البداية عند اختيار السحب من تاريخ معين.', true);
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
              var rangeNote = (d.appliedRange && d.appliedRange.hasCustomRange && d.appliedRange.dateFrom)
                ? (' (' + d.appliedRange.dateFrom + (d.appliedRange.dateTo ? ' → ' + d.appliedRange.dateTo : '') + ')')
                : '';
              var imported = d.importedCount || 0;
              var updated = d.updatedCount || 0;
              var exts = d.extensionsCount || 0;
              var diagHint = '';
              if (imported === 0 && updated === 0) {
                var fetched = d.fetchedCount || 0;
                if (fetched > 0 && d.excludedFilteredCount === fetched) {
                  diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعدت جميعها حسب الحالات المستبعدة في الإعدادات';
                } else if (fetched > 0 && d.rangeFilteredCount > 0) {
                  diagHint = ' — تم جلب ' + fetched + ' سجل ولكن استُبعد ' + d.rangeFilteredCount + ' خارج النطاق الزمني المحدد';
                } else if (fetched === 0) {
                  diagHint = ' — أرجعت الواجهة 0 حجز لهذا الحساب/الفترة';
                }
              }
              var msg = ctx.lang === 'en'
                ? ('Pulled reservations' + rangeNote + ': ' + imported + ' new · ' + updated + ' updated · ' + exts + ' extensions')
                : ('تم سحب الحجوزات بنجاح' + rangeNote + ': ' + imported + ' جديد · ' + updated + ' محدث · ' + exts + ' تمديد' + diagHint);
              ctx.toast(msg);
              ctx.refreshNotifications();
              refreshTableRegion({ forceRefresh: true });
              refreshRadarData();
            } else {
              ctx.toast((resp && resp.message) || 'تعذر سحب الحجوزات.', true);
            }
          } finally {
            pullBtn.textContent = prevLabel;
          }
        });
      });
    }

    var exportBtn = document.getElementById('res-export-xlsx');
    exportBtn.addEventListener('click', async function () {
      exportBtn.disabled = true;
      try {
        await root.RGReports.exportExcelWorkbook([{
          name: 'Reservations',
          headers: ALL_COLUMNS.slice(),
          rows: currentItems
        }], 'rental-gate-reservations.xlsx');
        ctx.toast('تم تصدير جدول الحجوزات إلى Excel.');
      } catch (err) {
        ctx.toast((err && err.message) || 'تعذر تصدير ملف Excel.', true);
      } finally {
        exportBtn.disabled = false;
      }
    });

    var importBtn = document.getElementById('res-import-xlsx');
    if (importBtn) {
      importBtn.addEventListener('click', function () {
        openImportExcelModal(ctx, function () {
          refreshTableRegion();
          refreshRadarData();
        }, currentItems);
      });
    }

    var handoverBtn = document.getElementById('res-handover-btn');
    if (handoverBtn && root.RGHandover) {
      handoverBtn.addEventListener('click', function () {
        root.RGHandover.openHandoverModal(ctx);
      });
    }

    var radarRawReservations = null;
    var radarFetchSeq = 0;

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

      if (badgeEl) badgeEl.textContent = String(summary.totalCount || 0);
      if (state.viewMode !== 'radar') return;

      if (radarRawReservations === null) {
        radarWrap.innerHTML = '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div></div>';
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
                '<div class="cell-primary">' + esc(r.customerName || '-') + '</div>' +
                '<div class="cell-sub"><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary">' + esc(formatCarNameDisplay(r.carName)) + '</div>' +
                '<div class="cell-sub">' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</td>' +
              '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                '<div>' + esc(formatDateOnly(entry.effectiveEndDate)) + '</div>' +
                (entry.effectiveEndTime ? '<div class="time-sub" dir="ltr">' + esc(formatTimeOnly(entry.effectiveEndTime, ctx.lang)) + '</div>' : '') +
              '</td>' +
              '<td style="white-space:nowrap;">' +
                '<span class="radar-countdown ' + toneCls + ' tabular-nums">' + esc(remLabel) + '</span>' +
              '</td>' +
              '<td><span class="status-tag ' + statusClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span></td>' +
              '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                '<button type="button" class="btn btn-sm btn-primary radar-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                '<button type="button" class="btn btn-sm radar-copy-offer" data-id="' + esc(r.id) + '">' + (isEn ? 'Copy Offer' : 'نسخ التمديد') + '</button>' +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
                  : '') +
              '</div></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }

      radarWrap.innerHTML =
        '<div class="radar-summary-bar">' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Total in Radar' : 'إجمالي التنبيهات') + '</span><strong class="tabular-nums">' + summary.totalCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-warning"><span class="radar-stat-label">' + (isEn ? 'Critical ≤ 6h' : 'عاجل ≤ 6 ساعات') + '</span><strong class="tabular-nums">' + summary.critical6hCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-danger"><span class="radar-stat-label">' + (isEn ? 'Overdue Unclosed' : 'منتهية لم تُغلق') + '</span><strong class="tabular-nums">' + summary.expiredUnclosedCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-info"><span class="radar-stat-label">' + (isEn ? 'Extended Contracts' : 'عقود ممددة') + '</span><strong class="tabular-nums">' + summary.extendedInRadarCount + '</strong></div>' +
        '</div>' +
        '<div class="radar-toolbar">' +
          '<div class="segmented-control" role="group" aria-label="' + (isEn ? 'Urgency filter' : 'تصفية الاستعجال') + '">' +
            '<button type="button" class="segmented-btn' + (state.radarFilter === 'all' ? ' active' : '') + '" data-radar-filter="all">' + (isEn ? 'All' : 'الكل') + ' (' + summary.totalCount + ')</button>' +
            '<button type="button" class="segmented-btn' + (state.radarFilter === 'critical_6h' ? ' active' : '') + '" data-radar-filter="critical_6h">' + (isEn ? '≤ 6 Hours' : 'أقل من 6 ساعات') + ' (' + summary.critical6hCount + ')</button>' +
            '<button type="button" class="segmented-btn' + (state.radarFilter === 'expired_unclosed' ? ' active' : '') + '" data-radar-filter="expired_unclosed">' + (isEn ? 'Overdue Unclosed' : 'منتهية غير مغلقة') + ' (' + summary.expiredUnclosedCount + ')</button>' +
          '</div>' +
          '<div class="radar-search-wrap">' +
            '<input type="search" class="input" id="radar-search-input" placeholder="' + (isEn ? 'Filter expiring bookings...' : 'بحث في رادار الانتهاء...') + '" value="' + esc(state.radarSearch || '') + '">' +
            '<button type="button" class="btn btn-sm" id="radar-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث') + '</button>' +
          '</div>' +
        '</div>' +
        rowsHtml;

      radarWrap.querySelectorAll('[data-radar-filter]').forEach(function (fBtn) {
        fBtn.addEventListener('click', function () {
          state.radarFilter = fBtn.getAttribute('data-radar-filter') || 'all';
          paintRadarView();
        });
      });

      var radarSearchEl = radarWrap.querySelector('#radar-search-input');
      if (radarSearchEl) {
        radarSearchEl.addEventListener('input', function () {
          state.radarSearch = radarSearchEl.value;
          var pos = radarSearchEl.selectionStart;
          paintRadarView();
          var nextInp = document.getElementById('radar-search-input');
          if (nextInp) {
            nextInp.focus();
            if (typeof pos === 'number') {
              try { nextInp.setSelectionRange(pos, pos); } catch (_e) {}
            }
          }
        });
      }

      var radarRefreshBtn = radarWrap.querySelector('#radar-refresh-btn');
      if (radarRefreshBtn) {
        radarRefreshBtn.addEventListener('click', function () {
          refreshRadarData(true);
        });
      }

      radarWrap.querySelectorAll('.radar-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          openReservationDrawer(rid, ctx, employees, function () {
            refreshTableRegion();
            refreshRadarData(false);
          });
        });
      });

      radarWrap.querySelectorAll('.radar-copy-offer').forEach(function (btn) {
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

      if (badgeEl) badgeEl.textContent = String(summary.totalCount || 0);
      if (state.viewMode !== 'today') return;

      if (radarRawReservations === null) {
        todayWrap.innerHTML = '<div class="rg-skeleton-card"><div class="rg-skeleton-line lg"></div><div class="rg-skeleton-line sm"></div><div class="rg-skeleton-line lg"></div></div>';
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
          var telHref = (core && core.formatDirectCallTelHref) ? core.formatDirectCallTelHref(r.customerPhone, '90') : '';
          var telDisp = (core && core.formatDirectCallDisplayNumber) ? core.formatDirectCallDisplayNumber(r.customerPhone, '90') : '';
          var rowStateCls = entry.isOverdue ? ' is-overdue' : (entry.isCompleted ? ' is-done' : '');

          desktopRows.push(
            '<tr data-today-key="' + esc(entry.key) + '" class="today-move-row' + rowStateCls + '">' +
              '<td class="mono tabular-nums" style="white-space:nowrap;">' +
                '<div class="today-time-slot" dir="ltr">' + esc(schedTimeDisp || '-') + '</div>' +
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
                '<div class="cell-primary">' + esc(r.customerName || '-') + '</div>' +
                '<div class="cell-sub"><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
              '</td>' +
              '<td>' +
                '<div class="cell-primary">' + esc(formatCarNameDisplay(r.carName)) + (r.plateNumber ? ' · <span class="mono">' + esc(r.plateNumber) + '</span>' : '') + '</div>' +
                '<div class="cell-sub">' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</td>' +
              '<td><span class="status-tag ' + statusClass(r.internalStatus || r.originalStatusAr) + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span></td>' +
              '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                '<button type="button" class="btn btn-sm btn-primary today-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                (!isMine
                  ? '<button type="button" class="btn btn-sm today-claim-btn" data-id="' + esc(r.id) + '">' + (isEn ? 'Claim' : 'استلام عندي') + '</button>'
                  : '') +
                (telHref
                  ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 90' : 'اتصال 90') + '</a>'
                  : '') +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
                  : '') +
              '</div></td>' +
            '</tr>'
          );

          mobileCards.push(
            '<article data-today-key="' + esc(entry.key) + '" class="today-mobile-card' + rowStateCls + '">' +
              '<div class="today-mobile-card-top">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<span class="today-time-slot" dir="ltr">' + esc(schedTimeDisp || '-') + '</span>' +
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
                '<div class="cell-primary">' + esc(r.customerName || '-') + ' · <span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone || '-') + '</span></div>' +
                '<div class="cell-sub">' + esc(formatCarNameDisplay(r.carName)) + ' · ' + esc([r.companyName, r.branchName].filter(Boolean).join(' · ') || '-') + '</div>' +
              '</div>' +
              '<div class="today-mobile-card-actions">' +
                '<button type="button" class="btn btn-sm btn-primary today-open-res" data-id="' + esc(r.id) + '">' + (isEn ? 'Details' : 'التفاصيل') + '</button>' +
                (!isMine
                  ? '<button type="button" class="btn btn-sm today-claim-btn" data-id="' + esc(r.id) + '">' + (isEn ? 'Claim' : 'استلام عندي') + '</button>'
                  : '') +
                (telHref
                  ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 90' : 'اتصال 90') + '</a>'
                  : '') +
                (waHref
                  ? '<a class="btn btn-sm btn-charcoal" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer">' + (isEn ? 'WhatsApp' : 'واتساب') + '</a>'
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

      todayWrap.innerHTML =
        '<div class="radar-summary-bar">' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Today Movements' : 'إجمالي حركات اليوم') + '</span><strong class="tabular-nums">' + summary.totalCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-info"><span class="radar-stat-label">' + (isEn ? 'Pickups Today' : 'التسليم اليوم') + '</span><strong class="tabular-nums">' + summary.pickupCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-warning"><span class="radar-stat-label">' + (isEn ? 'Returns Today' : 'الإرجاع اليوم') + '</span><strong class="tabular-nums">' + summary.returnCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item is-danger"><span class="radar-stat-label">' + (isEn ? 'Delayed' : 'متأخر عن الوقت') + '</span><strong class="tabular-nums">' + summary.overdueCount + '</strong></div>' +
          '<span class="radar-stat-sep" aria-hidden="true">·</span>' +
          '<div class="radar-stat-item"><span class="radar-stat-label">' + (isEn ? 'Completed' : 'مكتمل') + '</span><strong class="tabular-nums">' + summary.completedCount + '</strong></div>' +
        '</div>' +
        '<div class="radar-toolbar" style="flex-wrap:wrap;">' +
          '<div class="segmented-control" role="group" aria-label="' + (isEn ? 'Movement filter' : 'تصفية حركات اليوم') + '">' +
            '<button type="button" class="segmented-btn' + (state.todayFilter === 'all' ? ' active' : '') + '" data-today-filter="all">' + (isEn ? 'All' : 'الكل') + ' (' + summary.totalCount + ')</button>' +
            '<button type="button" class="segmented-btn' + (state.todayFilter === 'pickup' ? ' active' : '') + '" data-today-filter="pickup">' + (isEn ? 'Pickups' : 'التسليم اليوم') + ' (' + summary.pickupCount + ')</button>' +
            '<button type="button" class="segmented-btn' + (state.todayFilter === 'return' ? ' active' : '') + '" data-today-filter="return">' + (isEn ? 'Returns' : 'الإرجاع اليوم') + ' (' + summary.returnCount + ')</button>' +
          '</div>' +
          '<div class="radar-search-wrap" style="flex-wrap:wrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);"><span>' + (isEn ? 'From:' : 'من:') + '</span><input type="time" class="input mono" id="today-time-from" value="' + esc(state.todayTimeFrom || '') + '" style="width:118px;min-height:34px;"></label>' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);"><span>' + (isEn ? 'To:' : 'إلى:') + '</span><input type="time" class="input mono" id="today-time-to" value="' + esc(state.todayTimeTo || '') + '" style="width:118px;min-height:34px;"></label>' +
            ((state.todayTimeFrom || state.todayTimeTo) ? '<button type="button" class="btn btn-sm" id="today-clear-time-btn">' + (isEn ? 'Clear Time' : 'مسح الوقت') + '</button>' : '') +
            '<input type="search" class="input" id="today-search-input" placeholder="' + (isEn ? 'Search today\'s schedule...' : 'بحث في جدول اليوم...') + '" value="' + esc(state.todaySearch || '') + '">' +
            '<button type="button" class="btn btn-sm" id="today-ics-btn" title="' + (isEn ? 'Export Today Schedule to Google Calendar (.ics)' : 'تصدير جدول اليوم إلى تقويم Google (.ics)') + '">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' +
            '<button type="button" class="btn btn-sm" id="today-refresh-btn">' + (isEn ? 'Refresh' : 'تحديث') + '</button>' +
          '</div>' +
        '</div>' +
        rowsHtml;

      todayWrap.querySelectorAll('[data-today-filter]').forEach(function (fBtn) {
        fBtn.addEventListener('click', function () {
          state.todayFilter = fBtn.getAttribute('data-today-filter') || 'all';
          paintTodayView();
        });
      });

      var todayTimeFromEl = todayWrap.querySelector('#today-time-from');
      var todayTimeToEl = todayWrap.querySelector('#today-time-to');
      if (todayTimeFromEl) {
        todayTimeFromEl.addEventListener('change', function () {
          state.todayTimeFrom = todayTimeFromEl.value || '';
          paintTodayView();
        });
      }
      if (todayTimeToEl) {
        todayTimeToEl.addEventListener('change', function () {
          state.todayTimeTo = todayTimeToEl.value || '';
          paintTodayView();
        });
      }
      var todayClearTimeBtn = todayWrap.querySelector('#today-clear-time-btn');
      if (todayClearTimeBtn) {
        todayClearTimeBtn.addEventListener('click', function () {
          state.todayTimeFrom = '';
          state.todayTimeTo = '';
          paintTodayView();
        });
      }
      var todayIcsBtn = todayWrap.querySelector('#today-ics-btn');
      if (todayIcsBtn) {
        todayIcsBtn.addEventListener('click', function () {
          if (!core || !core.buildTodayScheduleIcsEvents || !core.buildIcsCalendarContent) return;
          var evs = core.buildTodayScheduleIcsEvents(summary, ctx.lang);
          if (!evs.length) {
            ctx.toast(isEn ? 'No movements in the filtered today schedule to export.' : 'لا توجد حركات في الجدول المصفى لتصديرها إلى التقويم.', true);
            return;
          }
          var icsStr = core.buildIcsCalendarContent(evs, 'Rental Gate CRM — Today');
          var dlFn = (ctx.downloadIcsFile) || (root.RGApp && root.RGApp.downloadIcsFile);
          if (dlFn) {
            dlFn('rg-today-schedule-' + (summary.todayDate || 'today') + '.ics', icsStr);
            ctx.toast(isEn ? 'Calendar (.ics) file downloaded.' : 'تم تصدير جدول اليوم بصيغة تقويم (.ics).');
          }
        });
      }

      var todaySearchEl = todayWrap.querySelector('#today-search-input');
      if (todaySearchEl) {
        todaySearchEl.addEventListener('input', function () {
          state.todaySearch = todaySearchEl.value;
          var pos = todaySearchEl.selectionStart;
          paintTodayView();
          var nextInp = document.getElementById('today-search-input');
          if (nextInp) {
            nextInp.focus();
            if (typeof pos === 'number') {
              try { nextInp.setSelectionRange(pos, pos); } catch (_e) {}
            }
          }
        });
      }

      var todayRefreshBtn = todayWrap.querySelector('#today-refresh-btn');
      if (todayRefreshBtn) {
        todayRefreshBtn.addEventListener('click', function () {
          refreshRadarData(true);
        });
      }

      todayWrap.querySelectorAll('.today-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          openReservationDrawer(rid, ctx, employees, function () {
            refreshTableRegion();
            refreshRadarData(false);
          });
        });
      });

      todayWrap.querySelectorAll('.today-claim-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rid = btn.getAttribute('data-id');
          var target = (radarRawReservations || []).find(function (x) { return x && x.id === rid; });
          if (!target || !currentUser) return;
          runWithLock(btn, 'claimReservation:' + rid, function () {
            var claimed = root.RGCrmCore.claimReservationRecord(target, currentUser);
            target.assignedEmployeeIds = claimed.assignedEmployeeIds;
            target.assignedEmployeeNames = claimed.assignedEmployeeNames;
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('claimReservation', { reservationId: rid }, currentUser);
            }
            paintTodayView();
            ctx.toast(isEn ? 'Reservation claimed successfully.' : 'تم استلام الحجز في قائمتك بنجاح.');
            return root.RGApi.callApi('claimReservation', { reservationId: rid, _keepOptimisticCache: true }).then(function (resp) {
              if (resp && resp.success) {
                ctx.refreshNotifications();
                refreshTableRegion();
              } else {
                ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true);
                refreshRadarData(false);
              }
            });
          });
        });
      });
    }

    async function refreshRadarData(showToast) {
      var seq = ++radarFetchSeq;
      if (state.viewMode === 'radar' && radarRawReservations === null) {
        paintRadarView();
      } else if (state.viewMode === 'today' && radarRawReservations === null) {
        paintTodayView();
      }
      try {
        var resp = await root.RGApi.callApi('getReservations', { page: 1, pageSize: 200, silentRefresh: true });
        if (seq !== radarFetchSeq || !container.isConnected) return;
        if (resp && resp.success && resp.data && Array.isArray(resp.data.items)) {
          radarRawReservations = resp.data.items;
        } else if (radarRawReservations === null) {
          radarRawReservations = currentItems.slice();
        }
        paintRadarView();
        paintTodayView();
        if (showToast) {
          ctx.toast(state.viewMode === 'today'
            ? (isEn ? 'Today\'s pickups & returns updated.' : 'تم تحديث جدول التسليم والاستلام لليوم.')
            : (isEn ? '24h Expiry Radar updated.' : 'تم تحديث رادار الانتهاء بنجاح.'));
        }
      } catch (_e) {
        if (seq !== radarFetchSeq || !container.isConnected) return;
        if (radarRawReservations === null) radarRawReservations = currentItems.slice();
        paintRadarView();
        paintTodayView();
      }
    }

    function setViewMode(nextMode) {
      state.viewMode = nextMode === 'radar' ? 'radar' : (nextMode === 'today' ? 'today' : 'all');
      var allViewEl = document.getElementById('res-all-view');
      var todayViewEl = document.getElementById('res-today-view');
      var radarViewEl = document.getElementById('res-radar-view');
      if (allViewEl) allViewEl.classList.toggle('hidden', state.viewMode !== 'all');
      if (todayViewEl) todayViewEl.classList.toggle('hidden', state.viewMode !== 'today');
      if (radarViewEl) radarViewEl.classList.toggle('hidden', state.viewMode !== 'radar');
      container.querySelectorAll('[data-res-view]').forEach(function (tabBtn) {
        var isAct = tabBtn.getAttribute('data-res-view') === state.viewMode;
        tabBtn.classList.toggle('is-active', isAct);
        tabBtn.setAttribute('aria-selected', String(isAct));
      });
      if (state.viewMode === 'radar') {
        if (radarRawReservations === null) refreshRadarData(false);
        else paintRadarView();
      } else if (state.viewMode === 'today') {
        if (radarRawReservations === null) refreshRadarData(false);
        else paintTodayView();
      }
    }

    container.querySelectorAll('[data-res-view]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        setViewMode(tabBtn.getAttribute('data-res-view'));
      });
    });

    var hasActiveResFilters = Boolean(
      state.search || state.company || state.branch || state.status || state.employeeId ||
      state.priority || state.dateFrom || state.dateTo || state.timeFrom || state.timeTo ||
      state.unfollowedOnly || state.hasProblemsOnly || state.overdueUnpaidOnly
    );
    if (!hasActiveResFilters && Number(payload.total || 0) <= currentItems.length) {
      radarRawReservations = currentItems.slice();
      paintRadarView();
      paintTodayView();
    } else if (state.viewMode === 'radar' || state.viewMode === 'today') {
      refreshRadarData(false);
    } else {
      paintRadarView();
      paintTodayView();
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
    var canAssign = root.RGCrmCore.canUserPerform(user, 'assign_employees');
    var canEditReservation = root.RGCrmCore.canUserPerform(user, 'edit_reservation_details');
    var canEditAnyFollowUp = root.RGCrmCore.canUserPerform(user, 'edit_any_followup');
    var canEditTicket = root.RGCrmCore.canUserPerform(user, 'edit_ticket_details');

    function reopenSelf() {
      openReservationDrawer(d.reservation.id, ctx, resolvedEmployees, onUpdated, opts);
      if (onUpdated) onUpdated();
    }

    function notifyParentUpdated() {
      if (onUpdated) onUpdated();
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
              '<div class="ext-compare-row"><span>' + (isEn ? 'Original Return Date' : 'تاريخ الإرجاع الأصلي') + '</span><strong class="mono tabular-nums" dir="ltr">' + esc(formatDateOnly(origEndDate)) + (origEndTime ? ' · ' + esc(formatTimeOnly(origEndTime, ctx.lang)) : '') + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Base Days' : 'الأيام الأساسية') + '</span><strong class="tabular-nums">' + baseDays + ' ' + dayUnit + '</strong></div>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Base Amount' : 'قيمة العقد الأساسي') + '</span><strong class="mono tabular-nums">' + baseAmt + ' ' + curLabel + '</strong></div>' +
            '</div>' +
            '<div class="ext-compare-col is-extended">' +
              '<span class="ext-compare-col-label">' + (hasExtended ? (isEn ? 'After Extension & Modification' : 'بعد التمديد والتعديل') : (isEn ? 'Current Contract Status' : 'الوضع الحالي للعقد')) + '</span>' +
              '<div class="ext-compare-row"><span>' + (isEn ? 'Extended Return Date' : 'تاريخ الإرجاع الممدد') + '</span><strong class="mono tabular-nums" dir="ltr">' + (hasExtended && extUntilDate ? (esc(formatDateOnly(extUntilDate)) + (extUntilTime ? ' · ' + esc(formatTimeOnly(extUntilTime, ctx.lang)) : '')) : (isEn ? 'Not extended' : 'لم يُمدد')) + '</strong></div>' +
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
          '<div class="detail-kv"><span class="detail-k">' + (isEn ? 'Extended Until' : 'التمديد لحد') + '</span><span class="detail-v mono tabular-nums" dir="ltr">' + (extUntilDate ? (esc(formatDateOnly(extUntilDate)) + (extUntilTime ? ' · ' + esc(formatTimeOnly(extUntilTime, ctx.lang)) : '')) : (isEn ? 'None' : 'لا يوجد تمديد')) + '</span></div>' +
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
                    '<span class="mono tabular-nums" dir="ltr">' + esc(formatDateOnly(ex.startDate)) + (ex.startTime ? ' ' + esc(formatTimeOnly(ex.startTime, ctx.lang)) : '') + ' ← ' + esc(formatDateOnly(ex.endDate)) + (ex.endTime ? ' ' + esc(formatTimeOnly(ex.endTime, ctx.lang)) : '') + '</span>' +
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
      if (lockHeartbeatTimer) {
        clearInterval(lockHeartbeatTimer);
        lockHeartbeatTimer = null;
      }
      if (modalObserver) {
        try { modalObserver.disconnect(); } catch (_e) {}
        modalObserver = null;
      }
      document.removeEventListener('rg:deltasync', onDeltaSyncDrawer);
      if (root.RGApi && root.RGApi.callApi && d && d.reservation && d.reservation.id) {
        root.RGApi.callApi('releaseReservationLock', { reservationId: d.reservation.id, silentRefresh: true }).catch(function () {});
      }
    }

    function onDeltaSyncDrawer(ev) {
      if (drawerCleanedUp || !ev || !ev.detail || ev.detail.localMutation) return;
      var det = ev.detail;
      var curBackdrop = document.getElementById('res-drawer-backdrop');
      if (!curBackdrop || curBackdrop.getAttribute('data-res-id') !== String(d.reservation.id)) return;
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
      if (Array.isArray(det.changedReservations)) {
        var changed = det.changedReservations.find(function (x) { return x && x.id === d.reservation.id; });
        if (changed && changed.updatedAt && changed.updatedAt !== d.reservation.updatedAt) {
          var byName = changed.lastUpdatedByName || (isEn ? 'colleague' : 'زميل');
          if (user && changed.lastUpdatedById === user.id) return;
          remoteConflictInfo = { byName: byName, updatedAt: changed.updatedAt };
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
                var fresh = await root.RGApi.callApi('getReservationDetails', { reservationId: d.reservation.id, forceRefresh: true });
                if (fresh && fresh.success && fresh.data && fresh.data.reservation) {
                  d = fresh.data;
                  paintDrawer();
                }
              });
            }
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

      var telHref = core.formatDirectCallTelHref ? core.formatDirectCallTelHref(r.customerPhone, '90') : '';
      var telDisp = core.formatDirectCallDisplayNumber ? core.formatDirectCallDisplayNumber(r.customerPhone, '90') : '';
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
                  '<span>' + esc(r.customerName) + '</span><span>·</span><span class="mono cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span>' +
                  (r.customerEmail ? '<span class="rg-ui-field-customer-extra"><span>·</span><span class="mono" dir="ltr">' + esc(r.customerEmail) + '</span></span>' : '') +
                  (r.customerIdNumber ? '<span class="rg-ui-field-customer-extra"><span>·</span><span class="mono">' + (isEn ? 'ID: ' : 'هوية: ') + '<span dir="ltr">' + esc(r.customerIdNumber) + '</span></span></span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="toolbar-row" style="margin-bottom:0;">' +
                (opts && opts.onBack ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-back-btn">' + esc(opts.backLabel || (isEn ? 'Back' : 'العودة لملف الموظف')) + '</button>' : '') +
                '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-copy-summary-btn">' + (isEn ? 'Copy Summary' : 'نسخ ملخص الحجز') + '</button>' +
                (telHref ? '<a class="btn btn-sm rg-tel-btn" id="drawer-direct-call-link" href="' + esc(telHref) + '" data-call-res-id="' + esc(r.id) + '" data-call-res-num="' + esc(r.reservationNumber || r.id) + '" data-call-customer="' + esc(r.customerName || '-') + '" data-call-phone="' + esc(r.customerPhone || '') + '" data-call-status="' + esc(r.internalStatus || '') + '" title="' + esc(telDisp) + '">' + (isEn ? 'Call 90' : 'اتصال 90') + '</a>' : '') +
                (canPinNote ? '<button type="button" class="btn btn-sm btn-warning" id="drawer-header-pin-note-btn">📌 ' + (isEn ? 'Supervisor Pinned Note' : 'ملاحظة مشرف/مدير مثبتة') + '</button>' : '') +
                '<button type="button" class="btn btn-sm" id="drawer-ics-btn" title="' + (isEn ? 'Add pickup & return to Google Calendar (.ics)' : 'إضافة موعد الاستلام والتسليم للتقويم (.ics)') + '">📅 ' + (isEn ? 'Calendar .ics' : 'تقويم .ics') + '</button>' +
                (canEditReservation ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-edit-res-btn">' + (isEn ? 'Edit Booking' : 'تعديل تفاصيل الحجز') + '</button>' : '') +
                '<button type="button" class="btn btn-sm btn-primary" id="drawer-pdf-btn">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' +
                '<button type="button" class="btn btn-sm btn-danger" id="drawer-problem-btn">' + (isEn ? 'Report Problem' : 'تحويل إلى مشكلة') + '</button>' +
                '<button type="button" class="btn btn-sm" id="drawer-close-btn">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
              '</div>' +
            '</div>' +

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
                  '<button type="button" class="btn btn-sm rg-no-answer-btn" id="drawer-no-answer-btn">' +
                    (isEn ? 'No Answer' : 'لم يرد') + ' <span class="rg-attempt-badge tabular-nums" id="drawer-no-answer-count">' + noAnswerCount + '</span>' +
                  '</button>' +
                  (isClaimedByMe
                    ? '<button type="button" class="btn btn-sm btn-danger" id="drawer-unclaim-btn">إلغاء الاستلام من عندي</button>'
                    : '<button type="button" class="btn btn-sm btn-primary" id="drawer-claim-btn">استلام الحجز عندي</button>') +
                '</div>' +
              '</div>' +
              '<div class="quick-status-bar grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)_auto] gap-2 items-center">' +
                '<select class="select" id="drawer-quick-status" aria-label="تحديث الحالة السريع">' +
                  (core.getWorkflowStatusOptions ? core.getWorkflowStatusOptions(r.internalStatus) : core.FOLLOWUP_STATUSES).map(function (s) {
                    return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                  }).join('') +
                '</select>' +
                '<input class="input" id="drawer-quick-note" placeholder="ملاحظة سريعة اختيارية عند تغيير الحالة...">' +
                '<button type="button" class="btn btn-charcoal" id="drawer-quick-status-btn">تحديث الحالة الآن</button>' +
              '</div>' +
            '</div>' +

            '<div class="detail-summary-grid">' +
              '<div class="detail-kv"><span class="detail-k">الشركة / فرع الاستلام</span><span class="detail-v">' + esc(r.companyName) + ' — ' + esc(r.branchName) +
                (r.deliverBranchName && r.deliverBranchName !== r.branchName ? ' (التسليم: ' + esc(r.deliverBranchName) + ')' : '') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">السيارة والفئة واللوحة</span><span class="detail-v">' + esc(r.carName) +
                (r.carCategory ? '<span class="rg-ui-field-car-meta"> · ' + esc(r.carCategory) + '</span>' : '') + ' (' + esc(r.plateNumber || '-') + ')</span></div>' +
              '<div class="detail-kv"><span class="detail-k">بداية الحجز</span><span class="detail-v mono tabular-nums" dir="ltr">' + esc(formatDateOnly(r.startDate)) +
                (r.startTime ? ' · ' + esc(formatTimeOnly(r.startTime, ctx.lang)) : '') + '</span>' +
                (r.sourceCreatedAt ? '<span class="time-sub">أُنشئ بالمنصة: <span class="mono" dir="ltr">' + esc(formatTimestamp(r.sourceCreatedAt, ctx.lang)) + '</span></span>' : '') + '</div>' +
              '<div class="detail-kv"><span class="detail-k">نهاية الحجز الأصلية</span><span class="detail-v mono tabular-nums" dir="ltr">' + esc(formatDateOnly(origEndD)) +
                (origEndT ? ' · ' + esc(formatTimeOnly(origEndT, ctx.lang)) : '') + ' (' + Number(r.daysCount || 1) + ' يوم أساسي)</span></div>' +
              '<div class="detail-kv"><span class="detail-k">التمديد لحد (الإرجاع الفعلي)</span><span class="detail-v mono tabular-nums" dir="ltr">' +
                (extUntilD ? (esc(formatDateOnly(extUntilD)) + (extUntilT ? ' · ' + esc(formatTimeOnly(extUntilT, ctx.lang)) : '')) : 'لا يوجد تمديد') + '</span></div>' +
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
                  '<select class="select" id="fu-status">' +
                    (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
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
                        '<div style="display:flex;align-items:center;gap:8px;">' +
                          '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
                          (canEditThisFu ? '<button type="button" class="btn btn-sm btn-edit-fu" data-fu-id="' + esc(f.id) + '">تعديل</button>' : '') +
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
                        (!prbClosed ? '<button type="button" class="btn btn-sm btn-danger btn-close-prb-in-drawer" data-prb-id="' + esc(p.id) + '">إغلاق المشكلة</button>' : '') +
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
      document.getElementById('drawer-close-btn').addEventListener('click', function () {
        cleanupDrawerLifecycle();
        modalRoot.innerHTML = '';
      });
      var backBtn = document.getElementById('drawer-back-btn');
      if (backBtn && opts && opts.onBack) {
        backBtn.addEventListener('click', function () {
          cleanupDrawerLifecycle();
          opts.onBack();
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
            return root.RGApi.callApi('claimReservation', { reservationId: r.id, _keepOptimisticCache: true }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر استلام الحجز.', true); reopenSelf(); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf();
            });
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
            return root.RGApi.callApi('unclaimReservation', { reservationId: r.id, _keepOptimisticCache: true }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إلغاء الاستلام.', true); reopenSelf(); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf();
            });
          });
        });
      }

      var quickBtn = document.getElementById('drawer-quick-status-btn');
      if (quickBtn) {
        quickBtn.addEventListener('click', function () {
          var nextStatus = document.getElementById('drawer-quick-status').value;
          var quickNote = String(document.getElementById('drawer-quick-note').value || '').trim();
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
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر تحديث الحالة.', true); reopenSelf(); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf();
            });
          });
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
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تمت إزالة ' + empName + ' من الحجز.');
            return root.RGApi.callApi('removeAssignment', {
              reservationId: r.id,
              employeeId: empId
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إزالة الموظف.', true); reopenSelf(); }
            });
          });
        });
      });

      var saveAssignBtn = document.getElementById('drawer-save-assign');
      if (saveAssignBtn) {
        saveAssignBtn.addEventListener('click', function () {
          var ids = Array.from(modalRoot.querySelectorAll('.drawer-assign-chk:checked')).map(function (c) { return c.value; });
          runWithLock(saveAssignBtn, 'assignEmployees:' + r.id, function () {
            var names = ids.map(function (eid) {
              var emp = resolvedEmployees.find(function (e) { return e.id === eid; });
              return emp ? emp.name : eid;
            });
            d.reservation = Object.assign({}, r, {
              assignedEmployeeIds: ids,
              assignedEmployeeNames: names
            });
            paintDrawer();
            notifyParentUpdated();
            ctx.toast('تم تحديث الموظفين المسؤولين عن الحجز.');
            return root.RGApi.callApi('assignEmployees', { reservationId: r.id, employeeIds: ids }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر حفظ الإسناد.', true); reopenSelf(); }
            });
          });
        });
      }

      document.getElementById('drawer-fu-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var errEl = document.getElementById('fu-form-error');
        errEl.classList.add('hidden');
        var fuStatus = document.getElementById('fu-status').value;
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
            _keepOptimisticCache: true
          }).then(function (resp) {
            if (resp && resp.success) ctx.refreshNotifications();
            else { ctx.toast((resp && resp.message) || 'تعذر حفظ المتابعة.', true); reopenSelf(); }
          }).catch(function () {
            ctx.toast('تعذر الاتصال بالخادم أثناء حفظ المتابعة.', true);
            reopenSelf();
          });
        });
      });

      modalRoot.querySelectorAll('.btn-edit-fu').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var fuId = btn.getAttribute('data-fu-id');
          var fu = d.followUps.find(function (x) { return x.id === fuId; });
          if (fu) openEditFollowUpModal(fu, r, ctx, reopenSelf, reopenSelf);
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
            return root.RGApi.callApi('updateProblem', Object.assign({ _keepOptimisticCache: true }, closePayload)).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر إغلاق المشكلة.', true); reopenSelf(); }
            });
          });
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
            root.RGProblems.openProblemUpdateModal(enriched, resolvedEmployees, ctx, notifyParentUpdated, reopenSelf);
          }
        });
      });

      var copySummaryBtn = document.getElementById('drawer-copy-summary-btn');
      if (copySummaryBtn) {
        copySummaryBtn.addEventListener('click', function () {
          var summaryText = core.formatBookingSummaryText
            ? core.formatBookingSummaryText(r, ctx.lang, { timeFormat: activeTimeFormat() })
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
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر تسجيل محاولة الاتصال.', true); reopenSelf(); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf();
            });
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
              _keepOptimisticCache: true
            }).then(function (resp) {
              if (resp && resp.success) ctx.refreshNotifications();
              else { ctx.toast((resp && resp.message) || 'تعذر حفظ الملاحظة المثبتة.', true); reopenSelf(); }
            }).catch(function () {
              ctx.toast('تعذر الاتصال بالخادم.', true);
              reopenSelf();
            });
          });
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

      document.getElementById('drawer-problem-btn').addEventListener('click', function () {
        openCreateProblemModal(r, resolvedEmployees, ctx, notifyParentUpdated, reopenSelf);
      });

      var drawerCharts = renderDrawerCharts(d);

      document.getElementById('drawer-pdf-btn').addEventListener('click', function () {
        cleanupDrawerLifecycle();
        openSingleReservationPdfModal(d, ctx, drawerCharts, reopenSelf);
      });
    }

    paintDrawer();

    document.addEventListener('rg:deltasync', onDeltaSyncDrawer);
    if (typeof MutationObserver !== 'undefined') {
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
            '<div class="form-group"><label class="form-label" for="re-idnum">رقم الهوية / الإقامة</label><input class="input mono" id="re-idnum" value="' + esc(reservation.customerIdNumber || '') + '"></div>' +
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
              '<select class="select" id="re-status">' +
                (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(reservation.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
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

    document.getElementById('res-edit-cancel').addEventListener('click', function () {
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });

    document.getElementById('res-edit-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates) {
        var dateCheck = root.RGCrmDatePicker.validateContainerDates(ev.target);
        if (!dateCheck.valid) {
          var errBox = document.getElementById('res-edit-err');
          errBox.textContent = dateCheck.message || 'يرجى تصحيح صيغة التاريخ المدخل.';
          errBox.classList.remove('hidden');
          return;
        }
      }
      var baseDaysVal = Math.max(1, Number(document.getElementById('re-days').value || 1));
      var extDaysVal = Math.max(0, Number(document.getElementById('re-ext-days').value || 0));
      var res = await root.RGApi.callApi('updateReservationDetails', {
        reservationId: reservation.id,
        customerName: document.getElementById('re-customer').value,
        customerPhone: document.getElementById('re-phone').value,
        customerEmail: document.getElementById('re-email').value,
        customerIdNumber: document.getElementById('re-idnum').value,
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
      });
      if (!res.success) {
        var e = document.getElementById('res-edit-err');
        e.textContent = res.message;
        e.classList.remove('hidden');
        return;
      }
      if (root.RGApi && root.RGApi.clearCache) {
        root.RGApi.clearCache(['dashboard', 'reports', 'employees']);
      }
      ctx.toast('تم حفظ تعديلات تفاصيل الحجز بنجاح.');
      ctx.refreshNotifications();
      if (onSaved) onSaved();
      else modalRoot.innerHTML = '';
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
              '<select class="select" id="fue-status">' +
                (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(followUp.status) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
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
            '<button type="submit" class="btn btn-primary">حفظ التعديل</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    if (root.RGCrmMentions && root.RGCrmMentions.attach) {
      root.RGCrmMentions.attach(document.getElementById('fue-action'));
      root.RGCrmMentions.attach(document.getElementById('fue-notes'));
    }

    document.getElementById('fu-edit-cancel').addEventListener('click', function () {
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });

    document.getElementById('fu-edit-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var res = await root.RGApi.callApi('updateFollowUp', {
        followUpId: followUp.id,
        status: document.getElementById('fue-status').value,
        action: document.getElementById('fue-action').value,
        notes: document.getElementById('fue-notes').value,
        syncToReservation: document.getElementById('fue-sync').checked
      });
      if (!res.success) {
        var e = document.getElementById('fu-edit-err');
        e.textContent = res.message;
        e.classList.remove('hidden');
        return;
      }
      ctx.toast('تم تعديل سجل المتابعة بنجاح.');
      ctx.refreshNotifications();
      if (onSaved) onSaved();
      else modalRoot.innerHTML = '';
    });
  }

  function renderDrawerCharts(details) {
    var images = { finance: '', activity: '' };
    if (!root.Chart) return images;
    var r = details.reservation;
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
    if (finEl) {
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
    if (actEl) {
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

    function fallbackCapture(el, title) {
      if (!el) return null;
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
          _keepOptimisticCache: true
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
      });
    });
  }

  function openSingleReservationPdfModal(details, ctx, drawerCharts, onCancel) {
    var r = details.reservation;
    var isEn = ctx && ctx.lang === 'en';
    var capturedCharts = drawerCharts && drawerCharts.getImages ? drawerCharts.getImages() : [];
    var modalRoot = document.getElementById('modal-root');

    var initialSettings = (root.RGPdfControls && root.RGPdfControls.createDefaultState)
      ? root.RGPdfControls.createDefaultState({ paperSize: 'a4', orientation: 'portrait' })
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
            lines: noteLines
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
          return root.RGReports.exportArabicPdfDocument({
            title: spdfTitleVal,
            paperSize: s.paperSize,
            orientation: s.orientation,
            targetPages: s.targetPages,
            preset: s.preset,
            optimizeFileSize: s.optimizeFileSize,
            quality: s.quality,
            lang: ctx.lang,
            exporterName: user ? user.name : '',
            summaryItems: summary,
            extraSections: extraSections,
            chartImages: incCharts ? capturedCharts : [],
            filename: spdfFilename,
            signal: signal,
            previewOnly: Boolean(previewMode)
          });
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
