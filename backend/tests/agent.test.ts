import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ScriptedLlm, buildTestApp, hang, lastToolResults, reply, toolUse } from './helpers.js';
import { LlmError } from '../src/assistant/llm/types.js';

const chat = (app: Parameters<typeof request>[0], body: object, headers: Record<string, string> = {}) =>
  request(app).post('/api/assistant/chat').set(headers).send(body);

describe('assistant routing (required test cases)', () => {
  it('#1 knowledge-base question → route kb with cited evidence', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('search_knowledge_base', { query: 'difference between medium and high priority' })),
      (params) => {
        const [kb] = lastToolResults(params);
        expect(kb!.results[0].citation).toBe('priority-levels#medium-versus-high');
        return reply('High means someone is blocked right now; medium means important but nobody is blocked [priority-levels#medium-versus-high].');
      },
    ]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'What is the difference between medium and high priority?' }).expect(200);

    expect(res.body.route).toBe('kb');
    expect(res.body.toolCalls).toEqual([]);
    expect(res.body.evidence[0]).toMatchObject({ id: 'priority-levels#medium-versus-high', docId: 'priority-levels', title: 'Priority levels' });
    expect(res.body.evidence[0].score).toBeGreaterThanOrEqual(0.18);
    expect(res.body.evidence[0].snippet.length).toBeGreaterThan(10);
    expect(res.body.meta.groundingWarnings).toEqual([]);
  });

  it('#2 tool question → route tool, answers only from real tasks', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('list_tasks', { priority: 'high' })),
      (params) => {
        const [result] = lastToolResults(params);
        expect(result!.tasks.map((t: { id: number }) => t.id)).toEqual([8, 1, 3]);
        return reply('Your high priority tasks:\n- #8 Respond to Acme Corp escalation\n- #1 Fix login redirect loop on Safari\n- #3 Patch dependency security advisories');
      },
    ]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Show my high priority tasks' }).expect(200);

    expect(res.body.route).toBe('tool');
    expect(res.body.evidence).toEqual([]);
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'list_tasks', arguments: { priority: 'high' }, status: 'success' });
    expect(res.body.meta.groundingWarnings).toEqual([]);
  });

  it('#3 policy + action → route both, task created by the assistant with justified priority', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('search_knowledge_base', { query: 'priority for a bug that blocks login' })),
      () =>
        reply(
          toolUse('create_task', {
            title: 'Fix the login bug',
            description: 'Users cannot log in. Investigate and fix.',
            priority: 'high',
          }),
        ),
      (params) => {
        const [created] = lastToolResults(params);
        return reply(`Created #${created!.created.id} "Fix the login bug" as high priority, because a bug that prevents users from logging in blocks them [priority-levels#high-priority].`);
      },
    ]);
    const { app, container } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Create a task to fix the login bug and tell me what priority it should be' }).expect(200);

    expect(res.body.route).toBe('both');
    expect(res.body.evidence.map((e: { id: string }) => e.id)).toContain('priority-levels#high-priority');
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'create_task', status: 'success' });
    expect(res.body.meta.tasksChanged).toBe(true);
    expect(container.taskService.get(11)).toMatchObject({ title: 'Fix the login bug', priority: 'high', createdBy: 'assistant' });
  });

  it('#4a out of scope (no tools) → route none', async () => {
    const llm = new ScriptedLlm([() => reply("I can't verify that — weather is outside this team's tasks and knowledge base.")]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'What is the weather in Delhi?' }).expect(200);
    expect(res.body).toMatchObject({ route: 'none', evidence: [], toolCalls: [] });
  });

  it('#4b policy not in KB → retrieval below threshold, route none, model told to say it cannot verify', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('search_knowledge_base', { query: 'refund policy' })),
      (params) => {
        const [kb] = lastToolResults(params);
        expect(kb!.results).toEqual([]);
        expect(kb!.note).toContain('cannot verify');
        return reply("I couldn't verify that in the team's knowledge base — there is no refund policy documented.");
      },
    ]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'What is our refund policy?' }).expect(200);

    expect(res.body.route).toBe('none');
    expect(res.body.evidence).toEqual([]);
    expect(res.body.meta.retrieval[0]).toMatchObject({ query: 'refund policy', passed: [] });
  });

  it('#5 unknown id → clear TASK_NOT_FOUND tool error and no confirmation', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('delete_task', { id: 9999 })),
      (params) => {
        expect(lastToolResults(params)[0]).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        return reply('There is no task #9999. Could you give me a valid task id?');
      },
    ]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Delete task 9999' }).expect(200);
    expect(res.body.route).toBe('tool');
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'delete_task', status: 'error', error: { code: 'TASK_NOT_FOUND' } });
    expect(res.body.needsConfirmation).toBeNull();
  });

  it('#5b missing id ("Update the task") → no tool call, asks which task', async () => {
    const llm = new ScriptedLlm([() => reply('Which task would you like to update, and what should change? You can give me its id.')]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Update the task' }).expect(200);
    expect(res.body).toMatchObject({ route: 'none', toolCalls: [] });
  });

  it('#6 simulated tool failure → honest error, nothing changed', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('create_task', { title: 'Fix the login bug', description: 'Users cannot log in.' })),
      (params) => {
        expect(lastToolResults(params)[0]).toMatchObject({ ok: false, error: { code: 'TOOL_UNAVAILABLE' } });
        return reply("Sorry — the task service is unavailable right now, so I couldn't create the task. Nothing was changed.");
      },
    ]);
    const { app, container } = buildTestApp({ llm, config: { FORCE_TOOL_FAILURE: true } });
    const res = await chat(app, { message: 'Create a task to fix the login bug' }).expect(200);
    expect(res.body.toolCalls[0]).toMatchObject({ status: 'error', error: { code: 'TOOL_UNAVAILABLE' } });
    expect(res.body.meta.tasksChanged).toBe(false);
    expect(container.taskService.list().meta.total).toBe(10);
  });

  it('#6b failure can be injected per request with the dev-only header', async () => {
    const llm = new ScriptedLlm([() => reply(toolUse('list_tasks', {})), () => reply('The task service is unavailable.')]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'list tasks' }, { 'X-Simulate-Tool-Failure': 'true' }).expect(200);
    expect(res.body.toolCalls[0].error.code).toBe('TOOL_UNAVAILABLE');
  });
});

describe('#7 destructive actions need explicit confirmation', () => {
  const deleteScript = () =>
    new ScriptedLlm([
      () => reply(toolUse('delete_task', { id: 3 })),
      (params) => {
        expect(lastToolResults(params)[0]).toMatchObject({ ok: true, status: 'awaiting_user_confirmation' });
        return reply('Task #3 "Patch dependency security advisories" will be deleted. Please press Confirm to proceed.');
      },
    ]);

  it('parks the delete, then executes it only on confirm (exactly once)', async () => {
    const { app, container } = buildTestApp({ llm: deleteScript() });
    const first = await chat(app, { message: 'Delete task 3' }).expect(200);

    expect(first.body.route).toBe('tool');
    expect(first.body.toolCalls[0].status).toBe('pending_confirmation');
    expect(first.body.needsConfirmation).toMatchObject({ action: 'delete_task', taskId: 3, taskTitle: 'Patch dependency security advisories' });
    expect(container.taskService.get(3)).toBeDefined(); // not deleted yet
    expect(first.body.meta.tasksChanged).toBe(false);

    const { pendingActionId } = first.body.needsConfirmation;
    const confirm = await chat(app, { confirm: true, pendingActionId, conversationId: first.body.conversationId }).expect(200);
    expect(confirm.body.toolCalls[0]).toMatchObject({ name: 'delete_task', status: 'success' });
    expect(confirm.body.meta).toMatchObject({ llmCalls: 0, tasksChanged: true });
    expect(() => container.taskService.get(3)).toThrow(/not found/);

    // Replaying the confirmation (double click without idempotency key) cannot delete again.
    const again = await chat(app, { confirm: true, pendingActionId }).expect(409);
    expect(again.body.error.code).toBe('CONFIRMATION_NOT_FOUND');
  });

  it('cancel keeps the task', async () => {
    const { app, container } = buildTestApp({ llm: deleteScript() });
    const first = await chat(app, { message: 'Delete task 3' });
    const cancel = await chat(app, { confirm: false, pendingActionId: first.body.needsConfirmation.pendingActionId }).expect(200);
    expect(cancel.body.toolCalls[0].status).toBe('cancelled');
    expect(container.taskService.get(3)).toBeDefined();
  });

  it('refuses a stale confirmation when the task changed in between', async () => {
    const { app, container } = buildTestApp({ llm: deleteScript(), now: () => new Date() });
    const first = await chat(app, { message: 'Delete task 3' });
    await new Promise((r) => setTimeout(r, 5));
    container.taskService.update(3, { priority: 'low' });
    const res = await chat(app, { confirm: true, pendingActionId: first.body.needsConfirmation.pendingActionId }).expect(409);
    expect(res.body.error.code).toBe('TASK_CHANGED');
    expect(container.taskService.get(3)).toBeDefined();
  });

  it('rejects unknown pending action ids', async () => {
    const { app } = buildTestApp({ llm: deleteScript() });
    const res = await chat(app, { confirm: true, pendingActionId: '00000000-0000-4000-8000-000000000000' }).expect(409);
    expect(res.body.error.code).toBe('CONFIRMATION_NOT_FOUND');
  });
});

describe('#8 duplicate protection', () => {
  const createScript = () =>
    new ScriptedLlm([
      () => reply(toolUse('create_task', { title: 'Fix the login bug', description: 'Users cannot log in.' })),
      () => reply('Created the task.'),
    ]);

  it('same request + same Idempotency-Key → one task, one LLM run, replayed response', async () => {
    const llm = createScript();
    const { app, container } = buildTestApp({ llm });
    const body = { message: 'Create a task to fix the login bug' };
    const headers = { 'Idempotency-Key': 'chat-create-login-0001' };
    const [a, b] = await Promise.all([chat(app, body, headers), chat(app, body, headers)]);
    const c = await chat(app, body, headers);

    expect(a.body).toEqual(b.body);
    expect(c.headers['idempotent-replayed']).toBe('true');
    expect(llm.calls).toHaveLength(2); // a single agent run (tool step + answer step)
    expect(container.taskService.list({ q: 'login bug' }).meta.total).toBe(1);
  });

  it('model repeating the identical write in one turn executes it once', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('create_task', { title: 'Fix the login bug', description: 'Users cannot log in.' })),
      () => reply(toolUse('create_task', { description: 'Users cannot log in.', title: 'Fix the login bug' })),
      () => reply('Created the task.'),
    ]);
    const { app, container } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Create a task to fix the login bug' }).expect(200);
    expect(res.body.toolCalls[1].deduplicated).toBe(true);
    expect(container.taskService.list({ q: 'login bug' }).meta.total).toBe(1);
  });
});

describe('edge cases and resilience', () => {
  it('rejects empty input with 400 EMPTY_MESSAGE (no LLM call)', async () => {
    const llm = new ScriptedLlm([]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: '   ' }).expect(400);
    expect(res.body.error.code).toBe('EMPTY_MESSAGE');
    expect(llm.calls).toHaveLength(0);
  });

  it('rejects unknown body fields and oversized messages', async () => {
    const { app } = buildTestApp({ llm: new ScriptedLlm([]) });
    await chat(app, { message: 'hi', foo: 1 }).expect(400);
    await chat(app, { message: 'x'.repeat(2001) }).expect(400);
  });

  it('invalid tool arguments → INVALID_ARGUMENTS with field details, nothing written', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('update_task', { id: 2, fields: { priority: 'urgent', owner: 'sam' } })),
      (params) => {
        const [result] = lastToolResults(params);
        expect(result!.error.code).toBe('INVALID_ARGUMENTS');
        expect(JSON.stringify(result!.error.details)).toMatch(/owner/);
        return reply('Priority must be low, medium or high, and owner is not a task field.');
      },
    ]);
    const { app, container } = buildTestApp({ llm });
    await chat(app, { message: 'make task 2 urgent and assign to sam' }).expect(200);
    expect(container.taskService.get(2).priority).toBe('medium');
  });

  it('missing API key → 503 with a helpful answer', async () => {
    const { app } = buildTestApp({ llm: null });
    const res = await chat(app, { message: 'hello' }).expect(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
    expect(res.body.answer).toMatch(/dashboard/);
  });

  it('LLM timeout → retried once, then an honest 503 with no changes', async () => {
    const llm = new ScriptedLlm([hang, hang]);
    const { app } = buildTestApp({ llm, config: { LLM_TIMEOUT_MS: 1000, LLM_MAX_RETRIES: 1, ASSISTANT_DEADLINE_MS: 6000 } });
    const res = await chat(app, { message: 'Show my tasks' }).expect(503);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
    expect(res.body.meta.degraded).toBe(true);
    expect(llm.calls).toHaveLength(2);
  }, 10_000);

  it('LLM fails AFTER a write → 200 degraded answer built from the audit trail (no retry of the write)', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('create_task', { title: 'Fix the login bug', description: 'Users cannot log in.' })),
      () => {
        throw new LlmError('unavailable', 'overloaded', false);
      },
    ]);
    const { app, container } = buildTestApp({ llm });
    const res = await chat(app, { message: 'Create a task to fix the login bug' }).expect(200);
    expect(res.body.meta.degraded).toBe(true);
    expect(res.body.answer).toContain('Created task #11 "Fix the login bug"');
    expect(container.taskService.list({ q: 'login bug' }).meta.total).toBe(1);
  });

  it('circuit breaker opens after repeated outages and then fails fast without calling the LLM', async () => {
    const down = () => {
      throw new LlmError('unavailable', 'down', true);
    };
    const llm = new ScriptedLlm([down, down, down]);
    const { app } = buildTestApp({ llm, config: { LLM_MAX_RETRIES: 0, CIRCUIT_FAILURE_THRESHOLD: 3 } });
    for (let i = 0; i < 3; i += 1) await chat(app, { message: `hi ${i}` }).expect(503);
    const fast = await chat(app, { message: 'hi again' }).expect(503);
    expect(fast.body.error.code).toBe('LLM_CIRCUIT_OPEN');
    expect(llm.calls).toHaveLength(3);
  });

  it('grounding: strips citations that were not retrieved and flags invented task ids', async () => {
    const llm = new ScriptedLlm([() => reply('Per policy [refund-policy#overview], task #42 is overdue.')]);
    const { app } = buildTestApp({ llm });
    const res = await chat(app, { message: 'anything overdue?' }).expect(200);
    expect(res.body.answer).not.toContain('[refund-policy#overview]');
    expect(res.body.meta.groundingWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('refund-policy#overview'), expect.stringContaining('#42')]),
    );
  });

  it('keeps short conversation memory so follow-ups resolve ambiguous references', async () => {
    const llm = new ScriptedLlm([
      () => reply(toolUse('list_tasks', { q: 'login' })),
      () => reply('Two tasks match "login":\n- #1 Fix login redirect loop on Safari\n- #5 Investigate login timeout errors in mobile app\nWhich one should I delete?'),
      (params) => {
        // The follow-up turn sees the previous exchange (text only, no stale tool results).
        expect(params.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
        return reply(toolUse('delete_task', { id: 5 }));
      },
      () => reply('Task #5 will be deleted once you press Confirm.'),
    ]);
    const { app } = buildTestApp({ llm });
    const first = await chat(app, { message: 'delete the login task' }).expect(200);
    expect(first.body.needsConfirmation).toBeNull();
    const second = await chat(app, { message: 'the mobile one', conversationId: first.body.conversationId }).expect(200);
    expect(second.body.needsConfirmation.taskId).toBe(5);
  });

  it('streams progress over SSE and ends with a done event carrying the full response', async () => {
    const llm = new ScriptedLlm([() => reply(toolUse('list_tasks', { status: 'pending' })), () => reply('Here are your pending tasks.')]);
    const { app } = buildTestApp({ llm });
    const res = await request(app).post('/api/assistant/chat/stream').send({ message: 'pending tasks?' }).expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = [...res.text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events).toEqual(expect.arrayContaining(['status', 'tool_start', 'tool_end', 'done']));
    expect(events.at(-1)).toBe('done');
    const done = JSON.parse(res.text.split('event: done\ndata: ')[1]!.split('\n')[0]!);
    expect(done.body).toMatchObject({ route: 'tool', answer: 'Here are your pending tasks.' });
  });
});
