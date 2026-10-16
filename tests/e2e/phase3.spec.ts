import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../packages/db/src/index'
import { hashPassword } from '../../apps/api/src/auth/password'
import { PracticePackage } from '../../packages/shared/src/schemas/practice'

test('Phase 3 complete contest lifecycle: authoring, registration, real submissions, ICPC standings, freeze, finalization, ratings, disputes and replay', async ({
  browser,
}) => {
  test.setTimeout(600000)
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname)
  ) {
    throw new Error('Disposable browser environment required')
  }

  const fixture = randomBytes(4).toString('hex')
  const contestSlug = `p3-contest-${fixture}`
  const contestTitle = `Browser ICPC Grand Prix ${fixture}`
  const problemSlug = `p3-sum-${fixture}`

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'StaffPassword123!'
  const reviewerPassword = process.env.SEED_REVIEWER_PASSWORD || 'ReviewerPassword123!'
  const compPassword = 'CandidatePassword123!'

  // Ensure Admin and Reviewer staff accounts exist with known passwords
  await prisma.user.upsert({
    where: { email: 'admin@gfgmitadt.in' },
    update: { passwordHash: await hashPassword(adminPassword) },
    create: {
      email: 'admin@gfgmitadt.in',
      username: `admin_${fixture}`,
      displayName: 'System Admin',
      passwordHash: await hashPassword(adminPassword),
      role: 'SUPER_ADMIN',
      emailVerifiedAt: new Date(),
      rating: 1500,
      maxRating: 1500,
    },
  })

  await prisma.user.upsert({
    where: { email: 'pilot-reviewer@codeforge.test' },
    update: { passwordHash: await hashPassword(reviewerPassword) },
    create: {
      email: 'pilot-reviewer@codeforge.test',
      username: `reviewer_${fixture}`,
      displayName: 'Pilot Reviewer',
      passwordHash: await hashPassword(reviewerPassword),
      role: 'REVIEWER',
      emailVerifiedAt: new Date(),
    },
  })

  // Three distinct authenticated competitors
  await prisma.user.upsert({
    where: { email: `p3-comp1-${fixture}@example.test` },
    update: { passwordHash: await hashPassword(compPassword) },
    create: {
      email: `p3-comp1-${fixture}@example.test`,
      username: `p3_comp1_${fixture}`,
      displayName: `Competitor One ${fixture}`,
      passwordHash: await hashPassword(compPassword),
      role: 'USER',
      emailVerifiedAt: new Date(),
      rating: 1500,
      maxRating: 1500,
      contestsCount: 0,
    },
  })

  await prisma.user.upsert({
    where: { email: `p3-comp2-${fixture}@example.test` },
    update: { passwordHash: await hashPassword(compPassword) },
    create: {
      email: `p3-comp2-${fixture}@example.test`,
      username: `p3_comp2_${fixture}`,
      displayName: `Competitor Two ${fixture}`,
      passwordHash: await hashPassword(compPassword),
      role: 'USER',
      emailVerifiedAt: new Date(),
      rating: 1600,
      maxRating: 1600,
      contestsCount: 0,
    },
  })

  const comp3User = await prisma.user.upsert({
    where: { email: `p3-comp3-${fixture}@example.test` },
    update: { passwordHash: await hashPassword(compPassword) },
    create: {
      email: `p3-comp3-${fixture}@example.test`,
      username: `p3_comp3_${fixture}`,
      displayName: `Competitor Three ${fixture}`,
      passwordHash: await hashPassword(compPassword),
      role: 'USER',
      emailVerifiedAt: new Date(),
      rating: 1400,
      maxRating: 1400,
      contestsCount: 0,
    },
  })

  const pkg = PracticePackage.parse({
    title: 'Browser Two Sum',
    statementMd: 'Compute sum of two numbers.',
    constraints: '1 <= N <= 100',
    inputFormat: 'Two numbers a and b',
    outputFormat: 'One number a + b',
    difficultyBand: 'easy',
    tags: ['math'],
    mode: 'STDIO',
    signature: null,
    languages: ['cpp', 'python'],
    limits: { timeMs: 1000, memoryKb: 131072, outputKb: 64 },
    checker: { kind: 'token', absolute: 0, relative: 0 },
    cases: [
      { input: '2 3\n', output: '5\n', sample: true, explanation: '2+3=5' },
      { input: '10 20\n', output: '30\n', sample: false, explanation: '10+20=30' },
    ],
    references: [
      {
        language: 'python',
        code: 'import sys; print(sum(map(int, sys.stdin.read().split())))',
        complexity: 'O(1)',
      },
    ],
    starters: {
      cpp: '#include <iostream>\nint main() { std::cout << 5 << std::endl; }',
      python: 'a,b=map(int,input().split());print(a+b)',
    },
    hints: [],
    editorial: '',
    rightsBasis: 'Original work',
  })
  // The wrapper starts a genuine isolated worker; this helper only observes its
  // results. No browser acceptance test writes verdicts or runtime evidence.
  async function waitForJudge(subId: string, verdict: string) {
    await expect
      .poll(
        async () => {
          const sub = await prisma.contestSubmission.findUniqueOrThrow({
            where: { id: subId },
            include: { job: true },
          })
          if (sub.job.state === 'DEAD_LETTER') throw new Error('Real judge job dead-lettered')
          return sub.job.state === 'TERMINAL' ? sub.job.verdict : null
        },
        { timeout: 180000 }
      )
      .toBe(verdict)
    const sub = await prisma.contestSubmission.findUniqueOrThrow({
      where: { id: subId },
      include: { job: true },
    })
    expect((sub.job.privateResult as Record<string, unknown>)?.executed).toBe(true)
    expect(sub.verdict).toBe(verdict)
  }

  // =========================================================================
  // 1. Admin creates contest & drafts problem manifest; Reviewer seals manifest
  // =========================================================================
  const adminCtx = await browser.newContext({ timezoneId: 'UTC' })
  const adminPage = await adminCtx.newPage()
  adminPage.setDefaultTimeout(20000)

  // Admin login
  await adminPage.goto('http://localhost:3001/login')
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@gfgmitadt.in')
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword)
  const adminLoginPromise = adminPage.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  const adminLoginRes = await adminLoginPromise
  expect(adminLoginRes.status()).toBe(200)
  await expect(adminPage).toHaveURL(/admin/)

  async function staffPost(page: typeof adminPage, path: string, body: unknown) {
    const csrf = await page.request.get('http://localhost:5000/api/auth/csrf')
    const token = (await csrf.json()).csrfToken as string
    const res = await page.request.post(`http://localhost:5000/api${path}`, {
      data: body,
      headers: { 'x-csrf-token': token },
    })
    expect(res.status(), await res.text()).toBe(200)
    return res.json()
  }
  const version = await staffPost(adminPage, '/practice/staff/versions', {
    slug: `${problemSlug}-real`,
    package: pkg,
  })
  // The API owns the new problem ID. The earlier problem is an unused public metadata fixture.
  const realVersion = await prisma.practiceVersion.findUniqueOrThrow({ where: { id: version.id } })
  const validation = await staffPost(
    adminPage,
    `/practice/staff/versions/${version.id}/validate`,
    {}
  )
  for (const job of validation.jobs) {
    await expect
      .poll(
        async () => (await prisma.practiceJob.findUniqueOrThrow({ where: { id: job.id } })).verdict,
        { timeout: 180000 }
      )
      .toBe('ACCEPTED')
  }
  await expect
    .poll(
      async () =>
        (await prisma.practiceVersion.findUniqueOrThrow({ where: { id: version.id } })).status
    )
    .toBe('VALIDATED')

  // Admin navigates to Contest Management
  await adminPage.goto('http://localhost:3001/admin/contests')
  await expect(adminPage.getByText('Contest Management')).toBeVisible()

  // Open create contest form
  await adminPage.getByRole('button', { name: '+ New Contest' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Create New Contest' })).toBeVisible()

  // Fill contest details
  await adminPage.getByPlaceholder('CodeForge Round 1 (ICPC Div. 2)').fill(contestTitle)
  await adminPage.getByPlaceholder('codeforge-round-1').fill(contestSlug)
  await adminPage
    .getByPlaceholder('ICPC rules contest featuring 6 algorithmic challenges.')
    .fill('Phase 3 browser journey competitive contest.')

  const startTimeIso = new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16)
  const endTimeIso = new Date(Date.now() + 90 * 60000).toISOString().slice(0, 16)
  const freezeTimeIso = new Date(Date.now() + 60 * 60000).toISOString().slice(0, 16)

  const dateInputs = adminPage.locator('input[type="datetime-local"]')
  await dateInputs.nth(0).fill(startTimeIso)
  await dateInputs.nth(1).fill(endTimeIso)
  await dateInputs.nth(2).fill(freezeTimeIso)

  // Save & publish draft contest
  const createPromise = adminPage.waitForResponse(
    r => r.url().endsWith('/api/contests') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Save & Publish Contest' }).click()
  const createRes = await createPromise
  expect(createRes.status()).toBe(200)
  await expect(adminPage.getByText(`Contest "${contestTitle}" created successfully!`)).toBeVisible()

  // Select contest from list
  await adminPage.getByText(contestTitle).first().click()
  await expect(adminPage.getByText('Contest Problem Manifest')).toBeVisible()

  // Draft problem manifest: add Problem A
  await adminPage.getByPlaceholder('e.g. 1a2b3c4d-...').fill(realVersion.problemId)
  await adminPage.getByPlaceholder('e.g. 9z8y7x6w-...').fill(version.id)
  await adminPage.getByPlaceholder('Two Sum').fill('Browser Two Sum')
  await adminPage.getByRole('button', { name: '+ Add Item' }).click()
  await expect(adminPage.getByText('Browser Two Sum').first()).toBeVisible()

  // Save draft manifest
  const draftPromise = adminPage.waitForResponse(
    r => r.url().includes('/manifest') && r.request().method() === 'PUT'
  )
  await adminPage.getByRole('button', { name: 'Save Draft' }).click()
  const draftRes = await draftPromise
  expect(draftRes.status()).toBe(200)
  await expect(adminPage.getByText('Draft manifest saved successfully')).toBeVisible()

  // Reviewer context: log in to review and seal manifest (4-eyes enforcement)
  const reviewerCtx = await browser.newContext({ timezoneId: 'UTC' })
  const reviewerPage = await reviewerCtx.newPage()
  reviewerPage.setDefaultTimeout(20000)

  await reviewerPage.goto('http://localhost:3001/login')
  await reviewerPage.getByLabel('Email', { exact: true }).fill('pilot-reviewer@codeforge.test')
  await reviewerPage.getByLabel('Password', { exact: true }).fill(reviewerPassword)
  const reviewerLoginPromise = reviewerPage.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
  )
  await reviewerPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  const reviewerLoginRes = await reviewerLoginPromise
  expect(reviewerLoginRes.status()).toBe(200)

  // Reviewer visits contest management and selects contest
  await reviewerPage.goto('http://localhost:3001/admin/contests')
  await reviewerPage.getByText(contestTitle).first().click()
  await expect(reviewerPage.getByText('Browser Two Sum').first()).toBeVisible()

  // Reviewer seals manifest (handle browser confirmation dialog)
  reviewerPage.on('dialog', dialog => dialog.accept())
  const sealPromise = reviewerPage.waitForResponse(
    r => r.url().includes('/seal') && r.request().method() === 'POST'
  )
  await reviewerPage.getByRole('button', { name: 'Seal Manifest (Lock)' }).click()
  const sealRes = await sealPromise
  expect(sealRes.status()).toBe(200)
  await expect(reviewerPage.getByText(/Manifest sealed successfully!/i)).toBeVisible()

  // Registration takes place before contest start; the disposable clock advances below.

  // =========================================================================
  // 2. Three competitors discover contest and register before deadline
  // =========================================================================
  const comp1Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const comp2Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const comp3Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }) // Mobile viewport
  const page1 = await comp1Ctx.newPage()
  const page2 = await comp2Ctx.newPage()
  const page3 = await comp3Ctx.newPage()
  page1.setDefaultTimeout(20000)
  page2.setDefaultTimeout(20000)
  page3.setDefaultTimeout(20000)

  // Competitor 1 login
  await page1.goto('http://localhost:3000/login')
  await page1.getByLabel('Email', { exact: true }).fill(`p3-comp1-${fixture}@example.test`)
  await page1.getByLabel('Password', { exact: true }).fill(compPassword)
  const comp1LoginPromise = page1.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
  )
  await page1.getByRole('button', { name: 'Sign In', exact: true }).click()
  expect((await comp1LoginPromise).status()).toBe(200)
  await expect(page1).toHaveURL(/aptitude/)

  // Competitor 2 login
  await page2.goto('http://localhost:3000/login')
  await page2.getByLabel('Email', { exact: true }).fill(`p3-comp2-${fixture}@example.test`)
  await page2.getByLabel('Password', { exact: true }).fill(compPassword)
  const comp2LoginPromise = page2.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
  )
  await page2.getByRole('button', { name: 'Sign In', exact: true }).click()
  expect((await comp2LoginPromise).status()).toBe(200)

  // Competitor 3 login
  await page3.goto('http://localhost:3000/login')
  await page3.getByLabel('Email', { exact: true }).fill(`p3-comp3-${fixture}@example.test`)
  await page3.getByLabel('Password', { exact: true }).fill(compPassword)
  const comp3LoginPromise = page3.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
  )
  await page3.getByRole('button', { name: 'Sign In', exact: true }).click()
  expect((await comp3LoginPromise).status()).toBe(200)

  // Competitor 1 discovers contest on listing page
  await page1.goto('http://localhost:3000/contests')
  await expect(page1.getByText('Competitive Contests')).toBeVisible()
  await expect(page1.getByText(contestTitle).first()).toBeVisible()

  // Competitor 1 registers
  await page1.goto(`http://localhost:3000/contests/${contestSlug}`)
  await expect(page1.getByText(contestTitle).first()).toBeVisible()
  const regPromise1 = page1.waitForResponse(
    r => r.url().includes('/register') && r.request().method() === 'POST'
  )
  await page1.getByRole('button', { name: 'Register for Contest' }).click()
  expect((await regPromise1).status()).toBe(200)
  await expect(page1.getByText('Registered').first()).toBeVisible()

  // Competitor 2 registers
  await page2.goto(`http://localhost:3000/contests/${contestSlug}`)
  const regPromise2 = page2.waitForResponse(
    r => r.url().includes('/register') && r.request().method() === 'POST'
  )
  await page2.getByRole('button', { name: 'Register for Contest' }).click()
  expect((await regPromise2).status()).toBe(200)
  await expect(page2.getByText('Registered').first()).toBeVisible()

  // Competitor 3 registers on mobile viewport
  await page3.goto(`http://localhost:3000/contests/${contestSlug}`)
  const regPromise3 = page3.waitForResponse(
    r => r.url().includes('/register') && r.request().method() === 'POST'
  )
  await page3.getByRole('button', { name: 'Register for Contest' }).click()
  expect((await regPromise3).status()).toBe(200)
  await expect(page3.getByText('Registered').first()).toBeVisible()
  expect(
    await page3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)

  // Advance only the disposable contest's clock after all three real registrations.
  await prisma.contest.update({
    where: { slug: contestSlug },
    data: { status: 'RUNNING', startTime: new Date(Date.now() - 60000) },
  })
  await Promise.all([page1.reload(), page2.reload(), page3.reload()])

  // =========================================================================
  // 3. Inspect problem statement, language choices, sample test cases, starter code
  // =========================================================================
  await page1.getByRole('button', { name: /Problems/i }).click()
  await expect(page1.getByText('Browser Two Sum').first()).toBeVisible()
  await expect(page1.getByText('1 pts').first()).toBeVisible()

  // Inspect problem statement Markdown, constraints, input/output
  await expect(page1.getByText('Compute sum of two numbers.').first()).toBeVisible()
  await expect(page1.getByText('1 <= N <= 100').first()).toBeVisible()
  await expect(page1.getByText('Two numbers a and b').first()).toBeVisible()
  await expect(page1.getByText('One number a + b').first()).toBeVisible()

  // Inspect sample test cases
  await expect(page1.getByText('2 3').first()).toBeVisible()
  await expect(page1.getByText('5').first()).toBeVisible()

  // Inspect language selector and switch to Python
  const langSelect = page1.locator('select').first()
  await expect(langSelect).toBeVisible()
  await langSelect.selectOption('python')

  // Inspect starter code loaded in textarea
  const codeArea1 = page1.locator('textarea').first()
  await expect(codeArea1).toHaveValue('a,b=map(int,input().split());print(a+b)')

  // Drafts survive reload for the same authenticated competitor/problem/language.
  await codeArea1.fill('a,b=map(int,input().split());print(a+b) # saved draft')
  await page1.reload()
  await expect(page1.locator('select').first()).toHaveValue('cpp')
  await page1.locator('select').first().selectOption('python')
  await expect(codeArea1).toHaveValue('a,b=map(int,input().split());print(a+b) # saved draft')
  await expect(page1.locator('select').first().locator('option')).toHaveCount(2)

  // =========================================================================
  // 4. Competitors submit real code (exercising AC, WA)
  // =========================================================================

  // Competitor 1: Submits correct solution -> ACCEPTED
  const comp1SubPromise = page1.waitForResponse(
    r => r.url().includes('/submit') && r.request().method() === 'POST'
  )
  await page1.getByRole('button', { name: 'Submit Code' }).click()
  const comp1SubRes = await comp1SubPromise
  expect(comp1SubRes.status()).toBe(200)
  const comp1SubData = (await comp1SubRes.json()) as { id: string }
  await waitForJudge(comp1SubData.id, 'ACCEPTED')
  await expect(page1.getByText('ACCEPTED').first()).toBeVisible({ timeout: 15000 })

  // Competitor 2: Submits incorrect solution -> WRONG_ANSWER
  await page2.getByRole('button', { name: /Problems/i }).click()
  const langSelect2 = page2.locator('select').first()
  await langSelect2.selectOption('python')
  const codeArea2 = page2.locator('textarea').first()
  await codeArea2.fill('print(0)')

  const comp2SubPromise1 = page2.waitForResponse(
    r => r.url().includes('/submit') && r.request().method() === 'POST'
  )
  await page2.getByRole('button', { name: 'Submit Code' }).click()
  const comp2SubRes1 = await comp2SubPromise1
  expect(comp2SubRes1.status()).toBe(200)
  const comp2SubData1 = (await comp2SubRes1.json()) as { id: string }
  await waitForJudge(comp2SubData1.id, 'WRONG_ANSWER')
  await expect(page2.getByText('WRONG_ANSWER').first()).toBeVisible({ timeout: 15000 })

  // Competitor 2 fixes code and submits correct solution -> ACCEPTED (attempt 2)
  await codeArea2.fill('a,b=map(int,input().split());print(a+b)')
  const comp2SubPromise2 = page2.waitForResponse(
    r => r.url().includes('/submit') && r.request().method() === 'POST'
  )
  await page2.getByRole('button', { name: 'Submit Code' }).click()
  const comp2SubRes2 = await comp2SubPromise2
  expect(comp2SubRes2.status()).toBe(200)
  const comp2SubData2 = (await comp2SubRes2.json()) as { id: string }
  await waitForJudge(comp2SubData2.id, 'ACCEPTED')
  await expect(page2.getByText('ACCEPTED').first()).toBeVisible({ timeout: 15000 })

  // Competitor 3: Submits incorrect solution -> WRONG_ANSWER (unsolved)
  await page3.getByRole('button', { name: /Problems/i }).click()
  const langSelect3 = page3.locator('select').first()
  await langSelect3.selectOption('python')
  const codeArea3 = page3.locator('textarea').first()
  await codeArea3.fill('print(99)')

  const comp3SubPromise = page3.waitForResponse(
    r => r.url().includes('/submit') && r.request().method() === 'POST'
  )
  await page3.getByRole('button', { name: 'Submit Code' }).click()
  const comp3SubRes = await comp3SubPromise
  expect(comp3SubRes.status()).toBe(200)
  const comp3SubData = (await comp3SubRes.json()) as { id: string }
  await waitForJudge(comp3SubData.id, 'WRONG_ANSWER')
  await expect(page3.getByText('WRONG_ANSWER').first()).toBeVisible({ timeout: 15000 })

  // =========================================================================
  // 5. Standings table updates live with ICPC scoring (+penalty)
  // =========================================================================
  await page1.getByRole('button', { name: /Standings/i }).click()
  await expect(page1.getByText('Competitor').first()).toBeVisible()
  await expect(page1.getByText('Penalty').first()).toBeVisible()

  // Wait for competitor rows to render in standings table
  await expect(page1.getByText(`Competitor One ${fixture}`).first()).toBeVisible()
  await expect(page1.getByText(`Competitor Two ${fixture}`).first()).toBeVisible()
  await expect(page1.getByText(`Competitor Three ${fixture}`).first()).toBeVisible()

  // Competitor 1 has rank 1 (🥇 1) with clean solve (+0 / +)
  await expect(page1.getByText('🥇 1').first()).toBeVisible()

  // Competitor 2 has rank 2 (🥈 2) with 1 prior penalty attempt (+1)
  await expect(page1.getByText('🥈 2').first()).toBeVisible()
  await expect(page1.getByText('+1').first()).toBeVisible()

  // Competitor 3 has rank 3 (🥉 3) with unsolved attempt (-1)
  await expect(page1.getByText('🥉 3').first()).toBeVisible()
  await expect(page1.getByText('-1').first()).toBeVisible()

  // =========================================================================
  // 6. Scoreboard freeze activates, unverified/frozen submissions shown
  // =========================================================================
  // Activate freeze in database
  await prisma.contest.update({
    where: { slug: contestSlug },
    data: { freezeAt: new Date() },
  })

  // Competitor 3 submits correct code during freeze window
  await page3.getByRole('button', { name: /Problems/i }).click()
  await codeArea3.fill('a,b=map(int,input().split());print(a+b)')
  const comp3FreezeSubPromise = page3.waitForResponse(
    r => r.url().includes('/submit') && r.request().method() === 'POST'
  )
  await page3.getByRole('button', { name: 'Submit Code' }).click()
  const comp3FreezeSubRes = await comp3FreezeSubPromise
  expect(comp3FreezeSubRes.status()).toBe(200)
  const comp3FreezeData = (await comp3FreezeSubRes.json()) as { id: string }
  await waitForJudge(comp3FreezeData.id, 'ACCEPTED')

  // Competitor 1 refreshes standings during freeze
  await page1.getByRole('button', { name: /Refresh Standings/i }).click()
  await expect(page1.getByText(/Scoreboard is frozen/i)).toBeVisible()

  // Competitor 3 shows pending frozen badge (?) on problem A
  await expect(page1.getByText(/\?/).first()).toBeVisible()

  // =========================================================================
  // 7. Admin finalizes contest, unfreezes board
  // =========================================================================
  // End contest in database to satisfy finalization boundary
  await prisma.contest.update({
    where: { slug: contestSlug },
    data: { status: 'ENDED', endTime: new Date(Date.now() - 1000) },
  })

  // Admin navigates to contest details in admin panel and finalizes
  await adminPage.goto('http://localhost:3001/admin/contests')
  await adminPage.getByText(contestTitle).first().click()

  adminPage.on('dialog', dialog => dialog.accept())
  const finalizePromise = adminPage.waitForResponse(
    r => r.url().includes('/finalize') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Finalize Contest & Compute Ratings' }).click()
  const finalizeRes = await finalizePromise
  expect(finalizeRes.status()).toBe(200)
  await expect(adminPage.getByText(/Contest finalized successfully!/i)).toBeVisible({
    timeout: 180000,
  })

  // Competitor 1 refreshes standings: board is unfrozen, freeze banner removed
  await page1.getByRole('button', { name: /Refresh Standings/i }).click()
  await expect(page1.getByText(/Scoreboard is frozen/i)).not.toBeVisible()

  // =========================================================================
  // 8. Ratings are updated, competitors view updated ratings and leaderboard
  // =========================================================================
  // Competitor 1 views profile
  await page1.goto('http://localhost:3000/profile')
  await expect(page1.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page1.getByText('Rating').first()).toBeVisible()
  await expect(page1.getByText('Contests').first()).toBeVisible()

  // Competitor 1 visits global leaderboard
  await page1.goto('http://localhost:3000/leaderboard')
  await expect(page1.getByText('Global Competition Rankings')).toBeVisible()
  await expect(page1.getByText(`Competitor One ${fixture}`).first()).toBeVisible()

  // Security check: competitor cannot access staff admin portal
  await page1.goto('http://localhost:3001/admin/contests')
  await expect(page1).toHaveURL(/forbidden|login/)

  // =========================================================================
  // 9. Competitor files dispute, admin reviews dispute, rejudges submission, standings and ratings recalculate
  // =========================================================================
  // Competitor 3 opens contest page and files dispute
  await page3.goto(`http://localhost:3000/contests/${contestSlug}`)
  await page3.getByRole('button', { name: 'File Contest Dispute' }).click()
  await expect(page3.getByText('File Contest Dispute').first()).toBeVisible()

  await page3
    .getByPlaceholder('Explain the discrepancy or test case issue...')
    .fill('Test case output format had trailing whitespace discrepancy.')
  const disputePromise = page3.waitForResponse(
    r => r.url().includes('/disputes') && r.request().method() === 'POST'
  )
  await page3.getByRole('button', { name: 'Submit Dispute' }).click()
  const disputeRes = await disputePromise
  expect(disputeRes.status()).toBe(200)
  await expect(page3.getByText(/Contest dispute filed successfully!/i)).toBeVisible()

  // Admin reviews dispute on admin contests page
  await adminPage.goto('http://localhost:3001/admin/contests')
  await adminPage.getByText(contestTitle).first().click()

  // Open dispute resolution form
  await expect(adminPage.getByText('Contest Disputes').first()).toBeVisible()
  await adminPage.getByText('Problem A', { exact: true }).last().click()

  await adminPage
    .getByPlaceholder('Resolution details and explanation...')
    .fill('Dispute accepted. Submissions rejudged with corrected whitespace policy.')
  const resolvePromise = adminPage.waitForResponse(
    r => r.url().includes('/resolve') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Submit Resolution' }).click()
  const resolveRes = await resolvePromise
  expect(resolveRes.status()).toBe(200)
  await expect(adminPage.getByText(/Dispute marked as/i)).toBeVisible()

  // Admin initiates rejudge of competitor 3's initial submission
  await adminPage
    .getByPlaceholder('e.g. 550e8400-e29b-41d4-a716-446655440000')
    .fill(comp3SubData.id)
  await adminPage
    .getByPlaceholder('Fixed test case 4 time limit / memory limits')
    .fill('Rejudge after whitespace dispute resolution')

  const rejudgePromise = adminPage.waitForResponse(
    r => r.url().includes('/rejudge') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Rejudge Submission' }).click()
  const rejudgeRes = await rejudgePromise
  expect(rejudgeRes.status()).toBe(200)
  await expect(
    adminPage.getByText(/rejudge completed and dependent standings updated./i)
  ).toBeVisible({ timeout: 180000 })

  // A real worker re-evaluates the immutable original source. It remains WA;
  // a rejudge cannot silently change source or manufacture a corrected verdict.
  const rejudgedSub = await prisma.contestSubmission.findFirstOrThrow({
    where: {
      contestId: (await prisma.contest.findUniqueOrThrow({ where: { slug: contestSlug } })).id,
      userId: comp3User.id,
      generation: 2,
    },
  })
  await waitForJudge(rejudgedSub.id, 'WRONG_ANSWER')

  // Admin executes chronological replay to recalculate ratings & standings
  const replayPromise = adminPage.waitForResponse(
    r => r.url().includes('/replay') && r.request().method() === 'POST'
  )
  await adminPage.getByRole('button', { name: 'Replay All Dependent Contests' }).click()
  const replayRes = await replayPromise
  expect(replayRes.status()).toBe(200)
  await expect(adminPage.getByText(/Replay completed across/i)).toBeVisible({ timeout: 180000 })

  // Confirm generation 2 authoritative ledgers were written
  const contestRecord = await prisma.contest.findUniqueOrThrow({ where: { slug: contestSlug } })
  const gen2Ledgers = await prisma.contestRatingLedger.findMany({
    where: { contestId: contestRecord.id, generation: 2 },
  })
  expect(gen2Ledgers.length).toBe(3)
  const sumGen2Deltas = gen2Ledgers.reduce((sum, l) => sum + l.delta, 0)
  expect(sumGen2Deltas).toBe(0)
})
