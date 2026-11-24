import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { StoredResponse } from '../lib/idempotency.js';
import type { Metrics } from '../lib/metrics.js';
import type { TaskService } from '../services/task.service.js';
import type { RetrievalOptions, TfIdfRetriever } from './knowledge/index.js';
import { callLlmResiliently, type CircuitBreaker } from './llm/resilience.js';
import { LlmError, type LlmClient } from './llm/types.js';
import type { ConversationStore } from './conversationStore.js';
import type { PendingActionStore } from './pendingActions.js';
import { SYSTEM_PROMPT, calendarContext } from './prompts.js';
import { checkGrounding, summarizeToolCalls } from './grounding.js';
import { toAnthropicTools } from './tools/definitions.js';
import { TurnState, executeToolUse } from './tools/executor.js';
import type { AgentEvent, AssistantRoute, ChatResponse, ToolCallRecord } from './types.js';

export const MAX_MESSAGE_LENGTH = 2000;

export const chatRequestSchema = z.strictObject({
  message: z.string().max(MAX_MESSAGE_LENGTH, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`).default(''),
  confirm: z.boolean().default(false),
  pendingActionId: z.uuid('pendingActionId must be a UUID').nullable().default(null),
  conversationId: z.uuid('conversationId must be a UUID').nullable().optional(),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

export interface AssistantConfig {
  model: string;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  perCallTimeoutMs: number;
  maxRetries: number;
  deadlineMs: number;
  maxSteps: number;
  forceToolFailure: boolean;
  retrieval: RetrievalOptions;
}

export interface AssistantDeps {
  /** null when ANTHROPIC_API_KEY is not configured — the assistant then degrades gracefully. */
  llm: LlmClient | null;
  breaker: CircuitBreaker;
  taskService: TaskService;
  retriever: TfIdfRetriever;
  pendingActions: PendingActionStore;
  conversations: ConversationStore;
  metrics: Metrics;
  config: AssistantConfig;
  now?: () => Date;
}

export interface ChatOptions {
  requestId: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Per-request failure injection (dev/test only — see assistant.controller). */
  forceToolFailure?: boolean;
}

const TOOLS = toAnthropicTools();

/**
 * Orchestrates one assistant turn. The flow (see docs/design-note.md, "Redesigned workflow"):
 *
 *  0. Validate input. Confirm/cancel of a pending action is handled deterministically — no LLM.
 *  1. Fail fast if the LLM is not configured or the circuit breaker is open.
 *  2. Agent loop: the model ROUTES by choosing tools (search_knowledge_base, task tools, both, or
 *     none). Every tool call is validated, executed through TaskService, and recorded.
 *  3. Guards: per-call timeout, retries with backoff (LLM only — never writes), request deadline,
 *     step limit, duplicate-write guard, destructive actions parked for confirmation.
 *  4. Post-checks: citation + task-id grounding; route computed from what actually ran (not from
 *     the model's self-report).
 *  5. If the LLM fails after a write committed, answer deterministically from the audit trail so the
 *     user is never left unsure whether something happened.
 */
export class AssistantAgent {
  private readonly now: () => Date;

  constructor(private readonly deps: AssistantDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async chat(rawInput: unknown, options: ChatOptions): Promise<StoredResponse> {
    const started = Date.now();
    const parsed = chatRequestSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid assistant request', parsed.error.issues.map((i) => ({
        field: i.path.join('.') || '(body)',
        message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message,
      })));
    }
    const input = parsed.data;
    const conversationId = this.deps.conversations.resolveId(input.conversationId);
    const emit = (event: AgentEvent) => options.onEvent?.(event);
    const turn = new TurnState();

    const respond = (status: number, partial: Partial<ChatResponse> & Pick<ChatResponse, 'answer'>, extra: { llmCalls?: number; usage?: ChatResponse['meta']['usage']; degraded?: boolean; groundingWarnings?: string[] } = {}): StoredResponse => {
      const { answer, ...rest } = partial;
      const body: ChatResponse = {
        answer, // first, for readable payloads
        route: 'none',
        evidence: [],
        toolCalls: turn.toolCalls,
        needsConfirmation: null,
        conversationId,
        ...rest,
        meta: {
          requestId: options.requestId,
          model: this.deps.llm?.model ?? null,
          latencyMs: Date.now() - started,
          llmCalls: extra.llmCalls ?? 0,
          usage: extra.usage ?? { inputTokens: 0, outputTokens: 0 },
          retrieval: turn.retrieval,
          groundingWarnings: extra.groundingWarnings ?? [],
          degraded: extra.degraded ?? false,
          tasksChanged: turn.tasksChanged,
        },
      };
      this.deps.metrics.recordAssistantTurn(body, status);
      logger.info(
        {
          requestId: options.requestId,
          conversationId,
          route: body.route,
          status,
          latencyMs: body.meta.latencyMs,
          llmCalls: body.meta.llmCalls,
          usage: body.meta.usage,
          tools: body.toolCalls.map((c) => `${c.name}:${c.status}`),
          retrieval: body.meta.retrieval.map((r) => ({ q: r.query, top: r.passed[0]?.score ?? r.rejected[0]?.score ?? 0, passed: r.passed.length })),
          groundingWarnings: body.meta.groundingWarnings,
          degraded: body.meta.degraded,
          error: body.error?.code,
        },
        'assistant turn',
      );
      return { status, body };
    };

    // ── 0. Confirmation / cancellation of a parked destructive action (no LLM involved) ────────────
    if (input.pendingActionId) {
      return this.resolvePendingAction(input.pendingActionId, input.confirm, conversationId, turn, respond, options.forceToolFailure ?? this.deps.config.forceToolFailure);
    }

    const message = input.message.trim();
    if (!message) {
      throw new AppError(400, 'EMPTY_MESSAGE', 'Please type a message for the assistant.');
    }

    // ── 1. Fail fast when the LLM cannot be used ───────────────────────────────────────────────────
    if (!this.deps.llm) {
      return respond(503, {
        answer: "The assistant isn't configured on this server (ANTHROPIC_API_KEY is missing). You can still manage tasks from the dashboard.",
        error: { code: 'LLM_NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' },
      });
    }
    if (this.deps.breaker.state === 'open') {
      return respond(503, {
        answer: 'The AI service is currently unavailable, so I can\'t process requests right now. Please try again in a little while — the dashboard still works normally.',
        error: { code: 'LLM_CIRCUIT_OPEN', message: 'Circuit breaker is open after repeated AI service failures' },
      });
    }

    // ── 2. Agent loop ─────────────────────────────────────────────────────────────────────────────
    const { config } = this.deps;
    const deadline = started + config.deadlineMs;
    const history = this.deps.conversations.history(conversationId);
    const messages: Anthropic.MessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
      { role: 'user', content: message },
    ];
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: calendarContext(this.now()) },
    ];
    const toolCtx = {
      taskService: this.deps.taskService,
      retriever: this.deps.retriever,
      retrievalOptions: config.retrieval,
      pendingActions: this.deps.pendingActions,
      conversationId,
      forceToolFailure: options.forceToolFailure ?? config.forceToolFailure,
      turn,
      emit,
    };

    let llmCalls = 0;
    const usage = { inputTokens: 0, outputTokens: 0 };
    let finalText: string | null = null;
    let stoppedReason: 'refusal' | 'step_limit' | null = null;

    try {
      for (let step = 0; step < config.maxSteps; step += 1) {
        emit({ type: 'status', message: step === 0 ? 'Thinking…' : 'Reviewing results…' });
        llmCalls += 1;
        const response = await callLlmResiliently(
          this.deps.llm,
          this.deps.breaker,
          {
            model: config.model,
            max_tokens: config.maxTokens,
            system,
            tools: TOOLS,
            messages,
            output_config: { effort: config.effort },
          },
          {
            deadline,
            perCallTimeoutMs: config.perCallTimeoutMs,
            maxRetries: config.maxRetries,
            signal: options.signal,
            onTextDelta: (text) => emit({ type: 'text_delta', text }),
            onRetry: (attempt, error, delayMs) => {
              logger.warn({ requestId: options.requestId, attempt, kind: error.kind, delayMs }, 'Retrying LLM call');
              this.deps.metrics.increment('llm_retries');
              emit({ type: 'text_reset' });
              emit({ type: 'status', message: 'The AI service is slow — retrying…' });
            },
          },
        );
        usage.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
        usage.outputTokens += response.usage.output_tokens;

        if (response.stop_reason === 'refusal') {
          stoppedReason = 'refusal';
          break;
        }

        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0 || response.stop_reason !== 'tool_use') {
          finalText = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
          break;
        }

        // Text before a tool call is a preamble, not the answer.
        emit({ type: 'text_reset' });
        messages.push({ role: 'assistant', content: response.content });

        // Sequential on purpose: writes must apply in the order the model intended, and all
        // results go back in ONE user message (required for parallel tool use to keep working).
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUses) results.push(await executeToolUse(block, toolCtx));
        messages.push({ role: 'user', content: results });

        if (step === config.maxSteps - 1) stoppedReason = 'step_limit';
      }
    } catch (raw) {
      const error = raw instanceof LlmError ? raw : new LlmError('unknown', raw instanceof Error ? raw.message : 'Unknown error', false, raw);
      this.deps.metrics.increment(`llm_failures_${error.kind}`);
      logger.warn({ requestId: options.requestId, kind: error.kind, err: error.cause ?? error }, 'LLM call failed');
      return this.degradedResponse(error, turn, respond, { llmCalls, usage }, conversationId, message);
    }

    // ── 3. Finalise: answer text, grounding checks, route ─────────────────────────────────────────
    let answer: string;
    const warnings: string[] = [];
    if (stoppedReason === 'refusal') {
      answer = "I can't help with that request. I can help you manage tasks or answer questions about how the team works.";
    } else if (finalText) {
      answer = finalText;
    } else {
      warnings.push(stoppedReason === 'step_limit' ? 'Stopped after reaching the tool-step limit.' : 'The model returned no text.');
      answer = turn.toolCalls.length
        ? `Here is what I did:\n${summarizeToolCalls(turn.toolCalls)}`
        : "Sorry, I couldn't complete that request. Could you rephrase it?";
    }

    const grounding = checkGrounding({ answer, evidence: turn.evidence, knownTaskIds: turn.knownTaskIds, userMessage: message });
    warnings.push(...grounding.warnings);

    const { evidence, route } = resolveRouteAndEvidence(turn, grounding.citedEvidence);
    const needsConfirmation = this.toNeedsConfirmation(turn);

    this.deps.conversations.append(conversationId, { role: 'user', content: message }, { role: 'assistant', content: grounding.answer });

    return respond(
      200,
      { answer: grounding.answer, route, evidence, needsConfirmation },
      { llmCalls, usage, groundingWarnings: warnings },
    );
  }

  /** Executes or cancels a parked delete. Deterministic: the LLM is not involved in confirming. */
  private resolvePendingAction(
    pendingActionId: string,
    confirm: boolean,
    conversationId: string,
    turn: TurnState,
    respond: (status: number, partial: Partial<ChatResponse> & Pick<ChatResponse, 'answer'>) => StoredResponse,
    forceToolFailure: boolean,
  ): StoredResponse {
    const taken = this.deps.pendingActions.take(pendingActionId);
    if (!taken.ok) {
      return respond(409, {
        answer:
          taken.reason === 'expired'
            ? 'That confirmation has expired, so nothing was deleted. Ask me again if you still want to delete the task.'
            : 'That confirmation is no longer valid (it was already used or cancelled), so nothing was deleted.',
        error: { code: taken.reason === 'expired' ? 'CONFIRMATION_EXPIRED' : 'CONFIRMATION_NOT_FOUND', message: 'Pending action is not available' },
      });
    }
    const action = taken.action;
    const started = Date.now();
    const base = { id: `confirm_${action.id}`, name: 'delete_task' as const, arguments: { id: action.taskId } };

    if (!confirm) {
      turn.toolCalls.push({ ...base, status: 'cancelled', result: { cancelled: true }, durationMs: 0 });
      const answer = `Okay — I won't delete task #${action.taskId} "${action.taskTitle}". Nothing was changed.`;
      this.deps.conversations.append(conversationId, { role: 'assistant', content: answer });
      return respond(200, { answer, route: 'none' });
    }

    let call: ToolCallRecord;
    let answer: string;
    let status = 200;
    try {
      if (forceToolFailure) {
        throw new AppError(503, 'TOOL_UNAVAILABLE', 'The task service is unavailable (simulated failure). Nothing was deleted.');
      }
      const current = this.deps.taskService.get(action.taskId);
      if (current.updatedAt !== action.taskUpdatedAt) {
        throw new AppError(409, 'TASK_CHANGED', `Task #${action.taskId} changed after you asked to delete it, so I did not delete it. Please review it and ask again.`);
      }
      const deleted = this.deps.taskService.delete(action.taskId);
      turn.tasksChanged = true;
      call = { ...base, status: 'success', result: { deleted: { id: deleted.id, title: deleted.title } }, durationMs: Date.now() - started };
      answer = `Done — task #${deleted.id} "${deleted.title}" has been deleted.`;
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(500, 'TOOL_ERROR', 'Deleting the task failed unexpectedly.');
      status = appError.status === 404 ? 404 : appError.status === 409 ? 409 : appError.status >= 500 ? 503 : 400;
      call = { ...base, status: 'error', error: { code: appError.code, message: appError.message }, durationMs: Date.now() - started };
      answer =
        appError.code === 'TASK_NOT_FOUND'
          ? `Task #${action.taskId} no longer exists, so there was nothing to delete.`
          : `${appError.message}`;
    }
    turn.toolCalls.push(call);
    this.deps.conversations.append(conversationId, { role: 'assistant', content: answer });
    return respond(status, {
      answer,
      route: 'tool',
      ...(call.status === 'error' ? { error: { code: call.error!.code, message: call.error!.message } } : {}),
    });
  }

  /**
   * LLM failed. If something was already written, report it deterministically (HTTP 200,
   * degraded) — the user must know the task exists. Otherwise 503 with an honest message.
   * Writes are NEVER retried here.
   */
  private degradedResponse(
    error: LlmError,
    turn: TurnState,
    respond: (status: number, partial: Partial<ChatResponse> & Pick<ChatResponse, 'answer'>, extra?: { llmCalls?: number; usage?: ChatResponse['meta']['usage']; degraded?: boolean; groundingWarnings?: string[] }) => StoredResponse,
    stats: { llmCalls: number; usage: ChatResponse['meta']['usage'] },
    conversationId: string,
    message: string,
  ): StoredResponse {
    const reason: Record<string, string> = {
      timeout: 'the AI service took too long to respond',
      rate_limited: 'the AI service is rate limiting requests',
      unavailable: 'the AI service is unavailable',
      circuit_open: 'the AI service is unavailable',
      auth: 'the assistant is misconfigured (the API key was rejected)',
      aborted: 'the request was cancelled',
    };
    const why = reason[error.kind] ?? 'the AI service returned an error';
    const errorBody = { code: `LLM_${error.kind.toUpperCase()}`, message: error.message };
    const committed = turn.toolCalls.filter((c) => c.status === 'success' || c.status === 'pending_confirmation');

    if (committed.length) {
      const { evidence, route } = resolveRouteAndEvidence(turn, []);
      const answer = `I couldn't finish my reply because ${why}, but here is exactly what was done:\n${summarizeToolCalls(turn.toolCalls)}`;
      this.deps.conversations.append(conversationId, { role: 'user', content: message }, { role: 'assistant', content: answer });
      return respond(200, { answer, route, evidence, needsConfirmation: this.toNeedsConfirmation(turn), error: errorBody }, { ...stats, degraded: true });
    }

    // Always 5xx (never cached by the idempotency layer), so a client retry re-runs the turn.
    return respond(
      503,
      { answer: `Sorry — I can't answer right now because ${why}. No tasks were changed. Please try again shortly; the dashboard still works.`, error: errorBody },
      { ...stats, degraded: true },
    );
  }

  private toNeedsConfirmation(turn: TurnState): ChatResponse['needsConfirmation'] {
    const action = turn.pendingAction;
    if (!action) return null;
    return {
      pendingActionId: action.id,
      action: 'delete_task',
      taskId: action.taskId,
      taskTitle: action.taskTitle,
      summary: `Delete task #${action.taskId} "${action.taskTitle}"? This cannot be undone.`,
      expiresAt: new Date(action.expiresAt).toISOString(),
    };
  }
}

/**
 * Route is derived from what actually happened — auditable, not self-reported by the model:
 *  - KB counts as used if the answer cites retrieved passages, or (no citations, no task tools) if
 *    passages above threshold were retrieved and the answer is therefore policy-based.
 *  - Tool counts as used if any task tool was called (successful or not).
 * Retrieved-but-unused passages stay visible in meta.retrieval, not in `evidence`.
 */
export function resolveRouteAndEvidence(turn: TurnState, cited: ChatResponse['evidence']): { route: AssistantRoute; evidence: ChatResponse['evidence'] } {
  const usedTools = turn.toolCalls.length > 0;
  let evidence = cited;
  if (!evidence.length && !usedTools && turn.evidence.size > 0) evidence = [...turn.evidence.values()];
  evidence = [...evidence].sort((a, b) => b.score - a.score);
  const usedKb = evidence.length > 0;
  const route: AssistantRoute = usedKb && usedTools ? 'both' : usedKb ? 'kb' : usedTools ? 'tool' : 'none';
  return { route, evidence };
}
