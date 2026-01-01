'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { Calendar, Users, Timer, ArrowRight } from 'lucide-react'

interface Contest {
  id: string
  slug: string
  title: string
  description: string
  startTime: string
  endTime: string
  participantCount: number
  status: 'upcoming' | 'running' | 'ended'
  isRated: boolean
}

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'running' | 'past'>('upcoming')

  useEffect(() => {
    fetchContests()
  }, [])

  const fetchContests = async () => {
    try {
      const res = await api.get('/contests')
      setContests(res.data)
    } catch (err) {
      console.error('Failed to fetch contests:', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatus = (c: Contest) => {
    const now = new Date()
    const start = new Date(c.startTime)
    const end = new Date(c.endTime)
    if (now < start) return 'upcoming'
    if (now > end) return 'ended'
    return 'running'
  }

  const filtered = contests.filter(c => {
    const status = getStatus(c)
    if (tab === 'upcoming') return status === 'upcoming'
    if (tab === 'running') return status === 'running'
    return status === 'ended'
  })

  const getTimeRemaining = (startTime: string) => {
    const diff = new Date(startTime).getTime() - Date.now()
    if (diff <= 0) return 'Started'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Contests</h1>

      <div className="flex gap-2 mb-6">
        {(['upcoming', 'running', 'past'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No {tab} contests</div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(contest => (
            <Link
              key={contest.id}
              href={`/contests/${contest.slug}`}
              className="block p-6 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">
                      {contest.title}
                    </h2>
                    {contest.isRated && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium">
                        Rated
                      </span>
                    )}
                    {getStatus(contest) === 'running' && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500 font-medium">
                        Live
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                    {contest.description}
                  </p>
                  <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {formatDate(contest.startTime)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Timer className="w-4 h-4" />
                      {getStatus(contest) === 'upcoming'
                        ? `Starts in ${getTimeRemaining(contest.startTime)}`
                        : getStatus(contest) === 'running'
                          ? 'In Progress'
                          : 'Ended'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {contest.participantCount} participants
                    </span>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
