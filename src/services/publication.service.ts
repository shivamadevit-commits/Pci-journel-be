import { ArticleStatus as S, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { STATUS_LABELS } from '../constants/workflow';
import { links } from '../templates/links';
import { transact, type Actor } from '../utils/context';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { loadArticleForEditorial } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';
import { notify } from './notification.service';
import { transitionArticle } from './workflow.service';

export interface MetadataInput {
  doi?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  license?: string | null;
  copyright?: string | null;
  citation?: string | null;
  extra?: Record<string, string | number | boolean | null>;
}

async function assertCanManage(articleId: string, user: Actor) {
  if (user.role === Role.PRODUCTION) {
    const a = await prisma.article.findUnique({ where: { id: articleId }, select: { status: true } });
    if (!a || !([S.FINAL_PRODUCTION, S.IN_PRODUCTION, S.CORRECTION_REQUIRED, S.PROOF_SENT_TO_AUTHOR] as S[]).includes(a.status)) throw new NotFoundError('Article not found');
    return;
  }
  await loadArticleForEditorial(articleId, user);
}

export async function getForStaff(articleId: string, user: Actor) {
  await assertCanManage(articleId, user);
  const cfg = await getConfig();
  const [article, pub] = await Promise.all([
    prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { submissionId: true, title: true, status: true, abstract: true, acceptedAt: true, submittedAt: true, coAuthors: { select: { firstName: true, lastName: true } }, keywords: { select: { keyword: true } } },
    }),
    prisma.publication.findUnique({ where: { articleId }, include: { metadata: true } }),
  ]);
  const missing: string[] = [];
  if (!pub?.htmlFileId) missing.push('final HTML file');
  if (!pub?.pdfFileId) missing.push('final PDF file');
  for (const f of cfg.publicationRequiredMetadata) if (!pub?.metadata?.[f]) missing.push(`metadata.${f}`);
  return {
    article: { ...article, statusLabel: STATUS_LABELS[article.status], keywords: article.keywords.map((k) => k.keyword) },
    publication: pub,
    requiredMetadata: cfg.publicationRequiredMetadata,
    readiness: { ready: missing.length === 0 && article.status === S.FINAL_PRODUCTION, missing },
  };
}

export async function updateMetadata(articleId: string, input: MetadataInput, actor: Actor) {
  await assertCanManage(articleId, actor);
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId }, select: { status: true } });
  const allowed: S[] = [S.IN_PRODUCTION, S.PROOF_SENT_TO_AUTHOR, S.CORRECTION_REQUIRED, S.FINAL_PRODUCTION, S.PUBLISHED];
  if (!allowed.includes(article.status)) throw new ConflictError('Publication metadata can only be edited once the article is in production', 'INVALID_STATE_TRANSITION');
  if (article.status === S.PUBLISHED && actor.role === Role.PRODUCTION) throw new ForbiddenError('Only editorial users can amend metadata of a published article');

  const data = {
    doi: input.doi, volume: input.volume, issue: input.issue, pages: input.pages,
    license: input.license, copyright: input.copyright, citation: input.citation,
    extra: input.extra as Prisma.InputJsonValue | undefined,
  };
  return transact(async (tx) => {
    const pub = await tx.publication.upsert({ where: { articleId }, create: { articleId }, update: {} });
    const md = await tx.publicationMetadata.upsert({ where: { publicationId: pub.id }, create: { publicationId: pub.id, ...data }, update: data });
    await recordAudit(tx, { action: AuditAction.PUBLICATION_METADATA_UPDATED, entityType: 'Publication', entityId: pub.id, actor, metadata: { articleId, fields: Object.keys(input) } });
    return md;
  });
}

/** Publication authorisation rests with the Editor / Chief Editor (BR-016). The workflow service enforces every pre-condition. */
export async function publish(articleId: string, publishedAt: Date | undefined, actor: Actor) {
  const when = publishedAt ?? new Date();
  if (when.getTime() > Date.now() + 5 * 60_000) throw new UnprocessableError('The publication date cannot be in the future', 'INVALID_PUBLICATION_DATE', [{ field: 'publishedAt', message: 'Cannot be in the future' }]);
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    const { from } = await transitionArticle(tx, articleId, S.PUBLISHED, actor, { expectedFrom: S.FINAL_PRODUCTION, reason: 'Publication authorised', data: { publishedAt: when } });
    await tx.publication.update({ where: { articleId }, data: { status: 'PUBLISHED', publishedAt: when, publishedById: actor.id } });
    await recordAudit(tx, { action: AuditAction.ARTICLE_PUBLISHED, entityType: 'Article', entityId: articleId, actor, fromStatus: from, toStatus: S.PUBLISHED, metadata: { publishedAt: when } });
    await notify(tx, {
      userId: article.authorId,
      type: 'article.published',
      title: `Published: ${article.submissionId}`,
      message: `“${article.title}” has been published.`,
      template: 'published_author',
      data: { submissionId: article.submissionId, title: article.title, publishedAt: when.toISOString().slice(0, 10), link: links.publication(article.submissionId) },
      entityType: 'Article',
      entityId: articleId,
      dedupeKey: `article:${articleId}:published`,
    });
    return { status: S.PUBLISHED, statusLabel: STATUS_LABELS[S.PUBLISHED], publishedAt: when };
  });
}

// ───────────────────────────── public retrieval (published articles only) ─────────────────────────────

const publicSelect = {
  submissionId: true,
  title: true,
  abstract: true,
  publishedAt: true,
  acceptedAt: true,
  submittedAt: true,
  subjectArea: { select: { id: true, name: true } },
  coAuthors: { orderBy: { orderIndex: 'asc' }, select: { firstName: true, lastName: true, affiliation: true, isCorresponding: true } },
  keywords: { select: { keyword: true } },
  publication: { select: { htmlFileId: true, pdfFileId: true, metadata: { select: { doi: true, volume: true, issue: true, pages: true, license: true, copyright: true, citation: true, extra: true } } } },
} satisfies Prisma.ArticleSelect;

function presentPublic(a: Prisma.ArticleGetPayload<{ select: typeof publicSelect }>) {
  const { keywords, publication, coAuthors, ...rest } = a;
  return {
    ...rest,
    authors: coAuthors,
    keywords: keywords.map((k) => k.keyword),
    metadata: publication?.metadata ?? null,
    files: {
      html: publication?.htmlFileId ? `/api/v1/publications/${encodeURIComponent(a.submissionId)}/html` : null,
      pdf: publication?.pdfFileId ? `/api/v1/publications/${encodeURIComponent(a.submissionId)}/pdf` : null,
    },
  };
}

export interface PublicListQuery {
  page: number;
  pageSize: number;
  search?: string;
  subjectAreaId?: string;
  year?: number;
  sortBy: 'publishedAt' | 'title';
  sortOrder: 'asc' | 'desc';
}

export async function listPublished(q: PublicListQuery) {
  const where: Prisma.ArticleWhereInput = {
    status: S.PUBLISHED,
    subjectAreaId: q.subjectAreaId,
    publishedAt: q.year ? { gte: new Date(Date.UTC(q.year, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) } : undefined,
    ...(q.search
      ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { abstract: { contains: q.search, mode: 'insensitive' } }, { keywords: { some: { keyword: { contains: q.search, mode: 'insensitive' } } } }, { coAuthors: { some: { lastName: { contains: q.search, mode: 'insensitive' } } } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.article.findMany({ where, select: publicSelect, orderBy: { [q.sortBy]: q.sortOrder }, ...skipTake(q) }),
    prisma.article.count({ where }),
  ]);
  return { items: rows.map(presentPublic), meta: pageMeta(q, total) };
}

export async function getPublished(submissionId: string) {
  const a = await prisma.article.findFirst({ where: { submissionId, status: S.PUBLISHED }, select: publicSelect });
  if (!a) throw new NotFoundError('Article not found');
  return presentPublic(a);
}
