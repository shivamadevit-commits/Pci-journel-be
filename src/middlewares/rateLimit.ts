import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { TooManyRequestsError } from '../utils/errors';

/**
 * Shared store: with REDIS_URL set, limits are enforced across all application instances (required for
 * multi-instance OCI deployments). Without it limits are per-process — fine for a single instance / development.
 */
export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false })
  : null;
redis?.on('error', (err: Error) => logger.error({ err: err.message }, 'redis error'));

if (!redis && env.isProd) {
  logger.warn('REDIS_URL is not set: rate limits are per-instance and not globally consistent');
}

export type LimiterName =
  | 'general'
  | 'login'
  | 'otpVerify'
  | 'otpResend'
  | 'forgotPassword'
  | 'resetPassword'
  | 'register'
  | 'reviewerApplication'
  | 'upload';

const config: Record<LimiterName, { windowMs: number; limit: number; keyBody?: string }> = {
  general: { windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX },
  login: { windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS, limit: env.LOGIN_RATE_LIMIT_MAX },
  otpVerify: { windowMs: env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS, limit: env.OTP_VERIFY_RATE_LIMIT_MAX, keyBody: 'challengeId' },
  otpResend: { windowMs: env.OTP_RESEND_RATE_LIMIT_WINDOW_MS, limit: env.OTP_RESEND_RATE_LIMIT_MAX, keyBody: 'challengeId' },
  forgotPassword: { windowMs: env.FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS, limit: env.FORGOT_PASSWORD_RATE_LIMIT_MAX },
  resetPassword: { windowMs: env.RESET_PASSWORD_RATE_LIMIT_WINDOW_MS, limit: env.RESET_PASSWORD_RATE_LIMIT_MAX },
  register: { windowMs: env.REGISTER_RATE_LIMIT_WINDOW_MS, limit: env.REGISTER_RATE_LIMIT_MAX },
  reviewerApplication: { windowMs: env.REVIEWER_APPLICATION_RATE_LIMIT_WINDOW_MS, limit: env.REVIEWER_APPLICATION_RATE_LIMIT_MAX },
  upload: { windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MS, limit: env.UPLOAD_RATE_LIMIT_MAX },
};

const cache = new Map<LimiterName, RequestHandler>();

function build(name: LimiterName): RequestHandler {
  const c = config[name];
  const options: Partial<Options> = {
    windowMs: c.windowMs,
    limit: c.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Authenticated traffic is limited per user; everything else per client IP (honouring TRUST_PROXY only).
    keyGenerator: (req: Request) => {
      const base = req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
      const extra = c.keyBody && typeof req.body?.[c.keyBody] === 'string' ? `:${String(req.body[c.keyBody]).slice(0, 64)}` : '';
      return `${name}:${base}${extra}`;
    },
    handler: (_req, _res, next) => next(new TooManyRequestsError()),
    ...(redis
      ? {
          store: new RedisStore({
            prefix: `pci:rl:${name}:`,
            sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as Promise<never>,
          }),
        }
      : {}),
  };
  return rateLimit(options);
}

export function limiter(name: LimiterName): RequestHandler {
  let l = cache.get(name);
  if (!l) {
    l = build(name);
    cache.set(name, l);
  }
  return l;
}
