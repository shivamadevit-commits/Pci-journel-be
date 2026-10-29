import type { PaymentStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma, type Tx } from '../config/prisma';
import { getPaymentProvider } from '../providers/payment.provider';
import { links } from '../templates/links';
import { transact, type Actor } from '../utils/context';
import { ConflictError, NotFoundError, UnauthorizedError, UnprocessableError } from '../utils/errors';
import { loadArticleForEditorial, loadOwnArticle } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';
import { notify } from './notification.service';

/** Allowed APC status moves. Anything else is rejected so a payment record cannot be rewritten arbitrarily. */
const NEXT: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'WAIVED'],
  FAILED: ['PENDING', 'PAID', 'WAIVED'],
  PAID: ['REFUNDED'],
  WAIVED: [],
  REFUNDED: [],
};

const STATUS_TEXT: Record<PaymentStatus, string> = { PENDING: 'Pending', PAID: 'Paid', FAILED: 'Failed', REFUNDED: 'Refunded', WAIVED: 'Waived' };

export interface PaymentChange {
  status: PaymentStatus;
  amount?: string;
  currency?: string;
  provider?: string;
  providerReference?: string;
  note?: string;
}

async function applyChange(tx: Tx, articleId: string, change: PaymentChange, actor: Actor | null, source: 'manual' | 'webhook') {
  const article = await tx.article.findUniqueOrThrow({ where: { id: articleId }, select: { id: true, authorId: true, submissionId: true } });
  const current = await tx.apcPayment.findUnique({ where: { articleId } });
  if (!current) throw new NotFoundError('Payment record not found');
  if (current.status === change.status) return { changed: false, payment: current };
  if (!NEXT[current.status].includes(change.status)) {
    throw new ConflictError(`Payment status cannot change from ${current.status} to ${change.status}`, 'INVALID_PAYMENT_TRANSITION');
  }
  const amount = change.amount ?? current.amount?.toString();
  const currency = change.currency ?? current.currency ?? undefined;
  if (change.status === 'PAID' && (!amount || !currency)) {
    throw new UnprocessableError('Amount and currency are required to record a payment', 'PAYMENT_DETAILS_REQUIRED');
  }

  const payment = await tx.apcPayment.update({
    where: { articleId },
    data: {
      status: change.status,
      amount: amount ?? undefined,
      currency,
      provider: change.provider ?? (source === 'manual' ? 'manual' : undefined),
      providerReference: change.providerReference,
      note: change.note,
      recordedById: actor?.id ?? null,
      paidAt: change.status === 'PAID' ? new Date() : current.paidAt,
    },
  });
  await recordAudit(tx, {
    action: AuditAction.PAYMENT_STATUS_CHANGED,
    entityType: 'ApcPayment',
    entityId: payment.id,
    actor,
    fromStatus: current.status,
    toStatus: change.status,
    metadata: { articleId, source, amount, currency, provider: change.provider },
  });
  await notify(tx, {
    userId: article.authorId,
    type: 'apc.status_changed',
    title: `Payment ${STATUS_TEXT[change.status].toLowerCase()}: ${article.submissionId}`,
    message: `The Article Publishing Charge status is now “${STATUS_TEXT[change.status]}”.`,
    template: 'apc_status',
    data: { submissionId: article.submissionId, status: STATUS_TEXT[change.status], amount, currency, link: links.authorArticle(articleId) },
    entityType: 'Article',
    entityId: articleId,
    dedupeKey: `apc:${payment.id}:${current.status}->${change.status}`,
  });
  return { changed: true, payment };
}

export async function getPaymentForEditor(articleId: string, actor: Actor) {
  await loadArticleForEditorial(articleId, actor);
  const p = await prisma.apcPayment.findUnique({ where: { articleId } });
  if (!p) throw new NotFoundError('Payment record not found');
  return p;
}

async function assertPaymentEnabled() {
  if (!(await getConfig()).paymentEnabled) throw new ConflictError('Payments are currently disabled by the administrator', 'PAYMENT_DISABLED');
}

/** Manual recording by the editorial office (used when no gateway is configured, or for waivers/corrections). */
export async function recordPayment(articleId: string, change: PaymentChange, actor: Actor) {
  await assertPaymentEnabled();
  return transact(async (tx) => {
    await loadArticleForEditorial(articleId, actor, tx);
    if (change.status === 'PAID' && !change.note && !change.providerReference) {
      throw new UnprocessableError('A payment reference or note is required when recording a payment manually', 'PAYMENT_EVIDENCE_REQUIRED');
    }
    return (await applyChange(tx, articleId, change, actor, 'manual')).payment;
  });
}

/** Author starts an online payment through the configured gateway. */
export async function startCheckout(user: Express.AuthUser, articleId: string) {
  await assertPaymentEnabled();
  const article = await loadOwnArticle(articleId, user.id);
  const provider = getPaymentProvider();
  const payment = await prisma.apcPayment.findUnique({ where: { articleId } });
  if (!payment || payment.status === 'PAID' || payment.status === 'WAIVED' || payment.status === 'REFUNDED') {
    throw new ConflictError('No payment is due for this submission', 'PAYMENT_NOT_DUE');
  }
  if (!payment.amount || !payment.currency) {
    throw new ConflictError('The APC amount has not been set yet', 'APC_AMOUNT_NOT_SET');
  }
  const session = await provider.createCheckout({
    articleId,
    submissionId: article.submissionId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    payerEmail: user.email,
  });
  await prisma.apcPayment.update({ where: { articleId }, data: { provider: provider.name, providerReference: session.providerReference } });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Gateway webhook. Authenticity is checked by the provider adapter against the raw body; each provider event id is
 * stored in the same transaction as the status change, so redelivered events are no-ops.
 */
export async function handlePaymentWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
  if (!rawBody) throw new UnauthorizedError('Invalid webhook', 'WEBHOOK_INVALID');
  const provider = getPaymentProvider();
  let event;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch {
    throw new UnauthorizedError('Invalid webhook signature', 'WEBHOOK_INVALID');
  }
  return transact(async (tx) => {
    const seen = await tx.paymentWebhookEvent.createMany({ data: [{ provider: provider.name, eventId: event.eventId }], skipDuplicates: true });
    if (seen.count === 0) return { duplicate: true };

    const payment = await tx.apcPayment.findUnique({ where: { providerReference: event.providerReference } });
    if (!payment) return { duplicate: false, matched: false };
    try {
      await applyChange(tx, payment.articleId, { status: event.status, amount: event.amount, currency: event.currency, provider: provider.name }, null, 'webhook');
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err; // out-of-order or repeated state: acknowledged, not applied
    }
    await recordAudit(tx, { action: AuditAction.PAYMENT_WEBHOOK, entityType: 'ApcPayment', entityId: payment.id, metadata: { provider: provider.name, eventId: event.eventId, status: event.status } });
    return { duplicate: false, matched: true };
  });
}

export const paymentProviderConfigured = () => env.PAYMENT_PROVIDER !== 'none';
