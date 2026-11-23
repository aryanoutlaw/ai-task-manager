import { describe, expect, it } from 'vitest';
import { createRetriever, makeSnippet } from '../src/assistant/knowledge/index.js';
import { env } from '../src/config/env.js';
import { tokenize } from '../src/assistant/knowledge/textProcessing.js';
import { CALIBRATION_SET } from '../scripts/calibration-set.js';

const retriever = createRetriever();
const options = { threshold: env.KB_RELEVANCE_THRESHOLD, relativeCutoff: env.KB_RELATIVE_CUTOFF, topK: env.KB_TOP_K };

describe('knowledge base retrieval', () => {
  it('loads at least 5 documents split into section chunks', () => {
    expect(retriever.size).toBeGreaterThanOrEqual(5);
    expect(retriever.getChunk('priority-levels#medium-versus-high')).toBeDefined();
  });

  // Regression guard: editing the KB or the tokenizer must not break the calibrated separation.
  it.each(CALIBRATION_SET.filter((c) => c.expect))('answers in-scope query: $query', ({ query, expect: doc }) => {
    const res = retriever.search(query, options);
    expect(res.passed[0]?.chunk.docId).toBe(doc);
    expect(res.passed[0]!.score).toBeGreaterThanOrEqual(options.threshold);
  });

  it.each(CALIBRATION_SET.filter((c) => !c.expect))('rejects out-of-scope query: $query', ({ query }) => {
    expect(retriever.search(query, options).passed).toHaveLength(0);
  });

  it('penalises out-of-vocabulary terms (refund policy must not collapse to "policy")', () => {
    const policyOnly = retriever.search('deletion policy', options);
    const refund = retriever.search('refund policy', { ...options, threshold: 0 });
    expect(policyOnly.passed[0]!.score).toBeGreaterThan(0.3);
    expect(refund.passed[0]?.score ?? 0).toBeLessThan(options.threshold);
    expect(refund.queryCoverage).toBeLessThan(1);
  });

  it('applies the relative cutoff so weak "also-ran" chunks are not returned as evidence', () => {
    const res = retriever.search('What is the difference between medium and high priority?', options);
    const top = res.passed[0]!.score;
    for (const r of res.passed) expect(r.score).toBeGreaterThanOrEqual(top * options.relativeCutoff);
    expect(res.passed.length).toBeLessThanOrEqual(options.topK);
  });

  it('canonicalises synonyms on both sides (urgent -> high, deadline -> due)', () => {
    expect(tokenize('urgent critical blocker')).toEqual(['high', 'high', 'high']);
    expect(tokenize('deadline')).toEqual(tokenize('due'));
    expect(tokenize('remove erase')).toEqual(tokenize('delete deletion'));
    expect(retriever.search('missed deadline', options).passed[0]?.chunk.docId).toBe('due-dates-and-overdue');
  });

  it('builds snippets from the most relevant sentence', () => {
    const chunk = retriever.getChunk('due-dates-and-overdue#when-a-task-is-overdue')!;
    expect(makeSnippet(chunk.text, 'are tasks due today overdue yet')).toBe('Tasks due today are not overdue yet.');
  });

  it('returns nothing for empty / stopword-only queries', () => {
    expect(retriever.search('what is the', options).passed).toHaveLength(0);
  });
});
