import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient, type PracticeJob } from '@prisma/client'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const languages = ['cpp', 'python', 'java', 'javascript']
const terminalVerdicts = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'COMPILATION_ERROR',
  'RUNTIME_ERROR',
  'TIME_LIMIT',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'JUDGE_FAILURE',
  'RUN_COMPLETE',
]

async function serial<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let n = 0; n < 4; n++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        n < 3 &&
        (['P2034', 'P2002'].includes(e.code) ||
          (e.code === 'P2010' && ['40001', '40P01'].includes(String(e.meta?.code))))
      )
        continue
      throw e
    }
  }
  throw new Error('Transaction retry exhausted')
}
export { serial as practiceTransaction }

// Persistence only. The API does not call this until execution admission is
// verified. A trusted worker must verify isolation independently before use.
export async function enqueuePracticeJob(
  db: PrismaClient,
  input: {
    ownerId: string
    versionId: string
    kind: 'RUN' | 'SUBMIT' | 'VALIDATE'
    language: string
    source: string
    input?: string
    idempotencyKey: string
    policy: Prisma.InputJsonObject
  }
) {
  if (
    !languages.includes(input.language) ||
    Buffer.byteLength(input.source) < 1 ||
    Buffer.byteLength(input.source) > 65536 ||
    Buffer.byteLength(input.input ?? '') > 65536
  )
    throw new Error('Invalid job limits/language')
  const requestHash = digest(
    JSON.stringify([
      input.versionId,
      input.kind,
      input.language,
      input.source,
      input.input ?? null,
      input.policy,
    ])
  )
  return serial(db, async tx => {
    const existing = await tx.practiceJob.findUnique({
      where: {
        ownerId_idempotencyKey: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey },
      },
    })
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new Error('Idempotency key conflicts with another request')
      return existing
    }
    const v = await tx.practiceVersion.findUnique({
      where: { id: input.versionId },
      include: { problem: { select: { status: true, isPublic: true } } },
    })
    if (
      !v ||
      v.withdrawnAt ||
      (input.kind === 'VALIDATE'
        ? !['DRAFT', 'VALIDATED'].includes(v.status)
        : v.status !== 'PUBLISHED' || v.problem.status !== 'PUBLISHED' || !v.problem.isPublic)
    )
      throw new Error('Version is not published')
    const active = { state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } }
    if (
      (await tx.practiceJob.count({ where: { ...active, ownerId: input.ownerId } })) >=
        (input.kind === 'VALIDATE' ? 4 : 3) ||
      (await tx.practiceJob.count({ where: active })) >= 1000
    )
      throw new Error('Judge admission capacity exhausted')
    const job = await tx.practiceJob.create({
      data: {
        ownerId: input.ownerId,
        versionId: v.id,
        kind: input.kind,
        language: input.language,
        source: input.source,
        input: input.input ?? null,
        sourceHash: digest(input.source),
        requestHash,
        idempotencyKey: input.idempotencyKey,
        policy: { ...input.policy, packageHash: v.packageHash },
        outbox: { create: {} },
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: input.ownerId,
        action: 'practice.enqueue',
        target: job.id,
        payload: { kind: input.kind, packageHash: v.packageHash },
      },
    })
    return job
  })
}

// At-least-once wake-up delivery. PostgreSQL remains authoritative. A crash
// between send and update may duplicate the ID, which lease fencing tolerates.
export async function dispatchPracticeOutbox(
  db: PrismaClient,
  send: (id: string) => Promise<void>
) {
  const rows = await db.practiceOutbox.findMany({
    where: { deliveredAt: null, availableAt: { lte: new Date() }, job: { state: 'QUEUED' } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  for (const row of rows) {
    try {
      await send(row.jobId)
      await db.practiceOutbox.updateMany({
        where: { id: row.id, deliveredAt: null },
        data: { deliveredAt: new Date(), attempts: { increment: 1 } },
      })
    } catch {
      await serial(db, async tx => {
        const updated = await tx.practiceOutbox.updateMany({
          where: { id: row.id, deliveredAt: null, attempts: row.attempts },
          data: {
            attempts: { increment: 1 },
            availableAt: new Date(
              Date.now() + Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6))
            ),
          },
        })
        if (updated.count && row.attempts >= 9) {
          const stopped = await tx.practiceJob.updateMany({
            where: { id: row.jobId, state: 'QUEUED' },
            data: {
              state: 'DEAD_LETTER',
              verdict: 'JUDGE_FAILURE',
              failureCode: 'DISPATCH_EXHAUSTED',
              finishedAt: new Date(),
              fence: { increment: 1 },
            },
          })
          if (stopped.count)
            await tx.auditLog.create({
              data: {
                action: 'practice.dead_letter',
                target: row.jobId,
                payload: { cause: 'DISPATCH_EXHAUSTED', attempts: row.attempts + 1 },
              },
            })
        }
      })
    }
  }
  return rows.length
}

export async function leasePracticeJob(
  db: PrismaClient,
  workerId: string,
  leaseSeconds = 30
): Promise<PracticeJob | null> {
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(workerId) ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 5 ||
    leaseSeconds > 120
  )
    throw new Error('Invalid worker lease')
  const jobs = await db.$queryRaw<PracticeJob[]>`
    WITH next AS (
      SELECT j."id" FROM "PracticeJob" j JOIN "PracticeOutbox" o ON o."jobId" = j."id"
      WHERE j."state" = 'QUEUED' AND j."availableAt" <= CURRENT_TIMESTAMP AND j."attempt" < 3 AND o."deliveredAt" IS NOT NULL
      ORDER BY j."createdAt", j."id" FOR UPDATE OF j SKIP LOCKED LIMIT 1
    ) UPDATE "PracticeJob" j SET "state" = 'COMPILING', "attempt" = j."attempt" + 1,
      "fence" = j."fence" + 1, "leaseOwner" = ${workerId},
      "leaseExpiresAt" = CURRENT_TIMESTAMP + ${leaseSeconds} * INTERVAL '1 second',
      "startedAt" = COALESCE(j."startedAt", CURRENT_TIMESTAMP)
    FROM next WHERE j."id" = next."id" RETURNING j.*`
  return jobs[0] ?? null
}

export async function heartbeatPracticeJob(
  db: PrismaClient,
  id: string,
  workerId: string,
  fence: number
) {
  return db.$executeRaw`UPDATE "PracticeJob" SET "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
    WHERE "id" = ${id} AND "leaseOwner" = ${workerId} AND "fence" = ${fence}
      AND "state" IN ('COMPILING', 'RUNNING') AND "leaseExpiresAt" > CURRENT_TIMESTAMP`
}

export async function reconcilePracticeJobs(db: PrismaClient) {
  return serial(db, async tx => {
    const stale = await tx.$queryRaw<PracticeJob[]>`SELECT * FROM "PracticeJob"
      WHERE "state" IN ('COMPILING', 'RUNNING') AND "leaseExpiresAt" <= CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED LIMIT 100`
    for (const j of stale) {
      const exhausted = j.attempt >= 3
      await tx.practiceJob.update({
        where: { id: j.id },
        data: {
          state: exhausted ? 'DEAD_LETTER' : 'QUEUED',
          verdict: exhausted ? 'JUDGE_FAILURE' : null,
          failureCode: 'LEASE_EXPIRED',
          finishedAt: exhausted ? new Date() : null,
          fence: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: new Date(Date.now() + Math.min(60000, 1000 * 2 ** j.attempt)),
        },
      })
      if (!exhausted)
        await tx.practiceOutbox.update({
          where: { jobId: j.id },
          data: { deliveredAt: null, availableAt: new Date() },
        })
      if (exhausted && j.scope === 'CONTEST') {
        await tx.contestSubmission.updateMany({
          where: { jobId: j.id },
          data: { state: 'DEAD_LETTER', verdict: 'JUDGE_FAILURE' },
        })
      }
      await tx.auditLog.create({
        data: {
          action: exhausted ? 'practice.dead_letter' : 'practice.recover',
          target: j.id,
          payload: { attempt: j.attempt, fence: j.fence },
        },
      })
    }
    return stale.length
  })
}

export async function completePracticeJob(
  db: PrismaClient,
  lease: { id: string; workerId: string; fence: number },
  result: {
    verdict: string
    passed: number
    total: number
    timeMs: number | null
    memoryKb: number | null
    privateEvidence: Prisma.InputJsonValue
  }
) {
  if (
    !terminalVerdicts.includes(result.verdict) ||
    !Number.isInteger(result.total) ||
    result.total < 0 ||
    result.total > 100 ||
    !Number.isInteger(result.passed) ||
    result.passed < 0 ||
    result.passed > result.total ||
    (result.verdict === 'ACCEPTED' && (result.total === 0 || result.passed !== result.total)) ||
    [result.timeMs, result.memoryKb].some(n => n !== null && (!Number.isInteger(n) || n < 0)) ||
    Buffer.byteLength(JSON.stringify(result.privateEvidence)) > 512 * 1024
  )
    throw new Error('Invalid completion evidence')
  return serial(db, async tx => {
    const rows = await tx.$queryRaw<
      PracticeJob[]
    >`UPDATE "PracticeJob" SET "state" = 'TERMINAL', "verdict" = ${result.verdict},
      "finishedAt" = CURRENT_TIMESTAMP, "leaseOwner" = NULL, "leaseExpiresAt" = NULL
      WHERE "id" = ${lease.id} AND "leaseOwner" = ${lease.workerId} AND "fence" = ${lease.fence}
        AND "state" IN ('COMPILING', 'RUNNING') AND "leaseExpiresAt" > CURRENT_TIMESTAMP RETURNING *`
    const j = rows[0]
    if (!j) return false
    await tx.practiceJob.update({
      where: { id: j.id },
      data: {
        publicResult: {
          passed: result.passed,
          total: result.total,
          timeMs: result.timeMs,
          memoryKb: result.memoryKb,
        },
        privateResult: result.privateEvidence,
      },
    })
    const v = await tx.practiceVersion.findUniqueOrThrow({ where: { id: j.versionId } })
    if (j.scope === 'PRACTICE' && j.kind === 'SUBMIT') {
      const accepted = await tx.$queryRaw<{ id: string }[]>`
        SELECT latest."id" FROM (
          SELECT DISTINCT ON (COALESCE(s."originJobId", s."id")) s."id", s."verdict"
          FROM "PracticeJob" s JOIN "PracticeVersion" v ON v."id" = s."versionId"
          WHERE s."ownerId" = ${j.ownerId} AND v."problemId" = ${v.problemId} AND s."scope" = 'PRACTICE' AND s."kind" = 'SUBMIT' AND s."state" = 'TERMINAL'
          ORDER BY COALESCE(s."originJobId", s."id"), s."generation" DESC
        ) latest WHERE latest."verdict" = 'ACCEPTED' LIMIT 1`
      if (accepted[0])
        await tx.practiceSolve.upsert({
          where: { ownerId_problemId: { ownerId: j.ownerId, problemId: v.problemId } },
          create: { ownerId: j.ownerId, problemId: v.problemId, jobId: accepted[0].id },
          update: { jobId: accepted[0].id },
        })
      else
        await tx.practiceSolve.deleteMany({ where: { ownerId: j.ownerId, problemId: v.problemId } })
    } else if (j.scope === 'CONTEST') {
      await tx.contestSubmission.updateMany({
        where: { jobId: j.id },
        data: { state: 'TERMINAL', verdict: result.verdict },
      })
    }
    await tx.auditLog.create({
      data: {
        action: 'practice.complete',
        target: j.id,
        payload: { verdict: result.verdict, generation: j.generation, sourceHash: j.sourceHash },
      },
    })
    return true
  })
}

export async function failPracticeLease(
  db: PrismaClient,
  lease: { id: string; workerId: string; fence: number },
  cause: 'STORAGE_UNAVAILABLE' | 'SANDBOX_FAILURE' | 'HOST_FAILURE' | 'CHECKER_FAILURE'
) {
  return serial(db, async tx => {
    const rows = await tx.$queryRaw<
      PracticeJob[]
    >`SELECT * FROM "PracticeJob" WHERE "id" = ${lease.id}
      AND "leaseOwner" = ${lease.workerId} AND "fence" = ${lease.fence} AND "state" IN ('COMPILING', 'RUNNING')
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP FOR UPDATE`
    const j = rows[0]
    if (!j) return false
    const exhausted = j.attempt >= 3
    await tx.practiceJob.update({
      where: { id: j.id },
      data: {
        state: exhausted ? 'DEAD_LETTER' : 'QUEUED',
        verdict: exhausted ? 'JUDGE_FAILURE' : null,
        failureCode: cause,
        finishedAt: exhausted ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        fence: { increment: 1 },
        availableAt: new Date(Date.now() + 1000 * 2 ** j.attempt),
      },
    })
    if (!exhausted)
      await tx.practiceOutbox.update({
        where: { jobId: j.id },
        data: { deliveredAt: null, availableAt: new Date() },
      })
    if (exhausted && j.scope === 'CONTEST') {
      await tx.contestSubmission.updateMany({
        where: { jobId: j.id },
        data: { state: 'DEAD_LETTER', verdict: 'JUDGE_FAILURE' },
      })
    }
    await tx.auditLog.create({
      data: {
        action: exhausted ? 'practice.dead_letter' : 'practice.retry',
        target: j.id,
        payload: { cause, attempt: j.attempt },
      },
    })
    return true
  })
}

export async function rejudgePracticeJob(
  db: PrismaClient,
  input: {
    id: string
    actorId: string
    reason: string
    idempotencyKey: string
    policy?: Prisma.InputJsonObject
  }
) {
  if (input.reason.trim().length < 10 || input.reason.length > 1000)
    throw new Error('Rejudge reason required')
  return serial(db, async tx => {
    const old = await tx.practiceJob.findUniqueOrThrow({ where: { id: input.id } })
    if (
      !['RUN', 'SUBMIT', 'VALIDATE'].includes(old.kind) ||
      !['TERMINAL', 'DEAD_LETTER'].includes(old.state)
    )
      throw new Error('Only completed practice jobs can be rejudged')
    const root = old.originJobId ?? old.id
    const requestHash = digest(
      JSON.stringify(['rejudge', root, input.actorId, input.reason, input.policy ?? old.policy])
    )
    const existing = await tx.practiceJob.findUnique({
      where: {
        ownerId_idempotencyKey: { ownerId: old.ownerId, idempotencyKey: input.idempotencyKey },
      },
    })
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new Error('Idempotency key conflicts with another request')
      return existing
    }
    if (
      (await tx.practiceJob.count({
        where: { state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
      })) >= 1000 ||
      (await tx.practiceJob.count({
        where: { ownerId: old.ownerId, state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
      })) >= 3
    )
      throw new Error('Judge admission capacity exhausted')
    const previous = await tx.practiceJob.aggregate({
      where: { OR: [{ id: root }, { originJobId: root }] },
      _max: { generation: true },
    })
    const job = await tx.practiceJob.create({
      data: {
        ownerId: old.ownerId,
        versionId: old.versionId,
        kind: old.kind,
        language: old.language,
        source: old.source,
        sourceHash: old.sourceHash,
        input: old.input,
        policy: input.policy
          ? { ...input.policy, packageHash: (old.policy as Prisma.JsonObject).packageHash }
          : (old.policy as Prisma.InputJsonValue),
        requestHash,
        idempotencyKey: input.idempotencyKey,
        originJobId: root,
        generation: (previous._max.generation ?? 1) + 1,
        outbox: { create: {} },
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'practice.rejudge',
        target: job.id,
        payload: {
          originJobId: root,
          beforeJobId: old.id,
          beforeVerdict: old.verdict,
          generation: job.generation,
          reason: input.reason,
        },
      },
    })
    return job
  })
}

// Keep immutable submissions/reference evidence indefinitely. Only terminal
// sample/custom leaf runs older than 30 days are eligible; bounded batches and
// FK checks prevent deleting a rejudge root or anything used by the ledger.
export async function retainPracticeRuns(db: PrismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400000)
  return serial(db, async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT j."id" FROM "PracticeJob" j
      WHERE j."kind" = 'RUN' AND j."state" IN ('TERMINAL','CANCELLED','DEAD_LETTER')
        AND j."finishedAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "PracticeJob" child WHERE child."originJobId" = j."id")
        AND NOT EXISTS (SELECT 1 FROM "PracticeSolve" s WHERE s."jobId" = j."id")
      ORDER BY j."finishedAt" LIMIT 100 FOR UPDATE OF j SKIP LOCKED`
    if (!rows.length) return 0
    const ids = rows.map(row => row.id)
    await tx.practiceOutbox.deleteMany({ where: { jobId: { in: ids } } })
    await tx.practiceJob.deleteMany({ where: { id: { in: ids } } })
    await tx.auditLog.create({
      data: {
        action: 'practice.retention',
        payload: { ids, cutoff: cutoff.toISOString(), policy: 'terminal-run-leaves-30-days' },
      },
    })
    return rows.length
  })
}
