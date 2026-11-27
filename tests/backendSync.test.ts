import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { crmCore, hashPassword, hashToken, normalizeLoginUsername, verifySharedSecret } from '../backend/auth';
import { maskDatabaseUrl, persistCoreFilesOnDisk } from '../backend/coreBinding';
import { runLifecycleAndNationalIdMaintenance, type DbClient, type DbExecutor, type QueryResult } from '../backend/db';
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
import { buildVercelEnvChecklist, syncEnvVarsToVercel } from '../backend/vercelEnv';

function createInMemoryMockExecutor(opts: { injectUpsertFailFor?: (rec: Record<string, any>) => boolean } = {}): DbExecutor & { state: Record<string, any[]> } {
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
  const savepointSnapshots = new Map<string, string>();

  function mockRowLifecycle(r: any): 'active' | 'rejected' | 'cancelled' {
    return crmCore.classifyReservationLifecycle({
      originalStatusCode: r.original_status_code,
      originalStatusAr: r.original_status_ar,
      internalStatus: r.internal_status,
      isSourceCancelled: r.is_source_cancelled,
      isSourceRejected: r.is_source_rejected,
      rejectedAt: r.rejected_at,
      cancelledAt: r.cancelled_at
    });
  }

  function mockIsRejected(r: any): boolean {
    return mockRowLifecycle(r) === 'rejected';
  }

  function mockIsCancelled(r: any): boolean {
    return mockRowLifecycle(r) === 'cancelled';
  }

  function filterMockReservations(sql: string, params: any[], paramLimit?: number): any[] {
    let list = state.reservations.slice();
    const limit = typeof paramLimit === 'number' ? paramLimit : params.length;
    const fromParts = sql.split(/\bFROM\s+reservations(?:\s+r)?\b/i);
    const afterFrom = fromParts.length > 1 ? fromParts.slice(1).join(' ') : sql;
    const whereSegment = (afterFrom.split(/\bWHERE\b/i)[1] || '').split(/\b(?:ORDER BY|GROUP BY|LIMIT)\b/i)[0] || '';
    const refMatches = Array.from(whereSegment.matchAll(/\$(\d+)/g));
    const idxSet = new Set(refMatches.map((m) => Number(m[1]) - 1).filter((idx) => idx >= 0 && idx < limit));

    const hasRejCond = whereSegment.includes("'rejected_by_provider'");
    const hasCanCond = whereSegment.includes("'cancelled_by_provider'");
    if (hasRejCond && /AND NOT\s*\(\s*CASE/i.test(whereSegment)) {
      list = list.filter((r) => !mockIsRejected(r) && !mockIsCancelled(r));
    } else if (hasRejCond && /\)\s*OR\s*\(\s*CASE/i.test(whereSegment)) {
      list = list.filter((r) => mockIsRejected(r) || mockIsCancelled(r));
    } else if (hasCanCond && /THEN\s*\(\s*NOT\s*\(\s*COALESCE\(r\.is_source_cancelled/i.test(whereSegment)) {
      list = list.filter((r) => mockIsCancelled(r));
    } else if (hasRejCond) {
      list = list.filter((r) => mockIsRejected(r));
    } else if (hasCanCond) {
      list = list.filter((r) => mockIsCancelled(r));
    }

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

    const exactEndMatch = whereSegment.match(/LEFT\(COALESCE\(NULLIF\(r\.extended_until_date[\s\S]*?\)\s*,\s*10\)\s*=\s*\$(\d+)/);
    if (exactEndMatch) {
      const targetEnd = String(params[Number(exactEndMatch[1]) - 1] || '').slice(0, 10);
      if (targetEnd) {
        list = list.filter((r) => {
          const effEnd = String(r.extended_until_date || r.end_date || r.original_end_date || '').slice(0, 10);
          return Boolean(effEnd) && effEnd === targetEnd;
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

    const resNumOnlyMatch = whereSegment.match(/\(TRANSLATE\(COALESCE\(r\.reservation_number,\s*''\)[^)]*\)\s+ILIKE\s+\$(\d+)[^)]*\)(?!\s+OR)/);
    if (resNumOnlyMatch) {
      const needle = String(params[Number(resNumOnlyMatch[1]) - 1] || '').replace(/%/g, '').toLowerCase();
      list = list.filter((r) => String(r.reservation_number || '').toLowerCase().includes(needle));
    }

    const searchMatch = whereSegment.match(/(?:r\.reservation_number ILIKE \$(\d+)|TRANSLATE\(COALESCE\(r\.reservation_number,\s*''\)[^)]*\)\s+ILIKE\s+\$(\d+)[^)]*\)\s+OR\s+TRANSLATE\(COALESCE\(r\.customer_name)/);
    if (searchMatch) {
      const pNum = Number(searchMatch[1] || searchMatch[2]);
      const needle = String(params[pNum - 1] || '').replace(/%/g, '').toLowerCase();
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
    const orderMatch = sql.match(/ORDER BY\s+r\.(\w+)\s+(ASC|DESC)(?:\s+NULLS\s+(FIRST|LAST))?/i);
    if (!orderMatch) return list;
    const col = orderMatch[1];
    const dir = orderMatch[2].toUpperCase() === 'ASC' ? 1 : -1;
    const nullsPos = orderMatch[3] ? orderMatch[3].toUpperCase() : '';
    return list
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => {
        const va = a.item[col];
        const vb = b.item[col];
        const aNull = va === null || va === undefined || va === '';
        const bNull = vb === null || vb === undefined || vb === '';
        if (nullsPos === 'LAST') {
          if (aNull && !bNull) return 1;
          if (!aNull && bNull) return -1;
          if (aNull && bNull) return a.idx - b.idx;
        } else if (nullsPos === 'FIRST') {
          if (aNull && !bNull) return -1;
          if (!aNull && bNull) return 1;
          if (aNull && bNull) return a.idx - b.idx;
        }
        if (va instanceof Date || vb instanceof Date) {
          const diff = ((va ? new Date(va).getTime() : 0) - (vb ? new Date(vb).getTime() : 0)) * dir;
          return diff !== 0 ? diff : (a.idx - b.idx);
        }
        if (typeof va === 'number' || typeof vb === 'number') {
          const diff = (Number(va || 0) - Number(vb || 0)) * dir;
          return diff !== 0 ? diff : (a.idx - b.idx);
        }
        const cmp = String(va || '').localeCompare(String(vb || '')) * dir;
        return cmp !== 0 ? cmp : (a.idx - b.idx);
      })
      .map((x) => x.item);
  }

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SAVEPOINT ')) {
      const spName = sql.slice('SAVEPOINT '.length).trim();
      savepointSnapshots.set(spName, JSON.stringify({
        reservations: state.reservations,
        extensions: state.extensions,
        follow_up_history: state.follow_up_history
      }));
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('RELEASE SAVEPOINT ')) {
      const spName = sql.slice('RELEASE SAVEPOINT '.length).trim();
      savepointSnapshots.delete(spName);
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('ROLLBACK TO SAVEPOINT ')) {
      const spName = sql.slice('ROLLBACK TO SAVEPOINT '.length).trim();
      const rawSnap = savepointSnapshots.get(spName);
      if (rawSnap) {
        const snap = JSON.parse(rawSnap);
        state.reservations = snap.reservations || [];
        state.extensions = snap.extensions || [];
        state.follow_up_history = snap.follow_up_history || [];
      }
      return { rows: [], rowCount: 0 };
    }

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

    if (
      sql.startsWith('SELECT id, name, job_title, role, last_activity FROM employees') ||
      sql.startsWith('SELECT id, name, job_title, role, status, last_activity FROM employees')
    ) {
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
        if (opts.injectUpsertFailFor && opts.injectUpsertFailFor(rec)) {
          throw new Error(`MOCK_DB_CONSTRAINT_FAIL_${rec.reservation_number}`);
        }
        const idx = state.reservations.findIndex((r) => r.reservation_number === rec.reservation_number);
        if (idx === -1) {
          state.reservations.push(rec);
          outRows.push({ inserted: true });
        } else {
          const prev = state.reservations[idx];
          const samePhoneOrEmpty = !rec.customer_phone || !prev.customer_phone || rec.customer_phone === prev.customer_phone;
          state.reservations[idx] = {
            ...rec,
            id: prev.id,
            customer_id_number: rec.customer_id_number || (samePhoneOrEmpty ? (prev.customer_id_number || '') : ''),
            created_at: prev.created_at,
            source_order: rec.source_order ?? prev.source_order ?? null,
            is_source_cancelled: rec.is_source_cancelled !== null && rec.is_source_cancelled !== undefined ? rec.is_source_cancelled : (prev.is_source_cancelled ?? null),
            is_source_rejected: rec.is_source_rejected !== null && rec.is_source_rejected !== undefined ? rec.is_source_rejected : (prev.is_source_rejected ?? null),
            rcc_status: rec.rcc_status || prev.rcc_status || '',
            rcc_reason: rec.rcc_reason || prev.rcc_reason || ''
          };
          outRows.push({ inserted: false });
        }
      }
      return { rows: outRows as any[], rowCount: outRows.length };
    }

    if (sql.startsWith('UPDATE reservations SET is_source_cancelled = FALSE')) {
      const keepIds: string[] = Array.isArray(params[0]) ? params[0] : [];
      let cleared = 0;
      for (const r of state.reservations) {
        if (r.is_source_cancelled !== false && !keepIds.includes(String(r.source_reservation_id || ''))) {
          r.is_source_cancelled = false;
          cleared++;
        }
      }
      return { rows: [], rowCount: cleared };
    }

    if (sql.startsWith('UPDATE reservations SET is_source_rejected = FALSE')) {
      const keepIds: string[] = Array.isArray(params[0]) ? params[0] : [];
      let cleared = 0;
      for (const r of state.reservations) {
        if (r.is_source_rejected !== false && !keepIds.includes(String(r.source_reservation_id || ''))) {
          r.is_source_rejected = false;
          cleared++;
        }
      }
      return { rows: [], rowCount: cleared };
    }

    if (sql.startsWith('UPDATE reservations SET source_order = NULL')) {
      const liveNums: string[] = Array.isArray(params[0]) ? params[0] : [];
      let cleared = 0;
      for (const r of state.reservations) {
        if (r.source_order !== null && r.source_order !== undefined && !liveNums.includes(r.reservation_number)) {
          r.source_order = null;
          cleared++;
        }
      }
      return { rows: [], rowCount: cleared };
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
        r.updated_at = new Date(params[6]);
        r.status_history = JSON.parse(params[7]);
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
        r.updated_at = new Date(params[35]);
        r.status_history = JSON.parse(params[36]);
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
      const eventKey = sql.includes('event_key') ? String(params[8] ?? params[5] ?? '') : '';
      const recEmp = String(params[1] || '');
      const recRole = String(params[2] || '');
      const evk = sql.includes('VALUES ($1,\'\',$2') ? String(params[5] || '') : String(params[8] || '');
      if (evk && state.notifications.some((n) => n.event_key === evk && n.recipient_employee_id === recEmp && n.recipient_role === recRole)) {
        return { rows: [], rowCount: 0 };
      }
      state.notifications.push({
        id: params[0], recipient_employee_id: recEmp, recipient_role: recRole,
        type: params[3], title: params[4], message: params[5], entity_type: params[6], entity_id: params[7],
        event_key: evk, is_read: false, created_at: new Date()
      });
      void eventKey;
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO error_logs')) {
      state.error_logs.push({
        id: params[0],
        context: params[1],
        action: params[2],
        message: params[3],
        stack: params[4],
        meta: params[5] ? JSON.parse(params[5]) : {},
        created_at: new Date()
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
      const hasDynamicStatus = sql.includes('error_message') && params.length >= 12;
      if (hasDynamicStatus) {
        state.sync_log.push({
          id: params[0], triggered_by_id: params[1], triggered_by_name: params[2], status: params[3] || 'success',
          imported_count: params[4], updated_count: params[5], extensions_count: params[6],
          pages_fetched: params[7], error_message: params[8] || '', duration_ms: params[9],
          started_at: new Date(params[10]), finished_at: new Date(params[11])
        });
      } else {
        state.sync_log.push({
          id: params[0], triggered_by_id: params[1], triggered_by_name: params[2], status: 'success',
          imported_count: params[3], updated_count: params[4], extensions_count: params[5],
          pages_fetched: params[6], duration_ms: params[7], started_at: new Date(params[8]), finished_at: new Date(params[9])
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{
        source: params[0],
        last_successful_at: params[2] || null,
        last_status: params[5] || 'success',
        last_batch_count: params[4] ?? params[3],
        last_error: params[6] || '',
        meta: params[7] ? (typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7]) : {}
      }];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT reservation_number, source_reservation_id FROM reservations')) {
      const nums: string[] = Array.isArray(params[0]) ? params[0] : [];
      const srcIds: string[] = Array.isArray(params[1]) ? params[1] : [];
      const rows = state.reservations
        .filter((r) => nums.includes(r.reservation_number) || srcIds.includes(r.source_reservation_id) || srcIds.includes(r.reservation_number))
        .map((r) => ({ reservation_number: r.reservation_number, source_reservation_id: r.source_reservation_id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*)::text AS total_cnt')) {
      const list = filterMockReservations(sql, params);
      let activeCnt = 0;
      let cancelledCnt = 0;
      let rejectedCnt = 0;
      for (const r of list) {
        const isRej = mockIsRejected(r);
        const isCan = mockIsCancelled(r);
        if (isRej) rejectedCnt++;
        if (isCan) cancelledCnt++;
        if (!isRej && !isCan) activeCnt++;
      }
      return {
        rows: [{
          total_cnt: String(list.length),
          active_cnt: String(activeCnt),
          cancelled_cnt: String(cancelledCnt),
          rejected_cnt: String(rejectedCnt)
        }] as any[],
        rowCount: 1
      };
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

    if (sql.startsWith('SELECT r.id, r.source_reservation_id, r.reservation_number')) {
      const maxItems = Number(params[0] || 2500);
      const list = sortMockReservations(sql, filterMockReservations(sql, params)).slice(0, maxItems);
      return {
        rows: list.map((r) => ({ ...r, is_followed: state.follow_ups.some((f) => f.reservation_id === r.id) })) as any[],
        rowCount: list.length
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
      let todayCnt = 0;
      let cancelledCnt = 0;
      let rejectedCnt = 0;
      for (const r of list) {
        const createdDay = r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at || '').slice(0, 10);
        if (r.start_date === todayStr || createdDay === todayStr) todayCnt++;
        if (mockIsRejected(r)) rejectedCnt++;
        if (mockIsCancelled(r)) cancelledCnt++;
      }
      return {
        rows: [{ total_cnt: list.length, today_cnt: todayCnt, cancelled_cnt: cancelledCnt, rejected_cnt: rejectedCnt }] as any[],
        rowCount: 1
      };
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

    if (sql.startsWith('SELECT 1 AS ok')) {
      return { rows: [{ ok: 1 }] as any[], rowCount: 1 };
    }

    if (sql.includes('AS res_cnt') && sql.includes('AS emp_cnt') && sql.includes('AS sync_cnt')) {
      return {
        rows: [{
          res_cnt: String(state.reservations.length),
          emp_cnt: String(state.employees.length),
          sync_cnt: String(state.sync_log.length)
        }] as any[],
        rowCount: 1
      };
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

    // Seed excluded_statuses setting like legacy DB (cancelled/rejected must NEVER be excluded, while draft is excluded)
    db.state.settings.push({ key: 'excluded_statuses', value: JSON.stringify(['cancelled', 'canceled', 'rejected', 'draft']) });

    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'المدير العام', role: 'general_manager' },
      {},
      mockFetch
    );
    assert.equal(pullRes.importedCount, 3);
    assert.equal(pullRes.extensionsCount, 1);
    assert.equal(pullRes.fetchedCount, 3);
    assert.equal(pullRes.excludedFilteredCount, 0);
    assert.equal(db.state.reservations.length, 3);
    const res6001 = db.state.reservations.find((r) => r.reservation_number === '6001');
    const res6002 = db.state.reservations.find((r) => r.reservation_number === '6002');
    assert.ok(res6001);
    assert.ok(res6002);
    assert.equal(res6001.total_amount, 1050);
    assert.equal(res6002.original_status_code, 'cancelled');
    assert.ok(res6002.cancelled_at);
    assert.equal(res6002.rejected_at, '');

    // Multi-page 1-based API (?page=0 -> current_page: 1, last_page: 2, next_page_url present) + rejected + draft
    const mockPaged1Based = (async (url: any) => {
      const u = String(url);
      if (u.includes('reservations/filter')) {
        if (u.includes('page=0')) {
          return new Response(JSON.stringify({
            data: [
              { reservationId: 6010, clientName: 'سعيد المالكي', reservationStatus: 'REJECTED', rejectionReason: 'عدم توفر مركبة', clientNationalId: '0098765432', total: 400 },
              { reservationId: 6011, clientName: 'مسودة', reservationStatus: 'DRAFT', total: 100 }
            ],
            current_page: 1,
            last_page: 2,
            total: 3,
            per_page: 2,
            next_page_url: 'https://api.rentalgate.net/api/reservations/filter?page=2'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          data: [
            { reservationId: 6012, clientName: 'ناصر الحربي', reservationStatus: 'CANCELLED', cancellationReason: 'إلغاء العميل', clientMobile: '0551112233', total: 650 }
          ],
          current_page: 2,
          last_page: 2,
          total: 3,
          per_page: 2,
          next_page_url: null
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const pull1Based = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'المدير العام', role: 'general_manager' },
      {},
      mockPaged1Based
    );
    assert.equal(pull1Based.fetchedCount, 3);
    assert.equal(pull1Based.excludedFilteredCount, 1);
    assert.equal(pull1Based.importedCount, 2);
    const rej6010 = db.state.reservations.find((r) => r.reservation_number === '6010');
    const can6012 = db.state.reservations.find((r) => r.reservation_number === '6012');
    assert.ok(rej6010);
    assert.ok(can6012);
    assert.equal(rej6010.customer_id_number, '0098765432');
    assert.ok(rej6010.rejected_at);
    assert.equal(rej6010.cancelled_at, '');
    assert.ok(can6012.cancelled_at);
    assert.equal(can6012.rejected_at, '');
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

test('no SQL query in backend/ or api/ mixes inconsistent type casts for the same parameter placeholder', () => {
  const dirs = ['backend', 'api'].map((d) => path.resolve(process.cwd(), d));
  const conflicts: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const fullPath = path.join(dir, file);
      const src = fs.readFileSync(fullPath, 'utf8');
      const sqlBlocks = [...src.matchAll(/`([^`]*(?:\$\d+|\$\{[^}]+\})[^`]*)`/g)];
      for (const m of sqlBlocks) {
        const sql = m[1];
        if (!/(SELECT|INSERT|UPDATE|DELETE|WITH|VALUES)\b/i.test(sql)) continue;
        const formsByParam: Record<string, Set<string>> = {};
        for (const pm of sql.matchAll(/((?:\$\d+|\$\{[^}]+\})(?:\s*::\s*[a-z0-9_]+(?:\[\])?)?)/gi)) {
          const clean = pm[1].replace(/\s+/g, '').toLowerCase();
          const baseMatch = clean.match(/^(\$\d+|\$\{[^}]+\})/);
          if (!baseMatch) continue;
          const base = baseMatch[1];
          const cast = clean.includes('::') ? clean.slice(base.length + 2) : '<untyped>';
          if (!formsByParam[base]) formsByParam[base] = new Set();
          formsByParam[base].add(cast);
        }
        for (const [param, casts] of Object.entries(formsByParam)) {
          if (casts.size > 1) {
            const lineNum = src.slice(0, m.index || 0).split('\n').length;
            conflicts.push(`${path.basename(dir)}/${file}:${lineNum} ${param} -> [${[...casts].join(', ')}]`);
          }
        }
      }
    }
  }

  assert.deepEqual(conflicts, []);
});

test('serverConfig prefers DB-saved gas_webapp_url over stale env GAS_WEBAPP_URL and clears in sandbox mode', async () => {
  const prevEnvGas = process.env.GAS_WEBAPP_URL;
  const prevFixedGas = FIXED_SERVER_CONFIG.gasWebAppUrl;
  const prevDb = process.env.DATABASE_URL;
  process.env.GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbOldEnvUrl12345/exec';
  process.env.DATABASE_URL = 'postgresql://user:pass@ep-demo.aws.neon.tech/neondb?sslmode=require';
  FIXED_SERVER_CONFIG.gasWebAppUrl = '';

  try {
    const db = createInMemoryMockExecutor();
    db.state.settings.push(
      { key: 'connection_mode', value: 'gas' },
      { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/AKfycbNewDbUrl67890/exec' }
    );

    const cfg = await resolveServerConfig(db);
    assert.equal(cfg.mode, 'gas');
    assert.equal(cfg.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycbNewDbUrl67890/exec');

    const healthAuto = await readPublicHealthAutoBind(db);
    assert.equal(healthAuto.mode, 'gas');
    assert.equal(healthAuto.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycbNewDbUrl67890/exec');

    // Sandbox clears gasWebAppUrl
    const modeRow = db.state.settings.find((s) => s.key === 'connection_mode');
    if (modeRow) modeRow.value = 'sandbox';
    const sandboxCfg = await resolveServerConfig(db);
    assert.equal(sandboxCfg.mode, 'sandbox');
    assert.equal(sandboxCfg.gasWebAppUrl, '');
  } finally {
    if (prevEnvGas !== undefined) process.env.GAS_WEBAPP_URL = prevEnvGas;
    else delete process.env.GAS_WEBAPP_URL;
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    else delete process.env.DATABASE_URL;
    FIXED_SERVER_CONFIG.gasWebAppUrl = prevFixedGas;
  }
});

test('vercelEnv upserts GAS_WEBAPP_URL & CONNECTION_MODE through Vercel REST API and setupService integrates seamlessly', async () => {
  const prevVercel = process.env.VERCEL;
  const prevGasEnv = process.env.GAS_WEBAPP_URL;
  const prevModeEnv = process.env.CONNECTION_MODE;
  const prevFixedMode = FIXED_SERVER_CONFIG.mode;
  const prevFixedGas = FIXED_SERVER_CONFIG.gasWebAppUrl;
  const prevFixedDb = FIXED_SERVER_CONFIG.databaseUrl;

  process.env.VERCEL = '1';
  delete process.env.GAS_WEBAPP_URL;
  delete process.env.CONNECTION_MODE;

  const gasTarget = 'https://script.google.com/macros/s/AKfycbVercelGasTest12345/exec';
  const requests: Array<{ url: string; method: string; headers: any; body: any }> = [];

  const mockFetch = (async (url: any, init: any) => {
    const u = String(url);
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: u, method: String(init?.method || 'GET'), headers: init?.headers || {}, body: parsedBody });
    if (u.startsWith('https://api.vercel.com/v10/projects/')) {
      return new Response(JSON.stringify({ created: { key: parsedBody?.key } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (u.startsWith('https://api.vercel.com/v1/integrations/deploy/')) {
      return new Response(JSON.stringify({ job: { id: 'dep_123' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (u === gasTarget) {
      return new Response(JSON.stringify({ success: true, message: 'bound', data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  }) as any;

  try {
    // 1. Direct vercelEnv helper syncs GAS_WEBAPP_URL + CONNECTION_MODE + triggers deploy hook
    const directSync = await syncEnvVarsToVercel(
      {
        mode: 'gas',
        gasWebAppUrl: gasTarget,
        rgToken: 'rg_secret_token_abc',
        vercelToken: 'vrc_tok_demo',
        vercelProjectId: 'prj_demo_123',
        vercelTeamId: 'team_demo_99',
        vercelDeployHookUrl: 'https://api.vercel.com/v1/integrations/deploy/prj_demo_123/hookxyz'
      },
      mockFetch
    );
    assert.equal(directSync.attempted, true);
    assert.equal(directSync.synced, true);
    assert.equal(directSync.redeployTriggered, true);
    assert.deepEqual(directSync.syncedKeys, ['CONNECTION_MODE', 'GAS_WEBAPP_URL', 'RG_TOKEN']);
    const gasPost = requests.find((r) => r.body?.key === 'GAS_WEBAPP_URL');
    assert.ok(gasPost);
    assert.equal(gasPost.url, 'https://api.vercel.com/v10/projects/prj_demo_123/env?upsert=true&teamId=team_demo_99');
    assert.equal(gasPost.body.value, gasTarget);
    assert.equal(gasPost.body.type, 'plain');
    const tokPost = requests.find((r) => r.body?.key === 'RG_TOKEN');
    assert.equal(tokPost?.body?.type, 'encrypted');

    // 2. setupService in GAS mode on Vercel without VERCEL_TOKEN reports needsVercelEnvVar + checklist
    const checklistSetup = await applyUnifiedConnectionSetup({
      skipLiveDbTest: true,
      fetchFn: mockFetch,
      payload: {
        mode: 'gas',
        gasWebAppUrl: gasTarget,
        persistCoreFiles: false
      }
    });
    assert.equal(checklistSetup.saved, true);
    assert.equal(checklistSetup.mode, 'gas');
    assert.equal(checklistSetup.needsVercelEnvVar, true);
    assert.equal(checklistSetup.vercelEnvChecklist.some((x) => x.key === 'GAS_WEBAPP_URL' && x.value === gasTarget), true);
    assert.equal(checklistSetup.vercelEnvChecklist.some((x) => x.key === 'CONNECTION_MODE' && x.value === 'gas'), true);

    // 3. setupService in GAS mode with VERCEL_TOKEN + VERCEL_PROJECT_ID clears needsVercelEnvVar automatically
    delete process.env.GAS_WEBAPP_URL;
    const syncedSetup = await applyUnifiedConnectionSetup({
      skipLiveDbTest: true,
      fetchFn: mockFetch,
      payload: {
        mode: 'gas',
        gasWebAppUrl: gasTarget,
        vercelToken: 'vrc_tok_demo',
        vercelProjectId: 'prj_demo_123',
        persistCoreFiles: false
      }
    });
    assert.equal(syncedSetup.saved, true);
    assert.equal(syncedSetup.vercelSync.synced, true);
    assert.equal(syncedSetup.needsVercelEnvVar, false);

    // Checklist never includes raw sensitive secrets
    const cl = buildVercelEnvChecklist({
      mode: 'gas',
      gasWebAppUrl: gasTarget,
      rgToken: 'super_secret_token_never_leak'
    });
    const rgItem = cl.find((x) => x.key === 'RG_TOKEN');
    assert.equal(rgItem?.sensitive, true);
    assert.equal(rgItem?.value, '');
  } finally {
    if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
    else delete process.env.VERCEL;
    if (prevGasEnv !== undefined) process.env.GAS_WEBAPP_URL = prevGasEnv;
    else delete process.env.GAS_WEBAPP_URL;
    if (prevModeEnv !== undefined) process.env.CONNECTION_MODE = prevModeEnv;
    else delete process.env.CONNECTION_MODE;
    FIXED_SERVER_CONFIG.mode = prevFixedMode;
    FIXED_SERVER_CONFIG.gasWebAppUrl = prevFixedGas;
    FIXED_SERVER_CONFIG.databaseUrl = prevFixedDb;
  }
});

test('/api/health and /api/crm resolve server-side GAS_WEBAPP_URL fallback cleanly when payload.gasUrl is omitted', async () => {
  const prevGas = process.env.GAS_WEBAPP_URL;
  const prevMode = process.env.CONNECTION_MODE;
  const prevDb = process.env.DATABASE_URL;
  const prevFixedGas = FIXED_SERVER_CONFIG.gasWebAppUrl;
  const prevFixedDb = FIXED_SERVER_CONFIG.databaseUrl;

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
    delete process.env.DATABASE_URL;
    FIXED_SERVER_CONFIG.databaseUrl = '';
    process.env.CONNECTION_MODE = 'gas';
    process.env.GAS_WEBAPP_URL = 'https://invalid-unconfigured-domain.example.com/exec';

    const { default: healthHandler } = await import('../api/health.js');
    const healthMock = makeMockRes();
    await healthHandler({ method: 'GET', headers: {} }, healthMock.res);
    assert.equal(healthMock.out.statusCode, 200);
    assert.equal(healthMock.out.body.ok, true);
    assert.equal(healthMock.out.body.serverlessProxyAvailable, true);
    assert.equal(healthMock.out.body.envGasConfigured, true);
    assert.equal(healthMock.out.body.gasWebAppUrl, 'https://invalid-unconfigured-domain.example.com/exec');

    const { default: crmHandler } = await import('../api/crm.js');
    // Omitting payload.gasUrl triggers server fallback lookup -> validates server GAS URL instead of complaining empty URL
    const pingFallbackMock = makeMockRes();
    await crmHandler({
      method: 'POST',
      headers: {},
      body: { action: 'pingGasUrl', payload: {} }
    }, pingFallbackMock.res);
    assert.equal(pingFallbackMock.out.statusCode, 200);
    assert.equal(pingFallbackMock.out.body.success, false);
    // Validates against host check rather than returning empty-URL error -> proves server GAS_WEBAPP_URL was resolved!
    assert.equal(pingFallbackMock.out.body.error, 'INVALID_GAS_URL');
    assert.ok(String(pingFallbackMock.out.body.message).includes('script.google.com'));
  } finally {
    if (prevGas !== undefined) process.env.GAS_WEBAPP_URL = prevGas;
    else delete process.env.GAS_WEBAPP_URL;
    if (prevMode !== undefined) process.env.CONNECTION_MODE = prevMode;
    else delete process.env.CONNECTION_MODE;
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    else delete process.env.DATABASE_URL;
    FIXED_SERVER_CONFIG.gasWebAppUrl = prevFixedGas;
    FIXED_SERVER_CONFIG.databaseUrl = prevFixedDb;
  }
});

test('RGApi always revalidates live server after F5 refresh, flushes IDB/session cache on pullReservations, and keeps intra-session speed & offline fallback', async () => {
  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const idbSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/idb.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');

  const createMemoryStorage = (initial: Record<string, string> = {}) => {
    const map = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      dump: () => Object.fromEntries(map.entries())
    };
  };

  function bootFrontendSandbox(opts: {
    sessionInit?: Record<string, string>;
    localInit?: Record<string, string>;
    idbSnapshot?: { kvEntries?: any[]; reservations?: any[]; meta?: any };
    fetchImpl: (url: string, init?: any) => Promise<any>;
  }) {
    const localStorage = createMemoryStorage({
      rg_crm_session_token: 'tok_live_test_1',
      ...(opts.localInit || {})
    });
    const sessionStorage = createMemoryStorage(opts.sessionInit || {});

    const ctx: any = {
      console,
      Date,
      Math,
      JSON,
      Promise,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Set,
      Map,
      RegExp,
      URL,
      setTimeout,
      clearTimeout,
      CustomEvent: class CustomEvent {
        type: string;
        detail: any;
        constructor(type: string, init?: any) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
      document: {
        dispatchEvent() {}
      },
      localStorage,
      sessionStorage,
      fetch: opts.fetchImpl
    };
    ctx.window = ctx;
    ctx.RG_APP_CONFIG = { mode: 'neon', backendApiUrl: '/api/crm', gasWebAppUrl: '' };
    ctx.location = {
      protocol: 'https:',
      hostname: 'rentcrm.example.com',
      origin: 'https://rentcrm.example.com',
      search: '',
      href: 'https://rentcrm.example.com/#reservations',
      pathname: '/',
      hash: '#reservations'
    };
    ctx.history = { replaceState() {} };

    vm.runInNewContext(coreSrc, ctx);
    vm.runInNewContext(idbSrc, ctx);

    // Override RGIdbCache after idb.js with deterministic in-memory fake IDB tracking puts/deletes
    const idbStore = {
      kvEntries: [...(opts.idbSnapshot?.kvEntries || [])],
      reservations: [...(opts.idbSnapshot?.reservations || [])],
      meta: opts.idbSnapshot?.meta ? { ...opts.idbSnapshot.meta } : null
    };
    ctx.RGIdbCache = {
      isSupported: () => true,
      loadNamespaceSnapshot: async () => ({
        kvEntries: idbStore.kvEntries.map((x) => ({ ...x })),
        reservations: idbStore.reservations.map((x) => ({ ...x })),
        customers: [],
        details: [],
        meta: idbStore.meta ? { ...idbStore.meta } : null
      }),
      putKvEntries: async (entries: any[]) => {
        for (const e of entries) {
          const idx = idbStore.kvEntries.findIndex((x) => x.key === e.key);
          if (idx === -1) idbStore.kvEntries.push({ ...e });
          else idbStore.kvEntries[idx] = { ...e };
        }
        return true;
      },
      deleteKvByKeys: async (keys: string[]) => {
        idbStore.kvEntries = idbStore.kvEntries.filter((x) => !keys.includes(x.key));
        return true;
      },
      deleteKvByScopes: async (_ns: string, scopes: string[]) => {
        idbStore.kvEntries = idbStore.kvEntries.filter((x) => !scopes.includes(x.scope));
        return true;
      },
      upsertReservations: async (_ns: string, rows: any[]) => {
        for (const r of rows) {
          const idx = idbStore.reservations.findIndex((x) => x.id === r.id);
          if (idx === -1) idbStore.reservations.push({ ...r });
          else idbStore.reservations[idx] = { ...r };
        }
        return true;
      },
      replaceReservationsSnapshot: async (_ns: string, rows: any[], _cust: any[], meta: any) => {
        idbStore.reservations = rows.map((r) => ({ ...r }));
        idbStore.meta = { ...meta };
        return true;
      },
      upsertCustomers: async () => true,
      upsertReservationDetail: async () => true,
      upsertMeta: async (_ns: string, patch: any) => {
        idbStore.meta = { ...(idbStore.meta || {}), ...patch };
        return true;
      },
      clearNamespace: async () => {
        idbStore.kvEntries = [];
        idbStore.reservations = [];
        idbStore.meta = null;
        return true;
      }
    };

    vm.runInNewContext(apiSrc, ctx);
    return { ctx, sessionStorage, idbStore };
  }

  const now = Date.now();
  const buildCoreCtx: any = { window: {} };
  buildCoreCtx.window = buildCoreCtx;
  vm.runInNewContext(coreSrc, buildCoreCtx);
  const resCacheKey = buildCoreCtx.RGCrmCore.buildApiCacheKey('/api/crm', 'tok_live_test_1', 'getReservations', { page: 1 });
  const dashCacheKey = buildCoreCtx.RGCrmCore.buildApiCacheKey('/api/crm', 'tok_live_test_1', 'getDashboard', {});

  let serverResItems = [{ id: 'RES_NEW', reservationNumber: 'RG-NEW-999', customerName: 'عميل محدث بعد السحب' }];
  let serverDashTotal = 999;
  const crmActionsCalled: string[] = [];

  // 1) Simulate F5 reload while sessionStorage + IndexedDB STILL contain stale pre-pull data with future expiresAt!
  const staleResEntry = {
    key: resCacheKey,
    ns: '/api/crm::tok_live_test_1',
    scope: 'reservations',
    storedAt: now - 5000,
    expiresAt: now + 55000,
    staleUntil: now + 86400000,
    response: {
      success: true,
      message: '',
      data: { items: [{ id: 'RES_OLD', reservationNumber: 'RG-OLD-111', customerName: 'بيانات قديمة' }], total: 1 },
      error: null
    }
  };
  const staleDashEntry = {
    key: dashCacheKey,
    ns: '/api/crm::tok_live_test_1',
    scope: 'dashboard',
    storedAt: now - 5000,
    expiresAt: now + 55000,
    staleUntil: now + 86400000,
    response: {
      success: true,
      message: '',
      data: { kpis: { totalReservations: 111 } },
      error: null
    }
  };

  const f5Session = bootFrontendSandbox({
    sessionInit: {
      rg_crm_swr_v1: JSON.stringify({
        [resCacheKey]: staleResEntry,
        [dashCacheKey]: staleDashEntry
      })
    },
    idbSnapshot: {
      kvEntries: [staleResEntry, staleDashEntry],
      reservations: [{ id: 'RES_OLD', reservationNumber: 'RG-OLD-111', customerName: 'بيانات قديمة' }],
      meta: { allReservationsHydrated: true, updatedAt: now - 5000 }
    },
    fetchImpl: async (url: string, init?: any) => {
      if (String(url).includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ ok: true, mode: 'neon', databaseConfigured: true, connected: true, backendApiUrl: '/api/crm' })
        };
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      crmActionsCalled.push(body.action);
      if (body.action === 'getReservations') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ success: true, message: '', data: { items: serverResItems, total: serverResItems.length }, error: null })
        };
      }
      if (body.action === 'getDashboard') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ success: true, message: '', data: { kpis: { totalReservations: serverDashTotal } }, error: null })
        };
      }
      if (body.action === 'pullReservations') {
        serverResItems = [{ id: 'RES_PULLED_2', reservationNumber: 'RG-PULLED-2', customerName: 'عميل مسحوب للتو' }];
        serverDashTotal = 1002;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            success: true,
            message: 'ok',
            data: { pulled: 1, changedReservations: serverResItems, finishedAt: new Date().toISOString() },
            error: null
          })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ success: true, message: '', data: {}, error: null })
      };
    }
  });

  await f5Session.ctx.RGApi.ready();

  // First read after F5 MUST NOT serve stale session/IDB cache when online!
  const firstResAfterF5 = await f5Session.ctx.RGApi.callApi('getReservations', { page: 1 });
  assert.equal(firstResAfterF5.data.items[0].id, 'RES_NEW');
  assert.equal(crmActionsCalled.filter((a) => a === 'getReservations').length, 1);

  const firstDashAfterF5 = await f5Session.ctx.RGApi.callApi('getDashboard', {});
  assert.equal(firstDashAfterF5.data.kpis.totalReservations, 999);
  assert.equal(crmActionsCalled.filter((a) => a === 'getDashboard').length, 1);

  // Intra-session navigation MUST still hit cache at 0ms (no extra fetch calls)
  const secondResSamePage = await f5Session.ctx.RGApi.callApi('getReservations', { page: 1 });
  assert.equal(secondResSamePage.data.items[0].id, 'RES_NEW');
  assert.equal(crmActionsCalled.filter((a) => a === 'getReservations').length, 1);

  // Pull reservations must await clearing reservations/dashboard KV cache and IDB meta hydration flag
  const pullResult = await f5Session.ctx.RGApi.callApi('pullReservations', { datePreset: '7d' });
  assert.equal(pullResult.success, true);
  assert.equal(f5Session.idbStore.kvEntries.some((x) => x.scope === 'reservations' || x.scope === 'dashboard'), false);
  assert.equal(f5Session.idbStore.meta?.allReservationsHydrated, false);

  // Next getReservations (even without forceRefresh) must hit live server and get RG-PULLED-2
  const afterPullRes = await f5Session.ctx.RGApi.callApi('getReservations', { page: 1 });
  assert.equal(afterPullRes.data.items[0].id, 'RES_PULLED_2');
  assert.equal(crmActionsCalled.filter((a) => a === 'getReservations').length, 2);

  // 2) Offline fallback on cold F5 reload if live server is unreachable
  const offlineSession = bootFrontendSandbox({
    sessionInit: {
      rg_crm_swr_v1: JSON.stringify({ [resCacheKey]: staleResEntry })
    },
    fetchImpl: async (url: string) => {
      if (String(url).includes('/api/health')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ ok: true, mode: 'neon', databaseConfigured: true, connected: true, backendApiUrl: '/api/crm' })
        };
      }
      throw new Error('offline_network_error');
    }
  });
  await offlineSession.ctx.RGApi.ready();
  const offlineRes = await offlineSession.ctx.RGApi.callApi('getReservations', { page: 1 });
  assert.equal(offlineRes.success, true);
  assert.equal(offlineRes.data.items[0].id, 'RES_OLD');
});

test('testDatabaseHealth diagnostics, disabled client-side web binding, and UI test buttons replace website binding forms', async () => {
  const db = createInMemoryMockExecutor();
  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: 'Admin@123' }
  });
  assert.equal(adminLogin.success, true);
  const adminToken = adminLogin.data.token;

  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: 'Agent@123' }
  });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;

  // Unauthenticated or agent without access_api must be denied
  const unauthHealth = await dispatchCrmRequest(db, { action: 'testDatabaseHealth' });
  assert.equal(unauthHealth.success, false);
  const agentHealth = await dispatchCrmRequest(db, { action: 'testDatabaseHealth', token: agentToken });
  assert.equal(agentHealth.success, false);

  // Admin gets structured Neon PostgreSQL health metrics
  const dbHealth = await dispatchCrmRequest(db, {
    action: 'testDatabaseHealth',
    token: adminToken
  });
  assert.equal(dbHealth.success, true);
  assert.equal(dbHealth.data.connected, true);
  assert.equal(dbHealth.data.configured, true);
  assert.ok(Number(dbHealth.data.latencyMs) >= 1);
  assert.equal(typeof dbHealth.data.reservationsCount, 'number');
  assert.ok(Number(dbHealth.data.employeesCount) >= 3);

  // Verify frontend RGApi diagnostics & disabled web setup in VM sandbox
  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const idbSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/idb.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');

  const createMemStorage = (init: Record<string, string> = {}) => {
    const map = new Map<string, string>(Object.entries(init));
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); }
    };
  };

  const calledUrls: Array<{ url: string; action: string }> = [];
  const ctx: any = {
    console, Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Set, Map, RegExp, URL,
    setTimeout, clearTimeout,
    CustomEvent: class CustomEvent { type: string; detail: any; constructor(t: string, i?: any) { this.type = t; this.detail = i?.detail; } },
    document: { dispatchEvent() {} },
    localStorage: createMemStorage({
      rg_crm_session_token: adminToken,
      rg_crm_gas_url: 'https://stale-override.example.com/exec',
      rg_crm_backend_api_url: 'https://stale-backend.example.com/api/crm'
    }),
    sessionStorage: createMemStorage({}),
    RG_APP_CONFIG: { mode: 'neon', backendApiUrl: '/api/crm', gasWebAppUrl: '' },
    location: {
      protocol: 'https:',
      hostname: 'rentcrm.example.com',
      origin: 'https://rentcrm.example.com',
      search: '?gasUrl=https%3A%2F%2Fmalicious.example.com%2Fexec',
      href: 'https://rentcrm.example.com/?gasUrl=foo',
      pathname: '/',
      hash: '#settings'
    },
    history: { replaceState() {} },
    fetch: async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/api/health')) {
        calledUrls.push({ url: u, action: 'health' });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            ok: true,
            mode: 'neon',
            databaseConfigured: true,
            connected: true,
            envGasConfigured: true,
            backendApiUrl: '/api/crm',
            message: 'الخادم متصل'
          })
        };
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calledUrls.push({ url: u, action: body.action || '' });
      if (body.action === 'testDatabaseHealth') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ success: true, message: 'ok', data: dbHealth.data, error: null })
        };
      }
      if (body.action === 'pingGasUrl') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            success: true,
            message: 'Google Apps Script يعمل بنجاح.',
            data: { latencyMs: 42 },
            error: null
          })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ success: true, message: '', data: {}, error: null })
      };
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(coreSrc, ctx);
  vm.runInNewContext(idbSrc, ctx);
  vm.runInNewContext(apiSrc, ctx);

  await ctx.RGApi.ready();

  // Browser URL/localStorage overrides MUST NOT override backend /api/crm
  assert.equal(ctx.RGApi.getBackendApiUrl(), '/api/crm');

  // Website unified setup must be disabled
  const disabledSetup = await ctx.RGApi.applyUnifiedSetup({ mode: 'gas', gasWebAppUrl: 'https://script.google.com/macros/s/abc/exec' });
  assert.equal(disabledSetup.success, false);
  assert.equal(disabledSetup.error, 'WEB_SETUP_DISABLED');

  // New test button API helpers hit server diagnostics cleanly
  const srvHealth = await ctx.RGApi.testServerHealth();
  assert.equal(srvHealth.success, true);
  assert.equal(srvHealth.data.mode, 'neon');

  const neonTest = await ctx.RGApi.testDatabaseHealth();
  assert.equal(neonTest.success, true);
  assert.equal(neonTest.data.connected, true);

  const gasTest = await ctx.RGApi.pingGasUrl('');
  assert.equal(gasTest.success, true);
  assert.ok(calledUrls.some((c) => c.action === 'pingGasUrl'));

  // Verify settings.js and app.js have test buttons and zero website connection/binding forms
  const settingsSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/settings.js'), 'utf8');
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/app.js'), 'utf8');
  const srcAppSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/assets/js/app.js'), 'utf8');
  assert.equal(appSrc, srcAppSrc);

  for (const id of [
    'btn-test-all-connections',
    'btn-test-server-health',
    'btn-test-neon-db',
    'btn-ping-gas-url',
    'btn-test-rg-top',
    'btn-test-rg',
    'btn-clear-browser-cache',
    'btn-save-rg-token',
    'set-rg-token',
    'rg-token-settings-form'
  ]) {
    assert.ok(settingsSrc.includes(id), `settings.js missing required control ${id}`);
  }
  assert.equal(appSrc.includes('login-test-connection-btn'), false, 'app.js still contains login-test-connection-btn');
  assert.equal(appSrc.includes('login-conn-test-result'), false, 'app.js still contains login-conn-test-result');

  for (const removedId of [
    'btn-save-gas-url',
    'btn-restore-global-gas',
    'btn-clear-gas-url',
    'setup-database-url',
    'setup-rg-token',
    'setup-sync-secret',
    'setup-vercel-token',
    'set-gas-url'
  ]) {
    assert.equal(settingsSrc.includes(removedId), false, `settings.js still contains binding control ${removedId}`);
  }
  assert.equal(appSrc.includes('login-restore-default-gas'), false, 'app.js still contains login-restore-default-gas');
});

test('RGIdbCache: enforces boot sync check on page load, invalidates stale server epoch, falls back offline, and wipes all caches cleanly', async () => {
  const idbPath = path.resolve(process.cwd(), 'assets/js/idb.js');
  const idbCode = fs.readFileSync(idbPath, 'utf8');

  const clearedCaches: string[] = [];
  const unregisteredSw: number[] = [];
  const removedSession: string[] = [];
  const removedLocal: string[] = [];
  const sessionMap = new Map<string, string>([
    ['rg_crm_swr_v1', '{"k":1}'],
    ['other_key', 'keep']
  ]);
  const localMap = new Map<string, string>([
    ['rg_crm_gas_url', 'https://old.example/exec'],
    ['rg_crm_swr_v1', 'stale'],
    ['rg_crm_session_token', 'tok_keep'],
    ['rg_crm_user_prefs_u_emp1', '{"theme":"dark"}']
  ]);

  const sandboxCtx: any = {
    window: {} as any,
    caches: {
      keys: async () => ['rg-cache-v1', 'static-v2'],
      delete: async (k: string) => {
        clearedCaches.push(k);
        return true;
      }
    },
    navigator: {
      serviceWorker: {
        getRegistrations: async () => [
          { unregister: async () => { unregisteredSw.push(1); return true; } }
        ]
      }
    },
    sessionStorage: {
      get length() { return sessionMap.size; },
      key: (idx: number) => Array.from(sessionMap.keys())[idx] ?? null,
      removeItem: (k: string) => { removedSession.push(k); sessionMap.delete(k); }
    },
    localStorage: {
      getItem: (k: string) => (localMap.has(k) ? localMap.get(k)! : null),
      removeItem: (k: string) => { removedLocal.push(k); localMap.delete(k); }
    }
  };
  sandboxCtx.window.caches = sandboxCtx.caches;
  vm.createContext(sandboxCtx);
  vm.runInContext(idbCode, sandboxCtx);

  const idb = sandboxCtx.window.RGIdbCache;
  assert.ok(idb, 'RGIdbCache exported');
  assert.equal(idb.DB_NAME, 'rg_crm_idb_v2');
  assert.equal(idb.DB_VERSION, 3);

  // Store initial KV entries in dashboard & non-dashboard scopes
  await idb.putKvEntries([
    { key: 'k_dash', ns: 'ns1', scope: 'dashboard', staleUntil: Date.now() + 60000, response: { success: true, data: { total: 5 } } },
    { key: 'k_res', ns: 'ns1', scope: 'reservations', staleUntil: Date.now() + 60000, response: { success: true, data: { total: 5 } } }
  ]);

  // First boot sync check with epoch v1 -> purges stale KV & saves META
  const res1 = await idb.enforceBootSyncCheck('ns1', async () => ({
    reservationsCount: 5,
    lastSyncAt: '2026-11-20T01:00:00Z',
    syncEpoch: 'ep-1'
  }));
  assert.equal(res1.verified, true);
  assert.equal(res1.epochChanged, true);
  assert.equal(res1.invalidated, true);
  assert.equal(res1.status, 'stale_purged');
  const snapAfter1 = await idb.loadNamespaceSnapshot('ns1');
  assert.equal(snapAfter1.kvEntries.length, 0);
  assert.equal(snapAfter1.meta.lastServerEpoch, 'ep-1');

  // Re-populate KV and verify same epoch stays synchronized without purging
  await idb.putKvEntries([
    { key: 'k_dash2', ns: 'ns1', scope: 'dashboard', staleUntil: Date.now() + 60000, response: { success: true, data: { total: 5 } } }
  ]);
  const res2 = await idb.enforceBootSyncCheck('ns1', async () => ({
    reservationsCount: 5,
    lastSyncAt: '2026-11-20T01:00:00Z',
    syncEpoch: 'ep-1'
  }), { force: true });
  assert.equal(res2.verified, true);
  assert.equal(res2.epochChanged, false);
  assert.equal(res2.invalidated, false);
  assert.equal(res2.status, 'synchronized');
  const snapAfter2 = await idb.loadNamespaceSnapshot('ns1');
  assert.equal(snapAfter2.kvEntries.length, 1);

  // Offline probe falls back gracefully without wiping cached data
  const resOffline = await idb.enforceBootSyncCheck('ns1', async () => {
    throw new Error('network down');
  }, { force: true });
  assert.equal(resOffline.offlineFallback, true);
  assert.equal(resOffline.status, 'offline_fallback');

  // Full cache wipe preserves auth token + per-user prefs while clearing CacheStorage, SW, session & stale overrides
  const wiped = await idb.wipeAllCaches({ preserveAuth: true, unregisterServiceWorkers: true });
  assert.deepEqual(clearedCaches, ['rg-cache-v1', 'static-v2']);
  assert.equal(wiped.cacheStorage, 2);
  assert.equal(wiped.serviceWorkers, 1);
  assert.equal(unregisteredSw.length, 1);
  assert.ok(removedSession.includes('rg_crm_swr_v1'));
  assert.equal(sessionMap.get('other_key'), 'keep');
  assert.ok(removedLocal.includes('rg_crm_gas_url'));
  assert.ok(removedLocal.includes('rg_crm_swr_v1'));
  assert.equal(localMap.get('rg_crm_session_token'), 'tok_keep');
  assert.equal(localMap.get('rg_crm_user_prefs_u_emp1'), '{"theme":"dark"}');
});

test('Per-employee UI customization persistence: theme, lang, sidebarCollapsed, timeFormat, sidebarPosition, navOrder, dashHidden isolated per employee ID', async () => {
  const db = createInMemoryMockExecutor();
  const adminLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(adminLogin.success, true);
  const adminToken = adminLogin.data.token;

  const agentLogin = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'agent1', password: process.env.RG_SEED_AGENT_PASSWORD || 'Agent@123' }
  });
  assert.equal(agentLogin.success, true);
  const agentToken = agentLogin.data.token;

  const saveAdmin = await dispatchCrmRequest(db, {
    action: 'saveUserLayoutPrefs',
    token: adminToken,
    payload: {
      theme: 'dark',
      lang: 'en',
      sidebarCollapsed: true,
      timeFormat: '12h',
      sidebarPosition: 'top',
      hiddenRoutes: ['activity'],
      dashHidden: ['radar']
    }
  });
  assert.equal(saveAdmin.success, true);
  assert.equal(saveAdmin.data.layoutPrefs.theme, 'dark');
  assert.equal(saveAdmin.data.layoutPrefs.lang, 'en');
  assert.equal(saveAdmin.data.layoutPrefs.sidebarCollapsed, true);
  assert.equal(saveAdmin.data.layoutPrefs.timeFormat, '12h');
  assert.equal(saveAdmin.data.layoutPrefs.sidebarPosition, 'top');

  // Check admin getMe & getAppBootstrap restore admin customizations
  const adminMe = await dispatchCrmRequest(db, { action: 'getMe', token: adminToken });
  assert.equal(adminMe.success, true);
  assert.equal(adminMe.data.layoutPrefs.theme, 'dark');
  assert.equal(adminMe.data.layoutPrefs.lang, 'en');
  assert.equal(adminMe.data.layoutPrefs.sidebarCollapsed, true);

  const adminBoot = await dispatchCrmRequest(db, { action: 'getAppBootstrap', token: adminToken, payload: { range: '30d' } });
  assert.equal(adminBoot.success, true);
  assert.equal(adminBoot.data.layoutPrefs.theme, 'dark');
  assert.equal(adminBoot.data.layoutPrefs.sidebarCollapsed, true);

  // Check agent1 remains completely isolated (keeps default preferences)
  const agentMe = await dispatchCrmRequest(db, { action: 'getMe', token: agentToken });
  assert.equal(agentMe.success, true);
  assert.equal(agentMe.data.layoutPrefs.theme, '');
  assert.equal(agentMe.data.layoutPrefs.lang, '');
  assert.equal(agentMe.data.layoutPrefs.sidebarCollapsed, false);
  assert.equal(agentMe.data.layoutPrefs.timeFormat, '24h');
  assert.equal(agentMe.data.layoutPrefs.sidebarPosition, 'side');
});

test('API routing guards: vercel.json never rewrites /api/* to index.html or self-rewrites /api/(.*), server.ts guards /api, and RGApi handles HTML/unconfigured health cleanly', async () => {
  const vercelCfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8'));
  const rewrites: Array<{ source: string; destination: string }> = vercelCfg.rewrites || [];

  // Must NOT self-rewrite /api/(.*) -> /api/$1 (causes Vercel static output routing miss -> index.html HTTP 200)
  assert.equal(
    rewrites.some((r) => String(r.source || '').includes('/api/') || String(r.destination || '').includes('/api/')),
    false,
    'vercel.json must not contain /api/ rewrites that interfere with Vercel Serverless Functions'
  );

  // SPA fallback rewrite must exist and MUST NOT match /api, /api/crm, /api/health, or /api/sync
  const spaRewrite = rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spaRewrite, 'vercel.json must include an SPA fallback rewrite to /index.html');
  const spaRegex = new RegExp(`^${spaRewrite.source}$`);
  for (const apiPath of ['/api', '/api/', '/api/crm', '/api/health', '/api/sync', '/api/crm/extra']) {
    assert.equal(spaRegex.test(apiPath), false, `SPA rewrite must NOT match ${apiPath}`);
  }
  assert.equal(spaRegex.test('/reservations'), true, 'SPA rewrite must still match client routes');

  const apiHeaderRule = (vercelCfg.headers || []).find((h: any) => h.source === '/api/(.*)');
  assert.ok(apiHeaderRule, 'vercel.json must configure Cache-Control headers for /api/(.*)');

  // server.ts must isolate /api with JSON 404 before vite.middlewares / static SPA fallback
  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  const apiGuardIdx = serverSrc.indexOf("app.use('/api'");
  const viteIdx = serverSrc.indexOf('vite.middlewares');
  assert.ok(apiGuardIdx !== -1 && viteIdx !== -1 && apiGuardIdx < viteIdx, 'server.ts must register /api JSON 404 guard before vite.middlewares');

  // vite.config.ts Workbox navigateFallbackDenylist must exclude /api and /api/*
  const viteCfgSrc = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  assert.ok(viteCfgSrc.includes('navigateFallbackDenylist'), 'vite.config.ts must define navigateFallbackDenylist');
  assert.ok(/navigateFallbackDenylist:\s*\[[^\]]*api/.test(viteCfgSrc), 'navigateFallbackDenylist must exclude /api routes');

  // Verify frontend RGApi behavior when /api/health returns HTML (HTTP 200 SPA fallback) or databaseConfigured: false
  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const idbSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/idb.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');

  const createMemStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); }
    };
  };

  function bootWithHealthResponse(healthResp: { ok: boolean; status: number; contentType: string; body: string }, crmResp?: { ok: boolean; status: number; contentType: string; body: string }) {
    const calls: string[] = [];
    const ctx: any = {
      console, Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Set, Map, RegExp, URL,
      setTimeout, clearTimeout,
      CustomEvent: class CustomEvent { type: string; detail: any; constructor(t: string, i?: any) { this.type = t; this.detail = i?.detail; } },
      document: { dispatchEvent() {} },
      localStorage: createMemStorage(),
      sessionStorage: createMemStorage(),
      RG_APP_CONFIG: { mode: 'neon', backendApiUrl: '/api/crm', gasWebAppUrl: '' },
      location: { protocol: 'https:', hostname: 'crm.example.vercel.app', origin: 'https://crm.example.vercel.app', search: '', href: 'https://crm.example.vercel.app/', pathname: '/', hash: '' },
      history: { replaceState() {} },
      fetch: async (url: string) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/api/health')) {
          return {
            ok: healthResp.ok,
            status: healthResp.status,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? healthResp.contentType : null) },
            text: async () => healthResp.body
          };
        }
        if (u.includes('/api/crm') && crmResp) {
          return {
            ok: crmResp.ok,
            status: crmResp.status,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? crmResp.contentType : null) },
            text: async () => crmResp.body
          };
        }
        throw new Error('UNEXPECTED_FETCH:' + u);
      }
    };
    ctx.window = ctx;
    vm.runInNewContext(coreSrc, ctx);
    vm.runInNewContext(idbSrc, ctx);
    vm.runInNewContext(apiSrc, ctx);
    return { ctx, calls };
  }

  // Case A: Host returns index.html with HTTP 200 on /api/health and /api/crm
  const htmlEnv = bootWithHealthResponse(
    { ok: true, status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body>SPA</body></html>' },
    { ok: true, status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body>SPA</body></html>' }
  );
  await htmlEnv.ctx.RGApi.ready();
  assert.equal(htmlEnv.ctx.RGApi.getBackendApiUrl(), '');
  assert.equal(htmlEnv.ctx.RGApi.isBackendConnected(), false);

  // Regular API calls fall back cleanly to local Sandbox instead of hitting /api/crm and failing on HTML
  const sandboxLogin = await htmlEnv.ctx.RGApi.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(sandboxLogin.success, true);
  assert.equal(htmlEnv.calls.some((u) => u.includes('/api/crm')), false);

  // Explicit health & DB diagnostics handle HTML without throwing JSON.parse SyntaxError
  const healthHtmlDiag = await htmlEnv.ctx.RGApi.testServerHealth();
  assert.equal(healthHtmlDiag.success, false);
  assert.equal(healthHtmlDiag.error, 'HTML_RESPONSE');
  assert.equal(healthHtmlDiag.data.htmlFallback, true);

  const dbHtmlDiag = await htmlEnv.ctx.RGApi.testDatabaseHealth();
  assert.equal(dbHtmlDiag.success, false);
  assert.equal(dbHtmlDiag.error, 'HTML_RESPONSE');
  assert.equal(dbHtmlDiag.data.htmlFallback, true);

  // Case B: Server /api/health works and reports databaseConfigured: false (local dev without DATABASE_URL)
  const noDbEnv = bootWithHealthResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, mode: 'neon', databaseConfigured: false, connected: false, backendApiUrl: '', serverlessProxyAvailable: true })
  });
  await noDbEnv.ctx.RGApi.ready();
  assert.equal(noDbEnv.ctx.RGApi.getBackendApiUrl(), '');
  assert.equal(noDbEnv.ctx.RGApi.isBackendConnected(), false);
  const noDbHealth = await noDbEnv.ctx.RGApi.testServerHealth();
  assert.equal(noDbHealth.success, true);
  assert.ok(noDbHealth.message.includes('DATABASE_URL'));
});

test('backend getReservations filters by exact effective end date when dateTo is provided without dateFrom', async () => {
  const executor = createInMemoryMockExecutor();
  await dispatchCrmRequest(executor, { action: 'ping' });
  const loginRes = await dispatchCrmRequest(executor, {
    action: 'login',
    payload: { username: 'Admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  const now = new Date();
  executor.state.reservations.push(
    {
      id: 'RES_END_1',
      reservation_number: '1001',
      customer_name: 'عميل 1',
      start_date: '2026-11-10',
      end_date: '2026-11-20',
      original_end_date: '2026-11-20',
      extended_until_date: '',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: now,
      updated_at: now
    },
    {
      id: 'RES_END_2',
      reservation_number: '1002',
      customer_name: 'عميل 2',
      start_date: '2026-11-12',
      end_date: '2026-11-20',
      original_end_date: '2026-11-20',
      extended_until_date: '2026-11-24',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: now,
      updated_at: now
    },
    {
      id: 'RES_END_3',
      reservation_number: '1003',
      customer_name: 'عميل 3',
      start_date: '2026-11-15',
      end_date: '2026-11-19',
      original_end_date: '2026-11-19',
      extended_until_date: '',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: now,
      updated_at: now
    }
  );

  const endOnly20 = await dispatchCrmRequest(executor, {
    action: 'getReservations',
    token,
    payload: { dateFrom: '', dateTo: '2026-11-20' }
  });
  assert.equal(endOnly20.success, true);
  assert.deepEqual(endOnly20.data.items.map((x: any) => x.id), ['RES_END_1']);
  assert.equal(endOnly20.data.total, 1);

  const endOnly24 = await dispatchCrmRequest(executor, {
    action: 'getReservations',
    token,
    payload: { dateFrom: '', dateTo: '2026-11-24' }
  });
  assert.equal(endOnly24.success, true);
  assert.deepEqual(endOnly24.data.items.map((x: any) => x.id), ['RES_END_2']);

  const rangeRes = await dispatchCrmRequest(executor, {
    action: 'getReservations',
    token,
    payload: { dateFrom: '2026-11-10', dateTo: '2026-11-14' }
  });
  assert.equal(rangeRes.success, true);
  assert.deepEqual(rangeRes.data.items.map((x: any) => x.id).sort(), ['RES_END_1', 'RES_END_2']);
});

test('dedicated reservationNumber search filter works in core.js, reservations.js UI, and backend getReservations', async () => {
  const coreSrc = fs.readFileSync(path.join(process.cwd(), 'assets/js/core.js'), 'utf8');
  const resJsSrc = fs.readFileSync(path.join(process.cwd(), 'assets/js/reservations.js'), 'utf8');

  assert.ok(resJsSrc.includes('id="res-number-search"'), 'reservations.js must render #res-number-search input');
  assert.ok(resJsSrc.includes('class="rg-res-search-row"'), 'reservations.js must group search fields in .rg-res-search-row');

  const coreCtx: any = { window: {} };
  coreCtx.window = coreCtx;
  vm.runInNewContext(coreSrc, coreCtx);
  const core = coreCtx.RGCrmCore;

  const built = core.buildReservationQueryPayload({ search: 'أحمد', reservationNumber: ' #RG-204 ' });
  assert.equal(built.search, 'أحمد');
  assert.equal(built.reservationNumber, '#RG-204');
  assert.equal(core.hasActiveReservationFilters({ reservationNumber: '204' }), true);
  assert.equal(core.hasActiveReservationFilters({}), false);

  const sampleList = [
    { id: 'R1', reservationNumber: 'RG-1001', customerName: 'أحمد علي', customerPhone: '0501111111', assignedEmployeeIds: [] },
    { id: 'R2', reservationNumber: 'RG-2045', customerName: 'أحمد سعيد', customerPhone: '0502222222', assignedEmployeeIds: [] },
    { id: 'R3', reservationNumber: 'RG-2049', customerName: 'خالد محمد', customerPhone: '0502045000', assignedEmployeeIds: [] }
  ];

  // Filtering by reservationNumber matches only reservationNumber (not phone '0502045000')
  const byNumOnly = core.filterReservations(sampleList, [], { reservationNumber: '#204' });
  assert.deepEqual(Array.from(byNumOnly, (x: any) => x.id).sort(), ['R2', 'R3']);

  // Arabic numerals normalization in reservationNumber
  const byArabicDigits = core.filterReservations(sampleList, [], { reservationNumber: '١٠٠١' });
  assert.deepEqual(Array.from(byArabicDigits, (x: any) => x.id), ['R1']);

  // Combined general search + reservationNumber filter
  const combined = core.filterReservations(sampleList, [], { search: 'أحمد', reservationNumber: '204' });
  assert.deepEqual(Array.from(combined, (x: any) => x.id), ['R2']);

  // Backend SQL / mock executor support
  const executor = createInMemoryMockExecutor();
  await dispatchCrmRequest(executor, { action: 'ping' });
  const loginRes = await dispatchCrmRequest(executor, {
    action: 'login',
    payload: { username: 'Admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  const now = new Date();
  executor.state.reservations.push(
    {
      id: 'RES_NUM_1',
      reservation_number: 'RG-5501',
      customer_name: 'عميل خمسة',
      customer_phone: '0550000001',
      start_date: '2026-11-20',
      end_date: '2026-11-22',
      original_end_date: '2026-11-22',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: now,
      updated_at: now
    },
    {
      id: 'RES_NUM_2',
      reservation_number: 'RG-7788',
      customer_name: 'عميل سبعة',
      customer_phone: '0555501000',
      start_date: '2026-11-20',
      end_date: '2026-11-22',
      original_end_date: '2026-11-22',
      internal_status: 'مؤكد',
      priority: 'عادي',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      created_at: now,
      updated_at: now
    }
  );

  const backendRes = await dispatchCrmRequest(executor, {
    action: 'getReservations',
    token,
    payload: { reservationNumber: '#5501' }
  });
  assert.equal(backendRes.success, true);
  assert.deepEqual(backendRes.data.items.map((x: any) => x.id), ['RES_NUM_1']);
});

test('Booking order matches Rental Gate source sequence across pull, pagination, updates, re-pull, core, and IDB hydration', async () => {
  // Exact reference sequence from Screenshot 1 (non-monotonic IDs and startDates)
  const expectedSequence = ['1159', '1156', '1139', '1138', '1133', '1131', '1128', '1123', '1117', '1116'];
  const startDates: Record<string, string> = {
    '1159': '2026-11-24T17:30:00',
    '1156': '2026-11-23T23:00:00',
    '1139': '2026-11-23T17:59:00',
    '1138': '2026-11-23T17:40:00',
    '1133': '2026-11-23T16:15:00',
    '1131': '2026-11-23T13:30:00',
    '1128': '2026-11-24T09:30:00',
    '1123': '2026-11-23T13:00:00',
    '1117': '2026-11-22T21:33:00',
    '1116': '2026-11-26T11:00:00'
  };

  const makeSourcePageItem = (num: string) => ({
    id: Number(num),
    reservationNumber: num,
    clientName: `Customer ${num}`,
    clientMobile: `+96650000${num}`,
    companyArName: 'AlRehab',
    receiveBranchArName: 'الرياض',
    carNameAr: 'تويوتا يارس 2024',
    startDate: startDates[num] || '2026-11-23T10:00:00',
    endDate: '2026-11-27T10:00:00',
    reservationDays: 2,
    reservationStatus: 2,
    total: 350
  });

  const db = createInMemoryMockExecutor();
  await dispatchCrmRequest(db, { action: 'ping' });
  const loginRes = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_order_12345';

  let activeSnapshotNums = expectedSequence.slice();
  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/reservations/filter')) {
      const page = Number(u.searchParams.get('page') || '0');
      const chunkSize = 5;
      const start = page * chunkSize;
      const items = activeSnapshotNums.slice(start, start + chunkSize).map(makeSourcePageItem);
      const totalPages = Math.ceil(activeSnapshotNums.length / chunkSize);
      const bodyObj = {
        data: {
          items,
          totalItems: activeSnapshotNums.length,
          totalPages,
          last: page + 1 >= totalPages
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => bodyObj,
        text: async () => JSON.stringify(bodyObj)
      } as any;
    }
    const emptyObj = { data: { items: [], totalItems: 0, totalPages: 1, last: true } };
    return {
      ok: true,
      status: 200,
      json: async () => emptyObj,
      text: async () => JSON.stringify(emptyObj)
    } as any;
  }) as any;

  try {
    // 1) Multi-page pull preserves exact source sequence
    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 5 },
      mockFetch
    );
    assert.equal(pullRes.fetchedCount, 10);
    // 2 pages reservations/filter + 1 extension + 1 cancelled + 1 company-changes = 5
    assert.equal(pullRes.pagesFetched, 5);
    assert.equal(pullRes.importedCount, 10);

    const p1 = await dispatchCrmRequest(db, { action: 'getReservations', token, payload: { page: 1, pageSize: 5 } });
    const p2 = await dispatchCrmRequest(db, { action: 'getReservations', token, payload: { page: 2, pageSize: 5 } });
    assert.deepEqual(p1.data.items.map((x: any) => x.reservationNumber), expectedSequence.slice(0, 5));
    assert.deepEqual(p2.data.items.map((x: any) => x.reservationNumber), expectedSequence.slice(5, 10));

    // 2) Mutating a row later in the list (1116) bumps updated_at, yet source order remains unchanged
    const res1116 = db.state.reservations.find((r) => r.reservation_number === '1116');
    assert.ok(res1116);
    const mutRes = await dispatchCrmRequest(db, {
      action: 'quickUpdateReservationStatus',
      token,
      payload: { reservationId: res1116.id, status: 'تم التسليم' }
    });
    assert.equal(mutRes.success, true);

    const afterMutAll = await dispatchCrmRequest(db, { action: 'getReservations', token, payload: { page: 1, pageSize: 20 } });
    assert.deepEqual(afterMutAll.data.items.map((x: any) => x.reservationNumber), expectedSequence);

    // 3) syncLocalCache also returns exact source sequence
    const syncCacheRes = await dispatchCrmRequest(db, { action: 'syncLocalCache', token, payload: {} });
    assert.equal(syncCacheRes.success, true);
    assert.deepEqual(syncCacheRes.data.reservations.map((x: any) => x.reservationNumber), expectedSequence);

    // 4) Full re-pull when a new booking (1160) arrives at source top & an old one (1117) leaves
    activeSnapshotNums = ['1160', '1159', '1156', '1139', '1138', '1133', '1131', '1128', '1123', '1116'];
    const repullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 5 },
      mockFetch
    );
    assert.equal(repullRes.fetchedCount, 10);
    const afterRepull = await dispatchCrmRequest(db, { action: 'getReservations', token, payload: { page: 1, pageSize: 20 } });
    assert.deepEqual(
      afterRepull.data.items.map((x: any) => x.reservationNumber),
      ['1160', '1159', '1156', '1139', '1138', '1133', '1131', '1128', '1123', '1116', '1117']
    );
    const removedRow = db.state.reservations.find((r) => r.reservation_number === '1117');
    assert.equal(removedRow?.source_order, null);
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }

  // 5) Frontend core.js & idb.js preserve exact sourceOrder even when IDB key order scrambles keys lexicographically
  const coreSrc = fs.readFileSync(path.join(process.cwd(), 'assets/js/core.js'), 'utf8');
  const idbSrc = fs.readFileSync(path.join(process.cwd(), 'assets/js/idb.js'), 'utf8');
  const winCtx: any = { window: {} as any, Date, Math, JSON, Array, Object, Number, String, Boolean, isFinite };
  winCtx.window = winCtx;
  vm.runInNewContext(coreSrc, winCtx);
  vm.runInNewContext(idbSrc, winCtx);

  const clientOrdered = expectedSequence.map((num, idx) => ({
    id: `RES_${num}`,
    reservationNumber: num,
    sourceOrder: idx + 1,
    customerName: `Customer ${num}`,
    startDate: startDates[num],
    lastUpdatedAt: num === '1116' ? '2026-11-30T23:59:59Z' : '2026-11-23T00:00:00Z'
  }));

  // Shuffle into lexicographic nsId order and verify core.filterReservations restores sourceOrder
  const scrambled = clientOrdered.slice().sort((a, b) => a.id.localeCompare(b.id));
  const filteredDefault = winCtx.RGCrmCore.filterReservations(scrambled, [], {});
  assert.deepEqual(Array.from(filteredDefault, (x: any) => x.reservationNumber), expectedSequence);

  // Delta update on 1116 without sourceOrder preserves 1116 at position 10 (end)
  const deltaUpdated = winCtx.RGCrmCore.reapplyReservationDeltaToFilteredList(
    filteredDefault,
    [{ id: 'RES_1116', internalStatus: 'تم التسليم', lastUpdatedAt: '2026-12-01T00:00:00Z' }],
    [],
    {}
  );
  assert.deepEqual(Array.from(deltaUpdated.items, (x: any) => x.reservationNumber), expectedSequence);

  // IDB snapshot stores and loads back in sourceOrder
  await winCtx.RGIdbCache.replaceReservationsSnapshot('test_ns', scrambled.slice().reverse(), [], {});
  const loadedSnap = await winCtx.RGIdbCache.loadNamespaceSnapshot('test_ns');
  assert.deepEqual(Array.from(loadedSnap.reservations, (x: any) => x.reservationNumber), expectedSequence);
});

test('Pagination never skips page=1 when 0-based API returns current_page=1, syncs exact 40 cancelled & 58 rejected, and reconciles stale internal_status', async () => {
  const db = createInMemoryMockExecutor();
  await dispatchCrmRequest(db, { action: 'ping' });
  const loginRes = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  // Pre-seed 3 bookings that had stale 'تم الإلغاء' internal_status even though external status is 'confirmed'
  // (simulating the exact +3 extra cancelled bug) + 1 'غير متاح' placeholder reason
  const now = new Date();
  for (let i = 1; i <= 3; i++) {
    db.state.reservations.push({
      id: `RES_STALE_${i}`,
      source_reservation_id: `${90000 + i}`,
      reservation_number: `STALE-${i}`,
      customer_name: `عميل مسترجع ${i}`,
      original_status_code: 'confirmed',
      original_status_ar: 'تم التأكيد',
      internal_status: 'تم الإلغاء',
      cancelled_at: '2026-11-10T10:00:00Z',
      cancellation_reason: 'غير متاح',
      assigned_employee_ids: [],
      assigned_employee_names: [],
      start_date: '2026-11-20',
      created_at: now,
      updated_at: now,
      status_history: []
    });
  }

  // Build 120 bookings at source: 40 cancelled, 58 rejected (including rejected_by_provider & object status & nested reasons), 22 confirmed
  // Across 5 pages (25 per page, 0-based ?page=0..4), while API returns misleading current_page: page + 1
  const sourceRecords: any[] = [];
  for (let i = 1; i <= 40; i++) {
    sourceRecords.push({
      id: 20000 + i,
      reservationNumber: `CAN-${String(i).padStart(3, '0')}`,
      clientName: `Cancelled Customer ${i}`,
      status: i % 2 === 0 ? 'cancelled_by_customer' : 'cancelled_by_provider',
      cancellationDetails: i <= 30 ? { reasonAr: `سبب إلغاء خاص بالحجز ${i}` } : undefined,
      startDate: '2026-11-20T10:00:00',
      total: 400 + i
    });
  }
  for (let i = 1; i <= 58; i++) {
    sourceRecords.push({
      id: 30000 + i,
      reservationNumber: `REJ-${String(i).padStart(3, '0')}`,
      clientName: `Rejected Customer ${i}`,
      reservationStatus: i % 3 === 0 ? { code: 'rejected_by_provider', ar: 'تم الرفض من المزود' } : 'rejected',
      rejection: i <= 44 ? { reason: `سبب رفض خاص بالحجز ${i}` } : undefined,
      rejectionReason: i > 44 ? 'غير متاح' : undefined,
      startDate: '2026-11-20T10:00:00',
      total: 500 + i
    });
  }
  for (let i = 1; i <= 22; i++) {
    sourceRecords.push({
      id: 40000 + i,
      reservationNumber: `ACT-${String(i).padStart(3, '0')}`,
      clientName: `Active Customer ${i}`,
      status: 'confirmed',
      startDate: '2026-11-20T10:00:00',
      total: 600 + i
    });
  }

  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_40_58';
  const fetchedFilterPages: number[] = [];

  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/reservations/filter')) {
      const page = Number(u.searchParams.get('page') || '0');
      fetchedFilterPages.push(page);
      const pageSize = 25;
      const items = sourceRecords.slice(page * pageSize, (page + 1) * pageSize);
      const totalPages = Math.ceil(sourceRecords.length / pageSize);
      const bodyObj = {
        data: {
          items,
          current_page: page + 1, // Deliberately 1-based metadata on a 0-based ?page endpoint!
          last_page: totalPages,
          totalItems: sourceRecords.length
        }
      };
      return { ok: true, status: 200, json: async () => bodyObj, text: async () => JSON.stringify(bodyObj) } as any;
    }
    const emptyObj = { data: { items: [], totalItems: 0, totalPages: 1 } };
    return { ok: true, status: 200, json: async () => emptyObj, text: async () => JSON.stringify(emptyObj) } as any;
  }) as any;

  try {
    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 10 },
      mockFetch
    );
    // Page 1 MUST have been requested & not skipped!
    assert.ok(fetchedFilterPages.includes(0));
    assert.ok(fetchedFilterPages.includes(1), `Expected ?page=1 to be fetched, got: ${fetchedFilterPages.join(',')}`);
    assert.equal(pullRes.fetchedCount, 120);

    // Check getReservations lifecycleCounts & getDashboard KPI counts match exact 40 cancelled & 58 rejected
    const listRes = await dispatchCrmRequest(db, {
      action: 'getReservations',
      token,
      payload: { lifecycle: 'active', page: 1, pageSize: 25 }
    });
    assert.equal(listRes.success, true);
    assert.equal(listRes.data.lifecycleCounts.cancelled, 40);
    assert.equal(listRes.data.lifecycleCounts.rejected, 58);
    assert.equal(listRes.data.lifecycleCounts.active, 25); // 22 active + 3 stale records whose external status was confirmed

    const dashRes = await dispatchCrmRequest(db, {
      action: 'getDashboard',
      token,
      payload: { forceRefresh: true }
    });
    assert.equal(dashRes.success, true);
    assert.equal(dashRes.data.kpis.cancelled, 40);
    assert.equal(dashRes.data.kpis.rejected, 58);

    // Verify per-booking reason accuracy and placeholder scrubbing
    const rej1 = db.state.reservations.find((r) => r.reservation_number === 'REJ-001');
    const rej45 = db.state.reservations.find((r) => r.reservation_number === 'REJ-045');
    const can1 = db.state.reservations.find((r) => r.reservation_number === 'CAN-001');
    const can31 = db.state.reservations.find((r) => r.reservation_number === 'CAN-031');
    assert.equal(rej1?.rejection_reason, 'سبب رفض خاص بالحجز 1');
    assert.equal(rej45?.rejection_reason, ''); // 'غير متاح' placeholder scrubbed, not kept
    assert.equal(can1?.cancellation_reason, 'سبب إلغاء خاص بالحجز 1');
    assert.equal(can31?.cancellation_reason, '');
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('Clamped 1-based pagination probes page=1 then advances to page=2 without stalling or skipping', async () => {
  const db = createInMemoryMockExecutor();
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_clamped';
  const requestedPages: number[] = [];

  const p1Items = Array.from({ length: 10 }, (_, idx) => ({
    id: 5000 + idx,
    reservationNumber: `C1-${idx + 1}`,
    clientName: `Customer ${idx + 1}`,
    status: 'rejected',
    rejectionReason: `Reason C1-${idx + 1}`,
    startDate: '2026-11-20'
  }));
  const p2Items = Array.from({ length: 8 }, (_, idx) => ({
    id: 5100 + idx,
    reservationNumber: `C2-${idx + 1}`,
    clientName: `Customer 2-${idx + 1}`,
    status: 'rejected',
    rejectionReason: `Reason C2-${idx + 1}`,
    startDate: '2026-11-20'
  }));

  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/reservations/filter')) {
      const page = Number(u.searchParams.get('page') || '0');
      requestedPages.push(page);
      // Clamped 1-based behavior: page=0 and page=1 return page 1 items, page=2 returns page 2 items, page>=3 returns empty
      const items = page <= 1 ? p1Items : (page === 2 ? p2Items : []);
      const bodyObj = { data: { items, totalItems: 18, current_page: page <= 1 ? 1 : page, last_page: 2 } };
      return { ok: true, status: 200, json: async () => bodyObj, text: async () => JSON.stringify(bodyObj) } as any;
    }
    const emptyObj = { data: { items: [], totalItems: 0 } };
    return { ok: true, status: 200, json: async () => emptyObj, text: async () => JSON.stringify(emptyObj) } as any;
  }) as any;

  try {
    const pullRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 6 },
      mockFetch
    );
    assert.equal(pullRes.fetchedCount, 18);
    assert.deepEqual(requestedPages.slice(0, 3), [0, 1, 2]);
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('Authoritative /admin/cancelled-reservations & /reservation-company-changes/admin/filter resolve dual & reassigned overlaps into mutually exclusive 15 active, 40 cancelled, and 47 rejected (total 102)', async () => {
  const db = createInMemoryMockExecutor();
  await dispatchCrmRequest(db, { action: 'ping' });
  const loginRes = await dispatchCrmRequest(db, {
    action: 'login',
    payload: { username: 'Admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' }
  });
  assert.equal(loginRes.success, true);
  const token = loginRes.data.token;

  // Build exact production-matching shape (mutually exclusive lifecycle partition):
  // - 34 pure CANCELLED (in reservations/filter + cancelled-reservations -> Cancelled)
  // - 3 CANCELLED that moved to REFUND_PROCESSED/REJECTED_BY_COMPANY (excluded from cancelled-reservations, present in company-changes -> Rejected)
  // - 6 CANCELLED with cancelledFromDecline=true (present in BOTH cancelled-reservations AND company-changes -> count strictly in Cancelled, never double-counted in Rejected)
  // - 44 DECLINED (present in company-changes -> Rejected)
  // - 5 FINISHED with COMPANY_CHANGED (present in company-changes -> Active/Eligible! Must never be excluded)
  // - 10 normal active CONFIRMED bookings -> Active/Eligible
  // Total = 102 unique bookings -> 15 Active/Eligible, 40 Cancelled, 47 Rejected (15 + 40 + 47 = 102)
  const filterItems: any[] = [];
  const cancelledItems: any[] = [];
  const rccItems: any[] = [];

  for (let i = 1; i <= 34; i++) {
    const id = 1000 + i;
    filterItems.push({ reservationId: id, clientName: `Pure Can ${i}`, reservationStatus: 'CANCELLED', startDate: '2026-11-20T10:00:00', total: 200 });
    cancelledItems.push({ reservationId: id, reservationNumber: `RG-CAN-${id}`, cancelledFromDecline: false, cancellationReasonArabic: `سبب إلغاء ${i}`, paid: 200 });
  }
  for (let i = 1; i <= 3; i++) {
    const id = 2000 + i;
    filterItems.push({ reservationId: id, clientName: `Refund Rej ${i}`, reservationStatus: 'CANCELLED', startDate: '2026-11-20T10:00:00', total: 300 });
    rccItems.push({ id: 900 + i, reservationId: id, reservationNumber: `RG-REF-${id}`, status: 'REFUND_PROCESSED', reason: 'REJECTED_BY_COMPANY', clientRefundAmount: 300 });
  }
  for (let i = 1; i <= 6; i++) {
    const id = 3000 + i;
    filterItems.push({ reservationId: id, clientName: `Dual ${i}`, reservationStatus: 'CANCELLED', startDate: '2026-11-20T10:00:00', total: 400 });
    cancelledItems.push({ reservationId: id, reservationNumber: `RG-DUAL-${id}`, cancelledFromDecline: true, cancellationReasonArabic: 'تم رفضه وإلغاؤه', paid: 400 });
    rccItems.push({ id: 800 + i, reservationId: id, reservationNumber: `RG-DUAL-${id}`, status: 'CLIENT_CANCELLED', reason: 'REJECTED_BY_COMPANY', targetCompanyName: 'Alghazal', confirmedByUserName: 'مشرف اختبار' });
  }
  for (let i = 1; i <= 44; i++) {
    const id = 4000 + i;
    filterItems.push({ reservationId: id, clientName: `Declined ${i}`, reservationStatus: 'DECLINED', startDate: '2026-11-20T10:00:00', total: 500 });
    rccItems.push({ id: 700 + i, reservationId: id, reservationNumber: `RG-DEC-${id}`, status: 'REFUND_PROCESSED', reason: 'REJECTED_BY_COMPANY', details: `رفض ${i}` });
  }
  for (let i = 1; i <= 5; i++) {
    const id = 5000 + i;
    filterItems.push({ reservationId: id, clientName: `Reassigned Fin ${i}`, reservationStatus: 'FINISHED', startDate: '2026-11-20T10:00:00', total: 600 });
    rccItems.push({ id: 600 + i, reservationId: id, reservationNumber: `RG-FIN-${id}`, status: 'COMPANY_CHANGED', reason: i <= 3 ? 'REJECTED_BY_COMPANY' : 'TIME_OUT', targetCompanyName: 'Almaqam' });
  }
  for (let i = 1; i <= 10; i++) {
    const id = 6000 + i;
    filterItems.push({ reservationId: id, clientName: `Active ${i}`, reservationStatus: 'CONFIRMED', startDate: '2026-11-20T10:00:00', total: 700 });
  }

  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_authoritative_overlap';

  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('page') || '0');
    const jsonResp = (rows: any[], total: number) => ({
      ok: true,
      status: 200,
      json: async () => ({ content: page === 0 ? rows : [], totalElements: total, totalPages: 1, last: true }),
      text: async () => JSON.stringify({ content: page === 0 ? rows : [], totalElements: total, totalPages: 1, last: true })
    }) as any;
    if (u.pathname.includes('/reservations/filter')) return jsonResp(filterItems, filterItems.length);
    if (u.pathname.includes('/admin/cancelled-reservations')) return jsonResp(cancelledItems, cancelledItems.length);
    if (u.pathname.includes('/reservation-company-changes/admin/filter')) return jsonResp(rccItems, rccItems.length);
    return jsonResp([], 0);
  }) as any;

  try {
    await pullFromRentalGateDirect(db, { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' }, { maxPages: 5 }, mockFetch);
    assert.equal(db.state.reservations.length, 102);

    const [activeRes, allRes, rejRes, canRes, dashRes, inactRej, inactCan] = await Promise.all([
      dispatchCrmRequest(db, { action: 'getReservations', token, payload: { lifecycle: 'active', page: 1, pageSize: 200 } }),
      dispatchCrmRequest(db, { action: 'getReservations', token, payload: { lifecycle: 'all', page: 1, pageSize: 200 } }),
      dispatchCrmRequest(db, { action: 'getReservations', token, payload: { lifecycle: 'rejected', page: 1, pageSize: 200 } }),
      dispatchCrmRequest(db, { action: 'getReservations', token, payload: { lifecycle: 'cancelled', page: 1, pageSize: 200 } }),
      dispatchCrmRequest(db, { action: 'getDashboard', token, payload: { forceRefresh: true } }),
      dispatchCrmRequest(db, { action: 'getInactiveReservations', token, payload: { subTab: 'rejected', page: 1, pageSize: 200 } }),
      dispatchCrmRequest(db, { action: 'getInactiveReservations', token, payload: { subTab: 'cancelled', page: 1, pageSize: 200 } })
    ]);

    assert.equal(activeRes.data.total, 15);
    assert.equal(allRes.data.total, 102);
    assert.equal(allRes.data.lifecycleCounts.active, 15);
    assert.equal(allRes.data.lifecycleCounts.cancelled, 40);
    assert.equal(allRes.data.lifecycleCounts.rejected, 47);
    assert.equal(rejRes.data.total, 47);
    assert.equal(canRes.data.total, 40);
    assert.equal(dashRes.data.kpis.activeReservations, 15);
    assert.equal(dashRes.data.kpis.cancelled, 40);
    assert.equal(dashRes.data.kpis.rejected, 47);
    assert.equal(inactRej.data.total, 47);
    assert.equal(inactCan.data.total, 40);

    // Verify canonical mutually exclusive flags and preserved company-change audit info
    const refundRow = db.state.reservations.find((r) => r.source_reservation_id === '2001');
    assert.equal(refundRow?.is_source_cancelled, false);
    assert.equal(refundRow?.is_source_rejected, true);

    const dualRow = db.state.reservations.find((r) => r.source_reservation_id === '3001');
    assert.equal(dualRow?.is_source_cancelled, true);
    assert.equal(dualRow?.is_source_rejected, false);
    assert.equal(dualRow?.reference_number, 'RG-DUAL-3001');
    assert.equal(dualRow?.rcc_status, 'CLIENT_CANCELLED');

    const finChangedRow = db.state.reservations.find((r) => r.source_reservation_id === '5001');
    assert.equal(finChangedRow?.is_source_cancelled, false);
    assert.equal(finChangedRow?.is_source_rejected, false);
    assert.equal(finChangedRow?.rcc_status, 'COMPANY_CHANGED');
    assert.equal(finChangedRow?.new_company_name, 'Almaqam');

    // Verify sourceBreakdown & eligible reconciliation counts match 15/15 cleanly
    const pullInfo = await pullFromRentalGateDirect(db, { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' }, { maxPages: 5 }, mockFetch);
    assert.equal(pullInfo.syncComplete, true);
    assert.equal(pullInfo.status, 'success');
    assert.equal(pullInfo.totalInSource, 102);
    assert.equal(pullInfo.sourceEligibleCount, 15);
    assert.equal(pullInfo.dbEligibleCount, 15);
    assert.equal(pullInfo.eligibleCountGap, 0);
    assert.deepEqual(pullInfo.missingEligibleIds, []);
    assert.equal(pullInfo.missingLocalCount, 0);
    assert.equal(pullInfo.failedCount, 0);
    assert.equal(pullInfo.sourceBreakdown?.uniqueSourceTotal, 102);
    assert.equal(pullInfo.sourceBreakdown?.activeOrOtherCount, 15);
    assert.equal(pullInfo.sourceBreakdown?.effectiveCancelledCount, 40);
    assert.equal(pullInfo.sourceBreakdown?.effectiveRejectedCount, 47);
    assert.equal(pullInfo.sourceBreakdown?.cancelledListCount, 40);
    assert.equal(pullInfo.sourceBreakdown?.rejectedListCount, 58);
    assert.equal(pullInfo.sourceBreakdown?.dualCancelledRejectedCount, 6);
    assert.equal(pullInfo.sourceBreakdown?.reassignedActiveCount, 5);
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('Unified status classification covers all active vs cancelled/rejected variants, runs targeted auto-recovery for missing eligible IDs, and logs idempotent alerts when discrepancy persists', async () => {
  // 1) Status classification & token variants
  const activeVariants = ['finished', 'started', 'finished_by_driver', 'in_progress', 'wallet_paid', 'automatically_extended', 'paid', 'confirmed', 'received'];
  for (const st of activeVariants) {
    assert.equal(crmCore.classifyReservationLifecycle({ originalStatusCode: st, isSourceRejected: true }), 'active', `${st} must remain active even if stale isSourceRejected=true`);
    assert.equal(crmCore.isCancelledStatus({ originalStatusCode: st }), false);
    assert.equal(crmCore.isRejectedStatus({ originalStatusCode: st }), false);
  }
  const rejectedVariants = ['rejected', 'declined', 'refused', 'REJECTED_BY_COMPANY', 'مرفوض', 'مرفوضة'];
  for (const st of rejectedVariants) {
    assert.equal(crmCore.classifyReservationLifecycle({ originalStatusCode: st }), 'rejected', `${st} must classify as rejected`);
  }
  const cancelledVariants = ['cancelled', 'canceled', 'CANCELLED_BY_CUSTOMER', 'ملغي', 'ملغى', 'ملغاة'];
  for (const st of cancelledVariants) {
    assert.equal(crmCore.classifyReservationLifecycle({ originalStatusCode: st }), 'cancelled', `${st} must classify as cancelled`);
  }

  // 2) Auto-recovery recovers transient upsert failure without discrepancy
  let failOnce8801 = true;
  const recoverDb = createInMemoryMockExecutor({
    injectUpsertFailFor: (rec) => {
      if (String(rec.source_reservation_id ?? rec.sourceReservationId) === '8801' && failOnce8801) {
        failOnce8801 = false;
        return true;
      }
      return false;
    }
  });
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_recovery_and_alert';

  const makeMockFetch = (items: any[]) => (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/reservations/8801')) {
      const body = { data: { reservation: items.find((x) => String(x.reservationId) === '8801') } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
    }
    const page = Number(u.searchParams.get('page') || '0');
    const body = u.pathname.includes('/reservations/filter')
      ? { content: page === 0 ? items : [], totalElements: items.length, totalPages: 1, last: true }
      : { content: [], totalElements: 0, totalPages: 1, last: true };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;

  try {
    const resRec = await pullFromRentalGateDirect(
      recoverDb,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 3 },
      makeMockFetch([
        { reservationId: 8801, clientName: 'Recover Me', reservationStatus: 'CONFIRMED', startDate: '2026-11-24' },
        { reservationId: 8802, clientName: 'Normal Active', reservationStatus: 'FINISHED', startDate: '2026-11-24' }
      ])
    );
    assert.equal(resRec.syncComplete, true);
    assert.equal(resRec.sourceEligibleCount, 2);
    assert.equal(resRec.dbEligibleCount, 2);
    assert.equal(resRec.eligibleCountGap, 0);
    assert.equal(recoverDb.state.notifications.length, 0);

    // 3) Persistent upsert failure leaves gap after auto-recovery and triggers idempotent role alerts + error_logs
    const failDb = createInMemoryMockExecutor({
      injectUpsertFailFor: (rec) => String(rec.source_reservation_id ?? rec.sourceReservationId) === '8801'
    });
    const resFail = await pullFromRentalGateDirect(
      failDb,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { maxPages: 3 },
      makeMockFetch([
        { reservationId: 8801, clientName: 'Always Fails', reservationStatus: 'CONFIRMED', startDate: '2026-11-24' },
        { reservationId: 8802, clientName: 'Always Succeeds', reservationStatus: 'FINISHED', startDate: '2026-11-24' }
      ])
    );
    assert.equal(resFail.syncComplete, false);
    assert.equal(resFail.sourceEligibleCount, 2);
    assert.equal(resFail.dbEligibleCount, 1);
    assert.equal(resFail.eligibleCountGap, 1);
    assert.ok(resFail.missingEligibleIds.includes('8801'));
    assert.ok(failDb.state.error_logs.some((e) => e.context === 'syncService' && e.action === 'reconciliationDiscrepancy'));
    assert.equal(failDb.state.notifications.filter((n) => n.entity_type === 'Sync').length, 3);
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('Sync retries transient 503 errors, flags partial optional endpoint failures honestly, and handles >100 backfill IDs without silent cap', async () => {
  const db = createInMemoryMockExecutor();
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'rg_test_token_hardening_retry_backfill';

  // Seed 115 cancelled bookings that are NOT returned in reservations/filter (>100 cap test!)
  const cancelledList = Array.from({ length: 115 }, (_, i) => ({
    reservationId: 70000 + i,
    reservationNumber: `RG-BF-${70000 + i}`,
    cancelledFromDecline: false,
    cancellationReasonArabic: `سبب ${i}`,
    paid: 100
  }));

  let transientFilterAttempts = 0;
  let simulatePartialCancelled = true;

  const mockFetch = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/reservations/filter')) {
      const page = Number(u.searchParams.get('page') || '0');
      if (page === 0 && transientFilterAttempts === 0) {
        transientFilterAttempts++;
        return { ok: false, status: 503, text: async () => 'upstream busy' } as any;
      }
      const items = page === 0 ? [{ reservationId: 90001, clientName: 'Base 1', reservationStatus: 'CONFIRMED', startDate: '2026-11-20' }] : [];
      const bodyObj = { content: items, totalElements: 1, totalPages: 1, last: true };
      return { ok: true, status: 200, json: async () => bodyObj, text: async () => JSON.stringify(bodyObj) } as any;
    }
    if (u.pathname.includes('/admin/cancelled-reservations')) {
      const page = Number(u.searchParams.get('page') || '0');
      if (simulatePartialCancelled && page === 1) {
        // Fails permanently after retries -> page 0 succeeded, page 1 failed -> MUST flag incompleteEndpoints!
        return { ok: false, status: 500, text: async () => 'internal error page 1' } as any;
      }
      const chunk = cancelledList.slice(page * 100, (page + 1) * 100);
      const bodyObj = { content: chunk, totalElements: cancelledList.length, totalPages: 2, last: page >= 1 };
      return { ok: true, status: 200, json: async () => bodyObj, text: async () => JSON.stringify(bodyObj) } as any;
    }
    if (/\/reservations\/\d+$/.test(u.pathname)) {
      const sid = u.pathname.split('/').pop()!;
      if (sid === '70114') {
        return { ok: false, status: 404, text: async () => 'not found' } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          reservationId: Number(sid),
          clientName: `Backfilled ${sid}`,
          reservationStatus: 'CANCELLED',
          startDate: '2026-11-20'
        })
      } as any;
    }
    const emptyObj = { content: [], totalElements: 0, totalPages: 1, last: true };
    return { ok: true, status: 200, json: async () => emptyObj, text: async () => JSON.stringify(emptyObj) } as any;
  }) as any;

  try {
    // Pass 1: reservations/filter recovers from 503 retry, cancelled page 1 fails permanently -> syncComplete MUST be false & status 'partial'
    const partialRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { retryDelayMs: 0, maxRetries: 2 },
      mockFetch
    );
    assert.equal(transientFilterAttempts, 1);
    assert.equal(partialRes.status, 'partial');
    assert.equal(partialRes.syncComplete, false);
    assert.ok(partialRes.incompleteEndpoints.some((e) => e.includes('admin/cancelled-reservations')));
    assert.equal(db.state.sync_log[0].status, 'partial');
    assert.equal(db.state.sync_checkpoints[0].last_status, 'partial');

    // Pass 2: Fix cancelled page 1 -> all 115 IDs trigger chunked backfill (>100 cap removed!), 70114 404 fails backfill honestly
    simulatePartialCancelled = false;
    const backfillRes = await pullFromRentalGateDirect(
      db,
      { id: 'EMP_ADMIN', name: 'Admin', role: 'general_manager' },
      { retryDelayMs: 0, maxRetries: 1 },
      mockFetch
    );
    // 1 base + 114 backfilled = 115 saved; 1 failed backfill (70114) tracked explicitly
    assert.equal(db.state.reservations.length, 115);
    assert.deepEqual(backfillRes.backfillFailedIds, ['70114']);
    assert.equal(backfillRes.missingLocalCount, 1);
    assert.deepEqual(backfillRes.missingSourceIds, ['70114']);
    assert.equal(backfillRes.failedCount, 1);
    assert.equal(backfillRes.syncComplete, false);
    assert.equal(backfillRes.status, 'partial');
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('Per-record normalization isolation, SAVEPOINT chunk fallback, and collision protection never drop sibling records silently', async () => {
  const db = createInMemoryMockExecutor({
    injectUpsertFailFor: (rec) => rec.reservation_number === '7702'
  });

  const res = await ingestIncrementalSyncBatch(db, {
    source: 'rental_gate_direct',
    reservations: [
      { reservationId: 7701, clientName: 'Valid One', reservationStatus: 'CONFIRMED', startDate: '2026-11-20' },
      { reservationId: 7702, clientName: 'DB Fail Row', reservationStatus: 'CONFIRMED', startDate: '2026-11-20' },
      { reservationId: 7703, clientName: 'Valid Three', reservationStatus: 'CONFIRMED', startDate: '2026-11-20' },
      // Invalid row missing reservationNumber & id -> should isolate into failedRecords instead of throwing or silently vanishing
      { clientName: 'Broken No ID', reservationStatus: 'CONFIRMED' },
      // Two distinct sourceReservationIds sharing reservationNumber '7701' -> collision disambiguation saves BOTH!
      { reservationId: 7799, reservationNumber: '7701', clientName: 'Distinct Source Collision', reservationStatus: 'CONFIRMED', startDate: '2026-11-20' }
    ]
  });

  // 7701, 7703, and disambiguated 7701-7799 MUST all be saved despite 7702 failing in the chunk and Broken No ID failing normalize!
  assert.equal(res.importedCount, 3);
  assert.equal(res.savedOrUpdatedCount, 3);
  assert.equal(res.failedCount, 2);
  assert.equal(res.syncComplete, false);
  assert.equal(res.status, 'partial');
  assert.equal(res.missingLocalCount, 2); // '7702' (DB upsert failure) + Broken No ID
  assert.ok(res.missingSourceIds.includes('7702'));
  assert.ok(db.state.reservations.some((r) => r.reservation_number === '7701'));
  assert.ok(db.state.reservations.some((r) => r.reservation_number === '7703'));
  assert.ok(db.state.reservations.some((r) => r.reservation_number === '7701-7799'));
});








