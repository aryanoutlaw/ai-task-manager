import { createApp } from './app.js';
import { createContainer } from './container.js';
import { logger } from './lib/logger.js';

const container = createContainer();
const app = createApp(container);
const { PORT, ANTHROPIC_MODEL, KB_RELEVANCE_THRESHOLD, FORCE_TOOL_FAILURE } = container.config;

const server = app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      assistant: container.llm ? `enabled (${ANTHROPIC_MODEL})` : 'DISABLED — set ANTHROPIC_API_KEY',
      kbChunks: container.retriever.size,
      kbThreshold: KB_RELEVANCE_THRESHOLD,
      forceToolFailure: FORCE_TOOL_FAILURE,
    },
    `API listening on http://localhost:${PORT}  (docs: /api/docs)`,
  );
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish.
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
