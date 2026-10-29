import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { startJobs, stopJobs } from './jobs/scheduler';
import { redis } from './middlewares/rateLimit';
import { closeMail, verifyMailTransport } from './services/mail.service';

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening'));

  // Slow uploads / idle sockets must not hold connections forever.
  server.requestTimeout = 120_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000; // above typical load-balancer idle timeouts

  startJobs();
  void verifyMailTransport().then((ok) => (ok ? logger.info('SMTP transport verified') : logger.warn('SMTP transport could not be verified; notification emails will be retried')));

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('forced exit after shutdown timeout');
      process.exit(1);
    }, 25_000);
    force.unref();
    server.close(async () => {
      try {
        stopJobs();
        closeMail();
        await prisma.$disconnect();
        redis?.disconnect();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
