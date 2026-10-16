/* eslint-disable no-console -- Emit bounded acceptance metadata; never credentials or private payloads. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { prisma, enqueueContestSubmission, type Prisma } from '@codeforge/db'
import { PracticePackage } from '@codeforge/shared'
import { buildApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/tokens.js'
import { ACCESS_COOKIE } from '../src/auth/cookies.js'
import { computeScoreboard, type ContestSubmissionEvent } from '../src/contests/scoring.js'
import { hash, canonical } from '../src/practice/package.js'

const url = new URL(process.env.DATABASE_URL ?? '')
if (
  process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/^\/phase2_[a-f0-9]{32}$/.test(url.pathname) ||
  url.username !== 'phase2'
) {
  throw new Error('Fresh disposable database required for Phase 3 judge verification')
}
if (process.env.FORGE_PRACTICE_ENABLED !== '1') {
  throw new Error('Real judge admission must be explicitly enabled (FORGE_PRACTICE_ENABLED=1)')
}

const app = await buildApp()
app.log.level = 'fatal'

const children: ChildProcess[] = []
const root = fileURLToPath(new URL('../../../', import.meta.url))
const notes: Record<string, unknown>[] = []

function startWorker(stage = '', jobId = '') {
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
  let startupDiagnostic = 'unavailable'
  child.stdout!.on('data', (data: Buffer) => {
    pending += data.toString('utf8')
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (['judge.ready', 'judge.fault_rendezvous'].includes(String(parsed.event))) {
          notes.push({ ...parsed, pid: child.pid })
        }
      } catch {
        /* ignore non-json logs */
      }
    }
  })

  child.stderr!.on('data', (data: Buffer) => {
    const text = data.toString('utf8')
    const known = text.match(
      /Error: (Trusted Docker control (?:failed|timeout)[^\r\n]{0,320}|Supervisor integrity mismatch|Pinned runsc mismatch|Toolchain version mismatch|Isolation probe failed|Guest process ceiling verification failed: [^\r\n]{0,320})/
    )
    if (known) startupDiagnostic = known[1]!
    const databaseCode = text.match(/code: ['"](P\d{4})['"]/)
    if (databaseCode) startupDiagnostic = databaseCode[1]!
  })

  child.on('exit', (code, signal) => {
    if (code !== 0 && signal === null) {
      console.log(JSON.stringify({ event: 'judge.worker_exit', code, startupDiagnostic }))
    }
  })

  children.push(child)
  return child
}

async function stopWorker(child: ChildProcess, crash = false) {
  if (child.exitCode !== null) return
  child.kill(crash ? 'SIGKILL' : 'SIGTERM')
  await until(
    async () => (child.exitCode !== null || child.signalCode !== null ? true : null),
    10000
  )
}

async function until<T>(fn: () => Promise<T | null>, timeout = 180000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('Real judge verification timed out')
}

async function readyWorker(child: ChildProcess) {
  await until(async () => {
    if (notes.some(n => n.event === 'judge.ready' && n.pid === child.pid)) return true
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Judge worker exited before verified readiness')
    return null
  })
}
const progress = (stage: string) =>
  console.log(JSON.stringify({ event: 'phase3.acceptance_stage', stage }))

async function waitForTerminal(jobId: string) {
  return until(async () => {
    const j = await prisma.practiceJob.findUniqueOrThrow({ where: { id: jobId } })
    return ['TERMINAL', 'DEAD_LETTER', 'CANCELLED'].includes(j.state) ? j : null
  })
}

// All verdicts and validation artifacts below are written by the real worker.
// Direct DB writes only provision accounts and advance the disposable contest clock.
const runId = randomUUID().replaceAll('-', '').slice(0, 8)
const languages = ['cpp', 'python', 'java', 'javascript'] as const
const sum: Record<string, string> = {
  cpp: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}',
  python: 'a,b=map(int,input().split());print(a+b)',
  java: 'public class Main {public static void main(String[] args){java.util.Scanner s=new java.util.Scanner(System.in);System.out.print(s.nextInt()+s.nextInt());}}',
  javascript:
    'const a=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);console.log(a[0]+a[1]);',
}
const product: Record<string, string> = {
  cpp: 'class Solution{public:int solve(int a,int b){return a*b;}};',
  python: 'class Solution:\n def solve(self,a,b):\n  return a*b',
  java: 'class Solution{public int solve(int a,int b){return a*b;}}',
  javascript: 'function solve(a,b){return a*b;}',
}
const failures = [
  { verdict: 'WRONG_ANSWER', code: 'print(0)' },
  { verdict: 'COMPILATION_ERROR', code: 'def broken(:' },
  { verdict: 'RUNTIME_ERROR', code: 'raise RuntimeError("fixture")' },
  { verdict: 'TIME_LIMIT', code: 'while True: pass' },
  { verdict: 'MEMORY_LIMIT', code: 'x=bytearray(512*1024*1024);print(len(x))' },
  { verdict: 'OUTPUT_LIMIT', code: 'while True: print("overflow"*8192)' },
]
try {
  progress('bootstrap')
  const bootstrapWorker = startWorker()
  await readyWorker(bootstrapWorker)
  const runtime = await until(() =>
    prisma.practiceJudgeRuntime.findFirst({ where: { expiresAt: { gt: new Date() } } })
  )
  const policy = runtime.policy as Prisma.InputJsonObject
  assert.equal(hash(canonical(policy)), runtime.policyHash)
  const users = await Promise.all(
    Array.from({ length: 22 }, (_, i) =>
      prisma.user.create({
        data: {
          email: `p3-real-${runId}-${i}@example.test`,
          username: `p3_real_${runId}_${i}`,
          role: i === 0 ? 'ADMIN' : i === 1 ? 'REVIEWER' : 'USER',
          emailVerifiedAt: new Date(),
          rating: 1500,
          maxRating: 1500,
        },
      })
    )
  )
  const sessions = await Promise.all(
    users.map(u =>
      prisma.userSession.create({
        data: {
          userId: u.id,
          refreshTokenHash: hash(randomUUID()),
          expiresAt: new Date(Date.now() + 7200000),
          ipAddress: '127.0.0.1',
          userAgent: 'phase3-real-judge',
        },
      })
    )
  )
  const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
  const csrfCookie = csrf.cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const request = async (
    i: number,
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    expected = 200
  ) => {
    const u = users[i]!
    const token = signAccessToken({
      sub: u.id,
      sid: sessions[i]!.id,
      username: u.username,
      role: u.role,
    })
    const res = await app.inject({
      method,
      remoteAddress: `127.0.0.${i + 1}`,
      url: `/api${path}`,
      headers: {
        cookie: `${ACCESS_COOKIE}=${token}; ${csrfCookie}`,
        'x-csrf-token': csrf.json().csrfToken,
      },
      payload: payload as Record<string, unknown>,
    })
    assert.equal(res.statusCode, expected, `${path}: ${res.body}`)
    return res.json()
  }
  progress('real-package-validation')
  const versions = []
  for (const functional of [false, true]) {
    const pkg = PracticePackage.parse({
      title: functional ? 'Real functional product' : 'Real standard sum',
      statementMd: 'Compute the original arithmetic result.',
      constraints: 'Integers between -100 and 100',
      inputFormat: functional ? 'JSON argument array' : 'Two integers',
      outputFormat: 'Integer result',
      difficultyBand: 'easy',
      tags: ['math'],
      mode: functional ? 'FUNCTIONAL' : 'STDIO',
      signature: functional
        ? {
            name: 'solve',
            params: [
              { name: 'a', type: { kind: 'prim', name: 'int' } },
              { name: 'b', type: { kind: 'prim', name: 'int' } },
            ],
            returns: { kind: 'prim', name: 'int' },
          }
        : null,
      languages: [...languages],
      limits: { timeMs: 2000, memoryKb: 65536, outputKb: 4 },
      checker: { kind: 'token' },
      cases: functional
        ? [
            { input: '[3,4]', output: '12', sample: true },
            { input: '[5,6]', output: '30', sample: false },
          ]
        : [
            { input: '2 3', output: '5', sample: true },
            { input: '10 -4', output: '6', sample: false },
          ],
      references: [
        { language: 'python', code: (functional ? product : sum).python!, complexity: 'O(1)' },
      ],
      starters: functional ? product : sum,
      rightsBasis: 'Original CodeForge operational acceptance asset',
    })
    const created = await request(0, 'POST', '/practice/staff/versions', {
      slug: `p3-real-${functional ? 'function' : 'stdio'}-${runId}`,
      package: pkg,
    })
    const validation = await request(
      0,
      'POST',
      `/practice/staff/versions/${created.id}/validate`,
      {}
    )
    for (const job of validation.jobs)
      assert.equal((await waitForTerminal(job.id)).verdict, 'ACCEPTED')
    const v = await until(async () => {
      const row = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: created.id } })
      return row.status === 'VALIDATED' ? row : null
    })
    assert.equal((v.validation as Record<string, unknown>).executed, true)
    await request(1, 'POST', `/practice/staff/versions/${v.id}/publish`, {
      rightsConfirmed: true,
      rightsBasis: pkg.rightsBasis,
      packageHash: v.packageHash,
    })
    versions.push(v)
  }
  progress('registration')
  // Register through public API before the authoritative start boundary.
  const now = Date.now()
  const draft = await request(0, 'POST', '/contests/staff/drafts', {
    title: `P3 real ${runId}`,
    slug: `p3-real-${runId}`,
    description: 'Real isolated judging acceptance',
    format: 'ICPC',
    startTime: new Date(now + 600000).toISOString(),
    endTime: new Date(now + 7200000).toISOString(),
    registrationOpensAt: new Date(now - 60000).toISOString(),
    registrationClosesAt: new Date(now + 600000).toISOString(),
    freezeAt: new Date(now + 3600000).toISOString(),
    capacity: 20,
    isRated: true,
    problems: versions.map((v, i) => ({
      label: i ? 'B' : 'A',
      problemId: v.problemId,
      versionId: v.id,
      points: 100,
    })),
  })
  const contest = await prisma.contest.findUniqueOrThrow({
    where: { slug: `p3-real-${runId}` },
    include: { activeManifest: true },
  })
  await request(1, 'POST', `/contests/staff/${contest.id}/seal`, {
    rightsConfirmed: true,
    manifestHash: draft.manifestHash,
  })
  for (let i = 2; i < 22; i++) await request(i, 'POST', `/contests/${contest.slug}/register`, {})
  const contestStart = new Date(Date.now() - 60000)
  await prisma.contest.update({
    where: { id: contest.id },
    data: { startTime: contestStart, status: 'RUNNING' },
  })
  await stopWorker(bootstrapWorker)
  const admitted: {
    id: string
    jobId: string
    verdict: string
    language: string
    label: string
  }[] = []
  const submit = async (
    i: number,
    label: string,
    language: string,
    code: string,
    verdict: string
  ) => {
    const r = await request(i, 'POST', `/contests/${contest.slug}/submit`, {
      problemLabel: label,
      language,
      code,
      idempotencyKey: randomUUID(),
    })
    const item = { id: r.id, jobId: r.jobId, verdict, language, label }
    assert.ok(item.jobId, 'Submission response includes job ID')
    admitted.push(item)
    return item
  }
  // Only the fault worker exists while this job is admitted: no competing lease can steal it.
  const crashAdmission = await enqueueContestSubmission(prisma, {
    contestId: contest.id,
    userId: users[2]!.id,
    problemLabel: 'A',
    language: 'python',
    source: sum.python!,
    idempotencyKey: randomUUID(),
    policy,
  })
  assert.ok(crashAdmission.job)
  const crashed = {
    id: crashAdmission.submission.id,
    jobId: crashAdmission.job.id,
    verdict: 'ACCEPTED',
    language: 'python',
    label: 'A',
  }
  admitted.push(crashed)
  progress('crash-rendezvous')
  const doomed = startWorker('after_compile', crashed.jobId)
  await until(async () =>
    notes.some(n => n.id === crashed.jobId && n.stage === 'after_compile') ? true : null
  )
  const leased = await prisma.practiceJob.findUniqueOrThrow({ where: { id: crashed.jobId } })
  assert.equal(leased.state, 'RUNNING')
  await stopWorker(doomed, true)
  progress('lease-recovery')
  await readyWorker(startWorker())
  const recovered = await waitForTerminal(crashed.jobId)
  assert.equal(recovered.state, 'TERMINAL')
  assert.equal(recovered.verdict, 'ACCEPTED')
  assert.ok(recovered.attempt > leased.attempt, 'Recovery must acquire a new attempt')
  assert.ok(recovered.fence > leased.fence, 'Recovered job fences the crashed worker')
  await readyWorker(startWorker())
  // Five rounds keep each competitor below the three-active-job quota.
  for (let round = 0; round < 5; round++) {
    progress(`round-${round + 1}`)
    const batch = []
    for (let c = 0; c < 20; c++) {
      if (round === 0 && c === 0) continue
      const language = languages[c % 4]!
      const label = round % 2 ? 'B' : 'A'
      const failure = round === 0 && c <= 6 ? failures[c - 1] : null
      batch.push(
        await submit(
          c + 2,
          label,
          failure ? 'python' : language,
          failure?.code ?? (label === 'A' ? sum : product)[language]!,
          failure?.verdict ?? 'ACCEPTED'
        )
      )
    }
    for (const item of batch) {
      const job = await waitForTerminal(item.jobId)
      assert.equal(job.state, 'TERMINAL')
      assert.equal(job.verdict, item.verdict, `${item.label}/${item.language} intended verdict`)
      assert.equal(
        (job.privateResult as Record<string, unknown>)?.executed,
        true,
        'Real runner evidence required'
      )
      const sub = await prisma.contestSubmission.findUniqueOrThrow({ where: { id: item.id } })
      assert.equal(sub.state, 'TERMINAL')
      assert.equal(sub.verdict, job.verdict)
    }
  }
  assert.equal(admitted.length, 100)
  assert.equal(
    await prisma.practiceSolve.count({ where: { ownerId: { in: users.slice(2).map(u => u.id) } } }),
    0
  )
  for (const label of ['A', 'B'])
    for (const language of languages)
      assert.ok(
        admitted.some(j => j.label === label && j.language === language && j.verdict === 'ACCEPTED')
      )
  const standings = await request(2, 'GET', `/contests/${contest.slug}/leaderboard?limit=100`)
  assert.equal(standings.entries.length, 20)
  const live = computeScoreboard(
    (await prisma.contestSubmission.findMany({
      where: { contestId: contest.id, isAuthoritative: true },
    })) as ContestSubmissionEvent[],
    {
      startTime: contestStart,
      problemLabels: ['A', 'B'],
      participants: users.slice(2).map(u => ({ ...u, userId: u.id, status: 'REGISTERED' })),
    }
  )
  assert.deepEqual(
    standings.entries.map((e: { userId: string; rank: number; score: number; penalty: number }) => [
      e.userId,
      e.rank,
      e.score,
      e.penalty,
    ]),
    live.entries.map(e => [e.userId, e.rank, e.score, e.penalty])
  )
  console.log(
    JSON.stringify({
      event: 'phase3.real_judge_passed',
      competitors: 20,
      submissions: 100,
      languages: 4,
      modes: 2,
      crash: {
        jobId: crashed.jobId,
        oldFence: leased.fence,
        newFence: recovered.fence,
        attempts: recovered.attempt,
      },
      verdicts: admitted.reduce<Record<string, number>>(
        (acc, j) => ((acc[j.verdict] = (acc[j.verdict] ?? 0) + 1), acc),
        {}
      ),
    })
  )
} finally {
  for (const child of children) await stopWorker(child).catch(() => undefined)
  await app.close()
  await prisma.$disconnect()
}
