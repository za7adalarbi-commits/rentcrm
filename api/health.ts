import { checkDatabaseHealth } from '../backend/db';
import { applyApiCorsHeaders } from '../backend/http';

export default async function handler(req: any, res: any) {
  applyApiCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const health = await checkDatabaseHealth();
    res.status(200).json({
      ok: true,
      service: 'RENTAL GATE CRM',
      timestamp: new Date().toISOString(),
      ...health
    });
  } catch (err: any) {
    res.status(200).json({
      ok: false,
      service: 'RENTAL GATE CRM',
      timestamp: new Date().toISOString(),
      databaseConfigured: false,
      connected: false,
      error: String(err?.message || 'HEALTH_CHECK_ERROR').slice(0, 200)
    });
  }
}
