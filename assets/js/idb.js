/**
 * RENTAL GATE CRM — IndexedDB Local Cache Engine (Reservations, Customers, Details & SWR KV)
 * Persists reservations, derived customer profiles, reservation details, and API SWR cache locally
 * with strict namespace isolation and graceful in-memory fallback.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'rg_crm_idb_v1';
  var DB_VERSION = 1;
  var STORES = {
    KV: 'kv_cache',
    RESERVATIONS: 'reservations',
    CUSTOMERS: 'customers',
    DETAILS: 'reservation_details',
    META: 'meta'
  };

  var _dbPromise = null;
  var _memFallback = {
    kv_cache: {},
    reservations: {},
    customers: {},
    reservation_details: {},
    meta: {}
  };

  function isSupported() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) {
      return false;
    }
  }

  function open() {
    if (!isSupported()) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (ev) {
          var db = ev.target.result;
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
        };
        req.onsuccess = function (ev) {
          var db = ev.target.result;
          db.onversionchange = function () {
            try { db.close(); } catch (e) {}
            _dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) {
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

  async function loadNamespaceSnapshot(ns) {
    var cleanNs = String(ns || 'default');
    var db = await open();
    if (!db) {
      return {
        kvEntries: Object.values(_memFallback.kv_cache).filter(function (x) { return x && x.ns === cleanNs; }),
        reservations: Object.values(_memFallback.reservations).filter(function (x) { return x && x.ns === cleanNs; }),
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
          resolve({
            kvEntries: arr[0],
            reservations: arr[1],
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
      var rec = Object.assign({}, r, { ns: cleanNs, nsId: makeNsId(cleanNs, r.id) });
      _memFallback.reservations[rec.nsId] = rec;
      return rec;
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
    var resRecords = resList.filter(function (r) { return r && r.id; }).map(function (r) {
      return Object.assign({}, r, { ns: cleanNs, nsId: makeNsId(cleanNs, r.id) });
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
    var rec = Object.assign({ ns: cleanNs }, _memFallback.meta[cleanNs] || {}, patch || {}, {
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

  root.RGIdbCache = {
    DB_NAME: DB_NAME,
    STORES: STORES,
    isSupported: isSupported,
    open: open,
    loadNamespaceSnapshot: loadNamespaceSnapshot,
    putKvEntries: putKvEntries,
    deleteKvByKeys: deleteKvByKeys,
    deleteKvByScopes: deleteKvByScopes,
    upsertReservations: upsertReservations,
    replaceReservationsSnapshot: replaceReservationsSnapshot,
    upsertCustomers: upsertCustomers,
    upsertReservationDetail: upsertReservationDetail,
    upsertMeta: upsertMeta,
    clearNamespace: clearNamespace
  };
})(window);
