'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { Calendar, Users, Timer, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react'

interface Contest {
  id: string
  slug: string
  title: string
  description: string
  format: string
  startTime: string
  endTime: string
  freezeAt: string | null
  participantCount: number
  capacity: number
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'ENDED' | 'FINALIZED' | 'CANCELLED'
  isRated: boolean
  divisionMin: number | null
  divisionMax: number | null
  isRegistered?: boolean
}

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'running' | 'upcoming' | 'past'>('running')

  useEffect(() => {
    fetchContests()
  }, [])

  const fetchContests = async () => {
    try {
      const res = await api.get('/contests')
      setContests(res.data)
    } catch (err) {
      logger.error('Failed to fetch contests:', err)
    } finally {
      setLoading(false)
    }
  }

  const getContestCategory = (c: Contest): 'running' | 'upcoming' | 'past' => {
    const now = new Date().getTime()
    const start = new Date(c.startTime).getTime()
    const end = new Date(c.endTime).getTime()
    if (c.status === 'RUNNING' || (now >= start && now < end && c.status !== 'CANCELLED')) {
      return 'running'
    }
    if (now < start && c.status !== 'CANCELLED') {
      return 'upcoming'
    }
    return 'past'
  }

  const filtered = contests.filter(c => getContestCategory(c) === tab)

  const getTimeRemaining = (startTime: string) => {
    const diff = new Date(startTime).getTime() - Date.now()
    if (diff <= 0) return 'In Progress'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  const getDuration = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime()
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${mins > 0 ? `${mins}m` : ''}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Competitive Contests</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Official ICPC algorithmic contests with pairwise Elo ratings and live standings.
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border pb-3">
        {(['running', 'upcoming', 'past'] as const).map(t => {
          const count = contests.filter(c => getContestCategory(c) === t).length
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize flex items-center gap-2',
                tab === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              )}
            >
              {t === 'running' ? 'Live Now' : t}
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-background/20 font-mono">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading contests...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <p className="text-muted-foreground">
            No {tab === 'running' ? 'live' : tab} contests currently.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(contest => {
            const category = getContestCategory(contest)
            return (
              <Link
                key={contest.id}
                href={`/contests/${contest.slug}`}
                className="block p-6 bg-card border border-border rounded-xl hover:border-primary/50 transition-all shadow-sm group"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold group-hover:text-primary transition-colors">
                        {contest.title}
                      </h2>
                      {contest.isRegistered && (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Registered
                        </span>
                      )}
                      {contest.isRated ? (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                          Rated {contest.divisionMax ? `(Rating < ${contest.divisionMax})` : ''}
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          Unrated
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded font-mono font-medium uppercase bg-secondary text-secondary-foreground">
                        {contest.format}
                      </span>
                    </div>

                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {contest.description || 'Official competitive programming challenge.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        {new Date(contest.startTime).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Timer className="w-4 h-4" />
                        Duration: {getDuration(contest.startTime, contest.endTime)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        {contest.participantCount} / {contest.capacity} Registered
                      </div>
                      {contest.freezeAt && (
                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                          <ShieldCheck className="w-4 h-4" />
                          Scoreboard Freeze Enabled
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {category === 'upcoming' && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Starts in</div>
                        <div className="text-lg font-mono font-bold text-primary">
                          {getTimeRemaining(contest.startTime)}
                        </div>
                      </div>
                    )}
                    {category === 'running' && (
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-600 dark:text-green-400 animate-pulse">
                          Live Now
                        </span>
                      </div>
                    )}
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
