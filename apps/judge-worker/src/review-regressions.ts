import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Admin, PRACTICE_LANGUAGES, PracticePackage, PracticeSignature } from '@codeforge/shared'
import { verifyBoundary } from './doctor.js'
import { canonical, digest, judge } from './runner.js'

const verified = await verifyBoundary()
const findings: Record<string, unknown>[] = []
const base = {
  title: 'Original review regression fixture',
  statementMd: 'Return the value.',
  constraints: 'Disposable original fixtures.',
  inputFormat: 'JSON arguments',
  outputFormat: 'JSON result',
  difficultyBand: 'easy',
  tags: [],
  mode: 'FUNCTIONAL',
  languages: [...PRACTICE_LANGUAGES],
  limits: { timeMs: 2000, memoryKb: 131072, outputKb: 16 },
  checker: { kind: 'exact', absolute: 0, relative: 0 },
  rightsBasis: 'Original disposable independent review regression fixtures.',
}
async function check(p: unknown, language: string, source: string, expected: string, name: string) {
  const result = await judge(verified.policy, p, {
    id: `review_${randomUUID()}`,
    kind: 'SUBMIT',
    language,
    source,
    input: null,
  })
  assert.equal(
    result.verdict,
    expected,
    `${name}/${language}: ${JSON.stringify(result.privateEvidence.compile)}`
  )
  const finding = {
    name,
    language,
    verdict: result.verdict,
    timeMs: result.timeMs,
    memoryKb: result.memoryKb,
  }
  findings.push(finding)
  console.log(JSON.stringify({ event: 'review.regression_passed', executed: true, ...finding }))
}
for (const name of [
  'require',
  'JSON',
  'process',
  'forgeArgs',
  'forgeResult',
  'module',
  'Json',
  'Main',
]) {
  const sig = { name, params: [], returns: { kind: 'prim' as const, name: 'int' as const } }
  assert.equal(PracticeSignature.safeParse(sig).success, false)
  for (const language of PRACTICE_LANGUAGES)
    assert.throws(() => Admin.generateStarter(sig, language))
}
for (const name of [
  'a',
  'requireValue',
  'JSONValue',
  'processValue',
  'forgeArgsValue',
  'Z'.repeat(64),
]) {
  const sig = PracticeSignature.parse({
    name,
    params: [{ name: 'value', type: { kind: 'prim', name: 'int' } }],
    returns: { kind: 'prim', name: 'int' },
  })
  for (const language of PRACTICE_LANGUAGES) {
    const starter = Admin.generateStarter(sig, language)
    const p = PracticePackage.parse({
      ...base,
      signature: sig,
      cases: [
        { input: '[5]', output: '5', sample: true },
        { input: '[-8]', output: '-8', sample: false },
      ],
      references: [
        { language, code: starter.replace(/return [^;\n]+/, 'return value'), complexity: 'O(1)' },
      ],
    })
    await check(p, language, p.references[0]!.code, 'ACCEPTED', `boundary-reference-${name}`)
    // Genuine generated starter execution, with its documented default return.
    await check(
      { ...p, cases: p.cases.map(c => ({ ...c, output: '0' })) },
      language,
      starter,
      'ACCEPTED',
      `boundary-starter-${name}`
    )
  }
}
const sig = PracticeSignature.parse({
  name: 'echo',
  params: [],
  returns: { kind: 'prim', name: 'double' },
})
const source = (language: string, value: string) =>
  ({
    cpp: `class Solution{public:double echo(){return ${value};}};`,
    python: `class Solution:\n def echo(self):\n  return ${value}`,
    java: `class Solution{public double echo(){return ${value};}}`,
    javascript: `function echo(){return ${value};}`,
  })[language]!
for (const language of PRACTICE_LANGUAGES) {
  for (const kind of ['exact', 'token', 'float']) {
    const checker = { kind, absolute: kind === 'float' ? 0.1 : 0, relative: 0 }
    const p = PracticePackage.parse({
      ...base,
      signature: sig,
      checker,
      cases: [
        { input: '[]', output: '1', sample: true },
        { input: '[]', output: '1', sample: false },
      ],
      references: [{ language, code: source(language, '1.0'), complexity: 'O(1)' }],
    })
    await check(p, language, source(language, '1.0'), 'ACCEPTED', `${kind}-same-double`)
    await check(
      p,
      language,
      source(language, '1.05'),
      kind === 'float' ? 'ACCEPTED' : 'WRONG_ANSWER',
      `${kind}-near-double`
    )
    await check(p, language, source(language, '1.2'), 'WRONG_ANSWER', `${kind}-outside-double`)
  }
  for (const kind of ['exact', 'token'])
    for (const field of ['absolute', 'relative'])
      await assert.rejects(() =>
        judge(
          verified.policy,
          {
            ...base,
            signature: sig,
            checker: { kind, [field]: 0.1 },
            cases: [
              { input: '[]', output: '1', sample: true },
              { input: '[]', output: '1', sample: false },
            ],
            references: [{ language, code: source(language, '1.05'), complexity: 'O(1)' }],
          },
          {
            id: `rejected_${randomUUID()}`,
            kind: 'SUBMIT',
            language,
            source: source(language, '1.05'),
            input: null,
          }
        )
      )
}
console.log(
  JSON.stringify({
    event: 'review.regressions_passed',
    executed: true,
    count: findings.length,
    findingsHash: digest(canonical(findings)),
    policy: verified.policy,
  })
)
