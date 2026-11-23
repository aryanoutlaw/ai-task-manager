import type Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app.js';
import { createContainer, type ContainerOverrides } from '../src/container.js';
import type { LlmCallOptions, LlmClient } from '../src/assistant/llm/types.js';

/** Fixed clock: Monday 2026-11-23 10:00 local time. */
export const FIXED_NOW = new Date(2026, 10, 23, 10, 0, 0);

export function buildTestApp(overrides: ContainerOverrides = {}) {
  const container = createContainer({ seed: true, now: () => FIXED_NOW, llm: null, ...overrides });
  return { container, app: createApp(container) };
}

type Step = (params: Anthropic.MessageCreateParamsNonStreaming, options: LlmCallOptions) => Anthropic.Message | Promise<Anthropic.Message>;

/**
 * Fake LLM that plays back a script. Each step receives the real request the agent built
 * (including tool results), so tests can assert on what the model would have seen.
 */
export class ScriptedLlm implements LlmClient {
  readonly model = 'scripted-test-model';
  readonly calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  private index = 0;

  constructor(private readonly steps: Step[]) {}

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: LlmCallOptions): Promise<Anthropic.Message> {
    this.calls.push(structuredClone(params));
    const step = this.steps[this.index++];
    if (!step) throw new Error(`ScriptedLlm ran out of steps (call #${this.index})`);
    return step(params, options);
  }
}

let toolCounter = 0;

export function toolUse(name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id: `toolu_test_${++toolCounter}`, name, input } as Anthropic.ToolUseBlock;
}

export function reply(...content: Array<Anthropic.ContentBlock | string>): Anthropic.Message {
  const blocks = content.map((c) => (typeof c === 'string' ? ({ type: 'text', text: c, citations: null } as Anthropic.TextBlock) : c));
  const usesTools = blocks.some((b) => b.type === 'tool_use');
  return {
    id: `msg_test_${toolCounter}`,
    type: 'message',
    role: 'assistant',
    model: 'scripted-test-model',
    content: blocks,
    stop_reason: usesTools ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as unknown as Anthropic.Message;
}

/** Parsed JSON tool results from the last user message of a request. */
export function lastToolResults(params: Anthropic.MessageCreateParamsNonStreaming): Array<Record<string, any>> {
  const last = params.messages.at(-1);
  if (!last || !Array.isArray(last.content)) return [];
  return last.content
    .filter((b) => b.type === 'tool_result')
    .map((b) => {
      const content = (b as Anthropic.ToolResultBlockParam).content;
      return JSON.parse(typeof content === 'string' ? content : '{}');
    });
}

/** A step that never resolves until aborted (simulates a hung LLM). */
export const hang: Step = (_params, options) =>
  new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
