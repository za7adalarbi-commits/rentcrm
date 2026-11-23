/**
 * RENTAL GATE CRM — Problems, Priorities, Supervisor Ticket Editing & ProblemUpdates Audit Trail
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

  function fmtMention(text, employees) {
    if (root.RGCrmMentions && root.RGCrmMentions.renderHighlightedText) {
      return root.RGCrmMentions.renderHighlightedText(text, employees, esc);
    }
    return esc(text);
  }

  function fmtDateTime(val, ctx) {
    if (!val) return '-';
    if (ctx && typeof ctx.formatDateTime === 'function') return ctx.formatDateTime(val) || '-';
    if (root.RGApp && typeof root.RGApp.formatDateTime === 'function') return root.RGApp.formatDateTime(val) || '-';
    if (root.RGCrmCore && root.RGCrmCore.formatDateTimePreference) {
      var tf = (root.RGApp && root.RGApp.getTimeFormat) ? root.RGApp.getTimeFormat() : '24h';
      return root.RGCrmCore.formatDateTimePreference(val, tf, (ctx && ctx.lang) || 'ar') || '-';
    }
    return String(val).replace('T', ' ').substring(0, 16);
  }

  function prioBadge(p) {
    if (p === 'مرتفع') return '<span class="status-tag status-danger">مرتفع</span>';
    if (p === 'متوسط') return '<span class="status-tag status-warning">متوسط</span>';
    return '<span class="status-tag status-neutral">عادي</span>';
  }

  function statusBadge(s) {
    if (s === 'تم الحل' || s === 'مغلقة') return '<span class="status-tag status-success">' + esc(s) + '</span>';
    if (s === 'جديدة') return '<span class="status-tag status-danger">' + esc(s) + '</span>';
    return '<span class="status-tag status-warning">' + esc(s) + '</span>';
  }

  function isClosedStatus(s) {
    return root.RGCrmCore && root.RGCrmCore.isProblemClosedStatus
      ? root.RGCrmCore.isProblemClosedStatus(s)
      : (s === 'مغلقة' || s === 'تم الحل');
  }

  function runWithLock(btnEl, lockKey, fn, opts) {
    if (root.RGApp && root.RGApp.withActionLock) {
      return root.RGApp.withActionLock(btnEl, lockKey, fn, opts);
    }
    return Promise.resolve().then(fn);
  }

  function syncProblemUpdateInBackground(payload, ctx, onErrorRefresh) {
    var reqPayload = Object.assign({ _keepOptimisticCache: true, _spamChecked: true }, payload);
    return root.RGApi.callApi('updateProblem', reqPayload).then(function (res) {
      if (res && res.success) {
        if (ctx && ctx.refreshNotifications) ctx.refreshNotifications();
      } else {
        if (ctx && ctx.toast) ctx.toast((res && res.message) || 'تعذر مزامنة تحديث المشكلة.', true);
        if (onErrorRefresh) onErrorRefresh();
      }
      return res;
    }).catch(function () {
      if (ctx && ctx.toast) ctx.toast('تعذر الاتصال بالخادم أثناء حفظ المشكلة.', true);
      if (onErrorRefresh) onErrorRefresh();
    });
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var state = ctx.state.problems || { status: '', priority: '', employeeId: '', search: '' };
    ctx.state.problems = state;

    var isEn = ctx.lang === 'en';
    var core = root.RGCrmCore || {};
    var currentUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var canViewPrbRates = !core.canUserViewSubSection || core.canUserViewSubSection(currentUser, 'sub_view_prb_rates');
    var canCloseTicketBtn = !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_close_delete_ticket');
    var RATES_VISIBLE_STORAGE_KEY = core.PROBLEM_RATE_VISIBILITY_STORAGE_KEY || 'rg_crm_problems_rate_visible_v1';
    var isRatesVisible = canViewPrbRates && (function () {
      if (typeof ctx.state.problemsRateVisible === 'boolean') return ctx.state.problemsRateVisible;
      try {
        var rawSaved = localStorage.getItem(RATES_VISIBLE_STORAGE_KEY);
        return core.normalizeProblemRateVisibility ? core.normalizeProblemRateVisibility(rawSaved) : (rawSaved !== 'false');
      } catch (_e) {
        return true;
      }
    })();
    ctx.state.problemsRateVisible = isRatesVisible;

    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps = Boolean(empState && empState.loaded && Array.isArray(empState.items) && empState.items.length > 0);
    var hasPrbFilter = Boolean(state.status || state.priority || state.employeeId || state.search);

    var [prbRes, empRes, resListRes, allPrbRes] = await Promise.all([
      root.RGApi.callApi('getProblems', Object.assign({}, state, { abortKey: 'prb:list' })),
      hasPreloadedEmps ? Promise.resolve({ success: true, data: { items: empState.items } }) : root.RGApi.callApi('getEmployees', {}),
      (canViewPrbRates && isRatesVisible) ? root.RGApi.callApi('getReservations', { page: 1, pageSize: 200, silentRefresh: true }) : Promise.resolve(null),
      (canViewPrbRates && isRatesVisible && hasPrbFilter)
        ? root.RGApi.callApi('getProblems', { silentRefresh: true })
        : Promise.resolve(null)
    ]);
    if (prbRes && prbRes.aborted) return;
    var prbLoadError = (!prbRes || !prbRes.success) ? ((prbRes && prbRes.message) || 'تعذر تحميل المشكلات.') : '';
    var items = (prbRes && prbRes.success && prbRes.data && prbRes.data.items) || [];
    var employees = (empRes.success && empRes.data && empRes.data.items) || [];
    var resItems = (resListRes && resListRes.success && resListRes.data && Array.isArray(resListRes.data.items)) ? resListRes.data.items : [];
    var allProblemsForRate = (allPrbRes && allPrbRes.success && allPrbRes.data && Array.isArray(allPrbRes.data.items)) ? allPrbRes.data.items : items;
    var ratesLoaded = Boolean(canViewPrbRates && isRatesVisible);

    function getToggleBtnHtml(visible) {
      var lbl = core.formatProblemRateToggleLabel
        ? core.formatProblemRateToggleLabel(visible, ctx.lang)
        : (isEn ? (visible ? 'Hide Problems / 100 Rate' : 'Show Problems / 100 Rate') : (visible ? 'إخفاء مؤشر نسبة المشكلات' : 'إظهار مؤشر نسبة المشكلات'));
      return '<span class="rg-rate-toggle-icon" aria-hidden="true">' + (visible ? '▾' : '▸') + '</span> ' +
        '<span class="rg-rate-toggle-text">' + esc(lbl) + '</span>';
    }

    container.innerHTML =
      (canViewPrbRates ? '<div class="surface-card rg-problem-rate-card' + (isRatesVisible ? '' : ' hidden') + '" id="prb-rates-card"></div>' : '') +
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div>' +
            '<h2 class="section-title">' + t('nav_problems') + '</h2>' +
            '<p class="section-subtitle">' + (isEn ? 'Matching problems total: ' : 'إجمالي المشكلات المطابقة: ') + '<strong class="tabular-nums" id="prb-total-count">' + items.length + '</strong></p>' +
          '</div>' +
          (canViewPrbRates ? (
            '<div class="toolbar-row" style="margin-bottom:0;">' +
              '<button type="button" class="btn btn-sm rg-rate-toggle-btn' + (isRatesVisible ? ' is-visible' : '') + '" id="prb-toggle-rates-btn" aria-expanded="' + (isRatesVisible ? 'true' : 'false') + '" aria-controls="prb-rates-card">' +
                getToggleBtnHtml(isRatesVisible) +
              '</button>' +
            '</div>'
          ) : '') +
        '</div>' +
        '<div class="filter-grid">' +
          '<input type="search" class="input" id="prb-search" placeholder="بحث برقم المشكلة أو الحجز أو العميل..." value="' + esc(state.search || '') + '">' +
          '<select class="select" id="prb-status" aria-label="حالة المشكلة"><option value="">جميع الحالات</option>' +
            root.RGCrmCore.PROBLEM_STATUSES.map(function (s) { return '<option value="' + esc(s) + '"' + (state.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
          '</select>' +
          '<select class="select" id="prb-prio" aria-label="الأولوية"><option value="">جميع الأولويات</option>' +
            root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + esc(p) + '"' + (state.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
          '</select>' +
          '<select class="select" id="prb-emp" aria-label="المسؤول"><option value="">جميع الموظفين</option>' +
            employees.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.employeeId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') +
          '</select>' +
          '<button type="button" class="btn btn-sm" id="prb-reset">إعادة ضبط</button>' +
        '</div>' +
        '<div id="prb-table-region"></div>' +
      '</div>';

    var activePrbSeq = 0;

    async function ensureRatesLoadedAndPaint() {
      if (ratesLoaded) {
        paintProblemRatesCard(allProblemsForRate);
        return;
      }
      var [rRes, pAllRes] = await Promise.all([
        root.RGApi.callApi('getReservations', { page: 1, pageSize: 200, silentRefresh: true }),
        (state.status || state.priority || state.employeeId || state.search)
          ? root.RGApi.callApi('getProblems', { silentRefresh: true })
          : Promise.resolve(null)
      ]);
      if (!container.isConnected) return;
      resItems = (rRes && rRes.success && rRes.data && Array.isArray(rRes.data.items)) ? rRes.data.items : [];
      allProblemsForRate = (pAllRes && pAllRes.success && pAllRes.data && Array.isArray(pAllRes.data.items)) ? pAllRes.data.items : items;
      ratesLoaded = true;
      paintProblemRatesCard(allProblemsForRate);
    }

    function setRatesVisible(nextVisible) {
      isRatesVisible = Boolean(nextVisible);
      ctx.state.problemsRateVisible = isRatesVisible;
      try {
        localStorage.setItem(RATES_VISIBLE_STORAGE_KEY, isRatesVisible ? 'true' : 'false');
      } catch (_e) {}
      var rateCardEl = container.querySelector('#prb-rates-card');
      if (rateCardEl) {
        rateCardEl.classList.toggle('hidden', !isRatesVisible);
      }
      var toggleBtnEl = container.querySelector('#prb-toggle-rates-btn');
      if (toggleBtnEl) {
        toggleBtnEl.setAttribute('aria-expanded', isRatesVisible ? 'true' : 'false');
        toggleBtnEl.classList.toggle('is-visible', isRatesVisible);
        toggleBtnEl.innerHTML = getToggleBtnHtml(isRatesVisible);
      }
      if (isRatesVisible && !ratesLoaded) {
        ensureRatesLoadedAndPaint().catch(function () {});
      }
    }

    var toggleRatesBtn = container.querySelector('#prb-toggle-rates-btn');
    if (toggleRatesBtn) {
      toggleRatesBtn.addEventListener('click', function () {
        setRatesVisible(!isRatesVisible);
      });
    }

    function paintProblemRatesCard(prbSourceList) {
      var rateHost = container.querySelector('#prb-rates-card');
      if (!rateHost) return;
      rateHost.classList.toggle('hidden', !isRatesVisible);
      var metrics = (root.RGCrmCore && root.RGCrmCore.computeProblemsPer100Bookings)
        ? root.RGCrmCore.computeProblemsPer100Bookings(resItems, prbSourceList || allProblemsForRate)
        : { overall: { totalBookings: 0, problemsCount: 0, openProblemsCount: 0, resolvedProblemsCount: 0, ratePer100: 0, severity: 'normal' }, byCompany: [], byBranch: [] };
      var ov = metrics.overall;
      rateHost.innerHTML =
        '<div class="section-header" style="margin-bottom:12px;">' +
          '<div>' +
            '<h3 class="section-title">' + (isEn ? 'Problems per 100 Bookings Indicator' : 'مؤشر نسبة المشكلات لكل 100 حجز (حسب الشركة والفرع)') + '</h3>' +
            '<p class="section-subtitle">' + (isEn ? 'Overall rate: ' : 'المعدل العام: ') + '<strong class="tabular-nums">' + ov.ratePer100 + '</strong> ' + (isEn ? 'problems / 100 bookings' : 'مشكلة / 100 حجز') + ' (<span class="tabular-nums">' + ov.problemsCount + ' / ' + ov.totalBookings + '</span>)</p>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span class="rg-rate-badge is-' + esc(ov.severity) + ' tabular-nums" dir="ltr">' + ov.ratePer100 + ' / 100</span>' +
            '<button type="button" class="btn btn-sm rg-rate-hide-inline-btn" id="prb-hide-rates-inline-btn" title="' + (isEn ? 'Hide indicator' : 'إخفاء مؤشر نسبة المشكلات') + '">' +
              (isEn ? 'Hide' : 'إخفاء') +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="rg-rate-split-grid">' +
          '<div class="rg-rate-panel">' +
            '<h4 class="rg-rate-panel-title">' + (isEn ? 'By Company' : 'أعلى الشركات نسبةً للمشكلات') + '</h4>' +
            (metrics.byCompany.length === 0
              ? '<div class="empty-state" style="padding:12px;">' + (isEn ? 'Insufficient data.' : 'لا توجد بيانات كافية.') + '</div>'
              : '<div class="rg-rate-list">' + metrics.byCompany.slice(0, 5).map(function (c) {
                  return '<div class="rg-rate-row">' +
                    '<div><strong>' + esc(c.companyName) + '</strong><div class="cell-sub tabular-nums">' +
                      (isEn ? (c.problemsCount + ' problems / ' + c.totalBookings + ' bookings') : (c.problemsCount + ' مشكلة من ' + c.totalBookings + ' حجز')) +
                    '</div></div>' +
                    '<span class="rg-rate-badge is-' + esc(c.severity) + ' tabular-nums" dir="ltr">' + c.ratePer100 + ' / 100</span>' +
                  '</div>';
                }).join('') + '</div>') +
          '</div>' +
          '<div class="rg-rate-panel">' +
            '<h4 class="rg-rate-panel-title">' + (isEn ? 'By Branch' : 'أعلى الفروع نسبةً للمشكلات') + '</h4>' +
            (metrics.byBranch.length === 0
              ? '<div class="empty-state" style="padding:12px;">' + (isEn ? 'Insufficient data.' : 'لا توجد بيانات كافية.') + '</div>'
              : '<div class="rg-rate-list">' + metrics.byBranch.slice(0, 5).map(function (b) {
                  return '<div class="rg-rate-row">' +
                    '<div><strong>' + esc(b.branchName) + '</strong><div class="cell-sub">' + esc(b.companyName) + ' · <span class="tabular-nums">' + b.problemsCount + ' / ' + b.totalBookings + '</span></div></div>' +
                    '<span class="rg-rate-badge is-' + esc(b.severity) + ' tabular-nums" dir="ltr">' + b.ratePer100 + ' / 100</span>' +
                  '</div>';
                }).join('') + '</div>') +
          '</div>' +
        '</div>';

      var inlineHideBtn = rateHost.querySelector('#prb-hide-rates-inline-btn');
      if (inlineHideBtn) {
        inlineHideBtn.addEventListener('click', function () {
          setRatesVisible(false);
        });
      }
    }

    function filterAndApplyLocalProblem(updatedPrb) {
      if (!updatedPrb) return;
      allProblemsForRate = allProblemsForRate.map(function (x) { return x.id === updatedPrb.id ? updatedPrb : x; });
      items = items.map(function (x) { return x.id === updatedPrb.id ? updatedPrb : x; });
      if (state.status) {
        items = items.filter(function (x) { return x.status === state.status; });
      }
      if (state.priority) {
        items = items.filter(function (x) { return x.priority === state.priority; });
      }
      if (isRatesVisible) paintProblemRatesCard(allProblemsForRate);
      paintProblemsRegion(items);
    }

    function paintProblemsError(msg) {
      var region = container.querySelector('#prb-table-region');
      if (!region) return;
      region.innerHTML =
        '<div class="rg-error-banner" role="alert">' +
          '<div class="rg-error-banner-body">' +
            '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load problems' : 'تعذر تحميل قائمة المشكلات') + '</div>' +
            '<div class="rg-error-banner-msg">' + esc(msg || 'تعذر تحميل المشكلات.') + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-primary" id="prb-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
        '</div>';
      var pRetry = document.getElementById('prb-retry-btn');
      if (pRetry) pRetry.addEventListener('click', function () { refreshProblemsRegion({ forceRefresh: true }); });
    }

    function paintProblemsRegion(list) {
      items = list || [];
      var countEl = container.querySelector('#prb-total-count');
      if (countEl) countEl.textContent = String(items.length);
      var region = container.querySelector('#prb-table-region');
      if (!region) return;
      region.innerHTML = items.length === 0
        ? '<div class="empty-state">لا توجد مشكلات مطابقة للفلاتر الحالية.</div>'
        : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>رقم المشكلة</th><th>رقم الحجز</th><th>العميل</th><th>الوصف</th><th>الأولوية</th><th>الحالة</th><th>المنشئ</th><th>المسؤولون</th><th>آخر تحديث</th><th>إدارة</th>' +
          '</tr></thead><tbody>' +
            items.map(function (p) {
              var closed = isClosedStatus(p.status);
              return '<tr data-prb-row="' + esc(p.id) + '">' +
                '<td class="mono" style="white-space:nowrap;" dir="ltr"><strong>' + esc(p.problemNumber) + '</strong></td>' +
                '<td class="mono" style="white-space:nowrap;"><button type="button" class="btn-link-inline prb-open-res" dir="ltr" data-res-id="' + esc(p.reservationId) + '">' + esc(p.reservationNumber) + '</button></td>' +
                '<td>' + esc(p.customerName) + '</td>' +
                '<td style="max-width:260px;">' + fmtMention(p.description, employees) + '</td>' +
                '<td>' + prioBadge(p.priority) + '</td>' +
                '<td>' + statusBadge(p.status) + '</td>' +
                '<td>' + esc(p.createdByName) + '</td>' +
                '<td>' + esc((p.assignedEmployeeNames || []).join('، ') || '-') + '</td>' +
                '<td class="mono tabular-nums" dir="ltr" style="white-space:nowrap;">' + esc(fmtDateTime(p.updatedAt, ctx)) + '</td>' +
                '<td><div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">' +
                  '<button type="button" class="btn btn-sm btn-primary btn-manage-prb" data-id="' + esc(p.id) + '">متابعة / تحديث</button>' +
                  ((!closed && canCloseTicketBtn) ? '<button type="button" class="btn btn-sm btn-danger btn-close-prb" data-id="' + esc(p.id) + '">إغلاق المشكلة</button>' : '') +
                '</div></td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>';

      region.querySelectorAll('.prb-open-res').forEach(function (btn) {
        btn.addEventListener('click', function () {
          root.RGReservations.openReservationDrawer(btn.getAttribute('data-res-id'), ctx, employees, function () {
            refreshProblemsRegion();
          });
        });
      });

      region.querySelectorAll('.btn-manage-prb').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = items.find(function (x) { return x.id === btn.getAttribute('data-id'); });
          if (p) {
            openProblemUpdateModal(p, employees, ctx, function (optUpdated) {
              if (optUpdated) filterAndApplyLocalProblem(optUpdated);
              else refreshProblemsRegion();
            });
          }
        });
      });

      region.querySelectorAll('.btn-close-prb').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pid = btn.getAttribute('data-id');
          var p = items.find(function (x) { return x.id === pid; });
          if (!p) return;
          runWithLock(btn, 'updateProblem:' + pid, function () {
            var prevItems = items.slice();
            var prevAllProblems = allProblemsForRate.slice();
            var closePayload = {
              problemId: pid,
              expectedUpdatedAt: p.updatedAt || '',
              status: 'مغلقة',
              priority: p.priority || 'متوسط',
              note: 'تم إغلاق المشكلة'
            };
            var user = root.RGAuth.getUser();
            if (root.RGApi.applyOptimisticMutation) {
              root.RGApi.applyOptimisticMutation('updateProblem', closePayload, user);
            }
            var optUpdated = root.RGCrmCore && root.RGCrmCore.applyOptimisticProblemPatch
              ? root.RGCrmCore.applyOptimisticProblemPatch(p, closePayload, user, employees)
              : Object.assign({}, p, { status: 'مغلقة' });
            filterAndApplyLocalProblem(optUpdated);
            ctx.toast('تم إغلاق المشكلة ' + p.problemNumber + ' بنجاح.');
            return syncProblemUpdateInBackground(closePayload, ctx, function () {
              items = prevItems;
              allProblemsForRate = prevAllProblems;
              paintProblemsRegion(items);
              if (isRatesVisible) paintProblemRatesCard(allProblemsForRate);
              refreshProblemsRegion({ forceRefresh: true, silentRefresh: true });
            });
          }, { spamAction: 'updateProblem', spamSig: pid + ':مغلقة' });
        });
      });
    }

    async function refreshProblemsRegion(opts) {
      var seq = ++activePrbSeq;
      var region = container.querySelector('#prb-table-region');
      if (region && !(opts && opts.silentRefresh) && items.length === 0) {
        region.innerHTML = '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
      }
      var resp = await root.RGApi.callApi('getProblems', Object.assign({}, state, {
        forceRefresh: Boolean(opts && opts.forceRefresh),
        silentRefresh: Boolean(opts && opts.silentRefresh),
        abortKey: 'prb:list'
      }));
      if (seq !== activePrbSeq || !container.isConnected) return;
      if (resp && resp.aborted) return;
      if (resp && resp.success && resp.data) {
        paintProblemsRegion(resp.data.items || []);
        if (!state.status && !state.priority && !state.employeeId && !state.search) {
          allProblemsForRate = resp.data.items || [];
          if (isRatesVisible) paintProblemRatesCard(allProblemsForRate);
        }
      } else if (!(opts && opts.silentRefresh) || items.length === 0) {
        paintProblemsError((resp && resp.message) || 'تعذر تحميل المشكلات.');
      }
    }

    if (isRatesVisible) paintProblemRatesCard(allProblemsForRate);
    if (prbLoadError) {
      paintProblemsError(prbLoadError);
    } else {
      paintProblemsRegion(items);
    }

    var searchTimer = null;
    document.getElementById('prb-search').addEventListener('input', function (ev) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = ev.target.value;
        refreshProblemsRegion();
      }, 220);
    });

    ['prb-status', 'prb-prio', 'prb-emp'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        state.status = document.getElementById('prb-status').value;
        state.priority = document.getElementById('prb-prio').value;
        state.employeeId = document.getElementById('prb-emp').value;
        refreshProblemsRegion();
      });
    });

    document.getElementById('prb-reset').addEventListener('click', function () {
      state.status = ''; state.priority = ''; state.employeeId = ''; state.search = '';
      document.getElementById('prb-search').value = '';
      document.getElementById('prb-status').value = '';
      document.getElementById('prb-prio').value = '';
      document.getElementById('prb-emp').value = '';
      refreshProblemsRegion();
    });

    if (!container._rgPrbDeltaBound) {
      container._rgPrbDeltaBound = true;
      var onPrbDelta = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onPrbDelta);
          return;
        }
        var d = (ev && ev.detail) || {};
        var relevant = Boolean(
          (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
          (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
          (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
          (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
          (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
          Boolean(d.deletedAllReservationsBefore) ||
          Boolean(d.changedSettings)
        );
        if (!relevant) return;
        var activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)) {
          if (!container._rgPendingPrbDelta) {
            container._rgPendingPrbDelta = true;
            container.addEventListener('focusout', function onBlurPrbDelta() {
              setTimeout(function () {
                if (!container || !container.isConnected) return;
                var curAct = document.activeElement;
                if (curAct && container.contains(curAct) && /^(INPUT|TEXTAREA|SELECT)$/.test(curAct.tagName)) {
                  container.addEventListener('focusout', onBlurPrbDelta, { once: true });
                  return;
                }
                container._rgPendingPrbDelta = false;
                refreshProblemsRegion({ silentRefresh: true, forceRefresh: true }).catch(function () {});
              }, 120);
            }, { once: true });
          }
          return;
        }
        refreshProblemsRegion({ silentRefresh: true, forceRefresh: true }).catch(function () {});
      };
      document.addEventListener('rg:deltasync', onPrbDelta);
    }
  }

  function openProblemUpdateModal(problem, employees, ctx, onSaved, onCancel) {
    var user = root.RGAuth.getUser();
    var canEditTicket = Boolean(user && root.RGCrmCore.canUserPerform(user, 'edit_ticket_details'));
    var canCloseTicketModalBtn = !root.RGCrmCore || !root.RGCrmCore.canUserUseActionButton || root.RGCrmCore.canUserUseActionButton(user, 'act_close_delete_ticket');
    var modalRoot = document.getElementById('modal-root');
    var empList = Array.isArray(employees) && employees.length ? employees.slice() : [];
    if (!empList.length && root.RGApp && root.RGApp.getEmployeesState) {
      var empSt = root.RGApp.getEmployeesState();
      if (empSt && Array.isArray(empSt.items) && empSt.items.length) empList = empSt.items.slice();
    }
    if (!empList.length && root.RGApi && root.RGApi.getCachedData) {
      var empCached = root.RGApi.getCachedData('getEmployees', {}, true);
      if (empCached && Array.isArray(empCached.items) && empCached.items.length) empList = empCached.items.slice();
    }
    var isAlreadyClosed = isClosedStatus(problem.status);

    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="prb-upd-backdrop" role="dialog" aria-modal="true" aria-labelledby="prb-upd-title">' +
        '<form class="modal-panel" id="prb-upd-form">' +
          '<div class="modal-header">' +
            '<div><h3 class="modal-title mono" id="prb-upd-title">' + esc(problem.problemNumber) + ' — حجز ' + esc(problem.reservationNumber) + '</h3>' +
            '<div class="meta-inline"><span>' + esc(problem.customerName) + '</span><span>·</span><span>أنشئت بواسطة: ' + esc(problem.createdByName || '-') + '</span><span>·</span>' + statusBadge(problem.status) + ' ' + prioBadge(problem.priority) + '</div></div>' +
            '<button type="button" class="btn btn-sm" id="prb-upd-close">إغلاق النافذة</button>' +
          '</div>' +
          (canEditTicket
            ? '<div class="form-grid-2">' +
                '<div class="form-group"><label class="form-label" for="pu-customer">اسم العميل في التذكرة</label><input class="input" id="pu-customer" value="' + esc(problem.customerName) + '" required></div>' +
                '<div class="form-group"><label class="form-label" for="pu-status">الحالة</label><select class="select" id="pu-status">' +
                  root.RGCrmCore.PROBLEM_STATUSES.map(function (s) {
                    return '<option value="' + esc(s) + '"' + (problem.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                  }).join('') +
                '</select></div>' +
              '</div>' +
              '<div class="form-group"><label class="form-label" for="pu-desc">بيانات ووصف التذكرة</label><textarea class="textarea" id="pu-desc" required>' + esc(problem.description) + '</textarea></div>' +
              '<div class="form-group"><label class="form-label" for="pu-prio">الأولوية</label><select class="select" id="pu-prio">' +
                root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) {
                  return '<option value="' + esc(p) + '"' + (problem.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>';
                }).join('') +
              '</select></div>'
            : '<p style="margin:0;padding:12px;background:var(--bg-surface-subtle);border:1px solid var(--border-hairline);border-radius:var(--radius-sm);">' + fmtMention(problem.description, empList) + '</p>' +
              '<div class="form-grid-2">' +
                '<div class="form-group"><label class="form-label" for="pu-status">الحالة</label><select class="select" id="pu-status">' +
                  root.RGCrmCore.PROBLEM_STATUSES.map(function (s) {
                    return '<option value="' + esc(s) + '"' + (problem.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                  }).join('') +
                '</select></div>' +
                '<div class="form-group"><label class="form-label" for="pu-prio">الأولوية</label><select class="select" id="pu-prio">' +
                  root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) {
                    return '<option value="' + esc(p) + '"' + (problem.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>';
                  }).join('') +
                '</select></div>' +
              '</div>') +
          (empList.length ? (
            '<div class="form-group"><span class="form-label">الموظفون المشاركون في المعالجة</span><div class="checkbox-grid">' +
              empList.filter(function (e) { return e.status === 'active'; }).map(function (emp) {
                var chk = (problem.assignedEmployeeIds || []).indexOf(emp.id) !== -1 ? 'checked' : '';
                return '<label class="checkbox-item"><input type="checkbox" class="pu-emp-chk" value="' + esc(emp.id) + '" ' + chk + '> ' + esc(emp.name) + '</label>';
              }).join('') +
            '</div></div>'
          ) : '') +
          '<div class="form-group"><label class="form-label" for="pu-note">ملاحظة التحديث (اختيارية)</label>' +
            '<textarea class="textarea" id="pu-note" placeholder="سجّل تفاصيل الإجراء المتخذ (اختياري)..."></textarea></div>' +
          '<div><h4 style="margin:0 0 8px;font-size:13.5px;">سجل التعديلات (ProblemUpdates)</h4>' +
            '<div class="timeline-list">' +
              ((problem.updates || []).map(function (u) {
                return '<div class="timeline-item">' +
                  '<div style="display:flex;justify-content:space-between;gap:8px;"><strong>' + esc(u.employeeName) + '</strong><span class="mono" dir="ltr" style="font-size:11.5px;color:var(--text-muted);">' + esc(fmtDateTime(u.createdAt, ctx)) + '</span></div>' +
                  '<div style="font-size:12.5px;">الحالة: ' + esc(u.previousStatus || '-') + ' ← <strong>' + esc(u.newStatus) + '</strong> | الأولوية: ' + esc(u.previousPriority || '-') + ' ← <strong>' + esc(u.newPriority) + '</strong></div>' +
                  '<div>' + fmtMention(u.note, empList) + '</div>' +
                '</div>';
              }).join('') || '<div class="empty-state" style="padding:12px;">لا توجد تحديثات إضافية.</div>') +
            '</div>' +
          '</div>' +
          '<div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              ((!isAlreadyClosed && canCloseTicketModalBtn) ? '<button type="button" class="btn btn-danger" id="prb-close-ticket-btn">إغلاق المشكلة</button>' : '') +
              '<button type="button" class="btn" id="prb-open-res-btn">فتح الحجز المرتبط</button>' +
            '</div>' +
            '<button type="submit" class="btn btn-primary" id="prb-save-ticket-btn">' + (canEditTicket ? 'حفظ التذكرة والتحديث' : 'حفظ التحديث') + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    if (root.RGCrmMentions && root.RGCrmMentions.attach) {
      var getPool = function () { return empList; };
      if (canEditTicket) root.RGCrmMentions.attach(document.getElementById('pu-desc'), getPool);
      root.RGCrmMentions.attach(document.getElementById('pu-note'), getPool);
    }

    var handledSubmit = false;

    function snapshotPrbForm() {
      var stEl = document.getElementById('pu-status');
      var prEl = document.getElementById('pu-prio');
      var custEl = document.getElementById('pu-customer');
      var descEl = document.getElementById('pu-desc');
      var emps = Array.from(modalRoot.querySelectorAll('.pu-emp-chk:checked')).map(function (c) { return c.value; }).sort();
      return JSON.stringify({
        status: stEl ? stEl.value : '',
        priority: prEl ? prEl.value : '',
        customer: custEl ? String(custEl.value || '').trim() : '',
        description: descEl ? String(descEl.value || '').trim() : '',
        emps: emps
      });
    }
    var initialPrbSnapshot = snapshotPrbForm();

    function closeModalNow() {
      if (root.RGApp && typeof root.RGApp.clearUnsavedGuard === 'function') {
        root.RGApp.clearUnsavedGuard();
      } else if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
        root.RGApp.setUnsavedGuard(null);
      }
      modalRoot.innerHTML = '';
    }

    function requestPrbClose() {
      var proceed = function () {
        if (onCancel) {
          closeModalNow();
          onCancel();
        } else {
          closeModalNow();
        }
      };
      if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
        root.RGApp.requestCloseWithGuard(proceed);
      } else {
        proceed();
      }
    }

    document.getElementById('prb-upd-close').addEventListener('click', requestPrbClose);

    var openResBtn = document.getElementById('prb-open-res-btn');
    if (openResBtn && problem.reservationId && root.RGReservations && root.RGReservations.openReservationDrawer) {
      openResBtn.addEventListener('click', function () {
        var proceedRes = function () {
          closeModalNow();
          root.RGReservations.openReservationDrawer(problem.reservationId, ctx, empList, onSaved);
        };
        if (root.RGApp && typeof root.RGApp.requestCloseWithGuard === 'function') {
          root.RGApp.requestCloseWithGuard(proceedRes);
        } else {
          proceedRes();
        }
      });
    }

    function submitProblemUpdate(forceCloseStatus, triggerBtn) {
      if (handledSubmit) return false;

      var selectedEmpIds = empList.length
        ? Array.from(modalRoot.querySelectorAll('.pu-emp-chk:checked')).map(function (c) { return c.value; })
        : (Array.isArray(problem.assignedEmployeeIds) ? problem.assignedEmployeeIds.slice() : []);

      var nextStatus = forceCloseStatus || document.getElementById('pu-status').value;
      var nextPrio = document.getElementById('pu-prio').value;
      var rawNote = String(document.getElementById('pu-note').value || '').trim();
      var noteVal = rawNote || (nextStatus === 'مغلقة' ? 'تم إغلاق المشكلة' : '');

      var payload = {
        problemId: problem.id,
        expectedUpdatedAt: problem.updatedAt || '',
        status: nextStatus,
        priority: nextPrio,
        assignedEmployeeIds: selectedEmpIds,
        note: noteVal
      };
      if (canEditTicket) {
        payload.customerName = document.getElementById('pu-customer').value;
        payload.description = document.getElementById('pu-desc').value;
      }

      runWithLock(triggerBtn, 'updateProblem:' + problem.id, function () {
        handledSubmit = true;
        // Close immediately after save/close action
        closeModalNow();

        if (root.RGApi.applyOptimisticMutation) {
          root.RGApi.applyOptimisticMutation('updateProblem', payload, user);
        }
        var optUpdated = root.RGCrmCore && root.RGCrmCore.applyOptimisticProblemPatch
          ? root.RGCrmCore.applyOptimisticProblemPatch(problem, payload, user, empList)
          : Object.assign({}, problem, payload);

        if (onSaved) onSaved(optUpdated);
        if (ctx && ctx.toast) {
          ctx.toast(nextStatus === 'مغلقة' ? 'تم إغلاق المشكلة بنجاح.' : 'تم تحديث التذكرة وتسجيل التعديل بنجاح.');
        }

        return syncProblemUpdateInBackground(payload, ctx, function () {
          if (onSaved) onSaved(null);
        });
      }, { spamAction: 'updateProblem', spamSig: problem.id + ':' + nextStatus + ':' + nextPrio + ':' + noteVal });
      return true;
    }

    if (root.RGApp && typeof root.RGApp.setUnsavedGuard === 'function') {
      root.RGApp.setUnsavedGuard({
        label: 'تحديث المشكلة ' + (problem.problemNumber || ''),
        isDirty: function () {
          if (handledSubmit) return false;
          var formEl = document.getElementById('prb-upd-form');
          if (!formEl) return false;
          var noteEl = document.getElementById('pu-note');
          if (noteEl && String(noteEl.value || '').trim().length > 0) return true;
          return snapshotPrbForm() !== initialPrbSnapshot;
        },
        onSave: function () {
          return submitProblemUpdate('', document.getElementById('prb-save-ticket-btn'));
        },
        onDiscard: function () {
          if (onCancel) {
            closeModalNow();
            onCancel();
          } else {
            closeModalNow();
          }
        }
      });
    }

    var closeTicketBtn = document.getElementById('prb-close-ticket-btn');
    if (closeTicketBtn) {
      closeTicketBtn.addEventListener('click', function () {
        submitProblemUpdate('مغلقة', closeTicketBtn);
      });
    }

    document.getElementById('prb-upd-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitProblemUpdate('', document.getElementById('prb-save-ticket-btn'));
    });
  }

  async function openProblemById(problemId, ctx, onSaved) {
    var targetId = String(problemId || '').trim();
    if (!targetId) return;

    var cachedEmp = root.RGApi.getCachedData ? root.RGApi.getCachedData('getEmployees', {}, true) : null;
    var cachedPrb = root.RGApi.findCachedProblem ? root.RGApi.findCachedProblem(targetId) : null;

    if (cachedPrb) {
      var cachedEmployees = (cachedEmp && Array.isArray(cachedEmp.items)) ? cachedEmp.items : [];
      openProblemUpdateModal(cachedPrb, cachedEmployees, ctx, onSaved);
      if (!cachedEmployees.length) {
        root.RGApi.callApi('getEmployees', {}).catch(function () {});
      }
      return;
    }

    var modalRoot = document.getElementById('modal-root');
    if (modalRoot) {
      modalRoot.innerHTML =
        '<div class="modal-backdrop" role="dialog" aria-modal="true">' +
          '<div class="modal-panel" style="max-width:420px;text-align:center;padding:28px;">' +
            '<div style="font-weight:700;margin-bottom:8px;">جاري فتح تفاصيل المشكلة...</div>' +
            '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">يتم جلب بيانات التذكرة من الخادم</div>' +
            '<button type="button" class="btn btn-sm" id="prb-loading-cancel">إلغاء</button>' +
          '</div>' +
        '</div>';
      var cancelBtn = document.getElementById('prb-loading-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { modalRoot.innerHTML = ''; });
    }

    var [detailRes, empRes] = await Promise.all([
      root.RGApi.callApi('getProblemDetails', { problemId: targetId }),
      cachedEmp ? Promise.resolve({ success: true, data: cachedEmp }) : root.RGApi.callApi('getEmployees', {})
    ]);

    var employees = (empRes && empRes.success && empRes.data && empRes.data.items) || [];
    var foundProblem = (detailRes && detailRes.success && detailRes.data && detailRes.data.problem) || null;

    if (!foundProblem) {
      var listRes = await root.RGApi.callApi('getProblems', {});
      if (listRes && listRes.success && listRes.data && Array.isArray(listRes.data.items)) {
        foundProblem = listRes.data.items.find(function (p) { return p.id === targetId || p.problemNumber === targetId; }) || null;
      }
    }

    if (!foundProblem) {
      if (modalRoot) modalRoot.innerHTML = '';
      if (ctx && ctx.toast) ctx.toast('تعذر العثور على تفاصيل المشكلة المطلوبة.', true);
      return;
    }

    openProblemUpdateModal(foundProblem, employees, ctx, onSaved);
  }

  root.RGProblems = {
    render: render,
    openProblemUpdateModal: openProblemUpdateModal,
    openProblemById: openProblemById
  };
})(window);
