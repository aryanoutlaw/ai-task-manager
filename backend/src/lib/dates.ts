/**
 * Date helpers. Due dates are *calendar dates* (YYYY-MM-DD), not instants, so we compare them as
 * strings in the server's local calendar. This avoids the classic "due today shows as overdue in
 * UTC" bug that comes from storing midnight timestamps.
 */
export function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** ISO week (Monday–Sunday) containing `date`. */
export function weekBounds(date: Date): { start: string; end: string } {
  const dayIndex = (date.getDay() + 6) % 7; // Monday = 0
  const monday = addDays(date, -dayIndex);
  return { start: toDateOnly(monday), end: toDateOnly(addDays(monday, 6)) };
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
