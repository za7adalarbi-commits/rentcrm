import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crmHandler from './api/crm';
import healthHandler from './api/health';
import syncHandler from './api/sync';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const rootDir = import.meta.dirname || process.cwd();

  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: 'text/plain', limit: '5mb' }));

  app.all('/api/health', (req, res) => {
    void healthHandler(req, res);
  });

  app.all('/api/crm', (req, res) => {
    void crmHandler(req, res);
  });

  app.all('/api/sync', (req, res) => {
    void syncHandler(req, res);
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
  });
}

startServer().catch((err) => {
  console.error('Failed to start RENTAL GATE CRM server:', err);
  process.exit(1);
});
