import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { auth } from '../middleware/auth.js'

const router = Router()

// Get user's rating history
router.get('/history', auth, async (req, res) => {
  try {
    const ratingChanges = await prisma.ratingChange.findMany({
      where: { userId: req.user?.id || '' },
      include: {
        contest: {
          select: {
            id: true,
            title: true,
            startTime: true,
          },
        },
      },
      orderBy: { contest: { startTime: 'asc' } },
    })

    res.json(ratingChanges)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch rating history' })
  }
})

// Get user's current rating info
router.get('/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id || '' },
      select: {
        id: true,
        username: true,
        displayName: true,
        rating: true,
        maxRating: true,
        problemsSolved: true,
        contestsCount: true,
      },
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch rating info' })
  }
})

// Get top rated users
router.get('/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const topUsers = await prisma.user.findMany({
      where: { isBanned: false },
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
      orderBy: { rating: 'desc' },
      take: limit,
    })

    res.json(topUsers)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch top users' })
  }
})

// Get rating distribution
router.get('/distribution', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { isBanned: false },
      select: { rating: true },
    })

    // Create rating buckets (1000, 1100, 1200, etc.)
    const distribution: { [key: string]: number } = {}
    for (let rating = 800; rating <= 3000; rating += 100) {
      const bucket = `${rating}-${rating + 99}`
      distribution[bucket] = 0
    }

    users.forEach(user => {
      const bucketStart = Math.floor(user.rating / 100) * 100
      const bucket = `${bucketStart}-${bucketStart + 99}`
      if (distribution[bucket] !== undefined) {
        distribution[bucket]++
      }
    })

    res.json(distribution)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch rating distribution' })
  }
})

export default router
