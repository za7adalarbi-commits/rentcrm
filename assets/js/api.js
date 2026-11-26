/**
 * RENTAL GATE CRM — API Transport, Live Google Apps Script Client & Local Sandbox Engine
 */
(function (root) {
  'use strict';

  var STORAGE_GAS_URL = 'rg_crm_gas_url';
  var STORAGE_BACKEND_URL = 'rg_crm_backend_url';
  var STORAGE_TOKEN = 'rg_crm_session_token';
  var STORAGE_DB = 'rg_crm_sandbox_db_v1';
  var memoryStorage = {};

  function safeStorageGet(key) {
    try {
      return (localStorage.getItem(key) || '').trim();
    } catch (e) {
      return String(memoryStorage[key] || '').trim();
    }
  }

  function safeStorageSet(key, val) {
    var clean = String(val === null || val === undefined ? '' : val);
    try {
      if (clean) localStorage.setItem(key, clean);
      else localStorage.removeItem(key);
    } catch (e) {
      if (clean) memoryStorage[key] = clean;
      else delete memoryStorage[key];
    }
  }

  var SANDBOX_SENTINEL = '__SANDBOX__';
  var lastWarmUpUrl = '';
  var lastWarmUpAt = 0;
  var _cachedConnInfo = null;
  var detectedBackendUrl = '';
  var detectedBackendUnavailable = false;
  var detectedHtmlFallback = false;
  var detectedGasUrl = '';
  var detectedMode = '';
  var detectedBackendProxyAvailable = false;
  var detectedEnvGasConfigured = false;
  var detectedServerSyncMeta = null;
  var backendProbeDone = false;
  var backendProbePromise = null;
  var lastKnownNetworkOnline = true;
  var lastDispatchedRemoteVersion = '';

  function notifyNetworkState(online, reason, detail) {
    try {
      var nextOnline = Boolean(online);
      if (nextOnline !== lastKnownNetworkOnline) {
        lastKnownNetworkOnline = nextOnline;
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent('rg:networkstate', {
            detail: {
              online: nextOnline,
              reason: reason || (nextOnline ? 'recovered' : 'failed'),
              detail: detail || '',
              at: Date.now()
            }
          }));
        }
      }
    } catch (_eNet) {}
  }

  function detectVersionHeader(resp) {
    try {
      if (!resp || !resp.headers || typeof resp.headers.get !== 'function') return;
      var remoteVer = String(resp.headers.get('x-app-version') || resp.headers.get('X-App-Version') || '').trim();
      var curVer = String(root.__RG_BUILD_VERSION__ || '').trim();
      var core = root.RGCrmCore;
      if (!remoteVer || !curVer) return;
      var isDifferent = (core && typeof core.compareAppVersions === 'function')
        ? core.compareAppVersions(curVer, remoteVer)
        : (curVer !== 'dev' && remoteVer !== 'dev' && curVer !== 'local' && remoteVer !== 'local' && curVer !== remoteVer);
      if (isDifferent && remoteVer !== lastDispatchedRemoteVersion) {
        lastDispatchedRemoteVersion = remoteVer;
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent('rg:versionmismatch', {
            detail: {
              remoteVersion: remoteVer,
              currentVersion: curVer,
              at: Date.now()
            }
          }));
        }
      }
    } catch (_eVer) {}
  }

  function getConfiguredMode() {
    var search = typeof window !== 'undefined' ? window.location.search : '';
    if (/(?:\?|&)sandbox=1(?:&|$)/.test(search)) return 'sandbox';
    if (safeStorageGet(STORAGE_GAS_URL) === SANDBOX_SENTINEL) return 'sandbox';
    if (detectedMode) return detectedMode;
    var cfgMode = (root.RG_APP_CONFIG && root.RG_APP_CONFIG.mode) ? String(root.RG_APP_CONFIG.mode).trim().toLowerCase() : '';
    return (cfgMode === 'neon' || cfgMode === 'gas' || cfgMode === 'sandbox') ? cfgMode : '';
  }

  function getDefaultConfiguredGasUrl() {
    var mode = getConfiguredMode();
    if (mode === 'sandbox') return '';
    var cfg = detectedGasUrl || (root.RG_APP_CONFIG && root.RG_APP_CONFIG.gasWebAppUrl) || root.__RG_DEFAULT_GAS_URL__ || '';
    return String(cfg || '').trim();
  }

  function getDefaultConfiguredBackendUrl() {
    var mode = getConfiguredMode();
    if (mode === 'sandbox' || mode === 'gas') return '';
    var cfg = (root.RG_APP_CONFIG && root.RG_APP_CONFIG.backendApiUrl) || root.__RG_DEFAULT_BACKEND_API_URL__ || '';
    return String(cfg || '').trim();
  }

  function getBackendApiUrl() {
    var mode = getConfiguredMode();
    if (mode === 'sandbox' || mode === 'gas') return '';
    if (detectedBackendUnavailable) return '';
    if (detectedBackendUrl) return detectedBackendUrl;
    return getDefaultConfiguredBackendUrl();
  }

  function getConnectionInfo() {
    var defUrl = getDefaultConfiguredGasUrl();
    var mode = getConfiguredMode();
    var activeUrl = mode === 'sandbox' ? '' : defUrl;
    var source = activeUrl ? 'global_config' : 'sandbox';
    if (_cachedConnInfo && _cachedConnInfo.defUrl === activeUrl && _cachedConnInfo.source === source) {
      return _cachedConnInfo.info;
    }
    var info = {
      url: activeUrl,
      source: source,
      defaultUrl: activeUrl,
      persist: false,
      clearStored: false
    };
    _cachedConnInfo = { defUrl: activeUrl, source: source, info: info };
    return info;
  }

  function getGasUrl() {
    return getConnectionInfo().url;
  }

  function getTransportUrl() {
    return getBackendApiUrl() || getGasUrl();
  }

  function probeBackendHealth() {
    if (backendProbeDone) return Promise.resolve(getBackendApiUrl());
    if (backendProbePromise) return backendProbePromise;
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      backendProbeDone = true;
      return Promise.resolve('');
    }
    var proto = window.location ? window.location.protocol : '';
    var host = window.location ? window.location.hostname : '';
    var search = window.location ? window.location.search : '';
    if ((proto !== 'http:' && proto !== 'https:') || /github\.io$/i.test(host) || /(?:\?|&)sandbox=1(?:&|$)/.test(search)) {
      backendProbeDone = true;
      return Promise.resolve('');
    }

    backendProbePromise = (async function () {
      var timer = null;
      try {
        var opts = { method: 'GET', cache: 'no-store' };
        if (typeof AbortController !== 'undefined') {
          var ctrl = new AbortController();
          opts.signal = ctrl.signal;
          timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6500);
        }
        var resp = await fetch('/api/health', opts);
        if (timer) clearTimeout(timer);
        if (resp) detectVersionHeader(resp);
        if (resp && resp.ok) {
          notifyNetworkState(true, 'health_ok', '/api/health');
          var healthContentType = resp.headers && resp.headers.get ? String(resp.headers.get('content-type') || '').toLowerCase() : '';
          var healthText = await resp.text();
          var trimmedHealth = String(healthText || '').trim();
          var isHtmlHealth = Boolean(
            (trimmedHealth && (trimmedHealth.charAt(0) === '<' || /^<!doctype/i.test(trimmedHealth))) ||
            healthContentType.indexOf('text/html') !== -1
          );
          var json = null;
          if (!isHtmlHealth && trimmedHealth) {
            try {
              json = JSON.parse(trimmedHealth);
            } catch (parseErr) {
              json = null;
            }
          }
          if (isHtmlHealth) {
            detectedHtmlFallback = true;
            detectedBackendUnavailable = true;
            detectedBackendProxyAvailable = false;
            detectedBackendUrl = '';
            _cachedConnInfo = null;
          } else if (json && json.ok) {
            detectedHtmlFallback = false;
            detectedBackendProxyAvailable = Boolean(json.serverlessProxyAvailable !== false);
            detectedEnvGasConfigured = Boolean(json.envGasConfigured);
            detectedServerSyncMeta = (json.syncMeta && typeof json.syncMeta === 'object') ? json.syncMeta : null;
            if (json.mode) {
              detectedMode = String(json.mode || '').trim().toLowerCase();
            }
            if (json.gasWebAppUrl !== undefined) {
              detectedGasUrl = String(json.gasWebAppUrl || '').trim();
            }
            if (json.mode === 'gas' || json.mode === 'sandbox') {
              detectedBackendUnavailable = true;
              detectedBackendUrl = '';
            } else if (json.databaseConfigured) {
              detectedBackendUnavailable = false;
              detectedBackendUrl = json.backendApiUrl || getDefaultConfiguredBackendUrl() || '/api/crm';
            } else {
              detectedBackendUnavailable = true;
              detectedBackendUrl = '';
            }
            _cachedConnInfo = null;
          }
        } else if (resp && (resp.status === 404 || resp.status === 405)) {
          detectedBackendUnavailable = true;
          detectedBackendProxyAvailable = false;
          detectedBackendUrl = '';
          _cachedConnInfo = null;
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
      } finally {
        backendProbeDone = true;
      }
      return getBackendApiUrl();
    })();

    return backendProbePromise;
  }

  async function refreshGlobalConnection() {
    backendProbeDone = false;
    backendProbePromise = null;
    detectedBackendUnavailable = false;
    detectedHtmlFallback = false;
    detectedServerSyncMeta = null;
    _cachedConnInfo = null;
    return probeBackendHealth();
  }

  var SESSION_CACHE_KEY = 'rg_crm_swr_v1';
  var SWR_STALE_MAX_MS = 300000;
  var IDB_KV_MAX_AGE_MS = 86400000; // 24 hours persistent IndexedDB KV window
  var sandboxDbCache = null;
  var sandboxDbRawCache = null;
  var apiResponseCache = {};
  var inFlightRequests = {};
  var inFlightMutations = {};
  var inFlightWarm = {};
  var activeAbortControllers = {};
  var abortRequestSeq = 0;
  var persistTimer = null;
  var persistIdleId = null;

  var hydratedNamespaces = {};
  var hydrationPromises = {};
  var readyPromisesByNs = {};
  var revalidatedInPage = {};
  var localReservationsFreshInPage = {};
  var localReservationsByNs = {};
  var localCustomersByNs = {};
  var customersDirtyByNs = {};
  var localDetailsByNs = {};
  var localExtensionsByResNs = {};
  var localMetaByNs = {};
  var optimisticRollbackStack = [];
  var notifMutationStateByNs = {};
  var NOTIF_TOMBSTONE_SESSION_KEY = 'rg_crm_ntf_tombstones_v1';

  function cloneForRollback(val) {
    try { return JSON.parse(JSON.stringify(val)); } catch (_e) { return val; }
  }

  function loadPersistedNotifTombstones(ns) {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      var raw = sessionStorage.getItem(NOTIF_TOMBSTONE_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && parsed[ns]) ? parsed[ns] : null;
    } catch (_e) {
      return null;
    }
  }

  function persistNotifTombstones(ns, st) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var all = {};
      var raw = sessionStorage.getItem(NOTIF_TOMBSTONE_SESSION_KEY);
      if (raw) {
        try {
          var prev = JSON.parse(raw);
          if (prev && typeof prev === 'object') all = prev;
        } catch (_eParse) {}
      }
      var ids = Object.keys(st.confirmedDeletedIds || {});
      if (ids.length > 400) {
        ids.sort(function (a, b) {
          return Number(st.confirmedDeletedIds[b] || 0) - Number(st.confirmedDeletedIds[a] || 0);
        });
        var trimmed = {};
        ids.slice(0, 400).forEach(function (id) { trimmed[id] = st.confirmedDeletedIds[id]; });
        st.confirmedDeletedIds = trimmed;
      }
      all[ns] = {
        deletedIds: st.confirmedDeletedIds || {},
        deletedAllBeforeMs: Number(st.confirmedDeletedAllBeforeMs || 0)
      };
      sessionStorage.setItem(NOTIF_TOMBSTONE_SESSION_KEY, JSON.stringify(all));
    } catch (_e) {}
  }

  function clearPersistedNotifTombstones(ns) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (!ns) {
        sessionStorage.removeItem(NOTIF_TOMBSTONE_SESSION_KEY);
        return;
      }
      var raw = sessionStorage.getItem(NOTIF_TOMBSTONE_SESSION_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed[ns]) {
        delete parsed[ns];
        sessionStorage.setItem(NOTIF_TOMBSTONE_SESSION_KEY, JSON.stringify(parsed));
      }
    } catch (_e) {}
  }

  function getNotifMutationState(ns) {
    var key = ns || getCacheNamespace();
    if (!notifMutationStateByNs[key]) {
      var persisted = loadPersistedNotifTombstones(key);
      var confIds = (persisted && persisted.deletedIds && typeof persisted.deletedIds === 'object')
        ? cloneForRollback(persisted.deletedIds)
        : {};
      var confClearMs = Number((persisted && persisted.deletedAllBeforeMs) || 0) || 0;
      notifMutationStateByNs[key] = {
        epoch: 0,
        inFlightCount: 0,
        deletedIds: cloneForRollback(confIds) || {},
        deletedAllBeforeMs: confClearMs,
        confirmedDeletedIds: confIds || {},
        confirmedDeletedAllBeforeMs: confClearMs
      };
    }
    return notifMutationStateByNs[key];
  }

  function recordNotifTombstones(ns, ids, deletedAllBefore, opts) {
    var st = getNotifMutationState(ns);
    var cfg = opts || {};
    var nowMs = Date.now();
    var changed = false;
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      var cleanId = String(id || '').trim();
      if (!cleanId) return;
      if (!st.deletedIds[cleanId]) changed = true;
      st.deletedIds[cleanId] = nowMs;
      if (cfg.confirmed) {
        st.confirmedDeletedIds[cleanId] = nowMs;
      }
    });
    if (deletedAllBefore) {
      var ms = typeof deletedAllBefore === 'number' ? deletedAllBefore : Date.parse(String(deletedAllBefore));
      if (!isNaN(ms) && ms > 0) {
        if (ms > st.deletedAllBeforeMs) changed = true;
        st.deletedAllBeforeMs = Math.max(st.deletedAllBeforeMs, ms);
        if (cfg.confirmed) {
          st.confirmedDeletedAllBeforeMs = Math.max(st.confirmedDeletedAllBeforeMs, ms);
        }
      }
    }
    if (changed || cfg.bumpEpoch !== false) {
      st.epoch += 1;
    }
    if (cfg.confirmed) {
      persistNotifTombstones(ns || getCacheNamespace(), st);
    }
    return st.epoch;
  }

  function sanitizeNotificationsForNs(ns, payload) {
    if (!payload || typeof payload !== 'object') return payload;
    var st = getNotifMutationState(ns);
    var core = root.RGCrmCore;
    if (core && typeof core.filterDeletedNotificationsPayload === 'function') {
      return core.filterDeletedNotificationsPayload(payload, st.deletedIds, st.deletedAllBeforeMs);
    }
    var srcItems = Array.isArray(payload.items) ? payload.items : [];
    var clearMs = Number(st.deletedAllBeforeMs || 0);
    var filtered = srcItems.filter(function (n) {
      if (!n || typeof n !== 'object' || n.deletedAt) return false;
      var nid = String(n.id || '').trim();
      if (!nid || st.deletedIds[nid]) return false;
      if (clearMs > 0 && n.createdAt) {
        var cms = Date.parse(String(n.createdAt));
        if (!isNaN(cms) && cms <= clearMs) return false;
      }
      return true;
    });
    return Object.assign({}, payload, {
      items: filtered,
      unreadCount: filtered.filter(function (n) { return !n.isRead; }).length
    });
  }

  function captureOptimisticSnapshot(action) {
    var ns = getCacheNamespace();
    var curNotifSt = action === 'deleteNotification' ? getNotifMutationState(ns) : null;
    var snap = {
      id: 'SNAP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      action: String(action || ''),
      ns: ns,
      apiCache: cloneForRollback(apiResponseCache),
      localRes: localReservationsByNs[ns] ? cloneForRollback(localReservationsByNs[ns]) : null,
      localDet: localDetailsByNs[ns] ? cloneForRollback(localDetailsByNs[ns]) : null,
      notifTombstones: curNotifSt ? {
        deletedIds: cloneForRollback(curNotifSt.deletedIds),
        deletedAllBeforeMs: Number(curNotifSt.deletedAllBeforeMs || 0)
      } : null
    };
    optimisticRollbackStack.push(snap);
    if (optimisticRollbackStack.length > 6) optimisticRollbackStack.shift();
    return snap.id;
  }

  function restoreLatestOptimisticSnapshot(action) {
    var targetAction = String(action || '');
    for (var i = optimisticRollbackStack.length - 1; i >= 0; i--) {
      if (!targetAction || optimisticRollbackStack[i].action === targetAction) {
        var snap = optimisticRollbackStack.splice(i, 1)[0];
        if (snap && snap.apiCache) apiResponseCache = snap.apiCache;
        if (snap && snap.ns) {
          if (snap.localRes) localReservationsByNs[snap.ns] = snap.localRes;
          if (snap.localDet) localDetailsByNs[snap.ns] = snap.localDet;
          if (snap.notifTombstones) {
            var curNtf = getNotifMutationState(snap.ns);
            curNtf.deletedIds = snap.notifTombstones.deletedIds || cloneForRollback(curNtf.confirmedDeletedIds) || {};
            curNtf.deletedAllBeforeMs = Math.max(
              Number(snap.notifTombstones.deletedAllBeforeMs || 0),
              Number(curNtf.confirmedDeletedAllBeforeMs || 0)
            );
            curNtf.epoch += 1;
          }
        }
        schedulePersistApiCache(true);
        return true;
      }
    }
    return false;
  }

  function getCacheNamespace() {
    var mode = getTransportUrl() || 'sandbox';
    var tok = getToken() || '';
    return mode + '::' + (tok ? simpleHash(tok) : 'anon');
  }

  function writeLocalReservationsState(ns, list, replaceAll, metaPatch) {
    var core = root.RGCrmCore;
    var existingBucket = localReservationsByNs[ns] || { list: [], byId: {}, byNumber: {} };
    var nextList = replaceAll
      ? (Array.isArray(list) ? list.slice() : [])
      : (core && core.mergeReservationBatch ? core.mergeReservationBatch(existingBucket.list, list) : (Array.isArray(list) ? list.slice() : existingBucket.list));

    var byId = {};
    var byNumber = {};
    nextList.forEach(function (r) {
      if (!r || !r.id) return;
      if (core && core.normalizeStatusHistory) {
        r.statusHistory = core.normalizeStatusHistory(r.statusHistory);
      }
      byId[r.id] = r;
      if (r.reservationNumber) byNumber[r.reservationNumber] = r;
    });

    localReservationsByNs[ns] = { list: nextList, byId: byId, byNumber: byNumber, updatedAt: Date.now() };
    var shouldRebuildCustomers = Boolean(replaceAll || (Array.isArray(list) && list.length > 5) || !Array.isArray(localCustomersByNs[ns]));
    var customers = localCustomersByNs[ns] || [];
    if (shouldRebuildCustomers) {
      customers = (core && core.buildCustomersIndexFromReservations)
        ? core.buildCustomersIndexFromReservations(nextList)
        : [];
      localCustomersByNs[ns] = customers;
      customersDirtyByNs[ns] = false;
    } else {
      customersDirtyByNs[ns] = true;
    }

    var prevMeta = localMetaByNs[ns] || {};
    var nextMeta = Object.assign({}, prevMeta, metaPatch || {}, {
      ns: ns,
      reservationsCount: nextList.length,
      customersCount: customers.length,
      updatedAt: Date.now()
    });
    localMetaByNs[ns] = nextMeta;

    var idbPromises = [];
    if (root.RGIdbCache) {
      if (replaceAll) {
        idbPromises.push(root.RGIdbCache.replaceReservationsSnapshot(ns, nextList, customers, nextMeta).catch(function () {}));
      } else if (Array.isArray(list) && list.length > 0) {
        idbPromises.push(root.RGIdbCache.upsertReservations(ns, list).catch(function () {}));
        if (shouldRebuildCustomers) {
          idbPromises.push(root.RGIdbCache.upsertCustomers(ns, customers).catch(function () {}));
        }
        idbPromises.push(root.RGIdbCache.upsertMeta(ns, nextMeta).catch(function () {}));
      }
    }
    return {
      list: nextList,
      idbPromise: idbPromises.length ? Promise.all(idbPromises).catch(function () {}) : Promise.resolve()
    };
  }

  function setLocalReservationsState(ns, list, replaceAll, metaPatch) {
    return writeLocalReservationsState(ns, list, replaceAll, metaPatch).list;
  }

  function setLocalExtensionsState(ns, extList) {
    if (!Array.isArray(extList)) return;
    var bucket = { byResId: {}, byResNumber: {}, bySourceId: {} };
    extList.forEach(function (ex) {
      if (!ex || typeof ex !== 'object') return;
      if (ex.reservationId) {
        if (!bucket.byResId[ex.reservationId]) bucket.byResId[ex.reservationId] = [];
        bucket.byResId[ex.reservationId].push(ex);
      }
      if (ex.reservationNumber) {
        if (!bucket.byResNumber[ex.reservationNumber]) bucket.byResNumber[ex.reservationNumber] = [];
        bucket.byResNumber[ex.reservationNumber].push(ex);
      }
      if (ex.sourceReservationId) {
        var sKey = String(ex.sourceReservationId);
        if (!bucket.bySourceId[sKey]) bucket.bySourceId[sKey] = [];
        bucket.bySourceId[sKey].push(ex);
      }
    });
    var sortExts = function (arr) {
      arr.sort(function (a, b) {
        var sa = Number(a.sequenceNumber || 0);
        var sb = Number(b.sequenceNumber || 0);
        if (sa !== sb && sa > 0 && sb > 0) return sa - sb;
        return String(a.startDate || '').localeCompare(String(b.startDate || ''));
      });
    };
    Object.keys(bucket.byResId).forEach(function (k) { sortExts(bucket.byResId[k]); });
    Object.keys(bucket.byResNumber).forEach(function (k) { sortExts(bucket.byResNumber[k]); });
    Object.keys(bucket.bySourceId).forEach(function (k) { sortExts(bucket.bySourceId[k]); });
    localExtensionsByResNs[ns] = bucket;
  }

  function getCachedExtensionsForRes(ns, resObj) {
    var bucket = localExtensionsByResNs[ns];
    if (!bucket || !resObj) return [];
    if (resObj.id && Array.isArray(bucket.byResId[resObj.id])) return bucket.byResId[resObj.id].slice();
    if (resObj.reservationNumber && Array.isArray(bucket.byResNumber[resObj.reservationNumber])) return bucket.byResNumber[resObj.reservationNumber].slice();
    if (resObj.sourceReservationId && Array.isArray(bucket.bySourceId[String(resObj.sourceReservationId)])) return bucket.bySourceId[String(resObj.sourceReservationId)].slice();
    return [];
  }

  function setLocalDetailState(ns, detailData) {
    if (!detailData || !detailData.reservation || !detailData.reservation.id) return;
    var core = root.RGCrmCore;
    var resCopy = Object.assign({}, detailData.reservation);
    if (core && core.normalizeStatusHistory) {
      resCopy.statusHistory = core.normalizeStatusHistory(resCopy.statusHistory);
    }
    var rec = Object.assign({}, detailData, {
      reservation: resCopy,
      followUpHistory: Array.isArray(detailData.followUpHistory) ? detailData.followUpHistory : [],
      cachedAt: Date.now()
    });
    if (!localDetailsByNs[ns]) localDetailsByNs[ns] = {};
    localDetailsByNs[ns][resCopy.id] = rec;

    if (Array.isArray(detailData.extensions)) {
      if (!localExtensionsByResNs[ns]) localExtensionsByResNs[ns] = { byResId: {}, byResNumber: {}, bySourceId: {} };
      localExtensionsByResNs[ns].byResId[resCopy.id] = detailData.extensions.slice();
      if (resCopy.reservationNumber) localExtensionsByResNs[ns].byResNumber[resCopy.reservationNumber] = detailData.extensions.slice();
      if (resCopy.sourceReservationId) localExtensionsByResNs[ns].bySourceId[String(resCopy.sourceReservationId)] = detailData.extensions.slice();
    }

    // Also update reservation in reservations/customers index
    setLocalReservationsState(ns, [resCopy], false);

    if (root.RGIdbCache) {
      root.RGIdbCache.upsertReservationDetail(ns, rec).catch(function () {});
    }
  }

  function syncSandboxReservationToIdb(ns, targetResId, targetResNum) {
    if (getTransportUrl()) return;
    try {
      var db = loadSandboxDb();
      if (!db || !Array.isArray(db.reservations)) return;
      var targetId = String(targetResId || '').trim();
      var targetNum = String(targetResNum || '').trim();
      var resObj = db.reservations.find(function (r) {
        return (targetId && r.id === targetId) || (targetNum && r.reservationNumber === targetNum);
      });
      if (!resObj) return;
      var rid = resObj.id;
      var rnum = resObj.reservationNumber;
      var followUps = (db.followUps || []).filter(function (f) { return f && f.reservationId === rid; })
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      var enriched = Object.assign({}, resObj, { isFollowed: followUps.length > 0 });
      var relExts = (db.extensions || []).filter(function (e) {
        return e.reservationId === rid || (rnum && e.reservationNumber === rnum) || (resObj.sourceReservationId && String(e.sourceReservationId) === String(resObj.sourceReservationId));
      }).sort(function (a, b) {
        var sa = Number(a.sequenceNumber || 0);
        var sb = Number(b.sequenceNumber || 0);
        if (sa !== sb && sa > 0 && sb > 0) return sa - sb;
        return String(a.startDate || '').localeCompare(String(b.startDate || ''));
      });
      var det = {
        reservation: enriched,
        extensions: relExts,
        assignments: (db.assignments || []).filter(function (a) { return a.reservationId === rid && a.status === 'active'; }),
        followUps: followUps,
        followUpHistory: (db.followUpHistory || []).filter(function (h) { return h.reservationId === rid; })
          .sort(function (a, b) { return String(b.changedAt).localeCompare(String(a.changedAt)); }),
        problems: (db.problems || []).filter(function (p) { return p.reservationId === rid; }),
        problemUpdates: (db.problemUpdates || []).filter(function (u) { return rnum && u.reservationNumber === rnum; }),
        cachedAt: Date.now()
      };
      setLocalDetailState(ns, det);
    } catch (e) {}
  }

  function syncSandboxSnapshotToIdb(ns) {
    if (getTransportUrl()) return;
    try {
      var db = loadSandboxDb();
      if (!db || !Array.isArray(db.reservations)) return;
      var followedSet = {};
      (db.followUps || []).forEach(function (f) {
        if (f && f.reservationId) followedSet[f.reservationId] = true;
      });
      var enrichedList = db.reservations.map(function (r) {
        return Object.assign({}, r, { isFollowed: Boolean(followedSet[r.id]) });
      });
      setLocalExtensionsState(ns, db.extensions || []);
      setLocalReservationsState(ns, enrichedList, true, {
        allReservationsHydrated: true,
        allowAgentViewAll: db.settings.allow_agent_view_all !== false,
        lastSyncAt: (db.syncLog && db.syncLog[0] && db.syncLog[0].finishedAt) || new Date().toISOString()
      });
      localReservationsFreshInPage[ns] = true;
      if (!localDetailsByNs[ns]) localDetailsByNs[ns] = {};
      var extsByRes = {};
      var extsByNum = {};
      (db.extensions || []).forEach(function (e) {
        if (e.reservationId) {
          if (!extsByRes[e.reservationId]) extsByRes[e.reservationId] = [];
          extsByRes[e.reservationId].push(e);
        }
        if (e.reservationNumber) {
          if (!extsByNum[e.reservationNumber]) extsByNum[e.reservationNumber] = [];
          extsByNum[e.reservationNumber].push(e);
        }
      });
      var assignByRes = {};
      (db.assignments || []).forEach(function (a) {
        if (a && a.status === 'active' && a.reservationId) {
          if (!assignByRes[a.reservationId]) assignByRes[a.reservationId] = [];
          assignByRes[a.reservationId].push(a);
        }
      });
      var fuByRes = {};
      (db.followUps || []).forEach(function (f) {
        if (f && f.reservationId) {
          if (!fuByRes[f.reservationId]) fuByRes[f.reservationId] = [];
          fuByRes[f.reservationId].push(f);
        }
      });
      var fuhByRes = {};
      (db.followUpHistory || []).forEach(function (h) {
        if (h && h.reservationId) {
          if (!fuhByRes[h.reservationId]) fuhByRes[h.reservationId] = [];
          fuhByRes[h.reservationId].push(h);
        }
      });
      var prbByRes = {};
      (db.problems || []).forEach(function (p) {
        if (p && p.reservationId) {
          if (!prbByRes[p.reservationId]) prbByRes[p.reservationId] = [];
          prbByRes[p.reservationId].push(p);
        }
      });
      var prbuByNum = {};
      (db.problemUpdates || []).forEach(function (u) {
        if (u && u.reservationNumber) {
          if (!prbuByNum[u.reservationNumber]) prbuByNum[u.reservationNumber] = [];
          prbuByNum[u.reservationNumber].push(u);
        }
      });
      enrichedList.forEach(function (r) {
        var relExts = (extsByRes[r.id] || extsByNum[r.reservationNumber] || []).slice().sort(function (a, b) {
          var sa = Number(a.sequenceNumber || 0);
          var sb = Number(b.sequenceNumber || 0);
          if (sa !== sb && sa > 0 && sb > 0) return sa - sb;
          return String(a.startDate || '').localeCompare(String(b.startDate || ''));
        });
        var det = {
          reservation: r,
          extensions: relExts,
          assignments: assignByRes[r.id] || [],
          followUps: (fuByRes[r.id] || []).slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }),
          followUpHistory: (fuhByRes[r.id] || []).slice().sort(function (a, b) { return String(b.changedAt).localeCompare(String(a.changedAt)); }),
          problems: prbByRes[r.id] || [],
          problemUpdates: prbuByNum[r.reservationNumber] || [],
          cachedAt: Date.now()
        };
        localDetailsByNs[ns][r.id] = det;
        if (root.RGIdbCache) root.RGIdbCache.upsertReservationDetail(ns, det).catch(function () {});
      });
    } catch (e) {}
  }

  function invalidateInMemoryByScopes(scopes) {
    var list = Array.isArray(scopes) ? scopes : [scopes];
    var ns = getCacheNamespace();
    Object.keys(apiResponseCache).forEach(function (k) {
      var entry = apiResponseCache[k];
      if (entry && list.indexOf(entry.scope) !== -1) {
        delete apiResponseCache[k];
        delete revalidatedInPage[k];
      }
    });
    if (list.indexOf('reservations') !== -1) {
      localReservationsFreshInPage[ns] = false;
      if (localMetaByNs[ns]) localMetaByNs[ns].allReservationsHydrated = false;
    }
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_CACHE_KEY);
    } catch (_e) {}
  }

  async function runBootSyncCheck(targetNs, force) {
    var ns = targetNs || getCacheNamespace();
    if (!root.RGIdbCache || typeof root.RGIdbCache.enforceBootSyncCheck !== 'function') {
      return { verified: true, invalidated: false, offlineFallback: false };
    }
    var syncRes = await root.RGIdbCache.enforceBootSyncCheck(
      ns,
      async function () {
        if (force) {
          await refreshGlobalConnection();
        } else {
          await probeBackendHealth();
        }
        if (detectedServerSyncMeta) {
          return detectedServerSyncMeta;
        }
        if (!getTransportUrl()) {
          return { syncEpoch: 'sandbox:' + (localMetaByNs[ns] && localMetaByNs[ns].reservationsCount || 0) };
        }
        return { offline: false, syncEpoch: '' };
      },
      {
        force: Boolean(force),
        alwaysInvalidateDashboardOnBoot: Boolean(getTransportUrl() && !detectedServerSyncMeta)
      }
    );
    if (syncRes && syncRes.invalidated) {
      var invScopes = syncRes.epochChanged
        ? ['dashboard', 'todayRadar', 'reservations', 'reports', 'followUps', 'problems', 'employees', 'notifications', 'activity', 'announcements', 'settings']
        : ['dashboard', 'todayRadar'];
      invalidateInMemoryByScopes(invScopes);
    }
    return syncRes;
  }

  async function ensureHydrated(targetNs) {
    var ns = targetNs || getCacheNamespace();
    if (hydratedNamespaces[ns]) return true;
    if (hydrationPromises[ns]) return hydrationPromises[ns];

    hydrationPromises[ns] = (async function () {
      try {
        if (root.RGIdbCache) {
          await runBootSyncCheck(ns, false);
          var snap = await root.RGIdbCache.loadNamespaceSnapshot(ns);
          var now = Date.now();
          (snap.kvEntries || []).forEach(function (entry) {
            if (entry && entry.key && entry.response && entry.staleUntil && now < entry.staleUntil && !apiResponseCache[entry.key]) {
              apiResponseCache[entry.key] = entry;
            }
          });
          if (Array.isArray(snap.reservations) && snap.reservations.length > 0) {
            var orderedSnapRes = snap.reservations.map(function (item, idx) {
              return { item: item, idx: idx };
            }).sort(function (a, b) {
              var ra = a.item || {};
              var rb = b.item || {};
              var sa = (ra.sourceOrder !== undefined && ra.sourceOrder !== null && ra.sourceOrder !== '') ? Number(ra.sourceOrder) : NaN;
              var sb = (rb.sourceOrder !== undefined && rb.sourceOrder !== null && rb.sourceOrder !== '') ? Number(rb.sourceOrder) : NaN;
              var validA = isFinite(sa) && sa > 0;
              var validB = isFinite(sb) && sb > 0;
              if (validA && validB) return sa !== sb ? (sa - sb) : (a.idx - b.idx);
              if (validA && !validB) return -1;
              if (!validA && validB) return 1;
              var ca = (ra._cacheSeq !== undefined && ra._cacheSeq !== null) ? Number(ra._cacheSeq) : NaN;
              var cb = (rb._cacheSeq !== undefined && rb._cacheSeq !== null) ? Number(rb._cacheSeq) : NaN;
              var hasCa = isFinite(ca) && ca >= 0;
              var hasCb = isFinite(cb) && cb >= 0;
              if (hasCa && hasCb) return ca !== cb ? (ca - cb) : (a.idx - b.idx);
              if (hasCa && !hasCb) return -1;
              if (!hasCa && hasCb) return 1;
              return a.idx - b.idx;
            }).map(function (entry) { return entry.item; });
            var byId = {};
            var byNum = {};
            orderedSnapRes.forEach(function (r) {
              if (!r || !r.id) return;
              byId[r.id] = r;
              if (r.reservationNumber) byNum[r.reservationNumber] = r;
            });
            var snapUpdatedAt = Number((snap.meta && snap.meta.updatedAt) || 0);
            localReservationsByNs[ns] = { list: orderedSnapRes, byId: byId, byNumber: byNum, updatedAt: snapUpdatedAt };
          }
          if (Array.isArray(snap.customers) && snap.customers.length > 0) {
            localCustomersByNs[ns] = snap.customers;
          }
          if (Array.isArray(snap.details) && snap.details.length > 0) {
            if (!localDetailsByNs[ns]) localDetailsByNs[ns] = {};
            snap.details.forEach(function (d) {
              if (d && d.id) localDetailsByNs[ns][d.id] = d;
            });
          }
          if (snap.meta) localMetaByNs[ns] = snap.meta;
        }
        if (!getTransportUrl() && getToken() && (!localReservationsByNs[ns] || !localReservationsByNs[ns].list.length)) {
          syncSandboxSnapshotToIdb(ns);
        }
      } catch (e) {}
      hydratedNamespaces[ns] = true;
      delete hydrationPromises[ns];
      return true;
    })();

    return hydrationPromises[ns];
  }

  async function ready() {
    await probeBackendHealth();
    var ns = getCacheNamespace();
    if (hydratedNamespaces[ns]) return true;
    if (readyPromisesByNs[ns]) return readyPromisesByNs[ns];
    readyPromisesByNs[ns] = ensureHydrated(ns).finally(function () {
      delete readyPromisesByNs[ns];
    });
    return readyPromisesByNs[ns];
  }

  function hydrateApiCache() {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      var now = Date.now();
      Object.keys(parsed).forEach(function (k) {
        var entry = parsed[k];
        if (entry && entry.response && entry.staleUntil && now < entry.staleUntil) {
          apiResponseCache[k] = entry;
        }
      });
    } catch (e) {}
  }

  function flushPersistApiCache() {
    var idbWritePromise = Promise.resolve();
    try {
      var now = Date.now();
      var currentNs = getCacheNamespace();
      var idbEntries = [];
      Object.keys(apiResponseCache).forEach(function (k) {
        var entry = apiResponseCache[k];
        if (entry && entry.response && entry.response.success && now < (entry.staleUntil || entry.expiresAt || 0)) {
          idbEntries.push(Object.assign({}, entry, { key: k, ns: entry.ns || currentNs }));
        }
      });
      if (root.RGIdbCache && idbEntries.length > 0) {
        idbWritePromise = root.RGIdbCache.putKvEntries(idbEntries).catch(function () {});
      }

      if (typeof sessionStorage === 'undefined') return idbWritePromise;
      var keys = idbEntries.map(function (e) { return e.key; }).filter(function (k) {
        try {
          var s = JSON.stringify(apiResponseCache[k]);
          return !s || s.length <= 200000;
        } catch (_e) {
          return false;
        }
      });
      if (keys.length > 35) {
        keys.sort(function (a, b) {
          return (apiResponseCache[b].storedAt || 0) - (apiResponseCache[a].storedAt || 0);
        });
        keys = keys.slice(0, 35);
      }
      var snapshot = {};
      keys.forEach(function (k) { snapshot[k] = apiResponseCache[k]; });
      var serialized = JSON.stringify(snapshot);
      if (serialized.length <= 1200000) {
        sessionStorage.setItem(SESSION_CACHE_KEY, serialized);
      }
    } catch (e) {}
    return idbWritePromise;
  }

  function schedulePersistApiCache(immediate) {
    if (immediate) {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      if (persistIdleId && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(persistIdleId);
        persistIdleId = null;
      }
      flushPersistApiCache();
      return;
    }
    if (persistTimer || persistIdleId) return;
    if (typeof requestIdleCallback === 'function') {
      persistIdleId = requestIdleCallback(function () {
        persistIdleId = null;
        flushPersistApiCache();
      }, { timeout: 1500 });
      return;
    }
    persistTimer = setTimeout(function () {
      persistTimer = null;
      flushPersistApiCache();
    }, 800);
  }

  hydrateApiCache();
  // Kick off backend health detection and IndexedDB hydration immediately at boot without blocking
  probeBackendHealth().then(function () {
    return ensureHydrated(getCacheNamespace());
  }).catch(function () {});

  function clearCache(scopes) {
    var ns = getCacheNamespace();
    if (!scopes || (Array.isArray(scopes) && scopes.indexOf('*') !== -1)) {
      apiResponseCache = {};
      revalidatedInPage = {};
      localReservationsFreshInPage = {};
      delete notifMutationStateByNs[ns];
      clearPersistedNotifTombstones(ns);
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (e) {}
      if (root.RGIdbCache && Array.isArray(scopes) && scopes.indexOf('*') !== -1) {
        delete localReservationsByNs[ns];
        delete localCustomersByNs[ns];
        delete localDetailsByNs[ns];
        delete localExtensionsByResNs[ns];
        delete localMetaByNs[ns];
        delete hydratedNamespaces[ns];
        return root.RGIdbCache.clearNamespace(ns).catch(function () {});
      }
      return Promise.resolve();
    }
    var SCOPE_ALIASES = {
      followups: 'followUps',
      teamfollowups: 'followUps',
      todayradar: 'todayRadar'
    };
    var rawList = Array.isArray(scopes) ? scopes : [scopes];
    var list = rawList.map(function (s) {
      var low = String(s || '').trim().toLowerCase();
      return SCOPE_ALIASES[low] || String(s || '').trim();
    }).filter(Boolean);
    var removedKeys = [];
    Object.keys(apiResponseCache).forEach(function (k) {
      var entry = apiResponseCache[k];
      if (entry && list.indexOf(entry.scope) !== -1) {
        delete apiResponseCache[k];
        delete revalidatedInPage[k];
        removedKeys.push(k);
      }
    });
    if (list.indexOf('reservations') !== -1) {
      localReservationsFreshInPage[ns] = false;
    }
    var idbPromises = [];
    if (root.RGIdbCache) {
      if (removedKeys.length) idbPromises.push(root.RGIdbCache.deleteKvByKeys(removedKeys).catch(function () {}));
      idbPromises.push(root.RGIdbCache.deleteKvByScopes(ns, list).catch(function () {}));
    }
    schedulePersistApiCache(true);
    return idbPromises.length ? Promise.all(idbPromises).catch(function () {}) : Promise.resolve();
  }

  function markScopesStale(scopes) {
    var ns = getCacheNamespace();
    var now = Date.now();
    var SCOPE_ALIASES = {
      followups: 'followUps',
      teamfollowups: 'followUps',
      todayradar: 'todayRadar'
    };
    var rawList = Array.isArray(scopes) ? scopes : [scopes];
    var markAll = !scopes || rawList.indexOf('*') !== -1;
    var list = rawList.map(function (s) {
      var low = String(s || '').trim().toLowerCase();
      return SCOPE_ALIASES[low] || String(s || '').trim();
    }).filter(Boolean);
    Object.keys(apiResponseCache).forEach(function (k) {
      var entry = apiResponseCache[k];
      if (!entry) return;
      if (markAll || list.indexOf(entry.scope) !== -1) {
        entry.expiresAt = 0;
        entry.staleUntil = Math.max(Number(entry.staleUntil || 0), now + IDB_KV_MAX_AGE_MS);
        entry.swrValidInPage = true;
      }
    });
    if (markAll || list.indexOf('reservations') !== -1) {
      localReservationsFreshInPage[ns] = false;
    }
    return Promise.resolve();
  }

  function primeCache(action, payload, data) {
    var core = root.RGCrmCore;
    if (!core || !core.getApiCachePolicy || !core.buildApiCacheKey) return;
    var policy = core.getApiCachePolicy(action);
    if (!policy.cacheable) return;
    var now = Date.now();
    var ns = getCacheNamespace();
    var cacheData = data;
    if (action === 'getNotifications' && cacheData && typeof cacheData === 'object') {
      cacheData = sanitizeNotificationsForNs(ns, cacheData);
    } else if (action === 'getAppBootstrap' && cacheData && cacheData.notifications) {
      cacheData = Object.assign({}, cacheData, {
        notifications: sanitizeNotificationsForNs(ns, cacheData.notifications)
      });
    }
    var key = core.buildApiCacheKey(getTransportUrl(), getToken(), action, payload || {});
    revalidatedInPage[key] = true;
    apiResponseCache[key] = {
      key: key,
      ns: ns,
      scope: policy.scope,
      storedAt: now,
      expiresAt: now + policy.ttlMs,
      staleUntil: now + Math.max(policy.ttlMs, IDB_KV_MAX_AGE_MS),
      response: { success: true, message: '', data: cacheData, error: null }
    };
    if (action === 'getReservationDetails' && cacheData && cacheData.reservation) {
      setLocalDetailState(ns, cacheData);
    } else if (action === 'getReservations' && cacheData && Array.isArray(cacheData.items) && cacheData.items.length > 0) {
      setLocalReservationsState(ns, cacheData.items, false);
    }
    schedulePersistApiCache(action === 'getNotifications');
  }

  function hasCached(action, payload) {
    var core = root.RGCrmCore;
    if (!core || !core.getApiCachePolicy || !core.buildApiCacheKey) return false;
    var policy = core.getApiCachePolicy(action);
    if (!policy.cacheable) return false;
    var key = core.buildApiCacheKey(getTransportUrl(), getToken(), action, payload || {});
    var entry = apiResponseCache[key];
    return Boolean(entry && (!getTransportUrl() || revalidatedInPage[key]) && Date.now() < entry.expiresAt);
  }

  function getCachedData(action, payload, allowStale) {
    var core = root.RGCrmCore;
    if (!core || !core.getApiCachePolicy || !core.buildApiCacheKey) return null;
    var policy = core.getApiCachePolicy(action);
    if (!policy.cacheable) return null;
    var key = core.buildApiCacheKey(getTransportUrl(), getToken(), action, payload || {});
    var entry = apiResponseCache[key];
    if (!entry || !entry.response || !entry.response.success) return null;
    var limit = allowStale !== false ? (entry.staleUntil || entry.expiresAt || 0) : (entry.expiresAt || 0);
    if (Date.now() >= limit) return null;
    if (action === 'getNotifications' && entry.response.data) {
      return sanitizeNotificationsForNs(getCacheNamespace(), entry.response.data);
    }
    return entry.response.data;
  }

  function getCachedActionKey(entryKey) {
    var parts = String(entryKey || '').split('|');
    return parts.length >= 3 ? parts[2] : '';
  }

  function parseCachedPayload(entryKey) {
    var parts = String(entryKey || '').split('|');
    if (parts.length < 4) return {};
    try {
      var parsed = JSON.parse(parts.slice(3).join('|'));
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function resolveApiFilterUserContext() {
    var curUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
    if (!curUser) return null;
    var ns = getCacheNamespace();
    var meta = localMetaByNs[ns] || {};
    var allowAll = meta.allowAgentViewAll !== false;
    var settingsCache = getCachedData('getSettings', {}, true);
    if (settingsCache && settingsCache.settings && settingsCache.settings.allowAgentViewAll !== undefined) {
      allowAll = settingsCache.settings.allowAgentViewAll !== false && settingsCache.settings.allowAgentViewAll !== 'false';
    }
    return {
      role: curUser.role || 'agent',
      employeeId: curUser.id || '',
      allowAgentViewAll: allowAll,
      user: curUser
    };
  }

  function patchReservationCachedQuery(data, entryKey, changedList, deletedIds) {
    if (!data || !Array.isArray(data.items)) return undefined;
    var core = root.RGCrmCore;
    if (!core || !core.reapplyReservationDeltaToFilteredList) return undefined;
    var filters = parseCachedPayload(entryKey);
    var fuCache = getCachedData('getTeamFollowUps', {}, true) || getCachedData('getMyFollowUps', {}, true);
    var fuList = fuCache ? (fuCache.items || fuCache.followUps || []) : [];
    var userCtx = resolveApiFilterUserContext();
    var page = Math.max(1, Number(filters.page || data.page || 1));
    var pageSize = Math.max(1, Number(filters.pageSize || data.pageSize || 20));
    var totalBefore = Number(data.total !== undefined ? data.total : data.items.length);
    var res = core.reapplyReservationDeltaToFilteredList(data.items, changedList || [], deletedIds || [], filters, fuList, userCtx);

    if (page > 1 && (res.removedCount > 0 || res.addedCount > 0 || totalBefore > pageSize)) {
      return { __rgDeleteCacheEntry: true };
    }
    if (totalBefore > pageSize && res.removedCount > 0) {
      return { __rgDeleteCacheEntry: true };
    }

    var nextTotal = Math.max(0, totalBefore - res.removedCount + res.addedCount);
    var nextItems = res.items.slice(0, pageSize);
    if (nextTotal < nextItems.length) nextTotal = nextItems.length;
    return Object.assign({}, data, {
      items: nextItems,
      total: nextTotal,
      totalPages: Math.max(1, Math.ceil(nextTotal / pageSize))
    });
  }

  function patchProblemCachedQuery(data, entryKey, changedProblems, deletedResIds, deletedProblemIds) {
    if (!data || !Array.isArray(data.items)) return undefined;
    var core = root.RGCrmCore;
    if (!core || !core.reapplyProblemDeltaToFilteredList) return undefined;
    var filters = parseCachedPayload(entryKey);
    var nextItems = core.reapplyProblemDeltaToFilteredList(data.items, changedProblems || [], deletedResIds || [], filters, deletedProblemIds || []);
    return Object.assign({}, data, {
      items: nextItems,
      total: nextItems.length
    });
  }

  function patchFollowUpCachedQuery(data, entryKey, changedFollowUps, deletedResIds, deletedFollowUpIds) {
    if (!data || !Array.isArray(data.items)) return undefined;
    var core = root.RGCrmCore;
    if (!core || !core.reapplyFollowUpDeltaToFilteredList) return undefined;
    var filters = parseCachedPayload(entryKey);
    var nextItems = core.reapplyFollowUpDeltaToFilteredList(data.items, changedFollowUps || [], deletedResIds || [], filters, deletedFollowUpIds || []);
    return Object.assign({}, data, {
      items: nextItems,
      total: nextItems.length
    });
  }

  function patchCachedScopes(scopes, updaterFn) {
    var list = Array.isArray(scopes) ? scopes : [scopes];
    var touched = false;
    var now = Date.now();
    Object.keys(apiResponseCache).forEach(function (k) {
      var entry = apiResponseCache[k];
      if (!entry || !entry.response || !entry.response.success || !entry.response.data) return;
      if (list.indexOf(entry.scope) === -1) return;
      var actName = getCachedActionKey(k);
      var nextData = updaterFn(entry.response.data, actName, k);
      if (nextData && nextData.__rgDeleteCacheEntry) {
        delete apiResponseCache[k];
        delete revalidatedInPage[k];
        touched = true;
        return;
      }
      if (nextData !== undefined && nextData !== null) {
        entry.response = Object.assign({}, entry.response, { data: nextData });
        entry.storedAt = now;
        touched = true;
      }
    });
    if (touched) schedulePersistApiCache(false);
  }

  function findCachedProblem(problemId) {
    var target = String(problemId || '').trim();
    if (!target) return null;
    var found = null;
    var direct = getCachedData('getProblemDetails', { problemId: target }, true);
    if (direct && direct.problem) return direct.problem;
    Object.keys(apiResponseCache).some(function (k) {
      var entry = apiResponseCache[k];
      if (!entry || !entry.response || !entry.response.success || !entry.response.data) return false;
      var act = getCachedActionKey(k);
      if (act === 'getProblems' && Array.isArray(entry.response.data.items)) {
        var match = entry.response.data.items.find(function (p) { return p.id === target || p.problemNumber === target; });
        if (match) { found = match; return true; }
      }
      if (act === 'getReservationDetails' && Array.isArray(entry.response.data.problems)) {
        var m2 = entry.response.data.problems.find(function (p) { return p.id === target || p.problemNumber === target; });
        if (m2) {
          found = Object.assign({}, m2, {
            updates: (entry.response.data.problemUpdates || []).filter(function (u) { return u.problemId === m2.id; })
          });
          return true;
        }
      }
      return false;
    });
    return found;
  }

  function getCustomersDirectory() {
    var ns = getCacheNamespace();
    var bucket = localReservationsByNs[ns];
    if (!customersDirtyByNs[ns] && Array.isArray(localCustomersByNs[ns]) && localCustomersByNs[ns].length > 0) {
      return localCustomersByNs[ns].slice();
    }
    if (bucket && Array.isArray(bucket.list) && bucket.list.length > 0 && root.RGCrmCore && root.RGCrmCore.buildCustomersIndexFromReservations) {
      var built = root.RGCrmCore.buildCustomersIndexFromReservations(bucket.list);
      localCustomersByNs[ns] = built;
      customersDirtyByNs[ns] = false;
      if (root.RGIdbCache) root.RGIdbCache.upsertCustomers(ns, built).catch(function () {});
      return built.slice();
    }
    if (!getTransportUrl() && getToken()) {
      syncSandboxSnapshotToIdb(ns);
      return (localCustomersByNs[ns] || []).slice();
    }
    return [];
  }

  function getInstantReservationDetails(reservationId) {
    var target = String(reservationId || '').trim();
    if (!target) return null;
    var ns = getCacheNamespace();
    var core = root.RGCrmCore;

    // 1. Check live apiResponseCache for exact getReservationDetails
    var cached = getCachedData('getReservationDetails', { reservationId: target }, true);
    if (cached && cached.reservation) {
      return { success: true, data: cached, isPartial: false, isStale: false };
    }

    // 2. Check hydrated IndexedDB reservation_details index
    var detMap = localDetailsByNs[ns] || {};
    var detEntry = detMap[target];
    if (!detEntry) {
      Object.keys(detMap).some(function (k) {
        var cand = detMap[k];
        if (cand && cand.reservation && (cand.reservation.id === target || cand.reservation.reservationNumber === target)) {
          detEntry = cand;
          return true;
        }
        return false;
      });
    }
    if (detEntry && detEntry.reservation) {
      var ageMs = Date.now() - Number(detEntry.cachedAt || 0);
      return { success: true, data: detEntry, isPartial: false, isStale: ageMs > 60000 };
    }

    // 3. In Sandbox mode, read synchronously from Sandbox DB and cache into IDB immediately
    if (!getTransportUrl() && getToken()) {
      var sb = sandboxExecute('getReservationDetails', getToken(), { reservationId: target });
      if (sb && sb.success && sb.data) {
        setLocalDetailState(ns, sb.data);
        primeCache('getReservationDetails', { reservationId: sb.data.reservation.id }, sb.data);
        return { success: true, data: sb.data, isPartial: false, isStale: false };
      }
    }

    // 4. Synthesize instant view from cached/IDB reservation + cached followUps & problems for zero-delay open
    var resBucket = localReservationsByNs[ns];
    var foundRes = (resBucket && (resBucket.byId[target] || resBucket.byNumber[target])) || null;
    if (!foundRes) {
      Object.keys(apiResponseCache).some(function (k) {
        var e = apiResponseCache[k];
        if (!e || !e.response || !e.response.data) return false;
        var list = e.response.data.items || e.response.data.assignedReservations || [];
        if (!Array.isArray(list)) return false;
        var match = list.find(function (x) { return x && (x.id === target || x.reservationNumber === target); });
        if (match) { foundRes = match; return true; }
        return false;
      });
    }
    if (!foundRes) return null;

    var probCache = getCachedData('getProblems', {}, true);
    var relProblems = (probCache && Array.isArray(probCache.items))
      ? probCache.items.filter(function (p) { return p.reservationId === foundRes.id; })
      : [];

    var relFollowUps = [];
    var seenFu = {};
    [getCachedData('getTeamFollowUps', {}, true), getCachedData('getMyFollowUps', {}, true)].forEach(function (src) {
      var arr = src ? (src.items || src.followUps || []) : [];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (f) {
        if (f && f.reservationId === foundRes.id && !seenFu[f.id]) {
          seenFu[f.id] = true;
          relFollowUps.push(f);
        }
      });
    });

    var synthesized = {
      reservation: Object.assign({}, foundRes, {
        statusHistory: (core && core.normalizeStatusHistory) ? core.normalizeStatusHistory(foundRes.statusHistory) : (foundRes.statusHistory || [])
      }),
      extensions: getCachedExtensionsForRes(ns, foundRes),
      assignments: (Array.isArray(foundRes.assignedEmployeeIds) ? foundRes.assignedEmployeeIds : []).map(function (eid, idx) {
        return {
          id: 'ASN_LOCAL_' + eid,
          reservationId: foundRes.id,
          reservationNumber: foundRes.reservationNumber,
          employeeId: eid,
          employeeName: (foundRes.assignedEmployeeNames && foundRes.assignedEmployeeNames[idx]) || eid,
          status: 'active'
        };
      }),
      followUps: relFollowUps,
      followUpHistory: [],
      problems: relProblems,
      problemUpdates: []
    };

    return { success: true, data: synthesized, isPartial: true, isStale: true };
  }

  async function warmLocalReservationsCache(opts) {
    if (!getToken()) return null;
    var ns = getCacheNamespace();
    await ensureHydrated(ns);
    if (inFlightWarm[ns] && !(opts && opts.force)) return inFlightWarm[ns];

    inFlightWarm[ns] = (async function () {
      try {
        if (!getTransportUrl()) {
          syncSandboxSnapshotToIdb(ns);
          return localMetaByNs[ns] || null;
        }
        var resp = await callApi('syncLocalCache', { forceRefresh: true });
        if (resp && resp.success && resp.data && Array.isArray(resp.data.reservations)) {
          if (Array.isArray(resp.data.extensions)) {
            setLocalExtensionsState(ns, resp.data.extensions);
          }
          setLocalReservationsState(ns, resp.data.reservations, true, {
            allReservationsHydrated: true,
            allowAgentViewAll: resp.data.allowAgentViewAll !== false,
            lastSyncAt: resp.data.syncedAt || new Date().toISOString()
          });
          localReservationsFreshInPage[ns] = true;
          if (Array.isArray(resp.data.followUps) && resp.data.followUps.length > 0 && !hasCached('getTeamFollowUps', {})) {
            primeCache('getTeamFollowUps', {}, { items: resp.data.followUps });
          }
          if (Array.isArray(resp.data.problems) && resp.data.problems.length > 0 && !hasCached('getProblems', {})) {
            primeCache('getProblems', {}, { items: resp.data.problems, total: resp.data.problems.length });
          }
        }
        return localMetaByNs[ns] || null;
      } catch (e) {
        return null;
      } finally {
        delete inFlightWarm[ns];
      }
    })();

    return inFlightWarm[ns];
  }

  function prefetchReservationDetails(reservationId) {
    var target = String(reservationId || '').trim();
    if (!target || !getToken()) return;
    var ns = getCacheNamespace();
    if (localDetailsByNs[ns] && localDetailsByNs[ns][target] && (Date.now() - (localDetailsByNs[ns][target].cachedAt || 0)) < 60000) {
      return;
    }
    if (hasCached('getReservationDetails', { reservationId: target })) return;
    callApi('getReservationDetails', { reservationId: target, silentRefresh: true }).catch(function () {});
  }

  function getLocalCacheStats() {
    var ns = getCacheNamespace();
    var resBucket = localReservationsByNs[ns];
    var custList = localCustomersByNs[ns] || [];
    var detMap = localDetailsByNs[ns] || {};
    return {
      reservationsCount: resBucket && Array.isArray(resBucket.list) ? resBucket.list.length : 0,
      customersCount: custList.length,
      detailsCount: Object.keys(detMap).length,
      meta: localMetaByNs[ns] || null
    };
  }

  function buildLocalLifecycleCounts(list, core, userContext) {
    var rows = Array.isArray(list) ? list : [];
    var u = userContext || {};
    var restrictAgent = u.role === 'agent' && u.allowAgentViewAll === false &&
      !(u.user && core && core.canUserPerform && core.canUserPerform(u.user, 'view_all_reservations'));
    var scoped = [];
    var activeCnt = 0;
    var cancelledCnt = 0;
    var rejectedCnt = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r !== 'object') continue;
      if (restrictAgent) {
        var assigned = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];
        if (assigned.indexOf(u.employeeId) === -1) continue;
      }
      scoped.push(r);
      var isCan = core && core.isCancelledStatus ? core.isCancelledStatus(r) : false;
      var isRej = core && core.isRejectedStatus ? core.isRejectedStatus(r) : false;
      var isInact = core && core.isInactiveReservation ? core.isInactiveReservation(r) : (isCan || isRej);
      if (isCan) cancelledCnt++;
      if (isRej) rejectedCnt++;
      if (!isInact) activeCnt++;
    }
    var todayCnt = (core && core.computeTodayMovementsSummary)
      ? Number((core.computeTodayMovementsSummary(scoped, Date.now(), { subFilter: 'all' }) || {}).totalCount || 0)
      : 0;
    var radarCnt = (core && core.computeExpiryRadarSummary)
      ? Number((core.computeExpiryRadarSummary(scoped, Date.now(), { subFilter: 'all', windowHours: 24, gracePastHours: 12 }) || {}).totalCount || 0)
      : 0;
    return {
      all: scoped.length,
      active: activeCnt,
      cancelled: cancelledCnt,
      rejected: rejectedCnt,
      today: todayCnt,
      radar: radarCnt
    };
  }

  function queryLocalReservationsFast(payload, userContext) {
    var ns = getCacheNamespace();
    var core = root.RGCrmCore;
    if (!core || !core.filterReservations) return null;

    var resBucket = localReservationsByNs[ns];
    if (!resBucket || !Array.isArray(resBucket.list) || resBucket.list.length === 0) return null;
    var meta = localMetaByNs[ns] || {};
    if (!meta.allReservationsHydrated) return null;
    if (getTransportUrl() && !localReservationsFreshInPage[ns]) return null;

    var ageMs = Date.now() - Number(resBucket.updatedAt || meta.updatedAt || 0);
    if (ageMs > SWR_STALE_MAX_MS * 2) return null;

    var p = Object.assign({}, payload || {}, {
      lifecycle: String(((payload || {}).lifecycle) || 'active')
    });
    var fuCache = getCachedData('getTeamFollowUps', {}, true) || getCachedData('getMyFollowUps', {}, true);
    var fuList = fuCache ? (fuCache.items || fuCache.followUps || []) : [];

    var companies = {};
    var branches = {};
    resBucket.list.forEach(function (r) {
      if (r.companyName) companies[r.companyName] = true;
      if (r.branchName) branches[r.branchName] = true;
    });

    var filtered = core.filterReservations(resBucket.list, fuList, p, userContext);
    var page = Math.max(1, Number(p.page || 1));
    var pageSize = Math.max(1, Number(p.pageSize || 25));
    var startIdx = (page - 1) * pageSize;
    var pagedLocal = filtered.slice(startIdx, startIdx + pageSize);
    if (userContext && userContext.user && core.redactReservationSensitiveFields) {
      pagedLocal = pagedLocal.map(function (r) {
        return core.redactReservationSensitiveFields(r, userContext.user);
      });
    }

    return {
      isStale: ageMs > 45000,
      response: {
        success: true,
        message: '',
        data: {
          items: pagedLocal,
          total: filtered.length,
          page: page,
          pageSize: pageSize,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
          facets: {
            companies: Object.keys(companies).sort(),
            branches: Object.keys(branches).sort()
          },
          lifecycleCounts: buildLocalLifecycleCounts(resBucket.list, core, userContext)
        },
        error: null
      }
    };
  }

  function queryLocalTodayAndRadarFast(payload, userContext) {
    var ns = getCacheNamespace();
    var core = root.RGCrmCore;
    if (!core || !core.computeTodayMovementsSummary || !core.computeExpiryRadarSummary) return null;

    var resBucket = localReservationsByNs[ns];
    if (!resBucket || !Array.isArray(resBucket.list) || resBucket.list.length === 0) return null;
    var meta = localMetaByNs[ns] || {};
    if (!meta.allReservationsHydrated) return null;
    if (getTransportUrl() && !localReservationsFreshInPage[ns]) return null;

    var ageMs = Date.now() - Number(resBucket.updatedAt || meta.updatedAt || 0);
    if (ageMs > SWR_STALE_MAX_MS * 2) return null;

    var p = payload || {};
    var u = userContext || {};
    var restrictAgent = u.role === 'agent' && u.allowAgentViewAll === false &&
      !(u.user && core.canUserPerform && core.canUserPerform(u.user, 'view_all_reservations'));
    var candidates = resBucket.list.filter(function (r) {
      if (!r) return false;
      if (restrictAgent) {
        return Array.isArray(r.assignedEmployeeIds) && r.assignedEmployeeIds.indexOf(u.employeeId) !== -1;
      }
      return true;
    });
    var todayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(p.todayDate || ''))
      ? String(p.todayDate)
      : (core.getRiyadhDateString ? core.getRiyadhDateString() : todayIso(0));
    var nowMs = (typeof p.nowMs === 'number' && isFinite(p.nowMs)) ? p.nowMs : Date.now();
    var todaySummary = core.computeTodayMovementsSummary(candidates, nowMs, {
      todayDate: todayStr,
      subFilter: 'all'
    });
    var radarSummary = core.computeExpiryRadarSummary(candidates, nowMs, {
      subFilter: 'all',
      windowHours: 24,
      gracePastHours: 12
    });
    var counts = {
      todayTotal: Number(todaySummary.totalCount || 0),
      pickupCount: Number(todaySummary.pickupCount || 0),
      returnCount: Number(todaySummary.returnCount || 0),
      pendingPickupCount: Number(todaySummary.pendingPickupCount || 0),
      pendingReturnCount: Number(todaySummary.pendingReturnCount || 0),
      overdueTodayCount: Number(todaySummary.overdueCount || 0),
      radarTotal: Number(radarSummary.totalCount || 0),
      upcoming24hCount: Number(radarSummary.upcoming24hCount || 0),
      critical6hCount: Number(radarSummary.critical6hCount || 0),
      soon24hCount: Number(radarSummary.soon24hCount || 0),
      expiredUnclosedCount: Number(radarSummary.expiredUnclosedCount || 0),
      extendedInRadarCount: Number(radarSummary.extendedInRadarCount || 0)
    };
    return {
      isStale: ageMs > 45000,
      response: {
        success: true,
        message: '',
        data: {
          todayDate: todayStr,
          serverTime: new Date().toISOString(),
          counts: counts,
          todaySummary: todaySummary,
          radarSummary: radarSummary,
          items: candidates
        },
        error: null
      }
    };
  }

  function emitOptimisticMutationEvent(action, detail) {
    try {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
        var core = root.RGCrmCore;
        var scopes = (core && core.getCacheInvalidationScopes) ? core.getCacheInvalidationScopes(action) : [];
        document.dispatchEvent(new CustomEvent('rg:optimisticmutation', {
          detail: Object.assign({
            action: action,
            scopes: scopes,
            at: Date.now()
          }, detail || {})
        }));
      }
    } catch (_e) {}
  }

  function patchTodayRadarCaches(resUpdaterFn) {
    var core = root.RGCrmCore;
    if (typeof resUpdaterFn !== 'function') return;
    patchCachedScopes(['todayRadar'], function (data, actName) {
      if (actName !== 'getTodayAndRadar' || !data || !Array.isArray(data.items)) return undefined;
      var nextItems = data.items.map(resUpdaterFn);
      if (core && core.computeTodayMovementsSummary && core.computeExpiryRadarSummary) {
        var nowMs = Date.now();
        var todayStr = data.todayDate || (core.getRiyadhDateString ? core.getRiyadhDateString() : todayIso(0));
        var tSum = core.computeTodayMovementsSummary(nextItems, nowMs, { todayDate: todayStr, subFilter: 'all' });
        var rSum = core.computeExpiryRadarSummary(nextItems, nowMs, { subFilter: 'all', windowHours: 24, gracePastHours: 12 });
        var counts = {
          todayTotal: Number(tSum.totalCount || 0),
          pickupCount: Number(tSum.pickupCount || 0),
          returnCount: Number(tSum.returnCount || 0),
          pendingPickupCount: Number(tSum.pendingPickupCount || 0),
          pendingReturnCount: Number(tSum.pendingReturnCount || 0),
          overdueTodayCount: Number(tSum.overdueCount || 0),
          radarTotal: Number(rSum.totalCount || 0),
          upcoming24hCount: Number(rSum.upcoming24hCount || 0),
          critical6hCount: Number(rSum.critical6hCount || 0),
          soon24hCount: Number(rSum.soon24hCount || 0),
          expiredUnclosedCount: Number(rSum.expiredUnclosedCount || 0),
          extendedInRadarCount: Number(rSum.extendedInRadarCount || 0)
        };
        return Object.assign({}, data, {
          items: nextItems,
          todaySummary: tSum,
          radarSummary: rSum,
          counts: counts
        });
      }
      return Object.assign({}, data, { items: nextItems });
    });
  }

  function applyOptimisticMutation(action, payload, actor) {
    var p = payload || {};
    var core = root.RGCrmCore;
    var actUser = actor || (root.RGAuth && root.RGAuth.getUser()) || { id: '', name: 'الموظف' };
    var empCache = getCachedData('getEmployees', {}, true);
    var allEmployees = (empCache && Array.isArray(empCache.items)) ? empCache.items : [];
    var nowIso = new Date().toISOString();
    captureOptimisticSnapshot(action);

    if (action === 'claimReservation' || action === 'unclaimReservation') {
      var resIdClaim = String(p.reservationId || '').trim();
      if (!resIdClaim || !core) return;
      var applyAssignFn = function (rec) {
        if (!rec || rec.id !== resIdClaim) return rec;
        var res = action === 'claimReservation'
          ? core.claimReservationRecord(rec, actUser)
          : core.unclaimReservationRecord(rec, actUser.id);
        return Object.assign({}, rec, {
          assignedEmployeeIds: res.assignedEmployeeIds,
          assignedEmployeeNames: res.assignedEmployeeNames
        });
      };
      var nsClaim = getCacheNamespace();
      if (localReservationsByNs[nsClaim] && localReservationsByNs[nsClaim].byId[resIdClaim]) {
        setLocalReservationsState(nsClaim, [applyAssignFn(localReservationsByNs[nsClaim].byId[resIdClaim])], false);
      }
      if (localDetailsByNs[nsClaim] && localDetailsByNs[nsClaim][resIdClaim] && localDetailsByNs[nsClaim][resIdClaim].reservation) {
        setLocalDetailState(nsClaim, Object.assign({}, localDetailsByNs[nsClaim][resIdClaim], {
          reservation: applyAssignFn(localDetailsByNs[nsClaim][resIdClaim].reservation)
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitClaim = (localReservationsByNs[nsClaim] && localReservationsByNs[nsClaim].byId[resIdClaim]) ||
            data.items.find(function (x) { return x && x.id === resIdClaim; });
          var changedArrClaim = hitClaim ? [applyAssignFn(hitClaim)] : [];
          return changedArrClaim.length
            ? patchReservationCachedQuery(data, entryKey, changedArrClaim, [])
            : Object.assign({}, data, { items: data.items.map(applyAssignFn) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdClaim) {
          return Object.assign({}, data, { reservation: applyAssignFn(data.reservation) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          var nextAssigned = data.assignedReservations.slice();
          if (action === 'unclaimReservation') {
            nextAssigned = nextAssigned.filter(function (r) { return r.id !== resIdClaim; });
          } else if (!nextAssigned.some(function (r) { return r.id === resIdClaim; })) {
            var foundRes = (localReservationsByNs[nsClaim] && localReservationsByNs[nsClaim].byId[resIdClaim]) || null;
            if (!foundRes) {
              Object.keys(apiResponseCache).some(function (k) {
                var e = apiResponseCache[k];
                if (e && e.response && e.response.data && Array.isArray(e.response.data.items)) {
                  foundRes = e.response.data.items.find(function (x) { return x.id === resIdClaim; });
                  return Boolean(foundRes);
                }
                return false;
              });
            }
            if (foundRes) nextAssigned.unshift(applyAssignFn(foundRes));
          }
          return Object.assign({}, data, { assignedReservations: nextAssigned });
        }
        return undefined;
      });
      patchTodayRadarCaches(applyAssignFn);
      emitOptimisticMutationEvent(action, { reservationId: resIdClaim });
      return;
    }

    if (action === 'quickUpdateReservationStatus' || action === 'addFollowUp') {
      var resIdFu = String(p.reservationId || '').trim();
      var nextSt = String(p.status || '').trim();
      if (!resIdFu || (nextSt && core && typeof core.isManualBlockedWorkflowStatus === 'function' && core.isManualBlockedWorkflowStatus(nextSt))) {
        return;
      }
      var actionText = action === 'quickUpdateReservationStatus'
        ? ('تحديث سريع للحالة إلى: ' + nextSt)
        : String(p.action || '').trim();
      var noteText = String(p.note !== undefined ? p.note : (p.notes || '')).trim();
      var lastTxt = action === 'quickUpdateReservationStatus'
        ? (noteText ? (actionText + ' — ' + noteText) : actionText)
        : (actionText + (noteText ? (' — ' + noteText) : ''));

      var patchResStatus = function (rec) {
        if (!rec || rec.id !== resIdFu) return rec;
        var nextHistory = (core && core.appendStatusStageEntry)
          ? core.appendStatusStageEntry(rec.statusHistory || [], {
              source: action === 'quickUpdateReservationStatus' ? 'quick_status' : 'followup',
              previousStatus: rec.internalStatus || '',
              newStatus: nextSt || rec.internalStatus,
              changedAt: nowIso,
              changedById: actUser.id,
              changedByName: actUser.name,
              note: lastTxt
            })
          : (rec.statusHistory || []);
        return Object.assign({}, rec, {
          internalStatus: nextSt || rec.internalStatus,
          lastUpdateText: lastTxt || rec.lastUpdateText,
          lastUpdatedById: actUser.id || rec.lastUpdatedById,
          lastUpdatedByName: actUser.name || rec.lastUpdatedByName,
          lastUpdatedAt: nowIso,
          statusHistory: nextHistory,
          isFollowed: true
        });
      };
      var nsOptFu = getCacheNamespace();
      if (localDetailsByNs[nsOptFu] && localDetailsByNs[nsOptFu][resIdFu]) {
        var prevDetOpt = localDetailsByNs[nsOptFu][resIdFu];
        var nextDetOpt = Object.assign({}, prevDetOpt, {
          reservation: patchResStatus(prevDetOpt.reservation),
          followUps: [{
            id: 'FU_OPT_' + Date.now(),
            reservationId: resIdFu,
            reservationNumber: prevDetOpt.reservation.reservationNumber,
            customerName: prevDetOpt.reservation.customerName,
            employeeId: actUser.id,
            employeeName: actUser.name,
            status: nextSt,
            action: actionText,
            notes: noteText,
            followUpDate: nowIso.substring(0, 10),
            followUpTime: new Date().toTimeString().substring(0, 8),
            createdAt: nowIso
          }].concat(prevDetOpt.followUps || [])
        });
        setLocalDetailState(nsOptFu, nextDetOpt);
      } else if (localReservationsByNs[nsOptFu] && localReservationsByNs[nsOptFu].byId[resIdFu]) {
        setLocalReservationsState(nsOptFu, [patchResStatus(localReservationsByNs[nsOptFu].byId[resIdFu])], false);
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitFu = (localReservationsByNs[nsOptFu] && localReservationsByNs[nsOptFu].byId[resIdFu]) ||
            data.items.find(function (x) { return x && x.id === resIdFu; });
          return hitFu
            ? patchReservationCachedQuery(data, entryKey, [patchResStatus(hitFu)], [])
            : Object.assign({}, data, { items: data.items.map(patchResStatus) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdFu) {
          var newFuObj = {
            id: 'FU_OPT_' + Date.now(),
            reservationId: resIdFu,
            reservationNumber: data.reservation.reservationNumber,
            customerName: data.reservation.customerName,
            employeeId: actUser.id,
            employeeName: actUser.name,
            status: nextSt,
            action: actionText,
            notes: noteText,
            followUpDate: nowIso.substring(0, 10),
            followUpTime: new Date().toTimeString().substring(0, 8),
            createdAt: nowIso
          };
          return Object.assign({}, data, {
            reservation: patchResStatus(data.reservation),
            followUps: [newFuObj].concat(data.followUps || [])
          });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, {
            assignedReservations: data.assignedReservations.map(patchResStatus)
          });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchResStatus);
      emitOptimisticMutationEvent(action, { reservationId: resIdFu });
      return;
    }

    if (action === 'saveReservationPinnedNote') {
      var resIdPin = String(p.reservationId || '').trim();
      var notePin = String(p.note || '').trim();
      if (!resIdPin) return;
      var patchPinned = function (rec) {
        if (!rec || rec.id !== resIdPin) return rec;
        return Object.assign({}, rec, {
          pinnedNote: notePin,
          pinnedNoteById: notePin ? (actUser.id || '') : '',
          pinnedNoteByName: notePin ? (actUser.name || '') : '',
          pinnedNoteUpdatedAt: notePin ? nowIso : ''
        });
      };
      var nsPin = getCacheNamespace();
      if (localReservationsByNs[nsPin] && localReservationsByNs[nsPin].byId[resIdPin]) {
        setLocalReservationsState(nsPin, [patchPinned(localReservationsByNs[nsPin].byId[resIdPin])], false);
      }
      if (localDetailsByNs[nsPin] && localDetailsByNs[nsPin][resIdPin] && localDetailsByNs[nsPin][resIdPin].reservation) {
        setLocalDetailState(nsPin, Object.assign({}, localDetailsByNs[nsPin][resIdPin], {
          reservation: patchPinned(localDetailsByNs[nsPin][resIdPin].reservation)
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.map(patchPinned) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdPin) {
          return Object.assign({}, data, { reservation: patchPinned(data.reservation) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.map(patchPinned) });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchPinned);
      emitOptimisticMutationEvent(action, { reservationId: resIdPin });
      return;
    }

    if (action === 'recordNoAnswerFollowUp') {
      var resIdNa = String(p.reservationId || '').trim();
      var noteNa = String(p.note || p.notes || '').trim();
      if (!resIdNa) return;
      var patchNa = function (rec) {
        if (!rec || rec.id !== resIdNa) return rec;
        var nextCnt = Math.max(0, Math.floor(Number(rec.noAnswerCount || 0))) + 1;
        var actionTxt = (core && core.buildNoAnswerActionText)
          ? core.buildNoAnswerActionText(nextCnt, 'ar')
          : ('محاولة اتصال — لم يرد (المحاولة #' + nextCnt + ')');
        var lastTxt = noteNa ? (actionTxt + ' — ' + noteNa) : actionTxt;
        return Object.assign({}, rec, {
          noAnswerCount: nextCnt,
          lastUpdateText: lastTxt,
          lastUpdatedById: actUser.id || rec.lastUpdatedById,
          lastUpdatedByName: actUser.name || rec.lastUpdatedByName,
          lastUpdatedAt: nowIso,
          isFollowed: true
        });
      };
      var nsNa = getCacheNamespace();
      if (localReservationsByNs[nsNa] && localReservationsByNs[nsNa].byId[resIdNa]) {
        setLocalReservationsState(nsNa, [patchNa(localReservationsByNs[nsNa].byId[resIdNa])], false);
      }
      if (localDetailsByNs[nsNa] && localDetailsByNs[nsNa][resIdNa] && localDetailsByNs[nsNa][resIdNa].reservation) {
        var curNaDet = localDetailsByNs[nsNa][resIdNa];
        var nextResNa = patchNa(curNaDet.reservation);
        var actTxtDet = (core && core.buildNoAnswerActionText)
          ? core.buildNoAnswerActionText(nextResNa.noAnswerCount, 'ar')
          : ('محاولة اتصال — لم يرد (المحاولة #' + nextResNa.noAnswerCount + ')');
        setLocalDetailState(nsNa, Object.assign({}, curNaDet, {
          reservation: nextResNa,
          followUps: [{
            id: 'FU_OPT_' + Date.now(),
            reservationId: resIdNa,
            reservationNumber: curNaDet.reservation.reservationNumber,
            customerName: curNaDet.reservation.customerName,
            employeeId: actUser.id,
            employeeName: actUser.name,
            status: curNaDet.reservation.internalStatus || 'تم الإنشاء',
            action: actTxtDet,
            notes: noteNa,
            followUpDate: toRiyadhParts(nowIso).date,
            followUpTime: toRiyadhParts(nowIso).time,
            createdAt: nowIso
          }].concat(curNaDet.followUps || [])
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitNa = (localReservationsByNs[nsNa] && localReservationsByNs[nsNa].byId[resIdNa]) ||
            data.items.find(function (x) { return x && x.id === resIdNa; });
          return hitNa
            ? patchReservationCachedQuery(data, entryKey, [patchNa(hitNa)], [])
            : Object.assign({}, data, { items: data.items.map(patchNa) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdNa) {
          var nextRNa = patchNa(data.reservation);
          var actTxtC = (core && core.buildNoAnswerActionText)
            ? core.buildNoAnswerActionText(nextRNa.noAnswerCount, 'ar')
            : ('محاولة اتصال — لم يرد (المحاولة #' + nextRNa.noAnswerCount + ')');
          return Object.assign({}, data, {
            reservation: nextRNa,
            followUps: [{
              id: 'FU_OPT_' + Date.now(),
              reservationId: resIdNa,
              reservationNumber: data.reservation.reservationNumber,
              customerName: data.reservation.customerName,
              employeeId: actUser.id,
              employeeName: actUser.name,
              status: data.reservation.internalStatus || 'تم الإنشاء',
              action: actTxtC,
              notes: noteNa,
              followUpDate: toRiyadhParts(nowIso).date,
              followUpTime: toRiyadhParts(nowIso).time,
              createdAt: nowIso
            }].concat(data.followUps || [])
          });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.map(patchNa) });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchNa);
      emitOptimisticMutationEvent(action, { reservationId: resIdNa });
      return;
    }

    if (action === 'updateProblem') {
      var prbId = String(p.problemId || '').trim();
      if (!prbId || !core) return;
      var affectedResId = '';
      var stillOpenOnRes = null;

      patchCachedScopes(['problems', 'reservations'], function (data, actName, entryKey) {
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          var matchedPrbItem = data.items.find(function (item) { return item && item.id === prbId; }) || findCachedProblem(prbId);
          if (matchedPrbItem) {
            affectedResId = matchedPrbItem.reservationId || affectedResId;
            var patchedPrb = core.applyOptimisticProblemPatch(matchedPrbItem, p, actUser, allEmployees);
            stillOpenOnRes = !core.isProblemClosedStatus(patchedPrb.status);
            return patchProblemCachedQuery(data, entryKey, [patchedPrb], []);
          }
          return undefined;
        }
        if (actName === 'getProblemDetails' && data.problem && data.problem.id === prbId) {
          affectedResId = data.problem.reservationId || affectedResId;
          return Object.assign({}, data, {
            problem: core.applyOptimisticProblemPatch(data.problem, p, actUser, allEmployees)
          });
        }
        if (actName === 'getReservationDetails' && Array.isArray(data.problems)) {
          var touched = false;
          var nextPrbs = data.problems.map(function (it) {
            if (it.id !== prbId) return it;
            touched = true;
            affectedResId = it.reservationId || (data.reservation && data.reservation.id) || affectedResId;
            return core.applyOptimisticProblemPatch(it, p, actUser, allEmployees);
          });
          if (!touched) return undefined;
          var isResOpen = nextPrbs.some(function (it) { return !core.isProblemClosedStatus(it.status); });
          stillOpenOnRes = isResOpen;
          var patchedItem = nextPrbs.find(function (it) { return it.id === prbId; });
          var newUpdateEntry = (patchedItem && patchedItem.updates && patchedItem.updates[0]) ? [patchedItem.updates[0]] : [];
          return Object.assign({}, data, {
            problems: nextPrbs,
            problemUpdates: newUpdateEntry.concat(data.problemUpdates || []),
            reservation: data.reservation ? Object.assign({}, data.reservation, { hasProblem: isResOpen }) : data.reservation
          });
        }
        return undefined;
      });

      if (affectedResId && stillOpenOnRes !== null) {
        var nsPrbUpd = getCacheNamespace();
        var updatedHasPrbRes = null;
        if (localReservationsByNs[nsPrbUpd] && localReservationsByNs[nsPrbUpd].byId[affectedResId]) {
          updatedHasPrbRes = Object.assign({}, localReservationsByNs[nsPrbUpd].byId[affectedResId], { hasProblem: Boolean(stillOpenOnRes) });
          setLocalReservationsState(nsPrbUpd, [updatedHasPrbRes], false);
        }
        if (localDetailsByNs[nsPrbUpd] && localDetailsByNs[nsPrbUpd][affectedResId]) {
          var detP = localDetailsByNs[nsPrbUpd][affectedResId];
          var detPrbs = (detP.problems || []).map(function (it) {
            return it.id === prbId ? core.applyOptimisticProblemPatch(it, p, actUser, allEmployees) : it;
          });
          setLocalDetailState(nsPrbUpd, Object.assign({}, detP, {
            problems: detPrbs,
            reservation: detP.reservation ? Object.assign({}, detP.reservation, { hasProblem: Boolean(stillOpenOnRes) }) : detP.reservation
          }));
        }
        patchCachedScopes(['reservations'], function (data, actName, entryKey) {
          if (actName === 'getReservations' && Array.isArray(data.items)) {
            var baseTarget = updatedHasPrbRes || data.items.find(function (r) { return r && r.id === affectedResId; });
            if (baseTarget) {
              return patchReservationCachedQuery(data, entryKey, [Object.assign({}, baseTarget, { hasProblem: Boolean(stillOpenOnRes) })], []);
            }
          }
          return undefined;
        });
        patchTodayRadarCaches(function (r) {
          return r && r.id === affectedResId ? Object.assign({}, r, { hasProblem: Boolean(stillOpenOnRes) }) : r;
        });
      }
      emitOptimisticMutationEvent(action, { problemId: prbId, reservationId: affectedResId });
      return;
    }

    if (action === 'deleteProblem') {
      var delPrbId = String(p.problemId || p.id || '').trim();
      if (!delPrbId || !core) return;
      var delAffectedResId = String(p.reservationId || '').trim();
      var delStillOpenOnRes = null;

      patchCachedScopes(['problems', 'reservations'], function (data, actName, entryKey) {
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          var matchedDelPrb = data.items.find(function (item) { return item && item.id === delPrbId; });
          if (matchedDelPrb && matchedDelPrb.reservationId) {
            delAffectedResId = delAffectedResId || matchedDelPrb.reservationId;
          }
          if (delAffectedResId && delStillOpenOnRes === null) {
            var remainingForRes = data.items.filter(function (it) {
              return it && it.id !== delPrbId && it.reservationId === delAffectedResId;
            });
            delStillOpenOnRes = remainingForRes.some(function (it) { return !core.isProblemClosedStatus(it.status); });
          }
          return patchProblemCachedQuery(data, entryKey, [], [], [delPrbId]);
        }
        if (actName === 'getProblemDetails' && data.problem && data.problem.id === delPrbId) {
          delAffectedResId = delAffectedResId || data.problem.reservationId || '';
          return { __rgDeleteCacheEntry: true };
        }
        if (actName === 'getReservationDetails' && Array.isArray(data.problems)) {
          var hadTarget = data.problems.some(function (it) { return it && it.id === delPrbId; });
          if (!hadTarget) return undefined;
          delAffectedResId = delAffectedResId || (data.reservation && data.reservation.id) || '';
          var filteredPrbs = data.problems.filter(function (it) { return it && it.id !== delPrbId; });
          var resStillOpen = filteredPrbs.some(function (it) { return !core.isProblemClosedStatus(it.status); });
          delStillOpenOnRes = resStillOpen;
          return Object.assign({}, data, {
            problems: filteredPrbs,
            problemUpdates: Array.isArray(data.problemUpdates)
              ? data.problemUpdates.filter(function (u) { return u && u.problemId !== delPrbId; })
              : data.problemUpdates,
            reservation: data.reservation ? Object.assign({}, data.reservation, { hasProblem: resStillOpen }) : data.reservation
          });
        }
        return undefined;
      });

      if (delAffectedResId) {
        var nsPrbDel = getCacheNamespace();
        if (localDetailsByNs[nsPrbDel] && localDetailsByNs[nsPrbDel][delAffectedResId]) {
          var detDel = localDetailsByNs[nsPrbDel][delAffectedResId];
          var detDelPrbs = (detDel.problems || []).filter(function (it) { return it && it.id !== delPrbId; });
          if (delStillOpenOnRes === null) {
            delStillOpenOnRes = detDelPrbs.some(function (it) { return !core.isProblemClosedStatus(it.status); });
          }
          setLocalDetailState(nsPrbDel, Object.assign({}, detDel, {
            problems: detDelPrbs,
            problemUpdates: Array.isArray(detDel.problemUpdates)
              ? detDel.problemUpdates.filter(function (u) { return u && u.problemId !== delPrbId; })
              : detDel.problemUpdates,
            reservation: detDel.reservation ? Object.assign({}, detDel.reservation, { hasProblem: Boolean(delStillOpenOnRes) }) : detDel.reservation
          }));
        }
        if (delStillOpenOnRes !== null) {
          var updatedDelPrbRes = null;
          if (localReservationsByNs[nsPrbDel] && localReservationsByNs[nsPrbDel].byId[delAffectedResId]) {
            updatedDelPrbRes = Object.assign({}, localReservationsByNs[nsPrbDel].byId[delAffectedResId], { hasProblem: Boolean(delStillOpenOnRes) });
            setLocalReservationsState(nsPrbDel, [updatedDelPrbRes], false);
          }
          patchCachedScopes(['reservations'], function (data, actName, entryKey) {
            if (actName === 'getReservations' && Array.isArray(data.items)) {
              var baseDelTarget = updatedDelPrbRes || data.items.find(function (r) { return r && r.id === delAffectedResId; });
              if (baseDelTarget) {
                return patchReservationCachedQuery(data, entryKey, [Object.assign({}, baseDelTarget, { hasProblem: Boolean(delStillOpenOnRes) })], []);
              }
            }
            return undefined;
          });
          patchTodayRadarCaches(function (r) {
            return r && r.id === delAffectedResId ? Object.assign({}, r, { hasProblem: Boolean(delStillOpenOnRes) }) : r;
          });
        }
      }

      emitOptimisticMutationEvent(action, { problemId: delPrbId, reservationId: delAffectedResId });
      return;
    }

    if (action === 'createProblem') {
      var resIdPrb = String(p.reservationId || '').trim();
      var optPrb = p._optimisticProblem || {
        id: 'PRB_OPT_' + Date.now(),
        problemNumber: 'PRB-' + String(Date.now()).slice(-6),
        reservationId: resIdPrb,
        reservationNumber: p.reservationNumber || '',
        customerName: p.customerName || '',
        createdById: actUser.id,
        createdByName: actUser.name,
        assignedEmployeeIds: Array.isArray(p.assignedEmployeeIds) && p.assignedEmployeeIds.length ? p.assignedEmployeeIds : [actUser.id],
        assignedEmployeeNames: [],
        description: String(p.description || '').trim(),
        priority: p.priority || 'متوسط',
        status: 'جديدة',
        createdAt: nowIso,
        updatedAt: nowIso,
        updates: []
      };
      var nsPrbNew = getCacheNamespace();
      if (localReservationsByNs[nsPrbNew] && localReservationsByNs[nsPrbNew].byId[resIdPrb]) {
        var baseR = localReservationsByNs[nsPrbNew].byId[resIdPrb];
        setLocalReservationsState(nsPrbNew, [Object.assign({}, baseR, {
          hasProblem: true,
          priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : baseR.priority
        })], false);
      }
      if (localDetailsByNs[nsPrbNew] && localDetailsByNs[nsPrbNew][resIdPrb]) {
        var detNew = localDetailsByNs[nsPrbNew][resIdPrb];
        setLocalDetailState(nsPrbNew, Object.assign({}, detNew, {
          reservation: detNew.reservation ? Object.assign({}, detNew.reservation, {
            hasProblem: true,
            priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : detNew.reservation.priority
          }) : detNew.reservation,
          problems: [optPrb].concat(detNew.problems || [])
        }));
      }
      patchCachedScopes(['reservations', 'problems'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitNewPrb = (localReservationsByNs[nsPrbNew] && localReservationsByNs[nsPrbNew].byId[resIdPrb]) ||
            data.items.find(function (r) { return r && r.id === resIdPrb; });
          if (hitNewPrb) {
            return patchReservationCachedQuery(data, entryKey, [Object.assign({}, hitNewPrb, {
              hasProblem: true,
              priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : hitNewPrb.priority
            })], []);
          }
          return undefined;
        }
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          return patchProblemCachedQuery(data, entryKey, [optPrb], []);
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdPrb) {
          return Object.assign({}, data, {
            reservation: Object.assign({}, data.reservation, {
              hasProblem: true,
              priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : data.reservation.priority
            }),
            problems: [optPrb].concat(data.problems || [])
          });
        }
        return undefined;
      });
      patchTodayRadarCaches(function (r) {
        if (!r || r.id !== resIdPrb) return r;
        return Object.assign({}, r, {
          hasProblem: true,
          priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : r.priority
        });
      });
      emitOptimisticMutationEvent(action, { reservationId: resIdPrb });
      return;
    }

    if (action === 'updateReservationDetails') {
      var resIdDet = String(p.reservationId || '').trim();
      if (!resIdDet) return;
      var patchDet = function (rec) {
        if (!rec || rec.id !== resIdDet) return rec;
        var nextStatusVal = (p.internalStatus !== undefined && p.internalStatus !== '') ? String(p.internalStatus) : rec.internalStatus;
        var nextHist = rec.statusHistory || [];
        if (nextStatusVal && nextStatusVal !== rec.internalStatus && core && core.appendStatusStageEntry) {
          nextHist = core.appendStatusStageEntry(nextHist, {
            source: 'supervisor_edit',
            previousStatus: rec.internalStatus,
            newStatus: nextStatusVal,
            changedAt: nowIso,
            changedById: actUser.id,
            changedByName: actUser.name,
            note: p.lastUpdateText !== undefined ? String(p.lastUpdateText) : 'تحديث الحالة'
          });
        }
        var out = Object.assign({}, rec, {
          lastUpdatedById: actUser.id || rec.lastUpdatedById,
          lastUpdatedByName: actUser.name || rec.lastUpdatedByName,
          lastUpdatedAt: nowIso,
          updatedAt: nowIso,
          statusHistory: nextHist
        });
        var strFields = [
          'customerName', 'customerPhone', 'customerEmail', 'customerIdNumber',
          'companyName', 'branchName', 'deliverBranchName',
          'carName', 'carCategory', 'plateNumber',
          'startDate', 'startTime', 'endDate', 'endTime',
          'extendedUntilDate', 'extendedUntilTime',
          'pickupTypeAr', 'returnTypeAr',
          'paymentMethod', 'paymentStatus',
          'internalStatus', 'priority', 'notes', 'lastUpdateText'
        ];
        strFields.forEach(function (fk) {
          if (p[fk] !== undefined) out[fk] = String(p[fk]);
        });
        var numFields = ['daysCount', 'extendedDaysCount', 'totalDaysCount', 'extensionsCount', 'baseAmount', 'extensionsAmount', 'totalAmount'];
        numFields.forEach(function (nf) {
          if (p[nf] !== undefined && p[nf] !== '') {
            var parsedN = Number(p[nf]);
            if (!isNaN(parsedN)) out[nf] = parsedN;
          }
        });
        if (out.extensionsCount > 0 || out.extendedDaysCount > 0) out.hasExtensions = true;
        return out;
      };
      var nsDet = getCacheNamespace();
      if (localReservationsByNs[nsDet] && localReservationsByNs[nsDet].byId[resIdDet]) {
        setLocalReservationsState(nsDet, [patchDet(localReservationsByNs[nsDet].byId[resIdDet])], false);
      }
      if (localDetailsByNs[nsDet] && localDetailsByNs[nsDet][resIdDet] && localDetailsByNs[nsDet][resIdDet].reservation) {
        setLocalDetailState(nsDet, Object.assign({}, localDetailsByNs[nsDet][resIdDet], {
          reservation: patchDet(localDetailsByNs[nsDet][resIdDet].reservation)
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitDet = (localReservationsByNs[nsDet] && localReservationsByNs[nsDet].byId[resIdDet]) ||
            data.items.find(function (r) { return r && r.id === resIdDet; });
          return hitDet
            ? patchReservationCachedQuery(data, entryKey, [patchDet(hitDet)], [])
            : Object.assign({}, data, { items: data.items.map(patchDet) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdDet) {
          return Object.assign({}, data, { reservation: patchDet(data.reservation) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.map(patchDet) });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchDet);
      emitOptimisticMutationEvent(action, { reservationId: resIdDet });
      return;
    }

    if (action === 'updateFollowUp') {
      var fuIdOpt = String(p.followUpId || '').trim();
      var resIdFuEdit = String(p.reservationId || '').trim();
      if (!fuIdOpt) return;
      var patchFuItem = function (f) {
        if (!f || f.id !== fuIdOpt) return f;
        var outF = Object.assign({}, f);
        if (p.status !== undefined && p.status !== '') outF.status = String(p.status);
        if (p.action !== undefined) outF.action = String(p.action);
        if (p.notes !== undefined) outF.notes = String(p.notes);
        return outF;
      };
      var nsFuEdit = getCacheNamespace();
      var patchResFromFu = function (rec) {
        if (!rec || (resIdFuEdit && rec.id !== resIdFuEdit)) return rec;
        var nextStF = p.status ? String(p.status) : rec.internalStatus;
        var lastTxtF = String(p.action || '') + (p.notes ? (' — ' + String(p.notes)) : '');
        return Object.assign({}, rec, {
          internalStatus: nextStF,
          lastUpdateText: lastTxtF || rec.lastUpdateText,
          lastUpdatedById: actUser.id || rec.lastUpdatedById,
          lastUpdatedByName: actUser.name || rec.lastUpdatedByName,
          lastUpdatedAt: nowIso,
          updatedAt: nowIso
        });
      };
      if (resIdFuEdit && localReservationsByNs[nsFuEdit] && localReservationsByNs[nsFuEdit].byId[resIdFuEdit]) {
        setLocalReservationsState(nsFuEdit, [patchResFromFu(localReservationsByNs[nsFuEdit].byId[resIdFuEdit])], false);
      }
      if (resIdFuEdit && localDetailsByNs[nsFuEdit] && localDetailsByNs[nsFuEdit][resIdFuEdit]) {
        var detFuCur = localDetailsByNs[nsFuEdit][resIdFuEdit];
        setLocalDetailState(nsFuEdit, Object.assign({}, detFuCur, {
          reservation: detFuCur.reservation ? patchResFromFu(detFuCur.reservation) : detFuCur.reservation,
          followUps: Array.isArray(detFuCur.followUps) ? detFuCur.followUps.map(patchFuItem) : []
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && resIdFuEdit && Array.isArray(data.items)) {
          var hitFuR = (localReservationsByNs[nsFuEdit] && localReservationsByNs[nsFuEdit].byId[resIdFuEdit]) ||
            data.items.find(function (r) { return r && r.id === resIdFuEdit; });
          return hitFuR
            ? patchReservationCachedQuery(data, entryKey, [patchResFromFu(hitFuR)], [])
            : Object.assign({}, data, { items: data.items.map(patchResFromFu) });
        }
        if (actName === 'getReservationDetails' && data.reservation && (!resIdFuEdit || data.reservation.id === resIdFuEdit)) {
          return Object.assign({}, data, {
            reservation: patchResFromFu(data.reservation),
            followUps: Array.isArray(data.followUps) ? data.followUps.map(patchFuItem) : data.followUps
          });
        }
        if (actName === 'getMyFollowUps') {
          return Object.assign({}, data, {
            followUps: Array.isArray(data.followUps) ? data.followUps.map(patchFuItem) : data.followUps,
            assignedReservations: (resIdFuEdit && Array.isArray(data.assignedReservations)) ? data.assignedReservations.map(patchResFromFu) : data.assignedReservations
          });
        }
        if (actName === 'getTeamFollowUps' && Array.isArray(data.items)) {
          var existingFu = data.items.find(function (f) { return f && f.id === fuIdOpt; });
          return existingFu
            ? patchFollowUpCachedQuery(data, entryKey, [patchFuItem(existingFu)], [])
            : undefined;
        }
        return undefined;
      });
      if (resIdFuEdit) patchTodayRadarCaches(patchResFromFu);
      emitOptimisticMutationEvent(action, { followUpId: fuIdOpt, reservationId: resIdFuEdit });
      return;
    }

    if (action === 'deleteFollowUp') {
      var delFuId = String(p.followUpId || p.id || '').trim();
      var delFuResId = String(p.reservationId || '').trim();
      if (!delFuId) return;
      var nsFuDel = getCacheNamespace();
      var remainingFollowUpCountOpt = null;
      var nextLatestFuOpt = null;

      if (delFuResId && localDetailsByNs[nsFuDel] && localDetailsByNs[nsFuDel][delFuResId]) {
        var detFuDelCur = localDetailsByNs[nsFuDel][delFuResId];
        var remDetFus = (Array.isArray(detFuDelCur.followUps) ? detFuDelCur.followUps : []).filter(function (f) {
          return f && f.id !== delFuId;
        });
        remainingFollowUpCountOpt = remDetFus.length;
        nextLatestFuOpt = remDetFus[0] || null;
        var nextDetRes = detFuDelCur.reservation ? Object.assign({}, detFuDelCur.reservation, {
          isFollowed: remDetFus.length > 0,
          lastUpdateText: nextLatestFuOpt ? (String(nextLatestFuOpt.action || '') + (nextLatestFuOpt.notes ? (' — ' + String(nextLatestFuOpt.notes)) : '')) : ''
        }) : detFuDelCur.reservation;
        setLocalDetailState(nsFuDel, Object.assign({}, detFuDelCur, {
          reservation: nextDetRes,
          followUps: remDetFus
        }));
      }

      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getTeamFollowUps' && Array.isArray(data.items)) {
          return patchFollowUpCachedQuery(data, entryKey, [], [], [delFuId]);
        }
        if (actName === 'getMyFollowUps') {
          var nextMyFus = Array.isArray(data.followUps) ? data.followUps.filter(function (f) { return f && f.id !== delFuId; }) : data.followUps;
          var nextMentions = Array.isArray(data.mentionFollowUps) ? data.mentionFollowUps.filter(function (f) { return f && f.id !== delFuId; }) : data.mentionFollowUps;
          return Object.assign({}, data, {
            followUps: nextMyFus,
            mentionFollowUps: nextMentions
          });
        }
        if (actName === 'getReservationDetails' && Array.isArray(data.followUps)) {
          if (!data.followUps.some(function (f) { return f && f.id === delFuId; })) return undefined;
          delFuResId = delFuResId || (data.reservation && data.reservation.id) || '';
          var filteredResFus = data.followUps.filter(function (f) { return f && f.id !== delFuId; });
          remainingFollowUpCountOpt = filteredResFus.length;
          nextLatestFuOpt = filteredResFus[0] || null;
          return Object.assign({}, data, {
            followUps: filteredResFus,
            reservation: data.reservation ? Object.assign({}, data.reservation, {
              isFollowed: filteredResFus.length > 0,
              lastUpdateText: nextLatestFuOpt ? (String(nextLatestFuOpt.action || '') + (nextLatestFuOpt.notes ? (' — ' + String(nextLatestFuOpt.notes)) : '')) : ''
            }) : data.reservation
          });
        }
        return undefined;
      });

      if (delFuResId && remainingFollowUpCountOpt !== null) {
        var patchResAfterFuDel = function (rec) {
          if (!rec || rec.id !== delFuResId) return rec;
          return Object.assign({}, rec, {
            isFollowed: remainingFollowUpCountOpt > 0,
            lastUpdateText: nextLatestFuOpt ? (String(nextLatestFuOpt.action || '') + (nextLatestFuOpt.notes ? (' — ' + String(nextLatestFuOpt.notes)) : '')) : ''
          });
        };
        if (localReservationsByNs[nsFuDel] && localReservationsByNs[nsFuDel].byId[delFuResId]) {
          setLocalReservationsState(nsFuDel, [patchResAfterFuDel(localReservationsByNs[nsFuDel].byId[delFuResId])], false);
        }
        patchCachedScopes(['reservations'], function (data, actName, entryKey) {
          if (actName === 'getReservations' && Array.isArray(data.items)) {
            var hitRec = (localReservationsByNs[nsFuDel] && localReservationsByNs[nsFuDel].byId[delFuResId]) ||
              data.items.find(function (r) { return r && r.id === delFuResId; });
            return hitRec ? patchReservationCachedQuery(data, entryKey, [patchResAfterFuDel(hitRec)], []) : undefined;
          }
          return undefined;
        });
        patchTodayRadarCaches(patchResAfterFuDel);
      }

      emitOptimisticMutationEvent(action, { followUpId: delFuId, reservationId: delFuResId });
      return;
    }

    if (action === 'assignEmployees' || action === 'removeAssignment') {
      var resIdAs = String(p.reservationId || '').trim();
      if (!resIdAs) return;
      var patchAs = function (rec) {
        if (!rec || rec.id !== resIdAs) return rec;
        if (action === 'assignEmployees' && Array.isArray(p.employeeIds)) {
          var existingIds = Array.isArray(rec.assignedEmployeeIds) ? rec.assignedEmployeeIds : [];
          var addIds = p.employeeIds.map(String).filter(Boolean);
          var nextIds = [];
          var seenId = {};
          (p._replaceAssignments ? addIds : existingIds.concat(addIds)).forEach(function (eid) {
            if (eid && !seenId[eid]) { seenId[eid] = true; nextIds.push(eid); }
          });
          var nextNames = nextIds.map(function (eid, idx) {
            var foundEmp = allEmployees.find(function (e) { return e.id === eid; });
            if (foundEmp && foundEmp.name) return foundEmp.name;
            var oldIdx = existingIds.indexOf(eid);
            return (oldIdx !== -1 && Array.isArray(rec.assignedEmployeeNames) && rec.assignedEmployeeNames[oldIdx]) || eid;
          });
          return Object.assign({}, rec, {
            assignedEmployeeIds: nextIds,
            assignedEmployeeNames: nextNames,
            updatedAt: nowIso
          });
        }
        if (action === 'removeAssignment' && p.employeeId) {
          var remId = String(p.employeeId);
          var curIds = Array.isArray(rec.assignedEmployeeIds) ? rec.assignedEmployeeIds : [];
          var curNames = Array.isArray(rec.assignedEmployeeNames) ? rec.assignedEmployeeNames : [];
          var keptIds = [];
          var keptNames = [];
          curIds.forEach(function (eid, idx) {
            if (eid !== remId) {
              keptIds.push(eid);
              keptNames.push(curNames[idx] || eid);
            }
          });
          return Object.assign({}, rec, {
            assignedEmployeeIds: keptIds,
            assignedEmployeeNames: keptNames,
            updatedAt: nowIso
          });
        }
        return rec;
      };
      var nsAs = getCacheNamespace();
      if (localReservationsByNs[nsAs] && localReservationsByNs[nsAs].byId[resIdAs]) {
        setLocalReservationsState(nsAs, [patchAs(localReservationsByNs[nsAs].byId[resIdAs])], false);
      }
      if (localDetailsByNs[nsAs] && localDetailsByNs[nsAs][resIdAs] && localDetailsByNs[nsAs][resIdAs].reservation) {
        setLocalDetailState(nsAs, Object.assign({}, localDetailsByNs[nsAs][resIdAs], {
          reservation: patchAs(localDetailsByNs[nsAs][resIdAs].reservation)
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var hitAs = (localReservationsByNs[nsAs] && localReservationsByNs[nsAs].byId[resIdAs]) ||
            data.items.find(function (r) { return r && r.id === resIdAs; });
          return hitAs
            ? patchReservationCachedQuery(data, entryKey, [patchAs(hitAs)], [])
            : Object.assign({}, data, { items: data.items.map(patchAs) });
        }
        if (actName === 'getReservationDetails' && data.reservation && data.reservation.id === resIdAs) {
          return Object.assign({}, data, { reservation: patchAs(data.reservation) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          var nextMyAs = data.assignedReservations.map(patchAs).filter(function (r) {
            return Array.isArray(r.assignedEmployeeIds) && r.assignedEmployeeIds.indexOf(actUser.id) !== -1;
          });
          return Object.assign({}, data, { assignedReservations: nextMyAs });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchAs);
      emitOptimisticMutationEvent(action, { reservationId: resIdAs });
      return;
    }

    if (action === 'bulkReassignSelectedReservations') {
      var bulkIds = Array.isArray(p.reservationIds) ? p.reservationIds.map(String).filter(Boolean) : [];
      var targetEmpIdB = String(p.targetEmployeeId || p.toEmployeeId || p.employeeId || '').trim();
      var bulkMode = String(p.mode || 'replace').toLowerCase() === 'add' ? 'add' : 'replace';
      if (!bulkIds.length || !targetEmpIdB) return;
      var targetEmpObjB = allEmployees.find(function (e) { return e.id === targetEmpIdB; });
      var targetEmpNameB = (targetEmpObjB && targetEmpObjB.name) || String(p.targetEmployeeName || targetEmpIdB);
      var bulkIdSet = {};
      bulkIds.forEach(function (id) { bulkIdSet[id] = true; });
      var patchBulkRec = function (rec) {
        if (!rec || !bulkIdSet[rec.id]) return rec;
        var nextIds = [];
        var nextNames = [];
        if (bulkMode === 'add') {
          var curIds = Array.isArray(rec.assignedEmployeeIds) ? rec.assignedEmployeeIds : [];
          var curNames = Array.isArray(rec.assignedEmployeeNames) ? rec.assignedEmployeeNames : [];
          var seenB = {};
          curIds.forEach(function (eid, idx) {
            if (eid && !seenB[eid]) {
              seenB[eid] = true;
              nextIds.push(eid);
              nextNames.push(curNames[idx] || eid);
            }
          });
          if (!seenB[targetEmpIdB]) {
            nextIds.push(targetEmpIdB);
            nextNames.push(targetEmpNameB);
          }
        } else {
          nextIds = [targetEmpIdB];
          nextNames = [targetEmpNameB];
        }
        return Object.assign({}, rec, {
          assignedEmployeeIds: nextIds,
          assignedEmployeeNames: nextNames,
          lastUpdateText: (bulkMode === 'add' ? 'إسناد جماعي إلى: ' : 'إعادة توزيع جماعي إلى: ') + targetEmpNameB,
          lastUpdatedById: actUser.id || rec.lastUpdatedById,
          lastUpdatedByName: actUser.name || rec.lastUpdatedByName,
          lastUpdatedAt: nowIso,
          updatedAt: nowIso
        });
      };
      var nsBulk = getCacheNamespace();
      var bulkPatchedList = [];
      if (localReservationsByNs[nsBulk] && localReservationsByNs[nsBulk].byId) {
        bulkIds.forEach(function (id) {
          if (localReservationsByNs[nsBulk].byId[id]) {
            bulkPatchedList.push(patchBulkRec(localReservationsByNs[nsBulk].byId[id]));
          }
        });
        if (bulkPatchedList.length) setLocalReservationsState(nsBulk, bulkPatchedList, false);
      }
      if (localDetailsByNs[nsBulk]) {
        bulkIds.forEach(function (id) {
          if (localDetailsByNs[nsBulk][id] && localDetailsByNs[nsBulk][id].reservation) {
            setLocalDetailState(nsBulk, Object.assign({}, localDetailsByNs[nsBulk][id], {
              reservation: patchBulkRec(localDetailsByNs[nsBulk][id].reservation)
            }));
          }
        });
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          var patchedHits = bulkPatchedList.length
            ? bulkPatchedList
            : data.items.filter(function (r) { return r && bulkIdSet[r.id]; }).map(patchBulkRec);
          return patchedHits.length
            ? patchReservationCachedQuery(data, entryKey, patchedHits, [])
            : Object.assign({}, data, { items: data.items.map(patchBulkRec) });
        }
        if (actName === 'getReservationDetails' && data.reservation && bulkIdSet[data.reservation.id]) {
          return Object.assign({}, data, { reservation: patchBulkRec(data.reservation) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.map(patchBulkRec) });
        }
        return undefined;
      });
      patchTodayRadarCaches(patchBulkRec);
      emitOptimisticMutationEvent(action, { reservationIds: bulkIds, targetEmployeeId: targetEmpIdB });
      return;
    }

    if (action === 'markNotificationRead') {
      patchCachedScopes(['notifications'], function (data, actName) {
        if (actName !== 'getNotifications' || !Array.isArray(data.items)) return undefined;
        var nextItems = data.items.map(function (n) {
          if (p.markAll || n.id === p.notificationId) {
            return Object.assign({}, n, { isRead: true });
          }
          return n;
        });
        var nextUnread = nextItems.filter(function (n) { return !n.isRead; }).length;
        return Object.assign({}, data, { items: nextItems, unreadCount: nextUnread });
      });
      emitOptimisticMutationEvent(action, {});
      return;
    }

    if (action === 'deleteNotification') {
      var delNsOpt = getCacheNamespace();
      var delNidOpt = String(p.notificationId || p.id || '').trim();
      var delAllOpt = Boolean(p.deleteAll);
      if (delAllOpt) {
        recordNotifTombstones(delNsOpt, [], Date.now(), { confirmed: false });
      } else if (delNidOpt) {
        recordNotifTombstones(delNsOpt, [delNidOpt], 0, { confirmed: false });
      }
      patchCachedScopes(['notifications'], function (data, actName) {
        if (actName !== 'getNotifications' || !Array.isArray(data.items)) return undefined;
        var nextItems = delAllOpt
          ? []
          : data.items.filter(function (n) { return n && n.id !== delNidOpt; });
        var nextUnread = nextItems.filter(function (n) { return !n.isRead; }).length;
        return Object.assign({}, data, { items: nextItems, unreadCount: nextUnread });
      });
      schedulePersistApiCache(true);
      emitOptimisticMutationEvent(action, { notificationId: delNidOpt, deleteAll: delAllOpt });
      return;
    }

    if (action === 'updateEmployee') {
      var updEmpId = String(p.employeeId || '').trim();
      if (!updEmpId) return;
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName === 'getEmployees' && Array.isArray(data.items)) {
          return Object.assign({}, data, {
            items: data.items.map(function (emp) {
              if (emp.id !== updEmpId) return emp;
              return Object.assign({}, emp, {
                name: p.name !== undefined ? String(p.name) : emp.name,
                username: p.username !== undefined ? String(p.username).trim().toLowerCase() : emp.username,
                phone: p.phone !== undefined ? String(p.phone) : emp.phone,
                email: p.email !== undefined ? String(p.email) : emp.email,
                jobTitle: p.jobTitle !== undefined ? String(p.jobTitle) : emp.jobTitle,
                role: p.role !== undefined ? String(p.role) : emp.role,
                permissions: Array.isArray(p.permissions) ? p.permissions.slice() : emp.permissions,
                status: p.status !== undefined ? String(p.status) : emp.status,
                updatedAt: nowIso
              });
            })
          });
        }
        return undefined;
      });
      emitOptimisticMutationEvent(action, { employeeId: updEmpId });
      return;
    }

    if (action === 'disableEmployee') {
      var empTargetId = String(p.employeeId || '').trim();
      var nextEmpStatus = p.status === 'active' ? 'active' : 'disabled';
      if (!empTargetId) return;
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName === 'getEmployees' && Array.isArray(data.items)) {
          return Object.assign({}, data, {
            items: data.items.map(function (emp) {
              return emp.id === empTargetId ? Object.assign({}, emp, { status: nextEmpStatus, updatedAt: nowIso }) : emp;
            })
          });
        }
        return undefined;
      });
      emitOptimisticMutationEvent(action, { employeeId: empTargetId });
      return;
    }

    if (action === 'deleteEmployee') {
      var delEmpId = String(p.employeeId || '').trim();
      if (!delEmpId) return;
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName === 'getEmployees' && Array.isArray(data.items)) {
          return Object.assign({}, data, {
            items: data.items.filter(function (emp) { return emp.id !== delEmpId; })
          });
        }
        return undefined;
      });
      emitOptimisticMutationEvent(action, { employeeId: delEmpId });
      return;
    }

    if (action === 'createEmployee') {
      var newOptEmp = p._optimisticEmployee;
      if (!newOptEmp || !newOptEmp.id) return;
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName === 'getEmployees' && Array.isArray(data.items)) {
          var exists = data.items.some(function (emp) { return emp && emp.id === newOptEmp.id; });
          if (exists) return undefined;
          return Object.assign({}, data, {
            items: data.items.concat([newOptEmp]),
            total: Number(data.total || data.items.length) + 1
          });
        }
        return undefined;
      });
      emitOptimisticMutationEvent(action, { employeeId: newOptEmp.id });
      return;
    }

    if (action === 'saveRolePreset' || action === 'deleteRolePreset' || action === 'resetRolePresets') {
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName !== 'getEmployees') return undefined;
        var nextPresets = Array.isArray(data.rolePresets) ? data.rolePresets.slice() : [];
        if (action === 'resetRolePresets' && core && Array.isArray(core.JOB_ROLE_PRESETS)) {
          nextPresets = core.JOB_ROLE_PRESETS.slice();
        } else if (action === 'deleteRolePreset') {
          var delPId = String(p.presetId || p.id || '').trim();
          nextPresets = nextPresets.filter(function (pr) { return pr && pr.id !== delPId; });
        } else if (action === 'saveRolePreset' && core && core.upsertRolePreset) {
          try { nextPresets = core.upsertRolePreset(nextPresets, p).presets; } catch (_eUp) {}
        }
        return Object.assign({}, data, { rolePresets: nextPresets });
      });
      emitOptimisticMutationEvent(action, {});
      return;
    }

    if (action === 'saveDelegation' || action === 'revokeDelegation') {
      patchCachedScopes(['employees'], function (data, actName) {
        if (actName !== 'getDelegations' || !Array.isArray(data.items)) return undefined;
        if (action === 'revokeDelegation') {
          var revIdOpt = String(p.id || p.delegationId || '').trim();
          return Object.assign({}, data, {
            items: data.items.map(function (del) {
              return (del && del.id === revIdOpt)
                ? Object.assign({}, del, { status: 'revoked', revokedAt: nowIso, isActiveNow: false })
                : del;
            })
          });
        }
        if (action === 'saveDelegation' && p._optimisticDelegation) {
          return Object.assign({}, data, { items: [p._optimisticDelegation].concat(data.items) });
        }
        return undefined;
      });
      emitOptimisticMutationEvent(action, {});
      return;
    }

    if (action === 'updateSettings') {
      emitOptimisticMutationEvent(action, {});
    }
  }

  function setGasUrl() {
    _cachedConnInfo = null;
    safeStorageSet(STORAGE_GAS_URL, '');
    safeStorageSet(STORAGE_BACKEND_URL, '');
    clearCache();
  }

  function getToken() {
    return safeStorageGet(STORAGE_TOKEN);
  }

  function setToken(token) {
    safeStorageSet(STORAGE_TOKEN, token ? String(token).trim() : '');
    clearCache();
  }

  function isLiveMode() {
    return Boolean(getTransportUrl());
  }

  function warmUpGas() {
    var gasUrl = getGasUrl();
    if (getBackendApiUrl()) {
      try { fetch('/api/health', { method: 'GET', cache: 'no-store' }).catch(function () {}); } catch (e0) {}
      return;
    }
    if (!gasUrl) return;
    var now = Date.now();
    if (gasUrl === lastWarmUpUrl && (now - lastWarmUpAt) < 240000) return;
    lastWarmUpUrl = gasUrl;
    lastWarmUpAt = now;
    try {
      var sep = gasUrl.indexOf('?') === -1 ? '?' : '&';
      fetch(gasUrl + sep + 'action=ping', {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store'
      }).catch(function () {});
    } catch (e) {}
  }

  function simpleHash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return 'H' + (h >>> 0).toString(16).padStart(8, '0');
  }

  function genId(prefix) {
    return prefix + '_' + Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase().slice(-4);
  }

  function toRiyadhParts(dateInput) {
    var ms = dateInput instanceof Date ? dateInput.getTime() : (typeof dateInput === 'number' ? dateInput : (dateInput ? Date.parse(String(dateInput)) : Date.now()));
    if (!isFinite(ms)) ms = Date.now();
    var riyadh = new Date(ms + 3 * 3600000);
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    var y = riyadh.getUTCFullYear();
    var m = p(riyadh.getUTCMonth() + 1);
    var d = p(riyadh.getUTCDate());
    var hh = p(riyadh.getUTCHours());
    var mm = p(riyadh.getUTCMinutes());
    var ss = p(riyadh.getUTCSeconds());
    return {
      date: y + '-' + m + '-' + d,
      time: hh + ':' + mm + ':' + ss,
      hhmm: hh + ':' + mm,
      iso: new Date(ms).toISOString()
    };
  }

  function todayIso(offsetDays) {
    var targetMs = Date.now() + (offsetDays || 0) * 86400000;
    if (root.RGCrmCore && typeof root.RGCrmCore.getRiyadhTodayDateStr === 'function') {
      return root.RGCrmCore.getRiyadhTodayDateStr(targetMs);
    }
    return toRiyadhParts(targetMs).date;
  }

  function localOffsetDateTime(hoursOffset) {
    var rp = toRiyadhParts(Date.now() + (Number(hoursOffset || 0) * 3600000));
    return {
      date: rp.date,
      time: rp.hhmm,
      iso: rp.iso
    };
  }

  function seedSandboxDb() {
    var t0 = todayIso(0);
    var t1 = todayIso(-1);
    var t2 = todayIso(-2);
    var t5 = todayIso(-5);
    var closedRecent = localOffsetDateTime(-2);
    var expPlus4h = localOffsetDateTime(4);
    var expPlus16h = localOffsetDateTime(16);
    var expMinus2h = localOffsetDateTime(-2);
    var startMinus2d = localOffsetDateTime(-44);
    var startMinus3d = localOffsetDateTime(-68);

    var employees = [
      {
        id: 'EMP_DEV',
        name: 'المبرمج - مسؤول الموقع',
        username: 'developer',
        salt: 'S_DEV',
        passwordHash: simpleHash('S_DEV:Dev@123'),
        phone: '0500000009',
        email: 'dev@rentalgate.net',
        jobTitle: 'مبرمج ومسؤول إعدادات الموقع',
        role: 'developer',
        permissions: ['all'],
        status: 'active',
        lastActivity: new Date().toISOString(),
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'EMP_ADMIN',
        name: 'فهد الدوسري',
        username: 'admin',
        salt: 'S_ADMIN',
        passwordHash: simpleHash('S_ADMIN:Admin@123'),
        phone: '0501122334',
        email: 'admin@rentalgate.net',
        jobTitle: 'المدير العام',
        role: 'general_manager',
        permissions: ['all'],
        status: 'active',
        lastActivity: new Date().toISOString(),
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'EMP_SUP1',
        name: 'سارة العتيبي',
        username: 'supervisor',
        salt: 'S_SUP1',
        passwordHash: simpleHash('S_SUP1:Super@123'),
        phone: '0554433221',
        email: 'sara@rentalgate.net',
        jobTitle: 'مشرفة خدمة العملاء',
        role: 'supervisor',
        permissions: ['supervisor'],
        status: 'active',
        lastActivity: t0 + 'T09:40:00.000Z',
        createdAt: '2026-10-05T08:00:00.000Z',
        updatedAt: t0 + 'T09:40:00.000Z'
      },
      {
        id: 'EMP_AG1',
        name: 'خالد الحربي',
        username: 'agent1',
        salt: 'S_AG1',
        passwordHash: simpleHash('S_AG1:Agent@123'),
        phone: '0549988776',
        email: 'khalid@rentalgate.net',
        jobTitle: 'أخصائي حجوزات أول',
        role: 'agent',
        permissions: ['agent'],
        status: 'active',
        lastActivity: t0 + 'T11:15:00.000Z',
        createdAt: '2026-10-10T08:00:00.000Z',
        updatedAt: t0 + 'T11:15:00.000Z'
      },
      {
        id: 'EMP_AG2',
        name: 'نورة القحطاني',
        username: 'agent2',
        salt: 'S_AG2',
        passwordHash: simpleHash('S_AG2:Agent@123'),
        phone: '0567788990',
        email: 'noura@rentalgate.net',
        jobTitle: 'موظفة متابعة العملاء',
        role: 'agent',
        permissions: ['agent'],
        status: 'active',
        lastActivity: t1 + 'T16:20:00.000Z',
        createdAt: '2026-10-12T08:00:00.000Z',
        updatedAt: t1 + 'T16:20:00.000Z'
      }
    ];

    var reservations = [
      {
        id: 'RES_1001',
        sourceReservationId: '884101',
        reservationNumber: 'RG-2026-8841',
        sourceCreatedAt: t1 + 'T14:00:00.000Z',
        customerName: 'عبدالله بن محمد السبيعي',
        customerPhone: '0508877123',
        customerEmail: 'a.alsubaie@example.sa',
        customerIdNumber: '1084523910',
        companyName: 'ذيب لتأجير السيارات',
        branchName: 'مطار الملك خالد - الرياض',
        deliverBranchName: 'مطار الملك خالد - الرياض',
        carName: 'هيونداي سوناتا 2026',
        carCategory: 'سيدان متوسطة',
        plateNumber: 'ح د ب 4412',
        startDate: t0,
        startTime: '14:30',
        originalEndDate: todayIso(3),
        originalEndTime: '14:30',
        endDate: todayIso(6),
        endTime: '14:30',
        extendedUntilDate: todayIso(6),
        extendedUntilTime: '14:30',
        daysCount: 3,
        extendedDaysCount: 3,
        totalDaysCount: 6,
        originalStatusCode: 'confirmed',
        originalStatusAr: 'مؤكد',
        pickupTypeAr: 'توصيل للمطار',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مدفوع',
        dailyPrice: 324.64,
        discountAmount: 0,
        vatAmount: 146.09,
        baseAmount: 1120,
        extensionsCount: 2,
        extensionsAmount: 800,
        totalAmount: 1920,
        hasExtensions: true,
        internalStatus: 'تم التمديد',
        priority: 'متوسط',
        assignedEmployeeIds: ['EMP_AG1', 'EMP_AG2'],
        assignedEmployeeNames: ['خالد الحربي', 'نورة القحطاني'],
        lastUpdateText: 'تأكيد تمديد الحجز مرتين (3 أيام إضافية) وسداد 800 ر.س',
        lastUpdatedById: 'EMP_AG1',
        lastUpdatedByName: 'خالد الحربي',
        lastUpdatedAt: t0 + 'T11:15:00.000Z',
        hasProblem: false,
        createdAt: t1 + 'T14:00:00.000Z',
        updatedAt: t0 + 'T11:15:00.000Z'
      },
      {
        id: 'RES_1002',
        sourceReservationId: '884201',
        reservationNumber: 'RG-2026-8842',
        sourceCreatedAt: t0 + 'T08:10:00.000Z',
        customerName: 'سلطان عبدالعزيز الغامدي',
        customerPhone: '0551239874',
        customerEmail: 's.alghamdi@example.sa',
        customerIdNumber: '1067231845',
        companyName: 'بدجت السعودية',
        branchName: 'حي العليا - الرياض',
        deliverBranchName: 'حي العليا - الرياض',
        carName: 'تويوتا كامري GLE 2026',
        carCategory: 'سيدان عائلية',
        plateNumber: 'س م ن 9011',
        startDate: t0,
        startTime: '10:00',
        originalEndDate: todayIso(3),
        originalEndTime: '10:00',
        endDate: todayIso(3),
        endTime: '10:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 3,
        extendedDaysCount: 0,
        totalDaysCount: 3,
        originalStatusCode: 'delivered',
        originalStatusAr: 'تم التسليم',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'Apple Pay',
        paymentStatus: 'مدفوع',
        dailyPrice: 243.48,
        discountAmount: 0,
        vatAmount: 109.57,
        baseAmount: 840,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 840,
        hasExtensions: false,
        internalStatus: 'تم التسليم',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'تم تسليم المركبة للعميل وفحص العداد',
        lastUpdatedById: 'EMP_AG1',
        lastUpdatedByName: 'خالد الحربي',
        lastUpdatedAt: t0 + 'T10:05:00.000Z',
        hasProblem: false,
        createdAt: t0 + 'T08:10:00.000Z',
        updatedAt: t0 + 'T10:05:00.000Z'
      },
      {
        id: 'RES_1003',
        sourceReservationId: '884301',
        reservationNumber: 'RG-2026-8843',
        sourceCreatedAt: t1 + 'T16:30:00.000Z',
        customerName: 'ماجد ناصر الشهري',
        customerPhone: '0534455661',
        customerEmail: 'm.alshehri@example.sa',
        customerIdNumber: '1091234512',
        companyName: 'يلو (الوفاق)',
        branchName: 'مطار الملك عبدالعزيز - جدة',
        deliverBranchName: 'جدة - طريق المدينة',
        carName: 'كيا K5 2026',
        carCategory: 'سيدان متوسطة',
        plateNumber: 'أ ب ج 7120',
        startDate: t1,
        startTime: '18:00',
        originalEndDate: todayIso(2),
        originalEndTime: '18:00',
        endDate: todayIso(2),
        endTime: '18:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 3,
        extendedDaysCount: 0,
        totalDaysCount: 3,
        originalStatusCode: 'pending',
        originalStatusAr: 'قيد الانتظار',
        pickupTypeAr: 'توصيل للمطار',
        returnTypeAr: 'استلام من موقع العميل',
        paymentMethod: 'بطاقة ائتمانية',
        paymentStatus: 'مدفوع',
        dailyPrice: 278.26,
        discountAmount: 0,
        vatAmount: 125.22,
        baseAmount: 960,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 960,
        hasExtensions: false,
        internalStatus: 'تم الإنشاء',
        priority: 'مرتفع',
        assignedEmployeeIds: ['EMP_AG2'],
        assignedEmployeeNames: ['نورة القحطاني'],
        lastUpdateText: 'تأخر تأكيد الفرع على جاهزية السيارة',
        lastUpdatedById: 'EMP_SUP1',
        lastUpdatedByName: 'سارة العتيبي',
        lastUpdatedAt: t0 + 'T09:40:00.000Z',
        hasProblem: true,
        createdAt: t1 + 'T16:30:00.000Z',
        updatedAt: t0 + 'T09:40:00.000Z'
      },
      {
        id: 'RES_1004',
        sourceReservationId: '884401',
        reservationNumber: 'RG-2026-8844',
        sourceCreatedAt: t2 + 'T11:00:00.000Z',
        customerName: 'ريم فهد المالكي',
        customerPhone: '0592211445',
        customerEmail: 'r.almalki@example.sa',
        customerIdNumber: '1055612908',
        companyName: 'مفتاح لتأجير السيارات',
        branchName: 'الخبر - الكورنيش',
        deliverBranchName: 'الخبر - الكورنيش',
        carName: 'مازدا 6 2025',
        carCategory: 'سيدان عائلية',
        plateNumber: 'ط ع ق 3309',
        startDate: t2,
        startTime: '12:00',
        originalEndDate: t0,
        originalEndTime: '12:00',
        endDate: t0,
        endTime: '12:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 2,
        extendedDaysCount: 0,
        totalDaysCount: 2,
        originalStatusCode: 'completed',
        originalStatusAr: 'منتهي',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مدفوع',
        dailyPrice: 269.57,
        discountAmount: 0,
        vatAmount: 80.87,
        baseAmount: 620,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 620,
        hasExtensions: false,
        internalStatus: 'تم الاستلام',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG2'],
        assignedEmployeeNames: ['نورة القحطاني'],
        lastUpdateText: 'تم استلام السيارة وإغلاق العقد بنجاح',
        lastUpdatedById: 'EMP_AG2',
        lastUpdatedByName: 'نورة القحطاني',
        lastUpdatedAt: closedRecent.iso,
        hasProblem: false,
        createdAt: t2 + 'T11:00:00.000Z',
        updatedAt: closedRecent.iso
      },
      {
        id: 'RES_1005',
        sourceReservationId: '884501',
        reservationNumber: 'RG-2026-8845',
        sourceCreatedAt: t0 + 'T07:50:00.000Z',
        customerName: 'تركي سالم العجمي',
        customerPhone: '0543322119',
        customerEmail: 't.alajmi@example.sa',
        customerIdNumber: '',
        companyName: 'لومي لتأجير السيارات',
        branchName: 'مطار الملك فهد - الدمام',
        deliverBranchName: 'مطار الملك فهد - الدمام',
        carName: 'شيفروليه تاهو 2026',
        carCategory: 'SUV فاخرة',
        plateNumber: 'ر و ن 5580',
        startDate: t0,
        startTime: '20:00',
        originalEndDate: todayIso(5),
        originalEndTime: '20:00',
        endDate: todayIso(5),
        endTime: '20:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 5,
        extendedDaysCount: 0,
        totalDaysCount: 5,
        originalStatusCode: 'booked',
        originalStatusAr: 'تم الحجز',
        pickupTypeAr: 'توصيل للمطار',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'بطاقة ائتمانية',
        paymentStatus: 'مدفوع',
        dailyPrice: 478.26,
        discountAmount: 100,
        vatAmount: 358.7,
        baseAmount: 2750,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 2750,
        hasExtensions: false,
        internalStatus: 'تم الحجز',
        priority: 'عادي',
        assignedEmployeeIds: [],
        assignedEmployeeNames: [],
        lastUpdateText: 'بانتظار إسناد موظف للمتابعة',
        lastUpdatedById: 'EMP_ADMIN',
        lastUpdatedByName: 'فهد الدوسري',
        lastUpdatedAt: t0 + 'T07:50:00.000Z',
        hasProblem: false,
        createdAt: t0 + 'T07:50:00.000Z',
        updatedAt: t0 + 'T07:50:00.000Z'
      },
      {
        id: 'RES_1006',
        sourceReservationId: '884601',
        reservationNumber: 'RG-2026-8846',
        referenceNumber: 'RG-CAN-884601',
        sourceCreatedAt: t5 + 'T10:00:00.000Z',
        customerName: 'بندر عوض الزهراني',
        customerPhone: '0506677882',
        customerEmail: 'b.alzahrani@example.sa',
        customerIdNumber: '1039821440',
        companyName: 'بدجت السعودية',
        branchName: 'جدة - طريق المدينة',
        deliverBranchName: 'جدة - طريق المدينة',
        carName: 'نيسان إكس تريل 2026',
        carCategory: 'SUV متوسطة',
        plateNumber: 'ك ل م 1198',
        startDate: t5,
        startTime: '11:00',
        originalEndDate: t2,
        originalEndTime: '11:00',
        endDate: t2,
        endTime: '11:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 3,
        extendedDaysCount: 0,
        totalDaysCount: 3,
        originalStatusCode: 'cancelled',
        originalStatusAr: 'ملغي',
        pickupTypeAr: 'توصيل للموقع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مسترد',
        dailyPrice: 304.35,
        discountAmount: 0,
        vatAmount: 136.96,
        baseAmount: 1050,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 1050,
        hasExtensions: false,
        internalStatus: 'تم الإلغاء',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'ألغى العميل الحجز قبل الموعد بـ 24 ساعة',
        lastUpdatedById: 'EMP_AG1',
        lastUpdatedByName: 'خالد الحربي',
        lastUpdatedAt: t5 + 'T15:10:00.000Z',
        hasProblem: false,
        createdAt: t5 + 'T10:00:00.000Z',
        updatedAt: t5 + 'T15:10:00.000Z'
      },
      {
        id: 'RES_1007',
        sourceReservationId: '884701',
        reservationNumber: 'RG-2026-8847',
        sourceCreatedAt: startMinus2d.iso,
        customerName: 'فيصل عبدالعزيز المطيري',
        customerPhone: '0557788991',
        customerEmail: 'f.almutairi@example.sa',
        customerIdNumber: '1072345611',
        companyName: 'ذيب لتأجير السيارات',
        branchName: 'الرياض - حي الملقا',
        deliverBranchName: 'الرياض - حي الملقا',
        carName: 'تويوتا راف 4 2026',
        carCategory: 'SUV متوسطة',
        plateNumber: 'د هـ و 6621',
        startDate: startMinus2d.date,
        startTime: startMinus2d.time,
        originalEndDate: expPlus4h.date,
        originalEndTime: expPlus4h.time,
        endDate: expPlus4h.date,
        endTime: expPlus4h.time,
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 2,
        extendedDaysCount: 0,
        totalDaysCount: 2,
        originalStatusCode: 'delivered',
        originalStatusAr: 'تم التسليم',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مدفوع',
        dailyPrice: 310,
        discountAmount: 0,
        vatAmount: 93,
        baseAmount: 713,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 713,
        hasExtensions: false,
        internalStatus: 'تم التسليم',
        priority: 'مرتفع',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'ينتهي العقد خلال ساعات — يلزم التواصل لعرض التمديد',
        lastUpdatedById: 'EMP_AG1',
        lastUpdatedByName: 'خالد الحربي',
        lastUpdatedAt: closedRecent.iso,
        hasProblem: false,
        createdAt: startMinus2d.iso,
        updatedAt: closedRecent.iso
      },
      {
        id: 'RES_1008',
        sourceReservationId: '884801',
        reservationNumber: 'RG-2026-8848',
        sourceCreatedAt: startMinus3d.iso,
        customerName: 'سلمان راشد الدوسري',
        customerPhone: '0503344558',
        customerEmail: 's.aldossary@example.sa',
        customerIdNumber: '1066881234',
        companyName: 'بدجت السعودية',
        branchName: 'مطار الملك عبدالعزيز - جدة',
        deliverBranchName: 'مطار الملك عبدالعزيز - جدة',
        carName: 'هيونداي إلنترا 2026',
        carCategory: 'سيدان اقتصادية',
        plateNumber: 'ع س ق 2408',
        startDate: startMinus3d.date,
        startTime: startMinus3d.time,
        originalEndDate: t0,
        originalEndTime: expPlus16h.time,
        endDate: expPlus16h.date,
        endTime: expPlus16h.time,
        extendedUntilDate: expPlus16h.date,
        extendedUntilTime: expPlus16h.time,
        daysCount: 2,
        extendedDaysCount: 1,
        totalDaysCount: 3,
        originalStatusCode: 'confirmed',
        originalStatusAr: 'مؤكد',
        pickupTypeAr: 'توصيل للمطار',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'Apple Pay',
        paymentStatus: 'مدفوع',
        dailyPrice: 220,
        discountAmount: 0,
        vatAmount: 66,
        baseAmount: 506,
        extensionsCount: 1,
        extensionsAmount: 253,
        totalAmount: 759,
        hasExtensions: true,
        internalStatus: 'تم التمديد',
        priority: 'متوسط',
        assignedEmployeeIds: ['EMP_AG2'],
        assignedEmployeeNames: ['نورة القحطاني'],
        lastUpdateText: 'تم تمديد العقد يوماً إضافياً وتنتهي الفترة الممددة قريباً',
        lastUpdatedById: 'EMP_AG2',
        lastUpdatedByName: 'نورة القحطاني',
        lastUpdatedAt: closedRecent.iso,
        hasProblem: false,
        createdAt: startMinus3d.iso,
        updatedAt: closedRecent.iso
      },
      {
        id: 'RES_1009',
        sourceReservationId: '884901',
        reservationNumber: 'RG-2026-8849',
        sourceCreatedAt: startMinus2d.iso,
        customerName: 'نواف حمد القحطاني',
        customerPhone: '0541199882',
        customerEmail: 'n.alqahtani@example.sa',
        customerIdNumber: '1088990044',
        companyName: 'مفتاح لتأجير السيارات',
        branchName: 'الدمام - طريق الخليج',
        deliverBranchName: 'الدمام - طريق الخليج',
        carName: 'نيسان التيما 2026',
        carCategory: 'سيدان متوسطة',
        plateNumber: 'ل م ن 7822',
        startDate: startMinus2d.date,
        startTime: startMinus2d.time,
        originalEndDate: expMinus2h.date,
        originalEndTime: expMinus2h.time,
        endDate: expMinus2h.date,
        endTime: expMinus2h.time,
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 2,
        extendedDaysCount: 0,
        totalDaysCount: 2,
        originalStatusCode: 'pending',
        originalStatusAr: 'قيد الانتظار',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'بطاقة ائتمانية',
        paymentStatus: 'مدفوع',
        dailyPrice: 260,
        discountAmount: 0,
        vatAmount: 78,
        baseAmount: 598,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 598,
        hasExtensions: false,
        internalStatus: 'نشط الآن',
        priority: 'مرتفع',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'تجاوز وقت الانتهاء دون إغلاق أو تمديد — بانتظار التواصل العاجل',
        lastUpdatedById: 'EMP_SUP1',
        lastUpdatedByName: 'سارة العتيبي',
        lastUpdatedAt: closedRecent.iso,
        hasProblem: false,
        createdAt: startMinus2d.iso,
        updatedAt: closedRecent.iso
      },
      {
        id: 'RES_1010',
        sourceReservationId: '885001',
        reservationNumber: 'RG-2026-8850',
        referenceNumber: 'RG-DEC-885001',
        sourceCreatedAt: t2 + 'T09:00:00.000Z',
        customerName: 'سعيد عبدالله المالكي',
        customerPhone: '0509988112',
        customerEmail: 's.almalki@example.sa',
        customerIdNumber: '0098765432',
        companyName: 'بدجت السعودية',
        newCompanyName: 'يلو (الوفاق)',
        branchName: 'الرياض - الفرع الرئيسي',
        deliverBranchName: 'الرياض - الفرع الرئيسي',
        carName: 'هيونداي أكسنت 2026',
        carCategory: 'سيدان اقتصادية',
        plateNumber: 'ح م ط 9910',
        startDate: t2,
        startTime: '10:00',
        originalEndDate: t0,
        originalEndTime: '10:00',
        endDate: t0,
        endTime: '10:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 2,
        extendedDaysCount: 0,
        totalDaysCount: 2,
        originalStatusCode: 'rejected',
        originalStatusAr: 'مرفوض',
        isSourceRejected: true,
        isSourceCancelled: false,
        rejectionReason: 'عدم توفر المركبة في الفرع المطلوب',
        rejectedAt: t2 + 'T13:00:00.000Z',
        rejectedByName: 'مشرف المنصة',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مسترد',
        dailyPrice: 180,
        discountAmount: 0,
        vatAmount: 54,
        baseAmount: 414,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 414,
        hasExtensions: false,
        internalStatus: 'مرفوض',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'عدم توفر المركبة في الفرع المطلوب',
        lastUpdatedById: 'EMP_SUP1',
        lastUpdatedByName: 'سارة العتيبي',
        lastUpdatedAt: t2 + 'T13:00:00.000Z',
        hasProblem: false,
        createdAt: t2 + 'T09:00:00.000Z',
        updatedAt: t2 + 'T13:00:00.000Z'
      },
      {
        id: 'RES_1011',
        sourceReservationId: '885101',
        reservationNumber: '885101',
        referenceNumber: 'RG-CAN-885101',
        sourceCreatedAt: t1 + 'T09:30:00.000Z',
        customerName: 'فهد عبدالعزيز السالم',
        customerPhone: '0507711223',
        customerEmail: 'f.alsalem@example.sa',
        customerIdNumber: '1088776655',
        companyName: 'ذيب لتأجير السيارات',
        companyNumber: 'COMP-11',
        branchName: 'جدة - طريق المدينة',
        deliverBranchName: 'جدة - طريق المدينة',
        carName: 'تويوتا يارس 2026',
        carCategory: 'سيدان اقتصادية',
        plateNumber: 'س ل و 5101',
        startDate: t1,
        startTime: '12:00',
        originalEndDate: todayIso(2),
        originalEndTime: '12:00',
        endDate: todayIso(2),
        endTime: '12:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 3,
        extendedDaysCount: 0,
        totalDaysCount: 3,
        originalStatusCode: 'cancelled',
        originalStatusAr: 'ملغي',
        isSourceRejected: false,
        isSourceCancelled: true,
        cancellationReason: 'تغيير خطة السفر من العميل',
        cancelledAt: t1 + 'T11:45:00.000Z',
        cancelledByName: 'خالد الحربي',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'مدى (Mada)',
        paymentStatus: 'مسترد',
        dailyPrice: 170,
        discountAmount: 0,
        vatAmount: 76.5,
        baseAmount: 586.5,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 586.5,
        hasExtensions: false,
        internalStatus: 'تم الإلغاء',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG1'],
        assignedEmployeeNames: ['خالد الحربي'],
        lastUpdateText: 'تغيير خطة السفر من العميل',
        lastUpdatedById: 'EMP_AG1',
        lastUpdatedByName: 'خالد الحربي',
        lastUpdatedAt: t1 + 'T11:45:00.000Z',
        hasProblem: false,
        createdAt: t1 + 'T09:30:00.000Z',
        updatedAt: t1 + 'T11:45:00.000Z'
      },
      {
        id: 'RES_1012',
        sourceReservationId: '885201',
        reservationNumber: '885201',
        referenceNumber: '',
        sourceCreatedAt: t1 + 'T12:15:00.000Z',
        customerName: 'ماهر سعد العمري',
        customerPhone: '0552299331',
        customerEmail: 'm.alomari@example.sa',
        customerIdNumber: '1044556677',
        companyName: 'بدجت السعودية',
        companyNumber: 'COMP-12',
        newCompanyName: 'ذيب لتأجير السيارات',
        branchName: 'الرياض - الفرع الرئيسي',
        deliverBranchName: 'الرياض - الفرع الرئيسي',
        carName: 'كيا سبورتاج 2026',
        carCategory: 'SUV متوسطة',
        plateNumber: 'م س ن 5201',
        startDate: t1,
        startTime: '15:00',
        originalEndDate: todayIso(3),
        originalEndTime: '15:00',
        endDate: todayIso(3),
        endTime: '15:00',
        extendedUntilDate: '',
        extendedUntilTime: '',
        daysCount: 4,
        extendedDaysCount: 0,
        totalDaysCount: 4,
        originalStatusCode: 'rejected',
        originalStatusAr: 'مرفوض',
        isSourceRejected: true,
        isSourceCancelled: false,
        rejectionReason: 'انتهاء مهلة التأكيد من الفرع',
        rejectedAt: t1 + 'T14:10:00.000Z',
        rejectedByName: 'سارة العتيبي',
        pickupTypeAr: 'استلام من الفرع',
        returnTypeAr: 'تسليم في الفرع',
        paymentMethod: 'بطاقة ائتمانية',
        paymentStatus: 'مسترد',
        dailyPrice: 290,
        discountAmount: 0,
        vatAmount: 174,
        baseAmount: 1334,
        extensionsCount: 0,
        extensionsAmount: 0,
        totalAmount: 1334,
        hasExtensions: false,
        internalStatus: 'مرفوض',
        priority: 'عادي',
        assignedEmployeeIds: ['EMP_AG2'],
        assignedEmployeeNames: ['نورة القحطاني'],
        lastUpdateText: 'انتهاء مهلة التأكيد من الفرع',
        lastUpdatedById: 'EMP_SUP1',
        lastUpdatedByName: 'سارة العتيبي',
        lastUpdatedAt: t1 + 'T14:10:00.000Z',
        hasProblem: false,
        createdAt: t1 + 'T12:15:00.000Z',
        updatedAt: t1 + 'T14:10:00.000Z'
      }
    ];

    var extensions = [
      {
        id: 'EXT_501',
        sequenceNumber: 1,
        extensionNumber: 'EXT-8841-1',
        reservationId: 'RES_1001',
        reservationNumber: 'RG-2026-8841',
        sourceReservationId: '884101',
        extensionType: 'CLIENT',
        extensionTypeAr: 'تمديد بواسطة العميل',
        statusCode: 'accepted',
        statusAr: 'مقبول',
        paymentStatus: 'paid',
        paymentMethod: 'Apple Pay',
        paymentDate: t0 + 'T10:40:00.000Z',
        extendDays: 1,
        startDate: todayIso(3),
        startTime: '14:30',
        endDate: todayIso(4),
        endTime: '14:30',
        subTotal: 243.48,
        vatAmount: 36.52,
        amount: 280,
        isAcceptedAndPaid: true,
        syncedAt: t0 + 'T09:00:00.000Z'
      },
      {
        id: 'EXT_502',
        sequenceNumber: 2,
        extensionNumber: 'EXT-8841-2',
        reservationId: 'RES_1001',
        reservationNumber: 'RG-2026-8841',
        sourceReservationId: '884101',
        extensionType: 'AUTOMATIC',
        extensionTypeAr: 'تمديد تلقائي',
        statusCode: 'automatically_extended',
        statusAr: 'تم التمديد تلقائيًا',
        paymentStatus: 'paid_by_wallet',
        paymentMethod: 'المحفظة',
        paymentDate: t0 + 'T11:12:00.000Z',
        extendDays: 2,
        startDate: todayIso(4),
        startTime: '14:30',
        endDate: todayIso(6),
        endTime: '14:30',
        subTotal: 452.17,
        vatAmount: 67.83,
        amount: 520,
        isAcceptedAndPaid: true,
        syncedAt: t0 + 'T11:15:00.000Z'
      },
      {
        id: 'EXT_503',
        sequenceNumber: 1,
        extensionNumber: 'EXT-8848-1',
        reservationId: 'RES_1008',
        reservationNumber: 'RG-2026-8848',
        sourceReservationId: '884801',
        extensionType: 'CLIENT',
        extensionTypeAr: 'تمديد بواسطة العميل',
        statusCode: 'accepted',
        statusAr: 'مقبول',
        paymentStatus: 'paid',
        paymentMethod: 'Apple Pay',
        paymentDate: closedRecent.iso,
        extendDays: 1,
        startDate: t0,
        startTime: expPlus16h.time,
        endDate: expPlus16h.date,
        endTime: expPlus16h.time,
        subTotal: 220,
        vatAmount: 33,
        amount: 253,
        isAcceptedAndPaid: true,
        syncedAt: closedRecent.iso
      }
    ];

    var assignments = [
      {
        id: 'ASN_1', reservationId: 'RES_1001', reservationNumber: 'RG-2026-8841',
        employeeId: 'EMP_AG1', employeeName: 'خالد الحربي',
        assignedById: 'EMP_SUP1', assignedByName: 'سارة العتيبي',
        roleType: 'primary', status: 'active', assignedAt: t1 + 'T15:00:00.000Z', updatedAt: t1 + 'T15:00:00.000Z'
      },
      {
        id: 'ASN_2', reservationId: 'RES_1001', reservationNumber: 'RG-2026-8841',
        employeeId: 'EMP_AG2', employeeName: 'نورة القحطاني',
        assignedById: 'EMP_SUP1', assignedByName: 'سارة العتيبي',
        roleType: 'collaborator', status: 'active', assignedAt: t0 + 'T09:10:00.000Z', updatedAt: t0 + 'T09:10:00.000Z'
      },
      {
        id: 'ASN_3', reservationId: 'RES_1002', reservationNumber: 'RG-2026-8842',
        employeeId: 'EMP_AG1', employeeName: 'خالد الحربي',
        assignedById: 'EMP_SUP1', assignedByName: 'سارة العتيبي',
        roleType: 'primary', status: 'active', assignedAt: t0 + 'T08:30:00.000Z', updatedAt: t0 + 'T08:30:00.000Z'
      },
      {
        id: 'ASN_4', reservationId: 'RES_1003', reservationNumber: 'RG-2026-8843',
        employeeId: 'EMP_AG2', employeeName: 'نورة القحطاني',
        assignedById: 'EMP_SUP1', assignedByName: 'سارة العتيبي',
        roleType: 'primary', status: 'active', assignedAt: t1 + 'T17:00:00.000Z', updatedAt: t1 + 'T17:00:00.000Z'
      },
      {
        id: 'ASN_5', reservationId: 'RES_1009', reservationNumber: 'RG-2026-8849',
        employeeId: 'EMP_AG1', employeeName: 'خالد الحربي',
        assignedById: 'EMP_SUP1', assignedByName: 'سارة العتيبي',
        roleType: 'primary', status: 'active', assignedAt: t1 + 'T12:00:00.000Z', updatedAt: t1 + 'T12:00:00.000Z'
      }
    ];

    var followUps = [
      {
        id: 'FU_101',
        reservationId: 'RES_1001',
        reservationNumber: 'RG-2026-8841',
        customerName: 'عبدالله بن محمد السبيعي',
        employeeId: 'EMP_AG1',
        employeeName: 'خالد الحربي',
        status: 'تم الحجز',
        action: 'التواصل مع العميل وتأكيد موعد الوصول للمطار',
        notes: 'الرحلة تصل الساعة 4:30 عصرًا',
        followUpDate: t1,
        followUpTime: '15:20:00',
        createdAt: t1 + 'T15:20:00.000Z'
      },
      {
        id: 'FU_102',
        reservationId: 'RES_1001',
        reservationNumber: 'RG-2026-8841',
        customerName: 'عبدالله بن محمد السبيعي',
        employeeId: 'EMP_AG2',
        employeeName: 'نورة القحطاني',
        status: 'تم التمديد',
        action: 'إصدار رابط سداد التمديد ومتابعة التأكيد',
        notes: 'تم الدفع بنجاح وتحديث عقد الإيجار — للمتابعة @خالد الحربي',
        followUpDate: t0,
        followUpTime: '11:15:00',
        createdAt: t0 + 'T11:15:00.000Z'
      },
      {
        id: 'FU_103',
        reservationId: 'RES_1002',
        reservationNumber: 'RG-2026-8842',
        customerName: 'سلطان عبدالعزيز الغامدي',
        employeeId: 'EMP_AG1',
        employeeName: 'خالد الحربي',
        status: 'تم التسليم',
        action: 'تأكيد استلام العميل للمركبة من فرع العليا',
        notes: 'العميل راضٍ عن حالة المركبة',
        followUpDate: t0,
        followUpTime: '10:05:00',
        createdAt: t0 + 'T10:05:00.000Z'
      }
    ];

    var problems = [
      {
        id: 'PRB_201',
        problemNumber: 'PRB-884301',
        reservationId: 'RES_1003',
        reservationNumber: 'RG-2026-8843',
        customerName: 'ماجد ناصر الشهري',
        createdById: 'EMP_AG2',
        createdByName: 'نورة القحطاني',
        assignedEmployeeIds: ['EMP_AG2', 'EMP_SUP1'],
        assignedEmployeeNames: ['نورة القحطاني', 'سارة العتيبي'],
        description: 'السيارة المطلوبة غير متوفرة في مطار جدة حاليًا والفرع يقترح ترقية بديلة.',
        priority: 'مرتفع',
        status: 'بانتظار الشركة',
        createdAt: t0 + 'T09:15:00.000Z',
        updatedAt: t0 + 'T09:40:00.000Z'
      }
    ];

    var problemUpdates = [
      {
        id: 'PRBU_1',
        problemId: 'PRB_201',
        reservationNumber: 'RG-2026-8843',
        employeeId: 'EMP_AG2',
        employeeName: 'نورة القحطاني',
        previousStatus: '',
        newStatus: 'جديدة',
        previousPriority: '',
        newPriority: 'مرتفع',
        note: 'تم تصعيد المشكلة للفرع والمشرفة لتوفير سيارة بديلة قبل وصول الرحلة',
        createdAt: t0 + 'T09:15:00.000Z'
      },
      {
        id: 'PRBU_2',
        problemId: 'PRB_201',
        reservationNumber: 'RG-2026-8843',
        employeeId: 'EMP_SUP1',
        employeeName: 'سارة العتيبي',
        previousStatus: 'جديدة',
        newStatus: 'بانتظار الشركة',
        previousPriority: 'مرتفع',
        newPriority: 'مرتفع',
        note: 'تم التواصل مع مشرف تشغيل يلو في مطار جدة لاعتماد الترقية دون رسوم إضافية',
        createdAt: t0 + 'T09:40:00.000Z'
      }
    ];

    var activityLog = [
      {
        id: 'ACT_1', userId: 'EMP_ADMIN', userName: 'فهد الدوسري', userRole: 'general_manager',
        actionType: 'سحب بيانات', entityType: 'Sync', entityId: 'SYNC_1',
        details: 'مزامنة الحجوزات والتمديدات من Rental Gate API (6 حجوزات، 2 تمديد)',
        logDate: t0, logTime: '09:00:00', createdAt: t0 + 'T09:00:00.000Z'
      },
      {
        id: 'ACT_2', userId: 'EMP_SUP1', userName: 'سارة العتيبي', userRole: 'supervisor',
        actionType: 'إسناد حجز', entityType: 'Reservation', entityId: 'RG-2026-8841',
        details: 'إسناد إلى: خالد الحربي، نورة القحطاني',
        logDate: t0, logTime: '09:10:00', createdAt: t0 + 'T09:10:00.000Z'
      },
      {
        id: 'ACT_3', userId: 'EMP_AG2', userName: 'نورة القحطاني', userRole: 'agent',
        actionType: 'إنشاء مشكلة', entityType: 'Problem', entityId: 'PRB-884301',
        details: 'حجز RG-2026-8843 | الأولوية: مرتفع',
        logDate: t0, logTime: '09:15:00', createdAt: t0 + 'T09:15:00.000Z'
      }
    ];

    var notifications = [
      {
        id: 'NTF_1',
        recipientEmployeeId: 'EMP_SUP1',
        recipientRole: 'supervisor',
        type: 'high_priority_problem',
        title: 'تنبيه: مشكلة بأولوية مرتفعة',
        message: 'مشكلة مرتفعة الأولوية للحجز RG-2026-8843 (ماجد ناصر الشهري)',
        entityType: 'Problem',
        entityId: 'PRB_201',
        isRead: false,
        createdAt: t0 + 'T09:15:00.000Z'
      },
      {
        id: 'NTF_2',
        recipientEmployeeId: 'EMP_ADMIN',
        recipientRole: 'general_manager',
        type: 'high_priority_problem',
        title: 'تنبيه: مشكلة بأولوية مرتفعة',
        message: 'مشكلة مرتفعة الأولوية للحجز RG-2026-8843 (ماجد ناصر الشهري)',
        entityType: 'Problem',
        entityId: 'PRB_201',
        isRead: false,
        createdAt: t0 + 'T09:15:00.000Z'
      }
    ];

    var syncLog = [
      {
        id: 'SYNC_1',
        triggeredById: 'EMP_ADMIN',
        triggeredByName: 'فهد الدوسري',
        status: 'success',
        importedCount: 6,
        updatedCount: 0,
        extensionsCount: 2,
        pagesFetched: 1,
        errorMessage: '',
        durationMs: 640,
        startedAt: t0 + 'T09:00:00.000Z',
        finishedAt: t0 + 'T09:00:01.000Z'
      }
    ];

    var settings = {
      company_name: 'RENTAL GATE',
      excluded_statuses: ['draft', 'test', 'abandoned'],
      session_ttl_hours: 24,
      allow_agent_view_all: true,
      default_language: 'ar',
      auto_sync_enabled: true,
      auto_sync_interval_hours: 12,
      auto_sync_interval_minutes: 0,
      ui_simplification: (root.RGCrmCore && root.RGCrmCore.normalizeUiSimplificationSettings)
        ? root.RGCrmCore.normalizeUiSimplificationSettings({ preset: 'full' })
        : { preset: 'full', hideSecondaryCarMeta: false, hideCustomerContactExtras: false, hideFinancialBreakdown: false, hideDrawerCharts: false, hideDashboardRadar: false, hideDashboardHeatmap: false },
      handover_settings: (root.RGCrmCore && root.RGCrmCore.normalizeHandoverSettings)
        ? root.RGCrmCore.normalizeHandoverSettings({})
        : { defaultPreset: 'last_12h', defaultTimeFrom: '', defaultTimeTo: '', includeClosed: true, includePending: true, includeProblems: true, includeRadar: true, includeTodayMovements: true },
      job_role_presets: (root.RGCrmCore && root.RGCrmCore.JOB_ROLE_PRESETS) ? root.RGCrmCore.JOB_ROLE_PRESETS.slice() : [],
      permissions_catalog_custom: []
    };

    var announcements = [
      {
        id: 'ANN_SEED_1',
        title: 'تعميم الوردية',
        message: 'يرجى التأكيد على عملاء الاستلام والتسليم اليوم ومراجعة السيارات المتأخرة عن الإرجاع قبل نهاية الوردية.',
        tone: 'warning',
        isPinned: true,
        isActive: true,
        startsAt: '',
        expiresAt: '',
        createdById: 'EMP_SUP1',
        createdByName: 'سارة العتيبي',
        createdByRole: 'supervisor',
        createdAt: t0 + 'T08:00:00.000Z',
        updatedAt: t0 + 'T08:00:00.000Z'
      }
    ];

    var delegations = [];
    var locks = [];

    reservations = reservations.map(function (r) {
      var isSamplePinned = r.id === 'RES_1001';
      return Object.assign({}, r, {
        pinnedNote: isSamplePinned ? 'عميل VIP — يرجى تأكيد جاهزية المركبة وغسيلها قبل الموعد بساعة.' : '',
        pinnedNoteById: isSamplePinned ? 'EMP_SUP1' : '',
        pinnedNoteByName: isSamplePinned ? 'سارة العتيبي' : '',
        pinnedNoteUpdatedAt: isSamplePinned ? (t0 + 'T09:05:00.000Z') : '',
        noAnswerCount: r.id === 'RES_1002' ? 1 : 0,
        statusHistory: [
          {
            stageNumber: 1,
            source: 'api_pull',
            previousStatus: '',
            newStatus: r.originalStatusAr || r.internalStatus,
            sourceStatusCode: r.originalStatusCode || '',
            changedAt: r.createdAt,
            changedById: 'EMP_ADMIN',
            changedByName: 'Rental Gate API',
            note: 'تم السحب من Rental Gate بالحالة: ' + (r.originalStatusAr || r.internalStatus)
          }
        ].concat(
          (r.internalStatus && r.originalStatusAr && r.internalStatus !== r.originalStatusAr)
            ? [{
                stageNumber: 2,
                source: 'followup',
                previousStatus: r.originalStatusAr,
                newStatus: r.internalStatus,
                sourceStatusCode: r.originalStatusCode || '',
                changedAt: r.lastUpdatedAt,
                changedById: r.lastUpdatedById || 'EMP_ADMIN',
                changedByName: r.lastUpdatedByName || 'الموظف',
                note: r.lastUpdateText || ''
              }]
            : []
        )
      });
    });

    return {
      _schemaV3ExactRg: true,
      _schemaV4Ops: true,
      employees: employees,
      reservations: reservations,
      extensions: extensions,
      assignments: assignments,
      followUps: followUps,
      followUpHistory: [],
      problems: problems,
      problemUpdates: problemUpdates,
      activityLog: activityLog,
      notifications: notifications,
      syncLog: syncLog,
      announcements: announcements,
      delegations: delegations,
      locks: locks,
      settings: settings,
      sessions: []
    };
  }

  function loadSandboxDb() {
    var raw = safeStorageGet(STORAGE_DB);
    if (sandboxDbCache && raw && raw === sandboxDbRawCache) {
      return sandboxDbCache;
    }
    if (!raw) {
      var seeded = seedSandboxDb();
      saveSandboxDb(seeded);
      return sandboxDbCache;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        var freshEmpty = seedSandboxDb();
        saveSandboxDb(freshEmpty);
        return sandboxDbCache;
      }
      var defaults = seedSandboxDb();
      var dirty = false;

      if (!Array.isArray(parsed.employees) || (parsed.employees.length === 0 && !Array.isArray(parsed._deletedSeedUsernames))) {
        parsed.employees = defaults.employees;
        dirty = true;
      } else {
        var deletedSeedSet = {};
        if (Array.isArray(parsed._deletedSeedUsernames)) {
          parsed._deletedSeedUsernames.forEach(function (u) {
            if (u) deletedSeedSet[String(u).toLowerCase()] = true;
          });
        }
        defaults.employees.forEach(function (defEmp) {
          if (deletedSeedSet[String(defEmp.username || '').toLowerCase()]) {
            return;
          }
          var existingEmp = parsed.employees.find(function (e) {
            return e && String(e.username || '').toLowerCase() === defEmp.username;
          });
          if (!existingEmp) {
            parsed.employees.push(defEmp);
            dirty = true;
          } else if (!existingEmp.salt || !existingEmp.passwordHash) {
            existingEmp.salt = defEmp.salt;
            existingEmp.passwordHash = defEmp.passwordHash;
            dirty = true;
          }
        });
      }

      ['reservations', 'extensions', 'assignments', 'followUps', 'followUpHistory', 'problems', 'problemUpdates', 'activityLog', 'notifications', 'syncLog', 'announcements', 'delegations', 'locks', 'sessions'].forEach(function (k) {
        if (!Array.isArray(parsed[k])) {
          parsed[k] = defaults[k] || [];
          dirty = true;
        }
      });

      if (!parsed._schemaV4Ops && Array.isArray(parsed.reservations)) {
        var r1009Idx = parsed.reservations.findIndex(function (r) { return r && r.id === 'RES_1009'; });
        if (r1009Idx !== -1 && parsed.reservations[r1009Idx].internalStatus === 'قيد الانتظار') {
          parsed.reservations[r1009Idx].internalStatus = 'نشط الآن';
          if (!parsed.reservations[r1009Idx].assignedEmployeeIds || !parsed.reservations[r1009Idx].assignedEmployeeIds.length) {
            parsed.reservations[r1009Idx].assignedEmployeeIds = ['EMP_AG1'];
            parsed.reservations[r1009Idx].assignedEmployeeNames = ['خالد الحربي'];
          }
        }
        parsed._schemaV4Ops = true;
        dirty = true;
      }

      if (!parsed._schemaV3ExactRg) {
        var defResMap = {};
        defaults.reservations.forEach(function (dr) { defResMap[dr.id] = dr; });
        parsed.reservations = parsed.reservations.map(function (r) {
          var defR = defResMap[r.id];
          if (defR) {
            var patched = Object.assign({}, defR, r);
            if (r.id === 'RES_1001') {
              patched.startTime = defR.startTime;
              patched.originalEndDate = defR.originalEndDate;
              patched.originalEndTime = defR.originalEndTime;
              patched.endDate = defR.endDate;
              patched.endTime = defR.endTime;
              patched.extendedUntilDate = defR.extendedUntilDate;
              patched.extendedUntilTime = defR.extendedUntilTime;
              patched.daysCount = defR.daysCount;
              patched.extendedDaysCount = defR.extendedDaysCount;
              patched.totalDaysCount = defR.totalDaysCount;
              patched.extensionsCount = defR.extensionsCount;
              patched.extensionsAmount = defR.extensionsAmount;
              patched.totalAmount = Number(patched.baseAmount || 1120) + defR.extensionsAmount;
              patched.hasExtensions = true;
            }
            return patched;
          }
          return Object.assign({
            startTime: '',
            originalEndDate: r.originalEndDate || r.endDate || '',
            originalEndTime: '',
            endTime: '',
            extendedUntilDate: r.extendedUntilDate || '',
            extendedUntilTime: '',
            extendedDaysCount: Number(r.extendedDaysCount || 0),
            totalDaysCount: Number(r.totalDaysCount || r.daysCount || 1),
            extensionsCount: Number(r.extensionsCount || (r.hasExtensions ? 1 : 0))
          }, r);
        });
        defaults.extensions.forEach(function (defExt) {
          var idxExt = parsed.extensions.findIndex(function (ex) { return ex && ex.id === defExt.id; });
          if (idxExt === -1) parsed.extensions.push(defExt);
          else parsed.extensions[idxExt] = Object.assign({}, defExt, parsed.extensions[idxExt], {
            sequenceNumber: defExt.sequenceNumber,
            extensionType: defExt.extensionType,
            extensionTypeAr: defExt.extensionTypeAr,
            startTime: defExt.startTime,
            endTime: defExt.endTime,
            subTotal: defExt.subTotal,
            vatAmount: defExt.vatAmount,
            paymentMethod: defExt.paymentMethod,
            paymentDate: defExt.paymentDate,
            sourceReservationId: defExt.sourceReservationId
          });
        });
        parsed._schemaV3ExactRg = true;
        dirty = true;
      }

      if (!parsed.settings || typeof parsed.settings !== 'object') {
        parsed.settings = defaults.settings;
        dirty = true;
      } else {
        if (parsed.settings.auto_sync_enabled === undefined) { parsed.settings.auto_sync_enabled = true; dirty = true; }
        if (parsed.settings.auto_sync_interval_hours === undefined || parsed.settings.auto_sync_interval_hours === null || parsed.settings.auto_sync_interval_hours === '') {
          parsed.settings.auto_sync_interval_hours = 12;
          dirty = true;
        }
        if (parsed.settings.auto_sync_interval_minutes === undefined || parsed.settings.auto_sync_interval_minutes === null || parsed.settings.auto_sync_interval_minutes === '') {
          parsed.settings.auto_sync_interval_minutes = 0;
          dirty = true;
        }
        if (!Array.isArray(parsed.settings.job_role_presets) || parsed.settings.job_role_presets.length === 0) {
          parsed.settings.job_role_presets = defaults.settings.job_role_presets;
          dirty = true;
        }
        if (!Array.isArray(parsed.settings.permissions_catalog_custom)) {
          parsed.settings.permissions_catalog_custom = [];
          dirty = true;
        }
        if (!parsed.settings.ui_simplification || typeof parsed.settings.ui_simplification !== 'object') {
          parsed.settings.ui_simplification = defaults.settings.ui_simplification;
          dirty = true;
        }
        if (!parsed.settings.handover_settings || typeof parsed.settings.handover_settings !== 'object') {
          parsed.settings.handover_settings = defaults.settings.handover_settings;
          dirty = true;
        }
      }

      if (Array.isArray(parsed.reservations)) {
        parsed.reservations.forEach(function (resRec) {
          if (!resRec || typeof resRec !== 'object') return;
          if (resRec.pinnedNote === undefined) { resRec.pinnedNote = ''; dirty = true; }
          if (resRec.pinnedNoteById === undefined) { resRec.pinnedNoteById = ''; dirty = true; }
          if (resRec.pinnedNoteByName === undefined) { resRec.pinnedNoteByName = ''; dirty = true; }
          if (resRec.pinnedNoteUpdatedAt === undefined) { resRec.pinnedNoteUpdatedAt = ''; dirty = true; }
          if (resRec.noAnswerCount === undefined) { resRec.noAnswerCount = 0; dirty = true; }
        });
      }

      if (dirty) saveSandboxDb(parsed);
      else {
        sandboxDbCache = parsed;
        sandboxDbRawCache = raw;
      }
      return sandboxDbCache;
    } catch (e) {
      var fresh = seedSandboxDb();
      saveSandboxDb(fresh);
      return sandboxDbCache;
    }
  }

  function saveSandboxDb(db) {
    var json = JSON.stringify(db);
    sandboxDbCache = db;
    sandboxDbRawCache = json;
    safeStorageSet(STORAGE_DB, json);
  }

  function sanitizeEmp(e) {
    var core = root.RGCrmCore;
    var resolved = (core && core.resolveEffectivePermissions)
      ? core.resolveEffectivePermissions(e)
      : (e.permissions || []);
    var normOverrides = (core && core.normalizeUiOverrides)
      ? core.normalizeUiOverrides(e.uiOverrides)
      : (e.uiOverrides && typeof e.uiOverrides === 'object' ? e.uiOverrides : {});
    return {
      id: e.id,
      name: e.name,
      username: e.username,
      phone: e.phone,
      email: e.email,
      jobTitle: e.jobTitle,
      role: e.role,
      permissions: resolved,
      uiOverrides: normOverrides,
      status: e.status,
      lastActivity: e.lastActivity,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    };
  }

  function appendSandboxActivity(db, user, actionType, entityType, entityId, details, changes) {
    var rpAct = toRiyadhParts();
    db.activityLog.unshift({
      id: genId('ACT'),
      userId: user ? user.id : 'system',
      userName: user ? user.name : 'النظام',
      userRole: user ? user.role : 'system',
      actionType: actionType,
      entityType: entityType || '',
      entityId: entityId || '',
      details: details || '',
      changes: Array.isArray(changes) ? changes : [],
      logDate: rpAct.date,
      logTime: rpAct.time,
      createdAt: rpAct.iso
    });
  }

  function resolveSandboxDelegatedUser(db, emp) {
    var base = sanitizeEmp(emp);
    var core = root.RGCrmCore;
    if (core && core.applyActiveDelegationsToUser) {
      return core.applyActiveDelegationsToUser(base, db.delegations || []);
    }
    return base;
  }

  function isSandboxAnnouncementActive(item, nowMs) {
    if (!item || !item.isActive) return false;
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
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

  function pruneSandboxLocks(db) {
    var nowMs = Date.now();
    db.locks = (Array.isArray(db.locks) ? db.locks : []).filter(function (l) {
      if (!l || !l.reservationId || !l.expiresAt) return false;
      var e = Date.parse(l.expiresAt);
      return !isNaN(e) && e > nowMs;
    });
    return db.locks;
  }

  function pushSandboxNotification(db, recipientEmployeeId, recipientRole, type, title, message, entityType, entityId, eventKey) {
    var cleanEmp = String(recipientEmployeeId || '').trim();
    var cleanRole = cleanEmp ? '' : String(recipientRole || '').trim();
    var cleanEventKey = String(eventKey || '').trim();
    if (cleanEventKey && Array.isArray(db.notifications)) {
      var existsDup = db.notifications.some(function (n) {
        return n && n.eventKey === cleanEventKey &&
          String(n.recipientEmployeeId || '') === cleanEmp &&
          String(n.recipientRole || '') === cleanRole;
      });
      if (existsDup) return;
    }
    db.notifications.unshift({
      id: genId('NTF'),
      recipientEmployeeId: cleanEmp,
      recipientRole: cleanRole,
      type: type,
      title: title,
      message: message,
      entityType: entityType || '',
      entityId: entityId || '',
      eventKey: cleanEventKey,
      isRead: false,
      dismissedBy: {},
      deletedAt: '',
      deletedById: '',
      createdAt: new Date().toISOString()
    });
  }

  function dispatchSandboxMentionNotifications(db, senderUser, texts, entityType, entityId, label) {
    var core = root.RGCrmCore;
    if (!core || !core.extractMentionedEmployees) return [];
    var combined = (texts || []).map(function (t) { return String(t || '').trim(); }).filter(Boolean).join('\n');
    if (!combined || combined.indexOf('@') === -1) return [];
    var mentioned = core.extractMentionedEmployees(combined, db.employees || [], {
      excludeEmployeeId: (senderUser && senderUser.id) || ''
    });
    if (!mentioned.length) return [];
    var snippet = combined.replace(/\s+/g, ' ').trim().slice(0, 120);
    var senderName = (senderUser && senderUser.name) || 'موظف';
    var titlePrefix = entityType === 'Problem'
      ? ('إشارة لك في المشكلة ' + (label || '')).trim()
      : ('إشارة لك في الحجز ' + (label || '')).trim();
    mentioned.forEach(function (target) {
      pushSandboxNotification(
        db,
        target.id,
        '',
        'mention',
        titlePrefix + ' (@' + senderName + ')',
        senderName + ' أشار إليك: "' + snippet + '"',
        entityType,
        entityId
      );
    });
    return mentioned;
  }

  function requireSandboxSession(db, token) {
    if (!token) throw new Error('UNAUTHORIZED: جلسة غير صالحة، يرجى تسجيل الدخول.');
    var ses = null;
    for (var i = 0; i < db.sessions.length; i++) {
      if (db.sessions[i].token === token) {
        ses = db.sessions[i];
        break;
      }
    }
    if (!ses || ses.isRevoked || new Date(ses.expiresAt).getTime() <= Date.now()) {
      throw new Error('UNAUTHORIZED: انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا.');
    }
    var user = null;
    for (var j = 0; j < db.employees.length; j++) {
      if (db.employees[j].id === ses.employeeId) {
        user = db.employees[j];
        break;
      }
    }
    if (!user || user.status !== 'active') {
      throw new Error('UNAUTHORIZED: الحساب غير نشط.');
    }
    var delegatedUser = resolveSandboxDelegatedUser(db, user);
    return { token: token, employeeId: user.id, role: delegatedUser.role, user: delegatedUser };
  }

  function sandboxExecute(action, token, payload) {
    var db = loadSandboxDb();
    var core = root.RGCrmCore;
    payload = payload || {};

    if (action === 'ping') {
      return { success: true, message: 'Sandbox Mode Active', data: { mode: 'sandbox' }, error: null };
    }

    if (action === 'login') {
      var uname = (core && core.normalizeLoginUsername)
        ? core.normalizeLoginUsername(payload.username)
        : String(payload.username || '').trim().toLowerCase();
      var pwd = String(payload.password || '');
      if (!uname || !pwd) return { success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور.', data: null, error: 'VALIDATION' };

      var found = db.employees.find(function (e) { return e.username.toLowerCase() === uname; });
      if (!found) return { success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.', data: null, error: 'AUTH' };
      if (found.status !== 'active') return { success: false, message: 'هذا الحساب موقوف حاليًا.', data: null, error: 'DISABLED' };
      if (simpleHash(found.salt + ':' + pwd) !== found.passwordHash) {
        return { success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.', data: null, error: 'AUTH' };
      }

      var newToken = genId('SES');
      var ttl = Number(db.settings.session_ttl_hours || 24);
      var exp = new Date(Date.now() + ttl * 3600000).toISOString();
      var delegatedFound = resolveSandboxDelegatedUser(db, found);
      db.sessions.push({
        token: newToken,
        employeeId: found.id,
        role: delegatedFound.role,
        expiresAt: exp,
        isRevoked: false
      });
      found.lastActivity = new Date().toISOString();
      appendSandboxActivity(db, delegatedFound, 'تسجيل الدخول', 'Employee', found.id, 'تسجيل دخول ناجح للمستخدم ' + found.username);
      saveSandboxDb(db);
      var loginData = { token: newToken, expiresAt: exp, user: delegatedFound };
      if (payload.includeBootstrap !== false) {
        var bsLogin = sandboxExecute('getAppBootstrap', newToken, { range: payload.range || '30d' });
        if (bsLogin && bsLogin.success && bsLogin.data) {
          loginData.bootstrap = bsLogin.data;
        }
      }
      return { success: true, message: 'تم تسجيل الدخول بنجاح.', data: loginData, error: null };
    }

    var session;
    try {
      session = requireSandboxSession(db, token);
    } catch (authErr) {
      return { success: false, message: authErr.message, data: null, error: authErr.message };
    }

    switch (action) {
      case 'logout': {
        db.sessions.forEach(function (s) { if (s.token === token) s.isRevoked = true; });
        appendSandboxActivity(db, session.user, 'تسجيل الخروج', 'Employee', session.employeeId, 'تسجيل خروج');
        saveSandboxDb(db);
        return { success: true, message: 'تم تسجيل الخروج.', data: { loggedOut: true }, error: null };
      }
      case 'getMe': {
        var meLayout = db.settings['layout_prefs_u_' + session.employeeId];
        var meNormLayout = (core && core.normalizeUserLayoutPrefs)
          ? core.normalizeUserLayoutPrefs(meLayout)
          : { navOrder: [], hiddenRoutes: [], dashOrder: [], dashHidden: [] };
        return { success: true, message: '', data: { user: session.user, layoutPrefs: meNormLayout }, error: null };
      }

      case 'getAppBootstrap': {
        var bsDash = sandboxExecute('getDashboard', token, payload && payload.range ? payload : { range: '30d' });
        var bsNotif = sandboxExecute('getNotifications', token, {});
        var bsEmp = sandboxExecute('getEmployees', token, {});
        var bsPrb = sandboxExecute('getProblems', token, {});
        var uiSimpBoot = core && core.normalizeUiSimplificationSettings
          ? core.normalizeUiSimplificationSettings(db.settings.ui_simplification)
          : (db.settings.ui_simplification || { preset: 'full' });
        var roleUiDefaultsBoot = core && core.normalizeRoleUiDefaults
          ? core.normalizeRoleUiDefaults(db.settings.role_ui_defaults)
          : {};
        var statsControlBoot = core && core.normalizeStatsControlConfig
          ? core.normalizeStatsControlConfig(db.settings.stats_control_config)
          : { excludedFromStatsEmployeeIds: [] };
        var callShortcutsBoot = core && core.normalizeCallWrapupShortcutsConfig
          ? core.normalizeCallWrapupShortcutsConfig(db.settings.call_wrapup_shortcuts)
          : { items: (core && core.CALL_WRAPUP_OUTCOMES) || [], customized: false, updatedAt: '', updatedBy: '' };
        var rawPinnedBoot = db.settings['pinned_res_u_' + session.employeeId];
        var parsedPinnedBoot = Array.isArray(rawPinnedBoot) ? rawPinnedBoot : [];
        var rawLayoutBoot = db.settings['layout_prefs_u_' + session.employeeId];
        var layoutPrefsBoot = (core && core.normalizeUserLayoutPrefs)
          ? core.normalizeUserLayoutPrefs(rawLayoutBoot)
          : { navOrder: [], hiddenRoutes: [], dashOrder: [], dashHidden: [] };
        var handoverSettingsBoot = (core && core.normalizeHandoverSettings)
          ? core.normalizeHandoverSettings(db.settings.handover_settings)
          : (db.settings.handover_settings || {});
        var activeAnnsBoot = (db.announcements || []).filter(function (a) { return isSandboxAnnouncementActive(a); });
        var activeLocksBoot = pruneSandboxLocks(db);
        return {
          success: true,
          message: '',
          data: {
            user: session.user,
            dashboard: bsDash.success ? bsDash.data : null,
            notifications: bsNotif.success ? bsNotif.data : { items: [], unreadCount: 0 },
            employees: bsEmp.success ? bsEmp.data : { items: [], total: 0 },
            problems: bsPrb.success ? bsPrb.data : { items: [], total: 0 },
            uiSimplification: uiSimpBoot,
            roleUiDefaults: roleUiDefaultsBoot,
            statsControlConfig: statsControlBoot,
            callWrapupShortcuts: callShortcutsBoot,
            handoverSettings: handoverSettingsBoot,
            announcements: activeAnnsBoot,
            activeLocks: activeLocksBoot,
            pinnedCriticalIds: parsedPinnedBoot.slice(0, (core && core.MAX_PINNED_CRITICAL_RESERVATIONS) || 3),
            layoutPrefs: layoutPrefsBoot
          },
          error: null
        };
      }

      case 'getDashboard': {
        var rangeKey = payload.range || payload.datePreset || '30d';
        var todayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.todayDate || ''))
          ? String(payload.todayDate)
          : todayIso(0);
        var start = '';
        var end = todayStr;
        if (rangeKey === 'today') start = todayStr;
        else if (rangeKey === '7d') start = todayIso(-6);
        else if (rangeKey === '30d') start = todayIso(-29);
        else if (rangeKey === 'month') start = todayStr.substring(0, 7) + '-01';
        else if (rangeKey === 'custom') {
          start = payload.dateFrom || '';
          end = payload.dateTo || todayStr;
        }
        var dashStatsCfg = core && core.normalizeStatsControlConfig
          ? core.normalizeStatsControlConfig(db.settings.stats_control_config)
          : { excludedFromStatsEmployeeIds: [] };
        var metrics = core.computeDashboardMetrics(db.reservations, db.followUps, db.problems, db.employees, { start: start, end: end }, todayStr, { statsControlConfig: dashStatsCfg });
        var dashTodayRadar = sandboxExecute('getTodayAndRadar', token, { summaryOnly: true, todayDate: todayStr, nowMs: payload.nowMs });
        if (dashTodayRadar && dashTodayRadar.success && dashTodayRadar.data && dashTodayRadar.data.counts) {
          metrics.todayRadarCounts = dashTodayRadar.data.counts;
        }
        if (core && typeof core.computeEmployeeLeaderboard === 'function') {
          var lbResList = (db.reservations || []).filter(function (r) {
            if (!r) return false;
            var dKey = String(r.startDate || r.createdAt || '').substring(0, 10);
            if (!dKey) return true;
            if (start && dKey < start) return false;
            if (end && dKey > end) return false;
            return true;
          });
          var lbFuList = (db.followUps || []).filter(function (f) {
            if (!f) return false;
            var dKey = String(f.followUpDate || f.createdAt || '').substring(0, 10);
            if (!dKey) return true;
            if (start && dKey < start) return false;
            if (end && dKey > end) return false;
            return true;
          });
          var lbPrbList = (db.problems || []).filter(function (p) {
            if (!p) return false;
            var dKey = String(p.createdAt || '').substring(0, 10);
            if (!dKey) return true;
            if (start && dKey < start) return false;
            if (end && dKey > end) return false;
            return true;
          });
          metrics.leaderboard = core.computeEmployeeLeaderboard(db.employees, lbResList, lbFuList, lbPrbList, { limit: 10, statsControlConfig: dashStatsCfg });
        }
        return { success: true, message: '', data: metrics, error: null };
      }

      case 'getTodayAndRadar': {
        var trTodayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.todayDate || ''))
          ? String(payload.todayDate)
          : todayIso(0);
        var trNowMs = (typeof payload.nowMs === 'number' && isFinite(payload.nowMs)) ? payload.nowMs : Date.now();
        var restrictTrAgent = session.role === 'agent' && db.settings.allow_agent_view_all === false && !core.canUserPerform(session.user, 'view_all_reservations');
        var trFollowedSet = {};
        (db.followUps || []).forEach(function (f) {
          if (f && f.reservationId) trFollowedSet[f.reservationId] = true;
        });
        var trCandidates = (db.reservations || []).filter(function (r) {
          if (!r) return false;
          if (restrictTrAgent) {
            return Array.isArray(r.assignedEmployeeIds) && r.assignedEmployeeIds.indexOf(session.employeeId) !== -1;
          }
          return true;
        }).map(function (r) {
          return Object.assign({}, r, { isFollowed: Boolean(trFollowedSet[r.id]) });
        });
        var trTodaySummary = core.computeTodayMovementsSummary(trCandidates, trNowMs, {
          todayDate: trTodayStr,
          subFilter: 'all'
        });
        var trRadarSummary = core.computeExpiryRadarSummary(trCandidates, trNowMs, {
          subFilter: 'all',
          windowHours: 24,
          gracePastHours: 12
        });
        var trCounts = {
          todayTotal: Number(trTodaySummary.totalCount || 0),
          pickupCount: Number(trTodaySummary.pickupCount || 0),
          returnCount: Number(trTodaySummary.returnCount || 0),
          pendingPickupCount: Number(trTodaySummary.pendingPickupCount || 0),
          pendingReturnCount: Number(trTodaySummary.pendingReturnCount || 0),
          overdueTodayCount: Number(trTodaySummary.overdueCount || 0),
          radarTotal: Number(trRadarSummary.totalCount || 0),
          upcoming24hCount: Number(trRadarSummary.upcoming24hCount || 0),
          critical6hCount: Number(trRadarSummary.critical6hCount || 0),
          soon24hCount: Number(trRadarSummary.soon24hCount || 0),
          expiredUnclosedCount: Number(trRadarSummary.expiredUnclosedCount || 0),
          extendedInRadarCount: Number(trRadarSummary.extendedInRadarCount || 0)
        };
        if (payload.summaryOnly) {
          return {
            success: true,
            message: '',
            data: { todayDate: trTodayStr, serverTime: new Date().toISOString(), counts: trCounts },
            error: null
          };
        }
        return {
          success: true,
          message: '',
          data: {
            todayDate: trTodayStr,
            serverTime: new Date().toISOString(),
            counts: trCounts,
            todaySummary: trTodaySummary,
            radarSummary: trRadarSummary,
            items: trCandidates
          },
          error: null
        };
      }

      case 'syncLocalCache': {
        var restrictSyncAgent = session.role === 'agent' && db.settings.allow_agent_view_all === false && !core.canUserPerform(session.user, 'view_all_reservations');
        var followedLocalSet = {};
        db.followUps.forEach(function (f) {
          if (f && f.reservationId) followedLocalSet[f.reservationId] = true;
        });
        var visibleRes = db.reservations.filter(function (r) {
          if (!restrictSyncAgent) return true;
          return Array.isArray(r.assignedEmployeeIds) && r.assignedEmployeeIds.indexOf(session.employeeId) !== -1;
        }).map(function (r) {
          return Object.assign({}, r, { isFollowed: Boolean(followedLocalSet[r.id]) });
        });
        return {
          success: true,
          message: '',
          data: {
            reservations: visibleRes,
            extensions: (db.extensions || []).slice(),
            allowAgentViewAll: db.settings.allow_agent_view_all !== false,
            followUps: db.followUps.slice(0, 400),
            problems: db.problems.slice(0, 200),
            syncedAt: new Date().toISOString()
          },
          error: null
        };
      }

      case 'getReservations': {
        var companies = {};
        var branches = {};
        db.reservations.forEach(function (r) {
          if (r.companyName) companies[r.companyName] = true;
          if (r.branchName) branches[r.branchName] = true;
        });
        var resUserCtx = {
          employeeId: session.employeeId,
          role: session.role,
          user: session.user,
          allowAgentViewAll: db.settings.allow_agent_view_all
        };
        var resFilters = Object.assign({}, payload || {}, {
          lifecycle: String(((payload || {}).lifecycle) || 'active')
        });
        var filtered = core.filterReservations(db.reservations, db.followUps, resFilters, resUserCtx);
        var isCalendarModeSb = Boolean(payload && payload.calendarMode);
        var isExportModeSb = Boolean(payload && payload.exportMode);
        var calFromSb = String((payload && payload.calendarFrom) || '').slice(0, 10);
        var calToSb = String((payload && payload.calendarTo) || '').slice(0, 10);
        if (isCalendarModeSb && /^\d{4}-\d{2}-\d{2}$/.test(calFromSb) && /^\d{4}-\d{2}-\d{2}$/.test(calToSb)) {
          filtered = filtered.filter(function (r) {
            var sD = String(r.startDate || '').slice(0, 10);
            var eD = String(r.endDate || r.originalEndDate || '').slice(0, 10);
            var xD = String(r.extendedUntilDate || '').slice(0, 10);
            return (sD >= calFromSb && sD <= calToSb) ||
              (eD >= calFromSb && eD <= calToSb) ||
              (xD && xD >= calFromSb && xD <= calToSb);
          });
        }
        var page = Math.max(1, Number(resFilters.page || 1));
        var defaultPgSz = isCalendarModeSb ? 2500 : 25;
        var maxPgSz = (isCalendarModeSb || isExportModeSb) ? 2500 : 200;
        var pageSize = Math.min(maxPgSz, Math.max(1, Number(resFilters.pageSize || defaultPgSz)));
        var startIdx = (page - 1) * pageSize;
        var pagedItems = filtered.slice(startIdx, startIdx + pageSize).map(function (r) {
          if (!isCalendarModeSb) return r;
          var extsForRow = (db.extensions || []).filter(function (e) {
            return e.reservationId === r.id || e.reservationNumber === r.reservationNumber ||
              (r.sourceReservationId && String(e.sourceReservationId) === String(r.sourceReservationId));
          });
          return extsForRow.length ? Object.assign({}, r, { extensions: extsForRow }) : r;
        });
        if (core && core.redactReservationSensitiveFields) {
          pagedItems = pagedItems.map(function (r) {
            return core.redactReservationSensitiveFields(r, session.user);
          });
        }
        return {
          success: true,
          message: '',
          data: {
            items: pagedItems,
            total: filtered.length,
            page: page,
            pageSize: pageSize,
            totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
            facets: {
              companies: Object.keys(companies).sort(),
              branches: Object.keys(branches).sort()
            },
            lifecycleCounts: buildLocalLifecycleCounts(db.reservations, core, resUserCtx)
          },
          error: null
        };
      }

      case 'getReservationDetails': {
        var res = db.reservations.find(function (r) {
          return r.id === payload.reservationId || r.reservationNumber === payload.reservationNumber;
        });
        if (!res) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var resNorm = Object.assign({}, res, {
          statusHistory: core.normalizeStatusHistory ? core.normalizeStatusHistory(res.statusHistory) : (res.statusHistory || [])
        });
        var relExts = db.extensions.filter(function (e) {
          return e.reservationId === res.id || e.reservationNumber === res.reservationNumber ||
            (res.sourceReservationId && String(e.sourceReservationId) === String(res.sourceReservationId));
        }).sort(function (a, b) {
          var sa = Number(a.sequenceNumber || 0);
          var sb = Number(b.sequenceNumber || 0);
          if (sa !== sb && sa > 0 && sb > 0) return sa - sb;
          return String(a.startDate || '').localeCompare(String(b.startDate || ''));
        });
        return {
          success: true,
          message: '',
          data: {
            reservation: resNorm,
            extensions: relExts,
            assignments: db.assignments.filter(function (a) { return a.reservationId === res.id && a.status === 'active'; }),
            followUps: db.followUps.filter(function (f) { return f.reservationId === res.id; }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }),
            followUpHistory: (db.followUpHistory || []).filter(function (h) { return h.reservationId === res.id; }).sort(function (a, b) { return String(b.changedAt).localeCompare(String(a.changedAt)); }),
            problems: db.problems.filter(function (p) { return p.reservationId === res.id; }),
            problemUpdates: db.problemUpdates.filter(function (u) { return u.reservationNumber === res.reservationNumber; })
          },
          error: null
        };
      }

      case 'assignEmployees': {
        if (!core.canUserPerform(session.user, 'assign_employees')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية إسناد الحجوزات.', data: null, error: 'FORBIDDEN' };
        }
        var targetRes = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!targetRes) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };

        var prevIds = targetRes.assignedEmployeeIds || [];
        db.assignments.forEach(function (a) {
          if (a.reservationId === targetRes.id && a.status === 'active') {
            a.status = 'reassigned';
            a.updatedAt = new Date().toISOString();
          }
        });

        var nextIds = [];
        var nextNames = [];
        (payload.employeeIds || []).forEach(function (eid, idx) {
          var emp = db.employees.find(function (e) { return e.id === eid && e.status === 'active'; });
          if (emp && nextIds.indexOf(emp.id) === -1) {
            nextIds.push(emp.id);
            nextNames.push(emp.name);
            db.assignments.push({
              id: genId('ASN'),
              reservationId: targetRes.id,
              reservationNumber: targetRes.reservationNumber,
              employeeId: emp.id,
              employeeName: emp.name,
              assignedById: session.employeeId,
              assignedByName: session.user.name,
              roleType: idx === 0 ? 'primary' : 'collaborator',
              status: 'active',
              assignedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            var isReassign = prevIds.length > 0 && prevIds.indexOf(emp.id) === -1;
            pushSandboxNotification(
              db,
              emp.id,
              emp.role,
              isReassign ? 'reassignment' : 'new_assignment',
              isReassign ? 'إعادة توزيع حجز' : 'إسناد حجز جديد',
              'تم إسناد الحجز رقم ' + targetRes.reservationNumber + ' (' + targetRes.customerName + ') إليك.',
              'Reservation',
              targetRes.id
            );
          }
        });

        targetRes.assignedEmployeeIds = nextIds;
        targetRes.assignedEmployeeNames = nextNames;
        targetRes.updatedAt = new Date().toISOString();
        appendSandboxActivity(db, session.user, prevIds.length > 0 ? 'إعادة توزيع حجز' : 'إسناد حجز', 'Reservation', targetRes.reservationNumber, 'إسناد إلى: ' + (nextNames.join('، ') || 'غير مسند'));
        saveSandboxDb(db);
        return { success: true, message: 'تم تحديث إسناد الموظفين.', data: { assignedEmployeeIds: nextIds, assignedEmployeeNames: nextNames }, error: null };
      }

      case 'removeAssignment': {
        if (!core.canUserPerform(session.user, 'assign_employees')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية.', data: null, error: 'FORBIDDEN' };
        }
        var rRem = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rRem) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        db.assignments.forEach(function (a) {
          if (a.reservationId === rRem.id && a.employeeId === payload.employeeId && a.status === 'active') {
            a.status = 'removed';
            a.updatedAt = new Date().toISOString();
          }
        });
        var keptIds = [];
        var keptNames = [];
        (rRem.assignedEmployeeIds || []).forEach(function (id, idx) {
          if (id !== payload.employeeId) {
            keptIds.push(id);
            if (rRem.assignedEmployeeNames[idx]) keptNames.push(rRem.assignedEmployeeNames[idx]);
          }
        });
        rRem.assignedEmployeeIds = keptIds;
        rRem.assignedEmployeeNames = keptNames;
        appendSandboxActivity(db, session.user, 'إزالة موظف من المتابعة', 'Reservation', rRem.reservationNumber, 'إزالة موظف من المتابعة');
        saveSandboxDb(db);
        return { success: true, message: 'تمت إزالة الموظف.', data: { assignedEmployeeIds: keptIds, assignedEmployeeNames: keptNames }, error: null };
      }

      case 'claimReservation': {
        var rClm = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rClm) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var clmRes = core.claimReservationRecord(rClm, session.user);
        rClm.assignedEmployeeIds = clmRes.assignedEmployeeIds;
        rClm.assignedEmployeeNames = clmRes.assignedEmployeeNames;
        rClm.updatedAt = new Date().toISOString();
        if (clmRes.added) {
          db.assignments.push({
            id: genId('ASN'),
            reservationId: rClm.id,
            reservationNumber: rClm.reservationNumber,
            employeeId: session.employeeId,
            employeeName: session.user.name,
            assignedById: session.employeeId,
            assignedByName: session.user.name,
            roleType: rClm.assignedEmployeeIds.length === 1 ? 'primary' : 'collaborator',
            status: 'active',
            assignedAt: rClm.updatedAt,
            updatedAt: rClm.updatedAt
          });
          appendSandboxActivity(db, session.user, 'استلام حجز', 'Reservation', rClm.reservationNumber, 'استلام ذاتي بواسطة ' + session.user.name);
        }
        saveSandboxDb(db);
        return { success: true, message: 'تم استلام الحجز وإضافته لقائمتك بنجاح.', data: { assignedEmployeeIds: rClm.assignedEmployeeIds, assignedEmployeeNames: rClm.assignedEmployeeNames }, error: null };
      }

      case 'unclaimReservation': {
        var rUnc = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rUnc) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var uncRes = core.unclaimReservationRecord(rUnc, session.employeeId);
        db.assignments.forEach(function (a) {
          if (a.reservationId === rUnc.id && a.employeeId === session.employeeId && a.status === 'active') {
            a.status = 'unclaimed';
            a.updatedAt = new Date().toISOString();
          }
        });
        rUnc.assignedEmployeeIds = uncRes.assignedEmployeeIds;
        rUnc.assignedEmployeeNames = uncRes.assignedEmployeeNames;
        rUnc.updatedAt = new Date().toISOString();
        appendSandboxActivity(db, session.user, 'إلغاء استلام حجز', 'Reservation', rUnc.reservationNumber, 'إلغاء الاستلام الذاتي بواسطة ' + session.user.name);
        saveSandboxDb(db);
        return { success: true, message: 'تم إلغاء استلام الحجز من حسابك.', data: { assignedEmployeeIds: rUnc.assignedEmployeeIds, assignedEmployeeNames: rUnc.assignedEmployeeNames }, error: null };
      }

      case 'quickUpdateReservationStatus': {
        var rQst = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rQst) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        if ((core.isManualBlockedWorkflowStatus && core.isManualBlockedWorkflowStatus(payload.status)) ||
            (core.isInactiveReservation && core.isInactiveReservation(rQst))) {
          return {
            success: false,
            message: 'FORBIDDEN_MANUAL_ACTION: لا يمكن رفض أو إلغاء الحجوزات أو تعديل حالة الحجوزات غير النشطة يدوياً.',
            data: null,
            error: 'FORBIDDEN_MANUAL_ACTION'
          };
        }
        if (!payload.status || !core.isValidWorkflowStatus(payload.status)) {
          return { success: false, message: 'حالة الحجز غير صالحة.', data: null, error: 'VALIDATION' };
        }
        var nowQstRp = toRiyadhParts();
        var noteQst = String(payload.note || '').trim();
        var actionQst = 'تحديث سريع للحالة إلى: ' + payload.status;
        var prevQstStatus = rQst.internalStatus || '';
        var fuQst = {
          id: genId('FU'),
          reservationId: rQst.id,
          reservationNumber: rQst.reservationNumber,
          customerName: rQst.customerName,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          status: payload.status,
          action: actionQst,
          notes: noteQst,
          followUpDate: nowQstRp.date,
          followUpTime: nowQstRp.time,
          createdAt: nowQstRp.iso
        };
        db.followUps.unshift(fuQst);
        db.followUpHistory.unshift({
          id: genId('FUH'),
          followUpId: fuQst.id,
          reservationId: rQst.id,
          reservationNumber: rQst.reservationNumber,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          changeType: 'quick_status_update',
          previousStatus: prevQstStatus,
          newStatus: payload.status,
          previousAction: '',
          newAction: actionQst,
          previousNotes: '',
          newNotes: noteQst,
          changedAt: fuQst.createdAt
        });
        rQst.internalStatus = payload.status;
        rQst.lastUpdateText = noteQst ? (actionQst + ' — ' + noteQst) : actionQst;
        rQst.lastUpdatedById = session.employeeId;
        rQst.lastUpdatedByName = session.user.name;
        rQst.lastUpdatedAt = fuQst.createdAt;
        rQst.updatedAt = fuQst.createdAt;
        rQst.statusHistory = core.appendStatusStageEntry(rQst.statusHistory, {
          source: 'quick_status',
          previousStatus: prevQstStatus,
          newStatus: payload.status,
          changedAt: fuQst.createdAt,
          changedById: session.employeeId,
          changedByName: session.user.name,
          note: rQst.lastUpdateText
        });
        var empQst = db.employees.find(function (e) { return e.id === session.employeeId; });
        if (empQst) empQst.lastActivity = fuQst.createdAt;
        appendSandboxActivity(
          db,
          session.user,
          'تعديل حالة',
          'Reservation',
          rQst.reservationNumber,
          'تحديث مباشر إلى: ' + payload.status + (noteQst ? ' | ' + noteQst : ''),
          prevQstStatus !== payload.status
            ? [{ field: 'internalStatus', label: 'حالة المتابعة', before: prevQstStatus || '-', after: payload.status }]
            : []
        );
        dispatchSandboxMentionNotifications(db, session.user, [noteQst], 'Reservation', rQst.id, rQst.reservationNumber);
        saveSandboxDb(db);
        return { success: true, message: 'تم تحديث حالة الحجز بنجاح.', data: { reservation: rQst, followUp: fuQst }, error: null };
      }

      case 'updateReservationDetails': {
        if (!core.canUserPerform(session.user, 'edit_reservation_details')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المشرف أو المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var rEdit = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rEdit) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var beforeEditSnap = Object.assign({}, rEdit);
        var prevEditStatus = rEdit.internalStatus || '';
        [
          'customerName', 'customerPhone', 'customerEmail', 'customerIdNumber',
          'companyName', 'branchName', 'deliverBranchName', 'carName', 'carCategory',
          'plateNumber', 'startDate', 'startTime', 'originalEndDate', 'originalEndTime',
          'endDate', 'endTime', 'extendedUntilDate', 'extendedUntilTime',
          'pickupTypeAr', 'returnTypeAr', 'paymentMethod', 'paymentStatus', 'lastUpdateText'
        ].forEach(function (field) {
          if (payload[field] !== undefined) rEdit[field] = String(payload[field] || '').trim();
        });
        if (payload.daysCount !== undefined) rEdit.daysCount = Math.max(1, Number(payload.daysCount || 1));
        if (payload.extendedDaysCount !== undefined) rEdit.extendedDaysCount = Math.max(0, Number(payload.extendedDaysCount || 0));
        if (payload.totalDaysCount !== undefined) rEdit.totalDaysCount = Math.max(1, Number(payload.totalDaysCount || 1));
        else rEdit.totalDaysCount = Math.max(1, Number(rEdit.daysCount || 1) + Number(rEdit.extendedDaysCount || 0));
        if (payload.extensionsCount !== undefined) rEdit.extensionsCount = Math.max(0, Number(payload.extensionsCount || 0));
        if (payload.dailyPrice !== undefined) rEdit.dailyPrice = Number(payload.dailyPrice || 0);
        if (payload.discountAmount !== undefined) rEdit.discountAmount = Number(payload.discountAmount || 0);
        if (payload.vatAmount !== undefined) rEdit.vatAmount = Number(payload.vatAmount || 0);
        if (payload.baseAmount !== undefined) rEdit.baseAmount = Number(payload.baseAmount || 0);
        if (payload.extensionsAmount !== undefined) {
          rEdit.extensionsAmount = Number(payload.extensionsAmount || 0);
          rEdit.hasExtensions = rEdit.extensionsAmount > 0 || Number(rEdit.extensionsCount || 0) > 0;
        }
        if (payload.totalAmount !== undefined) rEdit.totalAmount = Number(payload.totalAmount || 0);
        if (payload.internalStatus && core.isValidWorkflowStatus(payload.internalStatus)) {
          rEdit.internalStatus = payload.internalStatus;
        }
        if (payload.priority && core.PROBLEM_PRIORITIES.indexOf(payload.priority) !== -1) {
          rEdit.priority = payload.priority;
        }
        var nowEditIso = new Date().toISOString();
        rEdit.lastUpdatedById = session.employeeId;
        rEdit.lastUpdatedByName = session.user.name;
        rEdit.lastUpdatedAt = nowEditIso;
        rEdit.updatedAt = nowEditIso;
        if (rEdit.internalStatus && rEdit.internalStatus !== prevEditStatus) {
          rEdit.statusHistory = core.appendStatusStageEntry(rEdit.statusHistory, {
            source: 'supervisor_edit',
            previousStatus: prevEditStatus,
            newStatus: rEdit.internalStatus,
            changedAt: nowEditIso,
            changedById: session.employeeId,
            changedByName: session.user.name,
            note: rEdit.lastUpdateText || ('تعديل الحالة إلى: ' + rEdit.internalStatus)
          });
        }
        var editDiffs = (core && core.computeAuditFieldDiffs) ? core.computeAuditFieldDiffs(beforeEditSnap, rEdit, [
          { field: 'customerName', label: 'العميل' },
          { field: 'customerPhone', label: 'الجوال' },
          { field: 'carName', label: 'السيارة' },
          { field: 'plateNumber', label: 'اللوحة' },
          { field: 'startDate', label: 'تاريخ الاستلام' },
          { field: 'startTime', label: 'وقت الاستلام' },
          { field: 'endDate', label: 'تاريخ التسليم' },
          { field: 'endTime', label: 'وقت التسليم' },
          { field: 'extendedUntilDate', label: 'التمديد لحد' },
          { field: 'internalStatus', label: 'حالة المتابعة' },
          { field: 'priority', label: 'الأولوية' },
          { field: 'totalAmount', label: 'المبلغ الإجمالي' },
          { field: 'paymentStatus', label: 'حالة الدفع' }
        ]) : [];
        appendSandboxActivity(db, session.user, 'تعديل تفاصيل الحجز', 'Reservation', rEdit.reservationNumber, 'تعديل تفاصيل الحجز بواسطة ' + session.user.name, editDiffs);
        saveSandboxDb(db);
        return { success: true, message: 'تم حفظ تعديلات تفاصيل الحجز.', data: rEdit, error: null };
      }

      case 'saveReservationPinnedNote': {
        if (!core.canUserPerform(session.user, 'pin_reservation_note') ||
            (!core.isPrivilegedRole(session.role) && session.role !== 'supervisor')) {
          return { success: false, message: 'FORBIDDEN: إضافة الملاحظة المثبتة متاحة للمبرمج والمشرف والمدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var rPinTarget = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rPinTarget) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var prevPinNote = String(rPinTarget.pinnedNote || '');
        var cleanPinNote = String(payload.note || '').trim();
        var nowPinIso = new Date().toISOString();
        rPinTarget.pinnedNote = cleanPinNote;
        rPinTarget.pinnedNoteById = cleanPinNote ? session.employeeId : '';
        rPinTarget.pinnedNoteByName = cleanPinNote ? session.user.name : '';
        rPinTarget.pinnedNoteUpdatedAt = cleanPinNote ? nowPinIso : '';
        rPinTarget.updatedAt = nowPinIso;
        appendSandboxActivity(
          db,
          session.user,
          cleanPinNote ? 'تثبيت ملاحظة على الحجز' : 'إزالة الملاحظة المثبتة',
          'Reservation',
          rPinTarget.reservationNumber,
          cleanPinNote ? cleanPinNote.slice(0, 140) : 'إزالة الملاحظة المثبتة',
          prevPinNote !== cleanPinNote
            ? [{ field: 'pinnedNote', label: 'ملاحظة المشرف', before: prevPinNote || '-', after: cleanPinNote || '(تمت الإزالة)' }]
            : []
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: cleanPinNote ? 'تم حفظ الملاحظة المثبتة على الحجز.' : 'تمت إزالة الملاحظة المثبتة.',
          data: { reservation: rPinTarget },
          error: null
        };
      }

      case 'recordNoAnswerFollowUp': {
        if (!core.canUserPerform(session.user, 'add_followup')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية تسجيل المتابعة.', data: null, error: 'FORBIDDEN' };
        }
        var rNa = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rNa) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var nextNaCount = Math.max(0, Math.floor(Number(rNa.noAnswerCount || 0))) + 1;
        var nowNaRp = toRiyadhParts();
        var nowNaIso = nowNaRp.iso;
        var naStatus = String(rNa.internalStatus || 'تم الإنشاء');
        var naAction = core.buildNoAnswerActionText(nextNaCount, 'ar');
        var naNotes = String(payload.note || payload.notes || '').trim();
        var naFu = {
          id: genId('FU'),
          reservationId: rNa.id,
          reservationNumber: rNa.reservationNumber,
          customerName: rNa.customerName,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          status: naStatus,
          action: naAction,
          notes: naNotes,
          followUpDate: nowNaRp.date,
          followUpTime: nowNaRp.time,
          createdAt: nowNaIso
        };
        db.followUps.unshift(naFu);
        db.followUpHistory.unshift({
          id: genId('FUH'),
          followUpId: naFu.id,
          reservationId: rNa.id,
          reservationNumber: rNa.reservationNumber,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          changeType: 'no_answer_attempt',
          previousStatus: naStatus,
          newStatus: naStatus,
          previousAction: '',
          newAction: naAction,
          previousNotes: '',
          newNotes: naNotes,
          changedAt: nowNaIso
        });
        rNa.noAnswerCount = nextNaCount;
        rNa.lastUpdateText = naNotes ? (naAction + ' — ' + naNotes) : naAction;
        rNa.lastUpdatedById = session.employeeId;
        rNa.lastUpdatedByName = session.user.name;
        rNa.lastUpdatedAt = nowNaIso;
        rNa.updatedAt = nowNaIso;
        rNa.isFollowed = true;
        var empNa = db.employees.find(function (e) { return e.id === session.employeeId; });
        if (empNa) empNa.lastActivity = nowNaIso;
        appendSandboxActivity(db, session.user, 'تسجيل محاولة اتصال - لم يرد', 'FollowUp', rNa.reservationNumber, rNa.lastUpdateText);
        if (naNotes) {
          dispatchSandboxMentionNotifications(db, session.user, [naNotes], 'Reservation', rNa.id, rNa.reservationNumber);
        }
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم تسجيل محاولة الاتصال (لم يرد #' + nextNaCount + ').',
          data: { reservation: rNa, followUp: naFu, noAnswerCount: nextNaCount },
          error: null
        };
      }

      case 'togglePinnedCriticalReservation': {
        var pinResId = String(payload.reservationId || '').trim();
        if (!pinResId) return { success: false, message: 'VALIDATION_ERROR: معرف الحجز مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        var rPinCrit = db.reservations.find(function (r) { return r.id === pinResId; });
        if (!rPinCrit) return { success: false, message: 'NOT_FOUND: الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var maxCriticalPins = (core && core.MAX_PINNED_CRITICAL_RESERVATIONS) || 3;
        var pinSettingKey = 'pinned_res_u_' + session.employeeId;
        var curPinArr = Array.isArray(db.settings[pinSettingKey])
          ? db.settings[pinSettingKey].map(function (x) { return String(x || '').trim(); }).filter(Boolean)
          : [];
        var alreadyPinned = curPinArr.indexOf(pinResId) !== -1;
        var shouldPinCrit = typeof payload.pin === 'boolean' ? payload.pin : (typeof payload.pinned === 'boolean' ? payload.pinned : !alreadyPinned);
        var nextPinArr;
        if (shouldPinCrit) {
          if (alreadyPinned) {
            nextPinArr = curPinArr;
          } else if (curPinArr.length >= maxCriticalPins) {
            return {
              success: false,
              message: 'VALIDATION_ERROR: الحد الأقصى لتثبيت الحجوزات الحرجة هو ' + maxCriticalPins + ' حجوزات فقط — قم بإلغاء تثبيت حجز أولاً.',
              data: null,
              error: 'VALIDATION_ERROR'
            };
          } else {
            nextPinArr = [pinResId].concat(curPinArr);
          }
        } else {
          nextPinArr = curPinArr.filter(function (id) { return id !== pinResId; });
        }
        db.settings[pinSettingKey] = nextPinArr;
        appendSandboxActivity(
          db,
          session.user,
          shouldPinCrit ? 'تثبيت حجز حرج' : 'إلغاء تثبيت حجز حرج',
          'Reservation',
          rPinCrit.reservationNumber,
          shouldPinCrit ? ('تثبيت (' + nextPinArr.length + '/' + maxCriticalPins + ')') : 'إلغاء التثبيت'
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: shouldPinCrit ? 'تم تثبيت الحجز في أعلى متابعاتي.' : 'تم إلغاء تثبيت الحجز.',
          data: { pinnedCriticalIds: nextPinArr, isPinned: shouldPinCrit },
          error: null
        };
      }

      case 'addFollowUp': {
        var rFu = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rFu) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        if (!payload.status || !core.isValidWorkflowStatus(payload.status)) {
          return { success: false, message: 'يرجى اختيار حالة متابعة صالحة.', data: null, error: 'VALIDATION' };
        }
        if (!String(payload.action || '').trim()) {
          return { success: false, message: 'يرجى كتابة الإجراء المتخذ.', data: null, error: 'VALIDATION' };
        }
        var nowFuRp = toRiyadhParts();
        var prevFuResStatus = rFu.internalStatus || '';
        var newFu = {
          id: genId('FU'),
          reservationId: rFu.id,
          reservationNumber: rFu.reservationNumber,
          customerName: rFu.customerName,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          status: payload.status,
          action: String(payload.action).trim(),
          notes: String(payload.notes || '').trim(),
          followUpDate: nowFuRp.date,
          followUpTime: nowFuRp.time,
          createdAt: nowFuRp.iso
        };
        db.followUps.unshift(newFu);
        db.followUpHistory.unshift({
          id: genId('FUH'),
          followUpId: newFu.id,
          reservationId: rFu.id,
          reservationNumber: rFu.reservationNumber,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          changeType: 'created',
          previousStatus: prevFuResStatus,
          newStatus: newFu.status,
          previousAction: '',
          newAction: newFu.action,
          previousNotes: '',
          newNotes: newFu.notes,
          changedAt: newFu.createdAt
        });
        var changedStatus = prevFuResStatus !== newFu.status;
        rFu.internalStatus = newFu.status;
        rFu.lastUpdateText = newFu.action + (newFu.notes ? ' — ' + newFu.notes : '');
        rFu.lastUpdatedById = session.employeeId;
        rFu.lastUpdatedByName = session.user.name;
        rFu.lastUpdatedAt = newFu.createdAt;
        rFu.updatedAt = newFu.createdAt;
        if (changedStatus || !Array.isArray(rFu.statusHistory) || rFu.statusHistory.length === 0) {
          rFu.statusHistory = core.appendStatusStageEntry(rFu.statusHistory, {
            source: 'followup',
            previousStatus: prevFuResStatus,
            newStatus: newFu.status,
            changedAt: newFu.createdAt,
            changedById: session.employeeId,
            changedByName: session.user.name,
            note: rFu.lastUpdateText
          });
        }

        var empSelf = db.employees.find(function (e) { return e.id === session.employeeId; });
        if (empSelf) empSelf.lastActivity = newFu.createdAt;

        appendSandboxActivity(db, session.user, changedStatus ? 'تعديل حالة' : 'إضافة متابعة', 'Reservation', rFu.reservationNumber, 'الحالة: ' + newFu.status + ' | ' + newFu.action);
        if (newFu.notes) {
          appendSandboxActivity(db, session.user, 'إضافة ملاحظة', 'Reservation', rFu.reservationNumber, newFu.notes);
        }
        (rFu.assignedEmployeeIds || []).forEach(function (eid) {
          if (eid !== session.employeeId) {
            pushSandboxNotification(
              db, eid, '', changedStatus ? 'status_change' : 'reservation_update',
              changedStatus ? 'تغيير حالة حجز' : 'تحديث متابعة على حجز مشترك',
              session.user.name + ' حدّث الحجز ' + rFu.reservationNumber + ' إلى: ' + newFu.status,
              'Reservation', rFu.id
            );
          }
        });
        dispatchSandboxMentionNotifications(db, session.user, [newFu.action, newFu.notes], 'Reservation', rFu.id, rFu.reservationNumber);
        saveSandboxDb(db);
        return { success: true, message: 'تم حفظ المتابعة بنجاح.', data: newFu, error: null };
      }

      case 'updateFollowUp': {
        var fuEdit = db.followUps.find(function (f) { return f.id === payload.followUpId; });
        if (!fuEdit) return { success: false, message: 'سجل المتابعة غير موجود.', data: null, error: 'NOT_FOUND' };
        if (fuEdit.employeeId !== session.employeeId && !core.canUserPerform(session.user, 'edit_any_followup')) {
          return { success: false, message: 'FORBIDDEN: لا يمكنك تعديل متابعة موظف آخر.', data: null, error: 'FORBIDDEN' };
        }
        if (payload.status && core.isValidWorkflowStatus(payload.status)) fuEdit.status = payload.status;
        if (payload.action && String(payload.action).trim()) fuEdit.action = String(payload.action).trim();
        if (payload.notes !== undefined) fuEdit.notes = String(payload.notes || '').trim();
        if (payload.syncToReservation) {
          var parentRes = db.reservations.find(function (r) { return r.id === fuEdit.reservationId; });
          if (parentRes) {
            var prevParentSt = parentRes.internalStatus || '';
            var nowUpdIso = new Date().toISOString();
            parentRes.internalStatus = fuEdit.status;
            parentRes.lastUpdateText = fuEdit.action + (fuEdit.notes ? ' — ' + fuEdit.notes : '');
            parentRes.lastUpdatedById = session.employeeId;
            parentRes.lastUpdatedByName = session.user.name;
            parentRes.lastUpdatedAt = nowUpdIso;
            parentRes.updatedAt = nowUpdIso;
            if (prevParentSt !== fuEdit.status) {
              parentRes.statusHistory = core.appendStatusStageEntry(parentRes.statusHistory, {
                source: 'followup',
                previousStatus: prevParentSt,
                newStatus: fuEdit.status,
                changedAt: nowUpdIso,
                changedById: session.employeeId,
                changedByName: session.user.name,
                note: parentRes.lastUpdateText
              });
            }
          }
        }
        appendSandboxActivity(db, session.user, 'تحديث متابعة', 'FollowUp', fuEdit.id, 'تعديل متابعة الحجز ' + fuEdit.reservationNumber);
        dispatchSandboxMentionNotifications(db, session.user, [fuEdit.action, fuEdit.notes], 'Reservation', fuEdit.reservationId, fuEdit.reservationNumber);
        saveSandboxDb(db);
        return { success: true, message: 'تم تعديل المتابعة بنجاح.', data: fuEdit, error: null };
      }

      case 'deleteFollowUp': {
        var delFuIdSb = String(payload.followUpId || payload.id || '').trim();
        if (!delFuIdSb) return { success: false, message: 'معرف المتابعة مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        var fuIdx = db.followUps.findIndex(function (f) { return f.id === delFuIdSb; });
        if (fuIdx === -1) return { success: false, message: 'سجل المتابعة غير موجود.', data: null, error: 'NOT_FOUND' };
        var targetFu = db.followUps[fuIdx];
        if (targetFu.employeeId !== session.employeeId && !core.canUserPerform(session.user, 'edit_any_followup')) {
          return { success: false, message: 'FORBIDDEN: لا يمكنك حذف متابعة موظف آخر.', data: null, error: 'FORBIDDEN' };
        }
        db.followUps.splice(fuIdx, 1);
        if (Array.isArray(db.followUpHistory)) {
          db.followUpHistory = db.followUpHistory.filter(function (h) { return h && h.followUpId !== delFuIdSb; });
        }
        var remResFusSb = db.followUps
          .filter(function (f) { return f && f.reservationId === targetFu.reservationId; })
          .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
        var latestRemFuSb = remResFusSb[0] || null;
        var parentResDel = db.reservations.find(function (r) { return r && r.id === targetFu.reservationId; });
        if (parentResDel) {
          var nowDelFuIso = new Date().toISOString();
          parentResDel.lastUpdateText = latestRemFuSb ? (String(latestRemFuSb.action || '') + (latestRemFuSb.notes ? (' — ' + latestRemFuSb.notes) : '')) : '';
          parentResDel.lastUpdatedById = latestRemFuSb ? latestRemFuSb.employeeId : '';
          parentResDel.lastUpdatedByName = latestRemFuSb ? latestRemFuSb.employeeName : '';
          parentResDel.lastUpdatedAt = latestRemFuSb ? latestRemFuSb.createdAt : '';
          parentResDel.updatedAt = nowDelFuIso;
          if (!core.isInactiveReservation || !core.isInactiveReservation(parentResDel)) {
            parentResDel.internalStatus = (latestRemFuSb && latestRemFuSb.status) ? latestRemFuSb.status : 'بانتظار المتابعة';
          }
        }
        appendSandboxActivity(db, session.user, 'حذف متابعة', 'FollowUp', targetFu.reservationNumber || delFuIdSb, (targetFu.employeeName || '-') + ' | ' + String(targetFu.action || '').slice(0, 80));
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حذف المتابعة بنجاح.',
          data: {
            id: delFuIdSb,
            deleted: true,
            reservationId: targetFu.reservationId || '',
            reservationNumber: targetFu.reservationNumber || '',
            remainingFollowUpsCount: remResFusSb.length,
            latestFollowUp: latestRemFuSb,
            isFollowed: remResFusSb.length > 0
          },
          error: null
        };
      }

      case 'getMyFollowUps': {
        var myMentionFus = (core && core.filterMentionFollowUps)
          ? core.filterMentionFollowUps(db.followUps, session.user, db.employees)
          : [];
        var rawUserPins = db.settings['pinned_res_u_' + session.employeeId];
        var myPinnedIds = Array.isArray(rawUserPins)
          ? rawUserPins.slice(0, (core && core.MAX_PINNED_CRITICAL_RESERVATIONS) || 3)
          : [];
        return {
          success: true,
          message: '',
          data: {
            followUps: db.followUps.filter(function (f) { return f.employeeId === session.employeeId; }),
            mentionFollowUps: myMentionFus,
            pinnedCriticalIds: myPinnedIds,
            assignedReservations: db.reservations.filter(function (r) { return (r.assignedEmployeeIds || []).indexOf(session.employeeId) !== -1; })
          },
          error: null
        };
      }

      case 'getTeamFollowUps': {
        var teamFus = (core && core.filterTeamFollowUpsList)
          ? core.filterTeamFollowUpsList(db.followUps, payload)
          : db.followUps.filter(function (f) {
              if (payload.employeeId && f.employeeId !== payload.employeeId) return false;
              if (payload.status && f.status !== payload.status) return false;
              if (payload.date && f.followUpDate !== payload.date) return false;
              return true;
            });
        return { success: true, message: '', data: { items: teamFus, total: teamFus.length }, error: null };
      }

      case 'createProblem': {
        var rPrb = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rPrb) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
        var desc = String(payload.description || '').trim();
        var prio = payload.priority || 'متوسط';
        if (!desc) return { success: false, message: 'يرجى كتابة وصف المشكلة.', data: null, error: 'VALIDATION' };

        var assignIds = (payload.assignedEmployeeIds && payload.assignedEmployeeIds.length) ? payload.assignedEmployeeIds : [session.employeeId];
        var assignNames = assignIds.map(function (id) {
          var e = db.employees.find(function (x) { return x.id === id; });
          return e ? e.name : session.user.name;
        });

        var nowPrb = new Date().toISOString();
        var newProblem = {
          id: genId('PRB'),
          problemNumber: 'PRB-' + String(Date.now()).slice(-6),
          reservationId: rPrb.id,
          reservationNumber: rPrb.reservationNumber,
          customerName: rPrb.customerName,
          createdById: session.employeeId,
          createdByName: session.user.name,
          assignedEmployeeIds: assignIds,
          assignedEmployeeNames: assignNames,
          description: desc,
          priority: prio,
          status: 'جديدة',
          createdAt: nowPrb,
          updatedAt: nowPrb
        };
        db.problems.unshift(newProblem);
        db.problemUpdates.unshift({
          id: genId('PRBU'),
          problemId: newProblem.id,
          reservationNumber: rPrb.reservationNumber,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          previousStatus: '',
          newStatus: 'جديدة',
          previousPriority: '',
          newPriority: prio,
          note: 'تم إنشاء المشكلة: ' + desc,
          createdAt: nowPrb
        });
        rPrb.hasProblem = true;
        if (prio === 'مرتفع') rPrb.priority = 'مرتفع';
        rPrb.updatedAt = nowPrb;

        appendSandboxActivity(db, session.user, 'إنشاء مشكلة', 'Problem', newProblem.problemNumber, 'حجز ' + rPrb.reservationNumber + ' | الأولوية: ' + prio);

        assignIds.forEach(function (eid) {
          if (eid !== session.employeeId) {
            pushSandboxNotification(db, eid, '', 'new_problem', 'مشكلة جديدة مسندة إليك', 'مشكلة على الحجز ' + rPrb.reservationNumber + ': ' + desc, 'Problem', newProblem.id);
          }
        });

        if (prio === 'مرتفع') {
          db.employees.forEach(function (emp) {
            if (emp.status === 'active' && (emp.role === 'supervisor' || emp.role === 'general_manager' || emp.role === 'developer')) {
              pushSandboxNotification(
                db, emp.id, emp.role, 'high_priority_problem',
                'تنبيه: مشكلة بأولوية مرتفعة',
                'تم فتح مشكلة مرتفعة الأولوية للحجز ' + rPrb.reservationNumber + ' (' + rPrb.customerName + ') بواسطة ' + session.user.name,
                'Problem', newProblem.id
              );
            }
          });
        }
        dispatchSandboxMentionNotifications(db, session.user, [desc], 'Problem', newProblem.id, newProblem.problemNumber);
        saveSandboxDb(db);
        return { success: true, message: 'تم تحويل الحجز إلى مشكلة.', data: newProblem, error: null };
      }

      case 'updateProblem': {
        var prb = db.problems.find(function (p) { return p.id === payload.problemId; });
        if (!prb) return { success: false, message: 'المشكلة غير موجودة.', data: null, error: 'NOT_FOUND' };
        var prevStatus = prb.status;
        var prevPrio = prb.priority;
        var prevDesc = prb.description;
        prb.status = payload.status || prb.status;
        prb.priority = payload.priority || prb.priority;
        if (core.canUserPerform(session.user, 'edit_ticket_details')) {
          if (payload.description !== undefined && String(payload.description).trim()) {
            prb.description = String(payload.description).trim();
          }
          if (payload.customerName !== undefined && String(payload.customerName).trim()) {
            prb.customerName = String(payload.customerName).trim();
          }
        }
        if (Array.isArray(payload.assignedEmployeeIds)) {
          prb.assignedEmployeeIds = payload.assignedEmployeeIds;
          prb.assignedEmployeeNames = payload.assignedEmployeeIds.map(function (id) {
            var e = db.employees.find(function (x) { return x.id === id; });
            return e ? e.name : '';
          }).filter(Boolean);
        }
        prb.updatedAt = new Date().toISOString();
        var defaultPrbNote = prb.status === 'مغلقة'
          ? 'تم إغلاق المشكلة'
          : (prb.description !== prevDesc ? 'تعديل بيانات التذكرة' : ('تحديث الحالة إلى ' + prb.status));
        db.problemUpdates.unshift({
          id: genId('PRBU'),
          problemId: prb.id,
          reservationNumber: prb.reservationNumber,
          employeeId: session.employeeId,
          employeeName: session.user.name,
          previousStatus: prevStatus,
          newStatus: prb.status,
          previousPriority: prevPrio,
          newPriority: prb.priority,
          note: String(payload.note || defaultPrbNote),
          createdAt: prb.updatedAt
        });
        if (prb.description !== prevDesc) {
          appendSandboxActivity(db, session.user, 'تعديل بيانات التذكرة', 'Problem', prb.problemNumber, 'تم تحديث وصف التذكرة');
        }
        if (prevPrio !== prb.priority) {
          appendSandboxActivity(db, session.user, 'تغيير أولوية', 'Problem', prb.problemNumber, 'من ' + prevPrio + ' إلى ' + prb.priority, [{ field: 'priority', label: 'الأولوية', before: prevPrio || '-', after: prb.priority }]);
        }
        if (prevStatus !== prb.status) {
          appendSandboxActivity(db, session.user, 'تعديل حالة', 'Problem', prb.problemNumber, 'من ' + prevStatus + ' إلى ' + prb.status, [{ field: 'status', label: 'حالة المشكلة', before: prevStatus || '-', after: prb.status }]);
        }
        var linkedRes = db.reservations.find(function (r) { return r.id === prb.reservationId; });
        if (linkedRes) {
          var stillOpen = db.problems.some(function (p) {
            return p.reservationId === linkedRes.id && p.status !== 'مغلقة' && p.status !== 'تم الحل';
          });
          linkedRes.hasProblem = stillOpen;
        }
        if (prb.status === 'تم الحل' && prevStatus !== 'تم الحل') {
          var resolvedRecipients = {};
          if (linkedRes && Array.isArray(linkedRes.assignedEmployeeIds)) {
            linkedRes.assignedEmployeeIds.forEach(function (eid) { if (eid) resolvedRecipients[eid] = true; });
          }
          if (Array.isArray(prb.assignedEmployeeIds)) {
            prb.assignedEmployeeIds.forEach(function (eid) { if (eid) resolvedRecipients[eid] = true; });
          }
          if (prb.createdById) resolvedRecipients[prb.createdById] = true;
          delete resolvedRecipients[session.employeeId];
          Object.keys(resolvedRecipients).forEach(function (targetEid) {
            pushSandboxNotification(
              db,
              targetEid,
              '',
              'problem_resolved',
              'تم حل مشكلة على حجز مسند إليك',
              'تم تغيير حالة المشكلة ' + prb.problemNumber + ' (الحجز ' + (prb.reservationNumber || '-') + ') إلى "تم الحل" بواسطة ' + session.user.name + '.',
              'Problem',
              prb.id
            );
          });
        }
        dispatchSandboxMentionNotifications(db, session.user, [String(payload.note || ''), prb.description !== prevDesc ? prb.description : ''], 'Problem', prb.id, prb.problemNumber);
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم تحديث التذكرة / المشكلة بنجاح.',
          data: Object.assign({}, prb, {
            updates: db.problemUpdates.filter(function (u) { return u.problemId === prb.id; })
          }),
          error: null
        };
      }

      case 'deleteProblem': {
        if (!core.canUserPerform(session.user, 'update_problem') ||
            (core.canUserUseActionButton && !core.canUserUseActionButton(session.user, 'act_close_delete_ticket'))) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية حذف التذاكر والمشكلات.', data: null, error: 'FORBIDDEN' };
        }
        var delPrbIdSb = String(payload.problemId || payload.id || '').trim();
        if (!delPrbIdSb) {
          return { success: false, message: 'معرف المشكلة مطلوب.', data: null, error: 'VALIDATION' };
        }
        var prbDel = db.problems.find(function (p) { return p.id === delPrbIdSb; });
        if (!prbDel) {
          return { success: false, message: 'المشكلة غير موجودة.', data: null, error: 'NOT_FOUND' };
        }
        db.problems = db.problems.filter(function (p) { return p.id !== delPrbIdSb; });
        db.problemUpdates = (db.problemUpdates || []).filter(function (u) { return u.problemId !== delPrbIdSb; });
        if (Array.isArray(db.notifications)) {
          var prbDelNowIso = new Date().toISOString();
          db.notifications.forEach(function (n) {
            if (n && n.entityType === 'Problem' && n.entityId === delPrbIdSb && !n.deletedAt) {
              n.deletedAt = prbDelNowIso;
              n.deletedById = session.employeeId;
            }
          });
        }
        var stillOpenDel = false;
        if (prbDel.reservationId) {
          var linkedResDel = db.reservations.find(function (r) { return r.id === prbDel.reservationId; });
          stillOpenDel = db.problems.some(function (p) {
            return p.reservationId === prbDel.reservationId && p.status !== 'مغلقة' && p.status !== 'تم الحل';
          });
          if (linkedResDel) {
            linkedResDel.hasProblem = stillOpenDel;
            linkedResDel.updatedAt = new Date().toISOString();
          }
        }
        appendSandboxActivity(
          db,
          session.user,
          'حذف مشكلة',
          'Problem',
          prbDel.problemNumber || delPrbIdSb,
          'حجز ' + (prbDel.reservationNumber || '-') + ' | ' + (prbDel.customerName || '-')
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حذف المشكلة ' + (prbDel.problemNumber || '') + ' بنجاح.',
          data: {
            id: delPrbIdSb,
            deleted: true,
            problemNumber: prbDel.problemNumber,
            reservationId: prbDel.reservationId || '',
            hasOpenProblemsOnReservation: stillOpenDel
          },
          error: null
        };
      }

      case 'getProblems': {
        var filteredPrbs = (core && core.filterProblemsList)
          ? core.filterProblemsList(db.problems, payload)
          : db.problems.filter(function (p) {
              if (payload.status && p.status !== payload.status) return false;
              if (payload.priority && p.priority !== payload.priority) return false;
              if (payload.employeeId && (p.assignedEmployeeIds || []).indexOf(payload.employeeId) === -1) return false;
              return true;
            });
        var prbList = filteredPrbs.map(function (p) {
          return Object.assign({}, p, {
            updates: db.problemUpdates.filter(function (u) { return u.problemId === p.id; })
          });
        });
        return { success: true, message: '', data: { items: prbList, total: prbList.length }, error: null };
      }

      case 'getProblemDetails': {
        var pidTarget = String(payload.problemId || payload.problemNumber || '').trim();
        var foundPrb = db.problems.find(function (p) {
          return p.id === pidTarget || p.problemNumber === pidTarget;
        });
        if (!foundPrb) {
          return { success: false, message: 'المشكلة غير موجودة.', data: null, error: 'NOT_FOUND' };
        }
        return {
          success: true,
          message: '',
          data: {
            problem: Object.assign({}, foundPrb, {
              updates: db.problemUpdates.filter(function (u) { return u.problemId === foundPrb.id; })
            })
          },
          error: null
        };
      }

      case 'getEmployees': {
        if (!core.canUserPerform(session.user, 'view_employees')) {
          var dirRows = db.employees
            .filter(function (e) { return e && String(e.status || 'active').toLowerCase() === 'active'; })
            .map(function (e) {
              return {
                id: e.id,
                name: e.name,
                username: e.username,
                role: e.role,
                jobTitle: e.jobTitle,
                status: e.status
              };
            });
          return {
            success: true,
            message: '',
            data: {
              items: dirRows,
              total: dirRows.length,
              directoryOnly: true
            },
            error: null
          };
        }
        var empRows = db.employees.map(function (e) {
          var c = sanitizeEmp(e);
          c.reservationsCount = db.reservations.filter(function (r) { return (r.assignedEmployeeIds || []).indexOf(e.id) !== -1; }).length;
          c.followUpsCount = db.followUps.filter(function (f) { return f.employeeId === e.id; }).length;
          c.problemsCount = db.problems.filter(function (p) { return (p.assignedEmployeeIds || []).indexOf(e.id) !== -1; }).length;
          return c;
        });
        return {
          success: true,
          message: '',
          data: {
            items: empRows,
            total: empRows.length,
            rolePresets: core.normalizeRolePresets(db.settings.job_role_presets),
            customPermissions: Array.isArray(db.settings.permissions_catalog_custom) ? db.settings.permissions_catalog_custom : []
          },
          error: null
        };
      }

      case 'getEmployeeDetails': {
        var targetEmpId = String(payload.employeeId || '').trim() || session.employeeId;
        if (targetEmpId !== session.employeeId && !core.canUserPerform(session.user, 'view_employees')) {
          return { success: false, message: 'FORBIDDEN: لا يمكنك استعراض ملف موظف آخر.', data: null, error: 'FORBIDDEN' };
        }
        var targetEmp = db.employees.find(function (e) { return e.id === targetEmpId; });
        if (!targetEmp) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };

        var empFollowUps = db.followUps.filter(function (f) { return f.employeeId === targetEmpId; })
          .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

        var touchedResIds = {};
        empFollowUps.forEach(function (f) { touchedResIds[f.reservationId] = true; });

        var empProblems = db.problems.filter(function (p) {
          return p.createdById === targetEmpId || (p.assignedEmployeeIds || []).indexOf(targetEmpId) !== -1;
        });

        var statusCounts = {};
        var customerSet = {};
        var empReservations = db.reservations.filter(function (r) {
          return (r.assignedEmployeeIds || []).indexOf(targetEmpId) !== -1 || touchedResIds[r.id];
        }).map(function (r) {
          customerSet[String(r.customerPhone || r.customerName || '')] = true;
          var st = r.internalStatus || 'تم الإنشاء';
          statusCounts[st] = (statusCounts[st] || 0) + 1;
          var resFus = db.followUps.filter(function (f) { return f.reservationId === r.id; })
            .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
          var myResFus = resFus.filter(function (f) { return f.employeeId === targetEmpId; });
          var resPrbs = db.problems.filter(function (p) { return p.reservationId === r.id; });
          return {
            id: r.id,
            reservationNumber: r.reservationNumber,
            customerName: r.customerName,
            customerPhone: r.customerPhone,
            companyName: r.companyName,
            branchName: r.branchName,
            carName: r.carName,
            startDate: r.startDate,
            endDate: r.endDate,
            daysCount: Number(r.daysCount || 1),
            totalAmount: Number(r.totalAmount || 0),
            originalStatusAr: r.originalStatusAr,
            internalStatus: r.internalStatus,
            priority: r.priority,
            hasProblem: Boolean(r.hasProblem),
            lastUpdateText: r.lastUpdateText,
            lastUpdatedByName: r.lastUpdatedByName,
            lastUpdatedAt: r.lastUpdatedAt,
            followUpsCount: resFus.length,
            myFollowUpsCount: myResFus.length,
            problemsCount: resPrbs.length,
            latestFollowUp: resFus.length > 0 ? resFus[0] : null
          };
        }).sort(function (a, b) { return String(b.lastUpdatedAt).localeCompare(String(a.lastUpdatedAt)); });

        return {
          success: true,
          message: '',
          data: {
            employee: sanitizeEmp(targetEmp),
            assignedReservations: empReservations,
            followUps: empFollowUps,
            problems: empProblems,
            stats: {
              uniqueCustomersCount: Object.keys(customerSet).length,
              reservationsCount: empReservations.length,
              followUpsCount: empFollowUps.length,
              problemsCount: empProblems.length,
              statusCounts: statusCounts
            }
          },
          error: null
        };
      }

      case 'createEmployee': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var normUserFn = (core && core.normalizeLoginUsername)
          ? core.normalizeLoginUsername
          : function (v) { return String(v || '').trim().toLowerCase(); };
        var normEmailFn = (core && core.normalizeEmployeeEmail)
          ? core.normalizeEmployeeEmail
          : function (v) { return String(v || '').trim().toLowerCase(); };
        var normPhoneFn = (core && core.normalizeEmployeePhone)
          ? core.normalizeEmployeePhone
          : function (v) { return String(v || '').replace(/\D/g, ''); };

        var reqKeyEmp = String(payload.clientRequestId || '').trim();
        if (reqKeyEmp && db._empIdempotency && db._empIdempotency[reqKeyEmp]) {
          var prevCachedEmp = db.employees.find(function (e) { return e.id === db._empIdempotency[reqKeyEmp]; });
          if (prevCachedEmp) {
            return { success: true, message: 'تم إنشاء حساب الموظف بنجاح.', data: sanitizeEmp(prevCachedEmp), error: null };
          }
        }

        var unameNew = normUserFn(payload.username);
        var emailNew = String(payload.email || '').trim();
        var phoneNew = String(payload.phone || '').trim();
        var emailNewNorm = normEmailFn(emailNew);
        var phoneNewNorm = normPhoneFn(phoneNew);
        var passNew = String(payload.password || '');
        var newRole = payload.role || 'agent';
        if (newRole === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: إنشاء حساب مبرمج متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (!payload.name || !unameNew || passNew.length < 6) {
          return { success: false, message: 'يرجى إدخال الاسم واسم المستخدم وكلمة مرور من 6 أحرف على الأقل.', data: null, error: 'VALIDATION' };
        }
        if (db.employees.some(function (e) { return normUserFn(e.username) === unameNew; })) {
          return { success: false, message: 'اسم المستخدم مسجل مسبقًا.', data: null, error: 'DUPLICATE' };
        }
        if (emailNewNorm && db.employees.some(function (e) { return normEmailFn(e.email) === emailNewNorm; })) {
          return { success: false, message: 'البريد الإلكتروني مسجل مسبقًا لموظف آخر.', data: null, error: 'DUPLICATE' };
        }
        if (phoneNewNorm && db.employees.some(function (e) { return normPhoneFn(e.phone) === phoneNewNorm; })) {
          return { success: false, message: 'رقم الجوال مسجل مسبقًا لموظف آخر.', data: null, error: 'DUPLICATE' };
        }
        var saltNew = genId('SLT');
        var newPerms = Array.isArray(payload.permissions) && payload.permissions.length
          ? payload.permissions.slice()
          : core.resolveEffectivePermissions(newRole);
        var newEmp = {
          id: genId('EMP'),
          name: String(payload.name).trim(),
          username: unameNew,
          salt: saltNew,
          passwordHash: simpleHash(saltNew + ':' + passNew),
          phone: phoneNew,
          email: emailNew,
          jobTitle: String(payload.jobTitle || 'موظف خدمة العملاء').trim(),
          role: newRole,
          permissions: newPerms,
          status: 'active',
          lastActivity: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.employees.push(newEmp);
        if (reqKeyEmp) {
          db._empIdempotency = db._empIdempotency || {};
          db._empIdempotency[reqKeyEmp] = newEmp.id;
        }
        if (Array.isArray(db._deletedSeedUsernames)) {
          db._deletedSeedUsernames = db._deletedSeedUsernames.filter(function (u) {
            return normUserFn(u) !== unameNew;
          });
        }
        appendSandboxActivity(db, session.user, 'إنشاء موظف', 'Employee', newEmp.id, 'إنشاء حساب للموظف: ' + newEmp.name);
        saveSandboxDb(db);
        return { success: true, message: 'تم إنشاء حساب الموظف بنجاح.', data: sanitizeEmp(newEmp), error: null };
      }

      case 'updateEmployee': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var normUserUpd = (core && core.normalizeLoginUsername)
          ? core.normalizeLoginUsername
          : function (v) { return String(v || '').trim().toLowerCase(); };
        var normEmailUpd = (core && core.normalizeEmployeeEmail)
          ? core.normalizeEmployeeEmail
          : function (v) { return String(v || '').trim().toLowerCase(); };
        var normPhoneUpd = (core && core.normalizeEmployeePhone)
          ? core.normalizeEmployeePhone
          : function (v) { return String(v || '').replace(/\D/g, ''); };

        var empEdit = db.employees.find(function (e) { return e.id === payload.employeeId; });
        if (!empEdit) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };
        if (empEdit.role === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: تعديل حساب المبرمج متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (payload.role === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: ترقية حساب إلى دور المبرمج متاحة للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        var nextUsernameSb = normUserUpd(empEdit.username) || String(empEdit.username || '').trim().toLowerCase();
        if (payload.username !== undefined) {
          var reqUsernameSb = normUserUpd(payload.username);
          if (!reqUsernameSb) {
            return { success: false, message: 'اسم المستخدم مطلوب.', data: null, error: 'VALIDATION' };
          }
          nextUsernameSb = reqUsernameSb;
        }
        var nextEmailSb = payload.email !== undefined ? String(payload.email || '').trim() : String(empEdit.email || '').trim();
        var nextPhoneSb = payload.phone !== undefined ? String(payload.phone || '').trim() : String(empEdit.phone || '').trim();
        var nextEmailNormSb = normEmailUpd(nextEmailSb);
        var nextPhoneNormSb = normPhoneUpd(nextPhoneSb);
        var otherEmpsSb = db.employees.filter(function (e) { return e.id !== empEdit.id; });
        if (otherEmpsSb.some(function (e) { return normUserUpd(e.username) === nextUsernameSb; })) {
          return { success: false, message: 'اسم المستخدم مسجل بالفعل لموظف آخر.', data: null, error: 'CONFLICT' };
        }
        if (nextEmailNormSb && otherEmpsSb.some(function (e) { return normEmailUpd(e.email) === nextEmailNormSb; })) {
          return { success: false, message: 'البريد الإلكتروني مسجل بالفعل لموظف آخر.', data: null, error: 'CONFLICT' };
        }
        if (nextPhoneNormSb && otherEmpsSb.some(function (e) { return normPhoneUpd(e.phone) === nextPhoneNormSb; })) {
          return { success: false, message: 'رقم الجوال مسجل بالفعل لموظف آخر.', data: null, error: 'CONFLICT' };
        }

        var nextRoleSb = payload.role !== undefined ? String(payload.role || empEdit.role) : empEdit.role;
        var nextStatusSb = payload.status !== undefined ? String(payload.status || empEdit.status) : empEdit.status;
        if (empEdit.status === 'active' && (nextRoleSb !== empEdit.role || nextStatusSb !== 'active')) {
          if (empEdit.role === 'developer' && otherEmpsSb.filter(function (e) { return e.role === 'developer' && e.status === 'active'; }).length < 1) {
            return { success: false, message: 'FORBIDDEN: لا يمكن إيقاف أو تغيير دور آخر حساب مبرمج نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
          if (empEdit.role === 'general_manager' && otherEmpsSb.filter(function (e) { return e.role === 'general_manager' && e.status === 'active'; }).length < 1) {
            return { success: false, message: 'FORBIDDEN: لا يمكن إيقاف أو تغيير دور آخر مدير عام نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
        }

        var beforeEmpSnap = Object.assign({}, empEdit);
        empEdit.username = nextUsernameSb;
        if (payload.name) empEdit.name = String(payload.name).trim();
        empEdit.phone = nextPhoneSb;
        empEdit.email = nextEmailSb;
        if (payload.jobTitle !== undefined) empEdit.jobTitle = String(payload.jobTitle).trim();
        empEdit.role = nextRoleSb;
        if (Array.isArray(payload.permissions)) {
          empEdit.permissions = payload.permissions.slice();
        }
        empEdit.status = nextStatusSb;
        if (empEdit.status === 'disabled') {
          db.sessions.forEach(function (s) { if (s.employeeId === empEdit.id) s.isRevoked = true; });
        }
        if (payload.newPassword && String(payload.newPassword).length >= 6) {
          var s2 = genId('SLT');
          empEdit.salt = s2;
          empEdit.passwordHash = simpleHash(s2 + ':' + payload.newPassword);
          db.sessions.forEach(function (s) {
            if (s.employeeId === empEdit.id && (empEdit.id !== session.employeeId || s.token !== token)) {
              s.isRevoked = true;
            }
          });
        }
        empEdit.updatedAt = new Date().toISOString();
        var empDiffs = (core && core.computeAuditFieldDiffs) ? core.computeAuditFieldDiffs(beforeEmpSnap, empEdit, [
          { field: 'name', label: 'الاسم' },
          { field: 'username', label: 'اسم المستخدم' },
          { field: 'jobTitle', label: 'المسمى الوظيفي' },
          { field: 'role', label: 'الدور' },
          { field: 'status', label: 'الحالة' }
        ]) : [];
        appendSandboxActivity(db, session.user, 'تحديث موظف', 'Employee', empEdit.id, 'تحديث بيانات وصلاحيات الموظف ' + empEdit.name, empDiffs);
        saveSandboxDb(db);
        return { success: true, message: 'تم تحديث بيانات الموظف.', data: sanitizeEmp(empEdit), error: null };
      }

      case 'disableEmployee': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (payload.employeeId === session.employeeId) {
          return { success: false, message: 'لا يمكنك إيقاف حسابك الحالي.', data: null, error: 'VALIDATION' };
        }
        var empDis = db.employees.find(function (e) { return e.id === payload.employeeId; });
        if (!empDis) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };
        if (empDis.role === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: إيقاف أو تشغيل حساب المبرمج متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        var targetDisStatus = payload.status === 'active' ? 'active' : 'disabled';
        if (targetDisStatus !== 'active' && empDis.status === 'active') {
          if (empDis.role === 'developer' && db.employees.filter(function (e) { return e.id !== empDis.id && e.role === 'developer' && e.status === 'active'; }).length < 1) {
            return { success: false, message: 'FORBIDDEN: لا يمكن إيقاف آخر حساب مبرمج نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
          if (empDis.role === 'general_manager' && db.employees.filter(function (e) { return e.id !== empDis.id && e.role === 'general_manager' && e.status === 'active'; }).length < 1) {
            return { success: false, message: 'FORBIDDEN: لا يمكن إيقاف آخر مدير عام نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
        }
        empDis.status = targetDisStatus;
        empDis.updatedAt = new Date().toISOString();
        if (empDis.status === 'disabled') {
          db.sessions.forEach(function (s) { if (s.employeeId === empDis.id) s.isRevoked = true; });
        }
        appendSandboxActivity(db, session.user, empDis.status === 'disabled' ? 'إيقاف نشاط موظف' : 'تشغيل نشاط موظف', 'Employee', empDis.id, empDis.name);
        saveSandboxDb(db);
        return { success: true, message: empDis.status === 'disabled' ? 'تم إيقاف نشاط الموظف بنجاح.' : 'تم تشغيل نشاط الموظف بنجاح.', data: sanitizeEmp(empDis), error: null };
      }

      case 'deleteEmployee': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var delEmpId = String(payload.employeeId || '').trim();
        if (!delEmpId) {
          return { success: false, message: 'معرف الموظف مطلوب.', data: null, error: 'VALIDATION' };
        }
        if (delEmpId === session.employeeId) {
          return { success: false, message: 'لا يمكنك حذف حسابك الشخصي أثناء تسجيل الدخول.', data: null, error: 'FORBIDDEN' };
        }
        var empDel = db.employees.find(function (e) { return e.id === delEmpId; });
        if (!empDel) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };
        if (empDel.role === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'حذف حساب المبرمج متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (empDel.role === 'developer' && empDel.status === 'active') {
          var remainingDevs = db.employees.filter(function (e) {
            return e.id !== delEmpId && e.role === 'developer' && e.status === 'active';
          });
          if (remainingDevs.length < 1) {
            return { success: false, message: 'لا يمكن حذف آخر حساب مبرمج نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
        }
        if (empDel.role === 'general_manager' && empDel.status === 'active') {
          var remainingGms = db.employees.filter(function (e) {
            return e.id !== delEmpId && e.role === 'general_manager' && e.status === 'active';
          });
          if (remainingGms.length < 1) {
            return { success: false, message: 'لا يمكن حذف آخر مدير عام نشط في النظام.', data: null, error: 'FORBIDDEN' };
          }
        }
        db.sessions.forEach(function (s) {
          if (s.employeeId === delEmpId) s.isRevoked = true;
        });
        db.employees = db.employees.filter(function (e) { return e.id !== delEmpId; });
        if (!Array.isArray(db._deletedSeedUsernames)) db._deletedSeedUsernames = [];
        var delUsername = String(empDel.username || '').toLowerCase();
        if (delUsername && db._deletedSeedUsernames.indexOf(delUsername) === -1) {
          db._deletedSeedUsernames.push(delUsername);
        }
        var scrubAssigned = function (rec) {
          if (!Array.isArray(rec.assignedEmployeeIds)) return;
          var idx = rec.assignedEmployeeIds.indexOf(delEmpId);
          if (idx === -1) return;
          var nextIds = [];
          var nextNames = [];
          for (var i = 0; i < rec.assignedEmployeeIds.length; i++) {
            if (rec.assignedEmployeeIds[i] !== delEmpId) {
              nextIds.push(rec.assignedEmployeeIds[i]);
              if (Array.isArray(rec.assignedEmployeeNames) && rec.assignedEmployeeNames[i] !== undefined) {
                nextNames.push(rec.assignedEmployeeNames[i]);
              }
            }
          }
          rec.assignedEmployeeIds = nextIds;
          rec.assignedEmployeeNames = nextNames;
        };
        (db.reservations || []).forEach(scrubAssigned);
        (db.problems || []).forEach(scrubAssigned);
        appendSandboxActivity(db, session.user, 'حذف موظف', 'Employee', delEmpId, empDel.name + ' (' + empDel.username + ')');
        saveSandboxDb(db);
        return { success: true, message: 'تم حذف الموظف بنجاح.', data: { id: delEmpId, deleted: true, name: empDel.name }, error: null };
      }

      case 'saveRolePreset': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        try {
          var resPreset = core.upsertRolePreset(db.settings.job_role_presets, payload);
          db.settings.job_role_presets = resPreset.presets;
          appendSandboxActivity(db, session.user, resPreset.isNew ? 'إضافة صلاحية جاهزة' : 'تعديل صلاحية جاهزة', 'RolePreset', resPreset.saved.id, resPreset.saved.label);
          saveSandboxDb(db);
          return {
            success: true,
            message: resPreset.isNew ? 'تمت إضافة الصلاحية الجاهزة بنجاح.' : 'تم تعديل الصلاحية الجاهزة بنجاح.',
            data: { rolePresets: resPreset.presets, savedPreset: resPreset.saved },
            error: null
          };
        } catch (errPreset) {
          return { success: false, message: errPreset.message, data: null, error: 'VALIDATION' };
        }
      }

      case 'deleteRolePreset': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        try {
          var delTargetId = payload.presetId || payload.id;
          var nextPresets = core.removeRolePreset(db.settings.job_role_presets, delTargetId);
          db.settings.job_role_presets = nextPresets;
          appendSandboxActivity(db, session.user, 'حذف صلاحية جاهزة', 'RolePreset', String(delTargetId), 'حذف قالب صلاحية جاهزة');
          saveSandboxDb(db);
          return { success: true, message: 'تم حذف الصلاحية الجاهزة.', data: { rolePresets: nextPresets }, error: null };
        } catch (errDel) {
          return { success: false, message: errDel.message, data: null, error: 'VALIDATION' };
        }
      }

      case 'resetRolePresets': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        db.settings.job_role_presets = core.JOB_ROLE_PRESETS.slice();
        appendSandboxActivity(db, session.user, 'استعادة الصلاحيات الجاهزة', 'RolePreset', 'defaults', 'استعادة القوالب الافتراضية');
        saveSandboxDb(db);
        return { success: true, message: 'تمت استعادة الصلاحيات الجاهزة الافتراضية.', data: { rolePresets: db.settings.job_role_presets }, error: null };
      }

      case 'savePermissionDefinition': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        try {
          var permRes = core.upsertPermissionDefinition(db.settings.permissions_catalog_custom, payload);
          db.settings.permissions_catalog_custom = permRes.customPermissions;
          appendSandboxActivity(db, session.user, 'تحديث الصلاحيات', 'Permission', permRes.saved.key, permRes.saved.label);
          saveSandboxDb(db);
          return {
            success: true,
            message: 'تم حفظ الصلاحية بنجاح.',
            data: { customPermissions: permRes.customPermissions, saved: permRes.saved },
            error: null
          };
        } catch (errPerm) {
          return { success: false, message: errPerm.message, data: null, error: 'VALIDATION' };
        }
      }

      case 'deletePermissionDefinition': {
        if (!core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        try {
          var delPermRes = core.removePermissionDefinition(db.settings.permissions_catalog_custom, payload.key);
          db.settings.permissions_catalog_custom = delPermRes.customPermissions;
          if (delPermRes.removedKey) {
            db.settings.job_role_presets = core.normalizeRolePresets(db.settings.job_role_presets).map(function (p) {
              return Object.assign({}, p, {
                permissions: (p.permissions || []).filter(function (k) { return k !== delPermRes.removedKey; })
              });
            });
          }
          appendSandboxActivity(db, session.user, 'حذف / إعادة ضبط صلاحية', 'Permission', String(payload.key), '');
          saveSandboxDb(db);
          return {
            success: true,
            message: delPermRes.resetBuiltIn ? 'تمت استعادة المسمى الافتراضي للصلاحية.' : 'تم حذف الصلاحية المخصصة.',
            data: {
              customPermissions: db.settings.permissions_catalog_custom,
              rolePresets: core.normalizeRolePresets(db.settings.job_role_presets)
            },
            error: null
          };
        } catch (errDelP) {
          return { success: false, message: errDelP.message, data: null, error: 'VALIDATION' };
        }
      }

      case 'getActivityLogs': {
        var logs = db.activityLog.filter(function (l) {
          if (!core.canUserPerform(session.user, 'view_all_logs') && l.userId !== session.employeeId) return false;
          if (payload.userId && l.userId !== payload.userId) return false;
          if (payload.actionType && l.actionType !== payload.actionType) return false;
          if (payload.date && l.logDate !== payload.date) return false;
          return true;
        });
        return { success: true, message: '', data: { items: logs, total: logs.length }, error: null };
      }

      case 'getNotifications': {
        var myNotifs = (db.notifications || []).filter(function (n) {
          if (!n || n.deletedAt) return false;
          if (n.dismissedBy && n.dismissedBy[session.employeeId]) return false;
          return n.recipientEmployeeId === session.employeeId ||
            (!n.recipientEmployeeId && (n.recipientRole === session.role || n.recipientRole === 'all'));
        });
        var unread = myNotifs.filter(function (n) { return !n.isRead; }).length;
        return { success: true, message: '', data: { items: myNotifs.slice(0, 60), unreadCount: unread }, error: null };
      }

      case 'markNotificationRead': {
        (db.notifications || []).forEach(function (n) {
          if (!n || n.deletedAt) return;
          if (n.dismissedBy && n.dismissedBy[session.employeeId]) return;
          var mine = n.recipientEmployeeId === session.employeeId ||
            (!n.recipientEmployeeId && (n.recipientRole === session.role || n.recipientRole === 'all'));
          if (mine && (payload.markAll || n.id === payload.notificationId)) n.isRead = true;
        });
        saveSandboxDb(db);
        return { success: true, message: '', data: { updated: true }, error: null };
      }

      case 'deleteNotification': {
        var delAllNtf = Boolean(payload && payload.deleteAll);
        var delNtfId = String((payload && (payload.notificationId || payload.id)) || '').trim();
        if (!delAllNtf && !delNtfId) {
          return { success: false, message: 'VALIDATION_ERROR: معرف الإشعار مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        }
        var delNowIso = new Date().toISOString();
        var deletedNtfIdsSb = [];
        (db.notifications || []).forEach(function (n) {
          if (!n || n.deletedAt) return;
          if (n.dismissedBy && n.dismissedBy[session.employeeId]) return;
          var isPersonal = n.recipientEmployeeId === session.employeeId;
          var isShared = !n.recipientEmployeeId && (n.recipientRole === session.role || n.recipientRole === 'all');
          if (!isPersonal && !isShared) return;
          if (!delAllNtf && n.id !== delNtfId) return;
          if (isPersonal) {
            n.deletedAt = delNowIso;
            n.deletedById = session.employeeId;
          } else {
            n.dismissedBy = n.dismissedBy || {};
            n.dismissedBy[session.employeeId] = delNowIso;
          }
          deletedNtfIdsSb.push(n.id);
        });
        saveSandboxDb(db);
        var freshNotifRes = sandboxExecute('getNotifications', token, {});
        var freshMyNotifs = (freshNotifRes && freshNotifRes.success && freshNotifRes.data && freshNotifRes.data.items) || [];
        var freshUnread = (freshNotifRes && freshNotifRes.success && freshNotifRes.data && Number(freshNotifRes.data.unreadCount || 0)) || 0;
        return {
          success: true,
          message: '',
          data: {
            deleted: true,
            deletedCount: deletedNtfIdsSb.length,
            deletedIds: deletedNtfIdsSb,
            deletedAllBefore: delAllNtf ? delNowIso : '',
            items: freshMyNotifs.slice(0, 60),
            unreadCount: freshUnread
          },
          error: null
        };
      }

      case 'saveApiToken': {
        if (!core.canAccessApi(session.user) || !core.canUserPerform(session.user, 'sync_data')) {
          return { success: false, message: 'FORBIDDEN: صلاحيات API مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        var rawTok = String((payload && (payload.token || payload.rgToken || payload.rentalToken)) || '').trim().replace(/^Bearer\s+/i, '');
        if (!rawTok || rawTok.length < 16 || /\s/.test(rawTok)) {
          return { success: false, message: 'صيغة التوكن غير صالحة. يرجى لصق التوكن كاملاً بدون مسافات.', data: null, error: 'VALIDATION' };
        }
        db.settings.sandbox_has_rg_token = true;
        appendSandboxActivity(db, session.user, 'تحديث توكن API', 'Settings', 'RG_TOKEN', 'تم التحقق من صيغة التوكن في وضع المعاينة');
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم التحقق من صيغة التوكن في وضع المعاينة المحلية. عند ربط رابط Google Apps Script /exec سيتم حفظ RG_TOKEN وRENTAL_TOKEN على الخادم تلقائيًا.',
          data: { saved: true, sandboxPreview: true, hasRgToken: true },
          error: null
        };
      }

      case 'testConnection': {
        if (!core.canAccessApi(session.user) || !core.canUserPerform(session.user, 'sync_data')) {
          return { success: false, message: 'FORBIDDEN: صلاحيات API مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        return {
          success: true,
          message: 'وضع المعاينة المحلية (Sandbox): اربط رابط Google Apps Script /exec في الإعدادات للاتصال الفعلي بـ Rental Gate API.',
          data: { connected: true, hasToken: Boolean(db.settings.sandbox_has_rg_token), mode: 'sandbox', checkedAt: new Date().toISOString() },
          error: null
        };
      }

      case 'pullReservations':
      case 'syncRentalGate': {
        var isFullSyncAction = action === 'syncRentalGate';
        if (isFullSyncAction) {
          if (!core.canAccessApi(session.user) || !core.canUserPerform(session.user, 'sync_data')) {
            return { success: false, message: 'FORBIDDEN: صلاحيات API مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
          }
        } else if (!core.canUserPerform(session.user, 'pull_reservations')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية سحب الحجوزات.', data: null, error: 'FORBIDDEN' };
        }

        var pullRange = core.resolvePullDateRange ? core.resolvePullDateRange(payload, todayIso(0)) : { preset: 'all', dateFrom: '', dateTo: '', hasCustomRange: false };
        if (pullRange.hasCustomRange && !core.isPrivilegedRole(session.role)) {
          return {
            success: false,
            message: 'FORBIDDEN: تخصيص سحب البيانات بمدة أو من تاريخ معين متاح للمبرمج والمدير العام فقط.',
            data: null,
            error: 'FORBIDDEN'
          };
        }

        var pullIdx = db.syncLog.length;
        var pullNum = 'RG-2026-' + (8850 + pullIdx);
        var pullApiId = String(885000 + pullIdx);
        var pullNames = ['ياسر عبدالرحمن التميمي', 'سلطان فهد الشهري', 'ماجد سعد الزهراني', 'تركي ناصر العتيبي'];
        var pullCars = ['فورد تورس 2026', 'تويوتا كامري 2026', 'نيسان ألتيما 2026', 'كيا K5 2026'];
        var pullStatuses = ['hold', 'confirmed', 'started', 'completed', 'pending', 'extended'];
        var chosenPullDate = pullRange.dateFrom || todayIso(0);
        var origEndDateStr = (core.shiftIsoDateDays ? core.shiftIsoDateDays(chosenPullDate, 3) : todayIso(3)) + 'T10:30:00';
        var actualEndDateStr = (core.shiftIsoDateDays ? core.shiftIsoDateDays(chosenPullDate, 5) : todayIso(5)) + 'T10:30:00';
        var basePricePull = 1350 + (pullIdx % 3) * 150;
        var pullIncomingExt = {
          id: 'EXT_PULL_' + pullIdx,
          extensionNumber: 'EXT-' + (8850 + pullIdx) + '-1',
          reservationNumber: pullNum,
          sourceReservationId: pullApiId,
          extensionType: 'CLIENT',
          extensionTypeAr: 'تمديد بواسطة العميل',
          reservationStatus: 'paid',
          statusCode: 'paid',
          statusAr: 'مدفوع',
          paymentStatus: 'paid',
          paymentMethod: 'Apple Pay',
          paymentDate: chosenPullDate + 'T13:15:00Z',
          extendDays: 2,
          extendDate: origEndDateStr,
          newEndDate: actualEndDateStr,
          startDate: origEndDateStr.substring(0, 10),
          startTime: '10:30',
          endDate: actualEndDateStr.substring(0, 10),
          endTime: '10:30',
          subTotal: 521.74,
          vatAmount: 78.26,
          amount: 600,
          isAcceptedAndPaid: true
        };
        var pullIncoming = {
          reservationId: pullApiId,
          reservationNumber: pullNum,
          reservation_number: pullNum,
          reservationDate: chosenPullDate + 'T09:00:00Z',
          clientName: pullNames[pullIdx % pullNames.length],
          clientMobile: '05077441' + String(10 + (pullIdx % 89)),
          clientEmail: 'client' + (8850 + pullIdx) + '@example.sa',
          companyArName: pullIdx % 2 === 0 ? 'ذيب لتأجير السيارات' : 'بدجت السعودية',
          receiveBranchArName: pullIdx % 2 === 0 ? 'مطار الملك خالد - الرياض' : 'مطار الملك عبدالعزيز - جدة',
          deliverBranchArName: pullIdx % 2 === 0 ? 'مطار الملك خالد - الرياض' : 'مطار الملك عبدالعزيز - جدة',
          carNameAr: pullCars[pullIdx % pullCars.length],
          carCategoryAr: 'سيدان فاخرة',
          plateNumber: 'و هـ ي ' + String(6201 + pullIdx),
          startDate: chosenPullDate + 'T10:30:00',
          endDate: origEndDateStr,
          actualEndDate: actualEndDateStr,
          reservationDays: 3,
          reservationStatus: pullStatuses[pullIdx % pullStatuses.length],
          pickupType: 'airport',
          returnType: 'branch',
          paymentType: 'مدى (Mada)',
          paymentStatus: 'paid',
          dailyPrice: Math.round((basePricePull / 3 / 1.15) * 100) / 100,
          discount: 0,
          vat: Math.round((basePricePull - basePricePull / 1.15) * 100) / 100,
          total: basePricePull,
          extended: true
        };

        var simulatedBatch = [{ apiItem: pullIncoming, exts: [pullIncomingExt] }];
        // Also simulate a realistic Rental Gate status progression on an existing reservation on re-pull
        var progTarget = db.reservations.find(function (r) { return r.reservationNumber === 'RG-2026-8843'; }) || db.reservations[0];
        if (progTarget) {
          var progressionOrder = ['pending', 'confirmed', 'started', 'delivered', 'completed'];
          var currCode = String(progTarget.originalStatusCode || '').toLowerCase();
          var curIdx = progressionOrder.indexOf(currCode);
          var nextCode = progressionOrder[(curIdx >= 0 && curIdx < progressionOrder.length - 1) ? (curIdx + 1) : 1];
          var progExts = db.extensions.filter(function (ex) {
            return ex.reservationId === progTarget.id || ex.reservationNumber === progTarget.reservationNumber;
          });
          simulatedBatch.push({
            apiItem: {
              reservationId: progTarget.sourceReservationId || '',
              reservationNumber: progTarget.reservationNumber,
              reservation_number: progTarget.reservationNumber,
              reservationDate: progTarget.sourceCreatedAt || ((progTarget.startDate || todayIso(0)) + 'T10:00:00Z'),
              clientName: progTarget.customerName,
              clientMobile: progTarget.customerPhone,
              clientEmail: progTarget.customerEmail || '',
              customerIdNumber: progTarget.customerIdNumber || '',
              companyArName: progTarget.companyName,
              receiveBranchArName: progTarget.branchName,
              deliverBranchArName: progTarget.deliverBranchName || progTarget.branchName,
              carNameAr: progTarget.carName,
              carCategoryAr: progTarget.carCategory || '',
              plateNumber: progTarget.plateNumber,
              startDate: (progTarget.startDate || todayIso(0)) + (progTarget.startTime ? ('T' + progTarget.startTime + ':00') : 'T10:00:00'),
              endDate: (progTarget.originalEndDate || progTarget.endDate || todayIso(3)) + (progTarget.originalEndTime ? ('T' + progTarget.originalEndTime + ':00') : 'T10:00:00'),
              actualEndDate: (progTarget.extendedUntilDate || progTarget.endDate || todayIso(3)) + (progTarget.extendedUntilTime ? ('T' + progTarget.extendedUntilTime + ':00') : ''),
              reservationDays: progTarget.daysCount || 3,
              reservationStatus: nextCode,
              pickupType: progTarget.pickupTypeAr || 'airport',
              returnType: progTarget.returnTypeAr || 'branch',
              paymentType: progTarget.paymentMethod || '',
              paymentStatus: progTarget.paymentStatus || '',
              dailyPrice: progTarget.dailyPrice || 0,
              discount: progTarget.discountAmount || 0,
              vat: progTarget.vatAmount || 0,
              total: progTarget.baseAmount || progTarget.totalAmount || 960
            },
            exts: progExts
          });
        }

        var filteredBatch = pullRange.hasCustomRange && core.filterSourceReservationsByPullRange
          ? simulatedBatch.filter(function (entry) {
              return core.filterSourceReservationsByPullRange([entry.apiItem], pullRange).length > 0;
            })
          : simulatedBatch;

        var importedCnt = 0;
        var updatedCnt = 0;
        var extPulledCnt = 0;
        var changedReservations = [];
        var expectedSourceIds = [];
        var failedRecords = [];

        filteredBatch.forEach(function (entry, idxEntry) {
          try {
            var srcItem = entry.apiItem;
            var srcIdVal = String(srcItem.reservationId || srcItem.reservation_id || srcItem.id || '').trim();
            var existingMatch = (srcIdVal && db.reservations.find(function (r) { return String(r.sourceReservationId || '') === srcIdVal; })) || null;
            if (!existingMatch) {
              var numCand = db.reservations.find(function (r) { return r.reservationNumber === srcItem.reservationNumber; });
              if (numCand) {
                var numCandSrc = String(numCand.sourceReservationId || '').trim();
                if (!numCandSrc || !srcIdVal || numCandSrc === srcIdVal) {
                  existingMatch = numCand;
                } else {
                  srcItem = Object.assign({}, srcItem, {
                    reservationNumber: srcItem.reservationNumber + '-' + srcIdVal.replace(/[^A-Za-z0-9_-]/g, ''),
                    reservation_number: srcItem.reservationNumber + '-' + srcIdVal.replace(/[^A-Za-z0-9_-]/g, '')
                  });
                }
              }
            }
            var mergedItem = core.mergeSyncedReservation(existingMatch, srcItem, entry.exts || [], session.user);
            if (!existingMatch) {
              db.reservations.unshift(mergedItem);
              importedCnt++;
            } else {
              var idxInDb = db.reservations.findIndex(function (r) { return r.id === existingMatch.id; });
              if (idxInDb !== -1) db.reservations[idxInDb] = mergedItem;
              updatedCnt++;
              if (mergedItem.internalStatus !== existingMatch.internalStatus) {
                db.followUpHistory.unshift({
                  id: genId('FUH'),
                  followUpId: '',
                  reservationId: mergedItem.id,
                  reservationNumber: mergedItem.reservationNumber,
                  employeeId: session.employeeId,
                  employeeName: session.user.name,
                  changeType: 'api_status_sync',
                  previousStatus: existingMatch.internalStatus || '',
                  newStatus: mergedItem.internalStatus,
                  previousAction: existingMatch.lastUpdateText || '',
                  newAction: mergedItem.lastUpdateText || '',
                  previousNotes: existingMatch.originalStatusCode || '',
                  newNotes: mergedItem.originalStatusCode || '',
                  changedAt: new Date().toISOString()
                });
              }
            }
            expectedSourceIds.push(String(mergedItem.sourceReservationId || mergedItem.reservationNumber || '').trim());
            if (Array.isArray(entry.exts) && entry.exts.length > 0) {
              entry.exts.forEach(function (exObj, eIdx) {
                var fullExt = Object.assign({}, exObj, {
                  reservationId: mergedItem.id,
                  reservationNumber: mergedItem.reservationNumber,
                  sourceReservationId: mergedItem.sourceReservationId || exObj.sourceReservationId || '',
                  sequenceNumber: exObj.sequenceNumber || (eIdx + 1),
                  syncedAt: new Date().toISOString()
                });
                var existExtIdx = db.extensions.findIndex(function (e) {
                  return e.extensionNumber === fullExt.extensionNumber && e.reservationNumber === fullExt.reservationNumber;
                });
                if (existExtIdx === -1) {
                  db.extensions.push(fullExt);
                  extPulledCnt++;
                } else {
                  db.extensions[existExtIdx] = Object.assign({}, db.extensions[existExtIdx], fullExt);
                }
              });
            }
            changedReservations.push(mergedItem);
          } catch (sandboxErr) {
            failedRecords.push({
              identifier: String((entry && entry.apiItem && (entry.apiItem.reservationId || entry.apiItem.reservationNumber)) || ('row#' + (idxEntry + 1))),
              entityType: 'reservation',
              stage: 'normalize',
              reason: String(sandboxErr && sandboxErr.message ? sandboxErr.message : sandboxErr)
            });
          }
        });

        var missingSourceIds = expectedSourceIds.filter(function (eid) {
          return !db.reservations.some(function (r) {
            return String(r.sourceReservationId || '') === eid || String(r.reservationNumber || '') === eid;
          });
        });
        var recSummary = {
          totalInSource: filteredBatch.length,
          fetchedCount: simulatedBatch.length,
          normalizedCount: changedReservations.length,
          savedOrUpdatedCount: importedCnt + updatedCnt,
          dbTotalReservations: db.reservations.length,
          duplicateHandledCount: 0,
          excludedFilteredCount: 0,
          rangeFilteredCount: Math.max(0, simulatedBatch.length - filteredBatch.length),
          failedCount: failedRecords.length,
          missingLocalCount: missingSourceIds.length,
          unfetchedSourceGap: 0,
          syncComplete: failedRecords.length === 0 && missingSourceIds.length === 0,
          missingSourceIds: missingSourceIds,
          failedRecords: failedRecords,
          excludedSourceIds: [],
          incompleteEndpoints: [],
          backfillFailedIds: []
        };

        var rangeNote = pullRange.hasCustomRange
          ? (' | النطاق: ' + (pullRange.dateFrom || '-') + ' → ' + (pullRange.dateTo || '-'))
          : '';
        var pullSyncRec = {
          id: genId('SYNC'),
          triggeredById: session.employeeId,
          triggeredByName: session.user.name,
          status: recSummary.syncComplete ? 'success' : 'partial',
          importedCount: importedCnt,
          updatedCount: updatedCnt,
          extensionsCount: extPulledCnt,
          pagesFetched: 1,
          fetchedCount: simulatedBatch.length,
          excludedFilteredCount: 0,
          rangeFilteredCount: recSummary.rangeFilteredCount,
          totalInSource: recSummary.totalInSource,
          savedOrUpdatedCount: recSummary.savedOrUpdatedCount,
          dbTotalReservations: recSummary.dbTotalReservations,
          failedCount: recSummary.failedCount,
          missingLocalCount: recSummary.missingLocalCount,
          missingSourceIds: recSummary.missingSourceIds,
          failedRecords: recSummary.failedRecords,
          incompleteEndpoints: [],
          backfillFailedIds: [],
          unfetchedSourceGap: 0,
          syncComplete: recSummary.syncComplete,
          reconciliation: recSummary,
          errorMessage: rangeNote ? rangeNote.replace(/^\s*\|\s*/, '') : '',
          durationMs: 210,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          appliedRange: pullRange,
          changedReservations: changedReservations
        };
        db.syncLog.unshift(pullSyncRec);
        appendSandboxActivity(
          db,
          session.user,
          isFullSyncAction ? 'سحب بيانات' : 'سحب الحجوزات',
          isFullSyncAction ? 'Sync' : 'Reservation',
          pullSyncRec.id,
          'سحب الحجوزات: جديد ' + importedCnt + '، محدث ' + updatedCnt + '، تمديدات ' + extPulledCnt + rangeNote
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم سحب الحجوزات وتحديث الحالات بنجاح.',
          data: pullSyncRec,
          error: null
        };
      }

      case 'retryFailedSyncRecords': {
        if (!core.canUserPerform(session.user, 'pull_reservations') && !core.canUserPerform(session.user, 'sync_data')) {
          return { success: false, message: 'FORBIDDEN: صلاحية إعادة معالجة السجلات تتطلب صلاحية سحب الحجوزات.', data: null, error: 'FORBIDDEN' };
        }
        var latestLog = db.syncLog[0] || null;
        var retryRec = {
          totalInSource: latestLog ? (latestLog.totalInSource || db.reservations.length) : db.reservations.length,
          fetchedCount: latestLog ? (latestLog.fetchedCount || 0) : 0,
          normalizedCount: 0,
          savedOrUpdatedCount: 0,
          dbTotalReservations: db.reservations.length,
          duplicateHandledCount: 0,
          excludedFilteredCount: 0,
          rangeFilteredCount: 0,
          failedCount: 0,
          missingLocalCount: 0,
          unfetchedSourceGap: 0,
          syncComplete: true,
          missingSourceIds: [],
          failedRecords: [],
          excludedSourceIds: [],
          incompleteEndpoints: [],
          backfillFailedIds: []
        };
        var nowRetryIso = new Date().toISOString();
        var retrySyncLogEntry = {
          id: genId('SYNC'),
          triggeredById: session.employeeId,
          triggeredByName: session.user.name,
          status: 'success',
          importedCount: 0,
          updatedCount: 0,
          extensionsCount: 0,
          pagesFetched: 1,
          fetchedCount: retryRec.fetchedCount,
          totalInSource: retryRec.totalInSource,
          dbTotalReservations: db.reservations.length,
          failedCount: 0,
          missingLocalCount: 0,
          unfetchedSourceGap: 0,
          missingSourceIds: [],
          failedRecords: [],
          incompleteEndpoints: [],
          backfillFailedIds: [],
          syncComplete: true,
          reconciliation: retryRec,
          errorMessage: '',
          durationMs: 120,
          startedAt: nowRetryIso,
          finishedAt: nowRetryIso
        };
        db.syncLog.unshift(retrySyncLogEntry);
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم التحقق وإعادة المعالجة في وضع المعاينة بنجاح.',
          data: retrySyncLogEntry,
          error: null
        };
      }

      case 'getSyncStatus': {
        if (!core.canAccessApi(session.user) || !core.canUserPerform(session.user, 'sync_data')) {
          return { success: false, message: 'FORBIDDEN: صلاحيات API مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        var syncIv = core.normalizeAutoSyncInterval(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes);
        var lastLog = db.syncLog[0] || null;
        return {
          success: true,
          message: '',
          data: {
            hasToken: false,
            mode: 'sandbox',
            autoSyncEnabled: db.settings.auto_sync_enabled !== false,
            autoSyncIntervalHours: syncIv.hours,
            autoSyncIntervalMinutes: syncIv.minutes,
            lastSync: lastLog,
            lastReconciliation: (lastLog && lastLog.reconciliation) || {
              totalInSource: db.reservations.length,
              fetchedCount: lastLog ? (lastLog.fetchedCount || db.reservations.length) : db.reservations.length,
              savedOrUpdatedCount: lastLog ? ((lastLog.importedCount || 0) + (lastLog.updatedCount || 0)) : db.reservations.length,
              dbTotalReservations: db.reservations.length,
              failedCount: 0,
              missingLocalCount: 0,
              unfetchedSourceGap: 0,
              syncComplete: true,
              missingSourceIds: [],
              failedRecords: [],
              incompleteEndpoints: [],
              backfillFailedIds: []
            },
            logs: db.syncLog
          },
          error: null
        };
      }

      case 'getReports': {
        var rType = payload.reportType || 'all_reservations';
        if (payload.logExport) {
          appendSandboxActivity(db, session.user, 'تصدير تقرير', 'Report', rType, 'تصدير تقرير: ' + rType);
          saveSandboxDb(db);
        }
        var repCompanies = {};
        var repBranches = {};
        db.reservations.forEach(function (r) {
          if (r.companyName) repCompanies[r.companyName] = true;
          if (r.branchName) repBranches[r.branchName] = true;
        });
        var repFacets = { companies: Object.keys(repCompanies).sort(), branches: Object.keys(repBranches).sort() };
        var filteredRes = core.filterReservations(db.reservations, db.followUps, payload, {
          employeeId: session.employeeId,
          role: session.role,
          user: session.user,
          allowAgentViewAll: db.settings.allow_agent_view_all
        });
        var dFrom = String(payload.dateFrom || '').trim();
        var dTo = String(payload.dateTo || '').trim();
        var fEmp = String(payload.employeeId || '').trim();
        var fStatus = String(payload.status || '').trim();
        var fPrio = String(payload.priority || '').trim();

        if (rType === 'followups_log') {
          var fuFiltered = db.followUps.filter(function (x) {
            if (dFrom && String(x.followUpDate || '') < dFrom) return false;
            if (dTo && String(x.followUpDate || '') > dTo) return false;
            if (fEmp && x.employeeId !== fEmp) return false;
            if (fStatus && x.status !== fStatus) return false;
            return true;
          });
          return { success: true, message: '', data: { reportType: rType, rows: fuFiltered, facets: repFacets }, error: null };
        }
        if (rType === 'problems') {
          var prFiltered = db.problems.filter(function (pr) {
            if (fPrio && pr.priority !== fPrio) return false;
            if (fStatus && pr.status !== fStatus) return false;
            if (fEmp && (pr.assignedEmployeeIds || []).indexOf(fEmp) === -1) return false;
            if (dFrom && core.formatDisplayDate(pr.createdAt) < dFrom) return false;
            if (dTo && core.formatDisplayDate(pr.createdAt) > dTo) return false;
            return true;
          });
          return { success: true, message: '', data: { reportType: rType, rows: prFiltered, facets: repFacets }, error: null };
        }
        if (rType === 'extensions') {
          var extFiltered = db.extensions.filter(function (ex) {
            if (dFrom && core.formatDisplayDate(ex.startDate) < dFrom) return false;
            if (dTo && core.formatDisplayDate(ex.startDate) > dTo) return false;
            return true;
          });
          return { success: true, message: '', data: { reportType: rType, rows: extFiltered, facets: repFacets }, error: null };
        }
        if (rType === 'unfollowed') {
          return { success: true, message: '', data: { reportType: rType, rows: filteredRes.filter(function (r) { return !r.isFollowed; }), facets: repFacets }, error: null };
        }
        if (rType === 'priorities') {
          var prioRank = { 'مرتفع': 0, 'متوسط': 1, 'عادي': 2 };
          var prioSorted = filteredRes.slice().sort(function (a, b) {
            var ra = prioRank[a.priority] !== undefined ? prioRank[a.priority] : 3;
            var rb = prioRank[b.priority] !== undefined ? prioRank[b.priority] : 3;
            return ra - rb;
          });
          return { success: true, message: '', data: { reportType: rType, rows: prioSorted, facets: repFacets }, error: null };
        }
        if (rType === 'employee_performance') {
          var statsEmpsRep = (core && core.filterEmployeesForStats)
            ? core.filterEmployeesForStats(db.employees, db.settings.stats_control_config)
            : (db.employees || []).filter(function (e) { return e && e.status !== 'disabled'; });
          var perf = statsEmpsRep.map(function (emp) {
            return {
              employeeId: emp.id,
              employeeName: emp.name,
              jobTitle: emp.jobTitle,
              role: emp.role,
              assignedReservations: db.reservations.filter(function (r) { return (r.assignedEmployeeIds || []).indexOf(emp.id) !== -1; }).length,
              followUpsCount: db.followUps.filter(function (f) { return f.employeeId === emp.id; }).length,
              problemsCount: db.problems.filter(function (p) { return (p.assignedEmployeeIds || []).indexOf(emp.id) !== -1; }).length,
              lastActivity: emp.lastActivity
            };
          });
          return { success: true, message: '', data: { reportType: rType, rows: perf, facets: repFacets }, error: null };
        }
        if (rType === 'sync_log') {
          var syncRows = db.syncLog.slice().sort(function (a, b) {
            return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
          });
          return { success: true, message: '', data: { reportType: rType, rows: syncRows, facets: repFacets }, error: null };
        }
        if (rType === 'activity_log') {
          var actRows = db.activityLog.filter(function (l) {
            if (fEmp && l.userId !== fEmp) return false;
            if (dFrom && String(l.logDate || '') < dFrom) return false;
            if (dTo && String(l.logDate || '') > dTo) return false;
            return true;
          });
          return { success: true, message: '', data: { reportType: rType, rows: actRows, facets: repFacets }, error: null };
        }
        return { success: true, message: '', data: { reportType: rType, rows: filteredRes, facets: repFacets }, error: null };
      }

      case 'getSettings': {
        if (!core.canAccessApi(session.user)) {
          return { success: false, message: 'FORBIDDEN: إعدادات النظام وAPI مخصصة للمبرمج والمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        var getIv = core.normalizeAutoSyncInterval(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes);
        return {
          success: true,
          message: '',
          data: Object.assign({}, db.settings, {
            ui_simplification: core.normalizeUiSimplificationSettings(db.settings.ui_simplification),
            role_ui_defaults: core.normalizeRoleUiDefaults ? core.normalizeRoleUiDefaults(db.settings.role_ui_defaults) : {},
            stats_control_config: core.normalizeStatsControlConfig ? core.normalizeStatsControlConfig(db.settings.stats_control_config) : { excludedFromStatsEmployeeIds: [] },
            call_wrapup_shortcuts: core.normalizeCallWrapupShortcutsConfig ? core.normalizeCallWrapupShortcutsConfig(db.settings.call_wrapup_shortcuts) : { items: core.CALL_WRAPUP_OUTCOMES || [], customized: false, updatedAt: '', updatedBy: '' },
            handover_settings: core.normalizeHandoverSettings(db.settings.handover_settings),
            auto_sync_enabled: db.settings.auto_sync_enabled !== false,
            auto_sync_interval_hours: getIv.hours,
            auto_sync_interval_minutes: getIv.minutes,
            hasRgToken: Boolean(db.settings.sandbox_has_rg_token)
          }),
          error: null
        };
      }

      case 'updateSettings': {
        var hasSysFields = Boolean(
          payload.company_name !== undefined ||
          payload.excluded_statuses !== undefined ||
          payload.session_ttl_hours !== undefined ||
          payload.allow_agent_view_all !== undefined ||
          payload.default_language !== undefined ||
          payload.auto_sync_enabled !== undefined ||
          payload.ui_simplification !== undefined ||
          payload.role_ui_defaults !== undefined ||
          payload.stats_control_config !== undefined ||
          payload.call_wrapup_shortcuts !== undefined ||
          payload.auto_sync_interval_hours !== undefined ||
          payload.auto_sync_interval_minutes !== undefined
        );
        if (payload.stats_control_config !== undefined && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: التحكم في ظهور الموظفين بالإحصائيات متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (payload.call_wrapup_shortcuts !== undefined && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: التحكم في اختصارات نافذة الاتصال متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (hasSysFields || payload.handover_settings === undefined) {
          if (!core.canUserPerform(session.user, 'manage_settings')) {
            return { success: false, message: 'FORBIDDEN: صلاحية المبرمج أو المدير العام فقط.', data: null, error: 'FORBIDDEN' };
          }
        } else if (!core.canAccessApi(session.user)) {
          return { success: false, message: 'FORBIDDEN: إعدادات تسليم الوردية مخصصة للمشرف والمدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var settingDiffs = [];
        if (payload.company_name && payload.company_name !== db.settings.company_name) {
          settingDiffs.push({ field: 'company_name', label: 'اسم الشركة', before: db.settings.company_name || '-', after: String(payload.company_name) });
          db.settings.company_name = String(payload.company_name);
        }
        if (Array.isArray(payload.excluded_statuses)) db.settings.excluded_statuses = payload.excluded_statuses;
        if (payload.session_ttl_hours) db.settings.session_ttl_hours = Number(payload.session_ttl_hours);
        if (typeof payload.allow_agent_view_all === 'boolean') db.settings.allow_agent_view_all = payload.allow_agent_view_all;
        if (payload.default_language) db.settings.default_language = payload.default_language;
        if (typeof payload.auto_sync_enabled === 'boolean') db.settings.auto_sync_enabled = payload.auto_sync_enabled;
        if (payload.ui_simplification !== undefined) {
          db.settings.ui_simplification = core.normalizeUiSimplificationSettings(payload.ui_simplification);
        }
        if (payload.role_ui_defaults !== undefined && core.normalizeRoleUiDefaults) {
          db.settings.role_ui_defaults = core.normalizeRoleUiDefaults(payload.role_ui_defaults);
        }
        if (payload.stats_control_config !== undefined && core.normalizeStatsControlConfig) {
          var nextStatsCfg = core.normalizeStatsControlConfig(payload.stats_control_config);
          nextStatsCfg.updatedAt = new Date().toISOString();
          nextStatsCfg.updatedBy = session.user ? session.user.name : '';
          db.settings.stats_control_config = nextStatsCfg;
        }
        if (payload.call_wrapup_shortcuts !== undefined && core.normalizeCallWrapupShortcutsConfig) {
          var prevSc = core.normalizeCallWrapupShortcutsConfig(db.settings.call_wrapup_shortcuts);
          var nextSc = core.normalizeCallWrapupShortcutsConfig(payload.call_wrapup_shortcuts);
          nextSc.updatedAt = new Date().toISOString();
          nextSc.updatedBy = session.user ? session.user.name : '';
          db.settings.call_wrapup_shortcuts = nextSc;
          if (JSON.stringify(prevSc.items) !== JSON.stringify(nextSc.items) || prevSc.customized !== nextSc.customized) {
            settingDiffs.push({
              field: 'call_wrapup_shortcuts',
              label: 'اختصارات نافذة الاتصال',
              before: String(prevSc.items.length) + ' اختصار',
              after: String(nextSc.items.length) + ' اختصار'
            });
          }
        }
        if (payload.handover_settings !== undefined) {
          var prevHo = core.normalizeHandoverSettings(db.settings.handover_settings);
          var nextHo = core.normalizeHandoverSettings(payload.handover_settings);
          db.settings.handover_settings = nextHo;
          if (JSON.stringify(prevHo) !== JSON.stringify(nextHo)) {
            settingDiffs.push({
              field: 'handover_settings',
              label: 'إعدادات تسليم الوردية',
              before: prevHo.defaultPreset + ' (' + (prevHo.defaultTimeFrom || '00:00') + '-' + (prevHo.defaultTimeTo || '23:59') + ')',
              after: nextHo.defaultPreset + ' (' + (nextHo.defaultTimeFrom || '00:00') + '-' + (nextHo.defaultTimeTo || '23:59') + ')'
            });
          }
        }
        if (payload.auto_sync_interval_hours !== undefined || payload.auto_sync_interval_minutes !== undefined) {
          var nextIv = core.normalizeAutoSyncInterval(
            payload.auto_sync_interval_hours !== undefined ? payload.auto_sync_interval_hours : db.settings.auto_sync_interval_hours,
            payload.auto_sync_interval_minutes !== undefined ? payload.auto_sync_interval_minutes : db.settings.auto_sync_interval_minutes
          );
          db.settings.auto_sync_interval_hours = nextIv.hours;
          db.settings.auto_sync_interval_minutes = nextIv.minutes;
        }
        db.settings._settings_updated_at = new Date().toISOString();
        appendSandboxActivity(
          db,
          session.user,
          'تحديث الإعدادات',
          'Settings',
          'system',
          hasSysFields
            ? ('تحديث إعدادات النظام (التحديث التلقائي: ' + (db.settings.auto_sync_enabled ? core.formatAutoSyncIntervalAr(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes) : 'متوقف') + ')')
            : 'تحديث إعدادات تسليم الوردية',
          settingDiffs
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حفظ الإعدادات.',
          data: Object.assign({}, db.settings, {
            ui_simplification: core.normalizeUiSimplificationSettings(db.settings.ui_simplification),
            role_ui_defaults: core.normalizeRoleUiDefaults ? core.normalizeRoleUiDefaults(db.settings.role_ui_defaults) : {},
            stats_control_config: core.normalizeStatsControlConfig ? core.normalizeStatsControlConfig(db.settings.stats_control_config) : { excludedFromStatsEmployeeIds: [] },
            call_wrapup_shortcuts: core.normalizeCallWrapupShortcutsConfig ? core.normalizeCallWrapupShortcutsConfig(db.settings.call_wrapup_shortcuts) : { items: core.CALL_WRAPUP_OUTCOMES || [], customized: false, updatedAt: '', updatedBy: '' },
            handover_settings: core.normalizeHandoverSettings(db.settings.handover_settings)
          }),
          error: null
        };
      }

      case 'saveUserLayoutPrefs': {
        var normPrefs = (core && core.normalizeUserLayoutPrefs)
          ? core.normalizeUserLayoutPrefs(payload)
          : { navOrder: [], hiddenRoutes: [], dashOrder: [], dashHidden: [] };
        db.settings['layout_prefs_u_' + session.employeeId] = normPrefs;
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حفظ ترتيب وظهور الشاشات ولوحة التحكم.',
          data: { layoutPrefs: normPrefs },
          error: null
        };
      }

      case 'previewDeleteReservations': {
        if (!core.canUserPerform(session.user, 'manage_settings')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var pScope = (core && core.normalizeDeleteReservationsScope)
          ? core.normalizeDeleteReservationsScope(payload)
          : { scope: 'all', year: '', month: '' };
        var pTargets = (core && core.filterReservationsForDeleteScope)
          ? core.filterReservationsForDeleteScope(db.reservations || [], pScope)
          : (Array.isArray(db.reservations) ? db.reservations : []);
        return {
          success: true,
          message: '',
          data: {
            count: pTargets.length,
            totalReservations: Array.isArray(db.reservations) ? db.reservations.length : 0,
            scope: pScope
          },
          error: null
        };
      }

      case 'deleteAllReservations': {
        if (!core.canUserPerform(session.user, 'manage_settings')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var delCheck = core.validateDeleteAllReservationsConfirmation(payload);
        if (!delCheck.valid) {
          return { success: false, message: delCheck.message, data: null, error: 'VALIDATION_ERROR' };
        }
        var actorEmp = db.employees.find(function (e) { return e && e.id === session.employeeId; });
        if (!actorEmp) {
          return { success: false, message: 'UNAUTHORIZED: تعذر التحقق من حساب المستخدم الحالي.', data: null, error: 'UNAUTHORIZED' };
        }
        if (simpleHash(actorEmp.salt + ':' + String(payload.password || '')) !== actorEmp.passwordHash) {
          return { success: false, message: 'كلمة المرور المدخلة غير صحيحة.', data: null, error: 'VALIDATION_ERROR' };
        }
        var delScope = delCheck.scope || (core && core.normalizeDeleteReservationsScope
          ? core.normalizeDeleteReservationsScope(payload)
          : { scope: 'all', year: '', month: '', ym: '', periodLabelAr: 'جميع الحجوزات' });
        var allResList = Array.isArray(db.reservations) ? db.reservations : [];
        var targets = (core && core.filterReservationsForDeleteScope)
          ? core.filterReservationsForDeleteScope(allResList, delScope)
          : allResList.slice();
        var removedTotal = targets.length;
        if (delScope.scope === 'all') {
          db.reservations = [];
          db.extensions = [];
          db.assignments = [];
          db.followUps = [];
          db.followUpHistory = [];
          if (Array.isArray(db.problems)) {
            db.problems = db.problems.map(function (pr) {
              return pr && pr.reservationId ? Object.assign({}, pr, { reservationId: '' }) : pr;
            });
          }
        } else {
          var targetIdMap = {};
          targets.forEach(function (tr) { if (tr && tr.id) targetIdMap[tr.id] = true; });
          db.reservations = allResList.filter(function (r) { return !r || !targetIdMap[r.id]; });
          if (Array.isArray(db.extensions)) {
            db.extensions = db.extensions.filter(function (x) { return !x || !targetIdMap[x.reservationId]; });
          }
          if (Array.isArray(db.assignments)) {
            db.assignments = db.assignments.filter(function (x) { return !x || !targetIdMap[x.reservationId]; });
          }
          if (Array.isArray(db.followUps)) {
            db.followUps = db.followUps.filter(function (x) { return !x || !targetIdMap[x.reservationId]; });
          }
          if (Array.isArray(db.followUpHistory)) {
            db.followUpHistory = db.followUpHistory.filter(function (x) { return !x || !targetIdMap[x.reservationId]; });
          }
          if (Array.isArray(db.problems)) {
            db.problems = db.problems.map(function (pr) {
              return (pr && pr.reservationId && targetIdMap[pr.reservationId])
                ? Object.assign({}, pr, { reservationId: '' })
                : pr;
            });
          }
        }
        db._schemaV3ExactRg = true;
        var scopeText = delScope.periodLabelAr || (delScope.scope === 'month'
          ? ('شهر ' + (delScope.ym || delScope.month))
          : (delScope.scope === 'year' ? ('سنة ' + delScope.year) : 'جميع الحجوزات'));
        appendSandboxActivity(
          db,
          session.user,
          'حذف حجوزات (' + scopeText + ')',
          'Reservation',
          delScope.scope === 'all' ? 'ALL' : (delScope.ym || delScope.year || 'SCOPE'),
          'حذف ' + removedTotal + ' حجز (' + scopeText + ') مع تصدير Excel بواسطة ' + session.user.name
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حذف ' + removedTotal + ' حجز (' + scopeText + ') بنجاح.',
          data: {
            deleted: true,
            deletedReservationsCount: removedTotal,
            scope: delScope,
            exportedRows: targets
          },
          error: null
        };
      }

      case 'importReservationsFromExcel': {
        if (!core.canUserPerform(session.user, 'pull_reservations') && !core.canUserPerform(session.user, 'manage_settings')) {
          return { success: false, message: 'FORBIDDEN: لا تملك صلاحية استيراد الحجوزات.', data: null, error: 'FORBIDDEN' };
        }
        var rawImportRows = Array.isArray(payload && payload.rows) ? payload.rows : [];
        if (!rawImportRows.length) {
          return { success: false, message: 'ملف Excel فارغ أو لا يحتوي على صفوف بيانات.', data: null, error: 'VALIDATION_ERROR' };
        }
        var parsedImport = core.parseImportedReservationRows(rawImportRows, db.reservations || [], session.user);
        if (!parsedImport.validRows.length) {
          return { success: false, message: 'لا توجد صفوف صالحة للاستيراد في ملف Excel.', data: { errors: parsedImport.errors }, error: 'VALIDATION_ERROR' };
        }
        var existingByNum = {};
        if (!Array.isArray(db.reservations)) db.reservations = [];
        db.reservations.forEach(function (r, idx) {
          if (r && r.reservationNumber) {
            existingByNum[String(r.reservationNumber).trim().toLowerCase()] = idx;
          }
        });
        parsedImport.validRows.forEach(function (rec) {
          var cleanRec = Object.assign({}, rec);
          delete cleanRec._isUpdate;
          var key = String(cleanRec.reservationNumber || '').trim().toLowerCase();
          if (key && existingByNum[key] !== undefined) {
            db.reservations[existingByNum[key]] = Object.assign({}, db.reservations[existingByNum[key]], cleanRec);
          } else {
            existingByNum[key] = db.reservations.length;
            db.reservations.unshift(cleanRec);
          }
        });
        appendSandboxActivity(
          db,
          session.user,
          'استيراد حجوزات من Excel',
          'Reservation',
          'EXCEL_IMPORT',
          'استيراد ' + parsedImport.newCount + ' حجز جديد وتحديث ' + parsedImport.updateCount + ' حجز بواسطة ' + session.user.name
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم استيراد ' + parsedImport.newCount + ' حجز جديد وتحديث ' + parsedImport.updateCount + ' حجز من ملف Excel.',
          data: {
            importedCount: parsedImport.newCount,
            updatedCount: parsedImport.updateCount,
            skippedRows: parsedImport.skippedRows,
            totalProcessed: parsedImport.validRows.length,
            errors: parsedImport.errors
          },
          error: null
        };
      }

      case 'getAnnouncements': {
        var annsAll = (db.announcements || []).slice().sort(function (a, b) {
          if (Boolean(b.isPinned) !== Boolean(a.isPinned)) return b.isPinned ? 1 : -1;
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        var annsActive = annsAll.filter(function (a) { return isSandboxAnnouncementActive(a); });
        return { success: true, message: '', data: { items: annsAll, activeItems: annsActive }, error: null };
      }

      case 'saveAnnouncement': {
        if (!core.isPrivilegedRole(session.role) && session.role !== 'supervisor') {
          return { success: false, message: 'FORBIDDEN: إدارة تعميمات الوردية متاحة للمبرمج والمشرف والمدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var annMsg = String(payload.message || '').trim();
        if (!annMsg) {
          return { success: false, message: 'نص التعميم أو التنبيه مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        }
        var annToneRaw = String(payload.tone || 'warning').toLowerCase();
        var annTone = (annToneRaw === 'info' || annToneRaw === 'danger' || annToneRaw === 'warning') ? annToneRaw : 'warning';
        var annId = String(payload.id || '').trim() || genId('ANN');
        var annNow = new Date().toISOString();
        var existingAnnIdx = (db.announcements || []).findIndex(function (a) { return a && a.id === annId; });
        var annRecord = {
          id: annId,
          title: String(payload.title || '').trim(),
          message: annMsg,
          tone: annTone,
          isPinned: payload.isPinned !== undefined ? Boolean(payload.isPinned) : true,
          isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
          startsAt: String(payload.startsAt || '').trim(),
          expiresAt: String(payload.expiresAt || '').trim(),
          createdById: session.employeeId,
          createdByName: session.user.name,
          createdByRole: session.role,
          createdAt: existingAnnIdx !== -1 ? db.announcements[existingAnnIdx].createdAt : annNow,
          updatedAt: annNow
        };
        if (!Array.isArray(db.announcements)) db.announcements = [];
        if (existingAnnIdx !== -1) db.announcements[existingAnnIdx] = annRecord;
        else db.announcements.unshift(annRecord);
        appendSandboxActivity(db, session.user, 'نشر تعميم وردية', 'Announcement', annId, (annRecord.title ? (annRecord.title + ': ') : '') + annMsg.slice(0, 120));
        saveSandboxDb(db);
        var annsSorted = db.announcements.slice().sort(function (a, b) {
          if (Boolean(b.isPinned) !== Boolean(a.isPinned)) return b.isPinned ? 1 : -1;
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        return {
          success: true,
          message: 'تم حفظ تعميم الوردية بنجاح.',
          data: { announcement: annRecord, items: annsSorted, activeItems: annsSorted.filter(function (a) { return isSandboxAnnouncementActive(a); }) },
          error: null
        };
      }

      case 'deleteAnnouncement': {
        if (!core.isPrivilegedRole(session.role) && session.role !== 'supervisor') {
          return { success: false, message: 'FORBIDDEN: حذف تعميمات الوردية متاح للمبرمج والمشرف والمدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var delAnnId = String(payload.id || payload.announcementId || '').trim();
        if (!delAnnId) return { success: false, message: 'معرف التعميم مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        db.announcements = (db.announcements || []).filter(function (a) { return a && a.id !== delAnnId; });
        appendSandboxActivity(db, session.user, 'حذف تعميم وردية', 'Announcement', delAnnId, 'تم حذف تعميم الوردية');
        saveSandboxDb(db);
        var remAnns = db.announcements.slice().sort(function (a, b) {
          if (Boolean(b.isPinned) !== Boolean(a.isPinned)) return b.isPinned ? 1 : -1;
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        return {
          success: true,
          message: 'تم حذف التعميم.',
          data: { deleted: true, items: remAnns, activeItems: remAnns.filter(function (a) { return isSandboxAnnouncementActive(a); }) },
          error: null
        };
      }

      case 'getDelegations': {
        var canManageDels = core.isPrivilegedRole(session.role) || core.canUserPerform(session.user, 'manage_employees') || core.canUserPerform(session.user, 'view_employees');
        var rawDels = Array.isArray(db.delegations) ? db.delegations : [];
        var visibleDels = canManageDels
          ? rawDels.slice()
          : rawDels.filter(function (d) { return d && d.delegateEmployeeId === session.employeeId; });
        var nowDelMs = Date.now();
        return {
          success: true,
          message: '',
          data: {
            items: visibleDels.map(function (d) {
              return Object.assign({}, d, { isActiveNow: core.isDelegationActive(d, nowDelMs) });
            })
          },
          error: null
        };
      }

      case 'saveDelegation': {
        if (!core.isPrivilegedRole(session.role) && !core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: منح تفويض الصلاحيات المؤقت متاح للمبرمج أو المدير العام أو مسؤول إدارة الموظفين فقط.', data: null, error: 'FORBIDDEN' };
        }
        var delEmpIdTarget = String(payload.delegateEmployeeId || '').trim();
        var delStartsAt = String(payload.startsAt || '').trim() || new Date().toISOString();
        var delExpiresAt = String(payload.expiresAt || '').trim();
        var delReason = String(payload.reason || '').trim() || 'تفويض صلاحية مشرف بديل مؤقت';
        if (!delEmpIdTarget || !delExpiresAt) {
          return { success: false, message: 'يرجى تحديد الموظف البديل وتاريخ/وقت انتهاء التفويض.', data: null, error: 'VALIDATION_ERROR' };
        }
        var delStartMs = Date.parse(delStartsAt);
        var delEndMs = Date.parse(delExpiresAt);
        if (isNaN(delEndMs) || (!isNaN(delStartMs) && delEndMs <= delStartMs)) {
          return { success: false, message: 'يجب أن يكون موعد انتهاء التفويض بعد موعد البداية.', data: null, error: 'VALIDATION_ERROR' };
        }
        var delEmpObj = db.employees.find(function (e) { return e.id === delEmpIdTarget; });
        if (!delEmpObj) return { success: false, message: 'الموظف المحدد غير موجود.', data: null, error: 'NOT_FOUND' };
        if (String(delEmpObj.status || 'active') !== 'active') {
          return { success: false, message: 'لا يمكن تفويض حساب موقوف.', data: null, error: 'VALIDATION_ERROR' };
        }
        var nowDelIso = new Date().toISOString();
        var delRec = {
          id: genId('DEL'),
          delegateEmployeeId: delEmpObj.id,
          delegateEmployeeName: delEmpObj.name,
          delegatedRole: 'supervisor',
          grantedById: session.employeeId,
          grantedByName: session.user.name,
          reason: delReason,
          startsAt: delStartsAt,
          expiresAt: delExpiresAt,
          status: 'active',
          revokedAt: '',
          revokedById: '',
          revokedByName: '',
          createdAt: nowDelIso,
          updatedAt: nowDelIso
        };
        if (!Array.isArray(db.delegations)) db.delegations = [];
        db.delegations.unshift(delRec);
        pushSandboxNotification(
          db,
          delEmpObj.id,
          '',
          'delegation',
          'تم منحك صلاحية مشرف مؤقتة',
          'منحك ' + session.user.name + ' صلاحية المشرف مؤقتًا حتى ' + core.formatDisplayDateTime(delExpiresAt) + ' (' + delReason + ').',
          'Employee',
          delEmpObj.id
        );
        appendSandboxActivity(
          db,
          session.user,
          'تفويض صلاحيات مؤقت',
          'Employee',
          delEmpObj.name,
          'تفويض ' + delEmpObj.name + ' بصلاحية مشرف مؤقت حتى ' + core.formatDisplayDateTime(delExpiresAt),
          [{ field: 'delegation', label: 'الصلاحية', before: String(delEmpObj.role || 'agent'), after: 'supervisor (حتى ' + core.formatDisplayDateTime(delExpiresAt) + ')' }]
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم منح تفويض المشرف المؤقت بنجاح.',
          data: { delegation: Object.assign({}, delRec, { isActiveNow: core.isDelegationActive(delRec) }) },
          error: null
        };
      }

      case 'revokeDelegation': {
        if (!core.isPrivilegedRole(session.role) && !core.canUserPerform(session.user, 'manage_employees')) {
          return { success: false, message: 'FORBIDDEN: إلغاء التفويض المؤقت متاح للمبرمج أو المدير العام أو مسؤول إدارة الموظفين فقط.', data: null, error: 'FORBIDDEN' };
        }
        var revId = String(payload.id || payload.delegationId || '').trim();
        var revTarget = (db.delegations || []).find(function (d) { return d && d.id === revId; });
        if (!revTarget) return { success: false, message: 'سجل التفويض غير موجود.', data: null, error: 'NOT_FOUND' };
        var revNow = new Date().toISOString();
        revTarget.status = 'revoked';
        revTarget.revokedAt = revNow;
        revTarget.revokedById = session.employeeId;
        revTarget.revokedByName = session.user.name;
        revTarget.updatedAt = revNow;
        appendSandboxActivity(
          db,
          session.user,
          'إلغاء تفويض مؤقت',
          'Employee',
          revTarget.delegateEmployeeName,
          'تم إلغاء التفويض المؤقت عن ' + revTarget.delegateEmployeeName,
          [{ field: 'delegation', label: 'حالة التفويض', before: 'نشط', after: 'ملغى يدويًا' }]
        );
        saveSandboxDb(db);
        return { success: true, message: 'تم إلغاء التفويض المؤقت.', data: { revoked: true }, error: null };
      }

      case 'getReservationLocks': {
        var activeLocks = pruneSandboxLocks(db);
        saveSandboxDb(db);
        return { success: true, message: '', data: { items: activeLocks }, error: null };
      }

      case 'acquireReservationLock': {
        var lockResId = String(payload.reservationId || '').trim();
        if (!lockResId) return { success: false, message: 'معرف الحجز مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        pruneSandboxLocks(db);
        var existingLock = db.locks.find(function (l) { return l.reservationId === lockResId; });
        if (existingLock && existingLock.lockedById !== session.employeeId) {
          return { success: true, message: '', data: { acquired: false, lock: existingLock }, error: null };
        }
        var nowLockMs = Date.now();
        var lockObj = {
          reservationId: lockResId,
          lockedById: session.employeeId,
          lockedByName: session.user.name,
          lockedByRole: session.role,
          lockedAt: new Date(nowLockMs).toISOString(),
          expiresAt: new Date(nowLockMs + 120000).toISOString()
        };
        db.locks = db.locks.filter(function (l) { return l.reservationId !== lockResId; });
        db.locks.push(lockObj);
        saveSandboxDb(db);
        return { success: true, message: '', data: { acquired: true, lock: lockObj }, error: null };
      }

      case 'releaseReservationLock': {
        var relLockResId = String(payload.reservationId || '').trim();
        db.locks = (db.locks || []).filter(function (l) {
          if (relLockResId) {
            return !(l.reservationId === relLockResId && l.lockedById === session.employeeId);
          }
          return l.lockedById !== session.employeeId;
        });
        saveSandboxDb(db);
        return { success: true, message: '', data: { released: true }, error: null };
      }

      case 'getDeltaSync': {
        var rawSince = String(payload.updatedAfter || '').trim();
        var sinceMs = (rawSince && !isNaN(Date.parse(rawSince))) ? (Date.parse(rawSince) - 2000) : (Date.now() - 120000);
        var changedRes = (db.reservations || []).filter(function (r) {
          return Date.parse(r.updatedAt || r.lastUpdatedAt || '') > sinceMs;
        });
        var changedFu = (db.followUps || []).filter(function (f) {
          return Date.parse(f.updatedAt || f.createdAt || '') > sinceMs;
        });
        var changedPrb = (db.problems || []).filter(function (p) {
          return Date.parse(p.updatedAt || p.createdAt || '') > sinceMs;
        });
        var changedEmps = (db.employees || []).filter(function (e) {
          return Date.parse(e.updatedAt || e.createdAt || '') > sinceMs;
        }).map(function (e) {
          var copy = Object.assign({}, e);
          delete copy.passwordHash;
          delete copy.salt;
          return copy;
        });
        var myNotifDelta = sandboxExecute('getNotifications', token, {});
        var delNtfIdsDelta = [];
        (db.notifications || []).forEach(function (n) {
          if (!n) return;
          var mine = n.recipientEmployeeId === session.employeeId ||
            (!n.recipientEmployeeId && (n.recipientRole === session.role || n.recipientRole === 'all'));
          if (!mine) return;
          var dIso = n.deletedAt || (n.dismissedBy && n.dismissedBy[session.employeeId]) || '';
          if (dIso && Date.parse(dIso) > sinceMs) {
            delNtfIdsDelta.push(n.id);
          }
        });
        var activeAnnsDelta = (db.announcements || []).filter(function (a) { return isSandboxAnnouncementActive(a); });
        var activeLocksDelta = pruneSandboxLocks(db);
        var deltaTodayRadar = sandboxExecute('getTodayAndRadar', token, { summaryOnly: true, todayDate: todayIso(0) });
        var setUpdAt = String(db.settings._settings_updated_at || '');
        var settingsChangedDelta = Boolean(setUpdAt && Date.parse(setUpdAt) > sinceMs);
        var callShortcutsDelta = (settingsChangedDelta && core && core.normalizeCallWrapupShortcutsConfig)
          ? core.normalizeCallWrapupShortcutsConfig(db.settings.call_wrapup_shortcuts)
          : undefined;
        return {
          success: true,
          message: '',
          data: Object.assign({
            serverTime: new Date().toISOString(),
            syncVersion: Number(db.settings._sync_version || 1),
            changedReservations: changedRes,
            changedFollowUps: changedFu,
            changedProblems: changedPrb,
            changedEmployees: changedEmps,
            deletedNotificationIds: delNtfIdsDelta,
            deletedAllNotificationsBefore: '',
            changedSettings: settingsChangedDelta,
            settingsUpdatedAt: settingsChangedDelta ? setUpdAt : '',
            todayRadarCounts: (deltaTodayRadar && deltaTodayRadar.success && deltaTodayRadar.data) ? deltaTodayRadar.data.counts : null,
            notifications: myNotifDelta.success ? myNotifDelta.data : { items: [], unreadCount: 0 },
            announcements: activeAnnsDelta,
            locks: activeLocksDelta,
            user: session.user
          }, callShortcutsDelta !== undefined ? { callWrapupShortcuts: callShortcutsDelta } : {}),
          error: null
        };
      }

      case 'bulkReassignEmployeeReservations': {
        if (!core.canUserPerform(session.user, 'assign_employees')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية تحويل الحجوزات.', data: null, error: 'FORBIDDEN' };
        }
        var fromId = String(payload.fromEmployeeId || '').trim();
        var toId = String(payload.toEmployeeId || '').trim();
        var onlyActiveTransfer = payload.onlyActive !== false;
        if (!fromId || !toId) {
          return { success: false, message: 'يرجى تحديد الموظف المحوّل منه والموظف المستلم للوردية.', data: null, error: 'VALIDATION_ERROR' };
        }
        if (fromId === toId) {
          return { success: false, message: 'لا يمكن التحويل إلى نفس الموظف.', data: null, error: 'VALIDATION_ERROR' };
        }
        var fromEmpObj = db.employees.find(function (e) { return e.id === fromId; });
        var toEmpObj = db.employees.find(function (e) { return e.id === toId; });
        if (!fromEmpObj || !toEmpObj) return { success: false, message: 'أحد الموظفين المحددين غير موجود.', data: null, error: 'NOT_FOUND' };
        if (String(toEmpObj.status || 'active') !== 'active') {
          return { success: false, message: 'الموظف المستلم للوردية غير نشط.', data: null, error: 'VALIDATION_ERROR' };
        }
        var trNowIso = new Date().toISOString();
        var trCount = 0;
        var trNums = [];
        (db.reservations || []).forEach(function (resItem) {
          var curIds = Array.isArray(resItem.assignedEmployeeIds) ? resItem.assignedEmployeeIds : [];
          if (curIds.indexOf(fromId) === -1) return;
          if (onlyActiveTransfer && core.isReservationClosedStatus && core.isReservationClosedStatus(resItem)) return;
          var curNames = Array.isArray(resItem.assignedEmployeeNames) ? resItem.assignedEmployeeNames : [];
          var nextIds = [];
          var nextNames = [];
          var seenMap = {};
          for (var i = 0; i < curIds.length; i++) {
            var eid = String(curIds[i] || '').trim();
            if (!eid || eid === fromId || seenMap[eid]) continue;
            seenMap[eid] = true;
            nextIds.push(eid);
            nextNames.push(String(curNames[i] || eid));
          }
          if (!seenMap[toId]) {
            seenMap[toId] = true;
            nextIds.push(toId);
            nextNames.push(toEmpObj.name);
          }
          resItem.assignedEmployeeIds = nextIds;
          resItem.assignedEmployeeNames = nextNames;
          resItem.lastUpdateText = 'تحويل وردية جماعي: من ' + fromEmpObj.name + ' إلى ' + toEmpObj.name;
          resItem.lastUpdatedById = session.employeeId;
          resItem.lastUpdatedByName = session.user.name;
          resItem.lastUpdatedAt = trNowIso;
          resItem.updatedAt = trNowIso;
          (db.assignments || []).forEach(function (a) {
            if (a.reservationId === resItem.id && a.employeeId === fromId && a.status === 'active') {
              a.status = 'transferred';
              a.updatedAt = trNowIso;
            }
          });
          db.assignments.push({
            id: genId('ASN'),
            reservationId: resItem.id,
            reservationNumber: resItem.reservationNumber,
            employeeId: toEmpObj.id,
            employeeName: toEmpObj.name,
            assignedById: session.employeeId,
            assignedByName: session.user.name,
            roleType: 'shift_handover',
            status: 'active',
            assignedAt: trNowIso,
            updatedAt: trNowIso
          });
          trCount += 1;
          trNums.push(resItem.reservationNumber);
        });
        if (trCount > 0) {
          pushSandboxNotification(
            db,
            toEmpObj.id,
            toEmpObj.role,
            'assignment',
            'استلام وردية: ' + trCount + ' حجز نشط',
            'تم تحويل ' + trCount + ' حجزًا نشطًا من ' + fromEmpObj.name + ' إليك بواسطة ' + session.user.name + '.',
            'Reservation',
            trNums[0] || ''
          );
        }
        appendSandboxActivity(
          db,
          session.user,
          'تحويل جماعي للوردية',
          'Reservation',
          fromEmpObj.name + ' -> ' + toEmpObj.name,
          'تحويل ' + trCount + ' حجز نشط من ' + fromEmpObj.name + ' إلى ' + toEmpObj.name,
          [{ field: 'shiftTransfer', label: 'نقل الحجوزات النشطة', before: fromEmpObj.name, after: toEmpObj.name + ' (' + trCount + ' حجز)' }]
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم تحويل ' + trCount + ' حجز نشط إلى ' + toEmpObj.name + ' بنجاح.',
          data: {
            fromEmployeeId: fromId,
            fromEmployeeName: fromEmpObj.name,
            toEmployeeId: toId,
            toEmployeeName: toEmpObj.name,
            transferredCount: trCount,
            reservationNumbers: trNums
          },
          error: null
        };
      }

      case 'bulkReassignSelectedReservations': {
        if (!core.canUserPerform(session.user, 'assign_employees')) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية إعادة توزيع الحجوزات.', data: null, error: 'FORBIDDEN' };
        }
        var selResIds = Array.isArray(payload.reservationIds)
          ? Array.from(new Set(payload.reservationIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)))
          : [];
        var targetEmpIdSel = String(payload.targetEmployeeId || payload.toEmployeeId || payload.employeeId || '').trim();
        var reassignMode = String(payload.mode || 'replace').toLowerCase() === 'add' ? 'add' : 'replace';
        if (!selResIds.length) {
          return { success: false, message: 'يرجى تحديد حجز واحد على الأقل لإعادة التوزيع.', data: null, error: 'VALIDATION_ERROR' };
        }
        if (!targetEmpIdSel) {
          return { success: false, message: 'يرجى اختيار الموظف المستلم.', data: null, error: 'VALIDATION_ERROR' };
        }
        var targetEmpSel = db.employees.find(function (e) { return e.id === targetEmpIdSel; });
        if (!targetEmpSel) return { success: false, message: 'الموظف المستلم غير موجود.', data: null, error: 'NOT_FOUND' };
        if (String(targetEmpSel.status || 'active') !== 'active') {
          return { success: false, message: 'الموظف المستلم غير نشط.', data: null, error: 'VALIDATION_ERROR' };
        }
        var selIdLookup = {};
        selResIds.forEach(function (id) { selIdLookup[id] = true; });
        var bulkNowIso = new Date().toISOString();
        var bulkUpdatedList = [];
        var bulkUpdatedNums = [];
        var bulkLastText = (reassignMode === 'add' ? 'إسناد جماعي إلى: ' : 'إعادة توزيع جماعي إلى: ') + targetEmpSel.name;

        (db.reservations || []).forEach(function (resItem) {
          if (!resItem || !selIdLookup[resItem.id]) return;
          var curIds = Array.isArray(resItem.assignedEmployeeIds) ? resItem.assignedEmployeeIds : [];
          var curNames = Array.isArray(resItem.assignedEmployeeNames) ? resItem.assignedEmployeeNames : [];
          var nextIds = [];
          var nextNames = [];
          if (reassignMode === 'add') {
            var seenB = {};
            for (var i = 0; i < curIds.length; i++) {
              var eid = String(curIds[i] || '').trim();
              if (!eid || seenB[eid]) continue;
              seenB[eid] = true;
              nextIds.push(eid);
              nextNames.push(String(curNames[i] || eid));
            }
            if (!seenB[targetEmpSel.id]) {
              nextIds.push(targetEmpSel.id);
              nextNames.push(targetEmpSel.name);
            }
          } else {
            nextIds = [targetEmpSel.id];
            nextNames = [targetEmpSel.name];
            (db.assignments || []).forEach(function (a) {
              if (a.reservationId === resItem.id && a.status === 'active') {
                a.status = 'transferred';
                a.updatedAt = bulkNowIso;
              }
            });
          }
          resItem.assignedEmployeeIds = nextIds;
          resItem.assignedEmployeeNames = nextNames;
          resItem.lastUpdateText = bulkLastText;
          resItem.lastUpdatedById = session.employeeId;
          resItem.lastUpdatedByName = session.user.name;
          resItem.lastUpdatedAt = bulkNowIso;
          resItem.updatedAt = bulkNowIso;
          db.assignments.push({
            id: genId('ASN'),
            reservationId: resItem.id,
            reservationNumber: resItem.reservationNumber,
            employeeId: targetEmpSel.id,
            employeeName: targetEmpSel.name,
            assignedById: session.employeeId,
            assignedByName: session.user.name,
            roleType: 'bulk_reassign',
            status: 'active',
            assignedAt: bulkNowIso,
            updatedAt: bulkNowIso
          });
          bulkUpdatedList.push(Object.assign({}, resItem));
          bulkUpdatedNums.push(resItem.reservationNumber);
        });

        if (bulkUpdatedList.length > 0) {
          pushSandboxNotification(
            db,
            targetEmpSel.id,
            targetEmpSel.role,
            'assignment',
            'إسناد جماعي: ' + bulkUpdatedList.length + ' حجز',
            'تم إسناد ' + bulkUpdatedList.length + ' حجزًا إليك بواسطة ' + session.user.name + ' (' + (reassignMode === 'add' ? 'إضافة للمشاركين' : 'استبدال الإسناد') + ').',
            'Reservation',
            bulkUpdatedNums[0] || ''
          );
          appendSandboxActivity(
            db,
            session.user,
            'إعادة توزيع جماعي',
            'Reservation',
            bulkUpdatedNums.slice(0, 4).join(', '),
            (reassignMode === 'add' ? 'إضافة إسناد ' : 'إعادة توزيع ') + bulkUpdatedList.length + ' حجز إلى ' + targetEmpSel.name
          );
          saveSandboxDb(db);
        }

        return {
          success: true,
          message: 'تم إعادة توزيع ' + bulkUpdatedList.length + ' حجز إلى ' + targetEmpSel.name + ' بنجاح.',
          data: {
            targetEmployeeId: targetEmpSel.id,
            targetEmployeeName: targetEmpSel.name,
            mode: reassignMode,
            updatedCount: bulkUpdatedList.length,
            reservationIds: bulkUpdatedList.map(function (r) { return r.id; }),
            reservationNumbers: bulkUpdatedNums,
            updatedReservations: bulkUpdatedList
          },
          error: null
        };
      }

      case 'rejectReservation':
      case 'cancelReservation':
      case 'restoreReservation': {
        return {
          success: false,
          message: 'FORBIDDEN_MANUAL_ACTION: تم إيقاف الرفض أو الإلغاء أو الاستعادة اليدوية؛ يتم السحب من Rental Gate تلقائياً.',
          data: null,
          error: 'FORBIDDEN_MANUAL_ACTION'
        };
      }

      case 'searchCustomerByNationalId': {
        if (!core.canUserViewCustomerId || !core.canUserViewCustomerId(session.user)) {
          return { success: false, message: 'FORBIDDEN: ليس لديك صلاحية البحث برقم الهوية.', data: null, error: 'FORBIDDEN' };
        }
        var rawNat = String(payload.nationalId || payload.customerIdNumber || payload.query || '').trim();
        var normNat = core.normalizeNationalId ? core.normalizeNationalId(rawNat) : rawNat.replace(/\D/g, '');
        if (!normNat || normNat.length < 4) {
          return { success: false, message: 'VALIDATION_ERROR: يرجى إدخال 4 أرقام على الأقل من رقم الهوية.', data: null, error: 'VALIDATION_ERROR' };
        }
        var allowAgentAll = db.settings.allow_agent_view_all !== false;
        var matchedNat = db.reservations.filter(function (r) {
          if (!r) return false;
          if (session.role === 'agent' && !allowAgentAll && (r.assignedEmployeeIds || []).indexOf(session.employeeId) === -1) {
            return false;
          }
          var cid = core.normalizeNationalId ? core.normalizeNationalId(r.customerIdNumber || '') : String(r.customerIdNumber || '').replace(/\D/g, '');
          return cid && (cid === normNat || cid.indexOf(normNat) !== -1);
        });
        var groupedNat = core.groupCustomerLookupResults
          ? core.groupCustomerLookupResults(matchedNat, normNat)
          : { found: matchedNat.length > 0, totalMatches: matchedNat.length, customers: [] };
        return {
          success: true,
          message: '',
          data: Object.assign({}, groupedNat, { query: normNat }),
          error: null
        };
      }

      case 'saveEmployeeUiOverrides': {
        var canCustomUi = session.role === 'developer' || session.role === 'general_manager' ||
          core.canUserPerform(session.user, 'customize_ui') || core.canUserPerform(session.user, 'manage_employees');
        if (!canCustomUi) {
          return { success: false, message: 'FORBIDDEN: صلاحية تخصيص الواجهة غير متوفرة.', data: null, error: 'FORBIDDEN' };
        }
        var ovEmpId = String(payload.employeeId || '').trim();
        if (!ovEmpId) return { success: false, message: 'معرف الموظف مطلوب.', data: null, error: 'VALIDATION_ERROR' };
        var ovEmp = db.employees.find(function (e) { return e.id === ovEmpId; });
        if (!ovEmp) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };
        if (String(ovEmp.role || '') === 'developer' && session.role !== 'developer') {
          return { success: false, message: 'FORBIDDEN: تعديل واجهة المبرمج متاح للمبرمج فقط.', data: null, error: 'FORBIDDEN' };
        }
        var normOv = core.normalizeUiOverrides ? core.normalizeUiOverrides(payload.uiOverrides) : (payload.uiOverrides || {});
        ovEmp.uiOverrides = normOv;
        ovEmp.updatedAt = new Date().toISOString();
        appendSandboxActivity(db, session.user, 'تخصيص واجهة موظف', 'Employee', ovEmp.username, 'تحديث واجهة ' + ovEmp.name);
        saveSandboxDb(db);
        return { success: true, message: 'تم حفظ تخصيص واجهة الموظف.', data: { employee: sanitizeEmp(ovEmp) }, error: null };
      }

      case 'saveRoleUiDefaults': {
        var canRoleUi = session.role === 'developer' || session.role === 'general_manager' ||
          core.canUserPerform(session.user, 'customize_ui') || core.canUserPerform(session.user, 'manage_role_ui_defaults') ||
          core.canUserPerform(session.user, 'manage_employees');
        if (!canRoleUi) {
          return { success: false, message: 'FORBIDDEN: صلاحية تخصيص الواجهة غير متوفرة.', data: null, error: 'FORBIDDEN' };
        }
        var rawRoleDef = payload.roleUiDefaults !== undefined
          ? payload.roleUiDefaults
          : (payload.role_ui_defaults !== undefined ? payload.role_ui_defaults : payload);
        var nextRoleDef = core.normalizeRoleUiDefaults ? core.normalizeRoleUiDefaults(rawRoleDef) : {};
        db.settings.role_ui_defaults = nextRoleDef;
        var rawUiSimpIn = payload.uiSimplification !== undefined ? payload.uiSimplification : payload.ui_simplification;
        if (rawUiSimpIn !== undefined) {
          db.settings.ui_simplification = core.normalizeUiSimplificationSettings(rawUiSimpIn);
        }
        saveSandboxDb(db);
        var normUiSimpOut = core.normalizeUiSimplificationSettings(db.settings.ui_simplification);
        return {
          success: true,
          message: 'تم حفظ إعدادات الواجهة الافتراضية.',
          data: {
            roleUiDefaults: nextRoleDef,
            role_ui_defaults: nextRoleDef,
            uiSimplification: normUiSimpOut,
            ui_simplification: normUiSimpOut
          },
          error: null
        };
      }

      case 'restoreUiDefaults': {
        var canRestoreUi = session.role === 'developer' || session.role === 'general_manager' ||
          core.canUserPerform(session.user, 'customize_ui') || core.canUserPerform(session.user, 'manage_role_ui_defaults') ||
          core.canUserPerform(session.user, 'manage_employees');
        if (!canRestoreUi) {
          return { success: false, message: 'FORBIDDEN: صلاحية تخصيص الواجهة غير متوفرة.', data: null, error: 'FORBIDDEN' };
        }
        var rstScope = String(payload.scope || 'all').toLowerCase();
        if (rstScope === 'employee' && payload.employeeId) {
          return sandboxExecute('saveEmployeeUiOverrides', token, { employeeId: payload.employeeId, uiOverrides: {} });
        }
        if (rstScope === 'role' && payload.role) {
          var curRoles = core.normalizeRoleUiDefaults ? core.normalizeRoleUiDefaults(db.settings.role_ui_defaults) : {};
          if (curRoles[payload.role]) curRoles[payload.role] = {};
          return sandboxExecute('saveRoleUiDefaults', token, { roleUiDefaults: curRoles });
        }
        db.settings.ui_simplification = core.normalizeUiSimplificationSettings({});
        db.settings.role_ui_defaults = {};
        if (payload.clearEmployees) {
          db.employees.forEach(function (e) {
            if (session.role === 'developer' || String(e.role || '') !== 'developer') {
              e.uiOverrides = {};
              e.updatedAt = new Date().toISOString();
            }
          });
        }
        saveSandboxDb(db);
        var defaultUiSimp = core.normalizeUiSimplificationSettings({});
        return {
          success: true,
          message: 'تمت استعادة الإعدادات الافتراضية.',
          data: {
            uiSimplification: defaultUiSimp,
            ui_simplification: defaultUiSimp,
            roleUiDefaults: {},
            role_ui_defaults: {}
          },
          error: null
        };
      }

      default:
        return { success: false, message: 'الإجراء غير مدعوم.', data: null, error: 'UNKNOWN_ACTION' };
    }
  }

  function generateClientRequestId(action) {
    return 'REQ_' + String(action || 'op').slice(0, 6).toUpperCase() + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function applyDeltaSyncToCache(delta) {
    if (!delta || typeof delta !== 'object') return { changedScopes: [] };
    var ns = getCacheNamespace();
    var core = root.RGCrmCore;
    var touchedScopes = {};
    var extraInvalidates = [];

    if (delta.deletedAllReservationsBefore) {
      touchedScopes.reservations = true;
      touchedScopes.todayRadar = true;
      touchedScopes.dashboard = true;
      touchedScopes.followUps = true;
      touchedScopes.problems = true;
      touchedScopes.reports = true;
      touchedScopes.activity = true;
      setLocalReservationsState(ns, [], false);
      localDetailsByNs[ns] = {};
      extraInvalidates.push('reservations', 'todayRadar', 'dashboard', 'followUps', 'problems', 'reports', 'activity');
    }

    var chRes = Array.isArray(delta.changedReservations) ? delta.changedReservations : [];
    if (chRes.length > 0) {
      touchedScopes.reservations = true;
      touchedScopes.todayRadar = true;
      touchedScopes.dashboard = true;
      touchedScopes.reports = true;
      writeLocalReservationsState(ns, chRes, false);
      chRes.forEach(function (cr) {
        if (cr && cr.id && localDetailsByNs[ns] && localDetailsByNs[ns][cr.id]) {
          localDetailsByNs[ns][cr.id] = Object.assign({}, localDetailsByNs[ns][cr.id], {
            reservation: cr,
            cachedAt: Date.now()
          });
          if (root.RGIdbCache) {
            root.RGIdbCache.upsertReservationDetail(ns, localDetailsByNs[ns][cr.id]).catch(function () {});
          }
        }
      });
      if (core && core.mergeDeltaRecords) {
        patchCachedScopes(['reservations'], function (data, actName, entryKey) {
          if (actName === 'getReservations' && Array.isArray(data.items)) {
            return patchReservationCachedQuery(data, entryKey, chRes, []);
          }
          if (actName === 'getReservationDetails' && data.reservation) {
            var m = chRes.find(function (x) { return x && x.id === data.reservation.id; });
            if (m) return Object.assign({}, data, { reservation: Object.assign({}, data.reservation, m) });
          }
          return undefined;
        });
      }
    }

    var chFu = Array.isArray(delta.changedFollowUps) ? delta.changedFollowUps : [];
    var delFuIds = Array.isArray(delta.deletedFollowUpIds) ? delta.deletedFollowUpIds : [];
    if (chFu.length > 0 || delFuIds.length > 0) {
      var delFuMap = {};
      delFuIds.forEach(function (id) { if (id) delFuMap[String(id)] = true; });
      touchedScopes.followUps = true;
      touchedScopes.dashboard = true;
      touchedScopes.todayRadar = true;
      if (localReservationsByNs[ns] && localReservationsByNs[ns].byId) {
        var fuResPatch = [];
        chFu.forEach(function (f) {
          if (f && f.reservationId && !delFuMap[String(f.id)] && localReservationsByNs[ns].byId[f.reservationId]) {
            fuResPatch.push(Object.assign({}, localReservationsByNs[ns].byId[f.reservationId], { isFollowed: true }));
          }
        });
        if (fuResPatch.length) writeLocalReservationsState(ns, fuResPatch, false);
      }
      if (localDetailsByNs[ns] && core && core.mergeDeltaRecords) {
        var fuByRes = {};
        chFu.forEach(function (f) {
          if (!f || !f.reservationId || delFuMap[String(f.id)]) return;
          if (!fuByRes[f.reservationId]) fuByRes[f.reservationId] = [];
          fuByRes[f.reservationId].push(f);
        });
        var touchedFuDetailIds = {};
        Object.keys(fuByRes).forEach(function (rid) {
          touchedFuDetailIds[rid] = true;
          var detEntry = localDetailsByNs[ns][rid];
          if (detEntry) {
            var cleanExisting = (Array.isArray(detEntry.followUps) ? detEntry.followUps : []).filter(function (f) {
              return f && String(f.id || '').indexOf('FU_OPT_') !== 0 && !delFuMap[String(f.id)];
            });
            detEntry.followUps = core.mergeDeltaRecords(cleanExisting, fuByRes[rid], 'id');
            detEntry.cachedAt = Date.now();
            if (root.RGIdbCache) {
              root.RGIdbCache.upsertReservationDetail(ns, detEntry).catch(function () {});
            }
          }
        });
        if (delFuIds.length > 0) {
          Object.keys(localDetailsByNs[ns]).forEach(function (rid) {
            var detEntry = localDetailsByNs[ns][rid];
            if (!detEntry || !Array.isArray(detEntry.followUps)) return;
            var hadRemoved = detEntry.followUps.some(function (f) { return f && delFuMap[String(f.id)]; });
            if (!hadRemoved) return;
            detEntry.followUps = detEntry.followUps.filter(function (f) { return f && !delFuMap[String(f.id)]; });
            detEntry.cachedAt = Date.now();
            if (!touchedFuDetailIds[rid] && root.RGIdbCache) {
              root.RGIdbCache.upsertReservationDetail(ns, detEntry).catch(function () {});
            }
          });
        }
      }
      if (core && core.mergeDeltaRecords) {
        patchCachedScopes(['followUps', 'reservations'], function (data, actName, entryKey) {
          if (actName === 'getTeamFollowUps' && Array.isArray(data.items)) {
            return patchFollowUpCachedQuery(data, entryKey, chFu, [], delFuIds);
          }
          if (actName === 'getMyFollowUps' && Array.isArray(data.items)) {
            var nextMyItems = chFu.length > 0 ? core.mergeDeltaRecords(data.items, chFu, 'id') : data.items.slice();
            if (delFuIds.length > 0) nextMyItems = nextMyItems.filter(function (f) { return f && !delFuMap[String(f.id)]; });
            return Object.assign({}, data, { items: nextMyItems });
          }
          if (actName === 'getMyFollowUps' && Array.isArray(data.followUps)) {
            var curActUser = (root.RGAuth && root.RGAuth.getUser) ? root.RGAuth.getUser() : null;
            var curActEmpId = curActUser && curActUser.id ? String(curActUser.id) : '';
            var ownFuChanges = curActEmpId
              ? chFu.filter(function (f) { return f && String(f.employeeId) === curActEmpId && !delFuMap[String(f.id)]; })
              : chFu.filter(function (f) { return f && !delFuMap[String(f.id)]; });
            var existingMyFus = data.followUps.filter(function (f) { return f && !delFuMap[String(f.id)]; });
            var nextMyMentions = Array.isArray(data.mentionFollowUps)
              ? data.mentionFollowUps.filter(function (f) { return f && !delFuMap[String(f.id)]; })
              : data.mentionFollowUps;
            if (ownFuChanges.length > 0 || delFuIds.length > 0) {
              return Object.assign({}, data, {
                followUps: ownFuChanges.length > 0 ? core.mergeDeltaRecords(existingMyFus, ownFuChanges, 'id') : existingMyFus,
                mentionFollowUps: nextMyMentions
              });
            }
          }
          if (actName === 'getReservationDetails' && data.reservation && data.reservation.id) {
            var resFus = chFu.filter(function (f) { return f && f.reservationId === data.reservation.id && !delFuMap[String(f.id)]; });
            var existingFus = Array.isArray(data.followUps) ? data.followUps : [];
            var removedSomeFu = existingFus.some(function (f) { return f && delFuMap[String(f.id)]; });
            if (resFus.length > 0 || removedSomeFu) {
              var cleanedFus = existingFus.filter(function (f) {
                return f && String(f.id || '').indexOf('FU_OPT_') !== 0 && !delFuMap[String(f.id)];
              });
              return Object.assign({}, data, {
                followUps: resFus.length > 0 ? core.mergeDeltaRecords(cleanedFus, resFus, 'id') : cleanedFus
              });
            }
          }
          return undefined;
        });
      }
    }

    var chPrb = Array.isArray(delta.changedProblems) ? delta.changedProblems : [];
    var delPrbIds = Array.isArray(delta.deletedProblemIds) ? delta.deletedProblemIds : [];
    if (chPrb.length > 0 || delPrbIds.length > 0) {
      var delPrbMap = {};
      delPrbIds.forEach(function (id) { if (id) delPrbMap[String(id)] = true; });
      touchedScopes.problems = true;
      touchedScopes.dashboard = true;
      touchedScopes.reports = true;
      if (delPrbIds.length > 0) {
        touchedScopes.todayRadar = true;
        touchedScopes.notifications = true;
      }
      if (localReservationsByNs[ns] && localReservationsByNs[ns].byId) {
        var prbResPatch = [];
        chPrb.forEach(function (p) {
          if (p && p.reservationId && !delPrbMap[String(p.id)] && localReservationsByNs[ns].byId[p.reservationId]) {
            prbResPatch.push(Object.assign({}, localReservationsByNs[ns].byId[p.reservationId], { hasProblem: true }));
          }
        });
        if (prbResPatch.length) writeLocalReservationsState(ns, prbResPatch, false);
      }
      if (localDetailsByNs[ns] && core && core.mergeDeltaRecords) {
        var prbByRes = {};
        chPrb.forEach(function (p) {
          if (!p || !p.reservationId || delPrbMap[String(p.id)]) return;
          if (!prbByRes[p.reservationId]) prbByRes[p.reservationId] = [];
          prbByRes[p.reservationId].push(p);
        });
        var touchedDetailIds = {};
        Object.keys(prbByRes).forEach(function (rid) {
          touchedDetailIds[rid] = true;
          var detEntry = localDetailsByNs[ns][rid];
          if (detEntry) {
            var cleanExistingPrb = (Array.isArray(detEntry.problems) ? detEntry.problems : []).filter(function (p) {
              return p && String(p.id || '').indexOf('PRB_OPT_') !== 0 && !delPrbMap[String(p.id)];
            });
            detEntry.problems = core.mergeDeltaRecords(cleanExistingPrb, prbByRes[rid], 'id');
            detEntry.cachedAt = Date.now();
            if (root.RGIdbCache) {
              root.RGIdbCache.upsertReservationDetail(ns, detEntry).catch(function () {});
            }
          }
        });
        if (delPrbIds.length > 0) {
          Object.keys(localDetailsByNs[ns]).forEach(function (rid) {
            var detEntry = localDetailsByNs[ns][rid];
            if (!detEntry || !Array.isArray(detEntry.problems)) return;
            var hadRemoved = detEntry.problems.some(function (p) { return p && delPrbMap[String(p.id)]; });
            if (!hadRemoved) return;
            detEntry.problems = detEntry.problems.filter(function (p) { return p && !delPrbMap[String(p.id)]; });
            if (Array.isArray(detEntry.problemUpdates)) {
              detEntry.problemUpdates = detEntry.problemUpdates.filter(function (u) { return u && !delPrbMap[String(u.problemId)]; });
            }
            if (detEntry.reservation) {
              detEntry.reservation = Object.assign({}, detEntry.reservation, {
                hasProblem: detEntry.problems.some(function (p) { return !core.isProblemClosedStatus(p.status); })
              });
            }
            detEntry.cachedAt = Date.now();
            if (!touchedDetailIds[rid] && root.RGIdbCache) {
              root.RGIdbCache.upsertReservationDetail(ns, detEntry).catch(function () {});
            }
          });
        }
      }
      if (core && core.mergeDeltaRecords) {
        patchCachedScopes(['problems', 'reservations'], function (data, actName, entryKey) {
          if (actName === 'getProblems' && Array.isArray(data.items)) {
            return patchProblemCachedQuery(data, entryKey, chPrb, [], delPrbIds);
          }
          if (actName === 'getProblemDetails' && data.problem) {
            if (delPrbMap[String(data.problem.id)]) {
              return { __rgDeleteCacheEntry: true };
            }
            var mp = chPrb.find(function (x) { return x && x.id === data.problem.id; });
            if (mp) return Object.assign({}, data, { problem: Object.assign({}, data.problem, mp) });
          }
          if (actName === 'getReservationDetails' && data.reservation && data.reservation.id) {
            var resPrbs = chPrb.filter(function (p) { return p && p.reservationId === data.reservation.id && !delPrbMap[String(p.id)]; });
            var existingPrbs = Array.isArray(data.problems) ? data.problems : [];
            var removedSome = existingPrbs.some(function (p) { return p && delPrbMap[String(p.id)]; });
            if (resPrbs.length > 0 || removedSome) {
              var cleanedPrbs = existingPrbs.filter(function (p) {
                return p && String(p.id || '').indexOf('PRB_OPT_') !== 0 && !delPrbMap[String(p.id)];
              });
              var mergedResPrbs = resPrbs.length > 0 ? core.mergeDeltaRecords(cleanedPrbs, resPrbs, 'id') : cleanedPrbs;
              return Object.assign({}, data, {
                problems: mergedResPrbs,
                problemUpdates: Array.isArray(data.problemUpdates)
                  ? data.problemUpdates.filter(function (u) { return u && !delPrbMap[String(u.problemId)]; })
                  : data.problemUpdates,
                reservation: Object.assign({}, data.reservation, {
                  hasProblem: mergedResPrbs.some(function (p) { return !core.isProblemClosedStatus(p.status); })
                })
              });
            }
          }
          return undefined;
        });
      }
    }

    var chEmp = Array.isArray(delta.changedEmployees) ? delta.changedEmployees : [];
    var delEmpIds = Array.isArray(delta.deletedEmployeeIds) ? delta.deletedEmployeeIds : [];
    if (chEmp.length > 0 || delEmpIds.length > 0) {
      touchedScopes.employees = true;
      var delEmpMap = {};
      delEmpIds.forEach(function (id) { if (id) delEmpMap[String(id)] = true; });
      if (core && core.mergeDeltaRecords) {
        patchCachedScopes(['employees'], function (data, actName) {
          if (actName === 'getEmployees' && Array.isArray(data.items)) {
            var nextItems = chEmp.length > 0 ? core.mergeDeltaRecords(data.items, chEmp, 'id') : data.items.slice();
            if (delEmpIds.length > 0) {
              nextItems = nextItems.filter(function (emp) { return emp && !delEmpMap[String(emp.id)]; });
            }
            return Object.assign({}, data, { items: nextItems });
          }
          return undefined;
        });
      }
    }

    var delNtfIds = Array.isArray(delta.deletedNotificationIds) ? delta.deletedNotificationIds : [];
    var delAllNtfBefore = delta.deletedAllNotificationsBefore || '';
    if (delNtfIds.length > 0 || delAllNtfBefore) {
      recordNotifTombstones(ns, delNtfIds, delAllNtfBefore, { confirmed: true });
      touchedScopes.notifications = true;
    }

    var notifStDelta = getNotifMutationState(ns);
    if (!delta._staleNotificationsSkipped && notifStDelta.inFlightCount === 0 && delta.notifications && Array.isArray(delta.notifications.items)) {
      touchedScopes.notifications = true;
      primeCache('getNotifications', {}, sanitizeNotificationsForNs(ns, delta.notifications));
    } else if (delNtfIds.length > 0 || delAllNtfBefore) {
      patchCachedScopes(['notifications'], function (data, actName) {
        if (actName !== 'getNotifications' || !Array.isArray(data.items)) return undefined;
        return sanitizeNotificationsForNs(ns, data);
      });
      schedulePersistApiCache(true);
    }

    if (Array.isArray(delta.announcements)) {
      touchedScopes.announcements = true;
      patchCachedScopes(['announcements'], function (data) {
        return Object.assign({}, data, { activeItems: delta.announcements });
      });
    }

    if (Array.isArray(delta.deletedAnnouncementIds) && delta.deletedAnnouncementIds.length > 0) {
      touchedScopes.announcements = true;
      extraInvalidates.push('announcements');
    }

    if (delta.changedDelegations || delta.changedRoles) {
      touchedScopes.employees = true;
      extraInvalidates.push('employees');
    }
    if (delta.changedSettings) {
      touchedScopes.settings = true;
      touchedScopes.dashboard = true;
      extraInvalidates.push('settings', 'dashboard', 'employees');
    }

    var delResIds = Array.isArray(delta.deletedReservationIds) ? delta.deletedReservationIds : [];
    if (delResIds.length > 0) {
      var delResMap = {};
      delResIds.forEach(function (id) { if (id) delResMap[String(id)] = true; });
      touchedScopes.reservations = true;
      touchedScopes.todayRadar = true;
      touchedScopes.followUps = true;
      touchedScopes.problems = true;
      touchedScopes.dashboard = true;
      touchedScopes.reports = true;
      if (localReservationsByNs[ns] && Array.isArray(localReservationsByNs[ns].list)) {
        var remainingRes = localReservationsByNs[ns].list.filter(function (r) { return r && !delResMap[String(r.id)]; });
        setLocalReservationsState(ns, remainingRes, true);
      }
      delResIds.forEach(function (did) {
        if (localDetailsByNs[ns]) delete localDetailsByNs[ns][did];
      });
      patchCachedScopes(['reservations', 'todayRadar', 'followUps', 'problems'], function (data, actName, entryKey) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return patchReservationCachedQuery(data, entryKey, [], delResIds);
        }
        if (actName === 'getTodayAndRadar' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.filter(function (r) { return r && !delResMap[String(r.id)]; }) });
        }
        if (actName === 'getTeamFollowUps' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.filter(function (f) { return f && !delResMap[String(f.reservationId)]; }) });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.filter(function (r) { return r && !delResMap[String(r.id)]; }) });
        }
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          return patchProblemCachedQuery(data, entryKey, [], delResIds);
        }
        return undefined;
      });
    }

    if (delta.hasMoreReservations) extraInvalidates.push('reservations', 'todayRadar');
    if (delta.hasMoreFollowUps) extraInvalidates.push('followUps');
    if (delta.hasMoreProblems) extraInvalidates.push('problems');

    var invalidateList = extraInvalidates.slice();
    if (touchedScopes.dashboard) invalidateList.push('dashboard');
    if (touchedScopes.todayRadar) invalidateList.push('todayRadar');
    if (touchedScopes.reports) invalidateList.push('reports');
    if (invalidateList.length > 0) {
      var dedupInv = [];
      invalidateList.forEach(function (sc) { if (sc && dedupInv.indexOf(sc) === -1) dedupInv.push(sc); });
      if (delta.deletedAllReservationsBefore) {
        clearCache(dedupInv);
      } else {
        markScopesStale(dedupInv);
      }
    }

    if (delta.syncVersion && root.RGIdbCache && typeof root.RGIdbCache.recordServerSyncState === 'function') {
      root.RGIdbCache.recordServerSyncState(ns, {
        syncEpoch: 'v' + String(delta.syncVersion),
        lastSyncAt: delta.serverTime || new Date().toISOString()
      }).catch(function () {});
    }

    return { changedScopes: Object.keys(touchedScopes) };
  }

  var clientSpamStateByToken = {};
  var syncProgressSeq = 0;
  var FOREGROUND_SYNC_ACTIONS = {
    syncRentalGate: true,
    pullReservations: true,
    retryFailedSyncRecords: true,
    syncLocalCache: true,
    applyUnifiedConnectionSetup: true,
    importReservationsFromExcel: true,
    deleteAllReservations: true,
    syncOfflineQueue: true
  };

  function getSpamStateForToken(token) {
    var tKey = token ? ('tok_' + String(token).slice(-24)) : 'anon';
    if (!clientSpamStateByToken[tKey]) {
      clientSpamStateByToken[tKey] = { timestamps: [], signatures: {} };
    }
    return clientSpamStateByToken[tKey];
  }

  function buildClientSpamSignature(action, payload, token) {
    var obj = (payload && typeof payload === 'object') ? payload : {};
    var clone = {};
    Object.keys(obj).sort().forEach(function (k) {
      if (k === 'clientRequestId' || k === 'expectedUpdatedAt' || k === 'nowMs' || k === '_keepOptimisticCache' || k === '_replayingOfflineQueue' || k === 'originTabId') return;
      clone[k] = obj[k];
    });
    var serialized = '';
    try { serialized = JSON.stringify(clone); } catch (_e) { serialized = ''; }
    var tokScope = token ? String(token).slice(-12) : 'anon';
    return tokScope + ':' + String(action || '').trim() + ':' + serialized.slice(0, 320);
  }

  function isTrackedSyncProcess(action, payload) {
    var clean = String(action || '').trim();
    if (!clean) return false;
    if (payload && (payload.silentRefresh || payload.backgroundSync)) return false;
    if (FOREGROUND_SYNC_ACTIONS[clean]) return true;
    return Boolean(payload && payload.showGlobalLoading === true);
  }

  function emitSyncProgress(phase, detail) {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('rg:syncprogress', {
          detail: Object.assign({ phase: phase }, detail || {})
        }));
      }
    } catch (_eSync) {}
  }

  async function callApi(action, payload) {
    await probeBackendHealth();
    var backendUrl = getBackendApiUrl();
    var gasUrl = backendUrl ? '' : getGasUrl();
    var useServerGasFallback = Boolean(!backendUrl && !gasUrl && getConfiguredMode() === 'gas' && detectedBackendProxyAvailable && detectedEnvGasConfigured);
    var transportUrl = backendUrl || gasUrl || (useServerGasFallback ? 'vercel://gas-proxy' : '');
    var token = getToken();
    var core = root.RGCrmCore;
    var ns = getCacheNamespace();

    var reqPayload = payload && typeof payload === 'object' ? Object.assign({}, payload) : {};
    var isReplay = Boolean(reqPayload._replayingOfflineQueue);
    var alreadySpamChecked = Boolean(reqPayload._spamChecked);
    if (reqPayload._spamChecked !== undefined) delete reqPayload._spamChecked;
    var spamState = null;
    var spamSig = '';
    if (core && typeof core.evaluateSpamGuard === 'function' && !isReplay && !alreadySpamChecked) {
      var policyPre = (core.getApiCachePolicy) ? core.getApiCachePolicy(action) : { cacheable: false };
      if (!policyPre.cacheable) {
        spamState = getSpamStateForToken(token);
        spamSig = buildClientSpamSignature(action, reqPayload, token);
        var spamRes = core.evaluateSpamGuard(spamState, action, spamSig, {
          duplicateWindowMs: 1200,
          burstWindowMs: 10000,
          maxBurst: 25
        });
        if (!spamRes.allowed) {
          return {
            success: false,
            spamBlocked: true,
            waitMs: spamRes.waitMs || 1200,
            message: spamRes.message || 'تم إرسال نفس العملية قبل لحظات، تم منع التكرار التلقائي.',
            data: null,
            error: spamRes.reason || 'DUPLICATE_SUBMISSION'
          };
        }
      }
    }
    if (!reqPayload.clientRequestId && !(core && core.SPAM_GUARD_EXEMPT_ACTIONS && core.SPAM_GUARD_EXEMPT_ACTIONS[action])) {
      reqPayload.clientRequestId = generateClientRequestId(action);
    }
    var policy = (core && core.getApiCachePolicy) ? core.getApiCachePolicy(action) : { cacheable: false, ttlMs: 0, scope: '' };
    if (!policy.cacheable && !reqPayload.originTabId && root.__RG_TAB_ID__) {
      reqPayload.originTabId = String(root.__RG_TAB_ID__);
    }
    payload = reqPayload;
    var isSilentRefresh = Boolean(payload && payload.silentRefresh);
    var isForceRefresh = Boolean(payload && payload.forceRefresh);
    var abortKey = payload && payload.abortKey ? String(payload.abortKey).trim() : '';
    var skipCache = Boolean((payload && (isForceRefresh || payload.logExport)) || isSilentRefresh);
    var shouldWriteCache = Boolean(policy.cacheable && !(payload && payload.logExport));
    var cacheKey = (policy.cacheable && core && core.buildApiCacheKey)
      ? core.buildApiCacheKey(transportUrl, token, action, payload)
      : '';

    // Instant local IndexedDB query path for reservations & today/radar filtering/sorting/pagination
    if ((action === 'getReservations' || action === 'getTodayAndRadar') && !skipCache) {
      var activeUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
      var fastUserCtx = activeUser ? {
        employeeId: activeUser.id,
        role: activeUser.role,
        user: activeUser,
        allowAgentViewAll: !(localMetaByNs[ns] && localMetaByNs[ns].allowAgentViewAll === false)
      } : null;
      if (action === 'getReservations') {
        var fastLocalRes = queryLocalReservationsFast(payload, fastUserCtx);
        if (fastLocalRes) {
          return fastLocalRes.response;
        }
      } else if (action === 'getTodayAndRadar') {
        var fastTodayRadar = queryLocalTodayAndRadarFast(payload, fastUserCtx);
        if (fastTodayRadar) {
          return fastTodayRadar.response;
        }
      }
    }

    // Coalesce identical cacheable in-flight requests even if abortKey is provided with identical params
    if (policy.cacheable && !isForceRefresh && cacheKey && inFlightRequests[cacheKey]) {
      var existingCtrl = abortKey ? activeAbortControllers[abortKey] : null;
      if (!abortKey || !existingCtrl || existingCtrl.cacheKey === cacheKey) {
        return inFlightRequests[cacheKey];
      }
    }

    var callerController = null;
    var myAbortSeq = 0;
    if (abortKey && typeof AbortController !== 'undefined') {
      if (activeAbortControllers[abortKey]) {
        try { activeAbortControllers[abortKey].controller.abort(); } catch (_eAbort) {}
      }
      callerController = new AbortController();
      myAbortSeq = ++abortRequestSeq;
      activeAbortControllers[abortKey] = { controller: callerController, seq: myAbortSeq, cacheKey: cacheKey };
    }

    var startNetworkOrSandbox = function () {
      var promise = executeCall().finally(function () {
        if (cacheKey) delete inFlightRequests[cacheKey];
        if (abortKey && activeAbortControllers[abortKey] && activeAbortControllers[abortKey].seq === myAbortSeq) {
          delete activeAbortControllers[abortKey];
        }
      });
      if (cacheKey) {
        inFlightRequests[cacheKey] = promise;
      }
      return promise;
    };

    if (policy.cacheable && !skipCache && cacheKey && apiResponseCache[cacheKey]) {
      var cachedEntry = apiResponseCache[cacheKey];
      var nowTs = Date.now();
      var isPageValidated = !transportUrl || Boolean(revalidatedInPage[cacheKey]);
      if (isPageValidated && nowTs < cachedEntry.expiresAt) {
        return cachedEntry.response;
      }
      if ((isPageValidated || cachedEntry.swrValidInPage) && nowTs < (cachedEntry.staleUntil || 0)) {
        if (!inFlightRequests[cacheKey]) {
          startNetworkOrSandbox().catch(function () {});
        }
        return cachedEntry.response;
      }
      if (nowTs >= (cachedEntry.staleUntil || 0)) {
        delete apiResponseCache[cacheKey];
      }
    }

    var mutLockKey = (!policy.cacheable && core && core.buildMutationLockKey)
      ? core.buildMutationLockKey(action, payload)
      : (!policy.cacheable ? String(action || '') : '');

    if (!policy.cacheable && mutLockKey && inFlightMutations[mutLockKey]) {
      return inFlightMutations[mutLockKey];
    }

    var OFFLINE_QUEUEABLE = {
      addFollowUp: 'إضافة متابعة',
      updateFollowUp: 'تعديل متابعة',
      quickUpdateReservationStatus: 'تحديث حالة حجز',
      recordNoAnswerFollowUp: 'تسجيل محاولة اتصال',
      saveReservationPinnedNote: 'حفظ ملاحظة المشرف',
      updateProblem: 'تحديث مشكلة'
    };

    function isOfflineNow() {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        if (typeof localStorage !== 'undefined' && localStorage.getItem('rg_crm_force_offline') === '1') return true;
      } catch (_e) {}
      return false;
    }

    async function enqueueAndApplyOffline(errReason) {
      var actUser = (root.RGAuth && root.RGAuth.getUser && root.RGAuth.getUser()) || { id: '', name: 'الموظف' };
      try {
        applyOptimisticMutation(action, payload, actUser);
      } catch (_optErr) {}
      var queuedItem = null;
      if (root.RGIdbCache && typeof root.RGIdbCache.enqueueOfflineAction === 'function') {
        queuedItem = await root.RGIdbCache.enqueueOfflineAction({
          ns: ns,
          action: action,
          payload: Object.assign({}, payload || {}, { _keepOptimisticCache: true }),
          label: OFFLINE_QUEUEABLE[action] || action,
          createdAt: Date.now()
        });
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('rg:offlinequeuechange', {
          detail: { reason: errReason || 'offline', item: queuedItem }
        }));
      }
      var updatedRes = (localReservationsByNs[ns] && payload && payload.reservationId && localReservationsByNs[ns].byId[payload.reservationId]) || null;
      return {
        success: true,
        queuedOffline: true,
        message: 'تم حفظ الإجراء محلياً في قائمة الانتظار وسيُرفع تلقائياً فور عودة الاتصال.',
        data: { queuedOffline: true, reservation: updatedRes, offlineItem: queuedItem },
        error: null
      };
    }

    function isCallerAborted() {
      return Boolean(callerController && callerController.signal && callerController.signal.aborted);
    }

    function isRetryableReadFailure(resObj, hadNetworkFailure) {
      if (!policy.cacheable || isCallerAborted()) return false;
      if (hadNetworkFailure) return true;
      if (!resObj || resObj.success) return false;
      var errCode = String(resObj.error || '').toUpperCase();
      return errCode === 'GATEWAY_ERROR' || errCode === 'TIMEOUT' || errCode === 'EMPTY_RESPONSE' ||
        errCode === 'HTTP_429' || errCode === 'HTTP_502' || errCode === 'HTTP_503' || errCode === 'HTTP_504';
    }

    function waitRetryJitter(attemptIdx) {
      var base = attemptIdx === 0 ? 180 : 480;
      var jitter = Math.floor(Math.random() * 140);
      return new Promise(function (resolve) { setTimeout(resolve, base + jitter); });
    }

    var isForegroundSync = isTrackedSyncProcess(action, payload);
    var syncReqId = isForegroundSync ? ('SYNC_' + (++syncProgressSeq) + '_' + Date.now()) : '';

    async function executeCall() {
      if (!isForegroundSync) {
        return runExecuteCall();
      }
      var syncOk = false;
      emitSyncProgress('start', {
        requestId: syncReqId,
        action: action,
        timestamp: Date.now()
      });
      try {
        var outRes = await runExecuteCall();
        syncOk = Boolean(outRes && outRes.success);
        return outRes;
      } finally {
        emitSyncProgress('end', {
          requestId: syncReqId,
          action: action,
          timestamp: Date.now(),
          success: syncOk
        });
      }
    }

    var callNotifSt = getNotifMutationState(ns);
    var callStartNotifEpoch = callNotifSt.epoch;

    async function runExecuteCall() {
      if (isCallerAborted()) {
        return { success: false, aborted: true, message: '', data: null, error: 'ABORTED' };
      }
      if (OFFLINE_QUEUEABLE[action] && isOfflineNow() && !(payload && payload._replayingOfflineQueue)) {
        return enqueueAndApplyOffline('offline');
      }
      var isNotifMutAction = action === 'deleteNotification' || action === 'markNotificationRead';
      if (isNotifMutAction) callNotifSt.inFlightCount += 1;
      try {
      var parsed = null;
      var networkFailed = false;
      var maxAttempts = (policy.cacheable && transportUrl) ? 3 : 1;

      for (var attempt = 0; attempt < maxAttempts; attempt++) {
        if (isCallerAborted()) {
          return { success: false, aborted: true, message: '', data: null, error: 'ABORTED' };
        }
        parsed = null;
        networkFailed = false;

        if (!transportUrl) {
          parsed = sandboxExecute(action, token, payload);
        } else if (backendUrl) {
          var bTimeoutId = null;
          var bTimedOut = false;
          var onCallerAbortB = null;
          try {
            var bPayload = (core && core.compactGasPayload) ? core.compactGasPayload(payload) : (payload || {});
            var bOpts = {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({ action: action, token: token || '', payload: bPayload })
            };
            if (typeof AbortController !== 'undefined') {
              var bController = new AbortController();
              var bTimeoutMs = (core && core.getGasActionTimeoutMs) ? core.getGasActionTimeoutMs(action) : 35000;
              bOpts.signal = bController.signal;
              if (callerController) {
                onCallerAbortB = function () { try { bController.abort(); } catch (_e) {} };
                if (callerController.signal.aborted) onCallerAbortB();
                else callerController.signal.addEventListener('abort', onCallerAbortB, { once: true });
              }
              bTimeoutId = setTimeout(function () {
                bTimedOut = true;
                try { bController.abort(); } catch (e) {}
              }, bTimeoutMs);
            }
            var bResponse = await fetch(backendUrl, bOpts);
            if (bResponse) {
              detectVersionHeader(bResponse);
              notifyNetworkState(true, 'api_ok', action);
            }
            var bContentType = bResponse.headers && bResponse.headers.get ? (bResponse.headers.get('content-type') || '') : '';
            var bText = await bResponse.text();
            if (bTimeoutId) clearTimeout(bTimeoutId);
            if (callerController && onCallerAbortB) callerController.signal.removeEventListener('abort', onCallerAbortB);
            parsed = (core && core.parseBackendResponseText)
              ? core.parseBackendResponseText(bText, bResponse.status, bContentType)
              : (bText ? JSON.parse(bText) : { success: false, message: 'استجابة فارغة من خادم قاعدة البيانات السحابية.', data: null, error: 'EMPTY_RESPONSE' });
            if ((action === 'pullReservations' || action === 'syncRentalGate' || action === 'testConnection' || action === 'getSyncStatus') && typeof console !== 'undefined' && typeof console.info === 'function') {
              var bRawJson = null;
              try { bRawJson = bText ? JSON.parse(bText) : null; } catch (bJsonErr) { bRawJson = { _parseError: String(bJsonErr && bJsonErr.message ? bJsonErr.message : bJsonErr) }; }
              var bRawData = bRawJson && typeof bRawJson === 'object' ? bRawJson.data : null;
              console.info('[RGApi:SyncBackendDiag]', {
                action: action,
                endpoint: backendUrl,
                status: bResponse.status,
                statusText: bResponse.statusText,
                ok: bResponse.ok,
                contentType: bContentType,
                rawTextLength: bText ? bText.length : 0,
                rawTopLevelKeys: bRawJson && typeof bRawJson === 'object' ? Object.keys(bRawJson) : typeof bRawJson,
                rawDataKeys: bRawData && typeof bRawData === 'object' ? Object.keys(bRawData) : typeof bRawData,
                rawDataStructure: bRawData || bRawJson,
                parsedSuccess: Boolean(parsed && parsed.success),
                parsedError: parsed && parsed.error ? parsed.error : null
              });
            }
            if (!parsed.success && String(parsed.error || '').indexOf('UNAUTHORIZED') === 0) {
              setToken('');
              document.dispatchEvent(new CustomEvent('rg:unauthorized'));
            }
          } catch (bErr) {
            if (bTimeoutId) clearTimeout(bTimeoutId);
            if (callerController && onCallerAbortB) callerController.signal.removeEventListener('abort', onCallerAbortB);
            if (isCallerAborted()) {
              return { success: false, aborted: true, message: '', data: null, error: 'ABORTED' };
            }
            var isBAbort = bTimedOut || (bErr && (bErr.name === 'AbortError' || String(bErr.message || '').indexOf('abort') !== -1));
            networkFailed = true;
            notifyNetworkState(false, isBAbort ? 'timeout' : 'network_error', action);
            parsed = {
              success: false,
              message: isBAbort
                ? 'انتهت مهلة الاتصال بخادم قاعدة البيانات السحابية. يرجى المحاولة مرة أخرى.'
                : ('تعذر الاتصال بخادم قاعدة البيانات السحابية: ' + (bErr.message || bErr)),
              data: null,
              error: isBAbort ? 'TIMEOUT' : (bErr.message || 'NETWORK_ERROR')
            };
          }
        } else {
          if (gasUrl && core && core.validateGasUrl) {
            var check = core.validateGasUrl(gasUrl);
            if (!check.valid) {
              return {
                success: false,
                message: check.message,
                data: null,
                error: 'INVALID_GAS_URL'
              };
            }
          }

          var isGasSyncDiag = action === 'pullReservations' || action === 'syncRentalGate' || action === 'testConnection' || action === 'getSyncStatus';
          var timeoutId = null;
          var gasTimedOut = false;
          var onCallerAbortG = null;
          var cleanGasUrl = (gasUrl && core && core.validateGasUrl) ? core.validateGasUrl(gasUrl).normalized : (gasUrl || '');
          var compactPayload = (core && core.compactGasPayload) ? core.compactGasPayload(payload) : (payload || {});

          var tryGasProxyFallback = async function () {
            if (typeof callBackendSetupEndpoint !== 'function') return null;
            var proxyRes = await callBackendSetupEndpoint('gasProxy', {
              gasUrl: cleanGasUrl,
              action: action,
              token: token || '',
              payload: compactPayload
            });
            if (!proxyRes || proxyRes.staticHostOnly) return null;
            if (cleanGasUrl && (proxyRes.success || (proxyRes.error && proxyRes.error !== 'NETWORK_ERROR' && proxyRes.error !== 'BACKEND_NOT_FOUND'))) {
              gasServerProxyUrls[cleanGasUrl] = true;
            }
            return proxyRes;
          };

          try {
            if (detectedBackendProxyAvailable || !cleanGasUrl || gasServerProxyUrls[cleanGasUrl]) {
              var directProxyRes = await tryGasProxyFallback();
              if (directProxyRes) {
                parsed = directProxyRes;
              }
            }
            if (!parsed && !cleanGasUrl) {
              return {
                success: false,
                message: 'رابط Google Apps Script غير مضبوط على وسيط Vercel بعد.',
                data: null,
                error: 'MISSING_GAS_URL'
              };
            }
            if (!parsed) {
              var opts = (core && core.buildGasFetchOptions)
                ? core.buildGasFetchOptions(action, token, payload)
                : {
                    method: 'POST',
                    redirect: 'follow',
                    credentials: 'omit',
                    cache: 'no-store',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: action, token: token, payload: compactPayload })
                  };
              if (opts && opts.keepalive) {
                opts = Object.assign({}, opts);
                delete opts.keepalive;
              }

              if (typeof AbortController !== 'undefined') {
                var controller = new AbortController();
                var timeoutMs = (core && core.getGasActionTimeoutMs) ? core.getGasActionTimeoutMs(action) : 35000;
                opts.signal = controller.signal;
                if (callerController) {
                  onCallerAbortG = function () { try { controller.abort(); } catch (_e) {} };
                  if (callerController.signal.aborted) onCallerAbortG();
                  else callerController.signal.addEventListener('abort', onCallerAbortG, { once: true });
                }
                timeoutId = setTimeout(function () {
                  gasTimedOut = true;
                  try { controller.abort(); } catch (e) {}
                }, timeoutMs);
              }

              var response = await fetch(cleanGasUrl, opts);
              var text = await response.text();
              if (timeoutId) clearTimeout(timeoutId);
              if (callerController && onCallerAbortG) callerController.signal.removeEventListener('abort', onCallerAbortG);
              parsed = (core && core.parseGasResponseText)
                ? core.parseGasResponseText(text, response.status)
                : JSON.parse(text);

              if (isGasSyncDiag && typeof console !== 'undefined' && typeof console.info === 'function') {
                var gasContentType = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
                var rawJsonStruct = null;
                try {
                  rawJsonStruct = text ? JSON.parse(text) : null;
                } catch (jsonDiagErr) {
                  rawJsonStruct = {
                    _parseError: jsonDiagErr && jsonDiagErr.message ? jsonDiagErr.message : String(jsonDiagErr)
                  };
                }
                var rawDataObj = rawJsonStruct && typeof rawJsonStruct === 'object' ? rawJsonStruct.data : null;
                console.info('[RGApi:GasSyncDiag]', {
                  action: action,
                  gasUrl: cleanGasUrl,
                  status: response.status,
                  statusText: response.statusText,
                  ok: response.ok,
                  redirected: Boolean(response.redirected),
                  finalUrl: response.url || '',
                  contentType: gasContentType,
                  rawTextLength: text ? text.length : 0,
                  rawTextPreview: text ? text.slice(0, 1200) : '',
                  rawTopLevelKeys: rawJsonStruct && typeof rawJsonStruct === 'object' ? Object.keys(rawJsonStruct) : typeof rawJsonStruct,
                  rawDataKeys: rawDataObj && typeof rawDataObj === 'object' ? Object.keys(rawDataObj) : typeof rawDataObj,
                  rawDataStructure: rawDataObj !== undefined && rawDataObj !== null ? rawDataObj : rawJsonStruct,
                  parsedSuccess: Boolean(parsed && parsed.success),
                  parsedError: parsed && parsed.error ? parsed.error : null,
                  parsedMessage: parsed && parsed.message ? parsed.message : ''
                });
              }
            }

            if (!parsed.success && String(parsed.error || '').indexOf('UNAUTHORIZED') === 0) {
              setToken('');
              document.dispatchEvent(new CustomEvent('rg:unauthorized'));
            }
          } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (callerController && onCallerAbortG) callerController.signal.removeEventListener('abort', onCallerAbortG);
            if (isCallerAborted()) {
              return { success: false, aborted: true, message: '', data: null, error: 'ABORTED' };
            }
            var isAbort = gasTimedOut || (err && (err.name === 'AbortError' || String(err.message || '').indexOf('abort') !== -1));
            if (!isAbort) {
              var proxiedErrFallback = await tryGasProxyFallback();
              if (proxiedErrFallback) {
                parsed = proxiedErrFallback;
                if (!parsed.success && String(parsed.error || '').indexOf('UNAUTHORIZED') === 0) {
                  setToken('');
                  document.dispatchEvent(new CustomEvent('rg:unauthorized'));
                }
              }
            }
            if (!parsed) {
              if (isGasSyncDiag && typeof console !== 'undefined' && typeof console.error === 'function') {
                console.error('[RGApi:GasSyncDiag] Fetch error:', {
                  action: action,
                  gasUrl: cleanGasUrl,
                  errorName: err && err.name ? err.name : '',
                  errorMessage: err && err.message ? err.message : String(err)
                });
              }
              networkFailed = true;
              parsed = {
                success: false,
                message: isAbort
                  ? 'انتهت مهلة الاتصال بخادم Google Apps Script. يرجى المحاولة مرة أخرى.'
                  : ('تعذر الاتصال بخادم Google Apps Script. تأكد من صحة رابط /exec واتصالك بالإنترنت وصلاحيات النشر (Anyone): ' + (err.message || err)),
                data: null,
                error: isAbort ? 'TIMEOUT' : (err.message || 'NETWORK_ERROR')
              };
            }
          }
        }

        if (attempt + 1 < maxAttempts && isRetryableReadFailure(parsed, networkFailed)) {
          await waitRetryJitter(attempt);
          continue;
        }
        break;
      }

      if (isCallerAborted()) {
        return { success: false, aborted: true, message: '', data: null, error: 'ABORTED' };
      }

      if (networkFailed && OFFLINE_QUEUEABLE[action] && !(payload && payload._replayingOfflineQueue)) {
        return enqueueAndApplyOffline('network_error');
      }

      if (networkFailed && !skipCache && policy.cacheable && cacheKey && apiResponseCache[cacheKey]) {
        var offlineEntry = apiResponseCache[cacheKey];
        if (offlineEntry && offlineEntry.response && Date.now() < (offlineEntry.staleUntil || 0)) {
          return offlineEntry.response;
        }
      }

      if (parsed && parsed.success) {
        if (action === 'login' && parsed.data && parsed.data.token) {
          setToken(parsed.data.token);
        } else if (action === 'logout') {
          setToken('');
        }
        var postMutNs = getCacheNamespace();
        var postMutSt = getNotifMutationState(postMutNs);
        var staleNotifSnapshot = Boolean(postMutSt.inFlightCount > 0 || postMutSt.epoch !== callStartNotifEpoch);
        if (action === 'getNotifications' && parsed.data) {
          parsed = Object.assign({}, parsed, { data: sanitizeNotificationsForNs(postMutNs, parsed.data) });
        } else if (action === 'getDeltaSync' && parsed.data && parsed.data.notifications) {
          var nextDeltaNotifs = sanitizeNotificationsForNs(postMutNs, parsed.data.notifications);
          parsed = Object.assign({}, parsed, {
            data: Object.assign({}, parsed.data, {
              notifications: nextDeltaNotifs,
              _staleNotificationsSkipped: staleNotifSnapshot
            })
          });
        } else if (action === 'getAppBootstrap' && parsed.data && parsed.data.notifications) {
          parsed = Object.assign({}, parsed, {
            data: Object.assign({}, parsed.data, {
              notifications: sanitizeNotificationsForNs(postMutNs, parsed.data.notifications)
            })
          });
        }
        var pendingIdbOps = [];
        if (action === 'getDashboard' && parsed.data && parsed.data.kpis && root.RGIdbCache && typeof root.RGIdbCache.recordServerSyncState === 'function') {
          var dashSyncAt = (parsed.data.lastSync && parsed.data.lastSync.finishedAt) || (detectedServerSyncMeta && detectedServerSyncMeta.lastSyncAt) || '';
          pendingIdbOps.push(root.RGIdbCache.recordServerSyncState(ns, {
            syncEpoch: (detectedServerSyncMeta && detectedServerSyncMeta.syncEpoch) || '',
            reservationsCount: (detectedServerSyncMeta && detectedServerSyncMeta.reservationsCount !== undefined) ? detectedServerSyncMeta.reservationsCount : undefined,
            lastResUpdatedAt: (detectedServerSyncMeta && detectedServerSyncMeta.lastResUpdatedAt) || '',
            lastSyncAt: dashSyncAt
          }).catch(function () {}));
        } else if (action === 'getAppBootstrap' && parsed.data && parsed.data.dashboard && parsed.data.dashboard.kpis && root.RGIdbCache && typeof root.RGIdbCache.recordServerSyncState === 'function') {
          var bootSyncAt = (parsed.data.dashboard.lastSync && parsed.data.dashboard.lastSync.finishedAt) || (detectedServerSyncMeta && detectedServerSyncMeta.lastSyncAt) || '';
          pendingIdbOps.push(root.RGIdbCache.recordServerSyncState(ns, {
            syncEpoch: (detectedServerSyncMeta && detectedServerSyncMeta.syncEpoch) || '',
            reservationsCount: (detectedServerSyncMeta && detectedServerSyncMeta.reservationsCount !== undefined) ? detectedServerSyncMeta.reservationsCount : undefined,
            lastResUpdatedAt: (detectedServerSyncMeta && detectedServerSyncMeta.lastResUpdatedAt) || '',
            lastSyncAt: bootSyncAt
          }).catch(function () {}));
        } else if (action === 'getReservationDetails' && parsed.data && parsed.data.reservation) {
          setLocalDetailState(ns, parsed.data);
        } else if (action === 'getReservations' && parsed.data && Array.isArray(parsed.data.items) && parsed.data.items.length > 0) {
          pendingIdbOps.push(writeLocalReservationsState(ns, parsed.data.items, false).idbPromise);
        } else if ((action === 'pullReservations' || action === 'syncRentalGate' || action === 'retryFailedSyncRecords') && parsed.data) {
          localReservationsFreshInPage[ns] = false;
          if (localMetaByNs[ns]) localMetaByNs[ns].allReservationsHydrated = false;
          if (Array.isArray(parsed.data.changedReservations) && parsed.data.changedReservations.length > 0) {
            pendingIdbOps.push(writeLocalReservationsState(ns, parsed.data.changedReservations, false, {
              allReservationsHydrated: false,
              lastSyncAt: parsed.data.finishedAt || new Date().toISOString()
            }).idbPromise);
            parsed.data.changedReservations.forEach(function (cr) {
              if (localDetailsByNs[ns] && localDetailsByNs[ns][cr.id]) {
                localDetailsByNs[ns][cr.id] = Object.assign({}, localDetailsByNs[ns][cr.id], {
                  reservation: cr,
                  cachedAt: Date.now()
                });
                if (root.RGIdbCache) pendingIdbOps.push(root.RGIdbCache.upsertReservationDetail(ns, localDetailsByNs[ns][cr.id]).catch(function () {}));
              }
            });
          } else if (root.RGIdbCache) {
            pendingIdbOps.push(root.RGIdbCache.upsertMeta(ns, Object.assign({}, localMetaByNs[ns] || {}, {
              allReservationsHydrated: false,
              lastSyncAt: parsed.data.finishedAt || new Date().toISOString()
            })).catch(function () {}));
          }
          if (root.RGIdbCache && typeof root.RGIdbCache.recordServerSyncState === 'function') {
            pendingIdbOps.push(root.RGIdbCache.recordServerSyncState(ns, {
              lastSyncAt: parsed.data.finishedAt || new Date().toISOString(),
              lastResUpdatedAt: new Date().toISOString()
            }).catch(function () {}));
          }
          if (!transportUrl) syncSandboxSnapshotToIdb(ns);
        } else if (action === 'quickUpdateReservationStatus' && parsed.data && parsed.data.reservation) {
          pendingIdbOps.push(writeLocalReservationsState(ns, [parsed.data.reservation], false).idbPromise);
          if (localDetailsByNs[ns] && localDetailsByNs[ns][parsed.data.reservation.id]) {
            var curDet = localDetailsByNs[ns][parsed.data.reservation.id];
            setLocalDetailState(ns, Object.assign({}, curDet, {
              reservation: parsed.data.reservation,
              followUps: parsed.data.followUp ? [parsed.data.followUp].concat((curDet.followUps || []).filter(function (f) { return String(f.id || '').indexOf('FU_OPT_') !== 0; })) : (curDet.followUps || [])
            }));
          }
        } else if (action === 'updateReservationDetails' && parsed.data && parsed.data.id) {
          pendingIdbOps.push(writeLocalReservationsState(ns, [parsed.data], false).idbPromise);
          if (localDetailsByNs[ns] && localDetailsByNs[ns][parsed.data.id]) {
            setLocalDetailState(ns, Object.assign({}, localDetailsByNs[ns][parsed.data.id], { reservation: parsed.data }));
          }
        } else if (action === 'bulkReassignSelectedReservations' && parsed.data && Array.isArray(parsed.data.updatedReservations) && parsed.data.updatedReservations.length > 0) {
          pendingIdbOps.push(writeLocalReservationsState(ns, parsed.data.updatedReservations, false).idbPromise);
          parsed.data.updatedReservations.forEach(function (ur) {
            if (ur && ur.id && localDetailsByNs[ns] && localDetailsByNs[ns][ur.id]) {
              setLocalDetailState(ns, Object.assign({}, localDetailsByNs[ns][ur.id], { reservation: ur }));
            }
          });
        } else if (action === 'deleteAllReservations' || action === 'importReservationsFromExcel') {
          pendingIdbOps.push(clearCache(['*']));
          if (root.RGIdbCache && typeof root.RGIdbCache.resetBootSyncState === 'function') {
            root.RGIdbCache.resetBootSyncState(ns);
          }
          if (!transportUrl) syncSandboxSnapshotToIdb(ns);
        } else if (!transportUrl && (action === 'addFollowUp' || action === 'updateFollowUp' || action === 'deleteFollowUp' || action === 'recordNoAnswerFollowUp' || action === 'saveReservationPinnedNote' || action === 'togglePinnedCriticalReservation' || action === 'claimReservation' || action === 'unclaimReservation' || action === 'assignEmployees' || action === 'removeAssignment' || action === 'bulkReassignSelectedReservations' || action === 'bulkReassignEmployeeReservations' || action === 'createProblem' || action === 'updateProblem' || action === 'deleteProblem' || action === 'deleteNotification')) {
          var dObj = (parsed && parsed.data) || {};
          var pObj = payload || {};
          var tResId = dObj.reservationId || (dObj.reservation && dObj.reservation.id) || pObj.reservationId || '';
          var tResNum = dObj.reservationNumber || (dObj.reservation && dObj.reservation.reservationNumber) || pObj.reservationNumber || '';
          if (tResId || tResNum) {
            syncSandboxReservationToIdb(ns, tResId, tResNum);
          } else {
            syncSandboxSnapshotToIdb(ns);
          }
        } else if (!transportUrl && action === 'deleteEmployee') {
          syncSandboxSnapshotToIdb(ns);
        }

        if (shouldWriteCache && cacheKey && !(action === 'getNotifications' && staleNotifSnapshot)) {
          var wasRevalidated = Boolean(revalidatedInPage[cacheKey]);
          revalidatedInPage[cacheKey] = true;
          var writeTs = Date.now();
          apiResponseCache[cacheKey] = {
            key: cacheKey,
            ns: ns,
            scope: policy.scope,
            storedAt: writeTs,
            expiresAt: writeTs + policy.ttlMs,
            staleUntil: writeTs + Math.max(policy.ttlMs, IDB_KV_MAX_AGE_MS),
            response: parsed
          };
          schedulePersistApiCache(!wasRevalidated || action === 'getReservations' || action === 'getDashboard' || action === 'getEmployees' || action === 'getTodayAndRadar' || action === 'getNotifications');
        } else if (core && core.getCacheInvalidationScopes) {
          var invScopes = core.getCacheInvalidationScopes(action);
          var skipOptimisticClear = payload && payload._keepOptimisticCache;
          if (action === 'deleteNotification') {
            var confIds = (parsed.data && Array.isArray(parsed.data.deletedIds))
              ? parsed.data.deletedIds
              : (payload && (payload.notificationId || payload.id) ? [payload.notificationId || payload.id] : []);
            var confDelAll = (parsed.data && parsed.data.deletedAllBefore) || (payload && payload.deleteAll ? Date.now() : 0);
            recordNotifTombstones(ns, confIds, confDelAll, { confirmed: true });
            var confirmedNotifs = (parsed.data && Array.isArray(parsed.data.items))
              ? sanitizeNotificationsForNs(ns, { items: parsed.data.items, unreadCount: Number(parsed.data.unreadCount || 0) })
              : sanitizeNotificationsForNs(ns, getCachedData('getNotifications', {}, true) || { items: [], unreadCount: 0 });
            primeCache('getNotifications', {}, confirmedNotifs);
            pendingIdbOps.push(flushPersistApiCache());
          } else if (skipOptimisticClear) {
            var secondaryOnly = invScopes.filter(function (s) {
              return s === 'dashboard' || s === 'todayRadar' || s === 'reports' || s === 'activity' || s === 'employees' || (action === 'deleteProblem' && s === 'notifications');
            });
            if (secondaryOnly.length > 0) pendingIdbOps.push(clearCache(secondaryOnly));
            if (action === 'createProblem' && parsed.data && parsed.data.id) {
              patchCachedScopes(['problems'], function (data, actName, entryKey) {
                if (actName === 'getProblems' && Array.isArray(data.items)) {
                  var hasTemp = data.items.some(function (it) {
                    return String(it.id || '').indexOf('PRB_OPT_') === 0 && it.reservationId === parsed.data.reservationId;
                  });
                  if (hasTemp) {
                    var replaced = data.items.filter(function (it) {
                      return !(String(it.id || '').indexOf('PRB_OPT_') === 0 && it.reservationId === parsed.data.reservationId);
                    });
                    return patchProblemCachedQuery(Object.assign({}, data, { items: replaced }), entryKey, [parsed.data], []);
                  }
                  return patchProblemCachedQuery(data, entryKey, [parsed.data], []);
                }
                return undefined;
              });
            }
            if (action === 'updateProblem' && parsed.data && parsed.data.id) {
              patchCachedScopes(['problems'], function (data, actName, entryKey) {
                if (actName === 'getProblems' && Array.isArray(data.items)) {
                  return patchProblemCachedQuery(data, entryKey, [parsed.data], []);
                }
                if (actName === 'getProblemDetails' && data.problem && data.problem.id === parsed.data.id) {
                  return Object.assign({}, data, { problem: Object.assign({}, data.problem, parsed.data) });
                }
                return undefined;
              });
            }
            if (action === 'deleteProblem' && parsed.data && parsed.data.id) {
              var confirmedDelId = String(parsed.data.id);
              patchCachedScopes(['problems'], function (data, actName, entryKey) {
                if (actName === 'getProblems' && Array.isArray(data.items)) {
                  return patchProblemCachedQuery(data, entryKey, [], [], [confirmedDelId]);
                }
                if (actName === 'getProblemDetails' && data.problem && data.problem.id === confirmedDelId) {
                  return { __rgDeleteCacheEntry: true };
                }
                return undefined;
              });
            }
          } else if (invScopes.length > 0) {
            pendingIdbOps.push(clearCache(invScopes));
          }
        }
        if (pendingIdbOps.length > 0) {
          await Promise.all(pendingIdbOps).catch(function () {});
        }
        if (!policy.cacheable && action !== 'ping' && action !== 'getAppBootstrap' && action !== 'getDeltaSync' && action !== 'getReservationLocks') {
          try {
            if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
              var mutScopes = (core && core.getCacheInvalidationScopes) ? core.getCacheInvalidationScopes(action) : [];
              document.dispatchEvent(new CustomEvent('rg:mutationcomplete', {
                detail: {
                  action: action,
                  scopes: mutScopes,
                  reservationId: (payload && payload.reservationId) || (parsed.data && (parsed.data.reservationId || (parsed.data.reservation && parsed.data.reservation.id))) || '',
                  at: Date.now()
                }
              }));
            }
          } catch (_mEvErr) {}
        }
      } else {
        if (spamState && spamSig && spamState.signatures && !(parsed && parsed.spamBlocked)) {
          delete spamState.signatures[spamSig];
        }
        if (payload && payload._keepOptimisticCache) {
          var rolledBack = restoreLatestOptimisticSnapshot(action);
          try {
            if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
              document.dispatchEvent(new CustomEvent('rg:optimisticrollback', {
                detail: { action: action, rolledBack: rolledBack, at: Date.now() }
              }));
            }
          } catch (_rbErr) {}
          if (core && core.getCacheInvalidationScopes) {
            await clearCache(core.getCacheInvalidationScopes(action));
          }
        }
      }
      return parsed;
      } finally {
        if (isNotifMutAction && callNotifSt.inFlightCount > 0) {
          callNotifSt.inFlightCount -= 1;
        }
      }
    }

    if (policy.cacheable && cacheKey) {
      return startNetworkOrSandbox();
    }

    if (mutLockKey) {
      var mutPromise = executeCall().finally(function () {
        delete inFlightMutations[mutLockKey];
      });
      inFlightMutations[mutLockKey] = mutPromise;
      return mutPromise;
    }

    return executeCall();
  }

  var gasServerProxyUrls = {};

  async function pingGasUrl(url) {
    var clean = String(url || '').trim();
    var core = root.RGCrmCore;

    if (!clean) {
      try {
        var autoServerPing = await callBackendSetupEndpoint('pingGasUrl', {});
        if (autoServerPing && !autoServerPing.staticHostOnly) {
          return autoServerPing;
        }
      } catch (_autoErr) {}
      clean = getGasUrl();
      if (!clean) {
        return {
          success: false,
          message: 'رابط Google Apps Script (/exec) غير مضبوط في إعدادات بيئة الخادم.',
          data: null,
          error: 'MISSING_GAS_URL'
        };
      }
    }

    if (core && core.validateGasUrl) {
      var check = core.validateGasUrl(clean);
      if (!check.valid) {
        return { success: false, message: check.message, data: null, error: 'INVALID_GAS_URL' };
      }
      if (check.isSandbox) {
        return { success: false, message: 'رابط Google Apps Script (/exec) غير مضبوط.', data: null, error: 'EMPTY_URL' };
      }
      clean = check.normalized;
    }

    // 1) Fast, CORS-free server-side probe & diagnosis on Node/Vercel/Cloud Run origins
    try {
      var serverPing = await callBackendSetupEndpoint('pingGasUrl', { gasUrl: clean });
      if (serverPing && !serverPing.staticHostOnly) {
        if (serverPing.success) {
          return {
            success: true,
            message: serverPing.message || 'RENTAL GATE CRM API متصل ويعمل بنجاح.',
            data: Object.assign({}, serverPing.data || {}, { normalizedUrl: clean }),
            error: null
          };
        }
        if (serverPing.message) {
          return serverPing;
        }
      }
    } catch (proxyErr) {}

    // 2) Pure static hosting fallback (e.g. GitHub Pages): Direct POST then GET ?action=ping
    var directError = null;
    var pingTimer = null;
    try {
      var opts = (core && core.buildGasFetchOptions)
        ? core.buildGasFetchOptions('ping', '', {})
        : {
            method: 'POST',
            redirect: 'follow',
            credentials: 'omit',
            cache: 'no-store',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'ping', payload: {} })
          };
      // Prevent Chromium from rejecting cross-origin 302 redirects due to keepalive
      if (opts && opts.keepalive) {
        opts = Object.assign({}, opts);
        delete opts.keepalive;
      }
      if (typeof AbortController !== 'undefined') {
        var pingCtrl = new AbortController();
        opts.signal = pingCtrl.signal;
        pingTimer = setTimeout(function () {
          try { pingCtrl.abort(); } catch (e) {}
        }, 16000);
      }
      var res = await fetch(clean, opts);
      var text = await res.text();
      if (pingTimer) clearTimeout(pingTimer);
      var postParsed = (core && core.parseGasResponseText)
        ? core.parseGasResponseText(text, res.status)
        : JSON.parse(text);
      if (postParsed && postParsed.success) {
        return postParsed;
      }
      directError = postParsed;
    } catch (err) {
      if (pingTimer) clearTimeout(pingTimer);
      directError = err;
    }

    var getTimer = null;
    try {
      var sep = clean.indexOf('?') === -1 ? '?' : '&';
      var getOpts = {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store'
      };
      if (typeof AbortController !== 'undefined') {
        var getCtrl = new AbortController();
        getOpts.signal = getCtrl.signal;
        getTimer = setTimeout(function () {
          try { getCtrl.abort(); } catch (e) {}
        }, 12000);
      }
      var getRes = await fetch(clean + sep + 'action=ping', getOpts);
      var getText = await getRes.text();
      if (getTimer) clearTimeout(getTimer);
      var getParsed = (core && core.parseGasResponseText)
        ? core.parseGasResponseText(getText, getRes.status)
        : JSON.parse(getText);
      if (getParsed && getParsed.success) {
        return getParsed;
      }
      if (
        getParsed &&
        getParsed.success === false &&
        getParsed.message &&
        (!directError || !directError.error || getParsed.error === 'GAS_MISSING_HANDLER' || getParsed.error === 'GAS_AUTH_REQUIRED')
      ) {
        directError = getParsed;
      }
    } catch (getErr) {
      if (getTimer) clearTimeout(getTimer);
    }

    if (directError && directError.success === false && directError.message) {
      return directError;
    }
    var errMsg = (directError && directError.message) ? directError.message : String(directError || 'Failed to fetch');
    return {
      success: false,
      message: 'فشل الاتصال بالرابط (' + errMsg + '). تأكد من محرر Apps Script أن: (1) النشر من نوع Web App وينتهي بـ /exec، (2) خيار Who has access مضبوط على Anyone، (3) Execute as مضبوط على Me، و(4) الرابط لا يحتوي على /u/1/ أو /dev.',
      data: null,
      error: 'NETWORK_ERROR'
    };
  }

  async function callBackendSetupEndpoint(actionName, payload) {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      return { success: false, staticHostOnly: true, message: 'غير مدعوم في هذه البيئة.' };
    }
    var proto = window.location ? window.location.protocol : '';
    var host = window.location ? window.location.hostname : '';
    if ((proto !== 'http:' && proto !== 'https:') || /github\.io$/i.test(host)) {
      return { success: false, staticHostOnly: true, message: 'استضافة ثابتة بدون خادم Node/Vercel.' };
    }
    try {
      var resp = await fetch('/api/crm', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionName,
          token: getToken() || '',
          payload: payload || {}
        })
      });
      if (resp) detectVersionHeader(resp);
      if (resp.status === 404 || resp.status === 405) {
        return { success: false, staticHostOnly: true, message: 'الخادم الخلفي غير متاح على هذه الاستضافة.' };
      }
      var contentType = resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '';
      var text = await resp.text();
      var core = root.RGCrmCore;
      var parsed = (core && core.parseBackendResponseText)
        ? core.parseBackendResponseText(text, resp.status, contentType)
        : (text ? JSON.parse(text) : { success: false, message: 'استجابة فارغة من الخادم (HTTP ' + resp.status + ').', data: null, error: 'EMPTY_RESPONSE' });
      if (parsed && (parsed.error === 'HTML_RESPONSE' || parsed.error === 'BACKEND_NOT_FOUND')) {
        if (parsed.error === 'HTML_RESPONSE') detectedHtmlFallback = true;
        return Object.assign({ staticHostOnly: true, htmlFallback: parsed.error === 'HTML_RESPONSE' }, parsed);
      }
      return Object.assign({ staticHostOnly: false }, parsed);
    } catch (err) {
      return {
        success: false,
        staticHostOnly: true,
        message: 'تعذر الوصول إلى نقطة الربط الخلفية: ' + (err.message || err)
      };
    }
  }

  async function getSetupCapabilities() {
    return callBackendSetupEndpoint('getSetupCapabilities', {});
  }

  async function testServerHealth() {
    var startedAt = Date.now();
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      return { success: false, message: 'غير مدعوم في هذه البيئة.', data: null };
    }
    var proto = window.location ? window.location.protocol : '';
    var host = window.location ? window.location.hostname : '';
    if ((proto !== 'http:' && proto !== 'https:') || /github\.io$/i.test(host)) {
      return {
        success: false,
        message: 'استضافة ثابتة بدون خادم خلفي (Static Host).',
        data: { staticHostOnly: true, latencyMs: Date.now() - startedAt }
      };
    }
    try {
      var resp = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      if (resp) detectVersionHeader(resp);
      var latencyMs = Math.max(1, Date.now() - startedAt);
      var cType = resp.headers && resp.headers.get ? String(resp.headers.get('content-type') || '').toLowerCase() : '';
      var text = await resp.text();
      var trimmed = String(text || '').trim();
      if ((trimmed && (trimmed.charAt(0) === '<' || /^<!doctype/i.test(trimmed))) || cType.indexOf('text/html') !== -1) {
        return {
          success: false,
          message: 'أعاد الخادم صفحة HTML من /api/health بدلاً من JSON (HTTP ' + resp.status + '). تأكد من توجيه مسارات /api/* إلى Serverless Functions وليس إلى index.html.',
          data: { latencyMs: latencyMs, statusCode: resp.status, htmlFallback: true, staticHostOnly: true },
          error: 'HTML_RESPONSE'
        };
      }
      var json = null;
      if (trimmed) {
        try {
          json = JSON.parse(trimmed);
        } catch (_parseErr) {
          return {
            success: false,
            message: 'تعذر قراءة استجابة نقطة فحص الخادم (/api/health) كـ JSON (HTTP ' + resp.status + ').',
            data: { latencyMs: latencyMs, statusCode: resp.status },
            error: 'INVALID_JSON'
          };
        }
      }
      if (resp.ok && json && json.ok) {
        var isUnconfiguredNeon = !json.databaseConfigured && (!json.mode || json.mode === 'neon');
        var healthMsg = isUnconfiguredNeon
          ? ('الخادم يعمل بنجاح (' + latencyMs + 'ms) — قاعدة البيانات السحابية غير مهيأة بعد (DATABASE_URL غير مضبوط؛ وضع المعاينة متاح).')
          : ('الخادم يعمل بنجاح (' + latencyMs + 'ms) — الوضع: ' + (json.mode || 'neon') + (json.serverlessProxyAvailable ? ' · وسيط Vercel مفعّل' : ''));
        return {
          success: true,
          message: healthMsg,
          data: Object.assign({ latencyMs: latencyMs, statusCode: resp.status }, json)
        };
      }
      return {
        success: false,
        message: 'استجابة غير متوقعة من نقطة فحص الخادم (HTTP ' + resp.status + ').',
        data: { latencyMs: latencyMs, statusCode: resp.status }
      };
    } catch (err) {
      return {
        success: false,
        message: 'تعذر الوصول إلى نقطة فحص الخادم (/api/health): ' + (err && err.message ? err.message : err),
        data: { latencyMs: Date.now() - startedAt }
      };
    }
  }

  async function testDatabaseHealth() {
    var startedAt = Date.now();
    var res = await callBackendSetupEndpoint('testDatabaseHealth', {});
    var latencyMs = Math.max(1, Date.now() - startedAt);
    if (res && res.staticHostOnly) {
      if (res.error === 'HTML_RESPONSE') {
        return {
          success: false,
          message: res.message || 'أعاد الخادم صفحة HTML بدلاً من JSON من /api/crm.',
          data: { connected: false, configured: false, htmlFallback: true, latencyMs: latencyMs },
          error: 'HTML_RESPONSE'
        };
      }
      return {
        success: false,
        message: 'لا يوجد خادم متصل باختبار قاعدة البيانات على هذه الاستضافة.',
        data: { connected: false, configured: false, latencyMs: latencyMs }
      };
    }
    if (res && res.success && res.data) {
      return {
        success: Boolean(res.data.connected),
        message: res.data.message || (res.data.connected ? 'اتصال Neon PostgreSQL ناجح.' : 'قاعدة البيانات غير متصلة.'),
        data: Object.assign({ latencyMs: res.data.latencyMs || latencyMs }, res.data)
      };
    }
    return {
      success: false,
      message: (res && res.message) || 'تعذر اختبار قاعدة بيانات Neon PostgreSQL.',
      data: { connected: false, latencyMs: latencyMs }
    };
  }

  async function applyUnifiedSetup() {
    return {
      success: false,
      message: 'تم إلغاء الربط عبر الموقع — يتم ضبط متغيرات الاتصال من إعدادات بيئة الخادم فقط.',
      data: null,
      error: 'WEB_SETUP_DISABLED'
    };
  }

  async function wipeAllBrowserCaches(options) {
    var opts = options || {};
    apiResponseCache = {};
    inFlightRequests = {};
    inFlightWarm = {};
    revalidatedInPage = {};
    localReservationsFreshInPage = {};
    localReservationsByNs = {};
    localCustomersByNs = {};
    customersDirtyByNs = {};
    localDetailsByNs = {};
    localExtensionsByResNs = {};
    localMetaByNs = {};
    hydratedNamespaces = {};
    hydrationPromises = {};
    detectedServerSyncMeta = null;
    _cachedConnInfo = null;

    var report = {
      indexedDb: false,
      cacheStorage: 0,
      serviceWorkers: 0,
      sessionStorage: true,
      localStorageKeys: []
    };

    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_CACHE_KEY);
    } catch (_e) {}

    if (root.RGIdbCache && typeof root.RGIdbCache.wipeAllCaches === 'function') {
      report = await root.RGIdbCache.wipeAllCaches(Object.assign({ preserveAuth: true }, opts));
    }

    await refreshGlobalConnection().catch(function () {});
    await ensureHydrated(getCacheNamespace()).catch(function () {});
    return report;
  }

  function getSyncCheckStatus() {
    if (root.RGIdbCache && typeof root.RGIdbCache.getSyncState === 'function') {
      return root.RGIdbCache.getSyncState(getCacheNamespace());
    }
    return { verified: true, status: 'synchronized' };
  }

  var _offlineSyncPromise = null;
  var OFFLINE_QUEUEABLE_SET = {
    addFollowUp: true,
    updateFollowUp: true,
    quickUpdateReservationStatus: true,
    recordNoAnswerFollowUp: true,
    saveReservationPinnedNote: true,
    updateProblem: true
  };

  function isOfflineQueueableAction(action) {
    return Boolean(OFFLINE_QUEUEABLE_SET[String(action || '')]);
  }

  async function getOfflineQueueStatus() {
    var ns = getCacheNamespace();
    if (!root.RGIdbCache || typeof root.RGIdbCache.getOfflineQueue !== 'function') {
      return { count: 0, items: [] };
    }
    var items = await root.RGIdbCache.getOfflineQueue(ns);
    return { count: items.length, items: items };
  }

  async function syncOfflineQueue() {
    if (_offlineSyncPromise) return _offlineSyncPromise;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { synced: 0, remaining: (await getOfflineQueueStatus()).count, offline: true };
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('rg_crm_force_offline') === '1') {
      return { synced: 0, remaining: (await getOfflineQueueStatus()).count, offline: true };
    }

    _offlineSyncPromise = (async function () {
      var ns = getCacheNamespace();
      if (!root.RGIdbCache || typeof root.RGIdbCache.getOfflineQueue !== 'function') {
        return { synced: 0, remaining: 0 };
      }
      var queue = await root.RGIdbCache.getOfflineQueue(ns);
      var queueSyncId = queue.length > 0 ? ('SYNC_' + (++syncProgressSeq) + '_' + Date.now()) : '';
      if (queueSyncId) {
        emitSyncProgress('start', {
          requestId: queueSyncId,
          action: 'syncOfflineQueue',
          total: queue.length,
          timestamp: Date.now()
        });
      }
      var synced = 0;
      var failed = 0;
      try {
        for (var i = 0; i < queue.length; i++) {
          var item = queue[i];
          if (!item || !item.action) continue;
          try {
            var replayPayload = Object.assign({}, item.payload || {}, { _replayingOfflineQueue: true });
            var resp = await callApi(item.action, replayPayload);
            if (resp && resp.success && !resp.queuedOffline) {
              await root.RGIdbCache.removeOfflineQueueItem(item.id);
              synced += 1;
            } else {
              failed += 1;
              break;
            }
          } catch (_err) {
            failed += 1;
            break;
          }
        }
      } finally {
        if (queueSyncId) {
          emitSyncProgress('end', {
            requestId: queueSyncId,
            action: 'syncOfflineQueue',
            timestamp: Date.now(),
            success: failed === 0
          });
        }
      }
      var remaining = await root.RGIdbCache.getOfflineQueueCount(ns);
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('rg:offlinequeuechange', {
          detail: { synced: synced, remaining: remaining, failed: failed }
        }));
      }
      return { synced: synced, remaining: remaining, failed: failed };
    })().finally(function () {
      _offlineSyncPromise = null;
    });

    return _offlineSyncPromise;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', function () {
      syncOfflineQueue().catch(function () {});
    });
  }

  root.RGApi = {
    ready: ready,
    getGasUrl: getGasUrl,
    getBackendApiUrl: getBackendApiUrl,
    getActiveMode: getConfiguredMode,
    isBackendConnected: function () { return Boolean(getBackendApiUrl()); },
    isVercelProxyAvailable: function () { return Boolean(detectedBackendProxyAvailable); },
    refreshGlobalConnection: refreshGlobalConnection,
    getSetupCapabilities: getSetupCapabilities,
    applyUnifiedSetup: applyUnifiedSetup,
    testServerHealth: testServerHealth,
    testDatabaseHealth: testDatabaseHealth,
    getConnectionInfo: getConnectionInfo,
    setGasUrl: setGasUrl,
    getToken: getToken,
    setToken: setToken,
    isLiveMode: isLiveMode,
    warmUpGas: warmUpGas,
    clearCache: clearCache,
    invalidateScopes: clearCache,
    markScopesStale: markScopesStale,
    wipeAllBrowserCaches: wipeAllBrowserCaches,
    enforceBootSyncCheck: function (force) { return runBootSyncCheck(getCacheNamespace(), force !== false); },
    getSyncCheckStatus: getSyncCheckStatus,
    primeCache: primeCache,
    hasCached: hasCached,
    getCachedData: getCachedData,
    patchCachedScopes: patchCachedScopes,
    findCachedProblem: findCachedProblem,
    getInstantReservationDetails: getInstantReservationDetails,
    getCustomersDirectory: getCustomersDirectory,
    warmLocalReservationsCache: warmLocalReservationsCache,
    prefetchReservationDetails: prefetchReservationDetails,
    getLocalCacheStats: getLocalCacheStats,
    applyOptimisticMutation: applyOptimisticMutation,
    restoreLatestOptimisticSnapshot: restoreLatestOptimisticSnapshot,
    getNotificationMutationEpoch: function () { return getNotifMutationState(getCacheNamespace()).epoch; },
    isNotificationMutationInFlight: function () { return getNotifMutationState(getCacheNamespace()).inFlightCount > 0; },
    filterActiveNotifications: function (payload) { return sanitizeNotificationsForNs(getCacheNamespace(), payload); },
    hasInFlightMutations: function () { return Object.keys(inFlightMutations).length > 0; },
    isOfflineQueueableAction: isOfflineQueueableAction,
    getOfflineQueueStatus: getOfflineQueueStatus,
    syncOfflineQueue: syncOfflineQueue,
    applyDeltaSyncToCache: applyDeltaSyncToCache,
    callApi: callApi,
    pingGasUrl: pingGasUrl
  };
})(window);
