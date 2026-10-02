import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  prisma,
  enqueueContestSubmission,
  rejudgeContestSubmission,
  type Prisma,
} from '@codeforge/db'
import {
  ContestSlugParam,
  ContestDraftBody,
  ContestSealBody,
  ContestSubmitBody,
  ContestDisputeCreateBody,
  ContestDisputeResolveBody,
  ContestCorrectionBody,
  ContestFinalizeBody,
  PracticePackage,
} from '@codeforge/shared'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js'
import { executionAvailability, hash, canonical, publicPackage } from '../practice/package.js'
import { computeManifestHash } from '../contests/manifest.js'
import {
  computeScoreboard,
  type ContestSubmissionEvent,
  type ScoreboardParticipantEntry,
} from '../contests/scoring.js'
import { finalizeContest, replayChronologicalContests } from '../contests/settlement.js'

const idParam = z.object({ id: z.string().uuid() })
const staffRoles = ['PROBLEM_SETTER', 'REVIEWER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']
const authorRoles = ['PROBLEM_SETTER', 'ADMIN', 'SUPER_ADMIN']
const reviewerRoles = ['REVIEWER', 'ADMIN', 'SUPER_ADMIN']
const moderatorRoles = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN']
const operatorRoles = ['ADMIN', 'SUPER_ADMIN']

async function getExecutionPolicy() {
  const available = await executionAvailability()
  if (!available.enabled || !('policy' in available)) {
    throw new HttpError(
      503,
      'JUDGE_UNAVAILABLE',
      'Judge worker is currently unavailable to accept contest submissions'
    )
  }
  return available.policy as Prisma.InputJsonObject
}

export const contestRoutes: FastifyPluginAsyncZod = async app => {
  // Public listing of contests
  app.get('/', async request => {
    const contests = await prisma.contest.findMany({
      where: { isPublic: true },
      orderBy: { startTime: 'desc' },
      include: {
        _count: { select: { participants: { where: { status: 'REGISTERED' } } } },
      },
    })

    let registeredSet = new Set<string>()
    if (request.user) {
      const parts = await prisma.contestParticipant.findMany({
        where: { userId: request.user.id, status: 'REGISTERED' },
        select: { contestId: true },
      })
      registeredSet = new Set(parts.map(p => p.contestId))
    }

    return contests.map(c => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      startTime: c.startTime.toISOString(),
      endTime: c.endTime.toISOString(),
      registrationOpensAt: c.registrationOpensAt?.toISOString() ?? null,
      registrationClosesAt: c.registrationClosesAt?.toISOString() ?? null,
      freezeAt: c.freezeAt?.toISOString() ?? null,
      capacity: c.capacity,
      isRated: c.isRated,
      status: c.status,
      participantCount: c._count.participants,
      isRegistered: registeredSet.has(c.id),
    }))
  })

  // Contest detail
  app.get(
    '/:slug',
    {
      schema: { params: ContestSlugParam },
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        include: {
          activeManifest: true,
          _count: { select: { participants: { where: { status: 'REGISTERED' } } } },
        },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const now = new Date()
      const isStaff = request.user && staffRoles.includes(request.user.role)

      if (contest.status === 'DRAFT' && !isStaff) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      let isRegistered = false
      let isDisqualified = false
      if (request.user) {
        const part = await prisma.contestParticipant.findUnique({
          where: { contestId_userId: { contestId: contest.id, userId: request.user.id } },
        })
        isRegistered = part?.status === 'REGISTERED'
        isDisqualified = part?.status === 'DISQUALIFIED'
      }

      // Problem protection:
      // Before start, problem statements, titles, constraints, and samples are SEALED!
      // They are only revealed at/after startTime to registered, non-disqualified users (or staff).
      const hasStarted = now >= contest.startTime
      const canViewProblems = (hasStarted && isRegistered && !isDisqualified) || isStaff

      let problemsOutput: Array<{
        label: string
        problemId: string
        slug: string
        title: string
        points: number
        statementMd?: string | undefined
        inputFormat?: string | undefined
        outputFormat?: string | undefined
        constraints?: string | undefined
        samples?: Array<{ input: string; output: string; explanation?: string | null }> | undefined
        starters?: Record<string, string> | undefined
        languages?: string[] | undefined
        solved: boolean
      }> = []

      if (contest.activeManifest) {
        const manifestProblems = contest.activeManifest.problems as Array<{
          label: string
          orderIndex: number
          problemId: string
          versionId: string
          points: number
          title: string
        }>

        if (canViewProblems) {
          // Fetch full problem packages
          const versionIds = manifestProblems.map(p => p.versionId)
          const versions = await prisma.practiceVersion.findMany({
            where: { id: { in: versionIds } },
            include: { problem: { select: { slug: true } } },
          })
          const versionMap = new Map(versions.map(v => [v.id, v]))

          // Fetch candidate's solves if authenticated
          let solvedLabels = new Set<string>()
          if (request.user) {
            const acceptedSubs = await prisma.contestSubmission.findMany({
              where: {
                contestId: contest.id,
                userId: request.user.id,
                verdict: 'ACCEPTED',
                isAuthoritative: true,
              },
              select: { problemLabel: true },
            })
            solvedLabels = new Set(acceptedSubs.map(s => s.problemLabel))
          }

          problemsOutput = manifestProblems.map(mp => {
            const v = versionMap.get(mp.versionId)
            const pub = v ? publicPackage(v.package) : null
            return {
              label: mp.label,
              problemId: mp.problemId,
              slug: v?.problem.slug ?? mp.problemId,
              title: mp.title,
              points: mp.points,
              statementMd: pub?.statementMd,
              inputFormat: pub?.inputFormat,
              outputFormat: pub?.outputFormat,
              constraints: pub?.constraints,
              samples: pub?.samples,
              starters: pub?.starters as Record<string, string> | undefined,
              languages: pub?.languages,
              solved: solvedLabels.has(mp.label),
            }
          })
        }
      }

      return {
        id: contest.id,
        slug: contest.slug,
        title: contest.title,
        description: contest.description,
        startTime: contest.startTime.toISOString(),
        endTime: contest.endTime.toISOString(),
        registrationOpensAt: contest.registrationOpensAt?.toISOString() ?? null,
        registrationClosesAt: contest.registrationClosesAt?.toISOString() ?? null,
        freezeAt: contest.freezeAt?.toISOString() ?? null,
        capacity: contest.capacity,
        isRated: contest.isRated,
        status: contest.status,
        isRegistered,
        participantCount: contest._count.participants,
        serverTime: now.toISOString(),
        problems: problemsOutput,
        manifestRevision: contest.activeManifest?.revision,
      }
    }
  )

  // Registration
  app.post(
    '/:slug/register',
    {
      schema: { params: ContestSlugParam },
      preHandler: [app.requireAuth],
    },
    async request => {
      const user = request.user!
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      // ── P3-R1 fix: Derive a stable 53-bit advisory lock key from contestId.
      // All concurrent registrations/withdrawals/disqualifications serialize here.
      // All eligibility state is re-read inside the transaction after the lock is held.
      const lockKey = BigInt('0x' + contest.id.replace(/-/g, '').slice(0, 14)) & 0x1fffffffffffffn
      return prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`)

        // Re-read contest to pick up races with cancellation/window changes
        const liveContest = await tx.contest.findUniqueOrThrow({ where: { id: contest.id } })
        const nowTx = new Date()

        if (['DRAFT', 'CANCELLED'].includes(liveContest.status)) {
          throw conflict('CONTEST_NOT_ACTIVE', 'Contest is not open for registration')
        }
        if (
          (liveContest.registrationOpensAt && nowTx < liveContest.registrationOpensAt) ||
          (liveContest.registrationClosesAt && nowTx >= liveContest.registrationClosesAt)
        ) {
          throw conflict('REGISTRATION_CLOSED', 'Contest registration is currently closed')
        }

        // Re-read user to pick up races with bans and verifications
        const liveUser = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { isBanned: true, emailVerifiedAt: true, rating: true },
        })
        if (liveUser.isBanned) {
          throw forbidden('ACCOUNT_BANNED', 'Banned accounts cannot register for contests')
        }
        if (!liveUser.emailVerifiedAt) {
          throw forbidden('EMAIL_NOT_VERIFIED', 'Verify your email before registering for contests')
        }

        // Rating division check with live value
        if (liveContest.isRated) {
          if (liveContest.divisionMin !== null && liveUser.rating < liveContest.divisionMin) {
            throw forbidden(
              'INELIGIBLE_RATING',
              `Rating ${liveUser.rating} is below minimum eligible rating ${liveContest.divisionMin}`
            )
          }
          if (liveContest.divisionMax !== null && liveUser.rating > liveContest.divisionMax) {
            throw forbidden(
              'INELIGIBLE_RATING',
              `Rating ${liveUser.rating} exceeds maximum eligible rating ${liveContest.divisionMax}`
            )
          }
        }

        const existing = await tx.contestParticipant.findUnique({
          where: { contestId_userId: { contestId: contest.id, userId: user.id } },
        })

        if (existing) {
          if (existing.status === 'REGISTERED') {
            return {
              ok: true,
              status: 'REGISTERED',
              registeredAt: existing.registeredAt.toISOString(),
            }
          }
          if (existing.status === 'DISQUALIFIED') {
            throw forbidden('DISQUALIFIED', 'You are disqualified from this contest')
          }
          // Re-registration after withdrawal: check capacity inside the lock
          const count = await tx.contestParticipant.count({
            where: { contestId: contest.id, status: 'REGISTERED' },
          })
          if (count >= liveContest.capacity) {
            throw conflict('CAPACITY_EXCEEDED', 'Contest has reached maximum participant capacity')
          }

          const updated = await tx.contestParticipant.update({
            where: { contestId_userId: { contestId: contest.id, userId: user.id } },
            data: {
              status: 'REGISTERED',
              ratingAtRegistration: liveUser.rating,
              registeredAt: nowTx,
            },
          })
          return {
            ok: true,
            status: 'REGISTERED',
            registeredAt: updated.registeredAt.toISOString(),
          }
        }

        const count = await tx.contestParticipant.count({
          where: { contestId: contest.id, status: 'REGISTERED' },
        })
        if (count >= liveContest.capacity) {
          throw conflict('CAPACITY_EXCEEDED', 'Contest has reached maximum participant capacity')
        }

        const part = await tx.contestParticipant.create({
          data: {
            contestId: contest.id,
            userId: user.id,
            status: 'REGISTERED',
            ratingAtRegistration: liveUser.rating,
            registeredAt: nowTx,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'contest.register',
            target: contest.id,
            payload: { contestId: contest.id, rating: liveUser.rating },
          },
        })

        return { ok: true, status: 'REGISTERED', registeredAt: part.registeredAt.toISOString() }
      })
    }
  )

  // Withdrawal
  app.post(
    '/:slug/withdraw',
    {
      schema: { params: ContestSlugParam },
      preHandler: [app.requireAuth],
    },
    async request => {
      const user = request.user!
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const now = new Date()
      if (contest.registrationClosesAt && now >= contest.registrationClosesAt) {
        throw conflict(
          'WITHDRAWAL_CLOSED',
          'Registration has closed; withdrawal is no longer permitted'
        )
      }

      const part = await prisma.contestParticipant.findUnique({
        where: { contestId_userId: { contestId: contest.id, userId: user.id } },
      })
      if (!part || part.status !== 'REGISTERED') {
        throw conflict('NOT_REGISTERED', 'You are not registered for this contest')
      }

      await prisma.contestParticipant.update({
        where: { contestId_userId: { contestId: contest.id, userId: user.id } },
        data: { status: 'WITHDRAWN', withdrawnAt: now },
      })

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'contest.withdraw',
          target: contest.id,
          payload: { contestId: contest.id },
        },
      })

      return { ok: true, status: 'WITHDRAWN' }
    }
  )

  // Submit to contest
  app.post(
    '/:slug/submit',
    {
      schema: {
        params: ContestSlugParam,
        body: ContestSubmitBody,
      },
      preHandler: [app.requireAuth],
    },
    async request => {
      const user = request.user!
      const admittedAt = new Date() // Server-authoritative timestamp

      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        include: { activeManifest: true },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      // Check contest state & admission window
      if (['DRAFT', 'CANCELLED'].includes(contest.status)) {
        throw conflict('CONTEST_NOT_ACTIVE', 'Contest is not active for submissions')
      }

      if (admittedAt < contest.startTime) {
        throw conflict('CONTEST_NOT_STARTED', 'Contest has not started yet')
      }
      if (admittedAt >= contest.endTime) {
        throw conflict('CONTEST_ENDED', 'Contest has ended; new submissions are closed')
      }

      // Check participant registration
      const participant = await prisma.contestParticipant.findUnique({
        where: { contestId_userId: { contestId: contest.id, userId: user.id } },
        include: { user: { select: { isBanned: true } } },
      })
      if (!participant || participant.status !== 'REGISTERED') {
        throw forbidden('NOT_REGISTERED', 'You must be registered to submit to this contest')
      }

      if (participant.user.isBanned) {
        throw forbidden('ACCOUNT_BANNED', 'Banned accounts cannot submit code')
      }

      // Check problem in active manifest
      if (!contest.activeManifest) {
        throw conflict('MANIFEST_NOT_SEALED', 'Contest manifest is not sealed')
      }
      const manifestProblems = contest.activeManifest.problems as Array<{
        label: string
        problemId: string
        versionId: string
      }>
      const assigned = manifestProblems.find(p => p.label === request.body.problemLabel)
      if (!assigned) {
        throw badRequest(
          'INVALID_PROBLEM_LABEL',
          `Problem ${request.body.problemLabel} is not in this contest`
        )
      }

      const version = await prisma.practiceVersion.findUnique({
        where: { id: assigned.versionId },
      })
      if (!version) {
        throw notFound('VERSION_NOT_FOUND', 'Assigned problem version not found')
      }
      const pkg = PracticePackage.parse(version.package)
      if (!pkg.languages.includes(request.body.language)) {
        throw conflict('LANGUAGE_DISABLED', 'Language is not supported for this problem')
      }

      // Get verified judge execution policy
      const executionPolicy = await getExecutionPolicy()

      try {
        const { submission, job } = await enqueueContestSubmission(prisma, {
          contestId: contest.id,
          userId: user.id,
          manifestId: contest.activeManifest.id,
          problemId: assigned.problemId,
          versionId: assigned.versionId,
          problemLabel: request.body.problemLabel,
          language: request.body.language,
          source: request.body.code,
          idempotencyKey: request.body.idempotencyKey,
          policy: executionPolicy,
          admittedAt,
        })

        return {
          id: submission.id,
          jobId: job.id,
          problemLabel: submission.problemLabel,
          admittedAt: submission.admittedAt.toISOString(),
          state: submission.state,
          verdict: submission.verdict,
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Idempotency')) {
          throw conflict('IDEMPOTENCY_CONFLICT', msg)
        }
        if (msg.includes('quota') || msg.includes('capacity')) {
          throw new HttpError(429, 'JUDGE_CAPACITY', msg)
        }
        throw err
      }
    }
  )

  // View own submissions in contest
  app.get(
    '/:slug/submissions',
    {
      schema: { params: ContestSlugParam },
      preHandler: [app.requireAuth],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const subs = await prisma.contestSubmission.findMany({
        where: { contestId: contest.id, userId: request.user!.id, isAuthoritative: true },
        include: {
          job: { select: { publicResult: true, failureCode: true, privateResult: true } },
        },
        orderBy: [{ admittedAt: 'desc' }, { id: 'desc' }],
      })

      return subs.map(s => ({
        id: s.id,
        jobId: s.jobId,
        problemLabel: s.problemLabel,
        language: s.language,
        state: s.state,
        verdict: s.verdict,
        admittedAt: s.admittedAt.toISOString(),
        generation: s.generation,
        result: s.job.publicResult,
        failureCode: s.job.failureCode,
      }))
    }
  )

  // Scoreboard / Leaderboard for contest
  app.get(
    '/:slug/leaderboard',
    {
      schema: {
        params: ContestSlugParam,
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          live: z.coerce.boolean().optional(),
        }),
      },
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        include: {
          activeManifest: true,
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const now = new Date()
      const isStaff = request.user && staffRoles.includes(request.user.role)
      const requestedLive = isStaff && request.query.live === true

      // If contest is finalized: read latest live snapshot
      if (contest.status === 'FINALIZED') {
        const snapshot = await prisma.contestScoreboardSnapshot.findFirst({
          where: { contestId: contest.id, isFrozen: false },
          orderBy: { revision: 'desc' },
        })

        const entries = (snapshot?.payload ?? []) as unknown as ScoreboardParticipantEntry[]
        const { page, limit } = request.query
        const skip = (page - 1) * limit
        const pagedEntries = entries.slice(skip, skip + limit)

        const manifestProblems = (contest.activeManifest?.problems ?? []) as { label: string }[]
        return {
          contest: {
            id: contest.id,
            slug: contest.slug,
            title: contest.title,
            startTime: contest.startTime.toISOString(),
            endTime: contest.endTime.toISOString(),
            freezeAt: contest.freezeAt?.toISOString() ?? null,
            isRated: contest.isRated,
            status: contest.status,
            problemLabels: manifestProblems.map(p => p.label),
          },
          isFrozen: false,
          frozenAt: null,
          asOfTime: snapshot?.asOfTime.toISOString() ?? now.toISOString(),
          revision: snapshot?.revision ?? 1,
          entries: pagedEntries,
          total: entries.length,
          page,
          totalPages: Math.ceil(entries.length / limit) || 1,
        }
      }

      // Check if contest is currently frozen for public
      const shouldFreeze = !requestedLive && Boolean(contest.freezeAt && now >= contest.freezeAt)

      // Compute scoreboard dynamically
      const manifestProblems = (contest.activeManifest?.problems ?? []) as { label: string }[]
      const problemLabels = manifestProblems.map(p => p.label)

      const submissions = await prisma.contestSubmission.findMany({
        where: { contestId: contest.id, isAuthoritative: true },
        select: {
          id: true,
          userId: true,
          problemLabel: true,
          verdict: true,
          state: true,
          admittedAt: true,
        },
        orderBy: [{ admittedAt: 'asc' }, { id: 'asc' }],
      })

      const participantsInput = contest.participants.map(p => ({
        userId: p.userId,
        username: p.user.username,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        status: p.status,
      }))

      const { entries, isFrozen } = computeScoreboard(submissions as ContestSubmissionEvent[], {
        startTime: contest.startTime,
        freezeAt: shouldFreeze ? contest.freezeAt : null,
        isPublic: !requestedLive,
        problemLabels,
        participants: participantsInput,
      })

      const { page, limit } = request.query
      const skip = (page - 1) * limit
      const pagedEntries = entries.slice(skip, skip + limit)

      // ── P3-R7 fix: compute a stable revision token from content so clients can detect stale pages. ──
      // This is a content hash that changes when submissions change, not a monotonic counter.
      // Clients must use the same token for all pages of a single multi-page fetch.
      const liveRevisionToken = hash(
        canonical({
          submissionCount: submissions.length,
          lastId: submissions[submissions.length - 1]?.id ?? '',
        })
      )

      return {
        contest: {
          id: contest.id,
          slug: contest.slug,
          title: contest.title,
          startTime: contest.startTime.toISOString(),
          endTime: contest.endTime.toISOString(),
          freezeAt: contest.freezeAt?.toISOString() ?? null,
          isRated: contest.isRated,
          status: contest.status,
          problemLabels,
        },
        isFrozen,
        frozenAt: isFrozen ? contest.freezeAt!.toISOString() : null,
        asOfTime: now.toISOString(),
        revision: liveRevisionToken,
        entries: pagedEntries,
        total: entries.length,
        page,
        totalPages: Math.ceil(entries.length / limit) || 1,
      }
    }
  )

  // Candidate dispute creation
  app.post(
    '/:slug/disputes',
    {
      schema: {
        params: ContestSlugParam,
        body: ContestDisputeCreateBody,
      },
      preHandler: [app.requireAuth],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const dispute = await prisma.contestDispute.create({
        data: {
          contestId: contest.id,
          userId: request.user!.id,
          type: request.body.type,
          description: request.body.description,
          status: 'OPEN',
        },
      })

      return { id: dispute.id, status: dispute.status }
    }
  )

  // ─── Staff routes ──────────────────────────────────────────────────────────

  app.get('/staff/all', { preHandler: [app.requireRole(...staffRoles)] }, async () => {
    const contests = await prisma.contest.findMany({
      orderBy: { startTime: 'desc' },
      include: {
        activeManifest: true,
        _count: { select: { participants: true, contestSubmissions: true } },
      },
    })
    return contests.map(c => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      status: c.status,
      isRated: c.isRated,
      startTime: c.startTime.toISOString(),
      endTime: c.endTime.toISOString(),
      participantCount: c._count.participants,
      submissionCount: c._count.contestSubmissions,
      hasManifest: !!c.activeManifest,
    }))
  })

  // Create contest draft
  app.post(
    '/staff/drafts',
    {
      schema: { body: ContestDraftBody },
      preHandler: [app.requireRole(...authorRoles)],
    },
    async request => {
      const body = request.body
      const existing = await prisma.contest.findUnique({ where: { slug: body.slug } })
      if (existing) {
        throw conflict('SLUG_EXISTS', `Contest slug "${body.slug}" is already taken`)
      }

      const runtime = await prisma.practiceJudgeRuntime.findFirst({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { heartbeatAt: 'desc' },
      })
      const runtimePolicyHash = runtime?.policyHash ?? hash('bootstrap')

      // Verify all problem versions exist
      const versionIds = body.problems.map(p => p.versionId)
      const versions = await prisma.practiceVersion.findMany({
        where: { id: { in: versionIds } },
        include: { problem: true },
      })
      if (versions.length !== body.problems.length) {
        throw notFound(
          'PROBLEM_VERSION_MISSING',
          'One or more assigned problem versions do not exist'
        )
      }

      const versionMap = new Map(versions.map(v => [v.id, v]))

      // ── P3-R3 fix: all assigned versions must be PUBLISHED with genuine validation evidence. ──
      for (const [vId, v] of versionMap) {
        if (v.status !== 'PUBLISHED' || !v.publishedAt) {
          throw conflict(
            'VERSION_NOT_PUBLISHED',
            `Version ${vId} (problem ${v.problemId}) must be PUBLISHED before it can be assigned to a contest`
          )
        }
      }

      const problemsWithTitles = body.problems.map((p, idx) => {
        const v = versionMap.get(p.versionId)!
        const pkg = PracticePackage.parse(v.package)
        return {
          label: p.label,
          orderIndex: idx,
          problemId: p.problemId,
          versionId: p.versionId,
          packageHash: v.packageHash,
          points: p.points,
          title: pkg.title,
        }
      })

      // ── P3-R3 fix: create the contest FIRST to obtain the real UUID, then compute the manifest hash. ──
      // The hash must include the actual contestId, not a zero-placeholder.
      const contest = await prisma.$transaction(async tx => {
        const created = await tx.contest.create({
          data: {
            title: body.title,
            slug: body.slug,
            description: body.description,
            format: 'ICPC',
            startTime: new Date(body.startTime),
            endTime: new Date(body.endTime),
            registrationOpensAt: new Date(body.registrationOpensAt),
            registrationClosesAt: new Date(body.registrationClosesAt),
            freezeAt: body.freezeAt ? new Date(body.freezeAt) : null,
            capacity: body.capacity,
            isRated: body.isRated,
            divisionMin: body.divisionMin ?? null,
            divisionMax: body.divisionMax ?? null,
            status: 'DRAFT',
            isPublic: true,
          },
        })

        // Compute manifest hash with the real contestId
        const realManifestHash = computeManifestHash({
          contestId: created.id,
          revision: 1,
          title: body.title,
          slug: body.slug,
          description: body.description,
          startTime: body.startTime,
          endTime: body.endTime,
          registrationOpensAt: body.registrationOpensAt,
          registrationClosesAt: body.registrationClosesAt,
          freezeAt: body.freezeAt ?? null,
          capacity: body.capacity,
          isRated: body.isRated,
          divisionMin: body.divisionMin,
          divisionMax: body.divisionMax,
          scoringPolicy: 'icpc-binary-v1',
          ratingPolicy: 'codeforge-pairwise-elo-v1',
          problems: problemsWithTitles,
          runtimePolicyHash,
        })

        const manifest = await tx.contestManifest.create({
          data: {
            contestId: created.id,
            revision: 1,
            title: body.title,
            slug: body.slug,
            description: body.description,
            startTime: new Date(body.startTime),
            endTime: new Date(body.endTime),
            registrationOpensAt: new Date(body.registrationOpensAt),
            registrationClosesAt: new Date(body.registrationClosesAt),
            freezeAt: body.freezeAt ? new Date(body.freezeAt) : null,
            capacity: body.capacity,
            isRated: body.isRated,
            divisionMin: body.divisionMin ?? null,
            divisionMax: body.divisionMax ?? null,
            scoringPolicy: 'icpc-binary-v1',
            ratingPolicy: 'codeforge-pairwise-elo-v1',
            problems: problemsWithTitles as unknown as Prisma.InputJsonValue,
            manifestHash: realManifestHash,
            runtimePolicyHash,
            authorId: request.user!.id,
            status: 'DRAFT',
          },
        })

        return { ...created, manifests: [manifest], realManifestHash }
      })

      return {
        id: contest.id,
        slug: contest.slug,
        manifestId: contest.manifests[0]?.id,
        manifestHash: contest.realManifestHash,
        status: contest.status,
      }
    }
  )

  // Reviewer seals manifest and schedules contest
  app.post(
    '/staff/:id/seal',
    {
      schema: {
        params: idParam,
        body: ContestSealBody,
      },
      preHandler: [app.requireRole(...reviewerRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { id: request.params.id },
        include: {
          manifests: {
            where: { status: 'DRAFT' },
            orderBy: { revision: 'desc' },
            take: 1,
          },
        },
      })
      if (!contest) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      const manifest = contest.manifests[0]
      if (!manifest) {
        throw conflict('NO_DRAFT_MANIFEST', 'No draft manifest available to seal')
      }

      // Enforce separation of duties: author cannot review their own manifest
      if (manifest.authorId === request.user!.id) {
        throw forbidden(
          'SEPARATE_REVIEWER_REQUIRED',
          'The author of the contest draft cannot review and seal their own manifest'
        )
      }

      if (manifest.manifestHash !== request.body.manifestHash) {
        throw conflict(
          'MANIFEST_CHANGED',
          'Manifest hash mismatch: the draft has changed since review'
        )
      }

      // ── P3-R3 fix: at seal time, re-verify all problem versions are still PUBLISHED
      // and recompute the expected hash from persisted manifest fields to detect tampering.
      const manifestProblems = manifest.problems as Array<{
        label: string
        orderIndex: number
        problemId: string
        versionId: string
        packageHash: string
        points: number
        title: string
      }>
      const manifestVersionIds = manifestProblems.map(p => p.versionId)
      const manifestVersions = await prisma.practiceVersion.findMany({
        where: { id: { in: manifestVersionIds } },
        select: { id: true, status: true, publishedAt: true, packageHash: true },
      })
      for (const v of manifestVersions) {
        if (v.status !== 'PUBLISHED' || !v.publishedAt) {
          throw conflict(
            'VERSION_NOT_PUBLISHED',
            `Version ${v.id} is no longer PUBLISHED; re-draft the contest with a valid version`
          )
        }
        // Check for package hash drift (tampered package)
        const mProb = manifestProblems.find(p => p.versionId === v.id)
        if (mProb && mProb.packageHash !== v.packageHash) {
          throw conflict(
            'PACKAGE_HASH_MISMATCH',
            `Package hash for version ${v.id} has changed since the draft was created`
          )
        }
      }
      if (manifestVersions.length !== manifestVersionIds.length) {
        throw conflict('VERSION_NOT_FOUND', 'One or more problem versions no longer exist')
      }

      // Recompute expected hash from stored manifest fields and verify it matches
      const expectedHash = computeManifestHash({
        contestId: contest.id,
        revision: manifest.revision,
        title: manifest.title,
        slug: manifest.slug,
        description: manifest.description,
        startTime: manifest.startTime.toISOString(),
        endTime: manifest.endTime.toISOString(),
        registrationOpensAt: manifest.registrationOpensAt.toISOString(),
        registrationClosesAt: manifest.registrationClosesAt.toISOString(),
        freezeAt: manifest.freezeAt?.toISOString() ?? null,
        capacity: manifest.capacity,
        isRated: manifest.isRated,
        divisionMin: manifest.divisionMin,
        divisionMax: manifest.divisionMax,
        scoringPolicy: manifest.scoringPolicy,
        ratingPolicy: manifest.ratingPolicy,
        problems: manifestProblems,
        runtimePolicyHash: manifest.runtimePolicyHash,
      })
      if (expectedHash !== manifest.manifestHash) {
        throw conflict(
          'MANIFEST_INTEGRITY_FAILURE',
          'Stored manifest hash does not match recomputed hash; the manifest may have been tampered with'
        )
      }

      // Check runtime availability and pinned policy match
      const availability = await executionAvailability()
      if (!availability.enabled) {
        throw conflict('RUNTIME_UNAVAILABLE', 'Cannot seal contest without verified judge worker')
      }

      const now = new Date()

      await prisma.$transaction(async tx => {
        // Mark previous active manifests as superseded
        await tx.contestManifest.updateMany({
          where: { contestId: contest.id, status: 'SEALED' },
          data: { status: 'SUPERSEDED' },
        })

        // Seal current manifest
        const sealed = await tx.contestManifest.update({
          where: { id: manifest.id },
          data: {
            status: 'SEALED',
            reviewerId: request.user!.id,
            approvedAt: now,
          },
        })

        // Update contest to SCHEDULED and set activeManifestId
        await tx.contest.update({
          where: { id: contest.id },
          data: {
            status: 'SCHEDULED',
            activeManifestId: sealed.id,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: request.user!.id,
            action: 'contest.seal',
            target: contest.id,
            payload: {
              manifestId: sealed.id,
              manifestHash: sealed.manifestHash,
              reviewerId: request.user!.id,
            },
          },
        })
      })

      return { ok: true, status: 'SCHEDULED', manifestId: manifest.id }
    }
  )

  // Admin finalizes contest
  app.post(
    '/staff/:id/finalize',
    {
      schema: {
        params: idParam,
        body: ContestFinalizeBody,
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      return finalizeContest(request.params.id, request.user!.id, request.body.idempotencyKey)
    }
  )

  // Admin correction and dependent replay
  app.post(
    '/staff/:id/correct',
    {
      schema: {
        params: idParam,
        body: ContestCorrectionBody,
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const { id: contestId } = request.params
      const {
        reason,
        idempotencyKey,
        submissionId,
        problemLabel: _problemLabel,
        disqualifyUserId,
      } = request.body

      // ── P3-R5/R4 fix: idempotent correction — check for an existing operation with the same key. ──
      const existing = await prisma.contestSettlementJob.findUnique({
        where: { operationId: idempotencyKey },
      })
      if (existing) {
        return {
          ok: true,
          settlementJobId: existing.id,
          state: existing.state,
          message: 'Correction already queued (idempotent)',
        }
      }

      // If disqualifying user: do this synchronously (idempotent, does not affect pending verdicts)
      if (disqualifyUserId) {
        await prisma.contestParticipant.update({
          where: { contestId_userId: { contestId, userId: disqualifyUserId } },
          data: {
            status: 'DISQUALIFIED',
            disqualifiedAt: new Date(),
            disqualificationReason: reason,
          },
        })
      }

      // If rejudging specific submission: queue job with contestId validation
      let rejudgeJobId: string | null = null
      if (submissionId) {
        const policy = await getExecutionPolicy()
        const { job } = await rejudgeContestSubmission(prisma, {
          submissionId,
          contestId, // ── P3-R5 fix: validates submission belongs to this contest. ──
          actorId: request.user!.id,
          reason,
          idempotencyKey: `${idempotencyKey}:rejudge`,
          policy,
        })
        rejudgeJobId = job.id
      }

      // ── P3-R4 fix: queue a durable ContestSettlementJob for staged replay. ──
      // Replay will only execute after the replacement verdict is terminal.
      // This prevents publishing incomplete results while the new submission is QUEUED.
      const settlementJob = await prisma.contestSettlementJob.create({
        data: {
          contestId,
          operationId: idempotencyKey,
          type: submissionId ? 'REJUDGE_REPLAY' : 'DISQUALIFY_REPLAY',
          state: 'QUEUED',
          generation: 1,
        },
      })

      await prisma.auditLog.create({
        data: {
          actorId: request.user!.id,
          action: 'contest.correction.queued',
          target: contestId,
          payload: {
            contestId,
            submissionId,
            disqualifyUserId,
            rejudgeJobId,
            settlementJobId: settlementJob.id,
            operationId: idempotencyKey,
            reason,
          },
        },
      })

      return {
        ok: true,
        settlementJobId: settlementJob.id,
        rejudgeJobId,
        state: 'QUEUED',
        message: 'Correction queued. Replay will execute once replacement verdict is available.',
      }
    }
  )

  // Manual replay trigger (after verifying replacement verdict is terminal)
  app.post(
    '/staff/:id/replay',
    {
      schema: {
        params: idParam,
        body: z.object({
          idempotencyKey: z.string().min(8).max(128),
          reason: z.string().min(10).max(1000),
        }),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const { id: contestId } = request.params
      const { idempotencyKey, reason } = request.body

      // Check there are no pending rejudge submissions for this contest before replaying
      const pendingRejudge = await prisma.practiceJob.count({
        where: {
          contestId,
          scope: 'CONTEST',
          state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] },
        },
      })
      if (pendingRejudge > 0) {
        throw conflict(
          'REJUDGE_PENDING',
          `Cannot replay while ${pendingRejudge} rejudge submissions are still being judged. Wait for verdicts first.`
        )
      }

      const replayResult = await replayChronologicalContests(
        contestId,
        request.user!.id,
        reason,
        idempotencyKey
      )

      // Mark any settlement job as completed
      await prisma.contestSettlementJob.updateMany({
        where: { contestId, state: 'QUEUED' },
        data: { state: 'TERMINAL', finishedAt: new Date() },
      })

      return { ok: true, ...replayResult }
    }
  )

  // Inspect disputes
  app.get(
    '/staff/:id/disputes',
    {
      schema: { params: idParam },
      preHandler: [app.requireRole(...moderatorRoles)],
    },
    async request => {
      const disputes = await prisma.contestDispute.findMany({
        where: { contestId: request.params.id },
        include: {
          user: { select: { id: true, username: true, displayName: true } },
          resolvedBy: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return disputes
    }
  )

  // Resolve dispute
  app.post(
    '/staff/disputes/:id/resolve',
    {
      schema: {
        params: idParam,
        body: ContestDisputeResolveBody,
      },
      preHandler: [app.requireRole(...moderatorRoles)],
    },
    async request => {
      const dispute = await prisma.contestDispute.update({
        where: { id: request.params.id },
        data: {
          status: request.body.status,
          resolutionReason: request.body.resolutionReason,
          resolvedById: request.user!.id,
          resolvedAt: new Date(),
        },
      })
      return dispute
    }
  )

  // View rating ledger entries for a contest
  app.get(
    '/staff/:id/ledger',
    {
      schema: { params: idParam },
      preHandler: [app.requireRole(...staffRoles)],
    },
    async request => {
      const entries = await prisma.contestRatingLedger.findMany({
        where: { contestId: request.params.id, isAuthoritative: true },
        include: {
          user: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { rank: 'asc' },
      })
      return entries
    }
  )
}
