'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface RatingChange {
  id: string
  oldRating: number
  newRating: number
  change: number
  rank: number
  performance?: number
  contest: {
    id: string
    title: string
    startTime: string
  }
}

export function RatingHistory() {
  const [ratingChanges, setRatingChanges] = useState<RatingChange[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchRatingHistory = async () => {
      try {
        const response = await api.get('/ratings/history')
        setRatingChanges(response.data)
      } catch (error) {
        console.error('Failed to fetch rating history:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRatingHistory()
  }, [])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rating History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (ratingChanges.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rating History</CardTitle>
          <CardDescription>
            Your rating changes from participating in contests
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No rating history yet. Participate in contests to see your rating changes!
          </p>
        </CardContent>
      </Card>
    )
  }

  const getRatingIcon = (change: number) => {
    if (change > 0) return <TrendingUp className="w-4 h-4 text-green-500" />
    if (change < 0) return <TrendingDown className="w-4 h-4 text-red-500" />
    return <Minus className="w-4 h-4 text-gray-500" />
  }

  const getRatingColor = (change: number) => {
    if (change > 0) return 'text-green-600 bg-green-50 border-green-200'
    if (change < 0) return 'text-red-600 bg-red-50 border-red-200'
    return 'text-gray-600 bg-gray-50 border-gray-200'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rating History</CardTitle>
        <CardDescription>
          Your rating changes from participating in contests
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {ratingChanges.map((change) => (
            <div
              key={change.id}
              className="flex items-center justify-between p-4 rounded-lg border bg-card/50"
            >
              <div className="flex-1">
                <div className="font-medium">{change.contest.title}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(change.contest.startTime).toLocaleDateString()} • Rank #{change.rank}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Rating</div>
                  <div className="font-medium">
                    {change.oldRating} → {change.newRating}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`flex items-center gap-1 ${getRatingColor(change.change)}`}
                >
                  {getRatingIcon(change.change)}
                  {change.change > 0 ? '+' : ''}{change.change}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
