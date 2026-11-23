import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.id },
  });
};

/**
 * The one place errors become HTTP responses. Every error body has the same envelope:
 *   { error: { code, message, details?, requestId } }
 * so the frontend can render any failure with one component.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // body-parser errors (malformed JSON / oversized body) carry an http status and a `type`.
  const parserType = (err as { type?: string }).type;
  if (parserType === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId: req.id } });
    return;
  }
  if (parserType === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId: req.id } });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.warn({ err, requestId: req.id }, err.message);
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), requestId: req.id },
    });
    return;
  }

  logger.error({ err, requestId: req.id, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', requestId: req.id },
  });
};
