import { crmCore, generateId, parseJsonArray } from './auth.js';
import {
  computeNextScheduledRunAt,
  deriveWorkerStatus,
  normalizeAutoSyncConfig
} from './autoSyncLogic.js';
import { invalidateAndBumpVersion } from './cache.js';
import type { DbClient, DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { broadcastCrmEvent, publishPgNotify } from './realtime.js';
import { resolveServerConfig } from './serverConfig.js';
import { upsertCustomersFromReservationsTx } from './customerHelpers.js';

export interface SyncActor {
  id: string;
  name: string;
  role?: string;
}

export interface SyncFailedRecord {
  identifier: string;
  sourceReservationId?: string;
  reservationNumber?: string;
  entityType: 'reservation' | 'extension' | 'backfill';
  stage: 'normalize' | 'upsert' | 'backfill' | 'verify';
  reason: string;
}

export interface SyncSourceBreakdown {
  uniqueSourceTotal: number;
  activeOrOtherCount: number;
  cancelledListCount: number;
  rejectedListCount: number;
  effectiveCancelledCount?: number;
  effectiveRejectedCount?: number;
  sourceEligibleCount?: number;
  grossAcrossThreeLists: number;
  dualCancelledRejectedCount: number;
  reassignedActiveCount: number;
  overlapCount: number;
  excludedFilteredCount: number;
  rangeFilteredCount: number;
  extensionsTotalCount: number;
}

export interface SyncReconciliationReport {
  totalInSource: number;
  fetchedCount: number;
  uniqueSourceCount: number;
  savedOrUpdatedCount: number;
  importedCount: number;
  updatedCount: number;
  dbTotalReservations: number;
  sourceEligibleCount: number;
  dbEligibleCount: number;
  eligibleCountGap: number;
  missingEligibleIds: string[];
  extraEligibleDbIds: string[];
  duplicateHandledCount: number;
  excludedFilteredCount: number;
  excludedSourceIds: string[];
  rangeFilteredCount: number;
  failedCount: number;
  failedRecords: SyncFailedRecord[];
  missingLocalCount: number;
  missingSourceIds: string[];
  incompleteEndpoints: string[];
  backfillFailedIds: string[];
  unfetchedSourceGap: number;
  syncComplete: boolean;
  verifiedAt: string;
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
  isRetryPass?: boolean;
  cancelledAuthoritativeSynced?: boolean;
  rejectedAuthoritativeSynced?: boolean;
  cancelledSourceIds?: string[];
  rejectedSourceIds?: string[];
  expectedSourceIds?: string[];
  expectedEligibleSourceIds?: string[];
  sourceEligibleCount?: number;
  excludedSourceIds?: string[];
  totalInSource?: number;
  incompleteEndpoints?: string[];
  backfillFailedIds?: string[];
  sourceBreakdown?: SyncSourceBreakdown;
  excludedFilteredCount?: number;
  rangeFilteredCount?: number;
  duplicateSourceRowsSkipped?: number;
}

export interface SyncIngestResult {
  syncId: string;
  status: 'success' | 'partial' | 'error';
  syncComplete: boolean;
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
  totalInSource: number;
  savedOrUpdatedCount: number;
  dbTotalReservations: number;
  sourceEligibleCount: number;
  dbEligibleCount: number;
  eligibleCountGap: number;
  missingEligibleIds: string[];
  extraEligibleDbIds: string[];
  duplicateHandledCount: number;
  failedCount: number;
  failedRecords: SyncFailedRecord[];
  missingLocalCount: number;
  missingSourceIds: string[];
  incompleteEndpoints: string[];
  backfillFailedIds: string[];
  unfetchedSourceGap: number;
  excludedSourceIds?: string[];
  reconciliation: SyncReconciliationReport;
  sourceBreakdown?: SyncSourceBreakdown;
  excludedFilteredCount?: number;
  rangeFilteredCount?: number;
  missingNationalIdCount?: number;
  missingNationalIdReservations?: string[];
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
    referenceNumber: str(row.reference_number ?? row.referenceNumber),
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
    paidAmount: num(row.paid_amount ?? row.paidAmount, 0),
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
    rejectionReason: (() => {
      const clean = crmCore.sanitizeReasonText(row.rejection_reason ?? row.rejectionReason);
      if (clean) return clean;
      const rawText = str(row.raw_json ?? row.rawJson);
      if (rawText.startsWith('{')) {
        try {
          return crmCore.extractRejectionReason(JSON.parse(rawText), null);
        } catch {
          return '';
        }
      }
      return '';
    })(),
    carStatusAtRequest: crmCore.sanitizeReasonText(row.car_status_at_request ?? row.carStatusAtRequest),
    refundAmount: num(row.refund_amount ?? row.refundAmount, 0),
    rejectedById: str(row.rejected_by_id ?? row.rejectedById),
    rejectedByName: str(row.rejected_by_name ?? row.rejectedByName),
    rejectedAt: str(row.rejected_at ?? row.rejectedAt),
    cancellationReason: (() => {
      const clean = crmCore.sanitizeReasonText(row.cancellation_reason ?? row.cancellationReason);
      if (clean) return clean;
      const rawText = str(row.raw_json ?? row.rawJson);
      if (rawText.startsWith('{')) {
        try {
          return crmCore.extractCancellationReason(JSON.parse(rawText), null);
        } catch {
          return '';
        }
      }
      return '';
    })(),
    cancelledById: str(row.cancelled_by_id ?? row.cancelledById),
    cancelledByName: str(row.cancelled_by_name ?? row.cancelledByName),
    cancelledAt: str(row.cancelled_at ?? row.cancelledAt),
    deliveryFailureReason: crmCore.sanitizeReasonText(row.delivery_failure_reason ?? row.deliveryFailureReason),
    driverNotes: crmCore.sanitizeReasonText(row.driver_notes ?? row.driverNotes),
    isSourceCancelled: (row.is_source_cancelled === null || row.is_source_cancelled === undefined)
      ? (typeof row.isSourceCancelled === 'boolean' ? row.isSourceCancelled : null)
      : Boolean(row.is_source_cancelled),
    isSourceRejected: (row.is_source_rejected === null || row.is_source_rejected === undefined)
      ? (typeof row.isSourceRejected === 'boolean' ? row.isSourceRejected : null)
      : Boolean(row.is_source_rejected),
    rccStatus: str(row.rcc_status ?? row.rccStatus),
    rccReason: str(row.rcc_reason ?? row.rccReason),
    cancelledFromDecline: boolVal(row.cancelled_from_decline ?? row.cancelledFromDecline),
    cancelledFromHold: boolVal(row.cancelled_from_hold ?? row.cancelledFromHold),
    penaltyAmount: num(row.penalty_amount ?? row.penaltyAmount, 0),
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

  const rawRejFlag: boolean | null = typeof raw.isSourceRejected === 'boolean'
    ? raw.isSourceRejected
    : (typeof merged.isSourceRejected === 'boolean'
      ? merged.isSourceRejected
      : (typeof existingClient?.isSourceRejected === 'boolean' ? existingClient.isSourceRejected : null));
  const rawCanFlag: boolean | null = typeof raw.isSourceCancelled === 'boolean'
    ? raw.isSourceCancelled
    : (typeof merged.isSourceCancelled === 'boolean'
      ? merged.isSourceCancelled
      : (typeof existingClient?.isSourceCancelled === 'boolean' ? existingClient.isSourceCancelled : null));

  const extIsRejected = crmCore.isRejectedToken(rawCode) || crmCore.isRejectedToken(sourceStatusAr);
  const extIsCancelled = !extIsRejected && (crmCore.isCancelledToken(rawCode) || crmCore.isCancelledToken(sourceStatusAr));
  const extIsExplicitActive = !extIsRejected && !extIsCancelled && (
    crmCore.isExplicitActiveStatusToken(rawCode) || crmCore.isExplicitActiveStatusToken(sourceStatusAr)
  );

  let resolvedIsSourceRejected: boolean | null = rawRejFlag;
  let resolvedIsSourceCancelled: boolean | null = rawCanFlag;
  if (extIsExplicitActive) {
    resolvedIsSourceCancelled = false;
    resolvedIsSourceRejected = false;
  } else if (extIsRejected) {
    resolvedIsSourceRejected = true;
    resolvedIsSourceCancelled = false;
  } else if (extIsCancelled) {
    if (rawCanFlag !== true && rawRejFlag === true) {
      resolvedIsSourceCancelled = false;
      resolvedIsSourceRejected = true;
    } else {
      resolvedIsSourceCancelled = true;
      resolvedIsSourceRejected = false;
    }
  } else if (resolvedIsSourceCancelled === true && resolvedIsSourceRejected === true) {
    resolvedIsSourceRejected = false;
  }

  const finalLifecycle = crmCore.classifyReservationLifecycle({
    originalStatusCode: rawCode,
    originalStatusAr: sourceStatusAr,
    internalStatus: nextInternalStatus,
    isSourceCancelled: resolvedIsSourceCancelled,
    isSourceRejected: resolvedIsSourceRejected
  });
  const isRejectedRes = finalLifecycle === 'rejected';
  const isCancelledRes = finalLifecycle === 'cancelled';

  const rawPaidCand = merged.paidAmount !== undefined
    ? merged.paidAmount
    : (raw.paidAmount !== undefined
      ? raw.paidAmount
      : (raw.paid_amount !== undefined ? raw.paid_amount : (raw.amountPaid !== undefined ? raw.amountPaid : raw.amount_paid)));
  const resolvedPayStatus = str(merged.paymentStatus || raw.paymentStatus || raw.paymentResult || existingClient?.paymentStatus);
  const payStatusLower = resolvedPayStatus.toLowerCase();
  const resolvedPaidAmt = (rawPaidCand !== undefined && rawPaidCand !== null && rawPaidCand !== '')
    ? Math.max(0, Math.round(num(rawPaidCand, 0) * 100) / 100)
    : (existingClient && num(existingClient.paidAmount, 0) > 0
      ? Math.round(num(existingClient.paidAmount, 0) * 100) / 100
      : (['paid', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'refunded', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مسترد'].includes(payStatusLower)
        ? totalAmt
        : 0));

  const preservedRccStatus = str(raw.rccStatus ?? merged.rccStatus ?? existingClient?.rccStatus);
  const record: Record<string, any> = {
    id: resId,
    sourceReservationId: srcResId,
    reservationNumber: resNumber,
    referenceNumber: str(
      merged.referenceNumber || raw.referenceNumber || raw.reference_number ||
      raw.refNumber || raw.ref_number || raw.sourceReference || raw.externalReference ||
      raw.orderRef || existingClient?.referenceNumber || srcResId || ''
    ),
    sourceCreatedAt: str(merged.sourceCreatedAt),
    customerName: str(merged.customerName || 'عميل'),
    customerPhone: str(merged.customerPhone),
    customerEmail: str(merged.customerEmail || existingClient?.customerEmail),
    customerIdNumber: (typeof crmCore.extractCustomerNationalId === 'function' ? crmCore.extractCustomerNationalId(raw, existingClient) : '') || str(merged.customerIdNumber),
    companyName: str(merged.companyName),
    companyNumber: str(existingClient?.companyNumber || merged.companyNumber || raw.companyNumber || raw.company_number || raw.companyCode || ''),
    newCompanyName: (isRejectedRes || Boolean(preservedRccStatus))
      ? str(merged.newCompanyName || raw.newCompanyName || raw.new_company_name || raw.transferCompanyName || raw.alternativeCompanyName || existingClient?.newCompanyName || '')
      : '',
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
    paymentStatus: resolvedPayStatus,
    dailyPrice: num(merged.dailyPrice, 0),
    discountAmount: num(merged.discountAmount, 0),
    vatAmount: num(merged.vatAmount, 0),
    baseAmount: baseAmt,
    extensionsCount: extCount,
    extensionsAmount: extAmt,
    totalAmount: totalAmt,
    paidAmount: resolvedPaidAmt,
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
    rejectionReason: isRejectedRes ? (crmCore.sanitizeReasonText(merged.rejectionReason) || crmCore.extractRejectionReason(raw, existingClient)) : '',
    carStatusAtRequest: isRejectedRes ? (crmCore.sanitizeReasonText(merged.carStatusAtRequest || raw.carStatusAtRequest || raw.car_status_at_request) || crmCore.sanitizeReasonText(existingClient?.carStatusAtRequest) || '') : '',
    refundAmount: (isRejectedRes || isCancelledRes)
      ? ((merged.refundAmount !== undefined && num(merged.refundAmount, 0) > 0)
        ? num(merged.refundAmount, 0)
        : (raw.refundAmount !== undefined && num(raw.refundAmount, 0) > 0
          ? num(raw.refundAmount, 0)
          : (raw.refund_amount !== undefined && num(raw.refund_amount, 0) > 0
            ? num(raw.refund_amount, 0)
            : num(existingClient?.refundAmount ?? merged.refundAmount ?? raw.refundAmount ?? raw.refund_amount, 0))))
      : 0,
    rejectedById: isRejectedRes ? str(raw.rejectedById || merged.rejectedById || raw.rejected_by_id || raw.confirmedById || raw.confirmed_by_id || raw.actionById || raw.action_by_id || existingClient?.rejectedById || actor.id) : '',
    rejectedByName: isRejectedRes ? str(raw.rejectedByName || merged.rejectedByName || raw.rejected_by_name || raw.rejectedBy || raw.confirmedByName || raw.confirmed_by_name || raw.confirmedBy || raw.actionByName || raw.action_by_name || raw.actionBy || raw.adminName || existingClient?.rejectedByName || actor.name) : '',
    rejectedAt: isRejectedRes ? str(raw.rejectedAt || merged.rejectedAt || raw.rejected_at || raw.actionAt || existingClient?.rejectedAt || nowIso) : '',
    cancellationReason: isCancelledRes ? (crmCore.sanitizeReasonText(raw.cancellationReason || merged.cancellationReason) || crmCore.extractCancellationReason(raw, existingClient)) : '',
    cancelledById: isCancelledRes ? str(existingClient?.cancelledById || merged.cancelledById || raw.cancelledById || raw.cancelled_by_id || raw.canceled_by_id || raw.actionById || raw.action_by_id || actor.id) : '',
    cancelledByName: isCancelledRes ? str(existingClient?.cancelledByName || merged.cancelledByName || raw.cancelledByName || raw.cancelled_by_name || raw.canceledByName || raw.canceled_by_name || raw.cancelledBy || raw.actionByName || raw.action_by_name || raw.actionBy || actor.name) : '',
    cancelledAt: isCancelledRes ? str(merged.cancelledAt || raw.cancelledAt || raw.cancelled_at || raw.canceledAt || raw.canceled_at || raw.actionAt || existingClient?.cancelledAt || nowIso) : '',
    deliveryFailureReason: crmCore.sanitizeReasonText(merged.deliveryFailureReason || raw.deliveryFailureReason || raw.delivery_failure_reason || raw.failedDeliveryReason || raw.failed_delivery_reason || raw.deliverFailReason || raw.failReason) || crmCore.sanitizeReasonText(existingClient?.deliveryFailureReason) || '',
    driverNotes: crmCore.sanitizeReasonText(merged.driverNotes || raw.driverNotes || raw.driver_notes || raw.driverNote || raw.driver_note || raw.deliveryNotes || raw.delivery_notes || raw.driverComment) || crmCore.sanitizeReasonText(existingClient?.driverNotes) || '',
    isSourceCancelled: resolvedIsSourceCancelled,
    isSourceRejected: resolvedIsSourceRejected,
    rccStatus: str(raw.rccStatus ?? merged.rccStatus ?? existingClient?.rccStatus),
    rccReason: str(raw.rccReason ?? merged.rccReason ?? existingClient?.rccReason),
    cancelledFromDecline: raw.cancelledFromDecline !== undefined ? boolVal(raw.cancelledFromDecline) : boolVal(existingClient?.cancelledFromDecline),
    cancelledFromHold: raw.cancelledFromHold !== undefined ? boolVal(raw.cancelledFromHold) : boolVal(existingClient?.cancelledFromHold),
    penaltyAmount: raw.penaltyAmount !== undefined ? num(raw.penaltyAmount, 0) : num(existingClient?.penaltyAmount, 0),
    createdAt: existingClient?.createdAt || str(merged.createdAt) || nowIso,
    updatedAt: nowIso,
    sourceOrder: resolvedSourceOrder,
    statusHistory: nextStatusHistory,
    rawJson: str(merged.rawJson) || JSON.stringify(raw).slice(0, 24000)
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

async function trySavepoint(tx: DbClient, name: string): Promise<void> {
  try {
    await tx.query(`SAVEPOINT ${name}`);
  } catch {
    // Ignore when executor does not support savepoints
  }
}

async function tryReleaseSavepoint(tx: DbClient, name: string): Promise<void> {
  try {
    await tx.query(`RELEASE SAVEPOINT ${name}`);
  } catch {
    // Ignore when executor does not support savepoints
  }
}

async function tryRollbackToSavepoint(tx: DbClient, name: string): Promise<void> {
  try {
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
  } catch {
    // Ignore when executor does not support savepoints
  }
}

function execReservationUpsertBatch(tx: DbClient, chunk: Record<string, any>[]) {
  return tx.query<{ inserted: boolean }>(
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
       cancellation_reason, cancelled_by_id, cancelled_by_name, cancelled_at,
       reference_number, paid_amount, delivery_failure_reason, driver_notes,
       is_source_cancelled, is_source_rejected, rcc_status, rcc_reason,
       cancelled_from_decline, cancelled_from_hold, penalty_amount
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
       $62::text[], $63::text[], $64::text[], $65::text[],
       $66::text[], $67::numeric[], $68::text[], $69::text[],
       $70::boolean[], $71::boolean[], $72::text[], $73::text[],
       $74::boolean[], $75::boolean[], $76::numeric[]
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
       cancelled_at = EXCLUDED.cancelled_at,
       reference_number = COALESCE(NULLIF(EXCLUDED.reference_number, ''), reservations.reference_number),
       paid_amount = CASE WHEN EXCLUDED.paid_amount > 0 THEN EXCLUDED.paid_amount ELSE reservations.paid_amount END,
       delivery_failure_reason = COALESCE(NULLIF(EXCLUDED.delivery_failure_reason, ''), reservations.delivery_failure_reason),
       driver_notes = COALESCE(NULLIF(EXCLUDED.driver_notes, ''), reservations.driver_notes),
       is_source_cancelled = COALESCE(EXCLUDED.is_source_cancelled, reservations.is_source_cancelled),
       is_source_rejected = COALESCE(EXCLUDED.is_source_rejected, reservations.is_source_rejected),
       rcc_status = COALESCE(NULLIF(EXCLUDED.rcc_status, ''), reservations.rcc_status),
       rcc_reason = COALESCE(NULLIF(EXCLUDED.rcc_reason, ''), reservations.rcc_reason),
       cancelled_from_decline = EXCLUDED.cancelled_from_decline,
       cancelled_from_hold = EXCLUDED.cancelled_from_hold,
       penalty_amount = CASE WHEN EXCLUDED.penalty_amount > 0 THEN EXCLUDED.penalty_amount ELSE reservations.penalty_amount END
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
      chunk.map((r) => r.cancelledAt || ''),
      chunk.map((r) => r.referenceNumber || ''),
      chunk.map((r) => num(r.paidAmount, 0)),
      chunk.map((r) => r.deliveryFailureReason || ''),
      chunk.map((r) => r.driverNotes || ''),
      chunk.map((r) => (typeof r.isSourceCancelled === 'boolean' ? r.isSourceCancelled : null)),
      chunk.map((r) => (typeof r.isSourceRejected === 'boolean' ? r.isSourceRejected : null)),
      chunk.map((r) => r.rccStatus || ''),
      chunk.map((r) => r.rccReason || ''),
      chunk.map((r) => Boolean(r.cancelledFromDecline)),
      chunk.map((r) => Boolean(r.cancelledFromHold)),
      chunk.map((r) => num(r.penaltyAmount, 0))
    ]
  );
}

function execExtensionUpsertBatch(
  tx: DbClient,
  extChunk: Record<string, any>[],
  resIdByRef: Map<string, string>,
  knownDbResIds: Set<string>
) {
  return tx.query(
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
  const incompleteEndpoints = Array.isArray(payload?.incompleteEndpoints)
    ? payload.incompleteEndpoints.map((s) => str(s)).filter(Boolean)
    : [];
  const backfillFailedIds = Array.isArray(payload?.backfillFailedIds)
    ? Array.from(new Set(payload.backfillFailedIds.map((s) => str(s)).filter(Boolean)))
    : [];

  let importedCount = 0;
  let updatedCount = 0;
  let extensionsCount = 0;
  let duplicateHandledCount = num(payload?.duplicateSourceRowsSkipped, 0);
  let dbTotalReservations = 0;
  let sourceEligibleCountOut = 0;
  let dbEligibleCountOut = 0;
  let eligibleCountGapOut = 0;
  let missingEligibleIdsOut: string[] = [];
  let extraEligibleDbIdsOut: string[] = [];
  let unfetchedSourceGap = 0;
  let syncCompleteOut = false;
  let reconciliationOut: SyncReconciliationReport | null = null;
  const changedReservations: any[] = [];
  const mutatedReservations: any[] = [];
  const failedRecords: SyncFailedRecord[] = backfillFailedIds.map((sid) => ({
    identifier: sid,
    sourceReservationId: sid,
    entityType: 'backfill',
    stage: 'backfill',
    reason: 'BACKFILL_DETAIL_FETCH_FAILED'
  }));
  let missingSourceIds: string[] = [];
  const excludedSourceIds = Array.isArray(payload?.excludedSourceIds)
    ? Array.from(new Set(payload.excludedSourceIds.map((s) => str(s)).filter(Boolean)))
    : [];
  const expectedSourceIds = Array.isArray(payload?.expectedSourceIds)
    ? Array.from(new Set(payload.expectedSourceIds.map((s) => str(s)).filter(Boolean)))
    : [];
  const expectedEligibleSourceIds = Array.isArray(payload?.expectedEligibleSourceIds)
    ? Array.from(new Set(payload.expectedEligibleSourceIds.map((s) => str(s)).filter(Boolean)))
    : [];

  try {
    await executor.withTransaction(async (tx) => {
      const normLookupKey = (val: unknown) => str(val).replace(/^#+/, '').trim();
      const lookupNums = Array.from(new Set([
        ...incomingRes.map((r) => str(crmCore.extractReservationNumber(r))),
        ...incomingRes.map((r) => normLookupKey(crmCore.extractReservationNumber(r))),
        ...incomingRes.map((r) => {
          const clean = normLookupKey(crmCore.extractReservationNumber(r));
          return clean ? `#${clean}` : '';
        }),
        ...incomingRes.map((r) => str(crmCore.extractSourceReservationId(r))),
        ...incomingRes.map((r) => normLookupKey(crmCore.extractSourceReservationId(r))),
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
          const cleanResNum = normLookupKey(clientObj.reservationNumber);
          if (cleanResNum && !existingByNumber.has(cleanResNum)) existingByNumber.set(cleanResNum, clientObj);
          resIdByRef.set(clientObj.reservationNumber, clientObj.id);
          if (cleanResNum) resIdByRef.set(cleanResNum, clientObj.id);
        }
        if (clientObj.sourceReservationId) {
          existingBySourceId.set(clientObj.sourceReservationId, clientObj);
          const cleanSrcId = normLookupKey(clientObj.sourceReservationId);
          if (cleanSrcId && !existingBySourceId.has(cleanSrcId)) existingBySourceId.set(cleanSrcId, clientObj);
          resIdByRef.set(clientObj.sourceReservationId, clientObj.id);
          if (cleanSrcId) resIdByRef.set(cleanSrcId, clientObj.id);
        }
      }

      const resolveExistingAndTargetNum = (raw: any) => {
        const extractedNum = str(crmCore.extractReservationNumber(raw));
        const rawSrcId = str(crmCore.extractSourceReservationId(raw));
        const srcId = rawSrcId || extractedNum;
        const cleanSrc = normLookupKey(srcId);
        const cleanNum = normLookupKey(extractedNum);
        const idCand = str(raw?.id);

        // 1) Primary match MUST be by unique sourceReservationId to prevent silent cross-booking overwrites
        let existing: Record<string, any> | null =
          (srcId && existingBySourceId.get(srcId)) ||
          (cleanSrc && existingBySourceId.get(cleanSrc)) ||
          null;
        let targetResNum = extractedNum;

        if (existing) {
          // If rawResNum collides with a different DB row, keep existing/disambiguated number instead of crashing or overwriting
          const numConflict = existingByNumber.get(targetResNum) || (cleanNum ? existingByNumber.get(cleanNum) : null) || null;
          if (numConflict && numConflict.id !== existing.id) {
            const exNum = str(existing.reservationNumber);
            const disambig = `${cleanNum || targetResNum}-${cleanSrc || srcId}`;
            targetResNum = (exNum && (!existingByNumber.has(exNum) || existingByNumber.get(exNum)?.id === existing.id))
              ? exNum
              : disambig;
          }
        } else {
          // 2) Fallback match by reservationNumber or primary key id, strictly checking sourceReservationId compatibility
          const numMatch =
            existingByNumber.get(extractedNum) ||
            (cleanNum ? existingByNumber.get(cleanNum) : null) ||
            (idCand ? existingById.get(idCand) : null) ||
            null;
          if (numMatch) {
            const existingSrc = normLookupKey(numMatch.sourceReservationId);
            if (existingSrc && cleanSrc && existingSrc !== cleanSrc) {
              // Two distinct source bookings share the same display number -> do NOT overwrite! Disambiguate cleanly.
              existing = null;
              const baseNum = cleanNum || extractedNum;
              targetResNum = baseNum.endsWith(`-${cleanSrc}`) ? baseNum : `${baseNum}-${cleanSrc}`;
            } else {
              existing = numMatch;
            }
          }
        }

        return { existing, targetResNum, srcId, rawSrcId };
      };

      const ensureUniqueResId = (candidateId: string, existingId?: string | null, salt?: string): string => {
        if (existingId) return existingId;
        if (candidateId && !knownDbResIds.has(candidateId)) return candidateId;
        const base = candidateId || 'RES_ROW';
        const suffix = str(salt).replace(/[^A-Za-z0-9_-]/g, '');
        if (suffix && !knownDbResIds.has(`${base}_${suffix}`)) {
          return `${base}_${suffix}`;
        }
        let unique = generateId('RES');
        while (knownDbResIds.has(unique)) {
          unique = generateId('RES');
        }
        return unique;
      };

      // Pre-resolve reservation IDs for incoming reservations before linking extensions
      for (const raw of incomingRes) {
        try {
          const resNum = str(crmCore.extractReservationNumber(raw));
          if (!resNum) continue;
          const { existing, targetResNum, srcId } = resolveExistingAndTargetNum(raw);
          const candidateId = existing?.id || (str(raw.id).startsWith('RES_') ? str(raw.id) : `RES_${targetResNum.replace(/[^A-Za-z0-9_-]/g, '')}`);
          const resId = existing?.id || candidateId;
          knownDbResIds.add(resId);
          resIdByRef.set(resNum, resId);
          resIdByRef.set(targetResNum, resId);
          if (srcId) resIdByRef.set(srcId, resId);
          if (str(raw.id)) resIdByRef.set(str(raw.id), resId);
        } catch {
          // Recorded in normalization loop below
        }
      }

      // Group extensions by reservation number / source ID and deduplicate by extensionNumber for safe batch upsert
      const extsByResKey = new Map<string, any[]>();
      const extDedupMap = new Map<string, Record<string, any>>();
      for (let extIdx = 0; extIdx < incomingExt.length; extIdx++) {
        const rawExt = incomingExt[extIdx];
        try {
          const ext = normalizeIncomingExtension(rawExt, resIdByRef, startedAt);
          if (!ext.extensionNumber) {
            failedRecords.push({
              identifier: str(rawExt?.id || rawExt?.extendId || `ext#${extIdx + 1}`),
              entityType: 'extension',
              stage: 'normalize',
              reason: 'MISSING_EXTENSION_NUMBER'
            });
            continue;
          }
          if (extDedupMap.has(ext.extensionNumber)) {
            duplicateHandledCount++;
          }
          extDedupMap.set(ext.extensionNumber, ext);
          if (ext.isAcceptedAndPaid) {
            const keys = Array.from(new Set([ext.reservationNumber, ext.sourceReservationId].filter(Boolean)));
            for (const k of keys) {
              const list = extsByResKey.get(k) || [];
              list.push(ext);
              extsByResKey.set(k, list);
            }
          }
        } catch (extErr: any) {
          failedRecords.push({
            identifier: str(rawExt?.extensionNumber || rawExt?.extendId || rawExt?.id || `ext#${extIdx + 1}`),
            entityType: 'extension',
            stage: 'normalize',
            reason: String(extErr?.message || 'EXTENSION_NORMALIZE_ERROR').slice(0, 240)
          });
        }
      }
      const normalizedExts = Array.from(extDedupMap.values());

      // Normalize and safely deduplicate reservations with per-record error isolation
      const resDedupMap = new Map<string, Record<string, any>>();
      const historyBatch: Record<string, any>[] = [];

      let seqIdx = 0;
      for (const raw of incomingRes) {
        seqIdx++;
        const rawSrcId = str(crmCore.extractSourceReservationId(raw) || raw?.id);
        let rawResNum = '';
        try {
          rawResNum = str(crmCore.extractReservationNumber(raw));
          if (!rawResNum) {
            failedRecords.push({
              identifier: rawSrcId || `row#${seqIdx}`,
              sourceReservationId: rawSrcId || undefined,
              entityType: 'reservation',
              stage: 'normalize',
              reason: 'MISSING_RESERVATION_NUMBER'
            });
            continue;
          }
          const resolved = resolveExistingAndTargetNum(raw);
          const srcId = resolved.srcId;
          const existing = resolved.existing;
          const targetResNum = resolved.targetResNum;

          if (existing && existing.reservationNumber && existing.reservationNumber !== targetResNum && !existingByNumber.has(targetResNum) && !existingByNumber.has(normLookupKey(targetResNum))) {
            await tx.query(
              `UPDATE reservations SET reservation_number = $2 WHERE id = $1`,
              [existing.id, targetResNum]
            ).catch(() => undefined);
            existingByNumber.delete(existing.reservationNumber);
            existingByNumber.delete(normLookupKey(existing.reservationNumber));
            existing.reservationNumber = targetResNum;
            existingByNumber.set(targetResNum, existing);
            existingByNumber.set(normLookupKey(targetResNum), existing);
          }
          const seenExtNums = new Set<string>();
          const relExts: any[] = [];
          for (const candidate of [
            ...(extsByResKey.get(rawResNum) || []),
            ...(targetResNum !== rawResNum ? (extsByResKey.get(targetResNum) || []) : []),
            ...(srcId && srcId !== rawResNum ? (extsByResKey.get(srcId) || []) : [])
          ]) {
            if (candidate?.extensionNumber && !seenExtNums.has(candidate.extensionNumber)) {
              seenExtNums.add(candidate.extensionNumber);
              relExts.push(candidate);
            }
          }

          const { record, followUpHistoryEntry } = normalizeIncomingReservation(raw, existing, relExts, actor, startedAt, seqIdx);
          if (targetResNum && targetResNum !== record.reservationNumber) {
            record.reservationNumber = targetResNum;
            if (!existing) {
              record.id = ensureUniqueResId(`RES_${targetResNum.replace(/[^A-Za-z0-9_-]/g, '')}`, null, srcId);
            }
          } else if (!existing) {
            const ownerOfId = existingById.get(record.id);
            if ((ownerOfId && normLookupKey(ownerOfId.sourceReservationId) !== normLookupKey(srcId)) || knownDbResIds.has(record.id)) {
              const dupOwnerInBatch = Array.from(resDedupMap.values()).find((x) => x.id === record.id && normLookupKey(x.sourceReservationId) !== normLookupKey(srcId));
              if (ownerOfId || dupOwnerInBatch) {
                record.id = ensureUniqueResId(record.id, null, srcId);
              }
            }
          }

          if (!record.reservationNumber) {
            failedRecords.push({
              identifier: srcId || `row#${seqIdx}`,
              sourceReservationId: srcId || undefined,
              entityType: 'reservation',
              stage: 'normalize',
              reason: 'NORMALIZED_EMPTY_RESERVATION_NUMBER'
            });
            continue;
          }

          const dupExisting = resDedupMap.get(record.reservationNumber);
          if (dupExisting) {
            const dupSrc = normLookupKey(dupExisting.sourceReservationId);
            const curSrc = normLookupKey(record.sourceReservationId);
            if (dupSrc && curSrc && dupSrc !== curSrc) {
              // Two genuinely distinct source IDs collided on the same reservationNumber: disambiguate cleanly rather than dropping one!
              let disambigNum = `${record.reservationNumber}-${curSrc}`;
              let attemptIdx = 1;
              while (resDedupMap.has(disambigNum) && normLookupKey(resDedupMap.get(disambigNum)?.sourceReservationId) !== curSrc) {
                attemptIdx++;
                disambigNum = `${record.reservationNumber}-${curSrc}-${attemptIdx}`;
              }
              record.reservationNumber = disambigNum;
              record.id = ensureUniqueResId(`RES_${disambigNum.replace(/[^A-Za-z0-9_-]/g, '')}`, existing?.id, curSrc);
              knownDbResIds.add(record.id);
              resIdByRef.set(curSrc, record.id);
              resIdByRef.set(disambigNum, record.id);
              resDedupMap.set(disambigNum, record);
            } else {
              duplicateHandledCount++;
              const recExtCode = crmCore.extractReservationStatusCode(record, false);
              if (!crmCore.isExplicitActiveStatusToken(recExtCode)) {
                if (dupExisting.isSourceCancelled === true) {
                  record.isSourceCancelled = true;
                  record.isSourceRejected = false;
                } else if (dupExisting.isSourceRejected === true && record.isSourceCancelled !== true) {
                  record.isSourceRejected = true;
                }
              }
              resDedupMap.set(record.reservationNumber, record);
            }
          } else {
            knownDbResIds.add(record.id);
            resDedupMap.set(record.reservationNumber, record);
          }

          if (followUpHistoryEntry) {
            followUpHistoryEntry.reservationId = record.id;
            followUpHistoryEntry.reservationNumber = record.reservationNumber;
            historyBatch.push(followUpHistoryEntry);
          }
        } catch (recErr: any) {
          failedRecords.push({
            identifier: rawSrcId || rawResNum || `row#${seqIdx}`,
            sourceReservationId: rawSrcId || undefined,
            reservationNumber: rawResNum || undefined,
            entityType: 'reservation',
            stage: 'normalize',
            reason: String(recErr?.message || 'NORMALIZE_ERROR').slice(0, 240)
          });
        }
      }

      const reservationBatch = Array.from(resDedupMap.values());
      const successfullyPersistedRes = new Set<string>();

      const recordCommittedReservationChunk = (savedRows: Record<string, any>[], upsertRows: Array<{ inserted?: boolean }>) => {
        for (const row of upsertRows) {
          if (row?.inserted) importedCount++;
          else updatedCount++;
        }
        for (const r of savedRows) {
          successfullyPersistedRes.add(str(r.reservationNumber));
          const { rawJson: _omitRaw, ...clientRes } = r;
          changedReservations.push(clientRes);
          const prev = existingByNumber.get(r.reservationNumber) || (r.sourceReservationId ? existingBySourceId.get(r.sourceReservationId) : undefined);
          const genuinelyChanged =
            !prev ||
            str(prev.originalStatusCode) !== str(r.originalStatusCode) ||
            str(prev.internalStatus) !== str(r.internalStatus) ||
            str(prev.endDate) !== str(r.endDate) ||
            num(prev.extensionsCount, 0) !== num(r.extensionsCount, 0) ||
            num(prev.totalAmount, 0) !== num(r.totalAmount, 0) ||
            prev.isSourceCancelled !== r.isSourceCancelled ||
            prev.isSourceRejected !== r.isSourceRejected;
          if (genuinelyChanged) {
            mutatedReservations.push(clientRes);
          }
        }
      };

      // Chunked UNNEST upserts for Reservations with SAVEPOINT + single-row fallback isolation + safe PK collision retry
      let resChunkIndex = 0;
      for (const chunk of chunkList(reservationBatch, 200)) {
        resChunkIndex++;
        const spChunk = `rg_res_chunk_${resChunkIndex}`;
        await trySavepoint(tx, spChunk);
        try {
          const upsertRes = await execReservationUpsertBatch(tx, chunk);
          await tryReleaseSavepoint(tx, spChunk);
          recordCommittedReservationChunk(chunk, upsertRes.rows);
        } catch {
          await tryRollbackToSavepoint(tx, spChunk);
          for (let rowOffset = 0; rowOffset < chunk.length; rowOffset++) {
            const singleRec = chunk[rowOffset];
            const spRow = `rg_res_row_${resChunkIndex}_${rowOffset}`;
            await trySavepoint(tx, spRow);
            try {
              const singleUpsertRes = await execReservationUpsertBatch(tx, [singleRec]);
              await tryReleaseSavepoint(tx, spRow);
              recordCommittedReservationChunk([singleRec], singleUpsertRes.rows);
            } catch (rowErr: any) {
              await tryRollbackToSavepoint(tx, spRow);
              const errMsg = String(rowErr?.message || 'DB_UPSERT_ERROR');
              let recovered = false;
              if (/reservations_pkey|duplicate key value.*id/i.test(errMsg)) {
                const spRetry = `rg_res_row_retry_${resChunkIndex}_${rowOffset}`;
                await trySavepoint(tx, spRetry);
                try {
                  singleRec.id = generateId('RES');
                  const retryUpsertRes = await execReservationUpsertBatch(tx, [singleRec]);
                  await tryReleaseSavepoint(tx, spRetry);
                  recordCommittedReservationChunk([singleRec], retryUpsertRes.rows);
                  recovered = true;
                } catch {
                  await tryRollbackToSavepoint(tx, spRetry);
                }
              }
              if (!recovered) {
                failedRecords.push({
                  identifier: str(singleRec.sourceReservationId || singleRec.reservationNumber || singleRec.id),
                  sourceReservationId: str(singleRec.sourceReservationId) || undefined,
                  reservationNumber: str(singleRec.reservationNumber) || undefined,
                  entityType: 'reservation',
                  stage: 'upsert',
                  reason: errMsg.slice(0, 240)
                });
              }
            }
          }
        }
      }

      const persistedResList = reservationBatch.filter((r) => successfullyPersistedRes.has(str(r.reservationNumber)));
      if (persistedResList.length > 0) {
        await upsertCustomersFromReservationsTx(tx, persistedResList, {
          source: sourceName,
          overwriteProfileFields: false
        });
      }

      if (payload?.isFullSnapshot === true && reservationBatch.length > 0 && failedRecords.length === 0 && incompleteEndpoints.length === 0) {
        const liveResNums = reservationBatch.map((r) => str(r.reservationNumber)).filter(Boolean);
        if (liveResNums.length > 0) {
          await tx.query(
            `UPDATE reservations SET source_order = NULL
             WHERE source_order IS NOT NULL AND reservation_number <> ALL($1::text[])`,
            [liveResNums]
          );
        }
      }
      if (payload?.isFullSnapshot === true && payload?.cancelledAuthoritativeSynced === true) {
        const canSrcIds = Array.isArray(payload.cancelledSourceIds)
          ? payload.cancelledSourceIds.map((x) => str(x)).filter(Boolean)
          : [];
        if (canSrcIds.length > 0) {
          await tx.query(
            `UPDATE reservations SET is_source_cancelled = FALSE
             WHERE COALESCE(is_source_cancelled, TRUE) <> FALSE
               AND source_reservation_id <> ALL($1::text[])`,
            [canSrcIds]
          );
        }
      }
      if (payload?.isFullSnapshot === true && payload?.rejectedAuthoritativeSynced === true) {
        const rejSrcIds = Array.isArray(payload.rejectedSourceIds)
          ? payload.rejectedSourceIds.map((x) => str(x)).filter(Boolean)
          : [];
        if (rejSrcIds.length > 0) {
          await tx.query(
            `UPDATE reservations SET is_source_rejected = FALSE
             WHERE COALESCE(is_source_rejected, TRUE) <> FALSE
               AND source_reservation_id <> ALL($1::text[])`,
            [rejSrcIds]
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

      // Chunked UNNEST upserts for Extensions with SAVEPOINT + single-row fallback
      let extChunkIndex = 0;
      for (const extChunk of chunkList(normalizedExts, 250)) {
        extChunkIndex++;
        const spExt = `rg_ext_chunk_${extChunkIndex}`;
        await trySavepoint(tx, spExt);
        try {
          await execExtensionUpsertBatch(tx, extChunk, resIdByRef, knownDbResIds);
          await tryReleaseSavepoint(tx, spExt);
          extensionsCount += extChunk.length;
        } catch {
          await tryRollbackToSavepoint(tx, spExt);
          for (let extOffset = 0; extOffset < extChunk.length; extOffset++) {
            const singleExt = extChunk[extOffset];
            const spExtRow = `rg_ext_row_${extChunkIndex}_${extOffset}`;
            await trySavepoint(tx, spExtRow);
            try {
              await execExtensionUpsertBatch(tx, [singleExt], resIdByRef, knownDbResIds);
              await tryReleaseSavepoint(tx, spExtRow);
              extensionsCount++;
            } catch (extRowErr: any) {
              await tryRollbackToSavepoint(tx, spExtRow);
              failedRecords.push({
                identifier: str(singleExt.extensionNumber || singleExt.id),
                sourceReservationId: str(singleExt.sourceReservationId) || undefined,
                reservationNumber: str(singleExt.reservationNumber) || undefined,
                entityType: 'extension',
                stage: 'upsert',
                reason: String(extRowErr?.message || 'EXT_UPSERT_ERROR').slice(0, 240)
              });
            }
          }
        }
      }

      // Chunked UNNEST inserts for FollowUpHistory (only for reservations that actually succeeded)
      const safeHistoryBatch = historyBatch.filter((h) => !h.reservationNumber || successfullyPersistedRes.has(str(h.reservationNumber)));
      for (const hChunk of chunkList(safeHistoryBatch, 250)) {
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

      // Post-upsert DB reconciliation check across all expected source bookings
      const verifyNums = Array.from(new Set(reservationBatch.map((r) => str(r.reservationNumber)).filter(Boolean)));
      const verifySrcIds = Array.from(new Set([
        ...reservationBatch.map((r) => str(r.sourceReservationId || r.reservationNumber)),
        ...backfillFailedIds,
        ...expectedSourceIds
      ].filter(Boolean)));

      const verifiedNums = new Set<string>();
      const verifiedSrcIds = new Set<string>();
      if (verifyNums.length > 0 || verifySrcIds.length > 0) {
        const dbCheck = await tx.query<{ reservation_number: string; source_reservation_id: string }>(
          `SELECT reservation_number, source_reservation_id
           FROM reservations
           WHERE reservation_number = ANY($1::text[])
              OR source_reservation_id = ANY($2::text[])
              OR reservation_number = ANY($2::text[])`,
          [verifyNums, verifySrcIds]
        );
        for (const row of dbCheck.rows) {
          const rn = str(row.reservation_number);
          const sid = str(row.source_reservation_id);
          if (rn) {
            verifiedNums.add(rn);
            verifiedNums.add(normLookupKey(rn));
          }
          if (sid) {
            verifiedSrcIds.add(sid);
            verifiedSrcIds.add(normLookupKey(sid));
          }
        }
      }

      const dbCountRes = await tx.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM reservations`).catch(() => ({ rows: [{ cnt: verifiedNums.size }] }));
      dbTotalReservations = num(dbCountRes.rows?.[0]?.cnt, verifiedNums.size);

      const missingSet = new Set<string>();
      const excludedSrcSet = new Set(excludedSourceIds.map((id) => normLookupKey(id)));
      for (const r of reservationBatch) {
        const rn = str(r.reservationNumber);
        const sid = str(r.sourceReservationId || rn);
        if (!verifiedNums.has(rn) && !verifiedSrcIds.has(sid) && !verifiedSrcIds.has(normLookupKey(sid))) {
          missingSet.add(sid || rn);
        }
      }
      for (const esid of expectedSourceIds) {
        const cleanEsid = normLookupKey(esid);
        if (excludedSrcSet.has(cleanEsid)) continue;
        if (!verifiedSrcIds.has(esid) && !verifiedSrcIds.has(cleanEsid) && !verifiedNums.has(esid) && !verifiedNums.has(cleanEsid)) {
          missingSet.add(esid);
        }
      }
      for (const fr of failedRecords) {
        if (fr.entityType === 'reservation' || fr.entityType === 'backfill') {
          const sid = str(fr.sourceReservationId || fr.reservationNumber || fr.identifier);
          const rn = str(fr.reservationNumber);
          if (sid && !verifiedSrcIds.has(sid) && !verifiedSrcIds.has(normLookupKey(sid)) && (!rn || !verifiedNums.has(rn))) {
            missingSet.add(sid);
          }
        }
      }
      missingSourceIds = Array.from(missingSet);

      const rowIsEligible = (row: any) =>
        crmCore.classifyReservationLifecycle({
          originalStatusCode: row.original_status_code ?? row.originalStatusCode,
          originalStatusAr: row.original_status_ar ?? row.originalStatusAr,
          internalStatus: row.internal_status ?? row.internalStatus,
          isSourceCancelled: row.is_source_cancelled ?? row.isSourceCancelled,
          isSourceRejected: row.is_source_rejected ?? row.isSourceRejected,
          rejectedAt: row.rejected_at ?? row.rejectedAt,
          cancelledAt: row.cancelled_at ?? row.cancelledAt
        }) === 'active';

      const batchActiveCount = reservationBatch.filter((r) => rowIsEligible(r)).length;
      const sourceEligibleCount = payload?.sourceEligibleCount !== undefined
        ? num(payload.sourceEligibleCount, 0)
        : (expectedEligibleSourceIds.length > 0 ? expectedEligibleSourceIds.length : batchActiveCount);

      let dbEligibleCount = 0;
      let missingEligibleIds: string[] = [];
      let extraEligibleDbIds: string[] = [];
      let eligibleCountGap = 0;

      if (payload?.isFullSnapshot === true) {
        const spElig = 'rg_elig_verify';
        await trySavepoint(tx, spElig);
        let dbLifecycleRows: any[] = [];
        try {
          const elRes = await tx.query(
            `SELECT id, reservation_number, source_reservation_id, original_status_code, original_status_ar, internal_status, is_source_cancelled, is_source_rejected, rejected_at, cancelled_at FROM reservations`
          );
          await tryReleaseSavepoint(tx, spElig);
          dbLifecycleRows = Array.isArray(elRes?.rows) ? elRes.rows : [];
        } catch {
          await tryRollbackToSavepoint(tx, spElig);
        }
        if (dbLifecycleRows.length === 0 && (dbTotalReservations > 0 || reservationBatch.length > 0)) {
          const spEligStar = 'rg_elig_verify_star';
          await trySavepoint(tx, spEligStar);
          try {
            const starRes = await tx.query(`SELECT * FROM reservations`);
            await tryReleaseSavepoint(tx, spEligStar);
            if (Array.isArray(starRes?.rows) && starRes.rows.length > 0) {
              dbLifecycleRows = starRes.rows;
            }
          } catch {
            await tryRollbackToSavepoint(tx, spEligStar);
          }
        }
        const effectiveDbRows = dbLifecycleRows.length > 0
          ? dbLifecycleRows
          : reservationBatch.filter((r) => {
              const rn = str(r.reservationNumber);
              const sid = str(r.sourceReservationId || rn);
              return verifiedNums.has(rn) || verifiedSrcIds.has(sid) || verifiedSrcIds.has(normLookupKey(sid));
            });
        const dbEligibleRows = effectiveDbRows.filter(rowIsEligible);
        dbEligibleCount = dbEligibleRows.length;
        const dbEligibleKeySet = new Set<string>();
        for (const r of dbEligibleRows) {
          const sid = str(r.source_reservation_id ?? r.sourceReservationId);
          const rn = str(r.reservation_number ?? r.reservationNumber);
          if (sid) {
            dbEligibleKeySet.add(sid);
            dbEligibleKeySet.add(normLookupKey(sid));
          }
          if (rn) {
            dbEligibleKeySet.add(rn);
            dbEligibleKeySet.add(normLookupKey(rn));
          }
        }
        const expectedEligSourceList = expectedEligibleSourceIds.length > 0
          ? expectedEligibleSourceIds
          : reservationBatch
              .filter(rowIsEligible)
              .map((r) => str(r.sourceReservationId || r.reservationNumber))
              .filter(Boolean);
        missingEligibleIds = expectedEligSourceList.filter((esid) => {
          const clean = normLookupKey(esid);
          if (excludedSrcSet.has(clean)) return false;
          return !dbEligibleKeySet.has(esid) && !dbEligibleKeySet.has(clean);
        });
        if (!payload?.appliedRange?.hasCustomRange) {
          const expectedEligKeySet = new Set<string>();
          for (const esid of expectedEligSourceList) {
            expectedEligKeySet.add(esid);
            expectedEligKeySet.add(normLookupKey(esid));
          }
          extraEligibleDbIds = dbEligibleRows
            .map((r) => str(r.source_reservation_id ?? r.sourceReservationId ?? r.reservation_number ?? r.reservationNumber))
            .filter((k) => k && !expectedEligKeySet.has(k) && !expectedEligKeySet.has(normLookupKey(k)));
          eligibleCountGap = Math.max(Math.abs(sourceEligibleCount - dbEligibleCount), missingEligibleIds.length);
        } else {
          eligibleCountGap = missingEligibleIds.length;
        }
      } else {
        const verifiedBatchActive = reservationBatch.filter((r) => {
          if (!rowIsEligible(r)) return false;
          const rn = str(r.reservationNumber);
          const sid = str(r.sourceReservationId || rn);
          return verifiedNums.has(rn) || verifiedSrcIds.has(sid) || verifiedSrcIds.has(normLookupKey(sid));
        });
        dbEligibleCount = verifiedBatchActive.length;
        eligibleCountGap = Math.max(0, batchActiveCount - dbEligibleCount);
      }

      sourceEligibleCountOut = sourceEligibleCount;
      dbEligibleCountOut = dbEligibleCount;
      eligibleCountGapOut = eligibleCountGap;
      missingEligibleIdsOut = missingEligibleIds;
      extraEligibleDbIdsOut = extraEligibleDbIds;

      const savedOrUpdatedCount = importedCount + updatedCount;
      const excludedCnt = num(payload?.excludedFilteredCount, excludedSourceIds.length);
      const rangeCnt = num(payload?.rangeFilteredCount, 0);
      const totalInSource = num(
        payload?.totalInSource,
        reservationBatch.length + failedRecords.filter((f) => f.entityType !== 'extension').length
      );
      unfetchedSourceGap = (!payload?.isRetryPass && payload?.totalInSource !== undefined)
        ? Math.max(0, totalInSource - (reservationBatch.length + backfillFailedIds.length + excludedCnt + rangeCnt))
        : 0;

      const syncComplete =
        failedRecords.length === 0 &&
        missingSourceIds.length === 0 &&
        incompleteEndpoints.length === 0 &&
        backfillFailedIds.length === 0 &&
        unfetchedSourceGap === 0 &&
        missingEligibleIds.length === 0 &&
        eligibleCountGap === 0;
      syncCompleteOut = syncComplete;
      const finalStatus: 'success' | 'partial' = syncComplete ? 'success' : 'partial';

      const summaryParts: string[] = [];
      if (failedRecords.length > 0) summaryParts.push(`فشل حفظ/معالجة ${failedRecords.length} سجل`);
      if (missingSourceIds.length > 0) summaryParts.push(`سجلات مفقودة بعد التحقق: ${missingSourceIds.length} (${missingSourceIds.slice(0, 8).join(', ')})`);
      if (eligibleCountGap > 0 || missingEligibleIds.length > 0) summaryParts.push(`فرق المستحقة (المصدر ${sourceEligibleCount} / CRM ${dbEligibleCount}): ${eligibleCountGap}${missingEligibleIds.length ? ` [${missingEligibleIds.slice(0, 8).join(', ')}]` : ''}`);
      if (unfetchedSourceGap > 0) summaryParts.push(`نقص غير مجلوب من المصدر: ${unfetchedSourceGap}`);
      if (incompleteEndpoints.length > 0) summaryParts.push(`واجهات غير مكتملة: ${incompleteEndpoints.join(' | ')}`);
      const statusMessage = syncComplete ? '' : summaryParts.join(' · ').slice(0, 500);

      lastSyncBatchMutatedAt = Date.now();

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      await tx.query(
        `INSERT INTO sync_log (
           id, triggered_by_id, triggered_by_name, status, imported_count, updated_count,
           extensions_count, pages_fetched, error_message, duration_ms, started_at, finished_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)`,
        [
          syncId, actor.id, actor.name, finalStatus, importedCount, updatedCount,
          extensionsCount, pagesFetched, statusMessage, durationMs, startedAt, finishedAt
        ]
      );

      const missingIdResNums = reservationBatch
        .filter((r) => !str(r.customerIdNumber))
        .map((r) => str(r.reservationNumber))
        .filter(Boolean);
      const missingNationalIdCount = missingIdResNums.length;
      const missingNationalIdReservations = missingIdResNums.slice(0, 20);

      reconciliationOut = {
        totalInSource,
        fetchedCount: incomingRes.length,
        uniqueSourceCount: reservationBatch.length,
        savedOrUpdatedCount,
        importedCount,
        updatedCount,
        dbTotalReservations,
        sourceEligibleCount,
        dbEligibleCount,
        eligibleCountGap,
        missingEligibleIds: missingEligibleIds.slice(0, 100),
        extraEligibleDbIds: extraEligibleDbIds.slice(0, 100),
        duplicateHandledCount,
        excludedFilteredCount: excludedCnt,
        excludedSourceIds: excludedSourceIds.slice(0, 100),
        rangeFilteredCount: rangeCnt,
        failedCount: failedRecords.length,
        failedRecords: failedRecords.slice(0, 100),
        missingLocalCount: missingSourceIds.length,
        missingSourceIds: missingSourceIds.slice(0, 100),
        incompleteEndpoints,
        backfillFailedIds: backfillFailedIds.slice(0, 100),
        unfetchedSourceGap,
        syncComplete,
        verifiedAt: finishedAt
      };

      await tx.query(
        `INSERT INTO sync_checkpoints (
           source, last_sync_at, last_successful_at, last_cursor, last_batch_count,
           last_status, last_error, meta, updated_at
         ) VALUES ($1,$2::timestamptz,$3::timestamptz,$4,$5,$6,$7,$8::jsonb,$2::timestamptz)
         ON CONFLICT (source) DO UPDATE SET
           last_sync_at = EXCLUDED.last_sync_at,
           last_successful_at = COALESCE(EXCLUDED.last_successful_at, sync_checkpoints.last_successful_at),
           last_cursor = COALESCE(NULLIF(EXCLUDED.last_cursor, ''), sync_checkpoints.last_cursor),
           last_batch_count = EXCLUDED.last_batch_count,
           last_status = EXCLUDED.last_status,
           last_error = EXCLUDED.last_error,
           meta = EXCLUDED.meta,
           updated_at = EXCLUDED.updated_at`,
        [
          sourceName,
          finishedAt,
          syncComplete ? finishedAt : null,
          str(payload?.cursor || ''),
          savedOrUpdatedCount + extensionsCount,
          finalStatus,
          statusMessage,
          JSON.stringify({
            appliedRange: payload?.appliedRange || null,
            importedCount,
            updatedCount,
            extensionsCount,
            totalInSource,
            fetchedCount: incomingRes.length,
            savedOrUpdatedCount,
            dbTotalReservations,
            sourceEligibleCount,
            dbEligibleCount,
            eligibleCountGap,
            missingEligibleIds: missingEligibleIds.slice(0, 100),
            extraEligibleDbIds: extraEligibleDbIds.slice(0, 100),
            duplicateHandledCount,
            excludedFilteredCount: excludedCnt,
            excludedSourceIds: excludedSourceIds.slice(0, 100),
            rangeFilteredCount: rangeCnt,
            failedCount: failedRecords.length,
            failedRecords: failedRecords.slice(0, 100),
            missingLocalCount: missingSourceIds.length,
            missingSourceIds: missingSourceIds.slice(0, 100),
            incompleteEndpoints,
            backfillFailedIds: backfillFailedIds.slice(0, 100),
            unfetchedSourceGap,
            syncComplete,
            sourceBreakdown: payload?.sourceBreakdown || null,
            missingNationalIdCount,
            missingNationalIdReservations
          })
        ]
      );

      if (actor.id !== 'SYSTEM' || (savedOrUpdatedCount + extensionsCount) > 0 || !syncComplete) {
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
            syncComplete
              ? `استيراد ${importedCount}، تحديث ${updatedCount}، تمديدات ${extensionsCount}`
              : `مزامنة غير مكتملة: استيراد ${importedCount}، تحديث ${updatedCount}، مفقود ${missingSourceIds.length}، فرق المستحقة ${eligibleCountGap}، فاشل ${failedRecords.length}${unfetchedSourceGap ? `، فجوة مصدر ${unfetchedSourceGap}` : ''}`,
            finishedAt.slice(0, 10),
            finishedAt.slice(11, 19),
            finishedAt
          ]
        );
      }

      return { missingNationalIdCount, missingNationalIdReservations };
    });

    const finishedAt = new Date().toISOString();
    if (importedCount > 0 || updatedCount > 0 || extensionsCount > 0) {
      const version = await invalidateAndBumpVersion(
        executor,
        ['reservations', 'todayRadar', 'customers', 'dashboard', 'reports', 'employees', 'activity', 'sync'],
        true
      ).catch(() => 0);
      const syncRtEvent = {
        type: 'delta' as const,
        action: 'ingestSyncBatch',
        scopes: ['reservations', 'todayRadar', 'customers', 'dashboard', 'reports', 'employees', 'sync'],
        entityIds: changedReservations.map((r: any) => str(r?.id)).filter(Boolean).slice(0, 50),
        actorId: actor.id,
        version: version || undefined,
        at: finishedAt
      };
      broadcastCrmEvent(syncRtEvent);
      await publishPgNotify(executor, syncRtEvent).catch(() => undefined);
    }
    const missingIdResNumsOut = changedReservations
      .filter((r) => !str(r.customerIdNumber))
      .map((r) => str(r.reservationNumber))
      .filter(Boolean);
    if (missingIdResNumsOut.length > 0 && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        `[RG Sync] Missing customer National ID for ${missingIdResNumsOut.length} reservation(s): ${missingIdResNumsOut.slice(0, 10).join(', ')}`
      );
    }

    const syncComplete = syncCompleteOut;
    const savedOrUpdatedCount = importedCount + updatedCount;
    const totalInSource = num(
      payload?.totalInSource,
      savedOrUpdatedCount + missingSourceIds.length
    );

    const finalReconciliation: SyncReconciliationReport = reconciliationOut || {
      totalInSource,
      fetchedCount: incomingRes.length,
      uniqueSourceCount: savedOrUpdatedCount,
      savedOrUpdatedCount,
      importedCount,
      updatedCount,
      dbTotalReservations,
      sourceEligibleCount: sourceEligibleCountOut,
      dbEligibleCount: dbEligibleCountOut,
      eligibleCountGap: eligibleCountGapOut,
      missingEligibleIds: missingEligibleIdsOut,
      extraEligibleDbIds: extraEligibleDbIdsOut,
      duplicateHandledCount,
      excludedFilteredCount: num(payload?.excludedFilteredCount, excludedSourceIds.length),
      excludedSourceIds,
      rangeFilteredCount: num(payload?.rangeFilteredCount, 0),
      failedCount: failedRecords.length,
      failedRecords,
      missingLocalCount: missingSourceIds.length,
      missingSourceIds,
      incompleteEndpoints,
      backfillFailedIds,
      unfetchedSourceGap,
      syncComplete,
      verifiedAt: finishedAt
    };

    return {
      syncId,
      status: syncComplete ? 'success' : 'partial',
      syncComplete,
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
      mutatedReservations,
      fetchedCount: incomingRes.length,
      totalInSource,
      savedOrUpdatedCount,
      dbTotalReservations,
      sourceEligibleCount: sourceEligibleCountOut,
      dbEligibleCount: dbEligibleCountOut,
      eligibleCountGap: eligibleCountGapOut,
      missingEligibleIds: missingEligibleIdsOut,
      extraEligibleDbIds: extraEligibleDbIdsOut,
      duplicateHandledCount,
      failedCount: failedRecords.length,
      failedRecords,
      missingLocalCount: missingSourceIds.length,
      missingSourceIds,
      incompleteEndpoints,
      backfillFailedIds,
      unfetchedSourceGap,
      excludedSourceIds,
      reconciliation: finalReconciliation,
      sourceBreakdown: payload?.sourceBreakdown,
      excludedFilteredCount: num(payload?.excludedFilteredCount, excludedSourceIds.length),
      rangeFilteredCount: num(payload?.rangeFilteredCount, 0),
      missingNationalIdCount: missingIdResNumsOut.length,
      missingNationalIdReservations: missingIdResNumsOut.slice(0, 20)
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
): {
  rows: any[];
  totalPages: number | null;
  totalElements: number;
  isLast: boolean;
  currentPageNum: number | null;
  nextPageUrl: string;
  nextCursor: string;
  nextPageNum: number | null;
  offset: number | null;
  effectivePageSize: number;
  hasExplicitTotalElements: boolean;
} {
  if (!json || typeof json !== 'object') {
    return {
      rows: [],
      totalPages: null,
      totalElements: 0,
      isLast: true,
      currentPageNum: null,
      nextPageUrl: '',
      nextCursor: '',
      nextPageNum: null,
      offset: null,
      effectivePageSize: pageSize,
      hasExplicitTotalElements: false
    };
  }

  if (Array.isArray(json)) {
    return {
      rows: json,
      totalPages: null,
      totalElements: json.length,
      isLast: json.length < pageSize,
      currentPageNum: null,
      nextPageUrl: '',
      nextCursor: '',
      nextPageNum: null,
      offset: null,
      effectivePageSize: pageSize,
      hasExplicitTotalElements: false
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
    metaHolder?.lastPage ??
    metaHolder?.meta?.totalPages ??
    metaHolder?.meta?.total_pages ??
    metaHolder?.meta?.last_page ??
    metaHolder?.pagination?.totalPages ??
    metaHolder?.pagination?.total_pages ??
    metaHolder?.pagination?.last_page ??
    json?.totalPages ??
    json?.total_pages ??
    json?.last_page ??
    json?.lastPage ??
    json?.meta?.totalPages ??
    json?.meta?.total_pages ??
    json?.meta?.last_page ??
    json?.pagination?.totalPages ??
    json?.pagination?.total_pages ??
    json?.pagination?.last_page;

  const hasTotalPages = rawTotalPages !== undefined && rawTotalPages !== null && rawTotalPages !== '' && !isNaN(Number(rawTotalPages)) && Number(rawTotalPages) > 0;
  let totalPages: number | null = hasTotalPages ? Math.max(1, Number(rawTotalPages)) : null;

  const rawTotalElements =
    metaHolder?.totalElements ??
    metaHolder?.totalItems ??
    metaHolder?.total_items ??
    metaHolder?.totalRecords ??
    metaHolder?.total_records ??
    metaHolder?.total ??
    metaHolder?.total_count ??
    metaHolder?.count ??
    metaHolder?.meta?.totalElements ??
    metaHolder?.meta?.totalItems ??
    metaHolder?.meta?.total_items ??
    metaHolder?.meta?.totalRecords ??
    metaHolder?.meta?.total ??
    metaHolder?.meta?.total_count ??
    metaHolder?.pagination?.totalElements ??
    metaHolder?.pagination?.totalItems ??
    metaHolder?.pagination?.total_items ??
    metaHolder?.pagination?.total ??
    json?.totalElements ??
    json?.totalItems ??
    json?.total_items ??
    json?.totalRecords ??
    json?.total_records ??
    json?.total ??
    json?.total_count ??
    json?.count ??
    json?.meta?.totalElements ??
    json?.meta?.totalItems ??
    json?.meta?.total_items ??
    json?.meta?.total ??
    json?.meta?.total_count ??
    json?.pagination?.total ??
    json?.pagination?.totalItems;
  const hasExplicitTotalElements =
    rawTotalElements !== undefined && rawTotalElements !== null && rawTotalElements !== '' && !isNaN(Number(rawTotalElements));
  const totalElements = hasExplicitTotalElements ? Number(rawTotalElements) : safeRows.length;

  const explicitLast =
    metaHolder?.last !== undefined
      ? metaHolder.last
      : (metaHolder?.pagination?.last !== undefined ? metaHolder.pagination.last : (json?.last !== undefined ? json.last : undefined));
  const explicitHasMore =
    metaHolder?.hasMore !== undefined
      ? metaHolder.hasMore
      : (metaHolder?.has_more !== undefined
          ? metaHolder.has_more
          : (metaHolder?.pagination?.hasMore ?? metaHolder?.pagination?.has_more ?? metaHolder?.meta?.hasMore ?? metaHolder?.meta?.has_more ?? json?.hasMore ?? json?.has_more));
  const nextPageUrl = str(
    metaHolder?.next_page_url ?? metaHolder?.nextPageUrl ?? metaHolder?.meta?.next_page_url ?? metaHolder?.links?.next ?? metaHolder?.pagination?.next_page_url ??
    json?.next_page_url ?? json?.nextPageUrl ?? json?.meta?.next_page_url ?? json?.links?.next ?? json?.pagination?.next_page_url ?? ''
  );
  const nextCursor = str(
    metaHolder?.nextCursor ?? metaHolder?.next_cursor ?? metaHolder?.nextToken ?? metaHolder?.next_token ?? metaHolder?.after ??
    metaHolder?.meta?.nextCursor ?? metaHolder?.meta?.next_cursor ?? metaHolder?.pagination?.nextCursor ?? metaHolder?.pagination?.next_cursor ??
    json?.nextCursor ?? json?.next_cursor ?? json?.nextToken ?? json?.next_token ?? json?.after ??
    json?.meta?.nextCursor ?? json?.meta?.next_cursor ?? json?.pagination?.nextCursor ?? json?.pagination?.next_cursor ?? ''
  );
  const rawNextPageNum =
    metaHolder?.nextPage ?? metaHolder?.next_page ?? metaHolder?.pagination?.nextPage ?? metaHolder?.pagination?.next_page ??
    json?.nextPage ?? json?.next_page ?? json?.pagination?.nextPage ?? json?.pagination?.next_page;
  const nextPageNum =
    rawNextPageNum !== undefined && rawNextPageNum !== null && rawNextPageNum !== '' && !isNaN(Number(rawNextPageNum))
      ? Number(rawNextPageNum)
      : null;

  const rawOffset = metaHolder?.offset ?? metaHolder?.pagination?.offset ?? json?.offset ?? json?.pagination?.offset;
  const offset =
    rawOffset !== undefined && rawOffset !== null && rawOffset !== '' && !isNaN(Number(rawOffset))
      ? Number(rawOffset)
      : null;

  const rawCurrentPage =
    metaHolder?.current_page ?? metaHolder?.currentPage ?? metaHolder?.meta?.current_page ?? metaHolder?.meta?.currentPage ??
    metaHolder?.pagination?.current_page ?? metaHolder?.pagination?.currentPage ?? metaHolder?.pageNumber ?? metaHolder?.page ?? metaHolder?.number ??
    json?.current_page ?? json?.currentPage ?? json?.meta?.current_page ?? json?.meta?.currentPage ??
    json?.pagination?.current_page ?? json?.pagination?.currentPage ?? json?.pageNumber ?? json?.page ?? json?.number;
  const hasCurrentPage = rawCurrentPage !== undefined && rawCurrentPage !== null && rawCurrentPage !== '' && !isNaN(Number(rawCurrentPage));
  const currentPageNum = hasCurrentPage ? Number(rawCurrentPage) : null;
  const serverPageSize = Number(
    metaHolder?.size ?? metaHolder?.per_page ?? metaHolder?.pageSize ?? metaHolder?.page_size ?? metaHolder?.limit ??
    metaHolder?.meta?.per_page ?? metaHolder?.meta?.size ?? metaHolder?.pagination?.per_page ?? metaHolder?.pagination?.limit ??
    json?.size ?? json?.per_page ?? json?.pageSize ?? json?.page_size ?? json?.limit ?? pageSize
  );
  const effectivePageSize = isFinite(serverPageSize) && serverPageSize > 0 ? serverPageSize : pageSize;
  if (totalPages === null && hasExplicitTotalElements && effectivePageSize > 0 && Number(rawTotalElements) > 0) {
    totalPages = Math.max(1, Math.ceil(Number(rawTotalElements) / effectivePageSize));
  }

  let isLast: boolean;
  if (safeRows.length === 0) {
    isLast = true;
  } else if (explicitLast === true || explicitHasMore === false) {
    isLast = true;
  } else if (nextPageUrl || nextCursor || (nextPageNum !== null && (currentPageNum === null || nextPageNum > currentPageNum))) {
    isLast = false;
  } else if (totalPages !== null) {
    const hasOneBasedField = Boolean(
      metaHolder?.current_page !== undefined || metaHolder?.currentPage !== undefined || metaHolder?.last_page !== undefined ||
      metaHolder?.meta?.current_page !== undefined || metaHolder?.pagination?.current_page !== undefined ||
      json?.current_page !== undefined || json?.currentPage !== undefined || json?.last_page !== undefined ||
      json?.meta?.current_page !== undefined || json?.pagination?.current_page !== undefined ||
      (pageIndex === 0 && currentPageNum === 1)
    );
    const isOneBasedCurrent = currentPageNum !== null && currentPageNum >= 1 && (pageIndex === 0 ? currentPageNum === 1 : true) && hasOneBasedField;
    if (isOneBasedCurrent) {
      isLast = currentPageNum >= totalPages;
    } else if (currentPageNum !== null && currentPageNum >= 0 && pageIndex > 0 && currentPageNum < totalPages && currentPageNum <= pageIndex) {
      isLast = currentPageNum >= totalPages;
    } else {
      isLast = pageIndex + 1 >= totalPages;
    }
  } else if (explicitLast === false || explicitHasMore === true) {
    isLast = false;
  } else if (hasExplicitTotalElements && offset !== null) {
    isLast = offset + safeRows.length >= Number(rawTotalElements);
  } else if (hasExplicitTotalElements && Number(rawTotalElements) > effectivePageSize) {
    isLast = (pageIndex + 1) * effectivePageSize >= Number(rawTotalElements);
  } else if (hasExplicitTotalElements && Number(rawTotalElements) > safeRows.length && pageIndex === 0) {
    isLast = false;
  } else {
    isLast = safeRows.length < effectivePageSize;
  }

  return {
    rows: safeRows,
    totalPages,
    totalElements,
    isLast,
    currentPageNum,
    nextPageUrl,
    nextCursor,
    nextPageNum,
    offset,
    effectivePageSize,
    hasExplicitTotalElements
  };
}

const NEVER_EXCLUDE_LIFECYCLE_STATUSES = new Set([
  'cancelled',
  'canceled',
  'cancelled_by_customer',
  'canceled_by_customer',
  'customer_cancelled',
  'customer_canceled',
  'user_cancelled',
  'user_canceled',
  'client_cancelled',
  'client_canceled',
  'cancelled_by_client',
  'canceled_by_client',
  'cancelled_by_user',
  'canceled_by_user',
  'cancelled_by_admin',
  'canceled_by_admin',
  'cancelled_by_provider',
  'canceled_by_provider',
  'cancelled_by_company',
  'canceled_by_company',
  'admin_cancelled',
  'admin_canceled',
  'provider_cancelled',
  'provider_canceled',
  'company_cancelled',
  'company_canceled',
  'system_cancelled',
  'system_canceled',
  'auto_cancelled',
  'auto_canceled',
  'declined',
  'rejected',
  'rejected_by_admin',
  'rejected_by_company',
  'rejected_by_provider',
  'rejected_by_customer',
  'rejected_by_client',
  'rejected_by_user',
  'provider_rejected',
  'company_rejected',
  'admin_rejected',
  'customer_rejected',
  'client_rejected',
  'user_rejected',
  'auto_rejected',
  'system_rejected',
  'declined_by_admin',
  'declined_by_company',
  'declined_by_provider',
  'refused_by_admin',
  'refused_by_company',
  'refused_by_provider',
  'refused',
  'ملغي',
  'ملغى',
  'ملغاة',
  'تم الإلغاء',
  'تم الالغاء',
  'ملغي من العميل',
  'ملغى من العميل',
  'ملغاة من العميل',
  'ملغي من الشركة',
  'ملغى من الشركة',
  'ملغي من الادارة',
  'ملغي من الإدارة',
  'ملغي تلقائيا',
  'ملغي تلقائياً',
  'الغاء العميل',
  'إلغاء العميل',
  'مرفوض',
  'مرفوضة',
  'تم الرفض',
  'تم الرفض من الشركة',
  'تم الرفض من المزود',
  'مرفوض من الموقع',
  'مرفوضة من الموقع',
  'مرفوض من الشركة',
  'مرفوضة من الشركة',
  'مرفوض من المزود',
  'مرفوض من الإدارة',
  'مرفوض تلقائيا',
  'مرفوض تلقائياً'
]);

export function sanitizeExcludedStatusesList(rawList: unknown): string[] {
  const arr = Array.isArray(rawList) ? rawList : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const val of arr) {
    const cleaned = str(val).toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    if (
      NEVER_EXCLUDE_LIFECYCLE_STATUSES.has(cleaned) ||
      (typeof crmCore?.isInactiveReservation === 'function' &&
        crmCore.isInactiveReservation({ originalStatusCode: cleaned, originalStatusAr: cleaned, internalStatus: cleaned }))
    ) {
      continue;
    }
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

let activePullInFlight = false;

export async function ensureWorkerStateRow(executor: DbExecutor): Promise<void> {
  try {
    await executor.query(
      `INSERT INTO sync_worker_state (id) VALUES ('primary') ON CONFLICT (id) DO NOTHING`
    );
  } catch {
    // Ignore when running against legacy test mock executors without sync_worker_state
  }
}

export async function readWorkerStateRow(executor: DbExecutor): Promise<Record<string, any> | null> {
  try {
    await ensureWorkerStateRow(executor);
    const res = await executor.query(`SELECT * FROM sync_worker_state WHERE id = 'primary' LIMIT 1`);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

async function readNormalizedSyncSettings(executor: DbExecutor) {
  try {
    const res = await executor.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN (
        'auto_sync_enabled',
        'auto_sync_interval_seconds',
        'auto_sync_interval_value',
        'auto_sync_interval_unit',
        'auto_sync_interval_hours',
        'auto_sync_interval_minutes'
      )`
    );
    const map: Record<string, any> = {};
    for (const r of res.rows || []) {
      let v: any = r.value;
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      map[r.key] = v;
    }
    return normalizeAutoSyncConfig(map);
  } catch {
    return normalizeAutoSyncConfig({});
  }
}

export async function emitSyncWorkerStatusRealtime(
  executor: DbExecutor,
  action = 'syncWorkerStatus',
  actorId = 'SYSTEM_AUTO_SYNC'
): Promise<void> {
  const evt = {
    type: 'delta' as const,
    action,
    scopes: ['sync'],
    actorId,
    at: new Date().toISOString()
  };
  broadcastCrmEvent(evt);
  await publishPgNotify(executor, evt).catch(() => undefined);
}

export async function acquireSyncDistributedLock(
  executor: DbExecutor,
  lockOwner: string,
  leaseSeconds = 300
): Promise<boolean> {
  if (activePullInFlight) return false;
  await ensureWorkerStateRow(executor);
  try {
    const res = await executor.query(
      `UPDATE sync_worker_state
       SET is_syncing = TRUE,
           locked_by = $1,
           lock_expires_at = NOW() + ($2::text || ' seconds')::interval,
           updated_at = NOW()
       WHERE id = 'primary' AND (is_syncing = FALSE OR lock_expires_at IS NULL OR lock_expires_at < NOW())
       RETURNING id`,
      [lockOwner, String(Math.max(30, Math.round(leaseSeconds)))]
    );
    if (Array.isArray(res.rows) && res.rows.length === 0) {
      const verifyRow = await executor.query(
        `SELECT is_syncing, lock_expires_at FROM sync_worker_state WHERE id = 'primary' LIMIT 1`
      ).catch(() => ({ rows: [] as any[] }));
      if (!Array.isArray(verifyRow.rows) || verifyRow.rows.length === 0) {
        return !activePullInFlight;
      }
      return false;
    }
    return true;
  } catch {
    // Mock executor fallback: rely on activePullInFlight
    return !activePullInFlight;
  }
}

export async function releaseSyncDistributedLock(
  executor: DbExecutor,
  lockOwner: string
): Promise<void> {
  try {
    await executor.query(
      `UPDATE sync_worker_state
       SET is_syncing = FALSE,
           locked_by = '',
           lock_expires_at = NULL,
           updated_at = NOW()
       WHERE id = 'primary' AND (locked_by = $1 OR locked_by = '')`,
      [lockOwner]
    );
  } catch {
    // Ignore on legacy mock executors
  }
}

export async function recordWorkerSyncOutcome(
  executor: DbExecutor,
  params: {
    triggerType: 'auto' | 'manual';
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    ok: boolean;
    importedCount?: number;
    updatedCount?: number;
    extensionsCount?: number;
    errorMessage?: string;
  }
): Promise<void> {
  try {
    const [cfg, prevRow] = await Promise.all([
      readNormalizedSyncSettings(executor),
      readWorkerStateRow(executor)
    ]);
    const prevConsec = num(prevRow?.consecutive_errors, 0);
    const nextConsec = params.ok ? 0 : prevConsec + 1;
    const nextErrMsg = params.ok ? '' : str(params.errorMessage).slice(0, 500);
    const nextStatus = deriveWorkerStatus({
      enabled: cfg.enabled,
      isSyncing: false,
      consecutiveErrors: nextConsec,
      lastError: nextErrMsg
    });
    const nextRunAt = computeNextScheduledRunAt({
      enabled: cfg.enabled,
      intervalSeconds: cfg.intervalSeconds,
      nowMs: Date.parse(params.finishedAt) || Date.now(),
      currentNextRunAt: prevRow?.next_run_at || null,
      lastRunAt: params.startedAt,
      consecutiveErrors: nextConsec,
      reason:
        params.triggerType === 'manual'
          ? 'manual_completed'
          : params.ok
            ? 'auto_completed'
            : 'auto_error'
    });

    await executor.query(
      `UPDATE sync_worker_state
       SET status = $1,
           is_syncing = FALSE,
           locked_by = '',
           lock_expires_at = NULL,
           auto_sync_enabled = $2,
           interval_seconds = $3,
           interval_value = $4,
           interval_unit = $5,
           last_run_at = $6::timestamptz,
           last_success_at = COALESCE($7::timestamptz, last_success_at),
           next_run_at = $8::timestamptz,
           last_duration_ms = $9,
           last_imported_count = CASE WHEN $10 THEN $11 ELSE last_imported_count END,
           last_updated_count = CASE WHEN $10 THEN $12 ELSE last_updated_count END,
           last_extensions_count = CASE WHEN $10 THEN $13 ELSE last_extensions_count END,
           error_count = error_count + $14,
           consecutive_errors = $15,
           last_error = $16,
           last_trigger_type = $17,
           updated_at = NOW()
       WHERE id = 'primary'`,
      [
        nextStatus,
        cfg.enabled,
        cfg.intervalSeconds,
        cfg.value,
        cfg.unit,
        params.startedAt,
        params.ok ? params.finishedAt : null,
        nextRunAt,
        Math.max(0, Math.round(params.durationMs)),
        params.ok,
        num(params.importedCount, 0),
        num(params.updatedCount, 0),
        num(params.extensionsCount, 0),
        params.ok ? 0 : 1,
        nextConsec,
        nextErrMsg,
        params.triggerType
      ]
    );
  } catch {
    // Non-fatal on mock executors
  }
}

export async function pullFromRentalGateDirect(
  executor: DbExecutor,
  actor: SyncActor,
  payload: Record<string, any> = {},
  fetchFn: typeof fetch = fetch
): Promise<SyncIngestResult> {
  const triggerType: 'auto' | 'manual' = payload?.triggerType === 'auto' ? 'auto' : 'manual';
  const lockOwner = `${triggerType}_${actor?.id || 'system'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const acquired = await acquireSyncDistributedLock(executor, lockOwner, 300);
  if (!acquired) {
    throw new Error('SYNC_IN_PROGRESS: عملية المزامنة قيد التنفيذ بالفعل، يرجى الانتظار حتى اكتمال السحب الحالي.');
  }
  activePullInFlight = true;
  const pullStartedMs = Date.now();
  const pullStartedIso = new Date(pullStartedMs).toISOString();
  void emitSyncWorkerStatusRealtime(executor, 'syncWorkerStarted', actor?.id || 'SYSTEM_AUTO_SYNC').catch(() => undefined);
  try {
    const serverCfg = await resolveServerConfig(executor);
    const rgToken = str(serverCfg.rgToken).replace(/^Bearer\s+/i, '');
    if (!rgToken) {
      throw new Error('NO_RG_TOKEN: يرجى إدخال توكن Rental Gate في الإعدادات (أو ضبط متغير RG_TOKEN على الخادم).');
    }

    const baseApi = str(serverCfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
    let baseOrigin = '';
    try {
      baseOrigin = new URL(baseApi).origin;
    } catch {
      baseOrigin = '';
    }
    const appliedRange = crmCore.resolvePullDateRange(payload || {});
    const pageSize = 100;
    const maxPages = Math.min(500, Math.max(1, num(payload?.maxPages, 500)));
    const retryBaseDelayMs = Math.max(0, Math.min(2000, num(payload?.retryDelayMs, 150)));
    const maxRetries = Math.max(1, Math.min(4, num(payload?.maxRetries, 3)));

    const sleepMs = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

    const isRetryableHttpStatus = (status: number) =>
      status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

    const fetchWithRetry = async (targetUrl: string): Promise<Response> => {
      let lastErr: any = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 25000) : null;
        try {
          const resp = await fetchFn(targetUrl, {
            method: 'GET',
            signal: ctrl?.signal,
            headers: {
              Authorization: `Bearer ${rgToken}`,
              Accept: 'application/json',
              lang: 'ar'
            }
          });
          if (timer) clearTimeout(timer);
          if (resp.ok || !isRetryableHttpStatus(resp.status) || attempt === maxRetries) {
            return resp;
          }
          await sleepMs(retryBaseDelayMs * attempt);
        } catch (err: any) {
          if (timer) clearTimeout(timer);
          lastErr = err;
          if (attempt === maxRetries) throw err;
          await sleepMs(retryBaseDelayMs * attempt);
        }
      }
      throw lastErr || new Error('FETCH_RETRY_EXHAUSTED');
    };

    const resolveSafeNextUrl = (rawNext: string): string => {
      const cleaned = str(rawNext);
      if (!cleaned) return '';
      try {
        const resolved = new URL(cleaned, baseApi + '/');
        if (baseOrigin && resolved.origin !== baseOrigin) return '';
        if (!/^https?:$/i.test(resolved.protocol)) return '';
        if (!resolved.searchParams.has('size')) {
          resolved.searchParams.set('size', String(pageSize));
        }
        return resolved.toString();
      } catch {
        return '';
      }
    };

    const extractUrlPageIndex = (urlStr: string, fallbackPage: number): number => {
      try {
        const u = new URL(urlStr, baseApi + '/');
        const p = u.searchParams.get('page');
        if (p !== null && p !== '' && !isNaN(Number(p))) return Number(p);
      } catch {
        // ignore URL parse error
      }
      return fallbackPage;
    };

    const fetchPaged = async (endpoint: string, optional = false) => {
      const items: any[] = [];
      const seenKeys = new Set<string>();
      const visitedUrls = new Set<string>();
      const visitedCursors = new Set<string>();
      let pages = 0;
      let explicitNextUrl = '';
      let nextCursorUrl = '';
      let nextOffsetUrl = '';
      let oneBasedClamped = false;
      let consecutiveZeroAdded = 0;
      let succeeded = false;
      let complete = true;
      let errorMsg = '';
      let latestReportedTotalElements: number | null = null;
      let latestReportedTotalPages: number | null = null;
      let duplicateRowsSkipped = 0;

      for (let step = 0; step < maxPages; step++) {
        const targetUrl =
          explicitNextUrl ||
          nextCursorUrl ||
          nextOffsetUrl ||
          `${baseApi}/${endpoint}?page=${step}&size=${pageSize}`;
        if (visitedUrls.has(targetUrl)) {
          if (latestReportedTotalElements !== null && latestReportedTotalElements > 0 && items.length < latestReportedTotalElements) {
            complete = false;
            errorMsg = `PAGINATION_URL_LOOP (${items.length}/${latestReportedTotalElements})`;
          }
          break;
        }
        visitedUrls.add(targetUrl);
        const pageParam = extractUrlPageIndex(targetUrl, step);
        const usedExplicitNext = Boolean(explicitNextUrl);
        const usedCursor = Boolean(nextCursorUrl);
        const usedOffset = Boolean(nextOffsetUrl);
        explicitNextUrl = '';
        nextCursorUrl = '';
        nextOffsetUrl = '';

        let resp: Response;
        try {
          resp = await fetchWithRetry(targetUrl);
        } catch (netErr: any) {
          errorMsg = String(netErr?.message || 'NETWORK_ERROR').slice(0, 200);
          if (optional) {
            complete = false;
            return {
              items,
              pages,
              ok: false,
              complete: false,
              error: errorMsg,
              reportedTotalElements: latestReportedTotalElements,
              duplicateRowsSkipped
            };
          }
          throw new Error(`RG_API_NETWORK_ERROR (${endpoint}): ${errorMsg}`);
        }

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          errorMsg = `HTTP_${resp.status}: ${errBody.slice(0, 160)}`;
          if (optional && resp.status !== 401 && resp.status !== 403) {
            complete = false;
            return {
              items,
              pages,
              ok: false,
              complete: false,
              error: errorMsg,
              reportedTotalElements: latestReportedTotalElements,
              duplicateRowsSkipped
            };
          }
          throw new Error(`RG_API_HTTP_${resp.status}: ${errBody.slice(0, 200)}`);
        }
        const json: any = await resp.json();
        if (json && typeof json === 'object' && !Array.isArray(json) && json.success === false && !json.data && !json.content && !json.items) {
          errorMsg = str(json.message || json.error || 'RG_API_ERROR');
          if (optional) {
            complete = false;
            return {
              items,
              pages,
              ok: false,
              complete: false,
              error: errorMsg,
              reportedTotalElements: latestReportedTotalElements,
              duplicateRowsSkipped
            };
          }
          throw new Error(errorMsg || 'RG_API_ERROR: رفضت واجهة Rental Gate الطلب.');
        }
        succeeded = true;
        pages++;
        const parsedPage = extractRentalGatePagePayload(json, pageParam, pageSize);
        if (parsedPage.hasExplicitTotalElements && (parsedPage.totalElements > 0 || (parsedPage.totalElements === 0 && parsedPage.rows.length === 0))) {
          latestReportedTotalElements = Math.max(latestReportedTotalElements ?? 0, parsedPage.totalElements);
        }
        if (parsedPage.totalPages !== null) {
          latestReportedTotalPages = Math.max(latestReportedTotalPages ?? 0, parsedPage.totalPages);
        }

        let added = 0;
        for (const row of parsedPage.rows) {
          const extKey = str(row?.extendId || row?.extensionNumber || row?.extension_number);
          const resNum = str(crmCore.extractReservationNumber(row)).replace(/^#+/, '').trim();
          const srcId = str(crmCore.extractSourceReservationId(row)).replace(/^#+/, '').trim();
          const rowKey = extKey || (srcId && resNum && resNum !== srcId ? `${srcId}::${resNum}` : (srcId || resNum));
          if (rowKey) {
            if (seenKeys.has(rowKey)) {
              duplicateRowsSkipped++;
              continue;
            }
            seenKeys.add(rowKey);
          }
          items.push(row);
          added++;
        }

        // Detect 1-based clamping (?page=0 returned page 1, so ?page=1 returned page 1 again with added=0)
        const isFirstProbeDuplicate = step === 1 && !usedExplicitNext && !usedCursor && !usedOffset && parsedPage.rows.length > 0 && added === 0;
        if (isFirstProbeDuplicate) {
          oneBasedClamped = true;
          consecutiveZeroAdded = 0;
        } else if (parsedPage.rows.length > 0 && added === 0) {
          consecutiveZeroAdded++;
        } else {
          consecutiveZeroAdded = 0;
        }

        if (parsedPage.nextPageUrl) {
          const safeNext = resolveSafeNextUrl(parsedPage.nextPageUrl);
          if (safeNext && !visitedUrls.has(safeNext)) {
            explicitNextUrl = safeNext;
          }
        }
        if (!explicitNextUrl && parsedPage.nextCursor && !visitedCursors.has(parsedPage.nextCursor)) {
          visitedCursors.add(parsedPage.nextCursor);
          const curUrl = new URL(`${baseApi}/${endpoint}`);
          curUrl.searchParams.set('cursor', parsedPage.nextCursor);
          curUrl.searchParams.set('size', String(pageSize));
          if (!visitedUrls.has(curUrl.toString())) {
            nextCursorUrl = curUrl.toString();
          }
        }
        if (!explicitNextUrl && !nextCursorUrl && parsedPage.nextPageNum !== null && (parsedPage.currentPageNum === null || parsedPage.nextPageNum > parsedPage.currentPageNum)) {
          const npUrl = `${baseApi}/${endpoint}?page=${encodeURIComponent(String(parsedPage.nextPageNum))}&size=${pageSize}`;
          if (!visitedUrls.has(npUrl)) {
            explicitNextUrl = npUrl;
          }
        }
        if (!explicitNextUrl && !nextCursorUrl && parsedPage.offset !== null && parsedPage.rows.length > 0) {
          const nextOffset = parsedPage.offset + parsedPage.rows.length;
          const totalTarget = latestReportedTotalElements ?? parsedPage.totalElements;
          if ((parsedPage.hasExplicitTotalElements && nextOffset < totalTarget) || (!parsedPage.isLast && parsedPage.rows.length >= parsedPage.effectivePageSize)) {
            const offUrl = `${baseApi}/${endpoint}?offset=${nextOffset}&limit=${parsedPage.effectivePageSize}`;
            if (!visitedUrls.has(offUrl)) {
              nextOffsetUrl = offUrl;
            }
          }
        }

        const effectiveTotalElements = latestReportedTotalElements ?? (parsedPage.hasExplicitTotalElements ? parsedPage.totalElements : 0);
        const hasMoreByTotal = effectiveTotalElements > 0 && items.length < effectiveTotalElements && parsedPage.rows.length > 0;
        const hasMoreByTotalPages = Boolean(
          oneBasedClamped &&
          latestReportedTotalPages !== null &&
          pageParam < latestReportedTotalPages &&
          parsedPage.rows.length > 0
        );
        const hasNextNav = Boolean(explicitNextUrl || nextCursorUrl || nextOffsetUrl);
        const stopOnZeroAdded = parsedPage.rows.length > 0 && added === 0 && !isFirstProbeDuplicate && !hasNextNav && (!hasMoreByTotal || consecutiveZeroAdded >= 2);
        if ((parsedPage.isLast && !hasMoreByTotal && !hasMoreByTotalPages && !hasNextNav) || stopOnZeroAdded) {
          if (hasMoreByTotal && stopOnZeroAdded) {
            complete = false;
            errorMsg = `STOPPED_ON_DUPLICATE_PAGES (${items.length}/${effectiveTotalElements})`;
          }
          break;
        }
        if (step + 1 >= maxPages) {
          if (hasMoreByTotal || hasMoreByTotalPages || (latestReportedTotalPages !== null && pages < latestReportedTotalPages) || !parsedPage.isLast) {
            complete = false;
            errorMsg = `MAX_PAGES_REACHED (${pages}/${latestReportedTotalPages ?? maxPages})`;
          }
        }
      }

      if (complete && latestReportedTotalElements !== null && latestReportedTotalElements > 0 && items.length < latestReportedTotalElements) {
        complete = false;
        errorMsg = errorMsg || `INCOMPLETE_COUNT (${items.length}/${latestReportedTotalElements})`;
      }

      return {
        items,
        pages,
        ok: succeeded && complete,
        complete,
        error: errorMsg,
        reportedTotalElements: latestReportedTotalElements,
        duplicateRowsSkipped
      };
    };

    const [resPaged, extPaged, canPaged, rccPaged] = await Promise.all([
      fetchPaged('reservations/filter', false),
      fetchPaged('reservation-extends/filter', true),
      fetchPaged('admin/cancelled-reservations', true),
      fetchPaged('reservation-company-changes/admin/filter', true)
    ]);

    const incompleteEndpoints: string[] = [];
    for (const [epName, epRes] of [
      ['reservations/filter', resPaged],
      ['reservation-extends/filter', extPaged],
      ['admin/cancelled-reservations', canPaged],
      ['reservation-company-changes/admin/filter', rccPaged]
    ] as Array<[string, Awaited<ReturnType<typeof fetchPaged>>]>) {
      if (!epRes.complete) {
        incompleteEndpoints.push(`${epName}${epRes.error ? ` (${epRes.error})` : ''}`);
      }
    }

    const extractLinkSrcId = (row: any) =>
      str(
        row?.reservationId ??
        row?.reservation_id ??
        row?.sourceReservationId ??
        row?.source_reservation_id ??
        row?.reservation?.reservationId ??
        row?.reservation?.id ??
        row?.id
      );

    const cancelledBySrcId = new Map<string, any>();
    if (canPaged.items.length > 0) {
      for (const cRow of canPaged.items) {
        const sid = extractLinkSrcId(cRow);
        if (sid && !cancelledBySrcId.has(sid)) {
          cancelledBySrcId.set(sid, cRow);
        }
      }
    }

    const rccBySrcId = new Map<string, any>();
    if (rccPaged.items.length > 0) {
      for (const rRow of rccPaged.items) {
        const sid = extractLinkSrcId(rRow);
        if (!sid) continue;
        const prev = rccBySrcId.get(sid);
        if (!prev || num(rRow?.id, 0) >= num(prev?.id, 0)) {
          rccBySrcId.set(sid, rRow);
        }
      }
    }

    // Backfill ALL cancelled/rejected booking IDs missing from reservations/filter using all ID/number aliases
    const presentSrcIds = new Set<string>();
    for (const it of resPaged.items) {
      const s1 = str(crmCore.extractSourceReservationId(it));
      const s2 = str(crmCore.extractReservationNumber(it)).replace(/^#+/, '').trim();
      const s3 = str(it?.id);
      const s4 = str(it?.reservation?.id);
      for (const cand of [s1, s2, s3, s4]) {
        if (cand) {
          presentSrcIds.add(cand);
          presentSrcIds.add(cand.replace(/^#+/, '').trim());
        }
      }
    }
    const missingAuthoritativeIds = Array.from(new Set([
      ...cancelledBySrcId.keys(),
      ...rccBySrcId.keys()
    ])).filter((sid) => sid && !presentSrcIds.has(sid) && !presentSrcIds.has(sid.replace(/^#+/, '').trim()));

    const fetchReservationDetailById = async (sid: string): Promise<Record<string, any> | null> => {
      try {
        const resp = await fetchWithRetry(`${baseApi}/reservations/${encodeURIComponent(sid)}`);
        if (!resp.ok) return null;
        const rawJson: any = await resp.json().catch(() => null);
        if (!rawJson || typeof rawJson !== 'object') return null;
        const inner =
          (rawJson.data?.reservation && typeof rawJson.data.reservation === 'object' && !Array.isArray(rawJson.data.reservation) ? rawJson.data.reservation : null) ||
          (rawJson.reservation && typeof rawJson.reservation === 'object' && !Array.isArray(rawJson.reservation) ? rawJson.reservation : null) ||
          (rawJson.data && typeof rawJson.data === 'object' && !Array.isArray(rawJson.data) ? rawJson.data : null) ||
          (rawJson.result && typeof rawJson.result === 'object' && !Array.isArray(rawJson.result) ? rawJson.result : null) ||
          rawJson;
        if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null;
        return {
          ...inner,
          reservationId: inner.reservationId ?? inner.reservation_id ?? inner.id ?? sid,
          clientName: inner.client?.name ?? inner.customer?.name ?? inner.clientName ?? inner.customer_name,
          clientMobile: inner.client?.mobile ?? inner.client?.phone ?? inner.customer?.mobile ?? inner.customer?.phone ?? inner.clientMobile ?? inner.customer_phone,
          companyArName: inner.companyCar?.company?.arabicName ?? inner.companyCar?.company?.name ?? inner.company?.arabicName ?? inner.company?.name ?? inner.companyArName,
          companyEnName: inner.companyCar?.company?.englishName ?? inner.company?.englishName ?? inner.companyEnName,
          carNameEn: inner.companyCar?.car?.carNameEn ?? inner.car?.carNameEn ?? inner.carNameEn,
          carNameAr: inner.companyCar?.car?.carNameAr ?? inner.car?.carNameAr ?? inner.carNameAr
        };
      } catch {
        return null;
      }
    };

    const backfillFailedIds: string[] = [];
    if (missingAuthoritativeIds.length > 0) {
      let pendingRetryIds: string[] = [];
      for (const idChunk of chunkList(missingAuthoritativeIds, 10)) {
        const missingFetched = await Promise.all(
          idChunk.map(async (sid) => {
            const detail = await fetchReservationDetailById(sid);
            if (!detail) {
              pendingRetryIds.push(sid);
              return null;
            }
            return detail;
          })
        );
        for (const mf of missingFetched) {
          if (mf) resPaged.items.push(mf);
        }
      }
      // Safe targeted retry pass for any backfill IDs that failed during concurrent batching
      if (pendingRetryIds.length > 0) {
        await sleepMs(retryBaseDelayMs);
        for (const retryChunk of chunkList(pendingRetryIds, 3)) {
          const retried = await Promise.all(
            retryChunk.map(async (sid) => {
              const detail = await fetchReservationDetailById(sid);
              if (!detail) {
                backfillFailedIds.push(sid);
                return null;
              }
              return detail;
            })
          );
          for (const rf of retried) {
            if (rf) resPaged.items.push(rf);
          }
        }
      }
    }

    const resHasHeuristicCancelled = resPaged.items.some((it: any) =>
      crmCore.isCancelledStatus(it) || String(crmCore.extractReservationStatusCode(it, true) || '').includes('cancel')
    );
    const resHasHeuristicRejected = resPaged.items.some((it: any) =>
      crmCore.isRejectedStatus(it) || String(crmCore.extractReservationStatusCode(it, true) || '').includes('declin') || String(crmCore.extractReservationStatusCode(it, true) || '').includes('reject')
    );
    const canAuthoritative = canPaged.ok && (cancelledBySrcId.size > 0 || !resHasHeuristicCancelled);
    const rccAuthoritative = rccPaged.ok && (rccBySrcId.size > 0 || !resHasHeuristicRejected);

    const isPrimaryActiveStatus = (item: any) => {
      const code = crmCore.extractReservationStatusCode(item, false);
      const ar = str(item?.originalStatusAr || item?.statusAr || item?.status_ar);
      if (crmCore.isRejectedToken(code) || crmCore.isRejectedToken(ar)) return false;
      if (crmCore.isCancelledToken(code) || crmCore.isCancelledToken(ar)) return false;
      return crmCore.isExplicitActiveStatusToken(code) || crmCore.isExplicitActiveStatusToken(ar);
    };
    const isPrimaryExplicitRejected = (item: any) => {
      const code = crmCore.extractReservationStatusCode(item, false);
      const ar = str(item?.originalStatusAr || item?.statusAr || item?.status_ar);
      return crmCore.isRejectedToken(code) || crmCore.isRejectedToken(ar);
    };

    const enrichResItem = (rawItem: any): Record<string, any> => {
      const sid = str(crmCore.extractSourceReservationId(rawItem) || crmCore.extractReservationNumber(rawItem));
      const cleanSid = sid.replace(/^#+/, '').trim();
      const canRec = (sid ? cancelledBySrcId.get(sid) : null) || (cleanSid ? cancelledBySrcId.get(cleanSid) : null);
      const rccRec = (sid ? rccBySrcId.get(sid) : null) || (cleanSid ? rccBySrcId.get(cleanSid) : null);
      const copy: Record<string, any> = { ...rawItem };
      const primaryActive = isPrimaryActiveStatus(rawItem);
      const primaryRejected = isPrimaryExplicitRejected(rawItem);

      if (primaryActive) {
        copy.isSourceCancelled = false;
        copy.isSourceRejected = false;
      } else if (primaryRejected) {
        copy.isSourceRejected = true;
        copy.isSourceCancelled = false;
      } else {
        const canFlag = canAuthoritative ? Boolean(canRec) : (canRec ? true : undefined);
        const rejFlag = rccAuthoritative ? Boolean(rccRec) : (rccRec ? true : undefined);
        if (canFlag === true) {
          copy.isSourceCancelled = true;
          copy.isSourceRejected = false;
        } else {
          if (typeof canFlag === 'boolean') copy.isSourceCancelled = canFlag;
          if (typeof rejFlag === 'boolean') copy.isSourceRejected = rejFlag;
        }
      }

      if (canRec) {
        if (canRec.reservationNumber) copy.referenceNumber = str(canRec.reservationNumber);
        if (canRec.paid !== undefined && canRec.paid !== null) copy.paidAmount = num(canRec.paid, 0);
        if (canRec.cancelledFromDecline !== undefined) copy.cancelledFromDecline = Boolean(canRec.cancelledFromDecline);
        if (canRec.cancelledFromHold !== undefined) copy.cancelledFromHold = Boolean(canRec.cancelledFromHold);
        if (canRec.penaltyAmount !== undefined && canRec.penaltyAmount !== null) copy.penaltyAmount = num(canRec.penaltyAmount, 0);
        const reasonTitle = crmCore.sanitizeReasonText(canRec.cancellationReasonArabic || canRec.cancellationReasonEnglish);
        const reasonNotes = crmCore.sanitizeReasonText(canRec.cancellationNotes);
        if (reasonTitle && reasonNotes && reasonTitle !== reasonNotes) {
          copy.cancellationReason = `${reasonTitle} — ${reasonNotes}`;
        } else if (reasonTitle || reasonNotes) {
          copy.cancellationReason = reasonTitle || reasonNotes;
        }
        const delFail = crmCore.sanitizeReasonText(canRec.deliveryFailureReasonArabic || canRec.deliveryFailureReasonEnglish);
        if (delFail) copy.deliveryFailureReason = delFail;
        const drvNotes = crmCore.sanitizeReasonText(canRec.driverNotes);
        if (drvNotes) copy.driverNotes = drvNotes;
        if (copy.refundAmount === undefined && canRec.paid !== undefined && canRec.paid !== null) {
          copy.refundAmount = Math.max(0, Math.round((num(canRec.paid, 0) - num(canRec.penaltyAmount, 0)) * 100) / 100);
        }
      }
      if (rccRec) {
        if (rccRec.reservationNumber && !copy.referenceNumber) copy.referenceNumber = str(rccRec.reservationNumber);
        copy.rccStatus = str(rccRec.status);
        copy.rccReason = str(rccRec.reason);
        if (rccRec.companyId !== undefined && rccRec.companyId !== null && !copy.companyNumber) {
          copy.companyNumber = str(rccRec.companyId);
        }
        if (rccRec.targetCompanyName) {
          copy.newCompanyName = str(rccRec.targetCompanyName);
        }
        if (rccRec.reservationStatusAtRequest) {
          const translatedReq = crmCore.translateOriginalStatus(str(rccRec.reservationStatusAtRequest).toLowerCase());
          copy.carStatusAtRequest = (translatedReq && translatedReq !== 'غير محدد') ? translatedReq : str(rccRec.reservationStatusAtRequest);
        }
        const rccDetails = crmCore.sanitizeReasonText(rccRec.details);
        const fallbackReasonAr = str(rccRec.reason).toUpperCase() === 'TIME_OUT'
          ? 'انتهاء مهلة التأكيد (TIME_OUT)'
          : (str(rccRec.reason).toUpperCase() === 'REJECTED_BY_COMPANY' ? 'رفض من الشركة' : '');
        if (rccDetails || fallbackReasonAr) {
          copy.rejectionReason = rccDetails || fallbackReasonAr;
        }
        if (rccRec.clientRefundAmount !== undefined && rccRec.clientRefundAmount !== null) {
          copy.refundAmount = num(rccRec.clientRefundAmount, 0);
        }
        if (rccRec.paidAmount !== undefined && rccRec.paidAmount !== null && num(rccRec.paidAmount, 0) > 0 && !copy.paidAmount) {
          copy.paidAmount = num(rccRec.paidAmount, 0);
        }
        const rejActorId = str(rccRec.confirmedByUserId ?? rccRec.rejectedByUserId ?? '');
        const rejActorName = str(rccRec.confirmedByUserName ?? rccRec.rejectedByUserName ?? '');
        const rejActorAt = str(rccRec.confirmedAt ?? rccRec.createdAt ?? '');
        if (rejActorId) copy.rejectedById = rejActorId;
        if (rejActorName) copy.rejectedByName = rejActorName;
        if (rejActorAt) copy.rejectedAt = rejActorAt;
      }
      return copy;
    };

    const enrichedResItems = resPaged.items.map(enrichResItem);

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

    const dedupedAllRes = crmCore.dedupeReservationsByNumber(enrichedResItems).map((item: any, idx: number) => ({
      ...item,
      __sourceOrder: idx + 1
    }));
    const existingCheckNums = dedupedAllRes
      .filter((item: any) => !item.isSourceCancelled && !item.isSourceRejected && excludedSet.has(crmCore.extractReservationStatusCode(item, false)))
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
    const excludedSourceIds: string[] = [];
    const afterExcludedRes = dedupedAllRes.filter((item: any) => {
      if (item.isSourceCancelled || item.isSourceRejected) return true;
      const code = crmCore.extractReservationStatusCode(item, false);
      if (!excludedSet.has(code)) return true;
      const numKey = str(crmCore.extractReservationNumber(item));
      if (existingNumsSet.has(numKey)) return true;
      const exId = str(crmCore.extractSourceReservationId(item) || numKey);
      if (exId) excludedSourceIds.push(exId);
      return false;
    });
    const excludedFilteredCount = dedupedAllRes.length - afterExcludedRes.length;

    const filteredRes = appliedRange?.hasCustomRange
      ? crmCore.filterSourceReservationsByPullRange(afterExcludedRes, appliedRange)
      : afterExcludedRes;
    const rangeFilteredCount = afterExcludedRes.length - filteredRes.length;

    const dedupedExt = crmCore.dedupeExtensionsByNumber(extPaged.items);

    const activeOrOtherCount = dedupedAllRes.filter((item: any) => crmCore.classifyReservationLifecycle(item) === 'active').length;
    const effectiveCancelledCount = dedupedAllRes.filter((item: any) => crmCore.classifyReservationLifecycle(item) === 'cancelled').length;
    const effectiveRejectedCount = dedupedAllRes.filter((item: any) => crmCore.classifyReservationLifecycle(item) === 'rejected').length;
    const cancelledListCount = canAuthoritative
      ? cancelledBySrcId.size
      : effectiveCancelledCount;
    const rejectedListCount = rccAuthoritative
      ? rccBySrcId.size
      : effectiveRejectedCount;
    const dualCancelledRejectedCount = dedupedAllRes.filter((item: any) => {
      const sid = str(crmCore.extractSourceReservationId(item) || crmCore.extractReservationNumber(item)).replace(/^#+/, '').trim();
      return Boolean(
        ((sid && cancelledBySrcId.has(sid)) || item.isSourceCancelled === true) &&
        ((sid && rccBySrcId.has(sid)) || (item.rccStatus && str(item.rccStatus).toUpperCase() === 'CLIENT_CANCELLED'))
      );
    }).length;
    const reassignedActiveCount = dedupedAllRes.filter((item: any) => {
      const sid = str(crmCore.extractSourceReservationId(item) || crmCore.extractReservationNumber(item)).replace(/^#+/, '').trim();
      return isPrimaryActiveStatus(item) && Boolean((sid && rccBySrcId.has(sid)) || item.rccStatus);
    }).length;
    const grossAcrossThreeLists = activeOrOtherCount + cancelledListCount + rejectedListCount;
    const filteredEligibleSourceIds = filteredRes
      .filter((item: any) => crmCore.classifyReservationLifecycle(item) === 'active')
      .map((item: any) => str(crmCore.extractSourceReservationId(item) || crmCore.extractReservationNumber(item)))
      .filter(Boolean);
    const sourceBreakdown: SyncSourceBreakdown = {
      uniqueSourceTotal: dedupedAllRes.length,
      activeOrOtherCount,
      cancelledListCount,
      rejectedListCount,
      effectiveCancelledCount,
      effectiveRejectedCount,
      sourceEligibleCount: filteredEligibleSourceIds.length,
      grossAcrossThreeLists,
      dualCancelledRejectedCount,
      reassignedActiveCount,
      overlapCount: Math.max(0, grossAcrossThreeLists - dedupedAllRes.length),
      excludedFilteredCount,
      rangeFilteredCount,
      extensionsTotalCount: dedupedExt.length
    };

    const totalInSource = Math.max(
      dedupedAllRes.length + backfillFailedIds.length,
      num(resPaged.reportedTotalElements, 0)
    );
    const expectedSourceIds = filteredRes
      .map((item: any) => str(crmCore.extractSourceReservationId(item) || crmCore.extractReservationNumber(item)))
      .filter(Boolean);

    let syncResult = await ingestIncrementalSyncBatch(executor, {
      source: 'rental_gate_direct',
      actor,
      pagesFetched: resPaged.pages + extPaged.pages + canPaged.pages + rccPaged.pages,
      appliedRange,
      isFullSnapshot: !appliedRange?.hasCustomRange,
      cancelledAuthoritativeSynced: canAuthoritative && !appliedRange?.hasCustomRange,
      rejectedAuthoritativeSynced: rccAuthoritative && !appliedRange?.hasCustomRange,
      cancelledSourceIds: canAuthoritative ? Array.from(cancelledBySrcId.keys()) : undefined,
      rejectedSourceIds: rccAuthoritative ? Array.from(rccBySrcId.keys()) : undefined,
      expectedSourceIds,
      expectedEligibleSourceIds: filteredEligibleSourceIds,
      sourceEligibleCount: filteredEligibleSourceIds.length,
      excludedSourceIds,
      totalInSource,
      incompleteEndpoints,
      backfillFailedIds,
      sourceBreakdown,
      excludedFilteredCount,
      rangeFilteredCount,
      duplicateSourceRowsSkipped:
        resPaged.duplicateRowsSkipped + extPaged.duplicateRowsSkipped + canPaged.duplicateRowsSkipped + rccPaged.duplicateRowsSkipped,
      reservations: filteredRes,
      extensions: dedupedExt
    });

    // Automatic targeted recovery pass if any source or eligible booking IDs are missing/mismatched
    const recoveryTargetIds = (!appliedRange?.hasCustomRange)
      ? Array.from(new Set([
          ...(syncResult.missingSourceIds || []),
          ...(syncResult.missingEligibleIds || []),
          ...(syncResult.backfillFailedIds || [])
        ].map((s) => str(s)).filter(Boolean)))
      : [];
    if (recoveryTargetIds.length > 0 && recoveryTargetIds.length <= 100) {
      const filteredByKey = new Map<string, any>();
      for (const item of filteredRes) {
        const sid = str(crmCore.extractSourceReservationId(item) || crmCore.extractReservationNumber(item));
        const cleanSid = sid.replace(/^#+/, '').trim();
        if (sid) filteredByKey.set(sid, item);
        if (cleanSid) filteredByKey.set(cleanSid, item);
      }
      const recoveredBatch: any[] = [];
      for (const rChunk of chunkList(recoveryTargetIds, 5)) {
        const fetchedDetails = await Promise.all(
          rChunk.map(async (sid) => {
            const freshDetail = await fetchReservationDetailById(sid);
            if (freshDetail) return enrichResItem(freshDetail);
            return filteredByKey.get(sid) || filteredByKey.get(sid.replace(/^#+/, '').trim()) || null;
          })
        );
        for (const item of fetchedDetails) {
          if (item) recoveredBatch.push(item);
        }
      }
      if (recoveredBatch.length > 0) {
        const recoveryRes = await ingestIncrementalSyncBatch(executor, {
          source: 'rental_gate_direct',
          actor,
          isFullSnapshot: false,
          isRetryPass: true,
          pagesFetched: recoveredBatch.length,
          expectedSourceIds: recoveryTargetIds,
          totalInSource,
          sourceBreakdown,
          reservations: recoveredBatch,
          extensions: []
        });
        const recSet = new Set(recoveredBatch.map((r) => str(crmCore.extractSourceReservationId(r) || crmCore.extractReservationNumber(r)).replace(/^#+/, '').trim()).filter(Boolean));
        const recFailSet = new Set((recoveryRes.failedRecords || []).map((f) => str(f.sourceReservationId || f.reservationNumber || f.identifier).replace(/^#+/, '').trim()).filter(Boolean));
        const checkDbRes = await executor.query(
          `SELECT id, reservation_number, source_reservation_id, original_status_code, original_status_ar, internal_status, is_source_cancelled, is_source_rejected, rejected_at, cancelled_at FROM reservations`
        ).catch(() => ({ rows: [] as any[] }));
        let verifyRows: any[] = Array.isArray(checkDbRes?.rows) ? checkDbRes.rows : [];
        if (verifyRows.length === 0) {
          const starVerify = await executor.query(`SELECT * FROM reservations`).catch(() => ({ rows: [] as any[] }));
          if (Array.isArray(starVerify?.rows)) verifyRows = starVerify.rows;
        }
        if (verifyRows.length > 0) {
          const dbEligSet = new Set<string>();
          let nextDbElig = 0;
          for (const vr of verifyRows) {
            const isElig = crmCore.classifyReservationLifecycle({
              originalStatusCode: vr.original_status_code,
              originalStatusAr: vr.original_status_ar,
              internalStatus: vr.internal_status,
              isSourceCancelled: vr.is_source_cancelled,
              isSourceRejected: vr.is_source_rejected,
              rejectedAt: vr.rejected_at,
              cancelledAt: vr.cancelled_at
            }) === 'active';
            if (isElig) {
              nextDbElig++;
              const k1 = str(vr.source_reservation_id);
              const k2 = str(vr.reservation_number);
              if (k1) { dbEligSet.add(k1); dbEligSet.add(k1.replace(/^#+/, '').trim()); }
              if (k2) { dbEligSet.add(k2); dbEligSet.add(k2.replace(/^#+/, '').trim()); }
            }
          }
          const nextMissingElig = filteredEligibleSourceIds.filter((esid: string) => {
            const clean = esid.replace(/^#+/, '').trim();
            return !dbEligSet.has(esid) && !dbEligSet.has(clean);
          });
          const nextDbAllSet = new Set<string>();
          for (const vr of verifyRows) {
            const k1 = str(vr.source_reservation_id);
            const k2 = str(vr.reservation_number);
            if (k1) { nextDbAllSet.add(k1); nextDbAllSet.add(k1.replace(/^#+/, '').trim()); }
            if (k2) { nextDbAllSet.add(k2); nextDbAllSet.add(k2.replace(/^#+/, '').trim()); }
          }
          const nextMissingSrc = expectedSourceIds.filter((esid: string) => {
            const clean = esid.replace(/^#+/, '').trim();
            return !nextDbAllSet.has(esid) && !nextDbAllSet.has(clean);
          });
          const nextEligGap = Math.max(Math.abs(filteredEligibleSourceIds.length - nextDbElig), nextMissingElig.length);
          const nextBackfillFailed = (syncResult.backfillFailedIds || []).filter((id) => !recSet.has(str(id).replace(/^#+/, '').trim()) || recFailSet.has(str(id).replace(/^#+/, '').trim()));
          const nextComplete =
            recoveryRes.failedRecords.length === 0 &&
            nextMissingSrc.length === 0 &&
            incompleteEndpoints.length === 0 &&
            nextBackfillFailed.length === 0 &&
            syncResult.unfetchedSourceGap === 0 &&
            nextMissingElig.length === 0 &&
            nextEligGap === 0;
          syncResult = {
            ...syncResult,
            importedCount: syncResult.importedCount + recoveryRes.importedCount,
            updatedCount: syncResult.updatedCount + recoveryRes.updatedCount,
            savedOrUpdatedCount: syncResult.savedOrUpdatedCount + recoveryRes.savedOrUpdatedCount,
            dbTotalReservations: verifyRows.length,
            sourceEligibleCount: filteredEligibleSourceIds.length,
            dbEligibleCount: nextDbElig,
            eligibleCountGap: nextEligGap,
            missingEligibleIds: nextMissingElig,
            missingLocalCount: nextMissingSrc.length,
            missingSourceIds: nextMissingSrc,
            backfillFailedIds: nextBackfillFailed,
            failedRecords: recoveryRes.failedRecords,
            failedCount: recoveryRes.failedRecords.length,
            syncComplete: nextComplete,
            status: nextComplete ? 'success' : 'partial',
            reconciliation: {
              ...syncResult.reconciliation,
              importedCount: syncResult.importedCount + recoveryRes.importedCount,
              updatedCount: syncResult.updatedCount + recoveryRes.updatedCount,
              savedOrUpdatedCount: syncResult.savedOrUpdatedCount + recoveryRes.savedOrUpdatedCount,
              dbTotalReservations: verifyRows.length,
              sourceEligibleCount: filteredEligibleSourceIds.length,
              dbEligibleCount: nextDbElig,
              eligibleCountGap: nextEligGap,
              missingEligibleIds: nextMissingElig.slice(0, 100),
              missingLocalCount: nextMissingSrc.length,
              missingSourceIds: nextMissingSrc.slice(0, 100),
              backfillFailedIds: nextBackfillFailed.slice(0, 100),
              failedRecords: recoveryRes.failedRecords.slice(0, 100),
              failedCount: recoveryRes.failedRecords.length,
              syncComplete: nextComplete,
              verifiedAt: recoveryRes.finishedAt
            }
          };
          await executor.query(
            `UPDATE sync_checkpoints
             SET last_status = $2,
                 last_successful_at = CASE WHEN $2 = 'success' THEN $3::timestamptz ELSE last_successful_at END,
                 last_error = $4,
                 meta = $5::jsonb,
                 updated_at = $3::timestamptz
             WHERE source = 'rental_gate_direct'`,
            [
              'rental_gate_direct',
              syncResult.status,
              recoveryRes.finishedAt,
              nextComplete ? '' : `فرق المستحقة (${filteredEligibleSourceIds.length}/${nextDbElig}) · مفقود ${nextMissingSrc.length}`,
              JSON.stringify(syncResult.reconciliation)
            ]
          ).catch(() => undefined);
        }
      }
    }

    // Alert supervisors/admins and log whenever any discrepancy remains after auto-recovery
    const hasPersistentDiscrepancy =
      !syncResult.syncComplete ||
      syncResult.missingLocalCount > 0 ||
      syncResult.eligibleCountGap > 0 ||
      (syncResult.missingEligibleIds && syncResult.missingEligibleIds.length > 0);
    if (hasPersistentDiscrepancy && !appliedRange?.hasCustomRange) {
      const gapDesc = `عدم تطابق أعداد الحجوزات بعد المزامنة: المستحقة في Rental Gate (${syncResult.sourceEligibleCount}) مقابل CRM (${syncResult.dbEligibleCount}) · الفرق: ${syncResult.eligibleCountGap} · سجلات مفقودة: ${syncResult.missingLocalCount}`;
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[RG Sync Discrepancy] ${gapDesc}`, {
          missingSourceIds: syncResult.missingSourceIds.slice(0, 20),
          missingEligibleIds: syncResult.missingEligibleIds.slice(0, 20),
          incompleteEndpoints: syncResult.incompleteEndpoints
        });
      }
      await logBackendError(
        executor,
        'syncService',
        'reconciliationDiscrepancy',
        new Error(gapDesc),
        {
          sourceEligibleCount: syncResult.sourceEligibleCount,
          dbEligibleCount: syncResult.dbEligibleCount,
          eligibleCountGap: syncResult.eligibleCountGap,
          missingLocalCount: syncResult.missingLocalCount,
          missingEligibleIds: syncResult.missingEligibleIds.slice(0, 50),
          missingSourceIds: syncResult.missingSourceIds.slice(0, 50),
          incompleteEndpoints: syncResult.incompleteEndpoints
        }
      ).catch(() => undefined);

      const dayBucket = new Date().toISOString().slice(0, 10);
      const sigIds = syncResult.missingEligibleIds.slice(0, 6).join('_') || syncResult.missingSourceIds.slice(0, 6).join('_') || 'gap';
      const eventKey = `sync_gap:${dayBucket}:${syncResult.sourceEligibleCount}_${syncResult.dbEligibleCount}_${sigIds.replace(/[^A-Za-z0-9_.:|-]/g, '_').slice(0, 60)}`;
      for (const alertRole of ['general_manager', 'developer', 'supervisor']) {
        await executor.query(
          `INSERT INTO notifications (id, recipient_employee_id, recipient_role, type, title, message, entity_type, entity_id, is_read, created_at, updated_at, event_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW(),NOW(),$9)
           ON CONFLICT (event_key, recipient_employee_id, recipient_role) WHERE event_key <> '' DO NOTHING`,
          [
            generateId('NTF'),
            '',
            alertRole,
            'warning',
            'تنبيه: فرق في مطابقة أعداد الحجوزات مع Rental Gate',
            gapDesc,
            'Sync',
            syncResult.syncId,
            eventKey
          ]
        ).catch(() => undefined);
      }
    }

    if (serverCfg.gasWebAppUrl && Array.isArray(syncResult.mutatedReservations) && syncResult.mutatedReservations.length > 0) {
      const toMirror = syncResult.mutatedReservations.slice(0, 100);
      for (const r of toMirror) {
        await enqueueSheetsMirror(executor, 'Reservation', r.id, 'upsertReservation', r);
      }
      void flushSheetsMirrorOutbox(executor, fetchFn).catch(() => undefined);
    }

    const finishedIso = new Date().toISOString();
    await recordWorkerSyncOutcome(executor, {
      triggerType,
      startedAt: pullStartedIso,
      finishedAt: finishedIso,
      durationMs: Date.now() - pullStartedMs,
      ok: true,
      importedCount: syncResult.importedCount,
      updatedCount: syncResult.updatedCount,
      extensionsCount: syncResult.extensionsCount
    });
    await emitSyncWorkerStatusRealtime(executor, 'syncWorkerCompleted', actor?.id || 'SYSTEM_AUTO_SYNC').catch(() => undefined);

    return {
      ...syncResult,
      fetchedCount: resPaged.items.length,
      excludedFilteredCount,
      rangeFilteredCount
    };
  } catch (err: any) {
    const errIso = new Date().toISOString();
    const errMsg = String(err?.message || 'فشلت عملية السحب من Rental Gate API.');
    const durationMs = Math.max(1, Date.now() - pullStartedMs);
    await executor.query(
      `INSERT INTO sync_log (
        id, triggered_by_id, triggered_by_name, status, imported_count, updated_count,
        extensions_count, pages_fetched, error_message, duration_ms, started_at, finished_at
      ) VALUES ($1,$2,$3,'error',0,0,0,0,$4,$5,$6::timestamptz,$7::timestamptz)`,
      [
        generateId('SYNC'),
        str(actor?.id || 'SYSTEM_AUTO_SYNC'),
        str(actor?.name || 'المزامنة التلقائية'),
        errMsg.slice(0, 500),
        durationMs,
        pullStartedIso,
        errIso
      ]
    ).catch(() => undefined);
    await logBackendError(executor, 'syncService', `pullFromRentalGateDirect:${triggerType}`, err).catch(() => undefined);
    await recordWorkerSyncOutcome(executor, {
      triggerType,
      startedAt: pullStartedIso,
      finishedAt: errIso,
      durationMs,
      ok: false,
      errorMessage: errMsg
    });
    await emitSyncWorkerStatusRealtime(executor, 'syncWorkerError', actor?.id || 'SYSTEM_AUTO_SYNC').catch(() => undefined);
    throw err;
  } finally {
    activePullInFlight = false;
    await releaseSyncDistributedLock(executor, lockOwner).catch(() => undefined);
  }
}

export async function retryFailedSyncRecords(
  executor: DbExecutor,
  actor: SyncActor,
  payload: Record<string, any> = {},
  fetchFn: typeof fetch = fetch
): Promise<SyncIngestResult> {
  if (activePullInFlight) {
    throw new Error('SYNC_IN_PROGRESS: عملية المزامنة قيد التنفيذ بالفعل، يرجى الانتظار حتى اكتمال السحب الحالي.');
  }

  const ckRes = await executor.query(
    `SELECT * FROM sync_checkpoints ORDER BY updated_at DESC LIMIT 5`
  ).catch(() => ({ rows: [] as any[] }));
  const primaryCk = ckRes.rows.find((c: any) => str(c.source) === 'rental_gate_direct') || ckRes.rows[0] || null;
  let ckMeta: any = null;
  if (primaryCk?.meta) {
    try {
      ckMeta = typeof primaryCk.meta === 'string' ? JSON.parse(primaryCk.meta) : primaryCk.meta;
    } catch {
      ckMeta = null;
    }
  }

  const requestedIds = Array.isArray(payload?.recordIds)
    ? payload.recordIds.map((x: any) => str(x)).filter(Boolean)
    : [];
  const metaFailedIds = Array.isArray(ckMeta?.failedRecords)
    ? ckMeta.failedRecords.map((f: any) => str(f?.sourceReservationId || f?.reservationNumber || f?.identifier)).filter(Boolean)
    : [];
  const metaMissingIds = Array.isArray(ckMeta?.missingSourceIds)
    ? ckMeta.missingSourceIds.map((x: any) => str(x)).filter(Boolean)
    : [];
  const metaBackfillIds = Array.isArray(ckMeta?.backfillFailedIds)
    ? ckMeta.backfillFailedIds.map((x: any) => str(x)).filter(Boolean)
    : [];

  const targetIds = Array.from(new Set([...requestedIds, ...metaMissingIds, ...metaBackfillIds, ...metaFailedIds].filter(Boolean)));
  const hasEndpointGap = Array.isArray(ckMeta?.incompleteEndpoints) && ckMeta.incompleteEndpoints.length > 0;
  const hasUnfetchedGap = num(ckMeta?.unfetchedSourceGap, 0) > 0;

  // If endpoints were truncated or IDs aren't enumerable individually, re-run full authoritative pull cleanly
  if (hasEndpointGap || hasUnfetchedGap || targetIds.length === 0) {
    return pullFromRentalGateDirect(executor, actor, payload, fetchFn);
  }

  const serverCfg = await resolveServerConfig(executor);
  const rgToken = str(serverCfg.rgToken).replace(/^Bearer\s+/i, '');
  if (!rgToken) {
    throw new Error('NO_RG_TOKEN: يرجى إدخال توكن Rental Gate في الإعدادات (أو ضبط متغير RG_TOKEN على الخادم).');
  }

  activePullInFlight = true;
  try {
    const baseApi = str(serverCfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
    const recoveredItems: any[] = [];
    const stillFailedIds: string[] = [];

    for (const idChunk of chunkList(targetIds, 5)) {
      const batch = await Promise.all(
        idChunk.map(async (sid) => {
          try {
            const resp = await fetchFn(`${baseApi}/reservations/${encodeURIComponent(sid)}`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${rgToken}`, Accept: 'application/json', lang: 'ar' }
            });
            if (!resp.ok) return { sid, detail: null };
            const rawJson: any = await resp.json().catch(() => null);
            const inner =
              (rawJson?.data?.reservation && typeof rawJson.data.reservation === 'object' ? rawJson.data.reservation : null) ||
              (rawJson?.reservation && typeof rawJson.reservation === 'object' ? rawJson.reservation : null) ||
              (rawJson?.data && typeof rawJson.data === 'object' && !Array.isArray(rawJson.data) ? rawJson.data : null) ||
              (rawJson?.result && typeof rawJson.result === 'object' && !Array.isArray(rawJson.result) ? rawJson.result : null) ||
              rawJson;
            if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
              return { sid, detail: null };
            }
            return {
              sid,
              detail: {
                ...inner,
                reservationId: inner.reservationId ?? inner.reservation_id ?? inner.id ?? sid,
                clientName: inner.client?.name ?? inner.customer?.name ?? inner.clientName ?? inner.customer_name,
                clientMobile: inner.client?.mobile ?? inner.client?.phone ?? inner.customer?.mobile ?? inner.customer?.phone ?? inner.clientMobile ?? inner.customer_phone,
                companyArName: inner.companyCar?.company?.arabicName ?? inner.companyCar?.company?.name ?? inner.company?.arabicName ?? inner.company?.name ?? inner.companyArName,
                carNameAr: inner.companyCar?.car?.carNameAr ?? inner.car?.carNameAr ?? inner.carNameAr
              }
            };
          } catch {
            return { sid, detail: null };
          }
        })
      );
      for (const entry of batch) {
        if (entry.detail) recoveredItems.push(entry.detail);
        else stillFailedIds.push(entry.sid);
      }
    }

    return await ingestIncrementalSyncBatch(executor, {
      source: 'rental_gate_direct',
      actor,
      isFullSnapshot: false,
      isRetryPass: true,
      pagesFetched: targetIds.length,
      expectedSourceIds: targetIds,
      backfillFailedIds: stillFailedIds,
      totalInSource: num(ckMeta?.totalInSource, targetIds.length),
      reservations: recoveredItems,
      extensions: []
    });
  } finally {
    activePullInFlight = false;
  }
}

export interface IntegrityRgSnapshotResult {
  reservations: Record<string, any>[];
  extensions: Record<string, any>[];
  cancelledIdsCount: number;
  companyChangesCount: number;
  incompleteEndpoints: string[];
  pagesFetched: number;
}

export async function fetchRentalGateSnapshotReadOnly(
  executor: DbExecutor,
  opts: { scopes?: string[]; dateFrom?: string; dateTo?: string; maxPages?: number; singleSourceId?: string } = {},
  fetchFn: typeof fetch = fetch
): Promise<IntegrityRgSnapshotResult> {
  const serverCfg = await resolveServerConfig(executor);
  const rgToken = str(serverCfg.rgToken).replace(/^Bearer\s+/i, '');
  if (!rgToken) {
    throw new Error('NO_RG_TOKEN: يرجى إدخال توكن Rental Gate في الإعدادات (أو ضبط متغير RG_TOKEN على الخادم) لتشغيل فحص سلامة البيانات.');
  }

  const baseApi = str(serverCfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').replace(/\/+$/, '');
  const fetchJsonWithRetry = async (targetUrl: string): Promise<any> => {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 20000) : null;
      try {
        const resp = await fetchFn(targetUrl, {
          method: 'GET',
          signal: ctrl?.signal,
          headers: {
            Authorization: `Bearer ${rgToken}`,
            Accept: 'application/json',
            lang: 'ar'
          }
        });
        if (timer) clearTimeout(timer);
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          if ((resp.status >= 500 || resp.status === 429) && attempt < 3) {
            await new Promise((r) => setTimeout(r, 150 * attempt));
            continue;
          }
          throw new Error(`RG_API_HTTP_${resp.status}: ${text.slice(0, 140)}`);
        }
        return await resp.json().catch(() => null);
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    throw lastErr || new Error('RG_API_FETCH_FAILED');
  };

  if (opts.singleSourceId) {
    const sid = str(opts.singleSourceId).replace(/^#+/, '').trim();
    const rawJson = await fetchJsonWithRetry(`${baseApi}/reservations/${encodeURIComponent(sid)}`);
    const inner =
      (rawJson?.data?.reservation && typeof rawJson.data.reservation === 'object' ? rawJson.data.reservation : null) ||
      (rawJson?.reservation && typeof rawJson.reservation === 'object' ? rawJson.reservation : null) ||
      (rawJson?.data && typeof rawJson.data === 'object' && !Array.isArray(rawJson.data) ? rawJson.data : null) ||
      (rawJson?.result && typeof rawJson.result === 'object' && !Array.isArray(rawJson.result) ? rawJson.result : null) ||
      rawJson;
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      return {
        reservations: [],
        extensions: [],
        cancelledIdsCount: 0,
        companyChangesCount: 0,
        incompleteEndpoints: [],
        pagesFetched: 1
      };
    }
    const item = {
      ...inner,
      reservationId: inner.reservationId ?? inner.reservation_id ?? inner.id ?? sid,
      clientName: inner.client?.name ?? inner.customer?.name ?? inner.clientName ?? inner.customer_name,
      clientMobile: inner.client?.mobile ?? inner.client?.phone ?? inner.customer?.mobile ?? inner.customer?.phone ?? inner.clientMobile ?? inner.customer_phone,
      companyArName: inner.companyCar?.company?.arabicName ?? inner.companyCar?.company?.name ?? inner.company?.arabicName ?? inner.company?.name ?? inner.companyArName,
      companyEnName: inner.companyCar?.company?.englishName ?? inner.company?.englishName ?? inner.companyEnName,
      carNameEn: inner.companyCar?.car?.carNameEn ?? inner.car?.carNameEn ?? inner.carNameEn,
      carNameAr: inner.companyCar?.car?.carNameAr ?? inner.car?.carNameAr ?? inner.carNameAr
    };
    return {
      reservations: [item],
      extensions: [],
      cancelledIdsCount: 0,
      companyChangesCount: 0,
      incompleteEndpoints: [],
      pagesFetched: 1
    };
  }

  const pageSize = 100;
  const maxPages = Math.min(200, Math.max(1, num(opts.maxPages, 80)));
  const scopes = new Set(Array.isArray(opts.scopes) && opts.scopes.length ? opts.scopes : ['reservations', 'extensions', 'cancelled', 'company_changes']);
  const incompleteEndpoints: string[] = [];
  let totalPagesFetched = 0;

  const fetchPagedRo = async (endpoint: string, optional: boolean) => {
    const rows: any[] = [];
    const seen = new Set<string>();
    const visited = new Set<string>();
    let complete = true;
    for (let step = 0; step < maxPages; step++) {
      const url = `${baseApi}/${endpoint}?page=${step}&size=${pageSize}`;
      if (visited.has(url)) break;
      visited.add(url);
      let json: any;
      try {
        json = await fetchJsonWithRetry(url);
      } catch (err: any) {
        if (!optional) throw err;
        incompleteEndpoints.push(`${endpoint} (${str(err?.message).slice(0, 80)})`);
        complete = false;
        break;
      }
      totalPagesFetched++;
      const parsed = extractRentalGatePagePayload(json, step, pageSize);
      let added = 0;
      for (const r of parsed.rows) {
        const ek = str(r?.extendId || r?.extensionNumber || r?.extension_number);
        const rn = str(crmCore.extractReservationNumber(r)).replace(/^#+/, '').trim();
        const si = str(crmCore.extractSourceReservationId(r)).replace(/^#+/, '').trim();
        const key = ek || (si && rn && rn !== si ? `${si}::${rn}` : (si || rn));
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        rows.push(r);
        added++;
      }
      if (parsed.isLast || (parsed.rows.length > 0 && added === 0) || parsed.rows.length === 0) break;
    }
    return { rows, complete };
  };

  const [resPaged, extPaged, canPaged, rccPaged] = await Promise.all([
    scopes.has('reservations') ? fetchPagedRo('reservations/filter', false) : Promise.resolve({ rows: [] as any[], complete: true }),
    scopes.has('extensions') ? fetchPagedRo('reservation-extends/filter', true) : Promise.resolve({ rows: [] as any[], complete: true }),
    scopes.has('cancelled') ? fetchPagedRo('admin/cancelled-reservations', true) : Promise.resolve({ rows: [] as any[], complete: true }),
    scopes.has('company_changes') ? fetchPagedRo('reservation-company-changes/admin/filter', true) : Promise.resolve({ rows: [] as any[], complete: true })
  ]);

  const extractSid = (row: any) => str(row?.reservationId ?? row?.reservation_id ?? row?.sourceReservationId ?? row?.source_reservation_id ?? row?.reservation?.id ?? row?.id);
  const canMap = new Map<string, any>();
  for (const c of canPaged.rows) {
    const sid = extractSid(c);
    if (sid && !canMap.has(sid)) canMap.set(sid, c);
  }
  const rccMap = new Map<string, any>();
  for (const rc of rccPaged.rows) {
    const sid = extractSid(rc);
    if (sid && !rccMap.has(sid)) rccMap.set(sid, rc);
  }

  const enriched = resPaged.rows.map((rawItem: any) => {
    const sid = str(crmCore.extractSourceReservationId(rawItem) || crmCore.extractReservationNumber(rawItem));
    const cleanSid = sid.replace(/^#+/, '').trim();
    const canRec = (sid ? canMap.get(sid) : null) || (cleanSid ? canMap.get(cleanSid) : null);
    const rccRec = (sid ? rccMap.get(sid) : null) || (cleanSid ? rccMap.get(cleanSid) : null);
    const copy: Record<string, any> = { ...rawItem };
    if (canRec) copy.isSourceCancelled = true;
    if (rccRec) {
      copy.rccStatus = str(rccRec.status);
      copy.rccReason = str(rccRec.reason);
      if (rccRec.targetCompanyName) copy.newCompanyName = str(rccRec.targetCompanyName);
      if (!canRec) copy.isSourceRejected = true;
    }
    return copy;
  });

  const dedupedRes = crmCore.dedupeReservationsByNumber(enriched);
  const filteredRes = (opts.dateFrom || opts.dateTo)
    ? crmCore.filterSourceReservationsByPullRange(dedupedRes, {
        hasCustomRange: true,
        dateFrom: str(opts.dateFrom),
        dateTo: str(opts.dateTo)
      })
    : dedupedRes;
  const dedupedExt = crmCore.dedupeExtensionsByNumber(extPaged.rows);

  return {
    reservations: filteredRes,
    extensions: dedupedExt,
    cancelledIdsCount: canMap.size,
    companyChangesCount: rccMap.size,
    incompleteEndpoints,
    pagesFetched: totalPagesFetched
  };
}

