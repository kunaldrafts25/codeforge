import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Prisma } from '@codeforge/db'
import { prisma } from '@codeforge/db'
import { z } from 'zod'
import { McqPayload, TrueFalsePayload } from '@codeforge/shared'
import { badRequest, conflict, notFound } from '../../errors.js'
import { gradeQuestion, projectPublicPayload } from './grading.js'
import { attemptSeed, seededPermutationIndices, seededShuffle } from './seed.js'

// First release: one fixed section, objective questions and no surveillance.
// Tests with other modes remain drafts until their complete runners exist.
const supported = ['MCQ_SINGLE', 'TRUE_FALSE'] as const
const idParam = z.object({ id: z.string().uuid() })
const slugParam = z.object({ slug: z.string().min(1).max(128) })
const answerBody = z.object({
  questionId: z.string().uuid(),
  answer: z.union([z.object({ selected: z.string().min(1) }), z.object({ value: z.boolean() })]),
})
const reviewBody = z.object({
  rightsConfirmed: z.literal(true),
  sourceUrl: z.string().url().optional(),
  license: z.string().trim().min(2).max(120),
})
const withdrawalBody = z.object({ reason: z.string().trim().min(10).max(1000) })
const snapshotSchema = z.object({
  type: z.enum(supported),
  stemMd: z.string(),
  payload: z.unknown(),
  scoringPolicy: z.object({ marksPerCorrect: z.number(), negativeMarks: z.number() }),
})

function frozen(snapshot: unknown) {
  const parsed = snapshotSchema.safeParse(snapshot)
  if (!parsed.success) throw conflict('SNAPSHOT_MISSING', 'Attempt requires operator review')
  return parsed.data
}

function eligible(test: {
  status: string
  isAdaptive: boolean
  proctorLevel: string
  requireWebcam: boolean
  requireFullscreen: boolean
  requireScreenShare: boolean
  items: { question: { type: string; status: string } }[]
}): boolean {
  return (
    test.status === 'published' &&
    !test.isAdaptive &&
    test.proctorLevel === 'off' &&
    !test.requireWebcam &&
    !test.requireFullscreen &&
    !test.requireScreenShare &&
    test.items.length > 0 &&
    test.items.every(
      i =>
        i.question.status === 'LIVE' &&
        supported.includes(i.question.type as (typeof supported)[number])
    )
  )
}

export function reviewable(
  test: {
    status: string
    isAdaptive: boolean
    proctorLevel: string
    requireWebcam: boolean
    requireFullscreen: boolean
    requireScreenShare: boolean
    durationMinutes: number
    sections: unknown
    items: {
      section: string
      weight: number
      question: { type: string; status: string; payload: unknown; authorId: string }
    }[]
  },
  reviewerId: string
): boolean {
  const sections = z
    .array(
      z.object({
        name: z.string(),
        scoringPolicy: z.object({
          marksPerCorrect: z.number().positive(),
          negativeMarks: z.number().nonnegative(),
        }),
        numQuestions: z.number().int().positive(),
        durationMinutes: z.number().int().positive(),
      })
    )
    .safeParse(test.sections)
  if (
    test.status !== 'draft' ||
    test.isAdaptive ||
    test.proctorLevel !== 'off' ||
    test.requireWebcam ||
    test.requireFullscreen ||
    test.requireScreenShare ||
    !Number.isInteger(test.durationMinutes) ||
    test.durationMinutes < 1 ||
    test.durationMinutes > 240 ||
    !sections.success ||
    sections.data.length !== 1 ||
    !test.items.length ||
    sections.data[0]!.numQuestions !== test.items.length ||
    sections.data[0]!.durationMinutes !== test.durationMinutes
  )
    return false
  return test.items.every(item => {
    const q = item.question
    if (
      item.weight !== 1 ||
      item.section !== sections.data[0]!.name ||
      q.authorId === reviewerId ||
      q.status !== 'DRAFT'
    )
      return false
    if (q.type === 'TRUE_FALSE') return TrueFalsePayload.safeParse(q.payload).success
    if (q.type !== 'MCQ_SINGLE') return false
    const parsed = McqPayload.safeParse(q.payload)
    if (!parsed.success) return false
    const ids = parsed.data.options.map(o => o.id)
    return (
      new Set(ids).size === ids.length &&
      parsed.data.correctIds.length === 1 &&
      ids.includes(parsed.data.correctIds[0]!)
    )
  })
}

function deadline(deadlineAt: Date | null): number {
  if (!deadlineAt) throw conflict('DEADLINE_MISSING', 'Attempt requires operator review')
  return deadlineAt.getTime()
}

async function withSerializationRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run()
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || attempt === 2) throw error
    }
  }
  throw new Error('Unreachable serialization retry state')
}

async function ownedAttempt(id: string, userId: string) {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id, userId },
    include: {
      test: true,
      responses: { orderBy: { presentedOrder: 'asc' } },
    },
  })
  if (!attempt) throw notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  return attempt
}

async function finalize(id: string, userId: string, requireExpiry = false) {
  return withSerializationRetry(() =>
    prisma.$transaction(
      async tx => {
        const attempt = await tx.quizAttempt.findFirst({
          where: { id, userId },
          include: { test: true, responses: true },
        })
        if (!attempt) throw notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
        if (attempt.submittedAt) return attempt
        const now = new Date()
        if (requireExpiry && now.getTime() < deadline(attempt.deadlineAt)) {
          throw conflict('ATTEMPT_ACTIVE', 'Attempt is still active')
        }
        let score = 0
        for (const response of attempt.responses) {
          const snapshot = frozen(response.scoringSnapshot)
          const answered =
            response.answerPayload &&
            typeof response.answerPayload === 'object' &&
            Object.keys(response.answerPayload).length > 0
          const result = answered
            ? gradeQuestion(
                snapshot.type,
                snapshot.payload,
                response.answerPayload,
                snapshot.scoringPolicy
              )
            : { isCorrect: false, pointsAwarded: 0 }
          score += result.pointsAwarded
          await tx.quizResponse.update({ where: { id: response.id }, data: result })
        }
        const claimed = await tx.quizAttempt.updateMany({
          where: { id, userId, submittedAt: null },
          data: {
            submittedAt: now,
            activeKey: null,
            durationActualSeconds: Math.min(
              Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000),
              Math.floor((deadline(attempt.deadlineAt) - attempt.startedAt.getTime()) / 1000)
            ),
            rawScore: score,
            // A percentile or calibrated aptitude score needs a validated cohort.
          },
        })
        if (claimed.count !== 1)
          throw conflict('ALREADY_SUBMITTED', 'Attempt was already submitted')
        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: requireExpiry ? 'quiz.attempt.timeout' : 'quiz.attempt.submit',
            target: `quizAttempt:${id}`,
            payload: { rawScore: score, submittedAt: now.toISOString() },
          },
        })
        return { ...attempt, submittedAt: now, rawScore: score }
      },
      { isolationLevel: 'Serializable' }
    )
  )
}

export const quizRoutes: FastifyPluginAsyncZod = async app => {
  app.get(
    '/review/tests',
    { preHandler: [app.requireRole('REVIEWER', 'ADMIN', 'SUPER_ADMIN')] },
    async () => {
      const tests = await prisma.quizTest.findMany({
        where: { status: { in: ['draft', 'published'] } },
        include: { items: { include: { question: true }, orderBy: { orderIndex: 'asc' } } },
      })
      return tests.map(t => ({
        slug: t.slug,
        status: t.status,
        title: t.title,
        durationMinutes: t.durationMinutes,
        sections: t.sections,
        questions: t.items.map(i => ({
          id: i.question.id,
          type: i.question.type,
          stemMd: i.question.stemMd,
          payload: i.question.payload,
          authorId: i.question.authorId,
          section: i.section,
        })),
      }))
    }
  )

  app.post(
    '/review/tests/:slug/publish',
    {
      schema: { params: slugParam, body: reviewBody },
      preHandler: [app.requireRole('REVIEWER', 'ADMIN', 'SUPER_ADMIN')],
    },
    async request => {
      await withSerializationRetry(() =>
        prisma.$transaction(
          async tx => {
            const test = await tx.quizTest.findUnique({
              where: { slug: request.params.slug },
              include: { items: { include: { question: true } } },
            })
            if (!test) throw notFound('TEST_NOT_FOUND', 'Test not found')
            if (test.status === 'published') return
            if (!reviewable(test, request.user!.id))
              throw badRequest(
                'REVIEW_REQUIRED',
                'Test requires a separate reviewer and valid objective questions'
              )
            const now = new Date()
            for (const item of test.items) {
              await tx.quizQuestion.update({
                where: { id: item.questionId },
                data: {
                  status: 'LIVE',
                  reviewerId: request.user!.id,
                  sourceUrl: request.body.sourceUrl ?? null,
                  license: request.body.license,
                  rightsAttestedAt: now,
                },
              })
            }
            await tx.quizTest.update({
              where: { id: test.id },
              data: { status: 'published', reviewedBy: request.user!.id, reviewedAt: now },
            })
            await tx.auditLog.create({
              data: {
                actorId: request.user!.id,
                action: 'quiz.test.publish',
                target: `quizTest:${test.id}`,
                requestId: request.id,
                ipAddress: request.ip,
                payload: {
                  questionIds: test.items.map(i => i.questionId),
                  publishedAt: now.toISOString(),
                  sourceUrl: request.body.sourceUrl ?? null,
                  license: request.body.license,
                  rightsAttested: true,
                },
              },
            })
          },
          { isolationLevel: 'Serializable' }
        )
      )
      return { ok: true }
    }
  )

  app.post(
    '/review/tests/:slug/withdraw',
    {
      schema: { params: slugParam, body: withdrawalBody },
      preHandler: [app.requireRole('REVIEWER', 'ADMIN', 'SUPER_ADMIN')],
    },
    async request => {
      await withSerializationRetry(() =>
        prisma.$transaction(
          async tx => {
            const test = await tx.quizTest.findUnique({ where: { slug: request.params.slug } })
            if (!test) throw notFound('TEST_NOT_FOUND', 'Test not found')
            if (test.status === 'withdrawn') return
            if (test.status !== 'published')
              throw conflict('TEST_NOT_PUBLISHED', 'Test is not published')
            const now = new Date()
            await tx.quizTest.update({
              where: { id: test.id },
              data: {
                status: 'withdrawn',
                withdrawnBy: request.user!.id,
                withdrawnAt: now,
                withdrawalReason: request.body.reason,
              },
            })
            await tx.auditLog.create({
              data: {
                actorId: request.user!.id,
                action: 'quiz.test.withdraw',
                target: `quizTest:${test.id}`,
                requestId: request.id,
                ipAddress: request.ip,
                payload: { reason: request.body.reason, withdrawnAt: now.toISOString() },
              },
            })
          },
          { isolationLevel: 'Serializable' }
        )
      )
      return { ok: true }
    }
  )

  app.get('/tests', async () => {
    const tests = await prisma.quizTest.findMany({
      where: { status: 'published', isAdaptive: false, proctorLevel: 'off' },
      include: { items: { include: { question: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return tests.filter(eligible).map(t => ({
      slug: t.slug,
      title: t.title,
      description: t.description,
      durationMinutes: t.durationMinutes,
      questionCount: t.items.length,
    }))
  })

  app.get('/tests/:slug', { schema: { params: slugParam } }, async request => {
    const test = await prisma.quizTest.findUnique({
      where: { slug: request.params.slug },
      include: { items: { include: { question: true } } },
    })
    if (!test || !eligible(test)) throw notFound('TEST_NOT_FOUND', 'Test not found')
    return {
      slug: test.slug,
      title: test.title,
      description: test.description,
      durationMinutes: test.durationMinutes,
      questionCount: test.items.length,
    }
  })

  app.post(
    '/tests/:slug/start',
    { schema: { params: slugParam }, preHandler: [app.requireAuth] },
    async request => {
      const userId = request.user!.id
      const test = await prisma.quizTest.findUnique({ where: { slug: request.params.slug } })
      if (!test || test.status !== 'published') throw notFound('TEST_NOT_FOUND', 'Test not found')
      try {
        return await withSerializationRetry(() =>
          prisma.$transaction(
            async tx => {
              const current = await tx.quizTest.findUnique({
                where: { id: test.id },
                include: { items: { include: { question: true }, orderBy: { orderIndex: 'asc' } } },
              })
              if (!current || !eligible(current)) throw notFound('TEST_NOT_FOUND', 'Test not found')
              const existing = await tx.quizAttempt.findFirst({
                where: { activeKey: `${current.id}:${userId}` },
              })
              if (existing) return { attemptId: existing.id, resumed: true }
              const section = z
                .array(
                  z.object({
                    scoringPolicy: z.object({
                      marksPerCorrect: z.number(),
                      negativeMarks: z.number(),
                    }),
                  })
                )
                .parse(current.sections)[0]!
              const id = randomUUID()
              const seed = attemptSeed(id, current.id)
              const startedAt = new Date()
              const items = current.randomizeOrder
                ? seededShuffle(seed, 'questions', current.items)
                : current.items
              await tx.quizAttempt.create({
                data: {
                  id,
                  testId: current.id,
                  userId,
                  seed,
                  activeKey: `${current.id}:${userId}`,
                  startedAt,
                  deadlineAt: new Date(startedAt.getTime() + current.durationMinutes * 60_000),
                  responses: {
                    create: items.map((item, index) => {
                      const payload = item.question.payload as { options?: unknown[] }
                      return {
                        questionId: item.questionId,
                        presentedOrder: index,
                        optionOrderShown:
                          current.randomizeOptions && payload.options
                            ? seededPermutationIndices(
                                seed,
                                item.questionId,
                                payload.options.length
                              )
                            : (payload.options?.map((_, i) => i) ?? []),
                        scoringSnapshot: {
                          type: item.question.type,
                          stemMd: item.question.stemMd,
                          payload: item.question.payload,
                          scoringPolicy: section.scoringPolicy,
                        } as Prisma.InputJsonValue,
                        answerPayload: {},
                        firstShownAt: new Date(),
                        lastChangedAt: new Date(),
                        totalTimeSeconds: 0,
                      }
                    }),
                  },
                },
              })
              await tx.auditLog.create({
                data: {
                  actorId: userId,
                  action: 'quiz.attempt.start',
                  target: `quizAttempt:${id}`,
                  requestId: request.id,
                  ipAddress: request.ip,
                  payload: { testId: current.id },
                },
              })
              return { attemptId: id, resumed: false }
            },
            { isolationLevel: 'Serializable' }
          )
        )
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error
        const existing = await prisma.quizAttempt.findFirst({
          where: { activeKey: `${test.id}:${userId}` },
        })
        if (!existing) throw error
        return { attemptId: existing.id, resumed: true }
      }
    }
  )

  app.get(
    '/attempts/:id',
    { schema: { params: idParam }, preHandler: [app.requireAuth] },
    async request => {
      const a = await ownedAttempt(request.params.id, request.user!.id)
      if (!a.submittedAt && Date.now() >= deadline(a.deadlineAt)) {
        await finalize(a.id, request.user!.id, true)
        return { submitted: true, remainingMs: 0, questions: [] }
      }
      return {
        submitted: !!a.submittedAt,
        serverNow: new Date().toISOString(),
        remainingMs: Math.max(0, deadline(a.deadlineAt) - Date.now()),
        title: a.test.title,
        questions: a.submittedAt
          ? []
          : a.responses.map(r => {
              const snapshot = frozen(r.scoringSnapshot)
              return {
                questionId: r.questionId,
                type: snapshot.type,
                stemMd: snapshot.stemMd,
                payload: projectPublicPayload(snapshot.type, snapshot.payload, r.optionOrderShown),
                answer: r.answerPayload,
                presentedOrder: r.presentedOrder,
              }
            }),
      }
    }
  )

  app.put(
    '/attempts/:id/answer',
    {
      schema: { params: idParam, body: answerBody },
      preHandler: [app.requireAuth],
    },
    async request => {
      const a = await ownedAttempt(request.params.id, request.user!.id)
      if (a.submittedAt || Date.now() >= deadline(a.deadlineAt)) {
        throw conflict('ATTEMPT_CLOSED', 'Attempt is closed')
      }
      const r = a.responses.find(row => row.questionId === request.body.questionId)
      if (!r) throw badRequest('QUESTION_NOT_IN_ATTEMPT', 'Question is not in this attempt')
      const snapshot = frozen(r.scoringSnapshot)
      const answer = request.body.answer
      if (snapshot.type === 'MCQ_SINGLE') {
        const options = (snapshot.payload as { options: { id: string }[] }).options
        if (!('selected' in answer) || !options.some(o => o.id === answer.selected)) {
          throw badRequest('INVALID_ANSWER', 'Select an available option')
        }
      } else if (snapshot.type === 'TRUE_FALSE' && !('value' in answer)) {
        throw badRequest('INVALID_ANSWER', 'Select true or false')
      }
      // Serializable transaction makes save versus finalization obey one order.
      await withSerializationRetry(() =>
        prisma.$transaction(
          async tx => {
            const current = await tx.quizAttempt.findUniqueOrThrow({ where: { id: a.id } })
            if (current.submittedAt || Date.now() >= deadline(current.deadlineAt)) {
              throw conflict('ATTEMPT_CLOSED', 'Attempt is closed')
            }
            await tx.quizResponse.update({
              where: { id: r.id },
              data: {
                answerPayload: answer as Prisma.InputJsonValue,
                lastChangedAt: new Date(),
                changeCount: { increment: 1 },
              },
            })
          },
          { isolationLevel: 'Serializable' }
        )
      )
      return { ok: true }
    }
  )

  app.post(
    '/attempts/:id/submit',
    { schema: { params: idParam }, preHandler: [app.requireAuth] },
    async request => {
      const a = await finalize(request.params.id, request.user!.id)
      return { ok: true, submittedAt: a.submittedAt?.toISOString() }
    }
  )

  app.get(
    '/attempts/:id/result',
    { schema: { params: idParam }, preHandler: [app.requireAuth] },
    async request => {
      const a = await ownedAttempt(request.params.id, request.user!.id)
      if (!a.submittedAt) await finalize(a.id, request.user!.id, true)
      const final = await ownedAttempt(a.id, request.user!.id)
      const maxScore = final.responses.reduce(
        (sum, response) => sum + frozen(response.scoringSnapshot).scoringPolicy.marksPerCorrect,
        0
      )
      return {
        title: final.test.title,
        rawScore: final.rawScore,
        maxScore,
        submittedAt: final.submittedAt?.toISOString(),
        responses: final.responses.map(r => ({
          questionId: r.questionId,
          isCorrect: r.isCorrect,
          pointsAwarded: r.pointsAwarded,
        })),
      }
    }
  )
}
