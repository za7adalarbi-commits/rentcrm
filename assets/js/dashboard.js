/**
 * RENTAL GATE CRM — Royal Red Glassmorphism Bento Dashboard, Animated Hero KPIs & Progressive Interactive Chart.js Visualizations
 */
(function (root) {
  'use strict';

  var chartInstances = {};
  var animatedOnce = {};
  var pendingChartConfigs = {};
  var chartObserver = null;
  var dashLoadSeq = 0;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveTimeFormat(explicitTf) {
    if (explicitTf === '12h' || explicitTf === '24h') return explicitTf;
    if (root.RGApp && typeof root.RGApp.getTimeFormat === 'function') {
      return root.RGApp.getTimeFormat();
    }
    return (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-time-format') === '12h')
      ? '12h'
      : '24h';
  }

  function fmtTime(val, lang, timeFormat) {
    var tf = resolveTimeFormat(timeFormat);
    var core = root.RGCrmCore;
    if (core && typeof core.formatTimePreference === 'function') {
      return core.formatTimePreference(val, tf, lang === 'en' ? 'en' : 'ar');
    }
    var s = String(val || '').trim();
    return s.length >= 5 ? s.substring(0, 5) : s;
  }

  function fmtCompactHeatmapHour(h, isEn, timeFormat) {
    var tf = resolveTimeFormat(timeFormat);
    if (tf !== '12h') return (h < 10 ? '0' : '') + h;
    var h12 = h % 12 === 0 ? 12 : (h % 12);
    return String(h12) + (isEn ? (h < 12 ? 'a' : 'p') : (h < 12 ? 'ص' : 'م'));
  }

  function prefersReducedMotion() {
    try {
      return Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function disconnectObserver() {
    if (chartObserver) {
      try { chartObserver.disconnect(); } catch (e) {}
      chartObserver = null;
    }
    pendingChartConfigs = {};
  }

  function destroyCharts() {
    disconnectObserver();
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.rg-dash-drag-card').forEach(function (g) {
        if (g && g.parentNode) g.parentNode.removeChild(g);
      });
      if (document.body) document.body.style.userSelect = '';
    }
    Object.keys(chartInstances).forEach(function (k) {
      if (chartInstances[k]) {
        chartInstances[k].destroy();
        delete chartInstances[k];
      }
    });
    animatedOnce = {};
  }

  function themeColors() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      isDark: isDark,
      text: isDark ? '#E5E7EB' : '#292929',
      muted: isDark ? '#9CA3AF' : '#686868',
      grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(41, 41, 41, 0.08)',
      surfaceBorder: isDark ? '#1E1E21' : '#FFFFFF',
      tooltipBg: isDark ? 'rgba(24, 24, 27, 0.96)' : 'rgba(41, 41, 41, 0.96)',
      tooltipBorder: 'rgba(217, 31, 43, 0.45)',
      royalRed: '#D91F2B',
      royalRedHover: '#B81722',
      royalRedDeep: '#99131C',
      charcoal: '#292929',
      secondaryGray: '#8A8A8A',
      emerald: '#10B981',
      cyan: '#06B6D4',
      sapphire: '#2563EB',
      violet: '#7C3AED',
      amber: '#D97706',
      palette: ['#D91F2B', isDark ? '#64748B' : '#292929', '#10B981', '#2563EB', '#D97706', '#7C3AED', '#06B6D4', '#8A8A8A']
    };
  }

  function makeVerticalGradient(canvasId, topColor, bottomColor) {
    var el = document.getElementById(canvasId);
    if (!el) return topColor;
    var ctx2d = el.getContext('2d');
    if (!ctx2d || typeof ctx2d.createLinearGradient !== 'function') return topColor;
    var g = ctx2d.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, topColor);
    g.addColorStop(1, bottomColor);
    return g;
  }

  function makeHorizontalGradient(canvasId, startColor, endColor) {
    var el = document.getElementById(canvasId);
    if (!el) return startColor;
    var ctx2d = el.getContext('2d');
    if (!ctx2d || typeof ctx2d.createLinearGradient !== 'function') return startColor;
    var g = ctx2d.createLinearGradient(0, 0, 420, 0);
    g.addColorStop(0, startColor);
    g.addColorStop(1, endColor);
    return g;
  }

  /* Custom Donut Center Summary Plugin (renders Total + Subtitle inside cutout) */
  function createDonutCenterPlugin(subtitleLabel) {
    return {
      id: 'rgDonutCenter',
      afterDraw: function (chart) {
        if (!chart || chart.config.type !== 'doughnut') return;
        var meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data.length) return;
        var ctx2d = chart.ctx;
        var area = chart.chartArea;
        if (!area) return;

        var total = 0;
        var dataArr = (chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data) || [];
        for (var i = 0; i < dataArr.length; i++) {
          var isVisible = typeof chart.getDataVisibility === 'function' ? chart.getDataVisibility(i) : true;
          if (isVisible) total += Number(dataArr[i] || 0);
        }

        var cx = (area.left + area.right) / 2;
        var cy = (area.top + area.bottom) / 2;
        var isDark = !chart._rgPdfLightMode && document.documentElement.getAttribute('data-theme') === 'dark';

        ctx2d.save();
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillStyle = isDark ? '#FFFFFF' : '#292929';
        ctx2d.font = "700 24px 'IBM Plex Sans Arabic', 'Plus Jakarta Sans', sans-serif";
        ctx2d.fillText(String(total), cx, cy - 8);

        ctx2d.fillStyle = isDark ? '#9CA3AF' : '#686868';
        ctx2d.font = "600 11px 'IBM Plex Sans Arabic', 'Plus Jakarta Sans', sans-serif";
        ctx2d.fillText(subtitleLabel || 'الإجمالي', cx, cy + 14);
        ctx2d.restore();
      }
    };
  }

  function makePctTooltipCallbacks(isDonut) {
    return {
      label: function (ctx) {
        var dataArr = (ctx.dataset && Array.isArray(ctx.dataset.data)) ? ctx.dataset.data : [];
        var sum = dataArr.reduce(function (acc, val) { return acc + Math.max(0, Number(val || 0)); }, 0);
        var val = Number(ctx.raw !== undefined ? ctx.raw : (ctx.parsed && ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed));
        var pct = sum > 0 ? Math.round((val / sum) * 100) : 0;
        var label = isDonut ? (ctx.label || '') : (ctx.dataset.label || ctx.label || '');
        return ' ' + (label ? label + ': ' : '') + val + ' (' + pct + '%)';
      }
    };
  }

  function ensureObserver() {
    if (chartObserver || typeof root.IntersectionObserver !== 'function') return chartObserver;
    chartObserver = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var cid = el && el.id;
        if (!cid || !pendingChartConfigs[cid]) return;
        var item = pendingChartConfigs[cid];
        delete pendingChartConfigs[cid];
        try { chartObserver.unobserve(el); } catch (e) {}
        mountChartNow(cid, item.config, item.plugins);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -20px 0px' });
    return chartObserver;
  }

  function mountChartNow(canvasId, config, plugins) {
    var el = document.getElementById(canvasId);
    if (!el || !root.Chart) return;
    var existing = chartInstances[canvasId];
    if (existing) {
      existing.destroy();
      delete chartInstances[canvasId];
    }
    var chartConfig = Object.assign({}, config);
    if (Array.isArray(plugins) && plugins.length) {
      chartConfig.plugins = plugins;
    }
    chartInstances[canvasId] = new root.Chart(el.getContext('2d'), chartConfig);
    animatedOnce[canvasId] = true;
  }

  function upsertChart(canvasId, config, opts) {
    var el = document.getElementById(canvasId);
    if (!el || !root.Chart) return;
    var o = opts || {};
    var reduced = prefersReducedMotion();
    var existing = chartInstances[canvasId];

    if (existing && existing.canvas === el) {
      existing.data = config.data;
      existing.options = Object.assign({}, config.options, {
        animation: (reduced || o.instant) ? false : { duration: 380, easing: 'easeOutQuart' }
      });
      existing.update((reduced || o.instant) ? 'none' : undefined);
      return;
    }

    if (reduced || animatedOnce[canvasId] || typeof root.IntersectionObserver !== 'function') {
      if (reduced && config.options) {
        config.options = Object.assign({}, config.options, { animation: false });
      }
      mountChartNow(canvasId, config, o.plugins);
      return;
    }

    // Immediate mount if already visible inside current viewport
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var vh = root.innerHeight || document.documentElement.clientHeight || 900;
    if (rect && rect.top < vh * 0.96 && rect.bottom > 0) {
      mountChartNow(canvasId, config, o.plugins);
      return;
    }

    pendingChartConfigs[canvasId] = { config: config, plugins: o.plugins };
    var obs = ensureObserver();
    if (obs) {
      obs.observe(el);
    } else {
      mountChartNow(canvasId, config, o.plugins);
    }
  }

  function navigateWithFilter(routeId, patchState) {
    if (patchState && typeof patchState === 'function') {
      patchState();
    }
    var navBtn = document.querySelector('.nav-item[data-route="' + routeId + '"]');
    if (navBtn) navBtn.click();
  }

  function destroyChartById(cid) {
    if (pendingChartConfigs[cid]) delete pendingChartConfigs[cid];
    if (chartInstances[cid]) {
      try { chartInstances[cid].destroy(); } catch (e) {}
      delete chartInstances[cid];
    }
  }

  function renderCharts(chartsData, t, ctx, isUpdate, instantUpdate) {
    if (!root.Chart) {
      if (typeof root.RGEnsureChartLoaded === 'function') {
        root.RGEnsureChartLoaded().then(function () {
          if (document.getElementById('chart-daily-followups') || document.getElementById('dash-charts-grid')) {
            renderCharts(chartsData, t, ctx, isUpdate, instantUpdate);
          }
        }).catch(function () {});
      }
      return;
    }
    var c = themeColors();
    var reduced = prefersReducedMotion();
    var isEn = ctx && ctx.lang === 'en';
    var fontDef = { family: "'IBM Plex Sans Arabic', 'Plus Jakarta Sans', sans-serif", size: 11.5 };

    var basePlugins = {
      legend: {
        labels: {
          color: c.text,
          font: fontDef,
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 8,
          padding: 14
        }
      },
      tooltip: {
        backgroundColor: c.tooltipBg,
        titleColor: '#FFFFFF',
        bodyColor: '#F3F4F6',
        borderColor: c.tooltipBorder,
        borderWidth: 1,
        padding: 11,
        cornerRadius: 11,
        titleFont: Object.assign({}, fontDef, { weight: '700' }),
        bodyFont: fontDef
      }
    };

    // 1. Progressive Spline Line Chart — Daily Follow-Ups (#D91F2B Royal Red)
    var dailyCanvas = document.getElementById('chart-daily-followups');
    if (dailyCanvas) {
      var daily = chartsData.dailyFollowUps || {};
      var dailyKeys = Object.keys(daily).sort();
      upsertChart('chart-daily-followups', {
      type: 'line',
      data: {
        labels: dailyKeys,
        datasets: [{
          label: t('daily_followups'),
          data: dailyKeys.map(function (k) { return daily[k]; }),
          borderColor: makeHorizontalGradient('chart-daily-followups', '#D91F2B', '#99131C'),
          backgroundColor: makeVerticalGradient('chart-daily-followups', 'rgba(217, 31, 43, 0.24)', 'rgba(217, 31, 43, 0.01)'),
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#D91F2B',
          pointBorderColor: c.surfaceBorder,
          pointBorderWidth: 2,
          pointHoverBackgroundColor: '#FFFFFF',
          pointHoverBorderColor: '#D91F2B',
          pointHoverBorderWidth: 2.5,
          fill: true,
          tension: 0.38
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: reduced ? false : {
          duration: 850,
          easing: 'easeOutQuart',
          delay: function (context) {
            return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 32 : 0;
          }
        },
        plugins: basePlugins,
        scales: {
          x: { ticks: { color: c.muted, font: fontDef }, grid: { color: c.grid } },
          y: { ticks: { color: c.muted, precision: 0, font: fontDef }, grid: { color: c.grid }, beginAtZero: true, grace: '15%' }
        }
      }
    }, { isUpdate: isUpdate, instant: instantUpdate });
    } else {
      destroyChartById('chart-daily-followups');
    }

    if (!document.getElementById('chart-status-dist')) {
      ['chart-status-dist', 'chart-emp-perf', 'chart-problems-priority', 'chart-problems-open-closed', 'chart-res-company', 'chart-emp-comparison'].forEach(destroyChartById);
      return;
    }

    // 2. Interactive Donut Chart — Reservation Status Distribution (with Center Total + % Tooltip + Click-to-Filter)
    var stDist = chartsData.statusDistribution || {};
    var stLabels = Object.keys(stDist);
    upsertChart('chart-status-dist', {
      type: 'doughnut',
      data: {
        labels: stLabels,
        datasets: [{
          data: Object.values(stDist),
          backgroundColor: c.palette,
          borderColor: c.surfaceBorder,
          borderWidth: 2.5,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        animation: reduced ? false : { animateRotate: true, animateScale: true, duration: 820, easing: 'easeOutQuart' },
        onHover: function (ev, els) {
          if (ev && ev.native && ev.native.target) {
            ev.native.target.style.cursor = els && els.length ? 'pointer' : 'default';
          }
        },
        onClick: function (_ev, els) {
          if (!els || !els.length) return;
          var clickedStatus = stLabels[els[0].index];
          if (!clickedStatus) return;
          navigateWithFilter('reservations', function () {
            ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { status: clickedStatus, page: 1 });
          });
        },
        plugins: {
          legend: Object.assign({}, basePlugins.legend, { position: 'bottom' }),
          tooltip: Object.assign({}, basePlugins.tooltip, { callbacks: makePctTooltipCallbacks(true) })
        }
      }
    }, {
      isUpdate: isUpdate,
      instant: instantUpdate,
      plugins: [createDonutCenterPlugin(isEn ? 'Total' : 'الإجمالي')]
    });

    // 3. Staggered Bar Chart — Employee Performance (#D91F2B -> #99131C Gradient)
    var empPerf = chartsData.employeePerformance || {};
    upsertChart('chart-emp-perf', {
      type: 'bar',
      data: {
        labels: Object.keys(empPerf),
        datasets: [{
          label: t('followups_count'),
          data: Object.values(empPerf),
          backgroundColor: makeVerticalGradient('chart-emp-perf', '#D91F2B', 'rgba(153, 19, 28, 0.72)'),
          hoverBackgroundColor: '#B81722',
          borderRadius: 9,
          borderSkipped: false,
          maxBarThickness: 40
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced ? false : {
          duration: 680,
          easing: 'easeOutQuart',
          delay: function (context) {
            return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 75 : 0;
          }
        },
        plugins: {
          legend: basePlugins.legend,
          tooltip: Object.assign({}, basePlugins.tooltip, { callbacks: makePctTooltipCallbacks(false) })
        },
        scales: {
          x: { ticks: { color: c.text, font: fontDef }, grid: { display: false } },
          y: { ticks: { color: c.muted, precision: 0, font: fontDef }, grid: { color: c.grid }, beginAtZero: true, grace: '15%' }
        }
      }
    }, { isUpdate: isUpdate, instant: instantUpdate });

    // 4. Staggered Semantic Bar Chart — Problems by Priority (Click-to-Filter)
    var prbPrio = chartsData.problemsByPriority || {};
    var prioLabels = Object.keys(prbPrio);
    var prioColors = prioLabels.map(function (lbl) {
      if (lbl === 'مرتفع' || lbl === 'مرتفعة' || lbl === 'عاجلة') return c.royalRed;
      if (lbl === 'متوسط' || lbl === 'متوسطة') return c.amber;
      return c.secondaryGray;
    });
    upsertChart('chart-problems-priority', {
      type: 'bar',
      data: {
        labels: prioLabels,
        datasets: [{
          label: t('problems'),
          data: Object.values(prbPrio),
          backgroundColor: prioColors,
          borderRadius: 9,
          borderSkipped: false,
          maxBarThickness: 42
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced ? false : {
          duration: 680,
          easing: 'easeOutQuart',
          delay: function (context) {
            return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 90 : 0;
          }
        },
        onHover: function (ev, els) {
          if (ev && ev.native && ev.native.target) {
            ev.native.target.style.cursor = els && els.length ? 'pointer' : 'default';
          }
        },
        onClick: function (_ev, els) {
          if (!els || !els.length) return;
          var clickedPrio = prioLabels[els[0].index];
          if (!clickedPrio) return;
          navigateWithFilter('problems', function () {
            ctx.state.problems = Object.assign(ctx.state.problems || {}, { priority: clickedPrio, status: '' });
          });
        },
        plugins: {
          legend: basePlugins.legend,
          tooltip: Object.assign({}, basePlugins.tooltip, { callbacks: makePctTooltipCallbacks(false) })
        },
        scales: {
          x: { ticks: { color: c.text, font: fontDef }, grid: { display: false } },
          y: { ticks: { color: c.muted, precision: 0, font: fontDef }, grid: { color: c.grid }, beginAtZero: true, grace: '15%' }
        }
      }
    }, { isUpdate: isUpdate, instant: instantUpdate });

    // 5. Donut Chart — Open vs Closed Problems (Upgraded from Pie -> Donut with Center Total + Click-to-Filter)
    var openClosed = chartsData.problemsOpenVsClosed || { open: 0, closed: 0 };
    upsertChart('chart-problems-open-closed', {
      type: 'doughnut',
      data: {
        labels: [t('open_problems'), t('closed_problems')],
        datasets: [{
          data: [openClosed.open || 0, openClosed.closed || 0],
          backgroundColor: [c.royalRed, c.emerald],
          borderColor: c.surfaceBorder,
          borderWidth: 2.5,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        animation: reduced ? false : { animateRotate: true, animateScale: true, duration: 820, easing: 'easeOutQuart' },
        onHover: function (ev, els) {
          if (ev && ev.native && ev.native.target) {
            ev.native.target.style.cursor = els && els.length ? 'pointer' : 'default';
          }
        },
        onClick: function (_ev, els) {
          if (!els || !els.length) return;
          var idx = els[0].index;
          navigateWithFilter('problems', function () {
            ctx.state.problems = Object.assign(ctx.state.problems || {}, {
              status: idx === 1 ? 'مغلقة' : '',
              priority: ''
            });
          });
        },
        plugins: {
          legend: Object.assign({}, basePlugins.legend, { position: 'bottom' }),
          tooltip: Object.assign({}, basePlugins.tooltip, { callbacks: makePctTooltipCallbacks(true) })
        }
      }
    }, {
      isUpdate: isUpdate,
      instant: instantUpdate,
      plugins: [createDonutCenterPlugin(isEn ? 'Tickets' : 'المشكلات')]
    });

    // 6. Horizontal Staggered Bar Chart — Reservations by Company (Royal Red -> Charcoal Gradient + Click-to-Filter)
    var byCompany = chartsData.reservationsByCompany || {};
    var companyLabels = Object.keys(byCompany);
    upsertChart('chart-res-company', {
      type: 'bar',
      data: {
        labels: companyLabels,
        datasets: [{
          label: t('reservations'),
          data: Object.values(byCompany),
          backgroundColor: makeHorizontalGradient('chart-res-company', c.isDark ? '#64748B' : '#292929', '#D91F2B'),
          hoverBackgroundColor: '#D91F2B',
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 26
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        animation: reduced ? false : {
          duration: 680,
          easing: 'easeOutQuart',
          delay: function (context) {
            return (context.type === 'data' && context.mode === 'default') ? context.dataIndex * 70 : 0;
          }
        },
        onHover: function (ev, els) {
          if (ev && ev.native && ev.native.target) {
            ev.native.target.style.cursor = els && els.length ? 'pointer' : 'default';
          }
        },
        onClick: function (_ev, els) {
          if (!els || !els.length) return;
          var clickedComp = companyLabels[els[0].index];
          if (!clickedComp) return;
          navigateWithFilter('reservations', function () {
            ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { company: clickedComp, status: '', page: 1 });
          });
        },
        plugins: {
          legend: basePlugins.legend,
          tooltip: Object.assign({}, basePlugins.tooltip, { callbacks: makePctTooltipCallbacks(false) })
        },
        scales: {
          x: { ticks: { color: c.muted, precision: 0, font: fontDef }, grid: { color: c.grid }, beginAtZero: true, grace: '15%' },
          y: { ticks: { color: c.text, font: fontDef }, grid: { display: false } }
        }
      }
    }, { isUpdate: isUpdate });

    // 7. Grouped Comparison Bars — Assigned Reservations (Charcoal) vs Follow-Ups (Royal Red)
    var comp = chartsData.employeeComparison || [];
    upsertChart('chart-emp-comparison', {
      type: 'bar',
      data: {
        labels: comp.map(function (x) { return x.name; }),
        datasets: [
          {
            label: t('assigned_reservations'),
            data: comp.map(function (x) { return x.assigned; }),
            backgroundColor: c.isDark ? '#8A8A8A' : '#292929',
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 26
          },
          {
            label: t('followups_count'),
            data: comp.map(function (x) { return x.followUps; }),
            backgroundColor: c.royalRed,
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 26
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced ? false : {
          duration: 700,
          easing: 'easeOutQuart',
          delay: function (context) {
            return (context.type === 'data' && context.mode === 'default')
              ? (context.dataIndex * 70 + context.datasetIndex * 110)
              : 0;
          }
        },
        plugins: basePlugins,
        scales: {
          x: { ticks: { color: c.text, font: fontDef }, grid: { display: false } },
          y: { ticks: { color: c.muted, precision: 0, font: fontDef }, grid: { color: c.grid }, beginAtZero: true, grace: '15%' }
        }
      }
    }, { isUpdate: isUpdate, instant: instantUpdate });
  }

  function renderHeroIcon(pathD) {
    return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + pathD + '"/></svg>';
  }

  function renderStripIcon(pathD) {
    return '<span class="kpi-icon-badge" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + pathD + '"/></svg></span>';
  }

  function animateKpiNumber(el, targetVal) {
    if (!el) return;
    var to = Math.max(0, Math.round(Number(targetVal || 0)));
    var from = Math.max(0, Math.round(Number(el.getAttribute('data-val') || 0)));
    el.setAttribute('data-val', String(to));

    if (prefersReducedMotion() || typeof root.requestAnimationFrame !== 'function' || from === to) {
      el.textContent = String(to);
      return;
    }

    var startTs = null;
    var duration = 480;
    function step(ts) {
      if (!el.isConnected) return;
      if (startTs === null) startTs = ts;
      var progress = Math.min(1, (ts - startTs) / duration);
      var eased = 1 - Math.pow(1 - progress, 3);
      var cur = Math.round(from + (to - from) * eased);
      el.textContent = String(cur);
      if (progress < 1) {
        root.requestAnimationFrame(step);
      } else {
        el.textContent = String(to);
      }
    }
    root.requestAnimationFrame(step);
  }

  function buildSparklineSvg(values, strokeHex, gradId) {
    var nums = Array.isArray(values) && values.length ? values.map(function (v) { return Math.max(0, Number(v || 0)); }) : [0, 0];
    if (nums.length === 1) nums = [nums[0], nums[0]];
    if (nums.length > 8) nums = nums.slice(-8);

    var w = 92;
    var h = 30;
    var padY = 4;
    var maxVal = Math.max.apply(null, nums);
    var minVal = Math.min.apply(null, nums);
    var span = maxVal - minVal;

    var pts = nums.map(function (val, idx) {
      var x = nums.length > 1 ? (idx / (nums.length - 1)) * w : w;
      var ratio = span > 0 ? (val - minVal) / span : (maxVal > 0 ? 0.55 : 0.15);
      var y = h - padY - ratio * (h - padY * 2);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    var linePath = pts.map(function (p, idx) {
      if (idx === 0) return 'M ' + p.x + ' ' + p.y;
      var prev = pts[idx - 1];
      var cx = Number(((prev.x + p.x) / 2).toFixed(1));
      return 'C ' + cx + ' ' + prev.y + ', ' + cx + ' ' + p.y + ', ' + p.x + ' ' + p.y;
    }).join(' ');
    var areaPath = linePath + ' L ' + w + ' ' + h + ' L 0 ' + h + ' Z';

    var gradIdAttr = gradId || 'spark-g';
    return '<svg class="kpi-sparkline" data-series-sig="' + esc(nums.join(',') + '|' + strokeHex) + '" viewBox="0 0 ' + w + ' ' + h + '" fill="none" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="' + gradIdAttr + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + strokeHex + '" stop-opacity="0.30" />' +
          '<stop offset="100%" stop-color="' + strokeHex + '" stop-opacity="0.0" />' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="' + areaPath + '" fill="url(#' + gradId + ')" />' +
      '<path d="' + linePath + '" stroke="' + strokeHex + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />' +
    '</svg>';
  }

  function getHeroKpiDefs(t, k, chartsData, isEn) {
    var charts = chartsData || {};
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var stValues = Object.values(charts.statusDistribution || {});
    var dailyMap = charts.dailyFollowUps || {};
    var dailyKeys = Object.keys(dailyMap).sort();
    var dailyVals = dailyKeys.map(function (dk) { return dailyMap[dk]; });
    var prbOpen = Number((charts.problemsOpenVsClosed && charts.problemsOpenVsClosed.open) || k.openProblems || 0);
    var prbClosed = Number((charts.problemsOpenVsClosed && charts.problemsOpenVsClosed.closed) || 0);
    var deliveredRate = Number(k.totalReservations || 0) > 0
      ? Math.round((Number(k.delivered || 0) / Number(k.totalReservations || 1)) * 100) + '%'
      : '0%';

    return [
      {
        key: 'totalReservations',
        label: t('kpi_total'),
        tone: 'crimson',
        stroke: '#D91F2B',
        route: 'reservations',
        status: '',
        hint: (isEn ? 'Today: ' : 'اليوم: ') + Number(k.todayReservations || 0),
        series: stValues.length ? stValues : [Number(k.totalReservations || 0), Number(k.todayReservations || 0)],
        icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'
      },
      {
        key: 'delivered',
        label: isEn ? 'Delivered' : 'تم التسليم',
        tone: 'emerald',
        stroke: '#10B981',
        route: 'reservations',
        status: 'تم التسليم',
        hint: (isEn ? 'Completion: ' : 'نسبة الإنجاز: ') + deliveredRate,
        series: [Number(k.newReservations || 0), Number(k.booked || 0), Number(k.delivered || 0), Number(k.received || 0)],
        icon: 'M5 13l4 4L19 7'
      },
      {
        key: 'todayFollowUps',
        label: t('kpi_today_followups'),
        tone: 'charcoal',
        stroke: isDark ? '#D1D5DB' : '#292929',
        route: 'team-followups',
        status: '',
        hint: isEn ? 'Team Follow-Ups' : 'متابعات الفريق',
        series: dailyVals.length ? dailyVals : [0, Number(k.todayFollowUps || 0)],
        icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
      },
      {
        key: 'openProblems',
        label: t('kpi_open_problems'),
        tone: Number(k.openProblems || 0) > 0 ? 'crimson' : 'amber',
        stroke: Number(k.openProblems || 0) > 0 ? '#D91F2B' : '#D97706',
        route: 'problems',
        status: '',
        hint: (isEn ? 'High priority: ' : 'مرتفعة: ') + Number(k.highProblems || 0),
        series: [prbClosed, prbOpen, Number(k.highProblems || 0)],
        icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01'
      }
    ];
  }

  function getStripKpiDefs(t, isEn) {
    return [
      { key: 'todayReservations', label: t('kpi_today'), cls: 'kpi-info', route: 'reservations', status: '', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
      { key: 'newReservations', label: t('kpi_new'), cls: 'kpi-info', route: 'reservations', status: 'تم الإنشاء', icon: 'M12 5v14M5 12h14' },
      { key: 'booked', label: isEn ? 'Booked' : 'تم الحجز', cls: 'kpi-success', route: 'reservations', status: 'تم الحجز', icon: 'M9 11l3 3L22 4' },
      { key: 'received', label: isEn ? 'Received' : 'تم الاستلام', cls: 'kpi-success', route: 'reservations', status: 'تم الاستلام', icon: 'M20 6L9 17l-5-5' },
      { key: 'created', label: isEn ? 'Created' : 'تم الإنشاء', cls: '', route: 'reservations', status: 'تم الإنشاء', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
      { key: 'extended', label: isEn ? 'Extended' : 'تم التمديد', cls: 'kpi-info', route: 'reservations', status: 'تم التمديد', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z' },
      { key: 'cancelled', label: isEn ? 'Cancelled' : 'تم الإلغاء', cls: 'kpi-warning', route: 'reservations', status: 'تم الإلغاء', icon: 'M18 6L6 18M6 6l12 12' },
      { key: 'notBooked', label: isEn ? 'Not Booked' : 'لم يتم الحجز', cls: 'kpi-warning', route: 'reservations', status: 'لم يتم الحجز', icon: 'M12 9v2m0 4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
      { key: 'highProblems', label: t('kpi_high_problems'), cls: 'kpi-danger', route: 'problems', status: '', icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' }
    ];
  }

  function paintKpis(kpisEl, kpisData, chartsData, t, lang) {
    if (!kpisEl) return;
    var k = kpisData || {};
    var isEn = lang === 'en';
    var heroDefs = getHeroKpiDefs(t, k, chartsData, isEn);
    var stripDefs = getStripKpiDefs(t, isEn);

    var heroWrap = kpisEl.querySelector('#dash-kpis-hero');
    var stripWrap = kpisEl.querySelector('#dash-kpis-strip');

    if (heroWrap) {
      if (heroWrap.children.length === heroDefs.length && heroWrap.querySelector('[data-kpi-key]')) {
        heroDefs.forEach(function (item) {
          var btn = heroWrap.querySelector('[data-kpi-key="' + item.key + '"]');
          if (!btn) return;
          var nextCls = 'kpi-hero-card kpi-hero-' + item.tone;
          if (btn.className !== nextCls) btn.className = nextCls;
          var targetNum = Math.max(0, Math.round(Number(k[item.key] || 0)));
          var valEl = btn.querySelector('.kpi-hero-value');
          if (valEl) {
            var curDataVal = valEl.getAttribute('data-val');
            if (curDataVal !== String(targetNum) || valEl.textContent !== String(targetNum)) {
              animateKpiNumber(valEl, targetNum);
            }
          }
          var hintEl = btn.querySelector('.kpi-hero-hint');
          if (hintEl && hintEl.textContent !== item.hint) hintEl.textContent = item.hint;
          var sparkEl = btn.querySelector('.kpi-sparkline');
          var nextSparkSig = (Array.isArray(item.series) ? item.series.map(function (v) { return Math.max(0, Number(v || 0)); }).join(',') : '0,0') + '|' + item.stroke;
          if (sparkEl && sparkEl.getAttribute('data-series-sig') !== nextSparkSig) {
            sparkEl.outerHTML = buildSparklineSvg(item.series, item.stroke, 'spark-' + item.key);
          }
        });
      } else {
        heroWrap.innerHTML = heroDefs.map(function (item) {
          var v = Math.max(0, Math.round(Number(k[item.key] || 0)));
          return '<button type="button" class="kpi-hero-card kpi-hero-' + item.tone + '" data-kpi-key="' + item.key + '" data-kpi-route="' + item.route + '" data-kpi-status="' + item.status + '">' +
            '<div class="kpi-hero-top">' +
              '<span class="kpi-hero-medallion">' + renderHeroIcon(item.icon) + '</span>' +
              '<div class="kpi-hero-meta">' +
                '<span class="kpi-hero-label">' + esc(item.label) + '</span>' +
                '<span class="kpi-hero-value tabular-nums" data-val="' + v + '">' + v + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="kpi-hero-bottom">' +
              '<span class="kpi-hero-hint tabular-nums">' + esc(item.hint) + '</span>' +
              buildSparklineSvg(item.series, item.stroke, 'spark-' + item.key) +
            '</div>' +
          '</button>';
        }).join('');
      }
    }

    if (stripWrap) {
      if (stripWrap.children.length === stripDefs.length && stripWrap.querySelector('[data-kpi-key]')) {
        stripDefs.forEach(function (item) {
          var btn = stripWrap.querySelector('[data-kpi-key="' + item.key + '"]');
          if (!btn) return;
          var valEl = btn.querySelector('.kpi-value');
          var nextText = String(Number(k[item.key] || 0));
          if (valEl && valEl.textContent !== nextText) valEl.textContent = nextText;
        });
      } else {
        stripWrap.innerHTML = stripDefs.map(function (item) {
          return '<button type="button" class="kpi-card ' + item.cls + '" data-kpi-key="' + item.key + '" data-kpi-route="' + item.route + '" data-kpi-status="' + item.status + '">' +
            '<div class="kpi-head-row">' +
              '<span class="kpi-label">' + esc(item.label) + '</span>' +
              renderStripIcon(item.icon) +
            '</div>' +
            '<span class="kpi-value tabular-nums">' + Number(k[item.key] || 0) + '</span>' +
          '</button>';
        }).join('');
      }
    }
  }

  function renderLiveActivityFeed(wrap, items, lang, timeFormat) {
    if (!wrap) return;
    if (!Array.isArray(items) || items.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="padding:20px;">' + (lang === 'en' ? 'No recent activity recorded yet.' : 'لا توجد نشاطات مسجلة حتى الآن.') + '</div>';
      return;
    }
    wrap.innerHTML = '<div class="dash-feed-list">' +
      items.slice(0, 5).map(function (l) {
        var actionLower = String(l.actionType || '').toLowerCase();
        var tone = actionLower.indexOf('problem') !== -1 || actionLower.indexOf('delete') !== -1
          ? 'is-danger'
          : (actionLower.indexOf('sync') !== -1 || actionLower.indexOf('follow') !== -1 ? 'is-crimson' : 'is-info');
        var badgeChar = String(l.userName || 'S').trim().charAt(0) || 'S';
        var fmtLogTime = l.logTime ? fmtTime(l.logTime, lang, timeFormat) : '';
        var timeLabel = (root.RGCrmCore && root.RGCrmCore.formatDisplayDate ? root.RGCrmCore.formatDisplayDate(l.logDate) : (l.logDate || '')) +
          (fmtLogTime ? ' · ' + fmtLogTime : '');

        return '<div class="dash-feed-row">' +
          '<div style="display:flex;align-items:flex-start;gap:10px;min-width:0;">' +
            '<span class="dash-feed-icon ' + tone + '">' + esc(badgeChar) + '</span>' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12.5px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(l.userName || 'النظام') + ' · <span style="color:var(--brand-primary);">' + esc(l.actionType) + '</span></div>' +
              '<div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(l.details || (l.entityType ? l.entityType + ': ' + l.entityId : '-')) + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="mono tabular-nums" style="font-size:11px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">' + esc(timeLabel) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderRecentReservationsFeed(wrap, items, ctx) {
    if (!wrap) return;
    if (!Array.isArray(items) || items.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="padding:20px;">' + (ctx.lang === 'en' ? 'No reservations found yet.' : 'لا توجد حجوزات مسجلة حتى الآن.') + '</div>';
      return;
    }
    wrap.innerHTML = '<div class="dash-feed-list">' +
      items.slice(0, 4).map(function (r) {
        var st = String(r.internalStatus || 'جديد');
        var stCls = (st === 'تم التسليم' || st === 'تم الحجز' || st === 'تم الاستلام')
          ? 'status-success'
          : (st === 'تم الإلغاء' || st === 'لم يتم الحجز' ? 'status-danger' : 'status-info');
        return '<button type="button" class="dash-feed-row dash-feed-row-clickable dash-open-res-btn" data-res-id="' + esc(r.id) + '">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
              '<strong class="mono" dir="ltr" style="font-size:12px;color:var(--text-primary);white-space:nowrap;flex-shrink:0;">' + esc(r.reservationNumber || r.id) + '</strong>' +
              '<span style="font-size:12.5px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.customerName || '-') + '</span>' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.companyName || '-') + (r.carName ? ' · ' + esc(r.carName) : '') + '</div>' +
          '</div>' +
          '<span class="status-tag ' + stCls + '" style="flex-shrink:0;">' + esc(st) + '</span>' +
        '</button>';
      }).join('') +
    '</div>';

    wrap.querySelectorAll('.dash-open-res-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var resId = btn.getAttribute('data-res-id');
        if (root.RGReservations && root.RGReservations.openReservationDrawer) {
          root.RGReservations.openReservationDrawer(resId, ctx, [], function () {
            render(wrap.closest('.route-view') || document.getElementById('page-content'), ctx, { silent: true });
          });
        }
      });
    });
  }

  function renderActiveProblemsFeed(wrap, items, ctx) {
    if (!wrap) return;
    var activeOnly = (Array.isArray(items) ? items : []).filter(function (p) {
      var st = String(p.status || '');
      return st !== 'مغلقة' && st !== 'تم الحل';
    });
    if (activeOnly.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="padding:20px;">' + (ctx.lang === 'en' ? 'No open problems right now.' : 'لا توجد مشكلات مفتوحة حالياً.') + '</div>';
      return;
    }
    wrap.innerHTML = '<div class="dash-feed-list">' +
      activeOnly.slice(0, 4).map(function (p) {
        var isHigh = p.priority === 'مرتفعة' || p.priority === 'عاجلة' || p.priority === 'مرتفع';
        return '<button type="button" class="dash-feed-row dash-feed-row-clickable dash-open-prb-btn" data-prb-id="' + esc(p.id) + '">' +
          '<div style="min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<strong class="mono" style="font-size:12.5px;color:var(--text-primary);">' + esc(p.problemNumber || p.reservationNumber || p.id) + '</strong>' +
              '<span style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.customerName || '-') + '</span>' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.description || '-') + '</div>' +
          '</div>' +
          '<span class="status-tag ' + (isHigh ? 'status-danger' : 'status-warning') + '">' + esc(p.priority || 'متوسط') + '</span>' +
        '</button>';
      }).join('') +
    '</div>';

    wrap.querySelectorAll('.dash-open-prb-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var prbId = btn.getAttribute('data-prb-id');
        if (root.RGProblems && root.RGProblems.openProblemById) {
          root.RGProblems.openProblemById(prbId, ctx, function () {
            render(wrap.closest('.route-view') || document.getElementById('page-content'), ctx, { silent: true });
          });
        }
      });
    });
  }

  function chartHeaderIcon(pathD) {
    return '<span class="chart-title-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="' + pathD + '"/></svg></span>';
  }

  function renderPeakHoursHeatmap(hostEl, reservations, problems, opts) {
    if (!hostEl) return;
    var options = opts || {};
    var isEn = options.lang === 'en';
    var mode = hostEl.getAttribute('data-heatmap-mode') || options.mode || 'all';
    if (mode !== 'reservations' && mode !== 'problems') mode = 'all';
    hostEl.setAttribute('data-heatmap-mode', mode);

    var core = root.RGCrmCore;
    var data = (core && core.computePeakHoursHeatmap)
      ? core.computePeakHoursHeatmap(reservations || [], problems || [], { mode: mode })
      : null;

    if (!data) {
      hostEl.innerHTML = '<div class="empty-state" style="padding:18px;">' + (isEn ? 'Heatmap engine unavailable.' : 'تعذر حساب مصفوفة ساعات الذروة.') + '</div>';
      return;
    }

    var tf = resolveTimeFormat(options.timeFormat);
    var busiestLbl = data.busiestDay
      ? ((isEn ? data.busiestDay.labelEn : data.busiestDay.labelAr) + ' (' + data.busiestDay.total + ')')
      : '-';
    var peakSlotHourStr = (data.peakSlot && data.peakSlot.hourLabel)
      ? fmtTime(data.peakSlot.hourLabel, options.lang, tf)
      : '';
    var peakSlotLbl = (data.peakSlot && data.peakSlot.count > 0)
      ? ((isEn ? data.peakSlot.labelEn : data.peakSlot.labelAr) + ' · ' + peakSlotHourStr + ' (' + data.peakSlot.count + ')')
      : '-';
    var peakHourDisplay = fmtTime(data.peakHourLabel, options.lang, tf);

    var hoursHeader = '';
    for (var h = 0; h < 24; h++) {
      var hh = (h < 10 ? '0' : '') + h;
      var hourFullLbl = fmtTime(hh + ':00', options.lang, tf);
      var hourShortLbl = fmtCompactHeatmapHour(h, isEn, tf);
      hoursHeader += '<th class="mono tabular-nums" title="' + esc(hourFullLbl) + '">' + esc(hourShortLbl) + '</th>';
    }

    var rowsHtml = (data.days || []).map(function (dayRow) {
      var dayLabel = isEn ? dayRow.labelEn : dayRow.labelAr;
      var cells = (dayRow.hours || []).map(function (cell) {
        var lvl = cell.intensity || 0;
        var cellHourStr = fmtTime(cell.hourLabel, options.lang, tf);
        var titleStr = dayLabel + ' ' + cellHourStr + ' — ' +
          (isEn
            ? ('Total: ' + cell.count + ' (Bookings: ' + cell.reservations + ', Problems: ' + cell.problems + ')')
            : ('الإجمالي: ' + cell.count + ' (حجوزات: ' + cell.reservations + '، مشكلات: ' + cell.problems + ')'));
        return '<td>' +
          '<button type="button" class="rg-heatmap-cell lvl-' + lvl + ' tabular-nums"' +
            ' data-hm-day="' + esc(dayLabel) + '"' +
            ' data-hm-hour="' + esc(cellHourStr) + '"' +
            ' data-hm-count="' + cell.count + '"' +
            ' data-hm-res="' + cell.reservations + '"' +
            ' data-hm-prb="' + cell.problems + '"' +
            ' title="' + esc(titleStr) + '"' +
            ' aria-label="' + esc(titleStr) + '">' +
            (cell.count > 0 ? cell.count : '') +
          '</button>' +
        '</td>';
      }).join('');
      return '<tr>' +
        '<th scope="row" class="rg-heatmap-day">' + esc(dayLabel) + '<span class="rg-heatmap-day-sum tabular-nums">' + dayRow.rowTotal + '</span></th>' +
        cells +
      '</tr>';
    }).join('');

    hostEl.innerHTML =
      '<div class="rg-heatmap-top">' +
        '<div class="rg-heatmap-kpis">' +
          '<div class="rg-heatmap-kpi"><span>' + (isEn ? 'Busiest Day' : 'اليوم الأكثر ازدحاماً') + '</span><strong class="tabular-nums">' + esc(busiestLbl) + '</strong></div>' +
          '<div class="rg-heatmap-kpi"><span>' + (isEn ? 'Peak Hour' : 'ساعة الذروة') + '</span><strong class="mono tabular-nums">' + esc(peakHourDisplay) + ' (' + data.peakHourTotal + ')</strong></div>' +
          '<div class="rg-heatmap-kpi"><span>' + (isEn ? 'Hottest Shift Slot' : 'ذروة الضغط للوردية') + '</span><strong class="tabular-nums">' + esc(peakSlotLbl) + '</strong></div>' +
          '<div class="rg-heatmap-kpi"><span>' + (isEn ? 'Total Events' : 'إجمالي الأحداث') + '</span><strong class="tabular-nums">' + data.totalEvents + '</strong></div>' +
        '</div>' +
        '<div class="rg-heatmap-controls">' +
          '<div class="segmented-control" role="group" aria-label="' + (isEn ? 'Heatmap layer' : 'نطاق مصفوفة الذروة') + '">' +
            '<button type="button" class="segmented-btn' + (mode === 'all' ? ' active' : '') + '" data-hm-mode="all">' + (isEn ? 'All' : 'الكل') + ' (' + (data.reservationEvents + data.problemEvents) + ')</button>' +
            '<button type="button" class="segmented-btn' + (mode === 'reservations' ? ' active' : '') + '" data-hm-mode="reservations">' + (isEn ? 'Bookings' : 'الحجوزات') + ' (' + data.reservationEvents + ')</button>' +
            '<button type="button" class="segmented-btn' + (mode === 'problems' ? ' active' : '') + '" data-hm-mode="problems">' + (isEn ? 'Problems' : 'المشكلات') + ' (' + data.problemEvents + ')</button>' +
          '</div>' +
          '<div class="rg-heatmap-legend" aria-hidden="true">' +
            '<span>' + (isEn ? 'Low' : 'أقل') + '</span>' +
            '<i class="rg-heatmap-swatch lvl-0"></i>' +
            '<i class="rg-heatmap-swatch lvl-1"></i>' +
            '<i class="rg-heatmap-swatch lvl-2"></i>' +
            '<i class="rg-heatmap-swatch lvl-3"></i>' +
            '<i class="rg-heatmap-swatch lvl-4"></i>' +
            '<span>' + (isEn ? 'Peak' : 'ذروة') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rg-heatmap-scroll">' +
        '<table class="rg-heatmap-table"><thead><tr><th class="rg-heatmap-corner">' + (isEn ? 'Day / Hour' : 'اليوم / الساعة') + '</th>' + hoursHeader + '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody></table>' +
      '</div>' +
      '<div class="rg-heatmap-detail" data-hm-detail>' +
        (data.peakSlot && data.peakSlot.count > 0
          ? (isEn
              ? ('Peak insight: ' + data.peakSlot.labelEn + ' at ' + peakSlotHourStr + ' — ' + data.peakSlot.reservations + ' bookings & ' + data.peakSlot.problems + ' problems. Hover or tap any cell to inspect.')
              : ('مؤشر الذروة: ' + data.peakSlot.labelAr + ' الساعة ' + peakSlotHourStr + ' — ' + data.peakSlot.reservations + ' حجز و ' + data.peakSlot.problems + ' مشكلة. مرّر المؤشر أو اضغط على أي ساعة للتفاصيل.'))
          : (isEn ? 'No timed events recorded yet.' : 'لا توجد أحداث مسجلة بعد لعرض التفاصيل.')) +
      '</div>';

    hostEl.querySelectorAll('[data-hm-mode]').forEach(function (mBtn) {
      mBtn.addEventListener('click', function () {
        var nextMode = mBtn.getAttribute('data-hm-mode') || 'all';
        hostEl.setAttribute('data-heatmap-mode', nextMode);
        renderPeakHoursHeatmap(hostEl, reservations, problems, Object.assign({}, options, { mode: nextMode }));
      });
    });

    var detailEl = hostEl.querySelector('[data-hm-detail]');
    if (detailEl) {
      var showCellInfo = function (cellBtn) {
        var dLbl = cellBtn.getAttribute('data-hm-day') || '';
        var hLbl = cellBtn.getAttribute('data-hm-hour') || '';
        var cTot = cellBtn.getAttribute('data-hm-count') || '0';
        var cRes = cellBtn.getAttribute('data-hm-res') || '0';
        var cPrb = cellBtn.getAttribute('data-hm-prb') || '0';
        detailEl.textContent = isEn
          ? (dLbl + ' · ' + hLbl + ' — Total: ' + cTot + ' (' + cRes + ' bookings, ' + cPrb + ' problems)')
          : (dLbl + ' · الساعة ' + hLbl + ' — الإجمالي: ' + cTot + ' (' + cRes + ' حجز، ' + cPrb + ' مشكلة)');
      };
      hostEl.querySelectorAll('.rg-heatmap-cell').forEach(function (cellBtn) {
        cellBtn.addEventListener('mouseenter', function () { showCellInfo(cellBtn); });
        cellBtn.addEventListener('focus', function () { showCellInfo(cellBtn); });
        cellBtn.addEventListener('click', function () { showCellInfo(cellBtn); });
      });
    }
  }

  async function render(container, ctx, opts) {
    var t = ctx.t;
    var options = opts || {};
    var isEn = ctx.lang === 'en';
    var state = ctx.state.dashboard || { range: '30d', dateFrom: '', dateTo: '' };
    ctx.state.dashboard = state;
    if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
    var currentUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    var firstName = currentUser && currentUser.name ? String(currentUser.name).split(' ')[0] : '';
    var core = root.RGCrmCore;
    var uiSimp = ctx.getUiSimplification ? ctx.getUiSimplification() : {};
    var layoutPrefs = ctx.getLayoutPrefs ? ctx.getLayoutPrefs(currentUser) : { dashOrder: [], dashHidden: [] };
    var sectionDefs = (core && core.DASHBOARD_SECTION_DEFS) || [];
    var isCustomizeMode = Boolean(state.customizeMode);

    if (isCustomizeMode) {
      if (!Array.isArray(state.draftOrder) || !state.draftOrder.length) {
        state.draftOrder = (layoutPrefs.dashOrder || []).slice();
      }
      if (!state.draftHiddenMap) {
        state.draftHiddenMap = {};
        (layoutPrefs.dashHidden || []).forEach(function (id) { state.draftHiddenMap[id] = true; });
      }
    } else {
      state.draftOrder = null;
      state.draftHiddenMap = null;
    }

    var activeOrder = isCustomizeMode && Array.isArray(state.draftOrder)
      ? state.draftOrder
      : (layoutPrefs.dashOrder && layoutPrefs.dashOrder.length ? layoutPrefs.dashOrder : sectionDefs.map(function (d) { return d.id; }));
    var activeHiddenMap = isCustomizeMode && state.draftHiddenMap
      ? state.draftHiddenMap
      : (function () {
          var m = {};
          (layoutPrefs.dashHidden || []).forEach(function (id) { m[id] = true; });
          return m;
        })();

    var visBySec = {};
    sectionDefs.forEach(function (def) {
      var allowedByPerm = (core && core.canUserViewDashboardSection)
        ? core.canUserViewDashboardSection(currentUser, def.permKey)
        : true;
      var hiddenByUiSimp = Boolean(uiSimp && def.uiSimpKey && uiSimp[def.uiSimpKey]);
      var hiddenByUser = Boolean(activeHiddenMap[def.id]);
      visBySec[def.id] = {
        def: def,
        allowedByPerm: allowedByPerm,
        hiddenByUiSimp: hiddenByUiSimp,
        hiddenByUser: hiddenByUser,
        shouldShow: allowedByPerm && !hiddenByUiSimp && (!hiddenByUser || isCustomizeMode),
        shouldRenderData: allowedByPerm && !hiddenByUiSimp && (!hiddenByUser || isCustomizeMode)
      };
    });

    var canHandover = (
      (!core || !core.canUserViewDashboardSection || core.canUserViewDashboardSection(currentUser, 'dash_view_handover')) &&
      (!core || !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_handover_pdf'))
    );
    var canExportPdf = !core || !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_pdf');
    var canExportExcel = !core || !core.canUserUseActionButton || core.canUserUseActionButton(currentUser, 'act_export_excel');

    var orderedVisibleDefs = activeOrder.map(function (id) {
      return visBySec[id] ? visBySec[id].def : null;
    }).filter(function (def) {
      return def && visBySec[def.id] && visBySec[def.id].shouldShow;
    });
    sectionDefs.forEach(function (def) {
      if (activeOrder.indexOf(def.id) === -1 && visBySec[def.id] && visBySec[def.id].shouldShow) {
        orderedVisibleDefs.push(def);
      }
    });

    var layoutSig = (isCustomizeMode ? 'CUST|' : 'VIEW|') + orderedVisibleDefs.map(function (d) {
      return d.id + (visBySec[d.id].hiddenByUser ? ':H' : '');
    }).join(',');

    var hostElExisting = container.querySelector('#dash-sections-host');
    var existingSig = hostElExisting ? hostElExisting.getAttribute('data-layout-sig') : '';
    var isShellMounted = Boolean(hostElExisting && existingSig === layoutSig && !options.forceRebuild);
    var clickHintText = isEn ? 'Click segment to filter' : 'انقر للتصفية';

    function renderExpiryRadarFeed(wrap, countEl, items, ctx) {
      if (!wrap) return;
      var summary = (core && core.computeExpiryRadarSummary)
        ? core.computeExpiryRadarSummary(Array.isArray(items) ? items : [], Date.now(), { windowHours: 24, gracePastHours: 12 })
        : { items: [], totalCount: 0, critical6hCount: 0, expiredUnclosedCount: 0 };

      if (countEl) {
        countEl.textContent = ctx.lang === 'en'
          ? (summary.totalCount + ' contracts')
          : (summary.totalCount + ' عقود');
      }

      if (!summary.items.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:18px;">' + (ctx.lang === 'en' ? 'No active contracts expiring within 24 hours.' : 'لا توجد عقود نشطة تقترب من الانتهاء خلال 24 ساعة.') + '</div>';
        return;
      }

      wrap.innerHTML = '<div class="dash-radar-grid">' +
        summary.items.slice(0, 4).map(function (entry) {
          var r = entry.reservation || {};
          var remLabel = ctx.lang === 'en' ? entry.remainingLabelEn : entry.remainingLabelAr;
          var toneCls = entry.bucket === 'expired_unclosed'
            ? 'radar-countdown-expired'
            : (entry.bucket === 'critical_6h' ? 'radar-countdown-critical' : 'radar-countdown-soon');
          return '<button type="button" class="dash-feed-row dash-feed-row-clickable dash-open-res-btn" data-res-id="' + esc(r.id) + '">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
                '<strong class="mono" dir="ltr" style="font-size:12px;color:var(--text-primary);white-space:nowrap;flex-shrink:0;">' + esc(r.reservationNumber || r.id) + '</strong>' +
                '<span style="font-size:12.5px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.customerName || '-') + '</span>' +
              '</div>' +
              '<div style="font-size:11.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.carName || '-') + (entry.effectiveEndTime ? ' · ' + esc(ctx.formatTime ? ctx.formatTime(entry.effectiveEndTime) : fmtTime(entry.effectiveEndTime, ctx.lang)) : '') + '</div>' +
            '</div>' +
            '<span class="radar-countdown ' + toneCls + ' tabular-nums" style="flex-shrink:0;">' + esc(remLabel) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';

      wrap.querySelectorAll('.dash-open-res-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var resId = btn.getAttribute('data-res-id');
          if (root.RGReservations && root.RGReservations.openReservationDrawer) {
            root.RGReservations.openReservationDrawer(resId, ctx, [], function () {
              render(wrap.closest('.route-view') || document.getElementById('page-content'), ctx, { silent: true });
            });
          }
        });
      });
    }

    function renderLeaderboardCard(wrap, leaderboard, ctx) {
      if (!wrap) return;
      var isEn = ctx && ctx.lang === 'en';
      var list = Array.isArray(leaderboard) ? leaderboard : [];
      if (!list.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:20px;">' +
          (isEn ? 'No active staff activity recorded yet for the leaderboard.' : 'لا توجد بيانات أداء مسجلة لعرض لوحة الصدارة حالياً.') +
        '</div>';
        return;
      }
      var roleLabels = (core && core.ROLE_LABELS && (core.ROLE_LABELS[isEn ? 'en' : 'ar'] || core.ROLE_LABELS.ar)) || {};
      var topScore = Math.max(1, Number((list[0] && list[0].score) || 1));

      function getInitials(nameStr) {
        var clean = String(nameStr || '').trim();
        if (!clean) return '؟';
        var parts = clean.split(/[\s\-·\/]+/).filter(function (w) { return /[\p{L}\p{N}]/u.test(w); });
        if (parts.length >= 2) return parts[0].charAt(0) + parts[1].charAt(0);
        if (parts.length === 1) return parts[0].slice(0, 2);
        return clean.slice(0, 2);
      }

      function podiumMedalSvg(rankNum) {
        if (rankNum === 1) {
          return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l4.5 4.5L12 4l4.5 7.5L21 7l-2 11H5L3 7z"/><path d="M5 20h14"/></svg>';
        }
        return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/></svg>';
      }

      var topThree = list.slice(0, 3);
      var restList = list.slice(3, 10);

      var podiumHtml = '<div class="rg-lb-podium">' + topThree.map(function (item, idx) {
        var rank = Number(item.rank || (idx + 1));
        var rankCls = rank === 1 ? 'is-gold' : (rank === 2 ? 'is-silver' : 'is-bronze');
        var scoreNum = Number(item.score || 0);
        var pct = scoreNum > 0 ? Math.max(8, Math.min(100, Math.round((scoreNum / topScore) * 100))) : 0;
        var ratePct = Math.max(0, Math.min(100, Number(item.completionRate || 0)));
        var closedVal = Number(item.closedBookingsCount !== undefined ? item.closedBookingsCount : (item.closedCount || 0));
        var roleText = roleLabels[item.role] || item.jobTitle || item.role || '';
        return '<button type="button" class="rg-lb-podium-card ' + rankCls + '" data-emp-id="' + esc(item.employeeId || '') + '">' +
          '<div class="rg-lb-podium-top">' +
            '<span class="rg-lb-medal ' + rankCls + '">' +
              podiumMedalSvg(rank) +
              '<span class="tabular-nums">#' + rank + (rank === 1 ? (' · ' + (isEn ? 'Top #1' : 'المركز الأول')) : '') + '</span>' +
            '</span>' +
            '<span class="rg-lb-podium-pts tabular-nums"><strong>' + scoreNum + '</strong> <small>' + (isEn ? 'pts' : 'نقطة') + '</small></span>' +
          '</div>' +
          '<div class="rg-lb-podium-person">' +
            '<span class="rg-lb-avatar ' + rankCls + '" aria-hidden="true">' + esc(getInitials(item.name)) + '</span>' +
            '<div class="rg-lb-person-meta">' +
              '<strong class="rg-lb-name">' + esc(item.name || '-') + '</strong>' +
              (roleText ? '<span class="rg-lb-role">' + esc(roleText) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="rg-lb-bar-track" aria-hidden="true"><div class="rg-lb-bar-fill ' + rankCls + '" style="width:' + pct + '%;"></div></div>' +
          '<div class="rg-lb-stats tabular-nums">' +
            '<span class="rg-lb-metric-chip">' + (isEn ? 'FU:' : 'متابعات:') + ' <strong>' + Number(item.followUpsCount || 0) + '</strong></span>' +
            '<span class="rg-lb-metric-chip">' + (isEn ? 'Closed:' : 'منجز:') + ' <strong>' + closedVal + '</strong></span>' +
            '<span class="rg-lb-metric-chip">' + (isEn ? 'Res:' : 'حل:') + ' <strong>' + Number(item.resolvedProblemsCount || 0) + '</strong></span>' +
            '<span class="rg-lb-metric-chip is-rate">' + ratePct + '%</span>' +
          '</div>' +
        '</button>';
      }).join('') + '</div>';

      var restHtml = restList.length
        ? '<div class="rg-lb-ranked-list">' + restList.map(function (item, idx) {
            var rank = Number(item.rank || (idx + 4));
            var scoreNum = Number(item.score || 0);
            var pct = scoreNum > 0 ? Math.max(6, Math.min(100, Math.round((scoreNum / topScore) * 100))) : 0;
            var ratePct = Math.max(0, Math.min(100, Number(item.completionRate || 0)));
            var closedVal = Number(item.closedBookingsCount !== undefined ? item.closedBookingsCount : (item.closedCount || 0));
            var roleText = roleLabels[item.role] || item.jobTitle || item.role || '';
            return '<button type="button" class="rg-lb-ranked-row" data-emp-id="' + esc(item.employeeId || '') + '">' +
              '<span class="rg-lb-rank-num tabular-nums">#' + rank + '</span>' +
              '<span class="rg-lb-avatar is-sm" aria-hidden="true">' + esc(getInitials(item.name)) + '</span>' +
              '<div class="rg-lb-main">' +
                '<div class="rg-lb-top">' +
                  '<strong class="rg-lb-name">' + esc(item.name || '-') + '</strong>' +
                  (roleText ? '<span class="rg-lb-role">' + esc(roleText) + '</span>' : '') +
                '</div>' +
                '<div class="rg-lb-bar-track is-slim" aria-hidden="true"><div class="rg-lb-bar-fill" style="width:' + pct + '%;"></div></div>' +
                '<div class="rg-lb-stats tabular-nums">' +
                  '<span class="rg-lb-metric-chip">' + (isEn ? 'Follow-ups:' : 'متابعات:') + ' <strong>' + Number(item.followUpsCount || 0) + '</strong></span>' +
                  '<span class="rg-lb-metric-chip">' + (isEn ? 'Closed:' : 'منجز:') + ' <strong>' + closedVal + '</strong></span>' +
                  '<span class="rg-lb-metric-chip">' + (isEn ? 'Resolved:' : 'حل مشكلات:') + ' <strong>' + Number(item.resolvedProblemsCount || 0) + '</strong></span>' +
                  '<span class="rg-lb-metric-chip is-rate">' + (isEn ? 'Rate:' : 'الإنجاز:') + ' <strong>' + ratePct + '%</strong></span>' +
                '</div>' +
              '</div>' +
              '<div class="rg-lb-score">' +
                '<span class="rg-lb-score-val tabular-nums">' + scoreNum + '</span>' +
                '<span class="rg-lb-score-lbl">' + (isEn ? 'pts' : 'نقطة') + '</span>' +
              '</div>' +
            '</button>';
          }).join('') + '</div>'
        : '';

      wrap.innerHTML = '<div class="rg-leaderboard-shell">' + podiumHtml + restHtml + '</div>';

      wrap.querySelectorAll('[data-emp-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var empId = btn.getAttribute('data-emp-id');
          if (!empId) return;
          if (root.RGEmployees && typeof root.RGEmployees.openEmployeeDetailsDrawer === 'function') {
            var empsState = (root.RGApp && root.RGApp.getEmployeesState) ? root.RGApp.getEmployeesState() : null;
            var allEmps = (empsState && Array.isArray(empsState.items)) ? empsState.items : [];
            root.RGEmployees.openEmployeeDetailsDrawer(empId, ctx, allEmps, function () {
              render(wrap.closest('.route-view') || document.getElementById('page-content'), ctx, { silent: true });
            });
          }
        });
      });
    }

    function buildSectionBodyHtml(secId) {
      var kpiSkelHero = '<div class="rg-kpi-skeleton-card"></div><div class="rg-kpi-skeleton-card"></div><div class="rg-kpi-skeleton-card"></div><div class="rg-kpi-skeleton-card"></div>';
      var kpiSkelStrip = '<div class="rg-kpi-skeleton-card" style="min-height:76px;"></div><div class="rg-kpi-skeleton-card" style="min-height:76px;"></div><div class="rg-kpi-skeleton-card" style="min-height:76px;"></div><div class="rg-kpi-skeleton-card" style="min-height:76px;"></div>';
      var feedSkel = '<div class="rg-skeleton-table"><div class="rg-skeleton-row"></div><div class="rg-skeleton-row"></div></div>';
      switch (secId) {
        case 'hero_kpis':
          return '<div class="kpi-hero-grid" id="dash-kpis-hero">' + kpiSkelHero + '</div>';
        case 'strip_kpis':
          return '<div class="kpi-strip-grid" id="dash-kpis-strip">' + kpiSkelStrip + '</div>';
        case 'daily_chart':
          return '<section class="chart-card" id="dash-daily-chart-card">' +
            '<div class="chart-card-head">' +
              '<h3 class="chart-card-title">' + chartHeaderIcon('M3 17l6-6 4 4 8-8') + t('chart_daily_fu') + '</h3>' +
              '<button type="button" class="btn btn-sm dash-jump-btn" data-jump="team-followups">' + t('view_all') + '</button>' +
            '</div>' +
            '<div class="chart-canvas-wrap"><canvas id="chart-daily-followups"></canvas></div>' +
          '</section>';
        case 'recent_activity':
          return '<section class="chart-card" id="dash-recent-activity-card">' +
            '<div class="chart-card-head">' +
              '<h3 class="chart-card-title">' + chartHeaderIcon('M13 2L3 14h9l-1 8 10-12h-9l1-8z') + t('recent_activity') + '</h3>' +
              '<button type="button" class="btn btn-sm dash-jump-btn" data-jump="activity">' + t('view_all') + '</button>' +
            '</div>' +
            '<div id="dash-recent-activity">' + feedSkel + '</div>' +
          '</section>';
        case 'charts_grid':
          return '<div class="charts-grid" id="dash-charts-grid">' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z') + t('chart_status_dist') + '</h3>' +
                '<span class="chart-sub-hint">' + clickHintText + '</span>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-status-dist"></canvas></div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M18 20V10M12 20V4M6 20v-6') + t('chart_emp_perf') + '</h3>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-emp-perf"></canvas></div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z') + t('chart_prb_prio') + '</h3>' +
                '<span class="chart-sub-hint">' + clickHintText + '</span>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-problems-priority"></canvas></div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z') + t('chart_prb_open_closed') + '</h3>' +
                '<span class="chart-sub-hint">' + clickHintText + '</span>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-problems-open-closed"></canvas></div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16') + t('chart_res_company') + '</h3>' +
                '<span class="chart-sub-hint">' + clickHintText + '</span>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-res-company"></canvas></div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8') + t('chart_emp_comp') + '</h3>' +
              '</div>' +
              '<div class="chart-canvas-wrap"><canvas id="chart-emp-comparison"></canvas></div>' +
            '</section>' +
          '</div>';
        case 'expiry_radar':
          return '<section class="chart-card" id="dash-expiry-radar-section">' +
            '<div class="chart-card-head">' +
              '<h3 class="chart-card-title">' + chartHeaderIcon('M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2') + (isEn ? '24h Expiry Radar' : 'رادار انتهاء الحجوزات خلال 24 ساعة') + ' <span class="chart-sub-hint tabular-nums" id="dash-radar-count"><span class="rg-tab-count-loading" aria-label="جاري التحميل"></span></span></h3>' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-sm" id="dash-open-today-btn">' + (isEn ? 'Today\'s Pickups & Returns' : 'التسليم والاستلام اليوم') + '</button>' +
                '<button type="button" class="btn btn-sm btn-primary" id="dash-open-radar-btn">' + (isEn ? 'Open 24h Radar' : 'فتح رادار 24 ساعة') + '</button>' +
              '</div>' +
            '</div>' +
            '<div id="dash-expiry-radar-feed">' + feedSkel + '</div>' +
          '</section>';
        case 'peak_heatmap':
          return '<section class="chart-card" id="dash-peak-heatmap-section">' +
            '<div class="chart-card-head">' +
              '<h3 class="chart-card-title">' + chartHeaderIcon('M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z') + (isEn ? 'Peak Hours Heatmap (Shift Planning)' : 'مصفوفة ساعات الذروة (تخطيط الورديات)') + '</h3>' +
              '<span class="chart-sub-hint">' + (isEn ? '7 Days × 24 Hours' : '7 أيام × 24 ساعة') + '</span>' +
            '</div>' +
            '<div id="dash-peak-heatmap">' + feedSkel + '</div>' +
          '</section>';
        case 'leaderboard':
          return '<section class="chart-card rg-ui-dash-leaderboard" id="dash-leaderboard-section">' +
            '<div class="chart-card-head">' +
              '<h3 class="chart-card-title">' + chartHeaderIcon('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM5 6H3v2a3 3 0 0 0 3 3M19 6h2v2a3 3 0 0 1-3 3') + (isEn ? 'Team Performance Leaderboard' : 'لوحة الصدارة وأداء الفريق (Leaderboard)') + '</h3>' +
              '<span class="chart-sub-hint">' + (isEn ? 'Top performers by follow-ups, closures & resolutions' : 'الترتيب حسب المتابعات والإغلاقات وحل المشكلات') + '</span>' +
            '</div>' +
            '<div id="dash-leaderboard-list">' + feedSkel + '</div>' +
          '</section>';
        case 'bottom_bento':
          return '<div class="dash-bento-bottom" id="dash-bottom-bento">' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z') + t('recent_reservations') + '</h3>' +
                '<button type="button" class="btn btn-sm dash-jump-btn" data-jump="reservations">' + t('view_all') + '</button>' +
              '</div>' +
              '<div id="dash-recent-reservations">' + feedSkel + '</div>' +
            '</section>' +
            '<section class="chart-card">' +
              '<div class="chart-card-head">' +
                '<h3 class="chart-card-title">' + chartHeaderIcon('M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z') + t('active_problems') + '</h3>' +
                '<button type="button" class="btn btn-sm dash-jump-btn" data-jump="problems">' + t('view_all') + '</button>' +
              '</div>' +
              '<div id="dash-open-problems">' + feedSkel + '</div>' +
            '</section>' +
            '<section class="dash-command-banner">' +
              '<div style="position:relative;z-index:1;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
                  '<span class="status-tag" id="dash-banner-stat-pill" style="background:rgba(217,31,43,0.22);color:#FFFFFF;border-color:rgba(217,31,43,0.45);">LIVE CRM</span>' +
                '</div>' +
                '<h3 style="margin:0 0 6px;font-size:18px;font-weight:700;color:#ffffff;">' + t('quick_actions') + '</h3>' +
                '<p style="margin:0;font-size:13px;line-height:1.65;color:#E5E7EB;">' + t('quick_actions_sub') + '</p>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative;z-index:1;">' +
                '<button type="button" class="btn btn-primary dash-jump-btn" data-jump="reservations">' + t('open_reservations') + '</button>' +
                '<button type="button" class="btn dash-jump-btn" data-jump="reports" style="color:#FFFFFF;border-color:rgba(255,255,255,0.26);background:rgba(255,255,255,0.08);">' + t('open_reports') + '</button>' +
                (canHandover && root.RGHandover ? '<button type="button" class="btn rg-ui-handover-btn" id="dash-banner-handover-btn" style="color:#FFFFFF;border-color:rgba(255,255,255,0.26);background:rgba(255,255,255,0.08);">' + (isEn ? 'Shift Handover' : 'تسليم الوردية') + '</button>' : '') +
              '</div>' +
            '</section>' +
          '</div>';
        default:
          return '';
      }
    }

    var visibleIdsList = orderedVisibleDefs.map(function (d) { return d.id; });
    var sectionSpans = (core && core.computeDashboardSectionSpans)
      ? core.computeDashboardSectionSpans(visibleIdsList)
      : null;

    if (!isShellMounted) {
      destroyCharts();

      var hiddenQuickRestore = sectionDefs.filter(function (def) {
        return visBySec[def.id] && visBySec[def.id].allowedByPerm && !visBySec[def.id].hiddenByUiSimp && visBySec[def.id].hiddenByUser;
      });

      var customizeBarHtml = isCustomizeMode
        ? ('<div class="dash-customize-bar" id="dash-customize-bar">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
              '<strong style="font-size:13.5px;color:var(--brand-primary);">' + (isEn ? 'Customize Dashboard Layout' : 'وضع تخصيص وترتيب لوحة التحكم') + '</strong>' +
              '<span style="font-size:12px;color:var(--text-secondary);">' + (isEn ? 'Drag any section card to reorder, or use ▲ ▼ and Hide/Show.' : 'اسحب أي بطاقة لإعادة ترتيبها أو استخدم أزرار ▲ ▼ والإخفاء والإظهار.') + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              (hiddenQuickRestore.length ? '<button type="button" class="btn btn-sm" id="dash-cust-show-all">' + (isEn ? 'Show All Hidden (' + hiddenQuickRestore.length + ')' : 'إظهار المخفي (' + hiddenQuickRestore.length + ')') + '</button>' : '') +
              '<button type="button" class="btn btn-sm" id="dash-cust-reset">' + (isEn ? 'Reset Order' : 'استعادة الافتراضي') + '</button>' +
              '<button type="button" class="btn btn-sm" id="dash-cust-cancel">' + (isEn ? 'Cancel' : 'إلغاء') + '</button>' +
              '<button type="button" class="btn btn-sm btn-primary" id="dash-cust-save">' + (isEn ? 'Save Layout' : 'حفظ التخطيط') + '</button>' +
            '</div>' +
          '</div>')
        : '';

      var justDroppedId = state._justDroppedSec || '';
      if (justDroppedId) state._justDroppedSec = '';
      document.querySelectorAll('.rg-dash-drag-card').forEach(function (g) {
        if (g && g.parentNode) g.parentNode.removeChild(g);
      });

      var sectionsHtml = orderedVisibleDefs.length === 0
        ? '<div class="empty-state" style="grid-column:span 12;">' + (isEn ? 'No dashboard sections enabled for your account.' : 'لا توجد أقسام مفعلة في لوحة التحكم لهذا الحساب. تواصل مع المدير العام أو عدّل التخطيط.') + '</div>'
        : orderedVisibleDefs.map(function (def, idx) {
            var spanCls = (sectionSpans && sectionSpans[def.id]) ? sectionSpans[def.id] : 'dash-sec-full';
            var isHiddenUser = visBySec[def.id].hiddenByUser;
            var spanLabel = spanCls === 'dash-sec-half-wide'
              ? (isEn ? 'Wide Card' : 'بطاقة عريضة')
              : (spanCls === 'dash-sec-half-narrow'
                ? (isEn ? 'Side Card' : 'بطاقة جانبية')
                : (isEn ? 'Full Width' : 'عرض كامل'));
            var custHeader = isCustomizeMode
              ? ('<div class="dash-sec-cust-bar" data-card-title="' + esc(isEn ? def.labelEn : def.labelAr) + '" data-card-span="' + esc(spanLabel) + '">' +
                  '<span class="dash-sec-cust-bar-title"><span class="rg-drag-handle" aria-hidden="true">⋮⋮</span> <span>' + esc(isEn ? def.labelEn : def.labelAr) + '</span>' + (isHiddenUser ? ' <span class="status-tag status-warning">' + (isEn ? 'Hidden' : 'مخفي') + '</span>' : '') + '<span class="dash-sec-drop-cue">· ' + (isEn ? 'Drop here' : 'إفلات هنا') + '</span></span>' +
                  '<div style="display:flex;gap:6px;align-items:center;">' +
                    '<button type="button" class="btn btn-sm dash-sec-move" data-dir="up" data-sec="' + def.id + '" ' + (idx === 0 ? 'disabled' : '') + '>▲</button>' +
                    '<button type="button" class="btn btn-sm dash-sec-move" data-dir="down" data-sec="' + def.id + '" ' + (idx === orderedVisibleDefs.length - 1 ? 'disabled' : '') + '>▼</button>' +
                    '<button type="button" class="btn btn-sm ' + (isHiddenUser ? 'btn-primary' : 'btn-danger') + ' dash-sec-toggle-vis" data-sec="' + def.id + '">' + (isHiddenUser ? (isEn ? 'Show' : 'إظهار') : (isEn ? 'Hide' : 'إخفاء')) + '</button>' +
                  '</div>' +
                '</div>')
              : '';
            return '<div class="dash-sec-wrap ' + spanCls + (isCustomizeMode ? ' is-customizing' : '') + (isHiddenUser ? ' is-user-hidden-preview' : '') + (justDroppedId === def.id ? ' is-just-dropped' : '') + '" data-dash-sec="' + def.id + '">' +
              custHeader +
              buildSectionBodyHtml(def.id) +
            '</div>';
          }).join('');

      container.innerHTML =
        '<div class="dash-command-header">' +
          '<div>' +
            '<h2 class="dash-welcome-title">' + esc(t('dash_welcome') + (firstName || (isEn ? 'Team' : 'بك'))) + '</h2>' +
            '<p class="dash-welcome-sub">' + esc(t('dash_sub_ops')) + '</p>' +
          '</div>' +
          '<div class="dashboard-filter-bar">' +
            ((currentUser && currentUser.role === 'developer') ? '<button type="button" class="btn btn-sm" id="dash-dev-stats-btn">' + (isEn ? 'Stats Visibility Control' : 'تحكم الإحصائيات') + '</button>' : '') +
            '<button type="button" class="btn btn-sm rg-ui-dash-customize' + (isCustomizeMode ? ' btn-primary' : '') + '" id="dash-customize-btn">' + (isEn ? (isCustomizeMode ? 'Done Customizing' : 'Customize Layout') : (isCustomizeMode ? 'إنهاء التخصيص' : 'تخصيص وترتيب اللوحة')) + '</button>' +
            ((root.RGExportMenu && (canExportPdf || canExportExcel))
              ? root.RGExportMenu.renderHtml({
                  wrapId: 'dash-export-wrap',
                  btnId: 'dash-export-btn',
                  small: true,
                  canPdf: canExportPdf,
                  canExcel: canExportExcel,
                  lang: ctx.lang
                })
              : (canExportPdf ? '<button type="button" class="btn btn-sm btn-primary" id="dash-export-pdf">' + (isEn ? 'Export PDF' : 'تصدير PDF') + '</button>' : '')) +
            (canHandover && root.RGHandover ? '<button type="button" class="btn btn-sm btn-charcoal rg-ui-handover-btn" id="dash-shift-handover-btn">' + (isEn ? 'Shift Handover (PDF)' : 'تسليم الوردية (PDF)') + '</button>' : '') +
            '<div class="segmented-control" role="tablist" aria-label="' + t('time_filter') + '">' +
              ['today', '7d', '30d', 'month', 'custom'].map(function (r) {
                var active = state.range === r ? ' active' : '';
                return '<button type="button" class="segmented-btn' + active + '" data-range="' + r + '">' + t('range_' + r) + '</button>';
              }).join('') +
            '</div>' +
            '<div class="toolbar-row" id="dash-custom-dates" style="margin-bottom:0;' + (state.range === 'custom' ? '' : 'display:none;') + '">' +
              '<input type="date" class="input" id="dash-date-from" data-rg-range-pair="dash-range" data-rg-range-role="start" value="' + (state.dateFrom || '') + '" style="width:auto;" aria-label="' + t('from_date') + '">' +
              '<input type="date" class="input" id="dash-date-to" data-rg-range-pair="dash-range" data-rg-range-role="end" value="' + (state.dateTo || '') + '" style="width:auto;" aria-label="' + t('to_date') + '">' +
              '<button type="button" class="btn btn-primary btn-sm" id="dash-apply-custom">' + t('apply') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        customizeBarHtml +
        '<div id="dash-sections-host" class="dash-sections-host" data-layout-sig="' + esc(layoutSig) + '">' +
          sectionsHtml +
        '</div>';

      var sectionsHost = container.querySelector('#dash-sections-host');
      if (sectionsHost) {
        sectionsHost.addEventListener('click', function (ev) {
          var cardBtn = ev.target && ev.target.closest ? ev.target.closest('[data-kpi-route]') : null;
          if (!cardBtn) return;
          var rTarget = cardBtn.getAttribute('data-kpi-route');
          var stFilter = cardBtn.getAttribute('data-kpi-status');
          if (rTarget === 'reservations') {
            ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { status: stFilter || '', viewMode: 'all', page: 1 });
          }
          var navBtn = document.querySelector('.nav-item[data-route="' + rTarget + '"]');
          if (navBtn) navBtn.click();
        });
      }

      var devStatsDashBtn = container.querySelector('#dash-dev-stats-btn');
      if (devStatsDashBtn) {
        devStatsDashBtn.addEventListener('click', function () {
          if (root.RGEmployees && typeof root.RGEmployees.openDeveloperStatsControlModal === 'function') {
            root.RGEmployees.openDeveloperStatsControlModal(ctx, function () {
              loadAndPaint({ forceRefresh: true, isUpdate: true });
            });
          } else {
            ctx.toast('يرجى التوجه إلى صفحة الإعدادات لفتح تحكم الإحصائيات.');
          }
        });
      }

      var customizeBtn = container.querySelector('#dash-customize-btn');
      if (customizeBtn) {
        customizeBtn.addEventListener('click', function () {
          state.customizeMode = !state.customizeMode;
          if (state.customizeMode) {
            state.draftOrder = (layoutPrefs.dashOrder || []).slice();
            state.draftHiddenMap = {};
            (layoutPrefs.dashHidden || []).forEach(function (id) { state.draftHiddenMap[id] = true; });
          } else {
            state.draftOrder = null;
            state.draftHiddenMap = null;
          }
          render(container, ctx, { forceRebuild: true, localOnly: true });
        });
      }

      if (isCustomizeMode) {
        container.querySelectorAll('.dash-sec-wrap .dash-sec-cust-bar').forEach(function (barEl) {
          barEl.addEventListener('pointerdown', function (ev) {
            if (ev.button && ev.button !== 0) return;
            if (ev.target && ev.target.closest && ev.target.closest('button, a, input, select, textarea')) return;
            var secEl = barEl.closest('.dash-sec-wrap[data-dash-sec]');
            if (!secEl) return;

            var srcId = secEl.getAttribute('data-dash-sec') || '';
            if (!srcId) return;

            var startX = ev.clientX;
            var startY = ev.clientY;
            var lastX = startX;
            var lastY = startY;
            var activeDrag = false;
            var dropTargetId = '';
            var ghostEl = null;
            var rafId = 0;
            var scrollInterval = 0;
            var reduced = prefersReducedMotion();

            function buildGhostCard() {
              var cardTitle = barEl.getAttribute('data-card-title') || srcId;
              var cardSpan = barEl.getAttribute('data-card-span') || '';
              var g = document.createElement('div');
              g.className = 'rg-dash-drag-card';
              g.setAttribute('dir', isEn ? 'ltr' : 'rtl');
              g.innerHTML =
                '<div class="rg-dash-drag-card-head">' +
                  '<div class="rg-dash-drag-card-title">' +
                    '<span class="rg-drag-handle" aria-hidden="true">⋮⋮</span>' +
                    '<span>' + esc(cardTitle) + '</span>' +
                  '</div>' +
                  '<span class="rg-dash-drag-card-meta">' + esc(cardSpan) + '</span>' +
                '</div>' +
                '<div class="rg-dash-drag-card-bars"><span></span><span></span></div>';
              document.body.appendChild(g);
              return g;
            }

            function positionGhost(cx, cy) {
              if (!ghostEl) return;
              var w = ghostEl.offsetWidth || 320;
              var h = ghostEl.offsetHeight || 82;
              var tx = Math.round(cx - w / 2);
              var ty = Math.round(cy - Math.min(28, h * 0.35));
              var tilt = reduced ? '' : ' scale(1.03) rotate(' + (isEn ? '-1.5deg' : '1.5deg') + ')';
              ghostEl.style.transform = 'translate3d(' + tx + 'px, ' + ty + 'px, 0)' + tilt;
            }

            function startActiveDrag(cx, cy) {
              activeDrag = true;
              secEl.classList.add('is-dragging');
              document.body.style.userSelect = 'none';
              ghostEl = buildGhostCard();
              positionGhost(cx, cy);
              scrollInterval = root.setInterval(function () {
                if (!activeDrag) return;
                var vh = root.innerHeight || document.documentElement.clientHeight || 800;
                if (lastY < 68) root.scrollBy(0, -14);
                else if (lastY > vh - 68) root.scrollBy(0, 14);
              }, 24);
            }

            function updateDropTarget(cx, cy) {
              var hitEl = document.elementFromPoint(cx, cy);
              var targetSec = hitEl && hitEl.closest ? hitEl.closest('.dash-sec-wrap[data-dash-sec]') : null;
              container.querySelectorAll('.dash-sec-wrap').forEach(function (w) {
                w.classList.remove('is-drop-target');
              });
              if (targetSec && targetSec !== secEl) {
                dropTargetId = targetSec.getAttribute('data-dash-sec') || '';
                targetSec.classList.add('is-drop-target');
              } else {
                dropTargetId = '';
              }
            }

            function onMove(mv) {
              lastX = mv.clientX;
              lastY = mv.clientY;
              if (!activeDrag) {
                if (Math.hypot(lastX - startX, lastY - startY) < 6) return;
                startActiveDrag(lastX, lastY);
              }
              if (rafId) root.cancelAnimationFrame(rafId);
              rafId = root.requestAnimationFrame(function () {
                positionGhost(lastX, lastY);
                updateDropTarget(lastX, lastY);
              });
            }

            function cleanupDrag(cancelled) {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
              document.removeEventListener('pointercancel', onCancel);
              document.removeEventListener('keydown', onKeyDown);
              if (rafId) {
                root.cancelAnimationFrame(rafId);
                rafId = 0;
              }
              if (scrollInterval) {
                root.clearInterval(scrollInterval);
                scrollInterval = 0;
              }
              document.body.style.userSelect = '';
              if (ghostEl && ghostEl.parentNode) {
                ghostEl.parentNode.removeChild(ghostEl);
              }
              ghostEl = null;
              container.querySelectorAll('.dash-sec-wrap').forEach(function (w) {
                w.classList.remove('is-dragging', 'is-drop-target');
              });
              if (!cancelled && activeDrag && srcId && dropTargetId && srcId !== dropTargetId && core && core.reorderListByDragDrop) {
                state._justDroppedSec = srcId;
                state.draftOrder = core.reorderListByDragDrop(state.draftOrder || activeOrder, srcId, dropTargetId);
                render(container, ctx, { forceRebuild: true, localOnly: true });
              }
              activeDrag = false;
            }

            function onUp() {
              cleanupDrag(false);
            }
            function onCancel() {
              cleanupDrag(true);
            }
            function onKeyDown(kev) {
              if (kev && kev.key === 'Escape') cleanupDrag(true);
            }

            document.addEventListener('pointermove', onMove, { passive: true });
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onCancel);
            document.addEventListener('keydown', onKeyDown);
          });
        });

        container.querySelectorAll('.dash-sec-move').forEach(function (mBtn) {
          mBtn.addEventListener('click', function () {
            var sec = mBtn.getAttribute('data-sec');
            var dir = mBtn.getAttribute('data-dir');
            if (core && core.moveOrderItem) {
              var visibleIds = orderedVisibleDefs.map(function (d) { return d.id; });
              var reorderedVis = core.moveOrderItem(visibleIds, sec, dir);
              var curFull = (state.draftOrder || activeOrder).slice();
              var idxCursor = 0;
              state.draftOrder = curFull.map(function (id) {
                return visibleIds.indexOf(id) !== -1 ? reorderedVis[idxCursor++] : id;
              });
              render(container, ctx, { forceRebuild: true, localOnly: true });
            }
          });
        });

        container.querySelectorAll('.dash-sec-toggle-vis').forEach(function (tBtn) {
          tBtn.addEventListener('click', function () {
            var sec = tBtn.getAttribute('data-sec');
            if (!state.draftHiddenMap) state.draftHiddenMap = {};
            if (state.draftHiddenMap[sec]) delete state.draftHiddenMap[sec];
            else state.draftHiddenMap[sec] = true;
            render(container, ctx, { forceRebuild: true, localOnly: true });
          });
        });

        var showAllBtn = container.querySelector('#dash-cust-show-all');
        if (showAllBtn) {
          showAllBtn.addEventListener('click', function () {
            state.draftHiddenMap = {};
            render(container, ctx, { forceRebuild: true, localOnly: true });
          });
        }

        var resetBtn = container.querySelector('#dash-cust-reset');
        if (resetBtn) {
          resetBtn.addEventListener('click', function () {
            state.draftOrder = sectionDefs.map(function (d) { return d.id; });
            state.draftHiddenMap = {};
            render(container, ctx, { forceRebuild: true, localOnly: true });
          });
        }

        var cancelBtn = container.querySelector('#dash-cust-cancel');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            state.customizeMode = false;
            state.draftOrder = null;
            state.draftHiddenMap = null;
            render(container, ctx, { forceRebuild: true, localOnly: true });
          });
        }

        var saveLayoutBtn = container.querySelector('#dash-cust-save');
        if (saveLayoutBtn) {
          saveLayoutBtn.addEventListener('click', async function () {
            var nextHidden = Object.keys(state.draftHiddenMap || {}).filter(function (k) { return state.draftHiddenMap[k]; });
            var nextOrder = (state.draftOrder || activeOrder).slice();
            if (ctx.saveLayoutPrefs) {
              await ctx.saveLayoutPrefs({ dashOrder: nextOrder, dashHidden: nextHidden }, { reRenderNav: false });
            }
            state.customizeMode = false;
            state.draftOrder = null;
            state.draftHiddenMap = null;
            ctx.toast(isEn ? 'Dashboard layout saved.' : 'تم حفظ ترتيب وظهور لوحة التحكم.');
            render(container, ctx, { forceRebuild: true, localOnly: true });
          });
        }
      }

      container.querySelectorAll('.dash-jump-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var targetRoute = btn.getAttribute('data-jump');
          if (targetRoute === 'reservations') {
            ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { viewMode: 'all' });
          }
          var navBtn = document.querySelector('.nav-item[data-route="' + targetRoute + '"]');
          if (navBtn) navBtn.click();
        });
      });

      var openTodayBtn = container.querySelector('#dash-open-today-btn');
      if (openTodayBtn) {
        openTodayBtn.addEventListener('click', function () {
          ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { viewMode: 'today', todayFilter: 'all' });
          var navBtn = document.querySelector('.nav-item[data-route="reservations"]');
          if (navBtn) navBtn.click();
        });
      }

      var openRadarBtn = container.querySelector('#dash-open-radar-btn');
      if (openRadarBtn) {
        openRadarBtn.addEventListener('click', function () {
          ctx.state.reservations = Object.assign(ctx.state.reservations || {}, { viewMode: 'radar', radarFilter: 'all' });
          var navBtn = document.querySelector('.nav-item[data-route="reservations"]');
          if (navBtn) navBtn.click();
        });
      }

      ['#dash-shift-handover-btn', '#dash-banner-handover-btn'].forEach(function (sel) {
        var hoBtn = container.querySelector(sel);
        if (hoBtn && root.RGHandover) {
          hoBtn.addEventListener('click', function () {
            root.RGHandover.openHandoverModal(ctx);
          });
        }
      });

      function buildDashPeriodText() {
        if (state.range === 'custom' && (state.dateFrom || state.dateTo)) {
          return (state.dateFrom || '...') + ' → ' + (state.dateTo || '...');
        }
        return t('range_' + (state.range || 'today')) || (state.range || '');
      }

      function buildDashSummaryItems() {
        var dashPayload = state._lastDashPayload || {};
        var k = dashPayload.kpis || {};
        return [
          { label: t('kpi_total'), value: Number(k.totalReservations || 0) },
          { label: isEn ? 'Delivered' : 'تم التسليم', value: Number(k.delivered || 0) },
          { label: t('kpi_today_followups'), value: Number(k.todayFollowUps || 0) },
          { label: t('kpi_open_problems'), value: Number(k.openProblems || 0) },
          { label: t('kpi_today'), value: Number(k.todayReservations || 0) },
          { label: isEn ? 'Booked' : 'تم الحجز', value: Number(k.booked || 0) },
          { label: isEn ? 'Received' : 'تم الاستلام', value: Number(k.received || 0) },
          { label: t('kpi_high_problems'), value: Number(k.highProblems || 0) }
        ];
      }

      function triggerDashPdf() {
        if (!root.RGReports || typeof root.RGReports.openPdfStudio !== 'function') {
          ctx.toast(isEn ? 'PDF Studio is unavailable.' : 'وحدة تصدير PDF غير متاحة.', true);
          return;
        }
        var dashPayload = state._lastDashPayload || {};
        var summaryItems = buildDashSummaryItems().map(function (it) {
          return { label: it.label, value: String(it.value) };
        });
        var chartDefs = [
          { id: 'chart-daily-followups', title: t('chart_daily_fu') },
          { id: 'chart-status-dist', title: t('chart_status_dist') },
          { id: 'chart-emp-perf', title: t('chart_emp_perf') },
          { id: 'chart-problems-priority', title: t('chart_prb_prio') },
          { id: 'chart-problems-open-closed', title: t('chart_prb_open_closed') },
          { id: 'chart-res-company', title: t('chart_res_company') },
          { id: 'chart-emp-comparison', title: t('chart_emp_comp') }
        ];
        var chartImages = [];
        if (typeof root.RGReports.captureChartForPdf === 'function') {
          chartDefs.forEach(function (cd) {
            var canvas = container.querySelector('#' + cd.id);
            if (canvas) {
              var img = root.RGReports.captureChartForPdf(canvas, cd.title);
              if (img) chartImages.push(img);
            }
          });
        }
        var lb = Array.isArray(dashPayload.leaderboard) ? dashPayload.leaderboard : [];
        var lbCols = [
          { key: 'rank', label: '#', formatType: 'ltr', widthWeight: 0.45 },
          { key: 'name', label: isEn ? 'Employee' : 'الموظف', widthWeight: 1.4 },
          { key: 'followUps', label: isEn ? 'Follow-Ups' : 'المتابعات', widthWeight: 0.9 },
          { key: 'closed', label: isEn ? 'Completed' : 'المنجزة', widthWeight: 0.9 },
          { key: 'problemsResolved', label: isEn ? 'Resolved Problems' : 'مشكلات محلولة', widthWeight: 1.0 },
          { key: 'score', label: isEn ? 'Score' : 'النقاط', widthWeight: 0.8 }
        ];
        var lbRows = lb.map(function (row, idx) {
          return {
            rank: String(idx + 1),
            name: row.name || '-',
            followUps: String(Number(row.followUps || row.followUpsCount || 0)),
            closed: String(Number(row.closed || row.completedCount || 0)),
            problemsResolved: String(Number(row.problemsResolved || row.resolvedProblems || 0)),
            score: String(Number(row.score || 0))
          };
        });
        root.RGReports.openPdfStudio({
          ctx: ctx,
          title: isEn ? 'Dashboard Executive Summary' : 'التقرير التنفيذي للوحة التحكم',
          filename: 'rental-gate-dashboard.pdf',
          scopeKey: 'dashboard',
          availableColumns: lbCols,
          columns: lbRows.length ? lbCols : [],
          rows: lbRows,
          summaryItems: summaryItems,
          chartImages: chartImages,
          initialSettings: { orientation: 'landscape', paperSize: 'a4' }
        });
      }

      async function triggerDashExcel() {
        if (!root.RGReports || typeof root.RGReports.exportExcelWorkbook !== 'function') {
          ctx.toast(isEn ? 'Excel export module is unavailable.' : 'وحدة تصدير Excel غير متاحة.', true);
          return;
        }
        var dashPayload = state._lastDashPayload || {};
        var summaryItems = buildDashSummaryItems();
        var periodStr = buildDashPeriodText();
        var dashTitle = isEn ? 'Dashboard Executive Summary' : 'التقرير التنفيذي للوحة التحكم';
        var kpiCols = [
          { key: 'metric', label: isEn ? 'KPI Metric' : 'المؤشر التشغيلي' },
          { key: 'value', label: isEn ? 'Value' : 'القيمة', formatType: 'number', summable: false }
        ];
        var kpiRows = summaryItems.map(function (it) {
          return { metric: it.label, value: Number(it.value || 0) };
        });

        var sheets = [{
          name: isEn ? 'Executive KPIs' : 'ملخص المؤشرات',
          title: dashTitle,
          periodText: periodStr,
          summaryItems: summaryItems.slice(0, 4),
          headers: kpiCols,
          rows: kpiRows
        }];

        var lb = Array.isArray(dashPayload.leaderboard) ? dashPayload.leaderboard : [];
        if (lb.length) {
          var lbExcelCols = [
            { key: 'rank', label: isEn ? 'Rank' : 'الترتيب', formatType: 'number', summable: false },
            { key: 'name', label: isEn ? 'Employee' : 'الموظف' },
            { key: 'followUps', label: isEn ? 'Follow-Ups' : 'المتابعات', formatType: 'number', summable: true },
            { key: 'closed', label: isEn ? 'Completed' : 'المنجزة', formatType: 'number', summable: true },
            { key: 'problemsResolved', label: isEn ? 'Resolved Problems' : 'مشكلات محلولة', formatType: 'number', summable: true },
            { key: 'completionRate', label: isEn ? 'Completion %' : 'نسبة الإنجاز %', formatType: 'number', summable: false },
            { key: 'score', label: isEn ? 'Score' : 'النقاط', formatType: 'number', summable: true }
          ];
          var lbExcelRows = lb.map(function (row, idx) {
            return {
              rank: Number(row.rank || (idx + 1)),
              name: row.name || '-',
              followUps: Number(row.followUps || row.followUpsCount || 0),
              closed: Number(row.closedBookingsCount !== undefined ? row.closedBookingsCount : (row.closed || row.completedCount || row.closedCount || 0)),
              problemsResolved: Number(row.problemsResolved || row.resolvedProblemsCount || row.resolvedProblems || 0),
              completionRate: Number(row.completionRate || 0),
              score: Number(row.score || 0)
            };
          });
          sheets.push({
            name: isEn ? 'Leaderboard' : 'لوحة الصدارة',
            title: isEn ? 'Team Performance Leaderboard' : 'لوحة الصدارة وأداء الفريق',
            periodText: periodStr,
            headers: lbExcelCols,
            rows: lbExcelRows
          });
        }

        await root.RGReports.exportExcelWorkbook(sheets, 'rental-gate-dashboard.xlsx', {
          lang: ctx.lang,
          title: dashTitle,
          periodText: periodStr
        });
        ctx.toast(isEn ? 'Dashboard exported to Excel successfully.' : 'تم تصدير ملخص لوحة التحكم إلى Excel بنجاح.');
      }

      var dashExportWrap = container.querySelector('#dash-export-wrap');
      if (dashExportWrap && root.RGExportMenu) {
        root.RGExportMenu.bind(dashExportWrap, {
          onPdf: triggerDashPdf,
          onExcel: triggerDashExcel,
          onError: function (err) {
            ctx.toast((err && err.message) || (isEn ? 'Export failed.' : 'تعذر تنفيذ التصدير.'), true);
          }
        });
      }
      var dashPdfBtn = container.querySelector('#dash-export-pdf');
      if (dashPdfBtn) {
        dashPdfBtn.addEventListener('click', triggerDashPdf);
      }

      container.querySelectorAll('[data-range]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var nextRange = btn.getAttribute('data-range');
          state.range = nextRange;
          if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
          container.querySelectorAll('[data-range]').forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          var customWrap = document.getElementById('dash-custom-dates');
          if (customWrap) {
            customWrap.style.display = nextRange === 'custom' ? '' : 'none';
          }
          loadAndPaint({ isUpdate: true });
        });
      });

      ['dash-date-from', 'dash-date-to'].forEach(function (did) {
        var del = document.getElementById(did);
        if (!del) return;
        del.addEventListener('change', function () {
          var fEl = document.getElementById('dash-date-from');
          var tEl = document.getElementById('dash-date-to');
          if (fEl) state.dateFrom = fEl.value || '';
          if (tEl) state.dateTo = tEl.value || '';
          if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
        });
      });

      var applyBtn = document.getElementById('dash-apply-custom');
      if (applyBtn) {
        applyBtn.addEventListener('click', function () {
          var customWrap = document.getElementById('dash-custom-dates');
          if (root.RGCrmDatePicker && root.RGCrmDatePicker.validateContainerDates && customWrap) {
            var vCheck = root.RGCrmDatePicker.validateContainerDates(customWrap);
            if (!vCheck.valid) {
              ctx.toast(vCheck.message || 'يرجى التحقق من صحة التواريخ المدخلة.', true);
              return;
            }
          }
          var runApply = function () {
            state.dateFrom = document.getElementById('dash-date-from').value;
            state.dateTo = document.getElementById('dash-date-to').value;
            if (ctx && ctx.saveRouteFilters) ctx.saveRouteFilters();
            return loadAndPaint({ isUpdate: true });
          };
          if (ctx.withActionLock) {
            ctx.withActionLock(applyBtn, 'dashboard:custom', runApply);
          } else {
            runApply();
          }
        });
      }
    } else {
      container.querySelectorAll('[data-range]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-range') === state.range);
      });
      var cw = document.getElementById('dash-custom-dates');
      if (cw) cw.style.display = state.range === 'custom' ? '' : 'none';
    }

    function renderFeedErrorBanner(host, msg, onRetry) {
      if (!host) return;
      host.innerHTML =
        '<div class="rg-error-banner" role="alert">' +
          '<div class="rg-error-banner-body">' +
            '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load data' : 'تعذر تحميل البيانات') + '</div>' +
            '<div class="rg-error-banner-msg">' + esc(msg || (isEn ? 'Please retry.' : 'يرجى إعادة المحاولة.')) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-primary rg-feed-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
        '</div>';
      var rBtn = host.querySelector('.rg-feed-retry-btn');
      if (rBtn && typeof onRetry === 'function') {
        rBtn.addEventListener('click', onRetry);
      }
    }

    async function loadSecondaryFeeds(seq, preloadedActivity, forceLocalOnly) {
      try {
        var needActivity = Boolean(visBySec.recent_activity && visBySec.recent_activity.shouldRenderData);
        var needRes = Boolean(
          (visBySec.bottom_bento && visBySec.bottom_bento.shouldRenderData) ||
          (visBySec.peak_heatmap && visBySec.peak_heatmap.shouldRenderData)
        );
        var needRadar = Boolean(visBySec.expiry_radar && visBySec.expiry_radar.shouldRenderData);
        var needPrb = Boolean(
          (visBySec.bottom_bento && visBySec.bottom_bento.shouldRenderData) ||
          (visBySec.peak_heatmap && visBySec.peak_heatmap.shouldRenderData)
        );
        if (!needActivity && !needRes && !needPrb && !needRadar) return;

        var cachedSec = state._lastSecondaryData || null;
        var hasCachedAct = Boolean(cachedSec && Array.isArray(cachedSec.actItems));
        var hasCachedRes = Boolean(cachedSec && Array.isArray(cachedSec.resItems));
        var hasCachedPrb = Boolean(cachedSec && Array.isArray(cachedSec.prbItems));
        var hasCachedRadar = Boolean(cachedSec && Array.isArray(cachedSec.radarItems));

        var actFromDash = Array.isArray(preloadedActivity) ? preloadedActivity : null;
        var fetchAct = needActivity && !actFromDash && !(forceLocalOnly && hasCachedAct);
        var fetchRes = needRes && !(forceLocalOnly && hasCachedRes);
        var fetchPrb = needPrb && !(forceLocalOnly && hasCachedPrb);
        var fetchRadar = needRadar && !(forceLocalOnly && hasCachedRadar);

        var actItems = actFromDash || (hasCachedAct ? cachedSec.actItems : []);
        var resItems = hasCachedRes ? cachedSec.resItems : [];
        var prbItems = hasCachedPrb ? cachedSec.prbItems : [];
        var radarItems = hasCachedRadar ? cachedSec.radarItems : [];

        var actErr = '';
        var resErr = '';
        var prbErr = '';
        var radarErr = '';

        if (fetchAct || fetchRes || fetchPrb || fetchRadar) {
          var todayDateStr = (root.RGCrmCore && root.RGCrmCore.getRiyadhDateString)
            ? root.RGCrmCore.getRiyadhDateString()
            : '';
          var [actRes, resRes, prbRes, radarRes] = await Promise.all([
            fetchAct ? root.RGApi.callApi('getActivityLogs', { silentRefresh: true, abortKey: 'dash:act' }) : Promise.resolve(null),
            fetchRes ? root.RGApi.callApi('getReservations', { page: 1, pageSize: 200, silentRefresh: true, abortKey: 'dash:res' }) : Promise.resolve(null),
            fetchPrb ? root.RGApi.callApi('getProblems', { silentRefresh: true, abortKey: 'dash:prb' }) : Promise.resolve(null),
            fetchRadar ? root.RGApi.callApi('getTodayAndRadar', { todayDate: todayDateStr, nowMs: Date.now(), silentRefresh: true, abortKey: 'dash:radar' }) : Promise.resolve(null)
          ]);
          if (seq !== dashLoadSeq || !container.isConnected) return;

          if (actRes && !actRes.aborted) {
            if (actRes.success && actRes.data && Array.isArray(actRes.data.items)) {
              actItems = actRes.data.items;
            } else if (!actRes.success && !hasCachedAct) {
              actErr = actRes.message || 'تعذر تحميل سجل النشاطات.';
            }
          }
          if (resRes && !resRes.aborted) {
            if (resRes.success && resRes.data && Array.isArray(resRes.data.items)) {
              resItems = resRes.data.items;
            } else if (!resRes.success && !hasCachedRes) {
              resErr = resRes.message || 'تعذر تحميل الحجوزات.';
            }
          }
          if (prbRes && !prbRes.aborted) {
            if (prbRes.success && prbRes.data && Array.isArray(prbRes.data.items)) {
              prbItems = prbRes.data.items;
            } else if (!prbRes.success && !hasCachedPrb) {
              prbErr = prbRes.message || 'تعذر تحميل المشكلات.';
            }
          }
          if (radarRes && !radarRes.aborted) {
            var rData = radarRes.data;
            var rItems = null;
            if (radarRes.success && rData) {
              if (Array.isArray(rData.items)) {
                rItems = rData.items;
              } else {
                var byIdR = {};
                var collectedR = [];
                var pushR = function (arr) {
                  if (!Array.isArray(arr)) return;
                  arr.forEach(function (entry) {
                    var rv = (entry && entry.reservation && entry.reservation.id) ? entry.reservation : entry;
                    if (rv && rv.id && !byIdR[rv.id]) {
                      byIdR[rv.id] = true;
                      collectedR.push(rv);
                    }
                  });
                };
                if (rData.radarSummary) { pushR(rData.radarSummary.allItems); pushR(rData.radarSummary.items); }
                if (rData.todaySummary) { pushR(rData.todaySummary.allItems); pushR(rData.todaySummary.items); }
                if (collectedR.length > 0 || (rData.counts && Number(rData.counts.radarTotal || 0) === 0)) {
                  rItems = collectedR;
                }
              }
            }
            if (rItems !== null) {
              radarItems = rItems;
            } else if (!hasCachedRadar) {
              if (resItems.length > 0) {
                radarItems = resItems;
              } else if (!radarRes.success) {
                radarErr = radarRes.message || 'تعذر تحميل بيانات رادار 24 ساعة.';
              }
            }
          }
          state._lastSecondaryData = {
            actItems: actItems,
            resItems: resItems,
            prbItems: prbItems,
            radarItems: radarItems
          };
        } else if (actFromDash && (!cachedSec || !cachedSec.actItems)) {
          state._lastSecondaryData = {
            actItems: actItems,
            resItems: resItems,
            prbItems: prbItems,
            radarItems: radarItems
          };
        }

        var dashTimeFormat = ctx.getTimeFormat ? ctx.getTimeFormat() : undefined;
        var retrySecondary = function () {
          loadSecondaryFeeds(dashLoadSeq, null, false);
        };
        if (needActivity) {
          var actHost = container.querySelector('#dash-recent-activity');
          if (actErr) renderFeedErrorBanner(actHost, actErr, retrySecondary);
          else renderLiveActivityFeed(actHost, actItems, ctx.lang, dashTimeFormat);
        }
        if (visBySec.bottom_bento && visBySec.bottom_bento.shouldRenderData) {
          var recentResHost = container.querySelector('#dash-recent-reservations');
          if (resErr) renderFeedErrorBanner(recentResHost, resErr, retrySecondary);
          else renderRecentReservationsFeed(recentResHost, resItems.slice(0, 4), ctx);

          var openPrbHost = container.querySelector('#dash-open-problems');
          if (prbErr) renderFeedErrorBanner(openPrbHost, prbErr, retrySecondary);
          else renderActiveProblemsFeed(openPrbHost, prbItems, ctx);
        }
        if (needRadar) {
          var radarFeedHost = container.querySelector('#dash-expiry-radar-feed');
          var radarBadgeHost = container.querySelector('#dash-radar-count');
          if (radarErr) {
            renderFeedErrorBanner(radarFeedHost, radarErr, retrySecondary);
          } else {
            renderExpiryRadarFeed(
              radarFeedHost,
              radarBadgeHost,
              radarItems.length ? radarItems : resItems,
              ctx
            );
          }
        }
        if (visBySec.peak_heatmap && visBySec.peak_heatmap.shouldRenderData) {
          renderPeakHoursHeatmap(
            container.querySelector('#dash-peak-heatmap'),
            resItems,
            prbItems,
            { lang: ctx.lang, timeFormat: dashTimeFormat }
          );
        }
      } catch (e) {}
    }

    var dashDeltaState = {
      todayRadarCounts: (state._lastDashPayload && state._lastDashPayload.todayRadarCounts) || null,
      announcementsFp: ''
    };

    async function loadAndPaint(paintOpts) {
      var pOpts = paintOpts || {};
      var seq = ++dashLoadSeq;
      var sectionsHost = container.querySelector('#dash-sections-host');
      var prevDash = state._lastDashPayload || null;
      var dashData = null;
      var core = root.RGCrmCore || {};

      if (pOpts.localOnly && prevDash) {
        dashData = prevDash;
      } else {
        var res = await root.RGApi.callApi('getDashboard', {
          range: state.range,
          dateFrom: state.dateFrom,
          dateTo: state.dateTo,
          silentRefresh: Boolean(pOpts.silentRefresh),
          forceRefresh: Boolean(pOpts.forceRefresh),
          abortKey: 'dash:main'
        });
        if (seq !== dashLoadSeq || !container.isConnected) return;
        if (res && res.aborted) return;

        if (!res || !res.success || !res.data || typeof res.data !== 'object') {
          var hasRenderedKpis = Boolean(prevDash && sectionsHost && sectionsHost.querySelector('#dash-kpis-hero'));
          if (hasRenderedKpis) {
            if (!pOpts.silentRefresh && ctx && typeof ctx.toast === 'function') {
              ctx.toast((res && res.message) || (isEn ? 'Unable to sync latest stats — showing last verified snapshot.' : 'تعذر مزامنة أحدث الإحصائيات — يتم الاحتفاظ بآخر أرقام صحيحة.'), true);
            }
            return;
          }
          if (!pOpts.silentRefresh && sectionsHost) {
            sectionsHost.innerHTML =
              '<div class="rg-error-banner" role="alert" style="grid-column:span 12;">' +
                '<div class="rg-error-banner-body">' +
                  '<div class="rg-error-banner-title">' + (isEn ? 'Failed to load dashboard' : 'تعذر تحميل لوحة التحكم') + '</div>' +
                  '<div class="rg-error-banner-msg">' + esc((res && res.message) || 'تعذر تحميل لوحة التحكم.') + '</div>' +
                '</div>' +
                '<button type="button" class="btn btn-sm btn-primary" id="dash-retry-btn">' + (isEn ? 'Retry' : 'إعادة المحاولة') + '</button>' +
              '</div>';
            var dashRetryBtn = document.getElementById('dash-retry-btn');
            if (dashRetryBtn) {
              dashRetryBtn.addEventListener('click', function () {
                render(container, ctx, { forceRebuild: true });
              });
            }
          }
          return;
        }
        dashData = (typeof core.resolveSwrSnapshot === 'function')
          ? core.resolveSwrSnapshot(prevDash, res.data, function (d) { return Boolean(d && d.kpis && typeof d.kpis === 'object'); })
          : res.data;
        if (!dashData) return;
        state._lastDashPayload = dashData;
      }

      if (dashData.todayRadarCounts && typeof dashData.todayRadarCounts === 'object') {
        dashDeltaState.todayRadarCounts = Object.assign({}, dashData.todayRadarCounts);
      }

      var hasRenderedHero = Boolean(sectionsHost && sectionsHost.querySelector('#dash-kpis-hero'));
      var snapshotChanged = !prevDash || !hasRenderedHero || Boolean(pOpts.forceRepaint) || (
        typeof core.haveDashboardSnapshotsChanged === 'function'
          ? core.haveDashboardSnapshotsChanged(prevDash, dashData)
          : true
      );

      var kpisData = dashData.kpis || {};
      var chartsData = dashData.charts || {};

      if (snapshotChanged) {
        paintKpis(sectionsHost, kpisData, chartsData, t, ctx.lang);

        var radarCountEl = container.querySelector('#dash-radar-count');
        if (radarCountEl && dashData.todayRadarCounts && typeof dashData.todayRadarCounts.radarCount === 'number') {
          radarCountEl.textContent = String(dashData.todayRadarCounts.radarCount);
        }

        var statPill = container.querySelector('#dash-banner-stat-pill');
        if (statPill) {
          statPill.textContent = ctx.lang === 'en'
            ? (Number(kpisData.todayFollowUps || 0) + ' Follow-Ups Today')
            : (Number(kpisData.todayFollowUps || 0) + ' متابعة اليوم');
        }

        ctx.state.lastDashboardCharts = chartsData;
        renderCharts(chartsData, t, ctx, Boolean(pOpts.isUpdate || isShellMounted || pOpts.localOnly));
        if (visBySec.leaderboard && visBySec.leaderboard.shouldRenderData) {
          renderLeaderboardCard(container.querySelector('#dash-leaderboard-list'), dashData.leaderboard || [], ctx);
        }
        if (!hasRenderedHero && sectionsHost && root.RGApp && typeof root.RGApp.animateProgressiveReveal === 'function') {
          root.RGApp.animateProgressiveReveal(sectionsHost);
        }
      }
      if (!pOpts.isUpdate || snapshotChanged || pOpts.syncSecondary) {
        loadSecondaryFeeds(seq, dashData.recentActivity, Boolean(pOpts.localOnly));
      }
    }

    if (!container._rgDashDeltaBound) {
      container._rgDashDeltaBound = true;
      var onDashDeltaSync = function (ev) {
        if (!container || !container.isConnected) {
          document.removeEventListener('rg:deltasync', onDashDeltaSync);
          return;
        }
        var d = (ev && ev.detail) || {};
        var core = root.RGCrmCore || {};
        var relevant = (typeof core.hasMeaningfulDeltaChanges === 'function')
          ? core.hasMeaningfulDeltaChanges(d, dashDeltaState)
          : Boolean(
              (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
              (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
              (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
              (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
              (Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0) ||
              (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
              (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
              (Array.isArray(d.deletedAnnouncementIds) && d.deletedAnnouncementIds.length > 0) ||
              Boolean(d.deletedAllReservationsBefore) ||
              Boolean(d.changedSettings) ||
              Boolean(d.changedDelegations) ||
              Boolean(d.changedRoles)
            );
        if (d.todayRadarCounts && typeof d.todayRadarCounts === 'object') {
          dashDeltaState.todayRadarCounts = Object.assign({}, d.todayRadarCounts);
        }
        if (Array.isArray(d.announcements) && typeof core.computeDataFingerprint === 'function') {
          dashDeltaState.announcementsFp = core.computeDataFingerprint(d.announcements);
        }
        if (relevant) {
          var hasSecondaryChanges = Boolean(
            (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
            (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
            (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
            (Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0) ||
            (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
            Boolean(d.deletedAllReservationsBefore)
          );
          loadAndPaint({
            isUpdate: true,
            silentRefresh: true,
            forceRefresh: true,
            syncSecondary: hasSecondaryChanges
          }).catch(function () {});
        }
      };
      document.addEventListener('rg:deltasync', onDashDeltaSync);
    }

    container._rgRefreshDataOnly = function (refreshOpts) {
      var rOpts = refreshOpts || {};
      return loadAndPaint({
        isUpdate: true,
        silentRefresh: rOpts.silent !== false,
        forceRefresh: Boolean(rOpts.forceRefresh)
      });
    };

    await loadAndPaint({
      isUpdate: isShellMounted,
      silentRefresh: Boolean(options.silent),
      localOnly: Boolean(options.localOnly)
    });
  }

  function refreshTheme(ctx) {
    var host = document.getElementById('dash-sections-host');
    if (!host || !ctx || !ctx.state) return;
    if (ctx.state.lastDashboardCharts) {
      renderCharts(ctx.state.lastDashboardCharts, ctx.t, ctx, true, true);
    }
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var charcoalSpark = document.querySelector('#dash-kpis-hero .kpi-hero-charcoal .kpi-sparkline path:last-of-type');
    if (charcoalSpark) {
      charcoalSpark.setAttribute('stroke', isDark ? '#D1D5DB' : '#292929');
    }
  }

  root.RGDashboard = {
    render: render,
    destroyCharts: destroyCharts,
    refreshTheme: refreshTheme,
    renderPeakHoursHeatmap: renderPeakHoursHeatmap
  };
})(window);
