import { createHash } from 'node:crypto'
import { PracticePackage } from '@codeforge/shared'

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(object[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

export function publicPackage(raw: unknown) {
  const p = PracticePackage.parse(raw)
  return {
    title: p.title,
    statementMd: p.statementMd,
    constraints: p.constraints,
    inputFormat: p.inputFormat,
    outputFormat: p.outputFormat,
    difficultyBand: p.difficultyBand,
    tags: p.tags,
    mode: p.mode,
    signature: p.signature,
    languages: p.languages,
    limits: p.limits,
    samples: p.cases
      .filter(t => t.sample)
      .map(t => ({ input: t.input, output: t.output, explanation: t.explanation })),
    starters: p.starters,
    hints: p.hints,
    editorial: p.editorial,
  }
}

// The runtime and durable worker have not been verified. No environment flag
// can bypass this admission decision.
export const executionAvailability = () => ({
  enabled: false as const,
  code: 'JUDGE_UNAVAILABLE',
  reason:
    'Isolated execution is awaiting verification. Drafts can be saved; run, submission and publication are unavailable.',
})
