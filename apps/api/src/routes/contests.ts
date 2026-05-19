import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '@codeforge/db'
import { ContestListResponse, ContestSlugParam } from '@codeforge/shared'
import { badRequest, notFound } from '../errors.js'

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
            include: { problem: { select: { id: true, title: true } } },
            orderBy: { label: 'asc' },
          },
          _count: { select: { participants: true } },
        },
      })
      if (!contest) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')

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
          title: cp.problem.title,
          points: cp.points,
        })),
      }
    }
  )

  // Contest leaderboard — Stage 0 returns empty entries until A8 wires the
  // rating engine + Redis ZSET writer.
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
        select: { id: true },
      })
      if (!exists) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      return { entries: [] }
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
      if (!contest) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      if (new Date() > contest.startTime) {
        throw badRequest('REGISTRATION_CLOSED', 'Registration closed')
      }
      await prisma.contestParticipant.upsert({
        where: { contestId_userId: { contestId: contest.id, userId: request.user!.id } },
        create: { contestId: contest.id, userId: request.user!.id },
        update: {},
      })
      return { ok: true }
    }
  )
}
