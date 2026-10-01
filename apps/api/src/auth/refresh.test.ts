import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { authRoutes } from '../routes/auth.js'
import { hashToken, signRefreshToken } from './tokens.js'

const state = vi.hoisted(() => ({
  session: null as null | {
    id: string
    userId: string
    refreshTokenHash: string
    revokedAt: Date | null
    revokedReason: string | null
    expiresAt: Date
  },
  created: 0,
  broadRevocations: 0,
}))

vi.mock('@codeforge/db', () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        id: '018f8148-2201-7630-9da3-055be4d71853',
        username: 'tester',
        role: 'USER',
        isBanned: false,
      }),
    },
    userSession: {
      findUnique: async ({ where }: { where: { refreshTokenHash: string } }) =>
        state.session?.refreshTokenHash === where.refreshTokenHash ? state.session : null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; userId?: string; revokedAt?: null }
        data: { revokedAt: Date; revokedReason: string }
      }) => {
        if (where.userId) {
          state.broadRevocations++
          return { count: 1 }
        }
        if (where.id !== state.session?.id || state.session.revokedAt) return { count: 0 }
        Object.assign(state.session, data)
        return { count: 1 }
      },
      create: async () => {
        state.created++
        return { id: `session-${state.created + 1}` }
      },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  }
  return { prisma }
})

let app: ReturnType<typeof Fastify>
let jwt: string
beforeEach(async () => {
  const raw = 'refresh-test-token'
  state.session = {
    id: 'session-1',
    userId: '018f8148-2201-7630-9da3-055be4d71853',
    refreshTokenHash: hashToken(raw),
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date(Date.now() + 60_000),
  }
  state.created = 0
  state.broadRevocations = 0
  jwt = signRefreshToken({ sub: state.session.userId, jti: raw })
  app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(cookie)
  app.decorate('requireAuth', async () => undefined)
  await app.register(authRoutes, { prefix: '/auth' })
})
afterEach(async () => {
  await app.close()
})

describe('refresh rotation', () => {
  it('issues one replacement and rejects an immediate replay without revoking other sessions', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `cf_rt=${jwt}` },
    })
    expect(first.statusCode).toBe(200)
    expect(state.created).toBe(1)
    expect(state.session?.revokedReason).toBe('rotated')

    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `cf_rt=${jwt}` },
    })
    expect(second.statusCode).toBe(401)
    expect(state.created).toBe(1)
    expect(state.broadRevocations).toBe(0)
  })
})
