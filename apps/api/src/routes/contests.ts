import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma, practiceTransaction, enqueueContestSubmission, type Prisma } from '@codeforge/db'
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
import { assertContestVersionValidated } from '../contests/validation.js'
import {
  computeScoreboard,
  type ContestSubmissionEvent,
  type ScoreboardParticipantEntry,
} from '../contests/scoring.js'
import {
  queueSettlementOperation,
  publicOperation,
  retrySettlementOperation,
} from '../contests/operations.js'

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
  async function sealContestManifest(contestId: string, reviewerId: string, requestedHash: string) {
    const contest = await prisma.contest.findUnique({
      where: { id: contestId },
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
    if (manifest.authorId === reviewerId) {
      throw forbidden(
        'SEPARATE_REVIEWER_REQUIRED',
        'The author of the contest draft cannot review and seal their own manifest'
      )
    }

    if (manifest.manifestHash !== requestedHash) {
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
    if (
      !manifestProblems.length ||
      manifestProblems.length > 26 ||
      new Set(manifestProblems.map(p => p.label)).size !== manifestProblems.length ||
      new Set(manifestProblems.map(p => p.problemId)).size !== manifestProblems.length ||
      new Set(manifestProblems.map(p => p.versionId)).size !== manifestProblems.length
    ) {
      throw conflict('INVALID_PROBLEMS', 'A sealed contest requires unique assigned problems')
    }
    const manifestVersionIds = manifestProblems.map(p => p.versionId)
    const manifestVersions = await prisma.practiceVersion.findMany({
      where: { id: { in: manifestVersionIds } },
    })

    // Enforce separation of duties: reviewer cannot be the author of any assigned problem
    if (manifestVersions.some(v => v.authorId === reviewerId)) {
      throw forbidden(
        'SEPARATE_REVIEWER_REQUIRED',
        'The reviewer cannot be an author of any problem in the contest'
      )
    }

    const availability = await executionAvailability()
    if (!availability.enabled || !('policyHash' in availability)) {
      throw conflict('RUNTIME_UNAVAILABLE', 'Cannot seal contest without verified judge worker')
    }
    if (availability.policyHash !== manifest.runtimePolicyHash) {
      throw conflict('RUNTIME_POLICY_CHANGED', 'Re-draft the contest for the current judge policy')
    }
    for (const version of manifestVersions) {
      const assignment = manifestProblems.find(p => p.versionId === version.id)!
      if (
        assignment.problemId !== version.problemId ||
        assignment.packageHash !== version.packageHash
      ) {
        throw conflict(
          'PACKAGE_HASH_MISMATCH',
          'Assigned package or problem changed after drafting'
        )
      }
      await assertContestVersionValidated(prisma, version, manifest.runtimePolicyHash)
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

    const now = new Date()

    await practiceTransaction(prisma, async tx => {
      const current = await tx.contest.findUniqueOrThrow({ where: { id: contest.id } })
      if (current.status !== 'DRAFT' || current.startTime <= new Date()) {
        throw conflict('CONTEST_NOT_DRAFT', 'Only a future draft contest can be sealed')
      }
      const exactManifest = await tx.contestManifest.findUniqueOrThrow({
        where: { id: manifest.id },
      })
      const transactionHash = computeManifestHash({
        ...exactManifest,
        startTime: exactManifest.startTime.toISOString(),
        endTime: exactManifest.endTime.toISOString(),
        registrationOpensAt: exactManifest.registrationOpensAt.toISOString(),
        registrationClosesAt: exactManifest.registrationClosesAt.toISOString(),
        freezeAt: exactManifest.freezeAt?.toISOString() ?? null,
        problems: exactManifest.problems as typeof manifestProblems,
      })
      if (
        exactManifest.status !== 'DRAFT' ||
        exactManifest.manifestHash !== manifest.manifestHash ||
        transactionHash !== manifest.manifestHash
      ) {
        throw conflict('MANIFEST_CHANGED', 'Manifest changed while sealing')
      }
      for (const assignment of manifestProblems) {
        const version = await tx.practiceVersion.findUniqueOrThrow({
          where: { id: assignment.versionId },
        })
        if (
          version.problemId !== assignment.problemId ||
          version.packageHash !== assignment.packageHash
        ) {
          throw conflict('PACKAGE_HASH_MISMATCH', 'Assigned version changed while sealing')
        }
        await assertContestVersionValidated(tx, version, manifest.runtimePolicyHash)
      }
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
          reviewerId: reviewerId,
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
          actorId: reviewerId,
          action: 'contest.seal',
          target: contest.id,
          payload: {
            manifestId: sealed.id,
            manifestHash: sealed.manifestHash,
            reviewerId: reviewerId,
          },
        },
      })
    })

    return { ok: true, status: 'SCHEDULED', manifestId: manifest.id }
  }

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

  // Create contest draft (simple)
  app.post(
    '/',
    {
      schema: {
        body: z.object({
          title: z.string().trim().min(3).max(200),
          slug: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[a-z0-9-]+$/)
            .refine(
              v => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'),
              'Invalid slug format'
            ),
          description: z.string().max(10000).default(''),
          format: z.string().default('ICPC'),
          startTime: z.string().datetime(),
          endTime: z.string().datetime(),
          registrationOpensAt: z.string().datetime().optional(),
          registrationClosesAt: z.string().datetime().optional(),
          freezeAt: z.string().datetime().nullable().optional(),
          capacity: z.number().int().min(1).max(100000).default(5000),
          isRated: z.boolean().default(false),
          divisionMin: z.number().int().min(0).max(4000).nullable().optional(),
          divisionMax: z.number().int().min(0).max(4000).nullable().optional(),
        }),
      },
      preHandler: [app.requireRole(...authorRoles)],
    },
    async request => {
      const body = request.body
      const existing = await prisma.contest.findUnique({ where: { slug: body.slug } })
      if (existing) {
        throw conflict('SLUG_EXISTS', `Contest slug "${body.slug}" is already taken`)
      }

      const start = new Date(body.startTime)
      const end = new Date(body.endTime)
      const regOpen = body.registrationOpensAt ? new Date(body.registrationOpensAt) : new Date()
      const regClose = body.registrationClosesAt ? new Date(body.registrationClosesAt) : start

      if (
        regOpen >= regClose ||
        regClose > start ||
        start >= end ||
        (body.freezeAt && (new Date(body.freezeAt) <= start || new Date(body.freezeAt) >= end)) ||
        (body.divisionMin != null &&
          body.divisionMax != null &&
          body.divisionMin > body.divisionMax)
      ) {
        throw badRequest(
          'INVALID_SCHEDULE',
          'Registration, contest, freeze and rating bounds must be ordered'
        )
      }
      const available = await executionAvailability()
      const runtimePolicyHash =
        available.enabled && 'policyHash' in available ? available.policyHash : hash('bootstrap')
      const contest = await practiceTransaction(prisma, async tx => {
        const created = await tx.contest.create({
          data: {
            title: body.title,
            slug: body.slug,
            description: body.description,
            format: 'ICPC',
            startTime: start,
            endTime: end,
            registrationOpensAt: regOpen,
            registrationClosesAt: regClose,
            freezeAt: body.freezeAt ? new Date(body.freezeAt) : null,
            capacity: body.capacity,
            isRated: body.isRated,
            divisionMin: body.divisionMin ?? null,
            divisionMax: body.divisionMax ?? null,
            status: 'DRAFT',
            isPublic: true,
          },
        })

        const fields = {
          contestId: created.id,
          revision: 1,
          title: created.title,
          slug: created.slug,
          description: created.description,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          registrationOpensAt: regOpen.toISOString(),
          registrationClosesAt: regClose.toISOString(),
          freezeAt: created.freezeAt?.toISOString() ?? null,
          capacity: created.capacity,
          isRated: created.isRated,
          divisionMin: created.divisionMin,
          divisionMax: created.divisionMax,
          scoringPolicy: 'icpc-binary-v1',
          ratingPolicy: 'codeforge-pairwise-elo-v1',
          problems: [],
          runtimePolicyHash,
        }
        await tx.contestManifest.create({
          data: {
            ...fields,
            startTime: start,
            endTime: end,
            registrationOpensAt: regOpen,
            registrationClosesAt: regClose,
            freezeAt: created.freezeAt,
            manifestHash: computeManifestHash(fields),
            authorId: request.user!.id,
            status: 'DRAFT',
          },
        })
        return created
      })

      return contest
    }
  )

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
          manifests: { where: { status: 'DRAFT' }, orderBy: { revision: 'desc' }, take: 1 },
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
        mode?: 'STDIO' | 'FUNCTIONAL' | undefined
        signature?: ReturnType<typeof publicPackage>['signature'] | undefined
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
              mode: pub?.mode,
              signature: pub?.signature,
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
        activeManifest: isStaff ? contest.activeManifest : undefined,
        draftManifest: isStaff ? (contest.manifests[0] ?? null) : undefined,
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

        if (!liveContest.isPublic) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')

        if (['DRAFT', 'CANCELLED'].includes(liveContest.status)) {
          throw conflict('CONTEST_NOT_ACTIVE', 'Contest is not open for registration')
        }

        // ── P3-R6: existing registration check FIRST for idempotent read ──
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

        if (existing) {
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

      const lockKey = BigInt('0x' + contest.id.replace(/-/g, '').slice(0, 14)) & 0x1fffffffffffffn
      return prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`)
        const liveContest = await tx.contest.findUniqueOrThrow({ where: { id: contest.id } })
        const nowTx = new Date()

        if (liveContest.registrationClosesAt && nowTx >= liveContest.registrationClosesAt) {
          throw conflict(
            'WITHDRAWAL_CLOSED',
            'Registration has closed; withdrawal is no longer permitted'
          )
        }

        const part = await tx.contestParticipant.findUnique({
          where: { contestId_userId: { contestId: contest.id, userId: user.id } },
        })
        if (!part || part.status !== 'REGISTERED') {
          if (part && part.status === 'WITHDRAWN') {
            return { ok: true, status: 'WITHDRAWN' }
          }
          throw conflict('NOT_REGISTERED', 'You are not registered for this contest')
        }

        await tx.contestParticipant.update({
          where: { contestId_userId: { contestId: contest.id, userId: user.id } },
          data: { status: 'WITHDRAWN', withdrawnAt: nowTx },
        })

        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'contest.withdraw',
            target: contest.id,
            payload: { contestId: contest.id },
          },
        })

        return { ok: true, status: 'WITHDRAWN' }
      })
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

      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
        include: { activeManifest: true },
      })
      if (!contest || !contest.isPublic) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }

      // Matching retries return the original admission even after deadline or
      // temporary judge unavailability. The transaction repeats this check.
      const existing = await prisma.contestSubmission.findUnique({
        where: {
          contestId_userId_idempotencyKey: {
            contestId: contest.id,
            userId: user.id,
            idempotencyKey: request.body.idempotencyKey,
          },
        },
        include: { job: true },
      })
      if (existing) {
        if (
          existing.source !== request.body.code ||
          existing.language !== request.body.language ||
          existing.problemLabel !== request.body.problemLabel
        ) {
          throw conflict('IDEMPOTENCY_CONFLICT', 'Request key was used for different content')
        }
        return {
          id: existing.id,
          submissionId: existing.id,
          jobId: existing.jobId,
          problemLabel: existing.problemLabel,
          admittedAt: existing.admittedAt.toISOString(),
          state: existing.state,
          verdict: existing.verdict,
        }
      }
      const executionPolicy = await getExecutionPolicy()

      try {
        const { submission, job } = await enqueueContestSubmission(prisma, {
          contestId: contest.id,
          userId: user.id,
          problemLabel: request.body.problemLabel,
          language: request.body.language,
          source: request.body.code,
          idempotencyKey: request.body.idempotencyKey,
          policy: executionPolicy,
        })

        return {
          id: submission.id,
          submissionId: submission.id,
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
        if (msg.includes('not active')) {
          throw conflict('CONTEST_NOT_ACTIVE', msg)
        }
        if (msg.includes('not started')) {
          throw conflict('CONTEST_NOT_STARTED', msg)
        }
        if (msg.includes('ended')) {
          throw conflict('CONTEST_ENDED', msg)
        }
        if (msg.includes('disqualified')) {
          throw forbidden('DISQUALIFIED', msg)
        }
        if (msg.includes('must be registered')) {
          throw forbidden('NOT_REGISTERED', msg)
        }
        if (msg.includes('Banned')) {
          throw forbidden('ACCOUNT_BANNED', msg)
        }
        if (msg.includes('quota') || msg.includes('capacity')) {
          throw new HttpError(429, 'JUDGE_CAPACITY', msg)
        }
        if (msg.includes('Language')) {
          throw conflict('LANGUAGE_DISABLED', msg)
        }
        if (msg.includes('manifest')) {
          throw conflict('MANIFEST_NOT_SEALED', msg)
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

      // Require current verified execution policy and persisted validation jobs.
      const availability = await executionAvailability()
      if (!availability.enabled || !('policyHash' in availability)) {
        throw conflict(
          'RUNTIME_UNAVAILABLE',
          'A verified worker is required to prepare contest packages'
        )
      }
      const runtimePolicyHash = availability.policyHash
      const versionIds = body.problems.map(p => p.versionId)
      const versions = await prisma.practiceVersion.findMany({
        where: { id: { in: versionIds } },
        include: { problem: true },
      })
      if (versions.length !== body.problems.length) {
        throw notFound(
          'PROBLEM_VERSION_MISSING',
          'Assigned problem versions are missing or duplicated'
        )
      }
      const versionMap = new Map(versions.map(v => [v.id, v]))
      for (const assignment of body.problems) {
        const version = versionMap.get(assignment.versionId)!
        if (version.problemId !== assignment.problemId) {
          throw conflict('PROBLEM_VERSION_MISMATCH', 'Assigned problem does not own its version')
        }
        await assertContestVersionValidated(prisma, version, availability.policyHash)
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
    async request =>
      sealContestManifest(request.params.id, request.user!.id, request.body.manifestHash)
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
      return queueSettlementOperation(request.body.idempotencyKey, {
        contestId: request.params.id,
        actorId: request.user!.id,
        type: 'FINALIZE',
      })
    }
  )

  // A durable request is recorded before any correction side effect.
  app.post(
    '/staff/:id/correct',
    {
      schema: { params: idParam, body: ContestCorrectionBody },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const { idempotencyKey, reason, submissionId, disqualifyUserId, problemLabel } = request.body
      if (problemLabel && !submissionId)
        throw badRequest('SUBMISSION_REQUIRED', 'Choose a submission to rejudge')
      return queueSettlementOperation(idempotencyKey, {
        contestId: request.params.id,
        actorId: request.user!.id,
        type: 'CORRECTION',
        reason,
        submissionId,
        disqualifyUserId,
      })
    }
  )

  app.post(
    '/staff/:id/replay',
    {
      schema: {
        params: idParam,
        body: z
          .object({
            idempotencyKey: z.string().uuid(),
            reason: z.string().trim().min(10).max(1000),
          })
          .strict(),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request =>
      queueSettlementOperation(request.body.idempotencyKey, {
        contestId: request.params.id,
        actorId: request.user!.id,
        type: 'REPLAY',
        reason: request.body.reason,
      })
  )

  app.get(
    '/staff/:id/operations',
    {
      schema: { params: idParam },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const jobs = await prisma.contestSettlementJob.findMany({
        where: { contestId: request.params.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return { operations: jobs.map(publicOperation) }
    }
  )

  // Inspect disputes
  app.post(
    '/staff/:id/operations/:operationId/retry',
    {
      schema: {
        params: z.object({ id: z.string().uuid(), operationId: z.string().min(8).max(128) }),
        body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request =>
      retrySettlementOperation(
        request.params.id,
        request.params.operationId,
        request.user!.id,
        request.body.reason
      )
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

  // ─── Slug-based administrative and staff endpoints ─────────────────────────

  // Update draft manifest problems for contest slug
  app.put(
    '/:slug/manifest',
    {
      schema: {
        params: ContestSlugParam,
        body: z.object({
          problems: z.array(
            z.object({
              orderIndex: z.number().int().min(0).optional(),
              label: z.string().regex(/^[A-Z][0-9]?$/),
              problemId: z.string().uuid(),
              versionId: z.string().uuid(),
              points: z.number().int().min(1).max(1000).default(100),
              title: z.string().min(1).max(200).optional(),
            })
          ),
        }),
      },
      preHandler: [app.requireRole(...authorRoles)],
    },
    async request => {
      const availability = await executionAvailability()
      if (!availability.enabled || !('policyHash' in availability)) {
        throw conflict(
          'RUNTIME_UNAVAILABLE',
          'A verified worker is required to prepare contest packages'
        )
      }
      return practiceTransaction(prisma, async tx => {
        const contest = await tx.contest.findUnique({ where: { slug: request.params.slug } })
        if (!contest) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
        if (contest.status !== 'DRAFT') {
          throw conflict(
            'CONTEST_NOT_DRAFT',
            'Manifest can only be updated while contest is in DRAFT status'
          )
        }
        const draft = await tx.contestManifest.findFirst({
          where: { contestId: contest.id, status: 'DRAFT' },
          orderBy: { revision: 'desc' },
        })
        if (!draft) throw conflict('NO_DRAFT_MANIFEST', 'No draft manifest is available')
        if (draft.authorId !== request.user!.id && !operatorRoles.includes(request.user!.role)) {
          throw forbidden(
            'NOT_MANIFEST_AUTHOR',
            'Only the draft author or an administrator can edit it'
          )
        }
        const assigned = request.body.problems
        if (
          !assigned.length ||
          assigned.length > 26 ||
          new Set(assigned.map(p => p.label)).size !== assigned.length ||
          new Set(assigned.map(p => p.versionId)).size !== assigned.length ||
          new Set(assigned.map(p => p.problemId)).size !== assigned.length
        ) {
          throw badRequest(
            'INVALID_PROBLEMS',
            'Use 1 to 26 unique problem labels, problems and versions'
          )
        }
        const problems = []
        for (const [orderIndex, assignment] of assigned.entries()) {
          const version = await tx.practiceVersion.findUnique({
            where: { id: assignment.versionId },
          })
          if (!version || version.problemId !== assignment.problemId) {
            throw conflict('PROBLEM_VERSION_MISMATCH', 'Assigned problem does not own its version')
          }
          await assertContestVersionValidated(tx, version, availability.policyHash)
          problems.push({
            label: assignment.label,
            orderIndex,
            problemId: version.problemId,
            versionId: version.id,
            packageHash: version.packageHash,
            points: assignment.points,
            title: PracticePackage.parse(version.package).title,
          })
        }
        const manifestHash = computeManifestHash({
          ...draft,
          problems,
          runtimePolicyHash: availability.policyHash,
          startTime: draft.startTime.toISOString(),
          endTime: draft.endTime.toISOString(),
          registrationOpensAt: draft.registrationOpensAt.toISOString(),
          registrationClosesAt: draft.registrationClosesAt.toISOString(),
          freezeAt: draft.freezeAt?.toISOString() ?? null,
        })
        const manifest = await tx.contestManifest.update({
          where: { id: draft.id },
          data: {
            problems: problems as unknown as Prisma.InputJsonValue,
            manifestHash,
            runtimePolicyHash: availability.policyHash,
            authorId: request.user!.id,
          },
        })
        return { ok: true, manifestId: manifest.id, manifestHash: manifest.manifestHash }
      })
    }
  )

  // Slug compatibility route uses the exact same audited sealing path.
  app.post(
    '/:slug/seal',
    {
      schema: { params: ContestSlugParam, body: ContestSealBody },
      preHandler: [app.requireRole(...reviewerRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({ where: { slug: request.params.slug } })
      if (!contest) throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      return sealContestManifest(contest.id, request.user!.id, request.body.manifestHash)
    }
  )

  // Finalize contest for slug
  app.post(
    '/:slug/finalize',
    {
      schema: {
        params: ContestSlugParam,
        body: z.object({
          idempotencyKey: z.string().optional(),
          settlementNotes: z.string().optional(),
        }),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }
      const idemKey = request.body.idempotencyKey ?? `finalize:${contest.id}:${request.user!.id}`
      return queueSettlementOperation(idemKey, {
        contestId: contest.id,
        actorId: request.user!.id,
        type: 'FINALIZE',
      })
    }
  )

  // Get disputes for contest slug
  app.get(
    '/:slug/disputes',
    {
      schema: { params: ContestSlugParam },
      preHandler: [app.requireRole(...moderatorRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }
      const disputes = await prisma.contestDispute.findMany({
        where: { contestId: contest.id },
        include: {
          user: { select: { id: true, username: true, displayName: true } },
          resolvedBy: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return {
        disputes: disputes.map(d => ({
          ...d,
          problemLabel: 'A',
          reason: d.description,
        })),
      }
    }
  )

  // Resolve dispute for contest slug
  app.post(
    '/:slug/disputes/:disputeId/resolve',
    {
      schema: {
        params: z.object({
          slug: ContestSlugParam.shape.slug,
          disputeId: z.string().uuid(),
        }),
        body: z.object({
          status: z.enum([
            'INVESTIGATING',
            'RESOLVED_REJUDGE',
            'RESOLVED_DISQUALIFIED',
            'DISMISSED',
            'RESOLVED',
            'REJECTED',
          ]),
          resolutionNotes: z.string().optional(),
          resolutionReason: z.string().optional(),
        }),
      },
      preHandler: [app.requireRole(...moderatorRoles)],
    },
    async request => {
      const reason =
        request.body.resolutionReason ||
        request.body.resolutionNotes ||
        'Dispute resolved by administrator'
      const mappedStatus =
        request.body.status === 'RESOLVED'
          ? 'RESOLVED_REJUDGE'
          : request.body.status === 'REJECTED'
            ? 'DISMISSED'
            : request.body.status
      const dispute = await prisma.contestDispute.update({
        where: { id: request.params.disputeId },
        data: {
          status: mappedStatus,
          resolutionReason: reason,
          resolvedById: request.user!.id,
          resolvedAt: new Date(),
        },
      })
      return { ok: true, dispute }
    }
  )

  // Rejudge submission for contest slug
  app.post(
    '/:slug/submissions/:id/rejudge',
    {
      schema: {
        params: z.object({
          slug: ContestSlugParam.shape.slug,
          id: z.string().uuid(),
        }),
        body: z.object({
          correctionType: z.string().optional(),
          reason: z.string().optional(),
          idempotencyKey: z.string().optional(),
        }),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }
      const reason = request.body.reason || 'Manual rejudge initiated by contest administrator.'
      const idempotencyKey =
        request.body.idempotencyKey || `rejudge:${request.params.id}:${Date.now()}`
      return queueSettlementOperation(idempotencyKey, {
        contestId: contest.id,
        actorId: request.user!.id,
        type: 'CORRECTION',
        reason,
        submissionId: request.params.id,
      })
    }
  )

  // Replay chronological contests starting from contest slug
  app.post(
    '/:slug/replay',
    {
      schema: {
        params: ContestSlugParam,
        body: z.object({
          reason: z.string().optional(),
          idempotencyKey: z.string().optional(),
        }),
      },
      preHandler: [app.requireRole(...operatorRoles)],
    },
    async request => {
      const contest = await prisma.contest.findUnique({
        where: { slug: request.params.slug },
      })
      if (!contest) {
        throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
      }
      const reason = request.body.reason || 'Chronological replay triggered by administrator.'
      const idempotencyKey = request.body.idempotencyKey || `replay:${contest.id}:${Date.now()}`

      return queueSettlementOperation(idempotencyKey, {
        contestId: contest.id,
        actorId: request.user!.id,
        type: 'REPLAY',
        reason,
      })
    }
  )
}
