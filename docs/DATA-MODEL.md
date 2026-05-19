# Data Model

**Last updated:** 2026-05-19
**Owner:** CodeForge Platform Engineering
**Status:** Stub — full content to be authored as Stage 0 lands the Prisma schema rewrite.

This document is the line-by-line reference for the CodeForge data model: every table, every index, every relationship, the rationale for each choice.

For now, the canonical source is [MASTER_PLAN.md](../MASTER_PLAN.md) §3 (the full Prisma schema). When Stage 0 (Brief A0) merges and the schema is materialised under `packages/db/prisma/schema.prisma`, this document will be expanded to cover:

- Table-by-table walk-through, with rationale per column.
- Index strategy and why each index exists.
- Partitioning scheme for hot tables (`Submission`, `ProctorEvent`, `QuizResponse`) — monthly partitions, lifecycle, archival.
- Migration history and the backfill procedure from the prototype schema.
- Soft-delete / hard-delete semantics, retention TTLs (see [PROCTORING-POLICY.md](./PROCTORING-POLICY.md) for the policy-side commitments).
- Postgres extensions in use (`pg_trgm`, `vector`) and where they are leveraged.
- The relationship between Postgres (truth) and ClickHouse (analytics replica).

Until then, read [MASTER_PLAN.md](../MASTER_PLAN.md) §3 directly.
