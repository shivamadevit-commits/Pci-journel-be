import { ArticleStatus as S } from '@prisma/client';

export { ArticleStatus } from '@prisma/client';

/** Human-readable labels using the BRD status terminology. */
export const STATUS_LABELS: Record<S, string> = {
  SUBMITTED: 'Submitted',
  UNDER_EDITORIAL_SCREENING: 'Under Editorial Screening',
  REJECTED_AT_SCREENING: 'Rejected at Screening',
  PLAGIARISM_CHECK: 'Plagiarism Check',
  READY_FOR_REVIEWER_ASSIGNMENT: 'Ready for Reviewer Assignment',
  UNDER_REVIEW: 'Under Review',
  REVIEWS_RECEIVED: 'Reviews Received',
  UNDER_EDITORIAL_DECISION: 'Under Editorial Decision',
  REVISION_REQUESTED: 'Revision Requested',
  REJECTED: 'Rejected',
  ACCEPTED_PRODUCTION_PENDING: 'Accepted – Production Pending',
  IN_PRODUCTION: 'In Production',
  PROOF_SENT_TO_AUTHOR: 'Proof Sent to Author',
  CORRECTION_REQUIRED: 'Correction Required',
  MAJOR_CONTENT_CHANGE_EDITOR_REVIEW: 'Major Content Change – Editor Review',
  FINAL_PRODUCTION: 'Final Production',
  PUBLISHED: 'Published',
};

/** The only permitted workflow edges. Everything else is rejected with INVALID_STATE_TRANSITION. */
export const TRANSITIONS: Record<S, readonly S[]> = {
  SUBMITTED: [S.UNDER_EDITORIAL_SCREENING],
  UNDER_EDITORIAL_SCREENING: [S.REJECTED_AT_SCREENING, S.PLAGIARISM_CHECK],
  REJECTED_AT_SCREENING: [], // closed: no resubmission under the same submission (BR-007)
  PLAGIARISM_CHECK: [S.READY_FOR_REVIEWER_ASSIGNMENT, S.REJECTED],
  READY_FOR_REVIEWER_ASSIGNMENT: [S.UNDER_REVIEW],
  UNDER_REVIEW: [S.REVIEWS_RECEIVED],
  REVIEWS_RECEIVED: [S.UNDER_EDITORIAL_DECISION],
  UNDER_EDITORIAL_DECISION: [S.REJECTED, S.ACCEPTED_PRODUCTION_PENDING, S.REVISION_REQUESTED],
  REVISION_REQUESTED: [S.UNDER_EDITORIAL_DECISION], // only when ALLOW_REVISION_AFTER_REVIEW is enabled
  REJECTED: [],
  ACCEPTED_PRODUCTION_PENDING: [S.IN_PRODUCTION],
  IN_PRODUCTION: [S.PROOF_SENT_TO_AUTHOR],
  PROOF_SENT_TO_AUTHOR: [S.FINAL_PRODUCTION, S.CORRECTION_REQUIRED],
  CORRECTION_REQUIRED: [S.PROOF_SENT_TO_AUTHOR, S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW, S.FINAL_PRODUCTION],
  MAJOR_CONTENT_CHANGE_EDITOR_REVIEW: [S.CORRECTION_REQUIRED],
  FINAL_PRODUCTION: [S.PUBLISHED],
  PUBLISHED: [],
};

export const TERMINAL_STATUSES: S[] = [S.REJECTED_AT_SCREENING, S.REJECTED, S.PUBLISHED];

/** Statuses that make up the Production Team's queue. Production never sees articles before acceptance. */
export const PRODUCTION_STATUSES: S[] = [
  S.ACCEPTED_PRODUCTION_PENDING,
  S.IN_PRODUCTION,
  S.PROOF_SENT_TO_AUTHOR,
  S.CORRECTION_REQUIRED,
  S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW,
  S.FINAL_PRODUCTION,
  S.PUBLISHED,
];

/** Statuses from which the author may see Editor-approved review comments (after a final decision exists). */
export const POST_DECISION_STATUSES: S[] = [
  S.REJECTED,
  S.REVISION_REQUESTED,
  S.ACCEPTED_PRODUCTION_PENDING,
  S.IN_PRODUCTION,
  S.PROOF_SENT_TO_AUTHOR,
  S.CORRECTION_REQUIRED,
  S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW,
  S.FINAL_PRODUCTION,
  S.PUBLISHED,
];

/** Statuses during which reviewers may hold/read the manuscript. */
export const REVIEW_ACTIVE_STATUSES: S[] = [S.UNDER_REVIEW, S.REVIEWS_RECEIVED, S.UNDER_EDITORIAL_DECISION];

export const REQUIRED_REVIEWERS = 2;
