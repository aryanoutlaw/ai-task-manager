import type { TaskInput } from '../api/types';
import { todayISO } from './dates';

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

export type TaskFormErrors = Partial<Record<keyof TaskInput, string>>;

/**
 * Client-side validation mirrors the backend rules (backend/src/schemas/task.schema.ts) for instant
 * feedback. The server remains the authority: its field errors are mapped back onto the form too.
 */
export function validateTask(input: TaskInput, mode: 'create' | 'edit', now = new Date()): TaskFormErrors {
  const errors: TaskFormErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = 'Title is required';
  else if (title.length < TITLE_MIN) errors.title = `Title must be at least ${TITLE_MIN} characters`;
  else if (title.length > TITLE_MAX) errors.title = `Title must be at most ${TITLE_MAX} characters`;

  const description = input.description.trim();
  if (!description) errors.description = 'Description is required';
  else if (description.length > DESCRIPTION_MAX) errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;

  if (input.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errors.dueDate = 'Use the format YYYY-MM-DD';
    else if (mode === 'create' && input.dueDate < todayISO(now)) errors.dueDate = 'Due date cannot be in the past';
  }
  return errors;
}
