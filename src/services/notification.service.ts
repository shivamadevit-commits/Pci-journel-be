import { Prisma, Role } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma, type Db } from '../config/prisma';
import { afterCommit } from '../utils/context';
import { pageMeta, skipTake } from '../utils/pagination';
import { NotFoundError } from '../utils/errors';
import { sendEmail } from './mail.service';

type TemplateData = Record<string, string | number | undefined | null>;

export interface NotifyInput {
  userId: string;
  /** Stable event type, e.g. "review.assigned". */
  type: string;
  title: string;
  message: string;
  template: string;
  /** Template variables. Must never contain secrets (tokens/OTPs) or double-blind-sensitive identities. */
  data?: TemplateData;
  entityType?: string;
  entityId?: string;
  /** Idempotency key: the same (user, key) is stored and e-mailed once even if the operation is retried. */
  dedupeKey: string;
}

/**
 * Persists an in-portal notification and queues its e-mail. Call inside the business transaction: the row is
 * created atomically with the change, and e-mail dispatch starts only after commit.
 */
export async function notify(db: Db, input: NotifyInput): Promise<void> {
  const res = await db.notification.createMany({
    data: [
      {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
        emailTemplate: input.template,
        emailPayload: (input.data ?? {}) as Prisma.InputJsonValue,
        emailStatus: env.EMAIL_ENABLED ? 'PENDING' : 'NOT_REQUIRED',
      },
    ],
    skipDuplicates: true,
  });
  if (res.count > 0 && env.EMAIL_ENABLED) afterCommit(() => void dispatchPending());
}

export async function notifyMany(db: Db, userIds: string[], input: Omit<NotifyInput, 'userId' | 'dedupeKey'> & { dedupeKey: string }): Promise<void> {
  for (const userId of new Set(userIds)) await notify(db, { ...input, userId });
}

/** Editorial recipients for an article: the assigned editor, otherwise every active editor and chief editor. */
export async function editorialRecipients(db: Db, article: { editorId: string | null }): Promise<string[]> {
  if (article.editorId) return [article.editorId];
  const staff = await db.user.findMany({
    where: { role: { in: [Role.EDITOR, Role.CHIEF_EDITOR_ADMIN] }, status: 'ACTIVE' },
    select: { id: true },
  });
  return staff.map((s) => s.id);
}

export async function productionRecipients(db: Db): Promise<string[]> {
  const users = await db.user.findMany({ where: { role: Role.PRODUCTION, status: 'ACTIVE' }, select: { id: true } });
  return users.map((u) => u.id);
}

// ───────────────────────────── e-mail dispatch ─────────────────────────────

let running = false;
const STUCK_AFTER_MS = 5 * 60_000;

export async function dispatchPending(limit = 25): Promise<void> {
  if (running || !env.EMAIL_ENABLED) return;
  running = true;
  try {
    const now = Date.now();
    const retryBefore = new Date(now - env.EMAIL_RETRY_INTERVAL_SECONDS * 1000);
    const stuckBefore = new Date(now - STUCK_AFTER_MS);
    const candidates = await prisma.notification.findMany({
      where: {
        emailAttempts: { lt: env.EMAIL_MAX_ATTEMPTS },
        OR: [
          { emailStatus: 'PENDING' },
          { emailStatus: 'FAILED', updatedAt: { lt: retryBefore } },
          { emailStatus: 'SENDING', updatedAt: { lt: stuckBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, emailStatus: true },
    });

    for (const c of candidates) {
      // Atomic claim so two instances never send the same notification.
      const claimed = await prisma.notification.updateMany({
        where: { id: c.id, emailStatus: c.emailStatus },
        data: { emailStatus: 'SENDING', emailAttempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;

      const n = await prisma.notification.findUnique({ where: { id: c.id }, include: { user: { select: { email: true, firstName: true } } } });
      if (!n || !n.emailTemplate) continue;
      try {
        const result = await sendEmail(n.user.email, n.emailTemplate, { name: n.user.firstName, ...((n.emailPayload as TemplateData) ?? {}) });
        await prisma.notification.update({
          where: { id: n.id },
          data: result === 'sent' ? { emailStatus: 'SENT', emailSentAt: new Date(), emailError: null } : { emailStatus: 'NOT_REQUIRED' },
        });
      } catch (err) {
        const msg = (err as Error).message.slice(0, 300);
        logger.warn({ notificationId: n.id, err: msg }, 'notification email failed');
        await prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'FAILED', emailError: msg } });
      }
    }
  } catch (err) {
    logger.error({ err }, 'notification dispatch error');
  } finally {
    running = false;
  }
}

// ───────────────────────────── in-portal notifications ─────────────────────────────

const view = {
  id: true,
  type: true,
  title: true,
  message: true,
  entityType: true,
  entityId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export async function listNotifications(userId: string, q: { page: number; pageSize: number; unreadOnly?: boolean }) {
  const where: Prisma.NotificationWhereInput = { userId, ...(q.unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), select: view }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, meta: { ...pageMeta(q, total), unread } };
}

export async function markRead(userId: string, id: string) {
  const r = await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  if (r.count === 0 && !(await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } }))) throw new NotFoundError('Notification not found');
}

export const markAllRead = (userId: string) => prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
