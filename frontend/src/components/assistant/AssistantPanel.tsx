import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Sparkles, X } from 'lucide-react';
import { systemApi } from '../../api/system';
import type { ChatResponse } from '../../api/types';
import { useAssistant } from '../../hooks/useAssistant';
import { cn } from '../../lib/cn';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';
import { SuggestedPrompts } from './SuggestedPrompts';

interface AssistantPanelProps {
  onTasksChanged: (response: ChatResponse) => void;
  onOpenTask: (id: number) => void;
  /** Mobile sheet close button. */
  onClose?: () => void;
  className?: string;
}

export function AssistantPanel({ onTasksChanged, onOpenTask, onClose, className }: AssistantPanelProps) {
  const { messages, busy, send, retry, resolveConfirmation, reset, stop } = useAssistant({ onTasksChanged });
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => systemApi.health(signal), refetchInterval: 30_000 });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view while streaming.
  const last = messages.at(-1);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, last?.content, last?.steps?.length, last?.state]);

  const assistant = health.data?.assistant;
  const status = !health.data
    ? { label: health.isError ? 'API offline' : 'Connecting…', dot: health.isError ? 'bg-rose-500' : 'bg-zinc-400' }
    : !assistant?.configured
      ? { label: 'Not configured', dot: 'bg-amber-500' }
      : assistant.circuit === 'open'
        ? { label: 'AI service down', dot: 'bg-rose-500' }
        : { label: assistant.model ?? 'Online', dot: 'bg-emerald-500' };

  return (
    <section className={cn('flex h-full min-h-0 flex-col bg-zinc-50 dark:bg-zinc-950', className)} aria-label="AI assistant">
      <header className="flex items-center gap-3 border-b border-zinc-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Assistant</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className={cn('size-1.5 rounded-full', status.dot)} />
            <span className="truncate">{status.label}</span>
            {assistant?.forceToolFailure && <span className="rounded bg-rose-100 px-1 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">tool failure on</span>}
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={reset} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="New conversation" aria-label="New conversation">
            <RotateCcw className="size-4" />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label="Close assistant">
            <X className="size-5" />
          </button>
        )}
      </header>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <SuggestedPrompts onPick={send} />
        ) : (
          <div className="space-y-5">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} threshold={assistant?.relevanceThreshold} onRetry={retry} onResolve={resolveConfirmation} onOpenTask={onOpenTask} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200/80 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ChatInput busy={busy} onSend={send} onStop={stop} />
        <p className="mt-1.5 text-center text-[10.5px] text-zinc-400">Enter to send · Shift+Enter for a new line · Deletes always ask for confirmation</p>
      </div>
    </section>
  );
}
