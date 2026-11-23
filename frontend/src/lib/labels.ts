import type { AssistantRoute, TaskPriority, TaskStatus } from '../api/types';

export const STATUS_LABEL: Record<TaskStatus, string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const ROUTE_LABEL: Record<AssistantRoute, string> = { kb: 'Knowledge base', tool: 'Task tools', both: 'KB + tools', none: 'No source' };
export const TOOL_LABEL: Record<string, string> = {
  list_tasks: 'List tasks',
  get_task: 'Get task',
  create_task: 'Create task',
  update_task: 'Update task',
  delete_task: 'Delete task',
};
