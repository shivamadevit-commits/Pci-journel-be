import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../utils/errors';

export interface PlagiarismSubmitInput {
  articleId: string;
  submissionId: string;
  fileName: string;
  file: Buffer;
}

/**
 * Integration point for the plagiarism service (e.g. Turnitin). PCI has not confirmed the provider or its API, so
 * no vendor adapter is shipped. Implement this interface for the chosen vendor and register it with
 * `registerPlagiarismProvider("<name>", adapter)`, then set PLAGIARISM_PROVIDER=<name>. Until then Editors record
 * results manually (FR-009 fallback).
 */
export interface PlagiarismProvider {
  readonly name: string;
  /** Submits the manuscript; returns the provider's reference used to match the result callback. */
  submit(input: PlagiarismSubmitInput): Promise<{ providerReference: string }>;
}

const registry = new Map<string, PlagiarismProvider>();
export const registerPlagiarismProvider = (name: string, p: PlagiarismProvider) => registry.set(name, p);

export function getPlagiarismProvider(): PlagiarismProvider {
  const name = env.PLAGIARISM_PROVIDER;
  const p = name === 'none' ? undefined : registry.get(name);
  if (!p) {
    throw new ServiceUnavailableError(
      name === 'none'
        ? 'No plagiarism provider is configured. Record the result manually instead.'
        : `Plagiarism provider "${name}" has no adapter registered. Record the result manually instead.`,
      'PLAGIARISM_PROVIDER_NOT_CONFIGURED',
    );
  }
  return p;
}

if (env.PLAGIARISM_PROVIDER !== 'none' && !registry.has(env.PLAGIARISM_PROVIDER)) {
  logger.warn({ provider: env.PLAGIARISM_PROVIDER }, 'PLAGIARISM_PROVIDER is set but no adapter is registered');
}
