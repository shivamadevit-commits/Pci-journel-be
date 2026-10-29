import { ArticleStatus as S } from '@prisma/client';
import { prisma } from '../config/prisma';
import { PRODUCTION_STATUSES, STATUS_LABELS } from '../constants/workflow';

export async function reviewerDashboard(userId: string) {
  const profile = await prisma.reviewerProfile.findUnique({ where: { userId }, select: { id: true, reviewerCode: true } });
  if (!profile) return { reviewerCode: null, counts: [], pending: [], overdue: 0 };
  const [byStatus, pending, overdue] = await Promise.all([
    prisma.reviewerAssignment.groupBy({ by: ['status'], where: { reviewerId: profile.id }, _count: { _all: true } }),
    prisma.reviewerAssignment.findMany({
      where: { reviewerId: profile.id, status: 'ASSIGNED' },
      orderBy: { assignedAt: 'asc' },
      take: 10,
      select: { id: true, dueDate: true, assignedAt: true, article: { select: { submissionId: true, title: true } } },
    }),
    prisma.reviewerAssignment.count({ where: { reviewerId: profile.id, status: 'ASSIGNED', dueDate: { lt: new Date() } } }),
  ]);
  return { reviewerCode: profile.reviewerCode, counts: byStatus.map((b) => ({ status: b.status, count: b._count._all })), pending, overdue };
}

export async function productionDashboard(userId: string) {
  const [byStatus, mine] = await Promise.all([
    prisma.article.groupBy({ by: ['status'], where: { status: { in: PRODUCTION_STATUSES } }, _count: { _all: true } }),
    prisma.productionTask.count({ where: { assignedToId: userId, status: { not: 'COMPLETED' } } }),
  ]);
  return {
    totals: byStatus.map((b) => ({ status: b.status, label: STATUS_LABELS[b.status], count: b._count._all })),
    awaitingStart: byStatus.find((b) => b.status === S.ACCEPTED_PRODUCTION_PENDING)?._count._all ?? 0,
    myOpenTasks: mine,
  };
}

export async function adminDashboard() {
  const [users, articles, applications, recentAudit] = await Promise.all([
    prisma.user.groupBy({ by: ['role', 'status'], _count: { _all: true } }),
    prisma.article.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.reviewerApplication.count({ where: { status: 'PENDING' } }),
    prisma.auditLog.count({ where: { createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
  ]);
  return {
    users: users.map((u) => ({ role: u.role, status: u.status, count: u._count._all })),
    articles: articles.map((a) => ({ status: a.status, label: STATUS_LABELS[a.status], count: a._count._all })),
    pendingReviewerApplications: applications,
    auditEventsLast24h: recentAudit,
  };
}
