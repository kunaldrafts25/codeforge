import { z } from 'zod'

// ─── Enums (mirror Prisma QuestionType / QuestionStatus) ─────────────────────

export const QuestionTypeSchema = z.enum([
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'NUMERIC',
  'FILL_IN_BLANK',
  'TRUE_FALSE',
  'MATCH_FOLLOWING',
  'ORDERING',
  'DESCRIPTIVE',
  'CODE_SNIPPET',
  'SELECT_OUTPUT',
  'SQL_QUERY',
  'DRAG_DROP',
  'HOTSPOT',
])
export type QuestionType = z.infer<typeof QuestionTypeSchema>

export const ProctorLevelSchema = z.enum(['off', 'light', 'strict', 'high_stakes'])
export type ProctorLevel = z.infer<typeof ProctorLevelSchema>

// ─── Question payload variants ───────────────────────────────────────────────
// Each question's `payload` JSON column in QuizQuestion is type-specific. The
// shapes below describe what authors write; the runner serves only the
// `*Public` projection (no correctness data) to candidates.

export const McqOption = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
})

export const McqPayload = z.object({
  options: z.array(McqOption).min(2).max(20),
  correctIds: z.array(z.string()).min(1), // single: length 1, multi: ≥ 1
  explanation: z.string().optional(),
})

export const NumericPayload = z.object({
  correct: z.number(),
  tolerance: z.number().nonnegative().default(0),
  unit: z.string().optional(),
  explanation: z.string().optional(),
})

export const FillBlankPayload = z.object({
  acceptedAnswers: z.array(z.string()).min(1),
  caseSensitive: z.boolean().default(false),
  normalizeWhitespace: z.boolean().default(true),
  explanation: z.string().optional(),
})

export const TrueFalsePayload = z.object({
  correct: z.boolean(),
  explanation: z.string().optional(),
})

export const MatchPair = z.object({
  leftId: z.string(),
  leftText: z.string(),
  rightId: z.string(),
  rightText: z.string(),
})

export const MatchPayload = z.object({
  pairs: z.array(MatchPair).min(2),
  explanation: z.string().optional(),
})

export const OrderingItem = z.object({ id: z.string(), text: z.string() })
export const OrderingPayload = z.object({
  items: z.array(OrderingItem).min(2),
  correctOrder: z.array(z.string()).min(2),
  explanation: z.string().optional(),
})

export const DescriptivePayload = z.object({
  minWords: z.number().int().nonnegative().default(0),
  maxWords: z.number().int().positive().optional(),
  rubric: z.string().optional(),
  modelAnswer: z.string().optional(),
})

export const CodeSnippetPayload = z.object({
  language: z.string().min(1),
  starterCode: z.string(),
  expectedOutput: z.string().optional(),
  rubric: z.string().optional(),
})

export const SelectOutputPayload = z.object({
  language: z.string().min(1),
  source: z.string().min(1),
  options: z.array(McqOption).min(2),
  correctIds: z.array(z.string()).min(1),
  explanation: z.string().optional(),
})

export const SqlQueryPayload = z.object({
  schemaDdl: z.string(),
  expectedResultJson: z.unknown(),
  rubric: z.string().optional(),
})

// ─── Section descriptor (lives inside QuizTest.sections JSON) ────────────────

export const SectionDescriptor = z.object({
  name: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  numQuestions: z.number().int().positive(),
  topicMix: z.array(z.string()).default([]),
  scoringPolicy: z
    .object({
      marksPerCorrect: z.number().default(1),
      negativeMarks: z.number().default(0),
    })
    .default({ marksPerCorrect: 1, negativeMarks: 0 }),
})
export type SectionDescriptor = z.infer<typeof SectionDescriptor>

// ─── List & detail responses ─────────────────────────────────────────────────

export const QuizTestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(20),
  topic: z.string().min(1).max(64).optional(),
  difficulty: z.enum(['all', 'L1', 'L2', 'L3']).default('all'),
  proctorLevel: ProctorLevelSchema.optional(),
  search: z.string().min(1).max(128).optional(),
  adaptive: z
    .enum(['all', 'true', 'false'])
    .default('all')
    .transform(v => (v === 'all' ? undefined : v === 'true')),
})

export const QuizTestListItem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  isAdaptive: z.boolean(),
  proctorLevel: z.string(),
  sectionCount: z.number().int(),
  questionCount: z.number().int(),
  topics: z.array(z.string()),
})

export const QuizTestListResponse = z.object({
  items: z.array(QuizTestListItem),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
})

export const QuizTestDetail = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  sections: z.array(SectionDescriptor),
  isAdaptive: z.boolean(),
  randomizeOptions: z.boolean(),
  randomizeOrder: z.boolean(),
  proctorLevel: z.string(),
  requireWebcam: z.boolean(),
  requireFullscreen: z.boolean(),
  requireScreenShare: z.boolean(),
  status: z.string(),
})

export const QuizSlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9-]+$/),
})

export const QuizAttemptIdParam = z.object({ id: z.string().uuid() })

// ─── Start attempt ───────────────────────────────────────────────────────────

export const StartAttemptBody = z.object({
  testSlug: z.string().min(1),
  consentedToProctoring: z.boolean(),
  systemCheckPassed: z.boolean(),
})

export const StartAttemptResponse = z.object({
  attemptId: z.string().uuid(),
  testId: z.string().uuid(),
  proctorLevel: z.string(),
  startedAt: z.string(),
  resumed: z.boolean(),
})

// ─── Question render payload sent to the runner ──────────────────────────────
// Strictly excludes correctness fields. Server uses `optionOrderShown` to
// permute MCQ options deterministically per candidate.

export const PublicQuestion = z.object({
  questionId: z.string().uuid(),
  type: QuestionTypeSchema,
  topic: z.string(),
  subtopic: z.string().nullable(),
  stemMd: z.string(),
  estimatedSeconds: z.number().int().nonnegative(),
  payloadPublic: z.unknown(), // type-narrowed in client
  optionOrderShown: z.array(z.number().int().nonnegative()).default([]),
  section: z.string(),
  presentedOrder: z.number().int().nonnegative(),
})

export const AttemptStateResponse = z.object({
  attemptId: z.string().uuid(),
  testId: z.string().uuid(),
  testSlug: z.string(),
  testTitle: z.string(),
  isAdaptive: z.boolean(),
  proctorLevel: z.string(),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  durationMinutes: z.number().int(),
  sections: z.array(SectionDescriptor),
  sectionsCompleted: z.array(z.string()),
  currentSection: z.string().nullable(),
  questions: z.array(PublicQuestion),
  responses: z.array(
    z.object({
      questionId: z.string().uuid(),
      answerPayload: z.unknown(),
      markedForReview: z.boolean(),
      lastChangedAt: z.string(),
    })
  ),
})

// ─── Timer ───────────────────────────────────────────────────────────────────

export const TimerResponse = z.object({
  remainingMs: z.number().int().nonnegative(),
  serverTs: z.string(),
  sectionRemainingMs: z.number().int().nonnegative().nullable(),
  expired: z.boolean(),
})

// ─── Save response ───────────────────────────────────────────────────────────

export const SaveResponseBody = z.object({
  questionId: z.string().uuid(),
  answerPayload: z.unknown(),
  markedForReview: z.boolean().default(false),
  clientTs: z.string().optional(),
})

export const SaveResponseResponse = z.object({
  ok: z.literal(true),
  savedAt: z.string(),
  changeCount: z.number().int(),
})

// ─── Submit section ──────────────────────────────────────────────────────────

export const SubmitSectionBody = z.object({ section: z.string().min(1) })
export const SubmitSectionResponse = z.object({
  ok: z.literal(true),
  section: z.string(),
  lockedAt: z.string(),
  sectionsCompleted: z.array(z.string()),
})

// ─── Submit attempt ──────────────────────────────────────────────────────────

export const SubmitAttemptResponse = z.object({
  ok: z.literal(true),
  submittedAt: z.string(),
  redirectTo: z.string(),
})

// ─── Result ──────────────────────────────────────────────────────────────────

export const QuestionResult = z.object({
  questionId: z.string().uuid(),
  topic: z.string(),
  subtopic: z.string().nullable(),
  type: QuestionTypeSchema,
  section: z.string(),
  isCorrect: z.boolean().nullable(), // null = pending review (DESCRIPTIVE, CODE_SNIPPET, SQL_QUERY)
  pointsAwarded: z.number(),
  timeSeconds: z.number(),
})

export const ResultResponse = z.object({
  attemptId: z.string().uuid(),
  testSlug: z.string(),
  testTitle: z.string(),
  submittedAt: z.string().nullable(),
  rawScore: z.number().nullable(),
  maxScore: z.number(),
  scaledScore: z.number().int().nullable(),
  percentile: z.number().nullable(),
  sectionalScores: z.record(
    z.string(),
    z.object({
      raw: z.number(),
      max: z.number(),
      correct: z.number().int(),
      total: z.number().int(),
      timeSeconds: z.number(),
    })
  ),
  thetaEstimate: z.number().nullable(),
  pendingReview: z.boolean(),
  topicBreakdown: z.array(
    z.object({
      topic: z.string(),
      attempted: z.number().int(),
      correct: z.number().int(),
      avgTime: z.number(),
    })
  ),
  questions: z.array(QuestionResult),
})

export type QuizTestListItem = z.infer<typeof QuizTestListItem>
export type QuizTestDetail = z.infer<typeof QuizTestDetail>
export type AttemptStateResponse = z.infer<typeof AttemptStateResponse>
export type PublicQuestion = z.infer<typeof PublicQuestion>
export type TimerResponse = z.infer<typeof TimerResponse>
export type ResultResponse = z.infer<typeof ResultResponse>
export type StartAttemptResponse = z.infer<typeof StartAttemptResponse>
