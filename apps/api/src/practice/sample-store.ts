import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { HttpError } from '../errors.js'

export function readSample(root: string, key: string): string {
  try {
    if (!/^seed\/[a-z0-9-]+\/[0-9]+\.(in|out)$/.test(key)) throw new Error('Invalid key')
    const base = realpathSync(root)
    const file = realpathSync(resolve(base, key))
    const rel = relative(base, file)
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Outside store')
    const info = statSync(file)
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid sample size')
    return readFileSync(file, 'utf8')
  } catch {
    // Missing/corrupt samples are infrastructure failures, never empty input.
    throw new HttpError(
      503,
      'SAMPLE_UNAVAILABLE',
      'Sample data is unavailable; contact the problem administrator'
    )
  }
}
