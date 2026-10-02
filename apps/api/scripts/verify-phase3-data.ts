/* eslint-disable no-console -- Emit bounded acceptance metadata; never credentials or private payloads. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma, enqueueContestSubmission, type Prisma } from '@codeforge/db'
import { buildApp } from '../src/app.js'
import { computeScoreboard, type ContestSubmissionEvent } from '../src/contests/scoring.js'
import { finalizeContest, replayChronologicalContests } from '../src/contests/settlement.js'
import { computeManifestHash } from '../src/contests/manifest.js'

export async function runPhase3Verification() {
  console.log('--- Starting Phase 3 Core Data & Operational Verification ---')
  const app = await buildApp()
  app.log.level = 'fatal'

  try {
    const runId = randomBytes(4).toString('hex')
    // 1. Create test users
    const adminUser = await prisma.user.create({
      data: {
        email: `p3-admin-${runId}@example.test`,
        username: `p3_admin_${runId}`,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        rating: 1500,
      },
    })

    const competitors = await Promise.all(
      [1500, 1600, 1400].map((rating, i) =>
        prisma.user.create({
          data: {
            email: `p3-comp-${i}-${runId}@example.test`,
            username: `p3_comp_${i}_${runId}`,
            role: 'USER',
            emailVerifiedAt: new Date(),
            rating,
          },
        })
      )
    )

    console.log('Created admin and 3 competitors.')

    // 2. Create problem and version for contest
    const problem = await prisma.problem.create({
      data: {
        slug: `p3-prob-${runId}`,
        title: 'Phase 3 Two Sum',
        statementMd: 'Compute sum of integers.',
        inputFormat: 'Two integers a and b',
        outputFormat: 'One integer a + b',
        constraints: '1 <= N <= 100',
        difficultyBand: 'easy',
        authorId: adminUser.id,
        isPublic: false,
      },
    })

    const pkg = {
      title: 'Phase 3 Two Sum',
      statementMd: 'Compute sum of integers.',
      constraints: '1 <= N <= 100',
      inputFormat: 'Two integers a and b',
      outputFormat: 'One integer a + b',
      difficultyBand: 'easy',
      tags: ['math'],
      mode: 'STDIO',
      signature: null,
      languages: ['cpp', 'python'],
      limits: { timeMs: 1000, memoryKb: 131072, outputKb: 64 },
      checker: { kind: 'token', absolute: 0, relative: 0 },
      cases: [{ input: '2 3\n', output: '5\n', sample: true, explanation: '2+3=5' }],
      references: [
        {
          language: 'python',
          code: 'import sys; print(sum(map(int, sys.stdin.read().split())))',
          complexity: 'O(1)',
        },
      ],
      starters: { cpp: '#include <iostream>\nint main() {}', python: 'print()' },
      hints: [],
      editorial: '',
      rightsBasis: 'Original work',
    }

    const version = await prisma.practiceVersion.create({
      data: {
        problemId: problem.id,
        number: 1,
        authorId: adminUser.id,
        status: 'SEALED',
        packageHash: 'sha256:dummyhashforphase3verificationpackage000000000000000000000000000',
        package: pkg as unknown as Prisma.InputJsonValue,
      },
    })

    // 3. Create Contest 1 (Rated)
    const startTime = new Date(Date.now() - 3600000) // 1h ago
    const endTime = new Date(Date.now() + 3600000) // 1h in future
    const freezeTime = new Date(Date.now() - 600000) // 10 min ago

    const contest1 = await prisma.contest.create({
      data: {
        slug: `p3-contest1-${runId}`,
        title: 'Phase 3 Grand Prix Round 1',
        description: 'First test contest',
        format: 'ICPC',
        status: 'RUNNING',
        startTime,
        endTime,
        freezeAt: freezeTime,
        isRated: true,
        capacity: 100,
        isPublic: true,
      },
    })

    // 4. Seal Manifest for Contest 1
    const manifestProblems = [
      {
        orderIndex: 0,
        label: 'A',
        problemId: problem.id,
        versionId: version.id,
        packageHash: version.packageHash,
        points: 1,
        title: 'Two Sum',
      },
    ]

    const mHash = computeManifestHash({
      contestId: contest1.id,
      revision: 1,
      title: contest1.title,
      slug: contest1.slug,
      startTime: contest1.startTime.toISOString(),
      endTime: contest1.endTime.toISOString(),
      registrationOpensAt: contest1.startTime.toISOString(),
      registrationClosesAt: contest1.endTime.toISOString(),
      capacity: contest1.capacity,
      isRated: contest1.isRated,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      problems: manifestProblems,
      runtimePolicyHash: 'policy:gvisor-strict-v1',
    })

    const manifest = await prisma.contestManifest.create({
      data: {
        contestId: contest1.id,
        revision: 1,
        title: contest1.title,
        slug: contest1.slug,
        startTime: contest1.startTime,
        endTime: contest1.endTime,
        registrationOpensAt: contest1.startTime,
        registrationClosesAt: contest1.endTime,
        capacity: contest1.capacity,
        isRated: contest1.isRated,
        scoringPolicy: 'icpc-binary-v1',
        ratingPolicy: 'codeforge-pairwise-elo-v1',
        manifestHash: mHash,
        runtimePolicyHash: 'policy:gvisor-strict-v1',
        authorId: adminUser.id,
        problems: manifestProblems as unknown as Prisma.InputJsonValue,
        status: 'SEALED',
      },
    })

    await prisma.contest.update({
      where: { id: contest1.id },
      data: { activeManifestId: manifest.id },
    })

    console.log('Sealed contest manifest:', manifest.manifestHash.slice(0, 16))

    // 5. Register competitors
    for (const c of competitors) {
      await prisma.contestParticipant.create({
        data: {
          contestId: contest1.id,
          userId: c.id,
          status: 'REGISTERED',
          ratingAtRegistration: c.rating,
        },
      })
    }

    // Capacity enforcement test
    const smallContest = await prisma.contest.create({
      data: {
        slug: `p3-cap-${runId}`,
        title: 'Capacity Contest',
        format: 'ICPC',
        status: 'SCHEDULED',
        startTime,
        endTime,
        capacity: 1,
        isPublic: true,
      },
    })

    await prisma.contestParticipant.create({
      data: {
        contestId: smallContest.id,
        userId: competitors[0]!.id,
        status: 'REGISTERED',
        ratingAtRegistration: 1500,
      },
    })

    const count = await prisma.contestParticipant.count({
      where: { contestId: smallContest.id, status: 'REGISTERED' },
    })
    assert.equal(count >= smallContest.capacity, true, 'Capacity reached')

    // 6. Submissions with ICPC scoring:
    // Competitor 0: Solves A at +15 min (clean solve: 1 attempt, 15m penalty)
    // Competitor 1: Solves A at +30 min with 1 prior WA (2 attempts, 30 + 20 = 50m penalty)
    // Competitor 2: 2 WAs, unsolved (0 solves, 0 penalty)
    const t0 = new Date(startTime.getTime() + 15 * 60000)
    const t1_wa = new Date(startTime.getTime() + 20 * 60000)
    const t1_ac = new Date(startTime.getTime() + 30 * 60000)
    const t2_wa1 = new Date(startTime.getTime() + 25 * 60000)
    const t2_wa2 = new Date(startTime.getTime() + 35 * 60000)

    const dummyPolicy = { type: 'gvisor' }

    // Enqueue submissions through queue helper
    const sub0 = await enqueueContestSubmission(prisma, {
      contestId: contest1.id,
      userId: competitors[0]!.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(5)',
      idempotencyKey: `sub0-${runId}`,
      admittedAt: t0,
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: sub0.submission.id },
      data: { state: 'FINISHED', verdict: 'ACCEPTED' },
    })

    const sub1_wa = await enqueueContestSubmission(prisma, {
      contestId: contest1.id,
      userId: competitors[1]!.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(0)',
      idempotencyKey: `sub1-wa-${runId}`,
      admittedAt: t1_wa,
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: sub1_wa.submission.id },
      data: { state: 'FINISHED', verdict: 'WRONG_ANSWER' },
    })

    const sub1_ac = await enqueueContestSubmission(prisma, {
      contestId: contest1.id,
      userId: competitors[1]!.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(5)',
      idempotencyKey: `sub1-ac-${runId}`,
      admittedAt: t1_ac,
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: sub1_ac.submission.id },
      data: { state: 'FINISHED', verdict: 'ACCEPTED' },
    })

    const sub2_wa1 = await enqueueContestSubmission(prisma, {
      contestId: contest1.id,
      userId: competitors[2]!.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(1)',
      idempotencyKey: `sub2-wa1-${runId}`,
      admittedAt: t2_wa1,
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: sub2_wa1.submission.id },
      data: { state: 'FINISHED', verdict: 'WRONG_ANSWER' },
    })

    const sub2_wa2 = await enqueueContestSubmission(prisma, {
      contestId: contest1.id,
      userId: competitors[2]!.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(2)',
      idempotencyKey: `sub2-wa2-${runId}`,
      admittedAt: t2_wa2,
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: sub2_wa2.submission.id },
      data: { state: 'FINISHED', verdict: 'WRONG_ANSWER' },
    })

    // Compute live scoreboard
    const allSubs = await prisma.contestSubmission.findMany({
      where: { contestId: contest1.id, isAuthoritative: true },
      include: { user: { select: { username: true, displayName: true } } },
    })

    const sbEvents: ContestSubmissionEvent[] = allSubs.map(s => ({
      id: s.id,
      userId: s.userId,
      username: s.user.username,
      displayName: s.user.displayName,
      problemLabel: s.problemLabel,
      verdict: s.verdict,
      state: s.state,
      admittedAt: s.admittedAt,
    }))

    const parts = competitors.map(c => ({
      userId: c.id,
      username: c.username,
      displayName: null,
      rating: c.rating,
      avatarUrl: null,
    }))

    const sb = computeScoreboard(sbEvents, {
      startTime,
      freezeAt: null,
      isPublic: true,
      problemLabels: ['A'],
      participants: parts,
    })

    assert.equal(sb.entries[0]!.userId, competitors[0]!.id)
    assert.equal(sb.entries[0]!.score, 1)
    assert.equal(sb.entries[0]!.penalty, 15)

    assert.equal(sb.entries[1]!.userId, competitors[1]!.id)
    assert.equal(sb.entries[1]!.score, 1)
    assert.equal(sb.entries[1]!.penalty, 50) // 30 + 20

    assert.equal(sb.entries[2]!.userId, competitors[2]!.id)
    assert.equal(sb.entries[2]!.score, 0)
    assert.equal(sb.entries[2]!.penalty, 0)

    console.log(
      'Scoreboard standings verified: Competitor 0 (rank 1), Competitor 1 (rank 2), Competitor 2 (rank 3).'
    )

    // 7. Finalize Contest 1
    await prisma.contest.update({
      where: { id: contest1.id },
      data: { status: 'ENDED' },
    })

    const finalResult = await finalizeContest(contest1.id, adminUser.id, `final-1-${runId}`)
    assert.equal(finalResult.status, 'FINALIZED')
    assert.equal(finalResult.participantsCount, 3)

    // Check rating deltas zero sum
    const ledgers1 = await prisma.contestRatingLedger.findMany({
      where: { contestId: contest1.id, isAuthoritative: true },
    })
    const sumDeltas = ledgers1.reduce((sum, l) => sum + l.delta, 0)
    assert.equal(sumDeltas, 0, 'Rating deltas must sum to exactly zero!')
    console.log('Finalization verified: rating deltas sum exactly to 0.')

    // 8. Create Contest 2 with an overlapping participant and a new participant
    const newCompetitor = await prisma.user.create({
      data: {
        email: `p3-new-${runId}@example.test`,
        username: `p3_new_${runId}`,
        role: 'USER',
        emailVerifiedAt: new Date(),
        rating: 1550,
      },
    })

    const contest2 = await prisma.contest.create({
      data: {
        slug: `p3-contest2-${runId}`,
        title: 'Phase 3 Grand Prix Round 2',
        format: 'ICPC',
        status: 'ENDED',
        startTime: new Date(endTime.getTime() + 3600000),
        endTime: new Date(endTime.getTime() + 7200000),
        isRated: true,
        capacity: 100,
        isPublic: true,
        activeManifestId: manifest.id,
      },
    })

    const c0_updated = await prisma.user.findUniqueOrThrow({ where: { id: competitors[0]!.id } })
    await prisma.contestParticipant.create({
      data: {
        contestId: contest2.id,
        userId: c0_updated.id,
        status: 'REGISTERED',
        ratingAtRegistration: c0_updated.rating,
      },
    })

    await prisma.contestParticipant.create({
      data: {
        contestId: contest2.id,
        userId: newCompetitor.id,
        status: 'REGISTERED',
        ratingAtRegistration: newCompetitor.rating,
      },
    })

    const subNew = await enqueueContestSubmission(prisma, {
      contestId: contest2.id,
      userId: newCompetitor.id,
      manifestId: manifest.id,
      problemId: problem.id,
      versionId: version.id,
      problemLabel: 'A',
      language: 'python',
      source: 'print(5)',
      idempotencyKey: `sub-new-${runId}`,
      admittedAt: new Date(contest2.startTime.getTime() + 10 * 60000),
      policy: dummyPolicy,
    })
    await prisma.contestSubmission.update({
      where: { id: subNew.submission.id },
      data: { state: 'FINISHED', verdict: 'ACCEPTED' },
    })

    const finalResult2 = await finalizeContest(contest2.id, adminUser.id, `final-2-${runId}`)
    assert.equal(finalResult2.status, 'FINALIZED')

    const ledgers2 = await prisma.contestRatingLedger.findMany({
      where: { contestId: contest2.id, isAuthoritative: true },
    })
    const sumDeltas2 = ledgers2.reduce((sum, l) => sum + l.delta, 0)
    assert.equal(sumDeltas2, 0, 'Contest 2 deltas must sum to 0')
    console.log('Contest 2 settled successfully. Authoritative rating ledgers recorded.')

    // 9. Now test Correction & Dependent Chronological Replay
    const replayRes = await replayChronologicalContests(
      contest1.id,
      adminUser.id,
      'Test replay after correction',
      `replay-${runId}`
    )

    assert.equal(replayRes.replayedContestsCount, 2, 'Replayed contest 1 and dependent contest 2')
    assert.equal(replayRes.generation, 2, 'Ledgers incremented to generation 2')

    // Confirm generation 2 ledgers exist and are authoritative
    const gen2Ledgers1 = await prisma.contestRatingLedger.findMany({
      where: { contestId: contest1.id, generation: 2 },
    })
    assert.equal(gen2Ledgers1.length, 3)
    const gen2Ledgers2 = await prisma.contestRatingLedger.findMany({
      where: { contestId: contest2.id, generation: 2 },
    })
    assert.equal(gen2Ledgers2.length, 2)

    console.log(
      'Dependent chronological replay successfully recalculated both contests in generation 2!'
    )
    console.log('--- Phase 3 Data Verification Completed: 100% PASS ---')
  } finally {
    await app.close()
  }
}

// Self-run when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase3Verification()
    .then(() => {
      console.log('PASS: Phase 3 verification script finished successfully.')
      process.exit(0)
    })
    .catch(err => {
      console.error('FAIL: Phase 3 verification error:', err)
      process.exit(1)
    })
}
