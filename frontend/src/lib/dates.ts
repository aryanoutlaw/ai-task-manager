/** Due dates are calendar dates (YYYY-MM-DD); compare them as local calendar days, never as instants. */
export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISODate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function daysUntil(dueDate: string, now = new Date()): number {
  const ms = parseISODate(dueDate).getTime() - parseISODate(todayISO(now)).getTime();
  return Math.round(ms / 86_400_000);
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'done' | 'none';

export function dueState(dueDate: string | null, completed: boolean, now = new Date()): DueState {
  if (!dueDate) return 'none';
  if (completed) return 'done';
  const days = daysUntil(dueDate, now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

export function formatDueLabel(dueDate: string | null, completed: boolean, now = new Date()): string {
  if (!dueDate) return 'No due date';
  const days = daysUntil(dueDate, now);
  const absolute = formatDate(dueDate);
  if (completed) return `Due ${absolute}`;
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 6) return `Due in ${days} days`;
  return `Due ${absolute}`;
}

export function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISODate(value) : new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(value: string, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return 'just now';
}
