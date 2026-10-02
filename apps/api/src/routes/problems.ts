import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Prisma } from '@codeforge/db'
import { prisma, Prisma as Sql } from '@codeforge/db'
import {
  ProblemDetailResponse,
  ProblemListQuery,
  ProblemListResponse,
  ProblemSlugParam,
} from '@codeforge/shared'
import { notFound } from '../errors.js'
import { loadConfig } from '../config.js'
import { readSample } from '../practice/sample-store.js'

const config = loadConfig()

function readBlob(key: string): string {
  return readSample(config.SEED_BLOB_ROOT, key)
}

export const problemRoutes: FastifyPluginAsyncZod = async app => {
  app.get(
    '/',
    {
      schema: {
        tags: ['problems'],
        querystring: ProblemListQuery,
        response: { 200: ProblemListResponse },
      },
    },
    async request => {
      const { page, limit, difficulty, tag, search } = request.query
      const skip = (page - 1) * limit

      const where: Prisma.ProblemWhereInput = { isPublic: true, status: 'PUBLISHED' }
      if (difficulty !== 'all') where.difficultyBand = difficulty
      if (tag) where.tags = { has: tag }
      if (search) where.title = { contains: search, mode: 'insensitive' }

      const [problems, total] = await Promise.all([
        prisma.problem.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            slug: true,
            title: true,
            difficultyBand: true,
            rating: true,
            tags: true,
            totalAccepted: true,
            totalSubmissions: true,
            acceptanceRate: true,
          },
        }),
        prisma.problem.count({ where }),
      ])

      const stats = problems.length
        ? await prisma.$queryRaw<{ problemId: string; total: bigint; accepted: bigint }[]>(Sql.sql`
        SELECT "problemId", count(*) AS total, count(*) FILTER (WHERE verdict='ACCEPTED') AS accepted FROM (
          SELECT DISTINCT ON (COALESCE(j."originJobId",j.id)) v."problemId", j.verdict
          FROM "PracticeJob" j JOIN "PracticeVersion" v ON v.id=j."versionId"
          WHERE v."problemId" IN (${Sql.join(problems.map(p => p.id))}) AND j.kind='SUBMIT' AND j.scope='PRACTICE' AND j.state='TERMINAL'
          ORDER BY COALESCE(j."originJobId",j.id), j.generation DESC
        ) latest GROUP BY "problemId"`)
        : []
      return {
        problems: problems.map(p => {
          const s = stats.find(s => s.problemId === p.id)
          return s
            ? {
                ...p,
                totalSubmissions: Number(s.total),
                totalAccepted: Number(s.accepted),
                acceptanceRate: (Number(s.accepted) / Number(s.total)) * 100,
              }
            : p
        }),
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      }
    }
  )

  app.get(
    '/:slug',
    {
      schema: {
        tags: ['problems'],
        params: ProblemSlugParam,
        response: { 200: ProblemDetailResponse },
      },
    },
    async request => {
      const problem = await prisma.problem.findUnique({
        where: { slug: request.params.slug },
        include: {
          tests: {
            where: { isSample: true },
            orderBy: { orderIndex: 'asc' },
            select: {
              inputBlobKey: true,
              outputBlobKey: true,
              explanationMd: true,
            },
          },
        },
      })

      const canPreview =
        request.user &&
        ['ADMIN', 'SUPER_ADMIN', 'PROBLEM_SETTER', 'REVIEWER'].includes(request.user.role)
      if (!problem || ((!problem.isPublic || problem.status !== 'PUBLISHED') && !canPreview)) {
        throw notFound('PROBLEM_NOT_FOUND', 'Problem not found')
      }

      return {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        statementMd: problem.statementMd,
        inputFormat: problem.inputFormat,
        outputFormat: problem.outputFormat,
        constraints: problem.constraints,
        difficultyBand: problem.difficultyBand,
        rating: problem.rating,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitKb: problem.memoryLimitKb,
        tags: problem.tags,
        samples: problem.tests.map(t => ({
          input: readBlob(t.inputBlobKey),
          output: readBlob(t.outputBlobKey),
          explanation: t.explanationMd,
        })),
        totalAccepted: problem.totalAccepted,
        totalSubmissions: problem.totalSubmissions,
        judgeMode: problem.judgeMode,
      }
    }
  )
}
