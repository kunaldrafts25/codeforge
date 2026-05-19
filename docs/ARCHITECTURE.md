# CodeForge — System Architecture

**Last updated:** 2026-05-19
**Owner:** CodeForge Platform Engineering
**Audience:** Engineers joining the team — read this first.

This is the one-read "what is this system" document. Read this on day one. The deeper docs ([DATA-MODEL.md](./DATA-MODEL.md), [SECURITY.md](./SECURITY.md), [ANTI-CHEAT.md](./ANTI-CHEAT.md), [PROCTORING-POLICY.md](./PROCTORING-POLICY.md), [MASTER_PLAN.md](../MASTER_PLAN.md)) flesh out individual surfaces.

---

## 1. What we are building

CodeForge is two products on shared infrastructure:

- **CodeForge Arena** — a competitive-programming platform: practice problems with stdio and function-mode judging, contests with ICPC/IOI/AtCoder/CF formats, an Elo-style rating engine, editorials, discussions. The product target is "what LeetCode and Codeforces do, with the seriousness of Codeforces and the polish of LeetCode."
- **CodeForge Aptitude** — a campus-hiring aptitude platform: sectional MCQ/numeric/code tests, IRT-calibrated item bank, adaptive testing, full proctoring. The target is "what TalentBattle, AMCAT, Mettl, and CoCubes do, with a transparent and fair proctoring policy."

Both pillars share the user account, the same authentication, the same submission pipeline (for the code section of aptitude tests), the same proctoring stack, and the same admin tools.

---

## 2. High-level topology

```text
                                  ┌──────────────────────────────┐
                                  │      CDN (Cloudflare)         │
                                  └──────────────┬────────────────┘
                                                 │
                                  ┌──────────────▼────────────────┐
                                  │  Next.js 14 frontend (web)    │
                                  │  - Arena                      │
                                  │  - Aptitude (quiz runner)     │
                                  │  - Admin (Polygon-light)      │
                                  └──────────────┬────────────────┘
                                                 │  HTTPS
                                  ┌──────────────▼────────────────┐
                                  │  Fastify API gateway           │
                                  │  - JWT cookie + CSRF          │
                                  │  - Rate-limit / helmet / CSP  │
                                  │  - OpenAPI (Zod schemas)      │
                                  └─┬─────────┬─────────┬─────────┘
                                    │         │         │
              ┌─────────────────────┘         │         └────────────────────────────┐
              ▼                               ▼                                       ▼
   ┌─────────────────────┐   ┌─────────────────────────┐                ┌────────────────────────┐
   │  PostgreSQL 16      │   │  Redis 7 (HA)           │                │  S3 / MinIO            │
   │  (Prisma)           │   │  - BullMQ queues        │                │  - test cases           │
   │  partitioned        │   │  - sessions             │                │  - submission source    │
   │  submissions /      │   │  - leaderboard ZSETs    │                │  - proctor recordings   │
   │  proctor events     │   │  - pubsub               │                │                        │
   └─────────────────────┘   └────────┬────────────────┘                └────────────────────────┘
                                      │
                                      │ BullMQ (contest / practice / replay lanes)
                                      │
                ┌─────────────────────┴─────────────────────────────────────┐
                ▼                                                           ▼
   ┌──────────────────────────────┐                          ┌────────────────────────────┐
   │  Judge workers (bare-metal)  │                          │  Async workers              │
   │  - isolate sandbox            │                          │  - rating engine            │
   │  - per-language toolchains    │                          │  - leaderboard writer       │
   │  - SSE verdict stream         │                          │  - plagiarism (Dolos/JPlag) │
   │  - audit-log to S3            │                          │  - proctoring forensics     │
   │  - tmpfs box, netns           │                          │  - notifications            │
   └──────────────────────────────┘                          └─────────────────────────────┘

                            ┌───────────────────────────────────────┐
                            │  ClickHouse                            │
                            │  - event log                           │
                            │  - proctoring telemetry                │
                            │  - item analytics                      │
                            └───────────────────────────────────────┘
```

The split between **app workloads** (web, API, async workers — containerised on Kubernetes) and **judge workers** (bare-metal Linux hosts with `isolate`) is deliberate. The judge cannot run inside Docker without weakening the sandbox guarantees we need (see [MASTER_PLAN.md](../MASTER_PLAN.md) §2.2 and research §1.7). Everything else runs in containers.

---

## 3. The two pillars share infrastructure

Both pillars use:

- The same **User** record (with separate `arenaRating` and `aptitudeTheta` fields).
- The same **API gateway** (`apps/api/`), with route namespaces `/api/arena/*` and `/api/quiz/*`.
- The same **judge worker** for code submissions. An Arena submission and the code section of an Aptitude test enter the same BullMQ queues; the judge is agnostic to context.
- The same **proctoring SDK** (`packages/proctor-sdk/`). Aptitude tests use the `strict` or `high_stakes` profile; Arena contests typically use `light` or `off`.
- The same **anti-cheat backend** (suspicion scoring + reviewer dashboard). Plagiarism runs against all code submissions regardless of pillar.

What differs:

- The **frontend route trees** (`apps/web/arena/`, `apps/web/aptitude/`) and their UX.
- The **scoring engines** (contest scoring in `apps/async-worker/contest/`, quiz scoring in `apps/async-worker/quiz/`).
- The **rating** systems: Arena uses Open Codeforces rating; Aptitude uses IRT 3PL with a 100–900 scaled score.

---

## 4. Components — one paragraph each

### 4.1 Web (`apps/web`)

Next.js 14 with the app router. Renders the Arena, Aptitude, and Admin surfaces. Uses RSC where it helps (problem listings, profile pages), client components where it doesn't (Monaco editor, quiz runner, proctoring SDK). TanStack Query for client-side server state, Zustand for ephemeral client state. Tailwind + shadcn/ui for styling. Monaco for the code editor. TipTap + KaTeX for markdown/math in problem statements. MediaPipe Tasks Vision (browser-side) for face/iris tracking inside the proctoring SDK. Authenticates via httpOnly cookie; CSRF token attached to state-changing requests.

### 4.2 API (`apps/api`)

Fastify (Node 20). Every route validated with Zod schemas via `fastify-type-provider-zod`; OpenAPI auto-generated. Helmet + rate-limit + CSP applied globally; auth routes have aggressive per-IP throttling. Structured logging via Pino, with request IDs propagated through OpenTelemetry baggage. Sentry for errors. The API is a thin tier: it validates input, enforces auth, persists, and enqueues work. Heavy work goes to async workers; the API does not block on it.

### 4.3 Judge worker (`apps/judge-worker`)

Node 20 BullMQ consumer running on dedicated bare-metal Linux hosts. For each submission: pulls source from S3, allocates an `isolate` box, compiles, runs per-test with strict resource limits (`--cg-mem`, `--time`, `--wall-time`, `--processes=1`, `--no-default-dirs`, network namespace), aggregates verdicts, streams SSE events via Redis pubsub, writes an immutable audit record to S3. One concurrency slot per host to avoid contention; horizontal scale via more hosts. Toolchains: gcc/g++ 13.2, OpenJDK 21, Python 3.12, Node 20, Go 1.22, Rust 1.76. Provisioning via Ansible (`infra/ansible/judge-host.yml`).

### 4.4 Async worker (`apps/async-worker`)

The everything-else worker pool. Containerised, runs on Kubernetes. Five major responsibility areas:

- **Contest engine.** State machine (DRAFT → SCHEDULED → RUNNING → ENDED → FINALIZED), scoring engines per format, leaderboard writer.
- **Rating engine.** Open Codeforces Rating computation on FINALIZED contests.
- **Plagiarism.** Dolos (live), JPlag (post-contest batch), AST-hash index, ω-Index for MCQ.
- **Proctoring forensics.** Aggregate raw events from ClickHouse, compute suspicion score, write back to `QuizAttempt.suspicionScore`, route to reviewer queue.
- **Notifications.** Contest reminders, rating updates, review decisions.

### 4.5 Admin (`apps/admin`)

A separate Next.js application (separate deployment, separate auth-required-by-default) for problem authoring (the Polygon-light tool), quiz item authoring, reviewer dashboard, audit log browser, and operational tooling. RBAC-gated: PROBLEM_SETTER, REVIEWER, MODERATOR, ADMIN, SUPER_ADMIN.

### 4.6 Database (PostgreSQL 16 via Prisma)

The canonical source of truth. Hot tables (`Submission`, `ProctorEvent`, `QuizResponse`) are declaratively partitioned monthly. Indexes match the access patterns documented in [DATA-MODEL.md](./DATA-MODEL.md). Extensions: `pg_trgm` for fuzzy text search on tags and slugs, `vector` for embedding-based similarity (used by the descriptive-answer plagiarism path). Connection-pooled via PgBouncer.

### 4.7 Queue (BullMQ on Redis 7)

Three lanes — `contest`, `practice`, `replay` — with priority order. Redis is also session storage and the leaderboard ZSET store. Single-AZ Redis with sentinel HA in development; managed HA in production.

### 4.8 Sandboxing layer (`isolate`)

The IOI sandbox. Compiled from `github.com/ioi/isolate`. Each judge worker host has up to 50 box IDs free-listed; one submission allocates one box. Inside the box: tmpfs `/box`, no default mounts, no network (loopback only), strict cgroup limits. Per-language seccomp-bpf allowlist applied via a thin wrapper inside the box. No Docker.

### 4.9 Observability

OpenTelemetry SDK in every app → Tempo (trace), Loki (logs), Prometheus (metrics). Grafana dashboards per service. Sentry for unhandled errors. Custom metrics: `judge_queue_seconds`, `judge_verdict_total`, `quiz_attempts_in_flight`, `proctor_events_per_attempt`, `auth_login_attempts_total`, etc.

---

## 5. Data flow — four worked scenarios

### 5.1 A code submission (Arena practice)

1. User writes code in Monaco, clicks **Submit**.
2. `apps/web` POSTs `/api/arena/problems/:slug/submissions` with `{code, language}`. Cookie-authenticated; CSRF token required.
3. `apps/api` validates, writes a `Submission` row with `verdict=PENDING`, uploads code to S3, enqueues a BullMQ job on the `practice` lane.
4. The user's browser opens an SSE connection to `/api/arena/submissions/:id/stream`. The API subscribes to Redis pubsub channel `submission:<id>:events` and pipes events through.
5. A judge worker picks the job. For each test case: runs in isolate, emits `event: testcase` to the Redis channel; the user's browser receives it and updates the UI.
6. After the last test: worker writes the final verdict to the `Submission` row, emits `event: complete`, writes the audit record to S3.
7. Async worker picks up `Submission.verdict = ACCEPTED` events, updates `User.arenaProblemsSolved`, increments daily streak, fires badge checks.
8. AST-hash index update happens asynchronously; if a high-similarity match is found, a `PlagiarismMatch` row is written and the reviewer queue surfaces it.

### 5.2 A contest start

1. A scheduled job (cron in `apps/async-worker/contest/scheduler.ts`) sweeps every minute. At `Contest.startTime`, it flips `status` from `SCHEDULED` to `RUNNING` and publishes a `contest:<id>:started` event.
2. Web tier, subscribed via WebSocket, broadcasts to all clients in the contest lobby — countdown reaches zero, problem list unlocks.
3. As participants submit, submissions are tagged with `contestId`. The judge worker treats them like any other submission but routes them via the `contest` BullMQ lane (higher priority).
4. On each AC during the contest, the async-worker leaderboard pipeline updates `ContestParticipant.score` and `penalty`, updates the Redis ZSET `contest:<id>:leaderboard`, and broadcasts a delta on `contest:<id>:leaderboard` via pubsub. The web tier propagates via WebSocket to subscribed clients.
5. At `Contest.endTime`, the scheduler flips `status` to `ENDED`. Submissions still accepted as "out-of-time" for the next 5 minutes to handle in-flight requests; they are recorded but not scored.
6. After a configurable freeze window (default 12h for rated contests), the state machine flips `ENDED` to `FINALIZED`. This triggers the rating engine, finalises the leaderboard, unlocks the editorial.

### 5.3 A quiz attempt

1. Candidate opens `/aptitude/:slug`, reads instructions, ticks the proctoring consent box, clicks **Start**.
2. `apps/api` creates a `QuizAttempt` with `seed = sha256(attemptId + testId)`. Server computes the per-candidate question pool, persists `optionOrderShown` per response stub.
3. Proctoring SDK (`packages/proctor-sdk`) initialises: starts webcam/screen/mic capture if level requires, begins streaming events to `/api/proctor/events`.
4. Test runner UI renders one question at a time. Each interaction (answer change, mark for review, navigate) POSTs to `/api/quiz/attempts/:id/responses` with debounce. Server persists.
5. Every 15s the client polls `/api/quiz/attempts/:id/timer` for an authoritative remaining-time value. UI corrects for drift.
6. Proctoring events stream to `apps/api/src/routes/proctor/events`, validated, written to ClickHouse (analytics) and the `ProctorEvent` table (the flag-level subset).
7. On submit (or auto-submit at deadline): server marks `submittedAt`, kicks off scoring. Objective items grade synchronously; descriptive items queue for grading. The forensics worker computes suspicion score asynchronously.
8. If suspicion bucket is Green (0–20), `reviewStatus` is set to `clean` automatically. Otherwise, it stays `pending` and the attempt enters the reviewer queue.

### 5.4 An anti-cheat flag

1. During a quiz, the user pastes a 1200-character block of text into a descriptive answer. The proctoring SDK fires a `paste` event with `payload.textLength=1200` and `severity=flag`.
2. The event lands in `/api/proctor/events`, is written to ClickHouse and (because severity=flag) also to the `ProctorEvent` table.
3. The user sees a warning toast: "Large paste detected. Further violations may invalidate this attempt."
4. On submit, the forensics worker reads all events for the attempt from ClickHouse, applies the weights table from [ANTI-CHEAT.md](./ANTI-CHEAT.md) §3, computes suspicion score = 47 (Yellow bucket).
5. The attempt enters the reviewer queue at standard priority. The candidate sees "your attempt is undergoing integrity verification" on the result page.
6. A reviewer picks it up within 5 business days, watches the relevant clips, reviews the paste event and its context (was the candidate typing for the previous 30 minutes? Is this a quote from the question?), and decides "minor concern, score stands" + documents reasoning.
7. Candidate receives an email: "Your score has been verified. Result: [link]."

---

## 6. Decision log highlights

Selected rationale from [MASTER_PLAN.md](../MASTER_PLAN.md) §2.2 — one sentence each:

- **Fastify over Express.** First-class TS, 2–3× faster, validated JSON-schema via Zod, plugin ecosystem covers what we need without rolling our own.
- **isolate over Docker / nsjail / gVisor.** isolate is the actual sandbox used by ICPC and IOI; Judge0 has had repeated sandbox-escape CVEs because Docker is not designed to contain hostile code; gVisor is the next-most-credible option if we ever need stronger isolation, but isolate fits our threat model today.
- **BullMQ over Kafka.** Kafka is the wrong tool for a job queue; BullMQ is Node-native, KEDA-friendly, and gives us priorities + retries + dead-letter queues out of the box.
- **Open Codeforces Rating over Elo-MMR.** CF's algorithm is battle-tested at millions of contestants, transparent (open-sourced by Codeforces), and produces familiar dynamics; Elo-MMR is technically interesting but unfamiliar to users.
- **MediaPipe over commercial face detection.** Open-source, runs in the browser (no server-side framing per candidate), no per-seat licensing cost; documented bias profile we can mitigate transparently.
- **PostgreSQL over MySQL/CockroachDB.** Prisma's best support; we want partitioning, JSONB, and `pg_trgm`/`vector` extensions; we are not at the scale where horizontal sharding wins.
- **httpOnly cookies + CSRF over localStorage JWTs.** Eliminates the XSS-exfiltration class of attacks; standard pattern; refresh-token rotation gives us session revocation.
- **argon2id over bcrypt.** Modern memory-hard hash; bcrypt is acceptable but argon2id is now the default for new systems.
- **Server-authoritative everything.** Timers, scoring, randomisation seed all live server-side because every CP/aptitude platform that trusted the client has had cheating scandals.
- **"Flag, never auto-fail."** No suspicion threshold causes an automatic disqualification; every decision passes through a trained human. Owed to PROCTORING-POLICY.md, ANTI-CHEAT.md, and the fact that auto-fail systems ruin lives.

---

## 7. Where to start reading code

When you join the team, read these five files first, in order:

1. **`packages/db/prisma/schema.prisma`.** The data model is the system. Once you understand the schema, every API route makes sense. Cross-reference with [DATA-MODEL.md](./DATA-MODEL.md) and [MASTER_PLAN.md](../MASTER_PLAN.md) §3.
2. **`apps/api/src/app.ts`.** Fastify bootstrap, plugin registrations, route registrations, error handling. Tells you which routes exist and what middleware they pass through.
3. **`apps/judge-worker/src/index.ts` + `apps/judge-worker/src/run-test.ts`.** The judge is the most critical-path code in the system. Read the BullMQ consumer entry point, follow it down to the per-test execution function, understand exactly which flags we pass to `isolate`.
4. **`packages/proctor-sdk/src/index.ts`.** The proctoring SDK is the contract between client and server for everything anti-cheat. Read the event shape, the level configurations, and the lifecycle hooks.
5. **`apps/async-worker/contest/rating.ts`.** The Open Codeforces Rating implementation. Read it alongside MASTER_PLAN §2.6 to convince yourself the math is right.

After those five files, branch into whichever surface you are working on. The PR templates in `.github/PULL_REQUEST_TEMPLATE.md` will remind you to update [DATA-MODEL.md](./DATA-MODEL.md), [SECURITY.md](./SECURITY.md), and add Grafana panels for new features.

---

## 8. Onward links

- [MASTER_PLAN.md](../MASTER_PLAN.md) — the canonical plan; §2 is architecture, §3 is the schema, §7 is the agent briefs.
- [DATA-MODEL.md](./DATA-MODEL.md) — every table, every index, every relationship.
- [SECURITY.md](./SECURITY.md) — threat model, auth flows, secret management, disclosure policy.
- [ANTI-CHEAT.md](./ANTI-CHEAT.md) — the internal anti-cheat runbook (operations companion to PROCTORING-POLICY).
- [PROCTORING-POLICY.md](./PROCTORING-POLICY.md) — the candidate-facing policy.
- [PROBLEM-AUTHORING.md](./PROBLEM-AUTHORING.md) — how to author problems on the Arena.
- [RUNBOOKS/](./RUNBOOKS/) — on-call runbooks (contest day, judge-host failure, credential rotation, etc.).

---

## Change log

- 2026-05-19 — Initial draft. Reflects the planned architecture per MASTER_PLAN.md as of this date; will be updated as Stage 0–4 ships.
