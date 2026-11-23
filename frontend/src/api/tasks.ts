import { apiRequest } from './client';
import type { PageMeta, Task, TaskInput, TaskQuery } from './types';

export const tasksApi = {
  list: (query: TaskQuery = {}, signal?: AbortSignal) =>
    apiRequest<{ data: Task[]; meta: PageMeta }>('/api/tasks', { query: { ...query }, signal }),

  get: (id: number, signal?: AbortSignal) => apiRequest<{ data: Task }>(`/api/tasks/${id}`, { signal }).then((r) => r.data),

  create: (input: TaskInput, idempotencyKey: string) =>
    apiRequest<{ data: Task }>('/api/tasks', { method: 'POST', body: input, idempotencyKey }).then((r) => r.data),

  update: (id: number, patch: Partial<TaskInput>) =>
    apiRequest<{ data: Task }>(`/api/tasks/${id}`, { method: 'PUT', body: patch }).then((r) => r.data),

  remove: (id: number) => apiRequest<{ data: Task }>(`/api/tasks/${id}`, { method: 'DELETE' }).then((r) => r.data),
};
