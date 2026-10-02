import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: process.env.PLAYWRIGHT_TEST_MATCH
    ? process.env.PLAYWRIGHT_TEST_MATCH.split(',')
    : ['**/phase1.spec.ts', '**/phase2-disabled.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3000',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: [
    {
      command: 'node tests/e2e/mail-sink.mjs',
      url: 'http://127.0.0.1:8025/messages',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @codeforge/api dev',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @codeforge/web dev',
      url: 'http://localhost:3000/aptitude',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @codeforge/admin dev',
      url: 'http://localhost:3001/login',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
