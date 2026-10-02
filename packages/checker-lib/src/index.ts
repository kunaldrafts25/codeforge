export class CheckerFailure extends Error {}
export type Comparison = { kind: 'exact' | 'token' | 'float'; absolute?: number; relative?: number }
const tokens = (text: string) => text.split(/[\t\n\v\f\r ]+/).filter(Boolean)
function numeric(text: string): boolean {
  const parts = text.split(/[eE]/)
  return (
    parts.length <= 2 &&
    /^[+-]?[0-9.]+$/.test(parts[0] ?? '') &&
    (parts.length === 1 || /^[+-]?[0-9]+$/.test(parts[1] ?? '')) &&
    Number.isFinite(Number(text))
  )
}

// Trusted comparator: jury output stays outside the candidate sandbox.
export function compare(expected: string, actual: string, policy: Comparison): boolean {
  const absolute = policy.absolute ?? 0
  const relative = policy.relative ?? 0
  if (
    !['exact', 'token', 'float'].includes(policy.kind) ||
    !Number.isFinite(absolute) ||
    !Number.isFinite(relative) ||
    absolute < 0 ||
    relative < 0 ||
    absolute > 0.1 ||
    relative > 0.1 ||
    (policy.kind === 'float' ? absolute + relative === 0 : absolute !== 0 || relative !== 0)
  )
    throw new CheckerFailure('Invalid comparison policy')
  if (Buffer.byteLength(expected) > 1024 * 1024 || Buffer.byteLength(actual) > 1024 * 1024)
    throw new CheckerFailure('Comparison exceeds configured bound')
  if (policy.kind === 'exact') return expected === actual
  const jury = tokens(expected)
  const candidate = tokens(actual)
  if (policy.kind === 'token')
    return jury.length === candidate.length && jury.every((t, i) => t === candidate[i])
  if (policy.kind !== 'float') throw new CheckerFailure('Unsupported checker')
  if (
    !Number.isFinite(absolute) ||
    !Number.isFinite(relative) ||
    absolute < 0 ||
    relative < 0 ||
    absolute > 0.1 ||
    relative > 0.1 ||
    absolute + relative === 0
  )
    throw new CheckerFailure('Invalid tolerance')
  const values = jury.map(t => {
    const n = Number(t)
    if (!numeric(t) || !Number.isFinite(n)) throw new CheckerFailure('Invalid jury numeric output')
    return n
  })
  if (values.length !== candidate.length) return false
  return values.every((n, i) => {
    const text = candidate[i]!
    const v = Number(text)
    return (
      numeric(text) &&
      Number.isFinite(v) &&
      Math.abs(n - v) <= Math.max(absolute, relative * Math.abs(n))
    )
  })
}
