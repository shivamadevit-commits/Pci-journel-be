import * as c from '../controllers/reviewer.controller';
import * as v from '../validators/editorial.validators';
import { publicRoute, route } from '../utils/route';

const REVIEWER = ['REVIEWER'] as const;
const tag = 'Reviewer portal';

export const reviewerRoutes = [
  publicRoute({
    method: 'post', path: '/reviewer-applications', tag: 'Reviewer applications', limiter: 'reviewerApplication', status: 202, errors: [400, 413, 422, 429],
    summary: 'Apply to become a reviewer (JSON, or multipart with optional `cv` file)',
    description: 'Public. The response is identical whether or not the email is already known. `subjectAreaIds` may be a JSON array or (multipart) a JSON-encoded string.',
    upload: { fields: [{ name: 'cv', kind: 'cv', required: false }], allowJson: true }, body: v.reviewerApplicationBody, handler: c.apply,
  }),

  route({ method: 'get', path: '/reviewer/dashboard', tag, roles: [...REVIEWER], summary: 'Reviewer dashboard (Reviewer ID, pending and overdue reviews)', handler: c.dashboard }),
  route({ method: 'get', path: '/reviewer/profile', tag, roles: [...REVIEWER], summary: 'Reviewer profile incl. Reviewer ID and subject areas', handler: c.profile }),
  route({ method: 'get', path: '/reviewer/assignments', tag, roles: [...REVIEWER], summary: 'My assigned articles', query: v.myAssignmentsQuery, handler: c.list }),
  route({ method: 'get', path: '/reviewer/history', tag, roles: [...REVIEWER], summary: 'Previously reviewed articles / review history', query: v.myAssignmentsQuery, handler: c.history }),
  route({
    method: 'get', path: '/reviewer/assignments/:assignmentId', tag, roles: [...REVIEWER], params: v.assignmentIdParam, errors: [404],
    summary: 'Anonymised manuscript + my review. Contains no author names, emails or affiliations.',
    description: 'Download the manuscript with GET /files/{version.fileId}/download (neutral filename, document metadata scrubbed).',
    handler: c.detail,
  }),
  route({ method: 'post', path: '/reviewer/assignments/:assignmentId/decline', tag, roles: [...REVIEWER], summary: 'Decline an assignment', params: v.assignmentIdParam, body: v.declineBody, errors: [404, 409], handler: c.decline }),
  route({ method: 'put', path: '/reviewer/assignments/:assignmentId/review', tag, roles: [...REVIEWER], summary: 'Save a draft review', params: v.assignmentIdParam, body: v.saveDraftBody, errors: [404, 409], handler: c.saveDraft }),
  route({ method: 'post', path: '/reviewer/assignments/:assignmentId/review/submit', tag, roles: [...REVIEWER], status: 201, summary: 'Submit the review (timestamped and locked; goes to the Editor first)', params: v.assignmentIdParam, body: v.submitReviewBody, errors: [404, 409, 422], handler: c.submit }),
];
