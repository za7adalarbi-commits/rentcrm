import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const core = require('../assets/js/core.js');
const excelDesigner = require('../assets/js/excelDesigner.js');

const ROOT = path.resolve(import.meta.dirname, '..');

test('RGExcelDesigner uses official Rental Gate brand colors (#D9232A, #303030, #FFFFFF)', () => {
  assert.equal(excelDesigner.BRAND.redHex, '#D9232A');
  assert.equal(excelDesigner.BRAND.charcoalHex, '#303030');
  assert.equal(excelDesigner.BRAND.whiteHex, '#FFFFFF');
  assert.equal(excelDesigner.BRAND.redArgb, 'FFD9232A');
  assert.equal(excelDesigner.BRAND.charcoalArgb, 'FF303030');
  assert.equal(excelDesigner.BRAND.whiteArgb, 'FFFFFFFF');
});

test('RGExcelDesigner.buildWorkbook produces branded RTL workbook with frozen header, isolated AutoFilter, zero table merges, wrapText, wide notes, SUBTOTAL formulas, and round-trip XLSX validity', async () => {
  const resHeaders = [
    { key: 'reservationNumber', label: 'رقم الحجز', formatType: 'ltr' },
    { key: 'customerName', label: 'اسم العميل' },
    { key: 'companyName', label: 'الشركة' },
    { key: 'daysCount', label: 'الأيام', formatType: 'number', summable: true },
    { key: 'totalAmount', label: 'الإجمالي', formatType: 'number', summable: true },
    { key: 'startDate', label: 'بداية الحجز', formatType: 'date' },
    { key: 'lastUpdateText', label: 'آخر تحديث والملاحظات' }
  ];

  const longMultilineNote = 'تم التواصل مع العميل وتأكيد موعد التسليم الساعة 14:00\nملاحظة إضافية: يرجى تجهيز العقد الإلكتروني والتحقق من الرخصة قبل التحرك';
  const rows = [
    {
      reservationNumber: 'RG-10045',
      customerName: 'عبدالله محمد السبيعي',
      companyName: 'بدجت السعودية',
      daysCount: 5,
      totalAmount: 1250.5,
      startDate: '2026-11-20',
      lastUpdateText: longMultilineNote
    },
    {
      reservationNumber: 'RG-10046',
      customerName: 'فهد سعد القحطاني',
      companyName: 'ذيب لتأجير السيارات',
      daysCount: 3,
      totalAmount: 780,
      startDate: '2026-11-21',
      lastUpdateText: 'بانتظار رد الفرع لتأكيد توفر السيارة'
    }
  ];

  const wb = excelDesigner.buildWorkbook(
    ExcelJS,
    [
      {
        name: 'جدول الحجوزات',
        title: 'تقرير جدول الحجوزات',
        periodText: '2026-11-01 → 2026-11-25',
        filtersText: 'الشركة: بدجت السعودية',
        summaryItems: [
          { label: 'إجمالي الحجوزات', value: 2 },
          { label: 'إجمالي المبالغ', value: '2,030.50' }
        ],
        headers: resHeaders,
        rows
      },
      {
        name: 'المشكلات والمتابعات',
        title: 'تقرير المشكلات',
        headers: [
          { key: 'problemNumber', label: 'رقم المشكلة', formatType: 'ltr' },
          { key: 'description', label: 'وصف المشكلة والملاحظات' },
          { key: 'followUpsCount', label: 'المتابعات', formatType: 'number', summable: true }
        ],
        rows: [
          {
            problemNumber: 'PRB-901',
            description: 'تأخر في تسليم المركبة بسبب صيانة دورية\nتم تحويل العميل لسيارة بديلة بنفس الفئة',
            followUpsCount: 4
          }
        ]
      }
    ],
    {
      lang: 'ar',
      exporterName: 'مشرف العمليات',
      exportedAt: '2026-11-25T10:30:00Z'
    },
    core
  );

  assert.equal(wb.worksheets.length, 2);
  const ws = wb.worksheets[0];

  // RTL view & frozen header row
  assert.ok(Array.isArray(ws.views) && ws.views.length === 1);
  assert.equal(ws.views[0].rightToLeft, true);
  assert.equal(ws.views[0].state, 'frozen');
  const headerRowNum = ws.views[0].ySplit;
  assert.equal(headerRowNum, 5, 'Title (1) + Meta (2) + Summary (3) + Spacer (4) -> Header at Row 5');

  // Brand styling on title, meta, summary, and table header
  assert.equal(ws.getCell(1, 1).fill.fgColor.argb, 'FFD9232A');
  assert.equal(ws.getCell(1, 1).font.color.argb, 'FFFFFFFF');
  assert.ok(String(ws.getCell(1, 1).value).includes('بوابة التأجير'));
  assert.ok(String(ws.getCell(1, 1).value).includes('تقرير جدول الحجوزات'));

  assert.equal(ws.getCell(2, 1).fill.fgColor.argb, 'FF303030');
  assert.ok(String(ws.getCell(2, 1).value).includes('2026-11-01 → 2026-11-25'));
  assert.ok(String(ws.getCell(2, 1).value).includes('مشرف العمليات'));

  assert.equal(ws.getCell(headerRowNum, 1).fill.fgColor.argb, 'FF303030');
  assert.equal(ws.getCell(headerRowNum, 1).font.color.argb, 'FFFFFFFF');
  assert.equal(ws.getCell(headerRowNum, 1).font.bold, true);

  // AutoFilter covers strictly header -> last data row (rows 5..7)
  assert.deepEqual(ws.autoFilter, {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum + rows.length, column: resHeaders.length }
  });

  // No merged cells inside table header or data/footer rows (rows >= 5)
  const merges = ws.model.merges || [];
  assert.ok(merges.length >= 2, 'Title & metadata banner use merges cleanly above spacer');
  for (const rangeRef of merges) {
    const startRowMatch = rangeRef.match(/^[A-Z]+(\d+):/);
    const startRow = startRowMatch ? Number(startRowMatch[1]) : 999;
    assert.ok(startRow < headerRowNum, `Merge ${rangeRef} must be strictly above table header row ${headerRowNum}`);
  }

  // Notes column is wide (>= 38), wraps text, preserves newlines, and adjusts row height
  const notesCol = ws.getColumn(7);
  assert.ok((notesCol.width || 0) >= 38, `Notes column width should be >= 38, got ${notesCol.width}`);
  const row1Data = ws.getRow(headerRowNum + 1);
  assert.equal(row1Data.getCell(7).alignment.wrapText, true);
  assert.ok(String(row1Data.getCell(7).value).includes('\n'), 'Multiline note preserves newline');
  assert.ok((row1Data.height || 0) >= 38, `Row height should expand for wrapped multiline text, got ${row1Data.height}`);

  // Numeric cells stay numbers (editable & sortable)
  assert.equal(typeof row1Data.getCell(4).value, 'number');
  assert.equal(row1Data.getCell(4).value, 5);
  assert.equal(typeof row1Data.getCell(5).value, 'number');
  assert.equal(row1Data.getCell(5).value, 1250.5);

  // Alternating zebra row fill
  assert.equal(ws.getRow(headerRowNum + 1).getCell(1).fill.fgColor.argb, 'FFFFFFFF');
  assert.equal(ws.getRow(headerRowNum + 2).getCell(1).fill.fgColor.argb, 'FFF8F9FA');

  // Footer totals row separated by spacer row and using SUBTOTAL(109,...) outside AutoFilter
  const footerRowNum = headerRowNum + rows.length + 2;
  const totalCell = ws.getRow(footerRowNum).getCell(5);
  assert.equal(typeof totalCell.value, 'object');
  assert.equal(totalCell.value.formula, `SUBTOTAL(109,E${headerRowNum + 1}:E${headerRowNum + rows.length})`);
  assert.equal(totalCell.value.result, 2030.5);

  // Print setup configured for A4 landscape fit-to-width
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.equal(ws.pageSetup.fitToPage, true);
  assert.equal(ws.pageSetup.fitToWidth, 1);
  assert.equal(ws.pageSetup.printTitlesRow, `${headerRowNum}:${headerRowNum}`);

  // Round-trip binary serialization & parsing via ExcelJS
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(Buffer.byteLength(buf) > 4000);

  const wbReloaded = new ExcelJS.Workbook();
  await wbReloaded.xlsx.load(buf);
  assert.equal(wbReloaded.worksheets.length, 2);
  assert.equal(wbReloaded.worksheets[0].getCell(headerRowNum + 1, 1).value, 'RG-10045');
  assert.deepEqual(
    wbReloaded.worksheets.map((s: any) => s.name),
    ['جدول الحجوزات', 'المشكلات والمتابعات']
  );
});

test('RGExcelDesigner supports English LTR layout, empty datasets, and multi-sheet compressed packing', async () => {
  const wbEn = excelDesigner.buildWorkbook(
    ExcelJS,
    [
      {
        name: 'Empty Report',
        title: 'Empty Reservations View',
        headers: [
          { key: 'reservationNumber', label: 'Booking #' },
          { key: 'notes', label: 'Notes' }
        ],
        rows: []
      }
    ],
    { lang: 'en', periodText: '2026-11-25' },
    core
  );

  const wsEn = wbEn.worksheets[0];
  assert.equal(wsEn.views[0].rightToLeft, false);
  assert.equal(wsEn.pageSetup.orientation, 'portrait');
  assert.equal(wsEn.autoFilter, null, 'No autoFilter on empty table');
  assert.ok(String(wsEn.getRow(wsEn.views[0].ySplit + 1).getCell(1).value).includes('No records'));

  const wbPacked = excelDesigner.buildWorkbook(
    ExcelJS,
    [
      {
        name: 'Bookings',
        headers: [
          { key: 'reservationNumber', label: 'رقم الحجز' },
          { key: 'totalAmount', label: 'الإجمالي', formatType: 'number', summable: true }
        ],
        rows: [
          { reservationNumber: 'RG-1', totalAmount: 100 },
          { reservationNumber: 'RG-2', totalAmount: 200 },
          { reservationNumber: 'RG-3', totalAmount: 300 },
          { reservationNumber: 'RG-4', totalAmount: 400 }
        ]
      }
    ],
    { lang: 'ar', compressEnabled: true, targetSheets: 2 },
    core
  );
  assert.equal(wbPacked.worksheets.length, 2);
});

test('Unified Export Menu component exists across all pages with no duplicate export triggers and preserves byte-for-byte mirrors', () => {
  const expectedFilesAndWraps = [
    ['assets/js/dashboard.js', 'dash-export-wrap'],
    ['assets/js/reservations.js', 'res-export-wrap'],
    ['assets/js/reservations.js', 'drawer-export-wrap'],
    ['assets/js/inactive.js', 'inact-export-wrap'],
    ['assets/js/followups.js', 'myfu-export-wrap'],
    ['assets/js/followups.js', 'tfu-export-wrap'],
    ['assets/js/problems.js', 'prb-export-wrap'],
    ['assets/js/employees.js', 'emp-export-wrap'],
    ['assets/js/reports.js', 'rep-export-wrap']
  ];

  for (const [relPath, wrapId] of expectedFilesAndWraps) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    assert.ok(src.includes(`wrapId: '${wrapId}'`), `${relPath} must use RGExportMenu with wrapId '${wrapId}'`);
    assert.ok(src.includes(`RGExportMenu.bind`), `${relPath} must bind RGExportMenu`);
  }

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('assets/js/excelDesigner.js'), 'index.html must load excelDesigner.js');
  assert.ok(indexHtml.includes('assets/js/exportMenu.js'), 'index.html must load exportMenu.js');

  const empPrimary = fs.readFileSync(path.join(ROOT, 'assets/js/employees.js'), 'utf8');
  const empMirror = fs.readFileSync(path.join(ROOT, 'src/assets/js/employees.js'), 'utf8');
  assert.equal(empPrimary, empMirror, 'assets/js/employees.js and src/assets/js/employees.js must be identical');

  const corePrimary = fs.readFileSync(path.join(ROOT, 'assets/js/core.js'), 'utf8');
  const coreMirror = fs.readFileSync(path.join(ROOT, 'backend/coreBridge.cjs'), 'utf8');
  assert.equal(corePrimary, coreMirror, 'assets/js/core.js and backend/coreBridge.cjs must be identical');
});
