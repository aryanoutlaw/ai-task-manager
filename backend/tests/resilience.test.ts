import { describe, expect, it } from 'vitest';
import { CircuitBreaker, callLlmResiliently } from '../src/assistant/llm/resilience.js';
import { LlmError } from '../src/assistant/llm/types.js';
import { ScriptedLlm, reply } from './helpers.js';

const params = { model: 'x', max_tokens: 10, messages: [{ role: 'user' as const, content: 'hi' }] };

describe('CircuitBreaker', () => {
  it('opens after N availability failures, half-opens after the cool-down, closes on success', () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 1000, () => now);
    const outage = new LlmError('unavailable', 'down', true);
    breaker.recordFailure(outage);
    expect(breaker.state).toBe('closed');
    breaker.recordFailure(outage);
    expect(breaker.state).toBe('open');
    expect(() => breaker.acquire()).toThrow(/unavailable/);

    now = 1000;
    expect(breaker.state).toBe('half_open');
    breaker.acquire(); // the single trial call
    expect(() => breaker.acquire()).toThrow(); // no second concurrent trial
    breaker.recordSuccess();
    expect(breaker.state).toBe('closed');
  });

  it('ignores non-availability errors (a 400 is our bug, not an outage)', () => {
    const breaker = new CircuitBreaker(1, 1000);
    breaker.recordFailure(new LlmError('bad_request', 'bad', false));
    expect(breaker.state).toBe('closed');
  });
});

describe('callLlmResiliently', () => {
  it('retries retryable failures with backoff, then succeeds', async () => {
    const llm = new ScriptedLlm([
      () => {
        throw new LlmError('rate_limited', '429', true);
      },
      () => reply('ok'),
    ]);
    const delays: number[] = [];
    const message = await callLlmResiliently(llm, new CircuitBreaker(5, 1000), params, {
      deadline: Date.now() + 10_000,
      perCallTimeoutMs: 1000,
      maxRetries: 2,
      sleep: async (ms) => void delays.push(ms),
    });
    expect(message.content[0]).toMatchObject({ text: 'ok' });
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThanOrEqual(200);
  });

  it('does not retry non-retryable failures', async () => {
    const llm = new ScriptedLlm([
      () => {
        throw new LlmError('auth', 'bad key', false);
      },
    ]);
    await expect(
      callLlmResiliently(llm, new CircuitBreaker(5, 1000), params, { deadline: Date.now() + 5000, perCallTimeoutMs: 1000, maxRetries: 3 }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(llm.calls).toHaveLength(1);
  });

  it('never starts an attempt that cannot finish before the request deadline', async () => {
    const llm = new ScriptedLlm([() => reply('never')]);
    await expect(
      callLlmResiliently(llm, new CircuitBreaker(5, 1000), params, { deadline: Date.now() + 100, perCallTimeoutMs: 1000, maxRetries: 3 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(llm.calls).toHaveLength(0);
  });
});
