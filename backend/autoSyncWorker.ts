import {
  computeNextScheduledRunAt,
  deriveWorkerStatus,
  normalizeAutoSyncConfig
} from './autoSyncLogic.js';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured, type DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { subscribeCrmEvents } from './realtime.js';
import { resolveServerConfig } from './serverConfig.js';
import {
  emitSyncWorkerStatusRealtime,
  ensureWorkerStateRow,
  flushSheetsMirrorOutbox,
  pullFromRentalGateDirect,
  readWorkerStateRow,
  recordWorkerSyncOutcome,
  triggerGasIncrementalSyncAction
} from './syncService.js';

export interface AutoSyncCycleOptions {
  forceDue?: boolean;
  fetchFn?: typeof fetch;
  nowMs?: number;
}

export interface AutoSyncCycleResult {
  executed: boolean;
  reason: 'completed' | 'disabled' | 'not_due' | 'already_in_progress' | 'no_token' | 'error';
  nextRunAt: string | null;
  importedCount?: number;
  updatedCount?: number;
  extensionsCount?: number;
  error?: string;
}

const SYSTEM_SYNC_ACTOR = {
  id: 'SYSTEM_AUTO_SYNC',
  name: 'المزامنة التلقائية',
  role: 'system'
};

let workerRunning = false;
let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerCycleInFlight = false;
let workerUnsubscribeCrm: (() => void) | null = null;
let workerExecutorOverride: DbExecutor | null = null;
let workerFetchOverride: typeof fetch = fetch;

async function readSettingsMapForWorker(executor: DbExecutor): Promise<Record<string, any>> {
  const res = await executor.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (
      'auto_sync_enabled',
      'auto_sync_interval_seconds',
      'auto_sync_interval_value',
      'auto_sync_interval_unit',
      'auto_sync_interval_hours',
      'auto_sync_interval_minutes'
    )`
  );
  const out: Record<string, any> = {};
  for (const r of res.rows || []) {
    let val: any = r.value;
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    out[r.key] = val;
  }
  return out;
}

export async function runAutoSyncCycle(
  executor: DbExecutor,
  options: AutoSyncCycleOptions = {}
): Promise<AutoSyncCycleResult> {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const fetchFn = options.fetchFn || fetch;

  await ensureWorkerStateRow(executor);
  const [settingsMap, prevRow, serverCfg] = await Promise.all([
    readSettingsMapForWorker(executor),
    readWorkerStateRow(executor),
    resolveServerConfig(executor)
  ]);

  const cfg = normalizeAutoSyncConfig(settingsMap);

  await executor.query(
    `UPDATE sync_worker_state
     SET auto_sync_enabled = $1,
         interval_seconds = $2,
         interval_value = $3,
         interval_unit = $4,
         worker_heartbeat_at = $5::timestamptz,
         updated_at = COALESCE(updated_at, NOW())
     WHERE id = 'primary'`,
    [cfg.enabled, cfg.intervalSeconds, cfg.value, cfg.unit, new Date(nowMs).toISOString()]
  ).catch(() => undefined);

  if (!cfg.enabled) {
    if (prevRow && (prevRow.status !== 'stopped' || prevRow.auto_sync_enabled !== false || prevRow.next_run_at)) {
      await executor.query(
        `UPDATE sync_worker_state
         SET status = 'stopped',
             auto_sync_enabled = FALSE,
             next_run_at = NULL,
             worker_heartbeat_at = $1::timestamptz,
             updated_at = NOW()
         WHERE id = 'primary'`,
        [new Date(nowMs).toISOString()]
      ).catch(() => undefined);
      await emitSyncWorkerStatusRealtime(executor, 'syncWorkerStopped').catch(() => undefined);
    }
    return { executed: false, reason: 'disabled', nextRunAt: null };
  }

  let nextRunAt = prevRow?.next_run_at
    ? (prevRow.next_run_at instanceof Date ? prevRow.next_run_at.toISOString() : String(prevRow.next_run_at))
    : null;

  if (!nextRunAt) {
    nextRunAt = computeNextScheduledRunAt({
      enabled: true,
      intervalSeconds: cfg.intervalSeconds,
      nowMs,
      currentNextRunAt: null,
      lastRunAt: prevRow?.last_run_at || null,
      consecutiveErrors: Number(prevRow?.consecutive_errors || 0),
      reason: 'startup'
    });
    const nextStatus = deriveWorkerStatus({
      enabled: true,
      isSyncing: Boolean(prevRow?.is_syncing),
      consecutiveErrors: Number(prevRow?.consecutive_errors || 0),
      lastError: String(prevRow?.last_error || '')
    });
    await executor.query(
      `UPDATE sync_worker_state
       SET status = $1,
           next_run_at = $2::timestamptz,
           worker_heartbeat_at = $3::timestamptz
       WHERE id = 'primary'`,
      [nextStatus, nextRunAt, new Date(nowMs).toISOString()]
    ).catch(() => undefined);
  }

  const nextRunMs = nextRunAt ? Date.parse(nextRunAt) : 0;
  if (!options.forceDue && nextRunAt && Number.isFinite(nextRunMs) && nowMs < nextRunMs) {
    // Keep status synced cleanly as 'running' if enabled and no consecutive errors
    if (prevRow && prevRow.status === 'stopped') {
      const recoveredStatus = deriveWorkerStatus({
        enabled: true,
        isSyncing: Boolean(prevRow.is_syncing),
        consecutiveErrors: Number(prevRow.consecutive_errors || 0),
        lastError: String(prevRow.last_error || '')
      });
      await executor.query(
        `UPDATE sync_worker_state SET status = $1, updated_at = NOW() WHERE id = 'primary'`,
        [recoveredStatus]
      ).catch(() => undefined);
    }
    return { executed: false, reason: 'not_due', nextRunAt };
  }

  if (prevRow?.is_syncing && prevRow?.lock_expires_at && Date.parse(String(prevRow.lock_expires_at)) > nowMs) {
    return { executed: false, reason: 'already_in_progress', nextRunAt };
  }

  if (!serverCfg.rgToken && !serverCfg.gasWebAppUrl) {
    const tokenErr = 'NO_RG_TOKEN: يرجى ضبط توكن Rental Gate لتشغيل المزامنة التلقائية.';
    const retryIso = new Date(nowMs + Math.max(cfg.intervalSeconds, 60) * 1000).toISOString();
    const prevErr = String(prevRow?.last_error || '');
    if (prevRow?.status !== 'error' || prevErr !== tokenErr) {
      await executor.query(
        `UPDATE sync_worker_state
         SET status = 'error',
             last_error = $1,
             next_run_at = $2::timestamptz,
             worker_heartbeat_at = $3::timestamptz,
             updated_at = NOW()
         WHERE id = 'primary'`,
        [tokenErr, retryIso, new Date(nowMs).toISOString()]
      ).catch(() => undefined);
      await emitSyncWorkerStatusRealtime(executor, 'syncWorkerError').catch(() => undefined);
    }
    return { executed: false, reason: 'no_token', nextRunAt: retryIso, error: tokenErr };
  }

  try {
    if (serverCfg.rgToken) {
      const syncResult = await pullFromRentalGateDirect(
        executor,
        SYSTEM_SYNC_ACTOR,
        { triggerType: 'auto' },
        fetchFn
      );
      const updatedState = await readWorkerStateRow(executor);
      const outNext = updatedState?.next_run_at
        ? (updatedState.next_run_at instanceof Date ? updatedState.next_run_at.toISOString() : String(updatedState.next_run_at))
        : computeNextScheduledRunAt({
            enabled: true,
            intervalSeconds: cfg.intervalSeconds,
            nowMs: Date.now(),
            reason: 'auto_completed'
          });
      return {
        executed: true,
        reason: 'completed',
        nextRunAt: outNext,
        importedCount: syncResult.importedCount,
        updatedCount: syncResult.updatedCount,
        extensionsCount: syncResult.extensionsCount
      };
    }

    // Legacy GAS Web App fallback when rgToken is empty but gasWebAppUrl is configured
    const startedIso = new Date(nowMs).toISOString();
    const gasData = await triggerGasIncrementalSyncAction(
      executor,
      SYSTEM_SYNC_ACTOR,
      {},
      fetchFn,
      50000
    );
    await recordWorkerSyncOutcome(executor, {
      triggerType: 'auto',
      startedAt: startedIso,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - nowMs,
      ok: true,
      importedCount: Number(gasData?.importedCount || 0),
      updatedCount: Number(gasData?.updatedCount || 0),
      extensionsCount: Number(gasData?.extensionsCount || 0)
    });
    await flushSheetsMirrorOutbox(executor, fetchFn).catch(() => undefined);
    await emitSyncWorkerStatusRealtime(executor, 'syncWorkerCompleted').catch(() => undefined);
    const updatedState = await readWorkerStateRow(executor);
    return {
      executed: true,
      reason: 'completed',
      nextRunAt: updatedState?.next_run_at
        ? (updatedState.next_run_at instanceof Date ? updatedState.next_run_at.toISOString() : String(updatedState.next_run_at))
        : null,
      importedCount: Number(gasData?.importedCount || 0),
      updatedCount: Number(gasData?.updatedCount || 0),
      extensionsCount: Number(gasData?.extensionsCount || 0)
    };
  } catch (err: any) {
    const msg = String(err?.message || 'AUTO_SYNC_FAILED');
    if (msg.includes('SYNC_IN_PROGRESS')) {
      return { executed: false, reason: 'already_in_progress', nextRunAt };
    }
    const updatedState = await readWorkerStateRow(executor);
    const errNext = updatedState?.next_run_at
      ? (updatedState.next_run_at instanceof Date ? updatedState.next_run_at.toISOString() : String(updatedState.next_run_at))
      : computeNextScheduledRunAt({
          enabled: cfg.enabled,
          intervalSeconds: cfg.intervalSeconds,
          nowMs: Date.now(),
          consecutiveErrors: Number(updatedState?.consecutive_errors || 1),
          reason: 'auto_error'
        });
    return {
      executed: false,
      reason: 'error',
      nextRunAt: errNext,
      error: msg
    };
  }
}

async function computeSleepDelayMs(executor: DbExecutor): Promise<number> {
  try {
    const [settingsMap, stateRow] = await Promise.all([
      readSettingsMapForWorker(executor),
      readWorkerStateRow(executor)
    ]);
    const cfg = normalizeAutoSyncConfig(settingsMap);
    if (!cfg.enabled) return 30000;
    const nextRunMs = stateRow?.next_run_at ? Date.parse(String(stateRow.next_run_at)) : 0;
    if (!nextRunMs || !Number.isFinite(nextRunMs)) {
      return Math.min(cfg.intervalSeconds * 1000, 1000);
    }
    const delta = nextRunMs - Date.now();
    if (delta <= 0) return 200;
    return Math.min(Math.max(250, delta), 30000);
  } catch {
    return 15000;
  }
}

function scheduleNextLoopTick(delayMs: number): void {
  if (!workerRunning) return;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  workerTimer = setTimeout(() => {
    workerTimer = null;
    void tickWorkerLoop();
  }, Math.max(150, delayMs));
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

async function tickWorkerLoop(): Promise<void> {
  if (!workerRunning) return;
  if (workerCycleInFlight) {
    scheduleNextLoopTick(1000);
    return;
  }
  workerCycleInFlight = true;
  let nextDelayMs = 15000;
  try {
    const executor = workerExecutorOverride || (isDatabaseConfigured() ? createPgExecutor() : null);
    if (executor) {
      await ensureSchemaInitialized(executor);
      await runAutoSyncCycle(executor, { fetchFn: workerFetchOverride });
      nextDelayMs = await computeSleepDelayMs(executor);
    }
  } catch (err) {
    await logBackendError(workerExecutorOverride, 'autoSyncWorker', 'tickWorkerLoop', err).catch(() => undefined);
    nextDelayMs = 5000;
  } finally {
    workerCycleInFlight = false;
    if (workerRunning) {
      scheduleNextLoopTick(nextDelayMs);
    }
  }
}

export function notifyAutoSyncConfigChanged(): void {
  if (!workerRunning) return;
  scheduleNextLoopTick(120);
}

export function startAutoSyncWorker(options: {
  executor?: DbExecutor;
  fetchFn?: typeof fetch;
  initialDelayMs?: number;
} = {}): void {
  if (workerRunning) {
    notifyAutoSyncConfigChanged();
    return;
  }
  workerExecutorOverride = options.executor || null;
  workerFetchOverride = options.fetchFn || fetch;
  workerRunning = true;

  if (!workerUnsubscribeCrm) {
    workerUnsubscribeCrm = subscribeCrmEvents((evt) => {
      if (
        evt &&
        (evt.type === 'settings' ||
          evt.action === 'updateSettings' ||
          evt.action === 'saveApiToken' ||
          evt.action === 'saveGlobalConnectionSettings' ||
          evt.action === 'applyUnifiedConnectionSetup')
      ) {
        notifyAutoSyncConfigChanged();
      }
    });
  }

  scheduleNextLoopTick(options.initialDelayMs !== undefined ? options.initialDelayMs : 1500);
}

export function stopAutoSyncWorker(): void {
  workerRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  if (workerUnsubscribeCrm) {
    try {
      workerUnsubscribeCrm();
    } catch {
      // ignore
    }
    workerUnsubscribeCrm = null;
  }
  workerExecutorOverride = null;
}

export function getAutoSyncWorkerRuntimeStatus() {
  return {
    running: workerRunning,
    cycleInFlight: workerCycleInFlight
  };
}
