import { z } from 'zod'

export const PasswordRules = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password too long')
  .refine(
    p => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p),
    'Password must include upper, lower, and digit'
  )

export const RegisterBody = z.object({
  email: z.string().email().max(254),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, digits, underscore, dash only'),
  password: PasswordRules,
  displayName: z.string().min(1).max(64).optional(),
})

export const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
})

export const VerifyEmailBody = z.object({
  token: z.string().min(16).max(256),
})

export const RequestPasswordResetBody = z.object({
  email: z.string().email().max(254),
})

export const ConfirmPasswordResetBody = z.object({
  token: z.string().min(16).max(256),
  password: PasswordRules,
})

export const AuthMeResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    bio: z.string().nullable(),
    role: z.enum(['USER', 'PROBLEM_SETTER', 'REVIEWER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']),
    rating: z.number().int(),
    maxRating: z.number().int(),
    problemsSolved: z.number().int(),
    contestsCount: z.number().int(),
    emailVerified: z.boolean(),
    createdAt: z.string().datetime(),
  }),
})

export const PublicUser = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  role: z.string(),
  rating: z.number().int(),
  maxRating: z.number().int(),
  problemsSolved: z.number().int(),
  contestsCount: z.number().int(),
})

export type RegisterBody = z.infer<typeof RegisterBody>
export type LoginBody = z.infer<typeof LoginBody>
export type VerifyEmailBody = z.infer<typeof VerifyEmailBody>
