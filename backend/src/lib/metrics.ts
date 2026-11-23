import type { RequestHandler } from 'express';
import type { ChatResponse } from '../assistant/types.js';

/**
 * Minimal in-process metrics (counters + latency percentiles), exposed at GET /api/metrics.
 * In production these would be Prometheus/OpenTelemetry instruments with the same names; the
 * point here is that the signals from the design note (hallucination, retrieval quality, tool
 * failures, latency) are actually emitted by the running system.
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly samples = new Map<string, number[]>();
  private readonly startedAt = Date.now();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, value: number, maxSamples = 1000): void {
    const list = this.samples.get(name) ?? [];
    list.push(value);
    if (list.length > maxSamples) list.shift();
    this.samples.set(name, list);
  }

  recordAssistantTurn(body: ChatResponse, status: number): void {
    this.increment('assistant_turns_total');
    this.increment(`assistant_route_${body.route}`);
    this.increment(`assistant_status_${status}`);
    this.observe('assistant_latency_ms', body.meta.latencyMs);
    this.observe('assistant_llm_calls', body.meta.llmCalls);
    this.increment('llm_input_tokens', body.meta.usage.inputTokens);
    this.increment('llm_output_tokens', body.meta.usage.outputTokens);
    if (body.meta.degraded) this.increment('assistant_degraded_total');
    if (body.meta.groundingWarnings.length) this.increment('assistant_grounding_warnings_total', body.meta.groundingWarnings.length);
    if (body.needsConfirmation) this.increment('assistant_confirmations_requested');
    for (const r of body.meta.retrieval) {
      this.increment('kb_searches_total');
      if (r.passed.length === 0) this.increment('kb_searches_no_result');
      this.observe('kb_top_score', r.passed[0]?.score ?? r.rejected[0]?.score ?? 0);
    }
    for (const call of body.toolCalls) {
      this.increment(`tool_${call.name}_${call.status}`);
      if (call.status === 'error') this.increment('tool_errors_total');
      if (call.deduplicated) this.increment('tool_duplicate_writes_blocked');
    }
  }

  httpMiddleware(): RequestHandler {
    return (req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        this.increment(`http_${Math.floor(res.statusCode / 100)}xx`);
        this.observe('http_latency_ms', Number(process.hrtime.bigint() - start) / 1e6);
        if (res.getHeader('Idempotent-Replayed')) this.increment('idempotent_replays_total');
      });
      next();
    };
  }

  snapshot() {
    const summaries = Object.fromEntries(
      [...this.samples.entries()].map(([name, values]) => [name, summarize(values)]),
    );
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries([...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
      summaries,
    };
  }
}

function summarize(values: number[]) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { count: values.length, p50: round(pct(50)), p95: round(pct(95)), max: round(sorted.at(-1)!) };
}
