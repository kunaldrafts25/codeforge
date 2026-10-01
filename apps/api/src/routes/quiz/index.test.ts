import Fastify from 'fastify'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { forbidden } from '../../errors.js'
import { quizRoutes } from './index.js'

const fixture = vi.hoisted(() => {
  const questionA = {
    id: '018f8148-2201-7630-9da3-055be4d71851',
    type: 'MCQ_SINGLE',
    status: 'DRAFT',
    authorId: 'author',
    stemMd: '2 + 2?',
    topic: 'math',
    payload: {
      options: [
        { id: 'a', text: '3' },
        { id: 'b', text: '4' },
      ],
      correctIds: ['b'],
    },
  }
  const questionB = {
    id: '018f8148-2201-7630-9da3-055be4d71852',
    type: 'TRUE_FALSE',
    status: 'DRAFT',
    authorId: 'author',
    stemMd: '4 is even',
    topic: 'math',
    payload: { correct: true },
  }
  const test = {
    id: '018f8148-2201-7630-9da3-055be4d71850',
    slug: 'sample-test',
    title: 'Sample',
    description: null,
    durationMinutes: 5,
    status: 'draft',
    isAdaptive: false,
    proctorLevel: 'off',
    requireWebcam: false,
    requireFullscreen: false,
    requireScreenShare: false,
    randomizeOrder: false,
    randomizeOptions: false,
    createdAt: new Date(),
    sections: [
      {
        name: 'Math',
        durationMinutes: 5,
        numQuestions: 2,
        scoringPolicy: { marksPerCorrect: 1, negativeMarks: 0 },
      },
    ],
    items: [
      { questionId: questionA.id, question: questionA, section: 'Math', orderIndex: 0, weight: 1 },
      { questionId: questionB.id, question: questionB, section: 'Math', orderIndex: 1, weight: 1 },
    ],
  }
  // Dynamic record shape mirrors the few Prisma methods used by these route tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type RecordLike = Record<string, any>
  const attempts = new Map<string, RecordLike>()
  const responses = new Map<string, RecordLike>()
  const hydrated = (a: RecordLike) => ({
    ...a,
    test,
    responses: [...responses.values()]
      .filter(r => r.attemptId === a.id)
      .sort((x, y) => x.presentedOrder - y.presentedOrder)
      .map(r => ({
        ...r,
        question: test.items.find(i => i.questionId === r.questionId)!.question,
      })),
  })
  const prisma = {
    quizTest: {
      findMany: async ({ where }: RecordLike) =>
        (
          typeof where.status === 'string'
            ? test.status === where.status
            : where.status.in.includes(test.status)
        )
          ? [test]
          : [],
      findUnique: async ({ where }: RecordLike) =>
        where.slug === test.slug || where.id === test.id ? test : null,
      update: async ({ data }: RecordLike) => {
        Object.assign(test, data)
        return test
      },
    },
    quizQuestion: {
      update: async ({ where, data }: RecordLike) => {
        const q = test.items.find(i => i.questionId === where.id)!.question
        Object.assign(q, data)
        return q
      },
    },
    quizAttempt: {
      findFirst: async ({ where }: RecordLike) => {
        const a = [...attempts.values()].find(
          a =>
            (where.id === undefined || a.id === where.id) &&
            (where.userId === undefined || a.userId === where.userId) &&
            (where.testId === undefined || a.testId === where.testId) &&
            (where.activeKey === undefined || a.activeKey === where.activeKey) &&
            (where.submittedAt === undefined || a.submittedAt === where.submittedAt)
        )
        return a ? hydrated(a) : null
      },
      findUniqueOrThrow: async ({ where }: RecordLike) => {
        const a = attempts.get(where.id)
        if (!a) throw new Error('not found')
        return a
      },
      create: async ({ data }: RecordLike) => {
        const a = {
          id: data.id,
          testId: data.testId,
          userId: data.userId,
          seed: data.seed,
          activeKey: data.activeKey,
          startedAt: data.startedAt,
          deadlineAt: data.deadlineAt,
          submittedAt: null,
          rawScore: null,
        }
        attempts.set(a.id, a)
        for (const [index, r] of data.responses.create.entries()) {
          const id = `${a.id}:${index}`
          responses.set(id, {
            ...r,
            id,
            attemptId: a.id,
            isCorrect: null,
            pointsAwarded: 0,
            changeCount: 0,
          })
        }
        return a
      },
      updateMany: async ({ where, data }: RecordLike) => {
        const a = attempts.get(where.id)
        if (!a || a.userId !== where.userId || a.submittedAt !== null) return { count: 0 }
        Object.assign(a, data)
        return { count: 1 }
      },
    },
    quizResponse: {
      update: async ({ where, data }: RecordLike) => {
        const r = responses.get(where.id)!
        for (const [key, value] of Object.entries(data)) {
          r[key] =
            value && typeof value === 'object' && 'increment' in value
              ? r[key] + value.increment
              : value
        }
        return r
      },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  return { test, attempts, responses, prisma }
})

vi.mock('@codeforge/db', () => ({ prisma: fixture.prisma }))

let app: ReturnType<typeof Fastify>
beforeEach(async () => {
  fixture.test.status = 'draft'
  for (const item of fixture.test.items) item.question.status = 'DRAFT'
  fixture.attempts.clear()
  fixture.responses.clear()
  app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('requireAuth', async (request: any) => {
    request.user = {
      id: String(request.headers['x-user-id'] ?? 'candidate'),
      role: String(request.headers['x-role'] ?? 'USER'),
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('requireRole', (...roles: string[]) => async (request: any) => {
    request.user = {
      id: String(request.headers['x-user-id'] ?? 'reviewer'),
      role: String(request.headers['x-role'] ?? 'REVIEWER'),
    }
    if (!roles.includes(request.user.role)) throw forbidden('FORBIDDEN', 'Insufficient permissions')
  })
  await app.register(quizRoutes, { prefix: '/quiz' })
})
afterEach(async () => {
  await app.close()
})

describe('fixed objective quiz journey', () => {
  it('keeps draft keys private, requires review, then publishes only valid items', async () => {
    expect((await app.inject('/quiz/tests')).json()).toEqual([])
    const review = await app.inject({
      url: '/quiz/review/tests',
      headers: { 'x-role': 'REVIEWER' },
    })
    expect(review.statusCode).toBe(200)
    expect(JSON.stringify(review.json())).toContain('correctIds')
    const selfReview = await app.inject({
      method: 'POST',
      url: '/quiz/review/tests/sample-test/publish',
      headers: { 'x-role': 'REVIEWER', 'x-user-id': 'author' },
      payload: { rightsConfirmed: true, license: 'Original work' },
    })
    expect(selfReview.statusCode).toBe(400)
    const publish = await app.inject({
      method: 'POST',
      url: '/quiz/review/tests/sample-test/publish',
      headers: { 'x-role': 'REVIEWER', 'x-user-id': 'reviewer' },
      payload: { rightsConfirmed: true, license: 'Original work' },
    })
    expect(publish.statusCode).toBe(200)
    const repeated = await app.inject({
      method: 'POST',
      url: '/quiz/review/tests/sample-test/publish',
      headers: { 'x-role': 'REVIEWER', 'x-user-id': 'reviewer' },
      payload: { rightsConfirmed: true, license: 'Original work' },
    })
    expect(repeated.statusCode).toBe(200)
    expect((await app.inject('/quiz/tests')).json()).toHaveLength(1)
  })

  it('starts, saves, resumes, submits once, and keeps another user out', async () => {
    await app.inject({
      method: 'POST',
      url: '/quiz/review/tests/sample-test/publish',
      headers: { 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, license: 'Original work' },
    })
    const start = await app.inject({
      method: 'POST',
      url: '/quiz/tests/sample-test/start',
      headers: { 'x-user-id': 'alice' },
    })
    expect(start.statusCode).toBe(200)
    const id = start.json().attemptId as string
    const resume = await app.inject({
      method: 'POST',
      url: '/quiz/tests/sample-test/start',
      headers: { 'x-user-id': 'alice' },
    })
    expect(resume.json()).toEqual({ attemptId: id, resumed: true })
    const state = await app.inject({
      url: `/quiz/attempts/${id}`,
      headers: { 'x-user-id': 'alice' },
    })
    expect(state.statusCode).toBe(200)
    expect(JSON.stringify(state.json())).not.toContain('correctIds')
    expect(state.json().questions).toHaveLength(2)
    const forbiddenState = await app.inject({
      url: `/quiz/attempts/${id}`,
      headers: { 'x-user-id': 'bob' },
    })
    expect(forbiddenState.statusCode).toBe(404)
    const invalid = await app.inject({
      method: 'PUT',
      url: `/quiz/attempts/${id}/answer`,
      headers: { 'x-user-id': 'alice' },
      payload: { questionId: fixture.test.items[0]!.questionId, answer: { selected: 'missing' } },
    })
    expect(invalid.statusCode).toBe(400)
    for (const [questionId, answer] of [
      [fixture.test.items[0]!.questionId, { selected: 'b' }],
      [fixture.test.items[1]!.questionId, { value: true }],
    ] as const) {
      const saved = await app.inject({
        method: 'PUT',
        url: `/quiz/attempts/${id}/answer`,
        headers: { 'x-user-id': 'alice' },
        payload: { questionId, answer },
      })
      expect(saved.statusCode).toBe(200)
    }
    const reloaded = await app.inject({
      url: `/quiz/attempts/${id}`,
      headers: { 'x-user-id': 'alice' },
    })
    expect(reloaded.json().questions[0].answer).toEqual({ selected: 'b' })
    const submit = await app.inject({
      method: 'POST',
      url: `/quiz/attempts/${id}/submit`,
      headers: { 'x-user-id': 'alice' },
    })
    expect(submit.statusCode).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/quiz/attempts/${id}/submit`,
          headers: { 'x-user-id': 'alice' },
        })
      ).statusCode
    ).toBe(200)
    const result = await app.inject({
      url: `/quiz/attempts/${id}/result`,
      headers: { 'x-user-id': 'alice' },
    })
    expect(result.json().rawScore).toBe(2)
    expect(result.json().maxScore).toBe(2)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/quiz/attempts/${id}/answer`,
          headers: { 'x-user-id': 'alice' },
          payload: { questionId: fixture.test.items[0]!.questionId, answer: { selected: 'a' } },
        })
      ).statusCode
    ).toBe(409)
  })

  it('closes expired attempts using the server start time', async () => {
    await app.inject({
      method: 'POST',
      url: '/quiz/review/tests/sample-test/publish',
      headers: { 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, license: 'Original work' },
    })
    const id = (await app.inject({ method: 'POST', url: '/quiz/tests/sample-test/start' })).json()
      .attemptId as string
    fixture.attempts.get(id)!.startedAt = new Date(Date.now() - 6 * 60_000)
    fixture.attempts.get(id)!.deadlineAt = new Date(Date.now() - 60_000)
    const answer = await app.inject({
      method: 'PUT',
      url: `/quiz/attempts/${id}/answer`,
      payload: { questionId: fixture.test.items[0]!.questionId, answer: { selected: 'b' } },
    })
    expect(answer.statusCode).toBe(409)
    const result = await app.inject(`/quiz/attempts/${id}/result`)
    expect(result.statusCode).toBe(200)
    expect(result.json().rawScore).toBe(0)
  })
})
