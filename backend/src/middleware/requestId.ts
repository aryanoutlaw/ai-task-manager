import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9_\-.:]{1,128}$/;

/** Propagates a caller-supplied X-Request-Id (if sane) or mints one; echoed back for log correlation. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
