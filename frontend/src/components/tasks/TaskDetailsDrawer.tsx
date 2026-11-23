import { CalendarDays, Clock, Pencil, Sparkles, Trash2, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { Task } from '../../api/types';
import { useTask } from '../../hooks/useTasks';
import { formatDate, formatDateTime, formatRelative } from '../../lib/dates';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Skeleton } from '../ui/Skeleton';
import { DueBadge, PriorityBadge, StatusBadge } from './TaskBadges';

/** Fetches the task itself (not just the list copy) so it is always fresh — e.g. opened from a chat link. */
export function TaskDetailsDrawer({ taskId, onClose, onEdit, onDelete }: { taskId: number | null; onClose: () => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void }) {
  const { data: task, isLoading, error, refetch, isRefetching } = useTask(taskId);
  const apiError = error instanceof ApiError ? error : null;

  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      title={task ? <><span className="mr-1.5 font-mono text-sm font-normal text-zinc-400">#{task.id}</span>{task.title}</> : `Task #${taskId ?? ''}`}
      footer={
        task && (
          <>
            <Button variant="primary" className="flex-1" icon={<Pencil className="size-4" />} onClick={() => onEdit(task)}>Edit</Button>
            <Button variant="secondary" className="text-rose-600 dark:text-rose-400" icon={<Trash2 className="size-4" />} onClick={() => onDelete(task)}>Delete</Button>
          </>
        )
      }
    >
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {apiError && (
        <ErrorBanner
          title={apiError.status === 404 ? 'Task not found' : "Couldn't load task"}
          message={apiError.status === 404 ? 'It may have been deleted.' : apiError.message}
          onRetry={apiError.status === 404 ? undefined : () => void refetch()}
          retrying={isRefetching}
        />
      )}
      {task && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge task={task} />
          </div>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Description</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{task.description}</p>
          </section>
          <dl className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-100 dark:divide-zinc-800 dark:ring-zinc-800">
            <Row icon={<CalendarDays className="size-4" />} label="Due date" value={task.dueDate ? formatDate(task.dueDate) : 'None'} />
            <Row icon={<Clock className="size-4" />} label="Created" value={`${formatDateTime(task.createdAt)} · ${formatRelative(task.createdAt)}`} />
            <Row icon={<Clock className="size-4" />} label="Updated" value={`${formatDateTime(task.updatedAt)} · ${formatRelative(task.updatedAt)}`} />
            <Row
              icon={task.createdBy === 'assistant' ? <Sparkles className="size-4 text-violet-500" /> : <User className="size-4" />}
              label="Created by"
              value={task.createdBy === 'assistant' ? 'AI assistant' : 'User'}
            />
          </dl>
        </div>
      )}
    </Drawer>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="text-zinc-400">{icon}</span>
      <dt className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}
