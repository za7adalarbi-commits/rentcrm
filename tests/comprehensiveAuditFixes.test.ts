import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { AuthSession } from '../backend/auth';
import {
  AUDIT_AND_HEALTH_MIGRATIONS,
  recalculateReservationExtensionCounts,
  type DbClient,
  type DbExecutor,
  type QueryResult,
  type QueryResultRow
} from '../backend/db';
import { SCHEMA_SQL } from '../backend/schemaSql';
import {
  buildRentalGateEndpointUrl,
  normalizeRgApiBaseUrl
} from '../backend/coreBinding';
import { getSyncSecretDiagnostics } from '../backend/serverConfig';
import {
  resolveDataIntegrityIssue,
  rollbackDataIntegrityAction,
  runDataIntegrityCheck
} from '../backend/integrityService';
import {
  addCustomerNote,
  assignCustomerNoteEmployee,
  changeCustomerNoteStatus,
  testRentalGateConnection,
  updateCustomerNote
} from '../backend/queries';
import {
  classifyOutboxMirrorError,
  fetchRentalGateSnapshotReadOnly,
  flushSheetsMirrorOutbox,
  pullFromRentalGateDirect
} from '../backend/syncService';
import {
  diffSchemaManifest,
  EXPECTED_MIGRATION_IDS,
  parseSchemaManifestFromSql,
  runDatabaseHealthCenterScan
} from '../backend/healthCenter';

function makeSession(role = 'developer', permissions: string[] = []): AuthSession {
  const nowIso = new Date().toISOString();
  return {
    tokenHash: 'hash-test',
    employeeId: 'EMP_TEST_1',
    username: role,
    role,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: 'EMP_TEST_1',
      name: 'Test Developer',
      username: role,
      phone: '',
      email: '',
      jobTitle: role,
      role,
      permissions,
      status: 'active',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  };
}

function createMockExecutor(
  handler: (sql: string, params?: any[], inTx?: boolean) => Promise<{ rows: any[]; rowCount: number }>
): DbExecutor {
  const runQuery = (inTx: boolean) => async <T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const res = await handler(sql, params, inTx);
    return res as QueryResult<T>;
  };
  return {
    query: runQuery(false),
    async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
      return fn({ query: runQuery(true) });
    }
  };
}

function loadGasSandbox(sheetRowsByName: Record<string, { frozenRows?: number; maxRows?: number; rows: any[][] }>) {
  const deletedOps: Array<{ sheet: string; kind: 'deleteRow' | 'deleteRows'; start: number; count: number }> = [];
  const clearedRanges: Array<{ sheet: string; r: number; c: number; nr: number; nc: number }> = [];

  const buildSheet = (name: string) => {
    const state = sheetRowsByName[name] || { frozenRows: 1, maxRows: 2, rows: [['id']] };
    const frozen = state.frozenRows ?? 1;
    let maxRows = state.maxRows ?? Math.max(state.rows.length, frozen + 1);
    return {
      getName: () => name,
      getFrozenRows: () => frozen,
      getMaxRows: () => maxRows,
      getLastRow: () => state.rows.length,
      getLastColumn: () => (state.rows[0]?.length || 1),
      getMaxColumns: () => Math.max(20, state.rows[0]?.length || 1),
      getRange: (r: number, c: number, nr = 1, nc = 1) => ({
        getValues: () => {
          const out: any[][] = [];
          for (let i = 0; i < nr; i++) {
            const srcRow = state.rows[r - 1 + i] || [];
            const copy: any[] = [];
            for (let j = 0; j < nc; j++) {
              copy.push(srcRow[c - 1 + j] ?? '');
            }
            out.push(copy);
          }
          return out;
        },
        setValues: (vals: any[][]) => {
          for (let i = 0; i < vals.length; i++) {
            while (state.rows.length < r - 1 + i + 1) state.rows.push([]);
            for (let j = 0; j < vals[i].length; j++) {
              state.rows[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
          maxRows = Math.max(maxRows, state.rows.length);
        },
        clearContent: () => {
          clearedRanges.push({ sheet: name, r, c, nr, nc });
          for (let i = 0; i < nr; i++) {
            const idx = r - 1 + i;
            if (state.rows[idx]) {
              for (let j = 0; j < nc; j++) state.rows[idx][c - 1 + j] = '';
            }
          }
          while (state.rows.length > 1 && state.rows[state.rows.length - 1].every((v) => v === '' || v === null || v === undefined)) {
            state.rows.pop();
          }
          return { clearNote: () => undefined };
        },
        clearNote: () => undefined,
        setNumberFormat: () => undefined
      }),
      deleteRow: (rowIdx: number) => {
        if (maxRows - 1 <= frozen) {
          throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        }
        deletedOps.push({ sheet: name, kind: 'deleteRow', start: rowIdx, count: 1 });
        state.rows.splice(rowIdx - 1, 1);
        maxRows -= 1;
      },
      deleteRows: (rowIdx: number, count: number) => {
        if (maxRows - count <= frozen) {
          throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        }
        deletedOps.push({ sheet: name, kind: 'deleteRows', start: rowIdx, count });
        state.rows.splice(rowIdx - 1, count);
        maxRows -= count;
      }
    };
  };

  const sheetsMap = new Map<string, ReturnType<typeof buildSheet>>();
  for (const name of Object.keys(sheetRowsByName)) {
    sheetsMap.set(name, buildSheet(name));
  }

  const rootDir = process.cwd();
  const dbGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'Database.gs'), 'utf8');
  const neonSyncGs = fs.readFileSync(path.join(rootDir, 'google-apps-script', 'NeonSync.gs'), 'utf8');

  const ctx: Record<string, any> = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    _rgRecordsCache: {},
    _rgDirtyCacheSheets: {},
    RG_HOT_PERSIST_CACHE_SHEETS: {},
    RG_SHEETS: {
      RESERVATIONS: 'الحجوزات',
      EXTENSIONS: 'التمديدات',
      ASSIGNMENTS: 'التوزيعات',
      FOLLOWUPS: 'المتابعات',
      FOLLOWUP_HISTORY: 'سجل المتابعات',
      PROBLEMS: 'المشاكل',
      ISSUES: 'المشاكل_قديم',
      PROBLEM_UPDATES: 'تحديثات المشاكل',
      EMPLOYEES: 'الموظفين',
      USERS: 'المستخدمين',
      SETTINGS: 'الإعدادات',
      NOTIFICATIONS: 'الإشعارات',
      CUSTOMERS: 'العملاء',
      CUSTOMER_NOTES: 'ملاحظات العملاء',
      CUSTOMER_NOTE_STATUSES: 'حالات ملاحظات العملاء',
      CUSTOMER_NOTE_ATTACHMENTS: 'مرفقات ملاحظات العملاء',
      CUSTOMER_NOTE_HISTORY: 'سجل ملاحظات العملاء'
    },
    normalizeStr: (v: unknown) => (v === null || v === undefined ? '' : String(v).trim()),
    nowIso: () => '2026-11-27T12:00:00.000Z',
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k === 'SYNC_API_SECRET' ? 'test' : ''),
        setProperty: () => undefined,
        deleteProperty: () => undefined
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      }),
      openById: () => ({
        getSpreadsheetTimeZone: () => 'Asia/Riyadh',
        getSheetByName: (n: string) => sheetsMap.get(n) || null
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => undefined,
        remove: () => undefined
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => undefined
      })
    },
    validateNeonSyncSecret_: () => true,
    requireNeonSyncAuth_: () => undefined
  };
  vm.createContext(ctx);
  vm.runInContext(dbGs, ctx);
  ctx.getSpreadsheet = () => ({
    getSpreadsheetTimeZone: () => 'Asia/Riyadh',
    getSheetByName: (n: string) => sheetsMap.get(n) || null
  });
  ctx.getSheetOrCreate = (_ss: any, n: string) => {
    if (!sheetsMap.has(n)) sheetsMap.set(n, buildSheet(n));
    return sheetsMap.get(n);
  };
  ctx.getSheet = (n: string) => sheetsMap.get(n) || null;
  ctx.getEffectiveHeaders = (sheet: any) => sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  ctx.invalidateCache = () => undefined;
  ctx.getSpreadsheetTz_ = () => 'Asia/Riyadh';
  ctx.applyTextFormatForDateColumns_ = () => undefined;
  ctx.recordToRowArray = (headers: string[], rec: Record<string, any>) => headers.map((h) => rec[h] ?? '');
  vm.runInContext(neonSyncGs, ctx);
  ctx.validateNeonSyncSecret_ = () => true;
  ctx.requireNeonSyncAuth_ = () => undefined;
  return { ctx, deletedOps, clearedRanges, sheetsMap };
}

test('1. resolveDataIntegrityIssue & rollbackDataIntegrityAction bind $13::text and $14::timestamptz distinctly across all modes', async () => {
  const session = makeSession('developer', ['manage_developer_tools']);
  const capturedQueries: Array<{ sql: string; params: any[] }> = [];

  const issueRow = {
    id: 'DIISS_1',
    run_id: 'DIRUN_1',
    discrepancy_type: 'field_mismatch',
    reservation_id: 'RES_1',
    reservation_number: '104',
    field_name: 'customerName',
    rg_snapshot_json: {
      id: 104,
      reservation_number: 'RG-104',
      reference_number: '104',
      status: 'confirmed',
      status_ar: 'مؤكد',
      customer: { name: 'خالد محمد', mobile: '0551112233' },
      pickup_date: '2026-11-01',
      return_date: '2026-11-05',
      car: { name: 'Camry' },
      company: { name: 'Al Wefaq' }
    },
    neon_snapshot_json: {
      id: 'RES_1',
      reservationNumber: '104',
      customerName: 'اسم قديم'
    }
  };

  let curRes = {
    id: 'RES_1',
    reservation_number: '104',
    original_status_code: 'pending',
    internal_status: 'بانتظار التأكيد',
    customer_name: 'اسم قديم',
    customer_phone: '0500000000',
    start_date: '2026-11-01',
    end_date: '2026-11-04',
    car_name: 'Sonata',
    company_name: 'Old Co',
    last_updated_at: '2026-11-01T00:00:00.000Z'
  };

  let rollbackActionRow: any = null;
  const actionsById = new Map<string, any>();

  const mockExec = createMockExecutor(async (sql, params = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('FROM data_integrity_issues WHERE id = $1')) {
      return { rows: [issueRow], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM reservations WHERE deleted_at IS NULL') || sql.includes('SELECT * FROM reservations WHERE id = $1')) {
      return { rows: [curRes], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE reservations')) {
      assert.match(sql, /last_updated_at\s*=\s*\$13::text/i);
      assert.match(sql, /updated_at\s*=\s*\$14::timestamptz/i);
      assert.equal(params.length, 14, 'UPDATE reservations must pass 14 distinct parameters so $13 never carries dual text/timestamptz inference');
      curRes = {
        ...curRes,
        original_status_code: params[1],
        internal_status: params[2],
        customer_name: params[3],
        customer_phone: params[4],
        start_date: params[5],
        end_date: params[6],
        car_name: params[7],
        company_name: params[8],
        last_updated_at: params[12]
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO data_integrity_actions')) {
      const act = {
        id: params[0],
        issue_id: params[1],
        reservation_id: params[3],
        before_snapshot_json: JSON.parse(params[8]),
        after_snapshot_json: JSON.parse(params[9]),
        rollback_supported: params[10],
        rolled_back: false
      };
      actionsById.set(act.id, act);
      if (act.rollback_supported && !rollbackActionRow) rollbackActionRow = act;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM data_integrity_actions WHERE id = $1')) {
      const found = actionsById.get(params[0]) || null;
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  // Preview mode
  const prev = await resolveDataIntegrityIssue(mockExec, session, { issueId: 'DIISS_1', resolutionAction: 'preview' });
  assert.equal(prev.previewOnly, true);

  // sync_from_rg & update_fields both execute the 14-param UPDATE; mark_resolved & ignore succeed cleanly
  for (const mode of ['sync_from_rg', 'update_fields', 'mark_resolved', 'ignore']) {
    const res = await resolveDataIntegrityIssue(mockExec, session, {
      issueId: 'DIISS_1',
      resolutionAction: mode,
      approved: true,
      note: `test-${mode}`
    });
    assert.equal(res.resolved, true);
    assert.equal(res.resolutionStatus, mode === 'ignore' ? 'ignored' : 'resolved');
  }

  assert.equal(curRes.customer_name, 'خالد محمد');
  assert.ok(rollbackActionRow, 'Rollback-capable action snapshot should be recorded');

  const rb = await rollbackDataIntegrityAction(mockExec, session, { actionId: rollbackActionRow.id });
  assert.equal(rb.rolledBack, true);

  const updates = capturedQueries.filter((q) => q.sql.startsWith('UPDATE reservations'));
  assert.equal(updates.length, 3, 'Expected 2 resolution updates + 1 rollback update on reservations');
});

test('2. runDataIntegrityCheck deduplicates open data_integrity_issues on repeated runs', async () => {
  const session = makeSession('developer', ['manage_developer_tools']);
  const openIssues: any[] = [];
  let updatedExisting = 0;
  let insertedNew = 0;

  const mockExec = createMockExecutor(async (sql, params = []) => {
    if (sql.includes('FROM settings')) {
      return { rows: [{ key: 'data_integrity_settings', value: '{}' }], rowCount: 1 };
    }
    if (sql.includes('FROM reservations') && sql.includes('WHERE deleted_at IS NULL')) {
      return {
        rows: [{
          id: 'RES_104',
          reservation_number: '104',
          source_reservation_id: 'RG-104',
          reference_number: '104',
          original_status_code: 'pending',
          internal_status: 'بانتظار التأكيد',
          customer_name: 'عميل 104',
          customer_phone: '0501234567',
          start_date: '2026-11-01',
          end_date: '2026-11-05',
          car_name: 'Camry',
          company_name: 'Al Wefaq',
          extensions_count: 0
        }],
        rowCount: 1
      };
    }
    if (sql.includes('FROM data_integrity_issues') && sql.includes("resolution_status = 'open'")) {
      return { rows: openIssues, rowCount: openIssues.length };
    }
    if (sql.includes('UPDATE data_integrity_issues') && sql.includes('run_id = $2')) {
      updatedExisting++;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO data_integrity_issues')) {
      insertedNew++;
      openIssues.push({
        id: params[0],
        run_id: params[1],
        discrepancy_type: params[2],
        reservation_id: params[5],
        reservation_number: params[6],
        field_name: params[7],
        resolution_status: 'open'
      });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const mockSnap = {
    reservations: [{
      id: 'RG-104',
      reservation_number: 'RG-104',
      reference_number: '104',
      status: 'confirmed',
      status_ar: 'مؤكد',
      customer: { name: 'عميل 104', mobile: '0501234567' },
      pickup_date: '2026-11-01',
      return_date: '2026-11-05',
      car: { name: 'Camry' },
      company: { name: 'Al Wefaq' },
      extensions_count: 0
    }],
    extensions: [],
    incompleteEndpoints: [],
    pagesFetched: 1,
    reportedTotalElements: 1
  };

  await runDataIntegrityCheck(mockExec, session, { runMode: 'manual', _mockRgSnapshot: mockSnap });
  const countAfterFirstRun = openIssues.length;
  assert.ok(countAfterFirstRun >= 1, 'First integrity run should record the open issue');

  await runDataIntegrityCheck(mockExec, session, { runMode: 'manual', _mockRgSnapshot: mockSnap });
  assert.equal(openIssues.length, countAfterFirstRun, 'Second integrity run must NOT duplicate existing open issues');
  assert.equal(updatedExisting, countAfterFirstRun, 'Existing open issues should be updated in-place on subsequent run');
});

test('3. Customer note mutations isolate notification failures & SAVEPOINT errors without triggering 25P02 aborted transaction', async () => {
  const session = makeSession('supervisor', ['add_customer_note', 'edit_customer_note', 'change_customer_note_status', 'assign_customer_note']);
  let txAborted = false;
  let savepoints = 0;
  let rollbacksToSavepoint = 0;
  let noteRow: any = null;
  const errorLogs: any[] = [];

  const mockExec: DbExecutor = {
    async query<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
      if (sql.includes('FROM settings')) {
        if (sql.includes('customer_notes_config')) {
          return {
            rows: [{
              value: JSON.stringify({
                notifications: {
                  onAdd: { enabled: true, recipientRoles: ['supervisor'] },
                  onStatusChange: { enabled: true, recipientRoles: ['supervisor'] },
                  onAssign: { enabled: true, recipientEmployeeIds: [] }
                }
              })
            }],
            rowCount: 1
          } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      }
      if (sql.includes('FROM customer_note_statuses')) {
        return {
          rows: [
            { id: 'OPEN', name: 'مفتوحة', color: '#f59e0b', is_active: true, is_closed_status: false, sort_order: 1 },
            { id: 'CLOSED', name: 'مغلقة', color: '#10b981', is_active: true, is_closed_status: true, sort_order: 2 }
          ],
          rowCount: 2
        } as any;
      }
      if (sql.includes('INSERT INTO notifications') || sql.includes('FROM employees WHERE')) {
        // Simulate missing partial index 42P10 and runtime failure in optional notification dispatch
        if (sql.includes('ON CONFLICT (event_key)')) {
          const err: any = new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification');
          err.code = '42P10';
          throw err;
        }
        if (sql.includes('INSERT INTO notifications')) {
          throw new Error('NOTIFICATION_SCHEMA_FAILURE');
        }
        if (sql.includes("SELECT id, name, role FROM employees")) {
          return { rows: [{ id: 'EMP_SUP_1', name: 'Sup', role: 'supervisor' }], rowCount: 1 } as any;
        }
      }
      if (sql.includes('INSERT INTO error_logs')) {
        errorLogs.push(params);
        return { rows: [], rowCount: 1 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    },
    async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
      txAborted = false;
      const txClient: DbClient = {
        async query<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
          const trimmed = sql.trim();
          if (/^SAVEPOINT\s+/i.test(trimmed)) {
            savepoints++;
            return { rows: [], rowCount: 0 } as any;
          }
          if (/^ROLLBACK\s+TO\s+SAVEPOINT\s+/i.test(trimmed)) {
            rollbacksToSavepoint++;
            txAborted = false;
            return { rows: [], rowCount: 0 } as any;
          }
          if (/^RELEASE\s+SAVEPOINT\s+/i.test(trimmed)) {
            return { rows: [], rowCount: 0 } as any;
          }
          if (txAborted) {
            const e: any = new Error('current transaction is aborted, commands ignored until end of transaction block');
            e.code = '25P02';
            throw e;
          }

          if (sql.includes('FROM customers WHERE id = $1')) {
            return { rows: [{ id: 'CUST_1', full_name: 'عميل اختبار' }], rowCount: 1 } as any;
          }
          if (sql.includes('FROM employees WHERE id = $1')) {
            return { rows: [{ id: 'EMP_TARGET', name: 'موظف متابعة', role: 'agent', status: 'active' }], rowCount: 1 } as any;
          }
          if (sql.includes('INSERT INTO customer_notes')) {
            noteRow = {
              id: params[0],
              customer_id: params[1],
              customer_name: 'عميل اختبار',
              reservation_id: params[2] || '',
              reservation_number: params[3] || '',
              problem_id: '',
              problem_number: '',
              title: params[6],
              note_type: params[7],
              content: params[8],
              status_id: params[9],
              status_name: params[10],
              status_color: params[11],
              status_is_active: true,
              assigned_employee_id: params[12],
              assigned_employee_name: params[13],
              is_internal: params[14],
              is_closed: params[15],
              source_section: params[19],
              created_by_id: params[20],
              created_by_name: params[21],
              updated_by_id: params[20],
              updated_by_name: params[21],
              created_at: params[22],
              updated_at: params[22]
            };
            return { rows: [], rowCount: 1 } as any;
          }
          if (sql.includes('UPDATE customers') && sql.includes('last_contact_ts')) {
            assert.match(sql, /COALESCE\(last_contact_ts,\s*\$3::timestamptz\)/i);
            assert.match(sql, /THEN\s+\$4::text\s+ELSE\s+last_contact_at/i);
            return { rows: [], rowCount: 1 } as any;
          }
          if (sql.includes('INSERT INTO activity_log') && !sql.includes('user_role')) {
            return { rows: [], rowCount: 1 } as any;
          }
          if (sql.includes('INSERT INTO activity_log')) {
            // Simulate primary activity_log schema error inside SAVEPOINT to verify fallback succeeds cleanly
            txAborted = true;
            throw new Error('column "user_role" of relation "activity_log" does not exist');
          }
          if (sql.includes('FROM customer_notes') && noteRow) {
            return { rows: [noteRow], rowCount: 1 } as any;
          }
          if (sql.includes('UPDATE customer_notes') && noteRow) {
            noteRow = { ...noteRow, title: params[1] ?? noteRow.title, content: params[2] ?? noteRow.content, updated_at: new Date().toISOString() };
            return { rows: [], rowCount: 1 } as any;
          }
          if (sql.includes('FROM customer_note_attachments')) {
            return { rows: [], rowCount: 0 } as any;
          }
          return { rows: [], rowCount: 0 } as any;
        }
      };
      return fn(txClient);
    }
  };

  const added = await addCustomerNote(mockExec, session, {
    customerId: 'CUST_1',
    noteType: 'تواصل',
    title: 'تحديث',
    content: 'تم التواصل مع العميل وتأكيد البيانات',
    statusId: 'OPEN'
  });
  assert.ok(added.note?.id, 'Note must be saved even when optional notifications fail');
  assert.ok(savepoints >= 1 && rollbacksToSavepoint >= 1, 'logActivity primary failure must roll back only its savepoint');
  assert.ok(Array.isArray(added.notificationWarnings) && added.notificationWarnings.length > 0, 'Notification warning should be surfaced safely');
  assert.ok(errorLogs.length > 0, 'Notification failure must be logged safely to error_logs instead of swallowed');

  const updated = await updateCustomerNote(mockExec, session, {
    id: added.note.id,
    title: 'عنوان معدل',
    content: 'محتوى معدل للملاحظة'
  });
  assert.equal(updated.note.title, 'عنوان معدل');

  const statusChanged = await changeCustomerNoteStatus(mockExec, session, {
    id: added.note.id,
    statusId: 'CLOSED',
    reason: 'مكتمل'
  });
  assert.equal(statusChanged.note.id, added.note.id);

  const assigned = await assignCustomerNoteEmployee(mockExec, session, {
    id: added.note.id,
    assignedEmployeeId: 'EMP_TARGET'
  });
  assert.equal(assigned.note.id, added.note.id);
});

test('4. RG API base URL normalization prevents duplicated /reservations/filter/reservations/filter paths', async () => {
  assert.equal(normalizeRgApiBaseUrl('https://api.rentalgate.net/api/reservations/filter'), 'https://api.rentalgate.net/api');
  assert.equal(normalizeRgApiBaseUrl('https://api.rentalgate.net/api/api/'), 'https://api.rentalgate.net/api');
  assert.equal(normalizeRgApiBaseUrl('https://api.rentalgate.net/api/reservation-extends/filter?page=0'), 'https://api.rentalgate.net/api');

  const built = buildRentalGateEndpointUrl(
    'https://api.rentalgate.net/api/reservations/filter/',
    '/reservations/filter',
    { page: 0, size: 100 }
  );
  assert.equal(built, 'https://api.rentalgate.net/api/reservations/filter?page=0&size=100');

  const requestedUrls: string[] = [];
  const prevRgUrl = process.env.RG_API_BASE_URL;
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_API_BASE_URL = 'https://api.rentalgate.net/api/reservations/filter';
  process.env.RG_TOKEN = 'rg-token-valid';
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    requestedUrls.push(String(input));
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [], totalElements: 0, last: true };
      }
    } as any;
  }) as typeof fetch;

  try {
    const mockExec = createMockExecutor(async (sql) => {
      if (sql.includes('UPDATE sync_worker_state') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'primary' }], rowCount: 1 };
      }
      if (sql.includes('FROM sync_worker_state')) {
        return { rows: [{ id: 'primary', is_syncing: false }], rowCount: 1 };
      }
      if (sql.includes('FROM settings')) {
        return {
          rows: [
            { key: 'rg_api_base_url', value: 'https://api.rentalgate.net/api/reservations/filter' }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const devSession = makeSession('developer', ['manage_settings', 'sync_data']);
    await testRentalGateConnection(mockExec, devSession);
    await pullFromRentalGateDirect(mockExec, devSession.user, { maxPages: 1 }, globalThis.fetch);
    await fetchRentalGateSnapshotReadOnly(mockExec, { scopes: ['reservations'], maxPages: 1 });

    assert.ok(requestedUrls.length >= 3);
    for (const u of requestedUrls) {
      assert.ok(!u.includes('reservations/filter/reservations/filter'), `Duplicated path detected in URL: ${u}`);
      assert.ok(!u.includes('/api/api/'), `Duplicated /api detected in URL: ${u}`);
    }
  } finally {
    globalThis.fetch = prevFetch;
    if (prevRgUrl === undefined) delete process.env.RG_API_BASE_URL;
    else process.env.RG_API_BASE_URL = prevRgUrl;
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('5. Migration 006 & recalculateReservationExtensionCounts preserve existing history and sync counts idempotently', async () => {
  const mig006 = AUDIT_AND_HEALTH_MIGRATIONS.find((m) => m.id === '2026_11_27_006_integrity_schema_and_extensions_recalc');
  assert.ok(mig006, 'Migration 006 must exist in AUDIT_AND_HEALTH_MIGRATIONS');

  const rootDir = process.cwd();
  const schemaDisk = fs.readFileSync(path.join(rootDir, 'database', 'schema.sql'), 'utf8').trim();
  assert.equal(SCHEMA_SQL.trim(), schemaDisk);
  assert.match(SCHEMA_SQL, /note_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+customer_notes\(id\)\s+ON\s+DELETE\s+RESTRICT/i);

  // Case A: zero orphans -> validates fk_customer_note_history_note_id and converts TEXT last_contact_ts
  const executedSqlA: string[] = [];
  await mig006.run({
    async query(sql: string) {
      executedSqlA.push(sql);
      if (sql.includes("column_name = 'last_contact_ts'")) {
        return { rows: [{ data_type: 'text' }], rowCount: 1 } as any;
      }
      if (sql.includes('pg_get_constraintdef')) {
        return { rows: [{ conname: 'customer_note_history_note_id_fkey', condef: 'FOREIGN KEY (note_id) REFERENCES customer_notes(id) ON DELETE CASCADE' }], rowCount: 1 } as any;
      }
      if (sql.includes('LEFT JOIN customer_notes n')) {
        return { rows: [{ cnt: 0 }], rowCount: 1 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    }
  });
  assert.ok(executedSqlA.some((s) => /ALTER\s+COLUMN\s+last_contact_ts\s+TYPE\s+TIMESTAMPTZ/i.test(s)));
  assert.ok(executedSqlA.some((s) => /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+"customer_note_history_note_id_fkey"/i.test(s)));
  assert.ok(executedSqlA.some((s) => /ON\s+DELETE\s+RESTRICT\s+NOT\s+VALID/i.test(s)));
  assert.ok(executedSqlA.some((s) => /VALIDATE\s+CONSTRAINT\s+fk_customer_note_history_note_id/i.test(s)));
  assert.ok(!executedSqlA.some((s) => /\bDELETE\s+FROM\s+extensions\b|\bDELETE\s+FROM\s+customer_note_history\b/i.test(s)), 'Migration must never delete extensions or history rows');

  // Case B: orphans present -> adds NOT VALID FK without deleting history and skips VALIDATE CONSTRAINT
  const executedSqlB: string[] = [];
  await mig006.run({
    async query(sql: string) {
      executedSqlB.push(sql);
      if (sql.includes("column_name = 'last_contact_ts'")) {
        return { rows: [{ data_type: 'timestamp with time zone' }], rowCount: 1 } as any;
      }
      if (sql.includes('pg_get_constraintdef')) {
        return { rows: [], rowCount: 0 } as any;
      }
      if (sql.includes('LEFT JOIN customer_notes n')) {
        return { rows: [{ cnt: 3 }], rowCount: 1 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    }
  });
  assert.ok(executedSqlB.some((s) => /ON\s+DELETE\s+RESTRICT\s+NOT\s+VALID/i.test(s)));
  assert.ok(!executedSqlB.some((s) => /VALIDATE\s+CONSTRAINT\s+fk_customer_note_history_note_id/i.test(s)));

  // Extension count recalculation helper
  const resStore = [
    { id: 'R_104', reservation_number: '104', extensions_count: 1, has_extensions: true },
    { id: 'R_1042', reservation_number: '1042', extensions_count: 2, has_extensions: true },
    { id: 'R_146', reservation_number: '146', extensions_count: 0, has_extensions: false }
  ];
  const extStore = [
    { id: 'E1', reservation_id: 'R_104' },
    { id: 'E2', reservation_id: 'R_104' },
    { id: 'E3', reservation_id: 'R_1042' },
    { id: 'E4', reservation_id: 'R_146' }
  ];
  const mockRecalcExec = createMockExecutor(async (sql) => {
    if (sql.includes('UPDATE extensions e') && sql.includes('SET reservation_id = r.id')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('WITH ext_counts AS') && sql.includes('UPDATE reservations r')) {
      let updated = 0;
      const out: any[] = [];
      for (const r of resStore) {
        const cnt = extStore.filter((e) => e.reservation_id === r.id).length;
        if (r.extensions_count !== cnt || r.has_extensions !== (cnt > 0)) {
          r.extensions_count = cnt;
          r.has_extensions = cnt > 0;
          updated++;
          out.push({ id: r.id });
        }
      }
      return { rows: out, rowCount: updated };
    }
    return { rows: [], rowCount: 0 };
  });
  const updatedFirst = await recalculateReservationExtensionCounts(mockRecalcExec);
  assert.equal(updatedFirst.updatedCounts, 3);
  assert.equal(resStore[0].extensions_count, 2);
  assert.equal(resStore[1].extensions_count, 1);
  assert.equal(resStore[2].extensions_count, 1);
  assert.equal(resStore[2].has_extensions, true);
  const updatedSecond = await recalculateReservationExtensionCounts(mockRecalcExec);
  assert.equal(updatedSecond.updatedCounts, 0, 'Recalculation must be idempotent');
});

test('6. healthCenter fixes sent_at SQL, flags optional vs required customer gaps accurately, detects FK CASCADE, and checks SYNC_API_SECRET diagnostics', async () => {
  assert.ok(EXPECTED_MIGRATION_IDS.includes('2026_11_27_006_integrity_schema_and_extensions_recalc'));

  const manifest = parseSchemaManifestFromSql(SCHEMA_SQL);
  const liveCols = Array.from(manifest.tables.values()).flatMap((tbl) =>
    Array.from(tbl.columns.values()).map((col) => ({
      table_name: tbl.name,
      column_name: col.name,
      data_type: col.dataType,
      is_nullable: 'YES'
    }))
  );
  const liveCons = Array.from(manifest.tables.values()).flatMap((tbl) =>
    tbl.constraints.map((c, idx) => ({
      table_name: tbl.name,
      constraint_name: `${tbl.name}_${c.kind.toLowerCase().replace(/\s+/g, '_')}_${idx}`,
      constraint_type: c.kind
    }))
  );
  const liveIdxs = Array.from(manifest.indexes.values()).map((ix) => ({
    tablename: ix.table,
    indexname: ix.name
  }));
  const fkDiff = diffSchemaManifest(
    manifest,
    Array.from(manifest.tables.keys()),
    liveCols,
    liveCons,
    liveIdxs,
    EXPECTED_MIGRATION_IDS.map((id) => ({ id })),
    [{ table_name: 'customer_note_history', constraint_name: 'cnh_fk', delete_rule: 'CASCADE', convalidated: true }]
  );
  assert.equal(fkDiff.status, 'warning');
  assert.ok(fkDiff.constraintMismatches.some((c) => c.table === 'customer_note_history'));

  const seenSql: string[] = [];
  const healthRunsStore: any[] = [];
  const mockExec = createMockExecutor(async (sql, params = []) => {
    seenSql.push(sql);
    if (sql.includes('INSERT INTO health_center_runs')) {
      healthRunsStore.unshift({
        id: params[0],
        scope: params[1],
        overall_status: params[2],
        triggered_by_id: params[3],
        triggered_by_name: params[4],
        duration_ms: params[5],
        summary_json: JSON.parse(params[6]),
        sections_json: JSON.parse(params[7]),
        error_message: '',
        started_at: params[8],
        finished_at: params[9]
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM health_center_runs')) {
      return { rows: healthRunsStore, rowCount: healthRunsStore.length };
    }
    if (sql.includes('SELECT COALESCE(synced_at, processed_at, updated_at) AS sent_at')) {
      return { rows: [{ sent_at: '2026-11-27T11:55:00.000Z', updated_at: '2026-11-27T11:55:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('FROM sheets_mirror_outbox') && sql.includes('sent_cnt')) {
      return { rows: [{ sent_cnt: 10, pending_cnt: 0, processing_cnt: 0, retry_cnt: 0, failed_cnt: 0, permanent_failed_cnt: 0, oldest_unsynced_at: null, total_cnt: 10 }], rowCount: 1 };
    }
    if (sql.includes("FROM sync_worker_state WHERE id = 'primary'")) {
      return { rows: [{ id: 'primary', status: 'idle', is_syncing: false, auto_sync_enabled: true, interval_seconds: 60, consecutive_errors: 0, error_count: 0, last_success_at: '2026-11-27T12:00:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('FROM sync_log')) {
      return { rows: [{ id: 'SL_1', status: 'success', finished_at: '2026-11-27T12:00:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('incomplete_customers') || sql.includes('COALESCE(TRIM(id_number)')) {
      // Only optional gaps (id_number & email missing), required phone = 0!
      return { rows: [{ missing_id: 24, missing_phone: 0, missing_email: 31 }], rowCount: 1 };
    }
    if (sql.includes('FROM data_integrity_runs') && sql.includes("status IN ('completed', 'partial')")) {
      return { rows: [{ id: 'DIRUN_1', status: 'completed', run_mode: 'manual', rg_total_count: 50, neon_total_count: 50, discrepancies_count: 0, summary_json: { matchedCount: 50 } }], rowCount: 1 };
    }
    if (sql.includes('FROM settings')) {
      return { rows: [{ key: 'sync_api_secret', value: 'super-secret-value-not-to-leak' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const diag = await getSyncSecretDiagnostics(mockExec);
  assert.equal(diag.configured, true);
  assert.ok(!('value' in diag), 'Diagnostics must never return raw secret');

  const diScan = await runDatabaseHealthCenterScan(mockExec, makeSession('developer', ['manage_developer_tools']), {
    section: 'data_integrity',
    compareWithRg: false
  });
  assert.equal(diScan.sections.data_integrity.status, 'healthy', 'Missing optional id_number/email must NOT degrade data_integrity status when phone is present');
  assert.equal(diScan.sections.data_integrity.anomalies.customerQuality.required.missingPhone, 0);
  assert.equal(diScan.sections.data_integrity.anomalies.customerQuality.optionalSourceGaps.missingIdNumber, 24);

  const syncScan = await runDatabaseHealthCenterScan(mockExec, makeSession('developer', ['manage_developer_tools']), {
    section: 'sync_health',
    compareWithRg: false
  });
  assert.equal(syncScan.sections.sync_health.status, 'healthy');
  assert.equal(syncScan.sections.sync_health.syncSecretDiagnostics.configured, true);
  assert.ok(!JSON.stringify(syncScan).includes('super-secret-value-not-to-leak'), 'Health report must never expose SYNC_API_SECRET');
  assert.ok(!seenSql.some((s) => /SELECT\s+sent_at\s*,\s*updated_at\s+FROM\s+sheets_mirror_outbox/i.test(s)), 'Must never select nonexistent bare sent_at column');
});

test('7. Outbox worker classifies transient vs permanent errors, claims chronologically, and updates synced_at on success', async () => {
  assert.equal(classifyOutboxMirrorError('UNAUTHORIZED: Invalid sync secret', 401).permanent, true);
  assert.equal(classifyOutboxMirrorError('Sorry, it is not possible to delete all non-frozen rows.', 200).permanent, true);
  assert.equal(classifyOutboxMirrorError('BLOCKED_BULK_DELETE: disabled', 200).permanent, true);
  assert.equal(classifyOutboxMirrorError('GAS HTTP 503', 503).permanent, false);
  assert.equal(classifyOutboxMirrorError('The operation was aborted due to timeout (AbortError)', 0).permanent, false);

  const outboxRows = [
    { id: 'OBX_1', entity_type: 'Reservation', entity_id: 'R1', action: 'upsertReservation', payload: { id: 'R1' }, status: 'pending', retry_count: 0, max_retries: 8, created_at: '2026-11-27T10:00:00Z' },
    { id: 'OBX_2', entity_type: 'Reservation', entity_id: 'R2', action: 'upsertReservation', payload: { id: 'R2' }, status: 'pending', retry_count: 0, max_retries: 8, created_at: '2026-11-27T10:01:00Z' }
  ];
  const updates: any[] = [];
  let claimSql = '';

  const mockExec = createMockExecutor(async (sql, params = []) => {
    if (sql.includes('FROM settings')) {
      return {
        rows: [
          { key: 'gas_webapp_url', value: 'https://script.google.com/macros/s/test/exec' },
          { key: 'sync_api_secret', value: 'secret-mirror-key-123' }
        ],
        rowCount: 2
      };
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED') && sql.includes("SET status = 'processing'")) {
      claimSql = sql;
      return { rows: outboxRows, rowCount: outboxRows.length };
    }
    if (sql.includes("SET status = 'sent'") && sql.includes('synced_at = NOW()')) {
      updates.push({ kind: 'sent', ids: params[0] });
      return { rows: [], rowCount: 2 };
    }
    if (sql.includes('UPDATE sheets_mirror_outbox') && sql.includes('retry_count = $3')) {
      updates.push({ kind: 'error', id: params[0], status: params[1], retryCount: params[2], err: params[3] });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  // Case 1: Transient HTTP 503 -> moves to 'retry' with incremented retry_count
  const resRetry = await flushSheetsMirrorOutbox(mockExec, async () => ({
    ok: false,
    status: 503,
    async text() { return 'Service Unavailable'; }
  } as any));
  assert.equal(resRetry.failed, 2);
  assert.equal(resRetry.permanentFailed, 0);
  assert.ok(updates.every((u) => u.kind === 'error' && u.status === 'retry' && u.retryCount === 1));
  assert.match(claimSql, /NOT EXISTS\s*\(/i, 'Claim query must enforce per-entity FIFO ordering');

  // Case 2: Permanent UNAUTHORIZED -> moves straight to terminal 'failed'
  updates.length = 0;
  const resPerm = await flushSheetsMirrorOutbox(mockExec, async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ success: false, message: 'UNAUTHORIZED: SYNC_API_SECRET mismatch' }); }
  } as any));
  assert.equal(resPerm.permanentFailed, 2);
  assert.ok(updates.every((u) => u.kind === 'error' && u.status === 'failed'));

  // Case 3: Success -> marks 'sent' with synced_at
  updates.length = 0;
  const resOk = await flushSheetsMirrorOutbox(mockExec, async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ success: true, applied: 2 }); }
  } as any));
  assert.equal(resOk.sent, 2);
  assert.equal(updates[0].kind, 'sent');
});

test('8. GAS clearSheetRecords, deleteRecordByKey & NeonSync protect frozen sheets and block bulk wipe', () => {
  const { ctx, deletedOps, clearedRanges, sheetsMap } = loadGasSandbox({
    'الحجوزات': {
      frozenRows: 1,
      maxRows: 3,
      rows: [
        ['id', 'reservationNumber', 'customerName'],
        ['RES_1', '101', 'أحمد'],
        ['RES_2', '102', 'سارة']
      ]
    },
    'التمديدات': {
      frozenRows: 1,
      maxRows: 2,
      rows: [
        ['id', 'reservationNumber'],
        ['EXT_1', '101']
      ]
    }
  });

  // Delete from 2-row frozen sheet (1 header + 1 data row) -> clears without throwing "delete all non-frozen rows"
  const removedExt = ctx.deleteRecordByKey('التمديدات', 'id', 'EXT_1');
  assert.equal(removedExt, true);
  assert.equal(sheetsMap.get('التمديدات')!.getLastRow(), 1);
  assert.ok(clearedRanges.some((c) => c.sheet === 'التمديدات' && c.r === 2));

  // clearSheetRecords on tight 3-row frozen sheet (maxRows === rows.length) -> preserves row 2 & headers, deletes only row 3
  const removedRes = ctx.clearSheetRecords('الحجوزات');
  assert.equal(removedRes, 2);
  assert.equal(sheetsMap.get('الحجوزات')!.getLastRow(), 1);
  assert.ok(deletedOps.every((op) => op.start >= 3), 'Must never attempt to delete row 2 when row 1 is frozen');

  // Re-populate 1 reservation and verify NeonSync blocks deleteAllReservations without touching rows
  sheetsMap.get('الحجوزات')!.getRange(2, 1, 1, 3).setValues([['RES_9', '999', 'عميل محفوظ']]);
  const syncRes = ctx.handleNeonMirrorSync_({
    syncSecret: 'test',
    items: [{ action: 'deleteAllReservations', data: {} }]
  });
  assert.equal(syncRes.skipped, 1);
  assert.ok(syncRes.errors.some((e: string) => /BLOCKED_BULK_DELETE/.test(e)));
  assert.equal(sheetsMap.get('الحجوزات')!.getLastRow(), 2, 'Blocked deleteAllReservations must leave Google Sheets data untouched');
});
