/**
 * RENTAL GATE CRM — Custom Frosted Glass Dropdown Enhancer & Floating Menu Manager
 * Enhances <select class="select"> & <select class="quick-status-select"> controls with
 * translucent glass trigger + portaled viewport-aware menu while keeping native <select>
 * DOM IDs, .value getters/setters, <option> lists, and change listeners 100% intact.
 */
(function (root) {
  'use strict';

  var PORTAL_ID = 'rg-dropdown-portal';
  var ENHANCED_FLAG = 'rgDropdownEnhanced';
  var nativeValueDescriptor = (typeof HTMLSelectElement !== 'undefined')
    ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
    : null;

  var activeSession = null;
  var observer = null;
  var globalEventsBound = false;
  var typeBuffer = '';
  var typeTimer = null;

  function ensurePortal() {
    var portal = document.getElementById(PORTAL_ID);
    if (!portal) {
      portal = document.createElement('div');
      portal.id = PORTAL_ID;
      portal.className = 'rg-dropdown-portal';
      document.body.appendChild(portal);
    }
    return portal;
  }

  function getAccessibleLabel(selectEl) {
    if (!selectEl) return '';
    var explicit = selectEl.getAttribute('aria-label');
    if (explicit) return explicit;
    if (selectEl.id) {
      var lbl = document.querySelector('label[for="' + CSS.escape(selectEl.id) + '"]');
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    var parentLbl = selectEl.closest('label');
    if (parentLbl) {
      var span = parentLbl.querySelector('span');
      if (span && span.textContent) return span.textContent.trim();
    }
    return '';
  }

  function getSelectedOption(selectEl) {
    if (!selectEl || !selectEl.options || !selectEl.options.length) return null;
    var idx = selectEl.selectedIndex;
    if (idx >= 0 && selectEl.options[idx]) return selectEl.options[idx];
    return selectEl.options[0] || null;
  }

  function getSemanticDotTone(label) {
    var s = String(label || '').trim();
    if (!s) return '';
    if (['مؤكد', 'مقبول', 'تم الحجز', 'تم التسليم', 'تم الاستلام', 'تم التسليم من قبل السائق', 'تم الإرجاع', 'مدفوع', 'مدفوع بالمحفظة', 'تم الحل', 'مغلقة'].indexOf(s) !== -1) {
      return 'success';
    }
    if (['جديد', 'تم الإنشاء', 'تم التمديد', 'تم التمديد تلقائيًا', 'قيد التنفيذ', 'نشط الآن', 'في الطريق'].indexOf(s) !== -1) {
      return 'info';
    }
    if (['متوسط', 'معلق', 'بانتظار الدفع', 'لم يتم الحجز'].indexOf(s) !== -1) {
      return 'warning';
    }
    if (['مرتفع', 'عاجل', 'ملغي', 'تم الإلغاء', 'مرفوض', 'جديدة'].indexOf(s) !== -1) {
      return 'danger';
    }
    return '';
  }

  function syncTriggerFromSelect(selectEl) {
    if (!selectEl || !selectEl._rgDropdown) return;
    var ref = selectEl._rgDropdown;
    var opt = getSelectedOption(selectEl);
    var labelText = opt ? opt.textContent : '';
    var val = opt ? opt.value : '';
    var isCompact = selectEl.classList.contains('quick-status-select');

    ref.valueEl.textContent = labelText;
    ref.trigger.setAttribute('data-value', val);
    ref.trigger.disabled = Boolean(selectEl.disabled);
    ref.wrap.classList.toggle('is-disabled', Boolean(selectEl.disabled));
    ref.wrap.classList.toggle('has-placeholder', val === '');

    if (isCompact) {
      var tone = getSemanticDotTone(labelText);
      ref.trigger.setAttribute('data-tone', tone);
    }

    var accLabel = getAccessibleLabel(selectEl);
    if (accLabel) {
      ref.trigger.setAttribute('aria-label', accLabel + (labelText ? ': ' + labelText : ''));
    }

    if (activeSession && activeSession.select === selectEl) {
      renderActiveMenuOptions();
    }
  }

  function patchNativeValueSetter(selectEl) {
    if (!nativeValueDescriptor || selectEl._rgValuePatched) return;
    selectEl._rgValuePatched = true;
    try {
      Object.defineProperty(selectEl, 'value', {
        configurable: true,
        enumerable: true,
        get: function () {
          return nativeValueDescriptor.get.call(this);
        },
        set: function (nextVal) {
          var prevVal = nativeValueDescriptor.get.call(this);
          nativeValueDescriptor.set.call(this, nextVal);
          if (this._rgDropdown) {
            syncTriggerFromSelect(this);
          }
          return prevVal;
        }
      });
    } catch (_e) {}
  }

  function closeActiveMenu(opts) {
    if (!activeSession) return false;
    var o = opts || {};
    var session = activeSession;
    activeSession = null;

    if (session.trigger) {
      session.trigger.setAttribute('aria-expanded', 'false');
      session.trigger.classList.remove('is-open');
    }
    if (session.menu) {
      session.menu.classList.remove('is-open');
      if (session.menu.parentNode) {
        session.menu.parentNode.removeChild(session.menu);
      }
    }
    if (o.restoreFocus && session.trigger && session.trigger.isConnected) {
      try { session.trigger.focus({ preventScroll: true }); } catch (_e) {}
    }
    return true;
  }

  function positionMenu() {
    if (!activeSession || !activeSession.trigger || !activeSession.menu) return;
    var triggerRect = activeSession.trigger.getBoundingClientRect();
    if (triggerRect.width === 0 && triggerRect.height === 0) {
      closeActiveMenu();
      return;
    }

    var menu = activeSession.menu;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var margin = 10;
    var gap = 6;
    var minWidth = Math.max(triggerRect.width, activeSession.isCompact ? 176 : 190);
    var maxWidth = Math.min(vw - margin * 2, Math.max(minWidth, 340));

    menu.style.minWidth = minWidth + 'px';
    menu.style.maxWidth = maxWidth + 'px';

    var menuRect = menu.getBoundingClientRect();
    var actualW = Math.min(maxWidth, Math.max(minWidth, menuRect.width || minWidth));
    var actualH = Math.min(290, menu.scrollHeight || menuRect.height || 220);

    var spaceBelow = vh - triggerRect.bottom - margin;
    var spaceAbove = triggerRect.top - margin;
    var openUpward = spaceBelow < Math.min(actualH, 180) && spaceAbove > spaceBelow;
    var maxAllowedH = Math.max(120, Math.min(290, (openUpward ? spaceAbove : spaceBelow) - gap));

    menu.style.maxHeight = maxAllowedH + 'px';
    var topPos = openUpward
      ? Math.max(margin, triggerRect.top - Math.min(actualH, maxAllowedH) - gap)
      : Math.min(vh - margin - Math.min(actualH, maxAllowedH), triggerRect.bottom + gap);

    var isRtl = document.documentElement.getAttribute('dir') !== 'ltr';
    var leftPos = isRtl ? (triggerRect.right - actualW) : triggerRect.left;
    if (leftPos + actualW > vw - margin) {
      leftPos = vw - margin - actualW;
    }
    if (leftPos < margin) {
      leftPos = margin;
    }

    menu.style.left = Math.round(leftPos) + 'px';
    menu.style.top = Math.round(topPos) + 'px';
    menu.classList.toggle('is-upward', openUpward);
  }

  function highlightOptionIndex(nextIdx, shouldScroll) {
    if (!activeSession || !activeSession.optionButtons.length) return;
    var total = activeSession.optionButtons.length;
    var idx = Math.max(0, Math.min(total - 1, nextIdx));
    activeSession.focusIndex = idx;
    activeSession.optionButtons.forEach(function (btn, i) {
      var active = i === idx;
      btn.classList.toggle('is-focused', active);
      if (active) {
        activeSession.menu.setAttribute('aria-activedescendant', btn.id);
        if (shouldScroll && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  function commitSelectionByIndex(idx) {
    if (!activeSession) return;
    var selectEl = activeSession.select;
    var btn = activeSession.optionButtons[idx];
    if (!btn || btn.disabled) return;
    var optVal = btn.getAttribute('data-value');
    var prevVal = nativeValueDescriptor ? nativeValueDescriptor.get.call(selectEl) : selectEl.value;

    if (nativeValueDescriptor) {
      nativeValueDescriptor.set.call(selectEl, optVal);
    } else {
      selectEl.value = optVal;
    }
    syncTriggerFromSelect(selectEl);
    closeActiveMenu({ restoreFocus: true });

    if (prevVal !== optVal) {
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function renderActiveMenuOptions() {
    if (!activeSession) return;
    var selectEl = activeSession.select;
    var menu = activeSession.menu;
    var curVal = nativeValueDescriptor ? nativeValueDescriptor.get.call(selectEl) : selectEl.value;
    var options = Array.from(selectEl.options || []);
    var uid = activeSession.uid;

    menu.innerHTML = '';
    activeSession.optionButtons = [];

    if (!options.length) {
      var empty = document.createElement('div');
      empty.className = 'rg-select-empty';
      empty.textContent = document.documentElement.getAttribute('lang') === 'en' ? 'No options available' : 'لا توجد خيارات';
      menu.appendChild(empty);
      return;
    }

    var selectedIdx = -1;
    options.forEach(function (opt, idx) {
      var optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.id = uid + '-opt-' + idx;
      optBtn.className = 'rg-select-option';
      optBtn.setAttribute('role', 'option');
      optBtn.setAttribute('data-value', opt.value);
      optBtn.setAttribute('data-index', String(idx));
      optBtn.disabled = Boolean(opt.disabled);

      var isSelected = opt.value === curVal;
      if (isSelected) {
        selectedIdx = idx;
        optBtn.classList.add('is-selected');
        optBtn.setAttribute('aria-selected', 'true');
      } else {
        optBtn.setAttribute('aria-selected', 'false');
      }

      var labelSpan = document.createElement('span');
      labelSpan.className = 'rg-select-option-label';
      var tone = activeSession.isCompact ? getSemanticDotTone(opt.textContent) : '';
      if (tone) {
        var dot = document.createElement('span');
        dot.className = 'rg-tone-dot is-' + tone;
        dot.setAttribute('aria-hidden', 'true');
        labelSpan.appendChild(dot);
      }
      var textNode = document.createElement('span');
      textNode.textContent = opt.textContent;
      labelSpan.appendChild(textNode);
      optBtn.appendChild(labelSpan);

      if (isSelected) {
        var chk = document.createElement('span');
        chk.className = 'rg-select-check';
        chk.setAttribute('aria-hidden', 'true');
        chk.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        optBtn.appendChild(chk);
      }

      optBtn.addEventListener('mouseenter', function () {
        highlightOptionIndex(idx, false);
      });

      optBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        commitSelectionByIndex(idx);
      });

      menu.appendChild(optBtn);
      activeSession.optionButtons.push(optBtn);
    });

    var startIdx = selectedIdx >= 0 ? selectedIdx : 0;
    highlightOptionIndex(startIdx, true);
  }

  function openMenuForSelect(selectEl) {
    if (!selectEl || !selectEl._rgDropdown || selectEl.disabled) return;
    if (activeSession && activeSession.select === selectEl) {
      closeActiveMenu({ restoreFocus: true });
      return;
    }

    closeActiveMenu();

    var ref = selectEl._rgDropdown;
    var portal = ensurePortal();
    var menu = document.createElement('div');
    var uid = 'rg-dd-' + Math.random().toString(36).slice(2, 8);
    menu.id = uid + '-menu';
    menu.className = 'rg-select-menu' + (selectEl.classList.contains('quick-status-select') ? ' is-compact' : '');
    menu.setAttribute('role', 'listbox');
    menu.tabIndex = -1;
    var accLabel = getAccessibleLabel(selectEl);
    if (accLabel) menu.setAttribute('aria-label', accLabel);

    portal.appendChild(menu);

    activeSession = {
      uid: uid,
      select: selectEl,
      trigger: ref.trigger,
      menu: menu,
      isCompact: selectEl.classList.contains('quick-status-select'),
      optionButtons: [],
      focusIndex: 0
    };

    ref.trigger.setAttribute('aria-controls', menu.id);
    ref.trigger.setAttribute('aria-expanded', 'true');
    ref.trigger.classList.add('is-open');

    renderActiveMenuOptions();
    positionMenu();

    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(function () {
        if (activeSession && activeSession.menu === menu) {
          menu.classList.add('is-open');
          if (activeSession.optionButtons[activeSession.focusIndex]) {
            activeSession.optionButtons[activeSession.focusIndex].scrollIntoView({ block: 'nearest' });
          }
        }
      });
    } else {
      menu.classList.add('is-open');
    }
  }

  function handleMenuKeyDown(ev) {
    if (!activeSession) return false;
    var total = activeSession.optionButtons.length;
    if (!total) return false;

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      var nextDown = activeSession.focusIndex + 1;
      while (nextDown < total && activeSession.optionButtons[nextDown].disabled) nextDown++;
      if (nextDown < total) highlightOptionIndex(nextDown, true);
      return true;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      var nextUp = activeSession.focusIndex - 1;
      while (nextUp >= 0 && activeSession.optionButtons[nextUp].disabled) nextUp--;
      if (nextUp >= 0) highlightOptionIndex(nextUp, true);
      return true;
    }
    if (ev.key === 'Home') {
      ev.preventDefault();
      highlightOptionIndex(0, true);
      return true;
    }
    if (ev.key === 'End') {
      ev.preventDefault();
      highlightOptionIndex(total - 1, true);
      return true;
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      commitSelectionByIndex(activeSession.focusIndex);
      return true;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeActiveMenu({ restoreFocus: true });
      return true;
    }
    if (ev.key === 'Tab') {
      closeActiveMenu({ restoreFocus: false });
      return false;
    }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      typeBuffer += ev.key.toLowerCase();
      clearTimeout(typeTimer);
      typeTimer = setTimeout(function () { typeBuffer = ''; }, 550);
      var matchIdx = activeSession.optionButtons.findIndex(function (btn) {
        return !btn.disabled && String(btn.textContent || '').trim().toLowerCase().indexOf(typeBuffer) === 0;
      });
      if (matchIdx >= 0) {
        highlightOptionIndex(matchIdx, true);
      }
      return true;
    }
    return false;
  }

  function enhanceSelect(selectEl) {
    if (!selectEl || selectEl.tagName !== 'SELECT') return;
    if (selectEl.getAttribute('data-rg-native') === 'true') return;
    if (selectEl.dataset[ENHANCED_FLAG] === '1') {
      syncTriggerFromSelect(selectEl);
      return;
    }

    var isCompact = selectEl.classList.contains('quick-status-select');
    var isTarget = selectEl.classList.contains('select') || isCompact;
    if (!isTarget) return;

    selectEl.dataset[ENHANCED_FLAG] = '1';

    var wrap = document.createElement('div');
    wrap.className = 'rg-select-wrap' + (isCompact ? ' is-compact' : '');
    if (selectEl.style && selectEl.style.maxWidth) {
      wrap.style.maxWidth = selectEl.style.maxWidth;
    }

    var parent = selectEl.parentNode;
    if (parent) {
      parent.insertBefore(wrap, selectEl);
      wrap.appendChild(selectEl);
    }

    selectEl.classList.add('rg-native-select');
    selectEl.tabIndex = -1;
    selectEl.setAttribute('aria-hidden', 'true');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rg-select-trigger' + (isCompact ? ' is-compact' : '');
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var valueEl = document.createElement('span');
    valueEl.className = 'rg-select-value';

    var chevronEl = document.createElement('span');
    chevronEl.className = 'rg-select-chevron';
    chevronEl.setAttribute('aria-hidden', 'true');
    chevronEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    trigger.appendChild(valueEl);
    trigger.appendChild(chevronEl);
    wrap.appendChild(trigger);

    selectEl._rgDropdown = {
      wrap: wrap,
      trigger: trigger,
      valueEl: valueEl
    };

    patchNativeValueSetter(selectEl);
    syncTriggerFromSelect(selectEl);

    trigger.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openMenuForSelect(selectEl);
    });

    trigger.addEventListener('keydown', function (ev) {
      if (activeSession && activeSession.select === selectEl) {
        handleMenuKeyDown(ev);
        return;
      }
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        openMenuForSelect(selectEl);
      }
    });

    selectEl.addEventListener('change', function () {
      syncTriggerFromSelect(selectEl);
    });
  }

  function enhanceAll(container) {
    var rootEl = container || document;
    var selects = rootEl.querySelectorAll('select.select, select.quick-status-select');
    selects.forEach(function (sel) {
      enhanceSelect(sel);
    });
  }

  function bindGlobalEvents() {
    if (globalEventsBound) return;
    globalEventsBound = true;

    document.addEventListener('click', function (ev) {
      if (!activeSession) return;
      var target = ev.target;
      if (activeSession.menu && activeSession.menu.contains(target)) return;
      if (activeSession.trigger && activeSession.trigger.contains(target)) return;
      closeActiveMenu();
    });

    document.addEventListener('keydown', function (ev) {
      if (!activeSession) return;
      if (activeSession.trigger && document.activeElement === activeSession.trigger) return;
      handleMenuKeyDown(ev);
    }, true);

    window.addEventListener('resize', function () {
      if (activeSession) positionMenu();
    });

    window.addEventListener('scroll', function (ev) {
      if (!activeSession) return;
      if (activeSession.menu && ev.target && (ev.target === activeSession.menu || activeSession.menu.contains(ev.target))) {
        return;
      }
      positionMenu();
    }, true);
  }

  function init() {
    bindGlobalEvents();
    enhanceAll(document);

    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function (mutations) {
      if (activeSession && (!activeSession.select || !activeSession.select.isConnected)) {
        closeActiveMenu({ restoreFocus: false });
      }
      var selectsToSync = new Set();
      var containersToScan = new Set();

      mutations.forEach(function (m) {
        var target = m.target;
        if (!target) return;
        if (target.id === PORTAL_ID || (target.closest && target.closest('#' + PORTAL_ID))) return;

        if (target.tagName === 'SELECT') {
          selectsToSync.add(target);
          return;
        }
        if (target.closest) {
          var parentSel = target.closest('select');
          if (parentSel) {
            selectsToSync.add(parentSel);
            return;
          }
        }
        if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach(function (node) {
            if (node && node.nodeType === 1) {
              if (node.tagName === 'SELECT') {
                selectsToSync.add(node);
              } else if (node.querySelector) {
                containersToScan.add(node);
              }
            }
          });
        }
      });

      containersToScan.forEach(function (node) {
        enhanceAll(node);
      });
      selectsToSync.forEach(function (sel) {
        if (sel.dataset[ENHANCED_FLAG] === '1') {
          syncTriggerFromSelect(sel);
        } else {
          enhanceSelect(sel);
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'selected']
    });
  }

  root.RGCrmDropdowns = {
    init: init,
    enhanceAll: enhanceAll,
    syncSelect: syncTriggerFromSelect,
    closeActive: function () { return closeActiveMenu({ restoreFocus: true }); },
    isOpen: function () { return Boolean(activeSession); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
