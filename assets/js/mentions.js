(function (root) {
  'use strict';

  var portalEl = null;
  var activeState = null;

  function ensurePortal() {
    if (portalEl && portalEl.isConnected) return portalEl;
    portalEl = document.getElementById('rg-mention-portal');
    if (!portalEl) {
      portalEl = document.createElement('div');
      portalEl.id = 'rg-mention-portal';
      portalEl.className = 'rg-mention-popover';
      portalEl.setAttribute('role', 'listbox');
      portalEl.hidden = true;
      document.body.appendChild(portalEl);
    }
    return portalEl;
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function roleBadgeLabel(emp) {
    if (emp && emp.jobTitle) return emp.jobTitle;
    var core = root.RGCrmCore;
    if (core && core.ROLE_LABELS && emp && emp.role) {
      var lang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
      var dict = core.ROLE_LABELS[lang] || core.ROLE_LABELS.ar || {};
      if (dict[emp.role]) return dict[emp.role];
    }
    return '';
  }

  function closePortal() {
    if (portalEl) {
      portalEl.hidden = true;
      portalEl.innerHTML = '';
    }
    activeState = null;
  }

  function findActiveTrigger(el) {
    if (!el || typeof el.value !== 'string') return null;
    var caret = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    var beforeCaret = el.value.slice(0, caret);
    var atIdx = beforeCaret.lastIndexOf('@');
    if (atIdx === -1) return null;
    if (atIdx > 0 && !/[\s,،.(:;\[{"'«\-\n\r]/.test(beforeCaret.charAt(atIdx - 1))) {
      return null;
    }
    var query = beforeCaret.slice(atIdx + 1);
    if (/[\n\r@]/.test(query) || query.length > 40) return null;
    return { atIdx: atIdx, caret: caret, query: query };
  }

  function filterEmployees(employees, query, currentUserId) {
    var list = Array.isArray(employees) ? employees : [];
    var q = String(query || '').trim().toLowerCase();
    var matches = [];
    for (var i = 0; i < list.length; i++) {
      var emp = list[i];
      if (!emp || emp.status === 'disabled') continue;
      if (currentUserId && emp.id === currentUserId) continue;
      var name = String(emp.name || '');
      var username = String(emp.username || '');
      var job = String(emp.jobTitle || '');
      if (!q ||
          name.toLowerCase().indexOf(q) !== -1 ||
          name.replace(/\s+/g, '_').toLowerCase().indexOf(q) !== -1 ||
          username.toLowerCase().indexOf(q) !== -1 ||
          job.toLowerCase().indexOf(q) !== -1) {
        matches.push(emp);
      }
    }
    return matches.slice(0, 7);
  }

  function positionPortal(el) {
    var pop = ensurePortal();
    var rect = el.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 1200;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var width = Math.min(Math.max(260, rect.width), 360, vw - 24);
    var isRtl = document.documentElement.getAttribute('dir') !== 'ltr';

    pop.style.width = width + 'px';
    var left = isRtl ? Math.max(12, rect.right - width) : Math.min(vw - width - 12, rect.left);
    if (left < 12) left = 12;
    pop.style.left = left + 'px';

    pop.hidden = false;
    var popH = pop.offsetHeight || 220;
    var spaceBelow = vh - rect.bottom - 12;
    var top = spaceBelow >= Math.min(popH, 160) || rect.top < popH + 20
      ? Math.min(vh - popH - 8, rect.bottom + 6)
      : Math.max(8, rect.top - popH - 6);
    pop.style.top = top + 'px';
  }

  function paintPortal() {
    if (!activeState || !activeState.items.length) {
      closePortal();
      return;
    }
    var pop = ensurePortal();
    var isEn = document.documentElement.getAttribute('lang') === 'en';
    var header = '<div class="rg-mention-head">' +
      (isEn ? 'Mention colleague (@)' : 'تنبيه موظف (@)') +
      '</div>';
    var rows = activeState.items.map(function (emp, idx) {
      var activeCls = idx === activeState.selectedIndex ? ' is-active' : '';
      var initial = String(emp.name || emp.username || 'م').trim().charAt(0);
      var sub = roleBadgeLabel(emp);
      return '<button type="button" class="rg-mention-item' + activeCls + '" role="option" aria-selected="' +
        (idx === activeState.selectedIndex ? 'true' : 'false') + '" data-mention-idx="' + idx + '">' +
        '<span class="rg-mention-avatar">' + escapeHtml(initial) + '</span>' +
        '<span class="rg-mention-meta">' +
          '<span class="rg-mention-name">@' + escapeHtml(emp.name || emp.username) + '</span>' +
          '<span class="rg-mention-sub">' + escapeHtml(sub + (emp.username ? ' · @' + emp.username : '')) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
    pop.innerHTML = header + rows;
    positionPortal(activeState.el);

    pop.querySelectorAll('[data-mention-idx]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var idx = parseInt(btn.getAttribute('data-mention-idx') || '-1', 10);
        if (idx >= 0) applySelection(idx);
      });
    });
  }

  function applySelection(idx) {
    if (!activeState || !activeState.items[idx]) return;
    var emp = activeState.items[idx];
    var el = activeState.el;
    var trigger = activeState.trigger;
    var val = el.value || '';
    var insertToken = '@' + (emp.name || emp.username) + ' ';
    var nextVal = val.slice(0, trigger.atIdx) + insertToken + val.slice(trigger.caret);
    var nextCaret = trigger.atIdx + insertToken.length;
    el.value = nextVal;
    el.focus();
    if (typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(nextCaret, nextCaret); } catch (e) {}
    }
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
    closePortal();
  }

  function resolveEmployeePool(el) {
    var getter = el && el.__rgMentionGetEmployees;
    var list = typeof getter === 'function' ? getter() : [];
    if ((!list || !list.length) && root.RGApp && root.RGApp.getEmployeesState) {
      var st = root.RGApp.getEmployeesState();
      list = (st && st.items) || [];
    }
    if ((!list || !list.length) && root.RGApi && root.RGApi.getCachedData) {
      var cached = root.RGApi.getCachedData('getEmployees', {}, true);
      list = (cached && cached.items) || [];
    }
    return Array.isArray(list) ? list : [];
  }

  function evaluateInput(el) {
    if (!el || !el.isConnected) {
      closePortal();
      return;
    }
    var trigger = findActiveTrigger(el);
    if (!trigger) {
      if (activeState && activeState.el === el) closePortal();
      return;
    }
    var currentUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
    var pool = resolveEmployeePool(el);
    var items = filterEmployees(pool, trigger.query, currentUser && currentUser.id);
    if (!items.length) {
      if (activeState && activeState.el === el) closePortal();
      return;
    }
    activeState = {
      el: el,
      trigger: trigger,
      items: items,
      selectedIndex: 0
    };
    paintPortal();
  }

  function attach(el, getEmployeesFn) {
    if (!el) return;
    el.__rgMentionGetEmployees = getEmployeesFn || el.__rgMentionGetEmployees;
    if (el.__rgMentionAttached) return;
    el.__rgMentionAttached = true;
    el.setAttribute('data-rg-mentions', 'true');

    el.addEventListener('input', function () {
      evaluateInput(el);
    });

    el.addEventListener('click', function () {
      evaluateInput(el);
    });

    el.addEventListener('keydown', function (ev) {
      if (!activeState || activeState.el !== el || !activeState.items.length) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        activeState.selectedIndex = (activeState.selectedIndex + 1) % activeState.items.length;
        paintPortal();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        activeState.selectedIndex = (activeState.selectedIndex - 1 + activeState.items.length) % activeState.items.length;
        paintPortal();
      } else if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        applySelection(activeState.selectedIndex);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closePortal();
      }
    });

    el.addEventListener('blur', function () {
      setTimeout(function () {
        if (activeState && activeState.el === el && document.activeElement !== el) {
          closePortal();
        }
      }, 150);
    });
  }

  function renderHighlightedText(text, employees, escFn) {
    var esc = typeof escFn === 'function' ? escFn : escapeHtml;
    var core = root.RGCrmCore;
    var raw = String(text === undefined || text === null ? '' : text);
    if (!raw) return '';
    if (!core || !core.findMentionSegments) return esc(raw);
    var pool = Array.isArray(employees) && employees.length ? employees : resolveEmployeePool(null);
    var segs = core.findMentionSegments(raw, pool);
    return segs.map(function (seg) {
      if (seg.type === 'mention' && seg.employee) {
        var title = roleBadgeLabel(seg.employee) || seg.employee.name || '';
        return '<span class="rg-mention-token" data-emp-id="' + esc(seg.employee.id) + '" title="' + esc(title) + '">' + esc(seg.text) + '</span>';
      }
      return esc(seg.text);
    }).join('');
  }

  document.addEventListener('scroll', function () {
    if (activeState && activeState.el) {
      if (!activeState.el.isConnected) closePortal();
      else positionPortal(activeState.el);
    }
  }, true);

  window.addEventListener('resize', function () {
    if (activeState && activeState.el) {
      if (!activeState.el.isConnected) closePortal();
      else positionPortal(activeState.el);
    }
  });

  root.RGCrmMentions = {
    attach: attach,
    close: closePortal,
    renderHighlightedText: renderHighlightedText
  };
})(window);
