import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __codeforgePrisma: PrismaClient | undefined
}

export const prisma: PrismaClient =
  globalThis.__codeforgePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__codeforgePrisma = prisma
}

export * from '@prisma/client'
export * from './practice-queue.js'
