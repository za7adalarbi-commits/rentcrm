/**
 * RENTAL GATE CRM — Multi-Employee Assignments, Concurrent Follow-Ups & FollowUpHistory
 */

function assignEmployees(session, payload) {
  requirePermission(session, 'assign_employees');

  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var employeeIds = Array.isArray(p.employeeIds) ? p.employeeIds : [];
  if (!reservationId) throw new Error('معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    var employees = readAllRecords(RG_SHEETS.EMPLOYEES, true);
    var empMap = {};
    for (var i = 0; i < employees.length; i++) {
      empMap[employees[i].id] = employees[i];
    }

    var previousIds = safeJsonParse(reservation.assignedEmployeeIds, []);
    var nowStr = nowIso();
    updateRecordsWhere_(
      RG_SHEETS.ASSIGNMENTS,
      function (a) { return a.reservationId === reservationId && a.status === 'active'; },
      { status: 'reassigned', updatedAt: nowStr }
    );

    var newIds = [];
    var newNames = [];
    var newAssignments = [];
    var newNotifications = [];
    for (var j = 0; j < employeeIds.length; j++) {
      var empId = normalizeStr(employeeIds[j]);
      var emp = empMap[empId];
      if (!emp || emp.status !== 'active') continue;
      if (newIds.indexOf(empId) !== -1) continue;

      newIds.push(empId);
      newNames.push(emp.name);

      newAssignments.push({
        id: generateId('ASN'),
        reservationId: reservation.id,
        reservationNumber: reservation.reservationNumber,
        employeeId: emp.id,
        employeeName: emp.name,
        assignedById: session.employeeId,
        assignedByName: session.user.name,
        roleType: j === 0 ? 'primary' : 'collaborator',
        status: 'active',
        assignedAt: nowStr,
        updatedAt: nowStr
      });

      var isReassign = previousIds.length > 0 && previousIds.indexOf(empId) === -1;
      newNotifications.push({
        recipientEmployeeId: emp.id,
        recipientRole: emp.role,
        type: isReassign ? 'reassignment' : 'new_assignment',
        title: isReassign ? 'إعادة توزيع حجز' : 'إسناد حجز جديد',
        message: 'تم إسناد الحجز رقم ' + reservation.reservationNumber + ' (' + reservation.customerName + ') إليك.',
        entityType: 'Reservation',
        entityId: reservation.id
      });
    }

    if (newAssignments.length > 0) batchAppendRecords(RG_SHEETS.ASSIGNMENTS, newAssignments);
    if (newNotifications.length > 0) createNotificationsBatch_(newNotifications);

    updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
      assignedEmployeeIds: JSON.stringify(newIds),
      assignedEmployeeNames: JSON.stringify(newNames),
      updatedAt: nowStr
    });

    logActivity(
      session.user,
      previousIds.length > 0 ? 'إعادة توزيع حجز' : 'إسناد حجز',
      'Reservation',
      reservation.reservationNumber,
      'إسناد إلى: ' + (newNames.join('، ') || 'غير مسند')
    );

    return {
      reservationId: reservation.id,
      assignedEmployeeIds: newIds,
      assignedEmployeeNames: newNames
    };
  });
}

function removeAssignment(session, payload) {
  requirePermission(session, 'assign_employees');

  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var employeeId = normalizeStr(p.employeeId);
  if (!reservationId || !employeeId) throw new Error('معرف الحجز والموظف مطلوبان.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    updateRecordsWhere_(
      RG_SHEETS.ASSIGNMENTS,
      function (a) { return a.reservationId === reservationId && a.employeeId === employeeId && a.status === 'active'; },
      { status: 'removed', updatedAt: nowIso() }
    );

    var ids = safeJsonParse(reservation.assignedEmployeeIds, []);
    var names = safeJsonParse(reservation.assignedEmployeeNames, []);
    var nextIds = [];
    var nextNames = [];
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] !== employeeId) {
        nextIds.push(ids[j]);
        if (names[j]) nextNames.push(names[j]);
      }
    }

    updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservationId, {
      assignedEmployeeIds: JSON.stringify(nextIds),
      assignedEmployeeNames: JSON.stringify(nextNames),
      updatedAt: nowIso()
    });

    logActivity(session.user, 'إزالة موظف من المتابعة', 'Reservation', reservation.reservationNumber, 'إزالة الموظف ' + employeeId);
    return { reservationId: reservationId, assignedEmployeeIds: nextIds, assignedEmployeeNames: nextNames };
  });
}

function claimReservation(session, payload) {
  requirePermission(session, 'claim_reservation');
  var reservationId = normalizeStr((payload || {}).reservationId);
  if (!reservationId) throw new Error('معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    var ids = safeJsonParse(reservation.assignedEmployeeIds, []);
    var names = safeJsonParse(reservation.assignedEmployeeNames, []);
    if (ids.indexOf(session.employeeId) === -1) {
      ids.push(session.employeeId);
      names.push(session.user.name);

      appendRecord(RG_SHEETS.ASSIGNMENTS, {
        id: generateId('ASN'),
        reservationId: reservation.id,
        reservationNumber: reservation.reservationNumber,
        employeeId: session.employeeId,
        employeeName: session.user.name,
        assignedById: session.employeeId,
        assignedByName: session.user.name,
        roleType: ids.length === 1 ? 'primary' : 'collaborator',
        status: 'active',
        assignedAt: nowIso(),
        updatedAt: nowIso()
      });

      updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
        assignedEmployeeIds: JSON.stringify(ids),
        assignedEmployeeNames: JSON.stringify(names),
        updatedAt: nowIso()
      });

      logActivity(session.user, 'استلام حجز', 'Reservation', reservation.reservationNumber, 'استلام ذاتي بواسطة ' + session.user.name);
    }

    return {
      reservationId: reservation.id,
      assignedEmployeeIds: ids,
      assignedEmployeeNames: names
    };
  });
}

function unclaimReservation(session, payload) {
  requirePermission(session, 'unclaim_reservation');
  var reservationId = normalizeStr((payload || {}).reservationId);
  if (!reservationId) throw new Error('معرف الحجز مطلوب.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    updateRecordsWhere_(
      RG_SHEETS.ASSIGNMENTS,
      function (a) { return a.reservationId === reservationId && a.employeeId === session.employeeId && a.status === 'active'; },
      { status: 'unclaimed', updatedAt: nowIso() }
    );

    var ids = safeJsonParse(reservation.assignedEmployeeIds, []);
    var names = safeJsonParse(reservation.assignedEmployeeNames, []);
    var nextIds = [];
    var nextNames = [];
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] !== session.employeeId) {
        nextIds.push(ids[j]);
        if (names[j]) nextNames.push(names[j]);
      }
    }

    updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservationId, {
      assignedEmployeeIds: JSON.stringify(nextIds),
      assignedEmployeeNames: JSON.stringify(nextNames),
      updatedAt: nowIso()
    });

    logActivity(session.user, 'إلغاء استلام حجز', 'Reservation', reservation.reservationNumber, 'إلغاء الاستلام الذاتي بواسطة ' + session.user.name);
    return { reservationId: reservationId, assignedEmployeeIds: nextIds, assignedEmployeeNames: nextNames };
  });
}

function addFollowUp(session, payload) {
  requirePermission(session, 'add_followup');
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var status = normalizeStr(p.status);
  var action = normalizeStr(p.action);
  var notes = normalizeStr(p.notes);

  if (!reservationId) throw new Error('معرف الحجز مطلوب.');
  if (!status || !isValidWorkflowStatus_(status)) {
    throw new Error('حالة المتابعة غير صالحة.');
  }
  if (!action) throw new Error('يرجى كتابة الإجراء المتخذ.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    var assignedIds = safeJsonParse(reservation.assignedEmployeeIds, []);
    var now = new Date();

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
      createdAt: now.toISOString()
    };

    appendRecord(RG_SHEETS.FOLLOWUPS, followUp);

    appendRecord(RG_SHEETS.FOLLOWUP_HISTORY, {
      id: generateId('FUH'),
      followUpId: followUp.id,
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      changeType: 'created',
      previousStatus: reservation.internalStatus || '',
      newStatus: status,
      previousAction: '',
      newAction: action,
      previousNotes: '',
      newNotes: notes,
      changedAt: now.toISOString()
    });

    var statusChanged = reservation.internalStatus !== status;
    var fuLastText = action + (notes ? ' — ' + notes : '');
    var nextStages = appendStatusStageEntry_(reservation.statusHistory, {
      source: 'followup',
      previousStatus: reservation.internalStatus || '',
      newStatus: status,
      changedAt: now.toISOString(),
      changedById: session.employeeId,
      changedByName: session.user.name,
      note: fuLastText
    });
    updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
      internalStatus: status,
      lastUpdateText: fuLastText,
      lastUpdatedById: session.employeeId,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      statusHistory: JSON.stringify(nextStages)
    });

    touchEmployeeActivityThrottled_(session.employeeId, now.toISOString());

    logActivity(
      session.user,
      statusChanged ? 'تعديل حالة' : 'إضافة متابعة',
      'Reservation',
      reservation.reservationNumber,
      'الحالة: ' + status + ' | الإجراء: ' + action + (notes ? (' | ملاحظة: ' + notes) : '')
    );

    var notifBatch = [];
    for (var i = 0; i < assignedIds.length; i++) {
      if (assignedIds[i] !== session.employeeId) {
        notifBatch.push({
          recipientEmployeeId: assignedIds[i],
          recipientRole: '',
          type: statusChanged ? 'status_change' : 'reservation_update',
          title: statusChanged ? 'تغيير حالة حجز' : 'متابعة جديدة على حجز مشترك',
          message: session.user.name + ' حدّث الحجز ' + reservation.reservationNumber + ' إلى: ' + status,
          entityType: 'Reservation',
          entityId: reservation.id
        });
      }
    }
    if (notifBatch.length > 0) createNotificationsBatch_(notifBatch);

    dispatchMentionNotifications_(
      [action, notes],
      { id: session.employeeId, name: session.user.name },
      'Reservation',
      reservation.id,
      reservation.reservationNumber
    );

    return followUp;
  });
}

function updateFollowUp(session, payload) {
  var p = payload || {};
  var followUpId = normalizeStr(p.followUpId);
  if (!followUpId) throw new Error('معرف المتابعة مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.FOLLOWUPS, 'id', followUpId);
    if (!existing) throw new Error('سجل المتابعة غير موجود.');

    if (existing.employeeId !== session.employeeId && !hasPermission(session, 'edit_any_followup')) {
      throw new Error('FORBIDDEN: لا يمكنك تعديل متابعة موظف آخر.');
    }

    var patch = {};
    if (p.status && isValidWorkflowStatus_(p.status)) patch.status = p.status;
    if (p.action) patch.action = normalizeStr(p.action);
    if (p.notes !== undefined) patch.notes = normalizeStr(p.notes);

    // Preserve old snapshot in FollowUpHistory before mutating FollowUps
    appendRecord(RG_SHEETS.FOLLOWUP_HISTORY, {
      id: generateId('FUH'),
      followUpId: existing.id,
      reservationId: existing.reservationId,
      reservationNumber: existing.reservationNumber,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      changeType: 'edited',
      previousStatus: existing.status || '',
      newStatus: patch.status || existing.status || '',
      previousAction: existing.action || '',
      newAction: patch.action || existing.action || '',
      previousNotes: existing.notes || '',
      newNotes: patch.notes !== undefined ? patch.notes : (existing.notes || ''),
      changedAt: nowIso()
    });

    var updated = updateRecordByKey(RG_SHEETS.FOLLOWUPS, 'id', followUpId, patch);

    if (toBool(p.syncToReservation) && updated) {
      var resObj = findRecordById(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId);
      var resPatch = {
        lastUpdatedById: session.employeeId,
        lastUpdatedByName: session.user.name,
        lastUpdatedAt: nowIso(),
        updatedAt: nowIso()
      };
      if (updated.status) resPatch.internalStatus = updated.status;
      if (updated.action) resPatch.lastUpdateText = updated.action + (updated.notes ? ' — ' + updated.notes : '');
      if (resObj && updated.status && updated.status !== resObj.internalStatus) {
        var updStages = appendStatusStageEntry_(resObj.statusHistory, {
          source: 'followup',
          previousStatus: resObj.internalStatus || '',
          newStatus: updated.status,
          changedAt: resPatch.updatedAt,
          changedById: session.employeeId,
          changedByName: session.user.name,
          note: resPatch.lastUpdateText || ('تعديل متابعة إلى: ' + updated.status)
        });
        resPatch.statusHistory = JSON.stringify(updStages);
      }
      updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId, resPatch);
    }

    logActivity(session.user, 'تحديث متابعة', 'FollowUp', followUpId, 'تحديث سجل متابعة الحجز ' + existing.reservationNumber);
    dispatchMentionNotifications_(
      [patch.action || existing.action || '', patch.notes !== undefined ? patch.notes : (existing.notes || '')],
      { id: session.employeeId, name: session.user.name },
      'Reservation',
      existing.reservationId,
      existing.reservationNumber
    );
    return updated;
  });
}

function getUserPinnedCriticalIds_(employeeId) {
  var map = getSettingsMap_(false);
  var raw = safeJsonParse(map['pinned_res_u_' + normalizeStr(employeeId)], []);
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length && out.length < 3; i++) {
    var val = normalizeStr(raw[i]);
    if (val && !seen[val]) {
      seen[val] = true;
      out.push(val);
    }
  }
  return out;
}

function togglePinnedCriticalReservation(session, payload) {
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  if (!reservationId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');
  var maxPins = 3;
  var settingKey = 'pinned_res_u_' + session.employeeId;

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('NOT_FOUND: الحجز غير موجود.');

    var currentIds = getUserPinnedCriticalIds_(session.employeeId);
    var exists = currentIds.indexOf(reservationId) !== -1;
    var shouldPin = typeof p.pin === 'boolean' ? p.pin : !exists;
    var nextIds;

    if (shouldPin) {
      if (exists) {
        nextIds = currentIds;
      } else if (currentIds.length >= maxPins) {
        throw new Error('VALIDATION_ERROR: الحد الأقصى لتثبيت الحجوزات الحرجة هو ' + maxPins + ' حجوزات فقط — قم بإلغاء تثبيت حجز أولاً.');
      } else {
        nextIds = [reservationId].concat(currentIds);
      }
    } else {
      nextIds = currentIds.filter(function (id) { return id !== reservationId; });
    }

    upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', settingKey, {
      key: settingKey,
      value: JSON.stringify(nextIds),
      updatedBy: session.user.name,
      updatedAt: nowIso()
    });

    logActivity(
      session.user,
      shouldPin ? 'تثبيت حجز حرج' : 'إلغاء تثبيت حجز حرج',
      'Reservation',
      reservation.reservationNumber,
      shouldPin ? ('تثبيت الحجز (' + nextIds.length + '/' + maxPins + ')') : 'إلغاء التثبيت من متابعاتي'
    );

    return { pinnedCriticalIds: nextIds, isPinned: shouldPin };
  });
}

function getMyFollowUps(session, params) {
  var allFollowUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
  var followUps = allFollowUps.filter(function (f) {
    return f.employeeId === session.employeeId;
  });
  followUps.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
  var mentionFollowUps = [];
  var myId = normalizeStr(session.employeeId);
  var myUsername = normalizeStr(session.user && session.user.username).toLowerCase();
  for (var m = 0; m < allFollowUps.length; m++) {
    var fu = allFollowUps[m];
    var combined = [normalizeStr(fu.action), normalizeStr(fu.notes)].filter(Boolean).join('\n');
    if (!combined || combined.indexOf('@') === -1) continue;
    var mentioned = extractMentionedEmployees_(combined, employees, '');
    var hitsMe = mentioned.some(function (t) {
      return (myId && t.id === myId) || (myUsername && t.username && String(t.username).toLowerCase() === myUsername);
    });
    if (hitsMe) mentionFollowUps.push(fu);
  }
  mentionFollowUps.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var reservations = readAllRecords(RG_SHEETS.RESERVATIONS, false).filter(function (r) {
    var ids = safeJsonParse(r.assignedEmployeeIds, []);
    return ids.indexOf(session.employeeId) !== -1;
  });

  return {
    followUps: followUps,
    mentionFollowUps: mentionFollowUps,
    pinnedCriticalIds: getUserPinnedCriticalIds_(session.employeeId),
    assignedReservations: reservations.map(function (r) {
      return serializeReservationForClient_(r, false);
    })
  };
}

function getTeamFollowUps(session, params) {
  var p = params || {};
  var filterEmp = normalizeStr(p.employeeId);
  var filterStatus = normalizeStr(p.status);
  var filterDate = normalizeStr(p.date);
  var isUnfiltered = !filterEmp && !filterStatus && !filterDate;
  var cacheKey = isUnfiltered ? ('RG_TEAM_FU_V' + getCacheVersion_('FU')) : '';

  if (cacheKey) {
    try {
      var cachedRaw = CacheService.getScriptCache().get(cacheKey);
      if (cachedRaw) {
        var cached = JSON.parse(cachedRaw);
        if (cached && Array.isArray(cached.items)) return cached;
      }
    } catch (e) {}
  }

  var followUps = readAllRecords(RG_SHEETS.FOLLOWUPS, false);
  var filtered = followUps.filter(function (f) {
    if (filterEmp && f.employeeId !== filterEmp) return false;
    if (filterStatus && f.status !== filterStatus) return false;
    if (filterDate && f.followUpDate !== filterDate) return false;
    return true;
  });

  filtered.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var result = { items: filtered.slice(0, 300), total: filtered.length };
  if (cacheKey) {
    try {
      var str = JSON.stringify(result);
      if (str.length < 95000) CacheService.getScriptCache().put(cacheKey, str, 180);
    } catch (e2) {}
  }
  return result;
}

function getFollowUpHistory(session, params) {
  var p = params || {};
  var reservationId = normalizeStr(p.reservationId);
  var followUpId = normalizeStr(p.followUpId);
  var rows = readAllRecords(RG_SHEETS.FOLLOWUP_HISTORY, false).filter(function (h) {
    if (reservationId && h.reservationId !== reservationId) return false;
    if (followUpId && h.followUpId !== followUpId) return false;
    return true;
  });
  rows.sort(function (a, b) {
    return String(b.changedAt).localeCompare(String(a.changedAt));
  });
  return { items: rows.slice(0, 300), total: rows.length };
}
