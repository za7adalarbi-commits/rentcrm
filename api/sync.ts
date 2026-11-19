import { verifySharedSecret } from '../backend/auth.js';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured } from '../backend/db.js';
import { logBackendError } from '../backend/logger.js';
import { ensureSeededDatabase } from '../backend/queries.js';
import { ensureSyncApiSecret } from '../backend/serverConfig.js';
import { flushSheetsMirrorOutbox, ingestIncrementalSyncBatch } from '../backend/syncService.js';

function parseBody(rawBody: any): Record<string, any> {
  if (!rawBody) return {};
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBody)) {
    rawBody = rawBody.toString('utf8');
  }
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

function extractProvidedSecret(req: any, body: Record<string, any>): string {
  const headerSecret = String(req.headers?.['x-sync-secret'] || '').trim();
  if (headerSecret) return headerSecret;
  const authHeader = String(req.headers?.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return String(body.syncSecret || req.query?.syncSecret || '').trim();
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

  let executor: ReturnType<typeof createPgExecutor> | null = null;
  try {
    executor = createPgExecutor();
    await ensureSchemaInitialized(executor);
    await ensureSeededDatabase(executor);

    const expectedSecret = await ensureSyncApiSecret(executor);
    const body = parseBody(req.body);
    const providedSecret = extractProvidedSecret(req, body);

    if (!expectedSecret || !verifySharedSecret(providedSecret, expectedSecret)) {
      res.status(401).json({
        success: false,
        message: 'UNAUTHORIZED: مفتاح المزامنة SYNC_API_SECRET غير صالح.',
        data: null,
        error: 'UNAUTHORIZED'
      });
      return;
    }

    if (req.method === 'GET') {
      const source = String(req.query?.source || 'google_apps_script').trim();
      const ck = await executor.query(
        `SELECT * FROM sync_checkpoints WHERE source = $1 LIMIT 1`,
        [source]
      );
      res.status(200).json({
        success: true,
        message: 'تم جلب حالة نقطة المزامنة.',
        data: ck.rows[0] || null,
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

    if (body.action === 'flushOutbox') {
      const mirrorResult = await flushSheetsMirrorOutbox(executor);
      res.status(200).json({
        success: true,
        message: 'تمت معالجة قائمة المزامنة العكسية مع Google Sheets.',
        data: mirrorResult,
        error: null
      });
      return;
    }

    const syncResult = await ingestIncrementalSyncBatch(executor, body);
    const mirrorResult = await flushSheetsMirrorOutbox(executor).catch(() => ({ sent: 0, failed: 0, skipped: true }));

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
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: String(err?.message || 'فشل تنفيذ المزامنة السحابية.'),
        data: null,
        error: 'SYNC_ERROR'
      });
    }
  }
}
