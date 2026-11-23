import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search, X } from 'lucide-react';
import { TASK_PRIORITIES, TASK_STATUSES, type SortField, type TaskPriority, type TaskStatus } from '../../api/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../lib/labels';
import { ToolbarSelect } from '../ui/Field';

export interface TaskFilters {
  search: string;
  status: TaskStatus | '';
  priority: TaskPriority | '';
  sortBy: SortField;
  order: 'asc' | 'desc';
}

const SORT_LABEL: Record<SortField, string> = { createdAt: 'Created', updatedAt: 'Updated', dueDate: 'Due date', priority: 'Priority', title: 'Title' };

export function TaskToolbar({ filters, onChange }: { filters: TaskFilters; onChange: (patch: Partial<TaskFilters>) => void }) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search title or description…"
          aria-label="Search tasks"
          className="h-10 w-full rounded-xl border-0 bg-white pr-9 pl-10 text-sm shadow-xs ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-500 focus:outline-none dark:bg-zinc-900 dark:ring-zinc-700 [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.search && (
          <button type="button" onClick={() => onChange({ search: '' })} aria-label="Clear search" className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-600">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <ToolbarSelect label="Filter by status" value={filters.status} onChange={(e) => onChange({ status: e.target.value as TaskStatus | '' })}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Filter by priority" value={filters.priority} onChange={(e) => onChange({ priority: e.target.value as TaskPriority | '' })}>
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Sort by" value={filters.sortBy} onChange={(e) => onChange({ sortBy: e.target.value as SortField })}>
          {(Object.keys(SORT_LABEL) as SortField[]).map((f) => <option key={f} value={f}>Sort: {SORT_LABEL[f]}</option>)}
        </ToolbarSelect>
        <button
          type="button"
          onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm text-zinc-700 shadow-xs ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
          aria-label={`Sort ${filters.order === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
          title={filters.order === 'asc' ? 'Ascending' : 'Descending'}
        >
          {filters.order === 'asc' ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
          <span className="sm:hidden lg:inline">{filters.order === 'asc' ? 'Asc' : 'Desc'}</span>
        </button>
      </div>
    </div>
  );
}
