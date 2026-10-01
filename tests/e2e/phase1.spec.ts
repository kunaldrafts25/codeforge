import { expect, test, type Page } from '@playwright/test'
import { prisma, type Prisma } from '../../packages/db/src/index'

const apiOrigin = 'http://localhost:5000'
const mailOrigin = 'http://127.0.0.1:8025'
const reviewerPassword = process.env.SEED_REVIEWER_PASSWORD

async function browserApi(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body, apiOrigin }) => {
      async function pacedFetch(url: string, init: RequestInit) {
        let response = await fetch(url, init)
        if (response.status === 429) {
          // CORS may hide Retry-After; the configured global window is one minute.
          const waitSeconds = Number(response.headers.get('Retry-After') ?? 60)
          if (!Number.isFinite(waitSeconds) || waitSeconds > 60) {
            throw new Error('Rate-limit wait exceeds this test helper budget')
          }
          await new Promise(resolve => setTimeout(resolve, Math.max(1, waitSeconds) * 1000))
          response = await fetch(url, init)
        }
        return response
      }
      const headers: Record<string, string> = {}
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (!['GET', 'HEAD'].includes(method)) {
        const browserState = window as Window & { codeforgeTestCsrf?: Promise<string> }
        browserState.codeforgeTestCsrf ??= pacedFetch(`${apiOrigin}/api/auth/csrf`, {
          credentials: 'include',
        }).then(async response => {
          if (!response.ok) throw new Error(`CSRF bootstrap failed: ${response.status}`)
          return ((await response.json()) as { csrfToken: string }).csrfToken
        })
        headers['X-CSRF-Token'] = await browserState.codeforgeTestCsrf
      }
      const response = await pacedFetch(`${apiOrigin}/api${path}`, {
        method,
        credentials: 'include',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        body: (await response.json()) as {
          questions: { questionId: string; type: string }[]
          attemptId: string
        },
      }
    },
    { method, path, body, apiOrigin }
  )
}

async function registerAndLogin(page: Page, email: string, username: string, password: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm Password').fill(password)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/check-inbox/)
  expect((await browserApi(page, 'POST', '/auth/verification/resend', { email })).status).toBe(200)
  let body = ''
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${mailOrigin}/messages?to=${encodeURIComponent(email)}`
      )
      const messages = (await response.json()) as { body: string }[]
      body = messages.at(-1)?.body ?? ''
      return messages.length
    })
    .toBeGreaterThan(1)
  const link = body.match(/http:\/\/localhost:3000\/auth\/verify#token=[^\s]+/)?.[0]
  expect(link).toBeTruthy()
  const verification = page.waitForResponse(
    response =>
      response.url().endsWith('/api/auth/verify-email') && response.request().method() === 'POST'
  )
  await page.goto(link!)
  const verificationResponse = await verification
  const verificationBody = (await verificationResponse.json()) as { error?: { code: string } }
  expect(
    verificationResponse.status(),
    verificationBody.error?.code ?? 'Verification must succeed'
  ).toBe(200)
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  expect(
    (
      await browserApi(page, 'POST', '/auth/verify-email', {
        token: new URLSearchParams(new URL(link!).hash.slice(1)).get('token'),
      })
    ).status
  ).toBe(400)
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/aptitude/)
}

test('review, mail, candidate resume, isolated score, withdrawal and access rules', async ({
  page,
  browser,
  request,
}) => {
  if (!reviewerPassword) throw new Error('SEED_REVIEWER_PASSWORD is required')
  await request.delete(`${mailOrigin}/messages`)
  const reviewer = await browser.newContext()
  const reviewerPage = await reviewer.newPage()
  const original = await prisma.quizQuestion.findUniqueOrThrow({
    where: { id: '018f8148-2201-7630-9da3-055be4d71851' },
  })
  try {
    await reviewerPage.setViewportSize({ width: 390, height: 844 })
    await reviewerPage.goto('http://localhost:3001/login')
    await reviewerPage.getByLabel('Email').fill('pilot-reviewer@codeforge.test')
    await reviewerPage.getByLabel('Password').fill(reviewerPassword!)
    const reviewerLogin = reviewerPage.waitForResponse(
      response =>
        response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
    )
    await reviewerPage.getByRole('button', { name: 'Sign in' }).click()
    const reviewerLoginResponse = await reviewerLogin
    const reviewerLoginBody = (await reviewerLoginResponse.json()) as { error?: { code: string } }
    expect(
      reviewerLoginResponse.status(),
      reviewerLoginBody.error?.code ?? 'Reviewer login must succeed'
    ).toBe(200)
    expect((await browserApi(reviewerPage, 'GET', '/auth/me')).status).toBe(200)
    await expect(reviewerPage.getByRole('heading', { name: 'Quiz review' })).toBeVisible()
    expect(
      await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await reviewerPage
      .getByLabel('License or original-work basis')
      .fill('Original CodeForge pilot content')
    await reviewerPage.getByLabel(/I checked the answers/).check()
    await reviewerPage.getByRole('button', { name: 'Publish reviewed test' }).focus()
    await reviewerPage.keyboard.press('Enter')
    await expect(reviewerPage.getByText(/published\. The audit log/)).toBeVisible()

    const suffix = Date.now().toString(36)
    const password = `PilotPass${suffix}1!`
    await registerAndLogin(
      page,
      `candidate-${suffix}@codeforge.test`,
      `candidate_${suffix}`,
      password
    )
    const disallowedOrigin = await request.get(`${apiOrigin}/api/quiz/tests`, {
      headers: { Origin: 'https://untrusted.example' },
    })
    expect(disallowedOrigin.headers()['access-control-allow-origin']).toBeUndefined()
    expect((await browserApi(page, 'GET', '/quiz/review/tests')).status).toBe(403)
    expect(
      (
        await browserApi(page, 'POST', '/quiz/review/tests/reasoning-demo/withdraw', {
          reason: 'Candidate must not withdraw tests',
        })
      ).status
    ).toBe(403)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/aptitude/reasoning-demo')
    await expect(page.getByRole('heading', { name: 'Reasoning fundamentals' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start test' })).toBeVisible()
    await page.getByRole('button', { name: 'Start test' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/aptitude\/attempts\/[^/]+$/)
    const attemptId = page.url().split('/').at(-1)!
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)

    const publicState = await browserApi(page, 'GET', `/quiz/attempts/${attemptId}`)
    expect(publicState.status).toBe(200)
    expect(JSON.stringify(publicState.body)).not.toMatch(
      /correctIds|"correct"|explanation|scoringPolicy/
    )
    const firstQuestion = publicState.body.questions.find(
      (q: { type: string }) => q.type === 'MCQ_SINGLE'
    )
    expect(firstQuestion).toBeTruthy()
    const firstId = firstQuestion!.questionId
    const saved = page.waitForResponse(
      response =>
        response.url().endsWith(`/quiz/attempts/${attemptId}/answer`) && response.status() === 200
    )
    await page.getByRole('radio', { name: '250 km' }).check()
    await saved
    await page.reload()
    await expect(page.getByRole('radio', { name: '250 km' })).toBeChecked()
    await expect(page.getByText(/Server time at last sync/)).toBeVisible()
    const savedTwo = page.waitForResponse(
      response =>
        response.url().endsWith(`/quiz/attempts/${attemptId}/answer`) && response.status() === 200
    )
    await page.getByRole('radio', { name: 'False' }).check()
    await savedTwo

    // A later bank edit cannot change what this attempt displays or how it scores.
    await prisma.quizQuestion.update({
      where: { id: firstId },
      data: {
        stemMd: 'Changed after start',
        payload: {
          options: [
            { id: 'a', text: '200 km' },
            { id: 'b', text: '250 km' },
          ],
          correctIds: ['a'],
        },
      },
    })
    await page.reload()
    await expect(page.getByText(/A train travels 150 km/)).toBeVisible()
    await page.getByRole('button', { name: 'Submit test' }).click()
    await expect(page).toHaveURL(new RegExp(`/aptitude/attempts/${attemptId}/result`))
    await expect(page.getByText('Score: 2 / 2')).toBeVisible()
    const duplicateSubmits = await Promise.all(
      Array.from({ length: 3 }, () =>
        browserApi(page, 'POST', `/quiz/attempts/${attemptId}/submit`)
      )
    )
    expect(duplicateSubmits.map(response => response.status)).toEqual([200, 200, 200])
    expect(
      (await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })).rawScore
    ).toBe(2)

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    try {
      await registerAndLogin(
        otherPage,
        `other-${suffix}@codeforge.test`,
        `other_${suffix}`,
        password
      )
      const forbidden = await browserApi(otherPage, 'GET', `/quiz/attempts/${attemptId}/result`)
      expect(forbidden.status).toBe(404)
      expect(
        (
          await browserApi(otherPage, 'PUT', `/quiz/attempts/${attemptId}/answer`, {
            questionId: '018f8148-2201-7630-9da3-055be4d71852',
            answer: { value: false },
          })
        ).status
      ).toBe(404)
      expect(
        (await browserApi(otherPage, 'POST', `/quiz/attempts/${attemptId}/submit`)).status
      ).toBe(404)
      const starts = await Promise.all(
        Array.from({ length: 6 }, () =>
          browserApi(otherPage, 'POST', '/quiz/tests/reasoning-demo/start')
        )
      )
      expect(starts.map(response => response.status)).toEqual([200, 200, 200, 200, 200, 200])
      expect(new Set(starts.map(response => response.body.attemptId)).size).toBe(1)
      const secondId = starts[0]!.body.attemptId as string
      const secondAttempt = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: secondId } })
      expect(
        await prisma.quizAttempt.count({
          where: {
            testId: secondAttempt.testId,
            userId: secondAttempt.userId,
            submittedAt: null,
          },
        })
      ).toBe(1)
      const otherRead = await browserApi(otherPage, 'GET', `/quiz/attempts/${attemptId}`)
      expect(otherRead.status).toBe(404)
      const race = await Promise.all([
        browserApi(otherPage, 'PUT', `/quiz/attempts/${secondId}/answer`, {
          questionId: '018f8148-2201-7630-9da3-055be4d71852',
          answer: { value: false },
        }),
        browserApi(otherPage, 'POST', `/quiz/attempts/${secondId}/submit`),
      ])
      expect([200, 409]).toContain(race[0]!.status)
      expect(race[1]!.status).toBe(200)
      const raceResult = await browserApi(otherPage, 'GET', `/quiz/attempts/${secondId}/result`)
      expect(raceResult.status).toBe(200)
      const response = await prisma.quizResponse.findFirst({
        where: { attemptId: secondId, questionId: '018f8148-2201-7630-9da3-055be4d71852' },
      })
      expect(
        (await prisma.quizAttempt.findUniqueOrThrow({ where: { id: secondId } })).rawScore
      ).toBe(response?.pointsAwarded ?? 0)
      expect(
        (await browserApi(otherPage, 'POST', `/quiz/attempts/${secondId}/submit`)).status
      ).toBe(200)
    } finally {
      await other.close()
    }

    const expired = await browser.newContext()
    const expiredPage = await expired.newPage()
    try {
      const expiredEmail = `expired-${suffix}@codeforge.test`
      await registerAndLogin(expiredPage, expiredEmail, `expired_${suffix}`, password)
      const started = await browserApi(expiredPage, 'POST', '/quiz/tests/reasoning-demo/start')
      expect(started.status).toBe(200)
      const expiredId = started.body.attemptId
      await prisma.quizAttempt.update({
        where: { id: expiredId },
        data: {
          startedAt: new Date(Date.now() - 11 * 60_000),
          deadlineAt: new Date(Date.now() - 60_000),
        },
      })
      expect(
        (
          await browserApi(expiredPage, 'PUT', `/quiz/attempts/${expiredId}/answer`, {
            questionId: '018f8148-2201-7630-9da3-055be4d71852',
            answer: { value: false },
          })
        ).status
      ).toBe(409)
      expect(
        (await browserApi(expiredPage, 'GET', `/quiz/attempts/${expiredId}/result`)).status
      ).toBe(200)
      expect(
        (await prisma.quizAttempt.findUniqueOrThrow({ where: { id: expiredId } })).rawScore
      ).toBe(0)
      expect(
        await prisma.auditLog.count({
          where: {
            target: `quizAttempt:${expiredId}`,
            action: 'quiz.attempt.timeout',
          },
        })
      ).toBe(1)
      expect(
        (
          await browserApi(expiredPage, 'POST', '/auth/password-reset/request', {
            email: expiredEmail,
          })
        ).status
      ).toBe(200)
      let resetBody = ''
      await expect
        .poll(async () => {
          const response = await request.get(
            `${mailOrigin}/messages?to=${encodeURIComponent(expiredEmail)}`
          )
          const messages = (await response.json()) as { subject: string; body: string }[]
          resetBody =
            messages.find(message => message.subject.includes('password reset'))?.body ?? ''
          return resetBody.length
        })
        .toBeGreaterThan(0)
      const resetToken = resetBody.match(/\/auth\/reset#token=([^\s]+)/)?.[1]
      expect(resetToken).toBeTruthy()
      const replacementPassword = `Replacement${suffix}2!`
      expect(
        (
          await browserApi(expiredPage, 'POST', '/auth/password-reset/confirm', {
            token: resetToken,
            password: replacementPassword,
          })
        ).status
      ).toBe(200)
      expect(
        (
          await browserApi(expiredPage, 'POST', '/auth/password-reset/confirm', {
            token: resetToken,
            password: replacementPassword,
          })
        ).status
      ).toBe(400)
      expect((await browserApi(expiredPage, 'GET', '/auth/me')).status).toBe(401)
      await expiredPage.goto('/login')
      await expiredPage.getByLabel('Email').fill(expiredEmail)
      await expiredPage.getByLabel('Password').fill(replacementPassword)
      await expiredPage.getByRole('button', { name: 'Sign In' }).click()
      await expect(expiredPage).toHaveURL(/aptitude/)
      const refreshRace = await Promise.all([
        browserApi(expiredPage, 'POST', '/auth/refresh'),
        browserApi(expiredPage, 'POST', '/auth/refresh'),
      ])
      expect(refreshRace.some(response => response.status === 200)).toBe(true)
      expect(refreshRace.every(response => [200, 401].includes(response.status))).toBe(true)
      const expiredAttempt = await prisma.quizAttempt.findUniqueOrThrow({
        where: { id: expiredId },
      })
      expect(
        await prisma.userSession.count({
          where: {
            userId: expiredAttempt.userId,
            revokedAt: null,
          },
        })
      ).toBe(1)
      expect((await browserApi(expiredPage, 'POST', '/auth/logout')).status).toBe(200)
      expect((await browserApi(expiredPage, 'GET', '/auth/me')).status).toBe(401)
    } finally {
      await expired.close()
    }

    await reviewerPage.reload()
    await reviewerPage
      .getByLabel('Withdrawal reason')
      .fill('Pilot review found the item requires correction.')
    await reviewerPage.getByRole('button', { name: 'Withdraw test' }).click()
    await expect(reviewerPage.getByText(/withdrawn\. Existing results/)).toBeVisible()
    expect((await browserApi(page, 'POST', '/quiz/tests/reasoning-demo/start')).status).toBe(404)
    expect((await browserApi(page, 'GET', `/quiz/attempts/${attemptId}/result`)).status).toBe(200)
  } finally {
    await prisma.quizQuestion.update({
      where: { id: original.id },
      data: { stemMd: original.stemMd, payload: original.payload as Prisma.InputJsonValue },
    })
    await reviewer.close()
  }
})
