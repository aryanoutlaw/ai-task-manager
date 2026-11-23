import type { ApiErrorBody } from './types';

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 15_000;

/** Every failure the UI can see is an ApiError — network, timeout, HTTP or parse. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorBody['details'];
  readonly requestId?: string;
  /** Raw JSON body (the assistant returns a full ChatResponse even on 409/503). */
  readonly body?: unknown;

  constructor(status: number, error: ApiErrorBody, body?: unknown) {
    super(error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
    this.body = body;
  }

  get isNetworkError() {
    return this.status === 0;
  }

  /** Field -> message map for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.field, d.message]));
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** Sent as Idempotency-Key; reuse the same key when retrying the same logical request. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

export function requestHeaders(options: Pick<RequestOptions, 'body' | 'idempotencyKey' | 'headers'>): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    ...options.headers,
  };
}

export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function toNetworkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  return new ApiError(0, {
    code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
    message: timedOut ? 'The server took too long to respond.' : 'Could not reach the server. Check that the API is running.',
  });
}

/** The single fetch wrapper used by every API module. Components never call fetch directly. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: requestHeaders(options),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw toNetworkError(error);
  }

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, { code: 'BAD_RESPONSE', message: `Unexpected response from server (HTTP ${response.status})` });
    }
  }

  if (!response.ok) {
    const error = (json as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(
      response.status,
      { code: error?.code ?? `HTTP_${response.status}`, message: error?.message ?? `Request failed (HTTP ${response.status})`, details: error?.details, requestId: error?.requestId ?? response.headers.get('x-request-id') ?? undefined },
      json,
    );
  }
  return json as T;
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
