import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { prisma, type Db } from '../config/prisma';
import { randomToken, sha256 } from '../utils/crypto';
import { UnauthorizedError } from '../utils/errors';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(userId: string, sessionId: string, role: Role): string {
  return jwt.sign({ sid: sessionId, role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as jwt.JwtPayload;
    if (typeof p.sub !== 'string' || typeof p.sid !== 'string') throw new Error('bad claims');
    return { sub: p.sub, sid: p.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED');
    throw new UnauthorizedError('Invalid access token', 'TOKEN_INVALID');
  }
}

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_IN_DAYS * 86_400_000);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: string;
  refreshTokenExpiresAt: Date;
}

export async function startSession(db: Db, userId: string, role: Role): Promise<TokenPair> {
  const expiresAt = refreshExpiry();
  const session = await db.authSession.create({ data: { userId, expiresAt } });
  const refreshToken = randomToken(48);
  await db.refreshToken.create({ data: { sessionId: session.id, tokenHash: sha256(refreshToken), expiresAt } });
  return {
    accessToken: signAccessToken(userId, session.id, role),
    refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshTokenExpiresAt: expiresAt,
  };
}

/** Rotates the refresh token. Presenting an already-used token is treated as theft: the whole session is revoked. */
export async function rotateRefreshToken(presented: string): Promise<{ pair: TokenPair; userId: string }> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(presented) },
    include: { session: { include: { user: true } } },
  });
  if (!row) throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  const { session } = row;
  const now = new Date();

  if (row.usedAt) {
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
    throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  }
  if (session.revokedAt || row.expiresAt <= now || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  }

  const claimed = await prisma.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (claimed.count !== 1) {
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
    throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  }

  const next = randomToken(48);
  await prisma.refreshToken.create({ data: { sessionId: session.id, tokenHash: sha256(next), expiresAt: session.expiresAt } });
  return {
    userId: session.userId,
    pair: {
      accessToken: signAccessToken(session.userId, session.id, session.user.role),
      refreshToken: next,
      tokenType: 'Bearer',
      accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresAt: session.expiresAt,
    },
  };
}

export const revokeSession = (db: Db, sessionId: string) =>
  db.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });

export const revokeAllSessions = (db: Db, userId: string, exceptSessionId?: string) =>
  db.authSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
