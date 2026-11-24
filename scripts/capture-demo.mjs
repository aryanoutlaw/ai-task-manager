/**
 * Captures README screenshots and a ~2-minute demo video by driving the real UI with Playwright.
 *
 *   npm run demo:offline -w backend   # or `npm run dev -w backend` with a funded ANTHROPIC_API_KEY
 *   npm run dev -w frontend
 *   node scripts/capture-demo.mjs screenshots   # → docs/screenshots/*.png
 *   node scripts/capture-demo.mjs video         # → docs/demo.webm (+ demo.mp4 if ffmpeg is installed)
 *
 * Restart the backend between runs: both runs change data (create / delete tasks).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const mode = process.argv[2] ?? 'screenshots';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();

async function ask(page, text) {
  await page.fill('textarea[aria-label="Message the assistant"]', text);
  await page.keyboard.press('Enter');
  // Wait until the assistant finished (input re-enabled with send button, no stop button).
  await page.waitForSelector('button[aria-label="Stop"]', { state: 'detached', timeout: 60_000 });
  await page.waitForTimeout(600);
}

const panel = (page) => page.locator('section[aria-label="AI assistant"]');

if (mode === 'screenshots') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(BASE);
  await page.waitForSelector('article');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(shots, 'dashboard-light.png') });

  // Validation errors in the create form
  await page.click('text=New task');
  await page.fill('input[placeholder="What needs to be done?"]', 'Fi');
  await page.click('button:has-text("Create task")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'task-form-validation.png') });
  await page.keyboard.press('Escape');

  // Details drawer
  await page.locator('article h3').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shots, 'task-details.png') });
  await page.keyboard.press('Escape');

  // Assistant: KB answer with evidence
  await ask(page, 'What is the difference between medium and high priority?');
  await panel(page).screenshot({ path: path.join(shots, 'assistant-kb.png') });

  // Assistant: policy + action (route both) — task list refreshes and highlights the new task
  await page.click('button[aria-label="New conversation"]');
  await ask(page, 'Create a task to fix the login bug and tell me what priority it should be');
  await page.locator('section[aria-label="AI assistant"] button[aria-expanded]').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, 'assistant-both.png') });

  // Assistant: out of scope + destructive action awaiting confirmation
  await page.click('button[aria-label="New conversation"]');
  await ask(page, 'What is our refund policy?');
  await ask(page, 'Delete task 3');
  await panel(page).screenshot({ path: path.join(shots, 'assistant-confirm.png') });
  await page.click('button:has-text("Confirm delete")');
  await page.waitForTimeout(1200);
  await panel(page).screenshot({ path: path.join(shots, 'assistant-confirmed.png') });

  // Dark mode
  await page.click('button[aria-label="New conversation"]');
  await page.click('button[aria-label^="Switch to dark"]');
  await ask(page, 'Show my high priority tasks due this week');
  await page.screenshot({ path: path.join(shots, 'dashboard-dark.png') });

  // Mobile
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await mobile.goto(BASE);
  await mobile.waitForSelector('article');
  await mobile.waitForTimeout(900);
  await mobile.screenshot({ path: path.join(shots, 'mobile-dashboard.png') });
  await mobile.click('text=Ask AI');
  await ask(mobile, 'Delete the login task');
  await mobile.screenshot({ path: path.join(shots, 'mobile-assistant.png') });
  console.log(`Screenshots written to ${path.relative(root, shots)}`);
}

if (mode === 'video') {
  const videoDir = path.join(root, 'docs', '.video-tmp');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const pause = (ms) => page.waitForTimeout(ms);
  const typeSlow = (selector, text) => page.locator(selector).pressSequentially(text, { delay: 28 });
  const askSlow = async (text, hold = 6000) => {
    await typeSlow('textarea[aria-label="Message the assistant"]', text);
    await pause(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('button[aria-label="Stop"]', { state: 'detached', timeout: 60_000 });
    await pause(hold);
  };

  await page.goto(BASE);
  await page.waitForSelector('article');
  await pause(6500);

  // Dashboard: search, filter, sort
  await typeSlow('input[aria-label="Search tasks"]', 'login');
  await pause(1800);
  await page.fill('input[aria-label="Search tasks"]', '');
  await page.selectOption('select[aria-label="Filter by priority"]', 'high');
  await pause(1800);
  await page.selectOption('select[aria-label="Sort by"]', 'dueDate');
  await pause(1800);
  await page.selectOption('select[aria-label="Filter by priority"]', '');
  await page.selectOption('select[aria-label="Sort by"]', 'createdAt');
  await pause(1000);

  // Create with validation
  await page.click('text=New task');
  await pause(800);
  await page.click('button:has-text("Create task")');
  await pause(1500);
  await typeSlow('input[placeholder="What needs to be done?"]', 'Write release notes for v2.3');
  await typeSlow('textarea[placeholder^="Context"]', 'Summarise new features and fixes for customers; review with support.');
  await page.selectOption('form select >> nth=1', 'medium');
  await pause(800);
  await page.click('button:has-text("Create task")');
  await pause(2500);

  // Details + edit
  await page.locator('article h3').first().click();
  await pause(2200);
  await page.click('button:has-text("Edit")');
  await pause(800);
  await page.selectOption('form select >> nth=0', 'in_progress');
  await pause(600);
  await page.click('button:has-text("Save changes")');
  await pause(2200);

  // Assistant
  await askSlow('What is the difference between medium and high priority?', 6000);
  await page.locator('section[aria-label="AI assistant"] li[id^="evidence-"]').first().hover();
  await pause(2500);
  await askSlow('What does medium priority mean here?', 5500);
  await askSlow('Show my high priority tasks due this week', 6000);
  // Task references in answers open the details drawer
  await page.locator('section[aria-label="AI assistant"] button[title^="Open task"]').last().click();
  await pause(3500);
  await page.keyboard.press('Escape');
  await pause(800);
  await page.click('button[aria-label="New conversation"]');
  await askSlow('Create a task to fix the login bug and tell me what priority it should be', 4500);
  await page.locator('section[aria-label="AI assistant"] button[aria-expanded]').first().click();
  await pause(5000);
  await page.click('button[aria-label="New conversation"]');
  await askSlow('What is our refund policy?', 5500);
  await askSlow('Delete the login task', 5500);
  await askSlow('the mobile one', 4500);
  await page.click('button:has-text("Confirm delete")');
  await pause(5000);
  await page.click('button[aria-label^="Switch to dark"]');
  await pause(3500);
  await page.click('button[aria-label^="Switch to light"]');
  await pause(1200);

  // API documentation (Swagger UI) for the task and assistant endpoints
  await page.goto(`${BASE}/api/docs`);
  await page.waitForSelector('.swagger-ui .opblock', { timeout: 15_000 });
  await pause(3500);
  await page.locator('.opblock-summary-path:has-text("/api/assistant/chat")').first().click();
  await pause(2000);
  await page.mouse.wheel(0, 500);
  await pause(6500);
  await page.mouse.wheel(0, 900);
  await pause(6500);

  await context.close();
  const [file] = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  const webm = path.join(root, 'docs', 'demo.webm');
  fs.renameSync(path.join(videoDir, file), webm);
  fs.rmSync(videoDir, { recursive: true, force: true });
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', path.join(root, 'docs', 'demo.mp4')]);
    fs.rmSync(webm);
    console.log('Video written to docs/demo.mp4');
  } catch {
    console.log('Video written to docs/demo.webm (install ffmpeg to also get an mp4)');
  }
}

await browser.close();
