import { Role, type Article } from '@prisma/client';
import { prisma, type Db } from '../config/prisma';
import { isEditorial } from '../constants/roles';
import { ForbiddenError, NotFoundError } from '../utils/errors';

type U = Pick<Express.AuthUser, 'id' | 'role'>;

/** Chief Editor / Admin sees every article; an Editor sees articles assigned to them and unassigned ones. */
export function editorialCanAccess(user: U, article: Pick<Article, 'editorId'>): boolean {
  if (user.role === Role.CHIEF_EDITOR_ADMIN) return true;
  if (user.role === Role.EDITOR) return article.editorId === null || article.editorId === user.id;
  return false;
}

export async function loadArticleForEditorial(id: string, user: U, db: Db = prisma) {
  if (!isEditorial(user.role)) throw new ForbiddenError();
  const article = await db.article.findUnique({ where: { id } });
  if (!article) throw new NotFoundError('Article not found');
  if (!editorialCanAccess(user, article)) throw new NotFoundError('Article not found');
  return article;
}

export async function loadOwnArticle(id: string, userId: string, db: Db = prisma) {
  const article = await db.article.findFirst({ where: { id, authorId: userId } });
  if (!article) throw new NotFoundError('Article not found');
  return article;
}
