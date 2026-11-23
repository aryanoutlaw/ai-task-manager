import { randomUUID } from 'node:crypto';

export interface PendingDelete {
  id: string;
  type: 'delete_task';
  taskId: number;
  taskTitle: string;
  /** Snapshot of the task version the user was shown; a changed task invalidates the confirmation. */
  taskUpdatedAt: string;
  conversationId: string;
  createdAt: number;
  expiresAt: number;
}

export type TakeResult =
  | { ok: true; action: PendingDelete }
  | { ok: false; reason: 'not_found' | 'expired' };

/**
 * Destructive actions proposed by the LLM are parked here and only executed by a *second* request
 * that names the pending action id with confirm=true. The model never executes deletes itself.
 *
 * `take` removes the entry atomically (single-threaded Node), so a pending action can be executed
 * at most once even if the Confirm button is double-clicked.
 */
export class PendingActionStore {
  private readonly actions = new Map<string, PendingDelete>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: Omit<PendingDelete, 'id' | 'createdAt' | 'expiresAt' | 'type'>): PendingDelete {
    this.sweep();
    const createdAt = this.now();
    const action: PendingDelete = { ...input, type: 'delete_task', id: randomUUID(), createdAt, expiresAt: createdAt + this.ttlMs };
    this.actions.set(action.id, action);
    return action;
  }

  take(id: string): TakeResult {
    const action = this.actions.get(id);
    if (!action) return { ok: false, reason: 'not_found' };
    this.actions.delete(id);
    if (action.expiresAt <= this.now()) return { ok: false, reason: 'expired' };
    return { ok: true, action };
  }

  /** A newer proposal in the same conversation supersedes older unconfirmed ones. */
  discardForConversation(conversationId: string): void {
    for (const [id, action] of this.actions) if (action.conversationId === conversationId) this.actions.delete(id);
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, action] of this.actions) if (action.expiresAt <= now) this.actions.delete(id);
  }
}
