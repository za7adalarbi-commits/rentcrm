/**
 * RENTAL GATE CRM — Hardened IndexedDB Local Cache Engine & Boot Sync Enforcer
 * Persists reservations, derived customer profiles, reservation details, and API SWR cache locally
 * with strict namespace isolation, enforced server sync checks on every page load,
 * full browser cache purging utilities, and graceful in-memory fallback.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'rg_crm_idb_v2';
  var DB_VERSION = 3;
  var LEGACY_DB_NAMES = ['rg_crm_idb_v1'];
  var STORES = {
    KV: 'kv_cache',
    RESERVATIONS: 'reservations',
    CUSTOMERS: 'customers',
    DETAILS: 'reservation_details',
    META: 'meta',
    OFFLINE_QUEUE: 'offline_queue'
  };
  var DEFAULT_SYNC_INVALIDATE_SCOPES = [
    'dashboard',
    'reservations',
    'reports',
    'followups',
    'problems',
    'employees',
    'notifications',
    'activity'
  ];

  var _dbPromise = null;
  var _legacyPurged = false;
  var _bootSyncStateByNs = {};
  var _bootSyncPromiseByNs = {};
  var _memFallback = {
    kv_cache: {},
    reservations: {},
    customers: {},
    reservation_details: {},
    meta: {},
    offline_queue: {}
  };

  function isSupported() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) {
      return false;
    }
  }

  function purgeLegacyDatabasesOnce() {
    if (_legacyPurged || !isSupported() || typeof indexedDB.deleteDatabase !== 'function') return;
    _legacyPurged = true;
    LEGACY_DB_NAMES.forEach(function (legacyName) {
      try {
        var delReq = indexedDB.deleteDatabase(legacyName);
        if (delReq) {
          delReq.onerror = function () {};
          delReq.onblocked = function () {};
        }
      } catch (_e) {}
    });
  }

  function createSchemaStores(db) {
    if (!db.objectStoreNames.contains(STORES.KV)) {
      var kvStore = db.createObjectStore(STORES.KV, { keyPath: 'key' });
      kvStore.createIndex('ns', 'ns', { unique: false });
      kvStore.createIndex('scope', 'scope', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.RESERVATIONS)) {
      var resStore = db.createObjectStore(STORES.RESERVATIONS, { keyPath: 'nsId' });
      resStore.createIndex('ns', 'ns', { unique: false });
      resStore.createIndex('id', 'id', { unique: false });
      resStore.createIndex('reservationNumber', 'reservationNumber', { unique: false });
      resStore.createIndex('customerPhone', 'customerPhone', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.CUSTOMERS)) {
      var custStore = db.createObjectStore(STORES.CUSTOMERS, { keyPath: 'nsId' });
      custStore.createIndex('ns', 'ns', { unique: false });
      custStore.createIndex('id', 'id', { unique: false });
      custStore.createIndex('customerPhone', 'customerPhone', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.DETAILS)) {
      var detStore = db.createObjectStore(STORES.DETAILS, { keyPath: 'nsId' });
      detStore.createIndex('ns', 'ns', { unique: false });
      detStore.createIndex('id', 'id', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.META)) {
      db.createObjectStore(STORES.META, { keyPath: 'ns' });
    }
    if (!db.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
      var oqStore = db.createObjectStore(STORES.OFFLINE_QUEUE, { keyPath: 'id' });
      oqStore.createIndex('createdAt', 'createdAt', { unique: false });
      oqStore.createIndex('ns', 'ns', { unique: false });
    }
  }

  function open() {
    if (!isSupported()) return Promise.resolve(null);
    purgeLegacyDatabasesOnce();
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (ev) {
          createSchemaStores(ev.target.result);
        };
        req.onsuccess = function (ev) {
          var db = ev.target.result;
          db.onversionchange = function () {
            try { db.close(); } catch (e) {}
            _dbPromise = null;
          };
          db.onclose = function () {
            _dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = function () {
          _dbPromise = null;
          resolve(null);
        };
        req.onblocked = function () {
          _dbPromise = null;
          resolve(null);
        };
      } catch (e) {
        _dbPromise = null;
        resolve(null);
      }
    });
    return _dbPromise;
  }

  function makeNsId(ns, id) {
    return String(ns || 'default') + '::' + String(id || '');
  }

  function readByNsFromStore(store, ns) {
    return new Promise(function (resolve) {
      try {
        var idx = store.index('ns');
        var req = idx.getAll(IDBKeyRange.only(ns));
        req.onsuccess = function () { resolve(Array.isArray(req.result) ? req.result : []); };
        req.onerror = function () { resolve([]); };
      } catch (e) {
        resolve([]);
      }
    });
  }

  function sortCachedReservationsBySourceOrder(list) {
    if (!Array.isArray(list) || list.length <= 1) return Array.isArray(list) ? list : [];
    return list.map(function (item, idx) {
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
  }

  async function loadMeta(ns) {
    var cleanNs = String(ns || 'default');
    var db = await open();
    if (!db) {
      return _memFallback.meta[cleanNs] ? Object.assign({}, _memFallback.meta[cleanNs]) : null;
    }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction([STORES.META], 'readonly');
        var req = tx.objectStore(STORES.META).get(cleanNs);
        req.onsuccess = function () { resolve(req.result || _memFallback.meta[cleanNs] || null); };
        req.onerror = function () { resolve(_memFallback.meta[cleanNs] || null); };
      } catch (e) {
        resolve(_memFallback.meta[cleanNs] || null);
      }
    });
  }

  async function loadNamespaceSnapshot(ns) {
    var cleanNs = String(ns || 'default');
    var db = await open();
    if (!db) {
      return {
        kvEntries: Object.values(_memFallback.kv_cache).filter(function (x) { return x && x.ns === cleanNs; }),
        reservations: sortCachedReservationsBySourceOrder(Object.values(_memFallback.reservations).filter(function (x) { return x && x.ns === cleanNs; })),
        customers: Object.values(_memFallback.customers).filter(function (x) { return x && x.ns === cleanNs; }),
        details: Object.values(_memFallback.reservation_details).filter(function (x) { return x && x.ns === cleanNs; }),
        meta: _memFallback.meta[cleanNs] || null
      };
    }

    return new Promise(function (resolve) {
      try {
        var tx = db.transaction([STORES.KV, STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.DETAILS, STORES.META], 'readonly');
        var kvP = readByNsFromStore(tx.objectStore(STORES.KV), cleanNs);
        var resP = readByNsFromStore(tx.objectStore(STORES.RESERVATIONS), cleanNs);
        var custP = readByNsFromStore(tx.objectStore(STORES.CUSTOMERS), cleanNs);
        var detP = readByNsFromStore(tx.objectStore(STORES.DETAILS), cleanNs);
        var metaP = new Promise(function (resMeta) {
          try {
            var mReq = tx.objectStore(STORES.META).get(cleanNs);
            mReq.onsuccess = function () { resMeta(mReq.result || null); };
            mReq.onerror = function () { resMeta(null); };
          } catch (e) {
            resMeta(null);
          }
        });
        Promise.all([kvP, resP, custP, detP, metaP]).then(function (arr) {
          if (arr[4]) _memFallback.meta[cleanNs] = arr[4];
          resolve({
            kvEntries: arr[0],
            reservations: sortCachedReservationsBySourceOrder(arr[1]),
            customers: arr[2],
            details: arr[3],
            meta: arr[4]
          });
        }).catch(function () {
          resolve({ kvEntries: [], reservations: [], customers: [], details: [], meta: null });
        });
      } catch (e) {
        resolve({ kvEntries: [], reservations: [], customers: [], details: [], meta: null });
      }
    });
  }

  async function runWriteBatch(storeNames, writerFn) {
    var db = await open();
    if (!db) {
      try { writerFn(null); } catch (e) {}
      return true;
    }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(storeNames, 'readwrite');
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
        writerFn(tx);
      } catch (e) {
        _dbPromise = null;
        resolve(false);
      }
    });
  }

  async function putKvEntries(entries) {
    var list = Array.isArray(entries) ? entries.filter(function (e) { return e && e.key; }) : [];
    if (!list.length) return true;
    list.forEach(function (e) { _memFallback.kv_cache[e.key] = e; });
    return runWriteBatch([STORES.KV], function (tx) {
      if (!tx) return;
      var store = tx.objectStore(STORES.KV);
      list.forEach(function (e) { store.put(e); });
    });
  }

  async function deleteKvByKeys(keys) {
    var list = Array.isArray(keys) ? keys.filter(Boolean) : [];
    if (!list.length) return true;
    list.forEach(function (k) { delete _memFallback.kv_cache[k]; });
    return runWriteBatch([STORES.KV], function (tx) {
      if (!tx) return;
      var store = tx.objectStore(STORES.KV);
      list.forEach(function (k) { store.delete(k); });
    });
  }

  async function deleteKvByScopes(ns, scopes) {
    var cleanNs = String(ns || 'default');
    var scopeSet = {};
    (Array.isArray(scopes) ? scopes : [scopes]).forEach(function (s) {
      if (s) scopeSet[s] = true;
    });
    Object.keys(_memFallback.kv_cache).forEach(function (k) {
      var e = _memFallback.kv_cache[k];
      if (e && e.ns === cleanNs && scopeSet[e.scope]) delete _memFallback.kv_cache[k];
    });
    var db = await open();
    if (!db) return true;
    return runWriteBatch([STORES.KV], function (tx) {
      if (!tx) return;
      var store = tx.objectStore(STORES.KV);
      var req = store.index('ns').openCursor(IDBKeyRange.only(cleanNs));
      req.onsuccess = function (ev) {
        var cursor = ev.target.result;
        if (!cursor) return;
        if (cursor.value && scopeSet[cursor.value.scope]) {
          cursor.delete();
        }
        cursor.continue();
      };
    });
  }

  async function upsertReservations(ns, reservations) {
    var cleanNs = String(ns || 'default');
    var list = Array.isArray(reservations) ? reservations : [];
    if (!list.length) return true;
    var records = list.filter(function (r) { return r && r.id; }).map(function (r) {
      var nsId = makeNsId(cleanNs, r.id);
      var prev = _memFallback.reservations[nsId];
      var base = Object.assign({}, prev || {}, r, { ns: cleanNs, nsId: nsId });
      if (r.sourceOrder === undefined && prev && prev.sourceOrder !== undefined) {
        base.sourceOrder = prev.sourceOrder;
      }
      if (r._cacheSeq === undefined && prev && prev._cacheSeq !== undefined) {
        base._cacheSeq = prev._cacheSeq;
      }
      _memFallback.reservations[nsId] = base;
      return base;
    });
    return runWriteBatch([STORES.RESERVATIONS], function (tx) {
      if (!tx) return;
      var store = tx.objectStore(STORES.RESERVATIONS);
      records.forEach(function (rec) { store.put(rec); });
    });
  }

  async function replaceReservationsSnapshot(ns, reservations, customers, metaPatch) {
    var cleanNs = String(ns || 'default');
    var resList = Array.isArray(reservations) ? reservations : [];
    var custList = Array.isArray(customers) ? customers : [];
    var resRecords = resList.filter(function (r) { return r && r.id; }).map(function (r, idx) {
      return Object.assign({}, r, { ns: cleanNs, nsId: makeNsId(cleanNs, r.id), _cacheSeq: idx });
    });
    var custRecords = custList.filter(function (c) { return c && c.id; }).map(function (c) {
      return Object.assign({}, c, { ns: cleanNs, nsId: makeNsId(cleanNs, c.id) });
    });
    var metaRec = Object.assign({ ns: cleanNs, updatedAt: Date.now() }, _memFallback.meta[cleanNs] || {}, metaPatch || {}, {
      ns: cleanNs,
      reservationsCount: resRecords.length,
      customersCount: custRecords.length,
      updatedAt: Date.now()
    });

    Object.keys(_memFallback.reservations).forEach(function (k) {
      if (_memFallback.reservations[k] && _memFallback.reservations[k].ns === cleanNs) delete _memFallback.reservations[k];
    });
    resRecords.forEach(function (rec) { _memFallback.reservations[rec.nsId] = rec; });

    Object.keys(_memFallback.customers).forEach(function (k) {
      if (_memFallback.customers[k] && _memFallback.customers[k].ns === cleanNs) delete _memFallback.customers[k];
    });
    custRecords.forEach(function (rec) { _memFallback.customers[rec.nsId] = rec; });
    _memFallback.meta[cleanNs] = metaRec;

    return runWriteBatch([STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.META], function (tx) {
      if (!tx) return;
      var resStore = tx.objectStore(STORES.RESERVATIONS);
      var custStore = tx.objectStore(STORES.CUSTOMERS);
      var metaStore = tx.objectStore(STORES.META);

      var delRes = resStore.index('ns').openCursor(IDBKeyRange.only(cleanNs));
      delRes.onsuccess = function (ev) {
        var cur = ev.target.result;
        if (cur) { cur.delete(); cur.continue(); }
        else { resRecords.forEach(function (rec) { resStore.put(rec); }); }
      };

      var delCust = custStore.index('ns').openCursor(IDBKeyRange.only(cleanNs));
      delCust.onsuccess = function (ev) {
        var cur2 = ev.target.result;
        if (cur2) { cur2.delete(); cur2.continue(); }
        else { custRecords.forEach(function (rec) { custStore.put(rec); }); }
      };

      metaStore.put(metaRec);
    });
  }

  async function upsertCustomers(ns, customers) {
    var cleanNs = String(ns || 'default');
    var list = Array.isArray(customers) ? customers : [];
    if (!list.length) return true;
    var records = list.filter(function (c) { return c && c.id; }).map(function (c) {
      var rec = Object.assign({}, c, { ns: cleanNs, nsId: makeNsId(cleanNs, c.id) });
      _memFallback.customers[rec.nsId] = rec;
      return rec;
    });
    return runWriteBatch([STORES.CUSTOMERS], function (tx) {
      if (!tx) return;
      var store = tx.objectStore(STORES.CUSTOMERS);
      records.forEach(function (rec) { store.put(rec); });
    });
  }

  async function upsertReservationDetail(ns, detail) {
    if (!detail || !detail.reservation || !detail.reservation.id) return false;
    var cleanNs = String(ns || 'default');
    var id = detail.reservation.id;
    var rec = Object.assign({}, detail, {
      id: id,
      ns: cleanNs,
      nsId: makeNsId(cleanNs, id),
      cachedAt: detail.cachedAt || Date.now()
    });
    _memFallback.reservation_details[rec.nsId] = rec;
    return runWriteBatch([STORES.DETAILS], function (tx) {
      if (!tx) return;
      tx.objectStore(STORES.DETAILS).put(rec);
    });
  }

  async function upsertMeta(ns, patch) {
    var cleanNs = String(ns || 'default');
    var existing = await loadMeta(cleanNs);
    var rec = Object.assign({ ns: cleanNs }, existing || {}, _memFallback.meta[cleanNs] || {}, patch || {}, {
      ns: cleanNs,
      updatedAt: Date.now()
    });
    _memFallback.meta[cleanNs] = rec;
    return runWriteBatch([STORES.META], function (tx) {
      if (!tx) return;
      tx.objectStore(STORES.META).put(rec);
    });
  }

  async function clearNamespace(ns) {
    var cleanNs = String(ns || 'default');
    delete _bootSyncStateByNs[cleanNs];
    delete _bootSyncPromiseByNs[cleanNs];
    [STORES.KV, STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.DETAILS, STORES.META].forEach(function (sName) {
      Object.keys(_memFallback[sName]).forEach(function (k) {
        if (_memFallback[sName][k] && _memFallback[sName][k].ns === cleanNs) {
          delete _memFallback[sName][k];
        }
      });
    });

    return runWriteBatch([STORES.KV, STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.DETAILS, STORES.META], function (tx) {
      if (!tx) return;
      [STORES.KV, STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.DETAILS].forEach(function (sName) {
        var st = tx.objectStore(sName);
        var req = st.index('ns').openCursor(IDBKeyRange.only(cleanNs));
        req.onsuccess = function (ev) {
          var cur = ev.target.result;
          if (!cur) return;
          cur.delete();
          cur.continue();
        };
      });
      tx.objectStore(STORES.META).delete(cleanNs);
    });
  }

  function normalizeSyncSignature(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var epoch = String(raw.syncEpoch || raw.epoch || '').trim();
    var lastSyncAt = String(raw.lastSyncAt || raw.finishedAt || '').trim();
    var lastResUpdatedAt = String(raw.lastResUpdatedAt || raw.maxUpdatedAt || '').trim();
    var reservationsCount = raw.reservationsCount !== undefined && raw.reservationsCount !== null
      ? Number(raw.reservationsCount)
      : (raw.totalReservations !== undefined && raw.totalReservations !== null ? Number(raw.totalReservations) : null);
    if (!epoch && (reservationsCount !== null || lastSyncAt || lastResUpdatedAt)) {
      epoch = String(reservationsCount !== null ? reservationsCount : '') + '|' + lastSyncAt + '|' + lastResUpdatedAt;
    }
    return {
      syncEpoch: epoch,
      lastSyncAt: lastSyncAt,
      lastResUpdatedAt: lastResUpdatedAt,
      reservationsCount: (reservationsCount !== null && isFinite(reservationsCount)) ? reservationsCount : null
    };
  }

  async function recordServerSyncState(ns, syncState) {
    var cleanNs = String(ns || 'default');
    var sig = normalizeSyncSignature(syncState);
    if (!sig) return null;
    var patch = {
      lastServerEpoch: sig.syncEpoch,
      lastServerSyncAt: sig.lastSyncAt,
      lastServerResUpdatedAt: sig.lastResUpdatedAt,
      serverReservationsCount: sig.reservationsCount,
      lastSyncCheckedAt: Date.now()
    };
    await upsertMeta(cleanNs, patch);
    _bootSyncStateByNs[cleanNs] = Object.assign({}, _bootSyncStateByNs[cleanNs] || {}, {
      verified: true,
      status: 'synchronized',
      syncEpoch: sig.syncEpoch,
      lastSyncAt: sig.lastSyncAt,
      reservationsCount: sig.reservationsCount,
      checkedAt: Date.now()
    });
    return _bootSyncStateByNs[cleanNs];
  }

  /**
   * Enforces a server sync check once per page load (or on demand when opts.force is true).
   * Compares server syncEpoch / lastSyncAt / reservationsCount against IndexedDB META and
   * automatically invalidates stale dashboard & list caches when remote state changed or on cold boot mismatch.
   */
  async function enforceBootSyncCheck(ns, syncProbeFn, opts) {
    var cleanNs = String(ns || 'default');
    var o = opts || {};
    var force = Boolean(o.force);

    if (!force && _bootSyncStateByNs[cleanNs] && _bootSyncStateByNs[cleanNs].verified) {
      return _bootSyncStateByNs[cleanNs];
    }
    if (!force && _bootSyncPromiseByNs[cleanNs]) {
      return _bootSyncPromiseByNs[cleanNs];
    }

    var runPromise = (async function () {
      var localMeta = await loadMeta(cleanNs);
      var prevEpoch = localMeta ? String(localMeta.lastServerEpoch || '') : '';
      var prevSyncAt = localMeta ? String(localMeta.lastServerSyncAt || localMeta.lastSyncAt || '') : '';
      var prevResCnt = (localMeta && localMeta.serverReservationsCount !== undefined && localMeta.serverReservationsCount !== null)
        ? Number(localMeta.serverReservationsCount)
        : null;

      var probeRaw = null;
      var offlineFallback = false;
      try {
        probeRaw = typeof syncProbeFn === 'function' ? await syncProbeFn() : syncProbeFn;
      } catch (_err) {
        offlineFallback = true;
      }

      if (!probeRaw || probeRaw.offline === true) {
        offlineFallback = true;
      }

      if (offlineFallback) {
        var offlineState = {
          verified: false,
          offlineFallback: true,
          invalidated: false,
          status: 'offline_fallback',
          syncEpoch: prevEpoch,
          lastSyncAt: prevSyncAt,
          reservationsCount: prevResCnt,
          checkedAt: Date.now()
        };
        _bootSyncStateByNs[cleanNs] = offlineState;
        return offlineState;
      }

      var remoteSig = normalizeSyncSignature(probeRaw);
      var hasRemoteEpoch = Boolean(remoteSig && (remoteSig.syncEpoch || remoteSig.lastSyncAt || remoteSig.reservationsCount !== null));
      var epochChanged = hasRemoteEpoch && Boolean(
        (remoteSig.syncEpoch && remoteSig.syncEpoch !== prevEpoch) ||
        (remoteSig.lastSyncAt && remoteSig.lastSyncAt !== prevSyncAt) ||
        (remoteSig.reservationsCount !== null && prevResCnt !== null && remoteSig.reservationsCount !== prevResCnt) ||
        (!prevEpoch && remoteSig.syncEpoch)
      );

      var scopes = Array.isArray(o.scopesToInvalidate) && o.scopesToInvalidate.length
        ? o.scopesToInvalidate
        : DEFAULT_SYNC_INVALIDATE_SCOPES;
      var invalidated = false;

      if (epochChanged || o.alwaysInvalidateDashboardOnBoot === true) {
        var targetScopes = epochChanged ? scopes : ['dashboard'];
        await deleteKvByScopes(cleanNs, targetScopes);
        invalidated = true;
      }

      var nextMetaPatch = {
        lastSyncCheckedAt: Date.now()
      };
      if (epochChanged) {
        nextMetaPatch.allReservationsHydrated = false;
      }
      if (remoteSig) {
        if (remoteSig.syncEpoch) nextMetaPatch.lastServerEpoch = remoteSig.syncEpoch;
        if (remoteSig.lastSyncAt) nextMetaPatch.lastServerSyncAt = remoteSig.lastSyncAt;
        if (remoteSig.lastResUpdatedAt) nextMetaPatch.lastServerResUpdatedAt = remoteSig.lastResUpdatedAt;
        if (remoteSig.reservationsCount !== null) nextMetaPatch.serverReservationsCount = remoteSig.reservationsCount;
      }
      await upsertMeta(cleanNs, nextMetaPatch);

      var result = {
        verified: true,
        offlineFallback: false,
        invalidated: invalidated,
        epochChanged: epochChanged,
        status: epochChanged ? 'stale_purged' : 'synchronized',
        syncEpoch: (remoteSig && remoteSig.syncEpoch) || prevEpoch,
        lastSyncAt: (remoteSig && remoteSig.lastSyncAt) || prevSyncAt,
        reservationsCount: (remoteSig && remoteSig.reservationsCount !== null) ? remoteSig.reservationsCount : prevResCnt,
        checkedAt: Date.now()
      };
      _bootSyncStateByNs[cleanNs] = result;
      return result;
    })().finally(function () {
      delete _bootSyncPromiseByNs[cleanNs];
    });

    _bootSyncPromiseByNs[cleanNs] = runPromise;
    return runPromise;
  }

  function getSyncState(ns) {
    var cleanNs = String(ns || 'default');
    return _bootSyncStateByNs[cleanNs]
      ? Object.assign({}, _bootSyncStateByNs[cleanNs])
      : { verified: false, offlineFallback: false, invalidated: false, status: 'pending', syncEpoch: '', lastSyncAt: '', reservationsCount: null, checkedAt: 0 };
  }

  function resetBootSyncState(ns) {
    if (ns) {
      var cleanNs = String(ns);
      delete _bootSyncStateByNs[cleanNs];
      delete _bootSyncPromiseByNs[cleanNs];
      return;
    }
    _bootSyncStateByNs = {};
    _bootSyncPromiseByNs = {};
  }

  /**
   * Purges all IndexedDB stores, legacy databases, CacheStorage buckets,
   * Service Worker registrations, and stale session/local cache keys.
   */
  async function wipeAllCaches(options) {
    var opts = options || {};
    resetBootSyncState();
    _memFallback = {
      kv_cache: {},
      reservations: {},
      customers: {},
      reservation_details: {},
      meta: {},
      offline_queue: opts.wipeOfflineQueue ? {} : (_memFallback.offline_queue || {})
    };

    var cleared = {
      indexedDb: false,
      cacheStorage: 0,
      serviceWorkers: 0,
      sessionStorage: false,
      localStorageKeys: []
    };

    var db = await open();
    if (db) {
      var storesToClear = [STORES.KV, STORES.RESERVATIONS, STORES.CUSTOMERS, STORES.DETAILS, STORES.META];
      if (opts.wipeOfflineQueue && db.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
        storesToClear.push(STORES.OFFLINE_QUEUE);
      }
      await runWriteBatch(storesToClear, function (tx) {
        if (!tx) return;
        storesToClear.forEach(function (sName) {
          try { tx.objectStore(sName).clear(); } catch (_e) {}
        });
      });
      cleared.indexedDb = true;
    }

    if (opts.deleteDatabase && isSupported() && typeof indexedDB.deleteDatabase === 'function') {
      try {
        if (db) {
          try { db.close(); } catch (_e2) {}
          _dbPromise = null;
        }
        indexedDB.deleteDatabase(DB_NAME);
      } catch (_e3) {}
    }

    if (isSupported() && typeof indexedDB.deleteDatabase === 'function') {
      LEGACY_DB_NAMES.forEach(function (legacyName) {
        try { indexedDB.deleteDatabase(legacyName); } catch (_e4) {}
      });
    }

    try {
      if (typeof root !== 'undefined' && root.caches && typeof root.caches.keys === 'function') {
        var cacheNames = await root.caches.keys();
        await Promise.all(cacheNames.map(function (cName) {
          if (!opts.includeWorkboxCaches && /^workbox-/i.test(String(cName || ''))) {
            return Promise.resolve();
          }
          return root.caches.delete(cName).then(function (ok) {
            if (ok) cleared.cacheStorage += 1;
          }).catch(function () {});
        }));
      }
    } catch (_cErr) {}

    if (opts.unregisterServiceWorkers === true) {
      try {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
          var regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(function (reg) {
            return reg.unregister().then(function (ok) {
              if (ok) cleared.serviceWorkers += 1;
            }).catch(function () {});
          }));
        }
      } catch (_swErr) {}
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        var sessKeys = [];
        for (var i = 0; i < sessionStorage.length; i++) {
          var sk = sessionStorage.key(i);
          if (sk && sk.indexOf('rg_crm_') === 0) sessKeys.push(sk);
        }
        sessKeys.forEach(function (k) { sessionStorage.removeItem(k); });
        cleared.sessionStorage = true;
      }
    } catch (_ssErr) {}

    try {
      if (typeof localStorage !== 'undefined') {
        var preserveAuth = opts.preserveAuth !== false && opts.includeAuth !== true;
        var staleLocalKeys = [
          'rg_crm_gas_url',
          'rg_crm_backend_url',
          'rg_crm_backend_api_url',
          'rg_crm_swr_v1',
          'rg_crm_ui_simp_v1'
        ];
        if (!preserveAuth) {
          staleLocalKeys.push('rg_crm_session_token');
        }
        if (opts.includeSandboxDb) {
          staleLocalKeys.push('rg_crm_sandbox_db_v1');
        }
        staleLocalKeys.forEach(function (lk) {
          if (localStorage.getItem(lk) !== null) {
            localStorage.removeItem(lk);
            cleared.localStorageKeys.push(lk);
          }
        });
      }
    } catch (_lsErr) {}

    return cleared;
  }

  async function enqueueOfflineAction(item) {
    if (!item || typeof item !== 'object') return null;
    var rec = Object.assign({
      id: item.id || ('OQ_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      ns: String(item.ns || 'default'),
      action: String(item.action || ''),
      payload: item.payload || {},
      label: String(item.label || item.action || ''),
      createdAt: Number(item.createdAt || Date.now()),
      retryCount: Number(item.retryCount || 0)
    }, item);
    _memFallback.offline_queue[rec.id] = rec;
    await runWriteBatch([STORES.OFFLINE_QUEUE], function (tx) {
      if (!tx) return;
      tx.objectStore(STORES.OFFLINE_QUEUE).put(rec);
    });
    return rec;
  }

  async function getOfflineQueue(nsFilter) {
    var cleanNs = nsFilter ? String(nsFilter) : '';
    var sortItems = function (list) {
      return (Array.isArray(list) ? list : [])
        .filter(function (x) { return x && (!cleanNs || x.ns === cleanNs); })
        .sort(function (a, b) { return Number(a.createdAt || 0) - Number(b.createdAt || 0); });
    };
    var db = await open();
    if (!db || !db.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
      return sortItems(Object.values(_memFallback.offline_queue));
    }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction([STORES.OFFLINE_QUEUE], 'readonly');
        var req = tx.objectStore(STORES.OFFLINE_QUEUE).getAll();
        req.onsuccess = function () {
          resolve(sortItems(req.result));
        };
        req.onerror = function () {
          resolve(sortItems(Object.values(_memFallback.offline_queue)));
        };
      } catch (_e) {
        resolve(sortItems(Object.values(_memFallback.offline_queue)));
      }
    });
  }

  async function removeOfflineQueueItem(id) {
    var cleanId = String(id || '');
    if (!cleanId) return true;
    delete _memFallback.offline_queue[cleanId];
    return runWriteBatch([STORES.OFFLINE_QUEUE], function (tx) {
      if (!tx) return;
      if (tx.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
        tx.objectStore(STORES.OFFLINE_QUEUE).delete(cleanId);
      }
    });
  }

  async function clearOfflineQueue(nsFilter) {
    var cleanNs = nsFilter ? String(nsFilter) : '';
    if (!cleanNs) {
      _memFallback.offline_queue = {};
      return runWriteBatch([STORES.OFFLINE_QUEUE], function (tx) {
        if (!tx) return;
        tx.objectStore(STORES.OFFLINE_QUEUE).clear();
      });
    }
    var items = await getOfflineQueue(cleanNs);
    for (var i = 0; i < items.length; i++) {
      await removeOfflineQueueItem(items[i].id);
    }
    return true;
  }

  async function getOfflineQueueCount(nsFilter) {
    var items = await getOfflineQueue(nsFilter);
    return items.length;
  }

  root.RGIdbCache = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    isSupported: isSupported,
    open: open,
    loadMeta: loadMeta,
    loadNamespaceSnapshot: loadNamespaceSnapshot,
    putKvEntries: putKvEntries,
    deleteKvByKeys: deleteKvByKeys,
    deleteKvByScopes: deleteKvByScopes,
    upsertReservations: upsertReservations,
    replaceReservationsSnapshot: replaceReservationsSnapshot,
    upsertCustomers: upsertCustomers,
    upsertReservationDetail: upsertReservationDetail,
    upsertMeta: upsertMeta,
    clearNamespace: clearNamespace,
    recordServerSyncState: recordServerSyncState,
    enforceBootSyncCheck: enforceBootSyncCheck,
    getSyncState: getSyncState,
    resetBootSyncState: resetBootSyncState,
    wipeAllCaches: wipeAllCaches,
    enqueueOfflineAction: enqueueOfflineAction,
    getOfflineQueue: getOfflineQueue,
    removeOfflineQueueItem: removeOfflineQueueItem,
    clearOfflineQueue: clearOfflineQueue,
    getOfflineQueueCount: getOfflineQueueCount
  };
})(window);
