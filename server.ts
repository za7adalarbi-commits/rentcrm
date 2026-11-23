import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crmHandler from './api/crm.js';
import healthHandler from './api/health.js';
import syncHandler from './api/sync.js';
import versionHandler from './api/version.js';
import { requireAuth } from './backend/auth.js';
import { createPgExecutor, getDatabaseUrl, isDatabaseConfigured } from './backend/db.js';
import { ensurePgRealtimeListener, subscribeCrmEvents } from './backend/realtime.js';
import { attachAppVersionHeaders } from './backend/versionManifest.js';

const STATIC_GZIP_EXT_MAP: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const staticGzipCache = new Map<string, { mtimeMs: number; gzip: Buffer; size: number }>();

function sendCompressedTextAsset(
  req: Request,
  res: Response,
  next: NextFunction,
  baseDirs: string[],
  reqPathOverride?: string
) {
  if (req.method !== 'GET' || req.headers.range) {
    next();
    return;
  }
  const acceptEnc = String(req.headers['accept-encoding'] || '');
  if (!acceptEnc.includes('gzip')) {
    next();
    return;
  }
  const rawUrlPath = String(reqPathOverride ?? req.path ?? '').split('?')[0];
  const cleanUrlPath = rawUrlPath === '/' ? '/index.html' : rawUrlPath;
  const ext = path.extname(cleanUrlPath).toLowerCase();
  const contentType = STATIC_GZIP_EXT_MAP[ext];
  if (!contentType) {
    next();
    return;
  }
  const relPath = cleanUrlPath.replace(/^\/+/, '');
  if (!relPath || relPath.includes('..')) {
    next();
    return;
  }
  for (const dir of baseDirs) {
    const absPath = path.resolve(dir, relPath);
    if (!absPath.startsWith(dir + path.sep) && absPath !== dir) continue;
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size <= 1024 || stat.size > 4 * 1024 * 1024) continue;
      const cacheKey = absPath;
      let cached = staticGzipCache.get(cacheKey);
      if (!cached || cached.mtimeMs !== stat.mtimeMs) {
        const rawBuf = fs.readFileSync(absPath);
        const gzip = zlib.gzipSync(rawBuf, { level: 6 });
        if (staticGzipCache.size > 160) staticGzipCache.clear();
        cached = { mtimeMs: stat.mtimeMs, gzip, size: stat.size };
        staticGzipCache.set(cacheKey, cached);
      }
      if (
        absPath.endsWith('index.html') ||
        absPath.endsWith(`${path.sep}config.js`) ||
        absPath.endsWith(`${path.sep}version.json`) ||
        absPath.endsWith(`${path.sep}sw.js`) ||
        absPath.endsWith(`${path.sep}registerSW.js`) ||
        absPath.endsWith(`${path.sep}manifest.webmanifest`)
      ) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      } else if (absPath.includes(`${path.sep}vendor${path.sep}`) || /-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(absPath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      } else {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.status(200).send(cached.gzip);
      return;
    } catch {
      // File not in this dir, check next
    }
  }
  next();
}

function gzipResponseMiddleware(req: Request, res: Response, next: NextFunction) {
  const acceptEnc = String(req.headers['accept-encoding'] || '');
  if (!acceptEnc.includes('gzip') || req.method === 'HEAD') {
    next();
    return;
  }

  const origJson = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const jsonStr = JSON.stringify(body);
      if (jsonStr.length > 1024) {
        const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'), { level: 6 });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return res.send(compressed);
      }
    } catch {
      // Fallback to uncompressed JSON if serialization fails
    }
    return origJson(body);
  }) as any;

  next();
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const rootDir = import.meta.dirname || process.cwd();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: 'text/plain', limit: '5mb' }));
  app.use(gzipResponseMiddleware);

  const runApiRoute = (handlerFn: (req: Request, res: Response) => Promise<void>) => {
    return (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      attachAppVersionHeaders(res);
      Promise.resolve(handlerFn(req, res)).catch((err: any) => {
        console.error('Express API route error:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: String(err?.message || 'INTERNAL_SERVER_ERROR'),
            data: null,
            error: 'SERVER_ERROR'
          });
        }
      });
    };
  };

  app.all('/api/health', runApiRoute(healthHandler));
  app.all('/api/version', runApiRoute(versionHandler));
  app.get('/version.json', runApiRoute(versionHandler));
  app.all('/api/crm', runApiRoute(crmHandler));
  app.all('/api/sync', runApiRoute(syncHandler));

  app.get('/api/events', async (req: Request, res: Response) => {
    const authHeader = String(req.headers?.authorization || '').trim();
    const bearerToken = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const queryToken = String(req.query?.token || '').trim();
    const rawToken = bearerToken || queryToken;

    if (!rawToken) {
      res.status(401).json({
        success: false,
        message: 'UNAUTHORIZED: يلزم تسجيل الدخول لفتح قناة التحديث اللحظي.',
        data: null,
        error: 'UNAUTHORIZED'
      });
      return;
    }

    let userId = 'sandbox';
    if (isDatabaseConfigured()) {
      try {
        const session = await requireAuth(createPgExecutor(), rawToken);
        userId = session.user.id;
      } catch (err: any) {
        res.status(401).json({
          success: false,
          message: String(err?.message || 'UNAUTHORIZED: الجلسة غير صالحة.'),
          data: null,
          error: 'UNAUTHORIZED'
        });
        return;
      }
    }

    const sseManifest = attachAppVersionHeaders(res);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ ok: true, userId, appVersion: sseManifest.version, at: new Date().toISOString() })}\n\n`);

    const unsubscribe = subscribeCrmEvents((ev) => {
      if (res.writableEnded) return;
      const frameId = ev.version ? `id: ${ev.version}\n` : '';
      res.write(`${frameId}event: crm\ndata: ${JSON.stringify(ev)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.use('/api', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(404).json({
      success: false,
      message: `نقطة النهاية ${req.originalUrl || req.path} غير موجودة.`,
      data: null,
      error: 'API_ROUTE_NOT_FOUND'
    });
  });

  const STATIC_ASSET_EXT_RE = /\.(?:js|mjs|cjs|ts|tsx|jsx|css|scss|map|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|webmanifest|txt|xml)$/i;

  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !isHmrDisabled,
        ws: isHmrDisabled ? false : undefined
      },
      appType: 'custom'
    });

    if (isHmrDisabled) {
      app.get('/@vite/client', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send([
          'const noop = () => {};',
          'export function createHotContext() {',
          '  return { data: {}, accept: noop, dispose: noop, prune: noop, decline: noop, invalidate: noop, on: noop, off: noop, send: noop };',
          '}',
          'export function injectQuery(url) { return url; }',
          'export function updateStyle(id, content) {',
          '  if (typeof document === "undefined") return;',
          '  let style = document.querySelector("style[data-vite-dev-id=" + JSON.stringify(id) + "]");',
          '  if (!style) {',
          '    style = document.createElement("style");',
          '    style.setAttribute("type", "text/css");',
          '    style.setAttribute("data-vite-dev-id", id);',
          '    document.head.appendChild(style);',
          '  }',
          '  style.textContent = content;',
          '}',
          'export function removeStyle(id) {',
          '  if (typeof document === "undefined") return;',
          '  const style = document.querySelector("style[data-vite-dev-id=" + JSON.stringify(id) + "]");',
          '  if (style) style.remove();',
          '}',
          'export class ErrorOverlay {}'
        ].join('\n'));
      });
    }

    // Serve /assets directly in dev (compressed) so Vite does not inline 3x base64 source maps into static JS files
    app.use('/assets', (req: Request, res: Response, next: NextFunction) => {
      sendCompressedTextAsset(req, res, next, [rootDir], `/assets${req.path}`);
    });
    app.use('/assets', express.static(path.resolve(rootDir, 'assets'), {
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}vendor${path.sep}`) || /\.(png|jpg|jpeg|svg|webp|woff2?)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        } else {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      }
    }));

    app.use(vite.middlewares);

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      if (req.path.startsWith('/api/') || STATIC_ASSET_EXT_RE.test(req.path)) {
        res.status(404).type('text/plain').send('Not Found');
        return;
      }
      try {
        const indexPath = path.resolve(rootDir, 'index.html');
        const rawHtml = fs.readFileSync(indexPath, 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl || '/', rawHtml);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        const acceptEnc = String(req.headers['accept-encoding'] || '');
        if (req.method === 'GET' && acceptEnc.includes('gzip') && transformed.length > 1024) {
          const gz = zlib.gzipSync(Buffer.from(transformed, 'utf8'), { level: 6 });
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.status(200).send(gz);
          return;
        }
        res.status(200).send(transformed);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(rootDir, 'dist');
    app.use((req: Request, res: Response, next: NextFunction) => {
      sendCompressedTextAsset(req, res, next, [distDir]);
    });
    app.use(express.static(distDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (
          filePath.endsWith('index.html') ||
          filePath.endsWith(`${path.sep}config.js`) ||
          filePath.endsWith(`${path.sep}version.json`) ||
          filePath.endsWith(`${path.sep}sw.js`) ||
          filePath.endsWith(`${path.sep}registerSW.js`) ||
          filePath.endsWith(`${path.sep}manifest.webmanifest`)
        ) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        } else if (/\.(png|jpg|jpeg|svg|webp|woff2?)$/i.test(filePath) || filePath.includes(`${path.sep}vendor${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (/\.(js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      }
    }));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      if (STATIC_ASSET_EXT_RE.test(req.path)) {
        res.status(404).type('text/plain').send('Not Found');
        return;
      }
      const indexHtml = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  if (isDatabaseConfigured()) {
    ensurePgRealtimeListener(getDatabaseUrl());
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`RENTAL GATE CRM server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RENTAL GATE CRM server:', err);
  process.exit(1);
});
