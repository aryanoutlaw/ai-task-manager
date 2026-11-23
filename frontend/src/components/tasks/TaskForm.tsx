import { useState, type FormEvent } from 'react';
import { TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskInput } from '../../api/types';
import { todayISO } from '../../lib/dates';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../lib/labels';
import { DESCRIPTION_MAX, TITLE_MAX, validateTask, type TaskFormErrors } from '../../lib/validation';
import { Field, Input, Select, Textarea } from '../ui/Field';

export const EMPTY_TASK: TaskInput = { title: '', description: '', status: 'pending', priority: 'medium', dueDate: null };

export function toTaskInput(task: Task): TaskInput {
  const { title, description, status, priority, dueDate } = task;
  return { title, description, status, priority, dueDate };
}

interface TaskFormProps {
  id: string;
  mode: 'create' | 'edit';
  initial: TaskInput;
  /** Field errors returned by the server (authoritative), merged over client-side ones. */
  serverErrors?: TaskFormErrors;
  disabled?: boolean;
  onSubmit: (input: TaskInput) => void;
}

/**
 * Controlled task form with client-side validation before submit. Errors appear after the first
 * submit attempt (or on blur) — not while the user is still typing their first character.
 */
export function TaskForm({ id, mode, initial, serverErrors, disabled, onSubmit }: TaskFormProps) {
  const [values, setValues] = useState<TaskInput>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof TaskInput, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const clientErrors = validateTask(values, mode);
  const visible = (field: keyof TaskInput) => (submitted || touched[field] ? clientErrors[field] : undefined) ?? serverErrors?.[field];

  const set = <K extends keyof TaskInput>(field: K, value: TaskInput[K]) => setValues((v) => ({ ...v, [field]: value }));
  const blur = (field: keyof TaskInput) => () => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(clientErrors).length) return;
    onSubmit({ ...values, title: values.title.trim(), description: values.description.trim() });
  };

  return (
    <form id={id} onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label="Title" required error={visible('title')} hint={`${values.title.trim().length}/${TITLE_MAX} · Start with a verb, e.g. “Fix login redirect loop”`}>
        {(p) => <Input {...p} value={values.title} onChange={(e) => set('title', e.target.value)} onBlur={blur('title')} maxLength={TITLE_MAX + 20} disabled={disabled} placeholder="What needs to be done?" data-autofocus />}
      </Field>

      <Field label="Description" required error={visible('description')} hint={`${values.description.length}/${DESCRIPTION_MAX} · Why it matters and what “done” looks like`}>
        {(p) => <Textarea {...p} rows={4} value={values.description} onChange={(e) => set('description', e.target.value)} onBlur={blur('description')} disabled={disabled} placeholder="Context, acceptance criteria, links…" className={`${p.className} resize-y`} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status" error={visible('status')}>
          {(p) => (
            <Select {...p} value={values.status} onChange={(e) => set('status', e.target.value as TaskInput['status'])} disabled={disabled}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Priority" error={visible('priority')}>
          {(p) => (
            <Select {...p} value={values.priority} onChange={(e) => set('priority', e.target.value as TaskInput['priority'])} disabled={disabled}>
              {TASK_PRIORITIES.map((pr) => <option key={pr} value={pr}>{PRIORITY_LABEL[pr]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Due date" error={visible('dueDate')}>
          {(p) => (
            <Input {...p} type="date" value={values.dueDate ?? ''} min={mode === 'create' ? todayISO() : undefined} onChange={(e) => set('dueDate', e.target.value || null)} onBlur={blur('dueDate')} disabled={disabled} />
          )}
        </Field>
      </div>
    </form>
  );
}
