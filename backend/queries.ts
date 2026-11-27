import crypto from 'node:crypto';
import {
  crmCore,
  generateId,
  getRiyadhDateTimeParts,
  hashPassword,
  invalidateAuthSessionCache,
  mapEmployeeRow,
  normalizeLoginUsername,
  parseJsonArray,
  requireApiAccess,
  requirePermission,
  revokeEmployeeSessions,
  type AuthSession
} from './auth.js';
import {
  ensureCacheSyncFreshness,
  getCachedOrLoad,
  getLocalCacheVersion,
  invalidateScopes,
  runWithIdempotency
} from './cache.js';
import { getDatabaseUrl, runWithSavepoint, type DbClient, type DbExecutor } from './db.js';
import { isCoreFilesystemWritable, maskDatabaseUrl } from './coreBinding.js';
import {
  encryptServerSecret,
  ensureSyncApiSecret,
  resolveServerConfig,
  upsertServerSetting
} from './serverConfig.js';
import {
  applyUnifiedConnectionSetup as runUnifiedConnectionSetup,
  getSetupCapabilities as readSetupCapabilities
} from './setupService.js';
import {
  computeNextScheduledRunAt,
  deriveWorkerStatus,
  normalizeAutoSyncConfig,
  validateAutoSyncSettingsInput
} from './autoSyncLogic.js';
import {
  getAutoSyncWorkerRuntimeStatus,
  notifyAutoSyncConfigChanged
} from './autoSyncWorker.js';
import {
  emitSyncWorkerStatusRealtime,
  enqueueSheetsMirror,
  extractRentalGatePagePayload,
  flushSheetsMirrorOutbox,
  getLastSyncBatchMutatedAt,
  ingestIncrementalSyncBatch,
  mapExtensionRowToClient,
  mapReservationRowToClient,
  pullFromRentalGateDirect,
  readWorkerStateRow,
  retryFailedSyncRecords,
  sanitizeExcludedStatusesList
} from './syncService.js';
import {
  deterministicCustomerId,
  formatCustomerSummaryRow,
  upsertCustomersFromReservationsTx
} from './customerHelpers.js';

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

const PG_SEARCH_NORM_FROM = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱىةـًٌٍَُِّْ';
const PG_SEARCH_NORM_TO   = '01234567890123456789اااايه';

export function buildPgSearchCondition(columns: string[], rawQuery: unknown, params: any[]): string {
  const qStr = str(rawQuery);
  if (!qStr || !Array.isArray(columns) || columns.length === 0) return '';
  const tokens: string[] = typeof crmCore.tokenizeSearchQuery === 'function'
    ? crmCore.tokenizeSearchQuery(qStr)
    : qStr.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  const tokenClauses: string[] = [];
  for (const tok of tokens) {
    const safeTok = String(tok).replace(/[!%_]/g, (m) => '!' + m);
    params.push(`%${safeTok}%`);
    const pIdx = params.length;
    const perCol = columns.map(
      (col) => `TRANSLATE(COALESCE(${col}, ''), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') ILIKE $${pIdx} ESCAPE '!'`
    );
    tokenClauses.push(`(${perCol.join(' OR ')})`);
  }
  return tokenClauses.length === 1 ? tokenClauses[0] : `(${tokenClauses.join(' AND ')})`;
}

const SQL_REJECTED_CODES = `('rejected','declined','refused','rejected_by_admin','rejected_by_company','rejected_by_provider','rejected_by_customer','rejected_by_client','rejected_by_user','provider_rejected','company_rejected','admin_rejected','customer_rejected','client_rejected','user_rejected','auto_rejected','system_rejected','declined_by_admin','declined_by_company','declined_by_provider','declined_by_user','declined_by_client','declined_by_customer','refused_by_admin','refused_by_company','refused_by_provider','refused_by_user','refused_by_client','refused_by_customer')`;
const SQL_CANCELLED_CODES = `('cancelled','canceled','cancelled_by_customer','canceled_by_customer','customer_cancelled','customer_canceled','user_cancelled','user_canceled','client_cancelled','client_canceled','cancelled_by_client','canceled_by_client','cancelled_by_user','canceled_by_user','cancelled_by_admin','canceled_by_admin','cancelled_by_provider','canceled_by_provider','cancelled_by_company','canceled_by_company','admin_cancelled','admin_canceled','provider_cancelled','provider_canceled','company_cancelled','company_canceled','system_cancelled','system_canceled','auto_cancelled','auto_canceled')`;
const SQL_REJECTED_STATUS_LIST = `('مرفوض','مرفوضه','تم الرفض','تم الرفض من الشركه','تم الرفض من المزود','مرفوض من الموقع','مرفوضه من الموقع','مرفوض من الشركه','مرفوضه من الشركه','مرفوض من المزود','مرفوض من الاداره','مرفوض تلقائيا','rejected','declined','refused','rejected_by_admin','rejected_by_company','rejected_by_provider','rejected_by_customer','rejected_by_client','rejected_by_user','provider_rejected','company_rejected','admin_rejected','customer_rejected','client_rejected','user_rejected','auto_rejected','system_rejected','declined_by_admin','declined_by_company','declined_by_provider','declined_by_user','declined_by_client','declined_by_customer','refused_by_admin','refused_by_company','refused_by_provider','refused_by_user','refused_by_client','refused_by_customer')`;
const SQL_CANCELLED_STATUS_LIST = `('تم الالغاء','تم الغاء','تم الالغاء من العميل','تم الالغاء من الشركه','ملغي','ملغاه','ملغي من العميل','ملغاه من العميل','ملغي من الشركه','ملغي من الاداره','ملغي تلقائيا','الغاء العميل','الغاء الحجز','cancelled','canceled','cancelled_by_customer','canceled_by_customer','customer_cancelled','customer_canceled','user_cancelled','user_canceled','client_cancelled','client_canceled','cancelled_by_client','canceled_by_client','cancelled_by_user','canceled_by_user','cancelled_by_admin','canceled_by_admin','cancelled_by_provider','canceled_by_provider','cancelled_by_company','canceled_by_company','admin_cancelled','admin_canceled','provider_cancelled','provider_canceled','company_cancelled','company_canceled','system_cancelled','system_canceled','auto_cancelled','auto_canceled')`;

const SQL_NORM_EXT_CODE = `REGEXP_REPLACE(LOWER(TRIM(COALESCE(r.original_status_code, ''))), '[\\s-]+', '_', 'g')`;
const SQL_NORM_EXT_AR = `TRANSLATE(LOWER(TRIM(COALESCE(r.original_status_ar, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}')`;
const SQL_NORM_INT_ST = `TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}')`;

const SQL_NO_EXPLICIT_EXTERNAL = `(
  TRIM(COALESCE(r.original_status_code, '')) = '' AND
  (TRIM(COALESCE(r.original_status_ar, '')) = '' OR TRIM(COALESCE(r.original_status_ar, '')) = 'غير محدد')
)`;

const SQL_EXT_CODE_IS_REJECTED = `(
  ${SQL_NORM_EXT_CODE} IN ${SQL_REJECTED_CODES} OR
  ${SQL_NORM_EXT_CODE} LIKE 'rejected\\_by\\_%' ESCAPE '\\' OR
  ${SQL_NORM_EXT_CODE} LIKE 'declined\\_by\\_%' ESCAPE '\\' OR
  ${SQL_NORM_EXT_CODE} LIKE 'refused\\_by\\_%' ESCAPE '\\' OR
  ${SQL_NORM_EXT_CODE} LIKE '%\\_rejected' ESCAPE '\\' OR
  ${SQL_NORM_EXT_CODE} LIKE '%\\_declined' ESCAPE '\\' OR
  ${SQL_NORM_EXT_CODE} LIKE '%\\_refused' ESCAPE '\\' OR
  ${SQL_NORM_EXT_AR} IN ${SQL_REJECTED_STATUS_LIST} OR
  ${SQL_NORM_EXT_AR} LIKE 'مرفوض%' OR
  ${SQL_NORM_EXT_AR} LIKE 'تم الرفض%'
)`;

const SQL_EXT_CODE_IS_CANCELLED = `(
  NOT ${SQL_EXT_CODE_IS_REJECTED} AND (
    ${SQL_NORM_EXT_CODE} IN ${SQL_CANCELLED_CODES} OR
    ${SQL_NORM_EXT_CODE} LIKE 'cancelled\\_by\\_%' ESCAPE '\\' OR
    ${SQL_NORM_EXT_CODE} LIKE 'canceled\\_by\\_%' ESCAPE '\\' OR
    ${SQL_NORM_EXT_CODE} LIKE '%\\_cancelled' ESCAPE '\\' OR
    ${SQL_NORM_EXT_CODE} LIKE '%\\_canceled' ESCAPE '\\' OR
    ${SQL_NORM_EXT_AR} IN ${SQL_CANCELLED_STATUS_LIST} OR
    ${SQL_NORM_EXT_AR} LIKE 'ملغي%' OR
    ${SQL_NORM_EXT_AR} LIKE 'ملغاه%' OR
    ${SQL_NORM_EXT_AR} LIKE 'تم الالغاء%' OR
    ${SQL_NORM_EXT_AR} LIKE 'تم الغاء%'
  )
)`;

const SQL_EXPLICIT_REJECTED = `(
  ${SQL_EXT_CODE_IS_REJECTED} OR
  (
    ${SQL_EXT_CODE_IS_CANCELLED} AND
    COALESCE(r.is_source_rejected, FALSE) = TRUE AND
    COALESCE(r.is_source_cancelled, FALSE) = FALSE
  ) OR
  (
    ${SQL_NO_EXPLICIT_EXTERNAL} AND
    COALESCE(r.is_source_cancelled, FALSE) = FALSE AND
    (
      r.is_source_rejected = TRUE OR
      ${SQL_NORM_INT_ST} IN ${SQL_REJECTED_STATUS_LIST}
    )
  )
)`;

const SQL_EXPLICIT_CANCELLED = `(
  NOT ${SQL_EXPLICIT_REJECTED} AND (
    (
      ${SQL_EXT_CODE_IS_CANCELLED} AND
      NOT (COALESCE(r.is_source_rejected, FALSE) = TRUE AND COALESCE(r.is_source_cancelled, FALSE) = FALSE)
    ) OR
    (
      ${SQL_NO_EXPLICIT_EXTERNAL} AND
      (
        r.is_source_cancelled = TRUE OR
        (COALESCE(r.is_source_rejected, FALSE) = FALSE AND ${SQL_NORM_INT_ST} IN ${SQL_CANCELLED_STATUS_LIST})
      )
    )
  )
)`;

const SQL_HAS_EXPLICIT_STATUS = `(
  TRIM(COALESCE(r.original_status_code, '')) <> '' OR
  (TRIM(COALESCE(r.original_status_ar, '')) <> '' AND TRIM(COALESCE(r.original_status_ar, '')) <> 'غير محدد') OR
  (TRIM(COALESCE(r.internal_status, '')) <> '' AND TRIM(COALESCE(r.internal_status, '')) <> 'غير محدد')
)`;

const SQL_REJECTED_CONDITION = `(
  CASE
    WHEN ${SQL_NO_EXPLICIT_EXTERNAL} THEN (
      COALESCE(r.is_source_cancelled, FALSE) = FALSE AND (
        r.is_source_rejected = TRUE OR
        ${SQL_NORM_INT_ST} IN ${SQL_REJECTED_STATUS_LIST} OR (
          NOT ${SQL_HAS_EXPLICIT_STATUS} AND
          r.is_source_rejected IS NULL AND
          COALESCE(r.rejected_at, '') <> '' AND
          (COALESCE(r.cancelled_at, '') = '' OR r.rejected_at >= r.cancelled_at)
        )
      )
    )
    ELSE ${SQL_EXPLICIT_REJECTED}
  END
)`;

const SQL_CANCELLED_CONDITION = `(
  CASE
    WHEN ${SQL_NO_EXPLICIT_EXTERNAL} THEN (
      NOT (
        COALESCE(r.is_source_cancelled, FALSE) = FALSE AND (
          r.is_source_rejected = TRUE OR
          ${SQL_NORM_INT_ST} IN ${SQL_REJECTED_STATUS_LIST} OR (
            NOT ${SQL_HAS_EXPLICIT_STATUS} AND
            r.is_source_rejected IS NULL AND
            COALESCE(r.rejected_at, '') <> '' AND
            (COALESCE(r.cancelled_at, '') = '' OR r.rejected_at >= r.cancelled_at)
          )
        )
      ) AND (
        r.is_source_cancelled = TRUE OR
        (COALESCE(r.is_source_rejected, FALSE) = FALSE AND ${SQL_NORM_INT_ST} IN ${SQL_CANCELLED_STATUS_LIST}) OR (
          NOT ${SQL_HAS_EXPLICIT_STATUS} AND
          r.is_source_cancelled IS NULL AND
          COALESCE(r.cancelled_at, '') <> ''
        )
      )
    )
    ELSE ${SQL_EXPLICIT_CANCELLED}
  END
)`;

const SQL_ACTIVE_CONDITION = `(NOT ${SQL_REJECTED_CONDITION} AND NOT ${SQL_CANCELLED_CONDITION})`;

const SQL_REJECTED_TAB_CONDITION = `(
  ${SQL_REJECTED_CONDITION} OR
  TRIM(COALESCE(r.rcc_status, '')) <> ''
)`;

function redactReservationForUser<T extends Record<string, any>>(res: T, user: any): T {
  if (!res || typeof res !== 'object') return res;
  if (typeof crmCore.redactReservationSensitiveFields === 'function') {
    return crmCore.redactReservationSensitiveFields(res, user);
  }
  return res;
}

function redactReservationsList<T extends Record<string, any>>(items: T[], user: any): T[] {
  if (!Array.isArray(items) || items.length === 0) return items;
  if (typeof crmCore.canUserViewCustomerId === 'function' && crmCore.canUserViewCustomerId(user)) {
    return items;
  }
  return items.map((item) => redactReservationForUser(item, user));
}

async function runTxOptional<T>(
  tx: DbClient,
  savepointLabel: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  return runWithSavepoint(tx, savepointLabel, fn, fallback);
}

async function recordSyncTombstone(
  client: DbClient,
  entityType:
    | 'reservation'
    | 'reservation_clear_all'
    | 'employee'
    | 'announcement'
    | 'problem'
    | 'follow_up'
    | 'notification'
    | 'notification_clear_all'
    | string,
  entityIds: string[],
  meta: Record<string, any> = {}
): Promise<void> {
  const cleanIds = Array.from(new Set(entityIds.map((x) => str(x)).filter(Boolean))).slice(0, 800);
  if (!cleanIds.length) return;
  const metaJson = JSON.stringify(meta || {});
  await runTxOptional(
    client,
    'record_tombstone',
    async () => {
      const ids = cleanIds.map(() => generateId('TMB'));
      await client.query(
        `INSERT INTO sync_tombstones (id, entity_type, entity_id, meta, deleted_at)
         SELECT u.id, $2, u.entity_id, $3::jsonb, NOW()
         FROM unnest($1::text[], $4::text[]) AS u(id, entity_id)`,
        [ids, entityType, metaJson, cleanIds]
      );
    },
    undefined
  );
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
    customerId: str(row.customer_id ?? row.customerId),
    ticketType: str(row.ticket_type ?? row.ticketType) || 'مشكلة',
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at || row.created_at)
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

export async function logActivity(
  client: DbClient,
  actor: { id: string; name: string; role?: string },
  actionType: string,
  entityType: string,
  entityId: string,
  details: string,
  changes: Array<{ field: string; label: string; before: string; after: string }> = []
): Promise<void> {
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const riyadhNow = getRiyadhDateTimeParts(nowDate);
  const safeChanges = Array.isArray(changes) ? changes : [];
  try {
    await client.query(
      `INSERT INTO activity_log (id, user_id, user_name, user_role, action_type, entity_type, entity_id, details, changes, log_date, log_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::timestamptz)`,
      [
        generateId('ACT'),
        actor.id || 'SYSTEM',
        actor.name || 'النظام',
        actor.role || 'system',
        actionType,
        entityType,
        entityId,
        details,
        JSON.stringify(safeChanges),
        riyadhNow.date,
        riyadhNow.time,
        nowIso
      ]
    );
  } catch {
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
        riyadhNow.date,
        riyadhNow.time,
        nowIso
      ]
    );
  }
}

function buildNotificationEventKey(parts: unknown[]): string {
  const raw = parts.map((p) => str(p)).join('|').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= 160 && /^[A-Za-z0-9_.:|-]+$/.test(raw)) return raw;
  const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20);
  return `evt_${digest}`;
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
    eventKey?: string;
  }
): Promise<void> {
  const recEmpId = str(opts.recipientEmployeeId);
  const recRole = recEmpId ? '' : str(opts.recipientRole);
  const eventKey = str(opts.eventKey).slice(0, 220);
  await client.query(
    `INSERT INTO notifications (id, recipient_employee_id, recipient_role, type, title, message, entity_type, entity_id, is_read, created_at, updated_at, event_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW(),NOW(),$9)
     ON CONFLICT (event_key, recipient_employee_id, recipient_role) WHERE event_key <> '' DO NOTHING`,
    [
      generateId('NTF'),
      recEmpId,
      recRole,
      str(opts.type || 'info'),
      str(opts.title),
      str(opts.message),
      str(opts.entityType),
      str(opts.entityId),
      eventKey
    ]
  );
}

async function dispatchMentionNotifications(
  client: DbClient,
  opts: {
    texts: string[];
    sender: AuthSession['user'];
    entityType: 'Reservation' | 'Problem' | 'Customer';
    entityId: string;
    label: string;
    sourceKey?: string;
  }
): Promise<any[]> {
  const combined = (opts.texts || []).map((t) => str(t)).filter(Boolean).join('\n');
  if (!combined || combined.indexOf('@') === -1) return [];
  const empRes = await client.query(`SELECT * FROM employees`);
  const candidates = (empRes.rows || []).map((r: any) => ({
    id: str(r.id),
    name: str(r.name),
    username: str(r.username),
    role: str(r.role),
    status: str(r.status || 'active')
  }));
  const mentioned = crmCore.extractMentionedEmployees(combined, candidates, {
    excludeEmployeeId: opts.sender?.id || ''
  });
  if (!mentioned.length) return [];

  const normSnippet = combined.replace(/\s+/g, ' ').trim();
  const snippet = normSnippet.slice(0, 120);
  const titlePrefix = opts.entityType === 'Problem'
    ? `إشارة لك في المشكلة ${opts.label || ''}`.trim()
    : opts.entityType === 'Customer'
      ? `إشارة لك في ملف العميل ${opts.label || ''}`.trim()
      : `إشارة لك في الحجز ${opts.label || ''}`.trim();
  const mentionBaseKey = str(opts.sourceKey) || buildNotificationEventKey([
    'mention',
    opts.entityType,
    opts.entityId,
    opts.sender?.id || '',
    normSnippet
  ]);
  for (const target of mentioned) {
    await createNotification(client, {
      recipientEmployeeId: target.id,
      type: 'mention',
      title: `${titlePrefix} (@${opts.sender?.name || 'موظف'})`,
      message: `${opts.sender?.name || 'موظف'} أشار إليك: "${snippet}"`,
      entityType: opts.entityType,
      entityId: opts.entityId,
      eventKey: buildNotificationEventKey(['mention', mentionBaseKey, target.id])
    });
  }
  return mentioned;
}

const INTERNAL_SECRET_SETTING_KEYS = new Set([
  'rg_token_enc',
  'sync_api_secret_enc',
  'sync_api_secret',
  'rg_token'
]);

function isDbExecutorObj(client: DbClient): client is DbExecutor {
  return Boolean(client && typeof (client as DbExecutor).withTransaction === 'function');
}

function assertOptimisticLock(existingUpdatedAt: string, expectedUpdatedAt: unknown): void {
  const exp = str(expectedUpdatedAt);
  if (!exp) return;
  const expMs = Date.parse(exp);
  const curMs = Date.parse(str(existingUpdatedAt));
  if (!isNaN(expMs) && !isNaN(curMs) && curMs - expMs > 1000) {
    throw new Error('CONFLICT_STALE_DATA: تم تعديل هذا السجل بواسطة مستخدم آخر. تم تحديث البيانات، يرجى المراجعة وإعادة المحاولة.');
  }
}

function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  const parts = String(isoDate || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => isNaN(n))) return isoDate;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
  return d.toISOString().slice(0, 10);
}

export async function getSettingsMap(client: DbClient): Promise<Record<string, any>> {
  const loadSettings = async (): Promise<Record<string, any>> => {
    const res = await client.query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
    const map: Record<string, any> = {};
    for (const row of res.rows) {
      if (INTERNAL_SECRET_SETTING_KEYS.has(String(row.key))) continue;
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
  };

  if (isDbExecutorObj(client)) {
    return getCachedOrLoad(
      client,
      { scope: 'settings', key: 'settings_map', ttlMs: 30000 },
      loadSettings
    );
  }
  return loadSettings();
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

const seededExecutors = new WeakSet<DbExecutor>();
const seedPromiseByExec = new WeakMap<DbExecutor, Promise<void>>();
const facetsCacheByExec = new WeakMap<DbExecutor, { expiresAt: number; syncTs: number; companies: string[]; branches: string[] }>();

async function getCachedReservationFacets(executor: DbExecutor): Promise<{ companies: string[]; branches: string[] }> {
  const now = Date.now();
  const syncTs = getLastSyncBatchMutatedAt();
  const cached = facetsCacheByExec.get(executor);
  if (cached && now < cached.expiresAt && cached.syncTs === syncTs) {
    return { companies: cached.companies, branches: cached.branches };
  }
  const [compFacets, branchFacets] = await Promise.all([
    executor.query<{ company_name: string }>(
      `SELECT DISTINCT company_name FROM reservations WHERE company_name <> '' ORDER BY company_name ASC LIMIT 200`
    ),
    executor.query<{ branch_name: string }>(
      `SELECT DISTINCT branch_name FROM reservations WHERE branch_name <> '' ORDER BY branch_name ASC LIMIT 300`
    )
  ]);
  const companies = compFacets.rows.map((c) => c.company_name);
  const branches = branchFacets.rows.map((b) => b.branch_name);
  facetsCacheByExec.set(executor, { expiresAt: now + 60000, syncTs, companies, branches });
  return { companies, branches };
}

export async function ensureSeededDatabase(executor: DbExecutor): Promise<void> {
  if (seededExecutors.has(executor)) return;
  const inflight = seedPromiseByExec.get(executor);
  if (inflight) return inflight;

  const p = (async () => {
    const countRes = await executor.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM employees`);
    const cnt = Number(countRes.rows[0]?.cnt || 0);
    const nowIso = new Date().toISOString();
    const devSeed = {
      id: 'EMP_DEV',
      name: 'المبرمج - مسؤول الموقع',
      username: 'developer',
      password: process.env.SEED_DEVELOPER_PASSWORD || 'Dev@123',
      salt: 'RG_SEED_DEVELOPER',
      phone: '0500000009',
      email: 'dev@rentalgate.net',
      jobTitle: 'مبرمج ومسؤول إعدادات الموقع',
      role: 'developer',
      permissions: ['all']
    };

    if (cnt > 0) {
      try {
        const devCheck = await executor.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM employees WHERE role = 'developer' OR LOWER(username) = 'developer'`
        );
        if (Number(devCheck.rows[0]?.cnt || 0) === 0) {
          const pHash = hashPassword(devSeed.password, devSeed.salt);
          await executor.query(
            `INSERT INTO employees (id, name, username, password_hash, salt, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'active',$11::text,$12::timestamptz,$12::timestamptz)
             ON CONFLICT (username) DO NOTHING`,
            [devSeed.id, devSeed.name, devSeed.username, pHash, devSeed.salt, devSeed.phone, devSeed.email, devSeed.jobTitle, devSeed.role, JSON.stringify(devSeed.permissions), nowIso, nowIso]
          );
          await executor.query(
            `INSERT INTO users (id, name, username, phone, email, job_title, role, permissions, status, last_activity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',$9,$10::timestamptz,$10::timestamptz)
             ON CONFLICT (username) DO NOTHING`,
            [devSeed.id, devSeed.name, devSeed.username, devSeed.phone, devSeed.email, devSeed.jobTitle, devSeed.role, JSON.stringify(devSeed.permissions), nowIso, nowIso]
          );
        }
      } catch {
        // Non-fatal fallback for custom/mock executors
      }
      seededExecutors.add(executor);
      return;
    }

  const seeds = [
    devSeed,
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
      salt: 'RG_SEED_SUPERVISOR',
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'active',$11::text,$12::timestamptz,$12::timestamptz)
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
      ['excluded_statuses', JSON.stringify(['draft', 'test', 'abandoned'])],
      ['session_ttl_hours', '12'],
      ['allow_agent_view_all', 'true'],
      ['default_language', 'ar'],
      ['auto_sync_enabled', 'true'],
      ['auto_sync_interval_hours', '12'],
      ['auto_sync_interval_minutes', '0']
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
    seededExecutors.add(executor);
    invalidateScopes(executor, ['settings']);
  })().finally(() => {
    seedPromiseByExec.delete(executor);
  });

  seedPromiseByExec.set(executor, p);
  return p;
}

// ---------- TODAY MOVEMENTS & 24H RADAR (FULL-DB PREFILTERED) ----------

export async function getTodayAndRadar(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
): Promise<Record<string, any>> {
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const restrictAgent = session.user.role === 'agent' && !allowAgentViewAll;
  const roleScope = restrictAgent ? `agent:${session.user.id}` : 'all';

  const rawToday = str(payload.todayDate);
  const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    : (typeof crmCore.getRiyadhTodayDateStr === 'function' ? crmCore.getRiyadhTodayDateStr() : new Date().toISOString().slice(0, 10));
  const minDate = shiftIsoDateDays(todayStr, -2);
  const maxDate = shiftIsoDateDays(todayStr, 2);

  const rawNow = Number(payload.nowMs);
  const serverNow = Date.now();
  const nowMs = (!isNaN(rawNow) && Math.abs(rawNow - serverNow) <= 86400000) ? rawNow : serverNow;

  const candidates = await getCachedOrLoad(
    executor,
    { scope: 'todayRadar', key: `cand:${roleScope}:${todayStr}`, ttlMs: 15000, bypassCache: toBool(payload.forceRefresh) },
    async () => {
      const params: any[] = [todayStr, minDate, maxDate];
      let agentSql = '';
      if (restrictAgent) {
        params.push(JSON.stringify([session.user.id]));
        agentSql = `r.assigned_employee_ids @> $${params.length}::jsonb AND `;
      }
      const rowsRes = await executor.query(
        `SELECT r.*
         FROM reservations r
         WHERE ${agentSql}${SQL_ACTIVE_CONDITION} AND (
           LEFT(COALESCE(NULLIF(r.start_date, ''), ''), 10) = $1
           OR (LEFT(COALESCE(NULLIF(r.end_date, ''), NULLIF(r.original_end_date, '')), 10) >= $2 AND LEFT(COALESCE(NULLIF(r.end_date, ''), NULLIF(r.original_end_date, '')), 10) <= $3)
           OR (r.extended_until_date <> '' AND LEFT(r.extended_until_date, 10) >= $2 AND LEFT(r.extended_until_date, 10) <= $3)
         )
         ORDER BY r.start_date ASC, r.end_date ASC
         LIMIT 2500`,
        params
      );
      const mapped = rowsRes.rows
        .map((r) => mapReservationRowToClient(r, false))
        .filter((m) => !(typeof crmCore.isInactiveReservation === 'function' && crmCore.isInactiveReservation(m)));
      const ids = mapped.map((m) => str(m.id)).filter(Boolean);
      if (ids.length > 0) {
        const fuSetRes = await executor.query<{ reservation_id: string }>(
          `SELECT DISTINCT reservation_id FROM follow_ups WHERE reservation_id = ANY($1::text[])`,
          [ids]
        ).catch(() => ({ rows: [] as Array<{ reservation_id: string }> }));
        const followedSet = new Set(fuSetRes.rows.map((x) => str(x.reservation_id)));
        for (const item of mapped) {
          if (followedSet.has(str(item.id))) item.isFollowed = true;
        }
      }
      return mapped;
    }
  );

  const todaySummary = crmCore.computeTodayMovementsSummary(candidates, nowMs, {
    todayDate: todayStr,
    subFilter: 'all'
  });
  const radarSummary = crmCore.computeExpiryRadarSummary(candidates, nowMs, {
    subFilter: 'all',
    windowHours: 24,
    gracePastHours: 12
  });

  const counts = {
    todayTotal: num(todaySummary.totalCount),
    pickupCount: num(todaySummary.pickupCount),
    returnCount: num(todaySummary.returnCount),
    pendingPickupCount: num(todaySummary.pendingPickupCount),
    pendingReturnCount: num(todaySummary.pendingReturnCount),
    overdueTodayCount: num(todaySummary.overdueCount),
    radarTotal: num(radarSummary.totalCount),
    upcoming24hCount: num(radarSummary.upcoming24hCount),
    critical6hCount: num(radarSummary.critical6hCount),
    soon24hCount: num(radarSummary.soon24hCount),
    expiredUnclosedCount: num(radarSummary.expiredUnclosedCount),
    extendedInRadarCount: num(radarSummary.extendedInRadarCount)
  };

  if (toBool(payload.summaryOnly)) {
    return {
      todayDate: todayStr,
      serverTime: new Date().toISOString(),
      counts
    };
  }

  return {
    todayDate: todayStr,
    serverTime: new Date().toISOString(),
    counts,
    todaySummary: {
      ...todaySummary,
      items: redactReservationsList(todaySummary?.items || [], session.user)
    },
    radarSummary: {
      ...radarSummary,
      items: redactReservationsList(radarSummary?.items || [], session.user)
    },
    items: redactReservationsList(candidates, session.user)
  };
}

// ---------- DASHBOARD & BOOTSTRAP ----------

export async function getDashboard(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
): Promise<Record<string, any>> {
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(str(payload.todayDate))
    ? str(payload.todayDate)
    : (typeof crmCore.getRiyadhTodayDateStr === 'function' ? crmCore.getRiyadhTodayDateStr() : new Date().toISOString().slice(0, 10));

  const range = str(payload.range);
  let dateFrom = str(payload.dateFrom);
  let dateTo = str(payload.dateTo);
  if (!dateFrom && !dateTo) {
    if (range === 'today') {
      dateFrom = today;
      dateTo = today;
    } else if (range === '7d') {
      dateFrom = shiftIsoDateDays(today, -6);
      dateTo = today;
    } else if (range === '30d') {
      dateFrom = shiftIsoDateDays(today, -29);
      dateTo = today;
    } else if (range === 'month') {
      dateFrom = `${today.slice(0, 7)}-01`;
      dateTo = today;
    }
  }

  const restrictAgent = session.user.role === 'agent' && !allowAgentViewAll;
  const canSync = crmCore.canAccessApi(session.user);
  const statsControlCfg = typeof crmCore.normalizeStatsControlConfig === 'function'
    ? crmCore.normalizeStatsControlConfig(settings.stats_control_config)
    : { excludedFromStatsEmployeeIds: [] };
  const excludedStatsSet = new Set<string>(statsControlCfg.excludedFromStatsEmployeeIds || []);
  const statsSig = Array.from(excludedStatsSet).sort().join(',');
  const cacheKey = `${restrictAgent ? session.user.id : 'all'}|${canSync ? 'sync' : 'nosync'}|${range}|${dateFrom}|${dateTo}|${today}|${statsSig}`;

  return getCachedOrLoad(
    executor,
    { scope: 'dashboard', key: cacheKey, ttlMs: 20000, bypassCache: toBool(payload.forceRefresh) },
    async () => {
      const resParams: any[] = [];
      const resClauses: string[] = [];
      if (restrictAgent) {
        resParams.push(JSON.stringify([session.user.id]));
        resClauses.push(`assigned_employee_ids @> $${resParams.length}::jsonb`);
      }
      if (dateFrom) {
        resParams.push(dateFrom);
        resClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')) >= $${resParams.length}`);
      }
      if (dateTo) {
        resParams.push(dateTo);
        resClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')) <= $${resParams.length}`);
      }
      const resWhere = resClauses.length ? `WHERE ${resClauses.join(' AND ')}` : '';
      const resAliasedClauses = resClauses.map((c) =>
        c
          .replace(/\bassigned_employee_ids\b/g, 'r.assigned_employee_ids')
          .replace(/\bstart_date\b/g, 'r.start_date')
          .replace(/\bcreated_at\b/g, 'r.created_at')
      );
      const resAliasedWhere = resAliasedClauses.length ? `WHERE ${resAliasedClauses.join(' AND ')}` : '';
      const totalParams = [...resParams, today];
      const todayParamIdx = totalParams.length;

      const fuParams: any[] = [];
      const fuClauses: string[] = [];
      if (dateFrom) {
        fuParams.push(dateFrom);
        fuClauses.push(`follow_up_date >= $${fuParams.length}`);
      }
      if (dateTo) {
        fuParams.push(dateTo);
        fuClauses.push(`follow_up_date <= $${fuParams.length}`);
      }
      const fuWhere = fuClauses.length ? `WHERE ${fuClauses.join(' AND ')}` : '';

      const fuTodayParams: any[] = [today];
      const fuTodayClauses: string[] = [`follow_up_date = $1`];
      if (restrictAgent) {
        fuTodayParams.push(session.user.id);
        fuTodayClauses.push(`employee_id = $${fuTodayParams.length}`);
      }
      const fuTodayWhere = `WHERE ${fuTodayClauses.join(' AND ')}`;

      const lbResParams: any[] = [];
      const lbResClauses: string[] = [];
      if (dateFrom) {
        lbResParams.push(dateFrom);
        lbResClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')) >= $${lbResParams.length}`);
      }
      if (dateTo) {
        lbResParams.push(dateTo);
        lbResClauses.push(`COALESCE(NULLIF(start_date, ''), to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')) <= $${lbResParams.length}`);
      }
      const lbResWhere = lbResClauses.length ? `WHERE ${lbResClauses.join(' AND ')}` : '';

      const lbPrbParams: any[] = [];
      const lbPrbClauses: string[] = [];
      if (dateFrom) {
        lbPrbParams.push(dateFrom);
        lbPrbClauses.push(`to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') >= $${lbPrbParams.length}`);
      }
      if (dateTo) {
        lbPrbParams.push(dateTo);
        lbPrbClauses.push(`to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') <= $${lbPrbParams.length}`);
      }
      const lbPrbWhere = lbPrbClauses.length ? `WHERE ${lbPrbClauses.join(' AND ')}` : '';

      const prbAggParams = [...lbPrbParams];
      const prbAggClauses = [...lbPrbClauses];
      if (restrictAgent) {
        prbAggParams.push(JSON.stringify([session.user.id]));
        const pAssignIdx = prbAggParams.length;
        prbAggParams.push(session.user.id);
        const pCreatorIdx = prbAggParams.length;
        prbAggClauses.push(`(assigned_employee_ids @> $${pAssignIdx}::jsonb OR created_by_id = $${pCreatorIdx})`);
      }
      const prbAggWhere = prbAggClauses.length ? `WHERE ${prbAggClauses.join(' AND ')}` : '';

      const [
        resTotalsQuery,
        resStatusQuery,
        resCompanyQuery,
        resAssignedQuery,
        fuAggQuery,
        fuTodayQuery,
        prbAggQuery,
        empQuery,
        recentActivityRes,
        syncRes,
        todayRadarSummary,
        lbResQuery,
        lbFuQuery,
        lbPrbQuery
      ] = await Promise.all([
        executor.query<{ total_cnt: number; active_cnt?: number; today_cnt: number; cancelled_cnt?: number; rejected_cnt?: number }>(
          `SELECT COUNT(*)::int AS total_cnt,
                  COUNT(*) FILTER (WHERE ${SQL_ACTIVE_CONDITION})::int AS active_cnt,
                  COUNT(*) FILTER (WHERE LEFT(COALESCE(NULLIF(r.start_date, ''), ''), 10) = $${todayParamIdx}::text OR (r.created_at >= (($${todayParamIdx}::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Riyadh') AND r.created_at < ((($${todayParamIdx}::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Riyadh') + INTERVAL '1 day')))::int AS today_cnt,
                  COUNT(*) FILTER (WHERE ${SQL_CANCELLED_CONDITION})::int AS cancelled_cnt,
                  COUNT(*) FILTER (WHERE ${SQL_REJECTED_TAB_CONDITION})::int AS rejected_cnt
           FROM reservations r ${resAliasedWhere}`,
          totalParams
        ),
        executor.query<{ internal_status: string; cnt: number }>(
          `SELECT COALESCE(NULLIF(internal_status, ''), 'تم الإنشاء') AS internal_status, COUNT(*)::int AS cnt
           FROM reservations ${resWhere}
           GROUP BY 1`,
          resParams
        ),
        executor.query<{ company_name: string; cnt: number }>(
          `SELECT COALESCE(NULLIF(company_name, ''), 'غير محدد') AS company_name, COUNT(*)::int AS cnt
           FROM reservations ${resWhere}
           GROUP BY 1`,
          resParams
        ),
        executor.query<{ emp_id: string; cnt: number }>(
          `SELECT emp_id, COUNT(*)::int AS cnt
           FROM reservations r,
                LATERAL jsonb_array_elements_text(r.assigned_employee_ids) AS emp_id
           ${resWhere}
           GROUP BY emp_id`,
          resParams
        ),
        executor.query<{ follow_up_date: string; employee_id: string; employee_name: string; cnt: number }>(
          `SELECT follow_up_date, employee_id, employee_name, COUNT(*)::int AS cnt
           FROM follow_ups ${fuWhere}
           GROUP BY follow_up_date, employee_id, employee_name`,
          fuParams
        ),
        executor.query<{ today_cnt: number }>(
          `SELECT COUNT(*)::int AS today_cnt FROM follow_ups ${fuTodayWhere}`,
          fuTodayParams
        ),
        executor.query<{ status: string; priority: string; cnt: number }>(
          `SELECT status, priority, COUNT(*)::int AS cnt FROM problems ${prbAggWhere} GROUP BY status, priority`,
          prbAggParams
        ),
        executor.query(`SELECT id, name, username, role, job_title, status FROM employees WHERE status = 'active'`),
        executor.query(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 8`),
        canSync ? executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1`) : Promise.resolve({ rows: [] as any[], rowCount: 0 }),
        getTodayAndRadar(executor, session, { summaryOnly: true, todayDate: today }).catch(() => ({ counts: null })),
        executor.query(`SELECT assigned_employee_ids, internal_status, original_status_code, original_status_ar FROM reservations ${lbResWhere} LIMIT 5000`, lbResParams),
        executor.query(`SELECT employee_id, employee_name FROM follow_ups ${fuWhere} LIMIT 10000`, fuParams),
        executor.query(`SELECT assigned_employee_ids, created_by_id, status FROM problems ${lbPrbWhere} LIMIT 2000`, lbPrbParams)
      ]);

  const statusCounts: Record<string, number> = {};
  for (const s of crmCore.FOLLOWUP_STATUSES) {
    statusCounts[s] = 0;
  }
  for (const row of resStatusQuery.rows) {
    const st = str(row.internal_status || 'تم الإنشاء');
    statusCounts[st] = (statusCounts[st] || 0) + num(row.cnt);
  }
  const newReservations = (statusCounts['تم الإنشاء'] || 0) + (statusCounts['جديد'] || 0) + (statusCounts['قيد الانتظار'] || 0);

  const companyCounts: Record<string, number> = {};
  for (const row of resCompanyQuery.rows) {
    const comp = str(row.company_name || 'غير محدد');
    companyCounts[comp] = (companyCounts[comp] || 0) + num(row.cnt);
  }

  const assignedByEmpId = new Map<string, number>();
  for (const row of resAssignedQuery.rows) {
    assignedByEmpId.set(str(row.emp_id), num(row.cnt));
  }

  const excludedEmpNames = new Set<string>(
    empQuery.rows
      .filter((e: any) => excludedStatsSet.has(str(e.id)))
      .map((e: any) => str(e.name))
      .filter(Boolean)
  );
  const statsEmpRows = empQuery.rows.filter((e: any) => !excludedStatsSet.has(str(e.id)));

  const dailyFollowUps: Record<string, number> = {};
  const empFollowUpCounts: Record<string, number> = {};
  for (const row of fuAggQuery.rows) {
    const cnt = num(row.cnt);
    const fDate = str(row.follow_up_date);
    const eId = str(row.employee_id);
    const eName = str(row.employee_name);
    if (fDate) dailyFollowUps[fDate] = (dailyFollowUps[fDate] || 0) + cnt;
    const isExcludedFu = (eId && excludedStatsSet.has(eId)) || (!eId && eName && excludedEmpNames.has(eName));
    if (eName && !isExcludedFu) empFollowUpCounts[eName] = (empFollowUpCounts[eName] || 0) + cnt;
  }

  let openProblems = 0;
  let closedProblems = 0;
  let highProblems = 0;
  const problemPriorities: Record<string, number> = { 'عادي': 0, 'متوسط': 0, 'مرتفع': 0 };
  for (const row of prbAggQuery.rows) {
    const cnt = num(row.cnt);
    const isClosed = row.status === 'مغلقة' || row.status === 'تم الحل';
    if (isClosed) closedProblems += cnt;
    else openProblems += cnt;
    if (row.priority === 'مرتفع' && !isClosed) highProblems += cnt;
    if (Object.prototype.hasOwnProperty.call(problemPriorities, row.priority)) {
      problemPriorities[row.priority] += cnt;
    }
  }

  const employeeComparison = statsEmpRows.map((emp) => ({
    name: str(emp.name),
    followUps: empFollowUpCounts[str(emp.name)] || 0,
    assigned: assignedByEmpId.get(str(emp.id)) || 0
  }));

  const metrics = {
    kpis: {
      totalReservations: num(resTotalsQuery.rows[0]?.total_cnt),
      activeReservations: resTotalsQuery.rows[0]?.active_cnt !== undefined
        ? num(resTotalsQuery.rows[0]?.active_cnt)
        : Math.max(0, num(resTotalsQuery.rows[0]?.total_cnt) - num(resTotalsQuery.rows[0]?.cancelled_cnt) - num(resTotalsQuery.rows[0]?.rejected_cnt)),
      todayReservations: num(resTotalsQuery.rows[0]?.today_cnt),
      newReservations,
      booked: statusCounts['تم الحجز'] || 0,
      delivered: statusCounts['تم التسليم'] || 0,
      received: statusCounts['تم الاستلام'] || 0,
      created: statusCounts['تم الإنشاء'] || 0,
      cancelled: resTotalsQuery.rows[0]?.cancelled_cnt !== undefined
        ? num(resTotalsQuery.rows[0]?.cancelled_cnt)
        : ((statusCounts['تم الإلغاء'] || 0) + (statusCounts['ملغي'] || 0)),
      rejected: resTotalsQuery.rows[0]?.rejected_cnt !== undefined
        ? num(resTotalsQuery.rows[0]?.rejected_cnt)
        : (statusCounts['مرفوض'] || 0),
      extended: statusCounts['تم التمديد'] || 0,
      notBooked: statusCounts['لم يتم الحجز'] || 0,
      openProblems,
      highProblems,
      todayFollowUps: num(fuTodayQuery.rows[0]?.today_cnt)
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
  if (canSync && syncRes.rows[0]) {
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

      const leaderboard = typeof crmCore.computeEmployeeLeaderboard === 'function'
        ? crmCore.computeEmployeeLeaderboard(
            statsEmpRows.map((e: any) => ({
              id: str(e.id),
              name: str(e.name),
              username: str(e.username),
              role: str(e.role || 'agent'),
              jobTitle: str(e.job_title),
              status: str(e.status || 'active')
            })),
            lbResQuery.rows.map((r: any) => ({
              assignedEmployeeIds: parseJsonArray<string>(r.assigned_employee_ids),
              internalStatus: str(r.internal_status),
              originalStatusCode: str(r.original_status_code),
              originalStatusAr: str(r.original_status_ar)
            })),
            lbFuQuery.rows.map((f: any) => ({
              employeeId: str(f.employee_id),
              employeeName: str(f.employee_name)
            })),
            lbPrbQuery.rows.map((p: any) => ({
              assignedEmployeeIds: parseJsonArray<string>(p.assigned_employee_ids),
              createdById: str(p.created_by_id),
              status: str(p.status)
            })),
            { limit: 10, excludedEmployeeIds: Array.from(excludedStatsSet) }
          )
        : [];

      return {
        ...metrics,
        recentActivity,
        lastSync,
        todayRadarCounts: (todayRadarSummary as any)?.counts || null,
        leaderboard
      };
    }
  );
}

async function fetchNotificationsForSession(client: DbClient, session: AuthSession) {
  const userId = str(session.user.id);
  const userRole = str(session.user.role);
  const res = await client.query(
    `SELECT * FROM notifications
     WHERE (
       BTRIM(COALESCE(recipient_employee_id, '')) = $1
       OR (
         BTRIM(COALESCE(recipient_employee_id, '')) = ''
         AND (BTRIM(COALESCE(recipient_role, '')) = $2 OR BTRIM(COALESCE(recipient_role, '')) = 'all')
       )
     )
       AND deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM notification_dismissals nd
         WHERE nd.notification_id = notifications.id
           AND BTRIM(COALESCE(nd.employee_id, '')) = $1
           AND nd.deleted_at IS NOT NULL
       )
     ORDER BY created_at DESC
     LIMIT 60`,
    [userId, userRole]
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

export async function getNotifications(executor: DbExecutor, session: AuthSession) {
  return fetchNotificationsForSession(executor, session);
}

export async function getAppBootstrap(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const range = str(payload.range || '30d');
  const canDashboard = crmCore.canUserPerform(session.user, 'view_dashboard');
  const canEmployees = crmCore.canUserPerform(session.user, 'view_employees');
  const canSync = crmCore.canAccessApi(session.user);

  const [dashboard, notifications, settings, serverCfg, employeesData] = await Promise.all([
    canDashboard ? getDashboard(executor, session, { range }) : Promise.resolve(null),
    getNotifications(executor, session),
    getSettingsMap(executor),
    resolveServerConfig(executor),
    canEmployees ? getEmployees(executor, session) : Promise.resolve(null)
  ]);

  const uiSimplification = crmCore.normalizeUiSimplificationSettings(settings.ui_simplification);
  const roleUiDefaults = typeof crmCore.normalizeRoleUiDefaults === 'function'
    ? crmCore.normalizeRoleUiDefaults(settings.role_ui_defaults)
    : {};
  const statsControlConfig = typeof crmCore.normalizeStatsControlConfig === 'function'
    ? crmCore.normalizeStatsControlConfig(settings.stats_control_config)
    : { excludedFromStatsEmployeeIds: [] };
  const callWrapupShortcuts = typeof crmCore.normalizeCallWrapupShortcutsConfig === 'function'
    ? crmCore.normalizeCallWrapupShortcutsConfig(settings.call_wrapup_shortcuts)
    : { items: crmCore.CALL_WRAPUP_OUTCOMES || [], customized: false, updatedAt: '', updatedBy: '' };
  const handoverSettings = crmCore.normalizeHandoverSettings(settings.handover_settings);
  const customerNotesConfig = typeof crmCore.normalizeCustomerNotesConfig === 'function'
    ? crmCore.normalizeCustomerNotesConfig(settings.customer_notes_config)
    : {};
  const customerNoteStatuses = await loadCustomerNoteStatusesList(executor).catch(() =>
    (crmCore.CUSTOMER_NOTE_DEFAULT_STATUSES || []).map((s: any) => ({ ...s }))
  );
  const layoutPrefs = crmCore.normalizeUserLayoutPrefs(parseJsonValue(settings[`layout_prefs_u_${session.user.id}`], {}));
  const rawPinnedCritical = parseJsonValue<any[]>(settings[`pinned_res_u_${session.user.id}`], []);
  const pinnedCriticalIds = Array.isArray(rawPinnedCritical)
    ? rawPinnedCritical.map((x) => str(x)).filter(Boolean).slice(0, crmCore.MAX_PINNED_CRITICAL_RESERVATIONS || 3)
    : [];
  const [announcementsData, locksData] = await Promise.all([
    getAnnouncements(executor, session).catch(() => ({ items: [], activeItems: [] })),
    getReservationLocks(executor, session).catch(() => ({ items: [] }))
  ]);

  let settingsOut: any = null;
  if (canSync) {
    const syncInterval = crmCore.normalizeAutoSyncInterval(
      settings.auto_sync_interval_hours,
      settings.auto_sync_interval_minutes
    );
    settingsOut = {
      ...settings,
      ui_simplification: uiSimplification,
      role_ui_defaults: roleUiDefaults,
      stats_control_config: statsControlConfig,
      call_wrapup_shortcuts: callWrapupShortcuts,
      handover_settings: handoverSettings,
      customer_notes_config: customerNotesConfig,
      gas_webapp_url: serverCfg.gasWebAppUrl,
      auto_sync_enabled: settings.auto_sync_enabled !== false,
      auto_sync_interval_hours: syncInterval.hours,
      auto_sync_interval_minutes: syncInterval.minutes,
      hasRgToken: Boolean(serverCfg.rgToken || serverCfg.gasWebAppUrl),
      hasDirectToken: Boolean(serverCfg.rgToken),
      hasSyncSecret: Boolean(serverCfg.syncApiSecret)
    };
  }

  return {
    user: session.user,
    me: { user: session.user },
    dashboard,
    todayRadarCounts: dashboard?.todayRadarCounts || null,
    notifications,
    employees: employeesData,
    settings: settingsOut,
    uiSimplification,
    roleUiDefaults,
    statsControlConfig,
    callWrapupShortcuts,
    handoverSettings,
    customerNotesConfig,
    customerNoteStatuses,
    announcements: announcementsData.activeItems || [],
    activeLocks: locksData.items || [],
    layoutPrefs,
    pinnedCriticalIds,
    syncVersion: getLocalCacheVersion(executor)
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

  const lifecycle = str(payload.lifecycle || 'active').toLowerCase();
  if (lifecycle === 'rejected') {
    clauses.push(SQL_REJECTED_TAB_CONDITION);
  } else if (lifecycle === 'cancelled') {
    clauses.push(SQL_CANCELLED_CONDITION);
  } else if (lifecycle === 'inactive') {
    clauses.push(`(${SQL_REJECTED_TAB_CONDITION} OR ${SQL_CANCELLED_CONDITION})`);
  } else if (lifecycle !== 'all') {
    clauses.push(SQL_ACTIVE_CONDITION);
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

  if (payload.companyNumber) {
    const compNumCond = buildPgSearchCondition(['r.company_number'], payload.companyNumber, params);
    if (compNumCond) clauses.push(compNumCond);
  }

  if (payload.oldCompanyName) {
    const oldCompCond = buildPgSearchCondition(['r.company_name'], payload.oldCompanyName, params);
    if (oldCompCond) clauses.push(oldCompCond);
  }

  if (payload.newCompanyName) {
    const newCompCond = buildPgSearchCondition(['r.new_company_name'], payload.newCompanyName, params);
    if (newCompCond) clauses.push(newCompCond);
  }

  if (payload.rejectionReason) {
    const rejReasonCond = buildPgSearchCondition(['r.rejection_reason'], payload.rejectionReason, params);
    if (rejReasonCond) clauses.push(rejReasonCond);
  }

  if (payload.cancellationReason) {
    const canReasonCond = buildPgSearchCondition(['r.cancellation_reason'], payload.cancellationReason, params);
    if (canReasonCond) clauses.push(canReasonCond);
  }

  if (payload.confirmedByEmployee || payload.actionByEmployee) {
    const actorFilter = str(payload.confirmedByEmployee || payload.actionByEmployee);
    params.push(actorFilter);
    const pIdx = params.length;
    clauses.push(`(r.rejected_by_id = $${pIdx} OR r.rejected_by_name = $${pIdx} OR r.cancelled_by_id = $${pIdx} OR r.cancelled_by_name = $${pIdx} OR r.last_updated_by_id = $${pIdx} OR r.last_updated_by_name = $${pIdx})`);
  }

  if (payload.branch) {
    params.push(str(payload.branch));
    clauses.push(`r.branch_name = $${params.length}`);
  }

  const isCalendarMode = toBool(payload.calendarMode);
  const isExportMode = toBool(payload.exportMode);
  const calFrom = str(payload.calendarFrom).slice(0, 10);
  const calTo = str(payload.calendarTo).slice(0, 10);
  if (isCalendarMode && /^\d{4}-\d{2}-\d{2}$/.test(calFrom) && /^\d{4}-\d{2}-\d{2}$/.test(calTo)) {
    params.push(calFrom);
    const cfIdx = params.length;
    params.push(calTo);
    const ctIdx = params.length;
    clauses.push(`(
      (LEFT(COALESCE(NULLIF(r.start_date, ''), ''), 10) >= $${cfIdx} AND LEFT(COALESCE(NULLIF(r.start_date, ''), ''), 10) <= $${ctIdx})
      OR (LEFT(COALESCE(NULLIF(r.end_date, ''), NULLIF(r.original_end_date, '')), 10) >= $${cfIdx} AND LEFT(COALESCE(NULLIF(r.end_date, ''), NULLIF(r.original_end_date, '')), 10) <= $${ctIdx})
      OR (r.extended_until_date <> '' AND LEFT(r.extended_until_date, 10) >= $${cfIdx} AND LEFT(r.extended_until_date, 10) <= $${ctIdx})
    )`);
  }

  const dateFrom = str(payload.dateFrom).slice(0, 10);
  const dateTo = str(payload.dateTo).slice(0, 10);
  if (dateFrom && dateTo) {
    params.push(dateFrom);
    clauses.push(`r.start_date >= $${params.length}`);
    params.push(dateTo);
    clauses.push(`r.start_date <= $${params.length}`);
  } else if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`r.start_date >= $${params.length}`);
  } else if (dateTo) {
    params.push(dateTo);
    clauses.push(
      `LEFT(COALESCE(NULLIF(r.extended_until_date, ''), NULLIF(r.end_date, ''), NULLIF(r.original_end_date, '')), 10) = $${params.length}`
    );
  }

  if (toBool(payload.hasProblem) || toBool(payload.hasProblemsOnly)) {
    clauses.push(`r.has_problem = TRUE`);
  }

  if (toBool(payload.hasExtensions)) {
    clauses.push(`r.has_extensions = TRUE`);
  }

  if (toBool(payload.unfollowedOnly)) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id)`);
  }

  const resNumberQuery = str(payload.reservationNumber).replace(/^#+/, '').trim();
  if (resNumberQuery) {
    const resNumCond = buildPgSearchCondition(
      ['r.reservation_number', 'r.source_reservation_id', 'r.reference_number'],
      resNumberQuery,
      params
    );
    if (resNumCond) clauses.push(resNumCond);
  }

  const canSearchId = typeof crmCore.canUserViewCustomerId === 'function' && crmCore.canUserViewCustomerId(session.user);
  if (payload.search) {
    const searchCols = [
      'r.reservation_number',
      'r.reference_number',
      'r.source_reservation_id',
      'r.customer_name',
      'r.customer_phone',
      'r.car_name',
      'r.plate_number',
      'r.branch_name',
      'r.company_name',
      'r.company_number',
      'r.new_company_name',
      'r.rejection_reason',
      'r.cancellation_reason',
      'r.delivery_failure_reason',
      'r.driver_notes'
    ];
    if (canSearchId) {
      searchCols.push('r.customer_id_number');
    }
    const searchCond = buildPgSearchCondition(searchCols, payload.search, params);
    if (searchCond) clauses.push(searchCond);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const RESERVATION_SORT_COLUMNS: Record<string, string> = {
    lastUpdatedAt: 'r.updated_at',
    updatedAt: 'r.updated_at',
    createdAt: 'r.created_at',
    sourceCreatedAt: 'r.source_created_at',
    reservationNumber: 'r.reservation_number',
    referenceNumber: 'r.reference_number',
    customerName: 'r.customer_name',
    customerPhone: 'r.customer_phone',
    companyName: 'r.company_name',
    branchName: 'r.branch_name',
    carName: 'r.car_name',
    startDate: 'r.start_date',
    endDate: 'r.end_date',
    daysCount: 'r.days_count',
    extensionsCount: 'r.extensions_count',
    extendedUntilDate: 'r.extended_until_date',
    extensionsAmount: 'r.extensions_amount',
    totalAmount: 'r.total_amount',
    paidAmount: 'r.paid_amount',
    originalStatusAr: 'r.original_status_ar',
    internalStatus: 'r.internal_status',
    priority: 'r.priority',
    rejectedAt: 'r.rejected_at',
    cancelledAt: 'r.cancelled_at',
    lastUpdatedByName: 'r.last_updated_by_name',
    sourceOrder: 'r.source_order'
  };

  let orderSql = 'r.source_order ASC NULLS LAST';
  const rawSortBy = str(payload.sortBy);
  const hasExplicitSortDir = str(payload.sortDir).length > 0;
  const rawSortDir = str(payload.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  if (!rawSortBy || rawSortBy === 'sourceOrder') {
    orderSql = (rawSortBy === 'sourceOrder' && hasExplicitSortDir && rawSortDir === 'DESC')
      ? 'r.source_order DESC NULLS LAST'
      : 'r.source_order ASC NULLS LAST';
  } else if (rawSortBy === 'startDate_desc') {
    orderSql = 'r.start_date DESC, r.source_order ASC NULLS LAST, r.id DESC';
  } else if (rawSortBy === 'startDate_asc') {
    orderSql = 'r.start_date ASC, r.source_order ASC NULLS LAST, r.id DESC';
  } else if (rawSortBy === 'totalAmount_desc') {
    orderSql = 'r.total_amount DESC, r.source_order ASC NULLS LAST, r.id DESC';
  } else if (RESERVATION_SORT_COLUMNS[rawSortBy]) {
    const col = RESERVATION_SORT_COLUMNS[rawSortBy];
    orderSql = `${col} ${rawSortDir}, r.source_order ASC NULLS LAST, r.id DESC`;
  }

  const page = Math.max(1, num(payload.page, 1));
  const maxAllowedPageSize = (isCalendarMode || isExportMode) ? 2500 : 200;
  const defaultPageSize = isCalendarMode ? 2500 : 25;
  const pageSize = Math.min(maxAllowedPageSize, Math.max(1, num(payload.pageSize, defaultPageSize)));
  const offset = (page - 1) * pageSize;

  const hasTimeFilter = Boolean(str(payload.timeFrom) || str(payload.timeTo));
  const overdueUnpaidOnly = toBool(payload.overdueUnpaidOnly);

  const loadLifecycleCounts = async () => {
    const scopeParams: any[] = [];
    const scopeWhere = (session.user.role === 'agent' && !allowAgentViewAll)
      ? (scopeParams.push(JSON.stringify([session.user.id])), `WHERE r.assigned_employee_ids @> $1::jsonb`)
      : '';
    const [lcRes, todayRadarRes] = await Promise.all([
      executor.query<{
        total_cnt: string;
        active_cnt: string;
        cancelled_cnt: string;
        rejected_cnt: string;
      }>(
        `SELECT
           COUNT(*)::text AS total_cnt,
           COUNT(*) FILTER (WHERE ${SQL_ACTIVE_CONDITION})::text AS active_cnt,
           COUNT(*) FILTER (WHERE ${SQL_CANCELLED_CONDITION})::text AS cancelled_cnt,
           COUNT(*) FILTER (WHERE ${SQL_REJECTED_TAB_CONDITION})::text AS rejected_cnt
         FROM reservations r ${scopeWhere}`,
        scopeParams
      ).catch(() => ({ rows: [] as any[] })),
      getTodayAndRadar(executor, session, {
        summaryOnly: true,
        forceRefresh: toBool(payload.forceRefresh)
      }).catch(() => ({ counts: null }))
    ]);
    const row = lcRes.rows?.[0] || {};
    const trCounts = (todayRadarRes as any)?.counts || {};
    return {
      all: Number(row.total_cnt || 0),
      active: Number(row.active_cnt || 0),
      cancelled: Number(row.cancelled_cnt || 0),
      rejected: Number(row.rejected_cnt || 0),
      today: Number(trCounts.todayTotal || 0),
      radar: Number(trCounts.radarTotal || 0)
    };
  };

  if (hasTimeFilter || overdueUnpaidOnly) {
    const [allMatchedRes, extRowsRes, facets, lifecycleCounts] = await Promise.all([
      executor.query(
        `SELECT r.*,
                EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
         FROM reservations r
         ${whereSql}
         ORDER BY ${orderSql}
         LIMIT 2500`,
        params
      ),
      overdueUnpaidOnly
        ? executor.query(`SELECT * FROM extensions`)
        : Promise.resolve({ rows: [] }),
      getCachedReservationFacets(executor),
      loadLifecycleCounts()
    ]);

    const mappedItems = allMatchedRes.rows.map((r) => mapReservationRowToClient(r, false));
    const extByResId: Record<string, any[]> = {};
    for (const exRow of extRowsRes.rows || []) {
      const ex = mapExtensionRowToClient(exRow);
      if (ex.reservationId) {
        if (!extByResId[ex.reservationId]) extByResId[ex.reservationId] = [];
        extByResId[ex.reservationId].push(ex);
      }
    }

    const timeField = str(payload.timeField || 'both').toLowerCase();
    const filtered = crmCore.filterReservations(mappedItems, [], {
      lifecycle: str(payload.lifecycle || 'active').toLowerCase(),
      search: str(payload.search),
      reservationNumber: resNumberQuery,
      companyNumber: str(payload.companyNumber),
      oldCompanyName: str(payload.oldCompanyName),
      newCompanyName: str(payload.newCompanyName),
      rejectionReason: str(payload.rejectionReason),
      cancellationReason: str(payload.cancellationReason),
      confirmedByEmployee: str(payload.confirmedByEmployee || payload.actionByEmployee),
      timeField,
      timeFrom: str(payload.timeFrom),
      timeTo: str(payload.timeTo),
      hasProblemsOnly: Boolean(toBool(payload.hasProblem) || toBool(payload.hasProblemsOnly)),
      overdueUnpaidOnly,
      extensionsByResId: extByResId,
      nowMs: Date.now(),
      sortBy: rawSortBy || 'sourceOrder',
      sortDir: (!rawSortBy || rawSortBy === 'sourceOrder')
        ? ((rawSortBy === 'sourceOrder' && hasExplicitSortDir && rawSortDir === 'DESC') ? 'desc' : 'asc')
        : (rawSortDir === 'ASC' ? 'asc' : 'desc')
    }, { role: session.user.role, employeeId: session.user.id, allowAgentViewAll: true, user: session.user });

    const total = filtered.length;
    const paged = redactReservationsList(filtered.slice(offset, offset + pageSize).map((item: any) => {
      const ov = crmCore.isReservationOverdueUnpaid(item, extByResId[item.id] || item.extensions, Date.now());
      return { ...item, overdueInfo: ov.isOverdueUnpaid ? ov : null };
    }), session.user);

    return {
      items: paged,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      facets,
      lifecycleCounts
    };
  }

  const listParams = [...params, pageSize, offset];
  const [countRes, rowsRes, facets, lifecycleCounts] = await Promise.all([
    executor.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM reservations r ${whereSql}`,
      params
    ),
    executor.query(
      `SELECT r.*,
              EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
    getCachedReservationFacets(executor),
    loadLifecycleCounts()
  ]);

  const mappedMain = rowsRes.rows.map((r) => mapReservationRowToClient(r, false));
  if (isCalendarMode && mappedMain.length > 0) {
    const resIds = mappedMain.map((m) => str(m.id)).filter(Boolean);
    const resNums = mappedMain.map((m) => str(m.reservationNumber)).filter(Boolean);
    const extRes = await executor.query(
      `SELECT * FROM extensions WHERE reservation_id = ANY($1::text[]) OR reservation_number = ANY($2::text[])`,
      [resIds, resNums]
    ).catch(() => ({ rows: [] as any[] }));
    const extByResId: Record<string, any[]> = {};
    const extByResNum: Record<string, any[]> = {};
    const extBySourceId: Record<string, any[]> = {};
    for (const exRow of extRes.rows || []) {
      const ex = mapExtensionRowToClient(exRow);
      if (ex.reservationId) {
        if (!extByResId[ex.reservationId]) extByResId[ex.reservationId] = [];
        extByResId[ex.reservationId].push(ex);
      }
      if (ex.reservationNumber) {
        if (!extByResNum[ex.reservationNumber]) extByResNum[ex.reservationNumber] = [];
        extByResNum[ex.reservationNumber].push(ex);
      }
      if (ex.sourceReservationId) {
        if (!extBySourceId[ex.sourceReservationId]) extBySourceId[ex.sourceReservationId] = [];
        extBySourceId[ex.sourceReservationId].push(ex);
      }
    }
    for (const item of mappedMain) {
      const seenExt = new Set<string>();
      const collected: any[] = [];
      const pools = [
        extByResId[item.id] || [],
        extByResNum[item.reservationNumber] || [],
        item.sourceReservationId ? (extBySourceId[item.sourceReservationId] || []) : []
      ];
      for (const pool of pools) {
        for (const ex of pool) {
          const k = str(ex.id || ex.extensionNumber);
          if (k && seenExt.has(k)) continue;
          if (k) seenExt.add(k);
          collected.push(ex);
        }
      }
      if (collected.length > 0) {
        item.extensions = collected;
      }
    }
  }

  const total = Number(countRes.rows[0]?.cnt || 0);

  return {
    items: redactReservationsList(mappedMain, session.user),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets,
    lifecycleCounts
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
      `SELECT r.id, r.source_reservation_id, r.reservation_number, r.reference_number, r.source_created_at,
              r.customer_name, r.customer_phone, r.customer_email, r.customer_id_number,
              r.company_name, r.company_number, r.new_company_name, r.branch_name, r.deliver_branch_name, r.car_name, r.plate_number, r.car_category,
              r.start_date, r.start_time, r.original_end_date, r.original_end_time, r.end_date, r.end_time,
              r.extended_until_date, r.extended_until_time, r.days_count, r.extended_days_count, r.total_days_count,
              r.original_status_code, r.original_status_ar, r.pickup_type_ar, r.return_type_ar,
              r.payment_method, r.payment_status, r.daily_price, r.discount_amount, r.vat_amount,
              r.base_amount, r.extensions_count, r.extensions_amount, r.total_amount, r.paid_amount, r.has_extensions,
              r.internal_status, r.priority, r.assigned_employee_ids, r.assigned_employee_names,
              r.last_update_text, r.last_updated_by_id, r.last_updated_by_name, r.last_updated_at,
              r.has_problem, r.rejection_reason, r.car_status_at_request, r.refund_amount,
              r.rejected_by_id, r.rejected_by_name, r.rejected_at,
              r.cancellation_reason, r.cancelled_by_id, r.cancelled_by_name, r.cancelled_at,
              r.delivery_failure_reason, r.driver_notes,
              r.pinned_note, r.pinned_note_by_id, r.pinned_note_by_name, r.pinned_note_updated_at, r.no_answer_count,
              r.created_at, r.updated_at, r.source_order, r.status_history,
              EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       ${resWhere}
       ORDER BY r.source_order ASC NULLS LAST
       LIMIT $1`,
      resParams
    ),
    executor.query(`SELECT * FROM extensions ORDER BY sequence_number ASC, start_date ASC LIMIT 5000`),
    executor.query(`SELECT * FROM follow_ups ORDER BY created_at DESC LIMIT 1500`),
    executor.query(`SELECT * FROM problems ORDER BY updated_at DESC LIMIT 500`)
  ]);

  const reservations = redactReservationsList(resRows.rows.map((r) => mapReservationRowToClient(r, false)), session.user);
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

  const customerId = str(row.customer_id);
  const [extRes, asnRes, fuRes, fuhRes, prbRes, notesRes, noteStatuses] = await Promise.all([
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
    ),
    executor.query(
      `SELECT * FROM customer_notes
       WHERE deleted_at IS NULL AND (reservation_id = $1 OR reservation_number = $2)
       ORDER BY created_at DESC LIMIT 120`,
      [reservation.id, reservation.reservationNumber]
    ).catch(() => ({ rows: [] as any[] })),
    loadCustomerNoteStatusesList(executor).catch(() => [])
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

  const custNotes = await enrichCustomerNoteRows(executor, notesRes.rows || [], session.user).catch(() => []);
  const notesConfig = typeof crmCore.normalizeCustomerNotesConfig === 'function'
    ? crmCore.normalizeCustomerNotesConfig(settings.customer_notes_config)
    : {};

  reservation.isFollowed = fuRes.rows.length > 0;
  reservation.customerId = customerId;

  return {
    reservation: redactReservationForUser(reservation, session.user),
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
    problemUpdates,
    customerId,
    customerNotes: custNotes,
    noteStatuses,
    notesConfig
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
           updated_at = $8::timestamptz
       WHERE id = $1`,
      [resId, JSON.stringify(ids), JSON.stringify(names), lastUpdateText, session.user.id, session.user.name, nowIso, nowIso]
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

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
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

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
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
  if (crmCore.isManualBlockedWorkflowStatus(newStatus)) {
    throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن رفض أو إلغاء الحجوزات يدوياً؛ يتم تحديث هذه الحالات تلقائياً عبر المزامنة فقط.');
  }

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');

    const resObj = mapReservationRowToClient(resQuery.rows[0], false);
    if (crmCore.isInactiveReservation(resObj)) {
      throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن تعديل حالة حجز مرفوض أو ملغى يدوياً؛ الحالة مقيدة بالموقع الخارجي.');
    }
    assertOptimisticLock(resObj.updatedAt, payload.expectedUpdatedAt);
    const prevStatus = str(resObj.internalStatus);
    const nowDateQ = new Date();
    const nowIso = nowDateQ.toISOString();
    const riyadhQ = getRiyadhDateTimeParts(nowDateQ);
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
      followUpDate: riyadhQ.date,
      followUpTime: riyadhQ.time,
      createdAt: nowIso
    };

    await tx.query(
      `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
      [fuObj.id, fuObj.reservationId, fuObj.reservationNumber, fuObj.customerName, fuObj.employeeId, fuObj.employeeName, fuObj.status, fuObj.action, fuObj.notes, fuObj.followUpDate, fuObj.followUpTime, fuObj.createdAt]
    );

    const nextHistory = crmCore.appendStatusStageEntry(resObj.statusHistory || [], {
      source: crmCore.isRejectedStatus(newStatus) ? 'reject_action' : (crmCore.isCancelledStatus(newStatus) ? 'cancel_action' : 'quick_status'),
      previousStatus: prevStatus,
      newStatus,
      changedAt: nowIso,
      changedById: session.user.id,
      changedByName: session.user.name,
      note: lastText
    });

    const isRejTarget = crmCore.isRejectedStatus(newStatus);
    const isCanTarget = !isRejTarget && crmCore.isCancelledStatus(newStatus);
    const nextRejectedAt = isRejTarget ? (str(resObj.rejectedAt) || nowIso) : '';
    const nextRejectedById = isRejTarget ? (str(resObj.rejectedById) || session.user.id) : '';
    const nextRejectedByName = isRejTarget ? (str(resObj.rejectedByName) || session.user.name) : '';
    const nextRejectionReason = isRejTarget ? (str(payload.rejectionReason || note) || str(resObj.rejectionReason)) : str(resObj.rejectionReason);
    const nextCancelledAt = isCanTarget ? (str(resObj.cancelledAt) || nowIso) : '';
    const nextCancelledById = isCanTarget ? (str(resObj.cancelledById) || session.user.id) : '';
    const nextCancelledByName = isCanTarget ? (str(resObj.cancelledByName) || session.user.name) : '';
    const nextCancellationReason = isCanTarget ? (str(payload.cancellationReason || note) || str(resObj.cancellationReason)) : str(resObj.cancellationReason);

    await tx.query(
      `UPDATE reservations
       SET internal_status = $2,
           last_update_text = $3,
           last_updated_by_id = $4,
           last_updated_by_name = $5,
           last_updated_at = $6,
           updated_at = $7::timestamptz,
           status_history = $8::jsonb,
           rejection_reason = $9,
           rejected_by_id = $10,
           rejected_by_name = $11,
           rejected_at = $12,
           cancellation_reason = $13,
           cancelled_by_id = $14,
           cancelled_by_name = $15,
           cancelled_at = $16
       WHERE id = $1`,
      [
        resId, newStatus, lastText, session.user.id, session.user.name, nowIso, nowIso, JSON.stringify(nextHistory),
        nextRejectionReason, nextRejectedById, nextRejectedByName, nextRejectedAt,
        nextCancellationReason, nextCancelledById, nextCancelledByName, nextCancelledAt
      ]
    );

    await logActivity(
      tx,
      session.user,
      'تحديث حالة سريع',
      'Reservation',
      resObj.reservationNumber,
      `${prevStatus} → ${newStatus}${note ? ` (${note})` : ''}`,
      prevStatus !== newStatus
        ? [{ field: 'internalStatus', label: 'حالة المتابعة', before: prevStatus || '-', after: newStatus }]
        : []
    );
    await dispatchMentionNotifications(tx, {
      texts: [note],
      sender: session.user,
      entityType: 'Reservation',
      entityId: resObj.id,
      label: resObj.reservationNumber,
      sourceKey: str(payload.clientRequestId)
        ? `req:${str(payload.clientRequestId)}`
        : buildNotificationEventKey(['quick_status', resObj.id, prevStatus, newStatus, note])
    });

    const updatedRes: Record<string, any> = {
      ...resObj,
      internalStatus: newStatus,
      lastUpdateText: lastText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      statusHistory: nextHistory,
      rejectionReason: nextRejectionReason,
      rejectedById: nextRejectedById,
      rejectedByName: nextRejectedByName,
      rejectedAt: nextRejectedAt,
      cancellationReason: nextCancellationReason,
      cancelledById: nextCancelledById,
      cancelledByName: nextCancelledByName,
      cancelledAt: nextCancelledAt,
      isFollowed: true
    };
    await enqueueSheetsMirror(tx, 'FollowUp', fuObj.id, 'appendFollowUp', fuObj);
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return { reservation: redactReservationForUser(updatedRes, session.user), followUp: fuObj };
  });

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
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
    assertOptimisticLock(existing.updatedAt, payload.expectedUpdatedAt);

    const nextStatus = payload.internalStatus !== undefined ? str(payload.internalStatus) : existing.internalStatus;
    if (payload.internalStatus !== undefined && nextStatus !== existing.internalStatus) {
      if (!crmCore.isValidWorkflowStatus(nextStatus)) {
        throw new Error('VALIDATION_ERROR: الحالة المحددة غير معتمدة.');
      }
      if (crmCore.isManualBlockedWorkflowStatus(nextStatus) || crmCore.isInactiveReservation(existing)) {
        throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن رفض أو إلغاء الحجز أو تغيير حالة حجز غير نشط يدوياً.');
      }
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

    const nextDaysCount = payload.daysCount !== undefined ? Math.max(0, Math.round(num(payload.daysCount, existing.daysCount))) : existing.daysCount;
    const nextExtDaysCount = payload.extendedDaysCount !== undefined ? Math.max(0, Math.round(num(payload.extendedDaysCount, existing.extendedDaysCount))) : existing.extendedDaysCount;
    const nextTotalDaysCount = payload.totalDaysCount !== undefined
      ? Math.max(0, Math.round(num(payload.totalDaysCount, nextDaysCount + nextExtDaysCount)))
      : (nextDaysCount + nextExtDaysCount);
    const nextExtCount = payload.extensionsCount !== undefined ? Math.max(0, Math.round(num(payload.extensionsCount, existing.extensionsCount))) : existing.extensionsCount;
    const nextBaseAmount = payload.baseAmount !== undefined ? num(payload.baseAmount, existing.baseAmount) : existing.baseAmount;
    const nextExtAmount = payload.extensionsAmount !== undefined ? num(payload.extensionsAmount, existing.extensionsAmount) : existing.extensionsAmount;
    const nextTotalAmount = payload.totalAmount !== undefined
      ? num(payload.totalAmount, Number((nextBaseAmount + nextExtAmount).toFixed(2)))
      : existing.totalAmount;

    const existingLifecycle = crmCore.getReservationLifecycleKind(existing);
    const isRejTarget = existingLifecycle === 'rejected';
    const isCanTarget = existingLifecycle === 'cancelled';

    const nextObj: Record<string, any> = {
      ...existing,
      customerName: payload.customerName !== undefined ? str(payload.customerName) : existing.customerName,
      customerPhone: payload.customerPhone !== undefined ? str(payload.customerPhone) : existing.customerPhone,
      customerEmail: payload.customerEmail !== undefined ? str(payload.customerEmail) : existing.customerEmail,
      customerIdNumber: (payload.customerIdNumber !== undefined && crmCore.canUserViewCustomerId(session.user))
        ? str(payload.customerIdNumber)
        : existing.customerIdNumber,
      companyName: payload.companyName !== undefined ? str(payload.companyName) : existing.companyName,
      companyNumber: payload.companyNumber !== undefined ? str(payload.companyNumber) : existing.companyNumber,
      newCompanyName: payload.newCompanyName !== undefined ? str(payload.newCompanyName) : existing.newCompanyName,
      branchName: payload.branchName !== undefined ? str(payload.branchName) : existing.branchName,
      deliverBranchName: payload.deliverBranchName !== undefined ? str(payload.deliverBranchName) : existing.deliverBranchName,
      carName: payload.carName !== undefined ? str(payload.carName) : existing.carName,
      carCategory: payload.carCategory !== undefined ? str(payload.carCategory) : existing.carCategory,
      plateNumber: payload.plateNumber !== undefined ? str(payload.plateNumber) : existing.plateNumber,
      startDate: payload.startDate !== undefined ? str(payload.startDate) : existing.startDate,
      startTime: payload.startTime !== undefined ? str(payload.startTime) : existing.startTime,
      endDate: payload.endDate !== undefined ? str(payload.endDate) : existing.endDate,
      endTime: payload.endTime !== undefined ? str(payload.endTime) : existing.endTime,
      extendedUntilDate: payload.extendedUntilDate !== undefined ? str(payload.extendedUntilDate) : existing.extendedUntilDate,
      extendedUntilTime: payload.extendedUntilTime !== undefined ? str(payload.extendedUntilTime) : existing.extendedUntilTime,
      pickupTypeAr: payload.pickupTypeAr !== undefined ? str(payload.pickupTypeAr) : existing.pickupTypeAr,
      returnTypeAr: payload.returnTypeAr !== undefined ? str(payload.returnTypeAr) : existing.returnTypeAr,
      paymentMethod: payload.paymentMethod !== undefined ? str(payload.paymentMethod) : existing.paymentMethod,
      paymentStatus: payload.paymentStatus !== undefined ? str(payload.paymentStatus) : existing.paymentStatus,
      daysCount: nextDaysCount,
      extendedDaysCount: nextExtDaysCount,
      totalDaysCount: nextTotalDaysCount,
      extensionsCount: nextExtCount,
      baseAmount: nextBaseAmount,
      extensionsAmount: nextExtAmount,
      totalAmount: nextTotalAmount,
      hasExtensions: Boolean(nextExtCount > 0 || nextExtDaysCount > 0 || existing.hasExtensions),
      priority: payload.priority !== undefined ? str(payload.priority) : existing.priority,
      internalStatus: nextStatus,
      rejectionReason: payload.rejectionReason !== undefined ? str(payload.rejectionReason) : existing.rejectionReason,
      carStatusAtRequest: payload.carStatusAtRequest !== undefined ? str(payload.carStatusAtRequest) : existing.carStatusAtRequest,
      refundAmount: payload.refundAmount !== undefined ? num(payload.refundAmount, 0) : num(existing.refundAmount, 0),
      rejectedById: isRejTarget ? (str(existing.rejectedById) || session.user.id) : '',
      rejectedByName: isRejTarget ? (str(existing.rejectedByName) || session.user.name) : '',
      rejectedAt: isRejTarget ? (str(existing.rejectedAt) || nowIso) : '',
      cancellationReason: payload.cancellationReason !== undefined ? str(payload.cancellationReason) : existing.cancellationReason,
      cancelledById: isCanTarget ? (str(existing.cancelledById) || session.user.id) : '',
      cancelledByName: isCanTarget ? (str(existing.cancelledByName) || session.user.name) : '',
      cancelledAt: isCanTarget ? (str(existing.cancelledAt) || nowIso) : '',
      lastUpdateText: payload.lastUpdateText !== undefined ? str(payload.lastUpdateText) : `تعديل بيانات الحجز بواسطة ${session.user.name}`,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      statusHistory: nextHistory
    };

    await tx.query(
      `UPDATE reservations
       SET customer_name = $2, customer_phone = $3, customer_email = $4, customer_id_number = $5,
           company_name = $6, branch_name = $7, deliver_branch_name = $8,
           car_name = $9, car_category = $10, plate_number = $11,
           start_date = $12, start_time = $13, end_date = $14, end_time = $15,
           extended_until_date = $16, extended_until_time = $17,
           pickup_type_ar = $18, return_type_ar = $19, payment_method = $20, payment_status = $21,
           days_count = $22, extended_days_count = $23, total_days_count = $24,
           extensions_count = $25, base_amount = $26, extensions_amount = $27, total_amount = $28,
           has_extensions = $29, priority = $30, internal_status = $31,
           last_update_text = $32, last_updated_by_id = $33, last_updated_by_name = $34,
           last_updated_at = $35, updated_at = $36::timestamptz, status_history = $37::jsonb,
           company_number = $38, new_company_name = $39, rejection_reason = $40,
           car_status_at_request = $41, refund_amount = $42,
           rejected_by_id = $43, rejected_by_name = $44, rejected_at = $45,
           cancellation_reason = $46, cancelled_by_id = $47, cancelled_by_name = $48, cancelled_at = $49
       WHERE id = $1`,
      [
        resId,
        nextObj.customerName,
        nextObj.customerPhone,
        nextObj.customerEmail,
        nextObj.customerIdNumber,
        nextObj.companyName,
        nextObj.branchName,
        nextObj.deliverBranchName,
        nextObj.carName,
        nextObj.carCategory,
        nextObj.plateNumber,
        nextObj.startDate,
        nextObj.startTime,
        nextObj.endDate,
        nextObj.endTime,
        nextObj.extendedUntilDate,
        nextObj.extendedUntilTime,
        nextObj.pickupTypeAr,
        nextObj.returnTypeAr,
        nextObj.paymentMethod,
        nextObj.paymentStatus,
        nextObj.daysCount,
        nextObj.extendedDaysCount,
        nextObj.totalDaysCount,
        nextObj.extensionsCount,
        nextObj.baseAmount,
        nextObj.extensionsAmount,
        nextObj.totalAmount,
        nextObj.hasExtensions,
        nextObj.priority,
        nextObj.internalStatus,
        nextObj.lastUpdateText,
        nextObj.lastUpdatedById,
        nextObj.lastUpdatedByName,
        nextObj.lastUpdatedAt,
        nextObj.updatedAt,
        JSON.stringify(nextObj.statusHistory),
        nextObj.companyNumber || '',
        nextObj.newCompanyName || '',
        nextObj.rejectionReason || '',
        nextObj.carStatusAtRequest || '',
        num(nextObj.refundAmount, 0),
        nextObj.rejectedById || '',
        nextObj.rejectedByName || '',
        nextObj.rejectedAt || '',
        nextObj.cancellationReason || '',
        nextObj.cancelledById || '',
        nextObj.cancelledByName || '',
        nextObj.cancelledAt || ''
      ]
    );

    const diffs = crmCore.computeAuditFieldDiffs(existing, nextObj, [
      { field: 'customerName', label: 'اسم العميل' },
      { field: 'customerPhone', label: 'الجوال' },
      { field: 'carName', label: 'السيارة' },
      { field: 'plateNumber', label: 'رقم اللوحة' },
      { field: 'startDate', label: 'تاريخ الاستلام' },
      { field: 'endDate', label: 'تاريخ التسليم' },
      { field: 'extendedUntilDate', label: 'التمديد لحد' },
      { field: 'totalAmount', label: 'المبلغ الإجمالي' },
      { field: 'internalStatus', label: 'حالة المتابعة' },
      { field: 'priority', label: 'الأولوية' }
    ]);
    await upsertCustomersFromReservationsTx(tx, [nextObj], {
      source: 'manual_res_edit',
      overwriteProfileFields: Boolean(payload.customerName !== undefined || payload.customerPhone !== undefined || payload.customerEmail !== undefined || payload.customerIdNumber !== undefined)
    });

    await logActivity(tx, session.user, 'تعديل بيانات حجز', 'Reservation', existing.reservationNumber, 'تعديل تفاصيل الحجز بواسطة المشرف / الإدارة', diffs);
    await enqueueSheetsMirror(tx, 'Reservation', nextObj.id, 'upsertReservation', nextObj);
    return redactReservationForUser(nextObj, session.user);
  });

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function saveReservationPinnedNote(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'pin_reservation_note');
  if (!crmCore.isPrivilegedRole(session.user.role) && session.user.role !== 'supervisor') {
    throw new Error('FORBIDDEN: إضافة الملاحظة المثبتة متاحة للمبرمج والمشرف والمدير العام فقط.');
  }
  const resId = str(payload.reservationId);
  const note = str(payload.note);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const existing = mapReservationRowToClient(resQuery.rows[0], false);
    assertOptimisticLock(existing.updatedAt, payload.expectedUpdatedAt);

    const nowIso = new Date().toISOString();
    const byId = note ? session.user.id : '';
    const byName = note ? session.user.name : '';
    const noteUpdatedAt = note ? nowIso : '';

    await tx.query(
      `UPDATE reservations
       SET pinned_note = $2, pinned_note_by_id = $3, pinned_note_by_name = $4,
           pinned_note_updated_at = $5, updated_at = $6::timestamptz
       WHERE id = $1`,
      [resId, note, byId, byName, noteUpdatedAt, nowIso]
    );

    await logActivity(
      tx,
      session.user,
      note ? 'تثبيت ملاحظة على الحجز' : 'إزالة الملاحظة المثبتة',
      'Reservation',
      existing.reservationNumber,
      note ? note.slice(0, 140) : 'إزالة الملاحظة المثبتة',
      existing.pinnedNote !== note
        ? [{ field: 'pinnedNote', label: 'الملاحظة المثبتة', before: existing.pinnedNote || '-', after: note || '-' }]
        : []
    );

    const updatedRes: Record<string, any> = {
      ...existing,
      pinnedNote: note,
      pinnedNoteById: byId,
      pinnedNoteByName: byName,
      pinnedNoteUpdatedAt: noteUpdatedAt,
      updatedAt: nowIso
    };
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return { reservation: updatedRes };
  });

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function recordNoAnswerFollowUp(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'add_followup');
  const resId = str(payload.reservationId);
  const notes = str(payload.note || payload.notes);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
    if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const resObj = mapReservationRowToClient(resQuery.rows[0], false);

    const nextCount = Math.max(0, Math.floor(num(resObj.noAnswerCount, 0))) + 1;
    const nowDateNa = new Date();
    const nowIso = nowDateNa.toISOString();
    const riyadhNa = getRiyadhDateTimeParts(nowDateNa);
    const status = str(resObj.internalStatus) || 'تم الإنشاء';
    const action = crmCore.buildNoAnswerActionText(nextCount, 'ar');

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
      followUpDate: riyadhNa.date,
      followUpTime: riyadhNa.time,
      createdAt: nowIso
    };

    await tx.query(
      `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
      [fuObj.id, fuObj.reservationId, fuObj.reservationNumber, fuObj.customerName, fuObj.employeeId, fuObj.employeeName, fuObj.status, fuObj.action, fuObj.notes, fuObj.followUpDate, fuObj.followUpTime, fuObj.createdAt]
    );

    await tx.query(
      `INSERT INTO follow_up_history (id, follow_up_id, reservation_id, reservation_number, employee_id, employee_name, change_type, previous_status, new_status, previous_action, new_action, previous_notes, new_notes, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz)`,
      [generateId('FUH'), fuObj.id, resObj.id, resObj.reservationNumber, session.user.id, session.user.name, 'no_answer_attempt', status, status, '', action, '', notes, nowIso]
    );

    const lastText = notes ? `${action} — ${notes}` : action;
    await tx.query(
      `UPDATE reservations
       SET no_answer_count = $2,
           last_update_text = $3,
           last_updated_by_id = $4,
           last_updated_by_name = $5,
           last_updated_at = $6,
           updated_at = $7::timestamptz
       WHERE id = $1`,
      [resId, nextCount, lastText, session.user.id, session.user.name, nowIso, nowIso]
    );

    await logActivity(tx, session.user, 'تسجيل محاولة اتصال - لم يرد', 'FollowUp', resObj.reservationNumber, `${action}${notes ? ` — ${notes}` : ''}`);
    if (notes) {
      await dispatchMentionNotifications(tx, {
        texts: [notes],
        sender: session.user,
        entityType: 'Reservation',
        entityId: resObj.id,
        label: resObj.reservationNumber,
        sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `fu:${fuObj.id}`
      });
    }

    const updatedRes: Record<string, any> = {
      ...resObj,
      noAnswerCount: nextCount,
      lastUpdateText: lastText,
      lastUpdatedById: session.user.id,
      lastUpdatedByName: session.user.name,
      lastUpdatedAt: nowIso,
      updatedAt: nowIso,
      isFollowed: true
    };
    await enqueueSheetsMirror(tx, 'FollowUp', fuObj.id, 'appendFollowUp', fuObj);
    await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
    return { reservation: updatedRes, followUp: fuObj, noAnswerCount: nextCount };
  });

  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function togglePinnedCriticalReservation(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const resId = str(payload.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب.');
  const maxPins = crmCore.MAX_PINNED_CRITICAL_RESERVATIONS || 3;
  const settingKey = `pinned_res_u_${session.user.id}`;

  const out = await executor.withTransaction(async (tx) => {
    const resCheck = await tx.query(`SELECT id, reservation_number FROM reservations WHERE id = $1 LIMIT 1`, [resId]);
    if (!resCheck.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
    const resNumber = str(resCheck.rows[0].reservation_number || resId);

    const curRow = await tx.query<{ value: string }>(`SELECT value FROM settings WHERE key = $1 FOR UPDATE`, [settingKey]);
    const parsed = curRow.rows[0] ? parseJsonValue<any[]>(curRow.rows[0].value, []) : [];
    const currentIds = Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((x) => str(x)).filter(Boolean)))
      : [];

    const currentlyPinned = currentIds.includes(resId);
    const shouldPin = typeof payload.pin === 'boolean' ? payload.pin : (typeof payload.pinned === 'boolean' ? payload.pinned : !currentlyPinned);

    let nextIds: string[];
    if (shouldPin) {
      if (currentlyPinned) {
        nextIds = currentIds;
      } else if (currentIds.length >= maxPins) {
        throw new Error(`VALIDATION_ERROR: الحد الأقصى لتثبيت الحجوزات الحرجة هو ${maxPins} حجوزات فقط — قم بإلغاء تثبيت حجز أولاً.`);
      } else {
        nextIds = [resId, ...currentIds];
      }
    } else {
      nextIds = currentIds.filter((id) => id !== resId);
    }

    const encoded = JSON.stringify(nextIds);
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [settingKey, encoded, session.user.name]
    );
    await enqueueSheetsMirror(tx, 'Settings', settingKey, 'upsertSetting', {
      key: settingKey,
      value: encoded,
      updatedBy: session.user.name
    });
    await logActivity(
      tx,
      session.user,
      shouldPin ? 'تثبيت حجز حرج' : 'إلغاء تثبيت حجز حرج',
      'Reservation',
      resNumber,
      shouldPin ? `تثبيت الحجز (${nextIds.length}/${maxPins})` : 'إلغاء التثبيت من متابعاتي'
    );

    return { pinnedCriticalIds: nextIds, isPinned: shouldPin };
  });

  invalidateScopes(executor, ['settings']);
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
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
  if (crmCore.isManualBlockedWorkflowStatus(status)) {
    throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن تعيين حالة مرفوض أو ملغى يدوياً من المتابعات؛ يتم سحبها من الموقع الخارجي فقط.');
  }

  return runWithIdempotency(executor, session.user.id, 'addFollowUp', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const resQuery = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [resId]);
      if (!resQuery.rows[0]) throw new Error('NOT_FOUND: الحجز غير موجود.');
      const resObj = mapReservationRowToClient(resQuery.rows[0], false);
      const effectiveNextInternalStatus = crmCore.isInactiveReservation(resObj) ? resObj.internalStatus : status;

      const nowDateFu = new Date();
      const nowIso = nowDateFu.toISOString();
      const riyadhFu = getRiyadhDateTimeParts(nowDateFu);
      const fuObj = {
        id: generateId('FU'),
        reservationId: resObj.id,
        reservationNumber: resObj.reservationNumber,
        customerName: resObj.customerName,
        employeeId: session.user.id,
        employeeName: session.user.name,
        status: effectiveNextInternalStatus,
        action,
        notes,
        followUpDate: riyadhFu.date,
        followUpTime: riyadhFu.time,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await tx.query(
        `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$12::timestamptz)`,
        [fuObj.id, fuObj.reservationId, fuObj.reservationNumber, fuObj.customerName, fuObj.employeeId, fuObj.employeeName, fuObj.status, fuObj.action, fuObj.notes, fuObj.followUpDate, fuObj.followUpTime, fuObj.createdAt]
      );

      const lastText = action + (notes ? ` — ${notes}` : '');
      const nextRejectedAt = str(resObj.rejectedAt);
      const nextRejectedById = str(resObj.rejectedById);
      const nextRejectedByName = str(resObj.rejectedByName);
      const nextRejectionReason = str(resObj.rejectionReason);
      const nextCancelledAt = str(resObj.cancelledAt);
      const nextCancelledById = str(resObj.cancelledById);
      const nextCancelledByName = str(resObj.cancelledByName);
      const nextCancellationReason = str(resObj.cancellationReason);

      const nextHistory = effectiveNextInternalStatus !== resObj.internalStatus
        ? crmCore.appendStatusStageEntry(resObj.statusHistory || [], {
            source: 'followup',
            previousStatus: resObj.internalStatus,
            newStatus: effectiveNextInternalStatus,
            changedAt: nowIso,
            changedById: session.user.id,
            changedByName: session.user.name,
            note: lastText
          })
        : (resObj.statusHistory || []);

      await tx.query(
        `UPDATE reservations
         SET internal_status = $2, last_update_text = $3, last_updated_by_id = $4,
             last_updated_by_name = $5, last_updated_at = $6, updated_at = $7::timestamptz,
             status_history = $8::jsonb
         WHERE id = $1`,
        [resId, effectiveNextInternalStatus, lastText, session.user.id, session.user.name, nowIso, nowIso, JSON.stringify(nextHistory)]
      );

      await logActivity(tx, session.user, 'إضافة متابعة', 'FollowUp', resObj.reservationNumber, `الحالة: ${status} — ${action}`);
      await dispatchMentionNotifications(tx, {
        texts: [action, notes],
        sender: session.user,
        entityType: 'Reservation',
        entityId: resObj.id,
        label: resObj.reservationNumber,
        sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `fu:${fuObj.id}`
      });

      const updatedRes: Record<string, any> = {
        ...resObj,
        internalStatus: effectiveNextInternalStatus,
        lastUpdateText: lastText,
        lastUpdatedById: session.user.id,
        lastUpdatedByName: session.user.name,
        lastUpdatedAt: nowIso,
        updatedAt: nowIso,
        statusHistory: nextHistory,
        rejectionReason: nextRejectionReason,
        rejectedById: nextRejectedById,
        rejectedByName: nextRejectedByName,
        rejectedAt: nextRejectedAt,
        cancellationReason: nextCancellationReason,
        cancelledById: nextCancelledById,
        cancelledByName: nextCancelledByName,
        cancelledAt: nextCancelledAt,
        isFollowed: true
      };
      await enqueueSheetsMirror(tx, 'FollowUp', fuObj.id, 'appendFollowUp', fuObj);
      await enqueueSheetsMirror(tx, 'Reservation', updatedRes.id, 'upsertReservation', updatedRes);
      return { followUp: fuObj, reservation: redactReservationForUser(updatedRes, session.user) };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
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
    if (payload.status !== undefined) {
      if (!crmCore.isValidWorkflowStatus(newStatus)) {
        throw new Error('VALIDATION_ERROR: الحالة المحددة غير معتمدة.');
      }
      if (newStatus !== existing.status && crmCore.isManualBlockedWorkflowStatus(newStatus)) {
        throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن تعيين حالة مرفوض أو ملغى يدوياً من المتابعات.');
      }
    }
    const newAction = payload.action !== undefined ? str(payload.action) : existing.action;
    const newNotes = payload.notes !== undefined ? str(payload.notes) : existing.notes;
    const nowIso = new Date().toISOString();

    await tx.query(
      `UPDATE follow_ups SET status = $2, action = $3, notes = $4, updated_at = $5::timestamptz WHERE id = $1`,
      [followUpId, newStatus, newAction, newNotes, nowIso]
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
      const effectiveResStatus = crmCore.isInactiveReservation(rObj) ? rObj.internalStatus : newStatus;
      const lastText = newAction + (newNotes ? ` — ${newNotes}` : '');
      const nextHistory = effectiveResStatus !== rObj.internalStatus
        ? crmCore.appendStatusStageEntry(rObj.statusHistory || [], {
            source: 'followup_edit',
            previousStatus: rObj.internalStatus,
            newStatus: effectiveResStatus,
            changedAt: nowIso,
            changedById: session.user.id,
            changedByName: session.user.name,
            note: lastText
          })
        : rObj.statusHistory;

      await tx.query(
        `UPDATE reservations
         SET internal_status = $2, last_update_text = $3, last_updated_by_id = $4,
             last_updated_by_name = $5, last_updated_at = $6, updated_at = $7::timestamptz,
             status_history = $8::jsonb
         WHERE id = $1`,
        [rObj.id, effectiveResStatus, lastText, session.user.id, session.user.name, nowIso, nowIso, JSON.stringify(nextHistory)]
      );
    }

    await logActivity(tx, session.user, 'تعديل متابعة', 'FollowUp', existing.reservationNumber, `${existing.status} → ${newStatus}`);
    await dispatchMentionNotifications(tx, {
      texts: [newAction, newNotes],
      sender: session.user,
      entityType: 'Reservation',
      entityId: existing.reservationId,
      label: existing.reservationNumber,
      sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `fuh:${hist.id}`
    });
    return { followUp: { ...existing, status: newStatus, action: newAction, notes: newNotes, updatedAt: nowIso }, history: hist };
  });

  return out;
}

export async function deleteFollowUp(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const followUpId = str(payload.followUpId || payload.id);
  if (!followUpId) throw new Error('VALIDATION_ERROR: معرف المتابعة مطلوب.');

  return runWithIdempotency(executor, session.user.id, 'deleteFollowUp', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const fuRes = await tx.query(`SELECT * FROM follow_ups WHERE id = $1 FOR UPDATE`, [followUpId]);
      if (!fuRes.rows[0]) throw new Error('NOT_FOUND: المتابعة غير موجودة.');
      const existing = formatFollowUpRow(fuRes.rows[0]);

      const canEditAny = crmCore.canUserPerform(session.user, 'edit_any_followup');
      if (existing.employeeId !== session.user.id && !canEditAny) {
        throw new Error('FORBIDDEN: لا يمكنك حذف متابعة موظف آخر.');
      }

      await runTxOptional(
        tx,
        'del_fuh_by_fu',
        () => tx.query(`DELETE FROM follow_up_history WHERE follow_up_id = $1`, [followUpId]),
        undefined
      );
      await tx.query(`DELETE FROM follow_ups WHERE id = $1`, [followUpId]);

      const nowIso = new Date().toISOString();
      let remainingCount = 0;
      let latestFollowUp: any = null;
      if (existing.reservationId) {
        const cntRes = await tx.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM follow_ups WHERE reservation_id = $1`,
          [existing.reservationId]
        );
        remainingCount = Number(cntRes.rows[0]?.cnt || 0);
        const latestRes = await tx.query(
          `SELECT * FROM follow_ups WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [existing.reservationId]
        );
        latestFollowUp = latestRes.rows[0] ? formatFollowUpRow(latestRes.rows[0]) : null;

        const parentRes = await tx.query(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [existing.reservationId]);
        if (parentRes.rows[0]) {
          const rObj = mapReservationRowToClient(parentRes.rows[0], remainingCount > 0);
          const nextLastText = latestFollowUp
            ? (latestFollowUp.action + (latestFollowUp.notes ? ` — ${latestFollowUp.notes}` : ''))
            : '';
          const nextStatus = crmCore.isInactiveReservation(rObj)
            ? rObj.internalStatus
            : (latestFollowUp && latestFollowUp.status ? latestFollowUp.status : 'بانتظار المتابعة');
          const nextUpdatedById = latestFollowUp ? latestFollowUp.employeeId : '';
          const nextUpdatedByName = latestFollowUp ? latestFollowUp.employeeName : '';
          const nextUpdatedAt = latestFollowUp ? latestFollowUp.createdAt : '';
          await tx.query(
            `UPDATE reservations
             SET internal_status = $2, last_update_text = $3, last_updated_by_id = $4,
                 last_updated_by_name = $5, last_updated_at = $6, updated_at = $7::timestamptz
             WHERE id = $1`,
            [rObj.id, nextStatus, nextLastText, nextUpdatedById, nextUpdatedByName, nextUpdatedAt, nowIso]
          );
        }
      }

      await recordSyncTombstone(tx, 'follow_up', [followUpId], {
        reservationId: existing.reservationId,
        reservationNumber: existing.reservationNumber
      });

      await logActivity(
        tx,
        session.user,
        'حذف متابعة',
        'FollowUp',
        existing.reservationNumber || followUpId,
        `${existing.employeeName || '-'} | ${existing.status || '-'} | ${String(existing.action || '').slice(0, 80)}`
      );

      await enqueueSheetsMirror(tx, 'FollowUp', followUpId, 'deleteFollowUp', {
        id: followUpId,
        reservationId: existing.reservationId,
        reservationNumber: existing.reservationNumber
      });

      return {
        id: followUpId,
        deleted: true,
        reservationId: existing.reservationId,
        reservationNumber: existing.reservationNumber,
        remainingFollowUpsCount: remainingCount,
        latestFollowUp,
        isFollowed: remainingCount > 0
      };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
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

  return runWithIdempotency(executor, session.user.id, 'assignEmployees', str(payload.clientRequestId), async () => {
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
          const asnId = generateId('ASN');
          await tx.query(
            `INSERT INTO assignments (id, reservation_id, reservation_number, employee_id, employee_name, assigned_by_id, assigned_by_name, role_type, status, assigned_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9::timestamptz,$9::timestamptz)`,
            [asnId, resId, resObj.reservationNumber, eid, empMap.get(eid)!, session.user.id, session.user.name, roleType, nowIso]
          );
          await createNotification(tx, {
            recipientEmployeeId: eid,
            type: 'new_assignment',
            title: 'إسناد حجز جديد',
            message: `تم إسناد الحجز رقم ${resObj.reservationNumber} (${resObj.customerName}) إليك.`,
            entityType: 'Reservation',
            entityId: resObj.id,
            eventKey: str(payload.clientRequestId)
              ? buildNotificationEventKey(['asn_req', str(payload.clientRequestId), eid])
              : buildNotificationEventKey(['asn', asnId, eid])
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
             last_updated_at = $7, updated_at = $8::timestamptz
         WHERE id = $1`,
        [resId, JSON.stringify(mergedIds), JSON.stringify(mergedNames), lastText, session.user.id, session.user.name, nowIso, nowIso]
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

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
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
  const [resRows, fuRows, allFuRows, empRows, settingsMap] = await Promise.all([
    executor.query(
      `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       WHERE r.assigned_employee_ids @> $1::jsonb
       ORDER BY r.source_order ASC NULLS LAST, r.updated_at DESC
       LIMIT 500`,
      [JSON.stringify([session.user.id])]
    ),
    executor.query(
      `SELECT * FROM follow_ups WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 300`,
      [session.user.id]
    ),
    executor.query(
      `SELECT * FROM follow_ups WHERE action LIKE '%@%' OR notes LIKE '%@%' ORDER BY created_at DESC LIMIT 600`
    ),
    executor.query(`SELECT id, name, username, role, status FROM employees`),
    getSettingsMap(executor)
  ]);

  const employeesList = empRows.rows.map((e) => ({
    id: str(e.id),
    name: str(e.name),
    username: str(e.username),
    role: str(e.role),
    status: str(e.status || 'active')
  }));
  const allFollowUpsWithMentions = allFuRows.rows.map(formatFollowUpRow);
  const mentionFollowUps = crmCore.filterMentionFollowUps(allFollowUpsWithMentions, session.user, employeesList);

  const rawPinned = parseJsonValue<any[]>(settingsMap[`pinned_res_u_${session.user.id}`], []);
  const pinnedCriticalIds = Array.isArray(rawPinned)
    ? Array.from(new Set(rawPinned.map((x) => str(x)).filter(Boolean))).slice(0, crmCore.MAX_PINNED_CRITICAL_RESERVATIONS || 3)
    : [];

  return {
    assignedReservations: redactReservationsList(resRows.rows.map((r) => mapReservationRowToClient(r, false)), session.user),
    followUps: fuRows.rows.map(formatFollowUpRow),
    mentionFollowUps,
    pinnedCriticalIds
  };
}

export async function getTeamFollowUps(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_team_followups');
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
  if (payload.date) {
    params.push(str(payload.date));
    clauses.push(`follow_up_date = $${params.length}`);
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
    const searchCondFu = buildPgSearchCondition([
      'reservation_number',
      'customer_name',
      'action',
      'notes',
      'employee_name'
    ], payload.search, params);
    if (searchCondFu) clauses.push(searchCondFu);
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
  const explicitCustomerId = str(payload.customerId);
  const rawTicketType = str(payload.ticketType);
  const ticketType = rawTicketType === 'شكوى' ? 'شكوى' : 'مشكلة';
  const description = str(payload.description);
  const priority = crmCore.PROBLEM_PRIORITIES.includes(str(payload.priority)) ? str(payload.priority) : 'متوسط';
  if (!description) throw new Error('VALIDATION_ERROR: وصف المشكلة أو الشكوى مطلوب.');

  return runWithIdempotency(executor, session.user.id, 'createProblem', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      let resObj: any = null;
      if (resId || resNumberInput) {
        const rRes = await tx.query(
          `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $2 LIMIT 1 FOR UPDATE`,
          [resId, resNumberInput]
        );
        if (rRes.rows[0]) resObj = mapReservationRowToClient(rRes.rows[0], false);
      }

      let resolvedCustId = explicitCustomerId || (resObj ? str(resObj.customerId) : '');
      let resolvedCustName = resObj ? resObj.customerName : str(payload.customerName);
      if (resolvedCustId && (!resolvedCustName || !explicitCustomerId)) {
        const custQ = await runTxOptional(
          tx,
          'lookup_cust_prb',
          () => tx.query<{ id: string; full_name: string }>(`SELECT id, full_name FROM customers WHERE id = $1 LIMIT 1`, [resolvedCustId]),
          { rows: [] as Array<{ id: string; full_name: string }>, rowCount: 0 }
        );
        if (custQ?.rows?.[0]) {
          resolvedCustId = str(custQ.rows[0].id);
          if (!resolvedCustName) resolvedCustName = str(custQ.rows[0].full_name);
        }
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
        customerId: resolvedCustId,
        ticketType,
        customerName: resolvedCustName,
        createdById: session.user.id,
        createdByName: session.user.name,
        assignedEmployeeIds: empIds,
        assignedEmployeeNames: empNames,
        description,
        priority,
        status: ticketType === 'شكوى' ? 'قيد المعالجة' : 'جديدة',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      const insertSql = `
        INSERT INTO %TABLE% (id, problem_number, reservation_id, reservation_number, customer_name, created_by_id, created_by_name, assigned_employee_ids, assigned_employee_names, description, priority, status, created_at, updated_at, customer_id, ticket_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::timestamptz,$13::timestamptz,$14,$15)
      `;
      const params = [
        prb.id, prb.problemNumber, prb.reservationId || null, prb.reservationNumber, prb.customerName,
        prb.createdById, prb.createdByName, JSON.stringify(prb.assignedEmployeeIds), JSON.stringify(prb.assignedEmployeeNames),
        prb.description, prb.priority, prb.status, nowIso, prb.customerId, prb.ticketType
      ];
      await tx.query(insertSql.replace('%TABLE%', 'problems'), params);
      await tx.query(insertSql.replace('%TABLE%', 'issues'), params);

      await tx.query(
        `INSERT INTO problem_updates (id, problem_id, reservation_number, employee_id, employee_name, previous_status, new_status, previous_priority, new_priority, note, created_at)
         VALUES ($1,$2,$3,$4,$5,'',$6,'',$7,$8,$9::timestamptz)`,
        [generateId('PRBU'), prb.id, prb.reservationNumber, session.user.id, session.user.name, prb.status, prb.priority, ticketType === 'شكوى' ? 'تسجيل شكوى عميل جديدة' : 'فتح تذكرة مشكلة جديدة', nowIso]
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

      if (resolvedCustId) {
        await runTxOptional(
          tx,
          'touch_cust_prb',
          () => tx.query(
            `UPDATE customers
             SET status = CASE WHEN status_override = FALSE AND status <> 'محظور' THEN 'لديه مشكلة' ELSE status END,
                 updated_at = $2::timestamptz
             WHERE id = $1`,
            [resolvedCustId, nowIso]
          ),
          undefined
        );
      }

      if (prb.priority === 'مرتفع' || ticketType === 'شكوى') {
        await createNotification(tx, {
          recipientRole: 'supervisor',
          type: 'high_priority_problem',
          title: ticketType === 'شكوى' ? `شكوى عميل جديدة (${prb.problemNumber})` : `مشكلة عالية الأولوية (${prb.problemNumber})`,
          message: `${prb.customerName || prb.reservationNumber}: ${prb.description.slice(0, 80)}`,
          entityType: 'Problem',
          entityId: prb.id,
          eventKey: buildNotificationEventKey(['high_priority_problem', str(payload.clientRequestId) || prb.id])
        });
      }

      await dispatchMentionNotifications(tx, {
        texts: [description],
        sender: session.user,
        entityType: 'Problem',
        entityId: prb.id,
        label: prb.problemNumber,
        sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `prb:${prb.id}`
      });

      await logActivity(tx, session.user, ticketType === 'شكوى' ? 'تسجيل شكوى عميل' : 'فتح مشكلة', 'Problem', prb.problemNumber, prb.description.slice(0, 120));
      await enqueueSheetsMirror(tx, 'Problem', prb.id, 'upsertProblem', prb);
      return { ...prb, updates: [] };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

export async function updateProblem(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'update_problem');
  const problemId = str(payload.problemId);
  if (!problemId) throw new Error('VALIDATION_ERROR: معرف المشكلة مطلوب.');

  return runWithIdempotency(executor, session.user.id, 'updateProblem', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const pRes = await tx.query(`SELECT * FROM problems WHERE id = $1 FOR UPDATE`, [problemId]);
      if (!pRes.rows[0]) throw new Error('NOT_FOUND: المشكلة غير موجودة.');
      const existing = formatProblemRow(pRes.rows[0]);
      assertOptimisticLock(existing.updatedAt, payload.expectedUpdatedAt);

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
      await runTxOptional(
        tx,
        'upd_issues_tbl',
        () => tx.query(updSql.replace('%TABLE%', 'issues'), updParams),
        undefined
      );

      const note = str(payload.note) || (nextStatus === 'مغلقة' ? 'تم إغلاق المشكلة' : `تحديث الحالة إلى ${nextStatus}`);
      const prbuId = generateId('PRBU');
      await tx.query(
        `INSERT INTO problem_updates (id, problem_id, reservation_number, employee_id, employee_name, previous_status, new_status, previous_priority, new_priority, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
        [prbuId, problemId, existing.reservationNumber, session.user.id, session.user.name, existing.status, nextStatus, existing.priority, nextPrio, note, nowIso]
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

      if (nextStatus === 'تم الحل' && existing.status !== 'تم الحل') {
        const recipientIds = new Set<string>();
        if (existing.reservationId) {
          const resAssignQ = await tx.query<{ assigned_employee_ids: any }>(
            `SELECT assigned_employee_ids FROM reservations WHERE id = $1 LIMIT 1`,
            [existing.reservationId]
          );
          if (resAssignQ.rows[0]) {
            for (const eid of parseJsonArray<string>(resAssignQ.rows[0].assigned_employee_ids)) {
              const cleanId = str(eid);
              if (cleanId) recipientIds.add(cleanId);
            }
          }
        }
        for (const peid of nextEmpIds) {
          const cleanPid = str(peid);
          if (cleanPid) recipientIds.add(cleanPid);
        }
        if (existing.createdById) recipientIds.add(str(existing.createdById));
        recipientIds.delete(session.user.id);

        for (const targetEmpId of recipientIds) {
          await createNotification(tx, {
            recipientEmployeeId: targetEmpId,
            type: 'problem_resolved',
            title: 'تم حل مشكلة على حجز مسند إليك',
            message: `تم تغيير حالة المشكلة ${existing.problemNumber} (الحجز ${existing.reservationNumber || '-'}) إلى "تم الحل" بواسطة ${session.user.name}.`,
            entityType: 'Problem',
            entityId: problemId,
            eventKey: str(payload.clientRequestId)
              ? buildNotificationEventKey(['problem_resolved_req', str(payload.clientRequestId), problemId, targetEmpId])
              : buildNotificationEventKey(['problem_resolved', problemId, existing.status, nextStatus, existing.updatedAt, targetEmpId])
          });
        }
      }

      const updatesRes = await tx.query(
        `SELECT * FROM problem_updates WHERE problem_id = $1 ORDER BY created_at DESC`,
        [problemId]
      );
      await dispatchMentionNotifications(tx, {
        texts: [note, nextDesc !== existing.description ? nextDesc : ''],
        sender: session.user,
        entityType: 'Problem',
        entityId: problemId,
        label: existing.problemNumber,
        sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `prbu:${prbuId}`
      });
      const prbDiffs = crmCore.computeAuditFieldDiffs(
        { status: existing.status, priority: existing.priority, description: existing.description, customerName: existing.customerName },
        { status: nextStatus, priority: nextPrio, description: nextDesc, customerName: nextCust },
        [
          { field: 'status', label: 'حالة المشكلة' },
          { field: 'priority', label: 'الأولوية' },
          { field: 'customerName', label: 'اسم العميل' },
          { field: 'description', label: 'الوصف' }
        ]
      );
      await logActivity(tx, session.user, 'تحديث مشكلة', 'Problem', existing.problemNumber, `${existing.status} → ${nextStatus}`, prbDiffs);

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

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

export async function deleteProblem(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'update_problem');
  if (crmCore && typeof crmCore.canUserUseActionButton === 'function' && !crmCore.canUserUseActionButton(session.user, 'act_close_delete_ticket')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية حذف التذاكر والمشكلات.');
  }
  const problemId = str(payload.problemId || payload.id);
  if (!problemId) throw new Error('VALIDATION_ERROR: معرف المشكلة مطلوب.');

  return runWithIdempotency(executor, session.user.id, 'deleteProblem', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const pRes = await tx.query(`SELECT * FROM problems WHERE id = $1 FOR UPDATE`, [problemId]);
      if (!pRes.rows[0]) throw new Error('NOT_FOUND: المشكلة غير موجودة.');
      const existing = formatProblemRow(pRes.rows[0]);
      assertOptimisticLock(existing.updatedAt, payload.expectedUpdatedAt);

      await runTxOptional(
        tx,
        'del_problem_updates',
        () => tx.query(`DELETE FROM problem_updates WHERE problem_id = $1`, [problemId]),
        undefined
      );
      const softNtfRes = await runTxOptional(
        tx,
        'soft_del_problem_notifs',
        () =>
          tx.query<{ id: string }>(
            `UPDATE notifications
             SET deleted_at = COALESCE(deleted_at, NOW()),
                 deleted_by_id = $3,
                 updated_at = NOW()
             WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
             RETURNING id`,
            ['Problem', problemId, session.user.id]
          ),
        { rows: [] as Array<{ id: string }>, rowCount: 0 }
      );
      const softNtfIds = (softNtfRes?.rows || []).map((r) => str(r?.id)).filter(Boolean);
      if (softNtfIds.length > 0) {
        await recordSyncTombstone(tx, 'notification', softNtfIds, { entityType: 'Problem', entityId: problemId });
      }
      await tx.query(`DELETE FROM problems WHERE id = $1`, [problemId]);
      await runTxOptional(
        tx,
        'del_issues_row',
        () => tx.query(`DELETE FROM issues WHERE id = $1`, [problemId]),
        undefined
      );

      let hasOpen = false;
      const nowIso = new Date().toISOString();
      if (existing.reservationId) {
        const openCheck = await tx.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM problems WHERE reservation_id = $1 AND status NOT IN ('مغلقة', 'تم الحل')`,
          [existing.reservationId]
        );
        hasOpen = Number(openCheck.rows[0]?.cnt || 0) > 0;
        await tx.query(
          `UPDATE reservations SET has_problem = $2, updated_at = $3::timestamptz WHERE id = $1`,
          [existing.reservationId, hasOpen, nowIso]
        );
      }

      await recordSyncTombstone(tx, 'problem', [problemId], {
        reservationId: existing.reservationId,
        problemNumber: existing.problemNumber
      });

      await logActivity(
        tx,
        session.user,
        'حذف مشكلة',
        'Problem',
        existing.problemNumber || problemId,
        `حجز ${existing.reservationNumber || '-'} | ${existing.customerName || '-'} | ${String(existing.description || '').slice(0, 80)}`
      );

      await enqueueSheetsMirror(tx, 'Problem', problemId, 'deleteProblem', {
        id: problemId,
        problemNumber: existing.problemNumber,
        reservationId: existing.reservationId
      });

      return {
        id: problemId,
        deleted: true,
        problemNumber: existing.problemNumber,
        reservationId: existing.reservationId,
        hasOpenProblemsOnReservation: hasOpen
      };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

export async function getProblems(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_problems');
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
  if (payload.ticketType) {
    params.push(str(payload.ticketType));
    clauses.push(`COALESCE(ticket_type, 'مشكلة') = $${params.length}`);
  }
  if (payload.customerId) {
    params.push(str(payload.customerId));
    clauses.push(`customer_id = $${params.length}`);
  }
  if (payload.search) {
    const searchCondPrb = buildPgSearchCondition([
      'problem_number',
      'reservation_number',
      'customer_name',
      'description'
    ], payload.search, params);
    if (searchCondPrb) clauses.push(searchCondPrb);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const prbRes = await executor.query(`SELECT * FROM problems ${where} ORDER BY updated_at DESC LIMIT 400`, params);
  const updMap = new Map<string, any[]>();
  if (prbRes.rows.length > 0) {
    const pIds = prbRes.rows.map((p) => str(p.id)).filter(Boolean);
    const updRes = await executor.query(
      `SELECT * FROM problem_updates WHERE problem_id = ANY($1::text[]) ORDER BY created_at DESC`,
      [pIds]
    );
    for (const u of updRes.rows) {
      const pid = str(u.problem_id);
      const list = updMap.get(pid) || [];
      list.push(formatProblemUpdateRow(u));
      updMap.set(pid, list);
    }
  }
  const items = prbRes.rows.map((p) => formatProblemRow(p, updMap));
  return { items, total: items.length };
}

export async function getProblemDetails(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_problems');
  const target = str(payload.problemId || payload.problemNumber);
  if (!target) throw new Error('VALIDATION_ERROR: معرف المشكلة مطلوب.');
  const pRes = await executor.query(`SELECT * FROM problems WHERE id = $1 OR problem_number = $1 LIMIT 1`, [target]);
  if (!pRes.rows[0]) throw new Error('NOT_FOUND: المشكلة غير موجودة.');
  const pRow = pRes.rows[0];
  const prbId = str(pRow.id);
  const resId = str(pRow.reservation_id);
  const custId = str(pRow.customer_id);
  const [updRes, notesRes, noteStatuses, settings] = await Promise.all([
    executor.query(`SELECT * FROM problem_updates WHERE problem_id = $1 ORDER BY created_at DESC`, [prbId]),
    executor.query(
      `SELECT * FROM customer_notes
       WHERE deleted_at IS NULL AND (problem_id = $1 OR ($2 <> '' AND reservation_id = $2))
       ORDER BY created_at DESC LIMIT 80`,
      [prbId, resId]
    ).catch(() => ({ rows: [] as any[] })),
    loadCustomerNoteStatusesList(executor).catch(() => []),
    getSettingsMap(executor).catch(() => ({} as Record<string, any>))
  ]);
  const updMap = new Map<string, any[]>([[prbId, updRes.rows.map(formatProblemUpdateRow)]]);
  const customerNotes = await enrichCustomerNoteRows(executor, notesRes.rows || [], session.user).catch(() => []);
  const notesConfig = typeof crmCore.normalizeCustomerNotesConfig === 'function'
    ? crmCore.normalizeCustomerNotesConfig(settings.customer_notes_config)
    : {};
  return {
    problem: formatProblemRow(pRow, updMap),
    customerId: custId,
    customerNotes,
    noteStatuses,
    notesConfig
  };
}

// ---------- EMPLOYEES, ROLES & PERMISSIONS ----------

export async function getEmployees(executor: DbExecutor, session: AuthSession) {
  const canView = crmCore.canUserPerform(session.user, 'view_employees');
  return getCachedOrLoad(
    executor,
    { scope: 'employees', key: canView ? 'full' : 'dir', ttlMs: 30000 },
    async () => {
      if (!canView) {
        const dirRes = await executor.query(
          `SELECT id, name, username, role, job_title, status
           FROM employees
           WHERE status = 'active'
           ORDER BY name ASC`
        );
        const dirItems = dirRes.rows.map((r: any) => ({
          id: str(r.id),
          name: str(r.name),
          username: str(r.username),
          role: str(r.role || 'agent'),
          jobTitle: str(r.job_title),
          status: str(r.status || 'active')
        }));
        return {
          items: dirItems,
          total: dirItems.length,
          directoryOnly: true
        };
      }
      const [empRes, resCountsRes, fuCountsRes, prbCountsRes, presets, customPerms] = await Promise.all([
        executor.query(`SELECT * FROM employees ORDER BY created_at ASC`),
        executor.query<{ emp_id: string; cnt: number }>(
          `SELECT emp_id, COUNT(*)::int AS cnt
           FROM reservations r, LATERAL jsonb_array_elements_text(r.assigned_employee_ids) AS emp_id
           GROUP BY emp_id`
        ),
        executor.query<{ employee_id: string; cnt: number }>(
          `SELECT employee_id, COUNT(*)::int AS cnt FROM follow_ups GROUP BY employee_id`
        ),
        executor.query<{ emp_id: string; cnt: number }>(
          `SELECT emp_id, COUNT(*)::int AS cnt
           FROM problems p, LATERAL jsonb_array_elements_text(p.assigned_employee_ids) AS emp_id
           WHERE p.status NOT IN ('مغلقة', 'تم الحل')
           GROUP BY emp_id`
        ),
        getRolePresetsFromDb(executor),
        getPermissionDefsFromDb(executor)
      ]);

      const resCountMap = new Map(resCountsRes.rows.map((r) => [str(r.emp_id), num(r.cnt)]));
      const fuCountMap = new Map(fuCountsRes.rows.map((r) => [str(r.employee_id), num(r.cnt)]));
      const prbCountMap = new Map(prbCountsRes.rows.map((r) => [str(r.emp_id), num(r.cnt)]));

      const items = empRes.rows.map((row) => {
        const emp = mapEmployeeRow(row);
        const assignedCount = resCountMap.get(emp.id) || 0;
        const followUpsCount = fuCountMap.get(emp.id) || 0;
        const openProblemsCount = prbCountMap.get(emp.id) || 0;
        return {
          ...emp,
          reservationsCount: assignedCount,
          followUpsCount,
          problemsCount: openProblemsCount,
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
  );
}

export async function getEmployeeDetails(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'view_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');

  const empRes = await executor.query(`SELECT * FROM employees WHERE id = $1 LIMIT 1`, [empId]);
  if (!empRes.rows[0]) throw new Error('NOT_FOUND: الموظف غير موجود.');
  const employee = mapEmployeeRow(empRes.rows[0]);

  const empIdJson = JSON.stringify([empId]);
  const [resRows, fuRows, prbRows] = await Promise.all([
    executor.query(
      `SELECT r.*
       FROM reservations r
       WHERE r.assigned_employee_ids @> $1::jsonb
          OR EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id AND fu.employee_id = $2)
       ORDER BY r.source_order ASC NULLS LAST, r.updated_at DESC
       LIMIT 250`,
      [empIdJson, empId]
    ),
    executor.query(`SELECT * FROM follow_ups WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 250`, [empId]),
    executor.query(
      `SELECT * FROM problems WHERE assigned_employee_ids @> $1::jsonb OR created_by_id = $2 ORDER BY updated_at DESC LIMIT 250`,
      [empIdJson, empId]
    )
  ]);

  const resIds = resRows.rows.map((r) => str(r.id)).filter(Boolean);
  const [resFuRes, resPrbRes] = resIds.length > 0
    ? await Promise.all([
        executor.query(
          `SELECT * FROM follow_ups WHERE reservation_id = ANY($1::text[]) ORDER BY created_at DESC`,
          [resIds]
        ),
        executor.query<{ reservation_id: string; cnt: number }>(
          `SELECT reservation_id, COUNT(*)::int AS cnt FROM problems WHERE reservation_id = ANY($1::text[]) GROUP BY reservation_id`,
          [resIds]
        )
      ])
    : [{ rows: [] as any[] }, { rows: [] as any[] }];

  const fuByRes = new Map<string, any[]>();
  for (const row of resFuRes.rows) {
    const rid = str(row.reservation_id);
    const list = fuByRes.get(rid) || [];
    list.push(formatFollowUpRow(row));
    fuByRes.set(rid, list);
  }
  const prbCountByRes = new Map<string, number>();
  for (const row of resPrbRes.rows) {
    prbCountByRes.set(str(row.reservation_id), num(row.cnt));
  }

  const customerKeys = new Set<string>();
  const statusCounts: Record<string, number> = {};
  const assignedReservations = resRows.rows.map((r) => {
    const base = mapReservationRowToClient(r, false);
    const cKey = str(base.customerPhone || base.customerName);
    if (cKey) customerKeys.add(cKey);
    const st = str(base.internalStatus || 'تم الإنشاء');
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    const rFus = fuByRes.get(base.id) || [];
    const myFusCount = rFus.filter((f) => f.employeeId === empId).length;
    return {
      ...base,
      isFollowed: rFus.length > 0,
      followUpsCount: rFus.length,
      myFollowUpsCount: myFusCount,
      problemsCount: prbCountByRes.get(base.id) || 0,
      latestFollowUp: rFus[0] || null
    };
  });

  const followUps = fuRows.rows.map(formatFollowUpRow);
  const problems = prbRows.rows.map((p) => formatProblemRow(p));

  return {
    employee,
    stats: {
      uniqueCustomersCount: customerKeys.size,
      reservationsCount: assignedReservations.length,
      followUpsCount: followUps.length,
      problemsCount: problems.length,
      statusCounts
    },
    assignedReservations: redactReservationsList(assignedReservations, session.user),
    followUps,
    problems
  };
}

function normEmpEmail(raw: unknown): string {
  return typeof crmCore.normalizeEmployeeEmail === 'function'
    ? crmCore.normalizeEmployeeEmail(raw)
    : str(raw).toLowerCase();
}

function normEmpPhone(raw: unknown): string {
  if (typeof crmCore.normalizeEmployeePhone === 'function') {
    return crmCore.normalizeEmployeePhone(raw);
  }
  let digits = str(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00966') && digits.length >= 14) digits = '0' + digits.slice(5);
  else if (digits.startsWith('966') && digits.length >= 12) digits = '0' + digits.slice(3);
  else if (digits.length === 9 && digits.startsWith('5')) digits = '0' + digits;
  return digits;
}

export async function createEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const name = str(payload.name);
  const username = normalizeLoginUsername(payload.username);
  const password = String(payload.password || '');
  const role = str(payload.role || 'agent');
  if (role === 'developer' && session.user.role !== 'developer') {
    throw new Error('FORBIDDEN: إنشاء حساب مبرمج متاح للمبرمج فقط.');
  }
  const email = str(payload.email);
  const phone = str(payload.phone);
  const normEmail = normEmpEmail(email);
  const normPhone = normEmpPhone(phone);
  if (!name || !username || !password) {
    throw new Error('VALIDATION_ERROR: الاسم واسم المستخدم وكلمة المرور مطلوبة.');
  }

  return runWithIdempotency(executor, session.user.id, 'createEmployee', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const existingAll = await tx.query(`SELECT * FROM employees`);
      for (const row of existingAll.rows || []) {
        if (normalizeLoginUsername(row.username) === username) {
          throw new Error('DUPLICATE_USERNAME: اسم المستخدم مسجل بالفعل.');
        }
        if (normEmail && normEmpEmail(row.email) === normEmail) {
          throw new Error('DUPLICATE_EMAIL: البريد الإلكتروني مسجل بالفعل لموظف آخر.');
        }
        if (normPhone && normEmpPhone(row.phone) === normPhone) {
          throw new Error('DUPLICATE_PHONE: رقم الجوال مسجل بالفعل لموظف آخر.');
        }
      }

      const salt = crypto.randomBytes(8).toString('hex').toUpperCase();
      const pHash = hashPassword(password, salt);
      const rawPerms = Array.isArray(payload.permissions) ? payload.permissions : [role];
      const effectivePerms = crmCore.resolveEffectivePermissions(role, rawPerms);
      const uiOverrides = typeof crmCore.normalizeUiOverrides === 'function'
        ? crmCore.normalizeUiOverrides(payload.uiOverrides)
        : {};
      const nowIso = new Date().toISOString();
      const id = generateId('EMP');

      await tx.query(
        `INSERT INTO employees (id, name, username, password_hash, salt, phone, email, job_title, role, permissions, ui_overrides, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'active',$12::text,$13::timestamptz,$13::timestamptz)`,
        [id, name, username, pHash, salt, phone, email, str(payload.jobTitle), role, JSON.stringify(effectivePerms), JSON.stringify(uiOverrides), nowIso, nowIso]
      );
      await tx.query(
        `INSERT INTO users (id, name, username, phone, email, job_title, role, permissions, ui_overrides, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'active',$10,$11::timestamptz,$11::timestamptz)`,
        [id, name, username, phone, email, str(payload.jobTitle), role, JSON.stringify(effectivePerms), JSON.stringify(uiOverrides), nowIso, nowIso]
      );

      await logActivity(tx, session.user, 'إضافة موظف', 'Employee', username, `إضافة ${name} بدور ${role}`);
      const emp = mapEmployeeRow({
        id, name, username, phone, email,
        job_title: str(payload.jobTitle), role, permissions: effectivePerms, ui_overrides: uiOverrides,
        status: 'active', last_activity: nowIso, created_at: nowIso, updated_at: nowIso
      });
      await enqueueSheetsMirror(tx, 'Employee', id, 'upsertEmployee', { ...emp, passwordHash: pHash, salt });
      return emp;
    });

    invalidateScopes(executor, ['employees', 'dashboard', 'reports']);
    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

export async function updateEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const res = await tx.query(`SELECT * FROM employees WHERE id = $1 FOR UPDATE`, [empId]);
    if (!res.rows[0]) throw new Error('NOT_FOUND: الموظف غير موجود.');
    const cur = res.rows[0];
    if (str(cur.role) === 'developer' && session.user.role !== 'developer') {
      throw new Error('FORBIDDEN: تعديل حساب المبرمج متاح للمبرمج فقط.');
    }

    const nextRole = payload.role !== undefined ? str(payload.role) : str(cur.role);
    if (nextRole === 'developer' && session.user.role !== 'developer') {
      throw new Error('FORBIDDEN: ترقية حساب إلى دور المبرمج متاحة للمبرمج فقط.');
    }
    const rawPerms = Array.isArray(payload.permissions) ? payload.permissions : parseJsonArray(cur.permissions);
    let nextPerms = crmCore.resolveEffectivePermissions(nextRole, rawPerms);
    if (empId === session.employeeId && (cur.role === 'developer' || cur.role === 'general_manager')) {
      for (const reqPerm of ['manage_employees', 'manage_settings', 'customize_ui']) {
        if (nextPerms.indexOf('all') === -1 && nextPerms.indexOf(reqPerm) === -1) {
          nextPerms = [...nextPerms, reqPerm];
        }
      }
    }
    const nextUiOverrides = payload.uiOverrides !== undefined && typeof crmCore.normalizeUiOverrides === 'function'
      ? crmCore.normalizeUiOverrides(payload.uiOverrides)
      : (typeof crmCore.normalizeUiOverrides === 'function' ? crmCore.normalizeUiOverrides(parseJsonValue(cur.ui_overrides, {})) : {});

    let nextUsername = normalizeLoginUsername(cur.username) || str(cur.username);
    if (payload.username !== undefined) {
      const requestedUsername = normalizeLoginUsername(payload.username);
      if (!requestedUsername) {
        throw new Error('VALIDATION_ERROR: اسم المستخدم مطلوب.');
      }
      nextUsername = requestedUsername;
    }

    const nextName = payload.name !== undefined ? str(payload.name) : str(cur.name);
    const nextPhone = payload.phone !== undefined ? str(payload.phone) : str(cur.phone);
    const nextEmail = payload.email !== undefined ? str(payload.email) : str(cur.email);
    const nextJob = payload.jobTitle !== undefined ? str(payload.jobTitle) : str(cur.job_title);
    const nextStatus = payload.status !== undefined ? str(payload.status) : str(cur.status);

    const normEmail = normEmpEmail(nextEmail);
    const normPhone = normEmpPhone(nextPhone);
    const allEmpsRes = await tx.query(`SELECT * FROM employees`);
    const otherEmps = (allEmpsRes.rows || []).filter((r: any) => str(r.id) !== empId);
    for (const other of otherEmps) {
      if (normalizeLoginUsername(other.username) === nextUsername) {
        throw new Error('CONFLICT: اسم المستخدم مسجل بالفعل لموظف آخر.');
      }
      if (normEmail && normEmpEmail(other.email) === normEmail) {
        throw new Error('CONFLICT: البريد الإلكتروني مسجل بالفعل لموظف آخر.');
      }
      if (normPhone && normEmpPhone(other.phone) === normPhone) {
        throw new Error('CONFLICT: رقم الجوال مسجل بالفعل لموظف آخر.');
      }
    }

    if (str(cur.status) === 'active' && (nextRole !== str(cur.role) || nextStatus !== 'active')) {
      if (str(cur.role) === 'developer') {
        const activeDevs = otherEmps.filter((r: any) => str(r.role) === 'developer' && str(r.status || 'active') === 'active').length;
        if (activeDevs < 1) {
          throw new Error('FORBIDDEN: لا يمكن إيقاف أو تغيير دور آخر حساب مبرمج نشط في النظام.');
        }
      } else if (str(cur.role) === 'general_manager') {
        const activeGms = otherEmps.filter((r: any) => str(r.role) === 'general_manager' && str(r.status || 'active') === 'active').length;
        if (activeGms < 1) {
          throw new Error('FORBIDDEN: لا يمكن إيقاف أو تغيير دور آخر مدير عام نشط في النظام.');
        }
      }
    }

    let nextSalt = str(cur.salt);
    let nextHash = str(cur.password_hash);
    if (payload.newPassword && String(payload.newPassword).trim().length >= 4) {
      nextSalt = crypto.randomBytes(8).toString('hex').toUpperCase();
      nextHash = hashPassword(String(payload.newPassword).trim(), nextSalt);
      if (empId === session.employeeId && session.tokenHash) {
        await tx.query(
          `UPDATE sessions SET is_revoked = TRUE WHERE employee_id = $1 AND token_hash <> $2`,
          [empId, session.tokenHash]
        );
      } else {
        await revokeEmployeeSessions(tx, empId);
      }
    }

    const nowIso = new Date().toISOString();

    await tx.query(
      `UPDATE employees
       SET name = $2, username = $3, phone = $4, email = $5, job_title = $6, role = $7,
           permissions = $8::jsonb, ui_overrides = $9::jsonb, status = $10, password_hash = $11, salt = $12, updated_at = $13::timestamptz
       WHERE id = $1`,
      [empId, nextName, nextUsername, nextPhone, nextEmail, nextJob, nextRole, JSON.stringify(nextPerms), JSON.stringify(nextUiOverrides), nextStatus, nextHash, nextSalt, nowIso]
    );
    await tx.query(
      `UPDATE users
       SET name = $2, username = $3, phone = $4, email = $5, job_title = $6, role = $7,
           permissions = $8::jsonb, ui_overrides = $9::jsonb, status = $10, updated_at = $11::timestamptz
       WHERE id = $1`,
      [empId, nextName, nextUsername, nextPhone, nextEmail, nextJob, nextRole, JSON.stringify(nextPerms), JSON.stringify(nextUiOverrides), nextStatus, nowIso]
    );

    if (nextStatus !== 'active') {
      await revokeEmployeeSessions(tx, empId);
    }

    const empDiffs = crmCore.computeAuditFieldDiffs(
      { name: cur.name, username: cur.username, jobTitle: cur.job_title, role: cur.role, status: cur.status, phone: cur.phone },
      { name: nextName, username: nextUsername, jobTitle: nextJob, role: nextRole, status: nextStatus, phone: nextPhone },
      [
        { field: 'name', label: 'الاسم' },
        { field: 'username', label: 'اسم المستخدم' },
        { field: 'jobTitle', label: 'المسمى الوظيفي' },
        { field: 'role', label: 'الدور الوظيفي' },
        { field: 'status', label: 'حالة الحساب' },
        { field: 'phone', label: 'الجوال' }
      ]
    );
    await logActivity(tx, session.user, 'تحديث بيانات موظف', 'Employee', nextUsername, `تحديث ${nextName}`, empDiffs);
    const emp = mapEmployeeRow({
      ...cur,
      name: nextName, username: nextUsername, phone: nextPhone, email: nextEmail, job_title: nextJob,
      role: nextRole, permissions: nextPerms, ui_overrides: nextUiOverrides, status: nextStatus, updated_at: nowIso
    });
    await enqueueSheetsMirror(tx, 'Employee', empId, 'upsertEmployee', { ...emp, passwordHash: nextHash, salt: nextSalt });
    return emp;
  });

  invalidateAuthSessionCache(executor, { employeeId: empId });
  invalidateScopes(executor, ['employees', 'dashboard', 'reports']);
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function disableEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');
  if (empId === session.user.id) throw new Error('FORBIDDEN: لا يمكن إيقاف حسابك الشخصي.');

  const targetRes = await executor.query(`SELECT * FROM employees WHERE id = $1`, [empId]);
  const target = targetRes.rows[0];
  if (!target) throw new Error('NOT_FOUND: الموظف غير موجود.');
  if (str(target.role) === 'developer' && session.user.role !== 'developer') {
    throw new Error('FORBIDDEN: إيقاف أو تشغيل حساب المبرمج متاح للمبرمج فقط.');
  }

  const status = payload.status === 'active' ? 'active' : 'disabled';
  return updateEmployee(executor, session, { employeeId: empId, status });
}

export async function deleteEmployee(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_employees');
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');
  if (empId === session.user.id) {
    throw new Error('FORBIDDEN: لا يمكن حذف حسابك الشخصي أثناء تسجيل الدخول.');
  }

  const out = await executor.withTransaction(async (tx) => {
    const res = await tx.query(`SELECT * FROM employees WHERE id = $1 FOR UPDATE`, [empId]);
    const cur = res.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الموظف غير موجود.');

    if (str(cur.role) === 'developer' && session.user.role !== 'developer') {
      throw new Error('FORBIDDEN: حذف حساب المبرمج متاح للمبرمج فقط.');
    }

    if (str(cur.role) === 'developer' && str(cur.status || 'active') === 'active') {
      const allEmps = await tx.query(`SELECT * FROM employees`);
      const remainingActiveDevs = (allEmps.rows || []).filter(
        (e: any) => str(e.id) !== empId && str(e.role) === 'developer' && str(e.status || 'active') === 'active'
      ).length;
      if (remainingActiveDevs < 1) {
        throw new Error('FORBIDDEN: لا يمكن حذف آخر حساب مبرمج نشط في النظام.');
      }
    }

    if (str(cur.role) === 'general_manager' && str(cur.status) === 'active') {
      const activeGmRes = await tx.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM employees WHERE role = 'general_manager' AND status = 'active' AND id <> $1`,
        [empId]
      );
      const remainingActiveGms = Number(activeGmRes.rows[0]?.cnt || 0);
      if (remainingActiveGms < 1) {
        throw new Error('FORBIDDEN: لا يمكن حذف آخر مدير عام نشط في النظام.');
      }
    }

    await tx.query(`DELETE FROM sessions WHERE employee_id = $1`, [empId]);
    await tx.query(`DELETE FROM assignments WHERE employee_id = $1`, [empId]);

    const affectedRes = await tx.query(
      `SELECT id, assigned_employee_ids, assigned_employee_names FROM reservations WHERE assigned_employee_ids @> $1::jsonb`,
      [JSON.stringify([empId])]
    );
    for (const r of affectedRes.rows) {
      const ids = parseJsonArray<string>(r.assigned_employee_ids);
      const names = parseJsonArray<string>(r.assigned_employee_names);
      const nextIds: string[] = [];
      const nextNames: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== empId) {
          nextIds.push(ids[i]);
          if (names[i] !== undefined) nextNames.push(names[i]);
        }
      }
      await tx.query(
        `UPDATE reservations SET assigned_employee_ids = $2::jsonb, assigned_employee_names = $3::jsonb, updated_at = NOW() WHERE id = $1`,
        [r.id, JSON.stringify(nextIds), JSON.stringify(nextNames)]
      );
    }

    const affectedPrb = await tx.query(
      `SELECT id, assigned_employee_ids, assigned_employee_names FROM problems WHERE assigned_employee_ids @> $1::jsonb`,
      [JSON.stringify([empId])]
    );
    for (const p of affectedPrb.rows) {
      const ids = parseJsonArray<string>(p.assigned_employee_ids);
      const names = parseJsonArray<string>(p.assigned_employee_names);
      const nextIds: string[] = [];
      const nextNames: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== empId) {
          nextIds.push(ids[i]);
          if (names[i] !== undefined) nextNames.push(names[i]);
        }
      }
      await tx.query(
        `UPDATE problems SET assigned_employee_ids = $2::jsonb, assigned_employee_names = $3::jsonb, updated_at = NOW() WHERE id = $1`,
        [p.id, JSON.stringify(nextIds), JSON.stringify(nextNames)]
      );
    }

    await runTxOptional(
      tx,
      'clear_note_emp_assign',
      () => tx.query(
        `UPDATE customer_notes SET assigned_employee_id = '', assigned_employee_name = '', updated_at = NOW() WHERE assigned_employee_id = $1`,
        [empId]
      ),
      undefined
    );

    await tx.query(`DELETE FROM users WHERE id = $1`, [empId]);
    await tx.query(`DELETE FROM employees WHERE id = $1`, [empId]);
    await recordSyncTombstone(tx, 'employee', [empId], { username: str(cur.username) });

    await logActivity(tx, session.user, 'حذف موظف', 'Employee', str(cur.username || empId), `حذف الموظف ${str(cur.name)} (${str(cur.username)})`);
    await enqueueSheetsMirror(tx, 'Employee', empId, 'deleteEmployee', {
      id: empId,
      username: str(cur.username),
      name: str(cur.name)
    });

    return {
      id: empId,
      deleted: true,
      name: str(cur.name),
      username: str(cur.username)
    };
  });

  invalidateAuthSessionCache(executor, { employeeId: empId });
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
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
  const canViewAllLogs = crmCore.canUserPerform(session.user, 'view_all_logs');
  const params: any[] = [];
  const clauses: string[] = [];
  if (!canViewAllLogs) {
    params.push(str(session.user.id));
    clauses.push(`user_id = $${params.length}`);
  } else if (payload.userId) {
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
      changes: parseJsonArray(l.changes),
      logDate: str(l.log_date),
      logTime: str(l.log_time),
      createdAt: l.created_at instanceof Date ? l.created_at.toISOString() : str(l.created_at)
    }))
  };
}

export async function markNotificationRead(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const userId = str(session.user.id);
  const userRole = str(session.user.role);
  if (payload.markAll) {
    await executor.query(
      `UPDATE notifications SET is_read = TRUE, updated_at = NOW()
       WHERE (BTRIM(COALESCE(recipient_employee_id, '')) = $1 OR (BTRIM(COALESCE(recipient_employee_id, '')) = '' AND (BTRIM(COALESCE(recipient_role, '')) = $2 OR BTRIM(COALESCE(recipient_role, '')) = 'all')))
         AND deleted_at IS NULL
         AND is_read = FALSE`,
      [userId, userRole]
    );
  } else if (payload.notificationId) {
    await executor.query(
      `UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE id = $1 AND (BTRIM(COALESCE(recipient_employee_id, '')) = $2 OR (BTRIM(COALESCE(recipient_employee_id, '')) = '' AND (BTRIM(COALESCE(recipient_role, '')) = $3 OR BTRIM(COALESCE(recipient_role, '')) = 'all'))) AND deleted_at IS NULL`,
      [str(payload.notificationId), userId, userRole]
    );
  }
  return { updated: true };
}

export async function deleteNotification(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const deleteAll = toBool(payload.deleteAll);
  const notifId = str(payload.notificationId || payload.id);
  if (!deleteAll && !notifId) {
    throw new Error('VALIDATION_ERROR: معرف الإشعار مطلوب.');
  }

  return runWithIdempotency(executor, session.user.id, 'deleteNotification', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const personalDeletedIds: string[] = [];
      const dismissedSharedIds: string[] = [];
      const userId = str(session.user.id);
      const userRole = str(session.user.role);
      const delNowIso = new Date().toISOString();

      if (deleteAll) {
        const personalRes = await tx.query<{ id: string }>(
          `UPDATE notifications
           SET deleted_at = NOW(),
               deleted_by_id = $1,
               updated_at = NOW()
           WHERE BTRIM(COALESCE(recipient_employee_id, '')) = $1
             AND deleted_at IS NULL
           RETURNING id`,
          [userId]
        );
        for (const r of personalRes?.rows || []) {
          if (r?.id) personalDeletedIds.push(str(r.id));
        }

        const sharedRes = await runTxOptional(
          tx,
          'notif_dismiss_all',
          () =>
            tx.query<{ id: string }>(
              `INSERT INTO notification_dismissals (notification_id, employee_id, deleted_at)
               SELECT n.id, $1, NOW()
               FROM notifications n
               WHERE BTRIM(COALESCE(n.recipient_employee_id, '')) = ''
                 AND (BTRIM(COALESCE(n.recipient_role, '')) = $2 OR BTRIM(COALESCE(n.recipient_role, '')) = 'all')
                 AND n.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM notification_dismissals nd
                   WHERE nd.notification_id = n.id
                     AND BTRIM(COALESCE(nd.employee_id, '')) = $1
                     AND nd.deleted_at IS NOT NULL
                 )
               ON CONFLICT (notification_id, employee_id) DO UPDATE SET deleted_at = NOW()
               RETURNING notification_id AS id`,
              [userId, userRole]
            ),
          { rows: [] as Array<{ id: string }>, rowCount: 0 }
        );
        for (const r of sharedRes?.rows || []) {
          if (r?.id) dismissedSharedIds.push(str(r.id));
        }
      } else {
        const personalRes = await tx.query<{ id: string }>(
          `UPDATE notifications
           SET deleted_at = NOW(),
               deleted_by_id = $2,
               updated_at = NOW()
           WHERE id = $1
             AND BTRIM(COALESCE(recipient_employee_id, '')) = $2
             AND deleted_at IS NULL
           RETURNING id`,
          [notifId, userId]
        );
        for (const r of personalRes?.rows || []) {
          if (r?.id) personalDeletedIds.push(str(r.id));
        }

        const sharedRes = await runTxOptional(
          tx,
          'notif_dismiss_one',
          () =>
            tx.query<{ id: string }>(
              `INSERT INTO notification_dismissals (notification_id, employee_id, deleted_at)
               SELECT n.id, $2, NOW()
               FROM notifications n
               WHERE n.id = $1
                 AND BTRIM(COALESCE(n.recipient_employee_id, '')) = ''
                 AND (BTRIM(COALESCE(n.recipient_role, '')) = $3 OR BTRIM(COALESCE(n.recipient_role, '')) = 'all')
                 AND n.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM notification_dismissals nd
                   WHERE nd.notification_id = n.id
                     AND BTRIM(COALESCE(nd.employee_id, '')) = $2
                     AND nd.deleted_at IS NOT NULL
                 )
               ON CONFLICT (notification_id, employee_id) DO UPDATE SET deleted_at = NOW()
               RETURNING notification_id AS id`,
              [notifId, userId, userRole]
            ),
          { rows: [] as Array<{ id: string }>, rowCount: 0 }
        );
        for (const r of sharedRes?.rows || []) {
          if (r?.id) dismissedSharedIds.push(str(r.id));
        }
      }

      const deletedIds = Array.from(new Set([...personalDeletedIds, ...dismissedSharedIds]));
      if (deletedIds.length > 0) {
        await recordSyncTombstone(tx, `notification:${userId}`, deletedIds, {
          employeeId: userId,
          deleteAll
        });
      }
      if (deleteAll) {
        await recordSyncTombstone(tx, 'notification_clear_all', [`ALL:${userId}`], {
          employeeId: userId
        });
      }
      if (deletedIds.length > 0 || deleteAll) {
        await runTxOptional(
          tx,
          'notif_sheets_mirror',
          () =>
            enqueueSheetsMirror(tx, 'Notification', deleteAll ? `ALL:${userId}` : notifId, 'deleteNotification', {
              id: deleteAll ? '' : notifId,
              deletedIds: personalDeletedIds,
              dismissedSharedIds,
              deleteAll,
              recipientEmployeeId: userId,
              userRole,
              deletedById: userId,
              deletedAt: delNowIso
            }),
          undefined
        );
      }

      const fresh = await fetchNotificationsForSession(tx, session);
      return {
        deleted: true,
        deletedCount: deletedIds.length,
        deletedIds,
        deletedAllBefore: deleteAll ? delNowIso : '',
        deletedAllNotificationsBefore: deleteAll ? delNowIso : '',
        items: fresh.items,
        unreadCount: fresh.unreadCount
      };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

export async function getSettings(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const [map, serverCfg, workerRow] = await Promise.all([
    getSettingsMap(executor),
    resolveServerConfig(executor),
    readWorkerStateRow(executor)
  ]);
  const dbUrl = getDatabaseUrl();
  const syncCfg = normalizeAutoSyncConfig(map);
  const syncInterval = crmCore.normalizeAutoSyncInterval(
    map.auto_sync_interval_hours,
    map.auto_sync_interval_minutes
  );
  const syncWorkerState = buildWorkerTelemetrySummary(workerRow, syncCfg, []);
  return {
    ...map,
    excluded_statuses: sanitizeExcludedStatusesList(map.excluded_statuses),
    ui_simplification: crmCore.normalizeUiSimplificationSettings(map.ui_simplification),
    role_ui_defaults: typeof crmCore.normalizeRoleUiDefaults === 'function' ? crmCore.normalizeRoleUiDefaults(map.role_ui_defaults) : {},
    stats_control_config: typeof crmCore.normalizeStatsControlConfig === 'function' ? crmCore.normalizeStatsControlConfig(map.stats_control_config) : { excludedFromStatsEmployeeIds: [] },
    call_wrapup_shortcuts: typeof crmCore.normalizeCallWrapupShortcutsConfig === 'function' ? crmCore.normalizeCallWrapupShortcutsConfig(map.call_wrapup_shortcuts) : { items: crmCore.CALL_WRAPUP_OUTCOMES || [], customized: false, updatedAt: '', updatedBy: '' },
    handover_settings: crmCore.normalizeHandoverSettings(map.handover_settings),
    customer_notes_config: typeof crmCore.normalizeCustomerNotesConfig === 'function'
      ? crmCore.normalizeCustomerNotesConfig(map.customer_notes_config)
      : {},
    connection_mode: serverCfg.mode || 'neon',
    gas_webapp_url: serverCfg.gasWebAppUrl,
    rg_api_base_url: serverCfg.rgApiBaseUrl,
    auto_sync_enabled: syncCfg.enabled,
    auto_sync_interval_seconds: syncCfg.intervalSeconds,
    auto_sync_interval_value: syncCfg.value,
    auto_sync_interval_unit: syncCfg.unit,
    auto_sync_interval_hours: syncInterval.hours,
    auto_sync_interval_minutes: syncInterval.minutes,
    syncWorkerState,
    hasRgToken: Boolean(serverCfg.rgToken || serverCfg.gasWebAppUrl),
    hasDirectToken: Boolean(serverCfg.rgToken),
    hasSyncSecret: Boolean(serverCfg.syncApiSecret),
    hasDatabaseUrl: Boolean(dbUrl),
    maskedDatabaseUrl: maskDatabaseUrl(dbUrl),
    writableCoreFiles: isCoreFilesystemWritable()
  };
}

export async function getSetupCapabilitiesAction(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  return readSetupCapabilities(executor);
}

export async function applyUnifiedConnectionSetupAction(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_settings');
  const out = await runUnifiedConnectionSetup({
    executor,
    session,
    payload,
    skipLiveDbTest: Boolean(payload._skipLiveDbTestForUnit),
    ensureSeededFn: ensureSeededDatabase,
    logActivityFn: async (exec, actor, act, target, targetId, details) => {
      await logActivity(exec, actor, act, target, targetId, details);
    }
  });
  invalidateScopes(executor, ['settings']);
  return out;
}

export async function updateSettings(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const hasSystemSettingFields = Boolean(
    payload.company_name !== undefined ||
    payload.excluded_statuses !== undefined ||
    payload.session_ttl_hours !== undefined ||
    payload.allow_agent_view_all !== undefined ||
    payload.default_language !== undefined ||
    payload.auto_sync_enabled !== undefined ||
    payload.ui_simplification !== undefined ||
    payload.role_ui_defaults !== undefined ||
    payload.stats_control_config !== undefined ||
    payload.call_wrapup_shortcuts !== undefined ||
    payload.customer_notes_config !== undefined ||
    payload.auto_sync_interval_seconds !== undefined ||
    payload.auto_sync_interval_value !== undefined ||
    payload.auto_sync_interval_unit !== undefined ||
    payload.auto_sync_interval_hours !== undefined ||
    payload.auto_sync_interval_minutes !== undefined
  );
  if (payload.stats_control_config !== undefined && session.user.role !== 'developer') {
    throw new Error('FORBIDDEN: التحكم في ظهور الموظفين بالإحصائيات متاح للمبرمج فقط.');
  }
  if (payload.call_wrapup_shortcuts !== undefined && session.user.role !== 'developer') {
    throw new Error('FORBIDDEN: التحكم في اختصارات نافذة الاتصال متاح للمبرمج فقط.');
  }
  if (payload.customer_notes_config !== undefined) {
    if (!crmCore.canUserPerform(session.user, 'manage_customer_notes_settings') && !crmCore.canUserPerform(session.user, 'manage_settings')) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية تعديل إعدادات ملاحظات العملاء.');
    }
  }
  if (hasSystemSettingFields || payload.handover_settings === undefined) {
    requirePermission(session, 'manage_settings');
  } else {
    requireApiAccess(session);
  }
  const prevMap = await getSettingsMap(executor);
  const updates: Array<[string, string]> = [];
  if (payload.company_name) updates.push(['company_name', str(payload.company_name)]);
  if (Array.isArray(payload.excluded_statuses)) {
    updates.push(['excluded_statuses', JSON.stringify(sanitizeExcludedStatusesList(payload.excluded_statuses))]);
  }
  if (payload.session_ttl_hours) updates.push(['session_ttl_hours', String(num(payload.session_ttl_hours, 12))]);
  if (typeof payload.allow_agent_view_all === 'boolean') updates.push(['allow_agent_view_all', String(payload.allow_agent_view_all)]);
  if (payload.default_language) updates.push(['default_language', str(payload.default_language)]);
  if (typeof payload.auto_sync_enabled === 'boolean') updates.push(['auto_sync_enabled', String(payload.auto_sync_enabled)]);
  if (payload.ui_simplification !== undefined) {
    const normUi = crmCore.normalizeUiSimplificationSettings(payload.ui_simplification);
    updates.push(['ui_simplification', JSON.stringify(normUi)]);
  }
  if (payload.role_ui_defaults !== undefined && typeof crmCore.normalizeRoleUiDefaults === 'function') {
    const normRoleUi = crmCore.normalizeRoleUiDefaults(payload.role_ui_defaults);
    updates.push(['role_ui_defaults', JSON.stringify(normRoleUi)]);
  }
  if (payload.stats_control_config !== undefined && typeof crmCore.normalizeStatsControlConfig === 'function') {
    const normStatsCfg = crmCore.normalizeStatsControlConfig(payload.stats_control_config);
    normStatsCfg.updatedAt = new Date().toISOString();
    normStatsCfg.updatedBy = session.user.name;
    updates.push(['stats_control_config', JSON.stringify(normStatsCfg)]);
  }
  let shortcutsChangedDiff: { field: string; label: string; before: string; after: string } | null = null;
  if (payload.call_wrapup_shortcuts !== undefined && typeof crmCore.normalizeCallWrapupShortcutsConfig === 'function') {
    const prevSc = crmCore.normalizeCallWrapupShortcutsConfig(prevMap.call_wrapup_shortcuts);
    const normSc = crmCore.normalizeCallWrapupShortcutsConfig(payload.call_wrapup_shortcuts);
    normSc.updatedAt = new Date().toISOString();
    normSc.updatedBy = session.user.name;
    updates.push(['call_wrapup_shortcuts', JSON.stringify(normSc)]);
    if (JSON.stringify(prevSc.items) !== JSON.stringify(normSc.items) || prevSc.customized !== normSc.customized) {
      shortcutsChangedDiff = {
        field: 'call_wrapup_shortcuts',
        label: 'اختصارات نافذة الاتصال',
        before: String(prevSc.items.length) + ' اختصار',
        after: String(normSc.items.length) + ' اختصار'
      };
    }
  }
  let handoverChangedDiff: { field: string; label: string; before: string; after: string } | null = null;
  if (payload.handover_settings !== undefined) {
    const prevHandover = crmCore.normalizeHandoverSettings(prevMap.handover_settings);
    const normHandover = crmCore.normalizeHandoverSettings(payload.handover_settings);
    updates.push(['handover_settings', JSON.stringify(normHandover)]);
    const bSummary = `${prevHandover.defaultPreset} (${prevHandover.defaultTimeFrom || '00:00'}-${prevHandover.defaultTimeTo || '23:59'})`;
    const aSummary = `${normHandover.defaultPreset} (${normHandover.defaultTimeFrom || '00:00'}-${normHandover.defaultTimeTo || '23:59'})`;
    if (JSON.stringify(prevHandover) !== JSON.stringify(normHandover)) {
      handoverChangedDiff = { field: 'handover_settings', label: 'إعدادات تسليم الوردية', before: bSummary, after: aSummary };
    }
  }
  if (payload.customer_notes_config !== undefined && typeof crmCore.normalizeCustomerNotesConfig === 'function') {
    const normNotesCfg = crmCore.normalizeCustomerNotesConfig(payload.customer_notes_config);
    normNotesCfg.updatedAt = new Date().toISOString();
    normNotesCfg.updatedBy = session.user.name;
    updates.push(['customer_notes_config', JSON.stringify(normNotesCfg)]);
  }

  const hasAutoSyncIntervalChange = Boolean(
    payload.auto_sync_interval_seconds !== undefined ||
    payload.auto_sync_interval_value !== undefined ||
    payload.auto_sync_interval_unit !== undefined ||
    payload.auto_sync_interval_hours !== undefined ||
    payload.auto_sync_interval_minutes !== undefined
  );
  const nextAutoEnabled =
    typeof payload.auto_sync_enabled === 'boolean'
      ? payload.auto_sync_enabled
      : prevMap.auto_sync_enabled !== false;

  if (hasAutoSyncIntervalChange) {
    const valRes = validateAutoSyncSettingsInput({
      enabled: nextAutoEnabled,
      value: payload.auto_sync_interval_value,
      unit: payload.auto_sync_interval_unit,
      intervalSeconds: payload.auto_sync_interval_seconds,
      hours: payload.auto_sync_interval_hours,
      minutes: payload.auto_sync_interval_minutes
    });
    if (!valRes.valid) {
      throw new Error(valRes.error);
    }
    updates.push(['auto_sync_interval_seconds', String(valRes.intervalSeconds)]);
    updates.push(['auto_sync_interval_value', String(valRes.value)]);
    updates.push(['auto_sync_interval_unit', String(valRes.unit)]);
    updates.push(['auto_sync_interval_hours', String(valRes.legacyHours)]);
    updates.push(['auto_sync_interval_minutes', String(valRes.legacyMinutes)]);
  }

  const settingDiffs = updates
    .filter(([k]) => k !== 'ui_simplification' && k !== 'role_ui_defaults' && k !== 'handover_settings' && k !== 'stats_control_config' && k !== 'call_wrapup_shortcuts')
    .map(([k, nextVal]) => ({
      field: k,
      label: k,
      before: String(prevMap[k] !== undefined ? prevMap[k] : '-'),
      after: nextVal
    }))
    .filter((d) => d.before !== d.after);
  if (handoverChangedDiff) settingDiffs.push(handoverChangedDiff);
  if (shortcutsChangedDiff) settingDiffs.push(shortcutsChangedDiff);

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
    await logActivity(tx, session.user, 'تحديث الإعدادات', 'Settings', 'system', 'تحديث إعدادات النظام في قاعدة البيانات', settingDiffs);
  });

  if (typeof payload.auto_sync_enabled === 'boolean' || hasAutoSyncIntervalChange) {
    try {
      const [freshMap, prevWorker] = await Promise.all([
        getSettingsMap(executor),
        readWorkerStateRow(executor)
      ]);
      const finalCfg = normalizeAutoSyncConfig(freshMap);
      const nextRunAt = computeNextScheduledRunAt({
        enabled: finalCfg.enabled,
        intervalSeconds: finalCfg.intervalSeconds,
        nowMs: Date.now(),
        currentNextRunAt: prevWorker?.next_run_at || null,
        lastRunAt: prevWorker?.last_run_at || null,
        consecutiveErrors: finalCfg.enabled ? num(prevWorker?.consecutive_errors, 0) : 0,
        reason: 'config_changed'
      });
      const nextStatus = deriveWorkerStatus({
        enabled: finalCfg.enabled,
        isSyncing: Boolean(prevWorker?.is_syncing),
        consecutiveErrors: finalCfg.enabled ? num(prevWorker?.consecutive_errors, 0) : 0,
        lastError: finalCfg.enabled ? str(prevWorker?.last_error || '') : ''
      });
      await executor.query(
        `INSERT INTO sync_worker_state (id) VALUES ('primary') ON CONFLICT (id) DO NOTHING`
      ).catch(() => undefined);
      await executor.query(
        `UPDATE sync_worker_state
         SET status = $1,
             auto_sync_enabled = $2,
             interval_seconds = $3,
             interval_value = $4,
             interval_unit = $5,
             next_run_at = $6::timestamptz,
             consecutive_errors = CASE WHEN $2 THEN consecutive_errors ELSE 0 END,
             updated_at = NOW()
         WHERE id = 'primary'`,
        [nextStatus, finalCfg.enabled, finalCfg.intervalSeconds, finalCfg.value, finalCfg.unit, nextRunAt]
      ).catch(() => undefined);
      notifyAutoSyncConfigChanged();
      void emitSyncWorkerStatusRealtime(executor, 'syncWorkerConfigUpdated', session.user.id).catch(() => undefined);
    } catch {
      // Non-fatal in mock executors
    }
  }

  invalidateScopes(executor, ['settings', 'dashboard', 'reports', 'sync']);
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return getSettings(executor, session);
}

export async function getUserLayoutPrefs(
  executor: DbExecutor,
  session: AuthSession
) {
  const settings = await getSettingsMap(executor);
  return crmCore.normalizeUserLayoutPrefs(parseJsonValue(settings[`layout_prefs_u_${session.user.id}`], {}));
}

export async function saveUserLayoutPrefs(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const normalized = crmCore.normalizeUserLayoutPrefs(payload);
  const key = `layout_prefs_u_${session.user.id}`;
  const value = JSON.stringify(normalized);
  await executor.query(
    `INSERT INTO settings (key, value, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, value, session.user.name]
  );
  invalidateScopes(executor, ['settings']);
  return { layoutPrefs: normalized };
}

const RESERVATION_CLIENT_COLUMNS = `
  id, source_reservation_id, reservation_number, source_created_at,
  customer_name, customer_phone, customer_email, customer_id_number,
  company_name, company_number, new_company_name, branch_name, deliver_branch_name,
  car_name, plate_number, car_category,
  start_date, start_time, original_end_date, original_end_time,
  end_date, end_time, extended_until_date, extended_until_time,
  days_count, extended_days_count, total_days_count,
  original_status_code, original_status_ar, pickup_type_ar, return_type_ar,
  payment_method, payment_status, daily_price, discount_amount, vat_amount,
  base_amount, extensions_count, extensions_amount, total_amount, has_extensions,
  internal_status, priority, assigned_employee_ids, assigned_employee_names,
  last_update_text, last_updated_by_id, last_updated_by_name, last_updated_at,
  has_problem, rejection_reason, car_status_at_request, refund_amount,
  rejected_by_id, rejected_by_name, rejected_at,
  cancellation_reason, cancelled_by_id, cancelled_by_name, cancelled_at,
  pinned_note, pinned_note_by_id, pinned_note_by_name, pinned_note_updated_at, no_answer_count,
  created_at, updated_at, status_history
`;

function buildScopeDatePreFilterSql(scopeInfo: any): { whereSql: string; params: any[] } {
  const prefix = scopeInfo.scope === 'month' ? str(scopeInfo.ym) : (scopeInfo.year ? String(scopeInfo.year) : '');
  if (!prefix) return { whereSql: '', params: [] };
  return {
    whereSql: `WHERE (
      COALESCE(
        NULLIF(start_date, ''),
        NULLIF(source_created_at, ''),
        to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')
      ) LIKE $1
      OR COALESCE(NULLIF(start_date, ''), NULLIF(source_created_at, ''), '') !~ '^[0-9]{4}-'
    )`,
    params: [`${prefix}%`]
  };
}

export async function previewDeleteReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_settings');
  const scopeInfo = crmCore.normalizeDeleteReservationsScope(payload);
  const totRes = await executor.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM reservations`);
  const totalReservations = num(totRes.rows[0]?.cnt, 0);
  let count = 0;
  if (scopeInfo.scope === 'all') {
    count = totalReservations;
  } else {
    const pre = buildScopeDatePreFilterSql(scopeInfo);
    const rowsRes = await executor.query(
      `SELECT id, start_date, source_created_at, created_at FROM reservations ${pre.whereSql}`,
      pre.params
    );
    const mapped = rowsRes.rows.map((r: any) => ({
      id: str(r.id),
      startDate: str(r.start_date),
      sourceCreatedAt: str(r.source_created_at),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : str(r.created_at)
    }));
    count = crmCore.filterReservationsForDeleteScope(mapped, scopeInfo).length;
  }
  return {
    count,
    totalReservations,
    scope: scopeInfo.scope,
    year: scopeInfo.year,
    month: scopeInfo.month,
    ym: scopeInfo.ym,
    periodLabelAr: scopeInfo.periodLabelAr,
    periodLabelEn: scopeInfo.periodLabelEn
  };
}

export async function deleteAllReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_settings');
  const scopeInfo = crmCore.normalizeDeleteReservationsScope(payload);
  const check = crmCore.validateDeleteAllReservationsConfirmation(payload);
  if (!check.valid) {
    throw new Error(`VALIDATION_ERROR: ${check.message}`);
  }

  const out = await executor.withTransaction(async (tx) => {
    const empRes = await tx.query(
      `SELECT id, password_hash, salt FROM employees WHERE id = $1 LIMIT 1`,
      [session.employeeId]
    );
    const empRow = empRes.rows[0];
    if (!empRow) {
      throw new Error('UNAUTHORIZED: تعذر التحقق من حساب المستخدم الحالي.');
    }
    const expectedHash = hashPassword(String(payload.password || ''), str(empRow.salt));
    if (expectedHash !== str(empRow.password_hash)) {
      throw new Error('VALIDATION_ERROR: كلمة المرور المدخلة غير صحيحة.');
    }

    const pre = scopeInfo.scope === 'all' ? { whereSql: '', params: [] } : buildScopeDatePreFilterSql(scopeInfo);
    const allRowsRes = await tx.query(
      `SELECT ${RESERVATION_CLIENT_COLUMNS} FROM reservations ${pre.whereSql} ORDER BY updated_at DESC`,
      pre.params
    );
    const allMapped = allRowsRes.rows.map((r: any) => mapReservationRowToClient(r, false));
    const targets = scopeInfo.scope === 'all'
      ? allMapped
      : crmCore.filterReservationsForDeleteScope(allMapped, scopeInfo);
    const targetIds = targets.map((t: any) => str(t.id)).filter(Boolean);
    const deletedCount = targetIds.length;

    if (scopeInfo.scope === 'all') {
      await runTxOptional(tx, 'clr_prb_all', () => tx.query(`UPDATE problems SET reservation_id = NULL WHERE reservation_id IS NOT NULL`), undefined);
      await runTxOptional(tx, 'clr_iss_all', () => tx.query(`UPDATE issues SET reservation_id = NULL WHERE reservation_id IS NOT NULL`), undefined);
      await tx.query(`DELETE FROM follow_up_history`);
      await tx.query(`DELETE FROM follow_ups`);
      await tx.query(`DELETE FROM assignments`);
      await tx.query(`DELETE FROM extensions`);
      await tx.query(`DELETE FROM reservations`);
      await runTxOptional(
        tx,
        'clr_sync_cp',
        () => tx.query(`UPDATE sync_checkpoints SET last_cursor = '', last_batch_count = 0, last_status = 'cleared', meta = '{}'::jsonb, updated_at = NOW()`),
        undefined
      );
      await recordSyncTombstone(tx, 'reservation_clear_all', ['ALL'], { scope: 'all', deletedCount });
    } else if (deletedCount > 0) {
      await runTxOptional(tx, 'clr_prb_scope', () => tx.query(`UPDATE problems SET reservation_id = NULL WHERE reservation_id = ANY($1::text[])`, [targetIds]), undefined);
      await runTxOptional(tx, 'clr_iss_scope', () => tx.query(`UPDATE issues SET reservation_id = NULL WHERE reservation_id = ANY($1::text[])`, [targetIds]), undefined);
      await tx.query(`DELETE FROM follow_up_history WHERE reservation_id = ANY($1::text[])`, [targetIds]);
      await tx.query(`DELETE FROM follow_ups WHERE reservation_id = ANY($1::text[])`, [targetIds]);
      await tx.query(`DELETE FROM assignments WHERE reservation_id = ANY($1::text[])`, [targetIds]);
      await tx.query(`DELETE FROM extensions WHERE reservation_id = ANY($1::text[])`, [targetIds]);
      await tx.query(`DELETE FROM reservations WHERE id = ANY($1::text[])`, [targetIds]);
      await recordSyncTombstone(tx, 'reservation', targetIds, { scope: scopeInfo.scope });
    }

    const scopeEntityKey = scopeInfo.scope === 'all' ? 'ALL' : (scopeInfo.ym || String(scopeInfo.year || 'SCOPE'));
    await logActivity(
      tx,
      session.user,
      scopeInfo.scope === 'all' ? 'حذف جميع الحجوزات' : `حذف حجوزات (${scopeInfo.periodLabelAr})`,
      'Reservation',
      scopeEntityKey,
      `حذف حجوزات (${scopeInfo.periodLabelAr}) نهائياً (${deletedCount} حجز) بواسطة ${session.user.name}`
    );
    await enqueueSheetsMirror(tx, 'Reservation', scopeEntityKey, 'deleteAllReservations', {
      deletedBy: session.user.name,
      deletedCount,
      scope: scopeInfo.scope,
      periodLabel: scopeInfo.periodLabelAr
    });

    return {
      deleted: true,
      scope: scopeInfo.scope,
      year: scopeInfo.year,
      month: scopeInfo.month,
      ym: scopeInfo.ym,
      periodLabelAr: scopeInfo.periodLabelAr,
      deletedReservationsCount: deletedCount,
      exportedRows: targets
    };
  });

  facetsCacheByExec.delete(executor);
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return out;
}

export async function importReservationsFromExcel(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  if (!crmCore.canUserPerform(session.user, 'pull_reservations') && !crmCore.canUserPerform(session.user, 'manage_settings')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية استيراد الحجوزات.');
  }
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) {
    throw new Error('VALIDATION_ERROR: ملف Excel لا يحتوي على صفوف للاستيراد.');
  }

  const candidateResNums = Array.from(
    new Set(
      rawRows
        .map((row: any) => {
          if (!row || typeof row !== 'object') return '';
          const v =
            row.reservationNumber ??
            row.reservation_number ??
            row['رقم الحجز'] ??
            row['رقم العقد'] ??
            row['Reservation #'] ??
            row['Reservation No'] ??
            row['Booking #'] ??
            row['Booking Number'] ??
            row['Res No'] ??
            row['المرجع'] ??
            '';
          return crmCore.convertEasternDigitsToAscii(str(v)).toLowerCase();
        })
        .filter(Boolean)
    )
  );

  const out = await executor.withTransaction(async (tx) => {
    let existingList: Record<string, any>[] = [];
    if (candidateResNums.length > 0) {
      const existingRes = await tx.query(
        `SELECT ${RESERVATION_CLIENT_COLUMNS} FROM reservations WHERE LOWER(TRIM(reservation_number)) = ANY($1::text[])`,
        [candidateResNums]
      );
      existingList = existingRes.rows.map((r: any) => mapReservationRowToClient(r, false));
    }
    const parsed = crmCore.parseImportedReservationRows(rawRows, existingList, session.user);
    if (!parsed.validRows.length) {
      throw new Error('VALIDATION_ERROR: لم يتم العثور على صفوف حجوزات صالحة داخل الملف.');
    }

    const rowsToSave = parsed.validRows;
    for (let start = 0; start < rowsToSave.length; start += 200) {
      const chunk = rowsToSave.slice(start, start + 200);
      await tx.query(
        `INSERT INTO reservations (
           id, source_reservation_id, reservation_number, source_created_at,
           customer_name, customer_phone, customer_email, customer_id_number,
           company_name, branch_name, deliver_branch_name, car_name, plate_number, car_category,
           start_date, start_time, original_end_date, original_end_time, end_date, end_time,
           extended_until_date, extended_until_time, days_count, extended_days_count, total_days_count,
           original_status_code, original_status_ar, pickup_type_ar, return_type_ar,
           payment_method, payment_status, daily_price, discount_amount, vat_amount,
           base_amount, extensions_count, extensions_amount, total_amount, has_extensions,
           internal_status, priority, assigned_employee_ids, assigned_employee_names,
           last_update_text, last_updated_by_id, last_updated_by_name, last_updated_at,
           has_problem, created_at, updated_at, status_history, raw_json
         )
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[],
           $5::text[], $6::text[], $7::text[], $8::text[],
           $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[],
           $15::text[], $16::text[], $17::text[], $18::text[], $19::text[], $20::text[],
           $21::text[], $22::text[], $23::int4[], $24::int4[], $25::int4[],
           $26::text[], $27::text[], $28::text[], $29::text[],
           $30::text[], $31::text[], $32::numeric[], $33::numeric[], $34::numeric[],
           $35::numeric[], $36::int4[], $37::numeric[], $38::numeric[], $39::boolean[],
           $40::text[], $41::text[], $42::jsonb[], $43::jsonb[],
           $44::text[], $45::text[], $46::text[], $47::text[],
           $48::boolean[], $49::timestamptz[], $50::timestamptz[], $51::jsonb[], $52::text[]
         )
         ON CONFLICT (reservation_number) DO UPDATE SET
           customer_name = EXCLUDED.customer_name,
           customer_phone = EXCLUDED.customer_phone,
           customer_email = EXCLUDED.customer_email,
           customer_id_number = EXCLUDED.customer_id_number,
           company_name = EXCLUDED.company_name,
           branch_name = EXCLUDED.branch_name,
           deliver_branch_name = EXCLUDED.deliver_branch_name,
           car_name = EXCLUDED.car_name,
           plate_number = EXCLUDED.plate_number,
           car_category = EXCLUDED.car_category,
           start_date = EXCLUDED.start_date,
           start_time = EXCLUDED.start_time,
           original_end_date = EXCLUDED.original_end_date,
           original_end_time = EXCLUDED.original_end_time,
           end_date = EXCLUDED.end_date,
           end_time = EXCLUDED.end_time,
           extended_until_date = EXCLUDED.extended_until_date,
           extended_until_time = EXCLUDED.extended_until_time,
           days_count = EXCLUDED.days_count,
           extended_days_count = EXCLUDED.extended_days_count,
           total_days_count = EXCLUDED.total_days_count,
           original_status_ar = EXCLUDED.original_status_ar,
           payment_method = EXCLUDED.payment_method,
           payment_status = EXCLUDED.payment_status,
           daily_price = EXCLUDED.daily_price,
           discount_amount = EXCLUDED.discount_amount,
           vat_amount = EXCLUDED.vat_amount,
           base_amount = EXCLUDED.base_amount,
           extensions_count = EXCLUDED.extensions_count,
           extensions_amount = EXCLUDED.extensions_amount,
           total_amount = EXCLUDED.total_amount,
           has_extensions = EXCLUDED.has_extensions,
           internal_status = EXCLUDED.internal_status,
           priority = EXCLUDED.priority,
           last_update_text = EXCLUDED.last_update_text,
           last_updated_by_id = EXCLUDED.last_updated_by_id,
           last_updated_by_name = EXCLUDED.last_updated_by_name,
           last_updated_at = EXCLUDED.last_updated_at,
           updated_at = EXCLUDED.updated_at,
           status_history = EXCLUDED.status_history`,
        [
          chunk.map((r: any) => str(r.id)),
          chunk.map((r: any) => str(r.sourceReservationId)),
          chunk.map((r: any) => str(r.reservationNumber)),
          chunk.map((r: any) => str(r.sourceCreatedAt)),
          chunk.map((r: any) => str(r.customerName)),
          chunk.map((r: any) => str(r.customerPhone)),
          chunk.map((r: any) => str(r.customerEmail)),
          chunk.map((r: any) => str(r.customerIdNumber)),
          chunk.map((r: any) => str(r.companyName)),
          chunk.map((r: any) => str(r.branchName)),
          chunk.map((r: any) => str(r.deliverBranchName)),
          chunk.map((r: any) => str(r.carName)),
          chunk.map((r: any) => str(r.plateNumber)),
          chunk.map((r: any) => str(r.carCategory)),
          chunk.map((r: any) => str(r.startDate)),
          chunk.map((r: any) => str(r.startTime)),
          chunk.map((r: any) => str(r.originalEndDate)),
          chunk.map((r: any) => str(r.originalEndTime)),
          chunk.map((r: any) => str(r.endDate)),
          chunk.map((r: any) => str(r.endTime)),
          chunk.map((r: any) => str(r.extendedUntilDate)),
          chunk.map((r: any) => str(r.extendedUntilTime)),
          chunk.map((r: any) => Math.max(1, Math.round(num(r.daysCount, 1)))),
          chunk.map((r: any) => Math.max(0, Math.round(num(r.extendedDaysCount, 0)))),
          chunk.map((r: any) => Math.max(1, Math.round(num(r.totalDaysCount, 1)))),
          chunk.map((r: any) => str(r.originalStatusCode || 'excel_import')),
          chunk.map((r: any) => str(r.originalStatusAr)),
          chunk.map((r: any) => str(r.pickupTypeAr)),
          chunk.map((r: any) => str(r.returnTypeAr)),
          chunk.map((r: any) => str(r.paymentMethod)),
          chunk.map((r: any) => str(r.paymentStatus)),
          chunk.map((r: any) => num(r.dailyPrice, 0)),
          chunk.map((r: any) => num(r.discountAmount, 0)),
          chunk.map((r: any) => num(r.vatAmount, 0)),
          chunk.map((r: any) => num(r.baseAmount, 0)),
          chunk.map((r: any) => Math.max(0, Math.round(num(r.extensionsCount, 0)))),
          chunk.map((r: any) => num(r.extensionsAmount, 0)),
          chunk.map((r: any) => num(r.totalAmount, 0)),
          chunk.map((r: any) => Boolean(r.hasExtensions)),
          chunk.map((r: any) => str(r.internalStatus)),
          chunk.map((r: any) => str(r.priority || 'عادي')),
          chunk.map((r: any) => JSON.stringify(Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [])),
          chunk.map((r: any) => JSON.stringify(Array.isArray(r.assignedEmployeeNames) ? r.assignedEmployeeNames : [])),
          chunk.map((r: any) => str(r.lastUpdateText)),
          chunk.map((r: any) => str(r.lastUpdatedById)),
          chunk.map((r: any) => str(r.lastUpdatedByName)),
          chunk.map((r: any) => str(r.lastUpdatedAt)),
          chunk.map((r: any) => Boolean(r.hasProblem)),
          chunk.map((r: any) => str(r.createdAt || new Date().toISOString())),
          chunk.map((r: any) => str(r.updatedAt || new Date().toISOString())),
          chunk.map((r: any) => JSON.stringify(Array.isArray(r.statusHistory) ? r.statusHistory : [])),
          chunk.map((r: any) => JSON.stringify({ importedFromExcel: true }))
        ]
      );
    }

    await upsertCustomersFromReservationsTx(tx, rowsToSave, {
      source: 'excel_import',
      overwriteProfileFields: false
    });

    await logActivity(
      tx,
      session.user,
      'استيراد حجوزات من Excel',
      'Reservation',
      'EXCEL',
      `استيراد ${parsed.newCount} حجز جديد وتحديث ${parsed.updateCount} حجز من Excel (${parsed.skippedRows} صفوف متخطاة)`
    );

    return {
      importedCount: parsed.newCount,
      updatedCount: parsed.updateCount,
      skippedCount: parsed.skippedRows,
      totalProcessed: rowsToSave.length,
      errors: parsed.errors
    };
  });

  facetsCacheByExec.delete(executor);
  return out;
}

function buildWorkerTelemetrySummary(
  workerRow: Record<string, any> | null,
  syncCfg: ReturnType<typeof normalizeAutoSyncConfig>,
  logs: Array<Record<string, any>>
) {
  const isoOrEmpty = (v: unknown): string => {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    const s = str(v);
    return s;
  };
  const latestLog = logs[0] || null;
  const lastSuccessLog = logs.find((l) => l.status === 'success' || l.status === 'partial') || null;
  const isSyncing = Boolean(
    workerRow?.is_syncing &&
    (!workerRow?.lock_expires_at || Date.parse(String(workerRow.lock_expires_at)) > Date.now())
  );
  const consecutiveErrors = num(workerRow?.consecutive_errors, 0);
  const lastError = str(workerRow?.last_error || (latestLog?.status === 'error' ? latestLog?.errorMessage : ''));
  const status = deriveWorkerStatus({
    enabled: syncCfg.enabled,
    isSyncing,
    consecutiveErrors,
    lastError
  });
  const lastRunAt = isoOrEmpty(workerRow?.last_run_at) || isoOrEmpty(latestLog?.startedAt || latestLog?.finishedAt);
  const lastSuccessAt = isoOrEmpty(workerRow?.last_success_at) || isoOrEmpty(lastSuccessLog?.finishedAt);
  const nextRunAtRaw = syncCfg.enabled
    ? (isoOrEmpty(workerRow?.next_run_at) ||
        computeNextScheduledRunAt({
          enabled: true,
          intervalSeconds: syncCfg.intervalSeconds,
          nowMs: Date.now(),
          lastRunAt: lastRunAt || null,
          consecutiveErrors,
          reason: 'startup'
        }))
    : null;

  return {
    status,
    isSyncing,
    autoSyncEnabled: syncCfg.enabled,
    intervalSeconds: syncCfg.intervalSeconds,
    intervalValue: syncCfg.value,
    intervalUnit: syncCfg.unit,
    lastRunAt,
    lastSuccessAt,
    nextRunAt: nextRunAtRaw,
    lastDurationMs: num(workerRow?.last_duration_ms, latestLog ? num(latestLog.durationMs, 0) : 0),
    importedCount: workerRow?.last_run_at ? num(workerRow?.last_imported_count, 0) : num(latestLog?.importedCount, 0),
    updatedCount: workerRow?.last_run_at ? num(workerRow?.last_updated_count, 0) : num(latestLog?.updatedCount, 0),
    extensionsCount: workerRow?.last_run_at ? num(workerRow?.last_extensions_count, 0) : num(latestLog?.extensionsCount, 0),
    errorCount: num(workerRow?.error_count, logs.filter((l) => l.status === 'error').length),
    consecutiveErrors,
    lastError,
    lastTriggerType: str(workerRow?.last_trigger_type || ''),
    workerHeartbeatAt: isoOrEmpty(workerRow?.worker_heartbeat_at),
    updatedAt: isoOrEmpty(workerRow?.updated_at),
    runtimeWorkerActive: getAutoSyncWorkerRuntimeStatus().running
  };
}

export async function getSyncStatus(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const [logRes, ckRes, map, serverCfg, workerRow] = await Promise.all([
    executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20`),
    executor.query(`SELECT * FROM sync_checkpoints ORDER BY updated_at DESC LIMIT 5`),
    getSettingsMap(executor),
    resolveServerConfig(executor),
    readWorkerStateRow(executor)
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
    startedAt: s.started_at instanceof Date ? (isNaN(s.started_at.getTime()) ? '' : s.started_at.toISOString()) : str(s.started_at),
    finishedAt: s.finished_at instanceof Date ? (isNaN(s.finished_at.getTime()) ? '' : s.finished_at.toISOString()) : str(s.finished_at)
  }));
  const checkpoints = ckRes.rows.map((ck: any) => {
    let parsedMeta: any = null;
    try {
      parsedMeta = typeof ck.meta === 'string' ? JSON.parse(ck.meta) : (ck.meta || null);
    } catch {
      parsedMeta = null;
    }
    return {
      ...ck,
      meta: parsedMeta
    };
  });
  const primaryCheckpoint =
    checkpoints.find((c: any) => str(c.source) === 'rental_gate_direct') ||
    checkpoints[0] ||
    null;
  const syncCfg = normalizeAutoSyncConfig(map);
  const syncInterval = crmCore.normalizeAutoSyncInterval(
    map.auto_sync_interval_hours,
    map.auto_sync_interval_minutes
  );
  const worker = buildWorkerTelemetrySummary(workerRow, syncCfg, logs);
  return {
    hasToken: Boolean(serverCfg.rgToken || serverCfg.gasWebAppUrl),
    autoSyncEnabled: syncCfg.enabled,
    autoSyncIntervalSeconds: syncCfg.intervalSeconds,
    autoSyncIntervalValue: syncCfg.value,
    autoSyncIntervalUnit: syncCfg.unit,
    autoSyncIntervalHours: syncInterval.hours,
    autoSyncIntervalMinutes: syncInterval.minutes,
    workerStatus: worker.status,
    isSyncing: worker.isSyncing,
    lastRunAt: worker.lastRunAt,
    lastSuccessAt: worker.lastSuccessAt,
    nextRunAt: worker.nextRunAt,
    lastDurationMs: worker.lastDurationMs,
    errorCount: worker.errorCount,
    consecutiveErrors: worker.consecutiveErrors,
    lastError: worker.lastError,
    worker,
    lastSync: logs[0] || null,
    lastReconciliation: (primaryCheckpoint && primaryCheckpoint.meta) || null,
    lastCheckpointStatus: primaryCheckpoint ? str(primaryCheckpoint.last_status) : '',
    logs,
    checkpoints
  };
}

export async function getTriggerStatus(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const serverCfg = await resolveServerConfig(executor);
  const hasGasUrl = Boolean(serverCfg.gasWebAppUrl);
  return {
    count: hasGasUrl ? 1 : 0,
    triggers: hasGasUrl
      ? [{ id: 'NEON_HYBRID_SYNC', handler: 'scheduledMinuteSync', eventType: 'CLOCK' }]
      : []
  };
}

export async function getReports(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (!crmCore.canUserPerform(session.user, 'export_reports')) {
    requirePermission(session, 'export_reports');
  }
  const rType = str(payload.reportType || 'all_reservations');
  const settingsMapForReports = await getSettingsMap(executor);
  const statsCfgRep = typeof crmCore.normalizeStatsControlConfig === 'function'
    ? crmCore.normalizeStatsControlConfig(settingsMapForReports.stats_control_config)
    : { excludedFromStatsEmployeeIds: [] };
  const excludedStatsIdsRep = new Set<string>(statsCfgRep.excludedFromStatsEmployeeIds || []);
  const cacheKey = JSON.stringify({
    rType,
    status: str(payload.status),
    priority: str(payload.priority),
    company: str(payload.company),
    branch: str(payload.branch),
    employeeId: str(payload.employeeId),
    dateFrom: str(payload.dateFrom),
    dateTo: str(payload.dateTo),
    statsSig: Array.from(excludedStatsIdsRep).sort().join(',')
  });

  return getCachedOrLoad(
    executor,
    { scope: 'reports', key: cacheKey, ttlMs: 30000, bypassCache: toBool(payload.forceRefresh) },
    async () => {
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
      const facets = await getCachedReservationFacets(executor);

      if (rType === 'employee_performance') {
        const [empRes, resCountsRes, fuCountsRes, prbCountsRes] = await Promise.all([
          executor.query(`SELECT id, name, job_title, role, status, last_activity FROM employees ORDER BY created_at ASC`),
          executor.query<{ emp_id: string; cnt: number }>(
            `SELECT emp_id, COUNT(*)::int AS cnt
             FROM reservations r, LATERAL jsonb_array_elements_text(r.assigned_employee_ids) AS emp_id
             GROUP BY emp_id`
          ),
          executor.query<{ employee_id: string; cnt: number }>(
            `SELECT employee_id, COUNT(*)::int AS cnt FROM follow_ups GROUP BY employee_id`
          ),
          executor.query<{ emp_id: string; cnt: number }>(
            `SELECT emp_id, COUNT(*)::int AS cnt
             FROM problems p, LATERAL jsonb_array_elements_text(p.assigned_employee_ids) AS emp_id
             GROUP BY emp_id`
          )
        ]);
        const resMap = new Map(resCountsRes.rows.map((r) => [str(r.emp_id), num(r.cnt)]));
        const fuMap = new Map(fuCountsRes.rows.map((r) => [str(r.employee_id), num(r.cnt)]));
        const prbMap = new Map(prbCountsRes.rows.map((r) => [str(r.emp_id), num(r.cnt)]));
        const rows = empRes.rows
          .filter((e) => str(e.status || 'active') !== 'disabled' && !excludedStatsIdsRep.has(str(e.id)))
          .map((e) => ({
            employeeId: str(e.id),
            employeeName: str(e.name),
            jobTitle: str(e.job_title),
            role: str(e.role),
            assignedReservations: resMap.get(str(e.id)) || 0,
            followUpsCount: fuMap.get(str(e.id)) || 0,
            problemsCount: prbMap.get(str(e.id)) || 0,
            lastActivity: str(e.last_activity)
          }));
        return { reportType: rType, rows, facets };
      }

      if (rType === 'followups_log') {
        const fParams: any[] = [];
        const fClauses: string[] = [];
        if (payload.employeeId) { fParams.push(str(payload.employeeId)); fClauses.push(`employee_id = $${fParams.length}`); }
        if (payload.status) { fParams.push(str(payload.status)); fClauses.push(`status = $${fParams.length}`); }
        if (payload.dateFrom) { fParams.push(str(payload.dateFrom)); fClauses.push(`follow_up_date >= $${fParams.length}`); }
        if (payload.dateTo) { fParams.push(str(payload.dateTo)); fClauses.push(`follow_up_date <= $${fParams.length}`); }
        const fWhere = fClauses.length ? `WHERE ${fClauses.join(' AND ')}` : '';
        const fuRes = await executor.query(`SELECT * FROM follow_ups ${fWhere} ORDER BY created_at DESC LIMIT 1000`, fParams);
        return { reportType: rType, rows: fuRes.rows.map(formatFollowUpRow), facets };
      }

      if (rType === 'problems') {
        const pParams: any[] = [];
        const pClauses: string[] = [];
        if (payload.priority) { pParams.push(str(payload.priority)); pClauses.push(`priority = $${pParams.length}`); }
        if (payload.status) { pParams.push(str(payload.status)); pClauses.push(`status = $${pParams.length}`); }
        if (payload.employeeId) { pParams.push(JSON.stringify([str(payload.employeeId)])); pClauses.push(`assigned_employee_ids @> $${pParams.length}::jsonb`); }
        if (payload.dateFrom) { pParams.push(str(payload.dateFrom)); pClauses.push(`to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') >= $${pParams.length}`); }
        if (payload.dateTo) { pParams.push(str(payload.dateTo)); pClauses.push(`to_char(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') <= $${pParams.length}`); }
        const pWhere = pClauses.length ? `WHERE ${pClauses.join(' AND ')}` : '';
        const prbRes = await executor.query(`SELECT * FROM problems ${pWhere} ORDER BY updated_at DESC LIMIT 1000`, pParams);
        return { reportType: rType, rows: prbRes.rows.map((p) => formatProblemRow(p)), facets };
      }

      if (rType === 'extensions') {
        const eParams: any[] = [];
        const eClauses: string[] = [];
        if (payload.dateFrom) { eParams.push(str(payload.dateFrom)); eClauses.push(`start_date >= $${eParams.length}`); }
        if (payload.dateTo) { eParams.push(str(payload.dateTo)); eClauses.push(`start_date <= $${eParams.length}`); }
        if (payload.status) { eParams.push(str(payload.status)); eClauses.push(`(status_ar = $${eParams.length} OR status_code = $${eParams.length})`); }
        const eWhere = eClauses.length ? `WHERE ${eClauses.join(' AND ')}` : '';
        const extRes = await executor.query(`SELECT * FROM extensions ${eWhere} ORDER BY synced_at DESC LIMIT 1000`, eParams);
        return { reportType: rType, rows: extRes.rows.map(mapExtensionRowToClient), facets };
      }

      if (rType === 'sync_log') {
        const sRes = await executor.query(`SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 500`);
        return { reportType: rType, rows: sRes.rows, facets };
      }

      if (rType === 'activity_log') {
        const aParams: any[] = [];
        const aClauses: string[] = [];
        if (payload.employeeId) { aParams.push(str(payload.employeeId)); aClauses.push(`user_id = $${aParams.length}`); }
        if (payload.dateFrom) { aParams.push(str(payload.dateFrom)); aClauses.push(`log_date >= $${aParams.length}`); }
        if (payload.dateTo) { aParams.push(str(payload.dateTo)); aClauses.push(`log_date <= $${aParams.length}`); }
        const aWhere = aClauses.length ? `WHERE ${aClauses.join(' AND ')}` : '';
        const aRes = await executor.query(`SELECT * FROM activity_log ${aWhere} ORDER BY created_at DESC LIMIT 1000`, aParams);
        return { reportType: rType, rows: aRes.rows, facets };
      }

      if (rType === 'customers') {
        const custReportRes = await getCustomers(executor, session, {
          search: str(payload.search),
          status: str(payload.status),
          company: str(payload.company),
          dateFrom: str(payload.dateFrom),
          dateTo: str(payload.dateTo),
          page: 1,
          pageSize: 1000,
          forceRefresh: true
        });
        return {
          reportType: rType,
          rows: custReportRes.items || [],
          facets
        };
      }

      const resRows = await executor.query(
        `SELECT * FROM reservations r ${where} ORDER BY r.source_order ASC NULLS LAST LIMIT 2000`,
        params
      );
      return {
        reportType: rType,
        rows: redactReservationsList(resRows.rows.map((r) => mapReservationRowToClient(r, false)), session.user),
        facets
      };
    }
  );
}

export async function exportReportData(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'export_reports');
  const data = await getReports(executor, session, payload);
  await logActivity(executor, session.user, 'تصدير تقرير', 'Report', str(payload.reportType || 'all_reservations'), `تصدير ${data.rows.length} صف`);
  return data;
}

function safeParseGasJson(rawText: string, status: number): any {
  const trimmed = String(rawText || '').trim();
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error(`تعذر قراءة استجابة Google Apps Script كـ JSON (HTTP ${status || 0}).`);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`استجابة غير صالحة من Google Apps Script (HTTP ${status || 0}).`);
  }
}

function resolveDefaultSiteOrigin(explicitOrigin: unknown): string {
  const direct = str(explicitOrigin).replace(/\/+$/, '');
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const prodHost = str(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return prodHost ? `https://${prodHost}` : '';
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
  const rangePayload = payload?.preset || payload?.datePreset || payload?.dateFrom || payload?.dateTo
    ? (crmCore.canUserPerform(session.user, 'sync_data') || crmCore.canUserPerform(session.user, 'manage_settings')
        ? payload
        : {})
    : {};

  const serverCfg = await resolveServerConfig(executor);
  if (serverCfg.rgToken) {
    const result = await pullFromRentalGateDirect(executor, session.user, {
      ...rangePayload,
      triggerType: 'manual'
    });
    return {
      ...result,
      id: result.syncId,
      triggeredById: session.user.id,
      triggeredByName: session.user.name
    };
  }

  // Fallback delegation to Google Apps Script Web App if configured in DB or env
  const gasUrl = str(serverCfg.gasWebAppUrl);
  if (gasUrl) {
    const syncSecret = await ensureSyncApiSecret(executor, session.user.name);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 50000) : null;
    try {
      const resp = await fetch(gasUrl, {
        method: 'POST',
        redirect: 'follow',
        signal: ctrl?.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'triggerNeonIncrementalSync',
          payload: { syncSecret, ...rangePayload, actor: { id: session.user.id, name: session.user.name, role: session.user.role } }
        })
      });
      const text = await resp.text();
      const parsed = safeParseGasJson(text, resp.status);
      if (!parsed?.success) {
        throw new Error(parsed?.message || 'فشلت المزامنة عبر Google Apps Script.');
      }
      return parsed.data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new Error('NO_RG_TOKEN: يرجى ضبط متغير RG_TOKEN أو GAS_WEBAPP_URL في إعدادات بيئة الخادم (.env / Vercel).');
}

export async function retryFailedSyncRecordsAction(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  if (!crmCore.canUserPerform(session.user, 'pull_reservations') && !crmCore.canUserPerform(session.user, 'sync_data')) {
    requirePermission(session, 'pull_reservations');
  }
  const serverCfg = await resolveServerConfig(executor);
  if (!serverCfg.rgToken) {
    throw new Error('NO_RG_TOKEN: يتطلب إعادة معالجة السجلات الفاشلة/الناقصة وجود توكن Rental Gate مباشر على الخادم (RG_TOKEN).');
  }
  const result = await retryFailedSyncRecords(executor, session.user, payload);
  return {
    ...result,
    id: result.syncId,
    triggeredById: session.user.id,
    triggeredByName: session.user.name
  };
}

export async function saveGlobalConnectionSettings(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_settings');
  let gasUrl = str(payload.gasWebAppUrl || payload.gasUrl || '');
  if (gasUrl) {
    if (crmCore && typeof crmCore.validateGasUrl === 'function') {
      const check = crmCore.validateGasUrl(gasUrl);
      if (!check.valid) {
        throw new Error(`VALIDATION_ERROR: ${check.message}`);
      }
      gasUrl = check.normalized;
    }
  }

  await upsertServerSetting(executor, 'gas_webapp_url', gasUrl, session.user.name);
  const syncSecret = await ensureSyncApiSecret(executor, session.user.name);
  const serverCfg = await resolveServerConfig(executor);

  const rawOrigin = resolveDefaultSiteOrigin(payload.siteOrigin);
  const neonSyncUrl = rawOrigin ? `${rawOrigin}/api/sync` : '';

  let autoBoundGas = false;
  let autoBindMessage = '';

  if (gasUrl) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 8000) : null;
    try {
      const resp = await fetch(gasUrl, {
        method: 'POST',
        redirect: 'follow',
        signal: ctrl?.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'autoBindFromServer',
          payload: {
            syncSecret,
            neonSyncUrl,
            rgToken: serverCfg.rgToken || '',
            autoEveryMinute: true
          }
        })
      });
      const text = await resp.text();
      const parsed = safeParseGasJson(text, resp.status);
      if (resp.ok && parsed && parsed.success) {
        autoBoundGas = true;
        autoBindMessage = 'تم حفظ الرابط في القاعدة وربط Google Apps Script تلقائيًا للجميع.';
      } else {
        autoBindMessage = str(parsed?.message || 'تم حفظ الرابط في القاعدة. لإكمال الربط التلقائي مع Apps Script احفظ RG_TOKEN أولًا أو نفّذ setNeonSyncProperties.');
      }
    } catch (err: any) {
      autoBindMessage = `تم حفظ الرابط عالميًا لكل المستخدمين؛ تعذر الوصول التلقائي لـ Apps Script حاليًا (${str(err?.message || 'NETWORK')}).`;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    autoBindMessage = 'تم مسح رابط Apps Script العام من إعدادات الخادم.';
  }

  await logActivity(
    executor,
    session.user,
    'تحديث الربط التلقائي العام',
    'Settings',
    'gas_webapp_url',
    gasUrl ? `تفعيل الربط التلقائي العام مع Apps Script (${autoBoundGas ? 'ثنائي الاتجاه' : 'محفوظ في Neon'})` : 'إلغاء رابط Apps Script العام'
  );

  invalidateScopes(executor, ['settings']);
  return {
    saved: true,
    gasWebAppUrl: gasUrl,
    neonSyncUrl,
    hasSyncSecret: Boolean(syncSecret),
    hasRgToken: Boolean(serverCfg.rgToken || gasUrl),
    autoBoundGas,
    message: autoBindMessage
  };
}

export async function saveApiToken(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  requirePermission(session, 'manage_settings');
  const rawToken = str(payload.token || payload.rgToken).replace(/^Bearer\s+/i, '');
  if (!rawToken || rawToken.length < 15) {
    throw new Error('VALIDATION_ERROR: التوكن غير صالح.');
  }

  // Persist AES-256-GCM encrypted token inside Neon settings table so it works across all serverless instances & restarts
  await upsertServerSetting(executor, 'rg_token_enc', encryptServerSecret(rawToken), session.user.name);
  process.env.RG_TOKEN = rawToken;

  const syncSecret = await ensureSyncApiSecret(executor, session.user.name);
  const serverCfg = await resolveServerConfig(executor);
  const gasUrl = str(serverCfg.gasWebAppUrl);
  const rawOrigin = resolveDefaultSiteOrigin(payload.siteOrigin);
  const neonSyncUrl = rawOrigin ? `${rawOrigin}/api/sync` : '';

  if (gasUrl && syncSecret) {
    await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'autoBindFromServer',
        payload: {
          syncSecret,
          neonSyncUrl,
          rgToken: rawToken,
          autoEveryMinute: true
        }
      })
    }).catch(() => undefined);
  }

  let connection: any = null;
  if (payload.testAfterSave) {
    connection = await testRentalGateConnection(executor, session).catch(() => null);
  }

  invalidateScopes(executor, ['settings']);
  await logActivity(executor, session.user, 'تحديث توكن Rental Gate', 'Settings', 'RG_TOKEN', 'تم تشفير التوكن وحفظه بأمان في قاعدة البيانات السحابية للربط التلقائي');
  return { saved: true, hasRgToken: true, hasDirectToken: true, connection };
}

export async function testDatabaseHealth(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const startedAt = Date.now();
  const serverCfg = await resolveServerConfig(executor);
  const dbCheck = await executor.query<{ ok: number }>(`SELECT 1 AS ok`);
  const countsRes = await executor.query<{ res_cnt: string; emp_cnt: string; sync_cnt: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM reservations) AS res_cnt,
       (SELECT COUNT(*)::text FROM employees) AS emp_cnt,
       (SELECT COUNT(*)::text FROM sync_log) AS sync_cnt`
  );
  const latencyMs = Math.max(1, Date.now() - startedAt);
  const row = countsRes.rows[0] || { res_cnt: '0', emp_cnt: '0', sync_cnt: '0' };
  const ok = Boolean(dbCheck.rows[0] && Number(dbCheck.rows[0].ok) === 1);
  return {
    connected: ok,
    configured: true,
    latencyMs,
    mode: serverCfg.mode || 'neon',
    hasGasUrl: Boolean(serverCfg.gasWebAppUrl),
    hasRgToken: Boolean(serverCfg.rgToken),
    reservationsCount: Number(row.res_cnt || 0),
    employeesCount: Number(row.emp_cnt || 0),
    syncLogsCount: Number(row.sync_cnt || 0),
    message: ok
      ? `اتصال Neon PostgreSQL ناجح (${latencyMs}ms) — الحجوزات: ${row.res_cnt || 0} · الموظفون: ${row.emp_cnt || 0}.`
      : 'تعذر التحقق من استجابة قاعدة بيانات Neon PostgreSQL.'
  };
}

export async function testRentalGateConnection(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const serverCfg = await resolveServerConfig(executor);
  const rgToken = str(serverCfg.rgToken).replace(/^Bearer\s+/i, '');
  const gasUrl = str(serverCfg.gasWebAppUrl);
  if (!rgToken) {
    return {
      connected: Boolean(gasUrl),
      statusCode: 0,
      hasToken: Boolean(gasUrl),
      message: gasUrl
        ? 'الربط يعمل عبر Google Apps Script المضبوط على الخادم.'
        : 'متغير RG_TOKEN غير مضبوط في إعدادات بيئة الخادم (.env / Vercel).'
    };
  }
  const baseApi = str(serverCfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
  const resp = await fetch(`${baseApi}/reservations/filter?page=0&size=1`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${rgToken}`, Accept: 'application/json', lang: 'ar' }
  });
  let parsed: any = null;
  let totalElements = 0;
  let sampleCount = 0;
  try {
    const raw = await resp.text();
    parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const pageInfo = extractRentalGatePagePayload(parsed, 0, 1);
      sampleCount = pageInfo.rows.length;
      totalElements = pageInfo.totalElements;
    }
  } catch {
    parsed = null;
  }
  const apiRejected = Boolean(parsed && !Array.isArray(parsed) && parsed.success === false && !parsed.data && !parsed.content && !parsed.items);
  const ok = resp.ok && !apiRejected && parsed !== null;
  return {
    connected: ok,
    statusCode: resp.status,
    hasToken: true,
    sampleCount,
    totalElements,
    message: ok
      ? `الاتصال بواجهة Rental Gate API يعمل بنجاح (${totalElements > 0 ? `إجمالي الحجوزات بالمنصة: ${totalElements}` : `عينة الفحص: ${sampleCount}`}).`
      : (apiRejected && parsed?.message ? String(parsed.message) : `فشل الاتصال (HTTP ${resp.status})`)
  };
}

// ---------- SHIFT ANNOUNCEMENTS BANNER ----------

function formatAnnouncementRow(row: any): Record<string, any> {
  return {
    id: str(row.id),
    title: str(row.title),
    message: str(row.message),
    tone: str(row.tone || 'warning'),
    isPinned: Boolean(row.is_pinned),
    isActive: Boolean(row.is_active),
    startsAt: str(row.starts_at),
    expiresAt: str(row.expires_at),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    createdByRole: str(row.created_by_role),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
  };
}

function isAnnouncementCurrentlyActive(item: Record<string, any>, nowMs: number = Date.now()): boolean {
  if (!item || !item.isActive) return false;
  if (item.startsAt) {
    const s = Date.parse(item.startsAt);
    if (!isNaN(s) && nowMs < s) return false;
  }
  if (item.expiresAt) {
    const e = Date.parse(item.expiresAt);
    if (!isNaN(e) && nowMs > e) return false;
  }
  return true;
}

export async function getAnnouncements(executor: DbExecutor, _session: AuthSession) {
  const items = await getCachedOrLoad(
    executor,
    { scope: 'announcements', key: 'all', ttlMs: 20000 },
    async () => {
      const res = await executor.query(
        `SELECT * FROM shift_announcements ORDER BY is_pinned DESC, updated_at DESC LIMIT 50`
      );
      return res.rows.map(formatAnnouncementRow);
    }
  );
  const nowMs = Date.now();
  const activeItems = items.filter((it) => isAnnouncementCurrentlyActive(it, nowMs));
  return { items, activeItems };
}

export async function saveAnnouncement(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (!crmCore.isPrivilegedRole(session.user.role) && session.user.role !== 'supervisor') {
    throw new Error('FORBIDDEN: إدارة تعميمات وإعلانات الوردية متاحة للمبرمج والمشرف والمدير العام فقط.');
  }
  const title = str(payload.title);
  const message = str(payload.message);
  if (!message) {
    throw new Error('VALIDATION_ERROR: نص التعميم أو التنبيه مطلوب.');
  }
  const toneRaw = str(payload.tone || 'warning').toLowerCase();
  const tone = (toneRaw === 'info' || toneRaw === 'danger' || toneRaw === 'warning') ? toneRaw : 'warning';
  const isPinned = payload.isPinned !== undefined ? Boolean(payload.isPinned) : true;
  const isActive = payload.isActive !== undefined ? Boolean(payload.isActive) : true;
  const startsAt = str(payload.startsAt);
  const expiresAt = str(payload.expiresAt);
  const annId = str(payload.id) || generateId('ANN');

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO shift_announcements (id, title, message, tone, is_pinned, is_active, starts_at, expires_at, created_by_id, created_by_name, created_by_role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         tone = EXCLUDED.tone,
         is_pinned = EXCLUDED.is_pinned,
         is_active = EXCLUDED.is_active,
         starts_at = EXCLUDED.starts_at,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [annId, title, message, tone, isPinned, isActive, startsAt, expiresAt, session.user.id, session.user.name, session.user.role]
    );
    await logActivity(tx, session.user, 'نشر تعميم وردية', 'Announcement', annId, `${title ? `${title}: ` : ''}${message.slice(0, 120)}`);
  });

  invalidateScopes(executor, ['announcements', 'dashboard']);
  const data = await getAnnouncements(executor, session);
  const saved = data.items.find((it) => it.id === annId) || null;
  return { announcement: saved, items: data.items, activeItems: data.activeItems };
}

export async function deleteAnnouncement(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (!crmCore.isPrivilegedRole(session.user.role) && session.user.role !== 'supervisor') {
    throw new Error('FORBIDDEN: حذف تعميمات الوردية متاح للمبرمج والمشرف والمدير العام فقط.');
  }
  const annId = str(payload.id || payload.announcementId);
  if (!annId) throw new Error('VALIDATION_ERROR: معرف التعميم مطلوب.');

  await executor.query(`DELETE FROM shift_announcements WHERE id = $1`, [annId]);
  await recordSyncTombstone(executor, 'announcement', [annId]);
  await logActivity(executor, session.user, 'حذف تعميم وردية', 'Announcement', annId, 'تم حذف تعميم الوردية');
  invalidateScopes(executor, ['announcements', 'dashboard']);
  const data = await getAnnouncements(executor, session);
  return { deleted: true, items: data.items, activeItems: data.activeItems };
}

// ---------- TEMPORARY SUPERVISOR DELEGATIONS ----------

function formatDelegationRow(row: any, nowMs: number = Date.now()): Record<string, any> {
  const item = {
    id: str(row.id),
    delegateEmployeeId: str(row.delegate_employee_id),
    delegateEmployeeName: str(row.delegate_employee_name),
    delegatedRole: str(row.delegated_role || 'supervisor'),
    grantedById: str(row.granted_by_id),
    grantedByName: str(row.granted_by_name),
    reason: str(row.reason),
    startsAt: str(row.starts_at),
    expiresAt: str(row.expires_at),
    status: str(row.status || 'active'),
    revokedAt: str(row.revoked_at),
    revokedById: str(row.revoked_by_id),
    revokedByName: str(row.revoked_by_name),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
  };
  return {
    ...item,
    isActiveNow: crmCore.isDelegationActive(item, nowMs)
  };
}

export async function getDelegations(executor: DbExecutor, session: AuthSession) {
  const canManage = crmCore.isPrivilegedRole(session.user.role) || crmCore.canUserPerform(session.user, 'manage_employees') || crmCore.canUserPerform(session.user, 'view_employees');
  const res = canManage
    ? await executor.query(`SELECT * FROM employee_delegations ORDER BY created_at DESC LIMIT 100`)
    : await executor.query(`SELECT * FROM employee_delegations WHERE delegate_employee_id = $1 ORDER BY created_at DESC LIMIT 20`, [session.user.id]);
  const nowMs = Date.now();
  return {
    items: res.rows.map((r) => formatDelegationRow(r, nowMs))
  };
}

export async function saveDelegation(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (!crmCore.isPrivilegedRole(session.user.role) && !crmCore.canUserPerform(session.user, 'manage_employees')) {
    throw new Error('FORBIDDEN: منح تفويض الصلاحيات المؤقت متاح للمدير العام أو مسؤول إدارة الموظفين فقط.');
  }
  const empId = str(payload.delegateEmployeeId);
  const startsAt = str(payload.startsAt) || new Date().toISOString();
  const expiresAt = str(payload.expiresAt);
  const reason = str(payload.reason) || 'تفويض صلاحية مشرف بديل مؤقت';
  if (!empId || !expiresAt) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد الموظف البديل وتاريخ/وقت انتهاء التفويض.');
  }
  const sMs = Date.parse(startsAt);
  const eMs = Date.parse(expiresAt);
  if (isNaN(eMs) || (!isNaN(sMs) && eMs <= sMs)) {
    throw new Error('VALIDATION_ERROR: يجب أن يكون موعد انتهاء التفويض بعد موعد البداية.');
  }

  return runWithIdempotency(executor, session.user.id, 'saveDelegation', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const empRes = await tx.query(`SELECT id, name, role, status FROM employees WHERE id = $1 LIMIT 1`, [empId]);
      const targetEmp = empRes.rows[0];
      if (!targetEmp) throw new Error('NOT_FOUND: الموظف المحدد غير موجود.');
      if (str(targetEmp.status || 'active') !== 'active') {
        throw new Error('VALIDATION_ERROR: لا يمكن تفويض حساب موقوف.');
      }

      const delId = generateId('DEL');
      await tx.query(
        `INSERT INTO employee_delegations (id, delegate_employee_id, delegate_employee_name, delegated_role, granted_by_id, granted_by_name, reason, starts_at, expires_at, status, revoked_at, created_at, updated_at)
         VALUES ($1,$2,$3,'supervisor',$4,$5,$6,$7,$8,'active','',NOW(),NOW())`,
        [delId, targetEmp.id, targetEmp.name, session.user.id, session.user.name, reason, startsAt, expiresAt]
      );

      await createNotification(tx, {
        recipientEmployeeId: targetEmp.id,
        type: 'delegation',
        title: 'تم منحك صلاحية مشرف مؤقتة',
        message: `منحك ${session.user.name} صلاحية المشرف مؤقتًا حتى ${crmCore.formatDisplayDateTime(expiresAt)} (${reason}).`,
        entityType: 'Employee',
        entityId: targetEmp.id,
        eventKey: buildNotificationEventKey(['delegation', str(payload.clientRequestId) || delId, targetEmp.id])
      });

      await logActivity(
        tx,
        session.user,
        'تفويض صلاحيات مؤقت',
        'Employee',
        targetEmp.name,
        `تفويض ${targetEmp.name} بصلاحية مشرف مؤقت حتى ${crmCore.formatDisplayDateTime(expiresAt)}`,
        [{ field: 'delegation', label: 'الصلاحية', before: str(targetEmp.role || 'agent'), after: `supervisor (حتى ${crmCore.formatDisplayDateTime(expiresAt)})` }]
      );

      const rowRes = await tx.query(`SELECT * FROM employee_delegations WHERE id = $1 LIMIT 1`, [delId]);
      return formatDelegationRow(rowRes.rows[0]);
    });

    invalidateAuthSessionCache(executor, { employeeId: empId });
    return { delegation: out };
  });
}

export async function revokeDelegation(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  if (!crmCore.isPrivilegedRole(session.user.role) && !crmCore.canUserPerform(session.user, 'manage_employees')) {
    throw new Error('FORBIDDEN: إلغاء التفويض المؤقت متاح للمدير العام أو مسؤول إدارة الموظفين فقط.');
  }
  const delId = str(payload.id || payload.delegationId);
  if (!delId) throw new Error('VALIDATION_ERROR: معرف التفويض مطلوب.');

  const nowIso = new Date().toISOString();
  let revokedEmpId = '';
  await executor.withTransaction(async (tx) => {
    const curRes = await tx.query(`SELECT * FROM employee_delegations WHERE id = $1 LIMIT 1`, [delId]);
    if (!curRes.rows[0]) throw new Error('NOT_FOUND: سجل التفويض غير موجود.');
    const cur = curRes.rows[0];
    revokedEmpId = str(cur.delegate_employee_id);
    await tx.query(
      `UPDATE employee_delegations
       SET status = 'revoked', revoked_at = $2, revoked_by_id = $3, revoked_by_name = $4, updated_at = NOW()
       WHERE id = $1`,
      [delId, nowIso, session.user.id, session.user.name]
    );
    await logActivity(
      tx,
      session.user,
      'إلغاء تفويض مؤقت',
      'Employee',
      str(cur.delegate_employee_name),
      `تم إلغاء التفويض المؤقت عن ${str(cur.delegate_employee_name)}`,
      [{ field: 'delegation', label: 'حالة التفويض', before: 'نشط', after: 'ملغى يدويًا' }]
    );
  });

  if (revokedEmpId) {
    invalidateAuthSessionCache(executor, { employeeId: revokedEmpId });
  } else {
    invalidateAuthSessionCache(executor, { all: true });
  }
  return { revoked: true };
}

// ---------- COLLABORATIVE SOFT LOCKS ----------

function formatLockRow(row: any): Record<string, any> {
  return {
    reservationId: str(row.reservation_id),
    lockedById: str(row.locked_by_id),
    lockedByName: str(row.locked_by_name),
    lockedByRole: str(row.locked_by_role),
    lockedAt: row.locked_at instanceof Date ? row.locked_at.toISOString() : str(row.locked_at),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : str(row.expires_at)
  };
}

export async function getReservationLocks(executor: DbExecutor, _session: AuthSession) {
  const res = await executor.query(`SELECT * FROM reservation_locks WHERE expires_at > NOW()`);
  return {
    items: res.rows.map(formatLockRow)
  };
}

export async function acquireReservationLock(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const resId = str(payload.reservationId);
  if (!resId) throw new Error('VALIDATION_ERROR: معرف الحجز مطلوب للقفل التعاوني.');

  await executor.query(`DELETE FROM reservation_locks WHERE expires_at <= NOW()`);
  const existingRes = await executor.query(
    `SELECT * FROM reservation_locks WHERE reservation_id = $1 AND expires_at > NOW() LIMIT 1`,
    [resId]
  );
  const existing = existingRes.rows[0];
  if (existing && str(existing.locked_by_id) && str(existing.locked_by_id) !== session.user.id) {
    return {
      acquired: false,
      lock: formatLockRow(existing)
    };
  }

  const upsertRes = await executor.query(
    `INSERT INTO reservation_locks (reservation_id, locked_by_id, locked_by_name, locked_by_role, locked_at, expires_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW() + INTERVAL '2 minutes')
     ON CONFLICT (reservation_id) DO UPDATE SET
       locked_by_id = EXCLUDED.locked_by_id,
       locked_by_name = EXCLUDED.locked_by_name,
       locked_by_role = EXCLUDED.locked_by_role,
       locked_at = NOW(),
       expires_at = NOW() + INTERVAL '2 minutes'
     RETURNING *`,
    [resId, session.user.id, session.user.name, session.user.role]
  );
  return {
    acquired: true,
    lock: upsertRes.rows[0] ? formatLockRow(upsertRes.rows[0]) : null
  };
}

export async function releaseReservationLock(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const resId = str(payload.reservationId);
  if (resId) {
    await executor.query(
      `DELETE FROM reservation_locks WHERE reservation_id = $1 AND locked_by_id = $2`,
      [resId, session.user.id]
    );
  } else {
    await executor.query(`DELETE FROM reservation_locks WHERE locked_by_id = $1`, [session.user.id]);
  }
  return { released: true };
}

// ---------- DELTA SYNC (UPDATED AFTER POLLING / SSE TRIGGER) ----------

export async function getDeltaSync(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  const rawSince = str(payload.updatedAfter);
  const sinceDate = rawSince && !isNaN(Date.parse(rawSince))
    ? new Date(Date.parse(rawSince) - 2000).toISOString()
    : new Date(Date.now() - 120000).toISOString();

  const [resRows, fuRows, prbRows, empRows, tombstoneRows, delNtfRows, dismissedNtfRows, settingsUpdRes, delUpdRes, rolesActRes, freshSyncVer, notifData, annData, locksData, todayRadarSummary, workerStateRes] = await Promise.all([
    executor.query(
      `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       WHERE r.updated_at > $1::timestamptz
       ORDER BY r.updated_at DESC
       LIMIT 200`,
      [sinceDate]
    ),
    executor.query(
      `SELECT * FROM follow_ups WHERE COALESCE(updated_at, created_at) > $1::timestamptz ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200`,
      [sinceDate]
    ),
    executor.query(
      `SELECT * FROM problems WHERE updated_at > $1::timestamptz ORDER BY updated_at DESC LIMIT 100`,
      [sinceDate]
    ),
    executor.query(
      `SELECT id, name, username, phone, email, job_title, role, permissions, ui_overrides, status, last_activity, created_at, updated_at
       FROM employees
       WHERE updated_at > $1::timestamptz
       ORDER BY updated_at DESC
       LIMIT 50`,
      [sinceDate]
    ).catch(() => ({ rows: [] as any[] })),
    executor.query<{ entity_type: string; entity_id: string; deleted_at: any }>(
      `SELECT entity_type, entity_id, deleted_at
       FROM sync_tombstones
       WHERE deleted_at > $1::timestamptz
       ORDER BY deleted_at DESC
       LIMIT 800`,
      [sinceDate]
    ).catch(() => ({ rows: [] as any[] })),
    executor.query<{ id: string }>(
      `SELECT id FROM notifications
       WHERE deleted_at IS NOT NULL
         AND deleted_at > $1::timestamptz
         AND (BTRIM(COALESCE(recipient_employee_id, '')) = $2 OR (BTRIM(COALESCE(recipient_employee_id, '')) = '' AND (BTRIM(COALESCE(recipient_role, '')) = $3 OR BTRIM(COALESCE(recipient_role, '')) = 'all')))
       ORDER BY deleted_at DESC
       LIMIT 300`,
      [sinceDate, str(session.user.id), str(session.user.role)]
    ).catch(() => ({ rows: [] as Array<{ id: string }> })),
    executor.query<{ id: string }>(
      `SELECT notification_id AS id FROM notification_dismissals
       WHERE employee_id = $1 AND deleted_at > $2::timestamptz
       ORDER BY deleted_at DESC
       LIMIT 300`,
      [session.user.id, sinceDate]
    ).catch(() => ({ rows: [] as Array<{ id: string }> })),
    executor.query<{ max_upd: any }>(
      `SELECT MAX(updated_at) AS max_upd
       FROM settings
       WHERE key <> 'crm_sync_version' AND updated_at > $1::timestamptz`,
      [sinceDate]
    ).catch(() => ({ rows: [] as any[] })),
    executor.query<{ max_upd: any }>(
      `SELECT MAX(updated_at) AS max_upd
       FROM employee_delegations
       WHERE updated_at > $1::timestamptz`,
      [sinceDate]
    ).catch(() => ({ rows: [] as any[] })),
    executor.query<{ max_upd: any }>(
      `SELECT MAX(created_at) AS max_upd
       FROM activity_log
       WHERE entity_type IN ('Role','RolePreset','Permission') AND created_at > $1::timestamptz`,
      [sinceDate]
    ).catch(() => ({ rows: [] as any[] })),
    ensureCacheSyncFreshness(executor, true).catch(() => getLocalCacheVersion(executor)),
    getNotifications(executor, session),
    getAnnouncements(executor, session).catch(() => ({ items: [], activeItems: [] })),
    getReservationLocks(executor, session).catch(() => ({ items: [] })),
    getTodayAndRadar(executor, session, { summaryOnly: true, todayDate: str(payload.todayDate) }).catch(() => ({ counts: null })),
    executor.query(`SELECT * FROM sync_worker_state WHERE id = 'primary' LIMIT 1`).catch(() => ({ rows: [] as any[] }))
  ]);

  const deletedReservationIds: string[] = [];
  const deletedFollowUpIds: string[] = [];
  const deletedEmployeeIds: string[] = [];
  const deletedAnnouncementIds: string[] = [];
  const deletedProblemIds: string[] = [];
  const deletedNotificationIds: string[] = [];
  const deletedCustomerNoteIds: string[] = [];
  let deletedAllReservationsBefore = '';
  let deletedAllNotificationsBefore = '';
  const userNotifTombstoneType = `notification:${str(session.user.id)}`;
  const userNotifAllEntityId = `ALL:${str(session.user.id)}`;

  for (const row of tombstoneRows.rows || []) {
    const et = str(row?.entity_type);
    const eid = str(row?.entity_id);
    if (et === 'reservation' && eid) {
      deletedReservationIds.push(eid);
    } else if (et === 'follow_up' && eid) {
      deletedFollowUpIds.push(eid);
    } else if (et === 'employee' && eid) {
      deletedEmployeeIds.push(eid);
    } else if (et === 'announcement' && eid) {
      deletedAnnouncementIds.push(eid);
    } else if (et === 'problem' && eid) {
      deletedProblemIds.push(eid);
    } else if (et === 'customer_note' && eid) {
      deletedCustomerNoteIds.push(eid);
    } else if ((et === 'notification' || et === userNotifTombstoneType) && eid) {
      deletedNotificationIds.push(eid);
    } else if (et === 'notification_clear_all' && (!eid || eid === userNotifAllEntityId)) {
      const dIso = row?.deleted_at instanceof Date ? row.deleted_at.toISOString() : str(row?.deleted_at);
      if (dIso && (!deletedAllNotificationsBefore || dIso > deletedAllNotificationsBefore)) {
        deletedAllNotificationsBefore = dIso;
      }
    } else if (et === 'reservation_clear_all') {
      const dIso = row?.deleted_at instanceof Date ? row.deleted_at.toISOString() : str(row?.deleted_at);
      if (dIso && (!deletedAllReservationsBefore || dIso > deletedAllReservationsBefore)) {
        deletedAllReservationsBefore = dIso;
      }
    }
  }
  for (const r of delNtfRows?.rows || []) {
    if (r?.id) deletedNotificationIds.push(str(r.id));
  }
  for (const r of dismissedNtfRows?.rows || []) {
    if (r?.id) deletedNotificationIds.push(str(r.id));
  }

  const maxSetUpdRaw = settingsUpdRes.rows?.[0]?.max_upd;
  const settingsUpdatedAt = maxSetUpdRaw instanceof Date ? maxSetUpdRaw.toISOString() : str(maxSetUpdRaw || '');
  const maxDelUpdRaw = delUpdRes.rows?.[0]?.max_upd;
  const maxRoleUpdRaw = rolesActRes.rows?.[0]?.max_upd;
  const syncVersion = Math.max(getLocalCacheVersion(executor), Number(freshSyncVer || 0) || 0);

  let callWrapupShortcuts: any = undefined;
  let clientUiConfig: any = undefined;
  if (settingsUpdatedAt || toBool(payload.includeUiConfig)) {
    const setMap = await getSettingsMap(executor).catch(() => ({} as Record<string, any>));
    if (typeof crmCore.normalizeCallWrapupShortcutsConfig === 'function') {
      callWrapupShortcuts = crmCore.normalizeCallWrapupShortcutsConfig(setMap.call_wrapup_shortcuts);
    }
    clientUiConfig = {
      uiSimplification: crmCore.normalizeUiSimplificationSettings(setMap.ui_simplification),
      roleUiDefaults: typeof crmCore.normalizeRoleUiDefaults === 'function' ? crmCore.normalizeRoleUiDefaults(setMap.role_ui_defaults) : {},
      statsControlConfig: typeof crmCore.normalizeStatsControlConfig === 'function' ? crmCore.normalizeStatsControlConfig(setMap.stats_control_config) : { excludedFromStatsEmployeeIds: [] },
      callWrapupShortcuts: callWrapupShortcuts || { items: crmCore.CALL_WRAPUP_OUTCOMES || [], customized: false, updatedAt: '', updatedBy: '' },
      handoverSettings: crmCore.normalizeHandoverSettings(setMap.handover_settings),
      customerNotesConfig: typeof crmCore.normalizeCustomerNotesConfig === 'function'
        ? crmCore.normalizeCustomerNotesConfig(setMap.customer_notes_config)
        : {}
    };
  }

  const rawWorkerRow = (workerStateRes as any)?.rows?.[0] || null;
  let syncWorkerState: any = null;
  let syncStatusChanged = false;
  if (rawWorkerRow) {
    const wUpdIso = rawWorkerRow.updated_at instanceof Date ? rawWorkerRow.updated_at.toISOString() : str(rawWorkerRow.updated_at);
    syncStatusChanged = Boolean(wUpdIso && wUpdIso > sinceDate);
    const wEnabled = rawWorkerRow.auto_sync_enabled !== false;
    const wIsSyncing = Boolean(
      rawWorkerRow.is_syncing &&
      (!rawWorkerRow.lock_expires_at || Date.parse(String(rawWorkerRow.lock_expires_at)) > Date.now())
    );
    const wConsecErr = num(rawWorkerRow.consecutive_errors, 0);
    const wLastErr = str(rawWorkerRow.last_error || '');
    syncWorkerState = {
      status: deriveWorkerStatus({ enabled: wEnabled, isSyncing: wIsSyncing, consecutiveErrors: wConsecErr, lastError: wLastErr }),
      isSyncing: wIsSyncing,
      autoSyncEnabled: wEnabled,
      intervalSeconds: num(rawWorkerRow.interval_seconds, 43200),
      intervalValue: num(rawWorkerRow.interval_value, 12),
      intervalUnit: str(rawWorkerRow.interval_unit || 'hours'),
      lastRunAt: rawWorkerRow.last_run_at instanceof Date ? rawWorkerRow.last_run_at.toISOString() : str(rawWorkerRow.last_run_at),
      lastSuccessAt: rawWorkerRow.last_success_at instanceof Date ? rawWorkerRow.last_success_at.toISOString() : str(rawWorkerRow.last_success_at),
      nextRunAt: rawWorkerRow.next_run_at instanceof Date ? rawWorkerRow.next_run_at.toISOString() : str(rawWorkerRow.next_run_at),
      lastDurationMs: num(rawWorkerRow.last_duration_ms, 0),
      importedCount: num(rawWorkerRow.last_imported_count, 0),
      updatedCount: num(rawWorkerRow.last_updated_count, 0),
      extensionsCount: num(rawWorkerRow.last_extensions_count, 0),
      errorCount: num(rawWorkerRow.error_count, 0),
      consecutiveErrors: wConsecErr,
      lastError: wLastErr,
      lastTriggerType: str(rawWorkerRow.last_trigger_type || ''),
      updatedAt: wUpdIso
    };
  }

  return {
    serverTime: new Date().toISOString(),
    syncVersion,
    changedReservations: redactReservationsList(resRows.rows.map((r) => mapReservationRowToClient(r, false)), session.user),
    changedFollowUps: fuRows.rows.map(formatFollowUpRow),
    changedProblems: prbRows.rows.map((p) => formatProblemRow(p)),
    changedEmployees: empRows.rows.map((e) => mapEmployeeRow(e)),
    deletedReservationIds: Array.from(new Set(deletedReservationIds)),
    deletedFollowUpIds: Array.from(new Set(deletedFollowUpIds)),
    deletedEmployeeIds: Array.from(new Set(deletedEmployeeIds)),
    deletedAnnouncementIds: Array.from(new Set(deletedAnnouncementIds)),
    deletedProblemIds: Array.from(new Set(deletedProblemIds)),
    deletedNotificationIds: Array.from(new Set(deletedNotificationIds)),
    deletedCustomerNoteIds: Array.from(new Set(deletedCustomerNoteIds)),
    deletedAllReservationsBefore,
    deletedAllNotificationsBefore,
    changedSettings: Boolean(settingsUpdatedAt),
    settingsUpdatedAt,
    ...(callWrapupShortcuts !== undefined ? { callWrapupShortcuts } : {}),
    ...(clientUiConfig !== undefined ? { clientUiConfig } : {}),
    changedDelegations: Boolean(maxDelUpdRaw),
    changedRoles: Boolean(maxRoleUpdRaw),
    syncStatusChanged,
    ...(syncWorkerState ? { syncWorkerState } : {}),
    hasMoreReservations: resRows.rows.length >= 200,
    hasMoreFollowUps: fuRows.rows.length >= 200,
    hasMoreProblems: prbRows.rows.length >= 100,
    todayRadarCounts: (todayRadarSummary as any)?.counts || null,
    notifications: notifData,
    announcements: annData.activeItems || [],
    locks: locksData.items || [],
    user: session.user
  };
}

// ---------- END-OF-SHIFT BULK REASSIGN ----------

export async function bulkReassignEmployeeReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'assign_employees');
  const fromEmployeeId = str(payload.fromEmployeeId);
  const toEmployeeId = str(payload.toEmployeeId);
  const onlyActive = payload.onlyActive !== false;

  if (!fromEmployeeId || !toEmployeeId) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد الموظف المحوّل منه والموظف المستلم للوردية.');
  }
  if (fromEmployeeId === toEmployeeId) {
    throw new Error('VALIDATION_ERROR: لا يمكن التحويل إلى نفس الموظف.');
  }

  return runWithIdempotency(executor, session.user.id, 'bulkReassignEmployeeReservations', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const empRes = await tx.query(
        `SELECT id, name, status FROM employees WHERE id = ANY($1::text[])`,
        [[fromEmployeeId, toEmployeeId]]
      );
      const eMap = new Map(empRes.rows.map((r) => [str(r.id), r]));
      const fromEmp = eMap.get(fromEmployeeId);
      const toEmp = eMap.get(toEmployeeId);
      if (!fromEmp || !toEmp) {
        throw new Error('NOT_FOUND: أحد الموظفين المحددين غير موجود.');
      }
      if (str(toEmp.status || 'active') !== 'active') {
        throw new Error('VALIDATION_ERROR: الموظف المستلم للوردية غير نشط.');
      }

      const resRows = await tx.query(
        `SELECT * FROM reservations WHERE assigned_employee_ids @> $1::jsonb FOR UPDATE`,
        [JSON.stringify([fromEmployeeId])]
      );

      const nowIso = new Date().toISOString();
      let transferredCount = 0;
      const transferredNumbers: string[] = [];

      for (const rawRow of resRows.rows) {
        const mapped = mapReservationRowToClient(rawRow, false);
        if (onlyActive && crmCore.isReservationClosedStatus(mapped)) {
          continue;
        }

        const curIds: string[] = Array.isArray(mapped.assignedEmployeeIds) ? [...mapped.assignedEmployeeIds] : [];
        const curNames: string[] = Array.isArray(mapped.assignedEmployeeNames) ? [...mapped.assignedEmployeeNames] : [];

        const nextIds: string[] = [];
        const nextNames: string[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < curIds.length; i++) {
          const eid = str(curIds[i]);
          if (!eid || eid === fromEmployeeId || seen.has(eid)) continue;
          seen.add(eid);
          nextIds.push(eid);
          nextNames.push(str(curNames[i]) || eid);
        }
        if (!seen.has(toEmployeeId)) {
          seen.add(toEmployeeId);
          nextIds.push(toEmployeeId);
          nextNames.push(str(toEmp.name));
        }

        await tx.query(
          `UPDATE reservations
           SET assigned_employee_ids = $2::jsonb,
               assigned_employee_names = $3::jsonb,
               last_update_text = $4,
               last_updated_by_id = $5,
               last_updated_by_name = $6,
               last_updated_at = $7,
               updated_at = $8::timestamptz
           WHERE id = $1`,
          [
            mapped.id,
            JSON.stringify(nextIds),
            JSON.stringify(nextNames),
            `تحويل وردية جماعي: من ${fromEmp.name} إلى ${toEmp.name}`,
            session.user.id,
            session.user.name,
            nowIso,
            nowIso
          ]
        );

        await tx.query(
          `UPDATE assignments SET status = 'transferred', updated_at = $3::timestamptz
           WHERE reservation_id = $1 AND employee_id = $2 AND status = 'active'`,
          [mapped.id, fromEmployeeId, nowIso]
        );
        await tx.query(
          `INSERT INTO assignments (id, reservation_id, reservation_number, employee_id, employee_name, assigned_by_id, assigned_by_name, role_type, status, assigned_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'shift_handover','active',$8::timestamptz,$8::timestamptz)`,
          [generateId('ASN'), mapped.id, mapped.reservationNumber, toEmp.id, toEmp.name, session.user.id, session.user.name, nowIso]
        );

        transferredCount += 1;
        transferredNumbers.push(mapped.reservationNumber);
      }

      if (transferredCount > 0) {
        await createNotification(tx, {
          recipientEmployeeId: toEmp.id,
          type: 'assignment',
          title: `استلام وردية: ${transferredCount} حجز نشط`,
          message: `تم تحويل ${transferredCount} حجزًا نشطًا من ${fromEmp.name} إليك بواسطة ${session.user.name}.`,
          entityType: 'Reservation',
          entityId: transferredNumbers[0] || '',
          eventKey: buildNotificationEventKey(['bulk_shift', str(payload.clientRequestId) || `${fromEmployeeId}->${toEmp.id}:${transferredNumbers.slice(0, 5).join(',')}`])
        });
      }

      await logActivity(
        tx,
        session.user,
        'تحويل جماعي للوردية',
        'Reservation',
        `${fromEmp.name} -> ${toEmp.name}`,
        `تحويل ${transferredCount} حجز نشط من ${fromEmp.name} إلى ${toEmp.name}`,
        [{ field: 'shiftTransfer', label: 'نقل الحجوزات النشطة', before: str(fromEmp.name), after: `${str(toEmp.name)} (${transferredCount} حجز)` }]
      );

      return {
        fromEmployeeId,
        fromEmployeeName: str(fromEmp.name),
        toEmployeeId,
        toEmployeeName: str(toEmp.name),
        transferredCount,
        reservationNumbers: transferredNumbers
      };
    });

    return out;
  });
}

export async function bulkReassignSelectedReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'assign_employees');
  const rawIds: string[] = Array.isArray(payload.reservationIds)
    ? payload.reservationIds.map((x: any) => str(x)).filter(Boolean)
    : [];
  const reservationIds = Array.from(new Set(rawIds)).slice(0, 250);
  const targetEmployeeId = str(payload.targetEmployeeId || payload.toEmployeeId || payload.employeeId);
  const mode = str(payload.mode).toLowerCase() === 'add' ? 'add' : 'replace';

  if (reservationIds.length === 0) {
    throw new Error('VALIDATION_ERROR: يرجى تحديد حجز واحد على الأقل لإعادة التوزيع.');
  }
  if (!targetEmployeeId) {
    throw new Error('VALIDATION_ERROR: يرجى اختيار الموظف المستلم.');
  }

  return runWithIdempotency(executor, session.user.id, 'bulkReassignSelectedReservations', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const empRes = await tx.query(
        `SELECT id, name, status FROM employees WHERE id = $1 LIMIT 1`,
        [targetEmployeeId]
      );
      const targetEmp = empRes.rows[0];
      if (!targetEmp) {
        throw new Error('NOT_FOUND: الموظف المستلم غير موجود.');
      }
      if (str(targetEmp.status || 'active') !== 'active') {
        throw new Error('VALIDATION_ERROR: الموظف المستلم غير نشط.');
      }

      const resRows = await tx.query(
        `SELECT * FROM reservations WHERE id = ANY($1::text[]) FOR UPDATE`,
        [reservationIds]
      );
      if (resRows.rows.length === 0) {
        throw new Error('NOT_FOUND: لم يتم العثور على الحجوزات المحددة.');
      }

      const nowIso = new Date().toISOString();
      const targetName = str(targetEmp.name);
      const updatedReservations: Record<string, any>[] = [];
      const updatedNumbers: string[] = [];
      const lastText = mode === 'add'
        ? `إسناد جماعي إلى: ${targetName}`
        : `إعادة توزيع جماعي إلى: ${targetName}`;

      for (const rawRow of resRows.rows) {
        const mapped = mapReservationRowToClient(rawRow, false);
        const curIds: string[] = Array.isArray(mapped.assignedEmployeeIds) ? mapped.assignedEmployeeIds : [];
        const curNames: string[] = Array.isArray(mapped.assignedEmployeeNames) ? mapped.assignedEmployeeNames : [];

        let nextIds: string[];
        let nextNames: string[];
        if (mode === 'add') {
          const seen = new Set<string>();
          nextIds = [];
          nextNames = [];
          for (let i = 0; i < curIds.length; i++) {
            const eid = str(curIds[i]);
            if (!eid || seen.has(eid)) continue;
            seen.add(eid);
            nextIds.push(eid);
            nextNames.push(str(curNames[i]) || eid);
          }
          if (!seen.has(targetEmployeeId)) {
            nextIds.push(targetEmployeeId);
            nextNames.push(targetName);
          }
        } else {
          nextIds = [targetEmployeeId];
          nextNames = [targetName];
        }

        await tx.query(
          `UPDATE reservations
           SET assigned_employee_ids = $2::jsonb,
               assigned_employee_names = $3::jsonb,
               last_update_text = $4,
               last_updated_by_id = $5,
               last_updated_by_name = $6,
               last_updated_at = $7,
               updated_at = $8::timestamptz
           WHERE id = $1`,
          [
            mapped.id,
            JSON.stringify(nextIds),
            JSON.stringify(nextNames),
            lastText,
            session.user.id,
            session.user.name,
            nowIso,
            nowIso
          ]
        );

        if (mode === 'replace') {
          await tx.query(
            `UPDATE assignments SET status = 'transferred', updated_at = $2::timestamptz
             WHERE reservation_id = $1 AND status = 'active'`,
            [mapped.id, nowIso]
          );
        }
        await tx.query(
          `INSERT INTO assignments (id, reservation_id, reservation_number, employee_id, employee_name, assigned_by_id, assigned_by_name, role_type, status, assigned_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'bulk_reassign','active',$8::timestamptz,$8::timestamptz)`,
          [generateId('ASN'), mapped.id, mapped.reservationNumber, targetEmployeeId, targetName, session.user.id, session.user.name, nowIso]
        );

        const nextObj: Record<string, any> = {
          ...mapped,
          assignedEmployeeIds: nextIds,
          assignedEmployeeNames: nextNames,
          lastUpdateText: lastText,
          lastUpdatedById: session.user.id,
          lastUpdatedByName: session.user.name,
          lastUpdatedAt: nowIso,
          updatedAt: nowIso
        };
        updatedReservations.push(nextObj);
        updatedNumbers.push(mapped.reservationNumber);
        await enqueueSheetsMirror(tx, 'Reservation', nextObj.id, 'upsertReservation', nextObj);
      }

      await createNotification(tx, {
        recipientEmployeeId: targetEmployeeId,
        type: 'assignment',
        title: `إسناد جماعي: ${updatedReservations.length} حجز`,
        message: `تم إسناد ${updatedReservations.length} حجزًا إليك بواسطة ${session.user.name} (${mode === 'add' ? 'إضافة للمشاركين' : 'استبدال الإسناد'}).`,
        entityType: 'Reservation',
        entityId: updatedNumbers[0] || '',
        eventKey: buildNotificationEventKey(['bulk_select', str(payload.clientRequestId) || `${targetEmployeeId}:${updatedNumbers.slice(0, 5).join(',')}`])
      });

      await logActivity(
        tx,
        session.user,
        'إعادة توزيع جماعي',
        'Reservation',
        updatedNumbers.slice(0, 4).join(', '),
        `${mode === 'add' ? 'إضافة إسناد' : 'إعادة توزيع'} ${updatedReservations.length} حجز إلى ${targetName}`
      );

      return {
        targetEmployeeId,
        targetEmployeeName: targetName,
        mode,
        updatedCount: updatedReservations.length,
        reservationIds: updatedReservations.map((r) => r.id),
        reservationNumbers: updatedNumbers,
        updatedReservations
      };
    });

    void flushSheetsMirrorOutbox(executor).catch(() => undefined);
    return out;
  });
}

// ---------- INACTIVE / REJECTED / CANCELLED RESERVATIONS & NATIONAL ID LOOKUP ----------

export async function rejectReservation(
  _executor: DbExecutor,
  session: AuthSession,
  _payload: Record<string, any> = {}
) {
  requireApiAccess(session);
  throw new Error('FORBIDDEN_MANUAL_ACTION: تم إيقاف رفض الحجوزات يدوياً؛ تُسحب الحالات المرفوضة تلقائياً من موقع Rental Gate فقط.');
}

export async function cancelReservation(
  _executor: DbExecutor,
  session: AuthSession,
  _payload: Record<string, any> = {}
) {
  requireApiAccess(session);
  throw new Error('FORBIDDEN_MANUAL_ACTION: تم إيقاف إلغاء الحجوزات يدوياً؛ تُسحب الحالات الملغاة تلقائياً من موقع Rental Gate فقط.');
}

export async function restoreReservation(
  _executor: DbExecutor,
  session: AuthSession,
  _payload: Record<string, any> = {}
) {
  requireApiAccess(session);
  throw new Error('FORBIDDEN_MANUAL_ACTION: لا يمكن تغيير حالة الحجز المرفوض أو الملغى يدوياً؛ تتبع الحالة للموقع الخارجي.');
}

export async function getInactiveReservations(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'view_reservations');
  const subTab = str(payload.subTab || payload.lifecycle || 'rejected').toLowerCase();
  if (subTab === 'rejected' && typeof crmCore.canUserViewSubSection === 'function' && !crmCore.canUserViewSubSection(session.user, 'sub_view_rejected_tab')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية عرض تبويب الحجوزات المرفوضة.');
  }
  if (subTab === 'cancelled' && typeof crmCore.canUserViewSubSection === 'function' && !crmCore.canUserViewSubSection(session.user, 'sub_view_cancelled_tab')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية عرض تبويب الحجوزات الملغاة.');
  }

  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const params: any[] = [];
  const clauses: string[] = [];

  if (session.user.role === 'agent' && !allowAgentViewAll) {
    params.push(JSON.stringify([session.user.id]));
    clauses.push(`r.assigned_employee_ids @> $${params.length}::jsonb`);
  }

  if (subTab === 'cancelled') {
    clauses.push(SQL_CANCELLED_CONDITION);
  } else if (subTab === 'all' || subTab === 'inactive') {
    clauses.push(`(${SQL_REJECTED_TAB_CONDITION} OR ${SQL_CANCELLED_CONDITION})`);
  } else {
    clauses.push(SQL_REJECTED_TAB_CONDITION);
  }

  const resNumberQuery = str(payload.reservationNumber).replace(/^#+/, '').trim();
  if (resNumberQuery) {
    const cond = buildPgSearchCondition(
      ['r.reservation_number', 'r.source_reservation_id', 'r.reference_number'],
      resNumberQuery,
      params
    );
    if (cond) clauses.push(cond);
  }
  if (payload.companyNumber) {
    const cond = buildPgSearchCondition(['r.company_number'], payload.companyNumber, params);
    if (cond) clauses.push(cond);
  }
  const oldComp = str(payload.oldCompanyName || payload.company);
  if (oldComp) {
    const cond = buildPgSearchCondition(['r.company_name'], oldComp, params);
    if (cond) clauses.push(cond);
  }
  if (payload.newCompanyName) {
    const cond = buildPgSearchCondition(['r.new_company_name'], payload.newCompanyName, params);
    if (cond) clauses.push(cond);
  }
  if (payload.status) {
    params.push(str(payload.status));
    clauses.push(`r.internal_status = $${params.length}`);
  }
  const rejReason = str(payload.rejectionReason);
  if (rejReason) {
    const cond = buildPgSearchCondition(['r.rejection_reason'], rejReason, params);
    if (cond) clauses.push(cond);
  }
  const canReason = str(payload.cancellationReason);
  if (canReason) {
    const cond = buildPgSearchCondition(['r.cancellation_reason'], canReason, params);
    if (cond) clauses.push(cond);
  }
  const empFilter = str(payload.confirmedByEmployee || payload.actionByEmployee || payload.employeeId);
  if (empFilter) {
    params.push(empFilter);
    const pIdx = params.length;
    clauses.push(`(r.rejected_by_id = $${pIdx} OR r.rejected_by_name = $${pIdx} OR r.cancelled_by_id = $${pIdx} OR r.cancelled_by_name = $${pIdx} OR r.last_updated_by_id = $${pIdx} OR r.last_updated_by_name = $${pIdx})`);
  }

  const dateFrom = str(payload.dateFrom).slice(0, 10);
  const dateTo = str(payload.dateTo).slice(0, 10);
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`LEFT(COALESCE(NULLIF(r.rejected_at, ''), NULLIF(r.cancelled_at, ''), NULLIF(r.start_date, '')), 10) >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`LEFT(COALESCE(NULLIF(r.rejected_at, ''), NULLIF(r.cancelled_at, ''), NULLIF(r.start_date, '')), 10) <= $${params.length}`);
  }

  if (payload.search) {
    const canSearchId = typeof crmCore.canUserViewCustomerId === 'function' && crmCore.canUserViewCustomerId(session.user);
    const cols = [
      'r.reservation_number',
      'r.customer_name',
      'r.customer_phone',
      'r.company_name',
      'r.company_number',
      'r.new_company_name',
      'r.rejection_reason',
      'r.cancellation_reason',
      'r.rejected_by_name',
      'r.cancelled_by_name',
      'r.car_name',
      'r.plate_number'
    ];
    if (canSearchId) cols.push('r.customer_id_number');
    const cond = buildPgSearchCondition(cols, payload.search, params);
    if (cond) clauses.push(cond);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const page = Math.max(1, num(payload.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(payload.pageSize, 10)));
  const offset = (page - 1) * pageSize;

  const listParams = [...params, pageSize, offset];
  const scopeWhere = subTab === 'cancelled'
    ? SQL_CANCELLED_CONDITION
    : (subTab === 'all' || subTab === 'inactive' ? `(${SQL_REJECTED_TAB_CONDITION} OR ${SQL_CANCELLED_CONDITION})` : SQL_REJECTED_TAB_CONDITION);

  const [countRes, rowsRes, facetRowsRes] = await Promise.all([
    executor.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM reservations r ${whereSql}`, params),
    executor.query(
      `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
       FROM reservations r
       ${whereSql}
       ORDER BY COALESCE(NULLIF(r.rejected_at, ''), NULLIF(r.cancelled_at, ''), r.updated_at::text) DESC, r.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
    executor.query(
      `SELECT DISTINCT company_name, new_company_name, rejection_reason, cancellation_reason, internal_status, rejected_by_name, cancelled_by_name
       FROM reservations r
       WHERE ${scopeWhere}
       LIMIT 1000`
    )
  ]);

  const compSet = new Set<string>();
  const newCompSet = new Set<string>();
  const reasonSet = new Set<string>();
  const statusSet = new Set<string>();
  const empSet = new Set<string>();
  for (const fr of facetRowsRes.rows || []) {
    if (str(fr.company_name)) compSet.add(str(fr.company_name));
    const cleanNewComp = typeof crmCore.sanitizeReasonText === 'function' ? crmCore.sanitizeReasonText(fr.new_company_name) : str(fr.new_company_name);
    if (cleanNewComp) newCompSet.add(cleanNewComp);
    const cleanRej = typeof crmCore.sanitizeReasonText === 'function' ? crmCore.sanitizeReasonText(fr.rejection_reason) : str(fr.rejection_reason);
    if (cleanRej) reasonSet.add(cleanRej);
    const cleanCan = typeof crmCore.sanitizeReasonText === 'function' ? crmCore.sanitizeReasonText(fr.cancellation_reason) : str(fr.cancellation_reason);
    if (cleanCan) reasonSet.add(cleanCan);
    if (str(fr.internal_status)) statusSet.add(str(fr.internal_status));
    if (str(fr.rejected_by_name)) empSet.add(str(fr.rejected_by_name));
    if (str(fr.cancelled_by_name)) empSet.add(str(fr.cancelled_by_name));
  }

  const total = Number(countRes.rows[0]?.cnt || 0);
  return {
    items: redactReservationsList(rowsRes.rows.map((r) => mapReservationRowToClient(r, false)), session.user),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: {
      companies: Array.from(compSet).sort(),
      newCompanies: Array.from(newCompSet).sort(),
      reasons: Array.from(reasonSet).sort(),
      statuses: Array.from(statusSet).sort(),
      employees: Array.from(empSet).sort()
    }
  };
}

export async function searchCustomerByNationalId(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'view_customer_id');
  if (typeof crmCore.canUserViewCustomerId === 'function' && !crmCore.canUserViewCustomerId(session.user)) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية استرجاع أو عرض رقم الهوية الوطنية للعملاء.');
  }

  const rawId = str(payload.nationalId || payload.customerIdNumber || payload.query);
  const normalizedId = typeof crmCore.normalizeNationalId === 'function'
    ? crmCore.normalizeNationalId(rawId)
    : rawId.replace(/\D/g, '');
  if (!normalizedId || normalizedId.length < 4) {
    throw new Error('VALIDATION_ERROR: يرجى إدخال 4 أرقام على الأقل من رقم الهوية للبحث.');
  }

  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const likeEscapedId = normalizedId.toLowerCase().replace(/[\\%_]/g, '\\$&');
  const params: any[] = [normalizedId, `%${likeEscapedId}%`];
  let agentClause = '';
  if (session.user.role === 'agent' && !allowAgentViewAll) {
    params.push(JSON.stringify([session.user.id]));
    agentClause = `AND r.assigned_employee_ids @> $${params.length}::jsonb`;
  }

  const normalizedColSql = `REGEXP_REPLACE(TRANSLATE(COALESCE(r.customer_id_number, ''), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}'), '[^0-9A-Za-z]', '', 'g')`;
  const rowsRes = await executor.query(
    `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
     FROM reservations r
     WHERE (
       ${normalizedColSql} = $1
       OR LOWER(${normalizedColSql}) LIKE $2 ESCAPE '\\'
     )
     ${agentClause}
     ORDER BY r.updated_at DESC
     LIMIT 300`,
    params
  );

  const mapped = rowsRes.rows.map((r) => mapReservationRowToClient(r, false));
  const grouped = crmCore.groupCustomerLookupResults(mapped, normalizedId);
  return {
    ...grouped,
    query: normalizedId
  };
}

function requireUiCustomizerPermission(session: AuthSession, includeRoleDefaults = false): void {
  if (!session || !session.user) {
    throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول.');
  }
  const role = str(session.user.role);
  if (role === 'developer' || role === 'general_manager') return;
  if (crmCore.canUserPerform(session.user, 'customize_ui')) return;
  if (includeRoleDefaults && crmCore.canUserPerform(session.user, 'manage_role_ui_defaults')) return;
  if (crmCore.canUserPerform(session.user, 'manage_employees')) return;
  throw new Error('FORBIDDEN: تخصيص الواجهة وإخفاء/إظهار الأقسام متاح للمبرمج والمدير العام أو المخولين فقط.');
}

export async function saveEmployeeUiOverrides(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireUiCustomizerPermission(session, false);
  const empId = str(payload.employeeId);
  if (!empId) throw new Error('VALIDATION_ERROR: معرف الموظف مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const res = await tx.query(`SELECT * FROM employees WHERE id = $1 FOR UPDATE`, [empId]);
    const cur = res.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الموظف غير موجود.');
    if (str(cur.role) === 'developer' && session.user.role !== 'developer') {
      throw new Error('FORBIDDEN: تعديل إعدادات واجهة المبرمج متاح للمبرمج فقط.');
    }

    const normalized = typeof crmCore.normalizeUiOverrides === 'function'
      ? crmCore.normalizeUiOverrides(payload.uiOverrides)
      : {};
    const nowIso = new Date().toISOString();

    await tx.query(
      `UPDATE employees SET ui_overrides = $2::jsonb, updated_at = $3::timestamptz WHERE id = $1`,
      [empId, JSON.stringify(normalized), nowIso]
    );
    await tx.query(
      `UPDATE users SET ui_overrides = $2::jsonb, updated_at = $3::timestamptz WHERE id = $1`,
      [empId, JSON.stringify(normalized), nowIso]
    );

    await logActivity(tx, session.user, 'تخصيص واجهة موظف', 'Employee', str(cur.username || empId), `تحديث إعدادات إظهار/إخفاء الواجهة للموظف ${str(cur.name)}`);
    const emp = mapEmployeeRow({ ...cur, ui_overrides: normalized, updated_at: nowIso });
    await enqueueSheetsMirror(tx, 'Employee', empId, 'upsertEmployee', emp);
    return emp;
  });

  invalidateAuthSessionCache(executor, { employeeId: empId });
  invalidateScopes(executor, ['employees', 'settings']);
  void flushSheetsMirrorOutbox(executor).catch(() => undefined);
  return { employee: out };
}

export async function saveRoleUiDefaults(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireUiCustomizerPermission(session, true);
  const rawRoleDefaults = payload.roleUiDefaults !== undefined
    ? payload.roleUiDefaults
    : (payload.role_ui_defaults !== undefined ? payload.role_ui_defaults : payload);
  const nextRoleDefaults = typeof crmCore.normalizeRoleUiDefaults === 'function'
    ? crmCore.normalizeRoleUiDefaults(rawRoleDefaults)
    : {};
  const rawUiSimp = payload.uiSimplification !== undefined
    ? payload.uiSimplification
    : payload.ui_simplification;

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('role_ui_defaults', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(nextRoleDefaults), session.user.name]
    );
    if (rawUiSimp !== undefined) {
      const nextUi = crmCore.normalizeUiSimplificationSettings(rawUiSimp);
      await tx.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ('ui_simplification', $1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [JSON.stringify(nextUi), session.user.name]
      );
    }
    await logActivity(tx, session.user, 'تخصيص واجهة الأدوار', 'Settings', 'role_ui_defaults', 'تحديث إعدادات إظهار/إخفاء الأقسام حسب الدور');
  });

  invalidateScopes(executor, ['settings', 'employees', 'roles', 'dashboard']);
  const settingsMap = await getSettingsMap(executor);
  const resolvedRoleDefaults = typeof crmCore.normalizeRoleUiDefaults === 'function'
    ? crmCore.normalizeRoleUiDefaults(settingsMap.role_ui_defaults)
    : nextRoleDefaults;
  const resolvedUiSimp = crmCore.normalizeUiSimplificationSettings(settingsMap.ui_simplification);
  return {
    roleUiDefaults: resolvedRoleDefaults,
    role_ui_defaults: resolvedRoleDefaults,
    uiSimplification: resolvedUiSimp,
    ui_simplification: resolvedUiSimp
  };
}

export async function restoreUiDefaults(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireUiCustomizerPermission(session, true);
  const scope = str(payload.scope || 'all').toLowerCase();
  const empId = str(payload.employeeId);
  const roleKey = str(payload.role);

  if (scope === 'employee' && empId) {
    return saveEmployeeUiOverrides(executor, session, { employeeId: empId, uiOverrides: {} });
  }

  const prevMap = await getSettingsMap(executor);
  if (scope === 'role' && roleKey) {
    const curRoleDefaults = typeof crmCore.normalizeRoleUiDefaults === 'function'
      ? crmCore.normalizeRoleUiDefaults(prevMap.role_ui_defaults)
      : {};
    if (curRoleDefaults[roleKey]) {
      curRoleDefaults[roleKey] = {};
    }
    return saveRoleUiDefaults(executor, session, { roleUiDefaults: curRoleDefaults });
  }

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('ui_simplification', '{}', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = '{}', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [session.user.name]
    );
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('role_ui_defaults', '{}', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = '{}', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [session.user.name]
    );
    if (toBool(payload.clearEmployees)) {
      if (session.user.role === 'developer') {
        await tx.query(`UPDATE employees SET ui_overrides = '{}'::jsonb, updated_at = NOW()`);
        await tx.query(`UPDATE users SET ui_overrides = '{}'::jsonb, updated_at = NOW()`);
      } else {
        await tx.query(`UPDATE employees SET ui_overrides = '{}'::jsonb, updated_at = NOW() WHERE role <> 'developer'`);
        await tx.query(`UPDATE users SET ui_overrides = '{}'::jsonb, updated_at = NOW() WHERE role <> 'developer'`);
      }
      invalidateAuthSessionCache(executor, { all: true });
    }
    await logActivity(tx, session.user, 'استعادة الإعدادات الافتراضية للواجهة', 'Settings', 'ui_defaults', 'استعادة الإعدادات الافتراضية لإظهار وإخفاء الأقسام');
  });

  invalidateScopes(executor, ['settings', 'employees', 'roles', 'dashboard']);
  const defaultUi = crmCore.normalizeUiSimplificationSettings({});
  return {
    uiSimplification: defaultUi,
    ui_simplification: defaultUi,
    roleUiDefaults: {},
    role_ui_defaults: {}
  };
}

// ---------- CUSTOMER MANAGEMENT SYSTEM ----------

const SQL_CUST_COMPLETED_OR_INACTIVE = `(
  NOT ${SQL_ACTIVE_CONDITION} OR
  LOWER(TRIM(COALESCE(r.original_status_code, ''))) IN ('completed','finished','finished_by_driver','closed','ended','returned') OR
  TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') IN ('مكتمل','مكتمله','منتهي','منتهيه','مغلق','تم الاغلاق','تم التسليم والاسترجاع')
)`;

function buildReservationStatusFilterClause(statusFilterRaw: string, params: any[]): string {
  const s = str(statusFilterRaw);
  if (!s) return '';
  if (s === 'ملغي') {
    return SQL_CANCELLED_CONDITION;
  }
  if (s === 'مرفوض') {
    return SQL_REJECTED_CONDITION;
  }
  if (s === 'منتهي') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        LOWER(TRIM(COALESCE(r.original_status_code, ''))) IN ('completed','finished','finished_by_driver','closed','ended','returned') OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%منتهي%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%مكتمل%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%مغلق%'
      )
    )`;
  }
  if (s === 'نشط الآن') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        LOWER(TRIM(COALESCE(r.original_status_code, ''))) IN ('active','ongoing','in_progress','started','delivered','picked_up','running') OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%نشط%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%جاري%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%مستلم%'
      )
    )`;
  }
  if (s === 'جاهز للاستلام') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        LOWER(TRIM(COALESCE(r.original_status_code, ''))) IN ('ready','ready_for_pickup','confirmed','approved','accepted') OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%جاهز%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%موكد%' OR
        TRANSLATE(LOWER(TRIM(COALESCE(r.internal_status, ''))), '${PG_SEARCH_NORM_FROM}', '${PG_SEARCH_NORM_TO}') LIKE '%استلام%'
      )
    )`;
  }
  if (s === 'متأخر في السداد') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        COALESCE(r.payment_status, '') ILIKE '%unpaid%' OR
        COALESCE(r.payment_status, '') ILIKE '%late%' OR
        COALESCE(r.payment_status, '') LIKE '%متأخر%' OR
        COALESCE(r.payment_status, '') LIKE '%غير مدفوع%' OR
        COALESCE(r.internal_status, '') LIKE '%متأخر%' OR
        (COALESCE(r.total_amount, 0) > 0 AND COALESCE(r.paid_amount, 0) < COALESCE(r.total_amount, 0) AND NOT ${SQL_CUST_COMPLETED_OR_INACTIVE})
      )
    )`;
  }
  if (s === 'بانتظار المتابعة') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) OR
        COALESCE(r.internal_status, '') LIKE '%متابعة%' OR
        COALESCE(r.internal_status, '') LIKE '%انتظار%'
      )
    )`;
  }
  if (s === 'جديد / بانتظار المراجعة') {
    return `(
      ${SQL_ACTIVE_CONDITION} AND (
        LOWER(TRIM(COALESCE(r.original_status_code, ''))) IN ('new','pending','pending_review','waiting','under_review') OR
        COALESCE(r.internal_status, '') LIKE '%جديد%' OR
        COALESCE(r.internal_status, '') LIKE '%مراجعة%'
      )
    )`;
  }
  params.push(s);
  const idx = params.length;
  return `(
    r.internal_status = $${idx} OR
    r.original_status_ar = $${idx} OR
    r.original_status_code = $${idx}
  )`;
}

function requireCustomersRouteAccess(session: AuthSession): void {
  const canRoute = typeof crmCore.canUserViewRoute === 'function' && crmCore.canUserViewRoute(session.user, 'customers');
  const canPerm = crmCore.canUserPerform(session.user, 'view_customers');
  if (!canRoute && !canPerm) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية الوصول إلى قسم العملاء.');
  }
}

async function ensureDefaultCustomerNoteStatuses(client: DbClient): Promise<void> {
  try {
    const cntRes = await client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM customer_note_statuses`);
    if (Number(cntRes.rows[0]?.cnt || 0) > 0) return;
    const defaults: any[] = Array.isArray(crmCore.CUSTOMER_NOTE_DEFAULT_STATUSES)
      ? crmCore.CUSTOMER_NOTE_DEFAULT_STATUSES
      : [];
    const nowIso = new Date().toISOString();
    for (const st of defaults) {
      await client.query(
        `INSERT INTO customer_note_statuses (
           id, name, description, color, sort_order, is_active, is_default,
           allow_agent_select, is_closed_status, created_by_id, created_by_name, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SYSTEM','النظام',$10::timestamptz,$10::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          str(st.id),
          str(st.name),
          str(st.description),
          str(st.color || '#3B82F6'),
          num(st.sortOrder, 0),
          st.isActive !== false,
          Boolean(st.isDefault),
          st.allowAgentSelect !== false,
          Boolean(st.isClosedStatus),
          nowIso
        ]
      );
    }
  } catch {
    // Non-fatal on legacy mock executors without customer_note_statuses table
  }
}

function formatCustomerNoteStatusRow(row: any): Record<string, any> {
  if (typeof crmCore.normalizeCustomerNoteStatusRecord === 'function') {
    const norm = crmCore.normalizeCustomerNoteStatusRecord(row);
    return {
      ...norm,
      usageCount: num(row.usage_count ?? row.usageCount, 0),
      createdById: str(row.created_by_id ?? row.createdById),
      createdByName: str(row.created_by_name ?? row.createdByName),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at ?? row.updatedAt)
    };
  }
  return {
    id: str(row.id),
    name: str(row.name),
    description: str(row.description),
    color: str(row.color || '#3B82F6'),
    sortOrder: num(row.sort_order ?? row.sortOrder, 0),
    isActive: row.is_active !== false,
    isDefault: Boolean(row.is_default),
    allowAgentSelect: row.allow_agent_select !== false,
    isClosedStatus: Boolean(row.is_closed_status),
    usageCount: num(row.usage_count ?? row.usageCount, 0)
  };
}

async function loadCustomerNoteStatusesList(client: DbClient, includeCounts = false): Promise<Record<string, any>[]> {
  try {
    await ensureDefaultCustomerNoteStatuses(client);
    const sql = includeCounts
      ? `SELECT s.*,
                COALESCE((
                  SELECT COUNT(*)::int FROM customer_notes cn
                  WHERE cn.deleted_at IS NULL AND (cn.status_id = s.id OR (COALESCE(cn.status_id, '') = '' AND cn.status_name = s.name))
                ), 0) AS usage_count
         FROM customer_note_statuses s
         ORDER BY s.sort_order ASC, s.created_at ASC`
      : `SELECT * FROM customer_note_statuses ORDER BY sort_order ASC, created_at ASC`;
    const res = await client.query(sql);
    if (res.rows && res.rows.length > 0) {
      return res.rows.map(formatCustomerNoteStatusRow);
    }
  } catch {
    // Fallback to defaults if table absent in minimal test mocks
  }
  return (crmCore.CUSTOMER_NOTE_DEFAULT_STATUSES || []).map((s: any) => ({ ...s, usageCount: 0 }));
}

function formatCustomerNoteAttachmentRow(row: any): Record<string, any> {
  return {
    id: str(row.id),
    noteId: str(row.note_id ?? row.noteId),
    fileName: str(row.file_name ?? row.fileName),
    mimeType: str(row.mime_type ?? row.mimeType),
    fileSize: num(row.file_size ?? row.fileSize, 0),
    storageUrl: str(row.storage_url ?? row.storageUrl),
    uploadedById: str(row.uploaded_by_id ?? row.uploadedById),
    uploadedByName: str(row.uploaded_by_name ?? row.uploadedByName),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt)
  };
}

function formatCustomerNoteRow(row: any, attachments: any[] = []): Record<string, any> {
  return {
    id: str(row.id),
    customerId: str(row.customer_id ?? row.customerId),
    customerName: str(row.customer_name ?? row.customerName),
    customerPhone: str(row.customer_phone ?? row.customerPhone),
    reservationId: str(row.reservation_id ?? row.reservationId),
    reservationNumber: str(row.reservation_number ?? row.reservationNumber),
    problemId: str(row.problem_id ?? row.problemId),
    problemNumber: str(row.problem_number ?? row.problemNumber),
    title: str(row.title),
    noteType: str(row.note_type ?? row.noteType) || 'ملاحظة',
    statusId: str(row.status_id ?? row.statusId) || 'CNST_NEW',
    statusName: str(row.status_name ?? row.statusName) || 'جديدة',
    statusColor: str(row.status_color ?? row.statusColor) || '#3B82F6',
    statusIsActive: row.status_is_active !== undefined ? Boolean(row.status_is_active) : true,
    assignedEmployeeId: str(row.assigned_employee_id ?? row.assignedEmployeeId),
    assignedEmployeeName: str(row.assigned_employee_name ?? row.assignedEmployeeName),
    isInternal: Boolean(row.is_internal ?? row.isInternal),
    isClosed: Boolean(row.is_closed ?? row.isClosed),
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : str(row.closed_at ?? row.closedAt),
    closedById: str(row.closed_by_id ?? row.closedById),
    closedByName: str(row.closed_by_name ?? row.closedByName),
    sourceSection: str(row.source_section ?? row.sourceSection) || 'customers',
    content: str(row.content),
    createdById: str(row.created_by_id ?? row.createdById),
    createdByName: str(row.created_by_name ?? row.createdByName),
    updatedById: str(row.updated_by_id ?? row.updatedById),
    updatedByName: str(row.updated_by_name ?? row.updatedByName),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at ?? row.updatedAt),
    attachments
  };
}

async function enrichCustomerNoteRows(
  client: DbClient,
  noteRows: any[],
  user?: any
): Promise<Record<string, any>[]> {
  if (!Array.isArray(noteRows) || noteRows.length === 0) return [];
  const noteIds = noteRows.map((r) => str(r.id)).filter(Boolean);
  const attMap = new Map<string, any[]>();
  const statusMap = new Map<string, any>();

  try {
    const [attRes, statuses] = await Promise.all([
      noteIds.length > 0
        ? client.query(
            `SELECT * FROM customer_note_attachments WHERE note_id = ANY($1::text[]) AND deleted_at IS NULL ORDER BY created_at ASC`,
            [noteIds]
          ).catch(() => ({ rows: [] as any[] }))
        : Promise.resolve({ rows: [] as any[] }),
      loadCustomerNoteStatusesList(client, false)
    ]);
    for (const a of attRes.rows || []) {
      const nid = str(a.note_id);
      const list = attMap.get(nid) || [];
      list.push(formatCustomerNoteAttachmentRow(a));
      attMap.set(nid, list);
    }
    for (const st of statuses) {
      statusMap.set(st.id, st);
      statusMap.set(st.name, st);
    }
  } catch {
    // non-fatal
  }

  return noteRows.map((r) => {
    const stObj = statusMap.get(str(r.status_id)) || statusMap.get(str(r.status_name)) || null;
    const formatted = formatCustomerNoteRow(
      {
        ...r,
        status_name: str(r.status_name || stObj?.name || 'جديدة'),
        status_color: str(r.status_color || stObj?.color || '#3B82F6'),
        status_is_active: stObj ? Boolean(stObj.isActive) : true
      },
      attMap.get(str(r.id)) || []
    );
    if (user && typeof crmCore.redactCustomerSensitiveFields === 'function' && !crmCore.canUserViewCustomerId(user)) {
      return formatted;
    }
    return formatted;
  });
}

async function loadCustomerNotesConfigNormalized(client: DbClient): Promise<Record<string, any>> {
  const settings = isDbExecutorObj(client)
    ? await getSettingsMap(client).catch(() => ({} as Record<string, any>))
    : await (async () => {
        const res = await client.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'customer_notes_config' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
        return { customer_notes_config: res.rows[0]?.value };
      })();
  return typeof crmCore.normalizeCustomerNotesConfig === 'function'
    ? crmCore.normalizeCustomerNotesConfig(settings.customer_notes_config)
    : {};
}

function assertCustomerNoteButtonAllowed(
  config: Record<string, any>,
  buttonKey: string,
  user: any,
  noteObj?: any
): void {
  if (crmCore && typeof crmCore.evaluateCustomerNoteButtonAccess === 'function') {
    const evalRes = crmCore.evaluateCustomerNoteButtonAccess(user, buttonKey, noteObj || null, config);
    if (!evalRes.allowed) {
      throw new Error(`FORBIDDEN: ${evalRes.message || evalRes.reason || 'ليس لديك صلاحية تنفيذ هذا الإجراء.'}`);
    }
  }
}

async function recordCustomerNoteHistory(
  tx: DbClient,
  opts: {
    noteId: string;
    actionType: string;
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    actor: AuthSession['user'];
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO customer_note_history (
       id, note_id, action_type, field_name, old_value, new_value, actor_id, actor_name, actor_role, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      generateId('CNH'),
      str(opts.noteId),
      str(opts.actionType),
      str(opts.fieldName),
      str(opts.oldValue),
      str(opts.newValue),
      str(opts.actor.id),
      str(opts.actor.name),
      str(opts.actor.role)
    ]
  ).catch(() => undefined);
}

async function dispatchCustomerNoteConfigNotifications(
  tx: DbClient,
  config: Record<string, any>,
  trigger: 'onAdd' | 'onStatusChange' | 'onAssign' | 'onReplyUpdate' | 'onClose',
  opts: {
    actor: AuthSession['user'];
    noteId: string;
    title: string;
    message: string;
    customerId?: string;
    assignedEmployeeId?: string;
    eventKeySeed?: string;
  }
): Promise<void> {
  const notifCfg = config?.notifications || {};
  if (!notifCfg[trigger]) return;
  const targets = Array.isArray(notifCfg.notifyRoles)
    ? notifCfg.notifyRoles
    : (Array.isArray(notifCfg.targetRoles) ? notifCfg.targetRoles : ['general_manager', 'supervisor']);
  const targetEmps = Array.isArray(notifCfg.notifyEmployeeIds) ? notifCfg.notifyEmployeeIds : [];
  if (trigger === 'onAssign' && opts.assignedEmployeeId && opts.assignedEmployeeId !== opts.actor.id) {
    await createNotification(tx, {
      recipientEmployeeId: opts.assignedEmployeeId,
      type: 'customer_note_assigned',
      title: opts.title,
      message: opts.message,
      entityType: 'Customer',
      entityId: str(opts.customerId || opts.noteId),
      eventKey: buildNotificationEventKey(['cnote_notif', trigger, opts.noteId, opts.assignedEmployeeId, opts.eventKeySeed || ''])
    });
    return;
  }
  for (const empId of targetEmps) {
    const eid = str(empId);
    if (!eid || eid === str(opts.actor.id)) continue;
    await createNotification(tx, {
      recipientEmployeeId: eid,
      type: `customer_note_${trigger}`,
      title: opts.title,
      message: opts.message,
      entityType: 'Customer',
      entityId: str(opts.customerId || opts.noteId),
      eventKey: buildNotificationEventKey(['cnote_notif', trigger, opts.noteId, eid, opts.eventKeySeed || ''])
    });
  }
  for (const role of targets) {
    if (str(role) === str(opts.actor.role) && !opts.assignedEmployeeId) continue;
    await createNotification(tx, {
      recipientRole: str(role),
      type: `customer_note_${trigger}`,
      title: opts.title,
      message: opts.message,
      entityType: 'Customer',
      entityId: str(opts.customerId || opts.noteId),
      eventKey: buildNotificationEventKey(['cnote_notif', trigger, opts.noteId, role, opts.eventKeySeed || ''])
    });
  }
}

export async function getCustomers(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireCustomersRouteAccess(session);
  const canViewId = typeof crmCore.canUserViewCustomerId === 'function'
    ? crmCore.canUserViewCustomerId(session.user)
    : false;
  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const scopedAgentId = session.user.role === 'agent' && !allowAgentViewAll ? str(session.user.id) : '';

  const page = Math.max(1, Math.floor(num(payload.page, 1)));
  const pageSize = Math.min(200, Math.max(10, Math.floor(num(payload.pageSize, 50))));
  const sortBy = str(payload.sortBy || 'last_activity');
  const search = str(payload.search);
  const statusFilter = str(payload.status);
  const companyFilter = str(payload.company);
  const problemFilter = str(payload.problemFilter);
  const dateFrom = str(payload.dateFrom);
  const dateTo = str(payload.dateTo);
  const kpiFilter = str(payload.kpiFilter || 'all');

  const cacheKey = JSON.stringify({
    uid: scopedAgentId || 'ALL',
    canViewId,
    page,
    pageSize,
    sortBy,
    search,
    statusFilter,
    companyFilter,
    problemFilter,
    dateFrom,
    dateTo,
    kpiFilter
  });

  return getCachedOrLoad(
    executor,
    { scope: 'customers', key: cacheKey, ttlMs: 15000, bypassCache: toBool(payload.forceRefresh) },
    async () => {
      const params: any[] = [];
      let agentScopeSql = '';
      if (scopedAgentId) {
        params.push(JSON.stringify([scopedAgentId]));
        const pJson = `$${params.length}`;
        agentScopeSql = `AND (
          EXISTS (SELECT 1 FROM reservations rs WHERE rs.customer_id = c.id AND rs.assigned_employee_ids @> ${pJson}::jsonb)
          OR EXISTS (SELECT 1 FROM problems ps WHERE ps.customer_id = c.id AND ps.assigned_employee_ids @> ${pJson}::jsonb)
        )`;
      }

      const cteSql = `
        WITH res_agg AS (
          SELECT
            r.customer_id,
            COUNT(*)::int AS bookings_count,
            COUNT(*) FILTER (WHERE NOT ${SQL_CUST_COMPLETED_OR_INACTIVE})::int AS active_bookings_count,
            COUNT(*) FILTER (WHERE ${SQL_CUST_COMPLETED_OR_INACTIVE})::int AS past_bookings_count,
            COALESCE(SUM(COALESCE(r.extensions_count, 0)), 0)::int AS extensions_count,
            COALESCE(SUM(COALESCE(r.total_amount, 0)), 0)::numeric AS total_amount,
            COALESCE(SUM(COALESCE(r.paid_amount, 0)), 0)::numeric AS paid_amount,
            MAX(COALESCE(NULLIF(r.start_date, ''), TO_CHAR(r.created_at, 'YYYY-MM-DD'))) AS last_reservation_date,
            (ARRAY_AGG(r.reservation_number ORDER BY r.start_date DESC NULLS LAST, r.created_at DESC) FILTER (WHERE COALESCE(r.reservation_number, '') <> ''))[1] AS last_reservation_number,
            (ARRAY_AGG(COALESCE(NULLIF(r.internal_status, ''), NULLIF(r.original_status_ar, ''), r.original_status_code) ORDER BY r.start_date DESC NULLS LAST, r.created_at DESC) FILTER (WHERE COALESCE(r.reservation_number, '') <> ''))[1] AS last_reservation_status,
            (ARRAY_AGG(r.company_name ORDER BY r.start_date DESC NULLS LAST, r.created_at DESC) FILTER (WHERE COALESCE(r.company_name, '') <> ''))[1] AS last_company_name,
            COALESCE(ARRAY_AGG(DISTINCT r.company_name) FILTER (WHERE COALESCE(r.company_name, '') <> ''), ARRAY[]::text[]) AS companies,
            COALESCE(STRING_AGG(DISTINCT r.reservation_number, ' '), '') AS all_res_numbers,
            COALESCE(STRING_AGG(DISTINCT r.reference_number, ' '), '') AS all_ref_numbers,
            MAX(r.updated_at) AS max_res_updated_at
          FROM reservations r
          WHERE COALESCE(r.customer_id, '') <> ''
          GROUP BY r.customer_id
        ),
        prb_agg AS (
          SELECT
            COALESCE(NULLIF(p.customer_id, ''), r.customer_id) AS customer_id,
            COUNT(*) FILTER (WHERE p.status NOT IN ('مغلقة', 'تم الحل'))::int AS open_problems_count,
            COUNT(*) FILTER (WHERE p.status NOT IN ('مغلقة', 'تم الحل') AND COALESCE(p.ticket_type, 'مشكلة') = 'شكوى')::int AS open_complaints_count,
            MAX(p.updated_at) AS max_prb_updated_at
          FROM problems p
          LEFT JOIN reservations r ON p.reservation_id = r.id
          WHERE COALESCE(NULLIF(p.customer_id, ''), r.customer_id, '') <> ''
          GROUP BY COALESCE(NULLIF(p.customer_id, ''), r.customer_id)
        ),
        fu_agg AS (
          SELECT
            r.customer_id,
            COUNT(fu.id)::int AS follow_ups_count,
            MAX(fu.created_at) AS max_fu_created_at
          FROM follow_ups fu
          JOIN reservations r ON fu.reservation_id = r.id
          WHERE COALESCE(r.customer_id, '') <> ''
          GROUP BY r.customer_id
        ),
        note_agg AS (
          SELECT
            cn.customer_id,
            COUNT(*) FILTER (WHERE cn.deleted_at IS NULL)::int AS notes_count,
            MAX(cn.created_at) FILTER (WHERE cn.deleted_at IS NULL) AS max_note_created_at
          FROM customer_notes cn
          GROUP BY cn.customer_id
        ),
        customer_summary AS (
          SELECT
            c.*,
            COALESCE(ra.bookings_count, 0) AS bookings_count,
            COALESCE(ra.active_bookings_count, 0) AS active_bookings_count,
            COALESCE(ra.past_bookings_count, 0) AS past_bookings_count,
            COALESCE(ra.extensions_count, 0) AS extensions_count,
            COALESCE(pa.open_problems_count, 0) AS open_problems_count,
            COALESCE(pa.open_complaints_count, 0) AS open_complaints_count,
            COALESCE(fa.follow_ups_count, 0) AS follow_ups_count,
            COALESCE(na.notes_count, 0) AS notes_count,
            COALESCE(ra.total_amount, 0) AS total_amount,
            COALESCE(ra.paid_amount, 0) AS paid_amount,
            COALESCE(ra.last_reservation_number, '') AS last_reservation_number,
            COALESCE(ra.last_reservation_date, '') AS last_reservation_date,
            COALESCE(ra.last_reservation_status, '') AS last_reservation_status,
            COALESCE(ra.last_company_name, '') AS last_company_name,
            COALESCE(ra.companies, ARRAY[]::text[]) AS companies,
            COALESCE(ra.all_res_numbers, '') AS all_res_numbers,
            COALESCE(ra.all_ref_numbers, '') AS all_ref_numbers,
            NULLIF(GREATEST(
              COALESCE(
                c.last_contact_ts,
                CASE
                  WHEN COALESCE(c.last_contact_at, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (c.last_contact_at)::timestamptz
                  ELSE '-infinity'::timestamptz
                END
              ),
              COALESCE(fa.max_fu_created_at, '-infinity'::timestamptz),
              COALESCE(na.max_note_created_at, '-infinity'::timestamptz)
            ), '-infinity'::timestamptz) AS effective_last_contact_ts,
            GREATEST(
              c.updated_at,
              COALESCE(ra.max_res_updated_at, c.updated_at),
              COALESCE(pa.max_prb_updated_at, c.updated_at),
              COALESCE(fa.max_fu_created_at, c.updated_at),
              COALESCE(na.max_note_created_at, c.updated_at)
            ) AS last_activity_at
          FROM customers c
          LEFT JOIN res_agg ra ON ra.customer_id = c.id
          LEFT JOIN prb_agg pa ON pa.customer_id = c.id
          LEFT JOIN fu_agg fa ON fa.customer_id = c.id
          LEFT JOIN note_agg na ON na.customer_id = c.id
          WHERE 1=1 ${agentScopeSql}
        )
      `;

      // 1) KPI & Facets summary over the user's scoped universe
      const kpiRes = await executor.query(
        `${cteSql}
         SELECT
           COUNT(*)::int AS total_customers,
           COUNT(*) FILTER (WHERE status = 'جديد' OR (bookings_count <= 1 AND open_problems_count = 0 AND created_at >= NOW() - INTERVAL '30 days'))::int AS new_customers,
           COUNT(*) FILTER (WHERE active_bookings_count > 0)::int AS active_booking_customers,
           COUNT(*) FILTER (WHERE past_bookings_count > 0)::int AS past_booking_customers,
           COUNT(*) FILTER (WHERE open_problems_count > 0)::int AS open_problem_customers,
           COUNT(*) FILTER (WHERE open_complaints_count > 0)::int AS complaint_customers,
           COUNT(*) FILTER (WHERE extensions_count > 0)::int AS with_extensions_customers,
           COUNT(*) FILTER (WHERE follow_ups_count = 0 AND notes_count = 0 AND effective_last_contact_ts IS NULL)::int AS unfollowed_customers,
           COUNT(*) FILTER (WHERE bookings_count > 1)::int AS repeat_customers,
           COUNT(*) FILTER (WHERE GREATEST(created_at, updated_at) >= NOW() - INTERVAL '7 days')::int AS recent_customers
         FROM customer_summary`,
        params
      );
      const kpiRow = kpiRes.rows[0] || {};
      const kpis = {
        totalCustomers: num(kpiRow.total_customers),
        newCustomers: num(kpiRow.new_customers),
        activeBookingCustomers: num(kpiRow.active_booking_customers),
        pastBookingCustomers: num(kpiRow.past_booking_customers),
        openProblemCustomers: num(kpiRow.open_problem_customers),
        inProgressComplaintCustomers: num(kpiRow.complaint_customers),
        withExtensionsCustomers: num(kpiRow.with_extensions_customers),
        unfollowedCustomers: num(kpiRow.unfollowed_customers),
        repeatCustomers: num(kpiRow.repeat_customers),
        recentCustomers: num(kpiRow.recent_customers)
      };

      // 2) Filter clauses (Reservation statuses via EXISTS so multi-booking customers never duplicate)
      const filterParams = [...params];
      const clauses: string[] = [];

      if (search) {
        const searchCols = ['full_name', 'phone', 'normalized_phone', 'email', 'all_res_numbers', 'all_ref_numbers'];
        if (canViewId) searchCols.push('id_number');
        const cond = buildPgSearchCondition(searchCols, search, filterParams);
        if (cond) clauses.push(cond);
      }
      if (statusFilter) {
        const resCond = buildReservationStatusFilterClause(statusFilter, filterParams);
        if (resCond) {
          clauses.push(`EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = customer_summary.id AND (${resCond}))`);
        }
      }
      if (companyFilter) {
        filterParams.push(companyFilter);
        clauses.push(`$${filterParams.length} = ANY(companies)`);
      }
      if (dateFrom) {
        filterParams.push(dateFrom);
        clauses.push(`EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = customer_summary.id AND COALESCE(NULLIF(r.start_date, ''), TO_CHAR(r.created_at, 'YYYY-MM-DD')) >= $${filterParams.length})`);
      }
      if (dateTo) {
        filterParams.push(dateTo);
        clauses.push(`EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = customer_summary.id AND COALESCE(NULLIF(r.start_date, ''), TO_CHAR(r.created_at, 'YYYY-MM-DD')) <= $${filterParams.length})`);
      }
      if (problemFilter === 'open_problems') {
        clauses.push(`open_problems_count > 0`);
      } else if (problemFilter === 'open_complaints') {
        clauses.push(`open_complaints_count > 0`);
      } else if (problemFilter === 'no_problems') {
        clauses.push(`open_problems_count = 0`);
      }

      if (kpiFilter === 'new') {
        clauses.push(`(status = 'جديد' OR (bookings_count <= 1 AND open_problems_count = 0 AND created_at >= NOW() - INTERVAL '30 days'))`);
      } else if (kpiFilter === 'active') {
        clauses.push(`active_bookings_count > 0`);
      } else if (kpiFilter === 'past') {
        clauses.push(`past_bookings_count > 0`);
      } else if (kpiFilter === 'open_problems') {
        clauses.push(`open_problems_count > 0`);
      } else if (kpiFilter === 'complaints') {
        clauses.push(`open_complaints_count > 0`);
      } else if (kpiFilter === 'extensions') {
        clauses.push(`extensions_count > 0`);
      } else if (kpiFilter === 'unfollowed') {
        clauses.push(`(follow_ups_count = 0 AND notes_count = 0 AND effective_last_contact_ts IS NULL)`);
      } else if (kpiFilter === 'repeat') {
        clauses.push(`bookings_count > 1`);
      } else if (kpiFilter === 'recent') {
        clauses.push(`GREATEST(created_at, updated_at) >= NOW() - INTERVAL '7 days'`);
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      let orderSql = `last_activity_at DESC NULLS LAST, updated_at DESC`;
      if (sortBy === 'bookings_desc') orderSql = `bookings_count DESC, last_activity_at DESC`;
      else if (sortBy === 'active_desc') orderSql = `active_bookings_count DESC, last_activity_at DESC`;
      else if (sortBy === 'amount_desc') orderSql = `total_amount DESC, last_activity_at DESC`;
      else if (sortBy === 'created_desc') orderSql = `created_at DESC`;
      else if (sortBy === 'name_asc') orderSql = `full_name ASC, updated_at DESC`;

      const countRes = await executor.query<{ cnt: number }>(
        `${cteSql} SELECT COUNT(*)::int AS cnt FROM customer_summary ${whereSql}`,
        filterParams
      );
      const total = num(countRes.rows[0]?.cnt, 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const listParams = [...filterParams, pageSize, offset];
      const rowsRes = await executor.query(
        `${cteSql}
         SELECT *,
                CASE
                  WHEN effective_last_contact_ts IS NOT NULL
                    THEN TO_CHAR(effective_last_contact_ts AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
                  ELSE ''
                END AS effective_last_contact_display
         FROM customer_summary
         ${whereSql}
         ORDER BY ${orderSql}
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );

      const recentRes = await executor.query(
        `${cteSql}
         SELECT *,
                CASE
                  WHEN effective_last_contact_ts IS NOT NULL
                    THEN TO_CHAR(effective_last_contact_ts AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
                  ELSE ''
                END AS effective_last_contact_display
         FROM customer_summary
         ORDER BY GREATEST(created_at, updated_at) DESC
         LIMIT 6`,
        params
      );

      const [facets, resStatusesQ] = await Promise.all([
        getCachedReservationFacets(executor),
        executor.query<{ st: string }>(
          `SELECT DISTINCT internal_status AS st FROM reservations WHERE COALESCE(internal_status, '') <> '' ORDER BY internal_status ASC LIMIT 60`
        ).catch(() => ({ rows: [] as Array<{ st: string }> }))
      ]);

      const unifiedResStatuses = Array.isArray(crmCore.CUSTOMER_RESERVATION_STATUS_OPTIONS)
        ? crmCore.CUSTOMER_RESERVATION_STATUS_OPTIONS.map((o: any) => str(o.value)).filter(Boolean)
        : ['نشط الآن', 'جاهز للاستلام', 'بانتظار المتابعة', 'جديد / بانتظار المراجعة', 'متأخر في السداد', 'منتهي', 'ملغي', 'مرفوض'];
      const extraDbResStatuses = (resStatusesQ.rows || []).map((r) => str(r.st)).filter((s) => s && !unifiedResStatuses.includes(s));

      const items = rowsRes.rows.map((r) => formatCustomerSummaryRow({
        ...r,
        last_contact_at: r.effective_last_contact_display || r.effective_last_contact_at || str(r.last_contact_at)
      }, session.user));
      const recentCustomers = recentRes.rows.map((r) => formatCustomerSummaryRow({
        ...r,
        last_contact_at: r.effective_last_contact_display || r.effective_last_contact_at || str(r.last_contact_at)
      }, session.user));

      return {
        items,
        kpis,
        recentCustomers,
        facets: {
          companies: facets.companies || [],
          statuses: [...unifiedResStatuses, ...extraDbResStatuses],
          reservationStatusOptions: crmCore.CUSTOMER_RESERVATION_STATUS_OPTIONS || []
        },
        total,
        page: safePage,
        pageSize,
        totalPages
      };
    }
  );
}

export async function getCustomerDetails(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requireCustomersRouteAccess(session);
  const target = str(payload.customerId || payload.customerKey || payload.id);
  const resLookup = str(payload.reservationId || payload.reservationNumber);
  const phoneLookup = str(payload.phone);

  if (!target && !resLookup && !phoneLookup) {
    throw new Error('VALIDATION_ERROR: معرف العميل مطلوب.');
  }

  let custRow: any = null;
  if (target) {
    const q = await executor.query(
      `SELECT * FROM customers WHERE id = $1 OR customer_key = $1 LIMIT 1`,
      [target]
    );
    custRow = q.rows[0] || null;
  }

  if (!custRow && resLookup) {
    const rq = await executor.query(
      `SELECT * FROM reservations WHERE id = $1 OR reservation_number = $1 LIMIT 1`,
      [resLookup]
    );
    if (rq.rows[0]) {
      await executor.withTransaction(async (tx) => {
        const keyMap = await upsertCustomersFromReservationsTx(tx, [rq.rows[0]], { source: 'profile_lookup' });
        const cid = Array.from(keyMap.values())[0];
        if (cid) {
          const cq = await tx.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [cid]);
          custRow = cq.rows[0] || null;
        }
      });
    }
  }

  if (!custRow && phoneLookup) {
    const digits = phoneLookup.replace(/\D/g, '');
    const normPhone = digits.length >= 9 ? digits.slice(-9) : digits;
    if (normPhone) {
      const cq = await executor.query(
        `SELECT * FROM customers WHERE normalized_phone LIKE $1 OR phone = $2 ORDER BY updated_at DESC LIMIT 1`,
        [`%${normPhone}`, phoneLookup]
      );
      custRow = cq.rows[0] || null;
    }
  }

  if (!custRow) {
    throw new Error('NOT_FOUND: ملف العميل غير موجود.');
  }

  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;

  const custId = str(custRow.id);
  const resQ = await executor.query(
    `SELECT r.*, EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed
     FROM reservations r
     WHERE r.customer_id = $1
     ORDER BY r.start_date DESC NULLS LAST, r.created_at DESC
     LIMIT 400`,
    [custId]
  );

  const reservations = resQ.rows.map((r) => mapReservationRowToClient(r, false));
  const resIds = reservations.map((r) => str(r.id)).filter(Boolean);
  const resNums = reservations.map((r) => str(r.reservationNumber)).filter(Boolean);

  const [extRes, prbRes, fuRes, notesRes, actRes, empsRes, noteStatuses] = await Promise.all([
    (resIds.length || resNums.length)
      ? executor.query(
          `SELECT * FROM extensions WHERE reservation_id = ANY($1::text[]) OR reservation_number = ANY($2::text[]) ORDER BY start_date DESC, sequence_number DESC`,
          [resIds, resNums]
        )
      : Promise.resolve({ rows: [] as any[] }),
    executor.query(
      `SELECT * FROM problems WHERE customer_id = $1 OR reservation_id = ANY($2::text[]) ORDER BY updated_at DESC LIMIT 200`,
      [custId, resIds]
    ),
    resIds.length
      ? executor.query(`SELECT * FROM follow_ups WHERE reservation_id = ANY($1::text[]) ORDER BY created_at DESC LIMIT 300`, [resIds])
      : Promise.resolve({ rows: [] as any[] }),
    executor.query(
      `SELECT * FROM customer_notes WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`,
      [custId]
    ),
    executor.query(
      `SELECT * FROM activity_log WHERE (entity_type = 'Customer' AND entity_id = $1) OR (entity_type = 'Reservation' AND entity_id = ANY($2::text[])) ORDER BY created_at DESC LIMIT 120`,
      [custId, resNums]
    ),
    executor.query(`SELECT id, name, role, status FROM employees WHERE status = 'active' ORDER BY name ASC`),
    loadCustomerNoteStatusesList(executor, false)
  ]);

  const extensions = extRes.rows.map(mapExtensionRowToClient);
  const prbIds = prbRes.rows.map((p) => str(p.id)).filter(Boolean);
  const prbUpdMap = new Map<string, any[]>();
  if (prbIds.length > 0) {
    const prbUpds = await executor.query(
      `SELECT * FROM problem_updates WHERE problem_id = ANY($1::text[]) ORDER BY created_at DESC`,
      [prbIds]
    );
    for (const u of prbUpds.rows) {
      const pid = str(u.problem_id);
      const arr = prbUpdMap.get(pid) || [];
      arr.push(formatProblemUpdateRow(u));
      prbUpdMap.set(pid, arr);
    }
  }
  const problems = prbRes.rows.map((p) => formatProblemRow(p, prbUpdMap));

  if (session.user.role === 'agent' && !allowAgentViewAll) {
    const uid = str(session.user.id);
    const hasCustAccess =
      reservations.some((r) => Array.isArray(r.assignedEmployeeIds) && r.assignedEmployeeIds.includes(uid)) ||
      problems.some((p) => Array.isArray(p.assignedEmployeeIds) && p.assignedEmployeeIds.includes(uid));
    if (!hasCustAccess) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية عرض ملف هذا العميل.');
    }
  }

  const followUps = fuRes.rows.map(formatFollowUpRow);
  const notes = await enrichCustomerNoteRows(executor, notesRes.rows || [], session.user);
  const notesConfig = typeof crmCore.normalizeCustomerNotesConfig === 'function'
    ? crmCore.normalizeCustomerNotesConfig(settings.customer_notes_config)
    : {};

  let activeCount = 0;
  let pastCount = 0;
  let totalAmount = 0;
  let baseAmount = 0;
  let extensionsAmount = 0;
  let paidAmount = 0;
  let refundAmount = 0;
  let penaltyAmount = 0;

  for (const r of reservations) {
    const stText = `${r.originalStatusCode || ''} ${r.internalStatus || ''}`;
    const isPast = (typeof crmCore.isInactiveReservation === 'function' && crmCore.isInactiveReservation(r))
      || /(completed|finished|finished_by_driver|closed|ended|returned|مكتمل|منتهي|مغلق)/i.test(stText);
    if (isPast) pastCount++;
    else activeCount++;
    totalAmount += num(r.totalAmount, 0);
    baseAmount += num(r.baseAmount, 0);
    extensionsAmount += num(r.extensionsAmount, 0);
    paidAmount += num(r.paidAmount, 0);
    refundAmount += num(r.refundAmount, 0);
    penaltyAmount += num(r.penaltyAmount, 0);
  }

  const openProblems = problems.filter((p) => p.status !== 'مغلقة' && p.status !== 'تم الحل');
  const openComplaints = openProblems.filter((p) => p.ticketType === 'شكوى');
  const companiesSet = new Set(reservations.map((r) => str(r.companyName)).filter(Boolean));
  const lastRes = reservations[0] || null;
  const lastFuDate = followUps[0] ? str(followUps[0].followUpDate || followUps[0].createdAt) : '';
  const lastNoteDate = notes[0] ? str(notes[0].createdAt) : '';
  const effectiveLastContact = [str(custRow.last_contact_at), lastFuDate, lastNoteDate].filter(Boolean).sort().reverse()[0] || '';

  const customer = formatCustomerSummaryRow({
    ...custRow,
    last_contact_at: effectiveLastContact,
    bookings_count: reservations.length,
    active_bookings_count: activeCount,
    past_bookings_count: pastCount,
    extensions_count: extensions.length || reservations.reduce((acc, r) => acc + num(r.extensionsCount, 0), 0),
    open_problems_count: openProblems.length,
    open_complaints_count: openComplaints.length,
    follow_ups_count: followUps.length,
    notes_count: notes.length,
    total_amount: Number(totalAmount.toFixed(2)),
    paid_amount: Number(paidAmount.toFixed(2)),
    last_reservation_number: lastRes ? str(lastRes.reservationNumber) : '',
    last_reservation_date: lastRes ? str(lastRes.startDate || lastRes.createdAt) : '',
    last_reservation_status: lastRes ? str(lastRes.internalStatus || lastRes.originalStatusAr || lastRes.originalStatusCode) : '',
    last_company_name: lastRes ? str(lastRes.companyName) : ''
  }, session.user);

  const financialSummary = {
    totalAmount: Number(totalAmount.toFixed(2)),
    baseAmount: Number(baseAmount.toFixed(2)),
    extensionsAmount: Number(extensionsAmount.toFixed(2)),
    paidAmount: Number(paidAmount.toFixed(2)),
    refundAmount: Number(refundAmount.toFixed(2)),
    penaltyAmount: Number(penaltyAmount.toFixed(2)),
    outstandingAmount: Math.max(0, Number((totalAmount - paidAmount).toFixed(2))),
    bookingsCount: reservations.length,
    activeBookingsCount: activeCount,
    pastBookingsCount: pastCount,
    extensionsCount: extensions.length,
    companiesCount: companiesSet.size,
    openProblemsCount: openProblems.length,
    openComplaintsCount: openComplaints.length
  };

  // Unified chronological timeline
  const timeline: Array<{ id: string; kind: string; title: string; subtitle: string; actor: string; status: string; at: string; entityId?: string }> = [];
  for (const r of reservations) {
    timeline.push({
      id: `TL_RES_${r.id}`,
      kind: 'reservation',
      title: `حجز ${r.reservationNumber} — ${r.carName || r.companyName || ''}`,
      subtitle: `${r.startDate || ''} ← ${r.extendedUntilDate || r.endDate || ''} · ${Number(r.totalAmount || 0).toLocaleString('en-US')} ر.س`,
      actor: str(r.companyName),
      status: str(r.internalStatus),
      at: str(r.sourceCreatedAt || r.createdAt || r.startDate),
      entityId: r.id
    });
  }
  for (const e of extensions) {
    timeline.push({
      id: `TL_EXT_${e.id}`,
      kind: 'extension',
      title: `تمديد #${e.sequenceNumber || e.extensionNumber} على الحجز ${e.reservationNumber}`,
      subtitle: `${e.extendDays || 0} يوم · ${Number(e.amount || 0).toLocaleString('en-US')} ر.س`,
      actor: str(e.paymentMethod || e.extensionTypeAr),
      status: str(e.statusAr || e.paymentStatus),
      at: str(e.paymentDate || e.startDate || e.syncedAt),
      entityId: e.reservationId
    });
  }
  for (const p of problems) {
    timeline.push({
      id: `TL_PRB_${p.id}`,
      kind: 'problem',
      title: `${p.ticketType === 'شكوى' ? 'شكوى' : 'مشكلة'} ${p.problemNumber}${p.reservationNumber ? ` (${p.reservationNumber})` : ''}`,
      subtitle: str(p.description),
      actor: str(p.createdByName),
      status: str(p.status),
      at: str(p.createdAt),
      entityId: p.id
    });
  }
  for (const f of followUps) {
    timeline.push({
      id: `TL_FU_${f.id}`,
      kind: 'followup',
      title: `متابعة حجز ${f.reservationNumber}: ${f.action || f.status}`,
      subtitle: str(f.notes),
      actor: str(f.employeeName),
      status: str(f.status),
      at: str(f.createdAt),
      entityId: f.reservationId
    });
  }
  for (const n of notes) {
    timeline.push({
      id: `TL_NOTE_${n.id}`,
      kind: 'note',
      title: `${n.noteType}${n.title ? `: ${n.title}` : ''}${n.reservationNumber ? ` (الحجز ${n.reservationNumber})` : ''}`,
      subtitle: str(n.content),
      actor: str(n.createdByName),
      status: str(n.statusName || n.noteType),
      at: str(n.createdAt),
      entityId: n.id
    });
  }
  for (const a of actRes.rows || []) {
    timeline.push({
      id: `TL_ACT_${str(a.id)}`,
      kind: 'activity',
      title: `${str(a.action_type)}${a.entity_id ? ` (${str(a.entity_id)})` : ''}`,
      subtitle: str(a.details),
      actor: str(a.user_name),
      status: '',
      at: a.created_at instanceof Date ? a.created_at.toISOString() : str(a.created_at)
    });
  }
  timeline.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));

  return {
    customer,
    reservations: redactReservationsList(reservations, session.user),
    extensions,
    problems,
    followUps,
    notes,
    noteStatuses,
    notesConfig,
    financialSummary,
    timeline: timeline.slice(0, 250),
    employees: empsRes.rows.map((e: any) => ({ id: str(e.id), name: str(e.name), role: str(e.role) }))
  };
}

export async function createCustomer(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_customer_details');
  if (crmCore && typeof crmCore.canUserUseActionButton === 'function' && !crmCore.canUserUseActionButton(session.user, 'act_edit_customer')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية إضافة أو تعديل العملاء.');
  }
  const fullName = str(payload.fullName);
  const phone = str(payload.phone);
  const email = str(payload.email);
  if (!fullName) throw new Error('VALIDATION_ERROR: اسم العميل مطلوب.');
  if (!phone && !email) throw new Error('VALIDATION_ERROR: رقم الجوال أو البريد الإلكتروني مطلوب.');

  const phoneMeta = typeof crmCore.extractPhoneCountryCode === 'function'
    ? crmCore.extractPhoneCountryCode(phone)
    : { countryCode: '', nationalPhone: phone.replace(/\D/g, ''), normalizedPhone: phone.replace(/\D/g, '') };

  const canViewId = typeof crmCore.canUserViewCustomerId === 'function'
    ? crmCore.canUserViewCustomerId(session.user)
    : false;
  const idNumber = canViewId ? str(payload.idNumber) : '';
  const idType = canViewId
    ? (str(payload.idType) || (typeof crmCore.detectCustomerIdType === 'function' ? crmCore.detectCustomerIdType(idNumber) : ''))
    : '';
  const customerKey = typeof crmCore.buildCustomerCanonicalKey === 'function'
    ? crmCore.buildCustomerCanonicalKey({ phone, email, idNumber, name: fullName })
    : (phoneMeta.normalizedPhone ? `PH:${phoneMeta.normalizedPhone}` : `NAME:${fullName}`);

  return runWithIdempotency(executor, session.user.id, 'createCustomer', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      const existingQ = await tx.query(`SELECT id FROM customers WHERE customer_key = $1 LIMIT 1`, [customerKey]);
      if (existingQ.rows[0]) {
        throw new Error('CONFLICT: يوجد عميل مسجل بنفس رقم الجوال أو الهوية بالفعل.');
      }

      const id = deterministicCustomerId(customerKey);
      const statusList: string[] = crmCore.CUSTOMER_STATUS_LIST || ['جديد'];
      const status = statusList.includes(str(payload.status)) ? str(payload.status) : 'جديد';
      const statusOverride = status !== 'جديد';
      const notes = str(payload.notes);
      const tags = Array.isArray(payload.tags) ? payload.tags.map((t: any) => str(t)).filter(Boolean) : [];
      const nowIso = new Date().toISOString();

      await tx.query(
        `INSERT INTO customers (
           id, customer_key, full_name, phone, country_code, normalized_phone,
           email, id_number, id_type, status, status_override,
           notes, tags, source,
           last_contact_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'manual',$14,$15::timestamptz,$15::timestamptz)`,
        [
          id, customerKey, fullName, phone, str(payload.countryCode || phoneMeta.countryCode), phoneMeta.normalizedPhone,
          email, idNumber, idType, status, statusOverride,
          notes, JSON.stringify(tags), '', nowIso
        ]
      );

      await logActivity(tx, session.user, 'إضافة عميل', 'Customer', id, `${fullName} (${phone || email})`);
      const resQ = await tx.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [id]);
      return formatCustomerSummaryRow(resQ.rows[0], session.user);
    });
    return out;
  });
}

export async function updateCustomerProfile(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_customer_details');
  if (crmCore && typeof crmCore.canUserUseActionButton === 'function' && !crmCore.canUserUseActionButton(session.user, 'act_edit_customer')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية تعديل بيانات العملاء.');
  }
  const customerId = str(payload.customerId || payload.id);
  if (!customerId) throw new Error('VALIDATION_ERROR: معرف العميل مطلوب.');

  const canViewId = typeof crmCore.canUserViewCustomerId === 'function'
    ? crmCore.canUserViewCustomerId(session.user)
    : false;

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [customerId]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: العميل غير موجود.');

    const nextFullName = payload.fullName !== undefined ? (str(payload.fullName) || str(cur.full_name)) : str(cur.full_name);
    const nextPhone = payload.phone !== undefined ? str(payload.phone) : str(cur.phone);
    const phoneMeta = typeof crmCore.extractPhoneCountryCode === 'function'
      ? crmCore.extractPhoneCountryCode(nextPhone)
      : { countryCode: '', normalizedPhone: nextPhone.replace(/\D/g, '') };
    const nextCountryCode = payload.countryCode !== undefined
      ? str(payload.countryCode)
      : (payload.phone !== undefined ? str(phoneMeta.countryCode) : str(cur.country_code));
    const nextNormPhone = payload.phone !== undefined ? str(phoneMeta.normalizedPhone) : str(cur.normalized_phone);
    const nextEmail = payload.email !== undefined ? str(payload.email) : str(cur.email);
    const nextIdNumber = (payload.idNumber !== undefined && canViewId) ? str(payload.idNumber) : str(cur.id_number);
    const nextIdType = (payload.idType !== undefined && canViewId)
      ? str(payload.idType)
      : ((payload.idNumber !== undefined && canViewId && typeof crmCore.detectCustomerIdType === 'function')
        ? crmCore.detectCustomerIdType(nextIdNumber)
        : str(cur.id_type));

    const validStatuses: string[] = crmCore.CUSTOMER_STATUS_LIST || ['جديد', 'نشط', 'متكرر', 'VIP', 'يحتاج متابعة', 'لديه مشكلة', 'غير نشط', 'محظور'];
    let nextStatus = str(cur.status || 'جديد');
    let nextStatusOverride = Boolean(cur.status_override);
    if (payload.autoStatus === true) {
      nextStatusOverride = false;
    } else if (payload.status !== undefined && validStatuses.includes(str(payload.status))) {
      nextStatus = str(payload.status);
      nextStatusOverride = true;
    }

    const nextNotes = payload.notes !== undefined ? str(payload.notes) : str(cur.notes);
    const nextTags = Array.isArray(payload.tags)
      ? payload.tags.map((t: any) => str(t)).filter(Boolean)
      : parseJsonArray<string>(cur.tags);
    const nowIso = new Date().toISOString();

    await tx.query(
      `UPDATE customers
       SET full_name = $2, phone = $3, country_code = $4, normalized_phone = $5,
           email = $6, id_number = $7, id_type = $8,
           status = $9, status_override = $10, notes = $11, tags = $12::jsonb,
           updated_at = $13::timestamptz
       WHERE id = $1`,
      [
        customerId, nextFullName, nextPhone, nextCountryCode, nextNormPhone,
        nextEmail, nextIdNumber, nextIdType,
        nextStatus, nextStatusOverride, nextNotes, JSON.stringify(nextTags), nowIso
      ]
    );

    const diffs = crmCore.computeAuditFieldDiffs(
      { fullName: cur.full_name, phone: cur.phone, email: cur.email, status: cur.status, notes: cur.notes },
      { fullName: nextFullName, phone: nextPhone, email: nextEmail, status: nextStatus, notes: nextNotes },
      [
        { field: 'fullName', label: 'الاسم' },
        { field: 'phone', label: 'الجوال' },
        { field: 'email', label: 'البريد الإلكتروني' },
        { field: 'status', label: 'حالة العميل' },
        { field: 'notes', label: 'الملاحظات' }
      ]
    );
    await logActivity(tx, session.user, 'تحديث ملف عميل', 'Customer', customerId, `${nextFullName}`, diffs);
    const updatedQ = await tx.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
    return formatCustomerSummaryRow(updatedQ.rows[0], session.user);
  });

  return { customer: out };
}

// ---------- CUSTOMER NOTES SYSTEM, STATUSES, ATTACHMENTS & ADMIN SETTINGS ----------

export async function getCustomerNotesConfig(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const [config, statuses] = await Promise.all([
    loadCustomerNotesConfigNormalized(executor),
    loadCustomerNoteStatusesList(executor, true)
  ]);
  return { config, statuses };
}

export async function saveCustomerNotesConfig(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const canCfg = crmCore.canUserPerform(session.user, 'manage_customer_notes_settings')
    || crmCore.canUserPerform(session.user, 'manage_customer_notes_buttons')
    || crmCore.canUserPerform(session.user, 'manage_settings');
  if (!canCfg) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية تعديل إعدادات ملاحظات العملاء.');
  }
  const prevConfig = await loadCustomerNotesConfigNormalized(executor);
  const rawInput = payload.config && typeof payload.config === 'object' ? payload.config : payload;
  const nextConfig = crmCore.normalizeCustomerNotesConfig(rawInput);

  if (!crmCore.canUserPerform(session.user, 'manage_customer_notes_buttons') && !crmCore.canUserPerform(session.user, 'manage_settings')) {
    nextConfig.buttons = prevConfig.buttons;
  }

  nextConfig.updatedAt = new Date().toISOString();
  nextConfig.updatedBy = session.user.name;

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('customer_notes_config', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(nextConfig), session.user.name]
    );
    await logActivity(
      tx,
      session.user,
      'تحديث إعدادات ملاحظات العملاء',
      'Settings',
      'customer_notes_config',
      `تحديث قواعد وإعدادات أزرار قسم ملاحظات العملاء وقسم العملاء`
    );
  });

  invalidateScopes(executor, ['settings', 'customers', 'dashboard', 'activity']);
  return { config: nextConfig };
}

export async function getCustomerNoteStatuses(executor: DbExecutor, session: AuthSession) {
  requireApiAccess(session);
  const items = await loadCustomerNoteStatusesList(executor, true);
  return { items };
}

export async function saveCustomerNoteStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_customer_note_statuses');
  const id = str(payload.id);
  const name = str(payload.name);
  const description = str(payload.description);
  const color = /^#[0-9a-fA-F]{3,8}$/.test(str(payload.color)) ? str(payload.color) : '#3B82F6';
  const sortOrder = Math.max(0, Math.floor(num(payload.sortOrder, 0)));
  const isActive = payload.isActive !== false;
  const isDefault = Boolean(payload.isDefault);
  const allowAgentSelect = payload.allowAgentSelect !== false;
  const isClosedStatus = Boolean(payload.isClosedStatus);

  if (!name) {
    throw new Error('VALIDATION_ERROR: اسم حالة الملاحظة مطلوب.');
  }

  const out = await executor.withTransaction(async (tx) => {
    await ensureDefaultCustomerNoteStatuses(tx);
    const allRes = await tx.query(`SELECT * FROM customer_note_statuses`);
    const normNew = typeof crmCore.normalizeSearchText === 'function' ? crmCore.normalizeSearchText(name) : name.toLowerCase();
    const dup = (allRes.rows || []).find((r: any) => {
      if (id && str(r.id) === id) return false;
      const rn = typeof crmCore.normalizeSearchText === 'function' ? crmCore.normalizeSearchText(r.name) : str(r.name).toLowerCase();
      return rn === normNew;
    });
    if (dup) {
      throw new Error(`VALIDATION_ERROR: توجد حالة بنفس الاسم "${str(dup.name)}" بالفعل.`);
    }

    const nowIso = new Date().toISOString();
    const targetId = id || generateId('CNST');

    if (isDefault) {
      await tx.query(`UPDATE customer_note_statuses SET is_default = FALSE WHERE id <> $1`, [targetId]);
    }

    if (id) {
      const exQ = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [id]);
      const prev = exQ.rows[0];
      if (!prev) throw new Error('NOT_FOUND: الحالة المطلوبة غير موجودة.');
      await tx.query(
        `UPDATE customer_note_statuses
         SET name = $2, description = $3, color = $4, sort_order = $5,
             is_active = $6, is_default = $7, allow_agent_select = $8, is_closed_status = $9,
             updated_at = $10::timestamptz
         WHERE id = $1`,
        [id, name, description, color, sortOrder, isActive, isDefault, allowAgentSelect, isClosedStatus, nowIso]
      );
      await tx.query(
        `UPDATE customer_notes SET status_name = $2, status_color = $3, updated_at = $4::timestamptz WHERE status_id = $1`,
        [id, name, color, nowIso]
      );
      await logActivity(tx, session.user, 'تعديل حالة ملاحظة عميل', 'CustomerNoteStatus', id, `${str(prev.name)} ← ${name}`);
    } else {
      await tx.query(
        `INSERT INTO customer_note_statuses (
           id, name, description, color, sort_order, is_active, is_default,
           allow_agent_select, is_closed_status, created_by_id, created_by_name, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$12::timestamptz)`,
        [targetId, name, description, color, sortOrder, isActive, isDefault, allowAgentSelect, isClosedStatus, session.user.id, session.user.name, nowIso]
      );
      await logActivity(tx, session.user, 'إضافة حالة ملاحظة عميل', 'CustomerNoteStatus', targetId, name);
    }

    const saved = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [targetId]);
    return formatCustomerNoteStatusRow(saved.rows[0]);
  });

  invalidateScopes(executor, ['customers', 'settings', 'activity']);
  return { status: out };
}

export async function toggleCustomerNoteStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_customer_note_statuses');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف الحالة مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [id]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الحالة غير موجودة.');
    const nextActive = payload.isActive !== undefined ? Boolean(payload.isActive) : !Boolean(cur.is_active);
    const nowIso = new Date().toISOString();
    await tx.query(
      `UPDATE customer_note_statuses SET is_active = $2, updated_at = $3::timestamptz WHERE id = $1`,
      [id, nextActive, nowIso]
    );
    await logActivity(
      tx,
      session.user,
      nextActive ? 'تفعيل حالة ملاحظة عميل' : 'تعطيل حالة ملاحظة عميل',
      'CustomerNoteStatus',
      id,
      str(cur.name)
    );
    const updated = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [id]);
    return formatCustomerNoteStatusRow(updated.rows[0]);
  });

  invalidateScopes(executor, ['customers', 'settings', 'activity']);
  return { status: out };
}

export async function deleteCustomerNoteStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'manage_customer_note_statuses');
  const id = str(payload.id);
  const replacementStatusId = str(payload.replacementStatusId);
  if (!id) throw new Error('VALIDATION_ERROR: معرف الحالة مطلوب.');

  const out = await executor.withTransaction(async (tx) => {
    const curQ = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [id]);
    const cur = curQ.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الحالة غير موجودة.');

    const cntRes = await tx.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM customer_notes WHERE deleted_at IS NULL AND (status_id = $1 OR (COALESCE(status_id, '') = '' AND status_name = $2))`,
      [id, str(cur.name)]
    );
    const linkedNotesCount = num(cntRes.rows[0]?.cnt, 0);

    if (linkedNotesCount > 0 && !replacementStatusId) {
      throw new Error(`VALIDATION_ERROR: الحالة "${str(cur.name)}" مرتبطة بـ ${linkedNotesCount} ملاحظة حالية. يرجى اختيار حالة بديلة لنقل الملاحظات إليها أو تعطيل الحالة.`);
    }

    let migratedToName = '';
    if (linkedNotesCount > 0 && replacementStatusId) {
      if (replacementStatusId === id) {
        throw new Error('VALIDATION_ERROR: لا يمكن اختيار نفس الحالة المحذوفة كحالة بديلة.');
      }
      const repQ = await tx.query(`SELECT * FROM customer_note_statuses WHERE id = $1 LIMIT 1`, [replacementStatusId]);
      const rep = repQ.rows[0];
      if (!rep) throw new Error('NOT_FOUND: الحالة البديلة المحددة غير موجودة.');
      migratedToName = str(rep.name);
      const nowIso = new Date().toISOString();
      await tx.query(
        `UPDATE customer_notes
         SET status_id = $2, status_name = $3, status_color = $4,
             is_closed = $5, updated_at = $6::timestamptz
         WHERE status_id = $1 OR (COALESCE(status_id, '') = '' AND status_name = $7)`,
        [id, str(rep.id), str(rep.name), str(rep.color), Boolean(rep.is_closed_status), nowIso, str(cur.name)]
      );
    }

    await tx.query(`DELETE FROM customer_note_statuses WHERE id = $1`, [id]);
    await logActivity(
      tx,
      session.user,
      'حذف حالة ملاحظة عميل',
      'CustomerNoteStatus',
      id,
      migratedToName ? `${str(cur.name)} (نُقلت ${linkedNotesCount} ملاحظة إلى ${migratedToName})` : str(cur.name)
    );
    return { deleted: true, id, migratedCount: linkedNotesCount, replacementStatusId };
  });

  invalidateScopes(executor, ['customers', 'settings', 'activity']);
  return out;
}

export async function getCustomerNotes(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const canView = crmCore.canUserPerform(session.user, 'view_customer_notes')
    || crmCore.canUserPerform(session.user, 'view_customers');
  if (!canView) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية عرض ملاحظات العملاء.');
  }

  const config = await loadCustomerNotesConfigNormalized(executor);
  if (config.general && config.general.enabled === false && session.user.role !== 'developer') {
    throw new Error('FORBIDDEN: قسم ملاحظات العملاء معطل حاليًا من إعدادات النظام.');
  }

  const settings = await getSettingsMap(executor);
  const allowAgentViewAll = settings.allow_agent_view_all !== false;
  const canViewAllNotes = crmCore.canUserPerform(session.user, 'view_all_customer_notes') || allowAgentViewAll;

  const customerId = str(payload.customerId);
  const reservationId = str(payload.reservationId);
  const problemId = str(payload.problemId);
  const statusFilter = str(payload.statusId || payload.status);
  const noteTypeFilter = str(payload.noteType);
  const sourceSectionFilter = str(payload.sourceSection);
  const assignedEmpFilter = str(payload.assignedEmployeeId);
  const dateFrom = str(payload.dateFrom);
  const dateTo = str(payload.dateTo);
  const search = str(payload.search);
  const sortBy = str(payload.sortBy || config.general?.defaultSort || 'newest');

  const maxLimit = Math.max(10, Math.min(500, num(config.general?.maxResults, 200)));
  const defaultPageSize = Math.max(5, Math.min(100, num(config.general?.pageSize, 25)));
  const pageSize = Math.min(maxLimit, Math.max(5, Math.floor(num(payload.pageSize, defaultPageSize))));
  const page = Math.max(1, Math.floor(num(payload.page, 1)));

  const params: any[] = [];
  const clauses: string[] = [`cn.deleted_at IS NULL`];

  if (session.user.role === 'agent' && !canViewAllNotes) {
    params.push(session.user.id);
    const pUid = `$${params.length}`;
    params.push(JSON.stringify([session.user.id]));
    const pUidJson = `$${params.length}`;
    clauses.push(`(
      cn.created_by_id = ${pUid} OR
      cn.assigned_employee_id = ${pUid} OR
      EXISTS (SELECT 1 FROM reservations r WHERE r.id = cn.reservation_id AND r.assigned_employee_ids @> ${pUidJson}::jsonb)
    )`);
  }

  if (customerId) { params.push(customerId); clauses.push(`cn.customer_id = $${params.length}`); }
  if (reservationId) { params.push(reservationId); clauses.push(`(cn.reservation_id = $${params.length} OR cn.reservation_number = $${params.length})`); }
  if (problemId) { params.push(problemId); clauses.push(`(cn.problem_id = $${params.length} OR cn.problem_number = $${params.length})`); }
  if (statusFilter) {
    params.push(statusFilter);
    const pIdx = `$${params.length}`;
    clauses.push(`(cn.status_id = ${pIdx} OR cn.status_name = ${pIdx})`);
  }
  if (noteTypeFilter) { params.push(noteTypeFilter); clauses.push(`cn.note_type = $${params.length}`); }
  if (sourceSectionFilter) { params.push(sourceSectionFilter); clauses.push(`cn.source_section = $${params.length}`); }
  if (assignedEmpFilter) { params.push(assignedEmpFilter); clauses.push(`cn.assigned_employee_id = $${params.length}`); }
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`cn.created_at >= ($${params.length}::date)::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`cn.created_at < (($${params.length}::date + INTERVAL '1 day'))::timestamptz`);
  }
  if (search) {
    const cond = buildPgSearchCondition(
      ['cn.title', 'cn.content', 'cn.reservation_number', 'cn.problem_number', 'cn.status_name', 'cn.created_by_name', 'c.full_name', 'c.phone'],
      search,
      params
    );
    if (cond) clauses.push(cond);
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  let orderSql = `cn.created_at DESC`;
  if (sortBy === 'oldest') orderSql = `cn.created_at ASC`;
  else if (sortBy === 'updated') orderSql = `cn.updated_at DESC`;

  const [countRes, listRes, statsRes, statuses] = await Promise.all([
    executor.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM customer_notes cn LEFT JOIN customers c ON c.id = cn.customer_id ${whereSql}`,
      params
    ),
    executor.query(
      `SELECT cn.*,
              COALESCE(c.full_name, '') AS customer_name,
              COALESCE(c.phone, '') AS customer_phone
       FROM customer_notes cn
       LEFT JOIN customers c ON c.id = cn.customer_id
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    executor.query<{ total: number; closed_cnt: number; open_cnt: number; internal_cnt: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE cn.is_closed = TRUE)::int AS closed_cnt,
              COUNT(*) FILTER (WHERE cn.is_closed = FALSE)::int AS open_cnt,
              COUNT(*) FILTER (WHERE cn.is_internal = TRUE)::int AS internal_cnt
       FROM customer_notes cn
       LEFT JOIN customers c ON c.id = cn.customer_id
       ${whereSql}`,
      params
    ),
    loadCustomerNoteStatusesList(executor, false)
  ]);

  const total = num(countRes.rows[0]?.cnt, 0);
  const items = await enrichCustomerNoteRows(executor, listRes.rows || [], session.user);
  const stRow = statsRes.rows[0] || { total: 0, closed_cnt: 0, open_cnt: 0, internal_cnt: 0 };

  return {
    items,
    statuses,
    config,
    stats: {
      total: num(stRow.total, 0),
      open: num(stRow.open_cnt, 0),
      closed: num(stRow.closed_cnt, 0),
      internal: num(stRow.internal_cnt, 0)
    },
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function addCustomerNote(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'add_customer_note');
  const [config, statuses] = await Promise.all([
    loadCustomerNotesConfigNormalized(executor),
    loadCustomerNoteStatusesList(executor, false)
  ]);
  assertCustomerNoteButtonAllowed(config, 'add_note', session.user);

  const val = crmCore.validateCustomerNotePayload(payload, config, statuses, session.user);
  if (!val.valid) {
    throw new Error(`VALIDATION_ERROR: ${val.message || 'بيانات الملاحظة غير مكتملة.'}`);
  }

  let customerId = str(payload.customerId);
  let reservationId = str(payload.reservationId) || null;
  let reservationNumber = str(payload.reservationNumber);
  const problemId = str(payload.problemId) || '';
  let problemNumber = str(payload.problemNumber);
  const sourceSection = str(payload.sourceSection || (problemId ? 'problems' : reservationId ? 'reservations' : 'customers')) || 'customers';
  const assignedEmployeeId = str(payload.assignedEmployeeId);

  return runWithIdempotency(executor, session.user.id, 'addCustomerNote', str(payload.clientRequestId), async () => {
    const out = await executor.withTransaction(async (tx) => {
      if (reservationId && !reservationNumber) {
        const rq = await tx.query<{ id: string; reservation_number: string; customer_id: string }>(
          `SELECT id, reservation_number, customer_id FROM reservations WHERE id = $1 OR reservation_number = $1 LIMIT 1`,
          [reservationId]
        );
        if (rq.rows[0]) {
          reservationId = str(rq.rows[0].id);
          reservationNumber = str(rq.rows[0].reservation_number);
          if (!customerId && rq.rows[0].customer_id) customerId = str(rq.rows[0].customer_id);
        }
      }
      if (problemId && !problemNumber) {
        const pq = await tx.query<{ problem_number: string; reservation_id: string; reservation_number: string; customer_id: string }>(
          `SELECT problem_number, reservation_id, reservation_number, customer_id FROM problems WHERE id = $1 OR problem_number = $1 LIMIT 1`,
          [problemId]
        );
        if (pq.rows[0]) {
          problemNumber = str(pq.rows[0].problem_number);
          if (!reservationId && pq.rows[0].reservation_id) reservationId = str(pq.rows[0].reservation_id);
          if (!reservationNumber && pq.rows[0].reservation_number) reservationNumber = str(pq.rows[0].reservation_number);
          if (!customerId && pq.rows[0].customer_id) customerId = str(pq.rows[0].customer_id);
        }
      }

      if (!customerId && !config.addNote?.allowStandalone) {
        throw new Error('VALIDATION_ERROR: يجب ربط الملاحظة بعميل.');
      }

      let customerName = '';
      if (customerId) {
        const custQ = await tx.query<{ id: string; full_name: string }>(
          `SELECT id, full_name FROM customers WHERE id = $1 FOR UPDATE`,
          [customerId]
        );
        if (!custQ.rows[0]) throw new Error('NOT_FOUND: العميل غير موجود.');
        customerName = str(custQ.rows[0].full_name);
      }

      let assignedEmployeeName = '';
      if (assignedEmployeeId) {
        const eq = await tx.query<{ name: string }>(`SELECT name FROM employees WHERE id = $1 LIMIT 1`, [assignedEmployeeId]);
        if (!eq.rows[0]) throw new Error('NOT_FOUND: الموظف المعين لمتابعة الملاحظة غير موجود.');
        assignedEmployeeName = str(eq.rows[0].name);
      }

      const incomingAttachments: any[] = Array.isArray(payload.attachments) ? payload.attachments : [];
      if (incomingAttachments.length > 0) {
        assertCustomerNoteButtonAllowed(config, 'attach_file', session.user);
        const maxBytes = Math.max(1, num(config.addNote?.maxAttachmentSizeMb, 5)) * 1024 * 1024;
        const allowedMime = Array.isArray(config.addNote?.allowedAttachmentTypes) ? config.addNote.allowedAttachmentTypes : [];
        for (const att of incomingAttachments) {
          const sz = num(att.fileSize, 0);
          if (sz > maxBytes) {
            throw new Error(`VALIDATION_ERROR: حجم المرفق "${str(att.fileName)}" يتجاوز الحد المسموح (${config.addNote?.maxAttachmentSizeMb || 5} MB).`);
          }
          if (allowedMime.length > 0 && att.mimeType && !allowedMime.includes(str(att.mimeType))) {
            throw new Error(`VALIDATION_ERROR: نوع المرفق "${str(att.mimeType)}" غير مسموح به.`);
          }
        }
      }

      const id = generateId('CNOTE');
      const nowIso = new Date().toISOString();
      const riyadhParts = getRiyadhDateTimeParts(nowIso);
      const riyadhText = `${riyadhParts.date} ${riyadhParts.time}`;
      const stObj = val.status || crmCore.CUSTOMER_NOTE_DEFAULT_STATUSES[0];
      const isClosed = Boolean(stObj.isClosedStatus);

      await tx.query(
        `INSERT INTO customer_notes (
           id, customer_id, reservation_id, reservation_number, problem_id, problem_number,
           title, note_type, content, status_id, status_name, status_color,
           assigned_employee_id, assigned_employee_name, is_internal, is_closed,
           closed_at, closed_by_id, closed_by_name, source_section,
           created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$21,$22,$23::timestamptz,$23::timestamptz
         )`,
        [
          id, customerId, reservationId, reservationNumber, problemId, problemNumber,
          val.title, val.noteType, val.content, str(stObj.id), str(stObj.name), str(stObj.color),
          assignedEmployeeId, assignedEmployeeName, val.isInternal, isClosed,
          isClosed ? nowIso : null, isClosed ? session.user.id : '', isClosed ? session.user.name : '', sourceSection,
          session.user.id, session.user.name, nowIso
        ]
      );

      const savedAttachments: any[] = [];
      for (const att of incomingAttachments) {
        const attId = generateId('CNATT');
        await tx.query(
          `INSERT INTO customer_note_attachments (
             id, note_id, file_name, mime_type, file_size, storage_url, uploaded_by_id, uploaded_by_name, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
          [
            attId,
            id,
            str(att.fileName || 'attachment'),
            str(att.mimeType || 'application/octet-stream'),
            Math.max(0, Math.floor(num(att.fileSize, 0))),
            str(att.storageUrl || att.dataUrl || ''),
            session.user.id,
            session.user.name,
            nowIso
          ]
        );
        savedAttachments.push({
          id: attId,
          noteId: id,
          fileName: str(att.fileName || 'attachment'),
          mimeType: str(att.mimeType || 'application/octet-stream'),
          fileSize: Math.max(0, Math.floor(num(att.fileSize, 0))),
          storageUrl: str(att.storageUrl || att.dataUrl || ''),
          uploadedById: session.user.id,
          uploadedByName: session.user.name,
          createdAt: nowIso
        });
      }

      if (customerId) {
        const isContactType = val.noteType !== 'ملاحظة';
        await tx.query(
          `UPDATE customers
           SET last_contact_ts = CASE WHEN $2::boolean THEN GREATEST(COALESCE(last_contact_ts, $3::timestamptz), $3::timestamptz) ELSE last_contact_ts END,
               last_contact_at = CASE WHEN $2::boolean THEN $4::text ELSE last_contact_at END,
               updated_at = $3::timestamptz
           WHERE id = $1`,
          [customerId, isContactType, nowIso, riyadhText]
        );
      }

      await recordCustomerNoteHistory(tx, {
        noteId: id,
        actionType: 'إنشاء ملاحظة',
        fieldName: 'status',
        oldValue: '',
        newValue: `${str(stObj.name)} — ${val.content.slice(0, 80)}`,
        actor: session.user
      });

      await dispatchMentionNotifications(tx, {
        texts: [val.title, val.content],
        sender: session.user,
        entityType: 'Customer',
        entityId: customerId || id,
        label: customerName || reservationNumber || id,
        sourceKey: str(payload.clientRequestId) ? `req:${str(payload.clientRequestId)}` : `cnote:${id}`
      });

      await dispatchCustomerNoteConfigNotifications(tx, config, 'onAdd', {
        actor: session.user,
        noteId: id,
        customerId,
        title: `ملاحظة عميل جديدة: ${customerName || reservationNumber || ''}`.trim(),
        message: `${session.user.name}: ${val.content.slice(0, 120)}`,
        eventKeySeed: id
      });

      if (assignedEmployeeId) {
        await dispatchCustomerNoteConfigNotifications(tx, config, 'onAssign', {
          actor: session.user,
          noteId: id,
          customerId,
          assignedEmployeeId,
          title: `تم تعيين ملاحظة عميل لك (${customerName || reservationNumber || id})`,
          message: `عين لك ${session.user.name} متابعة الملاحظة: "${val.content.slice(0, 100)}"`,
          eventKeySeed: `${id}:${assignedEmployeeId}`
        });
      }

      if (config.activityLog?.enabled !== false && config.activityLog?.trackAdd !== false && config.activityLog?.logAdd !== false && config.buttons?.add_note?.logActivity !== false) {
        const srcTag = config.activityLog?.includeSourceSection ? ` [المصدر: ${sourceSection}]` : '';
        await logActivity(tx, session.user, `${val.noteType} للعميل`, 'Customer', customerId || id, `${val.content.slice(0, 140)}${srcTag}`);
      }

      return formatCustomerNoteRow(
        {
          id,
          customer_id: customerId,
          customer_name: customerName,
          reservation_id: reservationId || '',
          reservation_number: reservationNumber,
          problem_id: problemId,
          problem_number: problemNumber,
          title: val.title,
          note_type: val.noteType,
          content: val.content,
          status_id: str(stObj.id),
          status_name: str(stObj.name),
          status_color: str(stObj.color),
          status_is_active: true,
          assigned_employee_id: assignedEmployeeId,
          assigned_employee_name: assignedEmployeeName,
          is_internal: val.isInternal,
          is_closed: isClosed,
          closed_at: isClosed ? nowIso : '',
          closed_by_id: isClosed ? session.user.id : '',
          closed_by_name: isClosed ? session.user.name : '',
          source_section: sourceSection,
          created_by_id: session.user.id,
          created_by_name: session.user.name,
          updated_by_id: session.user.id,
          updated_by_name: session.user.name,
          created_at: nowIso,
          updated_at: nowIso
        },
        savedAttachments
      );
    });

    return { note: out };
  });
}

export async function updateCustomerNote(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_customer_note');
  const noteId = str(payload.noteId || payload.id);
  if (!noteId) throw new Error('VALIDATION_ERROR: معرف الملاحظة مطلوب.');

  const [config, statuses] = await Promise.all([
    loadCustomerNotesConfigNormalized(executor),
    loadCustomerNoteStatusesList(executor, false)
  ]);

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [noteId]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الملاحظة غير موجودة.');

    assertOptimisticLock(cur.updated_at instanceof Date ? cur.updated_at.toISOString() : str(cur.updated_at), payload.expectedUpdatedAt);

    const existingObj = formatCustomerNoteRow(cur);
    assertCustomerNoteButtonAllowed(config, 'edit_note', session.user, existingObj);

    const nextPayload = {
      ...payload,
      title: payload.title !== undefined ? payload.title : existingObj.title,
      content: payload.content !== undefined ? payload.content : existingObj.content,
      noteType: payload.noteType !== undefined ? payload.noteType : existingObj.noteType,
      isInternal: payload.isInternal !== undefined ? payload.isInternal : existingObj.isInternal,
      reservationId: payload.reservationId !== undefined ? payload.reservationId : existingObj.reservationId,
      statusId: payload.statusId !== undefined ? payload.statusId : existingObj.statusId
    };
    const mergedStatuses = statuses.map((s) =>
      s.id === existingObj.statusId && !payload.statusId ? { ...s, isActive: true } : s
    );
    const val = crmCore.validateCustomerNotePayload(nextPayload, config, mergedStatuses, session.user);
    if (!val.valid) {
      throw new Error(`VALIDATION_ERROR: ${val.message}`);
    }

    const nowIso = new Date().toISOString();
    const stObj = val.status || { id: existingObj.statusId, name: existingObj.statusName, color: existingObj.statusColor, isClosedStatus: existingObj.isClosed };
    const isClosed = Boolean(stObj.isClosedStatus);

    await tx.query(
      `UPDATE customer_notes
       SET title = $2, note_type = $3, content = $4,
           status_id = $5, status_name = $6, status_color = $7,
           is_internal = $8, is_closed = $9,
           closed_at = CASE WHEN $9::boolean AND closed_at IS NULL THEN $12::timestamptz ELSE CASE WHEN NOT $9::boolean THEN NULL::timestamptz ELSE closed_at END END,
           updated_by_id = $10, updated_by_name = $11, updated_at = $12::timestamptz
       WHERE id = $1`,
      [noteId, val.title, val.noteType, val.content, str(stObj.id), str(stObj.name), str(stObj.color), val.isInternal, isClosed, session.user.id, session.user.name, nowIso]
    );

    const diffs = crmCore.computeAuditFieldDiffs(
      { title: existingObj.title, noteType: existingObj.noteType, content: existingObj.content, statusName: existingObj.statusName },
      { title: val.title, noteType: val.noteType, content: val.content, statusName: str(stObj.name) },
      [
        { field: 'title', label: 'العنوان' },
        { field: 'noteType', label: 'النوع' },
        { field: 'content', label: 'المحتوى' },
        { field: 'statusName', label: 'الحالة' }
      ]
    );

    await recordCustomerNoteHistory(tx, {
      noteId,
      actionType: 'تعديل ملاحظة',
      fieldName: 'content',
      oldValue: existingObj.content.slice(0, 120),
      newValue: val.content.slice(0, 120),
      actor: session.user
    });

    if (config.activityLog?.enabled !== false && config.activityLog?.trackEdit !== false && config.activityLog?.logEdit !== false && config.buttons?.edit_note?.logActivity !== false) {
      await logActivity(tx, session.user, 'تعديل ملاحظة عميل', 'Customer', existingObj.customerId || noteId, val.content.slice(0, 140), config.activityLog?.includeOldNewValues !== false ? diffs : []);
    }

    await dispatchCustomerNoteConfigNotifications(tx, config, 'onReplyUpdate', {
      actor: session.user,
      noteId,
      customerId: existingObj.customerId,
      title: `تحديث ملاحظة عميل`,
      message: `${session.user.name}: ${val.content.slice(0, 110)}`,
      eventKeySeed: `${noteId}:${nowIso}`
    });

    const refreshed = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 LIMIT 1`, [noteId]);
    const list = await enrichCustomerNoteRows(tx, refreshed.rows, session.user);
    return list[0];
  });

  return { note: out };
}

export async function changeCustomerNoteStatus(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'change_customer_note_status');
  const noteId = str(payload.noteId || payload.id);
  const nextStatusId = str(payload.statusId);
  const nextStatusName = str(payload.statusName || payload.status);
  if (!noteId) throw new Error('VALIDATION_ERROR: معرف الملاحظة مطلوب.');
  if (!nextStatusId && !nextStatusName) throw new Error('VALIDATION_ERROR: الحالة الجديدة مطلوبة.');

  const [config, statuses] = await Promise.all([
    loadCustomerNotesConfigNormalized(executor),
    loadCustomerNoteStatusesList(executor, false)
  ]);

  const targetStatus = statuses.find((s) =>
    (nextStatusId && s.id === nextStatusId) || (nextStatusName && s.name === nextStatusName)
  );
  if (!targetStatus) throw new Error('NOT_FOUND: الحالة المحددة غير موجودة.');
  if (!targetStatus.isActive) {
    throw new Error(`VALIDATION_ERROR: الحالة "${targetStatus.name}" معطلة ولا يمكن اختيارها لملاحظة.`);
  }
  if (session.user.role === 'agent' && targetStatus.allowAgentSelect === false) {
    throw new Error(`FORBIDDEN: لا يملك الموظف صلاحية اختيار الحالة "${targetStatus.name}".`);
  }

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [noteId]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الملاحظة غير موجودة.');

    const existingObj = formatCustomerNoteRow(cur);
    assertCustomerNoteButtonAllowed(config, 'change_status', session.user, existingObj);

    const nowIso = new Date().toISOString();
    const isClosed = Boolean(targetStatus.isClosedStatus);

    await tx.query(
      `UPDATE customer_notes
       SET status_id = $2, status_name = $3, status_color = $4,
           is_closed = $5,
           closed_at = CASE WHEN $5::boolean THEN $8::timestamptz ELSE NULL::timestamptz END,
           closed_by_id = CASE WHEN $5::boolean THEN $6::text ELSE ''::text END,
           closed_by_name = CASE WHEN $5::boolean THEN $7::text ELSE ''::text END,
           updated_by_id = $6, updated_by_name = $7, updated_at = $8::timestamptz
       WHERE id = $1`,
      [noteId, str(targetStatus.id), str(targetStatus.name), str(targetStatus.color), isClosed, session.user.id, session.user.name, nowIso]
    );

    await recordCustomerNoteHistory(tx, {
      noteId,
      actionType: 'تغيير الحالة',
      fieldName: 'status',
      oldValue: existingObj.statusName,
      newValue: str(targetStatus.name),
      actor: session.user
    });

    if (config.activityLog?.enabled !== false && config.activityLog?.trackStatusChange !== false && config.activityLog?.logStatusChange !== false && config.buttons?.change_status?.logActivity !== false) {
      await logActivity(
        tx,
        session.user,
        'تغيير حالة ملاحظة عميل',
        'Customer',
        existingObj.customerId || noteId,
        `${existingObj.statusName} ← ${str(targetStatus.name)}`,
        config.activityLog?.includeOldNewValues !== false
          ? [{ field: 'statusName', label: 'حالة الملاحظة', before: existingObj.statusName, after: str(targetStatus.name) }]
          : []
      );
    }

    await dispatchCustomerNoteConfigNotifications(tx, config, isClosed ? 'onClose' : 'onStatusChange', {
      actor: session.user,
      noteId,
      customerId: existingObj.customerId,
      title: isClosed ? `تم إغلاق ملاحظة عميل (${str(targetStatus.name)})` : `تغيرت حالة ملاحظة عميل إلى ${str(targetStatus.name)}`,
      message: `${session.user.name} غير الحالة من "${existingObj.statusName}" إلى "${str(targetStatus.name)}"`,
      eventKeySeed: `${noteId}:${str(targetStatus.id)}:${nowIso}`
    });

    const refreshed = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 LIMIT 1`, [noteId]);
    const list = await enrichCustomerNoteRows(tx, refreshed.rows, session.user);
    return list[0];
  });

  return { note: out };
}

export async function assignCustomerNoteEmployee(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'assign_customer_note');
  const noteId = str(payload.noteId || payload.id);
  const employeeId = str(payload.employeeId);
  if (!noteId) throw new Error('VALIDATION_ERROR: معرف الملاحظة مطلوب.');

  const config = await loadCustomerNotesConfigNormalized(executor);

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [noteId]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الملاحظة غير موجودة.');

    const existingObj = formatCustomerNoteRow(cur);
    assertCustomerNoteButtonAllowed(config, 'assign_note', session.user, existingObj);

    let empName = '';
    if (employeeId) {
      const empQ = await tx.query<{ name: string }>(`SELECT name FROM employees WHERE id = $1 LIMIT 1`, [employeeId]);
      if (!empQ.rows[0]) throw new Error('NOT_FOUND: الموظف المحدد غير موجود.');
      empName = str(empQ.rows[0].name);
    }

    const nowIso = new Date().toISOString();
    await tx.query(
      `UPDATE customer_notes
       SET assigned_employee_id = $2, assigned_employee_name = $3, updated_by_id = $4, updated_by_name = $5, updated_at = $6::timestamptz
       WHERE id = $1`,
      [noteId, employeeId, empName, session.user.id, session.user.name, nowIso]
    );

    await recordCustomerNoteHistory(tx, {
      noteId,
      actionType: 'تعيين موظف للملاحظة',
      fieldName: 'assignedEmployee',
      oldValue: existingObj.assignedEmployeeName || 'غير معين',
      newValue: empName || 'غير معين',
      actor: session.user
    });

    if (config.activityLog?.enabled !== false && config.activityLog?.trackAssign !== false && config.activityLog?.logAssign !== false && config.buttons?.assign_note?.logActivity !== false) {
      await logActivity(tx, session.user, 'تعيين ملاحظة عميل لموظف', 'Customer', existingObj.customerId || noteId, `${empName || 'إلغاء التعيين'}`);
    }

    if (employeeId) {
      await dispatchCustomerNoteConfigNotifications(tx, config, 'onAssign', {
        actor: session.user,
        noteId,
        customerId: existingObj.customerId,
        assignedEmployeeId: employeeId,
        title: `تم تعيين ملاحظة عميل لك`,
        message: `عين لك ${session.user.name} متابعة الملاحظة: "${existingObj.content.slice(0, 100)}"`,
        eventKeySeed: `${noteId}:${employeeId}:${nowIso}`
      });
    }

    const refreshed = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 LIMIT 1`, [noteId]);
    const list = await enrichCustomerNoteRows(tx, refreshed.rows, session.user);
    return list[0];
  });

  return { note: out };
}

export async function deleteCustomerNote(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'delete_customer_note');
  const noteId = str(payload.noteId || payload.id);
  if (!noteId) throw new Error('VALIDATION_ERROR: معرف الملاحظة مطلوب.');

  const config = await loadCustomerNotesConfigNormalized(executor);

  const out = await executor.withTransaction(async (tx) => {
    const q = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [noteId]);
    const cur = q.rows[0];
    if (!cur) throw new Error('NOT_FOUND: الملاحظة غير موجودة.');

    const existingObj = formatCustomerNoteRow(cur);
    assertCustomerNoteButtonAllowed(config, 'delete_note', session.user, existingObj);

    const nowIso = new Date().toISOString();
    await tx.query(
      `UPDATE customer_notes
       SET deleted_at = $2::timestamptz, deleted_by_id = $3, deleted_by_name = $4, updated_at = $2::timestamptz
       WHERE id = $1`,
      [noteId, nowIso, session.user.id, session.user.name]
    );
    await recordSyncTombstone(tx, 'customer_note', [noteId], { customerId: existingObj.customerId });
    await recordCustomerNoteHistory(tx, {
      noteId,
      actionType: 'حذف ملاحظة',
      fieldName: 'deleted',
      oldValue: existingObj.content.slice(0, 100),
      newValue: 'محذوفة',
      actor: session.user
    });

    if (config.activityLog?.enabled !== false && config.activityLog?.trackDelete !== false && config.activityLog?.logDelete !== false && config.buttons?.delete_note?.logActivity !== false) {
      await logActivity(tx, session.user, 'حذف ملاحظة عميل', 'Customer', existingObj.customerId || noteId, existingObj.content.slice(0, 120));
    }

    return { deleted: true, id: noteId, customerId: existingObj.customerId };
  });

  return out;
}

export async function addCustomerNoteAttachment(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_customer_note');
  const noteId = str(payload.noteId);
  const fileName = str(payload.fileName);
  const mimeType = str(payload.mimeType || 'application/octet-stream');
  const fileSize = Math.max(0, Math.floor(num(payload.fileSize, 0)));
  const storageUrl = str(payload.storageUrl || payload.dataUrl);
  if (!noteId || !fileName || !storageUrl) {
    throw new Error('VALIDATION_ERROR: بيانات المرفق غير مكتملة.');
  }

  const config = await loadCustomerNotesConfigNormalized(executor);
  assertCustomerNoteButtonAllowed(config, 'attach_file', session.user);

  const maxBytes = Math.max(1, num(config.addNote?.maxAttachmentSizeMb, 5)) * 1024 * 1024;
  if (fileSize > maxBytes) {
    throw new Error(`VALIDATION_ERROR: حجم الملف يتجاوز الحد الأقصى (${config.addNote?.maxAttachmentSizeMb || 5} MB).`);
  }
  const allowedTypes: string[] = Array.isArray(config.addNote?.allowedAttachmentTypes) ? config.addNote.allowedAttachmentTypes : [];
  if (allowedTypes.length > 0 && !allowedTypes.includes(mimeType)) {
    throw new Error(`VALIDATION_ERROR: نوع الملف "${mimeType}" غير مدعوم.`);
  }

  const out = await executor.withTransaction(async (tx) => {
    const nq = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [noteId]);
    if (!nq.rows[0]) throw new Error('NOT_FOUND: الملاحظة غير موجودة.');
    const noteObj = formatCustomerNoteRow(nq.rows[0]);
    assertCustomerNoteButtonAllowed(config, 'attach_file', session.user, noteObj);

    const attId = generateId('CNATT');
    const nowIso = new Date().toISOString();
    await tx.query(
      `INSERT INTO customer_note_attachments (id, note_id, file_name, mime_type, file_size, storage_url, uploaded_by_id, uploaded_by_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
      [attId, noteId, fileName, mimeType, fileSize, storageUrl, session.user.id, session.user.name, nowIso]
    );
    await recordCustomerNoteHistory(tx, {
      noteId,
      actionType: 'إرفاق ملف',
      fieldName: 'attachment',
      oldValue: '',
      newValue: fileName,
      actor: session.user
    });
    if (config.activityLog?.enabled !== false && config.activityLog?.trackAttachments !== false && config.activityLog?.logAttachments !== false && config.buttons?.attach_file?.logActivity !== false) {
      await logActivity(tx, session.user, 'إرفاق ملف بملاحظة عميل', 'Customer', noteObj.customerId || noteId, fileName);
    }
    return {
      id: attId,
      noteId,
      fileName,
      mimeType,
      fileSize,
      storageUrl,
      uploadedById: session.user.id,
      uploadedByName: session.user.name,
      createdAt: nowIso
    };
  });

  return { attachment: out };
}

export async function deleteCustomerNoteAttachment(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  requirePermission(session, 'edit_customer_note');
  const attachmentId = str(payload.attachmentId || payload.id);
  if (!attachmentId) throw new Error('VALIDATION_ERROR: معرف المرفق مطلوب.');

  const config = await loadCustomerNotesConfigNormalized(executor);

  const out = await executor.withTransaction(async (tx) => {
    const aq = await tx.query(`SELECT * FROM customer_note_attachments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [attachmentId]);
    const att = aq.rows[0];
    if (!att) throw new Error('NOT_FOUND: المرفق غير موجود.');
    const nq = await tx.query(`SELECT * FROM customer_notes WHERE id = $1 LIMIT 1`, [str(att.note_id)]);
    const noteObj = nq.rows[0] ? formatCustomerNoteRow(nq.rows[0]) : undefined;
    assertCustomerNoteButtonAllowed(config, 'delete_attachment', session.user, noteObj);

    const nowIso = new Date().toISOString();
    await tx.query(`UPDATE customer_note_attachments SET deleted_at = $2::timestamptz WHERE id = $1`, [attachmentId, nowIso]);
    await recordCustomerNoteHistory(tx, {
      noteId: str(att.note_id),
      actionType: 'حذف مرفق',
      fieldName: 'attachment',
      oldValue: str(att.file_name),
      newValue: '',
      actor: session.user
    });
    if (config.activityLog?.enabled !== false && config.activityLog?.trackAttachments !== false && config.activityLog?.logAttachments !== false && config.buttons?.delete_attachment?.logActivity !== false) {
      await logActivity(tx, session.user, 'حذف مرفق ملاحظة عميل', 'Customer', noteObj?.customerId || str(att.note_id), str(att.file_name));
    }
    return { deleted: true, id: attachmentId, noteId: str(att.note_id) };
  });

  return out;
}

export async function getCustomerNoteHistory(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  const canHist = crmCore.canUserPerform(session.user, 'view_customer_note_history')
    || crmCore.canUserPerform(session.user, 'view_customer_notes')
    || crmCore.canUserPerform(session.user, 'view_customers');
  if (!canHist) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية عرض سجل تغييرات الملاحظات.');
  }
  const config = await loadCustomerNotesConfigNormalized(executor);
  assertCustomerNoteButtonAllowed(config, 'view_history', session.user);

  const noteId = str(payload.noteId || payload.id);
  if (!noteId) throw new Error('VALIDATION_ERROR: معرف الملاحظة مطلوب.');

  const res = await executor.query(
    `SELECT * FROM customer_note_history WHERE note_id = $1 ORDER BY created_at DESC LIMIT 120`,
    [noteId]
  );
  return {
    items: (res.rows || []).map((r: any) => ({
      id: str(r.id),
      noteId: str(r.note_id),
      actionType: str(r.action_type),
      fieldName: str(r.field_name),
      oldValue: str(r.old_value),
      newValue: str(r.new_value),
      actorId: str(r.actor_id),
      actorName: str(r.actor_name),
      actorRole: str(r.actor_role),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : str(r.created_at)
    }))
  };
}


