import { ApiError, apiRequest, buildUrl, requestHeaders, toNetworkError, withTimeout } from './client';
import type { AgentEvent, ApiErrorBody, ChatRequest, ChatResponse } from './types';

const ASSISTANT_TIMEOUT_MS = 60_000;

/** Assistant replies come back as a ChatResponse even on 409/503 — surface them as answers. */
function asChatResponse(error: unknown): ChatResponse | null {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'answer' in error.body) {
    return error.body as ChatResponse;
  }
  return null;
}

export interface ChatResult {
  status: number;
  replayed: boolean;
  body: ChatResponse;
}

export const assistantApi = {
  /** Plain JSON endpoint (used for Confirm / Cancel, which run without the LLM). */
  async chat(request: ChatRequest, idempotencyKey: string): Promise<ChatResult> {
    try {
      const body = await apiRequest<ChatResponse>('/api/assistant/chat', {
        method: 'POST',
        body: request,
        idempotencyKey,
        timeoutMs: ASSISTANT_TIMEOUT_MS,
      });
      return { status: 200, replayed: false, body };
    } catch (error) {
      const chatBody = asChatResponse(error);
      if (chatBody) return { status: (error as ApiError).status, replayed: false, body: chatBody };
      throw error;
    }
  },

  /**
   * Streaming endpoint (Server-Sent Events over a POST). EventSource only supports GET, so we
   * read the body stream and parse `event:` / `data:` frames ourselves.
   */
  async chatStream(
    request: ChatRequest,
    idempotencyKey: string,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    let response: Response;
    try {
      response = await fetch(buildUrl('/api/assistant/chat/stream'), {
        method: 'POST',
        headers: { ...requestHeaders({ body: request, idempotencyKey }), Accept: 'text/event-stream' },
        body: JSON.stringify(request),
        signal: withTimeout(signal, ASSISTANT_TIMEOUT_MS),
      });
    } catch (error) {
      throw toNetworkError(error);
    }

    if (!response.ok || !response.body) {
      // Request-level errors (validation, rate limit) arrive as a normal JSON error envelope.
      const json = (await response.json().catch(() => null)) as { error?: ApiErrorBody } | null;
      throw new ApiError(response.status, json?.error ?? { code: `HTTP_${response.status}`, message: 'Assistant request failed' }, json);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let result: ChatResult | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'done') result = parsed.data as ChatResult;
          else if (parsed.event === 'error') {
            const { status, error } = parsed.data as { status: number; error: ApiErrorBody };
            throw new ApiError(status, error);
          } else onEvent(parsed.data as AgentEvent);
        }
      }
    } catch (error) {
      throw toNetworkError(error);
    }
    if (!result) throw new ApiError(0, { code: 'STREAM_INTERRUPTED', message: 'The connection closed before the assistant finished.' });
    return result;
  },
};

export function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}
