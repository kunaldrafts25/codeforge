import { prisma, practiceTransaction, type Prisma } from '@codeforge/db'
import { computeScoreboard, type ContestSubmissionEvent } from './scoring.js'
import { computePairwiseElo, type CompetitorRatingInput } from './rating.js'
import { canonical, hash } from '../practice/package.js'
import { conflict, notFound } from '../errors.js'

export async function finalizeContest(
  contestId: string,
  actorId: string,
  _idempotencyKey?: string
) {
  return practiceTransaction(prisma, async tx => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
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
                rating: true,
                maxRating: true,
                isBanned: true,
              },
            },
          },
        },
      },
    })

    if (!contest) {
      throw notFound('CONTEST_NOT_FOUND', 'Contest not found')
    }

    if (contest.status === 'FINALIZED') {
      // Idempotent: return existing finalized snapshot
      const snapshot = await tx.contestScoreboardSnapshot.findFirst({
        where: { contestId, isFrozen: false },
        orderBy: { revision: 'desc' },
      })
      return {
        contestId: contest.id,
        status: 'FINALIZED',
        isRated: contest.isRated,
        snapshot,
      }
    }

    if (contest.status === 'CANCELLED') {
      throw conflict('CONTEST_CANCELLED', 'Cancelled contest cannot be finalized')
    }

    if (contest.status === 'DRAFT') {
      throw conflict('CONTEST_DRAFT', 'Draft contest cannot be finalized')
    }

    const now = new Date()
    if (now < contest.endTime) {
      throw conflict('CONTEST_NOT_ENDED', 'Contest cannot be finalized before its end time')
    }

    // Check for pending / active submissions
    const pendingJobs = await tx.practiceJob.count({
      where: {
        contestId: contest.id,
        state: { in: ['QUEUED', 'COMPILING', 'RUNNING'] },
      },
    })
    if (pendingJobs > 0) {
      throw conflict(
        'PENDING_SUBMISSIONS',
        `Cannot finalize while ${pendingJobs} submissions are still being judged`
      )
    }

    // Check for unresolved infrastructure failures (DEAD_LETTER / JUDGE_FAILURE)
    const deadLetters = await tx.practiceJob.count({
      where: {
        contestId: contest.id,
        state: 'DEAD_LETTER',
      },
    })
    if (deadLetters > 0) {
      throw conflict(
        'UNRESOLVED_FAILURES',
        `Cannot finalize with ${deadLetters} unresolved judge failures. Rejudge or resolve before settlement.`
      )
    }

    // Check for unresolved blocking disputes
    const openDisputes = await tx.contestDispute.count({
      where: {
        contestId: contest.id,
        status: { in: ['OPEN', 'INVESTIGATING'] },
      },
    })
    if (openDisputes > 0) {
      throw conflict(
        'OPEN_DISPUTES',
        `Cannot finalize while ${openDisputes} disputes remain open or under investigation`
      )
    }

    // If rated: enforce serialization order
    // Check if an earlier scheduled/running/ended rated contest is not finalized
    if (contest.isRated) {
      const earlierUnsettled = await tx.contest.findFirst({
        where: {
          isRated: true,
          status: { in: ['SCHEDULED', 'RUNNING', 'ENDED'] },
          OR: [
            { endTime: { lt: contest.endTime } },
            { endTime: contest.endTime, id: { lt: contest.id } },
          ],
        },
        orderBy: [{ endTime: 'asc' }, { id: 'asc' }],
      })

      if (earlierUnsettled) {
        throw conflict(
          'EARLIER_CONTEST_UNSETTLED',
          `Cannot finalize rated contest ${contest.slug} because earlier rated contest ${earlierUnsettled.slug} is unsettled`
        )
      }
    }

    // Load manifest problems
    const manifestProblems = (contest.activeManifest?.problems ?? []) as {
      label: string
      orderIndex: number
      problemId: string
      points: number
    }[]
    const problemLabels = manifestProblems.map(p => p.label)

    // Load all authoritative contest submissions
    const submissions = await tx.contestSubmission.findMany({
      where: {
        contestId: contest.id,
        isAuthoritative: true,
      },
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

    // Compute live final scoreboard
    const { entries: finalEntries } = computeScoreboard(submissions as ContestSubmissionEvent[], {
      startTime: contest.startTime,
      isPublic: false,
      problemLabels,
      participants: participantsInput,
    })

    // Compute frozen scoreboard for historical record if freeze was configured
    let frozenEntries: typeof finalEntries | null = null
    if (contest.freezeAt) {
      const res = computeScoreboard(submissions as ContestSubmissionEvent[], {
        startTime: contest.startTime,
        freezeAt: contest.freezeAt,
        isPublic: true,
        problemLabels,
        participants: participantsInput,
      })
      frozenEntries = res.entries
    }

    // Save final scoreboard snapshot
    const finalPayload = finalEntries
    const finalChecksum = hash(canonical(finalPayload))
    await tx.contestScoreboardSnapshot.create({
      data: {
        contestId: contest.id,
        revision: 1,
        isFrozen: false,
        asOfTime: now,
        payload: finalPayload as unknown as Prisma.InputJsonValue,
        checksum: finalChecksum,
      },
    })

    if (frozenEntries) {
      await tx.contestScoreboardSnapshot.create({
        data: {
          contestId: contest.id,
          revision: 1,
          isFrozen: true,
          asOfTime: contest.freezeAt!,
          payload: frozenEntries as unknown as Prisma.InputJsonValue,
          checksum: hash(canonical(frozenEntries)),
        },
      })
    }

    // Update participant scores in ContestParticipant table
    for (const entry of finalEntries) {
      await tx.contestParticipant.update({
        where: {
          contestId_userId: { contestId: contest.id, userId: entry.userId },
        },
        data: {
          score: entry.score,
          penalty: entry.penalty,
          rank: entry.rank,
          problemStates: entry.problemResults as unknown as Prisma.InputJsonValue,
        },
      })
    }

    // Compute Ratings if rated
    let ratingResults: {
      userId: string
      oldRating: number
      newRating: number
      delta: number
      maxRating: number
    }[] = []

    if (contest.isRated) {
      // Find rating-eligible competitors
      const eligibleInputs: CompetitorRatingInput[] = []

      for (const entry of finalEntries) {
        if (entry.isDisqualified) continue

        // Check if candidate has at least one deterministic verdict attempt
        const userSubs = submissions.filter(s => s.userId === entry.userId)
        const hasDeterministic = userSubs.some(
          s =>
            s.verdict &&
            [
              'ACCEPTED',
              'WRONG_ANSWER',
              'RUNTIME_ERROR',
              'TIME_LIMIT',
              'MEMORY_LIMIT',
              'OUTPUT_LIMIT',
              'COMPILATION_ERROR',
            ].includes(s.verdict)
        )

        // Get user's rating prior to this contest from latest authoritative ledger entry
        const priorLedger = await tx.contestRatingLedger.findFirst({
          where: {
            userId: entry.userId,
            isAuthoritative: true,
            contest: {
              OR: [
                { endTime: { lt: contest.endTime } },
                { endTime: contest.endTime, id: { lt: contest.id } },
              ],
            },
          },
          orderBy: [{ contest: { endTime: 'desc' } }, { contest: { id: 'desc' } }],
        })

        const currentRating = priorLedger ? priorLedger.newRating : 1500
        const pUser = contest.participants.find(p => p.userId === entry.userId)?.user
        const maxRating = Math.max(pUser?.maxRating ?? 1500, currentRating)

        eligibleInputs.push({
          userId: entry.userId,
          rating: currentRating,
          maxRating,
          solves: entry.score,
          penalty: entry.penalty,
          hasDeterministicVerdict: hasDeterministic,
        })
      }

      const eloResult = computePairwiseElo(eligibleInputs)

      if (eloResult.isEligible) {
        const manifestHash = contest.activeManifest?.manifestHash ?? hash(contest.id)
        const scoringHash = finalChecksum

        for (const out of eloResult.results) {
          const entry = finalEntries.find(e => e.userId === out.userId)
          const rank = entry?.rank ?? 1

          await tx.contestRatingLedger.create({
            data: {
              generation: 1,
              contestId: contest.id,
              userId: out.userId,
              oldRating: out.oldRating,
              newRating: out.newRating,
              delta: out.delta,
              rank,
              isAuthoritative: true,
              manifestHash,
              scoringHash,
            },
          })

          // Update user rating projection
          await tx.user.update({
            where: { id: out.userId },
            data: {
              rating: out.newRating,
              maxRating: out.maxRating,
              contestsCount: { increment: 1 },
              lastContestAt: contest.endTime,
            },
          })
        }

        ratingResults = eloResult.results
      }
    }

    // Set contest status to FINALIZED
    await tx.contest.update({
      where: { id: contest.id },
      data: { status: 'FINALIZED' },
    })

    // Record audit log
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'contest.finalize',
        target: contest.id,
        payload: {
          contestId: contest.id,
          participantsCount: finalEntries.length,
          rated: contest.isRated,
          ratingsAwarded: ratingResults.length > 0,
          scoringChecksum: finalChecksum,
        },
      },
    })

    return {
      contestId: contest.id,
      status: 'FINALIZED',
      isRated: contest.isRated,
      participantsCount: finalEntries.length,
      ratingsCount: ratingResults.length,
    }
  })
}

/**
 * Replays all rated contests chronologically starting from `fromContestId`.
 * Updates all dependent users (including participants in subsequent contests).
 */
export async function replayChronologicalContests(
  fromContestId: string,
  actorId: string,
  reason: string,
  _idempotencyKey?: string
) {
  return practiceTransaction(prisma, async tx => {
    const rootContest = await tx.contest.findUniqueOrThrow({
      where: { id: fromContestId },
    })

    if (!rootContest.isRated) {
      throw conflict('NOT_RATED', 'Replay only applies to rated contests')
    }

    // Find the next global ledger generation
    const maxGenAgg = await tx.contestRatingLedger.aggregate({
      _max: { generation: true },
    })
    const nextGeneration = (maxGenAgg._max.generation ?? 1) + 1

    // Find all rated finalized contests in chronological order (endTime ASC, id ASC)
    // starting from rootContest
    const chain = await tx.contest.findMany({
      where: {
        isRated: true,
        status: 'FINALIZED',
        OR: [
          { endTime: { gt: rootContest.endTime } },
          { endTime: rootContest.endTime, id: { gte: rootContest.id } },
        ],
      },
      orderBy: [{ endTime: 'asc' }, { id: 'asc' }],
      include: {
        activeManifest: true,
        participants: {
          include: {
            user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    })

    // Simulated ledger state for tracking users' rating during replay
    // userId -> { currentRating, maxRating, contestsCount }
    const simRatings = new Map<string, { rating: number; maxRating: number; count: number }>()

    const allAffectedUsers = new Set<string>()

    for (const c of chain) {
      const manifestProblems = (c.activeManifest?.problems ?? []) as { label: string }[]
      const problemLabels = manifestProblems.map(p => p.label)

      const submissions = await tx.contestSubmission.findMany({
        where: { contestId: c.id, isAuthoritative: true },
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

      const participantsInput = c.participants.map(p => ({
        userId: p.userId,
        username: p.user.username,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        status: p.status,
      }))

      const { entries: finalEntries } = computeScoreboard(submissions as ContestSubmissionEvent[], {
        startTime: c.startTime,
        isPublic: false,
        problemLabels,
        participants: participantsInput,
      })

      // Collect eligible inputs using simulated prefix
      const eligibleInputs: CompetitorRatingInput[] = []

      for (const entry of finalEntries) {
        if (entry.isDisqualified) continue

        const userSubs = submissions.filter(s => s.userId === entry.userId)
        const hasDeterministic = userSubs.some(
          s =>
            s.verdict &&
            [
              'ACCEPTED',
              'WRONG_ANSWER',
              'RUNTIME_ERROR',
              'TIME_LIMIT',
              'MEMORY_LIMIT',
              'OUTPUT_LIMIT',
              'COMPILATION_ERROR',
            ].includes(s.verdict)
        )

        allAffectedUsers.add(entry.userId)

        let userSim = simRatings.get(entry.userId)
        if (!userSim) {
          // Find pre-replay authoritative rating before the root contest
          const prior = await tx.contestRatingLedger.findFirst({
            where: {
              userId: entry.userId,
              isAuthoritative: true,
              contest: {
                OR: [
                  { endTime: { lt: rootContest.endTime } },
                  { endTime: rootContest.endTime, id: { lt: rootContest.id } },
                ],
              },
            },
            orderBy: [{ contest: { endTime: 'desc' } }, { contest: { id: 'desc' } }],
          })
          const initRating = prior ? prior.newRating : 1500
          userSim = { rating: initRating, maxRating: initRating, count: prior ? 1 : 0 }
          simRatings.set(entry.userId, userSim)
        }

        eligibleInputs.push({
          userId: entry.userId,
          rating: userSim.rating,
          maxRating: userSim.maxRating,
          solves: entry.score,
          penalty: entry.penalty,
          hasDeterministicVerdict: hasDeterministic,
        })
      }

      const eloResult = computePairwiseElo(eligibleInputs)

      if (eloResult.isEligible) {
        const manifestHash = c.activeManifest?.manifestHash ?? hash(c.id)
        const scoringHash = hash(canonical(finalEntries))

        for (const out of eloResult.results) {
          const entry = finalEntries.find(e => e.userId === out.userId)
          const rank = entry?.rank ?? 1

          // Insert staged new generation entry
          await tx.contestRatingLedger.create({
            data: {
              generation: nextGeneration,
              contestId: c.id,
              userId: out.userId,
              oldRating: out.oldRating,
              newRating: out.newRating,
              delta: out.delta,
              rank,
              isAuthoritative: false, // staged
              manifestHash,
              scoringHash,
            },
          })

          // Update simRatings
          const userSim = simRatings.get(out.userId)!
          userSim.rating = out.newRating
          userSim.maxRating = Math.max(userSim.maxRating, out.newRating)
          userSim.count += 1
        }
      }
    }

    // Atomically swap authoritative generation for the replayed contests
    const chainIds = chain.map(c => c.id)

    // Mark old generations as non-authoritative
    await tx.contestRatingLedger.updateMany({
      where: {
        contestId: { in: chainIds },
        isAuthoritative: true,
      },
      data: { isAuthoritative: false },
    })

    // Mark new generation as authoritative
    await tx.contestRatingLedger.updateMany({
      where: {
        contestId: { in: chainIds },
        generation: nextGeneration,
      },
      data: { isAuthoritative: true },
    })

    // Update User tables for all affected users from their authoritative ledger history
    for (const userId of allAffectedUsers) {
      const latest = await tx.contestRatingLedger.findFirst({
        where: { userId, isAuthoritative: true },
        include: { contest: true },
        orderBy: [{ contest: { endTime: 'desc' } }, { contest: { id: 'desc' } }],
      })

      const maxAgg = await tx.contestRatingLedger.aggregate({
        where: { userId, isAuthoritative: true },
        _max: { newRating: true },
      })

      const totalContests = await tx.contestRatingLedger.count({
        where: { userId, isAuthoritative: true },
      })

      if (latest) {
        const finalMax = Math.max(1500, maxAgg._max.newRating ?? 1500)
        await tx.user.update({
          where: { id: userId },
          data: {
            rating: latest.newRating,
            maxRating: finalMax,
            contestsCount: totalContests,
            lastContestAt: latest.contest.endTime,
          },
        })
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'contest.correction.replay',
        target: rootContest.id,
        payload: {
          rootContestId: rootContest.id,
          replayedContestsCount: chain.length,
          generation: nextGeneration,
          affectedUsersCount: allAffectedUsers.size,
          reason,
        },
      },
    })

    return {
      rootContestId: rootContest.id,
      replayedContestsCount: chain.length,
      generation: nextGeneration,
      affectedUsersCount: allAffectedUsers.size,
    }
  })
}
