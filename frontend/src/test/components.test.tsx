import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskForm, EMPTY_TASK } from '../components/tasks/TaskForm';
import { RichText } from '../components/assistant/RichText';
import { parseFrame } from '../api/assistant';

describe('TaskForm', () => {
  it('blocks submit and shows errors until the form is valid', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <TaskForm id="f" mode="create" initial={EMPTY_TASK} onSubmit={onSubmit} />
        <button type="submit" form="f">Save</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText(/Title/), 'Fix login bug');
    await user.type(screen.getByLabelText(/Description/), 'Users cannot log in');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fix login bug', priority: 'medium', status: 'pending' }));
  });

  it('shows server-side field errors', () => {
    render(<TaskForm id="f" mode="create" initial={EMPTY_TASK} serverErrors={{ dueDate: 'Due date cannot be in the past' }} onSubmit={() => {}} />);
    expect(screen.getByText('Due date cannot be in the past')).toBeInTheDocument();
  });
});

describe('RichText', () => {
  const evidence = [{ id: 'priority-levels#high-priority', docId: 'priority-levels', title: 'Priority levels', section: 'High priority', score: 0.5, snippet: '…' }];

  it('renders lists, bold, numbered citations and clickable task references (no raw HTML)', async () => {
    const onOpenTask = vi.fn();
    render(<RichText text={'**High** blocks users [priority-levels#high-priority].\n- #3 Patch deps\n- <b>not html</b>'} evidence={evidence} onOpenTask={onOpenTask} />);
    expect(screen.getByText('High').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '#evidence-1');
    expect(screen.getByText('<b>not html</b>')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '#3' }));
    expect(onOpenTask).toHaveBeenCalledWith(3);
  });
});

describe('SSE frame parser', () => {
  it('parses event/data frames and ignores keep-alive comments', () => {
    expect(parseFrame('event: done\ndata: {"status":200}')).toEqual({ event: 'done', data: { status: 200 } });
    expect(parseFrame(': keep-alive')).toBeNull();
  });
});
