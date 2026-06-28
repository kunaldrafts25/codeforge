import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '@codeforge/db'
import { ContestListResponse, ContestSlugParam } from '@codeforge/shared'
import { notFound, HttpError } from '../errors.js'

export const contestRoutes: FastifyPluginAsyncZod = async app => {
  app.get(
    '/',
    {
      schema: { tags: ['contests'], response: { 200: ContestListResponse } },
    },
    async () => {
      const contests = await prisma.contest.findMany({
        where: { isPublic: true },
        orderBy: { startTime: 'desc' },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          startTime: true,
          endTime: true,
          isRated: true,
          status: true,
          _count: { select: { participants: true } },
        },
      })
      return contests.map(c => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        description: c.description,
        startTime: c.startTime.toISOString(),
        endTime: c.endTime.toISOString(),
        isRated: c.isRated,
        status: c.status,
        participantCount: c._count.participants,
      }))
    }
  )

  app.get(
    '/:slug',
    {
      schema: {
        tags: ['contests'],
        params: ContestSlugParam,
        response: {
          200: z.object({
            id: z.string(),
            slug: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            startTime: z.string(),
            endTime: z.string(),
            isRated: z.boolean(),
            status: z.string(),
            participantCount: z.number(),
            isRegistered: z.boolean(),
            problems: z.array(
              z.object({
                label: z.string(),
                problemId: z.string(),
                slug: z.string(),
                title: z.string(),
                points: z.number(),
              })
            ),
          }),
        },
      },
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        include: {
          problems: {
            include: { problem: { select: { id: true, slug: true, title: true } } },
            orderBy: { label: 'asc' },
          },
          _count: { select: { participants: true } },
        },
      })
      if (!contest || !contest.isPublic) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')

      let isRegistered = false
      if (request.user) {
        const p = await prisma.contestParticipant.findUnique({
          where: { contestId_userId: { contestId: contest.id, userId: request.user.id } },
        })
        isRegistered = !!p
      }

      return {
        id: contest.id,
        slug: contest.slug,
        title: contest.title,
        description: contest.description,
        startTime: contest.startTime.toISOString(),
        endTime: contest.endTime.toISOString(),
        isRated: contest.isRated,
        status: contest.status,
        participantCount: contest._count.participants,
        isRegistered,
        problems: contest.problems.map(cp => ({
          label: cp.label,
          problemId: cp.problem.id,
          slug: cp.problem.slug,
          title: cp.problem.title,
          points: cp.points,
        })),
      }
    }
  )

  // A standings response must never look valid until scoring is implemented.
  app.get(
    '/:slug/leaderboard',
    {
      schema: {
        tags: ['contests'],
        params: ContestSlugParam,
        response: { 200: z.object({ entries: z.array(z.unknown()) }) },
      },
    },
    async request => {
      const exists = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        select: { id: true, isPublic: true },
      })
      if (!exists || !exists.isPublic) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      throw new HttpError(503, 'CONTEST_SCORING_UNAVAILABLE', 'Contest standings are unavailable')
    }
  )

  app.post(
    '/:slug/register',
    {
      schema: {
        tags: ['contests'],
        params: ContestSlugParam,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requireAuth],
    },
    async request => {
      const contest = await prisma.contest.findUnique({ where: { slug: request.params.slug } })
      if (!contest || !contest.isPublic) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      throw new HttpError(
        503,
        'CONTEST_UNAVAILABLE',
        'Contest registration is unavailable until scoring is enabled'
      )
    }
  )
}
