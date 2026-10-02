import { describe, expect, it } from 'vitest'
import { computePairwiseElo, type CompetitorRatingInput } from './rating.js'

/**
 * INDEPENDENT ORACLE IMPLEMENTATION
 * Separate, independent calculation using standard floating-point and independent remainder logic
 * to verify the production integer-scaled algorithm.
 */
function independentOracleElo(
  competitors: {
    userId: string
    rating: number
    solves: number
    penalty: number
    hasDeterministicVerdict: boolean
    isDisqualified?: boolean
  }[]
) {
  const eligible = competitors.filter(c => !c.isDisqualified && c.hasDeterministicVerdict)
  if (eligible.length < 2) {
    return { isEligible: false, reason: 'INSUFFICIENT_PARTICIPANTS', results: [] }
  }

  const N = eligible.length
  const rawDeltas = new Map<string, number>()
  for (const c of eligible) rawDeltas.set(c.userId, 0)

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const ci = eligible[i]
      const cj = eligible[j]

      const expVal = (cj.rating - ci.rating) / 400
      let e_ij = 1 / (1 + Math.pow(10, expVal))
      // 12-decimal round-half-up quantization
      e_ij = Math.round(e_ij * 1e12) / 1e12
      const e_ji = 1 - e_ij

      let s_ij = 0.5
      let s_ji = 0.5
      if (ci.solves > cj.solves) {
        s_ij = 1
        s_ji = 0
      } else if (ci.solves < cj.solves) {
        s_ij = 0
        s_ji = 1
      } else {
        if (ci.penalty < cj.penalty) {
          s_ij = 1
          s_ji = 0
        } else if (ci.penalty > cj.penalty) {
          s_ij = 0
          s_ji = 1
        }
      }

      rawDeltas.set(ci.userId, rawDeltas.get(ci.userId)! + (32 / (N - 1)) * (s_ij - e_ij))
      rawDeltas.set(cj.userId, rawDeltas.get(cj.userId)! + (32 / (N - 1)) * (s_ji - e_ji))
    }
  }

  let floorSum = 0
  const intermediate = eligible.map(c => {
    const raw = rawDeltas.get(c.userId)!
    const floor = Math.floor(raw)
    const rem = raw - floor
    floorSum += floor
    return { userId: c.userId, c, raw, floor, rem }
  })

  const remaining = -floorSum

  intermediate.sort((a, b) => {
    const diff = b.rem - a.rem
    if (Math.abs(diff) > 1e-9) return diff
    return a.userId.localeCompare(b.userId)
  })

  const finalResults = intermediate.map((item, idx) => {
    const delta = item.floor + (idx < remaining ? 1 : 0)
    return {
      userId: item.userId,
      oldRating: item.c.rating,
      newRating: item.c.rating + delta,
      delta,
      rawDelta: item.raw,
    }
  })

  return { isEligible: true, results: finalResults }
}

describe('CodeForge Pairwise Elo v1 & Independent Oracle', () => {
  it('Golden fixture 1: two equal-1500 competitors, decisive winner/loser -> +16/-16', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'user-a',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 100,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-b',
        rating: 1500,
        maxRating: 1500,
        solves: 1,
        penalty: 50,
        hasDeterministicVerdict: true,
      },
    ]

    const prod = computePairwiseElo(input)
    const oracle = independentOracleElo(input)

    expect(prod.isEligible).toBe(true)
    const map = new Map(prod.results.map(r => [r.userId, r]))
    expect(map.get('user-a')?.delta).toBe(16)
    expect(map.get('user-b')?.delta).toBe(-16)

    // Oracle match
    const oracleMap = new Map(oracle.results.map(r => [r.userId, r]))
    expect(map.get('user-a')?.delta).toBe(oracleMap.get('user-a')?.delta)
    expect(map.get('user-b')?.delta).toBe(oracleMap.get('user-b')?.delta)
  })

  it('Golden fixture 2: two tied equal-1500 competitors -> 0/0', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'user-a',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 100,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-b',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 100,
        hasDeterministicVerdict: true,
      },
    ]

    const prod = computePairwiseElo(input)
    const oracle = independentOracleElo(input)

    expect(prod.isEligible).toBe(true)
    const map = new Map(prod.results.map(r => [r.userId, r]))
    expect(map.get('user-a')?.delta).toBe(0)
    expect(map.get('user-b')?.delta).toBe(0)

    const oracleMap = new Map(oracle.results.map(r => [r.userId, r]))
    expect(oracleMap.get('user-a')?.delta).toBe(0)
    expect(oracleMap.get('user-b')?.delta).toBe(0)
  })

  it('Golden fixture 3: three equal-1500 competitors in distinct order -> +16/0/-16', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'user-1',
        rating: 1500,
        maxRating: 1500,
        solves: 3,
        penalty: 50,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-2',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 50,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-3',
        rating: 1500,
        maxRating: 1500,
        solves: 1,
        penalty: 50,
        hasDeterministicVerdict: true,
      },
    ]

    const prod = computePairwiseElo(input)
    const oracle = independentOracleElo(input)

    expect(prod.isEligible).toBe(true)
    const map = new Map(prod.results.map(r => [r.userId, r]))
    expect(map.get('user-1')?.delta).toBe(16)
    expect(map.get('user-2')?.delta).toBe(0)
    expect(map.get('user-3')?.delta).toBe(-16)

    const oracleMap = new Map(oracle.results.map(r => [r.userId, r]))
    expect(map.get('user-1')?.delta).toBe(oracleMap.get('user-1')?.delta)
    expect(map.get('user-2')?.delta).toBe(oracleMap.get('user-2')?.delta)
    expect(map.get('user-3')?.delta).toBe(oracleMap.get('user-3')?.delta)
  })

  it('Golden fixture 4: tied competitors receive identical delta regardless of input row order', () => {
    // Competitor A and B tie in solves/penalty, C is distinct loser
    const input1: CompetitorRatingInput[] = [
      {
        userId: 'user-a',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-b',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 60,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'user-c',
        rating: 1500,
        maxRating: 1500,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]

    const input2: CompetitorRatingInput[] = [input1[2], input1[1], input1[0]] // Reversed order

    const res1 = computePairwiseElo(input1)
    const res2 = computePairwiseElo(input2)

    const map1 = new Map(res1.results.map(r => [r.userId, r]))
    const map2 = new Map(res2.results.map(r => [r.userId, r]))

    expect(map1.get('user-a')?.delta).toBe(map1.get('user-b')?.delta)
    expect(map2.get('user-a')?.delta).toBe(map2.get('user-b')?.delta)
    expect(map1.get('user-a')?.delta).toBe(map2.get('user-a')?.delta)
    expect(map1.get('user-c')?.delta).toBe(map2.get('user-c')?.delta)
  })

  it('Unequal ratings and zero-sum conservation match oracle', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'master',
        rating: 2200,
        maxRating: 2200,
        solves: 4,
        penalty: 120,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'expert',
        rating: 1800,
        maxRating: 1850,
        solves: 3,
        penalty: 150,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'pupil',
        rating: 1300,
        maxRating: 1350,
        solves: 2,
        penalty: 80,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'newbie',
        rating: 1000,
        maxRating: 1050,
        solves: 1,
        penalty: 20,
        hasDeterministicVerdict: true,
      },
    ]

    const prod = computePairwiseElo(input)
    const oracle = independentOracleElo(input)

    const prodMap = new Map(prod.results.map(r => [r.userId, r]))
    const oracleMap = new Map(oracle.results.map(r => [r.userId, r]))

    for (const c of input) {
      expect(prodMap.get(c.userId)?.delta).toBe(oracleMap.get(c.userId)?.delta)
    }

    const sum = prod.results.reduce((acc, r) => acc + r.delta, 0)
    expect(sum).toBe(0)
  })

  it('Permutation invariance across 20 randomized orderings', () => {
    const base: CompetitorRatingInput[] = [
      {
        userId: 'u1',
        rating: 1600,
        maxRating: 1600,
        solves: 3,
        penalty: 40,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u2',
        rating: 1550,
        maxRating: 1550,
        solves: 3,
        penalty: 80,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u3',
        rating: 1500,
        maxRating: 1500,
        solves: 2,
        penalty: 30,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u4',
        rating: 1450,
        maxRating: 1450,
        solves: 1,
        penalty: 10,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'u5',
        rating: 1400,
        maxRating: 1400,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]

    const baseline = computePairwiseElo(base)
    const baselineMap = new Map(baseline.results.map(r => [r.userId, r.delta]))

    for (let i = 0; i < 20; i++) {
      const shuffled = [...base].sort(() => Math.random() - 0.5)
      const res = computePairwiseElo(shuffled)
      for (const r of res.results) {
        expect(r.delta).toBe(baselineMap.get(r.userId))
      }
      expect(res.results.reduce((s, r) => s + r.delta, 0)).toBe(0)
    }
  })

  it('Insufficient participants (< 2 eligible) produces no rating event', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'solo',
        rating: 1500,
        maxRating: 1500,
        solves: 3,
        penalty: 50,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'noshow',
        rating: 1500,
        maxRating: 1500,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: false, // only registered, no deterministic attempt
      },
    ]

    const res = computePairwiseElo(input)
    expect(res.isEligible).toBe(false)
    expect(res.reason).toBe('INSUFFICIENT_PARTICIPANTS')
    expect(res.results.length).toBe(0)
  })

  it('Extreme integer rating differences (+-2000) are stable without NaN or overflow', () => {
    const input: CompetitorRatingInput[] = [
      {
        userId: 'god',
        rating: 3500,
        maxRating: 3500,
        solves: 5,
        penalty: 20,
        hasDeterministicVerdict: true,
      },
      {
        userId: 'beginner',
        rating: 500,
        maxRating: 500,
        solves: 0,
        penalty: 0,
        hasDeterministicVerdict: true,
      },
    ]

    const res = computePairwiseElo(input)
    expect(res.isEligible).toBe(true)
    const map = new Map(res.results.map(r => [r.userId, r]))
    expect(map.get('god')?.delta).toBe(0)
    expect(map.get('beginner')?.delta).toBe(0)
    expect(res.results.reduce((s, r) => s + r.delta, 0)).toBe(0)
  })
})
