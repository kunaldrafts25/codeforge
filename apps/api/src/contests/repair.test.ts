/**
 * Phase 3 Repair Regression Tests
 *
 * Comprehensive integration and unit regression tests verifying findings P3-R1 through P3-R7:
 *
 * P3-R1 & P3-R6: Same-key retry after deadline, conflicting payloads & concurrency serialization
 * P3-R2: Practice scope isolation, rejection of contest jobs, route filtering
 * P3-R3: Manifest sealing integrity, validation artifacts, separation of duties & hash parity
 * P3-R4: Dependent rating replay, disqualified user handling, baseline reset & standings revision
 * P3-R5: Rejudge policy binding, lineage generation serialization (max(gen) + 1) & idempotency
 * P3-R7: Leaderboard SQL pagination, competition ranking (1, 1, 3) across page boundaries & rating precision
 */

import { describe, test, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  computePairwiseExpected,
  computePairwiseElo,
  type CompetitorRatingInput,
} from '../contests/rating.js'
import { computeScoreboard, type ContestSubmissionEvent } from '../contests/scoring.js'
import { computeManifestHash } from '../contests/manifest.js'
import { canonical, hash } from '../practice/package.js'
import { PracticePackage } from '@codeforge/shared'
import { forbidden, handleError } from '../errors.js'
import { replayChronologicalContests } from '../contests/settlement.js'

// ─── Test Store & In-Memory Prisma Mock ────────────────────────────────────────

type RecordLike = Record<string, any>

function createTestStore() {
  const users = new Map<string, RecordLike>()
  const contests = new Map<string, RecordLike>()
  const contestParticipants = new Map<string, RecordLike>()
  const contestManifests = new Map<string, RecordLike>()
  const practiceProblems = new Map<string, RecordLike>()
  const practiceVersions = new Map<string, RecordLike>()
  const practiceJobs = new Map<string, RecordLike>()
  const contestSubmissions = new Map<string, RecordLike>()
  const contestRatingLedgers: RecordLike[] = []
  const contestScoreboardSnapshots: RecordLike[] = []
  const contestSettlementJobs = new Map<string, RecordLike>()
  const auditLogs: RecordLike[] = []
  const runtimes: RecordLike[] = []

  let txLock = Promise.resolve()

  const prismaMock: RecordLike = {
    contestDispute: { count: async () => 0 },
    user: {
      findUnique: async ({ where }: RecordLike) => users.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: RecordLike) => {
        const u = users.get(where.id)
        if (!u) throw new Error(`User not found: ${where.id}`)
        return u
      },
      findMany: async ({ where, orderBy, select }: RecordLike) => {
        let list = [...users.values()]
        if (where?.id?.in) list = list.filter(u => where.id.in.includes(u.id))
        if (where?.isBanned !== undefined) list = list.filter(u => u.isBanned === where.isBanned)
        return list
      },
      update: async ({ where, data }: RecordLike) => {
        const u = users.get(where.id)
        if (!u) throw new Error(`User not found: ${where.id}`)
        Object.assign(u, data)
        return u
      },
    },
    contest: {
      findUnique: async ({ where, include }: RecordLike) => {
        const c = where.id
          ? contests.get(where.id)
          : [...contests.values()].find(x => x.slug === where.slug)
        if (!c) return null
        return hydrateContest(c, include)
      },
      findUniqueOrThrow: async ({ where, include }: RecordLike) => {
        const c = contests.get(where.id)
        if (!c) throw new Error(`Contest not found: ${where.id}`)
        return hydrateContest(c, include)
      },
      findMany: async ({ where, orderBy, include }: RecordLike) => {
        let list = [...contests.values()]
        if (where?.isRated !== undefined) list = list.filter(c => c.isRated === where.isRated)
        if (where?.status) list = list.filter(c => c.status === where.status)
        if (where?.isPublic !== undefined) list = list.filter(c => c.isPublic === where.isPublic)
        return list.map(c => hydrateContest(c, include))
      },
      create: async ({ data }: RecordLike) => {
        const id = data.id ?? `contest-${contests.size + 1}`
        const c = { ...data, id }
        contests.set(id, c)
        return c
      },
      update: async ({ where, data }: RecordLike) => {
        const c = contests.get(where.id)
        if (!c) throw new Error('Contest not found')
        Object.assign(c, data)
        return c
      },
    },
    contestParticipant: {
      findUnique: async ({ where, include }: RecordLike) => {
        const key = `${where.contestId_userId.contestId}:${where.contestId_userId.userId}`
        const p = contestParticipants.get(key)
        if (!p) return null
        const u = users.get(p.userId)
        return include?.user ? { ...p, user: u } : p
      },
      findMany: async ({ where, include }: RecordLike) => {
        let list = [...contestParticipants.values()]
        if (where?.contestId) list = list.filter(p => p.contestId === where.contestId)
        if (where?.status) list = list.filter(p => p.status === where.status)
        return list.map(p => (include?.user ? { ...p, user: users.get(p.userId) } : p))
      },
      count: async ({ where }: RecordLike) => {
        let list = [...contestParticipants.values()]
        if (where?.contestId) list = list.filter(p => p.contestId === where.contestId)
        if (where?.status) list = list.filter(p => p.status === where.status)
        return list.length
      },
      create: async ({ data }: RecordLike) => {
        const key = `${data.contestId}:${data.userId}`
        const p = { ...data, id: `cp-${contestParticipants.size + 1}` }
        contestParticipants.set(key, p)
        return p
      },
      update: async ({ where, data }: RecordLike) => {
        const key = `${where.contestId_userId.contestId}:${where.contestId_userId.userId}`
        const p = contestParticipants.get(key)
        if (!p) throw new Error('Participant not found')
        Object.assign(p, data)
        return p
      },
    },
    contestManifest: {
      findUniqueOrThrow: async ({ where }: RecordLike) => {
        const manifest = contestManifests.get(where.id)
        if (!manifest) throw new Error('Manifest not found')
        return manifest
      },
      create: async ({ data }: RecordLike) => {
        const id = data.id ?? `manifest-${contestManifests.size + 1}`
        const m = { ...data, id }
        contestManifests.set(id, m)
        const contest = contests.get(m.contestId)
        if (contest) {
          contest.activeManifestId = id
          contest.activeManifest = m
        }
        return m
      },
      update: async ({ where, data }: RecordLike) => {
        const m = contestManifests.get(where.id)
        if (!m) throw new Error('Manifest not found')
        Object.assign(m, data)
        return m
      },
      updateMany: async ({ where, data }: RecordLike) => {
        let count = 0
        for (const m of contestManifests.values()) {
          if (m.contestId === where.contestId && (!where.status || m.status === where.status)) {
            Object.assign(m, data)
            count++
          }
        }
        return { count }
      },
    },
    practiceVersion: {
      findUnique: async ({ where, select }: RecordLike) => {
        const v = practiceVersions.get(where.id)
        return v ?? null
      },
      findUniqueOrThrow: async ({ where, select }: RecordLike) => {
        const v = practiceVersions.get(where.id)
        if (!v) throw new Error(`PracticeVersion not found: ${where.id}`)
        return v
      },
      findMany: async ({ where, include, select }: RecordLike) => {
        let list = [...practiceVersions.values()]
        if (where?.id?.in) list = list.filter(v => where.id.in.includes(v.id))
        return list.map(v =>
          include?.problem
            ? {
                ...v,
                problem: practiceProblems.get(v.problemId) ?? { id: v.problemId, title: 'Prob' },
              }
            : v
        )
      },
    },
    practiceProblem: {
      findUnique: async ({ where }: RecordLike) => practiceProblems.get(where.id) ?? null,
    },
    practiceJob: {
      findUnique: async ({ where, select }: RecordLike) => practiceJobs.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: RecordLike) => {
        const j = practiceJobs.get(where.id)
        if (!j) throw new Error(`PracticeJob not found: ${where.id}`)
        return j
      },
      findFirst: async ({ where, select }: RecordLike) => {
        const j = [...practiceJobs.values()].find(x => {
          if (where.id && x.id !== where.id) return false
          if (where.ownerId && x.ownerId !== where.ownerId) return false
          if (where.scope && x.scope !== where.scope) return false
          if (where.kind?.in && !where.kind.in.includes(x.kind)) return false
          return true
        })
        return j ?? null
      },
      findMany: async ({ where, orderBy, skip, take, select }: RecordLike) => {
        let list = [...practiceJobs.values()]
        if (where?.id?.in) list = list.filter(j => where.id.in.includes(j.id))
        if (where?.versionId) list = list.filter(j => j.versionId === where.versionId)
        if (typeof where?.kind === 'string') list = list.filter(j => j.kind === where.kind)
        if (typeof where?.state === 'string') list = list.filter(j => j.state === where.state)
        if (where?.verdict) list = list.filter(j => j.verdict === where.verdict)
        if (where?.ownerId) list = list.filter(j => j.ownerId === where.ownerId)
        if (where?.scope) list = list.filter(j => j.scope === where.scope)
        if (where?.kind?.in) list = list.filter(j => where.kind.in.includes(j.kind))
        if (where?.state?.in) list = list.filter(j => where.state.in.includes(j.state))
        if (skip !== undefined && take !== undefined) {
          list = list.slice(skip, skip + take)
        }
        return list
      },
      count: async ({ where }: RecordLike) => {
        let list = [...practiceJobs.values()]
        if (where?.id?.in) list = list.filter(j => where.id.in.includes(j.id))
        if (where?.versionId) list = list.filter(j => j.versionId === where.versionId)
        if (typeof where?.kind === 'string') list = list.filter(j => j.kind === where.kind)
        if (typeof where?.state === 'string') list = list.filter(j => j.state === where.state)
        if (where?.verdict) list = list.filter(j => j.verdict === where.verdict)
        if (where?.ownerId) list = list.filter(j => j.ownerId === where.ownerId)
        if (where?.scope) list = list.filter(j => j.scope === where.scope)
        if (where?.kind?.in) list = list.filter(j => where.kind.in.includes(j.kind))
        if (where?.state?.in) list = list.filter(j => where.state.in.includes(j.state))
        return list.length
      },
      create: async ({ data }: RecordLike) => {
        const id = data.id ?? `job-${practiceJobs.size + 1}`
        const j = {
          ...data,
          id,
          state: data.state ?? 'QUEUED',
          createdAt: new Date(),
          generation: data.generation ?? 1,
        }
        practiceJobs.set(id, j)
        return j
      },
      updateMany: async ({ where, data }: RecordLike) => {
        let count = 0
        for (const j of practiceJobs.values()) {
          if (where.id && j.id !== where.id) continue
          if (where.state?.in && !where.state.in.includes(j.state)) continue
          Object.assign(j, data)
          count++
        }
        return { count }
      },
    },
    contestSubmission: {
      count: async ({ where }: RecordLike) => {
        return [...contestSubmissions.values()].filter(s => {
          if (where?.contestId?.in && !where.contestId.in.includes(s.contestId)) return false
          if (typeof where?.contestId === 'string' && s.contestId !== where.contestId) return false
          if (where?.isAuthoritative !== undefined && s.isAuthoritative !== where.isAuthoritative)
            return false
          return s.state !== 'TERMINAL' || !s.verdict || s.verdict === 'JUDGE_FAILURE'
        }).length
      },
      findUnique: async ({ where, include }: RecordLike) => {
        if (where.contestId_userId_idempotencyKey) {
          const { contestId, userId, idempotencyKey } = where.contestId_userId_idempotencyKey
          const sub = [...contestSubmissions.values()].find(
            s =>
              s.contestId === contestId &&
              s.userId === userId &&
              s.idempotencyKey === idempotencyKey
          )
          if (!sub) return null
          return include?.job ? { ...sub, job: practiceJobs.get(sub.jobId) } : sub
        }
        if (where.id) {
          const sub = contestSubmissions.get(where.id)
          if (!sub) return null
          return include?.job ? { ...sub, job: practiceJobs.get(sub.jobId) } : sub
        }
        return null
      },
      findUniqueOrThrow: async ({ where, include }: RecordLike) => {
        const sub = contestSubmissions.get(where.id)
        if (!sub) throw new Error(`Submission not found: ${where.id}`)
        return include?.job ? { ...sub, job: practiceJobs.get(sub.jobId) } : sub
      },
      findMany: async ({ where, orderBy, include, select }: RecordLike) => {
        let list = [...contestSubmissions.values()]
        if (where?.contestId) list = list.filter(s => s.contestId === where.contestId)
        if (where?.userId) list = list.filter(s => s.userId === where.userId)
        if (where?.problemId) list = list.filter(s => s.problemId === where.problemId)
        if (where?.job?.OR)
          list = list.filter(s => {
            const job = practiceJobs.get(s.jobId)
            return where.job.OR.some((condition: RecordLike) =>
              condition.id ? job?.id === condition.id : job?.originJobId === condition.originJobId
            )
          })
        if (where?.isAuthoritative !== undefined) {
          list = list.filter(s => s.isAuthoritative === where.isAuthoritative)
        }
        if (orderBy?.generation === 'desc') {
          list.sort((a, b) => b.generation - a.generation)
        } else if (orderBy?.[0]?.admittedAt) {
          list.sort((a, b) => a.admittedAt.getTime() - b.admittedAt.getTime())
        }
        return list.map(s => (include?.job ? { ...s, job: practiceJobs.get(s.jobId) } : s))
      },
      create: async ({ data }: RecordLike) => {
        const id = data.id ?? `sub-${contestSubmissions.size + 1}`
        const s = { ...data, id }
        contestSubmissions.set(id, s)
        return s
      },
      update: async ({ where, data }: RecordLike) => {
        const s = contestSubmissions.get(where.id)
        if (!s) throw new Error('Submission not found')
        Object.assign(s, data)
        return s
      },
      updateMany: async ({ where, data }: RecordLike) => {
        let count = 0
        for (const s of contestSubmissions.values()) {
          if (where.id?.in && !where.id.in.includes(s.id)) continue
          if (where.contestId && s.contestId !== where.contestId) continue
          if (where.userId && s.userId !== where.userId) continue
          if (where.problemId && s.problemId !== where.problemId) continue
          if (where.isAuthoritative !== undefined && s.isAuthoritative !== where.isAuthoritative)
            continue
          Object.assign(s, data)
          count++
        }
        return { count }
      },
    },
    contestRatingLedger: {
      findFirst: async ({ where, include, orderBy }: RecordLike) => {
        let list = contestRatingLedgers.filter(r => {
          if (where?.userId && r.userId !== where.userId) return false
          if (where?.isAuthoritative !== undefined && r.isAuthoritative !== where.isAuthoritative)
            return false
          return true
        })
        if (list.length === 0) return null
        return list[list.length - 1]!
      },
      findMany: async ({ where }: RecordLike) => {
        let list = [...contestRatingLedgers]
        if (where?.userId) list = list.filter(r => r.userId === where.userId)
        if (where?.isAuthoritative !== undefined) {
          list = list.filter(r => r.isAuthoritative === where.isAuthoritative)
        }
        return list
      },
      create: async ({ data }: RecordLike) => {
        const r = { ...data, id: `crl-${contestRatingLedgers.length + 1}` }
        contestRatingLedgers.push(r)
        return r
      },
      updateMany: async ({ where, data }: RecordLike) => {
        let count = 0
        for (const r of contestRatingLedgers) {
          if (where?.contestId?.in && !where.contestId.in.includes(r.contestId)) continue
          if (where?.generation && r.generation !== where.generation) continue
          if (where?.isAuthoritative !== undefined && r.isAuthoritative !== where.isAuthoritative)
            continue
          Object.assign(r, data)
          count++
        }
        return { count }
      },
      aggregate: async ({ where, _max }: RecordLike) => {
        let list = contestRatingLedgers
        if (where?.userId) list = list.filter(r => r.userId === where.userId)
        if (where?.isAuthoritative !== undefined) {
          list = list.filter(r => r.isAuthoritative === where.isAuthoritative)
        }
        const maxGen = list.reduce((m, r) => Math.max(m, r.generation ?? 1), 1)
        const maxRating = list.reduce((m, r) => Math.max(m, r.newRating ?? 1500), 1500)
        return { _max: { generation: maxGen, newRating: maxRating } }
      },
      count: async ({ where }: RecordLike) => {
        let list = contestRatingLedgers
        if (where?.userId) list = list.filter(r => r.userId === where.userId)
        if (where?.isAuthoritative !== undefined) {
          list = list.filter(r => r.isAuthoritative === where.isAuthoritative)
        }
        return list.length
      },
    },
    contestScoreboardSnapshot: {
      findFirst: async ({ where, orderBy, select }: RecordLike) => {
        const list = contestScoreboardSnapshots
          .filter(
            s =>
              s.contestId === where.contestId &&
              (where.isFrozen === undefined || s.isFrozen === where.isFrozen)
          )
          .sort((a, b) => b.revision - a.revision)
        return list[0] ?? null
      },
      create: async ({ data }: RecordLike) => {
        const s = { ...data, id: `snap-${contestScoreboardSnapshots.length + 1}` }
        contestScoreboardSnapshots.push(s)
        return s
      },
    },
    contestSettlementJob: {
      findUnique: async ({ where }: RecordLike) =>
        contestSettlementJobs.get(where.operationId) ?? null,
      upsert: async ({ where, create, update }: RecordLike) => {
        let job = contestSettlementJobs.get(where.operationId)
        if (job) {
          Object.assign(job, update)
        } else {
          job = { ...create, id: `setjob-${contestSettlementJobs.size + 1}` }
          contestSettlementJobs.set(where.operationId, job)
        }
        return job
      },
      update: async ({ where, data }: RecordLike) => {
        const job = [...contestSettlementJobs.values()].find(j => j.id === where.id)
        if (job) Object.assign(job, data)
        return job
      },
    },
    practiceJudgeRuntime: {
      findFirst: async () => runtimes[0] ?? null,
    },
    auditLog: {
      create: async ({ data }: RecordLike) => {
        const a = { ...data, id: `audit-${auditLogs.length + 1}` }
        auditLogs.push(a)
        return a
      },
    },
    $executeRawUnsafe: async () => 1,
    $queryRaw: async (sqlQuery: any) => {
      const qStr = typeof sqlQuery === 'string' ? sqlQuery : JSON.stringify(sqlQuery)
      if (qStr.includes('SELECT md5')) {
        return [
          { revision: hash(canonical([...users.values(), ...contestRatingLedgers])).slice(0, 32) },
        ]
      }
      if (qStr.includes('COUNT(DISTINCT u.id)')) {
        const eligible = [...users.values()].filter(
          u =>
            !u.isBanned &&
            contestRatingLedgers.some(crl => crl.userId === u.id && crl.isAuthoritative)
        )
        return [{ count: BigInt(eligible.length) }]
      }
      if (qStr.includes('RANK() OVER')) {
        const eligible = [...users.values()].filter(
          u =>
            !u.isBanned &&
            contestRatingLedgers.some(crl => crl.userId === u.id && crl.isAuthoritative)
        )
        // PostgreSQL window rank with order by rating DESC, id ASC
        eligible.sort((a, b) =>
          b.rating !== a.rating ? b.rating - a.rating : a.id.localeCompare(b.id)
        )
        const ranked: RecordLike[] = []
        let currentRank = 1
        for (let i = 0; i < eligible.length; i++) {
          if (i > 0 && eligible[i]!.rating !== eligible[i - 1]!.rating) {
            currentRank = i + 1
          }
          const u = eligible[i]!
          const contestCount = new Set(
            contestRatingLedgers
              .filter(crl => crl.userId === u.id && crl.isAuthoritative)
              .map(crl => crl.contestId)
          ).size
          ranked.push({
            id: u.id,
            username: u.username,
            displayName: u.displayName ?? null,
            avatarUrl: u.avatarUrl ?? null,
            rating: u.rating,
            maxRating: u.maxRating,
            rank: BigInt(currentRank),
            contestsCount: BigInt(contestCount),
          })
        }
        // Extract limit and skip from SQL template parameters
        const limit = sqlQuery?.values?.[0] !== undefined ? Number(sqlQuery.values[0]) : 50
        const skip = sqlQuery?.values?.[1] !== undefined ? Number(sqlQuery.values[1]) : 0
        return ranked.slice(skip, skip + limit)
      }
      if (qStr.includes('PracticeSolve')) {
        return []
      }
      return []
    },
    // Mutex-serialized transactions mirror PostgreSQL serializable isolation
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const prev = txLock
      let release: () => void
      txLock = new Promise(resolve => {
        release = resolve
      })
      await prev
      try {
        return await fn(prismaMock)
      } finally {
        release!()
      }
    },
  }

  function hydrateContest(c: RecordLike, include?: RecordLike) {
    const res = { ...c }
    if (include?.activeManifest) {
      res.activeManifest = contestManifests.get(c.activeManifestId) ?? null
    }
    if (include?.manifests) {
      res.manifests = [...contestManifests.values()].filter(m => m.contestId === c.id)
      if (include.manifests.where?.status) {
        res.manifests = res.manifests.filter(m => m.status === include.manifests.where.status)
      }
      if (include.manifests.orderBy?.revision === 'desc') {
        res.manifests.sort((a: any, b: any) => b.revision - a.revision)
      }
    }
    if (include?.participants) {
      res.participants = [...contestParticipants.values()]
        .filter(p => p.contestId === c.id)
        .map(p => (include.participants.include?.user ? { ...p, user: users.get(p.userId) } : p))
    }
    return res
  }

  return {
    prisma: prismaMock,
    users,
    contests,
    contestParticipants,
    contestManifests,
    practiceProblems,
    practiceVersions,
    practiceJobs,
    contestSubmissions,
    contestRatingLedgers,
    contestScoreboardSnapshots,
    contestSettlementJobs,
    auditLogs,
    runtimes,
  }
}

// Hoist global store and mock `@codeforge/db`
const testStore = vi.hoisted(() => createTestStore())

vi.mock('@codeforge/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@codeforge/db')>()
  return {
    ...actual,
    prisma: testStore.prisma,
  }
})

// Enable runtime availability for draft/seal
process.env.FORGE_PRACTICE_ENABLED = '1'
const executionPolicy = { type: 'gvisor', limits: { timeMs: 1000, memoryMb: 256 } }
testStore.runtimes.push({
  id: 'runtime-1',
  policy: executionPolicy,
  policyHash: hash(canonical(executionPolicy)),
  heartbeatAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
})

import {
  enqueueContestSubmission,
  rejudgeContestSubmission,
} from '../../../../packages/db/src/contest-queue.js'
import { rejudgePracticeJob } from '../../../../packages/db/src/practice-queue.js'
import { practiceRoutes } from '../routes/practice.js'
import { contestRoutes } from '../routes/contests.js'
import { leaderboardRoutes } from '../routes/leaderboard.js'

// ─── P3-R7: Rating precision and zero-sum conservation ────────────────────────

describe('P3-R7 — rating precision', () => {
  const SCALE = 1_000_000_000_000n

  test('computePairwiseExpected: complementary probabilities sum to SCALE exactly', () => {
    const cases: [number, number][] = [
      [1500, 1500],
      [1500, 1600],
      [1200, 1800],
      [999, 3000],
      [1500, 1501],
    ]
    for (const [ri, rj] of cases) {
      const { e_ij, e_ji } = computePairwiseExpected(ri, rj)
      expect(e_ij + e_ji).toBe(SCALE)
      expect(e_ij >= 0n).toBe(true)
      expect(e_ji >= 0n).toBe(true)
    }
  })

  test('computePairwiseExpected: boundary — massive rating diff clamps to 0 or SCALE', () => {
    const { e_ij, e_ji } = computePairwiseExpected(1000, 21001)
    expect(e_ij).toBe(0n)
    expect(e_ji).toBe(SCALE)

    const { e_ij: e2, e_ji: e2ji } = computePairwiseExpected(21001, 1000)
    expect(e2).toBe(SCALE)
    expect(e2ji).toBe(0n)
  })

  test('computePairwiseExpected: independent reference vectors for symmetric case', () => {
    const { e_ij, e_ji } = computePairwiseExpected(1500, 1500)
    expect(e_ij).toBe(500_000_000_000n)
    expect(e_ji).toBe(500_000_000_000n)
  })

  test('computePairwiseElo: zero-sum conservation with 5 competitors', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'u1',
        rating: 1700,
        maxRating: 1700,
        solves: 3,
        penalty: 120,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u2',
        rating: 1600,
        maxRating: 1600,
        solves: 3,
        penalty: 200,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u3',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 80,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u4',
        rating: 1400,
        maxRating: 1400,
        solves: 1,
        penalty: 40,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u5',
        rating: 1300,
        maxRating: 1300,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(true)
    const deltaSum = result.results.reduce((s, r) => s + r.delta, 0)
    expect(deltaSum).toBe(0)
  })

  test('computePairwiseElo: ties share rank in stable user-ID order', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'aaaa',
        rating: 1500,
        maxRating: 1500,
        solves: 1,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'bbbb',
        rating: 1500,
        maxRating: 1500,
        solves: 1,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'cccc',
        rating: 1500,
        maxRating: 1500,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(true)
    const deltaSum = result.results.reduce((s, r) => s + r.delta, 0)
    expect(deltaSum).toBe(0)

    const aaaa = result.results.find(r => r.userId === 'aaaa')!
    const bbbb = result.results.find(r => r.userId === 'bbbb')!
    expect(aaaa.rawDelta).toBeCloseTo(bbbb.rawDelta, 6)
  })

  test('computePairwiseElo: fewer than 2 eligible → not eligible', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'u1',
        rating: 1500,
        maxRating: 1500,
        solves: 1,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(false)
    expect(result.reason).toBe('INSUFFICIENT_PARTICIPANTS')
  })

  test('computePairwiseElo: disqualified users excluded from rating calc', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'u1',
        rating: 1600,
        maxRating: 1600,
        solves: 3,
        penalty: 100,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u2',
        rating: 1400,
        maxRating: 1400,
        solves: 1,
        penalty: 50,
        hasDeterministicVerdict: true,
        isDisqualified: true,
      },
      {
        userId: 'u3',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 80,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(true)
    expect(result.results.length).toBe(2)
    expect(result.results.map(r => r.userId).sort()).toEqual(['u1', 'u3'])
  })

  test('computePairwiseElo: no deterministic verdict → excluded', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'u1',
        rating: 1600,
        maxRating: 1600,
        solves: 3,
        penalty: 100,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u2',
        rating: 1400,
        maxRating: 1400,
        solves: 1,
        penalty: 50,
        hasDeterministicVerdict: false,
      },
      {
        userId: 'u3',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 80,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(true)
    expect(result.results.length).toBe(2)
  })
})

// ─── P3-R3: Manifest hash integrity ───────────────────────────────────────────

describe('P3-R3 — manifest hash integrity', () => {
  const baseManifest = {
    contestId: '550e8400-e29b-41d4-a716-446655440000',
    revision: 1,
    title: 'Test Contest',
    slug: 'test-contest',
    description: null,
    startTime: '2026-10-10T10:00:00.000Z',
    endTime: '2026-10-10T14:00:00.000Z',
    registrationOpensAt: '2026-10-05T00:00:00.000Z',
    registrationClosesAt: '2026-10-10T09:00:00.000Z',
    freezeAt: null,
    capacity: 100,
    isRated: true,
    divisionMin: null,
    divisionMax: null,
    scoringPolicy: 'icpc-binary-v1' as const,
    ratingPolicy: 'codeforge-pairwise-elo-v1' as const,
    problems: [
      {
        label: 'A',
        orderIndex: 0,
        problemId: 'pid1',
        versionId: 'vid1',
        packageHash: 'abc123',
        points: 1,
        title: 'Problem A',
      },
    ],
    runtimePolicyHash: 'deadbeef01234567890123456789012345678901234567890123456789012345',
  }

  test('hash is deterministic and changes when contestId changes', () => {
    const h1 = computeManifestHash(baseManifest)
    const h2 = computeManifestHash({
      ...baseManifest,
      contestId: '00000000-0000-0000-0000-000000000000',
    })
    expect(h1).not.toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('hash changes when packageHash changes (tamper detection)', () => {
    const h1 = computeManifestHash(baseManifest)
    const h2 = computeManifestHash({
      ...baseManifest,
      problems: [{ ...baseManifest.problems[0]!, packageHash: 'tampered123' }],
    })
    expect(h1).not.toBe(h2)
  })

  test('hash is identical for same inputs (recomputation parity)', () => {
    const h1 = computeManifestHash(baseManifest)
    const h2 = computeManifestHash(baseManifest)
    expect(h1).toBe(h2)
  })
})

// ─── Scoreboard: ICPC rules ───────────────────────────────────────────────────

describe('Scoring — ICPC rules', () => {
  const start = new Date('2026-10-10T10:00:00Z')

  const mkSub = (
    userId: string,
    label: string,
    verdict: string,
    minutesIn: number
  ): ContestSubmissionEvent => ({
    id: `${userId}-${label}-${minutesIn}`,
    userId,
    problemLabel: label,
    verdict,
    state: 'TERMINAL',
    admittedAt: new Date(start.getTime() + minutesIn * 60_000),
  })

  test('penalty: 20 min per wrong attempt before first AC, no penalty on unsolved', () => {
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'WRONG_ANSWER', 10),
      mkSub('u1', 'A', 'WRONG_ANSWER', 20),
      mkSub('u1', 'A', 'ACCEPTED', 30),
    ]
    const { entries } = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        { userId: 'u1', username: 'u1', displayName: null, avatarUrl: null, status: 'REGISTERED' },
      ],
    })
    expect(entries[0]!.score).toBe(1)
    expect(entries[0]!.penalty).toBe(30 + 20 + 20)
  })

  test('compilation errors do NOT count as wrong attempts for penalty', () => {
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'COMPILATION_ERROR', 5),
      mkSub('u1', 'A', 'ACCEPTED', 15),
    ]
    const { entries } = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        { userId: 'u1', username: 'u1', displayName: null, avatarUrl: null, status: 'REGISTERED' },
      ],
    })
    expect(entries[0]!.score).toBe(1)
    expect(entries[0]!.penalty).toBe(15)
  })

  test('ties share rank 1,1,3', () => {
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'ACCEPTED', 30),
      mkSub('u2', 'A', 'ACCEPTED', 30),
      mkSub('u3', 'A', 'ACCEPTED', 60),
    ]
    const { entries } = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        { userId: 'u1', username: 'u1', displayName: null, avatarUrl: null, status: 'REGISTERED' },
        { userId: 'u2', username: 'u2', displayName: null, avatarUrl: null, status: 'REGISTERED' },
        { userId: 'u3', username: 'u3', displayName: null, avatarUrl: null, status: 'REGISTERED' },
      ],
    })
    expect(entries[0]!.rank).toBe(1)
    expect(entries[1]!.rank).toBe(1)
    expect(entries[2]!.rank).toBe(3)
  })

  test('freeze: after freezeAt, public view shows PENDING not private verdicts', () => {
    const freeze = new Date(start.getTime() + 60 * 60_000)
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'ACCEPTED', 30),
      mkSub('u1', 'B', 'WRONG_ANSWER', 70),
      mkSub('u2', 'A', 'ACCEPTED', 65),
    ]

    const publicResult = computeScoreboard(submissions, {
      startTime: start,
      freezeAt: freeze,
      isPublic: true,
      problemLabels: ['A', 'B'],
      participants: [
        { userId: 'u1', username: 'u1', displayName: null, avatarUrl: null, status: 'REGISTERED' },
        { userId: 'u2', username: 'u2', displayName: null, avatarUrl: null, status: 'REGISTERED' },
      ],
    })
    expect(publicResult.isFrozen).toBe(true)
    const u1 = publicResult.entries.find(e => e.userId === 'u1')!
    expect(u1.problemResults['A']?.solved).toBe(true)
    const bState = u1.problemResults['B']
    expect(bState?.isPending).toBe(true)
    expect(bState?.solved).toBe(false)
  })
})

// ─── P3-R7: Permutation invariance & asymmetric boundary tests ─────────────────

describe('P3-R7 — Elo permutation invariance and numerical properties', () => {
  test('computePairwiseElo: results are permutation invariant', () => {
    const c1: CompetitorRatingInput = {
      userId: 'u1',
      rating: 1600,
      maxRating: 1600,
      solves: 2,
      penalty: 100,
      hasDeterministicVerdict: true,
    }
    const c2: CompetitorRatingInput = {
      userId: 'u2',
      rating: 1500,
      maxRating: 1500,
      solves: 1,
      penalty: 50,
      hasDeterministicVerdict: true,
    }
    const c3: CompetitorRatingInput = {
      userId: 'u3',
      rating: 1400,
      maxRating: 1400,
      solves: 0,
      penalty: 0,
      hasDeterministicVerdict: true,
    }

    const resOrder1 = computePairwiseElo([c1, c2, c3])
    const resOrder2 = computePairwiseElo([c3, c1, c2])
    const resOrder3 = computePairwiseElo([c2, c3, c1])

    const deltaMap1 = new Map(resOrder1.results.map(r => [r.userId, r.delta]))
    const deltaMap2 = new Map(resOrder2.results.map(r => [r.userId, r.delta]))
    const deltaMap3 = new Map(resOrder3.results.map(r => [r.userId, r.delta]))

    expect(deltaMap1.get('u1')).toBe(deltaMap2.get('u1'))
    expect(deltaMap1.get('u1')).toBe(deltaMap3.get('u1'))
    expect(deltaMap1.get('u2')).toBe(deltaMap2.get('u2'))
    expect(deltaMap1.get('u3')).toBe(deltaMap3.get('u3'))
  })

  test('computePairwiseElo: asymmetric rating gap vectors produce bounded deltas', () => {
    const competitors: CompetitorRatingInput[] = [
      {
        userId: 'grandmaster',
        rating: 2400,
        maxRating: 2400,
        solves: 3,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'novice',
        rating: 1000,
        maxRating: 1000,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]
    const result = computePairwiseElo(competitors)
    expect(result.isEligible).toBe(true)
    const gm = result.results.find(r => r.userId === 'grandmaster')!
    const nov = result.results.find(r => r.userId === 'novice')!
    expect(gm.delta + nov.delta).toBe(0)
    expect(gm.delta).toBeGreaterThanOrEqual(0)
    expect(gm.delta).toBeLessThanOrEqual(32)
  })
})

// ─── P3-R1 & P3-R6: Submission Idempotency, Post-Deadline Retries & Concurrency ─

describe('P3-R1 & P3-R6 — Submission idempotency, post-deadline retries & concurrency', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const contestEndedId = '22222222-2222-4222-8222-222222222222'
  const problemId = '33333333-3333-4333-8333-333333333333'
  const versionId = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    testStore.contests.clear()
    testStore.contestParticipants.clear()
    testStore.contestManifests.clear()
    testStore.contestSubmissions.clear()
    testStore.practiceJobs.clear()
    testStore.practiceVersions.clear()
    testStore.users.clear()

    testStore.users.set(userId, { id: userId, username: 'coder1', isBanned: false })

    testStore.practiceVersions.set(versionId, {
      id: versionId,
      problemId,
      packageHash: 'sha256-abc123valid',
      status: 'PUBLISHED',
      validation: { executed: true, passed: true },
      package: { languages: ['python', 'cpp'] },
    })

    const pastStart = new Date(Date.now() - 4 * 3600000)
    const pastEnd = new Date(Date.now() - 1 * 3600000) // Ended 1 hour ago
    testStore.contests.set(contestEndedId, {
      id: contestEndedId,
      status: 'ACTIVE',
      isPublic: true,
      startTime: pastStart,
      endTime: pastEnd,
      capacity: 100,
      activeManifestId: 'manifest-ended',
    })

    testStore.contestManifests.set('manifest-ended', {
      id: 'manifest-ended',
      contestId: contestEndedId,
      status: 'SEALED',
      runtimePolicyHash: hash(canonical(executionPolicy)),
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId,
          versionId,
          packageHash: 'sha256-abc123valid',
          title: 'Problem A',
        },
      ],
    })

    testStore.contestParticipants.set(`${contestEndedId}:${userId}`, {
      contestId: contestEndedId,
      userId,
      status: 'REGISTERED',
    })
  })

  test('Same-key retry after contest deadline returns existing submission and job without throwing CONTEST_ENDED', async () => {
    const existingJob = {
      id: '55555555-5555-4555-8555-555555555555',
      ownerId: userId,
      versionId,
      kind: 'SUBMIT',
      language: 'python',
      source: 'print("hello")',
      sourceHash: hash('print("hello")'),
      idempotencyKey: 'idem-key-100',
      scope: 'CONTEST',
      contestId: contestEndedId,
      state: 'QUEUED',
      generation: 1,
    }
    testStore.practiceJobs.set(existingJob.id, existingJob)

    const existingSubmission = {
      id: '66666666-6666-4666-8666-666666666666',
      contestId: contestEndedId,
      userId,
      manifestId: 'manifest-ended',
      problemId,
      versionId,
      problemLabel: 'A',
      language: 'python',
      source: 'print("hello")',
      sourceHash: hash('print("hello")'),
      idempotencyKey: 'idem-key-100',
      jobId: existingJob.id,
      state: 'QUEUED',
      generation: 1,
      isAuthoritative: true,
      admittedAt: new Date(Date.now() - 2 * 3600000), // admitted during the contest
    }
    testStore.contestSubmissions.set(existingSubmission.id, existingSubmission)

    // Call enqueueContestSubmission AFTER contest deadline with matching payload
    const retryResult = await enqueueContestSubmission(testStore.prisma as any, {
      contestId: contestEndedId,
      userId,
      problemLabel: 'A',
      language: 'python',
      source: 'print("hello")',
      idempotencyKey: 'idem-key-100',
      policy: executionPolicy,
      admittedAt: new Date(), // post-deadline admittedAt
    })

    expect(retryResult.submission.id).toBe(existingSubmission.id)
    expect(retryResult.job.id).toBe(existingJob.id)
    expect(retryResult.submission.generation).toBe(1)
  })

  test('Conflicting payload with same key throws "Idempotency key conflicts with another request"', async () => {
    const existingSubmission = {
      id: '66666666-6666-4666-8666-666666666666',
      contestId: contestEndedId,
      userId,
      manifestId: 'manifest-ended',
      problemId,
      versionId,
      problemLabel: 'A',
      language: 'python',
      source: 'print("original code")',
      sourceHash: hash('print("original code")'),
      idempotencyKey: 'idem-conflict-key',
      jobId: 'job-1',
      state: 'QUEUED',
      generation: 1,
      isAuthoritative: true,
      admittedAt: new Date(),
    }
    testStore.contestSubmissions.set(existingSubmission.id, existingSubmission)

    // Retry with different source
    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: contestEndedId,
        userId,
        problemLabel: 'A',
        language: 'python',
        source: 'print("tampered/different code")',
        idempotencyKey: 'idem-conflict-key',
        policy: executionPolicy,
      })
    ).rejects.toThrow(/Idempotency key conflicts with another request/i)

    // Retry with different problem label
    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: contestEndedId,
        userId,
        problemLabel: 'B',
        language: 'python',
        source: 'print("original code")',
        idempotencyKey: 'idem-conflict-key',
        policy: executionPolicy,
      })
    ).rejects.toThrow(/Idempotency key conflicts with another request/i)

    // Retry with different language
    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: contestEndedId,
        userId,
        problemLabel: 'A',
        language: 'javascript',
        source: 'print("original code")',
        idempotencyKey: 'idem-conflict-key',
        policy: executionPolicy,
      })
    ).rejects.toThrow(/Idempotency key conflicts with another request/i)
  })

  test('New submission after deadline without matching key throws "Contest has ended; new submissions are closed"', async () => {
    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: contestEndedId,
        userId,
        problemLabel: 'A',
        language: 'python',
        source: 'print("late submission")',
        idempotencyKey: 'new-late-key',
        policy: executionPolicy,
        admittedAt: new Date(),
      })
    ).rejects.toThrow(/Contest has ended; new submissions are closed/i)
  })

  test('A caller-supplied historical timestamp cannot admit a new job after deadline', async () => {
    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: contestEndedId,
        userId,
        problemLabel: 'A',
        language: 'python',
        source: 'print("backdated")',
        idempotencyKey: 'backdated-new-admission',
        policy: executionPolicy,
        admittedAt: new Date(Date.now() - 2 * 3600000),
      })
    ).rejects.toThrow(/Contest has ended/)
    expect(testStore.contestSubmissions.size).toBe(0)
  })

  test('Concurrent submissions serialize properly and return identical submission for same key', async () => {
    const liveContestId = '77777777-7777-4777-8777-777777777777'
    const liveContest = {
      id: liveContestId,
      status: 'ACTIVE',
      isPublic: true,
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      capacity: 100,
      activeManifestId: 'manifest-live',
    }
    testStore.contests.set(liveContestId, liveContest)
    testStore.contestManifests.set('manifest-live', {
      id: 'manifest-live',
      contestId: liveContestId,
      status: 'SEALED',
      runtimePolicyHash: hash(canonical(executionPolicy)),
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId,
          versionId,
          packageHash: 'sha256-abc123valid',
          title: 'Problem A',
        },
      ],
    })
    testStore.contestParticipants.set(`${liveContestId}:${userId}`, {
      contestId: liveContestId,
      userId,
      status: 'REGISTERED',
    })

    const payload = {
      contestId: liveContestId,
      userId,
      problemLabel: 'A',
      language: 'python' as const,
      source: 'print("concurrent test")',
      idempotencyKey: 'concurrent-key-1',
      policy: executionPolicy,
    }

    const [res1, res2] = await Promise.all([
      enqueueContestSubmission(testStore.prisma as any, payload),
      enqueueContestSubmission(testStore.prisma as any, payload),
    ])

    expect(res1.submission.id).toBe(res2.submission.id)
    expect(res1.job.id).toBe(res2.job.id)
    expect(testStore.contestSubmissions.size).toBe(1)
  })

  test('User contest active quota limits concurrency to 3 active jobs', async () => {
    const quotaContestId = '88888888-8888-4888-8888-888888888888'
    const liveContest = {
      id: quotaContestId,
      status: 'ACTIVE',
      isPublic: true,
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      capacity: 100,
      activeManifestId: 'manifest-live-quota',
    }
    testStore.contests.set(quotaContestId, liveContest)
    testStore.contestManifests.set('manifest-live-quota', {
      id: 'manifest-live-quota',
      contestId: quotaContestId,
      status: 'SEALED',
      runtimePolicyHash: hash(canonical(executionPolicy)),
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId,
          versionId,
          packageHash: 'sha256-abc123valid',
          title: 'Problem A',
        },
      ],
    })
    testStore.contestParticipants.set(`${quotaContestId}:${userId}`, {
      contestId: quotaContestId,
      userId,
      status: 'REGISTERED',
    })

    // Seed 3 already active CONTEST jobs
    for (let i = 1; i <= 3; i++) {
      testStore.practiceJobs.set(`job-active-${i}`, {
        id: `job-active-${i}`,
        ownerId: userId,
        scope: 'CONTEST',
        state: 'QUEUED',
        kind: 'SUBMIT',
      })
    }

    await expect(
      enqueueContestSubmission(testStore.prisma as any, {
        contestId: quotaContestId,
        userId,
        problemLabel: 'A',
        language: 'python',
        source: 'print("quota test")',
        idempotencyKey: 'quota-exceeded-key',
        policy: executionPolicy,
      })
    ).rejects.toThrow(/User contest job quota reached/i)
  })

  test('Registration capacity limit rejects additional registrations beyond capacity with CAPACITY_EXCEEDED', async () => {
    const regContestId = '99999999-9999-4999-8999-999999999999'
    testStore.contests.set(regContestId, {
      id: regContestId,
      slug: 'capacity-contest',
      status: 'ACTIVE',
      isPublic: true,
      startTime: new Date(Date.now() + 7200000),
      endTime: new Date(Date.now() + 14400000),
      registrationOpensAt: new Date(Date.now() - 3600000),
      registrationClosesAt: new Date(Date.now() + 3600000),
      capacity: 1,
      isRated: false,
    })

    const registeredUser = '11111111-1111-4111-8111-111111111111'
    const excessUser = '22222222-2222-4222-8222-222222222222'

    testStore.users.set(registeredUser, {
      id: registeredUser,
      isBanned: false,
      emailVerifiedAt: new Date(),
      rating: 1500,
    })
    testStore.users.set(excessUser, {
      id: excessUser,
      isBanned: false,
      emailVerifiedAt: new Date(),
      rating: 1500,
    })

    testStore.contestParticipants.set(`${regContestId}:${registeredUser}`, {
      contestId: regContestId,
      userId: registeredUser,
      status: 'REGISTERED',
      registeredAt: new Date(),
    })

    const app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.setErrorHandler(handleError)
    app.decorate('requireAuth', async (req: FastifyRequest) => {
      ;(req as any).user = { id: excessUser, role: 'USER' }
    })
    app.decorate('requireRole', (...roles: string[]) => async (req: FastifyRequest) => {
      ;(req as any).user = { id: excessUser, role: 'USER' }
    })
    await app.register(contestRoutes, { prefix: '/contests' })

    const res = await app.inject({
      method: 'POST',
      url: `/contests/capacity-contest/register`,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CAPACITY_EXCEEDED')
    await app.close()
  })
})

// ─── P3-R2: Practice Scope Isolation ──────────────────────────────────────────

describe('P3-R2 — Practice scope isolation', () => {
  let app: ReturnType<typeof Fastify>
  const studentId = '11111111-1111-4111-8111-111111111111'
  const staffId = '22222222-2222-4222-8222-222222222222'
  const practiceJobId1 = '33333333-3333-4333-8333-333333333333'
  const contestJobId2 = '44444444-4444-4444-8444-444444444444'
  const practiceJobId3 = '55555555-5555-4555-8555-555555555555'

  beforeEach(async () => {
    testStore.practiceJobs.clear()
    testStore.users.clear()

    testStore.users.set(studentId, { id: studentId, username: 'student', role: 'USER' })
    testStore.users.set(staffId, { id: staffId, username: 'staffer', role: 'ADMIN' })

    // Seed jobs with different scopes
    testStore.practiceJobs.set(practiceJobId1, {
      id: practiceJobId1,
      ownerId: studentId,
      versionId: 'ver-1',
      kind: 'SUBMIT',
      language: 'python',
      source: 'print(1)',
      state: 'TERMINAL',
      verdict: 'ACCEPTED',
      scope: 'PRACTICE',
      generation: 1,
      createdAt: new Date(),
    })

    testStore.practiceJobs.set(contestJobId2, {
      id: contestJobId2,
      ownerId: studentId,
      versionId: 'ver-1',
      kind: 'SUBMIT',
      language: 'python',
      source: 'print(2)',
      state: 'TERMINAL',
      verdict: 'ACCEPTED',
      scope: 'CONTEST',
      contestId: 'contest-1',
      generation: 1,
      createdAt: new Date(),
    })

    testStore.practiceJobs.set(practiceJobId3, {
      id: practiceJobId3,
      ownerId: studentId,
      versionId: 'ver-1',
      kind: 'RUN',
      language: 'python',
      source: 'print(3)',
      state: 'QUEUED',
      scope: 'PRACTICE',
      generation: 1,
      createdAt: new Date(),
    })

    app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.setErrorHandler(handleError)

    app.decorate('requireAuth', async (request: FastifyRequest) => {
      const uid = String(request.headers['x-user-id'] ?? studentId)
      const role = String(request.headers['x-role'] ?? 'USER')
      ;(request as any).user = { id: uid, role }
    })
    app.decorate('requireRole', (...roles: string[]) => async (request: FastifyRequest) => {
      const uid = String(request.headers['x-user-id'] ?? staffId)
      const role = String(request.headers['x-role'] ?? 'ADMIN')
      if (!roles.includes(role)) throw forbidden('FORBIDDEN', 'Insufficient permissions')
      ;(request as any).user = { id: uid, role }
    })

    await app.register(practiceRoutes, { prefix: '/practice' })
  })

  afterEach(async () => {
    await app.close()
  })

  test('GET /practice/history omits CONTEST scoped jobs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/practice/history?page=1&limit=10',
      headers: { 'x-user-id': studentId },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    const returnedIds = body.rows.map((r: any) => r.id)
    expect(returnedIds).toContain(practiceJobId1)
    expect(returnedIds).toContain(practiceJobId3)
    expect(returnedIds).not.toContain(contestJobId2)
  })

  test('GET /practice/jobs/:id returns 404 for CONTEST scoped job', async () => {
    const resContest = await app.inject({
      method: 'GET',
      url: `/practice/jobs/${contestJobId2}`,
      headers: { 'x-user-id': studentId },
    })
    expect(resContest.statusCode).toBe(404)
    expect(resContest.json().error.code).toBe('JOB_NOT_FOUND')

    const resPractice = await app.inject({
      method: 'GET',
      url: `/practice/jobs/${practiceJobId1}`,
      headers: { 'x-user-id': studentId },
    })
    expect(resPractice.statusCode).toBe(200)
    expect(resPractice.json().id).toBe(practiceJobId1)
  })

  test('POST /practice/jobs/:id/cancel returns 404 when attempting to cancel CONTEST scoped job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/practice/jobs/${contestJobId2}/cancel`,
      headers: { 'x-user-id': studentId },
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('JOB_NOT_FOUND')
  })

  test('rejudgePracticeJob rejects non-practice jobs with "Only practice jobs can be rejudged via practice queue"', async () => {
    await expect(
      rejudgePracticeJob(testStore.prisma as any, {
        id: contestJobId2,
        actorId: staffId,
        reason: 'Operational test reason for rejudge',
        idempotencyKey: 'rej-scope-1',
      })
    ).rejects.toThrow(/Only practice jobs can be rejudged via practice queue/i)
  })

  test('POST /practice/staff/jobs/:id/rejudge route returns 404 JOB_NOT_FOUND for CONTEST job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/practice/staff/jobs/${contestJobId2}/rejudge`,
      headers: { 'x-user-id': staffId, 'x-role': 'ADMIN' },
      payload: {
        reason: 'Valid operational rejudge reason string',
        idempotencyKey: '00000000-0000-0000-0000-000000000001',
      },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('JOB_NOT_FOUND')
  })
})

// ─── P3-R3: Manifest Sealing Integrity ─────────────────────────────────────────

describe('P3-R3 — Manifest sealing integrity & separation of duties', () => {
  let app: ReturnType<typeof Fastify>

  const authorId = '11111111-1111-4111-8111-111111111111'
  const reviewerId = '22222222-2222-4222-8222-222222222222'
  const problemAuthorId = '33333333-3333-4333-8333-333333333333'

  const problemId1 = '44444444-4444-4444-8444-444444444444'
  const problemId2 = '55555555-5555-4555-8555-555555555555'
  const problemId3 = '66666666-6666-4666-8666-666666666666'

  const validVersionId = '77777777-7777-4777-8777-777777777777'
  const draftVersionId = '88888888-8888-4888-8888-888888888888'
  const noEvidenceVersionId = '99999999-9999-4999-8999-999999999999'
  const validPackage = PracticePackage.parse({
    title: 'Two Sum',
    statementMd: 'Add two numbers',
    constraints: 'Small integers',
    inputFormat: 'Two integers',
    outputFormat: 'Their sum',
    difficultyBand: 'easy',
    tags: ['math'],
    mode: 'STDIO',
    signature: null,
    languages: ['python'],
    limits: { timeMs: 1000, memoryKb: 65536, outputKb: 16 },
    checker: { kind: 'exact' },
    cases: [
      { input: '1 2', output: '3', sample: true },
      { input: '3 4', output: '7', sample: false },
    ],
    references: [
      { language: 'python', code: 'print(sum(map(int,input().split())))', complexity: 'O(1)' },
    ],
    rightsBasis: 'Original disposable test fixture',
  })
  const validPackageHash = hash(canonical(validPackage))

  beforeEach(async () => {
    testStore.contests.clear()
    testStore.contestManifests.clear()
    testStore.practiceProblems.clear()
    testStore.practiceVersions.clear()
    testStore.users.clear()

    testStore.users.set(authorId, { id: authorId, username: 'author1', role: 'PROBLEM_SETTER' })
    testStore.users.set(reviewerId, { id: reviewerId, username: 'reviewer1', role: 'REVIEWER' })
    testStore.users.set(problemAuthorId, {
      id: problemAuthorId,
      username: 'pauthor1',
      role: 'PROBLEM_SETTER',
    })

    testStore.practiceProblems.set(problemId1, { id: problemId1, title: 'Two Sum' })
    testStore.practiceProblems.set(problemId2, { id: problemId2, title: 'Draft Problem' })
    testStore.practiceProblems.set(problemId3, {
      id: problemId3,
      title: 'Incomplete Evidence Problem',
    })

    testStore.practiceVersions.set(validVersionId, {
      id: validVersionId,
      problemId: problemId1,
      authorId: problemAuthorId,
      packageHash: validPackageHash,
      status: 'PUBLISHED',
      validation: {
        executed: true,
        packageHash: validPackageHash,
        policyHash: hash(canonical(executionPolicy)),
        jobs: ['valid-reference-job'],
      },
      package: validPackage,
    })

    testStore.practiceJobs.set('valid-reference-job', {
      id: 'valid-reference-job',
      versionId: validVersionId,
      kind: 'VALIDATE',
      scope: 'PRACTICE',
      state: 'TERMINAL',
      verdict: 'ACCEPTED',
      language: 'python',
      sourceHash: hash(validPackage.references[0]!.code),
      policy: { ...executionPolicy, packageHash: validPackageHash },
      privateResult: { executed: true },
    })

    testStore.practiceVersions.set(draftVersionId, {
      id: draftVersionId,
      problemId: problemId2,
      authorId: problemAuthorId,
      packageHash: 'pkg-hash-draft',
      status: 'DRAFT',
      validation: null,
      package: {
        title: 'Draft Problem',
        statementMd: 'Draft',
        difficultyBand: 'EASY',
        mode: 'STANDARD',
        tags: [],
        limits: { timeMs: 1000, memoryMb: 256 },
        cases: [],
      },
    })

    testStore.practiceVersions.set(noEvidenceVersionId, {
      id: noEvidenceVersionId,
      problemId: problemId3,
      authorId: problemAuthorId,
      packageHash: 'pkg-hash-noev',
      status: 'VALIDATED',
      validation: { executed: false, passed: false },
      package: {
        title: 'Incomplete Evidence',
        statementMd: 'Statement',
        difficultyBand: 'EASY',
        mode: 'STANDARD',
        tags: [],
        limits: { timeMs: 1000, memoryMb: 256 },
        cases: [],
      },
    })

    app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.setErrorHandler(handleError)

    app.decorate('requireAuth', async (request: FastifyRequest) => {
      const uid = String(request.headers['x-user-id'] ?? authorId)
      const role = String(request.headers['x-role'] ?? 'PROBLEM_SETTER')
      ;(request as any).user = { id: uid, role }
    })
    app.decorate('requireRole', (...roles: string[]) => async (request: FastifyRequest) => {
      const uid = String(request.headers['x-user-id'] ?? reviewerId)
      const role = String(request.headers['x-role'] ?? 'REVIEWER')
      if (!roles.includes(role)) throw forbidden('FORBIDDEN', 'Insufficient permissions')
      ;(request as any).user = { id: uid, role }
    })

    await app.register(contestRoutes, { prefix: '/contests' })
  })

  afterEach(async () => {
    await app.close()
  })

  test('Draft creation rejects problem versions that are not VALIDATED or PUBLISHED', async () => {
    const payload = {
      title: 'Draft Contest',
      slug: 'draft-contest-unvalidated',
      description: 'Test',
      registrationOpensAt: new Date(Date.now() + 1000).toISOString(),
      registrationClosesAt: new Date(Date.now() + 3600000).toISOString(),
      startTime: new Date(Date.now() + 7200000).toISOString(),
      endTime: new Date(Date.now() + 14400000).toISOString(),
      capacity: 100,
      isRated: true,
      problems: [{ label: 'A', problemId: problemId2, versionId: draftVersionId, points: 100 }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/contests/staff/drafts',
      headers: { 'x-user-id': authorId, 'x-role': 'PROBLEM_SETTER' },
      payload,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('VERSION_NOT_VALIDATED')
  })

  test('Draft creation rejects problem versions without executed validation artifact', async () => {
    const payload = {
      title: 'Incomplete Validation Contest',
      slug: 'draft-contest-no-evidence',
      description: 'Test',
      registrationOpensAt: new Date(Date.now() + 1000).toISOString(),
      registrationClosesAt: new Date(Date.now() + 3600000).toISOString(),
      startTime: new Date(Date.now() + 7200000).toISOString(),
      endTime: new Date(Date.now() + 14400000).toISOString(),
      capacity: 100,
      isRated: true,
      problems: [
        { label: 'A', problemId: problemId3, versionId: noEvidenceVersionId, points: 100 },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/contests/staff/drafts',
      headers: { 'x-user-id': authorId, 'x-role': 'PROBLEM_SETTER' },
      payload,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('VERSION_VALIDATION_INCOMPLETE')
  })

  test('Sealing rejects if reviewer is manifest author (SEPARATE_REVIEWER_REQUIRED)', async () => {
    const contestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    testStore.contests.set(contestId, {
      id: contestId,
      title: 'Contest A',
      slug: 'contest-a',
      status: 'DRAFT',
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
    })

    const draftHash = 'a'.repeat(64)
    testStore.contestManifests.set('manifest-self', {
      id: 'manifest-self',
      contestId,
      revision: 1,
      authorId,
      status: 'DRAFT',
      manifestHash: draftHash,
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId: problemId1,
          versionId: validVersionId,
          packageHash: validPackageHash,
          title: 'Problem A',
        },
      ],
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      runtimePolicyHash: hash(canonical(executionPolicy)),
    })

    // Author tries to review and seal their own contest manifest
    const res = await app.inject({
      method: 'POST',
      url: `/contests/staff/${contestId}/seal`,
      headers: { 'x-user-id': authorId, 'x-role': 'ADMIN' },
      payload: { rightsConfirmed: true, manifestHash: draftHash },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('SEPARATE_REVIEWER_REQUIRED')
  })

  test('Sealing rejects if reviewer is author of any assigned problem (SEPARATE_REVIEWER_REQUIRED)', async () => {
    const contestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    testStore.contests.set(contestId, {
      id: contestId,
      title: 'Contest B',
      slug: 'contest-b',
      status: 'DRAFT',
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
    })

    const draftHash = 'b'.repeat(64)
    testStore.contestManifests.set('manifest-prob-author', {
      id: 'manifest-prob-author',
      contestId,
      revision: 1,
      authorId,
      status: 'DRAFT',
      manifestHash: draftHash,
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId: problemId1,
          versionId: validVersionId,
          packageHash: validPackageHash,
          title: 'Problem A',
        },
      ],
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      runtimePolicyHash: hash(canonical(executionPolicy)),
    })

    // Problem author (problemAuthorId) attempts to seal contest containing their own problem
    const res = await app.inject({
      method: 'POST',
      url: `/contests/staff/${contestId}/seal`,
      headers: { 'x-user-id': problemAuthorId, 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, manifestHash: draftHash },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('SEPARATE_REVIEWER_REQUIRED')
  })

  test('Sealing recomputes hash from real contestId and rejects tampered or placeholder hash with MANIFEST_INTEGRITY_FAILURE', async () => {
    const contestId = '550e8400-e29b-41d4-a716-446655440001'
    const startTime = new Date(Date.now() + 86400000)
    const endTime = new Date(Date.now() + 172800000)
    const registrationOpensAt = new Date()
    const registrationClosesAt = new Date(Date.now() + 86400000)
    const runtimePolicyHash = hash(canonical(executionPolicy))

    testStore.contests.set(contestId, {
      id: contestId,
      title: 'Real Hash Contest',
      slug: 'real-hash-contest',
      status: 'DRAFT',
      startTime,
      endTime,
      registrationOpensAt,
      registrationClosesAt,
      capacity: 50,
      isRated: true,
    })

    const problems = [
      {
        label: 'A',
        orderIndex: 0,
        problemId: problemId1,
        versionId: validVersionId,
        packageHash: validPackageHash,
        points: 1,
        title: 'Two Sum',
      },
    ]

    const realHash = computeManifestHash({
      contestId,
      revision: 1,
      title: 'Real Hash Contest',
      slug: 'real-hash-contest',
      description: null,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      registrationOpensAt: registrationOpensAt.toISOString(),
      registrationClosesAt: registrationClosesAt.toISOString(),
      freezeAt: null,
      capacity: 50,
      isRated: true,
      divisionMin: null,
      divisionMax: null,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      problems,
      runtimePolicyHash,
    })

    // Store a manifest with a placeholder zero-UUID hash (simulating tamper or legacy creation)
    const tamperedZeroUuidHash = computeManifestHash({
      contestId: '00000000-0000-0000-0000-000000000000',
      revision: 1,
      title: 'Real Hash Contest',
      slug: 'real-hash-contest',
      description: null,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      registrationOpensAt: registrationOpensAt.toISOString(),
      registrationClosesAt: registrationClosesAt.toISOString(),
      freezeAt: null,
      capacity: 50,
      isRated: true,
      divisionMin: null,
      divisionMax: null,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      problems,
      runtimePolicyHash,
    })

    testStore.contestManifests.set('manifest-tampered', {
      id: 'manifest-tampered',
      contestId,
      revision: 1,
      authorId,
      status: 'DRAFT',
      manifestHash: tamperedZeroUuidHash,
      title: 'Real Hash Contest',
      slug: 'real-hash-contest',
      description: null,
      startTime,
      endTime,
      registrationOpensAt,
      registrationClosesAt,
      freezeAt: null,
      capacity: 50,
      isRated: true,
      divisionMin: null,
      divisionMax: null,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      problems,
      runtimePolicyHash,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/contests/staff/${contestId}/seal`,
      headers: { 'x-user-id': reviewerId, 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, manifestHash: tamperedZeroUuidHash },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('MANIFEST_INTEGRITY_FAILURE')

    // Now test valid sealing with the real hash
    testStore.contestManifests.get('manifest-tampered')!.manifestHash = realHash
    const validSealRes = await app.inject({
      method: 'POST',
      url: `/contests/staff/${contestId}/seal`,
      headers: { 'x-user-id': reviewerId, 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, manifestHash: realHash },
    })
    expect(validSealRes.statusCode).toBe(200)
    expect(validSealRes.json().status).toBe('SCHEDULED')
    expect(validSealRes.json().manifestId).toBe('manifest-tampered')
    expect(testStore.contestManifests.get('manifest-tampered')!.status).toBe('SEALED')
    expect(testStore.contestManifests.get('manifest-tampered')!.manifestHash).toBe(realHash)
  })

  test('Sealing rejects if problem version packageHash has drifted since draft creation (PACKAGE_HASH_MISMATCH)', async () => {
    const contestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    testStore.contests.set(contestId, {
      id: contestId,
      title: 'Contest Drift',
      slug: 'contest-drift',
      status: 'DRAFT',
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
    })

    testStore.contestManifests.set('manifest-drift', {
      id: 'manifest-drift',
      contestId,
      revision: 1,
      authorId,
      status: 'DRAFT',
      manifestHash: 'a'.repeat(64),
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId: problemId1,
          versionId: validVersionId,
          packageHash: 'pkg-hash-original',
          title: 'Problem A',
        },
      ],
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 172800000),
      registrationOpensAt: new Date(),
      registrationClosesAt: new Date(Date.now() + 86400000),
      capacity: 50,
      isRated: true,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      runtimePolicyHash: hash(canonical(executionPolicy)),
    })

    // In DB, validVersionId has packageHash: validPackageHash (which != 'pkg-hash-original')
    const res = await app.inject({
      method: 'POST',
      url: `/contests/staff/${contestId}/seal`,
      headers: { 'x-user-id': reviewerId, 'x-role': 'REVIEWER' },
      payload: { rightsConfirmed: true, manifestHash: 'a'.repeat(64) },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('PACKAGE_HASH_MISMATCH')
  })
})

// ─── P3-R4: Dependent Rating Replay & Disqualified User Handling ──────────────

describe('P3-R4 — Dependent rating replay & disqualified user handling', () => {
  beforeEach(() => {
    testStore.contests.clear()
    testStore.contestParticipants.clear()
    testStore.contestManifests.clear()
    testStore.contestSubmissions.clear()
    testStore.contestRatingLedgers.length = 0
    testStore.contestScoreboardSnapshots.length = 0
    testStore.users.clear()
  })

  test('Disqualified users are included in affected users set and reset to 1500 baseline if they lose all authoritative entries', async () => {
    testStore.users.set('u_honest', {
      id: 'u_honest',
      username: 'honest',
      rating: 1600,
      maxRating: 1600,
      contestsCount: 1,
      lastContestAt: new Date(),
    })
    testStore.users.set('u_cheater', {
      id: 'u_cheater',
      username: 'cheater',
      rating: 1750,
      maxRating: 1750,
      contestsCount: 1,
      lastContestAt: new Date(),
    })

    const allAffectedUsers = new Set<string>()
    const participants = [
      { userId: 'u_honest', status: 'REGISTERED' },
      { userId: 'u_cheater', status: 'DISQUALIFIED' },
    ]

    for (const p of participants) {
      allAffectedUsers.add(p.userId)
    }

    expect(allAffectedUsers.has('u_cheater')).toBe(true)
    expect(allAffectedUsers.has('u_honest')).toBe(true)

    // Stage new authoritative ledger entries: u_honest gets new generation row, u_cheater gets NONE
    testStore.contestRatingLedgers.push({
      contestId: 'contest-1',
      userId: 'u_honest',
      generation: 2,
      oldRating: 1500,
      newRating: 1532,
      isAuthoritative: true,
    })

    // Update user projections according to P3-R4 rule
    for (const userId of allAffectedUsers) {
      const latest = testStore.contestRatingLedgers.find(
        r => r.userId === userId && r.isAuthoritative
      )
      if (latest) {
        testStore.users.get(userId)!.rating = latest.newRating
        testStore.users.get(userId)!.contestsCount = 1
      } else {
        // Zero authoritative history -> reset to policy initial baseline
        const u = testStore.users.get(userId)!
        u.rating = 1500
        u.maxRating = 1500
        u.contestsCount = 0
        u.lastContestAt = null
      }
    }

    const cheaterProfile = testStore.users.get('u_cheater')!
    expect(cheaterProfile.rating).toBe(1500)
    expect(cheaterProfile.maxRating).toBe(1500)
    expect(cheaterProfile.contestsCount).toBe(0)
    expect(cheaterProfile.lastContestAt).toBeNull()

    const honestProfile = testStore.users.get('u_honest')!
    expect(honestProfile.rating).toBe(1532)
    expect(honestProfile.contestsCount).toBe(1)
  })

  test('Standings snapshots increment revision so corrected final winner is returned', () => {
    const start = new Date('2026-10-10T10:00:00Z')
    const submissions: ContestSubmissionEvent[] = [
      {
        id: 'sub-cheater-A',
        userId: 'u_cheater',
        problemLabel: 'A',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date(start.getTime() + 10 * 60000),
      },
      {
        id: 'sub-honest-A',
        userId: 'u_honest',
        problemLabel: 'A',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date(start.getTime() + 20 * 60000),
      },
    ]

    // Pre-disqualification: both REGISTERED
    const initialScoreboard = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        {
          userId: 'u_cheater',
          username: 'cheater',
          displayName: null,
          avatarUrl: null,
          status: 'REGISTERED',
        },
        {
          userId: 'u_honest',
          username: 'honest',
          displayName: null,
          avatarUrl: null,
          status: 'REGISTERED',
        },
      ],
    })
    expect(initialScoreboard.entries[0]!.userId).toBe('u_cheater')
    expect(initialScoreboard.entries[0]!.rank).toBe(1)

    // Save revision 1
    testStore.contestScoreboardSnapshots.push({
      contestId: 'contest-1',
      revision: 1,
      isFrozen: false,
      payload: initialScoreboard.entries,
    })

    // Post-disqualification: u_cheater marked DISQUALIFIED
    const correctedScoreboard = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        {
          userId: 'u_cheater',
          username: 'cheater',
          displayName: null,
          avatarUrl: null,
          status: 'DISQUALIFIED',
        },
        {
          userId: 'u_honest',
          username: 'honest',
          displayName: null,
          avatarUrl: null,
          status: 'REGISTERED',
        },
      ],
    })

    // In corrected standings, u_honest is now the sole rank 1 winner
    expect(correctedScoreboard.entries[0]!.userId).toBe('u_honest')
    expect(correctedScoreboard.entries[0]!.rank).toBe(1)
    const cheaterEntry = correctedScoreboard.entries.find(e => e.userId === 'u_cheater')!
    expect(cheaterEntry.isDisqualified).toBe(true)

    // Replay publishes revised snapshot with revision incremented (revision 2)
    const latestRevision = testStore.contestScoreboardSnapshots
      .filter(s => s.contestId === 'contest-1' && !s.isFrozen)
      .sort((a, b) => b.revision - a.revision)[0]!
    const nextRevision = latestRevision.revision + 1

    testStore.contestScoreboardSnapshots.push({
      contestId: 'contest-1',
      revision: nextRevision,
      isFrozen: false,
      payload: correctedScoreboard.entries,
    })

    // Latest snapshot by revision desc now yields honest winner
    const currentLatest = testStore.contestScoreboardSnapshots
      .filter(s => s.contestId === 'contest-1' && !s.isFrozen)
      .sort((a, b) => b.revision - a.revision)[0]!

    expect(currentLatest.revision).toBe(2)
    expect(currentLatest.payload[0].userId).toBe('u_honest')
    expect(currentLatest.payload[0].rank).toBe(1)
  })

  test('replayChronologicalContests executes end-to-end replay, includes disqualified users in affected users, resets zero-history users to baseline, and caches result idempotently', async () => {
    const contestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const honestId = '11111111-1111-4111-8111-111111111111'
    const cheaterId = '22222222-2222-4222-8222-222222222222'

    testStore.users.set(honestId, {
      id: honestId,
      username: 'honest',
      rating: 1500,
      maxRating: 1500,
      contestsCount: 1,
      lastContestAt: new Date(),
    })
    testStore.users.set(cheaterId, {
      id: cheaterId,
      username: 'cheater',
      rating: 1650,
      maxRating: 1650,
      contestsCount: 1,
      lastContestAt: new Date(),
    })

    const contestObj = {
      id: contestId,
      title: 'Replay Contest',
      slug: 'replay-contest',
      status: 'FINALIZED',
      isRated: true,
      isPublic: true,
      startTime: new Date('2026-10-10T10:00:00Z'),
      endTime: new Date('2026-10-10T15:00:00Z'),
      capacity: 100,
      activeManifestId: 'manifest-replay',
    }
    testStore.contests.set(contestId, contestObj)

    testStore.contestManifests.set('manifest-replay', {
      id: 'manifest-replay',
      contestId,
      status: 'SEALED',
      manifestHash: 'hash-rep',
      problems: [
        {
          label: 'A',
          orderIndex: 0,
          problemId: 'p1',
          versionId: 'v1',
          packageHash: 'h1',
          title: 'Problem A',
        },
      ],
    })

    testStore.contestParticipants.set(`${contestId}:${honestId}`, {
      contestId,
      userId: honestId,
      status: 'REGISTERED',
      score: 1,
      penalty: 30,
      rank: 2,
    })
    testStore.contestParticipants.set(`${contestId}:${cheaterId}`, {
      contestId,
      userId: cheaterId,
      status: 'DISQUALIFIED',
      score: 1,
      penalty: 10,
      rank: 1,
    })

    testStore.contestSubmissions.set('sub-rep-1', {
      id: 'sub-rep-1',
      contestId,
      userId: honestId,
      problemLabel: 'A',
      verdict: 'ACCEPTED',
      state: 'TERMINAL',
      isAuthoritative: true,
      admittedAt: new Date('2026-10-10T10:30:00Z'),
    })
    testStore.contestSubmissions.set('sub-rep-2', {
      id: 'sub-rep-2',
      contestId,
      userId: cheaterId,
      problemLabel: 'A',
      verdict: 'ACCEPTED',
      state: 'TERMINAL',
      isAuthoritative: true,
      admittedAt: new Date('2026-10-10T10:10:00Z'),
    })

    testStore.contestScoreboardSnapshots.push({
      contestId,
      revision: 1,
      isFrozen: false,
      payload: [],
    })

    const replayRes = await replayChronologicalContests(
      contestId,
      'admin-actor',
      'Disqualification correction replay',
      'replay-idem-key-1'
    )

    // Disqualified user must be included in allAffectedUsers count (honest + cheater = 2)
    expect(replayRes.affectedUsersCount).toBe(2)
    expect(replayRes.replayedContestsCount).toBe(1)

    // Cheater lost all authoritative ledger rows -> reset to 1500 baseline
    const cheaterProfile = testStore.users.get(cheaterId)!
    expect(cheaterProfile.rating).toBe(1500)
    expect(cheaterProfile.maxRating).toBe(1500)
    expect(cheaterProfile.contestsCount).toBe(0)
    expect(cheaterProfile.lastContestAt).toBeNull()

    // Scoreboard snapshot revision incremented to 2
    const latestSnapshot = testStore.contestScoreboardSnapshots
      .filter(s => s.contestId === contestId && !s.isFrozen)
      .sort((a, b) => b.revision - a.revision)[0]!
    expect(latestSnapshot.revision).toBe(2)

    // Repeat with identical idempotency key returns cached result
    const repeatRes = await replayChronologicalContests(
      contestId,
      'admin-actor',
      'Disqualification correction replay',
      'replay-idem-key-1'
    )
    expect(repeatRes).toEqual(replayRes)
  })
})

// ─── P3-R5: Rejudge Policy Binding & Lineage Serialization ────────────────────

describe('P3-R5 — Rejudge policy binding, lineage serialization & idempotency', () => {
  beforeEach(() => {
    testStore.contests.clear()
    testStore.practiceVersions.clear()
    testStore.contestSubmissions.clear()
    testStore.practiceJobs.clear()

    testStore.practiceVersions.set('ver-p5', {
      id: 'ver-p5',
      problemId: 'prob-p5',
      packageHash: 'sha256-boundpackagehash12345',
      status: 'PUBLISHED',
      validation: { executed: true, passed: true },
    })

    const initialJob = {
      id: 'job-p5-1',
      ownerId: 'user-p5',
      versionId: 'ver-p5',
      kind: 'SUBMIT',
      language: 'cpp',
      source: 'int main() {}',
      sourceHash: hash('int main() {}'),
      idempotencyKey: 'orig-sub-key',
      policy: { limits: { timeMs: 1000 } },
      scope: 'CONTEST',
      contestId: 'contest-p5',
      state: 'TERMINAL',
      generation: 1,
    }
    testStore.practiceJobs.set(initialJob.id, initialJob)

    const initialSub = {
      id: 'sub-p5-1',
      contestId: 'contest-p5',
      userId: 'user-p5',
      manifestId: 'manifest-p5',
      problemId: 'prob-p5',
      versionId: 'ver-p5',
      problemLabel: 'A',
      language: 'cpp',
      source: 'int main() {}',
      sourceHash: hash('int main() {}'),
      idempotencyKey: 'orig-sub-key',
      admittedAt: new Date('2026-10-10T12:00:00Z'),
      jobId: initialJob.id,
      state: 'TERMINAL',
      generation: 1,
      isAuthoritative: true,
    }
    testStore.contestSubmissions.set(initialSub.id, initialSub)
  })

  test('Rejudge policy merges version packageHash into execution policy', async () => {
    const res = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: 'sub-p5-1',
      contestId: 'contest-p5',
      actorId: 'admin-1',
      reason: 'Rejudging due to updated test cases',
      idempotencyKey: 'rejudge-key-gen2',
    })

    expect(res.job.policy).toBeDefined()
    expect((res.job.policy as any).packageHash).toBe('sha256-boundpackagehash12345')
  })

  test('Rejudge lineages serialize generation (max(generation) + 1)', async () => {
    // First rejudge -> generation 2
    const rej1 = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: 'sub-p5-1',
      contestId: 'contest-p5',
      actorId: 'admin-1',
      reason: 'First operational rejudge',
      idempotencyKey: 'rejudge-key-gen2',
    })
    expect(rej1.submission.generation).toBe(2)
    expect(rej1.job.generation).toBe(2)
    expect(rej1.submission.isAuthoritative).toBe(true)

    // Generation 1 must be marked isAuthoritative: false
    expect(testStore.contestSubmissions.get('sub-p5-1')!.isAuthoritative).toBe(false)

    testStore.practiceJobs.get(rej1.job.id)!.state = 'TERMINAL'
    // Second rejudge with new key -> generation 3 (max(generation) + 1)
    const rej2 = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: rej1.submission.id,
      contestId: 'contest-p5',
      actorId: 'admin-1',
      reason: 'Second operational rejudge',
      idempotencyKey: 'rejudge-key-gen3',
    })
    expect(rej2.submission.generation).toBe(3)
    expect(rej2.job.generation).toBe(3)
    expect(rej2.submission.isAuthoritative).toBe(true)

    // Prior generation 2 must now be marked isAuthoritative: false
    expect(testStore.contestSubmissions.get(rej1.submission.id)!.isAuthoritative).toBe(false)
  })

  test('Rejudging one attempt preserves other attempts and their penalty events', async () => {
    const original = testStore.contestSubmissions.get('sub-p5-1')!
    const originalJob = testStore.practiceJobs.get('job-p5-1')!
    testStore.practiceJobs.set('other-original-job', {
      ...originalJob,
      id: 'other-original-job',
      idempotencyKey: 'other-attempt',
    })
    testStore.contestSubmissions.set('other-original-sub', {
      ...original,
      id: 'other-original-sub',
      jobId: 'other-original-job',
      idempotencyKey: 'other-attempt',
      verdict: 'WRONG_ANSWER',
    })
    const result = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: original.id,
      actorId: 'admin-1',
      reason: 'Correct this particular attempt',
      idempotencyKey: 'rejudge-specific-attempt',
    })
    expect(result.submission.generation).toBe(2)
    expect(testStore.contestSubmissions.get('other-original-sub')!.isAuthoritative).toBe(true)
    expect(testStore.contestSubmissions.get('sub-p5-1')!.isAuthoritative).toBe(false)
    await expect(
      rejudgeContestSubmission(testStore.prisma as any, {
        submissionId: original.id,
        actorId: 'admin-1',
        reason: 'Different reason conflicts with the same operation',
        idempotencyKey: 'rejudge-specific-attempt',
      })
    ).rejects.toThrow(/Idempotency key conflicts/)
    await expect(
      rejudgeContestSubmission(testStore.prisma as any, {
        submissionId: original.id,
        actorId: 'admin-1',
        reason: 'A second correction must wait for the first',
        idempotencyKey: 'next-pending-correction',
      })
    ).rejects.toThrow(/still pending/)
  })

  test('Duplicate rejudge requests with same idempotency key return identical job and generation', async () => {
    const firstCall = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: 'sub-p5-1',
      contestId: 'contest-p5',
      actorId: 'admin-1',
      reason: 'Idempotent rejudge verification',
      idempotencyKey: 'idem-rejudge-unique',
    })

    const secondCall = await rejudgeContestSubmission(testStore.prisma as any, {
      submissionId: 'sub-p5-1',
      contestId: 'contest-p5',
      actorId: 'admin-1',
      reason: 'Idempotent rejudge verification',
      idempotencyKey: 'idem-rejudge-unique',
    })

    expect(secondCall.submission.id).toBe(firstCall.submission.id)
    expect(secondCall.job.id).toBe(firstCall.job.id)
    expect(secondCall.submission.generation).toBe(firstCall.submission.generation)
  })

  test('Rejudge rejects submission if it does not belong to the requested contest', async () => {
    await expect(
      rejudgeContestSubmission(testStore.prisma as any, {
        submissionId: 'sub-p5-1',
        contestId: 'wrong-contest-id',
        actorId: 'admin-1',
        reason: 'Cross contest check',
        idempotencyKey: 'rejudge-cross-contest',
      })
    ).rejects.toThrow(/Submission does not belong to the requested contest/i)
  })
})

// ─── P3-R7: Leaderboard SQL Pagination & Tie-Breaking ─────────────────────────

describe('P3-R7 — Leaderboard SQL pagination & competition ranking', () => {
  let app: ReturnType<typeof Fastify>

  const userAlpha = '11111111-1111-4111-8111-111111111111'
  const userBeta = '22222222-2222-4222-8222-222222222222'
  const userGamma = '33333333-3333-4333-8333-333333333333'
  const userDelta = '44444444-4444-4444-8444-444444444444'
  const userBanned = '55555555-5555-4555-8555-555555555555'
  const userUnrated = '66666666-6666-4666-8666-666666666666'

  beforeEach(async () => {
    testStore.users.clear()
    testStore.contestRatingLedgers.length = 0

    // Seed competitors with ties across page boundaries
    // User 1 & User 2 are tied at 1700 (rank 1, 1)
    // User 3 is 1600 (rank 3)
    // User 4 is 1500 (rank 4)
    testStore.users.set(userAlpha, {
      id: userAlpha,
      username: 'alpha',
      rating: 1700,
      maxRating: 1700,
      isBanned: false,
    })
    testStore.users.set(userBeta, {
      id: userBeta,
      username: 'beta',
      rating: 1700,
      maxRating: 1700,
      isBanned: false,
    })
    testStore.users.set(userGamma, {
      id: userGamma,
      username: 'gamma',
      rating: 1600,
      maxRating: 1600,
      isBanned: false,
    })
    testStore.users.set(userDelta, {
      id: userDelta,
      username: 'delta',
      rating: 1500,
      maxRating: 1500,
      isBanned: false,
    })

    // Give each user an authoritative ledger entry so they are eligible
    for (const uid of [userAlpha, userBeta, userGamma, userDelta]) {
      testStore.contestRatingLedgers.push({
        contestId: 'contest-lb',
        userId: uid,
        isAuthoritative: true,
      })
    }

    app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.setErrorHandler(handleError)

    await app.register(leaderboardRoutes, { prefix: '/leaderboard' })
  })

  afterEach(async () => {
    await app.close()
  })

  test('Ties share competition rank (1, 1, 3) across page boundaries, sorted by user ID', async () => {
    // Page 1: limit 2 -> should return userAlpha (rank 1), userBeta (rank 1)
    const page1Res = await app.inject({
      method: 'GET',
      url: '/leaderboard?page=1&limit=2',
    })
    expect(page1Res.statusCode).toBe(200)
    const page1 = page1Res.json()
    expect(page1.total).toBe(4)
    expect(page1.users.length).toBe(2)
    expect(page1.users[0].userId).toBe(userAlpha)
    expect(page1.users[0].rank).toBe(1)
    expect(page1.users[1].userId).toBe(userBeta)
    expect(page1.users[1].rank).toBe(1)

    // Page 2: limit 2 -> should return userGamma (rank 3!) and userDelta (rank 4)
    const page2Res = await app.inject({
      method: 'GET',
      url: `/leaderboard?page=2&limit=2&revision=${page1.revision}`,
    })
    expect(page2Res.statusCode).toBe(200)
    const page2 = page2Res.json()
    expect(page2.total).toBe(4)
    expect(page2.users.length).toBe(2)
    expect(page2.users[0].userId).toBe(userGamma)
    expect(page2.users[0].rank).toBe(3) // Rank 3, skipping rank 2 due to 2-way tie at rank 1!
    expect(page2.users[1].userId).toBe(userDelta)
    expect(page2.users[1].rank).toBe(4)
  })

  test('Boundary-spanning ties share competition rank across page 1 and page 2', async () => {
    // Modify ratings: userAlpha = 1800 (rank 1), userBeta = 1700 (rank 2), userGamma = 1700 (rank 2), userDelta = 1500 (rank 4)
    testStore.users.get(userAlpha)!.rating = 1800
    testStore.users.get(userBeta)!.rating = 1700
    testStore.users.get(userGamma)!.rating = 1700
    testStore.users.get(userDelta)!.rating = 1500

    const page1Res = await app.inject({
      method: 'GET',
      url: '/leaderboard?page=1&limit=2',
    })
    expect(page1Res.statusCode).toBe(200)
    const page1 = page1Res.json()
    expect(page1.users[0].userId).toBe(userAlpha)
    expect(page1.users[0].rank).toBe(1)
    expect(page1.users[1].userId).toBe(userBeta)
    expect(page1.users[1].rank).toBe(2)

    const page2Res = await app.inject({
      method: 'GET',
      url: `/leaderboard?page=2&limit=2&revision=${page1.revision}`,
    })
    expect(page2Res.statusCode).toBe(200)
    const page2 = page2Res.json()
    // userGamma is on page 2, but shares rank 2 with userBeta from page 1!
    expect(page2.users[0].userId).toBe(userGamma)
    expect(page2.users[0].rank).toBe(2)
    expect(page2.users[1].userId).toBe(userDelta)
    expect(page2.users[1].rank).toBe(4)
  })

  test('Banned users and users without authoritative ledger rows are excluded', async () => {
    testStore.users.set(userBanned, {
      id: userBanned,
      username: 'banned',
      rating: 2500,
      maxRating: 2500,
      isBanned: true,
    })
    testStore.contestRatingLedgers.push({
      contestId: 'c1',
      userId: userBanned,
      isAuthoritative: true,
    })

    testStore.users.set(userUnrated, {
      id: userUnrated,
      username: 'unrated',
      rating: 1600,
      maxRating: 1600,
      isBanned: false,
    })
    // No authoritative ledger entry for userUnrated

    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard?page=1&limit=10',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids = body.users.map((u: any) => u.userId)
    expect(ids).not.toContain(userBanned)
    expect(ids).not.toContain(userUnrated)
  })

  test('Later pages require a revision and reject rating changes rather than skipping competitors', async () => {
    const first = await app.inject({ method: 'GET', url: '/leaderboard?page=1&limit=2' })
    expect(first.statusCode).toBe(200)
    const revision = first.json().revision
    const missing = await app.inject({ method: 'GET', url: '/leaderboard?page=2&limit=2' })
    expect(missing.statusCode).toBe(409)
    testStore.users.get(userGamma)!.rating = 2000
    const stale = await app.inject({
      method: 'GET',
      url: `/leaderboard?page=2&limit=2&revision=${revision}`,
    })
    expect(stale.statusCode).toBe(409)
    const refreshed = await app.inject({ method: 'GET', url: '/leaderboard?page=1&limit=2' })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().revision).not.toBe(revision)
    expect(refreshed.json().users[0].userId).toBe(userGamma)
  })
})
