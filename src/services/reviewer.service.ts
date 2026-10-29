import { FilePurpose, Prisma, Role, UserStatus } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import type { UploadedFiles } from '../middlewares/upload';
import { links } from '../templates/links';
import { randomToken } from '../utils/crypto';
import { transact, type Actor } from '../utils/context';
import { ConflictError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { hashPassword } from '../utils/password';
import { nextSequence, padded } from '../utils/sequence';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';
import { createAsset, stageFile, withStaged } from './files.service';
import { notifyMany } from './notification.service';
import { sendEmail } from './mail.service';
import { createInvite } from './auth.service';
import { sendInvite } from './user.service';

export interface ReviewerApplicationInput {
  email: string;
  firstName: string;
  lastName: string;
  institution: string;
  designation?: string;
  highestQualification: string;
  holdsMPharm: boolean;
  yearsTeaching: number;
  statement: string;
  subjectAreaIds: string[];
}

/** Public endpoint. The response is identical for duplicates / existing accounts so it cannot be used to probe emails. */
export async function applyAsReviewer(input: ReviewerApplicationInput, files: UploadedFiles) {
  const [existingUser, pending, areas] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    prisma.reviewerApplication.findFirst({ where: { email: input.email, status: 'PENDING' }, select: { id: true } }),
    prisma.subjectArea.count({ where: { id: { in: input.subjectAreaIds }, isActive: true } }),
  ]);
  if (areas !== new Set(input.subjectAreaIds).size) {
    throw new UnprocessableError('One or more subject areas are invalid', 'INVALID_SUBJECT_AREA', [{ field: 'subjectAreaIds', message: 'Unknown subject area' }]);
  }
  if (existingUser || pending) return;

  const cv = files.cv?.[0];
  const staged = cv ? [await stageFile(cv, FilePurpose.REVIEWER_CV)] : [];

  await withStaged(staged, () =>
    transact(async (tx) => {
      const asset = staged[0] ? await createAsset(tx, staged[0], {}) : null;
      const app = await tx.reviewerApplication.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          institution: input.institution,
          designation: input.designation,
          highestQualification: input.highestQualification,
          holdsMPharm: input.holdsMPharm,
          yearsTeaching: input.yearsTeaching,
          statement: input.statement,
          cvFileId: asset?.id,
          subjectAreas: { create: [...new Set(input.subjectAreaIds)].map((subjectAreaId) => ({ subjectAreaId })) },
        },
      });
      await recordAudit(tx, { action: AuditAction.REVIEWER_APPLICATION_SUBMITTED, entityType: 'ReviewerApplication', entityId: app.id });
      const editors = await tx.user.findMany({ where: { role: { in: [Role.EDITOR, Role.CHIEF_EDITOR_ADMIN] }, status: 'ACTIVE' }, select: { id: true } });
      await notifyMany(tx, editors.map((e) => e.id), {
        type: 'reviewer.application_submitted',
        title: 'New reviewer application',
        message: `${input.firstName} ${input.lastName} applied to become a reviewer.`,
        template: 'reviewer_application_pending_editor',
        data: { link: `${links.login()}` },
        entityType: 'ReviewerApplication',
        entityId: app.id,
        dedupeKey: `reviewer-application:${app.id}`,
      });
    }),
  );
  sendEmail(input.email, 'reviewer_application_received', { name: input.firstName }).catch((err) => logger.warn({ err: err.message }, 'application receipt email failed'));
}

const applicationSelect = {
  id: true, email: true, firstName: true, lastName: true, institution: true, designation: true, highestQualification: true,
  holdsMPharm: true, yearsTeaching: true, statement: true, status: true, decisionNote: true, reviewedAt: true, createdAt: true, cvFileId: true,
  subjectAreas: { select: { subjectArea: { select: { id: true, name: true } } } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ReviewerApplicationSelect;

async function presentApplication<T extends { holdsMPharm: boolean; yearsTeaching: number; subjectAreas: Array<{ subjectArea: { id: string; name: string } }> }>(a: T, minYears: number) {
  const { subjectAreas, ...rest } = a;
  return {
    ...rest,
    subjectAreas: subjectAreas.map((s) => s.subjectArea),
    // Proposed minimum eligibility (BR-011): M.Pharm or ≥ N years teaching. Advisory only — the Editor decides.
    meetsProposedEligibility: a.holdsMPharm || a.yearsTeaching >= minYears,
  };
}

export async function listApplications(q: { page: number; pageSize: number; status?: 'PENDING' | 'APPROVED' | 'REJECTED'; search?: string }) {
  const where: Prisma.ReviewerApplicationWhereInput = {
    status: q.status,
    ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { firstName: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const { reviewerMinYearsTeaching } = await getConfig();
  const [rows, total] = await Promise.all([
    prisma.reviewerApplication.findMany({ where, select: applicationSelect, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
    prisma.reviewerApplication.count({ where }),
  ]);
  return { items: await Promise.all(rows.map((r) => presentApplication(r, reviewerMinYearsTeaching))), meta: pageMeta(q, total) };
}

export async function getApplication(id: string) {
  const a = await prisma.reviewerApplication.findUnique({ where: { id }, select: applicationSelect });
  if (!a) throw new NotFoundError('Application not found');
  return presentApplication(a, (await getConfig()).reviewerMinYearsTeaching);
}

export async function approveApplication(id: string, note: string | undefined, actor: Actor) {
  const app = await prisma.reviewerApplication.findUnique({ where: { id }, include: { subjectAreas: true } });
  if (!app) throw new NotFoundError('Application not found');
  if (app.status !== 'PENDING') throw new ConflictError('This application has already been decided', 'ALREADY_DECIDED');
  if (await prisma.user.findUnique({ where: { email: app.email }, select: { id: true } })) {
    throw new ConflictError('An account with this email already exists. A user has exactly one role.', 'EMAIL_EXISTS');
  }
  const passwordHash = await hashPassword(randomToken(48));

  const { user, reviewerCode, link } = await transact(async (tx) => {
    const claimed = await tx.reviewerApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), decisionNote: note } });
    if (claimed.count !== 1) throw new ConflictError('This application has already been decided', 'ALREADY_DECIDED');
    const seq = await nextSequence(tx, 'reviewer');
    const code = `REV-${padded(seq)}`;
    const u = await tx.user.create({
      data: {
        email: app.email,
        firstName: app.firstName,
        lastName: app.lastName,
        role: Role.REVIEWER,
        status: UserStatus.PENDING_VERIFICATION,
        passwordHash,
        reviewerProfile: {
          create: {
            reviewerCode: code,
            institution: app.institution,
            designation: app.designation,
            highestQualification: app.highestQualification,
            holdsMPharm: app.holdsMPharm,
            yearsTeaching: app.yearsTeaching,
            subjectAreas: { create: app.subjectAreas.map((s) => ({ subjectAreaId: s.subjectAreaId })) },
          },
        },
      },
      include: { reviewerProfile: true },
    });
    await tx.reviewerApplication.update({ where: { id }, data: { createdReviewerId: u.reviewerProfile!.id } });
    const inviteLink = await createInvite(tx, u.id);
    await recordAudit(tx, { action: AuditAction.REVIEWER_APPLICATION_APPROVED, entityType: 'ReviewerApplication', entityId: id, actor, metadata: { reviewerCode: code, reviewerProfileId: u.reviewerProfile!.id } });
    return { user: u, reviewerCode: code, link: inviteLink };
  });
  const inviteEmailSent = await sendInvite(user, link, reviewerCode);
  return { reviewerId: user.reviewerProfile!.id, reviewerCode, inviteEmailSent };
}

export async function rejectApplication(id: string, note: string | undefined, actor: Actor) {
  const app = await prisma.reviewerApplication.findUnique({ where: { id } });
  if (!app) throw new NotFoundError('Application not found');
  await transact(async (tx) => {
    const claimed = await tx.reviewerApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), decisionNote: note } });
    if (claimed.count !== 1) throw new ConflictError('This application has already been decided', 'ALREADY_DECIDED');
    await recordAudit(tx, { action: AuditAction.REVIEWER_APPLICATION_REJECTED, entityType: 'ReviewerApplication', entityId: id, actor });
  });
  sendEmail(app.email, 'reviewer_application_rejected', { name: app.firstName, note }).catch((err) => logger.warn({ err: err.message }, 'rejection email failed'));
}

// ───────────────────────────── reviewer pool ─────────────────────────────

const reviewerSelect = {
  id: true, reviewerCode: true, institution: true, designation: true, highestQualification: true, holdsMPharm: true, yearsTeaching: true,
  qualificationNotes: true, eligibilityNotes: true, isActive: true, approvedAt: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
  subjectAreas: { select: { subjectArea: { select: { id: true, name: true } } } },
  _count: { select: { assignments: { where: { status: 'ASSIGNED' as const } } } },
} satisfies Prisma.ReviewerProfileSelect;

function presentReviewer(r: Prisma.ReviewerProfileGetPayload<{ select: typeof reviewerSelect }>, minYears: number) {
  const { subjectAreas, _count, ...rest } = r;
  return { ...rest, subjectAreas: subjectAreas.map((s) => s.subjectArea), activeAssignments: _count.assignments, meetsProposedEligibility: r.holdsMPharm || r.yearsTeaching >= minYears };
}

export async function listReviewers(q: { page: number; pageSize: number; search?: string; subjectAreaId?: string; isActive?: boolean }) {
  const where: Prisma.ReviewerProfileWhereInput = {
    isActive: q.isActive,
    ...(q.subjectAreaId ? { subjectAreas: { some: { subjectAreaId: q.subjectAreaId } } } : {}),
    ...(q.search
      ? {
          OR: [
            { reviewerCode: { contains: q.search, mode: 'insensitive' } },
            { institution: { contains: q.search, mode: 'insensitive' } },
            { user: { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } },
          ],
        }
      : {}),
  };
  const { reviewerMinYearsTeaching } = await getConfig();
  const [rows, total] = await Promise.all([
    prisma.reviewerProfile.findMany({ where, select: reviewerSelect, orderBy: { reviewerCode: 'asc' }, ...skipTake(q) }),
    prisma.reviewerProfile.count({ where }),
  ]);
  return { items: rows.map((r) => presentReviewer(r, reviewerMinYearsTeaching)), meta: pageMeta(q, total) };
}

export async function getReviewer(id: string) {
  const r = await prisma.reviewerProfile.findUnique({ where: { id }, select: reviewerSelect });
  if (!r) throw new NotFoundError('Reviewer not found');
  const history = await prisma.reviewerAssignment.groupBy({ by: ['status'], where: { reviewerId: id }, _count: { _all: true } });
  return { ...presentReviewer(r, (await getConfig()).reviewerMinYearsTeaching), assignmentHistory: history.map((h) => ({ status: h.status, count: h._count._all })) };
}

export async function updateReviewer(id: string, input: { isActive?: boolean; eligibilityNotes?: string; subjectAreaIds?: string[] }, actor: Actor) {
  const existing = await prisma.reviewerProfile.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Reviewer not found');
  if (input.subjectAreaIds && (await prisma.subjectArea.count({ where: { id: { in: input.subjectAreaIds } } })) !== new Set(input.subjectAreaIds).size) {
    throw new UnprocessableError('One or more subject areas are invalid', 'INVALID_SUBJECT_AREA');
  }
  await transact(async (tx) => {
    await tx.reviewerProfile.update({ where: { id }, data: { isActive: input.isActive, eligibilityNotes: input.eligibilityNotes } });
    if (input.subjectAreaIds) {
      await tx.reviewerSubjectArea.deleteMany({ where: { reviewerId: id } });
      await tx.reviewerSubjectArea.createMany({ data: [...new Set(input.subjectAreaIds)].map((subjectAreaId) => ({ reviewerId: id, subjectAreaId })) });
    }
    await recordAudit(tx, { action: AuditAction.REVIEWER_UPDATED, entityType: 'ReviewerProfile', entityId: id, actor, metadata: { fields: Object.keys(input) } });
  });
  return getReviewer(id);
}
