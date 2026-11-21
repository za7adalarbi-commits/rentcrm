/**
 * RENTAL GATE CRM — Audit Logging Service
 */

function logActivity(user, actionType, entityType, entityId, details) {
  var now = new Date();
  appendRecord(RG_SHEETS.ACTIVITY_LOG, {
    id: generateId('ACT'),
    userId: user ? user.id : 'system',
    userName: user ? user.name : 'النظام',
    userRole: user ? user.role : 'system',
    actionType: actionType || '',
    entityType: entityType || '',
    entityId: entityId || '',
    details: details || '',
    logDate: formatDateOnly(now),
    logTime: formatTimeOnly(now),
    createdAt: now.toISOString()
  });
}

function getActivityLogs(session, params) {
  var p = params || {};
  var userId = normalizeStr(p.userId);
  var actionType = normalizeStr(p.actionType);
  var entityType = normalizeStr(p.entityType);
  var entityId = normalizeStr(p.entityId);
  var date = normalizeStr(p.date);
  var dateFrom = normalizeStr(p.dateFrom);
  var dateTo = normalizeStr(p.dateTo);
  var search = normalizeStr(p.search).toLowerCase();
  var limit = Math.min(500, Math.max(1, toNumber(p.limit, 300)));

  var canViewAll = hasPermission(session, 'view_all_logs');
  var hasFilter = Boolean(userId || actionType || entityType || entityId || date || dateFrom || dateTo || search || !canViewAll);
  var logs = hasFilter
    ? readAllRecords(RG_SHEETS.ACTIVITY_LOG, false)
    : readRecentRecords_(RG_SHEETS.ACTIVITY_LOG, limit);

  var filtered = logs.filter(function (l) {
    if (!canViewAll && l.userId !== session.employeeId) {
      return false;
    }
    if (userId && l.userId !== userId) return false;
    if (actionType && l.actionType !== actionType) return false;
    if (entityType && l.entityType !== entityType) return false;
    if (entityId && l.entityId !== entityId) return false;
    if (date && l.logDate !== date) return false;
    if (dateFrom && normalizeStr(l.logDate) < dateFrom) return false;
    if (dateTo && normalizeStr(l.logDate) > dateTo) return false;
    if (search) {
      var hay = (
        normalizeStr(l.userName) + ' ' +
        normalizeStr(l.actionType) + ' ' +
        normalizeStr(l.entityType) + ' ' +
        normalizeStr(l.entityId) + ' ' +
        normalizeStr(l.details)
      ).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  return { items: filtered.slice(0, limit), total: filtered.length };
}
