import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crmHandler from './api/crm';
import cronSyncHandler from './api/cron/sync';
import eventsHandler from './api/events';
import healthHandler from './api/health';
import syncHandler from './api/sync';
import syncQueueHandler from './api/sync-queue';
import { createPgExecutor, ensureSchemaInitialized, isDatabaseConfigured } from './backend/db';
import { ensureSeededDatabase } from './backend/queries';
import { runBackupDeltaSync, triggerImmediateSync } from './backend/syncService';

function mountApiRoute(
  app: express.Express,
  routePath: string,
  handler: (req: any, res: any) => Promise<void> | void
) {
  app.all(routePath, (req, res) => {
    Promise.resolve(handler(req, res)).catch((err: any) => {
      console.error(`[API ${routePath}] Unhandled error:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: String(err?.message || 'حدث خطأ غير متوقع في الخادم.'),
          data: null,
          error: 'INTERNAL_SERVER_ERROR'
        });
      } else if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
  });
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const rootDir = import.meta.dirname || process.cwd();

  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: 'text/plain', limit: '5mb' }));
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && req.path.startsWith('/api/')) {
      res.status(err.status || 400).json({
        success: false,
        message: String(err.message || 'صيغة بيانات الطلب غير صالحة.'),
        data: null,
        error: 'INVALID_REQUEST_BODY'
      });
      return;
    }
    next(err);
  });

  mountApiRoute(app, '/api/health', healthHandler);
  mountApiRoute(app, '/api/crm', crmHandler);
  mountApiRoute(app, '/api/sync', syncHandler);
  mountApiRoute(app, '/api/sync-queue', syncQueueHandler);
  mountApiRoute(app, '/api/events', eventsHandler);
  mountApiRoute(app, '/api/cron/sync', cronSyncHandler);

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
    app.use(express.static(distDir, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexHtml = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`RENTAL GATE CRM server listening on http://0.0.0.0:${port}`);

    if (isDatabaseConfigured()) {
      const executor = createPgExecutor();
      ensureSchemaInitialized(executor)
        .then(() => ensureSeededDatabase(executor))
        .then(() => triggerImmediateSync(executor))
        .catch(() => undefined);

      if (process.env.ENABLE_LOCAL_CRON !== 'false') {
        let runningBackupTick = false;
        const backupTimer = setInterval(() => {
          if (runningBackupTick) return;
          runningBackupTick = true;
          runBackupDeltaSync(executor, undefined, { pullRentalGate: Boolean(process.env.RG_TOKEN) })
            .catch(() => undefined)
            .finally(() => {
              runningBackupTick = false;
            });
        }, 60000);
        if (typeof backupTimer.unref === 'function') {
          backupTimer.unref();
        }
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start RENTAL GATE CRM server:', err);
  process.exit(1);
});
