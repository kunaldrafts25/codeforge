'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Trophy, Target } from 'lucide-react'

interface TopUser {
  id: string
  username: string
  displayName?: string
  avatarUrl?: string
  rating: number
  maxRating: number
  problemsSolved: number
  contestsCount: number
}

interface RatingDistribution {
  [key: string]: number
}

export function ContestRatingChanges() {
  const [topUsers, setTopUsers] = useState<TopUser[]>([])
  const [distribution, setDistribution] = useState<RatingDistribution>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('🔍 Fetching rating data...')
        const [topUsersResponse, distributionResponse] = await Promise.all([
          api.get('/ratings/top?limit=10'),
          api.get('/ratings/distribution'),
        ])

        console.log('✅ Top users response:', topUsersResponse.data)
        console.log('✅ Distribution response:', distributionResponse.data)

        setTopUsers(topUsersResponse.data)
        setDistribution(distributionResponse.data)
      } catch (error) {
        console.log('❌ Error fetching rating data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Rated Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="animate-pulse space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-8 bg-muted rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-5 h-5 text-yellow-500" />
      case 2:
        return <Trophy className="w-5 h-5 text-gray-400" />
      case 3:
        return <Trophy className="w-5 h-5 text-amber-600" />
      default:
        return (
          <span className="w-5 h-5 flex items-center justify-center text-sm font-medium text-muted-foreground">
            #{rank}
          </span>
        )
    }
  }

  const getRatingBadgeColor = (rating: number) => {
    if (rating >= 2000) return 'bg-red-500 text-white'
    if (rating >= 1800) return 'bg-orange-500 text-white'
    if (rating >= 1600) return 'bg-purple-500 text-white'
    if (rating >= 1400) return 'bg-blue-500 text-white'
    if (rating >= 1200) return 'bg-green-500 text-white'
    return 'bg-gray-500 text-white'
  }

  const totalUsers = Object.values(distribution).reduce((sum, count) => sum + count, 0)

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Top Rated Users
          </CardTitle>
          <CardDescription>Highest rated programmers on CodeForge</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topUsers.map((user, index) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-card/70 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {getRankIcon(index + 1)}
                  <div>
                    <div className="font-medium">{user.displayName || user.username}</div>
                    <div className="text-sm text-muted-foreground">
                      @{user.username} • {user.problemsSolved} solved
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <Badge className={getRatingBadgeColor(user.rating)}>{user.rating}</Badge>
                  <div className="text-xs text-muted-foreground mt-1">Max: {user.maxRating}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Rating Distribution
          </CardTitle>
          <CardDescription>Distribution of users across rating ranges</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(distribution)
              .filter(([_, count]) => count > 0)
              .sort(([a], [b]) => parseInt(a) - parseInt(b))
              .map(([range, count]) => {
                const percentage = totalUsers > 0 ? (count / totalUsers) * 100 : 0

                return (
                  <div key={range} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{range}</span>
                      <span className="text-muted-foreground">
                        {count} users ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                )
              })}
          </div>

          {totalUsers === 0 && (
            <p className="text-muted-foreground text-center py-8">No rating data available yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
