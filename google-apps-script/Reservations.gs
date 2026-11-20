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

  var numericSort = (sortBy === 'daysCount' || sortBy === 'extendedDaysCount' || sortBy === 'totalDaysCount' || sortBy === 'extensionsCount' || sortBy === 'baseAmount' || sortBy === 'extensionsAmount' || sortBy === 'totalAmount');
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
    items.push(serializeReservationForClient_(slice[j], Boolean(followedResIds[slice[j].id])));
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
  var extensionsList = readAllRecords(RG_SHEETS.EXTENSIONS, false).filter(function (e) {
    return e.isAcceptedAndPaid !== 'false';
  });

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
    items.push(serializeReservationForClient_(sr, Boolean(followedResIds[sr.id])));
  }

  followUps.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  extensionsList.sort(function (a, b) {
    var sa = toNumber(a.sequenceNumber, 0);
    var sb = toNumber(b.sequenceNumber, 0);
    if (sa && sb && sa !== sb) return sa - sb;
    return String(a.startDate || '').localeCompare(String(b.startDate || ''));
  });
  return {
    reservations: items,
    extensions: extensionsList,
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
    if (e.isAcceptedAndPaid === 'false') return false;
    if (e.reservationId && e.reservationId === reservation.id) return true;
    if (e.reservationNumber && String(e.reservationNumber) === String(reservation.reservationNumber)) return true;
    if (reservation.sourceReservationId && e.sourceReservationId && String(e.sourceReservationId) === String(reservation.sourceReservationId)) return true;
    return false;
  }).sort(function (a, b) {
    var sa = toNumber(a.sequenceNumber, 0);
    var sb = toNumber(b.sequenceNumber, 0);
    if (sa && sb && sa !== sb) return sa - sb;
    return String(a.startDate || '').localeCompare(String(b.startDate || ''));
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
    reservation: serializeReservationForClient_(reservation, followUps.length > 0),
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
    if (note) {
      dispatchMentionNotifications_(
        [note],
        { id: session.employeeId, name: session.user.name },
        'Reservation',
        reservation.id,
        reservation.reservationNumber
      );
    }
    if (updated) {
      updated = serializeReservationForClient_(updated, true);
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
      'customerName', 'customerPhone', 'customerEmail', 'customerIdNumber',
      'companyName', 'branchName', 'deliverBranchName',
      'carName', 'plateNumber', 'carCategory',
      'startDate', 'startTime', 'originalEndDate', 'originalEndTime',
      'endDate', 'endTime', 'extendedUntilDate', 'extendedUntilTime',
      'pickupTypeAr', 'returnTypeAr', 'paymentMethod', 'paymentStatus', 'lastUpdateText'
    ];
    for (var i = 0; i < editableFields.length; i++) {
      var f = editableFields[i];
      if (p[f] !== undefined) patch[f] = normalizeStr(p[f]);
    }
    if (p.daysCount !== undefined) patch.daysCount = Math.max(1, toNumber(p.daysCount, 1));
    if (p.extendedDaysCount !== undefined) patch.extendedDaysCount = Math.max(0, toNumber(p.extendedDaysCount, 0));
    if (p.totalDaysCount !== undefined) patch.totalDaysCount = Math.max(1, toNumber(p.totalDaysCount, 1));
    if (p.extensionsCount !== undefined) patch.extensionsCount = Math.max(0, toNumber(p.extensionsCount, 0));
    if (p.dailyPrice !== undefined) patch.dailyPrice = toNumber(p.dailyPrice, 0);
    if (p.discountAmount !== undefined) patch.discountAmount = toNumber(p.discountAmount, 0);
    if (p.vatAmount !== undefined) patch.vatAmount = toNumber(p.vatAmount, 0);
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
      updated = serializeReservationForClient_(updated, false);
    }
    return updated;
  });
}

function saveReservationPinnedNote(session, payload) {
  requirePermission(session, 'pin_reservation_note');
  if (session.role !== RG_ROLES.GENERAL_MANAGER && session.role !== RG_ROLES.SUPERVISOR) {
    throw new Error('FORBIDDEN: إضافة الملاحظة المثبتة متاحة للمشرف والمدير العام فقط.');
  }
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var note = normalizeStr(p.note);
  if (!reservationId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!existing) throw new Error('NOT_FOUND: الحجز غير موجود.');

    var now = nowIso();
    var updated = updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservationId, {
      pinnedNote: note,
      pinnedNoteById: note ? session.employeeId : '',
      pinnedNoteByName: note ? session.user.name : '',
      pinnedNoteUpdatedAt: note ? now : '',
      updatedAt: now
    });

    logActivity(
      session.user,
      note ? 'تثبيت ملاحظة على الحجز' : 'إزالة الملاحظة المثبتة',
      'Reservation',
      existing.reservationNumber,
      note ? note.slice(0, 140) : 'إزالة الملاحظة المثبتة'
    );
    return {
      reservation: serializeReservationForClient_(updated || existing, false)
    };
  });
}

function recordNoAnswerFollowUp(session, payload) {
  requirePermission(session, 'add_followup');
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var notes = normalizeStr(p.note || p.notes);
  if (!reservationId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('NOT_FOUND: الحجز غير موجود.');

    var prevCount = Math.max(0, Math.floor(toNumber(reservation.noAnswerCount, 0)));
    var nextCount = prevCount + 1;
    var now = new Date();
    var nowStr = now.toISOString();
    var status = normalizeStr(reservation.internalStatus) || 'تم الإنشاء';
    var action = 'محاولة اتصال — لم يرد (المحاولة #' + nextCount + ')';

    var followUp = {
      id: generateId('FU'),
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      status: status,
      action: action,
      notes: notes,
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
      changeType: 'no_answer_attempt',
      previousStatus: status,
      newStatus: status,
      previousAction: '',
      newAction: action,
      previousNotes: '',
      newNotes: notes,
      changedAt: nowStr
    });

    var lastText = notes ? (action + ' — ' + notes) : action;
    var updated = updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
      noAnswerCount: nextCount,
      lastUpdateText: lastText,
      lastUpdatedById: session.employeeId,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowStr,
      updatedAt: nowStr
    });

    touchEmployeeActivityThrottled_(session.employeeId, nowStr);
    logActivity(
      session.user,
      'تسجيل محاولة اتصال - لم يرد',
      'FollowUp',
      reservation.reservationNumber,
      action + (notes ? (' — ' + notes) : '')
    );
    if (notes) {
      dispatchMentionNotifications_(
        [notes],
        { id: session.employeeId, name: session.user.name },
        'Reservation',
        reservation.id,
        reservation.reservationNumber
      );
    }

    return {
      reservation: serializeReservationForClient_(updated || reservation, true),
      followUp: followUp,
      noAnswerCount: nextCount
    };
  });
}

function convertEasternDigitsGs_(val) {
  return String(val === null || val === undefined ? '' : val)
    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
}

function normalizeDeleteScope_(payload) {
  var p = (payload && typeof payload === 'object') ? payload : {};
  var rawScope = normalizeStr(p.scope).toLowerCase();
  var scope = (rawScope === 'month' || rawScope === 'year' || rawScope === 'all') ? rawScope : 'all';
  var y = parseInt(convertEasternDigitsGs_(p.year !== undefined ? p.year : ''), 10);
  var m = parseInt(convertEasternDigitsGs_(p.month !== undefined ? p.month : ''), 10);
  var rawYm = p.yearMonth || (typeof p.month === 'string' && String(p.month).indexOf('-') !== -1 ? p.month : '');
  if (scope === 'month' && rawYm) {
    var ymMatch = /^(\d{4})-(\d{1,2})$/.exec(convertEasternDigitsGs_(rawYm).trim());
    if (ymMatch) {
      y = parseInt(ymMatch[1], 10);
      m = parseInt(ymMatch[2], 10);
    }
  }
  var year = (!isNaN(y) && y >= 2000 && y <= 2100) ? y : null;
  var month = (!isNaN(m) && m >= 1 && m <= 12) ? m : null;
  var ym = (year && month) ? (String(year) + '-' + (month < 10 ? ('0' + month) : String(month))) : '';
  var periodLabelAr = 'جميع الحجوزات';
  var periodLabelEn = 'All Reservations';
  if (scope === 'month') {
    periodLabelAr = ym ? ('شهر ' + ym) : 'شهر محدد';
    periodLabelEn = ym ? ('Month ' + ym) : 'Selected Month';
  } else if (scope === 'year') {
    periodLabelAr = year ? ('سنة ' + year) : 'سنة محددة';
    periodLabelEn = year ? ('Year ' + year) : 'Selected Year';
  }
  return {
    scope: scope,
    year: year,
    month: month,
    ym: ym,
    periodLabelAr: periodLabelAr,
    periodLabelEn: periodLabelEn
  };
}

function matchesDeleteScope_(res, scopeInfo) {
  if (!res || typeof res !== 'object') return false;
  if (!scopeInfo || scopeInfo.scope === 'all') return true;
  var iso = formatDateOnly(res.startDate || res.sourceCreatedAt || res.createdAt || '');
  if (!iso || iso.length < 4) return false;
  if (scopeInfo.scope === 'year') {
    return scopeInfo.year ? (iso.slice(0, 4) === String(scopeInfo.year)) : false;
  }
  if (scopeInfo.scope === 'month') {
    return scopeInfo.ym ? (iso.slice(0, 7) === scopeInfo.ym) : false;
  }
  return false;
}

function deleteRecordsWhere_(sheetName, predicateFn) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var ssTz = getSpreadsheetTz_();
  var matchIndices = [];
  var keptRows = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      var cell = row[c];
      if (cell instanceof Date) {
        if (RG_DATE_ONLY_FIELDS[h]) obj[h] = formatCellDateFast_(cell, ssTz, 'date');
        else if (RG_TIME_ONLY_FIELDS[h]) obj[h] = formatCellDateFast_(cell, ssTz, 'time');
        else obj[h] = cell.toISOString();
      } else {
        obj[h] = cell;
      }
    }
    if (predicateFn(obj)) {
      matchIndices.push(r);
    } else {
      keptRows.push(row);
    }
  }

  if (matchIndices.length === 0) return 0;
  if (keptRows.length === 0) {
    return clearSheetRecords(sheetName);
  }
  if (matchIndices.length <= 40) {
    for (var k = matchIndices.length - 1; k >= 0; k--) {
      sheet.deleteRow(matchIndices[k] + 2);
    }
  } else {
    sheet.getRange(2, 1, values.length, headers.length).clearContent();
    sheet.getRange(2, 1, keptRows.length, headers.length).setValues(keptRows);
    var extraRows = values.length - keptRows.length;
    if (extraRows > 0) {
      sheet.deleteRows(2 + keptRows.length, extraRows);
    }
  }
  invalidateCache(sheetName);
  return matchIndices.length;
}

function previewDeleteReservations(session, payload) {
  requirePermission(session, 'manage_settings');
  var scopeInfo = normalizeDeleteScope_(payload);
  var all = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var count = 0;
  if (scopeInfo.scope === 'all') {
    count = all.length;
  } else {
    for (var i = 0; i < all.length; i++) {
      if (matchesDeleteScope_(all[i], scopeInfo)) count++;
    }
  }
  return {
    count: count,
    totalReservations: all.length,
    scope: scopeInfo.scope,
    year: scopeInfo.year,
    month: scopeInfo.month,
    ym: scopeInfo.ym,
    periodLabelAr: scopeInfo.periodLabelAr,
    periodLabelEn: scopeInfo.periodLabelEn
  };
}

function deleteAllReservations(session, payload) {
  requirePermission(session, 'manage_settings');
  var p = payload || {};
  var scopeInfo = normalizeDeleteScope_(p);
  var acknowledged = p.acknowledged === true || p.acknowledged === 'true';
  var confirmPhrase = normalizeStr(p.confirmPhrase);
  var password = String(p.password === undefined || p.password === null ? '' : p.password);

  if (scopeInfo.scope === 'month' && (!scopeInfo.year || !scopeInfo.month)) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد الشهر والسنة المطلوب حذف حجوزاتهما بشكل صحيح.');
  }
  if (scopeInfo.scope === 'year' && !scopeInfo.year) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد السنة المطلوب حذف حجوزاتها بشكل صحيح (2000–2100).');
  }
  if (!acknowledged) {
    throw new Error('VALIDATION_ERROR: يرجى تأكيد الموافقة على حذف الحجوزات المحددة نهائياً أولاً.');
  }
  if (confirmPhrase !== 'حذف جميع الحجوزات') {
    throw new Error('VALIDATION_ERROR: يرجى كتابة عبارة التأكيد بدقة: حذف جميع الحجوزات');
  }
  if (!password) {
    throw new Error('VALIDATION_ERROR: يرجى إدخال كلمة مرور حسابك لتأكيد الأمان.');
  }

  return withScriptLock(function () {
    var emp = findRecordById(RG_SHEETS.EMPLOYEES, 'id', session.employeeId);
    if (!emp) {
      throw new Error('UNAUTHORIZED: تعذر التحقق من حساب المستخدم الحالي.');
    }
    var expectedHash = hashPassword(password, normalizeStr(emp.salt));
    if (expectedHash !== normalizeStr(emp.passwordHash)) {
      throw new Error('VALIDATION_ERROR: كلمة المرور المدخلة غير صحيحة.');
    }

    var allRes = readAllRecords(RG_SHEETS.RESERVATIONS, false);
    var targets = [];
    var targetIdMap = {};
    for (var i = 0; i < allRes.length; i++) {
      if (matchesDeleteScope_(allRes[i], scopeInfo)) {
        targets.push(serializeReservationForClient_(allRes[i], false));
        if (allRes[i].id) targetIdMap[String(allRes[i].id)] = true;
      }
    }
    var deletedCount = targets.length;

    if (scopeInfo.scope === 'all') {
      deletedCount = clearSheetRecords(RG_SHEETS.RESERVATIONS);
      clearSheetRecords(RG_SHEETS.EXTENSIONS);
      clearSheetRecords(RG_SHEETS.ASSIGNMENTS);
      clearSheetRecords(RG_SHEETS.FOLLOWUPS);
      clearSheetRecords(RG_SHEETS.FOLLOWUP_HISTORY);
      try {
        updateRecordsWhere_(
          RG_SHEETS.PROBLEMS,
          function (pr) { return Boolean(pr && pr.reservationId); },
          { reservationId: '', updatedAt: nowIso() }
        );
      } catch (e1) {}
      try {
        if (getSpreadsheet().getSheetByName(RG_SHEETS.ISSUES)) {
          updateRecordsWhere_(
            RG_SHEETS.ISSUES,
            function (pr) { return Boolean(pr && pr.reservationId); },
            { reservationId: '', updatedAt: nowIso() }
          );
        }
      } catch (e2) {}
    } else if (deletedCount > 0) {
      deleteRecordsWhere_(RG_SHEETS.RESERVATIONS, function (r) { return Boolean(r && targetIdMap[String(r.id)]); });
      deleteRecordsWhere_(RG_SHEETS.EXTENSIONS, function (x) { return Boolean(x && targetIdMap[String(x.reservationId)]); });
      deleteRecordsWhere_(RG_SHEETS.ASSIGNMENTS, function (x) { return Boolean(x && targetIdMap[String(x.reservationId)]); });
      deleteRecordsWhere_(RG_SHEETS.FOLLOWUPS, function (x) { return Boolean(x && targetIdMap[String(x.reservationId)]); });
      deleteRecordsWhere_(RG_SHEETS.FOLLOWUP_HISTORY, function (x) { return Boolean(x && targetIdMap[String(x.reservationId)]); });
      try {
        updateRecordsWhere_(
          RG_SHEETS.PROBLEMS,
          function (pr) { return Boolean(pr && pr.reservationId && targetIdMap[String(pr.reservationId)]); },
          { reservationId: '', updatedAt: nowIso() }
        );
      } catch (e3) {}
      try {
        if (getSpreadsheet().getSheetByName(RG_SHEETS.ISSUES)) {
          updateRecordsWhere_(
            RG_SHEETS.ISSUES,
            function (pr) { return Boolean(pr && pr.reservationId && targetIdMap[String(pr.reservationId)]); },
            { reservationId: '', updatedAt: nowIso() }
          );
        }
      } catch (e4) {}
    }

    var scopeEntityKey = scopeInfo.scope === 'all' ? 'ALL' : (scopeInfo.ym || String(scopeInfo.year || 'SCOPE'));
    logActivity(
      session.user,
      scopeInfo.scope === 'all' ? 'حذف جميع الحجوزات' : ('حذف حجوزات (' + scopeInfo.periodLabelAr + ')'),
      'Reservation',
      scopeEntityKey,
      'حذف حجوزات (' + scopeInfo.periodLabelAr + ') نهائياً (' + deletedCount + ' حجز) بواسطة ' + session.user.name
    );

    return {
      deleted: true,
      scope: scopeInfo,
      year: scopeInfo.year,
      month: scopeInfo.month,
      ym: scopeInfo.ym,
      periodLabelAr: scopeInfo.periodLabelAr,
      deletedReservationsCount: deletedCount,
      exportedRows: targets
    };
  });
}

function normalizeExcelCellDateGs_(val) {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return formatDateOnly(val);
  }
  if (typeof val === 'number' && isFinite(val) && val > 20000 && val < 90000) {
    var utcMs = Math.round((val - 25569) * 86400 * 1000);
    var dt = new Date(utcMs);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  var raw = convertEasternDigitsGs_(val).trim();
  if (!raw || raw === '-') return '';
  if (/^\d{4,5}$/.test(raw)) {
    var serial = Number(raw);
    if (serial > 20000 && serial < 90000) {
      var utcMs2 = Math.round((serial - 25569) * 86400 * 1000);
      var dt2 = new Date(utcMs2);
      if (!isNaN(dt2.getTime())) return dt2.toISOString().slice(0, 10);
    }
  }
  var slashDmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(raw);
  if (slashDmy) {
    var mStr = Number(slashDmy[2]) < 10 ? ('0' + Number(slashDmy[2])) : String(Number(slashDmy[2]));
    var dStr = Number(slashDmy[1]) < 10 ? ('0' + Number(slashDmy[1])) : String(Number(slashDmy[1]));
    return slashDmy[3] + '-' + mStr + '-' + dStr;
  }
  var slashYmd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.exec(raw);
  if (slashYmd) {
    var ym2 = Number(slashYmd[2]) < 10 ? ('0' + Number(slashYmd[2])) : String(Number(slashYmd[2]));
    var yd2 = Number(slashYmd[3]) < 10 ? ('0' + Number(slashYmd[3])) : String(Number(slashYmd[3]));
    return slashYmd[1] + '-' + ym2 + '-' + yd2;
  }
  return formatDateOnly(raw) || '';
}

function normalizeImportHeaderNameGs_(h) {
  return convertEasternDigitsGs_(h || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s_\-#().\/]+/g, '');
}

var RG_EXCEL_IMPORT_HEADER_MAP_ = (function () {
  var specs = {
    reservationNumber: ['رقم الحجز', 'رقم العقد', 'reservationNumber', 'reservation_number', 'Reservation #', 'Reservation No', 'Booking #', 'Booking Number', 'Res No', 'المرجع'],
    customerName: ['اسم العميل', 'العميل', 'customerName', 'customer_name', 'Customer Name', 'Customer', 'Client Name', 'Client'],
    customerPhone: ['الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف', 'customerPhone', 'customer_phone', 'Phone', 'Mobile', 'Client Mobile', 'Phone Number'],
    customerEmail: ['البريد الإلكتروني', 'البريد الالكتروني', 'الإيميل', 'الايميل', 'customerEmail', 'customer_email', 'Email'],
    customerIdNumber: ['رقم الهوية', 'الهوية', 'رقم الهوية الوطنية', 'customerIdNumber', 'customer_id_number', 'ID Number', 'National ID'],
    companyName: ['الشركة', 'اسم الشركة', 'شركة التأجير', 'companyName', 'company_name', 'Company', 'Company Name'],
    branchName: ['الفرع', 'فرع الاستلام', 'branchName', 'branch_name', 'Branch', 'Pickup Branch'],
    deliverBranchName: ['فرع التسليم', 'deliverBranchName', 'deliver_branch_name', 'Return Branch', 'Deliver Branch'],
    carName: ['السيارة', 'اسم السيارة', 'المركبة', 'carName', 'car_name', 'Vehicle', 'Car', 'Car Name'],
    plateNumber: ['اللوحة', 'رقم اللوحة', 'plateNumber', 'plate_number', 'Plate', 'Plate Number'],
    carCategory: ['الفئة', 'فئة السيارة', 'carCategory', 'car_category', 'Category', 'Car Category'],
    startDate: ['بداية الحجز', 'تاريخ البداية', 'تاريخ الاستلام', 'startDate', 'start_date', 'Start Date', 'Pickup Date'],
    startTime: ['وقت البداية', 'وقت الاستلام', 'startTime', 'start_time', 'Start Time'],
    endDate: ['نهاية الحجز', 'تاريخ النهاية', 'تاريخ التسليم', 'endDate', 'end_date', 'End Date', 'Return Date'],
    endTime: ['وقت النهاية', 'وقت التسليم', 'endTime', 'end_time', 'End Time'],
    extendedUntilDate: ['التمديد لحد', 'تاريخ التمديد', 'نهاية التمديد', 'extendedUntilDate', 'extended_until_date', 'Extended Until'],
    extensionsCount: ['مرات التمديد', 'عدد التمديدات', 'extensionsCount', 'extensions_count', 'Extensions #', 'Extensions Count'],
    extensionsAmount: ['سعر التمديد', 'مبلغ التمديد', 'قيمة التمديد', 'extensionsAmount', 'extensions_amount', 'Ext. Amount', 'Extensions Amount'],
    daysCount: ['الأيام', 'عدد الأيام', 'daysCount', 'days_count', 'Days', 'Days Count'],
    dailyPrice: ['السعر اليومي', 'الإيجار اليومي', 'dailyPrice', 'daily_price', 'Daily Price'],
    discountAmount: ['الخصم', 'مبلغ الخصم', 'discountAmount', 'discount_amount', 'Discount'],
    vatAmount: ['الضريبة', 'ضريبة القيمة المضافة', 'vatAmount', 'vat_amount', 'VAT', 'Tax'],
    baseAmount: ['المبلغ الأساسي', 'السعر الأساسي', 'baseAmount', 'base_amount', 'Base Amount'],
    totalAmount: ['الإجمالي', 'المبلغ الإجمالي', 'إجمالي المبلغ', 'totalAmount', 'total_amount', 'Total (SAR)', 'Total', 'Total Amount'],
    originalStatusAr: ['حالة الحجز الأصلية', 'الحالة الأصلية', 'originalStatusAr', 'original_status_ar', 'Original Status'],
    internalStatus: ['حالة المتابعة الداخلية', 'المتابعة الداخلية', 'الحالة', 'حالة الحجز', 'internalStatus', 'internal_status', 'Internal Status', 'Status'],
    priority: ['الأولوية', 'الاولوية', 'priority', 'Priority'],
    paymentMethod: ['طريقة الدفع', 'paymentMethod', 'payment_method', 'Payment Method'],
    paymentStatus: ['حالة الدفع', 'paymentStatus', 'payment_status', 'Payment Status'],
    lastUpdateText: ['آخر تحديث', 'ملاحظات', 'الوصف', 'lastUpdateText', 'last_update_text', 'Last Update', 'Notes']
  };
  var map = {};
  var fKeys = Object.keys(specs);
  for (var i = 0; i < fKeys.length; i++) {
    var fk = fKeys[i];
    var aliases = specs[fk];
    for (var j = 0; j < aliases.length; j++) {
      map[normalizeImportHeaderNameGs_(aliases[j])] = fk;
    }
  }
  return map;
}());

function importReservationsFromExcel(session, payload) {
  if (!hasPermission(session, 'pull_reservations') && !hasPermission(session, 'manage_settings')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية استيراد الحجوزات.');
  }
  var p = payload || {};
  var rawRows = Array.isArray(p.rows) ? p.rows : [];
  if (!rawRows.length) {
    throw new Error('VALIDATION_ERROR: ملف Excel لا يحتوي على صفوف للاستيراد.');
  }

  return withScriptLock(function () {
    var existingList = readAllRecords(RG_SHEETS.RESERVATIONS, false);
    var existingByNum = {};
    for (var e = 0; e < existingList.length; e++) {
      var ex = existingList[e];
      if (ex && ex.reservationNumber) {
        existingByNum[String(ex.reservationNumber).trim().toLowerCase()] = ex;
      }
    }

    var nowStr = nowIso();
    var actorId = normalizeStr(session.employeeId) || 'SYSTEM';
    var actorName = normalizeStr(session.user && session.user.name) || 'النظام';
    var seenBatchNums = {};
    var validRows = [];
    var errors = [];
    var skippedRows = 0;
    var newCount = 0;
    var updateCount = 0;

    for (var i = 0; i < rawRows.length; i++) {
      var raw = rawRows[i];
      if (!raw || typeof raw !== 'object') {
        skippedRows++;
        continue;
      }
      var mapped = {};
      var rKeys = Object.keys(raw);
      for (var k = 0; k < rKeys.length; k++) {
        var rk = rKeys[k];
        var canonField = RG_EXCEL_IMPORT_HEADER_MAP_[normalizeImportHeaderNameGs_(rk)];
        if (canonField && raw[rk] !== undefined && raw[rk] !== null && String(raw[rk]).trim() !== '') {
          mapped[canonField] = raw[rk];
        }
      }

      var customerName = normalizeStr(mapped.customerName);
      var resNum = convertEasternDigitsGs_(normalizeStr(mapped.reservationNumber));
      var carName = normalizeStr(mapped.carName);
      var startDate = normalizeExcelCellDateGs_(mapped.startDate);
      var endDate = normalizeExcelCellDateGs_(mapped.endDate);
      var extUntilDate = normalizeExcelCellDateGs_(mapped.extendedUntilDate);

      if (!resNum && !customerName && !carName && !startDate) {
        skippedRows++;
        continue;
      }
      if (!customerName && !resNum) {
        skippedRows++;
        errors.push({ rowIndex: i + 2, reason: 'الصف يفتقد اسم العميل ورقم الحجز.' });
        continue;
      }
      if (!resNum) {
        var seqStr = String(i + 1);
        while (seqStr.length < 3) seqStr = '0' + seqStr;
        resNum = 'RG-XLS-' + nowStr.slice(0, 10).replace(/-/g, '') + '-' + seqStr;
      }

      var dedupeKey = resNum.toLowerCase();
      var existing = existingByNum[dedupeKey] || null;
      var effectiveStart = startDate || (existing && existing.startDate) || nowStr.slice(0, 10);
      var effectiveEnd = endDate || (existing && existing.endDate) || effectiveStart;
      var effectiveExtUntil = extUntilDate || (existing && existing.extendedUntilDate) || effectiveEnd;

      var daysCount = Math.max(1, Math.round(toNumber(mapped.daysCount, 0)));
      if (mapped.daysCount === undefined && effectiveStart && effectiveEnd) {
        var diffD = computeDateDiffDays_(effectiveStart, effectiveEnd);
        if (diffD >= 1) daysCount = diffD;
      }

      var extCount = Math.max(0, Math.round(toNumber(mapped.extensionsCount, existing ? existing.extensionsCount : 0)));
      var extAmount = Math.max(0, Math.round(toNumber(mapped.extensionsAmount, existing ? existing.extensionsAmount : 0) * 100) / 100);
      var dailyPrice = Math.max(0, Math.round(toNumber(mapped.dailyPrice, existing ? existing.dailyPrice : 0) * 100) / 100);
      var discountAmount = Math.max(0, Math.round(toNumber(mapped.discountAmount, existing ? existing.discountAmount : 0) * 100) / 100);
      var vatAmount = Math.max(0, Math.round(toNumber(mapped.vatAmount, existing ? existing.vatAmount : 0) * 100) / 100);
      var totalRaw = mapped.totalAmount !== undefined ? toNumber(mapped.totalAmount, 0) : (existing ? toNumber(existing.totalAmount, 0) : 0);
      var baseAmount = mapped.baseAmount !== undefined
        ? Math.max(0, Math.round(toNumber(mapped.baseAmount, 0) * 100) / 100)
        : Math.max(0, Math.round((totalRaw - extAmount) * 100) / 100);
      var totalAmount = totalRaw > 0
        ? Math.round(totalRaw * 100) / 100
        : Math.round((baseAmount + extAmount) * 100) / 100;

      var rawInternal = normalizeStr(mapped.internalStatus);
      var internalStatus = isValidWorkflowStatus_(rawInternal)
        ? rawInternal
        : (existing ? normalizeStr(existing.internalStatus) : 'جديد');
      var rawOrig = normalizeStr(mapped.originalStatusAr);
      var originalStatusAr = (rawOrig && rawOrig !== '-')
        ? rawOrig
        : (existing ? normalizeStr(existing.originalStatusAr) : internalStatus);
      var rawPrio = normalizeStr(mapped.priority);
      var priority = RG_PROBLEM_PRIORITIES.indexOf(rawPrio) !== -1
        ? rawPrio
        : (existing ? (normalizeStr(existing.priority) || 'عادي') : 'عادي');

      var cleanPhone = convertEasternDigitsGs_(normalizeStr(mapped.customerPhone));
      if (cleanPhone === '-') cleanPhone = '';
      if (!cleanPhone && existing) cleanPhone = normalizeStr(existing.customerPhone);

      var cleanNote = normalizeStr(mapped.lastUpdateText);
      if (cleanNote === '-') cleanNote = '';

      var extDaysPrev = existing ? toNumber(existing.extendedDaysCount, 0) : 0;
      var rec = {
        id: existing ? existing.id : generateId('RES_IMP'),
        sourceReservationId: existing ? normalizeStr(existing.sourceReservationId) : '',
        reservationNumber: resNum,
        sourceCreatedAt: existing ? normalizeStr(existing.sourceCreatedAt) : (effectiveStart + 'T09:00:00Z'),
        customerName: customerName || (existing && existing.customerName) || 'عميل مستورد',
        customerPhone: cleanPhone,
        customerEmail: normalizeStr(mapped.customerEmail) !== '-' ? (normalizeStr(mapped.customerEmail) || (existing && existing.customerEmail) || '') : '',
        customerIdNumber: normalizeStr(mapped.customerIdNumber) !== '-' ? (normalizeStr(mapped.customerIdNumber) || (existing && existing.customerIdNumber) || '') : '',
        companyName: normalizeStr(mapped.companyName) !== '-' ? (normalizeStr(mapped.companyName) || (existing && existing.companyName) || 'مستورد من Excel') : 'مستورد من Excel',
        branchName: normalizeStr(mapped.branchName) !== '-' ? (normalizeStr(mapped.branchName) || (existing && existing.branchName) || 'الفرع الرئيسي') : 'الفرع الرئيسي',
        deliverBranchName: normalizeStr(mapped.deliverBranchName) !== '-' ? (normalizeStr(mapped.deliverBranchName) || (existing && existing.deliverBranchName) || normalizeStr(mapped.branchName) || 'الفرع الرئيسي') : 'الفرع الرئيسي',
        carName: (carName && carName !== '-') ? carName : ((existing && existing.carName) || 'غير محدد'),
        plateNumber: normalizeStr(mapped.plateNumber) !== '-' ? (normalizeStr(mapped.plateNumber) || (existing && existing.plateNumber) || '') : '',
        carCategory: normalizeStr(mapped.carCategory) !== '-' ? (normalizeStr(mapped.carCategory) || (existing && existing.carCategory) || '') : '',
        startDate: effectiveStart,
        startTime: normalizeStr(mapped.startTime) || (existing && existing.startTime) || '10:00',
        originalEndDate: existing ? normalizeStr(existing.originalEndDate || effectiveEnd) : effectiveEnd,
        originalEndTime: (existing && existing.originalEndTime) || normalizeStr(mapped.endTime) || '10:00',
        endDate: effectiveEnd,
        endTime: normalizeStr(mapped.endTime) || (existing && existing.endTime) || '10:00',
        extendedUntilDate: effectiveExtUntil,
        extendedUntilTime: (existing && existing.extendedUntilTime) || normalizeStr(mapped.endTime) || '10:00',
        daysCount: daysCount,
        extendedDaysCount: extDaysPrev,
        totalDaysCount: daysCount + extDaysPrev,
        originalStatusCode: (existing && existing.originalStatusCode) || 'excel_import',
        originalStatusAr: originalStatusAr,
        pickupTypeAr: (existing && existing.pickupTypeAr) || 'الفرع',
        returnTypeAr: (existing && existing.returnTypeAr) || 'الفرع',
        paymentMethod: normalizeStr(mapped.paymentMethod) !== '-' ? (normalizeStr(mapped.paymentMethod) || (existing && existing.paymentMethod) || '') : '',
        paymentStatus: normalizeStr(mapped.paymentStatus) !== '-' ? (normalizeStr(mapped.paymentStatus) || (existing && existing.paymentStatus) || '') : '',
        dailyPrice: dailyPrice,
        discountAmount: discountAmount,
        vatAmount: vatAmount,
        baseAmount: baseAmount,
        extensionsCount: extCount,
        extensionsAmount: extAmount,
        totalAmount: totalAmount,
        hasExtensions: (extCount > 0 || extAmount > 0 || (effectiveExtUntil > effectiveEnd)) ? 'true' : 'false',
        internalStatus: internalStatus,
        priority: priority,
        assignedEmployeeIds: existing && existing.assignedEmployeeIds ? (typeof existing.assignedEmployeeIds === 'string' ? existing.assignedEmployeeIds : JSON.stringify(existing.assignedEmployeeIds)) : '[]',
        assignedEmployeeNames: existing && existing.assignedEmployeeNames ? (typeof existing.assignedEmployeeNames === 'string' ? existing.assignedEmployeeNames : JSON.stringify(existing.assignedEmployeeNames)) : '[]',
        lastUpdateText: cleanNote || (existing ? normalizeStr(existing.lastUpdateText) : ('تم الاستيراد من ملف Excel بواسطة ' + actorName)),
        lastUpdatedById: actorId,
        lastUpdatedByName: actorName,
        lastUpdatedAt: nowStr,
        hasProblem: existing && toBool(existing.hasProblem) ? 'true' : 'false',
        pinnedNote: existing ? normalizeStr(existing.pinnedNote) : '',
        pinnedNoteById: existing ? normalizeStr(existing.pinnedNoteById) : '',
        pinnedNoteByName: existing ? normalizeStr(existing.pinnedNoteByName) : '',
        pinnedNoteUpdatedAt: existing ? normalizeStr(existing.pinnedNoteUpdatedAt) : '',
        noAnswerCount: existing ? Math.max(0, Math.floor(toNumber(existing.noAnswerCount, 0))) : 0,
        createdAt: existing ? (normalizeStr(existing.createdAt) || nowStr) : nowStr,
        updatedAt: nowStr,
        statusHistory: existing && existing.statusHistory
          ? (typeof existing.statusHistory === 'string' ? existing.statusHistory : JSON.stringify(existing.statusHistory))
          : JSON.stringify([{ stageNumber: 1, source: 'excel_import', previousStatus: '', newStatus: internalStatus, changedAt: nowStr, changedById: actorId, changedByName: actorName, note: originalStatusAr }]),
        rawJson: existing && existing.rawJson ? existing.rawJson : JSON.stringify({ importedFromExcel: true })
      };

      if (existing || seenBatchNums[dedupeKey]) updateCount++;
      else newCount++;
      seenBatchNums[dedupeKey] = true;
      existingByNum[dedupeKey] = rec;
      validRows.push(rec);
    }

    if (!validRows.length) {
      throw new Error('VALIDATION_ERROR: لم يتم العثور على صفوف حجوزات صالحة داخل الملف.');
    }

    batchUpsertRecords(RG_SHEETS.RESERVATIONS, 'id', validRows);
    logActivity(
      session.user,
      'استيراد حجوزات من Excel',
      'Reservation',
      'EXCEL',
      'استيراد ' + newCount + ' حجز جديد وتحديث ' + updateCount + ' حجز من ملف Excel بواسطة ' + actorName
    );

    return {
      importedCount: newCount,
      updatedCount: updateCount,
      skippedRows: skippedRows,
      totalProcessed: validRows.length,
      errors: errors
    };
  });
}
