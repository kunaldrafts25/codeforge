# Playwright e2e tests

Run `pnpm exec playwright test` from the repository root in a freshly seeded disposable environment. The shared configuration starts the real API, candidate/admin apps and loopback mail sink; it refuses to reuse existing servers.

- `phase1.spec.ts` exercises authentication, mail, independent quiz review, start/resume/save/submit/timeout/results, withdrawal and forbidden access against PostgreSQL.
- `phase2-disabled.spec.ts` exercises private immutable authoring, independent reviewer rejection while execution is unavailable, withdrawal, mobile code drafts, language switching and browser reload. It does not execute candidate/reference code or prove judging.

On Windows, `scripts/verify-phase2.ps1` prepares fresh credentials/database, runs all checks and restores the browser data into a distinct database. Linux CI installs Chromium and runs `bash scripts/verify-phase2-data.sh --browser`, including fresh credentials, migration compatibility, real lifecycle checks and fourteen-table restore verification. Token-bearing traces/screenshots are disabled. Safe execution and full Gate P2 remain blocked until a dedicated sandbox and real worker pass their required tests.
