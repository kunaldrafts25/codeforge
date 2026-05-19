import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '@codeforge/db'

export const adminRoutes: FastifyPluginAsyncZod = async app => {
  app.addHook('preHandler', app.requireRole('ADMIN', 'SUPER_ADMIN', 'PROBLEM_SETTER'))

  app.get(
    '/stats',
    {
      schema: {
        tags: ['admin'],
        response: {
          200: z.object({
            users: z.number(),
            problems: z.number(),
            contests: z.number(),
            submissions: z.number(),
          }),
        },
      },
    },
    async () => {
      const [users, problems, contests, submissions] = await Promise.all([
        prisma.user.count(),
        prisma.problem.count(),
        prisma.contest.count(),
        prisma.submission.count(),
      ])
      return { users, problems, contests, submissions }
    }
  )

  app.get(
    '/problems',
    {
      schema: {
        tags: ['admin'],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              slug: z.string(),
              title: z.string(),
              difficultyBand: z.string(),
              isPublic: z.boolean(),
              status: z.string(),
              createdAt: z.string(),
            })
          ),
        },
      },
    },
    async () => {
      const items = await prisma.problem.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          title: true,
          difficultyBand: true,
          isPublic: true,
          status: true,
          createdAt: true,
        },
      })
      return items.map(i => ({ ...i, createdAt: i.createdAt.toISOString() }))
    }
  )

  app.get(
    '/users',
    {
      schema: {
        tags: ['admin'],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              email: z.string(),
              username: z.string(),
              role: z.string(),
              rating: z.number(),
              isBanned: z.boolean(),
              createdAt: z.string(),
            })
          ),
        },
      },
      preHandler: [app.requireRole('ADMIN', 'SUPER_ADMIN')],
    },
    async () => {
      const items = await prisma.user.findMany({
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
      return items.map(i => ({ ...i, createdAt: i.createdAt.toISOString() }))
    }
  )
}
