import * as v from '../validators/article.validators';
import * as articles from '../services/article.service';
import * as production from '../services/production.service';
import * as payments from '../services/payment.service';
import { getMe } from '../services/user.service';
import { updateMyProfile } from '../services/user.service';
import * as admin from '../validators/admin.validators';
import type { C } from '../utils/route';

export const dashboard = async ({ user }: C) => ({ data: await articles.authorDashboard(user.id) });
export const profile = async ({ user }: C) => ({ data: await getMe(user.id) });
export const saveProfile = async ({ user, body }: C<typeof admin.updateProfileBody>) => ({ message: 'Profile updated', data: await updateMyProfile(user, body) });

export const submit = async ({ user, body, files }: C<typeof v.submitArticleBody>) => ({
  status: 201,
  message: 'Article submitted successfully',
  data: await articles.submitArticle(user, body.metadata, files),
});

export const list = async ({ user, query }: C<undefined, typeof v.myArticlesQuery>) => {
  const r = await articles.listMyArticles(user.id, query);
  return { data: r.items, meta: r.meta };
};
export const detail = async ({ user, params }: C<undefined, undefined, typeof v.articleIdParam>) => ({ data: await articles.getMyArticle(user.id, params.articleId) });

export const uploadRevision = async ({ user, params, body, files }: C<typeof v.revisionBody, undefined, typeof v.articleIdParam>) => ({
  status: 201,
  message: 'Revision uploaded',
  data: await articles.uploadRevision(user, params.articleId, body.changeNote, files),
});

export const payment = async ({ user, params }: C<undefined, undefined, typeof v.articleIdParam>) => ({ data: await articles.getMyArticlePayment(user.id, params.articleId) });
export const verifyPayment = async ({ user, params }: C<undefined, undefined, typeof v.articleIdParam>) => ({ data: await payments.verifyPayment(user, params.articleId) });
export const checkout = async ({ user, params }: C<undefined, undefined, typeof v.articleIdParam>) => ({ message: 'Checkout session created', data: await payments.startCheckout(user, params.articleId) });

export const proofs = async ({ user, params }: C<undefined, undefined, typeof v.articleIdParam>) => ({ data: await production.authorListProofs(user.id, params.articleId) });
export const approveProof = async ({ user, params, body }: C<typeof v.approveProofBody, undefined, typeof v.proofParams>) => ({
  message: 'Proof approved',
  data: await production.approveProof(user, params.articleId, params.proofId, body.feedback),
});
export const submitCorrections = async ({ user, params, body }: C<typeof v.submitCorrectionsBody, undefined, typeof v.proofParams>) => ({
  status: 201,
  message: 'Corrections submitted',
  data: await production.submitCorrections(user, params.articleId, params.proofId, body),
});
