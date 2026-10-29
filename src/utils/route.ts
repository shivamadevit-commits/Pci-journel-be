import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Role } from '@prisma/client';
import type { z, ZodType } from 'zod';
import { authenticate, authorize } from '../middlewares/auth';
import { limiter, type LimiterName } from '../middlewares/rateLimit';
import { upload, type UploadedFiles, type UploadSpec } from '../middlewares/upload';
import { parseSections } from '../middlewares/validate';
import { asyncHandler } from './asyncHandler';

export interface HandlerResult {
  data?: unknown;
  message?: string;
  meta?: unknown;
  status?: number;
}

type Out<T> = T extends ZodType ? z.output<T> : undefined;

export interface Ctx<B, Q, P> {
  req: Request;
  res: Response;
  user: Express.AuthUser;
  body: B;
  query: Q;
  params: P;
  files: UploadedFiles;
}

export interface PublicCtx<B, Q, P> extends Omit<Ctx<B, Q, P>, 'user'> {
  user?: undefined;
}

interface Base<B extends ZodType | undefined, Q extends ZodType | undefined, P extends ZodType | undefined> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Full path below the API prefix, e.g. `/author/articles/:articleId`. */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  body?: B;
  query?: Q;
  params?: P;
  limiter?: LimiterName;
  upload?: UploadSpec;
  /** Success status code (default 200). */
  status?: number;
  /** Extra error codes worth documenting for this endpoint. */
  errors?: number[];
  rawBody?: boolean;
}

export interface RouteMeta {
  method: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: 'public' | 'any' | Role[];
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  upload?: UploadSpec;
  status: number;
  limiter?: LimiterName;
  errors: number[];
}

export interface AnyRoute {
  meta: RouteMeta;
  handlers: RequestHandler[];
}

function send(res: Response, status: number, result: HandlerResult | void) {
  if (res.headersSent || res.writableEnded) return;
  res.status(result?.status ?? status).json({
    success: true,
    message: result?.message ?? 'OK',
    data: result?.data ?? null,
    meta: result?.meta ?? null,
  });
}

function assemble<B extends ZodType | undefined, Q extends ZodType | undefined, P extends ZodType | undefined>(
  def: Base<B, Q, P>,
  access: 'public' | 'any' | Role[],
  run: (req: Request, res: Response, parsed: { body: unknown; query: unknown; params: unknown }) => Promise<HandlerResult | void>,
): AnyRoute {
  const chain: RequestHandler[] = [];
  if (def.limiter) chain.push(limiter(def.limiter));
  if (access !== 'public') {
    chain.push(authenticate);
    if (access !== 'any') chain.push(authorize(...access));
  }
  if (def.upload) {
    chain.push(limiter('upload'));
    chain.push(...upload(def.upload));
  }
  chain.push(
    asyncHandler(async (req, res) => {
      const parsed = parseSections(
        { body: def.body as ZodType | undefined, query: def.query as ZodType | undefined, params: def.params as ZodType | undefined },
        { body: req.body, query: req.query, params: req.params },
      );
      const result = await run(req, res, parsed);
      send(res, def.status ?? 200, result);
    }),
  );
  return {
    meta: {
      method: def.method,
      path: def.path,
      tag: def.tag,
      summary: def.summary,
      description: def.description,
      access,
      body: def.body,
      query: def.query,
      params: def.params,
      upload: def.upload,
      status: def.status ?? 200,
      limiter: def.limiter,
      errors: def.errors ?? [],
    },
    handlers: chain,
  };
}

/** Authenticated endpoint. `roles` is enforced server-side by middleware before the handler runs. */
export function route<
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends ZodType | undefined = undefined,
>(
  def: Base<B, Q, P> & {
    roles: Role[] | 'any';
    handler: (ctx: Ctx<Out<B>, Out<Q>, Out<P>>) => Promise<HandlerResult | void>;
  },
): AnyRoute {
  return assemble(def, def.roles, (req, res, p) =>
    def.handler({
      req,
      res,
      user: req.user!,
      body: p.body as Out<B>,
      query: p.query as Out<Q>,
      params: p.params as Out<P>,
      files: ((req as unknown as { files?: UploadedFiles }).files ?? {}) as UploadedFiles,
    }),
  );
}

/** Unauthenticated endpoint (login, registration, public publications, webhooks...). */
export function publicRoute<
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends ZodType | undefined = undefined,
>(
  def: Base<B, Q, P> & {
    handler: (ctx: PublicCtx<Out<B>, Out<Q>, Out<P>>) => Promise<HandlerResult | void>;
  },
): AnyRoute {
  return assemble(def, 'public', (req, res, p) =>
    def.handler({
      req,
      res,
      user: undefined,
      body: p.body as Out<B>,
      query: p.query as Out<Q>,
      params: p.params as Out<P>,
      files: ((req as unknown as { files?: UploadedFiles }).files ?? {}) as UploadedFiles,
    }),
  );
}

export function buildRouter(routes: AnyRoute[]): Router {
  const router = Router();
  for (const r of routes) router[r.meta.method as 'get'](r.meta.path, ...r.handlers);
  return router;
}

type Schema = ZodType | undefined;
/** Handler context type for controllers: `C<typeof bodySchema, typeof querySchema, typeof paramsSchema>`. */
export type C<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined> = Ctx<Out<B>, Out<Q>, Out<P>>;
export type PC<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined> = PublicCtx<Out<B>, Out<Q>, Out<P>>;
