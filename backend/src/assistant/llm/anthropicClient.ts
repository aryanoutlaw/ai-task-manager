import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmCallOptions, type LlmClient } from './types.js';

/**
 * Claude via the official SDK.
 *  - Streams every call (`messages.stream` + `finalMessage()`): text deltas feed the UI, and the
 *    call is not subject to long non-streaming HTTP timeouts.
 *  - SDK-level retries are disabled (maxRetries: 0): retry policy lives in ONE place
 *    (resilience.ts) where it is bounded by the request deadline and visible in logs.
 *  - Errors are mapped to LlmError kinds using the SDK's typed classes (never string matching).
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string, public readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: LlmCallOptions): Promise<Anthropic.Message> {
    try {
      const stream = this.client.messages.stream(params, { signal: options.signal });
      if (options.onTextDelta) stream.on('text', options.onTextDelta);
      return await stream.finalMessage();
    } catch (error) {
      throw toLlmError(error, options.signal);
    }
  }
}

export function toLlmError(error: unknown, signal?: AbortSignal): LlmError {
  if (error instanceof LlmError) return error;
  // Our own per-call timeout / request deadline aborts the signal with a reason we can read.
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof LlmError) return reason;
    return new LlmError('aborted', 'The request was cancelled', false, error);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('timeout', 'The AI service timed out', true, error);
  if (error instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', 'The request was cancelled', false, error);
  if (error instanceof Anthropic.APIConnectionError) return new LlmError('unavailable', 'Could not reach the AI service', true, error);
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('auth', 'The AI service rejected our credentials (check ANTHROPIC_API_KEY)', false, error);
  }
  if (error instanceof Anthropic.RateLimitError) return new LlmError('rate_limited', 'The AI service is rate limiting requests', true, error);
  if (error instanceof Anthropic.InternalServerError) return new LlmError('unavailable', 'The AI service is temporarily unavailable', true, error);
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 529 || status >= 500) return new LlmError('unavailable', 'The AI service is overloaded', true, error);
    if (status === 408) return new LlmError('timeout', 'The AI service timed out', true, error);
    return new LlmError('bad_request', `The AI service rejected the request (${status})`, false, error);
  }
  return new LlmError('unknown', error instanceof Error ? error.message : 'Unknown AI service error', false, error);
}
