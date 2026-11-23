import { useCallback, useEffect, useRef, useState } from 'react';
import { assistantApi, type ChatResult } from '../api/assistant';
import { ApiError, newIdempotencyKey } from '../api/client';
import type { AgentEvent, ChatResponse } from '../api/types';
import { TOOL_LABEL } from '../lib/labels';

export interface ProgressStep {
  id: string;
  kind: 'kb' | 'tool';
  label: string;
  status: 'running' | 'done' | 'error' | 'waiting';
  detail?: string;
}

export type ConfirmationState = 'pending' | 'confirming' | 'cancelling' | 'confirmed' | 'cancelled' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  state?: 'streaming' | 'done' | 'error';
  statusText?: string;
  steps?: ProgressStep[];
  response?: ChatResponse;
  httpStatus?: number;
  /** Transport-level failure (network, rate limit…). Retry re-sends with the SAME idempotency key. */
  failure?: { code: string; message: string; retry?: { message: string; idempotencyKey: string } };
  confirmation?: ConfirmationState;
}

const STORAGE_KEY = 'assistant-session-v1';

function loadSession(): { messages: ChatMessage[]; conversationId: string | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], conversationId: null };
    const parsed = JSON.parse(raw) as { messages: ChatMessage[]; conversationId: string | null };
    // A reload interrupts any in-flight stream.
    parsed.messages = parsed.messages.map((m) =>
      m.state === 'streaming' ? { ...m, state: 'error', failure: { code: 'INTERRUPTED', message: 'Interrupted by a page reload.' } } : m,
    );
    return parsed;
  } catch {
    return { messages: [], conversationId: null };
  }
}

const uid = () => crypto.randomUUID();

/**
 * Chat state machine for the assistant panel.
 *  - Streams progress (KB searches, tool calls, text) from the SSE endpoint.
 *  - Every send gets an Idempotency-Key; "Retry" after a network error re-uses it, so a request
 *    that actually reached the server is replayed, never executed twice.
 *  - Confirm/Cancel resolve a pending destructive action through a second, explicit request.
 */
export function useAssistant(options: { onTasksChanged?: (response: ChatResponse) => void } = {}) {
  const [{ messages, conversationId }, setSession] = useState(loadSession);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onTasksChangedRef = useRef(options.onTasksChanged);
  onTasksChangedRef.current = options.onTasksChanged;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-50), conversationId }));
    } catch {
      /* storage full / private mode */
    }
  }, [messages, conversationId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback((id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
    setSession((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)) }));
  }, []);

  const applyResult = useCallback(
    (assistantId: string, result: ChatResult) => {
      const { body } = result;
      update(assistantId, (m) => ({
        state: body.error && result.status >= 500 ? 'error' : 'done',
        content: body.answer,
        response: body,
        httpStatus: result.status,
        statusText: undefined,
        confirmation: body.needsConfirmation ? 'pending' : undefined,
        steps: (m.steps ?? []).map((s) => (s.status === 'running' ? { ...s, status: 'done' } : s)),
      }));
      setSession((s) => ({ ...s, conversationId: body.conversationId }));
      if (body.meta.tasksChanged) onTasksChangedRef.current?.(body);
    },
    [update],
  );

  const handleEvent = useCallback(
    (assistantId: string, event: AgentEvent) => {
      switch (event.type) {
        case 'status':
          update(assistantId, () => ({ statusText: event.message }));
          break;
        case 'text_delta':
          update(assistantId, (m) => ({ content: m.content + event.text }));
          break;
        case 'text_reset':
          update(assistantId, () => ({ content: '' }));
          break;
        case 'kb_search':
          update(assistantId, (m) => ({
            steps: [
              ...(m.steps ?? []),
              {
                id: uid(),
                kind: 'kb',
                label: `Searched knowledge base: “${event.query}”`,
                status: event.passed ? 'done' : 'error',
                detail: event.passed
                  ? `${event.passed} passage${event.passed > 1 ? 's' : ''} above threshold (top ${event.topScore?.toFixed(2)})`
                  : `Nothing above threshold${event.topScore !== null ? ` (best ${event.topScore.toFixed(2)})` : ''}`,
              },
            ],
          }));
          break;
        case 'tool_start':
          update(assistantId, (m) => ({
            steps: [...(m.steps ?? []), { id: event.id, kind: 'tool', label: TOOL_LABEL[event.name] ?? event.name, status: 'running' }],
          }));
          break;
        case 'tool_end':
          update(assistantId, (m) => ({
            steps: (m.steps ?? []).map((s) =>
              s.id === event.call.id
                ? {
                    ...s,
                    status: event.call.status === 'error' ? 'error' : event.call.status === 'pending_confirmation' ? 'waiting' : 'done',
                    detail: event.call.error?.message ?? (event.call.status === 'pending_confirmation' ? 'Awaiting your confirmation' : undefined),
                  }
                : s,
            ),
          }));
          break;
      }
    },
    [update],
  );

  const run = useCallback(
    async (text: string, idempotencyKey: string, assistantId: string) => {
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await assistantApi.chatStream(
          { message: text, confirm: false, pendingActionId: null, conversationId },
          idempotencyKey,
          (event) => handleEvent(assistantId, event),
          controller.signal,
        );
        applyResult(assistantId, result);
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError(0, { code: 'UNKNOWN', message: 'Something went wrong.' });
        const retryable = apiError.isNetworkError || apiError.status === 429 || apiError.status >= 500;
        update(assistantId, () => ({
          state: 'error',
          statusText: undefined,
          content: '',
          httpStatus: apiError.status,
          failure: {
            code: apiError.code,
            message: apiError.message,
            ...(retryable ? { retry: { message: text, idempotencyKey } } : {}),
          },
        }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [applyResult, conversationId, handleEvent, update],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      const assistantId = uid();
      setSession((s) => ({
        ...s,
        messages: [
          ...s.messages,
          { id: uid(), role: 'user', content: text, createdAt: Date.now() },
          { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), state: 'streaming', statusText: 'Thinking…', steps: [] },
        ],
      }));
      void run(text, newIdempotencyKey('chat'), assistantId);
    },
    [busy, run],
  );

  const retry = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      const retryInfo = message?.failure?.retry;
      if (!retryInfo || busy) return;
      update(messageId, () => ({ state: 'streaming', failure: undefined, statusText: 'Retrying…', steps: [], content: '' }));
      void run(retryInfo.message, retryInfo.idempotencyKey, messageId);
    },
    [busy, messages, run, update],
  );

  const resolveConfirmation = useCallback(
    async (messageId: string, confirm: boolean) => {
      const message = messages.find((m) => m.id === messageId);
      const pending = message?.response?.needsConfirmation;
      if (!pending || message.confirmation !== 'pending') return;
      update(messageId, () => ({ confirmation: confirm ? 'confirming' : 'cancelling' }));
      const replyId = uid();
      try {
        // One key per confirmation: a double-click or retry replays instead of re-executing.
        const result = await assistantApi.chat(
          { message: '', confirm, pendingActionId: pending.pendingActionId, conversationId },
          `confirm-${pending.pendingActionId}-${confirm ? 'yes' : 'no'}`,
        );
        const ok = result.status === 200;
        update(messageId, () => ({ confirmation: ok ? (confirm ? 'confirmed' : 'cancelled') : 'failed' }));
        setSession((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { id: replyId, role: 'assistant', content: result.body.answer, createdAt: Date.now(), state: ok ? 'done' : 'error', response: result.body, httpStatus: result.status },
          ],
        }));
        if (result.body.meta.tasksChanged) onTasksChangedRef.current?.(result.body);
      } catch (error) {
        update(messageId, () => ({ confirmation: 'pending' }));
        const apiError = error instanceof ApiError ? error : null;
        setSession((s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: replyId,
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              state: 'error',
              failure: { code: apiError?.code ?? 'UNKNOWN', message: apiError?.message ?? 'Could not reach the server.' },
            },
          ],
        }));
      }
    },
    [conversationId, messages, update],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSession({ messages: [], conversationId: null });
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, busy, send, retry, resolveConfirmation, reset, stop };
}
