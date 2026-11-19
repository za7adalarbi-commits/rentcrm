import { createPgExecutor, isDatabaseConfigured, type DbExecutor } from '../backend/db';
import { applyApiCorsHeaders, parseRequestBody } from '../backend/http';
import { logBackendError } from '../backend/logger';
import { dispatchCrmRequest } from '../backend/router';

export default async function handler(req: any, res: any) {
  applyApiCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isDatabaseConfigured()) {
    res.status(503).json({
      success: false,
      message: 'قاعدة البيانات السحابية (Neon PostgreSQL) غير مهيأة بعد على الخادم.',
      data: null,
      error: 'DATABASE_UNCONFIGURED'
    });
    return;
  }

  let executor: DbExecutor | null = null;
  let action = '';
  try {
    const body = parseRequestBody(req.body);
    const query = req.query || {};
    action = String(body.action || query.action || '').trim();
    const authHeader = String(req.headers?.authorization || '');
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = String(body.token || bearerToken || query.token || '').trim();
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    executor = createPgExecutor();
    const result = await dispatchCrmRequest(executor, { action, token, payload });
    res.status(200).json(result);
  } catch (err: any) {
    await logBackendError(executor, 'api/crm', action || String(req.method || 'POST'), err).catch(() => undefined);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: String(err?.message || 'حدث خطأ غير متوقع في الخادم.'),
        data: null,
        error: 'CRM_HANDLER_ERROR'
      });
    }
  }
}
