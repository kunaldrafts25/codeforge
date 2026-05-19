import pino from 'pino'
import type { LoggerOptions } from 'pino'
import { loadConfig } from './config.js'

const config = loadConfig()

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.csrfToken',
  '*.totpSecret',
]

const opts: LoggerOptions = {
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  base: {
    service: 'codeforge-api',
    env: config.NODE_ENV,
  },
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
}

export const logger = pino(opts)
