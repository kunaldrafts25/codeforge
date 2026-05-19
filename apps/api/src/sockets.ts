import type { Server as IoServer, Socket } from 'socket.io'
import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import { ACCESS_COOKIE } from './auth/cookies.js'
import { verifyAccessToken } from './auth/tokens.js'
import { loadConfig } from './config.js'
import { logger } from './logger.js'

const config = loadConfig()

interface AuthSocket extends Socket {
  userId?: string
}

let io: IoServer | undefined

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.trim().split('=')
    if (k && v !== undefined) acc[k] = decodeURIComponent(v)
    return acc
  }, {})
}

export function attachSockets(httpServer: HttpServer): IoServer {
  io = new Server(httpServer, {
    cors: { origin: config.FRONTEND_URL, credentials: true },
  })

  io.use((socket: AuthSocket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie)
      const token = cookies[ACCESS_COOKIE]
      if (token) {
        const payload = verifyAccessToken(token)
        socket.userId = payload.sub
      }
    } catch {
      // anonymous
    }
    next()
  })

  io.on('connection', (socket: AuthSocket) => {
    logger.debug({ socketId: socket.id, userId: socket.userId }, 'socket connected')
    socket.on('join:contest', (contestId: string) => socket.join(`contest:${contestId}`))
    socket.on('leave:contest', (contestId: string) => socket.leave(`contest:${contestId}`))
    socket.on('track:submission', (submissionId: string) =>
      socket.join(`submission:${submissionId}`)
    )
    socket.on('disconnect', () => logger.debug({ socketId: socket.id }, 'socket disconnected'))
  })

  return io
}

export function emitToSubmission(submissionId: string, event: string, payload: unknown): void {
  io?.to(`submission:${submissionId}`).emit(event, payload)
}

export function emitToContest(contestId: string, event: string, payload: unknown): void {
  io?.to(`contest:${contestId}`).emit(event, payload)
}

export function getIo(): IoServer | undefined {
  return io
}
