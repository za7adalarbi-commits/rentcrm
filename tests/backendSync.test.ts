import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, hashToken, normalizeLoginUsername, verifySharedSecret } from '../backend/auth';
import { maskDatabaseUrl, persistCoreFilesOnDisk } from '../backend/coreBinding';
import type { DbClient, DbExecutor, QueryResult } from '../backend/db';
import { FIXED_SERVER_CONFIG } from '../backend/fixedConfig';
import { dispatchCrmRequest } from '../backend/router';
import {
  decryptServerSecret,
  encryptServerSecret,
  readPublicHealthAutoBind,
  resolveServerConfig
} from '../backend/serverConfig';
import { applyUnifiedConnectionSetup, getSetupCapabilities } from '../backend/setupService';
import {
  extractRentalGatePagePayload,
  ingestIncrementalSyncBatch,
  pullFromRentalGateDirect
} from '../backend/syncService';

function createInMemoryMockExecutor(): DbExecutor & { state: Record<string, any[]> } {
  const state: Record<string, any[]> = {
    employees: [],
    users: [],
    sessions: [],
    settings: [],
    roles: [],
    permissions: [],
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
    error_logs: []
  };

  function filterMockReservations(sql: string, params: any[], paramLimit?: number): any[] {
    let list = state.reservations.slice();
    const limit = typeof paramLimit === 'number' ? paramLimit : params.length;
    const afterFrom = sql.split(/\bFROM\s+reservations(?:\s+r)?\b/i)[1] || sql;
    const whereSegment = (afterFrom.split(/\bWHERE\b/i)[1] || '').split(/\b(?:ORDER BY|GROUP BY|LIMIT)\b/i)[0] || '';
    const refMatches = Array.from(whereSegment.matchAll(/\$(\d+)/g));
    const idxSet = new Set(refMatches.map((m) => Number(m[1]) - 1).filter((idx) => idx >= 0 && idx < limit));

    if (whereSegment.includes('assigned_employee_ids @>') && idxSet.size > 0) {
      for (const idx of idxSet) {
        const p = params[idx];
        if (typeof p === 'string' && p.startsWith('[')) {
          try {
            const arr = JSON.parse(p);
            if (Array.isArray(arr) && arr.length > 0) {
              if (whereSegment.includes('EXISTS (SELECT 1 FROM follow_ups')) {
                list = list.filter((r) =>
                  arr.every((eid: string) => (r.assigned_employee_ids || []).includes(eid)) ||
                  state.follow_ups.some((f) => f.reservation_id === r.id && arr.includes(f.employee_id))
                );
              } else {
                list = list.filter((r) => arr.every((eid: string) => (r.assigned_employee_ids || []).includes(eid)));
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    const fromMatch = whereSegment.match(/(?:start_date|COALESCE\(.+?\))\s*>=\s*\$(\d+)/);
    if (fromMatch) {
      const df = String(params[Number(fromMatch[1]) - 1] || '');
      if (df) {
        list = list.filter((r) => {
          const eff = r.start_date || (r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at || '').slice(0, 10));
          return eff >= df;
        });
      }
    }

    const toMatch = whereSegment.match(/(?:start_date|COALESCE\(.+?\))\s*<=\s*\$(\d+)/);
    if (toMatch) {
      const dt = String(params[Number(toMatch[1]) - 1] || '');
      if (dt) {
        list = list.filter((r) => {
          const eff = r.start_date || (r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at || '').slice(0, 10));
          return eff <= dt;
        });
      }
    }

    const statusMatch = whereSegment.match(/r\.internal_status\s*=\s*\$(\d+)/);
    if (statusMatch) {
      const st = String(params[Number(statusMatch[1]) - 1] || '');
      list = list.filter((r) => r.internal_status === st);
    }

    const prioMatch = whereSegment.match(/r\.priority\s*=\s*\$(\d+)/);
    if (prioMatch) {
      const pr = String(params[Number(prioMatch[1]) - 1] || '');
      list = list.filter((r) => r.priority === pr);
    }

    const compMatch = whereSegment.match(/r\.company_name\s*=\s*\$(\d+)/);
    if (compMatch) {
      const co = String(params[Number(compMatch[1]) - 1] || '');
      list = list.filter((r) => r.company_name === co);
    }

    const branchMatch = whereSegment.match(/r\.branch_name\s*=\s*\$(\d+)/);
    if (branchMatch) {
      const br = String(params[Number(branchMatch[1]) - 1] || '');
      list = list.filter((r) => r.branch_name === br);
    }

    if (whereSegment.includes('r.has_problem = TRUE')) {
      list = list.filter((r) => Boolean(r.has_problem));
    }
    if (whereSegment.includes('r.has_extensions = TRUE')) {
      list = list.filter((r) => Boolean(r.has_extensions));
    }
    if (whereSegment.includes('NOT EXISTS (SELECT 1 FROM follow_ups')) {
      list = list.filter((r) => !state.follow_ups.some((f) => f.reservation_id === r.id));
    }

    const searchMatch = whereSegment.match(/r\.reservation_number ILIKE \$(\d+)/);
    if (searchMatch) {
      const needle = String(params[Number(searchMatch[1]) - 1] || '').replace(/%/g, '').toLowerCase();
      list = list.filter((r) =>
        String(r.reservation_number || '').toLowerCase().includes(needle) ||
        String(r.customer_name || '').toLowerCase().includes(needle) ||
        String(r.customer_phone || '').toLowerCase().includes(needle) ||
        String(r.car_name || '').toLowerCase().includes(needle) ||
        String(r.plate_number || '').toLowerCase().includes(needle) ||
        String(r.branch_name || '').toLowerCase().includes(needle) ||
        String(r.company_name || '').toLowerCase().includes(needle)
      );
    }

    return list;
  }

  function sortMockReservations(sql: string, list: any[]): any[] {
    const orderMatch = sql.match(/ORDER BY\s+r\.(\w+)\s+(ASC|DESC)/i);
    if (!orderMatch) return list;
    const col = orderMatch[1];
    const dir = orderMatch[2].toUpperCase() === 'ASC' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va instanceof Date || vb instanceof Date) {
        return ((va ? new Date(va).getTime() : 0) - (vb ? new Date(vb).getTime() : 0)) * dir;
      }
      if (typeof va === 'number' || typeof vb === 'number') {
        return (Number(va || 0) - Number(vb || 0)) * dir;
      }
      return String(va || '').localeCompare(String(vb || '')) * dir;
    });
  }

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("to_regclass('public.employees')")) {
      return { rows: [{ reg: 'employees' }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM employees WHERE role')) {
      const excludeId = params[0];
      const cnt = state.employees.filter((e) => e.role === 'general_manager' && e.status === 'active' && e.id !== excludeId).length;
      return { rows: [{ cnt: String(cnt) }] as any[], rowCount: 1 };
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
          created_at: new Date(created_at), updated_at: new Date(created_at)
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
      if (!existing) {
        state.settings.push({ key, value, updated_by, updated_at: new Date() });
      } else if (sql.includes('DO UPDATE')) {
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

    if (sql.startsWith('SELECT * FROM roles')) {
      return { rows: state.roles as any[], rowCount: state.roles.length };
    }

    if (sql.startsWith('SELECT * FROM permissions')) {
      return { rows: state.permissions as any[], rowCount: state.permissions.length };
    }

    if (sql.startsWith('SELECT * FROM employees WHERE id = $1')) {
      const rows = state.employees.filter((e) => e.id === params[0]);
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM employees WHERE LOWER(username)')) {
      const uname = String(params[0] || '').toLowerCase();
      return { rows: state.employees.filter((e) => e.username.toLowerCase() === uname) as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM employees ORDER BY')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql.startsWith('SELECT id, name, job_title, role, last_activity FROM employees')) {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql.startsWith('SELECT id, name FROM employees WHERE id = ANY')) {
      const ids: string[] = params[0] || [];
      const rows = state.employees.filter((e) => ids.includes(e.id));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql === 'SELECT * FROM employees') {
      return { rows: state.employees as any[], rowCount: state.employees.length };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'session_ttl_hours'")) {
      const row = state.settings.find((s) => s.key === 'session_ttl_hours');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'excluded_statuses'")) {
      const row = state.settings.find((s) => s.key === 'excluded_statuses');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = 'gas_webapp_url'")) {
      const row = state.settings.find((s) => s.key === 'gas_webapp_url');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT key, value FROM settings')) {
      const filterKeys = Array.isArray(params[0]) ? params[0] : null;
      const rows = filterKeys
        ? state.settings.filter((s) => filterKeys.includes(s.key))
        : state.settings;
      return { rows: rows as any[], rowCount: rows.length };
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

    if (sql.startsWith('UPDATE sessions SET is_revoked = TRUE')) {
      for (const s of state.sessions) {
        if (s.token_hash === params[0] || s.employee_id === params[0]) s.is_revoked = true;
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE sessions SET last_seen_at') || sql.startsWith('UPDATE employees SET last_activity') || sql.startsWith('UPDATE users SET last_activity')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('DELETE FROM sessions WHERE employee_id')) {
      state.sessions = state.sessions.filter((s) => s.employee_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('DELETE FROM assignments WHERE employee_id')) {
      state.assignments = state.assignments.filter((a) => a.employee_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('DELETE FROM users WHERE id = $1')) {
      state.users = state.users.filter((u) => u.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('DELETE FROM employees WHERE id = $1')) {
      state.employees = state.employees.filter((e) => e.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT id, assigned_employee_ids, assigned_employee_names FROM reservations WHERE assigned_employee_ids @>')) {
      const targetArr = JSON.parse(params[0]);
      const rows = state.reservations.filter((r) => targetArr.every((id: string) => (r.assigned_employee_ids || []).includes(id)));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('UPDATE reservations SET assigned_employee_ids = $2::jsonb')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.assigned_employee_ids = JSON.parse(params[1]);
        r.assigned_employee_names = JSON.parse(params[2]);
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }

    if (sql.startsWith('SELECT id, assigned_employee_ids, assigned_employee_names FROM problems WHERE assigned_employee_ids @>')) {
      const targetArr = JSON.parse(params[0]);
      const rows = state.problems.filter((p) => targetArr.every((id: string) => (p.assigned_employee_ids || []).includes(id)));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('UPDATE problems SET assigned_employee_ids = $2::jsonb')) {
      const p = state.problems.find((x) => x.id === params[0]);
      if (p) {
        p.assigned_employee_ids = JSON.parse(params[1]);
        p.assigned_employee_names = JSON.parse(params[2]);
      }
      return { rows: [], rowCount: p ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({
        id: params[0], user_id: params[1], user_name: params[2], user_role: params[3],
        action_type: params[4], entity_type: params[5], entity_id: params[6], details: params[7],
        log_date: params[8], log_time: params[9], created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM activity_log')) {
      return { rows: state.activity_log.slice(0, 8) as any[], rowCount: state.activity_log.length };
    }

    if (sql.startsWith('SELECT * FROM reservations WHERE reservation_number = ANY')) {
      const nums: string[] = params[0] || [];
      const ids: string[] = params[1] || [];
      const rows = state.reservations.filter(
        (r) => nums.includes(r.reservation_number) || nums.includes(r.source_reservation_id) || ids.includes(r.id)
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT id, reservation_number, source_reservation_id FROM reservations')) {
      const ids: string[] = params[0] || [];
      const refs: string[] = params[1] || [];
      const rows = state.reservations
        .filter((r) => ids.includes(r.id) || refs.includes(r.reservation_number) || refs.includes(r.source_reservation_id))
        .map((r) => ({ id: r.id, reservation_number: r.reservation_number, source_reservation_id: r.source_reservation_id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 OR reservation_number = $1')) {
      const key = params[0];
      const rows = state.reservations.filter((r) => r.id === key || r.reservation_number === key);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
      const rows = state.reservations.filter((r) => r.id === params[0]);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('UPDATE reservations SET reservation_number = $2 WHERE id = $1')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.reservation_number = params[1];
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO reservations (') && sql.includes('unnest(')) {
      const count = Array.isArray(params[0]) ? params[0].length : 0;
      const outRows: Array<{ inserted: boolean }> = [];
      for (let i = 0; i < count; i++) {
        const rec = {
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
          raw_json: params[51][i]
        };
        const idx = state.reservations.findIndex((r) => r.reservation_number === rec.reservation_number);
        if (idx === -1) {
          state.reservations.push(rec);
          outRows.push({ inserted: true });
        } else {
          state.reservations[idx] = { ...rec, id: state.reservations[idx].id, created_at: state.reservations[idx].created_at };
          outRows.push({ inserted: false });
        }
      }
      return { rows: outRows as any[], rowCount: outRows.length };
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
        const targetResId = params[3][i];
        if (targetResId !== null && targetResId !== undefined && !state.reservations.some((r) => r.id === targetResId)) {
          throw new Error('insert or update on table "extensions" violates foreign key constraint "extensions_reservation_id_fkey"');
        }
        const ext = {
          id: params[0][i],
          extension_number: params[1][i],
          sequence_number: params[2][i],
          reservation_id: targetResId,
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

    if (sql.startsWith('INSERT INTO follow_ups')) {
      state.follow_ups.push({
        id: params[0], reservation_id: params[1], reservation_number: params[2], customer_name: params[3],
        employee_id: params[4], employee_name: params[5], status: params[6], action: params[7],
        notes: params[8], follow_up_date: params[9], follow_up_time: params[10], created_at: new Date(params[11])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO follow_up_history') && sql.includes('unnest(')) {
      const count = Array.isArray(params[0]) ? params[0].length : 0;
      for (let i = 0; i < count; i++) {
        state.follow_up_history.push({
          id: params[0][i], follow_up_id: params[1][i], reservation_id: params[2][i], reservation_number: params[3][i],
          employee_id: params[4][i], employee_name: params[5][i], change_type: params[6][i], previous_status: params[7][i],
          new_status: params[8][i], previous_action: params[9][i], new_action: params[10][i], previous_notes: params[11][i],
          new_notes: params[12][i], changed_at: new Date(params[13][i])
        });
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('INSERT INTO follow_up_history')) {
      state.follow_up_history.push({
        id: params[0], follow_up_id: params[1], reservation_id: params[2], reservation_number: params[3],
        employee_id: params[4], employee_name: params[5], change_type: params[6], previous_status: params[7],
        new_status: params[8], previous_action: params[9], new_action: params[10], previous_notes: params[11],
        new_notes: params[12], changed_at: new Date(params[13])
      });
      return { rows: [], rowCount: 1 };
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
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE reservations SET customer_name = $2')) {
      const r = state.reservations.find((x) => x.id === params[0]);
      if (r) {
        r.customer_name = params[1];
        r.customer_phone = params[2];
        r.customer_email = params[3];
        r.customer_id_number = params[4];
        r.company_name = params[5];
        r.branch_name = params[6];
        r.deliver_branch_name = params[7];
        r.car_name = params[8];
        r.car_category = params[9];
        r.plate_number = params[10];
        r.start_date = params[11];
        r.start_time = params[12];
        r.end_date = params[13];
        r.end_time = params[14];
        r.extended_until_date = params[15];
        r.extended_until_time = params[16];
        r.pickup_type_ar = params[17];
        r.return_type_ar = params[18];
        r.payment_method = params[19];
        r.payment_status = params[20];
        r.days_count = params[21];
        r.extended_days_count = params[22];
        r.total_days_count = params[23];
        r.extensions_count = params[24];
        r.base_amount = params[25];
        r.extensions_amount = params[26];
        r.total_amount = params[27];
        r.has_extensions = params[28];
        r.priority = params[29];
        r.internal_status = params[30];
        r.last_update_text = params[31];
        r.last_updated_by_id = params[32];
        r.last_updated_by_name = params[33];
        r.last_updated_at = params[34];
        r.updated_at = new Date(params[34]);
        r.status_history = JSON.parse(params[35]);
      }
      return { rows: [], rowCount: r ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO problems') || sql.startsWith('INSERT INTO issues')) {
      if (sql.startsWith('INSERT INTO problems')) {
        state.problems.push({
          id: params[0], problem_number: params[1], reservation_id: params[2], reservation_number: params[3],
          customer_name: params[4], created_by_id: params[5], created_by_name: params[6],
          assigned_employee_ids: JSON.parse(params[7]), assigned_employee_names: JSON.parse(params[8]),
          description: params[9], priority: params[10], status: params[11],
          created_at: new Date(params[12]), updated_at: new Date(params[12])
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO problem_updates')) {
      state.problem_updates.push({
        id: params[0], problem_id: params[1], reservation_number: params[2],
        employee_id: params[3], employee_name: params[4],
        previous_status: params[5], new_status: params[6], previous_priority: params[7], new_priority: params[8],
        note: params[9], created_at: new Date(params[10])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO notifications')) {
      state.notifications.push({
        id: params[0], recipient_employee_id: params[1], recipient_role: params[2],
        type: params[3], title: params[4], message: params[5], entity_type: params[6], entity_id: params[7],
        is_read: false, created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({
        id: params[0], entity_type: params[1], entity_id: params[2], action: params[3],
        payload: JSON.parse(params[4]), status: 'pending'
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sync_log')) {
      state.sync_log.push({
        id: params[0], triggered_by_id: params[1], triggered_by_name: params[2], status: 'success',
        imported_count: params[3], updated_count: params[4], extensions_count: params[5],
        pages_fetched: params[6], duration_ms: params[7], started_at: new Date(params[8]), finished_at: new Date(params[9])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{ source: params[0], last_status: 'success', last_batch_count: params[3] }];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM reservations')) {
      const list = filterMockReservations(sql, params);
      return { rows: [{ cnt: String(list.length) }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT r.*, EXISTS (SELECT 1 FROM follow_ups')) {
      const list = sortMockReservations(sql, filterMockReservations(sql, params, Math.max(0, params.length - 2)));
      const pageSize = Number(params[params.length - 2] || 25);
      const offset = Number(params[params.length - 1] || 0);
      const paged = list.slice(offset, offset + pageSize);
      return {
        rows: paged.map((r) => ({ ...r, is_followed: state.follow_ups.some((f) => f.reservation_id === r.id) })) as any[],
        rowCount: paged.length
      };
    }

    if (
      sql.startsWith('SELECT * FROM reservations r') ||
      sql === 'SELECT * FROM reservations' ||
      sql.startsWith('SELECT * FROM reservations ORDER BY') ||
      sql.startsWith('SELECT id, source_reservation_id, reservation_number')
    ) {
      if (sql.includes('LOWER(TRIM(reservation_number)) = ANY')) {
        const wanted: string[] = Array.isArray(params[0]) ? params[0] : [];
        const rows = state.reservations.filter((r) => wanted.includes(String(r.reservation_number || '').trim().toLowerCase()));
        return { rows: rows as any[], rowCount: rows.length };
      }
      if (sql.includes('LIKE $1')) {
        const prefix = String(params[0] || '').replace(/%/g, '');
        const rows = state.reservations.filter((r) => {
          const d = String(r.start_date || r.source_created_at || (r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at) || '');
          return !prefix || d.startsWith(prefix) || !/^\d{4}-/.test(d);
        });
        return { rows: rows as any[], rowCount: rows.length };
      }
      const list = sortMockReservations(sql, filterMockReservations(sql, params));
      return { rows: list as any[], rowCount: list.length };
    }

    if (sql.startsWith('SELECT id, start_date, source_created_at, created_at FROM reservations')) {
      const prefix = String(params[0] || '').replace(/%/g, '');
      const rows = state.reservations.filter((r) => {
        const d = String(r.start_date || r.source_created_at || (r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at) || '');
        return !prefix || d.startsWith(prefix) || !/^\d{4}-/.test(d);
      });
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT r.* FROM reservations r')) {
      const list = filterMockReservations(sql, params);
      return { rows: list as any[], rowCount: list.length };
    }

    // Dashboard SQL aggregate queries
    if (sql.startsWith('SELECT COUNT(*)::int AS total_cnt')) {
      const todayStr = String(params[params.length - 1] || '');
      const list = filterMockReservations(sql, params, params.length - 1);
      const todayCnt = list.filter((r) => {
        const createdDay = r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at || '').slice(0, 10);
        return r.start_date === todayStr || createdDay === todayStr;
      }).length;
      return { rows: [{ total_cnt: list.length, today_cnt: todayCnt }] as any[], rowCount: 1 };
    }

    if (sql.startsWith("SELECT COALESCE(NULLIF(internal_status, ''), 'تم الإنشاء') AS internal_status")) {
      const list = filterMockReservations(sql, params);
      const counts = new Map<string, number>();
      for (const r of list) {
        const key = r.internal_status || 'تم الإنشاء';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        rows: Array.from(counts.entries()).map(([internal_status, cnt]) => ({ internal_status, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith("SELECT COALESCE(NULLIF(company_name, ''), 'غير محدد') AS company_name")) {
      const list = filterMockReservations(sql, params);
      const counts = new Map<string, number>();
      for (const r of list) {
        const key = r.company_name || 'غير محدد';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        rows: Array.from(counts.entries()).map(([company_name, cnt]) => ({ company_name, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith('SELECT emp_id, COUNT(*)::int AS cnt FROM reservations r')) {
      const list = sql.includes('WHERE') ? filterMockReservations(sql, params) : state.reservations;
      const counts = new Map<string, number>();
      for (const r of list) {
        for (const eid of r.assigned_employee_ids || []) {
          counts.set(eid, (counts.get(eid) || 0) + 1);
        }
      }
      return {
        rows: Array.from(counts.entries()).map(([emp_id, cnt]) => ({ emp_id, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith('SELECT follow_up_date, employee_name, COUNT(*)::int AS cnt FROM follow_ups')) {
      let list = state.follow_ups;
      const whereSegment = sql.split(/\bWHERE\b/i)[1] || '';
      const fromM = whereSegment.match(/follow_up_date\s*>=\s*\$(\d+)/);
      const toM = whereSegment.match(/follow_up_date\s*<=\s*\$(\d+)/);
      if (fromM) list = list.filter((f) => f.follow_up_date >= params[Number(fromM[1]) - 1]);
      if (toM) list = list.filter((f) => f.follow_up_date <= params[Number(toM[1]) - 1]);
      const counts = new Map<string, { follow_up_date: string; employee_name: string; cnt: number }>();
      for (const f of list) {
        const k = `${f.follow_up_date}::${f.employee_name}`;
        const cur = counts.get(k) || { follow_up_date: f.follow_up_date, employee_name: f.employee_name, cnt: 0 };
        cur.cnt += 1;
        counts.set(k, cur);
      }
      const rows = Array.from(counts.values());
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS today_cnt FROM follow_ups')) {
      const todayCnt = state.follow_ups.filter((f) => f.follow_up_date === params[0]).length;
      return { rows: [{ today_cnt: todayCnt }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT status, priority, COUNT(*)::int AS cnt FROM problems')) {
      const counts = new Map<string, { status: string; priority: string; cnt: number }>();
      for (const p of state.problems) {
        const k = `${p.status}::${p.priority}`;
        const cur = counts.get(k) || { status: p.status, priority: p.priority, cnt: 0 };
        cur.cnt += 1;
        counts.set(k, cur);
      }
      const rows = Array.from(counts.values());
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT employee_id, COUNT(*)::int AS cnt FROM follow_ups')) {
      const counts = new Map<string, number>();
      for (const f of state.follow_ups) {
        counts.set(f.employee_id, (counts.get(f.employee_id) || 0) + 1);
      }
      return {
        rows: Array.from(counts.entries()).map(([employee_id, cnt]) => ({ employee_id, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith('SELECT emp_id, COUNT(*)::int AS cnt FROM problems p')) {
      const onlyOpen = sql.includes("NOT IN ('مغلقة', 'تم الحل')");
      const counts = new Map<string, number>();
      for (const p of state.problems) {
        if (onlyOpen && (p.status === 'مغلقة' || p.status === 'تم الحل')) continue;
        for (const eid of p.assigned_employee_ids || []) {
          counts.set(eid, (counts.get(eid) || 0) + 1);
        }
      }
      return {
        rows: Array.from(counts.entries()).map(([emp_id, cnt]) => ({ emp_id, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith('SELECT * FROM follow_ups WHERE reservation_id = ANY')) {
      const rIds: string[] = params[0] || [];
      const rows = state.follow_ups.filter((f) => rIds.includes(f.reservation_id));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM follow_ups')) {
      let list = state.follow_ups.slice();
      const whereSegment = (sql.split(/\bWHERE\b/i)[1] || '').split(/\bORDER BY\b/i)[0] || '';
      const empM = whereSegment.match(/employee_id\s*=\s*\$(\d+)/);
      const stM = whereSegment.match(/status\s*=\s*\$(\d+)/);
      const eqDateM = whereSegment.match(/follow_up_date\s*=\s*\$(\d+)/);
      const fromM = whereSegment.match(/follow_up_date\s*>=\s*\$(\d+)/);
      const toM = whereSegment.match(/follow_up_date\s*<=\s*\$(\d+)/);
      if (empM) list = list.filter((f) => f.employee_id === params[Number(empM[1]) - 1]);
      if (stM) list = list.filter((f) => f.status === params[Number(stM[1]) - 1]);
      if (eqDateM) list = list.filter((f) => f.follow_up_date === params[Number(eqDateM[1]) - 1]);
      if (fromM) list = list.filter((f) => f.follow_up_date >= params[Number(fromM[1]) - 1]);
      if (toM) list = list.filter((f) => f.follow_up_date <= params[Number(toM[1]) - 1]);
      return { rows: list as any[], rowCount: list.length };
    }

    if (sql.startsWith('SELECT reservation_id, COUNT(*)::int AS cnt FROM problems WHERE reservation_id = ANY')) {
      const rIds: string[] = params[0] || [];
      const counts = new Map<string, number>();
      for (const p of state.problems) {
        if (rIds.includes(p.reservation_id)) {
          counts.set(p.reservation_id, (counts.get(p.reservation_id) || 0) + 1);
        }
      }
      return {
        rows: Array.from(counts.entries()).map(([reservation_id, cnt]) => ({ reservation_id, cnt })) as any[],
        rowCount: counts.size
      };
    }

    if (sql.startsWith('SELECT * FROM problems')) {
      let list = state.problems.slice();
      const whereSegment = (sql.split(/\bWHERE\b/i)[1] || '').split(/\bORDER BY\b/i)[0] || '';
      const stM = whereSegment.match(/status\s*=\s*\$(\d+)/);
      const prM = whereSegment.match(/priority\s*=\s*\$(\d+)/);
      const empM = whereSegment.match(/assigned_employee_ids @> \$(\d+)/);
      if (stM) list = list.filter((p) => p.status === params[Number(stM[1]) - 1]);
      if (prM) list = list.filter((p) => p.priority === params[Number(prM[1]) - 1]);
      if (empM) {
        const arr = JSON.parse(params[Number(empM[1]) - 1]);
        list = list.filter((p) => arr.every((id: string) => (p.assigned_employee_ids || []).includes(id)) || (whereSegment.includes('created_by_id') && p.created_by_id === params[1]));
      }
      return { rows: list as any[], rowCount: list.length };
    }

    if (sql.startsWith('SELECT * FROM problem_updates WHERE problem_id = ANY')) {
      const pIds: string[] = params[0] || [];
      const rows = state.problem_updates.filter((u) => pIds.includes(u.problem_id));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM extensions')) {
      let list = state.extensions.slice();
      const whereSegment = (sql.split(/\bWHERE\b/i)[1] || '').split(/\bORDER BY\b/i)[0] || '';
      const fromM = whereSegment.match(/start_date\s*>=\s*\$(\d+)/);
      const toM = whereSegment.match(/start_date\s*<=\s*\$(\d+)/);
      if (fromM) list = list.filter((e) => e.start_date >= params[Number(fromM[1]) - 1]);
      if (toM) list = list.filter((e) => e.start_date <= params[Number(toM[1]) - 1]);
      return { rows: list as any[], rowCount: list.length };
    }

    if (
      sql.startsWith("SELECT id, name, status FROM employees WHERE status = 'active'") ||
      sql.startsWith("SELECT id, name, username, role, job_title, status FROM employees WHERE status = 'active'")
    ) {
      return { rows: state.employees.filter((e) => e.status === 'active') as any[], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM notifications')) {
      return { rows: state.notifications as any[], rowCount: state.notifications.length };
    }

    if (sql.startsWith('SELECT DISTINCT company_name')) {
      const vals = Array.from(new Set(state.reservations.map((r) => r.company_name).filter(Boolean))).sort();
      return { rows: vals.map((company_name) => ({ company_name })) as any[], rowCount: vals.length };
    }

    if (sql.startsWith('SELECT DISTINCT branch_name')) {
      const vals = Array.from(new Set(state.reservations.map((r) => r.branch_name).filter(Boolean))).sort();
      return { rows: vals.map((branch_name) => ({ branch_name })) as any[], rowCount: vals.length };
    }

    if (sql.startsWith('SELECT * FROM sync_log ORDER BY')) {
      return { rows: state.sync_log as any[], rowCount: state.sync_log.length };
    }

    if (sql.startsWith('SELECT id, password_hash, salt FROM employees WHERE id = $1')) {
      const found = state.employees.find((e) => e.id === params[0]);
      return { rows: found ? [found] : ([] as any[]), rowCount: found ? 1 : 0 };
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS cnt FROM reservations')) {
      return { rows: [{ cnt: state.reservations.length }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE problems SET reservation_id = NULL')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      state.problems.forEach((p) => {
        if (!ids || ids.includes(p.reservation_id)) p.reservation_id = null;
      });
      return { rows: [], rowCount: state.problems.length };
    }

    if (sql.startsWith('DELETE FROM follow_up_history')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      const before = state.follow_up_history.length;
      state.follow_up_history = ids ? state.follow_up_history.filter((x) => !ids.includes(x.reservation_id)) : [];
      return { rows: [], rowCount: before - state.follow_up_history.length };
    }

    if (sql.startsWith('DELETE FROM follow_ups')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      const before = state.follow_ups.length;
      state.follow_ups = ids ? state.follow_ups.filter((x) => !ids.includes(x.reservation_id)) : [];
      return { rows: [], rowCount: before - state.follow_ups.length };
    }

    if (sql.startsWith('DELETE FROM assignments')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      const before = state.assignments.length;
      state.assignments = ids ? state.assignments.filter((x) => !ids.includes(x.reservation_id)) : [];
      return { rows: [], rowCount: before - state.assignments.length };
    }

    if (sql.startsWith('DELETE FROM extensions')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      const before = state.extensions.length;
      state.extensions = ids ? state.extensions.filter((x) => !ids.includes(x.reservation_id)) : [];
      return { rows: [], rowCount: before - state.extensions.length };
    }

    if (sql.startsWith('DELETE FROM reservations')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      const before = state.reservations.length;
      state.reservations = ids ? state.reservations.filter((x) => !ids.includes(x.id)) : [];
      return { rows: [], rowCount: before - state.reservations.length };
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

test('auth hashing matches Google Apps Script formula and verifySharedSecret is timing-safe', () => {
  const expected = crypto.createHash('sha256').update('S_ADMIN::RENTAL_GATE_CRM::Admin@123').digest('hex');
  assert.equal(hashPassword('Admin@123', 'S_ADMIN'), expected);
  assert.equal(hashToken('TOK_1'), crypto.createHash('sha256').update('TOKEN::TOK_1').digest('hex'));
  assert.equal(normalizeLoginUsername('Agent١٢'), 'agent12');

  assert.equal(verifySharedSecret('super-secret-key', 'super-secret-key'), true);
  assert.equal(verifySharedSecret('super-secret-wrong', 'super-secret-key'), false);
  assert.equal(verifySharedSecret('short', 'super-secret-key'), false);
  assert.equal(verifySharedSecret('', ''), false);
});

test('incremental sync maps pickup status to نشط الآن, prevents duplicates, and resolves conflicts cleanly', async () => {
  const db = createInMemoryMockExecutor();

  // 1) First incremental batch: new reservation with CONFIRMED + paid extension
  const firstSync = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        clientMobile: '0501234567',
        companyArName: 'ذيب لتأجير السيارات',
        receiveBranchArName: 'مطار الرياض',
        carNameAr: 'تويوتا كامري 2026',
        startDate: '2026-11-17T10:00:00',
        endDate: '2026-11-20T10:00:00',
        reservationDays: 3,
        reservationStatus: 'CONFIRMED',
        total: 900
      }
    ],
    extensions: [
      {
        extendId: 501,
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        extensionType: 'CLIENT',
        reservationStatus: 'PAID',
        extendDays: 2,
        startDate: '2026-11-20T10:00:00',
        endDate: '2026-11-22T10:00:00',
        total: 400
      }
    ]
  });

  assert.equal(firstSync.status, 'success');
  assert.equal(firstSync.importedCount, 1);
  assert.equal(firstSync.updatedCount, 0);
  assert.equal(firstSync.extensionsCount, 1);
  assert.equal(db.state.reservations.length, 1);
  assert.equal(db.state.reservations[0].internal_status, 'مؤكد');
  assert.equal(db.state.reservations[0].extensions_count, 1);
  assert.equal(db.state.reservations[0].extensions_amount, 400);
  assert.equal(db.state.reservations[0].total_amount, 1300);

  // Simulate staff follow-up updating internal_status without source change
  db.state.reservations[0].internal_status = 'تم التسليم';
  db.state.reservations[0].priority = 'مرتفع';
  db.state.reservations[0].assigned_employee_ids = ['EMP_AG1'];

  // 2) Re-sync same CONFIRMED reservation -> must NOT overwrite staff status/priority/assignments or duplicate row
  const unchangedSync = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        reservationStatus: 'CONFIRMED',
        total: 900
      }
    ]
  });
  assert.equal(unchangedSync.importedCount, 0);
  assert.equal(unchangedSync.updatedCount, 1);
  assert.equal(db.state.reservations.length, 1);
  assert.equal(db.state.reservations[0].internal_status, 'تم التسليم');
  assert.equal(db.state.reservations[0].priority, 'مرتفع');
  assert.deepEqual(db.state.reservations[0].assigned_employee_ids, ['EMP_AG1']);

  // 3) Re-sync when Rental Gate moves car to pickup (ACTIVE / PICKED_UP) -> maps to 'نشط الآن' & appends stage + follow_up_history
  await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 9901,
        reservationNumber: 'RG-2026-9901',
        clientName: 'خالد السبيعي',
        reservationStatus: 'ACTIVE',
        total: 900
      }
    ]
  });
  assert.equal(db.state.reservations[0].original_status_ar, 'نشط الآن');
  assert.equal(db.state.reservations[0].internal_status, 'نشط الآن');
  assert.equal(db.state.reservations[0].status_history.length, 2);
  assert.equal(db.state.reservations[0].status_history[1].newStatus, 'نشط الآن');
  assert.equal(db.state.follow_up_history.length, 1);
  assert.equal(db.state.follow_up_history[0].new_status, 'نشط الآن');
});

test('router handles login, RBAC enforcement, search, quick status update, dashboard ' + 'نشط الآن' + ' count, and Sheets mirror outbox', async () => {
  const db = createInMemoryMockExecutor();

  const ping = await dispatchCrmRequest(db, { action: 'ping' });
  assert.equal(ping.success, true);

  // Admin login
  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: 'Admin@123' }
  });
  assert.equal(adminLogin.success, true);
  const adminToken = adminLogin.data.token;
  assert.ok(adminToken.startsWith('SES_'));

  // Agent login + RBAC denial checks
  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: 'Agent@123' }
  });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;

  const forbiddenEmp = await dispatchCrmRequest(db, {
    action: 'createEmployee',
    token: agentToken,
    payload: { name: 'X', username: 'x', password: 'Password1' }
  });
  assert.equal(forbiddenEmp.success, false);
  assert.ok(String(forbiddenEmp.error).startsWith('FORBIDDEN'));

  const forbiddenSettings = await dispatchCrmRequest(db, {
    action: 'getSettings',
    token: agentToken
  });
  assert.equal(forbiddenSettings.success, false);
  assert.ok(String(forbiddenSettings.error).startsWith('FORBIDDEN'));

  // Sync reservation with PICKED_UP status -> نشط الآن
  await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 7711,
        reservationNumber: 'RG-7711',
        clientName: 'سلمان القحطاني',
        reservationStatus: 'PICKED_UP',
        total: 550
      }
    ]
  });

  // Search reservations via parameterized dispatcher
  const searchRes = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token: adminToken,
    payload: { search: 'RG-7711', page: 1, pageSize: 25 }
  });
  assert.equal(searchRes.success, true);
  assert.equal(searchRes.data.total, 1);
  assert.equal(searchRes.data.items[0].internalStatus, 'نشط الآن');

  // Dashboard tracks نشط الآن inside statusDistribution
  const dashRes = await dispatchCrmRequest(db, {
    action: 'getDashboard',
    token: adminToken
  });
  assert.equal(dashRes.success, true);
  assert.equal(dashRes.data.charts.statusDistribution['نشط الآن'], 1);

  // Quick update status enqueues Sheets backup mirror outbox
  const resId = searchRes.data.items[0].id;
  const updRes = await dispatchCrmRequest(db, {
    action: 'quickUpdateReservationStatus',
    token: agentToken,
    payload: { reservationId: resId, status: 'تم التسليم', note: 'تم التسليم بنجاح' }
  });
  assert.equal(updRes.success, true);
  assert.equal(updRes.data.reservation.internalStatus, 'تم التسليم');
  assert.equal(db.state.sheets_mirror_outbox.length >= 2, true);
});

test('auto-binding persists global GAS URL, encrypted RG_TOKEN, and SYNC_API_SECRET in Neon without extra env vars', async () => {
  const prevDbUrl = process.env.DATABASE_URL;
  const prevRg = process.env.RG_TOKEN;
  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevSecret = process.env.SYNC_API_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/rentcrm_test';
  delete process.env.RG_TOKEN;
  delete process.env.GAS_WEBAPP_URL;
  delete process.env.SYNC_API_SECRET;

  const gasCalls: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    gasCalls.push(body);
    return new Response(JSON.stringify({ success: true, data: { bound: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as any;

  try {
    const db = createInMemoryMockExecutor();
    const login = await dispatchCrmRequest(db, {
      action: 'login',
      payload: { username: 'admin', password: 'Admin@123' }
    });
    assert.equal(login.success, true);
    const adminToken = login.data.token;

    // 1. Encrypt/decrypt roundtrip
    const cipher = encryptServerSecret('rg_live_secret_token_123456');
    assert.ok(cipher.startsWith('enc:v1:'));
    assert.equal(cipher.includes('rg_live_secret_token_123456'), false);
    assert.equal(decryptServerSecret(cipher), 'rg_live_secret_token_123456');

    // 2. Save global GAS /exec URL from Settings -> saves in DB + auto-generates SYNC_API_SECRET + pushes autoBindFromServer
    const saveConn = await dispatchCrmRequest(db, {
      action: 'saveGlobalConnectionSettings',
      token: adminToken,
      payload: {
        gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbTestGlobalBind123/exec',
        siteOrigin: 'https://crm.example.vercel.app'
      }
    });
    assert.equal(saveConn.success, true);
    assert.equal(saveConn.data.autoBoundGas, true);
    assert.equal(saveConn.data.neonSyncUrl, 'https://crm.example.vercel.app/api/sync');
    assert.equal(saveConn.data.hasSyncSecret, true);
    assert.equal(gasCalls.length, 1);
    assert.equal(gasCalls[0].action, 'autoBindFromServer');
    assert.ok(String(gasCalls[0].payload.syncSecret).startsWith('rg_sync_'));

    // 3. Save RG_TOKEN from Settings -> encrypted in DB & cleared from env still resolves via DB
    const saveTok = await dispatchCrmRequest(db, {
      action: 'saveApiToken',
      token: adminToken,
      payload: { token: 'Bearer rg_secret_abc_9876543210', siteOrigin: 'https://crm.example.vercel.app' }
    });
    assert.equal(saveTok.success, true);
    delete process.env.RG_TOKEN;

    const resolved = await resolveServerConfig(db);
    assert.equal(resolved.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycbTestGlobalBind123/exec');
    assert.equal(resolved.rgToken, 'rg_secret_abc_9876543210');
    assert.ok(resolved.syncApiSecret.startsWith('rg_sync_'));

    // 4. getSettings never leaks internal secret keys to the browser
    const settingsRes = await dispatchCrmRequest(db, {
      action: 'getSettings',
      token: adminToken
    });
    assert.equal(settingsRes.success, true);
    assert.equal(settingsRes.data.gas_webapp_url, 'https://script.google.com/macros/s/AKfycbTestGlobalBind123/exec');
    assert.equal(settingsRes.data.hasRgToken, true);
    assert.equal(settingsRes.data.hasDirectToken, true);
    assert.equal(settingsRes.data.hasSyncSecret, true);
    assert.equal(settingsRes.data.rg_token_enc, undefined);
    assert.equal(settingsRes.data.sync_api_secret_enc, undefined);

    // 5. Public health helper exposes only non-secret gasWebAppUrl
    const healthBind = await readPublicHealthAutoBind(db);
    assert.equal(healthBind.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycbTestGlobalBind123/exec');
  } finally {
    globalThis.fetch = prevFetch;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    if (prevRg === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRg;
    if (prevGas === undefined) delete process.env.GAS_WEBAPP_URL;
    else process.env.GAS_WEBAPP_URL = prevGas;
    if (prevSecret === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = prevSecret;
  }
});

test('unified setup writes fixed core files (config.js, fixedConfig.ts, .env) without exposing secrets and enforces GM RBAC', async () => {
  const prevFixed = { ...FIXED_SERVER_CONFIG };
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    GAS_WEBAPP_URL: process.env.GAS_WEBAPP_URL,
    RG_TOKEN: process.env.RG_TOKEN,
    SYNC_API_SECRET: process.env.SYNC_API_SECRET,
    RG_API_BASE_URL: process.env.RG_API_BASE_URL
  };
  const prevFetch = globalThis.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-core-bind-'));

  try {
    // Seed mock target files in tmpDir including dist/ and pre-existing .env var
    fs.mkdirSync(path.join(tmpDir, 'assets/js'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'dist/assets/js'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.env'), 'CUSTOM_KEEP_VAR="keep_me"\nDATABASE_URL=""\n', 'utf8');

    const gasCalls: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      gasCalls.push(body);
      return new Response(JSON.stringify({ success: true, data: { bound: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    const db = createInMemoryMockExecutor();
    const adminLogin = await dispatchCrmRequest(db, {
      action: 'login',
      payload: { username: 'admin', password: 'Admin@123' }
    });
    const agentLogin = await dispatchCrmRequest(db, {
      action: 'login',
      payload: { username: 'agent1', password: 'Agent@123' }
    });
    assert.equal(adminLogin.success, true);
    assert.equal(agentLogin.success, true);

    // 1. Non-manager cannot call applyUnifiedConnectionSetup via router
    const denied = await dispatchCrmRequest(db, {
      action: 'applyUnifiedConnectionSetup',
      token: agentLogin.data.token,
      payload: { mode: 'sandbox' }
    });
    assert.equal(denied.success, false);
    assert.ok(denied.message.includes('FORBIDDEN'));

    // 2. Execute unified setup persisting core files inside tmpDir
    const setupRes = await applyUnifiedConnectionSetup({
      executor: db,
      rootDir: tmpDir,
      skipLiveDbTest: true,
      payload: {
        mode: 'neon',
        databaseUrl: 'postgresql://user:superSecretPass@ep-test-123.aws.neon.tech/neondb?sslmode=require',
        gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbUnifiedFixed123/exec',
        rgToken: 'Bearer rg_live_unified_secret_999999',
        rgApiBaseUrl: 'https://api.rentalgate.net/api',
        persistCoreFiles: true,
        siteOrigin: 'https://crm.example.vercel.app'
      }
    });

    assert.equal(setupRes.saved, true);
    assert.equal(setupRes.mode, 'neon');
    assert.equal(setupRes.coreFilesUpdated, true);
    assert.equal(setupRes.autoBoundGas, true);
    assert.equal(setupRes.updatedFiles.includes('assets/js/config.js'), true);
    assert.equal(setupRes.updatedFiles.includes('dist/assets/js/config.js'), true);
    assert.equal(setupRes.updatedFiles.includes('backend/fixedConfig.ts'), true);
    assert.equal(setupRes.updatedFiles.includes('.env'), true);

    // Verify public config.js contains public URL/mode ONLY and ZERO secrets!
    const configJs = fs.readFileSync(path.join(tmpDir, 'assets/js/config.js'), 'utf8');
    assert.equal(configJs.includes('https://script.google.com/macros/s/AKfycbUnifiedFixed123/exec'), true);
    assert.equal(configJs.includes('/api/crm'), true);
    assert.equal(configJs.includes('"neon"'), true);
    assert.equal(configJs.includes('superSecretPass'), false);
    assert.equal(configJs.includes('rg_live_unified_secret_999999'), false);
    assert.equal(configJs.includes('rg_sync_'), false);

    // Verify backend/fixedConfig.ts contains server config cleanly
    const fixedTs = fs.readFileSync(path.join(tmpDir, 'backend/fixedConfig.ts'), 'utf8');
    assert.equal(fixedTs.includes('superSecretPass'), true);
    assert.equal(fixedTs.includes('rg_live_unified_secret_999999'), true);
    assert.equal(fixedTs.includes('rg_sync_'), true);

    // Verify .env preserves unrelated variables and updates fixed values
    const dotEnv = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    assert.equal(dotEnv.includes('CUSTOM_KEEP_VAR="keep_me"'), true);
    assert.equal(dotEnv.includes('CONNECTION_MODE="neon"'), true);

    // Verify getSetupCapabilities masks DATABASE_URL and hides raw secrets
    const caps = await getSetupCapabilities(db, tmpDir);
    assert.equal(caps.hasDatabaseUrl, true);
    assert.equal(caps.maskedDatabaseUrl, maskDatabaseUrl('postgresql://user:superSecretPass@ep-test-123.aws.neon.tech/neondb?sslmode=require'));
    assert.equal(caps.maskedDatabaseUrl.includes('superSecretPass'), false);
    assert.equal(caps.hasRgToken, true);
    assert.equal(caps.hasSyncSecret, true);
    assert.equal(caps.mode, 'neon');

    // Verify GAS mode core write switches backendApiUrl to ''
    const gasOnlyPersist = persistCoreFilesOnDisk(tmpDir, {
      mode: 'gas',
      databaseUrl: '',
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbGasOnly123/exec',
      rgToken: '',
      rgApiBaseUrl: 'https://api.rentalgate.net/api',
      syncApiSecret: '',
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin'
    }, { updateInMemory: false });
    assert.equal(gasOnlyPersist.writable, true);
    const gasConfigJs = fs.readFileSync(path.join(tmpDir, 'assets/js/config.js'), 'utf8');
    assert.equal(gasConfigJs.includes('mode: "gas"'), true);
    assert.equal(gasConfigJs.includes('backendApiUrl: ""'), true);
  } finally {
    globalThis.fetch = prevFetch;
    Object.assign(FIXED_SERVER_CONFIG, prevFixed);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('bootstrap login, month range, dynamic sorting, full detail edits, employee stats, filtered reports, and batch deduplication', async () => {
  const db = createInMemoryMockExecutor();
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  const lastYearDate = '2024-01-15';

  // 1. Batch deduplication inside single ingestIncrementalSyncBatch call
  const dupSync = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    reservations: [
      {
        reservationId: 1001,
        reservationNumber: 'RG-B-1001',
        clientName: 'عميل أول',
        companyArName: 'شركة الأولى',
        receiveBranchArName: 'فرع الرياض',
        startDate: `${monthStartStr}T09:00:00`,
        endDate: `${todayStr}T12:00:00`,
        reservationDays: 2,
        reservationStatus: 'CONFIRMED',
        total: 500
      },
      {
        reservationId: 1001,
        reservationNumber: 'RG-B-1001',
        clientName: 'عميل أول محدث',
        companyArName: 'شركة الأولى',
        receiveBranchArName: 'فرع الرياض',
        startDate: `${monthStartStr}T09:00:00`,
        endDate: `${todayStr}T12:00:00`,
        reservationDays: 2,
        reservationStatus: 'ACTIVE',
        total: 750
      },
      {
        reservationId: 1002,
        reservationNumber: 'RG-A-1002',
        clientName: 'عميل أقدم',
        companyArName: 'شركة الثانية',
        receiveBranchArName: 'فرع جدة',
        startDate: `${lastYearDate}T10:00:00`,
        endDate: `${lastYearDate}T18:00:00`,
        reservationDays: 1,
        reservationStatus: 'CONFIRMED',
        total: 1200
      }
    ],
    extensions: [
      {
        extendId: 801,
        reservationId: 1001,
        reservationNumber: 'RG-B-1001',
        reservationStatus: 'PAID',
        extendDays: 1,
        startDate: `${todayStr}T12:00:00`,
        endDate: `${todayStr}T18:00:00`,
        total: 150
      },
      {
        extendId: 801,
        reservationId: 1001,
        reservationNumber: 'RG-B-1001',
        reservationStatus: 'PAID',
        extendDays: 1,
        startDate: `${todayStr}T12:00:00`,
        endDate: `${todayStr}T18:00:00`,
        total: 150
      }
    ]
  });

  assert.equal(dupSync.importedCount, 2);
  assert.equal(dupSync.updatedCount, 0);
  assert.equal(dupSync.extensionsCount, 1);
  assert.equal(db.state.reservations.length, 2);
  const resB = db.state.reservations.find((r) => r.reservation_number === 'RG-B-1001');
  assert.equal(resB.customer_name, 'عميل أول محدث');
  assert.equal(resB.internal_status, 'نشط الآن');

  // 2. Single-round-trip login with includeBootstrap: true
  const loginBoot = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: 'Admin@123', includeBootstrap: true, range: 'month' }
  });
  assert.equal(loginBoot.success, true);
  assert.ok(loginBoot.data.bootstrap);
  assert.equal(loginBoot.data.bootstrap.user.username, 'admin');
  assert.ok(Array.isArray(loginBoot.data.bootstrap.employees?.items));
  // Month range should include current-month RG-B-1001 (1) and exclude last year RG-A-1002
  assert.equal(loginBoot.data.bootstrap.dashboard.kpis.totalReservations, 1);

  const token = loginBoot.data.token;

  // 3. Dynamic sorting on getReservations (reservationNumber asc, totalAmount desc)
  const sortNumAsc = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token,
    payload: { sortBy: 'reservationNumber', sortDir: 'asc', page: 1, pageSize: 10 }
  });
  assert.equal(sortNumAsc.success, true);
  assert.equal(sortNumAsc.data.items.map((x: any) => x.reservationNumber).join(','), 'RG-A-1002,RG-B-1001');

  const sortTotalDesc = await dispatchCrmRequest(db, {
    action: 'getReservations',
    token,
    payload: { sortBy: 'totalAmount', sortDir: 'desc', page: 1, pageSize: 10 }
  });
  assert.equal(sortTotalDesc.data.items[0].reservationNumber, 'RG-A-1002');

  // 4. updateReservationDetails persists full detail modal fields
  const edited = await dispatchCrmRequest(db, {
    action: 'updateReservationDetails',
    token,
    payload: {
      reservationId: resB.id,
      customerEmail: 'updated@client.sa',
      customerIdNumber: '1020304050',
      deliverBranchName: 'مطار جدة',
      carCategory: 'SUV',
      plateNumber: 'ABC 1234',
      extensionsCount: 2,
      extensionsAmount: 300,
      baseAmount: 750,
      totalAmount: 1050,
      paymentMethod: 'MADA',
      paymentStatus: 'PAID'
    }
  });
  assert.equal(edited.success, true);
  assert.equal(edited.data.customerEmail, 'updated@client.sa');
  assert.equal(edited.data.plateNumber, 'ABC 1234');
  assert.equal(edited.data.deliverBranchName, 'مطار جدة');
  assert.equal(edited.data.totalAmount, 1050);

  // 5. Add follow-up & problem, then verify getEmployees and getEmployeeDetails stats
  const fuRes = await dispatchCrmRequest(db, {
    action: 'addFollowUp',
    token,
    payload: {
      reservationId: resB.id,
      status: 'تم التسليم',
      action: 'تأكيد استلام السيارة',
      notes: 'تم التواصل مع العميل'
    }
  });
  assert.equal(fuRes.success, true);

  const prbRes = await dispatchCrmRequest(db, {
    action: 'createProblem',
    token,
    payload: {
      reservationId: resB.id,
      description: 'تأخير في مطابقة الفاتورة',
      priority: 'مرتفع',
      assignedEmployeeIds: ['EMP_ADMIN']
    }
  });
  assert.equal(prbRes.success, true);

  const empsRes = await dispatchCrmRequest(db, { action: 'getEmployees', token });
  assert.equal(empsRes.success, true);
  const adminEmp = empsRes.data.items.find((e: any) => e.id === 'EMP_ADMIN');
  assert.equal(adminEmp.followUpsCount, 1);
  assert.equal(adminEmp.stats.followUpsCount, 1);
  assert.equal(adminEmp.problemsCount, 1);

  const empDetailRes = await dispatchCrmRequest(db, {
    action: 'getEmployeeDetails',
    token,
    payload: { employeeId: 'EMP_ADMIN' }
  });
  assert.equal(empDetailRes.success, true);
  assert.equal(empDetailRes.data.stats.reservationsCount, 1);
  assert.equal(empDetailRes.data.stats.followUpsCount, 1);
  assert.equal(empDetailRes.data.assignedReservations[0].followUpsCount, 1);
  assert.equal(empDetailRes.data.assignedReservations[0].problemsCount, 1);

  // 6. getReports honors filters on followups_log & problems & employee_performance
  const repFu = await dispatchCrmRequest(db, {
    action: 'getReports',
    token,
    payload: { reportType: 'followups_log', employeeId: 'EMP_SUP1' }
  });
  assert.equal(repFu.success, true, JSON.stringify(repFu));
  assert.equal(repFu.data.rows.length, 0);

  const repEmp = await dispatchCrmRequest(db, {
    action: 'getReports',
    token,
    payload: { reportType: 'employee_performance' }
  });
  assert.equal(repEmp.success, true);
  const perfAdmin = repEmp.data.rows.find((r: any) => r.employeeId === 'EMP_ADMIN');
  assert.equal(perfAdmin.followUpsCount, 1);
  assert.equal(perfAdmin.problemsCount, 1);
});

test('API handlers (/api/crm and /api/health) always return valid JSON and support Buffer bodies', async () => {
  const { default: crmHandler } = await import('../api/crm');
  const { default: healthHandler } = await import('../api/health');

  const prevDb = process.env.DATABASE_URL;
  const prevPg = process.env.POSTGRES_URL;
  const prevNeon = process.env.NEON_DATABASE_URL;
  const prevFixedDb = FIXED_SERVER_CONFIG.databaseUrl;

  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.NEON_DATABASE_URL;
  FIXED_SERVER_CONFIG.databaseUrl = '';

  const makeMockRes = () => {
    const out: { statusCode: number; body: any; ended: boolean } = { statusCode: 200, body: undefined, ended: false };
    const res: any = {
      headersSent: false,
      status(code: number) {
        out.statusCode = code;
        return res;
      },
      json(payload: any) {
        out.body = payload;
        res.headersSent = true;
        return res;
      },
      end() {
        out.ended = true;
        res.headersSent = true;
        return res;
      }
    };
    return { res, out };
  };

  try {
    // 1. /api/health without DB returns valid JSON
    const hMock = makeMockRes();
    await healthHandler({ method: 'GET', headers: {} }, hMock.res);
    assert.equal(hMock.out.statusCode, 200);
    assert.equal(hMock.out.body.ok, true);
    assert.equal(hMock.out.body.databaseConfigured, false);

    // 2. /api/crm with Buffer body and unconfigured DB returns structured 503 JSON (never empty)
    const crmMock503 = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: Buffer.from(JSON.stringify({ action: 'login', payload: {} }), 'utf8')
    }, crmMock503.res);
    assert.equal(crmMock503.out.statusCode, 503);
    assert.equal(crmMock503.out.body.success, false);
    assert.equal(crmMock503.out.body.error, 'DATABASE_UNCONFIGURED');

    // 3. /api/crm getSetupCapabilities works cleanly without DB
    const crmCaps = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: { action: 'getSetupCapabilities', payload: {} }
    }, crmCaps.res);
    assert.equal(crmCaps.out.statusCode, 200);
    assert.equal(crmCaps.out.body.success, true);
    assert.equal(crmCaps.out.body.data.databaseConfigured, false);

    // 4. /api/sync without DB returns structured 503 JSON
    const { default: syncHandler } = await import('../api/sync');
    const syncMock503 = makeMockRes();
    await syncHandler({ method: 'POST', headers: {}, body: {} }, syncMock503.res);
    assert.equal(syncMock503.out.statusCode, 503);
    assert.equal(syncMock503.out.body.success, false);
    assert.equal(syncMock503.out.body.error, 'DATABASE_UNCONFIGURED');
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    if (prevPg !== undefined) process.env.POSTGRES_URL = prevPg;
    if (prevNeon !== undefined) process.env.NEON_DATABASE_URL = prevNeon;
    FIXED_SERVER_CONFIG.databaseUrl = prevFixedDb;
  }
});

test('embedded SCHEMA_SQL and coreBridge.cjs stay synced with source files and load helpers cleanly', async () => {
  const { SCHEMA_SQL } = await import('../backend/schemaSql');
  const diskSql = fs.readFileSync(path.resolve(process.cwd(), 'database/schema.sql'), 'utf8');
  assert.equal(SCHEMA_SQL.trim(), diskSql.trim());

  const diskCoreJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const bridgeCjs = fs.readFileSync(path.resolve(process.cwd(), 'backend/coreBridge.cjs'), 'utf8');
  assert.equal(bridgeCjs.trim(), diskCoreJs.trim());

  const { crmCore } = await import('../backend/auth');
  assert.equal(typeof crmCore.resolvePullDateRange, 'function');
  assert.equal(typeof crmCore.mergeSyncedReservation, 'function');
  assert.equal(typeof crmCore.parseBackendResponseText, 'function');

  const range7d = crmCore.resolvePullDateRange({ datePreset: '7d' }, '2026-11-18');
  assert.equal(range7d.preset, '7d');
  assert.equal(range7d.dateFrom, '2026-11-12');
  assert.equal(range7d.dateTo, '2026-11-18');
  assert.equal(range7d.hasCustomRange, true);

  // mutatedReservations only includes genuinely changed records on subsequent sync
  const db = createInMemoryMockExecutor();
  const resPayload = {
    reservationId: 4040,
    reservationNumber: 'RG-4040',
    clientName: 'ماجد الحربي',
    reservationStatus: 'CONFIRMED',
    total: 500
  };
  const first = await ingestIncrementalSyncBatch(db, {
    source: 'rental_gate_direct',
    reservations: [resPayload]
  });
  assert.equal(first.mutatedReservations?.length, 1);

  const second = await ingestIncrementalSyncBatch(db, {
    source: 'rental_gate_direct',
    reservations: [resPayload]
  });
  assert.equal(second.mutatedReservations?.length, 0);
});

test('/api/crm Sandbox/GAS -> Neon switch verifies GM password cleanly on Vercel and reports needsVercelEnvVar', async () => {
  const { default: crmHandler } = await import('../api/crm.js');
  const prevDb = process.env.DATABASE_URL;
  const prevPg = process.env.POSTGRES_URL;
  const prevNeon = process.env.NEON_DATABASE_URL;
  const prevVercel = process.env.VERCEL;
  const prevFixedDb = FIXED_SERVER_CONFIG.databaseUrl;

  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.NEON_DATABASE_URL;
  FIXED_SERVER_CONFIG.databaseUrl = '';
  process.env.VERCEL = '1';

  const makeMockRes = () => {
    const out: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
    const res: any = {
      headersSent: false,
      status(code: number) { out.statusCode = code; return res; },
      json(payload: any) { out.body = payload; res.headersSent = true; return res; },
      end() { res.headersSent = true; return res; }
    };
    return { res, out };
  };

  try {
    // 1. Missing adminPassword -> structured ADMIN_VERIFY_REQUIRED (never 500)
    const missingPwdMock = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: {
        action: 'applyUnifiedConnectionSetup',
        token: 'SB_TOK_SANDBOX',
        payload: { mode: 'neon', actorRole: 'general_manager' }
      }
    }, missingPwdMock.res);
    assert.equal(missingPwdMock.out.statusCode, 403);
    assert.equal(missingPwdMock.out.body.success, false);
    assert.equal(missingPwdMock.out.body.error, 'ADMIN_VERIFY_REQUIRED');

    // 2. Wrong adminPassword without new DB url -> structured FORBIDDEN
    const wrongPwdMock = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: {
        action: 'applyUnifiedConnectionSetup',
        token: 'SB_TOK_SANDBOX',
        payload: { mode: 'gas', gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbTest1234567890/exec', adminPassword: 'wrong', actorRole: 'general_manager' }
      }
    }, wrongPwdMock.res);
    assert.equal(wrongPwdMock.out.statusCode, 403);
    assert.equal(wrongPwdMock.out.body.success, false);
    assert.equal(wrongPwdMock.out.body.error, 'FORBIDDEN');

    // 3. needsVercelEnvVar flag accuracy
    const db = createInMemoryMockExecutor();
    const setupWithoutEnv = await applyUnifiedConnectionSetup({
      executor: db,
      skipLiveDbTest: true,
      wasDatabaseConfiguredBeforeRequest: false,
      payload: {
        mode: 'neon',
        databaseUrl: 'postgresql://user:pass@ep-demo.aws.neon.tech/neondb?sslmode=require',
        persistCoreFiles: false
      }
    });
    assert.equal(setupWithoutEnv.saved, true);
    assert.equal(setupWithoutEnv.needsVercelEnvVar, true);

    const setupWithEnv = await applyUnifiedConnectionSetup({
      executor: db,
      skipLiveDbTest: true,
      wasDatabaseConfiguredBeforeRequest: true,
      payload: {
        mode: 'neon',
        databaseUrl: 'postgresql://user:pass@ep-demo.aws.neon.tech/neondb?sslmode=require',
        persistCoreFiles: false
      }
    });
    assert.equal(setupWithEnv.saved, true);
    assert.equal(setupWithEnv.needsVercelEnvVar, false);
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    else delete process.env.DATABASE_URL;
    if (prevPg !== undefined) process.env.POSTGRES_URL = prevPg;
    else delete process.env.POSTGRES_URL;
    if (prevNeon !== undefined) process.env.NEON_DATABASE_URL = prevNeon;
    else delete process.env.NEON_DATABASE_URL;
    if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
    else delete process.env.VERCEL;
    FIXED_SERVER_CONFIG.databaseUrl = prevFixedDb;
  }
});

test('pullFromRentalGateDirect ingests reservationId-only DTOs inside nested payloads and tolerates optional extension endpoint errors', async () => {
  const prevRg = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_live_test_token_1234567890';
  const db = createInMemoryMockExecutor();

  try {
    // Verify extractRentalGatePagePayload across nested wrapper shapes
    const nested = extractRentalGatePagePayload({
      data: {
        content: [{ reservationId: 501 }, { reservationId: 502 }],
        totalPages: 2,
        totalElements: 4,
        last: false
      }
    }, 0, 100);
    assert.equal(nested.rows.length, 2);
    assert.equal(nested.totalPages, 2);
    assert.equal(nested.isLast, false);

    // Mock multi-page nested Rental Gate responses with reservationId-only items (no id or reservationNumber)
    const mockFetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('reservations/filter')) {
        if (u.includes('page=0')) {
          return new Response(JSON.stringify({
            data: {
              content: [
                {
                  reservationId: 6001,
                  clientName: 'عبدالله الغامدي',
                  clientMobile: '0501122334',
                  reservationStatus: 'CONFIRMED',
                  total: 800
                },
                {
                  reservationId: 6002,
                  clientName: 'خالد الشهري',
                  clientMobile: '0509988776',
                  reservationStatus: 'CANCELLED',
                  total: 300
                }
              ],
              totalPages: 2,
              last: false
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          data: {
            content: [
              {
                reservationId: 6003,
                clientName: 'فيصل العتيبي',
                clientMobile: '0554433221',
                reservationStatus: 'STARTED',
                total: 1200
              }
            ],
            totalPages: 2,
            last: true
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('reservation-extends/filter')) {
        return new Response(JSON.stringify({
          data: {
            data: [
              {
                extendId: 7001,
                reservationId: 6001,
                reservationStatus: 'PAID',
                extendDays: 1,
                total: 250
              }
            ],
            last_page: 1
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    // Seed excluded_statuses setting like production DB
    db.state.settings.push({ key: 'excluded_statuses', value: JSON.stringify(['cancelled', 'canceled']) });

    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'المدير العام', role: 'general_manager' },
      {},
      mockFetch
    );
    assert.equal(pullRes.importedCount, 2);
    assert.equal(pullRes.extensionsCount, 1);
    assert.equal(pullRes.fetchedCount, 3);
    assert.equal(pullRes.excludedFilteredCount, 1);
    assert.equal(db.state.reservations.length, 2);
    const res6001 = db.state.reservations.find((r) => r.reservation_number === '6001');
    assert.ok(res6001);
    assert.equal(res6001.total_amount, 1050);

    // Optional extensions endpoint 404 does not abort reservations pull
    const mockNoExtFetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('reservations/filter')) {
        return new Response(JSON.stringify([
          { reservationId: 6004, clientName: 'راشد الدوسري', reservationStatus: 'CONFIRMED', total: 500 }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const pullNoExt = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'المدير العام', role: 'general_manager' },
      {},
      mockNoExtFetch
    );
    assert.equal(pullNoExt.importedCount, 1);
  } finally {
    if (prevRg === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRg;
  }
});

test('deleteEmployee deletes target employee, revokes sessions, scrubs assignments, and protects self & last general manager', async () => {
  const db = createInMemoryMockExecutor();
  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: 'Admin@123' }
  });
  const adminToken = adminLogin.data.token;
  const adminId = adminLogin.data.user.id;

  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: 'Agent@123' }
  });
  const agentToken = agentLogin.data.token;

  // Create a temporary employee, log them in, and assign them to a reservation
  const created = await dispatchCrmRequest(db, {
    action: 'createEmployee',
    token: adminToken,
    payload: {
      name: 'موظف مؤقت',
      username: 'temp_agent_del',
      password: 'TempPass123',
      role: 'agent',
      jobTitle: 'ممثل خدمة'
    }
  });
  assert.equal(created.success, true);
  const targetId = created.data.id;

  db.state.reservations.push({
    id: 'RES_DEL_CHECK',
    reservation_number: 'RG-DEL-1',
    assigned_employee_ids: [targetId, adminId],
    assigned_employee_names: ['موظف مؤقت', 'المدير العام']
  });

  // 1) Agent cannot delete employees
  const agentDenied = await dispatchCrmRequest(db, {
    action: 'deleteEmployee',
    token: agentToken,
    payload: { employeeId: targetId }
  });
  assert.equal(agentDenied.success, false);
  assert.ok(String(agentDenied.error).startsWith('FORBIDDEN'));

  // 2) Manager cannot delete self
  const selfDenied = await dispatchCrmRequest(db, {
    action: 'deleteEmployee',
    token: adminToken,
    payload: { employeeId: adminId }
  });
  assert.equal(selfDenied.success, false);
  assert.ok(String(selfDenied.error).startsWith('FORBIDDEN'));

  // 3) Manager deletes target employee cleanly
  const delRes = await dispatchCrmRequest(db, {
    action: 'deleteEmployee',
    token: adminToken,
    payload: { employeeId: targetId }
  });
  assert.equal(delRes.success, true);
  assert.equal(delRes.data.deleted, true);
  assert.equal(db.state.employees.some((e) => e.id === targetId), false);
  assert.equal(db.state.users.some((u) => u.id === targetId), false);
  assert.deepEqual(db.state.reservations[0].assigned_employee_ids, [adminId]);
  assert.deepEqual(db.state.reservations[0].assigned_employee_names, ['المدير العام']);
  assert.equal(db.state.sheets_mirror_outbox.some((m) => m.action === 'deleteEmployee' && m.entity_id === targetId), true);
});

test('ingestIncrementalSyncBatch prevents extensions_reservation_id_fkey violations on mismatched/missing reservations and auto-links late parents', async () => {
  const db = createInMemoryMockExecutor();

  // Pre-seed Neon reservation with a different id than Google Sheets generated
  db.state.reservations.push({
    id: 'RES_NEON_7001',
    source_reservation_id: '7001',
    reservation_number: 'RG-7001',
    customer_name: 'أحمد العلي',
    internal_status: 'مؤكد',
    original_status_code: 'confirmed',
    assigned_employee_ids: [],
    assigned_employee_names: [],
    status_history: [],
    created_at: new Date(),
    updated_at: new Date()
  });

  // Batch 1: incoming extension carries an unmatched Sheets ID ("RES_SHEETS_STALE") and another extension references a reservation not in Neon yet
  const batch1 = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    actor: { id: 'SYSTEM_1M', name: 'المزامنة السحابية الدقيقة (Neon)', role: 'system' },
    pagesFetched: 7,
    reservations: [
      {
        id: 'RES_SHEETS_9001',
        sourceReservationId: '9001',
        reservationNumber: 'RG-9001',
        customerName: 'سعد الشهري',
        originalStatusCode: 'started',
        total: 500
      }
    ],
    extensions: [
      {
        extensionNumber: 'EXT_REMAP_1',
        reservationId: 'RES_SHEETS_STALE',
        reservationNumber: 'RG-7001',
        sourceReservationId: '7001',
        statusCode: 'paid',
        paymentStatus: 'paid',
        amount: 200
      },
      {
        extensionNumber: 'EXT_ORPHAN_88',
        reservationId: 'RES_MISSING_888',
        reservationNumber: 'RG-8888',
        sourceReservationId: '8888',
        statusCode: 'paid',
        paymentStatus: 'paid',
        amount: 350
      }
    ]
  });

  assert.equal(batch1.status, 'success');
  assert.equal(batch1.importedCount, 1);
  assert.equal(batch1.extensionsCount, 2);

  const remappedExt = db.state.extensions.find((e) => e.extension_number === 'EXT_REMAP_1');
  assert.ok(remappedExt);
  assert.equal(remappedExt.reservation_id, 'RES_NEON_7001');

  const orphanExt = db.state.extensions.find((e) => e.extension_number === 'EXT_ORPHAN_88');
  assert.ok(orphanExt);
  assert.equal(orphanExt.reservation_id, null);

  // Batch 2: parent reservation RG-8888 arrives later -> orphan extension automatically links to it
  const batch2 = await ingestIncrementalSyncBatch(db, {
    source: 'google_apps_script',
    actor: { id: 'SYSTEM_1M', name: 'المزامنة السحابية الدقيقة (Neon)', role: 'system' },
    reservations: [
      {
        sourceReservationId: '8888',
        reservationNumber: 'RG-8888',
        customerName: 'ماجد السالم',
        originalStatusCode: 'confirmed',
        total: 900
      }
    ],
    extensions: []
  });

  assert.equal(batch2.status, 'success');
  const linkedParent = db.state.reservations.find((r) => r.reservation_number === 'RG-8888');
  assert.ok(linkedParent);
  assert.equal(orphanExt.reservation_id, linkedParent.id);
});

test('pullFromRentalGateDirect fetches multi-page results when totalPages is omitted and upgrades numeric IDs without duplicate rows', async () => {
  const prevRg = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_live_test_token_paginated_12345';
  const db = createInMemoryMockExecutor();

  try {
    // Pre-seed a reservation that previously stored bare numeric ID "91" and stale wrong status "جاهز للاستلام" on a HOLD status
    db.state.reservations.push({
      id: 'RES_91',
      source_reservation_id: '91',
      reservation_number: '91',
      customer_name: 'أسامة يحيى',
      original_status_code: 'hold',
      original_status_ar: 'جاهز للاستلام',
      internal_status: 'جاهز للاستلام',
      last_update_text: 'تم السحب من Rental Gate بالحالة: جاهز للاستلام',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      status_history: [{ stageNumber: 1, source: 'api_pull', newStatus: 'جاهز للاستلام', changedAt: '2026-11-18T00:00:00Z' }],
      created_at: new Date(),
      updated_at: new Date()
    });

    // Omitted totalPages but explicit last: false on page 0 -> should continue to page 1
    const payload0 = extractRentalGatePagePayload({
      data: {
        content: [{ reservationId: 91 }],
        last: false
      }
    }, 0, 1);
    assert.equal(payload0.isLast, false);
    assert.equal(payload0.totalPages, null);

    const mockFetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('reservations/filter')) {
        if (u.includes('page=0')) {
          return new Response(JSON.stringify({
            data: {
              content: [
                {
                  reservationId: 91,
                  reservationCode: 'RG-2026-0091',
                  clientName: 'أسامة يحيى حكمي',
                  clientMobile: '+966537544719',
                  reservationStatus: 'HOLD',
                  total: 3212.99
                }
              ],
              last: false
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (u.includes('page=1')) {
          return new Response(JSON.stringify({
            data: {
              content: [
                {
                  reservationId: 92,
                  code: 'RG-2026-0092',
                  clientName: 'ماجد السالم',
                  clientMobile: '+966500112233',
                  reservationStatus: 'ACTIVE',
                  total: 800
                }
              ],
              last: true
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify({ data: { content: [], last: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'المدير العام', role: 'general_manager' },
      {},
      mockFetch
    );

    assert.equal(pullRes.fetchedCount, 2);
    assert.equal(pullRes.importedCount, 1);
    assert.equal(pullRes.updatedCount, 1);
    assert.equal(db.state.reservations.length, 2);

    const upgraded91 = db.state.reservations.find((r) => r.source_reservation_id === '91');
    assert.ok(upgraded91);
    assert.equal(upgraded91.reservation_number, 'RG-2026-0091');
    assert.equal(upgraded91.original_status_ar, 'معلق');
    assert.equal(upgraded91.internal_status, 'معلق');

    const new92 = db.state.reservations.find((r) => r.source_reservation_id === '92');
    assert.ok(new92);
    assert.equal(new92.reservation_number, 'RG-2026-0092');
    assert.equal(new92.original_status_ar, 'نشط الآن');
  } finally {
    if (prevRg === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRg;
  }
});

test('backend updateSettings supports minutes interval and deleteAllReservations enforces security confirmation and clears reservations', async () => {
  const db = createInMemoryMockExecutor();
  const loginRes = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: process.env.INITIAL_ADMIN_PASS || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const adminToken = loginRes.data.token;

  // Save 0 hours and 15 minutes
  const updRes = await dispatchCrmRequest(db, {
    action: 'updateSettings',
    token: adminToken,
    payload: {
      auto_sync_enabled: true,
      auto_sync_interval_hours: 0,
      auto_sync_interval_minutes: 15
    }
  });
  assert.equal(updRes.success, true);
  assert.equal(updRes.data.auto_sync_interval_hours, 0);
  assert.equal(updRes.data.auto_sync_interval_minutes, 15);

  const syncStatusRes = await dispatchCrmRequest(db, {
    action: 'getSyncStatus',
    token: adminToken,
    payload: {}
  });
  assert.equal(syncStatusRes.success, true);
  assert.equal(syncStatusRes.data.autoSyncIntervalHours, 0);
  assert.equal(syncStatusRes.data.autoSyncIntervalMinutes, 15);

  // Seed reservation + related records
  db.state.reservations.push({
    id: 'RES_DEL_1',
    reservation_number: 'RG-DEL-1',
    customer_name: 'عميل اختبار',
    internal_status: 'تم الحجز',
    priority: 'عادي'
  });
  db.state.extensions.push({ id: 'EXT_DEL_1', reservation_id: 'RES_DEL_1' });
  db.state.follow_ups.push({ id: 'FU_DEL_1', reservation_id: 'RES_DEL_1' });
  db.state.assignments.push({ id: 'ASG_DEL_1', reservation_id: 'RES_DEL_1' });

  // Wrong phrase rejected
  const badPhrase = await dispatchCrmRequest(db, {
    action: 'deleteAllReservations',
    token: adminToken,
    payload: { acknowledged: true, confirmPhrase: 'حذف', password: process.env.INITIAL_ADMIN_PASS || 'Admin@123' }
  });
  assert.equal(badPhrase.success, false);
  assert.equal(db.state.reservations.length, 1);

  // Wrong password rejected
  const badPass = await dispatchCrmRequest(db, {
    action: 'deleteAllReservations',
    token: adminToken,
    payload: { acknowledged: true, confirmPhrase: 'حذف جميع الحجوزات', password: 'WrongPassword!' }
  });
  assert.equal(badPass.success, false);
  assert.equal(db.state.reservations.length, 1);

  // Valid security confirmation deletes all reservations & child rows
  const okDel = await dispatchCrmRequest(db, {
    action: 'deleteAllReservations',
    token: adminToken,
    payload: { acknowledged: true, confirmPhrase: 'حذف جميع الحجوزات', password: process.env.INITIAL_ADMIN_PASS || 'Admin@123' }
  });
  assert.equal(okDel.success, true);
  assert.equal(okDel.data.deleted, true);
  assert.equal(okDel.data.deletedReservationsCount, 1);
  assert.equal(db.state.reservations.length, 0);
  assert.equal(db.state.extensions.length, 0);
  assert.equal(db.state.follow_ups.length, 0);
  assert.equal(db.state.assignments.length, 0);
  assert.ok(db.state.sheets_mirror_outbox.some((m) => m.action === 'deleteAllReservations'));
});






