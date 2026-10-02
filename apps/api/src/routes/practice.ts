import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import {
  Prisma,
  prisma,
  enqueuePracticeJob,
  rejudgePracticeJob,
  practiceTransaction,
} from '@codeforge/db'
import {
  PracticeDraftBody,
  PracticeJobBody,
  PracticeRunBody,
  PracticePackage,
  validatePracticeValue,
} from '@codeforge/shared'
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
const policyIdentity = (value: Prisma.JsonValue) => {
  const { packageHash: _packageHash, ...runtime } = value as Prisma.JsonObject
  return hash(canonical(runtime))
}
const disabled = async () => {
  throw new HttpError(503, 'JUDGE_UNAVAILABLE', (await executionAvailability()).reason)
}
async function policy() {
  const available = await executionAvailability()
  if (!available.enabled || !('policy' in available)) return disabled()
  return available.policy as Prisma.InputJsonObject
}
async function admit(
  ownerId: string,
  kind: 'RUN' | 'SUBMIT',
  body: z.infer<typeof PracticeRunBody>
) {
  const existing = await prisma.practiceJob.findUnique({
    where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: body.idempotencyKey } },
  })
  if (existing) {
    const original = await prisma.practiceVersion.findUnique({ where: { id: existing.versionId } })
    if (
      original?.problemId !== body.problemId ||
      (body.versionId && body.versionId !== existing.versionId) ||
      existing.kind !== kind ||
      existing.language !== body.language ||
      existing.source !== body.code ||
      existing.input !== (kind === 'RUN' ? (body.input ?? null) : null)
    )
      throw conflict('IDEMPOTENCY_CONFLICT', 'Request key was used for different content')
    return { id: existing.id, state: existing.state, verdict: existing.verdict }
  }
  const executionPolicy = await policy()
  const v = await prisma.practiceVersion.findFirst({
    where: {
      ...(body.versionId ? { id: body.versionId } : {}),
      problemId: body.problemId,
      status: 'PUBLISHED',
      withdrawnAt: null,
    },
    orderBy: { number: 'desc' },
  })
  if (!v || v.problemId !== body.problemId)
    throw notFound('PROBLEM_NOT_FOUND', 'Published version not found')
  const artifact = v.validation as Record<string, unknown> | null
  if (
    artifact?.executed !== true ||
    artifact.packageHash !== v.packageHash ||
    artifact.policyHash !== hash(canonical(executionPolicy))
  )
    throw conflict(
      'VALIDATION_REQUIRED',
      'This version needs validation under the current execution policy'
    )
  const p = PracticePackage.parse(v.package)
  if (!p.languages.includes(body.language))
    throw conflict('LANGUAGE_DISABLED', 'Language is not supported by this problem')
  if (kind === 'RUN' && body.input !== undefined && p.signature) {
    let args: unknown
    try {
      args = JSON.parse(body.input)
    } catch {
      throw conflict('INVALID_INPUT', 'Use an ordered JSON argument array')
    }
    if (
      !Array.isArray(args) ||
      args.length !== p.signature.params.length ||
      !p.signature.params.every((a, i) => validatePracticeValue(a.type, (args as unknown[])[i]))
    )
      throw conflict('INVALID_INPUT', 'Input does not match the function signature')
  }
  try {
    const job = await enqueuePracticeJob(prisma, {
      ownerId,
      versionId: v.id,
      kind,
      language: body.language,
      source: body.code,
      ...(kind === 'RUN' && body.input !== undefined ? { input: body.input } : {}),
      idempotencyKey: body.idempotencyKey,
      policy: executionPolicy,
    })
    return { id: job.id, state: job.state, verdict: job.verdict }
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message.includes('capacity'))
      throw new HttpError(429, 'JUDGE_CAPACITY', 'Active job quota reached; wait for existing jobs')
    if (message.includes('Idempotency'))
      throw conflict('IDEMPOTENCY_CONFLICT', 'Request key was used for different content')
    throw e
  }
}

export const practiceRoutes: FastifyPluginAsyncZod = async app => {
  app.get('/capabilities', async () => ({
    ...(await executionAvailability()),
    languages: ['cpp', 'python', 'java', 'javascript'],
    modes: ['STDIO', 'FUNCTIONAL'],
  }))
  app.post(
    '/runs',
    { schema: { body: PracticeRunBody }, preHandler: [app.requireAuth] },
    async request => admit(request.user!.id, 'RUN', request.body)
  )
  app.post(
    '/submit',
    { schema: { body: PracticeJobBody }, preHandler: [app.requireAuth] },
    async request => admit(request.user!.id, 'SUBMIT', request.body)
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
      // ── P3-R2 fix: scope filter – practice history must not include contest jobs. ──
      const where = {
        ownerId: request.user!.id,
        kind: { in: ['RUN', 'SUBMIT'] },
        scope: 'PRACTICE',
      }
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
          // ── P3-R2 fix: scope filter – practice job detail must not expose contest jobs. ──
          scope: 'PRACTICE',
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
      const result = await prisma.practiceJob.findUnique({
        where: { id: j.id },
        select: { publicResult: true, privateResult: true },
      })
      const evidence = result?.privateResult as {
        compile?: { stderr?: string }
        cases?: {
          sample: boolean
          stdout: string
          stderr: string
          outcome: string
          timeMs: number
          memoryKb: number
        }[]
      } | null
      return {
        ...j,
        result: result?.publicResult,
        diagnostics: evidence?.compile?.stderr?.slice(0, 8192) ?? '',
        samples:
          j.kind === 'RUN'
            ? (evidence?.cases
                ?.filter(c => c.sample)
                .map(c => ({
                  stdout: c.stdout,
                  stderr: c.stderr,
                  outcome: c.outcome,
                  timeMs: c.timeMs,
                  memoryKb: c.memoryKb,
                })) ?? [])
            : [],
      }
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
            // ── P3-R2 fix: scope filter – contest jobs CANNOT be cancelled via practice endpoint. ──
            scope: 'PRACTICE',
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
        include: {
          problem: { select: { slug: true } },
          jobs: {
            where: { kind: 'VALIDATE' },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { id: true, state: true, verdict: true, failureCode: true, publicResult: true },
          },
        },
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
      const executionPolicy = await policy()
      if (!['DRAFT', 'VALIDATED'].includes(v.status))
        throw conflict('VERSION_CLOSED', 'This version cannot be validated')
      const p = PracticePackage.parse(v.package)
      const jobs = []
      for (const [i, ref] of p.references.entries())
        jobs.push(
          await enqueuePracticeJob(prisma, {
            ownerId: v.authorId,
            versionId: v.id,
            kind: 'VALIDATE',
            language: ref.language,
            source: ref.code,
            idempotencyKey: `validate:${v.id}:${hash(canonical(executionPolicy))}:${i}`,
            policy: executionPolicy,
          })
        )
      return {
        id: v.id,
        status: v.status,
        jobs: jobs.map(j => ({ id: j.id, state: j.state, verdict: j.verdict })),
      }
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
      const executionPolicy = await policy()
      const policyHash = hash(canonical(executionPolicy))
      return practiceTransaction(prisma, async tx => {
        const exact = await tx.practiceVersion.findUniqueOrThrow({ where: { id: v.id } })
        if (exact.status === 'PUBLISHED') return { id: exact.id, status: exact.status }
        const artifact = exact.validation as {
          executed?: boolean
          packageHash?: string
          policyHash?: string
          jobs?: string[]
        } | null
        if (
          exact.status !== 'VALIDATED' ||
          artifact?.executed !== true ||
          artifact.packageHash !== exact.packageHash ||
          artifact.policyHash !== policyHash ||
          !artifact.jobs?.length
        )
          throw conflict(
            'VALIDATION_REQUIRED',
            'Successful real validation of this exact version is required'
          )
        const p = PracticePackage.parse(exact.package)
        const jobs = await tx.practiceJob.findMany({
          where: {
            id: { in: artifact.jobs },
            versionId: exact.id,
            kind: 'VALIDATE',
            state: 'TERMINAL',
            verdict: 'ACCEPTED',
          },
        })
        if (
          !p.references.every(r =>
            jobs.some(
              j =>
                j.language === r.language &&
                j.sourceHash === hash(r.code) &&
                policyIdentity(j.policy) === policyHash &&
                (j.privateResult as Record<string, unknown> | null)?.executed === true
            )
          )
        )
          throw conflict('VALIDATION_REQUIRED', 'Validation job evidence is incomplete')
        const current = await tx.problem.findUniqueOrThrow({ where: { id: exact.problemId } })
        if (current.version > exact.number)
          throw conflict(
            'STALE_VERSION',
            'Publish a version newer than the current catalog version'
          )
        const superseded = await tx.practiceVersion.findMany({
          where: { problemId: exact.problemId, id: { not: exact.id }, status: 'PUBLISHED' },
          select: { id: true },
        })
        await tx.practiceVersion.updateMany({
          where: { id: { in: superseded.map(row => row.id) } },
          data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
        })
        for (const old of superseded)
          await tx.auditLog.create({
            data: {
              actorId: request.user!.id,
              action: 'practice.supersede',
              target: old.id,
              payload: { replacementVersionId: exact.id },
            },
          })
        await tx.practiceVersion.update({
          where: { id: exact.id },
          data: {
            status: 'PUBLISHED',
            reviewerId: request.user!.id,
            rightsBasis: request.body.rightsBasis,
            approvedAt: new Date(),
            publishedAt: new Date(),
          },
        })
        await tx.problem.update({
          where: { id: exact.problemId },
          data: {
            title: p.title,
            statementMd: p.statementMd,
            constraints: p.constraints,
            inputFormat: p.inputFormat,
            outputFormat: p.outputFormat,
            difficultyBand: p.difficultyBand,
            judgeMode: p.mode,
            functionSignature: p.signature ?? Prisma.JsonNull,
            tags: p.tags,
            allowedLanguages: p.languages,
            timeLimitMs: p.limits.timeMs,
            memoryLimitKb: p.limits.memoryKb,
            outputLimitKb: p.limits.outputKb,
            status: 'PUBLISHED',
            isPublic: true,
            version: exact.number,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: request.user!.id,
            action: 'practice.publish',
            target: exact.id,
            requestId: request.id,
            payload: {
              packageHash: exact.packageHash,
              policyHash,
              rightsBasis: request.body.rightsBasis,
              rightsConfirmed: true,
            },
          },
        })
        return { id: exact.id, status: 'PUBLISHED' }
      })
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
        if (
          v.status === 'PUBLISHED' &&
          !(await tx.practiceVersion.count({
            where: {
              problemId: v.problemId,
              id: { not: v.id },
              status: 'PUBLISHED',
              withdrawnAt: null,
            },
          }))
        )
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
        body: z
          .object({
            reason: z.string().trim().min(10).max(1000),
            idempotencyKey: z.string().uuid(),
          })
          .strict(),
      },
      preHandler: [app.requireRole(...operators)],
    },
    async request => {
      const executionPolicy = await policy()
      const job = await rejudgePracticeJob(prisma, {
        id: request.params.id,
        actorId: request.user!.id,
        reason: request.body.reason,
        idempotencyKey: request.body.idempotencyKey,
        policy: executionPolicy,
      })
      return { id: job.id, state: job.state, generation: job.generation }
    }
  )
  app.get(
    '/staff/jobs',
    { schema: { querystring: pageQuery }, preHandler: [app.requireRole(...operators)] },
    async request => {
      const { page, limit } = request.query
      const where = { state: 'DEAD_LETTER' }
      const [rows, total] = await Promise.all([
        prisma.practiceJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            versionId: true,
            kind: true,
            language: true,
            state: true,
            verdict: true,
            failureCode: true,
            attempt: true,
            generation: true,
            createdAt: true,
            finishedAt: true,
          },
        }),
        prisma.practiceJob.count({ where }),
      ])
      return { rows, total, page, totalPages: Math.ceil(total / limit) }
    }
  )
}
