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

  function esc(val) {
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(status) {
    if (['تم الحجز', 'تم التسليم', 'تم الاستلام', 'مؤكد', 'مكتمل', 'مقبول', 'مدفوع', 'مدفوع بالمحفظة', 'معتمد إداريًا'].indexOf(status) !== -1) return 'status-success';
    if (['تم التمديد', 'تم الإنشاء', 'جديد', 'قيد الانتظار', 'بدأ التنفيذ', 'قيد التنفيذ', 'نشط', 'تم التمديد تلقائيًا', 'تم تغيير الموقع'].indexOf(status) !== -1) return 'status-info';
    if (['لم يتم الحجز', 'تم الإلغاء', 'ملغي', 'مرفوض', 'منتهي', 'لم يحضر', 'غير مدفوع', 'معلق'].indexOf(status) !== -1) return 'status-warning';
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

  function formatTimestamp(iso) {
    if (!iso) return '-';
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

  async function render(container, ctx) {
    var t = ctx.t;
    var currentUser = root.RGAuth.getUser();
    var currentEmpId = currentUser ? currentUser.id : '';

    var defaultCols = JSON.parse(localStorage.getItem('rg_crm_visible_cols_v2') || 'null') || ALL_COLUMNS.map(function (c) { return c.key; });
    var state = Object.assign({
      search: '', company: '', branch: '', status: '', employeeId: '', priority: '',
      dateFrom: '', dateTo: '', unfollowedOnly: false, hasProblemsOnly: false,
      sortBy: 'lastUpdatedAt', sortDir: 'desc', page: 1, pageSize: 20,
      visibleCols: defaultCols
    }, ctx.state.reservations || {});
    if (!Array.isArray(state.visibleCols) || state.visibleCols.length === 0) {
      state.visibleCols = defaultCols;
    }
    ctx.state.reservations = state;

    var [empRes, resData] = await Promise.all([
      root.RGApi.callApi('getEmployees', {}),
      root.RGApi.callApi('getReservations', state)
    ]);

    var employees = (empRes.success && empRes.data.items) || [];
    var payload = (resData.success && resData.data) || { items: [], total: 0, page: 1, totalPages: 1, facets: { companies: [], branches: [] } };
    var currentItems = payload.items || [];
    var currentTotalPages = payload.totalPages || 1;
    var facets = payload.facets || { companies: [], branches: [] };

    var canPullReservations = Boolean(currentUser && root.RGCrmCore.canUserPerform(currentUser, 'pull_reservations'));
    var isGeneralManager = Boolean(currentUser && currentUser.role === root.RGCrmCore.ROLES.GENERAL_MANAGER);
    var pullPresets = (root.RGCrmCore && root.RGCrmCore.PULL_DURATION_PRESETS) || [];
    var pullPresetState = state.pullPreset || 'all';

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">' + t('nav_reservations') + '</h2>' +
            '<p class="section-subtitle">إجمالي النتائج المطابقة: <strong class="tabular-nums" id="res-total-count">' + payload.total + '</strong> · يمكنك استلام أي حجز وتحديث حالته مباشرة أو فتح التفاصيل</p>' +
          '</div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            (canPullReservations ? '<button type="button" class="btn btn-charcoal" id="res-pull-btn" title="جلب أحدث الحجوزات والتمديدات">' + t('pull_reservations') + '</button>' : '') +
            '<button type="button" class="btn" id="res-cols-btn">' + t('toggle_columns') + '</button>' +
            '<button type="button" class="btn btn-primary" id="res-export-xlsx">' + t('export_excel') + '</button>' +
          '</div>' +
        '</div>' +
        (canPullReservations && isGeneralManager ? (
          '<div class="gm-pull-bar" id="res-gm-pull-bar">' +
            '<span class="gm-pull-label">تخصيص مدة سحب الحجوزات (المدير العام):</span>' +
            '<select class="select" id="res-pull-preset" aria-label="مدة السحب">' +
              pullPresets.map(function (p) {
                return '<option value="' + esc(p.key) + '"' + (pullPresetState === p.key ? ' selected' : '') + '>' + esc(p.label) + '</option>';
              }).join('') +
            '</select>' +
            '<div class="gm-pull-dates' + (pullPresetState === 'custom' ? '' : ' hidden') + '" id="res-pull-custom-dates">' +
              '<label class="gm-pull-date-field"><span>من تاريخ</span><input type="date" class="input" id="res-pull-from" value="' + esc(state.pullFrom || '') + '" aria-label="من تاريخ للسحب"></label>' +
              '<label class="gm-pull-date-field"><span>إلى تاريخ</span><input type="date" class="input" id="res-pull-to" value="' + esc(state.pullTo || '') + '" aria-label="إلى تاريخ للسحب"></label>' +
            '</div>' +
          '</div>'
        ) : '') +
        '<div class="filter-grid">' +
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
          '<select class="select" id="res-prio" aria-label="' + t('priority') + '"><option value="">' + t('all_priorities') + '</option>' +
            root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + esc(p) + '"' + (state.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
          '</select>' +
          '<input type="date" class="input" id="res-from" value="' + esc(state.dateFrom || '') + '" aria-label="' + t('from_date') + '">' +
          '<input type="date" class="input" id="res-to" value="' + esc(state.dateTo || '') + '" aria-label="' + t('to_date') + '">' +
        '</div>' +
        '<div class="toolbar-row">' +
          '<label class="checkbox-item"><input type="checkbox" id="res-unfollowed"' + (state.unfollowedOnly ? ' checked' : '') + '> ' + t('unfollowed_only') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="res-problems"' + (state.hasProblemsOnly ? ' checked' : '') + '> ' + t('has_problems_only') + '</label>' +
          '<button type="button" class="btn btn-sm" id="res-reset-filters">' + t('reset_filters') + '</button>' +
        '</div>' +
        '<div id="res-cols-panel" class="surface-card hidden" style="margin-bottom:14px;padding:12px;">' +
          '<div class="checkbox-grid">' +
            ALL_COLUMNS.map(function (col) {
              var checked = state.visibleCols.indexOf(col.key) !== -1 ? 'checked' : '';
              return '<label class="checkbox-item"><input type="checkbox" class="res-col-toggle" value="' + col.key + '" ' + checked + '> ' + col.label + '</label>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div id="res-table-region"></div>' +
      '</div>';

    var activeFetchSeq = 0;

    function buildTableRegionHtml(data) {
      var list = data.items || [];
      var visibleCols = ALL_COLUMNS.filter(function (c) { return state.visibleCols.indexOf(c.key) !== -1; });
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

              var tds = visibleCols.map(function (c) {
                var extCount = Number(r.extensionsCount || (r.hasExtensions ? 1 : 0));
                if (c.key === 'reservationNumber') {
                  return '<td class="mono"><button type="button" class="btn-link-inline btn-open-res" data-id="' + esc(r.id) + '">' + esc(r.reservationNumber) + '</button>' +
                    (extCount > 0 ? ' <span class="status-tag status-info tabular-nums">تمديد ×' + extCount + '</span>' : '') +
                    (r.hasProblem ? ' <span class="status-tag status-danger">مشكلة</span>' : '') + '</td>';
                }
                if (c.key === 'originalStatusAr') {
                  return '<td><span class="status-tag ' + statusClass(r.originalStatusAr) + '">' + esc(r.originalStatusAr) + '</span></td>';
                }
                if (c.key === 'internalStatus') {
                  return '<td>' +
                    '<select class="quick-status-select tbl-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة الحجز ' + esc(r.reservationNumber) + '">' +
                      (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
                        return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</td>';
                }
                if (c.key === 'priority') {
                  return '<td><span class="status-tag ' + priorityClass(r.priority) + '">' + esc(r.priority || 'عادي') + '</span></td>';
                }
                if (c.key === 'assignedEmployeeNames') {
                  if (!assignedNames.length) {
                    return '<td><span class="status-tag status-neutral">متاح للاستلام</span></td>';
                  }
                  return '<td><div style="display:flex;flex-wrap:wrap;gap:4px;">' +
                    assignedNames.map(function (n, idx) {
                      var isSelf = currentEmpId && assignedIds[idx] === currentEmpId;
                      return '<span class="status-tag ' + (isSelf ? 'status-success' : 'status-info') + '">' + esc(n) + '</span>';
                    }).join('') +
                  '</div></td>';
                }
                if (c.key === 'startDate') {
                  return '<td class="mono tabular-nums" style="white-space:nowrap;"><div>' + esc(formatDateOnly(r.startDate)) + '</div>' +
                    (r.startTime ? '<div class="time-sub">' + esc(r.startTime) + '</div>' : '') + '</td>';
                }
                if (c.key === 'endDate') {
                  var endTm = r.endTime || r.originalEndTime || '';
                  return '<td class="mono tabular-nums" style="white-space:nowrap;"><div>' + esc(formatDateOnly(r.endDate)) + '</div>' +
                    (endTm ? '<div class="time-sub">' + esc(endTm) + '</div>' : '') + '</td>';
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
                    (r.extendedUntilTime ? '<div class="time-sub">' + esc(r.extendedUntilTime) + '</div>' : '') + '</td>';
                }
                if (c.key === 'extensionsAmount') {
                  var extAmt = Number(r.extensionsAmount || 0);
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' + (extAmt > 0 ? (extAmt + ' ر.س') : '-') + '</td>';
                }
                if (c.key === 'totalAmount') {
                  return '<td class="mono tabular-nums" style="white-space:nowrap;"><strong>' + Number(r.totalAmount || 0) + ' ر.س</strong></td>';
                }
                if (c.key === 'lastUpdatedAt') {
                  return '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc(formatTimestamp(r.lastUpdatedAt)) + '</td>';
                }
                return '<td class="tabular-nums">' + esc(r[c.key] || '-') + '</td>';
              }).join('');

              var claimBtnHtml = isMine
                ? '<button type="button" class="btn btn-sm btn-danger btn-unclaim-res" data-id="' + esc(r.id) + '" title="إلغاء الاستلام من حسابك">مستلم ✓ · إلغاء</button>'
                : '<button type="button" class="btn btn-sm btn-charcoal btn-claim-res" data-id="' + esc(r.id) + '" title="استلام الحجز عندي للمتابعة">استلام عندي</button>';

              return '<tr data-res-id="' + esc(r.id) + '">' + tds +
                '<td><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
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
        btn.addEventListener('mouseenter', function () {
          if (root.RGApi && root.RGApi.prefetchReservationDetails) {
            root.RGApi.prefetchReservationDetails(rid);
          }
        });
        btn.addEventListener('focusin', function () {
          if (root.RGApi && root.RGApi.prefetchReservationDetails) {
            root.RGApi.prefetchReservationDetails(rid);
          }
        });
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
      if (root.RGApi && root.RGApi.prefetchReservationDetails && currentItems.length > 0) {
        var topRows = currentItems.slice(0, 5);
        setTimeout(function () {
          topRows.forEach(function (item) {
            if (item && item.id) root.RGApi.prefetchReservationDetails(item.id);
          });
        }, 40);
      }
    }

    function paintCurrentItems() {
      paintTableRegion({
        items: currentItems,
        total: Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length),
        page: state.page,
        totalPages: currentTotalPages
      });
    }

    async function refreshTableRegion() {
      var seq = ++activeFetchSeq;
      var resp = await root.RGApi.callApi('getReservations', state);
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
      state.unfollowedOnly = document.getElementById('res-unfollowed').checked;
      state.hasProblemsOnly = document.getElementById('res-problems').checked;
      state.page = 1;
      refreshTableRegion();
    }

    var searchTimer = null;
    document.getElementById('res-search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilterChange, 220);
    });

    ['res-company', 'res-branch', 'res-status', 'res-emp', 'res-prio', 'res-from', 'res-to', 'res-unfollowed', 'res-problems'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', applyFilterChange);
    });

    document.getElementById('res-reset-filters').addEventListener('click', function () {
      Object.assign(state, { search: '', company: '', branch: '', status: '', employeeId: '', priority: '', dateFrom: '', dateTo: '', unfollowedOnly: false, hasProblemsOnly: false, page: 1 });
      document.getElementById('res-search').value = '';
      document.getElementById('res-company').value = '';
      document.getElementById('res-branch').value = '';
      document.getElementById('res-status').value = '';
      document.getElementById('res-emp').value = '';
      document.getElementById('res-prio').value = '';
      document.getElementById('res-from').value = '';
      document.getElementById('res-to').value = '';
      document.getElementById('res-unfollowed').checked = false;
      document.getElementById('res-problems').checked = false;
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
          localStorage.setItem('rg_crm_visible_cols_v2', JSON.stringify(next));
          paintTableRegion({
            items: currentItems,
            total: Number((container.querySelector('#res-total-count') && container.querySelector('#res-total-count').textContent) || currentItems.length),
            page: state.page,
            totalPages: currentTotalPages
          });
        }
      });
    });

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
              if (chosenPreset === 'custom' && !chosenFrom && !chosenTo) {
                ctx.toast('يرجى تحديد تاريخ البداية عند اختيار السحب من تاريخ معين.', true);
                return;
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
              var msg = ctx.lang === 'en'
                ? ('Pulled reservations' + rangeNote + ': ' + (d.importedCount || 0) + ' new · ' + (d.updatedCount || 0) + ' updated · ' + (d.extensionsCount || 0) + ' extensions')
                : ('تم سحب الحجوزات بنجاح' + rangeNote + ': ' + (d.importedCount || 0) + ' جديد · ' + (d.updatedCount || 0) + ' محدث · ' + (d.extensionsCount || 0) + ' تمديد');
              ctx.toast(msg);
              ctx.refreshNotifications();
              refreshTableRegion();
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
          headers: ALL_COLUMNS.filter(function (c) { return state.visibleCols.indexOf(c.key) !== -1; }),
          rows: currentItems
        }], 'rental-gate-reservations.xlsx');
        ctx.toast('تم تصدير جدول الحجوزات إلى Excel.');
      } catch (err) {
        ctx.toast((err && err.message) || 'تعذر تصدير ملف Excel.', true);
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  async function openReservationDrawer(reservationId, ctx, employees, onUpdated, opts) {
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
      openReservationDrawer(d.reservation.id, ctx, employees, onUpdated, opts);
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
      return '<div class="surface-card" style="padding:14px;">' +
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

    function buildExtensionsSectionHtml(r, extensions) {
      var list = Array.isArray(extensions) ? extensions : [];
      var extSummary = (root.RGCrmCore && root.RGCrmCore.summarizeReservationExtensions)
        ? root.RGCrmCore.summarizeReservationExtensions(list, r, r.extendedUntilDate || r.endDate, r.extendedUntilTime || r.endTime)
        : null;
      var extCount = Number((extSummary && extSummary.extensionsCount) || r.extensionsCount || list.length || 0);
      var extDays = Number((extSummary && extSummary.extendedDaysCount) || r.extendedDaysCount || 0);
      var extAmount = Number((extSummary && extSummary.extensionsAmount) || r.extensionsAmount || 0);
      var extUntilDate = (extSummary && extSummary.extendedUntilDate) || r.extendedUntilDate || (extCount > 0 ? r.endDate : '');
      var extUntilTime = (extSummary && extSummary.extendedUntilTime) || r.extendedUntilTime || (extCount > 0 ? r.endTime : '');
      var items = (extSummary && extSummary.extensions && extSummary.extensions.length) ? extSummary.extensions : list;

      return '<div class="surface-card" id="drawer-extensions-section" style="padding:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<h4 style="margin:0;font-size:14px;">سجل وتفاصيل التمديدات (<span class="tabular-nums">' + extCount + '</span>)</h4>' +
          '<span style="font-size:12px;color:var(--text-muted);">عدد مرات التمديد، سعر كل تمديد، وتاريخ الانتهاء الفعلي بعد التمديد</span>' +
        '</div>' +
        '<div class="ext-summary-strip">' +
          '<div class="detail-kv"><span class="detail-k">كم مرة ممدد</span><span class="detail-v tabular-nums">' + extCount + ' ' + (extCount === 1 ? 'مرة' : 'مرات') + '</span></div>' +
          '<div class="detail-kv"><span class="detail-k">إجمالي أيام التمديد</span><span class="detail-v tabular-nums">' + extDays + ' يوم</span></div>' +
          '<div class="detail-kv"><span class="detail-k">إجمالي سعر التمديد</span><span class="detail-v mono tabular-nums">' + extAmount + ' ر.س</span></div>' +
          '<div class="detail-kv"><span class="detail-k">التمديد لحد</span><span class="detail-v mono tabular-nums">' + (extUntilDate ? (esc(formatDateOnly(extUntilDate)) + (extUntilTime ? ' · ' + esc(extUntilTime) : '')) : 'لا يوجد تمديد') + '</span></div>' +
        '</div>' +
        (items.length === 0
          ? '<div style="margin-top:10px;font-size:13px;color:var(--text-muted);">لا توجد تمديدات مسجلة لهذا الحجز حتى الآن.</div>'
          : '<div class="ext-list">' +
              items.map(function (ex, idx) {
                var seq = Number(ex.sequenceNumber || (idx + 1));
                var typeLbl = ex.extensionTypeAr || (root.RGCrmCore && root.RGCrmCore.translateExtensionType ? root.RGCrmCore.translateExtensionType(ex.extensionType) : (ex.extensionType || 'تمديد'));
                var payStAr = ex.paymentStatus
                  ? (root.RGCrmCore && root.RGCrmCore.translateOriginalStatus ? root.RGCrmCore.translateOriginalStatus(ex.paymentStatus) : ex.paymentStatus)
                  : '';
                var payLabel = ex.paymentMethod ? (ex.paymentMethod + (payStAr ? ' (' + payStAr + ')' : '')) : (payStAr || '-');
                var vatNote = (Number(ex.subTotal || 0) > 0 || Number(ex.vatAmount || 0) > 0)
                  ? ('صافي ' + Number(ex.subTotal || 0) + ' + ضريبة ' + Number(ex.vatAmount || 0))
                  : '';
                return '<div class="ext-item">' +
                  '<div class="ext-item-head">' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                      '<span class="stage-badge">#' + seq + '</span>' +
                      '<strong class="mono">' + esc(ex.extensionNumber || ('EXT-' + seq)) + '</strong>' +
                      '<span class="status-tag status-info">' + esc(typeLbl) + '</span>' +
                      (ex.statusAr ? '<span class="status-tag ' + statusClass(ex.statusAr) + '">' + esc(ex.statusAr) + '</span>' : '') +
                    '</div>' +
                    '<strong class="mono tabular-nums" style="color:var(--brand-primary);font-size:14px;">' + Number(ex.amount || 0) + ' ر.س</strong>' +
                  '</div>' +
                  '<div class="meta-inline">' +
                    '<span class="mono tabular-nums">' + esc(formatDateOnly(ex.startDate)) + (ex.startTime ? ' ' + esc(ex.startTime) : '') + ' ← ' + esc(formatDateOnly(ex.endDate)) + (ex.endTime ? ' ' + esc(ex.endTime) : '') + '</span>' +
                    '<span>·</span>' +
                    '<span class="tabular-nums"><strong>' + Number(ex.extendDays || 0) + '</strong> يوم</span>' +
                    (vatNote ? '<span>·</span><span class="tabular-nums">' + esc(vatNote) + '</span>' : '') +
                    (payLabel !== '-' ? '<span>·</span><span>الدفع: ' + esc(payLabel) + '</span>' : '') +
                    (ex.paymentDate ? '<span>·</span><span class="mono tabular-nums">' + esc(formatTimestamp(ex.paymentDate)) + '</span>' : '') +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>') +
      '</div>';
    }

    function paintDrawer() {
      var r = d.reservation;
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

      modalRoot.innerHTML =
        '<div class="drawer-backdrop" id="res-drawer-backdrop" data-res-id="' + esc(r.id) + '" role="dialog" aria-modal="true" aria-labelledby="drawer-res-title">' +
          '<div class="drawer-panel">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title mono" id="drawer-res-title">حجز ' + esc(r.reservationNumber) +
                  (r.sourceReservationId ? ' <span class="status-tag status-neutral">RG #' + esc(r.sourceReservationId) + '</span>' : '') +
                '</h3>' +
                '<div class="meta-inline">' +
                  '<span>' + esc(r.customerName) + '</span><span>·</span><span class="mono">' + esc(r.customerPhone) + '</span>' +
                  (r.customerEmail ? '<span>·</span><span class="mono">' + esc(r.customerEmail) + '</span>' : '') +
                  (r.customerIdNumber ? '<span>·</span><span class="mono">هوية: ' + esc(r.customerIdNumber) + '</span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="toolbar-row" style="margin-bottom:0;">' +
                (opts && opts.onBack ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-back-btn">' + esc(opts.backLabel || 'العودة لملف الموظف') + '</button>' : '') +
                (canEditReservation ? '<button type="button" class="btn btn-sm btn-charcoal" id="drawer-edit-res-btn">تعديل تفاصيل الحجز</button>' : '') +
                '<button type="button" class="btn btn-sm btn-primary" id="drawer-pdf-btn">تصدير PDF</button>' +
                '<button type="button" class="btn btn-sm btn-danger" id="drawer-problem-btn">تحويل إلى مشكلة</button>' +
                '<button type="button" class="btn btn-sm" id="drawer-close-btn">إغلاق</button>' +
              '</div>' +
            '</div>' +

            // Interactive Self-Service Claim / Unclaim & Quick Status Bar
            '<div class="surface-card" style="padding:14px;border-inline-start:3px solid #d32228;display:flex;flex-direction:column;gap:12px;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<span class="status-tag ' + statusClass(r.internalStatus) + '">' + esc(r.internalStatus) + '</span>' +
                  '<span class="status-tag ' + priorityClass(r.priority) + '">الأولوية: ' + esc(r.priority || 'عادي') + '</span>' +
                  (extCount > 0 ? '<span class="status-tag status-info tabular-nums">ممدد ' + extCount + '× (' + Number(r.extensionsAmount || 0) + ' ر.س)</span>' : '') +
                  '<span style="font-size:12.5px;color:var(--text-secondary);">المستلمون حاليًا: <strong class="tabular-nums">' + assignedIds.length + '</strong></span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  (isClaimedByMe
                    ? '<button type="button" class="btn btn-sm btn-danger" id="drawer-unclaim-btn">إلغاء الاستلام من عندي</button>'
                    : '<button type="button" class="btn btn-sm btn-primary" id="drawer-claim-btn">استلام الحجز عندي</button>') +
                '</div>' +
              '</div>' +
              '<div class="quick-status-bar grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)_auto] gap-2 items-center">' +
                '<select class="select" id="drawer-quick-status" aria-label="تحديث الحالة السريع">' +
                  (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
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
                (r.carCategory ? ' · ' + esc(r.carCategory) : '') + ' (' + esc(r.plateNumber || '-') + ')</span></div>' +
              '<div class="detail-kv"><span class="detail-k">بداية الحجز</span><span class="detail-v mono tabular-nums">' + esc(formatDateOnly(r.startDate)) +
                (r.startTime ? ' · ' + esc(r.startTime) : '') + '</span>' +
                (r.sourceCreatedAt ? '<span class="time-sub">أُنشئ بالمنصة: <span class="mono">' + esc(formatTimestamp(r.sourceCreatedAt)) + '</span></span>' : '') + '</div>' +
              '<div class="detail-kv"><span class="detail-k">نهاية الحجز الأصلية</span><span class="detail-v mono tabular-nums">' + esc(formatDateOnly(origEndD)) +
                (origEndT ? ' · ' + esc(origEndT) : '') + ' (' + Number(r.daysCount || 1) + ' يوم أساسي)</span></div>' +
              '<div class="detail-kv"><span class="detail-k">التمديد لحد (الإرجاع الفعلي)</span><span class="detail-v mono tabular-nums">' +
                (extUntilD ? (esc(formatDateOnly(extUntilD)) + (extUntilT ? ' · ' + esc(extUntilT) : '')) : 'لا يوجد تمديد') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">ملخص التمديد</span><span class="detail-v tabular-nums">' +
                (extCount > 0 ? (extCount + ' مرات · ' + extDays + ' يوم إضافي · ' + Number(r.extensionsAmount || 0) + ' ر.س') : 'غير ممدد') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">الاستلام / التسليم</span><span class="detail-v">' + esc(r.pickupTypeAr) + ' / ' + esc(r.returnTypeAr) + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">حالة المنصة / الداخلية</span><span class="detail-v">' + esc(r.originalStatusAr) +
                (r.originalStatusCode ? ' <span class="mono">(' + esc(r.originalStatusCode) + ')</span>' : '') + ' / ' + esc(r.internalStatus) + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">الدفع والتفصيل المالي</span><span class="detail-v tabular-nums">' +
                esc(r.paymentMethod || '-') + (r.paymentStatus ? ' (' + esc(r.paymentStatus) + ')' : '') +
                (Number(r.dailyPrice || 0) > 0 ? ' · يومي ' + Number(r.dailyPrice) + ' ر.س' : '') +
                (Number(r.vatAmount || 0) > 0 ? ' · ضريبة ' + Number(r.vatAmount) : '') +
                (Number(r.discountAmount || 0) > 0 ? ' · خصم ' + Number(r.discountAmount) : '') + '</span></div>' +
              '<div class="detail-kv"><span class="detail-k">آخر تحديث</span><span class="detail-v">' + esc(r.lastUpdateText || '-') + '</span></div>' +
            '</div>' +

            buildStatusStagesHtml(r) +

            // Collaborator Chips + Individual Removal (Supervisor/GM) + Self Unclaim reminder
            '<div class="surface-card" style="padding:14px;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
                '<h4 style="margin:0;font-size:14px;">الموظفون المشاركون في متابعة الحجز (' + assignedIds.length + ')</h4>' +
                '<span style="font-size:12px;color:var(--text-muted);">يمكن لأكثر من موظف استلام ومتابعة نفس الحجز معًا</span>' +
              '</div>' +
              (assignedIds.length === 0
                ? '<div style="font-size:13px;color:var(--text-muted);">لا يوجد موظفون مستلمون بعد — اضغط «استلام الحجز عندي» أعلاه للبدء فورًا.</div>'
                : '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
                    assignedIds.map(function (empId, idx) {
                      var empName = assignedNames[idx] || empId;
                      var isSelf = empId === user.id;
                      return '<span class="collab-chip">' +
                        '<span>' + esc(empName) + (isSelf ? ' (أنت)' : '') + '</span>' +
                        (canAssign
                          ? '<button type="button" class="collab-chip-remove drawer-remove-emp" data-emp-id="' + esc(empId) + '" data-emp-name="' + esc(empName) + '" title="إزالة إسناد ' + esc(empName) + '" aria-label="إزالة إسناد ' + esc(empName) + '">✕</button>'
                          : '') +
                      '</span>';
                    }).join('') +
                  '</div>') +
            '</div>' +

            '<div class="kpi-grid-3">' +
              '<div class="kpi-card"><span class="kpi-label">إجمالي الأيام</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + totalDays + '</span>' +
                (extDays > 0 ? '<span class="time-sub">' + Number(r.daysCount || 1) + ' أساسي + ' + extDays + ' تمديد</span>' : '') + '</div>' +
              '<div class="kpi-card"><span class="kpi-label">المبلغ الأساسي</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.baseAmount || 0) + '</span></div>' +
              '<div class="kpi-card"><span class="kpi-label">سعر التمديد (' + extCount + '×)</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.extensionsAmount || 0) + '</span></div>' +
              '<div class="kpi-card kpi-success"><span class="kpi-label">الإجمالي (ر.س)</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + Number(r.totalAmount || 0) + '</span></div>' +
              '<div class="kpi-card"><span class="kpi-label">المتابعات</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + d.followUps.length + '</span></div>' +
              '<div class="kpi-card ' + (d.problems.length ? 'kpi-danger' : '') + '"><span class="kpi-label">المشكلات</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + d.problems.length + '</span></div>' +
            '</div>' +

            buildExtensionsSectionHtml(r, d.extensions) +

            '<div class="charts-grid">' +
              '<div class="chart-card"><h4 class="chart-card-title">حالة الحجز والتفصيل المالي</h4><div class="chart-canvas-wrap" style="height:190px;"><canvas id="res-drawer-chart-finance"></canvas></div></div>' +
              '<div class="chart-card"><h4 class="chart-card-title">أداء الموظفين ونشاط الحجز</h4><div class="chart-canvas-wrap" style="height:190px;"><canvas id="res-drawer-chart-activity"></canvas></div></div>' +
            '</div>' +

            (canAssign ? (
              '<div class="surface-card" style="padding:14px;">' +
                '<h4 style="margin:0 0 10px;font-size:14px;">إدارة الإسناد من المشرف / المدير (تحديد متعدد)</h4>' +
                '<div class="checkbox-grid">' +
                  employees.filter(function (e) { return e.status === 'active'; }).map(function (emp) {
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

            '<div>' +
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
                      '<div>' + esc(f.action) + '</div>' +
                      (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + esc(f.notes) + '</div>' : '') +
                      '<div class="meta-inline mono"><span>' + esc(formatDateOnly(f.followUpDate)) + '</span><span>·</span><span>' + esc(f.followUpTime) + '</span></div>' +
                    '</div>';
                  }).join('') + '</div>') +
            '</div>' +

            (d.problems.length ? (
              '<div>' +
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
                    '<div>' + esc(p.description) + '</div>' +
                    '<div class="meta-inline"><span>بواسطة: ' + esc(p.createdByName) + '</span><span>·</span><span>المسؤولون: ' + esc((p.assignedEmployeeNames || []).join('، ') || '-') + '</span></div>' +
                  '</div>';
                }).join('') + '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>';

      document.getElementById('drawer-close-btn').addEventListener('click', function () { modalRoot.innerHTML = ''; });
      var backBtn = document.getElementById('drawer-back-btn');
      if (backBtn && opts && opts.onBack) {
        backBtn.addEventListener('click', function () { opts.onBack(); });
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
              var emp = employees.find(function (e) { return e.id === eid; });
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
            root.RGProblems.openProblemUpdateModal(enriched, employees, ctx, notifyParentUpdated, reopenSelf);
          }
        });
      });

      document.getElementById('drawer-problem-btn').addEventListener('click', function () {
        openCreateProblemModal(r, employees, ctx, notifyParentUpdated, reopenSelf);
      });

      var drawerCharts = renderDrawerCharts(d);

      document.getElementById('drawer-pdf-btn').addEventListener('click', function () {
        openSingleReservationPdfModal(d, ctx, drawerCharts, reopenSelf);
      });
    }

    paintDrawer();

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
            '<div class="form-group"><label class="form-label" for="re-start">تاريخ البداية</label><input type="date" class="input" id="re-start" value="' + esc(formatDateOnly(reservation.startDate) === '-' ? '' : formatDateOnly(reservation.startDate)) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-start-time">وقت البداية</label><input class="input mono" id="re-start-time" placeholder="14:30" value="' + esc(reservation.startTime || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="re-end">نهاية الحجز الفعلية</label><input type="date" class="input" id="re-end" value="' + esc(formatDateOnly(reservation.endDate) === '-' ? '' : formatDateOnly(reservation.endDate)) + '"></div>' +
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
              '<div class="meta-inline"><span>الموظف: ' + esc(followUp.employeeName) + '</span><span>·</span><span class="mono">' + esc(formatDateOnly(followUp.followUpDate)) + ' ' + esc(followUp.followUpTime) + '</span></div>' +
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
    var txtColor = isDark ? '#cfd1d3' : '#313232';
    var gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(49,50,50,0.07)';

    var finEl = document.getElementById('res-drawer-chart-finance');
    if (finEl) {
      new root.Chart(finEl.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['المبلغ الأساسي', 'التمديدات المعتمدة'],
          datasets: [{
            data: [Number(r.baseAmount || 0), Number(r.extensionsAmount || 0)],
            backgroundColor: ['#313232', '#d32228'],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { labels: { color: txtColor, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } } } }
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
              return lbl === 'المشكلات' ? '#d32228' : (idx % 2 === 0 ? '#313232' : '#555757');
            }),
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: txtColor }, grid: { display: false } },
            y: { ticks: { color: txtColor, precision: 0 }, grid: { color: gridColor }, beginAtZero: true }
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
    var capturedCharts = drawerCharts && drawerCharts.getImages ? drawerCharts.getImages() : [];
    var modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="single-pdf-title">' +
        '<div class="modal-panel">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="single-pdf-title">إعدادات وتصدير PDF للحجز ' + esc(r.reservationNumber) + '</h3>' +
            '<button type="button" class="btn btn-sm" id="spdf-close">إغلاق</button>' +
          '</div>' +
          '<div class="form-grid-3">' +
            '<div class="form-group"><label class="form-label" for="spdf-title">عنوان التقرير</label><input class="input" id="spdf-title" value="ملف الحجز رقم ' + esc(r.reservationNumber) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="spdf-paper">حجم الورق</label><select class="select" id="spdf-paper"><option value="a4">A4</option><option value="letter">Letter</option></select></div>' +
            '<div class="form-group"><label class="form-label" for="spdf-orient">اتجاه الصفحة</label><select class="select" id="spdf-orient"><option value="portrait">عمودي (Portrait)</option><option value="landscape">أفقي (Landscape)</option></select></div>' +
          '</div>' +
          '<div class="kpi-grid-4">' +
            '<div class="kpi-card"><span class="kpi-label">أيام الحجز</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + Number(r.daysCount || 0) + '</span></div>' +
            '<div class="kpi-card kpi-success"><span class="kpi-label">الإجمالي (ر.س)</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + Number(r.totalAmount || 0) + '</span></div>' +
            '<div class="kpi-card"><span class="kpi-label">المتابعات</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + details.followUps.length + '</span></div>' +
            '<div class="kpi-card ' + (details.problems.length ? 'kpi-danger' : '') + '"><span class="kpi-label">المشكلات</span><span class="kpi-value tabular-nums" style="font-size:18px;">' + details.problems.length + '</span></div>' +
          '</div>' +
          '<div>' +
            '<div class="form-label" style="margin-bottom:8px;">اختر البيانات المراد تضمينها في التقرير:</div>' +
            '<div class="checkbox-grid">' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-counters" checked> العدادات والملخص المالي</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-charts" checked> الرسوم البيانية المصغرة (حالة الحجز وأداء الموظف)</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-followups" checked> المتابعات</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-stages" checked> مراحل تطور الحالة</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-notes" checked> الملاحظات</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-problems" checked> المشكلات وتحديثاتها</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-customer" checked> بيانات العميل</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-booking" checked> بيانات الحجز والتمديدات</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-staff" checked> الموظفون المسؤولون</label>' +
              '<label class="checkbox-item"><input type="checkbox" id="spdf-last" checked> آخر تحديث</label>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-primary" id="spdf-export">تصدير ملف PDF الآن</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('spdf-close').addEventListener('click', function () {
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });
    document.getElementById('spdf-export').addEventListener('click', async function () {
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
            return formatDateOnly(f.followUpDate) + ' ' + f.followUpTime + ' | ' + f.employeeName + ' [' + f.status + ']: ' + f.action + (incNotes && f.notes ? ' — ملاحظة: ' + f.notes : '');
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

      var user = root.RGAuth.getUser();
      await root.RGReports.exportArabicPdfDocument({
        title: document.getElementById('spdf-title').value || ('ملف الحجز رقم ' + r.reservationNumber),
        paperSize: document.getElementById('spdf-paper').value,
        orientation: document.getElementById('spdf-orient').value,
        exporterName: user ? user.name : '',
        summaryItems: summary,
        extraSections: extraSections,
        chartImages: incCharts ? capturedCharts : [],
        filename: 'reservation-' + r.reservationNumber + '.pdf'
      });
      ctx.toast('تم تصدير ملف الحجز بصيغة PDF مع العدادات والرسوم البيانية.');
      if (onCancel) onCancel();
      else modalRoot.innerHTML = '';
    });
  }

  root.RGReservations = {
    render: render,
    openReservationDrawer: openReservationDrawer
  };
})(window);
