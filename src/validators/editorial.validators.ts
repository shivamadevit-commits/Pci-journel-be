import { PaymentStatus, PlagiarismVerdict, ReviewCommentSection, ReviewRecommendation } from '@prisma/client';
import { z } from 'zod';
import { email, isoDate, name, optionalText, search, text, uuid } from '../schemas/common';
import { paginationSchema } from '../utils/pagination';

const articleId = { articleId: uuid };

export const screeningDecisionBody = z.object({
  decision: z.enum(['PROCEED', 'REJECT']),
  notes: optionalText(5000),
  authorMessage: optionalText(5000),
});

export const plagiarismParams = z.object({ ...articleId, checkId: uuid });
export const manualPlagiarismBody = z.object({
  similarityScore: z.coerce.number().min(0).max(100),
  verdict: z.enum(PlagiarismVerdict),
  provider: optionalText(100),
  providerReference: optionalText(200),
  notes: optionalText(5000),
});
export const verdictBody = z.object({ verdict: z.enum(PlagiarismVerdict), notes: optionalText(5000) });
export const clearanceBody = z.object({ action: z.enum(['CLEAR', 'REJECT']), notes: optionalText(5000), authorMessage: optionalText(5000) });

export const assignEditorBody = z.object({ editorId: uuid });

export const assignReviewersBody = z.object({
  reviewerIds: z.array(uuid).length(2, 'Exactly two reviewers must be selected'),
  dueDate: isoDate.refine((d) => d.getTime() > Date.now(), 'Due date must be in the future').optional(),
});
export const replaceReviewerBody = z.object({ reviewerId: uuid, reason: optionalText(1000) });
export const assignmentParams = z.object({ ...articleId, assignmentId: uuid });
export const eligibilityParams = z.object({ ...articleId, reviewerId: uuid });

export const moderateCommentsBody = z.object({
  items: z
    .array(
      z.object({
        commentId: uuid,
        approved: z.boolean(),
        editedBody: z.string().trim().min(1).max(10000).nullish(),
      }),
    )
    .min(1)
    .max(200),
});

export const finalDecisionBody = z.object({
  decision: z.enum(['ACCEPT', 'REJECT', 'REQUEST_REVISION']),
  notes: optionalText(5000),
  authorMessage: optionalText(5000),
});

export const majorChangeParams = z.object({ correctionId: uuid });
export const majorChangeDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: optionalText(3000) });
export const majorChangeListQuery = paginationSchema.extend({ pending: z.enum(['true', 'false']).optional().transform((v) => v !== 'false') });

export const recordPaymentBody = z.object({
  status: z.enum(PaymentStatus),
  amount: z.coerce.number().min(0).max(100000000).transform((n) => n.toFixed(2)).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  providerReference: optionalText(200),
  note: optionalText(2000),
});

// ───────────── reviewer pool & applications ─────────────

export const reviewerListQuery = paginationSchema.extend({
  search,
  subjectAreaId: uuid.optional(),
  isActive: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});
export const reviewerIdParam = z.object({ reviewerId: uuid });
export const updateReviewerBody = z
  .object({
    isActive: z.boolean().optional(),
    eligibilityNotes: optionalText(3000),
    subjectAreaIds: z.array(uuid).min(1).max(20).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export const applicationIdParam = z.object({ applicationId: uuid });
export const applicationListQuery = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), search });
export const applicationDecisionBody = z.object({ note: optionalText(3000) });

/** Works for both JSON and multipart bodies (multipart sends everything as strings). */
const asBool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const asArray = z.union([
  z.array(uuid),
  z.string().transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Must be a JSON array of UUIDs' });
      return z.NEVER;
    }
  }).pipe(z.array(uuid)),
]);
export const reviewerApplicationBody = z.object({
  email,
  firstName: name(),
  lastName: name(),
  institution: text(250),
  designation: optionalText(150),
  highestQualification: text(150),
  holdsMPharm: asBool.default(false),
  yearsTeaching: z.coerce.number().int().min(0).max(70).default(0),
  statement: text(3000, 20),
  subjectAreaIds: asArray.pipe(z.array(uuid).min(1, 'Select at least one subject area').max(20)),
});

// ───────────── reviewer workspace ─────────────

export const assignmentIdParam = z.object({ assignmentId: uuid });
export const myAssignmentsQuery = paginationSchema.extend({ status: z.enum(['ASSIGNED', 'SUBMITTED', 'DECLINED', 'REVOKED']).optional(), search });
export const declineBody = z.object({ reason: text(2000, 5) });

const reviewComment = z.object({ section: z.enum(ReviewCommentSection), body: z.string().trim().min(1).max(10000) });
export const saveDraftBody = z.object({
  recommendation: z.enum(ReviewRecommendation).optional(),
  comments: z.array(reviewComment).max(20),
});
export const submitReviewBody = z.object({
  recommendation: z.enum(ReviewRecommendation),
  comments: z.array(reviewComment).min(1, 'Add at least one comment').max(20),
});
