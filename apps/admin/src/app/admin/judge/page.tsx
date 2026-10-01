'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminShell } from '@/components/AdminShell'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
type Job = {
  id: string
  kind: string
  language: string
  failureCode: string
  attempt: number
  generation: number
}
export default function JudgeOperations() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Job[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ fingerprint: string; key: string }>()
  const allowed = !!user && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
  const refresh = useCallback(async () => {
    if (!allowed) return
    try {
      const response = await api.get(`/practice/staff/jobs?page=${page}&limit=20`)
      setRows(response.data.rows)
      setTotalPages(response.data.totalPages)
    } catch {
      setMessage('Unable to load judge failures. Retry refresh.')
    }
  }, [allowed, page])
  useEffect(() => {
    void refresh()
  }, [refresh])
  async function recover(id: string) {
    if (busy || reason.trim().length < 10) return
    const fingerprint = JSON.stringify([id, reason])
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { fingerprint, key: crypto.randomUUID() }
    }
    setBusy(true)
    try {
      const response = await api.post(`/practice/staff/jobs/${id}/rejudge`, {
        reason,
        idempotencyKey: pending.current.key,
      })
      setMessage(
        `Recovery generation ${response.data.generation} queued as ${response.data.id}. Original evidence is preserved.`
      )
      pending.current = undefined
      await refresh()
    } catch {
      setMessage(
        'Recovery was not confirmed. Retry with the same reason; the request key is preserved.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <AdminShell requireMinRole="ADMIN" allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
      <main className="p-6 max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Judge recovery</h1>
        <p>
          Review the infrastructure cause before retrying. Recovery creates an audited generation
          using the current verified execution policy.
        </p>
        <p role="status">{message}</p>
        <button onClick={() => void refresh()}>Refresh failures</button>
        <label className="block">
          Recovery reason
          <textarea
            className="block border p-2 w-full"
            value={reason}
            maxLength={1000}
            onChange={e => setReason(e.target.value)}
          />
        </label>
        {rows.map(job => (
          <section
            key={job.id}
            aria-label={`Failed job ${job.id}`}
            className="border p-3 break-words"
          >
            <p>
              {job.id}: {job.kind} / {job.language}
            </p>
            <p>
              {job.failureCode}, attempts {job.attempt}, generation {job.generation}
            </p>
            <button
              disabled={busy || !allowed || reason.trim().length < 10}
              onClick={() => void recover(job.id)}
            >
              Queue recovery generation
            </button>
          </section>
        ))}
        {!rows.length && <p>No dead-letter jobs on this page.</p>}
        <div className="flex gap-4">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <p>
            Page {page} of {Math.max(1, totalPages)}
          </p>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </main>
    </AdminShell>
  )
}
