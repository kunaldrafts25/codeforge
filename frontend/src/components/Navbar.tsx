'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Code2, Sun, Moon, Monitor, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useTheme } from './ThemeProvider'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const navLinks = [
  { href: '/problems', label: 'Problems' },
  { href: '/contests', label: 'Contests' },
  { href: '/ratings', label: 'Ratings' },
  { href: '/leaderboard', label: 'Leaderboard' },
]

export function Navbar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <Code2 className="w-6 h-6 text-primary" />
            <span>CodeForge</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-sm font-medium transition-colors hover:text-primary',
                  pathname === link.href ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle theme={theme} setTheme={setTheme} />

          {user ? (
            <div className="hidden md:flex items-center gap-4">
              <Link href="/profile" className="text-sm font-medium hover:text-primary">
                {user.username}
              </Link>
              <button
                onClick={logout}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-4">
              <Link href="/login" className="text-sm font-medium hover:text-primary">
                Login
              </Link>
              <Link
                href="/register"
                className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
              >
                Register
              </Link>
            </div>
          )}

          <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border py-4 px-4 space-y-4">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="block py-2 text-sm font-medium"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-4 border-t border-border space-y-2">
            {user ? (
              <>
                <Link href="/profile" className="block py-2 text-sm">
                  Profile
                </Link>
                <button onClick={logout} className="block py-2 text-sm text-muted-foreground">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="block py-2 text-sm">
                  Login
                </Link>
                <Link href="/register" className="block py-2 text-sm">
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

type Theme = 'light' | 'dark' | 'system'

function ThemeToggle({ theme, setTheme }: { theme: string; setTheme: (t: Theme) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg border border-border">
      <button
        onClick={() => setTheme('light')}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          theme === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
        title="Light"
      >
        <Sun className="w-4 h-4" />
      </button>
      <button
        onClick={() => setTheme('dark')}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          theme === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
        title="Dark"
      >
        <Moon className="w-4 h-4" />
      </button>
      <button
        onClick={() => setTheme('system')}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          theme === 'system' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
        title="System"
      >
        <Monitor className="w-4 h-4" />
      </button>
    </div>
  )
}
