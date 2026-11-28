/**
 * RENTAL GATE CRM — Incremental Cloud Sync to Neon PostgreSQL & Sheets Mirror Write-Back
 * Keeps Google Sheets 100% functional as backup/reporting while streaming changes incrementally to Neon.
 */

var NEON_HASH_PROP_PREFIX = 'NEON_HASH_CHUNK_';
var NEON_BATCH_SIZE = 150;

function sanitizeNeonSecret_(val) {
  var clean = String(val === null || val === undefined ? '' : val)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\r\n]+/g, '')
    .trim();
  while (clean.length >= 2) {
    var first = clean.charAt(0);
    var last = clean.charAt(clean.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      clean = normalizeStr(clean.substring(1, clean.length - 1));
    } else {
      break;
    }
  }
  return clean;
}

function normalizeNeonBearer_(val) {
  var clean = sanitizeNeonSecret_(val).replace(/^(?:Bearer\s+)+/i, '');
  return sanitizeNeonSecret_(clean);
}

function getNeonSyncConfig_() {
  var props = PropertiesService.getScriptProperties();
  var rawSecret = props.getProperty('SYNC_API_SECRET');
  return {
    syncUrl: sanitizeNeonSecret_(props.getProperty('NEON_SYNC_URL')),
    syncSecret: sanitizeNeonSecret_(rawSecret),
    rawSyncSecret: rawSecret === null || rawSecret === undefined ? '' : String(rawSecret)
  };
}

function setNeonSyncProperties(syncUrl, syncSecret) {
  var props = PropertiesService.getScriptProperties();
  var next = {};
  if (syncUrl !== undefined && syncUrl !== null) next.NEON_SYNC_URL = sanitizeNeonSecret_(syncUrl);
  if (syncSecret !== undefined && syncSecret !== null) next.SYNC_API_SECRET = sanitizeNeonSecret_(syncSecret);
  props.setProperties(next);
  return {
    configured: Boolean(sanitizeNeonSecret_(props.getProperty('NEON_SYNC_URL')) && sanitizeNeonSecret_(props.getProperty('SYNC_API_SECRET'))),
    syncUrl: sanitizeNeonSecret_(props.getProperty('NEON_SYNC_URL'))
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
    var rKey = 'R:' + normalizeStr(r.sourceReservationId || r.reservationNumber || r.id);
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

  var hasMetaGaps = Boolean(
    meta && (
      (Array.isArray(meta.incompleteEndpoints) && meta.incompleteEndpoints.length > 0) ||
      (Array.isArray(meta.backfillFailedIds) && meta.backfillFailedIds.length > 0)
    )
  );

  if (deltaRes.length === 0 && deltaExt.length === 0 && !hasMetaGaps) {
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
  var totalChunks = Math.max(1, Math.ceil(deltaRes.length / NEON_BATCH_SIZE));

  function buildMetaFields_(isFinalChunk) {
    if (!isFinalChunk) return {};
    return {
      totalInSource: (meta && meta.totalInSource !== undefined) ? meta.totalInSource : undefined,
      incompleteEndpoints: (meta && meta.incompleteEndpoints) || [],
      backfillFailedIds: (meta && meta.backfillFailedIds) || [],
      sourceBreakdown: (meta && meta.sourceBreakdown) || undefined,
      excludedFilteredCount: (meta && meta.excludedFilteredCount !== undefined) ? meta.excludedFilteredCount : 0,
      rangeFilteredCount: (meta && meta.rangeFilteredCount !== undefined) ? meta.rangeFilteredCount : 0,
      excludedSourceIds: (meta && meta.excludedSourceIds) || [],
      expectedSourceIds: (meta && meta.expectedSourceIds) || []
    };
  }

  for (var resOff = 0; resOff < deltaRes.length; resOff += NEON_BATCH_SIZE) {
    var resChunk = deltaRes.slice(resOff, resOff + NEON_BATCH_SIZE);
    if (resChunk.length === 0) continue;
    var isLastResChunk = (resOff + NEON_BATCH_SIZE >= deltaRes.length);
    var pairedExtChunk = (isLastResChunk && deltaExt.length <= NEON_BATCH_SIZE)
      ? deltaExt
      : [];
    var isTrulyFinal = isLastResChunk && (pairedExtChunk.length === deltaExt.length);

    fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, Object.assign({
      source: 'google_apps_script',
      triggeredById: (meta && meta.triggeredById) || 'GAS_SYNC',
      triggeredByName: (meta && meta.triggeredByName) || 'Google Apps Script Incremental Sync',
      pagesFetched: (meta && meta.pagesFetched) || 0,
      appliedRange: (meta && meta.appliedRange) || null,
      reservations: resChunk,
      extensions: pairedExtChunk
    }, buildMetaFields_(isTrulyFinal)));

    totalSentRes += resChunk.length;
    totalSentExt += pairedExtChunk.length;
  }

  for (var extOff = totalSentExt; extOff < deltaExt.length; extOff += NEON_BATCH_SIZE) {
    var extChunk = deltaExt.slice(extOff, extOff + NEON_BATCH_SIZE);
    if (extChunk.length === 0) continue;
    var isLastExtChunk = (extOff + NEON_BATCH_SIZE >= deltaExt.length);

    fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, Object.assign({
      source: 'google_apps_script',
      triggeredById: (meta && meta.triggeredById) || 'GAS_SYNC',
      triggeredByName: (meta && meta.triggeredByName) || 'Google Apps Script Incremental Sync',
      pagesFetched: (meta && meta.pagesFetched) || 0,
      appliedRange: (meta && meta.appliedRange) || null,
      reservations: [],
      extensions: extChunk
    }, buildMetaFields_(isLastExtChunk)));

    totalSentExt += extChunk.length;
  }

  if (deltaRes.length === 0 && deltaExt.length === 0 && hasMetaGaps) {
    fetchNeonEndpointWithRetry_(cfg.syncUrl, cfg.syncSecret, Object.assign({
      source: 'google_apps_script',
      triggeredById: (meta && meta.triggeredById) || 'GAS_SYNC',
      triggeredByName: (meta && meta.triggeredByName) || 'Google Apps Script Incremental Sync',
      pagesFetched: (meta && meta.pagesFetched) || 0,
      appliedRange: (meta && meta.appliedRange) || null,
      reservations: [],
      extensions: []
    }, buildMetaFields_(true)));
  }

  saveNeonHashMap_(hashMap);
  PropertiesService.getScriptProperties().setProperties({
    NEON_LAST_SYNC_AT: nowIso(),
    NEON_LAST_SYNC_STATUS: hasMetaGaps ? 'partial' : 'success',
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

function buildSafeMirrorAuthDiagnostics_(rawProvided, cfg, reqMeta, matched) {
  var rawScript = cfg && cfg.rawSyncSecret ? String(cfg.rawSyncSecret) : '';
  var cleanScript = cfg && cfg.syncSecret ? String(cfg.syncSecret) : '';
  var rawProvStr = rawProvided === null || rawProvided === undefined ? '' : String(rawProvided);
  var cleanProv = sanitizeNeonSecret_(rawProvStr);
  var trimmedRawScript = rawScript.replace(/[\r\n]+/g, '').trim();
  var trimmedRawProv = rawProvStr.replace(/[\r\n]+/g, '').trim();

  return {
    hasScriptSecret: Boolean(cleanScript),
    scriptSecretLength: cleanScript.length,
    rawScriptSecretLength: rawScript.length,
    scriptSecretHadWhitespace: Boolean(rawScript && (rawScript !== rawScript.trim() || /[\r\n\t]|\s/.test(trimmedRawScript))),
    scriptSecretHadQuotes: Boolean(trimmedRawScript.length >= 2 && ((trimmedRawScript.charAt(0) === '"' && trimmedRawScript.charAt(trimmedRawScript.length - 1) === '"') || (trimmedRawScript.charAt(0) === "'" && trimmedRawScript.charAt(trimmedRawScript.length - 1) === "'"))),
    scriptSecretHadInvisibleChars: /[\u200B-\u200D\uFEFF\u00A0]/.test(rawScript),
    providedPresent: Boolean(cleanProv),
    providedLength: cleanProv.length,
    providedHadWhitespace: Boolean(rawProvStr && (rawProvStr !== rawProvStr.trim() || /[\r\n\t]|\s/.test(trimmedRawProv))),
    providedHadQuotes: Boolean(trimmedRawProv.length >= 2 && ((trimmedRawProv.charAt(0) === '"' && trimmedRawProv.charAt(trimmedRawProv.length - 1) === '"') || (trimmedRawProv.charAt(0) === "'" && trimmedRawProv.charAt(trimmedRawProv.length - 1) === "'"))),
    providedHadInvisibleChars: /[\u200B-\u200D\uFEFF\u00A0]/.test(rawProvStr),
    secretMatch: Boolean(matched),
    receivedVia: (reqMeta && reqMeta.receivedVia) || (cleanProv ? 'payload.syncSecret' : 'none'),
    parsedPostBody: Boolean(reqMeta && reqMeta.parsedPostBody),
    requestMethod: (reqMeta && reqMeta.requestMethod) || 'POST',
    correlationId: (reqMeta && reqMeta.correlationId) || '',
    authSource: 'ScriptProperties.SYNC_API_SECRET',
    gasScriptVersion: '2026-11-28-sync-repair-v4'
  };
}

function logMirrorAuthAudit_(matched, reqMeta, providedLen) {
  try {
    var cid = (reqMeta && reqMeta.correlationId) || '';
    var via = (reqMeta && reqMeta.receivedVia) || 'none';
    Logger.log('[RG_MIRROR_AUTH] match=' + Boolean(matched) + ' via=' + via + ' len=' + Number(providedLen || 0) + (cid ? (' cid=' + cid) : ''));
  } catch (e) {}
}

function throwUnauthorizedMirrorError_(rawProvided, cfg, reqMeta) {
  var err = new Error('UNAUTHORIZED: SYNC_API_SECRET غير صالح.');
  err.safeData = {
    verified: false,
    authValid: false,
    diagnostics: buildSafeMirrorAuthDiagnostics_(rawProvided, cfg, reqMeta, false)
  };
  throw err;
}

function verifyNeonMirrorSecret_(payload, reqMeta) {
  var cfg = getNeonSyncConfig_();
  var rawProvided = payload && payload.syncSecret;
  var provided = sanitizeNeonSecret_(rawProvided);
  if (!cfg.syncSecret || !constantTimeEqual_(provided, cfg.syncSecret)) {
    logMirrorAuthAudit_(false, reqMeta, provided.length);
    throwUnauthorizedMirrorError_(rawProvided, cfg, reqMeta);
  }
  logMirrorAuthAudit_(true, reqMeta, provided.length);
  return {
    cfg: cfg,
    rawProvided: rawProvided,
    provided: provided
  };
}

function handleVerifyMirrorAuth_(payload, reqMeta) {
  var authCtx = verifyNeonMirrorSecret_(payload, reqMeta);
  var safeDiag = buildSafeMirrorAuthDiagnostics_(authCtx.rawProvided, authCtx.cfg, reqMeta, true);
  return {
    verified: true,
    authValid: true,
    configured: Boolean(authCtx.cfg.syncSecret),
    protectedMode: true,
    gasTimestamp: nowIso(),
    diagnostics: safeDiag
  };
}

function handleVerifyFrozenRowsProtection_(payload, reqMeta) {
  verifyNeonMirrorSecret_(payload, reqMeta);
  var runProbe_ = function () {
    var ss = getSpreadsheet();
    var targetSheetNames = [
      RG_SHEETS.RESERVATIONS,
      RG_SHEETS.FOLLOWUPS,
      RG_SHEETS.SETTINGS,
      RG_SHEETS.EMPLOYEES,
      RG_SHEETS.PROBLEMS
    ];
    var sheetChecks = [];
    var allProtected = true;

    for (var i = 0; i < targetSheetNames.length; i++) {
      var sName = targetSheetNames[i];
      if (!sName) continue;
      var sheet = getSheetOrCreate(ss, sName);
      var frozenRows = typeof sheet.getFrozenRows === 'function' ? Number(sheet.getFrozenRows() || 0) : 1;
      var maxRows = typeof sheet.getMaxRows === 'function' ? Number(sheet.getMaxRows() || 2) : 2;
      var firstDataRow = getSheetFirstDataRow_(sheet);
      if (frozenRows < 1 && maxRows >= 2 && typeof sheet.setFrozenRows === 'function') {
        sheet.setFrozenRows(1);
        frozenRows = Number(sheet.getFrozenRows() || 1);
      }
      ensureSheetCapacity_(sheet, firstDataRow, (RG_SHEETS_SCHEMA[sName] || []).length || 1);
      var hasHeader = Number(sheet.getLastColumn() || 0) > 0 && Number(sheet.getLastRow() || 0) >= 1;
      var sheetOk = Boolean(frozenRows >= 1 && maxRows >= firstDataRow && hasHeader);
      if (!sheetOk) allProtected = false;
      sheetChecks.push({
        sheetName: sName,
        frozenRows: frozenRows,
        firstDataRow: firstDataRow,
        maxRows: typeof sheet.getMaxRows === 'function' ? Number(sheet.getMaxRows() || maxRows) : maxRows,
        hasFilter: Boolean(typeof sheet.getFilter === 'function' && sheet.getFilter()),
        hasHeader: hasHeader,
        ok: sheetOk
      });
    }

    // Live non-destructive write + clearContent/compaction roundtrip test on Settings probe key
    var probeKey = '__frozen_rows_probe_temp';
    var probeStamp = nowIso();
    var writeRes = batchUpsertRecords(RG_SHEETS.SETTINGS, 'key', [
      { key: probeKey, value: probeStamp, updatedBy: 'FrozenRowsProtectionTest', updatedAt: probeStamp }
    ]);
    var delOk = deleteRecordByKey(RG_SHEETS.SETTINGS, 'key', probeKey);
    var settingsSheet = getSheetOrCreate(ss, RG_SHEETS.SETTINGS);
    var settingsFrozenAfter = typeof settingsSheet.getFrozenRows === 'function' ? Number(settingsSheet.getFrozenRows() || 1) : 1;
    var settingsHeaderAfter = Number(settingsSheet.getLastRow() || 0) >= 1;
    var actualTestPassed = Boolean(
      allProtected &&
      (writeRes.inserted + writeRes.updated) >= 1 &&
      delOk &&
      settingsFrozenAfter >= 1 &&
      settingsHeaderAfter
    );

    return {
      ok: actualTestPassed,
      protectedMode: actualTestPassed,
      actualFrozenRowsTestPassed: actualTestPassed,
      deleteRowCallsBlocked: true,
      clearContentOnly: true,
      probeWriteCount: (writeRes.inserted || 0) + (writeRes.updated || 0),
      probeCleanupOk: Boolean(delOk),
      sheets: sheetChecks,
      checkedAt: nowIso(),
      correlationId: (reqMeta && reqMeta.correlationId) || '',
      gasScriptVersion: '2026-11-28-sync-repair-v4'
    };
  };
  return (typeof withScriptLock === 'function') ? withScriptLock(runProbe_) : runProbe_();
}

function handleTriggerNeonIncrementalSync_(payload, reqMeta) {
  verifyNeonMirrorSecret_(payload, reqMeta);
  var actor = (payload && payload.actor) || {
    id: 'SYSTEM_NEON',
    name: 'مزامنة بناءً على طلب السيرفر السحابي',
    role: 'system'
  };
  return runRentalGateSyncInternal(actor, payload || {});
}

function getMirrorIdempotencyCache_() {
  try {
    return CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

function loadMirrorReceiptStore_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('NEON_OBX_RECEIPTS_V1');
    if (raw) {
      var parsed = safeJsonParse(raw, null);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}
  return {};
}

function saveMirrorReceiptStore_(store) {
  try {
    var keys = Object.keys(store || {});
    if (keys.length > 260) {
      var trimmed = {};
      for (var i = keys.length - 220; i < keys.length; i++) {
        trimmed[keys[i]] = store[keys[i]];
      }
      store = trimmed;
    }
    PropertiesService.getScriptProperties().setProperty('NEON_OBX_RECEIPTS_V1', JSON.stringify(store));
  } catch (e) {}
}

function isMirrorIdempotencySeen_(cache, key, receiptStore) {
  var k = normalizeStr(key);
  if (!k) return false;
  if (receiptStore && Object.prototype.hasOwnProperty.call(receiptStore, k)) {
    return true;
  }
  if (!cache) return false;
  try {
    return Boolean(cache.get('NEON_OBX_IDEMP_' + k));
  } catch (e) {
    return false;
  }
}

function markMirrorIdempotencySeen_(cache, entries, receiptStore) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  var store = receiptStore || loadMirrorReceiptStore_();
  var nowStamp = nowIso();
  var cacheMap = {};
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var k = normalizeStr(typeof ent === 'string' ? ent : (ent && ent.key));
    if (!k) continue;
    cacheMap['NEON_OBX_IDEMP_' + k] = '1';
    store[k] = {
      ok: true,
      appliedAt: nowStamp,
      action: (ent && ent.action) || '',
      entityId: (ent && ent.entityId) || '',
      correlationId: (ent && ent.correlationId) || ''
    };
  }
  saveMirrorReceiptStore_(store);
  if (!cache) return;
  try {
    if (Object.keys(cacheMap).length > 0 && typeof cache.putAll === 'function') {
      cache.putAll(cacheMap, 21600);
    } else {
      for (var mk in cacheMap) {
        if (Object.prototype.hasOwnProperty.call(cacheMap, mk)) cache.put(mk, '1', 21600);
      }
    }
  } catch (e) {}
}

function handleVerifyOutboxReceipt_(payload, reqMeta) {
  verifyNeonMirrorSecret_(payload, reqMeta);
  var keys = Array.isArray(payload && payload.idempotencyKeys) ? payload.idempotencyKeys.slice() : [];
  if (payload && payload.idempotencyKey) keys.push(payload.idempotencyKey);
  if (Array.isArray(payload && payload.items)) {
    for (var j = 0; j < payload.items.length; j++) {
      var it = payload.items[j];
      var itKey = normalizeStr(it && (it.idempotencyKey || it.key));
      if (itKey) keys.push(itKey);
    }
  }
  var seenReq = {};
  var uniqKeys = [];
  for (var u = 0; u < keys.length; u++) {
    var uk = normalizeStr(keys[u]);
    if (uk && !seenReq[uk]) {
      seenReq[uk] = true;
      uniqKeys.push(uk);
    }
  }
  var cache = getMirrorIdempotencyCache_();
  var store = loadMirrorReceiptStore_();
  var receipts = {};
  var found = [];
  for (var i = 0; i < uniqKeys.length; i++) {
    var k = uniqKeys[i];
    if (Object.prototype.hasOwnProperty.call(store, k)) {
      receipts[k] = store[k];
      found.push(k);
    } else if (isMirrorIdempotencySeen_(cache, k, null)) {
      receipts[k] = { ok: true, appliedAt: '', cacheOnly: true };
      found.push(k);
    }
  }
  return {
    found: found,
    appliedKeys: found,
    receipts: receipts,
    checkedCount: uniqKeys.length,
    correlationId: (reqMeta && reqMeta.correlationId) || '',
    gasScriptVersion: '2026-11-28-sync-repair-v4'
  };
}

function handleNeonMirrorSync_(payload, reqMeta) {
  verifyNeonMirrorSecret_(payload, reqMeta);

  var runSyncLocked_ = function () {
    var items = Array.isArray(payload && payload.items) ? payload.items : [];
    var applied = 0;
    var skipped = 0;
    var deduplicated = 0;
    var errors = [];
    var failedItems = [];
    var results = [];
    var idempCache = getMirrorIdempotencyCache_();
    var receiptStore = loadMirrorReceiptStore_();
    var committedReceipts = [];
    var immediateAppliedReceipts = [];
    var reqCid = (reqMeta && reqMeta.correlationId) || '';

    var resBatch = [];
    var resMeta = [];
    var fuBatch = [];
    var fuMeta = [];
    var prbBatch = [];
    var prbMeta = [];
    var empBatch = [];
    var usrBatch = [];
    var empMeta = [];
    var setBatch = [];
    var setMeta = [];

    function recordResult_(item, idx, status, errMsg) {
      results.push({
        id: item && item.id ? item.id : '',
        index: idx,
        status: status,
        ok: status === 'applied' || status === 'deduplicated' || status === 'ok',
        ...(errMsg ? { error: errMsg } : {})
      });
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || typeof item !== 'object') continue;
      var action = normalizeStr(item.action);
      var data = item.payload || {};
      var idempKey = normalizeStr(item.idempotencyKey || '');
      var entityIdVal = normalizeStr(item.entityId || data.reservationNumber || data.id || data.key || '');

      if (action !== 'healthProbe' && idempKey && isMirrorIdempotencySeen_(idempCache, idempKey, receiptStore)) {
        deduplicated++;
        recordResult_(item, i, 'deduplicated', '');
        continue;
      }

      if (action === 'upsertReservation' && data.reservationNumber) {
        resBatch.push(Object.assign({}, data, {
          assignedEmployeeIds: JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
          assignedEmployeeNames: JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : []),
          statusHistory: JSON.stringify(Array.isArray(data.statusHistory) ? data.statusHistory : []),
          hasExtensions: data.hasExtensions ? 'true' : 'false',
          hasProblem: data.hasProblem ? 'true' : 'false'
        }));
        resMeta.push({ item: item, index: i, idempKey: idempKey, action: action, entityId: entityIdVal });
      } else if (action === 'appendFollowUp' && data.id) {
        fuBatch.push(data);
        fuMeta.push({ item: item, index: i, idempKey: idempKey, action: action, entityId: entityIdVal });
      } else if (action === 'upsertProblem' && data.id) {
        prbBatch.push(Object.assign({}, data, {
          assignedEmployeeIds: JSON.stringify(Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : []),
          assignedEmployeeNames: JSON.stringify(Array.isArray(data.assignedEmployeeNames) ? data.assignedEmployeeNames : [])
        }));
        prbMeta.push({ item: item, index: i, idempKey: idempKey, action: action, entityId: entityIdVal });
      } else if (action === 'deleteProblem' && data.id) {
        try {
          if (typeof deleteRecordsWhere_ === 'function') {
            deleteRecordsWhere_(RG_SHEETS.PROBLEM_UPDATES, function (u) { return u && u.problemId === data.id; });
          }
          if (typeof deleteRecordByKey === 'function') {
            deleteRecordByKey(RG_SHEETS.PROBLEMS, 'id', data.id);
            if (typeof getSheet === 'function' && getSheet(RG_SHEETS.ISSUES)) {
              deleteRecordByKey(RG_SHEETS.ISSUES, 'id', data.id);
            }
          }
          applied++;
          if (idempKey) immediateAppliedReceipts.push({ key: idempKey, action: action, entityId: entityIdVal, correlationId: reqCid });
          recordResult_(item, i, 'applied', '');
        } catch (delPrbErr) {
          var delPrbMsg = String(delPrbErr && delPrbErr.message ? delPrbErr.message : delPrbErr);
          errors.push(delPrbMsg);
          failedItems.push({ id: item.id || '', index: i, error: delPrbMsg });
          recordResult_(item, i, 'failed', delPrbMsg);
        }
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
        empMeta.push({ item: item, index: i, idempKey: idempKey, action: action, entityId: entityIdVal });
      } else if (action === 'deleteEmployee' && data.id) {
        try {
          if (typeof revokeEmployeeSessions === 'function') revokeEmployeeSessions(data.id);
          if (typeof deleteRecordByKey === 'function') {
            deleteRecordByKey(RG_SHEETS.EMPLOYEES, 'id', data.id);
            deleteRecordByKey(RG_SHEETS.USERS, 'id', data.id);
          }
          applied++;
          if (idempKey) immediateAppliedReceipts.push({ key: idempKey, action: action, entityId: entityIdVal, correlationId: reqCid });
          recordResult_(item, i, 'applied', '');
        } catch (delEmpErr) {
          var delEmpMsg = String(delEmpErr && delEmpErr.message ? delEmpErr.message : delEmpErr);
          errors.push(delEmpMsg);
          failedItems.push({ id: item.id || '', index: i, error: delEmpMsg });
          recordResult_(item, i, 'failed', delEmpMsg);
        }
      } else if (action === 'deleteAllReservations') {
        skipped++;
        var bulkMsg = 'BLOCKED_BULK_DELETE: deleteAllReservations is disabled for mirror sync to protect Google Sheets backup';
        errors.push(bulkMsg);
        failedItems.push({ id: item.id || '', index: i, error: bulkMsg });
        recordResult_(item, i, 'failed', bulkMsg);
      } else if (action === 'upsertSetting' && data.key) {
        setBatch.push({
          key: data.key,
          value: String(data.value),
          updatedBy: normalizeStr(data.updatedBy || 'NEON_MIRROR'),
          updatedAt: nowIso()
        });
        setMeta.push({ item: item, index: i, idempKey: idempKey, action: action, entityId: entityIdVal });
      } else if (action === 'healthProbe') {
        if (data.writeProbe) {
          setBatch.push({
            key: '__mirror_health_probe',
            value: normalizeStr(data.value || nowIso()),
            updatedBy: 'HealthCenterSafeProbe',
            updatedAt: nowIso()
          });
          setMeta.push({ item: item, index: i, idempKey: '', action: action, entityId: '__mirror_health_probe' });
        } else {
          applied++;
          recordResult_(item, i, 'applied', '');
        }
      } else if (action === 'deleteNotification') {
        var ntfDelAt = normalizeStr(data.deletedAt) || nowIso();
        var ntfDelBy = normalizeStr(data.deletedById || data.recipientEmployeeId);
        var ntfRole = normalizeStr(data.userRole);
        var isDelAllNtf = Boolean(data.deleteAll);
        var ntfPersonalIds = Array.isArray(data.deletedIds) ? data.deletedIds.map(function (x) { return normalizeStr(x); }).filter(Boolean) : [];
        var ntfSharedIds = Array.isArray(data.dismissedSharedIds) ? data.dismissedSharedIds.map(function (x) { return normalizeStr(x); }).filter(Boolean) : [];
        var ntfIdSingle = normalizeStr(data.id);
        var ntfPersonalMap = {};
        var ntfSharedMap = {};
        for (var ni = 0; ni < ntfPersonalIds.length; ni++) ntfPersonalMap[ntfPersonalIds[ni]] = true;
        for (var si = 0; si < ntfSharedIds.length; si++) ntfSharedMap[ntfSharedIds[si]] = true;
        if (typeof updateRecordsWhere_ === 'function') {
          updateRecordsWhere_(RG_SHEETS.NOTIFICATIONS, function (n) {
            if (!n || normalizeStr(n.deletedAt)) return false;
            var nid = normalizeStr(n.id);
            var recEmp = normalizeStr(n.recipientEmployeeId);
            var recRole = normalizeStr(n.recipientRole);
            if (recEmp) {
              if (ntfPersonalMap[nid] || (ntfIdSingle && nid === ntfIdSingle && (!ntfDelBy || recEmp === ntfDelBy))) return true;
              return Boolean(isDelAllNtf && ntfDelBy && recEmp === ntfDelBy);
            }
            if (ntfDelBy) {
              var curDismiss = {};
              try {
                curDismiss = typeof parseNotificationDismissals_ === 'function'
                  ? parseNotificationDismissals_(n.dismissedByJson)
                  : (n.dismissedByJson ? JSON.parse(String(n.dismissedByJson)) : {});
              } catch (_eParse) { curDismiss = {}; }
              if (curDismiss && curDismiss[ntfDelBy]) return false;
            }
            if (ntfSharedMap[nid] || (ntfIdSingle && nid === ntfIdSingle && ntfDelBy && (!ntfRole || recRole === ntfRole || recRole === 'all'))) {
              return true;
            }
            return Boolean(isDelAllNtf && ntfDelBy && (recRole === ntfRole || recRole === 'all'));
          }, function (n) {
            var recEmp = normalizeStr(n.recipientEmployeeId);
            if (recEmp) {
              return { deletedAt: ntfDelAt, deletedById: ntfDelBy };
            }
            var dMap = {};
            try {
              dMap = typeof parseNotificationDismissals_ === 'function'
                ? parseNotificationDismissals_(n.dismissedByJson)
                : (n.dismissedByJson ? JSON.parse(String(n.dismissedByJson)) : {});
            } catch (_eParse2) { dMap = {}; }
            if (!dMap || typeof dMap !== 'object') dMap = {};
            if (ntfDelBy) dMap[ntfDelBy] = ntfDelAt;
            return { dismissedByJson: JSON.stringify(dMap) };
          });
        }
        if (typeof bumpCacheVersion_ === 'function') bumpCacheVersion_('NTF');
        applied++;
        if (idempKey) immediateAppliedReceipts.push({ key: idempKey, action: action, entityId: entityIdVal, correlationId: reqCid });
        recordResult_(item, i, 'applied', '');
      } else if (action === 'saveRgToken' && data.rgToken) {
        var cleanTok = normalizeNeonBearer_(data.rgToken);
        if (cleanTok) {
          PropertiesService.getScriptProperties().setProperties({
            RG_TOKEN: cleanTok,
            RENTAL_TOKEN: cleanTok
          });
          applied++;
          if (idempKey) immediateAppliedReceipts.push({ key: idempKey, action: action, entityId: entityIdVal, correlationId: reqCid });
          recordResult_(item, i, 'applied', '');
        }
      } else {
        skipped++;
        var valErrMsg = 'VALIDATION_ERROR: unsupported or incomplete mirror item action "' + action + '"';
        errors.push(valErrMsg);
        failedItems.push({ id: item.id || '', index: i, error: valErrMsg });
        recordResult_(item, i, 'failed', valErrMsg);
      }
    }

    function flushBatchSafe_(sheetName, keyField, records, metaArr, extraFn) {
      if (!records || records.length === 0) return;
      try {
        batchUpsertRecords(sheetName, keyField, records);
        applied += records.length;
        for (var m = 0; m < metaArr.length; m++) {
          recordResult_(metaArr[m].item, metaArr[m].index, 'applied', '');
          if (metaArr[m].idempKey) {
            committedReceipts.push({
              key: metaArr[m].idempKey,
              action: metaArr[m].action || '',
              entityId: metaArr[m].entityId || '',
              correlationId: reqCid
            });
          }
        }
        if (typeof extraFn === 'function') extraFn();
      } catch (batchErr) {
        var bMsg = String(batchErr && batchErr.message ? batchErr.message : batchErr);
        errors.push(bMsg);
        for (var fm = 0; fm < metaArr.length; fm++) {
          failedItems.push({ id: metaArr[fm].item && metaArr[fm].item.id ? metaArr[fm].item.id : '', index: metaArr[fm].index, error: bMsg });
          recordResult_(metaArr[fm].item, metaArr[fm].index, 'failed', bMsg);
        }
      }
    }

    flushBatchSafe_(RG_SHEETS.RESERVATIONS, 'reservationNumber', resBatch, resMeta);
    flushBatchSafe_(RG_SHEETS.FOLLOWUPS, 'id', fuBatch, fuMeta);
    flushBatchSafe_(RG_SHEETS.PROBLEMS, 'id', prbBatch, prbMeta, function () {
      if (typeof getSheet === 'function' && getSheet(RG_SHEETS.ISSUES)) {
        batchUpsertRecords(RG_SHEETS.ISSUES, 'id', prbBatch);
      }
    });
    flushBatchSafe_(RG_SHEETS.EMPLOYEES, 'id', empBatch, empMeta, function () {
      batchUpsertRecords(RG_SHEETS.USERS, 'id', usrBatch);
    });
    flushBatchSafe_(RG_SHEETS.SETTINGS, 'key', setBatch, setMeta);

    var allReceiptsToPersist = immediateAppliedReceipts.concat(committedReceipts);
    if (allReceiptsToPersist.length > 0) {
      markMirrorIdempotencySeen_(idempCache, allReceiptsToPersist, receiptStore);
    }

    var receiptKeys = [];
    for (var rk = 0; rk < allReceiptsToPersist.length; rk++) {
      if (allReceiptsToPersist[rk] && allReceiptsToPersist[rk].key) {
        receiptKeys.push(allReceiptsToPersist[rk].key);
      }
    }

    return {
      applied: applied,
      skipped: skipped,
      deduplicated: deduplicated,
      errors: errors,
      failedItems: failedItems,
      results: results,
      receipts: receiptKeys,
      receiptCount: allReceiptsToPersist.length,
      lastReceiptAt: allReceiptsToPersist.length > 0 ? nowIso() : '',
      protectedMode: true,
      frozenRowsProtected: true,
      receivedVia: (reqMeta && reqMeta.receivedVia) || 'payload.syncSecret',
      correlationId: reqCid,
      gasScriptVersion: '2026-11-28-sync-repair-v4'
    };
  };

  return (typeof withScriptLock === 'function') ? withScriptLock(runSyncLocked_) : runSyncLocked_();
}

function handleAutoBindFromServer_(payload) {
  var p = payload || {};
  var props = PropertiesService.getScriptProperties();
  var cfg = getNeonSyncConfig_();
  var existingRgToken = normalizeNeonBearer_(props.getProperty('RG_TOKEN') || props.getProperty('RENTAL_TOKEN'));

  var providedSecret = sanitizeNeonSecret_(p.syncSecret);
  var providedRgToken = normalizeNeonBearer_(p.rgToken);
  var neonSyncUrl = sanitizeNeonSecret_(p.neonSyncUrl);

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

