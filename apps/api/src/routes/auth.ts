import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  RegisterBody,
  LoginBody,
  VerifyEmailBody,
  RequestPasswordResetBody,
  ConfirmPasswordResetBody,
  AuthMeResponse,
} from '@codeforge/shared'
import { prisma } from '@codeforge/db'
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from '../auth/cookies.js'
import {
  hashToken,
  newOpaqueToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/tokens.js'
import { ARGON2, BCRYPT, hashPassword, verifyPassword } from '../auth/password.js'
import { buildPasswordResetEmail, buildVerifyEmail, sendEmail } from '../auth/email.js'
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../errors.js'

const MAX_FAILED_LOGINS = 10
const SOFT_LIMIT_FAILED = 5
const LOCK_DURATION_MS = 60 * 60 * 1000 // 1 hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

function backoffDelayMs(count: number): number {
  if (count <= SOFT_LIMIT_FAILED) return 0
  // exponential up to 8s once count > soft limit
  return Math.min(8000, 2 ** (count - SOFT_LIMIT_FAILED) * 250)
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

export const authRoutes: FastifyPluginAsyncZod = async app => {
  // ── Register ────────────────────────────────────────────────────────────
  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        body: RegisterBody,
        response: {
          201: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              username: z.string(),
            }),
          }),
        },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, username, password, displayName } = request.body
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
        select: { email: true, username: true },
      })
      if (existing) {
        const reason = existing.email === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN'
        throw conflict(reason, reason === 'EMAIL_TAKEN' ? 'Email already in use' : 'Username taken')
      }
      const passwordHash = await hashPassword(password)
      const user = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          passwordAlgo: ARGON2,
          displayName: displayName ?? username,
        },
        select: { id: true, email: true, username: true },
      })

      // Email verification token (single-use)
      const raw = newOpaqueToken()
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          purpose: 'email-verify',
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      })
      const email_ = { ...buildVerifyEmail(raw), to: email }
      try {
        await sendEmail(email_)
      } catch (err) {
        request.log.error({ err }, 'failed to send verification email')
      }

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'auth.register',
          target: `user:${user.id}`,
          ipAddress: request.ip,
          requestId: request.id,
          payload: { username, email },
        },
      })

      return reply.code(201).send({ user })
    }
  )

  // ── Verify email ────────────────────────────────────────────────────────
  app.post(
    '/verify-email',
    {
      schema: {
        tags: ['auth'],
        body: VerifyEmailBody,
        response: { 200: z.object({ verified: z.boolean() }) },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { token } = request.body
      const tokenHash = hashToken(token)
      const row = await prisma.verificationToken.findUnique({ where: { tokenHash } })
      if (!row || row.consumedAt || row.expiresAt < new Date()) {
        throw badRequest('INVALID_TOKEN', 'Verification link is invalid or expired')
      }
      await prisma.$transaction(async tx => {
        const claimed = await tx.verificationToken.updateMany({
          where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        })
        if (claimed.count !== 1)
          throw badRequest('INVALID_TOKEN', 'Verification link is invalid or expired')
        await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } })
      })
      return reply.send({ verified: true })
    }
  )

  app.post(
    '/verification/resend',
    {
      schema: {
        tags: ['auth'],
        body: RequestPasswordResetBody,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { email: request.body.email } })
      // Identical response for unknown and already verified addresses.
      if (user && !user.emailVerifiedAt && !user.isBanned) {
        const raw = newOpaqueToken()
        await prisma.verificationToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(raw),
            purpose: 'email-verify',
            expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
          },
        })
        try {
          await sendEmail({ ...buildVerifyEmail(raw), to: user.email })
        } catch (err) {
          request.log.error({ err }, 'failed to resend verification email')
        }
      }
      return reply.send({ ok: true })
    }
  )

  // ── Login ───────────────────────────────────────────────────────────────
  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        body: LoginBody,
        response: {
          200: z.object({
            user: z.object({
              id: z.string(),
              username: z.string(),
              role: z.string(),
            }),
          }),
        },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = request.body
      const user = await prisma.user.findUnique({ where: { email } })

      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        throw tooMany(
          'ACCOUNT_LOCKED',
          `Account temporarily locked. Try again after ${user.lockedUntil.toISOString()}.`
        )
      }

      if (!user || !user.passwordHash) {
        // do constant-time pretend
        await sleep(backoffDelayMs(SOFT_LIMIT_FAILED + 1))
        throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')
      }
      if (user.isBanned) {
        throw forbidden('ACCOUNT_BANNED', user.bannedReason ?? 'Account banned')
      }

      await sleep(backoffDelayMs(user.failedLoginCount))

      const ok = await verifyPassword(password, user.passwordHash, user.passwordAlgo)
      if (!ok) {
        const nextCount = user.failedLoginCount + 1
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: nextCount,
            lockedUntil:
              nextCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
          },
        })
        throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')
      }

      if (!user.emailVerifiedAt) {
        throw forbidden('EMAIL_NOT_VERIFIED', 'Please verify your email before logging in')
      }

      // Lazy bcrypt → argon2 migration
      if (user.passwordAlgo === BCRYPT || user.passwordHash.startsWith('$2')) {
        try {
          const newHash = await hashPassword(password)
          await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash, passwordAlgo: ARGON2 },
          })
        } catch (err) {
          request.log.error({ err }, 'failed lazy migrating bcrypt → argon2')
        }
      }

      // reset throttle counters
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastActiveAt: new Date() },
      })

      // Issue tokens + session
      const accessToken = signAccessToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      })
      const refreshRaw = newOpaqueToken(48)
      const refreshHash = hashToken(refreshRaw)
      const refreshJwt = signRefreshToken({ sub: user.id, jti: refreshRaw })

      await prisma.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: refreshHash,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? 'unknown',
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      })

      setAccessCookie(reply, accessToken)
      setRefreshCookie(reply, refreshJwt)

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'auth.login',
          target: `user:${user.id}`,
          ipAddress: request.ip,
          requestId: request.id,
        },
      })

      return reply.send({
        user: { id: user.id, username: user.username, role: user.role },
      })
    }
  )

  // ── Refresh ─────────────────────────────────────────────────────────────
  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        response: { 200: z.object({ refreshed: z.boolean() }) },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const refreshJwt = request.cookies[REFRESH_COOKIE]
      if (!refreshJwt) throw unauthorized('NO_REFRESH', 'Missing refresh token')

      let payload
      try {
        payload = verifyRefreshToken(refreshJwt)
      } catch {
        clearAuthCookies(reply)
        throw unauthorized('INVALID_REFRESH', 'Refresh token is invalid')
      }

      const tokenHash = hashToken(payload.jti)
      const session = await prisma.userSession.findUnique({
        where: { refreshTokenHash: tokenHash },
      })

      if (!session) {
        clearAuthCookies(reply)
        throw unauthorized('UNKNOWN_SESSION', 'Session not found')
      }

      // A near-simultaneous refresh from another tab can replay a just-rotated
      // token. Reject it without treating that benign race as account theft.
      if (session.revokedAt) {
        if (
          session.revokedReason !== 'rotated' ||
          Date.now() - session.revokedAt.getTime() < 30_000
        ) {
          clearAuthCookies(reply)
          throw unauthorized('SESSION_REVOKED', 'Session is no longer active')
        }
        await prisma.userSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'steal_detected' },
        })
        await prisma.auditLog.create({
          data: {
            actorId: session.userId,
            action: 'auth.refresh.steal_detected',
            target: `user:${session.userId}`,
            ipAddress: request.ip,
            requestId: request.id,
          },
        })
        clearAuthCookies(reply)
        throw unauthorized('SESSION_REVOKED', 'Session compromised — please log in again')
      }
      if (session.expiresAt < new Date()) {
        clearAuthCookies(reply)
        throw unauthorized('SESSION_EXPIRED', 'Session expired')
      }

      const user = await prisma.user.findUnique({ where: { id: session.userId } })
      if (!user || user.isBanned) {
        clearAuthCookies(reply)
        throw unauthorized('USER_INVALID', 'User no longer valid')
      }

      // Rotate
      const newRaw = newOpaqueToken(48)
      const newHash = hashToken(newRaw)
      const newJwt = signRefreshToken({ sub: user.id, jti: newRaw })

      await prisma.$transaction(async tx => {
        const claimed = await tx.userSession.updateMany({
          where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date(), revokedReason: 'rotated' },
        })
        if (claimed.count !== 1) {
          throw unauthorized('SESSION_REVOKED', 'Session is no longer active')
        }
        await tx.userSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: newHash,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] ?? 'unknown',
            expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          },
        })
      })

      const access = signAccessToken({ sub: user.id, username: user.username, role: user.role })
      setAccessCookie(reply, access)
      setRefreshCookie(reply, newJwt)

      return reply.send({ refreshed: true })
    }
  )

  // ── Logout ──────────────────────────────────────────────────────────────
  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const refreshJwt = request.cookies[REFRESH_COOKIE]
      if (refreshJwt) {
        try {
          const payload = verifyRefreshToken(refreshJwt)
          const tokenHash = hashToken(payload.jti)
          await prisma.userSession.updateMany({
            where: { refreshTokenHash: tokenHash, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'logout' },
          })
        } catch {
          // ignore — clearing cookies regardless
        }
      }
      clearAuthCookies(reply)
      return reply.send({ ok: true })
    }
  )

  // ── Password reset request ──────────────────────────────────────────────
  app.post(
    '/password-reset/request',
    {
      schema: {
        tags: ['auth'],
        body: RequestPasswordResetBody,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { email } = request.body
      const user = await prisma.user.findUnique({ where: { email } })
      // Always 200 to avoid email enumeration
      if (user) {
        const raw = newOpaqueToken()
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + RESET_TTL_MS),
            ipAddress: request.ip,
          },
        })
        try {
          await sendEmail({ ...buildPasswordResetEmail(raw), to: email })
        } catch (err) {
          request.log.error({ err }, 'failed to send password reset email')
        }
      }
      return reply.send({ ok: true })
    }
  )

  // ── Password reset confirm ──────────────────────────────────────────────
  app.post(
    '/password-reset/confirm',
    {
      schema: {
        tags: ['auth'],
        body: ConfirmPasswordResetBody,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { token, password } = request.body
      const tokenHash = hashToken(token)
      const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
      if (!row || row.consumedAt || row.expiresAt < new Date()) {
        throw badRequest('INVALID_TOKEN', 'Reset link is invalid or expired')
      }
      const newHash = await hashPassword(password)
      await prisma.$transaction(async tx => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        })
        if (claimed.count !== 1)
          throw badRequest('INVALID_TOKEN', 'Reset link is invalid or expired')
        await tx.user.update({
          where: { id: row.userId },
          data: {
            passwordHash: newHash,
            passwordAlgo: ARGON2,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        })
        await tx.userSession.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'password_reset' },
        })
      })

      await prisma.auditLog.create({
        data: {
          actorId: row.userId,
          action: 'auth.password_reset',
          target: `user:${row.userId}`,
          ipAddress: request.ip,
          requestId: request.id,
        },
      })

      return reply.send({ ok: true })
    }
  )

  // ── Me ──────────────────────────────────────────────────────────────────
  app.get(
    '/me',
    {
      schema: { tags: ['auth'], response: { 200: AuthMeResponse } },
      preHandler: [app.requireAuth],
    },
    async request => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user!.id },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          role: true,
          rating: true,
          maxRating: true,
          problemsSolved: true,
          contestsCount: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
          role: user.role,
          rating: user.rating,
          maxRating: user.maxRating,
          problemsSolved: user.problemsSolved,
          contestsCount: user.contestsCount,
          emailVerified: user.emailVerifiedAt !== null,
          createdAt: user.createdAt.toISOString(),
        },
      }
    }
  )

  // ── CSRF token issuance ─────────────────────────────────────────────────
  // The CSRF plugin generates the token; we expose an endpoint to surface it.
  // The token is also reflected via a non-httpOnly cookie set by the plugin.
  app.get(
    '/csrf',
    {
      schema: {
        tags: ['auth'],
        response: { 200: z.object({ csrfToken: z.string() }) },
      },
    },
    async (request, reply) => {
      const token = await reply.generateCsrf()
      return reply.send({ csrfToken: token })
    }
  )
}
