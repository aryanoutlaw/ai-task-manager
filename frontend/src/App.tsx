import { useCallback, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatResponse, Task } from './api/types';
import { AssistantPanel } from './components/assistant/AssistantPanel';
import { Header } from './components/layout/Header';
import { TaskDashboard } from './components/tasks/TaskDashboard';
import { TaskDetailsDrawer } from './components/tasks/TaskDetailsDrawer';
import { TaskModal } from './components/tasks/TaskModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { useDeleteTask, useInvalidateTasks } from './hooks/useTasks';
import { useTheme } from './hooks/useTheme';
import { cn } from './lib/cn';

type ModalState = { open: false } | { open: true; task: Task | null; key: number };

export default function App() {
  const { theme, toggle } = useTheme();
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [detailsId, setDetailsId] = useState<number | null>(null);
  const [drawerDelete, setDrawerDelete] = useState<Task | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateTasks = useInvalidateTasks();
  const remove = useDeleteTask();

  const openCreate = useCallback(() => setModal({ open: true, task: null, key: Date.now() }), []);
  const openEdit = useCallback((task: Task) => {
    setDetailsId(null);
    setModal({ open: true, task, key: Date.now() });
  }, []);
  const openDetails = useCallback((task: Task) => setDetailsId(task.id), []);

  /** The assistant changed data: refresh every task view (no page reload) and highlight what changed. */
  const onAssistantChangedTasks = useCallback(
    (response: ChatResponse) => {
      void invalidateTasks();
      const ids = new Set<number>();
      for (const call of response.toolCalls) {
        if (call.status !== 'success') continue;
        const result = call.result as { created?: Task; updated?: Task; deleted?: Task } | undefined;
        const task = result?.created ?? result?.updated;
        if (task) ids.add(task.id);
        if (result?.deleted && detailsId === result.deleted.id) setDetailsId(null);
      }
      const verbs = response.toolCalls.filter((c) => c.status === 'success').map((c) => c.name);
      toast.success('Tasks updated by the assistant', {
        description: verbs.includes('delete_task') ? 'A task was deleted.' : verbs.includes('create_task') ? 'A new task was added.' : 'A task was changed.',
        icon: <Sparkles className="size-4 text-violet-500" />,
      });
      if (ids.size) {
        setHighlighted(ids);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlighted(new Set()), 4000);
      }
    },
    [detailsId, invalidateTasks],
  );

  return (
    <div className="flex h-dvh flex-col">
      <Header theme={theme} onToggleTheme={toggle} onCreate={openCreate} />
      <div className="flex min-h-0 flex-1">
        <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
            <div className="mb-6">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Team tasks</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Plan, track and ship — or just ask the assistant.</p>
            </div>
            <TaskDashboard highlightedIds={highlighted} onView={openDetails} onEdit={openEdit} onCreate={openCreate} />
          </div>
        </main>

        {/* Single assistant instance: sidebar on desktop, full-screen sheet on mobile. */}
        <aside
          className={cn(
            'z-30 min-h-0 border-zinc-200/80 lg:static lg:flex lg:w-[420px] lg:border-l xl:w-[460px] dark:border-zinc-800',
            assistantOpen ? 'fixed inset-0 flex animate-slide-up' : 'hidden',
          )}
        >
          <AssistantPanel
            className="w-full"
            onTasksChanged={onAssistantChangedTasks}
            onOpenTask={(id) => {
              setDetailsId(id);
              setAssistantOpen(false);
            }}
            onClose={assistantOpen ? () => setAssistantOpen(false) : undefined}
          />
        </aside>
      </div>

      {!assistantOpen && (
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          className="fixed right-4 bottom-4 z-20 flex items-center gap-2 rounded-full bg-gradient-to-br from-brand-600 to-violet-600 py-3 pr-5 pl-4 text-sm font-medium text-white shadow-lg shadow-brand-600/30 lg:hidden"
        >
          <Sparkles className="size-4" /> Ask AI
        </button>
      )}

      {modal.open && <TaskModal key={modal.key} open task={modal.task} onClose={() => setModal({ open: false })} />}

      <TaskDetailsDrawer taskId={detailsId} onClose={() => setDetailsId(null)} onEdit={openEdit} onDelete={setDrawerDelete} />

      <ConfirmDialog
        open={drawerDelete !== null}
        title="Delete task?"
        description={<>“{drawerDelete?.title}” will be permanently deleted. This cannot be undone.</>}
        confirmLabel="Delete task"
        loading={remove.isPending}
        onCancel={() => setDrawerDelete(null)}
        onConfirm={() =>
          drawerDelete &&
          remove.mutate(drawerDelete, {
            onSuccess: (task) => {
              toast.success('Task deleted', { description: `#${task.id} ${task.title}` });
              setDrawerDelete(null);
              setDetailsId(null);
            },
            onError: (error) => toast.error("Couldn't delete task", { description: error.message }),
          })
        }
      />
    </div>
  );
}
