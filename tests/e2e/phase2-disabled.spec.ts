import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../packages/db/src/index'
import { hashPassword } from '../../apps/api/src/auth/password'

test('private authoring and candidate drafts survive reload while execution stays closed', async ({
  browser,
}) => {
  test.setTimeout(300000)
  const database = new URL(process.env.DATABASE_URL ?? '')
  const adminPassword = process.env.SEED_ADMIN_PASSWORD
  const reviewerPassword = process.env.SEED_REVIEWER_PASSWORD
  if (!adminPassword || !reviewerPassword) throw new Error('Fresh staff test credentials required')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname)
  ) {
    throw new Error('Disposable browser environment required')
  }
  const staff = await browser.newContext()
  const author = await staff.newPage()
  author.setDefaultTimeout(20000)
  await author.goto('http://localhost:3001/login')
  // Preserve the real global rate limit across the two browser scenarios.
  await author.evaluate(async () => {
    const r = await fetch('http://localhost:5000/api/health')
    if (r.status === 429) await new Promise(resolve => setTimeout(resolve, 61000))
  })
  await author.getByLabel('Email', { exact: true }).fill('admin@gfgmitadt.in')
  await author.getByLabel('Password', { exact: true }).fill(adminPassword)
  await author.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(author).toHaveURL(/quiz-review/)
  await author.goto('http://localhost:3001/admin/problems')
  await author.getByLabel('Problem slug', { exact: true }).fill('browser-phase2-draft')
  await author.getByLabel('Title', { exact: true }).fill('Browser authored draft')
  await author.getByLabel('Statement Markdown').fill('Add two numbers. <script>throw 1</script>')
  await author.getByLabel('Constraints', { exact: true }).fill('Integers from -10 to 10.')
  await author.getByLabel('Input format').fill('Two integers')
  await author.getByLabel('Output format').fill('Sum')
  const cases = author.getByRole('region', { name: 'Test cases' }).locator('fieldset')
  await cases.nth(0).getByLabel('input', { exact: true }).fill('1 2')
  await cases.nth(0).getByLabel('Expected output').fill('3')
  await cases.nth(1).getByLabel('input', { exact: true }).fill('PRIVATE_BROWSER_INPUT')
  await cases.nth(1).getByLabel('Expected output').fill('PRIVATE_BROWSER_ANSWER')
  await author
    .getByLabel('Reference code', { exact: true })
    .fill('PRIVATE_BROWSER_REFERENCE_NOT_EXECUTED')
  await author.getByLabel('Complexity and limits rationale').fill('O(1) fixture, never executed')
  await author
    .getByLabel('Source and rights basis')
    .fill('Original disposable browser draft fixture.')
  await author.getByRole('button', { name: 'Save new immutable version' }).click()
  await expect(
    author.getByText('Version 1 saved. Its package is immutable.', { exact: true })
  ).toBeVisible()
  await author.reload()
  await author.getByRole('button', { name: 'browser-phase2-draft · version 1 · DRAFT' }).click()
  await expect(author.getByLabel('Title', { exact: true })).toHaveValue('Browser authored draft')
  await author.getByLabel('Title', { exact: true }).fill('Browser authored second version')
  await author.getByRole('button', { name: 'Save new immutable version' }).click()
  await expect(
    author.getByText('Version 2 saved. Its package is immutable.', { exact: true })
  ).toBeVisible()
  const rows = await prisma.practiceVersion.findMany({
    where: { problem: { slug: 'browser-phase2-draft' } },
    orderBy: { number: 'asc' },
  })
  expect(rows).toHaveLength(2)
  expect((rows[0]?.package as { title: string }).title).toBe('Browser authored draft')
  await author.getByRole('button', { name: 'Validate reference solution' }).click()
  await expect(author.getByRole('alert').filter({ hasText: 'awaiting verification' })).toBeVisible()
  await expect(author.getByRole('button', { name: 'Publish reviewed version' })).toBeDisabled()
  const reviewContext = await browser.newContext()
  const reviewer = await reviewContext.newPage()
  reviewer.setDefaultTimeout(20000)
  await reviewer.goto('http://localhost:3001/login')
  await reviewer.getByLabel('Email', { exact: true }).fill('pilot-reviewer@codeforge.test')
  await reviewer.getByLabel('Password', { exact: true }).fill(reviewerPassword)
  await reviewer.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(reviewer).toHaveURL(/quiz-review/)
  await reviewer.goto('http://localhost:3001/admin/problems')
  await reviewer.getByRole('button', { name: 'browser-phase2-draft · version 2 · DRAFT' }).click()
  await reviewer
    .getByLabel('I independently reviewed the saved tests, solutions and rights basis.')
    .check()
  await reviewer.getByRole('button', { name: 'Publish reviewed version' }).click()
  await expect(
    reviewer.getByRole('alert').filter({ hasText: 'awaiting verification' })
  ).toBeVisible()
  await reviewer.getByLabel('Withdrawal reason').fill('Disposable browser fixture withdrawn.')
  await reviewer.getByRole('button', { name: 'Withdraw version' }).click()
  await expect(
    reviewer.getByText('Version withdrawn. Historical records are preserved.', { exact: true })
  ).toBeVisible()

  const password = randomBytes(24).toString('hex')
  await prisma.user.create({
    data: {
      email: 'phase2-browser@example.test',
      username: 'phase2_browser',
      role: 'USER',
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password),
    },
  })
  const candidateContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const candidate = await candidateContext.newPage()
  candidate.setDefaultTimeout(20000)
  await candidate.goto('/login')
  await candidate.getByLabel('Email', { exact: true }).fill('phase2-browser@example.test')
  await candidate.getByLabel('Password', { exact: true }).fill(password)
  await candidate.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(candidate).toHaveURL(/aptitude/)
  await candidate.goto('/problems/two-sum')
  await expect(candidate.getByRole('heading', { name: 'Two Sum', exact: true })).toBeVisible()
  expect(
    await candidate.getByLabel('Language', { exact: true }).locator('option').allTextContents()
  ).toEqual(['cpp', 'python', 'java', 'javascript'])
  await candidate.getByLabel('Code', { exact: true }).fill('// account-scoped C++ draft')
  await candidate.getByLabel('Language', { exact: true }).selectOption('python')
  await candidate.getByLabel('Code', { exact: true }).fill('# account-scoped Python draft')
  await candidate.getByLabel('Language', { exact: true }).selectOption('cpp')
  await expect(candidate.getByLabel('Code', { exact: true })).toHaveValue(
    '// account-scoped C++ draft'
  )
  await candidate.reload()
  await expect(candidate.getByLabel('Code', { exact: true })).toHaveValue(
    '// account-scoped C++ draft'
  )
  await candidate.getByLabel('Code', { exact: true }).focus()
  await candidate.keyboard.press('Tab')
  await expect(candidate.getByRole('button', { name: 'Reset to starter' })).toBeFocused()
  await expect(candidate.getByRole('button', { name: 'Run sample', exact: true })).toBeDisabled()
  await expect(candidate.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled()
  expect(
    await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  const privateDraft = await candidateContext.request.get(
    'http://localhost:5000/api/practice/problems/browser-phase2-draft'
  )
  expect(privateDraft.status()).toBe(404)
  await candidateContext.close()
  await reviewContext.close()
  await staff.close()
})
