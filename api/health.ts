import { checkDatabaseHealth, createPgExecutor, isDatabaseConfigured } from '../backend/db';
import { readPublicHealthAutoBind } from '../backend/serverConfig';

export default async function handler(_req: any, res: any) {
  try {
    const health = await checkDatabaseHealth();
    let executor: ReturnType<typeof createPgExecutor> | undefined;

    if (health.connected && isDatabaseConfigured()) {
      try {
        executor = createPgExecutor();
      } catch {
        executor = undefined;
      }
    }

    const autoBind = await readPublicHealthAutoBind(executor);
    const mode = autoBind.mode || (health.databaseConfigured && health.connected ? 'neon' : '');
    const backendApiUrl =
      mode === 'gas' || mode === 'sandbox'
        ? ''
        : (health.databaseConfigured && health.connected ? '/api/crm' : '');

    res.status(200).json({
      ok: true,
      service: 'RENTAL GATE CRM',
      timestamp: new Date().toISOString(),
      ...health,
      mode,
      backendApiUrl,
      gasWebAppUrl: autoBind.gasWebAppUrl
    });
  } catch (err: any) {
    console.error('Unhandled /api/health error:', err);
    if (!res.headersSent) {
      res.status(200).json({
        ok: false,
        service: 'RENTAL GATE CRM',
        timestamp: new Date().toISOString(),
        databaseConfigured: isDatabaseConfigured(),
        connected: false,
        error: String(err?.message || 'HEALTH_CHECK_FAILED'),
        mode: '',
        backendApiUrl: '',
        gasWebAppUrl: ''
      });
    }
  }
}
