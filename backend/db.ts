import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { FIXED_SERVER_CONFIG } from './fixedConfig';

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
  const metaDir = typeof import.meta !== 'undefined' && (import.meta as any).dirname
    ? String((import.meta as any).dirname)
    : process.cwd();
  const candidates = [
    path.resolve(process.cwd(), 'database/schema.sql'),
    path.resolve(metaDir, '../database/schema.sql'),
    path.resolve(metaDir, 'database/schema.sql')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  }
  throw new Error('SCHEMA_FILE_MISSING: لم يتم العثور على database/schema.sql');
}

export async function ensureSchemaInitialized(executor: DbExecutor): Promise<void> {
  if (schemaInitialized) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      const check = await executor.query<{ reg: string | null }>(
        "SELECT to_regclass('public.employees') AS reg"
      );
      const exists = Boolean(check.rows[0] && check.rows[0].reg);
      if (!exists) {
        const schemaSql = loadSchemaSql();
        await executor.query(schemaSql);
      } else {
        // Idempotent index check for existing databases without altering mock tests
        await executor.query(
          `CREATE INDEX IF NOT EXISTS idx_reservations_status_updated ON reservations (internal_status, updated_at DESC);
           CREATE INDEX IF NOT EXISTS idx_reservations_company_updated ON reservations (company_name, updated_at DESC);
           CREATE INDEX IF NOT EXISTS idx_notifications_role_read ON notifications (recipient_role, is_read, created_at DESC);`
        ).catch(() => undefined);
      }
      schemaInitialized = true;
    } finally {
      schemaInitPromise = null;
    }
  })();

  return schemaInitPromise;
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
