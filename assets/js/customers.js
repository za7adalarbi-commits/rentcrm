/**
 * RENTAL GATE CRM — Unified Customer Management System & Full Customer Profile
 */
(function (root) {
  'use strict';

  var currentProfileState = {
    customerId: '',
    tab: 'overview',
    data: null,
    loading: false
  };
  var deltaBound = false;
  var searchDebounceTimer = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function coreFn() {
    return root.RGCrmCore || {};
  }

  function getCustomersState(ctx) {
    var st = (ctx && ctx.state) || (root.RGApp && root.RGApp.getState && root.RGApp.getState()) || {};
    if (!st.customers || typeof st.customers !== 'object') {
      st.customers = {
        search: '',
        status: '',
        company: '',
        assignedEmployeeId: '',
        problemFilter: '',
        kpiFilter: 'all',
        sortBy: 'last_activity',
        page: 1,
        pageSize: 50,
        selectedCustomerId: ''
      };
    }
    return st.customers;
  }

  function fmtCurrency(val) {
    var num = Number(val || 0);
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ر.س';
  }

  function fmtDateTime(val, ctx) {
    if (!val) return '-';
    if (ctx && ctx.formatDateTime) return ctx.formatDateTime(val);
    if (root.RGApp && root.RGApp.formatDateTime) return root.RGApp.formatDateTime(val);
    if (coreFn().formatDisplayDateTime) return coreFn().formatDisplayDateTime(val);
    return String(val).replace('T', ' ').slice(0, 16);
  }

  function statusTagClass(st) {
    var s = String(st || '').trim();
    if (s === 'لديه مشكلة' || s === 'محظور') return 'status-danger';
    if (s === 'يحتاج متابعة') return 'status-warning';
    if (s === 'VIP' || s === 'نشط' || s === 'متكرر') return 'status-success';
    if (s === 'جديد') return 'status-info';
    return 'status-neutral';
  }

  function bindGlobalDeltaRefresh() {
    if (deltaBound) return;
    deltaBound = true;
    document.addEventListener('rg:deltasync', function (ev) {
      var detail = (ev && ev.detail) || {};
      var scopes = Array.isArray(detail.scopes) ? detail.scopes : [];
      var shouldRefresh = scopes.indexOf('customers') !== -1 || scopes.indexOf('reservations') !== -1 || scopes.indexOf('problems') !== -1;
      if (!shouldRefresh) return;
      var activeNav = document.querySelector('.nav-item.active');
      if (!activeNav || activeNav.getAttribute('data-route') !== 'customers') return;
      var slot = document.querySelector('#page-content .route-view') || document.getElementById('page-content');
      if (!slot || !root.RGApp) return;
      if (currentProfileState.customerId && root.RGApi && root.RGApi.markScopesStale) {
        root.RGApi.markScopesStale(['customers']);
      }
      render(slot, root.RGApp && root.RGApp.buildAppCtx ? root.RGApp.buildAppCtx() : { toast: function () {} }).catch(function () {});
    });
  }

  function openCustomerFormModal(existingCustomer, facets, ctx, onSaved) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var canViewId = core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false;
    var statuses = (facets && Array.isArray(facets.statuses) && facets.statuses.length)
      ? facets.statuses
      : (core.CUSTOMER_STATUS_LIST || ['جديد', 'نشط', 'متكرر', 'VIP', 'يحتاج متابعة', 'لديه مشكلة', 'غير نشط', 'محظور']);
    var isEdit = Boolean(existingCustomer && existingCustomer.id);
    var c = existingCustomer || {};
    var emps = (facets && Array.isArray(facets.employees)) ? facets.employees : [];

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="cust-form-modal" role="dialog" aria-modal="true">' +
        '<div class="modal-panel" style="max-width:620px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">' + (isEdit ? 'تعديل بيانات العميل: ' + esc(c.fullName) : '+ إضافة عميل جديد') + '</h3>' +
            '<button type="button" class="btn btn-sm" id="cf-close">إغلاق</button>' +
          '</div>' +
          '<form id="cf-form" class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
            '<div class="form-group md:col-span-2"><label class="form-label" for="cf-name">الاسم الكامل *</label><input class="input" id="cf-name" value="' + esc(c.fullName || '') + '" required></div>' +
            '<div class="form-group"><label class="form-label" for="cf-phone">رقم الجوال *</label><input class="input mono" dir="ltr" id="cf-phone" value="' + esc(c.phone || '') + '" placeholder="+966501234567" ' + (isEdit ? '' : 'required') + '></div>' +
            '<div class="form-group"><label class="form-label" for="cf-cc">مفتاح الدولة</label><input class="input mono" dir="ltr" id="cf-cc" value="' + esc(c.countryCode || '') + '" placeholder="+966"></div>' +
            '<div class="form-group"><label class="form-label" for="cf-email">البريد الإلكتروني</label><input class="input mono" dir="ltr" type="email" id="cf-email" value="' + esc(c.email || '') + '"></div>' +
            '<div class="form-group"><label class="form-label" for="cf-status">حالة العميل</label>' +
              '<select class="input" id="cf-status">' +
                statuses.map(function (st) {
                  return '<option value="' + esc(st) + '"' + (c.status === st ? ' selected' : '') + '>' + esc(st) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            (canViewId ? (
              '<div class="form-group"><label class="form-label" for="cf-idnum">رقم الهوية / الإقامة / الجواز</label><input class="input mono" dir="ltr" id="cf-idnum" value="' + esc(c.idNumber || '') + '"></div>' +
              '<div class="form-group"><label class="form-label" for="cf-idtype">نوع الهوية</label>' +
                '<select class="input" id="cf-idtype">' +
                  '<option value="">تحديد تلقائي</option>' +
                  '<option value="هوية وطنية"' + (c.idType === 'هوية وطنية' ? ' selected' : '') + '>هوية وطنية</option>' +
                  '<option value="إقامة"' + (c.idType === 'إقامة' ? ' selected' : '') + '>إقامة</option>' +
                  '<option value="جواز سفر"' + (c.idType === 'جواز سفر' ? ' selected' : '') + '>جواز سفر</option>' +
                '</select>' +
              '</div>'
            ) : '') +
            (!isEdit && emps.length ? (
              '<div class="form-group md:col-span-2"><label class="form-label" for="cf-emp">الموظف المسؤول</label>' +
                '<select class="input" id="cf-emp"><option value="">غير مسند</option>' +
                emps.map(function (e) {
                  return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
                }).join('') +
                '</select>' +
              '</div>'
            ) : '') +
            '<div class="form-group md:col-span-2"><label class="form-label" for="cf-notes">ملاحظات داخلية</label><textarea class="input" id="cf-notes" rows="3">' + esc(c.notes || '') + '</textarea></div>' +
            '<div class="md:col-span-2 flex justify-end gap-2 pt-2">' +
              '<button type="button" class="btn" id="cf-cancel">إلغاء</button>' +
              '<button type="submit" class="btn btn-primary" id="cf-submit">' + (isEdit ? 'حفظ التعديلات' : 'إنشاء ملف العميل') + '</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    var closeModal = function () { modalRoot.innerHTML = ''; };
    document.getElementById('cf-close').addEventListener('click', closeModal);
    document.getElementById('cf-cancel').addEventListener('click', closeModal);

    document.getElementById('cf-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var submitBtn = document.getElementById('cf-submit');
      if (submitBtn) submitBtn.disabled = true;
      try {
        var payload = {
          fullName: document.getElementById('cf-name').value.trim(),
          phone: document.getElementById('cf-phone').value.trim(),
          countryCode: document.getElementById('cf-cc').value.trim(),
          email: document.getElementById('cf-email').value.trim(),
          status: document.getElementById('cf-status').value,
          notes: document.getElementById('cf-notes').value.trim()
        };
        if (canViewId) {
          var idInp = document.getElementById('cf-idnum');
          var idTypeInp = document.getElementById('cf-idtype');
          if (idInp) payload.idNumber = idInp.value.trim();
          if (idTypeInp && idTypeInp.value) payload.idType = idTypeInp.value;
        }
        var res;
        if (isEdit) {
          payload.customerId = c.id;
          res = await root.RGApi.callApi('updateCustomerProfile', payload);
        } else {
          var empInp = document.getElementById('cf-emp');
          if (empInp) payload.assignedEmployeeId = empInp.value;
          res = await root.RGApi.callApi('createCustomer', payload);
        }
        if (!res || !res.success) {
          if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر حفظ بيانات العميل.', true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        closeModal();
        if (ctx && ctx.toast) ctx.toast(isEdit ? 'تم تحديث بيانات العميل بنجاح.' : 'تم إنشاء ملف العميل بنجاح.');
        if (typeof onSaved === 'function') onSaved(res.data);
      } catch (err) {
        if (ctx && ctx.toast) ctx.toast((err && err.message) || 'حدث خطأ غير متوقع.', true);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function openCustomerComplaintModal(customer, reservations, ctx, onSaved) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var core = coreFn();
    var priorities = core.PROBLEM_PRIORITIES || ['منخفض', 'متوسط', 'مرتفع'];

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="cust-prb-modal" role="dialog" aria-modal="true">' +
        '<div class="modal-panel" style="max-width:560px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">+ تسجيل شكوى أو مشكلة للعميل: ' + esc(customer.fullName) + '</h3>' +
            '<button type="button" class="btn btn-sm" id="cp-close">إغلاق</button>' +
          '</div>' +
          '<form id="cp-form" class="flex flex-col gap-3">' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
              '<div class="form-group"><label class="form-label" for="cp-type">النوع</label>' +
                '<select class="input" id="cp-type">' +
                  '<option value="شكوى">شكوى عميل</option>' +
                  '<option value="مشكلة">مشكلة تشغيلية</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="cp-prio">الأولوية</label>' +
                '<select class="input" id="cp-prio">' +
                  priorities.map(function (p) {
                    return '<option value="' + esc(p) + '"' + (p === 'مرتفع' ? ' selected' : '') + '>' + esc(p) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="cp-res">ربط بحجز (اختياري)</label>' +
              '<select class="input" id="cp-res">' +
                '<option value="">بدون ربط بحجز محدد</option>' +
                (reservations || []).map(function (r) {
                  return '<option value="' + esc(r.id) + '" data-num="' + esc(r.reservationNumber) + '">' + esc(r.reservationNumber + ' — ' + (r.carName || r.companyName || '')) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="cp-desc">التفاصيل *</label><textarea class="input" id="cp-desc" rows="4" required placeholder="اكتب تفاصيل الشكوى أو المشكلة (يمكنك استخدام @ للإشارة لموظف)..."></textarea></div>' +
            '<div class="flex justify-end gap-2">' +
              '<button type="button" class="btn" id="cp-cancel">إلغاء</button>' +
              '<button type="submit" class="btn btn-primary" id="cp-submit">حفظ وإرسال</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    var closeModal = function () { modalRoot.innerHTML = ''; };
    document.getElementById('cp-close').addEventListener('click', closeModal);
    document.getElementById('cp-cancel').addEventListener('click', closeModal);

    document.getElementById('cp-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var submitBtn = document.getElementById('cp-submit');
      if (submitBtn) submitBtn.disabled = true;
      try {
        var resSel = document.getElementById('cp-res');
        var resOpt = resSel && resSel.selectedOptions ? resSel.selectedOptions[0] : null;
        var resId = resSel ? resSel.value : '';
        var resNum = resOpt ? (resOpt.getAttribute('data-num') || '') : '';
        var resp = await root.RGApi.callApi('createProblem', {
          customerId: customer.id,
          customerName: customer.fullName,
          reservationId: resId,
          reservationNumber: resNum,
          ticketType: document.getElementById('cp-type').value,
          priority: document.getElementById('cp-prio').value,
          description: document.getElementById('cp-desc').value.trim()
        });
        if (!resp || !resp.success) {
          if (ctx && ctx.toast) ctx.toast((resp && resp.message) || 'تعذر تسجيل الشكوى/المشكلة.', true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        closeModal();
        if (ctx && ctx.toast) ctx.toast('تم التسجيل وربط التذكرة بملف العميل بنجاح.');
        if (typeof onSaved === 'function') onSaved(resp.data);
      } catch (err) {
        if (ctx && ctx.toast) ctx.toast((err && err.message) || 'حدث خطأ غير متوقع.', true);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function renderProfileView(container, ctx, data) {
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var activeUiCtx = root.RGApp && root.RGApp.getActiveUiContext ? root.RGApp.getActiveUiContext() : null;
    var cust = (data && data.customer) || {};
    var reservations = (data && Array.isArray(data.reservations)) ? data.reservations : [];
    var extensions = (data && Array.isArray(data.extensions)) ? data.extensions : [];
    var problems = (data && Array.isArray(data.problems)) ? data.problems : [];
    var followUps = (data && Array.isArray(data.followUps)) ? data.followUps : [];
    var notes = (data && Array.isArray(data.notes)) ? data.notes : [];
    var fin = (data && data.financialSummary) || {};
    var timeline = (data && Array.isArray(data.timeline)) ? data.timeline : [];
    var employees = (data && Array.isArray(data.employees)) ? data.employees : [];

    var canViewId = core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false;
    var canEditCust = core.canUserPerform && core.canUserPerform(user, 'edit_customer_details') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_edit_customer', activeUiCtx));
    var canAssignCust = core.canUserPerform && core.canUserPerform(user, 'assign_customer_employee') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_assign_customer', activeUiCtx));
    var canAddNote = core.canUserPerform && core.canUserPerform(user, 'add_customer_note') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_add_customer_note', activeUiCtx));
    var canCreatePrb = core.canUserPerform && core.canUserPerform(user, 'create_problem');
    var canExportPdf = !core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_pdf', activeUiCtx);
    var canSeeComplaintsTab = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_complaints', activeUiCtx);
    var canSeeTimelineTab = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_timeline', activeUiCtx);

    var waPhone = core.normalizeWhatsappPhone ? core.normalizeWhatsappPhone(cust.phone) : '';
    var telHref = core.formatDirectCallTelHref ? core.formatDirectCallTelHref(cust.phone, '9') : '';
    var initial = String(cust.fullName || 'ع').trim().charAt(0) || 'ع';

    var activeTab = currentProfileState.tab || 'overview';
    if (activeTab === 'complaints' && !canSeeComplaintsTab) activeTab = 'overview';
    if (activeTab === 'timeline' && !canSeeTimelineTab) activeTab = 'overview';
    currentProfileState.tab = activeTab;

    var resRowsHtml = reservations.length === 0
      ? '<tr><td colspan="8" class="text-center py-6" style="color:var(--text-muted);">لا توجد حجوزات مرتبطة بهذا العميل.</td></tr>'
      : reservations.map(function (r) {
          var isPast = (core.isInactiveReservation && core.isInactiveReservation(r)) || /(completed|finished|closed|ended|returned|مكتمل|منتهي|مغلق)/i.test((r.originalStatusCode || '') + ' ' + (r.internalStatus || ''));
          return '<tr>' +
            '<td class="rg-cust-nowrap"><button type="button" class="btn-link-inline cust-open-res mono rg-cust-nowrap" data-res-id="' + esc(r.id) + '" dir="ltr">' + esc(r.reservationNumber || r.id) + '</button></td>' +
            '<td>' + esc(r.companyName || '-') + '</td>' +
            '<td>' + esc(r.carName || '-') + (r.plateNumber ? ' <span class="mono text-xs rg-cust-nowrap" style="color:var(--text-muted);">(' + esc(r.plateNumber) + ')</span>' : '') + '</td>' +
            '<td class="mono tabular-nums text-xs rg-cust-nowrap" dir="ltr">' + esc(r.startDate || '-') + '</td>' +
            '<td class="mono tabular-nums text-xs rg-cust-nowrap" dir="ltr">' + esc(r.extendedUntilDate || r.endDate || '-') + '</td>' +
            '<td class="tabular-nums text-xs font-semibold rg-cust-nowrap">' + esc(fmtCurrency(r.totalAmount)) + '</td>' +
            '<td class="rg-cust-nowrap"><span class="status-tag ' + (isPast ? 'status-neutral' : 'status-success') + '">' + esc(r.internalStatus || r.originalStatusAr || '-') + '</span></td>' +
            '<td class="tabular-nums text-xs">' + (Number(r.extensionsCount || 0) > 0 ? '<strong style="color:var(--brand-primary);">' + Number(r.extensionsCount) + '</strong>' : '0') + '</td>' +
          '</tr>';
        }).join('');

    var extRowsHtml = extensions.length === 0
      ? '<tr><td colspan="6" class="text-center py-5" style="color:var(--text-muted);">لا توجد تمديدات مسجلة لهذا العميل.</td></tr>'
      : extensions.map(function (e) {
          return '<tr>' +
            '<td class="mono text-xs" dir="ltr">' + esc(e.extensionNumber || e.sequenceNumber || '-') + '</td>' +
            '<td><button type="button" class="btn-link-inline cust-open-res mono" data-res-id="' + esc(e.reservationId) + '" dir="ltr">' + esc(e.reservationNumber || '-') + '</button></td>' +
            '<td class="tabular-nums font-semibold">' + Number(e.extendDays || 0) + ' يوم</td>' +
            '<td class="mono tabular-nums text-xs" dir="ltr">' + esc((e.startDate || '-') + ' → ' + (e.endDate || '-')) + '</td>' +
            '<td class="tabular-nums font-semibold">' + esc(fmtCurrency(e.amount)) + '</td>' +
            '<td><span class="status-tag status-info">' + esc(e.statusAr || e.paymentStatus || '-') + '</span></td>' +
          '</tr>';
        }).join('');

    var prbRowsHtml = problems.length === 0
      ? '<tr><td colspan="6" class="text-center py-6" style="color:var(--text-muted);">لا توجد شكاوى أو مشاكل مسجلة لهذا العميل.</td></tr>'
      : problems.map(function (p) {
          var isClosed = p.status === 'مغلقة' || p.status === 'تم الحل';
          return '<tr>' +
            '<td class="mono text-xs font-bold" dir="ltr">' + esc(p.problemNumber) + '</td>' +
            '<td><span class="status-tag ' + (p.ticketType === 'شكوى' ? 'status-warning' : 'status-info') + '">' + esc(p.ticketType || 'مشكلة') + '</span></td>' +
            '<td>' + (p.reservationId ? '<button type="button" class="btn-link-inline cust-open-res mono" data-res-id="' + esc(p.reservationId) + '" dir="ltr">' + esc(p.reservationNumber) + '</button>' : '<span style="color:var(--text-muted);">عامة</span>') + '</td>' +
            '<td style="max-width:340px;white-space:normal;">' + esc(p.description) + '</td>' +
            '<td><span class="status-tag ' + (isClosed ? 'status-success' : 'status-danger') + '">' + esc(p.status) + '</span></td>' +
            '<td class="text-xs" style="color:var(--text-muted);">' + esc(fmtDateTime(p.updatedAt || p.createdAt, ctx)) + '</td>' +
          '</tr>';
        }).join('');

    var timelineHtml = timeline.length === 0
      ? '<div class="empty-state" style="padding:28px;">لا يوجد سجل نشاطات بعد لهذا العميل.</div>'
      : '<div class="rg-cust-timeline-list">' +
          timeline.map(function (item) {
            var dotCls = item.kind === 'problem' ? 'is-problem' : (item.kind === 'extension' ? 'is-extension' : (item.kind === 'followup' ? 'is-followup' : (item.kind === 'note' ? 'is-note' : '')));
            return '<div class="rg-cust-timeline-item">' +
              '<span class="rg-cust-timeline-dot ' + dotCls + '"></span>' +
              '<div style="flex:1;min-width:0;">' +
                '<div class="flex items-center justify-between gap-2 flex-wrap">' +
                  '<strong style="font-size:13.5px;color:var(--text-primary);">' + esc(item.title) + '</strong>' +
                  '<span class="mono text-xs" style="color:var(--text-muted);" dir="ltr">' + esc(fmtDateTime(item.at, ctx)) + '</span>' +
                '</div>' +
                (item.subtitle ? '<div class="text-xs mt-1" style="color:var(--text-secondary);line-height:1.5;">' + esc(item.subtitle) + '</div>' : '') +
                '<div class="flex items-center gap-2 mt-1 text-[11px]" style="color:var(--text-muted);">' +
                  (item.actor ? '<span>بواسطة: <strong style="color:var(--text-primary);">' + esc(item.actor) + '</strong></span>' : '') +
                  (item.status ? '<span class="status-tag status-neutral">' + esc(item.status) + '</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';

    var notesHtml = notes.length === 0
      ? '<div class="empty-state" style="padding:18px;">لا توجد ملاحظات أو سجلات تواصل مضافة حتى الآن.</div>'
      : '<div class="rg-cust-timeline-list">' +
          notes.map(function (n) {
            return '<div class="rg-cust-timeline-item">' +
              '<span class="rg-cust-timeline-dot is-note"></span>' +
              '<div style="flex:1;min-width:0;">' +
                '<div class="flex items-center justify-between gap-2 flex-wrap">' +
                  '<span class="status-tag status-info">' + esc(n.noteType || 'ملاحظة') + '</span>' +
                  '<span class="mono text-xs" style="color:var(--text-muted);" dir="ltr">' + esc(fmtDateTime(n.createdAt, ctx)) + '</span>' +
                '</div>' +
                '<div class="text-sm mt-1.5" style="color:var(--text-primary);white-space:pre-wrap;">' + esc(n.content) + '</div>' +
                '<div class="text-xs mt-1" style="color:var(--text-muted);">' + esc(n.createdByName || '-') + (n.reservationNumber ? ' · الحجز <span class="mono" dir="ltr">' + esc(n.reservationNumber) + '</span>' : '') + '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';

    var fuRowsHtml = followUps.length === 0
      ? '<div class="empty-state" style="padding:18px;">لا توجد متابعات حجوزات مسجلة حتى الآن.</div>'
      : '<div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الحجز</th><th>الموظف</th><th>الإجراء / الحالة</th><th>الملاحظات</th><th>التاريخ</th></tr></thead><tbody>' +
          followUps.map(function (f) {
            return '<tr>' +
              '<td><button type="button" class="btn-link-inline cust-open-res mono" data-res-id="' + esc(f.reservationId) + '" dir="ltr">' + esc(f.reservationNumber || '-') + '</button></td>' +
              '<td>' + esc(f.employeeName || '-') + '</td>' +
              '<td><span class="status-tag status-success">' + esc(f.status || f.action || '-') + '</span></td>' +
              '<td style="max-width:300px;white-space:normal;">' + esc(f.notes || f.action || '-') + '</td>' +
              '<td class="mono text-xs" dir="ltr">' + esc((f.followUpDate || '') + ' ' + (f.followUpTime || '')) + '</td>' +
            '</tr>';
          }).join('') +
        '</tbody></table></div>';

    container.innerHTML =
      '<div class="flex flex-col gap-4">' +
        '<div class="flex items-center justify-between gap-2 flex-wrap">' +
          '<button type="button" class="btn btn-sm" id="cust-back-btn">← العودة إلى قائمة العملاء</button>' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            (canEditCust ? '<button type="button" class="btn btn-sm" id="cust-edit-btn">تعديل البيانات</button>' : '') +
            (canCreatePrb ? '<button type="button" class="btn btn-sm btn-danger" id="cust-add-complaint-btn">+ شكوى / مشكلة</button>' : '') +
            (canExportPdf ? '<button type="button" class="btn btn-sm btn-primary" id="cust-export-pdf-btn">تصدير PDF</button>' : '') +
          '</div>' +
        '</div>' +

        '<section class="rg-cust-profile-head">' +
          '<div class="rg-cust-profile-identity">' +
            '<div class="rg-cust-avatar">' + esc(initial) + '</div>' +
            '<div style="min-width:0;flex:1;">' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<h2 class="section-title" style="margin:0;">' + esc(cust.fullName || 'عميل') + '</h2>' +
                '<span class="status-tag ' + statusTagClass(cust.status) + '">' + esc(cust.status || 'جديد') + '</span>' +
                (cust.bookingsCount > 1 ? '<span class="status-tag status-info tabular-nums">عميل متكرر (' + Number(cust.bookingsCount) + ' حجوزات)</span>' : '') +
              '</div>' +
              '<div class="rg-cust-meta-strip">' +
                (cust.phone ? '<span class="mono font-semibold rg-cust-nowrap" dir="ltr" style="display:inline-flex;align-items:center;gap:6px;">' + (cust.countryCode ? '<span style="color:var(--text-muted);">[' + esc(cust.countryCode) + ']</span>' : '') + '<span>' + esc(cust.phone) + '</span></span>' : '<span>لا يوجد جوال</span>') +
                (cust.email ? '<span class="mono rg-cust-nowrap" dir="ltr">' + esc(cust.email) + '</span>' : '') +
                (canViewId && cust.idNumber ? '<span class="mono rg-cust-nowrap" dir="ltr">' + esc((cust.idType ? cust.idType + ': ' : '') + cust.idNumber) + '</span>' : '') +
                '<span class="rg-cust-nowrap">تاريخ الإنشاء: <strong class="mono tabular-nums" dir="ltr">' + esc(fmtDateTime(cust.createdAt, ctx).slice(0, 10)) + '</strong></span>' +
              '</div>' +
              '<div class="flex items-center gap-2 flex-wrap mt-2.5">' +
                (telHref ? '<a class="btn btn-sm rg-tel-btn" href="' + esc(telHref) + '">اتصال مباشر 9</a>' : '') +
                (waPhone ? '<a class="btn btn-sm" href="https://wa.me/' + esc(waPhone) + '" target="_blank" rel="noopener noreferrer">واتساب</a>' : '') +
                (cust.phone ? '<button type="button" class="btn btn-sm" id="cust-copy-phone" data-phone="' + esc(cust.phone) + '">نسخ الجوال</button>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="cust-assign-wrap" style="min-width:220px;">' +
            '<label class="form-label" for="cust-emp-select" style="font-size:11.5px;">الموظف المسؤول عن العميل</label>' +
            (canAssignCust
              ? '<div class="flex gap-1.5"><select class="input" id="cust-emp-select" style="min-height:36px;">' +
                  '<option value="">غير مسند</option>' +
                  employees.map(function (e) {
                    return '<option value="' + esc(e.id) + '"' + (cust.assignedEmployeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>';
                  }).join('') +
                '</select><button type="button" class="btn btn-sm btn-primary" id="cust-assign-save">حفظ</button></div>'
              : '<div class="font-bold text-sm" style="color:var(--text-primary);">' + esc(cust.assignedEmployeeName || 'غير مسند') + '</div>'
            ) +
          '</div>' +
        '</section>' +

        '<section class="rg-cust-fin-grid">' +
          '<div class="rg-cust-fin-card"><span class="lbl">إجمالي الحجوزات</span><span class="val">' + Number(fin.bookingsCount || 0) + ' <span class="text-xs font-normal" style="color:var(--text-muted);">(' + Number(fin.activeBookingsCount || 0) + ' نشط / ' + Number(fin.pastBookingsCount || 0) + ' سابق)</span></span></div>' +
          '<div class="rg-cust-fin-card"><span class="lbl">التمديدات</span><span class="val">' + Number(fin.extensionsCount || 0) + ' <span class="text-xs font-normal" style="color:var(--text-muted);">(' + esc(fmtCurrency(fin.extensionsAmount)) + ')</span></span></div>' +
          '<div class="rg-cust-fin-card"><span class="lbl">إجمالي الإنفاق</span><span class="val">' + esc(fmtCurrency(fin.totalAmount)) + '</span></div>' +
          '<div class="rg-cust-fin-card"><span class="lbl">المدفوع</span><span class="val" style="color:var(--status-ok-text);">' + esc(fmtCurrency(fin.paidAmount)) + '</span></div>' +
          '<div class="rg-cust-fin-card"><span class="lbl">المتبقي</span><span class="val" style="color:' + (Number(fin.outstandingAmount || 0) > 0 ? 'var(--status-danger-text)' : 'var(--text-primary)') + ';">' + esc(fmtCurrency(fin.outstandingAmount)) + '</span></div>' +
          '<div class="rg-cust-fin-card"><span class="lbl">مشاكل / شكاوى مفتوحة</span><span class="val" style="color:' + (Number(fin.openProblemsCount || 0) > 0 ? 'var(--status-danger-text)' : 'var(--text-primary)') + ';">' + Number(fin.openProblemsCount || 0) + '</span></div>' +
        '</section>' +

        '<div class="tabs-bar">' +
          '<button type="button" class="tab-btn' + (activeTab === 'overview' ? ' active' : '') + '" data-cust-tab="overview">المعلومات والحجوزات (' + reservations.length + ')</button>' +
          (canSeeComplaintsTab ? '<button type="button" class="tab-btn' + (activeTab === 'complaints' ? ' active' : '') + '" id="cust-tab-complaints" data-cust-tab="complaints">المشاكل والشكاوى (' + problems.length + ')</button>' : '') +
          '<button type="button" class="tab-btn' + (activeTab === 'followups' ? ' active' : '') + '" data-cust-tab="followups">المتابعات والتواصل (' + (followUps.length + notes.length) + ')</button>' +
          (canSeeTimelineTab ? '<button type="button" class="tab-btn' + (activeTab === 'timeline' ? ' active' : '') + '" id="cust-tab-timeline" data-cust-tab="timeline">السجل الزمني الشامل (' + timeline.length + ')</button>' : '') +
        '</div>' +

        (activeTab === 'overview' ? (
          '<div class="rg-cust-profile-grid">' +
            '<section class="surface-card">' +
              '<h3 class="section-title" style="margin-bottom:12px;">أ. المعلومات الشخصية</h3>' +
              '<div class="rg-cust-info-dl">' +
                '<div class="rg-cust-info-item"><span class="k">الاسم الكامل</span><span class="v">' + esc(cust.fullName || '-') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">رقم الجوال</span><span class="v mono" dir="ltr">' + esc(cust.phone || '-') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">مفتاح الدولة</span><span class="v mono" dir="ltr">' + esc(cust.countryCode || '-') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">البريد الإلكتروني</span><span class="v mono" dir="ltr">' + esc(cust.email || '-') + '</span></div>' +
                (canViewId ? (
                  '<div class="rg-cust-info-item"><span class="k">نوع الهوية</span><span class="v">' + esc(cust.idType || '-') + '</span></div>' +
                  '<div class="rg-cust-info-item"><span class="k">رقم الهوية / الإقامة / الجواز</span><span class="v mono" dir="ltr">' + esc(cust.idNumber || '-') + '</span></div>'
                ) : '') +
                '<div class="rg-cust-info-item"><span class="k">الموظف المسؤول</span><span class="v">' + esc(cust.assignedEmployeeName || 'غير مسند') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">آخر حجز</span><span class="v mono" dir="ltr">' + esc(cust.lastReservationNumber || '-') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">آخر تواصل</span><span class="v mono" dir="ltr">' + esc(cust.lastContactAt ? fmtDateTime(cust.lastContactAt, ctx) : 'لم يُسجل بعد') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">ملاحظات الملف</span><span class="v">' + esc(cust.notes || '-') + '</span></div>' +
              '</div>' +
            '</section>' +
            '<div class="flex flex-col gap-4" style="min-width:0;">' +
              '<section class="surface-card" style="min-width:0;">' +
                '<div class="section-header" style="margin-bottom:10px;"><h3 class="section-title">الحجوزات الحالية والسابقة (' + reservations.length + ')</h3></div>' +
                '<div class="table-wrap rg-cust-table-wrap"><table class="data-table rg-cust-table"><thead><tr><th>رقم الحجز</th><th>الشركة</th><th>المركبة</th><th>الاستلام</th><th>الانتهاء</th><th>الإجمالي</th><th>الحالة</th><th>التمديدات</th></tr></thead><tbody>' +
                  resRowsHtml +
                '</tbody></table></div>' +
              '</section>' +
              '<section class="surface-card" style="min-width:0;">' +
                '<div class="section-header" style="margin-bottom:10px;"><h3 class="section-title">سجل التمديدات (' + extensions.length + ')</h3></div>' +
                '<div class="table-wrap rg-cust-table-wrap"><table class="data-table rg-cust-table"><thead><tr><th>رقم التمديد</th><th>الحجز</th><th>المدة</th><th>الفترة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>' +
                  extRowsHtml +
                '</tbody></table></div>' +
              '</section>' +
            '</div>' +
          '</div>'
        ) : '') +

        (activeTab === 'complaints' && canSeeComplaintsTab ? (
          '<section class="surface-card" id="cust-complaints-panel">' +
            '<div class="section-header" style="margin-bottom:12px;">' +
              '<div><h3 class="section-title">المشاكل والشكاوى المرتبطة بالعميل</h3><p class="section-subtitle">إجمالي ' + problems.length + ' تذكرة</p></div>' +
              (canCreatePrb ? '<button type="button" class="btn btn-sm btn-primary" id="cust-tab-new-prb">+ تسجيل شكوى / مشكلة</button>' : '') +
            '</div>' +
            '<div class="table-wrap rg-cust-table-wrap"><table class="data-table rg-cust-table"><thead><tr><th>الرقم</th><th>النوع</th><th>الحجز</th><th>التفاصيل</th><th>الحالة</th><th>آخر تحديث</th></tr></thead><tbody>' +
              prbRowsHtml +
            '</tbody></table></div>' +
          '</section>'
        ) : '') +

        (activeTab === 'followups' ? (
          '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
            '<section class="surface-card">' +
              '<h3 class="section-title" style="margin-bottom:10px;">سجل التواصل والملاحظات (' + notes.length + ')</h3>' +
              (canAddNote ? (
                '<form id="cust-add-note-form" class="flex flex-col gap-2.5 mb-4 p-3 rounded-lg" style="background:var(--bg-surface-subtle);border:1px solid var(--border-hairline);">' +
                  '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
                    '<select class="input" id="cust-note-type">' +
                      '<option value="مكالمة">مكالمة هاتفية</option>' +
                      '<option value="واتساب">تواصل واتساب</option>' +
                      '<option value="ملاحظة">ملاحظة داخلية</option>' +
                      '<option value="متابعة">متابعة عميل</option>' +
                      '<option value="بريد إلكتروني">بريد إلكتروني</option>' +
                      '<option value="زيارة">زيارة فرع</option>' +
                    '</select>' +
                    '<select class="input" id="cust-note-res">' +
                      '<option value="">ربط بحجز (اختياري)</option>' +
                      reservations.map(function (r) {
                        return '<option value="' + esc(r.id) + '" data-num="' + esc(r.reservationNumber) + '">' + esc(r.reservationNumber) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>' +
                  '<textarea class="input" id="cust-note-text" rows="2" placeholder="اكتب ملخص التواصل أو الملاحظة (يدعم الإشارة @)..." required></textarea>' +
                  '<div class="flex justify-end"><button type="submit" class="btn btn-sm btn-primary" id="cust-add-note-btn">حفظ التواصل / الملاحظة</button></div>' +
                '</form>'
              ) : '') +
              notesHtml +
            '</section>' +
            '<section class="surface-card">' +
              '<h3 class="section-title" style="margin-bottom:10px;">متابعات الحجوزات المرتبطة (' + followUps.length + ')</h3>' +
              fuRowsHtml +
            '</section>' +
          '</div>'
        ) : '') +

        (activeTab === 'timeline' && canSeeTimelineTab ? (
          '<section class="surface-card" id="cust-timeline-panel">' +
            '<h3 class="section-title" style="margin-bottom:12px;">السجل الزمني الموحد لتعاملات العميل</h3>' +
            timelineHtml +
          '</section>'
        ) : '') +
      '</div>';

    // Wire Profile Events
    var backBtn = document.getElementById('cust-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        var cSt = getCustomersState(ctx);
        cSt.selectedCustomerId = '';
        currentProfileState.customerId = '';
        currentProfileState.data = null;
        if (window.location.hash !== '#customers') {
          try { window.history.replaceState(null, '', '#customers'); } catch (e) {}
        }
        render(container, ctx);
      });
    }

    container.querySelectorAll('[data-cust-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentProfileState.tab = btn.getAttribute('data-cust-tab') || 'overview';
        renderProfileView(container, ctx, data);
      });
    });

    container.querySelectorAll('.cust-open-res').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rId = btn.getAttribute('data-res-id');
        if (rId && root.RGReservations && typeof root.RGReservations.openReservationDrawer === 'function') {
          root.RGReservations.openReservationDrawer(rId, ctx, employees, function () {
            render(container, ctx);
          });
        }
      });
    });

    var copyPhoneBtn = document.getElementById('cust-copy-phone');
    if (copyPhoneBtn) {
      copyPhoneBtn.addEventListener('click', function () {
        var ph = copyPhoneBtn.getAttribute('data-phone') || '';
        if (ph && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ph).then(function () {
            if (ctx && ctx.toast) ctx.toast('تم نسخ رقم الجوال.');
          }).catch(function () {});
        }
      });
    }

    var editBtn = document.getElementById('cust-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        openCustomerFormModal(cust, { employees: employees }, ctx, function () {
          render(container, ctx);
        });
      });
    }

    var openCompHandler = function () {
      openCustomerComplaintModal(cust, reservations, ctx, function () {
        if (root.RGApi && root.RGApi.markScopesStale) root.RGApi.markScopesStale(['customers', 'problems']);
        render(container, ctx);
      });
    };
    var addCompBtn = document.getElementById('cust-add-complaint-btn');
    var tabNewPrbBtn = document.getElementById('cust-tab-new-prb');
    if (addCompBtn) addCompBtn.addEventListener('click', openCompHandler);
    if (tabNewPrbBtn) tabNewPrbBtn.addEventListener('click', openCompHandler);

    var assignSaveBtn = document.getElementById('cust-assign-save');
    if (assignSaveBtn) {
      assignSaveBtn.addEventListener('click', async function () {
        var empSel = document.getElementById('cust-emp-select');
        var empId = empSel ? empSel.value : '';
        assignSaveBtn.disabled = true;
        try {
          var res = await root.RGApi.callApi('assignCustomerEmployee', { customerId: cust.id, employeeId: empId });
          if (!res || !res.success) {
            if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر حفظ الإسناد.', true);
          } else {
            if (ctx && ctx.toast) ctx.toast('تم تحديث الموظف المسؤول عن العميل.');
            await render(container, ctx);
          }
        } finally {
          assignSaveBtn.disabled = false;
        }
      });
    }

    var noteForm = document.getElementById('cust-add-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var noteBtn = document.getElementById('cust-add-note-btn');
        var noteTextEl = document.getElementById('cust-note-text');
        var noteTypeEl = document.getElementById('cust-note-type');
        var noteResEl = document.getElementById('cust-note-res');
        var content = noteTextEl ? noteTextEl.value.trim() : '';
        if (!content) return;
        if (noteBtn) noteBtn.disabled = true;
        try {
          var opt = noteResEl && noteResEl.selectedOptions ? noteResEl.selectedOptions[0] : null;
          var resp = await root.RGApi.callApi('addCustomerNote', {
            customerId: cust.id,
            noteType: noteTypeEl ? noteTypeEl.value : 'ملاحظة',
            reservationId: noteResEl ? noteResEl.value : '',
            reservationNumber: opt ? (opt.getAttribute('data-num') || '') : '',
            content: content
          });
          if (!resp || !resp.success) {
            if (ctx && ctx.toast) ctx.toast((resp && resp.message) || 'تعذر حفظ الملاحظة.', true);
          } else {
            if (ctx && ctx.toast) ctx.toast('تم إضافة الملاحظة إلى ملف العميل.');
            await render(container, ctx);
          }
        } finally {
          if (noteBtn) noteBtn.disabled = false;
        }
      });
    }

    var exportPdfBtn = document.getElementById('cust-export-pdf-btn');
    if (exportPdfBtn && root.RGReports && typeof root.RGReports.openPdfStudio === 'function') {
      exportPdfBtn.addEventListener('click', function () {
        var pdfCols = [
          { key: 'fullName', label: 'اسم العميل' },
          { key: 'phone', label: 'الجوال', formatType: 'ltr' },
          { key: 'email', label: 'البريد الإلكتروني', formatType: 'ltr' }
        ];
        if (canViewId) pdfCols.push({ key: 'idNumber', label: 'رقم الهوية', formatType: 'ltr' });
        pdfCols.push(
          { key: 'bookingsCount', label: 'عدد الحجوزات', formatType: 'number' },
          { key: 'activeBookingsCount', label: 'النشطة', formatType: 'number' },
          { key: 'extensionsCount', label: 'التمديدات', formatType: 'number' },
          { key: 'openProblemsCount', label: 'المشاكل المفتوحة', formatType: 'number' },
          { key: 'totalAmount', label: 'إجمالي الإنفاق', formatType: 'number' },
          { key: 'assignedEmployeeName', label: 'الموظف المسؤول' },
          { key: 'status', label: 'الحالة' }
        );
        root.RGReports.openPdfStudio({
          ctx: ctx,
          title: 'ملف العميل — ' + (cust.fullName || ''),
          filename: 'customer-' + (cust.id || 'profile') + '.pdf',
          scopeKey: 'customer_profile',
          availableColumns: pdfCols,
          summaryItems: [
            { label: 'اسم العميل', value: cust.fullName || '-' },
            { label: 'الجوال', value: cust.phone || '-' },
            { label: 'إجمالي الحجوزات', value: Number(fin.bookingsCount || 0) },
            { label: 'إجمالي الإنفاق', value: fmtCurrency(fin.totalAmount) },
            { label: 'المدفوع', value: fmtCurrency(fin.paidAmount) },
            { label: 'الحالة', value: cust.status || 'جديد' }
          ],
          columns: pdfCols,
          rows: [cust]
        });
      });
    }
  }

  function renderDirectoryView(container, ctx, listData) {
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var activeUiCtx = root.RGApp && root.RGApp.getActiveUiContext ? root.RGApp.getActiveUiContext() : null;
    var cSt = getCustomersState(ctx);
    var items = (listData && Array.isArray(listData.items)) ? listData.items : [];
    var kpis = (listData && listData.kpis) || {};
    var recentList = (listData && Array.isArray(listData.recentCustomers)) ? listData.recentCustomers : [];
    var facets = (listData && listData.facets) || {};
    var companies = Array.isArray(facets.companies) ? facets.companies : [];
    var employees = Array.isArray(facets.employees) ? facets.employees : [];
    var statuses = Array.isArray(facets.statuses) && facets.statuses.length ? facets.statuses : (core.CUSTOMER_STATUS_LIST || []);

    var canViewId = core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false;
    var canShowDash = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_dashboard', activeUiCtx);
    var canAddEdit = core.canUserPerform && core.canUserPerform(user, 'edit_customer_details') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_edit_customer', activeUiCtx));

    var canExportExcel = !core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_excel', activeUiCtx);
    var canExportPdfDir = !core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_pdf', activeUiCtx);
    var exportMenuHtml = (root.RGExportMenu && (canExportPdfDir || canExportExcel))
      ? root.RGExportMenu.renderHtml({
          wrapId: 'cust-export-wrap',
          btnId: 'cust-export-btn',
          small: true,
          canPdf: canExportPdfDir,
          canExcel: canExportExcel,
          lang: (ctx && ctx.lang) || 'ar'
        })
      : '';

    var kpiDefs = [
      { key: 'all', label: 'إجمالي العملاء', val: Number(kpis.totalCustomers || 0), tone: 'info' },
      { key: 'new', label: 'العملاء الجدد', val: Number(kpis.newCustomers || 0), tone: 'info' },
      { key: 'active', label: 'أصحاب حجوزات نشطة', val: Number(kpis.activeBookingCustomers || 0), tone: 'ok' },
      { key: 'past', label: 'أصحاب حجوزات سابقة', val: Number(kpis.pastBookingCustomers || 0), tone: '' },
      { key: 'open_problems', label: 'لديهم مشاكل مفتوحة', val: Number(kpis.openProblemCustomers || 0), tone: 'danger' },
      { key: 'complaints', label: 'شكاوى قيد المعالجة', val: Number(kpis.inProgressComplaintCustomers || 0), tone: 'danger' },
      { key: 'extensions', label: 'لديهم تمديدات', val: Number(kpis.withExtensionsCustomers || 0), tone: 'warn' },
      { key: 'unfollowed', label: 'لم تتم متابعتهم', val: Number(kpis.unfollowedCustomers || 0), tone: 'warn' },
      { key: 'repeat', label: 'أكثر من حجز (متكررون)', val: Number(kpis.repeatCustomers || 0), tone: 'ok' },
      { key: 'recent', label: 'مضافون / محدثون حديثاً', val: Number(kpis.recentCustomers || 0), tone: 'info' }
    ];

    var rowsHtml = items.length === 0
      ? '<tr><td colspan="' + (canViewId ? 13 : 12) + '" class="text-center py-8" style="color:var(--text-muted);">لا توجد نتائج مطابقة للفلاتر المحددة.</td></tr>'
      : items.map(function (c) {
          var waPhone = core.normalizeWhatsappPhone ? core.normalizeWhatsappPhone(c.phone) : '';
          var telHref = core.formatDirectCallTelHref ? core.formatDirectCallTelHref(c.phone, '9') : '';
          return '<tr data-cust-row="' + esc(c.id) + '">' +
            '<td>' +
              '<button type="button" class="rg-customer-link cust-open-profile" data-cust-id="' + esc(c.id) + '">' + esc(c.fullName || 'عميل') + '</button>' +
              '<div class="flex items-center gap-1.5 mt-1">' +
                (telHref ? '<a class="btn btn-sm rg-tel-btn" style="padding:2px 7px;font-size:11px;" href="' + esc(telHref) + '">اتصال</a>' : '') +
                (waPhone ? '<a class="btn btn-sm" style="padding:2px 7px;font-size:11px;" href="https://wa.me/' + esc(waPhone) + '" target="_blank" rel="noopener noreferrer">واتساب</a>' : '') +
              '</div>' +
            '</td>' +
            '<td class="mono tabular-nums rg-cust-nowrap" dir="ltr">' +
              (c.countryCode ? '<span class="text-xs" style="color:var(--text-muted);">' + esc(c.countryCode) + '</span> ' : '') +
              '<span>' + esc(c.phone || '-') + '</span>' +
            '</td>' +
            '<td class="mono text-xs rg-cust-nowrap" dir="ltr">' + esc(c.email || '-') + '</td>' +
            (canViewId ? '<td class="mono tabular-nums text-xs rg-cust-nowrap" dir="ltr">' + esc(c.idNumber || '-') + (c.idType ? '<div class="text-[10.5px]" style="color:var(--text-muted);">' + esc(c.idType) + '</div>' : '') + '</td>' : '') +
            '<td class="tabular-nums font-bold">' + Number(c.bookingsCount || 0) + '</td>' +
            '<td class="tabular-nums font-semibold" style="color:var(--status-ok-text);">' + Number(c.activeBookingsCount || 0) + '</td>' +
            '<td class="tabular-nums" style="color:var(--text-muted);">' + Number(c.pastBookingsCount || 0) + '</td>' +
            '<td class="tabular-nums">' + Number(c.extensionsCount || 0) + '</td>' +
            '<td class="tabular-nums font-bold" style="color:' + (Number(c.openProblemsCount || 0) > 0 ? 'var(--status-danger-text)' : 'var(--text-muted)') + ';">' + Number(c.openProblemsCount || 0) + '</td>' +
            '<td class="mono text-xs rg-cust-nowrap" dir="ltr">' + esc(c.lastReservationNumber || '-') + (c.lastReservationDate ? '<div style="color:var(--text-muted);">' + esc(c.lastReservationDate) + '</div>' : '') + '</td>' +
            '<td class="mono text-xs rg-cust-nowrap" dir="ltr">' + esc(c.lastContactAt ? fmtDateTime(c.lastContactAt, ctx) : '-') + '</td>' +
            '<td class="text-xs rg-cust-nowrap">' + esc(c.assignedEmployeeName || 'غير مسند') + '</td>' +
            '<td class="rg-cust-nowrap">' +
              '<span class="status-tag ' + statusTagClass(c.status) + '">' + esc(c.status || 'جديد') + '</span>' +
              '<div class="mono text-[10.5px] mt-1" style="color:var(--text-muted);" dir="ltr">' + esc(fmtDateTime(c.createdAt, ctx).slice(0, 10)) + '</div>' +
            '</td>' +
          '</tr>';
        }).join('');

    var total = Number(listData && listData.total ? listData.total : items.length);
    var page = Number(listData && listData.page ? listData.page : 1);
    var totalPages = Number(listData && listData.totalPages ? listData.totalPages : 1);

    container.innerHTML =
      '<div class="flex flex-col gap-4">' +
        (canShowDash ? (
          '<section id="cust-dashboard-section" class="flex flex-col gap-3">' +
            '<div class="section-header" style="margin-bottom:0;">' +
              '<div>' +
                '<h2 class="section-title">مركز إدارة العملاء</h2>' +
                '<p class="section-subtitle">إحصائيات فورية لملفات العملاء المرتبطين بالحجوزات والتمديدات والمشاكل والمتابعات</p>' +
              '</div>' +
              '<div class="toolbar-actions">' +
                (canAddEdit ? '<button type="button" class="btn btn-primary btn-sm" id="cust-add-btn">+ عميل جديد</button>' : '') +
                exportMenuHtml +
              '</div>' +
            '</div>' +
            '<div class="rg-cust-kpi-grid">' +
              kpiDefs.map(function (k) {
                var isAct = (cSt.kpiFilter || 'all') === k.key;
                return '<button type="button" class="rg-cust-kpi-card' + (isAct ? ' is-active' : '') + '" data-cust-kpi="' + esc(k.key) + '" data-tone="' + esc(k.tone) + '">' +
                  '<span class="rg-cust-kpi-lbl">' + esc(k.label) + '</span>' +
                  '<span class="rg-cust-kpi-val">' + k.val.toLocaleString('en-US') + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
            (recentList.length > 0 ? (
              '<div class="surface-card" style="padding:10px 14px;">' +
                '<div class="flex items-center gap-2 flex-wrap text-xs">' +
                  '<strong style="color:var(--text-muted);">آخر المضافين / المحدثين:</strong>' +
                  recentList.map(function (rc) {
                    return '<button type="button" class="rg-customer-link cust-open-profile" data-cust-id="' + esc(rc.id) + '" style="font-size:12.5px;">' + esc(rc.fullName) + '</button>';
                  }).join('<span style="color:var(--border-hairline);">·</span>') +
                '</div>' +
              '</div>'
            ) : '') +
          '</section>'
        ) : '') +

        '<section class="rg-cust-toolbar">' +
          '<div class="rg-cust-toolbar-row">' +
            '<div class="rg-cust-search-wrap">' +
              '<label class="rg-inactive-field-lbl" for="cust-search-inp">بحث سريع بالعملاء</label>' +
              '<input class="input" id="cust-search-inp" value="' + esc(cSt.search || '') + '" placeholder="' + (canViewId ? 'ابحث بالاسم، الجوال، رقم الحجز، الهوية، البريد...' : 'ابحث بالاسم، الجوال، رقم الحجز، البريد...') + '">' +
            '</div>' +
            '<div class="rg-cust-filter-field">' +
              '<label class="rg-inactive-field-lbl" for="cust-status-sel">الحالة</label>' +
              '<select class="input" id="cust-status-sel"><option value="">جميع الحالات</option>' +
                statuses.map(function (st) {
                  return '<option value="' + esc(st) + '"' + (cSt.status === st ? ' selected' : '') + '>' + esc(st) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="rg-cust-filter-field">' +
              '<label class="rg-inactive-field-lbl" for="cust-comp-sel">شركة التأجير</label>' +
              '<select class="input" id="cust-comp-sel"><option value="">جميع الشركات</option>' +
                companies.map(function (co) {
                  return '<option value="' + esc(co) + '"' + (cSt.company === co ? ' selected' : '') + '>' + esc(co) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="rg-cust-filter-field">' +
              '<label class="rg-inactive-field-lbl" for="cust-emp-sel">الموظف المسؤول</label>' +
              '<select class="input" id="cust-emp-sel"><option value="">جميع الموظفين</option><option value="unassigned"' + (cSt.assignedEmployeeId === 'unassigned' ? ' selected' : '') + '>غير مسند</option>' +
                employees.map(function (e) {
                  return '<option value="' + esc(e.id) + '"' + (cSt.assignedEmployeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="rg-cust-filter-field">' +
              '<label class="rg-inactive-field-lbl" for="cust-prb-sel">المشاكل والشكاوى</label>' +
              '<select class="input" id="cust-prb-sel">' +
                '<option value="">الكل</option>' +
                '<option value="open_problems"' + (cSt.problemFilter === 'open_problems' ? ' selected' : '') + '>لديهم مشاكل مفتوحة</option>' +
                '<option value="open_complaints"' + (cSt.problemFilter === 'open_complaints' ? ' selected' : '') + '>شكاوى قيد المعالجة</option>' +
                '<option value="no_problems"' + (cSt.problemFilter === 'no_problems' ? ' selected' : '') + '>بدون مشاكل</option>' +
              '</select>' +
            '</div>' +
            '<div class="rg-cust-filter-field">' +
              '<label class="rg-inactive-field-lbl" for="cust-sort-sel">الترتيب</label>' +
              '<select class="input" id="cust-sort-sel">' +
                '<option value="last_activity"' + (cSt.sortBy === 'last_activity' ? ' selected' : '') + '>آخر نشاط</option>' +
                '<option value="bookings_desc"' + (cSt.sortBy === 'bookings_desc' ? ' selected' : '') + '>الأكثر حجوزات</option>' +
                '<option value="active_desc"' + (cSt.sortBy === 'active_desc' ? ' selected' : '') + '>الحجوزات النشطة</option>' +
                '<option value="amount_desc"' + (cSt.sortBy === 'amount_desc' ? ' selected' : '') + '>أعلى إنفاق</option>' +
                '<option value="created_desc"' + (cSt.sortBy === 'created_desc' ? ' selected' : '') + '>تاريخ الإنشاء (الأحدث)</option>' +
                '<option value="name_asc"' + (cSt.sortBy === 'name_asc' ? ' selected' : '') + '>الاسم (أ-ي)</option>' +
              '</select>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="cust-reset-btn">إعادة ضبط</button>' +
          '</div>' +
        '</section>' +

        '<section class="surface-card" style="padding:0;overflow:hidden;">' +
          '<div class="table-wrap rg-cust-table-wrap">' +
            '<table class="data-table rg-cust-table">' +
              '<thead><tr>' +
                '<th>العميل</th>' +
                '<th>الجوال</th>' +
                '<th>البريد الإلكتروني</th>' +
                (canViewId ? '<th>الهوية / الجواز</th>' : '') +
                '<th>الحجوزات</th>' +
                '<th>النشطة</th>' +
                '<th>السابقة</th>' +
                '<th>التمديدات</th>' +
                '<th>المشاكل</th>' +
                '<th>آخر حجز</th>' +
                '<th>آخر تواصل</th>' +
                '<th>المسؤول</th>' +
                '<th>الحالة / الإنشاء</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="flex items-center justify-between gap-2 px-4 py-3 border-t" style="border-color:var(--border-hairline);">' +
            '<span class="text-xs tabular-nums" style="color:var(--text-muted);">الإجمالي: <strong style="color:var(--text-primary);">' + total.toLocaleString('en-US') + '</strong> عميل · صفحة ' + page + ' من ' + totalPages + '</span>' +
            '<div class="flex items-center gap-1.5">' +
              '<button type="button" class="btn btn-sm" id="cust-prev-page"' + (page <= 1 ? ' disabled' : '') + '>السابق</button>' +
              '<button type="button" class="btn btn-sm" id="cust-next-page"' + (page >= totalPages ? ' disabled' : '') + '>التالي</button>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>';

    // Bind unified RGExportMenu (Excel + PDF Studio)
    if (root.RGExportMenu && typeof root.RGExportMenu.bind === 'function' && document.getElementById('cust-export-wrap')) {
      var exportCols = [
        { key: 'fullName', label: 'اسم العميل' },
        { key: 'countryCode', label: 'مفتاح الدولة', formatType: 'ltr' },
        { key: 'phone', label: 'رقم الجوال', formatType: 'ltr' },
        { key: 'email', label: 'البريد الإلكتروني', formatType: 'ltr' }
      ];
      if (canViewId) exportCols.push({ key: 'idNumber', label: 'رقم الهوية', formatType: 'ltr' });
      exportCols.push(
        { key: 'bookingsCount', label: 'عدد الحجوزات', formatType: 'number' },
        { key: 'activeBookingsCount', label: 'الحجوزات النشطة', formatType: 'number' },
        { key: 'pastBookingsCount', label: 'الحجوزات السابقة', formatType: 'number' },
        { key: 'extensionsCount', label: 'التمديدات', formatType: 'number' },
        { key: 'openProblemsCount', label: 'المشاكل المفتوحة', formatType: 'number' },
        { key: 'lastReservationNumber', label: 'آخر حجز', formatType: 'ltr' },
        { key: 'lastContactAt', label: 'آخر تواصل', formatType: 'datetime' },
        { key: 'assignedEmployeeName', label: 'الموظف المسؤول' },
        { key: 'status', label: 'حالة العميل' },
        { key: 'createdAt', label: 'تاريخ الإنشاء', formatType: 'date' }
      );
      var fetchExportRows = async function () {
        var expRes = await root.RGApi.callApi('getCustomers', {
          search: cSt.search || '',
          status: cSt.status || '',
          company: cSt.company || '',
          assignedEmployeeId: cSt.assignedEmployeeId || '',
          problemFilter: cSt.problemFilter || '',
          kpiFilter: cSt.kpiFilter || 'all',
          sortBy: cSt.sortBy || 'last_activity',
          page: 1,
          pageSize: 200
        });
        return (expRes && expRes.success && expRes.data && Array.isArray(expRes.data.items)) ? expRes.data.items : items;
      };
      root.RGExportMenu.bind('#cust-export-wrap', {
        onPdf: async function () {
          if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') return;
          var expRows = await fetchExportRows();
          await root.RGReports.openPdfStudio({
            ctx: ctx,
            title: 'تقرير العملاء — Rental Gate',
            filename: 'rental-gate-customers.pdf',
            scopeKey: 'customers_directory',
            availableColumns: exportCols,
            summaryItems: [
              { label: 'إجمالي العملاء', value: total },
              { label: 'العملاء في التصدير', value: expRows.length }
            ],
            columns: exportCols,
            rows: expRows
          });
        },
        onExcel: async function () {
          if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') return;
          var expRows = await fetchExportRows();
          await root.RGReports.exportExcelWorkbook([{
            name: 'العملاء',
            title: 'تقرير قاعدة بيانات العملاء',
            headers: exportCols,
            rows: expRows
          }], 'rental-gate-customers.xlsx', { lang: (ctx && ctx.lang) || 'ar' });
          if (ctx && ctx.toast) ctx.toast('تم تصدير ملف Excel للعملاء بنجاح.');
        }
      });
    }

    // Bind Directory Interactions
    container.querySelectorAll('.cust-open-profile').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = btn.getAttribute('data-cust-id');
        if (cid) openCustomerProfile(cid, ctx);
      });
    });

    container.querySelectorAll('[data-cust-kpi]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nextKpi = btn.getAttribute('data-cust-kpi') || 'all';
        cSt.kpiFilter = (cSt.kpiFilter === nextKpi && nextKpi !== 'all') ? 'all' : nextKpi;
        cSt.page = 1;
        if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
        render(container, ctx);
      });
    });

    var addBtn = document.getElementById('cust-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openCustomerFormModal(null, facets, ctx, function (created) {
          if (root.RGApi && root.RGApi.markScopesStale) root.RGApi.markScopesStale(['customers']);
          if (created && created.id) {
            openCustomerProfile(created.id, ctx);
          } else {
            render(container, ctx);
          }
        });
      });
    }

    var searchInp = document.getElementById('cust-search-inp');
    if (searchInp) {
      searchInp.addEventListener('input', function () {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          cSt.search = searchInp.value.trim();
          cSt.page = 1;
          if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
          render(container, ctx);
        }, 360);
      });
    }

    var bindSel = function (id, key) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        cSt[key] = el.value;
        cSt.page = 1;
        if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
        render(container, ctx);
      });
    };
    bindSel('cust-status-sel', 'status');
    bindSel('cust-comp-sel', 'company');
    bindSel('cust-emp-sel', 'assignedEmployeeId');
    bindSel('cust-prb-sel', 'problemFilter');
    bindSel('cust-sort-sel', 'sortBy');

    var resetBtn = document.getElementById('cust-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        cSt.search = '';
        cSt.status = '';
        cSt.company = '';
        cSt.assignedEmployeeId = '';
        cSt.problemFilter = '';
        cSt.kpiFilter = 'all';
        cSt.sortBy = 'last_activity';
        cSt.page = 1;
        if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
        render(container, ctx);
      });
    }

    var prevBtn = document.getElementById('cust-prev-page');
    var nextBtn = document.getElementById('cust-next-page');
    if (prevBtn) prevBtn.addEventListener('click', function () { if (page > 1) { cSt.page = page - 1; render(container, ctx); } });
    if (nextBtn) nextBtn.addEventListener('click', function () { if (page < totalPages) { cSt.page = page + 1; render(container, ctx); } });
  }

  async function openCustomerProfile(targetOrOpts, ctx) {
    var st = getCustomersState(ctx);
    var targetId = '';
    var resId = '';
    var phone = '';
    if (typeof targetOrOpts === 'string') {
      targetId = targetOrOpts;
    } else if (targetOrOpts && typeof targetOrOpts === 'object') {
      targetId = String(targetOrOpts.customerId || targetOrOpts.id || '');
      resId = String(targetOrOpts.reservationId || targetOrOpts.reservationNumber || '');
      phone = String(targetOrOpts.phone || '');
    }

    currentProfileState.tab = 'overview';
    if (targetId) {
      st.selectedCustomerId = targetId;
      currentProfileState.customerId = targetId;
    } else {
      var resolveRes = await root.RGApi.callApi('getCustomerDetails', {
        reservationId: resId,
        phone: phone
      });
      if (!resolveRes || !resolveRes.success || !resolveRes.data || !resolveRes.data.customer) {
        if (ctx && ctx.toast) ctx.toast((resolveRes && resolveRes.message) || 'تعذر فتح ملف العميل.', true);
        return;
      }
      st.selectedCustomerId = resolveRes.data.customer.id;
      currentProfileState.customerId = resolveRes.data.customer.id;
      currentProfileState.data = resolveRes.data;
    }

    if (root.RGApp && root.RGApp.navigateTo) {
      await root.RGApp.navigateTo('customers');
    } else {
      window.location.hash = '#customers';
    }
  }

  async function render(container, ctx) {
    bindGlobalDeltaRefresh();
    var cSt = getCustomersState(ctx);
    var selectedId = cSt.selectedCustomerId || currentProfileState.customerId;

    if (selectedId) {
      if (currentProfileState.data && currentProfileState.data.customer && currentProfileState.data.customer.id === selectedId) {
        renderProfileView(container, ctx, currentProfileState.data);
      }
      var detRes = await root.RGApi.callApi('getCustomerDetails', { customerId: selectedId });
      if (detRes && detRes.success && detRes.data) {
        currentProfileState.customerId = detRes.data.customer.id;
        currentProfileState.data = detRes.data;
        renderProfileView(container, ctx, detRes.data);
        return;
      }
      // Fallback back to directory if customer missing
      cSt.selectedCustomerId = '';
      currentProfileState.customerId = '';
      currentProfileState.data = null;
      if (ctx && ctx.toast) ctx.toast((detRes && detRes.message) || 'تعذر تحميل ملف العميل.', true);
    }

    var listRes = await root.RGApi.callApi('getCustomers', {
      search: cSt.search || '',
      status: cSt.status || '',
      company: cSt.company || '',
      assignedEmployeeId: cSt.assignedEmployeeId || '',
      problemFilter: cSt.problemFilter || '',
      kpiFilter: cSt.kpiFilter || 'all',
      sortBy: cSt.sortBy || 'last_activity',
      page: cSt.page || 1,
      pageSize: cSt.pageSize || 50
    });
    if (!listRes || !listRes.success) {
      throw new Error((listRes && listRes.message) || 'تعذر تحميل قائمة العملاء.');
    }
    renderDirectoryView(container, ctx, listRes.data || {});
  }

  root.RGCustomers = {
    render: render,
    openCustomerProfile: openCustomerProfile
  };
})(window);
