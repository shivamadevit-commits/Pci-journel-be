import type { PaymentStatus } from '@prisma/client';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../utils/errors';

export interface CheckoutInput {
  articleId: string;
  submissionId: string;
  amount: string;
  currency: string;
  payerEmail: string;
  payerId: string;
  payerName: string;
  payerPhone?: string;
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
 * Integration point for the APC payment gateway. Adapters register themselves with
 * `registerPaymentProvider("<name>", adapter)`; PAYMENT_PROVIDER=<name> selects the active one.
 * Shipped adapters: `cashfree` (providers/cashfree.provider.ts).
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<{ checkoutUrl?: string; providerReference: string; paymentSessionId?: string; mode?: string }>;
  /**
   * Authenticates a webhook delivery (signature over the raw body using PAYMENT_WEBHOOK_SECRET) and returns the
   * normalised event, or `null` for authentic events that need no action. MUST throw if the signature is invalid.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent | null;
  /** Asks the gateway for the current outcome of an order (`null` while still in progress). */
  fetchStatus?(providerReference: string): Promise<{ status: PaymentStatus; amount?: string; currency?: string } | null>;
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
