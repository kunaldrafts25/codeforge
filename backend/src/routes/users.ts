import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { auth } from '../middleware/auth.js'

const router = Router()

router.get('/:username', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        rating: true,
        maxRating: true,
        problemsSolved: true,
        contestsCount: true,
        createdAt: true,
      },
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user' })
  }
})

router.patch('/me', auth, async (req, res) => {
  try {
    const { displayName, bio, avatarUrl } = req.body

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayName: displayName || undefined,
        bio: bio || undefined,
        avatarUrl: avatarUrl || undefined,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
      },
    })

    res.json(user)
  } catch (err) {
    res.status(500).json({ message: 'Update failed' })
  }
})

router.get('/:username/submissions', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const submissions = await prisma.submission.findMany({
      where: { userId: user.id },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        problem: { select: { slug: true, title: true } },
        language: true,
        verdict: true,
        executionTime: true,
        submittedAt: true,
      },
    })

    res.json(submissions)
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch submissions' })
  }
})

export default router
