import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '@codeforge/db'

export const leaderboardRoutes: FastifyPluginAsyncZod = async app => {
  app.get(
    '/',
    {
      schema: {
        tags: ['leaderboard'],
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            users: z.array(
              z.object({
                rank: z.number(),
                userId: z.string(),
                username: z.string(),
                displayName: z.string().nullable(),
                avatarUrl: z.string().nullable(),
                rating: z.number(),
                maxRating: z.number(),
                problemsSolved: z.number(),
                contestsCount: z.number(),
              })
            ),
          }),
        },
      },
    },
    async request => {
      const { page, limit } = request.query
      const skip = (page - 1) * limit
      const users = await prisma.user.findMany({
        where: { isBanned: false },
        orderBy: { rating: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          rating: true,
          maxRating: true,
          problemsSolved: true,
          contestsCount: true,
        },
      })
      return {
        users: users.map((u, i) => ({
          rank: skip + i + 1,
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          rating: u.rating,
          maxRating: u.maxRating,
          problemsSolved: u.problemsSolved,
          contestsCount: u.contestsCount,
        })),
      }
    }
  )
}
