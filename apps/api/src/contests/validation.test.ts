import { describe, expect, it, vi } from 'vitest'
import type { Prisma, PracticeVersion } from '@codeforge/db'
import { PracticePackage } from '@codeforge/shared'
import { assertContestVersionValidated } from './validation.js'
import { canonical, hash } from '../practice/package.js'

const policy = { engine: 'gvisor', version: 'pinned-test-policy' }
const policyHash = hash(canonical(policy))
const pkg = PracticePackage.parse({
  title: 'Fixture Addition',
  statementMd: 'Print the number.',
  constraints: '0 <= n <= 2',
  inputFormat: 'One number',
  outputFormat: 'The same number',
  difficultyBand: 'easy',
  tags: [],
  mode: 'STDIO',
  signature: null,
  languages: ['python'],
  limits: { timeMs: 1000, memoryKb: 65536, outputKb: 16 },
  checker: { kind: 'exact' },
  cases: [
    { input: '1\n', output: '1\n', sample: true },
    { input: '2\n', output: '2\n', sample: false },
  ],
  references: [{ language: 'python', code: 'print(input())', complexity: 'O(1)' }],
  rightsBasis: 'Original disposable test fixture',
})
const packageHash = hash(canonical(pkg))
const version = {
  id: 'version',
  status: 'VALIDATED',
  withdrawnAt: null,
  package: pkg,
  packageHash,
  validation: { executed: true, packageHash, policyHash, jobs: ['validation-job'] },
} as unknown as PracticeVersion
const job = {
  id: 'validation-job',
  language: 'python',
  sourceHash: hash('print(input())'),
  policy: { ...policy, packageHash },
  privateResult: { executed: true },
}
const database = (jobs: unknown[]) => ({
  practiceJob: { findMany: vi.fn().mockResolvedValue(jobs) },
})
const validate = (db: ReturnType<typeof database>, v = version, p = policyHash) =>
  assertContestVersionValidated(db as unknown as Prisma.TransactionClient, v, p)

describe('contest package validation evidence', () => {
  it('requires exact persisted reference-job evidence and current policy', async () => {
    const db = database([job])
    await expect(validate(db)).resolves.toBeUndefined()
    expect(db.practiceJob.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['validation-job'] },
        versionId: 'version',
        kind: 'VALIDATE',
        scope: 'PRACTICE',
        state: 'TERMINAL',
        verdict: 'ACCEPTED',
      },
    })
  })
  it('rejects a JSON passed flag without worker evidence', async () => {
    await expect(
      validate(database([]), { ...version, validation: { passed: true } })
    ).rejects.toThrow(/exact package and policy/)
  })
  it('rejects stale execution policy and substituted package hashes', async () => {
    await expect(validate(database([job]), version, 'different-policy')).rejects.toThrow(
      /exact package and policy/
    )
    await expect(
      validate(database([job]), { ...version, package: { ...pkg, title: 'Changed package' } })
    ).rejects.toThrow(/package hash is invalid/)
  })
  it('rejects missing jobs, unexecuted jobs, substituted references and wrong job policy', async () => {
    for (const jobs of [
      [],
      [{ ...job, privateResult: { executed: false } }],
      [{ ...job, sourceHash: hash('incorrect reference') }],
      [{ ...job, policy: { ...policy, packageHash: 'another-package' } }],
    ]) {
      await expect(validate(database(jobs))).rejects.toThrow(/job evidence is incomplete/)
    }
  })
})
