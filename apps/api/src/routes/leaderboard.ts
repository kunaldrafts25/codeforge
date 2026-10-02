import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { prisma, Prisma as Sql } from '@codeforge/db'
import { GlobalLeaderboardQuery, GlobalLeaderboardResponse } from '@codeforge/shared'

export const leaderboardRoutes: FastifyPluginAsyncZod = async app => {
  app.get(
    '/',
    {
      schema: {
        tags: ['leaderboard'],
        querystring: GlobalLeaderboardQuery,
        response: { 200: GlobalLeaderboardResponse },
      },
    },
    async request => {
      const { page, limit } = request.query
      const skip = (page - 1) * limit
      const asOfTime = new Date().toISOString()

      // Include only users with at least one rated contest participation and not banned
      const where = {
        isBanned: false,
        contestsCount: { gte: 1 },
      }

      // Fetch all eligible users for global competition rank calculation
      const allEligible = await prisma.user.findMany({
        where,
        orderBy: [{ rating: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          rating: true,
          maxRating: true,
          contestsCount: true,
        },
      })

      const total = allEligible.length
      if (total === 0) {
        return {
          users: [],
          total: 0,
          page,
          totalPages: 1,
          asOfTime,
        }
      }

      // Compute competition ranks across the complete field (e.g. 1, 1, 3)
      const rankedUsers: Array<{
        rank: number
        userId: string
        username: string
        displayName: string | null
        avatarUrl: string | null
        rating: number
        maxRating: number
        contestsCount: number
        problemsSolved: number
      }> = []

      let currentRank = 1
      for (let i = 0; i < allEligible.length; i++) {
        const u = allEligible[i]!
        let rank = currentRank
        if (i > 0 && allEligible[i - 1]!.rating === u.rating) {
          rank = rankedUsers[i - 1]!.rank
        } else {
          rank = i + 1
        }
        currentRank = i + 1

        rankedUsers.push({
          rank,
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          rating: u.rating,
          maxRating: u.maxRating,
          contestsCount: u.contestsCount,
          problemsSolved: 0, // populated below from PracticeSolve
        })
      }

      // Paginate
      const paged = rankedUsers.slice(skip, skip + limit)
      const userIds = paged.map(u => u.userId)

      // Fetch actual practice solve counts from PracticeSolve (not stale problemsSolved)
      if (userIds.length > 0) {
        const solveCounts = await prisma.$queryRaw<{ ownerId: string; count: bigint }[]>(Sql.sql`
          SELECT "ownerId", count(*) as count
          FROM "PracticeSolve"
          WHERE "ownerId" IN (${Sql.join(userIds)})
          GROUP BY "ownerId"
        `)

        const solveMap = new Map(solveCounts.map(s => [s.ownerId, Number(s.count)]))
        for (const user of paged) {
          user.problemsSolved = solveMap.get(user.userId) ?? 0
        }
      }

      return {
        users: paged,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
        asOfTime,
      }
    }
  )
}
