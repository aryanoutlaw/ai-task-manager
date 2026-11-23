import { BookText, Moon, Plus, Sun } from 'lucide-react';
import { API_BASE } from '../../api/client';
import { Button } from '../ui/Button';

export function Header({ theme, onToggleTheme, onCreate }: { theme: 'light' | 'dark'; onToggleTheme: () => void; onCreate: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Taskwise</p>
            <p className="hidden text-[11px] text-zinc-500 sm:block dark:text-zinc-400">Tasks + a grounded AI assistant</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={`${API_BASE}/api/docs`}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-100 sm:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <BookText className="size-4" /> API docs
          </a>
          <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="primary" size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={onCreate}>
            <span className="hidden sm:inline">New task</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
