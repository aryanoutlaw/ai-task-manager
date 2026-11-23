import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './Button';

export function ErrorBanner({ title = 'Something went wrong', message, requestId, onRetry, retrying }: { title?: string; message: string; requestId?: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-500" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-rose-800 dark:text-rose-200">{title}</p>
        <p className="mt-0.5 text-rose-700 dark:text-rose-300">{message}</p>
        {requestId && <p className="mt-1 font-mono text-[11px] text-rose-500/80">Request ID: {requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying} icon={<RotateCw className="size-3.5" />}>
          Retry
        </Button>
      )}
    </div>
  );
}
