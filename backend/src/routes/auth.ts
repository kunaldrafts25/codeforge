import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt, { type Secret } from 'jsonwebtoken'

import { prisma } from '../lib/prisma.js'
import { auth } from '../middleware/auth.js'

const router = Router()

// Get JWT config with proper typing
function getJwtConfig(): { secret: Secret; expiresInSeconds: number } {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required')
  }

  // Parse expiresIn - convert to seconds for proper typing
  // Default to 7 days = 604800 seconds
  const expiresInEnv = process.env.JWT_EXPIRES_IN
  let expiresInSeconds = 604800 // 7 days default

  if (expiresInEnv) {
    // Parse common formats like "7d", "24h", "3600"
    const match = expiresInEnv.match(/^(\d+)(d|h|m|s)?$/)
    if (match) {
      const value = parseInt(match[1], 10)
      const unit = match[2] || 's'
      switch (unit) {
        case 'd':
          expiresInSeconds = value * 86400
          break
        case 'h':
          expiresInSeconds = value * 3600
          break
        case 'm':
          expiresInSeconds = value * 60
          break
        default:
          expiresInSeconds = value
      }
    }
  }

  return { secret, expiresInSeconds }
}

router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body as {
      email: string
      username: string
      password: string
    }

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'All fields required' })
    }

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    })

    if (exists) {
      return res.status(400).json({
        message: exists.email === email ? 'Email already in use' : 'Username taken',
      })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        displayName: username,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        rating: true,
        role: true,
      },
    })

    const jwtConfig = getJwtConfig()
    const token = jwt.sign({ userId: user.id }, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresInSeconds,
    })

    res.status(201).json({ user, token })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Registration failed: ${error}\n`)
    res.status(500).json({ message: 'Registration failed' })
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as {
      email: string
      password: string
    }

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }

    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    if (user.isBanned) {
      return res.status(403).json({ message: 'Account banned' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const jwtConfig = getJwtConfig()
    const token = jwt.sign({ userId: user.id }, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresInSeconds,
    })

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        rating: user.rating,
        role: user.role,
      },
      token,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    process.stderr.write(`Login failed: ${error}\n`)
    res.status(500).json({ message: 'Login failed' })
  }
})

router.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        rating: true,
        maxRating: true,
        problemsSolved: true,
        contestsCount: true,
        role: true,
        createdAt: true,
      },
    })

    res.json({ user })
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch user' })
  }
})

export default router
