import { randomUUID } from 'node:crypto'
import { prisma, practiceTransaction, rejudgeContestSubmissionTx, type Prisma } from '@codeforge/db'
import { z } from 'zod'
import { canonical, hash, executionAvailability } from '../practice/package.js'
import { badRequest, conflict, notFound, HttpError } from '../errors.js'
import { finalizeContest, replayChronologicalContests } from './settlement.js'

const LOCK = 948271038571029n & 0x1fffffffffffffn
const Request = z
  .object({
    contestId: z.string().uuid(),
    actorId: z.string().uuid(),
    type: z.enum(['FINALIZE', 'REPLAY', 'CORRECTION']),
    reason: z.string().min(10).max(1000).optional(),
    submissionId: z.string().uuid().optional(),
    disqualifyUserId: z.string().uuid().optional(),
  })
  .superRefine((request, context) => {
    const targets =
      Number(Boolean(request.submissionId)) + Number(Boolean(request.disqualifyUserId))
    if (
      (request.type === 'CORRECTION' && targets !== 1) ||
      (request.type !== 'CORRECTION' && targets !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A correction requires exactly one target; finalize and replay have none',
      })
    }
  })
type OperationRequest = z.infer<typeof Request>

export async function queueSettlementOperation(operationId: string, input: OperationRequest) {
  const parsed = Request.safeParse(input)
  if (!parsed.success)
    throw badRequest(
      'INVALID_OPERATION',
      'Choose one valid correction target or an untargeted finalize/replay operation'
    )
  const request = parsed.data
  if (request.type !== 'FINALIZE' && !request.reason) {
    throw conflict('REASON_REQUIRED', 'A correction or replay reason is required')
  }
  if (request.type === 'CORRECTION' && !request.submissionId && !request.disqualifyUserId) {
    throw conflict('CORRECTION_TARGET_REQUIRED', 'Choose a submission or participant to correct')
  }
  const requestHash = hash(canonical(request))
  return practiceTransaction(prisma, async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
    const existing = await tx.contestSettlementJob.findUnique({ where: { operationId } })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw conflict('IDEMPOTENCY_CONFLICT', 'Operation key belongs to a different request')
      }
      return publicOperation(existing)
    }
    const contest = await tx.contest.findUnique({ where: { id: request.contestId } })
    if (!contest) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
    const preFinalizationRejudge =
      request.type === 'CORRECTION' &&
      request.submissionId &&
      !['DRAFT', 'CANCELLED', 'FINALIZED'].includes(contest.status)
    if (request.type !== 'FINALIZE' && contest.status !== 'FINALIZED' && !preFinalizationRejudge) {
      throw conflict(
        'CONTEST_NOT_FINALIZED',
        'Replay requires a finalized contest; an admitted submission can be recovered before finalization'
      )
    }
    if (
      request.type === 'FINALIZE' &&
      (['DRAFT', 'CANCELLED'].includes(contest.status) || contest.endTime > new Date())
    ) {
      throw conflict('CONTEST_NOT_ENDED', 'Only an ended contest can be finalized')
    }
    if (request.submissionId) {
      const sub = await tx.contestSubmission.findUnique({ where: { id: request.submissionId } })
      if (!sub || sub.contestId !== contest.id)
        throw conflict('WRONG_CONTEST', 'Submission does not belong to this contest')
    }
    if (request.disqualifyUserId) {
      const participant = await tx.contestParticipant.findUnique({
        where: { contestId_userId: { contestId: contest.id, userId: request.disqualifyUserId } },
      })
      if (!participant) throw notFound('PARTICIPANT_NOT_FOUND', 'Participant not found')
    }
    const job = await tx.contestSettlementJob.create({
      data: {
        contestId: contest.id,
        operationId,
        type: request.type,
        actorId: request.actorId,
        request: request as Prisma.InputJsonObject,
        requestHash,
        state: 'QUEUED',
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: request.actorId,
        action: 'contest.operation.queued',
        target: contest.id,
        payload: { operationId, settlementJobId: job.id, type: request.type },
      },
    })
    return publicOperation(job)
  })
}

export function publicOperation(job: {
  id: string
  operationId: string
  state: string
  attempts: number
  errorReason: string | null
  payload: unknown
  createdAt: Date
  finishedAt: Date | null
}) {
  return {
    ok: true,
    settlementJobId: job.id,
    operationId: job.operationId,
    state: job.state,
    attempts: job.attempts,
    errorReason: job.errorReason,
    result: job.payload,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}

export async function retrySettlementOperation(
  contestId: string,
  operationId: string,
  actorId: string,
  reason: string
) {
  return practiceTransaction(prisma, async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
    const job = await tx.contestSettlementJob.findUnique({ where: { operationId } })
    if (!job || job.contestId !== contestId)
      throw notFound('OPERATION_NOT_FOUND', 'Operation not found')
    if (job.state !== 'DEAD_LETTER' || !job.request || !job.requestHash) {
      throw conflict(
        'OPERATION_NOT_RETRYABLE',
        'Only a recoverable dead-letter operation can be retried'
      )
    }
    const checkpoint = job.request as Prisma.JsonObject
    const failedJobId = typeof checkpoint.rejudgeJobId === 'string' ? checkpoint.rejudgeJobId : null
    let nextRequest = checkpoint
    if (failedJobId) {
      const failed = await tx.practiceJob.findUnique({ where: { id: failedJobId } })
      if (
        failed &&
        (['DEAD_LETTER', 'CANCELLED'].includes(failed.state) ||
          (failed.state === 'TERMINAL' && (!failed.verdict || failed.verdict === 'JUDGE_FAILURE')))
      ) {
        const { rejudgeJobId: _checkpoint, ...original } = checkpoint
        nextRequest = original
      }
    }
    const retried = await tx.contestSettlementJob.update({
      where: { id: job.id },
      data: {
        state: 'QUEUED',
        attempts: 0,
        fence: { increment: 1 },
        workerId: null,
        availableAt: new Date(),
        leaseUntil: null,
        errorReason: null,
        request: nextRequest as Prisma.InputJsonObject,
      },
    })
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'contest.operation.retry',
        target: job.id,
        payload: { reason, previousRejudgeJobId: failedJobId },
      },
    })
    return publicOperation(retried)
  })
}

async function assertEarlierCorrectionFinished(
  tx: Prisma.TransactionClient,
  job: { id: string; createdAt: Date },
  contest: { id: string; endTime: Date; isRated: boolean }
) {
  const earlier = await tx.contestSettlementJob.findFirst({
    where: {
      id: { not: job.id },
      type: { in: ['CORRECTION', 'REPLAY', 'REJUDGE_REPLAY', 'DISQUALIFY_REPLAY'] },
      requestHash: { not: null },
      state: { in: ['QUEUED', 'RUNNING', 'DEAD_LETTER'] },
      OR: [
        ...(contest.isRated
          ? [
              { contest: { isRated: true, endTime: { lt: contest.endTime } } },
              { contest: { isRated: true, endTime: contest.endTime, id: { lt: contest.id } } },
            ]
          : []),
        { contestId: contest.id, createdAt: { lt: job.createdAt } },
        { contestId: contest.id, createdAt: job.createdAt, id: { lt: job.id } },
      ],
    },
  })
  if (earlier) throw conflict('SETTLEMENT_NOT_READY', 'An earlier correction must complete first')
}

// Claim and publication both serialize on the same lock. Publication is a
// bounded transaction shorter than its lease; a stale claimant must pass the
// fence check inside that transaction before it can change any projection.
export async function processSettlementJobsOnce(workerId = randomUUID()) {
  const job = await practiceTransaction(prisma, async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
    const now = new Date()
    const candidate = await tx.contestSettlementJob.findFirst({
      where: {
        OR: [
          { state: 'QUEUED', availableAt: { lte: now } },
          { state: 'RUNNING', leaseUntil: { lte: now } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (!candidate) return null
    if (candidate.attempts >= 8 || !candidate.request) {
      await tx.contestSettlementJob.update({
        where: { id: candidate.id },
        data: {
          state: 'DEAD_LETTER',
          leaseUntil: null,
          errorReason: 'Retry limit reached or legacy request is missing',
        },
      })
      return null
    }
    return tx.contestSettlementJob.update({
      where: { id: candidate.id },
      data: {
        state: 'RUNNING',
        workerId,
        fence: { increment: 1 },
        attempts: { increment: 1 },
        startedAt: now,
        leaseUntil: new Date(now.getTime() + 90000),
        errorReason: null,
      },
    })
  })
  if (!job) return false
  const checkFence = async (tx: Prisma.TransactionClient) => {
    const current = await tx.contestSettlementJob.findUniqueOrThrow({ where: { id: job.id } })
    if (
      current.state !== 'RUNNING' ||
      current.fence !== job.fence ||
      current.workerId !== workerId ||
      !current.leaseUntil ||
      current.leaseUntil <= new Date()
    ) {
      throw conflict('STALE_SETTLEMENT_CLAIM', 'Settlement claim expired')
    }
    return current
  }
  try {
    const request = Request.parse(job.request)
    // Rejudge creation and its durable operation checkpoint commit together.
    // A crash afterwards resumes the same replacement instead of creating one.
    if (request.submissionId && !(job.request as Record<string, unknown>).rejudgeJobId) {
      const runtime = await executionAvailability()
      if (!runtime.enabled || !runtime.policy)
        throw conflict('SETTLEMENT_NOT_READY', 'Verified judge runtime is unavailable')
      await practiceTransaction(
        prisma,
        async tx => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
          await checkFence(tx)
          const contest = await tx.contest.findUniqueOrThrow({ where: { id: request.contestId } })
          await assertEarlierCorrectionFinished(tx, job, contest)
          const replacement = await rejudgeContestSubmissionTx(tx, {
            submissionId: request.submissionId!,
            contestId: request.contestId,
            actorId: request.actorId,
            reason: request.reason!,
            idempotencyKey: `${job.operationId}:rejudge:${job.fence}`,
            policy: runtime.policy as Prisma.InputJsonObject,
          })
          await tx.contestSettlementJob.update({
            where: { id: job.id },
            data: {
              request: { ...request, rejudgeJobId: replacement.job.id },
              leaseUntil: new Date(Date.now() + 90000),
            },
          })
        },
        { timeout: 60000 }
      )
    }
    await practiceTransaction(
      prisma,
      async tx => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
        const checkpoint = await checkFence(tx)
        const contest = await tx.contest.findUniqueOrThrow({ where: { id: request.contestId } })
        // A later finalization/replay must not publish ratings against a prefix
        // whose correction is already pending. Older corrections run first;
        // the createdAt/id ordering avoids deadlocking same-contest operations.
        await assertEarlierCorrectionFinished(tx, job, contest)
        const checkpointRequest = checkpoint.request as Prisma.JsonObject
        if (typeof checkpointRequest.rejudgeJobId === 'string') {
          const judged = await tx.practiceJob.findUniqueOrThrow({
            where: { id: checkpointRequest.rejudgeJobId },
          })
          if (
            ['DEAD_LETTER', 'CANCELLED'].includes(judged.state) ||
            (judged.state === 'TERMINAL' && (!judged.verdict || judged.verdict === 'JUDGE_FAILURE'))
          ) {
            throw conflict(
              'REJUDGE_FAILED',
              'Replacement judging failed; retry this operation after resolving the judge incident'
            )
          }
          if (judged.state !== 'TERMINAL') {
            throw conflict('SETTLEMENT_NOT_READY', 'Replacement judging has not finished')
          }
        }
        // Do not disqualify publicly until the replay is ready to publish in the
        // same transaction. Errors roll back both eligibility and all results.
        if (request.disqualifyUserId) {
          await tx.contestParticipant.update({
            where: {
              contestId_userId: {
                contestId: request.contestId,
                userId: request.disqualifyUserId,
              },
            },
            data: {
              status: 'DISQUALIFIED',
              disqualifiedAt: new Date(),
              disqualificationReason: request.reason!,
            },
          })
        }
        const result =
          request.type === 'FINALIZE'
            ? await finalizeContest(request.contestId, request.actorId, undefined, tx)
            : contest.status !== 'FINALIZED' && request.submissionId
              ? {
                  contestId: contest.id,
                  status: contest.status,
                  rejudgeJobId: checkpointRequest.rejudgeJobId,
                  ratingsCount: 0,
                }
              : await replayChronologicalContests(
                  request.contestId,
                  request.actorId,
                  request.reason!,
                  undefined,
                  tx
                )
        await tx.contestSettlementJob.update({
          where: { id: job.id },
          data: {
            state: 'COMPLETED',
            payload: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
            finishedAt: new Date(),
            leaseUntil: null,
            errorReason: null,
          },
        })
      },
      { timeout: 60000 }
    )
  } catch (error) {
    const failedReplacement = error instanceof HttpError && error.code === 'REJUDGE_FAILED'
    const pendingLineage =
      error instanceof Error && error.message.includes('correction is still pending')
    const waiting =
      pendingLineage ||
      (error instanceof HttpError &&
        [
          'SETTLEMENT_NOT_READY',
          'PENDING_SUBMISSIONS',
          'UNRESOLVED_FAILURES',
          'OPEN_DISPUTES',
          'EARLIER_CONTEST_UNSETTLED',
        ].includes(error.code))
    // A stale process cannot acknowledge/requeue a newer worker's claim.
    await prisma.contestSettlementJob.updateMany({
      where: {
        id: job.id,
        state: 'RUNNING',
        workerId,
        fence: job.fence,
      },
      data: {
        state: failedReplacement
          ? 'DEAD_LETTER'
          : waiting || job.attempts < 8
            ? 'QUEUED'
            : 'DEAD_LETTER',
        leaseUntil: null,
        ...(waiting ? { attempts: { decrement: 1 } } : {}),
        availableAt: new Date(
          Date.now() + (waiting ? 2000 : Math.min(60000, 1000 * 2 ** job.attempts))
        ),
        errorReason:
          error instanceof HttpError
            ? `${error.code}: ${error.message}`
            : 'Settlement failed; inspect server logs and retry operation',
      },
    })
    if (!waiting && !(error instanceof HttpError)) throw error
  }
  return true
}

export function startSettlementWorker(onError: (error: unknown) => void) {
  const workerId = randomUUID()
  let active: Promise<unknown> | undefined
  const timer = setInterval(() => {
    if (!active)
      active = processSettlementJobsOnce(workerId)
        .catch(onError)
        .finally(() => {
          active = undefined
        })
  }, 1000)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await active
  }
}
