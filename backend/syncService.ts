import { crmCore, generateId, parseJsonArray } from './auth';
import type { DbClient, DbExecutor } from './db';
import { logBackendError } from './logger';
import { emitRealtimeEvent } from './realtimeBus';

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

      // Group extensions by reservation number / source ID for accurate summary calculation
      const extsByResKey = new Map<string, any[]>();
      const normalizedExts: Record<string, any>[] = [];
      for (const rawExt of incomingExt) {
        const ext = normalizeIncomingExtension(rawExt, resIdByRef, startedAt);
        if (!ext.extensionNumber) continue;
        normalizedExts.push(ext);
        if (ext.isAcceptedAndPaid) {
          const keys = [ext.reservationNumber, ext.sourceReservationId].filter(Boolean);
          for (const k of keys) {
            const list = extsByResKey.get(k) || [];
            list.push(ext);
            extsByResKey.set(k, list);
          }
        }
      }

      const historyBatch: Record<string, any>[] = [];

      // Upsert Reservations first so extensions FK references are guaranteed valid
      for (const raw of incomingRes) {
        const resNum = str(raw.reservationNumber || raw.reservation_number || raw.reservationId || raw.id);
        if (!resNum) continue;
        const srcId = str(raw.sourceReservationId || raw.reservationId || raw.id || resNum);
        const existing = existingByNumber.get(resNum) || null;
        const relExts = extsByResKey.get(resNum) || extsByResKey.get(srcId) || [];

        const { record, followUpHistoryEntry } = normalizeIncomingReservation(raw, existing, relExts, actor, startedAt);

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
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
             $40,$41,$42::jsonb,$43::jsonb,$44,$45,$46,$47,$48,$49::timestamptz,$50::timestamptz,$51::jsonb,$52
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
            record.id,
            record.sourceReservationId,
            record.reservationNumber,
            record.sourceCreatedAt,
            record.customerName,
            record.customerPhone,
            record.customerEmail,
            record.customerIdNumber,
            record.companyName,
            record.branchName,
            record.deliverBranchName,
            record.carName,
            record.plateNumber,
            record.carCategory,
            record.startDate,
            record.startTime,
            record.originalEndDate,
            record.originalEndTime,
            record.endDate,
            record.endTime,
            record.extendedUntilDate,
            record.extendedUntilTime,
            record.daysCount,
            record.extendedDaysCount,
            record.totalDaysCount,
            record.originalStatusCode,
            record.originalStatusAr,
            record.pickupTypeAr,
            record.returnTypeAr,
            record.paymentMethod,
            record.paymentStatus,
            record.dailyPrice,
            record.discountAmount,
            record.vatAmount,
            record.baseAmount,
            record.extensionsCount,
            record.extensionsAmount,
            record.totalAmount,
            record.hasExtensions,
            record.internalStatus,
            record.priority,
            JSON.stringify(record.assignedEmployeeIds),
            JSON.stringify(record.assignedEmployeeNames),
            record.lastUpdateText,
            record.lastUpdatedById,
            record.lastUpdatedByName,
            record.lastUpdatedAt,
            record.hasProblem,
            record.createdAt,
            record.updatedAt,
            JSON.stringify(record.statusHistory),
            record.rawJson
          ]
        );

        const wasInserted = Boolean(upsertRes.rows[0]?.inserted);
        if (wasInserted) importedCount++;
        else updatedCount++;

        if (followUpHistoryEntry) historyBatch.push(followUpHistoryEntry);

        const { rawJson: _omitRaw, ...clientRes } = record;
        changedReservations.push(clientRes);
      }

      // Upsert Extensions
      for (const ext of normalizedExts) {
        const linkedResId = ext.reservationId || resIdByRef.get(ext.reservationNumber) || resIdByRef.get(ext.sourceReservationId) || null;
        await tx.query(
          `INSERT INTO extensions (
             id, extension_number, sequence_number, reservation_id, reservation_number,
             source_reservation_id, extension_type, extension_type_ar, status_code, status_ar,
             payment_status, payment_date, payment_method, extend_days, start_date, start_time,
             end_date, end_time, sub_total, vat_amount, amount, is_accepted_and_paid, synced_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::timestamptz
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
            ext.id,
            ext.extensionNumber,
            ext.sequenceNumber,
            linkedResId,
            ext.reservationNumber,
            ext.sourceReservationId,
            ext.extensionType,
            ext.extensionTypeAr,
            ext.statusCode,
            ext.statusAr,
            ext.paymentStatus,
            ext.paymentDate,
            ext.paymentMethod,
            ext.extendDays,
            ext.startDate,
            ext.startTime,
            ext.endDate,
            ext.endTime,
            ext.subTotal,
            ext.vatAmount,
            ext.amount,
            ext.isAcceptedAndPaid,
            ext.syncedAt
          ]
        );
        extensionsCount++;
      }

      for (const h of historyBatch) {
        await tx.query(
          `INSERT INTO follow_up_history (
             id, follow_up_id, reservation_id, reservation_number, employee_id, employee_name,
             change_type, previous_status, new_status, previous_action, new_action,
             previous_notes, new_notes, changed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz)`,
          [
            h.id, h.followUpId, h.reservationId, h.reservationNumber, h.employeeId, h.employeeName,
            h.changeType, h.previousStatus, h.newStatus, h.previousAction, h.newAction,
            h.previousNotes, h.newNotes, h.changedAt
          ]
        );
      }

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
    if (changedReservations.length > 0) {
      await emitRealtimeEvent(executor, {
        eventType: 'sync:batch',
        entityType: 'Reservation',
        recordId: changedReservations[0]?.id || '',
        operation: 'UPDATE',
        payload: {
          count: changedReservations.length,
          importedCount,
          updatedCount,
          extensionsCount,
          reservations: changedReservations.slice(0, 25)
        },
        actorId: actor.id,
        actorName: actor.name
      }).catch(() => undefined);
    }
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
      changedReservations
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

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface EnqueueSyncInput {
  entityType: string;
  entityId: string;
  recordId?: string;
  operation?: SyncOperation | string;
  action: string;
  payload: Record<string, any>;
  idempotencyKey?: string;
  maxRetries?: number;
}

export interface FlushOutboxResult {
  sent: number;
  synced: number;
  failed: number;
  retried: number;
  skipped: boolean;
  reason?: string;
  results?: any[];
}

const STALE_LOCK_SECONDS = 90;
const DEFAULT_MAX_RETRIES = 8;

let activeFlushPromise: Promise<FlushOutboxResult> | null = null;
let retriggerRequested = false;

export function mapOutboxRowToClient(row: any): Record<string, any> {
  const rawStatus = str(row.status || 'pending').toLowerCase();
  const normalizedStatus = crmCore.normalizeOutboxStatus(rawStatus);
  return {
    id: str(row.id),
    entityType: str(row.entity_type ?? row.entityType),
    entityId: str(row.entity_id ?? row.entityId),
    recordId: str(row.record_id ?? row.recordId ?? row.entity_id),
    operation: crmCore.normalizeSyncOperation(row.operation, row.action),
    action: str(row.action),
    idempotencyKey: str(row.idempotency_key ?? row.idempotencyKey),
    status: normalizedStatus,
    rawStatus,
    retryCount: num(row.retry_count ?? row.retryCount, 0),
    maxRetries: num(row.max_retries ?? row.maxRetries, DEFAULT_MAX_RETRIES),
    nextRetryAt: row.next_retry_at instanceof Date ? row.next_retry_at.toISOString() : str(row.next_retry_at ?? row.nextRetryAt),
    lockedAt: row.locked_at instanceof Date ? row.locked_at.toISOString() : str(row.locked_at ?? row.lockedAt),
    workerId: str(row.worker_id ?? row.workerId),
    lastError: str(row.last_error ?? row.lastError),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at ?? row.updatedAt),
    syncedAt: row.synced_at instanceof Date ? row.synced_at.toISOString() : (row.processed_at instanceof Date ? row.processed_at.toISOString() : str(row.synced_at ?? row.processed_at))
  };
}

export async function enqueueSyncOperation(
  client: DbClient,
  input: EnqueueSyncInput
): Promise<string | null> {
  const outboxId = generateId('MIR');
  const operation = crmCore.normalizeSyncOperation(input.operation, input.action);
  const recordId = str(input.recordId || input.entityId);
  const maxRetries = Math.max(1, Math.min(20, num(input.maxRetries, DEFAULT_MAX_RETRIES)));
  const idempotencyKey = str(input.idempotencyKey) || null;
  const payloadObj = input.payload && typeof input.payload === 'object' ? input.payload : {};

  try {
    const res = await client.query<{ id: string }>(
      `INSERT INTO sheets_mirror_outbox (
         id, entity_type, entity_id, record_id, operation, action, payload,
         idempotency_key, status, retry_count, max_retries, next_retry_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',0,$9,NOW(),NOW(),NOW())
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> '' DO NOTHING
       RETURNING id`,
      [
        outboxId,
        str(input.entityType),
        str(input.entityId),
        recordId,
        operation,
        str(input.action),
        JSON.stringify(payloadObj),
        idempotencyKey,
        maxRetries
      ]
    );
    return res.rows[0]?.id || outboxId;
  } catch {
    // Non-blocking fallback for simplified mock DB drivers
    try {
      await client.query(
        `INSERT INTO sheets_mirror_outbox (
           id, entity_type, entity_id, action, payload, status, retry_count, next_retry_at, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, NOW(), NOW())`,
        [outboxId, str(input.entityType), str(input.entityId), str(input.action), JSON.stringify(payloadObj)]
      );
      return outboxId;
    } catch {
      return null;
    }
  }
}

export async function enqueueSheetsMirror(
  client: DbClient,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, any>,
  options: { operation?: SyncOperation | string; recordId?: string; idempotencyKey?: string } = {}
): Promise<string | null> {
  return enqueueSyncOperation(client, {
    entityType,
    entityId,
    recordId: options.recordId || entityId,
    operation: options.operation || crmCore.normalizeSyncOperation('', action),
    action,
    payload,
    idempotencyKey: options.idempotencyKey
  });
}

async function recoverStaleOutboxLocks(executor: DbExecutor): Promise<number> {
  try {
    const res = await executor.query(
      `UPDATE sheets_mirror_outbox
       SET status = 'retry',
           locked_at = NULL,
           worker_id = '',
           updated_at = NOW(),
           last_error = CASE WHEN last_error = '' THEN 'Recovered stale processing lock' ELSE last_error END
       WHERE status = 'processing'
         AND locked_at IS NOT NULL
         AND locked_at < NOW() - ($1 || ' seconds')::interval`,
      [String(STALE_LOCK_SECONDS)]
    );
    return Number(res.rowCount || 0);
  } catch {
    return 0;
  }
}

async function claimOutboxBatch(
  executor: DbExecutor,
  workerId: string,
  batchSize = 50
): Promise<any[]> {
  await recoverStaleOutboxLocks(executor);

  return executor.withTransaction(async (tx) => {
    try {
      const claimRes = await tx.query(
        `WITH due AS (
           SELECT id FROM sheets_mirror_outbox
           WHERE status IN ('pending', 'retry') AND next_retry_at <= NOW()
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE sheets_mirror_outbox o
         SET status = 'processing',
             locked_at = NOW(),
             worker_id = $2,
             updated_at = NOW()
         FROM due
         WHERE o.id = due.id
         RETURNING o.*`,
        [batchSize, workerId]
      );
      return claimRes.rows;
    } catch {
      // Fallback for test mocks that don't support CTE FOR UPDATE SKIP LOCKED
      const selRes = await tx.query(
        `SELECT * FROM sheets_mirror_outbox
         WHERE status IN ('pending', 'retry') AND next_retry_at <= NOW()
         ORDER BY created_at ASC
         LIMIT $1`,
        [batchSize]
      );
      if (selRes.rows.length > 0) {
        const ids = selRes.rows.map((r) => r.id);
        await tx.query(
          `UPDATE sheets_mirror_outbox
           SET status = 'processing', locked_at = NOW(), worker_id = $2, updated_at = NOW()
           WHERE id = ANY($1::text[])`,
          [ids, workerId]
        ).catch(() => undefined);
      }
      return selRes.rows;
    }
  });
}

async function stampEntityLastSync(
  executor: DbExecutor,
  items: Array<{ entityType: string; entityId: string; recordId?: string }>
): Promise<void> {
  const byTable: Record<string, string[]> = {
    customers: [],
    reservations: [],
    follow_ups: [],
    problems: [],
    employees: []
  };

  for (const item of items) {
    const et = str(item.entityType).toLowerCase();
    const id = str(item.recordId || item.entityId);
    if (!id) continue;
    if (et === 'customer') byTable.customers.push(id);
    else if (et === 'reservation') byTable.reservations.push(id);
    else if (et === 'followup' || et === 'follow_up') byTable.follow_ups.push(id);
    else if (et === 'problem' || et === 'issue') byTable.problems.push(id);
    else if (et === 'employee' || et === 'user') byTable.employees.push(id);
  }

  for (const [table, ids] of Object.entries(byTable)) {
    if (ids.length === 0) continue;
    await executor.query(
      `UPDATE ${table} SET last_sync_at = NOW() WHERE id = ANY($1::text[])`,
      [Array.from(new Set(ids))]
    ).catch(() => undefined);
  }
}

export async function flushSyncQueue(
  executor: DbExecutor,
  fetchFn: typeof fetch = fetch,
  options: { batchSize?: number; workerId?: string } = {}
): Promise<FlushOutboxResult> {
  const gasUrl = str(process.env.GAS_WEBAPP_URL);
  const syncSecret = str(process.env.SYNC_API_SECRET);
  if (!gasUrl || !syncSecret) {
    return { sent: 0, synced: 0, failed: 0, retried: 0, skipped: true, reason: 'GAS_OR_SECRET_UNCONFIGURED' };
  }

  const workerId = str(options.workerId) || generateId('WRK');
  const batchSize = Math.min(100, Math.max(1, num(options.batchSize, 50)));
  const claimedRows = await claimOutboxBatch(executor, workerId, batchSize);
  if (claimedRows.length === 0) {
    return { sent: 0, synced: 0, failed: 0, retried: 0, skipped: false };
  }

  const items = claimedRows.map((r) => {
    const payloadObj = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {});
    const op = crmCore.normalizeSyncOperation(r.operation, r.action);
    const recId = str(r.record_id || r.entity_id || payloadObj?.id || payloadObj?.reservationNumber || payloadObj?.key);
    return {
      id: str(r.id),
      outboxId: str(r.id),
      idempotencyKey: str(r.idempotency_key) || str(r.id),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      recordId: recId,
      operation: op,
      action: str(r.action),
      payload: payloadObj
    };
  });

  try {
    const resp = await fetchFn(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncFromNeonMirror',
        payload: {
          syncSecret,
          workerId,
          batchSize: items.length,
          items
        }
      })
    });
    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`GAS_INVALID_JSON (HTTP ${resp.status}): ${text.slice(0, 160)}`);
    }

    if (!resp.ok || !parsed?.success) {
      throw new Error(parsed?.error || parsed?.message || `GAS HTTP ${resp.status}`);
    }

    const perResults = Array.isArray(parsed?.data?.results)
      ? parsed.data.results
      : (Array.isArray(parsed?.results) ? parsed.results : null);

    const syncedRows: any[] = [];
    const failedItems: Array<{ row: any; errMsg: string }> = [];

    if (perResults && perResults.length > 0) {
      const resultByOutboxId = new Map<string, any>();
      for (const resItem of perResults) {
        const key = str(resItem?.outboxId || resItem?.id);
        if (key) resultByOutboxId.set(key, resItem);
      }
      for (const row of claimedRows) {
        const resItem = resultByOutboxId.get(str(row.id));
        if (!resItem || resItem.success !== false) {
          syncedRows.push(row);
        } else {
          failedItems.push({ row, errMsg: str(resItem.error || 'ITEM_SYNC_FAILED').slice(0, 400) });
        }
      }
    } else {
      syncedRows.push(...claimedRows);
    }

    if (syncedRows.length > 0) {
      const syncedIds = syncedRows.map((r) => str(r.id));
      await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = 'synced',
             locked_at = NULL,
             worker_id = '',
             last_error = '',
             processed_at = NOW(),
             synced_at = NOW(),
             updated_at = NOW()
         WHERE id = ANY($1::text[])`,
        [syncedIds]
      );
      await stampEntityLastSync(
        executor,
        syncedRows.map((r) => ({ entityType: str(r.entity_type), entityId: str(r.entity_id), recordId: str(r.record_id) }))
      );
    }

    let failedCount = 0;
    let retriedCount = 0;
    for (const f of failedItems) {
      const nextRetryCount = num(f.row.retry_count, 0) + 1;
      const maxRetries = Math.max(1, num(f.row.max_retries, DEFAULT_MAX_RETRIES));
      const dead = nextRetryCount >= maxRetries;
      const delaySeconds = crmCore.computeExponentialBackoffSeconds(nextRetryCount, 5, 900);
      await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = $2,
             retry_count = $3,
             last_error = $4,
             locked_at = NULL,
             worker_id = '',
             updated_at = NOW(),
             next_retry_at = NOW() + ($5 || ' seconds')::interval
         WHERE id = $1`,
        [f.row.id, dead ? 'failed' : 'retry', nextRetryCount, f.errMsg, String(delaySeconds)]
      ).catch(() => undefined);
      if (dead) failedCount++;
      else retriedCount++;
    }

    await emitRealtimeEvent(executor, {
      eventType: 'sync:queue_updated',
      entityType: 'SyncQueue',
      operation: 'UPDATE',
      payload: {
        synced: syncedRows.length,
        failed: failedCount,
        retried: retriedCount,
        syncedAt: new Date().toISOString()
      }
    }).catch(() => undefined);

    return {
      sent: syncedRows.length,
      synced: syncedRows.length,
      failed: failedCount,
      retried: retriedCount,
      skipped: false,
      results: perResults || undefined
    };
  } catch (err: any) {
    const errMsg = String(err?.message || 'MIRROR_FAILED').slice(0, 400);
    let failedCount = 0;
    let retriedCount = 0;
    for (const row of claimedRows) {
      const nextRetryCount = num(row.retry_count, 0) + 1;
      const maxRetries = Math.max(1, num(row.max_retries, DEFAULT_MAX_RETRIES));
      const dead = nextRetryCount >= maxRetries;
      const delaySeconds = crmCore.computeExponentialBackoffSeconds(nextRetryCount, 5, 900);
      await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = $2,
             retry_count = $3,
             last_error = $4,
             locked_at = NULL,
             worker_id = '',
             updated_at = NOW(),
             next_retry_at = NOW() + ($5 || ' seconds')::interval
         WHERE id = $1`,
        [row.id, dead ? 'failed' : 'retry', nextRetryCount, errMsg, String(delaySeconds)]
      ).catch(() => undefined);
      if (dead) failedCount++;
      else retriedCount++;
    }
    await emitRealtimeEvent(executor, {
      eventType: 'sync:queue_updated',
      entityType: 'SyncQueue',
      operation: 'UPDATE',
      payload: {
        synced: 0,
        failed: failedCount,
        retried: retriedCount,
        error: errMsg
      }
    }).catch(() => undefined);
    return {
      sent: 0,
      synced: 0,
      failed: failedCount,
      retried: retriedCount,
      skipped: false,
      reason: errMsg
    };
  }
}

export async function flushSheetsMirrorOutbox(
  executor: DbExecutor,
  fetchFn: typeof fetch = fetch
): Promise<FlushOutboxResult> {
  return flushSyncQueue(executor, fetchFn);
}

export function triggerImmediateSync(
  executor: DbExecutor,
  fetchFn: typeof fetch = fetch
): Promise<FlushOutboxResult> {
  if (activeFlushPromise) {
    retriggerRequested = true;
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    let aggregate: FlushOutboxResult = { sent: 0, synced: 0, failed: 0, retried: 0, skipped: false };
    try {
      do {
        retriggerRequested = false;
        const pass = await flushSyncQueue(executor, fetchFn, { batchSize: 50 });
        aggregate = {
          sent: aggregate.sent + pass.sent,
          synced: aggregate.synced + pass.synced,
          failed: aggregate.failed + pass.failed,
          retried: aggregate.retried + pass.retried,
          skipped: pass.skipped,
          reason: pass.reason || aggregate.reason
        };
        if (pass.skipped || (pass.sent === 0 && !retriggerRequested)) break;
      } while (retriggerRequested);
    } finally {
      activeFlushPromise = null;
      retriggerRequested = false;
    }
    return aggregate;
  })();

  return activeFlushPromise;
}

export async function retryFailedSyncItems(
  executor: DbExecutor,
  ids?: string[],
  fetchFn: typeof fetch = fetch
): Promise<{ resetCount: number; flush: FlushOutboxResult }> {
  const cleanIds = Array.isArray(ids) ? ids.map((x) => str(x)).filter(Boolean) : [];
  const res = cleanIds.length > 0
    ? await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = 'pending',
             retry_count = 0,
             next_retry_at = NOW(),
             locked_at = NULL,
             worker_id = '',
             last_error = '',
             updated_at = NOW()
         WHERE id = ANY($1::text[])`,
        [cleanIds]
      )
    : await executor.query(
        `UPDATE sheets_mirror_outbox
         SET status = 'pending',
             retry_count = 0,
             next_retry_at = NOW(),
             locked_at = NULL,
             worker_id = '',
             last_error = '',
             updated_at = NOW()
         WHERE status IN ('failed', 'retry')`
      );

  const resetCount = Number(res.rowCount || 0);
  const flush = await flushSyncQueue(executor, fetchFn);
  return { resetCount, flush };
}

export async function getSyncQueueSummary(
  executor: DbExecutor,
  limit = 60
): Promise<Record<string, any>> {
  const safeLimit = Math.min(200, Math.max(10, num(limit, 60)));
  try {
    const [countsRes, itemsRes] = await Promise.all([
      executor.query<{ status: string; cnt: string }>(
        `SELECT status, COUNT(*)::text AS cnt FROM sheets_mirror_outbox GROUP BY status`
      ),
      executor.query(
        `SELECT id, entity_type, entity_id, record_id, operation, action, status,
                retry_count, max_retries, next_retry_at, locked_at, last_error,
                created_at, updated_at, processed_at, synced_at
         FROM sheets_mirror_outbox
         ORDER BY created_at DESC
         LIMIT $1`,
        [safeLimit]
      )
    ]);

    const counts = {
      pending: 0,
      processing: 0,
      synced: 0,
      failed: 0,
      total: 0
    };

    for (const row of countsRes.rows) {
      const c = Number(row.cnt || 0);
      const norm = crmCore.normalizeOutboxStatus(row.status);
      if (norm === 'synced') counts.synced += c;
      else if (norm === 'processing') counts.processing += c;
      else if (norm === 'failed') counts.failed += c;
      else counts.pending += c;
      counts.total += c;
    }

    return {
      counts,
      items: itemsRes.rows.map(mapOutboxRowToClient),
      gasConfigured: Boolean(str(process.env.GAS_WEBAPP_URL) && str(process.env.SYNC_API_SECRET))
    };
  } catch {
    return {
      counts: { pending: 0, processing: 0, synced: 0, failed: 0, total: 0 },
      items: [],
      gasConfigured: Boolean(str(process.env.GAS_WEBAPP_URL) && str(process.env.SYNC_API_SECRET))
    };
  }
}

export async function runBackupDeltaSync(
  executor: DbExecutor,
  actor: SyncActor = { id: 'CRON_1M', name: 'المزامنة الاحتياطية (كل دقيقة)', role: 'system' },
  options: { pullRentalGate?: boolean; fetchFn?: typeof fetch } = {}
): Promise<Record<string, any>> {
  const fetchFn = options.fetchFn || fetch;
  const startedAt = new Date().toISOString();
  let enqueuedMissed = 0;

  // 1) Scan only unsynced/modified Neon delta rows (never full-table dump)
  try {
    const [missedRes, missedCust, missedPrb] = await Promise.all([
      executor.query(
        `SELECT r.* FROM reservations r
         WHERE r.deleted_at IS NULL
           AND (r.last_sync_at IS NULL OR r.updated_at > r.last_sync_at)
           AND NOT EXISTS (
             SELECT 1 FROM sheets_mirror_outbox o
             WHERE o.entity_type = 'Reservation' AND o.entity_id = r.id AND o.status IN ('pending', 'processing', 'retry')
           )
         ORDER BY r.updated_at ASC
         LIMIT 50`
      ),
      executor.query(
        `SELECT c.* FROM customers c
         WHERE c.deleted_at IS NULL
           AND (c.last_sync_at IS NULL OR c.updated_at > c.last_sync_at)
           AND NOT EXISTS (
             SELECT 1 FROM sheets_mirror_outbox o
             WHERE o.entity_type = 'Customer' AND o.entity_id = c.id AND o.status IN ('pending', 'processing', 'retry')
           )
         ORDER BY c.updated_at ASC
         LIMIT 50`
      ),
      executor.query(
        `SELECT p.* FROM problems p
         WHERE p.deleted_at IS NULL
           AND (p.last_sync_at IS NULL OR p.updated_at > p.last_sync_at)
           AND NOT EXISTS (
             SELECT 1 FROM sheets_mirror_outbox o
             WHERE o.entity_type = 'Problem' AND o.entity_id = p.id AND o.status IN ('pending', 'processing', 'retry')
           )
         ORDER BY p.updated_at ASC
         LIMIT 50`
      )
    ]);

    for (const row of missedCust.rows) {
      const custObj = {
        id: str(row.id),
        name: str(row.name),
        phone: str(row.phone),
        email: str(row.email),
        idNumber: str(row.id_number),
        companyName: str(row.company_name),
        notes: str(row.notes),
        status: str(row.status || 'active'),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
      };
      await enqueueSyncOperation(executor, {
        entityType: 'Customer',
        entityId: custObj.id,
        recordId: custObj.id,
        operation: 'UPDATE',
        action: 'upsertCustomer',
        payload: custObj,
        idempotencyKey: `DELTA:Customer:${custObj.id}:${custObj.updatedAt}`
      });
      enqueuedMissed++;
    }

    for (const row of missedRes.rows) {
      const resObj = mapReservationRowToClient(row, false);
      await enqueueSyncOperation(executor, {
        entityType: 'Reservation',
        entityId: resObj.id,
        recordId: resObj.reservationNumber || resObj.id,
        operation: 'UPDATE',
        action: 'upsertReservation',
        payload: resObj,
        idempotencyKey: `DELTA:Reservation:${resObj.id}:${resObj.updatedAt}`
      });
      enqueuedMissed++;
    }

    for (const row of missedPrb.rows) {
      const prbObj = {
        id: str(row.id),
        problemNumber: str(row.problem_number),
        reservationId: str(row.reservation_id),
        reservationNumber: str(row.reservation_number),
        customerName: str(row.customer_name),
        createdById: str(row.created_by_id),
        createdByName: str(row.created_by_name),
        assignedEmployeeIds: parseJsonArray<string>(row.assigned_employee_ids),
        assignedEmployeeNames: parseJsonArray<string>(row.assigned_employee_names),
        description: str(row.description),
        priority: str(row.priority || 'متوسط'),
        status: str(row.status || 'جديدة'),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at)
      };
      await enqueueSyncOperation(executor, {
        entityType: 'Problem',
        entityId: prbObj.id,
        recordId: prbObj.id,
        operation: 'UPDATE',
        action: 'upsertProblem',
        payload: prbObj,
        idempotencyKey: `DELTA:Problem:${prbObj.id}:${prbObj.updatedAt}`
      });
      enqueuedMissed++;
    }
  } catch {
    // Non-fatal if tables are not yet migrated in mocks
  }

  // 2) Flush due outbox items (pending + exponential backoff retries)
  const flushResult = await flushSyncQueue(executor, fetchFn, { batchSize: 50 });

  // 3) Optional Rental Gate delta pull when requested & configured
  let rgPull: SyncIngestResult | null = null;
  if (options.pullRentalGate && process.env.RG_TOKEN) {
    try {
      rgPull = await pullFromRentalGateDirect(executor, actor, { preset: '3d', maxPages: 5 }, fetchFn);
    } catch {
      // Logged in pullFromRentalGateDirect
    }
  }

  const finishedAt = new Date().toISOString();
  await executor.query(
    `INSERT INTO sync_checkpoints (
       source, last_sync_at, last_successful_at, last_cursor, last_batch_count,
       last_status, last_error, meta, updated_at
     ) VALUES ('backup_delta_sync',$1::timestamptz,$1::timestamptz,$2,$3,$4,$5,$6::jsonb,$1::timestamptz)
     ON CONFLICT (source) DO UPDATE SET
       last_sync_at = EXCLUDED.last_sync_at,
       last_successful_at = CASE WHEN EXCLUDED.last_status = 'success' THEN EXCLUDED.last_sync_at ELSE sync_checkpoints.last_successful_at END,
       last_cursor = EXCLUDED.last_cursor,
       last_batch_count = EXCLUDED.last_batch_count,
       last_status = EXCLUDED.last_status,
       last_error = EXCLUDED.last_error,
       meta = EXCLUDED.meta,
       updated_at = EXCLUDED.updated_at`,
    [
      finishedAt,
      startedAt,
      enqueuedMissed + flushResult.synced,
      flushResult.failed > 0 && flushResult.synced === 0 ? 'error' : 'success',
      str(flushResult.reason),
      JSON.stringify({ enqueuedMissed, flushResult, rgPull: rgPull ? { importedCount: rgPull.importedCount, updatedCount: rgPull.updatedCount } : null })
    ]
  ).catch(() => undefined);

  return {
    startedAt,
    finishedAt,
    enqueuedMissed,
    flushResult,
    rgPull
  };
}

export async function pullFromRentalGateDirect(
  executor: DbExecutor,
  actor: SyncActor,
  payload: Record<string, any> = {},
  fetchFn: typeof fetch = fetch
): Promise<SyncIngestResult> {
  const rgToken = str(process.env.RG_TOKEN).replace(/^Bearer\s+/i, '');
  if (!rgToken) {
    throw new Error('NO_RG_TOKEN: متغير RG_TOKEN غير مضبوط على الخادم.');
  }

  const baseApi = str(process.env.RG_API_BASE_URL || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
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
      const rawText = await resp.text();
      let json: any = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        throw new Error(`RG_API_INVALID_JSON (HTTP ${resp.status}): تعذر قراءة بيانات Rental Gate API.`);
      }
      if (!json || typeof json !== 'object') {
        throw new Error(`RG_API_EMPTY_RESPONSE (HTTP ${resp.status}): أعادت واجهة Rental Gate استجابة فارغة.`);
      }
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

  return ingestIncrementalSyncBatch(executor, {
    source: 'rental_gate_direct',
    actor,
    pagesFetched: resPaged.pages + extPaged.pages,
    appliedRange,
    reservations: filteredRes,
    extensions: dedupedExt
  });
}
