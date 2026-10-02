import { describe, it, expect } from 'vitest'
import { computeManifestHash } from './manifest.js'

describe('Contest Manifest Hashing', () => {
  const baseInput = {
    contestId: '11111111-1111-1111-1111-111111111111',
    revision: 1,
    title: 'CodeForge ICPC Round 1',
    slug: 'codeforge-round-1',
    description: 'First official contest',
    startTime: '2026-10-10T12:00:00.000Z',
    endTime: '2026-10-10T17:00:00.000Z',
    registrationOpensAt: '2026-10-01T00:00:00.000Z',
    registrationClosesAt: '2026-10-10T12:00:00.000Z',
    freezeAt: '2026-10-10T16:00:00.000Z',
    capacity: 1000,
    isRated: true,
    divisionMin: 0,
    divisionMax: 2100,
    scoringPolicy: 'icpc-binary-v1',
    ratingPolicy: 'codeforge-pairwise-elo-v1',
    problems: [
      {
        label: 'A',
        orderIndex: 0,
        problemId: '22222222-2222-2222-2222-222222222222',
        versionId: '33333333-3333-3333-3333-333333333333',
        packageHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        points: 1,
        title: 'Two Sum',
      },
      {
        label: 'B',
        orderIndex: 1,
        problemId: '44444444-4444-4444-4444-444444444444',
        versionId: '55555555-5555-5555-5555-555555555555',
        packageHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        points: 1,
        title: 'Graph Cycle',
      },
    ],
    runtimePolicyHash: 'policy:gvisor-strict-v1',
  }

  it('computes a stable sha256 hash', () => {
    const hash1 = computeManifestHash(baseInput)
    const hash2 = computeManifestHash(baseInput)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces different hash if problem package hash changes', () => {
    const originalHash = computeManifestHash(baseInput)
    const modifiedInput = {
      ...baseInput,
      problems: [
        {
          ...baseInput.problems[0]!,
          packageHash: 'sha256:changedhash11111111111111111111111111111111111111111111111111111',
        },
        baseInput.problems[1]!,
      ],
    }
    const modifiedHash = computeManifestHash(modifiedInput)
    expect(modifiedHash).not.toBe(originalHash)
  })

  it('produces different hash if freeze time changes', () => {
    const originalHash = computeManifestHash(baseInput)
    const modifiedInput = {
      ...baseInput,
      freezeAt: '2026-10-10T16:30:00.000Z',
    }
    const modifiedHash = computeManifestHash(modifiedInput)
    expect(modifiedHash).not.toBe(originalHash)
  })

  it('produces different hash if problem order changes', () => {
    const originalHash = computeManifestHash(baseInput)
    const reversedProblemsInput = {
      ...baseInput,
      problems: [baseInput.problems[1]!, baseInput.problems[0]!],
    }
    const reversedHash = computeManifestHash(reversedProblemsInput)
    expect(reversedHash).not.toBe(originalHash)
  })
})
