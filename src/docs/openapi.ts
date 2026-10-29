import { z, type ZodType } from 'zod';
import { env } from '../config/env';
import type { AnyRoute } from '../utils/route';

type Json = Record<string, unknown>;

function toSchema(schema: ZodType): Json {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-7' }) as Json;
  } catch {
    return { type: 'object' };
  }
}

const ERROR_TEXT: Record<number, string> = {
  400: 'Validation failed (field-level `errors`)',
  401: 'Not authenticated / invalid credentials or token',
  403: 'Authenticated but not permitted',
  404: 'Not found (also returned when the resource exists but is not visible to the caller)',
  409: 'Conflict or invalid workflow state transition',
  413: 'Uploaded file too large',
  422: 'Semantically invalid request',
  429: 'Rate limit exceeded',
  500: 'Unexpected server error',
  503: 'Dependency unavailable / provider not configured',
};

const errorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
    code: { type: 'string' },
    errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
    requestId: { type: 'string' },
  },
};

export function buildOpenApi(routes: AnyRoute[]): Json {
  const paths: Record<string, Record<string, Json>> = {};

  for (const { meta } of routes) {
    const path = `/api/v1${meta.path.replace(/:([A-Za-z]+)/g, '{$1}')}`;
    const parameters: Json[] = [];

    for (const [where, schema] of [['path', meta.params], ['query', meta.query]] as const) {
      if (!schema) continue;
      const js = toSchema(schema) as { properties?: Record<string, Json>; required?: string[] };
      for (const [name, s] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: where, required: where === 'path' || (js.required ?? []).includes(name), schema: s });
      }
    }

    const op: Json = {
      tags: [meta.tag],
      summary: meta.summary,
      ...(meta.description ? { description: meta.description } : {}),
      'x-roles': meta.access === 'public' ? ['public'] : meta.access === 'any' ? ['any authenticated role'] : meta.access,
      ...(meta.limiter ? { 'x-rate-limit': meta.limiter } : {}),
      ...(meta.access === 'public' ? {} : { security: [{ bearerAuth: [] }] }),
      parameters,
    };

    if (meta.upload || meta.body) {
      const bodySchema = meta.body ? toSchema(meta.body) : { type: 'object', properties: {} };
      if (meta.upload) {
        const props = { ...((bodySchema as { properties?: Json }).properties ?? {}) };
        for (const f of meta.upload.fields) props[f.name] = { type: 'string', format: 'binary', description: `${f.kind} file${f.required ? ' (required)' : ''}` };
        op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { ...bodySchema, properties: props } }, ...(meta.upload.allowJson ? { 'application/json': { schema: bodySchema } } : {}) } };
      } else {
        op.requestBody = { required: true, content: { 'application/json': { schema: bodySchema } } };
      }
    }

    const errors = new Set<number>([...meta.errors, 500, ...(meta.access === 'public' ? [] : [401, 403]), ...(meta.body || meta.query || meta.params ? [400] : [])]);
    if (meta.limiter) errors.add(429);
    op.responses = {
      [meta.status]: {
        description: 'Success',
        content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', enum: [true] }, message: { type: 'string' }, data: {}, meta: { nullable: true } } } } },
      },
      ...Object.fromEntries([...errors].sort().map((c) => [String(c), { description: ERROR_TEXT[c] ?? 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])),
    };

    (paths[path] ??= {})[meta.method] = op;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: `${env.APP_NAME} API`,
      version: '1.0.0',
      description:
        'Backend for the PCI / DigiPharmed journal portal. All responses use `{ success, message, data, meta }`; errors use `{ success:false, message, code, errors?, requestId }`. Authenticate with `Authorization: Bearer <accessToken>`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: errorSchema },
    },
    paths,
  };
}
