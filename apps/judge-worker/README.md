# Disposable Phase 2 judge

Use a trusted Linux x86_64 Docker host with cgroup v2 and at least 4 GiB available memory; the test engine is capped at 2.5 GiB and two CPUs. Candidate code executes inside pinned gVisor sandboxes. The outer Docker-in-Docker engine is a privileged **trusted control plane** with no host binds/socket, network, published ports or application credentials. This setup requires independent security review before shared deployment.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
source scripts/setup-judge.sh
bash scripts/verify-phase2-judge.sh
```

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
. ./scripts/setup-judge.ps1
./scripts/verify-phase2-judge.ps1
```

The setup builds pinned toolchain/runtime sources and records immutable image content IDs. The acceptance script creates fresh PostgreSQL, seed, signing and CSRF credentials. It never copies local environment files or seeds a shared database. Missing runtime, skipped capacity, failed tests or restore mismatch fail the run. Linux cleans up its own project/engine; PowerShell retains them for inspection. Delete only the reported disposable project/engine after exporting private backups securely. Never use a global Docker prune.

## Service boundary

The API never executes source. Start the trusted worker with `pnpm --filter @codeforge/judge-worker dev`; it needs `DATABASE_URL`, the non-secret `FORGE_JUDGE_ENGINE` and `FORGE_TOOLCHAIN_IMAGE` values returned by setup. The API requires `FORGE_PRACTICE_ENABLED=1` and a fresh verified runtime row. Withdraw the flag to stop new admission; existing jobs retain durable intent. Runtime availability expires after 45 seconds without a heartbeat.

PostgreSQL admission/outbox/leases/results are authoritative. Polling remains correct if `pg_notify` wake-ups are lost. Dispatch retries at most ten times; execution infrastructure retries at most three times with backoff. Leases last 30 seconds, heartbeats occur every five seconds, maintenance every ten seconds. A fencing token protects terminal completion and exactly-once solve effects. `/admin/judge` exposes failures and audited recovery generations. Original submissions/reference evidence are retained; terminal sample/custom leaf runs expire after 30 days in bounded batches of 100.

The independent engine watchdog removes dead/orphaned sandboxes and source volumes, including after worker or database failure. Never mount private packages or credentials into candidates. Only a source bundle, one test input and fixed generated wrapper enter each sandbox; trusted comparison and expected output remain in the worker.

## Resource and diagnostic policy

Each sandbox has one CPU, a host PID ceiling of 512 (including Sentry/gofer/stubs), and no swap. The guest PID controller is 63; measured admission is at most 64 new tasks/66 accounted tasks including bootstrap. Candidate UID/GID is 65534 with zero capabilities and no new privileges. Root is read-only, source is a per-job read-only Docker volume, and temporary work is 128 MiB during compilation / 16 MiB during execution. Files are limited to 8 MiB, open descriptors to 128, cores disabled. Compilation has 20 CPU seconds, 30 wall seconds, 640 MiB measured memory and 32 KiB output; candidate runtime uses problem CPU time, wall `3*time+1000` ms, and combined stdout/stderr output bound.

CPU and wall time are measured for the whole sandbox cgroup during compilation/execution, including gVisor overhead. A trusted startup handshake holds candidate execution until UID, syscall and process controls are verified; setup has its own five CPU-second/ten wall-second bounds. The controller snapshots CPU counters before acknowledging startup, so candidate code cannot run before timing begins. Peak memory includes the whole sandbox, including startup. Runtime measured memory ceiling is problem memory + 64 MiB (C++/Python), +128 MiB (JavaScript), +192 MiB (Java); native hard ceiling adds another 128 MiB.

Measured resident consumption determines candidate MEMORY_LIMIT. Node and JVM use fixed 8 GiB heap headroom, above every supported native sandbox ceiling, rather than a problem-sized heap cap. That virtual maximum does not grant 8 GiB resident memory. A 64 MiB Java allocation can therefore complete under a 16 MiB problem budget plus the 192 MiB runtime allowance. An allocation exception, diagnostic claiming OOM, or abort below the measured ceiling remains RUNTIME_ERROR; diagnostic text and generic exit codes do not establish a memory limit. Native cgroup/Sentry OOM remains an infrastructure failure. See the official [Java heap option](https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html) and [Node heap option](https://nodejs.org/download/release/v22.20.0/docs/api/cli.html#--max-old-space-sizesize-in-mib). Python/JavaScript syntax checks map to compilation error; later uncaught errors map to runtime error. Public diagnostics are sanitized/bounded; arbitrary hidden stdout/stderr and checker text stay private.

Function results are parsed and validated against the signature before comparison. Exact and token policies both compare typed values and structures exactly (JSON formatting is irrelevant; string whitespace is significant). Only float applies configured tolerance to double values, including double lists/matrices. Exact/token require zero tolerances; float requires a positive tolerance and double functional return type. Standard I/O retains byte-exact, whitespace-token and numeric-float semantics. Invalid policies fail package validation and direct checking.

Function and parameter identifiers share a portable 1–64 character subset across all four languages. Language keywords and harness dependencies such as `require`, `JSON`, `process`, `forgeArgs`, `forgeResult`, `Json`, `Main` and `System` are reserved; prefixed/suffixed distinct names remain supported. These restrictions prevent wrapper collisions; generated wrappers are untrusted sandbox code.

Run `scripts/verify-phase2-review.ps1` on Windows or `bash scripts/verify-phase2-review.sh` on Linux for fresh isolated review regressions: 56 resource jobs across four languages and two modes, two original heap probes, and 84 actual checker/name jobs. The complete required judge integration includes these checks before durability, capacity, live browser and private restore acceptance.

The pinned gVisor OCI converter loses per-rule errno values. A trusted inherited BPF filter continues to **deny** `clone3`, returning ENOSYS so glibc can fall back to Docker's filtered `clone`. The default OCI allowlist remains enforced, including namespace restrictions. See the pinned official [converter](https://github.com/google/gvisor/blob/release-20260928.0/runsc/specutils/seccomp/seccomp.go) and [filter composition](https://github.com/google/gvisor/blob/release-20260928.0/pkg/sentry/kernel/seccomp.go).

## Verification

`integration` runs real language, typed boundary, verdict/limit/checker and isolation probes. `verify-phase2-judge.ts` interrupts actual worker processes at durable boundaries, verifies stale completion and retry/dead-letter/recovery, runs real storage/transport faults, and reconciles 1,000 executed jobs. Synthetic persistence fixtures in `verify-phase2-data.ts` are separate and never certify judging. Acceptance-only pause hooks refuse non-disposable databases and do not manufacture results.

Supported function values: int32, JavaScript-safe signed `long`, finite double, bool, Unicode string, primitive lists and rectangular matrices. No null/void/char, arbitrary nesting, custom/interactive checker, C or contest mode. Only the return value is judged; each case has fresh values/sandbox. Integer/string comparisons are exact; tolerances apply only to doubles. Test fixtures are original disposable material, not catalog acceptance of third-party content.

Backups must retain all private PostgreSQL packages/source/policies/evidence and pinned toolchain/runtime archives. Restore fingerprints cover fifteen tables. Rebuild identities must match the saved policy to reproduce a historical generation; a changed runtime requires audited rejudge. Rollback disables admission, stops workers, preserves private evidence, and restores a verified pre-deploy backup into a different database before an endpoint switch. No shared deployment or launch is authorized by local acceptance.
