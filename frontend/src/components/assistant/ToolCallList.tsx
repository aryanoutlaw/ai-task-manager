import { useState } from 'react';
import { Ban, CheckCircle2, ChevronRight, Clock3, Copy, Wrench, XCircle } from 'lucide-react';
import type { ToolCallRecord } from '../../api/types';
import { cn } from '../../lib/cn';
import { TOOL_LABEL } from '../../lib/labels';

const statusMeta = {
  success: { icon: CheckCircle2, className: 'text-emerald-500', label: 'Succeeded' },
  error: { icon: XCircle, className: 'text-rose-500', label: 'Failed' },
  pending_confirmation: { icon: Clock3, className: 'text-amber-500', label: 'Awaiting confirmation' },
  cancelled: { icon: Ban, className: 'text-zinc-400', label: 'Cancelled' },
} as const;

/** Collapsible audit trail of tool calls: name, arguments, and result or error. */
export function ToolCallList({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
        <Wrench className="size-3" /> Tool calls
      </p>
      <ul className="space-y-1.5">
        {calls.map((call) => <ToolCallItem key={call.id} call={call} />)}
      </ul>
    </div>
  );
}

function ToolCallItem({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const meta = statusMeta[call.status];
  const Icon = meta.icon;
  const args = summarizeArgs(call.arguments);
  return (
    <li className="overflow-hidden rounded-xl ring-1 ring-zinc-200/70 dark:ring-zinc-700/60">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800">
        <Icon className={cn('size-3.5 shrink-0', meta.className)} aria-label={meta.label} />
        <span className="font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">{args}</span>
        {call.deduplicated && <span className="rounded bg-zinc-200 px-1 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">dedup</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 text-zinc-400 transition-transform', open && 'rotate-90')} />
      </button>
      {call.status === 'error' && call.error && !open && (
        <p className="border-t border-rose-100 bg-rose-50/60 px-3 py-1.5 text-[11.5px] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/5 dark:text-rose-300">
          <span className="font-mono font-semibold">{call.error.code}</span> — {call.error.message}
        </p>
      )}
      {open && (
        <div className="space-y-2 border-t border-zinc-200/70 bg-white p-3 dark:border-zinc-700/60 dark:bg-zinc-900">
          <JsonBlock label={`${TOOL_LABEL[call.name] ?? call.name} · arguments`} value={call.arguments} />
          <JsonBlock label={call.status === 'error' ? 'error' : 'result'} value={call.status === 'error' ? call.error : call.result} tone={call.status === 'error' ? 'error' : 'default'} />
          <p className="text-[10.5px] text-zinc-400">{meta.label} · {call.durationMs} ms</p>
        </div>
      )}
    </li>
  );
}

function JsonBlock({ label, value, tone = 'default' }: { label: string; value: unknown; tone?: 'default' | 'error' }) {
  const json = JSON.stringify(value ?? null, null, 2);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10.5px] font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(json)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600" aria-label={`Copy ${label}`}>
          <Copy className="size-3" />
        </button>
      </div>
      <pre className={cn('scrollbar-thin max-h-48 overflow-auto rounded-lg p-2.5 font-mono text-[11px] leading-relaxed', tone === 'error' ? 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200' : 'bg-zinc-50 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300')}>
        {json}
      </pre>
    </div>
  );
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}
