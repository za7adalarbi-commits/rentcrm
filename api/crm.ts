import { createPgExecutor, isDatabaseConfigured } from '../backend/db';
import { dispatchCrmRequest } from '../backend/router';

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

export default async function handler(req: any, res: any) {
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

  const body = parseBody(req.body);
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
