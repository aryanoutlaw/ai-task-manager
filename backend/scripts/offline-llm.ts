/**
 * OFFLINE SCRIPTED MODEL — a test double, never used by the real server.
 *
 * Plays the LLM's role for the known demo/test prompts so the full system can be exercised without
 * API credits (eval --offline, demo-server). Only the model's *decisions and wording* are scripted:
 * every tool call really executes through TaskService, every retrieval score is real, and every
 * answer is composed from the actual tool/retrieval results — ids, titles and dates are never
 * hard-coded. Anything outside the script gets an explicit "offline demo" reply.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmCallOptions, LlmClient } from '../src/assistant/llm/types.js';

type Msg = Anthropic.Message;
type Params = Anthropic.MessageCreateParamsNonStreaming;
type Results = Array<Record<string, any>>;
type Step = (results: Results, ctx: { weekEnd: string }) => Msg;

let counter = 0;
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `toolu_offline_${++counter}`, name, input }) as Anthropic.ToolUseBlock;

function message(...content: Array<Anthropic.ContentBlock | string>): Msg {
  const blocks = content.map((c) => (typeof c === 'string' ? ({ type: 'text', text: c, citations: null } as Anthropic.TextBlock) : c));
  const text = blocks.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  return {
    id: `msg_offline_${counter}`,
    type: 'message',
    role: 'assistant',
    model: 'offline-scripted-model',
    content: blocks,
    stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.ceil(text.length / 4) },
  } as unknown as Msg;
}

const taskLine = (t: { id: number; title: string; status: string; priority: string; dueDate: string | null }) =>
  `- #${t.id} ${t.title} — ${t.status.replace('_', ' ')}, ${t.priority} priority${t.dueDate ? `, due ${t.dueDate}` : ', no due date'}`;

const citationsFor = (results: Results, docId: string) =>
  (results[0]?.results ?? []).filter((r: { citation: string }) => r.citation.startsWith(docId)).map((r: { citation: string }) => r.citation);

const cannotVerify = "I couldn't verify that in the team's knowledge base — it isn't documented there, so I won't guess. I can help with task priorities, statuses, due dates, deletion and how to write good tasks.";

function listAnswer(results: Results, intro: string): string {
  const r = results[0]!;
  if (!r.ok) return `I couldn't load your tasks because the task service returned an error (${r.error.code}): ${r.error.message} I haven't made up any results — please try again shortly.`;
  if (!r.tasks.length) return `${intro}: none right now.`;
  return `${intro} (${r.total}):\n${r.tasks.map(taskLine).join('\n')}`;
}

const SCRIPTS: Record<string, Step[]> = {
  'what is the difference between medium and high priority?': [
    () => message(toolUse('search_knowledge_base', { query: 'difference between medium and high priority' })),
    (results) => {
      const [diff] = citationsFor(results, 'priority-levels#medium-versus-high');
      if (!diff) return message(cannotVerify);
      const high = citationsFor(results, 'priority-levels#high').at(0);
      const medium = citationsFor(results, 'priority-levels#medium-priority').at(0);
      return message(
        `The difference is whether someone is **blocked right now** [${diff}].\n` +
          `- **High** — a user, customer or teammate cannot proceed, or there is a security or data risk${high ? ` [${high}]` : ''}.\n` +
          `- **Medium** — important planned work, but nobody is blocked and a workaround exists${medium ? ` [${medium}]` : ''}.`,
      );
    },
  ],
  'what does medium priority mean here?': [
    () => message(toolUse('search_knowledge_base', { query: 'medium priority meaning' })),
    (results) => {
      const [c] = citationsFor(results, 'priority-levels#medium');
      return message(c ? `Medium is the default priority: planned work that matters this sprint but doesn't block anyone today, and it should be started within the current week [${c}].` : cannotVerify);
    },
  ],
  'show my high priority tasks': [
    () => message(toolUse('list_tasks', { priority: 'high' })),
    (results) => message(listAnswer(results, 'Here are your high priority tasks')),
  ],
  'show my high priority tasks due this week': [
    (_r, { weekEnd }) => message(toolUse('list_tasks', { priority: 'high', dueBefore: weekEnd })),
    (results) => message(listAnswer(results, 'High priority tasks due this week (including overdue ones)')),
  ],
  'create a task to fix the login bug and tell me what priority it should be': [
    () => message(toolUse('search_knowledge_base', { query: 'priority for a bug that prevents users from logging in' })),
    (results) => {
      const policy = citationsFor(results, 'priority-levels#high-priority').at(0);
      return message(
        toolUse('create_task', {
          title: 'Fix login bug',
          description: 'Users are unable to log in. Reproduce the issue, find the root cause and ship a fix with a regression test.',
          priority: policy ? 'high' : 'medium',
        }),
      );
    },
    (results) => {
      const r = results[0]!;
      if (!r.ok) return message(`I couldn't create the task: ${r.error.message}`);
      const t = r.created;
      return message(
        `Created #${t.id} "${t.title}" with **${t.priority}** priority. A bug that prevents users from logging in blocks them, and blocking users is exactly what high priority is for [priority-levels#high-priority]. ` +
          `Per the same policy it should be picked up within one business day — consider adding a due date.`,
      );
    },
  ],
  'what is the weather in delhi?': [
    () => message("I can't verify that — weather is outside this team's task data and knowledge base. I can help you manage tasks or answer questions about how the team works."),
  ],
  'what is our refund policy?': [
    () => message(toolUse('search_knowledge_base', { query: 'refund policy' })),
    (results) => message(results[0]?.results?.length ? 'Unexpected: found refund content.' : cannotVerify),
  ],
  'delete task 9999': [
    () => message(toolUse('delete_task', { id: 9999 })),
    (results) => {
      const r = results[0]!;
      return message(r.ok ? 'Unexpected success.' : `There is no task #9999 (${r.error.code}), so nothing was deleted. Could you give me a valid task id? I can list your tasks if that helps.`);
    },
  ],
  'update the task': [
    () => message('Which task would you like to update, and what should change (title, description, status, priority or due date)? Give me the task id, or describe it and I can look it up.'),
  ],
  'delete task 3': [
    () => message(toolUse('delete_task', { id: 3 })),
    (results) => {
      const r = results[0]!;
      return message(r.ok ? `Task #${r.task.id} "${r.task.title}" will be deleted. This can't be undone — press **Confirm** to delete it, or **Cancel** to keep it.` : `I couldn't request that deletion: ${r.error.message}`);
    },
  ],
  'create a task called "prepare sprint demo" to rehearse the sprint demo with the team, low priority': [
    () => message(toolUse('create_task', { title: 'Prepare sprint demo', description: 'Rehearse the sprint demo with the team.', priority: 'low' })),
    (results) => {
      const r = results[0]!;
      return message(r.ok ? `Created #${r.created.id} "${r.created.title}" with low priority.` : `I couldn't create the task: ${r.error.message}`);
    },
  ],
  'delete the login task': [
    () => message(toolUse('list_tasks', { q: 'login' })),
    (results) => {
      const r = results[0]!;
      if (!r.ok) return message(`I couldn't search your tasks: ${r.error.message}`);
      if (r.tasks.length === 1) return message(toolUse('delete_task', { id: r.tasks[0].id }));
      return message(`More than one task mentions "login":\n${r.tasks.map(taskLine).join('\n')}\nWhich one should I delete?`);
    },
    (results) => message(`Task #${results[0]!.task.id} "${results[0]!.task.title}" will be deleted once you press **Confirm**.`),
  ],
  'the mobile one': [
    () => message(toolUse('list_tasks', { q: 'login mobile' })),
    (results) => {
      const t = results[0]?.tasks?.[0];
      return t ? message(toolUse('delete_task', { id: t.id })) : message("I couldn't find a mobile login task.");
    },
    (results) => {
      const r = results[0]!;
      return message(r.ok ? `Task #${r.task.id} "${r.task.title}" will be deleted. Press **Confirm** to proceed, or **Cancel** to keep it.` : r.error.message);
    },
  ],
  'mark task 1 as completed': [
    () => message(toolUse('update_task', { id: 1, fields: { status: 'completed' } })),
    (results) => {
      const r = results[0]!;
      return message(r.ok ? `Done — #${r.updated.id} "${r.updated.title}" is now completed.` : `I couldn't update it: ${r.error.message}`);
    },
  ],
};

export class OfflineScriptedLlm implements LlmClient {
  readonly model = 'offline-scripted-model';

  async createMessage(params: Params, options: LlmCallOptions): Promise<Msg> {
    // Locate the current user turn (last plain-text user message) and how many tool rounds followed it.
    let userIndex = -1;
    for (let i = params.messages.length - 1; i >= 0; i -= 1) {
      const m = params.messages[i]!;
      if (m.role === 'user' && typeof m.content === 'string') {
        userIndex = i;
        break;
      }
    }
    const userText = String(params.messages[userIndex]?.content ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const step = params.messages.slice(userIndex + 1).filter((m) => m.role === 'assistant').length;
    const last = params.messages.at(-1);
    const results: Results =
      last && Array.isArray(last.content)
        ? last.content
            .filter((b) => b.type === 'tool_result')
            .map((b) => JSON.parse(String((b as Anthropic.ToolResultBlockParam).content)))
        : [];
    const system = Array.isArray(params.system) ? params.system.map((s) => s.text).join('\n') : String(params.system ?? '');
    const weekEnd = system.match(/due on or before (\d{4}-\d{2}-\d{2})/)?.[1] ?? '9999-12-31';

    const script = SCRIPTS[userText];
    const reply = script?.[step]
      ? script[step]!(results, { weekEnd })
      : message(`(Offline demo model) I only know the scripted demo prompts. Configure ANTHROPIC_API_KEY with credits to use Claude.`);

    // Simulate streaming so the UI shows text arriving progressively.
    for (const block of reply.content) {
      if (block.type !== 'text' || !options.onTextDelta) continue;
      for (const chunk of block.text.match(/.{1,12}/gs) ?? []) {
        if (options.signal.aborted) break;
        options.onTextDelta(chunk);
        await new Promise((r) => setTimeout(r, 12));
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    return reply;
  }
}
