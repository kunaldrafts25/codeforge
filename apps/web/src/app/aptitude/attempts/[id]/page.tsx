'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'

type Question = {
  questionId: string
  type: 'MCQ_SINGLE' | 'TRUE_FALSE'
  stemMd: string
  payload: { options?: { id: string; text: string }[] }
  answer: { selected?: string; value?: boolean }
  presentedOrder: number
}
type State = { submitted: boolean; remainingMs: number; title: string; questions: Question[] }

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [state, setState] = useState<State | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data } = await api.get<State>(`/quiz/attempts/${id}`)
    if (data.submitted) {
      router.replace(`/aptitude/attempts/${id}/result`)
      return
    }
    setState(data)
    setRemaining(data.remainingMs)
  }, [id, router])
  useEffect(() => {
    void load().catch(() => setError('Could not load this attempt.'))
  }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(ms => Math.max(0, ms - 1000)), 1000)
    const refresh = window.setInterval(() => {
      void load().catch(() => setError('Connection lost. Check your answers before submitting.'))
    }, 30_000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(refresh)
    }
  }, [load])
  async function answer(questionId: string, value: { selected: string } | { value: boolean }) {
    try {
      await api.put(`/quiz/attempts/${id}/answer`, { questionId, answer: value })
      setState(
        current =>
          current && {
            ...current,
            questions: current.questions.map(q =>
              q.questionId === questionId ? { ...q, answer: value } : q
            ),
          }
      )
      setError('')
    } catch {
      setError('Answer was not saved. Check your connection and try again.')
    }
  }
  async function submit() {
    setBusy(true)
    try {
      await api.post(`/quiz/attempts/${id}/submit`)
      router.replace(`/aptitude/attempts/${id}/result`)
    } catch {
      setError('Submission failed. Retry or reopen this attempt.')
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
      {state && (
        <>
          <div className="flex flex-wrap justify-between gap-3 mb-8">
            <h1 className="text-3xl font-bold">{state.title}</h1>
            <p role="timer" className="font-mono text-xl">
              {Math.ceil(remaining / 60_000)} min left
            </p>
          </div>
          {state.questions.map((q, index) => (
            <fieldset key={q.questionId} className="border border-border rounded-lg p-5 mb-5">
              <legend className="font-semibold px-2">Question {index + 1}</legend>
              <p className="mb-4 whitespace-pre-wrap">{q.stemMd}</p>
              {q.type === 'MCQ_SINGLE' &&
                q.payload.options?.map(option => (
                  <label key={option.id} className="flex gap-3 items-start py-2 cursor-pointer">
                    <input
                      type="radio"
                      name={q.questionId}
                      checked={q.answer.selected === option.id}
                      disabled={remaining === 0}
                      onChange={() => void answer(q.questionId, { selected: option.id })}
                    />
                    <span>{option.text}</span>
                  </label>
                ))}
              {q.type === 'TRUE_FALSE' &&
                [true, false].map(value => (
                  <label
                    key={String(value)}
                    className="flex gap-3 items-center py-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={q.questionId}
                      checked={q.answer.value === value}
                      disabled={remaining === 0}
                      onChange={() => void answer(q.questionId, { value })}
                    />
                    <span>{value ? 'True' : 'False'}</span>
                  </label>
                ))}
            </fieldset>
          ))}
          <button
            disabled={busy}
            onClick={() => void submit()}
            className="px-5 py-3 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit test'}
          </button>
        </>
      )}
    </main>
  )
}
