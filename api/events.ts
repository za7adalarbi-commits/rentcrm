import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured, type DbExecutor } from '../backend/db';
import { applyApiCorsHeaders } from '../backend/http';
import { logBackendError } from '../backend/logger';
import { ensureSeededDatabase } from '../backend/queries';
import { handleSseStream } from '../backend/realtimeBus';

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
    executor = createPgExecutor();
    await ensureSchemaInitialized(executor);
    await ensureSeededDatabase(executor);
    await handleSseStream(req, res, executor);
  } catch (err: any) {
    await logBackendError(executor, 'api/events', String(req.method || 'GET'), err).catch(() => undefined);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: String(err?.message || 'فشل فتح قناة التحديثات الفورية.'),
        data: null,
        error: 'REALTIME_STREAM_ERROR'
      });
    }
  }
}
