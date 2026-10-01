import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword, ARGON2, BCRYPT } from './password.js'
import bcrypt from 'bcryptjs'

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(hash.startsWith('$argon2id')).toBe(true)
    expect(await verifyPassword('correct-horse-battery-staple', hash, ARGON2)).toBe(true)
    expect(await verifyPassword('wrong', hash, ARGON2)).toBe(false)
  })

  it('falls back to bcrypt for legacy hashes', async () => {
    const legacy = await bcrypt.hash('legacy-pw', 4)
    expect(await verifyPassword('legacy-pw', legacy, BCRYPT)).toBe(true)
    expect(await verifyPassword('nope', legacy, BCRYPT)).toBe(false)
  })

  it('infers algorithm from hash prefix when label is unknown', async () => {
    const argon = await hashPassword('zap')
    expect(await verifyPassword('zap', argon, 'unknown')).toBe(true)
  })
})
