import { createHash, createHmac } from 'node:crypto'

// Server-authoritative seeded RNG. We derive a 32-bit seed from the attempt
// seed and a tag (e.g. section name or question id) then run xoshiro128**.
// Deterministic across runtimes.

function tagged32(seed: string, tag: string): number {
  const hex = createHmac('sha256', seed).update(tag).digest('hex')
  return parseInt(hex.slice(0, 8), 16) >>> 0
}

interface XoshiroState {
  s: [number, number, number, number]
}

function makeState(seed32: number): XoshiroState {
  let z = seed32 >>> 0
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    z = (z + 0x9e3779b9) >>> 0
    let t = z
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0
    out.push((t ^ (t >>> 16)) >>> 0)
  }
  return { s: [out[0]!, out[1]!, out[2]!, out[3]!] }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

function next(state: XoshiroState): number {
  const [a, b, c, d] = state.s
  const result = (rotl(Math.imul(b!, 5) >>> 0, 7) * 9) >>> 0
  const t = (b! << 9) >>> 0
  state.s[2] = (c! ^ a!) >>> 0
  state.s[3] = (d! ^ b!) >>> 0
  state.s[1] = (b! ^ state.s[2]!) >>> 0
  state.s[0] = (a! ^ state.s[3]!) >>> 0
  state.s[2] = (state.s[2]! ^ t) >>> 0
  state.s[3] = rotl(state.s[3]!, 11)
  return result >>> 0
}

export function seededShuffle<T>(seed: string, tag: string, items: readonly T[]): T[] {
  const arr = items.slice()
  if (arr.length <= 1) return arr
  const state = makeState(tagged32(seed, tag))
  for (let i = arr.length - 1; i > 0; i--) {
    const r = next(state)
    const j = r % (i + 1)
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

export function seededPermutationIndices(seed: string, tag: string, length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i)
  return seededShuffle(seed, tag, indices)
}

export function attemptSeed(attemptId: string, testId: string): string {
  return createHash('sha256').update(attemptId).update(':').update(testId).digest('hex')
}
