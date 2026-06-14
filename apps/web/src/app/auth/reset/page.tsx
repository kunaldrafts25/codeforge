'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

function ResetForm() {
  const token = useSearchParams().get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)
  const [busy, setBusy] = useState(false)
  async function reset(event: FormEvent) {
    event.preventDefault()
    if (!token) {
      setMessage('Reset link is missing or invalid.')
      return
    }
    if (password !== confirm) {
      setMessage('Passwords do not match.')
      return
    }
    if (
      password.length < 10 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      setMessage('Use at least 10 characters with uppercase, lowercase, and a digit.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await api.post('/auth/password-reset/confirm', { token, password })
      setComplete(true)
      setPassword('')
      setConfirm('')
    } catch {
      setMessage('The reset link is invalid or expired. Request a new link and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-4">Choose a new password</h1>
      {complete ? (
        <p>
          Password updated.{' '}
          <Link href="/login" className="text-primary underline">
            Log in
          </Link>{' '}
          with your new password.
        </p>
      ) : (
        <form onSubmit={event => void reset(event)} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium mb-1">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-input bg-background"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={event => setConfirm(event.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-input bg-background"
            />
          </div>
          <button
            disabled={busy || !token}
            type="submit"
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
      {message && (
        <p role="alert" className="mt-4 text-destructive">
          {message}
        </p>
      )}
      {!token && (
        <p role="alert" className="mt-4">
          Reset link is missing.{' '}
          <Link href="/auth/forgot-password" className="text-primary underline">
            Request another
          </Link>
          .
        </p>
      )}
    </main>
  )
}

export default function ResetPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ResetForm />
    </Suspense>
  )
}
