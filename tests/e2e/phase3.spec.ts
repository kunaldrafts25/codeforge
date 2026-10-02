import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { prisma, type Prisma } from '../../packages/db/src/index'
import { hashPassword } from '../../apps/api/src/auth/password'
import { computeManifestHash } from '../../apps/api/src/contests/manifest'

test('Phase 3 contests, standings, and leaderboard browser journeys', async ({ browser }) => {
  test.setTimeout(180000)
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname)
  ) {
    throw new Error('Disposable browser environment required')
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'StaffPassword123!'
  const candidatePassword = 'CandidatePassword123!'

  await prisma.user.upsert({
    where: { email: 'phase3-candidate@example.test' },
    update: {},
    create: {
      email: 'phase3-candidate@example.test',
      username: 'p3_candidate_e2e',
      passwordHash: await hashPassword(candidatePassword),
      role: 'USER',
      emailVerifiedAt: new Date(),
      rating: 1520,
      contestsCount: 1,
    },
  })

  const adminUser = await prisma.user.findFirstOrThrow({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
  })
  const reviewerUser = await prisma.user.findFirstOrThrow({ where: { role: 'REVIEWER' } })

  const superAdmin = await prisma.user.findUnique({ where: { email: 'admin@gfgmitadt.in' } })
  if (superAdmin && !process.env.SEED_ADMIN_PASSWORD) {
    await prisma.user.update({
      where: { id: superAdmin.id },
      data: { passwordHash: await hashPassword(adminPassword) },
    })
  }

  // Ensure clean candidate participant state
  await prisma.contestParticipant.deleteMany({
    where: { user: { email: 'phase3-candidate@example.test' } },
  })

  const problem = await prisma.problem.upsert({
    where: { slug: 'browser-sum' },
    update: {},
    create: {
      slug: 'browser-sum',
      title: 'Browser Two Sum',
      statementMd: 'Compute sum of two numbers.',
      inputFormat: 'Two numbers',
      outputFormat: 'One number',
      constraints: '1 <= N <= 100',
      difficultyBand: 'easy',
      authorId: adminUser.id,
      isPublic: true,
      status: 'PUBLISHED',
    },
  })

  const pkg = {
    title: 'Browser Two Sum',
    statementMd: 'Compute sum of two numbers.',
    constraints: '1 <= N <= 100',
    inputFormat: 'Two numbers',
    outputFormat: 'One number',
    difficultyBand: 'easy',
    tags: ['math'],
    mode: 'STDIO',
    signature: null,
    languages: ['cpp', 'python'],
    limits: { timeMs: 1000, memoryKb: 131072, outputKb: 64 },
    checker: { kind: 'token', absolute: 0, relative: 0 },
    cases: [{ input: '2 3\n', output: '5\n', sample: true, explanation: '2+3=5' }],
    references: [
      {
        language: 'python',
        code: 'import sys; print(sum(map(int, sys.stdin.read().split())))',
        complexity: 'O(1)',
      },
    ],
    starters: {
      cpp: '#include <iostream>\nint main() { std::cout << 5 << std::endl; }',
      python: 'print(5)',
    },
    hints: [],
    editorial: '',
    rightsBasis: 'Original work',
  }
  const pkgHash = createHash('sha256').update(JSON.stringify(pkg)).digest('hex')

  const version = await prisma.practiceVersion.upsert({
    where: { problemId_number: { problemId: problem.id, number: 1 } },
    update: {
      validation: { status: 'VALIDATED', passed: true },
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
    create: {
      problemId: problem.id,
      number: 1,
      authorId: adminUser.id,
      reviewerId: reviewerUser.id,
      status: 'PUBLISHED',
      validation: { status: 'VALIDATED', passed: true },
      approvedAt: new Date(),
      publishedAt: new Date(),
      packageHash: pkgHash,
      package: pkg as unknown as Prisma.InputJsonValue,
    },
  })

  const contest = await prisma.contest.upsert({
    where: { slug: 'browser-test-contest' },
    update: {
      status: 'RUNNING',
      startTime: new Date(Date.now() - 1800000), // 30 min ago
      endTime: new Date(Date.now() + 5400000), // 90 min in future
      freezeAt: new Date(Date.now() + 3600000), // in 60 min
      isRated: true,
      capacity: 500,
      isPublic: true,
    },
    create: {
      slug: 'browser-test-contest',
      title: 'Browser ICPC Challenge 2026',
      description: 'Official test contest for Phase 3 browser verification',
      format: 'ICPC',
      status: 'RUNNING',
      startTime: new Date(Date.now() - 1800000), // 30 min ago
      endTime: new Date(Date.now() + 5400000), // 90 min in future
      freezeAt: new Date(Date.now() + 3600000), // in 60 min
      isRated: true,
      capacity: 500,
      isPublic: true,
    },
  })

  const manifestProblems = [
    {
      orderIndex: 0,
      label: 'A',
      problemId: problem.id,
      versionId: version.id,
      packageHash: version.packageHash,
      points: 1,
      title: 'Browser Two Sum',
    },
  ]
  const runtimePolicyHash = createHash('sha256').update('policy:gvisor-strict-v1').digest('hex')
  const mHash = computeManifestHash({
    contestId: contest.id,
    revision: 1,
    title: contest.title,
    slug: contest.slug,
    startTime: contest.startTime.toISOString(),
    endTime: contest.endTime.toISOString(),
    registrationOpensAt: contest.startTime.toISOString(),
    registrationClosesAt: contest.endTime.toISOString(),
    capacity: contest.capacity,
    isRated: contest.isRated,
    scoringPolicy: 'icpc-binary-v1',
    ratingPolicy: 'codeforge-pairwise-elo-v1',
    problems: manifestProblems,
    runtimePolicyHash,
  })

  const manifest = await prisma.contestManifest.upsert({
    where: { contestId_revision: { contestId: contest.id, revision: 1 } },
    update: {},
    create: {
      contestId: contest.id,
      revision: 1,
      title: contest.title,
      slug: contest.slug,
      startTime: contest.startTime,
      endTime: contest.endTime,
      registrationOpensAt: contest.startTime,
      registrationClosesAt: contest.endTime,
      capacity: contest.capacity,
      isRated: contest.isRated,
      scoringPolicy: 'icpc-binary-v1',
      ratingPolicy: 'codeforge-pairwise-elo-v1',
      manifestHash: mHash,
      runtimePolicyHash,
      authorId: adminUser.id,
      reviewerId: reviewerUser.id,
      approvedAt: new Date(),
      problems: manifestProblems as unknown as Prisma.InputJsonValue,
      status: 'SEALED',
    },
  })

  await prisma.contest.update({
    where: { id: contest.id },
    data: { activeManifestId: manifest.id },
  })

  // 1. Candidate browser journey: Login -> Discover -> Register -> View Problem -> Standings -> Leaderboard
  const candidateCtx = await browser.newContext()
  const page = await candidateCtx.newPage()
  page.setDefaultTimeout(15000)

  // Candidate login
  await page.goto('http://localhost:3000/login')
  await page.getByLabel('Email', { exact: true }).fill('phase3-candidate@example.test')
  await page.getByLabel('Password', { exact: true }).fill(candidatePassword)
  const candidateLoginPromise = page.waitForResponse(
    response => response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  const loginRes = await candidateLoginPromise
  expect(loginRes.status()).toBe(200)
  await expect(page).toHaveURL(/aptitude/)

  // Candidate discovers contest
  await page.goto('http://localhost:3000/contests')
  await expect(page.getByText('Competitive Contests')).toBeVisible()
  await expect(page.getByText('Browser ICPC Challenge 2026').first()).toBeVisible()

  // Candidate views contest detail page
  await page.goto('http://localhost:3000/contests/browser-test-contest')
  await expect(page.getByText('Browser ICPC Challenge 2026').first()).toBeVisible()

  // Candidate registers if not registered
  const registerBtn = page.getByRole('button', { name: 'Register for Contest' })
  if (await registerBtn.isVisible()) {
    const regResponse = page.waitForResponse(
      response => response.url().includes('/register') && response.request().method() === 'POST'
    )
    await registerBtn.click()
    const regRes = await regResponse
    expect(regRes.status()).toBe(200)
  }
  await expect(page.getByText('Registered').first()).toBeVisible()

  // View Problem A statement and starter code
  await page.getByRole('button', { name: /Problems/i }).click()
  await expect(page.getByText('Browser Two Sum').first()).toBeVisible()

  // Switch to standings tab
  await page.getByRole('button', { name: /Standings/i }).click()
  await expect(page.getByText('Competitor').first()).toBeVisible()
  await expect(page.getByText('Penalty').first()).toBeVisible()

  // Visit global leaderboard
  await page.goto('http://localhost:3000/leaderboard')
  await expect(page.getByText('Global Competition Rankings')).toBeVisible()
  await expect(page.getByText('Competitor').first()).toBeVisible()
  await expect(page.getByText('Rating').first()).toBeVisible()

  // Security check: Candidate is denied access to staff admin panel
  await page.goto('http://localhost:3001/admin/contests')
  await expect(page).toHaveURL(/forbidden|login/)

  // 2. Admin staff browser context
  const adminCtx = await browser.newContext()
  const adminPage = await adminCtx.newPage()
  adminPage.setDefaultTimeout(15000)

  await adminPage.goto('http://localhost:3001/login')
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@gfgmitadt.in')
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword)
  const adminLoginPromise = adminPage.waitForResponse(
    response => response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  const adminLoginRes = await adminLoginPromise
  expect(adminLoginRes.status()).toBe(200)
  await expect(adminPage).toHaveURL(/admin/)

  // Navigate to admin contests
  await adminPage.goto('http://localhost:3001/admin/contests')
  await expect(adminPage.getByText('Contest Management')).toBeVisible()
  await expect(adminPage.getByRole('button', { name: '+ New Contest' })).toBeVisible()

  // Click on existing contest
  await expect(adminPage.getByText('Browser ICPC Challenge 2026').first()).toBeVisible()
  await adminPage.getByText('Browser ICPC Challenge 2026').first().click()
  await expect(adminPage.getByText('Contest Problem Manifest')).toBeVisible()
  await expect(adminPage.getByText('Correction & Rejudge')).toBeVisible()
})
