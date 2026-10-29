import { OtpPurpose, ResetTokenPurpose, Role, UserStatus, type User } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma, type Db } from '../config/prisma';
import { generateOtp, hashOtp, randomToken, safeEqualHex, sha256 } from '../utils/crypto';
import { transact } from '../utils/context';
import { ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError, BadRequestError } from '../utils/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../utils/password';
import { links } from '../templates/links';
import { AuditAction, recordAudit } from './audit.service';
import { sendEmail, sendEmailOrFail } from './mail.service';
import { revokeAllSessions, revokeSession, rotateRefreshToken, startSession, type TokenPair } from './token.service';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_CODE = 'The verification code is invalid or has expired';

export const publicUser = (u: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'status'>) => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
  status: u.status,
});

// ───────────────────────────── OTP helpers ─────────────────────────────

async function createOtp(db: Db, user: Pick<User, 'id'>, purpose: OtpPurpose) {
  const code = generateOtp(env.OTP_LENGTH);
  // Invalidate any earlier unused challenge for the same purpose.
  await db.authOtp.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  const row = await db.authOtp.create({
    data: {
      userId: user.id,
      purpose,
      codeHash: 'pending',
      expiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60_000),
      maxAttempts: env.OTP_MAX_ATTEMPTS,
    },
  });
  const updated = await db.authOtp.update({ where: { id: row.id }, data: { codeHash: hashOtp(code, env.JWT_ACCESS_SECRET, `${row.id}:${user.id}:${purpose}`) } });
  return { code, challenge: updated };
}

async function cooldownRemaining(userId: string, purpose: OtpPurpose): Promise<number> {
  if (env.OTP_RESEND_COOLDOWN_SECONDS === 0) return 0;
  const last = await prisma.authOtp.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (!last) return 0;
  const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

/** Creates an OTP and e-mails it. If the e-mail cannot be delivered the OTP is voided and an error is returned. */
async function issueAndSendOtp(user: Pick<User, 'id' | 'email' | 'firstName'>, purpose: OtpPurpose) {
  const { code, challenge } = await createOtp(prisma, user, purpose);
  try {
    await sendEmailOrFail(user.email, purpose === 'LOGIN' ? 'login_otp' : 'verification_otp', {
      name: user.firstName,
      otp: code,
      minutes: env.OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    await prisma.authOtp.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw err;
  }
  return challenge;
}

type Challenge = NonNullable<Awaited<ReturnType<typeof prisma.authOtp.findUnique>>>;

/** Constant-time check with attempt counting and single use. Returns true only once per OTP. */
async function checkOtp(challenge: Challenge, code: string): Promise<boolean> {
  const now = new Date();
  if (challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= challenge.maxAttempts) return false;

  // Count the attempt first (atomically) so parallel guesses cannot exceed the limit.
  const counted = await prisma.authOtp.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return false;

  const expected = hashOtp(code, env.JWT_ACCESS_SECRET, `${challenge.id}:${challenge.userId}:${challenge.purpose}`);
  if (!safeEqualHex(expected, challenge.codeHash)) return false;

  const used = await prisma.authOtp.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } });
  return used.count === 1;
}

// ───────────────────────────── registration & verification ─────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  affiliation?: string;
  country?: string;
}

/** Authors self-register. The response is identical whether or not the e-mail already exists (no enumeration). */
export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    if (existing.status === UserStatus.PENDING_VERIFICATION && existing.role === Role.AUTHOR) {
      await trySendVerification(existing);
    }
    return;
  }
  const passwordHash = await hashPassword(input.password);
  const user = await transact(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: Role.AUTHOR,
        status: UserStatus.PENDING_VERIFICATION,
        passwordChangedAt: new Date(),
        authorProfile: { create: { affiliation: input.affiliation, country: input.country } },
      },
    });
    await recordAudit(tx, { action: AuditAction.USER_REGISTERED, entityType: 'User', entityId: u.id, actor: { id: u.id, role: u.role } });
    return u;
  }).catch((err) => {
    if (err?.code === 'P2002') return null; // concurrent registration of the same e-mail
    throw err;
  });
  if (user) await trySendVerification(user);
}

async function trySendVerification(user: User) {
  if ((await cooldownRemaining(user.id, OtpPurpose.EMAIL_VERIFICATION)) > 0) return;
  try {
    await issueAndSendOtp(user, OtpPurpose.EMAIL_VERIFICATION);
  } catch (err) {
    // Not surfaced: the response must not depend on whether the account exists.
    logger.warn({ err: (err as Error).message }, 'verification email could not be sent');
  }
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === UserStatus.PENDING_VERIFICATION) await trySendVerification(user);
}

export async function verifyEmail(email: string, otp: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
    await burnPasswordCheck(otp);
    throw new BadRequestError(INVALID_CODE);
  }
  const challenge = await prisma.authOtp.findFirst({
    where: { userId: user.id, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || !(await checkOtp(challenge, otp))) throw new BadRequestError(INVALID_CODE);

  await transact(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } });
    await recordAudit(tx, {
      action: AuditAction.USER_EMAIL_VERIFIED,
      entityType: 'User',
      entityId: user.id,
      actor: { id: user.id, role: user.role },
      fromStatus: user.status,
      toStatus: UserStatus.ACTIVE,
    });
  });
}

// ───────────────────────────── login ─────────────────────────────

export type LoginResult =
  | { otpRequired: true; challengeId: string; expiresAt: Date; resendAvailableInSeconds: number }
  | { otpRequired: false; tokens: TokenPair; user: ReturnType<typeof publicUser> };

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  const now = new Date();

  if (!user) {
    await burnPasswordCheck(password);
    await recordAudit(prisma, { action: AuditAction.LOGIN_FAILED, entityType: 'User', metadata: { reason: 'unknown_account' } });
    throw new UnauthorizedError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  const locked = user.lockedUntil !== null && user.lockedUntil > now;
  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (locked || !passwordOk) {
    if (!locked) await registerFailedLogin(user);
    else await recordAudit(prisma, { action: AuditAction.LOGIN_FAILED, entityType: 'User', entityId: user.id, actor: { id: user.id, role: user.role }, metadata: { reason: 'locked' } });
    throw new UnauthorizedError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS'); // same response for wrong password and locked account
  }

  if (user.status === UserStatus.PENDING_VERIFICATION) {
    await trySendVerification(user);
    throw new ForbiddenError('Please verify your email address. A new verification code has been sent.', 'EMAIL_NOT_VERIFIED');
  }
  if (user.status !== UserStatus.ACTIVE) throw new ForbiddenError('This account is not active. Contact the journal office.', 'ACCOUNT_DISABLED');

  if (user.failedLoginCount > 0) await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

  if (!env.LOGIN_OTP_REQUIRED) return completeLogin(user);

  const wait = await cooldownRemaining(user.id, OtpPurpose.LOGIN);
  if (wait > 0) {
    // Re-use the pending challenge instead of mailing again inside the cooldown.
    const pending = await prisma.authOtp.findFirst({ where: { userId: user.id, purpose: OtpPurpose.LOGIN, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (pending) return { otpRequired: true, challengeId: pending.id, expiresAt: pending.expiresAt, resendAvailableInSeconds: wait };
  }
  const challenge = await issueAndSendOtp(user, OtpPurpose.LOGIN);
  return { otpRequired: true, challengeId: challenge.id, expiresAt: challenge.expiresAt, resendAvailableInSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

async function registerFailedLogin(user: User) {
  const count = user.failedLoginCount + 1;
  const lock = count >= env.ACCOUNT_LOCK_THRESHOLD;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: lock ? 0 : count, lockedUntil: lock ? new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60_000) : user.lockedUntil },
  });
  await recordAudit(prisma, {
    action: lock ? AuditAction.LOGIN_LOCKED : AuditAction.LOGIN_FAILED,
    entityType: 'User',
    entityId: user.id,
    actor: { id: user.id, role: user.role },
    metadata: { reason: 'bad_password' },
  });
}

async function completeLogin(user: User): Promise<LoginResult> {
  const tokens = await transact(async (tx) => {
    const pair = await startSession(tx, user.id, user.role);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await recordAudit(tx, { action: AuditAction.LOGIN_SUCCESS, entityType: 'User', entityId: user.id, actor: { id: user.id, role: user.role } });
    return pair;
  });
  return { otpRequired: false, tokens, user: publicUser(user) };
}

export async function verifyLoginOtp(challengeId: string, otp: string) {
  const challenge = await prisma.authOtp.findUnique({ where: { id: challengeId }, include: { user: true } });
  if (!challenge || challenge.purpose !== OtpPurpose.LOGIN) {
    await burnPasswordCheck(otp);
    throw new UnauthorizedError(INVALID_CODE, 'OTP_INVALID');
  }
  const ok = await checkOtp(challenge, otp);
  if (!ok || challenge.user.status !== UserStatus.ACTIVE) {
    await recordAudit(prisma, { action: AuditAction.OTP_FAILED, entityType: 'User', entityId: challenge.userId, actor: { id: challenge.userId, role: challenge.user.role } });
    throw new UnauthorizedError(INVALID_CODE, 'OTP_INVALID');
  }
  const res = await completeLogin(challenge.user);
  if (res.otpRequired) throw new Error('unreachable');
  return res;
}

export async function resendLoginOtp(challengeId: string) {
  const old = await prisma.authOtp.findUnique({ where: { id: challengeId }, include: { user: true } });
  const fresh = old && old.purpose === OtpPurpose.LOGIN && !old.consumedAt && old.createdAt.getTime() > Date.now() - 3600_000 && old.user.status === UserStatus.ACTIVE;
  if (!old || !fresh) throw new UnauthorizedError('This sign-in attempt has expired. Please sign in again.', 'CHALLENGE_EXPIRED');

  const wait = await cooldownRemaining(old.userId, OtpPurpose.LOGIN);
  if (wait > 0) throw new TooManyRequestsError(`Please wait ${wait} seconds before requesting another code.`);
  const challenge = await issueAndSendOtp(old.user, OtpPurpose.LOGIN);
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, resendAvailableInSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

// ───────────────────────────── refresh / logout ─────────────────────────────

export async function refresh(refreshToken: string) {
  const { pair } = await rotateRefreshToken(refreshToken);
  return pair;
}

export async function logout(user: Express.AuthUser) {
  await transact(async (tx) => {
    await revokeSession(tx, user.sessionId);
    await recordAudit(tx, { action: AuditAction.LOGOUT, entityType: 'User', entityId: user.id, actor: user });
  });
}

// ───────────────────────────── password reset / change ─────────────────────────────

/** Always resolves the same way; the e-mail is sent in the background so timing does not reveal account existence. */
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== UserStatus.ACTIVE) return;

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, purpose: ResetTokenPurpose.PASSWORD_RESET, createdAt: { gt: new Date(Date.now() - env.OTP_RESEND_COOLDOWN_SECONDS * 1000) } },
  });
  if (recent) return;

  const token = randomToken(32);
  await transact(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, purpose: ResetTokenPurpose.PASSWORD_RESET, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + env.PASSWORD_RESET_EXPIRY_MINUTES * 60_000) },
    });
    await recordAudit(tx, { action: AuditAction.PASSWORD_RESET_REQUESTED, entityType: 'User', entityId: user.id, actor: { id: user.id, role: user.role } });
  });
  setImmediate(() => {
    sendEmail(user.email, 'password_reset', { name: user.firstName, link: links.resetPassword(token), minutes: env.PASSWORD_RESET_EXPIRY_MINUTES }).catch((err) =>
      logger.error({ err: err.message }, 'password reset email failed'),
    );
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  const now = new Date();
  const isInvite = row?.purpose === ResetTokenPurpose.ACCOUNT_INVITE;
  const statusOk = row && (row.user.status === UserStatus.ACTIVE || (isInvite && row.user.status === UserStatus.PENDING_VERIFICATION));
  if (!row || row.usedAt || row.expiresAt <= now || !statusOk) throw new BadRequestError('This link is invalid or has expired', undefined);

  const passwordHash = await hashPassword(newPassword);
  await transact(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new BadRequestError('This link is invalid or has expired');
    await tx.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        ...(isInvite && row.user.status === UserStatus.PENDING_VERIFICATION ? { status: UserStatus.ACTIVE, emailVerifiedAt: now } : {}),
      },
    });
    await revokeAllSessions(tx, row.userId);
    await recordAudit(tx, {
      action: isInvite ? AuditAction.ACCOUNT_INVITE_ACCEPTED : AuditAction.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: row.userId,
      actor: { id: row.userId, role: row.user.role },
    });
  });
  setImmediate(() => {
    sendEmail(row.user.email, 'password_reset_confirmation', { name: row.user.firstName }).catch((err) => logger.error({ err: err.message }, 'reset confirmation email failed'));
  });
}

export async function changePassword(user: Express.AuthUser, currentPassword: string, newPassword: string) {
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row) throw new NotFoundError('User not found');
  if (!(await verifyPassword(currentPassword, row.passwordHash))) throw new BadRequestError('Current password is incorrect');
  if (currentPassword === newPassword) throw new BadRequestError('New password must be different from the current password');

  const passwordHash = await hashPassword(newPassword);
  await transact(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    await revokeAllSessions(tx, user.id, user.sessionId);
    await recordAudit(tx, { action: AuditAction.PASSWORD_CHANGED, entityType: 'User', entityId: user.id, actor: user });
  });
  setImmediate(() => {
    sendEmail(row.email, 'password_reset_confirmation', { name: row.firstName }).catch((err) => logger.error({ err: err.message }, 'password change email failed'));
  });
}

/** Issues a set-password invitation (new staff / approved reviewers). The token is e-mailed once and only its hash is stored. */
export async function createInvite(db: Db, userId: string) {
  const token = randomToken(32);
  await db.passwordResetToken.create({
    data: { userId, purpose: ResetTokenPurpose.ACCOUNT_INVITE, tokenHash: sha256(token), expiresAt: new Date(Date.now() + env.INVITE_EXPIRY_HOURS * 3600_000) },
  });
  return links.setPassword(token);
}
