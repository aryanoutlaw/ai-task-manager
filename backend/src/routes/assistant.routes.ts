import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AssistantAgent } from '../assistant/agent.js';
import type { IdempotencyStore } from '../lib/idempotency.js';
import { createAssistantController } from '../controllers/assistant.controller.js';
import { idempotent } from '../middleware/idempotency.js';

export function createAssistantRouter(deps: { agent: AssistantAgent; idempotencyStore: IdempotencyStore; rateLimitPerMinute: number }): Router {
  const controller = createAssistantController(deps.agent, deps.idempotencyStore);
  const router = Router();

  // LLM calls cost money: cap per-client request rate. Returns the standard error envelope.
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: deps.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Please wait a moment and try again.', requestId: req.id },
        });
      },
    }),
  );

  router.post('/chat', idempotent(deps.idempotencyStore, controller.chat));
  router.post('/chat/stream', controller.chatStream);
  return router;
}
