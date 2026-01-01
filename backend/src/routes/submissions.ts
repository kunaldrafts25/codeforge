import { Router } from 'express'
import axios, { type AxiosError } from 'axios'
import { prisma } from '../lib/prisma.js'
import { auth } from '../middleware/auth.js'
import { io } from '../app.js'
import type { Problem, TestCase, Verdict } from '@prisma/client'

const router = Router()

// Piston API - FREE, no limits, no API key needed!
const PISTON_URL = 'https://emkc.org/api/v2/piston'

// Language mapping for Piston
const LANG_CONFIG: Record<string, { language: string; version: string }> = {
  cpp: { language: 'cpp', version: '10.2.0' },
  c: { language: 'c', version: '10.2.0' },
  python: { language: 'python', version: '3.10.0' },
  java: { language: 'java', version: '15.0.2' },
  javascript: { language: 'javascript', version: '18.15.0' },
}

// Type for problem with test cases
interface ProblemWithTestCases extends Problem {
  testCases: TestCase[]
}

// Piston API response types
interface PistonRunResult {
  stdout?: string
  stderr?: string
  code?: number
  signal?: string
  output?: string
}

interface PistonResponse {
  compile?: PistonRunResult
  run?: PistonRunResult
}

// Verdict type that matches Prisma enum
type SubmissionVerdict =
  | 'PENDING'
  | 'RUNNING'
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'TIME_LIMIT'
  | 'RUNTIME_ERROR'
  | 'COMPILATION_ERROR'
  | 'MEMORY_LIMIT'

router.post('/', auth, async (req, res) => {
  try {
    const { problemId, language, code, contestId } = req.body as {
      problemId: string
      language: string
      code: string
      contestId?: string
    }

    if (!problemId || !language || !code) {
      return res.status(400).json({ message: 'Missing fields' })
    }

    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
    })

    if (!problem) {
      return res.status(404).json({ message: 'Problem not found' })
    }

    const submission = await prisma.submission.create({
      data: {
        userId: req.user?.id ?? '',
        problemId,
        contestId: contestId || null,
        language,
        code,
        testsTotal: problem.testCases.length,
      },
    })

    await prisma.problem.update({
      where: { id: problemId },
      data: { attemptCount: { increment: 1 } },
    })

    // Process submission asynchronously
    processSubmission(submission.id, problem, code, language)

    res.status(201).json({ id: submission.id })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Submission error: ${error}\n`)
    res.status(500).json({ message: 'Submission failed' })
  }
})

async function processSubmission(
  submissionId: string,
  problem: ProblemWithTestCases,
  code: string,
  language: string
): Promise<void> {
  try {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { verdict: 'RUNNING' },
    })

    io.to(`submission:${submissionId}`).emit('submission:status', {
      submissionId,
      verdict: 'running',
      testCasesPassed: 0,
      totalTestCases: problem.testCases.length,
    })

    const langConfig = LANG_CONFIG[language] || LANG_CONFIG.python
    let passed = 0
    let verdict: SubmissionVerdict = 'ACCEPTED'
    let execTime = 0
    let memUsed = 0

    for (let testIndex = 0; testIndex < problem.testCases.length; testIndex++) {
      const tc = problem.testCases[testIndex]

      try {
        process.stdout.write(`Running test case ${testIndex + 1}/${problem.testCases.length}...\n`)

        const startTime = Date.now()

        const response = await axios.post<PistonResponse>(
          `${PISTON_URL}/execute`,
          {
            language: langConfig.language,
            version: langConfig.version,
            files: [{ content: code }],
            stdin: tc.input,
            run_timeout: problem.timeLimit,
          },
          { timeout: 30000 }
        )

        const endTime = Date.now()
        const result = response.data

        process.stdout.write(
          `Test case ${testIndex + 1} result: ${result.run?.code ?? 'N/A'} ${result.run?.stderr ? 'has stderr' : 'ok'}\n`
        )

        // Check for compilation error
        if (result.compile && result.compile.code !== 0) {
          verdict = 'COMPILATION_ERROR'
          process.stdout.write(
            `Compilation error: ${result.compile.stderr || result.compile.output}\n`
          )
          break
        }

        // Check for runtime error
        if (result.run?.code !== 0 && result.run?.stderr) {
          verdict = 'RUNTIME_ERROR'
          process.stdout.write(`Runtime error: ${result.run.stderr}\n`)
          break
        }

        // Check for timeout
        if (result.run?.signal === 'SIGKILL') {
          verdict = 'TIME_LIMIT'
          break
        }

        // Compare output
        const actualOutput = (result.run?.stdout || '').trim()
        const expectedOutput = tc.expectedOutput.trim()

        if (actualOutput === expectedOutput) {
          passed++
          execTime = Math.max(execTime, endTime - startTime)
          // Piston doesn't report memory, estimate based on language
          memUsed = Math.max(memUsed, language === 'java' ? 50000 : 10000)
        } else {
          verdict = 'WRONG_ANSWER'
          process.stdout.write('Wrong answer.\n')
          process.stdout.write(`Expected: ${JSON.stringify(expectedOutput)}\n`)
          process.stdout.write(`Got: ${JSON.stringify(actualOutput)}\n`)
          break
        }

        io.to(`submission:${submissionId}`).emit('submission:status', {
          submissionId,
          verdict: 'running',
          testCasesPassed: passed,
          totalTestCases: problem.testCases.length,
        })
      } catch (err) {
        const axiosErr = err as AxiosError
        const errorMessage = axiosErr.message || 'Unknown Piston error'
        process.stderr.write(`Piston error: ${errorMessage}\n`)
        verdict = 'WRONG_ANSWER'
        break
      }
    }

    if (passed === problem.testCases.length) {
      verdict = 'ACCEPTED'

      await prisma.problem.update({
        where: { id: problem.id },
        data: { solveCount: { increment: 1 } },
      })

      const sub = await prisma.submission.findUnique({ where: { id: submissionId } })
      if (sub) {
        const prevAccepted = await prisma.submission.count({
          where: {
            userId: sub.userId,
            problemId: problem.id,
            verdict: 'ACCEPTED',
          },
        })

        if (prevAccepted === 0) {
          await prisma.user.update({
            where: { id: sub.userId },
            data: { problemsSolved: { increment: 1 } },
          })
        }
      }
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: verdict as Verdict,
        testsPassed: passed,
        executionTime: Math.round(execTime),
        memoryUsed: Math.round(memUsed),
      },
    })

    io.to(`submission:${submissionId}`).emit('submission:verdict', {
      submissionId,
      verdict: verdict.toLowerCase(),
      testCasesPassed: passed,
      totalTestCases: problem.testCases.length,
      executionTime: Math.round(execTime),
      memoryUsed: Math.round(memUsed),
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Process submission error: ${error}\n`)

    await prisma.submission.update({
      where: { id: submissionId },
      data: { verdict: 'WRONG_ANSWER' },
    })

    io.to(`submission:${submissionId}`).emit('submission:verdict', {
      submissionId,
      verdict: 'error',
      message: 'Judging failed',
    })
  }
}

router.get('/:id', auth, async (req, res) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: req.params.id },
      include: {
        problem: { select: { slug: true, title: true } },
      },
    })

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' })
    }

    const userId = req.user?.id ?? ''
    const userRole = req.user?.role ?? 'USER'

    if (submission.userId !== userId && userRole === 'USER') {
      return res.status(403).json({ message: 'Access denied' })
    }

    res.json(submission)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch submission' })
  }
})

export default router
