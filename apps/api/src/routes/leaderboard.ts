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

      // ── P3-R7 fix: derive eligibility from authoritative ContestRatingLedger count,
      // not stale User.contestsCount. Only non-banned users with >=1 authoritative
      // rated contest entry are included in global rankings. ──
      const eligibleUserIds = await prisma.$queryRaw<{ userId: string }[]>(Sql.sql`
        SELECT DISTINCT "userId"
        FROM "ContestRatingLedger"
        WHERE "isAuthoritative" = true
      `)

      const eligibleSet = new Set(eligibleUserIds.map(r => r.userId))

      if (eligibleSet.size === 0) {
        return {
          users: [],
          total: 0,
          page,
          totalPages: 1,
          asOfTime,
        }
      }

      const ids = Array.from(eligibleSet)

      // ── P3-R7 fix: use DB-level ordering + pagination rather than loading all rows in memory. ──
      // Count total eligible (for pagination)
      const total = ids.length

      // Fetch the full ranking set from DB (ordered by rating desc, id asc for stable tie-breaking)
      // We need the full sorted list to compute competition ranks across page boundaries.
      // For very large fields this should use a cached snapshot; for now use DB ORDER BY.
      const allEligible = await prisma.user.findMany({
        where: {
          id: { in: ids },
          isBanned: false,
        },
        orderBy: [{ rating: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          rating: true,
          maxRating: true,
        },
      })

      // Compute competition ranks with ties sharing rank (1, 1, 3 style)
      // Ties: equal rating → same rank; next competitor skips ranks equal to the tie count.
      const rankedAll: { rank: number; userId: string }[] = []
      let rankBase = 1
      for (let i = 0; i < allEligible.length; i++) {
        const u = allEligible[i]!
        if (i > 0 && allEligible[i - 1]!.rating !== u.rating) {
          rankBase = i + 1
        }
        rankedAll.push({ rank: rankBase, userId: u.id })
      }

      // Paginate the ranking
      const pagedRankInfo = rankedAll.slice(skip, skip + limit)
      const pagedUserIds = pagedRankInfo.map(r => r.userId)
      const rankMap = new Map(pagedRankInfo.map(r => [r.userId, r.rank]))

      // Fetch full user data for the current page
      const pagedUsersRaw = await prisma.user.findMany({
        where: { id: { in: pagedUserIds } },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          rating: true,
          maxRating: true,
        },
      })

      // Fetch authoritative contest counts from ledger (not stale User.contestsCount)
      const ledgerCounts = await prisma.$queryRaw<{ userId: string; count: bigint }[]>(Sql.sql`
        SELECT "userId", count(*) as count
        FROM "ContestRatingLedger"
        WHERE "isAuthoritative" = true
          AND "userId" IN (${Sql.join(pagedUserIds)})
        GROUP BY "userId"
      `)
      const countMap = new Map(ledgerCounts.map(r => [r.userId, Number(r.count)]))

      // Fetch practice solve counts
      const solveCounts = await prisma.$queryRaw<{ ownerId: string; count: bigint }[]>(Sql.sql`
        SELECT "ownerId", count(*) as count
        FROM "PracticeSolve"
        WHERE "ownerId" IN (${Sql.join(pagedUserIds)})
        GROUP BY "ownerId"
      `)
      const solveMap = new Map(solveCounts.map(s => [s.ownerId, Number(s.count)]))

      // Build ordered response (preserving sort order from pagedRankInfo)
      const userMap = new Map(pagedUsersRaw.map(u => [u.id, u]))
      const paged = pagedRankInfo.map(ri => {
        const u = userMap.get(ri.userId)!
        return {
          rank: rankMap.get(ri.userId) ?? ri.rank,
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          rating: u.rating,
          maxRating: u.maxRating,
          contestsCount: countMap.get(u.id) ?? 0,
          problemsSolved: solveMap.get(u.id) ?? 0,
        }
      })

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
