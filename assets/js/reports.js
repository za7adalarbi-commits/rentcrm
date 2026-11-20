/**
 * RENTAL GATE CRM — Advanced Reports, Compressed Excel (SheetJS) & Lightweight Arabic RTL PDF (jsPDF + Canvas)
 */
(function (root) {
  'use strict';

  var cachedLogoImagePromise = null;
  var cachedDownsampledLogos = {};

  function loadRawLogoImage() {
    if (cachedLogoImagePromise) return cachedLogoImagePromise;
    cachedLogoImagePromise = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = (root.RGCrmCore && root.RGCrmCore.resolveAssetUrl)
        ? root.RGCrmCore.resolveAssetUrl('assets/images/logo.png', root.__RG_BASE_URL__)
        : './assets/images/logo.png';
    });
    return cachedLogoImagePromise;
  }

  async function loadLogoImage(targetPx) {
    var img = await loadRawLogoImage();
    if (!img) return null;
    var size = Math.max(48, Math.min(256, Math.round(Number(targetPx || 96))));
    if (cachedDownsampledLogos[size]) return cachedDownsampledLogos[size];
    try {
      var c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      cachedDownsampledLogos[size] = c;
      return c;
    } catch (_e) {
      return img;
    }
  }

  function yieldMainThread() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      var err = new Error('PDF generation cancelled');
      err.name = 'AbortError';
      throw err;
    }
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

  async function readExcelWorkbookRows(file) {
    if (!file) throw new Error('لم يتم اختيار ملف Excel.');
    await ensureXlsxLoaded();
    var buf = await file.arrayBuffer();
    var wb = root.XLSX.read(buf, { type: 'array', cellDates: false });
    var firstSheet = wb && Array.isArray(wb.SheetNames) && wb.SheetNames.length ? wb.SheetNames[0] : '';
    if (!firstSheet || !wb.Sheets || !wb.Sheets[firstSheet]) {
      throw new Error('ملف Excel لا يحتوي على أي أوراق عمل صالحة.');
    }
    var rows = root.XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { defval: '', raw: true });
    return {
      sheetName: firstSheet,
      sheetNames: wb.SheetNames.slice(),
      rows: Array.isArray(rows) ? rows : []
    };
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

  function captureChartForPdf(canvasEl, title, opts) {
    if (!canvasEl) return null;
    var capOpts = opts || {};
    var quality = Math.max(0.45, Math.min(0.95, Number(capOpts.quality || 0.85)));
    var maxW = Math.max(360, Number(capOpts.maxWidth || 960));
    var chartInst = (root.Chart && typeof root.Chart.getChart === 'function')
      ? root.Chart.getChart(canvasEl)
      : null;

    var restoredState = [];
    if (chartInst && chartInst.options) {
      try {
        if (typeof chartInst.stop === 'function') {
          chartInst.stop();
        }
        chartInst._rgPdfLightMode = true;
        var optsObj = chartInst.options;
        if (optsObj.plugins && optsObj.plugins.legend && optsObj.plugins.legend.labels) {
          restoredState.push({ target: optsObj.plugins.legend.labels, key: 'color', val: optsObj.plugins.legend.labels.color });
          optsObj.plugins.legend.labels.color = '#1e293b';
        }
        if (optsObj.scales) {
          Object.keys(optsObj.scales).forEach(function (sk) {
            var sc = optsObj.scales[sk];
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
      var srcW = Math.max(1, canvasEl.width || 600);
      var srcH = Math.max(1, canvasEl.height || 300);
      var ratio = srcW > maxW ? (maxW / srcW) : 1;
      var off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(srcW * ratio));
      off.height = Math.max(1, Math.round(srcH * ratio));
      var octx = off.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, off.width, off.height);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvasEl, 0, 0, off.width, off.height);
      outDataUrl = off.toDataURL('image/jpeg', quality);
    } catch (err) {
      outDataUrl = '';
    } finally {
      if (chartInst) {
        try {
          chartInst._rgPdfLightMode = false;
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
    var signal = options && options.signal;
    throwIfAborted(signal);
    await ensureJsPdfLoaded();
    throwIfAborted(signal);

    var core = root.RGCrmCore;
    var isRtl = options.dir !== 'ltr';
    var lang = options.lang || (isRtl ? 'ar' : 'en');
    var title = options.title || (lang === 'en' ? 'RENTAL GATE CRM Report' : 'تقرير RENTAL GATE CRM');
    var exporterName = options.exporterName || '';
    var summaryItems = Array.isArray(options.summaryItems) ? options.summaryItems : [];
    var columns = Array.isArray(options.columns) ? options.columns : [];
    var rows = Array.isArray(options.rows) ? options.rows : [];
    var extraSections = Array.isArray(options.extraSections) ? options.extraSections : [];
    var chartImages = Array.isArray(options.chartImages) ? options.chartImages : [];

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

    var extraLinesTotal = extraSections.reduce(function (acc, sec) {
      return acc + (Array.isArray(sec && sec.lines) ? sec.lines.length : 0);
    }, 0);
    var validCharts = chartImages.filter(function (c) { return c && c.dataUrl; });

    var plan = (core && core.computePdfLayoutPlan)
      ? core.computePdfLayoutPlan({
          targetPages: options.targetPages,
          preset: options.preset,
          optimizeFileSize: options.optimizeFileSize,
          quality: options.quality,
          paperSize: options.paperSize || 'a4',
          orientation: options.orientation || 'landscape',
          lang: lang,
          rowCount: rows.length,
          columnCount: columns.length,
          kpiCount: kpiItems.length,
          wideSummaryCount: wideItems.length,
          extraSectionsCount: extraSections.length,
          extraLinesCount: extraLinesTotal,
          chartCount: validCharts.length
        })
      : {
          targetPages: 3,
          preset: 'balanced',
          optimizeFileSize: true,
          quality: 'balanced',
          paperSize: options.paperSize || 'a4',
          orientation: options.orientation || 'landscape',
          marginPt: 30,
          headerH: 70,
          contHeaderH: 42,
          headerGap: 14,
          footerReserve: 36,
          baseFont: 9.3,
          headerFont: 9.5,
          cellPadX: 6,
          cellPadY: 5.5,
          cellLineH: 14,
          kpiH: 46,
          kpiGap: 10,
          kpiPerRow: 4,
          sectionGap: 12,
          extraLineH: 14.5,
          extraBlockPad: 6,
          chartH: 160,
          chartGap: 12,
          chartCols: validCharts.length > 1 ? 2 : 1,
          maxCellLines: 3,
          maxRowsPerPage: 0,
          maxExtraPerPage: 0,
          breakBeforeExtra: false,
          breakBeforeCharts: false,
          renderScale: 1.45,
          jpegQuality: 0.76,
          imageCompression: 'MEDIUM',
          stripMetadata: true,
          compressStreams: true,
          downsampleLogoPx: 96,
          readabilityWarning: false,
          warningMessage: ''
        };

    var paperSize = plan.paperSize;
    var orientation = plan.orientation;
    var doc = new root.jspdf.jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: paperSize,
      compress: plan.compressStreams !== false
    });
    if (!plan.stripMetadata && typeof doc.setProperties === 'function') {
      doc.setProperties({
        title: title,
        subject: 'Rental Gate CRM Export',
        creator: 'RENTAL GATE CRM'
      });
    }

    var pageWmm = doc.internal.pageSize.getWidth();
    var pageHmm = doc.internal.pageSize.getHeight();
    var scale = plan.renderScale || 1.45;
    var cw = Math.round(pageWmm * 3.78 * scale);
    var ch = Math.round(pageHmm * 3.78 * scale);
    var pad = Math.round(plan.marginPt * scale);
    var footerReserve = Math.round(plan.footerReserve * scale);
    var fontStack = '"IBM Plex Sans Arabic", "Plus Jakarta Sans", "Segoe UI", Tahoma, Arial, sans-serif';
    var logoImg = await loadLogoImage(plan.downsampleLogoPx || 96);
    throwIfAborted(signal);

    var nowFormatted = (core && core.formatDisplayDateTime)
      ? core.formatDisplayDateTime(new Date().toISOString())
      : new Date().toISOString().substring(0, 16).replace('T', ' ');
    var metaText = (isRtl ? 'التاريخ: ' : 'Date: ') + nowFormatted + (exporterName ? (isRtl ? '  |  المصدر: ' : '  |  By: ') + exporterName : '');

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

    function drawHeader(p, isContinuation) {
      var ctx = p.ctx;
      var useCompactCont = Boolean(isContinuation && plan.contHeaderH < plan.headerH - 8);
      var headerH = Math.round((useCompactCont ? plan.contHeaderH : plan.headerH) * scale);

      ctx.fillStyle = '#313232';
      ctx.fillRect(0, 0, cw, headerH);
      ctx.fillStyle = '#d32228';
      ctx.fillRect(0, 0, cw, Math.max(2, Math.round(4.5 * scale)));

      if (useCompactCont) {
        var contFontSz = Math.round(Math.max(10.5, plan.baseFont * 1.15) * scale);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + contFontSz + 'px ' + fontStack;
        drawSmartLine(ctx, title, isRtl ? cw - pad : pad, Math.round(headerH * 0.66), cw - pad * 2, isRtl);
        p.y = headerH + Math.round(Math.max(8, plan.headerGap * 0.75) * scale);
        return;
      }

      var logoOffset = 0;
      if (logoImg) {
        var boxSz = Math.round(Math.min(48, Math.max(30, plan.headerH * 0.62)) * scale);
        var lx = isRtl ? cw - pad - boxSz : pad;
        var ly = Math.round(((headerH - boxSz) / 2) + 1.5 * scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(lx - 2 * scale, ly - 2 * scale, boxSz + 4 * scale, boxSz + 4 * scale);
        ctx.drawImage(logoImg, lx, ly, boxSz, boxSz);
        logoOffset = boxSz + Math.round(14 * scale);
      }

      var textX = isRtl ? cw - pad - logoOffset : pad + logoOffset;
      var maxHeaderW = cw - pad * 2 - logoOffset;
      var titleSz = Math.round(Math.min(18, Math.max(12.5, plan.headerH * 0.22)) * scale);
      var metaSz = Math.round(Math.min(11, Math.max(8.5, plan.headerH * 0.14)) * scale);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + titleSz + 'px ' + fontStack;
      drawSmartLine(ctx, title, textX, Math.round(headerH * 0.48), maxHeaderW, isRtl);

      ctx.fillStyle = '#d4d6d8';
      ctx.font = metaSz + 'px ' + fontStack;
      drawSmartLine(ctx, metaText, textX, Math.round(headerH * 0.77), maxHeaderW, isRtl);

      p.y = headerH + Math.round(plan.headerGap * scale);
    }

    function ensureSpace(p, neededHeight) {
      if (p.y + neededHeight > ch - footerReserve) {
        var next = newPage();
        drawHeader(next, true);
        return next;
      }
      return p;
    }

    var page = newPage();
    drawHeader(page, false);

    // 1. Summary Section: compact KPI strip + wide multi-line cards
    if (summaryItems.length > 0) {
      if (kpiItems.length > 0) {
        var gap = Math.round(plan.kpiGap * scale);
        var perRow = Math.min(plan.kpiPerRow || 4, kpiItems.length);
        var rowCount = Math.ceil(kpiItems.length / perRow);
        var idx = 0;
        var kpiLabelSz = Math.round(Math.max(8.0, Math.min(10.5, plan.baseFont * 0.96)) * scale);
        var kpiValSz = Math.round(Math.max(10.0, Math.min(14.5, plan.baseFont * 1.28)) * scale);
        for (var r = 0; r < rowCount; r++) {
          var colsInRow = Math.min(perRow, kpiItems.length - idx);
          var cardH = Math.round(plan.kpiH * scale);
          page = ensureSpace(page, cardH + gap);
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
            page.ctx.rect(bx + 3 * scale, page.y + 2 * scale, cardW - 6 * scale, cardH - 4 * scale);
            page.ctx.clip();

            var anchorX = isRtl ? bx + cardW - Math.round(9 * scale) : bx + Math.round(9 * scale);
            var innerW = cardW - Math.round(18 * scale);
            page.ctx.fillStyle = '#475569';
            page.ctx.font = kpiLabelSz + 'px ' + fontStack;
            drawSmartLine(page.ctx, item.label, anchorX, page.y + Math.round(cardH * 0.37), innerW, isRtl);

            page.ctx.fillStyle = '#0f172a';
            page.ctx.font = 'bold ' + kpiValSz + 'px ' + fontStack;
            drawSmartLine(page.ctx, item.value, anchorX, page.y + Math.round(cardH * 0.78), innerW, isRtl);
            page.ctx.restore();
          }
          page.y += cardH + gap;
        }
      }

      if (wideItems.length > 0) {
        var wideGap = Math.round(plan.kpiGap * scale);
        var colsWide = cw > 900 * scale && wideItems.length > 1 ? 2 : 1;
        var wBoxW = (cw - pad * 2 - (colsWide - 1) * wideGap) / colsWide;
        var wideFontSz = Math.round(Math.max(8.2, plan.baseFont * 1.02) * scale);
        var wideLabelSz = Math.round(Math.max(7.6, plan.baseFont * 0.92) * scale);
        var wideLineH = Math.round(plan.extraLineH * scale);
        for (var wi = 0; wi < wideItems.length; wi += colsWide) {
          var pair = wideItems.slice(wi, wi + colsWide);
          var prepared = pair.map(function (it) {
            page.ctx.font = wideFontSz + 'px ' + fontStack;
            var valLines = wrapCanvasText(page.ctx, it.value, wBoxW - Math.round(20 * scale), plan.maxCellLines + 1);
            var h = Math.round(20 * scale) + valLines.length * wideLineH + Math.round(6 * scale);
            return { item: it, lines: valLines, h: h };
          });
          var rowCardH = Math.max.apply(null, prepared.map(function (p2) { return p2.h; }));
          page = ensureSpace(page, rowCardH + wideGap);

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
            page.ctx.rect(bx + 3 * scale, page.y + 2 * scale, wBoxW - 6 * scale, rowCardH - 4 * scale);
            page.ctx.clip();

            var anchorX = isRtl ? bx + wBoxW - Math.round(9 * scale) : bx + Math.round(9 * scale);
            page.ctx.fillStyle = '#64748b';
            page.ctx.font = 'bold ' + wideLabelSz + 'px ' + fontStack;
            drawSmartLine(page.ctx, prep.item.label, anchorX, page.y + Math.round(13 * scale), wBoxW - Math.round(18 * scale), isRtl);

            page.ctx.fillStyle = '#0f172a';
            page.ctx.font = wideFontSz + 'px ' + fontStack;
            prep.lines.forEach(function (ln, li) {
              drawSmartLine(page.ctx, ln, anchorX, page.y + Math.round(27 * scale) + li * wideLineH, wBoxW - Math.round(18 * scale), isRtl);
            });
            page.ctx.restore();
          });
          page.y += rowCardH + wideGap;
        }
        page.y += Math.round(Math.max(2, plan.sectionGap * 0.35) * scale);
      }
    }

    // 2. Main Data Table with Dynamic Density, Proportional Column Widths & No Clipping
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

      var baseFontSize = plan.baseFont || 9.3;
      var headerFontSize = plan.headerFont || baseFontSize;
      var headerFont = 'bold ' + Math.round(headerFontSize * scale) + 'px ' + fontStack;
      var bodyFont = Math.round(baseFontSize * scale) + 'px ' + fontStack;
      var cellPadX = Math.round(plan.cellPadX * scale);
      var cellPadY = Math.round(plan.cellPadY * scale);
      var cellLineH = Math.round(plan.cellLineH * scale);
      var maxCellLines = Math.max(2, Number(plan.maxCellLines || 3));

      page.ctx.font = headerFont;
      var headerWrapped = columns.map(function (col, idx) {
        var lbl = (lang === 'en' && col.labelEn) ? col.labelEn : col.label;
        return wrapCanvasText(page.ctx, lbl || col.key || '', Math.max(20, colWidths[idx] - cellPadX * 2), 2);
      });
      var maxHeaderLines = Math.max.apply(null, headerWrapped.map(function (l) { return l.length; }).concat([1]));
      var headerRowH = Math.max(Math.round((headerFontSize * 2.1) * scale), maxHeaderLines * cellLineH + cellPadY * 2);

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
            var ly = p.y + cellPadY + Math.round(headerFontSize * scale) + li * cellLineH;
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
        page = ensureSpace(page, headerRowH + Math.round(28 * scale));
        drawTableHeader(page);
        page.ctx.fillStyle = '#f8fafc';
        page.ctx.fillRect(pad, page.y, tableW, Math.round(26 * scale));
        page.ctx.strokeStyle = '#cbd5e1';
        page.ctx.strokeRect(pad, page.y, tableW, Math.round(26 * scale));
        page.ctx.fillStyle = '#64748b';
        page.ctx.font = bodyFont;
        page.ctx.textAlign = 'center';
        page.ctx.fillText(isRtl ? 'لا توجد سجلات مطابقة لمعايير التقرير.' : 'No matching records found.', cw / 2, page.y + Math.round(17 * scale));
        page.y += Math.round(32 * scale);
      } else {
        page = ensureSpace(page, headerRowH + Math.round(24 * scale));
        drawTableHeader(page);

        var rowsOnPage = 0;
        var maxRowsLimit = Number(plan.maxRowsPerPage || 0);
        for (var ri = 0; ri < rows.length; ri++) {
          if (ri > 0 && ri % 18 === 0) {
            await yieldMainThread();
            throwIfAborted(signal);
          }
          var row = rows[ri];
          page.ctx.font = bodyFont;
          var cellLines = columns.map(function (col, cIdx) {
            var formatted = (core && core.formatReportCellValue)
              ? core.formatReportCellValue(col, row, lang)
              : (function () {
                  var v = typeof col.value === 'function' ? col.value(row) : row[col.key];
                  if (Array.isArray(v)) return v.join('، ') || '-';
                  return v !== undefined && v !== null && v !== '' ? String(v) : '-';
                })();
            return wrapCanvasText(page.ctx, formatted, Math.max(20, colWidths[cIdx] - cellPadX * 2), maxCellLines);
          });
          var maxLines = Math.max.apply(null, cellLines.map(function (l) { return l.length; }).concat([1]));
          var rowH = Math.max(Math.round((baseFontSize * 1.9) * scale), maxLines * cellLineH + cellPadY * 2);

          var hitRowCap = maxRowsLimit > 0 && rowsOnPage >= maxRowsLimit;
          if (hitRowCap || (page.y + rowH > ch - footerReserve)) {
            page = newPage();
            drawHeader(page, true);
            drawTableHeader(page);
            rowsOnPage = 0;
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
          rowsOnPage += 1;
        }
        page.y += Math.round(plan.sectionGap * scale);
      }
    }

    // 3. Extra Sections (Notes, FollowUps, Extensions, Problems)
    if (extraSections.length > 0 && plan.breakBeforeExtra && page.y > Math.round((plan.headerH + plan.headerGap + 40) * scale)) {
      page = newPage();
      drawHeader(page, true);
    }

    var extraTitleSz = Math.round(Math.max(10, plan.baseFont * 1.24) * scale);
    var extraBodySz = Math.round(Math.max(8.0, plan.baseFont * 1.02) * scale);
    var secLineH = Math.round(plan.extraLineH * scale);
    var secBlockPad = Math.round(plan.extraBlockPad * scale);
    var maxExtraPerPage = Number(plan.maxExtraPerPage || 0);
    var extraCountOnPage = 0;

    for (var sIdx = 0; sIdx < extraSections.length; sIdx++) {
      var sec = extraSections[sIdx];
      var secLines = Array.isArray(sec.lines) ? sec.lines : [];
      if (!secLines.length) continue;
      page = ensureSpace(page, Math.round(38 * scale));

      page.ctx.fillStyle = '#d32228';
      page.ctx.font = 'bold ' + extraTitleSz + 'px ' + fontStack;
      drawSmartLine(page.ctx, sec.title || '', isRtl ? cw - pad : pad, page.y + Math.round(13 * scale), cw - pad * 2, isRtl);
      page.y += Math.round(Math.max(18, plan.baseFont * 2.2) * scale);

      var maxLineW = cw - pad * 2 - Math.round(22 * scale);
      for (var liIdx = 0; liIdx < secLines.length; liIdx++) {
        var rawLine = secLines[liIdx];
        page.ctx.font = extraBodySz + 'px ' + fontStack;
        var wrapped = wrapCanvasText(page.ctx, '• ' + String(rawLine), maxLineW, Math.max(3, plan.maxCellLines + 1));
        var blockH = wrapped.length * secLineH + secBlockPad;
        if (maxExtraPerPage > 0 && extraCountOnPage >= maxExtraPerPage) {
          page = newPage();
          drawHeader(page, true);
          extraCountOnPage = 0;
        } else {
          page = ensureSpace(page, blockH);
        }

        page.ctx.fillStyle = '#f8fafc';
        page.ctx.fillRect(pad, page.y - Math.round(2 * scale), cw - pad * 2, blockH - Math.round(2 * scale));
        page.ctx.fillStyle = '#d32228';
        page.ctx.fillRect(isRtl ? cw - pad - Math.round(3 * scale) : pad, page.y - Math.round(2 * scale), Math.round(3 * scale), blockH - Math.round(2 * scale));

        page.ctx.fillStyle = '#1e293b';
        wrapped.forEach(function (ln, li) {
          var anchorX = isRtl ? cw - pad - Math.round(12 * scale) : pad + Math.round(12 * scale);
          drawSmartLine(page.ctx, ln, anchorX, page.y + Math.round((plan.baseFont * 1.1) * scale) + li * secLineH, maxLineW, isRtl);
        });
        page.y += blockH;
        extraCountOnPage += 1;
      }
      page.y += Math.round(Math.max(6, plan.sectionGap * 0.75) * scale);
    }

    // 4. Charts Grid
    if (validCharts.length > 0) {
      throwIfAborted(signal);
      var loadedCharts = await Promise.all(validCharts.map(function (chImg) {
        return new Promise(function (res) {
          var im = new Image();
          im.onload = function () { res({ title: chImg.title || '', img: im }); };
          im.onerror = function () { res(null); };
          im.src = chImg.dataUrl;
        });
      }));
      throwIfAborted(signal);
      var readyCharts = loadedCharts.filter(Boolean);
      if (readyCharts.length > 0) {
        if (plan.breakBeforeCharts && page.y > Math.round((plan.headerH + plan.headerGap + 40) * scale)) {
          page = newPage();
          drawHeader(page, true);
        }
        var chartGap = Math.round(plan.chartGap * scale);
        var colsCharts = Math.min(readyCharts.length, Math.max(1, Number(plan.chartCols || (readyCharts.length > 1 ? 2 : 1))));
        var slotW = (cw - pad * 2 - (colsCharts - 1) * chartGap) / colsCharts;
        var cardChartH = Math.round(plan.chartH * scale);
        var chartTitleSz = Math.round(Math.max(8.8, plan.baseFont * 1.06) * scale);

        for (var chIdx = 0; chIdx < readyCharts.length; chIdx += colsCharts) {
          page = ensureSpace(page, cardChartH + chartGap);
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
            page.ctx.font = 'bold ' + chartTitleSz + 'px ' + fontStack;
            drawSmartLine(page.ctx, item.title, isRtl ? bx + slotW - Math.round(10 * scale) : bx + Math.round(10 * scale), page.y + Math.round(18 * scale), slotW - Math.round(20 * scale), isRtl);

            var availW = slotW - Math.round(20 * scale);
            var availH = cardChartH - Math.round(30 * scale);
            var ratio = item.img.width / Math.max(1, item.img.height);
            var drawW = availW;
            var drawH = drawW / ratio;
            if (drawH > availH) {
              drawH = availH;
              drawW = drawH * ratio;
            }
            var drawX = bx + (slotW - drawW) / 2;
            var drawY = page.y + Math.round(24 * scale) + (availH - drawH) / 2;
            page.ctx.drawImage(item.img, drawX, drawY, drawW, drawH);
          });
          page.y += cardChartH + chartGap;
        }
      }
    }

    // 5. Footers + Real File Compression & Resource Optimization
    var totalPages = pages.length;
    var pageImages = [];
    var footerLineY = ch - Math.round(Math.max(20, plan.footerReserve * 0.78) * scale);
    var footerTextY = ch - Math.round(Math.max(8, plan.footerReserve * 0.34) * scale);
    var footerFontSz = Math.round(Math.max(8.0, plan.baseFont * 0.96) * scale);
    var imgCompressionMode = plan.imageCompression || 'MEDIUM';
    var jpegQuality = Number(plan.jpegQuality || 0.76);

    for (var idx = 0; idx < pages.length; idx++) {
      throwIfAborted(signal);
      if (idx > 0 && idx % 3 === 0) {
        await yieldMainThread();
        throwIfAborted(signal);
      }
      var p = pages[idx];
      p.ctx.strokeStyle = '#e2e8f0';
      p.ctx.lineWidth = Math.max(1, 1 * scale);
      p.ctx.beginPath();
      p.ctx.moveTo(pad, footerLineY);
      p.ctx.lineTo(cw - pad, footerLineY);
      p.ctx.stroke();

      p.ctx.fillStyle = '#64748b';
      p.ctx.font = footerFontSz + 'px ' + fontStack;
      p.ctx.textAlign = 'center';
      var footerLabel = lang === 'en'
        ? ('RENTAL GATE CRM — Page ' + (idx + 1) + ' of ' + totalPages)
        : ('RENTAL GATE CRM — صفحة ' + (idx + 1) + ' من ' + totalPages);
      p.ctx.fillText(footerLabel, cw / 2, footerTextY);

      if (idx > 0) doc.addPage(paperSize, orientation);
      var jpegData = p.canvas.toDataURL('image/jpeg', jpegQuality);
      pageImages.push(jpegData);
      doc.addImage(jpegData, 'JPEG', 0, 0, pageWmm, pageHmm, 'rg_p_' + idx, imgCompressionMode);
    }

    throwIfAborted(signal);
    var actualReadabilityWarning = Boolean(plan.readabilityWarning || totalPages > plan.targetPages);
    var actualWarningMsg = plan.warningMessage || '';
    if (actualReadabilityWarning && !actualWarningMsg) {
      actualWarningMsg = lang === 'en'
        ? ('Some content requires additional pages (' + totalPages + ' pages minimum) to maintain readability.')
        : ('بعض المحتوى يتطلب صفحات إضافية (' + totalPages + ' صفحات على الأقل) للحفاظ على وضوح القراءة.');
    }

    var pdfFilename = options.filename || 'rental-gate-report.pdf';
    var pdfBlob = doc.output('blob');
    if (options.returnStatsOnly) {
      return {
        filename: pdfFilename,
        pages: totalPages,
        sizeBytes: pdfBlob.size,
        targetPages: plan.targetPages,
        preset: plan.preset,
        quality: plan.quality,
        optimizeFileSize: plan.optimizeFileSize,
        readabilityWarning: actualReadabilityWarning,
        warningMessage: actualWarningMsg
      };
    }
    if (options.previewOnly) {
      return {
        filename: pdfFilename,
        pages: totalPages,
        sizeBytes: pdfBlob.size,
        blob: pdfBlob,
        paperSize: paperSize,
        orientation: orientation,
        pageWidthMm: pageWmm,
        pageHeightMm: pageHmm,
        pageWidthPx: cw,
        pageHeightPx: ch,
        pageImages: pageImages,
        targetPages: plan.targetPages,
        preset: plan.preset,
        quality: plan.quality,
        optimizeFileSize: plan.optimizeFileSize,
        readabilityWarning: actualReadabilityWarning,
        warningMessage: actualWarningMsg,
        layoutPlan: plan
      };
    }
    doc.save(pdfFilename);
    return {
      filename: pdfFilename,
      pages: totalPages,
      sizeBytes: pdfBlob.size,
      targetPages: plan.targetPages,
      preset: plan.preset,
      quality: plan.quality,
      optimizeFileSize: plan.optimizeFileSize,
      readabilityWarning: actualReadabilityWarning,
      warningMessage: actualWarningMsg
    };
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

    var empState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
    var hasPreloadedEmps = Boolean(empState && empState.loaded && Array.isArray(empState.items) && empState.items.length > 0);
    var empRes = hasPreloadedEmps
      ? { success: true, data: { items: empState.items } }
      : await root.RGApi.callApi('getEmployees', {});
    var employees = (empRes.success && empRes.data.items) || [];
    var facets = { companies: [], branches: [] };

    container.innerHTML =
      '<div class="surface-card">' +
        '<div class="section-header">' +
          '<div><h2 class="section-title">' + t('nav_reports') + '</h2><p class="section-subtitle">' + t('reports_subtitle') + '</p></div>' +
          '<div class="toolbar-row" style="margin-bottom:0;">' +
            (root.RGHandover ? '<button type="button" class="btn" id="btn-shift-handover-modal">' + (ctx.lang === 'en' ? 'Shift Handover (PDF)' : 'ملخص تسليم الوردية (PDF)') + '</button>' : '') +
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
          '<input type="date" class="input" id="rep-from" data-rg-range-pair="rep-range" data-rg-range-role="start" aria-label="' + t('from_date') + '">' +
          '<input type="date" class="input" id="rep-to" data-rg-range-pair="rep-range" data-rg-range-role="end" aria-label="' + t('to_date') + '">' +
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
        '<div class="chart-card" id="rep-peak-heatmap-card" style="margin-bottom:16px;">' +
          '<div class="chart-card-head">' +
            '<h3 class="chart-card-title">' + (ctx.lang === 'en' ? 'Peak Hours Heatmap (Shift Planning)' : 'مصفوفة ساعات الذروة (تخطيط الورديات)') + '</h3>' +
            '<span class="chart-sub-hint">' + (ctx.lang === 'en' ? '7 Days × 24 Hours' : '7 أيام × 24 ساعة') + '</span>' +
          '</div>' +
          '<div id="rep-peak-heatmap"></div>' +
        '</div>' +
        '<div class="chart-card rg-problem-rate-card" id="rep-problem-rates-card" style="margin-bottom:16px;"></div>' +
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
        ? core.getReportColumns(state.reportType, state.rows).slice(0, 11)
        : RESERVATION_COLUMNS.slice(0, 11);

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
              var st = isMono ? ' style="white-space:nowrap;"' : '';
              return '<td class="' + cls + '"' + st + '>' + formatted + '</td>';
            }).join('') + '</tr>';
          }).join('') +
        '</tbody></table></div>';
    }

    var reportChartInstances = [];
    var latestChartsParams = null;
    function renderReportCharts(reportType, rows, chartOpts) {
      latestChartsParams = { reportType: reportType, rows: rows || [] };
      if (!root.Chart) return;
      reportChartInstances.forEach(function (ch) { ch.destroy(); });
      reportChartInstances = [];

      var cOpts = chartOpts || {};
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var reduced = Boolean(cOpts.instant || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches));
      var txt = isDark ? '#E5E7EB' : '#292929';
      var mutedTxt = isDark ? '#9CA3AF' : '#686868';
      var gridCol = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(41,41,41,0.08)';
      var segBorder = isDark ? '#14151A' : '#FFFFFF';
      var tooltipOpt = {
        backgroundColor: isDark ? 'rgba(20, 21, 26, 0.96)' : 'rgba(41, 41, 41, 0.96)',
        titleColor: '#FFFFFF',
        bodyColor: '#F3F4F6',
        borderColor: 'rgba(217, 31, 43, 0.45)',
        borderWidth: 1,
        cornerRadius: 11,
        padding: 10,
        titleFont: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '700' },
        bodyFont: { family: "'IBM Plex Sans Arabic', sans-serif" },
        callbacks: {
          label: function (ctxItem) {
            var arr = (ctxItem.dataset && Array.isArray(ctxItem.dataset.data)) ? ctxItem.dataset.data : [];
            var total = arr.reduce(function (acc, val) { return acc + Math.max(0, Number(val || 0)); }, 0);
            var val = Number(ctxItem.raw !== undefined ? ctxItem.raw : 0);
            var pct = total > 0 ? Math.round((val / total) * 100) : 0;
            var lbl = ctxItem.label || ctxItem.dataset.label || '';
            return ' ' + (lbl ? lbl + ': ' : '') + val + ' (' + pct + '%)';
          }
        }
      };
      var donutCenterPlugin = {
        id: 'rgReportDonutCenter',
        afterDraw: function (chart) {
          if (!chart || chart.config.type !== 'doughnut' || !chart.chartArea) return;
          var arr = (chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data) || [];
          var sum = 0;
          for (var i = 0; i < arr.length; i++) {
            var vis = typeof chart.getDataVisibility === 'function' ? chart.getDataVisibility(i) : true;
            if (vis) sum += Number(arr[i] || 0);
          }
          var cx = (chart.chartArea.left + chart.chartArea.right) / 2;
          var cy = (chart.chartArea.top + chart.chartArea.bottom) / 2;
          var darkNow = !chart._rgPdfLightMode && document.documentElement.getAttribute('data-theme') === 'dark';
          var ctx2d = chart.ctx;
          ctx2d.save();
          ctx2d.textAlign = 'center';
          ctx2d.textBaseline = 'middle';
          ctx2d.fillStyle = darkNow ? '#FFFFFF' : '#292929';
          ctx2d.font = "700 22px 'IBM Plex Sans Arabic', sans-serif";
          ctx2d.fillText(String(sum), cx, cy - 7);
          ctx2d.fillStyle = darkNow ? '#9CA3AF' : '#686868';
          ctx2d.font = "600 10.5px 'IBM Plex Sans Arabic', sans-serif";
          ctx2d.fillText(ctx.lang === 'en' ? 'Total' : 'الإجمالي', cx, cy + 12);
          ctx2d.restore();
        }
      };

      var primaryCounts = {};
      var secondaryCounts = {};

      rows.forEach(function (r) {
        var k1 = r.internalStatus || r.status || r.employeeName || r.statusAr || 'غير محدد';
        primaryCounts[k1] = (primaryCounts[k1] || 0) + (reportType === 'employee_performance' ? Number(r.followUpsCount || 0) : 1);

        var k2 = r.companyName || r.extensionTypeAr || r.priority || r.role || r.paymentStatus || 'أخرى';
        secondaryCounts[k2] = (secondaryCounts[k2] || 0) + (reportType === 'employee_performance' ? Number(r.assignedReservations || 0) : 1);
      });

      var c1 = document.getElementById('report-chart-primary');
      var c2 = document.getElementById('report-chart-secondary');
      if (c1) {
        var ctx1 = c1.getContext('2d');
        var grad1 = ctx1.createLinearGradient(0, 0, 0, 220);
        grad1.addColorStop(0, '#D91F2B');
        grad1.addColorStop(1, 'rgba(153, 19, 28, 0.72)');
        reportChartInstances.push(new root.Chart(ctx1, {
          type: 'bar',
          data: {
            labels: Object.keys(primaryCounts),
            datasets: [{
              label: 'العدد',
              data: Object.values(primaryCounts),
              backgroundColor: grad1,
              hoverBackgroundColor: '#B81722',
              borderRadius: 8,
              borderSkipped: false,
              maxBarThickness: 38
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduced ? false : {
              duration: 620,
              easing: 'easeOutQuart',
              delay: function (context) {
                return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 65 : 0;
              }
            },
            plugins: { legend: { display: false }, tooltip: tooltipOpt },
            scales: {
              x: { ticks: { color: txt, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { display: false } },
              y: { ticks: { color: mutedTxt, precision: 0, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } }, grid: { color: gridCol }, beginAtZero: true, grace: '15%' }
            }
          }
        }));
      }
      if (c2) {
        reportChartInstances.push(new root.Chart(c2.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: Object.keys(secondaryCounts),
            datasets: [{
              data: Object.values(secondaryCounts),
              backgroundColor: ['#D91F2B', isDark ? '#64748B' : '#292929', '#10B981', '#2563EB', '#D97706', '#7C3AED', '#06B6D4', '#8A8A8A'],
              borderColor: segBorder,
              borderWidth: 2.5,
              hoverOffset: 8
            }]
          },
          plugins: [donutCenterPlugin],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduced ? false : { animateRotate: true, animateScale: true, duration: 760, easing: 'easeOutQuart' },
            cutout: '66%',
            plugins: {
              legend: { position: 'bottom', labels: { color: txt, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12, font: { family: "'IBM Plex Sans Arabic', sans-serif", size: 11 } } },
              tooltip: tooltipOpt
            }
          }
        }));
      }
    }

    container._rgRefreshReportCharts = function () {
      if (latestChartsParams && document.getElementById('report-chart-primary')) {
        renderReportCharts(latestChartsParams.reportType, latestChartsParams.rows, { instant: true });
      }
    };

    container.querySelectorAll('[data-rtype]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.reportType = btn.getAttribute('data-rtype');
        container.querySelectorAll('[data-rtype]').forEach(function (el) {
          el.classList.toggle('active', el === btn);
        });
        loadPreview(false);
      });
    });

    function renderProblemRatesSection(resItems, prbItems) {
      var host = document.getElementById('rep-problem-rates-card');
      if (!host) return;
      var core = root.RGCrmCore;
      var metrics = (core && core.computeProblemsPer100Bookings)
        ? core.computeProblemsPer100Bookings(resItems || [], prbItems || [])
        : { overall: { totalBookings: 0, problemsCount: 0, openProblemsCount: 0, resolvedProblemsCount: 0, ratePer100: 0, severity: 'normal' }, byCompany: [], byBranch: [] };
      var isEn = ctx.lang === 'en';
      var ov = metrics.overall;
      host.innerHTML =
        '<div class="chart-card-head">' +
          '<div>' +
            '<h3 class="chart-card-title">' + (isEn ? 'Problems per 100 Bookings (Company & Branch)' : 'مؤشر نسبة المشكلات لكل 100 حجز (حسب الشركة والفرع)') + '</h3>' +
            '<div class="cell-sub">' + (isEn ? 'Overall rate: ' : 'المعدل الإجمالي: ') + '<strong class="tabular-nums">' + ov.ratePer100 + '</strong> ' + (isEn ? 'problems / 100 bookings' : 'مشكلة / 100 حجز') + ' · <span class="tabular-nums">' + ov.problemsCount + ' / ' + ov.totalBookings + '</span></div>' +
          '</div>' +
          '<span class="rg-rate-badge is-' + ov.severity + ' tabular-nums">' + ov.ratePer100 + ' / 100</span>' +
        '</div>' +
        '<div class="rg-rate-split-grid">' +
          '<div class="rg-rate-panel">' +
            '<h4 class="rg-rate-panel-title">' + (isEn ? 'By Company' : 'تحليل الشركات (لكل 100 حجز)') + '</h4>' +
            (metrics.byCompany.length === 0
              ? '<div class="empty-state" style="padding:12px;">لا توجد بيانات متاحة.</div>'
              : '<div class="table-wrap"><table class="data-table"><thead><tr><th>الشركة</th><th>الحجوزات</th><th>المشكلات</th><th>مفتوحة</th><th>محلولة</th><th>النسبة / 100</th></tr></thead><tbody>' +
                  metrics.byCompany.map(function (c) {
                    return '<tr><td><strong>' + c.companyName + '</strong></td><td class="tabular-nums">' + c.totalBookings + '</td><td class="tabular-nums">' + c.problemsCount + '</td><td class="tabular-nums">' + c.openProblemsCount + '</td><td class="tabular-nums">' + c.resolvedProblemsCount + '</td><td><span class="rg-rate-badge is-' + c.severity + ' tabular-nums">' + c.ratePer100 + '</span></td></tr>';
                  }).join('') +
                '</tbody></table></div>') +
          '</div>' +
          '<div class="rg-rate-panel">' +
            '<h4 class="rg-rate-panel-title">' + (isEn ? 'By Branch' : 'تحليل الفروع (لكل 100 حجز)') + '</h4>' +
            (metrics.byBranch.length === 0
              ? '<div class="empty-state" style="padding:12px;">لا توجد بيانات متاحة.</div>'
              : '<div class="table-wrap"><table class="data-table"><thead><tr><th>الفرع</th><th>الشركة</th><th>الحجوزات</th><th>المشكلات</th><th>النسبة / 100</th></tr></thead><tbody>' +
                  metrics.byBranch.map(function (b) {
                    return '<tr><td><strong>' + b.branchName + '</strong></td><td>' + b.companyName + '</td><td class="tabular-nums">' + b.totalBookings + '</td><td class="tabular-nums">' + b.problemsCount + '</td><td><span class="rg-rate-badge is-' + b.severity + ' tabular-nums">' + b.ratePer100 + '</span></td></tr>';
                  }).join('') +
                '</tbody></table></div>') +
          '</div>' +
        '</div>';
    }

    async function loadReportHeatmap(preloadedReservations) {
      var hmHost = document.getElementById('rep-peak-heatmap');
      var ratesHost = document.getElementById('rep-problem-rates-card');
      if (!hmHost && !ratesHost) return;
      try {
        var rParams = {
          page: 1,
          pageSize: 200,
          dateFrom: document.getElementById('rep-from') ? document.getElementById('rep-from').value : '',
          dateTo: document.getElementById('rep-to') ? document.getElementById('rep-to').value : '',
          employeeId: document.getElementById('rep-emp') ? document.getElementById('rep-emp').value : '',
          company: document.getElementById('rep-company') ? document.getElementById('rep-company').value : '',
          branch: document.getElementById('rep-branch') ? document.getElementById('rep-branch').value : '',
          silentRefresh: true
        };
        var pParams = {
          employeeId: rParams.employeeId,
          silentRefresh: true
        };
        var canReuseRows = Array.isArray(preloadedReservations);
        var [resR, prbR] = await Promise.all([
          canReuseRows ? Promise.resolve(null) : root.RGApi.callApi('getReservations', rParams),
          root.RGApi.callApi('getProblems', pParams)
        ]);
        if (hmHost && !hmHost.isConnected) return;
        var resItems = canReuseRows
          ? preloadedReservations
          : ((resR && resR.success && resR.data && Array.isArray(resR.data.items)) ? resR.data.items : []);
        var prbItems = (prbR && prbR.success && prbR.data && Array.isArray(prbR.data.items)) ? prbR.data.items : [];
        if (hmHost && root.RGDashboard && root.RGDashboard.renderPeakHoursHeatmap) {
          root.RGDashboard.renderPeakHoursHeatmap(hmHost, resItems, prbItems, { lang: ctx.lang });
        }
        renderProblemRatesSection(resItems, prbItems);
      } catch (_e) {}
    }

    var repRunBtn = document.getElementById('rep-run-btn');
    repRunBtn.addEventListener('click', function () {
      if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates) {
        var rCheck = root.RGCrmDatePicker.validateContainerDates(container);
        if (!rCheck.valid) {
          ctx.toast(rCheck.message || 'يرجى التحقق من صحة تواريخ التقرير.', true);
          return;
        }
      }
      var runFlow = async function () {
        await loadPreview(false);
        loadReportHeatmap(state.reportType === 'all_reservations' ? state.rows : null);
      };
      if (ctx.withActionLock) {
        ctx.withActionLock(repRunBtn, 'reports:run', runFlow);
      } else {
        runFlow();
      }
    });

    document.getElementById('btn-open-export-modal').addEventListener('click', function () {
      openExportConfigModal(ctx, state, employees, facets);
    });

    var shiftHandoverBtn = document.getElementById('btn-shift-handover-modal');
    if (shiftHandoverBtn && root.RGHandover) {
      shiftHandoverBtn.addEventListener('click', function () {
        root.RGHandover.openHandoverModal(ctx);
      });
    }

    await loadPreview(false);
    loadReportHeatmap(state.reportType === 'all_reservations' ? state.rows : null);
  }

  function openExportConfigModal(ctx, state, employees, facets) {
    var modalRoot = document.getElementById('modal-root');
    var core = root.RGCrmCore;
    var isEn = ctx.lang === 'en';
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

    var initialPdfSettings = (root.RGPdfControls && root.RGPdfControls.createDefaultState)
      ? root.RGPdfControls.createDefaultState({ paperSize: 'a4', orientation: 'landscape' })
      : { targetPages: 3, preset: 'balanced', optimizeFileSize: true, quality: 'balanced', paperSize: 'a4', orientation: 'landscape' };

    var initRows = Array.isArray(state.rows) ? state.rows : [];
    var initStats = {
      rowCount: initRows.length,
      columnCount: Math.min(initialPdfSettings.orientation === 'portrait' ? 7 : 9, defaultSelectedKeys.length || 6),
      kpiCount: 2,
      wideSummaryCount: 0,
      extraSectionsCount: state.reportType !== 'followups_log' ? 1 : 0,
      extraLinesCount: state.reportType !== 'followups_log' ? 12 : 0,
      chartCount: 2
    };

    var advancedModalExtras =
      '<div class="rg-pdf-adv-section">' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label" for="exp-title">' + (isEn ? 'Report Title' : 'عنوان التقرير') + '</label><input class="input" id="exp-title" value="' + (isEn ? (reportTitleAr + ' Report — Rental Gate') : ('تقرير ' + reportTitleAr + ' — Rental Gate')) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="exp-emp">' + (isEn ? 'Employee' : 'الموظف') + '</label><select class="select" id="exp-emp"><option value="">' + (isEn ? 'All' : 'الكل') + '</option>' +
            employees.map(function (e) { return '<option value="' + e.id + '"' + (curEmpFilter === e.id ? ' selected' : '') + '>' + e.name + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="form-group"><label class="form-label" for="exp-status">' + (isEn ? 'Status' : 'الحالة') + '</label><select class="select" id="exp-status"><option value="">' + (isEn ? 'All' : 'الكل') + '</option>' +
            (root.RGCrmCore.WORKFLOW_STATUS_OPTIONS || root.RGCrmCore.FOLLOWUP_STATUSES).map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="form-group"><label class="form-label" for="exp-prio">' + (isEn ? 'Priority' : 'الأولوية') + '</label><select class="select" id="exp-prio"><option value="">' + (isEn ? 'All' : 'الكل') + '</option>' +
            root.RGCrmCore.PROBLEM_PRIORITIES.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="form-group"><span class="form-label">' + (isEn ? 'Included Columns' : 'الأعمدة المطلوبة') + ' (' + reportTitleAr + ')</span><div class="checkbox-grid">' +
          activeCols.map(function (col) {
            var checked = defaultSelectedKeys.indexOf(col.key) !== -1 ? 'checked' : '';
            var lbl = (ctx.lang === 'en' && col.labelEn) ? col.labelEn : col.label;
            return '<label class="checkbox-item"><input type="checkbox" class="exp-col-chk" value="' + col.key + '" ' + checked + '> ' + lbl + '</label>';
          }).join('') +
        '</div></div>' +
        '<div class="checkbox-grid" style="margin-bottom:10px;">' +
          '<label class="checkbox-item"><input type="checkbox" id="exp-inc-notes" checked> ' + (isEn ? 'Include Notes' : 'تضمين الملاحظات') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="exp-inc-fu" checked> ' + (isEn ? 'Include Follow-ups' : 'تضمين سجل المتابعات') + '</label>' +
          '<label class="checkbox-item"><input type="checkbox" id="exp-inc-charts" checked> ' + (isEn ? 'Include Charts' : 'تضمين الرسوم البيانية') + '</label>' +
        '</div>' +
        '<div class="glass-subcard" style="padding:12px;">' +
          '<label class="checkbox-item" style="font-weight:700;">' +
            '<input type="checkbox" id="exp-excel-compress"> ' + (isEn ? 'Enable Excel multi-sheet packing (optional)' : 'تفعيل ضغط بيانات Excel وتوزيعها في أوراق محددة (اختياري)') +
          '</label>' +
          '<div id="exp-excel-compress-opts" class="hidden" style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<label class="form-label" for="exp-excel-sheets" style="margin:0;">' + (isEn ? 'Max Sheets (1–10):' : 'الحد الأقصى للأوراق (من 1 إلى 10 ورقات):') + '</label>' +
            '<select class="select" id="exp-excel-sheets" style="max-width:260px;">' + sheetCountOptions + '</select>' +
          '</div>' +
        '</div>' +
      '</div>';

    var pdfControlsHtml = (root.RGPdfControls && root.RGPdfControls.renderPanelHtml)
      ? root.RGPdfControls.renderPanelHtml({
          mode: 'modal',
          idPrefix: 'rg-rep-pdfc',
          lang: ctx.lang,
          settings: initialPdfSettings,
          contentStats: initStats,
          advancedExtraHtml: advancedModalExtras
        })
      : advancedModalExtras;

    modalRoot.innerHTML =
      '<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">' +
        '<div class="modal-panel modal-panel-wide">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title" id="export-modal-title">' + (isEn ? 'Export & PDF Optimization — ' : 'إعدادات التقرير والتصدير الذكي — ') + reportTitleAr + '</h3>' +
            '<button type="button" class="btn btn-sm" id="exp-close">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
          '</div>' +
          pdfControlsHtml +
          '<div class="modal-footer">' +
            '<button type="button" class="btn" id="exp-excel-btn">' + (isEn ? 'Export Excel (.xlsx)' : 'تصدير Excel (.xlsx)') + '</button>' +
            '<button type="button" class="btn" id="exp-pdf-download-btn">' + (isEn ? 'Download PDF' : 'تحميل PDF') + '</button>' +
            '<button type="button" class="btn btn-primary" id="exp-pdf-btn">' + (isEn ? 'Preview PDF' : 'معاينة PDF') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var pdfPanelEl = document.getElementById('rg-rep-pdfc');
    var pdfCtrl = (root.RGPdfControls && pdfPanelEl)
      ? root.RGPdfControls.mount(pdfPanelEl, {
          lang: ctx.lang,
          initialSettings: initialPdfSettings,
          contentStats: initStats
        })
      : null;

    function refreshEstimatedStatsFromModal() {
      if (!pdfCtrl) return;
      var curSettings = pdfCtrl.getSettings();
      var maxCols = curSettings.orientation === 'portrait' ? 7 : 9;
      var chosenCount = modalRoot.querySelectorAll('.exp-col-chk:checked').length || 6;
      var incCharts = document.getElementById('exp-inc-charts') ? document.getElementById('exp-inc-charts').checked : true;
      var incFu = document.getElementById('exp-inc-fu') ? document.getElementById('exp-inc-fu').checked : true;
      pdfCtrl.setContentStats({
        rowCount: (state.rows || []).length,
        columnCount: Math.min(maxCols, chosenCount),
        kpiCount: 2,
        wideSummaryCount: 0,
        extraSectionsCount: (incFu && state.reportType !== 'followups_log') ? 1 : 0,
        extraLinesCount: (incFu && state.reportType !== 'followups_log') ? 12 : 0,
        chartCount: incCharts ? 2 : 0
      });
    }

    modalRoot.querySelectorAll('.exp-col-chk, #exp-inc-notes, #exp-inc-fu, #exp-inc-charts').forEach(function (el) {
      el.addEventListener('change', refreshEstimatedStatsFromModal);
    });

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

    function createReportPdfSnapshot() {
      var baseSettings = pdfCtrl ? pdfCtrl.getSettings() : initialPdfSettings;
      var pdfTitle = document.getElementById('exp-title').value || ('تقرير ' + reportTitleAr);
      var incNotes = document.getElementById('exp-inc-notes').checked;
      var incFu = document.getElementById('exp-inc-fu').checked;
      var incCharts = document.getElementById('exp-inc-charts').checked;
      var empFilterVal = document.getElementById('exp-emp').value;
      var selectedColKeys = Array.from(modalRoot.querySelectorAll('.exp-col-chk:checked')).map(function (el) { return el.value; });
      var pdfFilename = 'rental-gate-' + state.reportType + '.pdf';

      var cachedRowsPromise = null;
      var cachedFuPromise = null;
      var cachedChartImgs = null;

      function getCachedChartImages(qualityProfile) {
        if (!incCharts) return [];
        if (cachedChartImgs) return cachedChartImgs;
        var capOpts = {
          quality: qualityProfile && qualityProfile.chartCaptureQuality ? qualityProfile.chartCaptureQuality : 0.85,
          maxWidth: qualityProfile && qualityProfile.chartCaptureMaxW ? qualityProfile.chartCaptureMaxW : 960
        };
        var list = [];
        var img1 = captureChartForPdf(document.getElementById('report-chart-primary'), isEn ? 'Report Distribution' : 'توزيع بيانات التقرير', capOpts);
        var img2 = captureChartForPdf(document.getElementById('report-chart-secondary'), isEn ? 'Distribution by Company / Priority' : 'التوزيع حسب الشركة / الأولوية', capOpts);
        if (img1) list.push(img1);
        if (img2) list.push(img2);
        cachedChartImgs = list;
        return list;
      }

      async function resolveDataset() {
        if (!cachedRowsPromise) cachedRowsPromise = collectExportRows();
        var rows = await cachedRowsPromise;
        var extraSections = [];
        if (incFu && state.reportType !== 'followups_log') {
          if (!cachedFuPromise) {
            cachedFuPromise = root.RGApi.callApi('getTeamFollowUps', { employeeId: empFilterVal });
          }
          var fuRes = await cachedFuPromise;
          if (fuRes.success && Array.isArray(fuRes.data.items) && fuRes.data.items.length) {
            extraSections.push({
              title: (isEn ? 'Recent Follow-Ups (' : 'أحدث المتابعات المسجلة (') + Math.min(25, fuRes.data.items.length) + (isEn ? ' of ' : ' من ') + fuRes.data.items.length + ')',
              lines: fuRes.data.items.slice(0, 25).map(function (f) {
                var d = (core && core.formatDisplayDate) ? core.formatDisplayDate(f.followUpDate) : f.followUpDate;
                return d + ' | ' + f.reservationNumber + ' | ' + f.employeeName + ' [' + f.status + ']: ' + f.action + (incNotes && f.notes ? ' — ' + f.notes : '');
              })
            });
          }
        }
        return { rows: rows, extraSections: extraSections };
      }

      function computeHeadersForOrient(rows, orientVal) {
        var maxCols = orientVal === 'portrait' ? 7 : 9;
        var schemaCols = (core && core.getReportColumns)
          ? core.getReportColumns(state.reportType, rows)
          : RESERVATION_COLUMNS;
        var filtered = schemaCols.filter(function (c) {
          if (!incNotes && (c.key === 'notes' || c.key === 'lastUpdateText')) return false;
          return selectedColKeys.length ? selectedColKeys.indexOf(c.key) !== -1 : true;
        });
        return (filtered.length ? filtered : schemaCols.slice(0, 6)).slice(0, maxCols);
      }

      return {
        pdfTitle: pdfTitle,
        pdfFilename: pdfFilename,
        baseSettings: baseSettings,
        getContentStats: function (s) {
          var orient = (s && s.orientation) || baseSettings.orientation;
          var maxCols = orient === 'portrait' ? 7 : 9;
          return {
            rowCount: (state.rows || []).length,
            columnCount: Math.min(maxCols, selectedColKeys.length || 6),
            kpiCount: 2,
            wideSummaryCount: 0,
            extraSectionsCount: (incFu && state.reportType !== 'followups_log') ? 1 : 0,
            extraLinesCount: (incFu && state.reportType !== 'followups_log') ? 12 : 0,
            chartCount: incCharts ? 2 : 0
          };
        },
        generate: async function (liveSettings, signal, previewMode) {
          var s = Object.assign({}, baseSettings, liveSettings || {});
          var ds = await resolveDataset();
          throwIfAborted(signal);
          var headers = computeHeadersForOrient(ds.rows, s.orientation);
          var user = root.RGAuth.getUser();
          var qProf = (core && core.PDF_QUALITY_PROFILES && s.optimizeFileSize)
            ? (core.PDF_QUALITY_PROFILES[s.quality] || core.PDF_QUALITY_PROFILES.balanced)
            : (core && core.PDF_QUALITY_PROFILES ? core.PDF_QUALITY_PROFILES.unoptimized : null);
          var chartImgs = getCachedChartImages(qProf);

          return exportArabicPdfDocument({
            title: pdfTitle,
            paperSize: s.paperSize,
            orientation: s.orientation,
            targetPages: s.targetPages,
            preset: s.preset,
            optimizeFileSize: s.optimizeFileSize,
            quality: s.quality,
            lang: ctx.lang,
            exporterName: user ? user.name : '',
            summaryItems: [
              { label: isEn ? 'Report Type' : 'نوع التقرير', value: reportTitleAr },
              { label: isEn ? 'Records' : 'عدد السجلات', value: ds.rows.length }
            ],
            columns: headers,
            rows: ds.rows,
            extraSections: ds.extraSections,
            chartImages: chartImgs,
            filename: pdfFilename,
            signal: signal,
            previewOnly: Boolean(previewMode)
          });
        }
      };
    }

    var expPdfBtn = document.getElementById('exp-pdf-btn');
    expPdfBtn.addEventListener('click', function () {
      var snap = createReportPdfSnapshot();
      var runPdf = async function () {
        try {
          if (root.RGPdfPreview && typeof root.RGPdfPreview.open === 'function') {
            await root.RGPdfPreview.open({
              title: snap.pdfTitle,
              filename: snap.pdfFilename,
              initialSettings: snap.baseSettings,
              getContentStats: snap.getContentStats,
              generatePdf: function (liveSettings, signal) {
                return snap.generate(liveSettings, signal, true);
              },
              onSettingsChange: function (nextSettings) {
                if (pdfCtrl) pdfCtrl.setSettings(nextSettings, true);
              },
              onDownloadToast: function (meta) {
                var kb = Math.max(1, Math.round((meta.sizeBytes || 0) / 1024));
                ctx.toast(isEn
                  ? ('Downloaded PDF (' + meta.pages + ' pages · ' + kb + ' KB).')
                  : ('تم تحميل ملف PDF (' + meta.pages + ' صفحة · ' + kb + ' KB).'));
              }
            });
          } else {
            var pdfMeta = await snap.generate(snap.baseSettings, null, false);
            var kb = Math.max(1, Math.round((pdfMeta.sizeBytes || 0) / 1024));
            ctx.toast('تم تصدير PDF (' + pdfMeta.pages + ' صفحة · ' + kb + ' KB).');
            modalRoot.innerHTML = '';
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          ctx.toast((err && err.message) || 'تعذر تجهيز ملف PDF.', true);
        }
      };

      if (ctx.withActionLock) {
        ctx.withActionLock(expPdfBtn, 'reports:exportPdf', runPdf);
      } else {
        expPdfBtn.disabled = true;
        runPdf().finally(function () { expPdfBtn.disabled = false; });
      }
    });

    var expPdfDlBtn = document.getElementById('exp-pdf-download-btn');
    if (expPdfDlBtn) {
      expPdfDlBtn.addEventListener('click', function () {
        var snap = createReportPdfSnapshot();
        var runDirectDl = async function () {
          try {
            var pdfMeta = await snap.generate(snap.baseSettings, null, false);
            var kb = Math.max(1, Math.round((pdfMeta.sizeBytes || 0) / 1024));
            ctx.toast(isEn
              ? ('Exported PDF (' + pdfMeta.pages + ' pages · ' + kb + ' KB).')
              : ('تم تصدير ملف PDF (' + pdfMeta.pages + ' صفحة · ' + kb + ' KB).'));
            modalRoot.innerHTML = '';
          } catch (err) {
            ctx.toast((err && err.message) || 'تعذر تصدير ملف PDF.', true);
          }
        };
        if (ctx.withActionLock) {
          ctx.withActionLock(expPdfDlBtn, 'reports:downloadPdf', runDirectDl);
        } else {
          expPdfDlBtn.disabled = true;
          runDirectDl().finally(function () { expPdfDlBtn.disabled = false; });
        }
      });
    }
  }

  function refreshTheme() {
    var viewEl = document.querySelector('#page-content .route-view');
    if (viewEl && typeof viewEl._rgRefreshReportCharts === 'function') {
      viewEl._rgRefreshReportCharts();
    }
  }

  root.RGReports = {
    render: render,
    refreshTheme: refreshTheme,
    ensureXlsxLoaded: ensureXlsxLoaded,
    readExcelWorkbookRows: readExcelWorkbookRows,
    exportExcelWorkbook: exportExcelWorkbook,
    exportArabicPdfDocument: exportArabicPdfDocument,
    captureChartForPdf: captureChartForPdf,
    RESERVATION_COLUMNS: RESERVATION_COLUMNS
  };
})(window);
