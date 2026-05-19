'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

// Stage-0 stub. A7 (Arena UX) will replace this with the full profile UI:
// solved-problems heatmap, submission history, rating chart, badges, etc.
export default function ProfilePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }
  if (!user) return null

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <header className="flex items-center gap-6 mb-8">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-2xl font-bold">
          {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{user.displayName ?? user.username}</h1>
          <p className="text-muted-foreground">@{user.username}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Rating" value={user.rating} />
        <Stat label="Max rating" value={user.maxRating} />
        <Stat label="Problems solved" value={user.problemsSolved} />
        <Stat label="Contests" value={user.contestsCount} />
      </div>

      <p className="text-sm text-muted-foreground mt-8">
        Full profile (submission history, badges, heatmap, rating graph) is under development.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}
