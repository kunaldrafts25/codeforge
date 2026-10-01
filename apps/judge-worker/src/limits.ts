import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PracticePackage } from '@codeforge/shared'
import { CheckerFailure } from '@codeforge/checker-lib'
import { verifyBoundary } from './doctor.js'
import { judge } from './runner.js'
const verified = await verifyBoundary()
const p = PracticePackage.parse({
  title: 'Measured limit fixture',
  statementMd: 'Print ok.',
  constraints: 'Bounded acceptance fixture.',
  inputFormat: '',
  outputFormat: 'ok',
  difficultyBand: 'easy',
  tags: [],
  languages: ['python'],
  mode: 'STDIO',
  signature: null,
  limits: { timeMs: 2000, memoryKb: 16384, outputKb: 1 },
  checker: { kind: 'exact' },
  cases: [
    { input: '', output: 'ok\n', sample: true },
    { input: '', output: 'ok\n', sample: false },
  ],
  references: [{ language: 'python', code: "print('ok')", complexity: 'constant' }],
  rightsBasis: 'Original disposable acceptance fixture.',
})
for (const fixture of [
  { name: 'wrong-answer', source: "print('wrong')", expected: 'WRONG_ANSWER', timeMs: 2000 },
  {
    name: 'runtime-error',
    source: 'raise ValueError("candidate error")',
    expected: 'RUNTIME_ERROR',
    timeMs: 2000,
  },
  { name: 'cpu-limit', source: 'while True: pass', expected: 'TIME_LIMIT', timeMs: 200 },
  {
    name: 'wall-limit',
    source: 'import time; time.sleep(60)',
    expected: 'TIME_LIMIT',
    timeMs: 2000,
  },
  {
    name: 'measured-memory-limit',
    source: 'import time\na=[]\nwhile True:\n a.append(bytearray(4*1024*1024))\n time.sleep(.02)',
    expected: 'MEMORY_LIMIT',
    timeMs: 5000,
  },
  {
    name: 'output-limit',
    source: 'while True: print("x"*10000)',
    expected: 'OUTPUT_LIMIT',
    timeMs: 2000,
  },
]) {
  const result = await judge(
    verified.policy,
    { ...p, limits: { ...p.limits, timeMs: fixture.timeMs } },
    {
      id: `limits_${randomUUID()}`,
      kind: 'SUBMIT',
      language: 'python',
      source: fixture.source,
      input: null,
    }
  )
  assert.equal(result.verdict, fixture.expected, fixture.name)
  console.log(
    JSON.stringify({
      event: 'limits.passed',
      name: fixture.name,
      executed: true,
      verdict: result.verdict,
      timeMs: result.timeMs,
      memoryKb: result.memoryKb,
    })
  )
}
await assert.rejects(
  () =>
    judge(
      verified.policy,
      { ...p, checker: { kind: 'float', absolute: 0.01, relative: 0 } },
      {
        id: `checker_${randomUUID()}`,
        kind: 'SUBMIT',
        language: 'python',
        source: "print('ok')",
        input: null,
      }
    ),
  CheckerFailure
)
console.log(
  JSON.stringify({ event: 'checker.failure_visible', executed: true, mappedToWrongAnswer: false })
)
