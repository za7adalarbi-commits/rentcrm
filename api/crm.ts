import { createPgExecutor, isDatabaseConfigured } from '../backend/db';
import { applyApiCorsHeaders, parseRequestBody } from '../backend/http';
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

  const body = parseRequestBody(req.body);
  const query = req.query || {};
  const action = String(body.action || query.action || '').trim();
  const authHeader = String(req.headers?.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = String(body.token || bearerToken || query.token || '').trim();
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  const executor = createPgExecutor();
  const result = await dispatchCrmRequest(executor, { action, token, payload });
  res.status(200).json(result);
}
