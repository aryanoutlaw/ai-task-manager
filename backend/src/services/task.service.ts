import {
  createTaskSchema,
  listTasksQuerySchema,
  taskIdSchema,
  updateTaskSchema,
  type ListTasksResult,
  type Task,
  type TaskCreator,
  type TaskPriority,
} from '../schemas/task.schema.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import type { TaskRepository } from '../repositories/task.repository.js';

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 1, medium: 2, high: 3 };

export interface TaskServiceOptions {
  /** Injectable clock so tests can control "today" (due-date rules) and timestamps. */
  now?: () => Date;
}

/**
 * The single business-logic layer for tasks.
 *
 * Both the REST controllers and the assistant's tools call this class, and it validates its own
 * inputs (`unknown` in, typed out). That guarantees an LLM tool call can never bypass a rule the
 * REST API enforces — there is no second code path to keep in sync.
 */
export class TaskService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: TaskRepository,
    options: TaskServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  list(rawQuery: unknown = {}): ListTasksResult {
    const parsed = listTasksQuerySchema.safeParse(rawQuery ?? {});
    if (!parsed.success) throw ValidationError.fromZod(parsed.error, 'Invalid query parameters');
    const q = parsed.data;

    const needle = q.q?.toLowerCase();
    const filtered = this.repo.findAll().filter((task) => {
      if (q.status?.length && !q.status.includes(task.status)) return false;
      if (q.priority?.length && !q.priority.includes(task.priority)) return false;
      if (q.createdBy && task.createdBy !== q.createdBy) return false;
      // Date-range filters only match tasks that *have* a due date. Bounds are inclusive.
      if (q.dueBefore && (!task.dueDate || task.dueDate > q.dueBefore)) return false;
      if (q.dueAfter && (!task.dueDate || task.dueDate < q.dueAfter)) return false;
      if (needle) {
        const haystack = `${task.title}\n${task.description}`.toLowerCase();
        // Every whitespace-separated term must match, so "login bug" finds "Fix bug in login".
        if (!needle.split(/\s+/).every((term) => haystack.includes(term))) return false;
      }
      return true;
    });

    const direction = q.order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      // Tasks without a due date always sort last, whichever direction is requested.
      if (q.sortBy === 'dueDate' && !a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
      const cmp = compareBy(q.sortBy, a, b);
      return cmp !== 0 ? cmp * direction : (a.id - b.id) * direction;
    });

    const total = filtered.length;
    const start = (q.page - 1) * q.limit;
    return {
      data: filtered.slice(start, start + q.limit),
      meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  }

  get(rawId: unknown): Task {
    const id = this.parseId(rawId);
    const task = this.repo.findById(id);
    if (!task) throw new NotFoundError(`Task ${id} was not found`, 'TASK_NOT_FOUND');
    return task;
  }

  create(input: unknown, context: { createdBy: TaskCreator }): Task {
    const parsed = createTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw ValidationError.fromZod(parsed.error, 'Invalid task');
    const data = parsed.data;

    // Policy (knowledge-base/due-dates-and-overdue.md): a new task cannot start life overdue.
    if (data.dueDate && data.dueDate < this.today()) {
      throw new ValidationError('Invalid task', [
        { field: 'dueDate', message: `Due date cannot be in the past (today is ${this.today()})` },
      ]);
    }

    const timestamp = this.now().toISOString();
    return this.repo.insert({
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.createdBy,
    });
  }

  update(rawId: unknown, input: unknown): Task {
    const existing = this.get(rawId);
    const parsed = updateTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw ValidationError.fromZod(parsed.error, 'Invalid task update');

    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    return this.repo.replace({ ...existing, ...patch, updatedAt: this.now().toISOString() });
  }

  delete(rawId: unknown): Task {
    const task = this.get(rawId);
    this.repo.delete(task.id);
    return task;
  }

  /** Today's calendar date in server-local time — exposed so the assistant prompt agrees with validation. */
  today(): string {
    return toDateOnly(this.now());
  }

  private parseId(rawId: unknown): number {
    const parsed = taskIdSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ValidationError('Invalid task id', parsed.error.issues.map((i) => ({ field: 'id', message: i.message })));
    }
    return parsed.data;
  }
}

function compareBy(field: string, a: Task, b: Task): number {
  switch (field) {
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'dueDate':
      if (a.dueDate === b.dueDate || !a.dueDate || !b.dueDate) return 0;
      return a.dueDate < b.dueDate ? -1 : 1;
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'updatedAt':
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      return a.createdAt.localeCompare(b.createdAt);
  }
}
