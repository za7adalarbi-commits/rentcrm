/**
 * RENTAL GATE CRM — Reservations Query, Details & Direct Status Service
 */

function getReservations(session, params) {
  var p = params || {};
  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');

  var search = normalizeStr(p.search).toLowerCase();
  var reservationNumberQuery = normalizeStr(p.reservationNumber).replace(/^#+/, '').toLowerCase();
  var company = normalizeStr(p.company);
  var branch = normalizeStr(p.branch);
  var status = normalizeStr(p.status);
  var employeeId = normalizeStr(p.employeeId);
  var priority = normalizeStr(p.priority);
  var dateFrom = normalizeStr(p.dateFrom);
  var dateTo = normalizeStr(p.dateTo);
  var unfollowedOnly = toBool(p.unfollowedOnly);
  var hasProblemsOnly = toBool(p.hasProblemsOnly) || toBool(p.hasProblem);
  var hasExtensions = toBool(p.hasExtensions);
  var timeField = normalizeStr(p.timeField || 'both').toLowerCase();
  var timeFrom = normalizeStr(p.timeFrom);
  var timeTo = normalizeStr(p.timeTo);
  var overdueUnpaidOnly = toBool(p.overdueUnpaidOnly);
  var sortBy = normalizeStr(p.sortBy) || 'lastUpdatedAt';
  var sortDir = normalizeStr(p.sortDir) === 'asc' ? 1 : -1;
  var page = Math.max(1, toNumber(p.page, 1));
  var pageSize = Math.min(200, Math.max(1, toNumber(p.pageSize, 25)));

  var isDefaultQuery = !search && !reservationNumberQuery && !company && !branch && !status && !employeeId && !priority &&
    !dateFrom && !dateTo && !unfollowedOnly && !hasProblemsOnly && !hasExtensions &&
    !timeFrom && !timeTo && !overdueUnpaidOnly &&
    page === 1 && sortBy === 'lastUpdatedAt' && sortDir === -1;

  var resVer = getCacheVersion_('RES');
  var fuVer = getCacheVersion_('FU');
  var defaultCacheKey = isDefaultQuery
    ? ('RG_RES_DEF_V' + resVer + '_' + fuVer + '_' + (restrictToAgent ? session.employeeId : 'ALL') + '_' + pageSize)
    : '';

  if (defaultCacheKey && !toBool(p.forceRefresh)) {
    var defCached = getCompressedJsonCache_(defaultCacheKey);
    if (defCached && Array.isArray(defCached.items)) {
      return defCached;
    }
  }

  var all = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var facetsKey = 'RG_FACETS_V' + resVer;
  var cachedFacets = getCompressedJsonCache_(facetsKey);
  if (!(cachedFacets && Array.isArray(cachedFacets.companies) && Array.isArray(cachedFacets.branches))) {
    cachedFacets = null;
  }

  var companiesMap = cachedFacets ? null : {};
  var branchesMap = cachedFacets ? null : {};
  var matched = [];

  var followedKey = 'RG_FOLLOWED_RES_V' + fuVer;
  var followedResIds = getCompressedJsonCache_(followedKey);
  if (!followedResIds || typeof followedResIds !== 'object') {
    followedResIds = {};
    var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    for (var f = 0; f < followUps.length; f++) {
      if (followUps[f].reservationId) followedResIds[followUps[f].reservationId] = true;
    }
    putCompressedJsonCache_(followedKey, followedResIds, 300);
  }

  var extByResId = null;
  if (overdueUnpaidOnly) {
    extByResId = {};
    var allExt = readAllRecords(RG_SHEETS.EXTENSIONS, false);
    for (var exi = 0; exi < allExt.length; exi++) {
      var ex = allExt[exi];
      if (!ex || ex.isAcceptedAndPaid === 'false') continue;
      if (ex.reservationId) {
        if (!extByResId[ex.reservationId]) extByResId[ex.reservationId] = [];
        extByResId[ex.reservationId].push(ex);
      }
      if (ex.reservationNumber) {
        var nk = 'num:' + ex.reservationNumber;
        if (!extByResId[nk]) extByResId[nk] = [];
        extByResId[nk].push(ex);
      }
    }
  }
  var nowMs = Date.now();
  var tfMin = timeFrom ? gsParseMinutesOfDay_(timeFrom) : null;
  var ttMin = timeTo ? gsParseMinutesOfDay_(timeTo) : null;

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
    if (hasExtensions && !(toBool(r.hasExtensions) || toNumber(r.extensionsCount, 0) > 0)) continue;

    if (tfMin !== null || ttMin !== null) {
      var sMin = gsParseMinutesOfDay_(r.startTime || extractTimeHM_(r.startDate));
      var eMin = gsParseMinutesOfDay_(r.extendedUntilTime || r.endTime || extractTimeHM_(r.endDate));
      var inTime = false;
      if (timeField === 'start') {
        inTime = sMin !== null && (tfMin === null || sMin >= tfMin) && (ttMin === null || sMin <= ttMin);
      } else if (timeField === 'end') {
        inTime = eMin !== null && (tfMin === null || eMin >= tfMin) && (ttMin === null || eMin <= ttMin);
      } else {
        var sOk = sMin !== null && (tfMin === null || sMin >= tfMin) && (ttMin === null || sMin <= ttMin);
        var eOk = eMin !== null && (tfMin === null || eMin >= tfMin) && (ttMin === null || eMin <= ttMin);
        inTime = sOk || eOk;
      }
      if (!inTime) continue;
    }

    if (overdueUnpaidOnly) {
      var exForRes = (extByResId[r.id] || []).concat(extByResId['num:' + r.reservationNumber] || []);
      if (!gsIsReservationOverdueUnpaid_(r, exForRes, nowMs)) continue;
    }

    if (employeeId) {
      var rawEmp = String(r.assignedEmployeeIds || '');
      if (rawEmp.indexOf(employeeId) === -1) continue;
      if (safeJsonParse(rawEmp, []).indexOf(employeeId) === -1) continue;
    }

    if (reservationNumberQuery) {
      var resNumNorm = normalizeStr(r.reservationNumber).toLowerCase();
      if (resNumNorm.indexOf(reservationNumberQuery) === -1) continue;
    }

    if (search) {
      var hay = (
        normalizeStr(r.reservationNumber) + ' ' +
        normalizeStr(r.customerName) + ' ' +
        normalizeStr(r.customerPhone) + ' ' +
        normalizeStr(r.carName) + ' ' +
        normalizeStr(r.plateNumber) + ' ' +
        normalizeStr(r.branchName) + ' ' +
        normalizeStr(r.companyName)
      ).toLowerCase();
      if (hay.indexOf(search) === -1) continue;
    }

    matched.push(r);
  }

  if (!cachedFacets) {
    cachedFacets = {
      companies: Object.keys(companiesMap).sort(),
      branches: Object.keys(branchesMap).sort()
    };
    putCompressedJsonCache_(facetsKey, cachedFacets, 600);
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
    putCompressedJsonCache_(defaultCacheKey, resPayload, 180);
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

// =========================================================================
// TODAY MOVEMENTS & 24H RADAR, DELTA SYNC, ANNOUNCEMENTS, DELEGATIONS & LOCKS
// =========================================================================

var RG_CLOSED_RES_STATUSES_ = [
  'تم الإلغاء', 'ملغي', 'cancelled', 'canceled', 'لم يتم الحجز', 'مرفوض', 'rejected',
  'تم الإرجاع', 'تم الاستلام', 'منتهي', 'مكتمل', 'completed', 'returned', 'closed', 'لم يحضر', 'no_show'
];

var RG_EXCLUDED_TODAY_STATUSES_ = [
  'تم الإلغاء', 'ملغي', 'cancelled', 'canceled', 'مرفوض', 'rejected',
  'لم يتم الحجز', 'لم يحضر', 'no_show'
];

var RG_PICKUP_DONE_STATUSES_ = [
  'تم التسليم', 'نشط الآن', 'نشط', 'active', 'delivered', 'picked_up',
  'تم الاستلام', 'تم الإرجاع', 'منتهي', 'مكتمل', 'completed', 'returned', 'closed'
];

function gsPad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

function gsParseMinutesOfDay_(timeStr) {
  var clean = convertEasternDigitsGs_(normalizeStr(timeStr));
  var m = /^(\d{1,2}):(\d{2})/.exec(clean);
  if (!m) return null;
  var hh = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function gsNormalizeHHmm_(timeStr, fallback) {
  var mins = gsParseMinutesOfDay_(timeStr);
  if (mins === null) return fallback || '';
  return gsPad2_(Math.floor(mins / 60)) + ':' + gsPad2_(mins % 60);
}

function gsParseEndTimestampMs_(dateStr, timeStr) {
  var rawDate = convertEasternDigitsGs_(normalizeStr(dateStr));
  if (!rawDate) return null;
  var rawTime = convertEasternDigitsGs_(normalizeStr(timeStr));
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawDate) && !rawTime) {
    var parsedIso = Date.parse(rawDate);
    if (!isNaN(parsedIso)) return parsedIso;
  }
  var dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(rawDate);
  if (!dateOnlyMatch) {
    var fb = Date.parse(rawDate);
    return isNaN(fb) ? null : fb;
  }
  var year = parseInt(dateOnlyMatch[1], 10);
  var month = parseInt(dateOnlyMatch[2], 10);
  var day = parseInt(dateOnlyMatch[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  var hh = 23;
  var mm = 59;
  var tm = /^(\d{1,2}):(\d{2})/.exec(rawTime);
  if (tm) {
    hh = Math.min(23, Math.max(0, parseInt(tm[1], 10)));
    mm = Math.min(59, Math.max(0, parseInt(tm[2], 10)));
  } else {
    var emb = /T(\d{2}):(\d{2})/.exec(rawDate);
    if (emb) {
      hh = Math.min(23, Math.max(0, parseInt(emb[1], 10)));
      mm = Math.min(59, Math.max(0, parseInt(emb[2], 10)));
    }
  }
  var dt = new Date(year, month - 1, day, hh, mm, 0, 0);
  var ms = dt.getTime();
  return isNaN(ms) ? null : ms;
}

function gsResolveEffectiveEnd_(r) {
  var obj = (r && typeof r === 'object') ? r : {};
  var extDate = normalizeStr(obj.extendedUntilDate);
  var extTime = normalizeStr(obj.extendedUntilTime);
  var endDate = normalizeStr(obj.endDate || obj.originalEndDate);
  var endTime = normalizeStr(obj.endTime || obj.originalEndTime);
  var useExt = Boolean(extDate);
  var effDate = useExt ? extDate : endDate;
  var effTime = useExt ? (extTime || endTime || '23:59') : (endTime || '23:59');
  var cleanTime = gsNormalizeHHmm_(effTime, '');
  return {
    date: effDate.substring(0, 10),
    time: cleanTime,
    isExtended: useExt || toNumber(obj.extensionsCount, 0) > 0 || toBool(obj.hasExtensions),
    timestampMs: gsParseEndTimestampMs_(effDate, cleanTime || effTime)
  };
}

function gsResolveStartInfo_(r) {
  var obj = (r && typeof r === 'object') ? r : {};
  var dateStr = formatDateOnly(obj.startDate || obj.pickupDate || '');
  var rawTime = normalizeStr(obj.startTime) || extractTimeHM_(obj.startDate) || '09:00';
  var cleanTime = gsNormalizeHHmm_(rawTime, '09:00');
  return {
    date: dateStr,
    time: cleanTime,
    minutesOfDay: gsParseMinutesOfDay_(cleanTime),
    timestampMs: dateStr ? gsParseEndTimestampMs_(dateStr, cleanTime) : null
  };
}

function gsMatchStatusList_(r, list) {
  var obj = (r && typeof r === 'object') ? r : {};
  var a = normalizeStr(obj.internalStatus).toLowerCase();
  var b = normalizeStr(obj.originalStatusAr).toLowerCase();
  var c = normalizeStr(obj.originalStatusCode).toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var s = list[i].toLowerCase();
    if (a === s || b === s || c === s) return true;
  }
  return false;
}

function gsIsClosedStatus_(r) {
  return gsMatchStatusList_(r, RG_CLOSED_RES_STATUSES_);
}

function gsIsExcludedTodayStatus_(r) {
  return gsMatchStatusList_(r, RG_EXCLUDED_TODAY_STATUSES_);
}

function gsIsPickupCompleted_(r) {
  return gsMatchStatusList_(r, RG_PICKUP_DONE_STATUSES_);
}

function gsIsReservationOverdueUnpaid_(r, extensions, nowMs) {
  if (!r || gsIsClosedStatus_(r) || gsIsExcludedTodayStatus_(r)) return false;
  var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
  var extList = Array.isArray(extensions) ? extensions : [];
  for (var i = 0; i < extList.length; i++) {
    var ex = extList[i];
    if (!ex || !isExtensionAcceptedAndPaid(ex)) continue;
    var exEndD = formatDateOnly(ex.endDate || ex.newEndDate || ex.actualEndDate);
    var exEndT = gsNormalizeHHmm_(ex.endTime || r.endTime, '23:59');
    var exMs = exEndD ? gsParseEndTimestampMs_(exEndD, exEndT) : null;
    if (exMs !== null && exMs >= now) return false;
  }
  var eff = gsResolveEffectiveEnd_(r);
  if (eff.timestampMs === null || !isFinite(eff.timestampMs)) return false;
  return eff.timestampMs < now;
}

function gsFormatRemainingLabels_(diffMs) {
  var isPast = diffMs < 0;
  var absMin = Math.round(Math.abs(diffMs) / 60000);
  var hrs = Math.floor(absMin / 60);
  var mins = absMin % 60;
  if (absMin < 1) {
    return {
      ar: isPast ? 'انتهى للتو' : 'أقل من دقيقة',
      en: isPast ? 'Just expired' : '< 1m left'
    };
  }
  var pAr = [];
  var pEn = [];
  if (hrs > 0) { pAr.push(hrs + ' س'); pEn.push(hrs + 'h'); }
  if (mins > 0) { pAr.push(mins + ' د'); pEn.push(mins + 'm'); }
  var bAr = pAr.join(' ');
  var bEn = pEn.join(' ');
  return {
    ar: isPast ? ('منتهي منذ ' + bAr) : ('باقي ' + bAr),
    en: isPast ? ('Overdue ' + bEn) : (bEn + ' left')
  };
}

function gsComputeExpiryRadarSummary_(reservations, nowMs) {
  var list = Array.isArray(reservations) ? reservations : [];
  var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
  var maxFutureMs = 24 * 3600000;
  var maxPastMs = 12 * 3600000;

  var allMatches = [];
  var critical6hCount = 0;
  var soon24hCount = 0;
  var expiredUnclosedCount = 0;
  var extendedInRadarCount = 0;

  for (var i = 0; i < list.length; i++) {
    var res = list[i];
    if (!res || typeof res !== 'object' || gsIsClosedStatus_(res)) continue;
    var eff = gsResolveEffectiveEnd_(res);
    if (eff.timestampMs === null || !isFinite(eff.timestampMs)) continue;
    var diffMs = eff.timestampMs - now;
    if (diffMs > maxFutureMs || diffMs < -maxPastMs) continue;

    var bucket = 'soon_24h';
    var rank = 2;
    if (diffMs < 0) {
      bucket = 'expired_unclosed';
      rank = 0;
      expiredUnclosedCount += 1;
    } else if (diffMs <= 6 * 3600000) {
      bucket = 'critical_6h';
      rank = 1;
      critical6hCount += 1;
    } else {
      soon24hCount += 1;
    }
    if (eff.isExtended) extendedInRadarCount += 1;

    var labels = gsFormatRemainingLabels_(diffMs);
    allMatches.push({
      reservation: res,
      effectiveEndDate: eff.date,
      effectiveEndTime: eff.time,
      effectiveEndTimestampMs: eff.timestampMs,
      isExtended: eff.isExtended,
      diffMs: diffMs,
      diffMinutes: Math.round(diffMs / 60000),
      bucket: bucket,
      urgencyRank: rank,
      remainingLabelAr: labels.ar,
      remainingLabelEn: labels.en
    });
  }

  allMatches.sort(function (a, b) {
    if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
    return a.effectiveEndTimestampMs - b.effectiveEndTimestampMs;
  });

  return {
    items: allMatches,
    allItems: allMatches,
    totalCount: allMatches.length,
    upcoming24hCount: critical6hCount + soon24hCount,
    critical6hCount: critical6hCount,
    soon24hCount: soon24hCount,
    expiredUnclosedCount: expiredUnclosedCount,
    extendedInRadarCount: extendedInRadarCount
  };
}

function gsComputeTodayMovementsSummary_(reservations, nowMs, todayDate) {
  var list = Array.isArray(reservations) ? reservations : [];
  var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
  var todayStr = normalizeStr(todayDate) || formatDateOnly(new Date(now));

  var allItems = [];
  var pickupCount = 0;
  var returnCount = 0;
  var pendingPickupCount = 0;
  var pendingReturnCount = 0;
  var overdueCount = 0;
  var completedCount = 0;

  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r || typeof r !== 'object' || gsIsExcludedTodayStatus_(r)) continue;

    var startInfo = gsResolveStartInfo_(r);
    if (startInfo.date && startInfo.date === todayStr) {
      var pickupDone = gsIsPickupCompleted_(r);
      var pickupOverdue = !pickupDone && startInfo.timestampMs !== null && startInfo.timestampMs < now;
      pickupCount += 1;
      if (pickupDone) completedCount += 1;
      else pendingPickupCount += 1;
      if (pickupOverdue) overdueCount += 1;
      allItems.push({
        key: String(r.id || r.reservationNumber || i) + ':pickup',
        movementType: 'pickup',
        reservation: r,
        scheduledDate: todayStr,
        scheduledTime: startInfo.time,
        scheduledMinutes: startInfo.minutesOfDay !== null ? startInfo.minutesOfDay : 540,
        scheduledTimestampMs: startInfo.timestampMs,
        isCompleted: pickupDone,
        isOverdue: pickupOverdue,
        isExtended: false
      });
    }

    var effEnd = gsResolveEffectiveEnd_(r);
    if (effEnd.date && effEnd.date === todayStr) {
      var retTime = gsNormalizeHHmm_(effEnd.time, '23:59');
      var retMins = gsParseMinutesOfDay_(retTime);
      var retDone = gsIsClosedStatus_(r);
      var retOverdue = !retDone && effEnd.timestampMs !== null && effEnd.timestampMs < now;
      returnCount += 1;
      if (retDone) completedCount += 1;
      else pendingReturnCount += 1;
      if (retOverdue) overdueCount += 1;
      allItems.push({
        key: String(r.id || r.reservationNumber || i) + ':return',
        movementType: 'return',
        reservation: r,
        scheduledDate: todayStr,
        scheduledTime: retTime,
        scheduledMinutes: retMins !== null ? retMins : 1439,
        scheduledTimestampMs: effEnd.timestampMs,
        isCompleted: retDone,
        isOverdue: retOverdue,
        isExtended: effEnd.isExtended
      });
    }
  }

  allItems.sort(function (a, b) {
    if (a.scheduledMinutes !== b.scheduledMinutes) return a.scheduledMinutes - b.scheduledMinutes;
    if (a.movementType !== b.movementType) return a.movementType === 'pickup' ? -1 : 1;
    var ra = normalizeStr(a.reservation && a.reservation.reservationNumber);
    var rb = normalizeStr(b.reservation && b.reservation.reservationNumber);
    return ra < rb ? -1 : (ra > rb ? 1 : 0);
  });

  return {
    todayDate: todayStr,
    items: allItems,
    allItems: allItems,
    totalCount: allItems.length,
    filteredCount: allItems.length,
    pickupCount: pickupCount,
    returnCount: returnCount,
    pendingPickupCount: pendingPickupCount,
    pendingReturnCount: pendingReturnCount,
    overdueCount: overdueCount,
    completedCount: completedCount
  };
}

function getTodayAndRadar(session, params) {
  var p = params || {};
  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');
  var roleScope = restrictToAgent ? session.employeeId : 'ALL';

  var rawToday = normalizeStr(p.todayDate);
  var todayStr = /^\d{4}-\d{2}-\d{2}$/.test(rawToday) ? rawToday : formatDateOnly(new Date());
  var minDate = shiftIsoDateDays_(todayStr, -2);
  var maxDate = shiftIsoDateDays_(todayStr, 2);

  var rawNow = Number(p.nowMs);
  var serverNow = Date.now();
  var nowMs = (!isNaN(rawNow) && isFinite(rawNow) && Math.abs(rawNow - serverNow) <= 86400000) ? rawNow : serverNow;

  var cacheKey = 'RG_TODAY_RADAR_V' + getCacheVersion_('RES') + '_' + getCacheVersion_('FU') + '_' + roleScope + '_' + todayStr;
  var candidates = !toBool(p.forceRefresh) ? getCompressedJsonCache_(cacheKey) : null;

  if (!Array.isArray(candidates)) {
    var all = readAllRecords(RG_SHEETS.RESERVATIONS, false);
    var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
    var followedSet = {};
    for (var f = 0; f < followUps.length; f++) {
      if (followUps[f].reservationId) followedSet[followUps[f].reservationId] = true;
    }
    candidates = [];
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (restrictToAgent) {
        var rawMy = String(r.assignedEmployeeIds || '');
        if (rawMy.indexOf(session.employeeId) === -1) continue;
        if (safeJsonParse(rawMy, []).indexOf(session.employeeId) === -1) continue;
      }
      var sDate = formatDateOnly(r.startDate);
      var eDate = formatDateOnly(r.endDate);
      var xDate = formatDateOnly(r.extendedUntilDate);
      var match = (sDate === todayStr) ||
        (eDate && eDate >= minDate && eDate <= maxDate) ||
        (xDate && xDate >= minDate && xDate <= maxDate);
      if (!match) continue;
      candidates.push(serializeReservationForClient_(r, Boolean(followedSet[r.id])));
    }
    putCompressedJsonCache_(cacheKey, candidates, 60);
  }

  var todaySummary = gsComputeTodayMovementsSummary_(candidates, nowMs, todayStr);
  var radarSummary = gsComputeExpiryRadarSummary_(candidates, nowMs);

  var counts = {
    todayTotal: toNumber(todaySummary.totalCount, 0),
    pickupCount: toNumber(todaySummary.pickupCount, 0),
    returnCount: toNumber(todaySummary.returnCount, 0),
    pendingPickupCount: toNumber(todaySummary.pendingPickupCount, 0),
    pendingReturnCount: toNumber(todaySummary.pendingReturnCount, 0),
    overdueTodayCount: toNumber(todaySummary.overdueCount, 0),
    radarTotal: toNumber(radarSummary.totalCount, 0),
    upcoming24hCount: toNumber(radarSummary.upcoming24hCount, 0),
    critical6hCount: toNumber(radarSummary.critical6hCount, 0),
    soon24hCount: toNumber(radarSummary.soon24hCount, 0),
    expiredUnclosedCount: toNumber(radarSummary.expiredUnclosedCount, 0),
    extendedInRadarCount: toNumber(radarSummary.extendedInRadarCount, 0)
  };

  if (toBool(p.summaryOnly)) {
    return {
      todayDate: todayStr,
      serverTime: nowIso(),
      counts: counts
    };
  }

  return {
    todayDate: todayStr,
    serverTime: nowIso(),
    counts: counts,
    todaySummary: todaySummary,
    radarSummary: radarSummary,
    items: candidates
  };
}

function isAnnouncementActiveGs_(item, nowMs) {
  if (!item || !toBool(item.isActive)) return false;
  var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  if (item.startsAt) {
    var s = Date.parse(item.startsAt);
    if (!isNaN(s) && now < s) return false;
  }
  if (item.expiresAt) {
    var e = Date.parse(item.expiresAt);
    if (!isNaN(e) && now > e) return false;
  }
  return true;
}

function formatAnnouncementForClient_(row) {
  return {
    id: normalizeStr(row.id),
    title: normalizeStr(row.title),
    message: normalizeStr(row.message),
    tone: normalizeStr(row.tone) || 'warning',
    isPinned: toBool(row.isPinned),
    isActive: row.isActive === '' || row.isActive === undefined ? true : toBool(row.isActive),
    startsAt: normalizeStr(row.startsAt),
    expiresAt: normalizeStr(row.expiresAt),
    createdById: normalizeStr(row.createdById),
    createdByName: normalizeStr(row.createdByName),
    createdByRole: normalizeStr(row.createdByRole),
    createdAt: normalizeStr(row.createdAt),
    updatedAt: normalizeStr(row.updatedAt)
  };
}

function getAnnouncements(session) {
  var rows = readAllRecords(RG_SHEETS.ANNOUNCEMENTS, false);
  var items = rows.map(formatAnnouncementForClient_);
  items.sort(function (a, b) {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  });
  var nowMs = Date.now();
  var activeItems = items.filter(function (it) {
    return isAnnouncementActiveGs_(it, nowMs);
  });
  return { items: items, activeItems: activeItems };
}

function saveAnnouncement(session, payload) {
  if (session.role !== RG_ROLES.GENERAL_MANAGER && session.role !== RG_ROLES.SUPERVISOR) {
    throw new Error('FORBIDDEN: إدارة تعميمات وإعلانات الوردية متاحة للمشرف والمدير العام فقط.');
  }
  var p = payload || {};
  var title = normalizeStr(p.title);
  var message = normalizeStr(p.message);
  if (!message) throw new Error('VALIDATION_ERROR: نص التعميم أو التنبيه مطلوب.');

  var toneRaw = normalizeStr(p.tone || 'warning').toLowerCase();
  var tone = (toneRaw === 'info' || toneRaw === 'danger' || toneRaw === 'warning') ? toneRaw : 'warning';
  var isPinned = p.isPinned !== undefined ? toBool(p.isPinned) : true;
  var isActive = p.isActive !== undefined ? toBool(p.isActive) : true;
  var startsAt = normalizeStr(p.startsAt);
  var expiresAt = normalizeStr(p.expiresAt);
  var annId = normalizeStr(p.id) || generateId('ANN');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.ANNOUNCEMENTS, 'id', annId);
    var now = nowIso();
    var rec = {
      id: annId,
      title: title,
      message: message,
      tone: tone,
      isPinned: isPinned ? 'true' : 'false',
      isActive: isActive ? 'true' : 'false',
      startsAt: startsAt,
      expiresAt: expiresAt,
      createdById: existing ? existing.createdById : session.employeeId,
      createdByName: existing ? existing.createdByName : session.user.name,
      createdByRole: existing ? existing.createdByRole : session.role,
      createdAt: existing ? (existing.createdAt || now) : now,
      updatedAt: now
    };
    upsertRecordByKey(RG_SHEETS.ANNOUNCEMENTS, 'id', annId, rec);
    logActivity(session.user, 'نشر تعميم وردية', 'Announcement', annId, (title ? (title + ': ') : '') + message.slice(0, 120));
    var data = getAnnouncements(session);
    var saved = formatAnnouncementForClient_(rec);
    return { announcement: saved, items: data.items, activeItems: data.activeItems };
  });
}

function deleteAnnouncement(session, payload) {
  if (session.role !== RG_ROLES.GENERAL_MANAGER && session.role !== RG_ROLES.SUPERVISOR) {
    throw new Error('FORBIDDEN: حذف تعميمات الوردية متاح للمشرف والمدير العام فقط.');
  }
  var p = payload || {};
  var annId = normalizeStr(p.id || p.announcementId);
  if (!annId) throw new Error('VALIDATION_ERROR: معرف التعميم مطلوب.');

  return withScriptLock(function () {
    deleteRecordByKey(RG_SHEETS.ANNOUNCEMENTS, 'id', annId);
    logActivity(session.user, 'حذف تعميم وردية', 'Announcement', annId, 'تم حذف تعميم الوردية');
    var data = getAnnouncements(session);
    return { deleted: true, items: data.items, activeItems: data.activeItems };
  });
}

function formatDelegationForClient_(row, nowMs) {
  var obj = {
    id: normalizeStr(row.id),
    delegateEmployeeId: normalizeStr(row.delegateEmployeeId),
    delegateEmployeeName: normalizeStr(row.delegateEmployeeName),
    delegatedRole: normalizeStr(row.delegatedRole) || RG_ROLES.SUPERVISOR,
    grantedById: normalizeStr(row.grantedById),
    grantedByName: normalizeStr(row.grantedByName),
    reason: normalizeStr(row.reason),
    startsAt: normalizeStr(row.startsAt),
    expiresAt: normalizeStr(row.expiresAt),
    status: normalizeStr(row.status) || 'active',
    revokedAt: normalizeStr(row.revokedAt),
    revokedById: normalizeStr(row.revokedById),
    revokedByName: normalizeStr(row.revokedByName),
    createdAt: normalizeStr(row.createdAt),
    updatedAt: normalizeStr(row.updatedAt)
  };
  obj.isActiveNow = typeof isDelegationActiveGas_ === 'function' ? isDelegationActiveGas_(obj, nowMs) : false;
  return obj;
}

function getDelegations(session) {
  var canManage = session.role === RG_ROLES.GENERAL_MANAGER ||
    hasPermission(session, 'manage_employees') ||
    hasPermission(session, 'view_employees');
  var rows = readAllRecords(RG_SHEETS.DELEGATIONS, false);
  var filtered = canManage ? rows : rows.filter(function (r) {
    return normalizeStr(r.delegateEmployeeId) === session.employeeId;
  });
  filtered.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  var nowMs = Date.now();
  return {
    items: filtered.slice(0, canManage ? 100 : 20).map(function (r) {
      return formatDelegationForClient_(r, nowMs);
    })
  };
}

function saveDelegation(session, payload) {
  if (session.role !== RG_ROLES.GENERAL_MANAGER && !hasPermission(session, 'manage_employees')) {
    throw new Error('FORBIDDEN: منح تفويض الصلاحيات المؤقت متاح للمدير العام أو مسؤول إدارة الموظفين فقط.');
  }
  var p = payload || {};
  var empId = normalizeStr(p.delegateEmployeeId);
  var startsAt = normalizeStr(p.startsAt) || nowIso();
  var expiresAt = normalizeStr(p.expiresAt);
  var reason = normalizeStr(p.reason) || 'تفويض صلاحية مشرف بديل مؤقت';
  if (!empId || !expiresAt) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد الموظف البديل وتاريخ/وقت انتهاء التفويض.');
  }
  var sMs = Date.parse(startsAt);
  var eMs = Date.parse(expiresAt);
  if (isNaN(eMs) || (!isNaN(sMs) && eMs <= sMs)) {
    throw new Error('VALIDATION_ERROR: يجب أن يكون موعد انتهاء التفويض بعد موعد البداية.');
  }

  return withScriptLock(function () {
    var targetEmp = findRecordById(RG_SHEETS.EMPLOYEES, 'id', empId);
    if (!targetEmp) throw new Error('NOT_FOUND: الموظف المحدد غير موجود.');
    if (normalizeStr(targetEmp.status || 'active') !== 'active') {
      throw new Error('VALIDATION_ERROR: لا يمكن تفويض حساب موقوف.');
    }

    var now = nowIso();
    var delRec = {
      id: generateId('DEL'),
      delegateEmployeeId: targetEmp.id,
      delegateEmployeeName: targetEmp.name,
      delegatedRole: RG_ROLES.SUPERVISOR,
      grantedById: session.employeeId,
      grantedByName: session.user.name,
      reason: reason,
      startsAt: startsAt,
      expiresAt: expiresAt,
      status: 'active',
      revokedAt: '',
      revokedById: '',
      revokedByName: '',
      createdAt: now,
      updatedAt: now
    };
    appendRecord(RG_SHEETS.DELEGATIONS, delRec);
    clearEmployeeSessionCache_(targetEmp.id);

    createNotification(
      targetEmp.id,
      '',
      'delegation',
      'تم منحك صلاحية مشرف مؤقتة',
      'منحك ' + session.user.name + ' صلاحية المشرف مؤقتًا حتى ' + formatDateTimeDisplay_(expiresAt) + ' (' + reason + ').',
      'Employee',
      targetEmp.id
    );
    logActivity(session.user, 'تفويض صلاحيات مؤقت', 'Employee', targetEmp.name,
      'تفويض ' + targetEmp.name + ' بصلاحية مشرف مؤقت حتى ' + formatDateTimeDisplay_(expiresAt));

    return { delegation: formatDelegationForClient_(delRec, Date.now()) };
  });
}

function revokeDelegation(session, payload) {
  if (session.role !== RG_ROLES.GENERAL_MANAGER && !hasPermission(session, 'manage_employees')) {
    throw new Error('FORBIDDEN: إلغاء التفويض المؤقت متاح للمدير العام أو مسؤول إدارة الموظفين فقط.');
  }
  var p = payload || {};
  var delId = normalizeStr(p.id || p.delegationId);
  if (!delId) throw new Error('VALIDATION_ERROR: معرف التفويض مطلوب.');

  return withScriptLock(function () {
    var cur = findRecordById(RG_SHEETS.DELEGATIONS, 'id', delId);
    if (!cur) throw new Error('NOT_FOUND: سجل التفويض غير موجود.');
    var now = nowIso();
    updateRecordByKey(RG_SHEETS.DELEGATIONS, 'id', delId, {
      status: 'revoked',
      revokedAt: now,
      revokedById: session.employeeId,
      revokedByName: session.user.name,
      updatedAt: now
    });
    if (cur.delegateEmployeeId) {
      clearEmployeeSessionCache_(cur.delegateEmployeeId);
    }
    logActivity(session.user, 'إلغاء تفويض مؤقت', 'Employee', cur.delegateEmployeeName, 'تم إلغاء التفويض المؤقت عن ' + cur.delegateEmployeeName);
    return { revoked: true };
  });
}

function formatLockForClient_(row) {
  return {
    reservationId: normalizeStr(row.reservationId),
    lockedById: normalizeStr(row.lockedById),
    lockedByName: normalizeStr(row.lockedByName),
    lockedByRole: normalizeStr(row.lockedByRole),
    lockedAt: normalizeStr(row.lockedAt),
    expiresAt: normalizeStr(row.expiresAt)
  };
}

function getReservationLocks(session) {
  var rows = readAllRecords(RG_SHEETS.RESERVATION_LOCKS, false);
  var nowMs = Date.now();
  var items = [];
  for (var i = 0; i < rows.length; i++) {
    var expMs = rows[i].expiresAt ? Date.parse(rows[i].expiresAt) : 0;
    if (expMs && !isNaN(expMs) && expMs > nowMs) {
      items.push(formatLockForClient_(rows[i]));
    }
  }
  return { items: items };
}

function acquireReservationLock(session, payload) {
  var p = payload || {};
  var resId = normalizeStr(p.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب للقفل التعاوني.');

  return withScriptLock(function () {
    var nowMs = Date.now();
    var existing = findRecordById(RG_SHEETS.RESERVATION_LOCKS, 'reservationId', resId);
    if (existing) {
      var expMs = existing.expiresAt ? Date.parse(existing.expiresAt) : 0;
      if (expMs && !isNaN(expMs) && expMs > nowMs && normalizeStr(existing.lockedById) !== session.employeeId) {
        return {
          acquired: false,
          lock: formatLockForClient_(existing)
        };
      }
    }
    var lockRec = {
      reservationId: resId,
      lockedById: session.employeeId,
      lockedByName: session.user.name,
      lockedByRole: session.role,
      lockedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 120000).toISOString()
    };
    upsertRecordByKey(RG_SHEETS.RESERVATION_LOCKS, 'reservationId', resId, lockRec);
    return {
      acquired: true,
      lock: formatLockForClient_(lockRec)
    };
  });
}

function releaseReservationLock(session, payload) {
  var p = payload || {};
  var resId = normalizeStr(p.reservationId);
  return withScriptLock(function () {
    if (resId) {
      var existing = findRecordById(RG_SHEETS.RESERVATION_LOCKS, 'reservationId', resId);
      if (existing && normalizeStr(existing.lockedById) === session.employeeId) {
        deleteRecordByKey(RG_SHEETS.RESERVATION_LOCKS, 'reservationId', resId);
      }
    } else {
      updateRecordsWhere_(RG_SHEETS.RESERVATION_LOCKS, function (lk) {
        return normalizeStr(lk.lockedById) === session.employeeId;
      }, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    }
    return { released: true };
  });
}

function getDeltaSync(session, params) {
  var p = params || {};
  var rawSince = normalizeStr(p.updatedAfter);
  var sinceMs = rawSince && !isNaN(Date.parse(rawSince)) ? (Date.parse(rawSince) - 2000) : (Date.now() - 120000);
  var sinceIso = new Date(sinceMs).toISOString();

  var settingsMap = getSettingsMap_(false);
  var allowAgentAll = settingsMap.allow_agent_view_all !== undefined ? toBool(settingsMap.allow_agent_view_all) : true;
  var restrictToAgent = session.role === RG_ROLES.AGENT && !allowAgentAll && !hasPermission(session, 'view_all_reservations');

  var allRes = readAllRecords(RG_SHEETS.RESERVATIONS, false);
  var allFu = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
  var allPrb = readAllRecords(RG_SHEETS.PROBLEMS, false);
  var allEmp = readAllRecords(RG_SHEETS.EMPLOYEES, false);

  var followedSet = {};
  var changedFollowUps = [];
  for (var fi = 0; fi < allFu.length; fi++) {
    var fu = allFu[fi];
    if (fu.reservationId) followedSet[fu.reservationId] = true;
    var fuTs = normalizeStr(fu.createdAt);
    if (fuTs && fuTs > sinceIso) changedFollowUps.push(fu);
  }
  changedFollowUps.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  var changedReservations = [];
  for (var ri = 0; ri < allRes.length; ri++) {
    var r = allRes[ri];
    if (restrictToAgent) {
      var rawMy = String(r.assignedEmployeeIds || '');
      if (rawMy.indexOf(session.employeeId) === -1 || safeJsonParse(rawMy, []).indexOf(session.employeeId) === -1) continue;
    }
    var rTs = normalizeStr(r.updatedAt || r.lastUpdatedAt || r.createdAt);
    if (rTs && rTs > sinceIso) {
      changedReservations.push(serializeReservationForClient_(r, Boolean(followedSet[r.id])));
    }
  }
  changedReservations.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });

  var changedProblems = [];
  for (var pi = 0; pi < allPrb.length; pi++) {
    var pr = allPrb[pi];
    var pTs = normalizeStr(pr.updatedAt || pr.createdAt);
    if (pTs && pTs > sinceIso) changedProblems.push(formatProblemForClient(pr));
  }
  changedProblems.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });

  var changedEmployees = [];
  for (var ei = 0; ei < allEmp.length; ei++) {
    var e = allEmp[ei];
    var eTs = normalizeStr(e.updatedAt || e.lastActivity || e.createdAt);
    if (eTs && eTs > sinceIso) changedEmployees.push(sanitizeEmployeeForClient(e));
  }

  var trSummary = getTodayAndRadar(session, { summaryOnly: true, todayDate: normalizeStr(p.todayDate) });
  var notifications = getNotifications(session);
  var announcementsData = getAnnouncements(session);
  var locksData = getReservationLocks(session);

  return {
    serverTime: nowIso(),
    syncVersion: getCacheVersion_('RES') + '_' + getCacheVersion_('FU') + '_' + getCacheVersion_('PRB'),
    changedReservations: changedReservations.slice(0, 200),
    changedFollowUps: changedFollowUps.slice(0, 200),
    changedProblems: changedProblems.slice(0, 100),
    changedEmployees: changedEmployees.slice(0, 50),
    todayRadarCounts: trSummary && trSummary.counts ? trSummary.counts : null,
    notifications: notifications,
    announcements: announcementsData.activeItems || [],
    locks: locksData.items || [],
    user: session.user
  };
}

function bulkReassignEmployeeReservations(session, payload) {
  requirePermission(session, 'assign_employees');
  var p = payload || {};
  var fromEmployeeId = normalizeStr(p.fromEmployeeId);
  var toEmployeeId = normalizeStr(p.toEmployeeId);
  var onlyActive = p.onlyActive !== false;

  if (!fromEmployeeId || !toEmployeeId) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد الموظف المحوّل منه والموظف المستلم للوردية.');
  }
  if (fromEmployeeId === toEmployeeId) {
    throw new Error('VALIDATION_ERROR: لا يمكن التحويل إلى نفس الموظف.');
  }

  return withScriptLock(function () {
    var fromEmp = findRecordById(RG_SHEETS.EMPLOYEES, 'id', fromEmployeeId);
    var toEmp = findRecordById(RG_SHEETS.EMPLOYEES, 'id', toEmployeeId);
    if (!fromEmp || !toEmp) throw new Error('NOT_FOUND: أحد الموظفين المحددين غير موجود.');
    if (normalizeStr(toEmp.status || 'active') !== 'active') {
      throw new Error('VALIDATION_ERROR: الموظف المستلم للوردية غير نشط.');
    }

    var allRes = readAllRecords(RG_SHEETS.RESERVATIONS, true);
    var now = nowIso();
    var transferredCount = 0;
    var transferredNumbers = [];
    var rowsToUpsert = [];
    var newAssignBatch = [];

    for (var i = 0; i < allRes.length; i++) {
      var res = allRes[i];
      var curIds = safeJsonParse(res.assignedEmployeeIds, []);
      if (!Array.isArray(curIds) || curIds.indexOf(fromEmployeeId) === -1) continue;
      if (onlyActive && gsIsClosedStatus_(res)) continue;

      var curNames = safeJsonParse(res.assignedEmployeeNames, []);
      if (!Array.isArray(curNames)) curNames = [];
      var nextIds = [];
      var nextNames = [];
      var seen = {};
      for (var j = 0; j < curIds.length; j++) {
        var eid = normalizeStr(curIds[j]);
        if (!eid || eid === fromEmployeeId || seen[eid]) continue;
        seen[eid] = true;
        nextIds.push(eid);
        nextNames.push(normalizeStr(curNames[j]) || eid);
      }
      if (!seen[toEmployeeId]) {
        seen[toEmployeeId] = true;
        nextIds.push(toEmployeeId);
        nextNames.push(toEmp.name);
      }

      var copyRec = {};
      for (var rk in res) {
        if (Object.prototype.hasOwnProperty.call(res, rk)) copyRec[rk] = res[rk];
      }
      copyRec.assignedEmployeeIds = JSON.stringify(nextIds);
      copyRec.assignedEmployeeNames = JSON.stringify(nextNames);
      copyRec.lastUpdateText = 'تحويل وردية جماعي: من ' + fromEmp.name + ' إلى ' + toEmp.name;
      copyRec.lastUpdatedById = session.employeeId;
      copyRec.lastUpdatedByName = session.user.name;
      copyRec.lastUpdatedAt = now;
      copyRec.updatedAt = now;
      rowsToUpsert.push(copyRec);

      newAssignBatch.push({
        id: generateId('ASN'),
        reservationId: res.id,
        reservationNumber: res.reservationNumber,
        employeeId: toEmp.id,
        employeeName: toEmp.name,
        assignedById: session.employeeId,
        assignedByName: session.user.name,
        roleType: 'shift_handover',
        status: 'active',
        assignedAt: now,
        updatedAt: now
      });

      transferredCount += 1;
      transferredNumbers.push(res.reservationNumber);
    }

    if (rowsToUpsert.length > 0) {
      batchUpsertRecords(RG_SHEETS.RESERVATIONS, 'id', rowsToUpsert);
      updateRecordsWhere_(RG_SHEETS.ASSIGNMENTS, function (a) {
        return a.employeeId === fromEmployeeId && a.status === 'active' && transferredNumbers.indexOf(a.reservationNumber) !== -1;
      }, { status: 'transferred', updatedAt: now });
      batchAppendRecords(RG_SHEETS.ASSIGNMENTS, newAssignBatch);
      createNotification(
        toEmp.id,
        '',
        'assignment',
        'استلام وردية: ' + transferredCount + ' حجز نشط',
        'تم تحويل ' + transferredCount + ' حجزًا نشطًا من ' + fromEmp.name + ' إليك بواسطة ' + session.user.name + '.',
        'Reservation',
        transferredNumbers[0] || ''
      );
    }

    logActivity(session.user, 'تحويل جماعي للوردية', 'Reservation', fromEmp.name + ' -> ' + toEmp.name,
      'تحويل ' + transferredCount + ' حجز نشط من ' + fromEmp.name + ' إلى ' + toEmp.name);

    return {
      fromEmployeeId: fromEmployeeId,
      fromEmployeeName: fromEmp.name,
      toEmployeeId: toEmployeeId,
      toEmployeeName: toEmp.name,
      transferredCount: transferredCount,
      reservationNumbers: transferredNumbers
    };
  });
}
