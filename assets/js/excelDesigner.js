/**
 * RENTAL GATE CRM — Branded Excel Workbook Designer (ExcelJS)
 * Official Brand Identity: Red (#D9232A), Charcoal (#303030), White (#FFFFFF)
 * Shared by Browser Frontend & Node Unit Tests (UMD)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.RGExcelDesigner = factory(root);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  var BRAND = {
    nameAr: 'بوابة التأجير (Rental Gate)',
    nameEn: 'Rental Gate CRM',
    redHex: '#D9232A',
    charcoalHex: '#303030',
    whiteHex: '#FFFFFF',
    redArgb: 'FFD9232A',
    redDarkArgb: 'FFB81722',
    redSoftArgb: 'FFFDF2F2',
    charcoalArgb: 'FF303030',
    charcoalSubtleArgb: 'FF424242',
    whiteArgb: 'FFFFFFFF',
    zebraArgb: 'FFF8F9FA',
    summaryBgArgb: 'FFF4F5F7',
    borderLightArgb: 'FFDADDE2',
    borderHeaderDividerArgb: 'FF525252',
    textDarkArgb: 'FF1F2937',
    textMutedArgb: 'FF4B5563',
    fontFamily: 'Calibri'
  };

  function isNotesOrLongColumn(col) {
    if (!col) return false;
    var key = String(col.key || '');
    var label = String(col.label || '') + ' ' + String(col.labelEn || '');
    if (/^(notes|lastUpdateText|description|action|rejectionReason|cancellationReason|details|driverNotes|errorMessage|summaryText)$/i.test(key)) {
      return true;
    }
    return /ملاحظ|وصف|تحديث|سبب|إجراء|تفاصيل|note|desc|reason|detail|action|update/i.test(label);
  }

  function isLtrColumn(col) {
    if (!col) return false;
    if (col.formatType === 'ltr' || col.formatType === 'date' || col.formatType === 'datetime' || col.formatType === 'time' || col.formatType === 'number') {
      return true;
    }
    var key = String(col.key || '');
    return /number|phone|idnumber|date|time|at$|email|username|code|rank|count|amount|days|score|total|refund|duration/i.test(key);
  }

  function isSummableNumericColumn(col) {
    if (!col) return false;
    var key = String(col.key || '');
    if (/^(rank|id|reservationNumber|customerPhone|customerIdNumber|companyNumber|problemNumber|extensionNumber|year)$/i.test(key)) {
      return false;
    }
    if (col.summable === true) return true;
    if (col.summable === false) return false;
    if (col.formatType === 'number') return true;
    return /(amount|total|refund|price|cost|daysCount|extendDays|extensionsCount|followUpsCount|problemsCount|assignedReservations|followUps|closed|problemsResolved|reservationsCount|importedCount|updatedCount|score)/i.test(key);
  }

  function preserveMultilineText(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(function (line) {
        return line.replace(/[ \t]+/g, ' ').trim();
      })
      .join('\n')
      .trim();
  }

  function resolveRawCellValue(col, row, lang, coreHelper, options) {
    if (!row || !col) return '';
    var opts = options || {};
    var raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
    if (Array.isArray(raw)) {
      return raw.map(function (x) { return String(x === null || x === undefined ? '' : x).trim(); }).filter(Boolean).join('، ');
    }
    if (raw === undefined || raw === null || raw === '') return '';

    if (typeof raw === 'number' && isFinite(raw)) {
      return raw;
    }

    if (col.formatType === 'number') {
      var parsed = Number(String(raw).replace(/,/g, '').trim());
      if (String(raw).trim() !== '' && !isNaN(parsed) && isFinite(parsed)) {
        return parsed;
      }
    }

    if (typeof raw === 'boolean') {
      return raw ? (lang === 'en' ? 'Yes' : 'نعم') : (lang === 'en' ? 'No' : 'لا');
    }

    // Preserve explicit newlines for notes & long text fields instead of collapsing them
    if (typeof raw === 'string' && raw.indexOf('\n') !== -1 && (isNotesOrLongColumn(col) || col.preserveNewlines !== false)) {
      return preserveMultilineText(raw);
    }

    if (coreHelper && typeof coreHelper.formatReportCellValue === 'function') {
      var formatted = coreHelper.formatReportCellValue(col, row, lang, {
        keepNumber: true,
        emptyFallback: '',
        timeFormat: opts.timeFormat || '24h'
      });
      if (typeof formatted === 'number') return formatted;
      return formatted !== undefined && formatted !== null ? String(formatted) : '';
    }

    return preserveMultilineText(raw);
  }

  function formatExportTimestamp(isoOrDate, lang, timeFormat) {
    var d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    try {
      var fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: timeFormat === '12h'
      });
      return fmt.format(d);
    } catch (_e) {
      return d.toISOString().replace('T', ' ').substring(0, 16);
    }
  }

  function sanitizeSheetTitle(rawTitle, idx, existingNames) {
    var base = String(rawTitle || ('Sheet_' + (idx + 1)))
      .replace(/[\\/?*\[\]:]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || ('Sheet_' + (idx + 1));
    var trimmed = base.substring(0, 31);
    var unique = trimmed;
    var suffix = 2;
    while (existingNames.indexOf(unique) !== -1) {
      var tail = '_' + suffix++;
      unique = trimmed.substring(0, Math.max(1, 31 - tail.length)) + tail;
    }
    return unique;
  }

  function estimateWrappedLineCount(text, colWidthChars) {
    if (text === null || text === undefined || text === '') return 1;
    var str = String(text);
    var safeWidth = Math.max(8, Number(colWidthChars || 14) - 2);
    // Arabic glyphs & Calibri bold headers occupy slightly more horizontal width
    var effectiveCharsPerLine = Math.max(6, Math.floor(safeWidth * 0.86));
    var lines = str.split('\n');
    var totalLines = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) {
        totalLines += 1;
        continue;
      }
      totalLines += Math.max(1, Math.ceil(line.length / effectiveCharsPerLine));
    }
    return Math.max(1, totalLines);
  }

  function computeColumnWidth(col, headerLabel, dataRowsValues, colIndex) {
    var isNotes = isNotesOrLongColumn(col);
    var minW = isNotes ? 38 : (isLtrColumn(col) ? 14 : 13);
    var maxW = isNotes ? 62 : 36;

    var maxLineLen = String(headerLabel || '').length;
    var sampleLimit = Math.min(dataRowsValues.length, 400);
    for (var r = 0; r < sampleLimit; r++) {
      var cellVal = dataRowsValues[r][colIndex];
      if (cellVal === null || cellVal === undefined || cellVal === '') continue;
      var parts = String(cellVal).split('\n');
      for (var p = 0; p < parts.length; p++) {
        if (parts[p].length > maxLineLen) {
          maxLineLen = parts[p].length;
        }
      }
    }

    var w = maxLineLen + 5;
    if (w < minW) w = minW;
    if (w > maxW) w = maxW;
    return Math.round(w * 10) / 10;
  }

  function buildAutoSummaryItems(headers, typedRows, lang) {
    var isEn = lang === 'en';
    var items = [
      {
        label: isEn ? 'Total Records' : 'إجمالي السجلات',
        value: typedRows.length
      }
    ];
    for (var c = 0; c < headers.length; c++) {
      if (items.length >= 5) break;
      var col = headers[c];
      if (!isSummableNumericColumn(col)) continue;
      var sum = 0;
      var numericCount = 0;
      for (var r = 0; r < typedRows.length; r++) {
        var v = typedRows[r][c];
        if (typeof v === 'number' && isFinite(v)) {
          sum += v;
          numericCount++;
        }
      }
      if (numericCount > 0) {
        var rounded = Math.round(sum * 100) / 100;
        var colLbl = (isEn && col.labelEn) ? col.labelEn : (col.label || col.key);
        items.push({
          label: (isEn ? 'Total ' : 'إجمالي ') + colLbl,
          value: rounded.toLocaleString(isEn ? 'en-US' : 'en-US')
        });
      }
    }
    return items;
  }

  function encodeColLetters(colNum1Based) {
    var n = Number(colNum1Based);
    var out = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  function makeThinBorder(argb) {
    var side = { style: 'thin', color: { argb: argb || BRAND.borderLightArgb } };
    return { top: side, left: side, bottom: side, right: side };
  }

  function buildNormalizedSheetSpecs(sheetsConfig, options, coreHelper) {
    var opts = options || {};
    if (coreHelper && typeof coreHelper.buildCompressedExcelSheets === 'function' && opts.compressEnabled) {
      return coreHelper.buildCompressedExcelSheets(sheetsConfig, opts);
    }
    return (Array.isArray(sheetsConfig) ? sheetsConfig : []).map(function (cfg, idx) {
      return Object.assign({}, cfg || {}, {
        name: (cfg && cfg.name) || ('Sheet_' + (idx + 1)),
        headers: Array.isArray(cfg && cfg.headers) ? cfg.headers : [],
        rows: Array.isArray(cfg && cfg.rows) ? cfg.rows : [],
        preformattedAoa: Array.isArray(cfg && cfg.preformattedAoa) ? cfg.preformattedAoa : null
      });
    });
  }

  function buildWorkbook(ExcelJSLib, sheetsConfig, options, coreHelper) {
    if (!ExcelJSLib || typeof ExcelJSLib.Workbook !== 'function') {
      throw new Error('مكتبة ExcelJS غير محملة.');
    }

    var opts = options || {};
    var core = coreHelper || root.RGCrmCore || null;
    var lang = opts.lang === 'en' ? 'en' : 'ar';
    var isEn = lang === 'en';
    var isRtl = !isEn;
    var timeFormat = opts.timeFormat || ((root.RGApp && root.RGApp.getTimeFormat) ? root.RGApp.getTimeFormat() : '24h');
    var exportedAtText = opts.exportedAtText || formatExportTimestamp(opts.exportedAt, lang, timeFormat);

    var wb = new ExcelJSLib.Workbook();
    wb.creator = 'Rental Gate CRM';
    wb.lastModifiedBy = opts.exporterName || 'Rental Gate CRM';
    wb.created = new Date();
    wb.modified = new Date();

    var normalizedSheets = buildNormalizedSheetSpecs(sheetsConfig, opts, core);
    var usedSheetNames = [];

    normalizedSheets.forEach(function (cfg, sIdx) {
      var sheetTitle = sanitizeSheetTitle(cfg.name, sIdx, usedSheetNames);
      usedSheetNames.push(sheetTitle);
      var ws = wb.addWorksheet(sheetTitle, {
        views: [{ rightToLeft: isRtl }]
      });

      var headers = Array.isArray(cfg.headers) ? cfg.headers : [];
      var rawRows = Array.isArray(cfg.rows) ? cfg.rows : [];
      var preAoa = (Array.isArray(cfg.preformattedAoa) && cfg.preformattedAoa.length > 0) ? cfg.preformattedAoa : null;

      // Normalize headers & rows even if preformattedAoa was passed without explicit headers
      var headerLabels = [];
      var typedRows = [];
      var isPreAoa = false;

      if (preAoa) {
        isPreAoa = true;
        var hasSectionBanner = String((preAoa[0] && preAoa[0][0]) || '').indexOf('---') === 0;
        if (!hasSectionBanner && preAoa.length > 0) {
          headerLabels = preAoa[0].map(function (h) { return String(h === undefined || h === null ? '' : h); });
          typedRows = preAoa.slice(1);
          if (headers.length === 0) {
            headers = headerLabels.map(function (lbl, idx) {
              return { key: 'col_' + idx, label: lbl, labelEn: lbl };
            });
          }
        } else {
          var maxAoaCols = 1;
          for (var pIdx = 0; pIdx < preAoa.length; pIdx++) {
            if (Array.isArray(preAoa[pIdx]) && preAoa[pIdx].length > maxAoaCols) {
              maxAoaCols = preAoa[pIdx].length;
            }
          }
          for (var mc = 0; mc < maxAoaCols; mc++) {
            headerLabels.push(isEn ? ('Column ' + (mc + 1)) : ('عمود ' + (mc + 1)));
            headers.push({ key: 'col_' + mc, label: headerLabels[mc], labelEn: headerLabels[mc] });
          }
          typedRows = preAoa;
        }
      } else {
        if (headers.length === 0 && rawRows.length > 0 && typeof rawRows[0] === 'object') {
          headers = Object.keys(rawRows[0]).map(function (k) {
            return { key: k, label: k, labelEn: k };
          });
        }
        headerLabels = headers.map(function (h) {
          return (isEn && h.labelEn) ? h.labelEn : (h.label || h.key || '');
        });
        typedRows = rawRows.map(function (r) {
          return headers.map(function (h) {
            return resolveRawCellValue(h, r, lang, core, { timeFormat: timeFormat });
          });
        });
      }

      var colCount = Math.max(1, headers.length);
      var reportTitle = cfg.title || opts.title || cfg.name || (isEn ? 'CRM Report' : 'تقرير النظام');
      var periodText = cfg.periodText || opts.periodText || (isEn ? 'All Dates / Active Filter View' : 'كافة التواريخ / حسب الفلتر النشط');
      var filtersText = cfg.filtersText || opts.filtersText || '';
      var exporterName = cfg.exporterName || opts.exporterName || '';

      var summaryItems = Array.isArray(cfg.summaryItems) && cfg.summaryItems.length
        ? cfg.summaryItems
        : (Array.isArray(opts.summaryItems) && opts.summaryItems.length && sIdx === 0
            ? opts.summaryItems
            : (!isPreAoa ? buildAutoSummaryItems(headers, typedRows, lang) : []));

      // Compute column widths first so dynamic row heights can wrap accurately
      var colWidths = [];
      for (var cIdx = 0; cIdx < colCount; cIdx++) {
        var colWidth = computeColumnWidth(headers[cIdx], headerLabels[cIdx], typedRows, cIdx);
        colWidths.push(colWidth);
        ws.getColumn(cIdx + 1).width = colWidth;
      }
      var totalSheetChars = colWidths.reduce(function (acc, w) { return acc + w; }, 0);

      // =========================================================================
      // TOP BRAND HEADER BLOCK (Merged ONLY in Title/Metadata/Summary area!)
      // =========================================================================
      var curRowIdx = 1;

      // Row 1: Brand Title Banner (#D9232A Red + #FFFFFF Bold Text)
      var brandTitleText = (isEn ? BRAND.nameEn : BRAND.nameAr) + '  —  ' + reportTitle;
      var titleRow = ws.getRow(curRowIdx);
      titleRow.getCell(1).value = brandTitleText;
      if (colCount > 1) {
        ws.mergeCells(curRowIdx, 1, curRowIdx, colCount);
      }
      for (var tc = 1; tc <= colCount; tc++) {
        var tCell = titleRow.getCell(tc);
        tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.redArgb } };
        tCell.font = { name: BRAND.fontFamily, size: 15, bold: true, color: { argb: BRAND.whiteArgb } };
        tCell.alignment = {
          horizontal: isRtl ? 'right' : 'left',
          vertical: 'middle',
          wrapText: true,
          readingOrder: isRtl ? 'rtl' : 'ltr'
        };
        tCell.border = {
          top: { style: 'medium', color: { argb: BRAND.redDarkArgb } },
          bottom: { style: 'thin', color: { argb: BRAND.redDarkArgb } }
        };
      }
      var titleLines = estimateWrappedLineCount(brandTitleText, Math.max(40, totalSheetChars * 0.72));
      titleRow.height = Math.max(34, titleLines * 20 + 12);
      curRowIdx++;

      // Row 2: Metadata Bar (#303030 Dark Charcoal + #FFFFFF Text)
      var metaParts = [
        (isEn ? 'Exported At: ' : 'تاريخ الاستخراج: ') + exportedAtText,
        (isEn ? 'Period: ' : 'الفترة المحددة: ') + periodText,
        (isEn ? 'Records: ' : 'عدد السجلات: ') + typedRows.length
      ];
      if (filtersText) {
        metaParts.push((isEn ? 'Filters: ' : 'الفلاتر: ') + filtersText);
      }
      if (exporterName) {
        metaParts.push((isEn ? 'By: ' : 'بواسطة: ') + exporterName);
      }
      var metaText = metaParts.join('   |   ');
      var metaRow = ws.getRow(curRowIdx);
      metaRow.getCell(1).value = metaText;
      if (colCount > 1) {
        ws.mergeCells(curRowIdx, 1, curRowIdx, colCount);
      }
      for (var mcIdx = 1; mcIdx <= colCount; mcIdx++) {
        var mCell = metaRow.getCell(mcIdx);
        mCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.charcoalArgb } };
        mCell.font = { name: BRAND.fontFamily, size: 10, bold: false, color: { argb: BRAND.whiteArgb } };
        mCell.alignment = {
          horizontal: isRtl ? 'right' : 'left',
          vertical: 'middle',
          wrapText: true,
          readingOrder: isRtl ? 'rtl' : 'ltr'
        };
        mCell.border = {
          bottom: { style: 'medium', color: { argb: BRAND.redArgb } }
        };
      }
      var metaLines = estimateWrappedLineCount(metaText, Math.max(48, totalSheetChars * 0.92));
      metaRow.height = Math.max(24, metaLines * 15 + 10);
      curRowIdx++;

      // Row 3 (Optional): Statistical Summary Ribbon (Above data table, isolated from sort/filter)
      if (summaryItems.length > 0) {
        var summaryText = (isEn ? 'Summary:  ' : 'الملخص الإحصائي:  ') +
          summaryItems.map(function (it) {
            return String(it.label || '') + ': ' + String(it.value !== undefined && it.value !== null ? it.value : '-');
          }).join('   |   ');
        var sumRow = ws.getRow(curRowIdx);
        sumRow.getCell(1).value = summaryText;
        if (colCount > 1) {
          ws.mergeCells(curRowIdx, 1, curRowIdx, colCount);
        }
        for (var sc = 1; sc <= colCount; sc++) {
          var sCell = sumRow.getCell(sc);
          sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.redSoftArgb } };
          sCell.font = { name: BRAND.fontFamily, size: 10.5, bold: true, color: { argb: BRAND.charcoalArgb } };
          sCell.alignment = {
            horizontal: isRtl ? 'right' : 'left',
            vertical: 'middle',
            wrapText: true,
            readingOrder: isRtl ? 'rtl' : 'ltr'
          };
          sCell.border = {
            top: { style: 'thin', color: { argb: BRAND.borderLightArgb } },
            bottom: { style: 'thin', color: { argb: BRAND.redArgb } },
            left: { style: 'thin', color: { argb: BRAND.borderLightArgb } },
            right: { style: 'thin', color: { argb: BRAND.borderLightArgb } }
          };
        }
        var sumLines = estimateWrappedLineCount(summaryText, Math.max(48, totalSheetChars * 0.9));
        sumRow.height = Math.max(24, sumLines * 16 + 8);
        curRowIdx++;
      }

      // Blank Spacer Row separating Header/Summary block from Sortable/Filterable Table
      var spacerRow = ws.getRow(curRowIdx);
      spacerRow.height = 8;
      curRowIdx++;

      // =========================================================================
      // DATA TABLE HEADER ROW (ZERO merged cells, AutoFilter + Freeze anchor)
      // =========================================================================
      var tableHeaderRowNum = curRowIdx;
      var headerRow = ws.getRow(tableHeaderRowNum);
      var maxHeaderLines = 1;
      for (var hc = 0; hc < colCount; hc++) {
        var hLbl = String(headerLabels[hc] || '');
        var hCell = headerRow.getCell(hc + 1);
        hCell.value = hLbl;
        hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.charcoalArgb } };
        hCell.font = { name: BRAND.fontFamily, size: 11, bold: true, color: { argb: BRAND.whiteArgb } };
        hCell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
          readingOrder: isRtl ? 'rtl' : 'ltr'
        };
        hCell.border = {
          top: { style: 'thin', color: { argb: BRAND.charcoalArgb } },
          bottom: { style: 'medium', color: { argb: BRAND.redArgb } },
          left: { style: 'thin', color: { argb: BRAND.borderHeaderDividerArgb } },
          right: { style: 'thin', color: { argb: BRAND.borderHeaderDividerArgb } }
        };
        var hLines = estimateWrappedLineCount(hLbl, colWidths[hc]);
        if (hLines > maxHeaderLines) maxHeaderLines = hLines;
      }
      headerRow.height = Math.max(28, maxHeaderLines * 16 + 10);
      curRowIdx++;

      // =========================================================================
      // DATA ROWS (ZERO merged cells, alternating zebra, wrapText, auto heights)
      // =========================================================================
      var dataStartRowNum = curRowIdx;
      var dataEndRowNum = dataStartRowNum - 1;

      if (typedRows.length === 0) {
        var emptyRow = ws.getRow(curRowIdx);
        emptyRow.getCell(1).value = isEn ? 'No records match the current filters.' : 'لا توجد سجلات مطابقة للفلاتر الحالية.';
        for (var ec = 1; ec <= colCount; ec++) {
          var eCell = emptyRow.getCell(ec);
          eCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.whiteArgb } };
          eCell.font = { name: BRAND.fontFamily, size: 10.5, italic: true, color: { argb: BRAND.textMutedArgb } };
          eCell.alignment = { horizontal: isRtl ? 'right' : 'left', vertical: 'middle', wrapText: true };
          eCell.border = makeThinBorder(BRAND.borderLightArgb);
        }
        emptyRow.height = 28;
        curRowIdx++;
      } else {
        for (var rIdx = 0; rIdx < typedRows.length; rIdx++) {
          var rowVals = typedRows[rIdx];
          var xlRow = ws.getRow(curRowIdx);
          var isOddRow = (rIdx % 2) === 1;
          var rowBgArgb = isOddRow ? BRAND.zebraArgb : BRAND.whiteArgb;
          var maxRowLines = 1;
          var isBannerRow = isPreAoa && Array.isArray(rowVals) && rowVals.length === 1 && String(rowVals[0] || '').indexOf('---') === 0;

          for (var c = 0; c < colCount; c++) {
            var colDef = headers[c] || {};
            var cellVal = Array.isArray(rowVals) ? rowVals[c] : undefined;
            if (cellVal === undefined || cellVal === null) cellVal = '';

            var cell = xlRow.getCell(c + 1);
            cell.value = cellVal;

            if (isBannerRow) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.summaryBgArgb } };
              cell.font = { name: BRAND.fontFamily, size: 10.5, bold: true, color: { argb: BRAND.redArgb } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgArgb } };
              cell.font = { name: BRAND.fontFamily, size: 10.5, bold: false, color: { argb: BRAND.textDarkArgb } };
            }

            var isNum = typeof cellVal === 'number' && isFinite(cellVal);
            var isLtr = isLtrColumn(colDef);
            var isNotes = isNotesOrLongColumn(colDef);
            var horizAlign = isNotes
              ? (isRtl ? 'right' : 'left')
              : (isNum || isLtr ? 'center' : (isRtl ? 'right' : 'left'));

            cell.alignment = {
              horizontal: horizAlign,
              vertical: 'middle',
              wrapText: true,
              readingOrder: isLtr ? 'ltr' : (isRtl ? 'rtl' : 'ltr')
            };

            if (isNum) {
              cell.numFmt = Number.isInteger(cellVal) ? '#,##0' : '#,##0.00';
            }

            cell.border = makeThinBorder(BRAND.borderLightArgb);

            var linesNeeded = estimateWrappedLineCount(cellVal, colWidths[c]);
            if (linesNeeded > maxRowLines) maxRowLines = linesNeeded;
          }

          xlRow.height = Math.max(22, Math.min(260, maxRowLines * 15.5 + 8));
          dataEndRowNum = curRowIdx;
          curRowIdx++;
        }

        // =======================================================================
        // FOOTER TOTALS ROW (Separated by blank row, OUTSIDE AutoFilter range!)
        // =======================================================================
        if (!isPreAoa && typedRows.length > 0) {
          var hasAnySummable = headers.some(isSummableNumericColumn);
          if (hasAnySummable) {
            var footerSpacer = ws.getRow(curRowIdx);
            footerSpacer.height = 8;
            curRowIdx++;

            var totalRow = ws.getRow(curRowIdx);
            for (var fc = 0; fc < colCount; fc++) {
              var fCol = headers[fc];
              var fCell = totalRow.getCell(fc + 1);
              var colLet = encodeColLetters(fc + 1);
              var rangeRef = colLet + dataStartRowNum + ':' + colLet + dataEndRowNum;

              if (fc === 0) {
                fCell.value = isEn ? ('Filtered Count / Totals') : ('إجمالي / عدد النتائج المصفاة');
              } else if (isSummableNumericColumn(fCol)) {
                var cachedSum = 0;
                for (var sr = 0; sr < typedRows.length; sr++) {
                  var sv = typedRows[sr][fc];
                  if (typeof sv === 'number' && isFinite(sv)) cachedSum += sv;
                }
                var roundedSum = Math.round(cachedSum * 100) / 100;
                fCell.value = {
                  formula: 'SUBTOTAL(109,' + rangeRef + ')',
                  result: roundedSum
                };
                fCell.numFmt = Number.isInteger(roundedSum) ? '#,##0' : '#,##0.00';
              } else if (fc === 1 && colCount >= 2) {
                fCell.value = {
                  formula: 'SUBTOTAL(103,A' + dataStartRowNum + ':A' + dataEndRowNum + ')',
                  result: typedRows.length
                };
                fCell.numFmt = '#,##0';
              } else {
                fCell.value = '';
              }

              fCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.redSoftArgb } };
              fCell.font = { name: BRAND.fontFamily, size: 10.5, bold: true, color: { argb: BRAND.charcoalArgb } };
              fCell.alignment = {
                horizontal: (fc === 0 && isRtl) ? 'right' : (fc === 0 ? 'left' : 'center'),
                vertical: 'middle',
                wrapText: true,
                readingOrder: isRtl ? 'rtl' : 'ltr'
              };
              fCell.border = {
                top: { style: 'medium', color: { argb: BRAND.redArgb } },
                bottom: { style: 'thin', color: { argb: BRAND.borderLightArgb } },
                left: { style: 'thin', color: { argb: BRAND.borderLightArgb } },
                right: { style: 'thin', color: { argb: BRAND.borderLightArgb } }
              };
            }
            totalRow.height = 25;
            curRowIdx++;
          }
        }
      }

      // =========================================================================
      // FREEZE HEADERS, AUTOFILTER, RTL VIEW & PRINT SETUP
      // =========================================================================
      ws.views = [{
        state: 'frozen',
        ySplit: tableHeaderRowNum,
        xSplit: 0,
        rightToLeft: isRtl,
        activeCell: 'A' + (tableHeaderRowNum + 1)
      }];

      if (typedRows.length > 0 && colCount > 0 && !isPreAoa) {
        ws.autoFilter = {
          from: { row: tableHeaderRowNum, column: 1 },
          to: { row: dataEndRowNum, column: colCount }
        };
      }

      ws.pageSetup = {
        orientation: colCount >= 6 ? 'landscape' : 'portrait',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        showGridLines: true,
        printTitlesRow: tableHeaderRowNum + ':' + tableHeaderRowNum,
        margins: {
          left: 0.35,
          right: 0.35,
          top: 0.5,
          bottom: 0.5,
          header: 0.25,
          footer: 0.25
        }
      };

      ws.headerFooter = {
        oddFooter: isRtl
          ? '&Rبوابة التأجير — Rental Gate CRM&Lصفحة &P من &N'
          : '&LRental Gate CRM&RPage &P of &N'
      };
    });

    return wb;
  }

  async function ensureExcelJsLoaded() {
    if (root.ExcelJS && typeof root.ExcelJS.Workbook === 'function') return root.ExcelJS;
    if (typeof root.RGLoadVendorScript === 'function') {
      await root.RGLoadVendorScript('assets/vendor/exceljs.min.js');
    }
    if (!root.ExcelJS || typeof root.ExcelJS.Workbook !== 'function') {
      throw new Error('مكتبة ExcelJS غير محملة.');
    }
    return root.ExcelJS;
  }

  function triggerBlobDownload(buffer, filename) {
    var blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'rental-gate-report.xlsx';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      try { if (link.parentNode) link.parentNode.removeChild(link); } catch (_e1) {}
      try { URL.revokeObjectURL(url); } catch (_e2) {}
    }, 1500);
  }

  async function exportWorkbook(sheetsConfig, filename, options) {
    var ExcelJSLib = await ensureExcelJsLoaded();
    var opts = Object.assign({}, options || {});
    if (!opts.lang && typeof document !== 'undefined') {
      opts.lang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
    }
    if (!opts.exporterName && root.RGAuth && typeof root.RGAuth.getUser === 'function') {
      var u = root.RGAuth.getUser();
      if (u && u.name) opts.exporterName = u.name;
    }
    var wb = buildWorkbook(ExcelJSLib, sheetsConfig, opts, root.RGCrmCore || null);
    var buf = await wb.xlsx.writeBuffer();
    triggerBlobDownload(buf, filename || 'rental-gate-report.xlsx');
    return {
      sheetCount: wb.worksheets.length,
      sheetNames: wb.worksheets.map(function (ws) { return ws.name; }),
      compressed: Boolean(opts.compressEnabled),
      styled: true
    };
  }

  return {
    BRAND: BRAND,
    isNotesOrLongColumn: isNotesOrLongColumn,
    isLtrColumn: isLtrColumn,
    isSummableNumericColumn: isSummableNumericColumn,
    preserveMultilineText: preserveMultilineText,
    estimateWrappedLineCount: estimateWrappedLineCount,
    computeColumnWidth: computeColumnWidth,
    buildWorkbook: buildWorkbook,
    ensureExcelJsLoaded: ensureExcelJsLoaded,
    exportWorkbook: exportWorkbook
  };
}));
