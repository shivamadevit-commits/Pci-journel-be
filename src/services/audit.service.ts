import type { Prisma, Role } from '@prisma/client';
import { prisma, type Db } from '../config/prisma';
import { currentRequestId, type Actor } from '../utils/context';
import { pageMeta, skipTake } from '../utils/pagination';

/** Canonical audit event names. Events are written only by the server — there is no endpoint that accepts audit data. */
export const AuditAction = {
  USER_REGISTERED: 'user.registered',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_STATUS_CHANGED: 'user.status_changed',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOGIN_LOCKED: 'auth.account_locked',
  OTP_FAILED: 'auth.otp_failed',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  PASSWORD_CHANGED: 'auth.password_changed',
  ACCOUNT_INVITE_ACCEPTED: 'auth.account_invite_accepted',
  ARTICLE_SUBMITTED: 'article.submitted',
  ARTICLE_VERSION_UPLOADED: 'article.version_uploaded',
  ARTICLE_STATUS_CHANGED: 'article.status_changed',
  ARTICLE_EDITOR_ASSIGNED: 'article.editor_assigned',
  SCREENING_STARTED: 'editorial.screening_started',
  SCREENING_DECISION: 'editorial.screening_decision',
  PLAGIARISM_INITIATED: 'plagiarism.initiated',
  PLAGIARISM_RECORDED: 'plagiarism.recorded',
  PLAGIARISM_CLEARANCE: 'plagiarism.clearance_decision',
  REVIEWER_APPLICATION_SUBMITTED: 'reviewer.application_submitted',
  REVIEWER_APPLICATION_APPROVED: 'reviewer.application_approved',
  REVIEWER_APPLICATION_REJECTED: 'reviewer.application_rejected',
  REVIEWER_UPDATED: 'reviewer.updated',
  REVIEWERS_ASSIGNED: 'review.reviewers_assigned',
  REVIEWER_REPLACED: 'review.reviewer_replaced',
  REVIEWER_DECLINED: 'review.reviewer_declined',
  REVIEWER_REMINDED: 'review.reviewer_reminded',
  REVIEW_DRAFT_SAVED: 'review.draft_saved',
  REVIEW_SUBMITTED: 'review.submitted',
  COMMENTS_DISCLOSURE_SET: 'review.comment_disclosure_set',
  FINAL_DECISION: 'editorial.final_decision',
  PAYMENT_STATUS_CHANGED: 'payment.status_changed',
  PAYMENT_WEBHOOK: 'payment.webhook_processed',
  PRODUCTION_ASSIGNED: 'production.assigned',
  PRODUCTION_STARTED: 'production.started',
  PROOF_UPLOADED: 'production.proof_uploaded',
  PROOF_SENT: 'production.proof_sent',
  PROOF_APPROVED: 'proof.approved_by_author',
  CORRECTIONS_SUBMITTED: 'proof.corrections_submitted',
  CORRECTION_IMPLEMENTED: 'production.correction_implemented',
  CORRECTION_ESCALATED: 'production.correction_escalated',
  MAJOR_CHANGE_DECISION: 'editorial.major_change_decision',
  FINAL_FILE_UPLOADED: 'production.final_file_uploaded',
  PRODUCTION_COMPLETED: 'production.completed',
  PUBLICATION_METADATA_UPDATED: 'publication.metadata_updated',
  ARTICLE_PUBLISHED: 'publication.published',
  CONFIG_CHANGED: 'admin.config_changed',
  SUBJECT_AREA_CHANGED: 'admin.subject_area_changed',
  FILE_DOWNLOADED: 'file.downloaded',
} as const;

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: Actor | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  /** Must be free of passwords, tokens, OTPs and unnecessary personal data. */
  metadata?: Record<string, unknown>;
}

/** Pass the surrounding transaction client so the audit row commits or rolls back with the change it describes. */
export async function recordAudit(db: Db, e: AuditEvent): Promise<void> {
  await db.auditLog.create({
    data: {
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      actorId: e.actor?.id ?? null,
      actorRole: e.actor?.role ?? null,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: currentRequestId() ?? null,
    },
  });
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

export async function listAudit(q: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    actorId: q.actorId,
    action: q.action ? { startsWith: q.action } : undefined,
    entityType: q.entityType,
    entityId: q.entityId,
    createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      ...skipTake(q),
      include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      actor: r.actor ? { id: r.actor.id, name: `${r.actor.firstName} ${r.actor.lastName}`, email: r.actor.email } : null,
      actorRole: r.actorRole as Role | null,
      metadata: r.metadata,
      requestId: r.requestId,
    })),
    meta: pageMeta(q, total),
  };
}
