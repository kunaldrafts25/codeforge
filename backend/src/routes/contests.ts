import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { auth, optionalAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
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

    res.json(
      contests.map(c => ({
        ...c,
        participantCount: c._count.participants,
        _count: undefined,
      }))
    )
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch contests' })
  }
})

router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    const contest = await prisma.contest.findUnique({
      where: { slug: req.params.slug },
      include: {
        problems: {
          include: {
            problem: { select: { id: true, title: true } },
          },
          orderBy: { label: 'asc' },
        },
        _count: { select: { participants: true } },
      },
    })

    if (!contest) {
      return res.status(404).json({ message: 'Contest not found' })
    }

    let isRegistered = false
    if (req.user) {
      const participant = await prisma.contestParticipant.findUnique({
        where: {
          contestId_userId: { contestId: contest.id, userId: req.user.id },
        },
      })
      isRegistered = !!participant
    }

    res.json({
      id: contest.id,
      slug: contest.slug,
      title: contest.title,
      description: contest.description,
      startTime: contest.startTime,
      endTime: contest.endTime,
      isRated: contest.isRated,
      status: contest.status,
      participantCount: contest._count.participants,
      isRegistered,
      problems: contest.problems.map(cp => ({
        label: cp.label,
        problemId: cp.problem.id,
        title: cp.problem.title,
        points: cp.points,
        solved: false,
      })),
    })
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch contest' })
  }
})

router.post('/:slug/register', auth, async (req, res) => {
  try {
    const contest = await prisma.contest.findUnique({
      where: { slug: req.params.slug },
    })

    if (!contest) {
      return res.status(404).json({ message: 'Contest not found' })
    }

    const now = new Date()
    if (now > contest.startTime) {
      return res.status(400).json({ message: 'Registration closed' })
    }

    await prisma.contestParticipant.upsert({
      where: {
        contestId_userId: { contestId: contest.id, userId: req.user?.id || '' },
      },
      create: { contestId: contest.id, userId: req.user?.id || '' },
      update: {},
    })

    res.json({ message: 'Registered successfully' })
  } catch (err) {
    res.status(500).json({ message: 'Registration failed' })
  }
})

router.get('/:slug/leaderboard', async (req, res) => {
  try {
    const contest = await prisma.contest.findUnique({
      where: { slug: req.params.slug },
    })

    if (!contest) {
      return res.status(404).json({ message: 'Contest not found' })
    }

    const entries = await prisma.leaderboardEntry.findMany({
      where: { contestId: contest.id },
      orderBy: { rank: 'asc' },
      include: {
        contest: false,
      },
    })

    const users = await prisma.user.findMany({
      where: { id: { in: entries.map(e => e.userId) } },
      select: { id: true, username: true, rating: true },
    })

    const userMap = new Map(users.map(u => [u.id, u]))

    res.json({
      entries: entries.map(e => ({
        rank: e.rank,
        userId: e.userId,
        username: userMap.get(e.userId)?.username || 'Unknown',
        rating: userMap.get(e.userId)?.rating || 1500,
        score: e.score,
        penalty: e.penalty,
        problemScores: e.problemScores,
      })),
    })
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch leaderboard' })
  }
})

export default router
