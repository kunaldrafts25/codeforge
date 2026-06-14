'use client'

import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function requestReset(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await api.post('/auth/password-reset/request', { email })
      setMessage('If an account exists for this address, a reset link has been sent.')
    } catch {
      setMessage('Could not request a reset link. Please try again later.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-3">Reset your password</h1>
      <p className="text-muted-foreground mb-5">
        Enter your account email. A reset link expires after 15 minutes.
      </p>
      <form onSubmit={event => void requestReset(event)} className="space-y-3">
        <label htmlFor="reset-email" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="reset-email"
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
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      {message && (
        <p role="status" className="mt-4">
          {message}
        </p>
      )}
    </main>
  )
}
