import { z } from 'zod'

export const PRACTICE_LANGUAGES = ['cpp', 'python', 'java', 'javascript'] as const
export const PracticeLanguage = z.enum(PRACTICE_LANGUAGES)
const reserved = new Set(
  'class public private protected static void int long double boolean bool char new return if else for while switch case default break continue throw throws try catch finally import package function var let const def pass self this super null None True False true false await async yield delete typeof instanceof in with main constructor __proto__ prototype eval arguments namespace template typename typedef using virtual override final constexpr consteval constinit auto unsigned signed short float struct union enum operator friend inline extern register volatile mutable explicit export noexcept decltype alignas alignof asm do goto sizeof static_assert thread_local dynamic_cast static_cast reinterpret_cast const_cast and or not xor bitand bitor compl and_eq or_eq xor_eq not_eq requires concept co_await co_return co_yield restrict lambda from as assert del elif except global is nonlocal raise match extends implements interface abstract native synchronized transient strictfp byte record sealed permits instanceof debugger of get set char8_t char16_t char32_t wchar_t typeid synchronized null pointer restrict register assert boolean instanceof native package throws transient strictfp Solution string vector toString hashCode getClass wait notify notifyAll equals clone finalize'.split(
    ' '
  )
)
export const PracticeIdentifier = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .refine(v => !reserved.has(v), 'Reserved identifier')
export const PracticePrimitive = z.enum(['int', 'long', 'double', 'bool', 'string'])
export const PracticeType = z.union([
  z.object({ kind: z.literal('prim'), name: PracticePrimitive }).strict(),
  z
    .object({
      kind: z.literal('list'),
      of: z.object({ kind: z.literal('prim'), name: PracticePrimitive }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('matrix'),
      of: z.object({ kind: z.literal('prim'), name: PracticePrimitive }).strict(),
    })
    .strict(),
])
export const PracticeSignature = z
  .object({
    name: PracticeIdentifier,
    params: z.array(z.object({ name: PracticeIdentifier, type: PracticeType }).strict()).max(16),
    returns: PracticeType,
  })
  .strict()
  .superRefine((s, c) => {
    if (new Set(s.params.map(p => p.name)).size !== s.params.length)
      c.addIssue({ code: 'custom', path: ['params'], message: 'Duplicate parameter names' })
  })
export type PracticeType = z.infer<typeof PracticeType>
export type PracticeSignature = z.infer<typeof PracticeSignature>

export function validatePracticeValue(type: PracticeType, value: unknown): boolean {
  if (type.kind !== 'prim') {
    if (!Array.isArray(value) || value.length > 10000) return false
    if (type.kind === 'list') return value.every(v => validatePracticeValue(type.of, v))
    let width: number | undefined
    let cells = 0
    return value.every(row => {
      if (!Array.isArray(row) || row.length > 10000) return false
      if (width === undefined) width = row.length
      cells += row.length
      return (
        row.length === width && cells <= 10000 && row.every(v => validatePracticeValue(type.of, v))
      )
    })
  }
  switch (type.name) {
    case 'bool':
      return typeof value === 'boolean'
    case 'string':
      return (
        typeof value === 'string' &&
        value.length <= 65536 &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      )
    case 'int':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
      )
    case 'long':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'double':
      return typeof value === 'number' && Number.isFinite(value)
  }
}

const boundedText = z
  .string()
  .max(65536)
  .refine(v => new TextEncoder().encode(v).length <= 65536, 'UTF-8 byte limit exceeded')
export const PracticePackage = z
  .object({
    title: z.string().trim().min(3).max(200),
    statementMd: z.string().min(1).max(100000),
    constraints: z.string().min(1).max(20000),
    inputFormat: z.string().max(20000),
    outputFormat: z.string().max(20000),
    difficultyBand: z.enum(['easy', 'medium', 'hard', 'expert']),
    tags: z.array(z.string().trim().min(1).max(64)).max(20),
    mode: z.enum(['STDIO', 'FUNCTIONAL']),
    signature: PracticeSignature.nullable(),
    languages: z
      .array(PracticeLanguage)
      .min(1)
      .max(4)
      .refine(v => new Set(v).size === v.length, 'Duplicate languages'),
    limits: z
      .object({
        timeMs: z.number().int().min(100).max(10000),
        memoryKb: z.number().int().min(16384).max(1048576),
        outputKb: z.number().int().min(1).max(1024),
      })
      .strict(),
    checker: z
      .object({
        kind: z.enum(['exact', 'token', 'float']),
        absolute: z.number().finite().nonnegative().max(0.1).default(0),
        relative: z.number().finite().nonnegative().max(0.1).default(0),
      })
      .strict(),
    cases: z
      .array(
        z
          .object({
            input: boundedText,
            output: boundedText,
            sample: z.boolean(),
            explanation: z.string().max(10000).default(''),
          })
          .strict()
      )
      .min(2)
      .max(100),
    references: z
      .array(
        z
          .object({
            language: PracticeLanguage,
            code: z.string().min(1).max(65536),
            complexity: z.string().min(1).max(1000),
          })
          .strict()
      )
      .min(1)
      .max(4),
    starters: z.record(PracticeLanguage, boundedText).default({}),
    hints: z.array(z.string().max(10000)).max(5).default([]),
    editorial: z.string().max(100000).default(''),
    rightsBasis: z.string().trim().min(10).max(1000),
  })
  .strict()
  .superRefine((p, c) => {
    if (!p.cases.some(t => t.sample) || !p.cases.some(t => !t.sample))
      c.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'Public sample and private test required',
      })
    if ((p.mode === 'FUNCTIONAL' && !p.signature) || (p.mode === 'STDIO' && p.signature))
      c.addIssue({ code: 'custom', path: ['signature'], message: 'Signature must match mode' })
    if (p.references.some(r => !p.languages.includes(r.language)))
      c.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Reference language must be enabled',
      })
    if (
      Object.keys(p.starters).some(
        l => !p.languages.includes(l as z.infer<typeof PracticeLanguage>)
      )
    )
      c.addIssue({
        code: 'custom',
        path: ['starters'],
        message: 'Starter language must be enabled',
      })
    if (p.checker.kind === 'float' && p.checker.absolute === 0 && p.checker.relative === 0)
      c.addIssue({
        code: 'custom',
        path: ['checker'],
        message: 'Positive floating tolerance required',
      })
    if (new TextEncoder().encode(JSON.stringify(p)).length > 750000)
      c.addIssue({ code: 'custom', message: 'Package exceeds size limit' })
    if (p.signature)
      p.cases.forEach((t, i) => {
        try {
          const args: unknown = JSON.parse(t.input)
          const result: unknown = JSON.parse(t.output)
          if (
            !Array.isArray(args) ||
            args.length !== p.signature!.params.length ||
            !p.signature!.params.every((a, n) => validatePracticeValue(a.type, args[n])) ||
            !validatePracticeValue(p.signature!.returns, result)
          )
            throw new Error('Shape')
        } catch {
          c.addIssue({
            code: 'custom',
            path: ['cases', i],
            message: 'Invalid typed function fixture',
          })
        }
      })
  })
export type PracticePackage = z.infer<typeof PracticePackage>
export const PracticeDraftBody = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9-]+$/)
      .refine(
        v => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'),
        'Invalid slug separators'
      ),
    package: PracticePackage,
  })
  .strict()
export const PracticeJobBody = z
  .object({
    problemId: z.string().uuid(),
    language: PracticeLanguage,
    code: boundedText.refine(v => v.length > 0, 'Source required'),
    idempotencyKey: z.string().uuid(),
    contestId: z.never().optional(),
  })
  .strict()
export const PracticeRunBody = PracticeJobBody.extend({ input: boundedText.optional() })
