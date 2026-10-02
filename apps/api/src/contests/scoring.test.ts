import { describe, expect, it } from 'vitest'
import { computeScoreboard, type ContestSubmissionEvent } from './scoring.js'

describe('ICPC Binary Scoring icpc-binary-v1', () => {
  const start = new Date('2026-10-02T10:00:00Z')
  const freeze = new Date('2026-10-02T10:45:00Z')

  it('Golden scoring example: candidates A, B, C matching exact specification', () => {
    const participants = [
      { userId: 'user-a', username: 'alice', displayName: 'Alice', avatarUrl: null },
      { userId: 'user-b', username: 'bob', displayName: 'Bob', avatarUrl: null },
      { userId: 'user-c', username: 'charlie', displayName: 'Charlie', avatarUrl: null },
    ]

    const submissions: ContestSubmissionEvent[] = [
      // Alice on Problem P
      {
        id: 'sub-a1',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'WRONG_ANSWER',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:05:00Z'),
      },
      {
        id: 'sub-a2',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'COMPILATION_ERROR',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:07:00Z'),
      },
      {
        id: 'sub-a3',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:12:00Z'),
      },
      {
        id: 'sub-a4',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:20:00Z'),
      },

      // Bob on Problem P
      {
        id: 'sub-b1',
        userId: 'user-b',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:32:00Z'),
      },

      // Charlie on Problem P (3 wrong attempts, unsolved)
      {
        id: 'sub-c1',
        userId: 'user-c',
        problemLabel: 'P',
        verdict: 'WRONG_ANSWER',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:10:00Z'),
      },
      {
        id: 'sub-c2',
        userId: 'user-c',
        problemLabel: 'P',
        verdict: 'TIME_LIMIT',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:20:00Z'),
      },
      {
        id: 'sub-c3',
        userId: 'user-c',
        problemLabel: 'P',
        verdict: 'RUNTIME_ERROR',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:30:00Z'),
      },
    ]

    const { entries } = computeScoreboard(submissions, {
      startTime: start,
      isPublic: true,
      problemLabels: ['P'],
      participants,
    })

    expect(entries.length).toBe(3)

    const alice = entries.find(e => e.userId === 'user-a')!
    const bob = entries.find(e => e.userId === 'user-b')!
    const charlie = entries.find(e => e.userId === 'user-c')!

    // Alice: 1 solve, penalty 12 + 20 = 32
    expect(alice.score).toBe(1)
    expect(alice.penalty).toBe(32)
    expect(alice.problemResults['P']?.solved).toBe(true)
    expect(alice.problemResults['P']?.penalty).toBe(32)

    // Bob: 1 solve, penalty 32
    expect(bob.score).toBe(1)
    expect(bob.penalty).toBe(32)
    expect(bob.problemResults['P']?.solved).toBe(true)
    expect(bob.problemResults['P']?.penalty).toBe(32)

    // Alice and Bob share rank 1!
    expect(alice.rank).toBe(1)
    expect(bob.rank).toBe(1)

    // Charlie: 0 solves, 0 penalty
    expect(charlie.score).toBe(0)
    expect(charlie.penalty).toBe(0)
    expect(charlie.problemResults['P']?.solved).toBe(false)
    expect(charlie.problemResults['P']?.penalty).toBe(0)
    expect(charlie.rank).toBe(3) // Shared rank 1, 1, then rank 3
  })

  it('Scoreboard freeze excludes attempts at or after freezeAt from public views', () => {
    const participants = [
      { userId: 'user-a', username: 'alice', displayName: 'Alice', avatarUrl: null },
      { userId: 'user-b', username: 'bob', displayName: 'Bob', avatarUrl: null },
    ]

    const submissions: ContestSubmissionEvent[] = [
      // Alice solved before freeze
      {
        id: 'sub-a1',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:15:00Z'), // before freeze (10:45)
      },
      // Bob submitted at 10:50 (after freeze) and got ACCEPTED
      {
        id: 'sub-b1',
        userId: 'user-b',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:50:00Z'),
      },
    ]

    // Public scoreboard during freeze
    const publicBoard = computeScoreboard(submissions, {
      startTime: start,
      freezeAt: freeze,
      isPublic: true,
      problemLabels: ['P'],
      participants,
    })

    const publicAlice = publicBoard.entries.find(e => e.userId === 'user-a')!
    const publicBob = publicBoard.entries.find(e => e.userId === 'user-b')!

    expect(publicAlice.score).toBe(1)
    expect(publicBob.score).toBe(0) // Frozen!
    expect(publicBob.problemResults['P']?.isPending).toBe(true) // Has frozen attempt marker
    expect(publicBob.problemResults['P']?.solved).toBe(false) // Does not reveal solved state

    // Live / staff scoreboard sees all verdicts
    const staffBoard = computeScoreboard(submissions, {
      startTime: start,
      freezeAt: freeze,
      isPublic: false,
      problemLabels: ['P'],
      participants,
    })

    const staffBob = staffBoard.entries.find(e => e.userId === 'user-b')!
    expect(staffBob.score).toBe(1)
    expect(staffBob.problemResults['P']?.solved).toBe(true)
  })

  it('Late arrival of pre-freeze verdict correctly updates pre-freeze result', () => {
    const participants = [
      { userId: 'user-a', username: 'alice', displayName: 'Alice', avatarUrl: null },
    ]

    // Alice submitted at 10:30 (before freeze 10:45)
    const submissions: ContestSubmissionEvent[] = [
      {
        id: 'sub-a1',
        userId: 'user-a',
        problemLabel: 'P',
        verdict: 'ACCEPTED',
        state: 'TERMINAL',
        admittedAt: new Date('2026-10-02T10:30:00Z'),
      },
    ]

    const res = computeScoreboard(submissions, {
      startTime: start,
      freezeAt: freeze,
      isPublic: true,
      problemLabels: ['P'],
      participants,
    })

    const alice = res.entries[0]
    expect(alice.score).toBe(1)
    expect(alice.penalty).toBe(30)
  })
})
