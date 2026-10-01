'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.post('/auth/login', { email, password })
      await refresh()
      router.replace('/admin/quiz-review')
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Login failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md p-8 rounded-lg border border-border bg-card space-y-4"
      >
        <h1 className="text-2xl font-bold">Admin login</h1>
        <p className="text-sm text-muted-foreground">
          You need PROBLEM_SETTER or above to use this app.
        </p>
        <div className="space-y-1">
          <label htmlFor="admin-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="admin-password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background"
          />
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
