/**
 * Threshold calibration: scores a labelled query set against the real KB and reports
 *  - top score + top doc for every query,
 *  - the separation margin between in-scope and out-of-scope queries,
 *  - accuracy for a sweep of candidate thresholds.
 * Run: npm run kb:calibrate
 */
import { createRetriever } from '../src/assistant/knowledge/index.js';
import { CALIBRATION_SET } from './calibration-set.js';

const retriever = createRetriever();
const rows = CALIBRATION_SET.map(({ query, expect }) => {
  const res = retriever.search(query, { threshold: 0, relativeCutoff: 0, topK: 3 });
  const top = res.passed[0];
  return { query, expect, topDoc: top?.chunk.docId ?? '-', topChunk: top?.chunk.id ?? '-', score: top?.score ?? 0, coverage: res.queryCoverage };
});

console.log('\n| Query | Expected | Top chunk | Score |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.query} | ${r.expect ?? '_out of scope_'} | ${r.topChunk} | ${r.score.toFixed(3)} |`);

const inScope = rows.filter((r) => r.expect);
const outScope = rows.filter((r) => !r.expect);
const minIn = Math.min(...inScope.map((r) => r.score));
const maxOut = Math.max(...outScope.map((r) => r.score));
const wrongDoc = inScope.filter((r) => r.topDoc !== r.expect);

console.log(`\nIn-scope   : min ${minIn.toFixed(3)}  (n=${inScope.length})`);
console.log(`Out-of-scope: max ${maxOut.toFixed(3)}  (n=${outScope.length})`);
console.log(`Margin      : ${(minIn - maxOut).toFixed(3)}  -> midpoint ${((minIn + maxOut) / 2).toFixed(3)}`);
if (wrongDoc.length) console.log(`Top-1 misses: ${wrongDoc.map((r) => `"${r.query}" -> ${r.topDoc}`).join('; ')}`);

console.log('\n| Threshold | In-scope recall | Out-of-scope rejection | Accuracy |');
console.log('|---|---|---|---|');
for (let t = 0.1; t <= 0.4001; t += 0.025) {
  const recall = inScope.filter((r) => r.score >= t && r.topDoc === r.expect).length / inScope.length;
  const reject = outScope.filter((r) => r.score < t).length / outScope.length;
  const acc = (recall * inScope.length + reject * outScope.length) / rows.length;
  console.log(`| ${t.toFixed(3)} | ${(recall * 100).toFixed(0)}% | ${(reject * 100).toFixed(0)}% | ${(acc * 100).toFixed(0)}% |`);
}
