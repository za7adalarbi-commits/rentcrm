import pg from 'pg';
import {
  ensureSchemaInitialized,
  getDatabaseUrl,
  isDatabaseConfigured,
  resetSchemaInitState,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from './dbCore';
import { getEnv } from './env';

export { ensureSchemaInitialized, getDatabaseUrl, isDatabaseConfigured, resetSchemaInitState };
export type { DbClient, DbExecutor, QueryResult, QueryResultRow };

const { Pool } = pg;

let cachedPool: pg.Pool | null = null;
let cachedPoolUrl = '';

function shouldUseSsl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  if (lower.includes('sslmode=disable') || getEnv('PGSSLMODE') === 'disable') {
    return false;
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return lower.includes('sslmode=require');
  }
  return true;
}

export async function resetPool(): Promise<void> {
  const prev = cachedPool;
  cachedPool = null;
  cachedPoolUrl = '';
  resetSchemaInitState();
  if (prev) {
    try {
      await prev.end();
    } catch {
      // ignore close errors during dynamic pool swap
    }
  }
}

export function getPool(): pg.Pool {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    if (cachedPool) {
      const stale = cachedPool;
      cachedPool = null;
      cachedPoolUrl = '';
      resetSchemaInitState();
      void stale.end().catch(() => undefined);
    }
    throw new Error('DATABASE_UNCONFIGURED: متغير DATABASE_URL غير مضبوط في بيئة الخادم.');
  }
  if (cachedPool && cachedPoolUrl === connectionString) {
    return cachedPool;
  }
  if (cachedPool && cachedPoolUrl !== connectionString) {
    const prev = cachedPool;
    cachedPool = null;
    cachedPoolUrl = '';
    resetSchemaInitState();
    void prev.end().catch(() => undefined);
  }
  cachedPool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: Number(getEnv('PG_POOL_MAX', '10')) || 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true
  });
  cachedPoolUrl = connectionString;
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
