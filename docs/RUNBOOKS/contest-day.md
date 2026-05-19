# Runbook — Contest Day

**Last updated:** 2026-05-19
**Owner:** CodeForge Site Reliability
**Status:** Stub — to be expanded when contest engine (Brief A8) lands.

The on-call runbook for a contest day. Will cover:

- Pre-flight checklist (T-24h, T-1h, T-15m): judge-host count, queue depths, leaderboard service health, CDN cache state.
- The contest state machine timeline (DRAFT → SCHEDULED → RUNNING → ENDED → FINALIZED) and what each transition triggers.
- During-contest watch points: judge queue depth, verdict latency p95, leaderboard publish lag, error rate per endpoint.
- Incident playbook for: judge host down, Redis primary failover, leaderboard delay, problem leak.
- Communication templates for participants when something goes wrong (delay announcement, contest extension, contest cancellation).
- Post-contest: rating engine kickoff, plagiarism batch run (JPlag), editorial unlock, public scoreboard publish.

For the current placeholder pre-launch plan, refer to [MASTER_PLAN.md](../../MASTER_PLAN.md) §7 Brief A8 (contest engine) and [ANTI-CHEAT.md](../ANTI-CHEAT.md) §9 (incident response).
