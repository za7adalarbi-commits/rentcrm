import { verifySharedSecret } from './auth';
import { checkCfDatabaseHealth, createCfPgExecutor, type WorkerExecutorHandle } from './cfDb';
import { ensureSchemaInitialized, isDatabaseConfigured } from './dbCore';
import {
  getEnv,
  runWithWorkerContext,
  type WorkerEnvBindings,
  type WorkerExecutionContext
} from './env';
import { logBackendError } from './logger';
import { ensureSeededDatabase, getSettingsMap } from './queries';
import { dispatchCrmRequest } from './router';
import {
  flushSheetsMirrorOutbox,
  ingestIncrementalSyncBatch,
  pullFromRentalGateDirect
} from './syncService';

export interface WorkerTestHooks {
  createExecutor?: (env: WorkerEnvBindings) => WorkerExecutorHandle;
  checkHealth?: (env: WorkerEnvBindings) => Promise<{
    databaseConfigured: boolean;
    connected: boolean;
    hyperdriveEnabled: boolean;
    error?: string;
  }>;
  fetchFn?: typeof fetch;
}

function parseOriginAllowlist(): string[] {
  const raw = getEnv('CORS_ALLOWED_ORIGINS', '');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(request: Request): { origin: string; allowed: boolean } {
  const reqOrigin = request.headers.get('Origin') || '';
  if (!reqOrigin) {
    return { origin: '*', allowed: true };
  }

  let selfOrigin = '';
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    selfOrigin = '';
  }

  if (selfOrigin && reqOrigin === selfOrigin) {
    return { origin: reqOrigin, allowed: true };
  }

  const allowlist = parseOriginAllowlist();
  if (allowlist.length === 0) {
    return { origin: reqOrigin, allowed: true };
  }

  if (allowlist.includes('*') || allowlist.includes(reqOrigin)) {
    return { origin: reqOrigin, allowed: true };
  }

  return { origin: '', allowed: false };
}

function buildSecurityAndCorsHeaders(request: Request, extra?: Record<string, string>): Headers {
  const { origin, allowed } = resolveAllowedOrigin(request);
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store'
  });

  if (allowed && origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sync-secret');
    headers.set('Access-Control-Max-Age', '86400');
    if (origin !== '*') {
      headers.set('Vary', 'Origin');
    }
  }

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, v);
    }
  }
  return headers;
}

function jsonResponse(request: Request, status: number, body: any): Response {
  const headers = buildSecurityAndCorsHeaders(request, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  return new Response(JSON.stringify(body), { status, headers });
}

async function parseJsonRequestBody(request: Request): Promise<Record<string, any>> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return {};
  }
  try {
    const raw = await request.text();
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function extractSyncSecret(request: Request, url: URL, body: Record<string, any>): string {
  const headerSecret = String(request.headers.get('x-sync-secret') || '').trim();
  if (headerSecret) return headerSecret;
  const authHeader = String(request.headers.get('authorization') || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return String(body.syncSecret || url.searchParams.get('syncSecret') || '').trim();
}

function enqueuePoolClose(ctx: WorkerExecutionContext | undefined, handle: WorkerExecutorHandle): void {
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(handle.close());
  } else {
    void handle.close();
  }
}

async function handleHealthRoute(
  request: Request,
  env: WorkerEnvBindings,
  hooks?: WorkerTestHooks
): Promise<Response> {
  const health = hooks?.checkHealth
    ? await hooks.checkHealth(env)
    : await checkCfDatabaseHealth(env);

  return jsonResponse(request, 200, {
    ok: true,
    service: 'RENTAL GATE CRM',
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
    ...health
  });
}

async function handleCrmRoute(
  request: Request,
  url: URL,
  env: WorkerEnvBindings,
  ctx?: WorkerExecutionContext,
  hooks?: WorkerTestHooks
): Promise<Response> {
  if (!isDatabaseConfigured(env) && !hooks?.createExecutor) {
    return jsonResponse(request, 503, {
      success: false,
      message: 'قاعدة البيانات السحابية (Neon PostgreSQL) غير مهيأة بعد على الخادم.',
      data: null,
      error: 'DATABASE_UNCONFIGURED'
    });
  }

  const body = await parseJsonRequestBody(request);
  const action = String(body.action || url.searchParams.get('action') || '').trim();
  const authHeader = String(request.headers.get('authorization') || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = String(body.token || bearerToken || url.searchParams.get('token') || '').trim();
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  const handle = hooks?.createExecutor ? hooks.createExecutor(env) : createCfPgExecutor(env);
  try {
    const result = await dispatchCrmRequest(handle.executor, { action, token, payload });
    return jsonResponse(request, 200, result);
  } finally {
    enqueuePoolClose(ctx, handle);
  }
}

async function handleSyncRoute(
  request: Request,
  url: URL,
  env: WorkerEnvBindings,
  ctx?: WorkerExecutionContext,
  hooks?: WorkerTestHooks
): Promise<Response> {
  if (!isDatabaseConfigured(env) && !hooks?.createExecutor) {
    return jsonResponse(request, 503, {
      success: false,
      message: 'قاعدة البيانات السحابية غير مهيأة بعد.',
      data: null,
      error: 'DATABASE_UNCONFIGURED'
    });
  }

  const expectedSecret = String(getEnv('SYNC_API_SECRET') || '').trim();
  const body = await parseJsonRequestBody(request);
  const providedSecret = extractSyncSecret(request, url, body);

  if (!expectedSecret || !verifySharedSecret(providedSecret, expectedSecret)) {
    return jsonResponse(request, 401, {
      success: false,
      message: 'UNAUTHORIZED: مفتاح المزامنة SYNC_API_SECRET غير صالح.',
      data: null,
      error: 'UNAUTHORIZED'
    });
  }

  const handle = hooks?.createExecutor ? hooks.createExecutor(env) : createCfPgExecutor(env);
  const fetchFn = hooks?.fetchFn || fetch;
  try {
    await ensureSchemaInitialized(handle.executor);
    await ensureSeededDatabase(handle.executor);

    if (request.method.toUpperCase() === 'GET') {
      const source = String(url.searchParams.get('source') || 'google_apps_script').trim();
      const ck = await handle.executor.query(
        `SELECT * FROM sync_checkpoints WHERE source = $1 LIMIT 1`,
        [source]
      );
      return jsonResponse(request, 200, {
        success: true,
        message: 'تم جلب حالة نقطة المزامنة.',
        data: ck.rows[0] || null,
        error: null
      });
    }

    if (request.method.toUpperCase() !== 'POST') {
      return jsonResponse(request, 405, {
        success: false,
        message: 'METHOD_NOT_ALLOWED',
        data: null,
        error: 'METHOD_NOT_ALLOWED'
      });
    }

    if (body.action === 'flushOutbox') {
      const mirrorResult = await flushSheetsMirrorOutbox(handle.executor, fetchFn);
      return jsonResponse(request, 200, {
        success: true,
        message: 'تمت معالجة قائمة المزامنة العكسية مع Google Sheets.',
        data: mirrorResult,
        error: null
      });
    }

    const syncResult = await ingestIncrementalSyncBatch(handle.executor, body);
    const mirrorResult = await flushSheetsMirrorOutbox(handle.executor, fetchFn).catch(() => ({
      sent: 0,
      failed: 0,
      skipped: true
    }));

    return jsonResponse(request, 200, {
      success: true,
      message: 'تمت المزامنة التزايدية مع Neon PostgreSQL بنجاح.',
      data: {
        ...syncResult,
        mirrorOutbox: mirrorResult
      },
      error: null
    });
  } catch (err: any) {
    await logBackendError(handle.executor, 'worker/api/sync', request.method.toUpperCase(), err);
    return jsonResponse(request, 500, {
      success: false,
      message: String(err?.message || 'فشل تنفيذ المزامنة السحابية.'),
      data: null,
      error: 'SYNC_ERROR'
    });
  } finally {
    enqueuePoolClose(ctx, handle);
  }
}

export async function handleWorkerFetch(
  request: Request,
  env: WorkerEnvBindings,
  ctx?: WorkerExecutionContext,
  hooks?: WorkerTestHooks
): Promise<Response> {
  return runWithWorkerContext(env, ctx, async () => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');

    if (isApiRoute) {
      const { allowed } = resolveAllowedOrigin(request);
      if (!allowed) {
        return new Response(
          JSON.stringify({ success: false, message: 'Origin not allowed', data: null, error: 'CORS_FORBIDDEN' }),
          { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }

      if (request.method.toUpperCase() === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: buildSecurityAndCorsHeaders(request)
        });
      }

      if (pathname === '/api/health') {
        return handleHealthRoute(request, env, hooks);
      }
      if (pathname === '/api/crm') {
        return handleCrmRoute(request, url, env, ctx, hooks);
      }
      if (pathname === '/api/sync') {
        return handleSyncRoute(request, url, env, ctx, hooks);
      }

      return jsonResponse(request, 404, {
        success: false,
        message: 'API route not found',
        data: null,
        error: 'NOT_FOUND'
      });
    }

    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Static assets binding (ASSETS) is not configured.', { status: 404 });
  });
}

export async function handleWorkerScheduled(
  _controller: { cron?: string; scheduledTime?: number },
  env: WorkerEnvBindings,
  ctx?: WorkerExecutionContext,
  hooks?: WorkerTestHooks
): Promise<{
  skipped: boolean;
  reason?: string;
  outbox?: { sent: number; failed: number; skipped: boolean };
  autoSyncTriggered?: boolean;
}> {
  return runWithWorkerContext(env, ctx, async () => {
    if (!isDatabaseConfigured(env) && !hooks?.createExecutor) {
      return { skipped: true, reason: 'DATABASE_UNCONFIGURED' };
    }

    const handle = hooks?.createExecutor ? hooks.createExecutor(env) : createCfPgExecutor(env);
    const fetchFn = hooks?.fetchFn || fetch;
    try {
      await ensureSchemaInitialized(handle.executor);
      await ensureSeededDatabase(handle.executor);

      const outbox = await flushSheetsMirrorOutbox(handle.executor, fetchFn);
      const settings = await getSettingsMap(handle.executor);
      const autoSyncEnabled = settings.auto_sync_enabled !== false;
      const intervalHours = Math.max(1, Math.min(168, Number(settings.auto_sync_interval_hours || 12)));

      let autoSyncTriggered = false;
      const rgToken = getEnv('RG_TOKEN');
      if (autoSyncEnabled && rgToken) {
        const recentRes = await handle.executor.query<{ finished_at: any }>(
          `SELECT finished_at FROM sync_log WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`
        );
        const lastFinished = recentRes.rows[0]?.finished_at
          ? new Date(recentRes.rows[0].finished_at).getTime()
          : 0;
        const elapsedHours = lastFinished ? (Date.now() - lastFinished) / 3600000 : Infinity;
        if (elapsedHours >= intervalHours - 0.1) {
          await pullFromRentalGateDirect(
            handle.executor,
            { id: 'CF_CRON', name: 'المزامنة التلقائية (Cloudflare Cron)', role: 'system' },
            { datePreset: '7d' },
            fetchFn
          );
          autoSyncTriggered = true;
        }
      }

      return { skipped: false, outbox, autoSyncTriggered };
    } catch (err) {
      await logBackendError(handle.executor, 'worker/scheduled', 'cron', err);
      throw err;
    } finally {
      await handle.close();
    }
  });
}

const workerHandler = {
  async fetch(request: Request, env: WorkerEnvBindings, ctx: WorkerExecutionContext): Promise<Response> {
    return handleWorkerFetch(request, env, ctx);
  },
  async scheduled(
    controller: { cron?: string; scheduledTime?: number },
    env: WorkerEnvBindings,
    ctx: WorkerExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      handleWorkerScheduled(controller, env, ctx).catch((err) => {
        console.error('Cloudflare Worker scheduled task failed:', err);
      })
    );
  }
};

export default workerHandler;
