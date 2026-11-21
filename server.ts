import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crmHandler from './api/crm.js';
import healthHandler from './api/health.js';
import syncHandler from './api/sync.js';
import { subscribeCrmEvents } from './backend/realtime.js';

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
  app.all('/api/crm', runApiRoute(crmHandler));
  app.all('/api/sync', runApiRoute(syncHandler));

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`);

    const unsubscribe = subscribeCrmEvents((ev) => {
      if (res.writableEnded) return;
      res.write(`event: crm\ndata: ${JSON.stringify(ev)}\n\n`);
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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(rootDir, 'dist');
    app.use(express.static(distDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith(`${path.sep}config.js`)) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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
      const indexHtml = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`RENTAL GATE CRM server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RENTAL GATE CRM server:', err);
  process.exit(1);
});
