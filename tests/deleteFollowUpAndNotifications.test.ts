import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import core from '../backend/coreBridge.cjs';
import { dispatchCrmRequest } from '../backend/router.js';
import { hashPassword, hashToken } from '../backend/auth.js';

import { ensureNotificationsSchemaAndIndexes } from '../backend/db.js';

function createMockExecutor(opts: { failNotificationDismissals?: boolean } = {}) {
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

  let txSnapshot: any = null;
  let txAborted = false;
  const savepoints = new Map<string, { snapshot: any; aborted: boolean }>();

  const cloneState = () => ({
    reservations: structuredClone(state.reservations),
    follow_ups: structuredClone(state.follow_ups),
    follow_up_history: structuredClone(state.follow_up_history),
    notifications: structuredClone(state.notifications),
    notification_dismissals: structuredClone(state.notification_dismissals),
    activity_log: structuredClone(state.activity_log),
    sync_tombstones: structuredClone(state.sync_tombstones),
    sheets_mirror_outbox: structuredClone(state.sheets_mirror_outbox),
    settings: structuredClone(state.settings),
    problems: structuredClone(state.problems)
  });

  const restoreState = (snap: any) => {
    if (!snap) return;
    state.reservations = snap.reservations;
    state.follow_ups = snap.follow_ups;
    state.follow_up_history = snap.follow_up_history;
    state.notifications = snap.notifications;
    state.notification_dismissals = snap.notification_dismissals;
    state.activity_log = snap.activity_log;
    state.sync_tombstones = snap.sync_tombstones;
    state.sheets_mirror_outbox = snap.sheets_mirror_outbox;
    state.settings = snap.settings;
    state.problems = snap.problems;
  };

  const query = async (rawSql: string, params: any[] = []) => {
    const sql = String(rawSql || '').trim().replace(/\s+/g, ' ');
    if (sql.startsWith('ROLLBACK TO SAVEPOINT ')) {
      const spName = sql.replace('ROLLBACK TO SAVEPOINT ', '').trim();
      const saved = savepoints.get(spName);
      if (saved) {
        restoreState(saved.snapshot);
        txAborted = saved.aborted;
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('RELEASE SAVEPOINT ')) {
      const spName = sql.replace('RELEASE SAVEPOINT ', '').trim();
      savepoints.delete(spName);
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SAVEPOINT ')) {
      const spName = sql.replace('SAVEPOINT ', '').trim();
      savepoints.set(spName, { snapshot: cloneState(), aborted: txAborted });
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'BEGIN') {
      txSnapshot = cloneState();
      txAborted = false;
      savepoints.clear();
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'COMMIT') {
      if (txAborted) throw Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
      txSnapshot = null;
      savepoints.clear();
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'ROLLBACK') {
      if (txSnapshot) restoreState(txSnapshot);
      txSnapshot = null;
      txAborted = false;
      savepoints.clear();
      return { rows: [], rowCount: 0 };
    }
    if (txAborted) {
      throw Object.assign(new Error('current transaction is aborted, commands ignored until end of transaction block'), { code: '25P02' });
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
    if (sql.startsWith('UPDATE notifications SET deleted_at = NOW(), deleted_by_id = $1') && sql.includes('WHERE BTRIM(COALESCE(recipient_employee_id')) {
      const userId = String(params[0] || '').trim();
      const now = new Date();
      const updated: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        if (String(n.recipient_employee_id || '').trim() === userId && !n.deleted_at) {
          n.deleted_at = now;
          n.deleted_by_id = userId;
          n.updated_at = now;
          updated.push({ id: n.id });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
    if (sql.startsWith('UPDATE notifications SET deleted_at = NOW(), deleted_by_id = $2') && sql.includes('WHERE id = $1')) {
      const [nid, rawUserId] = params;
      const userId = String(rawUserId || '').trim();
      const now = new Date();
      const updated: Array<{ id: string }> = [];
      for (const n of state.notifications) {
        if (n.id === nid && String(n.recipient_employee_id || '').trim() === userId && !n.deleted_at) {
          n.deleted_at = now;
          n.deleted_by_id = userId;
          n.updated_at = now;
          updated.push({ id: n.id });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
    if (sql.startsWith('INSERT INTO notification_dismissals')) {
      if (opts.failNotificationDismissals) {
        txAborted = true;
        throw Object.assign(new Error('relation "notification_dismissals" does not exist'), { code: '42P01' });
      }
      if (sql.includes("BTRIM(COALESCE(n.recipient_employee_id, '')) = ''") && !sql.includes('WHERE n.id = $1')) {
        const userId = String(params[0] || '').trim();
        const role = String(params[1] || '').trim();
        const now = new Date();
        const inserted: Array<{ id: string }> = [];
        for (const n of state.notifications) {
          const recRole = String(n.recipient_role || '').trim();
          const isSharedForUser = String(n.recipient_employee_id || '').trim() === '' && (recRole === role || recRole === 'all');
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
      if (sql.includes('WHERE n.id = $1')) {
        const [nid, rawUserId, rawRole] = params;
        const userId = String(rawUserId || '').trim();
        const role = String(rawRole || '').trim();
        const now = new Date();
        const inserted: Array<{ id: string }> = [];
        for (const n of state.notifications) {
          const recRole = String(n.recipient_role || '').trim();
          const isSharedForUser = String(n.recipient_employee_id || '').trim() === '' && (recRole === role || recRole === 'all');
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
    }
    if (sql.startsWith('SELECT id FROM notifications WHERE deleted_at IS NOT NULL')) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const empId = String(params[1] || '').trim();
      const role = String(params[2] || '').trim();
      const rows = state.notifications
        .filter((n) => {
          if (!n.deleted_at || Date.parse(n.deleted_at.toISOString()) <= sinceMs) return false;
          const recEmp = String(n.recipient_employee_id || '').trim();
          const recRole = String(n.recipient_role || '').trim();
          return recEmp === empId || (recEmp === '' && (recRole === role || recRole === 'all'));
        })
        .map((n) => ({ id: n.id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT notification_id AS id FROM notification_dismissals')) {
      if (opts.failNotificationDismissals) {
        txAborted = true;
        throw Object.assign(new Error('relation "notification_dismissals" does not exist'), { code: '42P01' });
      }
      const empId = String(params[0] || '').trim();
      const sinceMs = Date.parse(String(params[1] || ''));
      const rows = state.notification_dismissals
        .filter((d) => String(d.employee_id || '').trim() === empId && d.deleted_at && Date.parse(d.deleted_at.toISOString()) > sinceMs)
        .map((d) => ({ id: d.notification_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM notifications') && sql.includes('deleted_at IS NULL')) {
      const empId = String(params[0] || '').trim();
      const role = String(params[1] || '').trim();
      const rows = state.notifications
        .filter((n) => {
          if (n.deleted_at) return false;
          const recEmp = String(n.recipient_employee_id || '').trim();
          const recRole = String(n.recipient_role || '').trim();
          const owned = recEmp === empId || (recEmp === '' && (recRole === role || recRole === 'all'));
          if (!owned) return false;
          const dismissed = state.notification_dismissals.some(
            (d) => d.notification_id === n.id && String(d.employee_id || '').trim() === empId && d.deleted_at
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
    withTransaction: async (fn: (client: any) => Promise<any>) => {
      await query('BEGIN');
      try {
        const res = await fn({ query });
        await query('COMMIT');
        return res;
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    }
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
  assert.deepEqual(Array.from(finalCache.items, (n: any) => n.id), ['RACE_N2']);

  apiRace.applyDeltaSyncToCache({
    syncVersion: Date.now(),
    changedNotifications: { items: [n1, n2], unreadCount: 2 },
    deletedNotificationIds: ['RACE_N1']
  });
  const afterDeltaCache = apiRace.getCachedData('getNotifications', {}, true);
  assert.deepEqual(Array.from(afterDeltaCache.items, (n: any) => n.id), ['RACE_N2']);
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

test('deleteNotification PG savepoint resilience: personal delete commits cleanly even if notification_dismissals fails inside TX', async () => {
  const { executor, state } = createMockExecutor({ failNotificationDismissals: true });

  const delRes = await dispatchCrmRequest(executor, {
    action: 'deleteNotification',
    token: 'tok_EMP_AGENT_A',
    payload: { notificationId: 'NTF_A1' }
  });
  assert.equal(delRes.success, true, delRes.message);
  assert.equal(delRes.data.deletedCount, 1);

  const rowA1 = state.notifications.find((n) => n.id === 'NTF_A1');
  assert.ok(rowA1 && rowA1.deleted_at, 'NTF_A1 must stay soft-deleted after COMMIT when optional dismissal query fails inside SAVEPOINT');

  const refetch = await dispatchCrmRequest(executor, {
    action: 'getNotifications',
    token: 'tok_EMP_AGENT_A',
    payload: {}
  });
  assert.equal(refetch.success, true);
  assert.equal(refetch.data.items.some((n: any) => n.id === 'NTF_A1'), false);
});

test('ensureNotificationsSchemaAndIndexes: safely deduplicates pre-existing duplicate event_key rows and preserves deleted state', async () => {
  const rows = [
    {
      id: 'DUP_DEL',
      recipient_employee_id: ' EMP_AGENT_A ',
      recipient_role: '',
      event_key: ' ev_dup ',
      deleted_at: new Date('2026-11-25T10:00:00Z'),
      deleted_by_id: 'EMP_AGENT_A',
      is_read: true,
      created_at: new Date('2026-11-25T09:00:00Z')
    },
    {
      id: 'DUP_ACTIVE',
      recipient_employee_id: 'EMP_AGENT_A',
      recipient_role: '',
      event_key: 'ev_dup',
      deleted_at: null,
      deleted_by_id: '',
      is_read: false,
      created_at: new Date('2026-11-25T11:00:00Z')
    }
  ];
  const executedDdls: string[] = [];
  const mockDb: any = {
    query: async (rawSql: string, params: any[] = []) => {
      const sql = String(rawSql || '').trim().replace(/\s+/g, ' ');
      executedDdls.push(sql);
      if (sql.startsWith('UPDATE notifications SET recipient_employee_id = BTRIM')) {
        for (const r of rows) {
          r.recipient_employee_id = String(r.recipient_employee_id || '').trim();
          r.recipient_role = r.recipient_employee_id ? '' : String(r.recipient_role || '').trim();
          r.event_key = String(r.event_key || '').trim();
        }
        return { rows: [], rowCount: rows.length };
      }
      if (sql.startsWith('SELECT event_key, recipient_employee_id, recipient_role FROM notifications')) {
        return { rows: [{ event_key: 'ev_dup', recipient_employee_id: 'EMP_AGENT_A', recipient_role: '' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id, deleted_at, deleted_by_id, is_read FROM notifications')) {
        const ordered = rows
          .filter((r) => r.event_key === params[0] && r.recipient_employee_id === params[1] && r.recipient_role === params[2])
          .sort((a, b) => Number(Boolean(b.deleted_at)) - Number(Boolean(a.deleted_at)));
        return { rows: ordered, rowCount: ordered.length };
      }
      if (sql.startsWith('DELETE FROM notifications WHERE id = ANY')) {
        const ids: string[] = params[0] || [];
        for (let i = rows.length - 1; i >= 0; i--) {
          if (ids.includes(rows[i].id)) rows.splice(i, 1);
        }
        return { rows: [], rowCount: ids.length };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const result = await ensureNotificationsSchemaAndIndexes(mockDb);
  assert.equal(result.deduplicatedGroups, 1);
  assert.equal(result.removedDuplicateRows, 1);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].deleted_at, 'Preserved surviving duplicate row must keep deleted_at');
  assert.ok(executedDdls.some((s) => s.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key_unique')));
});

test('frontend swrValidInPage reload guard: stale pre-delete notifications in sessionStorage never serve across reload in Neon mode', async () => {
  const n1 = { id: 'REL_N1', isRead: false, createdAt: '2026-11-25T10:00:00Z' };
  const n2 = { id: 'REL_N2', isRead: false, createdAt: '2026-11-25T11:00:00Z' };
  let deletedOnServer = false;

  const mockResp = (obj: any) => ({
    ok: true,
    status: 200,
    headers: { get: (k: string) => (String(k || '').toLowerCase() === 'content-type' ? 'application/json' : '') },
    text: async () => JSON.stringify(obj),
    json: async () => obj
  });

  const sharedLocalStore: Record<string, string> = {
    rg_crm_backend_mode_v1: 'neon',
    rg_crm_backend_url: '/api/crm',
    rg_crm_session_token: 'tok_reload_test'
  };
  const sharedSessionStore: Record<string, string> = {};

  const fetchImpl = async (url: any, init: any) => {
    const urlStr = String(url || '');
    if (urlStr.includes('/api/health') || urlStr.includes('serverCapabilities')) {
      return mockResp({ ok: true, databaseConfigured: true, mode: 'neon', backendApiUrl: '/api/crm' });
    }
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.action === 'deleteNotification') {
      deletedOnServer = true;
      return mockResp({
        success: true,
        data: { deleted: true, deletedCount: 1, deletedIds: ['REL_N1'], items: [n2], unreadCount: 1 }
      });
    }
    if (body.action === 'getNotifications') {
      const items = deletedOnServer ? [n2] : [n1, n2];
      return mockResp({ success: true, data: { items, unreadCount: items.length } });
    }
    return mockResp({ success: true, data: {} });
  };

  // First page load: prime notifications, mark notifications scope stale (which sets swrValidInPage=true in memory), persist
  const page1 = loadApiSandbox({ mode: 'neon', localStore: sharedLocalStore, sessionStore: sharedSessionStore, fetchImpl });
  await page1.ctx.RGApi.callApi('getNotifications', {});
  await page1.ctx.RGApi.markScopesStale(['notifications']);
  await page1.ctx.RGApi.flushPersistApiCache?.();

  // Verify persisted sessionStorage NEVER contains swrValidInPage: true
  const rawSwr = sharedSessionStore.rg_crm_swr_v1 || '{}';
  assert.equal(rawSwr.includes('"swrValidInPage":true'), false, 'Persisted cache must strip swrValidInPage');

  // Inject a poisoned swrValidInPage + stale [n1, n2] entry in sessionStorage to simulate legacy browser storage before upgrade
  const parsedSwr = JSON.parse(rawSwr);
  for (const k of Object.keys(parsedSwr)) {
    parsedSwr[k].swrValidInPage = true;
    parsedSwr[k].response.data = { items: [n1, n2], unreadCount: 2 };
  }
  sharedSessionStore.rg_crm_swr_v1 = JSON.stringify(parsedSwr);
  deletedOnServer = true;

  // Fresh page load must NOT serve stale [n1, n2]; it must revalidate and exclude deleted REL_N1
  const page2 = loadApiSandbox({ mode: 'neon', localStore: sharedLocalStore, sessionStore: sharedSessionStore, fetchImpl });
  const reloadedNotifs = await page2.ctx.RGApi.callApi('getNotifications', {});
  assert.equal(reloadedNotifs.success, true);
  assert.deepEqual(Array.from(reloadedNotifs.data.items, (n: any) => n.id), ['REL_N2']);
});

test('GAS NeonSync.gs mirror sync: deleteNotification handles personal soft-deletes, shared dismissals, and deleteAll across sheets', () => {
  const notificationsSheet: any[] = [
    { id: 'NTF_P1', recipientEmployeeId: 'EMP_A', recipientRole: '', title: 'Personal', deletedAt: '', deletedById: '', dismissedByJson: '' },
    { id: 'NTF_P2', recipientEmployeeId: 'EMP_A', recipientRole: '', title: 'Personal 2', deletedAt: '', deletedById: '', dismissedByJson: '' },
    { id: 'NTF_SH', recipientEmployeeId: '', recipientRole: 'agent', title: 'Shared Agent', deletedAt: '', deletedById: '', dismissedByJson: '' },
    { id: 'NTF_ALL', recipientEmployeeId: '', recipientRole: 'all', title: 'Shared All', deletedAt: '', deletedById: '', dismissedByJson: '' },
    { id: 'NTF_OTHER', recipientEmployeeId: 'EMP_B', recipientRole: '', title: 'Other Emp', deletedAt: '', deletedById: '', dismissedByJson: '' }
  ];

  const gasCtx: any = {
    console, Date, JSON, Object, Array, String, Number, Boolean,
    RG_SHEETS: { NOTIFICATIONS: 'Notifications' },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => (k === 'SYNC_API_SECRET' ? 'test-secret' : ''), setProperties: () => {} }) },
    normalizeStr: (v: any) => (v === null || v === undefined ? '' : String(v).trim()),
    toBool: (v: any) => v === true || String(v).toLowerCase() === 'true',
    nowIso: () => '2026-11-26T12:00:00.000Z',
    generateId: (p: string) => `${p}_1`,
    getCacheVersion_: () => '1',
    bumpCacheVersion_: () => {},
    readRecentRecords_: () => notificationsSheet,
    updateRecordsWhere_: (_sheet: string, pred: (r: any) => boolean, patchOrFn: any) => {
      const updated: any[] = [];
      for (const row of notificationsSheet) {
        if (pred(row)) {
          const patch = typeof patchOrFn === 'function' ? patchOrFn(row) : patchOrFn;
          Object.assign(row, patch);
          updated.push(row);
        }
      }
      return updated;
    },
    withScriptLock: (fn: () => any) => fn(),
    batchUpsertRecords: () => {},
    clearSheetRecords: () => {}
  };

  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/Notifications.gs'), 'utf8'), gasCtx);
  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), 'google-apps-script/NeonSync.gs'), 'utf8'), gasCtx);

  // 1) Mirror single shared + personal deletion for EMP_A
  gasCtx.handleNeonMirrorSync_({
    syncSecret: 'test-secret',
    items: [{
      action: 'deleteNotification',
      payload: {
        id: 'NTF_P1',
        deletedIds: ['NTF_P1'],
        dismissedSharedIds: ['NTF_SH'],
        deleteAll: false,
        recipientEmployeeId: 'EMP_A',
        userRole: 'agent',
        deletedById: 'EMP_A',
        deletedAt: '2026-11-26T12:00:00.000Z'
      }
    }]
  });

  const aAfterSingle = gasCtx.getNotifications({ employeeId: 'EMP_A', role: 'agent' });
  assert.deepEqual(Array.from(aAfterSingle.items, (x: any) => x.id).sort(), ['NTF_ALL', 'NTF_P2']);
  // Agent B must still see shared NTF_SH!
  const bAfterSingle = gasCtx.getNotifications({ employeeId: 'EMP_B', role: 'agent' });
  assert.deepEqual(Array.from(bAfterSingle.items, (x: any) => x.id).sort(), ['NTF_ALL', 'NTF_OTHER', 'NTF_SH']);

  // 2) Mirror deleteAll for EMP_A -> dismisses NTF_ALL for EMP_A and deletes NTF_P2, leaving EMP_B untouched
  gasCtx.handleNeonMirrorSync_({
    syncSecret: 'test-secret',
    items: [{
      action: 'deleteNotification',
      payload: {
        id: '',
        deletedIds: ['NTF_P2'],
        dismissedSharedIds: ['NTF_ALL'],
        deleteAll: true,
        recipientEmployeeId: 'EMP_A',
        userRole: 'agent',
        deletedById: 'EMP_A',
        deletedAt: '2026-11-26T12:01:00.000Z'
      }
    }]
  });

  const aAfterAll = gasCtx.getNotifications({ employeeId: 'EMP_A', role: 'agent' });
  assert.equal(aAfterAll.items.length, 0);
  const bAfterAll = gasCtx.getNotifications({ employeeId: 'EMP_B', role: 'agent' });
  assert.deepEqual(Array.from(bAfterAll.items, (x: any) => x.id).sort(), ['NTF_ALL', 'NTF_OTHER', 'NTF_SH']);
});
