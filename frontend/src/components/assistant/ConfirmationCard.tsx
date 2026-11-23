import { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { NeedsConfirmation } from '../../api/types';
import type { ConfirmationState } from '../../hooks/useAssistant';
import { Button } from '../ui/Button';

/** The "needs confirmation" state: nothing is deleted until the user presses Confirm. */
export function ConfirmationCard({ pending, state, onResolve }: { pending: NeedsConfirmation; state: ConfirmationState; onResolve: (confirm: boolean) => void }) {
  const remaining = useCountdown(pending.expiresAt);
  const expired = remaining <= 0 && state === 'pending';
  const busy = state === 'confirming' || state === 'cancelling';

  if (state === 'confirmed' || state === 'cancelled' || state === 'failed') {
    return (
      <p className="flex items-center gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500 ring-1 ring-zinc-200/70 dark:bg-zinc-800/50 dark:ring-zinc-700/60">
        {state === 'confirmed' ? <Check className="size-3.5 text-emerald-500" /> : <X className="size-3.5" />}
        {state === 'confirmed' ? 'Confirmed' : state === 'cancelled' ? 'Cancelled' : 'Could not complete'} — delete #{pending.taskId}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10" role="group" aria-label="Confirmation required">
      <div className="flex gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Confirm deletion</p>
          <p className="mt-0.5 text-[13px] text-amber-800 dark:text-amber-200/90">
            Delete <span className="font-mono">#{pending.taskId}</span> “{pending.taskTitle}”? This cannot be undone.
          </p>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/70">
            {expired ? 'This request has expired — ask again to delete.' : `Expires in ${formatSeconds(remaining)}`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => onResolve(false)} disabled={busy || expired} loading={state === 'cancelling'}>Cancel</Button>
        <Button size="sm" variant="danger" onClick={() => onResolve(true)} disabled={busy || expired} loading={state === 'confirming'}>Confirm delete</Button>
      </div>
    </div>
  );
}

function useCountdown(iso: string): number {
  const target = new Date(iso).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((target - now) / 1000));
}

const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
