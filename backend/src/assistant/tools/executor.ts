import type Anthropic from '@anthropic-ai/sdk';
import { AppError, formatZodIssues } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { stableStringify } from '../../lib/stableStringify.js';
import type { TaskService } from '../../services/task.service.js';
import type { Task } from '../../schemas/task.schema.js';
import { makeSnippet, type RetrievalOptions, type TfIdfRetriever } from '../knowledge/index.js';
import type { PendingActionStore, PendingDelete } from '../pendingActions.js';
import {
  KB_TOOL_NAME,
  type AgentEvent,
  type EvidenceItem,
  type RetrievalTrace,
  type TaskToolName,
  type ToolCallRecord,
  type ToolError,
} from '../types.js';
import { TOOL_SPECS, isToolName, type ToolInput } from './definitions.js';

/** Everything that happened during one assistant turn — the audit trail behind the response. */
export class TurnState {
  readonly toolCalls: ToolCallRecord[] = [];
  readonly retrieval: RetrievalTrace[] = [];
  /** Chunks that passed the relevance threshold this turn (the only citable evidence). */
  readonly evidence = new Map<string, EvidenceItem>();
  /** Task ids that appeared in tool arguments or results (used by the grounding check). */
  readonly knownTaskIds = new Set<number>();
  readonly writeResults = new Map<string, ToolCallRecord>();
  pendingAction: PendingDelete | null = null;
  tasksChanged = false;

  get successfulWrites(): ToolCallRecord[] {
    return this.toolCalls.filter((c) => c.status === 'success' && ['create_task', 'update_task'].includes(c.name));
  }
}

export interface ToolExecutionContext {
  taskService: TaskService;
  retriever: TfIdfRetriever;
  retrievalOptions: RetrievalOptions;
  pendingActions: PendingActionStore;
  conversationId: string;
  /** Simulated outage of the task tools (FORCE_TOOL_FAILURE or the dev-only header). */
  forceToolFailure: boolean;
  turn: TurnState;
  emit: (event: AgentEvent) => void;
}

type Outcome =
  | { ok: true; data: unknown; status?: 'success' | 'pending_confirmation' }
  | { ok: false; error: ToolError };

/**
 * Executes one tool_use block and returns the tool_result for the model.
 * Invariants:
 *  - never throws (every failure becomes an `ok:false` result the model must report honestly);
 *  - writes go through TaskService, the same layer as the REST API;
 *  - identical writes within a turn execute once (model "double-call" protection);
 *  - delete_task never deletes — it parks a pending action for explicit user confirmation.
 */
export async function executeToolUse(
  block: Anthropic.ToolUseBlock,
  ctx: ToolExecutionContext,
): Promise<Anthropic.ToolResultBlockParam> {
  const started = Date.now();
  const { turn } = ctx;

  if (!isToolName(block.name)) {
    return toolResult(block.id, { ok: false, error: { code: 'UNKNOWN_TOOL', message: `There is no tool named "${block.name}"` } });
  }

  if (block.name === KB_TOOL_NAME) {
    return toolResult(block.id, runKnowledgeSearch(block.input, ctx));
  }

  const name = block.name as TaskToolName;
  const spec = TOOL_SPECS[name];
  ctx.emit({ type: 'tool_start', id: block.id, name, arguments: block.input });

  const record = (outcome: Outcome, extra: Partial<ToolCallRecord> = {}): Anthropic.ToolResultBlockParam => {
    const call: ToolCallRecord = {
      id: block.id,
      name,
      arguments: block.input,
      status: outcome.ok ? (outcome.status ?? 'success') : 'error',
      ...(outcome.ok ? { result: outcome.data } : { error: outcome.error }),
      durationMs: Date.now() - started,
      ...extra,
    };
    turn.toolCalls.push(call);
    ctx.emit({ type: 'tool_end', call });
    return toolResult(block.id, outcome);
  };

  // 1. Validate arguments with the same schemas as the REST API.
  const parsed = spec.input.safeParse(block.input);
  if (!parsed.success) {
    return record({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS', message: `Invalid arguments for ${name}`, details: formatZodIssues(parsed.error) },
    });
  }
  collectTaskIds(parsed.data, turn.knownTaskIds);

  // 2. Simulated tool failure (test case 6). Checked after validation so bad args still report as such.
  if (ctx.forceToolFailure) {
    return record({
      ok: false,
      error: { code: 'TOOL_UNAVAILABLE', message: 'The task service is unavailable (simulated failure: FORCE_TOOL_FAILURE is on). No data was read or changed.' },
    });
  }

  // 3. Duplicate-write guard: the same write with the same arguments runs once per turn.
  const isWrite = spec.kind === 'write';
  const dedupeKey = `${name}:${stableStringify(parsed.data)}`;
  const previous = isWrite ? turn.writeResults.get(dedupeKey) : undefined;
  if (previous) {
    logger.warn({ tool: name }, 'Model repeated an identical write in one turn; returning the first result');
    return record(
      previous.status === 'success'
        ? { ok: true, data: { ...(previous.result as object), note: 'Duplicate call ignored: this exact change was already applied in this turn.' } }
        : { ok: false, error: previous.error! },
      { deduplicated: true },
    );
  }

  // 4. Execute.
  const outcome = runTaskTool(name, parsed.data, ctx);
  if (outcome.ok) collectTaskIds(outcome.data, turn.knownTaskIds);
  const result = record(outcome);
  if (isWrite) {
    turn.writeResults.set(dedupeKey, turn.toolCalls.at(-1)!);
    if (outcome.ok) turn.tasksChanged = true;
  }
  return result;
}

function runTaskTool(name: TaskToolName, input: unknown, ctx: ToolExecutionContext): Outcome {
  const { taskService, turn } = ctx;
  try {
    switch (name) {
      case 'list_tasks': {
        const args = input as ToolInput<'list_tasks'>;
        const { data, meta } = taskService.list({ ...args, sortBy: 'dueDate', order: 'asc', limit: 25 });
        return {
          ok: true,
          data: {
            filters: args,
            total: meta.total,
            returned: data.length,
            ...(meta.total > data.length ? { note: `Only the first ${data.length} of ${meta.total} tasks are shown.` } : {}),
            tasks: data.map(compactTask),
          },
        };
      }
      case 'get_task': {
        const args = input as ToolInput<'get_task'>;
        return { ok: true, data: { task: compactTask(taskService.get(args.id)) } };
      }
      case 'create_task': {
        const task = taskService.create(input, { createdBy: 'assistant' });
        return { ok: true, data: { created: compactTask(task) } };
      }
      case 'update_task': {
        const args = input as ToolInput<'update_task'>;
        const task = taskService.update(args.id, args.fields);
        return { ok: true, data: { updated: compactTask(task), changedFields: Object.keys(args.fields) } };
      }
      case 'delete_task': {
        const args = input as ToolInput<'delete_task'>;
        const task = taskService.get(args.id); // 404-style error if missing — nothing is parked
        if (turn.pendingAction) {
          return {
            ok: false,
            error: {
              code: 'ONE_DELETE_AT_A_TIME',
              message: `A deletion of task #${turn.pendingAction.taskId} is already awaiting confirmation. Deletions are confirmed one at a time.`,
            },
          };
        }
        ctx.pendingActions.discardForConversation(ctx.conversationId);
        turn.pendingAction = ctx.pendingActions.create({
          taskId: task.id,
          taskTitle: task.title,
          taskUpdatedAt: task.updatedAt,
          conversationId: ctx.conversationId,
        });
        return {
          ok: true,
          status: 'pending_confirmation',
          data: {
            status: 'awaiting_user_confirmation',
            task: compactTask(task),
            instruction: 'Nothing has been deleted. Ask the user to press Confirm to delete this task, or Cancel to keep it.',
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } };
    }
    logger.error({ err: error, tool: name }, 'Unexpected tool failure');
    return { ok: false, error: { code: 'TOOL_ERROR', message: 'The tool failed unexpectedly. No changes were confirmed.' } };
  }
}

function runKnowledgeSearch(rawInput: unknown, ctx: ToolExecutionContext): Outcome {
  const parsed = TOOL_SPECS[KB_TOOL_NAME].input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'search_knowledge_base needs a "query" string', details: formatZodIssues(parsed.error) } };
  }
  const { query } = parsed.data;
  const res = ctx.retriever.search(query, ctx.retrievalOptions);

  ctx.turn.retrieval.push({
    query,
    threshold: ctx.retrievalOptions.threshold,
    queryCoverage: res.queryCoverage,
    passed: res.passed.map((r) => ({ id: r.chunk.id, score: r.score })),
    rejected: res.rejected.map((r) => ({ id: r.chunk.id, score: r.score, reason: r.reason })),
  });
  for (const r of res.passed) {
    const existing = ctx.turn.evidence.get(r.chunk.id);
    if (!existing || existing.score < r.score) {
      ctx.turn.evidence.set(r.chunk.id, {
        id: r.chunk.id,
        docId: r.chunk.docId,
        title: r.chunk.docTitle,
        section: r.chunk.section,
        score: r.score,
        snippet: makeSnippet(r.chunk.text, query),
      });
    }
  }
  ctx.emit({ type: 'kb_search', query, passed: res.passed.length, topScore: res.passed[0]?.score ?? res.rejected[0]?.score ?? null });

  if (res.passed.length === 0) {
    return {
      ok: true,
      data: {
        results: [],
        note: `No knowledge-base passage met the relevance threshold (${ctx.retrievalOptions.threshold}). The knowledge base does not cover this; tell the user you cannot verify it. Do not answer from general knowledge.`,
      },
    };
  }
  return {
    ok: true,
    data: {
      results: res.passed.map((r) => ({
        citation: r.chunk.id,
        document: r.chunk.docTitle,
        section: r.chunk.section,
        score: r.score,
        text: r.chunk.text,
      })),
    },
  };
}

function toolResult(toolUseId: string, outcome: Outcome): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: JSON.stringify(outcome.ok ? { ok: true, ...(outcome.data as object) } : { ok: false, error: outcome.error }),
    ...(outcome.ok ? {} : { is_error: true }),
  };
}

function compactTask(task: Task) {
  const { id, title, description, status, priority, dueDate, createdBy, createdAt, updatedAt } = task;
  return { id, title, description, status, priority, dueDate, createdBy, createdAt, updatedAt };
}

/** Walks a value and records every task id (`id` on task-shaped objects) for the grounding check. */
function collectTaskIds(value: unknown, into: Set<number>): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectTaskIds(v, into));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'id' && typeof v === 'number') into.add(v);
      else collectTaskIds(v, into);
    }
  }
}
