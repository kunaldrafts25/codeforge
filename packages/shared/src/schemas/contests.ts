import { z } from 'zod'
import { PracticeLanguage } from './practice.js'

export const SCORING_POLICIES = ['icpc-binary-v1'] as const
export const ScoringPolicy = z.enum(SCORING_POLICIES)

export const RATING_POLICIES = ['codeforge-pairwise-elo-v1'] as const
export const RatingPolicy = z.enum(RATING_POLICIES)

export const CONTEST_FORMATS = ['ICPC'] as const
export const ContestFormat = z.enum(CONTEST_FORMATS)

export const ContestSlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9-]+$/)
    .refine(
      v => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'),
      'Invalid slug format'
    ),
})

export const ContestListItem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  registrationOpensAt: z.string().datetime().nullable(),
  registrationClosesAt: z.string().datetime().nullable(),
  freezeAt: z.string().datetime().nullable(),
  capacity: z.number().int(),
  isRated: z.boolean(),
  status: z.string(),
  participantCount: z.number().int(),
  isRegistered: z.boolean().default(false),
})

export const ContestListResponse = z.array(ContestListItem)

export const ContestProblemInput = z.object({
  label: z
    .string()
    .min(1)
    .max(4)
    .regex(/^[A-Z][0-9]?$/, 'Problem label must be uppercase letter (e.g. A, B, C or A1)'),
  problemId: z.string().uuid(),
  versionId: z.string().uuid(),
  points: z.number().int().min(1).max(1000).default(100),
})

export const ContestDraftBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9-]+$/)
      .refine(
        v => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'),
        'Invalid slug format'
      ),
    description: z.string().max(10000).default(''),
    format: ContestFormat.default('ICPC'),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    registrationOpensAt: z.string().datetime(),
    registrationClosesAt: z.string().datetime(),
    freezeAt: z.string().datetime().nullable().optional(),
    capacity: z.number().int().min(1).max(100000).default(1000),
    isRated: z.boolean().default(false),
    divisionMin: z.number().int().min(0).max(4000).nullable().optional(),
    divisionMax: z.number().int().min(0).max(4000).nullable().optional(),
    problems: z.array(ContestProblemInput).min(1).max(26),
  })
  .strict()
  .superRefine((data, ctx) => {
    const regOpen = new Date(data.registrationOpensAt).getTime()
    const regClose = new Date(data.registrationClosesAt).getTime()
    const start = new Date(data.startTime).getTime()
    const end = new Date(data.endTime).getTime()

    if (regOpen >= regClose) {
      ctx.addIssue({
        code: 'custom',
        path: ['registrationClosesAt'],
        message: 'Registration close must be strictly after registration open',
      })
    }
    if (regClose > start) {
      ctx.addIssue({
        code: 'custom',
        path: ['registrationClosesAt'],
        message: 'Registration close must be on or before contest start',
      })
    }
    if (start >= end) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'Contest end must be strictly after contest start',
      })
    }
    if (data.freezeAt) {
      const freeze = new Date(data.freezeAt).getTime()
      if (freeze <= start || freeze >= end) {
        ctx.addIssue({
          code: 'custom',
          path: ['freezeAt'],
          message: 'Freeze time must be strictly between contest start and end',
        })
      }
    }
    if (
      data.divisionMin !== undefined &&
      data.divisionMin !== null &&
      data.divisionMax !== undefined &&
      data.divisionMax !== null &&
      data.divisionMin > data.divisionMax
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['divisionMax'],
        message: 'divisionMax must be greater than or equal to divisionMin',
      })
    }
    const labels = new Set<string>()
    for (const [i, prob] of data.problems.entries()) {
      const label = prob.label
      if (labels.has(label)) {
        ctx.addIssue({
          code: 'custom',
          path: ['problems', i, 'label'],
          message: `Duplicate problem label "${label}"`,
        })
      }
      labels.add(label)
    }
  })

export const ContestSealBody = z
  .object({
    rightsConfirmed: z.literal(true),
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character SHA-256 hash'),
  })
  .strict()

export const ContestSubmitBody = z
  .object({
    problemLabel: z.string().min(1).max(4),
    language: PracticeLanguage,
    code: z
      .string()
      .min(1, 'Source code is required')
      .max(65536)
      .refine(v => new TextEncoder().encode(v).length <= 65536, 'UTF-8 byte limit 64 KiB exceeded'),
    idempotencyKey: z.string().uuid(),
  })
  .strict()

export const ContestProblemState = z.object({
  solved: z.boolean(),
  attempts: z.number().int().min(0),
  penalty: z.number().int().min(0),
  solveTimeMinutes: z.number().int().nullable(),
  isPending: z.boolean().default(false),
})

export const ContestScoreboardEntry = z.object({
  rank: z.number().int().min(1),
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  score: z.number().int().min(0),
  penalty: z.number().int().min(0),
  problemResults: z.record(z.string(), ContestProblemState),
})

export const ContestScoreboardResponse = z.object({
  contest: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    freezeAt: z.string().nullable(),
    isRated: z.boolean(),
    status: z.string(),
    problemLabels: z.array(z.string()),
  }),
  isFrozen: z.boolean(),
  frozenAt: z.string().nullable(),
  asOfTime: z.string(),
  revision: z.number().int(),
  entries: z.array(ContestScoreboardEntry),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
})

export const ContestDetailProblem = z.object({
  label: z.string(),
  problemId: z.string(),
  slug: z.string(),
  title: z.string(),
  points: z.number(),
  statementMd: z.string().nullish(),
  inputFormat: z.string().nullish(),
  outputFormat: z.string().nullish(),
  constraints: z.string().nullish(),
  samples: z
    .array(
      z.object({
        input: z.string(),
        output: z.string(),
        explanation: z.string().nullish(),
      })
    )
    .nullish(),
  starters: z.record(z.string(), z.string()).nullish(),
  languages: z.array(PracticeLanguage).nullish(),
  solved: z.boolean().default(false),
})

export const ContestDetailResponse = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  registrationOpensAt: z.string().nullable(),
  registrationClosesAt: z.string().nullable(),
  freezeAt: z.string().nullable(),
  capacity: z.number(),
  isRated: z.boolean(),
  status: z.string(),
  isRegistered: z.boolean(),
  participantCount: z.number(),
  serverTime: z.string(),
  problems: z.array(ContestDetailProblem),
  manifestRevision: z.number().optional(),
})

export const ContestDisputeCreateBody = z
  .object({
    type: z.enum(['CHEATING_REPORT', 'STATEMENT_AMBIGUITY', 'TEST_FLAW', 'SCORING_OBJECTION']),
    description: z.string().trim().min(10).max(5000),
  })
  .strict()

export const ContestDisputeResolveBody = z
  .object({
    status: z.enum(['INVESTIGATING', 'RESOLVED_REJUDGE', 'RESOLVED_DISQUALIFIED', 'DISMISSED']),
    resolutionReason: z.string().trim().min(5).max(1000),
  })
  .strict()

export const ContestCorrectionBody = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    idempotencyKey: z.string().uuid(),
    submissionId: z.string().uuid().optional(),
    problemLabel: z.string().optional(),
    disqualifyUserId: z.string().uuid().optional(),
  })
  .strict()

export const ContestFinalizeBody = z
  .object({
    idempotencyKey: z.string().uuid(),
  })
  .strict()

export const GlobalLeaderboardQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const GlobalLeaderboardUser = z.object({
  rank: z.number().int().min(1),
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  rating: z.number().int(),
  maxRating: z.number().int(),
  contestsCount: z.number().int().min(1),
  problemsSolved: z.number().int().min(0),
})

export const GlobalLeaderboardResponse = z.object({
  users: z.array(GlobalLeaderboardUser),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
  asOfTime: z.string(),
})
