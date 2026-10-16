# Contest operations and recovery

The API server starts the durable settlement poller with a unique worker identity. It polls persisted operations once per second; PostgreSQL remains authoritative and restarting the server resumes queued/expired claims. No separate in-memory queue is required. Candidate code still runs only in the isolated judge worker.

## Requests and status

An authorized administrator submits a stable operation key to the contest finalize/correct/replay endpoint. Repeating the same request/key returns its original operation; reusing a key for another intent returns a conflict. Persist the key across request timeouts. A successful enqueue response is not evidence that ratings have published.

`GET /api/contests/staff/:id/operations` returns bounded, sanitized operation status. The admin contest screen tracks its submitted operation until completion. Request payloads, private source and execution policy are not returned by this status API.

- `QUEUED`: awaiting a claim, required replacement verdicts, resolved disputes or an earlier rating correction.
- `RUNNING`: claimed with an expiring lease and monotonically increasing fence.
- `COMPLETED`: results committed atomically; inspect the stored result and current final scoreboard revision.
- `DEAD_LETTER`: bounded execution retries exhausted, legacy request inputs missing, or operator recovery required. Inspect the reason before retrying.

Claims use a 90-second lease and publication uses a transaction bounded to 60 seconds. Claiming and publishing serialize on the same global advisory transaction lock. The current state, worker identity, fence and lease are checked inside the transaction before publishing. Ordinary failures back off and stop after eight attempts. Waiting for expected judge/dispute/dependency readiness does not consume this retry budget.

## Correction integrity

Each original contest attempt has its own rejudge lineage. Other attempts on the same problem remain authoritative, preserving wrong-attempt penalties. Replacement source, manifest and original admission time remain immutable. A correction checkpoints the replacement job durably before waiting for its verdict, so a restarted operation resumes the same replacement.

Overlapping operations wait before creating another replacement in the same contest. Rated corrections also wait for earlier rated corrections in their rating prefix. Unrated score corrections do not block unrelated rated contests. Submission judging can be recovered before finalization, including in unrated contests; that operation finishes after the replacement verdict and leaves finalization as a separate explicit action.

Published final snapshots and ratings remain unchanged while a replacement is pending. Once ready, the operation rebuilds affected results and publishes revised snapshots, participant fields, authoritative rating generation and user projections together. Rated replay includes every later dependent contest and later opponents. Disqualification removes eligibility and resets users without authoritative rated history to the policy baseline. Historical snapshots/ledger rows are retained.

Do not edit terminal judge records, immutable manifests, rating ledger rows or user projection fields manually. Recovery must use an audited replacement/correction operation. Sealed and superseded manifests reject payload updates/deletion; only the controlled sealed-to-superseded transition is permitted.

## Failure recovery

1. Verify the real isolated judge is healthy when replacement work is blocked. Infrastructure failure is never a wrong answer.
2. Resolve blocking disputes with the proper staff workflow and a reason. The settlement poller retries waiting operations automatically.
3. A failed replacement judge job moves its settlement operation to `DEAD_LETTER`, preserving published results. After resolving the judge incident, use `POST /api/contests/staff/:id/operations/:operationId/retry` with an explanatory `reason`; only authorized operators may retry. The operation retains its original identity, advances its fence and restarts a bounded retry cycle. For a failed replacement, retry clears that failed checkpoint and creates a new job and lineage generation under a fence-specific request key; the failed job remains intact for audit. A successful existing checkpoint is retained. An unrecoverable legacy row without request data requires a new explicit operation; no actor or target is guessed.
4. Check final operation status, scoreboard revision/checksum, authoritative ledger history and user projections. Do not infer success from an HTTP enqueue response or a running judge process.

## Reproducible verification

- `scripts/verify-phase3-data.sh` / `scripts/verify-phase3.ps1`: fresh PostgreSQL, explicitly synthetic scoring/history fixtures, durable recovery/dependency/lineage tests, migration compatibility and complete-row restore fingerprints. Synthetic fixture writes are confined to these verifiers.
- `scripts/verify-phase3-judge.sh` / `.ps1`: fresh credentials/database, verified isolated worker, real contest admissions/verdicts, controlled crash/fencing, four supported languages, both supported modes, browser lifecycle and restore verification. No skip flag can certify this gate.
- `apps/api/src/contests/*test.ts`: scoring, manifest/evidence, admission/scope, independent high-precision rating oracle and privacy regressions.

Only fresh disposable databases may be seeded or migrated by verification scripts. Keep private dumps, runtime credentials, worker logs containing private data and browser traces out of Git and public artifacts. A matching dump/restore fingerprint verifies persisted bytes, not scoring correctness; both behavioral tests and restore checks are required.

## Deployment boundary

This runbook documents implementation behavior. It does not authorize public deployment or certify historical credential-incident closure. Follow the current delivery review and production release gate before an external pilot.
