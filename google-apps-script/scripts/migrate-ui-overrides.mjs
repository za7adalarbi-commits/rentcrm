import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const CREATE_USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
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
);`;

function shouldUseSsl(connectionString) {
  const lower = String(connectionString || '').toLowerCase();
  if (lower.includes('sslmode=disable') || process.env.PGSSLMODE === 'disable') {
    return false;
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return lower.includes('sslmode=require');
  }
  return true;
}

export async function inspectUiOverridesSchema(client) {
  const tableRes = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('employees', 'users', 'sessions', 'settings')`
  );
  const existingTables = new Set((tableRes?.rows || []).map((r) => String(r.table_name)));

  const colRes = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('employees', 'users')
       AND column_name = 'ui_overrides'`
  );
  const columnsByTable = {};
  for (const row of colRes?.rows || []) {
    if (row?.table_name) {
      columnsByTable[String(row.table_name)] = {
        tableName: String(row.table_name),
        columnName: String(row.column_name),
        dataType: String(row.data_type || ''),
        udtName: String(row.udt_name || ''),
        isNullable: String(row.is_nullable || ''),
        columnDefault: row.column_default ?? null
      };
    }
  }

  const counts = { employees: 0, users: 0, existingNonEmptyUiOverrides: 0 };
  if (existingTables.has('employees')) {
    const empCnt = await client.query(`SELECT COUNT(*)::int AS cnt FROM employees`);
    counts.employees = Number(empCnt?.rows?.[0]?.cnt || 0);
    if (columnsByTable.employees) {
      const ovCnt = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM employees WHERE ui_overrides IS NOT NULL AND BTRIM(ui_overrides::text) NOT IN ('', '{}')`
      );
      counts.existingNonEmptyUiOverrides = Number(ovCnt?.rows?.[0]?.cnt || 0);
    }
  }
  if (existingTables.has('users')) {
    const usrCnt = await client.query(`SELECT COUNT(*)::int AS cnt FROM users`);
    counts.users = Number(usrCnt?.rows?.[0]?.cnt || 0);
  }

  return {
    existingTables: Array.from(existingTables),
    columnsByTable,
    counts
  };
}

export async function migrateUiOverrides(client, options = {}) {
  const dryRun = Boolean(options?.dryRun);
  const before = await inspectUiOverridesSchema(client);

  if (!before.existingTables.includes('employees')) {
    throw new Error('Table "employees" does not exist in schema "public". Initialize the base schema first.');
  }

  const actions = [];

  if (!before.existingTables.includes('users')) {
    actions.push('create_table:users');
    if (!dryRun) {
      await client.query(CREATE_USERS_TABLE_SQL);
    }
  }

  for (const tbl of ['employees', 'users']) {
    const col = before.columnsByTable[tbl];
    if (!col) {
      actions.push(`add_column:${tbl}.ui_overrides`);
      if (!dryRun) {
        await client.query(
          `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ui_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;`
        );
      }
      continue;
    }

    const udt = String(col.udtName || col.dataType || '').toLowerCase();
    if (udt && udt !== 'jsonb' && udt !== 'json') {
      actions.push(`convert_column_type:${tbl}.ui_overrides:${udt}->jsonb`);
      if (!dryRun) {
        await client.query(
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
    }

    if (String(col.isNullable || '').toUpperCase() === 'YES') {
      actions.push(`enforce_not_null_and_default:${tbl}.ui_overrides`);
      if (!dryRun) {
        await client.query(`UPDATE ${tbl} SET ui_overrides = '{}'::jsonb WHERE ui_overrides IS NULL;`);
        await client.query(`ALTER TABLE ${tbl} ALTER COLUMN ui_overrides SET DEFAULT '{}'::jsonb;`);
        await client.query(`ALTER TABLE ${tbl} ALTER COLUMN ui_overrides SET NOT NULL;`);
      }
    }
  }

  if (dryRun) {
    return { dryRun: true, actions, before, after: before, queryVerified: false };
  }

  // Verify the exact requireAuth JOIN query pattern executes without column errors
  await client.query(
    `SELECT e.id AS emp_id, e.ui_overrides
     FROM employees e
     LEFT JOIN sessions s ON s.employee_id = e.id
     LIMIT 1`
  );

  const after = await inspectUiOverridesSchema(client);
  return {
    dryRun: false,
    actions,
    before,
    after,
    queryVerified: Boolean(after.columnsByTable.employees && after.columnsByTable.users)
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = String(
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || ''
  ).trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL, POSTGRES_URL, or NEON_DATABASE_URL is required.');
  }

  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined
  });

  const client = await pool.connect();
  try {
    const result = await migrateUiOverrides(client, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('UI overrides migration failed:', err?.message || err);
    process.exit(1);
  });
}
