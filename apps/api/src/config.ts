import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform(v => v === 'true'),
  CSRF_SECRET: z.string().min(16),

  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:5000'),

  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('CodeForge <no-reply@example.com>'),

  SENTRY_DSN: z.string().optional(),

  SEED_BLOB_ROOT: z.string().default('./.local-blobs'),
  PISTON_URL: z.string().url().default('https://emkc.org/api/v2/piston'),
})

export type Config = z.infer<typeof ConfigSchema>

let cached: Config | undefined

export function loadConfig(): Config {
  if (cached) return cached
  const parsed = ConfigSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  cached = parsed.data
  return cached
}
