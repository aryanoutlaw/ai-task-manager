import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const control =
  'block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-xs ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 transition focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:opacity-60 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700 dark:focus:ring-brand-400';
const invalid = 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/60';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; className: string }) => ReactNode;
}

/** Label + control + error/hint wiring (aria-invalid / aria-describedby) in one place. */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? messageId : undefined, className: cn(control, error && invalid) })}
      {error ? (
        <p id={messageId} className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p id={messageId} className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => <textarea ref={ref} {...props} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>((props, ref) => <select ref={ref} {...props} />);

/** Compact select for toolbars. */
export function ToolbarSelect({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <select
      aria-label={label}
      className={cn(
        'h-10 rounded-xl border-0 bg-white py-0 pr-8 pl-3 text-sm text-zinc-700 shadow-xs ring-1 ring-inset ring-zinc-200 focus:ring-2 focus:ring-brand-500 focus:outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
