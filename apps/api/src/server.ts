import { createApp } from './app.js';
import { env } from './config/env.js';
import { db } from './platform/db.js';
import { logger } from './platform/logger.js';
import { redis } from './platform/redis.js';

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API listening');
});

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([db.end(), redis.quit()]);
  logger.info('Graceful shutdown completed');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
