import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import type { Actor } from '../utils/context';
import { transact } from '../utils/context';
import { AuditAction, recordAudit } from './audit.service';

/** Journal rules that Admin can change at runtime. Environment variables provide the defaults. */
export const portalConfigSchema = z.object({
  wordLimit: z.number().int().min(1).max(200000),
  /** Master switch. While off, no APC is collected, checked or shown anywhere in the portal. */
  paymentEnabled: z.boolean(),
  apcEnforcement: z.enum(['none', 'flag', 'block']),
  apcDefaultAmount: z.number().min(0).max(100000000).nullable(),
  apcCurrency: z.string().length(3).toUpperCase().nullable(),
  allowRevisionAfterReview: z.boolean(),
  reviewDueDays: z.number().int().min(1).max(365).nullable(),
  reviewerMinYearsTeaching: z.number().int().min(0).max(80),
  publicationRequiredMetadata: z.array(z.enum(['doi', 'volume', 'issue', 'pages', 'license', 'copyright', 'citation'])).max(10),
});

export type PortalConfig = z.infer<typeof portalConfigSchema>;

const defaults = (): PortalConfig => ({
  wordLimit: env.WORD_LIMIT,
  paymentEnabled: false,
  apcEnforcement: env.APC_ENFORCEMENT,
  apcDefaultAmount: env.APC_DEFAULT_AMOUNT ?? null,
  apcCurrency: env.APC_CURRENCY ?? null,
  allowRevisionAfterReview: env.ALLOW_REVISION_AFTER_REVIEW,
  reviewDueDays: env.REVIEW_DUE_DAYS ?? null,
  reviewerMinYearsTeaching: env.REVIEWER_MIN_YEARS_TEACHING,
  publicationRequiredMetadata: env.publicationRequiredMetadata.filter((k): k is PortalConfig['publicationRequiredMetadata'][number] =>
    ['doi', 'volume', 'issue', 'pages', 'license', 'copyright', 'citation'].includes(k),
  ),
});

let cache: { at: number; value: PortalConfig } | null = null;
const TTL_MS = 15_000;

export async function getConfig(): Promise<PortalConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.systemConfig.findMany();
  const merged: Record<string, unknown> = { ...defaults() };
  for (const r of rows) merged[r.key] = r.value;
  const parsed = portalConfigSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : defaults();
  cache = { at: Date.now(), value };
  return value;
}

export async function updateConfig(patch: Partial<PortalConfig>, actor: Actor): Promise<PortalConfig> {
  const before = await getConfig();
  const next = portalConfigSchema.parse({ ...before, ...patch });
  await transact(async (tx) => {
    for (const key of Object.keys(patch) as Array<keyof PortalConfig>) {
      await tx.systemConfig.upsert({
        where: { key },
        create: { key, value: next[key] as Prisma.InputJsonValue, updatedById: actor.id },
        update: { value: next[key] as Prisma.InputJsonValue, updatedById: actor.id },
      });
    }
    await recordAudit(tx, {
      action: AuditAction.CONFIG_CHANGED,
      entityType: 'SystemConfig',
      actor,
      metadata: { changed: Object.keys(patch), before: pick(before, patch), after: pick(next, patch) },
    });
  });
  cache = null;
  return getConfig();
}

function pick(obj: PortalConfig, keys: Partial<PortalConfig>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) out[k] = obj[k as keyof PortalConfig];
  return out;
}
