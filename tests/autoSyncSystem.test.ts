import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeNextScheduledRunAt,
  computeRetryBackoffSeconds,
  deriveWorkerStatus,
  MAX_AUTO_SYNC_SECONDS,
  MIN_AUTO_SYNC_SECONDS,
  normalizeAutoSyncConfig,
  validateAutoSyncSettingsInput
} from '../backend/autoSyncLogic';
import { runAutoSyncCycle } from '../backend/autoSyncWorker';
import { type AuthSession, crmCore, hashPassword, hashToken } from '../backend/auth';
import { type DbClient, type DbExecutor, type QueryResult } from '../backend/db';
import { FIXED_SERVER_CONFIG } from '../backend/fixedConfig';
import { getDeltaSync, getSettings, getSyncStatus, pullOrSyncReservations, updateSettings } from '../backend/queries';
import { subscribeCrmEvents } from '../backend/realtime';
import {
  acquireSyncDistributedLock,
  pullFromRentalGateDirect,
  releaseSyncDistributedLock
} from '../backend/syncService';

function createAutoSyncMockExecutor(): DbExecutor & {
  state: {
    employees: any[];
    settings: any[];
    reservations: any[];
    extensions: any[];
    sync_log: any[];
    sync_checkpoints: any[];
    sync_worker_state: any[];
    activity_log: any[];
    notifications: any[];
    sheets_mirror_outbox: any[];
    error_logs: any[];
    pg_notifies: Array<{ channel: string; payload: any }>;
  };
} {
  const state = {
    employees: [] as any[],
    settings: [] as any[],
    reservations: [] as any[],
    extensions: [] as any[],
    sync_log: [] as any[],
    sync_checkpoints: [] as any[],
    sync_worker_state: [] as any[],
    activity_log: [] as any[],
    notifications: [] as any[],
    sheets_mirror_outbox: [] as any[],
    error_logs: [] as any[],
    pg_notifies: [] as Array<{ channel: string; payload: any }>
  };

  function makeDefaultWorkerRow() {
    return {
      id: 'primary',
      status: 'running',
      is_syncing: false,
      locked_by: '',
      lock_expires_at: null as Date | null,
      auto_sync_enabled: true,
      interval_seconds: 43200,
      interval_value: 12,
      interval_unit: 'hours',
      last_run_at: null as Date | null,
      last_success_at: null as Date | null,
      next_run_at: null as Date | null,
      last_duration_ms: 0,
      last_imported_count: 0,
      last_updated_count: 0,
      last_extensions_count: 0,
      error_count: 0,
      consecutive_errors: 0,
      last_error: '',
      last_trigger_type: '',
      worker_heartbeat_at: null as Date | null,
      updated_at: new Date()
    };
  }

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SAVEPOINT ') || sql.startsWith('RELEASE SAVEPOINT ') || sql.startsWith('ROLLBACK TO SAVEPOINT ')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT pg_notify(')) {
      state.pg_notifies.push({
        channel: String(params[0] || ''),
        payload: typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
      });
      return { rows: [], rowCount: 1 };
    }

    // Worker state queries
    if (sql.startsWith("INSERT INTO sync_worker_state (id) VALUES ('primary')")) {
      if (!state.sync_worker_state.length) {
        state.sync_worker_state.push(makeDefaultWorkerRow());
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("FROM sync_worker_state WHERE id = 'primary'")) {
      return { rows: state.sync_worker_state.slice(0, 1) as any[], rowCount: state.sync_worker_state.length ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET is_syncing = TRUE')) {
      const row = state.sync_worker_state[0];
      if (!row) return { rows: [], rowCount: 0 };
      const nowMs = Date.now();
      const lockExpired = !row.lock_expires_at || Date.parse(String(row.lock_expires_at)) < nowMs;
      if (row.is_syncing && !lockExpired) {
        return { rows: [], rowCount: 0 };
      }
      const leaseSec = Number(params[1] || 300);
      row.is_syncing = true;
      row.locked_by = String(params[0] || '');
      row.lock_expires_at = new Date(nowMs + leaseSec * 1000);
      row.updated_at = new Date();
      return { rows: [{ id: 'primary' }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET is_syncing = FALSE')) {
      const row = state.sync_worker_state[0];
      if (row && (row.locked_by === params[0] || row.locked_by === '')) {
        row.is_syncing = false;
        row.locked_by = '';
        row.lock_expires_at = null;
        row.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET auto_sync_enabled = $1, interval_seconds = $2')) {
      const row = state.sync_worker_state[0] || (state.sync_worker_state.push(makeDefaultWorkerRow()), state.sync_worker_state[0]);
      row.auto_sync_enabled = Boolean(params[0]);
      row.interval_seconds = Number(params[1]);
      row.interval_value = Number(params[2]);
      row.interval_unit = String(params[3]);
      if (sql.includes('worker_heartbeat_at = $5')) {
        row.worker_heartbeat_at = new Date(params[4]);
      } else {
        row.status = String(params[4] || row.status);
        row.next_run_at = params[5] ? new Date(params[5]) : null;
        row.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE sync_worker_state SET status = 'stopped'")) {
      const row = state.sync_worker_state[0];
      if (row) {
        row.status = 'stopped';
        row.auto_sync_enabled = false;
        row.next_run_at = null;
        row.worker_heartbeat_at = new Date(params[0]);
        row.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE sync_worker_state SET status = 'error'")) {
      const row = state.sync_worker_state[0];
      if (row) {
        row.status = 'error';
        row.last_error = String(params[0] || '');
        row.next_run_at = params[1] ? new Date(params[1]) : null;
        row.worker_heartbeat_at = new Date(params[2]);
        row.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET status = $1, next_run_at = $2')) {
      const row = state.sync_worker_state[0];
      if (row) {
        row.status = String(params[0]);
        row.next_run_at = params[1] ? new Date(params[1]) : null;
        row.worker_heartbeat_at = new Date(params[2]);
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET status = $1, updated_at = NOW()')) {
      const row = state.sync_worker_state[0];
      if (row) {
        row.status = String(params[0]);
        row.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sync_worker_state SET status = $1, is_syncing = FALSE, locked_by =')) {
      const row = state.sync_worker_state[0] || (state.sync_worker_state.push(makeDefaultWorkerRow()), state.sync_worker_state[0]);
      const ok = Boolean(params[9]);
      row.status = String(params[0]);
      row.is_syncing = false;
      row.locked_by = '';
      row.lock_expires_at = null;
      row.auto_sync_enabled = Boolean(params[1]);
      row.interval_seconds = Number(params[2]);
      row.interval_value = Number(params[3]);
      row.interval_unit = String(params[4]);
      row.last_run_at = params[5] ? new Date(params[5]) : null;
      if (params[6]) row.last_success_at = new Date(params[6]);
      row.next_run_at = params[7] ? new Date(params[7]) : null;
      row.last_duration_ms = Number(params[8] || 0);
      if (ok) {
        row.last_imported_count = Number(params[10] || 0);
        row.last_updated_count = Number(params[11] || 0);
        row.last_extensions_count = Number(params[12] || 0);
      }
      row.error_count = Number(row.error_count || 0) + Number(params[13] || 0);
      row.consecutive_errors = Number(params[14] || 0);
      row.last_error = String(params[15] || '');
      row.last_trigger_type = String(params[16] || '');
      row.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // Settings
    if (sql.startsWith('INSERT INTO settings')) {
      const [key, value, updated_by = 'SYSTEM'] = params;
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) {
        state.settings.push({ key, value, updated_by, updated_at: new Date() });
      } else if (sql.includes('DO UPDATE')) {
        existing.value = value;
        existing.updated_by = updated_by;
        existing.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT key, value FROM settings')) {
      return { rows: state.settings as any[], rowCount: state.settings.length };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'excluded_statuses'")) {
      const row = state.settings.find((s) => s.key === 'excluded_statuses');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'gas_webapp_url'")) {
      const row = state.settings.find((s) => s.key === 'gas_webapp_url');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT 1 FROM settings WHERE updated_at >")) {
      const since = new Date(params[0]).getTime();
      const hit = state.settings.some((s) => new Date(s.updated_at).getTime() > since);
      return { rows: (hit ? [{ '?column?': 1 }] : []) as any[], rowCount: hit ? 1 : 0 };
    }

    // Employees
    if (sql === 'SELECT * FROM employees') {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    // Reservations queries & upserts
    if (sql.startsWith('SELECT * FROM reservations WHERE source_reservation_id = ANY') || sql.startsWith('SELECT * FROM reservations WHERE reservation_number = ANY')) {
      const a0: string[] = Array.isArray(params[0]) ? params[0] : [];
      const a1: string[] = Array.isArray(params[1]) ? params[1] : [];
      const rows = state.reservations.filter(
        (r) => a0.includes(r.source_reservation_id) || a0.includes(r.reservation_number) || a1.includes(r.id) || a1.includes(r.reservation_number)
      );
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT id, reservation_number, source_reservation_id, internal_status, original_status_code, original_status_ar, is_source_cancelled, is_source_rejected FROM reservations')) {
      const rows = state.reservations.map((r) => ({
        id: r.id,
        reservation_number: r.reservation_number,
        source_reservation_id: r.source_reservation_id,
        internal_status: r.internal_status,
        original_status_code: r.original_status_code,
        original_status_ar: r.original_status_ar,
        is_source_cancelled: r.is_source_cancelled,
        is_source_rejected: r.is_source_rejected
      }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO reservations (')) {
      const count = Array.isArray(params[0]) ? params[0].length : 0;
      const outRows: Array<{ inserted: boolean }> = [];
      for (let i = 0; i < count; i++) {
        const rec: any = {
          id: params[0][i],
          source_reservation_id: params[1][i],
          reservation_number: params[2][i],
          source_created_at: params[3][i],
          customer_name: params[4][i],
          customer_phone: params[5][i],
          customer_email: params[6][i],
          customer_id_number: params[7][i],
          company_name: params[8][i],
          branch_name: params[9][i],
          deliver_branch_name: params[10][i],
          car_name: params[11][i],
          plate_number: params[12][i],
          car_category: params[13][i],
          start_date: params[14][i],
          start_time: params[15][i],
          original_end_date: params[16][i],
          original_end_time: params[17][i],
          end_date: params[18][i],
          end_time: params[19][i],
          extended_until_date: params[20][i],
          extended_until_time: params[21][i],
          days_count: params[22][i],
          extended_days_count: params[23][i],
          total_days_count: params[24][i],
          original_status_code: params[25][i],
          original_status_ar: params[26][i],
          pickup_type_ar: params[27][i],
          return_type_ar: params[28][i],
          payment_method: params[29][i],
          payment_status: params[30][i],
          daily_price: params[31][i],
          discount_amount: params[32][i],
          vat_amount: params[33][i],
          base_amount: params[34][i],
          extensions_count: params[35][i],
          extensions_amount: params[36][i],
          total_amount: params[37][i],
          has_extensions: params[38][i],
          internal_status: params[39][i],
          priority: params[40][i],
          assigned_employee_ids: JSON.parse(params[41][i]),
          assigned_employee_names: JSON.parse(params[42][i]),
          last_update_text: params[43][i],
          last_updated_by_id: params[44][i],
          last_updated_by_name: params[45][i],
          last_updated_at: params[46][i],
          has_problem: params[47][i],
          created_at: new Date(params[48][i]),
          updated_at: new Date(params[49][i]),
          status_history: JSON.parse(params[50][i]),
          raw_json: params[51][i],
          source_order: Array.isArray(params[52]) ? (params[52][i] ?? null) : null,
          company_number: Array.isArray(params[53]) ? (params[53][i] ?? '') : '',
          new_company_name: Array.isArray(params[54]) ? (params[54][i] ?? '') : '',
          rejection_reason: Array.isArray(params[55]) ? (params[55][i] ?? '') : '',
          car_status_at_request: Array.isArray(params[56]) ? (params[56][i] ?? '') : '',
          refund_amount: Array.isArray(params[57]) ? (params[57][i] ?? 0) : 0,
          rejected_by_id: Array.isArray(params[58]) ? (params[58][i] ?? '') : '',
          rejected_by_name: Array.isArray(params[59]) ? (params[59][i] ?? '') : '',
          rejected_at: Array.isArray(params[60]) ? (params[60][i] ?? '') : '',
          cancellation_reason: Array.isArray(params[61]) ? (params[61][i] ?? '') : '',
          cancelled_by_id: Array.isArray(params[62]) ? (params[62][i] ?? '') : '',
          cancelled_by_name: Array.isArray(params[63]) ? (params[63][i] ?? '') : '',
          cancelled_at: Array.isArray(params[64]) ? (params[64][i] ?? '') : '',
          reference_number: Array.isArray(params[65]) ? (params[65][i] ?? '') : '',
          paid_amount: Array.isArray(params[66]) ? (params[66][i] ?? 0) : 0,
          delivery_failure_reason: Array.isArray(params[67]) ? (params[67][i] ?? '') : '',
          driver_notes: Array.isArray(params[68]) ? (params[68][i] ?? '') : '',
          is_source_cancelled: Array.isArray(params[69]) ? (params[69][i] ?? null) : null,
          is_source_rejected: Array.isArray(params[70]) ? (params[70][i] ?? null) : null,
          rcc_status: Array.isArray(params[71]) ? (params[71][i] ?? '') : '',
          rcc_reason: Array.isArray(params[72]) ? (params[72][i] ?? '') : '',
          cancelled_from_decline: Array.isArray(params[73]) ? Boolean(params[73][i]) : false,
          cancelled_from_hold: Array.isArray(params[74]) ? Boolean(params[74][i]) : false,
          penalty_amount: Array.isArray(params[75]) ? (params[75][i] ?? 0) : 0
        };
        const idx = state.reservations.findIndex(
          (r) =>
            (rec.source_reservation_id && r.source_reservation_id === rec.source_reservation_id) ||
            r.reservation_number === rec.reservation_number
        );
        if (idx === -1) {
          state.reservations.push(rec);
          outRows.push({ inserted: true });
        } else {
          const prev = state.reservations[idx];
          state.reservations[idx] = {
            ...rec,
            id: prev.id,
            created_at: prev.created_at,
            source_order: rec.source_order ?? prev.source_order ?? null
          };
          outRows.push({ inserted: false });
        }
      }
      return { rows: outRows as any[], rowCount: outRows.length };
    }

    if (sql.startsWith('UPDATE reservations SET is_source_cancelled = FALSE') || sql.startsWith('UPDATE reservations SET is_source_rejected = FALSE') || sql.startsWith('UPDATE reservations SET source_order = NULL')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('UPDATE extensions e SET reservation_id = r.id')) {
      const batchIds: string[] = params[0] || [];
      let updated = 0;
      for (const ext of state.extensions) {
        if (ext.reservation_id) continue;
        const parent = state.reservations.find(
          (r) =>
            batchIds.includes(r.id) &&
            ((ext.reservation_number && ext.reservation_number === r.reservation_number) ||
              (ext.source_reservation_id && ext.source_reservation_id === r.source_reservation_id))
        );
        if (parent) {
          ext.reservation_id = parent.id;
          updated++;
        }
      }
      return { rows: [], rowCount: updated };
    }

    if (sql.startsWith('INSERT INTO extensions (') && sql.includes('unnest(')) {
      const count = Array.isArray(params[0]) ? params[0].length : 0;
      for (let i = 0; i < count; i++) {
        const ext = {
          id: params[0][i],
          extension_number: params[1][i],
          sequence_number: params[2][i],
          reservation_id: params[3][i],
          reservation_number: params[4][i],
          source_reservation_id: params[5][i],
          extension_type: params[6][i],
          extension_type_ar: params[7][i],
          status_code: params[8][i],
          status_ar: params[9][i],
          payment_status: params[10][i],
          payment_date: params[11][i],
          payment_method: params[12][i],
          extend_days: params[13][i],
          start_date: params[14][i],
          start_time: params[15][i],
          end_date: params[16][i],
          end_time: params[17][i],
          sub_total: params[18][i],
          vat_amount: params[19][i],
          amount: params[20][i],
          is_accepted_and_paid: params[21][i],
          synced_at: new Date(params[22][i])
        };
        const idx = state.extensions.findIndex((e) => e.extension_number === ext.extension_number);
        if (idx === -1) state.extensions.push(ext);
        else state.extensions[idx] = ext;
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups')) {
      const since = new Date(params[0]).getTime();
      const rows = state.reservations.filter((r) => new Date(r.updated_at).getTime() > since);
      return { rows: rows.map((r) => ({ ...r, is_followed: false })) as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM reservations')) {
      return { rows: [{ cnt: String(state.reservations.length) }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT reservation_number, source_reservation_id FROM reservations')) {
      return {
        rows: state.reservations.map((r) => ({
          reservation_number: r.reservation_number,
          source_reservation_id: r.source_reservation_id
        })) as any[],
        rowCount: state.reservations.length
      };
    }

    if (sql.startsWith('INSERT INTO sync_log')) {
      if (sql.includes("'error'") && params.length === 7) {
        state.sync_log.push({
          id: params[0],
          triggered_by_id: params[1],
          triggered_by_name: params[2],
          status: 'error',
          imported_count: 0,
          updated_count: 0,
          extensions_count: 0,
          pages_fetched: 0,
          error_message: params[3] || '',
          duration_ms: params[4],
          started_at: new Date(params[5]),
          finished_at: new Date(params[6])
        });
      } else if (sql.includes('error_message') && params.length >= 12) {
        state.sync_log.push({
          id: params[0],
          triggered_by_id: params[1],
          triggered_by_name: params[2],
          status: params[3] || 'success',
          imported_count: params[4],
          updated_count: params[5],
          extensions_count: params[6],
          pages_fetched: params[7],
          error_message: params[8] || '',
          duration_ms: params[9],
          started_at: new Date(params[10]),
          finished_at: new Date(params[11])
        });
      } else {
        state.sync_log.push({
          id: params[0],
          triggered_by_id: params[1],
          triggered_by_name: params[2],
          status: 'success',
          imported_count: params[3],
          updated_count: params[4],
          extensions_count: params[5],
          pages_fetched: params[6],
          error_message: '',
          duration_ms: params[7],
          started_at: new Date(params[8]),
          finished_at: new Date(params[9])
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM sync_log ORDER BY')) {
      return { rows: state.sync_log.slice().reverse() as any[], rowCount: state.sync_log.length };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{
        source: params[0],
        last_successful_at: params[2] || null,
        last_batch_count: params[4] ?? params[3] ?? 0,
        last_status: params[5] || 'success',
        last_error: params[6] || '',
        meta: params[7] ? (typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7]) : {},
        updated_at: new Date()
      }];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM sync_checkpoints')) {
      return { rows: state.sync_checkpoints as any[], rowCount: state.sync_checkpoints.length };
    }

    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], action_type: params[4], details: params[7] });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO notifications')) {
      state.notifications.push({ id: params[0], type: params[3], title: params[4], message: params[5] });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({
        id: params[0],
        entity_type: params[1],
        entity_id: params[2],
        action: params[3],
        payload: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
        status: 'pending'
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO error_logs')) {
      state.error_logs.push({ id: params[0], source: params[1], operation: params[2], message: params[3] });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE sheets_mirror_outbox SET status = 'completed'") || sql.startsWith("UPDATE sheets_mirror_outbox SET status = 'sent'") || sql.startsWith("UPDATE sheets_mirror_outbox SET attempts")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM sheets_mirror_outbox')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM follow_ups') || sql.startsWith('SELECT * FROM problems')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS total_cnt')) {
      return { rows: [{ total_cnt: String(state.reservations.length), active_cnt: String(state.reservations.length), cancelled_cnt: '0', rejected_cnt: '0' }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM activity_log')) {
      return { rows: state.activity_log as any[], rowCount: state.activity_log.length };
    }

    if (sql.startsWith('SELECT * FROM reservations')) {
      return { rows: state.reservations as any[], rowCount: state.reservations.length };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    state,
    query: runQuery,
    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };
}

function makeAdminSession(name = 'مدير النظام'): AuthSession {
  const rawToken = 'test-session-token';
  const nowIso = new Date().toISOString();
  return {
    tokenHash: hashToken(rawToken),
    employeeId: 'EMP_GM_1',
    username: 'gm',
    role: 'general_manager',
    user: {
      id: 'EMP_GM_1',
      name,
      username: 'gm',
      phone: '0500000000',
      email: 'gm@rentalgate.sa',
      role: 'general_manager',
      jobTitle: 'المدير العام',
      permissions: crmCore.resolveEffectivePermissions('general_manager', ['all']),
      status: 'نشط',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
  };
}

function makeMockFetchForRentalGate(pagesByEndpoint: Record<string, Array<{ data: any[]; last_page: number; total: number }>>, opts: { failWith?: string } = {}) {
  const calls: Array<{ url: string; body?: any }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body });
    if (opts.failWith) {
      throw new Error(opts.failWith);
    }
    const u = new URL(url);
    const pathname = u.pathname;
    const page = Number(u.searchParams.get('page') || 0);
    let dataset: Array<{ data: any[]; last_page: number; total: number }> = [];
    if (pathname.includes('reservations/filter') || pathname.endsWith('/reservations') || pathname.endsWith('/reservation')) {
      dataset = pagesByEndpoint.active || [];
    } else if (pathname.includes('reservation-extends')) {
      dataset = pagesByEndpoint.extensions || [{ data: [], last_page: 1, total: 0 }];
    } else if (pathname.includes('cancelled')) {
      dataset = pagesByEndpoint.cancelled || [{ data: [], last_page: 1, total: 0 }];
    } else if (pathname.includes('reservation-company-changes') || pathname.includes('rejected')) {
      dataset = pagesByEndpoint.rejected || [{ data: [], last_page: 1, total: 0 }];
    } else {
      dataset = [{ data: [], last_page: 1, total: 0 }];
    }
    const pageObj = dataset[page] || { data: [], last_page: dataset.length || 1, total: 0 };
    return new Response(
      JSON.stringify({
        content: pageObj.data,
        data: pageObj.data,
        number: page,
        totalPages: pageObj.last_page,
        totalElements: pageObj.total
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test('Pure interval validation enforces 1s..12h bounds across seconds, minutes, and hours', () => {
  assert.equal(MIN_AUTO_SYNC_SECONDS, 1);
  assert.equal(MAX_AUTO_SYNC_SECONDS, 43200);

  // Valid custom bounds
  const r1 = validateAutoSyncSettingsInput({ value: 1, unit: 'seconds' });
  assert.equal(r1.valid, true);
  assert.equal(r1.intervalSeconds, 1);
  assert.equal(r1.unit, 'seconds');

  const r2 = validateAutoSyncSettingsInput({ value: 17, unit: 'seconds' });
  assert.equal(r2.valid, true);
  assert.equal(r2.intervalSeconds, 17);

  const r3 = validateAutoSyncSettingsInput({ value: 7, unit: 'minutes' });
  assert.equal(r3.valid, true);
  assert.equal(r3.intervalSeconds, 420);

  const r4 = validateAutoSyncSettingsInput({ value: 1.5, unit: 'minutes' });
  assert.equal(r4.valid, true);
  assert.equal(r4.intervalSeconds, 90);

  const r5 = validateAutoSyncSettingsInput({ value: 12, unit: 'hours' });
  assert.equal(r5.valid, true);
  assert.equal(r5.intervalSeconds, 43200);

  // Invalid bounds (< 1s or > 12h or non-numeric)
  assert.equal(validateAutoSyncSettingsInput({ value: 0, unit: 'seconds' }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ value: -5, unit: 'seconds' }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ value: 0.5, unit: 'seconds' }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ value: 721, unit: 'minutes' }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ value: 13, unit: 'hours' }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ intervalSeconds: 43201 }).valid, false);
  assert.equal(validateAutoSyncSettingsInput({ value: 'abc', unit: 'seconds' }).valid, false);

  // Backoff & status helpers
  assert.equal(computeRetryBackoffSeconds(5, 1), 5);
  assert.equal(computeRetryBackoffSeconds(5, 3), 20);
  assert.equal(computeRetryBackoffSeconds(60, 10), 300);
  assert.equal(deriveWorkerStatus({ enabled: false }), 'stopped');
  assert.equal(deriveWorkerStatus({ enabled: true, consecutiveErrors: 2, lastError: 'HTTP_502' }), 'error');
  assert.equal(deriveWorkerStatus({ enabled: true, consecutiveErrors: 0, lastError: '' }), 'running');

  // Manual pull preserves auto-sync schedule
  const futureNext = '2026-11-26T12:05:00.000Z';
  const nowMs = Date.parse('2026-11-26T12:01:00.000Z');
  const preserved = computeNextScheduledRunAt({
    enabled: true,
    intervalSeconds: 300,
    nowMs,
    currentNextRunAt: futureNext,
    reason: 'manual_completed'
  });
  assert.equal(preserved, futureNext);
});

test('Core JS bridge validates intervals identically to backend and keeps legacy interval helpers intact', () => {
  assert.equal(typeof crmCore.validateAutoSyncInterval, 'function');
  assert.equal(typeof crmCore.normalizeAutoSyncIntervalSeconds, 'function');
  assert.equal(typeof crmCore.formatAutoSyncIntervalSecondsAr, 'function');

  assert.equal(crmCore.validateAutoSyncInterval({ value: 0, unit: 'seconds' }).valid, false);
  assert.equal(crmCore.validateAutoSyncInterval({ value: 13, unit: 'hours' }).valid, false);
  const ok15 = crmCore.validateAutoSyncInterval({ value: 15, unit: 'seconds' });
  assert.equal(ok15.valid, true);
  assert.equal(ok15.intervalSeconds, 15);
  assert.match(crmCore.formatAutoSyncIntervalSecondsAr(15), /15 ثانية/);

  // Legacy functions stay backward compatible
  const leg = crmCore.normalizeAutoSyncInterval(12, 0);
  assert.equal(leg.hours, 12);
  assert.equal(leg.minutes, 0);
  assert.equal(crmCore.formatAutoSyncIntervalAr(12, 0), 'كل 12 ساعة');

  // Bundle mirror check for core, app, employees
  assert.equal(
    fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8'),
    fs.readFileSync(path.resolve(process.cwd(), 'backend/coreBridge.cjs'), 'utf8')
  );
  assert.equal(
    fs.readFileSync(path.resolve(process.cwd(), 'assets/js/app.js'), 'utf8'),
    fs.readFileSync(path.resolve(process.cwd(), 'src/assets/js/app.js'), 'utf8')
  );
  assert.equal(
    fs.readFileSync(path.resolve(process.cwd(), 'assets/js/employees.js'), 'utf8'),
    fs.readFileSync(path.resolve(process.cwd(), 'src/assets/js/employees.js'), 'utf8')
  );
});

test('Settings save stores auto-sync interval in DB, rejects out-of-range inputs, and applies toggle & cadence immediately', async () => {
  const db = createAutoSyncMockExecutor();
  const gm = makeAdminSession();

  // Reject < 1s and > 12h server-side
  await assert.rejects(
    () =>
      updateSettings(db, gm, {
        auto_sync_enabled: true,
        auto_sync_interval_value: 0,
        auto_sync_interval_unit: 'seconds'
      }),
    /VALIDATION_ERROR/
  );
  await assert.rejects(
    () =>
      updateSettings(db, gm, {
        auto_sync_enabled: true,
        auto_sync_interval_value: 13,
        auto_sync_interval_unit: 'hours'
      }),
    /VALIDATION_ERROR/
  );

  // Save valid custom 20 seconds
  const saved = await updateSettings(db, gm, {
    auto_sync_enabled: true,
    auto_sync_interval_value: 20,
    auto_sync_interval_unit: 'seconds'
  });
  assert.equal(saved.auto_sync_enabled, true);
  assert.equal(saved.auto_sync_interval_seconds, 20);
  assert.equal(saved.auto_sync_interval_value, 20);
  assert.equal(saved.auto_sync_interval_unit, 'seconds');
  assert.ok(saved.syncWorkerState);
  assert.equal(saved.syncWorkerState.status, 'running');
  assert.equal(saved.syncWorkerState.intervalSeconds, 20);

  // Reloading settings returns unified values from Neon DB
  const loaded = await getSettings(db, gm);
  assert.equal(loaded.auto_sync_enabled, true);
  assert.equal(loaded.auto_sync_interval_seconds, 20);
  assert.equal(loaded.auto_sync_interval_value, 20);
  assert.equal(loaded.auto_sync_interval_unit, 'seconds');

  // PG NOTIFY was emitted for immediate multi-user propagation
  assert.ok(db.state.pg_notifies.some((n) => n.channel === 'crm_sync_events'));

  // Disable toggle immediately updates worker status -> 'stopped'
  const disabled = await updateSettings(db, gm, { auto_sync_enabled: false });
  assert.equal(disabled.auto_sync_enabled, false);
  const syncStat = await getSyncStatus(db, gm);
  assert.equal(syncStat.workerStatus, 'stopped');
  assert.equal(syncStat.nextRunAt, null);
});

test('Background worker pulls paginated bookings without logged-in user, deduplicates, detects updates/extensions, and pushes real-time deltas', async () => {
  const prevRgToken = FIXED_SERVER_CONFIG.rgToken;
  FIXED_SERVER_CONFIG.rgToken = 'TEST_RG_TOKEN_XYZ_123456';
  const db = createAutoSyncMockExecutor();
  const gm = makeAdminSession();

  // Seed 20-second interval enabled
  await updateSettings(db, gm, {
    auto_sync_enabled: true,
    auto_sync_interval_value: 20,
    auto_sync_interval_unit: 'seconds'
  });

  const deltaSinceBefore = new Date(Date.now() - 1000).toISOString();
  const sseEvents: any[] = [];
  const unsub = subscribeCrmEvents((ev) => sseEvents.push(ev));

  try {
    // Round 1: Multi-page initial pull (page 1 + page 2, zero browser/user session involved!)
    const page1Booking1 = {
      id: 9001,
      reservation_number: 'RG-9001',
      status: 'confirmed',
      created_at: '2026-11-26T08:00:00Z',
      start_date: '2026-11-26',
      end_date: '2026-11-28',
      total: 450,
      customer: { name: 'خالد السبيعي', phone: '0551112233' },
      car: { name: 'Toyota Camry' },
      company: { name: 'Riyadh Cars' },
      extensions: []
    };
    const page2Booking2 = {
      id: 9002,
      reservation_number: 'RG-9002',
      status: 'pending',
      created_at: '2026-11-26T09:00:00Z',
      start_date: '2026-11-27',
      end_date: '2026-11-29',
      total: 600,
      customer: { name: 'فهد الدوسري', phone: '0554445566' },
      car: { name: 'Hyundai Elantra' },
      company: { name: 'Jeddah Rent' },
      extensions: []
    };

    const mock1 = makeMockFetchForRentalGate({
      active: [
        { data: [page1Booking1], last_page: 2, total: 2 },
        { data: [page2Booking2], last_page: 2, total: 2 }
      ]
    });

    const cycle1 = await runAutoSyncCycle(db, { forceDue: true, fetchFn: mock1.fetchFn });
    assert.equal(cycle1.executed, true);
    assert.equal(cycle1.reason, 'completed');
    assert.equal(cycle1.importedCount, 2);
    assert.equal(cycle1.extensionsCount, 0);
    assert.equal(db.state.reservations.length, 2);

    // Order preserved across pagination
    const r9001 = db.state.reservations.find((r) => r.reservation_number === 'RG-9001');
    const r9002 = db.state.reservations.find((r) => r.reservation_number === 'RG-9002');
    assert.ok(r9001 && r9002);
    assert.ok(Number(r9001.source_order) < Number(r9002.source_order));

    // Checkpoint recorded
    assert.equal(db.state.sync_checkpoints.length, 1);
    assert.equal(db.state.sync_checkpoints[0].source, 'rental_gate_direct');
    assert.equal(db.state.sync_checkpoints[0].last_status, 'success');

    // Real-time event broadcast (SSE + PG NOTIFY) & getDeltaSync sees updates
    assert.ok(sseEvents.some((e) => Array.isArray(e.scopes) && e.scopes.includes('reservations') && e.scopes.includes('sync')));
    assert.ok(db.state.pg_notifies.some((n) => n.channel === 'crm_sync_events'));

    const delta1 = await getDeltaSync(db, gm, { updatedAfter: deltaSinceBefore });
    assert.equal(delta1.changedReservations.length, 2);
    assert.equal(delta1.syncStatusChanged, true);
    assert.ok(delta1.syncWorkerState);
    assert.equal(delta1.syncWorkerState.status, 'running');

    // Round 2: Booking RG-9001 gets an edit + a new extension; no duplicate row created!
    const page1Booking1Updated = {
      ...page1Booking1,
      status: 'delivered',
      total: 450,
      end_date: '2026-11-30',
      extensions: [
        {
          id: 7701,
          extension_number: 'EXT-7701',
          sequence_number: 1,
          extend_days: 2,
          start_date: '2026-11-28',
          end_date: '2026-11-30',
          amount: 250,
          status: 'paid',
          is_accepted_and_paid: true
        }
      ]
    };

    const mock2 = makeMockFetchForRentalGate({
      active: [
        { data: [page1Booking1Updated, page2Booking2], last_page: 1, total: 2 }
      ],
      extensions: [
        {
          data: [
            {
              extendId: 7701,
              extensionNumber: 'EXT-7701',
              sequenceNumber: 1,
              reservationId: 9001,
              reservationNumber: 'RG-9001',
              extendDays: 2,
              startDate: '2026-11-28',
              endDate: '2026-11-30',
              amount: 250,
              status: 'accepted_and_paid',
              isAcceptedAndPaid: true
            }
          ],
          last_page: 1,
          total: 1
        }
      ]
    });
    const cycle2 = await runAutoSyncCycle(db, { forceDue: true, fetchFn: mock2.fetchFn });
    assert.equal(cycle2.executed, true);
    assert.equal(cycle2.importedCount, 0);
    assert.equal(cycle2.updatedCount, 2);
    assert.equal(cycle2.extensionsCount, 1);
    assert.equal(db.state.reservations.length, 2); // Zero duplicates!
    assert.equal(db.state.extensions.length, 1);
    const updated9001 = db.state.reservations.find((r) => r.reservation_number === 'RG-9001');
    assert.equal(Number(updated9001.total_amount), 700);
    assert.equal(updated9001.extensions_count, 1);
  } finally {
    unsub();
    FIXED_SERVER_CONFIG.rgToken = prevRgToken;
  }
});

test('Distributed lock prevents overlapping pulls, manual pull preserves auto cadence, and API error triggers backoff + recovery', async () => {
  const prevRgToken = FIXED_SERVER_CONFIG.rgToken;
  FIXED_SERVER_CONFIG.rgToken = 'TEST_RG_TOKEN_XYZ_123456';
  const db = createAutoSyncMockExecutor();
  const gm = makeAdminSession();

  try {
    await updateSettings(db, gm, {
      auto_sync_enabled: true,
      auto_sync_interval_value: 30,
      auto_sync_interval_unit: 'seconds'
    });

    // 1. Distributed lock blocks overlapping run until released
    const locked1 = await acquireSyncDistributedLock(db, 'WORKER_A', 120);
    assert.equal(locked1, true);
    const locked2 = await acquireSyncDistributedLock(db, 'WORKER_B', 120);
    assert.equal(locked2, false);
    const skippedCycle = await runAutoSyncCycle(db, { forceDue: true });
    assert.equal(skippedCycle.executed, false);
    assert.equal(skippedCycle.reason, 'already_in_progress');
    await releaseSyncDistributedLock(db, 'WORKER_A');

    // 2. Manual pull preserves existing upcoming next_run_at schedule
    const scheduledFuture = new Date(Date.now() + 25000).toISOString();
    db.state.sync_worker_state[0].next_run_at = new Date(scheduledFuture);
    const okMock = makeMockFetchForRentalGate({
      active: [{
        data: [{
          id: 9100,
          reservation_number: 'RG-9100',
          status: 'confirmed',
          created_at: '2026-11-26T10:00:00Z',
          start_date: '2026-11-26',
          end_date: '2026-11-27',
          total_amount: 300,
          customer: { name: 'عمر العتيبي', phone: '0559998877' }
        }],
        last_page: 1,
        total: 1
      }]
    });
    const manualRes = await pullFromRentalGateDirect(db, gm.user, { triggerType: 'manual' }, okMock.fetchFn);
    assert.equal(manualRes.importedCount, 1);
    const afterManualNextMs = Date.parse(String(db.state.sync_worker_state[0].next_run_at));
    assert.ok(Math.abs(afterManualNextMs - Date.parse(scheduledFuture)) <= 1500, 'Manual pull must preserve auto-sync cadence');

    // 3. Network/API error preserves existing DB data, increments error telemetry, sets status='error'
    const failMock = makeMockFetchForRentalGate({}, { failWith: 'ETIMEDOUT_UPSTREAM' });
    const errCycle = await runAutoSyncCycle(db, { forceDue: true, fetchFn: failMock.fetchFn });
    assert.equal(errCycle.executed, false);
    assert.equal(errCycle.reason, 'error');
    assert.equal(db.state.reservations.length, 1); // Existing reservation NOT lost!

    const errStatus = await getSyncStatus(db, gm);
    assert.equal(errStatus.workerStatus, 'error');
    assert.ok(errStatus.errorCount >= 1);
    assert.ok(errStatus.consecutiveErrors >= 1);
    assert.match(errStatus.lastError, /ETIMEDOUT_UPSTREAM/);

    // 4. Subsequent successful pull resets consecutive_errors and recovers status -> 'running'
    const recCycle = await runAutoSyncCycle(db, { forceDue: true, fetchFn: okMock.fetchFn });
    assert.equal(recCycle.executed, true);
    const recStatus = await getSyncStatus(db, gm);
    assert.equal(recStatus.workerStatus, 'running');
    assert.equal(recStatus.consecutiveErrors, 0);
    assert.equal(recStatus.lastError, '');

    // 5. Verify Settings UI + CSS wiring markers exist cleanly
    const settingsJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/settings.js'), 'utf8');
    assert.match(settingsJs, /id="auto-sync-settings-form"/);
    assert.match(settingsJs, /id="sync-monitor-panel"/);
    assert.match(settingsJs, /id="set-auto-sync-value"/);
    assert.match(settingsJs, /id="set-auto-sync-unit"/);
    assert.match(settingsJs, /sync-monitor-countdown/);
  } finally {
    FIXED_SERVER_CONFIG.rgToken = prevRgToken;
  }
});
