# Runbook — Credential Rotation

**Last updated:** 2026-05-19
**Owner:** CodeForge Security Engineering
**Status:** Stub — to be expanded during Stage 0 (Brief A0) when the initial Supabase + JWT secret rotation actually happens.

This runbook documents the process to rotate any production secret on CodeForge. Will cover:

- Database password rotation (Postgres / Supabase): generate, update secret store, rolling restart of API and workers, verify.
- JWT signing key rotation: dual-key window (old verifies, new signs), 24h overlap, deprecate.
- S3 / object-storage access keys: per-tenant key rotation.
- LiveKit API keys (when proctoring B4 is live): coordinate with all proctor workers.
- Sentry, observability stack tokens.
- The git-filter-repo procedure for purging a leaked secret from git history, plus the communication checklist to collaborators after force-push.
- Verification: `gitleaks --redact` clean; canary requests succeed against rotated credentials.

For the original credential leak that motivated this runbook, see [MASTER_PLAN.md](../../MASTER_PLAN.md) §1 (critical finding #1) and Brief A0 Task 1.
