import { createHash } from 'node:crypto'
import { PracticePackage } from '@codeforge/shared'
import { compare } from '@codeforge/checker-lib'
import { buildSources, compareFunction, validFunctionInput } from './harness.js'
import { command, engineName } from './transport.js'

export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export type Measurement = {
  exitCode: number | null
  limit: string | null
  timeMs: number
  memoryKb: number
  wallMs: number
  stdout: string
  stderr: string
}
export type Execution = {
  compiled: Measurement
  cases: Measurement[]
  artifacts?: Record<string, string>
}
export type Policy = {
  image: string
  runtimeHash: string
  supervisorHash: string
  harnessHash: string
  checkerHash: string
  versions: string
  version: string
}
export function diagnostic(value: string, bytes = 8192): string {
  return Buffer.from(
    value
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  )
    .subarray(0, bytes)
    .toString('utf8')
}
export async function executeSources(
  policy: Policy,
  request: {
    language: string
    files: Record<string, string>
    inputs: string[]
    limits: { timeMs: number; memoryKb: number; outputKb: number }
    jobId: string
  },
  onRunning?: () => Promise<void>
): Promise<Execution> {
  let transition: Promise<void> | undefined
  const pulse = setInterval(() => {
    void command([
      'exec',
      engineName(),
      'python3',
      '/opt/forge/executor.py',
      '--touch',
      request.jobId,
    ]).catch(() => undefined)
  }, 5000)
  let text: string
  try {
    text = await command(
      [
        'exec',
        '-i',
        '-e',
        `FORGE_TOOLCHAIN_IMAGE=${policy.image}`,
        '-e',
        `FORGE_SUPERVISOR_HASH=${policy.supervisorHash}`,
        engineName(),
        'python3',
        '/opt/forge/executor.py',
      ],
      JSON.stringify(request),
      35000 + request.inputs.length * (request.limits.timeMs * 3 + 5000),
      150 * 1024 * 1024,
      line => {
        if (line === '{"event": "compiled"}') {
          transition = onRunning?.()
          void transition?.catch(() => undefined)
        }
      }
    )
  } finally {
    clearInterval(pulse)
  }
  await transition
  const result = JSON.parse(text.trim().split('\n').at(-1)!) as Execution
  if (!result.compiled || !Array.isArray(result.cases)) throw new Error('Sandbox protocol failure')
  for (const m of [result.compiled, ...result.cases])
    if (
      ![m.timeMs, m.memoryKb, m.wallMs].every(n => Number.isSafeInteger(n) && n >= 0) ||
      (!Number.isInteger(m.exitCode) && !(m.exitCode === null && m.limit)) ||
      typeof m.stdout !== 'string' ||
      typeof m.stderr !== 'string'
    )
      throw new Error('Invalid sandbox measurements')
  return result
}
export async function judge(
  policy: Policy,
  rawPackage: unknown,
  job: { id: string; kind: string; language: string; source: string; input: string | null },
  onRunning?: () => Promise<void>
) {
  const p = PracticePackage.parse(rawPackage)
  if (!p.languages.includes(job.language as (typeof p.languages)[number]))
    throw new Error('Package language mismatch')
  const custom = job.kind === 'RUN' && job.input !== null
  const tests = custom
    ? [{ input: job.input!, output: '', sample: true }]
    : p.cases.filter(c => job.kind !== 'RUN' || c.sample)
  if (p.signature && tests.some(t => !validFunctionInput(p.signature, t.input)))
    throw new Error('Invalid typed input')
  const result = await executeSources(
    policy,
    {
      language: job.language,
      files: buildSources(job.language, job.source, p.signature),
      inputs: tests.map(t => t.input),
      limits: p.limits,
      jobId: job.id,
    },
    onRunning
  )
  let verdict =
    result.compiled.exitCode || result.compiled.limit
      ? 'COMPILATION_ERROR'
      : custom
        ? 'RUN_COMPLETE'
        : 'ACCEPTED'
  let passed = 0
  const cases = result.cases.map((m, i) => {
    const t = tests[i]
    if (!t) throw new Error('Unexpected sandbox case')
    let outcome = m.limit ?? (m.exitCode ? 'RUNTIME_ERROR' : 'ACCEPTED')
    if (
      outcome === 'ACCEPTED' &&
      !custom &&
      !(p.signature
        ? compareFunction(p.signature, t.output, m.stdout, p.checker)
        : compare(t.output, m.stdout, p.checker))
    )
      outcome = 'WRONG_ANSWER'
    if (outcome === 'ACCEPTED') passed++
    else if (['ACCEPTED', 'RUN_COMPLETE'].includes(verdict)) verdict = outcome
    return {
      outcome,
      timeMs: m.timeMs,
      memoryKb: m.memoryKb,
      wallMs: m.wallMs,
      exitCode: m.exitCode,
      stdout: diagnostic(
        m.stdout,
        t.sample ? Math.min(8192, Math.floor(128000 / (2 * tests.length))) : 256
      ),
      stderr: diagnostic(
        m.stderr,
        t.sample ? Math.min(8192, Math.floor(128000 / (2 * tests.length))) : 256
      ),
      sample: t.sample,
    }
  })
  if (result.compiled.exitCode === 0 && !result.compiled.limit && cases.length !== tests.length)
    throw new Error('Incomplete sandbox evidence')
  return {
    verdict,
    passed,
    total: tests.length,
    timeMs: cases.length ? Math.max(...cases.map(c => c.timeMs)) : null,
    memoryKb: cases.length ? Math.max(...cases.map(c => c.memoryKb)) : null,
    privateEvidence: {
      executed: true,
      policyHash: digest(canonical(policy)),
      packageHash: digest(canonical(p)),
      sourceHash: digest(job.source),
      artifacts: result.artifacts ?? {},
      compile: {
        ...result.compiled,
        stdout: diagnostic(result.compiled.stdout),
        stderr: diagnostic(result.compiled.stderr),
      },
      cases,
    },
  }
}
