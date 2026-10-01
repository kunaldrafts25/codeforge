import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

// Local file-store root for test blobs during Stage 0. A1 will replace this with S3.
const SEED_BLOB_ROOT = process.env.SEED_BLOB_ROOT ?? join(process.cwd(), '..', '..', '.local-blobs')

function writeBlob(slug: string, index: number, kind: 'in' | 'out', body: string): string {
  const key = `seed/${slug}/${index}.${kind}`
  const target = join(SEED_BLOB_ROOT, key)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body, 'utf8')
  return key
}

const TWO_SUM = `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.`

const PALINDROME = `Given a string s, determine if it is a palindrome.

A palindrome is a string that reads the same forwards and backwards.

Consider only alphanumeric characters and ignore cases.`

const FIB = `The Fibonacci sequence is defined as:
- F(0) = 0
- F(1) = 1
- F(n) = F(n-1) + F(n-2) for n > 1

Given n, calculate F(n).`

const SEED_TESTS_TWO_SUM = [
  { input: '4 9\n2 7 11 15', output: '0 1', sample: true },
  { input: '3 6\n3 2 4', output: '1 2', sample: true },
  { input: '2 6\n3 3', output: '0 1', sample: false },
  { input: '5 10\n1 2 3 4 6', output: '3 4', sample: false },
]

const SEED_TESTS_PALINDROME = [
  { input: 'A man a plan a canal Panama', output: 'YES', sample: true },
  { input: 'race a car', output: 'NO', sample: true },
  { input: 'hello', output: 'NO', sample: false },
  { input: 'abba', output: 'YES', sample: false },
]

const SEED_TESTS_FIB = [
  { input: '2', output: '1', sample: true },
  { input: '10', output: '55', sample: true },
  { input: '0', output: '0', sample: false },
  { input: '20', output: '6765', sample: false },
]

function buildTests(slug: string, rows: { input: string; output: string; sample: boolean }[]) {
  return rows.map((t, i) => ({
    orderIndex: i,
    isSample: t.sample,
    inputBlobKey: writeBlob(slug, i, 'in', t.input),
    outputBlobKey: writeBlob(slug, i, 'out', t.output),
    inputSizeBytes: t.input.length,
  }))
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (
    !databaseUrl ||
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error('Seed requires a disposable database and SEED_DISPOSABLE_DATABASE=1')
  }
  const host = new URL(databaseUrl).hostname
  if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
    throw new Error('Seed is restricted to a local disposable PostgreSQL host')
  }
  const seedPassword = process.env.SEED_ADMIN_PASSWORD
  if (!seedPassword || seedPassword.length < 16) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set to a unique password of at least 16 characters'
    )
  }
  const adminPassword = await argon2.hash(seedPassword, { type: argon2.argon2id })
  const reviewerSeedPassword = process.env.SEED_REVIEWER_PASSWORD
  if (
    !reviewerSeedPassword ||
    reviewerSeedPassword.length < 16 ||
    reviewerSeedPassword === seedPassword
  ) {
    throw new Error('SEED_REVIEWER_PASSWORD must be distinct and at least 16 characters')
  }
  const reviewerPassword = await argon2.hash(reviewerSeedPassword, { type: argon2.argon2id })

  const admin = await prisma.user.upsert({
    where: { email: 'admin@gfgmitadt.in' },
    update: { passwordHash: adminPassword },
    create: {
      email: 'admin@gfgmitadt.in',
      emailVerifiedAt: new Date(),
      username: 'admin',
      displayName: 'Admin',
      passwordHash: adminPassword,
      passwordAlgo: 'argon2id',
      role: 'SUPER_ADMIN',
      rating: 1500,
      maxRating: 1500,
    },
  })
  await prisma.user.upsert({
    where: { email: 'pilot-reviewer@codeforge.test' },
    update: { passwordHash: reviewerPassword },
    create: {
      email: 'pilot-reviewer@codeforge.test',
      emailVerifiedAt: new Date(),
      username: 'pilot_reviewer',
      displayName: 'Pilot reviewer',
      passwordHash: reviewerPassword,
      passwordAlgo: 'argon2id',
      role: 'REVIEWER',
    },
  })

  await prisma.problem.upsert({
    where: { slug: 'two-sum' },
    update: {},
    create: {
      slug: 'two-sum',
      title: 'Two Sum',
      statementMd: TWO_SUM,
      inputFormat:
        'First line contains two integers N and target.\nSecond line contains N space-separated integers.',
      outputFormat: 'Print two space-separated indices (0-indexed).',
      constraints: '2 <= N <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9',
      difficultyBand: 'easy',
      rating: 1000,
      timeLimitMs: 2000,
      memoryLimitKb: 262144,
      tags: ['array', 'hash-map'],
      status: 'PUBLISHED',
      isPublic: true,
      publishedAt: new Date(),
      authorId: admin.id,
      tests: { create: buildTests('two-sum', SEED_TESTS_TWO_SUM) },
    },
  })

  await prisma.problem.upsert({
    where: { slug: 'palindrome-check' },
    update: {},
    create: {
      slug: 'palindrome-check',
      title: 'Palindrome Check',
      statementMd: PALINDROME,
      inputFormat: 'A single line containing the string s.',
      outputFormat: 'Print "YES" if palindrome, "NO" otherwise.',
      constraints: '1 <= |s| <= 10^5\nString contains printable ASCII characters.',
      difficultyBand: 'easy',
      rating: 800,
      timeLimitMs: 1000,
      memoryLimitKb: 262144,
      tags: ['string', 'two-pointers'],
      status: 'PUBLISHED',
      isPublic: true,
      publishedAt: new Date(),
      authorId: admin.id,
      tests: { create: buildTests('palindrome-check', SEED_TESTS_PALINDROME) },
    },
  })

  await prisma.problem.upsert({
    where: { slug: 'fibonacci-sequence' },
    update: {},
    create: {
      slug: 'fibonacci-sequence',
      title: 'Fibonacci Number',
      statementMd: FIB,
      inputFormat: 'A single integer n.',
      outputFormat: 'Print F(n).',
      constraints: '0 <= n <= 30',
      difficultyBand: 'easy',
      rating: 900,
      timeLimitMs: 1000,
      memoryLimitKb: 262144,
      tags: ['math', 'recursion', 'dynamic-programming'],
      status: 'PUBLISHED',
      isPublic: true,
      publishedAt: new Date(),
      authorId: admin.id,
      tests: { create: buildTests('fibonacci-sequence', SEED_TESTS_FIB) },
    },
  })

  const p1 = await prisma.problem.findUniqueOrThrow({ where: { slug: 'two-sum' } })
  const p2 = await prisma.problem.findUniqueOrThrow({ where: { slug: 'palindrome-check' } })
  const p3 = await prisma.problem.findUniqueOrThrow({ where: { slug: 'fibonacci-sequence' } })

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(18, 0, 0, 0)
  const endTime = new Date(tomorrow)
  endTime.setHours(20, 0, 0, 0)

  await prisma.contest.upsert({
    where: { slug: 'weekly-contest-1' },
    update: {},
    create: {
      slug: 'weekly-contest-1',
      title: 'Weekly Contest #1',
      description: 'First weekly contest of CodeForge! Test your skills.',
      startTime: tomorrow,
      endTime,
      isRated: false,
      isPublic: false,
      status: 'DRAFT',
      format: 'ICPC',
      problems: {
        create: [
          { problemId: p2.id, label: 'A', points: 100 },
          { problemId: p1.id, label: 'B', points: 200 },
          { problemId: p3.id, label: 'C', points: 200 },
        ],
      },
    },
  })

  // Original demo items stay in draft until a different authorized reviewer
  // checks the wording, answer keys and rights in the admin review screen.
  const questions = [
    {
      id: '018f8148-2201-7630-9da3-055be4d71851',
      type: 'MCQ_SINGLE' as const,
      stemMd:
        'A train travels 150 km in 3 hours at a constant speed. How far does it travel in 5 hours?',
      payload: {
        options: [
          { id: 'a', text: '200 km' },
          { id: 'b', text: '250 km' },
          { id: 'c', text: '300 km' },
          { id: 'd', text: '350 km' },
        ],
        correctIds: ['b'],
        explanation: 'The speed is 50 km/h, so in 5 hours the train travels 250 km.',
      },
      topic: 'quantitative-reasoning',
    },
    {
      id: '018f8148-2201-7630-9da3-055be4d71852',
      type: 'TRUE_FALSE' as const,
      stemMd: 'If every square is a rectangle, then every rectangle is a square.',
      payload: { correct: false, explanation: 'A rectangle can have unequal adjacent sides.' },
      topic: 'logical-reasoning',
    },
  ]
  for (const q of questions) {
    await prisma.quizQuestion.upsert({
      where: { id: q.id },
      update: {},
      create: {
        ...q,
        authorId: admin.id,
        difficultyBand: 'L1',
        status: 'DRAFT',
      },
    })
  }
  await prisma.quizTest.upsert({
    where: { slug: 'reasoning-demo' },
    update: {},
    create: {
      slug: 'reasoning-demo',
      title: 'Reasoning fundamentals',
      description: 'Two short questions on arithmetic and logic.',
      durationMinutes: 10,
      sections: [
        {
          name: 'Reasoning',
          durationMinutes: 10,
          numQuestions: 2,
          scoringPolicy: { marksPerCorrect: 1, negativeMarks: 0 },
        },
      ],
      isAdaptive: false,
      proctorLevel: 'off',
      requireWebcam: false,
      requireFullscreen: false,
      requireScreenShare: false,
      status: 'draft',
      items: {
        create: questions.map((q, index) => ({
          questionId: q.id,
          section: 'Reasoning',
          orderIndex: index,
        })),
      },
    },
  })

  process.stdout.write(`Seed completed. Blobs written to ${SEED_BLOB_ROOT}\n`)
}

main()
  .catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
