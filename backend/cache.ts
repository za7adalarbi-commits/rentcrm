import type { DbClient, DbExecutor } from './db.js';

export type CacheScope =
  | 'settings'
  | 'employees'
  | 'roles'
  | 'dashboard'
  | 'todayRadar'
  | 'reports'
  | 'announcements'
  | 'notifications'
  | 'reservations'
  | 'followUps'
  | 'problems'
  | 'activity'
  | 'sync';

interface CacheEntry<T = any> {
  scope: CacheScope;
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface ExecutorCacheState {
  entries: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<any>>;
  idempotency: Map<string, { expiresAt: number; result?: any; promise?: Promise<any> }>;
  localVersion: number;
  lastVersionCheckAt: number;
  versionCheckPromise: Promise<number> | null;
  maxEntries: number;
}

const DEFAULT_MAX_ENTRIES = 320;
const VERSION_CHECK_THROTTLE_MS = 1500;
const IDEMPOTENCY_TTL_MS = 120000;
const SYNC_VERSION_KEY = 'crm_sync_version';

const executorCaches = new WeakMap<object, ExecutorCacheState>();

function getState(executor: object): ExecutorCacheState {
  let state = executorCaches.get(executor);
  if (!state) {
    state = {
      entries: new Map(),
      inFlight: new Map(),
      idempotency: new Map(),
      localVersion: 0,
      lastVersionCheckAt: 0,
      versionCheckPromise: null,
      maxEntries: DEFAULT_MAX_ENTRIES
    };
    executorCaches.set(executor, state);
  }
  return state;
}

function parseVersionNum(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function readDbSyncVersion(client: DbClient): Promise<number> {
  try {
    const res = await client.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [[SYNC_VERSION_KEY]]
    );
    const row = Array.isArray(res?.rows)
      ? res.rows.find((r) => String(r?.key) === SYNC_VERSION_KEY)
      : null;
    return parseVersionNum(row?.value);
  } catch {
    return 0;
  }
}

export async function ensureCacheSyncFreshness(executor: DbExecutor, forceCheck = false): Promise<number> {
  const state = getState(executor);
  if (state.versionCheckPromise) {
    return state.versionCheckPromise;
  }
  const now = Date.now();
  if (!forceCheck && now - state.lastVersionCheckAt < VERSION_CHECK_THROTTLE_MS) {
    return state.localVersion;
  }
  state.lastVersionCheckAt = now;
  const checkPromise = readDbSyncVersion(executor)
    .then((dbVersion) => {
      if (dbVersion > state.localVersion) {
        state.entries.clear();
        state.localVersion = dbVersion;
      }
      return state.localVersion;
    })
    .finally(() => {
      if (state.versionCheckPromise === checkPromise) {
        state.versionCheckPromise = null;
      }
    });
  state.versionCheckPromise = checkPromise;
  return checkPromise;
}

function evictOverflow(state: ExecutorCacheState): void {
  const now = Date.now();
  for (const [k, v] of state.entries.entries()) {
    if (now >= v.expiresAt) {
      state.entries.delete(k);
    }
  }
  while (state.entries.size >= state.maxEntries) {
    const oldestKey = state.entries.keys().next().value;
    if (!oldestKey) break;
    state.entries.delete(oldestKey);
  }
}

export async function getCachedOrLoad<T>(
  executor: DbExecutor,
  opts: { scope: CacheScope; key: string; ttlMs: number; bypassCache?: boolean },
  loader: () => Promise<T>
): Promise<T> {
  if (opts.bypassCache || opts.ttlMs <= 0) {
    return loader();
  }

  const state = getState(executor);
  const fullKey = `${opts.scope}:${opts.key}`;

  const pending = state.inFlight.get(fullKey);
  if (pending) {
    return pending as Promise<T>;
  }

  const syncP = (async (): Promise<T> => {
    await ensureCacheSyncFreshness(executor);

    const now = Date.now();
    const hit = state.entries.get(fullKey);
    if (hit && now < hit.expiresAt) {
      state.entries.delete(fullKey);
      state.entries.set(fullKey, hit);
      return hit.value as T;
    }
    if (hit) {
      state.entries.delete(fullKey);
    }

    const value = await loader();
    evictOverflow(state);
    state.entries.set(fullKey, {
      scope: opts.scope,
      value,
      expiresAt: Date.now() + opts.ttlMs,
      createdAt: Date.now()
    });
    return value;
  })().finally(() => {
    state.inFlight.delete(fullKey);
  });

  state.inFlight.set(fullKey, syncP);
  return syncP;
}

export function invalidateScopes(executor: object, scopes: CacheScope[] | string[]): void {
  const state = getState(executor);
  const list = Array.isArray(scopes) ? scopes : [];
  if (list.includes('*')) {
    state.entries.clear();
    return;
  }
  const scopeSet = new Set(list);
  for (const [k, entry] of state.entries.entries()) {
    if (scopeSet.has(entry.scope)) {
      state.entries.delete(k);
    }
  }
}

export async function invalidateAndBumpVersion(
  executor: DbExecutor,
  scopes: CacheScope[] | string[],
  persistVersion = true
): Promise<number> {
  const state = getState(executor);
  invalidateScopes(executor, scopes);

  const nextLocal = Math.max(state.localVersion + 1, Date.now());
  state.localVersion = nextLocal;
  state.lastVersionCheckAt = Date.now();

  if (persistVersion) {
    try {
      await executor.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = GREATEST(COALESCE(NULLIF(settings.value, '')::bigint, 0) + 1, EXCLUDED.value::bigint)::text,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
        [SYNC_VERSION_KEY, String(nextLocal), 'SYSTEM']
      );
    } catch {
      // Non-fatal in case a custom/mock executor rejects ::bigint cast
    }
  }

  return state.localVersion;
}

export function getLocalCacheVersion(executor: object): number {
  return getState(executor).localVersion;
}

export async function runWithIdempotency<T>(
  executor: object,
  userId: string,
  action: string,
  clientRequestId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const cleanReqId = String(clientRequestId || '').trim();
  if (!cleanReqId || cleanReqId.length > 96) {
    return fn();
  }

  const state = getState(executor);
  const now = Date.now();
  for (const [k, entry] of state.idempotency.entries()) {
    if (now >= entry.expiresAt && !entry.promise) {
      state.idempotency.delete(k);
    }
  }

  const key = `${userId}|${action}|${cleanReqId}`;
  const existing = state.idempotency.get(key);
  if (existing) {
    if (existing.promise) {
      return existing.promise as Promise<T>;
    }
    if (now < existing.expiresAt && existing.result !== undefined) {
      return existing.result as T;
    }
  }

  const p = Promise.resolve()
    .then(() => fn())
    .then((result) => {
      state.idempotency.set(key, {
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        result
      });
      return result;
    })
    .catch((err) => {
      state.idempotency.delete(key);
      throw err;
    });

  state.idempotency.set(key, {
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    promise: p
  });

  return p;
}

const ACTION_SCOPE_MAP: Record<string, { eventType: 'delta' | 'announcement' | 'lock' | 'settings'; scopes: CacheScope[]; persistVersion: boolean }> = {
  claimReservation: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  unclaimReservation: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  quickUpdateReservationStatus: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  updateReservationDetails: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  saveReservationPinnedNote: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'activity'], persistVersion: true },
  togglePinnedCriticalReservation: { eventType: 'delta', scopes: ['reservations', 'followUps', 'settings'], persistVersion: true },
  recordNoAnswerFollowUp: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  addFollowUp: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  updateFollowUp: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  assignEmployees: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'notifications', 'reports', 'activity'], persistVersion: true },
  removeAssignment: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  bulkReassignEmployeeReservations: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'notifications', 'reports', 'activity'], persistVersion: true },
  createProblem: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'problems', 'dashboard', 'employees', 'notifications', 'reports', 'activity'], persistVersion: true },
  updateProblem: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'problems', 'dashboard', 'employees', 'notifications', 'reports', 'activity'], persistVersion: true },
  createEmployee: { eventType: 'delta', scopes: ['employees', 'dashboard', 'reports', 'activity'], persistVersion: true },
  updateEmployee: { eventType: 'delta', scopes: ['employees', 'dashboard', 'reports', 'activity'], persistVersion: true },
  disableEmployee: { eventType: 'delta', scopes: ['employees', 'dashboard', 'reports', 'activity'], persistVersion: true },
  deleteEmployee: { eventType: 'delta', scopes: ['employees', 'reservations', 'todayRadar', 'problems', 'dashboard', 'reports', 'activity'], persistVersion: true },
  saveRolePreset: { eventType: 'settings', scopes: ['employees', 'roles', 'activity'], persistVersion: true },
  deleteRolePreset: { eventType: 'settings', scopes: ['employees', 'roles', 'activity'], persistVersion: true },
  resetRolePresets: { eventType: 'settings', scopes: ['employees', 'roles', 'activity'], persistVersion: true },
  savePermissionDefinition: { eventType: 'settings', scopes: ['employees', 'roles', 'activity'], persistVersion: true },
  deletePermissionDefinition: { eventType: 'settings', scopes: ['employees', 'roles', 'activity'], persistVersion: true },
  markNotificationRead: { eventType: 'delta', scopes: ['notifications'], persistVersion: false },
  pullReservations: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity', 'sync'], persistVersion: true },
  syncRentalGate: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'dashboard', 'employees', 'reports', 'activity', 'sync'], persistVersion: true },
  importReservationsFromExcel: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'dashboard', 'employees', 'reports', 'activity'], persistVersion: true },
  deleteAllReservations: { eventType: 'delta', scopes: ['reservations', 'todayRadar', 'followUps', 'problems', 'dashboard', 'employees', 'reports', 'activity', 'sync'], persistVersion: true },
  updateSettings: { eventType: 'settings', scopes: ['settings', 'reservations', 'todayRadar', 'dashboard', 'reports', 'activity', 'sync'], persistVersion: true },
  saveApiToken: { eventType: 'settings', scopes: ['settings', 'sync', 'activity'], persistVersion: true },
  saveGlobalConnectionSettings: { eventType: 'settings', scopes: ['settings', 'sync', 'activity'], persistVersion: true },
  applyUnifiedConnectionSetup: { eventType: 'settings', scopes: ['settings', 'employees', 'dashboard', 'todayRadar', 'reservations', 'sync'], persistVersion: true },
  saveAnnouncement: { eventType: 'announcement', scopes: ['announcements', 'dashboard', 'activity'], persistVersion: true },
  deleteAnnouncement: { eventType: 'announcement', scopes: ['announcements', 'dashboard', 'activity'], persistVersion: true },
  saveDelegation: { eventType: 'delta', scopes: ['employees', 'notifications', 'activity'], persistVersion: true },
  revokeDelegation: { eventType: 'delta', scopes: ['employees', 'activity'], persistVersion: true },
  acquireReservationLock: { eventType: 'lock', scopes: [], persistVersion: false },
  releaseReservationLock: { eventType: 'lock', scopes: [], persistVersion: false }
};

export function getMutationSyncSpec(action: string) {
  return ACTION_SCOPE_MAP[String(action || '').trim()] || null;
}
