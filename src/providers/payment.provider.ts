import type { PaymentStatus } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../utils/errors';

export interface CheckoutInput {
  articleId: string;
  submissionId: string;
  amount: string;
  currency: string;
  payerEmail: string;
}

export interface VerifiedPaymentEvent {
  /** Provider's unique event id — used to make webhook processing idempotent. */
  eventId: string;
  providerReference: string;
  status: PaymentStatus;
  amount?: string;
  currency?: string;
}

/**
 * Integration point for the APC payment gateway. PCI has not selected a gateway, APC amount, refund rules or
 * failure handling, so no vendor adapter is shipped. Implement this interface for the chosen gateway and register it
 * with `registerPaymentProvider("<name>", adapter)`, then set PAYMENT_PROVIDER=<name>.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string; providerReference: string }>;
  /**
   * Authenticates a webhook delivery (signature over the raw body using PAYMENT_WEBHOOK_SECRET) and returns the
   * normalised event. MUST throw if the signature is invalid.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent;
}

const registry = new Map<string, PaymentProvider>();
export const registerPaymentProvider = (name: string, p: PaymentProvider) => registry.set(name, p);

export function getPaymentProvider(): PaymentProvider {
  const name = env.PAYMENT_PROVIDER;
  const p = name === 'none' ? undefined : registry.get(name);
  if (!p) {
    throw new ServiceUnavailableError(
      name === 'none' ? 'No payment gateway is configured. Payments are recorded manually by the editorial office.' : `Payment provider "${name}" has no adapter registered.`,
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  }
  return p;
}

if (env.PAYMENT_PROVIDER !== 'none' && !registry.has(env.PAYMENT_PROVIDER)) {
  logger.warn({ provider: env.PAYMENT_PROVIDER }, 'PAYMENT_PROVIDER is set but no adapter is registered');
}
