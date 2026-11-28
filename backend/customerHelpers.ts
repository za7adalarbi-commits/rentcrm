import crypto from 'node:crypto';
import type { DbClient, DbExecutor } from './db.js';
import crmCoreModule from './coreBridge.cjs';

const crmCore: any = (crmCoreModule as any)?.default || crmCoreModule;

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

export function deterministicCustomerId(customerKey: string): string {
  const digest = crypto.createHash('sha1').update(str(customerKey) || String(Date.now())).digest('hex').slice(0, 16).toUpperCase();
  return `CUS_${digest}`;
}

export function extractCustomerDraftFromReservation(row: Record<string, any>) {
  const fullName = str(row.customerName ?? row.customer_name) || 'عميل';
  const phone = str(row.customerPhone ?? row.customer_phone);
  const email = str(row.customerEmail ?? row.customer_email);
  const idNumber = str(row.customerIdNumber ?? row.customer_id_number);
  const reservationNumber = str(row.reservationNumber ?? row.reservation_number);
  const reservationId = str(row.id);

  const phoneMeta = typeof crmCore.extractPhoneCountryCode === 'function'
    ? crmCore.extractPhoneCountryCode(phone)
    : { countryCode: '', nationalPhone: phone.replace(/\D/g, ''), normalizedPhone: phone.replace(/\D/g, '') };

  const idType = typeof crmCore.detectCustomerIdType === 'function'
    ? crmCore.detectCustomerIdType(idNumber)
    : '';

  const customerKey = typeof crmCore.buildCustomerCanonicalKey === 'function'
    ? crmCore.buildCustomerCanonicalKey({ phone, email, idNumber, name: fullName, reservationNumber })
    : (phoneMeta.normalizedPhone ? `PH:${phoneMeta.normalizedPhone}` : `RES:${reservationNumber || reservationId}`);

  const lastActivity = str(row.lastUpdatedAt ?? row.last_updated_at ?? row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at) || new Date().toISOString();

  return {
    id: deterministicCustomerId(customerKey),
    customerKey,
    fullName,
    phone,
    countryCode: str(phoneMeta.countryCode),
    normalizedPhone: str(phoneMeta.normalizedPhone),
    email,
    idNumber,
    idType,
    reservationId,
    reservationNumber,
    lastActivity,
    isActiveBooking: typeof crmCore.isInactiveReservation === 'function'
      ? !crmCore.isInactiveReservation(row)
      : true,
    hasExtensions: Number(row.extensionsCount ?? row.extensions_count ?? 0) > 0 || Boolean(row.hasExtensions ?? row.has_extensions),
    hasProblem: Boolean(row.hasProblem ?? row.has_problem),
    isFollowed: Boolean(row.isFollowed ?? row.is_followed)
  };
}

async function trySp(tx: DbClient, name: string): Promise<void> {
  try { await tx.query(`SAVEPOINT ${name}`); } catch {}
}

async function tryRel(tx: DbClient, name: string): Promise<void> {
  try { await tx.query(`RELEASE SAVEPOINT ${name}`); } catch {}
}

async function tryRb(tx: DbClient, name: string): Promise<void> {
  try { await tx.query(`ROLLBACK TO SAVEPOINT ${name}`); } catch {}
}

export async function upsertCustomersFromReservationsTx(
  tx: DbClient,
  resRows: Array<Record<string, any>>,
  opts: { source?: string; overwriteProfileFields?: boolean } = {}
): Promise<Map<string, string>> {
  const keyToCustomerId = new Map<string, string>();
  if (!Array.isArray(resRows) || resRows.length === 0) return keyToCustomerId;

  const grouped = new Map<string, ReturnType<typeof extractCustomerDraftFromReservation> & {
    activeCount: number;
    pastCount: number;
    extCount: number;
    probCount: number;
    followedCount: number;
    reservationIds: string[];
  }>();

  for (const r of resRows) {
    const draft = extractCustomerDraftFromReservation(r);
    if (!draft.customerKey) continue;
    let entry = grouped.get(draft.customerKey);
    if (!entry) {
      entry = {
        ...draft,
        activeCount: 0,
        pastCount: 0,
        extCount: 0,
        probCount: 0,
        followedCount: 0,
        reservationIds: []
      };
      grouped.set(draft.customerKey, entry);
    } else {
      if ((entry.fullName === 'عميل' || entry.fullName.length < draft.fullName.length) && draft.fullName !== 'عميل') {
        entry.fullName = draft.fullName;
      }
      if (!entry.phone && draft.phone) {
        entry.phone = draft.phone;
        entry.countryCode = draft.countryCode;
        entry.normalizedPhone = draft.normalizedPhone;
      }
      if (!entry.email && draft.email) entry.email = draft.email;
      if (!entry.idNumber && draft.idNumber) {
        entry.idNumber = draft.idNumber;
        entry.idType = draft.idType;
      }
      if (draft.lastActivity > entry.lastActivity) entry.lastActivity = draft.lastActivity;
    }
    if (draft.isActiveBooking) entry.activeCount++;
    else entry.pastCount++;
    if (draft.hasExtensions) entry.extCount++;
    if (draft.hasProblem) entry.probCount++;
    if (draft.isFollowed) entry.followedCount++;
    if (draft.reservationId) entry.reservationIds.push(draft.reservationId);
  }

  const drafts = Array.from(grouped.values());
  if (drafts.length === 0) return keyToCustomerId;

  await trySp(tx, 'rg_cust_batch_sp');
  try {
    const keys = drafts.map((d) => d.customerKey);
    const existingRes = await tx.query<{ id: string; customer_key: string }>(
      `SELECT id, customer_key FROM customers WHERE customer_key = ANY($1::text[])`,
      [keys]
    );
    const existingIdByKey = new Map<string, string>();
    for (const row of existingRes.rows || []) {
      const k = str(row.customer_key);
      const id = str(row.id);
      if (k && id) existingIdByKey.set(k, id);
    }

    for (const d of drafts) {
      const targetId = existingIdByKey.get(d.customerKey) || d.id;
      d.id = targetId;
      keyToCustomerId.set(d.customerKey, targetId);
    }

    const nowIso = new Date().toISOString();
    const sourceLabel = str(opts.source || 'sync') || 'sync';
    const overwrite = Boolean(opts.overwriteProfileFields);

    const computeRowStatus = (d: typeof drafts[number]) =>
      typeof crmCore.computeCustomerLifecycleStatus === 'function'
        ? crmCore.computeCustomerLifecycleStatus({
            totalBookings: d.activeCount + d.pastCount,
            activeBookingsCount: d.activeCount,
            pastBookingsCount: d.pastCount,
            openProblemsCount: d.probCount,
            inProgressComplaintsCount: 0,
            unfollowedActiveCount: Math.max(0, d.activeCount - d.followedCount),
            isNewRecent: (d.activeCount + d.pastCount) <= 1 && d.pastCount === 0 ? 1 : 0
          })
        : (d.activeCount > 0 ? 'نشط' : 'جديد');

    const upsertSql = `INSERT INTO customers (
         id, customer_key, full_name, phone, country_code, normalized_phone,
         email, id_number, id_type, status, source, created_at, updated_at
       )
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
         $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::timestamptz[], $13::timestamptz[]
       )
       ON CONFLICT (customer_key) DO UPDATE SET
         full_name = CASE
           WHEN $14::boolean THEN COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name)
           WHEN customers.full_name IN ('', 'عميل') AND EXCLUDED.full_name NOT IN ('', 'عميل') THEN EXCLUDED.full_name
           ELSE customers.full_name
         END,
         phone = COALESCE(NULLIF(customers.phone, ''), EXCLUDED.phone),
         country_code = COALESCE(NULLIF(customers.country_code, ''), EXCLUDED.country_code),
         normalized_phone = COALESCE(NULLIF(customers.normalized_phone, ''), EXCLUDED.normalized_phone),
         email = CASE
           WHEN $14::boolean AND EXCLUDED.email <> '' THEN EXCLUDED.email
           ELSE COALESCE(NULLIF(customers.email, ''), EXCLUDED.email)
         END,
         id_number = CASE
           WHEN $14::boolean AND EXCLUDED.id_number <> '' THEN EXCLUDED.id_number
           ELSE COALESCE(NULLIF(customers.id_number, ''), EXCLUDED.id_number)
         END,
         id_type = CASE
           WHEN $14::boolean AND EXCLUDED.id_type <> '' THEN EXCLUDED.id_type
           ELSE COALESCE(NULLIF(customers.id_type, ''), EXCLUDED.id_type)
         END,
         status = CASE
           WHEN customers.status_override = TRUE THEN customers.status
           WHEN customers.status = 'محظور' THEN customers.status
           ELSE EXCLUDED.status
         END,
         updated_at = GREATEST(customers.updated_at, EXCLUDED.updated_at)`;

    const chunkSize = 200;
    for (let i = 0; i < drafts.length; i += chunkSize) {
      const chunk = drafts.slice(i, i + chunkSize);
      const statuses = chunk.map(computeRowStatus);

      await trySp(tx, 'rg_cust_chunk_sp');
      try {
        await tx.query(upsertSql, [
          chunk.map((d) => d.id),
          chunk.map((d) => d.customerKey),
          chunk.map((d) => d.fullName),
          chunk.map((d) => d.phone),
          chunk.map((d) => d.countryCode),
          chunk.map((d) => d.normalizedPhone),
          chunk.map((d) => d.email),
          chunk.map((d) => d.idNumber),
          chunk.map((d) => d.idType),
          statuses,
          chunk.map(() => sourceLabel),
          chunk.map(() => nowIso),
          chunk.map(() => nowIso),
          overwrite
        ]);
        await tryRel(tx, 'rg_cust_chunk_sp');
      } catch (chunkErr: any) {
        await tryRb(tx, 'rg_cust_chunk_sp');
        console.warn('Customer chunk upsert fallback to per-row savepoints:', String(chunkErr?.message || chunkErr).slice(0, 180));
        for (let ri = 0; ri < chunk.length; ri++) {
          const d = chunk[ri];
          const st = statuses[ri];
          await trySp(tx, 'rg_cust_row_sp');
          try {
            const byIdQ = await tx.query<{ id: string }>(
              `SELECT id FROM customers WHERE id = $1 OR customer_key = $2 LIMIT 1`,
              [d.id, d.customerKey]
            );
            const existingRowId = str(byIdQ?.rows?.[0]?.id);
            if (existingRowId) {
              d.id = existingRowId;
              keyToCustomerId.set(d.customerKey, existingRowId);
              await tx.query(
                `UPDATE customers
                 SET full_name = CASE
                       WHEN $2::boolean THEN COALESCE(NULLIF($3, ''), full_name)
                       WHEN full_name IN ('', 'عميل') AND $3 NOT IN ('', 'عميل') THEN $3
                       ELSE full_name
                     END,
                     phone = COALESCE(NULLIF(phone, ''), $4),
                     country_code = COALESCE(NULLIF(country_code, ''), $5),
                     normalized_phone = COALESCE(NULLIF(normalized_phone, ''), $6),
                     email = COALESCE(NULLIF(email, ''), $7),
                     id_number = COALESCE(NULLIF(id_number, ''), $8),
                     id_type = COALESCE(NULLIF(id_type, ''), $9),
                     status = CASE
                       WHEN status_override = TRUE OR status = 'محظور' THEN status
                       ELSE $10
                     END,
                     updated_at = GREATEST(updated_at, $11::timestamptz)
                 WHERE id = $1`,
                [existingRowId, overwrite, d.fullName, d.phone, d.countryCode, d.normalizedPhone, d.email, d.idNumber, d.idType, st, nowIso]
              );
            } else {
              await tx.query(upsertSql, [
                [d.id], [d.customerKey], [d.fullName], [d.phone], [d.countryCode], [d.normalizedPhone],
                [d.email], [d.idNumber], [d.idType], [st], [sourceLabel], [nowIso], [nowIso], overwrite
              ]);
            }
            await tryRel(tx, 'rg_cust_row_sp');
          } catch (rowErr: any) {
            await tryRb(tx, 'rg_cust_row_sp');
            console.warn(`Customer row upsert skipped (${d.customerKey}):`, String(rowErr?.message || rowErr).slice(0, 160));
          }
        }
      }
    }

    // Link reservations.customer_id
    const resIdsToUpdate: string[] = [];
    const custIdsForRes: string[] = [];
    for (const r of resRows) {
      const rid = str(r.id);
      if (!rid) continue;
      const draft = extractCustomerDraftFromReservation(r);
      const cid = keyToCustomerId.get(draft.customerKey);
      if (cid) {
        resIdsToUpdate.push(rid);
        custIdsForRes.push(cid);
      }
    }
    if (resIdsToUpdate.length > 0) {
      await tx.query(
        `UPDATE reservations AS r
         SET customer_id = v.cid
         FROM unnest($1::text[], $2::text[]) AS v(rid, cid)
         WHERE r.id = v.rid
           AND r.customer_id IS DISTINCT FROM v.cid`,
        [resIdsToUpdate, custIdsForRes]
      );

      // Sync linked problems.customer_id
      await tx.query(
        `UPDATE problems AS p
         SET customer_id = r.customer_id
         FROM reservations AS r
         WHERE p.reservation_id = r.id
           AND r.customer_id <> ''
           AND COALESCE(p.customer_id, '') = ''`
      );
    }

    await tryRel(tx, 'rg_cust_batch_sp');
  } catch (err: any) {
    await tryRb(tx, 'rg_cust_batch_sp');
    console.warn('upsertCustomersFromReservationsTx aborted:', String(err?.message || err).slice(0, 200));
  }

  return keyToCustomerId;
}

export async function backfillCustomersFromReservations(
  executor: DbClient,
  opts: { maxRows?: number; batchSize?: number } = {}
): Promise<{ processed: number; error?: string }> {
  try {
    const tblCheck = await executor.query<{ reg: string | null }>(`SELECT to_regclass('public.customers') AS reg`);
    if (!tblCheck?.rows?.[0]?.reg) return { processed: 0 };

    const maxRows = Math.max(100, Math.min(20000, Number(opts.maxRows || 5000)));
    const batchSize = Math.max(50, Math.min(1000, Number(opts.batchSize || 500)));
    let totalProcessed = 0;

    const runWithClient = async (fn: (tx: DbClient) => Promise<void>) => {
      if (typeof (executor as DbExecutor).withTransaction === 'function') {
        await (executor as DbExecutor).withTransaction(fn);
      } else {
        await fn(executor);
      }
    };

    while (totalProcessed < maxRows) {
      const limitThisPass = Math.min(batchSize, maxRows - totalProcessed);
      const missingRes = await executor.query(
        `SELECT r.id, r.reservation_number, r.customer_name, r.customer_phone, r.customer_email, r.customer_id_number,
                r.original_status_code, r.original_status_ar, r.internal_status, r.is_source_cancelled, r.is_source_rejected,
                r.extensions_count, r.has_extensions, r.has_problem,
                EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.reservation_id = r.id) AS is_followed,
                r.last_updated_at, r.updated_at, r.created_at
         FROM reservations r
         WHERE r.deleted_at IS NULL
           AND (
             COALESCE(r.customer_id, '') = ''
             OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = r.customer_id)
           )
         ORDER BY r.updated_at DESC NULLS LAST, r.id ASC
         LIMIT $1`,
        [limitThisPass]
      );
      const rows = missingRes?.rows || [];
      if (rows.length === 0) break;

      await runWithClient(async (tx) => {
        await upsertCustomersFromReservationsTx(tx, rows, { source: 'backfill', overwriteProfileFields: false });
      });
      totalProcessed += rows.length;
      if (rows.length < limitThisPass) break;
    }

    return { processed: totalProcessed };
  } catch (err: any) {
    const errMsg = String(err?.message || err).slice(0, 200);
    console.warn('backfillCustomersFromReservations failed:', errMsg);
    return { processed: 0, error: errMsg };
  }
}

export function formatCustomerSummaryRow(row: Record<string, any>, user?: any): Record<string, any> {
  const tagsRaw = row.tags;
  let tags: string[] = [];
  if (Array.isArray(tagsRaw)) tags = tagsRaw.map((t) => str(t)).filter(Boolean);
  else if (typeof tagsRaw === 'string' && tagsRaw.trim().startsWith('[')) {
    try { tags = JSON.parse(tagsRaw).map((t: any) => str(t)).filter(Boolean); } catch { tags = []; }
  }

  const obj: Record<string, any> = {
    id: str(row.id),
    customerKey: str(row.customer_key ?? row.customerKey),
    fullName: str(row.full_name ?? row.fullName) || 'عميل',
    phone: str(row.phone),
    countryCode: str(row.country_code ?? row.countryCode),
    normalizedPhone: str(row.normalized_phone ?? row.normalizedPhone),
    email: str(row.email),
    idNumber: str(row.id_number ?? row.idNumber),
    idType: str(row.id_type ?? row.idType),
    status: str(row.status) || 'جديد',
    statusOverride: Boolean(row.status_override ?? row.statusOverride),
    notes: str(row.notes),
    tags,
    source: str(row.source) || 'sync',
    lastContactAt: str(row.last_contact_at ?? row.lastContactAt),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : str(row.createdAt),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : str(row.updatedAt),
    bookingsCount: Number(row.bookings_count ?? row.bookingsCount ?? 0),
    activeBookingsCount: Number(row.active_bookings_count ?? row.activeBookingsCount ?? 0),
    pastBookingsCount: Number(row.past_bookings_count ?? row.pastBookingsCount ?? 0),
    extensionsCount: Number(row.extensions_count ?? row.extensionsCount ?? 0),
    openProblemsCount: Number(row.open_problems_count ?? row.openProblemsCount ?? 0),
    openComplaintsCount: Number(row.open_complaints_count ?? row.openComplaintsCount ?? 0),
    followUpsCount: Number(row.follow_ups_count ?? row.followUpsCount ?? 0),
    notesCount: Number(row.notes_count ?? row.notesCount ?? 0),
    totalAmount: Number(row.total_amount ?? row.totalAmount ?? 0),
    paidAmount: Number(row.paid_amount ?? row.paidAmount ?? 0),
    lastReservationNumber: str(row.last_reservation_number ?? row.lastReservationNumber),
    lastReservationDate: str(row.last_reservation_date ?? row.lastReservationDate),
    lastReservationStatus: str(row.last_reservation_status ?? row.lastReservationStatus),
    lastCompanyName: str(row.last_company_name ?? row.lastCompanyName)
  };

  if (user && typeof crmCore.redactCustomerSensitiveFields === 'function') {
    return crmCore.redactCustomerSensitiveFields(obj, user);
  }
  return obj;
}
