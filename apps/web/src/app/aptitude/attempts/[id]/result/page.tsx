'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

type Result = {
  title: string
  rawScore: number
  maxScore: number
  submittedAt: string
  responses: { questionId: string; isCorrect: boolean; pointsAwarded: number }[]
}

export default function ResultPage() {
  const { id } = useParams<{ id: string }>()
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void api
      .get<Result>(`/quiz/attempts/${id}/result`)
      .then(r => setResult(r.data))
      .catch(() => setError('Result is unavailable while the attempt is active.'))
  }, [id])
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {result && (
        <>
          <h1 className="text-3xl font-bold">{result.title}</h1>
          <p className="mt-5 text-2xl">
            Score: {result.rawScore} / {result.maxScore}
          </p>
          <p className="mt-3 text-muted-foreground">
            Submitted {new Date(result.submittedAt).toLocaleString()}. A calibrated percentile is
            not available for this test.
          </p>
          <ol className="mt-6 list-decimal pl-6">
            {result.responses.map(r => (
              <li key={r.questionId} className="py-1">
                {r.isCorrect ? 'Correct' : 'Incorrect'} · {r.pointsAwarded} points
              </li>
            ))}
          </ol>
          <Link href="/aptitude" className="inline-block mt-8 text-primary underline">
            All tests
          </Link>
        </>
      )}
    </main>
  )
}
