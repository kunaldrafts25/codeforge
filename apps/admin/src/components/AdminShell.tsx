'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth, hasRole } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ShieldCheck, FileText, LogOut } from 'lucide-react'

const links = [
  { href: '/admin/quiz-review', label: 'Quiz review', icon: FileText, minRole: 'REVIEWER' },
  { href: '/admin/problems', label: 'Coding problems', icon: FileText, minRole: 'PROBLEM_SETTER' },
]

export function AdminShell({
  children,
  requireMinRole = 'PROBLEM_SETTER',
  allowedRoles,
}: {
  children: React.ReactNode
  requireMinRole?: string
  allowedRoles?: string[]
}) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!hasRole(user, requireMinRole) || (allowedRoles && !allowedRoles.includes(user.role))) {
      router.replace('/forbidden')
    }
  }, [user, loading, router, requireMinRole, allowedRoles])

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>
  }
  if (
    !user ||
    !hasRole(user, requireMinRole) ||
    (allowedRoles && !allowedRoles.includes(user.role))
  ) {
    return null
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="w-full md:w-60 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-border">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg">CodeForge Admin</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {links.map(link => {
            if (!hasRole(user, link.minRole)) return null
            if (
              link.href === '/admin/problems' &&
              !['PROBLEM_SETTER', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
            ) {
              return null
            }
            const Icon = link.icon
            const active = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                  active
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'hover:bg-muted text-muted-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t border-border text-xs">
          <div className="font-medium">{user.username}</div>
          <div className="text-muted-foreground mb-2">{user.role}</div>
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-3 h-3" /> Logout
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
