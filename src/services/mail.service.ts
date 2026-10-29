import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../utils/errors';
import { renderEmail } from '../templates/email';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
    });
  }
  return transporter;
}

export type SendResult = 'sent' | 'skipped';

/**
 * Sends one e-mail. Resolves 'sent' only after the SMTP server accepted the message; throws on any failure so
 * callers can never record a failed delivery as delivered. Resolves 'skipped' only when e-mail is disabled by config.
 */
export async function sendEmail(to: string, template: string, data: Record<string, string | number | undefined | null>): Promise<SendResult> {
  if (!env.EMAIL_ENABLED) {
    logger.warn({ template }, 'email disabled by configuration; message not sent');
    return 'skipped';
  }
  const mail = renderEmail(template, data);
  await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject: mail.subject, html: mail.html, text: mail.text });
  return 'sent';
}

/** For security-critical mail (OTP) where the caller must tell the user if delivery failed. */
export async function sendEmailOrFail(to: string, template: string, data: Record<string, string | number | undefined | null>): Promise<void> {
  try {
    const r = await sendEmail(to, template, data);
    if (r === 'skipped') throw new Error('email disabled');
  } catch (err) {
    logger.error({ err: (err as Error).message, template }, 'email delivery failed');
    throw new ServiceUnavailableError('We could not send the email. Please try again shortly.', 'EMAIL_DELIVERY_FAILED');
  }
}

export async function verifyMailTransport(): Promise<boolean> {
  if (!env.EMAIL_ENABLED) return true;
  try {
    await getTransporter().verify();
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'SMTP verification failed');
    return false;
  }
}

export const closeMail = () => transporter?.close();
