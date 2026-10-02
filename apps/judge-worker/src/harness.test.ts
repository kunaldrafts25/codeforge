import { describe, expect, it } from 'vitest'
import { compareFunction, validFunctionInput } from './harness.js'
import { diagnostic } from './runner.js'
const signature = {
  name: 'echo',
  params: [{ name: 'value', type: { kind: 'prim', name: 'long' } }],
  returns: { kind: 'prim', name: 'long' },
}
describe('typed external checking', () => {
  it('preserves integer precision and refuses unsafe integers, null and extra arguments', () => {
    expect(validFunctionInput(signature, '[9007199254740991]')).toBe(true)
    for (const value of ['[9007199254740992]', '[null]', '[1,2]'])
      expect(validFunctionInput(signature, value)).toBe(false)
    expect(
      compareFunction(signature, '9007199254740991', '9007199254740990', {
        kind: 'exact',
        absolute: 0,
        relative: 0,
      })
    ).toBe(false)
  })
  it('applies tolerances only to finite double values and handles empty matrices', () => {
    const doubles = {
      ...signature,
      returns: { kind: 'matrix', of: { kind: 'prim', name: 'double' } },
    }
    expect(
      compareFunction(doubles, '[]', '[]', { kind: 'float', absolute: 0.01, relative: 0 })
    ).toBe(true)
    expect(
      compareFunction(doubles, '[[1.2]]', '[[1.201]]', {
        kind: 'float',
        absolute: 0.01,
        relative: 0,
      })
    ).toBe(true)
    expect(
      compareFunction(doubles, '[[1.2]]', '[[null]]', {
        kind: 'float',
        absolute: 0.01,
        relative: 0,
      })
    ).toBe(false)
    expect(() =>
      compareFunction(doubles, '[[null]]', '[]', { kind: 'float', absolute: 0.01, relative: 0 })
    ).toThrow()
  })
  it('honors exact/token/float typed policies and rejects contradictions', () => {
    const double = { ...signature, returns: { kind: 'prim', name: 'double' } }
    for (const kind of ['exact', 'token']) {
      expect(compareFunction(double, '1', '1.05', { kind })).toBe(false)
      expect(compareFunction(double, '1', '1.0', { kind })).toBe(true)
      for (const field of ['absolute', 'relative'])
        expect(() => compareFunction(double, '1', '1.05', { kind, [field]: 0.1 })).toThrow()
    }
    expect(compareFunction(double, '1', '1.05', { kind: 'float', absolute: 0.1 })).toBe(true)
    expect(compareFunction(double, '1', '1.2', { kind: 'float', absolute: 0.1 })).toBe(false)
    expect(() => compareFunction(signature, '1', '2', { kind: 'float', absolute: 0.1 })).toThrow()
    const text = { ...signature, returns: { kind: 'prim', name: 'string' } }
    expect(compareFunction(text, '"a b"', '"a  b"', { kind: 'token' })).toBe(false)
  })
  it('bounds diagnostics and removes terminal control sequences', () => {
    expect(diagnostic('\u001b[31merror\u0000\u001b[0m')).toBe('error')
    expect(Buffer.byteLength(diagnostic('a'.repeat(20000)))).toBe(8192)
  })
})
