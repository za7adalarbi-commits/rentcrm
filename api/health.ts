import { checkDatabaseHealth, createPgExecutor, isDatabaseConfigured } from '../backend/db.js';
import { readPublicHealthAutoBind } from '../backend/serverConfig.js';

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

    let syncMeta: { reservationsCount: number; lastSyncAt: string; lastResUpdatedAt: string; syncEpoch: string } | null = null;
    if (health.connected && executor) {
      try {
        const syncQ = await executor.query<{ res_cnt: string; max_res_upd: any; max_sync_fin: any }>(
          `SELECT
             (SELECT COUNT(*)::text FROM reservations) AS res_cnt,
             (SELECT MAX(updated_at) FROM reservations) AS max_res_upd,
             (SELECT MAX(finished_at) FROM sync_log WHERE status = 'success') AS max_sync_fin`
        );
        const r = syncQ.rows[0];
        if (r) {
          const cnt = Number(r.res_cnt || 0);
          const maxRes = r.max_res_upd instanceof Date ? r.max_res_upd.toISOString() : String(r.max_res_upd || '');
          const maxSync = r.max_sync_fin instanceof Date ? r.max_sync_fin.toISOString() : String(r.max_sync_fin || '');
          syncMeta = {
            reservationsCount: cnt,
            lastSyncAt: maxSync,
            lastResUpdatedAt: maxRes,
            syncEpoch: `${cnt}|${maxSync}|${maxRes}`
          };
        }
      } catch {
        // Ignore if schema is not initialized yet
      }
    }

    const autoBind = await readPublicHealthAutoBind(executor);
    const mode = autoBind.mode || (health.databaseConfigured && health.connected ? 'neon' : '');
    const backendApiUrl =
      mode === 'gas' || mode === 'sandbox'
        ? ''
        : (health.databaseConfigured && health.connected ? '/api/crm' : '');

    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    res.status(200).json({
      ok: true,
      service: 'RENTAL GATE CRM',
      timestamp: new Date().toISOString(),
      ...health,
      mode,
      backendApiUrl,
      gasWebAppUrl: autoBind.gasWebAppUrl,
      serverlessProxyAvailable: true,
      envGasConfigured: Boolean(String(process.env.GAS_WEBAPP_URL || '').trim()),
      syncMeta
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
        gasWebAppUrl: '',
        serverlessProxyAvailable: false,
        envGasConfigured: false,
        syncMeta: null
      });
    }
  }
}
