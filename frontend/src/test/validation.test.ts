import { describe, expect, it } from 'vitest';
import { validateTask } from '../lib/validation';
import { dueState, formatDueLabel } from '../lib/dates';

const now = new Date(2026, 10, 23, 12);
const base = { title: 'Fix login bug', description: 'Users cannot log in', status: 'pending', priority: 'high', dueDate: null } as const;

describe('validateTask (mirrors backend rules)', () => {
  it('accepts a valid task', () => {
    expect(validateTask({ ...base }, 'create', now)).toEqual({});
  });
  it('requires title (3-120 chars) and description', () => {
    expect(validateTask({ ...base, title: '  ', description: '' }, 'create', now)).toEqual({ title: 'Title is required', description: 'Description is required' });
    expect(validateTask({ ...base, title: 'ab' }, 'create', now).title).toMatch(/at least 3/);
    expect(validateTask({ ...base, title: 'x'.repeat(121) }, 'create', now).title).toMatch(/at most 120/);
  });
  it('rejects past due dates on create but allows them on edit', () => {
    expect(validateTask({ ...base, dueDate: '2026-11-22' }, 'create', now).dueDate).toMatch(/past/);
    expect(validateTask({ ...base, dueDate: '2026-11-22' }, 'edit', now)).toEqual({});
    expect(validateTask({ ...base, dueDate: '2026-11-23' }, 'create', now)).toEqual({});
  });
});

describe('due-date helpers', () => {
  it('classifies due dates by calendar day', () => {
    expect(dueState('2026-11-22', false, now)).toBe('overdue');
    expect(dueState('2026-11-23', false, now)).toBe('today');
    expect(dueState('2026-11-25', false, now)).toBe('soon');
    expect(dueState('2026-11-22', true, now)).toBe('done');
    expect(formatDueLabel('2026-11-21', false, now)).toBe('Overdue by 2 days');
    expect(formatDueLabel('2026-11-24', false, now)).toBe('Due tomorrow');
  });
});
