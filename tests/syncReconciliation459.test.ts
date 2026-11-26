import test from 'node:test';
import assert from 'node:assert/strict';
import { crmCore, hashPassword, hashToken } from '../backend/auth';
import { type DbClient, type DbExecutor, type QueryResult } from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';
import {
  extractRentalGatePagePayload,
  ingestIncrementalSyncBatch,
  pullFromRentalGateDirect,
  retryFailedSyncRecords
} from '../backend/syncService';

function createSyncMockDb(opts: { injectUpsertFailFor?: (rec: Record<string, any>) => boolean } = {}): DbExecutor & { state: Record<string, any[]> } {
  const state: Record<string, any[]> = {
    employees: [],
    users: [],
    sessions: [],
    settings: [],
    reservations: [],
    extensions: [],
    follow_up_history: [],
    sheets_mirror_outbox: [],
    notifications: [],
    sync_log: [],
    sync_checkpoints: []
  };
  const savepoints = new Map<string, string>();

  async function runQuery<T extends Record<string, any> = any>(sqlRaw: string, params: any[] = []): Promise<QueryResult<T>> {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SAVEPOINT ')) {
      const sp = sql.slice('SAVEPOINT '.length).trim();
      savepoints.set(sp, JSON.stringify({ reservations: state.reservations, extensions: state.extensions, follow_up_history: state.follow_up_history }));
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('RELEASE SAVEPOINT ')) {
      savepoints.delete(sql.slice('RELEASE SAVEPOINT '.length).trim());
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('ROLLBACK TO SAVEPOINT ')) {
      const sp = sql.slice('ROLLBACK TO SAVEPOINT '.length).trim();
      const raw = savepoints.get(sp);
      if (raw) {
        const snap = JSON.parse(raw);
        state.reservations = snap.reservations || [];
        state.extensions = snap.extensions || [];
        state.follow_up_history = snap.follow_up_history || [];
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM settings') || sql.startsWith('SELECT key, value FROM settings')) {
      const filterKeys = Array.isArray(params[0]) ? params[0] : null;
      const rows = filterKeys ? state.settings.filter((s) => filterKeys.includes(s.key)) : state.settings;
      return { rows: rows as any[], rowCount: rows.length };
    }
    if (sql.startsWith("SELECT value FROM settings WHERE key = '")) {
      const m = sql.match(/WHERE key = '([^']+)'/);
      const row = m ? state.settings.find((s) => s.key === m[1]) : null;
      return { rows: row ? [row] : ([] as any[]), rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO settings')) {
      const [key, value, updated_by = 'SYSTEM'] = params;
      const existing = state.settings.find((s) => s.key === key);
      if (!existing) state.settings.push({ key, value, updated_by, updated_at: new Date() });
      else {
        existing.value = value;
        existing.updated_by = updated_by;
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT s.token_hash, s.employee_id')) {
      const ses = state.sessions.find((s) => s.token_hash === params[0]);
      if (!ses) return { rows: [], rowCount: 0 };
      const emp = state.employees.find((e) => e.id === ses.employee_id);
      if (!emp) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...ses,
          emp_id: emp.id,
          name: emp.name,
          emp_username: emp.username,
          phone: emp.phone,
          email: emp.email,
          job_title: emp.job_title,
          emp_role: emp.role,
          permissions: emp.permissions,
          emp_status: emp.status,
          last_activity: emp.last_activity,
          created_at: emp.created_at,
          updated_at: emp.updated_at
        }] as any[],
        rowCount: 1
      };
    }

    if (sql.startsWith('SELECT * FROM reservations WHERE reservation_number = ANY')) {
      const nums: string[] = params[0] || [];
      const ids: string[] = params[1] || [];
      const rows = state.reservations.filter(
        (r) => nums.includes(r.reservation_number) || nums.includes(r.source_reservation_id) || ids.includes(r.id)
      );
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT id, reservation_number, source_reservation_id FROM reservations')) {
      const ids: string[] = params[0] || [];
      const refs: string[] = params[1] || [];
      const rows = state.reservations
        .filter((r) => ids.includes(r.id) || refs.includes(r.reservation_number) || refs.includes(r.source_reservation_id))
        .map((r) => ({ id: r.id, reservation_number: r.reservation_number, source_reservation_id: r.source_reservation_id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT reservation_number, source_reservation_id FROM reservations')) {
      const nums: string[] = Array.isArray(params[0]) ? params[0] : [];
      const srcIds: string[] = Array.isArray(params[1]) ? params[1] : [];
      const rows = state.reservations
        .filter((r) => nums.includes(r.reservation_number) || srcIds.includes(r.source_reservation_id) || srcIds.includes(r.reservation_number))
        .map((r) => ({ reservation_number: r.reservation_number, source_reservation_id: r.source_reservation_id }));
      return { rows: rows as any[], rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS cnt FROM reservations')) {
      return { rows: [{ cnt: state.reservations.length }] as any[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO reservations (')) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [];
      const outRows: Array<{ inserted: boolean }> = [];
      for (let i = 0; i < ids.length; i++) {
        const rec: Record<string, any> = {
          id: params[0][i],
          source_reservation_id: params[1][i],
          reservation_number: params[2][i],
          source_created_at: params[3][i],
          customer_name: params[4][i],
          customer_phone: params[5][i],
          customer_email: params[6][i],
          customer_id_number: params[7][i],
          company_name: params[8][i],
          branch_name: params[9][i],
          deliver_branch_name: params[10][i],
          car_name: params[11][i],
          plate_number: params[12][i],
          car_category: params[13][i],
          start_date: params[14][i],
          start_time: params[15][i],
          original_end_date: params[16][i],
          original_end_time: params[17][i],
          end_date: params[18][i],
          end_time: params[19][i],
          extended_until_date: params[20][i],
          extended_until_time: params[21][i],
          days_count: params[22][i],
          extended_days_count: params[23][i],
          total_days_count: params[24][i],
          original_status_code: params[25][i],
          original_status_ar: params[26][i],
          pickup_type_ar: params[27][i],
          return_type_ar: params[28][i],
          payment_method: params[29][i],
          payment_status: params[30][i],
          daily_price: params[31][i],
          discount_amount: params[32][i],
          vat_amount: params[33][i],
          base_amount: params[34][i],
          extensions_count: params[35][i],
          extensions_amount: params[36][i],
          total_amount: params[37][i],
          has_extensions: params[38][i],
          internal_status: params[39][i],
          priority: params[40][i],
          assigned_employee_ids: JSON.parse(params[41][i]),
          assigned_employee_names: JSON.parse(params[42][i]),
          last_update_text: params[43][i],
          last_updated_by_id: params[44][i],
          last_updated_by_name: params[45][i],
          last_updated_at: params[46][i],
          has_problem: params[47][i],
          created_at: new Date(params[48][i]),
          updated_at: new Date(params[49][i]),
          status_history: JSON.parse(params[50][i]),
          raw_json: params[51][i],
          source_order: Array.isArray(params[52]) ? (params[52][i] ?? null) : null,
          company_number: Array.isArray(params[53]) ? (params[53][i] ?? '') : '',
          new_company_name: Array.isArray(params[54]) ? (params[54][i] ?? '') : '',
          rejection_reason: Array.isArray(params[55]) ? (params[55][i] ?? '') : '',
          car_status_at_request: Array.isArray(params[56]) ? (params[56][i] ?? '') : '',
          refund_amount: Array.isArray(params[57]) ? (params[57][i] ?? 0) : 0,
          rejected_by_id: Array.isArray(params[58]) ? (params[58][i] ?? '') : '',
          rejected_by_name: Array.isArray(params[59]) ? (params[59][i] ?? '') : '',
          rejected_at: Array.isArray(params[60]) ? (params[60][i] ?? '') : '',
          cancellation_reason: Array.isArray(params[61]) ? (params[61][i] ?? '') : '',
          cancelled_by_id: Array.isArray(params[62]) ? (params[62][i] ?? '') : '',
          cancelled_by_name: Array.isArray(params[63]) ? (params[63][i] ?? '') : '',
          cancelled_at: Array.isArray(params[64]) ? (params[64][i] ?? '') : '',
          reference_number: Array.isArray(params[65]) ? (params[65][i] ?? '') : '',
          paid_amount: Array.isArray(params[66]) ? (params[66][i] ?? 0) : 0,
          delivery_failure_reason: Array.isArray(params[67]) ? (params[67][i] ?? '') : '',
          driver_notes: Array.isArray(params[68]) ? (params[68][i] ?? '') : '',
          is_source_cancelled: Array.isArray(params[69]) ? (params[69][i] ?? null) : null,
          is_source_rejected: Array.isArray(params[70]) ? (params[70][i] ?? null) : null,
          rcc_status: Array.isArray(params[71]) ? (params[71][i] ?? '') : '',
          rcc_reason: Array.isArray(params[72]) ? (params[72][i] ?? '') : '',
          cancelled_from_decline: Array.isArray(params[73]) ? Boolean(params[73][i]) : false,
          cancelled_from_hold: Array.isArray(params[74]) ? Boolean(params[74][i]) : false,
          penalty_amount: Array.isArray(params[75]) ? (params[75][i] ?? 0) : 0
        };
        if (opts.injectUpsertFailFor && opts.injectUpsertFailFor(rec)) {
          throw new Error(`MOCK_DB_CONSTRAINT_FAIL_${rec.source_reservation_id || rec.reservation_number}`);
        }
        const idx = state.reservations.findIndex((r) => r.reservation_number === rec.reservation_number);
        if (idx === -1) {
          state.reservations.push(rec);
          outRows.push({ inserted: true });
        } else {
          const prev = state.reservations[idx];
          state.reservations[idx] = { ...rec, id: prev.id, created_at: prev.created_at };
          outRows.push({ inserted: false });
        }
      }
      return { rows: outRows as any[], rowCount: outRows.length };
    }

    if (sql.startsWith('INSERT INTO sync_log')) {
      state.sync_log.unshift({
        id: params[0],
        triggered_by_id: params[1],
        triggered_by_name: params[2],
        status: params[3] || 'success',
        imported_count: params[4],
        updated_count: params[5],
        extensions_count: params[6],
        pages_fetched: params[7],
        error_message: params[8] || '',
        duration_ms: params[9],
        started_at: new Date(params[10]),
        finished_at: new Date(params[11])
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM sync_log ORDER BY')) {
      return { rows: state.sync_log as any[], rowCount: state.sync_log.length };
    }

    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      state.sync_checkpoints = [{
        source: params[0],
        last_successful_at: params[2] || null,
        last_status: params[5] || 'success',
        last_batch_count: params[4] ?? params[3],
        last_error: params[6] || '',
        meta: params[7] ? (typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7]) : {},
        updated_at: new Date()
      }];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM sync_checkpoints')) {
      return { rows: state.sync_checkpoints as any[], rowCount: state.sync_checkpoints.length };
    }

    if (sql.startsWith('INSERT INTO notifications')) {
      state.notifications.push({ id: params[0], message: params[5] });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sheets_mirror_outbox')) {
      state.sheets_mirror_outbox.push({ id: params[0], action: params[3] });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    state,
    query: runQuery,
    async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return fn({ query: runQuery });
    }
  };
}

function makeFakeResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  } as any;
}

test('extractRentalGatePagePayload recognizes diverse page/offset/cursor/totalItems/server-capped formats accurately', () => {
  // 1) totalItems & size capped by server to 25 (when client requested 100)
  const capRes = extractRentalGatePagePayload(
    {
      data: Array.from({ length: 25 }, (_, i) => ({ reservationId: 100 + i })),
      totalItems: 459,
      size: 25,
      pageNumber: 0
    },
    0,
    100
  );
  assert.equal(capRes.rows.length, 25);
  assert.equal(capRes.totalElements, 459);
  assert.equal(capRes.totalPages, 19);
  assert.equal(capRes.isLast, false);

  // 2) Cursor-based payload
  const cursorRes = extractRentalGatePagePayload(
    {
      items: [{ reservationId: 1 }, { reservationId: 2 }],
      nextCursor: 'cur_page_2',
      total_items: 120
    },
    0,
    50
  );
  assert.equal(cursorRes.nextCursor, 'cur_page_2');
  assert.equal(cursorRes.totalElements, 120);
  assert.equal(cursorRes.isLast, false);

  // 3) Offset-based payload at last page
  const offsetLast = extractRentalGatePagePayload(
    {
      rows: Array.from({ length: 9 }, (_, i) => ({ reservationId: 450 + i })),
      offset: 450,
      limit: 50,
      count: 459
    },
    9,
    50
  );
  assert.equal(offsetLast.totalElements, 459);
  assert.equal(offsetLast.isLast, true);
});

test('Full 459-reservation pull across 1-based clamped endpoints, cancelled, rejected, nested backfill, and colliding numbers syncs 459/459 idempotently', async () => {
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'test-rg-token-459';
  const db = createSyncMockDb();

  // Construct 459 unique source reservations:
  // - 360 in /reservations/filter (including colliding display numbers 9001 & 9002, accepted, rejected, cancelled)
  // - 55 cancelled in /admin/cancelled-reservations missing from main /filter (requiring /reservations/{id} backfill wrapped in { data: { reservation } })
  // - 44 rejected/reassigned in /reservation-company-changes/admin/filter missing from main /filter (requiring /reservations/{id} backfill)
  const mainList: any[] = [];
  for (let i = 1; i <= 360; i++) {
    const srcId = 10000 + i;
    // Deliberate display number collision between i=10 and i=11
    const resNum = (i === 10 || i === 11) ? 'RG-COLLIDE-500' : `RG-MAIN-${srcId}`;
    const st = i <= 300 ? 'CONFIRMED' : (i <= 330 ? 'REJECTED' : 'CANCELLED');
    mainList.push({
      reservationId: srcId,
      reservationNumber: resNum,
      clientName: `عميل ${i}`,
      clientMobile: `05000${String(i).padStart(5, '0')}`,
      companyArName: 'ذيب لتأجير السيارات',
      carNameAr: 'تويوتا كامري',
      startDate: '2026-11-01T10:00:00',
      endDate: '2026-11-05T10:00:00',
      reservationDays: 4,
      reservationStatus: st,
      total: 400
    });
  }

  const cancelledList: any[] = [];
  const rccList: any[] = [];
  for (const mItem of mainList) {
    if (mItem.reservationStatus === 'CANCELLED') {
      cancelledList.push({
        reservationId: mItem.reservationId,
        reservationNumber: mItem.reservationNumber,
        cancelledFromDecline: false,
        cancellationReasonArabic: 'إلغاء من العميل'
      });
    } else if (mItem.reservationStatus === 'REJECTED') {
      rccList.push({
        reservationId: mItem.reservationId,
        reservationNumber: mItem.reservationNumber,
        status: 'REFUND_PROCESSED',
        reason: 'REJECTED_BY_COMPANY'
      });
    }
  }

  const detailMap = new Map<string, any>();
  for (let c = 1; c <= 55; c++) {
    const srcId = String(20000 + c);
    cancelledList.push({
      reservation_id: srcId,
      cancellationReason: `إلغاء عميل ${c}`,
      cancelledAt: '2026-11-02T12:00:00Z'
    });
    detailMap.set(srcId, {
      data: {
        reservation: {
          id: Number(srcId),
          reservationNumber: `RG-CAN-${srcId}`,
          client: { name: `عميل ملغي ${c}`, mobile: `05100${String(c).padStart(5, '0')}` },
          company: { arabicName: 'بدجت السعودية' },
          car: { carNameAr: 'هيونداي إلنترا' },
          startDate: '2026-11-03T10:00:00',
          endDate: '2026-11-06T10:00:00',
          reservationStatus: 'CANCELLED',
          total: 300
        }
      }
    });
  }

  for (let r = 1; r <= 44; r++) {
    const srcId = String(30000 + r);
    rccList.push({
      reservationId: Number(srcId),
      status: 'COMPANY_CHANGED',
      reason: `رفض وتحويل ${r}`,
      newCompanyName: 'شركة أخرى'
    });
    detailMap.set(srcId, {
      reservation: {
        reservationId: Number(srcId),
        reservationNumber: `RG-REJ-${srcId}`,
        clientName: `عميل مرفوض ${r}`,
        clientMobile: `05200${String(r).padStart(5, '0')}`,
        companyArName: 'يلو',
        carNameAr: 'كيا K5',
        startDate: '2026-11-04T10:00:00',
        endDate: '2026-11-07T10:00:00',
        reservationStatus: 'REJECTED',
        total: 350
      }
    });
  }

  // Mock fetch with 1-based clamping on /reservations/filter (?page=0 returns page 1, ?page=1 ALSO returns page 1!)
  const mockFetch = (async (input: string) => {
    const url = String(input);
    const u = new URL(url);
    if (u.pathname.endsWith('/reservations/filter')) {
      const pageRaw = Number(u.searchParams.get('page') || 0);
      const size = Number(u.searchParams.get('size') || 100);
      const oneBasedPage = Math.max(1, pageRaw === 0 ? 1 : pageRaw);
      const start = (oneBasedPage - 1) * size;
      const slice = mainList.slice(start, start + size);
      return makeFakeResponse({
        content: slice,
        totalElements: mainList.length,
        totalPages: Math.ceil(mainList.length / size),
        current_page: oneBasedPage
      });
    }
    if (u.pathname.endsWith('/reservation-extends/filter')) {
      return makeFakeResponse({ content: [], totalElements: 0, totalPages: 1 });
    }
    if (u.pathname.endsWith('/admin/cancelled-reservations')) {
      const pageRaw = Number(u.searchParams.get('page') || 0);
      const size = Number(u.searchParams.get('size') || 100);
      const slice = mainList.length > 0 ? cancelledList.slice(pageRaw * size, (pageRaw + 1) * size) : [];
      return makeFakeResponse({ content: slice, totalElements: cancelledList.length, totalPages: 1 });
    }
    if (u.pathname.endsWith('/reservation-company-changes/admin/filter')) {
      const pageRaw = Number(u.searchParams.get('page') || 0);
      const size = Number(u.searchParams.get('size') || 100);
      const slice = rccList.slice(pageRaw * size, (pageRaw + 1) * size);
      return makeFakeResponse({ content: slice, totalElements: rccList.length, totalPages: 1 });
    }
    const detMatch = u.pathname.match(/\/reservations\/([^/]+)$/);
    if (detMatch) {
      const sid = decodeURIComponent(detMatch[1]);
      if (detailMap.has(sid)) return makeFakeResponse(detailMap.get(sid));
      return makeFakeResponse({ message: 'Not found' }, 404);
    }
    return makeFakeResponse({ message: 'Unknown' }, 404);
  }) as any;

  try {
    const actor = { id: 'GM_1', name: 'المدير العام', role: 'general_manager' };
    const res1 = await pullFromRentalGateDirect(db, actor, {}, mockFetch);

    assert.equal(res1.status, 'success');
    assert.equal(res1.syncComplete, true);
    assert.equal(res1.importedCount, 459);
    assert.equal(res1.dbTotalReservations, 459);
    assert.equal(db.state.reservations.length, 459);
    assert.equal(res1.missingLocalCount, 0);
    assert.equal(res1.failedCount, 0);
    assert.equal(res1.unfetchedSourceGap, 0);

    // Ensure colliding RG-COLLIDE-500 rows were BOTH kept cleanly
    const collided = db.state.reservations.filter((r) => r.reservation_number.startsWith('RG-COLLIDE-500'));
    assert.equal(collided.length, 2);

    // Ensure cancelled and rejected totals include backfilled bookings
    const cancelledSaved = db.state.reservations.filter((r) => r.is_source_cancelled === true);
    const rejectedSaved = db.state.reservations.filter((r) => r.is_source_rejected === true);
    assert.equal(cancelledSaved.length, 30 + 55);
    assert.equal(rejectedSaved.length, 30 + 44);

    // Second pull must remain idempotent: still 459 rows, 0 duplicates
    const res2 = await pullFromRentalGateDirect(db, actor, {}, mockFetch);
    assert.equal(res2.syncComplete, true);
    assert.equal(res2.importedCount, 0);
    assert.equal(res2.updatedCount, 459);
    assert.equal(db.state.reservations.length, 459);
    assert.equal(res2.dbTotalReservations, 459);
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('459 vs 448 (11 missing): detects exact 11 missing source IDs on DB upsert failure & API backfill failure, prevents false success, and recovers via retryFailedSyncRecords', async () => {
  const prevRgToken = process.env.RG_TOKEN;
  process.env.RG_TOKEN = 'test-rg-token-448';

  const missingIdsExpected = Array.from({ length: 11 }, (_, idx) => String(50449 + idx));
  let shouldFailMissing11 = true;

  const db = createSyncMockDb({
    injectUpsertFailFor: (rec) => shouldFailMissing11 && missingIdsExpected.includes(String(rec.source_reservation_id || ''))
  });

  // Seed GM user & session so we can also verify end-to-end router action 'retryFailedSyncRecords'
  const gmPass = hashPassword('Admin@123', 'SALT_GM');
  db.state.employees.push({
    id: 'EMP_GM',
    name: 'المدير العام',
    username: 'admin',
    password_hash: gmPass,
    salt: 'SALT_GM',
    phone: '0500000001',
    email: 'gm@example.com',
    job_title: 'General Manager',
    role: 'general_manager',
    permissions: ['pull_reservations', 'sync_data'],
    status: 'active',
    last_activity: new Date().toISOString(),
    created_at: new Date(),
    updated_at: new Date()
  });
  const sessionToken = 'TOK_RETRY_TEST';
  db.state.sessions.push({
    token_hash: hashToken(sessionToken),
    employee_id: 'EMP_GM',
    username: 'admin',
    role: 'general_manager',
    expires_at: new Date(Date.now() + 3600_000),
    created_at: new Date(),
    last_seen_at: new Date(),
    is_revoked: false
  });

  const all459: any[] = Array.from({ length: 459 }, (_, idx) => {
    const srcId = 50001 + idx;
    return {
      reservationId: srcId,
      reservationNumber: `RG-459-${srcId}`,
      clientName: `عميل ${srcId}`,
      clientMobile: `055${String(idx).padStart(7, '0')}`,
      companyArName: 'شركة الاختبار',
      carNameAr: 'سيارة اختبار',
      startDate: '2026-11-10T10:00:00',
      endDate: '2026-11-12T10:00:00',
      reservationDays: 2,
      reservationStatus: idx < 30 ? 'CANCELLED' : (idx < 60 ? 'REJECTED' : 'CONFIRMED'),
      total: 250
    };
  });

  const byIdMap = new Map(all459.map((item) => [String(item.reservationId), item]));

  const mockFetch = (async (input: string) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/reservations/filter')) {
      const page = Number(u.searchParams.get('page') || 0);
      const size = Number(u.searchParams.get('size') || 100);
      const slice = all459.slice(page * size, (page + 1) * size);
      return makeFakeResponse({
        content: slice,
        totalElements: 459,
        totalPages: Math.ceil(459 / size)
      });
    }
    if (
      u.pathname.endsWith('/reservation-extends/filter') ||
      u.pathname.endsWith('/admin/cancelled-reservations') ||
      u.pathname.endsWith('/reservation-company-changes/admin/filter')
    ) {
      return makeFakeResponse({ content: [], totalElements: 0, totalPages: 1 });
    }
    const detMatch = u.pathname.match(/\/reservations\/([^/]+)$/);
    if (detMatch) {
      const sid = decodeURIComponent(detMatch[1]);
      if (byIdMap.has(sid)) return makeFakeResponse({ data: { reservation: byIdMap.get(sid) } });
      return makeFakeResponse({ message: 'Not found' }, 404);
    }
    return makeFakeResponse({}, 404);
  }) as any;

  try {
    // Pass 1: 448 succeed, 11 fail single-row upsert -> must report 448 vs 459, exact 11 missing IDs, and partial status
    const firstPull = await pullFromRentalGateDirect(db, { id: 'EMP_GM', name: 'المدير العام', role: 'general_manager' }, {}, mockFetch);
    assert.equal(firstPull.status, 'partial');
    assert.equal(firstPull.syncComplete, false);
    assert.equal(firstPull.importedCount, 448);
    assert.equal(firstPull.dbTotalReservations, 448);
    assert.equal(db.state.reservations.length, 448);
    assert.equal(firstPull.failedCount, 11);
    assert.equal(firstPull.missingLocalCount, 11);
    assert.deepEqual(firstPull.missingSourceIds?.slice().sort(), missingIdsExpected.slice().sort());
    assert.equal(firstPull.failedRecords?.length, 11);
    assert.equal(firstPull.failedRecords?.[0].stage, 'upsert');
    assert.ok(firstPull.failedRecords?.[0].reason.includes('MOCK_DB_CONSTRAINT_FAIL_'));

    // Also verify sync_checkpoints stores reconciliation & missing IDs
    assert.equal(db.state.sync_checkpoints[0]?.last_status, 'partial');
    assert.equal(db.state.sync_checkpoints[0]?.meta?.dbTotalReservations, 448);
    assert.equal(db.state.sync_checkpoints[0]?.meta?.missingLocalCount, 11);
    assert.deepEqual(db.state.sync_checkpoints[0]?.meta?.missingSourceIds?.slice().sort(), missingIdsExpected.slice().sort());

    // Now fix transient DB condition and retry only the missing 11 via retryFailedSyncRecords
    shouldFailMissing11 = false;
    const retryRes = await retryFailedSyncRecords(db, { id: 'EMP_GM', name: 'المدير العام', role: 'general_manager' }, {}, mockFetch);
    assert.equal(retryRes.status, 'success');
    assert.equal(retryRes.syncComplete, true);
    assert.equal(retryRes.importedCount, 11);
    assert.equal(retryRes.updatedCount, 0);
    assert.equal(retryRes.dbTotalReservations, 459);
    assert.equal(db.state.reservations.length, 459);
    assert.equal(retryRes.missingLocalCount, 0);
    assert.equal(retryRes.failedCount, 0);

    // Verify getSyncStatus via dispatchCrmRequest reflects the recovered reconciliation
    const statusResp = await dispatchCrmRequest(db, {
      action: 'getSyncStatus',
      token: sessionToken,
      payload: {}
    });
    assert.equal(statusResp.success, true);
    assert.equal(statusResp.data.lastReconciliation?.syncComplete, true);
    assert.equal(statusResp.data.lastReconciliation?.dbTotalReservations, 459);
    assert.equal(statusResp.data.lastReconciliation?.missingLocalCount, 0);

    // Scenario B: Simulated endpoint truncation (API declares totalElements=459 but returns only 448 rows)
    const truncatedDb = createSyncMockDb();
    const truncatedFetch = (async (input: string) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith('/reservations/filter')) {
        const page = Number(u.searchParams.get('page') || 0);
        const size = Number(u.searchParams.get('size') || 100);
        const truncated = all459.slice(0, 448);
        const slice = truncated.slice(page * size, (page + 1) * size);
        return makeFakeResponse({ content: slice, totalElements: 459, totalPages: 5 });
      }
      return makeFakeResponse({ content: [], totalElements: 0, totalPages: 1 });
    }) as any;

    const truncRes = await pullFromRentalGateDirect(truncatedDb, { id: 'EMP_GM', name: 'المدير العام', role: 'general_manager' }, {}, truncatedFetch);
    assert.equal(truncRes.status, 'partial');
    assert.equal(truncRes.syncComplete, false);
    assert.equal(truncRes.dbTotalReservations, 448);
    assert.equal(truncRes.unfetchedSourceGap, 11);
    assert.ok((truncRes.incompleteEndpoints || []).some((ep) => ep.includes('reservations/filter')));
  } finally {
    if (prevRgToken === undefined) delete process.env.RG_TOKEN;
    else process.env.RG_TOKEN = prevRgToken;
  }
});

test('dedupeReservationsByNumber & DB upsert protect distinct sourceReservationId records sharing a reservationNumber and distinct phone records', async () => {
  // 1) Core dedupeReservationsByNumber keeps distinct phones when one lacks sourceReservationId
  const deduped = crmCore.dedupeReservationsByNumber([
    {
      id: 'R1',
      reservationNumber: 'RG-777',
      customerPhone: '0501111111',
      customerName: 'أحمد'
    },
    {
      id: 'R2',
      reservationNumber: 'RG-777',
      sourceReservationId: '99882',
      customerPhone: '0552222222',
      customerName: 'سعد',
      isSourceCancelled: true
    }
  ]);
  assert.equal(deduped.length, 2);

  // 2) Pre-existing DB row 9001 with RG-SHARED-100 must NOT be overwritten when distinct 9002 with RG-SHARED-100 arrives
  const db = createSyncMockDb();
  await ingestIncrementalSyncBatch(db, {
    source: 'rental_gate_direct',
    reservations: [
      {
        reservationId: 9001,
        reservationNumber: 'RG-SHARED-100',
        clientName: 'العميل الأول',
        clientMobile: '0501000001',
        reservationStatus: 'CONFIRMED',
        total: 500
      }
    ]
  });
  assert.equal(db.state.reservations.length, 1);

  const secondBatch = await ingestIncrementalSyncBatch(db, {
    source: 'rental_gate_direct',
    reservations: [
      {
        reservationId: 9002,
        reservationNumber: 'RG-SHARED-100',
        clientName: 'العميل الثاني',
        clientMobile: '0502000002',
        reservationStatus: 'CANCELLED',
        total: 600
      }
    ]
  });

  assert.equal(secondBatch.syncComplete, true);
  assert.equal(secondBatch.dbTotalReservations, 2);
  assert.equal(db.state.reservations.length, 2);
  assert.ok(db.state.reservations.some((r) => String(r.source_reservation_id) === '9001' && r.customer_name === 'العميل الأول'));
  assert.ok(db.state.reservations.some((r) => String(r.source_reservation_id) === '9002' && r.customer_name === 'العميل الثاني'));
});
