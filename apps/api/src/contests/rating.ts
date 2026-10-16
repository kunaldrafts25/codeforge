export interface CompetitorRatingInput {
  userId: string
  rating: number
  maxRating: number
  solves: number
  penalty: number
  hasDeterministicVerdict: boolean
  isDisqualified?: boolean
}

export interface CompetitorRatingOutput {
  userId: string
  oldRating: number
  newRating: number
  delta: number
  maxRating: number
  rawDelta: number
}

export interface RatingCalculationResult {
  isEligible: boolean
  reason?: string
  results: CompetitorRatingOutput[]
}

const SCALE = 1_000_000_000_000n // 10^12 for 12 decimal places

/**
 * Computes pairwise Elo expected value quantized to 12 decimal places.
 * E(i,j) = 1 / (1 + 10 ^ ((Rj - Ri) / 400))
 * Quantized to 12 decimal places using round-half-up.
 * Reverse is 1 - E(i,j) exactly.
 */
export function computePairwiseExpected(ri: number, rj: number): { e_ij: bigint; e_ji: bigint } {
  if (!Number.isFinite(ri) || !Number.isFinite(rj)) throw new Error('Ratings must be finite')
  const delta = BigInt(Math.round((rj - ri) * 1_000_000))
  if (delta >= 20_000_000_000n) {
    return { e_ij: 0n, e_ji: SCALE }
  }
  if (delta <= -20_000_000_000n) {
    return { e_ij: SCALE, e_ji: 0n }
  }

  // Fixed point at 60 decimal places, with argument reduction by 256 and
  // repeated squaring. Quantization never crosses a binary floating point
  // probability. The independent test oracle decomposes powers of ten instead.
  const precision = 10n ** 60n
  const ln10 = 2302585092994045684017991454684364207601101488628772976033327n
  const magnitude = delta < 0n ? -delta : delta
  const x = (magnitude * ln10) / (400_000_000n * 256n)
  let exponential = precision
  let term = precision
  for (let n = 1n; n <= 100n; n++) {
    term = (term * x) / (precision * n)
    if (term === 0n) break
    exponential += term
  }
  for (let i = 0; i < 8; i++) exponential = (exponential * exponential) / precision
  const denominator = precision + exponential
  const numerator = (delta < 0n ? exponential : precision) * SCALE
  const e_ij = (2n * numerator + denominator) / (2n * denominator)
  const e_ji = SCALE - e_ij
  return { e_ij, e_ji }
}

/**
 * CodeForge pairwise Elo v1 rating algorithm.
 * Implements codeforge-pairwise-elo-v1 policy.
 */
export function computePairwiseElo(competitors: CompetitorRatingInput[]): RatingCalculationResult {
  // Filter rating-eligible competitors:
  // Non-disqualified with at least one deterministic verdict attempt
  const eligible = competitors.filter(c => !c.isDisqualified && c.hasDeterministicVerdict)

  if (eligible.length < 2) {
    return {
      isEligible: false,
      reason: 'INSUFFICIENT_PARTICIPANTS',
      results: [],
    }
  }

  const N = eligible.length
  const nMinus1 = BigInt(N - 1)
  const den = nMinus1 * SCALE

  // Pre-calculate unordered pair expectations and actual score outcomes
  const diffSums = new Map<string, bigint>()
  for (const c of eligible) {
    diffSums.set(c.userId, 0n)
  }

  for (let i = 0; i < N; i++) {
    const ci = eligible[i]!
    for (let j = i + 1; j < N; j++) {
      const cj = eligible[j]!

      const { e_ij, e_ji } = computePairwiseExpected(ci.rating, cj.rating)

      // Actual score S(i, j):
      // 1 if i outranks j by solves/penalty
      // 0 if j outranks i
      // 0.5 if tie
      let s_ij: bigint
      let s_ji: bigint

      if (ci.solves > cj.solves) {
        s_ij = SCALE
        s_ji = 0n
      } else if (ci.solves < cj.solves) {
        s_ij = 0n
        s_ji = SCALE
      } else {
        // Equal solves -> tiebreak by penalty ascending
        if (ci.penalty < cj.penalty) {
          s_ij = SCALE
          s_ji = 0n
        } else if (ci.penalty > cj.penalty) {
          s_ij = 0n
          s_ji = SCALE
        } else {
          // Tie
          s_ij = SCALE / 2n
          s_ji = SCALE / 2n
        }
      }

      const diff_ij = s_ij - e_ij
      const diff_ji = s_ji - e_ji

      diffSums.set(ci.userId, diffSums.get(ci.userId)! + diff_ij)
      diffSums.set(cj.userId, diffSums.get(cj.userId)! + diff_ji)
    }
  }

  // Raw delta calculation & Largest Remainder integerization
  interface IntermediateCandidate {
    userId: string
    c: CompetitorRatingInput
    rawDelta: number
    floorDelta: bigint
    remainder: bigint
  }

  const intermediates: IntermediateCandidate[] = []
  let floorSum = 0n

  for (const c of eligible) {
    const D_i = diffSums.get(c.userId)!
    const num = 32n * D_i

    // Exact floor and remainder for num / den
    let floorDelta: bigint
    let remainder: bigint

    if (num >= 0n) {
      floorDelta = num / den
      remainder = num % den
    } else {
      if (num % den === 0n) {
        floorDelta = num / den
        remainder = 0n
      } else {
        floorDelta = num / den - 1n
        remainder = den + (num % den)
      }
    }

    floorSum += floorDelta
    const rawDelta = Number(num) / Number(den)

    intermediates.push({
      userId: c.userId,
      c,
      rawDelta,
      floorDelta,
      remainder,
    })
  }

  // Zero-sum assertion: remaining = -sum(floorDelta)
  const remaining = Number(-floorSum)
  if (remaining < 0 || remaining >= N) {
    throw new Error(`Rating calculation invariant broken: remaining=${remaining}, N=${N}`)
  }

  // Sort by remainder descending, breaking ties by userId ASC (stable lexicographical)
  intermediates.sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1
    }
    return a.userId.localeCompare(b.userId)
  })

  // Award +1 to the `remaining` largest remainders
  const results: CompetitorRatingOutput[] = []
  let totalDelta = 0

  for (let idx = 0; idx < intermediates.length; idx++) {
    const item = intermediates[idx]!
    const bonus = idx < remaining ? 1n : 0n
    const delta = Number(item.floorDelta + bonus)
    totalDelta += delta

    const newRating = item.c.rating + delta
    const maxRating = Math.max(item.c.maxRating, newRating)

    results.push({
      userId: item.userId,
      oldRating: item.c.rating,
      newRating,
      delta,
      maxRating,
      rawDelta: item.rawDelta,
    })
  }

  // Verify conservation of ratings (sum of integer deltas == 0)
  if (totalDelta !== 0) {
    throw new Error(`Rating zero-sum invariant broken: sum=${totalDelta}`)
  }

  return {
    isEligible: true,
    results,
  }
}
