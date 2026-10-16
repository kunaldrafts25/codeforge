import { describe, expect, it } from 'vitest'
import {
  computePairwiseElo,
  computePairwiseExpected,
  type CompetitorRatingInput,
} from './rating.js'

/**
 * ============================================================================
 * HIGH-PRECISION ARBITRARY-PRECISION REFERENCE ENGINE
 * ============================================================================
 * Finding P3-R7 contract/evidence verification:
 *
 * rating.ts uses fixed-point argument reduction and repeated squaring, then
 * quantizes to 12 decimal places using round-half-up.
 * To provide independent evidence for numerical correctness and ensure no rounding
 * bias or float representation errors occur, this oracle provides:
 * 1. An independent Taylor series expansion for 10^x = exp(x * ln 10) computed in
 *    arbitrary precision (60 decimal places fixed-point BigInt) without calling Math.pow.
 * 2. Exact rational integer division and round-half-up quantization to 12 decimals.
 * 3. Pre-computed 50-decimal-place external reference vectors for boundary, asymmetric,
 *    and fine rating deltas.
 */

const PRECISION_SCALE = 10n ** 60n
// Natural logarithm of 10 to 60+ decimal places
const LN10_DIGITS =
  '2302585092994045684017991454684364207601101488628772976033327900967572609677352480235997205089598298'
const LN10 = BigInt(LN10_DIGITS.slice(0, 61))

/**
 * Computes exp(u) for u in [0, ln(10)) using Taylor series expansion:
 * exp(u) = sum_{m=0}^inf (u^m / m!)
 * Computed entirely in 60-decimal fixed-point BigInt arithmetic.
 */
function expTaylorFixed(uScaled: bigint): bigint {
  let sum = PRECISION_SCALE
  let term = PRECISION_SCALE
  for (let m = 1n; m <= 80n; m++) {
    term = (term * uScaled) / (m * PRECISION_SCALE)
    if (term === 0n) break
    sum += term
  }
  return sum
}

/**
 * Independent arbitrary-precision calculation of pairwise expected probability:
 * E(i, j) = 1 / (1 + 10 ^ ((rj - ri) / 400))
 *
 * Uses rational decomposition:
 *   (rj - ri) / 400 = k + f, with integer k and fractional f in [0, 1)
 *   10 ^ ((rj - ri) / 400) = 10^k * exp(f * ln(10))
 * Followed by exact round-half-up quantization to 12 decimal places (SCALE = 10^12).
 */
export function computeExpectedArbitraryPrecision(
  ri: number,
  rj: number
): { e_ij: bigint; e_ji: bigint } {
  const diffFloat = (rj - ri) / 400
  const SCALE12 = 1_000_000_000_000n

  if (diffFloat >= 50) return { e_ij: 0n, e_ji: SCALE12 }
  if (diffFloat <= -50) return { e_ij: SCALE12, e_ji: 0n }

  // Convert (rj - ri) to exact rational representation
  // Accommodates ratings with up to 6 decimal places
  const scaleFactor = 1_000_000n
  const delta = BigInt(Math.round((rj - ri) * 1_000_000))
  const denom = 400n * scaleFactor

  let k = delta / denom
  let rem = delta % denom
  if (rem < 0n) {
    rem += denom
    k -= 1n
  }

  // Fractional part f in [0, 1), scaled to 60 decimal places
  const fScaled = (rem * PRECISION_SCALE) / denom
  const uScaled = (fScaled * LN10) / PRECISION_SCALE
  const expUScaled = expTaylorFixed(uScaled) // 10^f * PRECISION_SCALE

  let num: bigint
  let den: bigint
  if (k >= 0n) {
    num = expUScaled * 10n ** k
    den = PRECISION_SCALE
  } else {
    num = expUScaled
    den = PRECISION_SCALE * 10n ** -k
  }

  // E = den / (num + den)
  // Exact round-half-up quantization:
  // round(A / B) = floor((2 * A + B) / (2 * B))
  const A = den * SCALE12
  const B = num + den
  const e_ij = (2n * A + B) / (2n * B)
  const e_ji = SCALE12 - e_ij
  return { e_ij, e_ji }
}

/**
 * INDEPENDENT ORACLE IMPLEMENTATION
 * High-precision independent calculation using arbitrary-precision Taylor series
 * and independent remainder logic to verify the production algorithm.
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
      const ci = eligible[i]!
      const cj = eligible[j]!

      // Use independent arbitrary-precision expected probability calculation
      // instead of Math.pow(10, diff)
      const { e_ij, e_ji } = computeExpectedArbitraryPrecision(ci.rating, cj.rating)
      const e_ij_num = Number(e_ij) / 1e12
      const e_ji_num = Number(e_ji) / 1e12

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

      rawDeltas.set(ci.userId, rawDeltas.get(ci.userId)! + (32 / (N - 1)) * (s_ij - e_ij_num))
      rawDeltas.set(cj.userId, rawDeltas.get(cj.userId)! + (32 / (N - 1)) * (s_ji - e_ji_num))
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

/**
 * High-precision external reference vectors computed with 100-digit precision arithmetic.
 * delta = R_A - R_B
 * Expected probability E(A, B) = 1 / (1 + 10^((R_B - R_A)/400)) = 1 / (1 + 10^(-delta/400))
 */
interface HighPrecisionReferenceVector {
  description: string
  delta: number
  ra: number
  rb: number
  expected50Dec: string
  expectedQuantized12Dec: string
  expectedScaled12: bigint
}

const HIGH_PRECISION_REFERENCE_VECTORS: HighPrecisionReferenceVector[] = [
  // 1. Equal ratings
  {
    description: 'Equal ratings (delta = 0)',
    delta: 0,
    ra: 1500,
    rb: 1500,
    expected50Dec: '0.50000000000000000000000000000000000000000000000000',
    expectedQuantized12Dec: '0.500000000000',
    expectedScaled12: 500_000_000_000n,
  },

  // 2. Asymmetric ratings (delta = +/- 1200)
  {
    description: 'Asymmetric ratings (delta = +1200: R_A=2400, R_B=1200)',
    delta: 1200,
    ra: 2400,
    rb: 1200,
    expected50Dec: '0.99900099900099900099900099900099900099900099900099',
    expectedQuantized12Dec: '0.999000999001',
    expectedScaled12: 999_000_999_001n,
  },
  {
    description: 'Asymmetric ratings (delta = -1200: R_A=1200, R_B=2400)',
    delta: -1200,
    ra: 1200,
    rb: 2400,
    expected50Dec: '0.00099900099900099900099900099900099900099900099900',
    expectedQuantized12Dec: '0.000999000999',
    expectedScaled12: 999_000_999n,
  },

  // 3. Extreme boundary deltas (delta = +/- 4000)
  {
    description: 'Extreme boundary delta (delta = +4000: R_A=4500, R_B=500)',
    delta: 4000,
    ra: 4500,
    rb: 500,
    expected50Dec: '0.99999999990000000000999999999900000000009999999999',
    expectedQuantized12Dec: '0.999999999900',
    expectedScaled12: 999_999_999_900n,
  },
  {
    description: 'Extreme boundary delta (delta = -4000: R_A=500, R_B=4500)',
    delta: -4000,
    ra: 500,
    rb: 4500,
    expected50Dec: '0.00000000009999999999000000000099999999990000000000',
    expectedQuantized12Dec: '0.000000000100',
    expectedScaled12: 100n,
  },

  // 4. Fine deltas (+/- 1, +/- 7, +/- 13, +/- 25, +/- 33, +/- 100, +/- 400)
  {
    description: 'Fine delta +1',
    delta: 1,
    ra: 1501,
    rb: 1500,
    expected50Dec: '0.50143911170915282146370465644324101800710077584212',
    expectedQuantized12Dec: '0.501439111709',
    expectedScaled12: 501_439_111_709n,
  },
  {
    description: 'Fine delta -1',
    delta: -1,
    ra: 1500,
    rb: 1501,
    expected50Dec: '0.49856088829084717853629534355675898199289922415787',
    expectedQuantized12Dec: '0.498560888291',
    expectedScaled12: 498_560_888_291n,
  },
  {
    description: 'Fine delta +7',
    delta: 7,
    ra: 1507,
    rb: 1500,
    expected50Dec: '0.51007244692743847925076007490490864119538465962449',
    expectedQuantized12Dec: '0.510072446927',
    expectedScaled12: 510_072_446_927n,
  },
  {
    description: 'Fine delta -7',
    delta: -7,
    ra: 1500,
    rb: 1507,
    expected50Dec: '0.48992755307256152074923992509509135880461534037550',
    expectedQuantized12Dec: '0.489927553073',
    expectedScaled12: 489_927_553_073n,
  },
  {
    description: 'Fine delta +13',
    delta: 13,
    ra: 1513,
    rb: 1500,
    expected50Dec: '0.51869977792955856256409694021538406056120444730456',
    expectedQuantized12Dec: '0.518699777930',
    expectedScaled12: 518_699_777_930n,
  },
  {
    description: 'Fine delta -13',
    delta: -13,
    ra: 1500,
    rb: 1513,
    expected50Dec: '0.48130022207044143743590305978461593943879555269543',
    expectedQuantized12Dec: '0.481300222070',
    expectedScaled12: 481_300_222_070n,
  },
  {
    description: 'Fine delta +25',
    delta: 25,
    ra: 1525,
    rb: 1500,
    expected50Dec: '0.53591592694510228475190223176828911438415774217121',
    expectedQuantized12Dec: '0.535915926945',
    expectedScaled12: 535_915_926_945n,
  },
  {
    description: 'Fine delta -25',
    delta: -25,
    ra: 1500,
    rb: 1525,
    expected50Dec: '0.46408407305489771524809776823171088561584225782878',
    expectedQuantized12Dec: '0.464084073055',
    expectedScaled12: 464_084_073_055n,
  },
  {
    description: 'Fine delta +33',
    delta: 33,
    ra: 1533,
    rb: 1500,
    expected50Dec: '0.54734851804586464963274211757569343808515699169345',
    expectedQuantized12Dec: '0.547348518046',
    expectedScaled12: 547_348_518_046n,
  },
  {
    description: 'Fine delta -33',
    delta: -33,
    ra: 1500,
    rb: 1533,
    expected50Dec: '0.45265148195413535036725788242430656191484300830654',
    expectedQuantized12Dec: '0.452651481954',
    expectedScaled12: 452_651_481_954n,
  },
  {
    description: 'Fine delta +100',
    delta: 100,
    ra: 1600,
    rb: 1500,
    expected50Dec: '0.64006499980288508075821799460835793047791713132622',
    expectedQuantized12Dec: '0.640064999803',
    expectedScaled12: 640_064_999_803n,
  },
  {
    description: 'Fine delta -100',
    delta: -100,
    ra: 1500,
    rb: 1600,
    expected50Dec: '0.35993500019711491924178200539164206952208286867377',
    expectedQuantized12Dec: '0.359935000197',
    expectedScaled12: 359_935_000_197n,
  },
  {
    description: 'Fine delta +400',
    delta: 400,
    ra: 1900,
    rb: 1500,
    expected50Dec: '0.90909090909090909090909090909090909090909090909090',
    expectedQuantized12Dec: '0.909090909091',
    expectedScaled12: 909_090_909_091n,
  },
  {
    description: 'Fine delta -400',
    delta: -400,
    ra: 1500,
    rb: 1900,
    expected50Dec: '0.09090909090909090909090909090909090909090909090909',
    expectedQuantized12Dec: '0.090909090909',
    expectedScaled12: 90_909_090_909n,
  },

  // 5. Saturation boundaries (diff >= 50 or diff <= -50)
  {
    description: 'Boundary saturation delta = +20000 (diff = -50)',
    delta: 20000,
    ra: 21500,
    rb: 1500,
    expected50Dec: '1.00000000000000000000000000000000000000000000000000',
    expectedQuantized12Dec: '1.000000000000',
    expectedScaled12: 1_000_000_000_000n,
  },
  {
    description: 'Boundary saturation delta = -20000 (diff = +50)',
    delta: -20000,
    ra: 1500,
    rb: 21500,
    expected50Dec: '0.00000000000000000000000000000000000000000000000000',
    expectedQuantized12Dec: '0.000000000000',
    expectedScaled12: 0n,
  },
  {
    description: 'Boundary saturation delta = +24000 (diff = -60)',
    delta: 24000,
    ra: 25500,
    rb: 1500,
    expected50Dec: '1.00000000000000000000000000000000000000000000000000',
    expectedQuantized12Dec: '1.000000000000',
    expectedScaled12: 1_000_000_000_000n,
  },
  {
    description: 'Boundary saturation delta = -24000 (diff = +60)',
    delta: -24000,
    ra: 1500,
    rb: 25500,
    expected50Dec: '0.00000000000000000000000000000000000000000000000000',
    expectedQuantized12Dec: '0.000000000000',
    expectedScaled12: 0n,
  },
]

describe('Finding P3-R7: Independent High-Precision Reference & Oracle Verification', () => {
  describe('Independent Arbitrary-Precision Pairwise Expected Probability Verification', () => {
    it('matches an independently decomposed oracle for every integer difference from -8000 to 8000', () => {
      for (let delta = -8000; delta <= 8000; delta++) {
        expect(computePairwiseExpected(1500, 1500 + delta), `rating delta ${delta}`).toEqual(
          computeExpectedArbitraryPrecision(1500, 1500 + delta)
        )
      }
    })
    it('arbitrary-precision Taylor series matches external 50-decimal reference vectors across all test points', () => {
      for (const vector of HIGH_PRECISION_REFERENCE_VECTORS) {
        const { e_ij, e_ji } = computeExpectedArbitraryPrecision(vector.ra, vector.rb)

        expect(
          e_ij,
          `Arbitrary-precision oracle failed for ${vector.description}: expected ${vector.expectedScaled12}, got ${e_ij}`
        ).toBe(vector.expectedScaled12)

        // Verify complementary value e_ji
        expect(e_ij + e_ji).toBe(1_000_000_000_000n)
      }
    })

    it('production computePairwiseExpected matches arbitrary-precision oracle across all reference points', () => {
      for (const vector of HIGH_PRECISION_REFERENCE_VECTORS) {
        const arb = computeExpectedArbitraryPrecision(vector.ra, vector.rb)
        const prod = computePairwiseExpected(vector.ra, vector.rb)

        expect(
          prod.e_ij,
          `Production mismatch on ${vector.description}: expected ${arb.e_ij}, got ${prod.e_ij}`
        ).toBe(arb.e_ij)
        expect(prod.e_ji).toBe(arb.e_ji)
      }
    })

    it('complementary identity holds strictly: E_ij + E_ji == 1.000000000000 (SCALE) for all vectors', () => {
      const SCALE = 1_000_000_000_000n
      for (const vector of HIGH_PRECISION_REFERENCE_VECTORS) {
        const arb = computeExpectedArbitraryPrecision(vector.ra, vector.rb)
        const prod = computePairwiseExpected(vector.ra, vector.rb)

        expect(arb.e_ij + arb.e_ji).toBe(SCALE)
        expect(prod.e_ij + prod.e_ji).toBe(SCALE)
      }
    })

    it('transitivity of pairwise expectations holds strictly across ordered ratings (A > B > C)', () => {
      const triplets = [
        [2400, 1800, 1200],
        [2100, 1500, 900],
        [1600, 1550, 1500],
        [1501, 1500, 1499],
        [3000, 2000, 1000],
      ]

      for (const [rA, rB, rC] of triplets) {
        const e_ab = computePairwiseExpected(rA!, rB!).e_ij
        const e_bc = computePairwiseExpected(rB!, rC!).e_ij
        const e_ac = computePairwiseExpected(rA!, rC!).e_ij

        // Since rA > rB > rC:
        // E(A, B) > 0.5, E(B, C) > 0.5, and E(A, C) > max(E(A, B), E(B, C))
        expect(e_ab).toBeGreaterThan(500_000_000_000n)
        expect(e_bc).toBeGreaterThan(500_000_000_000n)
        expect(e_ac).toBeGreaterThan(e_ab)
        expect(e_ac).toBeGreaterThan(e_bc)

        // Verify independent arbitrary-precision oracle agrees
        const arb_ab = computeExpectedArbitraryPrecision(rA!, rB!).e_ij
        const arb_bc = computeExpectedArbitraryPrecision(rB!, rC!).e_ij
        const arb_ac = computeExpectedArbitraryPrecision(rA!, rC!).e_ij

        expect(e_ab).toBe(arb_ab)
        expect(e_bc).toBe(arb_bc)
        expect(e_ac).toBe(arb_ac)
      }
    })
  })

  describe('CodeForge Pairwise Elo v1 & Independent Oracle Engine', () => {
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

      const input2: CompetitorRatingInput[] = [input1[2]!, input1[1]!, input1[0]!] // Reversed order

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

    it('Extreme integer rating differences (+-2000, +-4000) are stable without NaN or overflow', () => {
      const input: CompetitorRatingInput[] = [
        {
          userId: 'god',
          rating: 4500,
          maxRating: 4500,
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

  describe('Permutation Invariance and Tie-Breaking Stability', () => {
    it('Permutation invariance across 50 randomized orderings', () => {
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

      for (let i = 0; i < 50; i++) {
        const shuffled = [...base].sort(() => Math.random() - 0.5)
        const res = computePairwiseElo(shuffled)
        for (const r of res.results) {
          expect(r.delta).toBe(baselineMap.get(r.userId))
        }
        expect(res.results.reduce((s, r) => s + r.delta, 0)).toBe(0)
      }
    })

    it('Stable tie-breaking on identical remainders: breaks ties strictly by userId ASC invariant of input order', () => {
      // 4 competitors where alpha, beta, gamma have identical performance and remainders:
      // alpha, beta, gamma all receive raw delta 5.3333... (floor 5, remainder 1/3)
      // delta receives raw delta -16.0 (floor -16, remainder 0)
      // floorSum = 5 + 5 + 5 - 16 = -1 => remaining = 1
      // Exactly 1 competitor among (alpha, beta, gamma) receives +1 bonus.
      // Tie-breaking by userId ASC requires 'alpha' to receive the +1 bonus (delta = 6),
      // while 'beta' and 'gamma' receive delta = 5, and 'delta' receives delta = -16.
      const competitors: CompetitorRatingInput[] = [
        {
          userId: 'gamma',
          rating: 1500,
          maxRating: 1500,
          solves: 2,
          penalty: 50,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'alpha',
          rating: 1500,
          maxRating: 1500,
          solves: 2,
          penalty: 50,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'beta',
          rating: 1500,
          maxRating: 1500,
          solves: 2,
          penalty: 50,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'delta',
          rating: 1500,
          maxRating: 1500,
          solves: 1,
          penalty: 50,
          hasDeterministicVerdict: true,
        },
      ]

      function permute<T>(arr: T[]): T[][] {
        if (arr.length <= 1) return [arr]
        const res: T[][] = []
        for (let i = 0; i < arr.length; i++) {
          const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
          for (const p of permute(rest)) {
            res.push([arr[i]!, ...p])
          }
        }
        return res
      }

      // Test all 4! = 24 permutations
      const allPermutations = permute(competitors)
      expect(allPermutations.length).toBe(24)

      for (const p of allPermutations) {
        const res = computePairwiseElo(p)
        const map = new Map(res.results.map(r => [r.userId, r.delta]))

        expect(map.get('alpha')).toBe(6)
        expect(map.get('beta')).toBe(5)
        expect(map.get('gamma')).toBe(5)
        expect(map.get('delta')).toBe(-16)

        // Strict zero sum
        expect(res.results.reduce((s, r) => s + r.delta, 0)).toBe(0)
      }
    })
  })

  describe('Zero-Sum Invariant Conservation', () => {
    it('strict zero-sum invariant holds across varying contest sizes (N = 2, 3, 5, 8, 12, 20)', () => {
      const sizes = [2, 3, 5, 8, 12, 20]

      for (const N of sizes) {
        const competitors: CompetitorRatingInput[] = Array.from({ length: N }, (_, idx) => ({
          userId: `user-${String(idx).padStart(2, '0')}`,
          rating: 1200 + (idx % 7) * 150,
          maxRating: 1200 + (idx % 7) * 150,
          solves: Math.floor(idx / 3),
          penalty: (idx * 37) % 300,
          hasDeterministicVerdict: true,
        }))

        const res = computePairwiseElo(competitors)
        expect(res.isEligible).toBe(true)
        const sum = res.results.reduce((acc, r) => acc + r.delta, 0)
        expect(sum).toBe(0)
      }
    })

    it('strict zero-sum invariant holds in skewed / grandmaster vs novice distributions', () => {
      const competitors: CompetitorRatingInput[] = [
        {
          userId: 'gm-1',
          rating: 2800,
          maxRating: 2800,
          solves: 5,
          penalty: 45,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'novice-1',
          rating: 1000,
          maxRating: 1000,
          solves: 1,
          penalty: 120,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'novice-2',
          rating: 1050,
          maxRating: 1050,
          solves: 1,
          penalty: 150,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'novice-3',
          rating: 1100,
          maxRating: 1100,
          solves: 2,
          penalty: 200,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'novice-4',
          rating: 1150,
          maxRating: 1150,
          solves: 0,
          penalty: 0,
          hasDeterministicVerdict: true,
        },
      ]

      const res = computePairwiseElo(competitors)
      expect(res.isEligible).toBe(true)
      const sum = res.results.reduce((acc, r) => acc + r.delta, 0)
      expect(sum).toBe(0)
    })

    it('strict zero-sum invariant holds when all competitors tie identically', () => {
      const competitors: CompetitorRatingInput[] = Array.from({ length: 6 }, (_, idx) => ({
        userId: `tied-user-${idx}`,
        rating: 1500,
        maxRating: 1500,
        solves: 3,
        penalty: 100,
        hasDeterministicVerdict: true,
      }))

      const res = computePairwiseElo(competitors)
      expect(res.isEligible).toBe(true)
      for (const r of res.results) {
        expect(r.delta).toBe(0)
      }
      const sum = res.results.reduce((acc, r) => acc + r.delta, 0)
      expect(sum).toBe(0)
    })

    it('strict zero-sum invariant holds in extreme blowout matches (+-4000 rating gaps)', () => {
      const competitors: CompetitorRatingInput[] = [
        {
          userId: 'titan-1',
          rating: 4500,
          maxRating: 4500,
          solves: 5,
          penalty: 10,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'beginner-1',
          rating: 500,
          maxRating: 500,
          solves: 0,
          penalty: 0,
          hasDeterministicVerdict: true,
        },
        {
          userId: 'beginner-2',
          rating: 500,
          maxRating: 500,
          solves: 0,
          penalty: 0,
          hasDeterministicVerdict: true,
        },
      ]

      const res = computePairwiseElo(competitors)
      expect(res.isEligible).toBe(true)
      const sum = res.results.reduce((acc, r) => acc + r.delta, 0)
      expect(sum).toBe(0)
    })
  })
})
