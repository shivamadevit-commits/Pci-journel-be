import * as c from '../controllers/production.controller';
import * as a from '../validators/article.validators';
import * as v from '../validators/production.validators';
import { publicRoute, route } from '../utils/route';

const PROD = ['PRODUCTION'] as const;
const VIEW = ['PRODUCTION', 'EDITOR', 'ADMIN'] as const;
const ED = ['EDITOR', 'ADMIN'] as const;
const tag = 'Production';

export const productionRoutes = [
  route({ method: 'get', path: '/production/dashboard', tag, roles: [...PROD], summary: 'Production dashboard', handler: c.dashboard }),
  route({ method: 'get', path: '/production/articles', tag, roles: [...VIEW], summary: 'Accepted-articles production queue', query: a.productionQueueQuery, handler: c.queue }),
  route({
    method: 'get', path: '/production/articles/:articleId', tag, roles: [...VIEW], params: a.articleIdParam, errors: [404],
    summary: 'Production view of an accepted article (no reviews, decisions, plagiarism or APC data)',
    handler: c.detail,
  }),
  route({ method: 'put', path: '/production/articles/:articleId/assignment', tag, roles: [...VIEW], summary: 'Assign the production task (production users may only assign themselves)', params: a.articleIdParam, body: v.assignProductionBody, errors: [403, 422], handler: c.assign }),
  route({ method: 'post', path: '/production/articles/:articleId/start', tag, roles: [...PROD], summary: 'Start production (Accepted – Production Pending → In Production)', params: a.articleIdParam, errors: [409], handler: c.start }),

  route({
    method: 'post', path: '/production/articles/:articleId/proofs', tag, roles: [...PROD], status: 201, params: a.articleIdParam, body: v.uploadProofBody,
    summary: 'Upload a formatted proof (multipart: file `proof`; sendToAuthor defaults to true)',
    upload: { fields: [{ name: 'proof', kind: 'report', required: true }] }, errors: [409, 413], handler: c.uploadProof,
  }),
  route({ method: 'get', path: '/production/articles/:articleId/proofs', tag, roles: [...VIEW], summary: 'Proof versions', params: a.articleIdParam, handler: c.listProofs }),
  route({ method: 'post', path: '/production/articles/:articleId/proofs/:proofId/send', tag, roles: [...PROD], summary: 'Send a previously uploaded proof to the author', params: v.proofIdParams, errors: [404, 409], handler: c.sendProof }),

  route({ method: 'get', path: '/production/articles/:articleId/corrections', tag, roles: [...VIEW], summary: 'Corrections requested by the author', params: a.articleIdParam, handler: c.listCorrections }),
  route({ method: 'post', path: '/production/corrections/:correctionId/implement', tag, roles: [...PROD], summary: 'Mark a minor (or Editor-approved major) correction as implemented', params: v.correctionIdParam, body: v.implementCorrectionBody, errors: [404, 409], handler: c.implementCorrection }),
  route({ method: 'post', path: '/production/corrections/:correctionId/escalate', tag, roles: [...PROD], summary: 'Route a correction to the Editor as a major content change', params: v.correctionIdParam, body: v.escalateCorrectionBody, errors: [404, 409], handler: c.escalateCorrection }),

  route({
    method: 'put', path: '/production/articles/:articleId/final-files/:kind', tag, roles: [...PROD], status: 201, params: v.finalFileParams,
    summary: 'Upload / replace the final HTML (`kind=html`) or PDF (`kind=pdf`) in multipart field `file`',
    upload: { fields: [{ name: 'file', kind: 'report', required: true }] }, errors: [409, 413], handler: c.uploadFinalFile,
  }),
  route({ method: 'post', path: '/production/articles/:articleId/complete', tag, roles: [...PROD], summary: 'Final production complete → publication handoff to the Editor', params: a.articleIdParam, errors: [409], handler: c.complete }),

  route({ method: 'get', path: '/publication/articles/:articleId', tag: 'Publication', roles: [...VIEW], summary: 'Publication record, metadata and readiness checklist', params: a.articleIdParam, handler: c.publicationDetail }),
  route({ method: 'put', path: '/publication/articles/:articleId/metadata', tag: 'Publication', roles: [...VIEW], summary: 'Set publication metadata (DOI, volume, issue, pages, licence…)', params: a.articleIdParam, body: v.publicationMetadataBody, errors: [404, 409], handler: c.updateMetadata }),
  route({ method: 'post', path: '/publication/articles/:articleId/publish', tag: 'Publication', roles: [...ED], summary: 'Authorise publication (Final Production → Published); requires final HTML + PDF, completed handoff and required metadata', params: a.articleIdParam, body: v.publishBody, errors: [409, 422], handler: c.publish }),

  publicRoute({ method: 'get', path: '/publications', tag: 'Published articles', summary: 'Browse / search published articles (public)', query: a.publicListQuery, handler: c.listPublished }),
  publicRoute({ method: 'get', path: '/publications/:submissionId', tag: 'Published articles', summary: 'Published article metadata (public)', params: a.submissionIdParam, errors: [404], handler: c.getPublished }),
];
