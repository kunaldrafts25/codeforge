# Data Model

**Owner:** CodeForge Platform Engineering

The authoritative source is the Prisma schema:
[`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma).
Read it first. This document is a quick map.

## Top-level surfaces

| Domain            | Models                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Identity & access | `User`, `UserSession`, `VerificationToken`, `PasswordResetToken`, `AuditLog`                                    |
| Arena (problems)  | `Problem`, `ProblemTest`, `ProblemSubtask`, `StarterCode`, `ReferenceSolution`, `ProblemHint`, `Editorial`      |
| Arena (contests)  | `Contest`, `ContestProblem`, `ContestParticipant`, `Submission`, `SubmissionTestResult`, `RatingChange`, `Hack` |
| Aptitude          | `QuizQuestion`, `QuizTest`, `QuizTestItem`, `QuizAttempt`, `QuizResponse`                                       |
| Proctoring        | `ProctorEvent`, `ProctorRecording`, `PlagiarismMatch`                                                           |
| Engagement        | `Badge`, `UserBadge`, `DailyChallenge`, `StudyPlan`, `Discussion`                                               |

## Stage-0 specifics

- The schema rewrite goes through `prisma migrate dev --name 0001_init_v2
--create-only` so the operator can review the generated SQL before
  applying.
- `packages/db/scripts/backfill-v1-to-v2.ts` maps the legacy schema where
  field names changed:
  - `Problem.description → statementMd`
  - `Problem.difficulty (1-10) → difficultyBand + rating`
  - `Problem.timeLimit / memoryLimit → timeLimitMs / memoryLimitKb`
  - `Solution → ReferenceSolution (isJury=true)`
  - `User.rating / maxRating / problemsSolved / contestsCount →
rating / maxRating / problemsSolved / contestsCount`
  - `Submission.executionTime / memoryUsed → executionTimeMs /
memoryUsedKb`
  - `TestCase` rows produce `ProblemTest` rows with their test data written
    to the local file-store rooted at `SEED_BLOB_ROOT` (A1 will move this
    to S3).
- Hot-table partitioning (Submission, ProctorEvent, QuizResponse) is
  declared at schema level but the partition DDL itself lands with A8
  (contest engine) when the partition cadence is finalised. Stage 0 keeps
  the tables as regular tables.

## Index strategy

The schema declares all indexes that Stage-0 routes need. The notable
@@index entries:

- `User`: `rating DESC` and `aptitudeScaled DESC` for the two
  leaderboards.
- `Problem`: `status, isPublic` for the public listing; `rating` and
  `difficultyBand` for filters; `authorId` for admin views.
- `Submission`: `userId, submittedAt DESC` for user profile views;
  `problemId`, `contestId`, `verdict` for stats.
- `UserSession`: `userId` and `refreshTokenHash` (the latter is unique).

## Conventions

- All `id` fields are UUIDv4 strings. Composite-key tables (`StarterCode`,
  `UserBadge`, `ContestProblem`, `ContestParticipant`) use `@@id([...])`.
- Timestamps are `DateTime` (`timestamptz`); user-facing responses
  serialise via `.toISOString()`.
- JSON blobs carry per-feature schemas (e.g. `Problem.companyTags`,
  `Problem.perLanguageOverrides`, `QuizTest.sections`). Their shapes are
  expected to be validated by Zod at the route layer that produces them —
  Prisma stores them as `Json`.
- Hashed-token fields are SHA-256 hex strings (64 chars). Never persist raw
  tokens. Comparison via the hashed form in `auth/tokens.ts`.

## Retention TTLs (Stage 0 baseline; expanded in Stage 2)

- `VerificationToken`: 24 hours (column `expiresAt`); expired rows pruned
  by a future async-worker cron.
- `PasswordResetToken`: 15 minutes.
- `UserSession`: 30 days. Revoked sessions kept for forensics.
- `ProctorRecording`: explicit `retainUntil` per row (90 days clean / 365
  flagged — written by B4).

## Cross-references

- [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma)
- [MASTER_PLAN.md](../MASTER_PLAN.md) §3
- [SECURITY.md](./SECURITY.md) — token handling & PII commitments.
