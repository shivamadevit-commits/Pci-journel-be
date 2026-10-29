import * as a from '../validators/article.validators';
import * as v from '../validators/production.validators';
import * as production from '../services/production.service';
import * as publication from '../services/publication.service';
import * as dashboards from '../services/dashboard.service';
import type { C, PC } from '../utils/route';

type A = typeof a.articleIdParam;

export const dashboard = async ({ user }: C) => ({ data: await dashboards.productionDashboard(user.id) });
export const queue = async ({ user, query }: C<undefined, typeof a.productionQueueQuery>) => {
  const r = await production.queue(user, query);
  return { data: r.items, meta: r.meta };
};
export const detail = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await production.getArticle(user, params.articleId) });
export const assign = async ({ user, params, body }: C<typeof v.assignProductionBody, undefined, A>) => ({ message: 'Production assignment saved', data: await production.assign(params.articleId, body.assigneeId, user) });
export const start = async ({ user, params }: C<undefined, undefined, A>) => ({ message: 'Production started', data: await production.start(params.articleId, user) });

export const uploadProof = async ({ user, params, body, files }: C<typeof v.uploadProofBody, undefined, A>) => ({
  status: 201,
  message: body.sendToAuthor ? 'Proof uploaded and sent to the author' : 'Proof uploaded',
  data: await production.uploadProof(params.articleId, body, files.proof![0]!, user),
});
export const sendProof = async ({ user, params }: C<undefined, undefined, typeof v.proofIdParams>) => ({ message: 'Proof sent to the author', data: await production.sendProof(params.articleId, params.proofId, user) });
export const listProofs = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await production.listProofs(user, params.articleId) });

export const listCorrections = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await production.listCorrections(user, params.articleId) });
export const implementCorrection = async ({ user, params, body }: C<typeof v.implementCorrectionBody, undefined, typeof v.correctionIdParam>) => ({
  message: 'Correction marked as implemented',
  data: await production.implementCorrection(params.correctionId, body.note, user),
});
export const escalateCorrection = async ({ user, params, body }: C<typeof v.escalateCorrectionBody, undefined, typeof v.correctionIdParam>) => ({
  message: 'Routed to the Editor for approval',
  data: await production.escalateCorrection(params.correctionId, body.reason, user),
});

export const uploadFinalFile = async ({ user, params, files }: C<undefined, undefined, typeof v.finalFileParams>) => ({
  status: 201,
  message: `Final ${params.kind.toUpperCase()} uploaded`,
  data: await production.uploadFinalFile(params.articleId, params.kind, files.file![0]!, user),
});
export const complete = async ({ user, params }: C<undefined, undefined, A>) => ({ message: 'Production completed and handed off for publication', data: await production.completeProduction(params.articleId, user) });

// publication
export const publicationDetail = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await publication.getForStaff(params.articleId, user) });
export const updateMetadata = async ({ user, params, body }: C<typeof v.publicationMetadataBody, undefined, A>) => ({
  message: 'Publication metadata saved',
  data: await publication.updateMetadata(params.articleId, body, user),
});
export const publish = async ({ user, params, body }: C<typeof v.publishBody, undefined, A>) => ({ message: 'Article published', data: await publication.publish(params.articleId, body.publishedAt, user) });

// public
export const listPublished = async ({ query }: PC<undefined, typeof a.publicListQuery>) => {
  const r = await publication.listPublished(query);
  return { data: r.items, meta: r.meta };
};
export const getPublished = async ({ params }: PC<undefined, undefined, typeof a.submissionIdParam>) => ({ data: await publication.getPublished(params.submissionId) });
