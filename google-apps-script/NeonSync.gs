/**
 * RENTAL GATE CRM — Incremental Cloud Sync to Neon PostgreSQL & Sheets Mirror Write-Back
 * Keeps Google Sheets 100% functional as backup/reporting while streaming changes incrementally to Neon.
 */

var NEON_HASH_PROP_PREFIX = 'NEON_HASH_CHUNK_';
var NEON_BATCH_SIZE = 150;

function getNeonSyncConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    syncUrl: normalizeStr(props.getProperty('NEON_SYNC_URL')),
    syncSecret: normalizeStr(props.getProperty('SYNC_API_SECRET'))
  };
}

function setNeonSyncProperties(syncUrl, syncSecret) {
  var props = PropertiesService.getScriptProperties();
  var next = {};
  if (syncUrl !== undefined && syncUrl !== null) next.NEON_SYNC_URL = normalizeStr(syncUrl);
  if (syncSecret !== undefined && syncSecret !== null) next.SYNC_API_SECRET = normalizeStr(syncSecret);
  props.setProperties(next);
  return {
    configured: Boolean(props.getProperty('NEON_SYNC_URL') && props.getProperty('SYNC_API_SECRET')),
    syncUrl: normalizeStr(props.getProperty('NEON_SYNC_URL'))
  };
}

function constantTimeEqual_(a, b) {
  var sA = String(a || '');
  var sB = String(b || '');
  if (!sA || !sB || sA.length !== sB.length) return false;
  var diff = 0;
  for (var i = 0; i < sA.length; i++) {
    diff |= sA.charCodeAt(i) ^ sB.charCodeAt(i);
  }
  return diff === 0;
}

function computeShortDigest_(obj) {
  var clone = {};
  var keys = Object.keys(obj || {}).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'updatedAt' || k === 'syncedAt' || k === 'rawJson') continue;
    clone[k] = obj[k];
  }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(clone), Utilities.Charset.UTF_8);
  var hex = '';
  for (var j = 0; j < 8; j++) {
    var v = (bytes[j] + 256) % 256;
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}

function loadNeonHashMap_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('NEON_INC_HASHES_V1');
    if (cached) {
      var parsed = safeJsonParse(cached, null);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}

  try {
    var raw = PropertiesService.getScriptProperties().getProperty('NEON_INC_HASHES_V1');
    if (raw) {
      var fromProps = safeJsonParse(raw, null);
      if (fromProps && typeof fromProps === 'object') return fromProps;
    }
  } catch (e2) {}
  return {};
}

function saveNeonHashMap_(hashMap) {
  // Keep latest ~3500 entries safely under CacheService 100KB / Properties limit
  var keys = Object.keys(hashMap || {});
  if (keys.length > 3500) {
    var trimmed = {};
    var start = keys.length - 3000;
    for (var i = start; i < keys.length; i++) {
      trimmed[keys[i]] = hashMap[keys[i]];
    }
    hashMap = trimmed;
  }
  var json = JSON.stringify(hashMap);
  try {
    CacheService.getScriptCache().put('NEON_INC_HASHES_V1', json, 21600);
  } catch (e) {}
  try {
    if (json.length < 450000) {
      PropertiesService.getScriptProperties().setProperty('NEON_INC_HASHES_V1', json);
    }
  } catch (e2) {}
}

function fetchNeonEndpointWithRetry_(url, secret, bodyObj) {
  var maxAttempts = 3;
  var lastErr = null;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-sync-secret': secret
        },
        payload: JSON.stringify(bodyObj),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var text = res.getContentText();
      var parsed = safeJsonParse(text, null);
      if (code >= 200 && code < 300 && parsed && parsed.success) {
        return parsed;
      }
      lastErr = new Error((parsed && parsed.message) || ('HTTP ' + code + ': ' + String(text).substring(0, 200)));
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxAttempts) {
      Utilities.sleep(attempt * 1200);
    }
  }
  throw lastErr || new Error('NEON_SYNC_FAILED');
}

function pushIncrementalSyncToNeon_(reservations, extensions, meta) {
  var cfg = getNeonSyncConfig_();
  if (!cfg.syncUrl || !cfg.syncSecret) {
    return { skipped: true, reason: 'NEON_NOT_CONFIGURED' };
  }

  var hashMap = loadNeonHashMap_();
  var deltaRes = [];
  var deltaExt = [];

  for (var i = 0; i < (reservations || []).length; i++) {
    var r = reservations[i];
    var rKey = 'R:' + normalizeStr(r.reservationNumber || r.id);
    if (!rKey || rKey === 'R:') continue;
    var rDigest = computeShortDigest_(r);
    if (hashMap[rKey] !== rDigest) {
      deltaRes.push(r);
      hashMap[rKey] = rDigest;
    }
  }

  for (var j = 0; j < (extensions || []).length; j++) {
    var e = extensions[j];
    var eKey = 'E:' + normalizeStr(e.extensionNumber || e.id);
    if (!eKey || eKey === 'E:') continue;
    var eDigest = computeShortDigest_(e);
    if (hashMap[eKey] !== eDigest) {
      deltaExt.push(e);
      hashMap[eKey] = eDigest;
    }
  }

  if (deltaRes.length === 0 && deltaExt.length === 0) {
    PropertiesService.getScriptProperties().setProperties({
      NEON_LAST_SYNC_AT: nowIso(),
      NEON_LAST_SYNC_STATUS: 'no_changes',
      NEON_LAST_SYNC_COUNT: '0',
      NEON_LAST_SYNC_ERROR: ''
    });
    return { skipped: false, sentReservations: 0, sentExtensions: 0, noChanges: true };
  }

  var totalSentRes = 0;
  var totalSentExt = 0;
  var maxLen = Math.max(deltaRes.length, deltaExt.length);

  for (var offset = 0; offset < maxLen; offset += NEON_BATCH_SIZE) {
    var resChunk = deltaRes.slice(offset, offset + NEON_BATCH_SIZE);
    var extChunk = deltaExt.slice(offset, offset + NEON_BATCH_SIZE * 2);
    if (resChunk.length === 0 && extChunk.length === 0) continue;

    fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, {
      source: 'google_apps_script',
      triggeredById: (meta && meta.triggeredById) || 'GAS_SYNC',
      triggeredByName: (meta && meta.triggeredByName) || 'Google Apps Script Incremental Sync',
      pagesFetched: (meta && meta.pagesFetched) || 0,
      appliedRange: (meta && meta.appliedRange) || null,
      reservations: resChunk,
      extensions: extChunk
    });

    totalSentRes += resChunk.length;
    totalSentExt += extChunk.length;
  }

  saveNeonHashMap_(hashMap);
  PropertiesService.getScriptProperties().setProperties({
    NEON_LAST_SYNC_AT: nowIso(),
    NEON_LAST_SYNC_STATUS: 'success',
    NEON_LAST_SYNC_COUNT: String(totalSentRes + totalSentExt),
    NEON_LAST_SYNC_ERROR: ''
  });

  return {
    skipped: false,
    sentReservations: totalSentRes,
    sentExtensions: totalSentExt
  };
}

function pushIncrementalSyncToNeonSafe_(reservations, extensions, meta) {
  try {
    return pushIncrementalSyncToNeon_(reservations, extensions, meta);
  } catch (err) {
    try {
      PropertiesService.getScriptProperties().setProperties({
        NEON_LAST_SYNC_AT: nowIso(),
        NEON_LAST_SYNC_STATUS: 'error',
        NEON_LAST_SYNC_ERROR: String(err && err.message ? err.message : err).substring(0, 400)
      });
    } catch (e2) {}
    Logger.log('Neon incremental sync warning: ' + (err && err.message ? err.message : err));
    return { skipped: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 1-minute incremental sync handler for Google Apps Script time-based triggers
 */
function scheduledMinuteSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    return;
  }
  try {
    var enabledRec = findRecordById(RG_SHEETS.SETTINGS, 'key', 'auto_sync_enabled');
    var enabled = enabledRec ? toBool(enabledRec.value) : true;
    if (!enabled) return;

    // 1) Ask Neon backend to flush any pending/retry outbox & scan updated_at > last_sync_at deltas
    var cfg = getNeonSyncConfig_();
    if (cfg.syncUrl && cfg.syncSecret) {
      try {
        fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, {
          action: 'deltaSync',
          pullRentalGate: false
        });
      } catch (deltaErr) {
        Logger.log('scheduledMinuteSync delta ping warning: ' + (deltaErr && deltaErr.message ? deltaErr.message : deltaErr));
      }
    }

    // 2) Pull recent 7 days incrementally from Rental Gate to stay fast within GAS execution quota
    runRentalGateSyncInternal(
      {
        id: 'SYSTEM_1M',
        employeeId: 'SYSTEM_1M',
        name: 'المزامنة السحابية الدقيقة (Neon)',
        role: 'system'
      },
      { datePreset: '7d' }
    );
  } catch (err) {
    Logger.log('scheduledMinuteSync error: ' + (err && err.message ? err.message : err));
  } finally {
    lock.releaseLock();
  }
}

function setupNeonEveryMinuteSync(enabled) {
  var shouldEnable = enabled !== false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledMinuteSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!shouldEnable) {
    return { enabled: false, intervalMinutes: 1 };
  }
  ScriptApp.newTrigger('scheduledMinuteSync').timeBased().everyMinutes(1).create();
  return { enabled: true, intervalMinutes: 1 };
}

function handleTriggerNeonIncrementalSync_(payload) {
  var cfg = getNeonSyncConfig_();
  var provided = normalizeStr(payload && payload.syncSecret);
  if (!cfg.syncSecret || !constantTimeEqual_(provided, cfg.syncSecret)) {
    throw new Error('UNAUTHORIZED: SYNC_API_SECRET غير صالح.');
  }
  var actor = (payload && payload.actor) || {
    id: 'SYSTEM_NEON',
    name: 'مزامنة بناءً على طلب السيرفر السحابي',
    role: 'system'
  };
  return runRentalGateSyncInternal(actor, payload || {});
}

function resolveGasOperation_(item) {
  var op = normalizeStr(item && item.operation).toUpperCase();
  if (op === 'INSERT' || op === 'UPDATE' || op === 'DELETE') return op;
  var act = normalizeStr(item && item.action).toLowerCase();
  if (act.indexOf('delete') !== -1 || act.indexOf('remove') !== -1) return 'DELETE';
  if (act.indexOf('create') !== -1 || act.indexOf('insert') !== -1 || act.indexOf('add') !== -1) return 'INSERT';
  return 'UPDATE';
}

function applySingleNeonSyncItem_(item, syncedAt) {
  var outboxId = normalizeStr((item && (item.outboxId || item.id)) || '');
  var entityType = normalizeStr(item && item.entityType);
  var operation = resolveGasOperation_(item);
  var action = normalizeStr(item && item.action);
  var data = (item && item.payload && typeof item.payload === 'object') ? item.payload : {};
  var recordId = normalizeStr((item && item.recordId) || (item && item.entityId) || data.id || data.reservationNumber || data.key || '');
  var idempKey = normalizeStr(item && item.idempotencyKey);

  if (idempKey) {
    try {
      var cache = CacheService.getScriptCache();
      var prev = cache.get('NEON_DEDUP_' + idempKey);
      if (prev) {
        return {
          success: true,
          outboxId: outboxId,
          entityType: entityType,
          operation: operation,
          recordId: recordId,
          syncedAt: syncedAt,
          deduplicated: true,
          error: null
        };
      }
    } catch (e) {}
  }

  try {
    var etLower = entityType.toLowerCase();

    if (etLower === 'customer' || action === 'upsertCustomer' || action === 'deleteCustomer') {
      var custKey = normalizeStr(data.id || recordId);
      if (!custKey) throw new Error('MISSING_CUSTOMER_ID');
      if (operation === 'DELETE' || action === 'deleteCustomer') {
        deleteRecordByKey(RG_SHEETS.CUSTOMERS, 'id', custKey);
      } else {
        upsertRecordByKey(RG_SHEETS.CUSTOMERS, 'id', custKey, {
          id: custKey,
          name: normalizeStr(data.name || 'عميل'),
          phone: normalizeStr(data.phone),
          email: normalizeStr(data.email),
          idNumber: normalizeStr(data.idNumber),
          companyName: normalizeStr(data.companyName),
          notes: normalizeStr(data.notes),
          status: normalizeStr(data.status || 'active'),
          createdAt: normalizeStr(data.createdAt) || syncedAt,
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        });
      }
    } else if (etLower === 'reservation' || action === 'upsertReservation' || action === 'deleteReservation') {
      var resNum = normalizeStr(data.reservationNumber || '');
      var resId = normalizeStr(data.id || recordId);
      if (!resNum && !resId) throw new Error('MISSING_RESERVATION_KEY');
      if (operation === 'DELETE' || action === 'deleteReservation') {
        if (resId) deleteRecordByKey(RG_SHEETS.RESERVATIONS, 'id', resId);
        if (resNum) deleteRecordByKey(RG_SHEETS.RESERVATIONS, 'reservationNumber', resNum);
      } else {
        var resKeyField = resNum ? 'reservationNumber' : 'id';
        var resKeyVal = resNum || resId;
        var resRec = Object.assign({}, data, {
          id: resId || resNum,
          reservationNumber: resNum || resId,
          assignedEmployeeIds: typeof data.assignedEmployeeIds === 'string'
            ? data.assignedEmployeeIds
            : JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
          assignedEmployeeNames: typeof data.assignedEmployeeNames === 'string'
            ? data.assignedEmployeeNames
            : JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : []),
          statusHistory: typeof data.statusHistory === 'string'
            ? data.statusHistory
            : JSON.stringify(Array.isArray(data.statusHistory) ? data.statusHistory : []),
          hasExtensions: data.hasExtensions ? 'true' : 'false',
          hasProblem: data.hasProblem ? 'true' : 'false',
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        });
        upsertRecordByKey(RG_SHEETS.RESERVATIONS, resKeyField, resKeyVal, resRec);
      }
    } else if (etLower === 'extension' || action === 'upsertExtension' || action === 'deleteExtension') {
      var extKey = normalizeStr(data.extensionNumber || data.id || recordId);
      if (!extKey) throw new Error('MISSING_EXTENSION_KEY');
      if (operation === 'DELETE') {
        deleteRecordByKey(RG_SHEETS.EXTENSIONS, data.extensionNumber ? 'extensionNumber' : 'id', extKey);
      } else {
        upsertRecordByKey(RG_SHEETS.EXTENSIONS, data.extensionNumber ? 'extensionNumber' : 'id', extKey, data);
      }
    } else if (etLower === 'followup' || etLower === 'follow_up' || action === 'appendFollowUp' || action === 'upsertFollowUp') {
      var fuId = normalizeStr(data.id || recordId);
      if (!fuId) throw new Error('MISSING_FOLLOWUP_ID');
      if (operation === 'DELETE') {
        deleteRecordByKey(RG_SHEETS.FOLLOWUPS, 'id', fuId);
      } else {
        upsertRecordByKey(RG_SHEETS.FOLLOWUPS, 'id', fuId, data);
      }
    } else if (etLower === 'followuphistory' || action === 'appendFollowUpHistory') {
      var fuhId = normalizeStr(data.id || recordId);
      if (fuhId) upsertRecordByKey(RG_SHEETS.FOLLOWUP_HISTORY, 'id', fuhId, data);
    } else if (etLower === 'assignment' || action === 'upsertAssignment' || action === 'deleteAssignment') {
      var asgId = normalizeStr(data.id || recordId);
      if (!asgId) throw new Error('MISSING_ASSIGNMENT_ID');
      if (operation === 'DELETE' || action === 'deleteAssignment') {
        deleteRecordByKey(RG_SHEETS.ASSIGNMENTS, 'id', asgId);
      } else {
        upsertRecordByKey(RG_SHEETS.ASSIGNMENTS, 'id', asgId, data);
      }
    } else if (etLower === 'problem' || etLower === 'issue' || action === 'upsertProblem') {
      var prbId = normalizeStr(data.id || recordId);
      if (!prbId) throw new Error('MISSING_PROBLEM_ID');
      if (operation === 'DELETE') {
        deleteRecordByKey(RG_SHEETS.PROBLEMS, 'id', prbId);
        deleteRecordByKey(RG_SHEETS.ISSUES, 'id', prbId);
      } else {
        var prbRec = Object.assign({}, data, {
          assignedEmployeeIds: typeof data.assignedEmployeeIds === 'string'
            ? data.assignedEmployeeIds
            : JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
          assignedEmployeeNames: typeof data.assignedEmployeeNames === 'string'
            ? data.assignedEmployeeNames
            : JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : []),
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        });
        upsertRecordByKey(RG_SHEETS.PROBLEMS, 'id', prbId, prbRec);
        syncIssueSheetRecord(prbRec);
      }
    } else if (etLower === 'problemupdate' || action === 'appendProblemUpdate') {
      var puId = normalizeStr(data.id || recordId);
      if (puId) upsertRecordByKey(RG_SHEETS.PROBLEM_UPDATES, 'id', puId, data);
    } else if (etLower === 'employee' || etLower === 'user' || action === 'upsertEmployee') {
      var empId = normalizeStr(data.id || recordId);
      if (!empId) throw new Error('MISSING_EMPLOYEE_ID');
      if (operation === 'DELETE') {
        deleteRecordByKey(RG_SHEETS.EMPLOYEES, 'id', empId);
        deleteRecordByKey(RG_SHEETS.USERS, 'id', empId);
      } else {
        var empRec = Object.assign({}, data, {
          permissions: typeof data.permissions === 'string'
            ? data.permissions
            : JSON.stringify(Array.isArray(data.permissions) ? data.permissions : []),
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        });
        upsertRecordByKey(RG_SHEETS.EMPLOYEES, 'id', empId, empRec);
        syncUserSheetRecord(empRec);
      }
    } else if (etLower === 'role' || action === 'upsertRolePreset' || action === 'deleteRolePreset') {
      var roleId = normalizeStr(data.id || recordId);
      if (!roleId) throw new Error('MISSING_ROLE_ID');
      if (operation === 'DELETE' || action === 'deleteRolePreset') {
        deleteRecordByKey(RG_SHEETS.ROLES, 'id', roleId);
      } else {
        var roleRec = Object.assign({}, data, {
          permissions: typeof data.permissions === 'string'
            ? data.permissions
            : JSON.stringify(Array.isArray(data.permissions) ? data.permissions : []),
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        });
        upsertRecordByKey(RG_SHEETS.ROLES, 'id', roleId, roleRec);
      }
    } else if (etLower === 'permission' || action === 'upsertPermission' || action === 'deletePermission') {
      var permKey = normalizeStr(data.key || data.id || recordId);
      if (!permKey) throw new Error('MISSING_PERMISSION_KEY');
      if (operation === 'DELETE' || action === 'deletePermission') {
        deleteRecordByKey(RG_SHEETS.PERMISSIONS, 'key', permKey);
      } else {
        upsertRecordByKey(RG_SHEETS.PERMISSIONS, 'key', permKey, Object.assign({}, data, {
          key: permKey,
          updatedAt: normalizeStr(data.updatedAt) || syncedAt
        }));
      }
    } else if (etLower === 'settings' || action === 'upsertSetting') {
      var setKey = normalizeStr(data.key || recordId);
      if (!setKey) throw new Error('MISSING_SETTING_KEY');
      if (operation === 'DELETE') {
        deleteRecordByKey(RG_SHEETS.SETTINGS, 'key', setKey);
      } else {
        upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', setKey, {
          key: setKey,
          value: data.value !== undefined ? String(data.value) : '',
          updatedBy: normalizeStr(data.updatedBy || 'NEON_MIRROR'),
          updatedAt: syncedAt
        });
      }
    } else if (etLower === 'rgtoken' || action === 'saveRgToken') {
      var cleanTok = normalizeStr(data.rgToken).replace(/^Bearer\s+/i, '');
      if (cleanTok) {
        PropertiesService.getScriptProperties().setProperties({
          RG_TOKEN: cleanTok,
          RENTAL_TOKEN: cleanTok
        });
      }
    } else {
      throw new Error('UNSUPPORTED_SYNC_TARGET: ' + (entityType || action));
    }

    if (idempKey) {
      try {
        CacheService.getScriptCache().put('NEON_DEDUP_' + idempKey, syncedAt, 21600);
      } catch (e2) {}
    }

    return {
      success: true,
      outboxId: outboxId,
      entityType: entityType,
      operation: operation,
      recordId: recordId,
      syncedAt: syncedAt,
      deduplicated: false,
      error: null
    };
  } catch (err) {
    return {
      success: false,
      outboxId: outboxId,
      entityType: entityType,
      operation: operation,
      recordId: recordId,
      syncedAt: syncedAt,
      deduplicated: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function handleNeonMirrorSync_(payload) {
  var cfg = getNeonSyncConfig_();
  var provided = normalizeStr(payload && payload.syncSecret);
  if (!cfg.syncSecret || !constantTimeEqual_(provided, cfg.syncSecret)) {
    throw new Error('UNAUTHORIZED: SYNC_API_SECRET غير صالح.');
  }

  var syncedAt = nowIso();
  var rawItems = Array.isArray(payload && payload.items)
    ? payload.items
    : ((payload && (payload.entityType || payload.action || payload.payload)) ? [payload] : []);

  return withScriptLock(function () {
    var results = [];
    var applied = 0;
    var failed = 0;
    var deduplicatedCount = 0;

    for (var i = 0; i < rawItems.length; i++) {
      var item = rawItems[i];
      if (!item || typeof item !== 'object') continue;
      var itemRes = applySingleNeonSyncItem_(item, syncedAt);
      results.push(itemRes);
      if (itemRes.success) {
        applied++;
        if (itemRes.deduplicated) deduplicatedCount++;
      } else {
        failed++;
      }
    }

    try {
      PropertiesService.getScriptProperties().setProperties({
        NEON_LAST_SYNC_AT: syncedAt,
        NEON_LAST_SYNC_STATUS: failed > 0 && applied === 0 ? 'error' : 'success',
        NEON_LAST_SYNC_COUNT: String(applied),
        NEON_LAST_SYNC_ERROR: failed > 0 ? String((results.filter(function (r) { return !r.success; })[0] || {}).error || '') : ''
      });
    } catch (propErr) {}

    var first = results.length > 0 ? results[0] : null;
    return {
      success: !(failed > 0 && applied === 0),
      operation: first ? first.operation : 'BATCH',
      recordId: first ? first.recordId : '',
      syncedAt: syncedAt,
      applied: applied,
      failed: failed,
      deduplicated: deduplicatedCount,
      error: failed > 0 && applied === 0 ? (first ? first.error : 'SYNC_BATCH_FAILED') : null,
      results: results
    };
  });
}

function handleRealtimeSync_(payload) {
  return handleNeonMirrorSync_(payload);
}
