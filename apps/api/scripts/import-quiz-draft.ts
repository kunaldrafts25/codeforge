import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { prisma, type Prisma } from '@codeforge/db'
import { McqPayload, TrueFalsePayload } from '@codeforge/shared'
import { z } from 'zod'

const itemSchema = z.object({
  type: z.enum(['MCQ_SINGLE', 'TRUE_FALSE']),
  topic: z.string().trim().min(2).max(100),
  stemMd: z.string().trim().min(10).max(10_000),
  payload: z.unknown(),
  difficultyBand: z.string().trim().min(1).max(30),
})
const draftSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(128),
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().max(1000).optional(),
  durationMinutes: z.number().int().min(1).max(240),
  questions: z.array(itemSchema).min(1).max(100),
})

async function main() {
  const file = process.env.QUIZ_IMPORT_FILE
  const authorEmail = process.env.QUIZ_IMPORT_AUTHOR_EMAIL
  if (!file || !authorEmail)
    throw new Error('QUIZ_IMPORT_FILE and QUIZ_IMPORT_AUTHOR_EMAIL are required')
  const draft = draftSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  for (const question of draft.questions) {
    const parsed =
      question.type === 'MCQ_SINGLE'
        ? McqPayload.safeParse(question.payload)
        : TrueFalsePayload.safeParse(question.payload)
    if (!parsed.success) throw new Error('A question has an invalid objective answer payload')
    if (question.type === 'MCQ_SINGLE') {
      const payload = McqPayload.parse(question.payload)
      const ids = payload.options.map(option => option.id)
      if (
        new Set(ids).size !== ids.length ||
        payload.correctIds.length !== 1 ||
        !ids.includes(payload.correctIds[0]!)
      )
        throw new Error('A single-choice question has an invalid answer key')
    }
  }
  const author = await prisma.user.findUnique({ where: { email: authorEmail } })
  if (
    !author ||
    !author.emailVerifiedAt ||
    !['PROBLEM_SETTER', 'ADMIN', 'SUPER_ADMIN'].includes(author.role)
  )
    throw new Error('Importer must be a verified staff author')
  await prisma.$transaction(
    async tx => {
      const test = await tx.quizTest.create({
        data: {
          slug: draft.slug,
          title: draft.title,
          description: draft.description ?? null,
          durationMinutes: draft.durationMinutes,
          sections: [
            {
              name: 'Objective',
              durationMinutes: draft.durationMinutes,
              numQuestions: draft.questions.length,
              scoringPolicy: { marksPerCorrect: 1, negativeMarks: 0 },
            },
          ],
          isAdaptive: false,
          proctorLevel: 'off',
          requireWebcam: false,
          requireFullscreen: false,
          requireScreenShare: false,
          status: 'draft',
        },
      })
      for (const [index, question] of draft.questions.entries()) {
        const id = randomUUID()
        await tx.quizQuestion.create({
          data: {
            id,
            type: question.type,
            topic: question.topic,
            stemMd: question.stemMd,
            payload: question.payload as Prisma.InputJsonValue,
            difficultyBand: question.difficultyBand,
            authorId: author.id,
            status: 'DRAFT',
            testItems: { create: { testId: test.id, section: 'Objective', orderIndex: index } },
          },
        })
      }
      await tx.auditLog.create({
        data: {
          actorId: author.id,
          action: 'quiz.test.import_draft',
          target: `quizTest:${test.id}`,
          payload: { questionCount: draft.questions.length, slug: draft.slug },
        },
      })
    },
    { isolationLevel: 'Serializable', timeout: 30_000 }
  )
  process.stdout.write(`Draft ${draft.slug} imported for independent review.\n`)
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Import failed'}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
