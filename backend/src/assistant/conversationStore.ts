import { randomUUID } from 'node:crypto';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  turns: ConversationTurn[];
  updatedAt: number;
}

/**
 * Short server-side memory so follow-ups like "the second one" work.
 *
 * Deliberately stores only user text and final assistant answers — NOT tool results. Task data
 * from earlier turns may be stale, so the system prompt requires re-fetching through tools before
 * stating task facts. History is server-side (not client-supplied) so a client cannot inject fake
 * "assistant" turns or tool output.
 */
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  constructor(
    private readonly maxTurns = 12,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxConversations = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns a usable id: the given one if known and fresh, otherwise a new one. */
  resolveId(id: string | null | undefined): string {
    this.sweep();
    return id && this.conversations.has(id) ? id : (id ?? randomUUID());
  }

  history(id: string): ConversationTurn[] {
    return [...(this.conversations.get(id)?.turns ?? [])];
  }

  append(id: string, ...turns: ConversationTurn[]): void {
    const convo = this.conversations.get(id) ?? { turns: [], updatedAt: this.now() };
    convo.turns.push(...turns.filter((t) => t.content.trim()));
    // Keep the most recent turns, and always start with a user turn (API requirement).
    if (convo.turns.length > this.maxTurns) convo.turns = convo.turns.slice(-this.maxTurns);
    while (convo.turns[0] && convo.turns[0].role !== 'user') convo.turns.shift();
    convo.updatedAt = this.now();
    this.conversations.delete(id);
    this.conversations.set(id, convo); // re-insert => Map order is LRU order
    if (this.conversations.size > this.maxConversations) {
      const oldest = this.conversations.keys().next().value;
      if (oldest) this.conversations.delete(oldest);
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, c] of this.conversations) if (now - c.updatedAt > this.ttlMs) this.conversations.delete(id);
  }
}
