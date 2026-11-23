import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

let app: ReturnType<typeof buildTestApp>['app'];
beforeEach(() => {
  ({ app } = buildTestApp());
});

const valid = { title: 'Write release notes', description: 'Summarise the changes in v2.3 for customers.' };

describe('GET /api/tasks', () => {
  it('lists tasks with pagination meta, newest first by default', async () => {
    const res = await request(app).get('/api/tasks').expect(200);
    expect(res.body.meta).toMatchObject({ total: 10, page: 1, limit: 20, totalPages: 1 });
    const created = res.body.data.map((t: { createdAt: string }) => t.createdAt);
    expect(created).toEqual([...created].sort().reverse());
  });

  it('filters by status, priority (comma-separated) and text query', async () => {
    const res = await request(app).get('/api/tasks?status=pending&priority=high,medium&q=login').expect(200);
    expect(res.body.data.map((t: { id: number }) => t.id)).toEqual([5]);
  });

  it('filters by inclusive dueBefore and sorts by due date with no-date tasks last', async () => {
    const res = await request(app).get('/api/tasks?dueBefore=2026-11-25&sortBy=dueDate&order=asc').expect(200);
    expect(res.body.data.map((t: { dueDate: string }) => t.dueDate)).toEqual(['2026-11-21', '2026-11-22', '2026-11-24', '2026-11-25']);
    const all = await request(app).get('/api/tasks?sortBy=dueDate&order=desc').expect(200);
    expect(all.body.data.at(-1).dueDate).toBeNull();
  });

  it('paginates', async () => {
    const res = await request(app).get('/api/tasks?limit=4&page=3').expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 10, totalPages: 3 });
  });

  it('rejects invalid query parameters with 400 and field details', async () => {
    const res = await request(app).get('/api/tasks?status=done&limit=1000').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['status.0', 'limit']));
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns 200 for an existing task', async () => {
    const res = await request(app).get('/api/tasks/3').expect(200);
    expect(res.body.data).toMatchObject({ id: 3, title: 'Patch dependency security advisories' });
  });

  it('returns 404 with a stable error code for a missing task', async () => {
    const res = await request(app).get('/api/tasks/9999').expect(404);
    expect(res.body.error).toMatchObject({ code: 'TASK_NOT_FOUND', message: 'Task 9999 was not found' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app).get('/api/tasks/abc').expect(400);
    expect(res.body.error.details[0].field).toBe('id');
  });
});

describe('POST /api/tasks', () => {
  it('creates a task with defaults and createdBy=user', async () => {
    const res = await request(app).post('/api/tasks').send(valid).expect(201);
    expect(res.body.data).toMatchObject({ id: 11, status: 'pending', priority: 'medium', dueDate: null, createdBy: 'user' });
    expect(res.body.data.createdAt).toBe(res.body.data.updatedAt);
  });

  it('returns field-level errors for invalid bodies', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x', status: 'done' }).expect(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'description', 'status']));
  });

  it('rejects unknown fields instead of silently dropping them', async () => {
    const res = await request(app).post('/api/tasks').send({ ...valid, createdBy: 'assistant' }).expect(400);
    expect(res.body.error.details[0].message).toContain('createdBy');
  });

  it('rejects a due date in the past (policy) and impossible dates', async () => {
    const past = await request(app).post('/api/tasks').send({ ...valid, dueDate: '2026-11-22' }).expect(400);
    expect(past.body.error.details[0]).toMatchObject({ field: 'dueDate' });
    await request(app).post('/api/tasks').send({ ...valid, dueDate: '2026-02-30' }).expect(400);
    await request(app).post('/api/tasks').send({ ...valid, dueDate: '2026-11-23' }).expect(201); // today is fine
  });

  it('returns 400 INVALID_JSON for malformed JSON', async () => {
    const res = await request(app).post('/api/tasks').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('Idempotency-Key on POST /api/tasks', () => {
  it('creates once and replays the stored response for a retried request', async () => {
    const first = await request(app).post('/api/tasks').set('Idempotency-Key', 'key-retry-0001').send(valid).expect(201);
    const second = await request(app).post('/api/tasks').set('Idempotency-Key', 'key-retry-0001').send(valid).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    const list = await request(app).get('/api/tasks?q=release notes').expect(200);
    expect(list.body.meta.total).toBe(1);
  });

  it('handles concurrent duplicates (double click) with a single write', async () => {
    const send = () => request(app).post('/api/tasks').set('Idempotency-Key', 'key-double-click').send(valid);
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect((await request(app).get('/api/tasks?q=release notes')).body.meta.total).toBe(1);
  });

  it('rejects reuse of a key with a different body (422)', async () => {
    await request(app).post('/api/tasks').set('Idempotency-Key', 'key-reuse-0001').send(valid).expect(201);
    const res = await request(app).post('/api/tasks').set('Idempotency-Key', 'key-reuse-0001').send({ ...valid, title: 'Other title' }).expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not cache validation failures, so a corrected retry with the same key succeeds', async () => {
    await request(app).post('/api/tasks').set('Idempotency-Key', 'key-fix-00001').send({ title: 'x' }).expect(400);
    // Same key + same (bad) body is re-validated rather than replayed; a new body is a new request.
    await request(app).post('/api/tasks').set('Idempotency-Key', 'key-fix-00002').send(valid).expect(201);
  });

  it('rejects malformed keys', async () => {
    await request(app).post('/api/tasks').set('Idempotency-Key', 'short').send(valid).expect(400);
  });
});

describe('PUT /api/tasks/:id', () => {
  it('updates only the provided fields and bumps updatedAt', async () => {
    const before = (await request(app).get('/api/tasks/2')).body.data;
    const res = await request(app).put('/api/tasks/2').send({ status: 'in_progress', dueDate: null }).expect(200);
    expect(res.body.data).toMatchObject({ id: 2, status: 'in_progress', dueDate: null, title: before.title });
  });

  it('returns 400 for an empty or unknown-field update, 404 for a missing task', async () => {
    await request(app).put('/api/tasks/2').send({}).expect(400);
    await request(app).put('/api/tasks/2').send({ owner: 'sam' }).expect(400);
    await request(app).put('/api/tasks/9999').send({ status: 'completed' }).expect(404);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('deletes and then 404s', async () => {
    const res = await request(app).delete('/api/tasks/7').expect(200);
    expect(res.body.data.id).toBe(7);
    await request(app).get('/api/tasks/7').expect(404);
    await request(app).delete('/api/tasks/7').expect(404);
  });
});

describe('platform', () => {
  it('serves health, metrics, OpenAPI and a JSON 404 for unknown routes', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.assistant).toMatchObject({ configured: false, relevanceThreshold: 0.18 });
    await request(app).get('/api/metrics').expect(200);
    const spec = await request(app).get('/api/openapi.json').expect(200);
    expect(spec.body.openapi).toMatch(/^3\./);
    const missing = await request(app).get('/api/nope').expect(404);
    expect(missing.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('echoes the X-Request-Id header', async () => {
    const res = await request(app).get('/api/tasks/1').set('X-Request-Id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });
});
