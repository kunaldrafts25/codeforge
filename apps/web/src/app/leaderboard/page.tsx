'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { getRatingColor, getRatingTitle, cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { Trophy, Medal, Award, ChevronLeft, ChevronRight } from 'lucide-react'

interface LeaderboardUser {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  rating: number
  maxRating: number
  problemsSolved: number
  contestsCount: number
}

interface LeaderboardResponse {
  users: LeaderboardUser[]
  total: number
  page: number
  totalPages: number
  asOfTime: string
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse>({
    users: [],
    total: 0,
    page: 1,
    totalPages: 1,
    asOfTime: new Date().toISOString(),
  })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/leaderboard', { params: { page, limit: 50 } })
      setData(res.data)
    } catch (err) {
      logger.error('Failed to fetch leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void fetchLeaderboard()
  }, [fetchLeaderboard])

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-500" />
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />
    if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />
    return <span className="font-mono font-bold text-muted-foreground text-sm">{rank}</span>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Competition Rankings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Official pairwise Elo ratings calculated from ICPC rated contest performances.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">{data.total} active rated competitors</div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-6 py-3.5 text-left w-16">#</th>
                <th className="px-6 py-3.5 text-left">Competitor</th>
                <th className="px-6 py-3.5 text-right">Rating</th>
                <th className="px-6 py-3.5 text-right hidden sm:table-cell">Max Rating</th>
                <th className="px-6 py-3.5 text-right hidden md:table-cell">Contests</th>
                <th className="px-6 py-3.5 text-right hidden md:table-cell">Practice Solved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-muted-foreground">
                    Loading standings...
                  </td>
                </tr>
              ) : data.users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-muted-foreground">
                    No rated competitors on the global leaderboard yet.
                  </td>
                </tr>
              ) : (
                data.users.map(user => (
                  <tr key={user.userId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="w-8 h-8 flex items-center justify-center">
                        {getRankBadge(user.rank)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <span
                          className={cn('font-semibold text-base', getRatingColor(user.rating))}
                        >
                          {user.displayName ?? user.username}
                        </span>
                        <p className="text-xs text-muted-foreground font-mono">@{user.username}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div
                        className={cn('font-bold font-mono text-base', getRatingColor(user.rating))}
                      >
                        {user.rating}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {getRatingTitle(user.rating)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right hidden sm:table-cell font-mono text-muted-foreground">
                      {user.maxRating}
                    </td>
                    <td className="px-6 py-4 text-right hidden md:table-cell font-mono text-muted-foreground">
                      {user.contestsCount}
                    </td>
                    <td className="px-6 py-4 text-right hidden md:table-cell font-mono text-muted-foreground">
                      {user.problemsSolved}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data.totalPages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <div>
              Page {data.page} of {data.totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages || loading}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
