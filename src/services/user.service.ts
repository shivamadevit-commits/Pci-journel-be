import { Prisma, Role, UserStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { STAFF_CREATABLE_ROLES } from '../constants/roles';
import { randomToken } from '../utils/crypto';
import { transact, type Actor } from '../utils/context';
import { ConflictError, ForbiddenError, NotFoundError, BadRequestError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { hashPassword } from '../utils/password';
import { AuditAction, recordAudit } from './audit.service';
import { createInvite, publicUser } from './auth.service';
import { sendEmail } from './mail.service';
import { revokeAllSessions } from './token.service';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  REVIEWER: 'Reviewer',
  AUTHOR: 'Author',
  PRODUCTION: 'Production Team',
};
export const roleLabel = (r: Role) => ROLE_LABEL[r];

const adminView = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  reviewerProfile: { select: { id: true, reviewerCode: true, isActive: true } },
} satisfies Prisma.UserSelect;

export interface UserListQuery {
  page: number;
  pageSize: number;
  search?: string;
  role?: Role;
  status?: UserStatus;
  sortBy: 'createdAt' | 'lastName' | 'email' | 'lastLoginAt';
  sortOrder: 'asc' | 'desc';
}

export async function listUsers(q: UserListQuery) {
  const where: Prisma.UserWhereInput = {
    role: q.role,
    status: q.status,
    ...(q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: 'insensitive' } },
            { firstName: { contains: q.search, mode: 'insensitive' } },
            { lastName: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: adminView, orderBy: { [q.sortBy]: q.sortOrder }, ...skipTake(q) }),
    prisma.user.count({ where }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

export async function getUser(id: string) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { ...adminView, authorProfile: true, editorProfile: true, passwordChangedAt: true },
  });
  if (!u) throw new NotFoundError('User not found');
  return u;
}

async function activeAdminCount(excludeId?: string) {
  return prisma.user.count({ where: { role: Role.ADMIN, status: UserStatus.ACTIVE, ...(excludeId ? { id: { not: excludeId } } : {}) } });
}

export async function createStaff(input: { email: string; firstName: string; lastName: string; role: Role; designation?: string }, actor: Actor) {
  if (!STAFF_CREATABLE_ROLES.includes(input.role)) throw new BadRequestError('Only Editor and Production accounts can be created here');
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ConflictError('An account with this email already exists', 'EMAIL_EXISTS');

  // The account has an unusable random password until the invitee sets one through the invitation link.
  const passwordHash = await hashPassword(randomToken(48));
  const { user, link } = await transact(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: UserStatus.PENDING_VERIFICATION,
        passwordHash,
        ...(input.role === Role.EDITOR ? { editorProfile: { create: { designation: input.designation } } } : {}),
      },
    });
    const invite = await createInvite(tx, u.id);
    await recordAudit(tx, { action: AuditAction.USER_CREATED, entityType: 'User', entityId: u.id, actor, metadata: { role: u.role } });
    return { user: u, link: invite };
  });
  const inviteEmailSent = await sendInvite(user, link);
  return { user: publicUser(user), inviteEmailSent };
}

async function sendInvite(user: { email: string; firstName: string; role: Role }, link: string, reviewerCode?: string): Promise<boolean> {
  try {
    return (await sendEmail(user.email, 'account_invite', { name: user.firstName, link, hours: env.INVITE_EXPIRY_HOURS, roleLabel: roleLabel(user.role), reviewerCode })) === 'sent';
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'invite email failed');
    return false;
  }
}
export { sendInvite };

export async function resendInvite(id: string, actor: Actor) {
  const user = await prisma.user.findUnique({ where: { id }, include: { reviewerProfile: true } });
  if (!user) throw new NotFoundError('User not found');
  if (user.status !== UserStatus.PENDING_VERIFICATION) throw new ConflictError('This account has already been activated');
  const link = await transact(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: id, purpose: 'ACCOUNT_INVITE', usedAt: null }, data: { usedAt: new Date() } });
    return createInvite(tx, id);
  });
  return { inviteEmailSent: await sendInvite(user, link, user.reviewerProfile?.reviewerCode) };
}

const STAFF_ROLES: Role[] = [Role.EDITOR, Role.PRODUCTION];

export async function changeRole(id: string, role: Role, actor: Actor) {
  if (id === actor.id) throw new ForbiddenError('You cannot change your own role');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError('User not found');
  if (!STAFF_ROLES.includes(user.role) || !STAFF_ROLES.includes(role)) {
    throw new BadRequestError('Role changes are only supported between Editor and Production accounts');
  }
  if (user.role === role) return publicUser(user);
  return transact(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { role, ...(role === Role.EDITOR ? { editorProfile: { connectOrCreate: { where: { userId: id }, create: {} } } } : {}) },
    });
    await revokeAllSessions(tx, id); // the new role applies from the next sign-in
    await recordAudit(tx, { action: AuditAction.USER_ROLE_CHANGED, entityType: 'User', entityId: id, actor, fromStatus: user.role, toStatus: role });
    return publicUser(u);
  });
}

export async function changeStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED', actor: Actor) {
  if (id === actor.id) throw new ForbiddenError('You cannot change your own account status');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError('User not found');
  if (user.status === UserStatus.PENDING_VERIFICATION) throw new ConflictError('Account has not been activated yet');
  if (user.role === Role.ADMIN && status !== 'ACTIVE' && user.status === UserStatus.ACTIVE && (await activeAdminCount(id)) === 0) {
    throw new ConflictError('At least one active Admin is required', 'LAST_ADMIN');
  }
  return transact(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { status, ...(status === 'ACTIVE' ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
    if (user.role === Role.REVIEWER) await tx.reviewerProfile.updateMany({ where: { userId: id }, data: { isActive: status === 'ACTIVE' } });
    if (status !== 'ACTIVE') await revokeAllSessions(tx, id);
    await recordAudit(tx, { action: AuditAction.USER_STATUS_CHANGED, entityType: 'User', entityId: id, actor, fromStatus: user.status, toStatus: status });
    return publicUser(u);
  });
}

// ───────────────────────────── own profile ─────────────────────────────

export async function getMe(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true,
      authorProfile: { select: { affiliation: true, country: true, phone: true } },
      editorProfile: { select: { designation: true } },
      reviewerProfile: {
        select: {
          id: true, reviewerCode: true, institution: true, designation: true, highestQualification: true, holdsMPharm: true, yearsTeaching: true, qualificationNotes: true, isActive: true,
          subjectAreas: { select: { subjectArea: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  const { reviewerProfile, ...rest } = u;
  return { ...rest, reviewerProfile: reviewerProfile ? { ...reviewerProfile, subjectAreas: reviewerProfile.subjectAreas.map((s) => s.subjectArea) } : null };
}

export interface ProfileInput {
  firstName?: string;
  lastName?: string;
  affiliation?: string;
  country?: string;
  phone?: string;
  designation?: string;
  institution?: string;
  qualificationNotes?: string;
}

/** Explicit field mapping per role — nothing from the request body reaches Prisma unfiltered. */
export async function updateMyProfile(user: Express.AuthUser, input: ProfileInput) {
  await transact(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { firstName: input.firstName, lastName: input.lastName } });
    if (user.role === Role.AUTHOR) {
      const data = { affiliation: input.affiliation, country: input.country, phone: input.phone };
      await tx.authorProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    } else if (user.role === Role.EDITOR || user.role === Role.ADMIN) {
      const data = { designation: input.designation };
      await tx.editorProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    } else if (user.role === Role.REVIEWER) {
      await tx.reviewerProfile.updateMany({
        where: { userId: user.id },
        data: { institution: input.institution, designation: input.designation, qualificationNotes: input.qualificationNotes },
      });
    }
    await recordAudit(tx, { action: AuditAction.USER_PROFILE_UPDATED, entityType: 'User', entityId: user.id, actor: user, metadata: { fields: Object.keys(input).filter((k) => input[k as keyof ProfileInput] !== undefined) } });
  });
  return getMe(user.id);
}

// ───────────────────────────── subject areas ─────────────────────────────

export const listSubjectAreas = (includeInactive = false) =>
  prisma.subjectArea.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } });

export async function createSubjectArea(name: string, actor: Actor) {
  if (await prisma.subjectArea.findUnique({ where: { name }, select: { id: true } })) throw new ConflictError('Subject area already exists');
  return transact(async (tx) => {
    const s = await tx.subjectArea.create({ data: { name } });
    await recordAudit(tx, { action: AuditAction.SUBJECT_AREA_CHANGED, entityType: 'SubjectArea', entityId: s.id, actor, metadata: { name, op: 'create' } });
    return s;
  });
}

export async function updateSubjectArea(id: string, input: { name?: string; isActive?: boolean }, actor: Actor) {
  const existing = await prisma.subjectArea.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Subject area not found');
  return transact(async (tx) => {
    const s = await tx.subjectArea.update({ where: { id }, data: { name: input.name, isActive: input.isActive } });
    await recordAudit(tx, { action: AuditAction.SUBJECT_AREA_CHANGED, entityType: 'SubjectArea', entityId: id, actor, metadata: { op: 'update', ...input } });
    return s;
  });
}
