# Playwright e2e tests

Run `pnpm exec playwright test` from the repository root in a freshly seeded disposable environment. The shared configuration starts the real API, candidate/admin apps and loopback mail sink; it refuses to reuse existing servers.

- `phase1.spec.ts` exercises authentication, mail, independent quiz review, start/resume/save/submit/timeout/results, withdrawal and forbidden access against PostgreSQL.
- `phase2-disabled.spec.ts` exercises private immutable authoring, independent reviewer rejection while execution is unavailable, withdrawal, mobile code drafts, language switching and browser reload. It does not execute candidate/reference code or prove judging.

On Windows, `scripts/verify-phase2.ps1` prepares fresh credentials/database and tests the foundation. Linux CI runs `bash scripts/verify-phase2-data.sh --browser`, including fresh credentials, migration compatibility, persistence fixtures and fifteen-table restore verification. Token-bearing traces/screenshots are disabled.

`phase2-live.spec.ts`, selected by `playwright.judge.config.ts`, requires a live verified worker and checks actual reference validation, separate reviewer publication, sample/custom runs, correct/incorrect submissions, mobile/keyboard use, history/reload and withdrawal. It has no skip fallback. Source `scripts/setup-judge.sh` then run `bash scripts/verify-phase2-judge.sh` (PowerShell equivalents also exist). That required suite adds actual isolation, lifecycle faults, 1,000 queued compile/execution jobs, browser journeys and private-data restore. Only a public accepted-result screenshot is retained; authentication/hidden data and token-bearing traces are excluded.

The required integration also executes the Phase 2 review regressions: CPU, wall, measured memory, output, ordinary exception, spoofed OOM and abort checks in all four languages and both modes; exact/token/float result checks; and accepted boundary identifiers using actual reference and starter execution. `scripts/verify-phase2-review.ps1` and `.sh` provide the smaller fresh isolated regression run without replacing the full acceptance chain.
