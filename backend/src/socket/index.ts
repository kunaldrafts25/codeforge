import type { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'

interface AuthSocket extends Socket {
  userId?: string
}

interface JwtPayload {
  userId: string
}

// Leaderboard entry type
interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  score: number
  penalty: number
}

// Contest announcement type
interface ContestAnnouncement {
  id: string
  title: string
  content: string
  timestamp: Date
}

export function setupSocket(io: Server): Server {
  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth.token as string | undefined
    if (!token) return next()

    try {
      const secret = process.env.JWT_SECRET
      if (!secret) {
        return next()
      }
      const payload = jwt.verify(token, secret) as JwtPayload
      socket.userId = payload.userId
    } catch (_err) {
      // Token verification failed, continue without user
    }

    next()
  })

  io.on('connection', (socket: AuthSocket) => {
    process.stdout.write(`Socket connected: ${socket.id} ${socket.userId || 'anonymous'}\n`)

    socket.on('join:contest', (contestId: string) => {
      socket.join(`contest:${contestId}`)
    })

    socket.on('leave:contest', (contestId: string) => {
      socket.leave(`contest:${contestId}`)
    })

    socket.on('track:submission', (submissionId: string) => {
      socket.join(`submission:${submissionId}`)
    })

    socket.on('disconnect', () => {
      process.stdout.write(`Socket disconnected: ${socket.id}\n`)
    })
  })

  return io
}

export function emitLeaderboardUpdate(
  io: Server,
  contestId: string,
  entries: LeaderboardEntry[]
): void {
  io.to(`contest:${contestId}`).emit('leaderboard:update', { entries })
}

export function emitContestAnnouncement(
  io: Server,
  contestId: string,
  announcement: ContestAnnouncement
): void {
  io.to(`contest:${contestId}`).emit('contest:announcement', announcement)
}
