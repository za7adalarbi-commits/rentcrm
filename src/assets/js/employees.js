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

  function runWithLock(btnEl, lockKey, fn, opts) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn, opts);
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
    }
    this._onDeltaSync = function (ev) {
      if (!self.container || self.container.isConnected === false) {
        self.destroy();
        return;
      }
      var d = (ev && ev.detail) || {};
      if (!(d.changedRoles || d.changedDelegations || d.changedSettings)) return;
      var modalRoot = document.getElementById('modal-root');
      if (modalRoot && modalRoot.firstElementChild) return;
      var activeEl = document.activeElement;
      if (activeEl && self.container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) return;
      render(self.container, self.ctx).catch(function () {});
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('rg:deltasync', this._onDeltaSync);
    }
    activeEmployeeManagerUnsubscribe = function () { self.destroy(); };
    return this;
  };

  EmployeeManager.prototype.destroy = function () {
    if (typeof this.unsubscribe === 'function') {
      try { this.unsubscribe(); } catch (e) {}
      this.unsubscribe = null;
    }
    if (this._onDeltaSync && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('rg:deltasync', this._onDeltaSync);
      this._onDeltaSync = null;
    }
  };

  EmployeeManager.prototype.renderFromState = function () {
    var self = this;
    var container = this.container;
    if (!container) return;

    var ctx = this.ctx;
    var t = ctx.t || function (k) { return k; };
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var realOrCurUser = (root.RGAuth && typeof root.RGAuth.getRealUser === 'function' ? root.RGAuth.getRealUser() : null) || user;
    var canManage = Boolean(user && root.RGCrmCore && root.RGCrmCore.canUserPerform(user, 'manage_employees'));
    var canReassign = Boolean(user && root.RGCrmCore && root.RGCrmCore.canUserPerform(user, 'assign_employees'));
    var isActorDeveloper = Boolean(user && root.RGCrmCore && root.RGCrmCore.ROLES && user.role === root.RGCrmCore.ROLES.DEVELOPER);
    var canCustomizeUi = Boolean(
      isActorDeveloper ||
      (user && user.role === 'general_manager') ||
      (root.RGCrmCore && root.RGCrmCore.canUserPerform && root.RGCrmCore.canUserPerform(user, 'customize_ui'))
    );
    var canActorImpersonate = Boolean(root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realOrCurUser));
    var allowedPreviewRoles = (canActorImpersonate && root.RGCrmCore.getAllowedPreviewRoles)
      ? root.RGCrmCore.getAllowedPreviewRoles(realOrCurUser)
      : [];

    var empState = (this.appStore && typeof this.appStore.getEmployeesState === 'function')
      ? this.appStore.getEmployeesState()
      : (this.opts.initialState || { items: [], rolePresets: [], customPermissions: [] });
    var delegations = Array.isArray(this.opts.delegations) ? this.opts.delegations : [];

    var items = Array.isArray(empState.items) ? empState.items : [];
    var rolePresets = root.RGCrmCore.normalizeRolePresets(empState.rolePresets || []);
    var customPermissions = Array.isArray(empState.customPermissions) ? empState.customPermissions : [];
    var catalog = root.RGCrmCore.mergePermissionsCatalog(customPermissions);
    var catalogMap = {};
    catalog.forEach(function (c) { catalogMap[c.key] = c; });

    var canViewPresetsSub = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(user, 'sub_view_emp_presets');
    var canViewDelegationsSub = !root.RGCrmCore || !root.RGCrmCore.canUserViewSubSection || root.RGCrmCore.canUserViewSubSection(user, 'sub_view_emp_delegations');
    var roleLabels = root.RGCrmCore.ROLE_LABELS[ctx.lang] || root.RGCrmCore.ROLE_LABELS.ar;

    var presetsSectionHtml = (canManage && canViewPresetsSub) ? (
      '<section class="surface-card rg-ui-role-presets" id="role-presets-section">' +
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
            var roleTagClass = (pr.role === 'general_manager' || pr.role === 'developer')
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
      ? '<div class="rg-error-banner" role="alert"><div class="rg-error-banner-body"><div class="rg-error-banner-title">تعذر تحديث قائمة الموظفين</div><div class="rg-error-banner-msg">' + esc(empState.error) + '</div></div><button type="button" class="btn btn-sm btn-primary" id="emp-state-retry-btn">إعادة المحاولة</button></div>'
      : '';

    var activeDelegationByEmp = {};
    delegations.forEach(function (del) {
      if (del && root.RGCrmCore && root.RGCrmCore.isDelegationActive && root.RGCrmCore.isDelegationActive(del)) {
        activeDelegationByEmp[del.delegateEmployeeId] = del;
      }
    });

    var delegationsSectionHtml = (canManage && canViewDelegationsSub) ? (
      '<section class="surface-card rg-ui-emp-delegations" id="delegations-section">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">تفويض الصلاحيات المؤقت (Temporary Delegation)</h2>' +
            '<p class="section-subtitle">منح صلاحية المشرف لموظف بديل لفترة زمنية محددة (إجازة/مناوبة) وتُلغى تلقائياً فور انتهاء الموعد.</p>' +
          '</div>' +
          '<div class="toolbar-actions">' +
            '<button type="button" class="btn btn-primary" id="del-add-btn">+ منح تفويض صلاحية مؤقت</button>' +
          '</div>' +
        '</div>' +
        (delegations.length === 0
          ? '<div class="empty-state" style="padding:18px;">لا توجد تفويضات مؤقتة مسجلة حالياً.</div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>الموظف المفوَّض</th><th>الصلاحية المؤقتة</th><th>السبب</th><th>من</th><th>إلى</th><th>الحالة</th><th>الإجراء</th>' +
            '</tr></thead><tbody>' +
              delegations.map(function (del) {
                var isDelActive = Boolean(root.RGCrmCore && root.RGCrmCore.isDelegationActive && root.RGCrmCore.isDelegationActive(del));
                var isRevoked = String(del.status || '').toLowerCase() === 'revoked' || Boolean(del.revokedAt);
                var statusCls = isDelActive ? 'status-success' : (isRevoked ? 'status-danger' : 'status-neutral');
                var statusTxt = isDelActive ? 'نشط الآن' : (isRevoked ? 'ملغى' : 'منتهي');
                var fmtDt = function (iso) {
                  if (!iso) return '-';
                  if (ctx && ctx.formatDateTime) return ctx.formatDateTime(iso);
                  if (root.RGApp && root.RGApp.formatDateTime) return root.RGApp.formatDateTime(iso);
                  return String(iso).replace('T', ' ').substring(0, 16);
                };
                return '<tr data-del-id="' + esc(del.id) + '">' +
                  '<td><strong>' + esc(del.delegateEmployeeName || del.delegateEmployeeId) + '</strong></td>' +
                  '<td><span class="status-tag status-warning">' + esc(roleLabels[del.delegatedRole] || 'المشرف') + '</span></td>' +
                  '<td>' + esc(del.reason || '-') + '</td>' +
                  '<td class="mono tabular-nums" dir="ltr">' + esc(fmtDt(del.startsAt)) + '</td>' +
                  '<td class="mono tabular-nums" dir="ltr">' + esc(fmtDt(del.expiresAt)) + '</td>' +
                  '<td><span class="status-tag ' + statusCls + '">' + statusTxt + '</span></td>' +
                  '<td>' +
                    (isDelActive
                      ? '<button type="button" class="btn btn-sm btn-danger del-revoke-btn" data-id="' + esc(del.id) + '">إلغاء التفويض</button>'
                      : '<span style="color:var(--text-muted);font-size:12px;">—</span>') +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>') +
      '</section>'
    ) : '';

    var rowsHtml = (empState.loading && items.length === 0)
      ? '<tr><td colspan="' + (canManage ? 11 : 10) + '"><div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div></td></tr>'
      : (items.length === 0
        ? '<tr><td colspan="' + (canManage ? 11 : 10) + '" class="px-4 py-8 text-center text-sm" style="color:var(--text-muted);">لا يوجد موظفون مسجلون حاليًا.</td></tr>'
        : items.map(function (e) {
          var isActive = e.status === 'active';
          var isSelf = Boolean(user && e.id === user.id);
          var isTargetDev = e.role === 'developer';
          var canUseDeleteEmpAction = !root.RGCrmCore || !root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(user, 'act_delete_employee');
          var canMutateTarget = canManage && !isSelf && (!isTargetDev || isActorDeveloper);
          var canEditTarget = canManage && (canMutateTarget || (isSelf && isTargetDev && isActorDeveloper));
          var canCustomizeTargetSections = Boolean(canCustomizeUi && (!isTargetDev || isActorDeveloper));
          var canImpersonateRow = Boolean(
            canActorImpersonate &&
            !isSelf &&
            allowedPreviewRoles.indexOf(e.role) !== -1 &&
            root.RGApp && typeof root.RGApp.startPreviewSession === 'function'
          );
          var permsList = root.RGCrmCore.resolveEffectivePermissions(e);
          var secSummary = (root.RGCrmCore && typeof root.RGCrmCore.getEmployeeSectionVisibilitySummary === 'function')
            ? root.RGCrmCore.getEmployeeSectionVisibilitySummary(e)
            : { visibleMainCount: 9, totalMainCount: 9 };
          var initialChar = String(e.name || 'م').trim().charAt(0) || 'م';
          var resCnt = e.reservationsCount !== undefined ? e.reservationsCount : ((e.stats && e.stats.assignedCount) || 0);
          var fuCnt = e.followUpsCount !== undefined ? e.followUpsCount : ((e.stats && e.stats.followUpsCount) || 0);
          var prbCnt = e.problemsCount !== undefined ? e.problemsCount : ((e.stats && e.stats.openProblemsCount) || 0);
          var lastActText = e.lastActivity
            ? esc((ctx && ctx.formatDateTime ? ctx.formatDateTime(e.lastActivity) : (root.RGApp && root.RGApp.formatDateTime ? root.RGApp.formatDateTime(e.lastActivity) : (root.RGCrmCore && root.RGCrmCore.formatDisplayDateTime ? root.RGCrmCore.formatDisplayDateTime(e.lastActivity) : String(e.lastActivity).replace('T', ' ').substring(0, 16)))))
            : '-';
          var activeDel = activeDelegationByEmp[e.id] || null;

          return '<tr data-emp-row="' + esc(e.id) + '">' +
            '<td>' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<span class="inline-flex items-center justify-center w-7 h-7 rounded-lg font-bold text-xs shrink-0" style="background:var(--brand-soft);color:var(--brand-primary);border:1px solid rgba(217,31,43,0.26);">' + esc(initialChar) + '</span>' +
                '<button type="button" class="btn-link-inline emp-view-btn" data-id="' + esc(e.id) + '">' + esc(e.name) + '</button>' +
                (isSelf ? '<span class="status-tag status-neutral">أنت</span>' : '') +
                (isTargetDev ? '<span class="status-tag status-danger">المبرمج</span>' : '') +
                (activeDel ? '<span class="rg-delegation-pill">تفويض مشرف مؤقت</span>' : '') +
                ((canMutateTarget && canUseDeleteEmpAction) ? (
                  '<button type="button" class="btn btn-sm btn-danger emp-del-btn" data-id="' + esc(e.id) + '" data-name="' + esc(e.name) + '" data-confirm="0" aria-label="حذف الموظف ' + esc(e.name) + '">حذف</button>'
                ) : '') +
              '</div>' +
              (e.phone ? '<div class="text-[11px] mt-1 font-mono cell-phone" style="color:var(--text-muted);" dir="ltr">' + esc(e.phone) + '</div>' : '') +
            '</td>' +
            '<td class="mono text-xs" style="color:var(--text-secondary);" dir="ltr">' + esc(e.username) + '</td>' +
            '<td class="text-xs" style="color:var(--text-primary);">' + esc(e.jobTitle) + '</td>' +
            '<td>' +
              '<div class="text-xs font-semibold" style="color:var(--text-primary);">' + esc(roleLabels[e.role] || e.role) + '</div>' +
              '<div class="text-[11px] tabular-nums" style="color:var(--text-muted);">' + permsList.length + ' صلاحية · ' + secSummary.visibleMainCount + '/' + secSummary.totalMainCount + ' قسم</div>' +
            '</td>' +
            '<td>' +
              '<div class="flex items-center gap-1.5 flex-wrap">' +
                '<span class="status-tag emp-status-tag ' + (isActive ? 'status-success' : 'status-danger') + '">' +
                  (isActive ? 'نشط' : 'متوقف عن النشاط') +
                '</span>' +
                ((canMutateTarget && canUseDeleteEmpAction) ? (
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
            '<td>' +
              '<div class="flex items-center gap-1.5">' +
                '<button type="button" class="btn btn-sm btn-primary emp-view-btn" data-id="' + esc(e.id) + '">العملاء</button>' +
                ((!canManage && canImpersonateRow) ? '<button type="button" class="btn btn-sm emp-impersonate-btn" data-id="' + esc(e.id) + '" title="معاينة النظام بصلاحيات هذا الموظف">محاكاة</button>' : '') +
              '</div>' +
            '</td>' +
            ((canManage || canCustomizeUi) ? (
              '<td class="whitespace-nowrap">' +
                '<div class="flex items-center gap-1.5">' +
                  (canEditTarget ? '<button type="button" class="btn btn-sm ' + (isTargetDev ? 'btn-primary emp-edit-dev-btn rg-ui-edit-dev-btn ' : '') + 'emp-edit-btn" data-id="' + esc(e.id) + '" aria-label="تعديل بيانات ' + esc(e.name) + '">' + (isTargetDev ? 'تعديل بيانات المبرمج' : 'تعديل') + '</button>' : '') +
                  (canCustomizeTargetSections ? '<button type="button" class="btn btn-sm emp-sections-btn" data-id="' + esc(e.id) + '" title="إظهار أو إخفاء الأقسام وعناصر الواجهة لهذا الموظف">الأقسام</button>' : '') +
                  (canImpersonateRow ? '<button type="button" class="btn btn-sm emp-impersonate-btn" data-id="' + esc(e.id) + '" title="معاينة النظام بصلاحيات هذا الموظف">محاكاة</button>' : '') +
                  ((!canEditTarget && !canImpersonateRow && !canCustomizeTargetSections) ? '<span class="text-xs" style="color:var(--text-muted);">—</span>' : '') +
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
            ((canManage || canReassign || canCustomizeUi) ? (
              '<div class="toolbar-actions">' +
                ((canReassign && (!root.RGCrmCore || !root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(user, 'act_bulk_reassign'))) ? '<button type="button" class="btn rg-ui-emp-transfer" id="emp-bulk-reassign-btn">🔄 تحويل حجوزات نهاية الوردية</button>' : '') +
                ((canManage && canViewPresetsSub) ? '<button type="button" class="btn rg-ui-role-presets" id="emp-scroll-presets-btn">الصلاحيات الجاهزة (' + rolePresets.length + ')</button>' : '') +
                (canCustomizeUi ? '<button type="button" class="btn" id="emp-dev-sections-btn">' + (isActorDeveloper ? 'إظهار / إخفاء الأقسام لكل موظف' : 'إظهار / إخفاء الأقسام والواجهة للموظفين') + '</button>' : '') +
                (canCustomizeUi ? '<button type="button" class="btn" id="emp-dev-actions-btn">أزرار وإجراءات الجداول</button>' : '') +
                ((isActorDeveloper && canManage) ? '<button type="button" class="btn" id="emp-dev-stats-btn">تحكم المبرمج في الإحصائيات</button>' : '') +
                ((isActorDeveloper && canManage) ? '<button type="button" class="btn btn-charcoal rg-ui-edit-dev-btn" id="emp-edit-dev-btn">تعديل بيانات المبرمج</button>' : '') +
                (canManage ? '<button type="button" class="btn btn-primary rg-ui-emp-add" id="emp-add-btn">إضافة موظف جديد</button>' : '') +
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
        delegationsSectionHtml +
        presetsSectionHtml +
      '</div>';

    function reloadEmployeesFromServer(savedObj) {
      if (savedObj && savedObj.id && self.appStore) {
        return Promise.resolve(savedObj);
      }
      if (self.appStore && typeof self.appStore.loadEmployeesState === 'function' && !canManage) {
        return self.appStore.loadEmployeesState({});
      }
      return render(container, ctx);
    }

    var stateRetryBtn = document.getElementById('emp-state-retry-btn');
    if (stateRetryBtn) {
      stateRetryBtn.addEventListener('click', function () {
        reloadEmployeesFromServer();
      });
    }

    var bulkReassignBtn = document.getElementById('emp-bulk-reassign-btn');
    if (bulkReassignBtn) {
      bulkReassignBtn.addEventListener('click', function () {
        openBulkReassignModal(items, ctx, function () {
          reloadEmployeesFromServer();
        });
      });
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

    var editDevHeaderBtn = document.getElementById('emp-edit-dev-btn');
    if (editDevHeaderBtn) {
      editDevHeaderBtn.addEventListener('click', function () {
        openEditDeveloperModal(ctx, reloadEmployeesFromServer);
      });
    }

    var devSectionsHeaderBtn = document.getElementById('emp-dev-sections-btn');
    if (devSectionsHeaderBtn) {
      devSectionsHeaderBtn.addEventListener('click', function () {
        var defaultEmp = items.find(function (x) { return x && x.role !== 'developer'; }) || items[0] || null;
        openEmployeeSectionsModal(defaultEmp, items, ctx, reloadEmployeesFromServer);
      });
    }

    var devActionsHeaderBtn = document.getElementById('emp-dev-actions-btn');
    if (devActionsHeaderBtn) {
      devActionsHeaderBtn.addEventListener('click', function () {
        var defaultEmp = items.find(function (x) { return x && x.role !== 'developer'; }) || items[0] || null;
        openEmployeeSectionsModal(defaultEmp, items, ctx, reloadEmployeesFromServer, { focusGroup: 'table_actions' });
      });
    }

    var devStatsHeaderBtn = document.getElementById('emp-dev-stats-btn');
    if (devStatsHeaderBtn) {
      devStatsHeaderBtn.addEventListener('click', function () {
        openDeveloperStatsControlModal(ctx, reloadEmployeesFromServer);
      });
    }

    container.querySelectorAll('.emp-sections-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var emp = items.find(function (x) { return x.id === btn.getAttribute('data-id'); });
        if (emp) {
          openEmployeeSectionsModal(emp, items, ctx, reloadEmployeesFromServer);
        }
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

    container.querySelectorAll('.emp-impersonate-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var empId = btn.getAttribute('data-id');
        if (empId && root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
          root.RGApp.startPreviewSession({ employeeId: empId });
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
            : await root.RGApi.callApi('disableEmployee', { employeeId: empId, status: nextStatus, _spamChecked: true });
          if (!resToggle || !resToggle.success) {
            ctx.toast((resToggle && resToggle.message) || 'تعذر تحديث حالة الموظف.', true);
          }
        }, { spamAction: 'disableEmployee', spamSig: 'disableEmployee:' + empId + ':' + nextStatus });
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
            : await root.RGApi.callApi('deleteEmployee', { employeeId: empId, _spamChecked: true });
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
        }, { spamAction: 'deleteEmployee', spamSig: 'deleteEmployee:' + empId });
      });
    });

    if (canManage) {
      var delAddBtn = document.getElementById('del-add-btn');
      if (delAddBtn) {
        delAddBtn.addEventListener('click', function () {
          openGrantDelegationModal(items, ctx, function () {
            render(container, ctx);
          });
        });
      }

      container.querySelectorAll('.del-revoke-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var did = btn.getAttribute('data-id');
          runWithLock(btn, 'revokeDelegation:' + did, async function () {
            var rowEl = btn.closest('tr');
            if (rowEl) {
              var tagEl = rowEl.querySelector('.status-tag');
              if (tagEl) {
                tagEl.className = 'status-tag status-neutral';
                tagEl.textContent = 'ملغى';
              }
              btn.replaceWith((function () {
                var sp = document.createElement('span');
                sp.style.cssText = 'color:var(--text-muted);font-size:12px;';
                sp.textContent = '—';
                return sp;
              })());
            }
            if (root.RGApi && root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('revokeDelegation', { id: did }, user);
            }
            ctx.toast('تم إلغاء التفويض المؤقت.');
            var revResp = await root.RGApi.callApi('revokeDelegation', { id: did, _keepOptimisticCache: true, _spamChecked: true });
            if (!revResp || !revResp.success) {
              ctx.toast((revResp && revResp.message) || 'تعذر إلغاء التفويض.', true);
              await render(container, ctx);
            }
          }, { spamAction: 'revokeDelegation', spamSig: 'revokeDelegation:' + did });
        });
      });

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

    if (root.RGApp && typeof root.RGApp.animateProgressiveReveal === 'function') {
      root.RGApp.animateProgressiveReveal(container);
    }
  };

  async function render(container, ctx) {
    var appStore = (ctx && ctx.appState) || root.RGApp || null;
    var user = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var canManage = Boolean(user && root.RGCrmCore && root.RGCrmCore.canUserPerform(user, 'manage_employees'));
    var [res, delRes] = await Promise.all([
      root.RGApi.callApi('getEmployees', { abortKey: 'emp:list' }),
      canManage ? root.RGApi.callApi('getDelegations', { abortKey: 'emp:del' }).catch(function () { return { success: false }; }) : Promise.resolve({ success: true, data: { items: [] } })
    ]);
    if (res && res.aborted) return;
    if (!res || !res.success) {
      container.innerHTML =
        '<div class="surface-card">' +
          '<div class="section-header"><div><h2 class="section-title">' + ctx.t('nav_employees') + '</h2></div></div>' +
          '<div class="rg-error-banner" role="alert">' +
            '<div class="rg-error-banner-body">' +
              '<div class="rg-error-banner-title">تعذر تحميل الموظفين</div>' +
              '<div class="rg-error-banner-msg">' + esc((res && res.message) || 'تعذر تحميل قائمة الموظفين.') + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" id="emp-retry-btn">إعادة المحاولة</button>' +
          '</div>' +
        '</div>';
      var empRetry = document.getElementById('emp-retry-btn');
      if (empRetry) empRetry.addEventListener('click', function () { render(container, ctx); });
      return;
    }

    if (appStore && typeof appStore.syncEmployeesStateFromPayload === 'function') {
      appStore.syncEmployeesStateFromPayload(res.data || {});
    }

    var delegations = (delRes && delRes.success && delRes.data && Array.isArray(delRes.data.items))
      ? delRes.data.items
      : [];

    var manager = new EmployeeManager({
      container: container,
      ctx: ctx,
      appState: appStore,
      initialState: res.data || {},
      delegations: delegations
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

    var curActor = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var realPresetActor = (root.RGApp && root.RGApp.getPreviewState) ? root.RGApp.getPreviewState().realUser : curActor;
    var isActorDevPreset = Boolean(curActor && curActor.role === 'developer');
    var canPreviewPreset = Boolean(realPresetActor && root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realPresetActor));
    var allowedPreviewRolesPreset = (root.RGCrmCore && root.RGCrmCore.getAllowedPreviewRoles)
      ? root.RGCrmCore.getAllowedPreviewRoles(realPresetActor)
      : [];

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
              ((isActorDevPreset || initialRole === 'developer') ? '<option value="developer"' + (initialRole === 'developer' ? ' selected' : '') + '>المبرمج (صلاحيات النظام الكاملة)</option>' : '') +
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
          '<div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
            (canPreviewPreset
              ? '<button type="button" class="btn rg-preview-inline-btn" id="pr-preview-role-btn">👁️ معاينة النظام بهذا الدور</button>'
              : '<span></span>') +
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

    var prPreviewBtn = document.getElementById('pr-preview-role-btn');
    function syncPresetPreviewBtn() {
      if (!prPreviewBtn) return;
      var allowed = allowedPreviewRolesPreset.indexOf(roleSelect.value) !== -1;
      prPreviewBtn.disabled = !allowed;
      prPreviewBtn.title = allowed ? 'معاينة النظام مباشرة بصلاحيات هذا القالب' : 'لا يمكنك محاكاة هذا الدور';
    }
    syncPresetPreviewBtn();

    roleSelect.addEventListener('change', function () {
      syncPresetPreviewBtn();
      renderGrid();
    });

    if (prPreviewBtn) {
      prPreviewBtn.addEventListener('click', function () {
        var perms = Object.keys(selectedSet).filter(function (k) { return selectedSet[k]; });
        if (perms.indexOf('dash_perms_configured') === -1) perms.push('dash_perms_configured');
        if (perms.indexOf('perms_sections_configured') === -1) perms.push('perms_sections_configured');
        if (perms.indexOf('perms_actions_configured') === -1) perms.push('perms_actions_configured');
        var lblVal = (document.getElementById('pr-label') || {}).value || (document.getElementById('pr-job') || {}).value || '';
        if (root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
          root.RGApp.startPreviewSession({
            role: roleSelect.value,
            customPermissions: perms,
            customLabel: String(lblVal).trim()
          });
        }
      });
    }

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

    function snapshotPresetForm() {
      var lEl = document.getElementById('pr-label');
      var jEl = document.getElementById('pr-job');
      return JSON.stringify({
        label: lEl ? String(lEl.value || '').trim() : '',
        jobTitle: jEl ? String(jEl.value || '').trim() : '',
        role: roleSelect ? roleSelect.value : 'agent',
        perms: Object.keys(selectedSet).filter(function (k) { return selectedSet[k]; }).sort()
      });
    }
    var initialPresetSnapshot = snapshotPresetForm();

    function clearPresetGuard() {
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      } else if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
        root.RGApp.setUnsavedGuard(null);
      }
    }

    async function executeSavePreset() {
      var errEl = document.getElementById('pr-form-err');
      if (errEl) errEl.classList.add('hidden');
      var lblInput = document.getElementById('pr-label');
      var lblVal = lblInput ? String(lblInput.value || '').trim() : '';
      if (!lblVal) {
        if (errEl) {
          errEl.textContent = 'اسم الصلاحية الجاهزة (القالب) مطلوب.';
          errEl.classList.remove('hidden');
        }
        if (lblInput) lblInput.focus();
        return false;
      }
      var perms = Object.keys(selectedSet).filter(function (k) { return selectedSet[k]; });
      if (perms.indexOf('dash_perms_configured') === -1) {
        perms.push('dash_perms_configured');
      }
      if (perms.indexOf('perms_sections_configured') === -1) {
        perms.push('perms_sections_configured');
      }
      if (perms.indexOf('perms_actions_configured') === -1) {
        perms.push('perms_actions_configured');
      }
      var resp = await root.RGApi.callApi('saveRolePreset', {
        id: isEdit ? existingPreset.id : '',
        label: lblVal,
        jobTitle: document.getElementById('pr-job').value,
        role: roleSelect.value,
        permissions: perms
      });

      if (!resp.success) {
        if (errEl) {
          errEl.textContent = resp.message;
          errEl.classList.remove('hidden');
        }
        return false;
      }

      clearPresetGuard();
      ctx.toast(resp.message || 'تم حفظ الصلاحية الجاهزة.');
      modalRoot.innerHTML = '';
      if (onSaved) {
        onSaved({
          rolePresets: resp.data.rolePresets,
          savedPreset: resp.data.savedPreset,
          customPermissions: liveCustomPerms
        });
      }
      return true;
    }

    function cancelPresetModal() {
      clearPresetGuard();
      if (onSaved && existingPreset && existingPreset._fromEmployeeModal) {
        onSaved({ cancelled: true, customPermissions: liveCustomPerms });
      } else {
        modalRoot.innerHTML = '';
      }
    }

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: isEdit ? ('تعديل الصلاحية الجاهزة: ' + existingPreset.label) : 'إضافة صلاحية جاهزة جديدة',
        isDirty: function () {
          var f = document.getElementById('preset-form');
          if (!f) return false;
          var qLbl = document.getElementById('pr-quick-perm-label');
          if (qLbl && String(qLbl.value || '').trim().length > 0) return true;
          return snapshotPresetForm() !== initialPresetSnapshot;
        },
        onSave: function () {
          return executeSavePreset();
        },
        onDiscard: function () {
          cancelPresetModal();
        }
      });
    }

    document.getElementById('preset-modal-cancel').addEventListener('click', function () {
      if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
        root.RGApp.requestCloseWithGuard(cancelPresetModal);
      } else {
        cancelPresetModal();
      }
    });

    document.getElementById('preset-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var saveBtn = document.getElementById('pr-save-btn');
      runWithLock(saveBtn, 'saveRolePreset:' + (isEdit ? existingPreset.id : 'new'), function () {
        return executeSavePreset();
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
    var curUserD = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var realActorD = (root.RGAuth && typeof root.RGAuth.getRealUser === 'function' ? root.RGAuth.getRealUser() : null) || curUserD;
    var canPreviewTargetD = Boolean(
      emp && curUserD && emp.id !== curUserD.id &&
      root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realActorD) &&
      root.RGCrmCore.getAllowedPreviewRoles(realActorD).indexOf(emp.role) !== -1 &&
      root.RGApp && typeof root.RGApp.startPreviewSession === 'function'
    );

    modalRoot.innerHTML =
      '<div class="drawer-backdrop" id="emp-drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="emp-drawer-title">' +
        '<div class="drawer-panel">' +
          '<div class="modal-header">' +
            '<div><h3 class="modal-title" id="emp-drawer-title">' + esc(emp.name) + '</h3>' +
            '<div class="meta-inline"><span>' + esc(emp.jobTitle) + '</span><span>·</span><span>' + esc(roleLabels[emp.role] || emp.role) + '</span>' +
            (emp.phone ? '<span>·</span><span class="mono cell-phone" dir="ltr">' + esc(emp.phone) + '</span>' : '') + '</div></div>' +
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              (canPreviewTargetD ? '<button type="button" class="btn btn-sm btn-charcoal" id="emp-drawer-impersonate-btn">👁️ معاينة النظام بهذا الحساب</button>' : '') +
              '<button type="button" class="btn btn-sm" id="emp-drawer-close">إغلاق</button>' +
            '</div>' +
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

    function destroyEmpDrawerChart() {
      var el = document.getElementById('emp-drawer-chart');
      if (el && root.Chart && typeof root.Chart.getChart === 'function') {
        var existing = root.Chart.getChart(el);
        if (existing) existing.destroy();
      }
    }

    document.getElementById('emp-drawer-close').addEventListener('click', function () {
      destroyEmpDrawerChart();
      modalRoot.innerHTML = '';
    });
    var impDrawerBtn = document.getElementById('emp-drawer-impersonate-btn');
    if (impDrawerBtn) {
      impDrawerBtn.addEventListener('click', function () {
        destroyEmpDrawerChart();
        modalRoot.innerHTML = '';
        root.RGApp.startPreviewSession({ employeeId: emp.id });
      });
    }

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

    function paintEmpDrawerChart() {
      var chartEl = document.getElementById('emp-drawer-chart');
      if (!chartEl || !chartEl.isConnected || !root.Chart) return;
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

    var empChartEl = document.getElementById('emp-drawer-chart');
    if (empChartEl) {
      if (root.Chart) {
        paintEmpDrawerChart();
      } else if (typeof root.RGEnsureChartLoaded === 'function') {
        root.RGEnsureChartLoaded().then(paintEmpDrawerChart).catch(function () {});
      }
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
    var initialEmpSnapshot = JSON.stringify({
      name: String(draftState.name || '').trim(),
      username: String(draftState.username || '').trim(),
      phone: String(draftState.phone || '').trim(),
      email: String(draftState.email || '').trim(),
      jobTitle: String(draftState.jobTitle || '').trim(),
      role: draftState.role || 'agent',
      presetId: draftState.presetId || 'custom',
      permissions: (draftState.permissions || []).filter(function (k) {
        return k !== 'dash_perms_configured' && k !== 'perms_sections_configured' && k !== 'perms_subsections_configured' && k !== 'perms_actions_configured';
      }).slice().sort()
    });

    function drawModal() {
      catalog = root.RGCrmCore.mergePermissionsCatalog(customPermissions);
      groups = groupCatalogItems(catalog);
      var curEmpActor = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
      var realEmpActor = (root.RGApp && root.RGApp.getPreviewState) ? root.RGApp.getPreviewState().realUser : curEmpActor;
      var isActorDevModal = Boolean(curEmpActor && curEmpActor.role === 'developer');
      var canPreviewEmp = Boolean(realEmpActor && root.RGCrmCore && root.RGCrmCore.canUserImpersonate && root.RGCrmCore.canUserImpersonate(realEmpActor));
      var allowedPreviewRolesEmp = (root.RGCrmCore && root.RGCrmCore.getAllowedPreviewRoles)
        ? root.RGCrmCore.getAllowedPreviewRoles(realEmpActor)
        : [];

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
              '<div class="form-group"><label class="form-label" for="ef-username">اسم المستخدم</label><input class="input mono" id="ef-username" value="' + esc(draftState.username) + '" ' + ((isEdit && !isActorDevModal) ? 'disabled' : 'required') + '></div>' +
              '<div class="form-group"><label class="form-label" for="ef-phone">رقم الهاتف</label><input class="input mono" id="ef-phone" value="' + esc(draftState.phone) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-email">البريد الإلكتروني</label><input class="input mono" type="email" id="ef-email" value="' + esc(draftState.email) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-job">المسمى الوظيفي</label><input class="input" id="ef-job" value="' + esc(draftState.jobTitle) + '"></div>' +
              '<div class="form-group"><label class="form-label" for="ef-role">الدور الأساسي</label><select class="select" id="ef-role"' + ((isEdit && existing && curEmpActor && existing.id === curEmpActor.id && existing.role === 'developer') ? ' disabled' : '') + '>' +
                '<option value="agent"' + (draftState.role === 'agent' ? ' selected' : '') + '>موظف خدمة العملاء</option>' +
                '<option value="supervisor"' + (draftState.role === 'supervisor' ? ' selected' : '') + '>المشرف</option>' +
                '<option value="general_manager"' + (draftState.role === 'general_manager' ? ' selected' : '') + '>المدير العام</option>' +
                ((isActorDevModal || draftState.role === 'developer') ? '<option value="developer"' + (draftState.role === 'developer' ? ' selected' : '') + '>المبرمج (صلاحيات النظام الكاملة)</option>' : '') +
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
            '<div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
              (canPreviewEmp
                ? '<button type="button" class="btn rg-preview-inline-btn" id="ef-preview-role-btn">👁️ معاينة النظام بهذا الدور</button>'
                : '<span></span>') +
              '<button type="submit" class="btn btn-primary" id="ef-save-btn">' + (isEdit ? 'حفظ التعديلات والصلاحيات' : 'إنشاء الحساب') + '</button>' +
            '</div>' +
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

      var efPreviewBtn = document.getElementById('ef-preview-role-btn');

      function syncApiLockForRole(roleVal) {
        var isAgent = roleVal === 'agent';
        modalRoot.querySelectorAll('.ef-perm-checkbox').forEach(function (cb) {
          if (cb.value === 'sync_data' || cb.value === 'manage_api_connection') {
            cb.disabled = isAgent;
            if (isAgent) cb.checked = false;
          }
        });
        if (efPreviewBtn) {
          var allowed = allowedPreviewRolesEmp.indexOf(roleVal) !== -1;
          efPreviewBtn.disabled = !allowed;
          efPreviewBtn.title = allowed ? 'معاينة النظام مباشرة بهذه الصلاحيات والدور' : 'لا يمكنك محاكاة هذا الدور';
        }
      }
      syncApiLockForRole(roleSelect.value);

      if (efPreviewBtn) {
        efPreviewBtn.addEventListener('click', function () {
          var selectedPerms = [];
          modalRoot.querySelectorAll('.ef-perm-checkbox:checked').forEach(function (cb) {
            if (!cb.disabled) selectedPerms.push(cb.value);
          });
          if (selectedPerms.indexOf('dash_perms_configured') === -1) selectedPerms.push('dash_perms_configured');
          if (selectedPerms.indexOf('perms_sections_configured') === -1) selectedPerms.push('perms_sections_configured');
          if (selectedPerms.indexOf('perms_subsections_configured') === -1) selectedPerms.push('perms_subsections_configured');
          if (selectedPerms.indexOf('perms_actions_configured') === -1) selectedPerms.push('perms_actions_configured');
          var lblName = (document.getElementById('ef-name') || {}).value || (jobInput ? jobInput.value : '');
          if (root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
            root.RGApp.startPreviewSession({
              role: roleSelect.value,
              customPermissions: selectedPerms,
              customLabel: String(lblName || '').trim()
            });
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

      function clearEmpGuard() {
        if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
          root.RGApp.clearUnsavedGuard();
        } else if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
          root.RGApp.setUnsavedGuard(null);
        }
      }

      function snapshotCurrentEmpDom() {
        var perms = [];
        modalRoot.querySelectorAll('.ef-perm-checkbox:checked').forEach(function (cb) {
          if (!cb.disabled && cb.value !== 'dash_perms_configured' && cb.value !== 'perms_sections_configured' && cb.value !== 'perms_subsections_configured' && cb.value !== 'perms_actions_configured') {
            perms.push(cb.value);
          }
        });
        perms.sort();
        return JSON.stringify({
          name: String((document.getElementById('ef-name') || {}).value || '').trim(),
          username: String((document.getElementById('ef-username') || {}).value || '').trim(),
          phone: String((document.getElementById('ef-phone') || {}).value || '').trim(),
          email: String((document.getElementById('ef-email') || {}).value || '').trim(),
          jobTitle: String((jobInput && jobInput.value) || '').trim(),
          role: roleSelect ? roleSelect.value : 'agent',
          presetId: presetSelect ? presetSelect.value : 'custom',
          permissions: perms
        });
      }

      async function executeSaveEmployee() {
        var errEl = document.getElementById('emp-form-err');
        if (errEl) errEl.classList.add('hidden');

        var selectedPerms = [];
        modalRoot.querySelectorAll('.ef-perm-checkbox:checked').forEach(function (cb) {
          if (!cb.disabled) selectedPerms.push(cb.value);
        });
        if (selectedPerms.indexOf('dash_perms_configured') === -1) {
          selectedPerms.push('dash_perms_configured');
        }
        if (selectedPerms.indexOf('perms_sections_configured') === -1) {
          selectedPerms.push('perms_sections_configured');
        }
        if (selectedPerms.indexOf('perms_subsections_configured') === -1) {
          selectedPerms.push('perms_subsections_configured');
        }
        if (selectedPerms.indexOf('perms_actions_configured') === -1) {
          selectedPerms.push('perms_actions_configured');
        }

        var payload = {
          name: document.getElementById('ef-name').value.trim(),
          username: document.getElementById('ef-username').value.trim(),
          phone: document.getElementById('ef-phone').value.trim(),
          email: document.getElementById('ef-email').value.trim(),
          jobTitle: document.getElementById('ef-job').value.trim(),
          role: document.getElementById('ef-role').value,
          permissions: selectedPerms
        };
        var pwd = document.getElementById('ef-pass').value;
        if (!payload.name) {
          errEl.textContent = 'يرجى إدخال الاسم الكامل للموظف.';
          errEl.classList.remove('hidden');
          return false;
        }
        if (!payload.username) {
          errEl.textContent = 'اسم المستخدم مطلوب.';
          errEl.classList.remove('hidden');
          return false;
        }
        if (!isEdit && (!pwd || pwd.length < 6)) {
          errEl.textContent = 'اسم المستخدم وكلمة المرور (6 أحرف على الأقل) مطلوبان.';
          errEl.classList.remove('hidden');
          return false;
        }
        if (pwd && pwd.length < 6) {
          errEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
          errEl.classList.remove('hidden');
          return false;
        }
        if (isEdit) {
          payload.employeeId = existing.id;
          if (pwd) payload.newPassword = pwd;
        } else {
          payload.password = pwd;
        }

        if (root.RGApp && typeof root.RGApp.checkActionSpam === 'function') {
          var empSpamSig = (isEdit ? 'updateEmployee:' : 'createEmployee:') +
            [payload.employeeId || '', payload.username, payload.name, payload.role, selectedPerms.length, pwd ? 'pw' : ''].join('|');
          var empSpamCheck = root.RGApp.checkActionSpam(isEdit ? 'updateEmployee' : 'createEmployee', empSpamSig);
          if (!empSpamCheck.allowed) {
            return false;
          }
          payload._spamChecked = true;
        }

        if (isEdit && ctx && ctx.appState && typeof ctx.appState.upsertEmployeeInState === 'function') {
          var optEmp = Object.assign({}, existing, {
            name: payload.name,
            username: payload.username,
            phone: payload.phone,
            email: payload.email,
            jobTitle: payload.jobTitle,
            role: payload.role,
            permissions: selectedPerms
          });
          ctx.appState.upsertEmployeeInState(optEmp);
          var realActorNow = (root.RGAuth && typeof root.RGAuth.getRealUser === 'function')
            ? root.RGAuth.getRealUser()
            : (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
          if (realActorNow && realActorNow.id === optEmp.id) {
            if (root.RGAuth && typeof root.RGAuth.updateCurrentUser === 'function') {
              var nextCur = root.RGAuth.updateCurrentUser({
                name: optEmp.name,
                username: optEmp.username,
                phone: optEmp.phone,
                email: optEmp.email,
                jobTitle: optEmp.jobTitle,
                role: optEmp.role,
                permissions: optEmp.permissions
              });
              if (root.RGApp && typeof root.RGApp.syncCurrentUserShell === 'function') {
                root.RGApp.syncCurrentUserShell(nextCur || optEmp);
              }
            }
          }
          clearEmpGuard();
          ctx.toast('تم تحديث بيانات وصلاحيات الموظف.');
          modalRoot.innerHTML = '';
          if (onSaved) onSaved(optEmp);
          root.RGApi.callApi('updateEmployee', payload).then(function (bgRes) {
            if (!bgRes || !bgRes.success) {
              ctx.appState.upsertEmployeeInState(existing);
              if (realActorNow && realActorNow.id === existing.id && root.RGAuth && typeof root.RGAuth.updateCurrentUser === 'function') {
                var revUser = root.RGAuth.updateCurrentUser(existing);
                if (root.RGApp && typeof root.RGApp.syncCurrentUserShell === 'function') {
                  root.RGApp.syncCurrentUserShell(revUser || existing);
                }
              }
              ctx.toast((bgRes && bgRes.message) || 'تعذر حفظ تعديلات الموظف على الخادم.', true);
              return;
            }
            if (bgRes.data) {
              ctx.appState.upsertEmployeeInState(bgRes.data);
              if (realActorNow && realActorNow.id === bgRes.data.id && root.RGAuth && typeof root.RGAuth.updateCurrentUser === 'function') {
                var syncedUser = root.RGAuth.updateCurrentUser(bgRes.data);
                if (root.RGApp && typeof root.RGApp.syncCurrentUserShell === 'function') {
                  root.RGApp.syncCurrentUserShell(syncedUser || bgRes.data);
                }
              }
            }
          }).catch(function () {
            ctx.appState.upsertEmployeeInState(existing);
            ctx.toast('تعذر حفظ تعديلات الموظف على الخادم.', true);
          });
          return true;
        }

        if (!isEdit && ctx && ctx.appState && typeof ctx.appState.upsertEmployeeInState === 'function') {
          var createActor = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
          var newOptEmp = {
            id: 'EMP_OPT_' + Date.now(),
            name: payload.name,
            username: payload.username,
            phone: payload.phone,
            email: payload.email,
            jobTitle: payload.jobTitle || 'موظف خدمة العملاء',
            role: payload.role,
            permissions: selectedPerms,
            status: 'active',
            reservationsCount: 0,
            followUpsCount: 0,
            problemsCount: 0,
            lastActivity: new Date().toISOString()
          };
          ctx.appState.upsertEmployeeInState(newOptEmp);
          if (root.RGApi && root.RGApi.applyOptimisticMutation) {
            root.RGApi.applyOptimisticMutation('createEmployee', { _optimisticEmployee: newOptEmp }, createActor);
          }
          clearEmpGuard();
          ctx.toast('تم إنشاء حساب الموظف بالصلاحيات المحددة بنجاح.');
          modalRoot.innerHTML = '';
          if (onSaved) onSaved(newOptEmp);
          root.RGApi.callApi('createEmployee', Object.assign({ _keepOptimisticCache: true }, payload)).then(function (bgCreateRes) {
            if (!bgCreateRes || !bgCreateRes.success) {
              if (typeof ctx.appState.removeEmployeeLocal === 'function') {
                ctx.appState.removeEmployeeLocal(newOptEmp.id);
              }
              ctx.toast((bgCreateRes && bgCreateRes.message) || 'تعذر إنشاء حساب الموظف على الخادم.', true);
              return;
            }
            if (bgCreateRes.data) {
              if (typeof ctx.appState.removeEmployeeLocal === 'function') {
                ctx.appState.removeEmployeeLocal(newOptEmp.id);
              }
              ctx.appState.upsertEmployeeInState(bgCreateRes.data);
            }
          }).catch(function () {
            if (typeof ctx.appState.removeEmployeeLocal === 'function') {
              ctx.appState.removeEmployeeLocal(newOptEmp.id);
            }
            ctx.toast('تعذر الاتصال بالخادم أثناء إنشاء حساب الموظف.', true);
          });
          return true;
        }

        var res = await root.RGApi.callApi(isEdit ? 'updateEmployee' : 'createEmployee', payload);
        if (!res.success) {
          errEl.textContent = res.message;
          errEl.classList.remove('hidden');
          return false;
        }
        clearEmpGuard();
        if (res.data && ctx && ctx.appState && typeof ctx.appState.upsertEmployeeInState === 'function') {
          ctx.appState.upsertEmployeeInState(res.data);
        }
        ctx.toast(isEdit ? 'تم تحديث بيانات وصلاحيات الموظف.' : 'تم إنشاء حساب الموظف بالصلاحيات المحددة بنجاح.');
        modalRoot.innerHTML = '';
        if (onSaved) onSaved(res.data);
        return true;
      }

      if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
        root.RGApp.setUnsavedGuard({
          label: isEdit ? ('تعديل بيانات ' + (existing.name || 'الموظف')) : 'إنشاء حساب موظف جديد',
          isDirty: function () {
            var f = document.getElementById('emp-form');
            if (!f) return false;
            var pwdEl = document.getElementById('ef-pass');
            if (pwdEl && String(pwdEl.value || '').length > 0) return true;
            return snapshotCurrentEmpDom() !== initialEmpSnapshot;
          },
          onSave: function () {
            return executeSaveEmployee();
          },
          onDiscard: function () {
            clearEmpGuard();
            modalRoot.innerHTML = '';
            if (onSaved) onSaved();
          }
        });
      }

      document.getElementById('emp-cancel').addEventListener('click', function () {
        var proceedClose = function () {
          clearEmpGuard();
          modalRoot.innerHTML = '';
          if (onSaved) onSaved();
        };
        if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
          root.RGApp.requestCloseWithGuard(proceedClose);
        } else {
          proceedClose();
        }
      });

      var empForm = document.getElementById('emp-form');
      empForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var submitBtn = document.getElementById('ef-save-btn') || empForm.querySelector('button[type="submit"]');
        runWithLock(submitBtn, isEdit ? ('updateEmployee:' + existing.id) : ('createEmployee:' + (document.getElementById('ef-username').value || 'new')), function () {
          return executeSaveEmployee();
        });
      });
    }

    drawModal();
  }

  function formatLocalDateTimeInput(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openGrantDelegationModal(employees, ctx, onDone) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var candidates = (Array.isArray(employees) ? employees : []).filter(function (e) {
      return e && e.status === 'active' && e.role !== 'general_manager' && e.role !== 'developer';
    });
    if (!candidates.length) {
      ctx.toast('لا يوجد موظفون نشطون متاحون لمنح التفويض المؤقت.', true);
      return;
    }
    var nowDt = new Date();
    var endDt = new Date(nowDt.getTime() + 24 * 3600000);

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="del-grant-modal" role="dialog" aria-modal="true" aria-labelledby="del-grant-title">' +
        '<form class="modal-panel" id="del-grant-form" style="max-width:520px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="del-grant-title">منح تفويض صلاحية مؤقت</h3>' +
              '<p class="section-subtitle">يُمنح الموظف صلاحيات المشرف مؤقتاً وتنتهي تلقائياً عند الموعد المحدد.</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="del-grant-cancel" data-modal-close>إغلاق</button>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="del-emp-select">الموظف البديل</label>' +
            '<select class="select" id="del-emp-select" required>' +
              candidates.map(function (e) {
                return '<option value="' + esc(e.id) + '">' + esc(e.name) + ' (' + esc(e.jobTitle || e.role) + ')</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group">' +
              '<label class="form-label" for="del-starts-at">بداية التفويض</label>' +
              '<input type="datetime-local" class="input mono" id="del-starts-at" dir="ltr" value="' + esc(formatLocalDateTimeInput(nowDt)) + '" required>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="del-expires-at">نهاية التفويض (يُلغى تلقائياً)</label>' +
              '<input type="datetime-local" class="input mono" id="del-expires-at" dir="ltr" value="' + esc(formatLocalDateTimeInput(endDt)) + '" required>' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="del-reason">سبب التفويض</label>' +
            '<input type="text" class="input" id="del-reason" placeholder="مثال: تغطية إجازة مشرف الوردية المسائية">' +
          '</div>' +
          '<div id="del-grant-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="del-grant-close" data-modal-close>إلغاء</button>' +
            '<button type="submit" class="btn btn-primary" id="del-grant-submit">تفعيل التفويض المؤقت</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    var closeDelModal = function () { modalRoot.innerHTML = ''; };
    document.getElementById('del-grant-cancel').addEventListener('click', closeDelModal);
    document.getElementById('del-grant-close').addEventListener('click', closeDelModal);

    var delForm = document.getElementById('del-grant-form');
    delForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = document.getElementById('del-grant-err');
      errEl.classList.add('hidden');
      var empId = document.getElementById('del-emp-select').value;
      var startsRaw = document.getElementById('del-starts-at').value;
      var expiresRaw = document.getElementById('del-expires-at').value;
      var reasonVal = document.getElementById('del-reason').value.trim();

      var sDate = startsRaw ? new Date(startsRaw) : new Date();
      var eDate = expiresRaw ? new Date(expiresRaw) : null;
      if (!eDate || isNaN(eDate.getTime()) || eDate.getTime() <= sDate.getTime()) {
        errEl.textContent = 'يجب أن يكون وقت نهاية التفويض بعد وقت البداية.';
        errEl.classList.remove('hidden');
        return;
      }

      var submitBtn = document.getElementById('del-grant-submit');
      runWithLock(submitBtn, 'saveDelegation:' + empId, function () {
        var delActor = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
        var targetCand = candidates.find(function (e) { return e.id === empId; });
        var delPayload = {
          delegateEmployeeId: empId,
          delegatedRole: 'supervisor',
          startsAt: sDate.toISOString(),
          expiresAt: eDate.toISOString(),
          reason: reasonVal
        };
        var optDelegation = Object.assign({
          id: 'DEL_OPT_' + Date.now(),
          delegateEmployeeName: targetCand ? targetCand.name : empId,
          status: 'active',
          isActiveNow: true
        }, delPayload);
        if (root.RGApi && root.RGApi.applyOptimisticMutation) {
          root.RGApi.applyOptimisticMutation('saveDelegation', { _optimisticDelegation: optDelegation }, delActor);
        }
        ctx.toast('تم منح تفويض المشرف المؤقت بنجاح.');
        closeDelModal();
        if (onDone) onDone(optDelegation);
        return root.RGApi.callApi('saveDelegation', Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, delPayload)).then(function (resp) {
          if (!resp || !resp.success) {
            ctx.toast((resp && resp.message) || 'تعذر حفظ التفويض المؤقت على الخادم.', true);
            if (onDone) onDone();
          }
        }).catch(function () {
          ctx.toast('تعذر الاتصال بالخادم أثناء حفظ التفويض.', true);
          if (onDone) onDone();
        });
      }, { spamAction: 'saveDelegation', spamSig: 'saveDelegation:' + empId });
    });
  }

  function openBulkReassignModal(employees, ctx, onDone, preselectedFromId) {
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    var allEmps = Array.isArray(employees) ? employees : [];
    var fromCandidates = allEmps.filter(function (e) {
      return e && (e.status === 'active' || Number(e.reservationsCount || 0) > 0);
    });
    var toCandidates = allEmps.filter(function (e) {
      return e && e.status === 'active';
    });
    if (!fromCandidates.length || toCandidates.length < 1) {
      ctx.toast('يلزم وجود موظف مستلم نشط لإتمام التحويل الجماعي.', true);
      return;
    }

    var defaultFrom = preselectedFromId && fromCandidates.some(function (e) { return e.id === preselectedFromId; })
      ? preselectedFromId
      : fromCandidates[0].id;
    var defaultToObj = toCandidates.find(function (e) { return e.id !== defaultFrom; }) || toCandidates[0];
    var defaultTo = defaultToObj ? defaultToObj.id : '';

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="bulk-reassign-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-reassign-title">' +
        '<form class="modal-panel" id="bulk-reassign-form" style="max-width:540px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="bulk-reassign-title">تحويل جماعي عند انتهاء الوردية</h3>' +
              '<p class="section-subtitle">انقل جميع الحجوزات النشطة من موظف إلى موظف الوردية التالية بضغطة واحدة.</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="bulk-reassign-cancel" data-modal-close>إغلاق</button>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group">' +
              '<label class="form-label" for="br-from-emp">الموظف المُحوَّل منه (المغادر)</label>' +
              '<select class="select" id="br-from-emp" required>' +
                fromCandidates.map(function (e) {
                  var cnt = e.reservationsCount !== undefined ? e.reservationsCount : ((e.stats && e.stats.assignedCount) || 0);
                  return '<option value="' + esc(e.id) + '"' + (e.id === defaultFrom ? ' selected' : '') + '>' + esc(e.name) + ' (' + cnt + ' حجز)</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="br-to-emp">موظف الوردية التالية (المستلم)</label>' +
              '<select class="select" id="br-to-emp" required>' +
                toCandidates.map(function (e) {
                  return '<option value="' + esc(e.id) + '"' + (e.id === defaultTo ? ' selected' : '') + '>' + esc(e.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
          '<label class="checkbox-item" style="margin-top:4px;">' +
            '<input type="checkbox" id="br-only-active" checked>' +
            '<span>تحويل الحجوزات النشطة غير المنتهية فقط (استبعاد المغلقة والملغاة)</span>' +
          '</label>' +
          '<div id="br-preview-box" style="padding:10px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-hairline);background:var(--bg-surface-subtle);font-size:12.5px;color:var(--text-secondary);"></div>' +
          '<div id="br-form-err" class="form-error hidden"></div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="bulk-reassign-close" data-modal-close>إلغاء</button>' +
            '<button type="submit" class="btn btn-primary" id="br-submit-btn">تنفيذ التحويل الجماعي</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    var closeBr = function () { modalRoot.innerHTML = ''; };
    document.getElementById('bulk-reassign-cancel').addEventListener('click', closeBr);
    document.getElementById('bulk-reassign-close').addEventListener('click', closeBr);

    var fromSel = document.getElementById('br-from-emp');
    var toSel = document.getElementById('br-to-emp');
    var previewBox = document.getElementById('br-preview-box');

    function updatePreview() {
      var fEmp = fromCandidates.find(function (e) { return e.id === fromSel.value; });
      var tEmp = toCandidates.find(function (e) { return e.id === toSel.value; });
      var cnt = fEmp ? (fEmp.reservationsCount !== undefined ? fEmp.reservationsCount : ((fEmp.stats && fEmp.stats.assignedCount) || 0)) : 0;
      if (previewBox) {
        previewBox.innerHTML = fEmp && tEmp
          ? ('سيتم نقل عهدة الحجوزات المسندة إلى <strong>' + esc(fEmp.name) + '</strong> (إجمالي المسجل: <strong class="tabular-nums">' + cnt + '</strong>) إلى <strong>' + esc(tEmp.name) + '</strong>.')
          : '';
      }
    }
    fromSel.addEventListener('change', updatePreview);
    toSel.addEventListener('change', updatePreview);
    updatePreview();

    var brForm = document.getElementById('bulk-reassign-form');
    brForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = document.getElementById('br-form-err');
      errEl.classList.add('hidden');
      var fId = fromSel.value;
      var tId = toSel.value;
      if (!fId || !tId || fId === tId) {
        errEl.textContent = 'يرجى اختيار موظفين مختلفين للتحويل.';
        errEl.classList.remove('hidden');
        return;
      }
      var onlyActive = Boolean(document.getElementById('br-only-active').checked);
      var submitBtn = document.getElementById('br-submit-btn');
      runWithLock(submitBtn, 'bulkReassign:' + fId + ':' + tId, async function () {
        var resp = await root.RGApi.callApi('bulkReassignEmployeeReservations', {
          fromEmployeeId: fId,
          toEmployeeId: tId,
          onlyActive: onlyActive,
          _spamChecked: true
        });
        if (!resp || !resp.success) {
          errEl.textContent = (resp && resp.message) || 'تعذر تنفيذ التحويل الجماعي.';
          errEl.classList.remove('hidden');
          return;
        }
        var count = (resp.data && resp.data.transferredCount) || 0;
        ctx.toast(resp.message || ('تم تحويل ' + count + ' حجز إلى الموظف البديل بنجاح.'));
        if (root.RGApi && root.RGApi.invalidateScopes) {
          root.RGApi.invalidateScopes(['reservations', 'followUps', 'employees', 'dashboard', 'activity']);
        }
        closeBr();
        if (onDone) onDone(resp.data);
      }, { spamAction: 'bulkReassignEmployeeReservations', spamSig: 'bulkReassign:' + fId + ':' + tId });
    });
  }

  function openEditDeveloperModal(ctx, onSaved) {
    var curUser = (root.RGAuth && typeof root.RGAuth.getRealUser === 'function')
      ? root.RGAuth.getRealUser()
      : (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    if (!curUser || curUser.role !== 'developer') {
      if (ctx && ctx.toast) ctx.toast('هذه الميزة متاحة لحساب المبرمج فقط.', true);
      return;
    }
    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var list = (empState && Array.isArray(empState.items)) ? empState.items : [];
    var devRecord = list.find(function (e) { return e && (e.id === curUser.id || e.role === 'developer'); }) || curUser;
    openEmployeeModal(devRecord, ctx, onSaved || function () {}, {
      rolePresets: (empState && empState.rolePresets) || [],
      customPermissions: (empState && empState.customPermissions) || []
    });
  }

  function getStatsControlConfigFromApp(ctx) {
    var raw = (ctx && typeof ctx.getStatsControlConfig === 'function')
      ? ctx.getStatsControlConfig()
      : (root.RGApp && typeof root.RGApp.getStatsControlConfig === 'function' ? root.RGApp.getStatsControlConfig() : null);
    return (root.RGCrmCore && typeof root.RGCrmCore.normalizeStatsControlConfig === 'function')
      ? root.RGCrmCore.normalizeStatsControlConfig(raw)
      : { excludedFromStatsEmployeeIds: [], updatedAt: '', updatedBy: '' };
  }

  function getRealActorForDevFeatures() {
    if (root.RGAuth && typeof root.RGAuth.getRealUser === 'function') {
      return root.RGAuth.getRealUser() || root.RGAuth.getUser();
    }
    return (root.RGAuth && typeof root.RGAuth.getUser === 'function') ? root.RGAuth.getUser() : null;
  }

  function renderSwitchMarkup(idAttr, cls, dataAttrHtml, checked, disabled, labelText) {
    return '<label class="rg-switch-label">' +
      '<span class="rg-switch-control">' +
        '<input type="checkbox"' +
          (idAttr ? (' id="' + esc(idAttr) + '"') : '') +
          (cls ? (' class="' + esc(cls) + '"') : '') +
          (dataAttrHtml ? (' ' + dataAttrHtml) : '') +
          (checked ? ' checked' : '') +
          (disabled ? ' disabled' : '') +
        '>' +
        '<span class="rg-switch-track"></span>' +
      '</span>' +
      '<span>' + esc(labelText) + '</span>' +
    '</label>';
  }

  async function openEmployeeSectionsModal(targetEmp, allEmployees, ctx, onSaved, opts) {
    var realActor = getRealActorForDevFeatures();
    var coreRef = root.RGCrmCore;
    var isActorDev = Boolean(realActor && realActor.role === 'developer');
    var canOpenSections = Boolean(
      isActorDev ||
      (realActor && (realActor.role === 'general_manager' || (coreRef && coreRef.canUserPerform && coreRef.canUserPerform(realActor, 'customize_ui'))))
    );
    if (!canOpenSections) {
      if (ctx && ctx.toast) ctx.toast('التحكم في إظهار وإخفاء الأقسام وعناصر الواجهة متاح للمبرمج أو المدير العام فقط.', true);
      return;
    }
    var focusGroupId = (opts && opts.focusGroup) ? String(opts.focusGroup) : '';

    var employeesList = Array.isArray(allEmployees) && allEmployees.length
      ? allEmployees.slice()
      : (((root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState().items : []) || []);

    if (!employeesList.length && root.RGApi) {
      var fetched = await root.RGApi.callApi('getEmployees', {});
      if (fetched && fetched.success && fetched.data && Array.isArray(fetched.data.items)) {
        employeesList = fetched.data.items;
        if (root.RGApp && typeof root.RGApp.syncEmployeesStateFromPayload === 'function') {
          root.RGApp.syncEmployeesStateFromPayload(fetched.data);
        }
      }
    }

    if (!employeesList.length) {
      if (ctx && ctx.toast) ctx.toast('لا توجد حسابات موظفين متاحة للتحكم بها حالياً.', true);
      return;
    }

    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;

    var core = root.RGCrmCore;
    var groups = (core && Array.isArray(core.EMPLOYEE_SECTION_GROUPS)) ? core.EMPLOYEE_SECTION_GROUPS : [];
    var statsViewKeys = (core && Array.isArray(core.STATS_VIEW_PERMISSION_KEYS)) ? core.STATS_VIEW_PERMISSION_KEYS : [];
    var roleLabels = (core && core.ROLE_LABELS && (core.ROLE_LABELS[ctx && ctx.lang] || core.ROLE_LABELS.ar)) || {};

    var preferredEmp = targetEmp && employeesList.find(function (e) { return e.id === targetEmp.id; });
    if (!preferredEmp) {
      preferredEmp = employeesList.find(function (e) { return e && e.role !== 'developer'; }) || employeesList[0];
    }

    var activeEmpId = preferredEmp.id;
    var searchTerm = '';
    var draftPermsByEmpId = {};
    var draftUiOverridesByEmpId = {};
    var uiOptsList = (core && Array.isArray(core.UI_SIMPLIFICATION_OPTIONS)) ? core.UI_SIMPLIFICATION_OPTIONS : [];
    var initialStatsConfig = getStatsControlConfigFromApp(ctx);
    var excludedMap = {};
    initialStatsConfig.excludedFromStatsEmployeeIds.forEach(function (id) { excludedMap[id] = true; });
    var initialExcludedSnapshot = JSON.stringify(initialStatsConfig.excludedFromStatsEmployeeIds.slice().sort());

    function getWorkingPerms(emp) {
      if (!emp) return [];
      if (!draftPermsByEmpId[emp.id]) {
        draftPermsByEmpId[emp.id] = core && core.ensureSectionPermissionSentinels
          ? core.ensureSectionPermissionSentinels(emp.role, emp.permissions)
          : (Array.isArray(emp.permissions) ? emp.permissions.slice() : []);
      }
      return draftPermsByEmpId[emp.id];
    }

    function getWorkingUiOverrides(emp) {
      if (!emp) return {};
      if (!draftUiOverridesByEmpId[emp.id]) {
        draftUiOverridesByEmpId[emp.id] = (core && typeof core.normalizeUiOverrides === 'function')
          ? core.normalizeUiOverrides(emp.uiOverrides || {})
          : Object.assign({}, emp.uiOverrides || {});
      }
      return draftUiOverridesByEmpId[emp.id];
    }

    function drawSectionsModal() {
      var curEmp = employeesList.find(function (e) { return e.id === activeEmpId; }) || employeesList[0];
      activeEmpId = curEmp.id;
      var curPerms = getWorkingPerms(curEmp);
      var curUiOv = getWorkingUiOverrides(curEmp);
      var tempUser = { role: curEmp.role, permissions: curPerms, uiOverrides: curUiOv };
      var isDevTarget = curEmp.role === 'developer';
      var isLockedTarget = isDevTarget;
      var summary = core && core.getEmployeeSectionVisibilitySummary
        ? core.getEmployeeSectionVisibilitySummary(tempUser)
        : { totalVisible: 0, totalAvailable: 0 };
      var appearInStats = !excludedMap[curEmp.id];
      var canViewStats = core && core.canEmployeeViewStatistics
        ? core.canEmployeeViewStatistics(tempUser)
        : true;
      var q = String(searchTerm || '').trim().toLowerCase();

      var filteredUiOpts = uiOptsList.filter(function (opt) {
        if (!q) return true;
        return (String(opt.labelAr || '') + ' ' + String(opt.labelEn || '') + ' ' + String(opt.key || '')).toLowerCase().indexOf(q) !== -1;
      });
      var ovActiveCount = uiOptsList.filter(function (opt) { return curUiOv[opt.key] !== undefined; }).length;
      var uiOverridesCardHtml =
        '<div class="rg-esec-group-card" data-esec-group="ui_overrides">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<strong style="font-size:13.5px;color:var(--text-primary);">تخصيص واجهة الموظف الفردية (إظهار / إخفاء العناصر)</strong>' +
              '<span class="status-tag status-info tabular-nums">' + ovActiveCount + ' تخصيص فردي</span>' +
            '</div>' +
            (!isLockedTarget ? '<button type="button" class="btn btn-sm" id="esec-restore-ui-btn">استعادة الافتراضي للموظف</button>' : '') +
          '</div>' +
          (filteredUiOpts.length === 0
            ? '<div style="font-size:12px;color:var(--text-muted);">لا توجد عناصر واجهة مطابقة للبحث.</div>'
            : '<div class="rg-esec-items-grid">' +
                filteredUiOpts.map(function (opt) {
                  var ovVal = curUiOv[opt.key] === true ? 'hide' : (curUiOv[opt.key] === false ? 'show' : 'inherit');
                  return '<div class="rg-esec-item-row">' +
                    '<div style="min-width:0;flex:1;">' +
                      '<div style="font-size:12.5px;font-weight:600;color:var(--text-primary);line-height:1.35;">' + esc(opt.labelAr) + '</div>' +
                      '<div class="mono" style="font-size:10.5px;color:var(--text-muted);" dir="ltr">' + esc(opt.key) + '</div>' +
                    '</div>' +
                    '<select class="select esec-ui-ov-sel" data-ui-key="' + esc(opt.key) + '"' + (isLockedTarget ? ' disabled' : '') + ' style="width:auto;min-width:130px;padding:4px 8px;min-height:32px;font-size:12px;">' +
                      '<option value="inherit"' + (ovVal === 'inherit' ? ' selected' : '') + '>افتراضي الدور</option>' +
                      '<option value="hide"' + (ovVal === 'hide' ? ' selected' : '') + '>إخفاء قسري</option>' +
                      '<option value="show"' + (ovVal === 'show' ? ' selected' : '') + '>إظهار قسري</option>' +
                    '</select>' +
                  '</div>';
                }).join('') +
              '</div>') +
        '</div>';

      var groupsHtml = groups.map(function (grp) {
        var filteredItems = grp.items.filter(function (it) {
          if (!q) return true;
          return (String(it.labelAr || '') + ' ' + String(it.labelEn || '') + ' ' + String(it.key || '')).toLowerCase().indexOf(q) !== -1;
        });
        if (!filteredItems.length) return '';

        var visibleInGrp = grp.items.filter(function (it) {
          return isDevTarget ? true : curPerms.indexOf(it.key) !== -1;
        }).length;

        return '<div class="rg-esec-group-card" data-esec-group="' + esc(grp.id) + '">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<strong style="font-size:13.5px;color:var(--text-primary);">' + esc(grp.labelAr) + '</strong>' +
              '<span class="status-tag status-info tabular-nums">' + visibleInGrp + ' / ' + grp.items.length + ' ظاهر</span>' +
            '</div>' +
            (!isDevTarget ? (
              '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-sm esec-group-toggle" data-group-id="' + esc(grp.id) + '" data-vis="1">إظهار الكل</button>' +
                '<button type="button" class="btn btn-sm btn-danger esec-group-toggle" data-group-id="' + esc(grp.id) + '" data-vis="0">إخفاء الكل</button>' +
              '</div>'
            ) : '') +
          '</div>' +
          '<div class="rg-esec-items-grid">' +
            filteredItems.map(function (it) {
              var checked = isDevTarget ? true : (curPerms.indexOf(it.key) !== -1);
              return '<div class="rg-esec-item-row">' +
                '<div style="min-width:0;flex:1;">' +
                  '<div style="font-size:12.5px;font-weight:600;color:var(--text-primary);line-height:1.35;">' + esc(it.labelAr) + '</div>' +
                  '<div class="mono" style="font-size:10.5px;color:var(--text-muted);" dir="ltr">' + esc(it.key) + '</div>' +
                '</div>' +
                renderSwitchMarkup('', 'esec-item-cb', 'data-perm-key="' + esc(it.key) + '"', checked, isDevTarget, checked ? 'ظاهر' : 'مخفي') +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
      }).join('');

      var canPreviewTarget = Boolean(
        !isDevTarget &&
        realActor && curEmp.id !== realActor.id &&
        root.RGApp && typeof root.RGApp.startPreviewSession === 'function'
      );

      modalRoot.innerHTML =
        '<div class="modal-backdrop" id="esec-modal" role="dialog" aria-modal="true" aria-labelledby="esec-modal-title">' +
          '<div class="modal-panel" style="max-width:860px;">' +
            '<div class="modal-header">' +
              '<div>' +
                '<h3 class="modal-title" id="esec-modal-title">' + (focusGroupId === 'table_actions' ? 'إظهار / إخفاء أزرار وإجراءات الجداول لكل موظف' : 'إظهار / إخفاء الأقسام وعناصر الواجهة لكل موظف') + '</h3>' +
                '<p class="section-subtitle">تحكم دقيق في الصفحات الرئيسية، التبويبات الفرعية، تخصيصات الواجهة الفردية، وأزرار الجداول والتصدير بشكل مستقل لكل حساب.</p>' +
              '</div>' +
              '<button type="button" class="btn btn-sm" id="esec-close-top" data-modal-close>إغلاق</button>' +
            '</div>' +
            '<div class="form-grid-2" style="align-items:end;margin-bottom:12px;">' +
              '<div class="form-group" style="margin-bottom:0;">' +
                '<label class="form-label" for="esec-emp-select">اختر الموظف</label>' +
                '<select class="select" id="esec-emp-select">' +
                  employeesList.map(function (e) {
                    return '<option value="' + esc(e.id) + '"' + (e.id === curEmp.id ? ' selected' : '') + '>' +
                      esc(e.name) + ' — ' + esc(roleLabels[e.role] || e.role) + (e.status === 'disabled' ? ' (متوقف)' : '') +
                    '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-group" style="margin-bottom:0;">' +
                '<label class="form-label" for="esec-search-input">بحث داخل الأقسام والأزرار</label>' +
                '<input type="search" class="input" id="esec-search-input" value="' + esc(searchTerm) + '" placeholder="ابحث مثل: تصدير، رفض، إلغاء، غير فعالة، الهوية...">' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-hairline);background:var(--bg-surface-subtle);margin-bottom:12px;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span class="status-tag status-info tabular-nums" id="esec-summary-pill">العناصر الظاهرة: ' + summary.totalVisible + ' / ' + summary.totalAvailable + '</span>' +
                (isActorDev ? ('<span class="status-tag ' + (appearInStats ? 'status-success' : 'status-warning') + '">' + (appearInStats ? 'يظهر في الإحصائيات' : 'مخفي من الإحصائيات') + '</span>') : '') +
                '<button type="button" class="btn btn-sm" id="esec-jump-actions-btn">⚡ أزرار وإجراءات الجداول</button>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                (canPreviewTarget ? '<button type="button" class="btn btn-sm" id="esec-preview-btn">👁️ معاينة بحساب هذا الموظف</button>' : '') +
              '</div>' +
            '</div>' +
            (isDevTarget ? (
              '<div class="rg-error-banner" style="margin-bottom:12px;border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.08);">' +
                '<div class="rg-error-banner-body">' +
                  '<div class="rg-error-banner-title" style="color:var(--text-primary);">حساب المبرمج محمي ويحتفظ بكامل الأقسام والأزرار دائماً</div>' +
                  '<div class="rg-error-banner-msg">يمكنك اختيار أي موظف آخر من القائمة أعلاه لتخصيص أقسامه وأزراره وإعدادات الواجهة الخاصة به.</div>' +
                '</div>' +
              '</div>'
            ) : '') +
            (isActorDev ? (
              '<div class="rg-esec-group-card" style="margin-bottom:12px;border-color:rgba(217,31,43,0.24);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
                  '<strong style="font-size:13.5px;color:var(--text-primary);">تحكم سريع في الإحصائيات لهذا الموظف</strong>' +
                  '<div class="rg-stats-ctrl-toggles">' +
                    renderSwitchMarkup('esec-appear-in-stats', '', '', appearInStats, false, 'يظهر اسمه وأرقامه في الإحصائيات') +
                    renderSwitchMarkup('esec-view-stats', '', '', isDevTarget ? true : canViewStats, isDevTarget, 'يشاهد صفحات وبطاقات الإحصائيات') +
                  '</div>' +
                '</div>' +
              '</div>'
            ) : '') +
            '<div id="esec-groups-scroll" style="display:flex;flex-direction:column;gap:12px;max-height:46vh;overflow-y:auto;padding-inline-end:4px;">' +
              uiOverridesCardHtml +
              (groupsHtml || '<div class="empty-state" style="padding:18px;">لا توجد أقسام أو أزرار مطابقة لعبارة البحث.</div>') +
            '</div>' +
            '<div id="esec-err" class="form-error hidden" style="margin-top:10px;"></div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn" id="esec-cancel-btn" data-modal-close>إلغاء</button>' +
              '<button type="button" class="btn btn-primary" id="esec-save-btn">حفظ الأقسام والواجهة للموظف</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      if (focusGroupId) {
        var targetGrpEl = modalRoot.querySelector('[data-esec-group="' + focusGroupId + '"]');
        if (targetGrpEl && typeof targetGrpEl.scrollIntoView === 'function') {
          setTimeout(function () {
            targetGrpEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            targetGrpEl.style.borderColor = 'var(--brand-primary)';
          }, 40);
        }
      }

      var jumpActionsBtn = document.getElementById('esec-jump-actions-btn');
      if (jumpActionsBtn) {
        jumpActionsBtn.addEventListener('click', function () {
          focusGroupId = 'table_actions';
          var actGrp = modalRoot.querySelector('[data-esec-group="table_actions"]');
          if (actGrp && typeof actGrp.scrollIntoView === 'function') {
            actGrp.scrollIntoView({ behavior: 'smooth', block: 'start' });
            actGrp.style.borderColor = 'var(--brand-primary)';
          }
        });
      }

      var closeModal = function () { modalRoot.innerHTML = ''; };
      document.getElementById('esec-close-top').addEventListener('click', closeModal);
      document.getElementById('esec-cancel-btn').addEventListener('click', closeModal);

      var empSel = document.getElementById('esec-emp-select');
      if (empSel) {
        empSel.addEventListener('change', function () {
          activeEmpId = empSel.value;
          drawSectionsModal();
        });
      }

      var searchEl = document.getElementById('esec-search-input');
      if (searchEl) {
        searchEl.addEventListener('input', function () {
          searchTerm = searchEl.value;
          var cursorPos = searchEl.selectionStart || searchTerm.length;
          drawSectionsModal();
          var nextSearch = document.getElementById('esec-search-input');
          if (nextSearch) {
            nextSearch.focus();
            try { nextSearch.setSelectionRange(cursorPos, cursorPos); } catch (_s) {}
          }
        });
      }

      var previewBtn = document.getElementById('esec-preview-btn');
      if (previewBtn) {
        previewBtn.addEventListener('click', function () {
          if (root.RGApp && typeof root.RGApp.startPreviewSession === 'function') {
            closeModal();
            root.RGApp.startPreviewSession({ employeeId: curEmp.id });
          }
        });
      }

      var appearCb = document.getElementById('esec-appear-in-stats');
      if (appearCb) {
        appearCb.addEventListener('change', function () {
          if (appearCb.checked) delete excludedMap[curEmp.id];
          else excludedMap[curEmp.id] = true;
          drawSectionsModal();
        });
      }

      var viewStatsCb = document.getElementById('esec-view-stats');
      if (viewStatsCb && !isDevTarget) {
        viewStatsCb.addEventListener('change', function () {
          if (core && typeof core.applyEmployeeStatsViewToggle === 'function') {
            draftPermsByEmpId[curEmp.id] = core.applyEmployeeStatsViewToggle(curEmp.role, getWorkingPerms(curEmp), viewStatsCb.checked);
          }
          drawSectionsModal();
        });
      }

      modalRoot.querySelectorAll('.esec-group-toggle').forEach(function (gBtn) {
        gBtn.addEventListener('click', function () {
          var grpId = gBtn.getAttribute('data-group-id');
          var show = gBtn.getAttribute('data-vis') === '1';
          var grpObj = groups.find(function (g) { return g.id === grpId; });
          if (!grpObj || !core || typeof core.setEmployeeSectionGroupVisibility !== 'function') return;
          var keys = grpObj.items.map(function (x) { return x.key; });
          draftPermsByEmpId[curEmp.id] = core.setEmployeeSectionGroupVisibility(curEmp.role, getWorkingPerms(curEmp), keys, show);
          drawSectionsModal();
        });
      });

      modalRoot.querySelectorAll('.esec-item-cb').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var pKey = cb.getAttribute('data-perm-key');
          if (core && typeof core.applyEmployeeSectionToggle === 'function') {
            draftPermsByEmpId[curEmp.id] = core.applyEmployeeSectionToggle(curEmp.role, getWorkingPerms(curEmp), pKey, cb.checked);
          }
          drawSectionsModal();
        });
      });

      modalRoot.querySelectorAll('.esec-ui-ov-sel').forEach(function (sel) {
        sel.addEventListener('change', function () {
          if (isLockedTarget) return;
          var uiKey = sel.getAttribute('data-ui-key');
          var val = sel.value;
          var workingOv = Object.assign({}, getWorkingUiOverrides(curEmp));
          if (val === 'hide') workingOv[uiKey] = true;
          else if (val === 'show') workingOv[uiKey] = false;
          else delete workingOv[uiKey];
          draftUiOverridesByEmpId[curEmp.id] = workingOv;
          drawSectionsModal();
        });
      });

      var restoreUiBtn = document.getElementById('esec-restore-ui-btn');
      if (restoreUiBtn && !isLockedTarget) {
        restoreUiBtn.addEventListener('click', function () {
          runWithLock(restoreUiBtn, 'restoreEmpUi:' + curEmp.id, async function () {
            var rRes = await root.RGApi.callApi('restoreUiDefaults', {
              scope: 'employee',
              employeeId: curEmp.id,
              _spamChecked: true
            });
            if (!rRes || !rRes.success) {
              if (ctx && ctx.toast) ctx.toast((rRes && rRes.message) || 'تعذر استعادة الافتراضي للموظف.', true);
              return;
            }
            curEmp.uiOverrides = {};
            draftUiOverridesByEmpId[curEmp.id] = {};
            if (root.RGApp && typeof root.RGApp.upsertEmployeeInState === 'function') {
              root.RGApp.upsertEmployeeInState(curEmp);
            }
            if (realActor && curEmp.id === realActor.id) {
              var nextCur = Object.assign({}, realActor, { uiOverrides: {} });
              if (root.RGAuth && typeof root.RGAuth.setUser === 'function') root.RGAuth.setUser(nextCur);
              if (root.RGApp && typeof root.RGApp.applyUiSimplification === 'function') root.RGApp.applyUiSimplification(null, true);
              if (root.RGApp && typeof root.RGApp.syncCurrentUserShell === 'function') root.RGApp.syncCurrentUserShell(nextCur);
            }
            if (ctx && ctx.toast) ctx.toast('تمت استعادة الإعدادات الافتراضية للواجهة لهذا الموظف.');
            drawSectionsModal();
          });
        });
      }

      var saveBtn = document.getElementById('esec-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var errEl = document.getElementById('esec-err');
          if (errEl) errEl.classList.add('hidden');
          runWithLock(saveBtn, 'devSectionsSave:' + curEmp.id, async function () {
            var nextExcludedIds = Object.keys(excludedMap).filter(function (id) { return excludedMap[id]; }).sort();
            var statsChanged = isActorDev && (JSON.stringify(nextExcludedIds) !== initialExcludedSnapshot);
            var changedEmpIds = Object.keys(draftPermsByEmpId).filter(function (id) {
              var tObj = employeesList.find(function (e) { return e.id === id; });
              if (!tObj || tObj.role === 'developer') return false;
              var origPerms = (core && core.ensureSectionPermissionSentinels)
                ? core.ensureSectionPermissionSentinels(tObj.role, tObj.permissions)
                : (Array.isArray(tObj.permissions) ? tObj.permissions : []);
              return JSON.stringify(draftPermsByEmpId[id].slice().sort()) !== JSON.stringify(origPerms.slice().sort());
            });
            var changedUiEmpIds = Object.keys(draftUiOverridesByEmpId).filter(function (id) {
              var tObj = employeesList.find(function (e) { return e.id === id; });
              if (!tObj || tObj.role === 'developer') return false;
              var origOv = (core && typeof core.normalizeUiOverrides === 'function') ? core.normalizeUiOverrides(tObj.uiOverrides || {}) : (tObj.uiOverrides || {});
              return JSON.stringify(draftUiOverridesByEmpId[id] || {}) !== JSON.stringify(origOv || {});
            });

            if (changedEmpIds.length === 0 && changedUiEmpIds.length === 0 && !statsChanged) {
              ctx.toast('لم يتم تغيير أي أقسام أو إعدادات عن الوضع الحالي.');
              closeModal();
              return;
            }

            for (var i = 0; i < changedEmpIds.length; i++) {
              var empId = changedEmpIds[i];
              var targetObj = employeesList.find(function (e) { return e.id === empId; });
              if (!targetObj || targetObj.role === 'developer') continue;
              var nextPerms = draftPermsByEmpId[empId];
              var updRes = await root.RGApi.callApi('updateEmployee', {
                employeeId: targetObj.id,
                name: targetObj.name,
                username: targetObj.username,
                phone: targetObj.phone || '',
                email: targetObj.email || '',
                jobTitle: targetObj.jobTitle || '',
                role: targetObj.role,
                status: targetObj.status || 'active',
                permissions: nextPerms,
                _spamChecked: true
              });
              if (!updRes || !updRes.success) {
                if (errEl) {
                  errEl.textContent = (updRes && updRes.message) || 'تعذر حفظ صلاحيات الأقسام للموظف.';
                  errEl.classList.remove('hidden');
                }
                return;
              }
              if (updRes.data && root.RGApp && typeof root.RGApp.upsertEmployeeInState === 'function') {
                root.RGApp.upsertEmployeeInState(updRes.data);
              }
            }

            for (var uIdx = 0; uIdx < changedUiEmpIds.length; uIdx++) {
              var uiEmpId = changedUiEmpIds[uIdx];
              var uiTarget = employeesList.find(function (e) { return e.id === uiEmpId; });
              if (!uiTarget || uiTarget.role === 'developer') continue;
              var nextOv = draftUiOverridesByEmpId[uiEmpId] || {};
              var ovRes = await root.RGApi.callApi('saveEmployeeUiOverrides', {
                employeeId: uiTarget.id,
                uiOverrides: nextOv,
                _spamChecked: true
              });
              if (!ovRes || !ovRes.success) {
                if (errEl) {
                  errEl.textContent = (ovRes && ovRes.message) || 'تعذر حفظ تخصيصات الواجهة للموظف.';
                  errEl.classList.remove('hidden');
                }
                return;
              }
              uiTarget.uiOverrides = nextOv;
              if (root.RGApp && typeof root.RGApp.upsertEmployeeInState === 'function') {
                root.RGApp.upsertEmployeeInState(Object.assign({}, uiTarget, { uiOverrides: nextOv }));
              }
            }

            if (statsChanged) {
              var nextStatsCfg = {
                excludedFromStatsEmployeeIds: nextExcludedIds,
                updatedAt: new Date().toISOString(),
                updatedBy: (realActor && realActor.name) || 'المبرمج'
              };
              var setRes = await root.RGApi.callApi('updateSettings', {
                stats_control_config: nextStatsCfg,
                _spamChecked: true
              });
              if (!setRes || !setRes.success) {
                if (errEl) {
                  errEl.textContent = (setRes && setRes.message) || 'تعذر حفظ إعدادات الظهور في الإحصائيات.';
                  errEl.classList.remove('hidden');
                }
                return;
              }
              var savedCfg = (setRes.data && setRes.data.stats_control_config) || nextStatsCfg;
              if (root.RGApp && typeof root.RGApp.setStatsControlConfig === 'function') {
                root.RGApp.setStatsControlConfig(savedCfg);
              }
            }

            if (root.RGApi && typeof root.RGApi.invalidateScopes === 'function') {
              root.RGApi.invalidateScopes(['employees', 'dashboard', 'reports', 'settings']);
            }
            if (root.RGApp && realActor) {
              var updatedCur = employeesList.find(function (e) { return e.id === realActor.id; });
              if (updatedCur && (draftPermsByEmpId[updatedCur.id] || draftUiOverridesByEmpId[updatedCur.id])) {
                var syncedUser = Object.assign({}, updatedCur, {
                  permissions: draftPermsByEmpId[updatedCur.id] || updatedCur.permissions,
                  uiOverrides: draftUiOverridesByEmpId[updatedCur.id] || updatedCur.uiOverrides
                });
                if (typeof root.RGApp.syncCurrentUserShell === 'function') root.RGApp.syncCurrentUserShell(syncedUser);
                if (typeof root.RGApp.applyUiSimplification === 'function') root.RGApp.applyUiSimplification(null, true);
              }
            }
            ctx.toast('تم حفظ إعدادات إظهار وإخفاء الأقسام والواجهة بنجاح.');
            closeModal();
            if (onSaved) onSaved();
          }, { spamAction: 'updateEmployee', spamSig: 'devSections:' + curEmp.id + ':' + (draftPermsByEmpId[curEmp.id] ? draftPermsByEmpId[curEmp.id].join(',') : '') + ':' + JSON.stringify(draftUiOverridesByEmpId[curEmp.id] || {}) });
        });
      }
    }

    drawSectionsModal();
  }

  function mountStatsControlPanel(hostEl, employees, ctx, opts) {
    if (!hostEl) return;
    var options = opts || {};
    var realActor = getRealActorForDevFeatures();
    if (!realActor || realActor.role !== 'developer') {
      hostEl.innerHTML = '';
      return;
    }

    var core = root.RGCrmCore;
    var roleLabels = (core && core.ROLE_LABELS && (core.ROLE_LABELS[ctx && ctx.lang] || core.ROLE_LABELS.ar)) || {};
    var list = (Array.isArray(employees) ? employees : []).slice();
    var curCfg = getStatsControlConfigFromApp(ctx);
    var excludedMap = {};
    curCfg.excludedFromStatsEmployeeIds.forEach(function (id) { excludedMap[id] = true; });
    var initialExcludedSnap = JSON.stringify(curCfg.excludedFromStatsEmployeeIds.slice().sort());

    var viewStatsMap = {};
    var initialViewMap = {};
    list.forEach(function (emp) {
      var canView = emp.role === 'developer'
        ? true
        : (core && typeof core.canEmployeeViewStatistics === 'function' ? core.canEmployeeViewStatistics(emp) : true);
      viewStatsMap[emp.id] = canView;
      initialViewMap[emp.id] = canView;
    });

    var searchQuery = '';

    function drawPanel() {
      var q = String(searchQuery || '').trim().toLowerCase();
      var activeList = list.filter(function (e) {
        if (!e) return false;
        if (!q) return true;
        return (String(e.name || '') + ' ' + String(e.username || '') + ' ' + String(e.jobTitle || '')).toLowerCase().indexOf(q) !== -1;
      });

      var totalEligible = list.filter(function (e) { return e && e.status !== 'disabled'; }).length;
      var appearCount = list.filter(function (e) { return e && e.status !== 'disabled' && !excludedMap[e.id]; }).length;
      var viewCount = list.filter(function (e) { return e && e.status !== 'disabled' && (e.role === 'developer' || viewStatsMap[e.id]); }).length;

      var rowsHtml = activeList.length === 0
        ? '<div class="empty-state" style="padding:18px;">لا يوجد موظفون مطابقون للبحث.</div>'
        : activeList.map(function (emp) {
          var isDev = emp.role === 'developer';
          var isExcluded = Boolean(excludedMap[emp.id]);
          var canView = isDev ? true : Boolean(viewStatsMap[emp.id]);
          var initialChar = String(emp.name || 'م').trim().charAt(0) || 'م';
          return '<div class="rg-stats-ctrl-row' + (isExcluded ? ' is-excluded' : '') + '" data-stats-emp-id="' + esc(emp.id) + '">' +
            '<div class="rg-stats-ctrl-person">' +
              '<span class="rg-stats-ctrl-avatar">' + esc(initialChar) + '</span>' +
              '<div style="min-width:0;">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<strong style="font-size:13px;color:var(--text-primary);">' + esc(emp.name) + '</strong>' +
                  '<span class="status-tag ' + (isDev ? 'status-danger' : 'status-neutral') + '">' + esc(roleLabels[emp.role] || emp.role) + '</span>' +
                  (emp.status === 'disabled' ? '<span class="status-tag status-warning">متوقف</span>' : '') +
                '</div>' +
                '<div style="font-size:11.5px;color:var(--text-muted);">' +
                  (isExcluded ? 'مخفي من لوحة الصدارة والرسوم' : 'ظاهر في تقارير ولوحة الأداء') +
                  (isDev ? ' · المبرمج يشاهد الإحصائيات دائماً' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="rg-stats-ctrl-toggles">' +
              renderSwitchMarkup('', 'stats-ctrl-appear-cb', 'data-emp-id="' + esc(emp.id) + '"', !isExcluded, false, 'يظهر في الإحصائيات') +
              renderSwitchMarkup('', 'stats-ctrl-view-cb', 'data-emp-id="' + esc(emp.id) + '"', canView, isDev, 'يشاهد الإحصائيات') +
            '</div>' +
          '</div>';
        }).join('');

      var saveBtnId = options.saveBtnId || 'btn-save-dev-stats-control';

      hostEl.innerHTML =
        '<div class="rg-stats-ctrl-toolbar">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:220px;">' +
            '<input type="search" class="input" id="stats-ctrl-search" value="' + esc(searchQuery) + '" placeholder="بحث باسم الموظف أو الدور..." style="max-width:260px;">' +
            '<span class="status-tag status-info tabular-nums" id="stats-ctrl-summary">ظاهر في الإحصائيات: ' + appearCount + ' / ' + totalEligible + ' · يشاهد الإحصائيات: ' + viewCount + ' / ' + totalEligible + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-sm" id="stats-preset-all">إظهار الجميع</button>' +
            '<button type="button" class="btn btn-sm" id="stats-preset-hide-admins">إخفاء المبرمج والمدير العام</button>' +
            '<button type="button" class="btn btn-sm" id="stats-preset-agents-only">خدمة العملاء فقط</button>' +
          '</div>' +
        '</div>' +
        '<div class="rg-stats-ctrl-list">' + rowsHtml + '</div>' +
        '<div id="stats-ctrl-err" class="form-error hidden" style="margin-top:10px;"></div>' +
        '<div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<span style="font-size:12px;color:var(--text-muted);">ملاحظة: إخفاء موظف من الإحصائيات يخفي اسمه من لوحة الصدارة ومخططات الأداء دون التأثير على إجمالي حجوزات الفرع أو الإيرادات.</span>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            (options.showCancel ? '<button type="button" class="btn" id="stats-ctrl-cancel-btn">إلغاء</button>' : '') +
            '<button type="button" class="btn btn-primary" id="' + esc(saveBtnId) + '">حفظ تحكم الإحصائيات</button>' +
          '</div>' +
        '</div>';

      var searchInput = hostEl.querySelector('#stats-ctrl-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          searchQuery = searchInput.value;
          var pos = searchInput.selectionStart || searchQuery.length;
          drawPanel();
          var nextIn = hostEl.querySelector('#stats-ctrl-search');
          if (nextIn) {
            nextIn.focus();
            try { nextIn.setSelectionRange(pos, pos); } catch (_p) {}
          }
        });
      }

      var presetAll = hostEl.querySelector('#stats-preset-all');
      if (presetAll) {
        presetAll.addEventListener('click', function () {
          excludedMap = {};
          list.forEach(function (e) { viewStatsMap[e.id] = true; });
          drawPanel();
        });
      }

      var presetHideAdmins = hostEl.querySelector('#stats-preset-hide-admins');
      if (presetHideAdmins) {
        presetHideAdmins.addEventListener('click', function () {
          excludedMap = {};
          list.forEach(function (e) {
            if (e.role === 'developer' || e.role === 'general_manager') {
              excludedMap[e.id] = true;
            }
          });
          drawPanel();
        });
      }

      var presetAgentsOnly = hostEl.querySelector('#stats-preset-agents-only');
      if (presetAgentsOnly) {
        presetAgentsOnly.addEventListener('click', function () {
          excludedMap = {};
          list.forEach(function (e) {
            if (e.role !== 'agent') excludedMap[e.id] = true;
          });
          drawPanel();
        });
      }

      hostEl.querySelectorAll('.stats-ctrl-appear-cb').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var eid = cb.getAttribute('data-emp-id');
          if (cb.checked) delete excludedMap[eid];
          else excludedMap[eid] = true;
          drawPanel();
        });
      });

      hostEl.querySelectorAll('.stats-ctrl-view-cb').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var eid = cb.getAttribute('data-emp-id');
          viewStatsMap[eid] = cb.checked;
          drawPanel();
        });
      });

      if (options.showCancel && typeof options.onCancel === 'function') {
        var cBtn = hostEl.querySelector('#stats-ctrl-cancel-btn');
        if (cBtn) cBtn.addEventListener('click', options.onCancel);
      }

      var saveBtn = hostEl.querySelector('#' + saveBtnId);
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var errEl = hostEl.querySelector('#stats-ctrl-err');
          if (errEl) errEl.classList.add('hidden');
          runWithLock(saveBtn, 'devStatsControlSave', async function () {
            var nextExcludedIds = Object.keys(excludedMap).filter(function (id) { return excludedMap[id]; }).sort();
            var settingsChanged = JSON.stringify(nextExcludedIds) !== initialExcludedSnap;
            var changedViewEmps = list.filter(function (e) {
              return e && e.role !== 'developer' && Boolean(viewStatsMap[e.id]) !== Boolean(initialViewMap[e.id]);
            });

            if (!settingsChanged && changedViewEmps.length === 0) {
              if (ctx && ctx.toast) ctx.toast('لم يتم إجراء أي تغييرات على إعدادات الإحصائيات.');
              if (typeof options.onSaved === 'function') options.onSaved();
              return;
            }

            if (settingsChanged) {
              var nextCfg = {
                excludedFromStatsEmployeeIds: nextExcludedIds,
                updatedAt: new Date().toISOString(),
                updatedBy: (realActor && realActor.name) || 'المبرمج'
              };
              var sRes = await root.RGApi.callApi('updateSettings', {
                stats_control_config: nextCfg,
                _spamChecked: true
              });
              if (!sRes || !sRes.success) {
                if (errEl) {
                  errEl.textContent = (sRes && sRes.message) || 'تعذر حفظ إعدادات الظهور في الإحصائيات.';
                  errEl.classList.remove('hidden');
                }
                return;
              }
              var savedCfg = (sRes.data && sRes.data.stats_control_config) || nextCfg;
              if (root.RGApp && typeof root.RGApp.setStatsControlConfig === 'function') {
                root.RGApp.setStatsControlConfig(savedCfg);
              }
              initialExcludedSnap = JSON.stringify(nextExcludedIds);
            }

            for (var idx = 0; idx < changedViewEmps.length; idx++) {
              var emp = changedViewEmps[idx];
              var wantView = Boolean(viewStatsMap[emp.id]);
              var nextPerms = (core && typeof core.applyEmployeeStatsViewToggle === 'function')
                ? core.applyEmployeeStatsViewToggle(emp.role, emp.permissions, wantView)
                : emp.permissions;
              var eRes = await root.RGApi.callApi('updateEmployee', {
                employeeId: emp.id,
                name: emp.name,
                username: emp.username,
                phone: emp.phone || '',
                email: emp.email || '',
                jobTitle: emp.jobTitle || '',
                role: emp.role,
                status: emp.status || 'active',
                permissions: nextPerms,
                _spamChecked: true
              });
              if (!eRes || !eRes.success) {
                if (errEl) {
                  errEl.textContent = (eRes && eRes.message) || ('تعذر تحديث صلاحية مشاهدة الإحصائيات للموظف: ' + emp.name);
                  errEl.classList.remove('hidden');
                }
                return;
              }
              emp.permissions = nextPerms;
              initialViewMap[emp.id] = wantView;
              if (eRes.data && root.RGApp && typeof root.RGApp.upsertEmployeeInState === 'function') {
                root.RGApp.upsertEmployeeInState(eRes.data);
              }
            }

            if (root.RGApi && typeof root.RGApi.invalidateScopes === 'function') {
              root.RGApi.invalidateScopes(['settings', 'dashboard', 'reports', 'employees']);
            }
            if (ctx && ctx.toast) ctx.toast('تم حفظ تحكم المبرمج في الإحصائيات وتطبيق التغييرات فوراً.');
            if (typeof options.onSaved === 'function') options.onSaved();
          }, { spamAction: 'updateSettings', spamSig: 'devStatsControl:' + Date.now() });
        });
      }
    }

    drawPanel();
  }

  async function openDeveloperStatsControlModal(ctx, onSaved) {
    var realActor = getRealActorForDevFeatures();
    if (!realActor || realActor.role !== 'developer') {
      if (ctx && ctx.toast) ctx.toast('قسم التحكم في الإحصائيات متاح لحساب المبرمج فقط.', true);
      return;
    }

    var employees = (root.RGApp && typeof root.RGApp.getEmployeesState === 'function')
      ? (root.RGApp.getEmployeesState().items || [])
      : [];
    if (!employees.length && root.RGApi) {
      var res = await root.RGApi.callApi('getEmployees', {});
      if (res && res.success && res.data && Array.isArray(res.data.items)) {
        employees = res.data.items;
        if (root.RGApp && typeof root.RGApp.syncEmployeesStateFromPayload === 'function') {
          root.RGApp.syncEmployeesStateFromPayload(res.data);
        }
      }
    }

    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="stats-ctrl-modal" role="dialog" aria-modal="true" aria-labelledby="stats-ctrl-modal-title">' +
        '<div class="modal-panel" style="max-width:780px;">' +
          '<div class="modal-header">' +
            '<div>' +
              '<h3 class="modal-title" id="stats-ctrl-modal-title">تحكم المبرمج في الإحصائيات — من يظهر ومن يشاهد</h3>' +
              '<p class="section-subtitle">حدّد أي الموظفين يظهر اسمه وأرقامه في لوحة الصدارة والتقارير، وأي الموظفين يحق له مشاهدة الإحصائيات.</p>' +
            '</div>' +
            '<button type="button" class="btn btn-sm" id="stats-ctrl-modal-close" data-modal-close>إغلاق</button>' +
          '</div>' +
          '<div id="stats-ctrl-modal-body"></div>' +
        '</div>' +
      '</div>';

    var closeModal = function () { modalRoot.innerHTML = ''; };
    document.getElementById('stats-ctrl-modal-close').addEventListener('click', closeModal);

    mountStatsControlPanel(document.getElementById('stats-ctrl-modal-body'), employees, ctx, {
      saveBtnId: 'stats-ctrl-modal-save',
      showCancel: true,
      onCancel: closeModal,
      onSaved: function () {
        closeModal();
        if (typeof onSaved === 'function') onSaved();
      }
    });
  }

  root.EmployeeManager = EmployeeManager;
  root.RGEmployees = {
    render: render,
    EmployeeManager: EmployeeManager,
    openEmployeeModal: openEmployeeModal,
    openEditDeveloperModal: openEditDeveloperModal,
    openEmployeeDetailsDrawer: openEmployeeDetailsDrawer,
    openBulkReassignModal: openBulkReassignModal,
    openEmployeeSectionsModal: openEmployeeSectionsModal,
    openDeveloperStatsControlModal: openDeveloperStatsControlModal,
    mountStatsControlPanel: mountStatsControlPanel
  };
})(window);
