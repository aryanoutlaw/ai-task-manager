/**
 * Assistant evaluation against the REAL LLM.
 *
 * Boots the app in-process on a random port (fresh seed data every run), sends the required test
 * cases over real HTTP, checks each response, and prints PASS/FAIL.
 *
 *   npm run eval                       # run once
 *   npm run eval -- --runs 3           # repeat to measure stability (LLMs are non-deterministic)
 *   npm run eval -- --write-docs       # also regenerate docs/sample-requests.md from the real responses
 *   npm run eval -- --only 3,7         # run selected cases
 *
 * Requires ANTHROPIC_API_KEY (backend/.env or repo-root .env).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { ChatResponse } from '../src/assistant/types.js';

// Keep the eval output readable: app logs are silenced unless LOG_LEVEL is set explicitly.
// (Set before the app modules load, because env is parsed at import time.)
process.env.LOG_LEVEL ??= 'silent';
const { createApp } = await import('../src/app.js');
const { createContainer } = await import('../src/container.js');

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 1;
const WRITE_DOCS = args.includes('--write-docs');
const ONLY = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1]!.split(',')) : null;

interface Exchange {
  label: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  status: number;
  response: unknown;
  responseHeaders: Record<string, string>;
}

interface CaseContext {
  call: (label: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; headers: Headers }>;
  chat: (label: string, body: object, headers?: Record<string, string>) => Promise<{ status: number; body: ChatResponse; headers: Headers }>;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface EvalCase {
  id: string;
  title: string;
  input: string;
  expected: string;
  run: (ctx: CaseContext) => Promise<Check[]>;
}

const check = (name: string, ok: boolean, detail?: string): Check => ({ name, ok, ...(detail ? { detail } : {}) });
const idsIn = (text: string) => [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const toolNames = (r: ChatResponse) => r.toolCalls.map((c) => c.name);

const CASES: EvalCase[] = [
  {
    id: '1',
    title: 'Knowledge-base question',
    input: 'What is the difference between medium and high priority?',
    expected: 'route `kb`, cites the priority document',
    run: async ({ chat }) => {
      const { status, body } = await chat('Ask a policy question', { message: 'What is the difference between medium and high priority?', confirm: false, pendingActionId: null });
      return [
        check('HTTP 200', status === 200, String(status)),
        check('route is kb', body.route === 'kb', body.route),
        check('cites priority-levels', body.evidence.some((e) => e.docId === 'priority-levels'), body.evidence.map((e) => e.id).join(', ')),
        check('all evidence above threshold', body.evidence.every((e) => e.score >= 0.18)),
        check('no task tools used', body.toolCalls.length === 0, toolNames(body).join(', ')),
      ];
    },
  },
  {
    id: '2',
    title: 'Tool question',
    input: 'Show my high priority tasks',
    expected: 'route `tool`, real tasks only',
    run: async ({ chat, call }) => {
      const { body } = await chat('List high priority tasks', { message: 'Show my high priority tasks', confirm: false, pendingActionId: null });
      const real = await call('Ground truth (REST)', 'GET', '/api/tasks?priority=high&limit=100');
      const realIds = new Set<number>(real.body.data.map((t: { id: number }) => t.id));
      const mentioned = idsIn(body.answer);
      return [
        check('route is tool', body.route === 'tool', body.route),
        check('called list_tasks with priority=high', body.toolCalls.some((c) => c.name === 'list_tasks' && (c.arguments as { priority?: string }).priority === 'high')),
        check('mentions every high-priority task', [...realIds].every((id) => mentioned.includes(id)), `answer ids ${mentioned.join(',')} vs real ${[...realIds].join(',')}`),
        check('mentions no other task ids', mentioned.every((id) => realIds.has(id))),
        check('no grounding warnings', body.meta.groundingWarnings.length === 0, body.meta.groundingWarnings.join('; ')),
      ];
    },
  },
  {
    id: '3',
    title: 'Policy plus action',
    input: 'Create a task to fix the login bug and tell me what priority it should be',
    expected: 'route `both`, task created, priority justified by policy',
    run: async ({ chat, call }) => {
      const { body } = await chat('Create a task + justify priority', { message: 'Create a task to fix the login bug and tell me what priority it should be', confirm: false, pendingActionId: null });
      const created = body.toolCalls.find((c) => c.name === 'create_task' && c.status === 'success');
      const task = (created?.result as { created?: { id: number; priority: string; createdBy: string } } | undefined)?.created;
      const fetched = task ? await call('Verify the created task (REST)', 'GET', `/api/tasks/${task.id}`) : null;
      return [
        check('route is both', body.route === 'both', body.route),
        check('create_task succeeded', Boolean(task)),
        check('priority is high (login bug blocks users)', task?.priority === 'high', task?.priority),
        check('createdBy is assistant', fetched?.body.data.createdBy === 'assistant'),
        check('cites priority policy', body.evidence.some((e) => e.docId === 'priority-levels'), body.evidence.map((e) => e.id).join(', ')),
        check('tasksChanged flag set', body.meta.tasksChanged),
      ];
    },
  },
  {
    id: '4a',
    title: 'Outside the knowledge base (general)',
    input: 'What is the weather in Delhi?',
    expected: 'route `none`, says it cannot verify',
    run: async ({ chat }) => {
      const { body } = await chat('Out-of-scope question', { message: 'What is the weather in Delhi?', confirm: false, pendingActionId: null });
      return [
        check('route is none', body.route === 'none', body.route),
        check('no tools, no evidence', body.toolCalls.length === 0 && body.evidence.length === 0),
        check('declines / cannot verify', /can(no|')t|unable|not able|outside|don't have/i.test(body.answer), body.answer.slice(0, 120)),
      ];
    },
  },
  {
    id: '4b',
    title: 'Outside the knowledge base (policy)',
    input: 'What is our refund policy?',
    expected: 'route `none`, says it cannot verify (retrieval below threshold)',
    run: async ({ chat }) => {
      const { body } = await chat('Undocumented policy', { message: 'What is our refund policy?', confirm: false, pendingActionId: null });
      const best = body.meta.retrieval.flatMap((r) => [...r.passed, ...r.rejected]).reduce((m, r) => Math.max(m, r.score), 0);
      return [
        check('route is none', body.route === 'none', body.route),
        check('no evidence returned', body.evidence.length === 0),
        check('retrieval below threshold (if searched)', body.meta.retrieval.every((r) => r.passed.length === 0), `best score ${best}`),
        check('says it cannot verify', /verif|couldn't find|could not find|not (covered|documented)|no information/i.test(body.answer), body.answer.slice(0, 120)),
      ];
    },
  },
  {
    id: '5a',
    title: 'Invalid id',
    input: 'Delete task 9999',
    expected: 'clear error, asks for a valid id',
    run: async ({ chat }) => {
      const { body } = await chat('Delete a task that does not exist', { message: 'Delete task 9999', confirm: false, pendingActionId: null });
      const err = body.toolCalls.find((c) => c.status === 'error');
      return [
        check('tool reported TASK_NOT_FOUND', err?.error?.code === 'TASK_NOT_FOUND', err?.error?.code),
        check('no confirmation requested', body.needsConfirmation === null),
        check('answer says it was not found', /not (be )?found|doesn't exist|does not exist|no task/i.test(body.answer), body.answer.slice(0, 120)),
      ];
    },
  },
  {
    id: '5b',
    title: 'Missing id',
    input: 'Update the task',
    expected: 'asks which task / what to change; no write',
    run: async ({ chat }) => {
      const { body } = await chat('Update without saying which task', { message: 'Update the task', confirm: false, pendingActionId: null });
      return [
        check('no write tools called', !body.toolCalls.some((c) => ['update_task', 'create_task', 'delete_task'].includes(c.name)), toolNames(body).join(', ')),
        check('asks a clarifying question', body.answer.includes('?'), body.answer.slice(0, 120)),
      ];
    },
  },
  {
    id: '6',
    title: 'Simulated tool failure',
    input: 'Show my high priority tasks  (header X-Simulate-Tool-Failure: true)',
    expected: 'honest error, no made-up result',
    run: async ({ chat }) => {
      const { body } = await chat('Tool failure injected', { message: 'Show my high priority tasks', confirm: false, pendingActionId: null }, { 'X-Simulate-Tool-Failure': 'true' });
      return [
        check('tool call failed with TOOL_UNAVAILABLE', body.toolCalls.some((c) => c.error?.code === 'TOOL_UNAVAILABLE')),
        check('answer admits the failure', /unavailable|fail|couldn't|could not|unable|error/i.test(body.answer), body.answer.slice(0, 120)),
        check('answer lists no task ids', idsIn(body.answer).length === 0, idsIn(body.answer).join(',')),
        check('no data changed', !body.meta.tasksChanged),
      ];
    },
  },
  {
    id: '7',
    title: 'Destructive action',
    input: 'Delete task 3  →  then confirm',
    expected: 'asks for confirmation, runs only after confirm',
    run: async ({ chat, call }) => {
      const first = await chat('Ask to delete task 3', { message: 'Delete task 3', confirm: false, pendingActionId: null });
      const pending = first.body.needsConfirmation;
      const stillThere = await call('Task 3 still exists before confirming (REST)', 'GET', '/api/tasks/3');
      const confirm = pending
        ? await chat('Confirm the pending delete', { message: '', confirm: true, pendingActionId: pending.pendingActionId, conversationId: first.body.conversationId })
        : null;
      const gone = await call('Task 3 is gone after confirming (REST)', 'GET', '/api/tasks/3');
      const replay = pending ? await chat('Re-sending the same confirmation is rejected', { message: '', confirm: true, pendingActionId: pending.pendingActionId }) : null;
      return [
        check('needsConfirmation for task 3', pending?.taskId === 3),
        check('not deleted before confirm', stillThere.status === 200),
        check('confirm executes delete', confirm?.status === 200 && confirm.body.toolCalls[0]?.status === 'success'),
        check('task gone after confirm', gone.status === 404),
        check('confirmation is single-use (409)', replay?.status === 409),
      ];
    },
  },
  {
    id: '8',
    title: 'Duplicate request',
    input: 'Same create request sent twice with one Idempotency-Key',
    expected: 'one task created',
    run: async ({ chat, call }) => {
      const body = { message: 'Create a task called "Prepare sprint demo" to rehearse the sprint demo with the team, low priority', confirm: false, pendingActionId: null };
      const headers = { 'Idempotency-Key': `eval-dup-${Date.now()}` };
      const [a, b] = await Promise.all([chat('Create (attempt 1)', body, headers), chat('Create (attempt 2, same key, sent concurrently)', body, headers)]);
      const c = await chat('Create (attempt 3, client retry with same key)', body, headers);
      const list = await call('Count matching tasks (REST)', 'GET', '/api/tasks?q=sprint demo');
      return [
        check('responses identical', JSON.stringify(a.body) === JSON.stringify(b.body) && JSON.stringify(a.body) === JSON.stringify(c.body)),
        check('retry marked Idempotent-Replayed', c.headers.get('idempotent-replayed') === 'true'),
        check('exactly one task created', list.body.meta.total === 1, `found ${list.body.meta.total}`),
      ];
    },
  },
  {
    id: 'A',
    title: 'Ambiguous reference (bonus)',
    input: 'Delete the login task',
    expected: 'lists both matches, asks which; nothing parked',
    run: async ({ chat }) => {
      const { body } = await chat('Ambiguous delete', { message: 'Delete the login task', confirm: false, pendingActionId: null });
      const ids = idsIn(body.answer);
      return [
        check('no confirmation parked', body.needsConfirmation === null),
        check('mentions both login tasks (#1, #5)', ids.includes(1) && ids.includes(5), ids.join(',')),
        check('asks the user to choose', body.answer.includes('?')),
      ];
    },
  },
];

async function runOnce(runIndex: number) {
  const container = createContainer({ seed: true });
  if (!container.llm) throw new Error('ANTHROPIC_API_KEY is not set — the eval needs the real LLM.');
  const app = createApp(container);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const results: Array<{ c: EvalCase; checks: Check[]; exchanges: Exchange[]; error?: string }> = [];

  for (const c of CASES) {
    if (ONLY && !ONLY.has(c.id)) continue;
    const exchanges: Exchange[] = [];
    const call: CaseContext['call'] = async (label, method, urlPath, body, headers = {}) => {
      const reqHeaders = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
      const res = await fetch(base + urlPath, { method, headers: reqHeaders, body: body !== undefined ? JSON.stringify(body) : undefined });
      const json = await res.json();
      const keep = ['idempotent-replayed', 'x-request-id'];
      exchanges.push({
        label, method, path: urlPath, headers: reqHeaders, body, status: res.status, response: json,
        responseHeaders: Object.fromEntries([...res.headers.entries()].filter(([k]) => keep.includes(k))),
      });
      return { status: res.status, body: json, headers: res.headers };
    };
    const chat: CaseContext['chat'] = (label, body, headers) => call(label, 'POST', '/api/assistant/chat', body, headers);

    process.stdout.write(`  [${c.id.padEnd(2)}] ${c.title.padEnd(40)} `);
    try {
      const checks = await c.run({ call, chat });
      // Guard against false passes: an LLM outage (5xx) must never count as a correct answer.
      const serverErrors = exchanges.filter((x) => x.status >= 500);
      checks.unshift(check('no 5xx responses (LLM reachable)', serverErrors.length === 0, serverErrors.map((x) => `${x.status} ${(x.response as { error?: { code?: string } }).error?.code ?? ''}`).join(', ')));
      results.push({ c, checks, exchanges });
      const failed = checks.filter((x) => !x.ok);
      console.log(failed.length ? `\x1b[31mFAIL\x1b[0m` : `\x1b[32mPASS\x1b[0m`);
      for (const f of failed) console.log(`         ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    } catch (error) {
      results.push({ c, checks: [], exchanges, error: (error as Error).message });
      console.log(`\x1b[31mERROR\x1b[0m ${(error as Error).message}`);
    }
  }
  server.close();
  if (WRITE_DOCS && runIndex === 0) writeDocs(results, container.config.ANTHROPIC_MODEL);
  return results;
}

function writeDocs(results: Awaited<ReturnType<typeof runOnce>>, model: string) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.resolve(here, '../../docs/sample-requests.md');
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    '# Sample requests and real responses',
    '',
    `Generated by \`npm run eval -- --write-docs\` on ${date} against **${model}**, with the seed data loaded`,
    '(dates are relative to the day of the run). Every request below was actually sent to the running API and every',
    'response is the verbatim JSON it returned, so this file cannot drift from the real behaviour.',
    '',
    '> Long fields (full task lists inside tool results) are shown in full; `meta.usage` shows the token cost of each turn.',
    '',
    '## Summary',
    '',
    '| # | Case | Input | Expected | Result |',
    '|---|---|---|---|---|',
    ...results.map(({ c, checks, error }) => `| ${c.id} | ${c.title} | ${c.input} | ${c.expected} | ${error ? 'ERROR' : checks.every((x) => x.ok) ? '✅ pass' : `❌ ${checks.filter((x) => !x.ok).map((x) => x.name).join('; ')}`} |`),
    '',
  ];
  for (const { c, checks, exchanges } of results) {
    lines.push(`## ${c.id}. ${c.title}`, '', `**Expected:** ${c.expected}`, '');
    lines.push('**Checks:**', '', ...checks.map((x) => `- ${x.ok ? '✅' : '❌'} ${x.name}${x.detail && !x.ok ? ` — ${x.detail}` : ''}`), '');
    for (const ex of exchanges) {
      const headerFlags = Object.entries(ex.headers).filter(([k]) => k !== 'Content-Type').map(([k, v]) => ` \\\n  -H '${k}: ${v}'`).join('');
      lines.push(`### ${ex.label}`, '', '```bash');
      lines.push(
        ex.body !== undefined
          ? `curl -s -X ${ex.method} http://localhost:4000${ex.path} \\\n  -H 'Content-Type: application/json'${headerFlags} \\\n  -d '${JSON.stringify(ex.body).replace(/'/g, "'\\''")}'`
          : `curl -s http://localhost:4000${ex.path}${headerFlags}`,
      );
      lines.push('```', '', `Response **${ex.status}**${Object.keys(ex.responseHeaders).length ? ` (${Object.entries(ex.responseHeaders).filter(([k]) => k !== 'x-request-id').map(([k, v]) => `\`${k}: ${v}\``).join(', ')})` : ''}:`, '', '```json', JSON.stringify(ex.response, null, 2), '```', '');
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

const totals = new Map<string, { pass: number; total: number }>();
for (let i = 0; i < RUNS; i += 1) {
  console.log(`\nRun ${i + 1}/${RUNS}`);
  const results = await runOnce(i);
  for (const r of results) {
    const t = totals.get(r.c.id) ?? { pass: 0, total: 0 };
    t.total += 1;
    if (!r.error && r.checks.every((x) => x.ok)) t.pass += 1;
    totals.set(r.c.id, t);
  }
}
const all = [...totals.values()].reduce((a, t) => ({ pass: a.pass + t.pass, total: a.total + t.total }), { pass: 0, total: 0 });
console.log(`\nPassed ${all.pass}/${all.total} case runs${RUNS > 1 ? ` (${[...totals.entries()].map(([id, t]) => `${id}:${t.pass}/${t.total}`).join(' ')})` : ''}`);
process.exit(all.pass === all.total ? 0 : 1);
