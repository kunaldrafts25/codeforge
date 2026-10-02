'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import {
  Clock,
  Trophy,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Send,
  Flag,
  RotateCcw,
} from 'lucide-react'

interface ContestProblem {
  label: string
  problemId: string
  slug: string
  title: string
  points: number
  statementMd?: string
  inputFormat?: string
  outputFormat?: string
  constraints?: string
  samples?: Array<{ input: string; output: string; explanation?: string | null }>
  starters?: Record<string, string>
  languages?: string[]
  solved?: boolean
}

interface Contest {
  id: string
  slug: string
  title: string
  description: string
  format: string
  startTime: string
  endTime: string
  freezeAt: string | null
  isRated: boolean
  divisionMin: number | null
  divisionMax: number | null
  capacity: number
  participantCount: number
  isRegistered: boolean
  isDisqualified: boolean
  problems: ContestProblem[]
}

interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  displayName: string | null
  score: number
  penalty: number
  problems: Record<
    string,
    {
      solved: boolean
      attempts: number
      solveTimeMinutes: number | null
      penaltyMinutes: number
      isPendingFrozen?: boolean
    }
  >
}

interface LeaderboardData {
  contest: {
    id: string
    slug: string
    title: string
    problemLabels: string[]
  }
  isFrozen: boolean
  frozenAt: string | null
  asOfTime: string
  entries: LeaderboardEntry[]
  total: number
}

export default function ContestDetailPage() {
  const { slug } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'problems' | 'standings' | 'disputes'>('problems')
  const [selectedProblem, setSelectedProblem] = useState<ContestProblem | null>(null)
  const [timeLeft, setTimeLeft] = useState('')
  const [status, setStatus] = useState<'upcoming' | 'running' | 'ended'>('upcoming')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')

  // Submission state
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('cpp')
  const [submitting, setSubmitting] = useState(false)
  const [lastSubmissionVerdict, setLastSubmissionVerdict] = useState<string | null>(null)
  const [lastSubmissionId, setLastSubmissionId] = useState<string | null>(null)

  // Dispute state
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeProblemLabel, setDisputeProblemLabel] = useState('A')
  const [showDisputeModal, setShowDisputeModal] = useState(false)

  const fetchContest = useCallback(async () => {
    try {
      const res = await api.get(`/contests/${slug}`)
      setContest(res.data)
      if (res.data.problems && res.data.problems.length > 0 && !selectedProblem) {
        setSelectedProblem(res.data.problems[0])
        const starter = res.data.problems[0].starters?.cpp || ''
        setCode(starter)
      }
    } catch (err) {
      logger.error('Failed to fetch contest:', err)
    } finally {
      setLoading(false)
    }
  }, [slug, selectedProblem])

  const fetchStandings = useCallback(async () => {
    try {
      const res = await api.get(`/contests/${slug}/leaderboard`)
      setLeaderboardData(res.data)
    } catch (err) {
      logger.error('Failed to fetch standings:', err)
    }
  }, [slug])

  useEffect(() => {
    void fetchContest()
  }, [fetchContest])

  useEffect(() => {
    if (activeTab === 'standings') {
      void fetchStandings()
      const interval = setInterval(() => void fetchStandings(), 15000)
      return () => clearInterval(interval)
    }
  }, [activeTab, fetchStandings])

  useEffect(() => {
    if (!contest) return

    const updateTime = () => {
      const now = Date.now()
      const start = new Date(contest.startTime).getTime()
      const end = new Date(contest.endTime).getTime()

      if (now < start) {
        setStatus('upcoming')
        setTimeLeft(formatTime(start - now))
      } else if (now > end) {
        setStatus('ended')
        setTimeLeft('Contest ended')
      } else {
        setStatus('running')
        setTimeLeft(formatTime(end - now))
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [contest])

  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00:00'
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    const secs = Math.floor((ms % (1000 * 60)) / 1000)
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleRegister = async () => {
    setActionError('')
    setActionNotice('')
    setBusy(true)
    try {
      await api.post(`/contests/${slug}/register`)
      setActionNotice('Successfully registered for contest!')
      await fetchContest()
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  const handleWithdraw = async () => {
    if (!confirm('Are you sure you want to withdraw from this contest?')) return
    setActionError('')
    setActionNotice('')
    setBusy(true)
    try {
      await api.post(`/contests/${slug}/withdraw`)
      setActionNotice('Successfully withdrawn from contest')
      await fetchContest()
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Withdrawal failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProblem || !code.trim()) return
    setActionError('')
    setActionNotice('')
    setSubmitting(true)
    setLastSubmissionVerdict('SUBMITTING...')
    try {
      const res = await api.post(`/contests/${slug}/submit`, {
        problemLabel: selectedProblem.label,
        language,
        code,
      })
      setLastSubmissionId(res.data.submissionId)
      setLastSubmissionVerdict(res.data.state ?? 'QUEUED')
      setActionNotice(
        `Submission accepted into judge queue (ID: ${res.data.submissionId.slice(0, 8)}...)`
      )

      // Poll submission status
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const subRes = await api.get(`/submissions/${res.data.submissionId}`)
          if (subRes.data.state === 'FINISHED') {
            setLastSubmissionVerdict(subRes.data.verdict)
            clearInterval(poll)
            setSubmitting(false)
            await fetchContest()
            if (activeTab === 'standings') await fetchStandings()
          } else {
            setLastSubmissionVerdict(subRes.data.state)
          }
        } catch {
          // ignore poll error
        }
        if (attempts > 30) {
          clearInterval(poll)
          setSubmitting(false)
        }
      }, 1500)
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Submission rejected')
      setLastSubmissionVerdict('ERROR')
      setSubmitting(false)
    }
  }

  const handleFileDispute = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!disputeReason.trim()) return
    setActionError('')
    setActionNotice('')
    setBusy(true)
    try {
      await api.post(`/contests/${slug}/disputes`, {
        problemLabel: disputeProblemLabel,
        reason: disputeReason.trim(),
        submissionId: lastSubmissionId || undefined,
      })
      setActionNotice('Contest dispute filed successfully! Contest staff will review it.')
      setShowDisputeModal(false)
      setDisputeReason('')
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to file dispute')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading contest details...
      </div>
    )
  }

  if (!contest) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Contest not found.
      </div>
    )
  }

  const isSealed = status === 'upcoming' && contest.problems.length === 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Action alerts */}
      {actionError && (
        <div className="p-4 rounded-xl bg-destructive/15 border border-destructive text-destructive text-sm font-medium flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="text-xs hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {actionNotice && (
        <div className="p-4 rounded-xl bg-green-500/15 border border-green-500 text-green-600 dark:text-green-400 text-sm font-medium flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice('')} className="text-xs hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Header card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">{contest.title}</h1>
              {contest.isRated ? (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                  Rated
                </span>
              ) : (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                  Unrated
                </span>
              )}
              <span className="text-xs px-2 py-0.5 rounded font-mono font-medium uppercase bg-secondary text-secondary-foreground">
                {contest.format}
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">{contest.description}</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div
              className={cn(
                'px-4 py-2 rounded-xl font-mono text-base font-bold flex items-center gap-2',
                status === 'running'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
                  : status === 'upcoming'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              <Clock className="w-4 h-4" />
              <span>
                {status === 'upcoming'
                  ? `Starts: ${timeLeft}`
                  : status === 'running'
                    ? `Ends: ${timeLeft}`
                    : 'Ended'}
              </span>
            </div>

            {/* Registration button */}
            {!contest.isRegistered ? (
              <button
                onClick={handleRegister}
                disabled={busy || status === 'ended'}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
              >
                {busy ? 'Registering...' : 'Register for Contest'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 font-medium text-xs border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4" /> Registered
                </span>
                {status === 'upcoming' && (
                  <button
                    onClick={handleWithdraw}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-destructive underline"
                  >
                    Withdraw
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 flex flex-wrap items-center justify-between text-xs text-muted-foreground gap-4">
          <div className="flex items-center gap-6">
            <span>Start: {new Date(contest.startTime).toLocaleString()}</span>
            <span>End: {new Date(contest.endTime).toLocaleString()}</span>
            <span>
              Capacity: {contest.participantCount} / {contest.capacity}
            </span>
          </div>
          {contest.freezeAt && (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              Scoreboard freeze: {new Date(contest.freezeAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('problems')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              activeTab === 'problems'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            Problems ({contest.problems.length})
          </button>
          <button
            onClick={() => setActiveTab('standings')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5',
              activeTab === 'standings'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <Trophy className="w-4 h-4" /> Standings
          </button>
        </div>

        {contest.isRegistered && (
          <button
            onClick={() => setShowDisputeModal(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border"
          >
            <Flag className="w-3.5 h-3.5" /> File Contest Dispute
          </button>
        )}
      </div>

      {/* Problems Tab */}
      {activeTab === 'problems' && (
        <div>
          {isSealed ? (
            <div className="bg-card border border-border rounded-2xl p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold">Problems are Sealed</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Problem statements, test sets, and constraints are cryptographically sealed. They
                will automatically be unlocked at {new Date(contest.startTime).toLocaleTimeString()}
                .
              </p>
              <div className="font-mono text-2xl font-bold text-primary">{timeLeft}</div>
            </div>
          ) : contest.problems.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground">
              No problems have been released for this contest.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Problem selector */}
              <div className="lg:col-span-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Problems
                </h3>
                {contest.problems.map(problem => {
                  const isSelected = selectedProblem?.label === problem.label
                  return (
                    <button
                      key={problem.label}
                      onClick={() => {
                        setSelectedProblem(problem)
                        const starter = problem.starters?.[language] || problem.starters?.cpp || ''
                        if (!code || confirm('Switch problem and load starter?')) {
                          setCode(starter)
                        }
                      }}
                      className={cn(
                        'w-full text-left p-3.5 rounded-xl border flex items-center justify-between transition-all',
                        isSelected
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border bg-card hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">
                          {problem.label}
                        </span>
                        <div>
                          <div className="font-semibold text-sm">{problem.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {problem.points} points
                          </div>
                        </div>
                      </div>
                      {problem.solved && (
                        <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Solved
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Problem Workspace */}
              <div className="lg:col-span-8 space-y-6">
                {selectedProblem && (
                  <div className="bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm">
                    <div className="border-b border-border pb-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-primary uppercase tracking-wider">
                          Problem {selectedProblem.label}
                        </div>
                        <h2 className="text-2xl font-bold">{selectedProblem.title}</h2>
                      </div>
                      <div className="text-sm font-mono bg-muted px-3 py-1 rounded-lg">
                        {selectedProblem.points} pts
                      </div>
                    </div>

                    {/* Statement */}
                    {selectedProblem.statementMd && (
                      <div className="prose dark:prose-invert max-w-none text-sm space-y-4">
                        <div className="whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
                          {selectedProblem.statementMd}
                        </div>
                        {selectedProblem.inputFormat && (
                          <div>
                            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-1">
                              Input Format
                            </h4>
                            <p className="whitespace-pre-wrap">{selectedProblem.inputFormat}</p>
                          </div>
                        )}
                        {selectedProblem.outputFormat && (
                          <div>
                            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-1">
                              Output Format
                            </h4>
                            <p className="whitespace-pre-wrap">{selectedProblem.outputFormat}</p>
                          </div>
                        )}
                        {selectedProblem.constraints && (
                          <div>
                            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-1">
                              Constraints
                            </h4>
                            <p className="whitespace-pre-wrap font-mono text-xs">
                              {selectedProblem.constraints}
                            </p>
                          </div>
                        )}
                        {selectedProblem.samples && selectedProblem.samples.length > 0 && (
                          <div className="space-y-3 pt-2">
                            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                              Sample Test Cases
                            </h4>
                            {selectedProblem.samples.map((s, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-2 gap-3 text-xs font-mono bg-muted/40 p-3 rounded-lg border border-border"
                              >
                                <div>
                                  <div className="text-muted-foreground text-[10px] uppercase font-bold mb-1">
                                    Input
                                  </div>
                                  <pre className="whitespace-pre-wrap">{s.input}</pre>
                                </div>
                                <div>
                                  <div className="text-muted-foreground text-[10px] uppercase font-bold mb-1">
                                    Output
                                  </div>
                                  <pre className="whitespace-pre-wrap">{s.output}</pre>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Code Editor and Submit */}
                    <form
                      onSubmit={handleSubmitCode}
                      className="space-y-4 pt-4 border-t border-border"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-semibold uppercase text-muted-foreground">
                            Language
                          </label>
                          <select
                            value={language}
                            onChange={e => {
                              const newLang = e.target.value
                              setLanguage(newLang)
                              if (selectedProblem.starters?.[newLang]) {
                                setCode(selectedProblem.starters[newLang])
                              }
                            }}
                            className="text-xs rounded-lg border border-border bg-background p-1.5 font-medium"
                          >
                            <option value="cpp">C++20 (GCC)</option>
                            <option value="python">Python 3.12</option>
                            <option value="typescript">TypeScript (Node)</option>
                            <option value="java">Java 21</option>
                            <option value="rust">Rust 1.78</option>
                            <option value="go">Go 1.22</option>
                          </select>
                        </div>

                        {lastSubmissionVerdict && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Verdict:</span>
                            <span
                              className={cn(
                                'font-mono font-bold px-2 py-0.5 rounded',
                                lastSubmissionVerdict === 'ACCEPTED'
                                  ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                  : lastSubmissionVerdict === 'QUEUED' ||
                                      lastSubmissionVerdict === 'RUNNING'
                                    ? 'bg-blue-500/20 text-blue-600'
                                    : 'bg-red-500/20 text-red-600 dark:text-red-400'
                              )}
                            >
                              {lastSubmissionVerdict}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <textarea
                          rows={12}
                          required
                          value={code}
                          onChange={e => setCode(e.target.value)}
                          placeholder="// Write your solution here..."
                          className="w-full font-mono text-xs p-4 rounded-xl border border-border bg-muted/20 text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {status === 'running'
                            ? 'Penalty applies for incorrect submissions on solved problems (+20 min).'
                            : 'Contest is not currently running.'}
                        </p>
                        <button
                          type="submit"
                          disabled={submitting || status !== 'running' || !contest.isRegistered}
                          className="px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                          {submitting ? 'Evaluating...' : 'Submit Code'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standings Tab */}
      {activeTab === 'standings' && (
        <div className="space-y-4">
          {leaderboardData?.isFrozen && (
            <div className="p-4 rounded-xl bg-amber-500/15 border border-amber-500 text-amber-700 dark:text-amber-400 text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>
                Scoreboard is frozen as of{' '}
                {leaderboardData.frozenAt
                  ? new Date(leaderboardData.frozenAt).toLocaleTimeString()
                  : 'freeze time'}
                . Submissions during the freeze period appear as pending (?) and will be revealed
                after finalization.
              </span>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>
                As of:{' '}
                {leaderboardData?.asOfTime
                  ? new Date(leaderboardData.asOfTime).toLocaleTimeString()
                  : 'now'}
              </span>
              <button
                onClick={() => void fetchStandings()}
                className="flex items-center gap-1 hover:text-foreground text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Refresh Standings
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left w-16">#</th>
                    <th className="px-4 py-3 text-left">Competitor</th>
                    <th className="px-4 py-3 text-center">Score</th>
                    <th className="px-4 py-3 text-center">Penalty</th>
                    {contest.problems.map(p => (
                      <th key={p.label} className="px-4 py-3 text-center font-bold">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-sans">
                  {!leaderboardData || leaderboardData.entries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4 + contest.problems.length}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        No submissions recorded on the scoreboard yet.
                      </td>
                    </tr>
                  ) : (
                    leaderboardData.entries.map(entry => (
                      <tr key={entry.userId} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-xs">
                          {entry.rank === 1
                            ? '🥇 1'
                            : entry.rank === 2
                              ? '🥈 2'
                              : entry.rank === 3
                                ? '🥉 3'
                                : entry.rank}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {entry.displayName ?? entry.username}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-primary">
                          {entry.score}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                          {entry.penalty}
                        </td>
                        {contest.problems.map(p => {
                          const prob = entry.problems[p.label]
                          if (!prob) {
                            return (
                              <td
                                key={p.label}
                                className="px-4 py-3 text-center text-muted-foreground text-xs"
                              >
                                -
                              </td>
                            )
                          }
                          if (prob.isPendingFrozen) {
                            return (
                              <td key={p.label} className="px-4 py-3 text-center">
                                <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-amber-500/20 text-amber-600">
                                  ?{prob.attempts > 1 ? ` (${prob.attempts})` : ''}
                                </span>
                              </td>
                            )
                          }
                          if (prob.solved) {
                            return (
                              <td key={p.label} className="px-4 py-3 text-center">
                                <div className="font-mono text-xs font-bold text-green-600 dark:text-green-400">
                                  +{prob.attempts > 1 ? prob.attempts - 1 : ''}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {prob.solveTimeMinutes}m
                                </div>
                              </td>
                            )
                          }
                          return (
                            <td
                              key={p.label}
                              className="px-4 py-3 text-center font-mono text-xs text-red-500 font-semibold"
                            >
                              -{prob.attempts}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleFileDispute}
            className="bg-card border border-border rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-lg font-bold">File Contest Dispute</h3>
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Submit a formal dispute regarding a problem specification or submission verdict.
              Contest organizers review disputes before final rating settlement.
            </p>

            <div>
              <label className="text-xs font-semibold block mb-1">Problem Label</label>
              <select
                value={disputeProblemLabel}
                onChange={e => setDisputeProblemLabel(e.target.value)}
                className="w-full text-sm rounded-lg border border-border bg-background p-2"
              >
                {contest.problems.map(p => (
                  <option key={p.label} value={p.label}>
                    Problem {p.label}: {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold block mb-1">Reason / Explanation</label>
              <textarea
                rows={4}
                required
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="Explain the discrepancy or test case issue..."
                className="w-full text-sm rounded-lg border border-border bg-background p-2.5"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="px-4 py-2 border border-border text-sm rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 bg-primary text-primary-foreground font-semibold text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? 'Submitting...' : 'Submit Dispute'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
