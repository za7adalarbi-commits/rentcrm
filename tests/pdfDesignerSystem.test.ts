import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('PDF_BRAND_IDENTITY exposes Web God official colors and normalizePdfHexColor validates/normalizes safely', () => {
  assert.equal(core.PDF_BRAND_IDENTITY.primaryColor, '#D9232A');
  assert.equal(core.PDF_BRAND_IDENTITY.darkGray, '#303030');
  assert.equal(core.PDF_BRAND_IDENTITY.white, '#FFFFFF');

  assert.equal(core.normalizePdfHexColor('#d9232a'), '#D9232A');
  assert.equal(core.normalizePdfHexColor('#abc'), '#AABBCC');
  assert.equal(core.normalizePdfHexColor('invalid-color'), '#D9232A');
  assert.equal(core.normalizePdfHexColor('', '#303030'), '#303030');
});

test('getPaperDimensionsMm supports A4, A3, and Letter in both Portrait and Landscape', () => {
  assert.deepEqual(core.getPaperDimensionsMm('a4', 'portrait'), { widthMm: 210, heightMm: 297 });
  assert.deepEqual(core.getPaperDimensionsMm('a4', 'landscape'), { widthMm: 297, heightMm: 210 });

  assert.deepEqual(core.getPaperDimensionsMm('a3', 'portrait'), { widthMm: 297, heightMm: 420 });
  assert.deepEqual(core.getPaperDimensionsMm('a3', 'landscape'), { widthMm: 420, heightMm: 297 });

  assert.deepEqual(core.getPaperDimensionsMm('letter', 'portrait'), { widthMm: 215.9, heightMm: 279.4 });
  assert.deepEqual(core.getPaperDimensionsMm('letter', 'landscape'), { widthMm: 279.4, heightMm: 215.9 });
});

test('computePdfLayoutPlan builds genuinely distinct Portrait vs Landscape layouts', () => {
  const portrait = core.computePdfLayoutPlan({
    orientation: 'portrait',
    paperSize: 'a4',
    rowCount: 18,
    columnCount: 6,
    kpiCount: 6,
    chartCount: 2
  });
  const landscape = core.computePdfLayoutPlan({
    orientation: 'landscape',
    paperSize: 'a4',
    rowCount: 18,
    columnCount: 6,
    kpiCount: 6,
    chartCount: 2
  });

  assert.ok(portrait.pageHpt > portrait.pageWpt, 'Portrait height > width');
  assert.ok(landscape.pageWpt > landscape.pageHpt, 'Landscape width > height');

  assert.ok(portrait.kpiPerRow <= 3, 'Portrait uses compact 2-3 KPI cards per row');
  assert.ok(landscape.kpiPerRow >= 4, 'Landscape uses wider 4-5 KPI cards per row');

  assert.equal(portrait.chartCols, 1, 'Portrait stacks charts full-width in 1 column');
  assert.equal(landscape.chartCols, 2, 'Landscape arranges charts side-by-side in 2 columns');

  assert.ok(portrait.maxCellLines > landscape.maxCellLines, 'Portrait allows more line wrapping inside narrow cells');
});

test('resolvePdfMarginsMm handles presets and clamps custom margins cleanly', () => {
  assert.deepEqual(core.resolvePdfMarginsMm('narrow'), { top: 6, right: 6, bottom: 6, left: 6 });
  assert.deepEqual(core.resolvePdfMarginsMm('normal'), { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(core.resolvePdfMarginsMm('wide'), { top: 15, right: 15, bottom: 15, left: 15 });

  assert.deepEqual(
    core.resolvePdfMarginsMm('custom', { top: 1, right: 18.44, bottom: 99, left: 'abc' }),
    { top: 4, right: 18.4, bottom: 35, left: 10 }
  );
});

test('resolveAdvancedPdfSettings applies Web God defaults and validates user overrides', () => {
  const defaults = core.resolveAdvancedPdfSettings({});
  assert.equal(defaults.designStyle, 'modern_minimal');
  assert.equal(defaults.primaryColor, '#D9232A');
  assert.equal(defaults.fontFamily, 'IBM Plex Sans Arabic');
  assert.equal(defaults.fontSizeScale, 'medium');
  assert.equal(defaults.marginPreset, 'normal');
  assert.equal(defaults.showLogo, true);
  assert.equal(defaults.showTitle, true);
  assert.equal(defaults.showDateTime, true);
  assert.equal(defaults.showFooter, true);
  assert.equal(defaults.showPageNumbers, true);
  assert.equal(defaults.showKpis, true);
  assert.equal(defaults.showTableHeaders, true);
  assert.equal(defaults.repeatTableHeader, true);
  assert.equal(defaults.autoColumnWidths, true);
  assert.equal(defaults.showNotes, true);
  assert.equal(defaults.notesFullUnclipped, true);
  assert.equal(defaults.notesPreserveLineBreaks, true);
  assert.equal(defaults.notesFontSize, 'medium');

  const customized = core.resolveAdvancedPdfSettings({
    designStyle: 'executive_classic',
    primaryColor: '#1e293b',
    fontFamily: 'Cairo',
    fontSizeScale: 'large',
    marginPreset: 'custom',
    customMargins: { top: 14, right: 8, bottom: 14, left: 8 },
    showLogo: false,
    showFooter: false,
    repeatTableHeader: false,
    autoColumnWidths: false,
    columnWidths: { notes: 45, status: 999, bad: 1 },
    notesFontSize: 'small'
  });

  assert.equal(customized.designStyle, 'executive_classic');
  assert.equal(customized.primaryColor, '#1E293B');
  assert.equal(customized.fontFamily, 'Cairo');
  assert.equal(customized.fontSizeScale, 'large');
  assert.equal(customized.marginPreset, 'custom');
  assert.deepEqual(customized.customMargins, { top: 14, right: 8, bottom: 14, left: 8 });
  assert.equal(customized.showLogo, false);
  assert.equal(customized.showFooter, false);
  assert.equal(customized.repeatTableHeader, false);
  assert.equal(customized.autoColumnWidths, false);
  assert.deepEqual(customized.columnWidths, { notes: 45 });
  assert.equal(customized.notesFontSize, 'small');
});

test('applyPdfColumnSelectionAndOrder filters, reorders, and attaches custom width weights', () => {
  const allCols = [
    { key: 'id', label: 'رقم الحجز', widthWeight: 10 },
    { key: 'customer', label: 'العميل', widthWeight: 18 },
    { key: 'car', label: 'السيارة', widthWeight: 14 },
    { key: 'notes', label: 'الملاحظات', widthWeight: 26 }
  ];

  const result = core.applyPdfColumnSelectionAndOrder(
    allCols,
    ['notes', 'id', 'unknown_col'],
    ['notes', 'car', 'id', 'customer'],
    { notes: 40 }
  );

  assert.deepEqual(
    result.map((c: { key: string }) => c.key),
    ['notes', 'id']
  );
  assert.equal(result[0].customWidthWeight, 40);
  assert.equal(result[1].customWidthWeight, undefined);

  const widths = core.computePdfColumnWidths(result, 1000);
  assert.equal(widths.length, 2);
  assert.ok(widths[0] > widths[1], 'Notes column with custom weight 40 gets more width than id weight 10');
  assert.ok(Math.abs(widths[0] + widths[1] - 1000) < 0.001, 'Computed column widths sum exactly to totalWidth');
});

test('wrapTextPreservingNewlines keeps explicit newlines and wraps unclipped multi-line notes without merging lines', () => {
  const measureMono = (s: string) => s.length * 8;
  const note = 'السطر الأول: تم التواصل مع العميل بنجاح\n\nالسطر الثالث يحتوي على نص طويل نسبياً يجب أن يلتف تلقائياً بدون قص أو دمج مع السطر السابق';

  const unclippedLines = core.wrapTextPreservingNewlines(measureMono, note, 160, {
    preserveLineBreaks: true,
    unclipped: true
  });

  assert.equal(unclippedLines[0].startsWith('السطر الأول'), true);
  assert.equal(unclippedLines.includes(''), true, 'Preserves intentional blank line separator');
  assert.equal(
    unclippedLines.some((l: string) => l.includes('بنجاح') && l.includes('السطر الثالث')),
    false,
    'Adjacent paragraphs separated by blank lines are never merged'
  );
  assert.ok(unclippedLines.length >= 5, 'Wraps long paragraph cleanly into multiple lines');
  assert.equal(unclippedLines.some((l: string) => l.includes('…')), false, 'Unclipped mode never appends ellipsis');

  const clippedLines = core.wrapTextPreservingNewlines(measureMono, note, 160, {
    preserveLineBreaks: true,
    unclipped: false,
    maxLines: 3
  });
  assert.equal(clippedLines.length, 3);
  assert.equal(clippedLines[2].endsWith('…'), true);
});

test('getUserPdfPrefsStorageKey isolates preferences per user safely', () => {
  assert.equal(core.getUserPdfPrefsStorageKey({ id: 'USR_101' }), 'rg_crm_pdf_export_prefs_v2_usr_101');
  assert.equal(core.getUserPdfPrefsStorageKey({ username: 'S.Admin@1' }), 'rg_crm_pdf_export_prefs_v2_s_admin_1');
  assert.equal(core.getUserPdfPrefsStorageKey(null), 'rg_crm_pdf_export_prefs_v2_guest');
});
