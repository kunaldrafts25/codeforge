import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { prisma, Prisma as Sql } from '@codeforge/db'
import { GlobalLeaderboardQuery, GlobalLeaderboardResponse } from '@codeforge/shared'
import { conflict } from '../errors.js'

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
      const { page, limit, revision: requestedRevision } = request.query
      if (page > 1 && !requestedRevision) {
        throw conflict(
          'LEADERBOARD_REVISION_REQUIRED',
          'Read the first leaderboard page to obtain a revision'
        )
      }
      return prisma.$transaction(
        async tx => {
          const skip = (page - 1) * limit
          const asOfTime = new Date().toISOString()
          // Every page is tied to all fields exposed in the response. A concurrent
          // settlement/profile/ban/solve update invalidates the token; clients restart
          // at page one instead of silently skipping or duplicating competitors.
          const revisions = await tx.$queryRaw<{ revision: string }[]>(Sql.sql`
        SELECT md5(COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.id)::text, '[]')) AS revision
        FROM (
          SELECT u.id, u.username, u."displayName", u."avatarUrl", u.rating, u."maxRating",
            (SELECT COUNT(DISTINCT l."contestId") FROM "ContestRatingLedger" l
             WHERE l."userId" = u.id AND l."isAuthoritative") AS contests,
            (SELECT COUNT(*) FROM "PracticeSolve" s WHERE s."ownerId" = u.id) AS solves
          FROM "User" u
          WHERE NOT u."isBanned" AND EXISTS (
            SELECT 1 FROM "ContestRatingLedger" l WHERE l."userId" = u.id AND l."isAuthoritative"
          )
        ) r
      `)
          const revision = revisions[0]!.revision
          if (requestedRevision && requestedRevision !== revision) {
            throw conflict(
              'LEADERBOARD_REVISION_CHANGED',
              'Leaderboard changed; restart at page one'
            )
          }

          // ── P3-R7 fix: derive eligibility from authoritative ContestRatingLedger count,
          // not stale User.contestsCount. Only non-banned users with >=1 authoritative
          // rated contest entry are included in global rankings. ──
          const totalResult = await tx.$queryRaw<{ count: bigint }[]>(Sql.sql`
        SELECT COUNT(DISTINCT u.id) as count
        FROM "User" u
        INNER JOIN "ContestRatingLedger" crl ON crl."userId" = u.id AND crl."isAuthoritative" = true
        WHERE u."isBanned" = false
      `)
          const total = Number(totalResult[0]?.count ?? 0)

          if (total === 0) {
            return {
              users: [],
              total: 0,
              page,
              totalPages: 1,
              asOfTime,
              revision,
            }
          }

          // ── P3-R7 fix: use SQL-level window ranking (RANK() OVER (ORDER BY rating DESC))
          // and SQL LIMIT/OFFSET pagination to avoid loading the entire field into JS memory.
          // Ties share standard competition rank (1, 1, 3 style), with stable user ID ordering. ──
          const pagedRows = await tx.$queryRaw<
            Array<{
              id: string
              username: string
              displayName: string | null
              avatarUrl: string | null
              rating: number
              maxRating: number
              rank: bigint
              contestsCount: bigint
            }>
          >(Sql.sql`
        WITH eligible_users AS (
          SELECT DISTINCT u.id, u.username, u."displayName", u."avatarUrl", u.rating, u."maxRating"
          FROM "User" u
          INNER JOIN "ContestRatingLedger" crl ON crl."userId" = u.id AND crl."isAuthoritative" = true
          WHERE u."isBanned" = false
        ),
        ranked_users AS (
          SELECT
            id, username, "displayName", "avatarUrl", rating, "maxRating",
            RANK() OVER (ORDER BY rating DESC) as rank
          FROM eligible_users
        )
        SELECT
          r.*,
          (SELECT COUNT(DISTINCT crl."contestId") FROM "ContestRatingLedger" crl WHERE crl."userId" = r.id AND crl."isAuthoritative" = true) as "contestsCount"
        FROM ranked_users r
        ORDER BY r.rating DESC, r.id ASC
        LIMIT ${limit} OFFSET ${skip}
      `)

          if (pagedRows.length === 0) {
            return {
              users: [],
              total,
              page,
              totalPages: Math.ceil(total / limit) || 1,
              asOfTime,
              revision,
            }
          }

          const pagedUserIds = pagedRows.map(r => r.id)

          // Fetch practice solve counts only for the current page
          const solveCounts = await tx.$queryRaw<{ ownerId: string; count: bigint }[]>(Sql.sql`
        SELECT "ownerId", count(*) as count
        FROM "PracticeSolve"
        WHERE "ownerId" IN (${Sql.join(pagedUserIds)})
        GROUP BY "ownerId"
      `)
          const solveMap = new Map(solveCounts.map(s => [s.ownerId, Number(s.count)]))

          const users = pagedRows.map(r => ({
            rank: Number(r.rank),
            userId: r.id,
            username: r.username,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
            rating: r.rating,
            maxRating: r.maxRating,
            contestsCount: Number(r.contestsCount),
            problemsSolved: solveMap.get(r.id) ?? 0,
          }))

          return {
            users,
            total,
            page,
            totalPages: Math.ceil(total / limit) || 1,
            asOfTime,
            revision,
          }
        },
        { isolationLevel: Sql.TransactionIsolationLevel.RepeatableRead }
      )
    }
  )
}
