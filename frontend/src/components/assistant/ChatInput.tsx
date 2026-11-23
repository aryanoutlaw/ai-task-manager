import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '../../lib/cn';

const MAX = 2000;

export function ChatInput({ busy, onSend, onStop, disabled }: { busy: boolean; onSend: (text: string) => void; onStop: () => void; disabled?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = !value.trim();

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    if (empty || busy || disabled) return; // client-side guard against empty input
    onSend(value);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-700">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        maxLength={MAX}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? 'Assistant unavailable' : 'Ask about policies or manage tasks…'}
        aria-label="Message the assistant"
        className="scrollbar-thin block w-full resize-none bg-transparent py-3 pr-12 pl-4 text-sm placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed"
      />
      <div className="absolute right-2 bottom-2">
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="flex size-8 items-center justify-center rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={empty || disabled}
            aria-label="Send message"
            className={cn('flex size-8 items-center justify-center rounded-xl transition', empty || disabled ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' : 'bg-brand-600 text-white shadow-sm hover:bg-brand-500')}
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      {value.length > MAX * 0.9 && <span className="absolute right-12 bottom-3 text-[10px] text-zinc-400 tabular-nums">{value.length}/{MAX}</span>}
    </div>
  );
}
