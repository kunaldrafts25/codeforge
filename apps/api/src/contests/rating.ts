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
  const diff = (rj - ri) / 400

  if (diff >= 50) {
    return { e_ij: 0n, e_ji: SCALE }
  }
  if (diff <= -50) {
    return { e_ij: SCALE, e_ji: 0n }
  }

  const p = 1 / (1 + Math.pow(10, diff))
  // Quantize to 12 decimal places with round-half-up
  const scaled = Math.round(p * 1e12)
  const e_ij = BigInt(scaled)
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
