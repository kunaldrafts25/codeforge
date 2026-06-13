'use client'

import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'

export default function CheckInboxPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function resend(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await api.post('/auth/verification/resend', { email })
      setMessage('If this address needs verification, a new link has been sent.')
    } catch {
      setMessage('Could not request a new link. Please try again later.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-2">Check your inbox</h1>
        <p className="text-muted-foreground mb-5">
          Use the verification link to activate your account, then log in. If it did not arrive,
          request another below.
        </p>
        <form onSubmit={event => void resend(event)} className="space-y-3">
          <label htmlFor="resend-email" className="block text-sm font-medium">
            Email address
          </label>
          <input
            id="resend-email"
            type="email"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-input bg-background"
          />
          <button
            disabled={busy}
            type="submit"
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Resend verification link'}
          </button>
        </form>
        {message && (
          <p role="status" className="mt-4">
            {message}
          </p>
        )}
      </div>
    </main>
  )
}
