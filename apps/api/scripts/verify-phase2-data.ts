import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  prisma,
  enqueuePracticeJob,
  dispatchPracticeOutbox,
  leasePracticeJob,
  completePracticeJob,
  reconcilePracticeJobs,
  failPracticeLease,
  rejudgePracticeJob,
} from '@codeforge/db'
import { PracticePackage } from '@codeforge/shared'
import { buildApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/tokens.js'
import { ACCESS_COOKIE } from '../src/auth/cookies.js'
import { canonical, hash } from '../src/practice/package.js'

const url = new URL(process.env.DATABASE_URL ?? '')
if (
  process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/^\/phase2_[a-f0-9]+$/.test(url.pathname) ||
  url.username !== 'phase2'
)
  throw new Error('Explicit fresh disposable Phase 2 database required')
const fixture = PracticePackage.parse(
  JSON.parse(readFileSync('../../tests/fixtures/practice-package.json', 'utf8'))
)
const app = await buildApp()
app.log.level = 'fatal'
try {
  const roles = ['PROBLEM_SETTER', 'REVIEWER', 'USER', 'USER', 'MODERATOR'] as const
  const users = await Promise.all(
    roles.map((role, i) =>
      prisma.user.create({
        data: {
          email: `phase2-data-${i}@example.test`,
          username: `phase2_data_${i}`,
          role,
          emailVerifiedAt: new Date(),
        },
      })
    )
  )
  const cookies = await Promise.all(
    users.map(async u => {
      const session = await prisma.userSession.create({
        data: {
          userId: u.id,
          refreshTokenHash: hash(randomUUID()),
          ipAddress: '127.0.0.1',
          userAgent: 'trusted-data-verifier',
          expiresAt: new Date(Date.now() + 3600000),
        },
      })
      return `${ACCESS_COOKIE}=${signAccessToken({ sub: u.id, sid: session.id, username: u.username, role: u.role })}`
    })
  )
  const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
  const csrfCookie = csrf.cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const headers = (i: number) => ({
    cookie: `${cookies[i]}; ${csrfCookie}`,
    'x-csrf-token': csrf.json().csrfToken as string,
  })
  const create = await app.inject({
    method: 'POST',
    url: '/api/practice/staff/versions',
    headers: headers(0),
    payload: { slug: 'phase2-private-fixture', package: fixture },
  })
  assert.equal(create.statusCode, 200)
  const versionId = create.json().id as string
  const version = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: versionId } })
  assert.equal(version.packageHash, hash(canonical(fixture)))
  const denied = await app.inject({
    method: 'GET',
    url: `/api/practice/staff/versions/${versionId}`,
    headers: headers(2),
  })
  assert.equal(denied.statusCode, 403)
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/practice/staff/versions', headers: headers(4) }))
      .statusCode,
    403
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/practice/staff/versions/${versionId}/validate`,
        headers: headers(0),
        payload: {},
      })
    ).statusCode,
    503
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/practice/staff/versions/${versionId}/publish`,
        headers: headers(1),
        payload: {
          rightsConfirmed: true,
          rightsBasis: fixture.rightsBasis,
          packageHash: version.packageHash,
        },
      })
    ).statusCode,
    503
  )
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/practice/problems/phase2-private-fixture' }))
      .statusCode,
    404
  )
  const jobBody = {
    problemId: version.problemId,
    language: 'python',
    code: 'never executed',
    idempotencyKey: randomUUID(),
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/practice/submit',
        headers: headers(2),
        payload: jobBody,
      })
    ).statusCode,
    503
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/practice/submit',
        headers: headers(2),
        payload: { ...jobBody, language: 'c' },
      })
    ).statusCode,
    400
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/practice/submit',
        headers: headers(2),
        payload: { ...jobBody, contestId: randomUUID() },
      })
    ).statusCode,
    400
  )
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/practice/submit', payload: jobBody }))
      .statusCode,
    403
  )
  assert.equal(await prisma.practiceJob.count(), 0)
  await assert.rejects(
    prisma.practiceVersion.update({
      where: { id: versionId },
      data: { package: { corrupt: true } },
    })
  )

  // Trusted synthetic state fixtures below exercise PostgreSQL concurrency.
  // They are NOT execution/reference-validation or verdict correctness evidence.
  await prisma.practiceVersion.update({
    where: { id: versionId },
    data: {
      status: 'PUBLISHED',
      validation: { fixtureOnly: true, executed: false },
      reviewerId: users[1]!.id,
      approvedAt: new Date(),
      publishedAt: new Date(),
    },
  })
  await prisma.problem.update({
    where: { id: version.problemId },
    data: { status: 'PUBLISHED', isPublic: true },
  })
  const projected = await app.inject({
    method: 'GET',
    url: '/api/practice/problems/phase2-private-fixture',
  })
  assert.equal(projected.statusCode, 200)
  assert(!projected.body.includes('PRIVATE_'))
  const input = {
    ownerId: users[2]!.id,
    versionId,
    kind: 'SUBMIT' as const,
    language: 'python',
    source: 'trusted lifecycle fixture: never executed',
    idempotencyKey: randomUUID(),
    policy: { fixtureOnly: true, executionDisabled: true },
  }
  const duplicates = await Promise.all(
    Array.from({ length: 8 }, () => enqueuePracticeJob(prisma, input))
  )
  assert.equal(new Set(duplicates.map(j => j.id)).size, 1)
  const id = duplicates[0]!.id
  assert.equal(await prisma.practiceOutbox.count({ where: { jobId: id } }), 1)
  await assert.rejects(enqueuePracticeJob(prisma, { ...input, source: 'different' }))
  await dispatchPracticeOutbox(prisma, async () => {
    throw new Error('queue outage fixture')
  })
  assert.equal(
    (await prisma.practiceOutbox.findUniqueOrThrow({ where: { jobId: id } })).deliveredAt,
    null
  )
  await prisma.practiceOutbox.update({ where: { jobId: id }, data: { availableAt: new Date(0) } })
  const sent: string[] = []
  await dispatchPracticeOutbox(prisma, async job => {
    sent.push(job)
  })
  assert.deepEqual(sent, [id])
  const claims = await Promise.all([
    leasePracticeJob(prisma, 'worker_a'),
    leasePracticeJob(prisma, 'worker_b'),
  ])
  assert.equal(claims.filter(Boolean).length, 1)
  const leased = claims.find(j => j !== null)!
  await prisma.practiceJob.update({ where: { id }, data: { leaseExpiresAt: new Date(0) } })
  await reconcilePracticeJobs(prisma)
  const synthetic = {
    verdict: 'ACCEPTED',
    passed: 2,
    total: 2,
    timeMs: null,
    memoryKb: null,
    privateEvidence: { fixtureOnly: true, executed: false, hiddenStdout: 'PRIVATE_STDIN_ECHO' },
  }
  assert.equal(
    await completePracticeJob(
      prisma,
      { id, workerId: leased.leaseOwner!, fence: leased.fence },
      synthetic
    ),
    false
  )
  await prisma.practiceJob.update({ where: { id }, data: { availableAt: new Date(0) } })
  await dispatchPracticeOutbox(prisma, async () => undefined)
  const lease = (await leasePracticeJob(prisma, 'worker_c'))!
  const terminal = await Promise.all(
    Array.from({ length: 4 }, () =>
      completePracticeJob(prisma, { id, workerId: 'worker_c', fence: lease.fence }, synthetic)
    )
  )
  assert.equal(terminal.filter(Boolean).length, 1)
  assert.equal(
    await prisma.practiceSolve.count({
      where: { ownerId: users[2]!.id, problemId: version.problemId },
    }),
    1
  )
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/practice/jobs/${id}`, headers: headers(3) }))
      .statusCode,
    404
  )
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/practice/jobs/${id}`, headers: headers(1) }))
      .statusCode,
    404
  )
  const own = await app.inject({
    method: 'GET',
    url: `/api/practice/jobs/${id}`,
    headers: headers(2),
  })
  assert.equal(own.statusCode, 200)
  assert(!own.body.includes('PRIVATE_'))
  const generation = await rejudgePracticeJob(prisma, {
    id,
    actorId: users[1]!.id,
    reason: 'Trusted rejudge lifecycle fixture',
    idempotencyKey: randomUUID(),
  })
  assert.equal(generation.generation, 2)
  await dispatchPracticeOutbox(prisma, async () => undefined)
  const second = (await leasePracticeJob(prisma, 'worker_d'))!
  assert.equal(
    await completePracticeJob(
      prisma,
      { id: second.id, workerId: 'worker_d', fence: second.fence },
      { ...synthetic, verdict: 'WRONG_ANSWER', passed: 0 }
    ),
    true
  )
  assert.equal(
    await prisma.practiceSolve.count({
      where: { ownerId: users[2]!.id, problemId: version.problemId },
    }),
    0
  )
  assert.equal((await prisma.practiceJob.findUniqueOrThrow({ where: { id } })).verdict, 'ACCEPTED')

  const failing = await enqueuePracticeJob(prisma, { ...input, idempotencyKey: randomUUID() })
  for (let attempt = 0; attempt < 3; attempt++) {
    await prisma.practiceJob.update({
      where: { id: failing.id },
      data: { availableAt: new Date(0) },
    })
    await dispatchPracticeOutbox(prisma, async () => undefined)
    const l = (await leasePracticeJob(prisma, 'worker_failure'))!
    assert.equal(
      await failPracticeLease(
        prisma,
        { id: l.id, workerId: 'worker_failure', fence: l.fence },
        'STORAGE_UNAVAILABLE'
      ),
      true
    )
  }
  assert.equal(
    (await prisma.practiceJob.findUniqueOrThrow({ where: { id: failing.id } })).state,
    'DEAD_LETTER'
  )
  assert.equal(
    await prisma.auditLog.count({ where: { target: failing.id, action: 'practice.dead_letter' } }),
    1
  )
  const cancellation = await enqueuePracticeJob(prisma, { ...input, idempotencyKey: randomUUID() })
  await dispatchPracticeOutbox(prisma, async () => undefined)
  const cancellationLease = (await leasePracticeJob(prisma, 'worker_cancel'))!
  await app.inject({
    method: 'POST',
    url: `/api/practice/jobs/${cancellation.id}/cancel`,
    headers: headers(2),
    payload: {},
  })
  assert.equal(
    await completePracticeJob(
      prisma,
      { id: cancellation.id, workerId: 'worker_cancel', fence: cancellationLease.fence },
      synthetic
    ),
    false
  )
  const outage = await enqueuePracticeJob(prisma, { ...input, idempotencyKey: randomUUID() })
  for (let retry = 0; retry < 10; retry++) {
    await prisma.practiceOutbox.update({
      where: { jobId: outage.id },
      data: { availableAt: new Date(0) },
    })
    await dispatchPracticeOutbox(prisma, async () => {
      throw new Error('Unavailable queue fixture')
    })
  }
  assert.equal(
    (await prisma.practiceJob.findUniqueOrThrow({ where: { id: outage.id } })).failureCode,
    'DISPATCH_EXHAUSTED'
  )
  assert.equal(
    await prisma.auditLog.count({ where: { target: outage.id, action: 'practice.dead_letter' } }),
    1
  )
  const withdrawal = await Promise.all(
    Array.from({ length: 3 }, () =>
      app.inject({
        method: 'POST',
        url: `/api/practice/staff/versions/${versionId}/withdraw`,
        headers: headers(1),
        payload: { reason: 'End disposable lifecycle fixture' },
      })
    )
  )
  assert(withdrawal.every(r => r.statusCode === 200))
  assert.equal(
    await prisma.auditLog.count({ where: { target: versionId, action: 'practice.withdraw' } }),
    1
  )
  await assert.rejects(enqueuePracticeJob(prisma, { ...input, idempotencyKey: randomUUID() }))
  await assert.rejects(prisma.practiceJob.update({ where: { id }, data: { source: 'mutated' } }))
  process.stdout.write(
    'PASS: real PostgreSQL package immutability, private projection, role/CSRF/admission checks, idempotency, outbox retry, lease fencing, duplicate completion, solve ledger, rejudge, retry exhaustion, cancellation and withdrawal. Synthetic lifecycle results only; no candidate code executed.\n'
  )
} finally {
  await app.close()
  await prisma.$disconnect()
}
