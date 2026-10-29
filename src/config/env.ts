import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));
const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? Number(v) : undefined))
  .pipe(z.number().positive().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1),
  APP_NAME: z.string().default('PCI Journal Portal'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.string().default('0'),
  JSON_BODY_LIMIT: z.string().default('100kb'),
  SWAGGER_ENABLED: bool(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a PostgreSQL URL'),

  FRONTEND_URL: z.string().url(),
  CORS_ORIGIN: z.string().default(''),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().min(1).default('pci-journal-portal'),
  JWT_AUDIENCE: z.string().min(1).default('pci-journal-portal-clients'),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: int(7, 1),
  BCRYPT_COST: int(12, 10),

  LOGIN_OTP_REQUIRED: bool(true),
  OTP_LENGTH: int(6, 4),
  OTP_EXPIRY_MINUTES: int(10, 1),
  OTP_MAX_ATTEMPTS: int(5, 1),
  OTP_RESEND_COOLDOWN_SECONDS: int(60, 0),
  ACCOUNT_LOCK_THRESHOLD: int(5, 1),
  ACCOUNT_LOCK_MINUTES: int(15, 1),
  PASSWORD_RESET_EXPIRY_MINUTES: int(30, 1),
  INVITE_EXPIRY_HOURS: int(72, 1),

  REDIS_URL: optionalString,
  RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  RATE_LIMIT_MAX: int(300, 1),
  LOGIN_RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  LOGIN_RATE_LIMIT_MAX: int(10, 1),
  OTP_VERIFY_RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  OTP_VERIFY_RATE_LIMIT_MAX: int(10, 1),
  OTP_RESEND_RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  OTP_RESEND_RATE_LIMIT_MAX: int(5, 1),
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS: int(3600000, 1000),
  FORGOT_PASSWORD_RATE_LIMIT_MAX: int(5, 1),
  RESET_PASSWORD_RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  RESET_PASSWORD_RATE_LIMIT_MAX: int(10, 1),
  REGISTER_RATE_LIMIT_WINDOW_MS: int(3600000, 1000),
  REGISTER_RATE_LIMIT_MAX: int(10, 1),
  REVIEWER_APPLICATION_RATE_LIMIT_WINDOW_MS: int(3600000, 1000),
  REVIEWER_APPLICATION_RATE_LIMIT_MAX: int(5, 1),
  UPLOAD_RATE_LIMIT_WINDOW_MS: int(900000, 1000),
  UPLOAD_RATE_LIMIT_MAX: int(60, 1),

  EMAIL_ENABLED: bool(true),
  SMTP_HOST: optionalString,
  SMTP_PORT: int(587, 1),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().min(3).default('PCI Journal Portal <no-reply@localhost.invalid>'),
  EMAIL_MAX_ATTEMPTS: int(5, 1),
  EMAIL_RETRY_INTERVAL_SECONDS: int(120, 10),

  STORAGE_DRIVER: z.enum(['local', 'oci']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-data'),
  OCI_OS_NAMESPACE: optionalString,
  OCI_OS_REGION: optionalString,
  OCI_OS_BUCKET: optionalString,
  OCI_OS_ACCESS_KEY_ID: optionalString,
  OCI_OS_SECRET_ACCESS_KEY: optionalString,
  OCI_OS_ENDPOINT: optionalString,
  MAX_UPLOAD_MB: int(25, 1),
  MANUSCRIPT_ALLOWED_EXTENSIONS: z.string().default('docx'),

  SUBMISSION_ID_PREFIX: z.string().regex(/^[A-Z0-9]{2,10}$/).default('PCI'),
  WORD_LIMIT: int(5000, 1),
  APC_ENFORCEMENT: z.enum(['none', 'flag', 'block']).default('flag'),
  APC_DEFAULT_AMOUNT: optionalNumber,
  APC_CURRENCY: optionalString.pipe(z.string().length(3).toUpperCase().optional()),
  ALLOW_REVISION_AFTER_REVIEW: bool(false),
  REVIEW_DUE_DAYS: optionalNumber,
  REVIEWER_MIN_YEARS_TEACHING: int(10, 0),
  PUBLICATION_REQUIRED_METADATA: z.string().default(''),

  PAYMENT_PROVIDER: z.string().default('none'),
  PAYMENT_API_KEY: optionalString,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  PLAGIARISM_PROVIDER: z.string().default('none'),
  PLAGIARISM_API_BASE_URL: optionalString,
  PLAGIARISM_API_KEY: optionalString,
  PLAGIARISM_WEBHOOK_SECRET: optionalString,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
  // Logger is not available yet (it depends on this module); fail fast with a clear message.
  console.error(`\nInvalid or missing environment configuration:\n${lines.join('\n')}\n`);
  process.exit(1);
}

const e = parsed.data;
const problems: string[] = [];

if (e.EMAIL_ENABLED && !e.SMTP_HOST) problems.push('SMTP_HOST is required when EMAIL_ENABLED=true');
if (e.EMAIL_ENABLED && Boolean(e.SMTP_USER) !== Boolean(e.SMTP_PASS)) problems.push('SMTP_USER and SMTP_PASS must be set together');
if (e.STORAGE_DRIVER === 'oci') {
  for (const k of ['OCI_OS_NAMESPACE', 'OCI_OS_REGION', 'OCI_OS_BUCKET', 'OCI_OS_ACCESS_KEY_ID', 'OCI_OS_SECRET_ACCESS_KEY'] as const) {
    if (!e[k]) problems.push(`${k} is required when STORAGE_DRIVER=oci`);
  }
}
if (e.APC_DEFAULT_AMOUNT !== undefined && !e.APC_CURRENCY) problems.push('APC_CURRENCY is required when APC_DEFAULT_AMOUNT is set');
if (e.PAYMENT_PROVIDER !== 'none' && !e.PAYMENT_WEBHOOK_SECRET) problems.push('PAYMENT_WEBHOOK_SECRET is required when PAYMENT_PROVIDER is configured');
if (e.PLAGIARISM_PROVIDER !== 'none' && !e.PLAGIARISM_WEBHOOK_SECRET) problems.push('PLAGIARISM_WEBHOOK_SECRET is required when PLAGIARISM_PROVIDER is configured');
if (e.NODE_ENV === 'production') {
  if (e.TRUST_PROXY.trim().toLowerCase() === 'true') problems.push('TRUST_PROXY must not be "true" in production; use a hop count or CIDR list');
  if (/localhost|127\.0\.0\.1/.test(e.FRONTEND_URL)) problems.push('FRONTEND_URL must not point at localhost in production');
  if (e.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER=local is not allowed in production; use oci');
  if (/replace-with|changeme|example/i.test(e.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET still has a placeholder value');
}
if (problems.length) {
  console.error(`\nInvalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}

const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function parseTrustProxy(v: string): boolean | number | string[] {
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (t === 'false' || t === '') return false;
  return csv(t);
}

export const env = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  trustProxy: parseTrustProxy(e.TRUST_PROXY),
  corsOrigins: csv(e.CORS_ORIGIN).length ? csv(e.CORS_ORIGIN) : [new URL(e.FRONTEND_URL).origin],
  manuscriptExtensions: csv(e.MANUSCRIPT_ALLOWED_EXTENSIONS).map((x) => x.replace(/^\./, '').toLowerCase()),
  publicationRequiredMetadata: csv(e.PUBLICATION_REQUIRED_METADATA),
  maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
};

export type Env = typeof env;
