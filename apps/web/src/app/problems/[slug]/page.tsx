'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Admin, PRACTICE_LANGUAGES, type PracticeSignature } from '@codeforge/shared'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Problem = {
  id: string
  versionId?: string
  title: string
  statementMd: string
  constraints: string
  inputFormat: string
  outputFormat: string
  languages: (typeof PRACTICE_LANGUAGES)[number][]
  mode: string
  signature: PracticeSignature | null
  samples: { input: string; output: string; explanation: string | null }[]
  starters: Partial<Record<string, string>>
  hints: string[]
  editorial: string
}
type Job = {
  id: string
  language: string
  source?: string
  state: string
  verdict: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  diagnostics?: string
  result?: { passed: number; total: number; timeMs: number | null; memoryKb: number | null }
  samples?: { stdout: string; stderr: string; outcome: string }[]
}
const Markdown = dynamic(() => import('@codeforge/ui').then(m => m.Markdown), { ssr: false })
const defaultCode: Record<string, string> = {
  cpp: '#include <iostream>\nint main() {\n  return 0;\n}\n',
  python: '# Read stdin and write stdout.\n',
  java: 'public class Main {\n  public static void main(String[] args) {\n  }\n}\n',
  javascript: '// Read stdin and write stdout.\n',
}

export default function ProblemPage() {
  const { slug } = useParams()
  const { user, loading: authLoading } = useAuth()
  const [problem, setProblem] = useState<Problem | null>(null)
  const [language, setLanguage] = useState<(typeof PRACTICE_LANGUAGES)[number]>('cpp')
  const [code, setCode] = useState('')
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null)
  const [draftNotice, setDraftNotice] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState('Checking execution availability…')
  const [history, setHistory] = useState<Job[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPages, setHistoryPages] = useState(0)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [executionEnabled, setExecutionEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)
  const submitting = useRef(false)
  const jobId = job?.id
  const jobState = job?.state
  const draftKey =
    user && problem ? `codeforge:practice:${user.id}:${problem.id}:${language}` : null
  const starter = useCallback(() => {
    if (problem?.starters[language]) return problem.starters[language]!
    if (problem?.mode === 'FUNCTIONAL' && problem.signature)
      return Admin.generateStarter(problem.signature, language)
    return defaultCode[language] ?? ''
  }, [problem, language])

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const status = await api.get('/practice/capabilities')
        if (current) {
          setAvailability(status.data.reason)
          setExecutionEnabled(status.data.enabled === true)
        }
        let p: Problem
        try {
          p = (await api.get<Problem>(`/practice/problems/${String(slug)}`)).data
        } catch (e) {
          if ((e as { response?: { status?: number } }).response?.status !== 404) throw e
          const legacy = (await api.get(`/problems/${String(slug)}`)).data
          p = {
            ...legacy,
            mode: legacy.judgeMode,
            signature: null,
            languages: [...PRACTICE_LANGUAGES],
            starters: {},
            hints: [],
            editorial: '',
          }
        }
        if (current) {
          setProblem(p)
          setLanguage(p.languages[0] ?? 'cpp')
        }
      } catch {
        if (current) setError('Problem or sample data is unavailable. Please try again later.')
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => {
      current = false
    }
  }, [slug])

  useEffect(() => {
    if (!problem || authLoading) return
    setLoadedDraftKey(null)
    try {
      const saved = draftKey ? localStorage.getItem(draftKey) : null
      setCode(saved ?? starter())
      setDraftNotice(
        user
          ? 'Drafts are saved in this browser for your account, problem and language.'
          : 'Sign in to preserve your draft in this browser.'
      )
    } catch {
      setCode(starter())
      setDraftNotice('Browser storage is unavailable. Copy your code before leaving.')
    }
    setLoadedDraftKey(draftKey)
  }, [draftKey, starter, problem, authLoading, user])
  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return
    try {
      localStorage.setItem(draftKey, code)
    } catch {
      setDraftNotice('Draft could not be saved. Copy your code before leaving.')
    }
  }, [code, draftKey, loadedDraftKey])

  const loadHistory = useCallback(async () => {
    if (!user) {
      setHistory([])
      return
    }
    try {
      const r = await api.get('/practice/history', { params: { page: historyPage, limit: 20 } })
      setHistory(r.data.rows)
      setHistoryPages(r.data.totalPages)
    } catch {
      setNotice('History could not be loaded. Use Refresh history to retry.')
    }
  }, [user, historyPage])
  useEffect(() => {
    void loadHistory()
  }, [loadHistory])
  const openJob = useCallback(async (id: string) => {
    try {
      const r = await api.get<Job>(`/practice/jobs/${id}`)
      setJob(r.data)
      const url = new URL(window.location.href)
      url.searchParams.set('job', id)
      window.history.replaceState(null, '', url)
    } catch {
      setNotice('This job is unavailable or belongs to another account.')
    }
  }, [])
  async function send(kind: 'sample' | 'custom' | 'submit') {
    if (!problem || !user || submitting.current) return
    const body = {
      problemId: problem.id,
      versionId: problem.versionId,
      language,
      code,
      ...(kind === 'custom' ? { input: customInput } : {}),
    }
    const fingerprint = JSON.stringify([kind, body])
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() }
    submitting.current = true
    setBusy(true)
    setNotice('Sending job…')
    try {
      const response = await api.post(kind === 'submit' ? '/practice/submit' : '/practice/runs', {
        ...body,
        idempotencyKey: pending.current.key,
      })
      pending.current = null
      await openJob(response.data.id)
      await loadHistory()
      setNotice('Job saved. Progress and history are available after reload.')
    } catch (e) {
      setNotice(
        (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Request interrupted. Retry to recover the same job.'
      )
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!user) return
    const id = new URL(window.location.href).searchParams.get('job')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void openJob(id)
  }, [user, openJob])
  useEffect(() => {
    if (!jobId || !jobState || !['QUEUED', 'COMPILING', 'RUNNING'].includes(jobState)) return
    let requests = 0
    const timer = setInterval(() => {
      if (++requests > 30) {
        clearInterval(timer)
        setNotice('Automatic updates paused. Refresh the job to check its server status.')
        return
      }
      void openJob(jobId)
    }, 2000)
    return () => clearInterval(timer)
  }, [jobId, jobState, openJob])

  if (loading)
    return (
      <p className="p-8" role="status">
        Loading problem…
      </p>
    )
  if (!problem)
    return (
      <p className="p-8" role="alert">
        {error}
      </p>
    )
  return (
    <main className="max-w-6xl mx-auto p-4 space-y-6">
      <h1 className="text-3xl font-bold">{problem.title}</h1>
      <p role="status" className="rounded border border-amber-500 p-3">
        {availability}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Problem statement" className="min-w-0 space-y-4">
          <Markdown md={problem.statementMd} />
          <h2 className="text-xl font-semibold">Constraints</h2>
          <Markdown md={problem.constraints} />
          <h2 className="text-xl font-semibold">Input and output</h2>
          <Markdown md={problem.inputFormat} />
          <Markdown md={problem.outputFormat} />
          {problem.samples.map((s, i) => (
            <section key={i} className="border rounded p-3 space-y-2">
              <h3>Sample {i + 1}</h3>
              <p>Input</p>
              <pre className="overflow-auto">{s.input}</pre>
              <p>Expected output</p>
              <pre className="overflow-auto">{s.output}</pre>
              {s.explanation && <Markdown md={s.explanation} />}
            </section>
          ))}
          {problem.hints.map((h, i) => (
            <details key={i}>
              <summary>Hint {i + 1}</summary>
              <Markdown md={h} />
            </details>
          ))}
          {problem.editorial && (
            <details>
              <summary>Editorial</summary>
              <Markdown md={problem.editorial} />
            </details>
          )}
        </section>
        <section aria-label="Code draft" className="min-w-0 space-y-3">
          <label className="block">
            Language
            <select
              aria-label="Language"
              className="block border p-2 bg-background"
              value={language}
              onChange={e => {
                setLoadedDraftKey(null)
                setLanguage(e.target.value as typeof language)
              }}
            >
              {problem.languages.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Code
            <textarea
              aria-label="Code"
              spellCheck={false}
              className="block w-full min-h-80 border p-3 font-mono bg-background"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={65536}
            />
          </label>
          <p role="status">{draftNotice}</p>
          <button
            className="border rounded p-2"
            onClick={() => {
              if (window.confirm('Replace this draft with starter code?')) setCode(starter())
            }}
          >
            Reset to starter
          </button>
          <label className="block">
            Custom input
            <textarea
              aria-label="Custom input"
              className="block w-full border p-2 bg-background"
              maxLength={65536}
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={!executionEnabled || !problem.versionId || !user || busy}
              onClick={() => void send('sample')}
              className="border rounded p-2 disabled:opacity-60"
            >
              Run sample
            </button>
            <button
              disabled={!executionEnabled || !problem.versionId || !user || busy}
              onClick={() => void send('custom')}
              className="border rounded p-2 disabled:opacity-60"
            >
              Run custom input
            </button>
            <button
              disabled={!executionEnabled || !problem.versionId || !user || busy}
              onClick={() => void send('submit')}
              className="border rounded p-2 disabled:opacity-60"
            >
              Submit
            </button>
          </div>
          {!executionEnabled && (
            <p>Run and submit will open after isolated execution is verified.</p>
          )}
          {!user && <p>Sign in to run or submit.</p>}
        </section>
      </div>
      <section aria-label="Submission history" className="space-y-3">
        <h2 className="text-xl font-semibold">Your practice history</h2>
        {!user ? (
          <p>Sign in to view your private history.</p>
        ) : (
          <>
            <button className="border p-2" onClick={() => void loadHistory()}>
              Refresh history
            </button>
            {!history.length && <p>No practice jobs on this page.</p>}
            <ul>
              {history.map(j => (
                <li key={j.id}>
                  <button className="underline p-2" onClick={() => void openJob(j.id)}>
                    {j.language} · {j.verdict ?? j.state} · {new Date(j.createdAt).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>
                Previous
              </button>
              <span>Page {historyPage}</span>
              <button
                disabled={historyPage >= historyPages}
                onClick={() => setHistoryPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {job && (
          <article className="border p-3 space-y-2">
            <p>Server status: {job.verdict ?? job.state}</p>
            <p>{job.startedAt ? 'Execution started.' : 'Waiting for execution.'}</p>
            {job.startedAt && (
              <p>
                Queue wait:{' '}
                {Math.max(0, new Date(job.startedAt).getTime() - new Date(job.createdAt).getTime())}{' '}
                ms
              </p>
            )}
            {job.result && (
              <p>
                Passed {job.result.passed}/{job.result.total}. Execution CPU:{' '}
                {job.result.timeMs ?? 'unavailable'} ms. Sandbox peak memory:{' '}
                {job.result.memoryKb ?? 'unavailable'} KiB.
              </p>
            )}
            {job.diagnostics && (
              <pre className="overflow-auto" aria-label="Compiler diagnostics">
                {job.diagnostics}
              </pre>
            )}
            {job.samples?.map((sample, i) => (
              <pre key={i} className="overflow-auto">
                {sample.outcome}
                {'\n'}
                {sample.stdout}
                {'\n'}
                {sample.stderr}
              </pre>
            ))}
            {['QUEUED', 'COMPILING', 'RUNNING'].includes(job.state) && (
              <button
                onClick={() =>
                  void api
                    .post(`/practice/jobs/${job.id}/cancel`, {})
                    .then(() => openJob(job.id))
                    .catch(() => setNotice('Cancellation could not be confirmed. Refresh the job.'))
                }
              >
                Cancel job
              </button>
            )}
            <button className="underline" onClick={() => void openJob(job.id)}>
              Refresh job
            </button>
            <pre className="overflow-auto">{job.source}</pre>
          </article>
        )}
      </section>
    </main>
  )
}
