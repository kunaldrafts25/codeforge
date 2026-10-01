import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('production startup configuration', () => {
  it('rejects insecure cookies, HTTP origins, and console-only email delivery', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test')
    vi.stubEnv('JWT_SECRET', 'a'.repeat(64))
    vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(64))
    vi.stubEnv('CSRF_SECRET', 'c'.repeat(32))
    vi.stubEnv('COOKIE_SECURE', 'false')
    vi.stubEnv('EMAIL_PROVIDER', 'console')
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000')
    vi.stubEnv('ADMIN_URL', 'http://localhost:3001')
    vi.stubEnv('PUBLIC_API_URL', 'http://localhost:5000')
    vi.resetModules()
    const { loadConfig } = await import('./config.js')
    expect(() => loadConfig()).toThrow(/Secure cookies are required in production/)
    expect(() => loadConfig()).toThrow(/Configured email delivery is required in production/)
    expect(() => loadConfig()).toThrow(/HTTPS is required in production/)
  })
})
