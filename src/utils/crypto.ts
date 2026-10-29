import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** URL-safe random token (returned to the user once; only its hash is stored). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function generateOtp(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

/** Keyed hash for low-entropy secrets (OTP). Binding the userId + purpose stops cross-user replay of a leaked hash. */
export function hashOtp(code: string, secret: string, bindTo: string): string {
  return createHmac('sha256', secret).update(`${bindTo}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
