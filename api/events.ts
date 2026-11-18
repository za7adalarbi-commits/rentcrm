import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured } from '../backend/db';
import { logBackendError } from '../backend/logger';
import { ensureSeededDatabase } from '../backend/queries';
import { handleSseStream } from '../backend/realtimeBus';

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

  const executor = createPgExecutor();
  try {
    await ensureSchemaInitialized(executor);
    await ensureSeededDatabase(executor);
    await handleSseStream(req, res, executor);
  } catch (err: any) {
    await logBackendError(executor, 'api/events', String(req.method || 'GET'), err);
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
