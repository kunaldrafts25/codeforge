import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const users = await prisma.user.findMany({
      where: { isBanned: false },
      orderBy: { rating: 'desc' },
      skip,
      take: Number(limit),
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

    const ranked = users.map((u, i) => ({
      rank: skip + i + 1,
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      rating: u.rating,
      maxRating: u.maxRating,
      problemsSolved: u.problemsSolved,
      contestsParticipated: u.contestsCount,
    }))

    res.json({ users: ranked })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to fetch leaderboard' })
  }
})

export default router
