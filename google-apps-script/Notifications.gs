/**
 * RENTAL GATE CRM — In-App Notifications Service
 */

function createNotification(recipientEmployeeId, recipientRole, type, title, message, entityType, entityId) {
  appendRecord(RG_SHEETS.NOTIFICATIONS, {
    id: generateId('NTF'),
    recipientEmployeeId: recipientEmployeeId || '',
    recipientRole: recipientRole || '',
    type: type || 'info',
    title: title || '',
    message: message || '',
    entityType: entityType || '',
    entityId: entityId || '',
    isRead: 'false',
    createdAt: nowIso()
  });
}

function createNotificationsBatch_(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  var now = nowIso();
  var records = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    records.push({
      id: generateId('NTF'),
      recipientEmployeeId: it.recipientEmployeeId || '',
      recipientRole: it.recipientRole || '',
      type: it.type || 'info',
      title: it.title || '',
      message: it.message || '',
      entityType: it.entityType || '',
      entityId: it.entityId || '',
      isRead: 'false',
      createdAt: now
    });
  }
  return batchAppendRecords(RG_SHEETS.NOTIFICATIONS, records);
}

function getNotifications(session) {
  var all = readAllRecords(RG_SHEETS.NOTIFICATIONS, false);
  var mine = all.filter(function (n) {
    return n.recipientEmployeeId === session.employeeId ||
      (!n.recipientEmployeeId && n.recipientRole === session.role);
  });

  mine.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  var unreadCount = 0;
  var items = mine.slice(0, 50).map(function (n) {
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

  return { items: items, unreadCount: unreadCount };
}

function markNotificationRead(session, payload) {
  return withScriptLock(function () {
    var p = payload || {};
    var targetId = normalizeStr(p.notificationId);
    var markAll = toBool(p.markAll);

    updateRecordsWhere_(
      RG_SHEETS.NOTIFICATIONS,
      function (n) {
        if (toBool(n.isRead)) return false;
        var isMine = n.recipientEmployeeId === session.employeeId ||
          (!n.recipientEmployeeId && n.recipientRole === session.role);
        if (!isMine) return false;
        return markAll || n.id === targetId;
      },
      { isRead: 'true' }
    );
    return { updated: true };
  });
}
