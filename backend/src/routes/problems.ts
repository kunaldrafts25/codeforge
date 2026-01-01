import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { optionalAuth } from '../middleware/auth.js'
import type { Prisma } from '@prisma/client'

const router = Router()

// Query params interface
interface ProblemQueryParams {
  page?: string
  limit?: string
  difficulty?: string
  tag?: string
  search?: string
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = '1', limit = '20', difficulty, tag, search } = req.query as ProblemQueryParams
    const skip = (Number(page) - 1) * Number(limit)

    const where: Prisma.ProblemWhereInput = { isPublic: true }

    if (difficulty && difficulty !== 'all') {
      const diffMap: Record<string, [number, number]> = {
        easy: [1, 2],
        medium: [3, 5],
        hard: [6, 8],
        expert: [9, 10],
      }
      const range = diffMap[difficulty]
      if (range) {
        where.difficulty = { gte: range[0], lte: range[1] }
      }
    }

    if (tag) {
      where.tags = { has: tag }
    }

    if (search) {
      where.title = { contains: search, mode: 'insensitive' }
    }

    const [problems, total] = await Promise.all([
      prisma.problem.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          title: true,
          difficulty: true,
          tags: true,
          solveCount: true,
          attemptCount: true,
        },
      }),
      prisma.problem.count({ where }),
    ])

    res.json({
      problems,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Failed to fetch problems: ${error}\n`)
    res.status(500).json({ message: 'Failed to fetch problems' })
  }
})

router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    const problem = await prisma.problem.findUnique({
      where: { slug: req.params.slug },
      include: {
        testCases: {
          where: { isSample: true },
          orderBy: { orderIndex: 'asc' },
          select: { input: true, expectedOutput: true },
        },
      },
    })

    if (!problem || (!problem.isPublic && req.user?.role === 'USER')) {
      return res.status(404).json({ message: 'Problem not found' })
    }

    res.json({
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      description: problem.description,
      inputFormat: problem.inputFormat,
      outputFormat: problem.outputFormat,
      constraints: problem.constraints,
      difficulty: problem.difficulty,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      tags: problem.tags,
      samples: problem.testCases.map(tc => ({
        input: tc.input,
        output: tc.expectedOutput,
      })),
      solveCount: problem.solveCount,
      attemptCount: problem.attemptCount,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Failed to fetch problem: ${error}\n`)
    res.status(500).json({ message: 'Failed to fetch problem' })
  }
})

export default router
