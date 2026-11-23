import { Fragment, type ReactNode } from 'react';
import type { EvidenceItem } from '../../api/types';

interface RichTextProps {
  text: string;
  evidence: EvidenceItem[];
  onOpenTask?: (id: number) => void;
}

/**
 * Tiny, dependency-free renderer for assistant answers:
 *  - paragraphs, "-", "*", "•" and numbered lists, **bold**, `code`
 *  - [doc#section] citations -> numbered chips that match the evidence list
 *  - #123 task references -> buttons that open the task drawer
 * Text is rendered as React nodes (never innerHTML), so model output cannot inject markup.
 */
export function RichText({ text, evidence, onOpenTask }: RichTextProps) {
  const citationIndex = new Map(evidence.map((e, i) => [e.id, i + 1]));
  for (const e of evidence) if (!citationIndex.has(e.docId)) citationIndex.set(e.docId, evidence.indexOf(e) + 1);

  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={list.ordered ? 'list-decimal space-y-1 pl-5' : 'space-y-1 pl-1'}>
        {list.items.map((item, i) => (
          <li key={i} className={list!.ordered ? '' : "relative pl-4 before:absolute before:top-[0.6em] before:left-0 before:size-1.5 before:rounded-full before:bg-zinc-300 before:content-[''] dark:before:bg-zinc-600"}>
            {inline(item, citationIndex, onOpenTask)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold text-zinc-900 dark:text-white">{inline(heading[1]!, citationIndex, onOpenTask)}</p>
      ) : (
        <p key={blocks.length}>{inline(line, citationIndex, onOpenTask)}</p>
      ),
    );
  }
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[a-z0-9][a-z0-9-]*(?:#[a-z0-9-]+)?\]|#\d{1,7}\b)/g;

function inline(text: string, citations: Map<string, number>, onOpenTask?: (id: number) => void): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-zinc-900 dark:text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">{part.slice(1, -1)}</code>;
    if (part.startsWith('[') && part.endsWith(']')) {
      const id = part.slice(1, -1);
      const n = citations.get(id);
      if (!n) return <Fragment key={i}>{part}</Fragment>;
      return (
        <sup key={i}>
          <a href={`#evidence-${n}`} title={id} className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-700 no-underline hover:bg-brand-200 dark:bg-brand-500/20 dark:text-brand-200">
            {n}
          </a>
        </sup>
      );
    }
    if (/^#\d+$/.test(part) && onOpenTask) {
      const id = Number(part.slice(1));
      return (
        <button key={i} type="button" onClick={() => onOpenTask(id)} className="rounded px-0.5 font-mono text-[0.92em] font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10" title={`Open task ${id}`}>
          {part}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
