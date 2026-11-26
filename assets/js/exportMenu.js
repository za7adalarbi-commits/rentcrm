/**
 * RENTAL GATE CRM — Unified Export Button & Dropdown Menu Component
 * Unifies PDF Studio & Branded Excel export under a single consistent "تصدير" / "Export" button.
 */
(function (root) {
  'use strict';

  var activeRegistry = [];
  var globalListenersBound = false;

  function esc(val) {
    return String(val === undefined || val === null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeAllMenus(exceptWrap) {
    for (var i = activeRegistry.length - 1; i >= 0; i--) {
      var item = activeRegistry[i];
      if (!item || !item.wrap || !item.wrap.isConnected) {
        activeRegistry.splice(i, 1);
        continue;
      }
      if (exceptWrap && item.wrap === exceptWrap) continue;
      item.close();
    }
  }

  function ensureGlobalListeners() {
    if (globalListenersBound || typeof document === 'undefined') return;
    globalListenersBound = true;

    document.addEventListener('click', function (ev) {
      var target = ev.target;
      for (var i = activeRegistry.length - 1; i >= 0; i--) {
        var entry = activeRegistry[i];
        if (!entry || !entry.wrap || !entry.wrap.isConnected) {
          activeRegistry.splice(i, 1);
          continue;
        }
        if (entry.isOpen() && !entry.wrap.contains(target)) {
          entry.close();
        }
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      for (var i = activeRegistry.length - 1; i >= 0; i--) {
        var entry = activeRegistry[i];
        if (!entry || !entry.wrap || !entry.wrap.isConnected) {
          activeRegistry.splice(i, 1);
          continue;
        }
        if (entry.isOpen()) {
          entry.close(true);
        }
      }
    });
  }

  function renderHtml(opts) {
    var cfg = opts || {};
    var canPdf = cfg.canPdf !== false;
    var canExcel = cfg.canExcel !== false;
    if (!canPdf && !canExcel) return '';

    var lang = cfg.lang === 'en' ? 'en' : ((typeof document !== 'undefined' && document.documentElement.getAttribute('lang') === 'en') ? 'en' : 'ar');
    var isEn = lang === 'en';
    var wrapId = cfg.wrapId || '';
    var btnId = cfg.btnId || '';
    var menuId = cfg.menuId || (btnId ? (btnId + '-menu') : '');
    var extraWrapClass = cfg.extraWrapClass ? (' ' + cfg.extraWrapClass) : '';
    var btnSizeClass = cfg.small ? ' btn-sm' : '';
    var label = cfg.label || (isEn ? 'Export' : 'تصدير');

    var pdfTitle = isEn ? 'Export PDF' : 'تصدير PDF';
    var pdfHint = isEn ? 'Customize & preview before saving' : 'إعدادات ومعاينة قبل الحفظ';
    var excelTitle = isEn ? 'Export Excel' : 'تصدير Excel';
    var excelHint = isEn ? 'Branded .xlsx ready for filter & sort' : 'ملف .xlsx منسّق وجاهز للفرز';

    return '<div class="rg-export-menu-wrap' + esc(extraWrapClass) + '"' + (wrapId ? (' id="' + esc(wrapId) + '"') : '') + ' data-rg-export-menu="1">' +
      '<button type="button" class="btn btn-primary' + btnSizeClass + ' rg-export-trigger"' +
        (btnId ? (' id="' + esc(btnId) + '"') : '') +
        ' aria-haspopup="menu" aria-expanded="false"' +
        (menuId ? (' aria-controls="' + esc(menuId) + '"') : '') + '>' +
        '<svg class="rg-export-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<polyline points="7 10 12 15 17 10"/>' +
          '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>' +
        '<span>' + esc(label) + '</span>' +
        '<svg class="rg-export-caret" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="6 9 12 15 18 9"/>' +
        '</svg>' +
      '</button>' +
      '<div class="rg-export-dropdown hidden"' + (menuId ? (' id="' + esc(menuId) + '"') : '') + ' role="menu" aria-label="' + esc(label) + '">' +
        (canPdf ? (
          '<button type="button" class="rg-export-item rg-export-opt-pdf" data-export-format="pdf" role="menuitem">' +
            '<span class="rg-export-item-badge is-pdf" aria-hidden="true">PDF</span>' +
            '<span class="rg-export-item-text">' +
              '<span class="rg-export-item-title">' + esc(pdfTitle) + '</span>' +
              '<span class="rg-export-item-sub">' + esc(pdfHint) + '</span>' +
            '</span>' +
          '</button>'
        ) : '') +
        (canExcel ? (
          '<button type="button" class="rg-export-item rg-export-opt-excel" data-export-format="excel" role="menuitem">' +
            '<span class="rg-export-item-badge is-excel" aria-hidden="true">XLSX</span>' +
            '<span class="rg-export-item-text">' +
              '<span class="rg-export-item-title">' + esc(excelTitle) + '</span>' +
              '<span class="rg-export-item-sub">' + esc(excelHint) + '</span>' +
            '</span>' +
          '</button>'
        ) : '') +
      '</div>' +
    '</div>';
  }

  function adjustMenuPlacement(wrap, dropdown) {
    if (!wrap || !dropdown || typeof window === 'undefined') return;
    dropdown.classList.remove('align-end-flip');
    var rect = dropdown.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (rect.left < 8 || rect.right > vw - 8) {
      dropdown.classList.add('align-end-flip');
    }
  }

  function bind(wrapOrSelector, handlers) {
    ensureGlobalListeners();
    var wrap = (typeof wrapOrSelector === 'string')
      ? document.querySelector(wrapOrSelector)
      : wrapOrSelector;
    if (!wrap) return null;

    var trigger = wrap.querySelector('.rg-export-trigger');
    var dropdown = wrap.querySelector('.rg-export-dropdown');
    if (!trigger || !dropdown) return null;

    var opts = handlers || {};

    function isOpen() {
      return !dropdown.classList.contains('hidden');
    }

    function open() {
      closeAllMenus(wrap);
      dropdown.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      adjustMenuPlacement(wrap, dropdown);
    }

    function close(restoreFocus) {
      if (!isOpen()) return;
      dropdown.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      if (restoreFocus && trigger.isConnected) {
        try { trigger.focus({ preventScroll: true }); } catch (_e) {}
      }
    }

    if (wrap._rgExportBound) return wrap._rgExportApi;
    wrap._rgExportBound = true;

    trigger.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (trigger.disabled) return;
      if (isOpen()) close(false);
      else open();
    });

    dropdown.querySelectorAll('.rg-export-item').forEach(function (itemBtn) {
      itemBtn.addEventListener('click', async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var fmt = itemBtn.getAttribute('data-export-format');
        close(false);
        if (fmt === 'pdf' && typeof opts.onPdf === 'function') {
          try {
            await opts.onPdf(trigger, itemBtn);
          } catch (err) {
            if (opts.onError) opts.onError(err, 'pdf');
          }
        } else if (fmt === 'excel' && typeof opts.onExcel === 'function') {
          var prevDisabled = trigger.disabled;
          trigger.disabled = true;
          trigger.setAttribute('aria-busy', 'true');
          try {
            await opts.onExcel(trigger, itemBtn);
          } catch (err2) {
            if (opts.onError) opts.onError(err2, 'excel');
          } finally {
            trigger.disabled = prevDisabled;
            trigger.removeAttribute('aria-busy');
          }
        }
      });
    });

    var api = {
      wrap: wrap,
      open: open,
      close: close,
      isOpen: isOpen
    };
    wrap._rgExportApi = api;
    activeRegistry.push(api);
    return api;
  }

  root.RGExportMenu = {
    renderHtml: renderHtml,
    bind: bind,
    closeAllMenus: closeAllMenus
  };
})(window);
