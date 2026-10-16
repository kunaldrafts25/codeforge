import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { practiceTransaction } from './practice-queue.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const languages = ['cpp', 'python', 'java', 'javascript']
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function enqueueContestSubmission(
  db: PrismaClient,
  input: {
    contestId: string
    userId: string
    manifestId?: string
    problemId?: string
    versionId?: string
    problemLabel: string
    language: string
    source: string
    idempotencyKey: string
    policy: Prisma.InputJsonObject
    admittedAt?: Date
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
      input.problemLabel,
      input.language,
      input.source,
      input.policy,
    ])
  )

  return practiceTransaction(db, async tx => {
    // ── P3-R6: check for existing submission with matching idempotency key FIRST ──
    // A matching retry returns original IDs without checking window/eligibility, even after contest end.
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

    // ── P3-R1: new-submission admission checks inside the authoritative transaction ──
    // Timestamp each transaction attempt after admission begins. A caller-supplied
    // timestamp must never let a delayed/retried request bypass the deadline.
    let admittedAt = new Date()

    const contest = await tx.contest.findUnique({
      where: { id: input.contestId },
      include: { activeManifest: true },
    })
    if (!contest || !contest.isPublic) {
      throw new Error('Contest not found')
    }
    if (['DRAFT', 'CANCELLED'].includes(contest.status)) {
      throw new Error('Contest is not active for submissions')
    }
    if (admittedAt < contest.startTime) {
      throw new Error('Contest has not started yet')
    }
    if (admittedAt >= contest.endTime) {
      throw new Error('Contest has ended; new submissions are closed')
    }

    // Check participant registration & ban status
    const participant = await tx.contestParticipant.findUnique({
      where: { contestId_userId: { contestId: contest.id, userId: input.userId } },
      include: { user: { select: { isBanned: true } } },
    })
    if (!participant || participant.status !== 'REGISTERED') {
      if (participant?.status === 'DISQUALIFIED') {
        throw new Error('You are disqualified from this contest')
      }
      throw new Error('You must be registered to submit to this contest')
    }
    if (participant.user.isBanned) {
      throw new Error('Banned accounts cannot submit code')
    }

    // Check active manifest
    if (!contest.activeManifest || contest.activeManifest.status !== 'SEALED') {
      throw new Error('Contest manifest is not sealed')
    }
    if (contest.activeManifest.runtimePolicyHash !== digest(canonical(input.policy))) {
      throw new Error('Contest manifest runtime policy is no longer available')
    }
    const manifestProblems = contest.activeManifest.problems as Array<{
      label: string
      orderIndex: number
      problemId: string
      versionId: string
      packageHash: string
      title: string
    }>
    const assigned = manifestProblems.find(p => p.label === input.problemLabel)
    if (!assigned) {
      throw new Error(`Problem ${input.problemLabel} is not in this contest`)
    }

    const version = await tx.practiceVersion.findUnique({
      where: { id: assigned.versionId },
    })
    if (!version) {
      throw new Error('Assigned problem version not found')
    }
    if (version.packageHash !== assigned.packageHash) {
      throw new Error('Package hash mismatch: assigned version package has changed')
    }
    if (version.problemId !== assigned.problemId) {
      throw new Error('Assigned problem does not match its version')
    }
    if (!(version.package as { languages?: string[] }).languages?.includes(input.language)) {
      throw new Error('Language is not supported for this problem')
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

    // Database reads may have waited behind other transactions. Recheck the
    // clock immediately before persisting a new admission.
    admittedAt = new Date()
    if (admittedAt >= contest.endTime) {
      throw new Error('Contest has ended; new submissions are closed')
    }

    // Create PracticeJob with scope = 'CONTEST' and bound packageHash
    const job = await tx.practiceJob.create({
      data: {
        ownerId: input.userId,
        versionId: version.id,
        kind: 'SUBMIT',
        language: input.language,
        source: input.source,
        sourceHash,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        policy: { ...input.policy, packageHash: version.packageHash },
        scope: 'CONTEST',
        contestId: contest.id,
        admittedAt,
        outbox: { create: {} },
      },
    })

    // Create authoritative ContestSubmission
    const submission = await tx.contestSubmission.create({
      data: {
        contestId: contest.id,
        userId: input.userId,
        manifestId: contest.activeManifest.id,
        problemId: assigned.problemId,
        versionId: version.id,
        problemLabel: input.problemLabel,
        language: input.language,
        source: input.source,
        sourceHash,
        idempotencyKey: input.idempotencyKey,
        admittedAt,
        jobId: job.id,
        state: 'QUEUED',
        generation: 1,
        isAuthoritative: true,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        action: 'contest.submit',
        target: submission.id,
        payload: {
          contestId: contest.id,
          problemLabel: input.problemLabel,
          jobId: job.id,
          admittedAt: admittedAt.toISOString(),
        },
      },
    })

    return { submission, job }
  })
}

export type ContestRejudgeInput = {
  submissionId: string
  contestId?: string
  actorId: string
  reason: string
  idempotencyKey: string
  policy?: Prisma.InputJsonObject
}

export async function rejudgeContestSubmissionTx(
  tx: Prisma.TransactionClient,
  input: ContestRejudgeInput
) {
  if (input.reason.trim().length < 10 || input.reason.length > 1000) {
    throw new Error('Rejudge reason required')
  }

  const oldSub = await tx.contestSubmission.findUniqueOrThrow({
    where: { id: input.submissionId },
    include: { job: true },
  })

  // ── P3-R5 fix: validate submission belongs to the requested contest. ──
  if (input.contestId && oldSub.contestId !== input.contestId) {
    throw new Error('Submission does not belong to the requested contest')
  }

  // Each original attempt has its own job root. Other attempts on the same
  // problem remain authoritative and continue contributing wrong penalties.
  const rootJobId = oldSub.job.originJobId ?? oldSub.jobId
  const allSubs = await tx.contestSubmission.findMany({
    where: {
      contestId: oldSub.contestId,
      userId: oldSub.userId,
      problemId: oldSub.problemId,
      job: { OR: [{ id: rootJobId }, { originJobId: rootJobId }] },
    },
    orderBy: { generation: 'desc' },
    include: { job: true },
  })

  // ── P3-R5 fix: idempotent rejudge — if same idempotencyKey was already issued, return it. ──
  const existingRejudge = await tx.contestSubmission.findUnique({
    where: {
      contestId_userId_idempotencyKey: {
        contestId: oldSub.contestId,
        userId: oldSub.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { job: true },
  })
  if (existingRejudge) {
    const expectedHash = digest(
      JSON.stringify([
        'contest-rejudge',
        oldSub.id,
        existingRejudge.generation,
        input.actorId,
        input.reason,
      ])
    )
    if (
      !allSubs.some(s => s.id === existingRejudge.id) ||
      existingRejudge.generation === 1 ||
      existingRejudge.job.requestHash !== expectedHash
    ) {
      throw new Error('Idempotency key conflicts with another request')
    }
    return { submission: existingRejudge, job: existingRejudge.job }
  }

  const latestSub = allSubs[0]!
  if (['QUEUED', 'COMPILING', 'RUNNING'].includes(latestSub.job.state)) {
    throw new Error('An existing submission or correction is still pending')
  }
  const nextGen = latestSub.generation + 1
  const requestHash = digest(
    JSON.stringify(['contest-rejudge', oldSub.id, nextGen, input.actorId, input.reason])
  )

  // ── P3-R5 fix: always bind the version's packageHash so the worker integrity check passes. ──
  const version = await tx.practiceVersion.findUniqueOrThrow({
    where: { id: oldSub.versionId },
    select: { packageHash: true },
  })
  const basePolicy = input.policy ?? (oldSub.job?.policy as Record<string, unknown>) ?? {}
  const boundPolicy = { ...basePolicy, packageHash: version.packageHash }

  // Mark ALL previous submissions in this lineage as non-authoritative
  await tx.contestSubmission.updateMany({
    where: {
      id: { in: allSubs.map(s => s.id) },
      isAuthoritative: true,
    },
    data: { isAuthoritative: false },
  })

  // Create new PracticeJob for rejudge
  const newJob = await tx.practiceJob.create({
    data: {
      ownerId: oldSub.userId,
      versionId: oldSub.versionId,
      kind: 'SUBMIT',
      language: oldSub.language,
      source: oldSub.source,
      sourceHash: oldSub.sourceHash,
      requestHash,
      idempotencyKey: input.idempotencyKey,
      policy: boundPolicy as unknown as Prisma.InputJsonValue,
      state: 'QUEUED',
      generation: nextGen,
      originJobId: oldSub.job?.originJobId ?? oldSub.jobId,
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
}

export async function rejudgeContestSubmission(db: PrismaClient, input: ContestRejudgeInput) {
  return practiceTransaction(db, tx => rejudgeContestSubmissionTx(tx, input))
}
