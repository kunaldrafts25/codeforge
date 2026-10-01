'use client'

import { useEffect, useState } from 'react'
import { AdminShell } from '@/components/AdminShell'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Question = {
  id: string
  type: string
  stemMd: string
  payload: unknown
  authorId: string
  section: string
}
type Draft = {
  slug: string
  status: string
  title: string
  durationMinutes: number
  sections: unknown
  questions: Question[]
}

export default function QuizReviewPage() {
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [license, setLicense] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [withdrawalReason, setWithdrawalReason] = useState('')
  useEffect(() => {
    void api
      .get<Draft[]>('/quiz/review/tests')
      .then(r => setDrafts(r.data))
      .catch(() => setError('Could not load drafts.'))
  }, [])
  async function publish(slug: string) {
    setError('')
    try {
      await api.post(`/quiz/review/tests/${slug}/publish`, {
        license,
        sourceUrl: sourceUrl || undefined,
        rightsConfirmed,
      })
      setDrafts(rows => rows.filter(row => row.slug !== slug))
      setNotice(`${slug} published. The audit log records your review.`)
    } catch {
      setError(
        'Publication failed. Check that you are a separate reviewer and every question is valid.'
      )
    }
  }
  async function withdraw(slug: string) {
    setError('')
    try {
      await api.post(`/quiz/review/tests/${slug}/withdraw`, { reason: withdrawalReason })
      setDrafts(rows => rows.filter(row => row.slug !== slug))
      setNotice(`${slug} withdrawn. Existing results remain available to their owners.`)
    } catch {
      setError('Withdrawal failed. Give a reason of at least 10 characters.')
    }
  }
  return (
    <AdminShell requireMinRole="REVIEWER">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-2">Quiz review</h1>
        <p className="mb-6 text-muted-foreground">
          Read each stem and answer key. Record the source and rights basis before publishing.
        </p>
        {error && (
          <p role="alert" className="text-red-600 mb-4">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-4">
            {notice}
          </p>
        )}
        {drafts.length === 0 && <p>No draft or published tests to review.</p>}
        {drafts.map(draft => (
          <section key={draft.slug} className="border border-border rounded-lg p-5 mb-6">
            <h2 className="text-xl font-semibold">
              {draft.title} ({draft.status})
            </h2>
            <p className="mb-4">
              {draft.durationMinutes} minutes · {draft.questions.length} questions
            </p>
            {draft.questions.map((q, i) => (
              <div key={q.id} className="border-t border-border py-4">
                <p className="font-semibold">
                  {i + 1}. {q.stemMd}
                </p>
                <p className="text-sm text-muted-foreground">
                  {q.type} · Author {q.authorId}
                </p>
                <pre className="whitespace-pre-wrap text-sm p-3 mt-2 rounded bg-muted">
                  {JSON.stringify(q.payload, null, 2)}
                </pre>
              </div>
            ))}
            {draft.status === 'draft' ? (
              <div className="space-y-3">
                <label className="block">
                  License or original-work basis
                  <input
                    className="block w-full border rounded p-2"
                    value={license}
                    onChange={e => setLicense(e.target.value)}
                  />
                </label>
                <label className="block">
                  Source URL, if applicable
                  <input
                    type="url"
                    className="block w-full border rounded p-2"
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                  />
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={e => setRightsConfirmed(e.target.checked)}
                  />
                  I checked the answers and confirm the rights basis for every question.
                </label>
                <button
                  disabled={
                    !rightsConfirmed ||
                    license.trim().length < 2 ||
                    draft.questions.some(q => q.authorId === user?.id)
                  }
                  onClick={() => void publish(draft.slug)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
                >
                  Publish reviewed test
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  Withdrawal reason
                  <textarea
                    className="block w-full border rounded p-2"
                    value={withdrawalReason}
                    onChange={e => setWithdrawalReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={withdrawalReason.trim().length < 10}
                  onClick={() => void withdraw(draft.slug)}
                  className="px-4 py-2 border rounded disabled:opacity-50"
                >
                  Withdraw test
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </AdminShell>
  )
}
