import { AlertCircle, CalendarClock, CircleDashed, ListTodo } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Task } from '../../api/types';
import { cn } from '../../lib/cn';
import { daysUntil } from '../../lib/dates';
import { Skeleton } from '../ui/Skeleton';

export function StatsBar({ tasks, isLoading }: { tasks: Task[] | undefined; isLoading: boolean }) {
  const open = tasks?.filter((t) => t.status !== 'completed') ?? [];
  const stats = [
    { label: 'Open tasks', value: open.length, icon: <ListTodo className="size-4" />, tone: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-300' },
    { label: 'In progress', value: open.filter((t) => t.status === 'in_progress').length, icon: <CircleDashed className="size-4" />, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300' },
    { label: 'Due in 7 days', value: open.filter((t) => t.dueDate && daysUntil(t.dueDate) >= 0 && daysUntil(t.dueDate) <= 7).length, icon: <CalendarClock className="size-4" />, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300' },
    { label: 'Overdue', value: open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0).length, icon: <AlertCircle className="size-4" />, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <Stat key={s.label} {...s} loading={isLoading} />
      ))}
    </div>
  );
}

function Stat({ label, value, icon, tone, loading }: { label: string; value: number; icon: ReactNode; tone: string; loading: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className={cn('flex size-9 items-center justify-center rounded-xl', tone)}>{icon}</div>
      <div>
        {loading ? <Skeleton className="mb-1 h-5 w-6" /> : <p className="text-lg leading-none font-semibold tabular-nums">{value}</p>}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      </div>
    </div>
  );
}
