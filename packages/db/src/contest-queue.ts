import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { practiceTransaction } from './practice-queue.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const languages = ['cpp', 'python', 'java', 'javascript']

export async function enqueueContestSubmission(
  db: PrismaClient,
  input: {
    contestId: string
    userId: string
    manifestId: string
    problemId: string
    versionId: string
    problemLabel: string
    language: string
    source: string
    idempotencyKey: string
    policy: Prisma.InputJsonObject
    admittedAt: Date
  }
) {
  if (
    !languages.includes(input.language) ||
    Buffer.byteLength(input.source) < 1 ||
    Buffer.byteLength(input.source) > 65536
  ) {
    throw new Error('Invalid submission limits/language')
  }

  const sourceHash = digest(input.source)
  const requestHash = digest(
    JSON.stringify([
      input.contestId,
      input.problemId,
      input.versionId,
      input.language,
      input.source,
      input.policy,
    ])
  )

  return practiceTransaction(db, async tx => {
    // Check existing submission by idempotency key
    const existing = await tx.contestSubmission.findUnique({
      where: {
        contestId_userId_idempotencyKey: {
          contestId: input.contestId,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { job: true },
    })

    if (existing) {
      if (
        existing.sourceHash !== sourceHash ||
        existing.problemLabel !== input.problemLabel ||
        existing.language !== input.language
      ) {
        throw new Error('Idempotency key conflicts with another request')
      }
      return { submission: existing, job: existing.job }
    }

    const v = await tx.practiceVersion.findUnique({
      where: { id: input.versionId },
    })
    if (!v) {
      throw new Error('Problem version not found')
    }

    // Capacity checks for contest jobs
    const active = { state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } }
    const userActiveCount = await tx.practiceJob.count({
      where: { ...active, ownerId: input.userId, scope: 'CONTEST' },
    })
    if (userActiveCount >= 3) {
      throw new Error('User contest job quota reached')
    }
    const globalActiveCount = await tx.practiceJob.count({ where: active })
    if (globalActiveCount >= 1000) {
      throw new Error('Judge admission capacity exhausted')
    }

    // Create PracticeJob with scope = 'CONTEST'
    const job = await tx.practiceJob.create({
      data: {
        ownerId: input.userId,
        versionId: v.id,
        kind: 'SUBMIT',
        language: input.language,
        source: input.source,
        sourceHash,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        policy: { ...input.policy, packageHash: v.packageHash },
        scope: 'CONTEST',
        contestId: input.contestId,
        admittedAt: input.admittedAt,
        outbox: { create: {} },
      },
    })

    // Create ContestSubmission
    const submission = await tx.contestSubmission.create({
      data: {
        contestId: input.contestId,
        userId: input.userId,
        manifestId: input.manifestId,
        problemId: input.problemId,
        versionId: v.id,
        problemLabel: input.problemLabel,
        language: input.language,
        source: input.source,
        sourceHash,
        idempotencyKey: input.idempotencyKey,
        admittedAt: input.admittedAt,
        jobId: job.id,
        state: 'QUEUED',
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        action: 'contest.submit',
        target: submission.id,
        payload: {
          contestId: input.contestId,
          problemLabel: input.problemLabel,
          jobId: job.id,
          admittedAt: input.admittedAt.toISOString(),
        },
      },
    })

    return { submission, job }
  })
}

export async function rejudgeContestSubmission(
  db: PrismaClient,
  input: {
    submissionId: string
    actorId: string
    reason: string
    idempotencyKey: string
    policy?: Prisma.InputJsonObject
  }
) {
  if (input.reason.trim().length < 10 || input.reason.length > 1000) {
    throw new Error('Rejudge reason required')
  }

  return practiceTransaction(db, async tx => {
    const oldSub = await tx.contestSubmission.findUniqueOrThrow({
      where: { id: input.submissionId },
      include: { job: true },
    })

    const oldJob = oldSub.job
    if (!['TERMINAL', 'DEAD_LETTER'].includes(oldJob.state)) {
      throw new Error('Only completed submissions can be rejudged')
    }

    const nextGen = oldSub.generation + 1
    const requestHash = digest(
      JSON.stringify(['contest-rejudge', oldSub.id, nextGen, input.actorId, input.reason])
    )

    // Mark previous submission as non-authoritative
    await tx.contestSubmission.update({
      where: { id: oldSub.id },
      data: { isAuthoritative: false },
    })

    // Create new PracticeJob for rejudge
    const newJob = await tx.practiceJob.create({
      data: {
        ownerId: oldJob.ownerId,
        versionId: oldJob.versionId,
        kind: 'SUBMIT',
        language: oldJob.language,
        source: oldJob.source,
        sourceHash: oldJob.sourceHash,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        policy: (input.policy ?? oldJob.policy) as Prisma.InputJsonValue,
        state: 'QUEUED',
        generation: nextGen,
        originJobId: oldJob.originJobId ?? oldJob.id,
        scope: 'CONTEST',
        contestId: oldSub.contestId,
        admittedAt: oldSub.admittedAt, // Retain original server admission timestamp!
        outbox: { create: {} },
      },
    })

    // Create new authoritative ContestSubmission row for this generation
    const newSub = await tx.contestSubmission.create({
      data: {
        contestId: oldSub.contestId,
        userId: oldSub.userId,
        manifestId: oldSub.manifestId,
        problemId: oldSub.problemId,
        versionId: oldSub.versionId,
        problemLabel: oldSub.problemLabel,
        language: oldSub.language,
        source: oldSub.source,
        sourceHash: oldSub.sourceHash,
        idempotencyKey: input.idempotencyKey,
        admittedAt: oldSub.admittedAt, // Original admission timestamp!
        jobId: newJob.id,
        state: 'QUEUED',
        generation: nextGen,
        isAuthoritative: true,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'contest.rejudge',
        target: newSub.id,
        payload: {
          previousSubmissionId: oldSub.id,
          generation: nextGen,
          reason: input.reason,
        },
      },
    })

    return { submission: newSub, job: newJob }
  })
}
