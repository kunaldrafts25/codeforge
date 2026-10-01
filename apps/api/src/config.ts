import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const ConfigSchema = z
  .object({
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
    ADMIN_URL: z.string().url().default('http://localhost:3001'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:5000'),

    EMAIL_PROVIDER: z.enum(['console', 'resend', 'sandbox']).default('console'),
    MAIL_SANDBOX_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('CodeForge <no-reply@example.com>'),

    SENTRY_DSN: z.string().optional(),

    SEED_BLOB_ROOT: z.string().default('./.local-blobs'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') return
    if (!value.COOKIE_SECURE)
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Secure cookies are required in production',
      })
    if (value.EMAIL_PROVIDER !== 'resend' || !value.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'Configured email delivery is required in production',
      })
    }
    for (const key of ['FRONTEND_URL', 'ADMIN_URL', 'PUBLIC_API_URL'] as const) {
      if (!value[key].startsWith('https://'))
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'HTTPS is required in production',
        })
    }
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
