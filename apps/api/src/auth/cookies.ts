import type { FastifyReply } from 'fastify'
import { loadConfig } from '../config.js'

const config = loadConfig()

export const ACCESS_COOKIE = 'cf_at'
export const REFRESH_COOKIE = 'cf_rt'
export const CSRF_COOKIE = 'cf_csrf'

const sharedOpts = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'lax' as const,
  domain: config.COOKIE_DOMAIN,
}

export function setAccessCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(ACCESS_COOKIE, token, {
    ...sharedOpts,
    path: '/',
    maxAge: config.JWT_ACCESS_TTL_SECONDS,
  })
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    ...sharedOpts,
    path: '/api/auth',
    maxAge: config.JWT_REFRESH_TTL_SECONDS,
  })
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/', domain: config.COOKIE_DOMAIN })
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: config.COOKIE_DOMAIN })
}
