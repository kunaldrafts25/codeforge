import { loadConfig } from '../config.js'
import { logger } from '../logger.js'

const config = loadConfig()

interface SendArgs {
  to: string
  subject: string
  body: string
}

async function sendViaResend(args: SendArgs): Promise<void> {
  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured')
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: args.to,
      subject: args.subject,
      text: args.body,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend send failed: ${res.status} ${text}`)
  }
}

export async function sendEmail(args: SendArgs): Promise<void> {
  if (config.EMAIL_PROVIDER === 'resend') {
    await sendViaResend(args)
    return
  }
  if (config.EMAIL_PROVIDER === 'sandbox') {
    if (config.NODE_ENV === 'production' || !config.MAIL_SANDBOX_URL)
      throw new Error('Mail sandbox is unavailable')
    const response = await fetch(new URL('/messages', config.MAIL_SANDBOX_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!response.ok) throw new Error(`Mail sandbox failed: ${response.status}`)
    return
  }
  logger.info({ to: args.to, subject: args.subject }, '[email:console] body omitted')
}

export function buildVerifyEmail(token: string): SendArgs {
  const link = `${config.FRONTEND_URL}/auth/verify#token=${token}`
  return {
    to: '', // populated by caller
    subject: 'Verify your CodeForge email',
    body: `Welcome to CodeForge.\n\nClick to verify: ${link}\n\nThis link expires in 24 hours.`,
  }
}

export function buildPasswordResetEmail(token: string): SendArgs {
  const link = `${config.FRONTEND_URL}/auth/reset#token=${token}`
  return {
    to: '',
    subject: 'CodeForge password reset',
    body: `Reset your password: ${link}\n\nThis link expires in 15 minutes.`,
  }
}
