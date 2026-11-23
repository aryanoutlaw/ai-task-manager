import { AlertTriangle, BookOpen, CircleAlert, CircleCheck, Clock3, Loader2, RotateCw, Sparkles, Wrench } from 'lucide-react';
import type { AssistantRoute } from '../../api/types';
import type { ChatMessage as Message, ProgressStep } from '../../hooks/useAssistant';
import { cn } from '../../lib/cn';
import { ROUTE_LABEL } from '../../lib/labels';
import { Badge, type Tone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmationCard } from './ConfirmationCard';
import { EvidenceList } from './EvidenceList';
import { RichText } from './RichText';
import { ToolCallList } from './ToolCallList';

interface Props {
  message: Message;
  threshold?: number;
  onRetry: (id: string) => void;
  onResolve: (id: string, confirm: boolean) => void;
  onOpenTask: (id: number) => void;
}

const routeTone: Record<AssistantRoute, Tone> = { kb: 'brand', tool: 'sky', both: 'violet', none: 'neutral' };
const routeIcon: Record<AssistantRoute, typeof BookOpen> = { kb: BookOpen, tool: Wrench, both: Sparkles, none: CircleAlert };

export function ChatMessage({ message, threshold, onRetry, onResolve, onOpenTask }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-slide-up justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm leading-relaxed text-white shadow-sm shadow-brand-600/20 whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }

  const { response, failure } = message;
  const streaming = message.state === 'streaming';
  const RouteIcon = response ? routeIcon[response.route] : Sparkles;

  return (
    <div className="flex animate-slide-up gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {response && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={routeTone[response.route]} icon={<RouteIcon className="size-3" />} title="Which sources the answer used">
              {ROUTE_LABEL[response.route]}
            </Badge>
            {response.meta.degraded && <Badge tone="amber">Degraded</Badge>}
            {response.error && message.httpStatus && message.httpStatus >= 400 && <Badge tone="rose">{response.error.code}</Badge>}
          </div>
        )}

        {!!message.steps?.length && (streaming || !response?.toolCalls.length) && <ProgressSteps steps={message.steps} />}

        {(message.content || streaming) && !failure && (
          <div className={cn('rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-sm leading-relaxed text-zinc-700 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800', response?.error && message.httpStatus && message.httpStatus >= 500 && 'ring-rose-200 dark:ring-rose-500/30')}>
            {message.content ? (
              <RichText text={message.content} evidence={response?.evidence ?? []} onOpenTask={onOpenTask} />
            ) : (
              <TypingIndicator label={message.statusText} />
            )}
            {streaming && message.content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-brand-400 align-middle" />}
          </div>
        )}

        {failure && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl rounded-tl-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p>{failure.message}</p>
              {failure.retry && <p className="mt-0.5 text-[11px] text-rose-600/80 dark:text-rose-300/70">Retrying is safe — it reuses the same request key, so nothing runs twice.</p>}
            </div>
            {failure.retry && (
              <Button size="sm" onClick={() => onRetry(message.id)} icon={<RotateCw className="size-3.5" />}>Retry</Button>
            )}
          </div>
        )}

        {response?.needsConfirmation && message.confirmation && (
          <ConfirmationCard pending={response.needsConfirmation} state={message.confirmation} onResolve={(confirm) => onResolve(message.id, confirm)} />
        )}

        {response && <EvidenceList evidence={response.evidence} threshold={threshold} />}
        {response && <ToolCallList calls={response.toolCalls} />}

        {!!response?.meta.groundingWarnings.length && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            <p className="flex items-center gap-1 font-medium"><AlertTriangle className="size-3" /> Grounding check</p>
            <ul className="mt-0.5 list-disc pl-4">{response.meta.groundingWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        {response && !streaming && (
          <p className="text-[10.5px] text-zinc-400 tabular-nums">
            {(response.meta.latencyMs / 1000).toFixed(1)}s
            {response.meta.llmCalls > 0 && ` · ${response.meta.llmCalls} LLM call${response.meta.llmCalls > 1 ? 's' : ''} · ${response.meta.usage.inputTokens + response.meta.usage.outputTokens} tokens`}
            {response.meta.retrieval.length > 0 && ` · ${response.meta.retrieval.length} KB search${response.meta.retrieval.length > 1 ? 'es' : ''}`}
          </p>
        )}
      </div>
    </div>
  );
}

function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  return (
    <ul className="space-y-1">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {step.status === 'running' ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-brand-500" />
          ) : step.status === 'error' ? (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          ) : step.status === 'waiting' ? (
            <Clock3 className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          ) : (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          )}
          <span>
            {step.label}
            {step.detail && <span className="text-zinc-400"> — {step.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TypingIndicator({ label }: { label?: string }) {
  return (
    <span className="flex items-center gap-2 text-zinc-400" aria-live="polite">
      <span className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="size-1.5 animate-pulse-dot rounded-full bg-zinc-400" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span className="text-xs">{label ?? 'Thinking…'}</span>
    </span>
  );
}
