import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '../../api/types';
import { Button } from '../ui/Button';

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Showing <span className="font-medium text-zinc-700 dark:text-zinc-200">{from}–{to}</span> of{' '}
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{meta.total}</span>
      </p>
      {meta.totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => onPage(meta.page - 1)} disabled={meta.page <= 1} icon={<ChevronLeft className="size-3.5" />} aria-label="Previous page">
            Prev
          </Button>
          <span className="px-1.5 text-xs tabular-nums text-zinc-500">{meta.page} / {meta.totalPages}</span>
          <Button size="sm" onClick={() => onPage(meta.page + 1)} disabled={meta.page >= meta.totalPages} aria-label="Next page">
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </nav>
  );
}
