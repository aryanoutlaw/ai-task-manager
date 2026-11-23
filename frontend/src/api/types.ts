// Mirrors the backend contract (backend/openapi.yaml).

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: 'user' | 'assistant';
}

export interface TaskInput {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
}

export type SortField = 'createdAt' | 'updatedAt' | 'dueDate' | 'priority' | 'title';

export interface TaskQuery {
  q?: string;
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  sortBy?: SortField;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
  requestId?: string;
}

export type AssistantRoute = 'kb' | 'tool' | 'both' | 'none';

export interface EvidenceItem {
  id: string;
  docId: string;
  title: string;
  section: string;
  score: number;
  snippet: string;
}

export interface ToolCallRecord {
  id: string;
  name: 'list_tasks' | 'get_task' | 'create_task' | 'update_task' | 'delete_task';
  arguments: unknown;
  status: 'success' | 'error' | 'pending_confirmation' | 'cancelled';
  result?: unknown;
  error?: ApiErrorBody;
  durationMs: number;
  deduplicated?: boolean;
}

export interface NeedsConfirmation {
  pendingActionId: string;
  action: 'delete_task';
  taskId: number;
  taskTitle: string;
  summary: string;
  expiresAt: string;
}

export interface RetrievalTrace {
  query: string;
  threshold: number;
  queryCoverage: number;
  passed: Array<{ id: string; score: number }>;
  rejected: Array<{ id: string; score: number; reason: string }>;
}

export interface ChatResponse {
  answer: string;
  route: AssistantRoute;
  evidence: EvidenceItem[];
  toolCalls: ToolCallRecord[];
  needsConfirmation: NeedsConfirmation | null;
  conversationId: string;
  meta: {
    requestId: string;
    model: string | null;
    latencyMs: number;
    llmCalls: number;
    usage: { inputTokens: number; outputTokens: number };
    retrieval: RetrievalTrace[];
    groundingWarnings: string[];
    degraded: boolean;
    tasksChanged: boolean;
  };
  error?: { code: string; message: string };
}

export interface ChatRequest {
  message: string;
  confirm: boolean;
  pendingActionId: string | null;
  conversationId?: string | null;
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'kb_search'; query: string; passed: number; topScore: number | null }
  | { type: 'tool_start'; id: string; name: ToolCallRecord['name']; arguments: unknown }
  | { type: 'tool_end'; call: ToolCallRecord }
  | { type: 'text_delta'; text: string }
  | { type: 'text_reset' };
