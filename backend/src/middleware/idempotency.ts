import type { Request, RequestHandler } from 'express';
import { ValidationError } from '../lib/errors.js';
import {
  IDEMPOTENCY_KEY_PATTERN,
  fingerprint,
  type IdempotencyStore,
  type StoredResponse,
} from '../lib/idempotency.js';

export type ResponseProducer = (req: Request) => Promise<StoredResponse> | StoredResponse;

export function readIdempotencyKey(req: Request): string | undefined {
  const key = req.get('Idempotency-Key')?.trim();
  if (!key) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ValidationError('Invalid Idempotency-Key header', [
      { field: 'Idempotency-Key', message: 'Must be 8-255 characters of letters, digits, "-", "_", ":" or "."' },
    ]);
  }
  return key;
}

/**
 * Wraps a handler that *returns* its response so the response can be stored and replayed.
 * The header is optional (plain REST clients keep working) but the web client always sends one
 * for writes, so double-clicks and network retries are safe end-to-end.
 */
export function idempotent(store: IdempotencyStore, produce: ResponseProducer): RequestHandler {
  return async (req, res) => {
    const key = readIdempotencyKey(req);
    if (!key) {
      const response = await produce(req);
      res.status(response.status).json(response.body);
      return;
    }

    const scope = `${req.method} ${req.baseUrl}${req.path}::${key}`;
    const { response, replayed } = await store.execute(scope, fingerprint(req.body), async () => produce(req));
    res.setHeader('Idempotency-Key', key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(response.status).json(response.body);
  };
}
