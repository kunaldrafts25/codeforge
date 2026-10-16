/* eslint-disable no-console -- Bounded synthetic database verification metadata only. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { prisma, type Prisma, type Contest, type ContestManifest } from '@codeforge/db'
import {
  queueSettlementOperation,
  processSettlementJobsOnce,
  retrySettlementOperation,
} from '../src/contests/operations.js'
import { canonical, hash } from '../src/practice/package.js'
import { leaderboardRoutes } from '../src/routes/leaderboard.js'
import { handleError } from '../src/errors.js'

// This verifier intentionally writes SYNTHETIC terminal evidence into a fresh
// disposable PostgreSQL database. It proves transactional workflows, not judge
// execution, package validation, isolation, language support, or browser behavior.
export async function verifyPhase3Operations() {
  assert.equal(
    process.env.PHASE3_DISPOSABLE_DATABASE,
    '1',
    'Run only in the fresh disposable harness'
  )
  const prefix = randomUUID().slice(0, 8)
  const minute = 60_000
  const now = Date.now()
  const users = await Promise.all(
    ['admin', 'reviewer', 'a', 'b', 'c', 'd'].map((role, i) =>
      prisma.user.create({
        data: {
          email: `operations-${prefix}-${role}@example.test`,
          username: `ops_${prefix}_${role}`,
          role: i === 0 ? 'ADMIN' : i === 1 ? 'REVIEWER' : 'USER',
          emailVerifiedAt: new Date(),
        },
      })
    )
  )
  const [admin, reviewer, a, b, c, d] = users as [
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
  ]
  const policy = { fixtureOnly: true, executedCandidateCode: false }
  process.env.FORGE_PRACTICE_ENABLED = '1'
  await prisma.practiceJudgeRuntime.create({
    data: {
      id: randomUUID(),
      policy,
      policyHash: hash(canonical(policy)),
      evidenceHash: hash('synthetic-data-verification-only'),
      verifiedAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 110_000),
    },
  })
  const problem = await prisma.problem.create({
    data: {
      slug: `ops-${prefix}`,
      title: 'Synthetic operations fixture',
      statementMd: 'Data verifier only',
      inputFormat: 'integer',
      outputFormat: 'integer',
      constraints: 'Data verifier only',
      difficultyBand: 'easy',
      authorId: admin.id,
    },
  })
  const pkg = { fixtureOnly: true, executedCandidateCode: false, languages: ['python'] }
  const version = await prisma.practiceVersion.create({
    data: {
      problemId: problem.id,
      number: 1,
      authorId: admin.id,
      package: pkg,
      packageHash: hash(canonical(pkg)),
    },
  })
  async function makeContest(
    index: number,
    startOffset: number,
    endOffset: number,
    participantIds: string[]
  ) {
    const contest = await prisma.contest.create({
      data: {
        slug: `ops-${prefix}-${index}`,
        title: `Synthetic operations ${index}`,
        format: 'ICPC',
        startTime: new Date(now - startOffset * minute),
        endTime: new Date(now - endOffset * minute),
        isRated: true,
        status: 'ENDED',
        isPublic: true,
      },
    })
    const manifest = await prisma.contestManifest.create({
      data: {
        contestId: contest.id,
        revision: 1,
        title: contest.title,
        slug: contest.slug,
        startTime: contest.startTime,
        endTime: contest.endTime,
        registrationOpensAt: new Date(contest.startTime.getTime() - 10 * minute),
        registrationClosesAt: contest.startTime,
        manifestHash: hash(`fixture-manifest-${contest.id}`),
        runtimePolicyHash: hash(canonical(policy)),
        authorId: admin.id,
        reviewerId: reviewer.id,
        approvedAt: new Date(),
        status: 'SEALED',
        problems: [
          {
            label: 'A',
            orderIndex: 0,
            problemId: problem.id,
            versionId: version.id,
            packageHash: version.packageHash,
            title: problem.title,
            points: 1,
          },
        ],
      },
    })
    await prisma.contest.update({
      where: { id: contest.id },
      data: { activeManifestId: manifest.id },
    })
    await prisma.contestParticipant.createMany({
      data: participantIds.map(userId => ({ contestId: contest.id, userId })),
    })
    return { contest, manifest }
  }
  async function attempt(
    fixture: { contest: Contest; manifest: ContestManifest },
    userId: string,
    atMinute: number,
    verdict: string
  ) {
    const source = '# Synthetic database evidence; never executed\n'
    const sourceHash = hash(source)
    const admittedAt = new Date(fixture.contest.startTime.getTime() + atMinute * minute)
    const key = randomUUID()
    const job = await prisma.practiceJob.create({
      data: {
        ownerId: userId,
        versionId: version.id,
        kind: 'SUBMIT',
        scope: 'CONTEST',
        contestId: fixture.contest.id,
        language: 'python',
        source,
        sourceHash,
        requestHash: hash(key),
        idempotencyKey: key,
        policy: { ...policy, packageHash: version.packageHash },
        admittedAt,
      },
    })
    const submission = await prisma.contestSubmission.create({
      data: {
        contestId: fixture.contest.id,
        userId,
        manifestId: fixture.manifest.id,
        problemId: problem.id,
        versionId: version.id,
        problemLabel: 'A',
        language: 'python',
        source,
        sourceHash,
        idempotencyKey: key,
        admittedAt,
        jobId: job.id,
      },
    })
    await finish(job.id, submission.id, verdict)
    return submission
  }
  async function finish(jobId: string, submissionId: string, verdict: string) {
    await prisma.practiceJob.update({
      where: { id: jobId },
      data: {
        state: 'TERMINAL',
        verdict,
        finishedAt: new Date(),
        privateResult: { fixtureOnly: true, executedCandidateCode: false },
      },
    })
    await prisma.contestSubmission.update({
      where: { id: submissionId },
      data: { state: 'TERMINAL', verdict },
    })
  }
  async function projections() {
    return prisma.user.findMany({
      where: { id: { in: [a.id, b.id, c.id, d.id] } },
      orderBy: { id: 'asc' },
      select: { id: true, rating: true, maxRating: true, contestsCount: true, lastContestAt: true },
    })
  }
  async function snapshot(contestId: string) {
    return prisma.contestScoreboardSnapshot.findFirstOrThrow({
      where: { contestId, isFrozen: false },
      orderBy: { revision: 'desc' },
    })
  }
  async function job(operationId: string) {
    return prisma.contestSettlementJob.findUniqueOrThrow({ where: { operationId } })
  }
  async function run(operationId: string) {
    // Explicitly select a fixture operation without changing chronological order.
    await prisma.contestSettlementJob.updateMany({
      where: { operationId: { not: operationId }, state: 'QUEUED' },
      data: { availableAt: new Date(Date.now() + 60_000) },
    })
    await prisma.contestSettlementJob.update({
      where: { operationId },
      data: { availableAt: new Date(0) },
    })
    await processSettlementJobsOnce(randomUUID())
    return job(operationId)
  }

  const first = await makeContest(1, 45, 30, [a.id, b.id, c.id])
  const second = await makeContest(2, 25, 10, [b.id, c.id, d.id])
  const wrong = await attempt(first, a.id, 1, 'WRONG_ANSWER')
  const separate = await attempt(first, a.id, 3, 'ACCEPTED')
  await attempt(first, b.id, 10, 'ACCEPTED')
  await attempt(first, c.id, 2, 'WRONG_ANSWER')
  await attempt(second, b.id, 1, 'ACCEPTED')
  await attempt(second, c.id, 2, 'ACCEPTED')
  await attempt(second, d.id, 3, 'ACCEPTED')

  const finalizeId = randomUUID()
  const finalizeRequest = {
    contestId: first.contest.id,
    actorId: admin.id,
    type: 'FINALIZE' as const,
  }
  const queued = await queueSettlementOperation(finalizeId, finalizeRequest)
  const repeated = await queueSettlementOperation(finalizeId, finalizeRequest)
  assert.equal(queued.settlementJobId, repeated.settlementJobId)
  await assert.rejects(
    queueSettlementOperation(finalizeId, { ...finalizeRequest, contestId: second.contest.id }),
    error => (error as { code: string }).code === 'IDEMPOTENCY_CONFLICT'
  )
  // Simulate a crashed claim durably: recovery must replace worker and fence.
  await prisma.contestSettlementJob.update({
    where: { operationId: finalizeId },
    data: {
      state: 'RUNNING',
      fence: 7,
      attempts: 1,
      workerId: 'crashed-fixture-worker',
      leaseUntil: new Date(now - minute),
    },
  })
  const recovered = await run(finalizeId)
  assert.equal(recovered.state, 'COMPLETED')
  assert.equal(recovered.fence, 8)
  assert.equal(recovered.attempts, 2)
  // A stale worker's conditional acknowledgment cannot overwrite recovery.
  const staleWrite = await prisma.contestSettlementJob.updateMany({
    where: { id: recovered.id, state: 'RUNNING', workerId: 'crashed-fixture-worker', fence: 7 },
    data: { state: 'FAILED' },
  })
  assert.equal(staleWrite.count, 0)
  const initial = await snapshot(first.contest.id)
  const initialRows = initial.payload as unknown as {
    userId: string
    penalty: number
    rank: number
  }[]
  assert.equal(
    initialRows.find(row => row.userId === a.id)?.penalty,
    23,
    'Separate wrong attempt must contribute a 20-minute penalty'
  )
  const finalSecondId = randomUUID()
  await queueSettlementOperation(finalSecondId, {
    ...finalizeRequest,
    contestId: second.contest.id,
  })
  assert.equal((await run(finalSecondId)).state, 'COMPLETED')

  const correctionId = randomUUID()
  const correctionRequest = {
    contestId: first.contest.id,
    actorId: admin.id,
    type: 'CORRECTION' as const,
    reason: 'Synthetic fixture validates delayed correction publication',
    submissionId: wrong.id,
  }
  const before = await projections()
  const secondBefore = await snapshot(second.contest.id)
  const laterOpponentBefore = await prisma.contestRatingLedger.findFirstOrThrow({
    where: { contestId: second.contest.id, userId: d.id, isAuthoritative: true },
  })
  const dependentBefore = await prisma.contestRatingLedger.findFirstOrThrow({
    where: { contestId: second.contest.id, userId: b.id, isAuthoritative: true },
  })
  await queueSettlementOperation(correctionId, correctionRequest)
  assert.equal(
    (await run(correctionId)).state,
    'QUEUED',
    'Pending replacement must defer publication'
  )
  assert.deepEqual(await projections(), before)
  assert.equal((await snapshot(first.contest.id)).id, initial.id)
  assert.equal((await snapshot(second.contest.id)).id, secondBefore.id)
  const pending = await job(correctionId)
  const rejudgeId = (pending.request as Prisma.JsonObject).rejudgeJobId
  assert.equal(typeof rejudgeId, 'string')
  const replacement = await prisma.contestSubmission.findUniqueOrThrow({
    where: { jobId: rejudgeId as string },
    include: { job: true },
  })
  assert.equal(replacement.generation, 2)
  assert.equal(replacement.job.originJobId, wrong.jobId)
  assert.equal(replacement.job.admittedAt?.toISOString(), wrong.admittedAt.toISOString())
  assert.equal((replacement.job.policy as Prisma.JsonObject).packageHash, version.packageHash)
  assert.equal(
    (await prisma.contestSubmission.findUniqueOrThrow({ where: { id: separate.id } }))
      .isAuthoritative,
    true,
    'Rejudge must preserve separate attempts on the same problem'
  )
  const overlapId = randomUUID()
  const overlapRequest = {
    ...correctionRequest,
    reason: 'A second overlapping correction waits for the first',
  }
  await queueSettlementOperation(overlapId, overlapRequest)
  assert.equal((await run(overlapId)).state, 'QUEUED')
  assert.equal(
    (await job(overlapId)).attempts,
    0,
    'Dependency waits must not exhaust retry attempts'
  )
  assert.equal(
    (await job(overlapId)).request &&
      ((await job(overlapId)).request as Prisma.JsonObject).rejudgeJobId,
    undefined,
    'An overlapping operation must wait before creating another replacement'
  )
  await finish(replacement.jobId, replacement.id, 'ACCEPTED')
  assert.equal((await run(correctionId)).state, 'COMPLETED')
  const corrected = await snapshot(first.contest.id)
  assert.equal(corrected.revision, initial.revision + 1)
  assert.equal(
    (corrected.payload as unknown as { userId: string; rank: number }[]).find(
      row => row.userId === a.id
    )?.rank,
    1
  )
  assert.equal((await snapshot(second.contest.id)).revision, secondBefore.revision + 1)
  assert.notDeepEqual(
    await projections(),
    before,
    'Correction must recalculate dependent users and later opponents'
  )
  const laterOpponentAfter = await prisma.contestRatingLedger.findFirstOrThrow({
    where: { contestId: second.contest.id, userId: d.id, isAuthoritative: true },
  })
  const dependentAfter = await prisma.contestRatingLedger.findFirstOrThrow({
    where: { contestId: second.contest.id, userId: b.id, isAuthoritative: true },
  })
  assert.notEqual(
    laterOpponentAfter.id,
    laterOpponentBefore.id,
    'Later-only opponent needs a replayed ledger even when rounded rating is unchanged'
  )
  assert.notEqual(
    dependentAfter.oldRating,
    dependentBefore.oldRating,
    'Later contest must use corrected prefix ratings'
  )
  const countBeforeRetry = await prisma.contestRatingLedger.count()
  const replayed = await queueSettlementOperation(correctionId, correctionRequest)
  assert.equal(replayed.state, 'COMPLETED')
  assert.equal(await prisma.contestRatingLedger.count(), countBeforeRetry)

  // The second correction can proceed after the first publishes. A failed
  // replacement needs an explicit operator retry and a NEW fenced generation.
  assert.equal((await run(overlapId)).state, 'QUEUED')
  const overlapCheckpoint = (await job(overlapId)).request as Prisma.JsonObject
  const failedReplacement = await prisma.contestSubmission.findUniqueOrThrow({
    where: { jobId: overlapCheckpoint.rejudgeJobId as string },
  })
  assert.equal(failedReplacement.generation, 3)
  const publishedBeforeFailure = await snapshot(first.contest.id)
  await prisma.practiceJob.update({
    where: { id: failedReplacement.jobId },
    data: {
      state: 'DEAD_LETTER',
      verdict: 'JUDGE_FAILURE',
      failureCode: 'HOST_FAILURE',
    },
  })
  await prisma.contestSubmission.update({
    where: { id: failedReplacement.id },
    data: {
      state: 'TERMINAL',
      verdict: 'JUDGE_FAILURE',
    },
  })
  assert.equal((await run(overlapId)).state, 'DEAD_LETTER')
  assert.equal((await snapshot(first.contest.id)).id, publishedBeforeFailure.id)
  const retried = await retrySettlementOperation(
    first.contest.id,
    overlapId,
    admin.id,
    'Fixture judge incident resolved; retry the failed replacement'
  )
  assert.equal(retried.state, 'QUEUED')
  assert.equal(((await job(overlapId)).request as Prisma.JsonObject).rejudgeJobId, undefined)
  assert.equal((await run(overlapId)).state, 'QUEUED')
  const retryCheckpoint = (await job(overlapId)).request as Prisma.JsonObject
  const retryReplacement = await prisma.contestSubmission.findUniqueOrThrow({
    where: { jobId: retryCheckpoint.rejudgeJobId as string },
  })
  assert.notEqual(retryReplacement.jobId, failedReplacement.jobId)
  assert.equal(retryReplacement.generation, 4)
  await finish(retryReplacement.jobId, retryReplacement.id, 'ACCEPTED')
  assert.equal((await run(overlapId)).state, 'COMPLETED')

  // Ended, unfinalized (including unrated) contests can recover judge failures
  // without requiring finalization or publishing any rating replay.
  const recoverable = await makeContest(3, 8, 4, [a.id, b.id])
  await prisma.contest.update({ where: { id: recoverable.contest.id }, data: { isRated: false } })
  const failedInitial = await attempt(recoverable, a.id, 1, 'JUDGE_FAILURE')
  const recoveryId = randomUUID()
  await queueSettlementOperation(recoveryId, {
    contestId: recoverable.contest.id,
    actorId: admin.id,
    type: 'CORRECTION',
    submissionId: failedInitial.id,
    reason: 'Recover failed original judging before finalization',
  })
  assert.equal((await run(recoveryId)).state, 'QUEUED')
  const unrelatedRated = await makeContest(4, 3, 1, [c.id, d.id])
  await attempt(unrelatedRated, c.id, 1, 'ACCEPTED')
  await attempt(unrelatedRated, d.id, 1, 'WRONG_ANSWER')
  const unrelatedFinalize = randomUUID()
  await queueSettlementOperation(unrelatedFinalize, {
    contestId: unrelatedRated.contest.id,
    actorId: admin.id,
    type: 'FINALIZE',
  })
  assert.equal(
    (await run(unrelatedFinalize)).state,
    'COMPLETED',
    'An earlier pending unrated correction must not block unrelated rated finalization'
  )
  const recoveryCheckpoint = (await job(recoveryId)).request as Prisma.JsonObject
  const recoveredInitial = await prisma.contestSubmission.findUniqueOrThrow({
    where: { jobId: recoveryCheckpoint.rejudgeJobId as string },
  })
  await finish(recoveredInitial.jobId, recoveredInitial.id, 'ACCEPTED')
  assert.equal((await run(recoveryId)).state, 'COMPLETED')
  assert.equal(
    (await prisma.contest.findUniqueOrThrow({ where: { id: recoverable.contest.id } })).status,
    'ENDED'
  )
  assert.equal(
    await prisma.contestRatingLedger.count({ where: { contestId: recoverable.contest.id } }),
    0
  )
  assert.equal(
    await prisma.contestScoreboardSnapshot.count({ where: { contestId: recoverable.contest.id } }),
    0
  )

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(handleError)
  await app.register(leaderboardRoutes, { prefix: '/leaderboard' })
  try {
    const page1 = await app.inject({ method: 'GET', url: '/leaderboard?page=1&limit=1' })
    assert.equal(page1.statusCode, 200)
    const revision = page1.json().revision as string
    const page2 = await app.inject({
      method: 'GET',
      url: `/leaderboard?page=2&limit=1&revision=${revision}`,
    })
    assert.equal(page2.statusCode, 200)
    assert.notEqual(page1.json().users[0].userId, page2.json().users[0].userId)
    await prisma.user.update({ where: { id: d.id }, data: { isBanned: true } })
    assert.equal(
      (await app.inject({ method: 'GET', url: `/leaderboard?page=2&limit=1&revision=${revision}` }))
        .statusCode,
      409
    )
    await prisma.user.update({ where: { id: d.id }, data: { isBanned: false } })
  } finally {
    await app.close()
  }

  const dqId = randomUUID()
  await queueSettlementOperation(dqId, {
    contestId: first.contest.id,
    actorId: admin.id,
    type: 'CORRECTION',
    disqualifyUserId: a.id,
    reason: 'Synthetic fixture validates disqualification and zero-history reset',
  })
  assert.equal((await run(dqId)).state, 'COMPLETED')
  const reset = await prisma.user.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(reset.rating, 1500)
  assert.equal(reset.maxRating, 1500)
  assert.equal(reset.contestsCount, 0)
  assert.equal(reset.lastContestAt, null)
  assert.equal(
    await prisma.contestRatingLedger.count({ where: { userId: a.id, isAuthoritative: true } }),
    0
  )

  // SEALED cannot be edited, resealed from history, or deleted after supersession.
  await assert.rejects(
    prisma.contestManifest.update({ where: { id: first.manifest.id }, data: { title: 'tampered' } })
  )
  await assert.rejects(
    prisma.contestManifest.update({ where: { id: first.manifest.id }, data: { status: 'DRAFT' } })
  )
  await prisma.contestManifest.update({
    where: { id: first.manifest.id },
    data: { status: 'SUPERSEDED' },
  })
  await assert.rejects(
    prisma.contestManifest.update({
      where: { id: first.manifest.id },
      data: { title: 'tampered history' },
    })
  )
  await assert.rejects(
    prisma.contestManifest.update({ where: { id: first.manifest.id }, data: { status: 'SEALED' } })
  )
  // This row has no active-contest/submission references, so a foreign key
  // cannot accidentally make a missing DELETE trigger look successful.
  const unreferencedHistory = await prisma.contestManifest.create({
    data: {
      ...first.manifest,
      problems: first.manifest.problems as Prisma.InputJsonValue,
      id: randomUUID(),
      revision: 2,
    },
  })
  await assert.rejects(
    prisma.contestManifest.delete({ where: { id: unreferencedHistory.id } }),
    /cannot be deleted|immutable|history/i
  )
  await prisma.contestManifest.update({
    where: { id: unreferencedHistory.id },
    data: { status: 'SUPERSEDED' },
  })
  await assert.rejects(
    prisma.contestManifest.delete({ where: { id: unreferencedHistory.id } }),
    /cannot be deleted|immutable|history/i
  )
  console.log(
    JSON.stringify({
      verifier: 'phase3-operations',
      fixtureOnly: true,
      executedCandidateCode: false,
      durableQueue: true,
      leaseRecovery: true,
      pendingCorrection: true,
      overlappingCorrectionWaits: true,
      failedReplacementRecovery: true,
      preFinalizationRecovery: true,
      separateAttempts: true,
      chronologicalReplay: true,
      zeroHistoryReset: true,
      globalRevision: true,
      immutableHistory: true,
    })
  )
}

verifyPhase3Operations()
  .finally(() => prisma.$disconnect())
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'Operations verifier failed')
    process.exitCode = 1
  })
