import { requireApiAccess, requireAuth, verifySharedSecret } from '../backend/auth';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured, type DbExecutor } from '../backend/db';
import { logBackendError } from '../backend/logger';
import { ensureSeededDatabase } from '../backend/queries';
import {
  enqueueSyncOperation,
  getSyncQueueSummary,
  retryFailedSyncItems,
  runBackupDeltaSync,
  triggerImmediateSync
} from '../backend/syncService';

function parseBody(rawBody: any): Record<string, any> {
  if (!rawBody) return {};
  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawBody === 'object' ? rawBody : {};
}

async function authorizeQueueRequest(req: any, body: Record<string, any>, executor: DbExecutor): Promise<boolean> {
  const expectedSecret = String(process.env.SYNC_API_SECRET || '').trim();
  const headerSecret = String(req.headers?.['x-sync-secret'] || '').trim();
  const authHeader = String(req.headers?.authorization || '').trim();
  const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  const bodySecret = String(body.syncSecret || req.query?.syncSecret || '').trim();

  if (expectedSecret && verifySharedSecret(headerSecret || bodySecret || bearer, expectedSecret)) {
    return true;
  }

  const sessionToken = bearer || String(body.token || req.query?.token || '').trim();
  if (sessionToken) {
    try {
      const session = await requireAuth(executor, sessionToken);
      requireApiAccess(session);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export default async function handler(req: any, res: any) {
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

  const body = parseBody(req.body);
  const executor = createPgExecutor();

  try {
    await ensureSchemaInitialized(executor);
    await ensureSeededDatabase(executor);

    const authorized = await authorizeQueueRequest(req, body, executor);
    if (!authorized) {
      res.status(401).json({
        success: false,
        message: 'UNAUTHORIZED: الوصول إلى طابور المزامنة يتطلب صلاحية إدارية أو SYNC_API_SECRET.',
        data: null,
        error: 'UNAUTHORIZED'
      });
      return;
    }

    if (req.method === 'GET') {
      const summary = await getSyncQueueSummary(executor, Number(req.query?.limit || 60));
      res.status(200).json({
        success: true,
        message: 'تم جلب بيانات طابور المزامنة.',
        data: summary,
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

    const action = String(body.action || 'process').trim();

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
      const summary = await getSyncQueueSummary(executor, 60);
      res.status(200).json({
        success: true,
        message: 'تم تسجيل عمليات المزامنة وإرسالها فوراً.',
        data: { enqueuedIds, flush, queue: summary },
        error: null
      });
      return;
    }

    if (action === 'retry') {
      const retryRes = await retryFailedSyncItems(executor, Array.isArray(body.ids) ? body.ids : undefined);
      const summary = await getSyncQueueSummary(executor, 60);
      res.status(200).json({
        success: true,
        message: 'تمت إعادة محاولة العمليات الفاشلة.',
        data: { ...retryRes, queue: summary },
        error: null
      });
      return;
    }

    if (action === 'delta') {
      const deltaRes = await runBackupDeltaSync(executor, undefined, {
        pullRentalGate: Boolean(body.pullRentalGate)
      });
      const summary = await getSyncQueueSummary(executor, 60);
      res.status(200).json({
        success: true,
        message: 'تم تشغيل فحص المزامنة الدورية الاحتياطي.',
        data: { ...deltaRes, queue: summary },
        error: null
      });
      return;
    }

    const flush = await triggerImmediateSync(executor);
    const summary = await getSyncQueueSummary(executor, 60);
    res.status(200).json({
      success: true,
      message: 'تمت معالجة طابور المزامنة الفورية بنجاح.',
      data: { flush, queue: summary },
      error: null
    });
  } catch (err: any) {
    await logBackendError(executor, 'api/sync-queue', String(req.method || 'GET'), err);
    res.status(500).json({
      success: false,
      message: String(err?.message || 'فشل معالجة طابور المزامنة.'),
      data: null,
      error: 'SYNC_QUEUE_ERROR'
    });
  }
}
