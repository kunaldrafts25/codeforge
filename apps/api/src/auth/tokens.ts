import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { loadConfig } from '../config.js'

const config = loadConfig()

export interface AccessTokenPayload {
  sub: string // userId
  username: string
  role: string
}

export interface RefreshTokenPayload {
  sub: string
  jti: string
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_ACCESS_TTL_SECONDS,
  })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_REFRESH_TTL_SECONDS,
  })
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
  }) as RefreshTokenPayload
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
