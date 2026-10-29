import { z } from 'zod';
import * as c from '../controllers/misc.controller';
import * as a from '../validators/article.validators';
import { publicRoute, route } from '../utils/route';

const publicFileParams = a.submissionIdParam.extend({ kind: z.enum(['html', 'pdf']) });

export const miscRoutes = [
  route({ method: 'get', path: '/config/features', tag: 'Files', roles: 'any', summary: 'Portal feature flags (e.g. whether payment is enabled)', handler: c.features }),
  route({
    method: 'get', path: '/files/:fileId/download', tag: 'Files', roles: 'any', params: a.fileIdParam, errors: [404],
    summary: 'Download a stored file (authorised per file purpose and relationship to the article)',
    description: 'Streams the file. Reviewers receive a neutral filename and a copy with author-identifying document metadata removed. Unauthorised access returns 404.',
    handler: c.download,
  }),
  publicRoute({ method: 'get', path: '/publications/:submissionId/:kind', tag: 'Published articles', params: publicFileParams, errors: [404], summary: 'Public download of the published HTML (`html`) or PDF (`pdf`)', handler: c.downloadPublic as never }),

  publicRoute({
    method: 'post', path: '/webhooks/payments', tag: 'Webhooks', status: 200, errors: [401],
    summary: 'Payment gateway webhook (signature verified against the raw body; idempotent)',
    handler: c.paymentWebhook,
  }),
  publicRoute({
    method: 'post', path: '/webhooks/plagiarism', tag: 'Webhooks', status: 200, errors: [401], body: c.plagiarismBody,
    summary: 'Plagiarism provider result callback (HMAC-SHA256 of the raw body in `X-Signature`)',
    handler: c.plagiarismWebhook,
  }),
];
