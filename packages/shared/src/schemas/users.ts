import { z } from 'zod'

export const UpdateMeBody = z
  .object({
    displayName: z.string().min(1).max(64).optional(),
    bio: z.string().max(2000).optional(),
    avatarUrl: z.string().url().max(512).optional(),
    country: z.string().min(2).max(64).optional(),
    organization: z.string().max(128).optional(),
  })
  .strict()

export const UsernameParam = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
})

export type UpdateMeBody = z.infer<typeof UpdateMeBody>
