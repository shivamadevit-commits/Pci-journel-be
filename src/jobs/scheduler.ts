import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { dispatchPending } from '../services/notification.service';

const timers: NodeJS.Timeout[] = [];

/** In-process background jobs. Safe with several instances: dispatch claims rows atomically; cleanup is idempotent. */
export function startJobs(): void {
  // Retries failed / pending notification e-mails.
  timers.push(setInterval(() => void dispatchPending(), env.EMAIL_RETRY_INTERVAL_SECONDS * 1000));
  void dispatchPending();

  // Housekeeping for expired credentials.
  timers.push(
    setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - 24 * 3600_000);
        await prisma.authOtp.deleteMany({ where: { expiresAt: { lt: cutoff } } });
        await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
        await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } } });
      } catch (err) {
        logger.warn({ err }, 'housekeeping failed');
      }
    }, 3600_000),
  );
  for (const t of timers) t.unref();
}

export function stopJobs(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
