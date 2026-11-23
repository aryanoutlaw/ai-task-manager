import type { Request, RequestHandler } from 'express';
import type { AssistantAgent } from '../assistant/agent.js';
import { isProduction } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { fingerprint, type IdempotencyStore } from '../lib/idempotency.js';
import { readIdempotencyKey } from '../middleware/idempotency.js';
import type { AgentEvent } from '../assistant/types.js';
import { logger } from '../lib/logger.js';

/**
 * Failure injection for demos/tests without restarting the server. Honoured only outside
 * production, so it can never be abused against a real deployment. FORCE_TOOL_FAILURE=true (env)
 * is the always-on equivalent.
 */
function forceToolFailureOverride(req: Request): boolean | undefined {
  if (isProduction) return undefined;
  const header = req.get('x-simulate-tool-failure');
  return header === undefined ? undefined : header === 'true';
}

export function createAssistantController(agent: AssistantAgent, idempotencyStore: IdempotencyStore) {
  /** POST /api/assistant/chat — JSON in, JSON out. Idempotent when an Idempotency-Key is sent. */
  const chat = (req: Request) =>
    agent.chat(req.body, { requestId: String(req.id), forceToolFailure: forceToolFailureOverride(req), signal: abortSignalFor(req) });

  /**
   * POST /api/assistant/chat/stream — same contract, delivered as Server-Sent Events:
   *   event: status | kb_search | tool_start | tool_end | text_delta | text_reset   (progress)
   *   event: done   data: { status, body: ChatResponse }                           (final, always last)
   *   event: error  data: { error }                                                (request-level failure)
   * Idempotency applies here too: a replayed key emits just the stored `done` event.
   */
  const chatStream: RequestHandler = async (req, res) => {
    const key = readIdempotencyKey(req);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    const onEvent = (event: AgentEvent) => send(event.type, event);
    const run = () =>
      agent.chat(req.body, { requestId: String(req.id), onEvent, forceToolFailure: forceToolFailureOverride(req), signal: abortSignalFor(req) });

    try {
      const { response, replayed } = key
        ? await idempotencyStore.execute(`POST /api/assistant/chat::${key}`, fingerprint(req.body), run)
        : { response: await run(), replayed: false };
      send('done', { status: response.status, replayed, body: response.body });
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      if (!appError) logger.error({ err: error, requestId: req.id }, 'Streaming chat failed');
      send('error', {
        status: appError?.status ?? 500,
        error: {
          code: appError?.code ?? 'INTERNAL_ERROR',
          message: appError?.message ?? 'Something went wrong on our side. Please try again.',
          ...(appError?.details ? { details: appError.details } : {}),
          requestId: req.id,
        },
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };

  return { chat, chatStream };
}

/** Aborts in-flight LLM work when the client disconnects (saves tokens; writes are unaffected). */
function abortSignalFor(req: Request): AbortSignal {
  const controller = new AbortController();
  // `close` on the response fires once per request; if it fires before we finished writing, the
  // client went away. (Listening on req.socket would leak listeners across keep-alive requests.)
  req.res?.once('close', () => {
    if (!req.res?.writableFinished) controller.abort();
  });
  return controller.signal;
}
