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

  function statusClass(status) {
    if (['مؤكد', 'مقبول', 'تم الحجز', 'تم التسليم', 'تم الاستلام', 'تم التسليم من قبل السائق', 'تم الإرجاع', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مدفوع بالمحفظة', 'معتمد إداريًا'].indexOf(status) !== -1) return 'status-success';
    if (['نشط الآن', 'قيد الانتظار', 'في الطريق', 'جديد', 'تم التمديد', 'تم التمديد تلقائيًا', 'تم تغيير الموقع', 'تم الإنشاء', 'ناشط', 'نشط', 'بدأ التنفيذ', 'قيد التنفيذ', 'جاهز للاستلام'].indexOf(status) !== -1) return 'status-info';
    if (['معلق', 'بانتظار الدفع', 'لم يتم الحجز'].indexOf(status) !== -1) return 'status-warning';
    if (['ملغي', 'تم الإلغاء', 'مرفوض', 'غير مدفوع'].indexOf(status) !== -1) return 'status-danger';
    return 'status-neutral';
  }

  async function renderMyFollowUps(container, ctx) {
    var t = ctx.t;
    var [res, empRes] = await Promise.all([
      root.RGApi.callApi('getMyFollowUps', {}),
      root.RGApi.callApi('getEmployees', {})
    ]);
    if (!res.success) {
      container.innerHTML = '<div class="form-error">' + esc(res.message) + '</div>';
      return;
    }

    var employees = (empRes.success && empRes.data.items) || [];
    var assigned = res.data.assignedReservations || [];
    var followUps = res.data.followUps || [];

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_my_followups') + '</h2><p class="section-subtitle">الحجوزات المستلمة والمسندة إليك (<strong class="tabular-nums">' + assigned.length + '</strong>) وسجل متابعاتك (<strong class="tabular-nums">' + followUps.length + '</strong>)</p></div>' +
        '</div>' +
        (assigned.length === 0
          ? '<div class="empty-state">لا توجد حجوزات مستلمة في قائمتك حاليًا — يمكنك استلام أي حجز من صفحة الحجوزات مباشرة.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>رقم الحجز</th><th>العميل</th><th>الجوال</th><th>الشركة</th><th>السيارة</th><th>الحالة الداخلية</th><th>آخر تحديث</th><th>إجراءات</th>' +
            '</tr></thead><tbody>' +
              assigned.map(function (r) {
                return '<tr>' +
                  '<td class="mono"><strong dir="ltr">' + esc(r.reservationNumber) + '</strong></td>' +
                  '<td>' + esc(r.customerName) + '</td>' +
                  '<td class="mono"><span class="cell-phone" dir="ltr">' + esc(r.customerPhone) + '</span></td>' +
                  '<td>' + esc(r.companyName) + '</td>' +
                  '<td>' + esc(r.carName) + '</td>' +
                  '<td>' +
                    '<select class="quick-status-select myfu-quick-status" data-id="' + esc(r.id) + '" aria-label="تحديث حالة ' + esc(r.reservationNumber) + '">' +
                      (root.RGCrmCore.getWorkflowStatusOptions ? root.RGCrmCore.getWorkflowStatusOptions(r.internalStatus) : root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) {
                        return '<option value="' + esc(s) + '"' + (r.internalStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(r.lastUpdateText || '') + '">' + esc(r.lastUpdateText || '-') + '</div></td>' +
                  '<td class="table-actions-cell"><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                    '<button type="button" class="btn btn-sm btn-primary myfu-open" data-id="' + esc(r.id) + '">متابعة / تفاصيل</button>' +
                    '<button type="button" class="btn btn-sm btn-danger myfu-unclaim" data-id="' + esc(r.id) + '">إلغاء الاستلام</button>' +
                  '</div></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>') +
      '</div>' +
      '<div class="surface-card">' +
        '<div class="section-header"><h3 class="section-title">سجل متابعاتي السابقة</h3></div>' +
        (followUps.length === 0
          ? '<div class="empty-state">لم تقم بتسجيل أي متابعات بعد.</div>'
          : '<div class="timeline-list">' + followUps.map(function (f) {
              return '<div class="timeline-item">' +
                '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn-link-inline mono myfu-open" data-id="' + esc(f.reservationId) + '"><span dir="ltr">' + esc(f.reservationNumber) + '</span> — ' + esc(f.customerName) + '</button>' +
                  '<span class="status-tag ' + statusClass(f.status) + '">' + esc(f.status) + '</span>' +
                '</div>' +
                '<div>' + esc(f.action) + '</div>' +
                (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + esc(f.notes) + '</div>' : '') +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<div class="meta-inline mono" style="white-space:nowrap;"><span>' + esc((root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + '</span><span>·</span><span>' + esc(f.followUpTime) + '</span></div>' +
                  '<button type="button" class="btn btn-sm myfu-open" data-id="' + esc(f.reservationId) + '">تفاصيل الحجز</button>' +
                '</div>' +
              '</div>';
            }).join('') + '</div>') +
      '</div>';

    function runWithLock(btnEl, lockKey, fn) {
      if (root.RGApp && root.RGApp.withActionLock) {
        return root.RGApp.withActionLock(btnEl, lockKey, fn);
      }
      return Promise.resolve().then(fn);
    }

    container.querySelectorAll('.myfu-quick-status').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var rid = sel.getAttribute('data-id');
        var nextStatus = sel.value;
        var currentUser = root.RGAuth.getUser();
        runWithLock(sel, 'quickUpdateReservationStatus:' + rid, function () {
          if (root.RGApi.applyOptimisticMutation) {
            root.RGApi.applyOptimisticMutation('quickUpdateReservationStatus', {
              reservationId: rid,
              status: nextStatus
            }, currentUser);
          }
          ctx.toast('تم تحديث حالة الحجز إلى: ' + nextStatus);
          var rowEl = sel.closest('tr');
          if (rowEl && rowEl.cells && rowEl.cells[6]) {
            rowEl.cells[6].textContent = 'تحديث سريع للحالة إلى: ' + nextStatus;
          }
          return root.RGApi.callApi('quickUpdateReservationStatus', {
            reservationId: rid,
            status: nextStatus,
            _keepOptimisticCache: true
          }).then(function (resp) {
            if (resp && resp.success) {
              ctx.refreshNotifications();
            } else {
              ctx.toast((resp && resp.message) || 'تعذر تحديث الحالة.', true);
              renderMyFollowUps(container, ctx);
            }
          }).catch(function () {
            ctx.toast('تعذر الاتصال بالخادم أثناء تحديث الحالة.', true);
            renderMyFollowUps(container, ctx);
          });
        });
      });
    });

    container.querySelectorAll('.myfu-unclaim').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rid = btn.getAttribute('data-id');
        var currentUser = root.RGAuth.getUser();
        runWithLock(btn, 'unclaimReservation:' + rid, function () {
          if (root.RGApi.applyOptimisticMutation) {
            root.RGApi.applyOptimisticMutation('unclaimReservation', { reservationId: rid }, currentUser);
          }
          var rowEl = btn.closest('tr');
          if (rowEl && rowEl.parentNode) {
            rowEl.parentNode.removeChild(rowEl);
          }
          ctx.toast('تم إلغاء استلام الحجز.');
          return root.RGApi.callApi('unclaimReservation', {
            reservationId: rid,
            _keepOptimisticCache: true
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
        });
      });
    });

    container.querySelectorAll('.myfu-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.RGReservations.openReservationDrawer(btn.getAttribute('data-id'), ctx, employees, function () {
          renderMyFollowUps(container, ctx);
        });
      });
    });
  }

  async function renderTeamFollowUps(container, ctx) {
    var t = ctx.t;
    var state = ctx.state.teamFollowUps || { employeeId: '', status: '', date: '' };
    ctx.state.teamFollowUps = state;

    var [empRes, fuRes, empDetailRes] = await Promise.all([
      root.RGApi.callApi('getEmployees', {}),
      root.RGApi.callApi('getTeamFollowUps', state),
      state.employeeId ? root.RGApi.callApi('getEmployeeDetails', { employeeId: state.employeeId }) : Promise.resolve(null)
    ]);
    var employees = (empRes.success && empRes.data.items) || [];
    var items = (fuRes.success && fuRes.data.items) || [];
    var empDetails = (empDetailRes && empDetailRes.success) ? empDetailRes.data : null;

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_team_followups') + '</h2><p class="section-subtitle">سجل متابعات الفريق بالكامل — اضغط على أي حجز للاطلاع على كامل التفاصيل</p></div>' +
          (state.employeeId ? '<button type="button" class="btn btn-sm btn-primary" id="tfu-open-emp-profile">فتح ملف عملاء الموظف بالكامل</button>' : '') +
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
                      '<div class="res-story-box"><strong>ما حدث:</strong> ' + esc(story) + '</div>' +
                      '<div style="font-size:12px;color:var(--brand-primary);font-weight:700;">عرض تفاصيل الحجز ←</div>' +
                    '</button>';
                  }).join('') +
                '</div>') +
          '</div>'
        ) : '') +
        (items.length === 0
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
                  '<td><div class="cell-clamp-2" title="' + esc(f.action || '') + '">' + esc(f.action) + '</div></td>' +
                  '<td><div class="cell-clamp-2" title="' + esc(f.notes || '') + '">' + esc(f.notes || '-') + '</div></td>' +
                  '<td class="mono tabular-nums" style="white-space:nowrap;">' + esc((root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(f.followUpDate) : f.followUpDate) || '-') + ' ' + esc(f.followUpTime) + '</td>' +
                  '<td class="table-actions-cell"><button type="button" class="btn btn-sm btn-primary tfu-open-res" data-res-id="' + esc(f.reservationId) + '">التفاصيل</button></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>') +
      '</div>';

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
  }

  root.RGFollowUps = {
    renderMyFollowUps: renderMyFollowUps,
    renderTeamFollowUps: renderTeamFollowUps
  };
})(window);
