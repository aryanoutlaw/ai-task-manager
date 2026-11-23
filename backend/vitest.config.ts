import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests must never hit the real LLM: the agent is exercised through a scripted fake client.
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', ANTHROPIC_API_KEY: '', SEED_DATA: 'false' },
  },
});
