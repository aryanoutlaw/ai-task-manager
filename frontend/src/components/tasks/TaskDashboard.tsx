import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Task, TaskQuery } from '../../api/types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDeleteTask, useTaskList, useTaskStats } from '../../hooks/useTasks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Pagination } from './Pagination';
import { StatsBar } from './StatsBar';
import { TaskList } from './TaskList';
import { TaskToolbar, type TaskFilters } from './TaskToolbar';

const PAGE_SIZE = 9;
export const DEFAULT_FILTERS: TaskFilters = { search: '', status: '', priority: '', sortBy: 'createdAt', order: 'desc' };

interface TaskDashboardProps {
  highlightedIds: Set<number>;
  onView: (task: Task) => void;
  onEdit: (task: Task) => void;
  onCreate: () => void;
}

/** Dashboard: stats, filter toolbar, list (with loading/empty/error states), pagination, delete confirm. */
export function TaskDashboard({ highlightedIds, onView, onEdit, onCreate }: TaskDashboardProps) {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<Task | null>(null);
  const search = useDebouncedValue(filters.search.trim(), 300);

  const query: TaskQuery = useMemo(
    () => ({ q: search || undefined, status: filters.status, priority: filters.priority, sortBy: filters.sortBy, order: filters.order, page, limit: PAGE_SIZE }),
    [search, filters.status, filters.priority, filters.sortBy, filters.order, page],
  );
  const list = useTaskList(query);
  const stats = useTaskStats();
  const remove = useDeleteTask();

  const isFiltered = Boolean(search || filters.status || filters.priority);
  const updateFilters = (patch: Partial<TaskFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete, {
      onSuccess: (task) => {
        toast.success('Task deleted', { description: `#${task.id} ${task.title}` });
        setToDelete(null);
        // Step back if we just emptied the last page.
        if (list.data && list.data.data.length === 1 && page > 1) setPage(page - 1);
      },
      onError: (error) => toast.error("Couldn't delete task", { description: error.message }),
    });
  };

  return (
    <div className="space-y-5">
      <StatsBar tasks={stats.data} isLoading={stats.isLoading} />
      <TaskToolbar filters={filters} onChange={updateFilters} />
      <TaskList
        tasks={list.data?.data}
        isLoading={list.isLoading}
        error={list.error}
        isFiltered={isFiltered}
        isRefetching={list.isFetching}
        highlightedIds={highlightedIds}
        onRetry={() => void list.refetch()}
        onCreate={onCreate}
        onClearFilters={() => updateFilters(DEFAULT_FILTERS)}
        onView={onView}
        onEdit={onEdit}
        onDelete={setToDelete}
      />
      {list.data && <Pagination meta={list.data.meta} onPage={setPage} />}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete task?"
        description={
          <>
            <span className="font-mono text-zinc-400">#{toDelete?.id}</span> <span className="font-medium text-zinc-900 dark:text-white">{toDelete?.title}</span> will be permanently deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete task"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => !remove.isPending && setToDelete(null)}
      />
    </div>
  );
}

