/**
 * RENTAL GATE CRM — Web God PDF Designer Controls (Page, Brand Design, Tables, Notes & Per-User Persistence)
 */
(function (root) {
  'use strict';

  var LEGACY_PREFS_KEY = 'rg_crm_pdf_export_prefs_v1';

  function core() {
    return root.RGCrmCore || null;
  }

  function getActiveUser() {
    try {
      return (root.RGAuth && typeof root.RGAuth.getUser === 'function') ? root.RGAuth.getUser() : null;
    } catch (_e) {
      return null;
    }
  }

  function getUserStorageKey() {
    var c = core();
    var u = getActiveUser();
    if (c && typeof c.getUserPdfPrefsStorageKey === 'function') {
      return c.getUserPdfPrefsStorageKey(u);
    }
    var uid = (u && (u.id || u.employeeId || u.username)) ? String(u.id || u.employeeId || u.username).toLowerCase() : 'guest';
    return 'rg_crm_pdf_export_prefs_v2_' + uid.replace(/[^a-z0-9_-]/g, '_');
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

  function loadRawStore() {
    var key = getUserStorageKey();
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
      var legacyRaw = localStorage.getItem(LEGACY_PREFS_KEY);
      if (legacyRaw) {
        var legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === 'object') return legacy;
      }
    } catch (_e) {}
    return {};
  }

  function loadPrefs(scopeKey) {
    var store = loadRawStore();
    var base = Object.assign({}, store);
    delete base.columnsByScope;
    if (scopeKey && store.columnsByScope && store.columnsByScope[scopeKey] && typeof store.columnsByScope[scopeKey] === 'object') {
      var sc = store.columnsByScope[scopeKey];
      if (Array.isArray(sc.selectedColumns)) base.selectedColumns = sc.selectedColumns.slice();
      if (Array.isArray(sc.columnOrder)) base.columnOrder = sc.columnOrder.slice();
      if (sc.autoColumnWidths !== undefined) base.autoColumnWidths = Boolean(sc.autoColumnWidths);
      if (sc.columnWidths && typeof sc.columnWidths === 'object') base.columnWidths = Object.assign({}, sc.columnWidths);
    }
    return base;
  }

  function savePrefs(settings, scopeKey) {
    try {
      if (!settings || typeof settings !== 'object') return;
      var c = core();
      var resolved = (c && c.resolveAdvancedPdfSettings)
        ? c.resolveAdvancedPdfSettings(settings)
        : Object.assign({}, settings);
      var existing = loadRawStore();
      var columnsByScope = (existing.columnsByScope && typeof existing.columnsByScope === 'object')
        ? Object.assign({}, existing.columnsByScope)
        : {};

      if (scopeKey) {
        columnsByScope[scopeKey] = {
          selectedColumns: Array.isArray(resolved.selectedColumns) ? resolved.selectedColumns.slice() : null,
          columnOrder: Array.isArray(resolved.columnOrder) ? resolved.columnOrder.slice() : null,
          autoColumnWidths: Boolean(resolved.autoColumnWidths),
          columnWidths: resolved.columnWidths ? Object.assign({}, resolved.columnWidths) : {}
        };
      }

      var payload = Object.assign({}, resolved, { columnsByScope: columnsByScope });
      delete payload.selectedColumns;
      delete payload.columnOrder;
      delete payload.columnWidths;
      if (!scopeKey && Array.isArray(resolved.selectedColumns)) {
        payload.selectedColumns = resolved.selectedColumns.slice();
      }
      localStorage.setItem(getUserStorageKey(), JSON.stringify(payload));
    } catch (_e) {}
  }

  function resetSavedPrefs(scopeKey) {
    try {
      var existing = loadRawStore();
      if (scopeKey && existing.columnsByScope && existing.columnsByScope[scopeKey]) {
        delete existing.columnsByScope[scopeKey];
        localStorage.setItem(getUserStorageKey(), JSON.stringify({ columnsByScope: existing.columnsByScope }));
      } else {
        localStorage.removeItem(getUserStorageKey());
      }
    } catch (_e) {}
  }

  function resolveSettings(rawObj) {
    var c = core();
    if (c && typeof c.resolveAdvancedPdfSettings === 'function') {
      return c.resolveAdvancedPdfSettings(rawObj);
    }
    return Object.assign({
      targetPages: 3,
      preset: 'balanced',
      optimizeFileSize: true,
      quality: 'balanced',
      paperSize: 'a4',
      orientation: 'landscape',
      marginPreset: 'normal',
      customMargins: { top: 10, right: 10, bottom: 10, left: 10 },
      designStyle: 'modern_minimal',
      primaryColor: '#D9232A',
      fontSizeScale: 'medium',
      fontFamily: 'IBM Plex Sans Arabic',
      showLogo: true,
      showTitle: true,
      showDateTime: true,
      showFooter: true,
      showPageNumbers: true,
      showKpis: true,
      showTableHeaders: true,
      repeatTableHeader: true,
      autoColumnWidths: true,
      columnWidths: {},
      selectedColumns: null,
      columnOrder: null,
      showNotes: true,
      notesFullUnclipped: true,
      notesPreserveLineBreaks: true,
      notesFontSize: 'medium'
    }, rawObj || {});
  }

  function createDefaultState(overrides, scopeKey) {
    var ov = (overrides && typeof overrides === 'object') ? overrides : {};
    var effectiveScope = scopeKey || ov.scopeKey || '';
    var saved = loadPrefs(effectiveScope);
    var merged = Object.assign({
      targetPages: 3,
      preset: 'balanced',
      optimizeFileSize: true,
      quality: 'balanced',
      paperSize: 'a4',
      orientation: 'landscape',
      marginPreset: 'normal',
      designStyle: 'modern_minimal',
      primaryColor: '#D9232A',
      fontSizeScale: 'medium',
      fontFamily: 'IBM Plex Sans Arabic',
      showLogo: true,
      showTitle: true,
      showDateTime: true,
      showFooter: true,
      showPageNumbers: true,
      showKpis: true,
      showTableHeaders: true,
      repeatTableHeader: true,
      autoColumnWidths: true,
      showNotes: true,
      notesFullUnclipped: true,
      notesPreserveLineBreaks: true,
      notesFontSize: 'medium'
    }, saved, ov);
    return resolveSettings(merged);
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
        panelTitle: 'Web God PDF Studio Settings',
        tabPage: 'Page',
        tabDesign: 'Design',
        tabTables: 'Tables',
        tabNotes: 'Notes',
        targetPagesLabel: 'Target pages',
        minPageLabel: '1 Page',
        maxPageLabel: '10 Pages',
        presetLabel: 'Density Preset',
        presetCompact: 'Compact',
        presetBalanced: 'Balanced',
        presetComfortable: 'Comfortable',
        presetCustom: 'Custom',
        optimizeLabel: 'Optimize PDF File Size',
        optimizeSub: 'Compresses images & streams for sharing',
        qualityLabel: 'Export Quality',
        qualitySmall: 'Small File',
        qualityBalanced: 'Balanced',
        qualityHigh: 'High Quality',
        estLabel: 'Estimated',
        actualLabel: 'Actual',
        pagesWord: 'pages',
        pageWord: 'page',
        advToggle: 'Customize Layout, Design, Tables & Notes',
        paperLabel: 'Paper Size',
        orientLabel: 'Page Orientation',
        orientLandscape: 'Landscape (Wide Tables)',
        orientPortrait: 'Portrait (Long & Archival)',
        marginsLabel: 'Page Margins',
        marginNormal: 'Normal (10mm)',
        marginNarrow: 'Narrow (6mm)',
        marginWide: 'Wide (15mm)',
        marginCustom: 'Custom (mm)',
        marginTop: 'Top',
        marginRight: 'Right',
        marginBottom: 'Bottom',
        marginLeft: 'Left',
        designStyleLabel: 'Report Theme',
        primaryColorLabel: 'Primary Brand Color',
        resetBrandColor: 'Official Red (#D9232A)',
        fontSizeLabel: 'Font Size',
        sizeSmall: 'Small',
        sizeMedium: 'Medium',
        sizeLarge: 'Large',
        fontFamilyLabel: 'Arabic Typography',
        visibilityLabel: 'Document Elements',
        showLogo: 'Company Logo',
        showTitle: 'Report Title',
        showDateTime: 'Export Date & Time',
        showFooter: 'Document Footer',
        showPageNumbers: 'Page Numbers',
        showKpis: 'KPI Stat Cards',
        tableHeadersLabel: 'Table Structure',
        showTableHeaders: 'Show Table Headers',
        repeatTableHeader: 'Repeat Header on Each Page',
        colWidthModeLabel: 'Column Widths',
        colWidthAuto: 'Auto-fit Content',
        colWidthManual: 'Manual Weights',
        columnsLabel: 'Visible Columns & Order',
        selectAllCols: 'Show All',
        resetColsOrder: 'Reset Order',
        noTableColsHint: 'This document uses summary cards & sections rather than multi-column tables.',
        moveUp: 'Move up',
        moveDown: 'Move down',
        widthLabel: 'Width',
        notesSectionLabel: 'Notes & Long Text Behavior',
        showNotes: 'Show Notes Section',
        notesUnclipped: 'Render Full Notes Without Clipping',
        notesPreserveBreaks: 'Preserve Line Breaks & Word Wrap',
        notesFontSizeLabel: 'Notes Font Size',
        notesGuaranteeHint: 'Line breaks are preserved intact across lines and multi-page splits.',
        resetAllBtn: 'Reset Defaults',
        metricsPrefix: 'Font',
        marginsWord: 'Margin'
      };
    }
    return {
      panelTitle: 'إعدادات تصدير PDF',
      tabPage: 'الصفحة',
      tabDesign: 'التصميم',
      tabTables: 'الجداول',
      tabNotes: 'الملاحظات',
      targetPagesLabel: 'عدد الصفحات المستهدف',
      minPageLabel: '1 صفحة',
      maxPageLabel: '10 صفحات',
      presetLabel: 'توزيع الكثافة',
      presetCompact: 'مضغوط',
      presetBalanced: 'متوازن',
      presetComfortable: 'مريح',
      presetCustom: 'مخصص',
      optimizeLabel: 'تحسين وضغط حجم الملف',
      optimizeSub: 'ضغط الصور والتدفقات لسهولة المشاركة',
      qualityLabel: 'جودة التصدير',
      qualitySmall: 'ملف صغير',
      qualityBalanced: 'متوازن',
      qualityHigh: 'جودة عالية',
      estLabel: 'التقدير',
      actualLabel: 'الفعلي',
      pagesWord: 'صفحات',
      pageWord: 'صفحة',
      advToggle: 'تخصيص الصفحة والتصميم والجداول والملاحظات',
      paperLabel: 'حجم الورق',
      orientLabel: 'اتجاه الصفحة',
      orientLandscape: 'أفقي (Landscape) — للجداول العريضة',
      orientPortrait: 'رأسي (Portrait) — للتقارير والأرشفة',
      marginsLabel: 'هوامش الصفحة',
      marginNormal: 'عادية (10 مم)',
      marginNarrow: 'ضيقة (6 مم)',
      marginWide: 'واسعة (15 مم)',
      marginCustom: 'مخصصة (مم)',
      marginTop: 'أعلى',
      marginRight: 'يمين',
      marginBottom: 'أسفل',
      marginLeft: 'يسار',
      designStyleLabel: 'نمط التصميم',
      primaryColorLabel: 'اللون الأساسي للتقرير',
      resetBrandColor: 'إرجاع الهوية (#D9232A)',
      fontSizeLabel: 'حجم الخط العام',
      sizeSmall: 'صغير',
      sizeMedium: 'متوسط',
      sizeLarge: 'كبير',
      fontFamilyLabel: 'الخط العربي',
      visibilityLabel: 'عناصر التقرير الظاهرة',
      showLogo: 'الشعار',
      showTitle: 'عنوان التقرير',
      showDateTime: 'التاريخ ووقت الإصدار',
      showFooter: 'التذييل',
      showPageNumbers: 'ترقيم الصفحات',
      showKpis: 'البطاقات الإحصائية',
      tableHeadersLabel: 'إعدادات الجداول',
      showTableHeaders: 'إظهار رؤوس الجداول',
      repeatTableHeader: 'تكرار رأس الجدول في الصفحات الجديدة',
      colWidthModeLabel: 'ضبط عرض الأعمدة',
      colWidthAuto: 'تلقائي حسب المحتوى',
      colWidthManual: 'يدوي مخصص',
      columnsLabel: 'اختيار وترتيب الأعمدة',
      selectAllCols: 'إظهار الكل',
      resetColsOrder: 'إعادة الترتيب',
      noTableColsHint: 'هذا التقرير يعتمد على البطاقات والأقسام التفصيلية دون جدول متعدد الأعمدة.',
      moveUp: 'تحريك للأعلى',
      moveDown: 'تحريك للأسفل',
      widthLabel: 'العرض',
      notesSectionLabel: 'إعدادات قسم الملاحظات',
      showNotes: 'إظهار قسم الملاحظات',
      notesUnclipped: 'إظهار الملاحظات كاملة دون قص',
      notesPreserveBreaks: 'الحفاظ على فواصل الأسطر والالتفاف التلقائي',
      notesFontSizeLabel: 'حجم خط الملاحظات',
      notesGuaranteeHint: 'يتم الحفاظ على كل سطر فاصل وتمديد مساحة الملاحظات تلقائياً عبر الصفحات دون دمج أو حذف.',
      resetAllBtn: 'استعادة الافتراضي',
      metricsPrefix: 'الخط',
      marginsWord: 'الهامش'
    };
  }

  function buildNormalizedColumnList(rawCols, state) {
    var list = Array.isArray(rawCols) ? rawCols.filter(function (c) { return c && c.key; }) : [];
    if (!list.length) return [];
    var byKey = {};
    list.forEach(function (c) { byKey[c.key] = c; });
    var order = Array.isArray(state.columnOrder) && state.columnOrder.length ? state.columnOrder : list.map(function (c) { return c.key; });
    var out = [];
    var seen = {};
    order.forEach(function (k) {
      if (byKey[k] && !seen[k]) {
        out.push(byKey[k]);
        seen[k] = true;
      }
    });
    list.forEach(function (c) {
      if (!seen[c.key]) {
        out.push(c);
        seen[c.key] = true;
      }
    });
    return out;
  }

  function renderColumnsListHtml(rawCols, state, isEn, s) {
    var orderedCols = buildNormalizedColumnList(rawCols, state);
    if (!orderedCols.length) {
      return '<div class="rg-pdf-empty-cols">' + esc(s.noTableColsHint) + '</div>';
    }
    var hasSel = Array.isArray(state.selectedColumns) && state.selectedColumns.length > 0;
    var selSet = {};
    if (hasSel) {
      state.selectedColumns.forEach(function (k) { selSet[k] = true; });
    }
    var manualWidths = !state.autoColumnWidths;
    return orderedCols.map(function (col, idx) {
      var lbl = (isEn && col.labelEn) ? col.labelEn : (col.label || col.key);
      var checked = !hasSel || Boolean(selSet[col.key]);
      var defaultW = Number(col.widthWeight || 1.2);
      var curW = (state.columnWidths && state.columnWidths[col.key] !== undefined)
        ? Number(state.columnWidths[col.key])
        : Math.round(defaultW * 10);
      return '<div class="rg-pdf-col-item' + (checked ? ' is-checked' : '') + '" data-col-key="' + esc(col.key) + '">' +
        '<label class="rg-pdf-col-check">' +
          '<input type="checkbox" class="rg-pdf-col-chk" value="' + esc(col.key) + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="rg-pdf-col-name">' + esc(lbl) + '</span>' +
        '</label>' +
        '<div class="rg-pdf-col-actions">' +
          '<input type="number" class="rg-pdf-col-width-inp mono tabular-nums' + (manualWidths ? '' : ' hidden') + '" data-col-width="' + esc(col.key) + '" min="5" max="80" step="1" value="' + esc(curW) + '" aria-label="' + esc(s.widthLabel + ': ' + lbl) + '" title="' + esc(s.widthLabel) + '">' +
          '<button type="button" class="rg-pdf-col-move" data-col-move="up" data-col-key="' + esc(col.key) + '"' + (idx === 0 ? ' disabled' : '') + ' aria-label="' + esc(s.moveUp + ' ' + lbl) + '" title="' + esc(s.moveUp) + '">▲</button>' +
          '<button type="button" class="rg-pdf-col-move" data-col-move="down" data-col-key="' + esc(col.key) + '"' + (idx === orderedCols.length - 1 ? ' disabled' : '') + ' aria-label="' + esc(s.moveDown + ' ' + lbl) + '" title="' + esc(s.moveDown) + '">▼</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderSwitchMarkup(id, roleAttr, checked, labelText) {
    return (
      '<label class="rg-pdf-mini-switch" for="' + esc(id) + '">' +
        '<input type="checkbox" id="' + esc(id) + '" data-toggle-key="' + esc(roleAttr) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="rg-pdf-mini-switch-box" aria-hidden="true"></span>' +
        '<span>' + esc(labelText) + '</span>' +
      '</label>'
    );
  }

  function renderTabsBodyHtml(uid, st, opts, isEn, s) {
    var c = core();
    var fonts = (c && c.PDF_ARABIC_FONTS) || [
      { id: 'IBM Plex Sans Arabic', labelAr: 'IBM Plex Sans Arabic', labelEn: 'IBM Plex Sans Arabic' },
      { id: 'Cairo', labelAr: 'Cairo', labelEn: 'Cairo' },
      { id: 'Tajawal', labelAr: 'Tajawal', labelEn: 'Tajawal' },
      { id: 'Tahoma', labelAr: 'Tahoma', labelEn: 'Tahoma' }
    ];
    var styles = (c && c.PDF_DESIGN_STYLES) || [
      { id: 'modern_minimal', labelAr: 'Modern Minimal (Web God)', labelEn: 'Modern Minimal (Web God)' },
      { id: 'executive_classic', labelAr: 'التصميم التنفيذي الداكن', labelEn: 'Executive Dark Header' }
    ];
    var pct = Math.round(((st.targetPages - 1) / 9) * 100);
    var ticksHtml = '';
    for (var tk = 1; tk <= 10; tk++) {
      ticksHtml += '<button type="button" class="rg-density-tick' + (tk === st.targetPages ? ' is-active' : '') + '" data-tick="' + tk + '" aria-label="' + esc(s.targetPagesLabel + ': ' + tk) + '">' + tk + '</button>';
    }
    var swatches = ['#D9232A', '#303030', '#1D4ED8', '#047857', '#B45309'];
    var cols = Array.isArray(opts.columns) ? opts.columns : (Array.isArray(opts.availableColumns) ? opts.availableColumns : []);

    return (
      '<div class="rg-pdf-ctrl-tabs" role="tablist" aria-label="' + esc(s.panelTitle) + '">' +
        '<button type="button" class="rg-pdf-tab-btn is-active" data-ctrl-tab="page" role="tab" aria-selected="true">' + esc(s.tabPage) + '</button>' +
        '<button type="button" class="rg-pdf-tab-btn" data-ctrl-tab="design" role="tab" aria-selected="false">' + esc(s.tabDesign) + '</button>' +
        '<button type="button" class="rg-pdf-tab-btn" data-ctrl-tab="tables" role="tab" aria-selected="false">' + esc(s.tabTables) + (cols.length ? ' <span class="tabular-nums">(' + cols.length + ')</span>' : '') + '</button>' +
        '<button type="button" class="rg-pdf-tab-btn" data-ctrl-tab="notes" role="tab" aria-selected="false">' + esc(s.tabNotes) + '</button>' +
      '</div>' +

      '<div class="rg-pdf-tab-pane is-active" data-ctrl-pane="page">' +
        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.orientLabel) + '</span>' +
          '<div class="rg-pdf-orient-grid">' +
            '<button type="button" class="rg-pdf-orient-card' + (st.orientation === 'portrait' ? ' is-active' : '') + '" data-orient-btn="portrait" aria-pressed="' + (st.orientation === 'portrait') + '">' +
              '<span class="rg-pdf-orient-icon is-portrait" aria-hidden="true"></span>' +
              '<span class="rg-pdf-orient-title">' + esc(isEn ? 'Portrait' : 'رأسي (Portrait)') + '</span>' +
              '<span class="rg-pdf-orient-sub">' + esc(isEn ? 'Archive & vertical flow' : 'للتقارير الطويلة والأرشفة') + '</span>' +
            '</button>' +
            '<button type="button" class="rg-pdf-orient-card' + (st.orientation === 'landscape' ? ' is-active' : '') + '" data-orient-btn="landscape" aria-pressed="' + (st.orientation === 'landscape') + '">' +
              '<span class="rg-pdf-orient-icon is-landscape" aria-hidden="true"></span>' +
              '<span class="rg-pdf-orient-title">' + esc(isEn ? 'Landscape' : 'أفقي (Landscape)') + '</span>' +
              '<span class="rg-pdf-orient-sub">' + esc(isEn ? 'Multi-column tables' : 'للجداول والأعمدة الكثيرة') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-two-col">' +
          '<div class="rg-pdf-field-group">' +
            '<label class="rg-pdf-mini-label" for="' + uid + '-paper">' + esc(s.paperLabel) + '</label>' +
            '<select class="select" id="' + uid + '-paper" data-role="paper-select">' +
              '<option value="a4"' + (st.paperSize === 'a4' ? ' selected' : '') + '>A4 (210 × 297 mm)</option>' +
              '<option value="a3"' + (st.paperSize === 'a3' ? ' selected' : '') + '>A3 (297 × 420 mm)</option>' +
              '<option value="letter"' + (st.paperSize === 'letter' ? ' selected' : '') + '>Letter (216 × 279 mm)</option>' +
            '</select>' +
          '</div>' +
          '<div class="rg-pdf-field-group">' +
            '<label class="rg-pdf-mini-label" for="' + uid + '-margins">' + esc(s.marginsLabel) + '</label>' +
            '<select class="select" id="' + uid + '-margins" data-role="margin-preset">' +
              '<option value="normal"' + (st.marginPreset === 'normal' ? ' selected' : '') + '>' + esc(s.marginNormal) + '</option>' +
              '<option value="narrow"' + (st.marginPreset === 'narrow' ? ' selected' : '') + '>' + esc(s.marginNarrow) + '</option>' +
              '<option value="wide"' + (st.marginPreset === 'wide' ? ' selected' : '') + '>' + esc(s.marginWide) + '</option>' +
              '<option value="custom"' + (st.marginPreset === 'custom' ? ' selected' : '') + '>' + esc(s.marginCustom) + '</option>' +
            '</select>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-margin-grid' + (st.marginPreset === 'custom' ? '' : ' hidden') + '" data-role="custom-margins-wrap">' +
          '<label class="rg-pdf-margin-cell"><span>' + esc(s.marginTop) + '</span><input type="number" class="input mono tabular-nums" data-margin-edge="top" min="4" max="35" step="1" value="' + esc((st.customMargins && st.customMargins.top) || 10) + '"></label>' +
          '<label class="rg-pdf-margin-cell"><span>' + esc(s.marginRight) + '</span><input type="number" class="input mono tabular-nums" data-margin-edge="right" min="4" max="35" step="1" value="' + esc((st.customMargins && st.customMargins.right) || 10) + '"></label>' +
          '<label class="rg-pdf-margin-cell"><span>' + esc(s.marginBottom) + '</span><input type="number" class="input mono tabular-nums" data-margin-edge="bottom" min="4" max="35" step="1" value="' + esc((st.customMargins && st.customMargins.bottom) || 10) + '"></label>' +
          '<label class="rg-pdf-margin-cell"><span>' + esc(s.marginLeft) + '</span><input type="number" class="input mono tabular-nums" data-margin-edge="left" min="4" max="35" step="1" value="' + esc((st.customMargins && st.customMargins.left) || 10) + '"></label>' +
        '</div>' +

        '<div class="rg-pdf-slider-block">' +
          '<div class="rg-pdf-slider-head">' +
            '<label class="rg-pdf-mini-label" for="' + uid + '-slider">' + esc(s.targetPagesLabel) + '</label>' +
            '<div class="rg-pdf-target-readout" aria-live="polite">' +
              '<strong class="mono tabular-nums" data-role="target-val">' + st.targetPages + '</strong>' +
              '<span class="rg-pdf-custom-tag' + (st.preset === 'custom' ? '' : ' hidden') + '" data-role="custom-tag">· ' + esc(s.presetCustom) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="rg-density-slider-wrap">' +
            '<input type="range" class="rg-density-slider" id="' + uid + '-slider" min="1" max="10" step="1" value="' + st.targetPages + '" style="--slider-pct:' + pct + '%;" aria-valuemin="1" aria-valuemax="10" aria-valuenow="' + st.targetPages + '" aria-label="' + esc(s.targetPagesLabel) + '">' +
            '<div class="rg-density-ticks" aria-hidden="true">' + ticksHtml + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-two-col is-stack-studio">' +
          '<div class="rg-pdf-field-group">' +
            '<span class="rg-pdf-mini-label">' + esc(s.presetLabel) + '</span>' +
            '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.presetLabel) + '">' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'compact' ? ' is-active' : '') + '" data-preset="compact" aria-pressed="' + (st.preset === 'compact') + '">' + esc(s.presetCompact) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'balanced' ? ' is-active' : '') + '" data-preset="balanced" aria-pressed="' + (st.preset === 'balanced') + '">' + esc(s.presetBalanced) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.preset === 'comfortable' ? ' is-active' : '') + '" data-preset="comfortable" aria-pressed="' + (st.preset === 'comfortable') + '">' + esc(s.presetComfortable) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="rg-pdf-field-group">' +
            '<span class="rg-pdf-mini-label">' + esc(s.qualityLabel) + '</span>' +
            '<div class="rg-pdf-seg-group' + (st.optimizeFileSize ? '' : ' is-disabled') + '" data-role="quality-wrap" role="group" aria-label="' + esc(s.qualityLabel) + '">' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'small' ? ' is-active' : '') + '" data-quality="small" aria-pressed="' + (st.quality === 'small') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualitySmall) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'balanced' ? ' is-active' : '') + '" data-quality="balanced" aria-pressed="' + (st.quality === 'balanced') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualityBalanced) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.quality === 'high' ? ' is-active' : '') + '" data-quality="high" aria-pressed="' + (st.quality === 'high') + '"' + (st.optimizeFileSize ? '' : ' disabled') + '>' + esc(s.qualityHigh) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        renderSwitchMarkup(uid + '-opt-toggle', 'optimizeFileSize', st.optimizeFileSize, s.optimizeLabel) +
      '</div>' +

      '<div class="rg-pdf-tab-pane" data-ctrl-pane="design">' +
        '<div class="rg-pdf-field-group">' +
          '<label class="rg-pdf-mini-label" for="' + uid + '-style">' + esc(s.designStyleLabel) + '</label>' +
          '<select class="select" id="' + uid + '-style" data-role="design-style">' +
            styles.map(function (stItem) {
              return '<option value="' + esc(stItem.id) + '"' + (st.designStyle === stItem.id ? ' selected' : '') + '>' + esc(isEn ? stItem.labelEn : stItem.labelAr) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +

        '<div class="rg-pdf-field-group">' +
          '<div class="rg-pdf-label-row">' +
            '<label class="rg-pdf-mini-label" for="' + uid + '-color">' + esc(s.primaryColorLabel) + '</label>' +
            '<button type="button" class="btn-link-inline" data-role="reset-brand-color">' + esc(s.resetBrandColor) + '</button>' +
          '</div>' +
          '<div class="rg-pdf-color-row">' +
            '<input type="color" class="rg-pdf-color-picker" id="' + uid + '-color" data-role="primary-color" value="' + esc(st.primaryColor) + '" aria-label="' + esc(s.primaryColorLabel) + '">' +
            '<span class="rg-pdf-color-hex mono" dir="ltr" data-role="primary-color-hex">' + esc(st.primaryColor) + '</span>' +
            '<div class="rg-pdf-swatches">' +
              swatches.map(function (hex) {
                return '<button type="button" class="rg-pdf-swatch' + (st.primaryColor === hex ? ' is-active' : '') + '" data-swatch="' + hex + '" style="background:' + hex + ';" aria-label="' + hex + '" title="' + hex + '"></button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-two-col is-stack-studio">' +
          '<div class="rg-pdf-field-group">' +
            '<label class="rg-pdf-mini-label" for="' + uid + '-font">' + esc(s.fontFamilyLabel) + '</label>' +
            '<select class="select" id="' + uid + '-font" data-role="font-family" dir="ltr">' +
              fonts.map(function (f) {
                return '<option value="' + esc(f.id) + '"' + (st.fontFamily === f.id ? ' selected' : '') + '>' + esc(isEn ? f.labelEn : f.labelAr) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="rg-pdf-field-group">' +
            '<span class="rg-pdf-mini-label">' + esc(s.fontSizeLabel) + '</span>' +
            '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.fontSizeLabel) + '">' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.fontSizeScale === 'small' ? ' is-active' : '') + '" data-font-scale="small" aria-pressed="' + (st.fontSizeScale === 'small') + '">' + esc(s.sizeSmall) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.fontSizeScale === 'medium' ? ' is-active' : '') + '" data-font-scale="medium" aria-pressed="' + (st.fontSizeScale === 'medium') + '">' + esc(s.sizeMedium) + '</button>' +
              '<button type="button" class="rg-pdf-seg-btn' + (st.fontSizeScale === 'large' ? ' is-active' : '') + '" data-font-scale="large" aria-pressed="' + (st.fontSizeScale === 'large') + '">' + esc(s.sizeLarge) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.visibilityLabel) + '</span>' +
          '<div class="rg-pdf-toggles-grid">' +
            renderSwitchMarkup(uid + '-vis-logo', 'showLogo', st.showLogo, s.showLogo) +
            renderSwitchMarkup(uid + '-vis-title', 'showTitle', st.showTitle, s.showTitle) +
            renderSwitchMarkup(uid + '-vis-datetime', 'showDateTime', st.showDateTime, s.showDateTime) +
            renderSwitchMarkup(uid + '-vis-footer', 'showFooter', st.showFooter, s.showFooter) +
            renderSwitchMarkup(uid + '-vis-pagenum', 'showPageNumbers', st.showPageNumbers, s.showPageNumbers) +
            renderSwitchMarkup(uid + '-vis-kpis', 'showKpis', st.showKpis, s.showKpis) +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="rg-pdf-tab-pane" data-ctrl-pane="tables">' +
        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.tableHeadersLabel) + '</span>' +
          '<div class="rg-pdf-toggles-grid">' +
            renderSwitchMarkup(uid + '-tbl-hdr', 'showTableHeaders', st.showTableHeaders, s.showTableHeaders) +
            renderSwitchMarkup(uid + '-tbl-rep', 'repeatTableHeader', st.repeatTableHeader, s.repeatTableHeader) +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.colWidthModeLabel) + '</span>' +
          '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.colWidthModeLabel) + '">' +
            '<button type="button" class="rg-pdf-seg-btn' + (st.autoColumnWidths ? ' is-active' : '') + '" data-width-mode="auto" aria-pressed="' + Boolean(st.autoColumnWidths) + '">' + esc(s.colWidthAuto) + '</button>' +
            '<button type="button" class="rg-pdf-seg-btn' + (!st.autoColumnWidths ? ' is-active' : '') + '" data-width-mode="manual" aria-pressed="' + (!st.autoColumnWidths) + '">' + esc(s.colWidthManual) + '</button>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-field-group">' +
          '<div class="rg-pdf-label-row">' +
            '<span class="rg-pdf-mini-label">' + esc(s.columnsLabel) + '</span>' +
            (cols.length
              ? '<div class="rg-pdf-col-toolbar">' +
                  '<button type="button" class="btn-link-inline" data-role="cols-all">' + esc(s.selectAllCols) + '</button>' +
                  '<span>·</span>' +
                  '<button type="button" class="btn-link-inline" data-role="cols-reset">' + esc(s.resetColsOrder) + '</button>' +
                '</div>'
              : '') +
          '</div>' +
          '<div class="rg-pdf-col-list" data-role="cols-list">' +
            renderColumnsListHtml(cols, st, isEn, s) +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="rg-pdf-tab-pane" data-ctrl-pane="notes">' +
        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.notesSectionLabel) + '</span>' +
          '<div class="rg-pdf-toggles-stack">' +
            renderSwitchMarkup(uid + '-notes-show', 'showNotes', st.showNotes, s.showNotes) +
            renderSwitchMarkup(uid + '-notes-unclipped', 'notesFullUnclipped', st.notesFullUnclipped, s.notesUnclipped) +
            renderSwitchMarkup(uid + '-notes-breaks', 'notesPreserveLineBreaks', st.notesPreserveLineBreaks, s.notesPreserveBreaks) +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-field-group">' +
          '<span class="rg-pdf-mini-label">' + esc(s.notesFontSizeLabel) + '</span>' +
          '<div class="rg-pdf-seg-group" role="group" aria-label="' + esc(s.notesFontSizeLabel) + '">' +
            '<button type="button" class="rg-pdf-seg-btn' + (st.notesFontSize === 'small' ? ' is-active' : '') + '" data-notes-size="small" aria-pressed="' + (st.notesFontSize === 'small') + '">' + esc(s.sizeSmall) + '</button>' +
            '<button type="button" class="rg-pdf-seg-btn' + (st.notesFontSize === 'medium' ? ' is-active' : '') + '" data-notes-size="medium" aria-pressed="' + (st.notesFontSize === 'medium') + '">' + esc(s.sizeMedium) + '</button>' +
            '<button type="button" class="rg-pdf-seg-btn' + (st.notesFontSize === 'large' ? ' is-active' : '') + '" data-notes-size="large" aria-pressed="' + (st.notesFontSize === 'large') + '">' + esc(s.sizeLarge) + '</button>' +
          '</div>' +
        '</div>' +

        '<div class="rg-pdf-notes-info">' + esc(s.notesGuaranteeHint) + '</div>' +
      '</div>'
    );
  }

  function renderPanelHtml(options) {
    var opts = options || {};
    var lang = getLang(opts.lang);
    var isEn = lang === 'en';
    var s = getStrings(isEn);
    var mode = opts.mode === 'studio' ? 'studio' : (opts.mode === 'preview' ? 'preview' : 'modal');
    var uid = opts.idPrefix || ('rg-pdfc-' + mode);
    var st = createDefaultState(opts.settings, opts.scopeKey);
    var plan = computePlanForState(st, opts.contentStats, lang);
    var pageUnit = plan.estimatedPages === 1 ? s.pageWord : s.pagesWord;
    var tabsHtml = renderTabsBodyHtml(uid, st, opts, isEn, s);

    if (mode === 'studio') {
      return (
        '<section class="rg-pdf-ctrl-panel is-mode-studio" id="' + uid + '" data-rg-pdf-controls="studio">' +
          '<div class="rg-pdf-studio-panel-head">' +
            '<span class="rg-pdf-ctrl-heading">' + esc(s.panelTitle) + '</span>' +
            '<button type="button" class="btn-link-inline" data-role="reset-all-btn">' + esc(s.resetAllBtn) + '</button>' +
          '</div>' +
          '<div class="rg-pdf-meta-bar">' +
            '<div class="rg-pdf-est-summary" data-role="est-summary">' +
              '<span data-role="est-prefix">' + esc(s.estLabel) + ':</span> ' +
              '<strong class="tabular-nums" data-role="est-pages">' + plan.estimatedPages + ' ' + esc(pageUnit) + '</strong>' +
              '<span aria-hidden="true">·</span>' +
              '<strong class="mono tabular-nums" dir="ltr" data-role="est-size">~' + esc(formatKb(plan.estimatedBytes, isEn)) + '</strong>' +
              '<span aria-hidden="true">·</span>' +
              '<span class="rg-pdf-tech-hint tabular-nums" data-role="tech-hint">' + esc(s.metricsPrefix) + ' ' + plan.baseFont + 'pt</span>' +
            '</div>' +
          '</div>' +
          '<div class="rg-pdf-warning-banner' + (plan.readabilityWarning ? '' : ' hidden') + '" data-role="warning-banner" role="status" aria-live="polite">' +
            '<span data-role="warning-text">' + esc(plan.warningMessage || '') + '</span>' +
          '</div>' +
          '<div class="rg-pdf-studio-tabs-host">' + tabsHtml + '</div>' +
        '</section>'
      );
    }

    return (
      '<section class="rg-pdf-ctrl-panel is-mode-' + mode + '" id="' + uid + '" data-rg-pdf-controls="' + mode + '">' +
        '<div class="rg-pdf-meta-bar">' +
          '<div class="rg-pdf-est-summary" data-role="est-summary">' +
            '<span class="rg-pdf-ctrl-heading">' + esc(s.panelTitle) + '</span>' +
            '<span aria-hidden="true">·</span>' +
            '<span data-role="est-prefix">' + esc(s.estLabel) + ':</span> ' +
            '<strong class="tabular-nums" data-role="est-pages">' + plan.estimatedPages + ' ' + esc(pageUnit) + '</strong>' +
            '<span aria-hidden="true">·</span>' +
            '<strong class="mono tabular-nums" dir="ltr" data-role="est-size">~' + esc(formatKb(plan.estimatedBytes, isEn)) + '</strong>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<button type="button" class="btn-link-inline" data-role="reset-all-btn">' + esc(s.resetAllBtn) + '</button>' +
            '<button type="button" class="rg-pdf-adv-toggle is-open" id="' + uid + '-adv-btn" aria-expanded="true" aria-controls="' + uid + '-adv-body">' +
              '<span>' + esc(s.advToggle) + '</span>' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="rg-pdf-warning-banner' + (plan.readabilityWarning ? '' : ' hidden') + '" data-role="warning-banner" role="status" aria-live="polite">' +
          '<span data-role="warning-text">' + esc(plan.warningMessage || '') + '</span>' +
        '</div>' +
        '<div class="rg-pdf-adv-body" id="' + uid + '-adv-body">' +
          tabsHtml +
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
    var scopeKey = cfg.scopeKey || '';
    var columns = Array.isArray(cfg.columns) ? cfg.columns.slice() : (Array.isArray(cfg.availableColumns) ? cfg.availableColumns.slice() : []);
    var state = createDefaultState(cfg.initialSettings, scopeKey);
    var contentStats = cfg.contentStats || {};
    var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};

    var tabBtns = Array.from(panelEl.querySelectorAll('[data-ctrl-tab]'));
    var tabPanes = Array.from(panelEl.querySelectorAll('[data-ctrl-pane]'));
    tabBtns.forEach(function (tb) {
      tb.addEventListener('click', function () {
        var target = tb.getAttribute('data-ctrl-tab');
        tabBtns.forEach(function (b) {
          var on = b === tb;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        tabPanes.forEach(function (p) {
          p.classList.toggle('is-active', p.getAttribute('data-ctrl-pane') === target);
        });
      });
    });

    var advBtn = panelEl.querySelector('.rg-pdf-adv-toggle');
    var advBody = panelEl.querySelector('.rg-pdf-adv-body');
    if (advBtn && advBody) {
      advBtn.addEventListener('click', function () {
        var expanded = advBtn.getAttribute('aria-expanded') === 'true';
        var next = !expanded;
        advBtn.setAttribute('aria-expanded', String(next));
        advBtn.classList.toggle('is-open', next);
        advBody.classList.toggle('hidden', !next);
      });
    }

    var sliderEl = panelEl.querySelector('.rg-density-slider');
    var targetValEl = panelEl.querySelector('[data-role="target-val"]');
    var customTagEl = panelEl.querySelector('[data-role="custom-tag"]');
    var tickBtns = Array.from(panelEl.querySelectorAll('.rg-density-tick'));
    var presetBtns = Array.from(panelEl.querySelectorAll('[data-preset]'));
    var qualityBtns = Array.from(panelEl.querySelectorAll('[data-quality]'));
    var qualityWrap = panelEl.querySelector('[data-role="quality-wrap"]');
    var paperSelect = panelEl.querySelector('[data-role="paper-select"]');
    var marginPresetSelect = panelEl.querySelector('[data-role="margin-preset"]');
    var customMarginsWrap = panelEl.querySelector('[data-role="custom-margins-wrap"]');
    var orientBtns = Array.from(panelEl.querySelectorAll('[data-orient-btn]'));
    var designStyleSelect = panelEl.querySelector('[data-role="design-style"]');
    var colorPickerEl = panelEl.querySelector('[data-role="primary-color"]');
    var colorHexEl = panelEl.querySelector('[data-role="primary-color-hex"]');
    var swatchBtns = Array.from(panelEl.querySelectorAll('[data-swatch]'));
    var resetBrandBtn = panelEl.querySelector('[data-role="reset-brand-color"]');
    var fontSelectEl = panelEl.querySelector('[data-role="font-family"]');
    var fontScaleBtns = Array.from(panelEl.querySelectorAll('[data-font-scale]'));
    var widthModeBtns = Array.from(panelEl.querySelectorAll('[data-width-mode]'));
    var notesSizeBtns = Array.from(panelEl.querySelectorAll('[data-notes-size]'));
    var colsListEl = panelEl.querySelector('[data-role="cols-list"]');

    var estPrefixEl = panelEl.querySelector('[data-role="est-prefix"]');
    var estPagesEl = panelEl.querySelector('[data-role="est-pages"]');
    var estSizeEl = panelEl.querySelector('[data-role="est-size"]');
    var techHintEl = panelEl.querySelector('[data-role="tech-hint"]');
    var warningBanner = panelEl.querySelector('[data-role="warning-banner"]');
    var warningText = panelEl.querySelector('[data-role="warning-text"]');

    function bindColumnsEvents() {
      if (!colsListEl) return;
      colsListEl.querySelectorAll('.rg-pdf-col-chk').forEach(function (chk) {
        chk.addEventListener('change', function () {
          var selected = Array.from(colsListEl.querySelectorAll('.rg-pdf-col-chk:checked')).map(function (c) { return c.value; });
          if (selected.length === 0) {
            chk.checked = true;
            return;
          }
          state.selectedColumns = selected;
          var itemEl = chk.closest('.rg-pdf-col-item');
          if (itemEl) itemEl.classList.toggle('is-checked', chk.checked);
          emit('columns');
        });
      });

      colsListEl.querySelectorAll('[data-col-move]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var dir = btn.getAttribute('data-col-move');
          var key = btn.getAttribute('data-col-key');
          var ordered = buildNormalizedColumnList(columns, state).map(function (c) { return c.key; });
          var idx = ordered.indexOf(key);
          if (idx === -1) return;
          var swapWith = dir === 'up' ? idx - 1 : idx + 1;
          if (swapWith < 0 || swapWith >= ordered.length) return;
          var tmp = ordered[idx];
          ordered[idx] = ordered[swapWith];
          ordered[swapWith] = tmp;
          state.columnOrder = ordered;
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
          emit('column-order');
        });
      });

      colsListEl.querySelectorAll('[data-col-width]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var k = inp.getAttribute('data-col-width');
          var val = Math.max(5, Math.min(80, Math.round(Number(inp.value || 15))));
          inp.value = String(val);
          state.columnWidths = Object.assign({}, state.columnWidths || {});
          state.columnWidths[k] = val;
          emit('column-width');
        });
      });
    }

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
      if (qualityWrap) qualityWrap.classList.toggle('is-disabled', !state.optimizeFileSize);
      qualityBtns.forEach(function (qb) {
        var active = qb.getAttribute('data-quality') === state.quality;
        qb.classList.toggle('is-active', active);
        qb.setAttribute('aria-pressed', String(active));
        qb.disabled = !state.optimizeFileSize;
      });
      orientBtns.forEach(function (ob) {
        var active = ob.getAttribute('data-orient-btn') === state.orientation;
        ob.classList.toggle('is-active', active);
        ob.setAttribute('aria-pressed', String(active));
      });
      if (paperSelect) paperSelect.value = state.paperSize;
      if (marginPresetSelect) marginPresetSelect.value = state.marginPreset;
      if (customMarginsWrap) {
        customMarginsWrap.classList.toggle('hidden', state.marginPreset !== 'custom');
        ['top', 'right', 'bottom', 'left'].forEach(function (edge) {
          var inp = customMarginsWrap.querySelector('[data-margin-edge="' + edge + '"]');
          if (inp && state.customMargins) inp.value = String(state.customMargins[edge] || 10);
        });
      }
      if (designStyleSelect) designStyleSelect.value = state.designStyle;
      if (colorPickerEl) colorPickerEl.value = state.primaryColor;
      if (colorHexEl) colorHexEl.textContent = state.primaryColor;
      swatchBtns.forEach(function (sb) {
        sb.classList.toggle('is-active', sb.getAttribute('data-swatch') === state.primaryColor);
      });
      if (fontSelectEl) fontSelectEl.value = state.fontFamily;
      fontScaleBtns.forEach(function (fb) {
        var on = fb.getAttribute('data-font-scale') === state.fontSizeScale;
        fb.classList.toggle('is-active', on);
        fb.setAttribute('aria-pressed', String(on));
      });
      widthModeBtns.forEach(function (wb) {
        var isManual = wb.getAttribute('data-width-mode') === 'manual';
        var on = isManual ? !state.autoColumnWidths : Boolean(state.autoColumnWidths);
        wb.classList.toggle('is-active', on);
        wb.setAttribute('aria-pressed', String(on));
      });
      if (colsListEl) {
        colsListEl.querySelectorAll('[data-col-width]').forEach(function (inp) {
          inp.classList.toggle('hidden', Boolean(state.autoColumnWidths));
        });
      }
      notesSizeBtns.forEach(function (nb) {
        var on = nb.getAttribute('data-notes-size') === state.notesFontSize;
        nb.classList.toggle('is-active', on);
        nb.setAttribute('aria-pressed', String(on));
      });
      panelEl.querySelectorAll('[data-toggle-key]').forEach(function (chk) {
        var key = chk.getAttribute('data-toggle-key');
        if (key && state[key] !== undefined) chk.checked = Boolean(state[key]);
      });

      var effectiveStats = Object.assign({}, contentStats);
      if (columns.length && Array.isArray(state.selectedColumns) && state.selectedColumns.length) {
        effectiveStats.columnCount = state.selectedColumns.length;
      }
      var plan = computePlanForState(state, effectiveStats, lang);
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
      savePrefs(state, scopeKey);
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

    qualityBtns.forEach(function (qb) {
      qb.addEventListener('click', function () {
        if (!state.optimizeFileSize) return;
        state.quality = qb.getAttribute('data-quality') || 'balanced';
        emit('quality');
      });
    });

    orientBtns.forEach(function (ob) {
      ob.addEventListener('click', function () {
        state.orientation = ob.getAttribute('data-orient-btn') === 'portrait' ? 'portrait' : 'landscape';
        emit('orientation');
      });
    });

    if (paperSelect) {
      paperSelect.addEventListener('change', function () {
        state.paperSize = paperSelect.value;
        emit('paper');
      });
    }

    if (marginPresetSelect) {
      marginPresetSelect.addEventListener('change', function () {
        state.marginPreset = marginPresetSelect.value;
        emit('margin-preset');
      });
    }

    if (customMarginsWrap) {
      customMarginsWrap.querySelectorAll('[data-margin-edge]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var edge = inp.getAttribute('data-margin-edge');
          var val = Math.max(4, Math.min(35, Math.round(Number(inp.value || 10))));
          inp.value = String(val);
          state.customMargins = Object.assign({}, state.customMargins || { top: 10, right: 10, bottom: 10, left: 10 });
          state.customMargins[edge] = val;
          state.marginPreset = 'custom';
          emit('custom-margin');
        });
      });
    }

    if (designStyleSelect) {
      designStyleSelect.addEventListener('change', function () {
        state.designStyle = designStyleSelect.value === 'executive_classic' ? 'executive_classic' : 'modern_minimal';
        emit('design-style');
      });
    }

    if (colorPickerEl) {
      colorPickerEl.addEventListener('input', function () {
        state.primaryColor = String(colorPickerEl.value || '#D9232A').toUpperCase();
        emit('color-input');
      });
    }

    swatchBtns.forEach(function (sb) {
      sb.addEventListener('click', function () {
        state.primaryColor = sb.getAttribute('data-swatch') || '#D9232A';
        emit('color-swatch');
      });
    });

    if (resetBrandBtn) {
      resetBrandBtn.addEventListener('click', function () {
        state.primaryColor = '#D9232A';
        emit('reset-brand-color');
      });
    }

    if (fontSelectEl) {
      fontSelectEl.addEventListener('change', function () {
        state.fontFamily = fontSelectEl.value || 'IBM Plex Sans Arabic';
        emit('font-family');
      });
    }

    fontScaleBtns.forEach(function (fb) {
      fb.addEventListener('click', function () {
        state.fontSizeScale = fb.getAttribute('data-font-scale') || 'medium';
        emit('font-scale');
      });
    });

    widthModeBtns.forEach(function (wb) {
      wb.addEventListener('click', function () {
        state.autoColumnWidths = wb.getAttribute('data-width-mode') !== 'manual';
        emit('col-width-mode');
      });
    });

    notesSizeBtns.forEach(function (nb) {
      nb.addEventListener('click', function () {
        state.notesFontSize = nb.getAttribute('data-notes-size') || 'medium';
        emit('notes-font-size');
      });
    });

    panelEl.querySelectorAll('[data-toggle-key]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var key = chk.getAttribute('data-toggle-key');
        if (!key) return;
        state[key] = Boolean(chk.checked);
        emit('toggle-' + key);
      });
    });

    var colsAllBtn = panelEl.querySelector('[data-role="cols-all"]');
    if (colsAllBtn) {
      colsAllBtn.addEventListener('click', function () {
        state.selectedColumns = columns.map(function (c) { return c.key; });
        if (colsListEl) {
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
        }
        emit('cols-all');
      });
    }

    var colsResetBtn = panelEl.querySelector('[data-role="cols-reset"]');
    if (colsResetBtn) {
      colsResetBtn.addEventListener('click', function () {
        state.columnOrder = columns.map(function (c) { return c.key; });
        state.selectedColumns = null;
        state.columnWidths = {};
        state.autoColumnWidths = true;
        if (colsListEl) {
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
        }
        emit('cols-reset');
      });
    }

    var resetAllBtn = panelEl.querySelector('[data-role="reset-all-btn"]');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', function () {
        resetSavedPrefs(scopeKey);
        state = resolveSettings({
          orientation: (cfg.initialSettings && cfg.initialSettings.orientation) || 'landscape',
          paperSize: (cfg.initialSettings && cfg.initialSettings.paperSize) || 'a4',
          primaryColor: '#D9232A',
          designStyle: 'modern_minimal'
        });
        if (colsListEl) {
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
        }
        emit('reset-all');
      });
    }

    bindColumnsEvents();
    syncVisuals(cfg.actualMeta || null);

    return {
      getSettings: function () { return Object.assign({}, state); },
      setSettings: function (patch, silent) {
        state = resolveSettings(Object.assign({}, state, patch || {}));
        if (colsListEl) {
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
        }
        if (silent) syncVisuals(null);
        else emit('external');
      },
      setColumns: function (nextCols) {
        columns = Array.isArray(nextCols) ? nextCols.slice() : [];
        if (colsListEl) {
          colsListEl.innerHTML = renderColumnsListHtml(columns, state, isEn, s);
          bindColumnsEvents();
        }
        syncVisuals(null);
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
    formatKb: formatKb,
    getUserStorageKey: getUserStorageKey,
    savePrefs: savePrefs,
    loadPrefs: loadPrefs
  };
})(window);
