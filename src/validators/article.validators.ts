import { ArticleStatus, PaymentStatus } from '@prisma/client';
import { z } from 'zod';
import { email, isoDate, jsonField, name, optionalText, queryBool, search, text, uuid } from '../schemas/common';
import { paginationSchema, sortSchema } from '../utils/pagination';

export const articleIdParam = z.object({ articleId: uuid });
export const fileIdParam = z.object({ fileId: uuid });

const authorEntry = z.object({
  firstName: name(),
  lastName: name(),
  email,
  affiliation: optionalText(250),
  isCorresponding: z.boolean().default(false),
});

const submissionMetadata = z
  .object({
    title: text(500, 5),
    abstract: text(5000, 20),
    ethicsStatement: text(5000, 5),
    subjectAreaId: uuid.optional(),
    keywords: z.array(z.string().trim().min(2).max(60)).min(1, 'At least one keyword is required').max(10),
    authors: z.array(authorEntry).min(1, 'At least one author is required').max(30),
    confirmAnonymised: z.literal(true, { error: 'You must confirm the manuscript is anonymised for double-blind review' }),
  })
  .refine((v) => v.authors.some((a) => a.isCorresponding), { path: ['authors'], message: 'Mark one author as the corresponding author' });

/** multipart/form-data: JSON document in `metadata`, files in `manuscript` (+ optional `titlePage`). */
export const submitArticleBody = z.object({ metadata: jsonField(submissionMetadata) });

export const revisionBody = z.object({ changeNote: optionalText(2000) });

export const myArticlesQuery = paginationSchema.extend({
  status: z.enum(ArticleStatus).optional(),
  search,
  ...sortSchema(['submittedAt', 'title', 'status'], 'submittedAt').shape,
});

export const proofParams = z.object({ articleId: uuid, proofId: uuid });
export const approveProofBody = z.object({ feedback: optionalText(5000) });
export const submitCorrectionsBody = z.object({
  feedback: optionalText(5000),
  corrections: z
    .array(
      z.object({
        type: z.enum(['MINOR', 'MAJOR']).default('MINOR'),
        location: optionalText(300),
        description: text(3000),
      }),
    )
    .min(1, 'List at least one correction')
    .max(100),
});

const statusList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.enum(ArticleStatus)).max(20));

export const editorialListQuery = paginationSchema.extend({
  status: statusList.optional(),
  search,
  subjectAreaId: uuid.optional(),
  editorId: z.union([uuid, z.literal('unassigned')]).optional(),
  apcStatus: z.enum(PaymentStatus).optional(),
  wordLimitExceeded: queryBool,
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...sortSchema(['submittedAt', 'title', 'status', 'submissionId'], 'submittedAt').shape,
});

export const productionQueueQuery = paginationSchema.extend({
  status: statusList.optional(),
  search,
  assignedToMe: queryBool,
});

export const publicListQuery = paginationSchema.extend({
  search,
  subjectAreaId: uuid.optional(),
  year: z.coerce.number().int().min(1990).max(2200).optional(),
  ...sortSchema(['publishedAt', 'title'], 'publishedAt').shape,
});
export const submissionIdParam = z.object({ submissionId: z.string().trim().regex(/^[A-Z0-9]{2,10}-\d{4}-\d{6}$/, 'Invalid submission ID') });
