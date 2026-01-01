import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { auth, requireRole } from '../middleware/auth.js'
import type { Prisma, Role } from '@prisma/client'

const router = Router()

router.use(auth)
router.use(requireRole('ADMIN', 'SUPER_ADMIN', 'PROBLEM_SETTER'))

// Input types for test cases
interface TestCaseInput {
  input: string
  expectedOutput: string
  isSample?: boolean
}

// Input types for contest problems
interface ContestProblemInput {
  problemId: string
  label: string
  points?: number
}

// Prisma error type for unique constraint violations
interface PrismaError extends Error {
  code?: string
}

router.get('/stats', async (_req, res) => {
  try {
    const [users, problems, contests, submissions] = await Promise.all([
      prisma.user.count(),
      prisma.problem.count(),
      prisma.contest.count(),
      prisma.submission.count(),
    ])

    res.json({ users, problems, contests, submissions })
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch stats' })
  }
})

router.get('/problems', async (_req, res) => {
  try {
    const problems = await prisma.problem.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        difficulty: true,
        isPublic: true,
        solveCount: true,
        createdAt: true,
      },
    })

    res.json(problems)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch problems' })
  }
})

router.post('/problems', async (req, res) => {
  try {
    const {
      title,
      slug,
      description,
      inputFormat,
      outputFormat,
      constraints,
      difficulty,
      timeLimit,
      memoryLimit,
      tags,
      testCases,
    } = req.body as {
      title: string
      slug: string
      description: string
      inputFormat: string
      outputFormat: string
      constraints: string
      difficulty?: number
      timeLimit?: number
      memoryLimit?: number
      tags?: string[]
      testCases?: TestCaseInput[]
    }

    const testCaseData: Prisma.TestCaseCreateWithoutProblemInput[] = (testCases || []).map(
      (tc, i) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isSample: tc.isSample || false,
        orderIndex: i,
      })
    )

    const problem = await prisma.problem.create({
      data: {
        title,
        slug,
        description,
        inputFormat,
        outputFormat,
        constraints,
        difficulty: difficulty || 5,
        timeLimit: timeLimit || 2000,
        memoryLimit: memoryLimit || 262144,
        tags: tags || [],
        authorId: req.user?.id ?? '',
        testCases: {
          create: testCaseData,
        },
      },
    })

    res.status(201).json(problem)
  } catch (err) {
    const prismaErr = err as PrismaError
    process.stderr.write(`Create problem error: ${prismaErr.message}\n`)
    if (prismaErr.code === 'P2002') {
      return res.status(400).json({ message: 'Slug already exists' })
    }
    res.status(500).json({ message: 'Failed to create problem' })
  }
})

router.patch('/problems/:id', async (req, res) => {
  try {
    const {
      title,
      description,
      inputFormat,
      outputFormat,
      constraints,
      difficulty,
      timeLimit,
      memoryLimit,
      tags,
      isPublic,
    } = req.body as {
      title?: string
      description?: string
      inputFormat?: string
      outputFormat?: string
      constraints?: string
      difficulty?: number
      timeLimit?: number
      memoryLimit?: number
      tags?: string[]
      isPublic?: boolean
    }

    const problem = await prisma.problem.update({
      where: { id: req.params.id },
      data: {
        title,
        description,
        inputFormat,
        outputFormat,
        constraints,
        difficulty,
        timeLimit,
        memoryLimit,
        tags,
        isPublic,
      },
    })

    res.json(problem)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to update problem' })
  }
})

router.post('/problems/:id/publish', async (req, res) => {
  try {
    const problem = await prisma.problem.update({
      where: { id: req.params.id },
      data: { isPublic: true },
    })

    res.json(problem)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to publish problem' })
  }
})

router.get('/contests', async (_req, res) => {
  try {
    const contests = await prisma.contest.findMany({
      orderBy: { startTime: 'desc' },
      include: { _count: { select: { participants: true, problems: true } } },
    })

    res.json(contests)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch contests' })
  }
})

router.post('/contests', async (req, res) => {
  try {
    const { title, slug, description, startTime, endTime, isRated, problems } = req.body as {
      title: string
      slug: string
      description: string
      startTime: string
      endTime: string
      isRated?: boolean
      problems?: ContestProblemInput[]
    }

    const problemData = (problems || []).map(p => ({
      problem: { connect: { id: p.problemId } },
      label: p.label,
      points: p.points || 100,
    }))

    const contest = await prisma.contest.create({
      data: {
        title,
        slug,
        description,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        isRated: isRated || false,
        status: 'SCHEDULED',
        problems: {
          create: problemData,
        },
      },
    })

    res.status(201).json(contest)
  } catch (err) {
    const prismaErr = err as PrismaError
    process.stderr.write(`Create contest error: ${prismaErr.message}\n`)
    if (prismaErr.code === 'P2002') {
      return res.status(400).json({ message: 'Slug already exists' })
    }
    res.status(500).json({ message: 'Failed to create contest' })
  }
})

router.get('/users', requireRole('ADMIN', 'SUPER_ADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        rating: true,
        isBanned: true,
        createdAt: true,
      },
    })

    res.json(users)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch users' })
  }
})

router.patch('/users/:id/role', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { role } = req.body as { role: Role }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
    })

    res.json(user)
  } catch (_err) {
    res.status(500).json({ message: 'Failed to update role' })
  }
})

export default router
