/**
 * RENTAL GATE CRM — Reservations Query, Details & Direct Status Service
 */

function getReservations(session, params) {
  var p = params || {};
  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');

  var search = normalizeStr(p.search).toLowerCase();
  var company = normalizeStr(p.company);
  var branch = normalizeStr(p.branch);
  var status = normalizeStr(p.status);
  var employeeId = normalizeStr(p.employeeId);
  var priority = normalizeStr(p.priority);
  var dateFrom = normalizeStr(p.dateFrom);
  var dateTo = normalizeStr(p.dateTo);
  var unfollowedOnly = toBool(p.unfollowedOnly);
  var hasProblemsOnly = toBool(p.hasProblemsOnly);
  var sortBy = normalizeStr(p.sortBy) || 'lastUpdatedAt';
  var sortDir = normalizeStr(p.sortDir) === 'asc' ? 1 : -1;
  var page = Math.max(1, toNumber(p.page, 1));
  var pageSize = Math.min(200, Math.max(1, toNumber(p.pageSize, 25)));

  var isDefaultQuery = !search && !company && !branch && !status && !employeeId && !priority &&
    !dateFrom && !dateTo && !unfollowedOnly && !hasProblemsOnly &&
    page === 1 && sortBy === 'lastUpdatedAt' && sortDir === -1;

  var resVer = getCacheVersion_('RES');
  var fuVer = getCacheVersion_('FU');
  var defaultCacheKey = isDefaultQuery
    ? ('RG_RES_DEF_V' + resVer + '_' + fuVer + '_' + (restrictToAgent ? session.employeeId : 'ALL') + '_' + pageSize)
    : '';

  if (defaultCacheKey) {
    try {
      var defCachedRaw = CacheService.getScriptCache().get(defaultCacheKey);
      if (defCachedRaw) {
        var defCached = JSON.parse(defCachedRaw);
        if (defCached && Array.isArray(defCached.items)) {
          return defCached;
        }
      }
    } catch (e0) {}
  }

  var all = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var facetsKey = 'RG_FACETS_V' + resVer;
  var cachedFacets = null;
  try {
    var fRaw = CacheService.getScriptCache().get(facetsKey);
    if (fRaw) {
      var parsedF = JSON.parse(fRaw);
      if (parsedF && Array.isArray(parsedF.companies) && Array.isArray(parsedF.branches)) {
        cachedFacets = parsedF;
      }
    }
  } catch (e) {}

  var companiesMap = cachedFacets ? null : {};
  var branchesMap = cachedFacets ? null : {};
  var matched = [];

  var followedKey = 'RG_FOLLOWED_RES_V' + fuVer;
  var followedResIds = null;
  try {
    var flRaw = CacheService.getScriptCache().get(followedKey);
    if (flRaw) followedResIds = JSON.parse(flRaw);
  } catch (e1) {}
  if (!followedResIds || typeof followedResIds !== 'object') {
    followedResIds = {};
    var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    for (var f = 0; f < followUps.length; f++) {
      if (followUps[f].reservationId) followedResIds[followUps[f].reservationId] = true;
    }
    try {
      var flStr = JSON.stringify(followedResIds);
      if (flStr.length < 95000) CacheService.getScriptCache().put(followedKey, flStr, 300);
    } catch (e2) {}
  }

  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (!cachedFacets) {
      if (r.companyName) companiesMap[r.companyName] = true;
      if (r.branchName) branchesMap[r.branchName] = true;
    }

    if (restrictToAgent) {
      var rawMy = String(r.assignedEmployeeIds || '');
      if (rawMy.indexOf(session.employeeId) === -1) continue;
      if (safeJsonParse(rawMy, []).indexOf(session.employeeId) === -1) continue;
    }

    if (company && r.companyName !== company) continue;
    if (branch && r.branchName !== branch) continue;
    if (status && r.internalStatus !== status && r.originalStatusAr !== status) continue;
    if (priority && r.priority !== priority) continue;
    if (dateFrom && r.startDate < dateFrom) continue;
    if (dateTo && r.startDate > dateTo) continue;
    if (unfollowedOnly && followedResIds[r.id]) continue;
    if (hasProblemsOnly && !toBool(r.hasProblem)) continue;

    if (employeeId) {
      var rawEmp = String(r.assignedEmployeeIds || '');
      if (rawEmp.indexOf(employeeId) === -1) continue;
      if (safeJsonParse(rawEmp, []).indexOf(employeeId) === -1) continue;
    }

    if (search) {
      var hay = (r.reservationNumber + ' ' + r.customerName + ' ' + r.customerPhone + ' ' + r.carName + ' ' + r.companyName).toLowerCase();
      if (hay.indexOf(search) === -1) continue;
    }

    matched.push(r);
  }

  if (!cachedFacets) {
    cachedFacets = {
      companies: Object.keys(companiesMap).sort(),
      branches: Object.keys(branchesMap).sort()
    };
    try {
      CacheService.getScriptCache().put(facetsKey, JSON.stringify(cachedFacets), 600);
    } catch (e) {}
  }

  var numericSort = (sortBy === 'daysCount' || sortBy === 'baseAmount' || sortBy === 'extensionsAmount' || sortBy === 'totalAmount');
  matched.sort(function (a, b) {
    if (numericSort) {
      return (toNumber(a[sortBy], 0) - toNumber(b[sortBy], 0)) * sortDir;
    }
    var sa = String(a[sortBy] || '');
    var sb = String(b[sortBy] || '');
    if (sa === sb) return 0;
    return (sa < sb ? -1 : 1) * sortDir;
  });

  var total = matched.length;
  var startIdx = (page - 1) * pageSize;
  var slice = matched.slice(startIdx, startIdx + pageSize);

  var items = [];
  for (var j = 0; j < slice.length; j++) {
    var sr = slice[j];
    items.push({
      id: sr.id,
      reservationNumber: sr.reservationNumber,
      customerName: sr.customerName,
      customerPhone: sr.customerPhone,
      companyName: sr.companyName,
      branchName: sr.branchName,
      carName: sr.carName,
      plateNumber: sr.plateNumber,
      startDate: sr.startDate,
      endDate: sr.endDate,
      daysCount: toNumber(sr.daysCount, 1),
      originalStatusCode: sr.originalStatusCode,
      originalStatusAr: sr.originalStatusAr,
      pickupTypeAr: sr.pickupTypeAr,
      returnTypeAr: sr.returnTypeAr,
      baseAmount: toNumber(sr.baseAmount, 0),
      extensionsAmount: toNumber(sr.extensionsAmount, 0),
      totalAmount: toNumber(sr.totalAmount, 0),
      hasExtensions: toBool(sr.hasExtensions),
      internalStatus: sr.internalStatus,
      priority: sr.priority,
      assignedEmployeeIds: safeJsonParse(sr.assignedEmployeeIds, []),
      assignedEmployeeNames: safeJsonParse(sr.assignedEmployeeNames, []),
      lastUpdateText: sr.lastUpdateText,
      lastUpdatedById: sr.lastUpdatedById,
      lastUpdatedByName: sr.lastUpdatedByName,
      lastUpdatedAt: sr.lastUpdatedAt,
      hasProblem: toBool(sr.hasProblem),
      createdAt: sr.createdAt || '',
      updatedAt: sr.updatedAt || '',
      statusHistory: normalizeStatusHistory_(sr.statusHistory),
      isFollowed: Boolean(followedResIds[sr.id])
    });
  }

  var resPayload = {
    items: items,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: cachedFacets
  };

  if (defaultCacheKey) {
    try {
      var resStr = JSON.stringify(resPayload);
      if (resStr.length < 95000) {
        CacheService.getScriptCache().put(defaultCacheKey, resStr, 180);
      }
    } catch (e3) {}
  }

  return resPayload;
}

function syncLocalCache(session, params) {
  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');

  var all = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
  var problems = readAllRecords(RG_SHEETS.PROBLEMS, false);

  var followedResIds = {};
  for (var f = 0; f < followUps.length; f++) {
    if (followUps[f].reservationId) followedResIds[followUps[f].reservationId] = true;
  }

  var items = [];
  for (var i = 0; i < all.length; i++) {
    var sr = all[i];
    if (restrictToAgent) {
      var rawMy = String(sr.assignedEmployeeIds || '');
      if (rawMy.indexOf(session.employeeId) === -1) continue;
      if (safeJsonParse(rawMy, []).indexOf(session.employeeId) === -1) continue;
    }
    items.push({
      id: sr.id,
      reservationNumber: sr.reservationNumber,
      customerName: sr.customerName,
      customerPhone: sr.customerPhone,
      companyName: sr.companyName,
      branchName: sr.branchName,
      carName: sr.carName,
      plateNumber: sr.plateNumber,
      startDate: sr.startDate,
      endDate: sr.endDate,
      daysCount: toNumber(sr.daysCount, 1),
      originalStatusCode: sr.originalStatusCode,
      originalStatusAr: sr.originalStatusAr,
      pickupTypeAr: sr.pickupTypeAr,
      returnTypeAr: sr.returnTypeAr,
      baseAmount: toNumber(sr.baseAmount, 0),
      extensionsAmount: toNumber(sr.extensionsAmount, 0),
      totalAmount: toNumber(sr.totalAmount, 0),
      hasExtensions: toBool(sr.hasExtensions),
      internalStatus: sr.internalStatus,
      priority: sr.priority,
      assignedEmployeeIds: safeJsonParse(sr.assignedEmployeeIds, []),
      assignedEmployeeNames: safeJsonParse(sr.assignedEmployeeNames, []),
      lastUpdateText: sr.lastUpdateText,
      lastUpdatedById: sr.lastUpdatedById,
      lastUpdatedByName: sr.lastUpdatedByName,
      lastUpdatedAt: sr.lastUpdatedAt,
      hasProblem: toBool(sr.hasProblem),
      createdAt: sr.createdAt || '',
      updatedAt: sr.updatedAt || '',
      statusHistory: normalizeStatusHistory_(sr.statusHistory),
      isFollowed: Boolean(followedResIds[sr.id])
    });
  }

  followUps.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return {
    reservations: items,
    allowAgentViewAll: allowAgentAll,
    followUps: followUps.slice(0, 400),
    problems: problems.slice(0, 200),
    syncedAt: nowIso()
  };
}

function getReservationDetails(session, params) {
  var p = params || {};
  var id = normalizeStr(p.reservationId);
  var resNumber = normalizeStr(p.reservationNumber);
  var reservation = id
    ? findRecordById(RG_SHEETS.RESERVATIONS, 'id', id)
    : findRecordById(RG_SHEETS.RESERVATIONS, 'reservationNumber', resNumber);

  if (!reservation) {
    throw new Error('لم يتم العثور على الحجز المطلوب.');
  }

  var extensions = readAllRecords(RG_SHEETS.EXTENSIONS, false).filter(function (e) {
    return e.reservationNumber === reservation.reservationNumber;
  });

  var assignments = readAllRecords(RG_SHEETS.ASSIGNMENTS, false).filter(function (a) {
    return a.reservationId === reservation.id && a.status === 'active';
  });

  var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false).filter(function (f) {
    return f.reservationId === reservation.id;
  }).sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var followUpHistory = readAllRecords(RG_SHEETS.FOLLOWUP_HISTORY, false).filter(function (h) {
    return h.reservationId === reservation.id;
  }).sort(function (a, b) {
    return String(b.changedAt).localeCompare(String(a.changedAt));
  });

  var problems = readAllRecords(RG_SHEETS.PROBLEMS, false).filter(function (pr) {
    return pr.reservationId === reservation.id;
  });

  var problemUpdates = readAllRecords(RG_SHEETS.PROBLEM_UPDATES, false).filter(function (u) {
    return u.reservationNumber === reservation.reservationNumber;
  });

  return {
    reservation: {
      id: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      customerPhone: reservation.customerPhone,
      companyName: reservation.companyName,
      branchName: reservation.branchName,
      carName: reservation.carName,
      plateNumber: reservation.plateNumber,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      daysCount: toNumber(reservation.daysCount, 1),
      originalStatusCode: reservation.originalStatusCode,
      originalStatusAr: reservation.originalStatusAr,
      pickupTypeAr: reservation.pickupTypeAr,
      returnTypeAr: reservation.returnTypeAr,
      baseAmount: toNumber(reservation.baseAmount, 0),
      extensionsAmount: toNumber(reservation.extensionsAmount, 0),
      totalAmount: toNumber(reservation.totalAmount, 0),
      hasExtensions: toBool(reservation.hasExtensions),
      internalStatus: reservation.internalStatus,
      priority: reservation.priority,
      assignedEmployeeIds: safeJsonParse(reservation.assignedEmployeeIds, []),
      assignedEmployeeNames: safeJsonParse(reservation.assignedEmployeeNames, []),
      lastUpdateText: reservation.lastUpdateText,
      lastUpdatedById: reservation.lastUpdatedById,
      lastUpdatedByName: reservation.lastUpdatedByName,
      lastUpdatedAt: reservation.lastUpdatedAt,
      hasProblem: toBool(reservation.hasProblem),
      createdAt: reservation.createdAt || '',
      updatedAt: reservation.updatedAt || '',
      statusHistory: normalizeStatusHistory_(reservation.statusHistory)
    },
    extensions: extensions,
    assignments: assignments,
    followUps: followUps,
    followUpHistory: followUpHistory,
    problems: problems,
    problemUpdates: problemUpdates
  };
}

function quickUpdateReservationStatus(session, payload) {
  requirePermission(session, 'quick_update_status');
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var status = normalizeStr(p.status);
  var note = normalizeStr(p.note);
  if (!reservationId) throw new Error('معرف الحجز مطلوب.');
  if (!status || !isValidWorkflowStatus_(status)) {
    throw new Error('حالة الحجز غير صالحة.');
  }

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    var now = new Date();
    var nowStr = now.toISOString();
    var actionText = 'تحديث سريع للحالة إلى: ' + status;
    var lastText = note ? (actionText + ' — ' + note) : actionText;
    var followUp = {
      id: generateId('FU'),
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      status: status,
      action: actionText,
      notes: note,
      followUpDate: formatDateOnly(now),
      followUpTime: formatTimeOnly(now),
      createdAt: nowStr
    };
    appendRecord(RG_SHEETS.FOLLOWUPS, followUp);

    appendRecord(RG_SHEETS.FOLLOWUP_HISTORY, {
      id: generateId('FUH'),
      followUpId: followUp.id,
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      changeType: 'quick_status_update',
      previousStatus: reservation.internalStatus || '',
      newStatus: status,
      previousAction: '',
      newAction: actionText,
      previousNotes: '',
      newNotes: note,
      changedAt: nowStr
    });

    var nextStages = appendStatusStageEntry_(reservation.statusHistory, {
      source: 'quick_status',
      previousStatus: reservation.internalStatus || '',
      newStatus: status,
      changedAt: nowStr,
      changedById: session.employeeId,
      changedByName: session.user.name,
      note: lastText
    });

    var updated = updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
      internalStatus: status,
      lastUpdateText: lastText,
      lastUpdatedById: session.employeeId,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowStr,
      updatedAt: nowStr,
      statusHistory: JSON.stringify(nextStages)
    });

    touchEmployeeActivityThrottled_(session.employeeId, nowStr);

    logActivity(session.user, 'تعديل حالة', 'Reservation', reservation.reservationNumber, 'تحديث مباشر إلى: ' + status + (note ? ' | ' + note : ''));
    if (updated) {
      updated = Object.assign({}, updated, {
        assignedEmployeeIds: safeJsonParse(updated.assignedEmployeeIds, []),
        assignedEmployeeNames: safeJsonParse(updated.assignedEmployeeNames, []),
        hasExtensions: toBool(updated.hasExtensions),
        hasProblem: toBool(updated.hasProblem),
        statusHistory: nextStages
      });
    }
    return { reservation: updated, followUp: followUp };
  });
}

function updateReservationDetails(session, payload) {
  requirePermission(session, 'edit_reservation_details');

  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  if (!reservationId) throw new Error('معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!existing) throw new Error('الحجز غير موجود.');

    var now = nowIso();
    var patch = {
      lastUpdatedById: session.employeeId,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: now,
      updatedAt: now
    };

    var editableFields = [
      'customerName', 'customerPhone', 'companyName', 'branchName',
      'carName', 'plateNumber', 'startDate', 'endDate',
      'pickupTypeAr', 'returnTypeAr', 'lastUpdateText'
    ];
    for (var i = 0; i < editableFields.length; i++) {
      var f = editableFields[i];
      if (p[f] !== undefined) patch[f] = normalizeStr(p[f]);
    }
    if (p.daysCount !== undefined) patch.daysCount = Math.max(1, toNumber(p.daysCount, 1));
    if (p.baseAmount !== undefined) patch.baseAmount = toNumber(p.baseAmount, 0);
    if (p.extensionsAmount !== undefined) patch.extensionsAmount = toNumber(p.extensionsAmount, 0);
    if (p.totalAmount !== undefined) patch.totalAmount = toNumber(p.totalAmount, 0);
    if (p.internalStatus && isValidWorkflowStatus_(p.internalStatus)) {
      patch.internalStatus = p.internalStatus;
    }
    if (p.priority && RG_PROBLEM_PRIORITIES.indexOf(p.priority) !== -1) {
      patch.priority = p.priority;
    }
    var nextStages = normalizeStatusHistory_(existing.statusHistory);
    if (patch.internalStatus && patch.internalStatus !== existing.internalStatus) {
      nextStages = appendStatusStageEntry_(nextStages, {
        source: 'supervisor_edit',
        previousStatus: existing.internalStatus || '',
        newStatus: patch.internalStatus,
        changedAt: now,
        changedById: session.employeeId,
        changedByName: session.user.name,
        note: patch.lastUpdateText || ('تعديل الحالة إلى: ' + patch.internalStatus)
      });
      patch.statusHistory = JSON.stringify(nextStages);
    }

    var updated = updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservationId, patch);

    if ((patch.internalStatus && patch.internalStatus !== existing.internalStatus) ||
        (patch.lastUpdateText && patch.lastUpdateText !== existing.lastUpdateText)) {
      appendRecord(RG_SHEETS.FOLLOWUP_HISTORY, {
        id: generateId('FUH'),
        followUpId: '',
        reservationId: existing.id,
        reservationNumber: existing.reservationNumber,
        employeeId: session.employeeId,
        employeeName: session.user.name,
        changeType: 'reservation_details_edit',
        previousStatus: existing.internalStatus || '',
        newStatus: patch.internalStatus || existing.internalStatus || '',
        previousAction: existing.lastUpdateText || '',
        newAction: patch.lastUpdateText || existing.lastUpdateText || '',
        previousNotes: '',
        newNotes: 'تعديل تفاصيل الحجز بواسطة المشرف/المدير',
        changedAt: now
      });
    }

    logActivity(session.user, 'تعديل تفاصيل الحجز', 'Reservation', existing.reservationNumber, 'تحديث تفاصيل الحجز/البيانات بواسطة ' + session.user.name);
    if (updated) {
      updated = Object.assign({}, updated, {
        assignedEmployeeIds: safeJsonParse(updated.assignedEmployeeIds, []),
        assignedEmployeeNames: safeJsonParse(updated.assignedEmployeeNames, []),
        hasExtensions: toBool(updated.hasExtensions),
        hasProblem: toBool(updated.hasProblem),
        statusHistory: nextStages
      });
    }
    return updated;
  });
}
