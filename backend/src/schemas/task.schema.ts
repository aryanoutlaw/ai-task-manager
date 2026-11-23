import { z } from 'zod';
import { isValidCalendarDate } from '../lib/dates.js';

/**
 * Single source of truth for task validation.
 *
 * These schemas are used by:
 *  - the TaskService (so REST controllers and assistant tools validate identically),
 *  - the assistant tool definitions (converted to JSON Schema for the LLM via z.toJSONSchema),
 *  - TypeScript types (z.infer), so the compiler catches contract drift.
 */

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_CREATORS = ['user', 'assistant'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskCreator = (typeof TASK_CREATORS)[number];

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Calendar date (YYYY-MM-DD) or null when the task has no deadline. */
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: TaskCreator;
}

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

export const taskIdSchema = z.coerce
  .number({ error: 'Task id must be a number' })
  .int('Task id must be a whole number')
  .positive('Task id must be a positive number')
  .describe('Numeric task id, e.g. 3');

export const dateOnlySchema = z
  .string()
  .trim()
  .refine(isValidCalendarDate, { message: 'Must be a valid calendar date in YYYY-MM-DD format' })
  .describe('Calendar date in YYYY-MM-DD format');

const titleSchema = z
  .string({ error: 'Title is required' })
  .trim()
  .min(TITLE_MIN, `Title must be at least ${TITLE_MIN} characters`)
  .max(TITLE_MAX, `Title must be at most ${TITLE_MAX} characters`)
  .describe('Short, action-oriented title (3-120 chars), e.g. "Fix login redirect loop"');

const descriptionSchema = z
  .string({ error: 'Description is required' })
  .trim()
  .min(1, 'Description is required')
  .max(DESCRIPTION_MAX, `Description must be at most ${DESCRIPTION_MAX} characters`)
  .describe('What needs to be done and why / acceptance criteria');

const statusSchema = z
  .enum(TASK_STATUSES, { error: `Status must be one of: ${TASK_STATUSES.join(', ')}` })
  .describe('Task status');

const prioritySchema = z
  .enum(TASK_PRIORITIES, { error: `Priority must be one of: ${TASK_PRIORITIES.join(', ')}` })
  .describe('Task priority');

/** Fields a client may set. `createdBy`, ids and timestamps are always server-controlled. */
const editableFields = {
  title: titleSchema,
  description: descriptionSchema,
  status: statusSchema,
  priority: prioritySchema,
  dueDate: dateOnlySchema.nullable(),
};

/** POST /api/tasks — strict: unknown fields are rejected rather than silently dropped. */
export const createTaskSchema = z.strictObject({
  title: editableFields.title,
  description: editableFields.description,
  status: editableFields.status.default('pending'),
  priority: editableFields.priority.default('medium'),
  dueDate: editableFields.dueDate.optional().default(null),
});

/** PUT /api/tasks/:id — any subset of editable fields, but at least one, and only known ones. */
export const updateTaskSchema = z
  .strictObject({
    title: editableFields.title.optional(),
    description: editableFields.description.optional(),
    status: editableFields.status.optional(),
    priority: editableFields.priority.optional(),
    dueDate: editableFields.dueDate.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update (title, description, status, priority, dueDate)',
  });

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'title'] as const;

/** Accepts `status=pending` or `status=pending,in_progress`. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values, { error: `${label} must be one of: ${values.join(', ')}` })));

/** GET /api/tasks query string. */
export const listTasksQuerySchema = z.object({
  status: csvEnum(TASK_STATUSES, 'status').optional(),
  priority: csvEnum(TASK_PRIORITIES, 'priority').optional(),
  createdBy: z.enum(TASK_CREATORS).optional(),
  q: z.string().trim().max(200).optional(),
  dueBefore: dateOnlySchema.optional(),
  dueAfter: dateOnlySchema.optional(),
  sortBy: z.enum(SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ListTasksQueryInput = z.input<typeof listTasksQuerySchema>;

export interface ListTasksResult {
  data: Task[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
