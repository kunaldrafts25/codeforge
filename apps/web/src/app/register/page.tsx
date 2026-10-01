'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import type { AxiosError } from 'axios'

export default function RegisterPage() {
  const router = useRouter()
  const { register } = useAuth()
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 10) {
      setError('Password must be at least 10 characters and include upper, lower, and a digit')
      return
    }

    setLoading(true)
    try {
      await register(formData.email, formData.username, formData.password)
      // No auto-login: email verification gate. Send the user to a check-inbox page.
      router.push('/auth/check-inbox')
    } catch (err) {
      const error = err as AxiosError<{ error?: { message: string } }>
      setError(error.response?.data?.error?.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-xl p-8">
          <h1 className="text-2xl font-bold text-center mb-6">Create Account</h1>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="register-email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                id="register-email"
                type="email"
                value={formData.email}
                onChange={e => updateField('email', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="register-username" className="block text-sm font-medium mb-2">
                Username
              </label>
              <input
                id="register-username"
                type="text"
                value={formData.username}
                onChange={e => updateField('username', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="coolcoder123"
                required
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <input
                id="register-password"
                type="password"
                value={formData.password}
                onChange={e => updateField('password', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label htmlFor="register-confirm-password" className="block text-sm font-medium mb-2">
                Confirm Password
              </label>
              <input
                id="register-confirm-password"
                type="password"
                value={formData.confirmPassword}
                onChange={e => updateField('confirmPassword', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
