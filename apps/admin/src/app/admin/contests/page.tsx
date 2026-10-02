'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminShell } from '@/components/AdminShell'
import { api } from '@/lib/api'

type Contest = {
  id: string
  slug: string
  title: string
  description: string
  format: string
  status: string
  startTime: string
  endTime: string
  freezeAt: string | null
  isRated: boolean
  divisionMin: number | null
  divisionMax: number | null
  capacity: number
  activeManifestId: string | null
  activeManifest?: {
    id: string
    revision: number
    manifestHash: string
    problems: {
      orderIndex: number
      label: string
      problemId: string
      versionId: string
      points: number
      title: string
    }[]
  } | null
  participantsCount?: number
  _count?: {
    participants: number
    submissions: number
  }
}

type Dispute = {
  id: string
  contestId: string
  userId: string
  submissionId: string | null
  problemLabel: string
  reason: string
  status: string
  resolutionNotes: string | null
  createdAt: string
  user?: { username: string }
}

const inputClass =
  'block w-full rounded border border-border bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { message?: string } } }).response
    if (res?.data?.message) return res.data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export default function AdminContestsPage() {
  const [contests, setContests] = useState<Contest[]>([])
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null)
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [newFreezeAt, setNewFreezeAt] = useState('')
  const [newIsRated, setNewIsRated] = useState(true)
  const [newDivisionMin, setNewDivisionMin] = useState<string>('')
  const [newDivisionMax, setNewDivisionMax] = useState<string>('')
  const [newCapacity, setNewCapacity] = useState('5000')

  // Manifest authoring state
  const [manifestProblems, setManifestProblems] = useState<
    {
      orderIndex: number
      label: string
      problemId: string
      versionId: string
      points: number
      title: string
    }[]
  >([])
  const [problemLabel, setProblemLabel] = useState('A')
  const [problemIdInput, setProblemIdInput] = useState('')
  const [versionIdInput, setVersionIdInput] = useState('')
  const [problemTitleInput, setProblemTitleInput] = useState('')
  const [problemPointsInput, setProblemPointsInput] = useState('1')

  // Dispute resolution state
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null)
  const [resolutionStatus, setResolutionStatus] = useState<'RESOLVED' | 'REJECTED'>('RESOLVED')
  const [resolutionNotes, setResolutionNotes] = useState('')

  // Rejudge state
  const [rejudgeSubmissionId, setRejudgeSubmissionId] = useState('')
  const [rejudgeReason, setRejudgeReason] = useState('')

  const fetchContests = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/contests')
      setContests(res.data)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load contests'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchContests()
  }, [fetchContests])

  const selectContest = async (c: Contest) => {
    setError('')
    setNotice('')
    try {
      const res = await api.get(`/contests/${c.slug}`)
      setSelectedContest(res.data)
      if (res.data.activeManifest?.problems) {
        setManifestProblems(res.data.activeManifest.problems)
      } else {
        setManifestProblems([])
      }
      // Load disputes if reviewer or admin
      try {
        const disputeRes = await api.get(`/contests/${c.slug}/disputes`)
        setDisputes(disputeRes.data.disputes ?? [])
      } catch {
        setDisputes([])
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch contest details'))
    }
  }

  const handleCreateContest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const payload = {
        title: newTitle.trim(),
        slug: newSlug.trim().toLowerCase(),
        description: newDescription.trim(),
        format: 'icpc-binary-v1' as const,
        startTime: new Date(newStartTime).toISOString(),
        endTime: new Date(newEndTime).toISOString(),
        freezeAt: newFreezeAt ? new Date(newFreezeAt).toISOString() : null,
        isRated: newIsRated,
        divisionMin: newDivisionMin ? Number(newDivisionMin) : null,
        divisionMax: newDivisionMax ? Number(newDivisionMax) : null,
        capacity: Number(newCapacity) || 5000,
      }
      const res = await api.post('/contests', payload)
      setNotice(`Contest "${res.data.title}" created successfully!`)
      setShowCreate(false)
      await fetchContests()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create contest'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddProblem = () => {
    if (!problemIdInput || !versionIdInput || !problemLabel) {
      setError('Please fill Problem ID, Version ID, and Label')
      return
    }
    const nextOrder = manifestProblems.length
    setManifestProblems([
      ...manifestProblems,
      {
        orderIndex: nextOrder,
        label: problemLabel.trim().toUpperCase(),
        problemId: problemIdInput.trim(),
        versionId: versionIdInput.trim(),
        points: Number(problemPointsInput) || 1,
        title: problemTitleInput.trim() || `Problem ${problemLabel.trim().toUpperCase()}`,
      },
    ])
    setProblemLabel(String.fromCharCode(problemLabel.charCodeAt(0) + 1))
    setProblemIdInput('')
    setVersionIdInput('')
    setProblemTitleInput('')
  }

  const handleRemoveProblem = (idx: number) => {
    const updated = manifestProblems
      .filter((_, i) => i !== idx)
      .map((p, i) => ({ ...p, orderIndex: i }))
    setManifestProblems(updated)
  }

  const handleSaveDraftManifest = async () => {
    if (!selectedContest) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api.put(`/contests/${selectedContest.slug}/manifest`, {
        problems: manifestProblems,
      })
      setNotice('Draft manifest saved successfully')
      await selectContest(selectedContest)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save manifest draft'))
    } finally {
      setBusy(false)
    }
  }

  const handleSealManifest = async () => {
    if (!selectedContest) return
    if (
      !confirm(
        'Are you sure you want to seal this contest manifest? Problem versions and SHA-256 hash will be permanently immutable!'
      )
    ) {
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const res = await api.post(`/contests/${selectedContest.slug}/seal`, {
        problems: manifestProblems,
        sealReason: 'Authoritative contest problem set sealed by contest administrator.',
      })
      setNotice(`Manifest sealed successfully! Hash: ${res.data.manifestHash}`)
      await selectContest(selectedContest)
      await fetchContests()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to seal manifest'))
    } finally {
      setBusy(false)
    }
  }

  const handleFinalizeContest = async () => {
    if (!selectedContest) return
    if (
      !confirm(
        'Are you sure you want to finalize this contest? Standings will be finalized, ratings updated across all participants, and unfreezing completed.'
      )
    ) {
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const res = await api.post(`/contests/${selectedContest.slug}/finalize`, {
        settlementNotes: 'Official contest finalization and rating settlement.',
      })
      setNotice(
        `Contest finalized successfully! Processed participants: ${res.data.participantsCount}`
      )
      await selectContest(selectedContest)
      await fetchContests()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to finalize contest'))
    } finally {
      setBusy(false)
    }
  }

  const handleResolveDispute = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedContest || !selectedDispute) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api.post(`/contests/${selectedContest.slug}/disputes/${selectedDispute.id}/resolve`, {
        status: resolutionStatus,
        resolutionNotes: resolutionNotes.trim(),
      })
      setNotice(`Dispute marked as ${resolutionStatus}`)
      setSelectedDispute(null)
      setResolutionNotes('')
      const disputeRes = await api.get(`/contests/${selectedContest.slug}/disputes`)
      setDisputes(disputeRes.data.disputes ?? [])
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to resolve dispute'))
    } finally {
      setBusy(false)
    }
  }

  const handleRejudgeSubmission = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedContest || !rejudgeSubmissionId) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api.post(
        `/contests/${selectedContest.slug}/submissions/${rejudgeSubmissionId.trim()}/rejudge`,
        {
          correctionType: 'CORRECTION_REJUDGE',
          reason: rejudgeReason.trim() || 'Manual rejudge initiated by contest administrator.',
        }
      )
      setNotice(`Submission ${rejudgeSubmissionId} rejudge enqueued successfully!`)
      setRejudgeSubmissionId('')
      setRejudgeReason('')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to enqueue rejudge'))
    } finally {
      setBusy(false)
    }
  }

  const handleReplayContests = async () => {
    if (!selectedContest) return
    if (
      !confirm(
        'Replay will recalculate ratings sequentially across this contest and all subsequent rated contests. Proceed?'
      )
    ) {
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const res = await api.post(`/contests/${selectedContest.slug}/replay`, {
        reason: 'Chronological replay triggered by administrator.',
      })
      setNotice(`Replay completed across ${res.data.replayedContestsCount} contests!`)
      await selectContest(selectedContest)
      await fetchContests()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to execute replay'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminShell
      requireMinRole="PROBLEM_SETTER"
      allowedRoles={['PROBLEM_SETTER', 'REVIEWER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']}
    >
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Contest Management</h1>
            <p className="text-muted-foreground text-sm">
              Author, seal manifests, monitor live ICPC contests, settle Elo ratings, and resolve
              disputes.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 text-sm"
          >
            {showCreate ? 'Close Form' : '+ New Contest'}
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-md bg-destructive/15 border border-destructive text-destructive text-sm font-medium">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-4 rounded-md bg-green-500/15 border border-green-500 text-green-600 dark:text-green-400 text-sm font-medium">
            {notice}
          </div>
        )}

        {showCreate && (
          <form
            onSubmit={handleCreateContest}
            className="p-6 bg-card border border-border rounded-xl space-y-4 shadow-sm"
          >
            <h2 className="text-xl font-bold">Create New Contest</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="CodeForge Round 1 (ICPC Div. 2)"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Slug
                </label>
                <input
                  type="text"
                  required
                  placeholder="codeforge-round-1"
                  value={newSlug}
                  onChange={e => setNewSlug(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="ICPC rules contest featuring 6 algorithmic challenges."
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Start Time (Local / UTC)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newStartTime}
                  onChange={e => setNewStartTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newEndTime}
                  onChange={e => setNewEndTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Freeze Scoreboard At (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={newFreezeAt}
                  onChange={e => setNewFreezeAt(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                  Capacity (Competitors)
                </label>
                <input
                  type="number"
                  min="1"
                  max="50000"
                  value={newCapacity}
                  onChange={e => setNewCapacity(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  id="ratedCheck"
                  checked={newIsRated}
                  onChange={e => setNewIsRated(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary w-4 h-4"
                />
                <label htmlFor="ratedCheck" className="text-sm font-medium">
                  Rated Contest (Calculates pairwise Elo)
                </label>
              </div>
              {newIsRated && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                      Min Rating
                    </label>
                    <input
                      type="number"
                      placeholder="0"
                      value={newDivisionMin}
                      onChange={e => setNewDivisionMin(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
                      Max Rating
                    </label>
                    <input
                      type="number"
                      placeholder="2100"
                      value={newDivisionMax}
                      onChange={e => setNewDivisionMax(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="pt-2 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-border text-sm rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 text-sm disabled:opacity-50"
              >
                {busy ? 'Creating...' : 'Save & Publish Contest'}
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contests list */}
          <div className="lg:col-span-1 bg-card border border-border rounded-xl p-4 space-y-3">
            <h2 className="font-bold text-lg border-b border-border pb-2">Contests</h2>
            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Loading contests...
              </div>
            ) : contests.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No contests found.
              </div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {contests.map(c => {
                  const isSelected = selectedContest?.id === c.id
                  return (
                    <div
                      key={c.id}
                      onClick={() => void selectContest(c)}
                      className={`p-3 rounded-lg border text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-foreground truncate">{c.title}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${
                            c.status === 'RUNNING'
                              ? 'bg-green-500/20 text-green-600'
                              : c.status === 'FINALIZED'
                                ? 'bg-blue-500/20 text-blue-600'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.startTime).toLocaleDateString()} &bull;{' '}
                        {c.isRated ? 'Rated' : 'Unrated'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Selected Contest details and manifest authoring */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedContest ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
                Select a contest from the list to author manifest, manage status, finalize, or
                resolve disputes.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Contest details bar */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{selectedContest.title}</h2>
                      <p className="text-xs text-muted-foreground font-mono">
                        Slug: {selectedContest.slug} &bull; ID: {selectedContest.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider bg-primary/20 text-primary">
                        {selectedContest.status}
                      </span>
                      {selectedContest.isRated && (
                        <span className="text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-600">
                          Rated
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground block">Format:</span>
                      <span className="font-mono font-medium">{selectedContest.format}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Start Time:</span>
                      <span className="font-medium">
                        {new Date(selectedContest.startTime).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">End Time:</span>
                      <span className="font-medium">
                        {new Date(selectedContest.endTime).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Freeze At:</span>
                      <span className="font-medium">
                        {selectedContest.freezeAt
                          ? new Date(selectedContest.freezeAt).toLocaleString()
                          : 'None'}
                      </span>
                    </div>
                  </div>

                  {/* Manifest Status */}
                  <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                    <div>
                      <span className="text-muted-foreground">Active Manifest: </span>
                      {selectedContest.activeManifest ? (
                        <span className="font-mono text-green-600 font-semibold">
                          Sealed (rev {selectedContest.activeManifest.revision}, hash{' '}
                          {selectedContest.activeManifest.manifestHash.slice(0, 12)}...)
                        </span>
                      ) : (
                        <span className="font-mono text-amber-600 font-semibold">
                          Unsealed / Draft
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {selectedContest.status === 'ENDED' && (
                        <button
                          onClick={handleFinalizeContest}
                          disabled={busy}
                          className="px-3 py-1.5 bg-green-600 text-white font-medium rounded hover:bg-green-700 disabled:opacity-50 text-xs"
                        >
                          Finalize Contest & Compute Ratings
                        </button>
                      )}
                      {['FINALIZED', 'ENDED'].includes(selectedContest.status) && (
                        <button
                          onClick={handleReplayContests}
                          disabled={busy}
                          className="px-3 py-1.5 bg-secondary text-secondary-foreground font-medium rounded hover:bg-secondary/80 disabled:opacity-50 text-xs"
                        >
                          Replay All Dependent Contests
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Manifest Problem Editor */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Contest Problem Manifest</h3>
                    {selectedContest.activeManifest && (
                      <span className="text-xs bg-green-500/10 text-green-600 px-2 py-1 rounded font-medium">
                        Manifest Sealed & Sealed Immutable
                      </span>
                    )}
                  </div>

                  {/* Current problems list */}
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Label</th>
                          <th className="px-3 py-2 text-left">Title</th>
                          <th className="px-3 py-2 text-left">Problem ID</th>
                          <th className="px-3 py-2 text-left">Version ID</th>
                          <th className="px-3 py-2 text-center">Points</th>
                          {!selectedContest.activeManifest && (
                            <th className="px-3 py-2 text-right">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {manifestProblems.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-6 text-center text-muted-foreground text-xs"
                            >
                              No problems added to manifest yet.
                            </td>
                          </tr>
                        ) : (
                          manifestProblems.map((p, idx) => (
                            <tr key={idx} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-bold text-primary">{p.label}</td>
                              <td className="px-3 py-2 font-medium">{p.title}</td>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {p.problemId.slice(0, 8)}...
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {p.versionId.slice(0, 8)}...
                              </td>
                              <td className="px-3 py-2 text-center font-mono">{p.points}</td>
                              {!selectedContest.activeManifest && (
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => handleRemoveProblem(idx)}
                                    className="text-xs text-destructive hover:underline"
                                  >
                                    Remove
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Add problem inputs if not sealed */}
                  {!selectedContest.activeManifest && (
                    <div className="p-4 bg-muted/30 border border-border rounded-lg space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Add Problem to Manifest
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">Label</label>
                          <input
                            type="text"
                            value={problemLabel}
                            onChange={e => setProblemLabel(e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs text-muted-foreground block mb-1">
                            Problem ID (UUID)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. 1a2b3c4d-..."
                            value={problemIdInput}
                            onChange={e => setProblemIdInput(e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs text-muted-foreground block mb-1">
                            Version ID (UUID)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. 9z8y7x6w-..."
                            value={versionIdInput}
                            onChange={e => setVersionIdInput(e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="text-xs text-muted-foreground block mb-1">
                            Display Title (Optional)
                          </label>
                          <input
                            type="text"
                            placeholder="Two Sum"
                            value={problemTitleInput}
                            onChange={e => setProblemTitleInput(e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">Points</label>
                          <input
                            type="number"
                            value={problemPointsInput}
                            onChange={e => setProblemPointsInput(e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={handleAddProblem}
                            className="w-full py-2 bg-secondary text-secondary-foreground text-xs font-medium rounded-md hover:bg-secondary/80"
                          >
                            + Add Item
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-3">
                        <button
                          type="button"
                          onClick={handleSaveDraftManifest}
                          disabled={busy || manifestProblems.length === 0}
                          className="px-4 py-2 border border-border text-xs rounded hover:bg-muted"
                        >
                          Save Draft
                        </button>
                        <button
                          type="button"
                          onClick={handleSealManifest}
                          disabled={busy || manifestProblems.length === 0}
                          className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90"
                        >
                          Seal Manifest (Lock)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rejudge and Disputes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Rejudge Tool */}
                  <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-bold">Correction & Rejudge</h3>
                    <p className="text-xs text-muted-foreground">
                      Enqueue a contest submission for re-evaluation with updated execution policies
                      or corrected tests.
                    </p>
                    <form onSubmit={handleRejudgeSubmission} className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">
                          Submission ID (UUID)
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                          value={rejudgeSubmissionId}
                          onChange={e => setRejudgeSubmissionId(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">
                          Correction Reason
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Fixed test case 4 time limit / memory limits"
                          value={rejudgeReason}
                          onChange={e => setRejudgeReason(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 disabled:opacity-50"
                      >
                        {busy ? 'Enqueuing...' : 'Rejudge Submission'}
                      </button>
                    </form>
                  </div>

                  {/* Disputes List */}
                  <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-bold">Contest Disputes ({disputes.length})</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {disputes.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-6">
                          No disputes filed for this contest.
                        </div>
                      ) : (
                        disputes.map(d => (
                          <div
                            key={d.id}
                            onClick={() => setSelectedDispute(d)}
                            className="p-3 rounded border border-border text-xs space-y-1 hover:bg-muted/40 cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-primary">
                                Problem {d.problemLabel}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded font-mono ${
                                  d.status === 'RESOLVED'
                                    ? 'bg-green-500/20 text-green-600'
                                    : 'bg-amber-500/20 text-amber-600'
                                }`}
                              >
                                {d.status}
                              </span>
                            </div>
                            <p className="text-muted-foreground truncate">{d.reason}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {selectedDispute && (
                      <form
                        onSubmit={handleResolveDispute}
                        className="p-3 bg-muted/40 rounded border border-border space-y-2 text-xs"
                      >
                        <div className="font-semibold text-foreground">
                          Resolve Dispute on Problem {selectedDispute.problemLabel}
                        </div>
                        <p className="text-muted-foreground italic">
                          &ldquo;{selectedDispute.reason}&rdquo;
                        </p>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="resStatus"
                              checked={resolutionStatus === 'RESOLVED'}
                              onChange={() => setResolutionStatus('RESOLVED')}
                            />
                            Resolve
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="resStatus"
                              checked={resolutionStatus === 'REJECTED'}
                              onChange={() => setResolutionStatus('REJECTED')}
                            />
                            Reject
                          </label>
                        </div>
                        <textarea
                          rows={2}
                          required
                          placeholder="Resolution details and explanation..."
                          value={resolutionNotes}
                          onChange={e => setResolutionNotes(e.target.value)}
                          className={inputClass}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedDispute(null)}
                            className="px-2 py-1 border border-border rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={busy}
                            className="px-3 py-1 bg-primary text-primary-foreground font-medium rounded disabled:opacity-50"
                          >
                            Submit Resolution
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
