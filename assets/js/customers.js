/**
 * RENTAL GATE CRM — Unified Customer Management System, Full Customer Profile
 * & Reusable Customer Notes Panel (Customers / Reservations / Problems)
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

  function enhanceSelects(scopeEl) {
    if (root.RGCrmDropdowns && typeof root.RGCrmDropdowns.enhanceAll === 'function') {
      root.RGCrmDropdowns.enhanceAll(scopeEl || document);
    }
  }

  function getCustomerNotesConfigSafe(overrideCfg) {
    var core = coreFn();
    var raw = overrideCfg ||
      (root.RGApp && typeof root.RGApp.getCustomerNotesConfig === 'function' && root.RGApp.getCustomerNotesConfig()) ||
      {};
    if (core.normalizeCustomerNotesConfig) {
      return core.normalizeCustomerNotesConfig(raw);
    }
    return raw || {};
  }

  function getCustomerNoteStatusesSafe(overrideList) {
    var core = coreFn();
    var raw = Array.isArray(overrideList) && overrideList.length
      ? overrideList
      : ((root.RGApp && typeof root.RGApp.getCustomerNoteStatuses === 'function' && root.RGApp.getCustomerNoteStatuses()) ||
         core.CUSTOMER_NOTE_DEFAULT_STATUSES ||
         []);
    return raw.map(function (st) {
      return core.normalizeCustomerNoteStatusRecord ? core.normalizeCustomerNoteStatusRecord(st) : Object.assign({}, st);
    }).sort(function (a, b) {
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });
  }

  function getCustomersState(ctx) {
    var st = (ctx && ctx.state) || (root.RGApp && root.RGApp.getState && root.RGApp.getState()) || {};
    if (!st.customers || typeof st.customers !== 'object') {
      st.customers = {
        search: '',
        status: '',
        company: '',
        dateFrom: '',
        dateTo: '',
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
    if (s === 'لديه مشكلة' || s === 'محظور' || s === 'ملغي' || s === 'مرفوض') return 'status-danger';
    if (s === 'يحتاج متابعة' || s === 'متأخر في السداد' || s === 'بانتظار المتابعة') return 'status-warning';
    if (s === 'VIP' || s === 'نشط' || s === 'نشط الآن' || s === 'متكرر' || s === 'مكتمل') return 'status-success';
    if (s === 'جديد' || s === 'جاهز للاستلام') return 'status-info';
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
      render(slot, root.RGApp && root.RGApp.buildAppCtx ? root.RGApp.buildAppCtx() : { toast: function () {} }).catch(function (err) {
        if (root.RGApp && typeof root.RGApp.reportClientError === 'function') {
          root.RGApp.reportClientError('customers:deltasync', err);
        }
      });
    });
  }

  function getSourceSectionLabel(src) {
    var s = String(src || 'customers').trim();
    if (s === 'reservations') return 'تفاصيل الحجز';
    if (s === 'problems') return 'المشاكل والشكاوى';
    return 'ملف العميل';
  }

  function showConfirmModal(title, message, confirmLabel, danger, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.zIndex = '1450';
    overlay.innerHTML =
      '<div class="modal-panel" style="max-width:440px;">' +
        '<div class="modal-header">' +
          '<h3 class="modal-title">' + esc(title || 'تأكيد الإجراء') + '</h3>' +
          '<button type="button" class="btn btn-sm" data-cn-close>إغلاق</button>' +
        '</div>' +
        '<p style="margin:0 0 14px;font-size:13.5px;color:var(--text-secondary);line-height:1.6;">' + esc(message || 'هل أنت متأكد من المتابعة؟') + '</p>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn" data-cn-close>إلغاء</button>' +
          '<button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-cn-ok>' + esc(confirmLabel || 'تأكيد') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.querySelectorAll('[data-cn-close]').forEach(function (b) { b.addEventListener('click', close); });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
    var okBtn = overlay.querySelector('[data-cn-ok]');
    if (okBtn) {
      okBtn.addEventListener('click', function () {
        close();
        if (typeof onConfirm === 'function') onConfirm();
      });
    }
  }

  function openCustomerFormModal(existingCustomer, facets, ctx, onSaved) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var notesCfg = getCustomerNotesConfigSafe();
    var csCfg = notesCfg.customersSection || {};
    var canViewId = (core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false) && csCfg.showSensitiveIds !== false;
    var statuses = (core.CUSTOMER_STATUS_LIST || ['جديد', 'نشط', 'متكرر', 'VIP', 'يحتاج متابعة', 'لديه مشكلة', 'غير نشط', 'محظور']);
    var isEdit = Boolean(existingCustomer && existingCustomer.id);
    var c = existingCustomer || {};

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
              '<select class="select" id="cf-status" data-search-placeholder="ابحث عن الحالة...">' +
                statuses.map(function (st) {
                  return '<option value="' + esc(st) + '"' + (c.status === st ? ' selected' : '') + '>' + esc(st) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            (canViewId ? (
              '<div class="form-group"><label class="form-label" for="cf-idnum">رقم الهوية / الإقامة / الجواز</label><input class="input mono" dir="ltr" id="cf-idnum" value="' + esc(c.idNumber || '') + '"></div>' +
              '<div class="form-group"><label class="form-label" for="cf-idtype">نوع الهوية</label>' +
                '<select class="select" id="cf-idtype">' +
                  '<option value="">تحديد تلقائي</option>' +
                  '<option value="هوية وطنية"' + (c.idType === 'هوية وطنية' ? ' selected' : '') + '>هوية وطنية</option>' +
                  '<option value="إقامة"' + (c.idType === 'إقامة' ? ' selected' : '') + '>إقامة</option>' +
                  '<option value="جواز سفر"' + (c.idType === 'جواز سفر' ? ' selected' : '') + '>جواز سفر</option>' +
                '</select>' +
              '</div>'
            ) : '') +
            '<div class="form-group md:col-span-2"><label class="form-label" for="cf-notes">ملاحظات الملف الأساسية</label><textarea class="input" id="cf-notes" rows="3">' + esc(c.notes || '') + '</textarea></div>' +
            '<div class="md:col-span-2 flex justify-end gap-2 pt-2">' +
              '<button type="button" class="btn" id="cf-cancel">إلغاء</button>' +
              '<button type="submit" class="btn btn-primary" id="cf-submit">' + (isEdit ? 'حفظ التعديلات' : 'إنشاء ملف العميل') + '</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    enhanceSelects(modalRoot);
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
                '<select class="select" id="cp-type">' +
                  '<option value="شكوى">شكوى عميل</option>' +
                  '<option value="مشكلة">مشكلة تشغيلية</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="cp-prio">الأولوية</label>' +
                '<select class="select" id="cp-prio">' +
                  priorities.map(function (p) {
                    return '<option value="' + esc(p) + '"' + (p === 'مرتفع' ? ' selected' : '') + '>' + esc(p) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="cp-res">ربط بحجز (اختياري)</label>' +
              '<select class="select" id="cp-res" data-search-placeholder="ابحث عن الحجز...">' +
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

    enhanceSelects(modalRoot);
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

  /**
   * Reusable Customer Notes Panel — Mounts safely inside Customers, Reservations Drawer, or Problems Modal.
   * IMPORTANT: Never creates <form> or <button type="submit"> tags internally so it nests cleanly inside modals/forms.
   */
  function mountCustomerNotesPanel(hostEl, opts) {
    if (!hostEl) return;
    var o = opts || {};
    var ctx = o.ctx || { toast: function () {} };
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var cfg = getCustomerNotesConfigSafe(o.notesConfig);
    var statuses = getCustomerNoteStatusesSafe(o.noteStatuses);
    var employees = Array.isArray(o.employees) ? o.employees : [];
    var reservations = Array.isArray(o.reservations) ? o.reservations : [];
    var sourceSection = o.sourceSection || (o.problemId ? 'problems' : (o.reservationId ? 'reservations' : 'customers'));

    var panelState = {
      notes: Array.isArray(o.initialNotes) ? o.initialNotes.slice() : [],
      statuses: statuses,
      config: cfg,
      stats: { total: 0, open: 0, closed: 0, internal: 0 },
      search: '',
      statusId: '',
      noteType: '',
      sourceFilter: '',
      assignedEmployeeId: '',
      dateFrom: '',
      dateTo: '',
      sortBy: (cfg.general && cfg.general.defaultSort) || 'newest',
      composerOpen: false,
      pendingAttachments: [],
      loading: !Array.isArray(o.initialNotes)
    };

    function evalBtn(btnKey, noteObj, extraOpts) {
      if (core.evaluateCustomerNoteButtonAccess) {
        return core.evaluateCustomerNoteButtonAccess(user, btnKey, noteObj || null, panelState.config, extraOpts);
      }
      return { allowed: true, reason: 'OK', message: '', rule: {} };
    }

    function buildStatusOptionsHtml(selectedId, includeAllLabel, includeInactiveCurrentId) {
      var html = includeAllLabel ? '<option value="">' + esc(includeAllLabel) + '</option>' : '';
      var hasSelected = false;
      var role = user && user.role ? String(user.role) : '';
      panelState.statuses.forEach(function (st) {
        if (!st) return;
        var isSel = selectedId && String(selectedId) === String(st.id);
        if (!st.isActive) {
          if (includeInactiveCurrentId && String(includeInactiveCurrentId) === String(st.id)) {
            hasSelected = true;
            html += '<option value="' + esc(st.id) + '" selected disabled data-inactive="true" data-color="' + esc(st.color) + '">' + esc(st.name) + ' (معطلة)</option>';
          }
          return;
        }
        if (role === 'agent' && st.allowAgentSelect === false && !includeAllLabel) {
          if (isSel) {
            hasSelected = true;
            html += '<option value="' + esc(st.id) + '" selected disabled data-inactive="true" data-color="' + esc(st.color) + '">' + esc(st.name) + ' (للمشرف فقط)</option>';
          }
          return;
        }
        if (isSel) hasSelected = true;
        html += '<option value="' + esc(st.id) + '" data-color="' + esc(st.color) + '"' + (isSel ? ' selected' : '') + '>' + esc(st.name) + '</option>';
      });
      if (includeInactiveCurrentId && !hasSelected) {
        html += '<option value="' + esc(includeInactiveCurrentId) + '" selected disabled data-inactive="true">حالة أرشيفية</option>';
      }
      return html;
    }

    function recomputeStats() {
      var openCnt = 0, closedCnt = 0, intCnt = 0;
      panelState.notes.forEach(function (n) {
        if (!n) return;
        if (n.isClosed || n.statusIsClosed) closedCnt += 1;
        else openCnt += 1;
        if (n.isInternal) intCnt += 1;
      });
      panelState.stats = {
        total: panelState.notes.length,
        open: openCnt,
        closed: closedCnt,
        internal: intCnt
      };
    }

    function openNoteDetailsModal(note) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '1420';
      var atts = Array.isArray(note.attachments) ? note.attachments : [];
      overlay.innerHTML =
        '<div class="modal-panel" style="max-width:620px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title">' + esc(note.title || note.noteType || 'تفاصيل الملاحظة') + '</h3>' +
              '<div class="meta-inline">' +
                '<span class="rg-note-status-badge"><span class="rg-note-status-dot" style="background:' + esc(note.statusColor || '#3b82f6') + ';"></span>' + esc(note.statusName || 'جديدة') + '</span>' +
                '<span>·</span><span>' + esc(getSourceSectionLabel(note.sourceSection)) + '</span>' +
                (note.reservationNumber ? '<span>·</span><span class="mono" dir="ltr">' + esc(note.reservationNumber) + '</span>' : '') +
                (note.problemNumber ? '<span>·</span><span class="mono" dir="ltr">' + esc(note.problemNumber) + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" data-nd-close>إغلاق</button>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<div style="padding:12px;border-radius:var(--radius-sm);background:var(--bg-surface-subtle);border:1px solid var(--border-hairline);white-space:pre-wrap;line-height:1.7;font-size:13.5px;">' + esc(note.content || '') + '</div>' +
            '<div class="rg-cust-info-dl">' +
              '<div class="rg-cust-info-item"><span class="k">نوع التواصل</span><span class="v">' + esc(note.noteType || 'ملاحظة') + (note.isInternal ? ' (داخلية)' : '') + '</span></div>' +
              '<div class="rg-cust-info-item"><span class="k">الكاتب</span><span class="v">' + esc(note.createdByName || '-') + '</span></div>' +
              '<div class="rg-cust-info-item"><span class="k">تاريخ الإنشاء</span><span class="v mono" dir="ltr">' + esc(fmtDateTime(note.createdAt, ctx)) + '</span></div>' +
              '<div class="rg-cust-info-item"><span class="k">آخر تحديث</span><span class="v mono" dir="ltr">' + esc(fmtDateTime(note.updatedAt, ctx)) + '</span></div>' +
              (note.assignedEmployeeName ? '<div class="rg-cust-info-item"><span class="k">مكلف بالمتابعة</span><span class="v">' + esc(note.assignedEmployeeName) + '</span></div>' : '') +
            '</div>' +
            (atts.length ? (
              '<div><h4 style="margin:0 0 8px;font-size:13px;">المرفقات (' + atts.length + ')</h4>' +
                '<div class="rg-note-attachments-row">' +
                  atts.map(function (a) {
                    var href = a.storageUrl || a.dataUrl || '#';
                    return '<a class="rg-note-att-chip" href="' + esc(href) + '" download="' + esc(a.fileName || 'file') + '">' + esc(a.fileName || 'مرفق') + '</a>';
                  }).join('') +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      overlay.querySelectorAll('[data-nd-close]').forEach(function (b) { b.addEventListener('click', close); });
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
    }

    async function openNoteHistoryModal(note) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '1420';
      overlay.innerHTML =
        '<div class="modal-panel" style="max-width:600px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">سجل تغييرات الملاحظة</h3>' +
            '<button type="button" class="btn btn-sm" data-nh-close>إغلاق</button>' +
          '</div>' +
          '<div id="cn-hist-body" style="max-height:60vh;overflow-y:auto;">' +
            '<div class="empty-state" style="padding:18px;">جاري تحميل سجل التعديلات...</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      overlay.querySelectorAll('[data-nh-close]').forEach(function (b) { b.addEventListener('click', close); });
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });

      var res = await root.RGApi.callApi('getCustomerNoteHistory', { noteId: note.id });
      var body = overlay.querySelector('#cn-hist-body');
      if (!body || !overlay.isConnected) return;
      if (!res || !res.success) {
        body.innerHTML = '<div class="form-error">' + esc((res && res.message) || 'تعذر تحميل سجل التغييرات.') + '</div>';
        return;
      }
      var list = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
      body.innerHTML = list.length === 0
        ? '<div class="empty-state" style="padding:18px;">لا توجد تغييرات مسجلة لهذه الملاحظة.</div>'
        : '<div class="timeline-list">' + list.map(function (h) {
            return '<div class="timeline-item">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                '<strong>' + esc(h.actionType || h.action || 'تحديث') + '</strong>' +
                '<span class="mono text-xs" dir="ltr" style="color:var(--text-muted);">' + esc(fmtDateTime(h.createdAt, ctx)) + '</span>' +
              '</div>' +
              '<div class="text-xs" style="color:var(--text-secondary);">بواسطة: ' + esc(h.actorName || '-') + (h.fieldName ? ' · الحقل: <span class="mono" dir="ltr">' + esc(h.fieldName) + '</span>' : '') + '</div>' +
              ((h.oldValue || h.newValue) ? '<div class="text-xs mt-1">' + (h.oldValue ? '<span style="color:var(--text-muted);">قبل: ' + esc(h.oldValue) + '</span> ← ' : '') + '<strong>' + esc(h.newValue || h.details || '') + '</strong></div>' : '') +
            '</div>';
          }).join('') + '</div>';
    }

    function openEditNoteModal(note) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '1420';
      var noteTypes = core.CUSTOMER_NOTE_TYPES || ['ملاحظة', 'مكالمة', 'واتساب', 'بريد إلكتروني', 'متابعة', 'زيارة'];
      var allowInt = !(panelState.config.addNote && panelState.config.addNote.allowInternalNotes === false);
      overlay.innerHTML =
        '<div class="modal-panel" style="max-width:580px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">تعديل الملاحظة</h3>' +
            '<button type="button" class="btn btn-sm" data-ne-close>إغلاق</button>' +
          '</div>' +
          '<div class="flex flex-col gap-3">' +
            '<div class="form-group"><label class="form-label" for="ne-title">العنوان (اختياري)</label><input class="input" id="ne-title" value="' + esc(note.title || '') + '"></div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
              '<div class="form-group"><label class="form-label" for="ne-type">نوع الملاحظة</label>' +
                '<select class="select" id="ne-type">' +
                  noteTypes.map(function (tp) {
                    return '<option value="' + esc(tp) + '"' + (note.noteType === tp ? ' selected' : '') + '>' + esc(tp) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="ne-status">الحالة</label>' +
                '<select class="select" id="ne-status" data-search-placeholder="ابحث عن الحالة...">' +
                  buildStatusOptionsHtml(note.statusId, '', note.statusId) +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="ne-content">المحتوى *</label><textarea class="textarea" id="ne-content" rows="4">' + esc(note.content || '') + '</textarea></div>' +
            (allowInt ? '<label class="checkbox-item"><input type="checkbox" id="ne-internal"' + (note.isInternal ? ' checked' : '') + '> ملاحظة داخلية للفريق فقط</label>' : '') +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" data-ne-close>إلغاء</button>' +
              '<button type="button" class="btn btn-primary" id="ne-save">حفظ التعديلات</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      enhanceSelects(overlay);
      var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      overlay.querySelectorAll('[data-ne-close]').forEach(function (b) { b.addEventListener('click', close); });
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });

      var saveBtn = overlay.querySelector('#ne-save');
      saveBtn.addEventListener('click', async function () {
        var doUpdate = async function (confirmed) {
          saveBtn.disabled = true;
          try {
            var payload = {
              noteId: note.id,
              expectedUpdatedAt: note.updatedAt || '',
              title: (overlay.querySelector('#ne-title') || {}).value || '',
              noteType: (overlay.querySelector('#ne-type') || {}).value || note.noteType,
              statusId: (overlay.querySelector('#ne-status') || {}).value || note.statusId,
              content: (overlay.querySelector('#ne-content') || {}).value || '',
              isInternal: Boolean((overlay.querySelector('#ne-internal') || {}).checked),
              confirmed: Boolean(confirmed)
            };
            var res = await root.RGApi.callApi('updateCustomerNote', payload);
            if (!res || !res.success) {
              if (res && res.error === 'CONFIRM_REQUIRED') {
                saveBtn.disabled = false;
                showConfirmModal('تأكيد تعديل الملاحظة', res.message || 'يرجى تأكيد حفظ التعديل على هذه الملاحظة.', 'تأكيد الحفظ', false, function () {
                  doUpdate(true);
                });
                return;
              }
              if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر حفظ تعديل الملاحظة.', true);
              saveBtn.disabled = false;
              return;
            }
            close();
            if (ctx && ctx.toast && evalBtn('edit_note', note).rule.showSuccessNotification !== false) {
              ctx.toast('تم تحديث الملاحظة بنجاح.');
            }
            await reloadNotesFromServer();
            if (typeof o.onChanged === 'function') o.onChanged();
          } catch (err) {
            if (ctx && ctx.toast) ctx.toast((err && err.message) || 'تعذر حفظ التعديل.', true);
            saveBtn.disabled = false;
          }
        };
        var ruleEval = evalBtn('edit_note', note, { checkConfirm: true, confirmed: false });
        if (!ruleEval.allowed && ruleEval.reason === 'CONFIRMATION_REQUIRED') {
          showConfirmModal('تأكيد تعديل الملاحظة', ruleEval.message || 'هل تريد تأكيد تعديل هذه الملاحظة؟', 'تأكيد', false, function () {
            doUpdate(true);
          });
        } else {
          doUpdate(false);
        }
      });
    }

    function openAssignNoteModal(note) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '1420';
      overlay.innerHTML =
        '<div class="modal-panel" style="max-width:440px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">إسناد متابعة الملاحظة لموظف</h3>' +
            '<button type="button" class="btn btn-sm" data-na-close>إغلاق</button>' +
          '</div>' +
          '<div class="flex flex-col gap-3">' +
            '<p style="margin:0;font-size:12.5px;color:var(--text-muted);">اختر الموظف المكلف بمتابعة وتنفيذ هذه الملاحظة (خاص بمتابعة الملاحظة فقط).</p>' +
            '<div class="form-group"><label class="form-label" for="na-emp">الموظف المكلف</label>' +
              '<select class="select" id="na-emp" data-search-placeholder="ابحث عن الموظف...">' +
                '<option value="">بدون تعيين</option>' +
                employees.map(function (e) {
                  return '<option value="' + esc(e.id) + '"' + (note.assignedEmployeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" data-na-close>إلغاء</button>' +
              '<button type="button" class="btn btn-primary" id="na-save">حفظ التعيين</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      enhanceSelects(overlay);
      var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      overlay.querySelectorAll('[data-na-close]').forEach(function (b) { b.addEventListener('click', close); });
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });

      var saveBtn = overlay.querySelector('#na-save');
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        var empId = (overlay.querySelector('#na-emp') || {}).value || '';
        var res = await root.RGApi.callApi('assignCustomerNoteEmployee', { noteId: note.id, employeeId: empId, confirmed: true });
        if (!res || !res.success) {
          if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر إسناد الملاحظة.', true);
          saveBtn.disabled = false;
          return;
        }
        close();
        if (ctx && ctx.toast) ctx.toast('تم تحديث الموظف المكلف بمتابعة الملاحظة.');
        await reloadNotesFromServer();
        if (typeof o.onChanged === 'function') o.onChanged();
      });
    }

    function exportNotesCsv() {
      var rows = panelState.notes || [];
      if (!rows.length) {
        if (ctx && ctx.toast) ctx.toast('لا توجد ملاحظات لتصديرها.', true);
        return;
      }
      var headers = ['المعرف', 'العنوان', 'النوع', 'الحالة', 'المحتوى', 'المصدر', 'رقم الحجز', 'الموظف المكلف', 'الكاتب', 'التاريخ'];
      var lines = [headers.join(',')];
      rows.forEach(function (n) {
        var vals = [
          n.id, n.title || '', n.noteType || '', n.statusName || '',
          String(n.content || '').replace(/\r?\n/g, ' '),
          getSourceSectionLabel(n.sourceSection), n.reservationNumber || '',
          n.assignedEmployeeName || '', n.createdByName || '', n.createdAt || ''
        ].map(function (v) {
          return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        });
        lines.push(vals.join(','));
      });
      var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'customer-notes-' + (o.customerId || o.reservationId || 'all') + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 400);
      if (ctx && ctx.toast) ctx.toast('تم تصدير الملاحظات بصيغة CSV بنجاح.');
    }

    function openPrintPreviewModal() {
      var rows = panelState.notes || [];
      var overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '1440';
      overlay.innerHTML =
        '<div class="modal-panel" style="max-width:780px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">معاينة طباعة ملاحظات العملاء (' + rows.length + ')</h3>' +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn btn-sm btn-primary" id="cn-do-print">طباعة الآن</button>' +
              '<button type="button" class="btn btn-sm" data-np-close>إغلاق</button>' +
            '</div>' +
          '</div>' +
          '<div style="max-height:65vh;overflow-y:auto;">' +
            '<table class="data-table"><thead><tr><th>النوع</th><th>الحالة</th><th>الملاحظة</th><th>الحجز</th><th>الكاتب</th><th>التاريخ</th></tr></thead><tbody>' +
              (rows.length ? rows.map(function (n) {
                return '<tr>' +
                  '<td>' + esc(n.noteType || 'ملاحظة') + '</td>' +
                  '<td>' + esc(n.statusName || 'جديدة') + '</td>' +
                  '<td style="white-space:pre-wrap;max-width:300px;">' + (n.title ? '<strong>' + esc(n.title) + '</strong><br>' : '') + esc(n.content || '') + '</td>' +
                  '<td class="mono" dir="ltr">' + esc(n.reservationNumber || '-') + '</td>' +
                  '<td>' + esc(n.createdByName || '-') + '</td>' +
                  '<td class="mono" dir="ltr">' + esc(fmtDateTime(n.createdAt, ctx)) + '</td>' +
                '</tr>';
              }).join('') : '<tr><td colspan="6" class="text-center py-4">لا توجد ملاحظات للطباعة.</td></tr>') +
            '</tbody></table>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      overlay.querySelectorAll('[data-np-close]').forEach(function (b) { b.addEventListener('click', close); });
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
      var printBtn = overlay.querySelector('#cn-do-print');
      if (printBtn) {
        printBtn.addEventListener('click', function () {
          if (typeof window.print === 'function') window.print();
        });
      }
    }

    async function reloadNotesFromServer() {
      panelState.loading = true;
      renderPanel();
      var res = await root.RGApi.callApi('getCustomerNotes', {
        customerId: o.customerId || '',
        reservationId: o.reservationId || '',
        problemId: o.problemId || '',
        search: panelState.search,
        statusId: panelState.statusId,
        noteType: panelState.noteType,
        sourceSection: panelState.sourceFilter,
        assignedEmployeeId: panelState.assignedEmployeeId,
        dateFrom: panelState.dateFrom,
        dateTo: panelState.dateTo,
        sortBy: panelState.sortBy,
        pageSize: (panelState.config.general && panelState.config.general.pageSize) || 50
      });
      panelState.loading = false;
      if (res && res.success && res.data) {
        panelState.notes = Array.isArray(res.data.items) ? res.data.items : [];
        if (Array.isArray(res.data.statuses) && res.data.statuses.length) panelState.statuses = res.data.statuses;
        if (res.data.config) panelState.config = getCustomerNotesConfigSafe(res.data.config);
        if (res.data.stats) panelState.stats = res.data.stats;
        else recomputeStats();
      } else {
        recomputeStats();
      }
      renderPanel();
    }

    function renderPanel() {
      if (!hostEl.isConnected) return;
      recomputeStats();
      var cfgNow = panelState.config || {};
      var genCfg = cfgNow.general || {};
      var addCfg = cfgNow.addNote || {};
      if (genCfg.enabled === false) {
        hostEl.innerHTML = '<div class="surface-card"><div class="empty-state" style="padding:16px;">تم تعطيل قسم ملاحظات العملاء مؤقتاً من لوحة الإعدادات.</div></div>';
        return;
      }

      var canAdd = evalBtn('add_note').allowed;
      var canSearch = genCfg.enableSearch !== false && evalBtn('search_notes').allowed;
      var canFilter = genCfg.enableFilters !== false && evalBtn('filter_notes').allowed;
      var canExport = evalBtn('export_notes').allowed;
      var canPrint = evalBtn('print_notes').allowed;
      var canRefresh = evalBtn('refresh_notes').allowed;
      var canAttach = evalBtn('attach_file').allowed;
      var canAssign = evalBtn('assign_note').allowed;
      var noteTypes = core.CUSTOMER_NOTE_TYPES || ['ملاحظة', 'مكالمة', 'واتساب', 'بريد إلكتروني', 'متابعة', 'زيارة'];
      var defSt = panelState.statuses.find(function (s) { return s.isActive && s.isDefault; }) || panelState.statuses.find(function (s) { return s.isActive; });

      var notesListHtml = panelState.loading
        ? '<div class="empty-state" style="padding:18px;">جاري تحميل الملاحظات...</div>'
        : (panelState.notes.length === 0
            ? '<div class="empty-state" style="padding:18px;">لا توجد ملاحظات عملاء مطابقة للعرض الحالي.</div>'
            : '<div class="flex flex-col gap-2.5">' + panelState.notes.map(function (n) {
                var canChgSt = evalBtn('change_status', n).allowed;
                var canViewDet = evalBtn('view_details', n).allowed;
                var canHist = evalBtn('view_history', n).allowed;
                var canEditN = evalBtn('edit_note', n).allowed;
                var canAsgN = evalBtn('assign_note', n).allowed;
                var canDelN = evalBtn('delete_note', n).allowed;
                var canDelAtt = evalBtn('delete_attachment', n).allowed;
                var atts = Array.isArray(n.attachments) ? n.attachments : [];

                return '<article class="rg-note-card" data-note-id="' + esc(n.id) + '">' +
                  '<div class="rg-note-card-head">' +
                    '<div class="flex items-center gap-1.5 flex-wrap">' +
                      '<span class="status-tag status-info">' + esc(n.noteType || 'ملاحظة') + '</span>' +
                      '<span class="rg-note-status-badge"><span class="rg-note-status-dot" style="background:' + esc(n.statusColor || '#3b82f6') + ';"></span>' + esc(n.statusName || 'جديدة') + (!n.statusIsActive ? ' (معطلة)' : '') + '</span>' +
                      (n.isInternal ? '<span class="status-tag status-warning">داخلية</span>' : '') +
                      '<span class="status-tag status-neutral">' + esc(getSourceSectionLabel(n.sourceSection)) + '</span>' +
                      (n.reservationNumber ? '<span class="mono text-xs" dir="ltr" style="color:var(--text-muted);">#' + esc(n.reservationNumber) + '</span>' : '') +
                      (n.assignedEmployeeName ? '<span class="text-xs" style="color:var(--brand-primary);font-weight:600;">متابعة: ' + esc(n.assignedEmployeeName) + '</span>' : '') +
                    '</div>' +
                    '<span class="mono text-xs" dir="ltr" style="color:var(--text-muted);">' + esc(fmtDateTime(n.createdAt, ctx)) + '</span>' +
                  '</div>' +
                  (n.title ? '<div style="font-weight:700;font-size:13.5px;color:var(--text-primary);">' + esc(n.title) + '</div>' : '') +
                  '<div style="font-size:13.5px;color:var(--text-primary);white-space:pre-wrap;line-height:1.65;">' + esc(n.content || '') + '</div>' +
                  (atts.length ? (
                    '<div class="rg-note-attachments-row">' +
                      atts.map(function (a) {
                        var url = a.storageUrl || a.dataUrl || '#';
                        return '<span class="rg-note-att-chip">' +
                          '<a href="' + esc(url) + '" download="' + esc(a.fileName || 'file') + '" style="color:inherit;text-decoration:none;">' + esc(a.fileName || 'مرفق') + '</a>' +
                          (canDelAtt ? '<button type="button" class="rg-dropdown-search-clear cn-del-att-btn" data-note-id="' + esc(n.id) + '" data-att-id="' + esc(a.id) + '" title="حذف المرفق" aria-label="حذف المرفق">&times;</button>' : '') +
                        '</span>';
                      }).join('') +
                    '</div>'
                  ) : '') +
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:4px;">' +
                    '<span class="text-xs" style="color:var(--text-muted);">بواسطة: <strong>' + esc(n.createdByName || '-') + '</strong></span>' +
                    '<div class="rg-note-actions-row">' +
                      (canChgSt ? (
                        '<select class="select quick-status-select cn-quick-status" data-note-id="' + esc(n.id) + '" data-search-placeholder="ابحث عن الحالة..." aria-label="تغيير حالة الملاحظة">' +
                          buildStatusOptionsHtml(n.statusId, '', !n.statusIsActive ? n.statusId : '') +
                        '</select>'
                      ) : '') +
                      (canViewDet ? '<button type="button" class="btn btn-sm cn-btn-det" data-note-id="' + esc(n.id) + '">التفاصيل</button>' : '') +
                      (canHist ? '<button type="button" class="btn btn-sm cn-btn-hist" data-note-id="' + esc(n.id) + '">السجل</button>' : '') +
                      (canEditN ? '<button type="button" class="btn btn-sm cn-btn-edit" data-note-id="' + esc(n.id) + '">تعديل</button>' : '') +
                      (canAsgN ? '<button type="button" class="btn btn-sm cn-btn-assign" data-note-id="' + esc(n.id) + '">إسناد</button>' : '') +
                      (canDelN ? '<button type="button" class="btn btn-sm btn-danger cn-btn-del" data-note-id="' + esc(n.id) + '">حذف</button>' : '') +
                    '</div>' +
                  '</div>' +
                '</article>';
              }).join('') + '</div>');

      hostEl.innerHTML =
        '<div class="surface-card" style="display:flex;flex-direction:column;gap:12px;">' +
          '<div class="section-header" style="margin-bottom:0;">' +
            '<div>' +
              '<h3 class="section-title">' + esc(genCfg.sectionTitle || 'ملاحظات العملاء') + ' (' + panelState.stats.total + ')</h3>' +
              '<p class="section-subtitle">مفتوحة: <strong class="tabular-nums">' + panelState.stats.open + '</strong> · مغلقة/محلولة: <strong class="tabular-nums">' + panelState.stats.closed + '</strong> · داخلية: <strong class="tabular-nums">' + panelState.stats.internal + '</strong></p>' +
            '</div>' +
            '<div class="flex items-center gap-1.5 flex-wrap">' +
              (canAdd ? '<button type="button" class="btn btn-sm btn-primary" id="cn-toggle-add-btn">' + (panelState.composerOpen ? 'إغلاق نموذج الإضافة' : '+ إضافة ملاحظة') + '</button>' : '') +
              (canExport ? '<button type="button" class="btn btn-sm" id="cn-export-btn">تصدير</button>' : '') +
              (canPrint ? '<button type="button" class="btn btn-sm" id="cn-print-btn">طباعة</button>' : '') +
              (canRefresh ? '<button type="button" class="btn btn-sm" id="cn-refresh-btn">تحديث</button>' : '') +
            '</div>' +
          '</div>' +

          (canAdd && panelState.composerOpen ? (
            '<div id="cn-composer-box" style="padding:12px;border-radius:var(--radius-sm);background:var(--bg-surface-subtle);border:1px solid var(--border-strong);display:flex;flex-direction:column;gap:10px;">' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
                '<div class="form-group"><label class="form-label" for="cn-add-title">عنوان الملاحظة' + (addCfg.requiredTitle ? ' *' : ' (اختياري)') + '</label><input class="input" id="cn-add-title" placeholder="ملخص مختصر للملاحظة..."></div>' +
                '<div class="form-group"><label class="form-label" for="cn-add-type">نوع الملاحظة</label>' +
                  '<select class="select" id="cn-add-type">' +
                    noteTypes.map(function (tp) {
                      return '<option value="' + esc(tp) + '">' + esc(tp) + '</option>';
                    }).join('') +
                  '</select>' +
                '</div>' +
                '<div class="form-group"><label class="form-label" for="cn-add-status">الحالة</label>' +
                  '<select class="select" id="cn-add-status" data-search-placeholder="ابحث عن الحالة...">' +
                    buildStatusOptionsHtml(defSt ? defSt.id : '', '', '') +
                  '</select>' +
                '</div>' +
                ((reservations.length > 0 && !o.reservationId && addCfg.allowReservationLinked !== false) ? (
                  '<div class="form-group"><label class="form-label" for="cn-add-res">ربط بحجز' + (addCfg.requiredReservation ? ' *' : ' (اختياري)') + '</label>' +
                    '<select class="select" id="cn-add-res" data-search-placeholder="ابحث عن الحجز...">' +
                      '<option value="">بدون ربط بحجز</option>' +
                      reservations.map(function (r) {
                        return '<option value="' + esc(r.id) + '" data-num="' + esc(r.reservationNumber) + '">' + esc((r.reservationNumber || r.id) + (r.carName ? ' — ' + r.carName : '')) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>'
                ) : '') +
                (canAssign && employees.length > 0 ? (
                  '<div class="form-group"><label class="form-label" for="cn-add-emp">إسناد متابعة الملاحظة (اختياري)</label>' +
                    '<select class="select" id="cn-add-emp" data-search-placeholder="ابحث عن الموظف...">' +
                      '<option value="">بدون تعيين</option>' +
                      employees.map(function (e) {
                        return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>'
                ) : '') +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="cn-add-content">نص الملاحظة *</label><textarea class="textarea" id="cn-add-content" rows="3" maxlength="' + Number(addCfg.maxLength || 4000) + '" placeholder="اكتب تفاصيل التواصل أو الملاحظة (يدعم الإشارة @)..."></textarea></div>' +
              '<div class="flex items-center justify-between gap-2 flex-wrap">' +
                '<div class="flex items-center gap-3 flex-wrap">' +
                  (addCfg.allowInternalNotes !== false ? '<label class="checkbox-item" style="margin:0;"><input type="checkbox" id="cn-add-internal"> ملاحظة داخلية</label>' : '') +
                  (canAttach ? '<label class="btn btn-sm" style="cursor:pointer;">إرفاق ملف<input type="file" id="cn-add-file" multiple style="display:none;"></label>' : '') +
                  '<span id="cn-add-files-info" class="text-xs" style="color:var(--text-muted);">' + (panelState.pendingAttachments.length ? ('مرفقات محددة: ' + panelState.pendingAttachments.length) : '') + '</span>' +
                '</div>' +
                '<button type="button" class="btn btn-sm btn-primary" id="cn-save-new-btn">حفظ الملاحظة</button>' +
              '</div>' +
            '</div>'
          ) : '') +

          ((canSearch || canFilter) ? (
            '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">' +
              (canSearch ? '<input class="input" id="cn-filter-search" value="' + esc(panelState.search) + '" placeholder="ابحث في الملاحظات...">' : '') +
              (canFilter ? (
                '<select class="select" id="cn-filter-status" data-search-placeholder="ابحث عن الحالة...">' +
                  buildStatusOptionsHtml(panelState.statusId, 'جميع حالات الملاحظات', '') +
                '</select>' +
                '<select class="select" id="cn-filter-type">' +
                  '<option value="">جميع الأنواع</option>' +
                  noteTypes.map(function (tp) {
                    return '<option value="' + esc(tp) + '"' + (panelState.noteType === tp ? ' selected' : '') + '>' + esc(tp) + '</option>';
                  }).join('') +
                '</select>' +
                '<select class="select" id="cn-filter-sort">' +
                  '<option value="newest"' + (panelState.sortBy === 'newest' ? ' selected' : '') + '>الأحدث أولاً</option>' +
                  '<option value="oldest"' + (panelState.sortBy === 'oldest' ? ' selected' : '') + '>الأقدم أولاً</option>' +
                  '<option value="updated"' + (panelState.sortBy === 'updated' ? ' selected' : '') + '>آخر تحديث</option>' +
                '</select>'
              ) : '') +
            '</div>'
          ) : '') +

          notesListHtml +
        '</div>';

      enhanceSelects(hostEl);

      // Attach @mentions if available
      if (root.RGCrmMentions && typeof root.RGCrmMentions.attach === 'function') {
        var contentInp = hostEl.querySelector('#cn-add-content');
        if (contentInp) root.RGCrmMentions.attach(contentInp, function () { return employees; });
      }

      var toggleAddBtn = hostEl.querySelector('#cn-toggle-add-btn');
      if (toggleAddBtn) {
        toggleAddBtn.addEventListener('click', function () {
          panelState.composerOpen = !panelState.composerOpen;
          panelState.pendingAttachments = [];
          renderPanel();
        });
      }

      var exportBtn = hostEl.querySelector('#cn-export-btn');
      if (exportBtn) exportBtn.addEventListener('click', exportNotesCsv);

      var printBtn = hostEl.querySelector('#cn-print-btn');
      if (printBtn) printBtn.addEventListener('click', openPrintPreviewModal);

      var refreshBtn = hostEl.querySelector('#cn-refresh-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', reloadNotesFromServer);

      var fileInp = hostEl.querySelector('#cn-add-file');
      if (fileInp) {
        fileInp.addEventListener('change', function () {
          var files = Array.from(fileInp.files || []);
          var maxMb = Number((panelState.config.addNote && panelState.config.addNote.maxAttachmentSizeMb) || 5);
          var allowedTypes = (panelState.config.addNote && Array.isArray(panelState.config.addNote.allowedAttachmentTypes))
            ? panelState.config.addNote.allowedAttachmentTypes
            : [];
          panelState.pendingAttachments = [];
          var infoEl = hostEl.querySelector('#cn-add-files-info');
          files.slice(0, 5).forEach(function (f) {
            if (f.size > maxMb * 1024 * 1024) {
              if (ctx && ctx.toast) ctx.toast('الملف "' + f.name + '" يتجاوز الحجم الأقصى (' + maxMb + ' MB).', true);
              return;
            }
            if (allowedTypes.length > 0 && f.type && allowedTypes.indexOf(f.type) === -1) {
              if (ctx && ctx.toast) ctx.toast('نوع الملف "' + f.name + '" غير مسموح به.', true);
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              panelState.pendingAttachments.push({
                fileName: f.name,
                mimeType: f.type || 'application/octet-stream',
                fileSize: f.size,
                storageUrl: String(reader.result || ''),
                dataUrl: String(reader.result || '')
              });
              if (infoEl) infoEl.textContent = 'مرفقات جاهزة: ' + panelState.pendingAttachments.length;
            };
            reader.readAsDataURL(f);
          });
        });
      }

      var saveNewBtn = hostEl.querySelector('#cn-save-new-btn');
      if (saveNewBtn) {
        saveNewBtn.addEventListener('click', async function () {
          var submitNew = async function (confirmed) {
            var contentEl = hostEl.querySelector('#cn-add-content');
            var titleEl = hostEl.querySelector('#cn-add-title');
            var typeEl = hostEl.querySelector('#cn-add-type');
            var stEl = hostEl.querySelector('#cn-add-status');
            var resEl = hostEl.querySelector('#cn-add-res');
            var empEl = hostEl.querySelector('#cn-add-emp');
            var intEl = hostEl.querySelector('#cn-add-internal');
            var contentVal = contentEl ? contentEl.value.trim() : '';
            if (!contentVal) {
              if (ctx && ctx.toast) ctx.toast('يرجى كتابة نص الملاحظة.', true);
              return;
            }
            var resOpt = resEl && resEl.selectedOptions ? resEl.selectedOptions[0] : null;
            saveNewBtn.disabled = true;
            try {
              var resp = await root.RGApi.callApi('addCustomerNote', {
                customerId: o.customerId || '',
                reservationId: o.reservationId || (resEl ? resEl.value : ''),
                reservationNumber: o.reservationNumber || (resOpt ? (resOpt.getAttribute('data-num') || '') : ''),
                problemId: o.problemId || '',
                problemNumber: o.problemNumber || '',
                sourceSection: sourceSection,
                title: titleEl ? titleEl.value.trim() : '',
                noteType: typeEl ? typeEl.value : 'ملاحظة',
                statusId: stEl ? stEl.value : '',
                assignedEmployeeId: empEl ? empEl.value : '',
                isInternal: Boolean(intEl && intEl.checked),
                content: contentVal,
                attachments: panelState.pendingAttachments.slice(),
                confirmed: Boolean(confirmed)
              });
              if (!resp || !resp.success) {
                if (resp && resp.error === 'CONFIRM_REQUIRED') {
                  saveNewBtn.disabled = false;
                  showConfirmModal('تأكيد إضافة الملاحظة', resp.message || 'يرجى تأكيد إضافة الملاحظة الجديدة.', 'تأكيد الإضافة', false, function () {
                    submitNew(true);
                  });
                  return;
                }
                if (ctx && ctx.toast) ctx.toast((resp && resp.message) || 'تعذر حفظ الملاحظة.', true);
                saveNewBtn.disabled = false;
                return;
              }
              panelState.composerOpen = false;
              panelState.pendingAttachments = [];
              if (ctx && ctx.toast && evalBtn('add_note').rule.showSuccessNotification !== false) {
                ctx.toast('تمت إضافة الملاحظة بنجاح.');
              }
              await reloadNotesFromServer();
              if (typeof o.onChanged === 'function') o.onChanged(resp.data && resp.data.note);
            } catch (err) {
              if (ctx && ctx.toast) ctx.toast((err && err.message) || 'تعذر الاتصال بالخادم.', true);
              saveNewBtn.disabled = false;
            }
          };
          var ruleAdd = evalBtn('add_note', null, { checkConfirm: true, confirmed: false });
          if (!ruleAdd.allowed && ruleAdd.reason === 'CONFIRMATION_REQUIRED') {
            showConfirmModal('تأكيد إضافة الملاحظة', ruleAdd.message || 'هل تريد تأكيد إضافة الملاحظة؟', 'تأكيد', false, function () {
              submitNew(true);
            });
          } else {
            submitNew(false);
          }
        });
      }

      var searchEl = hostEl.querySelector('#cn-filter-search');
      if (searchEl) {
        var tm = null;
        searchEl.addEventListener('input', function () {
          if (tm) clearTimeout(tm);
          tm = setTimeout(function () {
            panelState.search = searchEl.value.trim();
            reloadNotesFromServer();
          }, 300);
        });
      }
      var bindFilterSel = function (selId, key) {
        var el = hostEl.querySelector('#' + selId);
        if (!el) return;
        el.addEventListener('change', function () {
          panelState[key] = el.value;
          reloadNotesFromServer();
        });
      };
      bindFilterSel('cn-filter-status', 'statusId');
      bindFilterSel('cn-filter-type', 'noteType');
      bindFilterSel('cn-filter-sort', 'sortBy');

      hostEl.querySelectorAll('.cn-quick-status').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var nid = sel.getAttribute('data-note-id');
          var note = panelState.notes.find(function (x) { return x && x.id === nid; });
          var nextStId = sel.value;
          if (!note || !nextStId || nextStId === note.statusId) return;
          var doStatusChange = async function (confirmed) {
            var res = await root.RGApi.callApi('changeCustomerNoteStatus', { noteId: nid, statusId: nextStId, confirmed: Boolean(confirmed) });
            if (!res || !res.success) {
              if (res && res.error === 'CONFIRM_REQUIRED') {
                showConfirmModal('تأكيد تغيير الحالة', res.message || 'هل تريد تأكيد تغيير حالة الملاحظة؟', 'تأكيد', false, function () {
                  doStatusChange(true);
                });
                return;
              }
              if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر تغيير حالة الملاحظة.', true);
              sel.value = note.statusId;
              enhanceSelects(hostEl);
              return;
            }
            if (ctx && ctx.toast && evalBtn('change_status', note).rule.showSuccessNotification !== false) {
              ctx.toast(res.message || 'تم تحديث حالة الملاحظة.');
            }
            await reloadNotesFromServer();
            if (typeof o.onChanged === 'function') o.onChanged();
          };
          var ruleChg = evalBtn('change_status', note, { checkConfirm: true, confirmed: false });
          if (!ruleChg.allowed && ruleChg.reason === 'CONFIRMATION_REQUIRED') {
            showConfirmModal('تأكيد تغيير الحالة', ruleChg.message || 'هل تريد تأكيد تغيير حالة الملاحظة؟', 'تأكيد', false, function () {
              doStatusChange(true);
            });
          } else {
            doStatusChange(false);
          }
        });
      });

      hostEl.querySelectorAll('.cn-btn-det').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = panelState.notes.find(function (x) { return x && x.id === btn.getAttribute('data-note-id'); });
          if (n) openNoteDetailsModal(n);
        });
      });

      hostEl.querySelectorAll('.cn-btn-hist').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = panelState.notes.find(function (x) { return x && x.id === btn.getAttribute('data-note-id'); });
          if (n) openNoteHistoryModal(n);
        });
      });

      hostEl.querySelectorAll('.cn-btn-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = panelState.notes.find(function (x) { return x && x.id === btn.getAttribute('data-note-id'); });
          if (n) openEditNoteModal(n);
        });
      });

      hostEl.querySelectorAll('.cn-btn-assign').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = panelState.notes.find(function (x) { return x && x.id === btn.getAttribute('data-note-id'); });
          if (n) openAssignNoteModal(n);
        });
      });

      hostEl.querySelectorAll('.cn-btn-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var nid = btn.getAttribute('data-note-id');
          var n = panelState.notes.find(function (x) { return x && x.id === nid; });
          if (!n) return;
          var doDelete = async function (confirmed) {
            var res = await root.RGApi.callApi('deleteCustomerNote', { noteId: nid, confirmed: Boolean(confirmed) });
            if (!res || !res.success) {
              if (res && res.error === 'CONFIRM_REQUIRED') {
                showConfirmModal('تأكيد حذف الملاحظة', res.message || 'هل أنت متأكد من حذف هذه الملاحظة؟', 'نعم، احذف', true, function () {
                  doDelete(true);
                });
                return;
              }
              if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر حذف الملاحظة.', true);
              return;
            }
            if (ctx && ctx.toast && evalBtn('delete_note', n).rule.showSuccessNotification !== false) {
              ctx.toast('تم حذف الملاحظة بنجاح.');
            }
            await reloadNotesFromServer();
            if (typeof o.onChanged === 'function') o.onChanged();
          };
          var ruleDel = evalBtn('delete_note', n, { checkConfirm: true, confirmed: false });
          if (!ruleDel.allowed && ruleDel.reason === 'CONFIRMATION_REQUIRED') {
            showConfirmModal('تأكيد حذف الملاحظة', 'هل أنت متأكد من حذف هذه الملاحظة؟ لا يمكن التراجع من الواجهة.', 'حذف الملاحظة', true, function () {
              doDelete(true);
            });
          } else {
            doDelete(false);
          }
        });
      });

      hostEl.querySelectorAll('.cn-del-att-btn').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var nid = btn.getAttribute('data-note-id');
          var aid = btn.getAttribute('data-att-id');
          var n = panelState.notes.find(function (x) { return x && x.id === nid; });
          showConfirmModal('حذف مرفق الملاحظة', 'هل تريد حذف هذا المرفق من الملاحظة؟', 'حذف المرفق', true, async function () {
            var res = await root.RGApi.callApi('deleteCustomerNoteAttachment', { noteId: nid, attachmentId: aid, confirmed: true });
            if (!res || !res.success) {
              if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر حذف المرفق.', true);
              return;
            }
            if (ctx && ctx.toast) ctx.toast('تم حذف المرفق بنجاح.');
            await reloadNotesFromServer();
            if (typeof o.onChanged === 'function') o.onChanged();
          });
        });
      });
    }

    if (panelState.loading) {
      reloadNotesFromServer();
    } else {
      renderPanel();
    }
  }

  function renderProfileView(container, ctx, data) {
    var core = coreFn();
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var activeUiCtx = root.RGApp && root.RGApp.getActiveUiContext ? root.RGApp.getActiveUiContext() : null;
    var notesCfg = getCustomerNotesConfigSafe(data && data.notesConfig);
    var csCfg = notesCfg.customersSection || {};

    var cust = (data && data.customer) || {};
    var reservations = (data && Array.isArray(data.reservations)) ? data.reservations : [];
    var extensions = (data && Array.isArray(data.extensions)) ? data.extensions : [];
    var problems = (data && Array.isArray(data.problems)) ? data.problems : [];
    var followUps = (data && Array.isArray(data.followUps)) ? data.followUps : [];
    var notes = (data && Array.isArray(data.notes)) ? data.notes : [];
    var noteStatuses = (data && Array.isArray(data.noteStatuses)) ? data.noteStatuses : getCustomerNoteStatusesSafe();
    var fin = (data && data.financialSummary) || {};
    var timeline = (data && Array.isArray(data.timeline)) ? data.timeline : [];
    var employees = (data && Array.isArray(data.employees)) ? data.employees : [];

    var canViewId = (core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false) && csCfg.showSensitiveIds !== false;
    var canEditCust = csCfg.enableEditCustomer !== false && core.canUserPerform && core.canUserPerform(user, 'edit_customer_details') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_edit_customer', activeUiCtx));
    var canCreatePrb = core.canUserPerform && core.canUserPerform(user, 'create_problem');
    var canExportPdf = csCfg.enableExport !== false && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_pdf', activeUiCtx));
    var canSeeComplaintsTab = csCfg.showProblemsTab !== false && (!core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_complaints', activeUiCtx));
    var canSeeTimelineTab = csCfg.enableActivityLog !== false && (!core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_timeline', activeUiCtx));

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
          '<button type="button" class="tab-btn' + (activeTab === 'followups' ? ' active' : '') + '" id="cust-tab-followups" data-cust-tab="followups">الملاحظات والتواصل (' + (notes.length + followUps.length) + ')</button>' +
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
                '<div class="rg-cust-info-item"><span class="k">آخر حجز</span><span class="v mono" dir="ltr">' + esc(cust.lastReservationNumber || '-') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">آخر تواصل</span><span class="v mono" dir="ltr">' + esc(cust.lastContactAt ? fmtDateTime(cust.lastContactAt, ctx) : 'لم يُسجل بعد') + '</span></div>' +
                '<div class="rg-cust-info-item"><span class="k">ملاحظات الملف</span><span class="v">' + esc(cust.notes || '-') + '</span></div>' +
              '</div>' +
            '</section>' +
            '<div class="flex flex-col gap-4" style="min-width:0;">' +
              (csCfg.showBookingsTab !== false ? (
                '<section class="surface-card" style="min-width:0;">' +
                  '<div class="section-header" style="margin-bottom:10px;"><h3 class="section-title">الحجوزات الحالية والسابقة (' + reservations.length + ')</h3></div>' +
                  '<div class="table-wrap rg-cust-table-wrap"><table class="data-table rg-cust-table"><thead><tr><th>رقم الحجز</th><th>الشركة</th><th>المركبة</th><th>الاستلام</th><th>الانتهاء</th><th>الإجمالي</th><th>الحالة</th><th>التمديدات</th></tr></thead><tbody>' +
                    resRowsHtml +
                  '</tbody></table></div>' +
                '</section>'
              ) : '') +
              (csCfg.showExtensionsTab !== false ? (
                '<section class="surface-card" style="min-width:0;">' +
                  '<div class="section-header" style="margin-bottom:10px;"><h3 class="section-title">سجل التمديدات (' + extensions.length + ')</h3></div>' +
                  '<div class="table-wrap rg-cust-table-wrap"><table class="data-table rg-cust-table"><thead><tr><th>رقم التمديد</th><th>الحجز</th><th>المدة</th><th>الفترة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>' +
                    extRowsHtml +
                  '</tbody></table></div>' +
                '</section>'
              ) : '') +
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
            '<div id="cust-notes-panel-host"></div>' +
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

    // Mount unified searchable Customer Notes panel inside the followups/notes tab
    var notesHost = document.getElementById('cust-notes-panel-host');
    if (notesHost) {
      mountCustomerNotesPanel(notesHost, {
        customerId: cust.id,
        sourceSection: 'customers',
        reservations: reservations,
        employees: employees,
        initialNotes: notes,
        noteStatuses: noteStatuses,
        notesConfig: notesCfg,
        ctx: ctx,
        onChanged: function () {
          if (root.RGApi && root.RGApi.markScopesStale) root.RGApi.markScopesStale(['customers']);
        }
      });
    }

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
        openCustomerFormModal(cust, {}, ctx, function () {
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
          { key: 'status', label: 'حالة العميل' }
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
    var notesCfg = getCustomerNotesConfigSafe();
    var csCfg = notesCfg.customersSection || {};

    var cSt = getCustomersState(ctx);
    var items = (listData && Array.isArray(listData.items)) ? listData.items : [];
    var kpis = (listData && listData.kpis) || {};
    var recentList = (listData && Array.isArray(listData.recentCustomers)) ? listData.recentCustomers : [];
    var facets = (listData && listData.facets) || {};
    var companies = Array.isArray(facets.companies) ? facets.companies : [];
    var resStatusOpts = (Array.isArray(facets.reservationStatusOptions) && facets.reservationStatusOptions.length)
      ? facets.reservationStatusOptions
      : (core.CUSTOMER_RESERVATION_STATUS_OPTIONS || [
          { value: 'نشط الآن', labelAr: 'نشط الآن', color: '#10b981' },
          { value: 'جاهز للاستلام', labelAr: 'جاهز للاستلام', color: '#3b82f6' },
          { value: 'بانتظار المتابعة', labelAr: 'بانتظار المتابعة', color: '#f59e0b' },
          { value: 'جديد / بانتظار المراجعة', labelAr: 'جديد / بانتظار المراجعة', color: '#8b5cf6' },
          { value: 'متأخر في السداد', labelAr: 'متأخر في السداد', color: '#f97316' },
          { value: 'منتهي', labelAr: 'منتهي / مكتمل', color: '#64748b' },
          { value: 'ملغي', labelAr: 'ملغي', color: '#ef4444' },
          { value: 'مرفوض', labelAr: 'مرفوض', color: '#dc2626' }
        ]);

    var canViewId = (core.canUserViewCustomerId ? core.canUserViewCustomerId(user) : false) && csCfg.showSensitiveIds !== false;
    var canShowDash = !core.canUserViewSubSection || core.canUserViewSubSection(user, 'sub_view_cust_dashboard', activeUiCtx);
    var canAddEdit = csCfg.enableAddCustomer !== false && core.canUserPerform && core.canUserPerform(user, 'edit_customer_details') && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_edit_customer', activeUiCtx));

    var canExportExcel = csCfg.enableExport !== false && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_excel', activeUiCtx));
    var canExportPdfDir = csCfg.enableExport !== false && (!core.canUserUseActionButton || core.canUserUseActionButton(user, 'act_export_pdf', activeUiCtx));
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
      { key: 'active_customers', label: 'العملاء النشطون', val: Number(kpis.activeCustomers || 0), tone: 'ok' },
      { key: 'with_reservations', label: 'لديهم حجوزات', val: Number(kpis.withReservationsCustomers || 0), tone: 'info' },
      { key: 'without_reservations', label: 'بدون حجوزات', val: Number(kpis.withoutReservationsCustomers || 0), tone: '' },
      { key: 'new', label: 'العملاء الجدد', val: Number(kpis.newCustomers || 0), tone: 'info' },
      { key: 'active', label: 'أصحاب حجوزات نشطة', val: Number(kpis.activeBookingCustomers || 0), tone: 'ok' },
      { key: 'past', label: 'أصحاب حجوزات سابقة', val: Number(kpis.pastBookingCustomers || 0), tone: '' },
      { key: 'open_problems', label: 'لديهم مشاكل مفتوحة', val: Number(kpis.openProblemCustomers || 0), tone: 'danger' },
      { key: 'complaints', label: 'شكاوى قيد المعالجة', val: Number(kpis.inProgressComplaintCustomers || 0), tone: 'danger' },
      { key: 'extensions', label: 'لديهم تمديدات', val: Number(kpis.withExtensionsCustomers || 0), tone: 'warn' },
      { key: 'unfollowed', label: 'لم تتم متابعتهم', val: Number(kpis.unfollowedCustomers || 0), tone: 'warn' },
      { key: 'repeat', label: 'أكثر من حجز (متكررون)', val: Number(kpis.repeatCustomers || 0), tone: 'ok' },
      { key: 'recent', label: 'مضافون / محدثون حديثاً', val: Number(kpis.recentCustomers || 0), tone: 'info' },
      { key: 'missing_phone', label: 'بدون رقم جوال', val: Number(kpis.missingPhoneCustomers || 0), tone: 'warn' },
      { key: 'missing_email', label: 'بدون بريد إلكتروني', val: Number(kpis.missingEmailCustomers || 0), tone: '' },
      { key: 'missing_id', label: 'بدون رقم هوية', val: Number(kpis.missingIdCustomers || 0), tone: 'warn' }
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
            '<td class="rg-cust-nowrap">' + (c.lastReservationStatus ? '<span class="status-tag ' + statusTagClass(c.lastReservationStatus) + '">' + esc(c.lastReservationStatus) + '</span>' : '<span style="color:var(--text-muted);">-</span>') + '</td>' +
            '<td class="mono text-xs rg-cust-nowrap" dir="ltr">' + esc(c.lastContactAt ? fmtDateTime(c.lastContactAt, ctx) : '-') + '</td>' +
            '<td class="rg-cust-nowrap">' +
              '<span class="status-tag ' + statusTagClass(c.status) + '">' + esc(c.status || 'جديد') + '</span>' +
              '<div class="mono text-[10.5px] mt-1" style="color:var(--text-muted);" dir="ltr">' + esc(fmtDateTime(c.createdAt, ctx).slice(0, 10)) + '</div>' +
            '</td>' +
          '</tr>';
        }).join('');

    var total = (listData && listData.total !== undefined && listData.total !== null) ? Number(listData.total) : items.length;
    var page = Number(listData && listData.page ? listData.page : 1);
    var totalPages = Number(listData && listData.totalPages ? listData.totalPages : 1);
    var backfillWarning = String((listData && listData.backfillWarning) || '').trim();

    container.innerHTML =
      '<div class="flex flex-col gap-4">' +
        (backfillWarning ? (
          '<div class="rg-error-banner surface-card" role="alert" style="padding:14px 16px;border:1px solid var(--status-warn-border, #f59e0b);background:var(--status-warn-bg, rgba(245,158,11,0.09));">' +
            '<div class="flex items-center justify-between gap-3 flex-wrap">' +
              '<div>' +
                '<strong style="color:var(--status-warn-text, #b45309);font-size:13.5px;">تنبيه مزامنة ملفات العملاء</strong>' +
                '<p style="margin:4px 0 0;color:var(--text-secondary);font-size:12.5px;">تعذر إكمال ربط بعض الحجوزات بالعملاء تلقائياً: ' + esc(backfillWarning) + '</p>' +
              '</div>' +
              '<button type="button" class="btn btn-sm btn-primary" id="cust-backfill-retry-btn">إعادة المحاولة الآن</button>' +
            '</div>' +
          '</div>'
        ) : '') +
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
            (csCfg.enableSearch !== false ? (
              '<div class="rg-cust-search-wrap">' +
                '<label class="rg-inactive-field-lbl" for="cust-search-inp">بحث سريع بالعملاء</label>' +
                '<input class="input" id="cust-search-inp" value="' + esc(cSt.search || '') + '" placeholder="' + (canViewId ? 'ابحث بالاسم، الجوال، رقم الحجز، الهوية، البريد...' : 'ابحث بالاسم، الجوال، رقم الحجز، البريد...') + '">' +
              '</div>'
            ) : '') +
            (csCfg.enableFilters !== false ? (
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-status-sel">الحالة (حالة الحجز)</label>' +
                '<select class="select" id="cust-status-sel" data-search-placeholder="ابحث عن الحالة...">' +
                  '<option value="">جميع حالات الحجوزات</option>' +
                  resStatusOpts.map(function (opt) {
                    var val = typeof opt === 'string' ? opt : (opt.value || opt.labelAr || '');
                    var lbl = typeof opt === 'string' ? opt : (opt.labelAr || opt.value || '');
                    var col = typeof opt === 'string' ? '' : (opt.color || '');
                    return '<option value="' + esc(val) + '"' + (col ? ' data-color="' + esc(col) + '"' : '') + (cSt.status === val ? ' selected' : '') + '>' + esc(lbl) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-comp-sel">شركة التأجير</label>' +
                '<select class="select" id="cust-comp-sel" data-search-placeholder="ابحث عن الشركة..."><option value="">جميع الشركات</option>' +
                  companies.map(function (co) {
                    return '<option value="' + esc(co) + '"' + (cSt.company === co ? ' selected' : '') + '>' + esc(co) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-date-from">من تاريخ الحجز</label>' +
                '<input type="date" class="input mono" dir="ltr" id="cust-date-from" value="' + esc(cSt.dateFrom || '') + '">' +
              '</div>' +
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-date-to">إلى تاريخ الحجز</label>' +
                '<input type="date" class="input mono" dir="ltr" id="cust-date-to" value="' + esc(cSt.dateTo || '') + '">' +
              '</div>' +
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-prb-sel">المشاكل والشكاوى</label>' +
                '<select class="select" id="cust-prb-sel">' +
                  '<option value="">الكل</option>' +
                  '<option value="open_problems"' + (cSt.problemFilter === 'open_problems' ? ' selected' : '') + '>لديهم مشاكل مفتوحة</option>' +
                  '<option value="open_complaints"' + (cSt.problemFilter === 'open_complaints' ? ' selected' : '') + '>شكاوى قيد المعالجة</option>' +
                  '<option value="no_problems"' + (cSt.problemFilter === 'no_problems' ? ' selected' : '') + '>بدون مشاكل</option>' +
                '</select>' +
              '</div>' +
              '<div class="rg-cust-filter-field">' +
                '<label class="rg-inactive-field-lbl" for="cust-sort-sel">الترتيب</label>' +
                '<select class="select" id="cust-sort-sel">' +
                  '<option value="last_activity"' + (cSt.sortBy === 'last_activity' ? ' selected' : '') + '>آخر نشاط</option>' +
                  '<option value="bookings_desc"' + (cSt.sortBy === 'bookings_desc' ? ' selected' : '') + '>الأكثر حجوزات</option>' +
                  '<option value="active_desc"' + (cSt.sortBy === 'active_desc' ? ' selected' : '') + '>الحجوزات النشطة</option>' +
                  '<option value="amount_desc"' + (cSt.sortBy === 'amount_desc' ? ' selected' : '') + '>أعلى إنفاق</option>' +
                  '<option value="created_desc"' + (cSt.sortBy === 'created_desc' ? ' selected' : '') + '>تاريخ الإنشاء (الأحدث)</option>' +
                  '<option value="name_asc"' + (cSt.sortBy === 'name_asc' ? ' selected' : '') + '>الاسم (أ-ي)</option>' +
                '</select>' +
              '</div>'
            ) : '') +
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
                '<th>آخر حالة حجز</th>' +
                '<th>آخر تواصل</th>' +
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

    enhanceSelects(container);

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
        { key: 'lastReservationStatus', label: 'آخر حالة حجز' },
        { key: 'lastContactAt', label: 'آخر تواصل', formatType: 'datetime' },
        { key: 'status', label: 'حالة العميل' },
        { key: 'createdAt', label: 'تاريخ الإنشاء', formatType: 'date' }
      );
      var fetchExportRows = async function () {
        var expRes = await root.RGApi.callApi('getCustomers', {
          search: cSt.search || '',
          status: cSt.status || '',
          company: cSt.company || '',
          dateFrom: cSt.dateFrom || '',
          dateTo: cSt.dateTo || '',
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

    var bfRetryBtn = document.getElementById('cust-backfill-retry-btn');
    if (bfRetryBtn) {
      bfRetryBtn.addEventListener('click', function () {
        if (root.RGApi && root.RGApi.markScopesStale) root.RGApi.markScopesStale(['customers']);
        render(container, Object.assign({}, ctx || {}, { forceRefresh: true }));
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
    bindSel('cust-date-from', 'dateFrom');
    bindSel('cust-date-to', 'dateTo');
    bindSel('cust-prb-sel', 'problemFilter');
    bindSel('cust-sort-sel', 'sortBy');

    var resetBtn = document.getElementById('cust-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        cSt.search = '';
        cSt.status = '';
        cSt.company = '';
        cSt.dateFrom = '';
        cSt.dateTo = '';
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

  function renderErrorBanner(container, message, onRetry) {
    container.innerHTML =
      '<div class="rg-error-banner surface-card" role="alert" style="padding:20px;border:1px solid var(--status-danger-border, #ef4444);background:var(--status-danger-bg, rgba(239,68,68,0.08));">' +
        '<div class="flex items-center justify-between gap-3 flex-wrap">' +
          '<div>' +
            '<h3 style="margin:0 0 6px;color:var(--status-danger-text, #dc2626);font-size:15px;">تعذر تحميل بيانات العملاء من الخادم</h3>' +
            '<p style="margin:0;color:var(--text-secondary);font-size:13px;">' + esc(message || 'حدث خطأ أثناء جلب سجلات العملاء أو الإحصائيات من قاعدة البيانات.') + '</p>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-sm" id="cust-retry-load-btn">إعادة المحاولة</button>' +
        '</div>' +
      '</div>';
    var retryBtn = document.getElementById('cust-retry-load-btn');
    if (retryBtn && typeof onRetry === 'function') {
      retryBtn.addEventListener('click', onRetry);
    }
  }

  async function render(container, ctx) {
    bindGlobalDeltaRefresh();
    var cSt = getCustomersState(ctx);
    var selectedId = cSt.selectedCustomerId || currentProfileState.customerId;

    var existingTable = container.querySelector('.rg-cust-table-wrap');
    if (!container.innerHTML.trim() || (!selectedId && !existingTable)) {
      container.innerHTML =
        '<div class="rg-loading-state flex flex-col gap-3" aria-busy="true">' +
          '<div class="rg-skeleton-table-rows"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>' +
        '</div>';
    } else if (existingTable) {
      existingTable.style.opacity = '0.6';
      existingTable.style.pointerEvents = 'none';
    }

    try {
      if (selectedId) {
        if (currentProfileState.data && currentProfileState.data.customer && currentProfileState.data.customer.id === selectedId) {
          renderProfileView(container, ctx, currentProfileState.data);
        }
        var detRes = await root.RGApi.callApi('getCustomerDetails', { customerId: selectedId });
        if (detRes && detRes.success && detRes.data && detRes.data.customer) {
          currentProfileState.customerId = detRes.data.customer.id;
          currentProfileState.data = detRes.data;
          renderProfileView(container, ctx, detRes.data);
          return;
        }
        cSt.selectedCustomerId = '';
        currentProfileState.customerId = '';
        currentProfileState.data = null;
        if (ctx && ctx.toast) ctx.toast((detRes && detRes.message) || 'تعذر تحميل ملف العميل.', true);
      }

      var listRes = await root.RGApi.callApi('getCustomers', {
        search: cSt.search || '',
        status: cSt.status || '',
        company: cSt.company || '',
        dateFrom: cSt.dateFrom || '',
        dateTo: cSt.dateTo || '',
        problemFilter: cSt.problemFilter || '',
        kpiFilter: cSt.kpiFilter || 'all',
        sortBy: cSt.sortBy || 'last_activity',
        page: cSt.page || 1,
        pageSize: cSt.pageSize || 50,
        forceRefresh: Boolean(ctx && ctx.forceRefresh)
      });
      if (!listRes || !listRes.success || !listRes.data || !Array.isArray(listRes.data.items) || !listRes.data.kpis) {
        throw new Error((listRes && listRes.message) || 'تعذر تحميل قائمة العملاء.');
      }
      renderDirectoryView(container, ctx, listRes.data);
    } catch (err) {
      var msg = (err && err.message) ? err.message : 'تعذر تحميل قائمة العملاء.';
      renderErrorBanner(container, msg, function () {
        render(container, ctx);
      });
      if (ctx && ctx.toast) ctx.toast(msg, true);
    }
  }

  root.RGCustomers = {
    render: render,
    openCustomerProfile: openCustomerProfile,
    mountCustomerNotesPanel: mountCustomerNotesPanel
  };
})(window);
