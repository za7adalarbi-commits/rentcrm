import { verifySharedSecret } from '../../backend/auth';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured } from '../../backend/db';
import { getEnv } from '../../backend/env';
import { applyApiCorsHeaders } from '../../backend/http';
import { logBackendError } from '../../backend/logger';
import { ensureSeededDatabase } from '../../backend/queries';
import { runBackupDeltaSync } from '../../backend/syncService';

function isAuthorizedCron(req: any): boolean {
  const cronSecret = String(getEnv('CRON_SECRET') || '').trim();
  const syncSecret = String(getEnv('SYNC_API_SECRET') || '').trim();
  const authHeader = String(req.headers?.authorization || '').trim();
  const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  const xSync = String(req.headers?.['x-sync-secret'] || '').trim();
  const provided = xSync || bearer || String(req.query?.secret || '').trim();

  if (cronSecret && verifySharedSecret(provided, cronSecret)) return true;
  if (syncSecret && verifySharedSecret(provided, syncSecret)) return true;

  // Vercel Cron invokes with x-vercel-cron: 1 when CRON_SECRET isn't configured
  if (!cronSecret && !syncSecret && String(req.headers?.['x-vercel-cron'] || '') === '1') {
    return true;
  }

  return !cronSecret && !syncSecret && getEnv('NODE_ENV') !== 'production';
}

export default async function handler(req: any, res: any) {
  applyApiCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isAuthorizedCron(req)) {
    res.status(401).json({
      success: false,
      message: 'UNAUTHORIZED: مفتاح المزامنة الدورية غير صالح.',
      data: null,
      error: 'UNAUTHORIZED'
    });
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
    const result = await runBackupDeltaSync(executor, undefined, {
      pullRentalGate: Boolean(getEnv('RG_TOKEN'))
    });
    res.status(200).json({
      success: true,
      message: 'تمت المزامنة الدورية الاحتياطية (البيانات المتغيرة فقط) بنجاح.',
      data: result,
      error: null
    });
  } catch (err: any) {
    await logBackendError(executor, 'api/cron/sync', 'CRON', err);
    res.status(500).json({
      success: false,
      message: String(err?.message || 'فشل المزامنة الدورية الاحتياطية.'),
      data: null,
      error: 'CRON_SYNC_ERROR'
    });
  }
}
