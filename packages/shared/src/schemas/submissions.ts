import { z } from 'zod'

export const CreateSubmissionBody = z.object({
  problemId: z.string().uuid(),
  language: z.enum(['cpp', 'c', 'python', 'java', 'javascript']),
  code: z
    .string()
    .min(1)
    .max(64 * 1024),
  contestId: z.string().uuid().optional(),
})

export const SubmissionIdParam = z.object({
  id: z.string().uuid(),
})

export const VerdictEnum = z.enum([
  'PENDING',
  'QUEUED',
  'COMPILING',
  'RUNNING',
  'ACCEPTED',
  'WRONG_ANSWER',
  'TIME_LIMIT',
  'MEMORY_LIMIT',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'OUTPUT_LIMIT',
  'PRESENTATION_ERROR',
  'JUDGE_FAILURE',
  'SKIPPED',
])

export const SubmissionResponse = z.object({
  id: z.string().uuid(),
  problemId: z.string().uuid(),
  language: z.string(),
  verdict: VerdictEnum,
  testsPassed: z.number().int(),
  testsTotal: z.number().int(),
  executionTimeMs: z.number().int().nullable(),
  memoryUsedKb: z.number().int().nullable(),
  submittedAt: z.string().datetime(),
})

export type CreateSubmissionBody = z.infer<typeof CreateSubmissionBody>
