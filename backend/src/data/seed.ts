import type { TaskRepository } from '../repositories/task.repository.js';
import type { Task } from '../schemas/task.schema.js';
import { addDays, toDateOnly } from '../lib/dates.js';

type SeedTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'dueDate'> & {
  dueInDays: number | null;
  createdDaysAgo: number;
};

/**
 * Demo data with dates *relative to today* so "due this week" / "overdue" always mean something.
 * Two tasks deliberately mention "login" so the assistant's ambiguous-reference handling can be
 * demonstrated ("delete the login task").
 */
const SEED: SeedTask[] = [
  { title: 'Fix login redirect loop on Safari', description: 'Users on Safari 18 get bounced between /login and /dashboard after SSO. Reproduce, fix the cookie SameSite setting and add a regression test.', status: 'in_progress', priority: 'high', dueInDays: 1, createdDaysAgo: 3, createdBy: 'user' },
  { title: 'Write onboarding guide for new engineers', description: 'One-page guide covering local setup, branching strategy and who to ask for what. Review with two recent hires.', status: 'pending', priority: 'medium', dueInDays: 6, createdDaysAgo: 5, createdBy: 'user' },
  { title: 'Patch dependency security advisories', description: 'npm audit reports two high-severity advisories in transitive dependencies. Upgrade, run the full test suite and deploy.', status: 'pending', priority: 'high', dueInDays: 2, createdDaysAgo: 2, createdBy: 'user' },
  { title: 'Design dark mode for the settings page', description: 'Produce light/dark variants for the settings screens, checking WCAG AA contrast for every text style.', status: 'pending', priority: 'low', dueInDays: 14, createdDaysAgo: 6, createdBy: 'user' },
  { title: 'Investigate login timeout errors in mobile app', description: 'Android clients report intermittent timeouts on the login request. Pull logs, check the auth service p95 latency and propose a fix.', status: 'pending', priority: 'medium', dueInDays: 4, createdDaysAgo: 1, createdBy: 'user' },
  { title: 'Prepare Q4 roadmap review deck', description: 'Summarise delivered items, slipped items and proposed Q1 bets for the leadership review.', status: 'completed', priority: 'medium', dueInDays: -2, createdDaysAgo: 10, createdBy: 'user' },
  { title: 'Remove stale feature flags', description: 'Delete flags that have been 100% rolled out for more than 30 days and remove the dead code paths.', status: 'completed', priority: 'low', dueInDays: null, createdDaysAgo: 12, createdBy: 'user' },
  { title: 'Respond to Acme Corp escalation', description: 'Acme reported missing export data. Confirm the root cause with the data team and send a written response to their account manager.', status: 'pending', priority: 'high', dueInDays: -1, createdDaysAgo: 4, createdBy: 'user' },
  { title: 'Add rate limiting to the public API', description: 'Introduce per-key rate limits (100 req/min default) with clear 429 responses and Retry-After headers.', status: 'in_progress', priority: 'medium', dueInDays: 9, createdDaysAgo: 7, createdBy: 'user' },
  { title: 'Refactor billing invoice export', description: 'Split the 900-line export module into formatter, query and delivery layers. No behaviour change; add snapshot tests first.', status: 'pending', priority: 'low', dueInDays: 20, createdDaysAgo: 8, createdBy: 'user' },
];

export function seedTasks(repo: TaskRepository, now: Date = new Date()): void {
  for (const [index, seed] of SEED.entries()) {
    const { dueInDays, createdDaysAgo, ...rest } = seed;
    // Stagger creation times so "sort by created date" is meaningful and stable.
    const createdAt = addDays(now, -createdDaysAgo);
    createdAt.setMinutes(createdAt.getMinutes() - index);
    const timestamp = createdAt.toISOString();
    repo.insert({
      ...rest,
      dueDate: dueInDays === null ? null : toDateOnly(addDays(now, dueInDays)),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}
