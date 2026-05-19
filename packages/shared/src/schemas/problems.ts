import { z } from 'zod'

export const ProblemListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  difficulty: z.enum(['all', 'easy', 'medium', 'hard', 'expert']).default('all'),
  tag: z.string().min(1).max(64).optional(),
  search: z.string().min(1).max(128).optional(),
})

export const ProblemSlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9-]+$/),
})

export const ProblemListItem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  difficultyBand: z.string(),
  rating: z.number().int(),
  tags: z.array(z.string()),
  totalAccepted: z.number().int(),
  totalSubmissions: z.number().int(),
  acceptanceRate: z.number(),
})

export const ProblemListResponse = z.object({
  problems: z.array(ProblemListItem),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
})

export const ProblemDetailResponse = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  statementMd: z.string(),
  inputFormat: z.string(),
  outputFormat: z.string(),
  constraints: z.string(),
  difficultyBand: z.string(),
  rating: z.number().int(),
  timeLimitMs: z.number().int(),
  memoryLimitKb: z.number().int(),
  tags: z.array(z.string()),
  samples: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
      explanation: z.string().nullable(),
    })
  ),
  totalAccepted: z.number().int(),
  totalSubmissions: z.number().int(),
  judgeMode: z.string(),
})

export type ProblemListQuery = z.infer<typeof ProblemListQuery>
