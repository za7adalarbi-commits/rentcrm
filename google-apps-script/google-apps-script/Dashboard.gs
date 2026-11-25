/**
 * RENTAL GATE CRM — Dashboard KPIs & Charts Aggregation
 */

function resolveDateRange(rangeKey, customFrom, customTo) {
  var today = new Date();
  var end = formatDateOnly(today);
  var start = '';

  if (rangeKey === 'today') {
    start = end;
  } else if (rangeKey === '7d') {
    start = formatDateOnly(new Date(today.getTime() - 6 * 86400000));
  } else if (rangeKey === '30d') {
    start = formatDateOnly(new Date(today.getTime() - 29 * 86400000));
  } else if (rangeKey === 'month') {
    start = end.substring(0, 7) + '-01';
  } else if (rangeKey === 'custom') {
    start = normalizeStr(customFrom);
    end = normalizeStr(customTo) || end;
  }
  return { start: start, end: end };
}

var _rgDashMemCache = {};

function getDashboard(session, params) {
  var p = params || {};
  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');

  var rangeKey = normalizeStr(p.range) || '30d';
  var todayStr = formatDateOnly(new Date());
  var isStandardRange = (rangeKey === 'today' || rangeKey === '7d' || rangeKey === '30d' || rangeKey === 'month');
  var verKey = getCacheVersion_('RES') + '_' + getCacheVersion_('FU') + '_' + getCacheVersion_('PRB');
  var roleScopeKey = restrictToAgent ? session.employeeId : 'ALL';
  var cacheKey = isStandardRange ? ('RG_DASH_V' + verKey + '_' + roleScopeKey + '_' + rangeKey) : '';

  if (cacheKey && !toBool(p.forceRefresh)) {
    if (_rgDashMemCache[cacheKey] && _rgDashMemCache[cacheKey].dateStr === todayStr) {
      return _rgDashMemCache[cacheKey].data;
    }
    var cachedObj = getCompressedJsonCache_(cacheKey);
    if (cachedObj && cachedObj.dateStr === todayStr && cachedObj.data) {
      _rgDashMemCache[cacheKey] = cachedObj;
      return cachedObj.data;
    }
  }

  var range = resolveDateRange(rangeKey, p.dateFrom, p.dateTo);
  var reservations = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
  var problems = readAllRecords(RG_SHEETS.PROBLEMS, false);
  var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);

  var statusCounts = {
    'تم الحجز': 0,
    'تم التسليم': 0,
    'تم الاستلام': 0,
    'تم الإنشاء': 0,
    'تم الإلغاء': 0,
    'تم التمديد': 0,
    'لم يتم الحجز': 0
  };

  var companyCounts = {};
  var assignedCountsByEmp = {};
  var filteredTotal = 0;
  var todayReservations = 0;
  var newReservations = 0;
  var cancelledCount = 0;
  var rejectedCount = 0;

  for (var i = 0; i < reservations.length; i++) {
    var res = reservations[i];
    if (restrictToAgent) {
      var rawMy = String(res.assignedEmployeeIds || '');
      if (rawMy.indexOf(session.employeeId) === -1) continue;
      if (safeJsonParse(rawMy, []).indexOf(session.employeeId) === -1) continue;
    }
    var d = formatDateOnly(res.startDate || res.createdAt);
    if (range.start && d < range.start) continue;
    if (range.end && d > range.end) continue;

    filteredTotal++;
    var st = res.internalStatus || 'تم الإنشاء';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    var lcKind = typeof classifyReservationLifecycleGs_ === 'function' ? classifyReservationLifecycleGs_(res) : 'active';
    if (lcKind === 'cancelled') cancelledCount++;
    else if (lcKind === 'rejected') rejectedCount++;
    if (formatDateOnly(res.createdAt) === todayStr || formatDateOnly(res.startDate) === todayStr) {
      todayReservations++;
    }
    if (st === 'تم الإنشاء' || st === 'جديد' || st === 'قيد الانتظار' || st === 'معلق') newReservations++;
    var comp = res.companyName || 'غير محدد';
    companyCounts[comp] = (companyCounts[comp] || 0) + 1;

    var aIds = safeJsonParse(res.assignedEmployeeIds, []);
    if (Array.isArray(aIds)) {
      for (var ai = 0; ai < aIds.length; ai++) {
        var eid = aIds[ai];
        if (eid) assignedCountsByEmp[eid] = (assignedCountsByEmp[eid] || 0) + 1;
      }
    }
  }

  var todayFollowUps = 0;
  var dailyFollowUps = {};
  var empFollowUpCounts = {};

  for (var f = 0; f < followUps.length; f++) {
    var fu = followUps[f];
    if (fu.followUpDate === todayStr) todayFollowUps++;
    if (range.start && fu.followUpDate < range.start) continue;
    if (range.end && fu.followUpDate > range.end) continue;
    dailyFollowUps[fu.followUpDate] = (dailyFollowUps[fu.followUpDate] || 0) + 1;
    empFollowUpCounts[fu.employeeName] = (empFollowUpCounts[fu.employeeName] || 0) + 1;
  }

  var openProblems = 0;
  var closedProblems = 0;
  var highProblems = 0;
  var problemPriorities = { 'عادي': 0, 'متوسط': 0, 'مرتفع': 0 };

  for (var prIdx = 0; prIdx < problems.length; prIdx++) {
    var pr = problems[prIdx];
    var isClosed = pr.status === 'مغلقة' || pr.status === 'تم الحل';
    if (isClosed) closedProblems++;
    else openProblems++;
    if (pr.priority === 'مرتفع' && !isClosed) highProblems++;
    if (Object.prototype.hasOwnProperty.call(problemPriorities, pr.priority)) {
      problemPriorities[pr.priority]++;
    }
  }

  var empActivityComparison = [];
  for (var e = 0; e < employees.length; e++) {
    var emp = employees[e];
    if (emp.status !== 'active') continue;
    empActivityComparison.push({
      name: emp.name,
      followUps: empFollowUpCounts[emp.name] || 0,
      assigned: assignedCountsByEmp[emp.id] || 0
    });
  }

  var todayRadarCounts = null;
  if (typeof getTodayAndRadar === 'function') {
    try {
      var trSummary = getTodayAndRadar(session, { summaryOnly: true, todayDate: todayStr });
      if (trSummary && trSummary.counts) todayRadarCounts = trSummary.counts;
    } catch (_trErr) {}
  }

  var result = {
    kpis: {
      totalReservations: filteredTotal,
      todayReservations: todayReservations,
      newReservations: newReservations,
      booked: statusCounts['تم الحجز'] || 0,
      delivered: statusCounts['تم التسليم'] || 0,
      received: statusCounts['تم الاستلام'] || 0,
      created: statusCounts['تم الإنشاء'] || 0,
      cancelled: cancelledCount,
      rejected: rejectedCount,
      extended: statusCounts['تم التمديد'] || 0,
      notBooked: statusCounts['لم يتم الحجز'] || 0,
      openProblems: openProblems,
      highProblems: highProblems,
      todayFollowUps: todayFollowUps
    },
    charts: {
      statusDistribution: statusCounts,
      employeePerformance: empFollowUpCounts,
      dailyFollowUps: dailyFollowUps,
      problemsByPriority: problemPriorities,
      problemsOpenVsClosed: { open: openProblems, closed: closedProblems },
      reservationsByCompany: companyCounts,
      employeeComparison: empActivityComparison
    },
    todayRadarCounts: todayRadarCounts
  };

  if (cacheKey) {
    var payloadToCache = { dateStr: todayStr, data: result };
    _rgDashMemCache[cacheKey] = payloadToCache;
    putCompressedJsonCache_(cacheKey, payloadToCache, 180);
  }

  return result;
}

function getAppBootstrap(session, params) {
  var map = getSettingsMap_(false);
  var canDash = hasPermission(session, 'view_dashboard');
  var dashData = canDash ? getDashboard(session, params || { range: '30d' }) : null;
  var uiSimplification = normalizeUiSimplificationSettings_(map.ui_simplification);
  var handoverSettings = typeof normalizeHandoverSettings_ === 'function'
    ? normalizeHandoverSettings_(map.handover_settings)
    : {};
  var announcementsData = typeof getAnnouncements === 'function'
    ? getAnnouncements(session)
    : { items: [], activeItems: [] };
  var locksData = typeof getReservationLocks === 'function'
    ? getReservationLocks(session)
    : { items: [] };
  var settingsOut = null;
  if (canAccessApi(session.user || session)) {
    settingsOut = getSettings(session);
  }
  return {
    user: session.user,
    me: { user: session.user },
    dashboard: dashData,
    todayRadarCounts: dashData && dashData.todayRadarCounts ? dashData.todayRadarCounts : null,
    notifications: getNotifications(session),
    employees: getEmployees(session),
    problems: getProblems(session, {}),
    settings: settingsOut,
    uiSimplification: uiSimplification,
    handoverSettings: handoverSettings,
    announcements: announcementsData.activeItems || [],
    activeLocks: locksData.items || [],
    layoutPrefs: normalizeUserLayoutPrefs_(map['layout_prefs_u_' + session.employeeId]),
    pinnedCriticalIds: getUserPinnedCriticalIds_(session.employeeId)
  };
}

