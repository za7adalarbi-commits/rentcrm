import { Pool as NeonPool } from '@neondatabase/serverless';
import {
  ensureSchemaInitialized,
  getDatabaseUrl,
  isDatabaseConfigured,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from './dbCore';
import { getEnv, type WorkerEnvBindings } from './env';

export { ensureSchemaInitialized, getDatabaseUrl, isDatabaseConfigured };
export type { DbClient, DbExecutor, QueryResult, QueryResultRow };

export interface WorkerExecutorHandle {
  executor: DbExecutor;
  close: () => Promise<void>;
  hyperdriveEnabled: boolean;
}

/**
 * Creates a request-scoped Neon serverless PostgreSQL executor compatible with Cloudflare Workers.
 * Automatically prefers a Cloudflare Hyperdrive binding when configured, and falls back to
 * DATABASE_URL / POSTGRES_URL / NEON_DATABASE_URL over WebSockets on Cloudflare's free plan.
 */
export function createCfPgExecutor(env?: WorkerEnvBindings | null): WorkerExecutorHandle {
  const connectionString = getDatabaseUrl(env);
  if (!connectionString) {
    throw new Error('DATABASE_UNCONFIGURED: متغير DATABASE_URL غير مضبوط في بيئة الخادم.');
  }

  const hyperdriveEnabled = Boolean(env?.HYPERDRIVE?.connectionString);
  const maxPool = Math.max(1, Math.min(10, Number(getEnv('PG_POOL_MAX', '3')) || 3));
  const pool = new NeonPool({
    connectionString,
    max: maxPool,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });

  const executor: DbExecutor = {
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
        } catch {
          // ignore rollback errors
        }
        throw err;
      } finally {
        client.release();
      }
    }
  };

  return {
    executor,
    hyperdriveEnabled,
    close: async () => {
      try {
        await pool.end();
      } catch {
        // ignore close errors on isolate cleanup
      }
    }
  };
}

export async function checkCfDatabaseHealth(env?: WorkerEnvBindings | null): Promise<{
  databaseConfigured: boolean;
  connected: boolean;
  hyperdriveEnabled: boolean;
  error?: string;
}> {
  const hyperdriveEnabled = Boolean(env?.HYPERDRIVE?.connectionString);
  if (!isDatabaseConfigured(env)) {
    return { databaseConfigured: false, connected: false, hyperdriveEnabled };
  }
  const handle = createCfPgExecutor(env);
  try {
    await handle.executor.query('SELECT 1 AS ok');
    return { databaseConfigured: true, connected: true, hyperdriveEnabled };
  } catch (err: any) {
    return {
      databaseConfigured: true,
      connected: false,
      hyperdriveEnabled,
      error: String(err?.message || 'CONNECTION_FAILED').slice(0, 200)
    };
  } finally {
    await handle.close();
  }
}
