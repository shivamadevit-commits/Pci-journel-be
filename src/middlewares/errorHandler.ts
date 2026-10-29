import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/errors';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    requestId: req.requestId,
  });
};

function mapKnown(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'PAYLOAD_TOO_LARGE', `File exceeds the ${env.MAX_UPLOAD_MB} MB limit`);
    return new AppError(400, 'UPLOAD_ERROR', 'Invalid file upload');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return new AppError(409, 'CONFLICT', 'A record with these details already exists');
    if (err.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Resource not found');
    if (err.code === 'P2003') return new AppError(409, 'CONFLICT', 'The operation conflicts with related records');
    if (err.code === 'P2028' || err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017') {
      return new AppError(503, 'DATABASE_UNAVAILABLE', 'Service temporarily unavailable');
    }
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return new AppError(503, 'DATABASE_UNAVAILABLE', 'Service temporarily unavailable');

  const e = err as { type?: string; status?: number } | null;
  if (e?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (e?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (e?.type === 'cors.denied') return new AppError(403, 'CORS_DENIED', 'Origin is not allowed');
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = mapKnown(err);
  const appErr = known ?? new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');

  // Full detail is logged server-side only, always with the request id.
  if (appErr.status >= 500) {
    logger.error({ err, requestId: req.requestId, path: req.path, method: req.method, userId: req.user?.id }, 'request failed');
  } else {
    logger.debug({ code: appErr.code, requestId: req.requestId, path: req.path }, 'request rejected');
  }

  if (res.headersSent) return res.end();
  res.status(appErr.status).json({
    success: false,
    message: appErr.message,
    code: appErr.code,
    ...(appErr.errors ? { errors: appErr.errors } : {}),
    requestId: req.requestId,
  });
};
