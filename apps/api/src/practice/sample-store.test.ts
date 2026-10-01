import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readSample } from './sample-store.js'
const root = mkdtempSync(join(tmpdir(), 'codeforge-sample-test-'))
mkdirSync(join(root, 'seed', 'demo'), { recursive: true })
writeFileSync(join(root, 'seed', 'demo', '0.in'), 'sample')
afterAll(() => {
  const target = resolve(root)
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('codeforge-sample-test-')
  )
    throw new Error('Unexpected temporary cleanup path')
  rmSync(target, { recursive: true, force: true })
})
describe('legacy sample safety', () => {
  it('reads bounded valid samples and fails closed for missing, traversal and oversized keys', () => {
    expect(readSample(root, 'seed/demo/0.in')).toBe('sample')
    for (const key of ['../../.env', '/etc/passwd', 'seed/demo/1.in', 'seed/demo/../0.in'])
      expect(() => readSample(root, key)).toThrow('Sample data is unavailable')
    writeFileSync(join(root, 'seed', 'demo', '2.in'), 'x'.repeat(65537))
    expect(() => readSample(root, 'seed/demo/2.in')).toThrow('Sample data is unavailable')
  })
})
