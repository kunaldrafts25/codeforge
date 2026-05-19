import argon2 from 'argon2'
import bcrypt from 'bcryptjs'

export const ARGON2 = 'argon2id'
export const BCRYPT = 'bcrypt'

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB — OWASP minimum for argon2id
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS)
}

export async function verifyPassword(plain: string, hash: string, algo: string): Promise<boolean> {
  if (algo === ARGON2 || hash.startsWith('$argon2')) {
    return argon2.verify(hash, plain)
  }
  if (algo === BCRYPT || hash.startsWith('$2')) {
    return bcrypt.compare(plain, hash)
  }
  return false
}
