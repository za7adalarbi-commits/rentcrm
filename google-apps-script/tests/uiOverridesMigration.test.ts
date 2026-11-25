import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashPassword, hashToken } from '../backend/auth';
import crmCoreModule from '../backend/coreBridge.cjs';
import {
  ensureSchemaInitialized,
  ensureUiOverridesColumns,
  resetSchemaInitFlagForTesting,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';
import { inspectUiOverridesSchema, migrateUiOverrides } from '../scripts/migrate-ui-overrides.mjs';

const crmCore: any = (crmCoreModule as any)?.default || crmCoreModule;

interface ColumnSpec {
  dataType: string;
  udtName: string;
  isNullable: 'YES' | 'NO';
  columnDefault: string | null;
}

function createLegacyPostgresSimExecutor(options?: {
  employeesHasUiOverrides?: boolean;
  usersExists?: boolean;
  usersHasUiOverrides?: boolean;
  legacyColumnSpec?: ColumnSpec;
}): DbExecutor & {
  ddlLog: string[];
  columns: Record<string, Record<string, ColumnSpec>>;
  tables: Record<string, any[]>;
} {
  const columns: Record<string, Record<string, ColumnSpec>> = {
    employees: {
      id: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      name: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" },
      username: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      password_hash: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" },
      salt: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" },
      role: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'agent'::text" },
      permissions: { dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', columnDefault: "'[]'::jsonb" },
      status: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'active'::text" }
    },
    sessions: {
      token_hash: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      employee_id: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null }
    },
    settings: {
      key: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      value: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" }
    },
    activity_log: {},
    sync_log: {},
    reservations: {}
  };

  if (options?.employeesHasUiOverrides) {
    columns.employees.ui_overrides = options.legacyColumnSpec || {
      dataType: 'jsonb',
      udtName: 'jsonb',
      isNullable: 'NO',
      columnDefault: "'{}'::jsonb"
    };
  }

  const tables: Record<string, any[]> = {
    employees: [],
    sessions: [],
    settings: [],
    employee_delegations: [],
    activity_log: [],
    sync_log: [],
    sync_tombstones: [],
    notifications: [],
    shift_announcements: [],
    reservation_locks: [],
    reservations: [],
    follow_ups: [],
    problems: [],
    sheets_mirror_outbox: []
  };

  if (options?.usersExists !== false) {
    columns.users = {
      id: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      name: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" },
      username: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
      role: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'agent'::text" },
      permissions: { dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', columnDefault: "'[]'::jsonb" },
      status: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'active'::text" }
    };
    if (options?.usersHasUiOverrides) {
      columns.users.ui_overrides = options.legacyColumnSpec || {
        dataType: 'jsonb',
        udtName: 'jsonb',
        isNullable: 'NO',
        columnDefault: "'{}'::jsonb"
      };
    }
    tables.users = [];
  }

  const ddlLog: string[] = [];

  function hasColumn(table: string, col: string): boolean {
    return Boolean(columns[table] && columns[table][col]);
  }

  async function runQuery<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const clean = sql.trim();

    if (/to_regclass\('public\.employees'\)/i.test(clean)) {
      return {
        rows: [{
          reg: columns.employees ? 'employees' : null,
          all_ok: Boolean(columns.employees && columns.sessions && columns.settings && columns.reservations)
        }] as any,
        rowCount: 1
      };
    }

    if (/FROM\s+information_schema\.tables/i.test(clean)) {
      const rows = Object.keys(columns)
        .filter((t) => ['employees', 'users', 'sessions', 'settings'].includes(t))
        .map((table_name) => ({ table_name }));
      return { rows: rows as any, rowCount: rows.length };
    }

    if (/FROM\s+information_schema\.columns/i.test(clean)) {
      const rows: any[] = [];
      for (const tbl of ['employees', 'users']) {
        const spec = columns[tbl]?.ui_overrides;
        if (spec) {
          rows.push({
            table_name: tbl,
            column_name: 'ui_overrides',
            data_type: spec.dataType,
            udt_name: spec.udtName,
            is_nullable: spec.isNullable,
            column_default: spec.columnDefault
          });
        }
      }
      return { rows: rows as any, rowCount: rows.length };
    }

    if (/^CREATE TABLE IF NOT EXISTS users\b/i.test(clean)) {
      ddlLog.push(clean);
      if (!columns.users) {
        columns.users = {
          id: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
          name: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "''::text" },
          username: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: null },
          role: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'agent'::text" },
          permissions: { dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', columnDefault: "'[]'::jsonb" },
          ui_overrides: { dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', columnDefault: "'{}'::jsonb" },
          status: { dataType: 'text', udtName: 'text', isNullable: 'NO', columnDefault: "'active'::text" }
        };
        tables.users = [];
      }
      return { rows: [], rowCount: 0 };
    }

    const addUiOvMatch = clean.match(/^ALTER TABLE\s+(employees|users)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?ui_overrides\s+JSONB/i);
    if (addUiOvMatch) {
      ddlLog.push(clean);
      const tbl = addUiOvMatch[1];
      if (!columns[tbl]) throw new Error(`relation "${tbl}" does not exist`);
      if (!columns[tbl].ui_overrides) {
        columns[tbl].ui_overrides = {
          dataType: 'jsonb',
          udtName: 'jsonb',
          isNullable: 'NO',
          columnDefault: "'{}'::jsonb"
        };
        for (const row of tables[tbl]) {
          row.ui_overrides = {};
        }
      } else if (!/IF NOT EXISTS/i.test(clean)) {
        throw new Error(`column "ui_overrides" of relation "${tbl}" already exists`);
      }
      return { rows: [], rowCount: 0 };
    }

    const alterTypeMatch = clean.match(/^ALTER TABLE\s+(employees|users)\s+ALTER COLUMN ui_overrides TYPE JSONB/i);
    if (alterTypeMatch) {
      ddlLog.push(clean);
      const tbl = alterTypeMatch[1];
      columns[tbl].ui_overrides.dataType = 'jsonb';
      columns[tbl].ui_overrides.udtName = 'jsonb';
      for (const row of tables[tbl]) {
        const raw = row.ui_overrides;
        if (raw === null || raw === undefined || String(raw).trim() === '') {
          row.ui_overrides = {};
        } else if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (trimmed.startsWith('{')) {
            try {
              row.ui_overrides = JSON.parse(trimmed);
            } catch {
              row.ui_overrides = {};
            }
          } else {
            row.ui_overrides = {};
          }
        }
      }
      return { rows: [], rowCount: 0 };
    }

    const updNullMatch = clean.match(/^UPDATE\s+(employees|users)\s+SET ui_overrides = '\{\}'::jsonb WHERE ui_overrides IS NULL/i);
    if (updNullMatch) {
      ddlLog.push(clean);
      const tbl = updNullMatch[1];
      let cnt = 0;
      for (const row of tables[tbl]) {
        if (row.ui_overrides === null || row.ui_overrides === undefined) {
          row.ui_overrides = {};
          cnt++;
        }
      }
      return { rows: [], rowCount: cnt };
    }

    const setDefMatch = clean.match(/^ALTER TABLE\s+(employees|users)\s+ALTER COLUMN ui_overrides SET DEFAULT '\{\}'::jsonb/i);
    if (setDefMatch) {
      ddlLog.push(clean);
      const tbl = setDefMatch[1];
      columns[tbl].ui_overrides.columnDefault = "'{}'::jsonb";
      return { rows: [], rowCount: 0 };
    }

    const setNotNullMatch = clean.match(/^ALTER TABLE\s+(employees|users)\s+ALTER COLUMN ui_overrides SET NOT NULL/i);
    if (setNotNullMatch) {
      ddlLog.push(clean);
      const tbl = setNotNullMatch[1];
      columns[tbl].ui_overrides.isNullable = 'NO';
      return { rows: [], rowCount: 0 };
    }

    if (/^(ALTER TABLE|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/i.test(clean)) {
      ddlLog.push(clean);
      return { rows: [], rowCount: 0 };
    }

    if (/^SELECT COUNT\(\*\)::int AS cnt FROM employees WHERE ui_overrides IS NOT NULL/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) {
        throw new Error('column "ui_overrides" does not exist');
      }
      const cnt = tables.employees.filter((e) => {
        if (e.ui_overrides === null || e.ui_overrides === undefined) return false;
        const s = typeof e.ui_overrides === 'string' ? e.ui_overrides.trim() : JSON.stringify(e.ui_overrides);
        return s !== '' && s !== '{}';
      }).length;
      return { rows: [{ cnt }] as any, rowCount: 1 };
    }

    if (/^SELECT COUNT\(\*\)::int AS cnt FROM (employees|users)$/i.test(clean)) {
      const m = clean.match(/FROM (employees|users)$/i)!;
      return { rows: [{ cnt: tables[m[1]].length }] as any, rowCount: 1 };
    }

    // Exact failing requireAuth query
    if (/FROM\s+sessions\s+s\s+JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*s\.employee_id/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) {
        throw new Error('column e.ui_overrides does not exist');
      }
      const tokenHash = params[0];
      const ses = tables.sessions.find((s) => s.token_hash === tokenHash);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = tables.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          token_hash: ses.token_hash,
          employee_id: ses.employee_id,
          username: ses.username,
          role: ses.role,
          expires_at: ses.expires_at,
          is_revoked: ses.is_revoked,
          last_seen_at: ses.last_seen_at,
          emp_id: emp.id,
          name: emp.name,
          emp_username: emp.username,
          phone: emp.phone || '',
          email: emp.email || '',
          job_title: emp.job_title || '',
          emp_role: emp.role,
          permissions: emp.permissions,
          ui_overrides: emp.ui_overrides,
          emp_status: emp.status,
          last_activity: emp.last_activity || '',
          created_at: emp.created_at,
          updated_at: emp.updated_at
        }] as any,
        rowCount: 1
      };
    }

    if (/FROM\s+employees\s+e\s+LEFT\s+JOIN\s+sessions\s+s/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) {
        throw new Error('column e.ui_overrides does not exist');
      }
      const rows = tables.employees.slice(0, 1).map((e) => ({ emp_id: e.id, ui_overrides: e.ui_overrides }));
      return { rows: rows as any, rowCount: rows.length };
    }

    if (/SELECT COUNT\(\*\)::int AS cnt FROM employees/i.test(clean)) {
      return { rows: [{ cnt: tables.employees.length }] as any, rowCount: 1 };
    }

    if (/SELECT \* FROM employees WHERE LOWER\(username\) = \$1 LIMIT 1/i.test(clean)) {
      const uname = String(params[0] || '').toLowerCase();
      const hit = tables.employees.find((e) => String(e.username || '').toLowerCase() === uname);
      return { rows: (hit ? [hit] : []) as any, rowCount: hit ? 1 : 0 };
    }

    if (/SELECT \* FROM employees WHERE id = \$1/i.test(clean)) {
      const id = String(params[0] || '');
      const hit = tables.employees.find((e) => e.id === id);
      return { rows: (hit ? [hit] : []) as any, rowCount: hit ? 1 : 0 };
    }

    if (/SELECT id, name, username, phone, email, job_title, role, permissions, ui_overrides, status/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) {
        throw new Error('column "ui_overrides" does not exist');
      }
      if (/WHERE updated_at > \$1/i.test(clean)) {
        const sinceMs = Date.parse(String(params[0] || ''));
        const rows = tables.employees.filter((e) => Date.parse(String(e.updated_at || '')) > sinceMs);
        return { rows: rows as any, rowCount: rows.length };
      }
      return { rows: tables.employees.slice() as any, rowCount: tables.employees.length };
    }

    if (/^INSERT INTO sessions/i.test(clean)) {
      tables.sessions.push({
        token_hash: params[0],
        employee_id: params[1],
        username: params[2],
        role: params[3],
        expires_at: params[4],
        created_at: params[5],
        last_seen_at: params[5],
        is_revoked: false
      });
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE sessions SET last_seen_at/i.test(clean)) {
      return { rows: [], rowCount: 1 };
    }

    if (/^INSERT INTO employees/i.test(clean)) {
      const hasExplicitUiOv = /ui_overrides/i.test(clean.split('VALUES')[0]);
      if (hasExplicitUiOv) {
        if (!hasColumn('employees', 'ui_overrides')) {
          throw new Error('column "ui_overrides" of relation "employees" does not exist');
        }
        tables.employees.push({
          id: params[0],
          name: params[1],
          username: params[2],
          password_hash: params[3],
          salt: params[4],
          phone: params[5],
          email: params[6],
          job_title: params[7],
          role: params[8],
          permissions: JSON.parse(params[9]),
          ui_overrides: JSON.parse(params[10]),
          status: 'active',
          last_activity: params[11],
          created_at: params[12],
          updated_at: params[12]
        });
      } else {
        tables.employees.push({
          id: params[0],
          name: params[1],
          username: params[2],
          password_hash: params[3],
          salt: params[4],
          phone: params[5],
          email: params[6],
          job_title: params[7],
          role: params[8],
          permissions: JSON.parse(params[9]),
          ...(hasColumn('employees', 'ui_overrides') ? { ui_overrides: {} } : {}),
          status: params[10],
          last_activity: '',
          created_at: params[11],
          updated_at: params[11]
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (/^INSERT INTO users/i.test(clean)) {
      if (!columns.users) throw new Error('relation "users" does not exist');
      const hasExplicitUiOv = /ui_overrides/i.test(clean.split('VALUES')[0]);
      if (hasExplicitUiOv && !hasColumn('users', 'ui_overrides')) {
        throw new Error('column "ui_overrides" of relation "users" does not exist');
      }
      tables.users.push({
        id: params[0],
        name: params[1],
        username: params[2],
        phone: params[3],
        email: params[4],
        job_title: params[5],
        role: params[6],
        permissions: JSON.parse(params[7]),
        ui_overrides: hasExplicitUiOv ? JSON.parse(params[8]) : {},
        status: 'active'
      });
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE employees SET ui_overrides = \$2::jsonb, updated_at = \$3::timestamptz WHERE id = \$1/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) throw new Error('column "ui_overrides" does not exist');
      const emp = tables.employees.find((e) => e.id === params[0]);
      if (emp) {
        emp.ui_overrides = JSON.parse(params[1]);
        emp.updated_at = params[2];
      }
      return { rows: [], rowCount: emp ? 1 : 0 };
    }

    if (/^UPDATE users SET ui_overrides = \$2::jsonb, updated_at = \$3::timestamptz WHERE id = \$1/i.test(clean)) {
      if (!hasColumn('users', 'ui_overrides')) throw new Error('column "ui_overrides" does not exist');
      const usr = tables.users.find((u) => u.id === params[0]);
      if (usr) {
        usr.ui_overrides = JSON.parse(params[1]);
        usr.updated_at = params[2];
      }
      return { rows: [], rowCount: usr ? 1 : 0 };
    }

    if (/^UPDATE employees\s+SET name = \$2, username = \$3/i.test(clean)) {
      if (!hasColumn('employees', 'ui_overrides')) throw new Error('column "ui_overrides" does not exist');
      const emp = tables.employees.find((e) => e.id === params[0]);
      if (emp) {
        emp.name = params[1];
        emp.username = params[2];
        emp.phone = params[3];
        emp.email = params[4];
        emp.job_title = params[5];
        emp.role = params[6];
        emp.permissions = JSON.parse(params[7]);
        emp.ui_overrides = JSON.parse(params[8]);
        emp.status = params[9];
        emp.password_hash = params[10];
        emp.salt = params[11];
        emp.updated_at = params[12];
      }
      return { rows: [], rowCount: emp ? 1 : 0 };
    }

    if (/^UPDATE users\s+SET name = \$2, username = \$3/i.test(clean)) {
      if (!hasColumn('users', 'ui_overrides')) throw new Error('column "ui_overrides" does not exist');
      const usr = tables.users.find((u) => u.id === params[0]);
      if (usr) {
        usr.name = params[1];
        usr.username = params[2];
        usr.ui_overrides = JSON.parse(params[8]);
      }
      return { rows: [], rowCount: usr ? 1 : 0 };
    }

    if (/^UPDATE employees SET ui_overrides = '\{\}'::jsonb/i.test(clean)) {
      const skipDev = /role <> 'developer'/i.test(clean);
      for (const emp of tables.employees) {
        if (!skipDev || emp.role !== 'developer') {
          emp.ui_overrides = {};
        }
      }
      return { rows: [], rowCount: tables.employees.length };
    }

    if (/^UPDATE users SET ui_overrides = '\{\}'::jsonb/i.test(clean)) {
      const skipDev = /role <> 'developer'/i.test(clean);
      for (const usr of tables.users) {
        if (!skipDev || usr.role !== 'developer') {
          usr.ui_overrides = {};
        }
      }
      return { rows: [], rowCount: tables.users.length };
    }

    if (/^UPDATE employees SET last_activity = \$2/i.test(clean)) {
      const emp = tables.employees.find((e) => e.id === params[0]);
      if (emp) {
        emp.last_activity = params[1];
        emp.updated_at = params[2];
      }
      return { rows: [], rowCount: emp ? 1 : 0 };
    }

    if (/^SELECT key, value FROM settings/i.test(clean)) {
      return { rows: tables.settings.slice() as any, rowCount: tables.settings.length };
    }

    if (/SELECT value FROM settings WHERE key = \$1/i.test(clean)) {
      const hit = tables.settings.find((s) => s.key === params[0]);
      return { rows: (hit ? [{ value: hit.value }] : []) as any, rowCount: hit ? 1 : 0 };
    }

    if (/SELECT value FROM settings WHERE key = 'session_ttl_hours'/i.test(clean)) {
      const hit = tables.settings.find((s) => s.key === 'session_ttl_hours');
      return { rows: (hit ? [{ value: hit.value }] : []) as any, rowCount: hit ? 1 : 0 };
    }

    if (/^INSERT INTO settings \(key, value, updated_by, updated_at\)\s+VALUES \('([^']+)'/i.test(clean)) {
      const key = clean.match(/VALUES \('([^']+)'/i)![1];
      const value = clean.includes("VALUES ('ui_simplification', '{}'") || clean.includes("VALUES ('role_ui_defaults', '{}'")
        ? '{}'
        : String(params[0] ?? '{}');
      const idx = tables.settings.findIndex((s) => s.key === key);
      const entry = { key, value, updated_by: params[1] || params[0] || '', updated_at: new Date().toISOString() };
      if (idx >= 0) tables.settings[idx] = entry;
      else tables.settings.push(entry);
      return { rows: [], rowCount: 1 };
    }

    if (/^INSERT INTO settings \(key, value, updated_by, updated_at\)\s+VALUES \(\$1, \$2/i.test(clean)) {
      const key = String(params[0]);
      const value = String(params[1] ?? '');
      const idx = tables.settings.findIndex((s) => s.key === key);
      const entry = { key, value, updated_by: String(params[2] || ''), updated_at: new Date().toISOString() };
      if (idx >= 0) tables.settings[idx] = entry;
      else tables.settings.push(entry);
      return { rows: [], rowCount: 1 };
    }

    if (/FROM settings[\s\S]*MAX\(updated_at\)/i.test(clean)) {
      const sinceMs = Date.parse(String(params[0] || ''));
      const hits = tables.settings.filter((s) => s.key !== 'crm_sync_version' && Date.parse(s.updated_at || '') > sinceMs);
      return { rows: [{ max_upd: hits[0]?.updated_at || null }] as any, rowCount: 1 };
    }

    if (/^INSERT INTO activity_log/i.test(clean)) {
      tables.activity_log.push({ id: params[0], action_type: params[4], entity_id: params[6] });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  const executor: DbExecutor & {
    ddlLog: string[];
    columns: Record<string, Record<string, ColumnSpec>>;
    tables: Record<string, any[]>;
  } = {
    ddlLog,
    columns,
    tables,
    query: runQuery,
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };

  return executor;
}

test('ensureSchemaInitialized repairs legacy database missing employees.ui_overrides and users.ui_overrides without overwriting records', async () => {
  resetSchemaInitFlagForTesting();
  const db = createLegacyPostgresSimExecutor({
    employeesHasUiOverrides: false,
    usersExists: false
  });

  const salt = 'TEST_SALT';
  const rawToken = 'SES_LEGACY_001';
  db.tables.employees.push({
    id: 'EMP_LEGACY_1',
    name: 'Legacy Admin',
    username: 'admin',
    password_hash: hashPassword('Admin@123', salt),
    salt,
    role: 'general_manager',
    permissions: ['all'],
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  });
  db.tables.sessions.push({
    token_hash: hashToken(rawToken),
    employee_id: 'EMP_LEGACY_1',
    username: 'admin',
    role: 'general_manager',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    is_revoked: false
  });

  // Reproduce the exact reported error before migration
  await assert.rejects(
    () =>
      db.query(
        `SELECT s.token_hash, s.employee_id, e.ui_overrides
         FROM sessions s JOIN employees e ON e.id = s.employee_id
         WHERE s.token_hash = $1 LIMIT 1`,
        [hashToken(rawToken)]
      ),
    /column e\.ui_overrides does not exist/
  );

  // Run automatic schema initialization / migration
  await ensureSchemaInitialized(db);

  assert.equal(db.columns.employees.ui_overrides.udtName, 'jsonb');
  assert.equal(db.columns.employees.ui_overrides.isNullable, 'NO');
  assert.equal(db.columns.employees.ui_overrides.columnDefault, "'{}'::jsonb");
  assert.equal(db.columns.users.ui_overrides.udtName, 'jsonb');
  assert.deepEqual(db.tables.employees[0].ui_overrides, {});

  // Exact failing query now succeeds via dispatchCrmRequest('getMe')
  const meRes = await dispatchCrmRequest(db, { action: 'getMe', token: rawToken });
  assert.equal(meRes.success, true);
  assert.equal(meRes.data.user.id, 'EMP_LEGACY_1');
  assert.deepEqual(meRes.data.user.uiOverrides, crmCore.normalizeUiOverrides({}));

  // Idempotency check: modifying ui_overrides then re-running ensureUiOverridesColumns does not overwrite
  db.tables.employees[0].ui_overrides = { hiddenKeys: ['reports'], defaultRoute: 'reservations' };
  const rerun = await ensureUiOverridesColumns(db);
  assert.equal(rerun.employeesAdded, false);
  assert.equal(rerun.usersAdded, false);
  assert.deepEqual(db.tables.employees[0].ui_overrides, { hiddenKeys: ['reports'], defaultRoute: 'reservations' });
});

test('ensureUiOverridesColumns safely migrates nullable legacy text ui_overrides column while preserving valid JSON objects', async () => {
  const db = createLegacyPostgresSimExecutor({
    employeesHasUiOverrides: true,
    usersExists: true,
    usersHasUiOverrides: true,
    legacyColumnSpec: {
      dataType: 'text',
      udtName: 'text',
      isNullable: 'YES',
      columnDefault: null
    }
  });

  db.tables.employees.push(
    { id: 'EMP_A', username: 'a', ui_overrides: '{"hiddenKeys":["problems"],"defaultRoute":"my_follow_ups"}' },
    { id: 'EMP_B', username: 'b', ui_overrides: null },
    { id: 'EMP_C', username: 'c', ui_overrides: 'not-json' }
  );

  await ensureUiOverridesColumns(db);

  assert.equal(db.columns.employees.ui_overrides.udtName, 'jsonb');
  assert.equal(db.columns.employees.ui_overrides.isNullable, 'NO');
  assert.equal(db.columns.employees.ui_overrides.columnDefault, "'{}'::jsonb");
  assert.deepEqual(db.tables.employees[0].ui_overrides, { hiddenKeys: ['problems'], defaultRoute: 'my_follow_ups' });
  assert.deepEqual(db.tables.employees[1].ui_overrides, {});
  assert.deepEqual(db.tables.employees[2].ui_overrides, {});
});

test('standalone scripts/migrate-ui-overrides.mjs supports dry-run inspection, applies safely, and preserves existing settings', async () => {
  const db = createLegacyPostgresSimExecutor({
    employeesHasUiOverrides: false,
    usersExists: false
  });
  db.tables.employees.push({
    id: 'EMP_1',
    name: 'Employee One',
    username: 'emp1',
    role: 'agent',
    permissions: ['view_reservations'],
    status: 'active'
  });

  const dry = await migrateUiOverrides(db, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.queryVerified, false);
  assert.deepEqual(dry.actions, [
    'create_table:users',
    'add_column:employees.ui_overrides',
    'add_column:users.ui_overrides'
  ]);
  assert.equal(db.columns.employees.ui_overrides, undefined);

  const applied = await migrateUiOverrides(db, { dryRun: false });
  assert.equal(applied.dryRun, false);
  assert.equal(applied.queryVerified, true);
  assert.equal(applied.before.counts.employees, 1);
  assert.ok((applied.after.columnsByTable as Record<string, any>).employees);
  assert.ok((applied.after.columnsByTable as Record<string, any>).users);

  // Save non-empty override and re-run migration -> preserved & no duplicate actions
  db.tables.employees[0].ui_overrides = { hiddenKeys: ['reports'] };
  const secondRun = await migrateUiOverrides(db, { dryRun: false });
  assert.deepEqual(secondRun.actions, []);
  assert.equal(secondRun.before.counts.existingNonEmptyUiOverrides, 1);
  assert.deepEqual(db.tables.employees[0].ui_overrides, { hiddenKeys: ['reports'] });
});

test('employee ui_overrides and role_ui_defaults save, retrieve, sync via delta, and apply independently per employee and role', async () => {
  resetSchemaInitFlagForTesting();
  const db = createLegacyPostgresSimExecutor({
    employeesHasUiOverrides: false,
    usersExists: false
  });

  const adminSalt = 'ADM_SALT';
  const emp1Salt = 'AG1_SALT';
  const emp2Salt = 'AG2_SALT';
  const adminToken = 'TOK_ADMIN';
  const emp1Token = 'TOK_AG1';
  const emp2Token = 'TOK_AG2';

  db.tables.employees.push(
    {
      id: 'EMP_ADMIN',
      name: 'General Manager',
      username: 'admin',
      password_hash: hashPassword('Admin@123', adminSalt),
      salt: adminSalt,
      role: 'general_manager',
      permissions: crmCore.resolveEffectivePermissions('general_manager', ['all']),
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'EMP_AGENT1',
      name: 'Agent One',
      username: 'agent1',
      password_hash: hashPassword('Agent@123', emp1Salt),
      salt: emp1Salt,
      role: 'agent',
      permissions: crmCore.resolveEffectivePermissions('agent', ['agent']),
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'EMP_AGENT2',
      name: 'Agent Two',
      username: 'agent2',
      password_hash: hashPassword('Agent@123', emp2Salt),
      salt: emp2Salt,
      role: 'agent',
      permissions: crmCore.resolveEffectivePermissions('agent', ['agent']),
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  );
  for (const [tok, emp] of [
    [adminToken, db.tables.employees[0]],
    [emp1Token, db.tables.employees[1]],
    [emp2Token, db.tables.employees[2]]
  ] as const) {
    db.tables.sessions.push({
      token_hash: hashToken(tok),
      employee_id: emp.id,
      username: emp.username,
      role: emp.role,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      is_revoked: false
    });
  }

  // Save role defaults independently for 'agent' vs 'supervisor'
  const saveRoleRes = await dispatchCrmRequest(db, {
    action: 'saveRoleUiDefaults',
    token: adminToken,
    payload: {
      roleUiDefaults: {
        agent: {
          enabled: true,
          forceForRole: false,
          uiSimplification: { hideFinancialBreakdown: true, hideDashboardRadar: true },
          visibleCols: ['reservationNumber', 'customerName', 'internalStatus']
        },
        supervisor: {
          enabled: true,
          forceForRole: false,
          uiSimplification: { hideFinancialBreakdown: false, hideDrawerCharts: true },
          visibleCols: ['reservationNumber', 'customerName', 'carName', 'totalAmount', 'internalStatus']
        }
      }
    }
  });
  assert.equal(saveRoleRes.success, true);

  // Save independent UI overrides for agent1 and agent2
  const ov1Res = await dispatchCrmRequest(db, {
    action: 'saveEmployeeUiOverrides',
    token: adminToken,
    payload: {
      employeeId: 'EMP_AGENT1',
      uiOverrides: {
        hiddenKeys: ['reports', 'problems'],
        shownKeys: [],
        defaultRoute: 'my_follow_ups',
        flags: { hideFinancialBreakdown: false }
      }
    }
  });
  assert.equal(ov1Res.success, true);

  const ov2Res = await dispatchCrmRequest(db, {
    action: 'saveEmployeeUiOverrides',
    token: adminToken,
    payload: {
      employeeId: 'EMP_AGENT2',
      uiOverrides: {
        hiddenKeys: ['dashboard'],
        shownKeys: ['reports'],
        defaultRoute: 'reservations',
        visibleCols: ['reservationNumber', 'totalAmount']
      }
    }
  });
  assert.equal(ov2Res.success, true);

  // Verify agent1 and agent2 retrieve their own independent overrides via getMe and delta sync
  const me1 = await dispatchCrmRequest(db, { action: 'getMe', token: emp1Token });
  const me2 = await dispatchCrmRequest(db, { action: 'getMe', token: emp2Token });
  assert.equal(me1.success, true);
  assert.equal(me2.success, true);
  assert.deepEqual(me1.data.user.uiOverrides.hiddenKeys, ['reports', 'problems']);
  assert.equal(me1.data.user.uiOverrides.defaultRoute, 'my_follow_ups');
  assert.deepEqual(me2.data.user.uiOverrides.hiddenKeys, ['dashboard']);
  assert.equal(me2.data.user.uiOverrides.defaultRoute, 'reservations');
  assert.ok(me1.data.roleUiDefaults.agent.enabled);
  assert.ok(me1.data.roleUiDefaults.supervisor.enabled);

  // Verify resolveRoleUiDefaultsForUser applies role defaults + per-employee flags independently
  const eff1 = crmCore.resolveRoleUiDefaultsForUser(me1.data.user, me1.data.roleUiDefaults, me1.data.uiSimplification);
  const eff2 = crmCore.resolveRoleUiDefaultsForUser(me2.data.user, me2.data.roleUiDefaults, me2.data.uiSimplification);
  assert.equal(eff1.uiSimplification.hideFinancialBreakdown, false);
  assert.equal(eff1.uiSimplification.hideDashboardRadar, true);
  assert.equal(eff2.uiSimplification.hideFinancialBreakdown, true);
  assert.deepEqual(eff2.visibleCols, ['reservationNumber', 'totalAmount']);

  // Updating unrelated fields on agent1 via updateEmployee must preserve uiOverrides
  const updRes = await dispatchCrmRequest(db, {
    action: 'updateEmployee',
    token: adminToken,
    payload: { employeeId: 'EMP_AGENT1', jobTitle: 'Senior Agent' }
  });
  assert.equal(updRes.success, true);
  assert.deepEqual(updRes.data.uiOverrides.hiddenKeys, ['reports', 'problems']);

  // Delta sync returns clientUiConfig.roleUiDefaults + changedEmployees with uiOverrides
  const deltaRes = await dispatchCrmRequest(db, {
    action: 'getDeltaSync',
    token: emp1Token,
    payload: { updatedAfter: '2020-01-01T00:00:00.000Z', includeUiConfig: true }
  });
  assert.equal(deltaRes.success, true);
  assert.ok(deltaRes.data.clientUiConfig.roleUiDefaults.agent);
  const deltaEmp2 = deltaRes.data.changedEmployees.find((e: any) => e.id === 'EMP_AGENT2');
  assert.ok(deltaEmp2);
  assert.deepEqual(deltaEmp2.uiOverrides.hiddenKeys, ['dashboard']);

  // Restore employee scope for agent1 leaves agent2 and role defaults untouched
  const rstEmp1 = await dispatchCrmRequest(db, {
    action: 'restoreUiDefaults',
    token: adminToken,
    payload: { scope: 'employee', employeeId: 'EMP_AGENT1' }
  });
  assert.equal(rstEmp1.success, true);
  const me1After = await dispatchCrmRequest(db, { action: 'getMe', token: emp1Token });
  const me2After = await dispatchCrmRequest(db, { action: 'getMe', token: emp2Token });
  assert.deepEqual(me1After.data.user.uiOverrides.hiddenKeys, []);
  assert.deepEqual(me2After.data.user.uiOverrides.hiddenKeys, ['dashboard']);
});

test('server.ts SSE handler runs ensureSchemaInitialized before requireAuth', () => {
  const serverSource = fs.readFileSync('server.ts', 'utf8');
  const idxEnsure = serverSource.indexOf('await ensureSchemaInitialized(exec)');
  const idxAuth = serverSource.indexOf('await requireAuth(exec, rawToken)');
  assert.ok(idxEnsure !== -1 && idxAuth !== -1 && idxEnsure < idxAuth);
});
