import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { Prisma, prisma } from '@codeforge/db'
import { PracticeDraftBody, PracticeJobBody, PracticeRunBody } from '@codeforge/shared'
import { z } from 'zod'
import { conflict, forbidden, HttpError, notFound } from '../errors.js'
import { canonical, executionAvailability, hash, publicPackage } from '../practice/package.js'

const idParam = z.object({ id: z.string().uuid() })
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
const staff = ['PROBLEM_SETTER', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN']
const reviewers = ['REVIEWER', 'ADMIN', 'SUPER_ADMIN']
const operators = ['ADMIN', 'SUPER_ADMIN']
const disabled = () => {
  throw new HttpError(503, 'JUDGE_UNAVAILABLE', executionAvailability().reason)
}

export const practiceRoutes: FastifyPluginAsyncZod = async app => {
  app.get('/capabilities', async () => ({
    ...executionAvailability(),
    languages: ['cpp', 'python', 'java', 'javascript'],
    modes: ['STDIO', 'FUNCTIONAL'],
  }))
  app.post(
    '/runs',
    { schema: { body: PracticeRunBody }, preHandler: [app.requireAuth] },
    async () => disabled()
  )
  app.post(
    '/submit',
    { schema: { body: PracticeJobBody }, preHandler: [app.requireAuth] },
    async () => disabled()
  )

  app.get(
    '/problems/:slug',
    { schema: { params: z.object({ slug: z.string().min(1).max(128) }) } },
    async request => {
      const v = await prisma.practiceVersion.findFirst({
        where: {
          problem: { slug: request.params.slug, status: 'PUBLISHED', isPublic: true },
          status: 'PUBLISHED',
          withdrawnAt: null,
        },
        orderBy: { number: 'desc' },
      })
      if (!v) throw notFound('PROBLEM_NOT_FOUND', 'Published problem not found')
      return { id: v.problemId, versionId: v.id, version: v.number, ...publicPackage(v.package) }
    }
  )

  app.get(
    '/history',
    { schema: { querystring: pageQuery }, preHandler: [app.requireAuth] },
    async request => {
      const { page, limit } = request.query
      const where = { ownerId: request.user!.id, kind: { in: ['RUN', 'SUBMIT'] } }
      const [rows, total] = await Promise.all([
        prisma.practiceJob.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            versionId: true,
            kind: true,
            language: true,
            state: true,
            verdict: true,
            generation: true,
            createdAt: true,
            startedAt: true,
            finishedAt: true,
          },
        }),
        prisma.practiceJob.count({ where }),
      ])
      return { rows, total, page, totalPages: Math.ceil(total / limit) }
    }
  )
  app.get(
    '/jobs/:id',
    { schema: { params: idParam }, preHandler: [app.requireAuth] },
    async request => {
      const j = await prisma.practiceJob.findFirst({
        where: {
          id: request.params.id,
          ownerId: request.user!.id,
          kind: { in: ['RUN', 'SUBMIT'] },
        },
        select: {
          id: true,
          versionId: true,
          kind: true,
          language: true,
          source: true,
          state: true,
          verdict: true,
          generation: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
        },
      })
      if (!j) throw notFound('JOB_NOT_FOUND', 'Job not found')
      // Stored diagnostic JSON is deliberately not returned until its bounded
      // projection is implemented with the real execution boundary.
      return j
    }
  )
  app.post(
    '/jobs/:id/cancel',
    { schema: { params: idParam, body: z.object({}).strict() }, preHandler: [app.requireAuth] },
    async request => {
      return prisma.$transaction(async tx => {
        const j = await tx.practiceJob.findFirst({
          where: {
            id: request.params.id,
            ownerId: request.user!.id,
            kind: { in: ['RUN', 'SUBMIT'] },
          },
        })
        if (!j) throw notFound('JOB_NOT_FOUND', 'Job not found')
        const changed = await tx.practiceJob.updateMany({
          where: { id: j.id, state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] } },
          data: {
            state: 'CANCELLED',
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            fence: { increment: 1 },
          },
        })
        if (changed.count)
          await tx.auditLog.create({
            data: {
              actorId: request.user!.id,
              action: 'practice.cancel',
              target: j.id,
              requestId: request.id,
              payload: { generation: j.generation },
            },
          })
        return { id: j.id, cancelled: changed.count === 1 }
      })
    }
  )

  app.get(
    '/staff/versions',
    { schema: { querystring: pageQuery }, preHandler: [app.requireRole(...staff)] },
    async request => {
      const { page, limit } = request.query
      const where = request.user!.role === 'PROBLEM_SETTER' ? { authorId: request.user!.id } : {}
      const [rows, total] = await Promise.all([
        prisma.practiceVersion.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            problemId: true,
            number: true,
            authorId: true,
            status: true,
            packageHash: true,
            createdAt: true,
            problem: { select: { slug: true, title: true } },
          },
        }),
        prisma.practiceVersion.count({ where }),
      ])
      return { rows, total, page, totalPages: Math.ceil(total / limit) }
    }
  )
  app.get(
    '/staff/versions/:id',
    { schema: { params: idParam }, preHandler: [app.requireRole(...staff)] },
    async request => {
      const v = await prisma.practiceVersion.findUnique({
        where: { id: request.params.id },
        include: { problem: { select: { slug: true } } },
      })
      if (!v || (request.user!.role === 'PROBLEM_SETTER' && v.authorId !== request.user!.id))
        throw notFound('VERSION_NOT_FOUND', 'Version not found')
      return v
    }
  )
  app.post(
    '/staff/versions',
    {
      schema: { body: PracticeDraftBody },
      preHandler: [app.requireRole('PROBLEM_SETTER', ...operators)],
    },
    async request => {
      const body = request.body
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await prisma.$transaction(
            async tx => {
              let problem = await tx.problem.findUnique({ where: { slug: body.slug } })
              if (
                problem &&
                problem.authorId !== request.user!.id &&
                !operators.includes(request.user!.role)
              )
                throw forbidden(
                  'FORBIDDEN',
                  'Only the author or an administrator can create a version'
                )
              if (!problem)
                problem = await tx.problem.create({
                  data: {
                    slug: body.slug,
                    title: body.package.title,
                    statementMd: body.package.statementMd,
                    constraints: body.package.constraints,
                    inputFormat: body.package.inputFormat,
                    outputFormat: body.package.outputFormat,
                    difficultyBand: body.package.difficultyBand,
                    judgeMode: body.package.mode,
                    authorId: request.user!.id,
                    status: 'DRAFT',
                    isPublic: false,
                  },
                })
              const previous = await tx.practiceVersion.aggregate({
                where: { problemId: problem.id },
                _max: { number: true },
              })
              const v = await tx.practiceVersion.create({
                data: {
                  problemId: problem.id,
                  number: (previous._max.number ?? 0) + 1,
                  authorId: request.user!.id,
                  package: body.package as Prisma.InputJsonValue,
                  packageHash: hash(canonical(body.package)),
                },
              })
              await tx.auditLog.create({
                data: {
                  actorId: request.user!.id,
                  action: 'practice.version.create',
                  target: v.id,
                  requestId: request.id,
                  payload: { packageHash: v.packageHash, number: v.number },
                },
              })
              return { id: v.id, number: v.number, status: v.status, packageHash: v.packageHash }
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          )
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            ['P2034', 'P2002'].includes(e.code) &&
            attempt < 2
          )
            continue
          throw e
        }
      }
      throw conflict('VERSION_CONFLICT', 'Retry creating the version')
    }
  )
  app.post(
    '/staff/versions/:id/validate',
    {
      schema: { params: idParam, body: z.object({}).strict() },
      preHandler: [app.requireRole('PROBLEM_SETTER', ...operators)],
    },
    async request => {
      const v = await prisma.practiceVersion.findUnique({ where: { id: request.params.id } })
      if (!v || (v.authorId !== request.user!.id && !operators.includes(request.user!.role)))
        throw notFound('VERSION_NOT_FOUND', 'Version not found')
      return disabled()
    }
  )
  app.post(
    '/staff/versions/:id/publish',
    {
      schema: {
        params: idParam,
        body: z
          .object({
            rightsConfirmed: z.literal(true),
            rightsBasis: z.string().trim().min(10).max(1000),
            packageHash: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      },
      preHandler: [app.requireRole(...reviewers)],
    },
    async request => {
      const v = await prisma.practiceVersion.findUnique({ where: { id: request.params.id } })
      if (!v) throw notFound('VERSION_NOT_FOUND', 'Version not found')
      if (v.authorId === request.user!.id)
        throw forbidden('SEPARATE_REVIEWER_REQUIRED', 'The author cannot approve their own version')
      if (v.packageHash !== request.body.packageHash)
        throw conflict('PACKAGE_CHANGED', 'Review the exact package hash')
      if (v.status === 'WITHDRAWN')
        throw conflict('WITHDRAWN', 'Withdrawn versions cannot be published')
      return disabled()
    }
  )
  app.post(
    '/staff/versions/:id/withdraw',
    {
      schema: {
        params: idParam,
        body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
      },
      preHandler: [app.requireRole(...reviewers)],
    },
    async request => {
      return prisma.$transaction(async tx => {
        const v = await tx.practiceVersion.findUnique({ where: { id: request.params.id } })
        if (!v) throw notFound('VERSION_NOT_FOUND', 'Version not found')
        if (v.status === 'WITHDRAWN') return { id: v.id, status: v.status }
        const changed = await tx.practiceVersion.updateMany({
          where: { id: v.id, status: { not: 'WITHDRAWN' } },
          data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
        })
        if (!changed.count) return { id: v.id, status: 'WITHDRAWN' }
        if (v.status === 'PUBLISHED')
          await tx.problem.update({
            where: { id: v.problemId },
            data: { status: 'RETIRED', isPublic: false },
          })
        // Candidate admission also checks the exact version, so no new job can
        // be admitted for this version after withdrawal commits.
        await tx.auditLog.create({
          data: {
            actorId: request.user!.id,
            action: 'practice.withdraw',
            target: v.id,
            requestId: request.id,
            payload: { reason: request.body.reason, packageHash: v.packageHash },
          },
        })
        return { id: v.id, status: 'WITHDRAWN' }
      })
    }
  )
  app.post(
    '/staff/jobs/:id/rejudge',
    {
      schema: {
        params: idParam,
        body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
      },
      preHandler: [app.requireRole(...operators)],
    },
    async () => disabled()
  )
}
