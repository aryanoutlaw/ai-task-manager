import type Anthropic from '@anthropic-ai/sdk';

export interface LlmCallOptions {
  signal: AbortSignal;
  /** Called with incremental text as the model writes it (streaming UX). */
  onTextDelta?: (text: string) => void;
}

/**
 * The agent depends on this port, not on the SDK, so tests can drive the full agent loop with a
 * scripted fake and no network. The request/response types are the SDK's own (no re-invented shapes).
 */
export interface LlmClient {
  readonly model: string;
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: LlmCallOptions): Promise<Anthropic.Message>;
}

export type LlmFailureKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'auth'
  | 'bad_request'
  | 'aborted'
  | 'not_configured'
  | 'circuit_open'
  | 'unknown';

/** Normalised LLM failure: the agent reasons about *kinds* of failure, never SDK classes. */
export class LlmError extends Error {
  constructor(
    public readonly kind: LlmFailureKind,
    message: string,
    public readonly retryable: boolean,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
