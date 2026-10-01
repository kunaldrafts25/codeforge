import { randomUUID } from 'node:crypto'
import {
  prisma,
  dispatchPracticeOutbox,
  leasePracticeJob,
  heartbeatPracticeJob,
  reconcilePracticeJobs,
  completePracticeJob,
  failPracticeLease,
  retainPracticeRuns,
} from '@codeforge/db'
import { PracticePackage } from '@codeforge/shared'
import { CheckerFailure } from '@codeforge/checker-lib'
import { verifyBoundary } from './doctor.js'
import { canonical, digest, judge } from './runner.js'
import { command, engineName } from './transport.js'
import { rendezvous } from './faults.js'

const workerId = `worker_${randomUUID().replaceAll('-', '')}`
let stopping = false
let active: string | null = null
async function cancel(id: string) {
  await command(['exec', engineName(), 'python3', '/opt/forge/executor.py', '--cancel', id]).catch(
    () => undefined
  )
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true
    if (active) void cancel(active)
  })
const verified = await verifyBoundary()
const policyHash = digest(canonical(verified.policy))
const policyIdentity = (value: unknown) => {
  const { packageHash: _packageHash, ...runtime } = value as Record<string, unknown>
  return digest(canonical(runtime))
}
async function advertise() {
  await command([
    'exec',
    '-e',
    `FORGE_TOOLCHAIN_IMAGE=${verified.policy.image}`,
    '-e',
    `FORGE_SUPERVISOR_HASH=${verified.policy.supervisorHash}`,
    engineName(),
    'python3',
    '/opt/forge/executor.py',
    '--health',
  ])
  const now = new Date()
  await prisma.practiceJudgeRuntime.upsert({
    where: { id: workerId },
    create: {
      id: workerId,
      policy: verified.policy,
      policyHash,
      evidenceHash: verified.evidenceHash,
      verifiedAt: now,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + 45000),
    },
    update: { heartbeatAt: now, expiresAt: new Date(now.getTime() + 45000) },
  })
}
await advertise()
let maintenanceAt = 0
console.log(
  JSON.stringify({
    event: 'judge.ready',
    workerId,
    policyHash,
    evidenceHash: verified.evidenceHash,
  })
)
try {
  while (!stopping) {
    if (Date.now() - maintenanceAt > 10000) {
      await advertise()
      await command(['exec', engineName(), 'python3', '/opt/forge/executor.py', '--gc'])
      await reconcilePracticeJobs(prisma)
      await retainPracticeRuns(prisma)
      await rendezvous('before_dispatch')
      await dispatchPracticeOutbox(prisma, async id => {
        await prisma.$executeRaw`SELECT pg_notify('codeforge_practice', ${id})`
      })
      await rendezvous('after_delivery')
      maintenanceAt = Date.now()
    }
    const job = await leasePracticeJob(prisma, workerId)
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 250))
      continue
    }
    const lease = { id: job.id, workerId, fence: job.fence }
    active = `${job.id}_${job.fence}`
    const executionId = active
    let heartbeatBusy = false
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return
      heartbeatBusy = true
      void (async () => {
        try {
          if (!(await heartbeatPracticeJob(prisma, job.id, workerId, job.fence)))
            await cancel(executionId)
          await advertise()
        } catch {
          await cancel(executionId)
        } finally {
          heartbeatBusy = false
        }
      })()
    }, 5000)
    try {
      await rendezvous('before_compile', job.id)
      const v = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: job.versionId } })
      if (
        digest(job.source) !== job.sourceHash ||
        digest(canonical(v.package)) !== v.packageHash ||
        policyIdentity(job.policy) !== policyHash ||
        (job.policy as Record<string, unknown>).packageHash !== v.packageHash
      )
        throw new Error('Execution integrity mismatch')
      const result = await judge(
        verified.policy,
        v.package,
        { ...job, id: executionId },
        async () => {
          const changed = await prisma.practiceJob.updateMany({
            where: {
              id: job.id,
              state: 'COMPILING',
              leaseOwner: workerId,
              fence: job.fence,
              leaseExpiresAt: { gt: new Date() },
            },
            data: { state: 'RUNNING' },
          })
          if (!changed.count) throw new Error('Execution lease lost')
          await rendezvous('after_compile', job.id)
        }
      )
      await rendezvous('before_commit', job.id)
      await completePracticeJob(prisma, lease, result)
      if (job.kind === 'VALIDATE') {
        const p = PracticePackage.parse(v.package)
        const refs = await prisma.practiceJob.findMany({
          where: { versionId: v.id, kind: 'VALIDATE', state: 'TERMINAL', verdict: 'ACCEPTED' },
        })
        const matching = p.references.map(r =>
          refs.find(
            j =>
              j.language === r.language &&
              j.sourceHash === digest(r.code) &&
              policyIdentity(j.policy) === policyHash &&
              (j.privateResult as Record<string, unknown> | null)?.executed === true
          )
        )
        if (matching.every(Boolean))
          await prisma.$transaction(async tx => {
            const changed = await tx.practiceVersion.updateMany({
              where: {
                id: v.id,
                status: { in: ['DRAFT', 'VALIDATED'] },
                packageHash: v.packageHash,
              },
              data: {
                status: 'VALIDATED',
                validation: {
                  executed: true,
                  packageHash: v.packageHash,
                  policyHash,
                  jobs: matching.map(j => j!.id),
                  evidenceHash: verified.evidenceHash,
                  validatedAt: new Date().toISOString(),
                },
              },
            })
            if (changed.count)
              await tx.auditLog.create({
                data: {
                  action: 'practice.validate',
                  target: v.id,
                  payload: { packageHash: v.packageHash, policyHash },
                },
              })
          })
      }
      console.log(
        JSON.stringify({
          event: 'judge.complete',
          id: job.id,
          verdict: result.verdict,
          attempt: job.attempt,
        })
      )
    } catch (error) {
      await cancel(executionId)
      try {
        await advertise()
      } catch {
        stopping = true
        await prisma.practiceJudgeRuntime.deleteMany({ where: { id: workerId } })
      }
      const cause =
        error instanceof CheckerFailure
          ? 'CHECKER_FAILURE'
          : error instanceof Error && error.message === 'Execution integrity mismatch'
            ? 'STORAGE_UNAVAILABLE'
            : 'SANDBOX_FAILURE'
      await failPracticeLease(prisma, lease, cause)
      console.log(JSON.stringify({ event: 'judge.infrastructure_failure', id: job.id, cause }))
    } finally {
      clearInterval(heartbeat)
      active = null
    }
  }
} finally {
  await prisma.practiceJudgeRuntime.deleteMany({ where: { id: workerId } }).catch(() => undefined)
  await prisma.$disconnect()
}
