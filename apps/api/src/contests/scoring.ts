export interface ContestSubmissionEvent {
  id: string
  userId: string
  problemLabel: string
  verdict: string | null
  state: string
  admittedAt: Date
  isAuthoritative?: boolean
}

export interface ProblemScoreResult {
  solved: boolean
  attempts: number
  penalty: number
  solveTimeMinutes: number | null
  isPending: boolean
}

export interface ScoreboardParticipantEntry {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  score: number
  penalty: number
  problemResults: Record<string, ProblemScoreResult>
  isDisqualified?: boolean
}

export interface ScoringOptions {
  startTime: Date
  freezeAt?: Date | null
  isPublic?: boolean
  problemLabels: string[]
  participants: {
    userId: string
    username: string
    displayName: string | null
    avatarUrl: string | null
    status?: string
  }[]
}

const PENALIZED_VERDICTS = new Set([
  'WRONG_ANSWER',
  'RUNTIME_ERROR',
  'TIME_LIMIT',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
])

export function computeScoreboard(
  submissions: ContestSubmissionEvent[],
  options: ScoringOptions
): { entries: ScoreboardParticipantEntry[]; isFrozen: boolean } {
  const { startTime, freezeAt, isPublic = true, problemLabels, participants } = options
  const isFrozen = isPublic && !!freezeAt

  // Group submissions by user and problem
  // Sort submissions by (admittedAt ASC, id ASC)
  const sortedSubs = [...submissions]
    .filter(s => s.isAuthoritative !== false)
    .sort((a, b) => {
      const timeDiff = a.admittedAt.getTime() - b.admittedAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id.localeCompare(b.id)
    })

  const subsByUserAndProblem = new Map<string, Map<string, ContestSubmissionEvent[]>>()
  for (const s of sortedSubs) {
    let userMap = subsByUserAndProblem.get(s.userId)
    if (!userMap) {
      userMap = new Map()
      subsByUserAndProblem.set(s.userId, userMap)
    }
    let list = userMap.get(s.problemLabel)
    if (!list) {
      list = []
      userMap.set(s.problemLabel, list)
    }
    list.push(s)
  }

  const entries: ScoreboardParticipantEntry[] = []

  for (const p of participants) {
    if (p.status === 'WITHDRAWN') continue

    const isDisqualified = p.status === 'DISQUALIFIED'
    let totalScore = 0
    let totalPenalty = 0
    const problemResults: Record<string, ProblemScoreResult> = {}

    const userProblems = subsByUserAndProblem.get(p.userId)

    for (const label of problemLabels) {
      const problemSubs = userProblems?.get(label) ?? []
      let solved = false
      let solveTimeMinutes: number | null = null
      let penalty = 0
      let earlierPenalized = 0
      let hasFrozenAttempts = false

      for (const sub of problemSubs) {
        const isPostFreeze = isFrozen && sub.admittedAt.getTime() >= freezeAt!.getTime()

        if (isPostFreeze) {
          hasFrozenAttempts = true
          continue // Exclude from public score/penalty
        }

        if (solved) {
          // Already solved before this attempt; subsequent attempts don't affect score or penalty
          continue
        }

        if (sub.verdict === 'ACCEPTED') {
          solved = true
          solveTimeMinutes = Math.floor((sub.admittedAt.getTime() - startTime.getTime()) / 60000)
          penalty = solveTimeMinutes + 20 * earlierPenalized
        } else if (sub.verdict && PENALIZED_VERDICTS.has(sub.verdict)) {
          earlierPenalized++
        }
        // COMPILATION_ERROR, JUDGE_FAILURE, SKIPPED, CANCELLED, PENDING do not add penalties
      }

      const totalAttempts = solved ? earlierPenalized + 1 : earlierPenalized

      if (solved && !isDisqualified) {
        totalScore += 1
        totalPenalty += penalty
      }

      problemResults[label] = {
        solved: isDisqualified ? false : solved,
        attempts: totalAttempts,
        penalty: solved && !isDisqualified ? penalty : 0,
        solveTimeMinutes: solved && !isDisqualified ? solveTimeMinutes : null,
        isPending: hasFrozenAttempts,
      }
    }

    // Zero solves -> penalty zero
    if (totalScore === 0 || isDisqualified) {
      totalPenalty = 0
    }

    entries.push({
      rank: 1, // Will be computed after sorting
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      score: isDisqualified ? 0 : totalScore,
      penalty: isDisqualified ? 0 : totalPenalty,
      problemResults,
      isDisqualified,
    })
  }

  // Sort participants:
  // 1. Non-disqualified before disqualified
  // 2. Score DESC
  // 3. Penalty ASC
  // 4. userId ASC (stable display tiebreak, does not affect rank)
  entries.sort((a, b) => {
    if (a.isDisqualified !== b.isDisqualified) {
      return a.isDisqualified ? 1 : -1
    }
    if (a.score !== b.score) {
      return b.score - a.score
    }
    if (a.penalty !== b.penalty) {
      return a.penalty - b.penalty
    }
    return a.userId.localeCompare(b.userId)
  })

  // Assign competition rank (1, 1, 3 etc.)
  let currentRank = 1
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.isDisqualified) {
      entry.rank = entries.length // Disqualified participants are ranked last
      continue
    }

    if (i > 0) {
      const prev = entries[i - 1]!
      if (!prev.isDisqualified && prev.score === entry.score && prev.penalty === entry.penalty) {
        entry.rank = prev.rank
      } else {
        entry.rank = currentRank
      }
    } else {
      entry.rank = 1
    }
    currentRank++
  }

  return { entries, isFrozen }
}
