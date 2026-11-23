import { AlertCircle, ArrowDown, ArrowUp, CalendarClock, CheckCircle2, Circle, CircleDashed, Minus, Sparkles } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '../../api/types';
import { dueState, formatDueLabel } from '../../lib/dates';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../lib/labels';
import { Badge, type Tone } from '../ui/Badge';

const statusTone: Record<TaskStatus, Tone> = { pending: 'neutral', in_progress: 'sky', completed: 'green' };
const statusIcon: Record<TaskStatus, typeof Circle> = { pending: Circle, in_progress: CircleDashed, completed: CheckCircle2 };

export function StatusBadge({ status }: { status: TaskStatus }) {
  const Icon = statusIcon[status];
  return (
    <Badge tone={statusTone[status]} icon={<Icon className="size-3" />}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const priorityTone: Record<TaskPriority, Tone> = { low: 'neutral', medium: 'amber', high: 'rose' };
const priorityIcon: Record<TaskPriority, typeof Minus> = { low: ArrowDown, medium: Minus, high: ArrowUp };

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const Icon = priorityIcon[priority];
  return (
    <Badge tone={priorityTone[priority]} icon={<Icon className="size-3" />}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export function DueBadge({ task }: { task: Pick<Task, 'dueDate' | 'status'> }) {
  const state = dueState(task.dueDate, task.status === 'completed');
  if (state === 'none') return null;
  const tone: Tone = state === 'overdue' ? 'rose' : state === 'today' ? 'amber' : state === 'soon' ? 'brand' : 'neutral';
  const Icon = state === 'overdue' ? AlertCircle : CalendarClock;
  return (
    <Badge tone={tone} icon={<Icon className="size-3" />} title={task.dueDate ?? undefined}>
      {formatDueLabel(task.dueDate, task.status === 'completed')}
    </Badge>
  );
}

export function CreatedByBadge({ createdBy }: { createdBy: Task['createdBy'] }) {
  if (createdBy !== 'assistant') return null;
  return (
    <Badge tone="violet" icon={<Sparkles className="size-3" />} title="Created by the AI assistant">
      AI
    </Badge>
  );
}
