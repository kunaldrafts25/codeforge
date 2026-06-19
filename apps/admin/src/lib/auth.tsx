'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ensureCsrf } from './api'

export interface AdminUser {
  id: string
  email: string
  username: string
  role: string
}

interface AuthContextType {
  user: AdminUser | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function bootstrapCsrf(): Promise<void> {
  try {
    await ensureCsrf()
  } catch {
    // ignored
  }
}

export const ROLE_RANK: Record<string, number> = {
  USER: 0,
  PROBLEM_SETTER: 1,
  REVIEWER: 2,
  MODERATOR: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
}

export function hasRole(user: AdminUser | null, min: string): boolean {
  if (!user) return false
  return (ROLE_RANK[user.role] ?? -1) >= (ROLE_RANK[min] ?? Number.POSITIVE_INFINITY)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me')
      const u = res.data.user
      if (u) {
        setUser({ id: u.id, email: u.email, username: u.username, role: u.role })
      } else {
        setUser(null)
      }
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

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined)
    setUser(null)
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
