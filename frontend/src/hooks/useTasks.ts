import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../api/tasks';
import type { Task, TaskInput, TaskQuery } from '../api/types';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (query: TaskQuery) => ['tasks', 'list', query] as const,
  stats: ['tasks', 'stats'] as const,
  detail: (id: number) => ['tasks', 'detail', id] as const,
};

export function useTaskList(query: TaskQuery) {
  return useQuery({
    queryKey: taskKeys.list(query),
    queryFn: ({ signal }) => tasksApi.list(query, signal),
    placeholderData: keepPreviousData, // no flash of empty content while paging/filtering
  });
}

/** Whole (small, in-memory) dataset for the summary cards. */
export function useTaskStats() {
  return useQuery({
    queryKey: taskKeys.stats,
    queryFn: ({ signal }) => tasksApi.list({ limit: 100 }, signal),
    select: (res) => res.data,
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? -1),
    queryFn: ({ signal }) => tasksApi.get(id!, signal),
    enabled: id !== null,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 2,
  });
}

/** After any write, every task query (lists, stats, details) is refetched — one invalidation key. */
export function useInvalidateTasks() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: taskKeys.all });
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TaskInput; idempotencyKey: string }) => tasksApi.create(input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<TaskInput> }) => tasksApi.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (task: Task) => tasksApi.remove(task.id),
    onSuccess: invalidate,
  });
}
