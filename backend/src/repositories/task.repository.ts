import type { Task } from '../schemas/task.schema.js';

/**
 * Storage port. The service depends on this interface, not on a Map, so swapping in a real
 * database later is a new adapter — not a rewrite. (The brief forbids a database, so the only
 * adapter is in-memory.)
 */
export interface TaskRepository {
  findAll(): Task[];
  findById(id: number): Task | undefined;
  insert(task: Omit<Task, 'id'>): Task;
  replace(task: Task): Task;
  delete(id: number): boolean;
  clear(): void;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  // Copies in and out: callers can never mutate stored state by holding a reference.
  findAll(): Task[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }

  findById(id: number): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  insert(data: Omit<Task, 'id'>): Task {
    const task: Task = { id: this.nextId++, ...data };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  replace(task: Task): Task {
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  delete(id: number): boolean {
    return this.tasks.delete(id);
  }

  clear(): void {
    this.tasks.clear();
    this.nextId = 1;
  }
}
