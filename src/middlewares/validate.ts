import type { ZodType } from 'zod';
import type { FieldError } from '../utils/errors';
import { ValidationError } from '../utils/errors';

export function zodIssues(err: { issues: Array<{ path: PropertyKey[]; message: string }> }, prefix = ''): FieldError[] {
  return err.issues.map((i) => ({
    field: [prefix, ...i.path.map(String)].filter(Boolean).join('.') || prefix || '(root)',
    message: i.message,
  }));
}

/**
 * Parses and validates all three request sections. Unknown keys are stripped (never passed through), which is the
 * first line of defence against mass assignment; services additionally map fields explicitly.
 */
export function parseSections<B, Q, P>(
  schemas: { body?: ZodType<B>; query?: ZodType<Q>; params?: ZodType<P> },
  input: { body: unknown; query: unknown; params: unknown },
): { body: B; query: Q; params: P } {
  const errors: FieldError[] = [];
  const out = {} as { body: B; query: Q; params: P };
  for (const key of ['params', 'query', 'body'] as const) {
    const schema = schemas[key] as ZodType<unknown> | undefined;
    if (!schema) {
      (out as Record<string, unknown>)[key] = undefined;
      continue;
    }
    const r = schema.safeParse(input[key] ?? {});
    if (r.success) (out as Record<string, unknown>)[key] = r.data;
    else errors.push(...zodIssues(r.error, key === 'body' ? '' : key));
  }
  if (errors.length) throw new ValidationError(errors);
  return out;
}
