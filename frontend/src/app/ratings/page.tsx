'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RatingHistory } from '@/components/rating/RatingHistory'
import { ContestRatingChanges } from '@/components/rating/ContestRatingChanges'
import { TrendingUp, Target, BarChart3, History } from 'lucide-react'
import Link from 'next/link'

interface UserRating {
  id: string
  username: string
  displayName?: string
  rating: number
  maxRating: number
  problemsSolved: number
  contestsCount: number
}

export default function RatingsPage() {
  const [userRating, setUserRating] = useState<UserRating | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUserRating = async () => {
      try {
        const token = localStorage.getItem('token')
        if (token) {
          const response = await api.get('/ratings/me')
          setUserRating(response.data)
        }
      } catch (error) {
        // Handle error silently
      } finally {
        setLoading(false)
      }
    }

    fetchUserRating()
  }, [])

  const getRatingBadgeColor = (rating: number) => {
    if (rating >= 2000) return 'bg-red-500 text-white'
    if (rating >= 1800) return 'bg-orange-500 text-white'
    if (rating >= 1600) return 'bg-purple-500 text-white'
    if (rating >= 1400) return 'bg-blue-500 text-white'
    if (rating >= 1200) return 'bg-green-500 text-white'
    return 'bg-gray-500 text-white'
  }

  const getRatingTitle = (rating: number) => {
    if (rating >= 2000) return 'Grandmaster'
    if (rating >= 1800) return 'Master'
    if (rating >= 1600) return 'Candidate Master'
    if (rating >= 1400) return 'Expert'
    if (rating >= 1200) return 'Pupil'
    return 'Newbie'
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent">
          Rating System
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Track your competitive programming progress with our ELO-based rating system. Climb the
          ranks and compete with the best!
        </p>
      </div>

      {/* User Rating Card */}
      {userRating ? (
        <Card className="bg-gradient-to-r from-primary/10 to-emerald-500/10 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Your Rating
            </CardTitle>
            <CardDescription>Your current competitive programming rating</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold mb-2">{userRating.rating}</div>
                <Badge className={getRatingBadgeColor(userRating.rating)}>
                  {getRatingTitle(userRating.rating)}
                </Badge>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-primary">{userRating.maxRating}</div>
                <div className="text-sm text-muted-foreground">Max Rating</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-primary">
                  {userRating.problemsSolved}
                </div>
                <div className="text-sm text-muted-foreground">Problems Solved</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-primary">
                  {userRating.contestsCount}
                </div>
                <div className="text-sm text-muted-foreground">Contests</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Join the Competition</CardTitle>
            <CardDescription>Sign up to track your rating and compete with others</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Link href="/register">
              <Button>Sign Up</Button>
            </Link>
            <Link href="/login">
              <Button variant="outline">Login</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Rating Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="text-center">
          <CardHeader>
            <History className="w-8 h-8 mx-auto text-primary mb-2" />
            <CardTitle>Rating History</CardTitle>
            <CardDescription>Track your rating changes over time</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              View your complete rating history and see how you&apos;ve improved through contests.
            </p>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <Target className="w-8 h-8 mx-auto text-primary mb-2" />
            <CardTitle>Top Rated Users</CardTitle>
            <CardDescription>See the best programmers on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Explore the leaderboard and see where you stand among the top competitors.
            </p>
          </CardContent>
        </Card>

        <Card className="text-center">
          <CardHeader>
            <BarChart3 className="w-8 h-8 mx-auto text-primary mb-2" />
            <CardTitle>Rating Distribution</CardTitle>
            <CardDescription>Understand the rating distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              See how ratings are distributed across all users on the platform.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rating Components */}
      <div className="space-y-8">
        {userRating && <RatingHistory />}
        <ContestRatingChanges />
      </div>

      {/* Call to Action */}
      <Card className="bg-gradient-to-r from-primary/5 to-emerald-500/5 border-primary/10">
        <CardContent className="text-center py-8">
          <h3 className="text-2xl font-semibold mb-4">Ready to Improve Your Rating?</h3>
          <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
            Participate in contests, solve problems, and climb the leaderboard. Every contest is an
            opportunity to showcase your skills and improve your rating.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/contests">
              <Button size="lg">Browse Contests</Button>
            </Link>
            <Link href="/problems">
              <Button variant="outline" size="lg">
                Practice Problems
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
