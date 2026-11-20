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
  var detectedGasUrl = '';
  var detectedMode = '';
  var detectedBackendProxyAvailable = false;
  var detectedEnvGasConfigured = false;
  var backendProbeDone = false;
  var backendProbePromise = null;

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
    var search = typeof window !== 'undefined' ? window.location.search : '';

    var match = search.match(/(?:\?|&)backendUrl=([^&]+)/);
    if (match && match[1]) {
      try {
        var decoded = decodeURIComponent(match[1]).trim();
        if (decoded === 'clear' || decoded === 'none') {
          safeStorageSet(STORAGE_BACKEND_URL, '');
        } else if (decoded) {
          safeStorageSet(STORAGE_BACKEND_URL, decoded);
          return decoded;
        }
      } catch (e) {}
    }

    var storedBackend = safeStorageGet(STORAGE_BACKEND_URL);
    if (storedBackend) return storedBackend;
    if (detectedBackendUrl) return detectedBackendUrl;
    return getDefaultConfiguredBackendUrl();
  }

  function getConnectionInfo() {
    var search = typeof window !== 'undefined' ? window.location.search : '';
    var stored = safeStorageGet(STORAGE_GAS_URL);
    var defUrl = getDefaultConfiguredGasUrl();
    if (_cachedConnInfo && _cachedConnInfo.search === search && _cachedConnInfo.stored === stored && _cachedConnInfo.defUrl === defUrl) {
      return _cachedConnInfo.info;
    }
    var info;
    if (root.RGCrmCore && root.RGCrmCore.resolveGasConnection) {
      info = root.RGCrmCore.resolveGasConnection(search, stored, defUrl);
      if (info.clearStored) {
        safeStorageSet(STORAGE_GAS_URL, '');
        stored = '';
      } else if (info.persist && info.url) {
        safeStorageSet(STORAGE_GAS_URL, info.url);
        stored = info.url;
      }
    } else {
      info = {
        url: (stored && stored !== SANDBOX_SENTINEL) ? stored : defUrl,
        source: stored ? 'local_storage' : (defUrl ? 'global_config' : 'sandbox'),
        defaultUrl: defUrl,
        persist: false,
        clearStored: false
      };
    }
    _cachedConnInfo = { search: search, stored: stored, defUrl: defUrl, info: info };
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
        if (resp && resp.ok) {
          var healthText = await resp.text();
          var trimmedHealth = String(healthText || '').trim();
          var json = null;
          if (trimmedHealth && trimmedHealth.charAt(0) !== '<') {
            try {
              json = JSON.parse(trimmedHealth);
            } catch (parseErr) {
              json = null;
            }
          }
          if (json && json.ok) {
            detectedBackendProxyAvailable = Boolean(json.serverlessProxyAvailable !== false);
            detectedEnvGasConfigured = Boolean(json.envGasConfigured);
            if (json.mode) {
              detectedMode = String(json.mode || '').trim().toLowerCase();
            }
            if (json.gasWebAppUrl !== undefined) {
              detectedGasUrl = String(json.gasWebAppUrl || '').trim();
            }
            if (json.mode === 'gas' || json.mode === 'sandbox') {
              detectedBackendUrl = '';
            } else if (json.databaseConfigured && json.connected !== false) {
              detectedBackendUrl = json.backendApiUrl || '/api/crm';
            } else {
              detectedBackendUrl = '';
            }
            _cachedConnInfo = null;
          }
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
    _cachedConnInfo = null;
    return probeBackendHealth();
  }

  var SESSION_CACHE_KEY = 'rg_crm_swr_v1';
  var SWR_STALE_MAX_MS = 300000;
  var IDB_KV_MAX_AGE_MS = 86400000; // 24 hours persistent IndexedDB KV window
  var sandboxDbCache = null;
  var apiResponseCache = {};
  var inFlightRequests = {};
  var inFlightMutations = {};
  var inFlightWarm = {};
  var persistTimer = null;
  var persistIdleId = null;

  var hydratedNamespaces = {};
  var hydrationPromises = {};
  var localReservationsByNs = {};
  var localCustomersByNs = {};
  var customersDirtyByNs = {};
  var localDetailsByNs = {};
  var localExtensionsByResNs = {};
  var localMetaByNs = {};

  function getCacheNamespace() {
    var mode = getTransportUrl() || 'sandbox';
    var tok = getToken() || '';
    return mode + '::' + (tok ? simpleHash(tok) : 'anon');
  }

  function setLocalReservationsState(ns, list, replaceAll, metaPatch) {
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

    if (root.RGIdbCache) {
      if (replaceAll) {
        root.RGIdbCache.replaceReservationsSnapshot(ns, nextList, customers, nextMeta).catch(function () {});
      } else if (Array.isArray(list) && list.length > 0) {
        root.RGIdbCache.upsertReservations(ns, list).catch(function () {});
        if (shouldRebuildCustomers) {
          root.RGIdbCache.upsertCustomers(ns, customers).catch(function () {});
        }
        root.RGIdbCache.upsertMeta(ns, nextMeta).catch(function () {});
      }
    }
    return nextList;
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

  async function ensureHydrated(targetNs) {
    var ns = targetNs || getCacheNamespace();
    if (hydratedNamespaces[ns]) return true;
    if (hydrationPromises[ns]) return hydrationPromises[ns];

    hydrationPromises[ns] = (async function () {
      try {
        if (root.RGIdbCache) {
          var snap = await root.RGIdbCache.loadNamespaceSnapshot(ns);
          var now = Date.now();
          (snap.kvEntries || []).forEach(function (entry) {
            if (entry && entry.key && entry.response && entry.staleUntil && now < entry.staleUntil && !apiResponseCache[entry.key]) {
              apiResponseCache[entry.key] = entry;
            }
          });
          if (Array.isArray(snap.reservations) && snap.reservations.length > 0) {
            var byId = {};
            var byNum = {};
            snap.reservations.forEach(function (r) {
              if (!r || !r.id) return;
              byId[r.id] = r;
              if (r.reservationNumber) byNum[r.reservationNumber] = r;
            });
            localReservationsByNs[ns] = { list: snap.reservations, byId: byId, byNumber: byNum, updatedAt: now };
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
    return ensureHydrated(getCacheNamespace());
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
        root.RGIdbCache.putKvEntries(idbEntries).catch(function () {});
      }

      if (typeof sessionStorage === 'undefined') return;
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
  });

  function clearCache(scopes) {
    var ns = getCacheNamespace();
    if (!scopes || (Array.isArray(scopes) && scopes.indexOf('*') !== -1)) {
      apiResponseCache = {};
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (e) {}
      if (root.RGIdbCache && Array.isArray(scopes) && scopes.indexOf('*') !== -1) {
        root.RGIdbCache.clearNamespace(ns).catch(function () {});
        delete localReservationsByNs[ns];
        delete localCustomersByNs[ns];
        delete localDetailsByNs[ns];
        delete localExtensionsByResNs[ns];
        delete localMetaByNs[ns];
        delete hydratedNamespaces[ns];
      }
      return;
    }
    var list = Array.isArray(scopes) ? scopes : [scopes];
    var removedKeys = [];
    Object.keys(apiResponseCache).forEach(function (k) {
      var entry = apiResponseCache[k];
      if (entry && list.indexOf(entry.scope) !== -1) {
        delete apiResponseCache[k];
        removedKeys.push(k);
      }
    });
    if (root.RGIdbCache) {
      if (removedKeys.length) root.RGIdbCache.deleteKvByKeys(removedKeys).catch(function () {});
      root.RGIdbCache.deleteKvByScopes(ns, list).catch(function () {});
    }
    schedulePersistApiCache(true);
  }

  function primeCache(action, payload, data) {
    var core = root.RGCrmCore;
    if (!core || !core.getApiCachePolicy || !core.buildApiCacheKey) return;
    var policy = core.getApiCachePolicy(action);
    if (!policy.cacheable) return;
    var now = Date.now();
    var ns = getCacheNamespace();
    var key = core.buildApiCacheKey(getTransportUrl(), getToken(), action, payload || {});
    apiResponseCache[key] = {
      key: key,
      ns: ns,
      scope: policy.scope,
      storedAt: now,
      expiresAt: now + policy.ttlMs,
      staleUntil: now + Math.max(policy.ttlMs, IDB_KV_MAX_AGE_MS),
      response: { success: true, message: '', data: data, error: null }
    };
    if (action === 'getReservationDetails' && data && data.reservation) {
      setLocalDetailState(ns, data);
    } else if (action === 'getReservations' && data && Array.isArray(data.items) && data.items.length > 0) {
      setLocalReservationsState(ns, data.items, false);
    }
    schedulePersistApiCache(false);
  }

  function hasCached(action, payload) {
    var core = root.RGCrmCore;
    if (!core || !core.getApiCachePolicy || !core.buildApiCacheKey) return false;
    var policy = core.getApiCachePolicy(action);
    if (!policy.cacheable) return false;
    var key = core.buildApiCacheKey(getTransportUrl(), getToken(), action, payload || {});
    var entry = apiResponseCache[key];
    return Boolean(entry && Date.now() < entry.expiresAt);
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
    return entry.response.data;
  }

  function getCachedActionKey(entryKey) {
    var parts = String(entryKey || '').split('|');
    return parts.length >= 3 ? parts[2] : '';
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

  function queryLocalReservationsFast(payload, userContext) {
    var ns = getCacheNamespace();
    var core = root.RGCrmCore;
    if (!core || !core.filterReservations) return null;

    var resBucket = localReservationsByNs[ns];
    if (!resBucket || !Array.isArray(resBucket.list) || resBucket.list.length === 0) return null;
    var meta = localMetaByNs[ns] || {};
    if (!meta.allReservationsHydrated) return null;

    var ageMs = Date.now() - Number(resBucket.updatedAt || meta.updatedAt || 0);
    if (ageMs > SWR_STALE_MAX_MS * 2) return null;

    var p = payload || {};
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

    return {
      isStale: ageMs > 45000,
      response: {
        success: true,
        message: '',
        data: {
          items: filtered.slice(startIdx, startIdx + pageSize),
          total: filtered.length,
          page: page,
          pageSize: pageSize,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
          facets: {
            companies: Object.keys(companies).sort(),
            branches: Object.keys(branches).sort()
          }
        },
        error: null
      }
    };
  }

  function applyOptimisticMutation(action, payload, actor) {
    var p = payload || {};
    var core = root.RGCrmCore;
    var actUser = actor || (root.RGAuth && root.RGAuth.getUser()) || { id: '', name: 'الموظف' };
    var empCache = getCachedData('getEmployees', {}, true);
    var allEmployees = (empCache && Array.isArray(empCache.items)) ? empCache.items : [];
    var nowIso = new Date().toISOString();

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
      patchCachedScopes(['reservations', 'followUps'], function (data, actName) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.map(applyAssignFn) });
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
      return;
    }

    if (action === 'quickUpdateReservationStatus' || action === 'addFollowUp') {
      var resIdFu = String(p.reservationId || '').trim();
      var nextSt = String(p.status || '').trim();
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
      patchCachedScopes(['reservations', 'followUps'], function (data, actName) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.map(patchResStatus) });
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
            followUpDate: nowIso.substring(0, 10),
            followUpTime: new Date().toTimeString().substring(0, 8),
            createdAt: nowIso
          }].concat(curNaDet.followUps || [])
        }));
      }
      patchCachedScopes(['reservations', 'followUps'], function (data, actName) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return Object.assign({}, data, { items: data.items.map(patchNa) });
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
              followUpDate: nowIso.substring(0, 10),
              followUpTime: new Date().toTimeString().substring(0, 8),
              createdAt: nowIso
            }].concat(data.followUps || [])
          });
        }
        if (actName === 'getMyFollowUps' && Array.isArray(data.assignedReservations)) {
          return Object.assign({}, data, { assignedReservations: data.assignedReservations.map(patchNa) });
        }
        return undefined;
      });
      return;
    }

    if (action === 'updateProblem') {
      var prbId = String(p.problemId || '').trim();
      if (!prbId || !core) return;
      var affectedResId = '';
      var stillOpenOnRes = null;

      patchCachedScopes(['problems', 'reservations'], function (data, actName) {
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          var nextItems = data.items.map(function (item) {
            if (item.id !== prbId) return item;
            affectedResId = item.reservationId || affectedResId;
            return core.applyOptimisticProblemPatch(item, p, actUser, allEmployees);
          });
          if (affectedResId) {
            stillOpenOnRes = nextItems.some(function (it) {
              return it.reservationId === affectedResId && !core.isProblemClosedStatus(it.status);
            });
          }
          return Object.assign({}, data, { items: nextItems });
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
        if (localReservationsByNs[nsPrbUpd] && localReservationsByNs[nsPrbUpd].byId[affectedResId]) {
          setLocalReservationsState(nsPrbUpd, [Object.assign({}, localReservationsByNs[nsPrbUpd].byId[affectedResId], { hasProblem: Boolean(stillOpenOnRes) })], false);
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
        patchCachedScopes(['reservations'], function (data, actName) {
          if (actName === 'getReservations' && Array.isArray(data.items)) {
            return Object.assign({}, data, {
              items: data.items.map(function (r) {
                return r.id === affectedResId ? Object.assign({}, r, { hasProblem: Boolean(stillOpenOnRes) }) : r;
              })
            });
          }
          return undefined;
        });
      }
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
      patchCachedScopes(['reservations', 'problems'], function (data, actName) {
        if (actName === 'getReservations' && Array.isArray(data.items)) {
          return Object.assign({}, data, {
            items: data.items.map(function (r) {
              if (r.id !== resIdPrb) return r;
              return Object.assign({}, r, {
                hasProblem: true,
                priority: optPrb.priority === 'مرتفع' ? 'مرتفع' : r.priority
              });
            })
          });
        }
        if (actName === 'getProblems' && Array.isArray(data.items)) {
          return Object.assign({}, data, {
            items: [optPrb].concat(data.items),
            total: (data.total || data.items.length) + 1
          });
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
    }
  }

  function setGasUrl(url) {
    _cachedConnInfo = null;
    var raw = String(url || '').trim();
    var defUrl = getDefaultConfiguredGasUrl();
    if (raw === '__DEFAULT__') {
      safeStorageSet(STORAGE_GAS_URL, '');
    } else if (!raw) {
      safeStorageSet(STORAGE_GAS_URL, defUrl ? SANDBOX_SENTINEL : '');
    } else if (defUrl && raw === defUrl) {
      safeStorageSet(STORAGE_GAS_URL, '');
    } else {
      safeStorageSet(STORAGE_GAS_URL, raw);
    }
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

  function todayIso(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return d.toISOString().substring(0, 10);
  }

  function localOffsetDateTime(hoursOffset) {
    var d = new Date(Date.now() + (Number(hoursOffset || 0) * 3600000));
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return {
      date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      time: p(d.getHours()) + ':' + p(d.getMinutes()),
      iso: d.toISOString()
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
        customerIdNumber: '1044318762',
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
        internalStatus: 'قيد الانتظار',
        priority: 'مرتفع',
        assignedEmployeeIds: [],
        assignedEmployeeNames: [],
        lastUpdateText: 'تجاوز وقت الانتهاء دون إغلاق أو تمديد — بانتظار التواصل العاجل',
        lastUpdatedById: 'EMP_SUP1',
        lastUpdatedByName: 'سارة العتيبي',
        lastUpdatedAt: closedRecent.iso,
        hasProblem: false,
        createdAt: startMinus2d.iso,
        updatedAt: closedRecent.iso
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
      job_role_presets: (root.RGCrmCore && root.RGCrmCore.JOB_ROLE_PRESETS) ? root.RGCrmCore.JOB_ROLE_PRESETS.slice() : [],
      permissions_catalog_custom: []
    };

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
      settings: settings,
      sessions: []
    };
  }

  function loadSandboxDb() {
    if (sandboxDbCache) {
      return sandboxDbCache;
    }
    var raw = safeStorageGet(STORAGE_DB);
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

      ['reservations', 'extensions', 'assignments', 'followUps', 'followUpHistory', 'problems', 'problemUpdates', 'activityLog', 'notifications', 'syncLog', 'sessions'].forEach(function (k) {
        if (!Array.isArray(parsed[k])) {
          parsed[k] = defaults[k];
          dirty = true;
        }
      });

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
      else sandboxDbCache = parsed;
      return sandboxDbCache;
    } catch (e) {
      var fresh = seedSandboxDb();
      saveSandboxDb(fresh);
      return sandboxDbCache;
    }
  }

  function saveSandboxDb(db) {
    sandboxDbCache = db;
    safeStorageSet(STORAGE_DB, JSON.stringify(db));
  }

  function sanitizeEmp(e) {
    var resolved = (root.RGCrmCore && root.RGCrmCore.resolveEffectivePermissions)
      ? root.RGCrmCore.resolveEffectivePermissions(e)
      : (e.permissions || []);
    return {
      id: e.id,
      name: e.name,
      username: e.username,
      phone: e.phone,
      email: e.email,
      jobTitle: e.jobTitle,
      role: e.role,
      permissions: resolved,
      status: e.status,
      lastActivity: e.lastActivity,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    };
  }

  function appendSandboxActivity(db, user, actionType, entityType, entityId, details) {
    var now = new Date();
    db.activityLog.unshift({
      id: genId('ACT'),
      userId: user ? user.id : 'system',
      userName: user ? user.name : 'النظام',
      userRole: user ? user.role : 'system',
      actionType: actionType,
      entityType: entityType || '',
      entityId: entityId || '',
      details: details || '',
      logDate: now.toISOString().substring(0, 10),
      logTime: now.toTimeString().substring(0, 8),
      createdAt: now.toISOString()
    });
  }

  function pushSandboxNotification(db, recipientEmployeeId, recipientRole, type, title, message, entityType, entityId) {
    db.notifications.unshift({
      id: genId('NTF'),
      recipientEmployeeId: recipientEmployeeId || '',
      recipientRole: recipientRole || '',
      type: type,
      title: title,
      message: message,
      entityType: entityType || '',
      entityId: entityId || '',
      isRead: false,
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
    return { token: token, employeeId: user.id, role: user.role, user: sanitizeEmp(user) };
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
      db.sessions.push({
        token: newToken,
        employeeId: found.id,
        role: found.role,
        expiresAt: exp,
        isRevoked: false
      });
      found.lastActivity = new Date().toISOString();
      appendSandboxActivity(db, found, 'تسجيل الدخول', 'Employee', found.id, 'تسجيل دخول ناجح للمستخدم ' + found.username);
      saveSandboxDb(db);
      var loginData = { token: newToken, expiresAt: exp, user: sanitizeEmp(found) };
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
      case 'getMe':
        return { success: true, message: '', data: { user: session.user }, error: null };

      case 'getAppBootstrap': {
        var bsDash = sandboxExecute('getDashboard', token, payload && payload.range ? payload : { range: '30d' });
        var bsNotif = sandboxExecute('getNotifications', token, {});
        var bsEmp = sandboxExecute('getEmployees', token, {});
        var bsPrb = sandboxExecute('getProblems', token, {});
        var uiSimpBoot = core && core.normalizeUiSimplificationSettings
          ? core.normalizeUiSimplificationSettings(db.settings.ui_simplification)
          : (db.settings.ui_simplification || { preset: 'full' });
        var rawPinnedBoot = db.settings['pinned_res_u_' + session.employeeId];
        var parsedPinnedBoot = Array.isArray(rawPinnedBoot) ? rawPinnedBoot : [];
        var rawLayoutBoot = db.settings['layout_prefs_u_' + session.employeeId];
        var layoutPrefsBoot = (core && core.normalizeUserLayoutPrefs)
          ? core.normalizeUserLayoutPrefs(rawLayoutBoot)
          : { navOrder: [], hiddenRoutes: [], dashOrder: [], dashHidden: [] };
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
            pinnedCriticalIds: parsedPinnedBoot.slice(0, (core && core.MAX_PINNED_CRITICAL_RESERVATIONS) || 3),
            layoutPrefs: layoutPrefsBoot
          },
          error: null
        };
      }

      case 'getDashboard': {
        var rangeKey = payload.range || '30d';
        var todayStr = todayIso(0);
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
        var metrics = core.computeDashboardMetrics(db.reservations, db.followUps, db.problems, db.employees, { start: start, end: end }, todayStr);
        return { success: true, message: '', data: metrics, error: null };
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
        var filtered = core.filterReservations(db.reservations, db.followUps, payload, {
          employeeId: session.employeeId,
          role: session.role,
          user: session.user,
          allowAgentViewAll: db.settings.allow_agent_view_all
        });
        var page = Math.max(1, Number(payload.page || 1));
        var pageSize = Math.max(1, Number(payload.pageSize || 25));
        var startIdx = (page - 1) * pageSize;
        return {
          success: true,
          message: '',
          data: {
            items: filtered.slice(startIdx, startIdx + pageSize),
            total: filtered.length,
            page: page,
            pageSize: pageSize,
            totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
            facets: {
              companies: Object.keys(companies).sort(),
              branches: Object.keys(branches).sort()
            }
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
        if (!payload.status || !core.isValidWorkflowStatus(payload.status)) {
          return { success: false, message: 'حالة الحجز غير صالحة.', data: null, error: 'VALIDATION' };
        }
        var nowQst = new Date();
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
          followUpDate: nowQst.toISOString().substring(0, 10),
          followUpTime: nowQst.toTimeString().substring(0, 8),
          createdAt: nowQst.toISOString()
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
        appendSandboxActivity(db, session.user, 'تعديل حالة', 'Reservation', rQst.reservationNumber, 'تحديث مباشر إلى: ' + payload.status + (noteQst ? ' | ' + noteQst : ''));
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
        appendSandboxActivity(db, session.user, 'تعديل تفاصيل الحجز', 'Reservation', rEdit.reservationNumber, 'تعديل تفاصيل الحجز بواسطة ' + session.user.name);
        saveSandboxDb(db);
        return { success: true, message: 'تم حفظ تعديلات تفاصيل الحجز.', data: rEdit, error: null };
      }

      case 'saveReservationPinnedNote': {
        if (!core.canUserPerform(session.user, 'pin_reservation_note') ||
            (session.role !== 'general_manager' && session.role !== 'supervisor')) {
          return { success: false, message: 'FORBIDDEN: إضافة الملاحظة المثبتة متاحة للمشرف والمدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        var rPinTarget = db.reservations.find(function (r) { return r.id === payload.reservationId; });
        if (!rPinTarget) return { success: false, message: 'الحجز غير موجود.', data: null, error: 'NOT_FOUND' };
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
          cleanPinNote ? cleanPinNote.slice(0, 140) : 'إزالة الملاحظة المثبتة'
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
        var nowNa = new Date();
        var nowNaIso = nowNa.toISOString();
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
          followUpDate: nowNaIso.substring(0, 10),
          followUpTime: nowNa.toTimeString().substring(0, 8),
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
        var nowFu = new Date();
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
          followUpDate: nowFu.toISOString().substring(0, 10),
          followUpTime: nowFu.toTimeString().substring(0, 8),
          createdAt: nowFu.toISOString()
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
        var teamFus = db.followUps.filter(function (f) {
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
            if (emp.status === 'active' && (emp.role === 'supervisor' || emp.role === 'general_manager')) {
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
          appendSandboxActivity(db, session.user, 'تغيير أولوية', 'Problem', prb.problemNumber, 'من ' + prevPrio + ' إلى ' + prb.priority);
        }
        if (prevStatus !== prb.status) {
          appendSandboxActivity(db, session.user, 'تعديل حالة', 'Problem', prb.problemNumber, 'من ' + prevStatus + ' إلى ' + prb.status);
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

      case 'getProblems': {
        var prbList = db.problems.filter(function (p) {
          if (payload.status && p.status !== payload.status) return false;
          if (payload.priority && p.priority !== payload.priority) return false;
          if (payload.employeeId && (p.assignedEmployeeIds || []).indexOf(payload.employeeId) === -1) return false;
          if (payload.search) {
            var h = (p.problemNumber + ' ' + p.reservationNumber + ' ' + p.customerName + ' ' + p.description).toLowerCase();
            if (h.indexOf(String(payload.search).toLowerCase()) === -1) return false;
          }
          return true;
        }).map(function (p) {
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
        var unameNew = String(payload.username || '').trim().toLowerCase();
        var passNew = String(payload.password || '');
        if (!payload.name || !unameNew || passNew.length < 6) {
          return { success: false, message: 'يرجى إدخال الاسم واسم المستخدم وكلمة مرور من 6 أحرف على الأقل.', data: null, error: 'VALIDATION' };
        }
        if (db.employees.some(function (e) { return e.username.toLowerCase() === unameNew; })) {
          return { success: false, message: 'اسم المستخدم مسجل مسبقًا.', data: null, error: 'DUPLICATE' };
        }
        var saltNew = genId('SLT');
        var newRole = payload.role || 'agent';
        var newPerms = Array.isArray(payload.permissions) && payload.permissions.length
          ? payload.permissions.slice()
          : core.resolveEffectivePermissions(newRole);
        var newEmp = {
          id: genId('EMP'),
          name: String(payload.name).trim(),
          username: unameNew,
          salt: saltNew,
          passwordHash: simpleHash(saltNew + ':' + passNew),
          phone: String(payload.phone || '').trim(),
          email: String(payload.email || '').trim(),
          jobTitle: String(payload.jobTitle || 'موظف خدمة العملاء').trim(),
          role: newRole,
          permissions: newPerms,
          status: 'active',
          lastActivity: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.employees.push(newEmp);
        if (Array.isArray(db._deletedSeedUsernames)) {
          db._deletedSeedUsernames = db._deletedSeedUsernames.filter(function (u) {
            return String(u || '').toLowerCase() !== unameNew;
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
        var empEdit = db.employees.find(function (e) { return e.id === payload.employeeId; });
        if (!empEdit) return { success: false, message: 'الموظف غير موجود.', data: null, error: 'NOT_FOUND' };
        if (payload.name) empEdit.name = String(payload.name).trim();
        if (payload.phone !== undefined) empEdit.phone = String(payload.phone).trim();
        if (payload.email !== undefined) empEdit.email = String(payload.email).trim();
        if (payload.jobTitle) empEdit.jobTitle = String(payload.jobTitle).trim();
        if (payload.role) empEdit.role = payload.role;
        if (Array.isArray(payload.permissions)) {
          empEdit.permissions = payload.permissions.slice();
        }
        if (payload.status) {
          empEdit.status = payload.status;
          if (payload.status === 'disabled') {
            db.sessions.forEach(function (s) { if (s.employeeId === empEdit.id) s.isRevoked = true; });
          }
        }
        if (payload.newPassword && String(payload.newPassword).length >= 6) {
          var s2 = genId('SLT');
          empEdit.salt = s2;
          empEdit.passwordHash = simpleHash(s2 + ':' + payload.newPassword);
          db.sessions.forEach(function (s) { if (s.employeeId === empEdit.id) s.isRevoked = true; });
        }
        empEdit.updatedAt = new Date().toISOString();
        appendSandboxActivity(db, session.user, 'تحديث موظف', 'Employee', empEdit.id, 'تحديث بيانات وصلاحيات الموظف ' + empEdit.name);
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
        empDis.status = payload.status === 'active' ? 'active' : 'disabled';
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
        var myNotifs = db.notifications.filter(function (n) {
          return n.recipientEmployeeId === session.employeeId || (!n.recipientEmployeeId && n.recipientRole === session.role);
        });
        var unread = myNotifs.filter(function (n) { return !n.isRead; }).length;
        return { success: true, message: '', data: { items: myNotifs.slice(0, 50), unreadCount: unread }, error: null };
      }

      case 'markNotificationRead': {
        db.notifications.forEach(function (n) {
          var mine = n.recipientEmployeeId === session.employeeId || (!n.recipientEmployeeId && n.recipientRole === session.role);
          if (mine && (payload.markAll || n.id === payload.notificationId)) n.isRead = true;
        });
        saveSandboxDb(db);
        return { success: true, message: '', data: { updated: true }, error: null };
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
        if (pullRange.hasCustomRange && session.role !== 'general_manager') {
          return {
            success: false,
            message: 'FORBIDDEN: تخصيص سحب البيانات بمدة أو من تاريخ معين متاح للمدير العام فقط.',
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

        filteredBatch.forEach(function (entry) {
          var srcItem = entry.apiItem;
          var existingMatch = db.reservations.find(function (r) { return r.reservationNumber === srcItem.reservationNumber; });
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
        });

        var rangeNote = pullRange.hasCustomRange
          ? (' | النطاق: ' + (pullRange.dateFrom || '-') + ' → ' + (pullRange.dateTo || '-'))
          : '';
        var pullSyncRec = {
          id: genId('SYNC'),
          triggeredById: session.employeeId,
          triggeredByName: session.user.name,
          status: 'success',
          importedCount: importedCnt,
          updatedCount: updatedCnt,
          extensionsCount: extPulledCnt,
          pagesFetched: 1,
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

      case 'getSyncStatus': {
        if (!core.canAccessApi(session.user) || !core.canUserPerform(session.user, 'sync_data')) {
          return { success: false, message: 'FORBIDDEN: صلاحيات API مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        var syncIv = core.normalizeAutoSyncInterval(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes);
        return {
          success: true,
          message: '',
          data: {
            hasToken: false,
            mode: 'sandbox',
            autoSyncEnabled: db.settings.auto_sync_enabled !== false,
            autoSyncIntervalHours: syncIv.hours,
            autoSyncIntervalMinutes: syncIv.minutes,
            lastSync: db.syncLog[0] || null,
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
          var perf = db.employees.map(function (emp) {
            return {
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
          return { success: false, message: 'FORBIDDEN: إعدادات النظام وAPI مخصصة للمدير العام والمشرف فقط.', data: null, error: 'FORBIDDEN' };
        }
        var getIv = core.normalizeAutoSyncInterval(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes);
        return {
          success: true,
          message: '',
          data: Object.assign({}, db.settings, {
            ui_simplification: core.normalizeUiSimplificationSettings(db.settings.ui_simplification),
            auto_sync_enabled: db.settings.auto_sync_enabled !== false,
            auto_sync_interval_hours: getIv.hours,
            auto_sync_interval_minutes: getIv.minutes,
            hasRgToken: Boolean(db.settings.sandbox_has_rg_token)
          }),
          error: null
        };
      }

      case 'updateSettings': {
        if (!core.canUserPerform(session.user, 'manage_settings')) {
          return { success: false, message: 'FORBIDDEN: صلاحية المدير العام فقط.', data: null, error: 'FORBIDDEN' };
        }
        if (payload.company_name) db.settings.company_name = String(payload.company_name);
        if (Array.isArray(payload.excluded_statuses)) db.settings.excluded_statuses = payload.excluded_statuses;
        if (payload.session_ttl_hours) db.settings.session_ttl_hours = Number(payload.session_ttl_hours);
        if (typeof payload.allow_agent_view_all === 'boolean') db.settings.allow_agent_view_all = payload.allow_agent_view_all;
        if (payload.default_language) db.settings.default_language = payload.default_language;
        if (typeof payload.auto_sync_enabled === 'boolean') db.settings.auto_sync_enabled = payload.auto_sync_enabled;
        if (payload.ui_simplification !== undefined) {
          db.settings.ui_simplification = core.normalizeUiSimplificationSettings(payload.ui_simplification);
        }
        if (payload.auto_sync_interval_hours !== undefined || payload.auto_sync_interval_minutes !== undefined) {
          var nextIv = core.normalizeAutoSyncInterval(
            payload.auto_sync_interval_hours !== undefined ? payload.auto_sync_interval_hours : db.settings.auto_sync_interval_hours,
            payload.auto_sync_interval_minutes !== undefined ? payload.auto_sync_interval_minutes : db.settings.auto_sync_interval_minutes
          );
          db.settings.auto_sync_interval_hours = nextIv.hours;
          db.settings.auto_sync_interval_minutes = nextIv.minutes;
        }
        appendSandboxActivity(
          db,
          session.user,
          'تحديث الإعدادات',
          'Settings',
          'system',
          'تحديث إعدادات النظام (التحديث التلقائي: ' + (db.settings.auto_sync_enabled ? core.formatAutoSyncIntervalAr(db.settings.auto_sync_interval_hours, db.settings.auto_sync_interval_minutes) : 'متوقف') + ')'
        );
        saveSandboxDb(db);
        return {
          success: true,
          message: 'تم حفظ الإعدادات.',
          data: Object.assign({}, db.settings, {
            ui_simplification: core.normalizeUiSimplificationSettings(db.settings.ui_simplification)
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

      default:
        return { success: false, message: 'الإجراء غير مدعوم.', data: null, error: 'UNKNOWN_ACTION' };
    }
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

    var policy = (core && core.getApiCachePolicy) ? core.getApiCachePolicy(action) : { cacheable: false, ttlMs: 0, scope: '' };
    var isSilentRefresh = Boolean(payload && payload.silentRefresh);
    var skipCache = Boolean((payload && (payload.forceRefresh || payload.logExport)) || isSilentRefresh);
    var shouldWriteCache = Boolean(policy.cacheable && !(payload && payload.logExport));
    var cacheKey = (policy.cacheable && core && core.buildApiCacheKey)
      ? core.buildApiCacheKey(transportUrl, token, action, payload)
      : '';

    var startNetworkOrSandbox = function () {
      var promise = executeCall().finally(function () {
        delete inFlightRequests[cacheKey];
      });
      inFlightRequests[cacheKey] = promise;
      return promise;
    };

    // Instant local IndexedDB query path for reservations filtering/sorting/pagination
    if (action === 'getReservations' && !skipCache) {
      var activeUser = root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null;
      var fastLocalRes = queryLocalReservationsFast(payload, activeUser ? {
        employeeId: activeUser.id,
        role: activeUser.role,
        user: activeUser,
        allowAgentViewAll: !(localMetaByNs[ns] && localMetaByNs[ns].allowAgentViewAll === false)
      } : null);
      if (fastLocalRes) {
        return fastLocalRes.response;
      }
    }

    if (policy.cacheable && !skipCache && cacheKey && apiResponseCache[cacheKey]) {
      var cachedEntry = apiResponseCache[cacheKey];
      var nowTs = Date.now();
      if (nowTs < cachedEntry.expiresAt) {
        return cachedEntry.response;
      }
      if (nowTs < (cachedEntry.staleUntil || 0)) {
        if (!inFlightRequests[cacheKey]) {
          startNetworkOrSandbox().catch(function () {});
        }
        return cachedEntry.response;
      }
      delete apiResponseCache[cacheKey];
    }

    if (policy.cacheable && !skipCache && cacheKey && inFlightRequests[cacheKey]) {
      return inFlightRequests[cacheKey];
    }

    var mutLockKey = (!policy.cacheable && core && core.buildMutationLockKey)
      ? core.buildMutationLockKey(action, payload)
      : (!policy.cacheable ? String(action || '') : '');

    if (!policy.cacheable && mutLockKey && inFlightMutations[mutLockKey]) {
      return inFlightMutations[mutLockKey];
    }

    async function executeCall() {
      var parsed;
      if (!transportUrl) {
        parsed = sandboxExecute(action, token, payload);
      } else if (backendUrl) {
        var bTimeoutId = null;
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
            bTimeoutId = setTimeout(function () {
              try { bController.abort(); } catch (e) {}
            }, bTimeoutMs);
          }
          var bResponse = await fetch(backendUrl, bOpts);
          var bContentType = bResponse.headers && bResponse.headers.get ? (bResponse.headers.get('content-type') || '') : '';
          var bText = await bResponse.text();
          if (bTimeoutId) clearTimeout(bTimeoutId);
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
          var isBAbort = bErr && (bErr.name === 'AbortError' || String(bErr.message || '').indexOf('abort') !== -1);
          return {
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
            // Avoid keepalive on cross-origin 302 redirects (script.google.com -> script.googleusercontent.com)
            if (opts && opts.keepalive) {
              opts = Object.assign({}, opts);
              delete opts.keepalive;
            }

            if (typeof AbortController !== 'undefined') {
              var controller = new AbortController();
              var timeoutMs = (core && core.getGasActionTimeoutMs) ? core.getGasActionTimeoutMs(action) : 35000;
              opts.signal = controller.signal;
              timeoutId = setTimeout(function () {
                try { controller.abort(); } catch (e) {}
              }, timeoutMs);
            }

            var response = await fetch(cleanGasUrl, opts);
            var text = await response.text();
            if (timeoutId) clearTimeout(timeoutId);
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
          var isAbort = err && (err.name === 'AbortError' || String(err.message || '').indexOf('abort') !== -1);
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
            return {
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

      if (parsed && parsed.success) {
        // Persist reservation & customer entities into IndexedDB automatically
        if (action === 'getReservationDetails' && parsed.data && parsed.data.reservation) {
          setLocalDetailState(ns, parsed.data);
        } else if (action === 'getReservations' && parsed.data && Array.isArray(parsed.data.items) && parsed.data.items.length > 0) {
          setLocalReservationsState(ns, parsed.data.items, false);
        } else if ((action === 'pullReservations' || action === 'syncRentalGate') && parsed.data) {
          if (Array.isArray(parsed.data.changedReservations) && parsed.data.changedReservations.length > 0) {
            setLocalReservationsState(ns, parsed.data.changedReservations, false, {
              lastSyncAt: parsed.data.finishedAt || new Date().toISOString()
            });
            parsed.data.changedReservations.forEach(function (cr) {
              if (localDetailsByNs[ns] && localDetailsByNs[ns][cr.id]) {
                localDetailsByNs[ns][cr.id] = Object.assign({}, localDetailsByNs[ns][cr.id], {
                  reservation: cr,
                  cachedAt: Date.now()
                });
                if (root.RGIdbCache) root.RGIdbCache.upsertReservationDetail(ns, localDetailsByNs[ns][cr.id]).catch(function () {});
              }
            });
          }
          if (!transportUrl) syncSandboxSnapshotToIdb(ns);
        } else if (action === 'quickUpdateReservationStatus' && parsed.data && parsed.data.reservation) {
          setLocalReservationsState(ns, [parsed.data.reservation], false);
          if (localDetailsByNs[ns] && localDetailsByNs[ns][parsed.data.reservation.id]) {
            var curDet = localDetailsByNs[ns][parsed.data.reservation.id];
            setLocalDetailState(ns, Object.assign({}, curDet, {
              reservation: parsed.data.reservation,
              followUps: parsed.data.followUp ? [parsed.data.followUp].concat((curDet.followUps || []).filter(function (f) { return String(f.id || '').indexOf('FU_OPT_') !== 0; })) : (curDet.followUps || [])
            }));
          }
        } else if (action === 'updateReservationDetails' && parsed.data && parsed.data.id) {
          setLocalReservationsState(ns, [parsed.data], false);
          if (localDetailsByNs[ns] && localDetailsByNs[ns][parsed.data.id]) {
            setLocalDetailState(ns, Object.assign({}, localDetailsByNs[ns][parsed.data.id], { reservation: parsed.data }));
          }
        } else if (action === 'deleteAllReservations' || action === 'importReservationsFromExcel') {
          clearCache(['*']);
          if (!transportUrl) syncSandboxSnapshotToIdb(ns);
        } else if (!transportUrl && (action === 'addFollowUp' || action === 'updateFollowUp' || action === 'recordNoAnswerFollowUp' || action === 'saveReservationPinnedNote' || action === 'togglePinnedCriticalReservation' || action === 'claimReservation' || action === 'unclaimReservation' || action === 'assignEmployees' || action === 'removeAssignment' || action === 'createProblem' || action === 'updateProblem')) {
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

        if (shouldWriteCache && cacheKey) {
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
          schedulePersistApiCache(false);
        } else if (core && core.getCacheInvalidationScopes) {
          var invScopes = core.getCacheInvalidationScopes(action);
          var skipOptimisticClear = payload && payload._keepOptimisticCache;
          if (skipOptimisticClear) {
            // Reconcile primary cached scopes softly while clearing secondary summary/report caches
            var secondaryOnly = invScopes.filter(function (s) {
              return s === 'dashboard' || s === 'reports' || s === 'activity' || s === 'employees';
            });
            if (secondaryOnly.length > 0) clearCache(secondaryOnly);
            if (action === 'createProblem' && parsed.data && parsed.data.id) {
              patchCachedScopes(['problems'], function (data, actName) {
                if (actName === 'getProblems' && Array.isArray(data.items)) {
                  var replaced = data.items.map(function (it) {
                    return String(it.id || '').indexOf('PRB_OPT_') === 0 && it.reservationId === parsed.data.reservationId
                      ? parsed.data
                      : it;
                  });
                  return Object.assign({}, data, { items: replaced });
                }
                return undefined;
              });
            }
            if (action === 'updateProblem' && parsed.data && parsed.data.id) {
              patchCachedScopes(['problems'], function (data, actName) {
                if (actName === 'getProblems' && Array.isArray(data.items)) {
                  return Object.assign({}, data, {
                    items: data.items.map(function (it) { return it.id === parsed.data.id ? Object.assign({}, it, parsed.data) : it; })
                  });
                }
                if (actName === 'getProblemDetails' && data.problem && data.problem.id === parsed.data.id) {
                  return Object.assign({}, data, { problem: Object.assign({}, data.problem, parsed.data) });
                }
                return undefined;
              });
            }
          } else if (invScopes.length > 0) {
            clearCache(invScopes);
          }
        }
      } else if (payload && payload._keepOptimisticCache && core && core.getCacheInvalidationScopes) {
        // Optimistic mutation failed on server -> clear affected primary caches so next read fetches truth
        clearCache(core.getCacheInvalidationScopes(action));
      }
      return parsed;
    }

    if (policy.cacheable && !skipCache && cacheKey) {
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
    if (core && core.validateGasUrl) {
      var check = core.validateGasUrl(clean);
      if (!check.valid) {
        return { success: false, message: check.message, data: null, error: 'INVALID_GAS_URL' };
      }
      if (check.isSandbox) {
        return { success: false, message: 'يرجى إدخال رابط Web App (/exec) أولاً.', data: null, error: 'EMPTY_URL' };
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
      if (resp.status === 404 || resp.status === 405) {
        return { success: false, staticHostOnly: true, message: 'الخادم الخلفي غير متاح على هذه الاستضافة.' };
      }
      var contentType = resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '';
      var text = await resp.text();
      var core = root.RGCrmCore;
      var parsed = (core && core.parseBackendResponseText)
        ? core.parseBackendResponseText(text, resp.status, contentType)
        : (text ? JSON.parse(text) : { success: false, message: 'استجابة فارغة من الخادم (HTTP ' + resp.status + ').', data: null, error: 'EMPTY_RESPONSE' });
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

  async function applyUnifiedSetup(payload) {
    var nextPayload = Object.assign({
      siteOrigin: typeof window !== 'undefined' && window.location ? window.location.origin : ''
    }, payload || {});
    var res = await callBackendSetupEndpoint('applyUnifiedConnectionSetup', nextPayload);
    if (res && res.success && res.data) {
      var nextMode = String(res.data.mode || '').trim().toLowerCase();
      var nextGas = String(res.data.gasWebAppUrl || '').trim();
      var nextBackend = nextMode === 'neon' ? '/api/crm' : '';
      var persistGasInBrowser = Boolean(nextMode === 'gas' && nextGas && res.data.readOnlyFilesystem && !res.data.coreFilesUpdated);
      root.RG_APP_CONFIG = Object.assign(root.RG_APP_CONFIG || {}, {
        mode: nextMode,
        gasWebAppUrl: nextGas,
        backendApiUrl: nextBackend
      });
      safeStorageSet(STORAGE_GAS_URL, nextMode === 'sandbox' ? SANDBOX_SENTINEL : (persistGasInBrowser ? nextGas : ''));
      safeStorageSet(STORAGE_BACKEND_URL, '');
      if (nextMode !== 'sandbox' && typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function' && window.location && window.location.search) {
        try {
          var cleanUrl = new URL(window.location.href);
          if (cleanUrl.searchParams.has('sandbox')) {
            cleanUrl.searchParams.delete('sandbox');
            window.history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search || '') + (cleanUrl.hash || ''));
          }
        } catch (e) {}
      }
      detectedMode = nextMode;
      detectedGasUrl = nextGas;
      detectedBackendUrl = nextBackend;
      _cachedConnInfo = null;
      clearCache();
      await refreshGlobalConnection().catch(function () {});
      if (persistGasInBrowser) {
        detectedMode = 'gas';
        detectedGasUrl = nextGas;
        detectedBackendUrl = '';
        _cachedConnInfo = null;
      }
    }
    return res;
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
    getConnectionInfo: getConnectionInfo,
    setGasUrl: setGasUrl,
    getToken: getToken,
    setToken: setToken,
    isLiveMode: isLiveMode,
    warmUpGas: warmUpGas,
    clearCache: clearCache,
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
    callApi: callApi,
    pingGasUrl: pingGasUrl
  };
})(window);
