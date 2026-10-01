import assert from 'node:assert/strict'
import {
  PracticePackage,
  Admin,
  type PracticeSignature,
  type PracticeType,
} from '@codeforge/shared'
import { verifyBoundary } from './doctor.js'
import { judge, digest, canonical } from './runner.js'

const verified = await verifyBoundary()
const findings: Record<string, unknown>[] = []
const base = {
  title: 'Disposable identity fixture',
  statementMd: 'Return the supplied value.',
  constraints: 'Bounded fixture',
  inputFormat: 'stdin',
  outputFormat: 'stdout',
  difficultyBand: 'easy',
  tags: [],
  languages: ['cpp', 'python', 'java', 'javascript'],
  limits: { timeMs: 2000, memoryKb: 131072, outputKb: 16 },
  checker: { kind: 'token', absolute: 0, relative: 0 },
  starters: {},
  hints: [],
  editorial: '',
  rightsBasis: 'Original disposable acceptance fixture.',
}
const stdio: Record<string, string> = {
  cpp: '#include <iostream>\nint main(){long long v;std::cin>>v;std::cout<<v;}',
  python: 'print(input())',
  java: 'public class Main{public static void main(String[] a){System.out.print(new java.util.Scanner(System.in).nextLine());}}',
  javascript: 'process.stdout.write(require("fs").readFileSync(0,"utf8"))',
}
const identity: Record<string, string> = {
  cpp: 'class Solution{public:long long echo(long long value){return value;}};',
  python: 'class Solution:\n def echo(self,value):\n  return value',
  java: 'class Solution{public long echo(long value){return value;}}',
  javascript: 'function echo(value){return value;}',
}
const runtimeErrors: Record<string, string> = {
  cpp: 'int main(){throw 1;}',
  python: 'raise RuntimeError("candidate error")',
  java: 'public class Main{public static void main(String[] a){throw new RuntimeException("candidate error");}}',
  javascript: 'throw new Error("candidate error")',
}
const functionalErrors: Record<string, string> = {
  cpp: 'class Solution{public:long long echo(long long value){throw 1;}};',
  python: 'class Solution:\n def echo(self,value):\n  raise RuntimeError("candidate error")',
  java: 'class Solution{public long echo(long value){throw new RuntimeException("candidate error");}}',
  javascript: 'function echo(value){throw new Error("candidate error")}',
}
const signature: PracticeSignature = {
  name: 'echo',
  params: [{ name: 'value', type: { kind: 'prim', name: 'long' } }],
  returns: { kind: 'prim', name: 'long' },
}
let sequence = 0
async function check(p: unknown, language: string, source: string, expected: string, name: string) {
  const result = await judge(verified.policy, p, {
    id: `integration_${++sequence}`,
    kind: 'SUBMIT',
    language,
    source,
    input: null,
  })
  findings.push({
    name,
    language,
    verdict: result.verdict,
    timeMs: result.timeMs,
    memoryKb: result.memoryKb,
  })
  assert.equal(
    result.verdict,
    expected,
    `${name}/${language}: ${JSON.stringify(result.privateEvidence.compile)}`
  )
  console.log(JSON.stringify(findings.at(-1)))
}
for (const language of base.languages) {
  const p = PracticePackage.parse({
    ...base,
    mode: 'STDIO',
    signature: null,
    cases: [
      { input: '-42\n', output: '-42', sample: true },
      { input: '9007199254740991\n', output: '9007199254740991', sample: false },
    ],
    references: [{ language, code: stdio[language], complexity: 'constant' }],
  })
  await check(p, language, stdio[language]!, 'ACCEPTED', 'stdio-correct')
  const incorrect = {
    cpp: '#include <iostream>\nint main(){std::cout<<0;}',
    python: 'print(0)',
    java: 'public class Main{public static void main(String[] a){System.out.print(0);}}',
    javascript: 'console.log(0)',
  }[language]!
  await check(p, language, incorrect, 'WRONG_ANSWER', 'stdio-incorrect')
  await check(p, language, runtimeErrors[language]!, 'RUNTIME_ERROR', 'stdio-runtime-error')
  await check(
    p,
    language,
    stdio[language]!.replace(/42/g, '41') +
      {
        cpp: '\n#error deliberate',
        python: '\nthis is invalid syntax ???',
        java: '\ninvalid ???',
        javascript: '\n???',
      }[language],
    'COMPILATION_ERROR',
    'syntax-error'
  )
  const f = PracticePackage.parse({
    ...base,
    mode: 'FUNCTIONAL',
    signature,
    cases: [
      { input: '[-9007199254740991]', output: '-9007199254740991', sample: true },
      { input: '[9007199254740991]', output: '9007199254740991', sample: false },
    ],
    references: [{ language, code: identity[language], complexity: 'constant' }],
  })
  await check(f, language, identity[language]!, 'ACCEPTED', 'function-correct-boundary')
  await check(f, language, functionalErrors[language]!, 'RUNTIME_ERROR', 'function-runtime-error')
  await check(
    f,
    language,
    Admin.generateStarter(signature, language),
    'WRONG_ANSWER',
    'starter-compatible-wrong'
  )
}
const boundaries: { type: PracticeType; values: unknown[]; name: string }[] = [
  { type: { kind: 'prim', name: 'int' }, values: [-2147483648, 2147483647], name: 'int32' },
  { type: { kind: 'prim', name: 'double' }, values: [-0.125, 1e-12], name: 'floating' },
  { type: { kind: 'prim', name: 'bool' }, values: [false, true], name: 'boolean' },
  {
    type: { kind: 'prim', name: 'string' },
    values: ['', '\u0928\u092e\u0938\u094d\u0924\u0947 \u{1f30d}\n\"\\\t'],
    name: 'empty-unicode',
  },
  {
    type: { kind: 'list', of: { kind: 'prim', name: 'long' } },
    values: [[], [-9007199254740991, 9007199254740991]],
    name: 'list',
  },
  {
    type: { kind: 'matrix', of: { kind: 'prim', name: 'double' } },
    values: [
      [],
      [[], []],
      [
        [-0.125, 0],
        [1e-12, 2.5],
      ],
    ],
    name: 'matrix',
  },
]
for (const fixture of boundaries)
  for (const language of base.languages) {
    const sig: PracticeSignature = {
      name: 'echo',
      params: [{ name: 'value', type: fixture.type }],
      returns: fixture.type,
    }
    const starter = Admin.generateStarter(sig, language)
    const source = starter.replace(/return [^;\n]+/, 'return value')
    const p = PracticePackage.parse({
      ...base,
      mode: 'FUNCTIONAL',
      signature: sig,
      cases: fixture.values.map((v, i) => ({
        input: JSON.stringify([v]),
        output: JSON.stringify(v),
        sample: i === 0,
      })),
      references: [{ language, code: source, complexity: 'identity' }],
    })
    await check(p, language, source, 'ACCEPTED', fixture.name)
  }
console.log(
  JSON.stringify({
    event: 'integration.passed',
    executed: true,
    count: findings.length,
    policy: verified.policy,
    evidenceHash: verified.evidenceHash,
    findingsHash: digest(canonical(findings)),
  })
)
await import('./limits.js')
