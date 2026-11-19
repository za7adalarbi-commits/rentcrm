import { getActiveWorkerEnv, getEnv, type WorkerEnvBindings } from './env';
import { SCHEMA_SQL } from './schemaSql';

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

let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

export function getDatabaseUrl(explicitEnv?: WorkerEnvBindings | null): string {
  const env = explicitEnv || getActiveWorkerEnv();
  if (env) {
    const hyperdriveUrl = String(env.HYPERDRIVE?.connectionString || '').trim();
    if (hyperdriveUrl) return hyperdriveUrl;
    const bound = String(
      env.DATABASE_URL ||
      env.POSTGRES_URL ||
      env.NEON_DATABASE_URL ||
      ''
    ).trim();
    if (bound) return bound;
  }
  return String(
    getEnv('DATABASE_URL') ||
    getEnv('POSTGRES_URL') ||
    getEnv('NEON_DATABASE_URL') ||
    ''
  ).trim();
}

export function isDatabaseConfigured(explicitEnv?: WorkerEnvBindings | null): boolean {
  return Boolean(getDatabaseUrl(explicitEnv));
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
        await executor.query(SCHEMA_SQL);
      }
      schemaInitialized = true;
    } finally {
      schemaInitPromise = null;
    }
  })();

  return schemaInitPromise;
}

export function resetSchemaInitState(): void {
  schemaInitialized = false;
  schemaInitPromise = null;
}

export function resetSchemaInitFlagForTesting(): void {
  resetSchemaInitState();
}
