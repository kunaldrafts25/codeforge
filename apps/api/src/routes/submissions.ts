import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CreateSubmissionBody, SubmissionIdParam, SubmissionResponse } from '@codeforge/shared'
import { prisma } from '@codeforge/db'
import { forbidden, notFound, HttpError } from '../errors.js'

export const submissionRoutes: FastifyPluginAsyncZod = async app => {
  app.post(
    '/',
    {
      schema: { tags: ['submissions'], body: CreateSubmissionBody },
      preHandler: [app.requireAuth],
    },
    async () => {
      // Code judging requires an isolated worker, durable queue, and trusted
      // test storage. Until all three exist, fail before storing any submission.
      throw new HttpError(503, 'JUDGE_UNAVAILABLE', 'Code judging is temporarily unavailable')
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
      const submission = await prisma.submission.findUnique({ where: { id: request.params.id } })
      if (!submission) throw notFound('SUBMISSION_NOT_FOUND', 'Submission not found')
      if (submission.userId !== request.user!.id) {
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
