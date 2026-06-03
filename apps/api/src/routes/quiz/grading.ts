// Objective-item graders. DESCRIPTIVE / CODE_SNIPPET / SQL_QUERY return
// `null` (= pending human/async review). All graders are pure.

type Json = unknown

interface GradedAnswer {
  isCorrect: boolean | null
  pointsAwarded: number
}

interface Scoring {
  marksPerCorrect: number
  negativeMarks: number
}

function normalize(s: string, lower: boolean, ws: boolean): string {
  let out = s
  if (lower) out = out.toLowerCase()
  if (ws) out = out.replace(/\s+/g, ' ').trim()
  return out
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

export function gradeQuestion(
  type: string,
  payload: Json,
  answer: Json,
  scoring: Scoring
): GradedAnswer {
  if (answer === null || answer === undefined) {
    return { isCorrect: false, pointsAwarded: 0 }
  }
  const pos = scoring.marksPerCorrect
  const neg = scoring.negativeMarks // store as positive value, subtract on wrong

  switch (type) {
    case 'MCQ_SINGLE': {
      const p = payload as { correctIds: string[] }
      const a = (answer as { selected?: string })?.selected
      if (typeof a !== 'string') return { isCorrect: false, pointsAwarded: -neg }
      const ok = p.correctIds.length === 1 && p.correctIds[0] === a
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'MCQ_MULTI': {
      const p = payload as { correctIds: string[] }
      const sel = (answer as { selected?: string[] })?.selected
      if (!isStringArray(sel)) return { isCorrect: false, pointsAwarded: -neg }
      const correct = new Set(p.correctIds)
      const picked = new Set(sel)
      const ok = correct.size === picked.size && [...correct].every(x => picked.has(x))
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'NUMERIC': {
      const p = payload as { correct: number; tolerance?: number }
      const v = (answer as { value?: number | string })?.value
      if (v === '' || v === null || v === undefined)
        return { isCorrect: false, pointsAwarded: -neg }
      const num = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(num)) return { isCorrect: false, pointsAwarded: -neg }
      const tol = p.tolerance ?? 0
      const ok = Math.abs(num - p.correct) <= tol
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'FILL_IN_BLANK': {
      const p = payload as {
        acceptedAnswers: string[]
        caseSensitive?: boolean
        normalizeWhitespace?: boolean
      }
      const txt = (answer as { text?: string })?.text
      if (typeof txt !== 'string') return { isCorrect: false, pointsAwarded: -neg }
      const lower = !p.caseSensitive
      const ws = p.normalizeWhitespace !== false
      const norm = normalize(txt, lower, ws)
      const ok = p.acceptedAnswers.some(a => normalize(a, lower, ws) === norm)
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'TRUE_FALSE': {
      const p = payload as { correct: boolean }
      const v = (answer as { value?: boolean })?.value
      if (typeof v !== 'boolean') return { isCorrect: false, pointsAwarded: -neg }
      const ok = v === p.correct
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'MATCH_FOLLOWING': {
      const p = payload as { pairs: { leftId: string; rightId: string }[] }
      const m = (answer as { matches?: Record<string, string> })?.matches
      if (!m || typeof m !== 'object') return { isCorrect: false, pointsAwarded: -neg }
      const ok = p.pairs.every(pair => m[pair.leftId] === pair.rightId)
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'ORDERING': {
      const p = payload as { correctOrder: string[] }
      const order = (answer as { order?: string[] })?.order
      if (!isStringArray(order)) return { isCorrect: false, pointsAwarded: -neg }
      const ok =
        order.length === p.correctOrder.length && order.every((id, i) => id === p.correctOrder[i])
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'SELECT_OUTPUT': {
      // Treat as single-choice MCQ over precomputed outputs.
      const p = payload as { correctIds: string[] }
      const a = (answer as { selected?: string })?.selected
      if (typeof a !== 'string') return { isCorrect: false, pointsAwarded: -neg }
      const ok = p.correctIds.length === 1 && p.correctIds[0] === a
      return { isCorrect: ok, pointsAwarded: ok ? pos : -neg }
    }
    case 'DESCRIPTIVE':
    case 'CODE_SNIPPET':
    case 'SQL_QUERY':
    case 'DRAG_DROP':
    case 'HOTSPOT':
      return { isCorrect: null, pointsAwarded: 0 }
    default:
      return { isCorrect: null, pointsAwarded: 0 }
  }
}

export function projectPublicPayload(
  type: string,
  payload: unknown,
  optionOrder: number[]
): unknown {
  const p = payload as Record<string, unknown>
  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
    case 'SELECT_OUTPUT': {
      const opts = (p.options ?? []) as { id: string; text: string }[]
      const shuffled =
        optionOrder.length === opts.length ? optionOrder.map(i => opts[i]!).filter(Boolean) : opts
      const out: Record<string, unknown> = { options: shuffled }
      if (type === 'SELECT_OUTPUT') {
        out.language = p.language
        out.source = p.source
      }
      return out
    }
    case 'NUMERIC':
      return { tolerance: p.tolerance ?? 0, unit: p.unit }
    case 'FILL_IN_BLANK':
      return {}
    case 'TRUE_FALSE':
      return {}
    case 'MATCH_FOLLOWING': {
      const pairs = (p.pairs ?? []) as {
        leftId: string
        leftText: string
        rightId: string
        rightText: string
      }[]
      const lefts = pairs.map(x => ({ id: x.leftId, text: x.leftText }))
      const rights = pairs.map(x => ({ id: x.rightId, text: x.rightText }))
      return { lefts, rights }
    }
    case 'ORDERING': {
      const items = (p.items ?? []) as { id: string; text: string }[]
      return { items }
    }
    case 'DESCRIPTIVE':
      return { minWords: p.minWords ?? 0, maxWords: p.maxWords }
    case 'CODE_SNIPPET':
      return { language: p.language, starterCode: p.starterCode }
    case 'SQL_QUERY':
      return { schemaDdl: p.schemaDdl }
    default:
      return {}
  }
}
