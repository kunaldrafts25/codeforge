import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../packages/db/src/index'
import { hashPassword } from '../../apps/api/src/auth/password'

test('real publication, candidate runs/submissions, private history and reload', async ({
  browser,
}) => {
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    process.env.FORGE_PRACTICE_ENABLED !== '1'
  ) {
    throw new Error('Fresh disposable live judge required')
  }
  const fixture = randomBytes(8).toString('hex')
  const slug = `browser-real-sum-${fixture}`
  const email = `browser-real-${fixture}@example.test`
  const authorContext = await browser.newContext()
  const author = await authorContext.newPage()
  author.setDefaultTimeout(15000)
  await author.goto('http://localhost:3001/login')
  await author.getByLabel('Email', { exact: true }).fill('admin@gfgmitadt.in')
  await author.getByLabel('Password', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD!)
  await author.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(author).toHaveURL(/quiz-review/)
  await author.goto('http://localhost:3001/admin/problems')
  await author.getByLabel('Problem slug', { exact: true }).fill(slug)
  await author.getByLabel('Title', { exact: true }).fill('Browser real sum')
  await author.getByLabel('Statement Markdown').fill('Add two integers.')
  await author.getByLabel('Constraints', { exact: true }).fill('Integers between -100 and 100.')
  await author.getByLabel('Input format').fill('Two integers')
  await author.getByLabel('Output format').fill('Sum')
  const cases = author.getByRole('region', { name: 'Test cases' }).locator('fieldset')
  await cases.nth(0).getByLabel('input', { exact: true }).fill('1 2')
  await cases.nth(0).getByLabel('Expected output').fill('3')
  await cases.nth(1).getByLabel('input', { exact: true }).fill('47 -19')
  await cases.nth(1).getByLabel('Expected output').fill('28')
  await author.getByLabel('Reference language', { exact: true }).selectOption('python')
  const source = 'a,b=map(int,input().split());print(a+b)'
  await author.getByLabel('Reference code', { exact: true }).fill(source)
  await author.getByLabel('Complexity and limits rationale').fill('O(1), bounded integer addition.')
  await author
    .getByLabel('Source and rights basis')
    .fill('Original disposable browser acceptance problem.')
  await author.getByRole('button', { name: 'Save new immutable version' }).click()
  await expect(
    author.getByText('Version 1 saved. Its package is immutable.', { exact: true })
  ).toBeVisible()
  await author.getByRole('button', { name: 'Validate reference solution' }).click()
  await expect(author.getByText(/Version status: VALIDATED/)).toBeVisible({ timeout: 90000 })
  await expect(author.getByRole('button', { name: 'Publish reviewed version' })).toBeDisabled()
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  reviewer.setDefaultTimeout(15000)
  await reviewer.goto('http://localhost:3001/login')
  await reviewer.getByLabel('Email', { exact: true }).fill('pilot-reviewer@codeforge.test')
  await reviewer.getByLabel('Password', { exact: true }).fill(process.env.SEED_REVIEWER_PASSWORD!)
  await reviewer.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(reviewer).toHaveURL(/quiz-review/)
  await reviewer.goto('http://localhost:3001/admin/problems')
  await reviewer.getByRole('button', { name: `${slug} · version 1 · VALIDATED` }).click()
  await reviewer
    .getByLabel('I independently reviewed the saved tests, solutions and rights basis.')
    .check()
  await reviewer.getByRole('button', { name: 'Publish reviewed version' }).click()
  await expect(reviewer.getByText(/Version status: PUBLISHED/)).toBeVisible()
  const password = randomBytes(24).toString('hex')
  await prisma.user.create({
    data: {
      email,
      username: `browser_real_${fixture}`,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password),
    },
  })
  const candidateContext = await browser.newContext({
    baseURL: 'http://localhost:3000',
    viewport: { width: 390, height: 844 },
  })
  const candidate = await candidateContext.newPage()
  candidate.setDefaultTimeout(15000)
  await candidate.goto('/login')
  await candidate.getByLabel('Email', { exact: true }).fill(email)
  await candidate.getByLabel('Password', { exact: true }).fill(password)
  await candidate.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(candidate).toHaveURL(/aptitude/)
  await candidate.goto(`/problems/${slug}`)
  await candidate.getByLabel('Language', { exact: true }).selectOption('python')
  await candidate.getByLabel('Code', { exact: true }).fill(source)
  await candidate.getByRole('button', { name: 'Run sample', exact: true }).click()
  await expect(candidate.getByText('Server status: ACCEPTED', { exact: true })).toBeVisible({
    timeout: 90000,
  })
  await candidate.getByLabel('Custom input', { exact: true }).fill('8 9')
  await candidate.getByRole('button', { name: 'Run custom input', exact: true }).click()
  await expect(candidate.getByText('Server status: RUN_COMPLETE', { exact: true })).toBeVisible({
    timeout: 90000,
  })
  await candidate.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(candidate.getByText('Server status: ACCEPTED', { exact: true })).toBeVisible({
    timeout: 90000,
  })
  const acceptedUrl = candidate.url()
  await candidate.reload()
  await expect(candidate.getByLabel('Code', { exact: true })).toHaveValue(source)
  await expect(candidate.getByText('Server status: ACCEPTED', { exact: true })).toBeVisible()
  await candidate.screenshot({
    path: test.info().outputPath('candidate-accepted-mobile.png'),
    fullPage: true,
  })
  expect(await candidate.locator('body').innerText()).not.toContain('47 -19')
  await candidate.getByLabel('Code', { exact: true }).fill('print(0)')
  await candidate.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(candidate.getByText('Server status: WRONG_ANSWER', { exact: true })).toBeVisible({
    timeout: 90000,
  })
  await candidate.goto(acceptedUrl)
  await expect(candidate.getByText('Server status: ACCEPTED', { exact: true })).toBeVisible()
  await candidate.getByLabel('Code', { exact: true }).focus()
  await candidate.keyboard.press('Tab')
  await expect(candidate.getByRole('button', { name: 'Reset to starter' })).toBeFocused()
  expect(
    await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await reviewer
    .getByLabel('Withdrawal reason')
    .fill('Browser acceptance version withdrawn after successful judging.')
  await reviewer.getByRole('button', { name: 'Withdraw version' }).click()
  await expect(
    reviewer.getByText('Version withdrawn. Historical records are preserved.', { exact: true })
  ).toBeVisible()
  await candidate.reload()
  await expect
    .poll(
      async () => {
        const withdrawn = await candidateContext.request.get(
          `http://localhost:5000/api/practice/problems/${slug}`
        )
        // All three browsers share the loopback IP and its production rate limit.
        // Retry throttling; every other response must satisfy withdrawal immediately.
        if (withdrawn.status() !== 429) expect(withdrawn.status()).toBe(404)
        return withdrawn.status()
      },
      { timeout: 65000, intervals: [5000, 10000] }
    )
    .toBe(404)
  await candidate.goto(`/practice/history?job=${new URL(acceptedUrl).searchParams.get('job')}`)
  await expect(
    candidate.getByRole('heading', { name: 'Server status: ACCEPTED', exact: true })
  ).toBeVisible()
  await candidateContext.close()
  await reviewerContext.close()
  await authorContext.close()
})
