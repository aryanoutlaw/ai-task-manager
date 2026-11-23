/**
 * Labelled queries used to choose KB_RELEVANCE_THRESHOLD (see `npm run kb:calibrate`).
 * `expect` = the document that should answer it, or null when the KB does NOT cover it and the
 * assistant must say it cannot verify.
 */
export const CALIBRATION_SET: Array<{ query: string; expect: string | null }> = [
  // In scope
  { query: 'What is the difference between medium and high priority?', expect: 'priority-levels' },
  { query: 'What does medium priority mean here?', expect: 'priority-levels' },
  { query: 'What priority should a bug that blocks login get?', expect: 'priority-levels' },
  { query: 'urgent customer escalation priority', expect: 'priority-levels' },
  { query: 'When is a task considered overdue?', expect: 'due-dates-and-overdue' },
  { query: 'Can I create a task with a due date in the past?', expect: 'due-dates-and-overdue' },
  { query: 'What should I do when a deadline is missed?', expect: 'due-dates-and-overdue' },
  { query: 'Can I delete a completed task?', expect: 'deletion-policy' },
  { query: 'Is deleting a task permanent?', expect: 'deletion-policy' },
  { query: 'How should I write a good task title?', expect: 'writing-good-tasks' },
  { query: 'What makes a good description?', expect: 'writing-good-tasks' },
  { query: 'What statuses can a task have?', expect: 'status-lifecycle' },
  { query: 'How many tasks can I have in progress at once?', expect: 'status-lifecycle' },
  { query: 'How do I reopen a finished task?', expect: 'status-lifecycle' },
  { query: 'When does weekly triage happen?', expect: 'weekly-triage' },
  { query: 'What can the assistant do?', expect: 'assistant-guide' },
  // Out of scope — must be rejected
  { query: 'What is our refund policy?', expect: null },
  { query: 'What is the weather in Delhi?', expect: null },
  { query: 'What is the vacation leave policy?', expect: null },
  { query: 'How do I reset my password?', expect: null },
  { query: 'What is the remote work policy?', expect: null },
  { query: 'How much can I expense for travel?', expect: null },
  { query: 'Who won the cricket world cup?', expect: null },
  { query: 'Explain quantum computing', expect: null },
  { query: 'What is the salary review process?', expect: null },
  { query: 'What is the parental leave policy for the team?', expect: null },
  { query: 'Which programming language should we use?', expect: null },
  { query: 'What is the dress code?', expect: null },
  { query: 'What is the security incident response process?', expect: null },
  { query: 'How do I request a new laptop?', expect: null },
];
