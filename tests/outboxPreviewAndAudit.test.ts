import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthSession } from '../backend/auth';
import type { DbClient, DbExecutor, QueryResult, QueryResultRow } from '../backend/db';
import {
  classifyOutboxPreviewItem,
  estimateJsonPayloadBytes,
  filterAndPaginateOutboxItems,
  getStaticSchemaTimestampAuditFindings,
  normalizeOutboxStatus,
  summarizeOutboxPreviewRows
} from '../backend/outboxPreviewLogic';
import {
  getOutboxCleanupPreview,
  getSheetsSyncControlStatus
} from '../backend/outboxPreviewService';

function makeSession(role: string, permissions: string[] = []): AuthSession {
  const nowIso = new Date().toISOString();
  return {
    tokenHash: 'test-hash',
    employeeId: `EMP_${role.toUpperCase()}`,
    username: role,
    role,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: `EMP_${role.toUpperCase()}`,
      name: `${role} User`,
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

function createDevSession(): AuthSession {
  return makeSession('developer', ['manage_developer_tools', 'manage_settings', 'sync_data', 'view_reservations']);
}

function createMockExecutor(
  handler: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>
): DbExecutor {
  const query = async <T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const res = await handler(sql, params);
    return res as QueryResult<T>;
  };
  return {
    query,
    async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
      return fn({ query });
    }
  };
}

test('normalizeOutboxStatus maps canonical and legacy statuses accurately', () => {
  assert.deepEqual(normalizeOutboxStatus('completed'), { canonical: 'completed', raw: 'completed', isLegacy: false });
  assert.deepEqual(normalizeOutboxStatus('sent'), { canonical: 'completed', raw: 'sent', isLegacy: true });
  assert.deepEqual(normalizeOutboxStatus('dead_letter'), { canonical: 'dead_letter', raw: 'dead_letter', isLegacy: false });
  assert.deepEqual(normalizeOutboxStatus('failed'), { canonical: 'dead_letter', raw: 'failed', isLegacy: true });
  assert.deepEqual(normalizeOutboxStatus('retry'), { canonical: 'retry', raw: 'retry', isLegacy: false });
  assert.deepEqual(normalizeOutboxStatus('pending'), { canonical: 'pending', raw: 'pending', isLegacy: false });
  assert.deepEqual(normalizeOutboxStatus('processing'), { canonical: 'processing', raw: 'processing', isLegacy: false });
});

test('classifyOutboxPreviewItem distinguishes safe_to_archive, uncertain results, keep_active, and manual_review', () => {
  const nowMs = Date.parse('2026-11-28T12:00:00.000Z');

  // Completed with verified receipt & older than 14 days -> safe_to_archive
  const safeOld = classifyOutboxPreviewItem(
    {
      id: 'OB_1',
      entityType: 'reservation',
      entityId: 'RES_1',
      action: 'upsertReservation',
      status: 'completed',
      retryCount: 0,
      maxRetries: 5,
      idempotencyKey: 'key_1',
      lastSuccessAt: '2026-11-01T10:00:00.000Z',
      createdAt: '2026-11-01T09:59:00.000Z',
      payload: { id: 'RES_1', customerName: 'أحمد' }
    },
    14,
    nowMs
  );
  assert.equal(safeOld.classification, 'safe_to_archive');
  assert.equal(safeOld.uncertainResult, false);
  assert.equal(safeOld.hasVerifiedReceipt, true);
  assert.ok(safeOld.estimatedPayloadBytes > 10);

  // Completed within retention window -> keep_active when olderThanDays = 14
  const recentCompleted = classifyOutboxPreviewItem(
    {
      id: 'OB_2',
      entityType: 'reservation',
      entityId: 'RES_2',
      action: 'upsertReservation',
      status: 'sent',
      retryCount: 0,
      maxRetries: 5,
      syncedAt: '2026-11-26T10:00:00.000Z',
      createdAt: '2026-11-26T10:00:00.000Z',
      payload: { id: 'RES_2' }
    },
    14,
    nowMs
  );
  assert.equal(recentCompleted.canonicalStatus, 'completed');
  assert.equal(recentCompleted.classification, 'keep_active');

  // Completed without ANY completion timestamp -> uncertain manual_review
  const uncertainDone = classifyOutboxPreviewItem(
    {
      id: 'OB_3',
      entityType: 'reservation',
      entityId: 'RES_3',
      action: 'upsertReservation',
      status: 'completed',
      retryCount: 0,
      maxRetries: 5,
      createdAt: '2026-10-15T10:00:00.000Z',
      payload: { id: 'RES_3' }
    },
    0,
    nowMs
  );
  assert.equal(uncertainDone.classification, 'manual_review');
  assert.equal(uncertainDone.uncertainResult, true);

  // Dead letter with timeout -> manual_review & uncertainResult
  const deadTimeout = classifyOutboxPreviewItem(
    {
      id: 'OB_4',
      entityType: 'reservation',
      entityId: 'RES_4',
      action: 'upsertReservation',
      status: 'dead_letter',
      retryCount: 5,
      maxRetries: 5,
      errorCategory: 'timeout',
      lastError: 'GAS timeout 25000ms',
      createdAt: '2026-11-10T10:00:00.000Z',
      payload: { id: 'RES_4' }
    },
    0,
    nowMs
  );
  assert.equal(deadTimeout.classification, 'manual_review');
  assert.equal(deadTimeout.uncertainResult, true);

  // Bulk delete is always protected in manual_review
  const bulkDelete = classifyOutboxPreviewItem(
    {
      id: 'OB_5',
      entityType: 'reservation',
      entityId: 'ALL',
      action: 'deleteAllReservations',
      status: 'completed',
      retryCount: 0,
      maxRetries: 5,
      lastSuccessAt: '2026-10-01T10:00:00.000Z',
      createdAt: '2026-10-01T10:00:00.000Z',
      payload: {}
    },
    0,
    nowMs
  );
  assert.equal(bulkDelete.classification, 'manual_review');

  // Pending remains active
  const pendingRow = classifyOutboxPreviewItem(
    {
      id: 'OB_6',
      entityType: 'follow_up',
      entityId: 'FU_1',
      action: 'upsertFollowUp',
      status: 'pending',
      retryCount: 0,
      maxRetries: 5,
      idempotencyKey: 'k6',
      createdAt: '2026-11-28T11:50:00.000Z',
      payload: { id: 'FU_1' }
    },
    0,
    nowMs
  );
  assert.equal(pendingRow.classification, 'keep_active');
});

test('summarizeOutboxPreviewRows and filterAndPaginateOutboxItems aggregate UTF-8 sizes and paginate cleanly', () => {
  const nowMs = Date.parse('2026-11-28T12:00:00.000Z');
  const classified = [
    classifyOutboxPreviewItem(
      {
        id: 'OB_A',
        entityType: 'reservation',
        entityId: 'R_100',
        action: 'upsertReservation',
        status: 'completed',
        retryCount: 0,
        maxRetries: 5,
        lastSuccessAt: '2026-11-01T08:00:00.000Z',
        createdAt: '2026-11-01T07:59:00.000Z',
        payload: { note: 'بيانات عربية UTF-8' }
      },
      0,
      nowMs
    ),
    classifyOutboxPreviewItem(
      {
        id: 'OB_B',
        entityType: 'reservation',
        entityId: 'R_101',
        action: 'deleteReservation',
        status: 'dead_letter',
        retryCount: 5,
        maxRetries: 5,
        errorCategory: 'auth',
        lastError: 'UNAUTHORIZED',
        createdAt: '2026-11-20T08:00:00.000Z',
        payload: { id: 'R_101' }
      },
      0,
      nowMs
    )
  ];

  assert.equal(estimateJsonPayloadBytes({ a: 'س' }), Buffer.byteLength(JSON.stringify({ a: 'س' }), 'utf8'));

  const summary = summarizeOutboxPreviewRows(classified, 65536);
  assert.equal(summary.total, 2);
  assert.equal(summary.statusCounts.completed, 1);
  assert.equal(summary.statusCounts.dead_letter, 1);
  assert.equal(summary.classificationCounts.safeToArchive, 1);
  assert.equal(summary.classificationCounts.manualReview, 1);
  assert.equal(summary.tableTotalBytes, 65536);
  assert.ok(summary.estimatedSafeArchivePayloadBytes > 0);
  assert.equal(summary.breakdown.length, 2);

  const filteredSafe = filterAndPaginateOutboxItems(classified, {
    classification: 'safe_to_archive',
    page: 1,
    pageSize: 10
  });
  assert.equal(filteredSafe.totalFiltered, 1);
  assert.equal(filteredSafe.paged[0].id, 'OB_A');

  const filteredSearch = filterAndPaginateOutboxItems(classified, {
    search: 'unauthorized',
    page: 1,
    pageSize: 10
  });
  assert.equal(filteredSearch.totalFiltered, 1);
  assert.equal(filteredSearch.paged[0].id, 'OB_B');
});

test('getOutboxCleanupPreview and getSheetsSyncControlStatus enforce developer RBAC and strictly execute read-only SQL', async () => {
  const executedSql: string[] = [];
  const exec = createMockExecutor(async (sql) => {
    executedSql.push(sql);
    if (/FROM sheets_mirror_outbox\s+GROUP BY/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM sheets_mirror_outbox/i.test(sql) && /COUNT\(\*\)::int AS total_cnt/i.test(sql)) {
      return {
        rows: [
          {
            total_cnt: 3,
            completed_cnt: 2,
            canonical_completed_cnt: 2,
            legacy_sent_cnt: 0,
            dead_letter_cnt: 1,
            canonical_dead_letter_cnt: 1,
            legacy_failed_cnt: 0,
            retry_cnt: 0,
            pending_cnt: 0,
            processing_cnt: 0,
            unknown_cnt: 0,
            safe_to_archive_cnt: 2,
            keep_active_cnt: 0,
            manual_review_cnt: 1,
            uncertain_cnt: 0,
            total_payload_bytes: 512,
            safe_archive_payload_bytes: 340,
            oldest_created_at: '2026-11-01T00:00:00.000Z',
            newest_created_at: '2026-11-27T00:00:00.000Z',
            oldest_safe_archive_at: '2026-11-01T00:01:00.000Z',
            newest_safe_archive_at: '2026-11-27T00:01:00.000Z',
            last_success_at: '2026-11-27T00:01:00.000Z',
            last_attempt_at: '2026-11-27T00:01:00.000Z'
          }
        ],
        rowCount: 1
      };
    }
    if (/pg_total_relation_size/i.test(sql)) {
      return { rows: [{ table_total_bytes: 16384, table_heap_bytes: 8192 }], rowCount: 1 };
    }
    if (/ARRAY\(SELECT DISTINCT action/i.test(sql)) {
      return { rows: [{ actions: ['upsertReservation'], entity_types: ['reservation'] }], rowCount: 1 };
    }
    if (/AS reservations_cnt/i.test(sql)) {
      return {
        rows: [
          {
            reservations_cnt: 120,
            customers_cnt: 80,
            extensions_cnt: 14,
            follow_ups_cnt: 45,
            problems_cnt: 3,
            customer_notes_cnt: 19,
            notifications_cnt: 12
          }
        ],
        rowCount: 1
      };
    }
    if (/COUNT\(\*\)::int AS cnt FROM sheets_mirror_outbox/i.test(sql)) {
      return { rows: [{ cnt: 1 }], rowCount: 1 };
    }
    if (/FROM sheets_mirror_outbox/i.test(sql) && /LIMIT/i.test(sql)) {
      return {
        rows: [
          {
            id: 'OB_MOCK_1',
            entity_type: 'reservation',
            entity_id: 'RES_MOCK_1',
            action: 'upsertReservation',
            status: 'completed',
            retry_count: 0,
            max_retries: 5,
            idempotency_key: 'idem_mock_1',
            correlation_id: 'corr_1',
            batch_id: 'batch_1',
            error_category: '',
            last_error: '',
            payload: { reservationNumber: 'RG-1001' },
            payload_bytes: 170,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-01T00:01:00.000Z',
            last_attempt_at: '2026-11-01T00:01:00.000Z',
            last_success_at: '2026-11-01T00:01:00.000Z'
          }
        ],
        rowCount: 1
      };
    }
    if (/FROM settings WHERE key = ANY/i.test(sql)) {
      return {
        rows: [
          { key: 'auto_sync_enabled', value: 'true' },
          { key: 'rg_pull_interval_value', value: '5' },
          { key: 'rg_pull_interval_unit', value: 'minutes' }
        ],
        rowCount: 3
      };
    }
    return { rows: [], rowCount: 0 };
  });

  // Non-developer roles must be rejected
  for (const role of ['agent', 'supervisor', 'general_manager']) {
    const s = makeSession(role, ['view_reservations', 'manage_settings']);
    await assert.rejects(() => getOutboxCleanupPreview(exec, s, {}), /FORBIDDEN/);
    await assert.rejects(() => getSheetsSyncControlStatus(exec, s), /FORBIDDEN/);
  }
  assert.equal(executedSql.length, 0, 'RBAC rejection must happen before touching DB');

  // Developer can read both endpoints without any mutation SQL
  const devSession = createDevSession();
  const preview = await getOutboxCleanupPreview(exec, devSession, { page: 1, pageSize: 25 });
  const syncStatus = await getSheetsSyncControlStatus(exec, devSession);

  assert.equal(preview.previewOnly, true);
  assert.equal(preview.summary.total, 3);
  assert.equal(preview.summary.classificationCounts.safeToArchive, 2);
  assert.equal(preview.dataBaselineCounts.reservations, 120);
  assert.equal(preview.items[0].classification, 'safe_to_archive');

  assert.equal(syncStatus.previewOnly, true);
  assert.equal(syncStatus.rentalGateSync.independentFromSheetsMirror, true);
  assert.equal(syncStatus.rentalGateSync.autoSyncEnabled, true);
  assert.equal(syncStatus.googleSheetsSync.paused, false);

  for (const sql of executedSql) {
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(sql),
      `Read-only preview executed forbidden write SQL: ${sql}`
    );
  }
});

test('static schema timestamp audit explicitly documents customer_notes.closed_at TIMESTAMPTZ vs ::text root cause', () => {
  const findings = getStaticSchemaTimestampAuditFindings();
  const closedAtFinding = findings.find((f) => f.id === 'TS_AUDIT_CUSTOMER_NOTES_CLOSED_AT');
  assert.ok(closedAtFinding);
  assert.equal(closedAtFinding.severity, 'critical');
  assert.equal(closedAtFinding.tableName, 'customer_notes');
  assert.equal(closedAtFinding.columnName, 'closed_at');

  const queriesTs = fs.readFileSync(path.join(process.cwd(), 'backend', 'queries.ts'), 'utf8');
  assert.match(queriesTs, /closed_at[\s\S]{0,600}\$17::text/, 'Expected audited Phase 1 bug evidence at backend/queries.ts addCustomerNote');

  const schemaSql = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  assert.match(schemaSql, /closed_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL/i);
});
