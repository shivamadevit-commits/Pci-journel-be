import * as c from '../controllers/editorial.controller';
import * as a from '../validators/article.validators';
import * as v from '../validators/editorial.validators';
import { route } from '../utils/route';

const ED = ['CHIEF_EDITOR_ADMIN', 'EDITOR'] as const;
const tag = 'Editorial';
const reportUpload = { fields: [{ name: 'report', kind: 'report' as const }] };

export const editorialRoutes = [
  route({ method: 'get', path: '/editorial/dashboard', tag, roles: [...ED], summary: 'Editorial dashboard', handler: c.dashboard }),
  route({ method: 'get', path: '/editorial/articles', tag, roles: [...ED], summary: 'Article / screening queues (filter by status, search, APC, editor…)', query: a.editorialListQuery, handler: c.list }),
  route({ method: 'get', path: '/editorial/articles/:articleId', tag, roles: [...ED], summary: 'Full article record incl. author identity, reviewers and reports', params: a.articleIdParam, errors: [404], handler: c.detail }),
  route({ method: 'get', path: '/editorial/articles/:articleId/history', tag, roles: [...ED], summary: 'Status history with actors', params: a.articleIdParam, handler: c.history }),

  route({ method: 'post', path: '/editorial/articles/:articleId/screening/start', tag, roles: [...ED], summary: 'Begin initial screening (Submitted → Under Editorial Screening)', params: a.articleIdParam, errors: [409], handler: c.startScreening }),
  route({
    method: 'post', path: '/editorial/articles/:articleId/screening/decision', tag, roles: [...ED], params: a.articleIdParam, body: v.screeningDecisionBody, errors: [409],
    summary: 'Screening decision: PROCEED (→ Plagiarism Check) or REJECT (closed; no resubmission)',
    handler: c.screeningDecision,
  }),

  route({ method: 'get', path: '/editorial/articles/:articleId/plagiarism', tag, roles: [...ED], summary: 'Plagiarism checks for the article', params: a.articleIdParam, handler: c.listPlagiarism }),
  route({ method: 'post', path: '/editorial/articles/:articleId/plagiarism/initiate', tag, roles: [...ED], status: 201, summary: 'Send the manuscript to the configured plagiarism provider', params: a.articleIdParam, errors: [409, 503], handler: c.initiatePlagiarism }),
  route({ method: 'post', path: '/editorial/articles/:articleId/plagiarism/record', tag, roles: [...ED], status: 201, summary: 'Record a plagiarism result manually (optional report file in `report`)', params: a.articleIdParam, body: v.manualPlagiarismBody, upload: reportUpload, errors: [409, 413], handler: c.recordPlagiarism }),
  route({ method: 'put', path: '/editorial/articles/:articleId/plagiarism/:checkId/verdict', tag, roles: [...ED], summary: 'Record the Editor’s verdict on a completed provider check', params: v.plagiarismParams, body: v.verdictBody, errors: [404, 409], handler: c.setPlagiarismVerdict }),
  route({ method: 'post', path: '/editorial/articles/:articleId/plagiarism/clearance', tag, roles: [...ED], summary: 'CLEAR the article for reviewer assignment, or REJECT it', params: a.articleIdParam, body: v.clearanceBody, errors: [409], handler: c.plagiarismClearance }),

  route({ method: 'get', path: '/editorial/articles/:articleId/payment', tag, roles: [...ED], summary: 'APC payment record', params: a.articleIdParam, handler: c.getPayment }),
  route({ method: 'put', path: '/editorial/articles/:articleId/payment', tag, roles: [...ED], summary: 'Record / change APC status manually (validated transitions)', params: a.articleIdParam, body: v.recordPaymentBody, errors: [409, 422], handler: c.recordPayment }),

  route({ method: 'get', path: '/editorial/reviewers', tag, roles: [...ED], summary: 'Approved reviewer pool with subject areas and qualifications', query: v.reviewerListQuery, handler: c.listReviewers }),
  route({ method: 'get', path: '/editorial/reviewers/:reviewerId', tag, roles: [...ED], summary: 'Reviewer profile / eligibility', params: v.reviewerIdParam, errors: [404], handler: c.getReviewer }),
  route({ method: 'patch', path: '/editorial/reviewers/:reviewerId', tag, roles: [...ED], summary: 'Update reviewer (active flag, subject areas, internal notes)', params: v.reviewerIdParam, body: v.updateReviewerBody, errors: [404], handler: c.updateReviewer }),
  route({ method: 'get', path: '/editorial/articles/:articleId/reviewers/:reviewerId/eligibility', tag, roles: [...ED], summary: 'Suitability / conflict check before assigning a reviewer', params: v.eligibilityParams, errors: [404], handler: c.eligibility }),

  route({ method: 'get', path: '/editorial/reviewer-applications', tag, roles: [...ED], summary: 'Reviewer applications', query: v.applicationListQuery, handler: c.listApplications }),
  route({ method: 'get', path: '/editorial/reviewer-applications/:applicationId', tag, roles: [...ED], summary: 'Application detail', params: v.applicationIdParam, errors: [404], handler: c.getApplication }),
  route({ method: 'post', path: '/editorial/reviewer-applications/:applicationId/approve', tag, roles: [...ED], summary: 'Approve: creates the reviewer account, issues a unique Reviewer ID and e-mails an invitation', params: v.applicationIdParam, body: v.applicationDecisionBody, errors: [404, 409], handler: c.approveApplication }),
  route({ method: 'post', path: '/editorial/reviewer-applications/:applicationId/reject', tag, roles: [...ED], summary: 'Reject an application', params: v.applicationIdParam, body: v.applicationDecisionBody, errors: [404, 409], handler: c.rejectApplication }),

  route({
    method: 'post', path: '/editorial/articles/:articleId/reviewers', tag, roles: [...ED], status: 201, params: a.articleIdParam, body: v.assignReviewersBody, errors: [409, 422],
    summary: 'Manually assign exactly two reviewers (Ready for Reviewer Assignment → Under Review)',
    handler: c.assignReviewers,
  }),
  route({ method: 'post', path: '/editorial/articles/:articleId/reviewers/:assignmentId/replace', tag, roles: [...ED], summary: 'Replace a declined / pending reviewer', params: v.assignmentParams, body: v.replaceReviewerBody, errors: [404, 409], handler: c.replaceReviewer }),
  route({ method: 'post', path: '/editorial/articles/:articleId/reviewers/:assignmentId/remind', tag, roles: [...ED], summary: 'Send a review reminder (max one per 24h)', params: v.assignmentParams, errors: [404, 409], handler: c.remindReviewer }),

  route({ method: 'get', path: '/editorial/articles/:articleId/reviews', tag, roles: [...ED], summary: 'Both reviewer reports (submitted only) with reviewer identities', params: a.articleIdParam, handler: c.reviewReports }),
  route({
    method: 'put', path: '/editorial/articles/:articleId/reviews/comments', tag, roles: [...ED], params: a.articleIdParam, body: v.moderateCommentsBody, errors: [404, 409, 422],
    summary: 'Select / edit / approve reviewer comments for disclosure to the author',
    description: 'Comments of section CONFIDENTIAL_TO_EDITOR can never be approved. Only approved comments (using `editedBody` if provided) are ever shown to the author.',
    handler: c.moderateComments,
  }),
  route({ method: 'post', path: '/editorial/articles/:articleId/decision', tag, roles: [...ED], summary: 'Final decision: ACCEPT (→ Accepted – Production Pending), REJECT, or REQUEST_REVISION (if enabled)', params: a.articleIdParam, body: v.finalDecisionBody, errors: [409], handler: c.finalDecision }),

  route({ method: 'get', path: '/editorial/major-changes', tag, roles: [...ED], summary: 'Major content-change requests awaiting / after Editor decision', query: v.majorChangeListQuery, handler: c.listMajorChanges }),
  route({ method: 'post', path: '/editorial/major-changes/:correctionId/decision', tag, roles: [...ED], summary: 'Approve or reject a major content change', params: v.majorChangeParams, body: v.majorChangeDecisionBody, errors: [404, 409], handler: c.decideMajorChange }),
];
