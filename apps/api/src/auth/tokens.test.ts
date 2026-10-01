import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.JWT_SECRET = '0'.repeat(64)
  process.env.JWT_REFRESH_SECRET = '1'.repeat(64)
  process.env.CSRF_SECRET = 'a'.repeat(32)
})

describe('tokens', () => {
  it('signs and verifies access tokens', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./tokens.js')
    const t = signAccessToken({ sub: 'u1', sid: 'session-1', username: 'alice', role: 'USER' })
    const v = verifyAccessToken(t)
    expect(v.sub).toBe('u1')
    expect(v.sid).toBe('session-1')
    expect(v.username).toBe('alice')
    expect(v.role).toBe('USER')
  })

  it('signs and verifies refresh tokens', async () => {
    const { signRefreshToken, verifyRefreshToken } = await import('./tokens.js')
    const t = signRefreshToken({ sub: 'u1', jti: 'abc' })
    const v = verifyRefreshToken(t)
    expect(v.sub).toBe('u1')
    expect(v.jti).toBe('abc')
  })

  it('hashToken is deterministic and 64 hex chars', async () => {
    const { hashToken } = await import('./tokens.js')
    const a = hashToken('test')
    const b = hashToken('test')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('newOpaqueToken returns url-safe base64', async () => {
    const { newOpaqueToken } = await import('./tokens.js')
    const t = newOpaqueToken(16)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
