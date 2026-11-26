import 'dotenv/config';
import { startAutoSyncWorker, stopAutoSyncWorker } from '../backend/autoSyncWorker.js';
import { createPgExecutor, ensureSchemaInitialized, getDatabaseUrl, isDatabaseConfigured } from '../backend/db.js';
import { ensurePgRealtimeListener } from '../backend/realtime.js';

async function main() {
  if (!isDatabaseConfigured()) {
    console.error('[AutoSync Worker] DATABASE_URL is not configured. Waiting until configured or exiting.');
    process.exit(1);
  }

  const executor = createPgExecutor();
  await ensureSchemaInitialized(executor);
  ensurePgRealtimeListener(getDatabaseUrl());

  console.log('[AutoSync Worker] Background sync worker started independently.');
  startAutoSyncWorker({ initialDelayMs: 500 });

  // Keep the standalone worker process alive while worker timers are unref'd
  const keepAlive = setInterval(() => undefined, 60000);

  const shutdown = () => {
    console.log('[AutoSync Worker] Shutting down gracefully...');
    clearInterval(keepAlive);
    stopAutoSyncWorker();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[AutoSync Worker] Fatal error:', err);
  process.exit(1);
});
