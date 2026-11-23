import { BookOpen, ListChecks, PlusCircle, Trash2 } from 'lucide-react';

const PROMPTS = [
  { icon: BookOpen, text: 'What is the difference between medium and high priority?' },
  { icon: ListChecks, text: 'Show my high priority tasks due this week' },
  { icon: PlusCircle, text: 'Create a task to fix the login bug and tell me what priority it should be' },
  { icon: Trash2, text: 'Delete the login task' },
];

export function SuggestedPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-end gap-4 px-1 pb-2">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25">
          <ListChecks className="size-5" />
        </div>
        <h3 className="text-sm font-semibold">How can I help?</h3>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          I answer only from the team knowledge base and live task data — and I'll tell you when I can't verify something.
        </p>
      </div>
      <div className="grid gap-2">
        {PROMPTS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 text-left text-[13px] text-zinc-700 shadow-xs ring-1 ring-zinc-200/80 transition hover:bg-brand-50/50 hover:ring-brand-300 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-brand-500/5 dark:hover:ring-brand-500/40"
          >
            <Icon className="size-4 shrink-0 text-brand-500" />
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
