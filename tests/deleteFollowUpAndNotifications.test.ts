import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import core from '../backend/coreBridge.cjs';
import { dispatchCrmRequest } from '../backend/router.js';
import { hashPassword, hashToken } from '../backend/auth.js';

function createMockExecutor() {
  const state = {
    reservations: [
      {
        id: 'RES_ACTIVE',
        reservation_number: '5001',
        customer_name: 'عميل نشط',
        customer_phone: '+966500000010',
        customer_id_number: '1010101011',
        car_name: 'Hyundai Elantra',
        car_plate: 'XYZ 555',
        branch: 'جدة',
        company: 'AlRehab',
        status_ar: 'نشط',
        status_code: 'active',
        total_amount: 500,
        start_date: '2026-11-24',
        end_date: '2026-11-26',
        internal_status: 'قيد المتابعة',
        last_update_text: 'متابعة ثانية — ملاحظة ثانية',
        last_updated_by_id: 'EMP_AGENT_A',
        last_updated_by_name: 'Agent A',
        last_updated_at: '2026-11-25T10:00:00.000Z',
        has_problem: false,
        assigned_employee_ids: ['EMP_AGENT_A'],
        assigned_employee_names: ['Agent A'],
        status_history: [],
        source_order: 1,
        created_at: new Date('2026-11-24T08:00:00Z'),
        updated_at: new Date('2026-11-25T10:00:00Z')
      },
      {
        id: 'RES_CANCELLED',
        reservation_number: '5002',
        customer_name: 'عميل ملغي',
        customer_phone: '+966500000020',
        customer_id_number: '1010101022',
        car_name: 'Kia Picanto',
        car_plate: 'CAN 111',
        branch: 'الرياض',
        company: 'AlRehab',
        status_ar: 'ملغي',
        status_code: 'cancelled',
        rcc_status: 'CANCELLED',
        total_amount: 200,
        start_date: '2026-11-24',
        end_date: '2026-11-25',
        internal_status: 'ملغي من العميل',
        last_update_text: 'تم التواصل بعد الإلغاء',
        last_updated_by_id: 'EMP_AGENT_A',
        last_updated_by_name: 'Agent A',
        last_updated_at: '2026-11-25T11:00:00.000Z',
        has_problem: false,
        assigned_employee_ids: [],
        assigned_employee_names: [],
        status_history: [],
        source_order: 2,
        created_at: new Date('2026-11-24T09:00:00Z'),
        updated_at: new Date('2026-11-25T11:00:00Z')
      }
    ] as any[],
    employees: [
      {
        id: 'EMP_SUP',
        name: 'Supervisor User',
        username: 'supervisor',
        phone: '+966500000000',
        email: 'sup@rg.local',
        job_title: 'مشرف',
        role: 'supervisor',
        permissions: core.ROLE_PERMISSION_MATRIX.supervisor.slice(),
        status: 'active',
        last_activity: '',
        created_at: new Date('2026-11-01T00:00:00Z'),
        updated_at: new Date('2026-11-01T00:00:00Z')
      },
      {
        id: 'EMP_AGENT_A',
        name: 'Agent A',
        username: 'agenta',
        phone: '+966500000001',
        email: 'agenta@rg.local',
        job_title: 'موظف',
        role: 'agent',
        permissions: core.ROLE_PERMISSION_MATRIX.agent.slice(),
        status: 'active',
        last_activity: '',
        created_at: new Date('2026-11-01T00:00:00Z'),
        updated_at: new Date('2026-11-01T00:00:00Z')
      },
      {
        id: 'EMP_AGENT_B',
        name: 'Agent B',
        username: 'agentb',
        phone: '+966500000002',
        email: 'agentb@rg.local',
        job_title: 'موظف',
        role: 'agent',
        permissions: core.ROLE_PERMISSION_MATRIX.agent.slice(),
        status: 'active',
        last_activity: '',
        created_at: new Date('2026-11-01T00:00:00Z'),
        updated_at: new Date('2026-11-01T00:00:00Z')
      }
    ] as any[],
    users: [] as any[],
    sessions: [] as any[],
    follow_ups: [
      {
        id: 'FU_1',
        reservation_id: 'RES_ACTIVE',
        reservation_number: '5001',
        customer_name: 'عميل نشط',
        employee_id: 'EMP_AGENT_A',
        employee_name: 'Agent A',
        status: 'تم التواصل',
        action: 'متابعة أولى',
        notes: 'ملاحظة أولى',
        follow_up_date: '2026-11-25',
        follow_up_time: '09:00',
        created_at: new Date('2026-11-25T09:00:00Z'),
        updated_at: new Date('2026-11-25T09:00:00Z')
      },
      {
        id: 'FU_2',
        reservation_id: 'RES_ACTIVE',
        reservation_number: '5001',
        customer_name: 'عميل نشط',
        employee_id: 'EMP_AGENT_A',
        employee_name: 'Agent A',
        status: 'قيد المتابعة',
        action: 'متابعة ثانية',
        notes: 'ملاحظة ثانية',
        follow_up_date: '2026-11-25',
        follow_up_time: '10:00',
        created_at: new Date('2026-11-25T10:00:00Z'),
        updated_at: new Date('2026-11-25T10:00:00Z')
      },
      {
        id: 'FU_CAN_1',
        reservation_id: 'RES_CANCELLED',
        reservation_number: '5002',
        customer_name: 'عميل ملغي',
        employee_id: 'EMP_AGENT_A',
        employee_name: 'Agent A',
        status: 'ملغي من العميل',
        action: 'تم التواصل بعد الإلغاء',
        notes: '',
        follow_up_date: '2026-11-25',
        follow_up_time: '11:00',
        created_at: new Date('2026-11-25T11:00:00Z'),
        updated_at: new Date('2026-11-25T11:00:00Z')
      }
    ] as any[],
    follow_up_history: [
      { id: 'FUH_1', follow_up_id: 'FU_2', reservation_id: 'RES_ACTIVE' }
    ] as any[],
    notifications: [
      {
        id: 'NTF_A1',
        recipient_employee_id: 'EMP_AGENT_A',
        recipient_role: '',
        type: 'mention',
        title: 'إشارة لك',
        message: 'تمت الإشارة إليك',
        entity_type: 'Reservation',
        entity_id: 'RES_ACTIVE',
        is_read: false,
        event_key: 'ev_ntf_a1',
        deleted_at: null,
        deleted_by_id: '',
        created_at: new Date('2026-11-25T10:00:00Z'),
        updated_at: new Date('2026-11-25T10:00:00Z')
      },
      {
        id: 'NTF_A2',
        recipient_employee_id: 'EMP_AGENT_A',
        recipient_role: '',
        type: 'info',
        title: 'تنبيه مقروء',
        message: 'تنبيه قديم',
        entity_type: 'Reservation',
        entity_id: 'RES_ACTIVE',
        is_read: true,
        event_key: 'ev_ntf_a2',
        deleted_at: null,
        deleted_by_id: '',
        created_at: new Date('2026-11-25T09:00:00Z'),
        updated_at: new Date('2026-11-25T09:00:00Z')
      },
      {
        id: 'NTF_ROLE_AGENT',
        recipient_employee_id: '',
        recipient_role: 'agent',
        type: 'announcement',
        title: 'تعميم للموظفين',
        message: 'رسالة للجميع',
        entity_type: '',
        entity_id: '',
        is_read: false,
        event_key: 'ev_ntf_role_agent',
        deleted_at: null,
        deleted_by_id: '',
        created_at: new Date('2026-11-25T08:30:00Z'),
        updated_at: new Date('2026-11-25T08:30:00Z')
      },
      {
        id: 'NTF_B1',
        recipient_employee_id: 'EMP_AGENT_B',
        recipient_role: '',
        type: 'mention',
        title: 'إشعار خاص بالموظف ب',
        message: 'لا يجوز للموظف أ حذفه',
        entity_type: 'Reservation',
        entity_id: 'RES_ACTIVE',
        is_read: false,
        event_key: 'ev_ntf_b1',
        deleted_at: null,
        deleted_by_id: '',
        created_at: new Date('2026-11-25T10:15:00Z'),
        updated_at: new Date('2026-11-25T10:15:00Z')
      }
    ] as any[],
    notification_dismissals: [] as Array<{ notification_id: string; employee_id: string; deleted_at: Date }>,
    activity_log: [] as any[],
    sync_tombstones: [] as any[],
    sheets_mirror_outbox: [] as any[],
    settings: [] as any[],
    employee_delegations: [] as any[],
    announcements: [] as any[],
    reservation_locks: [] as any[],
    problems: [] as any[],
    idempotency_keys: [] as any[]
  };

  for (const emp of state.employees) {
    const salt = 'salt_' + emp.id;
    state.users.push({ id: emp.id, username: emp.username, password_hash: hashPassword('Pass@123', salt), salt });
    state.sessions.push({
      token_hash: hashToken('tok_' + emp.id),
      employee_id: emp.id,
      username: emp.username,
      role: emp.role,
      expires_at: new Date(Date.now() + 3600_000),
      is_revoked: false,
      last_seen_at: new Date()
    });
  }

  const query = async (rawSql: string, params: any[] = []) => {
    const sql = String(rawSql || '').trim().replace(/\s+/g, ' ');
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM sessions s JOIN employees e')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0] && !s.is_revoked);
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
        }],
        rowCount: 1
      };
    }
    if (sql.startsWith('SELECT * FROM employee_delegations')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT key, value FROM settings')) return { rows: state.settings, rowCount: state.settings.length };
    if (sql.startsWith('SELECT value FROM settings WHERE key =')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('INSERT INTO settings')) return { rows: [], rowCount: 1 };

    if (sql.startsWith('SELECT * FROM follow_ups WHERE id = $1')) {
      const found = state.follow_ups.find((f) => f.id === params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.startsWith('DELETE FROM follow_up_history WHERE follow_up_id = $1')) {
      const before = state.follow_up_history.length;
      state.follow_up_history = state.follow_up_history.filter((h) => h.follow_up_id !== params[0]);
      return { rows: [], rowCount: before - state.follow_up_history.length };
    }
    if (sql.startsWith('DELETE FROM follow_ups WHERE id = $1')) {
      const before = state.follow_ups.length;
      state.follow_ups = state.follow_ups.filter((f) => f.id !== params[0]);
      return { rows: [], rowCount: before - state.follow_ups.length };
    }
    if (sql.startsWith('SELECT COUNT(*)::text AS cnt FROM follow_ups WHERE reservation_id = $1')) {
      const cnt = state.follow_ups.filter((f) => f.reservation_id === params[0]).length;
      return { rows: [{ cnt: String(cnt) }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM follow_ups WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1')) {
      const rows = state.follow_ups
        .filter((f) => f.reservation_id === params[0])
        .sort((a, b) => Date.parse(b.created_at.toISOString()) - Date.parse(a.created_at.toISOString()));
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }
    if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
      const found = state.reservations.find((r) => r.id === params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE reservations SET internal_status = $2, last_update_text = $3')) {
      const res = state.reservations.find((r) => r.id === params[0]);
      if (res) {
        res.internal_status = params[1];
        res.last_update_text = params[2];
        res.last_updated_by_id = params[3];
        res.last_updated_by_name = params[4];
        res.last_updated_at = params[5];
        res.updated_at = new Date(params[6]);
      }
      return { rows: [], rowCount: res ? 1 : 0 };
    }

    if (sql.startsWith('SELECT * FROM employees')) {
      return { rows: state.employees, rowCount: state.employees.length };
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      const [id, recEmpId, recRole, type, title, message, entityType, entityId, eventKey] = params;
      if (eventKey) {
        const dup = state.notifications.find((n) =>
          n.event_key === eventKey &&
          String(n.recipient_employee_id || '') === String(recEmpId || '') &&
          String(n.recipient_role || '') === String(recRole || '')
        );
        if (dup) return { rows: [], rowCount: 0 };
      }
      const now = new Date();
      state.notifications.push({
        id,
        recipient_employee_id: recEmpId || '',
        recipient_role: recRole || '',
        type: type || 'info',
        title: title || '',
        message: message || '',
        entity_type: entityType || '',
        entity_id: entityId || '',
        is_read: false,
        event_key: eventKey || '',
        deleted_at: null,
        deleted_by_id: '',
        created_at: now,
        updated_at: now
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE notifications SET deleted_at = NOW(), deleted_by_id = $1') && sql.includes('WHERE recipient_employee_id = $1')) {
      const userId = params[0];
      const now = new Date();
      const updated: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        if (n.recipient_employee_id === userId && !n.deleted_at) {
          n.deleted_at = now;
          n.deleted_by_id = userId;
          n.updated_at = now;
          updated.push({ id: n.id });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
    if (sql.startsWith('UPDATE notifications SET deleted_at = NOW(), deleted_by_id = $2') && sql.includes('WHERE id = $1')) {
      const [nid, userId] = params;
      const now = new Date();
      const updated: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        if (n.id === nid && n.recipient_employee_id === userId && !n.deleted_at) {
          n.deleted_at = now;
          n.deleted_by_id = userId;
          n.updated_at = now;
          updated.push({ id: n.id });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
    if (sql.startsWith('INSERT INTO notification_dismissals') && sql.includes('WHERE COALESCE(n.recipient_employee_id')) {
      const userId = params[0];
      const role = params[1];
      const now = new Date();
      const inserted: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        const isSharedForUser = String(n.recipient_employee_id || '') === '' && (n.recipient_role === role || n.recipient_role === 'all');
        const alreadyDismissed = state.notification_dismissals.some((d) => d.notification_id === n.id && d.employee_id === userId && d.deleted_at);
        if (isSharedForUser && !n.deleted_at && !alreadyDismissed) {
          const existing = state.notification_dismissals.find((d) => d.notification_id === n.id && d.employee_id === userId);
          if (existing) existing.deleted_at = now;
          else state.notification_dismissals.push({ notification_id: n.id, employee_id: userId, deleted_at: now });
          inserted.push({ id: n.id });
        }
      }
      return { rows: inserted, rowCount: inserted.length };
    }
    if (sql.startsWith('INSERT INTO notification_dismissals') && sql.includes('WHERE n.id = $1')) {
      const [nid, userId, role] = params;
      const now = new Date();
      const inserted: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        const isSharedForUser = String(n.recipient_employee_id || '') === '' && (n.recipient_role === role || n.recipient_role === 'all');
        const alreadyDismissed = state.notification_dismissals.some((d) => d.notification_id === n.id && d.employee_id === userId && d.deleted_at);
        if (n.id === nid && isSharedForUser && !n.deleted_at && !alreadyDismissed) {
          const existing = state.notification_dismissals.find((d) => d.notification_id === n.id && d.employee_id === userId);
          if (existing) existing.deleted_at = now;
          else state.notification_dismissals.push({ notification_id: n.id, employee_id: userId, deleted_at: now });
          inserted.push({ id: n.id });
        }
      }
      return { rows: inserted, rowCount: inserted.length };
    }
    if (sql.startsWith('SELECT id FROM notifications WHERE deleted_at IS NOT NULL')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const empId = params[1];
      const role = params[2];
      const rows = state.notifications
        .filter((n) => n.deleted_at && Date.parse(n.deleted_at.toISOString()) > sinceMs &&
          (n.recipient_employee_id === empId || (String(n.recipient_employee_id || '') === '' && (n.recipient_role === role || n.recipient_role === 'all'))))
        .map((n) => ({ id: n.id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT notification_id AS id FROM notification_dismissals')) {
      const empId = params[0];
      const sinceMs = Date.parse(String(params[1] || ''));
      const rows = state.notification_dismissals
        .filter((d) => d.employee_id === empId && d.deleted_at && Date.parse(d.deleted_at.toISOString()) > sinceMs)
        .map((d) => ({ id: d.notification_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM notifications') && sql.includes('deleted_at IS NULL')) {
      const empId = params[0];
      const role = params[1];
      const rows = state.notifications
        .filter((n) => {
          if (n.deleted_at) return false;
          const owned = n.recipient_employee_id === empId ||
            (String(n.recipient_employee_id || '') === '' && (n.recipient_role === role || n.recipient_role === 'all'));
          if (!owned) return false;
          const dismissed = state.notification_dismissals.some(
            (d) => d.notification_id === n.id && d.employee_id === empId && d.deleted_at
          );
          return !dismissed;
        })
        .sort((a, b) => Date.parse(b.created_at.toISOString()) - Date.parse(a.created_at.toISOString()));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO sync_tombstones')) {
      const ids: string[] = params[0] || [];
      const entityType = params[1];
      const entityIds: string[] = params[3] || [];
      entityIds.forEach((eid, idx) => {
        state.sync_tombstones.push({
          id: ids[idx] || `TMB_${idx}`,
          entity_type: entityType,
          entity_id: eid,
          deleted_at: new Date()
        });
      });
      return { rows: [], rowCount: entityIds.length };
    }
    if (sql.startsWith('INSERT INTO activity_log')) {
      state.activity_log.push({ id: params[0], action_type: params[4], entity_type: params[5], entity_id: params[6], details: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({ id: params[0], entity_type: params[1], entity_id: params[2], action: params[3], payload: JSON.parse(params[4]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT entity_type, entity_id, deleted_at FROM sync_tombstones')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const rows = state.sync_tombstones.filter((t) => Date.parse(t.deleted_at.toISOString()) > sinceMs);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT r.*, EXISTS')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM follow_ups WHERE updated_at >')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM problems WHERE updated_at >')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM employees WHERE updated_at >')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM announcements')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM reservation_locks')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id, updated_at FROM settings')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };

  const executor: any = {
    query,
    withTransaction: async (fn: (client: any) => Promise<any>) => fn({ query })
  };

  return { executor, state };
}

function loadApiSandbox(opts: {
  mode?: 'sandbox' | 'neon';
  localStore?: Record<string, string>;
  sessionStore?: Record<string, string>;
  fetchImpl?: (url: any, init?: any) => Promise<any>;
} = {}) {
  const coreSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/core.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/api.js'), 'utf8');
  const mode = opts.mode || 'sandbox';
  const store: Record<string, string> = opts.localStore || { rg_crm_backend_mode_v1: mode };
  if (!opts.localStore && mode) store.rg_crm_backend_mode_v1 = mode;
  const sessStore: Record<string, string> = opts.sessionStore || {};
  const dispatchedEvents: Array<{ type: string; detail: any }> = [];
  const ctx: any = {
    console, Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Set, Map, RegExp,
    setTimeout, clearTimeout,
    CustomEvent: class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, init?: any) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    document: {
      dispatchEvent(ev: any) { dispatchedEvents.push({ type: ev.type, detail: ev.detail }); }
    },
    localStorage: {
      getItem(k: string) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k: string, v: string) { store[k] = String(v); },
      removeItem(k: string) { delete store[k]; },
      clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    sessionStorage: {
      getItem(k: string) { return Object.prototype.hasOwnProperty.call(sessStore, k) ? sessStore[k] : null; },
      setItem(k: string, v: string) { sessStore[k] = String(v); },
      removeItem(k: string) { delete sessStore[k]; },
      clear() { Object.keys(sessStore).forEach((k) => delete sessStore[k]); }
    },
    location: { protocol: 'https:', hostname: 'localhost', origin: 'https://localhost', search: '', pathname: '/', hash: '' },
    RG_APP_CONFIG: { mode, backendApiUrl: '/api/crm', gasWebAppUrl: '' },
    fetch: opts.fetchImpl || (async () => ({ ok: true, json: async () => ({ success: true, data: {} }) }))
  };
  ctx.window = ctx;
  vm.runInNewContext(coreSrc, ctx);
  vm.runInNewContext(apiSrc, ctx);
  return { ctx, dispatchedEvents, store, sessStore };
}

test('core: deleteFollowUp & deleteNotification invalidations, lock keys, delta changes, and list reapply', () => {
  assert.ok(core.getCacheInvalidationScopes('deleteFollowUp').includes('followUps'));
  assert.ok(core.getCacheInvalidationScopes('deleteFollowUp').includes('reservations'));
  assert.deepEqual(core.getCacheInvalidationScopes('deleteNotification'), ['notifications']);

  assert.equal(core.buildMutationLockKey('deleteFollowUp', { followUpId: 'FU_9' }), 'deleteFollowUp:FU_9');
  assert.equal(core.buildMutationLockKey('deleteNotification', { deleteAll: true }), 'deleteNotification:ALL');
  assert.equal(core.buildMutationLockKey('deleteNotification', { notificationId: 'N_9' }), 'deleteNotification:N_9');

  assert.equal(core.hasMeaningfulDeltaChanges({ deletedFollowUpIds: ['FU_1'] }, {}), true);

  const filtered = core.reapplyFollowUpDeltaToFilteredList(
    [
      { id: 'FU_1', reservationId: 'R1', employeeId: 'E1', status: 'تم التواصل', followUpDate: '2026-11-25', createdAt: '2026-11-25T10:00:00Z' },
      { id: 'FU_2', reservationId: 'R1', employeeId: 'E1', status: 'تم التواصل', followUpDate: '2026-11-25', createdAt: '2026-11-25T09:00:00Z' }
    ],
    [],
    [],
    {},
    ['FU_1']
  );
  assert.deepEqual(filtered.map((f: any) => f.id), ['FU_2']);
});

test('deleteFollowUp backend: validation, authorization, cascade, reservation recalculation, tombstones & inactive guard', async () => {
  const { executor, state } = createMockExecutor();
  const baseTime = new Date(Date.now() - 60_000).toISOString();

  // Validation error without followUpId
  const badRes = await dispatchCrmRequest(executor, {
    action: 'deleteFollowUp',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(badRes.success, false);
  assert.match(String(badRes.message), /VALIDATION_ERROR|مطلوب/);

  // Agent B cannot delete Agent A's follow-up
  const forbidRes = await dispatchCrmRequest(executor, {
    action: 'deleteFollowUp',
    token: 'tok_EMP_AGENT_B',
    payload: { followUpId: 'FU_2' }
  });
  assert.equal(forbidRes.success, false);
  assert.match(String(forbidRes.message), /FORBIDDEN|لا يمكنك حذف/);
  assert.equal(state.follow_ups.length, 3);

  // Agent A deletes own latest follow-up FU_2 -> parent reservation reverts to FU_1
  const delOwn = await dispatchCrmRequest(executor, {
    action: 'deleteFollowUp',
    token: 'tok_EMP_AGENT_A',
    payload: { followUpId: 'FU_2' }
  });
  assert.equal(delOwn.success, true, delOwn.message);
  assert.equal(delOwn.data.deleted, true);
  assert.equal(delOwn.data.remainingFollowUpsCount, 1);
  assert.equal(delOwn.data.isFollowed, true);
  assert.equal(state.follow_up_history.length, 0);

  const activeParentAfterFirst = state.reservations.find((r) => r.id === 'RES_ACTIVE');
  assert.equal(activeParentAfterFirst.internal_status, 'تم التواصل');
  assert.equal(activeParentAfterFirst.last_update_text, 'متابعة أولى — ملاحظة أولى');

  // Supervisor (has edit_any_followup) deletes remaining FU_1 -> active parent resets to بانتظار المتابعة
  const delSup = await dispatchCrmRequest(executor, {
    action: 'deleteFollowUp',
    token: 'tok_EMP_SUP',
    payload: { followUpId: 'FU_1' }
  });
  assert.equal(delSup.success, true, delSup.message);
  assert.equal(delSup.data.remainingFollowUpsCount, 0);
  assert.equal(delSup.data.isFollowed, false);
  assert.equal(activeParentAfterFirst.internal_status, 'بانتظار المتابعة');
  assert.equal(activeParentAfterFirst.last_update_text, '');

  // Deleting follow-up on a cancelled reservation preserves its inactive internal_status
  const delCancelled = await dispatchCrmRequest(executor, {
    action: 'deleteFollowUp',
    token: 'tok_EMP_AGENT_A',
    payload: { followUpId: 'FU_CAN_1' }
  });
  assert.equal(delCancelled.success, true);
  const cancelledParent = state.reservations.find((r) => r.id === 'RES_CANCELLED');
  assert.equal(cancelledParent.internal_status, 'ملغي من العميل');

  // Tombstones, activity log, outbox, and delta sync verification
  assert.deepEqual(state.sync_tombstones.map((t) => t.entity_id), ['FU_2', 'FU_1', 'FU_CAN_1']);
  assert.equal(state.activity_log.filter((a) => a.action_type === 'حذف متابعة').length, 3);
  assert.equal(state.sheets_mirror_outbox.filter((o) => o.action === 'deleteFollowUp').length, 3);

  const delta = await dispatchCrmRequest(executor, {
    action: 'getDeltaSync',
    token: 'tok_EMP_SUP',
    payload: { updatedAfter: baseTime }
  });
  assert.equal(delta.success, true);
  assert.ok(delta.data.deletedFollowUpIds.includes('FU_1'));
  assert.ok(delta.data.deletedFollowUpIds.includes('FU_2'));
});

test('deleteNotification backend: soft delete, shared dismissal isolation, tombstones, delta sync & eventKey idempotency', async () => {
  const { executor, state } = createMockExecutor();
  const baseTime = new Date(Date.now() - 60_000).toISOString();

  const badRes = await dispatchCrmRequest(executor, {
    action: 'deleteNotification',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(badRes.success, false);
  assert.match(String(badRes.message), /VALIDATION_ERROR|مطلوب/);

  // Agent A tries deleting Agent B's personal notification NTF_B1 -> deletedCount must be 0
  const crossDelete = await dispatchCrmRequest(executor, {
    action: 'deleteNotification',
    token: 'tok_EMP_AGENT_A',
    payload: { notificationId: 'NTF_B1' }
  });
  assert.equal(crossDelete.success, true);
  assert.equal(crossDelete.data.deletedCount, 0);
  assert.ok(state.notifications.some((n) => n.id === 'NTF_B1' && !n.deleted_at));

  // Agent A deletes single personal notification NTF_A1 -> soft-deleted in DB, excluded from getNotifications
  const singleDel = await dispatchCrmRequest(executor, {
    action: 'deleteNotification',
    token: 'tok_EMP_AGENT_A',
    payload: { notificationId: 'NTF_A1' }
  });
  assert.equal(singleDel.success, true);
  assert.equal(singleDel.data.deletedCount, 1);
  assert.equal(singleDel.data.items.some((n: any) => n.id === 'NTF_A1'), false);
  assert.equal(singleDel.data.unreadCount, 1); // NTF_ROLE_AGENT is unread
  const rowA1 = state.notifications.find((n) => n.id === 'NTF_A1');
  assert.ok(rowA1 && rowA1.deleted_at, 'NTF_A1 should be soft-deleted with deleted_at');
  assert.equal(rowA1.deleted_by_id, 'EMP_AGENT_A');

  // Re-fetching getNotifications must NOT return NTF_A1
  const refetchAfterSingle = await dispatchCrmRequest(executor, {
    action: 'getNotifications',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(refetchAfterSingle.success, true);
  assert.equal(refetchAfterSingle.data.items.some((n: any) => n.id === 'NTF_A1'), false);

  // Agent A clears all own notifications (NTF_A2 personal + NTF_ROLE_AGENT shared)
  // Must dismiss NTF_ROLE_AGENT ONLY for Agent A while leaving NTF_ROLE_AGENT & NTF_B1 active for Agent B!
  const clearAll = await dispatchCrmRequest(executor, {
    action: 'deleteNotification',
    token: 'tok_EMP_AGENT_A',
    payload: { deleteAll: true }
  });
  assert.equal(clearAll.success, true);
  assert.equal(clearAll.data.deletedCount, 2);
  assert.equal(clearAll.data.items.length, 0);
  assert.equal(clearAll.data.unreadCount, 0);
  assert.ok(clearAll.data.deletedAllNotificationsBefore || clearAll.data.deletedAllBefore);

  // Agent A sees 0 notifications after clearAll
  const refetchA = await dispatchCrmRequest(executor, {
    action: 'getNotifications',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(refetchA.data.items.length, 0);

  // Agent B STILL sees both NTF_B1 and shared NTF_ROLE_AGENT!
  const fetchB = await dispatchCrmRequest(executor, {
    action: 'getNotifications',
    token: 'tok_EMP_AGENT_B',
    payload: {}
  });
  assert.equal(fetchB.success, true);
  assert.deepEqual(fetchB.data.items.map((n: any) => n.id).sort(), ['NTF_B1', 'NTF_ROLE_AGENT']);

  // getDeltaSync for Agent A exposes all 3 deleted/dismissed notification IDs + deletedAllNotificationsBefore
  const deltaA = await dispatchCrmRequest(executor, {
    action: 'getDeltaSync',
    token: 'tok_EMP_AGENT_A',
    payload: { updatedAfter: baseTime }
  });
  assert.equal(deltaA.success, true);
  assert.ok(deltaA.data.deletedNotificationIds.includes('NTF_A1'));
  assert.ok(deltaA.data.deletedNotificationIds.includes('NTF_A2'));
  assert.ok(deltaA.data.deletedNotificationIds.includes('NTF_ROLE_AGENT'));
  assert.ok(Boolean(deltaA.data.deletedAllNotificationsBefore));

  // Idempotent event_key check: creating a notification with an existing (even soft-deleted) event_key must be a no-op
  await executor.query(
    `INSERT INTO notifications (id, recipient_employee_id, recipient_role, type, title, message, entity_type, entity_id, is_read, created_at, updated_at, event_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW(),NOW(),$9)
     ON CONFLICT (event_key, recipient_employee_id, recipient_role) WHERE event_key <> '' DO NOTHING`,
    ['NTF_DUP_1', 'EMP_AGENT_A', '', 'mention', 'duplicate', 'should be skipped', 'Reservation', 'RES_ACTIVE', 'ev_ntf_a1']
  );
  const refetchAAfterDup = await dispatchCrmRequest(executor, {
    action: 'getNotifications',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(refetchAAfterDup.data.items.length, 0);
  assert.equal(state.sheets_mirror_outbox.some((o) => o.action === 'deleteNotification'), true);
});

test('core & frontend reload/race protection: filterDeletedNotificationsPayload, sandbox reload persistence, and stale fetch/delta race immunity', async () => {
  // 1) core.filterDeletedNotificationsPayload handles deletedAt, id tombstones, and deletedAllBeforeMs
  const samplePayload = {
    items: [
      { id: 'N1', isRead: false, createdAt: '2026-11-25T09:00:00Z' },
      { id: 'N2', isRead: false, createdAt: '2026-11-25T10:00:00Z', deletedAt: '2026-11-25T10:05:00Z' },
      { id: 'N3', isRead: false, createdAt: '2026-11-25T12:00:00Z' }
    ],
    unreadCount: 3
  };
  const filteredSingle = core.filterDeletedNotificationsPayload(samplePayload, { N1: true }, 0);
  assert.deepEqual(filteredSingle.items.map((x: any) => x.id), ['N3']);
  assert.equal(filteredSingle.unreadCount, 1);

  const filteredClearAll = core.filterDeletedNotificationsPayload(
    samplePayload,
    {},
    Date.parse('2026-11-25T11:00:00Z')
  );
  assert.deepEqual(filteredClearAll.items.map((x: any) => x.id), ['N3']);

  // 2) Sandbox reload persistence: delete notification, persist in sessionStorage/localStorage, reload new VM -> stays deleted
  const sharedLocalStore: Record<string, string> = { rg_crm_backend_mode_v1: 'sandbox' };
  const sharedSessionStore: Record<string, string> = {};
  const sb1 = loadApiSandbox({ mode: 'sandbox', localStore: sharedLocalStore, sessionStore: sharedSessionStore });
  const api1 = sb1.ctx.RGApi;

  const loginRes = await api1.callApi('login', { username: 'admin', password: process.env.RG_SEED_ADMIN_PASSWORD || 'Admin@123' });
  assert.equal(loginRes.success, true);

  const beforeNotifs = await api1.callApi('getNotifications', {});
  assert.equal(beforeNotifs.success, true);
  assert.ok(beforeNotifs.data.items.length >= 1, 'Sandbox should seed notifications');
  const firstNotifId = beforeNotifs.data.items[0].id;

  const delSbRes = await api1.callApi('deleteNotification', { notificationId: firstNotifId });
  assert.equal(delSbRes.success, true);
  assert.equal(delSbRes.data.items.some((n: any) => n.id === firstNotifId), false);

  // Simulated full browser reload with fresh VM sharing localStorage + sessionStorage
  const sb2 = loadApiSandbox({ mode: 'sandbox', localStore: sharedLocalStore, sessionStore: sharedSessionStore });
  const api2 = sb2.ctx.RGApi;
  const cachedAfterReload = api2.getCachedData('getNotifications', {}, true);
  assert.equal((cachedAfterReload?.items || []).some((n: any) => n.id === firstNotifId), false);
  const fetchedAfterReload = await api2.callApi('getNotifications', { forceRefresh: true });
  assert.equal(fetchedAfterReload.data.items.some((n: any) => n.id === firstNotifId), false);

  // 3) Stale concurrent getNotifications & delta race test in backend mode
  let releaseSlowFetch!: (val: any) => void;
  const slowFetchPromise = new Promise((resolve) => { releaseSlowFetch = resolve; });
  const n1 = { id: 'RACE_N1', isRead: false, createdAt: '2026-11-25T10:00:00Z' };
  const n2 = { id: 'RACE_N2', isRead: false, createdAt: '2026-11-25T11:00:00Z' };

  const mockResp = (obj: any) => ({
    ok: true,
    status: 200,
    headers: { get: (k: string) => (String(k || '').toLowerCase() === 'content-type' ? 'application/json' : '') },
    text: async () => JSON.stringify(obj),
    json: async () => obj
  });

  const neonStore: Record<string, string> = {
    rg_crm_backend_mode_v1: 'neon',
    rg_crm_backend_url: '/api/crm',
    rg_crm_session_token: 'tok_race'
  };
  const neonSession: Record<string, string> = {};
  const sbRace = loadApiSandbox({
    mode: 'neon',
    localStore: neonStore,
    sessionStore: neonSession,
    fetchImpl: async (url: any, init: any) => {
      const urlStr = String(url || '');
      if (urlStr.includes('/api/health') || urlStr.includes('serverCapabilities')) {
        return mockResp({ ok: true, databaseConfigured: true, mode: 'neon', backendApiUrl: '/api/crm' });
      }
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.action === 'getNotifications' && body.payload?._slowTest) {
        return await slowFetchPromise;
      }
      if (body.action === 'deleteNotification') {
        return mockResp({
          success: true,
          data: { deleted: true, deletedCount: 1, deletedIds: ['RACE_N1'], items: [n2], unreadCount: 1 }
        });
      }
      return mockResp({ success: true, data: { items: [n1, n2], unreadCount: 2 } });
    }
  });
  const apiRace = sbRace.ctx.RGApi;
  apiRace.setToken('tok_race');
  apiRace.primeCache('getNotifications', {}, { items: [n1, n2], unreadCount: 2 });

  // Start slow pre-delete fetch
  const staleFetchCall = apiRace.callApi('getNotifications', { forceRefresh: true, _slowTest: true });

  // User deletes RACE_N1 while slow fetch is in flight
  apiRace.applyOptimisticMutation('deleteNotification', { notificationId: 'RACE_N1' });
  const delCallRes = await apiRace.callApi('deleteNotification', { notificationId: 'RACE_N1', _keepOptimisticCache: true });
  assert.equal(delCallRes.success, true, delCallRes.message);

  // Now resolve the stale slow fetch returning old [n1, n2]
  releaseSlowFetch(mockResp({ success: true, data: { items: [n1, n2], unreadCount: 2 } }));
  const staleResolved = await staleFetchCall;

  // Neither the resolved stale response nor cache nor delta sync may resurrect RACE_N1
  assert.equal(staleResolved.data.items.some((n: any) => n.id === 'RACE_N1'), false);
  const finalCache = apiRace.getCachedData('getNotifications', {}, true);
  assert.deepEqual(finalCache.items.map((n: any) => n.id), ['RACE_N2']);

  apiRace.applyDeltaSyncToCache({
    syncVersion: Date.now(),
    changedNotifications: { items: [n1, n2], unreadCount: 2 },
    deletedNotificationIds: ['RACE_N1']
  });
  const afterDeltaCache = apiRace.getCachedData('getNotifications', {}, true);
  assert.deepEqual(afterDeltaCache.items.map((n: any) => n.id), ['RACE_N2']);
});

test('frontend sandbox & UI check: deleteFollowUp & deleteNotification in api.js and delete controls across UI modules', async () => {
  const { ctx } = loadApiSandbox();
  const api = ctx.RGApi;

  // Verify optimistic mutation helper supports both deleteFollowUp and deleteNotification
  assert.equal(typeof api.applyOptimisticMutation, 'function');
  const seeded = await api.callApi('getTeamFollowUps', {});
  if (seeded && seeded.success && seeded.data && Array.isArray(seeded.data.items) && seeded.data.items[0]) {
    const targetFu = seeded.data.items[0];
    api.applyOptimisticMutation('deleteFollowUp', { followUpId: targetFu.id, reservationId: targetFu.reservationId });
    const afterOpt = api.getCachedData('getTeamFollowUps', {}, true);
    assert.equal((afterOpt?.items || []).some((x: any) => x.id === targetFu.id), false);
  }

  // Verify UI files expose follow-up delete buttons & notification delete buttons cleanly
  const resJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/reservations.js'), 'utf8');
  const fuJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/followups.js'), 'utf8');
  const empJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/employees.js'), 'utf8');
  const appJs = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/app.js'), 'utf8');

  assert.match(resJs, /btn-delete-fu/);
  assert.match(resJs, /deleteFollowUp/);
  assert.match(fuJs, /myfu-delete-fu/);
  assert.match(fuJs, /tfu-delete-fu/);
  assert.match(empJs, /emp-delete-fu/);
  assert.match(appJs, /id="notif-delete-all"/);
  assert.match(appJs, /notif-delete-btn/);
  assert.match(appJs, /class="notif-item-wrap/);
  assert.match(appJs, /class="notif-item-main"/);
});
