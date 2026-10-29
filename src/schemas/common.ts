import { z } from 'zod';
import { env } from '../config/env';

export const uuid = z.uuid({ message: 'Must be a valid UUID' });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Please enter a valid email address' }));

export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const otp = z.string().regex(new RegExp(`^\\d{${env.OTP_LENGTH}}$`), `OTP must be ${env.OTP_LENGTH} digits`);

export const name = (max = 100) => z.string().trim().min(1, 'Required').max(max);
export const text = (max: number, min = 1) => z.string().trim().min(min, 'Required').max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const search = z.string().trim().max(100).optional();

export const idParam = (key: string) => z.object({ [key]: uuid });
export const articleIdParam = z.object({ articleId: uuid });

/** Query-string booleans arrive as strings. */
export const queryBool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const isoDate = z.coerce.date();

/** For multipart requests: a JSON document sent in a single text field. */
export function jsonField<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

