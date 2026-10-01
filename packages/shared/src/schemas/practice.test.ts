import { describe, expect, it } from 'vitest'
import {
  PracticeJobBody,
  PracticePackage,
  PracticeSignature,
  validatePracticeValue,
} from './practice.js'
import { generateStarter } from '../admin/function-sig.js'

export const fixture = {
  title: 'Add numbers',
  statementMd: 'Add two integers.',
  constraints: '-100 to 100',
  inputFormat: 'Two integers',
  outputFormat: 'Sum',
  difficultyBand: 'easy',
  tags: ['math'],
  mode: 'STDIO',
  signature: null,
  languages: ['cpp', 'python', 'java', 'javascript'],
  limits: { timeMs: 1000, memoryKb: 262144, outputKb: 64 },
  checker: { kind: 'token', absolute: 0, relative: 0 },
  cases: [
    { input: '1 2', output: '3', sample: true, explanation: 'Addition' },
    { input: '-5 7', output: '2', sample: false, explanation: '' },
  ],
  references: [
    { language: 'python', code: 'print(sum(map(int,input().split())))', complexity: 'O(1)' },
  ],
  starters: {},
  hints: ['Add both'],
  editorial: 'Use addition.',
  rightsBasis: 'Original independently authored fixture.',
}
describe('phase two contracts', () => {
  it('refuses unsupported language, contest, unknown fields and unsafe signature identifiers', () => {
    const job = {
      problemId: 'a62a2f7d-9af7-49a6-a9d0-938c6d18bd68',
      language: 'cpp',
      code: 'code',
      idempotencyKey: 'f68b90ee-bff3-44e5-8c8b-3ea206c59f22',
    }
    expect(PracticeJobBody.safeParse(job).success).toBe(true)
    for (const extra of [
      { language: 'c' },
      { contestId: job.problemId },
      { codeBlobUrl: 'https://example.com' },
    ])
      expect(PracticeJobBody.safeParse({ ...job, ...extra }).success).toBe(false)
    const sig = { name: 'sumValues', params: [], returns: { kind: 'prim', name: 'int' } }
    for (const name of [
      'return',
      'namespace',
      'template',
      'lambda',
      'extends',
      'interface',
      '__proto__',
      'x); system(1)',
      'λ',
    ])
      expect(PracticeSignature.safeParse({ ...sig, name }).success).toBe(false)
    expect(generateStarter(PracticeSignature.parse(sig), 'python')).toContain('(self)')
    expect(() => generateStarter(PracticeSignature.parse(sig), 'c')).toThrow()
  })
  it('bounds precision, null, nesting, ragged matrices, unicode and empty values', () => {
    const prim = (name: 'int' | 'long' | 'double' | 'string') => ({ kind: 'prim' as const, name })
    expect(validatePracticeValue(prim('int'), 2147483648)).toBe(false)
    expect(validatePracticeValue(prim('long'), Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(validatePracticeValue(prim('long'), Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(validatePracticeValue(prim('double'), Infinity)).toBe(false)
    expect(validatePracticeValue(prim('string'), 'λ🙂')).toBe(true)
    expect(validatePracticeValue(prim('string'), '\uD800')).toBe(false)
    expect(validatePracticeValue(prim('string'), '')).toBe(true)
    expect(validatePracticeValue(prim('int'), null)).toBe(false)
    expect(validatePracticeValue({ kind: 'matrix', of: prim('int') }, [[1], []])).toBe(false)
    expect(validatePracticeValue({ kind: 'matrix', of: prim('int') }, [])).toBe(true)
    expect(
      PracticeSignature.safeParse({
        name: 'sumValues',
        params: [
          { name: 'a', type: prim('int') },
          { name: 'a', type: prim('int') },
        ],
        returns: prim('int'),
      }).success
    ).toBe(false)
  })
  it('requires both public/private cases, valid references, and typed function fixtures', () => {
    expect(PracticePackage.safeParse(fixture).success).toBe(true)
    expect(
      PracticePackage.safeParse({
        ...fixture,
        cases: fixture.cases.map(c => ({ ...c, sample: true })),
      }).success
    ).toBe(false)
    expect(
      PracticePackage.safeParse({ ...fixture, checker: { kind: 'spj', code: 'unsafe' } }).success
    ).toBe(false)
    const signature = {
      name: 'addValues',
      params: [
        { name: 'left', type: { kind: 'prim', name: 'int' } },
        { name: 'right', type: { kind: 'prim', name: 'int' } },
      ],
      returns: { kind: 'prim', name: 'int' },
    }
    const cases = fixture.cases.map(c => ({ ...c, input: '[1,2]', output: '3' }))
    expect(
      PracticePackage.safeParse({ ...fixture, mode: 'FUNCTIONAL', signature, cases }).success
    ).toBe(true)
    expect(
      PracticePackage.safeParse({
        ...fixture,
        mode: 'FUNCTIONAL',
        signature,
        cases: cases.map(c => ({ ...c, input: '[null,2]' })),
      }).success
    ).toBe(false)
  })
})
