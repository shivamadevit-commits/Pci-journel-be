import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../utils/errors';
import { links } from '../templates/links';
import { registerPaymentProvider, type CheckoutInput, type PaymentProvider, type VerifiedPaymentEvent } from './payment.provider';

/**
 * Cashfree Payments (PG orders API) adapter. Ported from the Digi-Pharmed payment-service
 * (apps/payment-service/src/cashfree): same order creation, order/payment lookup and webhook signature scheme.
 */

const SUCCESS = new Set(['PAID', 'SUCCESS']);
const FAILURE = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'TERMINATED', 'USER_DROPPED']);

/** Cashfree order/payment status -> APC status. `null` = still in progress, nothing to apply. */
export function toPaymentStatus(status: unknown): PaymentStatus | null {
  const s = typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (SUCCESS.has(s)) return 'PAID';
  if (FAILURE.has(s)) return 'FAILED';
  return null;
}

const sandbox = () => !['PRODUCTION', 'PROD'].includes(env.CASHFREE_ENV.toUpperCase());
const baseUrl = () => env.CASHFREE_BASE_URL ?? (sandbox() ? 'https://sandbox.cashfree.com/pg/orders' : 'https://api.cashfree.com/pg/orders');

/** Cashfree substitutes `{order_id}` in return_url; append it when a configured URL omits the placeholder. */
function withOrderId(url: string): string {
  return url.includes('{order_id}') ? url : `${url}${url.includes('?') ? '&' : '?'}order_id={order_id}`;
}

/** Cashfree requires a 10-digit Indian mobile number; fall back to a configured placeholder when the author has none. */
function customerPhone(raw?: string): string {
  const digits = (raw ?? '').replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : env.CASHFREE_FALLBACK_PHONE;
}

function headers(json: boolean): Record<string, string> {
  return {
    'x-client-id': env.CASHFREE_APP_ID ?? '',
    'x-client-secret': env.CASHFREE_SECRET_KEY ?? '',
    'x-api-version': env.CASHFREE_API_VERSION,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function call<T>(url: string, init: RequestInit, what: string): Promise<T> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(env.CASHFREE_TIMEOUT_MS) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      logger.error({ status: res.status, what, response: data }, 'Cashfree request failed');
      throw new Error(String(data.message ?? `HTTP ${res.status}`));
    }
    return data as T;
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const msg = timedOut ? `timed out after ${env.CASHFREE_TIMEOUT_MS}ms` : err instanceof Error ? err.message : 'unknown error';
    throw new ServiceUnavailableError(`Payment gateway error (${what}): ${msg}`, 'PAYMENT_GATEWAY_ERROR');
  }
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

export const cashfreeProvider: PaymentProvider = {
  name: 'cashfree',

  async createCheckout(input: CheckoutInput) {
    // order_id: 3-45 chars, alphanumeric/_/-. Unique per attempt so a retry after a failure gets a fresh order.
    const orderId = `APC-${input.submissionId}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 45);
    const meta: Record<string, string> = { return_url: withOrderId(env.CASHFREE_RETURN_URL ?? links.authorPaymentReturn(input.articleId)) };
    if (env.CASHFREE_NOTIFY_URL) meta.notify_url = env.CASHFREE_NOTIFY_URL;

    const order = await call<{ order_id?: string; payment_session_id?: string }>(
      baseUrl(),
      {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(input.amount),
          order_currency: input.currency,
          customer_details: {
            customer_id: input.payerId,
            customer_name: input.payerName,
            customer_email: input.payerEmail,
            customer_phone: customerPhone(input.payerPhone),
          },
          order_meta: meta,
          order_note: `Article Publishing Charge — ${input.submissionId}`,
          order_tags: { article_id: input.articleId, submission_id: input.submissionId },
        }),
      },
      'create order',
    );
    if (!order.payment_session_id) throw new ServiceUnavailableError('Payment gateway did not return a payment session', 'PAYMENT_GATEWAY_ERROR');
    return {
      mode: sandbox() ? 'sandbox' : 'production', // the frontend SDK needs this to pick the matching Cashfree environment
      providerReference: order.order_id ?? orderId,
      paymentSessionId: order.payment_session_id,
    };
  },

  /**
   * Cashfree signs `timestamp + rawBody` with the account secret key (HMAC-SHA256, base64). Only terminal payment
   * events are returned; other event types are acknowledged and ignored (`null`).
   */
  verifyWebhook(rawBody, h) {
    const signature = header(h, 'x-webhook-signature');
    const timestamp = header(h, 'x-webhook-timestamp');
    const secret = env.CASHFREE_SECRET_KEY;
    if (!secret || !signature || !timestamp) throw new Error('missing signature');
    const expected = createHmac('sha256', secret).update(timestamp + rawBody.toString('utf8')).digest();
    const given = Buffer.from(signature, 'base64');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('bad signature');

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      type?: string;
      data?: { order?: { order_id?: string }; payment?: { payment_status?: string; payment_amount?: number; payment_currency?: string; cf_payment_id?: string | number } };
    };
    const orderId = payload.data?.order?.order_id;
    const payment = payload.data?.payment;
    const status = toPaymentStatus(payment?.payment_status);
    if (!orderId || !status || !/^PAYMENT_(SUCCESS|FAILED|USER_DROPPED)_WEBHOOK$/.test(payload.type ?? '')) return null;

    return {
      // Cashfree's idempotency key identifies the delivery; fall back to a body hash so redeliveries still dedupe.
      eventId: header(h, 'x-idempotency-key') ?? createHash('sha256').update(rawBody).digest('hex'),
      providerReference: orderId,
      status,
      amount: payment?.payment_amount !== undefined ? String(payment.payment_amount) : undefined,
      currency: payment?.payment_currency,
    } satisfies VerifiedPaymentEvent;
  },

  /** Authoritative lookup used when the browser returns before (or without) the webhook. */
  async fetchStatus(providerReference) {
    const url = `${baseUrl()}/${encodeURIComponent(providerReference)}`;
    const order = await call<{ order_status?: string; order_amount?: number; order_currency?: string }>(url, { method: 'GET', headers: headers(false) }, 'verify order');
    const status = toPaymentStatus(order.order_status);
    return status
      ? { status, amount: order.order_amount !== undefined ? String(order.order_amount) : undefined, currency: order.order_currency }
      : null;
  },
};

registerPaymentProvider(cashfreeProvider.name, cashfreeProvider);
