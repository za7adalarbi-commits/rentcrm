import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { FIXED_SERVER_CONFIG } from './fixedConfig.js';
import { SCHEMA_SQL } from './schemaSql.js';

const require = createRequire(import.meta.url);
const crmCore = require('./coreBridge.cjs');

const { Pool } = pg;

export interface QueryResultRow {
  [column: string]: any;
}

export interface QueryResult<T extends QueryResultRow = any> {
  rows: T[];
  rowCount: number | null;
}

export interface DbClient {
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
}

export interface DbExecutor extends DbClient {
  withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}

let cachedPool: pg.Pool | null = null;
let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

export function getDatabaseUrl(): string {
  return String(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    FIXED_SERVER_CONFIG.databaseUrl ||
    ''
  ).trim();
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

function shouldUseSsl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  if (lower.includes('sslmode=disable') || process.env.PGSSLMODE === 'disable') {
    return false;
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return lower.includes('sslmode=require');
  }
  return true;
}

export async function testDatabaseConnection(connectionString: string): Promise<{ ok: true }> {
  const clean = String(connectionString || '').trim();
  if (!clean || !/^postgres(ql)?:\/\//i.test(clean)) {
    throw new Error('VALIDATION_ERROR: صيغة رابط قاعدة بيانات PostgreSQL/Neon غير صالحة (يجب أن يبدأ بـ postgresql://).');
  }
  const testPool = new Pool({
    connectionString: clean,
    ssl: shouldUseSsl(clean) ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true
  });
  try {
    await testPool.query('SELECT 1 AS ok');
    return { ok: true };
  } catch (err: any) {
    throw new Error(`DATABASE_CONNECTION_ERROR: تعذر الاتصال بقاعدة بيانات Neon PostgreSQL (${String(err?.message || 'CONNECTION_FAILED').slice(0, 180)}).`);
  } finally {
    await testPool.end().catch(() => undefined);
  }
}

export async function resetPoolForReconfig(nextDatabaseUrl?: string): Promise<void> {
  if (cachedPool) {
    const oldPool = cachedPool;
    cachedPool = null;
    await oldPool.end().catch(() => undefined);
  }
  schemaInitialized = false;
  schemaInitPromise = null;
  if (nextDatabaseUrl !== undefined) {
    const clean = String(nextDatabaseUrl || '').trim();
    FIXED_SERVER_CONFIG.databaseUrl = clean;
    if (clean) process.env.DATABASE_URL = clean;
    else delete process.env.DATABASE_URL;
  }
}

export function getPool(): pg.Pool {
  if (cachedPool) return cachedPool;
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_UNCONFIGURED: متغير DATABASE_URL غير مضبوط في بيئة الخادم.');
  }
  const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX || (isServerless ? 3 : 10)) || (isServerless ? 3 : 10),
    idleTimeoutMillis: isServerless ? 10000 : 20000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: true
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL pool idle error:', err?.message || err);
    if (cachedPool === pool) {
      cachedPool = null;
    }
  });
  cachedPool = pool;
  return cachedPool;
}

export function createPgExecutor(poolInstance?: pg.Pool): DbExecutor {
  const pool = poolInstance || getPool();
  return {
    async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
      const res = await pool.query<T>(text, params);
      return { rows: res.rows, rowCount: res.rowCount };
    },
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txClient: DbClient = {
          query<R extends QueryResultRow = any>(text: string, params?: any[]) {
            return client.query<R>(text, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
          }
        };
        const out = await fn(txClient);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (_rbErr) {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    }
  };
}

function loadSchemaSql(): string {
  const diskPath = path.resolve(process.cwd(), 'database/schema.sql');
  try {
    if (fs.existsSync(diskPath)) {
      return fs.readFileSync(diskPath, 'utf8');
    }
  } catch {
    // Fall back to embedded schema on serverless deployments
  }
  return SCHEMA_SQL;
}

interface ColumnMetaRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

async function runOptionalDdl(executor: DbClient, sql: string): Promise<void> {
  try {
    await executor.query(sql);
  } catch (err: any) {
    console.warn('Non-fatal DDL migration warning:', String(err?.message || err).slice(0, 200));
  }
}

export async function ensureUiOverridesColumns(executor: DbClient): Promise<{
  employeesAdded: boolean;
  usersAdded: boolean;
}> {
  let employeesAdded = false;
  let usersAdded = false;

  const metaRes = await executor.query<ColumnMetaRow>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('employees', 'users')
       AND column_name = 'ui_overrides'`
  );

  const metaRows = Array.isArray(metaRes?.rows) ? metaRes.rows : [];
  const byTable = new Map<string, ColumnMetaRow>();
  for (const r of metaRows) {
    if (r?.table_name) byTable.set(String(r.table_name), r);
  }

  // Ensure users table exists on legacy deployments before altering it
  await runOptionalDdl(
    executor,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'agent',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      ui_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active',
      last_activity TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );

  for (const tbl of ['employees', 'users'] as const) {
    const col = byTable.get(tbl);
    if (!col) {
      await executor.query(
        `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ui_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;`
      );
      if (tbl === 'employees') employeesAdded = true;
      else usersAdded = true;
      continue;
    }

    const udt = String(col.udt_name || col.data_type || '').toLowerCase();
    if (udt && udt !== 'jsonb' && udt !== 'json') {
      // Preserve valid JSON text values while migrating legacy text/varchar column to JSONB
      await executor.query(
        `ALTER TABLE ${tbl}
         ALTER COLUMN ui_overrides TYPE JSONB
         USING (
           CASE
             WHEN ui_overrides IS NULL OR BTRIM(ui_overrides::text) = '' THEN '{}'::jsonb
             WHEN LEFT(BTRIM(ui_overrides::text), 1) = '{' THEN ui_overrides::jsonb
             ELSE '{}'::jsonb
           END
         );`
      );
    }

    if (String(col.is_nullable || '').toUpperCase() === 'YES') {
      await executor.query(
        `UPDATE ${tbl} SET ui_overrides = '{}'::jsonb WHERE ui_overrides IS NULL;`
      );
      await executor.query(
        `ALTER TABLE ${tbl} ALTER COLUMN ui_overrides SET DEFAULT '{}'::jsonb;`
      );
      await executor.query(
        `ALTER TABLE ${tbl} ALTER COLUMN ui_overrides SET NOT NULL;`
      );
    }
  }

  return { employeesAdded, usersAdded };
}

const INCREMENTAL_EXISTING_DB_MIGRATIONS: string[] = [
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pinned_note TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pinned_note_by_id TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pinned_note_by_name TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pinned_note_updated_at TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_answer_count INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS source_order INTEGER;`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS company_number TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS new_company_name TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS car_status_at_request TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rejected_by_id TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rejected_by_name TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rejected_at TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_by_id TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reference_number TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS delivery_failure_reason TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS driver_notes TEXT NOT NULL DEFAULT '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_source_order ON reservations (source_order ASC NULLS LAST);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_customer_id_number ON reservations (customer_id_number) WHERE customer_id_number <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_company_number ON reservations (company_number) WHERE company_number <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_new_company_name ON reservations (new_company_name) WHERE new_company_name <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_rejected_at ON reservations (rejected_at DESC) WHERE rejected_at <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_cancelled_at ON reservations (cancelled_at DESC) WHERE cancelled_at <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_reference_number ON reservations (reference_number) WHERE reference_number <> '';`,
  `ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
  `ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `CREATE TABLE IF NOT EXISTS shift_announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'warning',
    is_pinned BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_by_role TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS employee_delegations (
    id TEXT PRIMARY KEY,
    delegate_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    delegate_employee_name TEXT NOT NULL DEFAULT '',
    delegated_role TEXT NOT NULL DEFAULT 'supervisor',
    granted_by_id TEXT NOT NULL DEFAULT '',
    granted_by_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    revoked_at TEXT NOT NULL DEFAULT '',
    revoked_by_id TEXT NOT NULL DEFAULT '',
    revoked_by_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS reservation_locks (
    reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
    locked_by_id TEXT NOT NULL DEFAULT '',
    locked_by_name TEXT NOT NULL DEFAULT '',
    locked_by_role TEXT NOT NULL DEFAULT '',
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes')
  );`,
  `CREATE TABLE IF NOT EXISTS sync_tombstones (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_status_updated ON reservations (internal_status, updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_company_updated ON reservations (company_name, updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (recipient_employee_id, is_read, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_role_read ON notifications (recipient_role, is_read, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_shift_announcements_active ON shift_announcements (is_active, is_pinned, updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_delegations_emp ON employee_delegations (delegate_employee_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_reservation_locks_expires ON reservation_locks (expires_at);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_start_status ON reservations (start_date, internal_status);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_end_status ON reservations (end_date, internal_status);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_ext_until ON reservations (extended_until_date) WHERE extended_until_date <> '';`,
  `CREATE INDEX IF NOT EXISTS idx_follow_ups_created_desc ON follow_ups (created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_follow_ups_updated_desc ON follow_ups (updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_problems_created_desc ON problems (created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_employees_status_role ON employees (status, role);`,
  `CREATE INDEX IF NOT EXISTS idx_sync_tombstones_type_deleted ON sync_tombstones (entity_type, deleted_at DESC);`
];

export async function ensureSchemaInitialized(executor: DbExecutor): Promise<void> {
  if (schemaInitialized) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      const check = await executor.query<{ reg: string | null; all_ok?: boolean }>(
        `SELECT
          to_regclass('public.employees') AS reg,
          (
            to_regclass('public.employees') IS NOT NULL AND
            to_regclass('public.activity_log') IS NOT NULL AND
            to_regclass('public.sync_log') IS NOT NULL AND
            to_regclass('public.reservations') IS NOT NULL AND
            to_regclass('public.settings') IS NOT NULL AND
            to_regclass('public.sessions') IS NOT NULL
          ) AS all_ok`
      );
      const row = check.rows[0];
      const exists = Boolean(row && row.reg && row.all_ok !== false);
      if (!exists) {
        const schemaSql = loadSchemaSql();
        await executor.query(schemaSql);
      } else {
        await ensureUiOverridesColumns(executor);
        for (const ddl of INCREMENTAL_EXISTING_DB_MIGRATIONS) {
          await runOptionalDdl(executor, ddl);
        }
      }
      await runLifecycleAndNationalIdMaintenance(executor);
      schemaInitialized = true;
    } finally {
      schemaInitPromise = null;
    }
  })();

  return schemaInitPromise;
}

const NEVER_EXCLUDED_LIFECYCLE = new Set([
  'cancelled', 'canceled', 'declined', 'rejected', 'refused',
  'cancelled_by_customer', 'canceled_by_customer', 'customer_cancelled', 'user_cancelled', 'admin_cancelled',
  'rejected_by_admin', 'rejected_by_company', 'provider_rejected', 'admin_rejected', 'auto_rejected',
  'ملغي', 'ملغى', 'ملغاة', 'ملغي من العميل', 'تم الإلغاء', 'تم الالغاء', 'تم الالغاء من العميل', 'تم الإلغاء من العميل',
  'مرفوض', 'مرفوضة', 'مرفوض من الموقع', 'تم الرفض', 'مرفوض من الشركة'
]);

export async function runLifecycleAndNationalIdMaintenance(executor: DbExecutor): Promise<void> {
  // 1) Remove rejected/cancelled statuses from settings.excluded_statuses if seeded earlier
  try {
    const setRes = await executor.query<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'excluded_statuses' LIMIT 1`
    );
    const rawVal = setRes?.rows?.[0]?.value;
    if (rawVal) {
      const parsed = JSON.parse(rawVal);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((x) => String(x || '').trim().toLowerCase())
          .filter((x) => x && !NEVER_EXCLUDED_LIFECYCLE.has(x));
        if (cleaned.length !== parsed.length) {
          await executor.query(
            `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'excluded_statuses'`,
            [JSON.stringify(cleaned)]
          );
        }
      }
    }
  } catch {
    // Non-fatal in mock/unit environments
  }

  // 2) Clear stale cross-timestamps on reservations whose explicit original_status_code dictates another lifecycle
  try {
    await executor.query(
      `UPDATE reservations
       SET rejected_at = '', rejected_by_id = '', rejected_by_name = ''
       WHERE COALESCE(rejected_at, '') <> ''
         AND LOWER(TRIM(COALESCE(original_status_code, ''))) IN ('cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer', 'customer_cancelled', 'user_cancelled', 'admin_cancelled')`
    );
    await executor.query(
      `UPDATE reservations
       SET cancelled_at = '', cancelled_by_id = '', cancelled_by_name = ''
       WHERE COALESCE(cancelled_at, '') <> ''
         AND LOWER(TRIM(COALESCE(original_status_code, ''))) IN ('rejected', 'declined', 'refused', 'rejected_by_admin', 'rejected_by_company', 'provider_rejected', 'admin_rejected', 'auto_rejected')`
    );
  } catch {
    // Non-fatal
  }

  // 3) Backfill missing national ID & lifecycle detail fields safely from each reservation's own raw_json
  try {
    const rowsRes = await executor.query<{
      id: string;
      customer_id_number: string;
      reference_number: string;
      paid_amount: string | number;
      delivery_failure_reason: string;
      driver_notes: string;
      new_company_name: string;
      payment_status: string;
      total_amount: string | number;
      original_status_code: string;
      original_status_ar: string;
      internal_status: string;
      raw_json: string;
    }>(
      `SELECT id, customer_id_number, reference_number, paid_amount, delivery_failure_reason,
              driver_notes, new_company_name, payment_status, total_amount,
              original_status_code, original_status_ar, internal_status, raw_json
       FROM reservations
       WHERE raw_json LIKE '{%'
         AND (
           COALESCE(customer_id_number, '') IN ('', '-', '—', '0', 'غير متاح', 'غير محدد')
           OR COALESCE(reference_number, '') = ''
           OR COALESCE(paid_amount, 0) = 0
           OR COALESCE(delivery_failure_reason, '') = ''
           OR COALESCE(driver_notes, '') = ''
           OR COALESCE(new_company_name, '') = ''
         )
       LIMIT 2000`
    );
    const ids: string[] = [];
    const cids: string[] = [];
    const refs: string[] = [];
    const paidAmts: number[] = [];
    const failReasons: string[] = [];
    const dNotes: string[] = [];
    const newComps: string[] = [];

    for (const r of rowsRes?.rows || []) {
      try {
        const parsed = JSON.parse(String(r.raw_json || '{}'));
        const curCid = String(r.customer_id_number || '').trim();
        const cidInvalid = !curCid || curCid === '-' || curCid === '—' || curCid === 'غير متاح' || curCid === 'غير محدد' || /^0+$/.test(curCid);
        const extractedCid = cidInvalid && typeof crmCore.extractCustomerNationalId === 'function'
          ? String(crmCore.extractCustomerNationalId(parsed, null) || '')
          : '';
        const refCand = !String(r.reference_number || '').trim()
          ? String(parsed.referenceNumber || parsed.reference_number || parsed.refNumber || parsed.ref_number || parsed.sourceReference || parsed.externalReference || parsed.orderRef || parsed.reference || '').trim()
          : '';
        const failCand = !String(r.delivery_failure_reason || '').trim()
          ? String(parsed.deliveryFailureReason || parsed.delivery_failure_reason || parsed.failedDeliveryReason || parsed.failed_delivery_reason || parsed.deliverFailReason || parsed.failReason || '').trim()
          : '';
        const notesCand = !String(r.driver_notes || '').trim()
          ? String(parsed.driverNotes || parsed.driver_notes || parsed.driverNote || parsed.driver_note || parsed.deliveryNotes || parsed.delivery_notes || parsed.driverComment || '').trim()
          : '';
        const lcKind = typeof crmCore.classifyReservationLifecycle === 'function'
          ? crmCore.classifyReservationLifecycle({
              originalStatusCode: r.original_status_code,
              originalStatusAr: r.original_status_ar,
              internalStatus: r.internal_status
            })
          : 'active';
        const newCompCand = (lcKind === 'rejected' && !String(r.new_company_name || '').trim())
          ? String(parsed.newCompanyName || parsed.new_company_name || parsed.transferCompanyName || parsed.alternativeCompanyName || '').trim()
          : '';
        let paidCand = 0;
        if (Number(r.paid_amount || 0) <= 0) {
          const rawPaid = parsed.paidAmount ?? parsed.paid_amount ?? parsed.amountPaid ?? parsed.amount_paid;
          if (rawPaid !== undefined && rawPaid !== null && rawPaid !== '' && Number(rawPaid) > 0) {
            paidCand = Math.round(Number(rawPaid) * 100) / 100;
          } else {
            const pSt = String(r.payment_status || parsed.paymentStatus || parsed.paymentResult || '').trim().toLowerCase();
            if (['paid', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'refunded', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مسترد'].includes(pSt)) {
              paidCand = Math.max(0, Math.round(Number(r.total_amount || parsed.total || 0) * 100) / 100);
            }
          }
        }

        if (extractedCid || refCand || paidCand > 0 || failCand || notesCand || newCompCand) {
          ids.push(String(r.id));
          cids.push(extractedCid);
          refs.push(refCand);
          paidAmts.push(paidCand);
          failReasons.push(failCand);
          dNotes.push(notesCand);
          newComps.push(newCompCand);
        }
      } catch {
        // Skip malformed JSON
      }
    }
    if (ids.length > 0) {
      await executor.query(
        `UPDATE reservations AS t
         SET customer_id_number = CASE WHEN COALESCE(t.customer_id_number, '') IN ('', '-', '—', '0', 'غير متاح', 'غير محدد') AND NULLIF(v.cid, '') IS NOT NULL THEN v.cid ELSE t.customer_id_number END,
             reference_number = CASE WHEN COALESCE(t.reference_number, '') = '' AND NULLIF(v.ref_num, '') IS NOT NULL THEN v.ref_num ELSE t.reference_number END,
             paid_amount = CASE WHEN COALESCE(t.paid_amount, 0) = 0 AND v.paid_amt > 0 THEN v.paid_amt ELSE t.paid_amount END,
             delivery_failure_reason = CASE WHEN COALESCE(t.delivery_failure_reason, '') = '' AND NULLIF(v.fail_reason, '') IS NOT NULL THEN v.fail_reason ELSE t.delivery_failure_reason END,
             driver_notes = CASE WHEN COALESCE(t.driver_notes, '') = '' AND NULLIF(v.drv_notes, '') IS NOT NULL THEN v.drv_notes ELSE t.driver_notes END,
             new_company_name = CASE WHEN COALESCE(t.new_company_name, '') = '' AND NULLIF(v.new_comp, '') IS NOT NULL THEN v.new_comp ELSE t.new_company_name END
         FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::text[]) AS v(id, cid, ref_num, paid_amt, fail_reason, drv_notes, new_comp)
         WHERE t.id = v.id`,
        [ids, cids, refs, paidAmts, failReasons, dNotes, newComps]
      );
    }
  } catch {
    // Non-fatal
  }
}

export function resetSchemaInitFlagForTesting(): void {
  schemaInitialized = false;
  schemaInitPromise = null;
}

export async function checkDatabaseHealth(): Promise<{
  databaseConfigured: boolean;
  connected: boolean;
  error?: string;
}> {
  if (!isDatabaseConfigured()) {
    return { databaseConfigured: false, connected: false };
  }
  try {
    const exec = createPgExecutor();
    await exec.query('SELECT 1 AS ok');
    return { databaseConfigured: true, connected: true };
  } catch (err: any) {
    return {
      databaseConfigured: true,
      connected: false,
      error: String(err?.message || 'CONNECTION_FAILED').slice(0, 200)
    };
  }
}
