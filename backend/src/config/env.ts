import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment loading.
 *
 * `backend/.env` is the canonical location; a repo-root `.env` is accepted as a fallback so a
 * single file can serve the whole monorepo. dotenv never overrides variables that are already set,
 * so real environment variables (CI, Docker, shell exports) always win. Tests never read .env files.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '../..');

if (process.env.NODE_ENV !== 'test') {
  loadDotenv({ path: path.join(backendRoot, '.env'), quiet: true });
  loadDotenv({ path: path.join(backendRoot, '..', '.env'), quiet: true });
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_DATA: bool(true),

  // LLM
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  LLM_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  LLM_MAX_TOKENS: z.coerce.number().int().min(256).max(16000).default(2048),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(12000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  ASSISTANT_DEADLINE_MS: z.coerce.number().int().min(2000).default(30000),
  ASSISTANT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  ASSISTANT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  CIRCUIT_COOLDOWN_MS: z.coerce.number().int().min(1000).default(30000),

  // Retrieval
  KB_RELEVANCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.18),
  KB_RELATIVE_CUTOFF: z.coerce.number().min(0).max(1).default(0.5),
  KB_TOP_K: z.coerce.number().int().min(1).max(10).default(3),

  // Safety / reliability
  FORCE_TOOL_FAILURE: bool(false),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(1000).default(24 * 60 * 60 * 1000),
  PENDING_ACTION_TTL_MS: z.coerce.number().int().min(1000).default(5 * 60 * 1000),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast at boot with a readable message instead of failing later at request time.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
