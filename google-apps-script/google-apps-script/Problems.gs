/**
 * RENTAL GATE CRM — Problems, Issues Mirror & High-Priority Supervisor Notifications
 */

function createProblem(session, payload) {
  requirePermission(session, 'create_problem');
  var p = payload || {};
  var reservationId = normalizeStr(p.reservationId);
  var description = normalizeStr(p.description);
  var priority = normalizeStr(p.priority) || 'متوسط';
  var assignedEmployeeIds = Array.isArray(p.assignedEmployeeIds) ? p.assignedEmployeeIds : [];

  if (!reservationId) throw new Error('معرف الحجز مطلوب.');
  if (!description) throw new Error('يرجى إدخال وصف المشكلة.');
  if (RG_PROBLEM_PRIORITIES.indexOf(priority) === -1) throw new Error('مستوى الأولوية غير صالح.');

  return withScriptLock(function () {
    var reservation = findRecordById(RG_SHEETS.RESERVATIONS, 'id', reservationId);
    if (!reservation) throw new Error('الحجز غير موجود.');

    var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
    var empMap = {};
    for (var i = 0; i < employees.length; i++) {
      empMap[employees[i].id] = employees[i];
    }

    var validIds = [];
    var validNames = [];
    for (var j = 0; j < assignedEmployeeIds.length; j++) {
      var eid = normalizeStr(assignedEmployeeIds[j]);
      if (empMap[eid] && validIds.indexOf(eid) === -1) {
        validIds.push(eid);
        validNames.push(empMap[eid].name);
      }
    }

    if (validIds.length === 0) {
      validIds.push(session.employeeId);
      validNames.push(session.user.name);
    }

    var now = nowIso();
    var problem = {
      id: generateId('PRB'),
      problemNumber: 'PRB-' + String(Date.now()).slice(-6),
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      createdById: session.employeeId,
      createdByName: session.user.name,
      assignedEmployeeIds: JSON.stringify(validIds),
      assignedEmployeeNames: JSON.stringify(validNames),
      description: description,
      priority: priority,
      status: 'جديدة',
      createdAt: now,
      updatedAt: now
    };

    appendRecord(RG_SHEETS.PROBLEMS, problem);
    appendRecord(RG_SHEETS.ISSUES, problem);

    var initialUpdate = {
      id: generateId('PRBU'),
      problemId: problem.id,
      reservationNumber: reservation.reservationNumber,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      previousStatus: '',
      newStatus: 'جديدة',
      previousPriority: '',
      newPriority: priority,
      note: 'تم إنشاء المشكلة: ' + description,
      createdAt: now
    };
    appendRecord(RG_SHEETS.PROBLEM_UPDATES, initialUpdate);

    updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', reservation.id, {
      hasProblem: 'true',
      priority: priority === 'مرتفع' ? 'مرتفع' : reservation.priority,
      updatedAt: now
    });

    logActivity(
      session.user,
      'إنشاء مشكلة',
      'Problem',
      problem.problemNumber,
      'حجز ' + reservation.reservationNumber + ' | الأولوية: ' + priority + ' | ' + description
    );

    var notifBatch = [];
    var notifiedSet = {};
    for (var k = 0; k < validIds.length; k++) {
      if (validIds[k] !== session.employeeId) {
        notifiedSet[validIds[k]] = true;
        notifBatch.push({
          recipientEmployeeId: validIds[k],
          recipientRole: '',
          type: 'new_problem',
          title: 'مشكلة جديدة مسندة إليك',
          message: 'مشكلة على الحجز ' + reservation.reservationNumber + ': ' + description,
          entityType: 'Problem',
          entityId: problem.id
        });
      }
    }

    if (priority === 'مرتفع') {
      for (var m = 0; m < employees.length; m++) {
        var emp = employees[m];
        if (!notifiedSet[emp.id] && emp.status === 'active' && (emp.role === RG_ROLES.SUPERVISOR || emp.role === RG_ROLES.GENERAL_MANAGER)) {
          notifBatch.push({
            recipientEmployeeId: emp.id,
            recipientRole: emp.role,
            type: 'high_priority_problem',
            title: 'تنبيه: مشكلة بأولوية مرتفعة',
            message: 'تم فتح مشكلة مرتفعة الأولوية للحجز ' + reservation.reservationNumber + ' (' + reservation.customerName + ') بواسطة ' + session.user.name,
            entityType: 'Problem',
            entityId: problem.id
          });
        }
      }
    }
    if (notifBatch.length > 0) createNotificationsBatch_(notifBatch);
    dispatchMentionNotifications_(
      [description],
      { id: session.employeeId, name: session.user.name },
      'Problem',
      problem.id,
      problem.problemNumber
    );
    bumpCacheVersion_('PRB');

    var clientProblem = formatProblemForClient(problem);
    clientProblem.updates = [initialUpdate];
    return clientProblem;
  });
}

function updateProblem(session, payload) {
  requirePermission(session, 'update_problem');
  var p = payload || {};
  var problemId = normalizeStr(p.problemId);
  if (!problemId) throw new Error('معرف المشكلة مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.PROBLEMS, 'id', problemId);
    if (!existing) throw new Error('المشكلة غير موجودة.');

    var newStatus = p.status ? normalizeStr(p.status) : existing.status;
    var newPriority = p.priority ? normalizeStr(p.priority) : existing.priority;
    var note = normalizeStr(p.note);
    if (newStatus === 'مغلقة' && !note) {
      note = 'تم إغلاق المشكلة';
    }

    if (RG_PROBLEM_STATUSES.indexOf(newStatus) === -1) throw new Error('حالة المشكلة غير صالحة.');
    if (RG_PROBLEM_PRIORITIES.indexOf(newPriority) === -1) throw new Error('مستوى الأولوية غير صالح.');

    var now = nowIso();
    var patch = {
      status: newStatus,
      priority: newPriority,
      updatedAt: now
    };

    var canEditTicket = hasPermission(session, 'edit_ticket_details');
    if (canEditTicket) {
      if (p.description !== undefined && normalizeStr(p.description)) {
        patch.description = normalizeStr(p.description);
      }
      if (p.customerName !== undefined && normalizeStr(p.customerName)) {
        patch.customerName = normalizeStr(p.customerName);
      }
    }

    if (Array.isArray(p.assignedEmployeeIds)) {
      var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
      var empMap = {};
      for (var i = 0; i < employees.length; i++) empMap[employees[i].id] = employees[i];
      var nextIds = [];
      var nextNames = [];
      for (var j = 0; j < p.assignedEmployeeIds.length; j++) {
        var eid = normalizeStr(p.assignedEmployeeIds[j]);
        if (empMap[eid] && nextIds.indexOf(eid) === -1) {
          nextIds.push(eid);
          nextNames.push(empMap[eid].name);
        }
      }
      patch.assignedEmployeeIds = JSON.stringify(nextIds);
      patch.assignedEmployeeNames = JSON.stringify(nextNames);
    }

    var updated = updateRecordByKey(RG_SHEETS.PROBLEMS, 'id', problemId, patch);
    if (updated) syncIssueSheetRecord(updated);

    var updateEntry = {
      id: generateId('PRBU'),
      problemId: problemId,
      reservationNumber: existing.reservationNumber,
      employeeId: session.employeeId,
      employeeName: session.user.name,
      previousStatus: existing.status,
      newStatus: newStatus,
      previousPriority: existing.priority,
      newPriority: newPriority,
      note: note || (patch.description && patch.description !== existing.description ? 'تعديل بيانات التذكرة' : ('تحديث الحالة إلى ' + newStatus)),
      createdAt: now
    };
    appendRecord(RG_SHEETS.PROBLEM_UPDATES, updateEntry);

    var actAction = 'تحديث مشكلة';
    var actParts = [];
    if (patch.description && patch.description !== existing.description) {
      actAction = 'تعديل بيانات التذكرة';
      actParts.push('تحديث وصف التذكرة');
    }
    if (existing.priority !== newPriority) {
      if (actAction === 'تحديث مشكلة') actAction = 'تغيير أولوية';
      actParts.push('الأولوية: من ' + existing.priority + ' إلى ' + newPriority);
    }
    if (existing.status !== newStatus) {
      actAction = 'تعديل حالة';
      actParts.push('الحالة: من ' + existing.status + ' إلى ' + newStatus);
    }
    if (note) {
      actParts.push(note);
    }
    if (actParts.length > 0) {
      logActivity(session.user, actAction, 'Problem', existing.problemNumber, actParts.join(' | '));
    }

    var hasOpenProblem = readAllRecords(RG_SHEETS.PROBLEMS, false).some(function (pr) {
      return pr.reservationId === existing.reservationId && pr.status !== 'مغلقة' && pr.status !== 'تم الحل';
    });
    var nextFlag = hasOpenProblem ? 'true' : 'false';
    var resRow = findRecordById(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId);
    if (resRow && String(toBool(resRow.hasProblem)) !== nextFlag) {
      updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId, {
        hasProblem: nextFlag,
        updatedAt: now
      });
    }

    if (newStatus === 'تم الحل' && existing.status !== 'تم الحل') {
      var resolvedRecipientSet = {};
      var resAssignedIds = resRow ? safeJsonParse(resRow.assignedEmployeeIds, []) : [];
      if (Array.isArray(resAssignedIds)) {
        for (var rIdx = 0; rIdx < resAssignedIds.length; rIdx++) {
          var ridVal = normalizeStr(resAssignedIds[rIdx]);
          if (ridVal) resolvedRecipientSet[ridVal] = true;
        }
      }
      var ticketAssignedIds = patch.assignedEmployeeIds
        ? safeJsonParse(patch.assignedEmployeeIds, [])
        : safeJsonParse(existing.assignedEmployeeIds, []);
      if (Array.isArray(ticketAssignedIds)) {
        for (var pIdx = 0; pIdx < ticketAssignedIds.length; pIdx++) {
          var pidVal = normalizeStr(ticketAssignedIds[pIdx]);
          if (pidVal) resolvedRecipientSet[pidVal] = true;
        }
      }
      if (existing.createdById) resolvedRecipientSet[normalizeStr(existing.createdById)] = true;
      delete resolvedRecipientSet[session.employeeId];

      var resolvedBatch = [];
      var rKeys = Object.keys(resolvedRecipientSet);
      for (var nIdx = 0; nIdx < rKeys.length; nIdx++) {
        resolvedBatch.push({
          recipientEmployeeId: rKeys[nIdx],
          recipientRole: '',
          type: 'problem_resolved',
          title: 'تم حل مشكلة على حجز مسند إليك',
          message: 'تم تغيير حالة المشكلة ' + existing.problemNumber + ' (الحجز ' + (existing.reservationNumber || '-') + ') إلى "تم الحل" بواسطة ' + session.user.name + '.',
          entityType: 'Problem',
          entityId: problemId
        });
      }
      if (resolvedBatch.length > 0) createNotificationsBatch_(resolvedBatch);
    }

    dispatchMentionNotifications_(
      [note, (patch.description && patch.description !== existing.description) ? patch.description : ''],
      { id: session.employeeId, name: session.user.name },
      'Problem',
      problemId,
      existing.problemNumber
    );

    bumpCacheVersion_('PRB');
    var clientProblem = formatProblemForClient(updated);
    clientProblem.updates = readAllRecords(RG_SHEETS.PROBLEM_UPDATES, false).filter(function (u) {
      return u.problemId === problemId;
    }).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return clientProblem;
  });
}

function deleteProblem(session, payload) {
  requirePermission(session, 'update_problem');
  var p = payload || {};
  var problemId = normalizeStr(p.problemId || p.id);
  if (!problemId) throw new Error('معرف المشكلة مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.PROBLEMS, 'id', problemId);
    if (!existing) throw new Error('المشكلة غير موجودة.');

    if (typeof deleteRecordsWhere_ === 'function') {
      deleteRecordsWhere_(RG_SHEETS.PROBLEM_UPDATES, function (u) { return u && u.problemId === problemId; });
    }
    deleteRecordByKey(RG_SHEETS.PROBLEMS, 'id', problemId);
    if (typeof getSheet === 'function' && getSheet(RG_SHEETS.ISSUES)) {
      deleteRecordByKey(RG_SHEETS.ISSUES, 'id', problemId);
    }

    var now = nowIso();
    var hasOpenProblem = false;
    if (existing.reservationId) {
      hasOpenProblem = readAllRecords(RG_SHEETS.PROBLEMS, false).some(function (pr) {
        return pr.reservationId === existing.reservationId && pr.status !== 'مغلقة' && pr.status !== 'تم الحل';
      });
      var nextFlag = hasOpenProblem ? 'true' : 'false';
      var resRow = findRecordById(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId);
      if (resRow && String(toBool(resRow.hasProblem)) !== nextFlag) {
        updateRecordByKey(RG_SHEETS.RESERVATIONS, 'id', existing.reservationId, {
          hasProblem: nextFlag,
          updatedAt: now
        });
      }
    }

    logActivity(
      session.user,
      'حذف مشكلة',
      'Problem',
      existing.problemNumber || problemId,
      'حجز ' + (existing.reservationNumber || '-') + ' | ' + (existing.customerName || '-')
    );

    bumpCacheVersion_('PRB');
    return {
      id: problemId,
      deleted: true,
      problemNumber: existing.problemNumber,
      reservationId: existing.reservationId,
      hasOpenProblemsOnReservation: hasOpenProblem
    };
  });
}

function getAllProblemsEnriched_() {
  var prbCacheKey = 'RG_PRB_ALL_V' + getCacheVersion_('PRB');
  try {
    var cachedRaw = CacheService.getScriptCache().get(prbCacheKey);
    if (cachedRaw) {
      var parsed = JSON.parse(cachedRaw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}

  var problems = readAllRecords(RG_SHEETS.PROBLEMS, false);
  var updates = readAllRecords(RG_SHEETS.PROBLEM_UPDATES, false);

  var updatesByProblem = {};
  for (var u = 0; u < updates.length; u++) {
    var pid = updates[u].problemId;
    if (!updatesByProblem[pid]) updatesByProblem[pid] = [];
    updatesByProblem[pid].push(updates[u]);
  }

  var all = [];
  for (var i = 0; i < problems.length; i++) {
    var pr = formatProblemForClient(problems[i]);
    pr.updates = (updatesByProblem[pr.id] || []).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    all.push(pr);
  }

  all.sort(function (a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });

  try {
    var serialized = JSON.stringify(all);
    if (serialized.length < 95000) {
      CacheService.getScriptCache().put(prbCacheKey, serialized, 180);
    }
  } catch (e2) {}

  return all;
}

function getProblems(session, params) {
  var pa = params || {};
  var all = getAllProblemsEnriched_();
  var filterStatus = normalizeStr(pa.status);
  var filterPriority = normalizeStr(pa.priority);
  var filterEmp = normalizeStr(pa.employeeId);
  var search = normalizeStr(pa.search).toLowerCase();

  if (!filterStatus && !filterPriority && !filterEmp && !search) {
    return { items: all, total: all.length };
  }

  var result = [];
  for (var i = 0; i < all.length; i++) {
    var pr = all[i];
    if (filterStatus && pr.status !== filterStatus) continue;
    if (filterPriority && pr.priority !== filterPriority) continue;
    if (filterEmp && pr.assignedEmployeeIds.indexOf(filterEmp) === -1) continue;
    if (search) {
      var hay = (pr.problemNumber + ' ' + pr.reservationNumber + ' ' + pr.customerName + ' ' + pr.description).toLowerCase();
      if (hay.indexOf(search) === -1) continue;
    }
    result.push(pr);
  }

  return { items: result, total: result.length };
}

function getProblemDetails(session, params) {
  var p = params || {};
  var targetId = normalizeStr(p.problemId || p.id);
  if (!targetId) throw new Error('معرف المشكلة مطلوب.');

  var all = getAllProblemsEnriched_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === targetId || all[i].problemNumber === targetId) {
      return { problem: all[i] };
    }
  }
  throw new Error('تعذر العثور على المشكلة المطلوبة.');
}

function formatProblemForClient(p) {
  return {
    id: p.id,
    problemNumber: p.problemNumber,
    reservationId: p.reservationId,
    reservationNumber: p.reservationNumber,
    customerName: p.customerName,
    createdById: p.createdById,
    createdByName: p.createdByName,
    assignedEmployeeIds: safeJsonParse(p.assignedEmployeeIds, []),
    assignedEmployeeNames: safeJsonParse(p.assignedEmployeeNames, []),
    description: p.description,
    priority: p.priority,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  };
}
