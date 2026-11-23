import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { corsOrigins } from './config/env.js';
import { logger } from './lib/logger.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createTasksRouter } from './routes/tasks.routes.js';
import { createAssistantRouter } from './routes/assistant.routes.js';
import type { Container } from './container.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(here, '..', 'openapi.yaml');

export function createApp(container: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  // Swagger UI needs inline scripts/styles; relax CSP only for the docs path.
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }));
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Idempotency-Key'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Simulate-Tool-Failure'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(container.metrics.httpMiddleware());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      tasks: container.repository.findAll().length,
      assistant: {
        configured: container.llm !== null,
        model: container.llm?.model ?? null,
        circuit: container.breaker.state,
        knowledgeBaseChunks: container.retriever.size,
        relevanceThreshold: container.config.KB_RELEVANCE_THRESHOLD,
        forceToolFailure: container.config.FORCE_TOOL_FAILURE,
      },
    });
  });
  app.get('/api/metrics', (_req, res) => {
    res.json(container.metrics.snapshot());
  });

  app.use('/api/tasks', createTasksRouter(container));
  app.use(
    '/api/assistant',
    createAssistantRouter({
      agent: container.agent,
      idempotencyStore: container.idempotencyStore,
      rateLimitPerMinute: container.config.ASSISTANT_RATE_LIMIT_PER_MIN,
    }),
  );

  if (fs.existsSync(OPENAPI_PATH)) {
    const spec = YAML.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => {
      res.json(spec);
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Task Manager API' }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
