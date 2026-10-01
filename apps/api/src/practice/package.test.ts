import { describe, expect, it } from 'vitest'
import { canonical, executionAvailability, hash, publicPackage } from './package.js'

describe('private package boundary', () => {
  it('hashes canonical object order while preserving case order', () => {
    expect(hash(canonical({ b: 2, a: 1 }))).toBe(hash(canonical({ a: 1, b: 2 })))
    expect(hash(canonical([1, 2]))).not.toBe(hash(canonical([2, 1])))
  })
  it('never projects hidden cases, reference code or rights evidence', () => {
    const p = {
      title: 'Add numbers',
      statementMd: 'Sum',
      constraints: 'Small',
      inputFormat: '',
      outputFormat: '',
      difficultyBand: 'easy',
      tags: [],
      mode: 'STDIO',
      signature: null,
      languages: ['python'],
      limits: { timeMs: 1000, memoryKb: 262144, outputKb: 64 },
      checker: { kind: 'token' },
      cases: [
        { input: 'PUBLIC_INPUT', output: 'PUBLIC_OUTPUT', sample: true },
        { input: 'PRIVATE_INPUT', output: 'PRIVATE_OUTPUT', sample: false },
      ],
      references: [{ language: 'python', code: 'PRIVATE_SOLUTION', complexity: 'O(1)' }],
      rightsBasis: 'PRIVATE_RIGHTS_EVIDENCE',
    }
    const text = JSON.stringify(publicPackage(p))
    expect(text).toContain('PUBLIC_INPUT')
    expect(text).not.toContain('PRIVATE_')
    expect(text).not.toContain('references')
  })
  it('cannot enable execution from an environment switch', async () => {
    process.env.JUDGE_ENABLED = 'true'
    expect((await executionAvailability()).enabled).toBe(false)
    delete process.env.JUDGE_ENABLED
  })
})
