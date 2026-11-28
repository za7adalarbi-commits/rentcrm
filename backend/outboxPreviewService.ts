import { crmCore, type AuthSession } from './auth.js';
import type { DbExecutor } from './db.js';
import { redactSensitiveText } from './logger.js';
import {
  classifyOutboxPreviewItem,
  getStaticSchemaTimestampAuditFindings,
  type OutboxPreviewInputRow
} from './outboxPreviewLogic.js';
import { getRgTokenDiagnostics, getSyncSecretDiagnostics, resolveServerConfig } from './serverConfig.js';

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : '';
  return String(v).trim();
}

export function assertDeveloperPreviewAccess(session: AuthSession | null | undefined): void {
  if (
    !session ||
    session.role !== 'developer' ||
    !crmCore.canUserPerform(session.user, 'manage_developer_tools')
  ) {
    throw new Error('FORBIDDEN: معاينة Outbox والتحكم في المزامنة متاحة للمبرمج (Developer) فقط.');
  }
}

async function queryOptionalReadOnly<T = any>(
  executor: DbExecutor,
  sql: string,
  params: any[] = []
): Promise<{ ok: boolean; rows: T[]; error?: string }> {
  try {
    const res = await executor.query(sql, params);
    return { ok: true, rows: (res?.rows || []) as T[] };
  } catch (err: any) {
    return { ok: false, rows: [], error: redactSensitiveText(err?.message || err) };
  }
}

export async function getOutboxCleanupPreview(
  executor: DbExecutor,
  session: AuthSession,
  payload: Record<string, any> = {}
) {
  assertDeveloperPreviewAccess(session);

  const statusFilter = str(payload.status || 'all').toLowerCase();
  const classFilter = str(payload.classification || 'all').toLowerCase();
  const actionType = str(payload.actionType || '');
  const entityType = str(payload.entityType || '');
  const search = str(payload.search || '');
  const dateFrom = str(payload.dateFrom || '');
  const dateTo = str(payload.dateTo || '');
  const olderThanDays = Math.max(0, Math.min(3650, Math.round(num(payload.olderThanDays, 0))));
  const pageSize = Math.min(100, Math.max(10, Math.round(num(payload.pageSize, 25))));
  const requestedPage = Math.max(1, Math.round(num(payload.page, 1)));

  const queryErrors: Array<{ step: string; message: string }> = [];

  // 1. Aggregate summary directly from Neon sheets_mirror_outbox (Read-Only)
  const summarySql = `
    SELECT
      COUNT(*)::int AS total_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent'))::int AS completed_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'completed')::int AS canonical_completed_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'sent')::int AS legacy_sent_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed'))::int AS dead_letter_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'dead_letter')::int AS canonical_dead_letter_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'failed')::int AS legacy_failed_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'retry')::int AS retry_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'pending')::int AS pending_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'processing')::int AS processing_cnt,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing'))::int AS unknown_cnt,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent')
          AND COALESCE(action, '') <> 'deleteAllReservations'
          AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
          AND ($1::int = 0 OR COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) <= NOW() - ($1::int * INTERVAL '1 day'))
      )::int AS safe_to_archive_cnt,
      COUNT(*) FILTER (
        WHERE COALESCE(action, '') <> 'deleteAllReservations'
          AND (
            LOWER(COALESCE(status, '')) IN ('pending', 'processing', 'retry')
            OR (
              LOWER(COALESCE(status, '')) IN ('completed', 'sent')
              AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
              AND $1::int > 0
              AND COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) > NOW() - ($1::int * INTERVAL '1 day')
            )
          )
      )::int AS keep_active_cnt,
      COUNT(*) FILTER (
        WHERE COALESCE(action, '') = 'deleteAllReservations'
          OR LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')
          OR LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing')
          OR (
            LOWER(COALESCE(status, '')) IN ('completed', 'sent')
            AND last_success_at IS NULL
            AND synced_at IS NULL
            AND processed_at IS NULL
            AND finished_at IS NULL
          )
      )::int AS manual_review_cnt,
      COUNT(*) FILTER (
        WHERE (
          LOWER(COALESCE(status, '')) IN ('completed', 'sent')
          AND last_success_at IS NULL
          AND synced_at IS NULL
          AND processed_at IS NULL
          AND finished_at IS NULL
        )
        OR (
          LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')
          AND LOWER(COALESCE(error_category, '') || ' ' || COALESCE(last_error, '')) ~ '(timeout|network|unknown|5xx|upstream)'
        )
        OR LOWER(COALESCE(status, '')) = 'processing'
        OR LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing')
        OR (
          LOWER(COALESCE(status, '')) IN ('pending', 'processing', 'retry')
          AND COALESCE(idempotency_key, '') = ''
        )
      )::int AS uncertain_cnt,
      COALESCE(SUM(
        OCTET_LENGTH(COALESCE(payload::text, '')) +
        OCTET_LENGTH(COALESCE(error_history_json::text, '')) +
        OCTET_LENGTH(COALESCE(last_error_details_json::text, ''))
      ), 0)::bigint AS total_payload_bytes,
      COALESCE(SUM(
        CASE WHEN (
          LOWER(COALESCE(status, '')) IN ('completed', 'sent')
          AND COALESCE(action, '') <> 'deleteAllReservations'
          AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
          AND ($1::int = 0 OR COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) <= NOW() - ($1::int * INTERVAL '1 day'))
        ) THEN (
          OCTET_LENGTH(COALESCE(payload::text, '')) +
          OCTET_LENGTH(COALESCE(error_history_json::text, '')) +
          OCTET_LENGTH(COALESCE(last_error_details_json::text, ''))
        ) ELSE 0 END
      ), 0)::bigint AS safe_archive_payload_bytes,
      MIN(created_at) AS oldest_created_at,
      MAX(created_at) AS newest_created_at,
      MIN(COALESCE(last_success_at, synced_at, processed_at, finished_at, created_at)) FILTER (
        WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent')
          AND COALESCE(action, '') <> 'deleteAllReservations'
          AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
      ) AS oldest_safe_archive_at,
      MAX(COALESCE(last_success_at, synced_at, processed_at, finished_at, created_at)) FILTER (
        WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent')
          AND COALESCE(action, '') <> 'deleteAllReservations'
          AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
      ) AS newest_safe_archive_at,
      MAX(COALESCE(last_success_at, synced_at, processed_at, finished_at)) AS last_success_at,
      MAX(last_attempt_at) AS last_attempt_at
    FROM sheets_mirror_outbox
  `;

  const [summaryQ, sizeQ, breakdownQ, facetsQ, coreCountsQ] = await Promise.all([
    queryOptionalReadOnly(executor, summarySql, [olderThanDays]),
    queryOptionalReadOnly(
      executor,
      `SELECT
        CASE WHEN to_regclass('public.sheets_mirror_outbox') IS NOT NULL
          THEN pg_total_relation_size('sheets_mirror_outbox')::bigint
          ELSE 0::bigint
        END AS table_total_bytes,
        CASE WHEN to_regclass('public.sheets_mirror_outbox') IS NOT NULL
          THEN pg_relation_size('sheets_mirror_outbox')::bigint
          ELSE 0::bigint
        END AS table_heap_bytes`
    ),
    queryOptionalReadOnly(
      executor,
      `SELECT
        COALESCE(NULLIF(action, ''), 'unknown') AS action,
        COALESCE(NULLIF(entity_type, ''), 'unknown') AS entity_type,
        COUNT(*)::int AS total_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent'))::int AS completed_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed'))::int AS dead_letter_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'retry')::int AS retry_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'pending')::int AS pending_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'processing')::int AS processing_cnt,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent')
            AND COALESCE(action, '') <> 'deleteAllReservations'
            AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
            AND ($1::int = 0 OR COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) <= NOW() - ($1::int * INTERVAL '1 day'))
        )::int AS safe_to_archive_cnt,
        COUNT(*) FILTER (
          WHERE COALESCE(action, '') = 'deleteAllReservations'
            OR LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')
            OR LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing')
            OR (
              LOWER(COALESCE(status, '')) IN ('completed', 'sent')
              AND last_success_at IS NULL
              AND synced_at IS NULL
              AND processed_at IS NULL
              AND finished_at IS NULL
            )
        )::int AS manual_review_cnt,
        COALESCE(SUM(
          OCTET_LENGTH(COALESCE(payload::text, '')) +
          OCTET_LENGTH(COALESCE(error_history_json::text, '')) +
          OCTET_LENGTH(COALESCE(last_error_details_json::text, ''))
        ), 0)::bigint AS estimated_payload_bytes
      FROM sheets_mirror_outbox
      GROUP BY 1, 2
      ORDER BY total_cnt DESC`,
      [olderThanDays]
    ),
    queryOptionalReadOnly(
      executor,
      `SELECT
        ARRAY(SELECT DISTINCT action FROM sheets_mirror_outbox WHERE COALESCE(action, '') <> '' ORDER BY action) AS actions,
        ARRAY(SELECT DISTINCT entity_type FROM sheets_mirror_outbox WHERE COALESCE(entity_type, '') <> '' ORDER BY entity_type) AS entity_types`
    ),
    queryOptionalReadOnly(
      executor,
      `SELECT
        (SELECT COUNT(*)::int FROM reservations) AS reservations_cnt,
        (SELECT COUNT(*)::int FROM customers) AS customers_cnt,
        (SELECT COUNT(*)::int FROM extensions) AS extensions_cnt,
        (SELECT COUNT(*)::int FROM follow_ups) AS follow_ups_cnt,
        (SELECT COUNT(*)::int FROM problems) AS problems_cnt,
        (SELECT COUNT(*)::int FROM customer_notes) AS customer_notes_cnt,
        (SELECT COUNT(*)::int FROM notifications) AS notifications_cnt`
    )
  ]);

  if (!summaryQ.ok && summaryQ.error) queryErrors.push({ step: 'summary', message: summaryQ.error });
  if (!breakdownQ.ok && breakdownQ.error) queryErrors.push({ step: 'breakdown', message: breakdownQ.error });
  if (!coreCountsQ.ok && coreCountsQ.error) queryErrors.push({ step: 'core_counts', message: coreCountsQ.error });

  // 2. Build parameterized WHERE clause for paginated filtered preview rows
  const params: any[] = [olderThanDays];
  const whereClauses: string[] = [];

  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'completed') {
      whereClauses.push(`LOWER(COALESCE(status, '')) IN ('completed', 'sent')`);
    } else if (statusFilter === 'dead_letter') {
      whereClauses.push(`LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')`);
    } else {
      params.push(statusFilter);
      whereClauses.push(`LOWER(COALESCE(status, '')) = $${params.length}`);
    }
  }

  if (classFilter && classFilter !== 'all') {
    if (classFilter === 'safe_to_archive') {
      whereClauses.push(
        `LOWER(COALESCE(status, '')) IN ('completed', 'sent')
         AND COALESCE(action, '') <> 'deleteAllReservations'
         AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
         AND ($1::int = 0 OR COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) <= NOW() - ($1::int * INTERVAL '1 day'))`
      );
    } else if (classFilter === 'keep_active') {
      whereClauses.push(
        `COALESCE(action, '') <> 'deleteAllReservations'
         AND (
           LOWER(COALESCE(status, '')) IN ('pending', 'processing', 'retry')
           OR (
             LOWER(COALESCE(status, '')) IN ('completed', 'sent')
             AND (last_success_at IS NOT NULL OR synced_at IS NOT NULL OR processed_at IS NOT NULL OR finished_at IS NOT NULL)
             AND $1::int > 0
             AND COALESCE(last_success_at, synced_at, processed_at, finished_at, updated_at, created_at) > NOW() - ($1::int * INTERVAL '1 day')
           )
         )`
      );
    } else if (classFilter === 'manual_review') {
      whereClauses.push(
        `(
          COALESCE(action, '') = 'deleteAllReservations'
          OR LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')
          OR LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing')
          OR (
            LOWER(COALESCE(status, '')) IN ('completed', 'sent')
            AND last_success_at IS NULL
            AND synced_at IS NULL
            AND processed_at IS NULL
            AND finished_at IS NULL
          )
        )`
      );
    } else if (classFilter === 'uncertain_result') {
      whereClauses.push(
        `(
          (
            LOWER(COALESCE(status, '')) IN ('completed', 'sent')
            AND last_success_at IS NULL
            AND synced_at IS NULL
            AND processed_at IS NULL
            AND finished_at IS NULL
          )
          OR (
            LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed')
            AND LOWER(COALESCE(error_category, '') || ' ' || COALESCE(last_error, '')) ~ '(timeout|network|unknown|5xx|upstream)'
          )
          OR LOWER(COALESCE(status, '')) = 'processing'
          OR LOWER(COALESCE(status, '')) NOT IN ('completed', 'sent', 'dead_letter', 'failed', 'retry', 'pending', 'processing')
          OR (
            LOWER(COALESCE(status, '')) IN ('pending', 'processing', 'retry')
            AND COALESCE(idempotency_key, '') = ''
          )
        )`
      );
    }
  }

  if (actionType && actionType !== 'all') {
    params.push(actionType);
    whereClauses.push(`action = $${params.length}`);
  }
  if (entityType && entityType !== 'all') {
    params.push(entityType);
    whereClauses.push(`entity_type = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    whereClauses.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    const endTs = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
    params.push(endTs);
    whereClauses.push(`created_at <= $${params.length}::timestamptz`);
  }
  if (search) {
    params.push(`%${search}%`);
    const sp = `$${params.length}`;
    whereClauses.push(
      `(
        id ILIKE ${sp}
        OR entity_id ILIKE ${sp}
        OR entity_type ILIKE ${sp}
        OR action ILIKE ${sp}
        OR COALESCE(correlation_id, '') ILIKE ${sp}
        OR COALESCE(batch_id, '') ILIKE ${sp}
        OR COALESCE(idempotency_key, '') ILIKE ${sp}
        OR COALESCE(last_error, '') ILIKE ${sp}
        OR COALESCE(payload::text, '') ILIKE ${sp}
      )`
    );
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS cnt FROM sheets_mirror_outbox ${whereSql}`;
  const filteredCountQ = await queryOptionalReadOnly(executor, countSql, params);
  if (!filteredCountQ.ok && filteredCountQ.error) {
    queryErrors.push({ step: 'filtered_count', message: filteredCountQ.error });
  }

  const totalFiltered = num(filteredCountQ.rows[0]?.cnt, 0);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const page = Math.min(totalPages, requestedPage);
  const offset = (page - 1) * pageSize;

  const listParams = [...params, pageSize, offset];
  const listSql = `
    SELECT
      id,
      entity_type,
      entity_id,
      action,
      status,
      retry_count,
      max_retries,
      idempotency_key,
      correlation_id,
      batch_id,
      error_category,
      last_error,
      payload,
      (
        OCTET_LENGTH(COALESCE(payload::text, '')) +
        OCTET_LENGTH(COALESCE(error_history_json::text, '')) +
        OCTET_LENGTH(COALESCE(last_error_details_json::text, ''))
      )::bigint AS payload_bytes,
      created_at,
      updated_at,
      last_attempt_at,
      last_success_at,
      synced_at,
      processed_at,
      finished_at,
      next_retry_at
    FROM sheets_mirror_outbox
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT $${listParams.length - 1}
    OFFSET $${listParams.length}
  `;

  const rowsQ = await queryOptionalReadOnly(executor, listSql, listParams);
  if (!rowsQ.ok && rowsQ.error) {
    queryErrors.push({ step: 'rows', message: rowsQ.error });
  }

  const classifiedRows = (rowsQ.rows || []).map((r: any) => {
    const input: OutboxPreviewInputRow = {
      id: str(r.id),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      action: str(r.action),
      status: str(r.status),
      retryCount: num(r.retry_count, 0),
      maxRetries: num(r.max_retries, 5),
      idempotencyKey: str(r.idempotency_key),
      correlationId: str(r.correlation_id),
      batchId: str(r.batch_id),
      errorCategory: str(r.error_category),
      lastError: redactSensitiveText(r.last_error),
      payload: r.payload,
      payloadBytes: num(r.payload_bytes, 0),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      lastAttemptAt: toIso(r.last_attempt_at),
      lastSuccessAt: toIso(r.last_success_at),
      syncedAt: toIso(r.synced_at),
      processedAt: toIso(r.processed_at),
      finishedAt: toIso(r.finished_at),
      nextRetryAt: toIso(r.next_retry_at)
    };
    return classifyOutboxPreviewItem(input, olderThanDays);
  });

  const sRow = summaryQ.rows[0] || {};
  const sizeRow = sizeQ.rows[0] || {};
  const facetsRow = facetsQ.rows[0] || {};
  const cRow = coreCountsQ.rows[0] || {};

  return {
    previewOnly: true,
    isSandboxMode: false,
    databaseConnected: true,
    mutationsDisabledReason:
      'المرحلة 1 و2 مخصصة للتدقيق والمعاينة غير التعديلية فقط — لا يتم حذف أو أرشفة أي سجل حتى موافقة المبرمج على المرحلة 3.',
    spaceEstimationNote:
      'الحجم المعروض هو الحجم المقدّر لبيانات JSON القابلة للأرشفة (Payload Size)، ولا يساوي مساحة القرص الفعلية المستردة من PostgreSQL إلا بعد الحذف الفعلي وتشغيل VACUUM.',
    generatedAt: new Date().toISOString(),
    olderThanDays,
    summary: {
      total: num(sRow.total_cnt, 0),
      statusCounts: {
        completed: num(sRow.completed_cnt, 0),
        canonicalCompleted: num(sRow.canonical_completed_cnt, 0),
        legacySent: num(sRow.legacy_sent_cnt, 0),
        dead_letter: num(sRow.dead_letter_cnt, 0),
        canonicalDeadLetter: num(sRow.canonical_dead_letter_cnt, 0),
        legacyFailed: num(sRow.legacy_failed_cnt, 0),
        retry: num(sRow.retry_cnt, 0),
        pending: num(sRow.pending_cnt, 0),
        processing: num(sRow.processing_cnt, 0),
        unknown: num(sRow.unknown_cnt, 0)
      },
      classificationCounts: {
        safeToArchive: num(sRow.safe_to_archive_cnt, 0),
        keepActive: num(sRow.keep_active_cnt, 0),
        manualReview: num(sRow.manual_review_cnt, 0),
        uncertainResult: num(sRow.uncertain_cnt, 0)
      },
      estimatedTotalPayloadBytes: num(sRow.total_payload_bytes, 0),
      estimatedSafeArchivePayloadBytes: num(sRow.safe_archive_payload_bytes, 0),
      tableTotalBytes: sizeQ.ok ? num(sizeRow.table_total_bytes, 0) : null,
      tableHeapBytes: sizeQ.ok ? num(sizeRow.table_heap_bytes, 0) : null,
      oldestCreatedAt: toIso(sRow.oldest_created_at),
      newestCreatedAt: toIso(sRow.newest_created_at),
      oldestSafeArchiveAt: toIso(sRow.oldest_safe_archive_at),
      newestSafeArchiveAt: toIso(sRow.newest_safe_archive_at),
      lastSuccessAt: toIso(sRow.last_success_at),
      lastAttemptAt: toIso(sRow.last_attempt_at)
    },
    breakdown: (breakdownQ.rows || []).map((b: any) => ({
      action: str(b.action, 'unknown'),
      entityType: str(b.entity_type, 'unknown'),
      totalCount: num(b.total_cnt, 0),
      completedCount: num(b.completed_cnt, 0),
      deadLetterCount: num(b.dead_letter_cnt, 0),
      retryCount: num(b.retry_cnt, 0),
      pendingCount: num(b.pending_cnt, 0),
      processingCount: num(b.processing_cnt, 0),
      safeToArchiveCount: num(b.safe_to_archive_cnt, 0),
      manualReviewCount: num(b.manual_review_cnt, 0),
      estimatedPayloadBytes: num(b.estimated_payload_bytes, 0)
    })),
    facets: {
      actions: Array.isArray(facetsRow.actions) ? facetsRow.actions.map((x: any) => str(x)).filter(Boolean) : [],
      entityTypes: Array.isArray(facetsRow.entity_types) ? facetsRow.entity_types.map((x: any) => str(x)).filter(Boolean) : []
    },
    pagination: {
      page,
      pageSize,
      totalFiltered,
      totalPages
    },
    items: classifiedRows,
    dataBaselineCounts: {
      reservations: num(cRow.reservations_cnt, 0),
      customers: num(cRow.customers_cnt, 0),
      extensions: num(cRow.extensions_cnt, 0),
      followUps: num(cRow.follow_ups_cnt, 0),
      problems: num(cRow.problems_cnt, 0),
      customerNotes: num(cRow.customer_notes_cnt, 0),
      notifications: num(cRow.notifications_cnt, 0)
    },
    timestampAuditFindings: getStaticSchemaTimestampAuditFindings(),
    queryErrors
  };
}

export async function getSheetsSyncControlStatus(
  executor: DbExecutor,
  session: AuthSession
) {
  assertDeveloperPreviewAccess(session);

  const [serverCfg, rgDiag, secretDiag] = await Promise.all([
    resolveServerConfig(executor),
    Promise.resolve(getRgTokenDiagnostics()),
    Promise.resolve(getSyncSecretDiagnostics())
  ]);

  const [settingsQ, workerQ, checkpointsQ, logsQ, outboxQ] = await Promise.all([
    queryOptionalReadOnly(
      executor,
      `SELECT key, value, updated_at FROM settings WHERE key = ANY($1::text[])`,
      [[
        'auto_sync_enabled',
        'connection_mode',
        'rg_pull_interval_value',
        'rg_pull_interval_unit',
        'last_sync_at',
        'sheets_mirror_paused',
        'sheets_mirror_paused_at',
        'sheets_mirror_paused_by',
        'sheets_mirror_pause_reason'
      ]]
    ),
    queryOptionalReadOnly(executor, `SELECT * FROM sync_worker_state WHERE id = 'MAIN' LIMIT 1`),
    queryOptionalReadOnly(executor, `SELECT * FROM sync_checkpoints ORDER BY updated_at DESC`),
    queryOptionalReadOnly(
      executor,
      `SELECT id, sync_type, status, pulled_count, inserted_count, updated_count, skipped_count, error_message, started_at, finished_at
       FROM sync_log
       ORDER BY started_at DESC
       LIMIT 5`
    ),
    queryOptionalReadOnly(
      executor,
      `SELECT
        COUNT(*)::int AS total_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'pending')::int AS pending_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'processing')::int AS processing_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'retry')::int AS retry_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('completed', 'sent'))::int AS completed_cnt,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('dead_letter', 'failed'))::int AS failed_cnt,
        MAX(COALESCE(last_success_at, synced_at, processed_at, finished_at)) AS last_success_at,
        MAX(last_attempt_at) AS last_attempt_at,
        MAX(updated_at) FILTER (WHERE COALESCE(last_error, '') <> '') AS last_error_at,
        (SELECT last_error FROM sheets_mirror_outbox WHERE COALESCE(last_error, '') <> '' ORDER BY updated_at DESC LIMIT 1) AS latest_error_text
      FROM sheets_mirror_outbox`
    )
  ]);

  const settingsMap: Record<string, string> = {};
  for (const row of settingsQ.rows) {
    settingsMap[str(row.key)] = str(row.value);
  }

  const worker = workerQ.rows[0] || null;
  const ob = outboxQ.rows[0] || {};
  const sheetsMirrorPaused = settingsMap.sheets_mirror_paused === 'true';
  const sheetsMirrorPausedAt = str(settingsMap.sheets_mirror_paused_at);

  let accumulatedDuringPause = 0;
  if (sheetsMirrorPaused && sheetsMirrorPausedAt) {
    const accQ = await queryOptionalReadOnly(
      executor,
      `SELECT COUNT(*)::int AS cnt
       FROM sheets_mirror_outbox
       WHERE LOWER(COALESCE(status, '')) IN ('pending', 'processing', 'retry')
         AND created_at >= $1::timestamptz`,
      [sheetsMirrorPausedAt]
    );
    accumulatedDuringPause = num(accQ.rows[0]?.cnt, 0);
  }

  const checkpoints = (checkpointsQ.rows || []).map((c: any) => ({
    source: str(c.source),
    lastStatus: str(c.last_status),
    lastError: redactSensitiveText(c.last_error),
    lastSuccessfulAt: toIso(c.last_successful_at),
    lastAttemptAt: toIso(c.last_attempt_at),
    updatedAt: toIso(c.updated_at)
  }));
  const sheetsCp = checkpoints.find((c) => c.source === 'google_sheets_mirror' || c.source === 'google_apps_script_sheets');
  const rgCp = checkpoints.find((c) => /rental_gate/i.test(c.source));

  const autoSyncEnabled = worker
    ? Boolean(worker.auto_sync_enabled)
    : settingsMap.auto_sync_enabled !== 'false';

  const latestRgLog = logsQ.rows[0] || null;

  return {
    previewOnly: true,
    isSandboxMode: false,
    databaseConnected: true,
    generatedAt: new Date().toISOString(),
    controlsLockedNote:
      'أزرار الإيقاف المؤقت والاستئناف في مرحلة المعاينة (Phase 2 Preview) للعرض والقراءة فقط — سيتم تفعيلها فعلياً بعد اعتماد المرحلة 3.',
    rentalGateSync: {
      independentFromSheetsMirror: true,
      autoSyncEnabled,
      rgTokenConfigured: rgDiag.configured,
      workerRunning: Boolean(worker?.is_running),
      consecutiveErrors: num(worker?.consecutive_errors, 0),
      lastSuccessAt: toIso(worker?.last_success_at) || rgCp?.lastSuccessfulAt || toIso(latestRgLog?.finished_at),
      lastAttemptAt: toIso(worker?.last_tick_at) || rgCp?.lastAttemptAt || toIso(latestRgLog?.started_at),
      lastError: redactSensitiveText(worker?.last_error || latestRgLog?.error_message || ''),
      pullInterval: `${settingsMap.rg_pull_interval_value || '5'} ${settingsMap.rg_pull_interval_unit || 'minutes'}`,
      latestLog: latestRgLog
        ? {
            id: str(latestRgLog.id),
            syncType: str(latestRgLog.sync_type),
            status: str(latestRgLog.status),
            pulledCount: num(latestRgLog.pulled_count, 0),
            insertedCount: num(latestRgLog.inserted_count, 0),
            updatedCount: num(latestRgLog.updated_count, 0),
            startedAt: toIso(latestRgLog.started_at),
            finishedAt: toIso(latestRgLog.finished_at)
          }
        : null
    },
    googleSheetsSync: {
      state: sheetsMirrorPaused
        ? 'paused'
        : (!serverCfg.gasWebAppUrl || !secretDiag.configured ? 'unconfigured' : 'active'),
      stateLabelAr: sheetsMirrorPaused
        ? 'متوقفة مؤقتاً (Paused)'
        : (!serverCfg.gasWebAppUrl || !secretDiag.configured
          ? 'غير مهيأة (ينقص GAS_WEBAPP_URL أو SYNC_API_SECRET)'
          : 'نشطة (Active Mirror)'),
      paused: sheetsMirrorPaused,
      pausedAt: sheetsMirrorPausedAt,
      pausedBy: str(settingsMap.sheets_mirror_paused_by),
      pauseReason: str(settingsMap.sheets_mirror_pause_reason),
      gasUrlConfigured: Boolean(serverCfg.gasWebAppUrl),
      syncSecretConfigured: secretDiag.configured,
      pendingCount: num(ob.pending_cnt, 0) + num(ob.processing_cnt, 0) + num(ob.retry_cnt, 0),
      pendingOnlyCount: num(ob.pending_cnt, 0),
      processingCount: num(ob.processing_cnt, 0),
      retryCount: num(ob.retry_cnt, 0),
      completedCount: num(ob.completed_cnt, 0),
      failedCount: num(ob.failed_cnt, 0),
      totalOutboxCount: num(ob.total_cnt, 0),
      accumulatedDuringPause,
      lastAttemptAt: toIso(ob.last_attempt_at) || sheetsCp?.lastAttemptAt || '',
      lastSuccessAt: toIso(ob.last_success_at) || sheetsCp?.lastSuccessfulAt || '',
      lastError: redactSensitiveText(ob.latest_error_text || sheetsCp?.lastError || ''),
      lastErrorAt: toIso(ob.last_error_at)
    },
    checkpoints
  };
}
