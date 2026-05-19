'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

interface User {
  id: string
  email: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  rating: number
  maxRating: number
  problemsSolved: number
  contestsCount: number
  emailVerified: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function bootstrapCsrf(): Promise<void> {
  try {
    await api.get('/auth/csrf')
  } catch {
    // ignore — CSRF cookie may already be set
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me')
      setUser(res.data.user)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await bootstrapCsrf()
      await refresh()
      setLoading(false)
    })()
  }, [refresh])

  const login = async (email: string, password: string) => {
    await bootstrapCsrf()
    await api.post('/auth/login', { email, password })
    await refresh()
  }

  const register = async (email: string, username: string, password: string) => {
    await bootstrapCsrf()
    await api.post('/auth/register', { email, username, password })
    // Registration does NOT log the user in — email verification gate.
  }

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, refresh, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
