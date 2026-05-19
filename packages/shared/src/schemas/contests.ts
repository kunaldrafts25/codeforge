import { z } from 'zod'

export const ContestSlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9-]+$/),
})

export const ContestListItem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  isRated: z.boolean(),
  status: z.string(),
  participantCount: z.number().int(),
})

export const ContestListResponse = z.array(ContestListItem)
