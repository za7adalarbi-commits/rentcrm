/**
 * RENTAL GATE CRM — Reports Filtering & Analytical Datasets
 */

function computeReservationFacets_(reservations) {
  var companiesMap = {};
  var branchesMap = {};
  for (var i = 0; i < reservations.length; i++) {
    if (reservations[i].companyName) companiesMap[reservations[i].companyName] = true;
    if (reservations[i].branchName) branchesMap[reservations[i].branchName] = true;
  }
  var facets = {
    companies: Object.keys(companiesMap).sort(),
    branches: Object.keys(branchesMap).sort()
  };
  var key = 'RG_FACETS_V' + getCacheVersion_('RES');
  putCompressedJsonCache_(key, facets, 600);
  return facets;
}

function getCachedReservationFacets_() {
  var key = 'RG_FACETS_V' + getCacheVersion_('RES');
  var parsed = getCompressedJsonCache_(key);
  if (parsed && Array.isArray(parsed.companies) && Array.isArray(parsed.branches)) {
    return parsed;
  }
  var reservations = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  return computeReservationFacets_(reservations);
}

function getReports(session, params) {
  var p = params || {};
  var reportType = normalizeStr(p.reportType) || 'all_reservations';
  var dateFrom = normalizeStr(p.dateFrom);
  var dateTo = normalizeStr(p.dateTo);
  var employeeId = normalizeStr(p.employeeId);
  var status = normalizeStr(p.status);
  var company = normalizeStr(p.company);
  var branch = normalizeStr(p.branch);
  var priority = normalizeStr(p.priority);

  if (toBool(p.logExport)) {
    logActivity(session.user, 'تصدير تقرير', 'Report', reportType, 'تصدير تقرير: ' + reportType);
  }

  if (reportType === 'followups_log') {
    var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    var fuRows = followUps.filter(function (x) {
      if (dateFrom && x.followUpDate < dateFrom) return false;
      if (dateTo && x.followUpDate > dateTo) return false;
      if (employeeId && x.employeeId !== employeeId) return false;
      if (status && x.status !== status) return false;
      return true;
    });
    return { reportType: reportType, rows: fuRows, facets: getCachedReservationFacets_() };
  }

  if (reportType === 'problems') {
    var problems = readAllRecords(RG_SHEETS.PROBLEMS, false);
    var prRows = problems.map(formatProblemForClient).filter(function (pr) {
      if (priority && pr.priority !== priority) return false;
      if (status && pr.status !== status) return false;
      if (employeeId && pr.assignedEmployeeIds.indexOf(employeeId) === -1) return false;
      if (dateFrom && formatDateOnly(pr.createdAt) < dateFrom) return false;
      if (dateTo && formatDateOnly(pr.createdAt) > dateTo) return false;
      return true;
    });
    return { reportType: reportType, rows: prRows, facets: getCachedReservationFacets_() };
  }

  if (reportType === 'extensions') {
    var extensions = readAllRecords(RG_SHEETS.EXTENSIONS, false);
    var extRows = (dateFrom || dateTo) ? extensions.filter(function (ex) {
      var d = formatDateOnly(ex.startDate);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    }) : extensions;
    return { reportType: reportType, rows: extRows, facets: getCachedReservationFacets_() };
  }

  if (reportType === 'sync_log') {
    var syncRows = readAllRecords(RG_SHEETS.SYNC_LOG, false).slice();
    syncRows.sort(function (a, b) {
      return String(b.startedAt).localeCompare(String(a.startedAt));
    });
    return { reportType: reportType, rows: syncRows, facets: getCachedReservationFacets_() };
  }

  if (reportType === 'activity_log') {
    var logRes = getActivityLogs(session, {
      userId: employeeId,
      dateFrom: dateFrom,
      dateTo: dateTo,
      actionType: normalizeStr(p.actionType),
      search: normalizeStr(p.search)
    });
    return { reportType: reportType, rows: logRes.items, facets: getCachedReservationFacets_() };
  }

  var reservations = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var facets = computeReservationFacets_(reservations);

  if (reportType === 'employee_performance') {
    var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
    var allFus = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    var allPrbs = readAllRecords(RG_SHEETS.PROBLEMS, false);

    var fuByEmp = {};
    for (var fi = 0; fi < allFus.length; fi++) {
      var feid = allFus[fi].employeeId;
      fuByEmp[feid] = (fuByEmp[feid] || 0) + 1;
    }
    var resByEmp = {};
    for (var ri = 0; ri < reservations.length; ri++) {
      var rids = safeJsonParse(reservations[ri].assignedEmployeeIds, []);
      for (var rj = 0; rj < rids.length; rj++) {
        resByEmp[rids[rj]] = (resByEmp[rids[rj]] || 0) + 1;
      }
    }
    var prbByEmp = {};
    for (var pi = 0; pi < allPrbs.length; pi++) {
      var pids = safeJsonParse(allPrbs[pi].assignedEmployeeIds, []);
      for (var pj = 0; pj < pids.length; pj++) {
        prbByEmp[pids[pj]] = (prbByEmp[pids[pj]] || 0) + 1;
      }
    }

    var perf = employees.map(function (emp) {
      return {
        employeeName: emp.name,
        jobTitle: emp.jobTitle,
        role: emp.role,
        assignedReservations: resByEmp[emp.id] || 0,
        followUpsCount: fuByEmp[emp.id] || 0,
        problemsCount: prbByEmp[emp.id] || 0,
        lastActivity: emp.lastActivity
      };
    });
    return { reportType: reportType, rows: perf, facets: facets };
  }

  var filteredRes = reservations.filter(function (r) {
    if (dateFrom && r.startDate < dateFrom) return false;
    if (dateTo && r.startDate > dateTo) return false;
    if (company && r.companyName !== company) return false;
    if (branch && r.branchName !== branch) return false;
    if (status && r.internalStatus !== status) return false;
    if (priority && r.priority !== priority) return false;
    if (employeeId) {
      var ids = safeJsonParse(r.assignedEmployeeIds, []);
      if (ids.indexOf(employeeId) === -1) return false;
    }
    return true;
  });

  if (reportType === 'unfollowed') {
    var fusForUnfollowed = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    var followedSet = {};
    for (var f = 0; f < fusForUnfollowed.length; f++) followedSet[fusForUnfollowed[f].reservationId] = true;
    return {
      reportType: reportType,
      rows: filteredRes.filter(function (r) { return !followedSet[r.id]; }),
      facets: facets
    };
  }

  if (reportType === 'priorities') {
    var prioRank = { 'مرتفع': 0, 'متوسط': 1, 'عادي': 2 };
    filteredRes.sort(function (a, b) {
      var ra = prioRank[a.priority] !== undefined ? prioRank[a.priority] : 3;
      var rb = prioRank[b.priority] !== undefined ? prioRank[b.priority] : 3;
      return ra - rb;
    });
  }

  return { reportType: reportType, rows: filteredRes, facets: facets };
}
