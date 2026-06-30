# CodeForge

CodeForge is a work-in-progress coding practice and aptitude assessment platform. The current repository is a pnpm monorepo, with a Next.js candidate app (`apps/web`), Next.js admin app (`apps/admin`), Fastify API (`apps/api`), Prisma schema/client (`packages/db`), and shared schemas (`packages/shared`).

**Current usable slice:** reviewed, fixed-form objective aptitude tests (single-choice and true/false; one section; no proctoring). Candidate discovery, answer saving, server-timed submission, and private results have implementations. The included demo test starts in **draft** and requires a separate reviewer to publish it. Code judging and contest registration/scoring are paused until isolated judging and durable scoring exist; the API returns 503 instead of a misleading verdict or standings response.

See [the current audit and release plan](docs/PRODUCTION_AUDIT_2026-09-30.md) for feature evidence, production blockers, architecture, content pipeline, and verification.

## Local development

Requires Node.js 20+, pnpm 9, PostgreSQL with the `pg_trgm` and `vector` extensions, and Redis for future workers. Copy `apps/api/.env.example` to `apps/api/.env`, fill in local-only values, and use a disposable PostgreSQL database. The repository currently has **no versioned Prisma migrations**. `pnpm --filter @codeforge/db db:push` can initialize a brand-new disposable database after verifying its target URL. Do not run it or seed against an unknown/shared database.

```bash
pnpm install --frozen-lockfile
pnpm --filter @codeforge/db db:generate
pnpm dev
```

The candidate app uses port 3000, admin app 3001, and API 5000 by default. The API needs `FRONTEND_URL` and `ADMIN_URL` to match those browser origins. For a disposable seed only, set `SEED_ADMIN_PASSWORD` to a unique value of at least 16 characters before running `pnpm --filter @codeforge/db db:seed`; the seed writes local judge sample blobs and draft quiz content. Production startup rejects insecure cookies, HTTP origins, or console-only email delivery.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The API has meaningful unit and Fastify injection tests, including a mocked aptitude journey. The repository still has placeholder worker scripts and no real browser e2e suite; passing the root scripts is insufficient to certify a release. The audit records the exact checks run in this workspace.
