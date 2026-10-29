import * as c from '../controllers/author.controller';
import * as a from '../validators/article.validators';
import * as v from '../validators/admin.validators';
import { route } from '../utils/route';

const AUTHOR = ['AUTHOR'] as const;
const tag = 'Author portal';
const manuscriptUpload = { fields: [{ name: 'manuscript', kind: 'manuscript' as const, required: true }, { name: 'titlePage', kind: 'manuscript' as const }] };

export const authorRoutes = [
  route({ method: 'get', path: '/author/dashboard', tag, roles: [...AUTHOR], summary: 'Author dashboard', handler: c.dashboard }),
  route({ method: 'get', path: '/author/profile', tag, roles: [...AUTHOR], summary: 'Author profile', handler: c.profile }),
  route({ method: 'patch', path: '/author/profile', tag, roles: [...AUTHOR], summary: 'Update author profile', body: v.updateProfileBody, handler: c.saveProfile }),

  route({
    method: 'post', path: '/author/articles', tag, roles: [...AUTHOR], status: 201, errors: [400, 413, 422],
    summary: 'Submit a new article (multipart/form-data)',
    description: 'Fields: `metadata` (JSON string: title, abstract, ethicsStatement, subjectAreaId?, keywords[], authors[], confirmAnonymised=true), file `manuscript` (.docx, required), file `titlePage` (.docx, optional – author details kept out of the reviewer copy). Word count is calculated server-side and articles above the configured limit are flagged (wordLimitExceeded).',
    upload: manuscriptUpload, body: a.submitArticleBody, handler: c.submit,
  }),
  route({ method: 'get', path: '/author/articles', tag, roles: [...AUTHOR], summary: 'My submissions (search, filter, sort, paginate)', query: a.myArticlesQuery, handler: c.list }),
  route({
    method: 'get', path: '/author/articles/:articleId', tag, roles: [...AUTHOR], summary: 'Submission detail, status tracking and Editor-approved reviewer comments', params: a.articleIdParam, errors: [404],
    description: '`approvedReviewerComments` appears only after a final decision and contains only comments the Editor approved, labelled "Reviewer A/B" — never any reviewer identity.',
    handler: c.detail,
  }),
  route({ method: 'post', path: '/author/articles/:articleId/versions', tag, roles: [...AUTHOR], status: 201, summary: 'Upload a revised manuscript (only when the Editor requested a revision)', params: a.articleIdParam, body: a.revisionBody, upload: manuscriptUpload, errors: [409, 413, 422], handler: c.uploadRevision }),

  route({ method: 'get', path: '/author/articles/:articleId/payment', tag, roles: [...AUTHOR], summary: 'APC / payment status', params: a.articleIdParam, handler: c.payment }),
  route({ method: 'post', path: '/author/articles/:articleId/payment/checkout', tag, roles: [...AUTHOR], summary: 'Start online APC payment through the configured gateway', params: a.articleIdParam, errors: [409, 503], handler: c.checkout }),

  route({ method: 'get', path: '/author/articles/:articleId/proofs', tag, roles: [...AUTHOR], summary: 'Proofs delivered to me, with correction status', params: a.articleIdParam, handler: c.proofs }),
  route({ method: 'post', path: '/author/articles/:articleId/proofs/:proofId/approve', tag, roles: [...AUTHOR], summary: 'Approve a proof with no corrections', params: a.proofParams, body: a.approveProofBody, errors: [409], handler: c.approveProof }),
  route({ method: 'post', path: '/author/articles/:articleId/proofs/:proofId/corrections', tag, roles: [...AUTHOR], status: 201, summary: 'Return corrections on a proof (MAJOR items are routed to the Editor)', params: a.proofParams, body: a.submitCorrectionsBody, errors: [409], handler: c.submitCorrections }),
];
