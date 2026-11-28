export type OutboxCanonicalStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed'
  | 'dead_letter'
  | 'unknown';

export type OutboxPreviewClassification =
  | 'safe_to_archive'
  | 'keep_active'
  | 'manual_review';

export interface OutboxPreviewInputRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  idempotencyKey?: string;
  correlationId?: string;
  batchId?: string;
  errorCategory?: string;
  lastError?: string;
  payload?: unknown;
  payloadBytes?: number;
  errorHistory?: unknown;
  lastErrorDetails?: unknown;
  createdAt?: string;
  updatedAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  syncedAt?: string;
  processedAt?: string;
  finishedAt?: string;
  nextRetryAt?: string;
}

export interface OutboxPreviewClassifiedRow extends OutboxPreviewInputRow {
  canonicalStatus: OutboxCanonicalStatus;
  rawStatus: string;
  isLegacyStatus: boolean;
  classification: OutboxPreviewClassification;
  classificationLabelAr: string;
  uncertainResult: boolean;
  hasVerifiedReceipt: boolean;
  completionTimestamp: string;
  reasonAr: string;
  estimatedPayloadBytes: number;
}

export interface OutboxBreakdownItem {
  action: string;
  entityType: string;
  totalCount: number;
  completedCount: number;
  deadLetterCount: number;
  retryCount: number;
  pendingCount: number;
  processingCount: number;
  safeToArchiveCount: number;
  manualReviewCount: number;
  uncertainCount: number;
  estimatedPayloadBytes: number;
}

export interface OutboxPreviewFilterOptions {
  status?: string;
  classification?: string;
  actionType?: string;
  entityType?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  olderThanDays?: number;
  page?: number;
  pageSize?: number;
}

export interface StaticTimestampAuditFinding {
  id: string;
  severity: 'critical' | 'info';
  tableName: string;
  columnName: string;
  schemaType: string;
  codeLocation: string;
  issueTitleAr: string;
  detailAr: string;
  recommendedFixAr: string;
  statusAr: string;
}

function cleanStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function normalizeOutboxStatus(rawStatus: unknown): {
  canonical: OutboxCanonicalStatus;
  raw: string;
  isLegacy: boolean;
} {
  const raw = cleanStr(rawStatus).toLowerCase();
  if (!raw) return { canonical: 'unknown', raw: '', isLegacy: false };
  if (raw === 'completed') return { canonical: 'completed', raw, isLegacy: false };
  if (raw === 'sent') return { canonical: 'completed', raw, isLegacy: true };
  if (raw === 'dead_letter') return { canonical: 'dead_letter', raw, isLegacy: false };
  if (raw === 'failed') return { canonical: 'dead_letter', raw, isLegacy: true };
  if (raw === 'retry') return { canonical: 'retry', raw, isLegacy: false };
  if (raw === 'pending') return { canonical: 'pending', raw, isLegacy: false };
  if (raw === 'processing') return { canonical: 'processing', raw, isLegacy: false };
  return { canonical: 'unknown', raw, isLegacy: true };
}

export function estimateUtf8Bytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) || '';
    } catch {
      text = String(value);
    }
  }
  if (!text) return 0;
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(text, 'utf8');
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

export function estimateJsonPayloadBytes(
  payload: unknown,
  errorHistory?: unknown,
  lastErrorDetails?: unknown
): number {
  return (
    estimateUtf8Bytes(payload) +
    estimateUtf8Bytes(errorHistory) +
    estimateUtf8Bytes(lastErrorDetails)
  );
}

export function classifyOutboxPreviewItem(
  item: OutboxPreviewInputRow,
  olderThanDays = 0,
  nowMs = Date.now()
): OutboxPreviewClassifiedRow {
  const norm = normalizeOutboxStatus(item.status);
  const completionTimestamp =
    cleanStr(item.lastSuccessAt) ||
    cleanStr(item.syncedAt) ||
    cleanStr(item.processedAt) ||
    cleanStr(item.finishedAt);
  const hasVerifiedReceipt = Boolean(completionTimestamp);
  const action = cleanStr(item.action);
  const entityType = cleanStr(item.entityType);
  const idempotencyKey = cleanStr(item.idempotencyKey);
  const lastError = cleanStr(item.lastError);
  const errorCategory = cleanStr(item.errorCategory).toLowerCase();
  const estBytes =
    typeof item.payloadBytes === 'number' && Number.isFinite(item.payloadBytes) && item.payloadBytes >= 0
      ? Math.round(item.payloadBytes)
      : estimateJsonPayloadBytes(item.payload, item.errorHistory, item.lastErrorDetails);

  let classification: OutboxPreviewClassification = 'manual_review';
  let classificationLabelAr = 'مراجعة يدوية';
  let uncertainResult = false;
  let reasonAr = '';

  const isBulkDelete = action === 'deleteAllReservations';
  const minAgeDays = Number.isFinite(Number(olderThanDays)) && Number(olderThanDays) > 0 ? Number(olderThanDays) : 0;
  const ageAnchor = completionTimestamp || cleanStr(item.updatedAt) || cleanStr(item.createdAt);
  const anchorMs = ageAnchor ? Date.parse(ageAnchor) : NaN;
  const ageDays = Number.isFinite(anchorMs) ? Math.max(0, (nowMs - anchorMs) / 86400000) : 0;
  const meetsAgeThreshold = minAgeDays === 0 || (Number.isFinite(anchorMs) && ageDays >= minAgeDays);

  if (isBulkDelete) {
    classification = 'manual_review';
    classificationLabelAr = 'مراجعة يدوية';
    uncertainResult = false;
    reasonAr = 'عملية حذف جماعي محجوزة/حساسة — مستثناة من التنظيف التلقائي وتستلزم مراجعة المبرمج.';
  } else if (norm.canonical === 'completed') {
    if (!hasVerifiedReceipt) {
      classification = 'manual_review';
      classificationLabelAr = 'نتيجة غير مؤكدة';
      uncertainResult = true;
      reasonAr = 'الحالة مكتملة ولكن بدون طابع إيصال نجاح (last_success_at/synced_at/processed_at) — مستثناة من الأرشفة التلقائية.';
    } else if (!meetsAgeThreshold) {
      classification = 'keep_active';
      classificationLabelAr = 'تبقى نشطة (ضمن نافذة الاحتفاظ)';
      uncertainResult = false;
      reasonAr = `مكتملة ومؤكدة لكنها أحدث من حد المعاينة (${minAgeDays} يوم).`;
    } else {
      classification = 'safe_to_archive';
      classificationLabelAr = 'آمن للأرشفة (المرحلة 3)';
      uncertainResult = false;
      reasonAr = 'عملية مكتملة ومؤكدة بإيصال نجاح — مرشحة آمنة للأرشفة في المرحلة 3.';
    }
  } else if (norm.canonical === 'dead_letter') {
    classification = 'manual_review';
    classificationLabelAr = 'مراجعة يدوية (فشل نهائي)';
    uncertainResult = /timeout|network|unknown|5xx|upstream/i.test(errorCategory || lastError);
    reasonAr = uncertainResult
      ? 'عملية dead_letter بسبب مهلة أو خطأ شبكة غير حاسم — قد تكون وصلت للطرف الآخر وتلزمها مراجعة قبل أي إجراء.'
      : 'عملية dead_letter فاشلة — تُحفظ للمراجعة أو إعادة المعالجة ولا تُحذف تلقائياً.';
  } else if (norm.canonical === 'pending' || norm.canonical === 'processing' || norm.canonical === 'retry') {
    classification = 'keep_active';
    classificationLabelAr = 'تبقى نشطة في الطابور';
    uncertainResult = norm.canonical === 'processing';
    reasonAr =
      norm.canonical === 'retry'
        ? 'مجدولة لإعادة المحاولة — تبقى نشطة في طابور الإرسال.'
        : norm.canonical === 'processing'
          ? 'حالتها قيد المعالجة الحالية — تبقى محمية من أي تنظيف.'
          : 'عملية منتظرة لم تُرسل بعد — تبقى نشطة في الطابور.';
  } else {
    classification = 'manual_review';
    classificationLabelAr = 'مراجعة يدوية (حالة غير معروفة)';
    uncertainResult = true;
    reasonAr = `حالة غير قياسية (${norm.raw || 'فارغة'}) تستلزم مراجعة المبرمج.`;
  }

  if (
    !idempotencyKey &&
    (norm.canonical === 'pending' || norm.canonical === 'processing' || norm.canonical === 'retry')
  ) {
    uncertainResult = true;
    reasonAr += ' (مفتاح idempotency_key غير موجود).';
  }

  return {
    ...item,
    action,
    entityType,
    canonicalStatus: norm.canonical,
    rawStatus: norm.raw,
    isLegacyStatus: norm.isLegacy,
    classification,
    classificationLabelAr,
    uncertainResult,
    hasVerifiedReceipt,
    completionTimestamp,
    reasonAr,
    estimatedPayloadBytes: estBytes
  };
}

export function filterAndPaginateOutboxItems(
  rows: OutboxPreviewClassifiedRow[],
  filters: OutboxPreviewFilterOptions = {}
): {
  filtered: OutboxPreviewClassifiedRow[];
  paged: OutboxPreviewClassifiedRow[];
  totalFiltered: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const statusFilter = cleanStr(filters.status).toLowerCase();
  const classFilter = cleanStr(filters.classification).toLowerCase();
  const actionFilter = cleanStr(filters.actionType);
  const entityFilter = cleanStr(filters.entityType);
  const search = cleanStr(filters.search).toLowerCase();
  const dateFromMs = filters.dateFrom ? Date.parse(String(filters.dateFrom)) : NaN;
  const dateToRaw = cleanStr(filters.dateTo);
  const dateToIso = /^\d{4}-\d{2}-\d{2}$/.test(dateToRaw) ? `${dateToRaw}T23:59:59.999Z` : dateToRaw;
  const dateToMs = dateToIso ? Date.parse(dateToIso) : NaN;

  const filtered = rows.filter((row) => {
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'sent' || statusFilter === 'failed') {
        if (row.rawStatus !== statusFilter) return false;
      } else if (row.canonicalStatus !== statusFilter) {
        return false;
      }
    }
    if (classFilter && classFilter !== 'all') {
      if (classFilter === 'uncertain_result') {
        if (!row.uncertainResult) return false;
      } else if (row.classification !== classFilter) {
        return false;
      }
    }
    if (actionFilter && actionFilter !== 'all' && row.action !== actionFilter) return false;
    if (entityFilter && entityFilter !== 'all' && row.entityType !== entityFilter) return false;

    if (Number.isFinite(dateFromMs) || Number.isFinite(dateToMs)) {
      const rowMs = row.createdAt ? Date.parse(row.createdAt) : NaN;
      if (!Number.isFinite(rowMs)) return false;
      if (Number.isFinite(dateFromMs) && rowMs < dateFromMs) return false;
      if (Number.isFinite(dateToMs) && rowMs > dateToMs) return false;
    }

    if (search) {
      const hay = [
        row.id,
        row.entityId,
        row.entityType,
        row.action,
        row.correlationId,
        row.batchId,
        row.idempotencyKey,
        row.lastError,
        row.errorCategory,
        row.rawStatus,
        row.canonicalStatus,
        typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload || '')
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const pageSize = Math.min(100, Math.max(10, Math.round(Number(filters.pageSize || 25))));
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.round(Number(filters.page || 1))));
  const offset = (page - 1) * pageSize;

  return {
    filtered,
    paged: filtered.slice(offset, offset + pageSize),
    totalFiltered,
    page,
    pageSize,
    totalPages
  };
}

export function summarizeOutboxPreviewRows(
  rows: OutboxPreviewClassifiedRow[],
  tableSizeBytes: number | null = null
) {
  let completed = 0;
  let deadLetter = 0;
  let retry = 0;
  let pending = 0;
  let processing = 0;
  let unknown = 0;
  let legacySent = 0;
  let legacyFailed = 0;
  let safeToArchiveCount = 0;
  let keepActiveCount = 0;
  let manualReviewCount = 0;
  let uncertainResultCount = 0;
  let estimatedTotalPayloadBytes = 0;
  let estimatedSafeArchivePayloadBytes = 0;
  let oldestCreatedAt = '';
  let newestCreatedAt = '';
  let oldestSafeArchiveAt = '';
  let newestSafeArchiveAt = '';
  let lastSuccessAt = '';
  let lastAttemptAt = '';
  let lastErrorAt = '';
  let lastError = '';

  const breakdownMap = new Map<string, OutboxBreakdownItem>();

  for (const r of rows) {
    if (r.canonicalStatus === 'completed') completed += 1;
    else if (r.canonicalStatus === 'dead_letter') deadLetter += 1;
    else if (r.canonicalStatus === 'retry') retry += 1;
    else if (r.canonicalStatus === 'pending') pending += 1;
    else if (r.canonicalStatus === 'processing') processing += 1;
    else unknown += 1;

    if (r.rawStatus === 'sent') legacySent += 1;
    if (r.rawStatus === 'failed') legacyFailed += 1;

    if (r.classification === 'safe_to_archive') {
      safeToArchiveCount += 1;
      estimatedSafeArchivePayloadBytes += r.estimatedPayloadBytes;
      const anchor = r.completionTimestamp || r.createdAt || '';
      if (anchor) {
        if (!oldestSafeArchiveAt || anchor < oldestSafeArchiveAt) oldestSafeArchiveAt = anchor;
        if (!newestSafeArchiveAt || anchor > newestSafeArchiveAt) newestSafeArchiveAt = anchor;
      }
    } else if (r.classification === 'keep_active') {
      keepActiveCount += 1;
    } else {
      manualReviewCount += 1;
    }

    if (r.uncertainResult) uncertainResultCount += 1;
    estimatedTotalPayloadBytes += r.estimatedPayloadBytes;

    if (r.createdAt) {
      if (!oldestCreatedAt || r.createdAt < oldestCreatedAt) oldestCreatedAt = r.createdAt;
      if (!newestCreatedAt || r.createdAt > newestCreatedAt) newestCreatedAt = r.createdAt;
    }
    if (r.completionTimestamp && (!lastSuccessAt || r.completionTimestamp > lastSuccessAt)) {
      lastSuccessAt = r.completionTimestamp;
    }
    if (r.lastAttemptAt && (!lastAttemptAt || r.lastAttemptAt > lastAttemptAt)) {
      lastAttemptAt = r.lastAttemptAt;
    }
    if (r.lastError) {
      const errTs = r.lastAttemptAt || r.updatedAt || r.createdAt || '';
      if (!lastErrorAt || errTs >= lastErrorAt) {
        lastErrorAt = errTs;
        lastError = r.lastError;
      }
    }

    const bKey = `${r.action || 'unknown'}::${r.entityType || 'unknown'}`;
    const prev = breakdownMap.get(bKey) || {
      action: r.action || 'unknown',
      entityType: r.entityType || 'unknown',
      totalCount: 0,
      completedCount: 0,
      deadLetterCount: 0,
      retryCount: 0,
      pendingCount: 0,
      processingCount: 0,
      safeToArchiveCount: 0,
      manualReviewCount: 0,
      uncertainCount: 0,
      estimatedPayloadBytes: 0
    };
    prev.totalCount += 1;
    if (r.canonicalStatus === 'completed') prev.completedCount += 1;
    else if (r.canonicalStatus === 'dead_letter') prev.deadLetterCount += 1;
    else if (r.canonicalStatus === 'retry') prev.retryCount += 1;
    else if (r.canonicalStatus === 'pending') prev.pendingCount += 1;
    else if (r.canonicalStatus === 'processing') prev.processingCount += 1;
    if (r.classification === 'safe_to_archive') prev.safeToArchiveCount += 1;
    else if (r.classification === 'manual_review') prev.manualReviewCount += 1;
    if (r.uncertainResult) prev.uncertainCount += 1;
    prev.estimatedPayloadBytes += r.estimatedPayloadBytes;
    breakdownMap.set(bKey, prev);
  }

  return {
    total: rows.length,
    statusCounts: {
      completed,
      dead_letter: deadLetter,
      retry,
      pending,
      processing,
      unknown,
      legacySent,
      legacyFailed
    },
    classificationCounts: {
      safeToArchive: safeToArchiveCount,
      keepActive: keepActiveCount,
      manualReview: manualReviewCount,
      uncertainResult: uncertainResultCount
    },
    estimatedTotalPayloadBytes,
    estimatedSafeArchivePayloadBytes,
    tableTotalBytes: tableSizeBytes,
    oldestCreatedAt,
    newestCreatedAt,
    oldestSafeArchiveAt,
    newestSafeArchiveAt,
    lastSuccessAt,
    lastAttemptAt,
    lastError,
    lastErrorAt,
    breakdown: Array.from(breakdownMap.values()).sort((a, b) => b.totalCount - a.totalCount)
  };
}

export function getStaticSchemaTimestampAuditFindings(): StaticTimestampAuditFinding[] {
  return [
    {
      id: 'TS_AUDIT_CUSTOMER_NOTES_CLOSED_AT',
      severity: 'info',
      tableName: 'customer_notes',
      columnName: 'closed_at',
      schemaType: 'TIMESTAMPTZ DEFAULT NULL',
      codeLocation: 'backend/queries.ts (addCustomerNote INSERT)',
      issueTitleAr: 'تم إصلاح تضارب نوع closed_at عند إضافة ملاحظة عميل ($17::timestamptz)',
      detailAr:
        'الجدول customer_notes يعرّف العمود closed_at من نوع TIMESTAMPTZ في database/schema.sql:693، وقد تم تعديل استعلام INSERT في addCustomerNote ليمرر المعامل كـ $17::timestamptz أو NULL الحقيقي مع دالة normalizeOptionalTimestamptz.',
      recommendedFixAr:
        'تم الإصلاح بالكامل مع الإبقاء على نوع العمود TIMESTAMPTZ في PostgreSQL كما هو.',
      statusAr: 'تم الإصلاح — متطابق مع TIMESTAMPTZ'
    },
    {
      id: 'TS_AUDIT_TEXT_LEGACY_DATES',
      severity: 'info',
      tableName: 'reservations / follow_ups / delegations / announcements',
      columnName: 'rejected_at, cancelled_at, follow_up_date, starts_at, expires_at',
      schemaType: 'TEXT',
      codeLocation: 'database/schema.sql & backend/queries.ts',
      issueTitleAr: 'أعمدة التواريخ النصية المقصودة في المخطط (متوافقة حالياً بدون أخطاء نوع)',
      detailAr:
        'الأعمدة rejected_at وcancelled_at وfollow_up_date وlast_contact_at وstarts_at/expires_at في الجداول المذكورة معرّفة كـ TEXT في المخطط وتستقبل معاملات ::text بشكل متطابق دون تضارب مع PostgreSQL.',
      recommendedFixAr: 'لا يلزم أي تعديل فوري للحفاظ على التوافق التام مع بيانات Rental Gate وواجهة CRM.',
      statusAr: 'سليم ومتطابق'
    },
    {
      id: 'TS_AUDIT_OUTBOX_TIMESTAMPS',
      severity: 'info',
      tableName: 'sheets_mirror_outbox',
      columnName: 'created_at, updated_at, next_retry_at, last_attempt_at, last_success_at, synced_at, processed_at, finished_at',
      schemaType: 'TIMESTAMPTZ',
      codeLocation: 'database/schema.sql:388-417 & backend/syncService.ts',
      issueTitleAr: 'طوابع دورة حياة Outbox متسقة (TIMESTAMPTZ)',
      detailAr:
        'جميع طوابع الإيصال والمحاولات والأقفال في sheets_mirror_outbox من نوع TIMESTAMPTZ وتُكتب عبر NOW() أو ::timestamptz، وهي المصدر المعتمد في تصنيف المعاينة للأمان.',
      recommendedFixAr: 'في المرحلة 3 يُنشأ جدول أرشيف مطابق بنفس أنواع TIMESTAMPTZ للحفاظ على سلامة السجل التاريخي.',
      statusAr: 'سليم ومتطابق'
    }
  ];
}
