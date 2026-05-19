import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '@codeforge/db'
import { UpdateMeBody, UsernameParam } from '@codeforge/shared'
import { notFound } from '../errors.js'

export const userRoutes: FastifyPluginAsyncZod = async app => {
  // Public profile by username. Email is NEVER exposed here.
  app.get(
    '/:username',
    {
      schema: {
        tags: ['users'],
        params: UsernameParam,
        response: {
          200: z.object({
            id: z.string(),
            username: z.string(),
            displayName: z.string().nullable(),
            avatarUrl: z.string().nullable(),
            bio: z.string().nullable(),
            country: z.string().nullable(),
            organization: z.string().nullable(),
            role: z.string(),
            rating: z.number(),
            maxRating: z.number(),
            problemsSolved: z.number(),
            contestsCount: z.number(),
            createdAt: z.string(),
          }),
        },
      },
    },
    async request => {
      const user = await prisma.user.findUnique({
        where: { username: request.params.username },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          country: true,
          organization: true,
          role: true,
          rating: true,
          maxRating: true,
          problemsSolved: true,
          contestsCount: true,
          createdAt: true,
        },
      })
      if (!user) throw notFound('USER_NOT_FOUND', 'User not found')
      return { ...user, createdAt: user.createdAt.toISOString() }
    }
  )

  app.patch(
    '/me',
    {
      schema: {
        tags: ['users'],
        body: UpdateMeBody,
        response: {
          200: z.object({
            id: z.string(),
            username: z.string(),
            displayName: z.string().nullable(),
            avatarUrl: z.string().nullable(),
            bio: z.string().nullable(),
            country: z.string().nullable(),
            organization: z.string().nullable(),
          }),
        },
      },
      preHandler: [app.requireAuth],
    },
    async request => {
      // Strip `undefined` values so that exactOptionalPropertyTypes does not
      // conflict with Prisma's `string | null` field types.
      const body = request.body
      const data: Record<string, string> = {}
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) data[k] = v
      }
      const updated = await prisma.user.update({
        where: { id: request.user!.id },
        data,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          country: true,
          organization: true,
        },
      })
      return updated
    }
  )

  app.get(
    '/:username/submissions',
    {
      schema: {
        tags: ['users'],
        params: UsernameParam,
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              language: z.string(),
              verdict: z.string(),
              executionTimeMs: z.number().nullable(),
              submittedAt: z.string(),
              problem: z.object({ slug: z.string(), title: z.string() }),
            })
          ),
        },
      },
    },
    async request => {
      const user = await prisma.user.findUnique({
        where: { username: request.params.username },
        select: { id: true },
      })
      if (!user) throw notFound('USER_NOT_FOUND', 'User not found')

      const submissions = await prisma.submission.findMany({
        where: { userId: user.id },
        orderBy: { submittedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          language: true,
          verdict: true,
          executionTimeMs: true,
          submittedAt: true,
          problem: { select: { slug: true, title: true } },
        },
      })
      return submissions.map(s => ({
        ...s,
        submittedAt: s.submittedAt.toISOString(),
      }))
    }
  )
}
