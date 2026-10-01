# CodeForge

CodeForge is a work-in-progress coding practice and aptitude assessment platform. The current repository is a pnpm monorepo, with a Next.js candidate app (`apps/web`), Next.js admin app (`apps/admin`), Fastify API (`apps/api`), Prisma schema/client (`packages/db`), and shared schemas (`packages/shared`).

**Current pilot slice:** reviewed, fixed-form objective aptitude tests (single-choice and true/false; one section; no proctoring). Candidate discovery, answer saving, server-timed submission, and private results are implemented. The included demo test starts in **draft** and requires a separate reviewer to publish it. Code judging and contest registration/scoring are paused until their later delivery phases; the API returns 503 instead of a misleading verdict or standings response.

See [the current audit and release plan](docs/PRODUCTION_AUDIT_2026-09-30.md) for feature evidence, production blockers, architecture, content pipeline, and verification.

## Local development

Requires Node.js 20+, pnpm 9, and PostgreSQL 16 with the `pg_trgm` and `vector` extensions. `docker-compose.phase1.yml` provides a disposable local instance when Docker is available. Use the reviewed Prisma migrations with `migrate deploy`; never use `db push` against an existing database. On Windows, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phase1.ps1` creates fresh disposable databases, runs the mail/browser journey, and verifies backup and restore.

```bash
pnpm install --frozen-lockfile
pnpm --filter @codeforge/db db:generate
pnpm dev
```

The candidate app uses port 3000, admin app 3001, and API 5000 by default. The API needs `FRONTEND_URL` and `ADMIN_URL` to match those browser origins. The seed requires `SEED_DISPOSABLE_DATABASE=1` and two distinct, strong passwords; it refuses production and nonlocal hosts. Production startup rejects insecure cookies, HTTP origins, or test mail delivery.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
```

CI provisions PostgreSQL, deploys migrations, rehearses backup and restore, seeds a draft, and runs Playwright staff and candidate journeys. Phase 2 includes immutable practice packages, independent publication, private projections, drafts/history, and a durable isolated judge for C++, Python, Java and JavaScript in standard I/O and typed function modes. Execution requires explicit admission configuration and a fresh verified worker heartbeat. The old preflight is diagnostic only. Contests remain disabled.

For disposable real judging, see [the judge setup](apps/judge-worker/README.md). The required Linux judge CI job runs only trusted repository pushes and fails for untrusted pull-request events before creating privileged infrastructure. Foundation unit/data tests remain separate from real execution acceptance. Historical credential-incident closure remains a launch requirement.

On Windows, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phase2.ps1` creates fresh test credentials and disposable databases, verifies additive migration compatibility and synthetic job recovery, runs all static/browser checks, and rehearses restore. Synthetic lifecycle results do not prove compiler correctness or isolation. The unresolved historical credential incident remains a launch blocker; a passing test run does not resolve it.
