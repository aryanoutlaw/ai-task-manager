import { stemmer } from 'stemmer';

/**
 * Lexical normalisation shared by indexing and querying (they MUST use the same pipeline).
 *  lowercase -> split -> drop stopwords -> Porter stem -> canonicalise synonyms
 */

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below
  between both but by can could did do does doing down during each few for from further had has have
  having he her here hers herself him himself his how i if in into is it its itself just me more most my
  myself no nor not now of off on once only or other our ours ourselves out over own same she should so
  some such than that the their theirs them themselves then there these they this those through to too
  under until up very was we were what when where which while who whom why will with would you your
  yours yourself yourselves tell please explain mean means meaning define definition us let know
  task tasks here team`.split(/\s+/),
);
// Note: "task"/"team" are stopwords because every document is about team tasks — they carry no
// discriminative signal and would otherwise inflate scores for off-topic questions like
// "what is the team's refund policy?".

/**
 * Synonyms are mapped to ONE canonical stem on both the document and the query side (instead of
 * expanding the query). Expansion would inflate the query vector and distort cosine scores.
 */
const CANONICAL: Record<string, string> = {
  urgent: 'high', critic: 'high', blocker: 'high', block: 'high', asap: 'high',
  deadlin: 'due', late: 'overdu', overdu: 'overdu',
  remov: 'delet', eras: 'delet', erase: 'delet', delet: 'delet', discard: 'delet',
  done: 'complet', finish: 'complet', close: 'complet', complet: 'complet',
  todo: 'pend', backlog: 'pend',
  wip: 'progress', ongo: 'progress',
  bot: 'assist', ai: 'assist', chatbot: 'assist',
  name: 'titl', headlin: 'titl',
  prioriti: 'prioriti', importance: 'prioriti', import: 'prioriti', sever: 'prioriti', urgenc: 'prioriti',
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/in_progress/g, 'in progress')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map((t) => {
      const stem = stemmer(t);
      return CANONICAL[stem] ?? CANONICAL[t] ?? stem;
    });
}

export function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}
