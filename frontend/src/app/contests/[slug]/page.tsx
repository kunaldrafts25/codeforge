'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { socket, type LeaderboardEntry } from '@/lib/socket'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { Clock, Trophy, ChevronRight } from 'lucide-react'

interface ContestProblem {
  label: string
  problemId: string
  title: string
  points: number
  solved: boolean
}

interface Contest {
  id: string
  title: string
  description: string
  startTime: string
  endTime: string
  problems: ContestProblem[]
  isRegistered: boolean
  isRated: boolean
}

interface ContestLeaderboardEntry extends LeaderboardEntry {
  problemScores: Record<string, { solved: boolean; attempts: number; time: number }>
}

export default function ContestPage() {
  const params = useParams()
  const slug = params?.slug as string
  const { user } = useAuth()
  const [contest, setContest] = useState<Contest | null>(null)
  const [leaderboard, setLeaderboard] = useState<ContestLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'problems' | 'standings'>('problems')
  const [timeLeft, setTimeLeft] = useState('')
  const [status, setStatus] = useState<'upcoming' | 'running' | 'ended'>('upcoming')

  const fetchContest = useCallback(async () => {
    try {
      const res = await api.get(`/contests/${slug}`)
      setContest(res.data)
    } catch (err) {
      logger.error('Failed to fetch contest:', err)
    } finally {
      setLoading(false)
    }
  }, [slug])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await api.get(`/contests/${slug}/leaderboard`)
      setLeaderboard(res.data.entries || [])
    } catch (err) {
      logger.error('Failed to fetch leaderboard:', err)
    }
  }, [slug])

  useEffect(() => {
    fetchContest()
    fetchLeaderboard()
  }, [fetchContest, fetchLeaderboard])

  useEffect(() => {
    if (!contest) return

    const updateTime = () => {
      const now = Date.now()
      const start = new Date(contest.startTime).getTime()
      const end = new Date(contest.endTime).getTime()

      if (now < start) {
        setStatus('upcoming')
        setTimeLeft(formatTimeLeft(start - now))
      } else if (now > end) {
        setStatus('ended')
        setTimeLeft('Contest ended')
      } else {
        setStatus('running')
        setTimeLeft(formatTimeLeft(end - now))
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [contest])

  useEffect(() => {
    if (!contest || status !== 'running') return

    socket.connect()
    socket.joinContest(contest.id)
    const cleanup = socket.onLeaderboardUpdate(data => {
      setLeaderboard(data.entries as ContestLeaderboardEntry[])
    })

    return () => {
      socket.leaveContest(contest.id)
      cleanup()
    }
  }, [contest, status])

  const handleRegister = async () => {
    try {
      await api.post(`/contests/${slug}/register`)
      setContest(prev => (prev ? { ...prev, isRegistered: true } : null))
    } catch (err) {
      logger.error('Failed to register:', err)
    }
  }

  const formatTimeLeft = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    const secs = Math.floor((ms % (1000 * 60)) / 1000)
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>
    )
  }

  if (!contest) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Contest not found
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{contest.title}</h1>
            <p className="text-muted-foreground">{contest.description}</p>
          </div>
          {user && !contest.isRegistered && status === 'upcoming' && (
            <button
              onClick={handleRegister}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
            >
              Register
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div
            className={cn(
              'px-4 py-2 rounded-lg font-mono text-lg',
              status === 'running'
                ? 'bg-green-500/10 text-green-500'
                : status === 'upcoming'
                  ? 'bg-blue-500/10 text-blue-500'
                  : 'bg-muted text-muted-foreground'
            )}
          >
            <Clock className="w-4 h-4 inline mr-2" />
            {timeLeft}
          </div>
          {contest.isRated && (
            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
              Rated
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('problems')}
          className={cn(
            'px-4 py-2 -mb-px border-b-2 transition-colors',
            activeTab === 'problems'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Problems
        </button>
        <button
          onClick={() => setActiveTab('standings')}
          className={cn(
            'px-4 py-2 -mb-px border-b-2 transition-colors',
            activeTab === 'standings'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Standings
        </button>
      </div>

      {activeTab === 'problems' && (
        <div className="grid gap-3">
          {contest.problems.map(problem => (
            <Link
              key={problem.problemId}
              href={
                status === 'running' || status === 'ended'
                  ? `/problems/${problem.problemId}?contest=${contest.id}`
                  : '#'
              }
              className={cn(
                'flex items-center justify-between p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors',
                status === 'upcoming' && 'opacity-50 pointer-events-none'
              )}
            >
              <div className="flex items-center gap-4">
                <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center">
                  {problem.label}
                </span>
                <div>
                  <h3 className="font-medium">{problem.title}</h3>
                  <p className="text-sm text-muted-foreground">{problem.points} points</p>
                </div>
              </div>
              {problem.solved && <span className="text-green-500">✓ Solved</span>}
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      {activeTab === 'standings' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">#</th>
                <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                <th className="px-4 py-3 text-center text-sm font-medium">Score</th>
                <th className="px-4 py-3 text-center text-sm font-medium">Penalty</th>
                {contest.problems.map(p => (
                  <th key={p.label} className="px-4 py-3 text-center text-sm font-medium">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leaderboard.length === 0 ? (
                <tr>
                  <td
                    colSpan={4 + contest.problems.length}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No submissions yet
                  </td>
                </tr>
              ) : (
                leaderboard.map(entry => (
                  <tr key={entry.userId} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      {entry.rank <= 3 ? (
                        <Trophy
                          className={cn(
                            'w-5 h-5',
                            entry.rank === 1
                              ? 'text-yellow-500'
                              : entry.rank === 2
                                ? 'text-gray-400'
                                : 'text-amber-600'
                          )}
                        />
                      ) : (
                        entry.rank
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{entry.username}</td>
                    <td className="px-4 py-3 text-center font-mono">{entry.score}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{entry.penalty}</td>
                    {contest.problems.map(p => {
                      const ps = entry.problemScores[p.label]
                      return (
                        <td key={p.label} className="px-4 py-3 text-center">
                          {ps?.solved ? (
                            <span className="text-green-500">
                              +{ps.attempts > 1 ? ps.attempts - 1 : ''}
                            </span>
                          ) : ps?.attempts ? (
                            <span className="text-red-500">-{ps.attempts}</span>
                          ) : null}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
