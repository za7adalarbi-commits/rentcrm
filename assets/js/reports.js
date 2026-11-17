/**
 * RENTAL GATE CRM — Advanced Reports, Compressed Excel (SheetJS) & Lightweight Arabic RTL PDF (jsPDF + Canvas)
 */
(function (root) {
  'use strict';

  function loadLogoImage() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = (root.RGCrmCore && root.RGCrmCore.resolveAssetUrl)
        ? root.RGCrmCore.resolveAssetUrl('assets/images/logo.png', root.__RG_BASE_URL__)
        : './assets/images/logo.png';
    });
  }

  async function ensureXlsxLoaded() {
    if (root.XLSX) return;
    if (root.RGLoadVendorScript) {
      await root.RGLoadVendorScript('assets/vendor/xlsx.full.min.js');
    }
    if (!root.XLSX) {
      throw new Error('مكتبة SheetJS غير محملة.');
    }
  }

  async function ensureJsPdfLoaded() {
    if (root.jspdf && root.jspdf.jsPDF) return;
    if (root.RGLoadVendorScript) {
      await root.RGLoadVendorScript('assets/vendor/jspdf.umd.min.js');
    }
    if (!root.jspdf || !root.jspdf.jsPDF) {
      throw new Error('مكتبة jsPDF غير محملة.');
    }
  }

  function captureChartForPdf(canvasEl, title) {
    if (!canvasEl) return null;
    var chartInst = (root.Chart && typeof root.Chart.getChart === 'function')
      ? root.Chart.getChart(canvasEl)
      : null;

    var restoredState = [];
    if (chartInst && chartInst.options) {
      try {
        var opts = chartInst.options;
        if (opts.plugins && opts.plugins.legend && opts.plugins.legend.labels) {
          restoredState.push({ target: opts.plugins.legend.labels, key: 'color', val: opts.plugins.legend.labels.color });
          opts.plugins.legend.labels.color = '#1e293b';
        }
        if (opts.scales) {
          Object.keys(opts.scales).forEach(function (sk) {
            var sc = opts.scales[sk];
            if (sc && sc.ticks) {
              restoredState.push({ target: sc.ticks, key: 'color', val: sc.ticks.color });
              sc.ticks.color = '#1e293b';
            }
            if (sc && sc.grid) {
              restoredState.push({ target: sc.grid, key: 'color', val: sc.grid.color });
              sc.grid.color = 'rgba(15, 23, 42, 0.1)';
            }
          });
        }
        chartInst.update('none');
      } catch (e) {}
    }

    var outDataUrl = '';
    try {
      var off = document.createElement('canvas');
      off.width = Math.max(1, canvasEl.width || 600);
      off.height = Math.max(1, canvasEl.height || 300);
      var octx = off.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, off.width, off.height);
      octx.drawImage(canvasEl, 0, 0, off.width, off.height);
      outDataUrl = off.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      outDataUrl = '';
    } finally {
      if (chartInst && restoredState.length) {
        try {
          restoredState.forEach(function (entry) {
            entry.target[entry.key] = entry.val;
          });
          chartInst.update('none');
        } catch (e2) {}
      }
    }

    return outDataUrl ? { title: title || '', dataUrl: outDataUrl } : null;
  }

  async function exportExcelWorkbook(sheetsConfig, filename, options) {
    await ensureXlsxLoaded();
    var core = root.RGCrmCore;
    var opts = options || {};
    var normalizedSheets = (core && core.buildCompressedExcelSheets)
      ? core.buildCompressedExcelSheets(sheetsConfig, opts)
      : (sheetsConfig || []);

    var wb = root.XLSX.utils.book_new();
    normalizedSheets.forEach(function (cfg, sIdx) {
      var aoa = null;
      var headers = cfg.headers || [];
      var rows = cfg.rows || [];
      if (Array.isArray(cfg.preformattedAoa) && cfg.preformattedAoa.length > 0) {
        aoa = cfg.preformattedAoa;
      } else {
        aoa = [headers.map(function (h) { return h.label || h.key || ''; })];
        rows.forEach(function (r) {
          aoa.push(headers.map(function (h) {
            if (core && core.formatReportCellValue) {
              return core.formatReportCellValue(h, r, 'ar', { keepNumber: true, emptyFallback: '' });
            }
            var v = typeof h.value === 'function' ? h.value(r) : r[h.key];
            if (Array.isArray(v)) return v.join('، ');
            return v !== undefined && v !== null ? v : '';
          }));
        });
      }

      var ws = root.XLSX.utils.aoa_to_sheet(aoa);
      var maxCols = 0;
      aoa.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });

      var colWidths = [];
      for (var c = 0; c < maxCols; c++) {
        var maxLen = 10;
        var sampleLimit = Math.min(aoa.length, 60);
        for (var r = 0; r < sampleLimit; r++) {
          var cellVal = aoa[r][c];
          if (cellVal !== undefined && cellVal !== null) {
            var len = String(cellVal).length;
            if (len > maxLen) maxLen = len;
          }
        }
        colWidths.push({ wch: Math.max(12, Math.min(44, maxLen + 4)) });
      }
      if (colWidths.length) ws['!cols'] = colWidths;

      if (aoa.length > 1 && maxCols > 0 && !(opts.compressEnabled && aoa[0] && String(aoa[0][0] || '').indexOf('---') === 0)) {
        var lastCol = root.XLSX.utils.encode_col(Math.max(0, maxCols - 1));
        ws['!autofilter'] = { ref: 'A1:' + lastCol + aoa.length };
      }
      ws['!views'] = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];

      var sheetTitle = String(cfg.name || ('Report_' + (sIdx + 1))).replace(/[\\/?*\[\]:]/g, '-').substring(0, 31) || ('Sheet_' + (sIdx + 1));
      var uniqueTitle = sheetTitle;
      var suffix = 2;
      while (wb.SheetNames.indexOf(uniqueTitle) !== -1) {
        var tail = '_' + suffix++;
        uniqueTitle = sheetTitle.substring(0, 31 - tail.length) + tail;
      }
      root.XLSX.utils.book_append_sheet(wb, ws, uniqueTitle);
    });

    root.XLSX.writeFile(wb, filename || 'rental-gate-report.xlsx', { compression: true });
    return {
      sheetCount: wb.SheetNames.length,
      sheetNames: wb.SheetNames.slice(),
      compressed: Boolean(opts.compressEnabled)
    };
  }

  function wrapCanvasText(ctx, text, maxWidth, maxLines) {
    var raw = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!raw) return ['-'];
    if (maxWidth <= 20 || ctx.measureText(raw).width <= maxWidth) return [raw];

    var words = raw.split(' ');
    var lines = [];
    var current = '';

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var candidate = current ? (current + ' ' + word) : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
          current = '';
          if (maxLines && lines.length >= maxLines) break;
        }
        // Break oversized single token if wider than cell
        if (ctx.measureText(word).width > maxWidth) {
          var part = '';
          for (var chIdx = 0; chIdx < word.length; chIdx++) {
            var nextPart = part + word.charAt(chIdx);
            if (ctx.measureText(nextPart).width > maxWidth && part) {
              lines.push(part);
              part = word.charAt(chIdx);
              if (maxLines && lines.length >= maxLines) {
                part = '';
                break;
              }
            } else {
              part = nextPart;
            }
          }
          current = part;
        } else {
          current = word;
        }
      }
    }

    if (current && (!maxLines || lines.length < maxLines)) {
      lines.push(current);
    }

    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
    }
    if (maxLines && lines.length === maxLines && i < words.length) {
      var last = lines[lines.length - 1];
      while (last.length > 2 && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + '…';
    }
    return lines.length ? lines : ['-'];
  }

  function drawSmartLine(ctx, text, x, y, maxWidth, defaultRtl, alignMode) {
    var core = root.RGCrmCore;
    var raw = String(text === undefined || text === null ? '' : text);
    var pureLtr = core && core.isPureLtrText ? core.isPureLtrText(raw) : false;
    var formatted = (!pureLtr && defaultRtl && core && core.formatBidiPdfText)
      ? core.formatBidiPdfText(raw)
      : raw;

    ctx.save();
    if (pureLtr) {
      ctx.direction = 'ltr';
      ctx.textAlign = alignMode || (defaultRtl ? 'right' : 'left');
    } else {
      ctx.direction = defaultRtl ? 'rtl' : 'ltr';
      ctx.textAlign = alignMode || (defaultRtl ? 'right' : 'left');
    }
    ctx.fillText(formatted, x, y, maxWidth > 0 ? maxWidth : undefined);
    ctx.restore();
  }

  async function exportArabicPdfDocument(options) {
    await ensureJsPdfLoaded();

    var core = root.RGCrmCore;
    var paperSize = options.paperSize || 'a4';
    var orientation = options.orientation || 'landscape';
    var isRtl = options.dir !== 'ltr';
    var title = options.title || 'تقرير RENTAL GATE CRM';
    var exporterName = options.exporterName || '';
    var summaryItems = Array.isArray(options.summaryItems) ? options.summaryItems : [];
    var columns = Array.isArray(options.columns) ? options.columns : [];
    var rows = Array.isArray(options.rows) ? options.rows : [];
    var extraSections = Array.isArray(options.extraSections) ? options.extraSections : [];
    var chartImages = Array.isArray(options.chartImages) ? options.chartImages : [];
    var lang = options.lang || (isRtl ? 'ar' : 'en');

    // Use PDF stream compression + balanced 1.5x raster scale + JPEG 0.80 for lightweight, crisp output
    var doc = new root.jspdf.jsPDF({ orientation: orientation, unit: 'mm', format: paperSize, compress: true });
    var pageWmm = doc.internal.pageSize.getWidth();
    var pageHmm = doc.internal.pageSize.getHeight();
    var scale = 1.5;
    var cw = Math.round(pageWmm * 3.78 * scale);
    var ch = Math.round(pageHmm * 3.78 * scale);
    var pad = Math.round(34 * scale);
    var footerReserve = Math.round(42 * scale);
    var fontStack = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';
    var logoImg = await loadLogoImage();

    var pages = [];
    function newPage() {
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.direction = isRtl ? 'rtl' : 'ltr';
      ctx.textBaseline = 'alphabetic';
      pages.push({ canvas: canvas, ctx: ctx, y: pad });
      return pages[pages.length - 1];
    }

    function drawHeader(p) {
      var ctx = p.ctx;
      var headerH = Math.round(76 * scale);
      ctx.fillStyle = '#313232';
      ctx.fillRect(0, 0, cw, headerH);
      ctx.fillStyle = '#d32228';
      ctx.fillRect(0, 0, cw, Math.round(5 * scale));

      var logoOffset = 0;
      if (logoImg) {
        var boxSz = Math.round(48 * scale);
        var lx = isRtl ? cw - pad - boxSz : pad;
        var ly = Math.round(16 * scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(lx - 2 * scale, ly - 2 * scale, boxSz + 4 * scale, boxSz + 4 * scale);
        ctx.drawImage(logoImg, lx, ly, boxSz, boxSz);
        logoOffset = boxSz + Math.round(16 * scale);
      }

      var textX = isRtl ? cw - pad - logoOffset : pad + logoOffset;
      var maxHeaderW = cw - pad * 2 - logoOffset;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(16 * scale) + 'px ' + fontStack;
      drawSmartLine(ctx, title, textX, Math.round(36 * scale), maxHeaderW, isRtl);

      ctx.fillStyle = '#d4d6d8';
      ctx.font = Math.round(10 * scale) + 'px ' + fontStack;
      var nowFormatted = (core && core.formatDisplayDateTime)
        ? core.formatDisplayDateTime(new Date().toISOString())
        : new Date().toISOString().substring(0, 16).replace('T', ' ');
      var metaText = (isRtl ? 'التاريخ: ' : 'Date: ') + nowFormatted + (exporterName ? (isRtl ? '  |  المصدر: ' : '  |  By: ') + exporterName : '');
      drawSmartLine(ctx, metaText, textX, Math.round(58 * scale), maxHeaderW, isRtl);

      p.y = headerH + Math.round(18 * scale);
    }

    function ensureSpace(p, neededHeight) {
      if (p.y + neededHeight > ch - footerReserve) {
        var next = newPage();
        drawHeader(next);
        return next;
      }
      return p;
    }

    var page = newPage();
    drawHeader(page);

    // 1. Summary Section: separate compact KPI cards from wide multi-line metadata cards so nothing overflows
    if (summaryItems.length > 0) {
      var kpiItems = [];
      var wideItems = [];
      summaryItems.forEach(function (it) {
        var valStr = String(it && it.value !== undefined && it.value !== null ? it.value : '-');
        if (valStr.length > 26 || String(it.label || '').length > 26) {
          wideItems.push({ label: String(it.label || ''), value: valStr });
        } else {
          kpiItems.push({ label: String(it.label || ''), value: valStr });
        }
      });

      if (kpiItems.length > 0) {
        var gap = Math.round(10 * scale);
        var perRow = Math.min(4, kpiItems.length);
        var rowCount = Math.ceil(kpiItems.length / perRow);
        var idx = 0;
        for (var r = 0; r < rowCount; r++) {
          var colsInRow = Math.min(perRow, kpiItems.length - idx);
          var cardH = Math.round(48 * scale);
          page = ensureSpace(page, cardH + Math.round(10 * scale));
          var cardW = (cw - pad * 2 - (colsInRow - 1) * gap) / colsInRow;
          for (var c = 0; c < colsInRow; c++) {
            var item = kpiItems[idx++];
            var bx = isRtl
              ? cw - pad - (c + 1) * cardW - c * gap
              : pad + c * (cardW + gap);
            page.ctx.save();
            page.ctx.fillStyle = '#f8fafc';
            page.ctx.strokeStyle = '#cbd5e1';
            page.ctx.lineWidth = Math.max(1, 1 * scale);
            page.ctx.fillRect(bx, page.y, cardW, cardH);
            page.ctx.strokeRect(bx, page.y, cardW, cardH);

            page.ctx.beginPath();
            page.ctx.rect(bx + 4 * scale, page.y + 2 * scale, cardW - 8 * scale, cardH - 4 * scale);
            page.ctx.clip();

            var anchorX = isRtl ? bx + cardW - Math.round(10 * scale) : bx + Math.round(10 * scale);
            var innerW = cardW - Math.round(20 * scale);
            page.ctx.fillStyle = '#475569';
            page.ctx.font = Math.round(9.5 * scale) + 'px ' + fontStack;
            drawSmartLine(page.ctx, item.label, anchorX, page.y + Math.round(17 * scale), innerW, isRtl);

            page.ctx.fillStyle = '#0f172a';
            page.ctx.font = 'bold ' + Math.round(12.5 * scale) + 'px ' + fontStack;
            drawSmartLine(page.ctx, item.value, anchorX, page.y + Math.round(37 * scale), innerW, isRtl);
            page.ctx.restore();
          }
          page.y += cardH + Math.round(10 * scale);
        }
      }

      if (wideItems.length > 0) {
        var wideGap = Math.round(10 * scale);
        var colsWide = cw > 900 * scale && wideItems.length > 1 ? 2 : 1;
        var wBoxW = (cw - pad * 2 - (colsWide - 1) * wideGap) / colsWide;
        for (var wi = 0; wi < wideItems.length; wi += colsWide) {
          var pair = wideItems.slice(wi, wi + colsWide);
          var lineH = Math.round(14 * scale);
          var prepared = pair.map(function (it) {
            page.ctx.font = Math.round(10 * scale) + 'px ' + fontStack;
            var valLines = wrapCanvasText(page.ctx, it.value, wBoxW - Math.round(22 * scale), 4);
            var h = Math.round(24 * scale) + valLines.length * lineH + Math.round(8 * scale);
            return { item: it, lines: valLines, h: h };
          });
          var rowCardH = Math.max.apply(null, prepared.map(function (p2) { return p2.h; }));
          page = ensureSpace(page, rowCardH + Math.round(8 * scale));

          prepared.forEach(function (prep, pcIdx) {
            var bx = isRtl
              ? cw - pad - (pcIdx + 1) * wBoxW - pcIdx * wideGap
              : pad + pcIdx * (wBoxW + wideGap);
            page.ctx.save();
            page.ctx.fillStyle = '#f8fafc';
            page.ctx.strokeStyle = '#cbd5e1';
            page.ctx.lineWidth = Math.max(1, 1 * scale);
            page.ctx.fillRect(bx, page.y, wBoxW, rowCardH);
            page.ctx.strokeRect(bx, page.y, wBoxW, rowCardH);

            page.ctx.beginPath();
            page.ctx.rect(bx + 4 * scale, page.y + 2 * scale, wBoxW - 8 * scale, rowCardH - 4 * scale);
            page.ctx.clip();

            var anchorX = isRtl ? bx + wBoxW - Math.round(10 * scale) : bx + Math.round(10 * scale);
            page.ctx.fillStyle = '#64748b';
            page.ctx.font = 'bold ' + Math.round(9 * scale) + 'px ' + fontStack;
            drawSmartLine(page.ctx, prep.item.label, anchorX, page.y + Math.round(15 * scale), wBoxW - Math.round(20 * scale), isRtl);

            page.ctx.fillStyle = '#0f172a';
            page.ctx.font = Math.round(10 * scale) + 'px ' + fontStack;
            prep.lines.forEach(function (ln, li) {
              drawSmartLine(page.ctx, ln, anchorX, page.y + Math.round(31 * scale) + li * lineH, wBoxW - Math.round(20 * scale), isRtl);
            });
            page.ctx.restore();
          });
          page.y += rowCardH + Math.round(8 * scale);
        }
        page.y += Math.round(4 * scale);
      }
    }

    // 2. Main Data Table with Proportional Column Widths, Text Wrapping & Cell Clipping
    if (columns.length > 0) {
      var tableW = cw - pad * 2;
      var colWidths = (core && core.computePdfColumnWidths)
        ? core.computePdfColumnWidths(columns, tableW)
        : columns.map(function () { return tableW / columns.length; });

      var colOffsets = [];
      var running = isRtl ? cw - pad : pad;
      for (var ci = 0; ci < columns.length; ci++) {
        var cwItem = colWidths[ci];
        if (isRtl) {
          running -= cwItem;
          colOffsets.push(running);
        } else {
          colOffsets.push(running);
          running += cwItem;
        }
      }

      var baseFontSize = columns.length >= 10 ? 8.2 : (columns.length >= 8 ? 8.8 : 9.5);
      var headerFont = 'bold ' + Math.round(baseFontSize * scale) + 'px ' + fontStack;
      var bodyFont = Math.round(baseFontSize * scale) + 'px ' + fontStack;
      var cellPadX = Math.round(6 * scale);
      var cellPadY = Math.round(6 * scale);
      var cellLineH = Math.round((baseFontSize + 3.6) * scale);

      // Measure header lines once
      page.ctx.font = headerFont;
      var headerWrapped = columns.map(function (col, idx) {
        var lbl = (lang === 'en' && col.labelEn) ? col.labelEn : col.label;
        return wrapCanvasText(page.ctx, lbl || col.key || '', Math.max(24, colWidths[idx] - cellPadX * 2), 2);
      });
      var maxHeaderLines = Math.max.apply(null, headerWrapped.map(function (l) { return l.length; }).concat([1]));
      var headerRowH = Math.max(Math.round(26 * scale), maxHeaderLines * cellLineH + cellPadY * 2);

      function drawTableHeader(p) {
        p.ctx.fillStyle = '#313232';
        p.ctx.fillRect(pad, p.y, tableW, headerRowH);
        p.ctx.strokeStyle = '#1e293b';
        p.ctx.lineWidth = Math.max(1, 0.8 * scale);
        p.ctx.strokeRect(pad, p.y, tableW, headerRowH);

        p.ctx.fillStyle = '#ffffff';
        p.ctx.font = headerFont;
        columns.forEach(function (col, cIdx) {
          var cellX = colOffsets[cIdx];
          var cellW = colWidths[cIdx];
          p.ctx.save();
          p.ctx.beginPath();
          p.ctx.rect(cellX + 1, p.y + 1, Math.max(1, cellW - 2), headerRowH - 2);
          p.ctx.clip();

          var lines = headerWrapped[cIdx];
          var anchorX = isRtl ? cellX + cellW - cellPadX : cellX + cellPadX;
          lines.forEach(function (ln, li) {
            var ly = p.y + cellPadY + Math.round(baseFontSize * scale) + li * cellLineH;
            drawSmartLine(p.ctx, ln, anchorX, ly, cellW - cellPadX * 2, isRtl);
          });
          p.ctx.restore();

          if (cIdx > 0) {
            p.ctx.beginPath();
            p.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            p.ctx.moveTo(isRtl ? cellX + cellW : cellX, p.y);
            p.ctx.lineTo(isRtl ? cellX + cellW : cellX, p.y + headerRowH);
            p.ctx.stroke();
          }
        });
        p.y += headerRowH;
      }

      if (rows.length === 0) {
        page = ensureSpace(page, headerRowH + Math.round(32 * scale));
        drawTableHeader(page);
        page.ctx.fillStyle = '#f8fafc';
        page.ctx.fillRect(pad, page.y, tableW, Math.round(28 * scale));
        page.ctx.strokeStyle = '#cbd5e1';
        page.ctx.strokeRect(pad, page.y, tableW, Math.round(28 * scale));
        page.ctx.fillStyle = '#64748b';
        page.ctx.font = bodyFont;
        page.ctx.textAlign = 'center';
        page.ctx.fillText(isRtl ? 'لا توجد سجلات مطابقة لمعايير التقرير.' : 'No matching records found.', cw / 2, page.y + Math.round(18 * scale));
        page.y += Math.round(36 * scale);
      } else {
        page = ensureSpace(page, headerRowH + Math.round(28 * scale));
        drawTableHeader(page);

        rows.forEach(function (row, ri) {
          page.ctx.font = bodyFont;
          var cellLines = columns.map(function (col, cIdx) {
            var formatted = (core && core.formatReportCellValue)
              ? core.formatReportCellValue(col, row, lang)
              : (function () {
                  var v = typeof col.value === 'function' ? col.value(row) : row[col.key];
                  if (Array.isArray(v)) return v.join('، ') || '-';
                  return v !== undefined && v !== null && v !== '' ? String(v) : '-';
                })();
            return wrapCanvasText(page.ctx, formatted, Math.max(24, colWidths[cIdx] - cellPadX * 2), 3);
          });
          var maxLines = Math.max.apply(null, cellLines.map(function (l) { return l.length; }).concat([1]));
          var rowH = Math.max(Math.round(22 * scale), maxLines * cellLineH + cellPadY * 2);

          if (page.y + rowH > ch - footerReserve) {
            page = newPage();
            drawHeader(page);
            drawTableHeader(page);
          }

          page.ctx.fillStyle = ri % 2 === 0 ? '#ffffff' : '#f8fafc';
          page.ctx.fillRect(pad, page.y, tableW, rowH);
          page.ctx.strokeStyle = '#cbd5e1';
          page.ctx.lineWidth = Math.max(0.75, 0.75 * scale);
          page.ctx.strokeRect(pad, page.y, tableW, rowH);

          page.ctx.fillStyle = '#0f172a';
          page.ctx.font = bodyFont;

          columns.forEach(function (col, cIdx) {
            var cellX = colOffsets[cIdx];
            var cellW = colWidths[cIdx];

            // Vertical cell separator
            if (cIdx > 0) {
              page.ctx.beginPath();
              page.ctx.strokeStyle = '#e2e8f0';
              page.ctx.moveTo(isRtl ? cellX + cellW : cellX, page.y);
              page.ctx.lineTo(isRtl ? cellX + cellW : cellX, page.y + rowH);
              page.ctx.stroke();
            }

            page.ctx.save();
            page.ctx.beginPath();
            page.ctx.rect(cellX + 1, page.y + 1, Math.max(1, cellW - 2), rowH - 2);
            page.ctx.clip();

            var lines = cellLines[cIdx];
            var anchorX = isRtl ? cellX + cellW - cellPadX : cellX + cellPadX;
            lines.forEach(function (ln, li) {
              var ly = page.y + cellPadY + Math.round(baseFontSize * scale) + li * cellLineH;
              drawSmartLine(page.ctx, ln, anchorX, ly, cellW - cellPadX * 2, isRtl);
            });
            page.ctx.restore();
          });

          page.y += rowH;
        });
        page.y += Math.round(14 * scale);
      }
    }

    // 3. Extra Sections (Notes, FollowUps, Extensions, Problems) with word wrapping
    extraSections.forEach(function (sec) {
      var secLines = Array.isArray(sec.lines) ? sec.lines : [];
      if (!secLines.length) return;
      page = ensureSpace(page, Math.round(44 * scale));

      page.ctx.fillStyle = '#d32228';
      page.ctx.font = 'bold ' + Math.round(12 * scale) + 'px ' + fontStack;
      drawSmartLine(page.ctx, sec.title || '', isRtl ? cw - pad : pad, page.y + Math.round(14 * scale), cw - pad * 2, isRtl);
      page.y += Math.round(22 * scale);

      var secLineH = Math.round(15 * scale);
      var maxLineW = cw - pad * 2 - Math.round(22 * scale);
      secLines.forEach(function (rawLine) {
        page.ctx.font = Math.round(9.8 * scale) + 'px ' + fontStack;
        var wrapped = wrapCanvasText(page.ctx, '• ' + String(rawLine), maxLineW, 4);
        var blockH = wrapped.length * secLineH + Math.round(6 * scale);
        page = ensureSpace(page, blockH);

        page.ctx.fillStyle = '#f8fafc';
        page.ctx.fillRect(pad, page.y - Math.round(2 * scale), cw - pad * 2, blockH - Math.round(2 * scale));
        page.ctx.fillStyle = '#d32228';
        page.ctx.fillRect(isRtl ? cw - pad - Math.round(3 * scale) : pad, page.y - Math.round(2 * scale), Math.round(3 * scale), blockH - Math.round(2 * scale));

        page.ctx.fillStyle = '#1e293b';
        wrapped.forEach(function (ln, li) {
          var anchorX = isRtl ? cw - pad - Math.round(13 * scale) : pad + Math.round(13 * scale);
          drawSmartLine(page.ctx, ln, anchorX, page.y + Math.round(11 * scale) + li * secLineH, maxLineW, isRtl);
        });
        page.y += blockH;
      });
      page.y += Math.round(10 * scale);
    });

    // 4. Charts Grid (2 columns when available, crisp white card container)
    var validCharts = chartImages.filter(function (c) { return c && c.dataUrl; });
    if (validCharts.length > 0) {
      var loadedCharts = await Promise.all(validCharts.map(function (chImg) {
        return new Promise(function (res) {
          var im = new Image();
          im.onload = function () { res({ title: chImg.title || '', img: im }); };
          im.onerror = function () { res(null); };
          im.src = chImg.dataUrl;
        });
      }));
      var readyCharts = loadedCharts.filter(Boolean);
      var chartGap = Math.round(12 * scale);
      var colsCharts = readyCharts.length > 1 ? 2 : 1;
      var slotW = (cw - pad * 2 - (colsCharts - 1) * chartGap) / colsCharts;
      var cardChartH = Math.round(168 * scale);

      for (var chIdx = 0; chIdx < readyCharts.length; chIdx += colsCharts) {
        page = ensureSpace(page, cardChartH + Math.round(12 * scale));
        var pairCharts = readyCharts.slice(chIdx, chIdx + colsCharts);
        pairCharts.forEach(function (item, idxInPair) {
          var bx = isRtl
            ? cw - pad - (idxInPair + 1) * slotW - idxInPair * chartGap
            : pad + idxInPair * (slotW + chartGap);
          page.ctx.fillStyle = '#ffffff';
          page.ctx.strokeStyle = '#cbd5e1';
          page.ctx.lineWidth = Math.max(1, 1 * scale);
          page.ctx.fillRect(bx, page.y, slotW, cardChartH);
          page.ctx.strokeRect(bx, page.y, slotW, cardChartH);

          page.ctx.fillStyle = '#313232';
          page.ctx.font = 'bold ' + Math.round(10.5 * scale) + 'px ' + fontStack;
          drawSmartLine(page.ctx, item.title, isRtl ? bx + slotW - Math.round(10 * scale) : bx + Math.round(10 * scale), page.y + Math.round(18 * scale), slotW - Math.round(20 * scale), isRtl);

          var availW = slotW - Math.round(20 * scale);
          var availH = cardChartH - Math.round(32 * scale);
          var ratio = item.img.width / Math.max(1, item.img.height);
          var drawW = availW;
          var drawH = drawW / ratio;
          if (drawH > availH) {
            drawH = availH;
            drawW = drawH * ratio;
          }
          var drawX = bx + (slotW - drawW) / 2;
          var drawY = page.y + Math.round(26 * scale) + (availH - drawH) / 2;
          page.ctx.drawImage(item.img, drawX, drawY, drawW, drawH);
        });
        page.y += cardChartH + Math.round(12 * scale);
      }
    }

    // 5. Footers + Lightweight JPEG Compression
    var totalPages = pages.length;
    pages.forEach(function (p, idx) {
      p.ctx.strokeStyle = '#e2e8f0';
      p.ctx.lineWidth = Math.max(1, 1 * scale);
      p.ctx.beginPath();
      p.ctx.moveTo(pad, ch - Math.round(32 * scale));
      p.ctx.lineTo(cw - pad, ch - Math.round(32 * scale));
      p.ctx.stroke();

      p.ctx.fillStyle = '#64748b';
      p.ctx.font = Math.round(9.5 * scale) + 'px ' + fontStack;
      p.ctx.textAlign = 'center';
      p.ctx.fillText('RENTAL GATE CRM — صفحة ' + (idx + 1) + ' من ' + totalPages, cw / 2, ch - Math.round(14 * scale));

      if (idx > 0) doc.addPage(paperSize, orientation);
      var jpegData = p.canvas.toDataURL('image/jpeg', 0.80);
      doc.addImage(jpegData, 'JPEG', 0, 0, pageWmm, pageHmm, undefined, 'FAST');
    });

    var pdfFilename = options.filename || 'rental-gate-report.pdf';
    var pdfBlob = doc.output('blob');
    if (options.returnStatsOnly) {
      return { filename: pdfFilename, pages: totalPages, sizeBytes: pdfBlob.size };
    }
    doc.save(pdfFilename);
    return { filename: pdfFilename, pages: totalPages, sizeBytes: pdfBlob.size };
  }

  var REPORT_TYPES = [
    { id: 'all_reservations', labelAr: 'جميع الحجوزات', labelEn: 'All Reservations' },
    { id: 'by_status', labelAr: 'الحجوزات حسب الحالة', labelEn: 'Reservations by Status' },
    { id: 'employee_performance', labelAr: 'أداء الموظفين', labelEn: 'Employee Performance' },
    { id: 'followups_log', labelAr: 'سجل المتابعات', labelEn: 'Follow-Ups Log' },
    { id: 'problems', labelAr: 'المشكلات', labelEn: 'Problems' },
    { id: 'priorities', labelAr: 'الأولويات', labelEn: 'Priorities' },
    { id: 'unfollowed', labelAr: 'الحجوزات غير المتابعة', labelEn: 'Unfollowed Reservations' },
    { id: 'extensions', labelAr: 'التمديدات', labelEn: 'Extensions' }
  ];

  var RESERVATION_COLUMNS = (root.RGCrmCore && root.RGCrmCore.REPORT_COLUMNS_BY_TYPE && root.RGCrmCore.REPORT_COLUMNS_BY_TYPE.all_reservations)
    ? root.RGCrmCore.REPORT_COLUMNS_BY_TYPE.all_reservations
    : [
        { key: 'reservationNumber', label: 'رقم الحجز' },
        { key: 'customerName', label: 'اسم العميل' },
        { key: 'customerPhone', label: 'الجوال' },
        { key: 'companyName', label: 'الشركة' },
        { key: 'branchName', label: 'الفرع' },
        { key: 'carName', label: 'السيارة' },
        { key: 'startDate', label: 'بداية الحجز' },
        { key: 'endDate', label: 'نهاية الحجز' },
        { key: 'originalStatusAr', label: 'حالة الحجز الأصلية' },
        { key: 'internalStatus', label: 'حالة المتابعة الداخلية' },
        { key: 'assignedEmployeeNames', label: 'الموظفون المسؤولون' },
        { key: 'priority', label: 'الأولوية' },
        { key: 'totalAmount', label: 'الإجمالي' },
        { key: 'lastUpdateText', label: 'آخر تحديث' },
        { key: 'lastUpdatedByName', label: 'آخر موظف' }
      ];

  function getReportLabel(reportType, lang) {
    var found = REPORT_TYPES.find(function (rt) { return rt.id === reportType; });
    if (!found) return reportType;
    return lang === 'en' ? found.labelEn : found.labelAr;
  }

  async function render(container, ctx) {
    var t = ctx.t;
    var state = ctx.state.reports || { reportType: 'all_reservations', rows: [] };
    ctx.state.reports = state;

    var empRes = await root.RGApi.callApi('getEmployees', {});
    var employees = (empRes.success && empRes.data.items) || [];
    var facets = { companies: [], branches: [] };

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_reports') + '</h2><p class="section-subtitle">' + t('reports_subtitle') + '</p></div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            '<button type="button" class="btn btn-primary" id="btn-open-export-modal">' + t('export_settings_btn') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="segmented-control" id="report-type-tabs" style="margin-bottom:16px;">' +
          REPORT_TYPES.map(function (rt) {
            var active = state.reportType === rt.id ? ' active' : '';
            var lbl = ctx.lang === 'en' ? rt.labelEn : rt.labelAr;
            return '<button type="button" class="segmented-btn' + active + '" data-rtype="' + rt.id + '">' + lbl + '</button>';
          }).join('') +
        '</div>' +
        '<div class="filter-grid">' +
          '<input type="date" class="input" id="rep-from" aria-label="' + t('from_date') + '">' +
          '<input type="date" class="input" id="rep-to" aria-label="' + t('to_date') + '">' +
          '<select class="select" id="rep-emp" aria-label="' + t('employee') + '"><option value="">' + t('all_employees') + '</option>' +
            employees.map(function (e) { return '<option value="' + e.id + '">' + e.name + '</option>'; }).join('') +
          '</select>' +
          '<select class="select" id="rep-company" aria-label="' + t('company') + '"><option value="">' + t('all_companies') + '</option></select>' +
          '<select class="select" id="rep-branch" aria-label="' + t('branch') + '"><option value="">' + t('all_branches') + '</option></select>' +
          '<button type="button" class="btn btn-accent" id="rep-run-btn">' + t('generate_report') + '</button>' +
        '</div>' +
        '<div id="report-charts-wrap" class="charts-grid" style="margin-bottom:16px;">' +
          '<div class="chart-card"><h3 class="chart-card-title">توزيع بيانات التقرير</h3><div class="chart-canvas-wrap" style="height:220px;"><canvas id="report-chart-primary"></canvas></div></div>' +
          '<div class="chart-card"><h3 class="chart-card-title">التوزيع حسب الشركة / الأولوية</h3><div class="chart-canvas-wrap" style="height:220px;"><canvas id="report-chart-secondary"></canvas></div></div>' +
        '</div>' +
        '<div id="report-preview-wrap"></div>' +
      '</div>';

    function populateFacetSelects(nextFacets) {
      if (!nextFacets) return;
      facets = nextFacets;
      var compEl = document.getElementById('rep-company');
      var brEl = document.getElementById('rep-branch');
      if (compEl && compEl.options.length <= 1 && Array.isArray(facets.companies)) {
        var prevC = compEl.value;
        compEl.innerHTML = '<option value="">' + t('all_companies') + '</option>' +
          facets.companies.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
        compEl.value = prevC;
      }
      if (brEl && brEl.options.length <= 1 && Array.isArray(facets.branches)) {
        var prevB = brEl.value;
        brEl.innerHTML = '<option value="">' + t('all_branches') + '</option>' +
          facets.branches.map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
        brEl.value = prevB;
      }
    }

    var previewSeq = 0;

    async function loadPreview(logExport) {
      var seq = ++previewSeq;
      var params = {
        reportType: state.reportType,
        dateFrom: document.getElementById('rep-from').value,
        dateTo: document.getElementById('rep-to').value,
        employeeId: document.getElementById('rep-emp').value,
        company: document.getElementById('rep-company').value,
        branch: document.getElementById('rep-branch').value,
        logExport: Boolean(logExport)
      };
      var r = await root.RGApi.callApi('getReports', params);
      if (seq !== previewSeq) return;
      var wrap = document.getElementById('report-preview-wrap');
      if (!wrap) return;
      if (!r.success) {
        wrap.innerHTML = '<div class="form-error">' + r.message + '</div>';
        return;
      }
      if (r.data && r.data.facets) {
        populateFacetSelects(r.data.facets);
      }
      state.rows = r.data.rows || [];
      if (state.rows.length === 0) {
        wrap.innerHTML = '<div class="empty-state">لا توجد بيانات مطابقة لمعايير التقرير المحددة.</div>';
        renderReportCharts(state.reportType, []);
        return;
      }

      var core = root.RGCrmCore;
      var cols = (core && core.getReportColumns)
        ? core.getReportColumns(state.reportType, state.rows).slice(0, 10)
        : RESERVATION_COLUMNS.slice(0, 10);

      renderReportCharts(state.reportType, state.rows);

      wrap.innerHTML =
        '<div class="meta-inline" style="margin-bottom:10px;"><span>عدد السجلات: <strong class="tabular-nums">' + state.rows.length + '</strong></span></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          cols.map(function (c) {
            var lbl = (ctx.lang === 'en' && c.labelEn) ? c.labelEn : c.label;
            return '<th>' + lbl + '</th>';
          }).join('') +
        '</tr></thead><tbody>' +
          state.rows.slice(0, 50).map(function (row) {
            return '<tr>' + cols.map(function (c) {
              var formatted = (core && core.formatReportCellValue)
                ? core.formatReportCellValue(c, row, ctx.lang)
                : String(row[c.key] !== undefined && row[c.key] !== null ? row[c.key] : '-');
              var isMono = c.formatType === 'date' || c.formatType === 'datetime' || c.formatType === 'ltr';
              var cls = isMono ? 'mono tabular-nums' : 'tabular-nums';
              var st = (c.formatType === 'date' || c.formatType === 'datetime') ? ' style="white-space:nowrap;"' : '';
              return '<td class="' + cls + '"' + st + '>' + formatted + '</td>';
            }).join('') + '</tr>';
          }).join('') +
        '</tbody></table></div>';
    }

    var reportChartInstances = [];
    function renderReportCharts(reportType, rows) {
      if (!root.Chart) return;
      reportChartInstances.forEach(function (ch) { ch.destroy(); });
      reportChartInstances = [];

      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var txt = isDark ? '#cfd1d3' : '#313232';
      var primaryCounts = {};
      var secondaryCounts = {};

      rows.forEach(function (r) {
        var k1 = r.internalStatus || r.status || r.employeeName || r.statusAr || 'غير محدد';
        primaryCounts[k1] = (primaryCounts[k1] || 0) + (reportType === 'employee_performance' ? Number(r.followUpsCount || 0) : 1);

        var k2 = r.companyName || r.priority || r.role || r.paymentStatus || 'أخرى';
        secondaryCounts[k2] = (secondaryCounts[k2] || 0) + (reportType === 'employee_performance' ? Number(r.assignedReservations || 0) : 1);
      });

      var c1 = document.getElementById('report-chart-primary');
      var c2 = document.getElementById('report-chart-secondary');
      if (c1) {
        reportChartInstances.push(new root.Chart(c1.getContext('2d'), {
          type: 'bar',
          data: {
            labels: Object.keys(primaryCounts),
            datasets: [{ label: 'العدد', data: Object.values(primaryCounts), backgroundColor: '#d32228', borderRadius: 6 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: txt }, grid: { display: false } },
              y: { ticks: { color: txt, precision: 0 }, beginAtZero: true }
            }
          }
        }));
      }
      if (c2) {
        reportChartInstances.push(new root.Chart(c2.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: Object.keys(secondaryCounts),
            datasets: [{ data: Object.values(secondaryCounts), backgroundColor: ['#d32228', '#313232', '#157347', '#d97706', '#2563eb', '#6b7280'] }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { labels: { color: txt, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } } } }
          }
        }));
      }
    }

    container.querySelectorAll('[data-rtype]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.reportType = btn.getAttribute('data-rtype');
        container.querySelectorAll('[data-rtype]').forEach(function (el) {
          el.classList.toggle('active', el === btn);
        });
        loadPreview(false);
      });
    });

    var repRunBtn = document.getElementById('rep-run-btn');
    repRunBtn.addEventListener('click', function () {
      if (ctx.withActionLock) {
        ctx.withActionLock(repRunBtn, 'reports:run', function () {
          return loadPreview(false);
        });
      } else {
        loadPreview(false);
      }
    });

    document.getElementById('btn-open-export-modal').addEventListener('click', function () {
      openExportConfigModal(ctx, state, employees, facets);
    });

    await loadPreview(false);
  }

  function openExportConfigModal(ctx, state, employees, facets) {
    var modalRoot = document.getElementById('modal-root');
    var core = root.RGCrmCore;
    var activeCols = (core && core.getReportColumns)
      ? core.getReportColumns(state.reportType, state.rows)
      : RESERVATION_COLUMNS;
    var defaultSelectedKeys = activeCols.slice(0, Math.min(10, activeCols.length)).map(function (c) { return c.key; });

    var curEmpFilter = document.getElementById('rep-emp') ? document.getElementById('rep-emp').value : '';
    var curFromFilter = document.getElementById('rep-from') ? document.getElementById('rep-from').value : '';
    var curToFilter = document.getElementById('rep-to') ? document.getElementById('rep-to').value : '';
    var curCompFilter = document.getElementById('rep-company') ? document.getElementById('rep-company').value : '';
    var curBranchFilter = document.getElementById('rep-branch') ? document.getElementById('rep-branch').value : '';
    var reportTitleAr = getReportLabel(state.reportType, ctx.lang);

    var sheetCountOptions = '';
    for (var sNum = 1; sNum <= 10; sNum++) {
      var sLabel = sNum === 1
        ? '1 ورقة (أقصى ضغط - دمج كامل)'
        : (sNum === 2 ? '2 ورقتان' : (sNum + ' ورقات' + (sNum === 10 ? ' (الحد الأقصى للضغط)' : '')));
      sheetCountOptions += '<option value="' + sNum + '"' + (sNum === 1 ? ' selected' : '') + '>' + sLabel + '</option>';
    }

    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">' +
        '<div class="modal-panel">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="export-modal-title">إعدادات التقرير والتصدير — ' + reportTitleAr + '</h3>' +
            '<button type="button" class="btn btn-sm" id="exp-close">إغلاق</button>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label" for="exp-title">عنوان التقرير</label><input class="input" id="exp-title" value="تقرير ' + reportTitleAr + ' — Rental Gate"></div>' +
            '<div class="form-group"><label class="form-label" for="exp-paper">حجم الورق</label><select class="select" id="exp-paper"><option value="a4">A4</option><option value="letter">Letter</option></select></div>' +
            '<div class="form-group"><label class="form-label" for="exp-orient">اتجاه الصفحة</label><select class="select" id="exp-orient"><option value="landscape">أفقي (Landscape)</option><option value="portrait">عمودي (Portrait)</option></select></div>' +
            '<div class="form-group"><label class="form-label" for="exp-status">الحالة</label><select class="select" id="exp-status"><option value="">الكل</option>' +
              (root.RGCrmCore.WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="form-group"><label class="form-label" for="exp-prio">الأولوية</label><select class="select" id="exp-prio"><option value="">الكل</option>' +
              root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="form-group"><label class="form-label" for="exp-emp">الموظف</label><select class="select" id="exp-emp"><option value="">الكل</option>' +
              employees.map(function (e) { return '<option value="' + e.id + '"' + (curEmpFilter === e.id ? ' selected' : '') + '>' + e.name + '</option>'; }).join('') +
            '</select></div>' +
          '</div>' +
          '<div class="form-group"><span class="form-label">الأعمدة المطلوبة (' + reportTitleAr + ')</span><div class="checkbox-grid">' +
            activeCols.map(function (col) {
              var checked = defaultSelectedKeys.indexOf(col.key) !== -1 ? 'checked' : '';
              var lbl = (ctx.lang === 'en' && col.labelEn) ? col.labelEn : col.label;
              return '<label class="checkbox-item"><input type="checkbox" class="exp-col-chk" value="' + col.key + '" ' + checked + '> ' + lbl + '</label>';
            }).join('') +
          '</div></div>' +
          '<div class="checkbox-grid">' +
            '<label class="checkbox-item"><input type="checkbox" id="exp-inc-notes" checked> تضمين الملاحظات</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="exp-inc-fu" checked> تضمين سجل المتابعات</label>' +
            '<label class="checkbox-item"><input type="checkbox" id="exp-inc-charts" checked> تضمين الرسوم البيانية</label>' +
          '</div>' +
          '<div class="surface-card" style="padding:12px;margin-top:4px;background:var(--bg-subtle, #f8fafc);border:1px solid var(--border-color, #e2e8f0);">' +
            '<label class="checkbox-item" style="font-weight:700;">' +
              '<input type="checkbox" id="exp-excel-compress"> تفعيل ضغط بيانات Excel وتوزيعها في أوراق محددة (اختياري)' +
            '</label>' +
            '<div id="exp-excel-compress-opts" class="hidden" style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
              '<label class="form-label" for="exp-excel-sheets" style="margin:0;">الحد الأقصى للأوراق (من 1 إلى 10 ورقات):</label>' +
              '<select class="select" id="exp-excel-sheets" style="max-width:260px;">' + sheetCountOptions + '</select>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="exp-excel-btn">تصدير Excel (.xlsx)</button>' +
            '<button type="button" class="btn btn-primary" id="exp-pdf-btn">تصدير PDF (خفيف RTL)</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var compressChk = document.getElementById('exp-excel-compress');
    var compressOptsEl = document.getElementById('exp-excel-compress-opts');
    if (compressChk && compressOptsEl) {
      compressOptsEl.style.display = 'none';
      compressChk.addEventListener('change', function () {
        compressOptsEl.classList.toggle('hidden', !compressChk.checked);
        compressOptsEl.style.display = compressChk.checked ? 'flex' : 'none';
      });
    }

    document.getElementById('exp-close').addEventListener('click', function () { modalRoot.innerHTML = ''; });

    async function collectExportRows() {
      var res = await root.RGApi.callApi('getReports', {
        reportType: state.reportType,
        dateFrom: curFromFilter,
        dateTo: curToFilter,
        company: curCompFilter,
        branch: curBranchFilter,
        status: document.getElementById('exp-status').value,
        priority: document.getElementById('exp-prio').value,
        employeeId: document.getElementById('exp-emp').value,
        logExport: true
      });
      return (res.success && res.data.rows) || state.rows || [];
    }

    function getSelectedHeaders(rows, includeNotes) {
      var chosenKeys = Array.from(modalRoot.querySelectorAll('.exp-col-chk:checked')).map(function (el) { return el.value; });
      var schemaCols = (core && core.getReportColumns)
        ? core.getReportColumns(state.reportType, rows)
        : RESERVATION_COLUMNS;
      var filtered = schemaCols.filter(function (c) {
        if (!includeNotes && (c.key === 'notes' || c.key === 'lastUpdateText')) return false;
        return chosenKeys.length ? chosenKeys.indexOf(c.key) !== -1 : true;
      });
      return filtered.length ? filtered : schemaCols.slice(0, 6);
    }

    var expExcelBtn = document.getElementById('exp-excel-btn');
    expExcelBtn.addEventListener('click', function () {
      var runExcel = async function () {
        try {
          var incNotes = document.getElementById('exp-inc-notes').checked;
          var incFu = document.getElementById('exp-inc-fu').checked;
          var compressEnabled = Boolean(document.getElementById('exp-excel-compress').checked);
          var targetSheets = Number(document.getElementById('exp-excel-sheets').value || 1);

          var rows = await collectExportRows();
          var headers = getSelectedHeaders(rows, incNotes);
          var sheets = [{ name: reportTitleAr, headers: headers, rows: rows }];
          if (incFu && state.reportType !== 'followups_log') {
            var fuRes = await root.RGApi.callApi('getTeamFollowUps', {});
            if (fuRes.success && fuRes.data.items.length) {
              var fuHeaders = (core && core.getReportColumns)
                ? core.getReportColumns('followups_log', fuRes.data.items).filter(function (c) {
                    return incNotes || c.key !== 'notes';
                  })
                : [
                    { key: 'reservationNumber', label: 'رقم الحجز' },
                    { key: 'employeeName', label: 'الموظف' },
                    { key: 'status', label: 'الحالة' },
                    { key: 'action', label: 'الإجراء' },
                    { key: 'followUpDate', label: 'التاريخ' },
                    { key: 'followUpTime', label: 'الوقت' }
                  ];
              sheets.push({
                name: 'سجل المتابعات',
                headers: fuHeaders,
                rows: fuRes.data.items
              });
            }
          }
          var resMeta = await exportExcelWorkbook(sheets, 'rental-gate-' + state.reportType + '.xlsx', {
            compressEnabled: compressEnabled,
            targetSheets: targetSheets
          });
          ctx.toast(compressEnabled
            ? ('تم تصدير Excel مضغوط في ' + resMeta.sheetCount + ' ورقات بنجاح.')
            : 'تم تصدير ملف Excel بنجاح.');
          modalRoot.innerHTML = '';
        } catch (err) {
          ctx.toast((err && err.message) || 'تعذر تصدير ملف Excel.', true);
        }
      };
      if (ctx.withActionLock) {
        ctx.withActionLock(expExcelBtn, 'reports:exportExcel', runExcel);
      } else {
        expExcelBtn.disabled = true;
        runExcel().finally(function () { expExcelBtn.disabled = false; });
      }
    });

    var expPdfBtn = document.getElementById('exp-pdf-btn');
    expPdfBtn.addEventListener('click', function () {
      var runPdf = async function () {
        try {
          var incNotes = document.getElementById('exp-inc-notes').checked;
          var incFu = document.getElementById('exp-inc-fu').checked;
          var incCharts = document.getElementById('exp-inc-charts').checked;
          var orient = document.getElementById('exp-orient').value;
          var maxCols = orient === 'portrait' ? 7 : 9;

          var rows = await collectExportRows();
          var headers = getSelectedHeaders(rows, incNotes).slice(0, maxCols);
          var user = root.RGAuth.getUser();

          var chartImages = [];
          if (incCharts) {
            var img1 = captureChartForPdf(document.getElementById('report-chart-primary'), 'توزيع بيانات التقرير');
            var img2 = captureChartForPdf(document.getElementById('report-chart-secondary'), 'التوزيع حسب الشركة / الأولوية');
            if (img1) chartImages.push(img1);
            if (img2) chartImages.push(img2);
          }

          var extraSections = [];
          if (incFu && state.reportType !== 'followups_log') {
            var fuRes = await root.RGApi.callApi('getTeamFollowUps', {
              employeeId: document.getElementById('exp-emp').value
            });
            if (fuRes.success && Array.isArray(fuRes.data.items) && fuRes.data.items.length) {
              extraSections.push({
                title: 'أحدث المتابعات المسجلة (' + Math.min(25, fuRes.data.items.length) + ' من ' + fuRes.data.items.length + ')',
                lines: fuRes.data.items.slice(0, 25).map(function (f) {
                  var d = (core && core.formatDisplayDate) ? core.formatDisplayDate(f.followUpDate) : f.followUpDate;
                  return d + ' | ' + f.reservationNumber + ' | ' + f.employeeName + ' [' + f.status + ']: ' + f.action + (incNotes && f.notes ? ' — ' + f.notes : '');
                })
              });
            }
          }

          var pdfMeta = await exportArabicPdfDocument({
            title: document.getElementById('exp-title').value || ('تقرير ' + reportTitleAr),
            paperSize: document.getElementById('exp-paper').value,
            orientation: orient,
            lang: ctx.lang,
            exporterName: user ? user.name : '',
            summaryItems: [
              { label: 'نوع التقرير', value: reportTitleAr },
              { label: 'عدد السجلات', value: rows.length }
            ],
            columns: headers,
            rows: rows,
            extraSections: extraSections,
            chartImages: chartImages,
            filename: 'rental-gate-' + state.reportType + '.pdf'
          });
          var kb = Math.max(1, Math.round((pdfMeta.sizeBytes || 0) / 1024));
          ctx.toast('تم تصدير PDF خفيف ومرتب (' + pdfMeta.pages + ' صفحة · ' + kb + ' KB).');
          modalRoot.innerHTML = '';
        } catch (err) {
          ctx.toast((err && err.message) || 'تعذر تصدير ملف PDF.', true);
        }
      };
      if (ctx.withActionLock) {
        ctx.withActionLock(expPdfBtn, 'reports:exportPdf', runPdf);
      } else {
        expPdfBtn.disabled = true;
        runPdf().finally(function () { expPdfBtn.disabled = false; });
      }
    });
  }

  root.RGReports = {
    render: render,
    exportExcelWorkbook: exportExcelWorkbook,
    exportArabicPdfDocument: exportArabicPdfDocument,
    captureChartForPdf: captureChartForPdf,
    RESERVATION_COLUMNS: RESERVATION_COLUMNS
  };
})(window);
