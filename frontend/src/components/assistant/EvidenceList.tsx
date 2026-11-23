import { BookOpen } from 'lucide-react';
import type { EvidenceItem } from '../../api/types';
import { cn } from '../../lib/cn';

/** Evidence chips: document title, section, relevance score bar and the matching snippet. */
export function EvidenceList({ evidence, threshold }: { evidence: EvidenceItem[]; threshold?: number }) {
  if (!evidence.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
        <BookOpen className="size-3" /> Sources
      </p>
      <ol className="space-y-1.5">
        {evidence.map((e, i) => (
          <li key={e.id} id={`evidence-${i + 1}`} className="group rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200/70 dark:bg-zinc-800/50 dark:ring-zinc-700/60">
            <div className="flex items-center gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200" title={e.id}>
                {e.title} <span className="text-zinc-400">› {e.section}</span>
              </span>
              <ScorePill score={e.score} threshold={threshold} />
            </div>
            <p className="mt-1 line-clamp-2 pl-6 text-[11.5px] leading-relaxed text-zinc-500 italic dark:text-zinc-400">“{e.snippet}”</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ScorePill({ score, threshold }: { score: number; threshold?: number }) {
  const pct = Math.min(100, Math.round(score * 100));
  const strong = score >= 0.4;
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`Cosine similarity ${score.toFixed(3)}${threshold !== undefined ? ` (threshold ${threshold})` : ''}`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span className={cn('block h-full rounded-full', strong ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-zinc-500">{score.toFixed(2)}</span>
    </span>
  );
}
