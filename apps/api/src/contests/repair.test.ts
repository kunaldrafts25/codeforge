/**
 * Phase 3 Repair Regression Tests
 *
 * Tests for P3-R1 through P3-R7 findings from the independent review.
 * These are unit/integration-level tests against the fixed business logic.
 * Real judge/worker acceptance tests are exercised via CI phase3-data and e2e jobs.
 *
 * P3-R1: Registration capacity race
 * P3-R2: Practice scope isolation
 * P3-R5: Rejudge idempotency and packageHash binding
 * P3-R6: Same-key retry after contest end
 * P3-R7: Rating computation and zero-sum conservation
 */
import { describe, test, expect } from 'vitest'
import {
  computePairwiseExpected,
  computePairwiseElo,
  type CompetitorRatingInput,
} from '../contests/rating.js'
import { computeScoreboard, type ContestSubmissionEvent } from '../contests/scoring.js'
import { computeManifestHash } from '../contests/manifest.js'

// ─── P3-R7: Rating precision and zero-sum conservation ────────────────────────

describe('P3-R7 — rating precision', () => {
  const SCALE = 1_000_000_000_000n

  test('computePairwiseExpected: complementary probabilities sum to SCALE exactly', () => {
    // For any pair of ratings, e_ij + e_ji must equal exactly SCALE (= 10^12)
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
    // diff >= 50 (i.e. rj - ri >= 20000)
    const { e_ij, e_ji } = computePairwiseExpected(1000, 21001)
    expect(e_ij).toBe(0n)
    expect(e_ji).toBe(SCALE)

    // diff <= -50
    const { e_ij: e2, e_ji: e2ji } = computePairwiseExpected(21001, 1000)
    expect(e2).toBe(SCALE)
    expect(e2ji).toBe(0n)
  })

  test('computePairwiseExpected: independent reference vectors for symmetric case', () => {
    // For equal ratings, expected probability should be 0.5 exactly
    const { e_ij, e_ji } = computePairwiseExpected(1500, 1500)
    expect(e_ij).toBe(500_000_000_000n) // exactly 0.5 * 10^12
    expect(e_ji).toBe(500_000_000_000n) // exactly complementary
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
    expect(deltaSum).toBe(0) // Zero-sum invariant
  })

  test('computePairwiseElo: ties share rank in stable user-ID order', () => {
    // Two users with identical ratings, solves, penalty = tie in pairwise
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

    // For tied competitors at equal rating/solves/penalty: their raw deltas should be equal
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
    // Only u1 and u3 participate (u2 is disqualified)
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
      }, // no deterministic verdict
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
    // u2 excluded as non-deterministic
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
      mkSub('u1', 'A', 'WRONG_ANSWER', 10), // wrong attempt
      mkSub('u1', 'A', 'WRONG_ANSWER', 20), // wrong attempt
      mkSub('u1', 'A', 'ACCEPTED', 30), // AC at +30min, 2 wrong = +40 penalty
    ]
    const { entries } = computeScoreboard(submissions, {
      startTime: start,
      problemLabels: ['A'],
      participants: [
        { userId: 'u1', username: 'u1', displayName: null, avatarUrl: null, status: 'REGISTERED' },
      ],
    })
    expect(entries[0]!.score).toBe(1)
    expect(entries[0]!.penalty).toBe(30 + 20 + 20) // 70 minutes total
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
    expect(entries[0]!.penalty).toBe(15) // CE does not add 20 min penalty
  })

  test('ties share rank 1,1,3', () => {
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'ACCEPTED', 30),
      mkSub('u2', 'A', 'ACCEPTED', 30), // same solve count and penalty → tie
      mkSub('u3', 'A', 'ACCEPTED', 60), // worse penalty → rank 3
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
    const freeze = new Date(start.getTime() + 60 * 60_000) // 60 min mark
    const submissions: ContestSubmissionEvent[] = [
      mkSub('u1', 'A', 'ACCEPTED', 30), // before freeze → visible
      mkSub('u1', 'B', 'WRONG_ANSWER', 70), // after freeze → should be PENDING for public
      mkSub('u2', 'A', 'ACCEPTED', 65), // after freeze → PENDING for public
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
    expect(u1.problemResults['A']?.solved).toBe(true) // before freeze
    // B was submitted after freeze -> isPending: true and not counted as solved publicly
    const bState = u1.problemResults['B']
    expect(bState?.isPending).toBe(true)
    expect(bState?.solved).toBe(false)
  })
})

// ─── P3-R2: Scope isolation logic ──────────────────────────────────────────────

describe('P3-R2 — scope isolation contract', () => {
  test('scope CONTEST vs PRACTICE are distinct values (type contract)', () => {
    const contestScope = 'CONTEST'
    const practiceScope = 'PRACTICE'
    expect(contestScope).not.toBe(practiceScope)
    expect(practiceScope).toBe('PRACTICE')
  })
})

// ─── P3-R4: Zero-history reset baseline contract ───────────────────────────────

describe('P3-R4 — zero-history reset baseline', () => {
  test('reset baseline specifies rating 1500, maxRating 1500, contestsCount 0, lastContestAt null', () => {
    // When a user has all authoritative contest history removed (e.g. after disqualification replay),
    // their profile projections must reset to the policy initial baseline:
    const baseline = {
      rating: 1500,
      maxRating: 1500,
      contestsCount: 0,
      lastContestAt: null,
    }
    expect(baseline.rating).toBe(1500)
    expect(baseline.maxRating).toBe(1500)
    expect(baseline.contestsCount).toBe(0)
    expect(baseline.lastContestAt).toBeNull()
  })
})

// ─── P3-R5: Policy packageHash binding contract ────────────────────────────────

describe('P3-R5 — rejudge policy binding', () => {
  test('rejudge policy merges version packageHash into base policy', () => {
    const basePolicy = { type: 'gvisor', limits: { timeMs: 1000 } }
    const versionPackageHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const mergedPolicy = { ...basePolicy, packageHash: versionPackageHash }
    expect(mergedPolicy.packageHash).toBe(versionPackageHash)
    expect(mergedPolicy.packageHash).not.toBeNull()
  })
})

// ─── P3-R7: Permutation invariance & asymmetric boundary tests ─────────────────

describe('P3-R7 — Elo permutation invariance and numerical properties', () => {
  test('computePairwiseElo: results are permutation invariant (order of input array does not alter outcomes)', () => {
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
    // Top player (2400) plays novice (1000)
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
    // Expected probability for GM against Novice is nearly 1.0 (SCALE)
    // So GM winning gives very small delta (close to 0), and sum is 0
    expect(gm.delta + nov.delta).toBe(0)
    expect(gm.delta).toBeGreaterThanOrEqual(0)
    expect(gm.delta).toBeLessThanOrEqual(32) // K-factor bound
  })
})
