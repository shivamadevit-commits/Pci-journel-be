import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { logger } from './config/logger';
import { checkDatabase } from './config/prisma';
import { buildOpenApi } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { limiter } from './middlewares/rateLimit';
import { requestId } from './middlewares/requestId';
import { allRoutes, apiRouter } from './routes';
import { storage } from './storage';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Only the configured number of proxy hops (e.g. the OCI load balancer) is trusted for client IPs.
  app.set('trust proxy', env.trustProxy);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      serializers: {
        // Query strings are dropped from logs (they can carry tokens); headers are never logged.
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(Object.assign(new Error('Origin not allowed'), { type: 'cors.denied' }));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit'],
      maxAge: 600,
    }),
  );

  // Liveness / readiness are outside the rate limiter and the API prefix.
  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'OK', data: { status: 'up' }, meta: null });
  });
  app.get('/ready', async (_req, res) => {
    const [db, store] = await Promise.all([checkDatabase(), storage.ping()]);
    const ok = db && store;
    res.status(ok ? 200 : 503).json({
      success: ok,
      message: ok ? 'Ready' : 'Not ready',
      data: { database: db ? 'up' : 'down', storage: store ? 'up' : 'down' },
      meta: null,
    });
  });

  app.use(
    express.json({
      limit: env.JSON_BODY_LIMIT,
      // Webhook signatures are computed over the exact bytes received.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/v1/webhooks/')) (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );

  if (env.SWAGGER_ENABLED) {
    const spec = buildOpenApi(allRoutes);
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec as never, { customSiteTitle: `${env.APP_NAME} API` }));
  }

  app.use('/api/v1', limiter('general'), apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
