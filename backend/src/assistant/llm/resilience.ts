import type Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmClient } from './types.js';
import { toLlmError } from './anthropicClient.js';

/**
 * Circuit breaker: after N consecutive *availability* failures the circuit opens and calls fail
 * fast for a cool-down period, instead of every user waiting out timeouts against a dead service.
 * After the cool-down one trial call is let through (half-open); success closes the circuit.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half_open' {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half_open' : 'open';
  }

  /** Throws if the call must not proceed. */
  acquire(): void {
    const state = this.state;
    if (state === 'open' || (state === 'half_open' && this.trialInFlight)) {
      const retryInSec = Math.max(1, Math.ceil((this.cooldownMs - (this.now() - (this.openedAt ?? 0))) / 1000));
      throw new LlmError('circuit_open', `The AI service is unavailable; retrying in ~${retryInSec}s`, false);
    }
    if (state === 'half_open') this.trialInFlight = true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  recordFailure(error: LlmError): void {
    this.trialInFlight = false;
    // Only availability problems trip the breaker; a bad request is our bug, not an outage.
    if (!['timeout', 'unavailable', 'rate_limited'].includes(error.kind)) return;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold || this.openedAt !== null) this.openedAt = this.now();
  }
}

export interface ResilientCallOptions {
  /** Absolute epoch-ms deadline for the whole user request. */
  deadline: number;
  perCallTimeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  /** Fired before a retry so the UI can discard partially streamed text. */
  onRetry?: (attempt: number, error: LlmError, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One LLM call with: per-attempt timeout, bounded retries with exponential backoff + full jitter,
 * an overall request deadline, and circuit-breaker accounting.
 *
 * Retrying here is safe because an LLM call has no side effects. Tool executions (which DO have
 * side effects) happen outside this function and are never retried automatically.
 */
export async function callLlmResiliently(
  llm: LlmClient,
  breaker: CircuitBreaker,
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: ResilientCallOptions,
): Promise<Anthropic.Message> {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    breaker.acquire();
    const remaining = options.deadline - Date.now();
    if (remaining <= 250) throw new LlmError('timeout', 'The assistant ran out of time for this request', false);

    const controller = new AbortController();
    const timeoutMs = Math.min(options.perCallTimeoutMs, remaining);
    const timer = setTimeout(
      () => controller.abort(new LlmError('timeout', `The AI service did not respond within ${Math.round(timeoutMs / 1000)}s`, true)),
      timeoutMs,
    );
    const onParentAbort = () => controller.abort(new LlmError('aborted', 'The request was cancelled by the client', false));
    options.signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const message = await llm.createMessage(params, { signal: controller.signal, onTextDelta: options.onTextDelta });
      breaker.recordSuccess();
      return message;
    } catch (raw) {
      const error = toLlmError(raw, controller.signal);
      breaker.recordFailure(error);
      const backoff = Math.min(4000, 400 * 2 ** attempt);
      const delay = Math.round(backoff / 2 + Math.random() * (backoff / 2));
      const canRetry =
        error.retryable && attempt < options.maxRetries && options.deadline - Date.now() > delay + 1000;
      if (!canRetry) throw error;
      attempt += 1;
      options.onRetry?.(attempt, error, delay);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
    }
  }
}
