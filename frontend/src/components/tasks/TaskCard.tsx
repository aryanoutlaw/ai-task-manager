import { memo, type ReactNode } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import type { Task } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/dates';
import { CreatedByBadge, DueBadge, PriorityBadge, StatusBadge } from './TaskBadges';

interface TaskCardProps {
  task: Task;
  highlighted?: boolean;
  onView: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

const priorityAccent = { high: 'before:bg-rose-500', medium: 'before:bg-amber-400', low: 'before:bg-zinc-300 dark:before:bg-zinc-600' };

export const TaskCard = memo(function TaskCard({ task, highlighted, onView, onEdit, onDelete }: TaskCardProps) {
  const completed = task.status === 'completed';
  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl bg-white p-4 pl-5 shadow-xs ring-1 ring-zinc-200/80 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-zinc-700',
        "before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:content-['']",
        priorityAccent[task.priority],
        highlighted && 'ring-2 ring-brand-400 dark:ring-brand-500',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onView(task)} className="min-w-0 text-left after:absolute after:inset-0 after:content-['']">
          <span className="mb-1 block font-mono text-[11px] text-zinc-400">#{task.id}</span>
          <h3 className={cn('line-clamp-2 text-sm leading-snug font-semibold text-zinc-900 dark:text-zinc-50', completed && 'text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-500')}>
            {task.title}
          </h3>
        </button>
        <div className="relative z-10 -mt-1 -mr-1 flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <IconAction label={`View task ${task.id}`} onClick={() => onView(task)}><Eye className="size-4" /></IconAction>
          <IconAction label={`Edit task ${task.id}`} onClick={() => onEdit(task)}><Pencil className="size-4" /></IconAction>
          <IconAction label={`Delete task ${task.id}`} onClick={() => onDelete(task)} danger><Trash2 className="size-4" /></IconAction>
        </div>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{task.description}</p>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3.5">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} />
        <CreatedByBadge createdBy={task.createdBy} />
        <span className="ml-auto text-[11px] text-zinc-400" title={task.createdAt}>
          Created {formatDate(task.createdAt)}
        </span>
      </div>
    </article>
  );
});

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
        danger && 'hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400',
      )}
    >
      {children}
    </button>
  );
}
