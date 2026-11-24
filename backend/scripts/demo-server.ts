/**
 * Runs the real API with the OFFLINE SCRIPTED MODEL instead of Claude (no API credits needed).
 * Used to capture screenshots / the demo video. Never use this as the real server.
 *
 *   npm run demo:offline -w backend      # then `npm run dev -w frontend`
 */
process.env.LOG_LEVEL ??= 'info';
const { createApp } = await import('../src/app.js');
const { createContainer } = await import('../src/container.js');
const { OfflineScriptedLlm } = await import('./offline-llm.js');
const { logger } = await import('../src/lib/logger.js');

const container = createContainer({ llm: new OfflineScriptedLlm() });
const port = container.config.PORT;
createApp(container).listen(port, () => {
  logger.warn(`OFFLINE DEMO SERVER on http://localhost:${port} — assistant replies come from scripts/offline-llm.ts, NOT Claude.`);
});
