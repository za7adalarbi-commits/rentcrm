/**
 * RENTAL GATE CRM — Real PDF Preview Modal with Live Density/Compression Controls, Debounced Regeneration & Exact-Blob Download
 */
(function (root) {
  'use strict';

  var ROOT_ID = 'rg-pdf-preview-root';
  var PRINT_SHEET_ID = 'rg-pdf-print-sheet';
  var activeSession = null;

  function core() {
    return root.RGCrmCore || null;
  }

  function getLang() {
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

  function ensureRoot() {
    var el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ROOT_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  function cleanupPrintSheet() {
    var sheet = document.getElementById(PRINT_SHEET_ID);
    if (sheet && sheet.parentNode) {
      sheet.parentNode.removeChild(sheet);
    }
    document.body.classList.remove('rg-printing-pdf');
  }

  function cancelPendingGeneration(session, reason) {
    if (!session) return;
    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = null;
    }
    if (session.abortController) {
      try { session.abortController.abort(reason || 'cancelled'); } catch (_e) {}
      session.abortController = null;
    }
  }

  function cleanupActiveResources(session) {
    if (!session) return;
    cancelPendingGeneration(session, 'closed');
    if (session.blobUrl) {
      try { URL.revokeObjectURL(session.blobUrl); } catch (_e) {}
      session.blobUrl = '';
    }
    if (session.resizeHandler) {
      window.removeEventListener('resize', session.resizeHandler);
      session.resizeHandler = null;
    }
    if (session.artifact) {
      session.artifact.pageImages = [];
      session.artifact.blob = null;
      session.artifact = null;
    }
    cleanupPrintSheet();
  }

  function closePreview() {
    if (!activeSession) return false;
    var session = activeSession;
    activeSession = null;

    var onClose = session.onClose;
    var restoreFocusEl = session.restoreFocusEl;
    cleanupActiveResources(session);

    var container = document.getElementById(ROOT_ID);
    if (container) container.innerHTML = '';

    if (restoreFocusEl && restoreFocusEl.isConnected) {
      try { restoreFocusEl.focus({ preventScroll: true }); } catch (_e) {}
    }
    if (typeof onClose === 'function') {
      try { onClose(); } catch (_e2) {}
    }
    return true;
  }

  function getPageBaseDimensions(artifact) {
    // Convert PDF mm to 96dpi base CSS pixels (1mm ~= 3.7795px)
    var wMm = Number((artifact && artifact.pageWidthMm) || 297);
    var hMm = Number((artifact && artifact.pageHeightMm) || 210);
    return {
      width: Math.round(wMm * 3.7795),
      height: Math.round(hMm * 3.7795)
    };
  }

  function applyZoomToPages(session) {
    if (!session || !session.stageEl || !session.artifact) return;
    var base = getPageBaseDimensions(session.artifact);
    var scale = session.zoomScale || 1;
    var w = Math.max(160, Math.round(base.width * scale));
    var h = Math.max(160, Math.round(base.height * scale));

    session.stageEl.querySelectorAll('.rg-pdf-page-card').forEach(function (card) {
      card.style.width = w + 'px';
      card.style.height = h + 'px';
    });

    if (session.zoomLabelEl) {
      session.zoomLabelEl.textContent = Math.round(scale * 100) + '%';
    }
    if (session.fitWidthBtn) {
      session.fitWidthBtn.classList.toggle('is-active', session.zoomMode === 'fit-width');
    }
    if (session.fitPageBtn) {
      session.fitPageBtn.classList.toggle('is-active', session.zoomMode === 'fit-page');
    }
  }

  function updatePageIndicator(session) {
    if (!session || !session.artifact) return;
    var total = Math.max(1, session.artifact.pages || (session.artifact.pageImages || []).length || 1);
    var c = core();
    var cur = (c && c.clampPdfPage) ? c.clampPdfPage(session.currentPage, total) : Math.max(1, Math.min(total, session.currentPage));
    session.currentPage = cur;

    if (session.pageInputEl) {
      session.pageInputEl.max = String(total);
      session.pageInputEl.value = String(cur);
    }
    if (session.totalPagesEl) {
      session.totalPagesEl.textContent = '/ ' + total;
    }
    if (session.prevPageBtn) {
      session.prevPageBtn.disabled = cur <= 1;
    }
    if (session.nextPageBtn) {
      session.nextPageBtn.disabled = cur >= total;
    }
    if (session.stageEl) {
      session.stageEl.querySelectorAll('.rg-pdf-page-card').forEach(function (card, idx) {
        card.classList.toggle('is-active-page', idx + 1 === cur);
      });
    }
  }

  function goToPage(session, targetPage, instant) {
    if (!session || !session.artifact || !session.stageEl) return;
    var total = Math.max(1, session.artifact.pages || (session.artifact.pageImages || []).length || 1);
    var c = core();
    var next = (c && c.clampPdfPage) ? c.clampPdfPage(targetPage, total) : Math.max(1, Math.min(total, Number(targetPage) || 1));
    session.currentPage = next;
    updatePageIndicator(session);

    var targetCard = session.stageEl.querySelector('.rg-pdf-page-card[data-page="' + next + '"]');
    if (targetCard && typeof targetCard.scrollIntoView === 'function') {
      session.isProgrammaticScroll = true;
      targetCard.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
      setTimeout(function () {
        if (activeSession === session) session.isProgrammaticScroll = false;
      }, 320);
    }
  }

  function syncCurrentPageFromScroll(session) {
    if (!session || !session.stageEl || session.isProgrammaticScroll) return;
    var stage = session.stageEl;
    var cards = Array.from(stage.querySelectorAll('.rg-pdf-page-card'));
    if (!cards.length) return;
    var stageRect = stage.getBoundingClientRect();
    var centerLine = stageRect.top + stageRect.height * 0.35;
    var bestPage = 1;
    var bestDist = Infinity;

    cards.forEach(function (card, idx) {
      var r = card.getBoundingClientRect();
      var dist = Math.abs(r.top - centerLine);
      if (r.top <= centerLine && r.bottom >= centerLine) {
        dist = 0;
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = idx + 1;
      }
    });

    if (bestPage !== session.currentPage) {
      session.currentPage = bestPage;
      updatePageIndicator(session);
    }
  }

  function runZoomAction(session, action) {
    if (!session || !session.artifact || !session.stageEl) return;
    var c = core();
    var base = getPageBaseDimensions(session.artifact);
    var rect = session.stageEl.getBoundingClientRect();
    var metrics = {
      viewportWidth: rect.width || 820,
      viewportHeight: rect.height || 580,
      pageWidth: base.width,
      pageHeight: base.height,
      padX: (rect.width || 820) <= 520 ? 24 : 44,
      padY: 40
    };
    var res = (c && c.computePdfZoom)
      ? c.computePdfZoom(action, session.zoomScale, metrics)
      : { scale: 1, mode: 'custom' };
    session.zoomScale = res.scale;
    session.zoomMode = res.mode;
    applyZoomToPages(session);
  }

  function downloadExactBlob(session) {
    if (!session || !session.artifact || !session.artifact.blob) return;
    if (session.blobUrl) {
      try { URL.revokeObjectURL(session.blobUrl); } catch (_e) {}
    }
    session.blobUrl = URL.createObjectURL(session.artifact.blob);
    var filename = session.artifact.filename || session.fallbackFilename || 'rental-gate-report.pdf';
    var a = document.createElement('a');
    a.href = session.blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 100);

    if (typeof session.onDownloadToast === 'function') {
      session.onDownloadToast(session.artifact);
    }
  }

  async function printExactPreviewPages(session) {
    if (!session || !session.artifact || !Array.isArray(session.artifact.pageImages) || !session.artifact.pageImages.length) {
      return;
    }
    if (session.isPrinting) return;
    session.isPrinting = true;
    if (session.printBtn) session.printBtn.disabled = true;

    try {
      cleanupPrintSheet();
      var sheet = document.createElement('div');
      sheet.id = PRINT_SHEET_ID;
      sheet.className = 'rg-pdf-print-sheet';

      var imgPromises = session.artifact.pageImages.map(function (src, idx) {
        var pageWrap = document.createElement('div');
        pageWrap.className = 'rg-pdf-print-page';
        var img = document.createElement('img');
        img.alt = 'PDF Page ' + (idx + 1);
        img.src = src;
        pageWrap.appendChild(img);
        sheet.appendChild(pageWrap);

        if (typeof img.decode === 'function') {
          return img.decode().catch(function () {});
        }
        return new Promise(function (resolve) {
          if (img.complete) resolve();
          else {
            img.onload = resolve;
            img.onerror = resolve;
          }
        });
      });

      document.body.appendChild(sheet);
      document.body.classList.add('rg-printing-pdf');
      await Promise.all(imgPromises);

      var cleanupTimer = setTimeout(cleanupPrintSheet, 60000);
      var onAfterPrint = function () {
        clearTimeout(cleanupTimer);
        window.removeEventListener('afterprint', onAfterPrint);
        cleanupPrintSheet();
      };
      window.addEventListener('afterprint', onAfterPrint);

      if (typeof window.print === 'function') {
        window.print();
      }
    } finally {
      session.isPrinting = false;
      if (session.printBtn && session.printBtn.isConnected) {
        session.printBtn.disabled = false;
      }
    }
  }

  function resolveSessionStats(session) {
    if (typeof session.getContentStats === 'function') {
      try {
        return session.getContentStats(session.settings) || {};
      } catch (_e) {
        return {};
      }
    }
    return session.contentStats || {};
  }

  function setRegeneratingUi(session, active) {
    if (!session || activeSession !== session) return;
    var banner = document.getElementById('rg-pdf-regen-banner');
    var stage = document.getElementById('rg-pdf-stage');
    if (banner) banner.classList.toggle('hidden', !active);
    if (stage) stage.classList.toggle('is-regenerating', Boolean(active));
  }

  function scheduleLiveRegeneration(session, delayMs) {
    if (!session || activeSession !== session) return;
    cancelPendingGeneration(session, 'superseded');
    session.debounceTimer = setTimeout(function () {
      session.debounceTimer = null;
      if (activeSession === session) {
        loadArtifactIntoSession(session, { isInitial: false });
      }
    }, typeof delayMs === 'number' ? delayMs : 280);
  }

  function renderPreviewShell(session) {
    var rootEl = ensureRoot();
    var lang = getLang();
    var isEn = lang === 'en';
    var titleText = session.title || (isEn ? 'PDF Document Preview' : 'معاينة مستند PDF');
    var isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 768;
    var showControls = Boolean(session.enableControls && root.RGPdfControls && root.RGPdfControls.renderPanelHtml);
    var controlsExpanded = showControls && !isMobileViewport;
    var controlsHtml = showControls
      ? root.RGPdfControls.renderPanelHtml({
          mode: 'preview',
          idPrefix: 'rg-pdfp-ctrl',
          lang: lang,
          settings: session.settings,
          contentStats: resolveSessionStats(session)
        })
      : '';

    rootEl.innerHTML =
      '<div class="rg-pdf-backdrop" id="rg-pdf-backdrop" role="dialog" aria-modal="true" aria-labelledby="rg-pdf-modal-title">' +
        '<div class="rg-pdf-modal">' +
          '<div class="rg-pdf-toolbar">' +
            '<div class="rg-pdf-title-group">' +
              '<div class="rg-pdf-icon-badge" aria-hidden="true">' +
                '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
              '</div>' +
              '<div class="rg-pdf-title-meta">' +
                '<h3 class="rg-pdf-title" id="rg-pdf-modal-title">' + esc(titleText) + '</h3>' +
                '<div class="rg-pdf-sub-meta" id="rg-pdf-sub-meta">' + esc(isEn ? 'Generating document preview...' : 'جاري تجهيز معاينة ملف PDF...') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="rg-pdf-controls-center" id="rg-pdf-controls-center"></div>' +
            '<div class="rg-pdf-actions-end">' +
              (showControls
                ? '<button type="button" class="btn btn-sm' + (controlsExpanded ? ' is-active' : '') + '" id="rg-pdf-toggle-ctrl-btn" aria-expanded="' + String(controlsExpanded) + '">' + (isEn ? 'Density & Size' : 'الضغط والحجم') + '</button>'
                : '') +
              '<button type="button" class="btn btn-sm" id="rg-pdf-print-btn" disabled>' + (isEn ? 'Print' : 'طباعة') + '</button>' +
              '<button type="button" class="btn btn-sm btn-primary" id="rg-pdf-download-btn" disabled>' + (isEn ? 'Download PDF' : 'تحميل PDF') + '</button>' +
              '<button type="button" class="btn btn-sm" id="rg-pdf-close-btn">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
            '</div>' +
          '</div>' +
          (showControls ? '<div class="rg-pdf-preview-ctrl-host' + (controlsExpanded ? '' : ' hidden') + '" id="rg-pdf-preview-ctrl-host">' + controlsHtml + '</div>' : '') +
          '<div class="rg-pdf-stage-wrap">' +
            '<div class="rg-pdf-regen-banner hidden" id="rg-pdf-regen-banner" role="status" aria-live="polite">' +
              '<span class="rg-pdf-regen-spinner" aria-hidden="true"></span>' +
              '<span>' + esc(isEn ? 'Updating PDF layout & optimization...' : 'جاري تحديث التخطيط وضغط الملف...') + '</span>' +
              '<button type="button" class="rg-pdf-regen-cancel" id="rg-pdf-cancel-regen">' + esc(isEn ? 'Cancel' : 'إلغاء') + '</button>' +
            '</div>' +
            '<div class="rg-pdf-stage" id="rg-pdf-stage">' +
              '<div class="rg-pdf-loading-state">' +
                '<div class="rg-pdf-spinner" aria-hidden="true"></div>' +
                '<div class="rg-pdf-loading-title">' + esc(isEn ? 'Preparing real PDF preview...' : 'جاري إنشاء صفحات التقرير ومعاينتها...') + '</div>' +
                '<div class="rg-pdf-loading-sub">' + esc(isEn ? 'The exact generated PDF will appear here before download.' : 'ستظهر هنا نفس النسخة الفعلية من ملف PDF قبل التحميل أو الطباعة.') + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var backdrop = document.getElementById('rg-pdf-backdrop');
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) {
        closePreview();
      }
    });
    document.getElementById('rg-pdf-close-btn').addEventListener('click', function () {
      closePreview();
    });

    var cancelRegenBtn = document.getElementById('rg-pdf-cancel-regen');
    if (cancelRegenBtn) {
      cancelRegenBtn.addEventListener('click', function () {
        cancelPendingGeneration(session, 'user-cancelled');
        session.isGenerating = false;
        setRegeneratingUi(session, false);
      });
    }

    var toggleCtrlBtn = document.getElementById('rg-pdf-toggle-ctrl-btn');
    var ctrlHost = document.getElementById('rg-pdf-preview-ctrl-host');
    if (toggleCtrlBtn && ctrlHost) {
      toggleCtrlBtn.addEventListener('click', function () {
        var nextHidden = !ctrlHost.classList.contains('hidden');
        ctrlHost.classList.toggle('hidden', nextHidden);
        toggleCtrlBtn.setAttribute('aria-expanded', String(!nextHidden));
        toggleCtrlBtn.classList.toggle('is-active', !nextHidden);
        if (session.artifact && (session.zoomMode === 'fit-width' || session.zoomMode === 'fit-page')) {
          runZoomAction(session, session.zoomMode);
        }
      });
    }

    session.downloadBtn = document.getElementById('rg-pdf-download-btn');
    session.printBtn = document.getElementById('rg-pdf-print-btn');
    if (session.downloadBtn) {
      session.downloadBtn.addEventListener('click', function () {
        downloadExactBlob(session);
      });
    }
    if (session.printBtn) {
      session.printBtn.addEventListener('click', function () {
        printExactPreviewPages(session);
      });
    }

    if (showControls && ctrlHost) {
      var panelEl = ctrlHost.querySelector('.rg-pdf-ctrl-panel');
      if (panelEl) {
        session.ctrl = root.RGPdfControls.mount(panelEl, {
          lang: lang,
          initialSettings: session.settings,
          contentStats: resolveSessionStats(session),
          onChange: function (nextSettings, _plan, triggerKind) {
            session.settings = nextSettings;
            if (session.ctrl && typeof session.getContentStats === 'function') {
              session.ctrl.setContentStats(resolveSessionStats(session));
            }
            if (typeof session.onSettingsChange === 'function') {
              try { session.onSettingsChange(Object.assign({}, nextSettings)); } catch (_e) {}
            }
            var waitMs = triggerKind === 'slider-input' ? 280 : 150;
            scheduleLiveRegeneration(session, waitMs);
          }
        });
      }
    }

    session.shellRendered = true;
  }

  function renderErrorState(session, errMsg) {
    if (activeSession !== session) return;
    setRegeneratingUi(session, false);
    var stage = document.getElementById('rg-pdf-stage');
    var subMeta = document.getElementById('rg-pdf-sub-meta');
    var lang = getLang();
    var isEn = lang === 'en';
    if (subMeta) subMeta.textContent = isEn ? 'Preview failed' : 'تعذر إنشاء المعاينة';
    if (!stage) return;

    stage.innerHTML =
      '<div class="rg-pdf-error-state">' +
        '<div class="rg-pdf-error-icon" aria-hidden="true">!</div>' +
        '<div class="rg-pdf-loading-title">' + esc(isEn ? 'Could not generate PDF preview' : 'تعذر تجهيز معاينة ملف PDF') + '</div>' +
        '<div class="rg-pdf-loading-sub">' + esc(errMsg || (isEn ? 'An unexpected error occurred.' : 'حدث خطأ غير متوقع أثناء إنشاء الملف.')) + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:6px;">' +
          '<button type="button" class="btn btn-sm btn-primary" id="rg-pdf-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
          '<button type="button" class="btn btn-sm" id="rg-pdf-err-close-btn">' + (isEn ? 'Close' : 'إغلاق') + '</button>' +
        '</div>' +
      '</div>';

    var retryBtn = document.getElementById('rg-pdf-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        loadArtifactIntoSession(session, { isInitial: true });
      });
    }
    var errCloseBtn = document.getElementById('rg-pdf-err-close-btn');
    if (errCloseBtn) {
      errCloseBtn.addEventListener('click', closePreview);
    }
  }

  function renderLoadedArtifact(session, artifact, isRegen) {
    if (activeSession !== session) return;

    if (session.blobUrl) {
      try { URL.revokeObjectURL(session.blobUrl); } catch (_e) {}
      session.blobUrl = '';
    }
    session.artifact = artifact;
    session.isGenerating = false;
    setRegeneratingUi(session, false);

    var lang = getLang();
    var isEn = lang === 'en';
    var totalPages = Math.max(1, Number(artifact.pages || (artifact.pageImages && artifact.pageImages.length) || 1));
    var kb = Math.max(1, Math.round(Number(artifact.sizeBytes || 0) / 1024));
    var pagesUnit = isEn ? (totalPages === 1 ? 'page' : 'pages') : 'صفحة';
    var paperInfo = String(artifact.paperSize || 'A4').toUpperCase() + ' · ' +
      (artifact.orientation === 'portrait' ? (isEn ? 'Portrait' : 'عمودي') : (isEn ? 'Landscape' : 'أفقي'));

    var subMeta = document.getElementById('rg-pdf-sub-meta');
    if (subMeta) {
      subMeta.innerHTML =
        '<span class="mono" dir="ltr">' + esc(artifact.filename || 'report.pdf') + '</span>' +
        '<span>·</span>' +
        '<span class="tabular-nums">' + totalPages + ' ' + pagesUnit + '</span>' +
        '<span>·</span>' +
        '<span class="mono tabular-nums" dir="ltr">' + kb + ' KB</span>' +
        '<span>·</span>' +
        '<span>' + esc(paperInfo) + '</span>';
    }

    if (session.ctrl) {
      session.ctrl.setActualMeta({
        pages: totalPages,
        sizeBytes: artifact.sizeBytes,
        readabilityWarning: Boolean(artifact.readabilityWarning),
        warningMessage: artifact.warningMessage || ''
      });
    }

    var isRtlDoc = document.documentElement.getAttribute('dir') !== 'ltr';
    var prevPts = isRtlDoc ? '9 18 15 12 9 6' : '15 18 9 12 15 6';
    var nextPts = isRtlDoc ? '15 18 9 12 15 6' : '9 18 15 12 9 6';
    var centerEl = document.getElementById('rg-pdf-controls-center');
    if (centerEl) {
      centerEl.innerHTML =
        '<div class="rg-pdf-ctrl-group" role="group" aria-label="' + (isEn ? 'Page navigation' : 'التنقل بين الصفحات') + '">' +
          '<button type="button" class="rg-pdf-tool-btn" id="rg-pdf-prev-page" title="' + (isEn ? 'Previous page' : 'الصفحة السابقة') + '" aria-label="' + (isEn ? 'Previous page' : 'الصفحة السابقة') + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="' + prevPts + '"/></svg>' +
          '</button>' +
          '<div class="rg-pdf-page-readout">' +
            '<input type="number" class="rg-pdf-page-input mono tabular-nums" id="rg-pdf-page-input" min="1" max="' + totalPages + '" value="1" aria-label="' + (isEn ? 'Current page' : 'رقم الصفحة') + '">' +
            '<span class="rg-pdf-page-total mono tabular-nums" id="rg-pdf-total-pages">/ ' + totalPages + '</span>' +
          '</div>' +
          '<button type="button" class="rg-pdf-tool-btn" id="rg-pdf-next-page" title="' + (isEn ? 'Next page' : 'الصفحة التالية') + '" aria-label="' + (isEn ? 'Next page' : 'الصفحة التالية') + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="' + nextPts + '"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="rg-pdf-ctrl-group" role="group" aria-label="' + (isEn ? 'Zoom controls' : 'التكبير والتصغير') + '">' +
          '<button type="button" class="rg-pdf-tool-btn" id="rg-pdf-zoom-out" title="' + (isEn ? 'Zoom out' : 'تصغير') + '" aria-label="' + (isEn ? 'Zoom out' : 'تصغير') + '">−</button>' +
          '<button type="button" class="rg-pdf-zoom-readout mono tabular-nums" id="rg-pdf-zoom-reset" title="' + (isEn ? 'Reset zoom to 100%' : 'إعادة الحجم إلى 100%') + '">100%</button>' +
          '<button type="button" class="rg-pdf-tool-btn" id="rg-pdf-zoom-in" title="' + (isEn ? 'Zoom in' : 'تكبير') + '" aria-label="' + (isEn ? 'Zoom in' : 'تكبير') + '">+</button>' +
          '<button type="button" class="rg-pdf-tool-pill" id="rg-pdf-fit-width">' + (isEn ? 'Fit Width' : 'ملاءمة العرض') + '</button>' +
          '<button type="button" class="rg-pdf-tool-pill" id="rg-pdf-fit-page">' + (isEn ? 'Fit Page' : 'ملاءمة الصفحة') + '</button>' +
        '</div>';
    }

    var stageEl = document.getElementById('rg-pdf-stage');
    var prevScrollTop = isRegen && stageEl ? stageEl.scrollTop : 0;
    var pageImages = Array.isArray(artifact.pageImages) ? artifact.pageImages : [];
    if (stageEl) {
      stageEl.innerHTML =
        '<div class="rg-pdf-pages-column">' +
          pageImages.map(function (dataUrl, idx) {
            var pNum = idx + 1;
            return '<div class="rg-pdf-page-card" data-page="' + pNum + '">' +
              '<img src="' + dataUrl + '" alt="' + esc((isEn ? 'Page ' : 'صفحة ') + pNum) + '" draggable="false" />' +
              '<span class="rg-pdf-page-badge mono tabular-nums">' + pNum + ' / ' + totalPages + '</span>' +
            '</div>';
          }).join('') +
        '</div>';
    }

    session.stageEl = stageEl;
    session.prevPageBtn = document.getElementById('rg-pdf-prev-page');
    session.nextPageBtn = document.getElementById('rg-pdf-next-page');
    session.pageInputEl = document.getElementById('rg-pdf-page-input');
    session.totalPagesEl = document.getElementById('rg-pdf-total-pages');
    session.zoomLabelEl = document.getElementById('rg-pdf-zoom-reset');
    session.fitWidthBtn = document.getElementById('rg-pdf-fit-width');
    session.fitPageBtn = document.getElementById('rg-pdf-fit-page');

    if (session.downloadBtn) session.downloadBtn.disabled = false;
    if (session.printBtn) session.printBtn.disabled = false;

    if (session.prevPageBtn) {
      session.prevPageBtn.addEventListener('click', function () {
        goToPage(session, session.currentPage - 1);
      });
    }
    if (session.nextPageBtn) {
      session.nextPageBtn.addEventListener('click', function () {
        goToPage(session, session.currentPage + 1);
      });
    }
    if (session.pageInputEl) {
      session.pageInputEl.addEventListener('change', function () {
        goToPage(session, session.pageInputEl.value);
      });
      session.pageInputEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          goToPage(session, session.pageInputEl.value);
        }
      });
    }

    var zoomInBtn = document.getElementById('rg-pdf-zoom-in');
    var zoomOutBtn = document.getElementById('rg-pdf-zoom-out');
    if (zoomInBtn) zoomInBtn.addEventListener('click', function () { runZoomAction(session, 'in'); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { runZoomAction(session, 'out'); });
    if (session.zoomLabelEl) session.zoomLabelEl.addEventListener('click', function () { runZoomAction(session, 'reset'); });
    if (session.fitWidthBtn) session.fitWidthBtn.addEventListener('click', function () { runZoomAction(session, 'fit-width'); });
    if (session.fitPageBtn) session.fitPageBtn.addEventListener('click', function () { runZoomAction(session, 'fit-page'); });

    if (stageEl && !stageEl._rgScrollBound) {
      stageEl._rgScrollBound = true;
      stageEl.addEventListener('scroll', function () {
        syncCurrentPageFromScroll(session);
      }, { passive: true });
    }

    if (!isRegen || session.zoomMode === 'fit-width' || session.zoomMode === 'fit-page') {
      if (!isRegen) {
        var base = getPageBaseDimensions(artifact);
        var stageRect = stageEl ? stageEl.getBoundingClientRect() : { width: 880, height: 600 };
        var stageW = stageRect.width || 880;
        var padFit = stageW <= 520 ? 24 : 48;
        var fitScale = Math.min(1.05, Math.max(0.25, (stageW - padFit) / Math.max(1, base.width)));
        session.zoomScale = Math.round(fitScale * 100) / 100;
        session.zoomMode = 'fit-width';
        session.currentPage = 1;
      } else {
        runZoomAction(session, session.zoomMode);
      }
    }

    applyZoomToPages(session);
    updatePageIndicator(session);

    if (isRegen && stageEl && prevScrollTop > 0) {
      stageEl.scrollTop = Math.min(prevScrollTop, Math.max(0, stageEl.scrollHeight - stageEl.clientHeight));
    }

    if (!session.resizeHandler) {
      session.resizeHandler = function () {
        if (activeSession === session && (session.zoomMode === 'fit-width' || session.zoomMode === 'fit-page')) {
          runZoomAction(session, session.zoomMode);
        }
      };
      window.addEventListener('resize', session.resizeHandler);
    }
  }

  async function loadArtifactIntoSession(session, opts) {
    if (activeSession !== session) return;
    var isInitial = Boolean(opts && opts.isInitial);
    var hasExisting = Boolean(session.artifact && session.artifact.pageImages && session.artifact.pageImages.length);
    var seq = ++session.generationSeq;

    if (session.abortController) {
      try { session.abortController.abort('superseded'); } catch (_e) {}
    }
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    session.abortController = ac;
    session.isGenerating = true;

    if (!session.shellRendered) {
      renderPreviewShell(session);
    } else if (isInitial || !hasExisting) {
      var stageEl = document.getElementById('rg-pdf-stage');
      var isEn = getLang() === 'en';
      if (stageEl) {
        stageEl.innerHTML =
          '<div class="rg-pdf-loading-state">' +
            '<div class="rg-pdf-spinner" aria-hidden="true"></div>' +
            '<div class="rg-pdf-loading-title">' + esc(isEn ? 'Preparing real PDF preview...' : 'جاري إنشاء صفحات التقرير ومعاينتها...') + '</div>' +
            '<div class="rg-pdf-loading-sub">' + esc(isEn ? 'The exact generated PDF will appear here before download.' : 'ستظهر هنا نفس النسخة الفعلية من ملف PDF قبل التحميل أو الطباعة.') + '</div>' +
          '</div>';
      }
    } else {
      setRegeneratingUi(session, true);
    }

    try {
      var liveSettings = Object.assign({}, session.settings || {});
      var artifact = await session.generatePdf(liveSettings, ac ? ac.signal : null);
      if (activeSession !== session || seq !== session.generationSeq) {
        if (artifact) {
          artifact.pageImages = [];
          artifact.blob = null;
        }
        return;
      }
      if (!artifact || !artifact.blob || !Array.isArray(artifact.pageImages) || !artifact.pageImages.length) {
        throw new Error(getLang() === 'en' ? 'Generated PDF has no pages.' : 'ملف PDF المُنشأ لا يحتوي على صفحات.');
      }
      renderLoadedArtifact(session, artifact, hasExisting && !isInitial);
    } catch (err) {
      if (activeSession !== session || seq !== session.generationSeq) return;
      session.isGenerating = false;
      setRegeneratingUi(session, false);
      if (err && err.name === 'AbortError') {
        return;
      }
      if (hasExisting && !isInitial) {
        // Keep previous preview visible if regeneration fails unexpectedly
        return;
      }
      renderErrorState(session, (err && err.message) || '');
    }
  }

  function open(config) {
    var cfg = config || {};
    if (typeof cfg.generatePdf !== 'function') {
      return Promise.reject(new Error('generatePdf callback is required'));
    }
    if (activeSession) {
      closePreview();
    }

    var initSettings = (root.RGPdfControls && root.RGPdfControls.createDefaultState)
      ? root.RGPdfControls.createDefaultState(cfg.initialSettings)
      : Object.assign({
          targetPages: 3,
          preset: 'balanced',
          optimizeFileSize: true,
          quality: 'balanced',
          paperSize: 'a4',
          orientation: 'landscape'
        }, cfg.initialSettings || {});

    var session = {
      title: cfg.title || '',
      fallbackFilename: cfg.filename || 'rental-gate-report.pdf',
      generatePdf: cfg.generatePdf,
      getContentStats: cfg.getContentStats || null,
      contentStats: cfg.contentStats || {},
      onSettingsChange: cfg.onSettingsChange || null,
      onDownloadToast: cfg.onDownloadToast || null,
      onClose: cfg.onClose || null,
      enableControls: cfg.enableControls !== false,
      settings: initSettings,
      restoreFocusEl: document.activeElement,
      shellRendered: false,
      isGenerating: true,
      isPrinting: false,
      generationSeq: 0,
      debounceTimer: null,
      abortController: null,
      ctrl: null,
      currentPage: 1,
      zoomScale: 1,
      zoomMode: 'fit-width',
      blobUrl: '',
      artifact: null
    };

    activeSession = session;
    return loadArtifactIntoSession(session, { isInitial: true });
  }

  document.addEventListener('keydown', function (ev) {
    if (!activeSession) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePreview();
      return;
    }
    if (activeSession.isGenerating) return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/i.test(ev.target.tagName)) return;
    var isRtlDoc = document.documentElement.getAttribute('dir') !== 'ltr';
    if (ev.key === 'PageDown') {
      ev.preventDefault();
      goToPage(activeSession, activeSession.currentPage + 1);
    } else if (ev.key === 'PageUp') {
      ev.preventDefault();
      goToPage(activeSession, activeSession.currentPage - 1);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      goToPage(activeSession, activeSession.currentPage + (isRtlDoc ? -1 : 1));
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      goToPage(activeSession, activeSession.currentPage + (isRtlDoc ? 1 : -1));
    } else if (ev.key === '+' || ev.key === '=') {
      ev.preventDefault();
      runZoomAction(activeSession, 'in');
    } else if (ev.key === '-' || ev.key === '_') {
      ev.preventDefault();
      runZoomAction(activeSession, 'out');
    } else if (ev.key === '0') {
      ev.preventDefault();
      runZoomAction(activeSession, 'reset');
    }
  });

  root.RGPdfPreview = {
    open: open,
    close: closePreview,
    isOpen: function () { return Boolean(activeSession); }
  };
})(window);
