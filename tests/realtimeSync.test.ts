import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { dispatchCrmRequest } from '../backend/router';
import { mapEmployeeRow } from '../backend/auth';
import { addFollowUp, createCustomer, createProblem, createReservation, deleteCustomer, getActivityLogs, getCustomers, getReports, updateCustomer, updateProblem } from '../backend/queries';
import { applyApiCorsHeaders, parseRequestBody } from '../backend/http';
import crmApiHandler from '../api/crm';
import healthHandler from '../api/health';
import syncHandler from '../api/sync';
import cronSyncHandler from '../api/cron/sync';
import { handleSseStream, realtimeEmitter } from '../backend/realtimeBus';
import {
  enqueueSyncOperation,
  flushSyncQueue,
  retryFailedSyncItems,
  runBackupDeltaSync
} from '../backend/syncService';
import type { DbClient, DbExecutor, QueryResult } from '../backend/db';

function parseIntervalSeconds(rawSeconds: any): number {
  const n = Number(rawSeconds);
  return isNaN(n) ? 0 : n;
}

function createFullRealtimeMockExecutor(): DbExecutor & { state: Record<string, any[]> } {
  let seqCounter = 0;
  const state: Record<string, any[]> = {
    employees: [],
    users: [],
    sessions: [],
    settings: [],
    roles: [],
    permissions: [],
    customers: [],
    reservations: [],
    extensions: [],
    assignments: [],
    follow_ups: [],
    follow_up_history: [],
    problems: [],
    issues: [],
    problem_updates: [],
    activity_log: [],
    notifications: [],
    sync_log: [],
    sync_checkpoints: [],
    sheets_mirror_outbox: [],
    realtime_events: [],
    idempotency_requests: [],
    error_logs: []
  };

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.includes("to_regclass('public.employees')")) {
      return { rows: [{ reg: 'employees' }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees')) {
      return { rows: [{ cnt: String(state.employees.length) }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO employees')) {
      const [id, name, username, password_hash, salt, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
      if (!state.employees.some((e) => e.username === username)) {
        state.employees.push({
          id, name, username, password_hash, salt, phone, email, job_title, role,
          permissions: JSON.parse(permsJson), status: 'active', last_activity,
          created_at: new Date(created_at), updated_at: new Date(created_at), last_sync_at: null
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO users')) {
      const [id, name, username, phone, email, job_title, role, permsJson, last_activity, created_at] = params;
      if (!state.users.some((u) => u.username === username)) {
        state.users.push({
          id, name, username, phone, email, job_title, role,
          permissions: JSON.parse(permsJson), status: 'active', last_activity,
          created_at: new Date(created_at), updated_at: new Date(created_at)
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO settings')) {
      const [key, value, updated_by = 'SYSTEM'] = params;
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) state.settings.push({ key, value, updated_by, updated_at: new Date() });
      else if (sql.includes('DO UPDATE')) {
        existing.value = value;
        existing.updated_by = updated_by;
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO roles')) {
      const [id, label, job_title, role, permsJson] = params;
      if (!state.roles.some((r) => r.id === id)) {
        state.roles.push({ id, label, job_title, role, permissions: JSON.parse(permsJson) });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const uname = String(params[0] || '').toLowerCase();
      return { rows: state.employees.filter((e) => e.username.toLowerCase() === uname) as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM employees')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'session_ttl_hours'")) {
      const row = state.settings.find((s) => s.key === 'session_ttl_hours');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT key, value FROM settings')) {
      return { rows: state.settings as any[], rowCount: state.settings.length };
    }

    if (sql.startsWith('INSERT INTO sessions')) {
      const [token_hash, employee_id, username, role, expires_at, created_at] = params;
      state.sessions.push({
        token_hash, employee_id, username, role,
        expires_at: new Date(expires_at), created_at: new Date(created_at),
        last_seen_at: new Date(created_at), is_revoked: false
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT s.token_hash, s.employee_id')) {
      const tHash = params[0];
      const ses = state.sessions.find((s) => s.token_hash === tHash);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = state.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...ses,
          emp_id: emp.id,
          name: emp.name,
          emp_username: emp.username,
          phone: emp.phone,
          email: emp.email,
          job_title: emp.job_title,
          emp_role: emp.role,
          permissions: emp.permissions,
          emp_status: emp.status,
          last_activity: emp.last_activity,
          created_at: emp.created_at,
          updated_at: emp.updated_at
        }] as any[],
        rowCount: 1
      };
    }

    if (sql.startsWith('UPDATE sessions SET') || sql.startsWith('UPDATE employees SET last_activity') || sql.startsWith('UPDATE users SET last_activity')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], user_id: params[1], action_type: params[4], entity_type: params[5], entity_id: params[6], created_at: new Date() });
      return { rows: [], rowCount: 1 };
    }

    // ---- IDEMPOTENCY ----
    if (sql.startsWith('SELECT response FROM idempotency_requests WHERE idempotency_key = $1')) {
      const hit = state.idempotency_requests.find((r) => r.idempotency_key === params[0]);
      return { rows: (hit ? [{ response: hit.response }] : []) as any[], rowCount: hit ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO idempotency_requests')) {
      const [idempotency_key, action, responseJson] = params;
      if (!state.idempotency_requests.some((r) => r.idempotency_key === idempotency_key)) {
        state.idempotency_requests.push({ idempotency_key, action, response: JSON.parse(responseJson), created_at: new Date() });
      }
      return { rows: [], rowCount: 1 };
    }

    // ---- REALTIME EVENTS ----
    if (sql.startsWith('INSERT INTO realtime_events')) {
      const row = {
        seq: ++seqCounter,
        id: params[0],
        event_type: params[1],
        entity_type: params[2],
        record_id: params[3],
        operation: params[4],
        payload: JSON.parse(params[5]),
        actor_id: params[6],
        actor_name: params[7],
        created_at: new Date(params[8])
      };
      state.realtime_events.push(row);
      return { rows: [row] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COALESCE(MAX(seq), 0)::bigint AS max_seq FROM realtime_events')) {
      const maxSeq = state.realtime_events.reduce((m, r) => Math.max(m, Number(r.seq || 0)), 0);
      return { rows: [{ max_seq: maxSeq }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM realtime_events WHERE seq > $1')) {
      const since = Number(params[0] || 0);
      const limit = Number(params[1] || 100);
      const rows = state.realtime_events.filter((e) => Number(e.seq) > since).sort((a, b) => a.seq - b.seq).slice(0, limit);
      return { rows, rowCount: rows.length };
    }

    // ---- CUSTOMERS ----
    if (sql.startsWith('SELECT id FROM customers WHERE id = $1')) {
      const rows = state.customers.filter((c) => c.id === params[0]).map((c) => ({ id: c.id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE')) {
      const rows = state.customers.filter((c) => c.id === params[0] && !c.deleted_at);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM customers WHERE id = $1 FOR UPDATE')) {
      const rows = state.customers.filter((c) => c.id === params[0]);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO customers')) {
      const [id, name, phone, email, id_number, company_name, notes, statusOrNow, nowMaybe] = params;
      const isCreateCust = params.length === 8;
      const status = isCreateCust ? 'active' : statusOrNow;
      const nowStr = isCreateCust ? statusOrNow : nowMaybe;
      const idx = state.customers.findIndex((c) => c.id === id);
      const row = {
        id,
        name,
        phone,
        email,
        id_number,
        company_name,
        notes,
        status,
        created_at: idx === -1 ? new Date(nowStr) : state.customers[idx].created_at,
        updated_at: new Date(nowStr),
        deleted_at: null,
        last_sync_at: idx === -1 ? null : state.customers[idx].last_sync_at
      };
      if (idx === -1) state.customers.push(row);
      else state.customers[idx] = row;
      return { rows: [row] as any[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE customers SET name = $2')) {
      const [id, name, phone, email, id_number, company_name, notes, status, nowStr] = params;
      const c = state.customers.find((x) => x.id === id);
      if (c) {
        c.name = name;
        c.phone = phone;
        c.email = email;
        c.id_number = id_number;
        c.company_name = company_name;
        c.notes = notes;
        c.status = status;
        c.updated_at = new Date(nowStr);
      }
      return { rows: [], rowCount: c ? 1 : 0 };
    }

    if (sql.startsWith("UPDATE customers SET status = 'deleted'")) {
      const [id, nowStr] = params;
      const c = state.customers.find((x) => x.id === id);
      if (c) {
        c.status = 'deleted';
        c.deleted_at = new Date(nowStr);
        c.updated_at = new Date(nowStr);
      }
      return { rows: [], rowCount: c ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE customers SET last_sync_at = NOW() WHERE id = ANY')) {
      const ids: string[] = params[0] || [];
      const now = new Date();
      for (const c of state.customers) {
        if (ids.includes(c.id)) c.last_sync_at = now;
      }
      return { rows: [], rowCount: ids.length };
    }

    if (sql.startsWith('SELECT c.* FROM customers c')) {
      if (sql.includes('c.last_sync_at IS NULL OR c.updated_at > c.last_sync_at')) {
        const pendingIds = new Set(
          state.sheets_mirror_outbox
            .filter((o) => o.entity_type === 'Customer' && ['pending', 'processing', 'retry'].includes(o.status))
            .map((o) => o.entity_id)
        );
        const rows = state.customers.filter(
          (c) => !c.deleted_at && (!c.last_sync_at || new Date(c.updated_at) > new Date(c.last_sync_at)) && !pendingIds.has(c.id)
        );
        return { rows, rowCount: rows.length };
      }
      let rows = state.customers.filter((c) => !c.deleted_at);
      if (params.length > 1 && String(params[0]).startsWith('%')) {
        const needle = String(params[0]).replace(/%/g, '').toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.toLowerCase().includes(needle));
      }
      return { rows, rowCount: rows.length };
    }

    // ---- RESERVATIONS ----
    if (sql.startsWith('SELECT id FROM reservations WHERE reservation_number = $1')) {
      const rows = state.reservations.filter((r) => r.reservation_number === params[0]).map((r) => ({ id: r.id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
      const rows = state.reservations.filter((r) => r.id === params[0]);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("SELECT * FROM reservations WHERE ($1 <> '' AND id = $1)")) {
      const [id, num] = params;
      const rows = state.reservations.filter((r) => (id && r.id === id) || (num && r.reservation_number === num));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO reservations (')) {
      const rec = {
        id: params[0],
        source_reservation_id: params[1],
        reservation_number: params[2],
        source_created_at: params[3],
        customer_name: params[4],
        customer_phone: params[5],
        customer_email: params[6],
        customer_id_number: params[7],
        company_name: params[8],
        branch_name: params[9],
        deliver_branch_name: params[10],
        car_name: params[11],
        plate_number: params[12],
        car_category: params[13],
        start_date: params[14],
        start_time: params[15],
        original_end_date: params[16],
        original_end_time: params[17],
        end_date: params[18],
        end_time: params[19],
        extended_until_date: params[20],
        extended_until_time: params[21],
        days_count: params[22],
        extended_days_count: params[23],
        total_days_count: params[24],
        original_status_code: params[25],
        original_status_ar: params[26],
        pickup_type_ar: params[27],
        return_type_ar: params[28],
        payment_method: params[29],
        payment_status: params[30],
        daily_price: params[31],
        discount_amount: params[32],
        vat_amount: params[33],
        base_amount: params[34],
        extensions_count: params[35],
        extensions_amount: params[36],
        total_amount: params[37],
        has_extensions: params[38],
        internal_status: params[39],
        priority: params[40],
        assigned_employee_ids: JSON.parse(params[41]),
        assigned_employee_names: JSON.parse(params[42]),
        last_update_text: params[43],
        last_updated_by_id: params[44],
        last_updated_by_name: params[45],
        last_updated_at: params[46],
        has_problem: params[47],
        created_at: new Date(params[48]),
        updated_at: new Date(params[49]),
        status_history: JSON.parse(params[50]),
        raw_json: params[51],
        deleted_at: null,
        last_sync_at: null
      };
      const idx = state.reservations.findIndex((r) => r.reservation_number === rec.reservation_number);
      if (idx === -1) {
        state.reservations.push(rec);
        return { rows: [{ inserted: true }] as any[], rowCount: 1 };
      }
      state.reservations[idx] = { ...rec, id: state.reservations[idx].id };
      return { rows: [{ inserted: false }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE reservations SET customer_name = $2')) {
      const [id, customer_name, customer_phone, company_name, branch_name, car_name, start_date, end_date, priority, internal_status, last_update_text, last_updated_by_id, last_updated_by_name, last_updated_at, statusHistoryJson, total_amount, customer_email] = params;
      const r = state.reservations.find((x) => x.id === id);
      if (r) {
        Object.assign(r, {
          customer_name,
          customer_phone,
          company_name,
          branch_name,
          car_name,
          start_date,
          end_date,
          priority,
          internal_status,
          last_update_text,
          last_updated_by_id,
          last_updated_by_name,
          last_updated_at,
          updated_at: new Date(last_updated_at),
          status_history: JSON.parse(statusHistoryJson),
          total_amount,
          customer_email
        });
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE reservations SET internal_status = $2')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.internal_status = params[1];
        r.last_update_text = params[2];
        r.last_updated_by_id = params[3];
        r.last_updated_by_name = params[4];
        r.last_updated_at = params[5];
        r.updated_at = new Date(params[5]);
        r.status_history = JSON.parse(params[6]);
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }

    if (sql.startsWith('DELETE FROM reservations WHERE id = $1')) {
      const before = state.reservations.length;
      state.reservations = state.reservations.filter((r) => r.id !== params[0]);
      return { rows: [], rowCount: before - state.reservations.length };
    }

    if (sql.startsWith('UPDATE reservations SET last_sync_at = NOW() WHERE id = ANY')) {
      const ids: string[] = params[0] || [];
      const now = new Date();
      for (const r of state.reservations) {
        if (ids.includes(r.id) || ids.includes(r.reservation_number)) r.last_sync_at = now;
      }
      return { rows: [], rowCount: ids.length };
    }

    if (sql.startsWith('SELECT r.* FROM reservations r WHERE r.deleted_at IS NULL')) {
      const pendingIds = new Set(
        state.sheets_mirror_outbox
          .filter((o) => o.entity_type === 'Reservation' && ['pending', 'processing', 'retry'].includes(o.status))
          .map((o) => o.entity_id)
      );
      const rows = state.reservations.filter(
        (r) => !r.deleted_at && (!r.last_sync_at || new Date(r.updated_at) > new Date(r.last_sync_at)) && !pendingIds.has(r.id)
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT customer_phone, customer_name, COUNT')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO follow_ups')) {
      state.follow_ups.push({
        id: params[0], reservation_id: params[1], reservation_number: params[2], customer_name: params[3],
        employee_id: params[4], employee_name: params[5], status: params[6], action: params[7],
        notes: params[8], follow_up_date: params[9], follow_up_time: params[10], created_at: new Date(params[11])
      });
      return { rows: [], rowCount: 1 };
    }

    // ---- OUTBOX (SHEETS_MIRROR_OUTBOX) ----
    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      const [id, entity_type, entity_id, record_id, operation, action, payloadJson, idempotency_key, max_retries] = params;
      if (idempotency_key && state.sheets_mirror_outbox.some((o) => o.idempotency_key === idempotency_key)) {
        return { rows: [], rowCount: 0 };
      }
      const now = new Date();
      const row = {
        id,
        entity_type,
        entity_id,
        record_id,
        operation,
        action,
        payload: JSON.parse(payloadJson),
        idempotency_key: idempotency_key || null,
        status: 'pending',
        retry_count: 0,
        max_retries: Number(max_retries || 8),
        next_retry_at: now,
        locked_at: null,
        worker_id: '',
        last_error: '',
        created_at: now,
        updated_at: now,
        processed_at: null,
        synced_at: null
      };
      state.sheets_mirror_outbox.push(row);
      return { rows: [{ id }] as any[], rowCount: 1 };
    }

    if (sql.includes("SET status = 'retry'") && sql.includes("WHERE status = 'processing'") && sql.includes('locked_at < NOW()')) {
      const staleSecs = parseIntervalSeconds(params[0]);
      const cutoff = Date.now() - staleSecs * 1000;
      let count = 0;
      for (const o of state.sheets_mirror_outbox) {
        if (o.status === 'processing' && o.locked_at && new Date(o.locked_at).getTime() < cutoff) {
          o.status = 'retry';
          o.locked_at = null;
          o.worker_id = '';
          o.updated_at = new Date();
          if (!o.last_error) o.last_error = 'Recovered stale processing lock';
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('WITH due AS')) {
      const batchSize = Number(params[0] || 50);
      const workerId = String(params[1] || 'WRK');
      const nowMs = Date.now();
      const dueRows = state.sheets_mirror_outbox
        .filter((o) => (o.status === 'pending' || o.status === 'retry') && new Date(o.next_retry_at).getTime() <= nowMs)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(0, batchSize);
      const now = new Date();
      for (const o of dueRows) {
        o.status = 'processing';
        o.locked_at = now;
        o.worker_id = workerId;
        o.updated_at = now;
      }
      return { rows: dueRows.map((o) => ({ ...o })) as any[], rowCount: dueRows.length };
    }

    if (sql.startsWith("UPDATE sheets_mirror_outbox SET status = 'synced'")) {
      const ids: string[] = params[0] || [];
      const now = new Date();
      let count = 0;
      for (const o of state.sheets_mirror_outbox) {
        if (ids.includes(o.id)) {
          o.status = 'synced';
          o.locked_at = null;
          o.worker_id = '';
          o.last_error = '';
          o.processed_at = now;
          o.synced_at = now;
          o.updated_at = now;
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('UPDATE sheets_mirror_outbox SET status = $2, retry_count = $3')) {
      const [id, status, retry_count, last_error, delaySecs] = params;
      const o = state.sheets_mirror_outbox.find((x) => x.id === id);
      if (o) {
        o.status = status;
        o.retry_count = Number(retry_count);
        o.last_error = String(last_error || '');
        o.locked_at = null;
        o.worker_id = '';
        o.updated_at = new Date();
        o.next_retry_at = new Date(Date.now() + parseIntervalSeconds(delaySecs) * 1000);
      }
      return { rows: [], rowCount: o ? 1 : 0 };
    }

    if (sql.startsWith("UPDATE sheets_mirror_outbox SET status = 'pending', retry_count = 0")) {
      const ids: string[] | null = Array.isArray(params[0]) ? params[0] : null;
      const now = new Date();
      let count = 0;
      for (const o of state.sheets_mirror_outbox) {
        const match = ids ? ids.includes(o.id) : (o.status === 'failed' || o.status === 'retry');
        if (match) {
          o.status = 'pending';
          o.retry_count = 0;
          o.next_retry_at = now;
          o.locked_at = null;
          o.worker_id = '';
          o.last_error = '';
          o.updated_at = now;
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('SELECT status, COUNT(*)::text AS cnt FROM sheets_mirror_outbox GROUP BY status')) {
      const counts = new Map<string, number>();
      for (const o of state.sheets_mirror_outbox) {
        counts.set(o.status, (counts.get(o.status) || 0) + 1);
      }
      const rows = Array.from(counts.entries()).map(([status, cnt]) => ({ status, cnt: String(cnt) }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.includes('FROM sheets_mirror_outbox ORDER BY created_at DESC LIMIT $1')) {
      const limit = Number(params[0] || 60);
      const rows = [...state.sheets_mirror_outbox].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT p.* FROM problems p')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('UPDATE problems SET last_sync_at') || sql.startsWith('UPDATE follow_ups SET last_sync_at') || sql.startsWith('UPDATE employees SET last_sync_at')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{ source: params[0], last_status: 'success', last_batch_count: params[3] || 0 }];
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    state,
    query: runQuery,
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };
}

async function loginAdmin(db: DbExecutor): Promise<string> {
  const loginRes = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  return loginRes.data.token;
}

test('1. Customer CRUD persists in Neon, enqueues transactional outbox INSERT/UPDATE/DELETE, and pushes delta to GAS with SYNC_API_SECRET', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/test-gas/exec';
  process.env.SYNC_API_SECRET = 'TEST_SECRET_999';

  const gasRequests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    gasRequests.push(body);
    const items = body?.payload?.items || [];
    return new Response(JSON.stringify({
      success: true,
      syncedAt: new Date().toISOString(),
      data: {
        results: items.map((it: any) => ({
          success: true,
          outboxId: it.outboxId,
          operation: it.operation,
          recordId: it.recordId,
          syncedAt: new Date().toISOString()
        }))
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    // CREATE
    const createRes = await dispatchCrmRequest(db, {
      action: 'createCustomer',
      token,
      payload: { name: 'فيصل العتيبي', phone: '0509988112', companyName: 'الأفضل للسيارات' }
    });
    assert.equal(createRes.success, true);
    const custId = createRes.data.customer.id;
    assert.equal(db.state.customers.length, 1);

    // Wait briefly for non-blocking triggerImmediateSync
    await new Promise((r) => setTimeout(r, 30));

    // UPDATE
    const updRes = await dispatchCrmRequest(db, {
      action: 'updateCustomer',
      token,
      payload: { customerId: custId, name: 'فيصل بن ناصر العتيبي', notes: 'عميل VIP' }
    });
    assert.equal(updRes.success, true);
    assert.equal(db.state.customers[0].name, 'فيصل بن ناصر العتيبي');
    await new Promise((r) => setTimeout(r, 30));

    // DELETE
    const delRes = await dispatchCrmRequest(db, {
      action: 'deleteCustomer',
      token,
      payload: { customerId: custId }
    });
    assert.equal(delRes.success, true);
    assert.equal(db.state.customers[0].status, 'deleted');
    await new Promise((r) => setTimeout(r, 30));

    // Flush any remaining items cleanly
    await flushSyncQueue(db, globalThis.fetch);

    const custOutbox = db.state.sheets_mirror_outbox.filter((o) => o.entity_type === 'Customer');
    assert.equal(custOutbox.length, 3);
    assert.deepEqual(custOutbox.map((o) => o.operation), ['INSERT', 'UPDATE', 'DELETE']);
    assert.ok(custOutbox.every((o) => o.status === 'synced'));

    assert.ok(gasRequests.length >= 1);
    const sentItems = gasRequests.flatMap((req) => req.payload.items);
    assert.ok(gasRequests.every((req) => req.action === 'syncFromNeonMirror' && req.payload.syncSecret === 'TEST_SECRET_999'));
    assert.equal(sentItems.filter((i) => i.entityType === 'Customer').length, 3);
    assert.ok(sentItems.some((i) => i.operation === 'DELETE' && i.recordId === custId));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL; else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('2. Reservation Create/Update/Delete persists in Neon, enqueues outbox, emits SSE events, and syncs to GAS', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/test-gas/exec';
  process.env.SYNC_API_SECRET = 'TEST_SECRET_999';

  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const items = body?.payload?.items || [];
    return new Response(JSON.stringify({
      success: true,
      syncedAt: new Date().toISOString(),
      data: { results: items.map((it: any) => ({ success: true, outboxId: it.outboxId, operation: it.operation, recordId: it.recordId })) }
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const createRes = await dispatchCrmRequest(db, {
      action: 'createReservation',
      token,
      payload: {
        reservationNumber: 'RG-RT-1001',
        customerName: 'سعد المري',
        customerPhone: '0551112233',
        carName: 'هيونداي سوناتا 2026',
        totalAmount: 750
      }
    });
    assert.equal(createRes.success, true);
    const resId = createRes.data.reservation.id;
    assert.equal(db.state.reservations.length, 1);

    const updRes = await dispatchCrmRequest(db, {
      action: 'updateReservationDetails',
      token,
      payload: { reservationId: resId, internalStatus: 'تم الحجز', totalAmount: 900 }
    });
    assert.equal(updRes.success, true);
    assert.equal(db.state.reservations[0].total_amount, 900);

    const delRes = await dispatchCrmRequest(db, {
      action: 'deleteReservation',
      token,
      payload: { reservationId: resId }
    });
    assert.equal(delRes.success, true);
    assert.equal(db.state.reservations.length, 0);

    await new Promise((r) => setTimeout(r, 40));
    await flushSyncQueue(db, globalThis.fetch);

    const resOutbox = db.state.sheets_mirror_outbox.filter((o) => o.entity_type === 'Reservation');
    assert.deepEqual(resOutbox.map((o) => o.operation), ['INSERT', 'UPDATE', 'DELETE']);
    assert.ok(resOutbox.every((o) => o.status === 'synced'));

    const resEvents = db.state.realtime_events.filter((e) => e.entity_type === 'Reservation');
    assert.deepEqual(resEvents.map((e) => e.event_type), ['reservation:created', 'reservation:updated', 'reservation:deleted']);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL; else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('3. Rapid 20-edit burst preserves all updates without losing any outbox item', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  delete process.env.GAS_WEBAPP_URL; // keep items queued during burst then flush once

  try {
    const createCust = await dispatchCrmRequest(db, {
      action: 'createCustomer',
      token,
      payload: { name: 'عميل التحديث المتتابع', phone: '0500001122' }
    });
    const custId = createCust.data.customer.id;

    for (let i = 1; i <= 20; i++) {
      const r = await dispatchCrmRequest(db, {
        action: 'updateCustomer',
        token,
        payload: { customerId: custId, notes: `دفعة رقم ${i}` }
      });
      assert.equal(r.success, true);
    }

    assert.equal(db.state.customers[0].notes, 'دفعة رقم 20');
    const custOutbox = db.state.sheets_mirror_outbox.filter((o) => o.entity_type === 'Customer');
    assert.equal(custOutbox.length, 21); // 1 INSERT + 20 UPDATE
    assert.equal(custOutbox[20].payload.notes, 'دفعة رقم 20');
  } finally {
    if (prevGas !== undefined) process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('4. GAS outage (HTTP 500) never blocks Neon save, marks outbox retry with exponential backoff, and recovers on retry', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/test-gas/exec';
  process.env.SYNC_API_SECRET = 'TEST_SECRET_999';

  // GAS returns 500 during write
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ success: false, error: 'GAS_TEMP_DOWN' }), { status: 500 });
  }) as typeof fetch;

  try {
    const createRes = await dispatchCrmRequest(db, {
      action: 'createCustomer',
      token,
      payload: { name: 'عميل صامد', phone: '0544445555' }
    });
    // Neon write MUST still succeed even though GAS returned 500
    assert.equal(createRes.success, true);
    assert.equal(db.state.customers.length, 1);

    await new Promise((r) => setTimeout(r, 40));

    const outboxRow = db.state.sheets_mirror_outbox[0];
    assert.ok(outboxRow);
    assert.equal(outboxRow.status, 'retry');
    assert.equal(outboxRow.retry_count, 1);
    assert.ok(outboxRow.last_error.includes('GAS_TEMP_DOWN'));
    assert.ok(new Date(outboxRow.next_retry_at).getTime() > Date.now() + 2000);

    // Exhaust retries to force failed state
    outboxRow.retry_count = 7;
    outboxRow.next_retry_at = new Date(Date.now() - 1000);
    const deadFlush = await flushSyncQueue(db, globalThis.fetch);
    assert.equal(deadFlush.failed, 1);
    assert.equal(outboxRow.status, 'failed');

    // Recover GAS endpoint -> retryFailedSyncItems resets and delivers cleanly
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const items = body?.payload?.items || [];
      return new Response(JSON.stringify({
        success: true,
        data: { results: items.map((it: any) => ({ success: true, outboxId: it.outboxId, operation: it.operation, recordId: it.recordId })) }
      }), { status: 200 });
    }) as typeof fetch;

    const recovered = await retryFailedSyncItems(db, [outboxRow.id], globalThis.fetch);
    assert.equal(recovered.resetCount, 1);
    assert.equal(recovered.flush.synced, 1);
    assert.equal(outboxRow.status, 'synced');
    assert.ok(db.state.customers[0].last_sync_at !== null);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL; else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('5. Idempotency keys prevent duplicate Neon records and duplicate outbox entries', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  delete process.env.GAS_WEBAPP_URL;

  try {
    const reqPayload = {
      name: 'عميل مكرر الطلب',
      phone: '0533334444',
      idempotencyKey: 'IDEM_KEY_CUST_001'
    };
    const r1 = await dispatchCrmRequest(db, { action: 'createCustomer', token, payload: reqPayload });
    const r2 = await dispatchCrmRequest(db, { action: 'createCustomer', token, payload: reqPayload });

    assert.equal(r1.success, true);
    assert.equal(r2.success, true);
    assert.equal(r1.data.customer.id, r2.data.customer.id);
    assert.equal(db.state.customers.length, 1);
    assert.equal(db.state.sheets_mirror_outbox.length, 1);

    // Direct outbox conflict deduplication test
    await db.withTransaction(async (tx) => {
      await enqueueSyncOperation(tx, {
        entityType: 'Customer',
        entityId: 'CUST_X',
        operation: 'UPDATE',
        action: 'upsertCustomer',
        payload: { id: 'CUST_X' },
        idempotencyKey: 'DEDUP_OUTBOX_KEY_1'
      });
      await enqueueSyncOperation(tx, {
        entityType: 'Customer',
        entityId: 'CUST_X',
        operation: 'UPDATE',
        action: 'upsertCustomer',
        payload: { id: 'CUST_X' },
        idempotencyKey: 'DEDUP_OUTBOX_KEY_1'
      });
    });

    assert.equal(db.state.sheets_mirror_outbox.filter((o) => o.idempotency_key === 'DEDUP_OUTBOX_KEY_1').length, 1);
  } finally {
    if (prevGas !== undefined) process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('6. Live Express HTTP multi-client SSE /api/events and ?mode=poll propagate CRM mutations immediately', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const prevGas = process.env.GAS_WEBAPP_URL;
  delete process.env.GAS_WEBAPP_URL;

  const app = express();
  app.get('/api/events', (req, res) => {
    void handleSseStream(req, res, db);
  });

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const openSseClient = () => new Promise<{ events: any[]; close: () => void }>((resolve, reject) => {
    const events: any[] = [];
    const req = http.get(`${baseUrl}/api/events?token=${encodeURIComponent(token)}`, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          if (!frame.trim() || frame.startsWith(':')) continue;
          const lines = frame.split('\n');
          let evName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) evName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (dataStr) {
            events.push({ event: evName, data: JSON.parse(dataStr) });
            if (evName === 'connected') {
              resolve({ events, close: () => { res.destroy(); req.destroy(); } });
            }
          }
        }
      });
      res.on('error', () => undefined);
    });
    req.on('error', reject);
  });

  try {
    const [clientA, clientB] = await Promise.all([openSseClient(), openSseClient()]);

    const resCreate = await dispatchCrmRequest(db, {
      action: 'createReservation',
      token,
      payload: { reservationNumber: 'RG-SSE-77', customerName: 'عميل البث الحي', customerPhone: '0591112233' }
    });
    assert.equal(resCreate.success, true);

    await new Promise((r) => setTimeout(r, 80));

    const deltaA = clientA.events.find((e) => e.event === 'crm_delta' && e.data?.eventType === 'reservation:created');
    const deltaB = clientB.events.find((e) => e.event === 'crm_delta' && e.data?.eventType === 'reservation:created');
    assert.ok(deltaA);
    assert.ok(deltaB);
    assert.equal(deltaA.data.payload.reservation.reservationNumber, 'RG-SSE-77');
    assert.equal(deltaB.data.payload.reservation.reservationNumber, 'RG-SSE-77');

    // Poll fallback endpoint retrieves events strictly after since=0
    const pollResp = await fetch(`${baseUrl}/api/events?mode=poll&since=0&token=${encodeURIComponent(token)}`);
    const pollJson: any = await pollResp.json();
    assert.equal(pollJson.success, true);
    assert.ok(pollJson.data.events.some((e: any) => e.eventType === 'reservation:created'));

    clientA.close();
    clientB.close();
  } finally {
    realtimeEmitter.removeAllListeners('event');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevGas !== undefined) process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('7. Stale >90s processing lock recovers to retryable state before claiming next batch', async () => {
  const db = createFullRealtimeMockExecutor();
  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/test-gas/exec';
  process.env.SYNC_API_SECRET = 'TEST_SECRET_999';

  db.state.sheets_mirror_outbox.push({
    id: 'MIR_STALE_1',
    entity_type: 'Customer',
    entity_id: 'CUST_STALE_1',
    record_id: 'CUST_STALE_1',
    operation: 'UPDATE',
    action: 'upsertCustomer',
    payload: { id: 'CUST_STALE_1', name: 'عميل معلق' },
    idempotency_key: null,
    status: 'processing',
    retry_count: 0,
    max_retries: 8,
    next_retry_at: new Date(Date.now() - 10000),
    locked_at: new Date(Date.now() - 120000), // 120s > 90s stale threshold
    worker_id: 'CRASHED_WORKER',
    last_error: '',
    created_at: new Date(Date.now() - 120000),
    updated_at: new Date(Date.now() - 120000)
  });

  const mockFetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const items = body?.payload?.items || [];
    return new Response(JSON.stringify({
      success: true,
      data: { results: items.map((it: any) => ({ success: true, outboxId: it.outboxId })) }
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const flushRes = await flushSyncQueue(db, mockFetch);
    assert.equal(flushRes.synced, 1);
    assert.equal(db.state.sheets_mirror_outbox[0].status, 'synced');
  } finally {
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL; else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('8. 1-minute backup delta sync sends ONLY rows with last_sync_at IS NULL or updated_at > last_sync_at (never already-synced rows)', async () => {
  const db = createFullRealtimeMockExecutor();
  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/test-gas/exec';
  process.env.SYNC_API_SECRET = 'TEST_SECRET_999';

  const syncedAt = new Date(Date.now() - 60000);
  const olderAt = new Date(Date.now() - 120000);
  const newerAt = new Date(Date.now() - 5000);

  db.state.customers.push(
    // Already synced & untouched -> MUST BE SKIPPED
    { id: 'CUST_SYNCED', name: 'متزامن سابقاً', phone: '0501', email: '', id_number: '', company_name: '', notes: '', status: 'active', created_at: olderAt, updated_at: olderAt, deleted_at: null, last_sync_at: syncedAt },
    // Modified after last sync -> MUST BE INCLUDED
    { id: 'CUST_DIRTY', name: 'محدث محلياً', phone: '0502', email: '', id_number: '', company_name: '', notes: '', status: 'active', created_at: olderAt, updated_at: newerAt, deleted_at: null, last_sync_at: syncedAt },
    // Never synced -> MUST BE INCLUDED
    { id: 'CUST_NEW', name: 'غير مزامن', phone: '0503', email: '', id_number: '', company_name: '', notes: '', status: 'active', created_at: newerAt, updated_at: newerAt, deleted_at: null, last_sync_at: null }
  );

  const pushedIds: string[] = [];
  const mockFetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const items = body?.payload?.items || [];
    for (const it of items) pushedIds.push(it.recordId);
    return new Response(JSON.stringify({
      success: true,
      data: { results: items.map((it: any) => ({ success: true, outboxId: it.outboxId })) }
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const res = await runBackupDeltaSync(db, undefined, { pullRentalGate: false, fetchFn: mockFetch });
    assert.equal(res.enqueuedMissed, 2);
    assert.deepEqual(pushedIds.sort(), ['CUST_DIRTY', 'CUST_NEW']);
    assert.ok(!pushedIds.includes('CUST_SYNCED'));
    assert.equal(res.flushResult.synced, 2);
  } finally {
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL; else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('9. mapEmployeeRow preserves custom permissions and getActivityLogs/getReports enforce accurate RBAC', async () => {
  const customAgent = mapEmployeeRow({
    id: 'EMP_CUSTOM_1',
    name: 'وكيل مميز',
    username: 'custom_agent',
    role: 'agent',
    permissions: JSON.stringify(['view_dashboard', 'view_reservations', 'view_all_logs', 'export_reports']),
    status: 'active'
  });
  assert.equal(customAgent.permissions.includes('view_all_logs'), true);
  assert.equal(customAgent.permissions.includes('export_reports'), true);
  assert.equal(customAgent.permissions.includes('manage_employees'), false);

  const gmUser = mapEmployeeRow({
    id: 'EMP_ADMIN',
    name: 'المدير العام',
    username: 'admin',
    role: 'general_manager',
    permissions: '[]',
    status: 'active'
  });
  const plainAgent = mapEmployeeRow({
    id: 'EMP_AGENT_2',
    name: 'موظف متابعة',
    username: 'agent2',
    role: 'agent',
    permissions: '[]',
    status: 'active'
  });

  const capturedQueries: Array<{ sql: string; params: any[] }> = [];
  const stubExecutor: DbExecutor = {
    async query<T extends Record<string, any> = any>(sql: string, params: any[] = []) {
      capturedQueries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FROM activity_log')) {
        return {
          rows: [{
            id: 'ACT_1',
            user_id: params[0] || 'EMP_ADMIN',
            user_name: 'اختبار',
            user_role: 'general_manager',
            action_type: 'تسجيل دخول',
            entity_type: 'Auth',
            entity_id: 'EMP_ADMIN',
            details: 'ok',
            log_date: '2026-11-17',
            log_time: '12:00:00',
            created_at: new Date('2026-11-17T12:00:00Z')
          }] as any[],
          rowCount: 1
        };
      }
      if (sql.includes('FROM reservations')) {
        return { rows: [] as any[], rowCount: 0 };
      }
      return { rows: [] as any[], rowCount: 0 };
    },
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>) {
      return fn({ query: this.query });
    }
  };

  // General manager sees all logs without user_id restriction
  const gmLogs = await getActivityLogs(stubExecutor, {
    tokenHash: 'T1', employeeId: gmUser.id, username: gmUser.username, role: gmUser.role, expiresAt: '', user: gmUser
  });
  assert.equal(gmLogs.items.length, 1);
  assert.equal(capturedQueries[0].sql.includes('user_id = $1'), false);

  // Plain agent without view_all_logs is scoped strictly to their own user_id
  capturedQueries.length = 0;
  await getActivityLogs(stubExecutor, {
    tokenHash: 'T2', employeeId: plainAgent.id, username: plainAgent.username, role: plainAgent.role, expiresAt: '', user: plainAgent
  });
  assert.equal(capturedQueries[0].sql.includes('user_id = $1'), true);
  assert.equal(capturedQueries[0].params[0], 'EMP_AGENT_2');

  // General manager can load reports via export_reports/view_dashboard without FORBIDDEN
  const gmReport = await getReports(stubExecutor, {
    tokenHash: 'T1', employeeId: gmUser.id, username: gmUser.username, role: gmUser.role, expiresAt: '', user: gmUser
  }, { reportType: 'all_reservations' });
  assert.equal(Array.isArray(gmReport.rows), true);

  // Agent explicitly stripped of export_reports & view_dashboard is denied
  const restrictedAgent = mapEmployeeRow({
    id: 'EMP_NO_REP',
    name: 'مقيد',
    username: 'restricted',
    role: 'agent',
    permissions: JSON.stringify(['view_reservations']),
    status: 'active'
  });
  await assert.rejects(
    () => getReports(stubExecutor, {
      tokenHash: 'T3', employeeId: restrictedAgent.id, username: restrictedAgent.username, role: restrictedAgent.role, expiresAt: '', user: restrictedAgent
    }, { reportType: 'all_reservations' }),
    /FORBIDDEN/
  );
});

test('10. api/crm handler and http helpers always return valid JSON with CORS headers (never empty body)', async () => {
  assert.deepEqual(parseRequestBody('{"action":"login","payload":{"username":"admin"}}'), {
    action: 'login',
    payload: { username: 'admin' }
  });
  assert.deepEqual(parseRequestBody('not-json'), {});
  assert.deepEqual(parseRequestBody(Buffer.from('{"action":"ping"}')), { action: 'ping' });

  const prevDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const prevPgUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  const prevNeonUrl = process.env.NEON_DATABASE_URL;
  delete process.env.NEON_DATABASE_URL;

  try {
    const headers: Record<string, string> = {};
    let statusCode = 0;
    let jsonPayload: any = null;
    const mockReq: any = {
      method: 'POST',
      headers: { origin: 'https://team.github.io' },
      body: { action: 'login' }
    };
    const mockRes: any = {
      headersSent: false,
      setHeader(k: string, v: string) { headers[k] = v; },
      status(code: number) { statusCode = code; return this; },
      json(body: any) { jsonPayload = body; this.headersSent = true; return this; },
      end() { this.headersSent = true; return this; }
    };

    await crmApiHandler(mockReq, mockRes);
    assert.equal(statusCode, 503);
    assert.equal(jsonPayload.success, false);
    assert.equal(jsonPayload.error, 'DATABASE_UNCONFIGURED');
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://team.github.io');

    // Also test applyApiCorsHeaders directly with OPTIONS
    const corsHeaders: Record<string, string> = {};
    applyApiCorsHeaders({ headers: {} }, { setHeader: (k: string, v: string) => { corsHeaders[k] = v; } });
    assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*');
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    if (prevPgUrl !== undefined) process.env.POSTGRES_URL = prevPgUrl;
    if (prevNeonUrl !== undefined) process.env.NEON_DATABASE_URL = prevNeonUrl;
  }
});

test('11. Customer & Reservation RBAC, non-blank name validation, and double-delete protection', async () => {
  const db = createFullRealtimeMockExecutor();
  const token = await loginAdmin(db);

  const cRes = await dispatchCrmRequest(db, {
    action: 'createCustomer',
    token,
    payload: { name: 'عميل التحقق', phone: '0551234567' }
  });
  assert.equal(cRes.success, true);
  const custId = cRes.data.customer.id;

  // Reject blank name on updateCustomer
  const blankUpd = await dispatchCrmRequest(db, {
    action: 'updateCustomer',
    token,
    payload: { customerId: custId, name: '   ' }
  });
  assert.equal(blankUpd.success, false);
  assert.match(String(blankUpd.error || blankUpd.message), /VALIDATION_ERROR|مطلوب/);

  // First delete succeeds; second delete reports NOT_FOUND
  const del1 = await dispatchCrmRequest(db, {
    action: 'deleteCustomer',
    token,
    payload: { customerId: custId }
  });
  assert.equal(del1.success, true);
  const del2 = await dispatchCrmRequest(db, {
    action: 'deleteCustomer',
    token,
    payload: { customerId: custId }
  });
  assert.equal(del2.success, false);
  assert.match(String(del2.error || del2.message), /NOT_FOUND|غير موجود/);

  // Restricted session lacking add_followup / edit_reservation_details / pull_reservations is denied
  const limitedUser = mapEmployeeRow({
    id: 'EMP_LIMITED_TEST',
    name: 'صلاحيات محدودة',
    username: 'limited_test',
    role: 'qa_reports',
    permissions: JSON.stringify(['view_reports']),
    status: 'active'
  });
  const limitedSession = {
    tokenHash: 'LIM_TOK',
    employeeId: limitedUser.id,
    username: limitedUser.username,
    role: limitedUser.role,
    expiresAt: '',
    user: limitedUser
  };

  await assert.rejects(() => getCustomers(db, limitedSession, {}), /FORBIDDEN/);
  await assert.rejects(() => createCustomer(db, limitedSession, { name: 'اختبار' }), /FORBIDDEN/);
  await assert.rejects(() => updateCustomer(db, limitedSession, { customerId: custId, name: 'تعديل' }), /FORBIDDEN/);
  await assert.rejects(() => deleteCustomer(db, limitedSession, { customerId: custId }), /FORBIDDEN/);
  await assert.rejects(() => createReservation(db, limitedSession, { customerName: 'اختبار' }), /FORBIDDEN/);
});

test('12. addFollowUp, createProblem, and updateProblem enqueue outbox v2 ops and emit realtime events in tx', async () => {
  const prevGas = process.env.GAS_WEBAPP_URL;
  delete process.env.GAS_WEBAPP_URL;

  const gmUser = mapEmployeeRow({
    id: 'EMP_ADMIN',
    name: 'المدير العام',
    username: 'admin',
    role: 'general_manager',
    permissions: JSON.stringify([]),
    status: 'active'
  });
  const session = {
    tokenHash: 'GM_TOK',
    employeeId: gmUser.id,
    username: gmUser.username,
    role: gmUser.role,
    expiresAt: '',
    user: gmUser
  };

  const outboxWrites: any[] = [];
  const realtimeWrites: any[] = [];
  const problemsStore = new Map<string, any>();
  const mockResRow = {
    id: 'RES_MOCK_1',
    source_reservation_id: '5511',
    reservation_number: 'RG-MOCK-1',
    customer_name: 'فهد القحطاني',
    customer_phone: '0501112233',
    internal_status: 'تم الحجز',
    assigned_employee_ids: [],
    assigned_employee_names: [],
    status_history: [],
    updated_at: new Date(),
    created_at: new Date()
  };

  const spyExec: DbExecutor = {
    async query<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
      const sql = sqlRaw.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 OR reservation_number = $2 LIMIT 1 FOR UPDATE')) {
        return { rows: [mockResRow] as any[], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
        return { rows: [mockResRow] as any[], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id, name FROM employees WHERE id = ANY')) {
        return { rows: [{ id: 'EMP_ADMIN', name: 'المدير العام' }] as any[], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO problems')) {
        problemsStore.set(params[0], {
          id: params[0],
          problem_number: params[1],
          reservation_id: params[2],
          reservation_number: params[3],
          customer_name: params[4],
          created_by_id: params[5],
          created_by_name: params[6],
          assigned_employee_ids: JSON.parse(params[7]),
          assigned_employee_names: JSON.parse(params[8]),
          description: params[9],
          priority: params[10],
          status: params[11],
          created_at: new Date(params[12]),
          updated_at: new Date(params[12])
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM problems WHERE id = $1 FOR UPDATE')) {
        const p = problemsStore.get(params[0]);
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }
      if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM problems')) {
        return { rows: [{ cnt: '0' }] as any[], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
        outboxWrites.push({ entityType: params[1], operation: params[4], action: params[5] });
        return { rows: [{ id: params[0] }] as any[], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO realtime_events')) {
        realtimeWrites.push({ eventType: params[1], entityType: params[2], recordId: params[3], operation: params[4] });
        return { rows: [{ seq: realtimeWrites.length, created_at: new Date() }] as any[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: this.query });
    }
  };

  try {
    await addFollowUp(spyExec, session, {
      reservationId: 'RES_MOCK_1',
      status: 'تم التمديد',
      action: 'اتصال أولي',
      notes: 'العميل جاهز للاستلام'
    });
    const prb = await createProblem(spyExec, session, {
      reservationId: 'RES_MOCK_1',
      description: 'تأخر في تسليم المركبة',
      priority: 'مرتفع'
    });
    await updateProblem(spyExec, session, {
      problemId: prb.id,
      status: 'مغلقة',
      note: 'تم تسليم المركبة وإغلاق التذكرة'
    });

    assert.ok(outboxWrites.some((o) => o.entityType === 'FollowUp' && o.action === 'appendFollowUp'));
    assert.ok(outboxWrites.some((o) => o.entityType === 'Reservation' && o.action === 'upsertReservation'));
    assert.equal(outboxWrites.filter((o) => o.entityType === 'Problem' && o.action === 'upsertProblem').length, 2);

    assert.deepEqual(
      realtimeWrites.map((e) => e.eventType),
      ['followup:created', 'problem:created', 'problem:updated']
    );
  } finally {
    if (prevGas !== undefined) process.env.GAS_WEBAPP_URL = prevGas;
  }
});

test('13. api/health, api/sync, and api/cron/sync apply CORS headers and return JSON safely on OPTIONS / errors', async () => {
  const prevDbUrl = process.env.DATABASE_URL;
  const prevPgUrl = process.env.POSTGRES_URL;
  const prevNeonUrl = process.env.NEON_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.NEON_DATABASE_URL;

  const makeRes = () => {
    const headers: Record<string, string> = {};
    let statusCode = 0;
    let body: any = null;
    return {
      headers,
      get statusCode() { return statusCode; },
      get body() { return body; },
      setHeader(k: string, v: string) { headers[k] = v; },
      status(c: number) { statusCode = c; return this; },
      json(b: any) { body = b; return this; },
      end() { return this; }
    };
  };

  try {
    // OPTIONS preflight
    for (const h of [healthHandler, syncHandler, cronSyncHandler]) {
      const r = makeRes();
      await h({ method: 'OPTIONS', headers: { origin: 'https://crm.example.com' } }, r);
      assert.equal(r.statusCode, 204);
      assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://crm.example.com');
    }

    // api/health returns valid JSON (200 ok:true or 500 ok:false without crash)
    const healthRes = makeRes();
    await healthHandler({ method: 'GET', headers: {} }, healthRes);
    assert.ok(healthRes.statusCode === 200 || healthRes.statusCode === 500);
    assert.equal(typeof healthRes.body.ok, 'boolean');

    // api/sync returns 503 JSON when unconfigured
    const syncRes = makeRes();
    await syncHandler({ method: 'POST', headers: {}, body: {} }, syncRes);
    assert.equal(syncRes.statusCode, 503);
    assert.equal(syncRes.body.error, 'DATABASE_UNCONFIGURED');
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    if (prevPgUrl !== undefined) process.env.POSTGRES_URL = prevPgUrl;
    if (prevNeonUrl !== undefined) process.env.NEON_DATABASE_URL = prevNeonUrl;
  }
});


