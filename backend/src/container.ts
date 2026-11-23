import { env, type Env } from './config/env.js';
import { InMemoryTaskRepository, type TaskRepository } from './repositories/task.repository.js';
import { TaskService } from './services/task.service.js';
import { IdempotencyStore } from './lib/idempotency.js';
import { Metrics } from './lib/metrics.js';
import { seedTasks } from './data/seed.js';
import { createRetriever, type TfIdfRetriever } from './assistant/knowledge/index.js';
import { AnthropicLlmClient } from './assistant/llm/anthropicClient.js';
import { CircuitBreaker } from './assistant/llm/resilience.js';
import type { LlmClient } from './assistant/llm/types.js';
import { PendingActionStore } from './assistant/pendingActions.js';
import { ConversationStore } from './assistant/conversationStore.js';
import { AssistantAgent, type AssistantConfig } from './assistant/agent.js';

export interface Container {
  config: Env;
  repository: TaskRepository;
  taskService: TaskService;
  idempotencyStore: IdempotencyStore;
  metrics: Metrics;
  retriever: TfIdfRetriever;
  llm: LlmClient | null;
  breaker: CircuitBreaker;
  pendingActions: PendingActionStore;
  conversations: ConversationStore;
  agent: AssistantAgent;
}

export interface ContainerOverrides {
  config?: Partial<Env>;
  /** Inject a fake LLM in tests; `null` simulates a missing API key. */
  llm?: LlmClient | null;
  now?: () => Date;
  seed?: boolean;
}

/**
 * Composition root: the only place that knows concrete implementations. Everything else receives
 * its dependencies, which is what makes the agent testable with a scripted LLM and a fresh,
 * isolated store per test.
 */
export function createContainer(overrides: ContainerOverrides = {}): Container {
  const config: Env = { ...env, ...overrides.config };
  const now = overrides.now ?? (() => new Date());

  const repository = new InMemoryTaskRepository();
  if (overrides.seed ?? config.SEED_DATA) seedTasks(repository, now());

  const taskService = new TaskService(repository, { now });
  const idempotencyStore = new IdempotencyStore(config.IDEMPOTENCY_TTL_MS);
  const metrics = new Metrics();
  const retriever = createRetriever();
  const llm =
    overrides.llm !== undefined
      ? overrides.llm
      : config.ANTHROPIC_API_KEY
        ? new AnthropicLlmClient(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
        : null;
  const breaker = new CircuitBreaker(config.CIRCUIT_FAILURE_THRESHOLD, config.CIRCUIT_COOLDOWN_MS);
  const pendingActions = new PendingActionStore(config.PENDING_ACTION_TTL_MS);
  const conversations = new ConversationStore();

  const assistantConfig: AssistantConfig = {
    model: llm?.model ?? config.ANTHROPIC_MODEL,
    maxTokens: config.LLM_MAX_TOKENS,
    effort: config.LLM_EFFORT,
    perCallTimeoutMs: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_MAX_RETRIES,
    deadlineMs: config.ASSISTANT_DEADLINE_MS,
    maxSteps: config.ASSISTANT_MAX_STEPS,
    forceToolFailure: config.FORCE_TOOL_FAILURE,
    retrieval: { threshold: config.KB_RELEVANCE_THRESHOLD, relativeCutoff: config.KB_RELATIVE_CUTOFF, topK: config.KB_TOP_K },
  };

  const agent = new AssistantAgent({ llm, breaker, taskService, retriever, pendingActions, conversations, metrics, config: assistantConfig, now });

  return { config, repository, taskService, idempotencyStore, metrics, retriever, llm, breaker, pendingActions, conversations, agent };
}
