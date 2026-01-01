'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { getRatingColor, getRatingTitle, cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { Trophy, Medal, Award } from 'lucide-react'

interface LeaderboardUser {
  rank: number
  userId: string
  username: string
  displayName: string
  rating: number
  maxRating: number
  problemsSolved: number
  contestsParticipated: number
}

export default function LeaderboardPage() {
  const [users, setUsers] = useState<LeaderboardUser[]>([])
  const [loading, setLoading] = useState(true)
  const [page] = useState(1)

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/leaderboard', { params: { page, limit: 50 } })
      setUsers(res.data.users)
    } catch (err) {
      logger.error('Failed to fetch leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-500" />
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />
    if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />
    return <span className="text-muted-foreground">{rank}</span>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Leaderboard</h1>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-medium w-16">#</th>
              <th className="px-6 py-4 text-left text-sm font-medium">User</th>
              <th className="px-6 py-4 text-right text-sm font-medium">Rating</th>
              <th className="px-6 py-4 text-right text-sm font-medium hidden md:table-cell">
                Solved
              </th>
              <th className="px-6 py-4 text-right text-sm font-medium hidden md:table-cell">
                Contests
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                  No users yet
                </td>
              </tr>
            ) : (
              users.map(user => (
                <tr key={user.userId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="w-8 h-8 flex items-center justify-center">
                      {getRankIcon(user.rank)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <span className={cn('font-medium', getRatingColor(user.rating))}>
                        {user.displayName || user.username}
                      </span>
                      <p className="text-sm text-muted-foreground">@{user.username}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className={cn('font-bold', getRatingColor(user.rating))}>
                      {user.rating}
                    </span>
                    <p className="text-xs text-muted-foreground">{getRatingTitle(user.rating)}</p>
                  </td>
                  <td className="px-6 py-4 text-right hidden md:table-cell text-muted-foreground">
                    {user.problemsSolved}
                  </td>
                  <td className="px-6 py-4 text-right hidden md:table-cell text-muted-foreground">
                    {user.contestsParticipated}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
