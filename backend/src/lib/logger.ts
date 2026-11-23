import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Structured JSON logs in production (ship to any log pipeline), pretty logs in development.
 * Secrets are redacted defensively even though we never log request headers wholesale.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'task-manager-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.apiKey', '*.ANTHROPIC_API_KEY'],
    censor: '[redacted]',
  },
  ...(isProduction || env.NODE_ENV === 'test'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
