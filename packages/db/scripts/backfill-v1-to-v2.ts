/**
 * Backfill v1 → v2 — additive migration (DB is shared with gfg-backend).
 *
 * User columns are NOT renamed (gfg-backend reads them). Only Problem-side
 * renames and new-table population happen here.
 *
 *   Problem.description       → Problem.statementMd
 *   Problem.difficulty (1-10) → Problem.difficultyBand
 *   Problem.timeLimit         → Problem.timeLimitMs
 *   Problem.memoryLimit       → Problem.memoryLimitKb
 *   Solution                  → ReferenceSolution (isJury = true)
 *   Submission.executionTime  → Submission.executionTimeMs
 *   Submission.memoryUsed     → Submission.memoryUsedKb
 *   TestCase                  → ProblemTest (writes blobs)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BLOB_ROOT = process.env.SEED_BLOB_ROOT ?? join(process.cwd(), '..', '..', '.local-blobs')

function difficultyBand(level: number): string {
  if (level <= 2) return 'easy'
  if (level <= 5) return 'medium'
  if (level <= 8) return 'hard'
  return 'expert'
}

function writeBlob(slug: string, index: number, kind: 'in' | 'out', body: string): string {
  const key = `migrated/${slug}/${index}.${kind}`
  const target = join(BLOB_ROOT, key)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body, 'utf8')
  return key
}

interface LegacyProblem {
  id: string
  slug: string
  description: string
  difficulty: number
  rating: number | null
  timeLimit: number
  memoryLimit: number
}

interface LegacyTestCase {
  id: string
  problemId: string
  input: string
  expectedOutput: string
  isSample: boolean
  orderIndex: number
}

interface LegacySolution {
  id: string
  problemId: string
  language: string
  code: string
}

interface LegacySubmission {
  id: string
  executionTime: number | null
  memoryUsed: number | null
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    name
  )
  return (rows[0]?.count ?? 0n) > 0n
}

async function backfillProblems(): Promise<void> {
  const problems = await prisma.$queryRawUnsafe<LegacyProblem[]>(
    `SELECT id, slug, description, difficulty, rating, "timeLimit", "memoryLimit" FROM "Problem"`
  )
  for (const p of problems) {
    await prisma.problem.update({
      where: { id: p.id },
      data: {
        statementMd: p.description,
        difficultyBand: difficultyBand(p.difficulty),
        rating: p.rating ?? 1500,
        timeLimitMs: p.timeLimit,
        memoryLimitKb: p.memoryLimit,
      },
    })
  }
  process.stdout.write(`Problems backfilled: ${problems.length}\n`)
}

async function backfillTestCases(): Promise<void> {
  if (!(await tableExists('TestCase'))) {
    process.stdout.write('Skipping TestCase backfill (table missing).\n')
    return
  }
  const tcs = await prisma.$queryRawUnsafe<LegacyTestCase[]>(
    `SELECT t.id, t."problemId", t.input, t."expectedOutput", t."isSample", t."orderIndex"
     FROM "TestCase" t`
  )
  for (const tc of tcs) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { id: tc.problemId },
      select: { slug: true },
    })
    await prisma.problemTest.create({
      data: {
        problemId: tc.problemId,
        orderIndex: tc.orderIndex,
        isSample: tc.isSample,
        inputBlobKey: writeBlob(problem.slug, tc.orderIndex, 'in', tc.input),
        outputBlobKey: writeBlob(problem.slug, tc.orderIndex, 'out', tc.expectedOutput),
        inputSizeBytes: tc.input.length,
      },
    })
  }
  process.stdout.write(`Test cases backfilled: ${tcs.length}\n`)
}

async function backfillSolutions(): Promise<void> {
  if (!(await tableExists('Solution'))) {
    process.stdout.write('Skipping Solution backfill (table missing).\n')
    return
  }
  const sols = await prisma.$queryRawUnsafe<LegacySolution[]>(
    `SELECT id, "problemId", language, code FROM "Solution"`
  )
  for (const s of sols) {
    await prisma.referenceSolution.create({
      data: {
        problemId: s.problemId,
        language: s.language,
        code: s.code,
        isJury: true,
      },
    })
  }
  process.stdout.write(`Reference solutions backfilled: ${sols.length}\n`)
}

async function backfillSubmissions(): Promise<void> {
  const subs = await prisma.$queryRawUnsafe<LegacySubmission[]>(
    `SELECT id, "executionTime", "memoryUsed" FROM "Submission"`
  )
  for (const s of subs) {
    await prisma.submission.update({
      where: { id: s.id },
      data: {
        executionTimeMs: s.executionTime,
        memoryUsedKb: s.memoryUsed,
      },
    })
  }
  process.stdout.write(`Submissions backfilled: ${subs.length}\n`)
}

async function main() {
  process.stdout.write('Starting v1 → v2 backfill...\n')
  await backfillProblems()
  await backfillTestCases()
  await backfillSolutions()
  await backfillSubmissions()
  process.stdout.write('Backfill complete.\n')
}

main()
  .catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
