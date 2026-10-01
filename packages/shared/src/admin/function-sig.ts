import { z } from 'zod'
import { PracticeLanguage, PracticeSignature } from '../schemas/practice.js'

// Local, minimal signature DSL until A2's packages/shared/function-sig ships.
// Once it does, this file should be a re-export shim.

export const SigPrimitive = z.enum(['int', 'long', 'double', 'bool', 'string', 'char', 'void'])

export const SigType: z.ZodType<SigTypeValue> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('prim'), name: SigPrimitive }),
    z.object({ kind: z.literal('list'), of: SigType }),
    z.object({ kind: z.literal('matrix'), of: SigType }),
  ])
)

export type SigTypeValue =
  | { kind: 'prim'; name: z.infer<typeof SigPrimitive> }
  | { kind: 'list'; of: SigTypeValue }
  | { kind: 'matrix'; of: SigTypeValue }

export const FunctionSignature = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  params: z.array(z.object({ name: z.string().min(1), type: SigType })),
  returns: SigType,
})
export type FunctionSignature = z.infer<typeof FunctionSignature>

function renderType(t: SigTypeValue, lang: 'cpp' | 'java' | 'python' | 'js'): string {
  if (t.kind === 'prim') {
    if (lang === 'cpp') {
      switch (t.name) {
        case 'int':
          return 'int'
        case 'long':
          return 'long long'
        case 'double':
          return 'double'
        case 'bool':
          return 'bool'
        case 'string':
          return 'string'
        case 'char':
          return 'char'
        case 'void':
          return 'void'
      }
    }
    if (lang === 'java') {
      switch (t.name) {
        case 'int':
          return 'int'
        case 'long':
          return 'long'
        case 'double':
          return 'double'
        case 'bool':
          return 'boolean'
        case 'string':
          return 'String'
        case 'char':
          return 'char'
        case 'void':
          return 'void'
      }
    }
    if (lang === 'python') {
      switch (t.name) {
        case 'int':
        case 'long':
          return 'int'
        case 'double':
          return 'float'
        case 'bool':
          return 'bool'
        case 'string':
          return 'str'
        case 'char':
          return 'str'
        case 'void':
          return 'None'
      }
    }
    return 'any'
  }
  if (t.kind === 'list') {
    if (lang === 'cpp') return `vector<${renderType(t.of, lang)}>`
    if (lang === 'java') return `${renderType(t.of, lang)}[]`
    if (lang === 'python') return `list[${renderType(t.of, lang)}]`
    return `${renderType(t.of, lang)}[]`
  }
  // matrix
  if (lang === 'cpp') return `vector<vector<${renderType(t.of, lang)}>>`
  if (lang === 'java') return `${renderType(t.of, lang)}[][]`
  if (lang === 'python') return `list[list[${renderType(t.of, lang)}]]`
  return `${renderType(t.of, lang)}[][]`
}

export function generateStarter(sig: FunctionSignature, language: string): string {
  PracticeSignature.parse(sig)
  const lang = PracticeLanguage.parse(language)
  if (lang === 'cpp') {
    const params = sig.params.map(p => `${renderType(p.type, 'cpp')} ${p.name}`).join(', ')
    const ret = renderType(sig.returns, 'cpp')
    const stub =
      ret === 'void' ? '        // TODO: implement\n' : `        return {}; // TODO: implement\n`
    return `#include <string>\n#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    ${ret} ${sig.name}(${params}) {\n${stub}    }\n};\n`
  }
  if (lang === 'java') {
    const params = sig.params.map(p => `${renderType(p.type, 'java')} ${p.name}`).join(', ')
    const ret = renderType(sig.returns, 'java')
    const body =
      ret === 'void'
        ? '        // TODO: implement\n'
        : `        // TODO: implement\n        return ${defaultJava(sig.returns)};\n`
    return `class Solution {\n    public ${ret} ${sig.name}(${params}) {\n${body}    }\n}\n`
  }
  if (lang === 'python') {
    const params = sig.params.map(p => `${p.name}: ${renderType(p.type, 'python')}`).join(', ')
    const ret = renderType(sig.returns, 'python')
    return `class Solution:\n    def ${sig.name}(self${params ? ', ' + params : ''}) -> ${ret}:\n        # TODO: implement\n        pass\n`
  }
  if (lang === 'javascript') {
    const params = sig.params.map(p => p.name).join(', ')
    return `/**\n * @param {...} args\n */\nfunction ${sig.name}(${params}) {\n  // TODO: implement\n}\n`
  }
  return `# starter for ${language} not implemented\n`
}

function defaultJava(t: SigTypeValue): string {
  if (t.kind === 'prim') {
    switch (t.name) {
      case 'int':
      case 'long':
        return '0'
      case 'double':
        return '0.0'
      case 'bool':
        return 'false'
      case 'string':
        return '""'
      case 'char':
        return "'\\0'"
      case 'void':
        return ''
    }
  }
  return 'null'
}
