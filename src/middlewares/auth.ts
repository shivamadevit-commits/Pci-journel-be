import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../services/token.service';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * Validates the bearer JWT (algorithm, issuer, audience, expiry), then re-checks the session and account in the
 * database so logout, deactivation and role changes take effect immediately. The role always comes from the DB,
 * never from the token or the client.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.header('authorization');
  if (!header || !/^Bearer\s+\S+$/i.test(header)) throw new UnauthorizedError();
  const claims = verifyAccessToken(header.replace(/^Bearer\s+/i, ''));

  const session = await prisma.authSession.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.userId !== claims.sub ||
    session.user.status !== 'ACTIVE'
  ) {
    throw new UnauthorizedError('Session is no longer valid', 'SESSION_INVALID');
  }
  const u = session.user;
  req.user = { id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName, sessionId: session.id };
  next();
});

export const authorize = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new UnauthorizedError());
  if (!roles.includes(req.user.role)) return next(new ForbiddenError());
  next();
};
