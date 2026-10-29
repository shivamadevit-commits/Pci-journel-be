import { z } from 'zod';
import { optionalText, text, uuid, isoDate } from '../schemas/common';

export const uploadProofBody = z.object({
  notes: optionalText(3000),
  sendToAuthor: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(true),
});
export const proofIdParams = z.object({ articleId: uuid, proofId: uuid });
export const assignProductionBody = z.object({ assigneeId: uuid });
export const correctionIdParam = z.object({ correctionId: uuid });
export const implementCorrectionBody = z.object({ note: optionalText(3000) });
export const escalateCorrectionBody = z.object({ reason: text(3000, 5) });
export const finalFileParams = z.object({ articleId: uuid, kind: z.enum(['html', 'pdf']) });

const optionalField = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : v));
export const publicationMetadataBody = z
  .object({
    doi: z.string().trim().regex(/^10\.\d{4,9}\/\S+$/, 'DOI must look like 10.xxxx/yyyy').max(200).nullish(),
    volume: optionalField(20),
    issue: optionalField(20),
    pages: optionalField(40),
    license: optionalField(200),
    copyright: optionalField(300),
    citation: optionalField(2000),
    extra: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 20, 'Too many extra fields').optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field' });

export const publishBody = z.object({ publishedAt: isoDate.optional() });
