export type AssistantRoute = 'kb' | 'tool' | 'both' | 'none';

export const TASK_TOOL_NAMES = ['list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task'] as const;
export type TaskToolName = (typeof TASK_TOOL_NAMES)[number];
export const KB_TOOL_NAME = 'search_knowledge_base';

export interface EvidenceItem {
  /** Citation id, e.g. "priority-levels#medium-versus-high". */
  id: string;
  docId: string;
  title: string;
  section: string;
  score: number;
  snippet: string;
}

export interface ToolError {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export interface ToolCallRecord {
  id: string;
  name: TaskToolName;
  arguments: unknown;
  status: 'success' | 'error' | 'pending_confirmation' | 'cancelled';
  result?: unknown;
  error?: ToolError;
  durationMs: number;
  /** True when the model repeated an identical write in the same turn and we reused the first result. */
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
    /** True when the answer was produced deterministically because the LLM failed mid-request. */
    degraded: boolean;
    /** True when task data changed — the client should refresh its task list. */
    tasksChanged: boolean;
  };
  error?: { code: string; message: string };
}

/** Progress events for the streaming endpoint. The non-streaming endpoint ignores them. */
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'kb_search'; query: string; passed: number; topScore: number | null }
  | { type: 'tool_start'; id: string; name: TaskToolName; arguments: unknown }
  | { type: 'tool_end'; call: ToolCallRecord }
  | { type: 'text_delta'; text: string }
  /** Discard streamed draft text (the step turned into tool use, or the LLM call is being retried). */
  | { type: 'text_reset' };
