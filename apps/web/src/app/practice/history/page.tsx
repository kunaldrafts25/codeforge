'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
type Job = {
  id: string
  language: string
  state: string
  verdict: string | null
  source?: string
  createdAt: string
  diagnostics?: string
  result?: { passed: number; total: number; timeMs: number | null; memoryKb: number | null }
}
export default function PracticeHistoryPage() {
  const { user, loading } = useAuth()
  const [rows, setRows] = useState<Job[]>([])
  const [selected, setSelected] = useState<Job | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [error, setError] = useState('')
  async function open(id: string) {
    try {
      const r = await api.get<Job>(`/practice/jobs/${id}`)
      setSelected(r.data)
      const url = new URL(window.location.href)
      url.searchParams.set('job', id)
      window.history.replaceState(null, '', url)
    } catch {
      setError('This job is unavailable or belongs to another account.')
    }
  }
  useEffect(() => {
    if (!user) return
    void api
      .get('/practice/history', { params: { page, limit: 20 } })
      .then(r => {
        setRows(r.data.rows)
        setPages(r.data.totalPages)
      })
      .catch(() => setError('History could not be loaded. Reload to retry.'))
  }, [user, page])
  useEffect(() => {
    if (!user) return
    const id = new URL(window.location.href).searchParams.get('job')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void open(id)
  }, [user])
  if (loading) return <p role="status">Loading account…</p>
  if (!user)
    return (
      <main className="p-6">
        <Link href="/login">Sign in to view your private history</Link>
      </main>
    )
  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-3xl font-bold">Your practice history</h1>
      <p>History remains available after a problem is withdrawn.</p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {rows.map(j => (
          <li key={j.id}>
            <button className="underline p-2" onClick={() => void open(j.id)}>
              {j.language} · {j.verdict ?? j.state} · {new Date(j.createdAt).toLocaleString()}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-4">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
          Next
        </button>
      </div>
      {selected && (
        <article className="border p-3 space-y-3">
          <h2>Server status: {selected.verdict ?? selected.state}</h2>
          <button onClick={() => void open(selected.id)}>Refresh job</button>
          {selected.result && (
            <p>
              Passed {selected.result.passed}/{selected.result.total}. CPU{' '}
              {selected.result.timeMs ?? 'unavailable'} ms; peak sandbox memory{' '}
              {selected.result.memoryKb ?? 'unavailable'} KiB.
            </p>
          )}
          <pre className="overflow-auto">{selected.source}</pre>
          {selected.diagnostics && <pre className="overflow-auto">{selected.diagnostics}</pre>}
        </article>
      )}
    </main>
  )
}
