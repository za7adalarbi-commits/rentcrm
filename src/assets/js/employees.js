/**
 * RENTAL GATE CRM — Employees Directory, Ready-Made Role Presets, Custom Permissions & Account Management
 */
(function (root) {
  'use strict';

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function groupCatalogItems(catalog) {
    var groups = [];
    (catalog || []).forEach(function (c) {
      if (groups.indexOf(c.group) === -1) groups.push(c.group);
    });
    return groups;
  }

  function runWithLock(btnEl, lockKey, fn) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn);
    }
    return Promise.resolve().then(fn);
  }

  var activeEmployeeManagerUnsubscribe = null;

  function EmployeeManager(options) {
    this.opts = options || {};
    this.container = this.opts.container;
    this.ctx = this.opts.ctx || {};
    this.appStore = this.opts.appState || (this.ctx && this.ctx.appState) || root.RGApp || null;
    this.unsubscribe = null;
  }

  EmployeeManager.prototype.mount = function () {
    var self = this;
    if (typeof activeEmployeeManagerUnsubscribe === 'function') {
      try { activeEmployeeManagerUnsubscribe(); } catch (e) {}
      activeEmployeeManagerUnsubscribe = null;
    }
    this.renderFromState();
    if (this.appStore && typeof this.appStore.subscribeEmployees === 'function') {
      this.unsubscribe = this.appStore.subscribeEmployees(function () {
        if (!self.container || self.container.isConnected === false) {
          self.destroy();
          return;
        }
        self.renderFromState();
      });
      activeEmployeeManagerUnsubscribe = this.unsubscribe;
    }
    return this;
  };

  EmployeeManager.prototype.destroy = function () {
    if (typeof this.unsubscribe === 'function') {
      try { this.unsubscribe(); } catch (e) {}
      this.unsubscribe = null;
    }
  };

  EmployeeManager.prototype.renderFromState = function () {
    var self = this;
    var container = this.container;
    if (!container) return;

    var ctx = this.ctx;
    var t = ctx.t || function (k) { return k; };
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var canManage = Boolean(user && root.RGCrmCore && root.RGCrmCore.canUserPerform(user, 'manage_employees'));

    var empState = (this.appStore && typeof this.appStore.getEmployeesState === 'function')
      ? this.appStore.getEmployeesState()
      : (this.opts.initialState || { items: [], rolePresets: [], customPermissions: [] });

    var items = Array.isArray(empState.items) ? empState.items : [];
    var rolePresets = root.RGCrmCore.normalizeRolePresets(empState.rolePresets || []);
    var customPermissions = Array.isArray(empState.customPermissions) ? empState.customPermissions : [];
    var catalog = root.RGCrmCore.mergePermissionsCatalog(customPermissions);
    var catalogMap = {};
    catalog.forEach(function (c) { catalogMap[c.key] = c; });

    var roleLabels = root.RGCrmCore.ROLE_LABELS[ctx.lang] || root.RGCrmCore.ROLE_LABELS.ar;

    var presetsSectionHtml = canManage ? (
      '<section class="surface-card" id="role-presets-section">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">إدارة الصلاحيات الجاهزة (القوالب الوظيفية)</h2>' +
            '<p class="section-subtitle">أضف قوالب صلاحيات جاهزة، عدّل أسماءها وصلاحياتها، أو عدّل وأضف مسميات الصلاحيات الفردية (<strong class="tabular-nums" style="color:var(--text-primary);">' + rolePresets.length + '</strong> قوالب نشطة)</p>' +
          '</div>' +
          '<div class="toolbar-actions">' +
            '<button type="button" class="btn btn-primary" id="preset-add-btn">+ إضافة صلاحية جاهزة</button>' +
            '<button type="button" class="btn" id="perms-catalog-btn">إدارة وتعديل الصلاحيات الفردية</button>' +
            '<button type="button" class="btn btn-sm" id="preset-reset-btn" data-confirm="0">استعادة الافتراضي</button>' +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">' +
          rolePresets.map(function (pr) {
            var permKeys = Array.isArray(pr.permissions) ? pr.permissions : [];
            var previewLabels = permKeys.slice(0, 4).map(function (k) {
              return (catalogMap[k] && catalogMap[k].label) || k;
            });
            var extraCount = Math.max(0, permKeys.length - previewLabels.length);
            var roleTagClass = pr.role === 'general_manager'
              ? 'status-danger'
              : (pr.role === 'supervisor' ? 'status-warning' : 'status-info');

            return '<div class="glass-subcard p-3.5 flex flex-col justify-between gap-2.5 transition-all hover:-translate-y-0.5" data-preset-card="' + esc(pr.id) + '">' +
              '<div class="flex flex-col gap-1.5">' +
                '<div class="flex items-start justify-between gap-2">' +
                  '<strong class="text-sm leading-snug" style="color:var(--text-primary);">' + esc(pr.label) + '</strong>' +
                  '<span class="status-tag ' + roleTagClass + '">' + esc(roleLabels[pr.role] || pr.role) + '</span>' +
                '</div>' +
                '<div class="flex items-center gap-1.5 text-xs" style="color:var(--text-muted);">' +
                  '<span>المسمى: <strong style="color:var(--text-primary);">' + esc(pr.jobTitle) + '</strong></span>' +
                  '<span>·</span>' +
                  '<span class="tabular-nums">' + permKeys.length + ' صلاحية</span>' +
                '</div>' +
                '<div class="text-xs leading-relaxed" style="color:var(--text-secondary);">' +
                  (previewLabels.length ? esc(previewLabels.join(' · ')) : 'لا توجد صلاحيات محددة') +
                  (extraCount > 0 ? ' <strong style="color:var(--brand-primary);">+' + extraCount + ' أخرى</strong>' : '') +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-1.5 flex-wrap pt-2 border-t" style="border-color:var(--border-hairline);">' +
                '<button type="button" class="btn btn-sm preset-edit-btn" data-id="' + esc(pr.id) + '">تعديل الاسم والصلاحيات</button>' +
                '<button type="button" class="btn btn-sm btn-primary preset-use-btn" data-id="' + esc(pr.id) + '">تعيين لموظف</button>' +
                '<button type="button" class="btn btn-sm btn-danger preset-del-btn" data-id="' + esc(pr.id) + '" data-confirm="0">حذف</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    ) : '';

    var stateErrorHtml = empState.error
      ? '<div class="form-error mb-3" role="alert">' + esc(empState.error) + '</div>'
      : '';

    var rowsHtml = (empState.loading && items.length === 0)
      ? '<tr><td colspan="' + (canManage ? 11 : 10) + '" class="px-4 py-8 text-center text-sm" style="color:var(--text-muted);">جاري تحميل بيانات الموظفين...</td></tr>'
      : (items.length === 0
        ? '<tr><td colspan="' + (canManage ? 11 : 10) + '" class="px-4 py-8 text-center text-sm" style="color:var(--text-muted);">لا يوجد موظفون مسجلون حاليًا.</td></tr>'
        : items.map(function (e) {
          var isActive = e.status === 'active';
          var isSelf = Boolean(user && e.id === user.id);
          var permsList = root.RGCrmCore.resolveEffectivePermissions(e);
          var initialChar = String(e.name || 'م').trim().charAt(0) || 'م';
          var resCnt = e.reservationsCount !== undefined ? e.reservationsCount : ((e.stats && e.stats.assignedCount) || 0);
          var fuCnt = e.followUpsCount !== undefined ? e.followUpsCount : ((e.stats && e.stats.followUpsCount) || 0);
          var prbCnt = e.problemsCount !== undefined ? e.problemsCount : ((e.stats && e.stats.openProblemsCount) || 0);
          var lastActText = e.lastActivity
            ? esc((ctx && ctx.formatDateTime ? ctx.formatDateTime(e.lastActivity) : (root.RGApp && root.RGApp.formatDateTime ? root.RGApp.formatDateTime(e.lastActivity) : (root.RGCrmCore && root.RGCrmCore.formatDisplayDateTime ? root.RGCrmCore.formatDisplayDateTime(e.lastActivity) : String(e.lastActivity).replace('T', ' ').substring(0, 16)))))
            : '-';

          return '<tr data-emp-row="' + esc(e.id) + '">' +
            '<td>' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<span class="inline-flex items-center justify-center w-7 h-7 rounded-lg font-bold text-xs shrink-0" style="background:var(--brand-soft);color:var(--brand-primary);border:1px solid rgba(217,31,43,0.26);">' + esc(initialChar) + '</span>' +
                '<button type="button" class="btn-link-inline emp-view-btn" data-id="' + esc(e.id) + '">' + esc(e.name) + '</button>' +
                (isSelf ? '<span class="status-tag status-neutral">أنت</span>' : '') +
                (canManage && !isSelf ? (
                  '<button type="button" class="btn btn-sm btn-danger emp-del-btn" data-id="' + esc(e.id) + '" data-name="' + esc(e.name) + '" data-confirm="0" aria-label="حذف الموظف ' + esc(e.name) + '">حذف</button>'
                ) : '') +
              '</div>' +
              (e.phone ? '<div class="text-[11px] mt-1 font-mono cell-phone" style="color:var(--text-muted);" dir="ltr">' + esc(e.phone) + '</div>' : '') +
            '</td>' +
            '<td class="mono text-xs" style="color:var(--text-secondary);" dir="ltr">' + esc(e.username) + '</td>' +
            '<td class="text-xs" style="color:var(--text-primary);">' + esc(e.jobTitle) + '</td>' +
            '<td>' +
              '<div class="text-xs font-semibold" style="color:var(--text-primary);">' + esc(roleLabels[e.role] || e.role) + '</div>' +
              '<div class="text-[11px] tabular-nums" style="color:var(--text-muted);">' + permsList.length + ' صلاحية</div>' +
            '</td>' +
            '<td>' +
              '<div class="flex items-center gap-1.5 flex-wrap">' +
                '<span class="status-tag emp-status-tag ' + (isActive ? 'status-success' : 'status-danger') + '">' +
                  (isActive ? 'نشط' : 'متوقف عن النشاط') +
                '</span>' +
                (canManage && !isSelf ? (
                  '<button type="button" class="btn btn-sm emp-toggle-btn ' + (isActive ? 'btn-danger' : 'btn-primary') + '" data-id="' + esc(e.id) + '" data-next="' + (isActive ? 'disabled' : 'active') + '" title="' + (isActive ? 'إيقاف نشاط الموظف فوراً' : 'تشغيل نشاط الموظف') + '">' +
                    (isActive ? 'إيقاف' : 'تفعيل') +
                  '</button>'
                ) : '') +
              '</div>' +
            '</td>' +
            '<td class="tabular-nums text-xs font-semibold">' + resCnt + '</td>' +
            '<td class="tabular-nums text-xs font-semibold">' + fuCnt + '</td>' +
            '<td class="tabular-nums text-xs font-semibold">' + prbCnt + '</td>' +
            '<td class="mono tabular-nums text-xs whitespace-nowrap" style="color:var(--text-muted);">' + lastActText + '</td>' +
            '<td><button type="button" class="btn btn-sm btn-primary emp-view-btn" data-id="' + esc(e.id) + '">العملاء</button></td>' +
            (canManage ? (
              '<td class="whitespace-nowrap">' +
                '<div class="flex items-center gap-1.5">' +
                  '<button type="button" class="btn btn-sm emp-edit-btn" data-id="' + esc(e.id) + '" aria-label="تعديل بيانات ' + esc(e.name) + '">تعديل</button>' +
                '</div>' +
              '</td>'
            ) : '') +
          '</tr>';
        }).join(''));

    container.innerHTML =
      '<div class="flex flex-col gap-5" data-component="EmployeeManager">' +
        '<section class="surface-card" id="employee-manager-card">' +
          '<div class="section-header">' +
            '<div>' +
              '<h2 class="section-title">' + t('nav_employees') + '</h2>' +
              '<p class="section-subtitle">إجمالي الموظفين الحاليين: <strong class="tabular-nums" style="color:var(--text-primary);" id="emp-total-count">' + items.length + '</strong> · تحديث لحظي مباشر مع نظام الحالة</p>' +
            '</div>' +
            (canManage ? (
              '<div class="toolbar-actions">' +
                '<button type="button" class="btn" id="emp-scroll-presets-btn">الصلاحيات الجاهزة (' + rolePresets.length + ')</button>' +
                '<button type="button" class="btn btn-primary" id="emp-add-btn">إضافة موظف جديد</button>' +
              '</div>'
            ) : '') +
          '</div>' +
          stateErrorHtml +
          '<div class="table-wrap">' +
            '<table class="data-table" id="employee-manager-table">' +
              '<thead>' +
                '<tr>' +
                  '<th>الموظف والنشاط</th>' +
                  '<th>المستخدم</th>' +
                  '<th>الوظيفة</th>' +
                  '<th>الدور والصلاحيات</th>' +
                  '<th>الحالة</th>' +
                  '<th>حجوزات</th>' +
                  '<th>متابعات</th>' +
                  '<th>مشكلات</th>' +
                  '<th>آخر نشاط</th>' +
                  '<th>العملاء</th>' +
                  (canManage ? '<th>الإجراءات</th>' : '') +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                rowsHtml +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>' +
        presetsSectionHtml +
      '</div>';

    function reloadEmployeesFromServer() {
      if (self.appStore && typeof self.appStore.loadEmployeesState === 'function') {
        return self.appStore.loadEmployeesState({});
      }
      return render(container, ctx);
    }

    var scrollPresetsBtn = document.getElementById('emp-scroll-presets-btn');
    if (scrollPresetsBtn) {
      scrollPresetsBtn.addEventListener('click', function () {
        var sec = document.getElementById('role-presets-section');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    var addBtn = document.getElementById('emp-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openEmployeeModal(null, ctx, reloadEmployeesFromServer, {
          rolePresets: rolePresets,
          customPermissions: customPermissions
        });
      });
    }

    container.querySelectorAll('.emp-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEmployeeDetailsDrawer(btn.getAttribute('data-id'), ctx, items, reloadEmployeesFromServer);
      });
    });

    container.querySelectorAll('.emp-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var emp = items.find(function (x) { return x.id === btn.getAttribute('data-id'); });
        if (emp) {
          openEmployeeModal(emp, ctx, reloadEmployeesFromServer, {
            rolePresets: rolePresets,
            customPermissions: customPermissions
          });
        }
      });
    });

    container.querySelectorAll('.emp-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var empId = btn.getAttribute('data-id');
        var nextStatus = btn.getAttribute('data-next');
        runWithLock(btn, 'disableEmployee:' + empId, async function () {
          ctx.toast(nextStatus === 'disabled' ? 'تم إيقاف نشاط الموظف وإلغاء جلساته.' : 'تم تشغيل نشاط الموظف بنجاح.');
          var resToggle = (self.appStore && typeof self.appStore.toggleEmployeeStatusInState === 'function')
            ? await self.appStore.toggleEmployeeStatusInState(empId, nextStatus, user)
            : await root.RGApi.callApi('disableEmployee', { employeeId: empId, status: nextStatus });
          if (!resToggle || !resToggle.success) {
            ctx.toast((resToggle && resToggle.message) || 'تعذر تحديث حالة الموظف.', true);
          }
        });
      });
    });

    container.querySelectorAll('.emp-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-confirm') !== '1') {
          btn.setAttribute('data-confirm', '1');
          btn.textContent = 'تأكيد الحذف؟';
          setTimeout(function () {
            if (document.body.contains(btn)) {
              btn.setAttribute('data-confirm', '0');
              btn.textContent = 'حذف';
            }
          }, 4000);
          return;
        }
        var empId = btn.getAttribute('data-id');
        var empName = btn.getAttribute('data-name') || '';
        runWithLock(btn, 'deleteEmployee:' + empId, async function () {
          var delResp = (self.appStore && typeof self.appStore.deleteEmployeeFromState === 'function')
            ? await self.appStore.deleteEmployeeFromState(empId, user)
            : await root.RGApi.callApi('deleteEmployee', { employeeId: empId });
          if (delResp && delResp.success) {
            ctx.toast(delResp.message || ('تم حذف الموظف ' + empName + ' بنجاح.'));
            if (!self.appStore || typeof self.appStore.deleteEmployeeFromState !== 'function') {
              render(container, ctx);
            }
          } else {
            ctx.toast((delResp && delResp.message) || 'تعذر حذف الموظف.', true);
            if (btn.isConnected !== false) {
              btn.setAttribute('data-confirm', '0');
              btn.textContent = 'حذف';
            }
          }
        });
      });
    });

    if (canManage) {
      var presetAddBtn = document.getElementById('preset-add-btn');
      if (presetAddBtn) {
        presetAddBtn.addEventListener('click', function () {
          openRolePresetModal(null, customPermissions, ctx, reloadEmployeesFromServer);
        });
      }

      var permsCatBtn = document.getElementById('perms-catalog-btn');
      if (permsCatBtn) {
        permsCatBtn.addEventListener('click', function () {
          openPermissionsCatalogModal(customPermissions, ctx, reloadEmployeesFromServer);
        });
      }

      var resetBtn = document.getElementById('preset-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          if (resetBtn.getAttribute('data-confirm') !== '1') {
            resetBtn.setAttribute('data-confirm', '1');
            resetBtn.textContent = 'تأكيد استعادة الافتراضي؟';
            resetBtn.classList.add('btn-danger');
            setTimeout(function () {
              if (document.body.contains(resetBtn)) {
                resetBtn.setAttribute('data-confirm', '0');
                resetBtn.textContent = 'استعادة الافتراضي';
                resetBtn.classList.remove('btn-danger');
              }
            }, 3500);
            return;
          }
          runWithLock(resetBtn, 'resetRolePresets', async function () {
            var resp = await root.RGApi.callApi('resetRolePresets', {});
            if (resp.success) {
              ctx.toast(resp.message || 'تمت استعادة القوالب الافتراضية.');
              await reloadEmployeesFromServer();
            } else {
              ctx.toast(resp.message, true);
            }
          });
        });
      }

      container.querySelectorAll('.preset-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var found = rolePresets.find(function (p) { return p.id === btn.getAttribute('data-id'); });
          if (found) {
            openRolePresetModal(found, customPermissions, ctx, reloadEmployeesFromServer);
          }
        });
      });

      container.querySelectorAll('.preset-use-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openEmployeeModal(null, ctx, reloadEmployeesFromServer, {
            rolePresets: rolePresets,
            customPermissions: customPermissions,
            initialPresetId: btn.getAttribute('data-id')
          });
        });
      });

      container.querySelectorAll('.preset-del-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.getAttribute('data-confirm') !== '1') {
            btn.setAttribute('data-confirm', '1');
            btn.textContent = 'تأكيد الحذف؟';
            setTimeout(function () {
              if (document.body.contains(btn)) {
                btn.setAttribute('data-confirm', '0');
                btn.textContent = 'حذف';
              }
            }, 3500);
            return;
          }
          var pId = btn.getAttribute('data-id');
          runWithLock(btn, 'deleteRolePreset:' + pId, async function () {
            var delResp = await root.RGApi.callApi('deleteRolePreset', { presetId: pId });
            if (delResp.success) {
              ctx.toast(delResp.message || 'تم حذف الصلاحية الجاهزة.');
              await reloadEmployeesFromServer();
            } else {
              ctx.toast(delResp.message, true);
              btn.setAttribute('data-confirm', '0');
              btn.textContent = 'حذف';
            }
          });
        });
      });
    }
  };

  async function render(container, ctx) {
    var appStore = (ctx && ctx.appState) || root.RGApp || null;
    var res = await root.RGApi.callApi('getEmployees', {});
    if (!res.success) {
      container.innerHTML = '<div class="form-error">' + esc(res.message) + '</div>';
      return;
    }

    if (appStore && typeof appStore.syncEmployeesStateFromPayload === 'function') {
      appStore.syncEmployeesStateFromPayload(res.data || {});
    }

    var manager = new EmployeeManager({
      container: container,
      ctx: ctx,
      appState: appStore,
      initialState: res.data || {}
    });
    manager.mount();
  }



  function openRolePresetModal(existingPreset, customPermissions, ctx, onSaved) {
    var modalRoot = document.getElementById('modal-root');
    var isEdit = Boolean(existingPreset && existingPreset.id);
    var liveCustomPerms = Array.isArray(customPermissions) ? customPermissions.slice() : [];
    var catalog = root.RGCrmCore.mergePermissionsCatalog(liveCustomPerms);
    var groups = groupCatalogItems(catalog);
    var initialRole = (existingPreset && existingPreset.role) || 'agent';
    var initialPerms = (existingPreset && Array.isArray(existingPreset.permissions))
      ? existingPreset.permissions.slice()
      : root.RGCrmCore.resolveEffectivePermissions(initialRole);

    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="preset-modal-title">' +
        '<form class="modal-panel" id="preset-form" style="max-width:760px;">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="preset-modal-title">' + (isEdit ? 'تعديل الصلاحية الجاهزة: ' + esc(existingPreset.label) : 'إضافة صلاحية جاهزة جديدة') + '</h3>' +
            '<button type="button" class="btn btn-sm" id="preset-modal-cancel">إغلاق</button>' +
          '</div>' +

          '<div class="form-grid-3">' +
            '<div class="form-group"><label class="form-label" for="pr-label">اسم الصلاحية الجاهزة (القالب)</label><input class="input" id="pr-label" value="' + esc(existingPreset ? existingPreset.label : '') + '" placeholder="مثال: مشرف وردية مسائية" required></div>' +
            '<div class="form-group"><label class="form-label" for="pr-job">المسمى الوظيفي الافتراضي</label><input class="input" id="pr-job" value="' + esc(existingPreset ? existingPreset.jobTitle : '') + '" placeholder="مثال: مشرف خدمة عملاء"></div>' +
            '<div class="form-group"><label class="form-label" for="pr-role">الدور الأساسي</label><select class="select" id="pr-role">' +
              '<option value="agent"' + (initialRole === 'agent' ? ' selected' : '') + '>موظف خدمة العملاء</option>' +
              '<option value="supervisor"' + (initialRole === 'supervisor' ? ' selected' : '') + '>المشرف</option>' +
              '<option value="general_manager"' + (initialRole === 'general_manager' ? ' selected' : '') + '>المدير العام</option>' +
            '</select></div>' +
          '</div>' +

          '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<div><strong style="font-size:13.5px;">الصلاحيات المشمولة في هذا القالب</strong>' +
              '<div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">حدد الصلاحيات أو ألغها، أو أضف صلاحية جديدة مباشرة للقائمة.</div></div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-sm" id="pr-perm-defaults">افتراضي الدور</button>' +
                '<button type="button" class="btn btn-sm" id="pr-perm-all">تحديد الكل</button>' +
                '<button type="button" class="btn btn-sm" id="pr-perm-clear">إلغاء الكل</button>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 10px;margin-bottom:10px;background:var(--bg-surface-subtle);border:1px solid var(--border-hairline);border-radius:var(--radius-sm);">' +
              '<input class="input" id="pr-quick-perm-label" placeholder="أضف صلاحية جديدة للقائمة (مثال: متابعة VIP)..." style="flex:1;min-width:180px;min-height:32px;font-size:12.5px;">' +
              '<input class="input" id="pr-quick-perm-group" value="صلاحيات مخصصة" placeholder="المجموعة" style="width:145px;min-height:32px;font-size:12.5px;">' +
              '<button type="button" class="btn btn-sm btn-primary" id="pr-quick-perm-add">+ إضافة صلاحية</button>' +
            '</div>' +

            '<div id="pr-permissions-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:10px;"></div>' +
          '</div>' +

          '<div id="pr-form-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="submit" class="btn btn-primary" id="pr-save-btn">' + (isEdit ? 'حفظ تعديلات الصلاحية الجاهزة' : 'حفظ الصلاحية الجاهزة') + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    var roleSelect = document.getElementById('pr-role');
    var permsGrid = document.getElementById('pr-permissions-grid');
    var selectedSet = {};
    initialPerms.forEach(function (k) { selectedSet[k] = true; });

    function renderGrid() {
      var roleVal = roleSelect.value;
      var isAgent = roleVal === 'agent';
      var dashKeys = (root.RGCrmCore && root.RGCrmCore.DASHBOARD_PERMISSION_KEYS) || [];
      catalog = root.RGCrmCore.mergePermissionsCatalog(liveCustomPerms);
      groups = groupCatalogItems(catalog);
      permsGrid.innerHTML = groups.map(function (g) {
        var groupItems = catalog.filter(function (c) { return c.group === g; });
        var selectableItems = groupItems.filter(function (item) {
          return !((item.key === 'sync_data' || item.key === 'manage_api_connection') && isAgent);
        });
        var checkedInGroup = selectableItems.filter(function (item) { return Boolean(selectedSet[item.key]); }).length;
        var allGroupChecked = selectableItems.length > 0 && checkedInGroup === selectableItems.length;
        var isDashGroup = g === 'لوحة التحكم';
        var dashViewDisabled = isDashGroup && !selectedSet.view_dashboard;
        return '<div style="padding:10px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--brand-primary);">' + esc(g) + ' <span class="tabular-nums" style="font-weight:600;color:var(--text-muted);font-size:11px;">(' + checkedInGroup + '/' + groupItems.length + ')</span></div>' +
            '<button type="button" class="btn btn-sm pr-group-toggle-btn" data-group="' + esc(g) + '" style="min-height:24px;padding:2px 8px;font-size:11px;">' + (allGroupChecked ? 'إلغاء الكل' : 'تحديد الكل') + '</button>' +
          '</div>' +
          (dashViewDisabled ? '<div style="font-size:11px;padding:5px 8px;margin-bottom:8px;border-radius:4px;background:var(--status-warning-bg);color:var(--status-warning-text);border:1px solid var(--status-warning-border);">عرض لوحة التحكم معطل — عند تحديد أي عنصر هنا سيتم تفعيله تلقائياً أو فعّله من مجموعة (عام).</div>' : '') +
          '<div style="display:flex;flex-direction:column;gap:6px;">' +
            groupItems.map(function (item) {
              var isApiPerm = item.key === 'sync_data' || item.key === 'manage_api_connection';
              var disabled = isApiPerm && isAgent;
              var checked = Boolean(selectedSet[item.key]) && !disabled;
              return '<label class="checkbox-item" style="font-size:12.5px;">' +
                '<input type="checkbox" class="pr-perm-checkbox" value="' + esc(item.key) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '> ' +
                '<span>' + esc(item.label) + (item.isCustom ? ' <em style="font-size:10.5px;color:var(--brand-primary);">(مخصصة)</em>' : '') + '</span>' +
              '</label>';
            }).join('') +
          '</div>' +
        '</div>';
      }).join('');

      permsGrid.querySelectorAll('.pr-perm-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) {
            selectedSet[cb.value] = true;
            if (dashKeys.indexOf(cb.value) !== -1 && !selectedSet.view_dashboard) {
              selectedSet.view_dashboard = true;
            }
          } else {
            delete selectedSet[cb.value];
          }
          renderGrid();
        });
      });

      permsGrid.querySelectorAll('.pr-group-toggle-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var gName = btn.getAttribute('data-group');
          var groupItems = catalog.filter(function (c) {
            if (c.group !== gName) return false;
            if (isAgent && (c.key === 'sync_data' || c.key === 'manage_api_connection')) return false;
            return true;
          });
          var allChecked = groupItems.length > 0 && groupItems.every(function (c) { return Boolean(selectedSet[c.key]); });
          groupItems.forEach(function (c) {
            if (allChecked) delete selectedSet[c.key];
            else selectedSet[c.key] = true;
          });
          if (!allChecked && gName === 'لوحة التحكم') {
            selectedSet.view_dashboard = true;
          }
          renderGrid();
        });
      });
    }

    renderGrid();

    roleSelect.addEventListener('change', renderGrid);

    document.getElementById('pr-perm-defaults').addEventListener('click', function () {
      selectedSet = {};
      root.RGCrmCore.resolveEffectivePermissions(roleSelect.value).forEach(function (k) { selectedSet[k] = true; });
      renderGrid();
    });

    document.getElementById('pr-perm-all').addEventListener('click', function () {
      catalog.forEach(function (c) {
        if (roleSelect.value === 'agent' && (c.key === 'sync_data' || c.key === 'manage_api_connection')) return;
        selectedSet[c.key] = true;
      });
      renderGrid();
    });

    document.getElementById('pr-perm-clear').addEventListener('click', function () {
      selectedSet = {};
      renderGrid();
    });

    var quickAddBtn = document.getElementById('pr-quick-perm-add');
    quickAddBtn.addEventListener('click', function () {
      var lblEl = document.getElementById('pr-quick-perm-label');
      var grpEl = document.getElementById('pr-quick-perm-group');
      var lbl = lblEl.value.trim();
      if (!lbl) {
        ctx.toast('اكتب اسم الصلاحية الجديدة أولاً.', true);
        return;
      }
      runWithLock(quickAddBtn, 'savePermissionDefinition:quick', async function () {
        var addResp = await root.RGApi.callApi('savePermissionDefinition', {
          label: lbl,
          group: grpEl.value.trim() || 'صلاحيات مخصصة'
        });
        if (!addResp.success) {
          ctx.toast(addResp.message, true);
          return;
        }
        liveCustomPerms = addResp.data.customPermissions || [];
        if (addResp.data.saved && addResp.data.saved.key) {
          selectedSet[addResp.data.saved.key] = true;
        }
        lblEl.value = '';
        renderGrid();
        ctx.toast('تمت إضافة الصلاحية الجديدة وتحديدها في القالب.');
      });
    });

    document.getElementById('preset-modal-cancel').addEventListener('click', function () {
      if (onSaved && existingPreset && existingPreset._fromEmployeeModal) {
        onSaved({ cancelled: true, customPermissions: liveCustomPerms });
      } else {
        modalRoot.innerHTML = '';
      }
    });

    document.getElementById('preset-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = document.getElementById('pr-form-err');
      errEl.classList.add('hidden');
      var saveBtn = document.getElementById('pr-save-btn');
      runWithLock(saveBtn, 'saveRolePreset:' + (isEdit ? existingPreset.id : 'new'), async function () {
        var perms = Object.keys(selectedSet).filter(function (k) { return selectedSet[k]; });
        if (perms.indexOf('dash_perms_configured') === -1) {
          perms.push('dash_perms_configured');
        }
        var resp = await root.RGApi.callApi('saveRolePreset', {
          id: isEdit ? existingPreset.id : '',
          label: document.getElementById('pr-label').value,
          jobTitle: document.getElementById('pr-job').value,
          role: roleSelect.value,
          permissions: perms
        });

        if (!resp.success) {
          errEl.textContent = resp.message;
          errEl.classList.remove('hidden');
          return;
        }

        ctx.toast(resp.message || 'تم حفظ الصلاحية الجاهزة.');
        modalRoot.innerHTML = '';
        if (onSaved) {
          onSaved({
            rolePresets: resp.data.rolePresets,
            savedPreset: resp.data.savedPreset,
            customPermissions: liveCustomPerms
          });
        }
      });
    });
  }

  function openPermissionsCatalogModal(customPermissions, ctx, onDone) {
    var modalRoot = document.getElementById('modal-root');
    var liveCustom = Array.isArray(customPermissions) ? customPermissions.slice() : [];

    function renderCatalogModal() {
      var catalog = root.RGCrmCore.mergePermissionsCatalog(liveCustom);
      modalRoot.innerHTML =
        '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="perms-cat-title">' +
          '<div class="modal-panel" style="max-width:780px;">' +
            '<div class="modal-header">' +
              '<div><h3 class="modal-title" id="perms-cat-title">إدارة وتعديل الصلاحيات الفردية</h3>' +
              '<p class="section-subtitle">يمكنك إضافة صلاحية مخصصة جديدة، أو تعديل اسم ومجموعة أي صلاحية، أو حذف الصلاحيات المخصصة.</p></div>' +
              '<button type="button" class="btn btn-sm" id="perms-cat-close">إغلاق</button>' +
            '</div>' +

            '<form id="perm-add-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding:12px;background:var(--bg-surface-subtle);border:1px solid var(--border-hairline);border-radius:var(--radius-sm);">' +
              '<div class="form-group" style="flex:1.4;min-width:190px;"><label class="form-label" for="new-perm-label">اسم الصلاحية الجديدة</label><input class="input" id="new-perm-label" placeholder="مثال: مراجعة العقود الشهرية" required></div>' +
              '<div class="form-group" style="flex:1;min-width:150px;"><label class="form-label" for="new-perm-group">المجموعة</label><input class="input" id="new-perm-group" value="صلاحيات مخصصة" required></div>' +
              '<button type="submit" class="btn btn-primary">+ إضافة صلاحية</button>' +
            '</form>' +

            '<div class="table-wrap" style="max-height:380px;overflow:auto;"><table class="data-table"><thead><tr>' +
              '<th>اسم الصلاحية</th><th>المجموعة</th><th>النوع</th><th>إجراء</th>' +
            '</tr></thead><tbody>' +
              catalog.map(function (c) {
                return '<tr data-perm-key="' + esc(c.key) + '">' +
                  '<td><input class="input perm-row-label" value="' + esc(c.label) + '" style="min-height:32px;font-size:12.5px;"></td>' +
                  '<td><input class="input perm-row-group" value="' + esc(c.group) + '" style="min-height:32px;font-size:12.5px;width:150px;"></td>' +
                  '<td>' + (c.isCustom
                    ? '<span class="status-tag status-info">مخصصة</span>'
                    : (c.isRenamed ? '<span class="status-tag status-warning">معدل</span>' : '<span class="status-tag status-neutral">أساسية</span>')) + '</td>' +
                  '<td><div style="display:flex;gap:6px;">' +
                    '<button type="button" class="btn btn-sm btn-primary perm-row-save" data-key="' + esc(c.key) + '">حفظ التعديل</button>' +
                    ((c.isCustom || c.isRenamed)
                      ? '<button type="button" class="btn btn-sm btn-danger perm-row-del" data-key="' + esc(c.key) + '">' + (c.isCustom ? 'حذف' : 'استعادة') + '</button>'
                      : '') +
                  '</div></td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>' +
          '</div>' +
        '</div>';

      document.getElementById('perms-cat-close').addEventListener('click', function () {
        modalRoot.innerHTML = '';
        if (onDone) onDone({ customPermissions: liveCustom });
      });

      var permAddForm = document.getElementById('perm-add-form');
      permAddForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var submitBtn = permAddForm.querySelector('button[type="submit"]');
        runWithLock(submitBtn, 'savePermissionDefinition:add', async function () {
          var resp = await root.RGApi.callApi('savePermissionDefinition', {
            label: document.getElementById('new-perm-label').value,
            group: document.getElementById('new-perm-group').value
          });
          if (!resp.success) {
            ctx.toast(resp.message, true);
            return;
          }
          liveCustom = resp.data.customPermissions || [];
          ctx.toast('تمت إضافة الصلاحية الجديدة.');
          renderCatalogModal();
        });
      });

      modalRoot.querySelectorAll('.perm-row-save').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-key');
          var row = modalRoot.querySelector('tr[data-perm-key="' + key + '"]');
          var labelVal = row.querySelector('.perm-row-label').value;
          var groupVal = row.querySelector('.perm-row-group').value;
          runWithLock(btn, 'savePermissionDefinition:' + key, async function () {
            var resp = await root.RGApi.callApi('savePermissionDefinition', {
              key: key,
              label: labelVal,
              group: groupVal
            });
            if (!resp.success) {
              ctx.toast(resp.message, true);
              return;
            }
            liveCustom = resp.data.customPermissions || [];
            ctx.toast('تم حفظ تعديل الصلاحية.');
            renderCatalogModal();
          });
        });
      });

      modalRoot.querySelectorAll('.perm-row-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-key');
          runWithLock(btn, 'deletePermissionDefinition:' + key, async function () {
            var resp = await root.RGApi.callApi('deletePermissionDefinition', { key: key });
            if (!resp.success) {
              ctx.toast(resp.message, true);
              return;
            }
            liveCustom = resp.data.customPermissions || [];
            ctx.toast(resp.message || 'تم تحديث الصلاحية.');
            renderCatalogModal();
          });
        });
      });
    }

    renderCatalogModal();
  }

  async function openEmployeeDetailsDrawer(employeeId, ctx, allEmployees, onUpdated) {
    var modalRoot = document.getElementById('modal-root');
    var resp = await root.RGApi.callApi('getEmployeeDetails', { employeeId: employeeId });
    if (!resp.success) {
      ctx.toast(resp.message, true);
      return;
    }

    var d = resp.data;
    var emp = d.employee;
    var stats = d.stats || {};
    var reservations = d.assignedReservations || [];
    var followUps = d.followUps || [];
    var roleLabels = root.RGCrmCore.ROLE_LABELS[ctx.lang] || root.RGCrmCore.ROLE_LABELS.ar;

    modalRoot.innerHTML =
      '<div class="drawer-backdrop" id="emp-drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="emp-drawer-title">' +
        '<div class="drawer-panel">' +
          '<div class="modal-header">' +
            '<div><h3 class="modal-title" id="emp-drawer-title">' + esc(emp.name) + '</h3>' +
            '<div class="meta-inline"><span>' + esc(emp.jobTitle) + '</span><span>·</span><span>' + esc(roleLabels[emp.role] || emp.role) + '</span>' +
            (emp.phone ? '<span>·</span><span class="mono cell-phone" dir="ltr">' + esc(emp.phone) + '</span>' : '') + '</div></div>' +
            '<button type="button" class="btn btn-sm" id="emp-drawer-close">إغلاق</button>' +
          '</div>' +

          '<div class="kpi-grid-4">' +
            '<div class="kpi-card"><span class="kpi-label">العملاء</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + (stats.uniqueCustomersCount || 0) + '</span></div>' +
            '<div class="kpi-card"><span class="kpi-label">الحجوزات</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + (stats.reservationsCount || 0) + '</span></div>' +
            '<div class="kpi-card kpi-success"><span class="kpi-label">المتابعات</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + (stats.followUpsCount || 0) + '</span></div>' +
            '<div class="kpi-card ' + ((stats.problemsCount || 0) ? 'kpi-danger' : '') + '"><span class="kpi-label">المشكلات</span><span class="kpi-value tabular-nums" style="font-size:20px;">' + (stats.problemsCount || 0) + '</span></div>' +
          '</div>' +

          '<div class="chart-card"><h4 class="chart-card-title">ملخص حالات حجوزات الموظف</h4><div class="chart-canvas-wrap" style="height:175px;"><canvas id="emp-drawer-chart"></canvas></div></div>' +

          '<div>' +
            '<h4 style="margin:0 0 10px;font-size:14px;">عملاء وحجوزات الموظف (' + reservations.length + ') — اضغط على أي حجز لعرض التفاصيل</h4>' +
            (reservations.length === 0
              ? '<div class="empty-state" style="padding:20px;">لا توجد حجوزات أو عملاء مسندون لهذا الموظف حاليًا.</div>'
              : '<div class="timeline-list">' + reservations.map(function (r) {
                  var whatHappened = r.latestFollowUp
                    ? (r.latestFollowUp.employeeName + ' (' + r.latestFollowUp.status + '): ' + r.latestFollowUp.action + (r.latestFollowUp.notes ? ' — ' + r.latestFollowUp.notes : ''))
                    : (r.lastUpdateText || 'تم استيراد الحجز وبانتظار المتابعة');
                  return '<button type="button" class="interactive-res-card emp-open-res" data-res-id="' + esc(r.id) + '">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;width:100%;">' +
                      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<strong class="mono">' + esc(r.reservationNumber) + '</strong>' +
                        '<span>·</span>' +
                        '<strong>' + esc(r.customerName) + '</strong>' +
                        '<span class="mono cell-phone" dir="ltr" style="color:var(--text-muted);font-size:12px;">' + esc(r.customerPhone) + '</span>' +
                      '</div>' +
                      '<span class="status-tag status-info">' + esc(r.internalStatus) + '</span>' +
                    '</div>' +
                    '<div class="meta-inline">' +
                      '<span>' + esc(r.companyName) + ' — ' + esc(r.branchName) + '</span><span>·</span>' +
                      '<span>' + esc(r.carName) + '</span><span>·</span>' +
                      '<span class="mono" style="white-space:nowrap;">' + esc(root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(r.startDate) : r.startDate) + ' → ' + esc(root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(r.endDate) : r.endDate) + '</span>' +
                    '</div>' +
                    '<div class="res-story-box"><strong>ما حدث في الحجز:</strong> ' + esc(whatHappened) + '</div>' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;width:100%;font-size:12px;color:var(--text-muted);">' +
                      '<span class="tabular-nums">المتابعات: ' + (r.followUpsCount || 0) + ' (منها ' + (r.myFollowUpsCount || 0) + ' للموظف) · المشكلات: ' + (r.problemsCount || 0) + '</span>' +
                      '<span style="color:var(--brand-primary);font-weight:700;">فتح تفاصيل الحجز ←</span>' +
                    '</div>' +
                  '</button>';
                }).join('') + '</div>') +
          '</div>' +

          '<div>' +
            '<h4 style="margin:0 0 10px;font-size:14px;">سجل متابعات الموظف (' + followUps.length + ')</h4>' +
            (followUps.length === 0
              ? '<div class="empty-state" style="padding:20px;">لم يقم هذا الموظف بتسجيل متابعات بعد.</div>'
              : '<div class="timeline-list">' + followUps.map(function (f) {
                  return '<div class="timeline-item">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                      '<button type="button" class="btn-link-inline mono emp-open-res" data-res-id="' + esc(f.reservationId) + '">' + esc(f.reservationNumber) + ' — ' + esc(f.customerName) + '</button>' +
                      '<span class="status-tag status-info">' + esc(f.status) + '</span>' +
                    '</div>' +
                    '<div>' + esc(f.action) + '</div>' +
                    (f.notes ? '<div style="color:var(--text-secondary);font-size:12.5px;">' + esc(f.notes) + '</div>' : '') +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                      '<div class="meta-inline mono" style="white-space:nowrap;"><span>' + esc(root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(f.followUpDate) : f.followUpDate) + '</span><span>·</span><span dir="ltr">' + esc(ctx && ctx.formatTime ? ctx.formatTime(f.followUpTime) : (root.RGApp && root.RGApp.formatTime ? root.RGApp.formatTime(f.followUpTime) : f.followUpTime)) + '</span></div>' +
                      '<button type="button" class="btn btn-sm emp-open-res" data-res-id="' + esc(f.reservationId) + '">تفاصيل الحجز</button>' +
                    '</div>' +
                  '</div>';
                }).join('') + '</div>') +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('emp-drawer-close').addEventListener('click', function () { modalRoot.innerHTML = ''; });

    modalRoot.querySelectorAll('.emp-open-res').forEach(function (el) {
      el.addEventListener('click', function () {
        var resId = el.getAttribute('data-res-id');
        root.RGReservations.openReservationDrawer(resId, ctx, allEmployees, onUpdated, {
          backLabel: 'العودة إلى ' + emp.name,
          onBack: function () {
            openEmployeeDetailsDrawer(employeeId, ctx, allEmployees, onUpdated);
          }
        });
      });
    });

    var chartEl = document.getElementById('emp-drawer-chart');
    if (chartEl && root.Chart) {
      if (typeof root.Chart.getChart === 'function') {
        var existingEmpChart = root.Chart.getChart(chartEl);
        if (existingEmpChart) existingEmpChart.destroy();
      }
      var statusMap = stats.statusCounts || {};
      var labels = Object.keys(statusMap);
      var values = Object.values(statusMap);
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var reduced = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var txt = isDark ? '#E5E7EB' : '#292929';
      var mutedTxt = isDark ? '#9CA3AF' : '#686868';
      var gridCol = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(41,41,41,0.08)';
      var empCtx2d = chartEl.getContext('2d');
      var empGrad = empCtx2d.createLinearGradient(0, 0, 0, 180);
      empGrad.addColorStop(0, '#D91F2B');
      empGrad.addColorStop(1, 'rgba(153, 19, 28, 0.72)');
      new root.Chart(empCtx2d, {
        type: 'bar',
        data: {
          labels: labels.length ? labels : ['لا توجد بيانات'],
          datasets: [{
            label: 'عدد الحجوزات',
            data: values.length ? values : [0],
            backgroundColor: empGrad,
            hoverBackgroundColor: '#B81722',
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 36
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reduced ? false : {
            duration: 620,
            easing: 'easeOutQuart',
            delay: function (context) {
              return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 70 : 0;
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
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
                  return ' ' + (ctxItem.dataset.label || '') + ': ' + val + ' (' + pct + '%)';
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: txt, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { display: false } },
            y: { ticks: { color: mutedTxt, precision: 0, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { color: gridCol }, beginAtZero: true }
          }
        }
      });
    }
  }

  function openEmployeeModal(existing, ctx, onSaved, opts) {
    var options = opts || {};
    var modalRoot = document.getElementById('modal-root');
    var isEdit = Boolean(existing);
    var presets = root.RGCrmCore.normalizeRolePresets(options.rolePresets);
    var customPermissions = Array.isArray(options.customPermissions) ? options.customPermissions.slice() : [];
    var catalog = root.RGCrmCore.mergePermissionsCatalog(customPermissions);
    var groups = groupCatalogItems(catalog);

    var initialPreset = options.initialPresetId
      ? presets.find(function (p) { return p.id === options.initialPresetId; })
      : null;

    var draftState = {
      name: existing ? existing.name : '',
      username: existing ? existing.username : '',
      phone: existing ? (existing.phone || '') : '',
      email: existing ? (existing.email || '') : '',
      jobTitle: initialPreset ? initialPreset.jobTitle : (existing ? existing.jobTitle : 'موظف خدمة العملاء'),
      role: initialPreset ? initialPreset.role : (existing ? existing.role : 'agent'),
      presetId: initialPreset ? initialPreset.id : 'custom',
      permissions: initialPreset
        ? initialPreset.permissions.slice()
        : (existing ? root.RGCrmCore.resolveEffectivePermissions(existing) : root.RGCrmCore.resolveEffectivePermissions('agent'))
    };

    function drawModal() {
      catalog = root.RGCrmCore.mergePermissionsCatalog(customPermissions);
      groups = groupCatalogItems(catalog);

      modalRoot.innerHTML =
        '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="emp-modal-title">' +
          '<form class="modal-panel" id="emp-form" style="max-width:790px;">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title" id="emp-modal-title">' + (isEdit ? 'تعديل بيانات وصلاحيات: ' + esc(existing.name) : 'إنشاء حساب موظف جديد') + '</h3>' +
              '<button type="button" class="btn btn-sm" id="emp-cancel">إغلاق</button>' +
            '</div>' +

            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
                '<label class="form-label" for="ef-preset" style="margin:0;">الوظائف والصلاحيات الجاهزة (قالب سريع)</label>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm btn-primary" id="ef-preset-add">+ حفظ كقالب جديد</button>' +
                  '<button type="button" class="btn btn-sm" id="ef-preset-edit"' + (draftState.presetId === 'custom' ? ' disabled' : '') + '>تعديل المحدد</button>' +
                  '<button type="button" class="btn btn-sm btn-danger" id="ef-preset-delete" data-confirm="0"' + (draftState.presetId === 'custom' ? ' disabled' : '') + '>حذف المحدد</button>' +
                '</div>' +
              '</div>' +
              '<select class="select" id="ef-preset" style="margin-bottom:8px;">' +
                '<option value="custom"' + (draftState.presetId === 'custom' ? ' selected' : '') + '>— تخصيص يدوي للصلاحيات —</option>' +
                presets.map(function (pr) {
                  return '<option value="' + esc(pr.id) + '"' + (draftState.presetId === pr.id ? ' selected' : '') + '>' + esc(pr.label) + '</option>';
                }).join('') +
              '</select>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                presets.map(function (pr) {
                  var isActiveChip = draftState.presetId === pr.id;
                  return '<button type="button" class="btn btn-sm ef-preset-chip' + (isActiveChip ? ' btn-primary' : '') + '" data-preset-id="' + esc(pr.id) + '">' + esc(pr.label) + '</button>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div class="form-grid-2">' +
              '<div class="form-group"><label class="form-label" for="ef-name">الاسم الكامل</label><input class="input" id="ef-name" value="' + esc(draftState.name) + '" required></div>' +
              '<div class="form-group"><label class="form-label" for="ef-username">اسم المستخدم</label><input class="input mono" id="ef-username" value="' + esc(draftState.username) + '" ' + (isEdit ? 'disabled' : 'required') + '></div>' +
              '<div class="form-group"><label class="form-label" for="ef-phone">رقم الهاتف</label><input class="input mono" id="ef-phone" value="' + esc(draftState.phone) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-email">البريد الإلكتروني</label><input class="input mono" type="email" id="ef-email" value="' + esc(draftState.email) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-job">المسمى الوظيفي</label><input class="input" id="ef-job" value="' + esc(draftState.jobTitle) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-role">الدور الأساسي</label><select class="select" id="ef-role">' +
                '<option value="agent"' + (draftState.role === 'agent' ? ' selected' : '') + '>موظف خدمة العملاء</option>' +
                '<option value="supervisor"' + (draftState.role === 'supervisor' ? ' selected' : '') + '>المشرف</option>' +
                '<option value="general_manager"' + (draftState.role === 'general_manager' ? ' selected' : '') + '>المدير العام</option>' +
              '</select></div>' +
            '</div>' +

            '<div style="padding:12px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
                '<div><strong style="font-size:13.5px;">الصلاحيات المخصصة لهذا الموظف (بما فيها عناصر لوحة التحكم)</strong>' +
                '<div id="ef-api-lock-note" style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">صلاحيات API والربط محصورة بدور المشرف أو المدير العام · يمكنك تحديد ما يظهر في لوحة التحكم بدقة.</div></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-sm" id="ef-manage-perms-btn">+ إضافة / تعديل صلاحية</button>' +
                  '<button type="button" class="btn btn-sm" id="ef-perm-defaults">افتراضي الدور</button>' +
                  '<button type="button" class="btn btn-sm" id="ef-perm-all">تحديد الكل</button>' +
                  '<button type="button" class="btn btn-sm" id="ef-perm-clear">إلغاء الكل</button>' +
                '</div>' +
              '</div>' +
              '<div id="ef-permissions-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">' +
                groups.map(function (g) {
                  var groupItems = catalog.filter(function (c) { return c.group === g; });
                  var isAgentRole = draftState.role === 'agent';
                  var selectableItems = groupItems.filter(function (item) {
                    return !((item.key === 'sync_data' || item.key === 'manage_api_connection') && isAgentRole);
                  });
                  var checkedInGroup = selectableItems.filter(function (item) { return draftState.permissions.indexOf(item.key) !== -1; }).length;
                  var allGroupChecked = selectableItems.length > 0 && checkedInGroup === selectableItems.length;
                  var isDashGroup = g === 'لوحة التحكم';
                  var dashViewDisabled = isDashGroup && draftState.permissions.indexOf('view_dashboard') === -1;
                  return '<div class="ef-perm-group-card" data-group="' + esc(g) + '" style="padding:10px;border:1px solid var(--border-hairline);border-radius:var(--radius-sm);background:var(--bg-surface-subtle);">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;">' +
                      '<div style="font-size:12px;font-weight:700;color:var(--brand-primary);">' + esc(g) + ' <span class="ef-group-count tabular-nums" data-group="' + esc(g) + '" style="font-weight:600;color:var(--text-muted);font-size:11px;">(' + checkedInGroup + '/' + groupItems.length + ')</span></div>' +
                      '<button type="button" class="btn btn-sm ef-group-toggle-btn" data-group="' + esc(g) + '" style="min-height:24px;padding:2px 8px;font-size:11px;">' + (allGroupChecked ? 'إلغاء الكل' : 'تحديد الكل') + '</button>' +
                    '</div>' +
                    (isDashGroup ? '<div id="ef-dash-view-hint" class="' + (dashViewDisabled ? '' : 'hidden') + '" style="font-size:11px;padding:5px 8px;margin-bottom:8px;border-radius:4px;background:var(--status-warning-bg);color:var(--status-warning-text);border:1px solid var(--status-warning-border);">صلاحية عرض لوحة التحكم معطلة حالياً — فعّلها لتظهر اللوحة للموظف (تُفعل تلقائياً عند تحديد أي قسم).</div>' : '') +
                    '<div style="display:flex;flex-direction:column;gap:6px;">' +
                      groupItems.map(function (item) {
                        var checked = draftState.permissions.indexOf(item.key) !== -1;
                        var isApiPerm = item.key === 'sync_data' || item.key === 'manage_api_connection';
                        var disabledAttr = (isApiPerm && isAgentRole) ? ' disabled' : '';
                        return '<label class="checkbox-item" style="font-size:12.5px;">' +
                          '<input type="checkbox" class="ef-perm-checkbox" data-group="' + esc(g) + '" value="' + esc(item.key) + '"' + (checked && !disabledAttr ? ' checked' : '') + disabledAttr + '> ' +
                          '<span>' + esc(item.label) + '</span>' +
                        '</label>';
                      }).join('') +
                    '</div>' +
                  '</div>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div class="form-group"><label class="form-label" for="ef-pass">' + (isEdit ? 'إعادة تعيين كلمة المرور (اختياري — اتركه فارغًا للإبقاء)' : 'كلمة المرور (6 أحرف على الأقل)') + '</label>' +
              '<input class="input" type="password" id="ef-pass" ' + (isEdit ? '' : 'required minlength="6"') + '></div>' +
            '<div id="emp-form-err" class="form-error hidden"></div>' +
            '<div class="modal-footer"><button type="submit" class="btn btn-primary">' + (isEdit ? 'حفظ التعديلات والصلاحيات' : 'إنشاء الحساب') + '</button></div>' +
          '</form>' +
        '</div>';

      var roleSelect = document.getElementById('ef-role');
      var presetSelect = document.getElementById('ef-preset');
      var jobInput = document.getElementById('ef-job');
      var editPresetBtn = document.getElementById('ef-preset-edit');
      var delPresetBtn = document.getElementById('ef-preset-delete');

      function captureDraft() {
        draftState.name = document.getElementById('ef-name').value;
        draftState.username = document.getElementById('ef-username').value;
        draftState.phone = document.getElementById('ef-phone').value;
        draftState.email = document.getElementById('ef-email').value;
        draftState.jobTitle = jobInput.value;
        draftState.role = roleSelect.value;
        draftState.presetId = presetSelect.value;
        var perms = [];
        modalRoot.querySelectorAll('.ef-perm-checkbox:checked').forEach(function (cb) {
          if (!cb.disabled) perms.push(cb.value);
        });
        draftState.permissions = perms;
      }

      function syncPresetButtonsState() {
        var isCustom = presetSelect.value === 'custom';
        editPresetBtn.disabled = isCustom;
        delPresetBtn.disabled = isCustom;
      }

      function syncApiLockForRole(roleVal) {
        var isAgent = roleVal === 'agent';
        modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
          if (cb.value === 'sync_data' || cb.value === 'manage_api_connection') {
            cb.disabled = isAgent;
            if (isAgent) cb.checked = false;
          }
        });
      }

      var dashKeys = (root.RGCrmCore && root.RGCrmCore.DASHBOARD_PERMISSION_KEYS) || [];

      function refreshGroupBadgesAndDashHint() {
        modalRoot.querySelectorAll('.ef-perm-group-card').forEach(function (card) {
          var gName = card.getAttribute('data-group');
          var cbs = Array.prototype.slice.call(card.querySelectorAll('.ef-perm-checkbox'));
          var enabledCbs = cbs.filter(function (c) { return !c.disabled; });
          var checkedCnt = enabledCbs.filter(function (c) { return c.checked; }).length;
          var countEl = card.querySelector('.ef-group-count');
          if (countEl) countEl.textContent = '(' + checkedCnt + '/' + cbs.length + ')';
          var togBtn = card.querySelector('.ef-group-toggle-btn');
          if (togBtn) {
            togBtn.textContent = (enabledCbs.length > 0 && checkedCnt === enabledCbs.length) ? 'إلغاء الكل' : 'تحديد الكل';
          }
        });
        var viewDashCb = modalRoot.querySelector('.ef-perm-checkbox[value="view_dashboard"]');
        var dashHint = document.getElementById('ef-dash-view-hint');
        if (dashHint) {
          dashHint.classList.toggle('hidden', Boolean(viewDashCb && viewDashCb.checked));
        }
      }

      function applyPermissionsList(perms, roleVal) {
        syncApiLockForRole(roleVal);
        modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
          if (cb.disabled) {
            cb.checked = false;
          } else {
            cb.checked = perms.indexOf(cb.value) !== -1;
          }
        });
        refreshGroupBadgesAndDashHint();
      }

      function applyPresetById(presetId) {
        var found = presets.find(function (p) { return p.id === presetId; });
        if (!found) return;
        draftState.presetId = found.id;
        presetSelect.value = found.id;
        jobInput.value = found.jobTitle;
        roleSelect.value = found.role;
        applyPermissionsList(found.permissions, found.role);
        modalRoot.querySelectorAll('.ef-preset-chip').forEach(function (ch) {
          ch.classList.toggle('btn-primary', ch.getAttribute('data-preset-id') === found.id);
        });
        syncPresetButtonsState();
      }

      presetSelect.addEventListener('change', function () {
        if (presetSelect.value !== 'custom') {
          applyPresetById(presetSelect.value);
        } else {
          draftState.presetId = 'custom';
          modalRoot.querySelectorAll('.ef-preset-chip').forEach(function (ch) { ch.classList.remove('btn-primary'); });
          syncPresetButtonsState();
        }
      });

      modalRoot.querySelectorAll('.ef-preset-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          applyPresetById(chip.getAttribute('data-preset-id'));
        });
      });

      document.getElementById('ef-preset-add').addEventListener('click', function () {
        captureDraft();
        openRolePresetModal({
          id: '',
          label: '',
          jobTitle: draftState.jobTitle,
          role: draftState.role,
          permissions: draftState.permissions,
          _fromEmployeeModal: true
        }, customPermissions, ctx, function (resPreset) {
          if (resPreset && resPreset.customPermissions) customPermissions = resPreset.customPermissions;
          if (resPreset && resPreset.rolePresets) {
            presets = root.RGCrmCore.normalizeRolePresets(resPreset.rolePresets);
            if (resPreset.savedPreset) {
              draftState.presetId = resPreset.savedPreset.id;
              draftState.jobTitle = resPreset.savedPreset.jobTitle;
              draftState.role = resPreset.savedPreset.role;
              draftState.permissions = resPreset.savedPreset.permissions.slice();
            }
          }
          drawModal();
          if (onSaved && resPreset && !resPreset.cancelled) {
            // refresh underlying page smoothly on close, preserve current modal open
          }
        });
      });

      editPresetBtn.addEventListener('click', function () {
        captureDraft();
        var found = presets.find(function (p) { return p.id === presetSelect.value; });
        if (!found) return;
        openRolePresetModal(Object.assign({}, found, { _fromEmployeeModal: true }), customPermissions, ctx, function (resPreset) {
          if (resPreset && resPreset.customPermissions) customPermissions = resPreset.customPermissions;
          if (resPreset && resPreset.rolePresets) {
            presets = root.RGCrmCore.normalizeRolePresets(resPreset.rolePresets);
            if (resPreset.savedPreset) {
              draftState.presetId = resPreset.savedPreset.id;
              draftState.jobTitle = resPreset.savedPreset.jobTitle;
              draftState.role = resPreset.savedPreset.role;
              draftState.permissions = resPreset.savedPreset.permissions.slice();
            }
          }
          drawModal();
        });
      });

      delPresetBtn.addEventListener('click', function () {
        if (presetSelect.value === 'custom') return;
        if (delPresetBtn.getAttribute('data-confirm') !== '1') {
          delPresetBtn.setAttribute('data-confirm', '1');
          delPresetBtn.textContent = 'تأكيد الحذف؟';
          setTimeout(function () {
            if (document.body.contains(delPresetBtn)) {
              delPresetBtn.setAttribute('data-confirm', '0');
              delPresetBtn.textContent = 'حذف المحدد';
            }
          }, 3500);
          return;
        }
        var targetPId = presetSelect.value;
        runWithLock(delPresetBtn, 'deleteRolePreset:' + targetPId, async function () {
          captureDraft();
          var resp = await root.RGApi.callApi('deleteRolePreset', { presetId: targetPId });
          if (!resp.success) {
            ctx.toast(resp.message, true);
            return;
          }
          presets = root.RGCrmCore.normalizeRolePresets(resp.data.rolePresets);
          draftState.presetId = 'custom';
          ctx.toast(resp.message || 'تم حذف الصلاحية الجاهزة.');
          drawModal();
        });
      });

      document.getElementById('ef-manage-perms-btn').addEventListener('click', function () {
        captureDraft();
        openPermissionsCatalogModal(customPermissions, ctx, function (resCat) {
          if (resCat && resCat.customPermissions) customPermissions = resCat.customPermissions;
          drawModal();
        });
      });

      roleSelect.addEventListener('change', function () {
        var r = roleSelect.value;
        presetSelect.value = 'custom';
        draftState.presetId = 'custom';
        syncPresetButtonsState();
        applyPermissionsList(root.RGCrmCore.resolveEffectivePermissions(r), r);
      });

      document.getElementById('ef-perm-defaults').addEventListener('click', function () {
        var r = roleSelect.value;
        presetSelect.value = 'custom';
        draftState.presetId = 'custom';
        syncPresetButtonsState();
        applyPermissionsList(root.RGCrmCore.resolveEffectivePermissions(r), r);
      });

      document.getElementById('ef-perm-all').addEventListener('click', function () {
        presetSelect.value = 'custom';
        draftState.presetId = 'custom';
        syncPresetButtonsState();
        var r = roleSelect.value;
        syncApiLockForRole(r);
        modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
          if (!cb.disabled) cb.checked = true;
        });
        refreshGroupBadgesAndDashHint();
      });

      var clearPermsBtn = document.getElementById('ef-perm-clear');
      if (clearPermsBtn) {
        clearPermsBtn.addEventListener('click', function () {
          presetSelect.value = 'custom';
          draftState.presetId = 'custom';
          syncPresetButtonsState();
          modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
            if (!cb.disabled) cb.checked = false;
          });
          refreshGroupBadgesAndDashHint();
        });
      }

      modalRoot.querySelectorAll('.ef-group-toggle-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var gName = btn.getAttribute('data-group');
          var card = modalRoot.querySelector('.ef-perm-group-card[data-group="' + gName + '"]');
          if (!card) return;
          presetSelect.value = 'custom';
          draftState.presetId = 'custom';
          syncPresetButtonsState();
          var enabledCbs = Array.prototype.slice.call(card.querySelectorAll('.ef-perm-checkbox')).filter(function (c) { return !c.disabled; });
          var allChecked = enabledCbs.length > 0 && enabledCbs.every(function (c) { return c.checked; });
          enabledCbs.forEach(function (c) { c.checked = !allChecked; });
          if (!allChecked && gName === 'لوحة التحكم') {
            var vd = modalRoot.querySelector('.ef-perm-checkbox[value="view_dashboard"]');
            if (vd && !vd.disabled) vd.checked = true;
          }
          refreshGroupBadgesAndDashHint();
        });
      });

      modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
          presetSelect.value = 'custom';
          draftState.presetId = 'custom';
          syncPresetButtonsState();
          if (cb.checked && dashKeys.indexOf(cb.value) !== -1) {
            var vd = modalRoot.querySelector('.ef-perm-checkbox[value="view_dashboard"]');
            if (vd && !vd.disabled && !vd.checked) vd.checked = true;
          }
          refreshGroupBadgesAndDashHint();
        });
      });

      document.getElementById('emp-cancel').addEventListener('click', function () {
        modalRoot.innerHTML = '';
        if (onSaved) onSaved();
      });

      var empForm = document.getElementById('emp-form');
      empForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var errEl = document.getElementById('emp-form-err');
        errEl.classList.add('hidden');
        var submitBtn = empForm.querySelector('button[type="submit"]');

        var selectedPerms = [];
        modalRoot.querySelectorAll('.ef-perm-checkbox:checked').forEach(function (cb) {
          if (!cb.disabled) selectedPerms.push(cb.value);
        });
        if (selectedPerms.indexOf('dash_perms_configured') === -1) {
          selectedPerms.push('dash_perms_configured');
        }

        var payload = {
          name: document.getElementById('ef-name').value,
          username: document.getElementById('ef-username').value,
          phone: document.getElementById('ef-phone').value,
          email: document.getElementById('ef-email').value,
          jobTitle: document.getElementById('ef-job').value,
          role: document.getElementById('ef-role').value,
          permissions: selectedPerms
        };
        var pwd = document.getElementById('ef-pass').value;
        if (isEdit) {
          payload.employeeId = existing.id;
          if (pwd) payload.newPassword = pwd;
        } else {
          payload.password = pwd;
        }

        runWithLock(submitBtn, isEdit ? ('updateEmployee:' + existing.id) : ('createEmployee:' + payload.username), async function () {
          var res = await root.RGApi.callApi(isEdit ? 'updateEmployee' : 'createEmployee', payload);
          if (!res.success) {
            errEl.textContent = res.message;
            errEl.classList.remove('hidden');
            return;
          }
          if (res.data && ctx && ctx.appState && typeof ctx.appState.upsertEmployeeInState === 'function') {
            ctx.appState.upsertEmployeeInState(res.data);
          }
          ctx.toast(isEdit ? 'تم تحديث بيانات وصلاحيات الموظف.' : 'تم إنشاء حساب الموظف بالصلاحيات المحددة بنجاح.');
          modalRoot.innerHTML = '';
          if (onSaved) onSaved();
        });
      });
    }

    drawModal();
  }

  root.EmployeeManager = EmployeeManager;
  root.RGEmployees = {
    render: render,
    EmployeeManager: EmployeeManager,
    openEmployeeDetailsDrawer: openEmployeeDetailsDrawer
  };
})(window);
