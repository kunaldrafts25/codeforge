import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { signAccessToken } from './auth/tokens.js'
import { buildApp } from './app.js'

const mail = vi.hoisted(() => ({ sentTo: [] as string[], tokenRows: 0, sessionRevoked: false }))

vi.mock('@codeforge/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { email?: string } }) => ({
        id: '018f8148-2201-7630-9da3-055be4d71853',
        email: where.email ?? 'test@example.com',
        username: 'tester',
        role: 'USER',
        isBanned: false,
        emailVerifiedAt: where.email === 'unverified@example.com' ? null : new Date(),
      }),
    },
    verificationToken: {
      create: async () => {
        mail.tokenRows++
        return {}
      },
    },
    userSession: {
      findUnique: async () => ({
        userId: '018f8148-2201-7630-9da3-055be4d71853',
        revokedAt: mail.sessionRevoked ? new Date() : null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
  },
}))

vi.mock('./auth/email.js', () => ({
  sendEmail: async ({ to }: { to: string }) => {
    mail.sentTo.push(to)
  },
  buildVerifyEmail: () => ({ to: '', subject: 'Verify', body: 'Link' }),
  buildPasswordResetEmail: () => ({ to: '', subject: 'Reset', body: 'Link' }),
}))

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
})

describe('API without a database connection', () => {
  it('serves health and issues a browser CSRF token and cookie', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json().status).toBe('ok')

    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
    expect(csrf.statusCode).toBe(200)
    expect(csrf.json().csrfToken).toEqual(expect.any(String))
    expect(csrf.headers['set-cookie']).toContain('cf_csrf=')
  })

  it('rejects a mutation without CSRF or authentication', async () => {
    const body = {
      problemId: '018f8148-2201-7630-9da3-055be4d71851',
      language: 'python',
      code: 'print(1)',
    }
    const missing = await app.inject({ method: 'POST', url: '/api/submissions', payload: body })
    expect(missing.statusCode).toBe(403)

    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
    const cookie = String(csrf.headers['set-cookie']).split(';')[0]
    const protectedResponse = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      payload: body,
      headers: { cookie, 'x-csrf-token': csrf.json().csrfToken },
    })
    expect(protectedResponse.statusCode).toBe(401)
  })

  it('fails closed before persisting or executing a code submission', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
    const csrfCookie = String(csrf.headers['set-cookie']).split(';')[0]
    const access = signAccessToken({
      sub: '018f8148-2201-7630-9da3-055be4d71853',
      sid: 'session-1',
      username: 'tester',
      role: 'USER',
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: { cookie: `${csrfCookie}; cf_at=${access}`, 'x-csrf-token': csrf.json().csrfToken },
      payload: {
        problemId: '018f8148-2201-7630-9da3-055be4d71851',
        language: 'python',
        code: 'print(1)',
      },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('JUDGE_UNAVAILABLE')
  })

  it('rejects a signed access token after its session is revoked', async () => {
    const access = signAccessToken({
      sub: '018f8148-2201-7630-9da3-055be4d71853',
      sid: 'session-1',
      username: 'tester',
      role: 'USER',
    })
    mail.sessionRevoked = true
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `cf_at=${access}` },
      })
      expect(response.statusCode).toBe(401)
    } finally {
      mail.sessionRevoked = false
    }
  })

  it('returns a generic response when verification is requested for a verified account', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verification/resend',
      headers: {
        cookie: String(csrf.headers['set-cookie']).split(';')[0],
        'x-csrf-token': csrf.json().csrfToken,
      },
      payload: { email: 'test@example.com' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(mail.sentTo).toEqual([])
  })

  it('issues a fresh verification token for an unverified account', async () => {
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verification/resend',
      headers: {
        cookie: String(csrf.headers['set-cookie']).split(';')[0],
        'x-csrf-token': csrf.json().csrfToken,
      },
      payload: { email: 'unverified@example.com' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(mail.tokenRows).toBe(1)
    expect(mail.sentTo).toEqual(['unverified@example.com'])
  })
})
