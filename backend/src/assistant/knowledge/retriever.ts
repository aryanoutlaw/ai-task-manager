import type { KnowledgeChunk, KnowledgeDocument } from './loader.js';
import { termFrequencies, tokenize } from './textProcessing.js';

export interface RetrievalOptions {
  /** Absolute minimum cosine similarity for a chunk to count as evidence. */
  threshold: number;
  /** Drop chunks scoring below `relativeCutoff * topScore` (filters "also-ran" documents). */
  relativeCutoff: number;
  topK: number;
}

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
}

export interface RetrievalResult {
  query: string;
  /** Chunks that passed every filter — the only text the LLM is allowed to ground on. */
  passed: ScoredChunk[];
  /** Best candidates that were rejected, kept for transparency / threshold tuning. */
  rejected: Array<ScoredChunk & { reason: 'below_threshold' | 'below_relative_cutoff' | 'beyond_top_k' }>;
  /** Fraction of query terms (after normalisation) that exist anywhere in the KB vocabulary. */
  queryCoverage: number;
}

type SparseVector = Map<string, number>;

/**
 * TF-IDF + cosine similarity retriever over section-level chunks.
 *
 * Why TF-IDF cosine (not BM25 / embeddings) — see README "Retrieval":
 *  - scores are bounded in [0, 1], so ONE threshold is meaningful across short and long queries
 *    (raw BM25 scores are unbounded and depend on query length, making a fixed threshold brittle);
 *  - zero infra, deterministic, instant, explainable score-by-score in the interview;
 *  - the corpus is ~25 short sections, where lexical matching + synonym canonicalisation is enough.
 *
 * Out-of-vocabulary handling: query terms the KB has never seen still count toward the query's
 * vector length (weighted with the maximum IDF). So "what is our refund policy?" cannot shrink to
 * just "policy" and score highly against the deletion policy — the unknown "refund" drags the
 * similarity down, which is exactly the signal we want for "cannot verify".
 */
export class TfIdfRetriever {
  private readonly chunks: KnowledgeChunk[];
  private readonly vectors: SparseVector[];
  private readonly idf = new Map<string, number>();
  private readonly maxIdf: number;

  constructor(documents: KnowledgeDocument[]) {
    this.chunks = documents.flatMap((d) => d.chunks);
    const tokenLists = this.chunks.map((c) =>
      // Section heading and doc title are repeated to weight them above body text.
      tokenize(`${c.docTitle} ${c.section} ${c.section} ${c.tags.join(' ')} ${c.text}`),
    );

    const df = new Map<string, number>();
    for (const tokens of tokenLists) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);

    const n = this.chunks.length;
    for (const [term, count] of df) this.idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
    this.maxIdf = Math.log(n + 1) + 1;

    this.vectors = tokenLists.map((tokens) => this.vectorize(termFrequencies(tokens), false));
  }

  get size(): number {
    return this.chunks.length;
  }

  getChunk(id: string): KnowledgeChunk | undefined {
    return this.chunks.find((c) => c.id === id);
  }

  search(query: string, options: RetrievalOptions): RetrievalResult {
    const tokens = tokenize(query);
    const known = tokens.filter((t) => this.idf.has(t)).length;
    const queryCoverage = tokens.length ? known / tokens.length : 0;
    if (tokens.length === 0) return { query, passed: [], rejected: [], queryCoverage };

    const qVec = this.vectorize(termFrequencies(tokens), true);
    const ranked: ScoredChunk[] = this.vectors
      .map((vec, i) => ({ chunk: this.chunks[i]!, score: round(cosine(qVec, vec)) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const top = ranked[0]?.score ?? 0;
    const passed: ScoredChunk[] = [];
    const rejected: RetrievalResult['rejected'] = [];
    for (const r of ranked.slice(0, Math.max(options.topK + 2, 5))) {
      if (r.score < options.threshold) rejected.push({ ...r, reason: 'below_threshold' });
      else if (r.score < top * options.relativeCutoff) rejected.push({ ...r, reason: 'below_relative_cutoff' });
      else if (passed.length >= options.topK) rejected.push({ ...r, reason: 'beyond_top_k' });
      else passed.push(r);
    }
    return { query, passed, rejected, queryCoverage: round(queryCoverage) };
  }

  /** Sublinear TF (1 + ln tf) x IDF, L2-normalised. Query OOV terms get maxIdf (see class doc). */
  private vectorize(tf: Map<string, number>, isQuery: boolean): SparseVector {
    const vec: SparseVector = new Map();
    let norm = 0;
    for (const [term, count] of tf) {
      const idf = this.idf.get(term) ?? (isQuery ? this.maxIdf : 0);
      const weight = (1 + Math.log(count)) * idf;
      if (weight === 0) continue;
      vec.set(term, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [term, w] of vec) vec.set(term, w / norm);
    return vec;
  }
}

function cosine(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, w] of small) dot += w * (large.get(term) ?? 0);
  return dot;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Picks the most query-relevant sentence(s) of a chunk for a short evidence snippet. */
export function makeSnippet(text: string, query: string, maxLength = 220): string {
  const queryTerms = new Set(tokenize(query));
  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  let best = sentences[0] ?? text;
  let bestScore = -1;
  for (const sentence of sentences) {
    const score = tokenize(sentence).filter((t) => queryTerms.has(t)).length;
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return best.length > maxLength ? `${best.slice(0, maxLength - 1).trimEnd()}…` : best;
}
