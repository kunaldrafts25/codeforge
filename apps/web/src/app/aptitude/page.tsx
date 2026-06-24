'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

type Test = {
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  questionCount: number
}

export default function AptitudePage() {
  const [tests, setTests] = useState<Test[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void api
      .get<Test[]>('/quiz/tests')
      .then(r => setTests(r.data))
      .catch(() => setError('Could not load tests. Try again later.'))
  }, [])
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-2">Aptitude tests</h1>
      <p className="text-muted-foreground mb-8">
        Timed objective assessments. Your timer starts when you begin.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!error && tests.length === 0 && <p>No reviewed tests are available yet.</p>}
      <div className="grid gap-4">
        {tests.map(test => (
          <Link
            key={test.slug}
            href={`/aptitude/${test.slug}`}
            className="block rounded-lg border border-border p-5 hover:border-primary"
          >
            <h2 className="text-xl font-semibold">{test.title}</h2>
            {test.description && <p className="mt-2 text-muted-foreground">{test.description}</p>}
            <p className="mt-3 text-sm">
              {test.questionCount} questions · {test.durationMinutes} minutes
            </p>
          </Link>
        ))}
      </div>
    </main>
  )
}
