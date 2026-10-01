# @codeforge/judge-worker

Execution is disabled. `pnpm --filter @codeforge/judge-worker preflight` inspects
trusted Docker metadata and exits nonzero. Runtime presence alone never enables
code execution. The current engine lacks runsc; installation, pinned toolchains,
resource accounting, isolation probes, and real crash/recovery evidence are still
required. PostgreSQL persistence/lease helpers live in `packages/db/src/practice-queue.ts`.
