import { createHash } from 'node:crypto';
import { UnprocessableError } from './errors.js';
import { stableStringify } from './stableStringify.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

type Entry =
  | { state: 'in_flight'; fingerprint: string; expiresAt: number; promise: Promise<StoredResponse> }
  | { state: 'completed'; fingerprint: string; expiresAt: number; response: StoredResponse };

export interface IdempotencyResult {
  response: StoredResponse;
  replayed: boolean;
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,255}$/;

export function fingerprint(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? null)).digest('hex');
}

/**
 * Idempotency-key store (in-memory, per process).
 *
 * Guarantees, for a given scoped key:
 *  1. The producer runs at most once while the entry is alive (TTL).
 *  2. Concurrent duplicates (double-click) await the *same* in-flight promise instead of racing.
 *     The check-and-set below is synchronous, so it is race-free on Node's single thread.
 *  3. Completed responses (< 500) are replayed byte-for-byte.
 *  4. Reusing a key with a *different* body is rejected (422) — it is a client bug, not a retry.
 *  5. Failures (thrown errors / 5xx) are NOT cached, so a genuine retry can succeed later. This is
 *     safe because our handlers only return 5xx when no write was committed.
 *
 * In a multi-instance deployment this would move to Redis (SET NX + TTL) with the same contract.
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(
    scopedKey: string,
    requestFingerprint: string,
    producer: () => Promise<StoredResponse>,
  ): Promise<IdempotencyResult> {
    this.evictExpired();
    const existing = this.entries.get(scopedKey);

    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new UnprocessableError(
          'This Idempotency-Key was already used with a different request body. Generate a new key for a new request.',
          'IDEMPOTENCY_KEY_REUSED',
        );
      }
      const response = existing.state === 'completed' ? existing.response : await existing.promise;
      return { response, replayed: true };
    }

    const promise = Promise.resolve().then(producer);
    this.entries.set(scopedKey, {
      state: 'in_flight',
      fingerprint: requestFingerprint,
      expiresAt: this.now() + this.ttlMs,
      promise,
    });
    this.enforceCapacity();

    try {
      const response = await promise;
      if (response.status >= 500) {
        this.entries.delete(scopedKey);
      } else {
        this.entries.set(scopedKey, {
          state: 'completed',
          fingerprint: requestFingerprint,
          expiresAt: this.now() + this.ttlMs,
          response,
        });
      }
      return { response, replayed: false };
    } catch (error) {
      this.entries.delete(scopedKey);
      throw error;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.state === 'completed' && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  /** Bounded memory: drop the oldest completed entries first (Map preserves insertion order). */
  private enforceCapacity(): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      if (entry.state === 'completed') this.entries.delete(key);
    }
  }
}
