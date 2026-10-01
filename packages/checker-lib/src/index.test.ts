import { describe, expect, it } from 'vitest'
import { CheckerFailure, compare } from './index.js'
describe('trusted comparisons', () => {
  it('keeps exact bytes and token order distinct', () => {
    expect(compare('a\nb', 'a b', { kind: 'exact' })).toBe(false)
    expect(compare(' a\r\nb ', 'a\tb', { kind: 'token' })).toBe(true)
    expect(compare('a b', 'b a', { kind: 'token' })).toBe(false)
    expect(compare('', ' \n', { kind: 'token' })).toBe(true)
  })
  it('checks finite float tokens and absolute/relative boundaries', () => {
    expect(
      compare('100 0', '100.05 0.00001', { kind: 'float', relative: 0.001, absolute: 0.00001 })
    ).toBe(true)
    expect(compare('1', '1.02', { kind: 'float', absolute: 0.01 })).toBe(false)
    for (const output of ['NaN', 'Infinity', '1e999', '0x10', ''])
      expect(compare('1', output, { kind: 'float', absolute: 0.01 })).toBe(false)
    expect(compare('-1e2', '-100', { kind: 'float', relative: 0.001 })).toBe(true)
  })
  it('distinguishes checker/package failure from candidate wrong answer', () => {
    expect(() => compare('NaN', '1', { kind: 'float', absolute: 0.01 })).toThrow(CheckerFailure)
    expect(() => compare('1', '1', { kind: 'float', absolute: NaN })).toThrow(CheckerFailure)
    expect(() => compare('1', '1', { kind: 'float' })).toThrow(CheckerFailure)
  })
})
