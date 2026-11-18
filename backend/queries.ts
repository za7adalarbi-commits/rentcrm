import crypto from 'node:crypto';
import {
  crmCore,
  generateId,
  hashPassword,
  mapEmployeeRow,
  normalizeLoginUsername,
  parseJsonArray,
  requireApiAccess,
  requirePermission,
  revokeEmployeeSessions,
  type AuthSession
} from './auth';
import type { DbClient, DbExecutor } from './db';
import {
  enqueueSheetsMirror,
  flushSheetsMirrorOutbox,
  ingestIncrementalSyncBatch,
  mapExtensionRowToClient,
  mapReservationRowToClient,
  pullFromRentalGateDirect
} from './syncService';

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseJsonValue<T>(val: any, fallback: T): T {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val as T;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function formatProblemRow(row: any, updatesByProblemId?: Map<string, any[]>): Record<string, any> {
  const obj = {
    id: str(row.id),
    problemNumber: str(row.problem_number ?? row.problemNumber),
    reservationId: str(row.reservation_id ?? row.reservationId),
    reservationNumber: str(row.reservation_number ?? row.reservationNumber),
    customerName: str(row.customer_name ?? row.customerName),
    createdById: str(row.created_by_id ?? row.createdById),
    createdByName: str(row.created_by_name ?? row.createdByName),
    assignedEmployeeIds: parseJsonArray<string>(row.assigned_employee_ids ?? row.assignedEmployeeIds),
    assignedEmployeeNames: parseJsonArray<string>(row.assigned_employee_names ?? row.assignedEmployeeNames),
    description: str(row.description),
    priority: str(row.priority || 'متوسط'),
    status: str(row.status || 'جديدة'),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
  };
  if (updatesByProblemId) {
    return { ...obj, updates: updatesByProblemId.get(obj.id) || [] };
  }
  return obj;
}

function formatFollowUpRow(row: any): Record<string, any> {
  return {
    id: str(row.id),
    reservationId: str(row.reservation_id),
    reservationNumber: str(row.reservation_number),
    customerName: str(row.customer_name),
    employeeId: str(row.employee_id),
    employeeName: str(row.employee_name),
    status: str(row.status),
    action: str(row.action),
    notes: str(row.notes),
    followUpDate: str(row.follow_up_date),
    followUpTime: str(row.follow_up_time),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at)
  };
}

function formatFollowUpHistoryRow(row: any): Record<string, any> {
  return {
    id: str(row.id),
    followUpId: str(row.follow_up_id),
    reservationId: str(row.reservation_id),
    reservationNumber: str(row.reservation_number),
    employeeId: str(row.employee_id),
    employeeName: str(row.employee_name),
    changeType: str(row.change_type),
    previousStatus: str(row.previous_status),
    newStatus: str(row.new_status),
    previousAction: str(row.previous_action),
    newAction: str(row.new_action),
    previousNotes: str(row.previous_notes),
    newNotes: str(row.new_notes),
    changedAt: row.changed_at instanceof Date ? row.changed_at.toISOString() : str(row.changed_at)
  };
}

function formatProblemUpdateRow(row: any): Record<string, any> {
  return {
    id: str(row.id),
    problemId: str(row.problem_id),
    reservationNumber: str(row.reservation_number),
    employeeId: str(row.employee_id),
    employeeName: str(row.employee_name),
    previousStatus: str(row.previous_status),
    newStatus: str(row.new_status),
    previousPriority: str(row.previous_priority),
    newPriority: str(row.new_priority),
    note: str(row.note),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at)
  };
}

async function logActivity(
  client: DbClient,
  actor: { id: string; name: string; role?: string },
  actionType: string,
  entityType: string,
  entityId: string,
  details: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await client.query(
    `INSERT INTO activity_log (id, user_id, user_name, user_role, action_type, entity_type, entity_id, details, log_date, log_time, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
    [
      generateId('ACT'),
      actor.id || 'SYSTEM',
      actor.name || 'النظام',
      actor.role || 'system',
      actionType,
      entityType,
      entityId,
      details,
      nowIso.slice(0, 10),
      nowIso.slice(11, 19),
      nowIso
    ]
  );
}

async function createNotification(
  client: DbClient,
  opts: {
    recipientEmployeeId?: string;
    recipientRole?: string;
    type: string;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (id, recipient_employee_id, recipient_role, type, title, message, entity_type, entity_id, is_read, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW())`,
    [
      generateId('NTF'),
      str(opts.recipientEmployeeId),
      str(opts.recipientRole),
      str(opts.type || 'info'),
      str(opts.title),
      str(opts.message),
      str(opts.entityType),
      str(opts.entityId)
    ]
  );
}

export async function getSettingsMap(client: DbClient): Promise<Record<string, any>> {
  const res = await client.query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const map: Record<string, any> = {};
  for (const row of res.rows) {
    const raw = row.value;
    if (raw === 'true') map[row.key] = true;
    else if (raw === 'false') map[row.key] = false;
    else if (typeof raw === 'string' && (raw.startsWith('[') || raw.startsWith('{'))) {
      map[row.key] = parseJsonValue(raw, raw);
    } else if (raw !== '' && !isNaN(Number(raw)) && !/^0\d+/.test(raw)) {
      map[row.key] = Number(raw);
    } else {
      map[row.key] = raw;
    }
  }
  return map;
}

async function getRolePresetsFromDb(client: DbClient): Promise<any[]> {
  const res = await client.query(`SELECT * FROM roles ORDER BY id ASC`);
  if (res.rows.length === 0) {
    return crmCore.JOB_ROLE_PRESETS.slice();
  }
  return res.rows.map((r) => ({
    id: str(r.id),
    label: str(r.label),
    jobTitle: str(r.job_title),
    role: str(r.role || 'agent'),
    permissions: parseJsonArray<string>(r.permissions)
  }));
}

async function getPermissionDefsFromDb(client: DbClient): Promise<any[]> {
  const res = await client.query(`SELECT * FROM permissions ORDER BY "group" ASC, key ASC`);
  return res.rows.map((r) => ({
    key: str(r.key),
    label: str(r.label),
    group: str(r.group || 'مخصص'),
    isCustom: r.is_custom !== false
  }));
}

export async function ensureSeededDatabase(executor: DbExecutor): Promise<void> {
  const countRes = await executor.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM employees`);
  const cnt = Number(countRes.rows[0]?.cnt || 0);
  if (cnt > 0) return;

  const nowIso = new Date().toISOString();
  const seeds = [
    {
      id: 'EMP_ADMIN',
      name: 'فهد الدوسري',
      username: 'admin',
      password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
      salt: 'RG_SEED_ADMIN',
      phone: '0501122334',
      email: 'admin@rentalgate.net',
      jobTitle: 'المدير العام',
      role: 'general_manager',
      permissions: ['all']
    },
    {
      id: 'EMP_SUP1',
      name: 'سارة العتيبي',
      username: 'supervisor',
      password: process.env.SEED_SUPERVISOR_PASSWORD || 'Super@123',
      salt: 'RG_SEED_SUP1',
      phone: '0554433221',
      email: 'sara@rentalgate.net',
      jobTitle: 'مشرفة خدمة العملاء',
      role: 'supervisor',
      permissions: ['supervisor']
    },
    {
      id: 'EMP_AG1',
      name: 'خالد الحربي',
      username: 'agent1',
      password: process.env.SEED_AGENT_PASSWORD || 'Agent@123',
      salt: 'RG_SEED_AG1',
      phone: '0549988776',
      email: 'khalid@rentalgate.net',
      jobTitle: 'أخصائي حجوزات أول',
      role: 'agent',
      permissions: ['agent']
    },
    {
      id: 'EMP_AG2',
      name: 'نورة القحطاني',
      username: 'agent2',
      password: process.env.SEED_AGENT_PASSWORD || 'Agent@123',
      salt: 'RG_SEED_AG2',
      phone: '0567788990',
      email: 'noura@rentalgate.net',
      jobTitle: 'موظفة متابعة العملاء',
      role: 'agent',
      permissions: ['agent']
    }
  ];

  await executor.withTransaction(async (tx) => {
    for (const s of seeds) {
      const pHash = hashPassword(s.password, s.salt);
      await tx.query(
        `INSERT INTO employees (id, name, username, password_hash, salt, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'active',$11,$12::timestamptz,$12::timestamptz)
         ON CONFLICT (username) DO NOTHING`,
        [s.id, s.name, s.username, pHash, s.salt, s.phone, s.email, s.jobTitle, s.role, JSON.stringify(s.permissions), nowIso, nowIso]
      );
      await tx.query(
        `INSERT INTO users (id, name, username, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',$9,$10::timestamptz,$10::timestamptz)
         ON CONFLICT (username) DO NOTHING`,
        [s.id, s.name, s.username, s.phone, s.email, s.jobTitle, s.role, JSON.stringify(s.permissions), nowIso, nowIso]
      );
    }

    const defaultSettings: Array<[string, string]> = [
      ['company_name', 'Rental Gate CRM'],
      ['excluded_statuses', JSON.stringify(['cancelled', 'canceled', 'declined', 'rejected'])],
      ['session_ttl_hours', '12'],
      ['allow_agent_view_all', 'true'],
      ['default_language', 'ar'],
      ['auto_sync_enabled', 'true'],
      ['auto_sync_interval_hours', '12']
    ];
    for (const [key, value] of defaultSettings) {
      await tx.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, 'SYSTEM', NOW())
         ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    for (const preset of crmCore.JOB_ROLE_PRESETS) {
      await tx.query(
        `INSERT INTO roles (id, label, job_title, role, permissions, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,'SYSTEM',NOW())
         ON CONFLICT (id) DO NOTHING`,
        [preset.id, preset.label, preset.jobTitle, preset.role, JSON.stringify(preset.permissions)]
      );
    }
  });
}

// ---------- DASHBOARD & BOOTSTRAP ----------

export async function getDashboard(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
): Promise<Record<string, any>> {
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const today = new Date().toISOString().slice(0, 10);

  const range = str(payload.range);
  let dateFrom = str(payload.dateFrom);
  let dateTo = str(payload.dateTo);
  if (!dateFrom && !dateTo) {
    if (range === 'today') {
      dateFrom = today;
      dateTo = today;
    } else if (range === '7d') {
      dateFrom = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      dateTo = today;
    } else if (range === '30d') {
      dateFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      dateTo = today;
    }
  }

  const resParams: any[] = [];
  const resClauses: string[] = [];

  if (session.user.role === 'agent' && !allowAgentViewAll) {
    resParams.push(JSON.stringify([session.user.id]));
    resClauses.push(`assigned_employee_ids @> $${resParams.length}::jsonb`);
  }
  if (dateFrom) {
    resParams.push(dateFrom);
    resClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) >= $${resParams.length}`);
  }
  if (dateTo) {
    resParams.push(dateTo);
    resClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) <= $${resParams.length}`);
  }

  const resWhere = resClauses.length ? `WHERE ${resClauses.join(' AND ')}` : '';
  const resQuery = await executor.query(
    `SELECT id, start_date, created_at, internal_status, company_name, assigned_employee_ids
     FROM reservations ${resWhere}`,
    resParams
  );

  const statusCounts: Record<string, number> = {};
  for (const s of crmCore.FOLLOWUP_STATUSES) {
    statusCounts[s] = 0;
  }

  const companyCounts: Record<string, number> = {};
  let todayReservations = 0;
  let newReservations = 0;

  for (const r of resQuery.rows) {
    const st = str(r.internal_status || 'تم الإنشاء');
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const cDate = r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : str(r.created_at).slice(0, 10);
    const sDate = str(r.start_date).slice(0, 10);
    if (cDate === today || sDate === today) todayReservations++;
    if (st === 'تم الإنشاء' || st === 'جديد' || st === 'قيد الانتظار') newReservations++;
    const comp = str(r.company_name || 'غير محدد');
    companyCounts[comp] = (companyCounts[comp] || 0) + 1;
  }

  const fuQuery = await executor.query(
    `SELECT employee_name, follow_up_date FROM follow_ups`
  );
  let todayFollowUps = 0;
  const dailyFollowUps: Record<string, number> = {};
  const empFollowUpCounts: Record<string, number> = {};
  for (const fu of fuQuery.rows) {
    const fDate = str(fu.follow_up_date);
    if (fDate === today) todayFollowUps++;
    if (dateFrom && fDate < dateFrom) continue;
    if (dateTo && fDate > dateTo) continue;
    dailyFollowUps[fDate] = (dailyFollowUps[fDate] || 0) + 1;
    empFollowUpCounts[str(fu.employee_name)] = (empFollowUpCounts[str(fu.employee_name)] || 0) + 1;
  }

  const prbQuery = await executor.query(`SELECT status, priority FROM problems`);
  let openProblems = 0;
  let closedProblems = 0;
  let highProblems = 0;
  const problemPriorities: Record<string, number> = { 'عادي': 0, 'متوسط': 0, 'مرتفع': 0 };
  for (const pr of prbQuery.rows) {
    const isClosed = pr.status === 'مغلقة' || pr.status === 'تم الحل';
    if (isClosed) closedProblems++;
    else openProblems++;
    if (pr.priority === 'مرتفع' && !isClosed) highProblems++;
    if (Object.prototype.hasOwnProperty.call(problemPriorities, pr.priority)) {
      problemPriorities[pr.priority]++;
    }
  }

  const empQuery = await executor.query(`SELECT id, name, status FROM employees WHERE status = 'active'`);
  const employeeComparison = empQuery.rows.map((emp) => {
    let assignedCount = 0;
    for (const r of resQuery.rows) {
      const ids = parseJsonArray<string>(r.assigned_employee_ids);
      if (ids.includes(str(emp.id))) assignedCount++;
    }
    return {
      name: str(emp.name),
      followUps: empFollowUpCounts[str(emp.name)] || 0,
      assigned: assignedCount
    };
  });

  const metrics = {
    kpis: {
      totalReservations: resQuery.rows.length,
      todayReservations,
      newReservations,
      booked: statusCounts['تم الحجز'] || 0,
      delivered: statusCounts['تم التسليم'] || 0,
      received: statusCounts['تم الاستلام'] || 0,
      created: statusCounts['تم الإنشاء'] || 0,
      cancelled: statusCounts['تم الإلغاء'] || 0,
      extended: statusCounts['تم التمديد'] || 0,
      notBooked: statusCounts['لم يتم الحجز'] || 0,
      openProblems,
      highProblems,
      todayFollowUps
    },
    charts: {
      statusDistribution: statusCounts,
      employeePerformance: empFollowUpCounts,
      dailyFollowUps,
      problemsByPriority: problemPriorities,
      problemsOpenVsClosed: { open: openProblems, closed: closedProblems },
      reservationsByCompany: companyCounts,
      employeeComparison
    }
  };

  const recentActivityRes = await executor.query(
    `SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 8`
  );
  const recentActivity = recentActivityRes.rows.map((l) => ({
    id: str(l.id),
    userId: str(l.user_id),
    userName: str(l.user_name),
    userRole: str(l.user_role),
    actionType: str(l.action_type),
    entityType: str(l.entity_type),
    entityId: str(l.entity_id),
    details: str(l.details),
    logDate: str(l.log_date),
    logTime: str(l.log_time),
    createdAt: l.created_at instanceof Date ? l.created_at.toISOString() : str(l.created_at)
  }));

  let lastSync: any = null;
  if (crmCore.canAccessApi(session.user)) {
    const syncRes = await executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1`);
    if (syncRes.rows[0]) {
      const s = syncRes.rows[0];
      lastSync = {
        id: str(s.id),
        triggeredById: str(s.triggered_by_id),
        triggeredByName: str(s.triggered_by_name),
        status: str(s.status),
        importedCount: num(s.imported_count),
        updatedCount: num(s.updated_count),
        extensionsCount: num(s.extensions_count),
        pagesFetched: num(s.pages_fetched),
        errorMessage: str(s.error_message),
        durationMs: num(s.duration_ms),
        startedAt: s.started_at instanceof Date ? s.started_at.toISOString() : str(s.started_at),
        finishedAt: s.finished_at instanceof Date ? s.finished_at.toISOString() : str(s.finished_at)
      };
    }
  }

  return {
    ...metrics,
    recentActivity,
    lastSync
  };
}

export async function getNotifications(executor: DbExecutor, session: AuthSession) {
  const res = await executor.query(
    `SELECT * FROM notifications
     WHERE recipient_employee_id = $1 OR recipient_role = $2 OR recipient_role = 'all'
     ORDER BY created_at DESC
     LIMIT 60`,
    [session.user.id, session.user.role]
  );
  const items = res.rows.map((n) => ({
    id: str(n.id),
    recipientEmployeeId: str(n.recipient_employee_id),
    recipientRole: str(n.recipient_role),
    type: str(n.type),
    title: str(n.title),
    message: str(n.message),
    entityType: str(n.entity_type),
    entityId: str(n.entity_id),
    isRead: Boolean(n.is_read),
    createdAt: n.created_at instanceof Date ? n.created_at.toISOString() : str(n.created_at)
  }));
  return {
    items,
    unreadCount: items.filter((n) => !n.isRead).length
  };
}

export async function getAppBootstrap(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const [dashboard, notifications, settings] = await Promise.all([
    getDashboard(executor, session, { range: payload.range || '' }),
    getNotifications(executor, session),
    getSettingsMap(executor)
  ]);

  let settingsOut: any = null;
  if (crmCore.canAccessApi(session.user)) {
    settingsOut = {
      ...settings,
      auto_sync_enabled: settings.auto_sync_enabled !== false,
      auto_sync_interval_hours: num(settings.auto_sync_interval_hours, 12),
      hasRgToken: Boolean(process.env.RG_TOKEN || process.env.GAS_WEBAPP_URL)
    };
  }

  return {
    me: { user: session.user },
    dashboard,
    notifications,
    settings: settingsOut
  };
}

// ---------- RESERVATIONS (100k+ SCALABLE PARAMETERIZED SQL) ----------

export async function getReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;

  const params: any[] = [];
  const clauses: string[] = [];

  if (session.user.role === 'agent' && !allowAgentViewAll) {
    params.push(JSON.stringify([session.user.id]));
    clauses.push(`r.assigned_employee_ids @> $${params.length}::jsonb`);
  }

  if (payload.employeeId) {
    params.push(JSON.stringify([str(payload.employeeId)]));
    clauses.push(`r.assigned_employee_ids @> $${params.length}::jsonb`);
  }

  if (payload.status) {
    params.push(str(payload.status));
    clauses.push(`r.internal_status = $${params.length}`);
  }

  if (payload.priority) {
    params.push(str(payload.priority));
    clauses.push(`r.priority = $${params.length}`);
  }

  if (payload.company) {
    params.push(str(payload.company));
    clauses.push(`r.company_name = $${params.length}`);
  }

  if (payload.branch) {
    params.push(str(payload.branch));
    clauses.push(`r.branch_name = $${params.length}`);
  }

  if (payload.dateFrom) {
    params.push(str(payload.dateFrom));
    clauses.push(`r.start_date >= $${params.length}`);
  }

  if (payload.dateTo) {
    params.push(str(payload.dateTo));
    clauses.push(`r.start_date <= $${params.length}`);
  }

  if (toBool(payload.hasProblem)) {
    clauses.push(`r.has_problem = TRUE`);
  }

  if (toBool(payload.hasExtensions)) {
    clauses.push(`r.has_extensions = TRUE`);
  }

  if (toBool(payload.unfollowedOnly)) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id)`);
  }

  if (payload.search) {
    params.push(`%${str(payload.search)}%`);
    const pIdx = params.length;
    clauses.push(`(
      r.reservation_number ILIKE $${pIdx} OR
      r.customer_name ILIKE $${pIdx} OR
      r.customer_phone ILIKE $${pIdx} OR
      r.car_name ILIKE $${pIdx} OR
      r.plate_number ILIKE $${pIdx} OR
      r.branch_name ILIKE $${pIdx} OR
      r.company_name ILIKE $${pIdx}
    )`);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  let orderSql = 'r.updated_at DESC';
  if (payload.sortBy === 'startDate_desc') orderSql = 'r.start_date DESC, r.updated_at DESC';
  else if (payload.sortBy === 'startDate_asc') orderSql = 'r.start_date ASC, r.updated_at DESC';
  else if (payload.sortBy === 'totalAmount_desc') orderSql = 'r.total_amount DESC, r.updated_at DESC';

  const page = Math.max(1, num(payload.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(payload.pageSize, 25)));
  const offset = (page - 1) * pageSize;

  const countRes = await executor.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM reservations r ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.cnt || 0);

  const listParams = [...params, pageSize, offset];
  const rowsRes = await executor.query(
    `SELECT r.*,
            EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
     FROM reservations r
     ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const [compFacets, branchFacets] = await Promise.all([
    executor.query<{ company_name: string }>(
      `SELECT DISTINCT company_name FROM reservations WHERE company_name <> '' ORDER BY company_name ASC LIMIT 200`
    ),
    executor.query<{ branch_name: string }>(
      `SELECT DISTINCT branch_name FROM reservations WHERE branch_name <> '' ORDER BY branch_name ASC LIMIT 300`
    )
  ]);

  return {
    items: rowsRes.rows.map((r) => mapReservationRowToClient(r, false)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: {
      companies: compFacets.rows.map((c) => c.company_name),
      branches: branchFacets.rows.map((b) => b.branch_name)
    }
  };
}

export async function syncLocalCache(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const maxItems = Math.min(5000, Math.max(200, num(payload.limit, 2500)));

  const resParams: any[] = [maxItems];
  const resWhere = session.user.role === 'agent' && !allowAgentViewAll
    ? (resParams.push(JSON.stringify([session.user.id])), `WHERE r.assigned_employee_ids @> $2::jsonb`)
    : '';

  const [resRows, extRows, fuRows, prbRows] = await Promise.all([
    executor.query(
      `SELECT r.id, r.source_reservation_id, r.reservation_number, r.source_created_at,
              r.customer_name, r.customer_phone, r.customer_email, r.customer_id_number,
              r.company_name, r.branch_name, r.deliver_branch_name, r.car_name, r.plate_number, r.car_category,
              r.start_date, r.start_time, r.original_end_date, r.original_end_time, r.end_date, r.end_time,
              r.extended_until_date, r.extended_until_time, r.days_count, r.extended_days_count, r.total_days_count,
              r.original_status_code, r.original_status_ar, r.pickup_type_ar, r.return_type_ar,
              r.payment_method, r.payment_status, r.daily_price, r.discount_amount, r.vat_amount,
              r.base_amount, r.extensions_count, r.extensions_amount, r.total_amount, r.has_extensions,
              r.internal_status, r.priority, r.assigned_employee_ids, r.assigned_employee_names,
              r.last_update_text, r.last_updated_by_id, r.last_updated_by_name, r.last_updated_at,
              r.has_problem, r.created_at, r.updated_at, r.status_history,
              EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       ${resWhere}
       ORDER BY r.updated_at DESC
       LIMIT $1`,
      resParams
    ),
    executor.query(`SELECT * FROM extensions ORDER BY sequence_number ASC, start_date ASC LIMIT 5000`),
    executor.query(`SELECT * FROM follow_ups ORDER BY created_at DESC LIMIT 1500`),
    executor.query(`SELECT * FROM problems ORDER BY updated_at DESC LIMIT 500`)
  ]);

  const reservations = resRows.rows.map((r) => mapReservationRowToClient(r, false));
  const extensions = extRows.rows.map(mapExtensionRowToClient);
  const followUps = fuRows.rows.map(formatFollowUpRow);
  const problems = prbRows.rows.map((p) => formatProblemRow(p));

  return {
    reservations,
    extensions,
    followUps,
    problems,
    totalReservations: reservations.length,
    allowAgentViewAll,
    syncedAt: new Date().toISOString()
  };
}

export async function getReservationDetails(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const idOrNum = str(payload.reservationId || payload.reservationNumber || payload.id);
  if (!idOrNum) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const resQuery = await executor.query(
    `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $1 LIMIT 1`,
    [idOrNum]
  );
  const row = resQuery.rows[0];
  if (!row) throw new Error('NOT_FOUND: الحجز غير موجود.');

  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const reservation = mapReservationRowToClient(row, false);
  if (
    session.user.role === 'agent' &&
    !allowAgentViewAll &&
    !reservation.assignedEmployeeIds.includes(session.user.id)
  ) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية عرض هذا الحجز.');
  }

  const [extRes, asnRes, fuRes, fuhRes, prbRes] = await Promise.all([
    executor.query(
      `SELECT * FROM extensions
       WHERE reservation_id = $1 OR reservation_number = $2
          OR ($3 <> '' AND source_reservation_id = $3)
       ORDER BY sequence_number ASC, start_date ASC`,
      [reservation.id, reservation.reservationNumber, reservation.sourceReservationId]
    ),
    executor.query(
      `SELECT * FROM assignments WHERE reservation_id = $1 AND status = 'active'`,
      [reservation.id]
    ),
    executor.query(
      `SELECT * FROM follow_ups WHERE reservation_id = $1 ORDER BY created_at DESC`,
      [reservation.id]
    ),
    executor.query(
      `SELECT * FROM follow_up_history WHERE reservation_id = $1 ORDER BY changed_at DESC`,
      [reservation.id]
    ),
    executor.query(
      `SELECT * FROM problems WHERE reservation_id = $1 ORDER BY updated_at DESC`,
      [reservation.id]
    )
  ]);

  let problemUpdates: any[] = [];
  if (prbRes.rows.length > 0) {
    const pIds = prbRes.rows.map((p) => p.id);
    const puRes = await executor.query(
      `SELECT * FROM problem_updates WHERE problem_id = ANY($1::text[]) ORDER BY created_at DESC`,
      [pIds]
    );
    problemUpdates = puRes.rows.map(formatProblemUpdateRow);
  }

  reservation.isFollowed = fuRes.rows.length > 0;

  return {
    reservation,
    extensions: extRes.rows.map(mapExtensionRowToClient),
    assignments: asnRes.rows.map((a) => ({
      id: str(a.id),
      reservationId: str(a.reservation_id),
      reservationNumber: str(a.reservation_number),
      employeeId: str(a.employee_id),
      employeeName: str(a.employee_name),
      assignedById: str(a.assigned_by_id),
      assignedByName: str(a.assigned_by_name),
      roleType: str(a.role_type),
      status: str(a.status),
      assignedAt: a.assigned_at instanceof Date ? a.assigned_at.toISOString() : str(a.assigned_at),
      updatedAt: a.updated_at instanceof Date ? a.updated_at.toISOString() : str(a.updated_at)
    })),
    followUps: fuRes.rows.map(formatFollowUpRow),
    followUpHistory: fuhRes.rows.map(formatFollowUpHistoryRow),
    problems: prbRes.rows.map((p) => formatProblemRow(p)),
    problemUpdates
  };
}

// ---------- CLAIM / UNCLAIM / QUICK STATUS / EDIT DETAILS ----------

export async function claimReservation(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'claim_reservation');
  const resId = str(payload.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const result = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');

    const resObj = mapReservationRowToClient(resQuery.rows[0], false);
    const ids: string[] = [...resObj.assignedEmployeeIds];
    const names: string[] = [...resObj.assignedEmployeeNames];
    let added = false;

    if (!ids.includes(session.user.id)) {
      ids.push(session.user.id);
      if (!names.includes(session.user.name)) names.push(session.user.name);
      added = true;
    }

    const nowIso = new Date().toISOString();
    const asnCheck = await tx.query(
      `SELECT id FROM assignments WHERE reservation_id = $1 AND employee_id = $2 AND status = 'active' LIMIT 1`,
      [resId, session.user.id]
    );
    if (asnCheck.rows.length === 0) {
      await tx.query(
        `INSERT INTO assignments (id, reservation_id, reservation_number, employee_id, employee_name, assigned_by_id, assigned_by_name, role_type, status, assigned_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$4,$5,'followup','active',$6::timestamptz,$6::timestamptz)`,
        [generateId('ASN'), resId, resObj.reservationNumber, session.user.id, session.user.name, nowIso]
      );
    }

    const lastUpdateText = added
      ? `استلم ${session.user.name} متابعة الحجز`
      : resObj.lastUpdateText;

    await tx.query(
      `UPDATE reservations
       SET assigned_employee_ids = $2::jsonb,
           assigned_employee_names = $3::jsonb,
           last_update_text = $4,
           last_updated_by_id = $5,
           last_updated_by_name = $6,
           last_updated_at = $7,
           updated_at = $7::timestamptz
       WHERE id = $1`,
      [resId, JSON.stringify(ids), JSON.stringify(names), lastUpdateText, session.user.id, session.user.name, nowIso]
    );

    if (added) {
      await logActivity(tx, session.user, 'استلام حجز', 'Reservation', resObj.reservationNumber, `استلم ${session.user.name} متابعة الحجز`);
    }

    const updated: Record<string, any> = {
      ...resObj,
      assignedEmployeeIds: ids,
      assignedEmployeeNames: names,
      lastUpdateText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso
    };
    await enqueueSheetsMirror(tx, 'Reservation', updated.id, 'upsertReservation', updated);
    return { added, reservation: updated };
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return result;
}

export async function unclaimReservation(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'unclaim_reservation');
  const resId = str(payload.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const result = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');

    const resObj = mapReservationRowToClient(resQuery.rows[0], false);
    const idx = resObj.assignedEmployeeIds.indexOf(session.user.id);
    const ids = resObj.assignedEmployeeIds.filter((id: string) => id !== session.user.id);
    const names = idx !== -1
      ? resObj.assignedEmployeeNames.filter((_: string, i: number) => i !== idx)
      : resObj.assignedEmployeeNames;

    const nowIso = new Date().toISOString();
    await tx.query(
      `UPDATE assignments SET status = 'inactive', updated_at = $3::timestamptz
       WHERE reservation_id = $1 AND employee_id = $2 AND status = 'active'`,
      [resId, session.user.id, nowIso]
    );

    await tx.query(
      `UPDATE reservations
       SET assigned_employee_ids = $2::jsonb,
           assigned_employee_names = $3::jsonb,
           updated_at = $4::timestamptz
       WHERE id = $1`,
      [resId, JSON.stringify(ids), JSON.stringify(names), nowIso]
    );

    if (idx !== -1) {
      await logActivity(tx, session.user, 'إلغاء استلام حجز', 'Reservation', resObj.reservationNumber, `أزال ${session.user.name} نفسه من الحجز`);
    }

    const updated: Record<string, any> = {
      ...resObj,
      assignedEmployeeIds: ids,
      assignedEmployeeNames: names,
      updatedAt: nowIso
    };
    await enqueueSheetsMirror(tx, 'Reservation', updated.id, 'upsertReservation', updated);
    return { removed: idx !== -1, reservation: updated };
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return result;
}

export async function quickUpdateReservationStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'quick_update_status');
  const resId = str(payload.reservationId);
  const newStatus = str(payload.status);
  const note = str(payload.note || payload.notes);
  if (!resId || !newStatus) throw new Error('VALIDATION_ERROR: معرف الحجز والحالة مطلوبان.');
  if (!crmCore.isValidWorkflowStatus(newStatus)) {
    throw new Error('VALIDATION_ERROR: الحالة المحددة غير معتمدة.');
  }

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');

    const resObj = mapReservationRowToClient(resQuery.rows[0], false);
    const prevStatus = str(resObj.internalStatus);
    const nowIso = new Date().toISOString();
    const actionLabel = `تحديث سريع للحالة إلى: ${newStatus}`;
    const lastText = note ? `${actionLabel} — ${note}` : actionLabel;

    const fuObj = {
      id: generateId('FU'),
      reservationId: resObj.id,
      reservationNumber: resObj.reservationNumber,
      customerName: resObj.customerName,
      employeeId: session.user.id,
      employeeName: session.user.name,
      status: newStatus,
      action: actionLabel,
      notes: note,
      followUpDate: nowIso.slice(0, 10),
      followUpTime: nowIso.slice(11, 19),
      createdAt: nowIso
    };

    await tx.query(
      `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
      [fuObj.id, fuObj.reservationId, fuObj.reservationNumber, fuObj.customerName, fuObj.employeeId, fuObj.employeeName, fuObj.status, fuObj.action, fuObj.notes, fuObj.followUpDate, fuObj.followUpTime, fuObj.createdAt]
    );

    const nextHistory = crmCore.appendStatusStageEntry(resObj.statusHistory || [], {
      source: 'quick_status',
      previousStatus: prevStatus,
      newStatus,
      changedAt: nowIso,
      changedById: session.user.id,
      changedByName: session.user.name,
      note: lastText
    });

    await tx.query(
      `UPDATE reservations
       SET internal_status = $2,
           last_update_text = $3,
           last_updated_by_id = $4,
           last_updated_by_name = $5,
           last_updated_at = $6,
           updated_at = $6::timestamptz,
           status_history = $7::jsonb
       WHERE id = $1`,
      [resId, newStatus, lastText, session.user.id, session.user.name, nowIso, JSON.stringify(nextHistory)]
    );

    await logActivity(tx, session.user, 'تحديث حالة سريع', 'Reservation', resObj.reservationNumber, `${prevStatus} → ${newStatus}${note ? ` (${note})` : ''}`);

    const updatedRes: Record<string, any> = {
      ...resObj,
      internalStatus: newStatus,
      lastUpdateText: lastText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      statusHistory: nextHistory,
      isFollowed: true
    };
    await enqueueSheetsMirror(tx, 'FollowUp', fuObj.id, 'appendFollowUp', fuObj);
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return { reservation: updatedRes, followUp: fuObj };
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function updateReservationDetails(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_reservation_details');
  const resId = str(payload.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const existing = mapReservationRowToClient(resQuery.rows[0], false);

    const nextStatus = payload.internalStatus !== undefined ? str(payload.internalStatus) : existing.internalStatus;
    if (payload.internalStatus !== undefined && !crmCore.isValidWorkflowStatus(nextStatus)) {
      throw new Error('VALIDATION_ERROR: الحالة المحددة غير معتمدة.');
    }

    const nowIso = new Date().toISOString();
    let nextHistory = crmCore.normalizeStatusHistory(existing.statusHistory || []);
    if (nextStatus && nextStatus !== existing.internalStatus) {
      nextHistory = crmCore.appendStatusStageEntry(nextHistory, {
        source: 'supervisor_edit',
        previousStatus: existing.internalStatus,
        newStatus: nextStatus,
        changedAt: nowIso,
        changedById: session.user.id,
        changedByName: session.user.name,
        note: payload.lastUpdateText !== undefined ? str(payload.lastUpdateText) : 'تحديث الحالة من المشرف / الإدارة'
      });
    }

    const nextObj: Record<string, any> = {
      ...existing,
      customerName: payload.customerName !== undefined ? str(payload.customerName) : existing.customerName,
      customerPhone: payload.customerPhone !== undefined ? str(payload.customerPhone) : existing.customerPhone,
      companyName: payload.companyName !== undefined ? str(payload.companyName) : existing.companyName,
      branchName: payload.branchName !== undefined ? str(payload.branchName) : existing.branchName,
      carName: payload.carName !== undefined ? str(payload.carName) : existing.carName,
      startDate: payload.startDate !== undefined ? str(payload.startDate) : existing.startDate,
      endDate: payload.endDate !== undefined ? str(payload.endDate) : existing.endDate,
      priority: payload.priority !== undefined ? str(payload.priority) : existing.priority,
      internalStatus: nextStatus,
      lastUpdateText: payload.lastUpdateText !== undefined ? str(payload.lastUpdateText) : `تعديل بيانات الحجز بواسطة ${session.user.name}`,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      statusHistory: nextHistory
    };

    await tx.query(
      `UPDATE reservations
       SET customer_name = $2, customer_phone = $3, company_name = $4, branch_name = $5,
           car_name = $6, start_date = $7, end_date = $8, priority = $9, internal_status = $10,
           last_update_text = $11, last_updated_by_id = $12, last_updated_by_name = $13,
           last_updated_at = $14, updated_at = $14::timestamptz, status_history = $15::jsonb
       WHERE id = $1`,
      [
        resId,
        nextObj.customerName,
        nextObj.customerPhone,
        nextObj.companyName,
        nextObj.branchName,
        nextObj.carName,
        nextObj.startDate,
        nextObj.endDate,
        nextObj.priority,
        nextObj.internalStatus,
        nextObj.lastUpdateText,
        nextObj.lastUpdatedById,
        nextObj.lastUpdatedByName,
        nextObj.lastUpdatedAt,
        JSON.stringify(nextObj.statusHistory)
      ]
    );

    await logActivity(tx, session.user, 'تعديل بيانات حجز', 'Reservation', existing.reservationNumber, 'تعديل تفاصيل الحجز بواسطة المشرف / الإدارة');
    await enqueueSheetsMirror(tx, 'Reservation', nextObj.id, 'upsertReservation', nextObj);
    return nextObj;
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

// ---------- FOLLOW-UPS & ASSIGNMENTS ----------

export async function addFollowUp(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'add_followup');
  const resId = str(payload.reservationId);
  const status = str(payload.status);
  const action = str(payload.action);
  const notes = str(payload.notes);
  if (!resId || !status || !action) throw new Error('VALIDATION_ERROR: الحجز والحالة والإجراء حقول مطلوبة.');
  if (!crmCore.isValidWorkflowStatus(status)) throw new Error('VALIDATION_ERROR: حالة المتابعة غير معتمدة.');

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const resObj = mapReservationRowToClient(resQuery.rows[0], false);

    const nowIso = new Date().toISOString();
    const fuObj = {
      id: generateId('FU'),
      reservationId: resObj.id,
      reservationNumber: resObj.reservationNumber,
      customerName: resObj.customerName,
      employeeId: session.user.id,
      employeeName: session.user.name,
      status,
      action,
      notes,
      followUpDate: nowIso.slice(0, 10),
      followUpTime: nowIso.slice(11, 19),
      createdAt: nowIso
    };

    await tx.query(
      `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
      [fuObj.id, fuObj.reservationId, fuObj.reservationNumber, fuObj.customerName, fuObj.employeeId, fuObj.employeeName, fuObj.status, fuObj.action, fuObj.notes, fuObj.followUpDate, fuObj.followUpTime, fuObj.createdAt]
    );

    const lastText = action + (notes ? ` — ${notes}` : '');
    const nextHistory = crmCore.appendStatusStageEntry(resObj.statusHistory || [], {
      source: 'followup',
      previousStatus: resObj.internalStatus,
      newStatus: status,
      changedAt: nowIso,
      changedById: session.user.id,
      changedByName: session.user.name,
      note: lastText
    });

    await tx.query(
      `UPDATE reservations
       SET internal_status = $2, last_update_text = $3, last_updated_by_id = $4,
           last_updated_by_name = $5, last_updated_at = $6, updated_at = $6::timestamptz,
           status_history = $7::jsonb
       WHERE id = $1`,
      [resId, status, lastText, session.user.id, session.user.name, nowIso, JSON.stringify(nextHistory)]
    );

    await logActivity(tx, session.user, 'إضافة متابعة', 'FollowUp', resObj.reservationNumber, `الحالة: ${status} — ${action}`);

    const updatedRes: Record<string, any> = {
      ...resObj,
      internalStatus: status,
      lastUpdateText: lastText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      statusHistory: nextHistory,
      isFollowed: true
    };
    await enqueueSheetsMirror(tx, 'FollowUp', fuObj.id, 'appendFollowUp', fuObj);
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return { followUp: fuObj, reservation: updatedRes };
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function updateFollowUp(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const followUpId = str(payload.followUpId);
  if (!followUpId) throw new Error('VALIDATION_ERROR: معرف المتابعة مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const fuRes = await tx.query(`SELECT * FROM follow_ups WHERE id = $1 FOR UPDATE`, [followUpId]);
    if (!fuRes.rows[0]) throw new Error('NOT_FOUND: المتابعة غير موجودة.');
    const existing = formatFollowUpRow(fuRes.rows[0]);

    const canEditAny = crmCore.canUserPerform(session.user, 'edit_any_followup');
    if (existing.employeeId !== session.user.id && !canEditAny) {
      throw new Error('FORBIDDEN: لا يمكنك تعديل متابعة موظف آخر.');
    }

    const newStatus = payload.status !== undefined ? str(payload.status) : existing.status;
    if (payload.status !== undefined && !crmCore.isValidWorkflowStatus(newStatus)) {
      throw new Error('VALIDATION_ERROR: الحالة المحددة غير معتمدة.');
    }
    const newAction = payload.action !== undefined ? str(payload.action) : existing.action;
    const newNotes = payload.notes !== undefined ? str(payload.notes) : existing.notes;
    const nowIso = new Date().toISOString();

    await tx.query(
      `UPDATE follow_ups SET status = $2, action = $3, notes = $4 WHERE id = $1`,
      [followUpId, newStatus, newAction, newNotes]
    );

    const hist = {
      id: generateId('FUH'),
      followUpId,
      reservationId: existing.reservationId,
      reservationNumber: existing.reservationNumber,
      employeeId: session.user.id,
      employeeName: session.user.name,
      changeType: existing.employeeId === session.user.id ? 'self_edit' : 'supervisor_edit',
      previousStatus: existing.status,
      newStatus,
      previousAction: existing.action,
      newAction,
      previousNotes: existing.notes,
      newNotes,
      changedAt: nowIso
    };
    await tx.query(
      `INSERT INTO follow_up_history (id, follow_up_id, reservation_id, reservation_number, employee_id, employee_name, change_type, previous_status, new_status, previous_action, new_action, previous_notes, new_notes, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz)`,
      [hist.id, hist.followUpId, hist.reservationId, hist.reservationNumber, hist.employeeId, hist.employeeName, hist.changeType, hist.previousStatus, hist.newStatus, hist.previousAction, hist.newAction, hist.previousNotes, hist.newNotes, hist.changedAt]
    );

    const lastResQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [existing.reservationId]);
    if (lastResQuery.rows[0]) {
      const rObj = mapReservationRowToClient(lastResQuery.rows[0], false);
      const lastText = newAction + (newNotes ? ` — ${newNotes}` : '');
      const nextHistory = newStatus !== rObj.internalStatus
        ? crmCore.appendStatusStageEntry(rObj.statusHistory || [], {
            source: 'followup_edit',
            previousStatus: rObj.internalStatus,
            newStatus,
            changedAt: nowIso,
            changedById: session.user.id,
            changedByName: session.user.name,
            note: lastText
          })
        : rObj.statusHistory;

      await tx.query(
        `UPDATE reservations
         SET internal_status = $2, last_update_text = $3, last_updated_by_id = $4,
             last_updated_by_name = $5, last_updated_at = $6, updated_at = $6::timestamptz,
             status_history = $7::jsonb
         WHERE id = $1`,
        [rObj.id, newStatus, lastText, session.user.id, session.user.name, nowIso, JSON.stringify(nextHistory)]
      );
    }

    await logActivity(tx, session.user, 'تعديل متابعة', 'FollowUp', existing.reservationNumber, `${existing.status} → ${newStatus}`);
    return { followUp: { ...existing, status: newStatus, action: newAction, notes: newNotes }, history: hist };
  });

  return out;
}

export async function getFollowUpHistory(executor: DbExecutor, _session: AuthSession, payload: Record<string, any> = {}) {
  const resId = str(payload.reservationId);
  const fuhRes = resId
    ? await executor.query(`SELECT * FROM follow_up_history WHERE reservation_id = $1 ORDER BY changed_at DESC`, [resId])
    : await executor.query(`SELECT * FROM follow_up_history ORDER BY changed_at DESC LIMIT 200`);
  return { items: fuhRes.rows.map(formatFollowUpHistoryRow) };
}

export async function assignEmployees(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'assign_employees');
  const resId = str(payload.reservationId);
  const targetIds: string[] = Array.isArray(payload.employeeIds)
    ? payload.employeeIds.map((x: any) => str(x)).filter(Boolean)
    : [];
  const roleType = str(payload.roleType || 'followup');
  if (!resId || targetIds.length === 0) {
    throw new Error('VALIDATION_ERROR: يجب تحديد الحجز وموظف واحد على الأقل.');
  }

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const resObj = mapReservationRowToClient(resQuery.rows[0], false);

    const empRes = await tx.query(`SELECT id, name FROM employees WHERE id = ANY($1::text[]) AND status = 'active'`, [targetIds]);
    const empMap = new Map(empRes.rows.map((e) => [str(e.id), str(e.name)]));
    const validIds = targetIds.filter((id) => empMap.has(id));
    const validNames = validIds.map((id) => empMap.get(id)!);
    if (validIds.length === 0) throw new Error('VALIDATION_ERROR: لم يتم العثور على موظفين نشطين.');

    const nowIso = new Date().toISOString();
    const existingActive = await tx.query(
      `SELECT employee_id FROM assignments WHERE reservation_id = $1 AND status = 'active'`,
      [resId]
    );
    const alreadySet = new Set(existingActive.rows.map((r) => str(r.employee_id)));

    for (const eid of validIds) {
      if (!alreadySet.has(eid)) {
        await tx.query(
          `INSERT INTO assignments (id, reservation_id, reservation_number, employee_id, employee_name, assigned_by_id, assigned_by_name, role_type, status, assigned_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9::timestamptz,$9::timestamptz)`,
          [generateId('ASN'), resId, resObj.reservationNumber, eid, empMap.get(eid)!, session.user.id, session.user.name, roleType, nowIso]
        );
        await createNotification(tx, {
          recipientEmployeeId: eid,
          type: 'new_assignment',
          title: 'إسناد حجز جديد',
          message: `تم إسناد الحجز رقم ${resObj.reservationNumber} (${resObj.customerName}) إليك.`,
          entityType: 'Reservation',
          entityId: resObj.id
        });
      }
    }

    const mergedIds = Array.from(new Set([...resObj.assignedEmployeeIds, ...validIds]));
    const empAllRes = await tx.query(`SELECT id, name FROM employees WHERE id = ANY($1::text[])`, [mergedIds]);
    const allMap = new Map(empAllRes.rows.map((e) => [str(e.id), str(e.name)]));
    const mergedNames = mergedIds.map((id) => allMap.get(id) || id);
    const lastText = `إسناد الحجز إلى: ${validNames.join('، ')}`;

    await tx.query(
      `UPDATE reservations
       SET assigned_employee_ids = $2::jsonb, assigned_employee_names = $3::jsonb,
           last_update_text = $4, last_updated_by_id = $5, last_updated_by_name = $6,
           last_updated_at = $7, updated_at = $7::timestamptz
       WHERE id = $1`,
      [resId, JSON.stringify(mergedIds), JSON.stringify(mergedNames), lastText, session.user.id, session.user.name, nowIso]
    );

    await logActivity(tx, session.user, 'إسناد موظفين', 'Reservation', resObj.reservationNumber, lastText);

    const updatedRes: Record<string, any> = {
      ...resObj,
      assignedEmployeeIds: mergedIds,
      assignedEmployeeNames: mergedNames,
      lastUpdateText: lastText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso
    };
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return updatedRes;
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function removeAssignment(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'assign_employees');
  const resId = str(payload.reservationId);
  const employeeId = str(payload.employeeId);
  if (!resId || !employeeId) throw new Error('VALIDATION_ERROR: معرف الحجز والموظف مطلوبان.');

  return executor.withTransaction(async (tx) => {
    const nowIso = new Date().toISOString();
    await tx.query(
      `UPDATE assignments SET status = 'inactive', updated_at = $3::timestamptz WHERE reservation_id = $1 AND employee_id = $2`,
      [resId, employeeId, nowIso]
    );
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const resObj = mapReservationRowToClient(resQuery.rows[0], false);
    const idx = resObj.assignedEmployeeIds.indexOf(employeeId);
    const ids = resObj.assignedEmployeeIds.filter((id: string) => id !== employeeId);
    const names = idx !== -1
      ? resObj.assignedEmployeeNames.filter((_: string, i: number) => i !== idx)
      : resObj.assignedEmployeeNames;

    await tx.query(
      `UPDATE reservations SET assigned_employee_ids = $2::jsonb, assigned_employee_names = $3::jsonb, updated_at = $4::timestamptz WHERE id = $1`,
      [resId, JSON.stringify(ids), JSON.stringify(names), nowIso]
    );
    await logActivity(tx, session.user, 'إلغاء إسناد', 'Reservation', resObj.reservationNumber, `إزالة إسناد الموظف ${employeeId}`);
    return { ...resObj, assignedEmployeeIds: ids, assignedEmployeeNames: names, updatedAt: nowIso };
  });
}

export async function getMyFollowUps(executor: DbExecutor, session: AuthSession, _payload: Record<string, any> = {}) {
  const [resRows, fuRows] = await Promise.all([
    executor.query(
      `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       WHERE r.assigned_employee_ids @> $1::jsonb
       ORDER BY r.updated_at DESC
       LIMIT 500`,
      [JSON.stringify([session.user.id])]
    ),
    executor.query(
      `SELECT * FROM follow_ups WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 300`,
      [session.user.id]
    )
  ]);

  return {
    assignedReservations: resRows.rows.map((r) => mapReservationRowToClient(r, false)),
    followUps: fuRows.rows.map(formatFollowUpRow)
  };
}

export async function getTeamFollowUps(executor: DbExecutor, _session: AuthSession, payload: Record<string, any> = {}) {
  const params: any[] = [];
  const clauses: string[] = [];
  if (payload.employeeId) {
    params.push(str(payload.employeeId));
    clauses.push(`employee_id = $${params.length}`);
  }
  if (payload.status) {
    params.push(str(payload.status));
    clauses.push(`status = $${params.length}`);
  }
  if (payload.dateFrom) {
    params.push(str(payload.dateFrom));
    clauses.push(`follow_up_date >= $${params.length}`);
  }
  if (payload.dateTo) {
    params.push(str(payload.dateTo));
    clauses.push(`follow_up_date <= $${params.length}`);
  }
  if (payload.search) {
    params.push(`%${str(payload.search)}%`);
    const pIdx = params.length;
    clauses.push(`(reservation_number ILIKE $${pIdx} OR customer_name ILIKE $${pIdx} OR action ILIKE $${pIdx} OR notes ILIKE $${pIdx} OR employee_name ILIKE $${pIdx})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const fuRes = await executor.query(`SELECT * FROM follow_ups ${where} ORDER BY created_at DESC LIMIT 500`, params);
  return { items: fuRes.rows.map(formatFollowUpRow) };
}

// ---------- PROBLEMS & TICKETS ----------

export async function createProblem(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'create_problem');
  const resId = str(payload.reservationId);
  const resNumberInput = str(payload.reservationNumber);
  const description = str(payload.description);
  const priority = crmCore.PROBLEM_PRIORITIES.includes(str(payload.priority)) ? str(payload.priority) : 'متوسط';
  if (!description) throw new Error('VALIDATION_ERROR: وصف المشكلة مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    let resObj: any = null;
    if (resId || resNumberInput) {
      const rRes = await tx.query(
        `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $2 LIMIT 1 FOR UPDATE`,
        [resId, resNumberInput]
      );
      if (rRes.rows[0]) resObj = mapReservationRowToClient(rRes.rows[0], false);
    }

    const assignedIdsInput: string[] = Array.isArray(payload.assignedEmployeeIds)
      ? payload.assignedEmployeeIds.map((x: any) => str(x)).filter(Boolean)
      : [];
    const empIds = assignedIdsInput.length ? assignedIdsInput : [session.user.id];
    const empRes = await tx.query(`SELECT id, name FROM employees WHERE id = ANY($1::text[])`, [empIds]);
    const eMap = new Map(empRes.rows.map((e) => [str(e.id), str(e.name)]));
    const empNames = empIds.map((id) => eMap.get(id) || session.user.name);

    const nowIso = new Date().toISOString();
    const prb = {
      id: generateId('PRB'),
      problemNumber: `PRB-${String(Date.now()).slice(-6)}`,
      reservationId: resObj ? resObj.id : resId,
      reservationNumber: resObj ? resObj.reservationNumber : resNumberInput,
      customerName: resObj ? resObj.customerName : str(payload.customerName),
      createdById: session.user.id,
      createdByName: session.user.name,
      assignedEmployeeIds: empIds,
      assignedEmployeeNames: empNames,
      description,
      priority,
      status: 'جديدة',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const insertSql = `
      INSERT INTO %TABLE% (id, problem_number, reservation_id, reservation_number, customer_name, created_by_id, created_by_name, assigned_employee_ids, assigned_employee_names, description, priority, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::timestamptz,$13::timestamptz)
    `;
    const params = [
      prb.id, prb.problemNumber, prb.reservationId || null, prb.reservationNumber, prb.customerName,
      prb.createdById, prb.createdByName, JSON.stringify(prb.assignedEmployeeIds), JSON.stringify(prb.assignedEmployeeNames),
      prb.description, prb.priority, prb.status, nowIso
    ];
    await tx.query(insertSql.replace('%TABLE%', 'problems'), params);
    await tx.query(insertSql.replace('%TABLE%', 'issues'), params);

    await tx.query(
      `INSERT INTO problem_updates (id, problem_id, reservation_number, employee_id, employee_name, previous_status, new_status, previous_priority, new_priority, note, created_at)
       VALUES ($1,$2,$3,$4,$5,'','جديدة','',$6,'فتح تذكرة مشكلة جديدة',$7::timestamptz)`,
      [generateId('PRBU'), prb.id, prb.reservationNumber, session.user.id, session.user.name, prb.priority, nowIso]
    );

    if (resObj) {
      await tx.query(
        `UPDATE reservations
         SET has_problem = TRUE,
             priority = CASE WHEN $2 = 'مرتفع' THEN 'مرتفع' ELSE priority END,
             updated_at = $3::timestamptz
         WHERE id = $1`,
        [resObj.id, prb.priority, nowIso]
      );
    }

    if (prb.priority === 'مرتفع') {
      await createNotification(tx, {
        recipientRole: 'supervisor',
        type: 'high_priority_problem',
        title: `مشكلة عالية الأولوية (${prb.problemNumber})`,
        message: `${prb.customerName || prb.reservationNumber}: ${prb.description.slice(0, 80)}`,
        entityType: 'Problem',
        entityId: prb.id
      });
    }

    await logActivity(tx, session.user, 'فتح مشكلة', 'Problem', prb.problemNumber, prb.description.slice(0, 120));
    await enqueueSheetsMirror(tx, 'Problem', prb.id, 'upsertProblem', prb);
    return { ...prb, updates: [] };
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function updateProblem(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'update_problem');
  const problemId = str(payload.problemId);
  if (!problemId) throw new Error('VALIDATION_ERROR: معرف المشكلة مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const pRes = await tx.query(`SELECT * FROM problems WHERE id = $1 FOR UPDATE`, [problemId]);
    if (!pRes.rows[0]) throw new Error('NOT_FOUND: المشكلة غير موجودة.');
    const existing = formatProblemRow(pRes.rows[0]);

    const nextStatus = payload.status !== undefined ? str(payload.status) : existing.status;
    const nextPrio = payload.priority !== undefined ? str(payload.priority) : existing.priority;
    const nextDesc = payload.description !== undefined && str(payload.description) ? str(payload.description) : existing.description;
    const nextCust = payload.customerName !== undefined && str(payload.customerName) ? str(payload.customerName) : existing.customerName;

    let nextEmpIds = existing.assignedEmployeeIds;
    let nextEmpNames = existing.assignedEmployeeNames;
    if (Array.isArray(payload.assignedEmployeeIds)) {
      nextEmpIds = payload.assignedEmployeeIds.map((x: any) => str(x)).filter(Boolean);
      const empRes = await tx.query(`SELECT id, name FROM employees WHERE id = ANY($1::text[])`, [nextEmpIds]);
      const eMap = new Map(empRes.rows.map((e) => [str(e.id), str(e.name)]));
      nextEmpNames = nextEmpIds.map((id: string) => eMap.get(id) || id);
    }

    const nowIso = new Date().toISOString();
    const updSql = `
      UPDATE %TABLE%
      SET status = $2, priority = $3, description = $4, customer_name = $5,
          assigned_employee_ids = $6::jsonb, assigned_employee_names = $7::jsonb,
          updated_at = $8::timestamptz
      WHERE id = $1
    `;
    const updParams = [problemId, nextStatus, nextPrio, nextDesc, nextCust, JSON.stringify(nextEmpIds), JSON.stringify(nextEmpNames), nowIso];
    await tx.query(updSql.replace('%TABLE%', 'problems'), updParams);
    await tx.query(updSql.replace('%TABLE%', 'issues'), updParams);

    const note = str(payload.note) || (nextStatus === 'مغلقة' ? 'تم إغلاق المشكلة' : `تحديث الحالة إلى ${nextStatus}`);
    await tx.query(
      `INSERT INTO problem_updates (id, problem_id, reservation_number, employee_id, employee_name, previous_status, new_status, previous_priority, new_priority, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
      [generateId('PRBU'), problemId, existing.reservationNumber, session.user.id, session.user.name, existing.status, nextStatus, existing.priority, nextPrio, note, nowIso]
    );

    if (existing.reservationId) {
      const openCheck = await tx.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM problems WHERE reservation_id = $1 AND status NOT IN ('مغلقة', 'تم الحل')`,
        [existing.reservationId]
      );
      const hasOpen = Number(openCheck.rows[0]?.cnt || 0) > 0;
      await tx.query(
        `UPDATE reservations SET has_problem = $2, updated_at = $3::timestamptz WHERE id = $1`,
        [existing.reservationId, hasOpen, nowIso]
      );
    }

    const updatesRes = await tx.query(
      `SELECT * FROM problem_updates WHERE problem_id = $1 ORDER BY created_at DESC`,
      [problemId]
    );
    await logActivity(tx, session.user, 'تحديث مشكلة', 'Problem', existing.problemNumber, `${existing.status} → ${nextStatus}`);

    const updatedProblem: Record<string, any> = {
      ...existing,
      status: nextStatus,
      priority: nextPrio,
      description: nextDesc,
      customerName: nextCust,
      assignedEmployeeIds: nextEmpIds,
      assignedEmployeeNames: nextEmpNames,
      updatedAt: nowIso,
      updates: updatesRes.rows.map(formatProblemUpdateRow)
    };
    await enqueueSheetsMirror(tx, 'Problem', updatedProblem.id, 'upsertProblem', updatedProblem);
    return updatedProblem;
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function getProblems(executor: DbExecutor, _session: AuthSession, payload: Record<string, any> = {}) {
  const params: any[] = [];
  const clauses: string[] = [];
  if (payload.status) {
    params.push(str(payload.status));
    clauses.push(`status = $${params.length}`);
  }
  if (payload.priority) {
    params.push(str(payload.priority));
    clauses.push(`priority = $${params.length}`);
  }
  if (payload.employeeId) {
    params.push(JSON.stringify([str(payload.employeeId)]));
    clauses.push(`assigned_employee_ids @> $${params.length}::jsonb`);
  }
  if (payload.search) {
    params.push(`%${str(payload.search)}%`);
    const pIdx = params.length;
    clauses.push(`(problem_number ILIKE $${pIdx} OR reservation_number ILIKE $${pIdx} OR customer_name ILIKE $${pIdx} OR description ILIKE $${pIdx})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const prbRes = await executor.query(`SELECT * FROM problems ${where} ORDER BY updated_at DESC LIMIT 400`, params);
  const updRes = await executor.query(`SELECT * FROM problem_updates ORDER BY created_at DESC LIMIT 1000`);
  const updMap = new Map<string, any[]>();
  for (const u of updRes.rows) {
    const pid = str(u.problem_id);
    const list = updMap.get(pid) || [];
    list.push(formatProblemUpdateRow(u));
    updMap.set(pid, list);
  }
  const items = prbRes.rows.map((p) => formatProblemRow(p, updMap));
  return { items, total: items.length };
}

export async function getProblemDetails(executor: DbExecutor, _session: AuthSession, payload: Record<string, any> = {}) {
  const target = str(payload.problemId || payload.problemNumber);
  if (!target) throw new Error('VALIDATION_ERROR: معرف المشكلة مطلوب.');
  const pRes = await executor.query(`SELECT * FROM problems WHERE id = $1 OR problem_number = $1 LIMIT 1`, [target]);
  if (!pRes.rows[0]) throw new Error('NOT_FOUND: المشكلة غير موجودة.');
  const updRes = await executor.query(`SELECT * FROM problem_updates WHERE problem_id = $1 ORDER BY created_at DESC`, [pRes.rows[0].id]);
  const updMap = new Map<string, any[]>([[str(pRes.rows[0].id), updRes.rows.map(formatProblemUpdateRow)]]);
  return { problem: formatProblemRow(pRes.rows[0], updMap) };
}

// ---------- EMPLOYEES, ROLES & PERMISSIONS ----------

export async function getEmployees(executor: DbExecutor, session: AuthSession) {
  requirePermission(session, 'view_employees');
  const [empRes, resRes, fuRes, prbRes, presets, customPerms] = await Promise.all([
    executor.query(`SELECT * FROM employees ORDER BY created_at ASC`),
    executor.query(`SELECT assigned_employee_ids FROM reservations`),
    executor.query(`SELECT employee_id FROM follow_ups`),
    executor.query(`SELECT assigned_employee_ids, status FROM problems`),
    getRolePresetsFromDb(executor),
    getPermissionDefsFromDb(executor)
  ]);

  const items = empRes.rows.map((row) => {
    const emp = mapEmployeeRow(row);
    let assignedCount = 0;
    for (const r of resRes.rows) {
      if (parseJsonArray<string>(r.assigned_employee_ids).includes(emp.id)) assignedCount++;
    }
    let followUpsCount = 0;
    for (const f of fuRes.rows) {
      if (str(f.employee_id) === emp.id) followUpsCount++;
    }
    let openProblemsCount = 0;
    for (const p of prbRes.rows) {
      const closed = p.status === 'مغلقة' || p.status === 'تم الحل';
      if (!closed && parseJsonArray<string>(p.assigned_employee_ids).includes(emp.id)) openProblemsCount++;
    }
    return {
      ...emp,
      stats: {
        assignedCount,
        followUpsCount,
        openProblemsCount
      }
    };
  });

  const rolePresets = crmCore.normalizeRolePresets(presets);
  const permissionsCatalog = crmCore.mergePermissionsCatalog(customPerms);

  return {
    items,
    rolePresets,
    permissionsCatalog,
    customPermissions: customPerms
  };
}

export async function getEmployeeDetails(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');

  const empRes = await executor.query(`SELECT * FROM employees WHERE id = $1 LIMIT 1`, [empId]);
  if (!empRes.rows[0]) throw new Error('NOT_FOUND: الموظف غير موجود.');
  const employee = mapEmployeeRow(empRes.rows[0]);

  const [resRows, fuRows, prbRows] = await Promise.all([
    executor.query(`SELECT * FROM reservations WHERE assigned_employee_ids @> $1::jsonb ORDER BY updated_at DESC LIMIT 200`, [JSON.stringify([empId])]),
    executor.query(`SELECT * FROM follow_ups WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 200`, [empId]),
    executor.query(`SELECT * FROM problems WHERE assigned_employee_ids @> $1::jsonb ORDER BY updated_at DESC LIMIT 200`, [JSON.stringify([empId])])
  ]);

  return {
    employee,
    assignedReservations: resRows.rows.map((r) => mapReservationRowToClient(r, false)),
    followUps: fuRows.rows.map(formatFollowUpRow),
    problems: prbRows.rows.map((p) => formatProblemRow(p))
  };
}

export async function createEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const name = str(payload.name);
  const username = normalizeLoginUsername(payload.username);
  const password = String(payload.password || '');
  const role = str(payload.role || 'agent');
  if (!name || !username || !password) {
    throw new Error('VALIDATION_ERROR: الاسم واسم المستخدم وكلمة المرور مطلوبة.');
  }

  const out = await executor.withTransaction(async (tx) => {
    const dupCheck = await tx.query(`SELECT id FROM employees WHERE LOWER(username) = $1 LIMIT 1`, [username]);
    if (dupCheck.rows.length > 0) {
      throw new Error('DUPLICATE_USERNAME: اسم المستخدم مسجل بالفعل.');
    }

    const salt = crypto.randomBytes(8).toString('hex').toUpperCase();
    const pHash = hashPassword(password, salt);
    const rawPerms = Array.isArray(payload.permissions) ? payload.permissions : [role];
    const effectivePerms = crmCore.resolveEffectivePermissions(role, rawPerms);
    const nowIso = new Date().toISOString();
    const id = generateId('EMP');

    await tx.query(
      `INSERT INTO employees (id, name, username, password_hash, salt, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'active',$11,$11::timestamptz,$11::timestamptz)`,
      [id, name, username, pHash, salt, str(payload.phone), str(payload.email), str(payload.jobTitle), role, JSON.stringify(effectivePerms), nowIso]
    );
    await tx.query(
      `INSERT INTO users (id, name, username, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',$9,$9::timestamptz,$9::timestamptz)`,
      [id, name, username, str(payload.phone), str(payload.email), str(payload.jobTitle), role, JSON.stringify(effectivePerms), nowIso]
    );

    await logActivity(tx, session.user, 'إضافة موظف', 'Employee', username, `إضافة ${name} بدور ${role}`);
    const emp = mapEmployeeRow({
      id, name, username, phone: str(payload.phone), email: str(payload.email),
      job_title: str(payload.jobTitle), role, permissions: effectivePerms,
      status: 'active', last_activity: nowIso, created_at: nowIso, updated_at: nowIso
    });
    await enqueueSheetsMirror(tx, 'Employee', id, 'upsertEmployee', { ...emp, passwordHash: pHash, salt });
    return emp;
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function updateEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const res = await tx.query(`SELECT * FROM employees WHERE id = $1 FOR UPDATE`, [empId]);
    if (!res.rows[0]) throw new Error('NOT_FOUND: الموظف غير موجود.');
    const cur = res.rows[0];

    const nextRole = payload.role !== undefined ? str(payload.role) : str(cur.role);
    const rawPerms = Array.isArray(payload.permissions) ? payload.permissions : parseJsonArray(cur.permissions);
    const nextPerms = crmCore.resolveEffectivePermissions(nextRole, rawPerms);

    let nextSalt = str(cur.salt);
    let nextHash = str(cur.password_hash);
    if (payload.newPassword && String(payload.newPassword).trim().length >= 4) {
      nextSalt = crypto.randomBytes(8).toString('hex').toUpperCase();
      nextHash = hashPassword(String(payload.newPassword).trim(), nextSalt);
      await revokeEmployeeSessions(tx, empId);
    }

    const nowIso = new Date().toISOString();
    const nextName = payload.name !== undefined ? str(payload.name) : str(cur.name);
    const nextPhone = payload.phone !== undefined ? str(payload.phone) : str(cur.phone);
    const nextEmail = payload.email !== undefined ? str(payload.email) : str(cur.email);
    const nextJob = payload.jobTitle !== undefined ? str(payload.jobTitle) : str(cur.job_title);
    const nextStatus = payload.status !== undefined ? str(payload.status) : str(cur.status);

    await tx.query(
      `UPDATE employees
       SET name = $2, phone = $3, email = $4, job_title = $5, role = $6,
           permissions = $7::jsonb, status = $8, password_hash = $9, salt = $10, updated_at = $11::timestamptz
       WHERE id = $1`,
      [empId, nextName, nextPhone, nextEmail, nextJob, nextRole, JSON.stringify(nextPerms), nextStatus, nextHash, nextSalt, nowIso]
    );
    await tx.query(
      `UPDATE users
       SET name = $2, phone = $3, email = $4, job_title = $5, role = $6,
           permissions = $7::jsonb, status = $8, updated_at = $9::timestamptz
       WHERE id = $1`,
      [empId, nextName, nextPhone, nextEmail, nextJob, nextRole, JSON.stringify(nextPerms), nextStatus, nowIso]
    );

    if (nextStatus !== 'active') {
      await revokeEmployeeSessions(tx, empId);
    }

    await logActivity(tx, session.user, 'تحديث بيانات موظف', 'Employee', cur.username, `تحديث ${nextName}`);
    const emp = mapEmployeeRow({
      ...cur,
      name: nextName, phone: nextPhone, email: nextEmail, job_title: nextJob,
      role: nextRole, permissions: nextPerms, status: nextStatus, updated_at: nowIso
    });
    await enqueueSheetsMirror(tx, 'Employee', empId, 'upsertEmployee', { ...emp, passwordHash: nextHash, salt: nextSalt });
    return emp;
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function disableEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');
  if (empId === session.user.id) throw new Error('FORBIDDEN: لا يمكن إيقاف حسابك الشخصي.');

  const status = payload.status === 'active' ? 'active' : 'disabled';
  return updateEmployee(executor, session, { employeeId: empId, status });
}

export async function saveRolePreset(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const current = await getRolePresetsFromDb(executor);
  const res = crmCore.upsertRolePreset(current, payload);
  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, label, job_title, role, permissions, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, job_title = EXCLUDED.job_title, role = EXCLUDED.role,
         permissions = EXCLUDED.permissions, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [res.saved.id, res.saved.label, res.saved.jobTitle, res.saved.role, JSON.stringify(res.saved.permissions), session.user.name]
    );
    await logActivity(tx, session.user, 'تحديث قالب صلاحيات', 'RolePreset', res.saved.id, res.saved.label);
  });
  return { saved: res.saved, rolePresets: res.presets };
}

export async function deleteRolePreset(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const id = str(payload.id || payload.presetId);
  const current = await getRolePresetsFromDb(executor);
  const next = crmCore.removeRolePreset(current, id);
  await executor.query(`DELETE FROM roles WHERE id = $1`, [id]);
  await logActivity(executor, session.user, 'حذف قالب صلاحيات', 'RolePreset', id, 'حذف قالب صلاحيات');
  return { rolePresets: next };
}

export async function resetRolePresets(executor: DbExecutor, session: AuthSession) {
  requirePermission(session, 'manage_employees');
  await executor.withTransaction(async (tx) => {
    await tx.query(`DELETE FROM roles`);
    for (const preset of crmCore.JOB_ROLE_PRESETS) {
      await tx.query(
        `INSERT INTO roles (id, label, job_title, role, permissions, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW())`,
        [preset.id, preset.label, preset.jobTitle, preset.role, JSON.stringify(preset.permissions), session.user.name]
      );
    }
    await logActivity(tx, session.user, 'إعادة ضبط القوالب', 'RolePreset', 'ALL', 'استعادة قوالب الصلاحيات الافتراضية');
  });
  return { rolePresets: crmCore.JOB_ROLE_PRESETS };
}

export async function savePermissionDefinition(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const current = await getPermissionDefsFromDb(executor);
  const res = crmCore.upsertPermissionDefinition(current, payload);
  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO permissions (key, label, "group", is_custom, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (key) DO UPDATE SET
         label = EXCLUDED.label, "group" = EXCLUDED."group", is_custom = EXCLUDED.is_custom,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [res.saved.key, res.saved.label, res.saved.group, Boolean(res.saved.isCustom), session.user.name]
    );
    await logActivity(tx, session.user, 'حفظ مسمى صلاحية', 'Permission', res.saved.key, res.saved.label);
  });
  return { saved: res.saved, permissionsCatalog: res.catalog, customPermissions: res.customPermissions };
}

export async function deletePermissionDefinition(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const key = str(payload.key);
  const current = await getPermissionDefsFromDb(executor);
  const res = crmCore.removePermissionDefinition(current, key);
  await executor.query(`DELETE FROM permissions WHERE key = $1`, [key]);
  await logActivity(executor, session.user, 'حذف صلاحية مخصصة', 'Permission', key, 'حذف مسمى/صلاحية مخصصة');
  return { permissionsCatalog: res.catalog, customPermissions: res.customPermissions };
}

// ---------- LOGS, NOTIFICATIONS, REPORTS, SETTINGS & SYNC ----------

export async function getActivityLogs(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_activity');
  const params: any[] = [];
  const clauses: string[] = [];
  if (payload.userId) {
    params.push(str(payload.userId));
    clauses.push(`user_id = $${params.length}`);
  }
  if (payload.entityType) {
    params.push(str(payload.entityType));
    clauses.push(`entity_type = $${params.length}`);
  }
  if (payload.dateFrom) {
    params.push(str(payload.dateFrom));
    clauses.push(`log_date >= $${params.length}`);
  }
  if (payload.dateTo) {
    params.push(str(payload.dateTo));
    clauses.push(`log_date <= $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(20, num(payload.limit, 200)));
  params.push(limit);
  const res = await executor.query(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return {
    items: res.rows.map((l) => ({
      id: str(l.id),
      userId: str(l.user_id),
      userName: str(l.user_name),
      userRole: str(l.user_role),
      actionType: str(l.action_type),
      entityType: str(l.entity_type),
      entityId: str(l.entity_id),
      details: str(l.details),
      logDate: str(l.log_date),
      logTime: str(l.log_time),
      createdAt: l.created_at instanceof Date ? l.created_at.toISOString() : str(l.created_at)
    }))
  };
}

export async function markNotificationRead(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (payload.markAll) {
    await executor.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE (recipient_employee_id = $1 OR recipient_role = $2 OR recipient_role = 'all') AND is_read = FALSE`,
      [session.user.id, session.user.role]
    );
  } else if (payload.notificationId) {
    await executor.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1`,
      [str(payload.notificationId)]
    );
  }
  return { updated: true };
}

export async function getSettings(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const map = await getSettingsMap(executor);
  return {
    ...map,
    auto_sync_enabled: map.auto_sync_enabled !== false,
    auto_sync_interval_hours: num(map.auto_sync_interval_hours, 12),
    hasRgToken: Boolean(process.env.RG_TOKEN || process.env.GAS_WEBAPP_URL)
  };
}

export async function updateSettings(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_settings');
  const updates: Array<[string, string]> = [];
  if (payload.company_name) updates.push(['company_name', str(payload.company_name)]);
  if (Array.isArray(payload.excluded_statuses)) updates.push(['excluded_statuses', JSON.stringify(payload.excluded_statuses)]);
  if (payload.session_ttl_hours) updates.push(['session_ttl_hours', String(num(payload.session_ttl_hours, 12))]);
  if (typeof payload.allow_agent_view_all === 'boolean') updates.push(['allow_agent_view_all', String(payload.allow_agent_view_all)]);
  if (payload.default_language) updates.push(['default_language', str(payload.default_language)]);
  if (typeof payload.auto_sync_enabled === 'boolean') updates.push(['auto_sync_enabled', String(payload.auto_sync_enabled)]);
  if (payload.auto_sync_interval_hours !== undefined) {
    const hVal = Math.max(1, Math.min(168, Math.round(num(payload.auto_sync_interval_hours, 12))));
    updates.push(['auto_sync_interval_hours', String(hVal)]);
  }

  await executor.withTransaction(async (tx) => {
    for (const [key, value] of updates) {
      await tx.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, value, session.user.name]
      );
      await enqueueSheetsMirror(tx, 'Settings', key, 'upsertSetting', { key, value, updatedBy: session.user.name });
    }
    await logActivity(tx, session.user, 'تحديث الإعدادات', 'Settings', 'system', 'تحديث إعدادات النظام في قاعدة البيانات');
  });

  flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return getSettings(executor, session);
}

export async function getSyncStatus(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const [logRes, ckRes, map] = await Promise.all([
    executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20`),
    executor.query(`SELECT * FROM sync_checkpoints ORDER BY updated_at DESC LIMIT 5`),
    getSettingsMap(executor)
  ]);
  const logs = logRes.rows.map((s) => ({
    id: str(s.id),
    triggeredById: str(s.triggered_by_id),
    triggeredByName: str(s.triggered_by_name),
    status: str(s.status),
    importedCount: num(s.imported_count),
    updatedCount: num(s.updated_count),
    extensionsCount: num(s.extensions_count),
    pagesFetched: num(s.pages_fetched),
    errorMessage: str(s.error_message),
    durationMs: num(s.duration_ms),
    startedAt: s.started_at instanceof Date ? s.started_at.toISOString() : str(s.started_at),
    finishedAt: s.finished_at instanceof Date ? s.finished_at.toISOString() : str(s.finished_at)
  }));
  return {
    hasToken: Boolean(process.env.RG_TOKEN || process.env.GAS_WEBAPP_URL),
    autoSyncEnabled: map.auto_sync_enabled !== false,
    autoSyncIntervalHours: num(map.auto_sync_interval_hours, 12),
    lastSync: logs[0] || null,
    logs,
    checkpoints: ckRes.rows
  };
}

export async function getTriggerStatus(_executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const hasGasUrl = Boolean(process.env.GAS_WEBAPP_URL);
  return {
    count: hasGasUrl ? 1 : 0,
    triggers: hasGasUrl ? [{ id: 'NEON_HYBRID_SYNC', handler: 'scheduledMinuteSync', eventType: 'CLOCK' }] : []
  };
}

export async function getReports(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_reports');
  const rType = str(payload.reportType || 'all_reservations');
  const params: any[] = [];
  const clauses: string[] = [];

  if (payload.status) { params.push(str(payload.status)); clauses.push(`r.internal_status = $${params.length}`); }
  if (payload.priority) { params.push(str(payload.priority)); clauses.push(`r.priority = $${params.length}`); }
  if (payload.company) { params.push(str(payload.company)); clauses.push(`r.company_name = $${params.length}`); }
  if (payload.branch) { params.push(str(payload.branch)); clauses.push(`r.branch_name = $${params.length}`); }
  if (payload.employeeId) { params.push(JSON.stringify([str(payload.employeeId)])); clauses.push(`r.assigned_employee_ids @> $${params.length}::jsonb`); }
  if (payload.dateFrom) { params.push(str(payload.dateFrom)); clauses.push(`r.start_date >= $${params.length}`); }
  if (payload.dateTo) { params.push(str(payload.dateTo)); clauses.push(`r.start_date <= $${params.length}`); }
  if (rType === 'unfollowed') clauses.push(`NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id)`);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [compRes, branchRes] = await Promise.all([
    executor.query<{ company_name: string }>(`SELECT DISTINCT company_name FROM reservations WHERE company_name <> '' ORDER BY company_name ASC`),
    executor.query<{ branch_name: string }>(`SELECT DISTINCT branch_name FROM reservations WHERE branch_name <> '' ORDER BY branch_name ASC`)
  ]);
  const facets = {
    companies: compRes.rows.map((r) => r.company_name),
    branches: branchRes.rows.map((r) => r.branch_name)
  };

  if (rType === 'employee_performance') {
    const [empRes, allRes, allFu, allPrb] = await Promise.all([
      executor.query(`SELECT * FROM employees`),
      executor.query(`SELECT assigned_employee_ids FROM reservations`),
      executor.query(`SELECT employee_id FROM follow_ups`),
      executor.query(`SELECT assigned_employee_ids FROM problems`)
    ]);
    const rows = empRes.rows.map((e) => ({
      employeeId: str(e.id),
      employeeName: str(e.name),
      jobTitle: str(e.job_title),
      role: str(e.role),
      assignedReservations: allRes.rows.filter((r) => parseJsonArray<string>(r.assigned_employee_ids).includes(str(e.id))).length,
      followUpsCount: allFu.rows.filter((f) => str(f.employee_id) === str(e.id)).length,
      problemsCount: allPrb.rows.filter((p) => parseJsonArray<string>(p.assigned_employee_ids).includes(str(e.id))).length,
      lastActivity: str(e.last_activity)
    }));
    return { reportType: rType, rows, facets };
  }

  if (rType === 'followups_log') {
    const fuRes = await executor.query(`SELECT * FROM follow_ups ORDER BY created_at DESC LIMIT 1000`);
    return { reportType: rType, rows: fuRes.rows.map(formatFollowUpRow), facets };
  }

  if (rType === 'problems') {
    const prbRes = await executor.query(`SELECT * FROM problems ORDER BY updated_at DESC LIMIT 1000`);
    return { reportType: rType, rows: prbRes.rows.map((p) => formatProblemRow(p)), facets };
  }

  if (rType === 'extensions') {
    const extRes = await executor.query(`SELECT * FROM extensions ORDER BY synced_at DESC LIMIT 1000`);
    return { reportType: rType, rows: extRes.rows.map(mapExtensionRowToClient), facets };
  }

  if (rType === 'sync_log') {
    const sRes = await executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 500`);
    return { reportType: rType, rows: sRes.rows, facets };
  }

  if (rType === 'activity_log') {
    const aRes = await executor.query(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 1000`);
    return { reportType: rType, rows: aRes.rows, facets };
  }

  const resRows = await executor.query(
    `SELECT * FROM reservations r ${where} ORDER BY r.updated_at DESC LIMIT 2000`,
    params
  );
  return {
    reportType: rType,
    rows: resRows.rows.map((r) => mapReservationRowToClient(r, false)),
    facets
  };
}

export async function exportReportData(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'export_reports');
  const data = await getReports(executor, session, payload);
  await logActivity(executor, session.user, 'تصدير تقرير', 'Report', str(payload.reportType || 'all_reservations'), `تصدير ${data.rows.length} صف`);
  return data;
}

export async function pullOrSyncReservations(
  executor: DbExecutor,
  session: AuthSession,
  action: 'pullReservations' | 'syncRentalGate',
  payload: Record<string, any> = {}
) {
  if (action === 'syncRentalGate') {
    requirePermission(session, 'sync_data');
  } else {
    requirePermission(session, 'pull_reservations');
  }

  // Only users with sync_data or manage_settings may apply custom pull date ranges
  const rangePayload = payload?.datePreset || payload?.dateFrom || payload?.dateTo
    ? (crmCore.canUserPerform(session.user, 'sync_data') || crmCore.canUserPerform(session.user, 'manage_settings')
        ? payload
        : {})
    : {};

  if (process.env.RG_TOKEN) {
    const result = await pullFromRentalGateDirect(executor, session.user, rangePayload);
    return {
      ...result,
      id: result.syncId,
      triggeredById: session.user.id,
      triggeredByName: session.user.name
    };
  }

  // Fallback delegation to Google Apps Script Web App if configured on server
  const gasUrl = str(process.env.GAS_WEBAPP_URL);
  if (gasUrl) {
    const syncSecret = str(process.env.SYNC_API_SECRET);
    const resp = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'triggerNeonIncrementalSync',
        payload: { syncSecret, ...rangePayload, actor: { id: session.user.id, name: session.user.name, role: session.user.role } }
      })
    });
    const text = await resp.text();
    const parsed = JSON.parse(text);
    if (!parsed?.success) {
      throw new Error(parsed?.message || 'فشلت المزامنة عبر Google Apps Script.');
    }
    return parsed.data;
  }

  throw new Error('NO_RG_TOKEN: يرجى إعداد RG_TOKEN أو GAS_WEBAPP_URL في متغيرات البيئة لخادم قاعدة البيانات.');
}

export async function saveApiToken(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_settings');
  const rawToken = str(payload.token || payload.rgToken).replace(/^Bearer\s+/i, '');
  if (!rawToken || rawToken.length < 15) {
    throw new Error('VALIDATION_ERROR: التوكن غير صالح.');
  }

  const gasUrl = str(process.env.GAS_WEBAPP_URL);
  if (gasUrl && process.env.SYNC_API_SECRET) {
    // Forward token securely to GAS Script Properties via shared secret (never store plain RG token in DB rows)
    await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret: process.env.SYNC_API_SECRET,
          items: [{ entityType: 'RgToken', action: 'saveRgToken', payload: { rgToken: rawToken } }]
        }
      })
    }).catch(() => undefined);
  }

  process.env.RG_TOKEN = rawToken;
  await logActivity(executor, session.user, 'تحديث توكن Rental Gate', 'Settings', 'RG_TOKEN', 'تم تحديث توكن الربط بأمان في الذاكرة الخلفية');
  return { saved: true, hasRgToken: true };
}

export async function testRentalGateConnection(_executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const rgToken = str(process.env.RG_TOKEN).replace(/^Bearer\s+/i, '');
  if (!rgToken) {
    return {
      connected: Boolean(process.env.GAS_WEBAPP_URL),
      statusCode: 0,
      hasToken: Boolean(process.env.GAS_WEBAPP_URL),
      message: process.env.GAS_WEBAPP_URL
        ? 'الربط يعمل عبر Google Apps Script المربوط بقاعدة Neon PostgreSQL.'
        : 'متغير RG_TOKEN غير مضبوط على الخادم.'
    };
  }
  const baseApi = str(process.env.RG_API_BASE_URL || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
  const resp = await fetch(`${baseApi}/reservations/filter?page=0&size=1`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${rgToken}`, Accept: 'application/json', lang: 'ar' }
  });
  return {
    connected: resp.ok,
    statusCode: resp.status,
    hasToken: true,
    message: resp.ok ? 'الاتصال بواجهة Rental Gate API يعمل بنجاح.' : `فشل الاتصال (HTTP ${resp.status})`
  };
}
