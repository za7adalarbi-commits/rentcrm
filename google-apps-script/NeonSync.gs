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
    var props = PropertiesService.getScriptProperties();
    var chunkCount = Number(props.getProperty('NEON_HASH_CHUNK_COUNT') || 0);
    if (chunkCount > 0) {
      var joined = '';
      for (var c = 0; c < chunkCount; c++) {
        var part = props.getProperty(NEON_HASH_PROP_PREFIX + c);
        if (!part) {
          joined = '';
          break;
        }
        joined += part;
      }
      if (joined) {
        var fromChunks = safeJsonParse(joined, null);
        if (fromChunks && typeof fromChunks === 'object') return fromChunks;
      }
    }
    var raw = props.getProperty('NEON_INC_HASHES_V1');
    if (raw) {
      var fromProps = safeJsonParse(raw, null);
      if (fromProps && typeof fromProps === 'object') return fromProps;
    }
  } catch (e2) {}
  return {};
}

function saveNeonHashMap_(hashMap) {
  // Keep latest ~3000 entries safely under CacheService 100KB & chunked PropertiesService (8KB per prop)
  var keys = Object.keys(hashMap || {});
  if (keys.length > 3000) {
    var trimmed = {};
    var start = keys.length - 2500;
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
    var props = PropertiesService.getScriptProperties();
    var chunkSize = 8000;
    var maxChunks = 25;
    if (json.length <= chunkSize * maxChunks) {
      var prevCount = Number(props.getProperty('NEON_HASH_CHUNK_COUNT') || 0);
      var totalChunks = Math.ceil(json.length / chunkSize) || 1;
      var nextProps = { NEON_HASH_CHUNK_COUNT: String(totalChunks) };
      for (var c = 0; c < totalChunks; c++) {
        nextProps[NEON_HASH_PROP_PREFIX + c] = json.substring(c * chunkSize, (c + 1) * chunkSize);
      }
      props.setProperties(nextProps);
      for (var oldIdx = totalChunks; oldIdx < prevCount; oldIdx++) {
        props.deleteProperty(NEON_HASH_PROP_PREFIX + oldIdx);
      }
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
    var extChunk = deltaExt.slice(offset, offset + NEON_BATCH_SIZE);
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

    var props = PropertiesService.getScriptProperties();
    var lastFullAt = Number(props.getProperty('NEON_LAST_FULL_SYNC_MS') || 0);
    var shouldFullSync = !lastFullAt || (Date.now() - lastFullAt) >= 600000;
    var rangeOpts = shouldFullSync
      ? { preset: 'all', datePreset: 'all' }
      : { preset: '7d', datePreset: '7d' };

    var syncMeta = runRentalGateSyncInternal(
      {
        id: 'SYSTEM_1M',
        employeeId: 'SYSTEM_1M',
        name: 'المزامنة السحابية الدقيقة (Neon)',
        role: 'system'
      },
      rangeOpts
    );

    if (shouldFullSync) {
      props.setProperty('NEON_LAST_FULL_SYNC_MS', String(Date.now()));
    }

    // If no incremental delta was pushed to Neon (so Neon didn't auto-flush outbox), trigger flushOutbox every ~3 mins
    if (syncMeta && syncMeta.neonSync && syncMeta.neonSync.noChanges) {
      var lastFlushAt = Number(props.getProperty('NEON_LAST_FLUSH_MS') || 0);
      if (!lastFlushAt || (Date.now() - lastFlushAt) >= 180000) {
        var cfg = getNeonSyncConfig_();
        if (cfg.syncUrl && cfg.syncSecret) {
          props.setProperty('NEON_LAST_FLUSH_MS', String(Date.now()));
          try {
            fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, { action: 'flushOutbox' });
          } catch (flushErr) {
            Logger.log('Neon flushOutbox warning: ' + (flushErr && flushErr.message ? flushErr.message : flushErr));
          }
        }
      }
    }
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

function handleNeonMirrorSync_(payload) {
  var cfg = getNeonSyncConfig_();
  var provided = normalizeStr(payload && payload.syncSecret);
  if (!cfg.syncSecret || !constantTimeEqual_(provided, cfg.syncSecret)) {
    throw new Error('UNAUTHORIZED: SYNC_API_SECRET غير صالح.');
  }

  var items = Array.isArray(payload && payload.items) ? payload.items : [];
  var applied = 0;

  var resBatch = [];
  var fuBatch = [];
  var prbBatch = [];
  var empBatch = [];
  var usrBatch = [];
  var setBatch = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || typeof item !== 'object') continue;
    var action = normalizeStr(item.action);
    var data = item.payload || {};

    if (action === 'upsertReservation' && data.reservationNumber) {
      resBatch.push(Object.assign({}, data, {
        assignedEmployeeIds: JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
        assignedEmployeeNames: JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : []),
        statusHistory: JSON.stringify(Array.isArray(data.statusHistory) ? data.statusHistory : []),
        hasExtensions: data.hasExtensions ? 'true' : 'false',
        hasProblem: data.hasProblem ? 'true' : 'false'
      }));
    } else if (action === 'appendFollowUp' && data.id) {
      fuBatch.push(data);
    } else if (action === 'upsertProblem' && data.id) {
      prbBatch.push(Object.assign({}, data, {
        assignedEmployeeIds: JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
        assignedEmployeeNames: JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : [])
      }));
    } else if (action === 'upsertEmployee' && data.id) {
      var empRec = Object.assign({}, data, {
        permissions: JSON.stringify(Array.isArray(data.permissions) ? data.permissions : [])
      });
      empBatch.push(empRec);
      usrBatch.push({
        id: empRec.id,
        name: empRec.name,
        username: empRec.username,
        phone: empRec.phone,
        email: empRec.email,
        jobTitle: empRec.jobTitle,
        role: empRec.role,
        permissions: empRec.permissions,
        status: empRec.status,
        lastActivity: empRec.lastActivity,
        createdAt: empRec.createdAt,
        updatedAt: empRec.updatedAt
      });
    } else if (action === 'upsertSetting' && data.key) {
      setBatch.push({
        key: data.key,
        value: String(data.value),
        updatedBy: normalizeStr(data.updatedBy || 'NEON_MIRROR'),
        updatedAt: nowIso()
      });
    } else if (action === 'saveRgToken' && data.rgToken) {
      var cleanTok = normalizeStr(data.rgToken).replace(/^Bearer\s+/i, '');
      if (cleanTok) {
        PropertiesService.getScriptProperties().setProperties({
          RG_TOKEN: cleanTok,
          RENTAL_TOKEN: cleanTok
        });
        applied++;
      }
    }
  }

  if (resBatch.length > 0) {
    batchUpsertRecords(RG_SHEETS.RESERVATIONS, 'reservationNumber', resBatch);
    applied += resBatch.length;
  }
  if (fuBatch.length > 0) {
    batchUpsertRecords(RG_SHEETS.FOLLOWUPS, 'id', fuBatch);
    applied += fuBatch.length;
  }
  if (prbBatch.length > 0) {
    batchUpsertRecords(RG_SHEETS.PROBLEMS, 'id', prbBatch);
    if (typeof getSheet === 'function' && getSheet(RG_SHEETS.ISSUES)) {
      batchUpsertRecords(RG_SHEETS.ISSUES, 'id', prbBatch);
    }
    applied += prbBatch.length;
  }
  if (empBatch.length > 0) {
    batchUpsertRecords(RG_SHEETS.EMPLOYEES, 'id', empBatch);
    batchUpsertRecords(RG_SHEETS.USERS, 'id', usrBatch);
    applied += empBatch.length;
  }
  if (setBatch.length > 0) {
    batchUpsertRecords(RG_SHEETS.SETTINGS, 'key', setBatch);
    applied += setBatch.length;
  }

  return { applied: applied };
}

function handleAutoBindFromServer_(payload) {
  var p = payload || {};
  var props = PropertiesService.getScriptProperties();
  var cfg = getNeonSyncConfig_();
  var existingRgToken = normalizeStr(props.getProperty('RG_TOKEN') || props.getProperty('RENTAL_TOKEN')).replace(/^Bearer\s+/i, '');

  var providedSecret = normalizeStr(p.syncSecret);
  var providedRgToken = normalizeStr(p.rgToken).replace(/^Bearer\s+/i, '');
  var neonSyncUrl = normalizeStr(p.neonSyncUrl);

  var secretMatches = Boolean(cfg.syncSecret && providedSecret && constantTimeEqual_(providedSecret, cfg.syncSecret));
  var rgTokenMatches = Boolean(existingRgToken && providedRgToken && constantTimeEqual_(providedRgToken, existingRgToken));
  var isFreshUnbound = Boolean(!cfg.syncSecret && !cfg.syncUrl && !existingRgToken && providedSecret && (providedRgToken || neonSyncUrl));

  if (!secretMatches && !rgTokenMatches && !isFreshUnbound) {
    throw new Error('UNAUTHORIZED: تعذر التحقق من الصلاحية للربط التلقائي؛ تأكد من تطابق RG_TOKEN أو SYNC_API_SECRET في Script Properties.');
  }

  var nextProps = {};
  if (neonSyncUrl) nextProps.NEON_SYNC_URL = neonSyncUrl;
  if (providedSecret) nextProps.SYNC_API_SECRET = providedSecret;
  if (providedRgToken) {
    nextProps.RG_TOKEN = providedRgToken;
    nextProps.RENTAL_TOKEN = providedRgToken;
  }
  if (Object.keys(nextProps).length > 0) {
    props.setProperties(nextProps);
  }

  var triggerInfo = null;
  if (p.autoEveryMinute !== false && (neonSyncUrl || cfg.syncUrl)) {
    triggerInfo = setupNeonEveryMinuteSync(true);
  }

  return {
    bound: true,
    neonSyncUrl: normalizeStr(props.getProperty('NEON_SYNC_URL')),
    hasSyncSecret: Boolean(props.getProperty('SYNC_API_SECRET')),
    hasRgToken: Boolean(props.getProperty('RG_TOKEN')),
    trigger: triggerInfo
  };
}

