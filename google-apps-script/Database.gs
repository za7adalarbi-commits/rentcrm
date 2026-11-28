/**
 * RENTAL GATE CRM — Google Sheets Database Layer
 * Auto-creates Spreadsheet if missing, appends new schema columns safely without data loss,
 * uses LockService for concurrent writes, CacheService for read optimization,
 * and batch getValues/setValues operations.
 */

var RG_SHEETS_SCHEMA = {
  Users: [
    'id', 'name', 'username', 'phone', 'email', 'jobTitle',
    'role', 'permissions', 'uiOverrides', 'status', 'lastActivity', 'createdAt', 'updatedAt'
  ],
  Employees: [
    'id', 'name', 'username', 'passwordHash', 'salt', 'phone', 'email',
    'jobTitle', 'role', 'permissions', 'uiOverrides', 'status', 'lastActivity', 'createdAt', 'updatedAt'
  ],
  Reservations: [
    'id', 'sourceReservationId', 'reservationNumber', 'sourceCreatedAt',
    'customerName', 'customerPhone', 'customerEmail', 'customerIdNumber',
    'companyName', 'branchName', 'deliverBranchName',
    'carName', 'plateNumber', 'carCategory',
    'startDate', 'startTime', 'originalEndDate', 'originalEndTime',
    'endDate', 'endTime', 'extendedUntilDate', 'extendedUntilTime',
    'daysCount', 'extendedDaysCount', 'totalDaysCount',
    'originalStatusCode', 'originalStatusAr', 'pickupTypeAr', 'returnTypeAr',
    'paymentMethod', 'paymentStatus', 'dailyPrice', 'discountAmount', 'vatAmount',
    'baseAmount', 'extensionsCount', 'extensionsAmount', 'totalAmount', 'hasExtensions',
    'internalStatus', 'priority', 'assignedEmployeeIds', 'assignedEmployeeNames',
    'lastUpdateText', 'lastUpdatedById', 'lastUpdatedByName', 'lastUpdatedAt',
    'hasProblem', 'pinnedNote', 'pinnedNoteById', 'pinnedNoteByName', 'pinnedNoteUpdatedAt', 'noAnswerCount',
    'companyNumber', 'newCompanyName', 'rejectionReason', 'carStatusAtRequest', 'refundAmount',
    'rejectedById', 'rejectedByName', 'rejectedAt',
    'cancellationReason', 'cancelledById', 'cancelledByName', 'cancelledAt',
    'createdAt', 'updatedAt', 'statusHistory', 'rawJson', 'sourceOrder'
  ],
  Extensions: [
    'id', 'extensionNumber', 'sequenceNumber', 'reservationId', 'reservationNumber',
    'sourceReservationId', 'extensionType', 'extensionTypeAr', 'statusCode',
    'statusAr', 'paymentStatus', 'paymentDate', 'paymentMethod', 'extendDays',
    'startDate', 'startTime', 'endDate', 'endTime',
    'subTotal', 'vatAmount', 'amount', 'isAcceptedAndPaid', 'syncedAt'
  ],
  Assignments: [
    'id', 'reservationId', 'reservationNumber', 'employeeId', 'employeeName',
    'assignedById', 'assignedByName', 'roleType', 'status', 'assignedAt', 'updatedAt'
  ],
  FollowUps: [
    'id', 'reservationId', 'reservationNumber', 'customerName', 'employeeId',
    'employeeName', 'status', 'action', 'notes', 'followUpDate', 'followUpTime', 'createdAt'
  ],
  FollowUpHistory: [
    'id', 'followUpId', 'reservationId', 'reservationNumber', 'employeeId',
    'employeeName', 'changeType', 'previousStatus', 'newStatus', 'previousAction',
    'newAction', 'previousNotes', 'newNotes', 'changedAt'
  ],
  Issues: [
    'id', 'problemNumber', 'reservationId', 'reservationNumber', 'customerName',
    'createdById', 'createdByName', 'assignedEmployeeIds', 'assignedEmployeeNames',
    'description', 'priority', 'status', 'createdAt', 'updatedAt'
  ],
  Problems: [
    'id', 'problemNumber', 'reservationId', 'reservationNumber', 'customerName',
    'createdById', 'createdByName', 'assignedEmployeeIds', 'assignedEmployeeNames',
    'description', 'priority', 'status', 'createdAt', 'updatedAt'
  ],
  ProblemUpdates: [
    'id', 'problemId', 'reservationNumber', 'employeeId', 'employeeName',
    'previousStatus', 'newStatus', 'previousPriority', 'newPriority', 'note', 'createdAt'
  ],
  ActivityLog: [
    'id', 'userId', 'userName', 'userRole', 'actionType', 'entityType',
    'entityId', 'details', 'logDate', 'logTime', 'createdAt'
  ],
  Notifications: [
    'id', 'recipientEmployeeId', 'recipientRole', 'type', 'title',
    'message', 'entityType', 'entityId', 'isRead', 'createdAt',
    'eventKey', 'deletedAt', 'deletedById', 'dismissedByJson'
  ],
  Settings: [
    'key', 'value', 'updatedBy', 'updatedAt'
  ],
  Roles: [
    'id', 'label', 'jobTitle', 'role', 'permissions', 'updatedBy', 'updatedAt'
  ],
  Permissions: [
    'key', 'label', 'group', 'isCustom', 'updatedBy', 'updatedAt'
  ],
  Sessions: [
    'tokenHash', 'employeeId', 'username', 'role', 'expiresAt',
    'createdAt', 'lastSeenAt', 'isRevoked'
  ],
  SyncLog: [
    'id', 'triggeredById', 'triggeredByName', 'status', 'importedCount',
    'updatedCount', 'extensionsCount', 'pagesFetched', 'errorMessage',
    'durationMs', 'startedAt', 'finishedAt'
  ],
  Announcements: [
    'id', 'title', 'message', 'tone', 'isPinned', 'isActive', 'startsAt', 'expiresAt',
    'createdById', 'createdByName', 'createdByRole', 'createdAt', 'updatedAt'
  ],
  Delegations: [
    'id', 'delegateEmployeeId', 'delegateEmployeeName', 'delegatedRole',
    'grantedById', 'grantedByName', 'reason', 'startsAt', 'expiresAt',
    'status', 'revokedAt', 'revokedById', 'revokedByName', 'createdAt', 'updatedAt'
  ],
  ReservationLocks: [
    'reservationId', 'lockedById', 'lockedByName', 'lockedByRole', 'lockedAt', 'expiresAt'
  ]
};

var _rgSpreadsheetCache = null;
var _rgSpreadsheetTzCache = '';
var _rgSheetObjCache = {};
var _rgVerifiedSheetsCache = {};
var _rgRecordsCache = {};
var _rgSettingsMapCache = null;
var _rgVersionMemCache = {};
var _rgDirtyCacheSheets = {};
var _rgScriptLockDepth = 0;
var RG_CACHE_CHUNK_SIZE = 95000;
var RG_CACHE_MAX_CHUNKS = 20;
var RG_CACHE_TTL_SECONDS = 600;
var RG_DATE_ONLY_FIELDS = {
  startDate: true,
  originalEndDate: true,
  endDate: true,
  extendedUntilDate: true,
  followUpDate: true,
  logDate: true
};
var RG_TIME_ONLY_FIELDS = {
  startTime: true,
  originalEndTime: true,
  endTime: true,
  extendedUntilTime: true,
  followUpTime: true,
  logTime: true
};
var RG_HOT_PERSIST_CACHE_SHEETS = {
  Employees: true,
  Settings: true,
  Problems: true,
  Notifications: true,
  FollowUps: true,
  Reservations: true,
  Assignments: true,
  Extensions: true,
  ProblemUpdates: true
};

function getSpreadsheetTz_() {
  if (_rgSpreadsheetTzCache) return _rgSpreadsheetTzCache;
  try {
    var ss = getSpreadsheet();
    _rgSpreadsheetTzCache = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Riyadh';
  } catch (e) {
    _rgSpreadsheetTzCache = 'Asia/Riyadh';
  }
  return _rgSpreadsheetTzCache;
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatCellDateFast_(cell, ssTz, mode) {
  if (ssTz === 'Asia/Riyadh') {
    var adj = new Date(cell.getTime() + 10800000);
    if (mode === 'date') {
      return adj.getUTCFullYear() + '-' + pad2_(adj.getUTCMonth() + 1) + '-' + pad2_(adj.getUTCDate());
    }
    return pad2_(adj.getUTCHours()) + ':' + pad2_(adj.getUTCMinutes()) + ':' + pad2_(adj.getUTCSeconds());
  }
  return Utilities.formatDate(cell, ssTz, mode === 'date' ? 'yyyy-MM-dd' : 'HH:mm:ss');
}

function getSpreadsheet() {
  if (_rgSpreadsheetCache) return _rgSpreadsheetCache;
  var props = PropertiesService.getScriptProperties();
  var sheetId = normalizeStr(props.getProperty('SPREADSHEET_ID'));
  if (sheetId) {
    try {
      _rgSpreadsheetCache = SpreadsheetApp.openById(sheetId);
      return _rgSpreadsheetCache;
    } catch (e) {
      throw new Error('تعذر فتح ملف Google Sheets بالمعرف المخزن (' + sheetId + '): ' + e.message);
    }
  }

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    _rgSpreadsheetCache = active;
    return _rgSpreadsheetCache;
  }

  var created = SpreadsheetApp.create('RENTAL_GATE_CRM_DB');
  props.setProperty('SPREADSHEET_ID', created.getId());
  _rgSpreadsheetCache = created;
  return _rgSpreadsheetCache;
}

function withScriptLock(fn) {
  if (_rgScriptLockDepth > 0) {
    _rgScriptLockDepth += 1;
    try {
      return fn();
    } finally {
      _rgScriptLockDepth -= 1;
    }
  }
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(20000);
  if (!acquired) {
    throw new Error('النظام مشغول حالياً بمعالجة عملية متزامنة أخرى، يرجى المحاولة بعد ثوانٍ.');
  }
  _rgScriptLockDepth += 1;
  try {
    return fn();
  } finally {
    _rgScriptLockDepth -= 1;
    lock.releaseLock();
  }
}

function getCacheKey(sheetName) {
  return 'RG_CACHE_V2_' + sheetName;
}

function getCacheVersion_(ns) {
  if (_rgVersionMemCache[ns]) return _rgVersionMemCache[ns];
  try {
    var v = CacheService.getScriptCache().get('RG_VER_' + ns);
    _rgVersionMemCache[ns] = v || '1';
    return _rgVersionMemCache[ns];
  } catch (e) {
    return '1';
  }
}

function bumpCacheVersion_(ns) {
  var next = String(Date.now()) + '_' + Math.floor(Math.random() * 1000);
  _rgVersionMemCache[ns] = next;
  try {
    CacheService.getScriptCache().put('RG_VER_' + ns, next, 21600);
  } catch (e) {}
  return next;
}

function flushDirtyScriptCaches_() {
  var names = Object.keys(_rgDirtyCacheSheets);
  if (!names.length) return;
  for (var i = 0; i < names.length; i++) {
    var sheetName = names[i];
    delete _rgDirtyCacheSheets[sheetName];
    if (!RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) continue;
    var records = _rgRecordsCache[sheetName];
    if (!Array.isArray(records)) continue;
    try {
      putChunkedCache_(sheetName, JSON.stringify(records));
    } catch (e) {}
  }
}

function invalidateCache(sheetName, keepMemCache) {
  if (sheetName && !keepMemCache) {
    delete _rgRecordsCache[sheetName];
    delete _rgDirtyCacheSheets[sheetName];
  }
  if (sheetName === RG_SHEETS.SETTINGS) {
    _rgSettingsMapCache = null;
    bumpCacheVersion_('EMP');
  }
  if (sheetName === RG_SHEETS.RESERVATIONS) {
    bumpCacheVersion_('RES');
    if (typeof _rgDashMemCache === 'object') _rgDashMemCache = {};
  } else if (sheetName === RG_SHEETS.FOLLOWUPS) {
    bumpCacheVersion_('FU');
    if (typeof _rgDashMemCache === 'object') _rgDashMemCache = {};
  } else if (sheetName === RG_SHEETS.PROBLEMS || sheetName === RG_SHEETS.PROBLEM_UPDATES) {
    bumpCacheVersion_('PRB');
    if (typeof _rgDashMemCache === 'object') _rgDashMemCache = {};
  } else if (sheetName === RG_SHEETS.NOTIFICATIONS) {
    bumpCacheVersion_('NTF');
  } else if (sheetName === RG_SHEETS.EMPLOYEES || sheetName === RG_SHEETS.DELEGATIONS) {
    bumpCacheVersion_('EMP');
  } else if (sheetName === RG_SHEETS.ANNOUNCEMENTS) {
    bumpCacheVersion_('ANN');
  }

  try {
    var base = getCacheKey(sheetName);
    var keys = [];
    if (!keepMemCache || !RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) {
      keys.push(base, base + '_META');
      for (var i = 0; i < RG_CACHE_MAX_CHUNKS; i++) {
        keys.push(base + '_' + i);
      }
    }
    if (sheetName === RG_SHEETS.SETTINGS) {
      keys.push('RG_SETTINGS_MAP_V1');
    }
    if (sheetName === RG_SHEETS.RESERVATIONS) {
      keys.push('RG_FACETS_V1');
    }
    if (keys.length > 0) {
      CacheService.getScriptCache().removeAll(keys);
    }
  } catch (e) {}
}

function invalidateAllCaches() {
  _rgRecordsCache = {};
  _rgDirtyCacheSheets = {};
  _rgVersionMemCache = {};
  _rgSettingsMapCache = null;
  if (typeof _rgDashMemCache === 'object') _rgDashMemCache = {};
  var names = Object.keys(RG_SHEETS_SCHEMA);
  for (var i = 0; i < names.length; i++) {
    invalidateCache(names[i]);
  }
}

function encodeCachePayload_(serialized) {
  if (serialized.length <= RG_CACHE_CHUNK_SIZE) return serialized;
  try {
    var blob = Utilities.newBlob(serialized, 'text/plain; charset=utf-8');
    var gz = Utilities.gzip(blob);
    return 'GZ:' + Utilities.base64Encode(gz.getBytes());
  } catch (e) {
    return serialized;
  }
}

function decodeCachePayload_(rawStr) {
  if (!rawStr) return null;
  if (rawStr.indexOf('GZ:') === 0) {
    var bytes = Utilities.base64Decode(rawStr.substring(3));
    var gzBlob = Utilities.newBlob(bytes, 'application/x-gzip');
    var plain = Utilities.ungzip(gzBlob).getDataAsString('utf-8');
    return JSON.parse(plain);
  }
  return JSON.parse(rawStr);
}

function putChunkedCache_(sheetName, serialized) {
  try {
    var cache = CacheService.getScriptCache();
    var base = getCacheKey(sheetName);
    var encoded = encodeCachePayload_(serialized);
    if (encoded.length <= RG_CACHE_CHUNK_SIZE) {
      cache.put(base, encoded, RG_CACHE_TTL_SECONDS);
      return;
    }
    var totalChunks = Math.ceil(encoded.length / RG_CACHE_CHUNK_SIZE);
    if (totalChunks > RG_CACHE_MAX_CHUNKS) return;
    var batch = {};
    batch[base + '_META'] = String(totalChunks);
    for (var i = 0; i < totalChunks; i++) {
      batch[base + '_' + i] = encoded.substring(i * RG_CACHE_CHUNK_SIZE, (i + 1) * RG_CACHE_CHUNK_SIZE);
    }
    cache.remove(base);
    cache.putAll(batch, RG_CACHE_TTL_SECONDS);
  } catch (e) {}
}

function getChunkedCache_(sheetName) {
  try {
    var cache = CacheService.getScriptCache();
    var base = getCacheKey(sheetName);
    var direct = cache.get(base);
    if (direct) return decodeCachePayload_(direct);

    var metaRaw = cache.get(base + '_META');
    var totalChunks = Number(metaRaw || 0);
    if (!totalChunks || totalChunks < 1 || totalChunks > RG_CACHE_MAX_CHUNKS) return null;

    var keys = [];
    for (var i = 0; i < totalChunks; i++) {
      keys.push(base + '_' + i);
    }
    var got = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j < totalChunks; j++) {
      var chunk = got[base + '_' + j];
      if (!chunk) return null;
      parts.push(chunk);
    }
    return decodeCachePayload_(parts.join(''));
  } catch (e) {
    return null;
  }
}

function putCompressedJsonCache_(key, value, ttlSeconds) {
  if (!key) return false;
  try {
    var serialized = JSON.stringify(value);
    var encoded = encodeCachePayload_(serialized);
    if (encoded.length <= RG_CACHE_CHUNK_SIZE) {
      CacheService.getScriptCache().put(key, encoded, ttlSeconds || 180);
      return true;
    }
  } catch (e) {}
  return false;
}

function getCompressedJsonCache_(key) {
  if (!key) return null;
  try {
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return decodeCachePayload_(raw);
  } catch (e) {
    return null;
  }
}

function styleHeaderRange(range) {
  range
    .setBackground('#313232')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
}

function ensureSheetSchemaColumns(sheet, expectedHeaders) {
  if (!expectedHeaders || expectedHeaders.length === 0) return expectedHeaders || [];
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    styleHeaderRange(sheet.getRange(1, 1, 1, expectedHeaders.length));
    sheet.setFrozenRows(1);
    var initRows = Math.max(1, sheet.getMaxRows() - 1);
    for (var dc = 0; dc < expectedHeaders.length; dc++) {
      var dh = expectedHeaders[dc];
      if (RG_DATE_ONLY_FIELDS[dh] || RG_TIME_ONLY_FIELDS[dh]) {
        sheet.getRange(2, dc + 1, initRows, 1).setNumberFormat('@');
      }
    }
    return expectedHeaders.slice();
  }

  var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return normalizeStr(h);
  });

  var missingHeaders = [];
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (existingHeaders.indexOf(expectedHeaders[i]) === -1) {
      missingHeaders.push(expectedHeaders[i]);
    }
  }

  if (missingHeaders.length > 0) {
    var startCol = existingHeaders.length + 1;
    sheet.getRange(1, startCol, 1, missingHeaders.length).setValues([missingHeaders]);
    styleHeaderRange(sheet.getRange(1, startCol, 1, missingHeaders.length));
    var maxBodyRows = Math.max(1, sheet.getMaxRows() - 1);
    for (var mc = 0; mc < missingHeaders.length; mc++) {
      var mh = missingHeaders[mc];
      if (RG_DATE_ONLY_FIELDS[mh] || RG_TIME_ONLY_FIELDS[mh]) {
        sheet.getRange(2, startCol + mc, maxBodyRows, 1).setNumberFormat('@');
      }
    }
    existingHeaders = existingHeaders.concat(missingHeaders);
  }
  return existingHeaders;
}

function getSheetOrCreate(ss, sheetName) {
  if (_rgSheetObjCache[sheetName]) {
    return _rgSheetObjCache[sheetName];
  }
  var sheet = ss.getSheetByName(sheetName);
  var headers = RG_SHEETS_SCHEMA[sheetName] || [];
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    _rgVerifiedSheetsCache[sheetName] = ensureSheetSchemaColumns(sheet, headers);
    _rgSheetObjCache[sheetName] = sheet;
    return sheet;
  }
  if (!_rgVerifiedSheetsCache[sheetName]) {
    _rgVerifiedSheetsCache[sheetName] = ensureSheetSchemaColumns(sheet, headers);
  }
  _rgSheetObjCache[sheetName] = sheet;
  return sheet;
}

function getEffectiveHeaders(sheet, sheetName) {
  if (_rgVerifiedSheetsCache[sheetName]) {
    return _rgVerifiedSheetsCache[sheetName];
  }
  var schemaHeaders = RG_SHEETS_SCHEMA[sheetName] || [];
  var resolved = ensureSheetSchemaColumns(sheet, schemaHeaders);
  _rgVerifiedSheetsCache[sheetName] = resolved;
  return resolved;
}

function syncUserSheetRecord(emp) {
  if (!emp || !emp.id) return;
  upsertRecordByKey(RG_SHEETS.USERS, 'id', emp.id, {
    id: emp.id,
    name: emp.name || '',
    username: emp.username || '',
    phone: emp.phone || '',
    email: emp.email || '',
    jobTitle: emp.jobTitle || '',
    role: emp.role || RG_ROLES.AGENT,
    permissions: typeof emp.permissions === 'string' ? emp.permissions : JSON.stringify(emp.permissions || []),
    uiOverrides: typeof emp.uiOverrides === 'string' ? emp.uiOverrides : JSON.stringify(emp.uiOverrides || {}),
    status: emp.status || 'active',
    lastActivity: emp.lastActivity || '',
    createdAt: emp.createdAt || nowIso(),
    updatedAt: emp.updatedAt || nowIso()
  });
}

function syncIssueSheetRecord(problem) {
  if (!problem || !problem.id) return;
  upsertRecordByKey(RG_SHEETS.ISSUES, 'id', problem.id, {
    id: problem.id,
    problemNumber: problem.problemNumber || '',
    reservationId: problem.reservationId || '',
    reservationNumber: problem.reservationNumber || '',
    customerName: problem.customerName || '',
    createdById: problem.createdById || '',
    createdByName: problem.createdByName || '',
    assignedEmployeeIds: typeof problem.assignedEmployeeIds === 'string'
      ? problem.assignedEmployeeIds
      : JSON.stringify(problem.assignedEmployeeIds || []),
    assignedEmployeeNames: typeof problem.assignedEmployeeNames === 'string'
      ? problem.assignedEmployeeNames
      : JSON.stringify(problem.assignedEmployeeNames || []),
    description: problem.description || '',
    priority: problem.priority || 'متوسط',
    status: problem.status || 'جديدة',
    createdAt: problem.createdAt || nowIso(),
    updatedAt: problem.updatedAt || nowIso()
  });
}

function initDatabaseCore_() {
  var ss = getSpreadsheet();
    var sheetNames = Object.keys(RG_SHEETS_SCHEMA);
    for (var i = 0; i < sheetNames.length; i++) {
      getSheetOrCreate(ss, sheetNames[i]);
      invalidateCache(sheetNames[i]);
    }

    var defaultSettings = {
      company_name: 'RENTAL GATE',
      excluded_statuses: JSON.stringify(['draft', 'test', 'abandoned']),
      session_ttl_hours: '24',
      allow_agent_view_all: 'true',
      default_language: 'ar',
      auto_sync_enabled: 'true',
      auto_sync_interval_hours: '12',
      auto_sync_interval_minutes: '0',
      job_role_presets: JSON.stringify(RG_DEFAULT_ROLE_PRESETS),
      permissions_catalog_custom: JSON.stringify([])
    };

    var settingKeys = Object.keys(defaultSettings);
    for (var k = 0; k < settingKeys.length; k++) {
      var key = settingKeys[k];
      var existing = findRecordById(RG_SHEETS.SETTINGS, 'key', key);
      if (!existing) {
        appendRecord(RG_SHEETS.SETTINGS, {
          key: key,
          value: defaultSettings[key],
          updatedBy: 'system',
          updatedAt: nowIso()
        });
      }
    }

    syncRolesSheetFromPresets(readRolePresetsSetting(), 'system');
    syncPermissionsSheetFromCatalog(readCustomPermissionsSetting(), 'system');

    var employees = readAllRecords(RG_SHEETS.EMPLOYEES, true);
    var adminCreated = false;
    if (employees.length === 0) {
      var props = PropertiesService.getScriptProperties();
      var adminUsername = props.getProperty('INITIAL_ADMIN_USER') || 'admin';
      var adminPass = props.getProperty('INITIAL_ADMIN_PASS') || 'Admin@123';
      var salt = generateId('SALT');
      var now = nowIso();
      var adminRecord = {
        id: generateId('EMP'),
        name: 'المدير العام',
        username: adminUsername,
        passwordHash: hashPassword(adminPass, salt),
        salt: salt,
        phone: '0500000000',
        email: 'admin@rentalgate.net',
        jobTitle: 'المدير العام',
        role: RG_ROLES.GENERAL_MANAGER,
        permissions: JSON.stringify(['all']),
        status: 'active',
        lastActivity: now,
        createdAt: now,
        updatedAt: now
      };
      appendRecord(RG_SHEETS.EMPLOYEES, adminRecord);
      syncUserSheetRecord(adminRecord);
      adminCreated = true;
    } else {
      for (var u = 0; u < employees.length; u++) {
        syncUserSheetRecord(employees[u]);
      }
    }

  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    initializedSheets: sheetNames,
    adminCreated: adminCreated
  };
}

function initDatabase() {
  return withScriptLock(function () {
    return initDatabaseCore_();
  });
}

function mapSheetValuesToRecords_(fileHeaders, bodyRows, ssTz, skipRawJson) {
  var colMeta = [];
  for (var hIdx = 0; hIdx < fileHeaders.length; hIdx++) {
    var hdr = normalizeStr(fileHeaders[hIdx]);
    if (!hdr) continue;
    if (skipRawJson && hdr === 'rawJson') continue;
    colMeta.push({
      idx: hIdx,
      key: hdr,
      isDateOnly: Boolean(RG_DATE_ONLY_FIELDS[hdr]),
      isTimeOnly: Boolean(RG_TIME_ONLY_FIELDS[hdr])
    });
  }

  var records = [];
  var colCount = colMeta.length;
  for (var r = 0; r < bodyRows.length; r++) {
    var row = bodyRows[r];
    var isEmpty = true;
    var obj = {};
    for (var m = 0; m < colCount; m++) {
      var cm = colMeta[m];
      var cell = row[cm.idx];
      if (cell !== '' && cell !== null && cell !== undefined) {
        isEmpty = false;
      }
      if (cell instanceof Date) {
        if (cm.isDateOnly) {
          obj[cm.key] = formatCellDateFast_(cell, ssTz, 'date');
        } else if (cm.isTimeOnly) {
          obj[cm.key] = formatCellDateFast_(cell, ssTz, 'time');
        } else {
          obj[cm.key] = cell.toISOString();
        }
      } else if (cm.isDateOnly && typeof cell === 'string' && cell.length > 10) {
        obj[cm.key] = formatDateOnly(cell);
      } else {
        obj[cm.key] = cell;
      }
    }
    if (!isEmpty) {
      records.push(obj);
    }
  }
  return records;
}

function readAllRecords(sheetName, skipCache, includeRawJson) {
  if (!skipCache) {
    if (_rgRecordsCache[sheetName]) {
      return _rgRecordsCache[sheetName];
    }
    var cachedRecords = getChunkedCache_(sheetName);
    if (cachedRecords) {
      _rgRecordsCache[sheetName] = cachedRecords;
      return cachedRecords;
    }
  }

  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
    if (!skipCache) _rgRecordsCache[sheetName] = [];
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var records = mapSheetValuesToRecords_(
    values[0],
    values.slice(1),
    getSpreadsheetTz_(),
    sheetName === RG_SHEETS.RESERVATIONS && !includeRawJson
  );

  if (!skipCache) {
    _rgRecordsCache[sheetName] = records;
    try {
      putChunkedCache_(sheetName, JSON.stringify(records));
    } catch (e) {}
  }

  return records;
}

function readRecentRecords_(sheetName, maxRows) {
  var limit = Math.max(1, Number(maxRows) || 200);
  if (_rgRecordsCache[sheetName]) {
    var mem = _rgRecordsCache[sheetName];
    return mem.length <= limit ? mem : mem.slice(mem.length - limit);
  }
  var cachedRecords = getChunkedCache_(sheetName);
  if (cachedRecords) {
    _rgRecordsCache[sheetName] = cachedRecords;
    return cachedRecords.length <= limit ? cachedRecords : cachedRecords.slice(cachedRecords.length - limit);
  }

  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];

  var totalDataRows = lastRow - 1;
  if (totalDataRows <= limit) {
    return readAllRecords(sheetName, false);
  }

  var startRow = lastRow - limit + 1;
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tailValues = sheet.getRange(startRow, 1, limit, lastCol).getValues();
  return mapSheetValuesToRecords_(headerRow, tailValues, getSpreadsheetTz_(), false);
}

function getSettingsMap_(skipCache) {
  if (!skipCache) {
    if (_rgSettingsMapCache) return _rgSettingsMapCache;
    try {
      var raw = CacheService.getScriptCache().get('RG_SETTINGS_MAP_V1');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          _rgSettingsMapCache = parsed;
          return _rgSettingsMapCache;
        }
      }
    } catch (e) {}
  }
  var rows = readAllRecords(RG_SHEETS.SETTINGS, Boolean(skipCache));
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].key) {
      map[rows[i].key] = rows[i].value;
    }
  }
  if (!skipCache) {
    _rgSettingsMapCache = map;
    try {
      CacheService.getScriptCache().put('RG_SETTINGS_MAP_V1', JSON.stringify(map), RG_CACHE_TTL_SECONDS);
    } catch (e) {}
  }
  return map;
}

function findRecordById(sheetName, idField, idValue, skipCache) {
  var target = normalizeStr(idValue);
  if (!target) return null;
  if (!skipCache && sheetName === RG_SHEETS.SETTINGS && idField === 'key') {
    var map = getSettingsMap_(false);
    if (Object.prototype.hasOwnProperty.call(map, target)) {
      return { key: target, value: map[target] };
    }
    return null;
  }
  var rows = readAllRecords(sheetName, Boolean(skipCache));
  for (var i = 0; i < rows.length; i++) {
    if (normalizeStr(rows[i][idField]) === target) {
      return rows[i];
    }
  }
  return null;
}

function applyTextFormatForDateColumns_(sheet, headers, startRow, numRows) {
  if (!sheet || !headers || numRows < 1) return;
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    if (RG_DATE_ONLY_FIELDS[h] || RG_TIME_ONLY_FIELDS[h]) {
      sheet.getRange(startRow, c + 1, numRows, 1).setNumberFormat('@');
    }
  }
}

function recordToRowArray(headers, recordObj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var val = recordObj[headers[i]];
    row.push(val !== undefined && val !== null ? val : '');
  }
  return row;
}

function cloneRecordForCache_(sheetName, recordObj) {
  var copy = {};
  for (var k in recordObj) {
    if (!Object.prototype.hasOwnProperty.call(recordObj, k)) continue;
    if (sheetName === RG_SHEETS.RESERVATIONS && k === 'rawJson') continue;
    copy[k] = recordObj[k];
  }
  return copy;
}

function touchEmployeeActivityThrottled_(employeeId, isoNow) {
  var eid = normalizeStr(employeeId);
  if (!eid) return;
  var throttleKey = 'RG_EMP_ACT_' + eid;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(throttleKey)) return;
    cache.put(throttleKey, '1', 300);
  } catch (e) {}

  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, RG_SHEETS.EMPLOYEES);
  var headers = getEffectiveHeaders(sheet, RG_SHEETS.EMPLOYEES);
  var idIdx = headers.indexOf('id');
  var actIdx = headers.indexOf('lastActivity');
  if (idIdx === -1 || actIdx === -1) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var idVals = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  var stamp = isoNow || nowIso();
  for (var r = 0; r < idVals.length; r++) {
    if (normalizeStr(idVals[r][0]) === eid) {
      sheet.getRange(r + 2, actIdx + 1).setValue(stamp);
      if (_rgRecordsCache[RG_SHEETS.EMPLOYEES]) {
        var mem = _rgRecordsCache[RG_SHEETS.EMPLOYEES];
        for (var m = 0; m < mem.length; m++) {
          if (normalizeStr(mem[m].id) === eid) {
            mem[m].lastActivity = stamp;
            break;
          }
        }
        _rgDirtyCacheSheets[RG_SHEETS.EMPLOYEES] = true;
      }
      return;
    }
  }
}

function appendRecord(sheetName, recordObj) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var row = recordToRowArray(headers, recordObj);
  var nextRow = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(nextRow, 1, 1, headers.length).setValues([row]);
  if (Array.isArray(_rgRecordsCache[sheetName])) {
    _rgRecordsCache[sheetName].push(cloneRecordForCache_(sheetName, recordObj));
    if (RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) _rgDirtyCacheSheets[sheetName] = true;
    invalidateCache(sheetName, true);
  } else {
    invalidateCache(sheetName, false);
  }
  return recordObj;
}

function batchAppendRecords(sheetName, recordsList) {
  if (!Array.isArray(recordsList) || recordsList.length === 0) return 0;
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var rows = [];
  for (var i = 0; i < recordsList.length; i++) {
    rows.push(recordToRowArray(headers, recordsList[i]));
  }
  var startRow = Math.max(2, sheet.getLastRow() + 1);
  applyTextFormatForDateColumns_(sheet, headers, startRow, rows.length);
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  if (Array.isArray(_rgRecordsCache[sheetName])) {
    for (var j = 0; j < recordsList.length; j++) {
      _rgRecordsCache[sheetName].push(cloneRecordForCache_(sheetName, recordsList[j]));
    }
    if (RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) _rgDirtyCacheSheets[sheetName] = true;
    invalidateCache(sheetName, true);
  } else {
    invalidateCache(sheetName, false);
  }
  return rows.length;
}

function updateRecordByKey(sheetName, keyField, keyValue, patchObj) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1) throw new Error('حقل المفتاح غير موجود: ' + keyField);

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  var keyValues = sheet.getRange(2, keyIndex + 1, lastRow - 1, 1).getValues();
  var target = normalizeStr(keyValue);

  for (var r = 0; r < keyValues.length; r++) {
    if (normalizeStr(keyValues[r][0]) === target) {
      var rowNum = r + 2;
      var rowArr = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      var updated = {};
      for (var c = 0; c < headers.length; c++) {
        var h = headers[c];
        if (Object.prototype.hasOwnProperty.call(patchObj, h)) {
          rowArr[c] = patchObj[h] !== undefined && patchObj[h] !== null ? patchObj[h] : '';
        }
        updated[h] = rowArr[c] instanceof Date ? rowArr[c].toISOString() : rowArr[c];
      }
      sheet.getRange(rowNum, 1, 1, headers.length).setValues([rowArr]);
      if (Array.isArray(_rgRecordsCache[sheetName])) {
        var mem = _rgRecordsCache[sheetName];
        for (var m = 0; m < mem.length; m++) {
          if (normalizeStr(mem[m][keyField]) === target) {
            mem[m] = cloneRecordForCache_(sheetName, updated);
            break;
          }
        }
        if (RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) _rgDirtyCacheSheets[sheetName] = true;
        invalidateCache(sheetName, true);
      } else {
        invalidateCache(sheetName, false);
      }
      return updated;
    }
  }
  return null;
}

function updateRecordsWhere_(sheetName, predicateFn, patchOrUpdaterFn) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var ssTz = getSpreadsheetTz_();
  var minDirty = -1;
  var maxDirty = -1;
  var updatedRecords = [];

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
    if (!predicateFn(obj)) continue;

    var patch = typeof patchOrUpdaterFn === 'function' ? patchOrUpdaterFn(obj) : patchOrUpdaterFn;
    if (!patch || typeof patch !== 'object') continue;

    for (var uc = 0; uc < headers.length; uc++) {
      var uh = headers[uc];
      if (Object.prototype.hasOwnProperty.call(patch, uh)) {
        row[uc] = patch[uh] !== undefined && patch[uh] !== null ? patch[uh] : '';
        obj[uh] = row[uc];
      }
    }
    if (minDirty === -1) minDirty = r;
    maxDirty = r;
    updatedRecords.push(obj);
  }

  if (minDirty !== -1) {
    var sliceCount = maxDirty - minDirty + 1;
    sheet.getRange(minDirty + 2, 1, sliceCount, headers.length).setValues(values.slice(minDirty, maxDirty + 1));
    invalidateCache(sheetName, false);
  }
  return updatedRecords;
}

function upsertRecordByKey(sheetName, keyField, keyValue, recordObj) {
  var updated = updateRecordByKey(sheetName, keyField, keyValue, recordObj);
  if (updated) return { action: 'updated', record: updated };
  appendRecord(sheetName, recordObj);
  return { action: 'inserted', record: recordObj };
}

function normalizeCellForDiff_(cell, fieldName, ssTz) {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    if (RG_DATE_ONLY_FIELDS[fieldName]) return formatCellDateFast_(cell, ssTz, 'date');
    if (RG_TIME_ONLY_FIELDS[fieldName]) return formatCellDateFast_(cell, ssTz, 'time');
    return cell.toISOString();
  }
  if (RG_DATE_ONLY_FIELDS[fieldName] && typeof cell === 'string' && cell.length > 10) {
    return formatDateOnly(cell);
  }
  return String(cell);
}

function writeDirtyRowSpans_(sheet, colCount, existingValues, dirtyIndices) {
  if (!dirtyIndices || dirtyIndices.length === 0) return;
  dirtyIndices.sort(function (a, b) { return a - b; });

  var spans = [];
  var spanStart = dirtyIndices[0];
  var spanEnd = dirtyIndices[0];
  for (var i = 1; i < dirtyIndices.length; i++) {
    var idx = dirtyIndices[i];
    if (idx === spanEnd) continue;
    // Merge nearby dirty rows (gap <= 15) to reduce Sheets API calls while avoiding full-sheet rewrites
    if (idx - spanEnd <= 15) {
      spanEnd = idx;
    } else {
      spans.push([spanStart, spanEnd]);
      spanStart = idx;
      spanEnd = idx;
    }
  }
  spans.push([spanStart, spanEnd]);

  for (var s = 0; s < spans.length; s++) {
    var a = spans[s][0];
    var b = spans[s][1];
    sheet.getRange(a + 2, 1, b - a + 1, colCount).setValues(existingValues.slice(a, b + 1));
  }
}

function batchUpsertRecords(sheetName, keyField, recordsList, options) {
  if (!Array.isArray(recordsList) || recordsList.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1) throw new Error('حقل المفتاح غير موجود: ' + keyField);

  var ignoreDiff = (options && options.ignoreDiffKeys) || null;
  var ssTz = getSpreadsheetTz_();
  var lastRow = sheet.getLastRow();
  var existingValues = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  var rowIndexByKey = {};
  for (var r = 0; r < existingValues.length; r++) {
    var k = normalizeStr(existingValues[r][keyIndex]);
    if (k) rowIndexByKey[k] = r;
  }

  var updatedCount = 0;
  var dirtyIndices = [];
  var insertedRows = [];

  for (var i = 0; i < recordsList.length; i++) {
    var rec = recordsList[i];
    var keyVal = normalizeStr(rec[keyField]);
    if (!keyVal) continue;

    if (Object.prototype.hasOwnProperty.call(rowIndexByKey, keyVal)) {
      var targetIdx = rowIndexByKey[keyVal];
      if (targetIdx >= existingValues.length) continue;
      var targetRow = existingValues[targetIdx];
      var rowChanged = false;
      for (var c = 0; c < headers.length; c++) {
        var h = headers[c];
        if (!Object.prototype.hasOwnProperty.call(rec, h)) continue;
        var nextVal = rec[h] !== undefined && rec[h] !== null ? rec[h] : '';
        if (ignoreDiff && ignoreDiff[h]) continue;
        if (normalizeCellForDiff_(targetRow[c], h, ssTz) !== String(nextVal)) {
          rowChanged = true;
          break;
        }
      }
      if (!rowChanged) continue;

      for (var uc = 0; uc < headers.length; uc++) {
        var uh = headers[uc];
        if (Object.prototype.hasOwnProperty.call(rec, uh)) {
          targetRow[uc] = rec[uh] !== undefined && rec[uh] !== null ? rec[uh] : '';
        }
      }
      dirtyIndices.push(targetIdx);
      updatedCount++;
    } else {
      rowIndexByKey[keyVal] = existingValues.length + insertedRows.length;
      insertedRows.push(recordToRowArray(headers, rec));
    }
  }

  if (dirtyIndices.length > 0 && existingValues.length > 0) {
    writeDirtyRowSpans_(sheet, headers.length, existingValues, dirtyIndices);
  }
  if (insertedRows.length > 0) {
    var appendStart = existingValues.length + 2;
    applyTextFormatForDateColumns_(sheet, headers, appendStart, insertedRows.length);
    sheet.getRange(appendStart, 1, insertedRows.length, headers.length).setValues(insertedRows);
  }

  if (dirtyIndices.length > 0 || insertedRows.length > 0) {
    invalidateCache(sheetName);
  }
  return {
    inserted: insertedRows.length,
    updated: updatedCount
  };
}

function safeDeleteSheetRows_(sheet, startRow, numRows) {
  if (!sheet || !numRows || numRows <= 0) return;
  var frozen = typeof sheet.getFrozenRows === 'function' ? Number(sheet.getFrozenRows() || 0) : 1;
  var maxRows = typeof sheet.getMaxRows === 'function' ? Number(sheet.getMaxRows() || 0) : Number(sheet.getLastRow() || 0);
  var lastRow = Number(sheet.getLastRow() || 0);
  var colCount = Math.max(1, Number(sheet.getLastColumn() || 1));
  if (maxRows <= 0) maxRows = Math.max(lastRow, startRow + numRows - 1);

  if (maxRows - numRows <= frozen) {
    var minKeepRow = frozen + 1;
    var clearStart = Math.max(minKeepRow, startRow);
    var clearCount = Math.min(numRows, Math.max(0, lastRow - clearStart + 1));
    if (clearCount > 0) {
      sheet.getRange(clearStart, 1, clearCount, colCount).clearContent().clearNote();
    }
    var extraToDelete = Math.max(0, maxRows - frozen - 1);
    if (extraToDelete > 0) {
      var delStart = Math.max(minKeepRow + 1, startRow);
      var delCount = Math.min(extraToDelete, Math.max(0, maxRows - delStart + 1));
      if (delCount > 0) {
        sheet.deleteRows(delStart, delCount);
      }
    }
    return;
  }

  if (numRows === 1 && typeof sheet.deleteRow === 'function') {
    sheet.deleteRow(startRow);
  } else {
    sheet.deleteRows(startRow, numRows);
  }
}

function deleteRecordByKey(sheetName, keyField, keyValue) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var headers = getEffectiveHeaders(sheet, sheetName);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var keyValues = sheet.getRange(2, keyIndex + 1, lastRow - 1, 1).getValues();
  var target = normalizeStr(keyValue);

  for (var r = keyValues.length - 1; r >= 0; r--) {
    if (normalizeStr(keyValues[r][0]) === target) {
      safeDeleteSheetRows_(sheet, r + 2, 1);
      if (Array.isArray(_rgRecordsCache[sheetName])) {
        _rgRecordsCache[sheetName] = _rgRecordsCache[sheetName].filter(function (rec) {
          return normalizeStr(rec[keyField]) !== target;
        });
        if (RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) _rgDirtyCacheSheets[sheetName] = true;
        invalidateCache(sheetName, true);
      } else {
        invalidateCache(sheetName, false);
      }
      return true;
    }
  }
  return false;
}

function clearSheetRecords(sheetName) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrCreate(ss, sheetName);
  var lastRow = sheet.getLastRow();
  var removedCount = Math.max(0, lastRow - 1);
  if (lastRow > 1) {
    var colCount = Math.max(1, sheet.getLastColumn());
    sheet.getRange(2, 1, lastRow - 1, colCount).clearContent().clearNote();
    var frozen = typeof sheet.getFrozenRows === 'function' ? Number(sheet.getFrozenRows() || 0) : 1;
    var keepDataRow = Math.max(2, frozen + 1);
    if (lastRow > keepDataRow) {
      safeDeleteSheetRows_(sheet, keepDataRow + 1, lastRow - keepDataRow);
    }
  }
  if (Array.isArray(_rgRecordsCache[sheetName])) {
    _rgRecordsCache[sheetName] = [];
  }
  if (RG_HOT_PERSIST_CACHE_SHEETS[sheetName]) {
    _rgDirtyCacheSheets[sheetName] = true;
  }
  invalidateCache(sheetName, true);
  return removedCount;
}
