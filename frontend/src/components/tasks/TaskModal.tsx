import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, newIdempotencyKey } from '../../api/client';
import type { Task, TaskInput } from '../../api/types';
import { useCreateTask, useUpdateTask } from '../../hooks/useTasks';
import type { TaskFormErrors } from '../../lib/validation';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Modal } from '../ui/Modal';
import { EMPTY_TASK, TaskForm, toTaskInput } from './TaskForm';

interface TaskModalProps {
  /** `null` = create, a task = edit. */
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (task: Task) => void;
}

const FORM_ID = 'task-form';

/** Create/Edit dialog. Mounted fresh per open (keyed by caller) so state never leaks between tasks. */
export function TaskModal({ task, open, onClose, onSaved }: TaskModalProps) {
  const mode = task ? 'edit' : 'create';
  // One idempotency key for the lifetime of this dialog: double-clicks and retries of the same
  // submission can never create two tasks.
  const [idempotencyKey] = useState(() => newIdempotencyKey('task'));
  const create = useCreateTask();
  const update = useUpdateTask();
  const mutation = mode === 'create' ? create : update;
  const error = mutation.error instanceof ApiError ? mutation.error : null;
  const serverErrors = (error?.fieldErrors() ?? {}) as TaskFormErrors;
  const hasFieldErrors = Object.keys(serverErrors).length > 0;

  const handleSubmit = (input: TaskInput) => {
    if (mutation.isPending) return;
    if (task) {
      // Send only what changed — PUT accepts partial updates.
      const original = toTaskInput(task);
      const patch = Object.fromEntries(Object.entries(input).filter(([k, v]) => original[k as keyof TaskInput] !== v)) as Partial<TaskInput>;
      if (!Object.keys(patch).length) {
        onClose();
        return;
      }
      update.mutate({ id: task.id, patch }, { onSuccess: (saved) => done(saved, 'Task updated') });
    } else {
      create.mutate({ input, idempotencyKey }, { onSuccess: (saved) => done(saved, 'Task created') });
    }
  };

  const done = (saved: Task, message: string) => {
    toast.success(message, { description: `#${saved.id} ${saved.title}` });
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={mutation.isPending}
      size="lg"
      title={mode === 'create' ? 'New task' : `Edit task #${task!.id}`}
      description={mode === 'create' ? 'Title and description are required.' : 'Changes are saved when you press Save.'}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={mutation.isPending}>
            {mode === 'create' ? 'Create task' : 'Save changes'}
          </Button>
        </>
      }
    >
      {error && !hasFieldErrors && (
        <div className="mb-4">
          <ErrorBanner title={mode === 'create' ? "Couldn't create the task" : "Couldn't save changes"} message={error.message} requestId={error.requestId} />
        </div>
      )}
      <TaskForm id={FORM_ID} mode={mode} initial={task ? toTaskInput(task) : EMPTY_TASK} serverErrors={serverErrors} disabled={mutation.isPending} onSubmit={handleSubmit} />
    </Modal>
  );
}
