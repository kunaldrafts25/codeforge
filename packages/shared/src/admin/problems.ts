import { z } from 'zod'
import { FunctionSignature } from './function-sig.js'

export const PROBLEM_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED'] as const
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number]

export const JUDGE_MODES = ['STDIO', 'FUNCTIONAL', 'INTERACTIVE', 'OUTPUT_ONLY'] as const
export const SCORING_MODES = ['BINARY', 'ICPC_PENALTY', 'ATCODER_POINTS', 'IOI_SUBTASK'] as const
export const DIFFICULTY_BANDS = ['easy', 'medium', 'hard', 'expert'] as const
export const CHECKER_TYPES = [
  'exact',
  'token',
  'line',
  'float_eps',
  'case_insensitive',
  'array_set',
  'spj',
] as const

export const LANGUAGES = [
  'cpp',
  'java',
  'python',
  'javascript',
  'typescript',
  'go',
  'rust',
] as const

const slug = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, hyphens')

export const ProblemMetadataInput = z.object({
  title: z.string().min(3).max(200),
  slug,
  difficultyBand: z.enum(DIFFICULTY_BANDS),
  rating: z.number().int().min(800).max(3500).default(1500),
  estimatedMinutes: z.number().int().min(1).max(360).default(20),
  tags: z.array(z.string().max(64)).default([]),
  judgeMode: z.enum(JUDGE_MODES).default('STDIO'),
  scoringMode: z.enum(SCORING_MODES).default('BINARY'),
  timeLimitMs: z.number().int().min(100).max(60_000).default(2000),
  memoryLimitKb: z.number().int().min(16_384).max(2_097_152).default(262_144),
  outputLimitKb: z.number().int().min(1).max(65_536).default(64),
  codeLimitKb: z.number().int().min(1).max(1024).default(64),
  perLanguageOverrides: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  allowedLanguages: z.array(z.string()).default([]),
  source: z.string().max(200).optional(),
  license: z.string().max(200).optional(),
})
export type ProblemMetadataInput = z.infer<typeof ProblemMetadataInput>

export const ProblemStatementInput = z.object({
  statementMd: z.string().min(1).max(200_000),
  inputFormat: z.string().min(1).max(20_000),
  outputFormat: z.string().min(1).max(20_000),
  constraints: z.string().min(1).max(20_000),
  notes: z.string().max(20_000).optional(),
})

export const ProblemSignatureInput = z.object({
  functionSignature: FunctionSignature.nullable(),
})

export const ProblemCheckerInput = z.object({
  checkerType: z.enum(CHECKER_TYPES).default('token'),
  checkerCode: z.string().max(200_000).optional(),
  checkerEpsilon: z.number().positive().optional(),
})

export const ProblemSubtaskInput = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(64),
  points: z.number().int().min(0).max(1000),
  aggregation: z.enum(['min', 'sum']).default('min'),
  dependsOnIds: z.array(z.string()).default([]),
})

export const ProblemTestInput = z.object({
  id: z.string().optional(),
  orderIndex: z.number().int().min(0),
  isSample: z.boolean().default(false),
  input: z.string().max(10 * 1024 * 1024), // 10 MB cap pre-blob
  expectedOutput: z.string().max(10 * 1024 * 1024),
  explanationMd: z.string().max(20_000).nullable().optional(),
  subtaskLabel: z.string().optional(),
})

export const ProblemStarterInput = z.object({
  language: z.string().min(1).max(32),
  code: z.string().max(200_000),
})

export const ProblemReferenceInput = z.object({
  id: z.string().optional(),
  language: z.string().min(1).max(32),
  code: z.string().min(1).max(200_000),
  isJury: z.boolean().default(true),
  complexityNote: z.string().max(200).optional(),
})

export const ProblemHintInput = z.object({
  level: z.number().int().min(1).max(5),
  textMd: z.string().min(1).max(20_000),
})

export const ProblemEditorialInput = z.object({
  bodyMd: z.string().max(200_000),
})

export const CreateProblemBody = ProblemMetadataInput.extend({
  statementMd: z.string().default(''),
  inputFormat: z.string().default(''),
  outputFormat: z.string().default(''),
  constraints: z.string().default(''),
})

export const UpdateProblemBody = z
  .object({
    metadata: ProblemMetadataInput.partial().optional(),
    statement: ProblemStatementInput.partial().optional(),
    signature: ProblemSignatureInput.partial().optional(),
    checker: ProblemCheckerInput.partial().optional(),
    starters: z.array(ProblemStarterInput).optional(),
    references: z.array(ProblemReferenceInput).optional(),
    hints: z.array(ProblemHintInput).optional(),
    editorial: ProblemEditorialInput.nullable().optional(),
    subtasks: z.array(ProblemSubtaskInput).optional(),
  })
  .strict()

export const StatusTransitionBody = z.object({
  toStatus: z.enum(PROBLEM_STATUSES),
  comment: z.string().max(2000).optional(),
})

export const StressTestBody = z.object({
  iterations: z.number().int().min(1).max(10_000).default(1000),
  generatorCode: z.string().max(200_000).optional(),
  generatorLanguage: z.string().default('cpp'),
})

export const ProblemSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(PROBLEM_STATUSES),
  difficultyBand: z.string(),
  rating: z.number().int(),
  judgeMode: z.string(),
  authorId: z.string(),
  authorUsername: z.string().nullable(),
  testCount: z.number().int(),
  hasEditorial: z.boolean(),
  hintCount: z.number().int(),
  referenceCount: z.number().int(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ProblemListResponse = z.object({
  problems: z.array(ProblemSummary),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
})

export const TestDescriptor = z.object({
  id: z.string(),
  orderIndex: z.number().int(),
  isSample: z.boolean(),
  inputBlobKey: z.string(),
  outputBlobKey: z.string(),
  inputPreview: z.string(),
  outputPreview: z.string(),
  inputSizeBytes: z.number().int(),
  explanationMd: z.string().nullable(),
  subtaskId: z.string().nullable(),
  subtaskLabel: z.string().nullable(),
})

export const ProblemDetail = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  version: z.number().int(),
  title: z.string(),
  status: z.enum(PROBLEM_STATUSES),
  difficultyBand: z.string(),
  rating: z.number().int(),
  estimatedMinutes: z.number().int(),
  judgeMode: z.string(),
  scoringMode: z.string(),
  timeLimitMs: z.number().int(),
  memoryLimitKb: z.number().int(),
  outputLimitKb: z.number().int(),
  codeLimitKb: z.number().int(),
  perLanguageOverrides: z.unknown(),
  allowedLanguages: z.array(z.string()),
  statementMd: z.string(),
  inputFormat: z.string(),
  outputFormat: z.string(),
  constraints: z.string(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  source: z.string().nullable(),
  license: z.string().nullable(),
  isPublic: z.boolean(),
  publishedAt: z.string().nullable(),
  functionSignature: z.unknown().nullable(),
  checkerType: z.string(),
  checkerCode: z.string().nullable(),
  checkerEpsilon: z.number().nullable(),
  totalSubmissions: z.number().int(),
  totalAccepted: z.number().int(),
  acceptanceRate: z.number(),
  authorId: z.string(),
  authorUsername: z.string().nullable(),
  starters: z.array(z.object({ language: z.string(), code: z.string() })),
  references: z.array(
    z.object({
      id: z.string(),
      language: z.string(),
      code: z.string(),
      isJury: z.boolean(),
      complexityNote: z.string().nullable(),
    })
  ),
  hints: z.array(z.object({ id: z.string(), level: z.number().int(), textMd: z.string() })),
  editorial: z.object({ bodyMd: z.string(), publishedAt: z.string().nullable() }).nullable(),
  subtasks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      points: z.number().int(),
      aggregation: z.string(),
      dependsOnIds: z.array(z.string()),
    })
  ),
  tests: z.array(TestDescriptor),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ProblemAnalytics = z.object({
  totalSubmissions: z.number().int(),
  totalAccepted: z.number().int(),
  acceptanceRate: z.number(),
  uniqueSolvers: z.number().int(),
  verdictCounts: z.record(z.string(), z.number().int()),
  topLanguages: z.array(z.object({ language: z.string(), count: z.number().int() })),
  runtimeP50Ms: z.number().nullable(),
  runtimeP95Ms: z.number().nullable(),
  averageTimeMs: z.number().nullable(),
})

export const ValidationReport = z.object({
  ok: z.boolean(),
  testsChecked: z.number().int(),
  failures: z.array(
    z.object({
      testIndex: z.number().int(),
      stage: z.string(),
      message: z.string(),
    })
  ),
})

export const StressTestReport = z.object({
  ok: z.boolean(),
  iterations: z.number().int(),
  diverged: z.number().int(),
  firstDivergence: z
    .object({
      seed: z.number().int(),
      generatedInputPreview: z.string(),
      juryOutput: z.string(),
      bruteOutput: z.string(),
    })
    .nullable(),
})
