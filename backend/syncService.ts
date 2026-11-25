import { crmCore, generateId, parseJsonArray } from './auth.js';
import { invalidateAndBumpVersion } from './cache.js';
import type { DbClient, DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { broadcastCrmEvent } from './realtime.js';
import { resolveServerConfig } from './serverConfig.js';

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
  isFullSnapshot?: boolean;
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
  fetchedCount?: number;
  excludedFilteredCount?: number;
  rangeFilteredCount?: number;
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
    companyNumber: str(row.company_number ?? row.companyNumber),
    newCompanyName: str(row.new_company_name ?? row.newCompanyName),
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
    rejectionReason: str(row.rejection_reason ?? row.rejectionReason),
    carStatusAtRequest: str(row.car_status_at_request ?? row.carStatusAtRequest),
    refundAmount: num(row.refund_amount ?? row.refundAmount, 0),
    rejectedById: str(row.rejected_by_id ?? row.rejectedById),
    rejectedByName: str(row.rejected_by_name ?? row.rejectedByName),
    rejectedAt: str(row.rejected_at ?? row.rejectedAt),
    cancellationReason: str(row.cancellation_reason ?? row.cancellationReason),
    cancelledById: str(row.cancelled_by_id ?? row.cancelledById),
    cancelledByName: str(row.cancelled_by_name ?? row.cancelledByName),
    cancelledAt: str(row.cancelled_at ?? row.cancelledAt),
    pinnedNote: str(row.pinned_note ?? row.pinnedNote),
    pinnedNoteById: str(row.pinned_note_by_id ?? row.pinnedNoteById),
    pinnedNoteByName: str(row.pinned_note_by_name ?? row.pinnedNoteByName),
    pinnedNoteUpdatedAt: str(row.pinned_note_updated_at ?? row.pinnedNoteUpdatedAt),
    noAnswerCount: Math.max(0, Math.floor(num(row.no_answer_count ?? row.noAnswerCount, 0))),
    isFollowed: row.is_followed !== undefined ? Boolean(row.is_followed) : Boolean(row.isFollowed),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at ?? row.createdAt),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at ?? row.updatedAt),
    sourceOrder: (row.source_order !== null && row.source_order !== undefined && Number(row.source_order) > 0)
      ? Math.floor(Number(row.source_order))
      : ((row.sourceOrder !== null && row.sourceOrder !== undefined && Number(row.sourceOrder) > 0)
          ? Math.floor(Number(row.sourceOrder))
          : null),
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
  const rawResId = str(raw.reservationId);
  const matchedResId = str(
    resIdLookup.get(resNum) ||
    resIdLookup.get(srcResId) ||
    resIdLookup.get(rawResId) ||
    ''
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
  nowIso: string,
  seqFallback = 0
): { record: Record<string, any>; followUpHistoryEntry: Record<string, any> | null } {
  const isNormalizedCrmShape = Boolean(raw.reservationNumber && raw.customerName !== undefined && raw.originalStatusCode !== undefined);
  const srcResId = str(crmCore.extractSourceReservationId(raw));
  const resNumber = str(crmCore.extractReservationNumber(raw) || srcResId);
  const resId = existingClient?.id || (str(raw.id).startsWith('RES_') ? str(raw.id) : `RES_${resNumber.replace(/[^A-Za-z0-9_-]/g, '')}`);

  const rawCode = str(crmCore.extractReservationStatusCode(raw, true));
  const translatedOrigAr = crmCore.translateOriginalStatus(rawCode);
  const sourceStatusAr = (translatedOrigAr && translatedOrigAr !== 'غير محدد')
    ? translatedOrigAr
    : (str(raw.originalStatusAr || raw.statusAr) || rawCode || 'قيد الانتظار');

  // If payload comes from normalized CRM/GAS record, preserve precomputed fields cleanly;
  // if payload comes directly from Rental Gate API, compute via shared crmCore.mergeSyncedReservation.
  let merged: Record<string, any>;
  if (isNormalizedCrmShape) {
    merged = {
      ...raw,
      id: resId,
      sourceReservationId: srcResId || resNumber,
      reservationNumber: resNumber,
      originalStatusCode: rawCode,
      originalStatusAr: sourceStatusAr
    };
  } else {
    merged = crmCore.mergeSyncedReservation(existingClient, raw, relatedExts, actor);
    merged.id = resId;
    merged.sourceReservationId = srcResId || resNumber;
    merged.reservationNumber = resNumber;
    merged.originalStatusAr = sourceStatusAr;
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

    const existingLifecycle = crmCore.getReservationLifecycleKind(existingClient);
    const incomingLifecycle = crmCore.getReservationLifecycleKind({
      internalStatus: sourceStatusAr,
      originalStatusCode: rawCode,
      originalStatusAr: sourceStatusAr
    });

    const sourceChanged = Boolean(
      (rawCode && (
        (prevCode && rawCode !== prevCode) ||
        (!prevCode && prevOrigAr && sourceStatusAr !== prevOrigAr)
      )) ||
      (incomingLifecycle !== existingLifecycle) ||
      (!rawCode && prevOrigAr && sourceStatusAr && sourceStatusAr !== prevOrigAr)
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
    } else if (crmCore.shouldAutoReconcileSyncedStatus(existingClient, sourceStatusAr)) {
      // Reconcile stale auto-synced statuses (without overriding genuine manual employee follow-ups)
      nextInternalStatus = sourceStatusAr;
      nextLastUpdateText = `تم السحب من Rental Gate بالحالة: ${sourceStatusAr}`;
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
        note: `تصحيح تلقائي للحالة وفق موقع Rental Gate: ${sourceStatusAr}`
      });
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

  const explicitOrder = num(raw.sourceOrder ?? raw.__sourceOrder ?? raw.source_order, 0);
  const prevOrder = existingClient ? num(existingClient.sourceOrder, 0) : 0;
  const resolvedSourceOrder: number | null =
    explicitOrder > 0
      ? Math.floor(explicitOrder)
      : (prevOrder > 0 ? Math.floor(prevOrder) : (seqFallback > 0 ? Math.floor(seqFallback) : null));

  const finalLifecycle = crmCore.getReservationLifecycleKind({
    originalStatusCode: rawCode,
    originalStatusAr: sourceStatusAr,
    internalStatus: nextInternalStatus
  });
  const isRejectedRes = finalLifecycle === 'rejected';
  const isCancelledRes = finalLifecycle === 'cancelled';

  const record: Record<string, any> = {
    id: resId,
    sourceReservationId: srcResId,
    reservationNumber: resNumber,
    sourceCreatedAt: str(merged.sourceCreatedAt),
    customerName: str(merged.customerName || 'عميل'),
    customerPhone: str(merged.customerPhone),
    customerEmail: str(merged.customerEmail || existingClient?.customerEmail),
    customerIdNumber: (typeof crmCore.extractCustomerNationalId === 'function' ? crmCore.extractCustomerNationalId(raw, existingClient) : '') || str(merged.customerIdNumber),
    companyName: str(merged.companyName),
    companyNumber: str(existingClient?.companyNumber || merged.companyNumber || raw.companyNumber || raw.company_number || raw.companyCode || ''),
    newCompanyName: isRejectedRes ? str(merged.newCompanyName || raw.newCompanyName || existingClient?.newCompanyName || '') : '',
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
    rejectionReason: isRejectedRes ? str(merged.rejectionReason || raw.rejectionReason || raw.rejectReason || existingClient?.rejectionReason || '') : '',
    carStatusAtRequest: isRejectedRes ? str(merged.carStatusAtRequest || raw.carStatusAtRequest || existingClient?.carStatusAtRequest || '') : '',
    refundAmount: isRejectedRes
      ? (existingClient && existingClient.refundAmount !== undefined && Number(existingClient.refundAmount) > 0
        ? num(existingClient.refundAmount, 0)
        : num(merged.refundAmount ?? raw.refundAmount, 0))
      : 0,
    rejectedById: isRejectedRes ? str(existingClient?.rejectedById || merged.rejectedById || actor.id) : '',
    rejectedByName: isRejectedRes ? str(existingClient?.rejectedByName || merged.rejectedByName || actor.name) : '',
    rejectedAt: isRejectedRes ? str(merged.rejectedAt || existingClient?.rejectedAt || nowIso) : '',
    cancellationReason: isCancelledRes ? str(merged.cancellationReason || raw.cancellationReason || raw.cancelReason || existingClient?.cancellationReason || '') : '',
    cancelledById: isCancelledRes ? str(existingClient?.cancelledById || merged.cancelledById || actor.id) : '',
    cancelledByName: isCancelledRes ? str(existingClient?.cancelledByName || merged.cancelledByName || actor.name) : '',
    cancelledAt: isCancelledRes ? str(merged.cancelledAt || existingClient?.cancelledAt || nowIso) : '',
    createdAt: existingClient?.createdAt || str(merged.createdAt) || nowIso,
    updatedAt: nowIso,
    sourceOrder: resolvedSourceOrder,
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
      const lookupNums = Array.from(new Set([
        ...incomingRes.map((r) => str(crmCore.extractReservationNumber(r))),
        ...incomingRes.map((r) => str(crmCore.extractSourceReservationId(r))),
        ...incomingExt.map((e) => str(e.reservationNumber || e.reservation_number || e.reservationId)),
        ...incomingExt.map((e) => str(e.sourceReservationId || e.reservationId))
      ].filter(Boolean)));
      const lookupIds = Array.from(new Set([
        ...incomingRes.map((r) => str(r.id)),
        ...incomingExt.map((e) => str(e.reservationId))
      ].filter((id) => id && id.startsWith('RES_'))));

      const existingResRes = (lookupNums.length > 0 || lookupIds.length > 0)
        ? await tx.query(
            `SELECT * FROM reservations
             WHERE reservation_number = ANY($1::text[])
                OR source_reservation_id = ANY($1::text[])
                OR id = ANY($2::text[])`,
            [lookupNums, lookupIds]
          )
        : { rows: [] };

      const existingByNumber = new Map<string, Record<string, any>>();
      const existingBySourceId = new Map<string, Record<string, any>>();
      const existingById = new Map<string, Record<string, any>>();
      const resIdByRef = new Map<string, string>();
      const knownDbResIds = new Set<string>();
      for (const row of existingResRes.rows) {
        const clientObj = mapReservationRowToClient(row);
        if (clientObj.id) {
          knownDbResIds.add(clientObj.id);
          existingById.set(clientObj.id, clientObj);
          resIdByRef.set(clientObj.id, clientObj.id);
        }
        if (clientObj.reservationNumber) {
          existingByNumber.set(clientObj.reservationNumber, clientObj);
          resIdByRef.set(clientObj.reservationNumber, clientObj.id);
        }
        if (clientObj.sourceReservationId) {
          existingBySourceId.set(clientObj.sourceReservationId, clientObj);
          resIdByRef.set(clientObj.sourceReservationId, clientObj.id);
        }
      }

      // Pre-resolve reservation IDs for incoming reservations before linking extensions
      for (const raw of incomingRes) {
        const resNum = str(crmCore.extractReservationNumber(raw));
        if (!resNum) continue;
        const srcId = str(crmCore.extractSourceReservationId(raw) || resNum);
        const existing = existingByNumber.get(resNum) || existingBySourceId.get(srcId) || existingById.get(str(raw.id));
        const resId = existing?.id || (str(raw.id).startsWith('RES_') ? str(raw.id) : `RES_${resNum.replace(/[^A-Za-z0-9_-]/g, '')}`);
        knownDbResIds.add(resId);
        resIdByRef.set(resNum, resId);
        if (srcId) resIdByRef.set(srcId, resId);
        if (str(raw.id)) resIdByRef.set(str(raw.id), resId);
      }

      // Group extensions by reservation number / source ID and deduplicate by extensionNumber for safe batch upsert
      const extsByResKey = new Map<string, any[]>();
      const extDedupMap = new Map<string, Record<string, any>>();
      for (const rawExt of incomingExt) {
        const ext = normalizeIncomingExtension(rawExt, resIdByRef, startedAt);
        if (!ext.extensionNumber) continue;
        extDedupMap.set(ext.extensionNumber, ext);
        if (ext.isAcceptedAndPaid) {
          const keys = Array.from(new Set([ext.reservationNumber, ext.sourceReservationId].filter(Boolean)));
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

      let seqIdx = 0;
      for (const raw of incomingRes) {
        seqIdx++;
        const resNum = str(crmCore.extractReservationNumber(raw));
        if (!resNum) continue;
        const srcId = str(crmCore.extractSourceReservationId(raw) || resNum);
        const existing = existingByNumber.get(resNum) || existingBySourceId.get(srcId) || existingById.get(str(raw.id)) || null;
        if (existing && existing.reservationNumber && existing.reservationNumber !== resNum && !existingByNumber.has(resNum)) {
          await tx.query(
            `UPDATE reservations SET reservation_number = $2 WHERE id = $1`,
            [existing.id, resNum]
          ).catch(() => undefined);
          existingByNumber.delete(existing.reservationNumber);
          existing.reservationNumber = resNum;
          existingByNumber.set(resNum, existing);
        }
        const seenExtNums = new Set<string>();
        const relExts: any[] = [];
        for (const candidate of [...(extsByResKey.get(resNum) || []), ...(srcId && srcId !== resNum ? (extsByResKey.get(srcId) || []) : [])]) {
          if (candidate?.extensionNumber && !seenExtNums.has(candidate.extensionNumber)) {
            seenExtNums.add(candidate.extensionNumber);
            relExts.push(candidate);
          }
        }

        const { record, followUpHistoryEntry } = normalizeIncomingReservation(raw, existing, relExts, actor, startedAt, seqIdx);
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
             has_problem, created_at, updated_at, status_history, raw_json, source_order,
             company_number, new_company_name, rejection_reason, car_status_at_request, refund_amount,
             rejected_by_id, rejected_by_name, rejected_at,
             cancellation_reason, cancelled_by_id, cancelled_by_name, cancelled_at
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
             $48::boolean[], $49::timestamptz[], $50::timestamptz[], $51::jsonb[], $52::text[], $53::int4[],
             $54::text[], $55::text[], $56::text[], $57::text[], $58::numeric[],
             $59::text[], $60::text[], $61::text[],
             $62::text[], $63::text[], $64::text[], $65::text[]
           )
           ON CONFLICT (reservation_number) DO UPDATE SET
             source_reservation_id = EXCLUDED.source_reservation_id,
             source_created_at = EXCLUDED.source_created_at,
             customer_name = EXCLUDED.customer_name,
             customer_phone = EXCLUDED.customer_phone,
             customer_email = COALESCE(NULLIF(EXCLUDED.customer_email, ''), reservations.customer_email),
             customer_id_number = COALESCE(NULLIF(EXCLUDED.customer_id_number, ''), CASE WHEN NULLIF(EXCLUDED.customer_phone, '') IS NOT NULL AND NULLIF(reservations.customer_phone, '') IS NOT NULL AND EXCLUDED.customer_phone <> reservations.customer_phone THEN '' ELSE reservations.customer_id_number END),
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
             raw_json = EXCLUDED.raw_json,
             source_order = COALESCE(EXCLUDED.source_order, reservations.source_order),
             company_number = COALESCE(NULLIF(EXCLUDED.company_number, ''), reservations.company_number),
             new_company_name = EXCLUDED.new_company_name,
             rejection_reason = EXCLUDED.rejection_reason,
             car_status_at_request = EXCLUDED.car_status_at_request,
             refund_amount = EXCLUDED.refund_amount,
             rejected_by_id = EXCLUDED.rejected_by_id,
             rejected_by_name = EXCLUDED.rejected_by_name,
             rejected_at = EXCLUDED.rejected_at,
             cancellation_reason = EXCLUDED.cancellation_reason,
             cancelled_by_id = EXCLUDED.cancelled_by_id,
             cancelled_by_name = EXCLUDED.cancelled_by_name,
             cancelled_at = EXCLUDED.cancelled_at
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
            chunk.map((r) => r.rawJson),
            chunk.map((r) => (r.sourceOrder && Number(r.sourceOrder) > 0 ? Math.floor(Number(r.sourceOrder)) : null)),
            chunk.map((r) => r.companyNumber || ''),
            chunk.map((r) => r.newCompanyName || ''),
            chunk.map((r) => r.rejectionReason || ''),
            chunk.map((r) => r.carStatusAtRequest || ''),
            chunk.map((r) => num(r.refundAmount, 0)),
            chunk.map((r) => r.rejectedById || ''),
            chunk.map((r) => r.rejectedByName || ''),
            chunk.map((r) => r.rejectedAt || ''),
            chunk.map((r) => r.cancellationReason || ''),
            chunk.map((r) => r.cancelledById || ''),
            chunk.map((r) => r.cancelledByName || ''),
            chunk.map((r) => r.cancelledAt || '')
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

      if (payload?.isFullSnapshot === true && reservationBatch.length > 0) {
        const liveResNums = reservationBatch.map((r) => str(r.reservationNumber)).filter(Boolean);
        if (liveResNums.length > 0) {
          await tx.query(
            `UPDATE reservations SET source_order = NULL
             WHERE source_order IS NOT NULL AND reservation_number <> ALL($1::text[])`,
            [liveResNums]
          );
        }
      }

      // Verify exact existing reservation IDs in PostgreSQL before inserting extensions to eliminate FK violations
      if (normalizedExts.length > 0) {
        const extCandidateIds = Array.from(new Set(
          normalizedExts.map((e) => str(e.reservationId)).filter(Boolean)
        ));
        const extCandidateRefs = Array.from(new Set([
          ...normalizedExts.map((e) => str(e.reservationNumber)),
          ...normalizedExts.map((e) => str(e.sourceReservationId))
        ].filter(Boolean)));
        if (extCandidateIds.length > 0 || extCandidateRefs.length > 0) {
          const verifiedResRows = await tx.query<{ id: string; reservation_number: string; source_reservation_id: string }>(
            `SELECT id, reservation_number, source_reservation_id FROM reservations
             WHERE id = ANY($1::text[])
                OR reservation_number = ANY($2::text[])
                OR source_reservation_id = ANY($2::text[])`,
            [extCandidateIds, extCandidateRefs]
          );
          knownDbResIds.clear();
          for (const vr of verifiedResRows.rows) {
            const vid = str(vr.id);
            if (!vid) continue;
            knownDbResIds.add(vid);
            resIdByRef.set(vid, vid);
            if (str(vr.reservation_number)) resIdByRef.set(str(vr.reservation_number), vid);
            if (str(vr.source_reservation_id)) resIdByRef.set(str(vr.source_reservation_id), vid);
          }
        }
      }

      // Backfill any previously orphaned extensions whose parent reservations arrived in this batch
      if (reservationBatch.length > 0) {
        const batchResIds = reservationBatch.map((r) => r.id).filter(Boolean);
        if (batchResIds.length > 0) {
          await tx.query(
            `UPDATE extensions e
             SET reservation_id = r.id
             FROM reservations r
             WHERE e.reservation_id IS NULL
               AND r.id = ANY($1::text[])
               AND (
                 (e.reservation_number <> '' AND e.reservation_number = r.reservation_number)
                 OR (e.source_reservation_id <> '' AND e.source_reservation_id = r.source_reservation_id)
               )`,
            [batchResIds]
          ).catch(() => undefined);
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
            extChunk.map((ext) => {
              const cand = str(
                resIdByRef.get(ext.reservationNumber) ||
                resIdByRef.get(ext.sourceReservationId) ||
                ext.reservationId
              );
              return (cand && knownDbResIds.has(cand)) ? cand : null;
            }),
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
    if (importedCount > 0 || updatedCount > 0 || extensionsCount > 0) {
      const version = await invalidateAndBumpVersion(
        executor,
        ['reservations', 'todayRadar', 'dashboard', 'reports', 'activity', 'sync'],
        true
      ).catch(() => 0);
      broadcastCrmEvent({
        type: 'delta',
        action: 'ingestSyncBatch',
        scopes: ['reservations', 'todayRadar', 'dashboard', 'reports', 'sync'],
        entityIds: changedReservations.map((r: any) => str(r?.id)).filter(Boolean).slice(0, 50),
        actorId: actor.id,
        version: version || undefined,
        at: finishedAt
      });
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

export function extractRentalGatePagePayload(
  json: any,
  pageIndex = 0,
  pageSize = 100
): { rows: any[]; totalPages: number | null; totalElements: number; isLast: boolean; currentPageNum: number | null; nextPageUrl: string } {
  if (!json || typeof json !== 'object') {
    return { rows: [], totalPages: null, totalElements: 0, isLast: true, currentPageNum: null, nextPageUrl: '' };
  }

  if (Array.isArray(json)) {
    return {
      rows: json,
      totalPages: null,
      totalElements: json.length,
      isLast: json.length < pageSize,
      currentPageNum: null,
      nextPageUrl: ''
    };
  }

  const pickRowsFromObj = (obj: any): any[] | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) return obj;
    const candidateKeys = ['content', 'items', 'results', 'reservations', 'extensions', 'records', 'rows', 'list', 'data'];
    for (const k of candidateKeys) {
      if (Array.isArray(obj[k])) return obj[k];
    }
    return null;
  };

  let metaHolder: any = json;
  let rows = pickRowsFromObj(json);

  if (!rows) {
    const nestedContainers = [json.data, json.result, json.payload, json.response, json.body];
    for (const container of nestedContainers) {
      if (container && typeof container === 'object') {
        const nestedRows = pickRowsFromObj(container);
        if (nestedRows) {
          rows = nestedRows;
          metaHolder = container;
          break;
        }
        if (container.data && typeof container.data === 'object') {
          const deepRows = pickRowsFromObj(container.data);
          if (deepRows) {
            rows = deepRows;
            metaHolder = container.data;
            break;
          }
        }
      }
    }
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const rawTotalPages =
    metaHolder?.totalPages ??
    metaHolder?.total_pages ??
    metaHolder?.last_page ??
    metaHolder?.meta?.last_page ??
    metaHolder?.pagination?.last_page ??
    json?.totalPages ??
    json?.total_pages ??
    json?.last_page ??
    json?.meta?.last_page ??
    json?.pagination?.last_page;

  const hasTotalPages = rawTotalPages !== undefined && rawTotalPages !== null && rawTotalPages !== '' && !isNaN(Number(rawTotalPages)) && Number(rawTotalPages) > 0;
  const totalPages: number | null = hasTotalPages ? Math.max(1, Number(rawTotalPages)) : null;

  const rawTotalElements =
    metaHolder?.totalElements ??
    metaHolder?.total ??
    metaHolder?.total_count ??
    metaHolder?.meta?.total ??
    json?.totalElements ??
    json?.total ??
    json?.total_count;
  const totalElements =
    rawTotalElements !== undefined && rawTotalElements !== null && !isNaN(Number(rawTotalElements))
      ? Number(rawTotalElements)
      : safeRows.length;

  const explicitLast =
    metaHolder?.last !== undefined
      ? metaHolder.last
      : (json?.last !== undefined ? json.last : undefined);
  const explicitHasMore =
    metaHolder?.hasMore !== undefined
      ? metaHolder.hasMore
      : (metaHolder?.has_more !== undefined ? metaHolder.has_more : (json?.hasMore ?? json?.has_more));
  const nextPageUrl = str(
    metaHolder?.next_page_url ?? metaHolder?.meta?.next_page_url ?? metaHolder?.links?.next ??
    json?.next_page_url ?? json?.meta?.next_page_url ?? json?.links?.next ?? ''
  );
  const rawCurrentPage =
    metaHolder?.current_page ?? metaHolder?.meta?.current_page ?? metaHolder?.pageNumber ?? metaHolder?.number ??
    json?.current_page ?? json?.meta?.current_page ?? json?.pageNumber ?? json?.number;
  const hasCurrentPage = rawCurrentPage !== undefined && rawCurrentPage !== null && rawCurrentPage !== '' && !isNaN(Number(rawCurrentPage));
  const currentPageNum = hasCurrentPage ? Number(rawCurrentPage) : null;
  const serverPageSize = Number(
    metaHolder?.size ?? metaHolder?.per_page ?? metaHolder?.pageSize ?? metaHolder?.meta?.per_page ??
    json?.size ?? json?.per_page ?? json?.pageSize ?? pageSize
  );
  const effectivePageSize = isFinite(serverPageSize) && serverPageSize > 0 ? serverPageSize : pageSize;

  let isLast: boolean;
  if (safeRows.length === 0) {
    isLast = true;
  } else if (explicitLast === true || explicitHasMore === false) {
    isLast = true;
  } else if (nextPageUrl) {
    isLast = false;
  } else if (totalPages !== null) {
    const isOneBasedCurrent = currentPageNum !== null && currentPageNum >= 1 && (pageIndex === 0 ? currentPageNum === 1 : true) &&
      (metaHolder?.current_page !== undefined || metaHolder?.last_page !== undefined || json?.current_page !== undefined || json?.last_page !== undefined);
    if (isOneBasedCurrent) {
      isLast = currentPageNum >= totalPages;
    } else {
      isLast = pageIndex + 1 >= totalPages;
    }
  } else if (explicitLast === false || explicitHasMore === true) {
    isLast = false;
  } else if (rawTotalElements !== undefined && rawTotalElements !== null && Number(rawTotalElements) > effectivePageSize) {
    isLast = (pageIndex + 1) * effectivePageSize >= Number(rawTotalElements);
  } else {
    isLast = safeRows.length < effectivePageSize;
  }

  return {
    rows: safeRows,
    totalPages,
    totalElements,
    isLast,
    currentPageNum,
    nextPageUrl
  };
}

const NEVER_EXCLUDE_LIFECYCLE_STATUSES = new Set([
  'cancelled',
  'canceled',
  'declined',
  'rejected',
  'refused',
  'ملغي',
  'ملغى',
  'ملغاة',
  'تم الإلغاء',
  'تم الالغاء',
  'مرفوض',
  'مرفوضة',
  'تم الرفض'
]);

export function sanitizeExcludedStatusesList(rawList: unknown): string[] {
  const arr = Array.isArray(rawList) ? rawList : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const val of arr) {
    const cleaned = str(val).toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    if (NEVER_EXCLUDE_LIFECYCLE_STATUSES.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
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
  const maxPages = Math.min(250, Math.max(1, num(payload?.maxPages, 100)));

  const fetchPaged = async (endpoint: string, optional = false) => {
    const items: any[] = [];
    const seenKeys = new Set<string>();
    let pages = 0;
    let oneBasedOffset = 0;
    for (let step = 0; step < maxPages; step++) {
      const pageParam = step + oneBasedOffset;
      const resp = await fetchFn(`${baseApi}/${endpoint}?page=${pageParam}&size=${pageSize}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${rgToken}`,
          Accept: 'application/json',
          lang: 'ar'
        }
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        if (optional && resp.status !== 401 && resp.status !== 403) {
          return { items, pages };
        }
        throw new Error(`RG_API_HTTP_${resp.status}: ${errBody.slice(0, 200)}`);
      }
      const json: any = await resp.json();
      if (json && typeof json === 'object' && !Array.isArray(json) && json.success === false && !json.data && !json.content && !json.items) {
        if (optional) return { items, pages };
        throw new Error(str(json.message || json.error || 'RG_API_ERROR: رفضت واجهة Rental Gate الطلب.'));
      }
      pages++;
      const parsedPage = extractRentalGatePagePayload(json, pageParam, pageSize);
      // Detect 1-based pagination APIs (e.g. ?page=0 returned current_page=1) so ?page=1 doesn't repeat page 1
      if (step === 0 && parsedPage.currentPageNum === 1 && !parsedPage.isLast) {
        oneBasedOffset = 1;
      }
      let added = 0;
      for (const row of parsedPage.rows) {
        const rowKey = str(
          row?.extendId ||
          row?.extensionNumber ||
          row?.extension_number ||
          crmCore.extractReservationNumber(row) ||
          crmCore.extractSourceReservationId(row)
        );
        if (rowKey) {
          if (seenKeys.has(rowKey)) continue;
          seenKeys.add(rowKey);
        }
        items.push(row);
        added++;
      }
      const hasMoreByTotal = parsedPage.totalElements > 0 && items.length < parsedPage.totalElements && parsedPage.rows.length > 0;
      if ((parsedPage.isLast && !hasMoreByTotal) || (parsedPage.rows.length > 0 && added === 0)) break;
    }
    return { items, pages };
  };

  const [resPaged, extPaged] = await Promise.all([
    fetchPaged('reservations/filter', false),
    fetchPaged('reservation-extends/filter', true)
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
  const excludedSet = new Set(sanitizeExcludedStatusesList(excludedStatuses));

  const dedupedAllRes = crmCore.dedupeReservationsByNumber(resPaged.items).map((item: any, idx: number) => ({
    ...item,
    __sourceOrder: idx + 1
  }));
  const existingCheckNums = dedupedAllRes
    .filter((item: any) => excludedSet.has(str(item.reservationStatus || item.status || item.status_code).toLowerCase()))
    .map((item: any) => str(crmCore.extractReservationNumber(item)))
    .filter(Boolean);
  let existingNumsSet = new Set<string>();
  if (existingCheckNums.length > 0) {
    const existRows = await executor.query<{ reservation_number: string }>(
      `SELECT reservation_number FROM reservations WHERE reservation_number = ANY($1::text[])`,
      [existingCheckNums]
    ).catch(() => ({ rows: [] }));
    existingNumsSet = new Set((existRows.rows || []).map((r: any) => str(r.reservation_number)).filter(Boolean));
  }
  const afterExcludedRes = dedupedAllRes.filter((item: any) => {
    const code = str(item.reservationStatus || item.status || item.status_code).toLowerCase();
    if (!excludedSet.has(code)) return true;
    const numKey = str(crmCore.extractReservationNumber(item));
    return existingNumsSet.has(numKey);
  });
  const excludedFilteredCount = dedupedAllRes.length - afterExcludedRes.length;

  const filteredRes = appliedRange?.hasCustomRange
    ? crmCore.filterSourceReservationsByPullRange(afterExcludedRes, appliedRange)
    : afterExcludedRes;
  const rangeFilteredCount = afterExcludedRes.length - filteredRes.length;

  const dedupedExt = crmCore.dedupeExtensionsByNumber(extPaged.items);

  const syncResult = await ingestIncrementalSyncBatch(executor, {
    source: 'rental_gate_direct',
    actor,
    pagesFetched: resPaged.pages + extPaged.pages,
    appliedRange,
    isFullSnapshot: !appliedRange?.hasCustomRange,
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

  return {
    ...syncResult,
    fetchedCount: resPaged.items.length,
    excludedFilteredCount,
    rangeFilteredCount
  };
}
