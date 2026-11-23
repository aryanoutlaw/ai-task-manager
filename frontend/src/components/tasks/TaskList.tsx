import { ClipboardList, Plus, SearchX } from 'lucide-react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Skeleton } from '../ui/Skeleton';
import { TaskCard } from './TaskCard';

interface TaskListProps {
  tasks: Task[] | undefined;
  isLoading: boolean;
  error: unknown;
  isFiltered: boolean;
  isRefetching: boolean;
  highlightedIds: Set<number>;
  onRetry: () => void;
  onCreate: () => void;
  onClearFilters: () => void;
  onView: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

/** Owns the four list states: loading, error, empty (two flavours) and data. */
export function TaskList({ tasks, isLoading, error, isFiltered, isRefetching, highlightedIds, onRetry, onCreate, onClearFilters, ...handlers }: TaskListProps) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-busy="true" aria-label="Loading tasks">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:ring-zinc-800">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
            <div className="mt-4 flex gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && !tasks) {
    const apiError = error instanceof ApiError ? error : null;
    return <ErrorBanner title="Couldn't load tasks" message={apiError?.message ?? 'Unexpected error'} requestId={apiError?.requestId} onRetry={onRetry} retrying={isRefetching} />;
  }

  if (!tasks?.length) {
    return isFiltered ? (
      <EmptyState icon={<SearchX className="size-6" />} title="No matching tasks" description="Try a different search term or clear the filters." action={<Button onClick={onClearFilters}>Clear filters</Button>} />
    ) : (
      <EmptyState
        icon={<ClipboardList className="size-6" />}
        title="No tasks yet"
        description="Create your first task, or ask the assistant to create one for you."
        action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>New task</Button>}
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-busy={isRefetching || undefined}>
      {tasks.map((task) => (
        <li key={task.id} className="flex animate-fade-in [&>article]:flex-1">
          <TaskCard task={task} highlighted={highlightedIds.has(task.id)} {...handlers} />
        </li>
      ))}
    </ul>
  );
}
