import { io, type Socket } from 'socket.io-client'
import { logger } from './logger'

export interface SubmissionUpdate {
  status?: string
  verdict?: string
  testcasesPassed?: number
  totalTestcases?: number
  testCasesPassed?: number
  totalTestCases?: number
  executionTime?: number
  memoryUsed?: number
  message?: string
}

export interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  score: number
  penalty?: number
  rating?: number
  problemScores?: Record<string, { solved: boolean; attempts: number; time: number }>
}

class SocketClient {
  private socket: Socket | null = null

  connect(): Socket | null {
    if (this.socket?.connected) return this.socket

    const token = localStorage.getItem('token')
    this.socket = io(process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5000', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    })

    this.socket.on('connect', () => {
      logger.log('Socket connected')
    })

    this.socket.on('disconnect', () => {
      logger.log('Socket disconnected')
    })

    return this.socket
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  joinContest(contestId: string): void {
    this.socket?.emit('join:contest', contestId)
  }

  leaveContest(contestId: string): void {
    this.socket?.emit('leave:contest', contestId)
  }

  trackSubmission(submissionId: string, onUpdate: (data: SubmissionUpdate) => void): () => void {
    this.socket?.emit('track:submission', submissionId)
    this.socket?.on('submission:status', onUpdate)
    this.socket?.on('submission:verdict', onUpdate)

    return () => {
      this.socket?.off('submission:status', onUpdate)
      this.socket?.off('submission:verdict', onUpdate)
    }
  }

  onLeaderboardUpdate(callback: (data: { entries: LeaderboardEntry[] }) => void): () => void {
    this.socket?.on('leaderboard:update', callback)
    return () => this.socket?.off('leaderboard:update', callback)
  }
}

export const socket = new SocketClient()
