import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CreateSubmissionBody, SubmissionIdParam, SubmissionResponse } from '@codeforge/shared'
import type { ProblemTest, Verdict } from '@codeforge/db'
import { prisma } from '@codeforge/db'
import { loadConfig } from '../config.js'
import { logger } from '../logger.js'
import { forbidden, notFound } from '../errors.js'
import { emitToSubmission } from '../sockets.js'

const config = loadConfig()

const LANG_CONFIG: Record<string, { language: string; version: string }> = {
  cpp: { language: 'cpp', version: '10.2.0' },
  c: { language: 'c', version: '10.2.0' },
  python: { language: 'python', version: '3.10.0' },
  java: { language: 'java', version: '15.0.2' },
  javascript: { language: 'javascript', version: '18.15.0' },
}

interface PistonRunResult {
  stdout?: string
  stderr?: string
  code?: number
  signal?: string
}

interface PistonResponse {
  compile?: PistonRunResult
  run?: PistonRunResult
}

function blobPath(key: string): string {
  return join(config.SEED_BLOB_ROOT, key)
}

function readBlob(key: string): string {
  return readFileSync(blobPath(key), 'utf8')
}

function writeCodeBlob(submissionId: string, code: string): string {
  const key = `submissions/${submissionId}.src`
  const target = blobPath(key)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, code, 'utf8')
  return key
}

async function runPiston(
  language: string,
  code: string,
  stdin: string,
  timeoutMs: number
): Promise<PistonResponse> {
  const cfg = LANG_CONFIG[language] ?? LANG_CONFIG.python!
  const res = await fetch(`${config.PISTON_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: cfg.language,
      version: cfg.version,
      files: [{ content: code }],
      stdin,
      run_timeout: timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  })
  if (!res.ok) {
    throw new Error(`Piston HTTP ${res.status}`)
  }
  return (await res.json()) as PistonResponse
}

async function processSubmission(
  submissionId: string,
  tests: ProblemTest[],
  problemId: string,
  code: string,
  language: string,
  timeLimitMs: number
): Promise<void> {
  try {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { verdict: 'RUNNING' },
    })
    emitToSubmission(submissionId, 'submission:status', {
      submissionId,
      verdict: 'running',
      testCasesPassed: 0,
      totalTestCases: tests.length,
    })

    let passed = 0
    let verdict: Verdict = 'ACCEPTED'
    let execTime = 0
    let memUsed = 0

    for (const tc of tests) {
      let input: string
      let expected: string
      try {
        input = readBlob(tc.inputBlobKey)
        expected = readBlob(tc.outputBlobKey).trim()
      } catch (err) {
        logger.error({ err, testIndex: tc.orderIndex }, 'failed reading test blob')
        verdict = 'JUDGE_FAILURE'
        break
      }
      const start = Date.now()
      try {
        const piston = await runPiston(language, code, input, timeLimitMs)
        const elapsed = Date.now() - start

        if (piston.compile && piston.compile.code !== 0) {
          verdict = 'COMPILATION_ERROR'
          break
        }
        if (piston.run?.signal === 'SIGKILL') {
          verdict = 'TIME_LIMIT'
          break
        }
        if (piston.run?.code !== 0 && piston.run?.stderr) {
          verdict = 'RUNTIME_ERROR'
          break
        }

        const actual = (piston.run?.stdout ?? '').trim()
        if (actual !== expected) {
          verdict = 'WRONG_ANSWER'
          break
        }
        passed++
        execTime = Math.max(execTime, elapsed)
        memUsed = Math.max(memUsed, language === 'java' ? 50000 : 10000)
        emitToSubmission(submissionId, 'submission:status', {
          submissionId,
          verdict: 'running',
          testCasesPassed: passed,
          totalTestCases: tests.length,
        })
      } catch (err) {
        logger.error({ err, submissionId, testIndex: tc.orderIndex }, 'Piston call failed')
        verdict = 'JUDGE_FAILURE'
        break
      }
    }

    if (passed === tests.length && verdict === 'ACCEPTED') {
      await prisma.problem.update({
        where: { id: problemId },
        data: {
          totalAccepted: { increment: 1 },
          totalSubmissions: { increment: 1 },
        },
      })
      const sub = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId } })
      const prevAccepted = await prisma.submission.count({
        where: { userId: sub.userId, problemId, verdict: 'ACCEPTED' },
      })
      if (prevAccepted === 0) {
        await prisma.user.update({
          where: { id: sub.userId },
          data: { problemsSolved: { increment: 1 } },
        })
      }
    } else {
      await prisma.problem.update({
        where: { id: problemId },
        data: { totalSubmissions: { increment: 1 } },
      })
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict,
        testsPassed: passed,
        executionTimeMs: Math.round(execTime),
        memoryUsedKb: Math.round(memUsed),
        judgedAt: new Date(),
      },
    })

    emitToSubmission(submissionId, 'submission:verdict', {
      submissionId,
      verdict: verdict.toLowerCase(),
      testCasesPassed: passed,
      totalTestCases: tests.length,
      executionTime: Math.round(execTime),
      memoryUsed: Math.round(memUsed),
    })
  } catch (err) {
    logger.error({ err, submissionId }, 'processSubmission failed')
    await prisma.submission
      .update({ where: { id: submissionId }, data: { verdict: 'JUDGE_FAILURE' } })
      .catch(() => undefined)
    emitToSubmission(submissionId, 'submission:verdict', {
      submissionId,
      verdict: 'judge_failure',
      message: 'Judging failed',
    })
  }
}

export const submissionRoutes: FastifyPluginAsyncZod = async app => {
  app.post(
    '/',
    {
      schema: {
        tags: ['submissions'],
        body: CreateSubmissionBody,
        response: { 201: SubmissionResponse },
      },
      preHandler: [app.requireAuth],
    },
    async (request, reply) => {
      const { problemId, language, code, contestId } = request.body
      const problem = await prisma.problem.findUnique({
        where: { id: problemId },
        include: { tests: { orderBy: { orderIndex: 'asc' } } },
      })
      if (!problem) throw notFound('PROBLEM_NOT_FOUND', 'Problem not found')

      const submissionId = randomUUID()
      const codeBlobKey = writeCodeBlob(submissionId, code)

      const submission = await prisma.submission.create({
        data: {
          id: submissionId,
          userId: request.user!.id,
          problemId,
          contestId: contestId ?? null,
          language,
          codeBlobKey,
          codeSize: Buffer.byteLength(code, 'utf8'),
          testsTotal: problem.tests.length,
        },
      })

      // Fire-and-forget. NOTE: This is a Stage-0 carry-over; A1 will replace
      // it with a durable BullMQ queue.
      void processSubmission(
        submission.id,
        problem.tests,
        problem.id,
        code,
        language,
        problem.timeLimitMs
      )

      return reply.code(201).send({
        id: submission.id,
        problemId: submission.problemId,
        language: submission.language,
        verdict: submission.verdict,
        testsPassed: submission.testsPassed,
        testsTotal: submission.testsTotal,
        executionTimeMs: submission.executionTimeMs,
        memoryUsedKb: submission.memoryUsedKb,
        submittedAt: submission.submittedAt.toISOString(),
      })
    }
  )

  app.get(
    '/:id',
    {
      schema: {
        tags: ['submissions'],
        params: SubmissionIdParam,
        response: { 200: SubmissionResponse },
      },
      preHandler: [app.requireAuth],
    },
    async request => {
      const submission = await prisma.submission.findUnique({
        where: { id: request.params.id },
      })
      if (!submission) throw notFound('SUBMISSION_NOT_FOUND', 'Submission not found')
      if (submission.userId !== request.user!.id && request.user!.role === 'USER') {
        throw forbidden('FORBIDDEN', 'Access denied')
      }
      return {
        id: submission.id,
        problemId: submission.problemId,
        language: submission.language,
        verdict: submission.verdict,
        testsPassed: submission.testsPassed,
        testsTotal: submission.testsTotal,
        executionTimeMs: submission.executionTimeMs,
        memoryUsedKb: submission.memoryUsedKb,
        submittedAt: submission.submittedAt.toISOString(),
      }
    }
  )
}
