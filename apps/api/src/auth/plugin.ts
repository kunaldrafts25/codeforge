import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@codeforge/db'
import { ACCESS_COOKIE } from './cookies.js'
import { verifyAccessToken } from './tokens.js'
import { forbidden, unauthorized } from '../errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string
      username: string
      email: string
      role: string
    }
  }
}

async function readUserFromCookie(request: FastifyRequest): Promise<void> {
  const token = request.cookies[ACCESS_COOKIE]
  if (!token) return
  try {
    const payload = verifyAccessToken(token)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, role: true, isBanned: true },
    })
    if (!user || user.isBanned) return
    request.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    }
  } catch {
    // invalid/expired token — leave request.user undefined
  }
}

async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) {
    throw unauthorized('UNAUTHENTICATED', 'Authentication required')
  }
}

function requireRole(...roles: string[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user) {
      throw unauthorized('UNAUTHENTICATED', 'Authentication required')
    }
    if (!roles.includes(request.user.role)) {
      throw forbidden('FORBIDDEN', 'Insufficient permissions')
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: typeof requireAuth
    requireRole: typeof requireRole
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('preHandler', readUserFromCookie)
  app.decorate('requireAuth', requireAuth)
  app.decorate('requireRole', requireRole)
})
