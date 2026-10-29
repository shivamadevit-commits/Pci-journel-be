import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'pci-journal-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Structured JSON to stdout/stderr; the platform (OCI Logging) collects it.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.passwordHash',
      '*.otp',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.codeHash',
      '*.tokenHash',
      '*.SMTP_PASS',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});
