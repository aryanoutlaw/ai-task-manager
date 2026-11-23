import type { EvidenceItem, ToolCallRecord } from './types.js';

const CITATION = /\[([a-z0-9][a-z0-9-]*(?:#[a-z0-9-]+)?)\]/g;
const TASK_REFERENCE = /(?:#|\btask\s+#?|\bid\s+#?)(\d{1,7})\b/gi;

export interface GroundingReport {
  answer: string;
  citedEvidence: EvidenceItem[];
  warnings: string[];
}

/**
 * Post-generation grounding checks — a deterministic safety net behind the system prompt:
 *  1. Citations must refer to passages actually retrieved (and above threshold) in this turn.
 *     Unknown citations are stripped from the answer and reported.
 *  2. Task ids mentioned in the answer must have appeared in tool arguments/results this turn
 *     (or in the user's own message). Anything else is a likely hallucinated id and is reported.
 * Warnings are returned in the response (`meta.groundingWarnings`), logged, and counted in metrics.
 */
export function checkGrounding(params: {
  answer: string;
  evidence: Map<string, EvidenceItem>;
  knownTaskIds: Set<number>;
  userMessage: string;
}): GroundingReport {
  const warnings: string[] = [];
  const cited = new Map<string, EvidenceItem>();

  const answer = params.answer.replace(CITATION, (match, id: string) => {
    const exact = params.evidence.get(id);
    if (exact) {
      cited.set(exact.id, exact);
      return match;
    }
    // A document-level citation ("[priority-levels]") is acceptable if one of its sections was retrieved.
    const docLevel = [...params.evidence.values()].filter((e) => e.docId === id);
    if (docLevel.length) {
      docLevel.forEach((e) => cited.set(e.id, e));
      return match;
    }
    // Not a citation-looking token we recognise (e.g. "[Confirm]") — leave untouched unless it looks like a KB id.
    if (!id.includes('-') && !id.includes('#')) return match;
    warnings.push(`Removed citation [${id}]: it was not retrieved in this turn.`);
    return '';
  });

  const userIds = new Set([...params.userMessage.matchAll(/\d{1,7}/g)].map((m) => Number(m[0])));
  const unknownIds = new Set<number>();
  for (const m of answer.matchAll(TASK_REFERENCE)) {
    const id = Number(m[1]);
    if (!params.knownTaskIds.has(id) && !userIds.has(id)) unknownIds.add(id);
  }
  for (const id of unknownIds) warnings.push(`Answer mentions task #${id}, which no tool returned in this turn.`);

  return { answer: answer.replace(/[ \t]{2,}/g, ' ').trim(), citedEvidence: [...cited.values()], warnings };
}

/**
 * Deterministic answer built from the audit trail. Used when the LLM fails AFTER tools already ran
 * (so the user still learns exactly what happened) and when the step limit is hit.
 */
export function summarizeToolCalls(calls: ToolCallRecord[]): string {
  const lines = calls.map((call) => {
    const result = (call.result ?? {}) as Record<string, { id?: number; title?: string; priority?: string } | number | undefined>;
    if (call.status === 'error') return `• ${call.name} failed: ${call.error?.message ?? 'unknown error'}`;
    switch (call.name) {
      case 'create_task': {
        const t = result.created as { id: number; title: string; priority: string } | undefined;
        return t ? `• Created task #${t.id} "${t.title}" (priority ${t.priority}).` : '• Created a task.';
      }
      case 'update_task': {
        const t = result.updated as { id: number; title: string } | undefined;
        return t ? `• Updated task #${t.id} "${t.title}".` : '• Updated a task.';
      }
      case 'delete_task': {
        const t = result.task as { id: number; title: string } | undefined;
        return t ? `• Task #${t.id} "${t.title}" is awaiting your confirmation before deletion.` : '• A deletion awaits confirmation.';
      }
      case 'list_tasks':
        return `• Found ${typeof result.total === 'number' ? result.total : 'some'} matching task(s).`;
      case 'get_task': {
        const t = result.task as { id: number; title: string } | undefined;
        return t ? `• Looked up task #${t.id} "${t.title}".` : '• Looked up a task.';
      }
    }
  });
  return lines.join('\n');
}
