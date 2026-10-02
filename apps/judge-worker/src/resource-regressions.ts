import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  PRACTICE_LANGUAGES,
  PRACTICE_RUNTIME_MEMORY_ALLOWANCE_KB,
  PracticePackage,
} from '@codeforge/shared'
import { verifyBoundary } from './doctor.js'
import { judge, canonical, digest } from './runner.js'

const verified = await verifyBoundary()
const findings: Record<string, unknown>[] = []
const body: Record<string, Record<string, string>> = {
  cpp: {
    cpu: 'volatile unsigned long n=0; for(;;){++n;}',
    wall: 'std::this_thread::sleep_for(std::chrono::seconds(60));',
    memory:
      'std::vector<std::vector<unsigned char>> blocks; for(;;){blocks.emplace_back(4*1024*1024,1);std::this_thread::sleep_for(std::chrono::milliseconds(20));}',
    output: "for(;;){std::cout<<std::string(10000,'x')<<std::flush;}",
    exception: 'throw std::runtime_error("candidate error");',
    spoof: 'throw std::bad_alloc();',
    abort: 'std::raise(SIGABRT);',
  },
  python: {
    cpu: 'while True: pass',
    wall: 'time.sleep(60)',
    memory: 'blocks=[]\nwhile True:\n blocks.append(bytearray(4*1024*1024))\n time.sleep(.02)',
    output: 'while True: print("x"*10000,flush=True)',
    exception: 'raise ValueError("candidate error")',
    spoof: 'raise MemoryError("candidate controlled OOM")',
    abort: 'os.abort()',
  },
  java: {
    cpu: 'while(System.nanoTime()!=0){}',
    wall: 'Thread.sleep(60000);',
    memory:
      'java.util.ArrayList<byte[]> blocks=new java.util.ArrayList<>();while(System.nanoTime()!=0){blocks.add(new byte[4*1024*1024]);Thread.sleep(20);}',
    output: 'while(System.nanoTime()!=0){System.out.print("x".repeat(10000));}',
    exception: 'if(System.nanoTime()!=0)throw new RuntimeException("candidate error");',
    spoof: 'if(System.nanoTime()!=0)throw new OutOfMemoryError("Java heap space");',
    abort: 'Runtime.getRuntime().halt(134);',
  },
  javascript: {
    cpu: 'while(true){}',
    wall: 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);',
    memory:
      'const blocks=[];while(true){blocks.push(new Array(512*1024).fill(1));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}',
    output: 'while(true){process.stdout.write("x".repeat(10000));}',
    exception: 'throw new Error("candidate error");',
    spoof:
      'throw new Error("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");',
    abort: 'process.abort();',
  },
}
function source(language: string, mode: string, statements: string) {
  if (language === 'cpp') {
    const header =
      '#include <iostream>\n#include <vector>\n#include <thread>\n#include <chrono>\n#include <stdexcept>\n#include <new>\n#include <csignal>\n'
    return (
      header +
      (mode === 'STDIO'
        ? `int main(){${statements}std::cout<<1;}`
        : `class Solution{public:int echo(int value){${statements}return 1;}};`)
    )
  }
  if (language === 'python') {
    const header = 'import time,os\n'
    return (
      header +
      (mode === 'STDIO'
        ? `${statements}\nprint(1)`
        : 'class Solution:\n def echo(self,value):\n' +
          (statements + '\nreturn 1')
            .split('\n')
            .map(l => `  ${l}`)
            .join('\n'))
    )
  }
  if (language === 'java')
    return mode === 'STDIO'
      ? `public class Main{public static void main(String[] args)throws Exception{${statements}System.out.print(1);}}`
      : `class Solution{public int echo(int value)throws Exception{${statements}return 1;}}`
  return mode === 'STDIO'
    ? `${statements}\nconsole.log(1);`
    : `function echo(value){${statements}return 1;}`
}
function packageFor(language: string, mode: string, timeMs: number, outputKb = 16) {
  return PracticePackage.parse({
    title: 'Measured language limit fixture',
    statementMd: 'Return 1.',
    constraints: 'Original disposable acceptance fixture.',
    inputFormat: '',
    outputFormat: '1',
    difficultyBand: 'easy',
    tags: [],
    languages: [language],
    mode,
    signature:
      mode === 'STDIO'
        ? null
        : {
            name: 'echo',
            params: [{ name: 'value', type: { kind: 'prim', name: 'int' } }],
            returns: { kind: 'prim', name: 'int' },
          },
    limits: { timeMs, memoryKb: 16384, outputKb },
    checker: { kind: 'token' },
    cases: [
      { input: mode === 'STDIO' ? '' : '[1]', output: '1', sample: true },
      { input: mode === 'STDIO' ? '' : '[1]', output: '1', sample: false },
    ],
    references: [{ language, code: source(language, mode, ''), complexity: 'O(1)' }],
    rightsBasis: 'Original disposable acceptance fixture.',
  })
}
for (const language of PRACTICE_LANGUAGES)
  for (const mode of ['STDIO', 'FUNCTIONAL'])
    for (const fixture of [
      { name: 'cpu', expected: 'TIME_LIMIT', timeMs: 400 },
      { name: 'wall', expected: 'TIME_LIMIT', timeMs: 1000 },
      { name: 'memory', expected: 'MEMORY_LIMIT', timeMs: 5000 },
      { name: 'output', expected: 'OUTPUT_LIMIT', timeMs: 2000 },
      { name: 'exception', expected: 'RUNTIME_ERROR', timeMs: 2000 },
      { name: 'spoof', expected: 'RUNTIME_ERROR', timeMs: 2000 },
      { name: 'abort', expected: 'RUNTIME_ERROR', timeMs: 2000 },
    ]) {
      const p = packageFor(language, mode, fixture.timeMs, fixture.name === 'output' ? 1 : 16)
      const result = await judge(verified.policy, p, {
        id: `limits_${randomUUID()}`,
        kind: 'SUBMIT',
        language,
        source: source(language, mode, body[language]![fixture.name]!),
        input: null,
      })
      assert.equal(
        result.verdict,
        fixture.expected,
        `${fixture.name}/${language}/${mode}: ${JSON.stringify(result.privateEvidence.compile)}`
      )
      for (const m of result.privateEvidence.cases) {
        if (fixture.name === 'cpu') {
          assert(m.timeMs >= fixture.timeMs)
          assert(m.wallMs < fixture.timeMs * 3 + 1000)
        }
        if (fixture.name === 'wall') {
          assert(m.wallMs >= fixture.timeMs * 3 + 1000)
          assert(m.timeMs < fixture.timeMs)
        }
        if (fixture.name === 'memory') {
          assert.equal(m.outcome, 'MEMORY_LIMIT')
          assert(m.memoryKb > p.limits.memoryKb + PRACTICE_RUNTIME_MEMORY_ALLOWANCE_KB[language])
        }
        if (['exception', 'spoof', 'abort'].includes(fixture.name)) {
          assert.equal(m.outcome, 'RUNTIME_ERROR')
          assert(m.memoryKb <= p.limits.memoryKb + PRACTICE_RUNTIME_MEMORY_ALLOWANCE_KB[language])
        }
      }
      const record = {
        name: fixture.name,
        language,
        mode,
        verdict: result.verdict,
        timeMs: result.timeMs,
        memoryKb: result.memoryKb,
        wallMs: result.privateEvidence.cases[0]!.wallMs,
      }
      findings.push(record)
      console.log(
        JSON.stringify({ event: 'resource.regression_passed', executed: true, ...record })
      )
    }
// Original review Java allocation is within the resident allowance; its output
// is wrong, not a heap error. The Node array exceeds measured consumption.
for (const [language, originalSource, expected] of [
  [
    'java',
    'public class Main {public static void main(String[] args){byte[] a=new byte[64*1024*1024];System.out.println(a.length);}}',
    'WRONG_ANSWER',
  ],
  [
    'javascript',
    'const a=[];for(let i=0;i<10000000;i++)a.push(i);console.log(a.length)',
    'MEMORY_LIMIT',
  ],
] as const) {
  const p = PracticePackage.parse({
    ...packageFor(language, 'STDIO', 5000, 4),
    statementMd: 'Print ok.',
    outputFormat: 'ok',
    cases: [
      { input: '', output: 'ok', sample: true },
      { input: '', output: 'ok', sample: false },
    ],
    references: [
      {
        language,
        code:
          language === 'java'
            ? 'public class Main {public static void main(String[] args){System.out.println("ok");}}'
            : 'console.log("ok")',
        complexity: 'O(1)',
      },
    ],
  })
  const result = await judge(verified.policy, p, {
    id: `original_${randomUUID()}`,
    kind: 'SUBMIT',
    language,
    source: originalSource,
    input: null,
  })
  assert.equal(result.verdict, expected, `original-heap/${language}`)
  console.log(
    JSON.stringify({
      event: 'review.original_heap_policy_passed',
      language,
      expected,
      verdict: result.verdict,
      executed: true,
      case: result.privateEvidence.cases[0],
    })
  )
}
console.log(
  JSON.stringify({
    event: 'resource.matrix_passed',
    executed: true,
    count: findings.length,
    findingsHash: digest(canonical(findings)),
    policy: verified.policy,
  })
)
