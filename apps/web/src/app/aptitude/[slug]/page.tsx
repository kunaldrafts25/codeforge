'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Test = {
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  questionCount: number
}

export default function TestIntro() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [test, setTest] = useState<Test | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api
      .get<Test>(`/quiz/tests/${slug}`)
      .then(r => setTest(r.data))
      .catch(() => setError('Test unavailable.'))
  }, [slug])
  async function start() {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    setBusy(true)
    try {
      const { data } = await api.post<{ attemptId: string }>(`/quiz/tests/${slug}/start`)
      router.push(`/aptitude/attempts/${data.attemptId}`)
    } catch {
      setError('Could not start the test. Please try again.')
      setBusy(false)
    }
  }
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {error && (
        <p role="alert" className="text-red-600 mb-4">
          {error}
        </p>
      )}
      {test && (
        <>
          <h1 className="text-3xl font-bold">{test.title}</h1>
          {test.description && <p className="mt-3">{test.description}</p>}
          <p className="mt-6">
            {test.questionCount} questions · {test.durationMinutes} minutes
          </p>
          <p className="mt-2 text-muted-foreground">
            Answers save as you choose them. You can submit early; the server closes answers when
            time expires. This test does not use a webcam or screen recording.
          </p>
          <button
            disabled={busy || loading}
            onClick={() => void start()}
            className="mt-6 px-5 py-3 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {loading ? 'Checking session…' : busy ? 'Starting…' : 'Start test'}
          </button>
        </>
      )}
    </main>
  )
}
