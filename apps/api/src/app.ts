import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import sensible from '@fastify/sensible'
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import * as Sentry from '@sentry/node'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { handleError } from './errors.js'
import { authPlugin } from './auth/plugin.js'
import { CSRF_COOKIE } from './auth/cookies.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { problemRoutes } from './routes/problems.js'
import { contestRoutes } from './routes/contests.js'
import { submissionRoutes } from './routes/submissions.js'
import { leaderboardRoutes } from './routes/leaderboard.js'
import { adminRoutes } from './routes/admin.js'
import { quizRoutes } from './routes/quiz/index.js'
import { practiceRoutes } from './routes/practice.js'

export async function buildApp() {
  const config = loadConfig()

  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      tracesSampleRate: 0.1,
    })
  }

  const app = Fastify({
    loggerInstance: logger,
    genReqId: req => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
    bodyLimit: 1 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // ── Core security plugins ──────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'strict-dynamic'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.FRONTEND_URL],
      },
    },
    crossOriginEmbedderPolicy: false,
  })

  await app.register(cors, {
    origin: [config.FRONTEND_URL, config.ADMIN_URL],
    credentials: true,
  })

  await app.register(cookie, { secret: config.CSRF_SECRET })

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: req => req.ip,
  })

  await app.register(sensible)

  // CSRF — double-submit cookie pattern. Note: `@fastify/csrf-protection`
  // exposes the protection as `app.csrfProtection` (a fastify preHandler).
  // Apply it to every browser mutation, including login and password recovery.
  await app.register(csrf, {
    cookieKey: CSRF_COOKIE,
    cookieOpts: {
      signed: true,
      path: '/',
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      httpOnly: true,
    },
    getToken: req =>
      (req.headers['x-csrf-token'] as string | undefined) ??
      (req.body as { _csrf?: string })?._csrf,
  })

  // ── Auth (sets req.user from cookie) ───────────────────────────────────
  await app.register(authPlugin)

  app.addHook('preHandler', async (request, reply) => {
    const method = request.method.toUpperCase()
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
    // Fastify csrf-protection adds csrfProtection as a route-level hook; call
    // it directly. Throws 403 on failure.
    await app.csrfProtection.call(app, request, reply, () => undefined)
  })

  // ── OpenAPI ────────────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CodeForge API',
        description: 'CodeForge platform API (Arena + Aptitude).',
        version: '0.1.0',
      },
      servers: [{ url: config.PUBLIC_API_URL }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(swaggerUI, { routePrefix: '/api/docs' })

  // ── Error handler ──────────────────────────────────────────────────────
  app.setErrorHandler(handleError)

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  app.get('/', async () => ({ name: 'CodeForge API', version: '0.1.0' }))

  // ── Routes ─────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/users' })
  await app.register(problemRoutes, { prefix: '/api/problems' })
  await app.register(contestRoutes, { prefix: '/api/contests' })
  await app.register(submissionRoutes, { prefix: '/api/submissions' })
  await app.register(leaderboardRoutes, { prefix: '/api/leaderboard' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(quizRoutes, { prefix: '/api/quiz' })
  await app.register(practiceRoutes, { prefix: '/api/practice' })

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  return app
}
