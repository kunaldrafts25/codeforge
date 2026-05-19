import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // Per-file gating happens via scripts/coverage-gate.mjs against changed
      // files in CI. No global threshold during Stage 0; routes are mostly
      // integration-tested via Stage 1 e2e flows. See MASTER_PLAN.md §4.1.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/sockets.ts'],
    },
  },
})
