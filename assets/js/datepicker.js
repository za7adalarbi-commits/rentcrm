/**
 * RENTAL GATE CRM — Modern Glassmorphism Interactive Date Picker & Date-Range Manager
 * Supports synchronized Calendar Popover selection + Manual YYYY-MM-DD entry with validation,
 * single-date and linked start/end range pairs, keyboard navigation, RTL/LTR & Light/Dark themes.
 */
(function (root) {
  'use strict';

  var PORTAL_ID = 'rg-datepicker-portal';
  var ENHANCED_FLAG = 'rgDateEnhanced';
  var nativeInputValueDescriptor = (typeof HTMLInputElement !== 'undefined')
    ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    : null;

  var KNOWN_RANGE_PAIRS = {
    'dash-date-from': { pair: 'dash-range', role: 'start' },
    'dash-date-to': { pair: 'dash-range', role: 'end' },
    'res-from': { pair: 'res-filter-range', role: 'start' },
    'res-to': { pair: 'res-filter-range', role: 'end' },
    'res-pull-from': { pair: 'res-pull-range', role: 'start' },
    'res-pull-to': { pair: 'res-pull-range', role: 'end' },
    're-start': { pair: 'res-edit-range', role: 'start' },
    're-end': { pair: 'res-edit-range', role: 'end' },
    'rep-from': { pair: 'rep-range', role: 'start' },
    'rep-to': { pair: 'rep-range', role: 'end' },
    'sync-pull-from': { pair: 'sync-pull-range', role: 'start' },
    'sync-pull-to': { pair: 'sync-pull-range', role: 'end' }
  };

  var MONTHS_AR = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  var MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var WEEKDAYS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  var WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  var activeSession = null;
  var observer = null;
  var globalEventsBound = false;

  function core() {
    return root.RGCrmCore || null;
  }

  function getLang() {
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }

  function isRtl() {
    return document.documentElement.getAttribute('dir') !== 'ltr';
  }

  function getTodayIso() {
    var d = new Date();
    var c = core();
    if (c && c.formatIsoDateParts) {
      return c.formatIsoDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function parseIso(iso) {
    var c = core();
    if (c && c.parseIsoDateStrict) return c.parseIsoDateStrict(iso);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    return { iso: m[0], year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
  }

  function validateIso(raw, opts) {
    var c = core();
    if (c && c.validateIsoDateInput) return c.validateIsoDateInput(raw, opts);
    var cleaned = String(raw || '').trim();
    if (!cleaned) return { valid: !opts || !opts.required, empty: true, normalized: '', message: '' };
    var ok = /^\d{4}-\d{2}-\d{2}$/.test(cleaned);
    return { valid: ok, empty: false, normalized: ok ? cleaned : '', message: ok ? '' : 'YYYY-MM-DD' };
  }

  function ensurePortal() {
    var portal = document.getElementById(PORTAL_ID);
    if (!portal) {
      portal = document.createElement('div');
      portal.id = PORTAL_ID;
      portal.className = 'rg-datepicker-portal';
      document.body.appendChild(portal);
    }
    return portal;
  }

  function getRangeMeta(inputEl) {
    if (!inputEl) return null;
    var attrPair = inputEl.getAttribute('data-rg-range-pair');
    var attrRole = inputEl.getAttribute('data-rg-range-role');
    if (attrPair && (attrRole === 'start' || attrRole === 'end')) {
      return { pair: attrPair, role: attrRole };
    }
    if (inputEl.id && KNOWN_RANGE_PAIRS[inputEl.id]) {
      return KNOWN_RANGE_PAIRS[inputEl.id];
    }
    return null;
  }

  function findPeerInput(inputEl) {
    var meta = getRangeMeta(inputEl);
    if (!meta) return null;
    var wantRole = meta.role === 'start' ? 'end' : 'start';
    var byAttr = document.querySelector('input[data-rg-range-pair="' + CSS.escape(meta.pair) + '"][data-rg-range-role="' + wantRole + '"]');
    if (byAttr && byAttr !== inputEl) return byAttr;

    var ids = Object.keys(KNOWN_RANGE_PAIRS);
    for (var i = 0; i < ids.length; i++) {
      var k = ids[i];
      if (KNOWN_RANGE_PAIRS[k].pair === meta.pair && KNOWN_RANGE_PAIRS[k].role === wantRole) {
        var peer = document.getElementById(k);
        if (peer && peer !== inputEl) return peer;
      }
    }
    return null;
  }

  function getPairInputs(inputEl) {
    var meta = getRangeMeta(inputEl);
    if (!meta) return null;
    var peer = findPeerInput(inputEl);
    if (!peer) return null;
    return meta.role === 'start'
      ? { startInput: inputEl, endInput: peer, pair: meta.pair }
      : { startInput: peer, endInput: inputEl, pair: meta.pair };
  }

  function setNativeInputText(inputEl, text) {
    if (!inputEl) return;
    if (nativeInputValueDescriptor && nativeInputValueDescriptor.set) {
      nativeInputValueDescriptor.set.call(inputEl, text);
    } else {
      inputEl.value = text;
    }
  }

  function getNativeInputText(inputEl) {
    if (!inputEl) return '';
    if (nativeInputValueDescriptor && nativeInputValueDescriptor.get) {
      return nativeInputValueDescriptor.get.call(inputEl);
    }
    return inputEl.value;
  }

  function getAccessibleLabel(inputEl) {
    if (!inputEl) return '';
    var explicit = inputEl.getAttribute('aria-label');
    if (explicit) return explicit;
    if (inputEl.id) {
      var lbl = document.querySelector('label[for="' + CSS.escape(inputEl.id) + '"]');
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    var parentLbl = inputEl.closest('label');
    if (parentLbl) {
      var span = parentLbl.querySelector('span');
      if (span && span.textContent) return span.textContent.trim();
    }
    return getLang() === 'en' ? 'Date' : 'التاريخ';
  }

  function updateFieldVisualState(inputEl) {
    var state = inputEl && inputEl._rgDatePicker;
    if (!state) return;

    var hasContent = Boolean(state.draftValue || state.committedValue);
    state.wrap.classList.toggle('has-value', hasContent);
    state.wrap.classList.toggle('is-disabled', Boolean(inputEl.disabled));
    state.wrap.classList.toggle('is-invalid', Boolean(state.errorMessage));
    inputEl.setAttribute('aria-invalid', state.errorMessage ? 'true' : 'false');

    if (state.clearBtn) {
      state.clearBtn.classList.toggle('hidden', !hasContent || Boolean(inputEl.disabled));
    }
    if (state.triggerBtn) {
      state.triggerBtn.disabled = Boolean(inputEl.disabled);
    }
    if (state.errorEl) {
      if (state.errorMessage) {
        state.errorEl.textContent = state.errorMessage;
        state.errorEl.classList.remove('hidden');
      } else {
        state.errorEl.textContent = '';
        state.errorEl.classList.add('hidden');
      }
    }
  }

  function validateRangeConsistency(inputEl) {
    var pair = getPairInputs(inputEl);
    if (!pair) return;
    var sState = pair.startInput._rgDatePicker;
    var eState = pair.endInput._rgDatePicker;
    if (!sState || !eState) return;
    var sVal = sState.committedValue;
    var eVal = eState.committedValue;
    var lang = getLang();

    if (sVal && eVal && sVal > eVal) {
      if (!eState.syntaxError) {
        eState.rangeError = lang === 'en' ? 'End date must be on or after start date' : 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية';
        eState.errorMessage = eState.rangeError;
        updateFieldVisualState(pair.endInput);
      }
    } else {
      if (eState.rangeError) {
        eState.rangeError = '';
        eState.errorMessage = eState.syntaxError || '';
        updateFieldVisualState(pair.endInput);
      }
      if (sState.rangeError) {
        sState.rangeError = '';
        sState.errorMessage = sState.syntaxError || '';
        updateFieldVisualState(pair.startInput);
      }
    }
  }

  function commitValueOnInput(inputEl, nextIso, opts) {
    var state = inputEl && inputEl._rgDatePicker;
    if (!state) return;
    var o = opts || {};
    var prevCommitted = state.committedValue;
    var cleanIso = nextIso || '';

    state.committedValue = cleanIso;
    if (!o.keepDraft) {
      state.draftValue = cleanIso;
      setNativeInputText(inputEl, cleanIso);
    }
    state.syntaxError = '';
    state.errorMessage = '';
    updateFieldVisualState(inputEl);
    validateRangeConsistency(inputEl);

    if (o.syncCalendar && activeSession && (activeSession.input === inputEl || activeSession.peerInput === inputEl)) {
      if (cleanIso) {
        var parsed = parseIso(cleanIso);
        if (parsed && activeSession.input === inputEl) {
          activeSession.viewYear = parsed.year;
          activeSession.viewMonth = parsed.month;
          activeSession.focusIso = cleanIso;
        }
      }
      renderPopoverContent();
    }

    if (o.emitChange && prevCommitted !== cleanIso) {
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function patchInputValueDescriptor(inputEl) {
    if (!nativeInputValueDescriptor || inputEl._rgDateValuePatched) return;
    inputEl._rgDateValuePatched = true;
    try {
      Object.defineProperty(inputEl, 'value', {
        configurable: true,
        enumerable: true,
        get: function () {
          if (this._rgDatePicker) {
            return this._rgDatePicker.committedValue || '';
          }
          return nativeInputValueDescriptor.get.call(this);
        },
        set: function (nextVal) {
          var str = String(nextVal === undefined || nextVal === null ? '' : nextVal).trim();
          if (!this._rgDatePicker) {
            nativeInputValueDescriptor.set.call(this, str);
            return;
          }
          var vRes = validateIso(str, {
            minDate: this.getAttribute('min') || '',
            maxDate: this.getAttribute('max') || '',
            lang: getLang()
          });
          if (vRes.valid) {
            this._rgDatePicker.committedValue = vRes.normalized;
            this._rgDatePicker.draftValue = vRes.normalized;
            this._rgDatePicker.syntaxError = '';
            this._rgDatePicker.errorMessage = '';
            nativeInputValueDescriptor.set.call(this, vRes.normalized);
          } else {
            this._rgDatePicker.committedValue = '';
            this._rgDatePicker.draftValue = '';
            this._rgDatePicker.syntaxError = '';
            this._rgDatePicker.errorMessage = '';
            nativeInputValueDescriptor.set.call(this, '');
          }
          updateFieldVisualState(this);
          validateRangeConsistency(this);
          if (activeSession && (activeSession.input === this || activeSession.peerInput === this)) {
            renderPopoverContent();
          }
        }
      });
    } catch (_e) {}
  }

  function closeActivePopover(opts) {
    if (!activeSession) return false;
    var o = opts || {};
    var session = activeSession;
    activeSession = null;

    if (session.input && session.input._rgDatePicker) {
      session.input.setAttribute('aria-expanded', 'false');
      session.input._rgDatePicker.wrap.classList.remove('is-open');
    }
    if (session.peerInput && session.peerInput._rgDatePicker) {
      session.peerInput.setAttribute('aria-expanded', 'false');
      session.peerInput._rgDatePicker.wrap.classList.remove('is-open');
    }
    if (session.backdrop && session.backdrop.parentNode) {
      session.backdrop.parentNode.removeChild(session.backdrop);
    }
    if (session.popover && session.popover.parentNode) {
      session.popover.parentNode.removeChild(session.popover);
    }
    if (o.restoreFocus && session.restoreTarget && session.restoreTarget.isConnected) {
      try { session.restoreTarget.focus({ preventScroll: true }); } catch (_e) {}
    }
    return true;
  }

  function positionPopover() {
    if (!activeSession || !activeSession.popover) return;
    var anchorWrap = (activeSession.activeInput && activeSession.activeInput._rgDatePicker)
      ? activeSession.activeInput._rgDatePicker.wrap
      : (activeSession.input._rgDatePicker && activeSession.input._rgDatePicker.wrap);

    if (!anchorWrap || !anchorWrap.isConnected) {
      closeActivePopover({ restoreFocus: false });
      return;
    }

    var rect = anchorWrap.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      closeActivePopover({ restoreFocus: false });
      return;
    }

    var pop = activeSession.popover;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var isMobile = vw <= 639;

    pop.classList.toggle('is-mobile-sheet', isMobile);
    if (activeSession.backdrop) {
      activeSession.backdrop.classList.toggle('is-visible', isMobile);
    }

    if (isMobile) {
      pop.style.left = '';
      pop.style.top = '';
      pop.style.width = '';
      return;
    }

    var margin = 12;
    var gap = 8;
    var popRect = pop.getBoundingClientRect();
    var popW = Math.min(vw - margin * 2, Math.max(304, popRect.width || 316));
    var popH = Math.min(vh - margin * 2, popRect.height || 368);

    var spaceBelow = vh - rect.bottom - margin;
    var spaceAbove = rect.top - margin;
    var openUpward = spaceBelow < popH && spaceAbove > spaceBelow;
    var topPos = openUpward
      ? Math.max(margin, rect.top - popH - gap)
      : Math.min(vh - margin - popH, rect.bottom + gap);

    var leftPos = isRtl() ? (rect.right - popW) : rect.left;
    if (leftPos + popW > vw - margin) {
      leftPos = vw - margin - popW;
    }
    if (leftPos < margin) {
      leftPos = margin;
    }

    pop.style.left = Math.round(leftPos) + 'px';
    pop.style.top = Math.round(topPos) + 'px';
    pop.classList.toggle('is-upward', openUpward);
  }

  function getConstraintBoundsForInput(inputEl) {
    if (!inputEl) return { minDate: '', maxDate: '' };
    var minDate = inputEl.getAttribute('min') || '';
    var maxDate = inputEl.getAttribute('max') || '';
    return { minDate: minDate, maxDate: maxDate };
  }

  function syncRangeInputValues(startInput, endInput, nextStart, nextEnd, emit) {
    var sChanged = false;
    var eChanged = false;
    if (startInput && startInput._rgDatePicker) {
      sChanged = startInput._rgDatePicker.committedValue !== (nextStart || '');
      commitValueOnInput(startInput, nextStart || '', { emitChange: false });
    }
    if (endInput && endInput._rgDatePicker) {
      eChanged = endInput._rgDatePicker.committedValue !== (nextEnd || '');
      commitValueOnInput(endInput, nextEnd || '', { emitChange: false });
    }
    if (emit) {
      if (sChanged && startInput) startInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (eChanged && endInput) endInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function handleDayCellSelect(iso) {
    if (!activeSession) return;
    var c = core();
    if (!iso) return;

    if (activeSession.isRange && activeSession.startInput && activeSession.endInput) {
      var sVal = activeSession.startInput._rgDatePicker.committedValue || '';
      var eVal = activeSession.endInput._rgDatePicker.committedValue || '';
      var activeRole = activeSession.activeRole || 'start';
      var nextRange = (c && c.resolveRangeSelectionClick)
        ? c.resolveRangeSelectionClick(sVal, eVal, iso, activeRole)
        : { start: iso, end: eVal, nextRole: 'end', completed: Boolean(eVal) };

      syncRangeInputValues(activeSession.startInput, activeSession.endInput, nextRange.start, nextRange.end, true);
      activeSession.focusIso = iso;
      if (nextRange.completed && activeRole === 'end') {
        renderPopoverContent();
        setTimeout(function () {
          if (activeSession) closeActivePopover({ restoreFocus: true });
        }, 120);
        return;
      }
      activeSession.activeRole = nextRange.nextRole;
      activeSession.activeInput = nextRange.nextRole === 'end' ? activeSession.endInput : activeSession.startInput;
      renderPopoverContent();
      return;
    }

    // Single date mode
    var target = activeSession.input;
    commitValueOnInput(target, iso, { emitChange: true, syncCalendar: false });
    closeActivePopover({ restoreFocus: true });
  }

  function updateRangeHoverPreview(hoverIso) {
    if (!activeSession || !activeSession.isRange || !activeSession.popover) return;
    var sVal = activeSession.startInput ? (activeSession.startInput._rgDatePicker.committedValue || '') : '';
    var eVal = activeSession.endInput ? (activeSession.endInput._rgDatePicker.committedValue || '') : '';
    if (!sVal || eVal || !hoverIso) return;

    var effStart = hoverIso < sVal ? hoverIso : sVal;
    var effEnd = hoverIso < sVal ? sVal : hoverIso;

    var dayButtons = activeSession.popover.querySelectorAll('.rg-dp-day[data-iso]');
    dayButtons.forEach(function (btn) {
      var dIso = btn.getAttribute('data-iso') || '';
      btn.classList.toggle('is-preview-in-range', Boolean(dIso > effStart && dIso < effEnd));
      btn.classList.toggle('is-preview-edge', Boolean(dIso === hoverIso));
    });
  }

  function renderPopoverContent() {
    if (!activeSession || !activeSession.popover) return;
    var pop = activeSession.popover;
    var lang = getLang();
    var rtl = isRtl();
    var months = lang === 'en' ? MONTHS_EN : MONTHS_AR;
    var weekdays = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_AR;
    var c = core();
    var todayIso = getTodayIso();

    var y = activeSession.viewYear;
    var m = activeSession.viewMonth;
    var mode = activeSession.viewMode || 'days'; // 'days' | 'months' | 'years'

    var bounds = getConstraintBoundsForInput(activeSession.activeInput || activeSession.input);
    var singleVal = (!activeSession.isRange && activeSession.input._rgDatePicker)
      ? activeSession.input._rgDatePicker.committedValue
      : '';
    var startVal = (activeSession.isRange && activeSession.startInput && activeSession.startInput._rgDatePicker)
      ? activeSession.startInput._rgDatePicker.committedValue
      : '';
    var endVal = (activeSession.isRange && activeSession.endInput && activeSession.endInput._rgDatePicker)
      ? activeSession.endInput._rgDatePicker.committedValue
      : '';

    var prevArrow = rtl
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    var nextArrow = rtl
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    var rangeBarHtml = '';
    if (activeSession.isRange) {
      var fromLbl = lang === 'en' ? 'From' : 'من';
      var toLbl = lang === 'en' ? 'To' : 'إلى';
      var unsetLbl = lang === 'en' ? 'Select' : 'اختر';
      var rangeArrowSvg = rtl
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      rangeBarHtml =
        '<div class="rg-dp-range-bar">' +
          '<button type="button" class="rg-dp-range-pill' + (activeSession.activeRole === 'start' ? ' is-active' : '') + '" data-dp-role="start">' +
            '<span class="rg-dp-range-k">' + fromLbl + '</span>' +
            '<span class="rg-dp-range-v mono" dir="ltr">' + (startVal || unsetLbl) + '</span>' +
          '</button>' +
          '<span class="rg-dp-range-arrow" aria-hidden="true">' + rangeArrowSvg + '</span>' +
          '<button type="button" class="rg-dp-range-pill' + (activeSession.activeRole === 'end' ? ' is-active' : '') + '" data-dp-role="end">' +
            '<span class="rg-dp-range-k">' + toLbl + '</span>' +
            '<span class="rg-dp-range-v mono" dir="ltr">' + (endVal || unsetLbl) + '</span>' +
          '</button>' +
        '</div>';
    }

    var bodyHtml = '';
    var headerTitleHtml = '';

    if (mode === 'months') {
      headerTitleHtml =
        '<button type="button" class="rg-dp-ym-btn is-active" data-dp-action="show-days">' + months[m - 1] + '</button>' +
        '<button type="button" class="rg-dp-ym-btn" data-dp-action="show-years">' + y + '</button>';
      bodyHtml =
        '<div class="rg-dp-ym-grid">' +
          months.map(function (mName, idx) {
            var mNum = idx + 1;
            var isCur = mNum === m;
            return '<button type="button" class="rg-dp-ym-cell' + (isCur ? ' is-selected' : '') + '" data-dp-month="' + mNum + '">' + mName + '</button>';
          }).join('') +
        '</div>';
    } else if (mode === 'years') {
      var baseYear = Math.floor(y / 12) * 12;
      headerTitleHtml =
        '<span class="rg-dp-decade-lbl mono" dir="ltr">' + baseYear + ' – ' + (baseYear + 11) + '</span>';
      var yrCells = [];
      for (var yi = 0; yi < 12; yi++) {
        var yr = baseYear + yi;
        yrCells.push(
          '<button type="button" class="rg-dp-ym-cell mono' + (yr === y ? ' is-selected' : '') + '" data-dp-year="' + yr + '">' + yr + '</button>'
        );
      }
      bodyHtml = '<div class="rg-dp-ym-grid">' + yrCells.join('') + '</div>';
    } else {
      headerTitleHtml =
        '<button type="button" class="rg-dp-ym-btn" data-dp-action="show-months" aria-label="' + (lang === 'en' ? 'Choose month' : 'اختر الشهر') + '">' + months[m - 1] + '</button>' +
        '<button type="button" class="rg-dp-ym-btn mono" data-dp-action="show-years" aria-label="' + (lang === 'en' ? 'Choose year' : 'اختر السنة') + '">' + y + '</button>';

      var grid = (c && c.buildCalendarMonthGrid)
        ? c.buildCalendarMonthGrid(y, m, {
            weekStartsOn: 0,
            todayIso: todayIso,
            selectedDate: activeSession.isRange ? '' : singleVal,
            rangeStart: activeSession.isRange ? startVal : '',
            rangeEnd: activeSession.isRange ? endVal : '',
            minDate: bounds.minDate,
            maxDate: bounds.maxDate,
            isRange: activeSession.isRange
          })
        : [];

      var weekdayRow = '<div class="rg-dp-weekdays">' +
        weekdays.map(function (wd) { return '<span class="rg-dp-weekday">' + wd + '</span>'; }).join('') +
      '</div>';

      var dayCellsHtml = '<div class="rg-dp-days" role="grid">' +
        grid.map(function (cell) {
          var classes = ['rg-dp-day'];
          if (!cell.isCurrentMonth) classes.push('is-outside');
          if (cell.isToday) classes.push('is-today');
          if (cell.isSelected) classes.push('is-selected');
          if (cell.isRangeStart) classes.push('is-range-start');
          if (cell.isRangeEnd) classes.push('is-range-end');
          if (cell.isInRange) classes.push('is-in-range');
          if (cell.isDisabled) classes.push('is-disabled');
          if (activeSession.focusIso === cell.iso) classes.push('is-focused');
          return '<button type="button" class="' + classes.join(' ') + '" data-iso="' + cell.iso + '"' +
            (cell.isDisabled ? ' disabled' : '') +
            ' aria-label="' + cell.iso + '"' +
            ' aria-selected="' + (cell.isSelected ? 'true' : 'false') + '">' +
            '<span>' + cell.day + '</span>' +
          '</button>';
        }).join('') +
      '</div>';

      bodyHtml = weekdayRow + dayCellsHtml;
    }

    var todayLabel = lang === 'en' ? 'Today' : 'اليوم';
    var clearLabel = lang === 'en' ? 'Clear' : 'مسح';
    var closeLabel = lang === 'en' ? 'Done' : 'تم';

    pop.innerHTML =
      rangeBarHtml +
      '<div class="rg-dp-header">' +
        '<button type="button" class="rg-dp-nav-btn" data-dp-nav="-1" aria-label="' + (lang === 'en' ? 'Previous' : 'السابق') + '">' + prevArrow + '</button>' +
        '<div class="rg-dp-header-title">' + headerTitleHtml + '</div>' +
        '<button type="button" class="rg-dp-nav-btn" data-dp-nav="1" aria-label="' + (lang === 'en' ? 'Next' : 'التالي') + '">' + nextArrow + '</button>' +
      '</div>' +
      '<div class="rg-dp-body">' + bodyHtml + '</div>' +
      '<div class="rg-dp-footer">' +
        '<div class="rg-dp-footer-actions">' +
          '<button type="button" class="rg-dp-foot-btn is-today-btn" data-dp-action="today">' + todayLabel + '</button>' +
          '<button type="button" class="rg-dp-foot-btn is-clear-btn" data-dp-action="clear">' + clearLabel + '</button>' +
        '</div>' +
        '<button type="button" class="rg-dp-foot-btn is-done-btn" data-dp-action="close">' + closeLabel + '</button>' +
      '</div>';

    // Bind internal controls
    pop.querySelectorAll('[data-dp-role]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var nextRole = btn.getAttribute('data-dp-role');
        activeSession.activeRole = nextRole;
        activeSession.activeInput = nextRole === 'end' ? activeSession.endInput : activeSession.startInput;
        var targetVal = activeSession.activeInput._rgDatePicker.committedValue;
        var parsed = parseIso(targetVal);
        if (parsed) {
          activeSession.viewYear = parsed.year;
          activeSession.viewMonth = parsed.month;
          activeSession.focusIso = targetVal;
        }
        renderPopoverContent();
      });
    });

    pop.querySelectorAll('[data-dp-nav]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var dir = parseInt(btn.getAttribute('data-dp-nav'), 10);
        if (activeSession.viewMode === 'years') {
          activeSession.viewYear += dir * 12;
        } else if (activeSession.viewMode === 'months') {
          activeSession.viewYear += dir;
        } else if (c && c.shiftCalendarMonth) {
          var shifted = c.shiftCalendarMonth(activeSession.viewYear, activeSession.viewMonth, dir);
          activeSession.viewYear = shifted.year;
          activeSession.viewMonth = shifted.month;
        } else {
          var dt = new Date(activeSession.viewYear, activeSession.viewMonth - 1 + dir, 1);
          activeSession.viewYear = dt.getFullYear();
          activeSession.viewMonth = dt.getMonth() + 1;
        }
        renderPopoverContent();
      });
    });

    pop.querySelectorAll('[data-dp-action]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var act = btn.getAttribute('data-dp-action');
        if (act === 'show-months') {
          activeSession.viewMode = 'months';
          renderPopoverContent();
        } else if (act === 'show-years') {
          activeSession.viewMode = 'years';
          renderPopoverContent();
        } else if (act === 'show-days') {
          activeSession.viewMode = 'days';
          renderPopoverContent();
        } else if (act === 'today') {
          var tIso = getTodayIso();
          var tBounds = getConstraintBoundsForInput(activeSession.activeInput || activeSession.input);
          var validToday = validateIso(tIso, { minDate: tBounds.minDate, maxDate: tBounds.maxDate, lang: lang });
          var tp = parseIso(tIso);
          if (tp) {
            activeSession.viewYear = tp.year;
            activeSession.viewMonth = tp.month;
            activeSession.viewMode = 'days';
            activeSession.focusIso = tIso;
          }
          if (validToday.valid) {
            handleDayCellSelect(tIso);
          } else {
            renderPopoverContent();
          }
        } else if (act === 'clear') {
          if (activeSession.isRange && activeSession.startInput && activeSession.endInput) {
            syncRangeInputValues(activeSession.startInput, activeSession.endInput, '', '', true);
            activeSession.activeRole = 'start';
            activeSession.activeInput = activeSession.startInput;
          } else {
            commitValueOnInput(activeSession.input, '', { emitChange: true, syncCalendar: false });
          }
          closeActivePopover({ restoreFocus: true });
        } else if (act === 'close') {
          closeActivePopover({ restoreFocus: true });
        }
      });
    });

    pop.querySelectorAll('[data-dp-month]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        activeSession.viewMonth = parseInt(btn.getAttribute('data-dp-month'), 10);
        activeSession.viewMode = 'days';
        renderPopoverContent();
      });
    });

    pop.querySelectorAll('[data-dp-year]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        activeSession.viewYear = parseInt(btn.getAttribute('data-dp-year'), 10);
        activeSession.viewMode = 'months';
        renderPopoverContent();
      });
    });

    pop.querySelectorAll('.rg-dp-day[data-iso]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.disabled) return;
        handleDayCellSelect(btn.getAttribute('data-iso'));
      });
      if (activeSession.isRange) {
        btn.addEventListener('mouseenter', function () {
          if (!btn.disabled) updateRangeHoverPreview(btn.getAttribute('data-iso'));
        });
      }
    });

    positionPopover();
  }

  function openPopoverForInput(inputEl, opts) {
    if (!inputEl || !inputEl._rgDatePicker || inputEl.disabled) return;
    var o = opts || {};

    if (activeSession && activeSession.input === inputEl && o.toggle) {
      closeActivePopover({ restoreFocus: true });
      return;
    }

    closeActivePopover({ restoreFocus: false });

    // Close open dropdowns so popovers don't overlap
    if (root.RGCrmDropdowns && root.RGCrmDropdowns.closeActive) {
      root.RGCrmDropdowns.closeActive();
    }

    var pair = getPairInputs(inputEl);
    var isRange = Boolean(pair);
    var meta = getRangeMeta(inputEl);
    var initialIso = inputEl._rgDatePicker.committedValue || (pair && pair.startInput._rgDatePicker.committedValue) || getTodayIso();
    var parsed = parseIso(initialIso) || parseIso(getTodayIso());

    var portal = ensurePortal();
    var backdrop = document.createElement('div');
    backdrop.className = 'rg-dp-mobile-backdrop';
    backdrop.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeActivePopover({ restoreFocus: true });
    });

    var pop = document.createElement('div');
    pop.className = 'rg-dp-popover' + (isRange ? ' is-range' : '');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-label', getAccessibleLabel(inputEl));
    pop.tabIndex = -1;

    portal.appendChild(backdrop);
    portal.appendChild(pop);

    activeSession = {
      input: inputEl,
      peerInput: pair ? (pair.startInput === inputEl ? pair.endInput : pair.startInput) : null,
      startInput: pair ? pair.startInput : null,
      endInput: pair ? pair.endInput : null,
      isRange: isRange,
      activeRole: meta ? meta.role : 'single',
      activeInput: inputEl,
      restoreTarget: o.restoreTarget || inputEl,
      backdrop: backdrop,
      popover: pop,
      viewYear: parsed.year,
      viewMonth: parsed.month,
      viewMode: 'days',
      focusIso: initialIso
    };

    inputEl.setAttribute('aria-expanded', 'true');
    inputEl._rgDatePicker.wrap.classList.add('is-open');
    if (activeSession.peerInput && activeSession.peerInput._rgDatePicker) {
      activeSession.peerInput._rgDatePicker.wrap.classList.add('is-open');
    }

    renderPopoverContent();

    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(function () {
        if (activeSession && activeSession.popover === pop) {
          pop.classList.add('is-open');
          if (o.focusPopover) {
            try { pop.focus({ preventScroll: true }); } catch (_e) {}
          }
        }
      });
    } else {
      pop.classList.add('is-open');
      if (o.focusPopover) {
        try { pop.focus({ preventScroll: true }); } catch (_e) {}
      }
    }
  }

  function moveFocusedDateByDays(deltaDays) {
    if (!activeSession) return;
    var base = parseIso(activeSession.focusIso) || parseIso(getTodayIso());
    var dt = new Date(Date.UTC(base.year, base.month - 1, base.day + deltaDays));
    var c = core();
    var nextIso = c && c.formatIsoDateParts
      ? c.formatIsoDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
      : dt.toISOString().slice(0, 10);
    activeSession.focusIso = nextIso;
    activeSession.viewYear = dt.getUTCFullYear();
    activeSession.viewMonth = dt.getUTCMonth() + 1;
    activeSession.viewMode = 'days';
    renderPopoverContent();
  }

  function handlePopoverKeyDown(ev) {
    if (!activeSession) return false;
    var rtl = isRtl();

    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeActivePopover({ restoreFocus: true });
      return true;
    }

    // If user is typing digits/hyphens/backspace into the text box itself, don't hijack navigation keys
    var isInputFocused = document.activeElement === activeSession.input ||
      (activeSession.peerInput && document.activeElement === activeSession.peerInput);

    if (isInputFocused && ev.key === 'ArrowDown' && ev.altKey) {
      ev.preventDefault();
      activeSession.popover.focus();
      return true;
    }
    if (isInputFocused && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === 'Home' || ev.key === 'End')) {
      return false;
    }

    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      moveFocusedDateByDays(rtl ? 1 : -1);
      return true;
    }
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      moveFocusedDateByDays(rtl ? -1 : 1);
      return true;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      moveFocusedDateByDays(-7);
      return true;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      moveFocusedDateByDays(7);
      return true;
    }
    if (ev.key === 'PageUp') {
      ev.preventDefault();
      var c = core();
      if (c && c.shiftCalendarMonth) {
        var prev = c.shiftCalendarMonth(activeSession.viewYear, activeSession.viewMonth, -1);
        activeSession.viewYear = prev.year;
        activeSession.viewMonth = prev.month;
        renderPopoverContent();
      }
      return true;
    }
    if (ev.key === 'PageDown') {
      ev.preventDefault();
      var c2 = core();
      if (c2 && c2.shiftCalendarMonth) {
        var nxt = c2.shiftCalendarMonth(activeSession.viewYear, activeSession.viewMonth, 1);
        activeSession.viewYear = nxt.year;
        activeSession.viewMonth = nxt.month;
        renderPopoverContent();
      }
      return true;
    }
    if (ev.key === 'Enter' && !isInputFocused && activeSession.focusIso) {
      ev.preventDefault();
      var dayBtn = activeSession.popover.querySelector('.rg-dp-day[data-iso="' + activeSession.focusIso + '"]');
      if (dayBtn && !dayBtn.disabled) {
        handleDayCellSelect(activeSession.focusIso);
      }
      return true;
    }
    if (ev.key === 'Tab') {
      closeActivePopover({ restoreFocus: false });
      return false;
    }
    return false;
  }

  function enhanceDateInput(inputEl) {
    if (!inputEl || inputEl.tagName !== 'INPUT') return;
    if (inputEl.getAttribute('data-rg-native') === 'true') return;
    if (inputEl.dataset[ENHANCED_FLAG] === '1') {
      updateFieldVisualState(inputEl);
      return;
    }
    if (String(inputEl.getAttribute('type') || '').toLowerCase() !== 'date') return;

    inputEl.dataset[ENHANCED_FLAG] = '1';
    var initialRaw = getNativeInputText(inputEl) || inputEl.getAttribute('value') || '';
    var initialCheck = validateIso(initialRaw, { lang: getLang() });
    var initialVal = initialCheck.valid ? initialCheck.normalized : '';

    var wrap = document.createElement('div');
    wrap.className = 'rg-date-wrap';
    if (inputEl.style && inputEl.style.width && inputEl.style.width !== 'auto') {
      wrap.style.width = inputEl.style.width;
    }

    var fieldRow = document.createElement('div');
    fieldRow.className = 'rg-date-field';

    var parent = inputEl.parentNode;
    if (parent) {
      parent.insertBefore(wrap, inputEl);
      fieldRow.appendChild(inputEl);
      wrap.appendChild(fieldRow);
    }

    // Transform native date input into editable YYYY-MM-DD text input preserving ID, classes & listeners
    inputEl.type = 'text';
    inputEl.classList.add('rg-date-input', 'mono');
    inputEl.setAttribute('dir', 'ltr');
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('spellcheck', 'false');
    inputEl.setAttribute('maxlength', '10');
    inputEl.setAttribute('placeholder', 'YYYY-MM-DD');
    inputEl.setAttribute('aria-haspopup', 'dialog');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.style.width = '';

    setNativeInputText(inputEl, initialVal);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'rg-date-clear-btn hidden';
    clearBtn.setAttribute('aria-label', getLang() === 'en' ? 'Clear date' : 'مسح التاريخ');
    clearBtn.setAttribute('title', getLang() === 'en' ? 'Clear date' : 'مسح التاريخ');
    clearBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    var triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'rg-date-trigger-btn';
    triggerBtn.setAttribute('aria-label', getLang() === 'en' ? 'Open calendar' : 'فتح التقويم');
    triggerBtn.setAttribute('title', getLang() === 'en' ? 'Open calendar' : 'فتح التقويم');
    triggerBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

    fieldRow.appendChild(clearBtn);
    fieldRow.appendChild(triggerBtn);

    var errorEl = document.createElement('div');
    errorEl.className = 'rg-date-error hidden';
    errorEl.setAttribute('role', 'alert');
    wrap.appendChild(errorEl);

    inputEl._rgDatePicker = {
      wrap: wrap,
      fieldRow: fieldRow,
      clearBtn: clearBtn,
      triggerBtn: triggerBtn,
      errorEl: errorEl,
      committedValue: initialVal,
      draftValue: initialVal,
      syntaxError: '',
      rangeError: '',
      errorMessage: '',
      isValid: function () {
        var curDraft = getNativeInputText(inputEl).trim();
        if (!curDraft) {
          return !inputEl.required;
        }
        var b = getConstraintBoundsForInput(inputEl);
        var check = validateIso(curDraft, { minDate: b.minDate, maxDate: b.maxDate, required: inputEl.required, lang: getLang() });
        return Boolean(check.valid && !this.rangeError);
      },
      getDraftValue: function () {
        return getNativeInputText(inputEl).trim();
      }
    };

    patchInputValueDescriptor(inputEl);
    updateFieldVisualState(inputEl);

    // Clicking the date input opens the interactive calendar while keeping keyboard focus for typing
    inputEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!activeSession || activeSession.input !== inputEl) {
        openPopoverForInput(inputEl, { toggle: false, restoreTarget: inputEl });
      }
    });

    triggerBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openPopoverForInput(inputEl, { toggle: true, restoreTarget: triggerBtn, focusPopover: true });
    });

    clearBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      commitValueOnInput(inputEl, '', { emitChange: true, syncCalendar: true });
      inputEl.focus({ preventScroll: true });
    });

    inputEl.addEventListener('input', function () {
      var st = inputEl._rgDatePicker;
      if (!st) return;
      var raw = getNativeInputText(inputEl);
      var c = core();
      var sanitized = (c && c.sanitizeManualDateInput)
        ? c.sanitizeManualDateInput(raw, st.draftValue)
        : raw.replace(/[^0-9-]/g, '').slice(0, 10);

      if (sanitized !== raw) {
        setNativeInputText(inputEl, sanitized);
      }
      st.draftValue = sanitized;

      if (!sanitized) {
        st.syntaxError = '';
        st.errorMessage = '';
        commitValueOnInput(inputEl, '', { keepDraft: true, emitChange: true, syncCalendar: true });
        return;
      }

      var bounds = getConstraintBoundsForInput(inputEl);
      if (sanitized.length === 10) {
        var check = validateIso(sanitized, {
          minDate: bounds.minDate,
          maxDate: bounds.maxDate,
          required: Boolean(inputEl.required),
          lang: getLang()
        });
        if (check.valid) {
          st.syntaxError = '';
          st.errorMessage = '';
          commitValueOnInput(inputEl, check.normalized, { keepDraft: true, emitChange: true, syncCalendar: true });
        } else {
          st.syntaxError = check.message;
          st.errorMessage = check.message;
          updateFieldVisualState(inputEl);
        }
      } else {
        // Still typing partial YYYY-MM-DD: clear stale syntax error until 10 chars or blur
        st.syntaxError = '';
        st.errorMessage = st.rangeError || '';
        updateFieldVisualState(inputEl);
      }
    });

    inputEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var draft = getNativeInputText(inputEl).trim();
        var bounds = getConstraintBoundsForInput(inputEl);
        var check = validateIso(draft, { minDate: bounds.minDate, maxDate: bounds.maxDate, required: Boolean(inputEl.required), lang: getLang() });
        if (!check.valid) {
          ev.preventDefault();
          inputEl._rgDatePicker.syntaxError = check.message;
          inputEl._rgDatePicker.errorMessage = check.message;
          updateFieldVisualState(inputEl);
        } else {
          commitValueOnInput(inputEl, check.normalized, { emitChange: true, syncCalendar: true });
          if (activeSession && activeSession.input === inputEl) {
            closeActivePopover({ restoreFocus: false });
          }
        }
      }
    });

    inputEl.addEventListener('blur', function () {
      var st = inputEl._rgDatePicker;
      if (!st) return;
      var draft = getNativeInputText(inputEl).trim();
      var bounds = getConstraintBoundsForInput(inputEl);
      var check = validateIso(draft, {
        minDate: bounds.minDate,
        maxDate: bounds.maxDate,
        required: Boolean(inputEl.required),
        lang: getLang()
      });
      if (!check.valid) {
        st.syntaxError = check.message;
        st.errorMessage = check.message;
        updateFieldVisualState(inputEl);
      } else {
        st.syntaxError = '';
        st.errorMessage = st.rangeError || '';
        if (check.normalized !== st.committedValue) {
          commitValueOnInput(inputEl, check.normalized, { emitChange: true, syncCalendar: true });
        } else {
          updateFieldVisualState(inputEl);
        }
      }
    });
  }

  function enhanceAll(container) {
    var rootEl = container || document;
    var inputs = rootEl.querySelectorAll('input[type="date"]');
    inputs.forEach(function (inp) {
      enhanceDateInput(inp);
    });
  }

  function validateContainerDates(container) {
    var rootEl = container || document;
    var wrapped = rootEl.querySelectorAll('input.rg-date-input');
    for (var i = 0; i < wrapped.length; i++) {
      var el = wrapped[i];
      if (el._rgDatePicker && !el._rgDatePicker.isValid()) {
        el.focus({ preventScroll: false });
        return { valid: false, element: el, message: el._rgDatePicker.errorMessage || 'تاريخ غير صالح' };
      }
    }
    return { valid: true, element: null, message: '' };
  }

  function bindGlobalEvents() {
    if (globalEventsBound) return;
    globalEventsBound = true;

    document.addEventListener('click', function (ev) {
      if (!activeSession) return;
      var target = ev.target;
      if (activeSession.popover && activeSession.popover.contains(target)) return;
      if (activeSession.input && activeSession.input._rgDatePicker && activeSession.input._rgDatePicker.wrap.contains(target)) return;
      if (activeSession.peerInput && activeSession.peerInput._rgDatePicker && activeSession.peerInput._rgDatePicker.wrap.contains(target)) return;
      closeActivePopover({ restoreFocus: false });
    });

    document.addEventListener('keydown', function (ev) {
      if (!activeSession) return;
      handlePopoverKeyDown(ev);
    }, true);

    window.addEventListener('resize', function () {
      if (activeSession) positionPopover();
    });

    window.addEventListener('scroll', function (ev) {
      if (!activeSession) return;
      if (activeSession.popover && ev.target && (ev.target === activeSession.popover || activeSession.popover.contains(ev.target))) {
        return;
      }
      positionPopover();
    }, true);
  }

  function init() {
    bindGlobalEvents();
    enhanceAll(document);

    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function (mutations) {
      if (activeSession && (!activeSession.input || !activeSession.input.isConnected)) {
        closeActivePopover({ restoreFocus: false });
      }
      var inputsToSync = new Set();
      var containersToScan = new Set();

      mutations.forEach(function (m) {
        var target = m.target;
        if (!target) return;
        if (target.id === PORTAL_ID || (target.closest && target.closest('#' + PORTAL_ID))) return;

        if (target.tagName === 'INPUT' && target.dataset && target.dataset[ENHANCED_FLAG] === '1') {
          inputsToSync.add(target);
          return;
        }
        if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach(function (node) {
            if (node && node.nodeType === 1) {
              if (node.tagName === 'INPUT' && String(node.getAttribute('type') || '').toLowerCase() === 'date') {
                inputsToSync.add(node);
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
      inputsToSync.forEach(function (inp) {
        if (inp.dataset[ENHANCED_FLAG] === '1') {
          updateFieldVisualState(inp);
        } else {
          enhanceDateInput(inp);
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'min', 'max', 'required']
    });
  }

  root.RGCrmDatePicker = {
    init: init,
    enhanceAll: enhanceAll,
    validateContainerDates: validateContainerDates,
    closeActive: function () { return closeActivePopover({ restoreFocus: true }); },
    isOpen: function () { return Boolean(activeSession); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
