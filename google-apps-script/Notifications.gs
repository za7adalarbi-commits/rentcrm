/**
 * RENTAL GATE CRM — In-App Notifications Service
 */

function parseNotificationDismissals_(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(String(raw));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function isNotificationDismissedBy_(n, employeeId) {
  if (!n || !employeeId) return false;
  var map = parseNotificationDismissals_(n.dismissedByJson);
  return Boolean(map && map[employeeId]);
}

function isNotificationOwnedBySession_(n, session) {
  if (!n || !session) return false;
  var recEmp = normalizeStr(n.recipientEmployeeId);
  if (recEmp) return recEmp === normalizeStr(session.employeeId);
  var recRole = normalizeStr(n.recipientRole);
  return recRole === normalizeStr(session.role) || recRole === 'all';
}

function createNotification(recipientEmployeeId, recipientRole, type, title, message, entityType, entityId, eventKey) {
  var recEmp = normalizeStr(recipientEmployeeId);
  var recRole = recEmp ? '' : normalizeStr(recipientRole);
  var cleanEventKey = normalizeStr(eventKey);
  if (cleanEventKey) {
    var existing = readRecentRecords_(RG_SHEETS.NOTIFICATIONS, 300);
    for (var i = 0; i < existing.length; i++) {
      var row = existing[i];
      if (!row) continue;
      if (
        normalizeStr(row.eventKey) === cleanEventKey &&
        normalizeStr(row.recipientEmployeeId) === recEmp &&
        normalizeStr(row.recipientRole) === recRole
      ) {
        return null;
      }
    }
  }
  appendRecord(RG_SHEETS.NOTIFICATIONS, {
    id: generateId('NTF'),
    recipientEmployeeId: recEmp,
    recipientRole: recRole,
    type: type || 'info',
    title: title || '',
    message: message || '',
    entityType: entityType || '',
    entityId: entityId || '',
    isRead: 'false',
    createdAt: nowIso(),
    eventKey: cleanEventKey,
    deletedAt: '',
    deletedById: '',
    dismissedByJson: ''
  });
  bumpCacheVersion_('NTF');
}

function createNotificationsBatch_(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  var now = nowIso();
  var existingKeys = {};
  var hasAnyKey = items.some(function (it) { return Boolean(it && normalizeStr(it.eventKey)); });
  if (hasAnyKey) {
    var recent = readRecentRecords_(RG_SHEETS.NOTIFICATIONS, 300);
    for (var r = 0; r < recent.length; r++) {
      var ex = recent[r];
      if (ex && normalizeStr(ex.eventKey)) {
        existingKeys[normalizeStr(ex.eventKey) + '|' + normalizeStr(ex.recipientEmployeeId) + '|' + normalizeStr(ex.recipientRole)] = true;
      }
    }
  }
  var records = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var recEmp = normalizeStr(it.recipientEmployeeId);
    var recRole = recEmp ? '' : normalizeStr(it.recipientRole);
    var evKey = normalizeStr(it.eventKey);
    if (evKey) {
      var composite = evKey + '|' + recEmp + '|' + recRole;
      if (existingKeys[composite]) continue;
      existingKeys[composite] = true;
    }
    records.push({
      id: generateId('NTF'),
      recipientEmployeeId: recEmp,
      recipientRole: recRole,
      type: it.type || 'info',
      title: it.title || '',
      message: it.message || '',
      entityType: it.entityType || '',
      entityId: it.entityId || '',
      isRead: 'false',
      createdAt: now,
      eventKey: evKey,
      deletedAt: '',
      deletedById: '',
      dismissedByJson: ''
    });
  }
  if (records.length === 0) return 0;
  var count = batchAppendRecords(RG_SHEETS.NOTIFICATIONS, records);
  bumpCacheVersion_('NTF');
  return count;
}

function getNotifications(session) {
  var cacheKey = 'RG_NTF_U_' + session.employeeId + '_V' + getCacheVersion_('NTF');
  try {
    var cachedRaw = CacheService.getScriptCache().get(cacheKey);
    if (cachedRaw) {
      var parsed = JSON.parse(cachedRaw);
      if (parsed && Array.isArray(parsed.items)) return parsed;
    }
  } catch (e) {}

  var all = readRecentRecords_(RG_SHEETS.NOTIFICATIONS, 300);
  var mine = all.filter(function (n) {
    if (!n || normalizeStr(n.deletedAt)) return false;
    if (isNotificationDismissedBy_(n, session.employeeId)) return false;
    return isNotificationOwnedBySession_(n, session);
  });

  mine.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var unreadCount = 0;
  var items = mine.slice(0, 60).map(function (n) {
    var read = toBool(n.isRead);
    if (!read) unreadCount++;
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      entityType: n.entityType,
      entityId: n.entityId,
      isRead: read,
      createdAt: n.createdAt
    };
  });

  var payload = { items: items, unreadCount: unreadCount };
  try {
    var serialized = JSON.stringify(payload);
    if (serialized.length < 95000) {
      CacheService.getScriptCache().put(cacheKey, serialized, 180);
    }
  } catch (e2) {}
  return payload;
}

function markNotificationRead(session, payload) {
  return withScriptLock(function () {
    var p = payload || {};
    var targetId = normalizeStr(p.notificationId);
    var markAll = toBool(p.markAll);

    if (!markAll && targetId) {
      var existing = findRecordById(RG_SHEETS.NOTIFICATIONS, 'id', targetId);
      if (
        existing &&
        !normalizeStr(existing.deletedAt) &&
        !isNotificationDismissedBy_(existing, session.employeeId) &&
        !toBool(existing.isRead) &&
        isNotificationOwnedBySession_(existing, session)
      ) {
        updateRecordByKey(RG_SHEETS.NOTIFICATIONS, 'id', targetId, { isRead: 'true' });
      }
      bumpCacheVersion_('NTF');
      return { updated: true };
    }

    updateRecordsWhere_(
      RG_SHEETS.NOTIFICATIONS,
      function (n) {
        if (!n || normalizeStr(n.deletedAt) || toBool(n.isRead)) return false;
        if (isNotificationDismissedBy_(n, session.employeeId)) return false;
        if (!isNotificationOwnedBySession_(n, session)) return false;
        return markAll || normalizeStr(n.id) === targetId;
      },
      { isRead: 'true' }
    );
    bumpCacheVersion_('NTF');
    return { updated: true };
  });
}

function deleteNotification(session, payload) {
  return withScriptLock(function () {
    var p = payload || {};
    var deleteAll = toBool(p.deleteAll);
    var targetId = normalizeStr(p.notificationId || p.id);
    if (!deleteAll && !targetId) {
      throw new Error('معرف الإشعار مطلوب.');
    }

    var now = nowIso();
    var empId = normalizeStr(session.employeeId);
    var updated = updateRecordsWhere_(
      RG_SHEETS.NOTIFICATIONS,
      function (n) {
        if (!n || normalizeStr(n.deletedAt)) return false;
        if (isNotificationDismissedBy_(n, empId)) return false;
        if (!isNotificationOwnedBySession_(n, session)) return false;
        return deleteAll || normalizeStr(n.id) === targetId;
      },
      function (n) {
        var recEmp = normalizeStr(n.recipientEmployeeId);
        if (recEmp === empId) {
          return { deletedAt: now, deletedById: empId };
        }
        var dMap = parseNotificationDismissals_(n.dismissedByJson);
        dMap[empId] = now;
        return { dismissedByJson: JSON.stringify(dMap) };
      }
    );

    var deletedIds = (updated || []).map(function (r) { return normalizeStr(r.id); }).filter(Boolean);
    bumpCacheVersion_('NTF');
    var fresh = getNotifications(session);
    return {
      deleted: true,
      deletedCount: deletedIds.length,
      deletedIds: deletedIds,
      deletedAllBefore: deleteAll ? now : '',
      items: fresh.items || [],
      unreadCount: fresh.unreadCount || 0
    };
  });
}
