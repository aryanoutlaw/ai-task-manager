import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  createTaskSchema,
  dateOnlySchema,
  taskIdSchema,
  updateTaskSchema,
} from '../../schemas/task.schema.js';
import { KB_TOOL_NAME, type TaskToolName } from '../types.js';

export type ToolKind = 'kb' | 'read' | 'write' | 'destructive';

export interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: TaskToolName | typeof KB_TOOL_NAME;
  kind: ToolKind;
  description: string;
  input: S;
}

/**
 * Tool input schemas REUSE the service schemas (createTaskSchema, updateTaskSchema, taskIdSchema…),
 * so a tool call is validated by exactly the same rules as the REST API. The JSON Schema the model
 * sees is generated from the same Zod objects — the contract cannot drift.
 */
export const TOOL_SPECS = {
  [KB_TOOL_NAME]: {
    name: KB_TOOL_NAME,
    kind: 'kb',
    description:
      "Search the team's knowledge base (priority definitions, status lifecycle, due-date/overdue policy, deletion policy, " +
      'how to write good tasks, weekly triage, what the assistant can do). Use it for ANY question about policy, process or ' +
      'definitions, and before justifying a priority. Returns only passages above the relevance threshold, each with a ' +
      'citation id. An empty result means the knowledge base does not cover the question. Do not use it for plain task lookups.',
    input: z.strictObject({
      query: z.string().trim().min(2).max(300).describe('Focused keyword query, e.g. "difference medium high priority"'),
    }),
  },
  list_tasks: {
    name: 'list_tasks',
    kind: 'read',
    description:
      'List tasks, optionally filtered. All filters are optional and combined with AND. dueBefore is inclusive and only ' +
      'matches tasks that have a due date. q is a case-insensitive text search over title and description (every word ' +
      'must match). Results are sorted by due date (soonest first).',
    input: z.strictObject({
      status: z.enum(TASK_STATUSES).optional().describe('Filter by status'),
      priority: z.enum(TASK_PRIORITIES).optional().describe('Filter by priority'),
      dueBefore: dateOnlySchema.optional().describe('Only tasks due on or before this date (YYYY-MM-DD)'),
      q: z.string().trim().min(1).max(100).optional().describe('Text search, e.g. "login"'),
    }),
  },
  get_task: {
    name: 'get_task',
    kind: 'read',
    description: 'Get one task by its numeric id. Returns a TASK_NOT_FOUND error if it does not exist.',
    input: z.strictObject({ id: taskIdSchema }),
  },
  create_task: {
    name: 'create_task',
    kind: 'write',
    description:
      'Create a task. title (3-120 chars, verb-first) and description are required. priority defaults to medium, status ' +
      'to pending. dueDate must be YYYY-MM-DD and not in the past. Call it once per task the user asked for.',
    input: createTaskSchema,
  },
  update_task: {
    name: 'update_task',
    kind: 'write',
    description:
      'Update fields of an existing task by id. Only these fields may be changed: title, description, status, priority, ' +
      'dueDate (use null to clear the due date). Unknown fields are rejected. Requires a specific id — ask the user if unclear.',
    input: z.strictObject({ id: taskIdSchema, fields: updateTaskSchema }),
  },
  delete_task: {
    name: 'delete_task',
    kind: 'destructive',
    description:
      'Request deletion of a task by id. This does NOT delete immediately: it creates a confirmation request that the user ' +
      'must approve with the Confirm button. After calling it, tell the user which task will be deleted and ask them to confirm.',
    input: z.strictObject({ id: taskIdSchema }),
  },
} satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOL_SPECS;
export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_SPECS)[N]['input']>;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_SPECS, name);
}

/** Anthropic tool definitions, generated once. Stable order => stable prompt-cache prefix. */
export function toAnthropicTools(): Anthropic.Tool[] {
  return Object.values(TOOL_SPECS).map((spec) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(spec.input, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    return {
      name: spec.name,
      description: spec.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}
