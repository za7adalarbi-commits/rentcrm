/**
 * RENTAL GATE CRM — Smart PDF Density, Layout Presets & File Optimization Control Panel
 */
(function (root) {
  'use strict';

  var PREFS_STORAGE_KEY = 'rg_crm_pdf_export_prefs_v1';

  function core() {
    return root.RGCrmCore || null;
  }

  function getLang(overrideLang) {
    if (overrideLang === 'en' || overrideLang === 'ar') return overrideLang;
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function savePrefs(settings) {
    try {
      if (!settings || typeof settings !== 'object') return;
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({
        targetPages: settings.targetPages,
        preset: settings.preset,
        optimizeFileSize: Boolean(settings.optimizeFileSize),
        quality: settings.quality,
        paperSize: settings.paperSize,
        orientation: settings.orientation
      }));
    } catch (_e) {}
  }

  function createDefaultState(overrides) {
    var saved = loadPrefs();
    var merged = Object.assign({
      targetPages: 3,
      preset: 'balanced',
      optimizeFileSize: true,
      quality: 'balanced',
      paperSize: 'a4',
      orientation: 'landscape'
    }, saved, overrides || {});
    if (merged.paperSize !== 'a4' && merged.paperSize !== 'letter') {
      merged.paperSize = (overrides && overrides.paperSize) || saved.paperSize || 'a4';
    }
    var c = core();
    return (c && c.resolvePdfExportSettings) ? c.resolvePdfExportSettings(merged) : merged;
  }

  function formatKb(bytes, isEn) {
    var kb = Math.max(1, Math.round(Number(bytes || 0) / 1024));
    if (kb >= 1024) {
      var mb = Math.round((kb / 1024) * 10) / 10;
      return mb + ' ' + (isEn ? 'MB' : 'MB');
    }
    return kb + ' KB';
  }

  function computePlanForState(settings, contentStats, lang) {
    var c = core();
    if (!c || !c.computePdfLayoutPlan) {
      return {
        estimatedPages: settings.targetPages || 3,
        estimatedBytes: 140000,
        readabilityWarning: false,
        warningMessage: '',
        baseFont: 9.3,
        marginPt: 30,
        jpegQuality: 0.76
      };
    }
    return c.computePdfLayoutPlan(Object.assign({}, settings, contentStats || {}, { lang: lang }));
  }

  function getStrings(isEn) {
    if (isEn) {
      return {
        panelTitle: 'Smart PDF Layout & Compression',
        targetPagesLabel: 'Target pages',
        minPageLabel: '1 Page',
        maxPageLabel: '10 Pages',
        presetLabel: 'Layout Preset',
        presetCompact: 'Compact',
        presetBalanced: 'Balanced',
        presetComfortable: 'Comfortable',
        presetCustom: 'Custom',
        optimizeLabel: 'Optimize PDF File Size',
        optimizeSub: 'Compresses images, streams & strips redundant metadata',
        qualityLabel: 'Export Quality',
        qualitySmall: 'Small File',
        qualityBalanced: 'Balanced',
        qualityHigh: 'High Quality',
        estLabel: 'Estimated',
        actualLabel: 'Generated',
        pagesWord: 'pages',
        pageWord: 'page',
        advToggle: 'Advanced Settings',
        paperLabel: 'Paper Size',
        orientLabel: 'Orientation',
        orientLandscape: 'Landscape',
        orientPortrait: 'Portrait',
        metricsPrefix: 'Typography',
        marginsWord: 'Margins'
      };
    }
    return {
      panelTitle: 'التحكم الذكي في ضغط وكثافة صفحات PDF',
      targetPagesLabel: 'الصفحات المستهدفة',
      minPageLabel: '1 صفحة',
      maxPageLabel: '10 صفحات',
      presetLabel: 'نمط التخطيط',
      presetCompact: 'مضغوط',
      presetBalanced: 'متوازن',
      presetComfortable: 'مريح',
      presetCustom: 'مخصص',
      optimizeLabel: 'ضغط وتحسين حجم ملف PDF',
      optimizeSub: 'ضغط الصور والتدفقات وإزالة البيانات الوصفية الزائدة',
      qualityLabel: 'جودة الملف',
      qualitySmall: 'ملف صغير',
      qualityBalanced: 'متوازن',
      qualityHigh: 'جودة عالية',
      estLabel: 'التقدير',
      actualLabel: 'الفعلي',
      pagesWord: 'صفحات',
      pageWord: 'صفحة',
      advToggle: 'إعدادات متقدمة',
      paperLabel: 'حجم الورق',
      orientLabel: 'الاتجاه',
      orientLandscape: 'أفقي (Landscape)',
      orientPortrait: 'عمودي (Portrait)',
      metricsPrefix: 'الخط',
      marginsWord: 'الهوامش'
    };
  }

  function renderPanelHtml(options) {
    var opts = options || {};
    var lang = getLang(opts.lang);
    var isEn = lang === 'en';
    var s = getStrings(isEn);
    var mode = opts.mode === 'preview' ? 'preview' : 'modal';
    var uid = opts.idPrefix || ('rg-pdfc-' + mode);
    var st = createDefaultState(opts.settings);
    var plan = computePlanForState(st, opts.contentStats, lang);
    var pct = Math.round(((st.targetPages - 1) / 9) * 100);
    var pageUnit = plan.estimatedPages === 1 ? s.pageWord : s.pagesWord;
    var showPaperInAdv = opts.showPaperControls !== false;

    var ticksHtml = '';
    for (var tk = 1; tk <= 10; tk++) {
      ticksHtml += '<button type="button" class="rg-density-tick' + (tk === st.targetPages ? ' is-active' : '') + '" data-tick="' + tk + '" aria-label="' + esc(s.targetPagesLabel + ': ' + tk) + '">' + tk + '</button>';
    }

    return (
      '<section class="rg-pdf-ctrl-panel is-mode-' + mode + '" id="' + uid + '" data-rg-pdf-controls="' + mode + '">' +
        '<div class="rg-pdf-ctrl-top">' +
          '<div class="rg-pdf-slider-block">' +
            '<div class="rg-pdf-slider-head">' +
              '<label class="rg-pdf-ctrl-heading" for="' + uid + '-slider">' +
                '<span>' + esc(s.panelTitle) + '</span>' +
              '</label>' +
              '<div class="rg-pdf-target-readout" aria-live="polite">' +
                '<span>' + esc(s.targetPagesLabel) + ':</span> ' +
                '<strong class="mono tabular-nums" data-role="target-val">' + st.targetPages + '</strong>' +
                '<span class="rg-pdf-custom-tag' + (st.preset === 'custom' ? '' : ' hidden') + '" data-role="custom-tag">· ' + esc(s.presetCustom) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="rg-density-slider-wrap">' +
              '<input type="range" class="rg-density-slider" id="' + uid + '-slider" min="1" max="10" step="1" value="' + st.targetPages + '" style="--slider-pct:' + pct + '%;" aria-valuemin="1" aria-valuemax="10" aria-valuenow="' + st.targetPages + '" aria-label="' + esc(s.targetPagesLabel) + '">' +
              '<div class="rg-density-ticks" aria-hidden="true">' + ticksHtml + '</div>' +
              '<div class="rg-density-scale-row">' +
                '<span>' + esc(s.minPageLabel) + '</span>' +
                '<span>' + esc(s.maxPageLabel) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="rg-pdf-presets-block">' +
            '<span class="rg-pdf-mini-label">' + esc(s.presetLabel) + '</span>' +
            '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.presetLabel) + '">' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'compact' ? ' is-active' : '') + '" data-preset="compact" aria-pressed="' + (st.preset === 'compact') + '">' + esc(s.presetCompact) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'balanced' ? ' is-active' : '') + '" data-preset="balanced" aria-pressed="' + (st.preset === 'balanced') + '">' + esc(s.presetBalanced) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'comfortable' ? ' is-active' : '') + '" data-preset="comfortable" aria-pressed="' + (st.preset === 'comfortable') + '">' + esc(s.presetComfortable) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-ctrl-mid">' +
          '<div class="rg-pdf-opt-row">' +
            '<label class="rg-pdf-switch-label" for="' + uid + '-opt-toggle">' +
              '<input type="checkbox" class="rg-pdf-switch-input" id="' + uid + '-opt-toggle"' + (st.optimizeFileSize ? ' checked' : '') + '>' +
              '<span class="rg-pdf-switch-track" aria-hidden="true"><span class="rg-pdf-switch-thumb"></span></span>' +
              '<span class="rg-pdf-switch-copy">' +
                '<span class="rg-pdf-switch-title">' + esc(s.optimizeLabel) + '</span>' +
                (mode === 'modal' ? '<span class="rg-pdf-switch-sub">' + esc(s.optimizeSub) + '</span>' : '') +
              '</span>' +
            '</label>' +

            '<div class="rg-pdf-quality-wrap' + (st.optimizeFileSize ? '' : ' is-disabled') + '" data-role="quality-wrap">' +
              '<span class="rg-pdf-mini-label">' + esc(s.qualityLabel) + '</span>' +
              '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.qualityLabel) + '">' +
                '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'small' ? ' is-active' : '') + '" data-quality="small" aria-pressed="' + (st.quality === 'small') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualitySmall) + '</button>' +
                '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'balanced' ? ' is-active' : '') + '" data-quality="balanced" aria-pressed="' + (st.quality === 'balanced') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualityBalanced) + '</button>' +
                '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'high' ? ' is-active' : '') + '" data-quality="high" aria-pressed="' + (st.quality === 'high') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualityHigh) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="rg-pdf-meta-bar">' +
            '<div class="rg-pdf-est-summary" data-role="est-summary">' +
              '<span data-role="est-prefix">' + esc(s.estLabel) + ':</span> ' +
              '<strong class="tabular-nums" data-role="est-pages">' + plan.estimatedPages + ' ' + esc(pageUnit) + '</strong>' +
              '<span aria-hidden="true">·</span>' +
              '<strong class="mono tabular-nums" dir="ltr" data-role="est-size">~' + esc(formatKb(plan.estimatedBytes, isEn)) + '</strong>' +
              '<span aria-hidden="true">·</span>' +
              '<span class="rg-pdf-tech-hint tabular-nums" data-role="tech-hint">' + esc(s.metricsPrefix) + ' ' + plan.baseFont + 'pt · ' + esc(s.marginsWord) + ' ' + plan.marginPt + 'pt</span>' +
            '</div>' +
            '<button type="button" class="rg-pdf-adv-toggle" id="' + uid + '-adv-btn" aria-expanded="false" aria-controls="' + uid + '-adv-body">' +
              '<span>' + esc(s.advToggle) + '</span>' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-warning-banner' + (plan.readabilityWarning ? '' : ' hidden') + '" data-role="warning-banner" role="status" aria-live="polite">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
          '<span data-role="warning-text">' + esc(plan.warningMessage || '') + '</span>' +
        '</div>' +

        '<div class="rg-pdf-adv-body hidden" id="' + uid + '-adv-body">' +
          (showPaperInAdv
            ? '<div class="rg-pdf-adv-grid">' +
                '<div class="rg-pdf-adv-field">' +
                  '<label class="form-label" for="' + uid + '-paper">' + esc(s.paperLabel) + '</label>' +
                  '<select class="select" id="' + uid + '-paper" data-role="paper-select">' +
                    '<option value="a4"' + (st.paperSize === 'a4' ? ' selected' : '') + '>A4</option>' +
                    '<option value="letter"' + (st.paperSize === 'letter' ? ' selected' : '') + '>Letter</option>' +
                  '</select>' +
                '</div>' +
                '<div class="rg-pdf-adv-field">' +
                  '<label class="form-label" for="' + uid + '-orient">' + esc(s.orientLabel) + '</label>' +
                  '<select class="select" id="' + uid + '-orient" data-role="orient-select">' +
                    '<option value="landscape"' + (st.orientation === 'landscape' ? ' selected' : '') + '>' + esc(s.orientLandscape) + '</option>' +
                    '<option value="portrait"' + (st.orientation === 'portrait' ? ' selected' : '') + '>' + esc(s.orientPortrait) + '</option>' +
                  '</select>' +
                '</div>' +
              '</div>'
            : '') +
          (opts.advancedExtraHtml || '') +
        '</div>' +
      '</section>'
    );
  }

  function mount(panelEl, config) {
    if (!panelEl) return null;
    var cfg = config || {};
    var lang = getLang(cfg.lang);
    var isEn = lang === 'en';
    var s = getStrings(isEn);
    var state = createDefaultState(cfg.initialSettings);
    var contentStats = cfg.contentStats || {};
    var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};

    var sliderEl = panelEl.querySelector('.rg-density-slider');
    var targetValEl = panelEl.querySelector('[data-role="target-val"]');
    var customTagEl = panelEl.querySelector('[data-role="custom-tag"]');
    var tickBtns = Array.from(panelEl.querySelectorAll('.rg-density-tick'));
    var presetBtns = Array.from(panelEl.querySelectorAll('[data-preset]'));
    var qualityBtns = Array.from(panelEl.querySelectorAll('[data-quality]'));
    var qualityWrap = panelEl.querySelector('[data-role="quality-wrap"]');
    var optToggle = panelEl.querySelector('.rg-pdf-switch-input');
    var advBtn = panelEl.querySelector('.rg-pdf-adv-toggle');
    var advBody = panelEl.querySelector('.rg-pdf-adv-body');
    var paperSelect = panelEl.querySelector('[data-role="paper-select"]');
    var orientSelect = panelEl.querySelector('[data-role="orient-select"]');

    var estPrefixEl = panelEl.querySelector('[data-role="est-prefix"]');
    var estPagesEl = panelEl.querySelector('[data-role="est-pages"]');
    var estSizeEl = panelEl.querySelector('[data-role="est-size"]');
    var techHintEl = panelEl.querySelector('[data-role="tech-hint"]');
    var warningBanner = panelEl.querySelector('[data-role="warning-banner"]');
    var warningText = panelEl.querySelector('[data-role="warning-text"]');

    function syncVisuals(actualMeta) {
      var pct = Math.round(((state.targetPages - 1) / 9) * 100);
      if (sliderEl) {
        sliderEl.value = String(state.targetPages);
        sliderEl.style.setProperty('--slider-pct', pct + '%');
        sliderEl.setAttribute('aria-valuenow', String(state.targetPages));
      }
      if (targetValEl) targetValEl.textContent = String(state.targetPages);
      if (customTagEl) customTagEl.classList.toggle('hidden', state.preset !== 'custom');

      tickBtns.forEach(function (tb) {
        tb.classList.toggle('is-active', Number(tb.getAttribute('data-tick')) === state.targetPages);
      });
      presetBtns.forEach(function (pb) {
        var active = pb.getAttribute('data-preset') === state.preset;
        pb.classList.toggle('is-active', active);
        pb.setAttribute('aria-pressed', String(active));
      });
      if (optToggle) optToggle.checked = Boolean(state.optimizeFileSize);
      if (qualityWrap) qualityWrap.classList.toggle('is-disabled', !state.optimizeFileSize);
      qualityBtns.forEach(function (qb) {
        var active = qb.getAttribute('data-quality') === state.quality;
        qb.classList.toggle('is-active', active);
        qb.setAttribute('aria-pressed', String(active));
        qb.disabled = !state.optimizeFileSize;
      });
      if (paperSelect && paperSelect.value !== state.paperSize) paperSelect.value = state.paperSize;
      if (orientSelect && orientSelect.value !== state.orientation) orientSelect.value = state.orientation;

      var plan = computePlanForState(state, contentStats, lang);
      var pagesCount = actualMeta && actualMeta.pages ? Number(actualMeta.pages) : plan.estimatedPages;
      var bytesVal = actualMeta && actualMeta.sizeBytes ? Number(actualMeta.sizeBytes) : plan.estimatedBytes;
      var warnFlag = actualMeta && actualMeta.readabilityWarning !== undefined ? Boolean(actualMeta.readabilityWarning) : plan.readabilityWarning;
      var warnMsg = (actualMeta && actualMeta.warningMessage) || plan.warningMessage || '';

      if (estPrefixEl) estPrefixEl.textContent = (actualMeta ? s.actualLabel : s.estLabel) + ':';
      if (estPagesEl) {
        var unit = pagesCount === 1 ? s.pageWord : s.pagesWord;
        estPagesEl.textContent = pagesCount + ' ' + unit;
      }
      if (estSizeEl) {
        estSizeEl.textContent = (actualMeta ? '' : '~') + formatKb(bytesVal, isEn);
      }
      if (techHintEl) {
        techHintEl.textContent = s.metricsPrefix + ' ' + plan.baseFont + 'pt · ' + s.marginsWord + ' ' + plan.marginPt + 'pt';
      }
      if (warningBanner && warningText) {
        warningBanner.classList.toggle('hidden', !warnFlag || !warnMsg);
        warningText.textContent = warnFlag ? warnMsg : '';
      }
      return plan;
    }

    function emit(triggerKind) {
      savePrefs(state);
      var plan = syncVisuals(null);
      onChange(Object.assign({}, state), plan, triggerKind);
    }

    if (sliderEl) {
      sliderEl.addEventListener('input', function () {
        var c = core();
        state.targetPages = (c && c.clampPdfTargetPages) ? c.clampPdfTargetPages(sliderEl.value) : Number(sliderEl.value || 3);
        state.preset = 'custom';
        emit('slider-input');
      });
      sliderEl.addEventListener('change', function () {
        var c = core();
        state.targetPages = (c && c.clampPdfTargetPages) ? c.clampPdfTargetPages(sliderEl.value) : Number(sliderEl.value || 3);
        emit('slider-commit');
      });
    }

    tickBtns.forEach(function (tb) {
      tb.addEventListener('click', function () {
        state.targetPages = Number(tb.getAttribute('data-tick') || 3);
        state.preset = 'custom';
        emit('tick');
      });
    });

    presetBtns.forEach(function (pb) {
      pb.addEventListener('click', function () {
        var pKey = pb.getAttribute('data-preset') || 'balanced';
        var c = core();
        var defPages = (c && c.PDF_LAYOUT_PRESETS && c.PDF_LAYOUT_PRESETS[pKey])
          ? c.PDF_LAYOUT_PRESETS[pKey].defaultTargetPages
          : (pKey === 'compact' ? 1 : (pKey === 'comfortable' ? 6 : 3));
        state.preset = pKey;
        state.targetPages = defPages;
        emit('preset');
      });
    });

    if (optToggle) {
      optToggle.addEventListener('change', function () {
        state.optimizeFileSize = Boolean(optToggle.checked);
        emit('optimize-toggle');
      });
    }

    qualityBtns.forEach(function (qb) {
      qb.addEventListener('click', function () {
        if (!state.optimizeFileSize) return;
        state.quality = qb.getAttribute('data-quality') || 'balanced';
        emit('quality');
      });
    });

    if (paperSelect) {
      paperSelect.addEventListener('change', function () {
        state.paperSize = paperSelect.value === 'letter' ? 'letter' : 'a4';
        emit('paper');
      });
    }

    if (orientSelect) {
      orientSelect.addEventListener('change', function () {
        state.orientation = orientSelect.value === 'portrait' ? 'portrait' : 'landscape';
        emit('orientation');
      });
    }

    if (advBtn && advBody) {
      advBtn.addEventListener('click', function () {
        var expanded = advBtn.getAttribute('aria-expanded') === 'true';
        var next = !expanded;
        advBtn.setAttribute('aria-expanded', String(next));
        advBtn.classList.toggle('is-open', next);
        advBody.classList.toggle('hidden', !next);
      });
    }

    syncVisuals(cfg.actualMeta || null);

    return {
      getSettings: function () { return Object.assign({}, state); },
      setSettings: function (patch, silent) {
        var c = core();
        var merged = Object.assign({}, state, patch || {});
        state = (c && c.resolvePdfExportSettings) ? c.resolvePdfExportSettings(merged) : merged;
        if (silent) syncVisuals(null);
        else emit('external');
      },
      setContentStats: function (nextStats) {
        contentStats = Object.assign({}, nextStats || {});
        syncVisuals(null);
      },
      setActualMeta: function (meta) {
        syncVisuals(meta || null);
      },
      getPlan: function () {
        return computePlanForState(state, contentStats, lang);
      }
    };
  }

  root.RGPdfControls = {
    createDefaultState: createDefaultState,
    renderPanelHtml: renderPanelHtml,
    mount: mount,
    formatKb: formatKb
  };
})(window);
