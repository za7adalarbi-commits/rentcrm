import { requireApiAccess, requireAuth, verifySharedSecret } from '../backend/auth';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured, type DbExecutor } from '../backend/db';
import { applyApiCorsHeaders, parseRequestBody } from '../backend/http';
import { logBackendError } from '../backend/logger';
import { ensureSeededDatabase } from '../backend/queries';
import {
  enqueueSyncOperation,
  getSyncQueueSummary,
  ingestIncrementalSyncBatch,
  retryFailedSyncItems,
  runBackupDeltaSync,
  triggerImmediateSync
} from '../backend/syncService';

function extractProvidedToken(req: any, body: Record<string, any>): { syncSecret: string; bearer: string } {
  const headerSecret = String(req.headers?.['x-sync-secret'] || '').trim();
  const authHeader = String(req.headers?.authorization || '').trim();
  const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  const bodySecret = String(body.syncSecret || req.query?.syncSecret || '').trim();
  return {
    syncSecret: headerSecret || bodySecret || bearer,
    bearer: bearer || String(body.token || req.query?.token || '').trim()
  };
}

async function authorizeSyncRequest(req: any, body: Record<string, any>, executor: DbExecutor): Promise<boolean> {
  const expectedSecret = String(process.env.SYNC_API_SECRET || '').trim();
  const { syncSecret, bearer } = extractProvidedToken(req, body);

  if (expectedSecret && verifySharedSecret(syncSecret, expectedSecret)) {
    return true;
  }

  if (bearer) {
    try {
      const session = await requireAuth(executor, bearer);
      requireApiAccess(session);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export default async function handler(req: any, res: any) {
  applyApiCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isDatabaseConfigured()) {
    res.status(503).json({
      success: false,
      message: 'قاعدة البيانات السحابية غير مهيأة بعد.',
      data: null,
      error: 'DATABASE_UNCONFIGURED'
    });
    return;
  }

  let executor: DbExecutor | null = null;
  try {
    const body = parseRequestBody(req.body);
    executor = createPgExecutor();
    await ensureSchemaInitialized(executor);
    await ensureSeededDatabase(executor);

    const authorized = await authorizeSyncRequest(req, body, executor);
    if (!authorized) {
      res.status(401).json({
        success: false,
        message: 'UNAUTHORIZED: مفتاح المزامنة SYNC_API_SECRET أو جلسة الإدارة غير صالحة.',
        data: null,
        error: 'UNAUTHORIZED'
      });
      return;
    }

    if (req.method === 'GET') {
      const source = String(req.query?.source || 'google_apps_script').trim();
      const [ck, queue] = await Promise.all([
        executor.query(`SELECT * FROM sync_checkpoints WHERE source = $1 LIMIT 1`, [source]),
        getSyncQueueSummary(executor, Number(req.query?.limit || 60))
      ]);
      res.status(200).json({
        success: true,
        message: 'تم جلب حالة المزامنة والطابور بنجاح.',
        data: {
          checkpoint: ck.rows[0] || null,
          queue
        },
        error: null
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({
        success: false,
        message: 'METHOD_NOT_ALLOWED',
        data: null,
        error: 'METHOD_NOT_ALLOWED'
      });
      return;
    }

    const action = String(body.action || '').trim();

    if (action === 'queueStatus') {
      const queue = await getSyncQueueSummary(executor, Number(body.limit || 60));
      res.status(200).json({
        success: true,
        message: 'تم جلب حالة طابور المزامنة الفورية.',
        data: queue,
        error: null
      });
      return;
    }

    if (action === 'enqueue') {
      const items = Array.isArray(body.items) ? body.items : [body];
      const enqueuedIds: string[] = [];
      for (const item of items) {
        if (!item || !item.entityType) continue;
        const id = await enqueueSyncOperation(executor, {
          entityType: String(item.entityType),
          entityId: String(item.entityId || item.recordId || ''),
          recordId: String(item.recordId || item.entityId || ''),
          operation: String(item.operation || 'UPDATE'),
          action: String(item.syncAction || item.action || 'upsertRecord'),
          payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
          idempotencyKey: item.idempotencyKey ? String(item.idempotencyKey) : undefined
        });
        if (id) enqueuedIds.push(id);
      }
      const flush = await triggerImmediateSync(executor);
      res.status(200).json({
        success: true,
        message: 'تم تسجيل عمليات المزامنة ومعالجتها فورياً.',
        data: { enqueuedIds, flush },
        error: null
      });
      return;
    }

    if (action === 'flushOutbox' || action === 'processQueue') {
      const mirrorResult = await triggerImmediateSync(executor);
      const queue = await getSyncQueueSummary(executor, 60);
      res.status(200).json({
        success: true,
        message: 'تمت معالجة قائمة المزامنة الفورية مع Google Sheets.',
        data: { ...mirrorResult, queue },
        error: null
      });
      return;
    }

    if (action === 'retryFailed') {
      const result = await retryFailedSyncItems(executor, Array.isArray(body.ids) ? body.ids : undefined);
      const queue = await getSyncQueueSummary(executor, 60);
      res.status(200).json({
        success: true,
        message: 'تمت إعادة جدولة ومعالجة العناصر الفاشلة.',
        data: { ...result, queue },
        error: null
      });
      return;
    }

    if (action === 'deltaSync') {
      const result = await runBackupDeltaSync(executor, undefined, {
        pullRentalGate: Boolean(body.pullRentalGate)
      });
      res.status(200).json({
        success: true,
        message: 'تمت المزامنة الدورية الاحتياطية (البيانات المتغيرة فقط).',
        data: result,
        error: null
      });
      return;
    }

    const syncResult = await ingestIncrementalSyncBatch(executor, body);
    const mirrorResult = await triggerImmediateSync(executor).catch(() => ({
      sent: 0,
      synced: 0,
      failed: 0,
      retried: 0,
      skipped: true
    }));

    res.status(200).json({
      success: true,
      message: 'تمت المزامنة التزايدية مع Neon PostgreSQL بنجاح.',
      data: {
        ...syncResult,
        mirrorOutbox: mirrorResult
      },
      error: null
    });
  } catch (err: any) {
    await logBackendError(executor, 'api/sync', String(req.method || 'POST'), err);
    res.status(500).json({
      success: false,
      message: String(err?.message || 'فشل تنفيذ المزامنة السحابية.'),
      data: null,
      error: 'SYNC_ERROR'
    });
  }
}
