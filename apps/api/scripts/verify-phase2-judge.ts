/* eslint-disable no-console -- Emit bounded acceptance metadata; never credentials or private payloads. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  prisma,
  enqueuePracticeJob,
  completePracticeJob,
  dispatchPracticeOutbox,
  retainPracticeRuns,
  type Prisma,
} from '@codeforge/db'
import { command, engineName } from '../../judge-worker/src/transport.js'
import { PracticePackage } from '@codeforge/shared'
import { buildApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/tokens.js'
import { ACCESS_COOKIE } from '../src/auth/cookies.js'
import { hash } from '../src/practice/package.js'

const url = new URL(process.env.DATABASE_URL ?? '')
if (
  process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/^\/phase2_[a-f0-9]+$/.test(url.pathname) ||
  url.username !== 'phase2'
)
  throw new Error('Fresh disposable Phase 2 database required')
if (process.env.FORGE_PRACTICE_ENABLED !== '1')
  throw new Error('Real judge admission must be explicitly configured')
const app = await buildApp()
app.log.level = 'fatal'
const children: ChildProcess[] = []
const root = fileURLToPath(new URL('../../../', import.meta.url))
const notes: Record<string, unknown>[] = []
function start(stage = '', jobId = '') {
  const child = spawn(
    process.execPath,
    [
      '--import',
      './apps/judge-worker/node_modules/tsx/dist/loader.mjs',
      'apps/judge-worker/src/service.ts',
    ],
    {
      cwd: root,
      env: { ...process.env, FORGE_TEST_FAULT: stage, FORGE_TEST_JOB: jobId },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let pending = ''
  child.stdout!.on('data', (data: Buffer) => {
    pending += data.toString('utf8')
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (['judge.ready', 'judge.fault_rendezvous'].includes(String(parsed.event)))
          notes.push({ ...parsed, pid: child.pid })
      } catch {
        /* Non-evidence startup messages. */
      }
    }
  })
  child.stderr!.on('data', () => undefined)
  children.push(child)
  return child
}
async function stop(child: ChildProcess, crash = false) {
  if (child.exitCode !== null) return
  child.kill(crash ? 'SIGKILL' : 'SIGTERM')
  await until(
    async () => (child.exitCode !== null || child.signalCode !== null ? true : null),
    10000
  )
}
async function until<T>(fn: () => Promise<T | null>, timeout = 120000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Real judge verification timed out')
}
async function terminal(id: string) {
  return until(async () => {
    const j = await prisma.practiceJob.findUniqueOrThrow({ where: { id } })
    return ['TERMINAL', 'DEAD_LETTER', 'CANCELLED'].includes(j.state) ? j : null
  })
}
try {
  const roles = ['PROBLEM_SETTER', 'REVIEWER', 'USER', 'USER', 'ADMIN'] as const
  const users = await Promise.all(
    roles.map((role, i) =>
      prisma.user.create({
        data: {
          email: `judge-${i}@example.test`,
          username: `judge_${i}`,
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
          userAgent: 'real-judge-verifier',
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
  const post = async (i: number, route: string, payload: unknown, expected = 200) => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/practice${route}`,
      headers: headers(i),
      payload: payload as Record<string, unknown>,
    })
    assert.equal(r.statusCode, expected, `${route}: ${r.body}`)
    return r.json() as { id: string; generation: number; jobs: { id: string }[] }
  }
  start()
  start()
  const runtime = await until(() =>
    prisma.practiceJudgeRuntime.findFirst({ where: { expiresAt: { gt: new Date() } } })
  )
  const policy = runtime.policy as Prisma.InputJsonObject
  const p = PracticePackage.parse({
    title: 'Real judge sum fixture',
    statementMd: 'Add two integers.',
    constraints: 'Integers between -100 and 100.',
    inputFormat: 'Two integers',
    outputFormat: 'Their sum',
    difficultyBand: 'easy',
    tags: ['math'],
    mode: 'STDIO',
    signature: null,
    languages: ['cpp', 'python', 'java', 'javascript'],
    limits: { timeMs: 2000, memoryKb: 65536, outputKb: 4 },
    checker: { kind: 'token' },
    cases: [
      { input: '1 2\n', output: '3', sample: true },
      { input: '17 -9\n', output: '8', sample: false },
    ],
    references: [
      { language: 'python', code: 'a,b=map(int,input().split());print(a+b)', complexity: 'O(1)' },
    ],
    hints: ['Use addition.'],
    editorial: 'Read two integers and add them.',
    rightsBasis: 'Original acceptance fixture by CodeForge.',
  })
  const created = await post(0, '/staff/versions', { slug: 'real-judge-sum', package: p })
  const v = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: created.id } })
  await post(
    0,
    `/staff/versions/${v.id}/publish`,
    { rightsConfirmed: true, rightsBasis: p.rightsBasis, packageHash: v.packageHash },
    403
  )
  await post(
    1,
    `/staff/versions/${v.id}/publish`,
    { rightsConfirmed: true, rightsBasis: p.rightsBasis, packageHash: v.packageHash },
    409
  )
  const validation = await post(0, `/staff/versions/${v.id}/validate`, {})
  await Promise.all(validation.jobs.map((j: { id: string }) => terminal(j.id)))
  await until(async () => {
    const row = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: v.id } })
    return row.status === 'VALIDATED' ? row : null
  })
  await post(1, `/staff/versions/${v.id}/publish`, {
    rightsConfirmed: true,
    rightsBasis: p.rightsBasis,
    packageHash: v.packageHash,
  })
  await post(1, `/staff/versions/${v.id}/publish`, {
    rightsConfirmed: true,
    rightsBasis: p.rightsBasis,
    packageHash: v.packageHash,
  })
  const body = {
    problemId: v.problemId,
    versionId: v.id,
    language: 'python',
    code: p.references[0]!.code,
    idempotencyKey: randomUUID(),
  }
  const [a, duplicate] = await Promise.all([post(2, '/submit', body), post(2, '/submit', body)])
  assert.equal(a.id, duplicate.id)
  assert.equal((await terminal(a.id)).verdict, 'ACCEPTED')
  await post(2, '/submit', { ...body, code: "print('wrong')" }, 409)
  const wrong = await post(2, '/submit', {
    ...body,
    code: "print('wrong')",
    idempotencyKey: randomUUID(),
  })
  assert.equal((await terminal(wrong.id)).verdict, 'WRONG_ANSWER')
  const run = await post(2, '/runs', { ...body, idempotencyKey: randomUUID(), input: '7 9' })
  assert.equal((await terminal(run.id)).verdict, 'RUN_COMPLETE')
  const detail = await app.inject({
    method: 'GET',
    url: `/api/practice/jobs/${a.id}`,
    headers: headers(2),
  })
  assert.equal(detail.statusCode, 200)
  assert(!detail.body.includes('17 -9'))
  assert(!detail.body.includes('privateResult'))
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/practice/jobs/${a.id}`, headers: headers(3) }))
      .statusCode,
    404
  )
  const echo = await post(2, '/submit', {
    ...body,
    code: 'import sys\ns=sys.stdin.read();sys.stdout.write(s);sys.stderr.write(s)',
    idempotencyKey: randomUUID(),
  })
  assert.equal((await terminal(echo.id)).verdict, 'WRONG_ANSWER')
  const echoDetail = await app.inject({
    method: 'GET',
    url: `/api/practice/jobs/${echo.id}`,
    headers: headers(2),
  })
  assert.equal(echoDetail.statusCode, 200)
  assert(!echoDetail.body.includes('17 -9'))
  assert.deepEqual(echoDetail.json().samples, [])
  const solve = await prisma.practiceSolve.count({
    where: { ownerId: users[2]!.id, problemId: v.problemId },
  })
  assert.equal(solve, 1)
  const job = await prisma.practiceJob.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(
    await completePracticeJob(
      prisma,
      { id: job.id, workerId: 'stale_worker', fence: job.fence },
      {
        verdict: 'ACCEPTED',
        passed: 2,
        total: 2,
        timeMs: 1,
        memoryKb: 1,
        privateEvidence: { fixtureOnly: true },
      }
    ),
    false
  )
  const cancelled = await post(3, '/submit', {
    ...body,
    idempotencyKey: randomUUID(),
    code: 'while True: pass',
  })
  await post(3, `/jobs/${cancelled.id}/cancel`, {})
  assert.equal((await terminal(cancelled.id)).state, 'CANCELLED')
  const rejudged = await post(4, `/staff/jobs/${a.id}/rejudge`, {
    reason: 'Real operator recovery acceptance.',
    idempotencyKey: randomUUID(),
  })
  assert.equal((await terminal(rejudged.id)).verdict, 'ACCEPTED')
  assert.equal(
    await prisma.practiceSolve.count({ where: { ownerId: users[2]!.id, problemId: v.problemId } }),
    1
  )
  console.log(
    JSON.stringify({
      event: 'judge.api_journeys_passed',
      executed: true,
      versionId: v.id,
      validationJobs: validation.jobs.length,
      duplicateJobId: a.id,
      solveCount: solve,
    })
  )

  // Real process interruptions at durable boundaries. The rendezvous only
  // pauses a disposable worker; recovery compiles and executes the source.
  for (const child of [...children]) await stop(child)
  for (const stage of [
    'before_dispatch',
    'after_delivery',
    'before_compile',
    'after_compile',
    'before_commit',
  ]) {
    const faultJob = await enqueuePracticeJob(prisma, {
      ownerId: users[3]!.id,
      versionId: v.id,
      kind: 'SUBMIT',
      language: 'python',
      source: p.references[0]!.code,
      idempotencyKey: randomUUID(),
      policy,
    })
    const interrupted = start(stage, faultJob.id)
    await until(async () =>
      notes.some(
        n => n.event === 'judge.fault_rendezvous' && n.stage === stage && n.pid === interrupted.pid
      )
        ? true
        : null
    )
    const before = await prisma.practiceJob.findUniqueOrThrow({ where: { id: faultJob.id } })
    await stop(interrupted, true)
    const recovering = start()
    const after = await terminal(faultJob.id)
    assert.equal(after.verdict, 'ACCEPTED')
    assert.equal((after.privateResult as Record<string, unknown>).executed, true)
    assert.equal(after.attempt, before.attempt + 1)
    assert.equal(
      await prisma.auditLog.count({ where: { action: 'practice.complete', target: after.id } }),
      1
    )
    console.log(
      JSON.stringify({
        event: 'judge.crash_recovered',
        stage,
        beforeState: before.state,
        attempt: after.attempt,
        verdict: after.verdict,
        executed: true,
      })
    )
    await stop(recovering)
  }
  for (const stage of ['during_compile', 'during_execution']) {
    const source =
      stage === 'during_compile'
        ? '#include <iostream>\n' +
          Array.from({ length: 1000 }, (_, i) => `int f${i}(int x){return x+${i};}\n`).join('') +
          'int main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}'
        : 'import time\ntime.sleep(2)\na,b=map(int,input().split());print(a+b)'
    const interruptedJob = await enqueuePracticeJob(prisma, {
      ownerId: users[3]!.id,
      versionId: v.id,
      kind: 'SUBMIT',
      language: stage === 'during_compile' ? 'cpp' : 'python',
      source,
      idempotencyKey: randomUUID(),
      policy,
    })
    const interrupted = start()
    const executing = await until(async () => {
      const j = await prisma.practiceJob.findUniqueOrThrow({ where: { id: interruptedJob.id } })
      if (j.state !== (stage === 'during_compile' ? 'COMPILING' : 'RUNNING')) return null
      const id = (
        await command([
          'exec',
          engineName(),
          'docker',
          'ps',
          '-q',
          '--filter',
          `label=codeforge.job=${j.id}_${j.fence}`,
        ])
      ).trim()
      if (!id || id.includes('\n')) return null
      const ids = JSON.parse(
        await command([
          'exec',
          engineName(),
          'docker',
          'inspect',
          '--format',
          '{{json .ExecIDs}}',
          id,
        ])
      ) as string[] | null
      return ids?.length ? { fence: j.fence, state: j.state, execCount: ids.length } : null
    })
    await stop(interrupted, true)
    const replacement = start()
    const recovered = await terminal(interruptedJob.id)
    assert.equal(recovered.verdict, 'ACCEPTED')
    assert.equal(recovered.attempt, 2)
    assert.equal(
      await prisma.auditLog.count({ where: { action: 'practice.complete', target: recovered.id } }),
      1
    )
    const remaining = await command([
      'exec',
      engineName(),
      'docker',
      'ps',
      '-aq',
      '--filter',
      `label=codeforge.job=${recovered.id}_${executing.fence}`,
    ])
    assert.equal(remaining.trim(), '')
    console.log(
      JSON.stringify({
        event: 'judge.crash_recovered',
        stage,
        observed: executing,
        attempt: recovered.attempt,
        verdict: recovered.verdict,
        executed: true,
        oldSandboxRemoved: true,
      })
    )
    await stop(replacement)
  }
  // Failed delivery is a real transport exception with committed intent.
  const outage = await enqueuePracticeJob(prisma, {
    ownerId: users[3]!.id,
    versionId: v.id,
    kind: 'SUBMIT',
    language: 'python',
    source: p.references[0]!.code,
    idempotencyKey: randomUUID(),
    policy,
  })
  await dispatchPracticeOutbox(prisma, async () => {
    throw new Error('Controlled transport outage')
  })
  assert.equal(
    (await prisma.practiceJob.findUniqueOrThrow({ where: { id: outage.id } })).state,
    'QUEUED'
  )
  assert.equal(
    (await prisma.practiceOutbox.findUniqueOrThrow({ where: { jobId: outage.id } })).attempts,
    1
  )
  const recoveredTransport = start()
  assert.equal((await terminal(outage.id)).verdict, 'ACCEPTED')
  await stop(recoveredTransport)
  // Bounded retention removes only old terminal RUN leaves, preserving all
  // immutable submission/reference and rejudge evidence.
  const oldRun = await prisma.practiceJob.findUniqueOrThrow({ where: { id: run.id } })
  await prisma.practiceJob.update({
    where: { id: oldRun.id },
    data: { finishedAt: new Date(Date.now() - 31 * 86400000) },
  })
  assert.equal(await retainPracticeRuns(prisma), 1)
  assert.equal(await prisma.practiceJob.count({ where: { id: oldRun.id } }), 0)
  assert.equal(await prisma.practiceJob.count({ where: { id: a.id } }), 1)
  console.log(JSON.stringify({ event: 'judge.transport_retention_passed', executed: true }))
  const integrityJob = await enqueuePracticeJob(prisma, {
    ownerId: users[3]!.id,
    versionId: v.id,
    kind: 'SUBMIT',
    language: 'python',
    source: p.references[0]!.code,
    idempotencyKey: randomUUID(),
    policy: { ...policy, harnessHash: '0'.repeat(64) },
  })
  const integrityWorker = start()
  const failed = await terminal(integrityJob.id)
  assert.equal(failed.state, 'DEAD_LETTER')
  assert.equal(failed.attempt, 3)
  assert.equal(failed.verdict, 'JUDGE_FAILURE')
  assert.equal(failed.privateResult, null)
  assert.equal(
    await prisma.auditLog.count({ where: { action: 'practice.dead_letter', target: failed.id } }),
    1
  )
  const operatorRecovery = await post(4, `/staff/jobs/${failed.id}/rejudge`, {
    reason: 'Restore verified policy after deliberate integrity fault.',
    idempotencyKey: randomUUID(),
  })
  assert.equal((await terminal(operatorRecovery.id)).verdict, 'ACCEPTED')
  assert.equal(
    (await prisma.practiceJob.findUniqueOrThrow({ where: { id: failed.id } })).state,
    'DEAD_LETTER'
  )
  await stop(integrityWorker)
  console.log(
    JSON.stringify({
      event: 'judge.integrity_deadletter_recovery_passed',
      attempts: failed.attempt,
      recoveredWithRealExecution: true,
    })
  )
  const postgres = process.env.FORGE_TEST_POSTGRES ?? ''
  if (!/^[a-f0-9]{64}$/.test(postgres))
    throw new Error('Disposable PostgreSQL container required for storage outage')
  const storageJob = await enqueuePracticeJob(prisma, {
    ownerId: users[3]!.id,
    versionId: v.id,
    kind: 'SUBMIT',
    language: 'python',
    source: 'import time;time.sleep(2)\n' + p.references[0]!.code,
    idempotencyKey: randomUUID(),
    policy,
  })
  const storageWorker = start()
  await until(async () =>
    (await prisma.practiceJob.findUniqueOrThrow({ where: { id: storageJob.id } })).state ===
    'RUNNING'
      ? true
      : null
  )
  const containerLabels = JSON.parse(
    await command(['inspect', '--format', '{{json .Config.Labels}}', postgres])
  ) as Record<string, string>
  if (!/^codeforge-phase2-[a-f0-9]{32}$/.test(containerLabels['com.docker.compose.project'] ?? ''))
    throw new Error('Storage fault target is not disposable')
  await command(['pause', postgres])
  try {
    await new Promise(resolve => setTimeout(resolve, 10000))
  } finally {
    await command(['unpause', postgres])
  }
  assert.equal((await terminal(storageJob.id)).verdict, 'ACCEPTED')
  assert.equal(
    await prisma.auditLog.count({ where: { action: 'practice.complete', target: storageJob.id } }),
    1
  )
  await stop(storageWorker)
  console.log(
    JSON.stringify({
      event: 'judge.real_storage_outage_recovered',
      pauseMs: 10000,
      executed: true,
      falseCandidateVerdict: false,
    })
  )
  start()
  start()

  if (process.env.FORGE_CAPACITY !== '1000')
    throw new Error('Capacity acceptance requires exactly 1000 real queued jobs')
  const capacityUsers = await Promise.all(
    Array.from({ length: 334 }, (_, i) =>
      prisma.user.create({
        data: {
          email: `capacity-${i}@example.test`,
          username: `capacity_${i}`,
          role: 'USER',
          emailVerifiedAt: new Date(),
        },
      })
    )
  )
  const admitted: string[] = []
  const begin = Date.now()
  for (let i = 0; i < 1000; i++) {
    const j = await enqueuePracticeJob(prisma, {
      ownerId: capacityUsers[Math.floor(i / 3)]!.id,
      versionId: v.id,
      kind: 'SUBMIT',
      language: 'python',
      source: p.references[0]!.code,
      idempotencyKey: randomUUID(),
      policy,
    })
    admitted.push(j.id)
  }
  // Crash a live worker during the burst. PostgreSQL expiry/reconciliation
  // must recover its lease; surviving worker and restarted worker execute it.
  const crash = children.at(-2)!
  const crashWorker = await until(
    async () => notes.find(n => n.event === 'judge.ready' && n.pid === crash.pid) ?? null
  )
  const interruptedLease = await until(() =>
    prisma.practiceJob.findFirst({
      where: {
        id: { in: admitted },
        leaseOwner: String(crashWorker.workerId),
        state: { in: ['COMPILING', 'RUNNING'] },
      },
    })
  )
  crash.kill('SIGKILL')
  await new Promise(resolve => setTimeout(resolve, 100))
  start()
  let last = -1
  await until(async () => {
    const remaining = await prisma.practiceJob.count({
      where: { id: { in: admitted }, state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
    })
    if (last !== remaining) {
      last = remaining
      if (remaining % 50 === 0)
        console.log(JSON.stringify({ event: 'capacity.progress', remaining }))
    }
    return remaining === 0 ? true : null
  }, 3600000)
  const rows = await prisma.practiceJob.findMany({ where: { id: { in: admitted } } })
  const totals: Record<string, number> = {}
  for (const j of rows) {
    assert.equal((j.privateResult as Record<string, unknown> | null)?.executed, true)
    totals[j.verdict ?? j.state] = (totals[j.verdict ?? j.state] ?? 0) + 1
  }
  const percentile = (list: number[], p: number) =>
    list.sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))]
  const waits = rows.map(j => j.startedAt!.getTime() - j.createdAt.getTime())
  const elapsedMs = Date.now() - begin
  const solves = await prisma.practiceSolve.count({
    where: { problemId: v.problemId, ownerId: { in: capacityUsers.map(u => u.id) } },
  })
  console.log(
    JSON.stringify({
      event: 'capacity.complete',
      executed: true,
      admitted: rows.length,
      totals,
      elapsedMs,
      jobsPerSecond: 1000000 / elapsedMs,
      concurrency: 2,
      retries: rows.reduce((n, j) => n + Math.max(0, j.attempt - 1), 0),
      recoveredJobId: interruptedLease.id,
      recoveredAttempt: rows.find(j => j.id === interruptedLease.id)?.attempt,
      queueP50Ms: percentile(waits, 0.5),
      queueP95Ms: percentile(waits, 0.95),
      queueMaxMs: Math.max(...waits),
      cpuMaxMs: Math.max(...rows.map(j => (j.publicResult as { timeMs: number }).timeMs)),
      memoryMaxKb: Math.max(...rows.map(j => (j.publicResult as { memoryKb: number }).memoryKb)),
      solveCount: solves,
      policyHash: runtime.policyHash,
      notes,
    })
  )
  assert.equal(rows.length, 1000)
  assert.equal(totals.ACCEPTED, 1000)
  assert.equal(solves, 334)
  const version2 = await post(0, '/staff/versions', {
    slug: 'real-judge-sum',
    package: { ...p, title: 'Real judge sum second version' },
  })
  const saved2 = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: version2.id } })
  const validation2 = await post(0, `/staff/versions/${saved2.id}/validate`, {})
  await Promise.all(validation2.jobs.map((j: { id: string }) => terminal(j.id)))
  await until(async () =>
    (await prisma.practiceVersion.findUniqueOrThrow({ where: { id: saved2.id } })).status ===
    'VALIDATED'
      ? true
      : null
  )
  await Promise.all(
    [0, 1].map(() =>
      post(1, `/staff/versions/${saved2.id}/publish`, {
        rightsConfirmed: true,
        rightsBasis: p.rightsBasis,
        packageHash: saved2.packageHash,
      })
    )
  )
  assert.equal(
    (await prisma.practiceVersion.findUniqueOrThrow({ where: { id: v.id } })).status,
    'WITHDRAWN'
  )
  await post(2, '/submit', { ...body, idempotencyKey: randomUUID() }, 404)
  const updated = await post(2, '/submit', {
    ...body,
    versionId: saved2.id,
    idempotencyKey: randomUUID(),
  })
  assert.equal((await terminal(updated.id)).verdict, 'ACCEPTED')
  assert.equal(
    await prisma.practiceSolve.count({ where: { ownerId: users[2]!.id, problemId: v.problemId } }),
    1
  )
  await post(1, `/staff/versions/${saved2.id}/withdraw`, {
    reason: 'Acceptance withdrawal preserves historical evidence.',
  })
  await post(2, '/submit', { ...body, idempotencyKey: randomUUID() }, 404)
  assert.equal((await post(2, '/submit', body)).id, a.id)
  console.log('PASS: real judge API journeys and 1000 queued executions; no synthetic acceptance.')
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 1000))
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  await app.close()
  await prisma.$disconnect()
}
