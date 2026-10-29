import * as v from '../validators/editorial.validators';
import * as reviews from '../services/review.service';
import * as reviewers from '../services/reviewer.service';
import * as dashboards from '../services/dashboard.service';
import { getMe } from '../services/user.service';
import type { C, PC } from '../utils/route';

/** Public: prospective reviewers apply without an account. */
export const apply = async ({ body, files }: PC<typeof v.reviewerApplicationBody>) => {
  await reviewers.applyAsReviewer(body, files);
  return { status: 202, message: 'Thank you. Your application has been received and will be reviewed by the editor.' };
};

export const dashboard = async ({ user }: C) => ({ data: await dashboards.reviewerDashboard(user.id) });
export const profile = async ({ user }: C) => ({ data: await getMe(user.id) });

export const list = async ({ user, query }: C<undefined, typeof v.myAssignmentsQuery>) => {
  const r = await reviews.listMyAssignments(user.id, query);
  return { data: r.items, meta: r.meta };
};
export const history = async ({ user, query }: C<undefined, typeof v.myAssignmentsQuery>) => {
  const r = await reviews.listMyAssignments(user.id, { ...query, status: 'SUBMITTED' });
  return { data: r.items, meta: r.meta };
};
export const detail = async ({ user, params }: C<undefined, undefined, typeof v.assignmentIdParam>) => ({ data: await reviews.getMyAssignment(user.id, params.assignmentId) });
export const decline = async ({ user, params, body }: C<typeof v.declineBody, undefined, typeof v.assignmentIdParam>) => {
  await reviews.declineAssignment(user, params.assignmentId, body.reason);
  return { message: 'Assignment declined' };
};
export const saveDraft = async ({ user, params, body }: C<typeof v.saveDraftBody, undefined, typeof v.assignmentIdParam>) => ({
  message: 'Draft saved',
  data: await reviews.saveDraft(user, params.assignmentId, body),
});
export const submit = async ({ user, params, body }: C<typeof v.submitReviewBody, undefined, typeof v.assignmentIdParam>) => ({
  status: 201,
  message: 'Review submitted. It is now locked.',
  data: await reviews.submitReview(user, params.assignmentId, body),
});
