import { crmCore, generateId, parseJsonArray } from './auth';
import type { DbClient, DbExecutor } from './db';
import { logBackendError } from './logger';
import { resolveServerConfig } from './serverConfig';

export interface SyncActor {
  id: string;
  name: string;
  role?: string;
}

export interface SyncBatchPayload {
  source?: string;
  actor?: Partial<SyncActor>;
  triggeredById?: string;
  triggeredByName?: string;
  cursor?: string;
  pagesFetched?: number;
  reservations?: any[];
  extensions?: any[];
  deletedReservationNumbers?: string[];
  appliedRange?: Record<string, any>;
}

export interface SyncIngestResult {
  syncId: string;
  status: 'success' | 'error';
  importedCount: number;
  updatedCount: number;
  extensionsCount: number;
  pagesFetched: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  checkpointAt: string;
  appliedRange?: Record<string, any>;
  changedReservations: any[];
  mutatedReservations?: any[];
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function boolVal(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export function mapReservationRowToClient(row: any, includeRaw = false): Record<string, any> {
  if (!row) return {};
  const obj: Record<string, any> = {
    id: str(row.id),
    sourceReservationId: str(row.source_reservation_id ?? row.sourceReservationId),
    reservationNumber: str(row.reservation_number ?? row.reservationNumber),
    sourceCreatedAt: str(row.source_created_at ?? row.sourceCreatedAt),
    customerName: str(row.customer_name ?? row.customerName),
    customerPhone: str(row.customer_phone ?? row.customerPhone),
    customerEmail: str(row.customer_email ?? row.customerEmail),
    customerIdNumber: str(row.customer_id_number ?? row.customerIdNumber),
    companyName: str(row.company_name ?? row.companyName),
    branchName: str(row.branch_name ?? row.branchName),
    deliverBranchName: str(row.deliver_branch_name ?? row.deliverBranchName),
    carName: str(row.car_name ?? row.carName),
    plateNumber: str(row.plate_number ?? row.plateNumber),
    carCategory: str(row.car_category ?? row.carCategory),
    startDate: str(row.start_date ?? row.startDate),
    startTime: str(row.start_time ?? row.startTime),
    originalEndDate: str(row.original_end_date ?? row.originalEndDate),
    originalEndTime: str(row.original_end_time ?? row.originalEndTime),
    endDate: str(row.end_date ?? row.endDate),
    endTime: str(row.end_time ?? row.endTime),
    extendedUntilDate: str(row.extended_until_date ?? row.extendedUntilDate),
    extendedUntilTime: str(row.extended_until_time ?? row.extendedUntilTime),
    daysCount: num(row.days_count ?? row.daysCount),
    extendedDaysCount: num(row.extended_days_count ?? row.extendedDaysCount),
    totalDaysCount: num(row.total_days_count ?? row.totalDaysCount),
    originalStatusCode: str(row.original_status_code ?? row.originalStatusCode),
    originalStatusAr: str(row.original_status_ar ?? row.originalStatusAr),
    pickupTypeAr: str(row.pickup_type_ar ?? row.pickupTypeAr),
    returnTypeAr: str(row.return_type_ar ?? row.returnTypeAr),
    paymentMethod: str(row.payment_method ?? row.paymentMethod),
    paymentStatus: str(row.payment_status ?? row.paymentStatus),
    dailyPrice: num(row.daily_price ?? row.dailyPrice),
    discountAmount: num(row.discount_amount ?? row.discountAmount),
    vatAmount: num(row.vat_amount ?? row.vatAmount),
    baseAmount: num(row.base_amount ?? row.baseAmount),
    extensionsCount: num(row.extensions_count ?? row.extensionsCount),
    extensionsAmount: num(row.extensions_amount ?? row.extensionsAmount),
    totalAmount: num(row.total_amount ?? row.totalAmount),
    hasExtensions: boolVal(row.has_extensions ?? row.hasExtensions),
    internalStatus: str(row.internal_status ?? row.internalStatus),
    priority: str(row.priority || 'عادي'),
    assignedEmployeeIds: parseJsonArray<string>(row.assigned_employee_ids ?? row.assignedEmployeeIds),
    assignedEmployeeNames: parseJsonArray<string>(row.assigned_employee_names ?? row.assignedEmployeeNames),
    lastUpdateText: str(row.last_update_text ?? row.lastUpdateText),
    lastUpdatedById: str(row.last_updated_by_id ?? row.lastUpdatedById),
    lastUpdatedByName: str(row.last_updated_by_name ?? row.lastUpdatedByName),
    lastUpdatedAt: str(row.last_updated_at ?? row.lastUpdatedAt),
    hasProblem: boolVal(row.has_problem ?? row.hasProblem),
    isFollowed: row.is_followed !== undefined ? Boolean(row.is_followed) : Boolean(row.isFollowed),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at ?? row.updatedAt),
    statusHistory: crmCore.normalizeStatusHistory(row.status_history ?? row.statusHistory ?? [])
  };
  if (includeRaw) {
    obj.rawJson = str(row.raw_json ?? row.rawJson);
  }
  return obj;
}

export function mapExtensionRowToClient(row: any): Record<string, any> {
  return {
    id: str(row.id),
    extensionNumber: str(row.extension_number ?? row.extensionNumber),
    sequenceNumber: num(row.sequence_number ?? row.sequenceNumber),
    reservationId: str(row.reservation_id ?? row.reservationId),
    reservationNumber: str(row.reservation_number ?? row.reservationNumber),
    sourceReservationId: str(row.source_reservation_id ?? row.sourceReservationId),
    extensionType: str(row.extension_type ?? row.extensionType),
    extensionTypeAr: str(row.extension_type_ar ?? row.extensionTypeAr),
    statusCode: str(row.status_code ?? row.statusCode),
    statusAr: str(row.status_ar ?? row.statusAr),
    paymentStatus: str(row.payment_status ?? row.paymentStatus),
    paymentDate: str(row.payment_date ?? row.paymentDate),
    paymentMethod: str(row.payment_method ?? row.paymentMethod),
    extendDays: num(row.extend_days ?? row.extendDays),
    startDate: str(row.start_date ?? row.startDate),
    startTime: str(row.start_time ?? row.startTime),
    endDate: str(row.end_date ?? row.endDate),
    endTime: str(row.end_time ?? row.endTime),
    subTotal: num(row.sub_total ?? row.subTotal),
    vatAmount: num(row.vat_amount ?? row.vatAmount),
    amount: num(row.amount),
    isAcceptedAndPaid: boolVal(row.is_accepted_and_paid ?? row.isAcceptedAndPaid),
    syncedAt: row.synced_at instanceof Date ? row.synced_at.toISOString() : str(row.synced_at ?? row.syncedAt)
  };
}

function normalizeIncomingExtension(raw: any, resIdLookup: Map<string, string>, nowIso: string): Record<string, any> {
  const extNum = str(raw.extensionNumber || raw.extendId || raw.id);
  const resNum = str(raw.reservationNumber || raw.reservation_number || raw.reservationId || '');
  const srcResId = str(raw.sourceReservationId || raw.reservationId || resNum);
  const matchedResId = str(
    raw.reservationId && String(raw.reservationId).startsWith('RES_')
      ? raw.reservationId
      : (resIdLookup.get(resNum) || resIdLookup.get(srcResId) || '')
  );

  const extType = str(raw.extensionType || raw.extension_type || '').toUpperCase();
  const statusCode = str(raw.statusCode || raw.reservationStatus || raw.status || '').toLowerCase();
  const startRaw = raw.startDate || raw.extendDate || raw.createdAt || '';
  const endRaw = raw.endDate || raw.extendEndDate || raw.newEndDate || raw.actualEndDate || '';

  return {
    id: str(raw.id) || (extNum ? `EXT_${extNum.replace(/[^A-Za-z0-9_-]/g, '')}` : generateId('EXT')),
    extensionNumber: extNum,
    sequenceNumber: num(raw.sequenceNumber ?? raw.seqNo, 0),
    reservationId: matchedResId,
    reservationNumber: resNum,
    sourceReservationId: srcResId,
    extensionType: extType,
    extensionTypeAr: str(raw.extensionTypeAr) || crmCore.translateExtensionType(extType),
    statusCode,
    statusAr: str(raw.statusAr) || crmCore.translateOriginalStatus(statusCode),
    paymentStatus: str(raw.paymentStatus || raw.payment_status),
    paymentDate: str(raw.paymentDate),
    paymentMethod: str(raw.paymentMethod || raw.paymentType),
    extendDays: num(raw.extendDays ?? raw.days ?? raw.extendDuration, 0),
    startDate: crmCore.formatDisplayDate(startRaw),
    startTime: str(raw.startTime) || crmCore.extractTimeOnly(startRaw),
    endDate: crmCore.formatDisplayDate(endRaw),
    endTime: str(raw.endTime) || crmCore.extractTimeOnly(endRaw),
    subTotal: num(raw.subTotal ?? raw.sub_total, 0),
    vatAmount: num(raw.vatAmount ?? raw.vat ?? raw.tax, 0),
    amount: num(raw.amount ?? raw.total ?? raw.total_amount, 0),
    isAcceptedAndPaid: raw.isAcceptedAndPaid !== undefined
      ? boolVal(raw.isAcceptedAndPaid)
      : crmCore.isExtensionAcceptedAndPaid(raw),
    syncedAt: str(raw.syncedAt) || nowIso
  };
}

function normalizeIncomingReservation(
  raw: any,
  existingClient: Record<string, any> | null,
  relatedExts: any[],
  actor: SyncActor,
  nowIso: string
): { record: Record<string, any>; followUpHistoryEntry: Record<string, any> | null } {
  const isNormalizedCrmShape = Boolean(raw.reservationNumber && raw.customerName !== undefined && raw.originalStatusCode !== undefined);
  const resNumber = str(raw.reservationNumber || raw.reservation_number || raw.reservationId || raw.id);
  const srcResId = str(raw.sourceReservationId || raw.reservationId || raw.id || resNumber);
  const resId = existingClient?.id || (str(raw.id).startsWith('RES_') ? str(raw.id) : `RES_${resNumber.replace(/[^A-Za-z0-9_-]/g, '')}`);

  const rawCode = str(raw.originalStatusCode || raw.reservationStatus || raw.status || raw.status_code).toLowerCase().replace(/\s+/g, '_');
  const translatedOrigAr = crmCore.translateOriginalStatus(rawCode);
  const sourceStatusAr = (translatedOrigAr && translatedOrigAr !== 'غير محدد')
    ? translatedOrigAr
    : (str(raw.originalStatusAr || raw.statusAr) || 'تم الإنشاء');

  // If payload comes from normalized CRM/GAS record, preserve precomputed fields cleanly;
  // if payload comes directly from Rental Gate API, compute via shared crmCore.mergeSyncedReservation.
  let merged: Record<string, any>;
  if (isNormalizedCrmShape) {
    merged = {
      ...raw,
      id: resId,
      sourceReservationId: srcResId,
      reservationNumber: resNumber,
      originalStatusCode: rawCode,
      originalStatusAr: translatedOrigAr !== 'غير محدد' ? translatedOrigAr : sourceStatusAr
    };
  } else {
    merged = crmCore.mergeSyncedReservation(existingClient, raw, relatedExts, actor);
    merged.id = resId;
    merged.sourceReservationId = srcResId;
    merged.reservationNumber = resNumber;
  }

  let nextInternalStatus = str(merged.internalStatus || sourceStatusAr);
  let nextLastUpdateText = str(merged.lastUpdateText || `تم السحب من Rental Gate بالحالة: ${sourceStatusAr}`);
  let nextLastUpdatedById = str(merged.lastUpdatedById || actor.id);
  let nextLastUpdatedByName = str(merged.lastUpdatedByName || actor.name);
  let nextLastUpdatedAt = str(merged.lastUpdatedAt || nowIso);
  let nextStatusHistory = crmCore.normalizeStatusHistory(merged.statusHistory || []);
  let followUpHistoryEntry: Record<string, any> | null = null;

  if (!existingClient) {
    if (nextStatusHistory.length === 0) {
      nextStatusHistory = crmCore.appendStatusStageEntry([], {
        source: 'api_pull',
        previousStatus: '',
        newStatus: nextInternalStatus,
        sourceStatusCode: rawCode,
        changedAt: nowIso,
        changedById: actor.id,
        changedByName: actor.name,
        note: nextLastUpdateText
      });
    }
  } else {
    // Source-of-truth vs Staff follow-up conflict resolution
    const prevCode = str(existingClient.originalStatusCode).toLowerCase();
    const prevOrigAr = str(existingClient.originalStatusAr);
    const prevInternal = str(existingClient.internalStatus);
    const prevHist = crmCore.normalizeStatusHistory(existingClient.statusHistory || []);

    const sourceChanged = Boolean(
      rawCode && (
        (prevCode && rawCode !== prevCode) ||
        (!prevCode && prevOrigAr && sourceStatusAr !== prevOrigAr)
      )
    );

    if (sourceChanged) {
      nextInternalStatus = sourceStatusAr;
      nextLastUpdateText = `تحديث الحالة من Rental Gate: ${prevInternal || prevOrigAr || '-'} ← ${sourceStatusAr}`;
      nextLastUpdatedById = actor.id;
      nextLastUpdatedByName = actor.name;
      nextLastUpdatedAt = nowIso;
      nextStatusHistory = crmCore.appendStatusStageEntry(prevHist, {
        source: 'api_pull',
        previousStatus: prevInternal || prevOrigAr,
        newStatus: sourceStatusAr,
        sourceStatusCode: rawCode,
        changedAt: nowIso,
        changedById: actor.id,
        changedByName: actor.name,
        note: nextLastUpdateText
      });
      followUpHistoryEntry = {
        id: generateId('FUH'),
        followUpId: '',
        reservationId: resId,
        reservationNumber: resNumber,
        employeeId: actor.id,
        employeeName: actor.name,
        changeType: 'api_status_sync',
        previousStatus: prevInternal || prevOrigAr,
        newStatus: sourceStatusAr,
        previousAction: existingClient.lastUpdateText || '',
        newAction: nextLastUpdateText,
        previousNotes: '',
        newNotes: 'تحديث تلقائي للحالة عند إعادة السحب من Rental Gate',
        changedAt: nowIso
      };
    } else {
      // Source status did NOT change -> strictly preserve employee workflow fields
      nextInternalStatus = prevInternal || sourceStatusAr;
      nextLastUpdateText = existingClient.lastUpdateText || nextLastUpdateText;
      nextLastUpdatedById = existingClient.lastUpdatedById || actor.id;
      nextLastUpdatedByName = existingClient.lastUpdatedByName || actor.name;
      nextLastUpdatedAt = existingClient.lastUpdatedAt || nowIso;
      nextStatusHistory = prevHist.length > 0 ? prevHist : nextStatusHistory;
    }
  }

  const extSummary = relatedExts.length > 0
    ? crmCore.summarizeReservationExtensions(relatedExts, raw, str(merged.originalEndDate || merged.endDate), str(merged.originalEndTime || merged.endTime))
    : null;

  const baseDays = num(merged.daysCount, 0);
  const extDays = extSummary ? num(extSummary.extendedDaysCount, 0) : num(merged.extendedDaysCount, 0);
  const totalDays = num(merged.totalDaysCount, baseDays + extDays) || (baseDays + extDays);
  const baseAmt = num(merged.baseAmount, 0);
  const extAmt = extSummary ? num(extSummary.extensionsAmount, 0) : num(merged.extensionsAmount, 0);
  const extCount = extSummary ? num(extSummary.extensionsCount, 0) : num(merged.extensionsCount, 0);
  const totalAmt = num(merged.totalAmount, Number((baseAmt + extAmt).toFixed(2))) || Number((baseAmt + extAmt).toFixed(2));

  const record: Record<string, any> = {
    id: resId,
    sourceReservationId: srcResId,
    reservationNumber: resNumber,
    sourceCreatedAt: str(merged.sourceCreatedAt),
    customerName: str(merged.customerName || 'عميل'),
    customerPhone: str(merged.customerPhone),
    customerEmail: str(merged.customerEmail),
    customerIdNumber: str(merged.customerIdNumber),
    companyName: str(merged.companyName),
    branchName: str(merged.branchName),
    deliverBranchName: str(merged.deliverBranchName || merged.branchName),
    carName: str(merged.carName),
    plateNumber: str(merged.plateNumber),
    carCategory: str(merged.carCategory),
    startDate: str(merged.startDate),
    startTime: str(merged.startTime),
    originalEndDate: str(merged.originalEndDate || merged.endDate),
    originalEndTime: str(merged.originalEndTime || merged.endTime),
    endDate: str(extSummary?.extendedUntilDate || merged.endDate),
    endTime: str(extSummary?.extendedUntilTime || merged.endTime),
    extendedUntilDate: str(extSummary?.extendedUntilDate || merged.extendedUntilDate),
    extendedUntilTime: str(extSummary?.extendedUntilTime || merged.extendedUntilTime),
    daysCount: baseDays,
    extendedDaysCount: extDays,
    totalDaysCount: totalDays,
    originalStatusCode: rawCode,
    originalStatusAr: str(merged.originalStatusAr || sourceStatusAr),
    pickupTypeAr: str(merged.pickupTypeAr),
    returnTypeAr: str(merged.returnTypeAr),
    paymentMethod: str(merged.paymentMethod),
    paymentStatus: str(merged.paymentStatus),
    dailyPrice: num(merged.dailyPrice, 0),
    discountAmount: num(merged.discountAmount, 0),
    vatAmount: num(merged.vatAmount, 0),
    baseAmount: baseAmt,
    extensionsCount: extCount,
    extensionsAmount: extAmt,
    totalAmount: totalAmt,
    hasExtensions: Boolean(extCount > 0 || boolVal(merged.hasExtensions)),
    internalStatus: nextInternalStatus,
    priority: existingClient ? str(existingClient.priority || 'عادي') : str(merged.priority || 'عادي'),
    assignedEmployeeIds: existingClient
      ? parseJsonArray<string>(existingClient.assignedEmployeeIds)
      : parseJsonArray<string>(merged.assignedEmployeeIds),
    assignedEmployeeNames: existingClient
      ? parseJsonArray<string>(existingClient.assignedEmployeeNames)
      : parseJsonArray<string>(merged.assignedEmployeeNames),
    lastUpdateText: nextLastUpdateText,
    lastUpdatedById: nextLastUpdatedById,
    lastUpdatedByName: nextLastUpdatedByName,
    lastUpdatedAt: nextLastUpdatedAt,
    hasProblem: existingClient ? boolVal(existingClient.hasProblem) : boolVal(merged.hasProblem),
    createdAt: existingClient?.createdAt || str(merged.createdAt) || nowIso,
    updatedAt: nowIso,
    statusHistory: nextStatusHistory,
    rawJson: str(merged.rawJson) || JSON.stringify(raw).slice(0, 8000)
  };

  return { record, followUpHistoryEntry };
}

let lastSyncBatchMutatedAt = 0;

export function getLastSyncBatchMutatedAt(): number {
  return lastSyncBatchMutatedAt;
}

function chunkList<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export async function ingestIncrementalSyncBatch(
  executor: DbExecutor,
  payload: SyncBatchPayload
): Promise<SyncIngestResult> {
  const startMs = Date.now();
  const startedAt = new Date().toISOString();
  const syncId = generateId('SYNC');
  const actor: SyncActor = {
    id: str(payload?.actor?.id || payload?.triggeredById || 'GAS_SYNC'),
    name: str(payload?.actor?.name || payload?.triggeredByName || 'مزامنة Apps Script / Rental Gate'),
    role: str(payload?.actor?.role || 'system')
  };
  const sourceName = str(payload?.source || 'google_apps_script');
  const incomingRes = Array.isArray(payload?.reservations) ? payload.reservations : [];
  const incomingExt = Array.isArray(payload?.extensions) ? payload.extensions : [];
  const pagesFetched = num(payload?.pagesFetched, 0);

  let importedCount = 0;
  let updatedCount = 0;
  let extensionsCount = 0;
  const changedReservations: any[] = [];
  const mutatedReservations: any[] = [];

  try {
    await executor.withTransaction(async (tx) => {
      const existingResRes = incomingRes.length > 0
        ? await tx.query(
            `SELECT * FROM reservations WHERE reservation_number = ANY($1::text[])`,
            [incomingRes.map((r) => str(r.reservationNumber || r.reservation_number || r.reservationId || r.id)).filter(Boolean)]
          )
        : { rows: [] };

      const existingByNumber = new Map<string, Record<string, any>>();
      const resIdByRef = new Map<string, string>();
      for (const row of existingResRes.rows) {
        const clientObj = mapReservationRowToClient(row);
        existingByNumber.set(clientObj.reservationNumber, clientObj);
        if (clientObj.reservationNumber) resIdByRef.set(clientObj.reservationNumber, clientObj.id);
        if (clientObj.sourceReservationId) resIdByRef.set(clientObj.sourceReservationId, clientObj.id);
      }

      // Pre-resolve reservation IDs for incoming reservations before linking extensions
      for (const raw of incomingRes) {
        const resNum = str(raw.reservationNumber || raw.reservation_number || raw.reservationId || raw.id);
        if (!resNum) continue;
        const srcId = str(raw.sourceReservationId || raw.reservationId || raw.id || resNum);
        const existing = existingByNumber.get(resNum);
        const resId = existing?.id || (str(raw.id).startsWith('RES_') ? str(raw.id) : `RES_${resNum.replace(/[^A-Za-z0-9_-]/g, '')}`);
        resIdByRef.set(resNum, resId);
        if (srcId) resIdByRef.set(srcId, resId);
      }

      // Group extensions by reservation number / source ID and deduplicate by extensionNumber for safe batch upsert
      const extsByResKey = new Map<string, any[]>();
      const extDedupMap = new Map<string, Record<string, any>>();
      for (const rawExt of incomingExt) {
        const ext = normalizeIncomingExtension(rawExt, resIdByRef, startedAt);
        if (!ext.extensionNumber) continue;
        extDedupMap.set(ext.extensionNumber, ext);
        if (ext.isAcceptedAndPaid) {
          const keys = [ext.reservationNumber, ext.sourceReservationId].filter(Boolean);
          for (const k of keys) {
            const list = extsByResKey.get(k) || [];
            list.push(ext);
            extsByResKey.set(k, list);
          }
        }
      }
      const normalizedExts = Array.from(extDedupMap.values());

      // Normalize and deduplicate reservations by reservationNumber before batch SQL upsert
      const resDedupMap = new Map<string, Record<string, any>>();
      const historyBatch: Record<string, any>[] = [];

      for (const raw of incomingRes) {
        const resNum = str(raw.reservationNumber || raw.reservation_number || raw.reservationId || raw.id);
        if (!resNum) continue;
        const srcId = str(raw.sourceReservationId || raw.reservationId || raw.id || resNum);
        const existing = existingByNumber.get(resNum) || null;
        const relExts = extsByResKey.get(resNum) || extsByResKey.get(srcId) || [];

        const { record, followUpHistoryEntry } = normalizeIncomingReservation(raw, existing, relExts, actor, startedAt);
        resDedupMap.set(record.reservationNumber, record);
        if (followUpHistoryEntry) historyBatch.push(followUpHistoryEntry);
      }

      const reservationBatch = Array.from(resDedupMap.values());

      // Chunked UNNEST upserts for Reservations (first so extensions FK references are valid)
      for (const chunk of chunkList(reservationBatch, 200)) {
        const upsertRes = await tx.query<{ inserted: boolean }>(
          `INSERT INTO reservations (
             id, source_reservation_id, reservation_number, source_created_at,
             customer_name, customer_phone, customer_email, customer_id_number,
             company_name, branch_name, deliver_branch_name, car_name, plate_number, car_category,
             start_date, start_time, original_end_date, original_end_time, end_date, end_time,
             extended_until_date, extended_until_time, days_count, extended_days_count, total_days_count,
             original_status_code, original_status_ar, pickup_type_ar, return_type_ar,
             payment_method, payment_status, daily_price, discount_amount, vat_amount,
             base_amount, extensions_count, extensions_amount, total_amount, has_extensions,
             internal_status, priority, assigned_employee_ids, assigned_employee_names,
             last_update_text, last_updated_by_id, last_updated_by_name, last_updated_at,
             has_problem, created_at, updated_at, status_history, raw_json
           )
           SELECT * FROM unnest(
             $1::text[], $2::text[], $3::text[], $4::text[],
             $5::text[], $6::text[], $7::text[], $8::text[],
             $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[],
             $15::text[], $16::text[], $17::text[], $18::text[], $19::text[], $20::text[],
             $21::text[], $22::text[], $23::int4[], $24::int4[], $25::int4[],
             $26::text[], $27::text[], $28::text[], $29::text[],
             $30::text[], $31::text[], $32::numeric[], $33::numeric[], $34::numeric[],
             $35::numeric[], $36::int4[], $37::numeric[], $38::numeric[], $39::boolean[],
             $40::text[], $41::text[], $42::jsonb[], $43::jsonb[],
             $44::text[], $45::text[], $46::text[], $47::text[],
             $48::boolean[], $49::timestamptz[], $50::timestamptz[], $51::jsonb[], $52::text[]
           )
           ON CONFLICT (reservation_number) DO UPDATE SET
             source_reservation_id = EXCLUDED.source_reservation_id,
             source_created_at = EXCLUDED.source_created_at,
             customer_name = EXCLUDED.customer_name,
             customer_phone = EXCLUDED.customer_phone,
             customer_email = EXCLUDED.customer_email,
             customer_id_number = EXCLUDED.customer_id_number,
             company_name = EXCLUDED.company_name,
             branch_name = EXCLUDED.branch_name,
             deliver_branch_name = EXCLUDED.deliver_branch_name,
             car_name = EXCLUDED.car_name,
             plate_number = EXCLUDED.plate_number,
             car_category = EXCLUDED.car_category,
             start_date = EXCLUDED.start_date,
             start_time = EXCLUDED.start_time,
             original_end_date = EXCLUDED.original_end_date,
             original_end_time = EXCLUDED.original_end_time,
             end_date = EXCLUDED.end_date,
             end_time = EXCLUDED.end_time,
             extended_until_date = EXCLUDED.extended_until_date,
             extended_until_time = EXCLUDED.extended_until_time,
             days_count = EXCLUDED.days_count,
             extended_days_count = EXCLUDED.extended_days_count,
             total_days_count = EXCLUDED.total_days_count,
             original_status_code = EXCLUDED.original_status_code,
             original_status_ar = EXCLUDED.original_status_ar,
             pickup_type_ar = EXCLUDED.pickup_type_ar,
             return_type_ar = EXCLUDED.return_type_ar,
             payment_method = EXCLUDED.payment_method,
             payment_status = EXCLUDED.payment_status,
             daily_price = EXCLUDED.daily_price,
             discount_amount = EXCLUDED.discount_amount,
             vat_amount = EXCLUDED.vat_amount,
             base_amount = EXCLUDED.base_amount,
             extensions_count = EXCLUDED.extensions_count,
             extensions_amount = EXCLUDED.extensions_amount,
             total_amount = EXCLUDED.total_amount,
             has_extensions = EXCLUDED.has_extensions,
             internal_status = EXCLUDED.internal_status,
             priority = EXCLUDED.priority,
             assigned_employee_ids = EXCLUDED.assigned_employee_ids,
             assigned_employee_names = EXCLUDED.assigned_employee_names,
             last_update_text = EXCLUDED.last_update_text,
             last_updated_by_id = EXCLUDED.last_updated_by_id,
             last_updated_by_name = EXCLUDED.last_updated_by_name,
             last_updated_at = EXCLUDED.last_updated_at,
             has_problem = EXCLUDED.has_problem,
             updated_at = EXCLUDED.updated_at,
             status_history = EXCLUDED.status_history,
             raw_json = EXCLUDED.raw_json
           RETURNING (xmax = 0) AS inserted`,
          [
            chunk.map((r) => r.id),
            chunk.map((r) => r.sourceReservationId),
            chunk.map((r) => r.reservationNumber),
            chunk.map((r) => r.sourceCreatedAt),
            chunk.map((r) => r.customerName),
            chunk.map((r) => r.customerPhone),
            chunk.map((r) => r.customerEmail),
            chunk.map((r) => r.customerIdNumber),
            chunk.map((r) => r.companyName),
            chunk.map((r) => r.branchName),
            chunk.map((r) => r.deliverBranchName),
            chunk.map((r) => r.carName),
            chunk.map((r) => r.plateNumber),
            chunk.map((r) => r.carCategory),
            chunk.map((r) => r.startDate),
            chunk.map((r) => r.startTime),
            chunk.map((r) => r.originalEndDate),
            chunk.map((r) => r.originalEndTime),
            chunk.map((r) => r.endDate),
            chunk.map((r) => r.endTime),
            chunk.map((r) => r.extendedUntilDate),
            chunk.map((r) => r.extendedUntilTime),
            chunk.map((r) => r.daysCount),
            chunk.map((r) => r.extendedDaysCount),
            chunk.map((r) => r.totalDaysCount),
            chunk.map((r) => r.originalStatusCode),
            chunk.map((r) => r.originalStatusAr),
            chunk.map((r) => r.pickupTypeAr),
            chunk.map((r) => r.returnTypeAr),
            chunk.map((r) => r.paymentMethod),
            chunk.map((r) => r.paymentStatus),
            chunk.map((r) => r.dailyPrice),
            chunk.map((r) => r.discountAmount),
            chunk.map((r) => r.vatAmount),
            chunk.map((r) => r.baseAmount),
            chunk.map((r) => r.extensionsCount),
            chunk.map((r) => r.extensionsAmount),
            chunk.map((r) => r.totalAmount),
            chunk.map((r) => r.hasExtensions),
            chunk.map((r) => r.internalStatus),
            chunk.map((r) => r.priority),
            chunk.map((r) => JSON.stringify(r.assignedEmployeeIds)),
            chunk.map((r) => JSON.stringify(r.assignedEmployeeNames)),
            chunk.map((r) => r.lastUpdateText),
            chunk.map((r) => r.lastUpdatedById),
            chunk.map((r) => r.lastUpdatedByName),
            chunk.map((r) => r.lastUpdatedAt),
            chunk.map((r) => r.hasProblem),
            chunk.map((r) => r.createdAt),
            chunk.map((r) => r.updatedAt),
            chunk.map((r) => JSON.stringify(r.statusHistory)),
            chunk.map((r) => r.rawJson)
          ]
        );

        for (const row of upsertRes.rows) {
          if (row?.inserted) importedCount++;
          else updatedCount++;
        }
        for (const r of chunk) {
          const { rawJson: _omitRaw, ...clientRes } = r;
          changedReservations.push(clientRes);
          const prev = existingByNumber.get(r.reservationNumber);
          const genuinelyChanged =
            !prev ||
            str(prev.originalStatusCode) !== str(r.originalStatusCode) ||
            str(prev.internalStatus) !== str(r.internalStatus) ||
            str(prev.endDate) !== str(r.endDate) ||
            num(prev.extensionsCount, 0) !== num(r.extensionsCount, 0) ||
            num(prev.totalAmount, 0) !== num(r.totalAmount, 0);
          if (genuinelyChanged) {
            mutatedReservations.push(clientRes);
          }
        }
      }

      // Chunked UNNEST upserts for Extensions
      for (const extChunk of chunkList(normalizedExts, 250)) {
        await tx.query(
          `INSERT INTO extensions (
             id, extension_number, sequence_number, reservation_id, reservation_number,
             source_reservation_id, extension_type, extension_type_ar, status_code, status_ar,
             payment_status, payment_date, payment_method, extend_days, start_date, start_time,
             end_date, end_time, sub_total, vat_amount, amount, is_accepted_and_paid, synced_at
           )
           SELECT * FROM unnest(
             $1::text[], $2::text[], $3::int4[], $4::text[], $5::text[],
             $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
             $11::text[], $12::text[], $13::text[], $14::int4[], $15::text[], $16::text[],
             $17::text[], $18::text[], $19::numeric[], $20::numeric[], $21::numeric[], $22::boolean[], $23::timestamptz[]
           )
           ON CONFLICT (extension_number) DO UPDATE SET
             sequence_number = EXCLUDED.sequence_number,
             reservation_id = COALESCE(EXCLUDED.reservation_id, extensions.reservation_id),
             reservation_number = EXCLUDED.reservation_number,
             source_reservation_id = EXCLUDED.source_reservation_id,
             extension_type = EXCLUDED.extension_type,
             extension_type_ar = EXCLUDED.extension_type_ar,
             status_code = EXCLUDED.status_code,
             status_ar = EXCLUDED.status_ar,
             payment_status = EXCLUDED.payment_status,
             payment_date = EXCLUDED.payment_date,
             payment_method = EXCLUDED.payment_method,
             extend_days = EXCLUDED.extend_days,
             start_date = EXCLUDED.start_date,
             start_time = EXCLUDED.start_time,
             end_date = EXCLUDED.end_date,
             end_time = EXCLUDED.end_time,
             sub_total = EXCLUDED.sub_total,
             vat_amount = EXCLUDED.vat_amount,
             amount = EXCLUDED.amount,
             is_accepted_and_paid = EXCLUDED.is_accepted_and_paid,
             synced_at = EXCLUDED.synced_at`,
          [
            extChunk.map((ext) => ext.id),
            extChunk.map((ext) => ext.extensionNumber),
            extChunk.map((ext) => ext.sequenceNumber),
            extChunk.map((ext) => ext.reservationId || resIdByRef.get(ext.reservationNumber) || resIdByRef.get(ext.sourceReservationId) || null),
            extChunk.map((ext) => ext.reservationNumber),
            extChunk.map((ext) => ext.sourceReservationId),
            extChunk.map((ext) => ext.extensionType),
            extChunk.map((ext) => ext.extensionTypeAr),
            extChunk.map((ext) => ext.statusCode),
            extChunk.map((ext) => ext.statusAr),
            extChunk.map((ext) => ext.paymentStatus),
            extChunk.map((ext) => ext.paymentDate),
            extChunk.map((ext) => ext.paymentMethod),
            extChunk.map((ext) => ext.extendDays),
            extChunk.map((ext) => ext.startDate),
            extChunk.map((ext) => ext.startTime),
            extChunk.map((ext) => ext.endDate),
            extChunk.map((ext) => ext.endTime),
            extChunk.map((ext) => ext.subTotal),
            extChunk.map((ext) => ext.vatAmount),
            extChunk.map((ext) => ext.amount),
            extChunk.map((ext) => ext.isAcceptedAndPaid),
            extChunk.map((ext) => ext.syncedAt)
          ]
        );
        extensionsCount += extChunk.length;
      }

      // Chunked UNNEST inserts for FollowUpHistory
      for (const hChunk of chunkList(historyBatch, 250)) {
        await tx.query(
          `INSERT INTO follow_up_history (
             id, follow_up_id, reservation_id, reservation_number, employee_id, employee_name,
             change_type, previous_status, new_status, previous_action, new_action,
             previous_notes, new_notes, changed_at
           )
           SELECT * FROM unnest(
             $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
             $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
             $12::text[], $13::text[], $14::timestamptz[]
           )`,
          [
            hChunk.map((h) => h.id),
            hChunk.map((h) => h.followUpId),
            hChunk.map((h) => h.reservationId),
            hChunk.map((h) => h.reservationNumber),
            hChunk.map((h) => h.employeeId),
            hChunk.map((h) => h.employeeName),
            hChunk.map((h) => h.changeType),
            hChunk.map((h) => h.previousStatus),
            hChunk.map((h) => h.newStatus),
            hChunk.map((h) => h.previousAction),
            hChunk.map((h) => h.newAction),
            hChunk.map((h) => h.previousNotes),
            hChunk.map((h) => h.newNotes),
            hChunk.map((h) => h.changedAt)
          ]
        );
      }

      lastSyncBatchMutatedAt = Date.now();

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      await tx.query(
        `INSERT INTO sync_log (
           id, triggered_by_id, triggered_by_name, status, imported_count, updated_count,
           extensions_count, pages_fetched, error_message, duration_ms, started_at, finished_at
         ) VALUES ($1,$2,$3,'success',$4,$5,$6,$7,'',$8,$9::timestamptz,$10::timestamptz)`,
        [
          syncId, actor.id, actor.name, importedCount, updatedCount,
          extensionsCount, pagesFetched, durationMs, startedAt, finishedAt
        ]
      );

      await tx.query(
        `INSERT INTO sync_checkpoints (
           source, last_sync_at, last_successful_at, last_cursor, last_batch_count,
           last_status, last_error, meta, updated_at
         ) VALUES ($1,$2::timestamptz,$2::timestamptz,$3,$4,'success','',$5::jsonb,$2::timestamptz)
         ON CONFLICT (source) DO UPDATE SET
           last_sync_at = EXCLUDED.last_sync_at,
           last_successful_at = EXCLUDED.last_successful_at,
           last_cursor = COALESCE(NULLIF(EXCLUDED.last_cursor, ''), sync_checkpoints.last_cursor),
           last_batch_count = EXCLUDED.last_batch_count,
           last_status = 'success',
           last_error = '',
           meta = EXCLUDED.meta,
           updated_at = EXCLUDED.updated_at`,
        [
          sourceName,
          finishedAt,
          str(payload?.cursor || ''),
          importedCount + updatedCount + extensionsCount,
          JSON.stringify({
            appliedRange: payload?.appliedRange || null,
            importedCount,
            updatedCount,
            extensionsCount
          })
        ]
      );

      if (actor.id !== 'SYSTEM' || (importedCount + updatedCount + extensionsCount) > 0) {
        await tx.query(
          `INSERT INTO activity_log (
             id, user_id, user_name, user_role, action_type, entity_type, entity_id,
             details, log_date, log_time, created_at
           ) VALUES ($1,$2,$3,$4,'مزامنة سحابية','Sync',$5,$6,$7,$8,$9::timestamptz)`,
          [
            generateId('ACT'),
            actor.id,
            actor.name,
            actor.role || 'system',
            syncId,
            `استيراد ${importedCount}، تحديث ${updatedCount}، تمديدات ${extensionsCount}`,
            finishedAt.slice(0, 10),
            finishedAt.slice(11, 19),
            finishedAt
          ]
        );
      }
    });

    const finishedAt = new Date().toISOString();
    return {
      syncId,
      status: 'success',
      importedCount,
      updatedCount,
      extensionsCount,
      pagesFetched,
      durationMs: Date.now() - startMs,
      startedAt,
      finishedAt,
      checkpointAt: finishedAt,
      appliedRange: payload?.appliedRange,
      changedReservations,
      mutatedReservations
    };
  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    await logBackendError(executor, 'syncService', 'ingestIncrementalSyncBatch', err, {
      sourceName,
      reservationsCount: incomingRes.length,
      extensionsCount: incomingExt.length
    });
    try {
      await executor.query(
        `INSERT INTO sync_log (
           id, triggered_by_id, triggered_by_name, status, imported_count, updated_count,
           extensions_count, pages_fetched, error_message, duration_ms, started_at, finished_at
         ) VALUES ($1,$2,$3,'error',$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)`,
        [
          syncId, actor.id, actor.name, importedCount, updatedCount,
          extensionsCount, pagesFetched, String(err?.message || 'SYNC_ERROR').slice(0, 500),
          Date.now() - startMs, startedAt, finishedAt
        ]
      );
      await executor.query(
        `INSERT INTO sync_checkpoints (source, last_sync_at, last_status, last_error, updated_at)
         VALUES ($1,$2::timestamptz,'error',$3,$2::timestamptz)
         ON CONFLICT (source) DO UPDATE SET
           last_sync_at = EXCLUDED.last_sync_at,
           last_status = 'error',
           last_error = EXCLUDED.last_error,
           updated_at = EXCLUDED.updated_at`,
        [sourceName, finishedAt, String(err?.message || 'SYNC_ERROR').slice(0, 500)]
      );
    } catch {
      // ignore secondary log failure
    }
    throw err;
  }
}

export async function enqueueSheetsMirror(
  client: DbClient,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, any>
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO sheets_mirror_outbox (
         id, entity_type, entity_id, action, payload, status, retry_count, next_retry_at, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, NOW(), NOW())`,
      [generateId('MIR'), entityType, entityId, action, JSON.stringify(payload || {})]
    );
  } catch {
    // Non-blocking mirror enqueue
  }
}

export async function flushSheetsMirrorOutbox(
  executor: DbExecutor,
  fetchFn: typeof fetch = fetch
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const serverCfg = await resolveServerConfig(executor);
  const gasUrl = str(serverCfg.gasWebAppUrl);
  const syncSecret = str(serverCfg.syncApiSecret);
  if (!gasUrl || !syncSecret) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const pendingRes = await executor.query(
    `SELECT * FROM sheets_mirror_outbox
     WHERE status IN ('pending', 'retry') AND next_retry_at <= NOW()
     ORDER BY created_at ASC
     LIMIT 50`
  );
  if (pendingRes.rows.length === 0) {
    return { sent: 0, failed: 0, skipped: false };
  }

  const items = pendingRes.rows.map((r) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {})
  }));

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 6500) : null;
  try {
    const resp = await fetchFn(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      signal: ctrl?.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: { syncSecret, items }
      })
    });
    if (timer) clearTimeout(timer);
    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(String(text || '').trim());
    } catch {
      parsed = null;
    }
    if (!resp.ok || !parsed?.success) {
      throw new Error(parsed?.message || `GAS HTTP ${resp.status}`);
    }

    const ids = items.map((x) => x.id);
    await executor.query(
      `UPDATE sheets_mirror_outbox
       SET status = 'sent', processed_at = NOW(), last_error = ''
       WHERE id = ANY($1::text[])`,
      [ids]
    );
    return { sent: ids.length, failed: 0, skipped: false };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    const errMsg = String(err?.message || 'MIRROR_FAILED').slice(0, 400);
    for (const row of pendingRes.rows) {
      const nextRetryCount = num(row.retry_count, 0) + 1;
      const dead = nextRetryCount >= 8;
      const delaySeconds = Math.min(3600, Math.pow(2, nextRetryCount) * 15);
      await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = $2,
             retry_count = $3,
             last_error = $4,
             next_retry_at = NOW() + ($5 || ' seconds')::interval
         WHERE id = $1`,
        [row.id, dead ? 'failed' : 'retry', nextRetryCount, errMsg, String(delaySeconds)]
      ).catch(() => undefined);
    }
    return { sent: 0, failed: pendingRes.rows.length, skipped: false };
  }
}

export async function pullFromRentalGateDirect(
  executor: DbExecutor,
  actor: SyncActor,
  payload: Record<string, any> = {},
  fetchFn: typeof fetch = fetch
): Promise<SyncIngestResult> {
  const serverCfg = await resolveServerConfig(executor);
  const rgToken = str(serverCfg.rgToken).replace(/^Bearer\s+/i, '');
  if (!rgToken) {
    throw new Error('NO_RG_TOKEN: يرجى إدخال توكن Rental Gate في الإعدادات (أو ضبط متغير RG_TOKEN على الخادم).');
  }

  const baseApi = str(serverCfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
  const appliedRange = crmCore.resolvePullDateRange(payload || {});
  const pageSize = 100;
  const maxPages = Math.min(50, Math.max(1, num(payload?.maxPages, 25)));

  const fetchPaged = async (endpoint: string) => {
    const items: any[] = [];
    let pages = 0;
    for (let page = 0; page < maxPages; page++) {
      const resp = await fetchFn(`${baseApi}/${endpoint}?page=${page}&size=${pageSize}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${rgToken}`,
          Accept: 'application/json',
          lang: 'ar'
        }
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`RG_API_HTTP_${resp.status}: ${errBody.slice(0, 200)}`);
      }
      const json: any = await resp.json();
      pages++;
      const list = Array.isArray(json)
        ? json
        : (json?.content || json?.items || json?.data || json?.results || []);
      const arr = Array.isArray(list) ? list : [];
      items.push(...arr);
      if (json?.last === true || arr.length < pageSize) break;
    }
    return { items, pages };
  };

  const [resPaged, extPaged] = await Promise.all([
    fetchPaged('reservations/filter'),
    fetchPaged('reservation-extends/filter')
  ]);

  const settingsRes = await executor.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'excluded_statuses' LIMIT 1`
  );
  let excludedStatuses: string[] = [];
  if (settingsRes.rows[0]?.value) {
    try {
      excludedStatuses = JSON.parse(settingsRes.rows[0].value);
    } catch {
      excludedStatuses = [];
    }
  }
  const excludedSet = new Set(excludedStatuses.map((s) => str(s).toLowerCase()));

  const dedupedRes = crmCore.dedupeReservationsByNumber(resPaged.items).filter((item: any) => {
    const code = str(item.reservationStatus || item.status || item.status_code).toLowerCase();
    return !excludedSet.has(code);
  });

  const filteredRes = appliedRange?.hasCustomRange
    ? crmCore.filterSourceReservationsByPullRange(dedupedRes, appliedRange)
    : dedupedRes;

  const dedupedExt = crmCore.dedupeExtensionsByNumber(extPaged.items);

  const syncResult = await ingestIncrementalSyncBatch(executor, {
    source: 'rental_gate_direct',
    actor,
    pagesFetched: resPaged.pages + extPaged.pages,
    appliedRange,
    reservations: filteredRes,
    extensions: dedupedExt
  });

  if (serverCfg.gasWebAppUrl && Array.isArray(syncResult.mutatedReservations) && syncResult.mutatedReservations.length > 0) {
    const toMirror = syncResult.mutatedReservations.slice(0, 100);
    for (const r of toMirror) {
      await enqueueSheetsMirror(executor, 'Reservation', r.id, 'upsertReservation', r);
    }
    void flushSheetsMirrorOutbox(executor, fetchFn).catch(() => undefined);
  }

  return syncResult;
}
