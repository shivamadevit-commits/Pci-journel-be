import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithRequest } from '../utils/context';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns a correlation id (honouring a well-formed inbound X-Request-Id) and exposes it via AsyncLocalStorage. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  runWithRequest(id, next);
};
