import * as a from '../validators/article.validators';
import * as v from '../validators/editorial.validators';
import * as editorial from '../services/editorial.service';
import * as reviews from '../services/review.service';
import * as reviewers from '../services/reviewer.service';
import * as plagiarism from '../services/plagiarism.service';
import * as payments from '../services/payment.service';
import * as production from '../services/production.service';
import { loadArticleForEditorial } from '../services/access';
import { prisma } from '../config/prisma';
import type { C } from '../utils/route';

type A = typeof a.articleIdParam;

export const dashboard = async ({ user }: C) => ({ data: await editorial.dashboard(user) });
export const list = async ({ user, query }: C<undefined, typeof a.editorialListQuery>) => {
  const r = await editorial.listArticles(user, query);
  return { data: r.items, meta: r.meta };
};
export const detail = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await editorial.getArticle(user, params.articleId) });
export const history = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await editorial.getHistory(user, params.articleId) });

export const startScreening = async ({ user, params }: C<undefined, undefined, A>) => ({ message: 'Screening started', data: await editorial.startScreening(params.articleId, user) });
export const screeningDecision = async ({ user, params, body }: C<typeof v.screeningDecisionBody, undefined, A>) => ({
  message: body.decision === 'REJECT' ? 'Submission rejected at screening and closed' : 'Submission moved to plagiarism check',
  data: await editorial.screeningDecision(params.articleId, body, user),
});

// plagiarism
export const listPlagiarism = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await plagiarism.listChecks(params.articleId, user) });
export const initiatePlagiarism = async ({ user, params }: C<undefined, undefined, A>) => ({ status: 201, message: 'Plagiarism check initiated', data: await plagiarism.initiateCheck(params.articleId, user) });
export const runPlagiarism = async ({ user, params }: C<undefined, undefined, A>) => ({ status: 202, message: 'Plagiarism check started', data: await plagiarism.runBuiltInCheck(params.articleId, user) });
export const plagiarismReport = async ({ user, params }: C<undefined, undefined, typeof v.plagiarismParams>) => ({ data: await plagiarism.getCheckReport(params.articleId, params.checkId, user) });
export const recordPlagiarism = async ({ user, params, body, files }: C<typeof v.manualPlagiarismBody, undefined, A>) => ({
  status: 201,
  message: 'Plagiarism result recorded',
  data: await plagiarism.recordManualCheck(params.articleId, body, files, user),
});
export const setPlagiarismVerdict = async ({ user, params, body }: C<typeof v.verdictBody, undefined, typeof v.plagiarismParams>) => ({
  message: 'Verdict recorded',
  data: await plagiarism.setVerdict(params.articleId, params.checkId, body.verdict, body.notes, user),
});
export const plagiarismClearance = async ({ user, params, body }: C<typeof v.clearanceBody, undefined, A>) => ({
  message: body.action === 'CLEAR' ? 'Article cleared for reviewer assignment' : 'Article rejected',
  data: await plagiarism.clearance(params.articleId, body, user),
});

// payment
export const getPayment = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await payments.getPaymentForEditor(params.articleId, user) });
export const recordPayment = async ({ user, params, body }: C<typeof v.recordPaymentBody, undefined, A>) => ({
  message: 'Payment status updated',
  data: await payments.recordPayment(params.articleId, body, user),
});

// reviewers
export const listReviewers = async ({ query }: C<undefined, typeof v.reviewerListQuery>) => {
  const r = await reviewers.listReviewers(query);
  return { data: r.items, meta: r.meta };
};
export const getReviewer = async ({ params }: C<undefined, undefined, typeof v.reviewerIdParam>) => ({ data: await reviewers.getReviewer(params.reviewerId) });
export const updateReviewer = async ({ user, params, body }: C<typeof v.updateReviewerBody, undefined, typeof v.reviewerIdParam>) => ({
  message: 'Reviewer updated',
  data: await reviewers.updateReviewer(params.reviewerId, body, user),
});
export const eligibility = async ({ user, params }: C<undefined, undefined, typeof v.eligibilityParams>) => {
  await loadArticleForEditorial(params.articleId, user);
  return { data: await reviews.checkEligibility(prisma, params.articleId, params.reviewerId) };
};

export const listApplications = async ({ query }: C<undefined, typeof v.applicationListQuery>) => {
  const r = await reviewers.listApplications(query);
  return { data: r.items, meta: r.meta };
};
export const getApplication = async ({ params }: C<undefined, undefined, typeof v.applicationIdParam>) => ({ data: await reviewers.getApplication(params.applicationId) });
export const approveApplication = async ({ user, params, body }: C<typeof v.applicationDecisionBody, undefined, typeof v.applicationIdParam>) => ({
  message: 'Application approved; Reviewer ID issued and invitation sent',
  data: await reviewers.approveApplication(params.applicationId, body.note, user),
});
export const rejectApplication = async ({ user, params, body }: C<typeof v.applicationDecisionBody, undefined, typeof v.applicationIdParam>) => {
  await reviewers.rejectApplication(params.applicationId, body.note, user);
  return { message: 'Application rejected' };
};

// assignments & reports
export const assignReviewers = async ({ user, params, body }: C<typeof v.assignReviewersBody, undefined, A>) => ({
  status: 201,
  message: 'Reviewers assigned',
  data: await reviews.assignReviewers(params.articleId, body.reviewerIds, body.dueDate, user),
});
export const replaceReviewer = async ({ user, params, body }: C<typeof v.replaceReviewerBody, undefined, typeof v.assignmentParams>) => ({
  message: 'Reviewer replaced',
  data: await reviews.replaceReviewer(params.articleId, params.assignmentId, body.reviewerId, body.reason, user),
});
export const remindReviewer = async ({ user, params }: C<undefined, undefined, typeof v.assignmentParams>) => {
  await reviews.remindReviewer(params.articleId, params.assignmentId, user);
  return { message: 'Reminder sent' };
};
export const reviewReports = async ({ user, params }: C<undefined, undefined, A>) => ({ data: await reviews.getReviewsForEditor(params.articleId, user) });
export const moderateComments = async ({ user, params, body }: C<typeof v.moderateCommentsBody, undefined, A>) => ({
  message: 'Comment disclosure updated',
  data: await reviews.moderateComments(params.articleId, body.items, user),
});
export const finalDecision = async ({ user, params, body }: C<typeof v.finalDecisionBody, undefined, A>) => ({
  message: 'Decision recorded',
  data: await editorial.finalDecision(params.articleId, body, user),
});

// major content changes
export const listMajorChanges = async ({ user, query }: C<undefined, typeof v.majorChangeListQuery>) => {
  const r = await production.listMajorChanges(user, query);
  return { data: r.items, meta: r.meta };
};
export const decideMajorChange = async ({ user, params, body }: C<typeof v.majorChangeDecisionBody, undefined, typeof v.majorChangeParams>) => ({
  message: 'Decision recorded',
  data: await production.decideMajorChange(params.correctionId, body, user),
});
