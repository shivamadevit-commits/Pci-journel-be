import { z } from 'zod';
import * as v from '../validators/article.validators';
import { downloadFile, downloadPublished } from '../services/files.service';
import { getConfig } from '../services/config.service';
import { handlePaymentWebhook } from '../services/payment.service';
import { handleProviderResult } from '../services/plagiarism.service';
import type { C, PC } from '../utils/route';

export const download = async ({ user, params, res }: C<undefined, undefined, typeof v.fileIdParam>) => {
  await downloadFile(user, params.fileId, res);
};

export const downloadPublic = async ({ params, res }: PC<undefined, undefined, typeof v.submissionIdParam & z.ZodObject<{ kind: z.ZodEnum<{ html: 'html'; pdf: 'pdf' }> }>>) => {
  await downloadPublished(params.submissionId, params.kind, res);
};

/** Feature flags every signed-in user may read, so the UI can hide disabled modules. */
export const features = async () => ({ data: { paymentEnabled: (await getConfig()).paymentEnabled } });

export const paymentWebhook = async ({ req }: PC) => {
  const r = await handlePaymentWebhook(req.rawBody, req.headers);
  return { message: 'Webhook processed', data: r };
};

export const plagiarismBody = z.object({
  providerReference: z.string().min(1).max(200),
  status: z.enum(['COMPLETED', 'FAILED']),
  similarityScore: z.number().min(0).max(100).optional(),
  errorMessage: z.string().max(500).optional(),
});

export const plagiarismWebhook = async ({ req, body }: PC<typeof plagiarismBody>) => {
  const sig = req.header('x-signature');
  const r = await handleProviderResult(req.rawBody, sig, body);
  return { message: 'Webhook processed', data: r };
};
