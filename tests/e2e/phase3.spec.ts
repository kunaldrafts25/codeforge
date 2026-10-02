import { expect, test } from '@playwright/test'
import { prisma } from '../../packages/db/src/index'
import { hashPassword } from '../../apps/api/src/auth/password'

test('Phase 3 contests, standings, and leaderboard browser journeys', async ({ browser }) => {
  test.setTimeout(180000)
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname)
  ) {
    throw new Error('Disposable browser environment required')
  }

  // Seed test contest if not existing
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

  await prisma.contest.upsert({
    where: { slug: 'browser-test-contest' },
    update: {},
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

  // 1. Candidate browser context
  const candidateCtx = await browser.newContext()
  const page = await candidateCtx.newPage()
  page.setDefaultTimeout(15000)

  // Visit contests page
  await page.goto('http://localhost:3000/contests')
  await expect(page.getByText('Competitive Contests')).toBeVisible()
  await expect(page.getByText('Browser ICPC Challenge 2026')).toBeVisible()

  // Visit contest detail page
  await page.goto('http://localhost:3000/contests/browser-test-contest')
  await expect(page.getByText('Browser ICPC Challenge 2026')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Register for Contest' })).toBeVisible()

  // Switch to standings tab
  await page.getByRole('button', { name: /Standings/i }).click()
  await expect(page.getByText('Competitor')).toBeVisible()
  await expect(page.getByText('Penalty')).toBeVisible()

  // Visit global leaderboard
  await page.goto('http://localhost:3000/leaderboard')
  await expect(page.getByText('Global Competition Rankings')).toBeVisible()
  await expect(page.getByText('Competitor')).toBeVisible()
  await expect(page.getByText('Rating')).toBeVisible()

  // 2. Admin staff browser context
  const adminCtx = await browser.newContext()
  const adminPage = await adminCtx.newPage()
  adminPage.setDefaultTimeout(15000)

  await adminPage.goto('http://localhost:3001/login')
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@gfgmitadt.in')
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword)
  await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(adminPage).toHaveURL(/admin/)

  // Navigate to admin contests
  await adminPage.goto('http://localhost:3001/admin/contests')
  await expect(adminPage.getByText('Contest Management')).toBeVisible()
  await expect(adminPage.getByRole('button', { name: '+ New Contest' })).toBeVisible()

  // Click on existing contest
  await adminPage.getByText('Browser ICPC Challenge 2026').click()
  await expect(adminPage.getByText('Contest Problem Manifest')).toBeVisible()
  await expect(adminPage.getByText('Correction & Rejudge')).toBeVisible()
})
