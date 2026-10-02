import {
  PracticeSignature,
  PracticeLanguage,
  PracticeComparison,
  validatePracticeValue,
  type PracticeType,
} from '@codeforge/shared'
import { CheckerFailure } from '@codeforge/checker-lib'

export const HARNESS_VERSION = 'codeforge-functional-2'
const native = (t: PracticeType, language: 'cpp' | 'java'): string => {
  if (t.kind !== 'prim')
    return language === 'cpp'
      ? `std::vector<${t.kind === 'matrix' ? 'std::vector<' : ''}${native(t.of, language)}${t.kind === 'matrix' ? '>' : ''}>`
      : `${native(t.of, language)}${t.kind === 'matrix' ? '[][]' : '[]'}`
  return (
    language === 'cpp'
      ? { int: 'int', long: 'long long', double: 'double', bool: 'bool', string: 'std::string' }
      : { int: 'int', long: 'long', double: 'double', bool: 'boolean', string: 'String' }
  )[t.name]
}

// A small JSON parser/serializer inside the untrusted generated Java wrapper.
// It conveys no trusted completion or verdict; stdout is checked externally.
const javaJson = `
static class Json {
 String s; int p; Json(String s) { this.s=s; }
 void ws() { while(p<s.length() && " \\t\\r\\n".indexOf(s.charAt(p))>=0)p++; }
 Object value(int depth) {
  if(depth>16)throw new IllegalArgumentException("JSON nesting"); ws(); char c=s.charAt(p);
  if(c=='['){p++; java.util.List<Object> a=new java.util.ArrayList<>();ws();if(s.charAt(p)==']'){p++;return a;}
   while(true){a.add(value(depth+1));ws();char z=s.charAt(p++);if(z==']')return a;if(z!=',')throw new IllegalArgumentException();}}
  if(c=='"'){p++;StringBuilder b=new StringBuilder();while(true){char z=s.charAt(p++);if(z=='"')return b.toString();if(z=='\\\\'){z=s.charAt(p++);switch(z){case '"':case '\\\\':case '/':b.append(z);break;case 'b':b.append('\\b');break;case 'f':b.append('\\f');break;case 'n':b.append('\\n');break;case 'r':b.append('\\r');break;case 't':b.append('\\t');break;case 'u':b.append((char)Integer.parseInt(s.substring(p,p+4),16));p+=4;break;default:throw new IllegalArgumentException();}}else b.append(z);}}
  if(s.startsWith("true",p)){p+=4;return true;} if(s.startsWith("false",p)){p+=5;return false;}
  int start=p;while(p<s.length() && "0123456789+-.eE".indexOf(s.charAt(p))>=0)p++;
  return new java.math.BigDecimal(s.substring(start,p));
 }
 static Object convert(Object a,Class<?> type){if(type.isArray()){java.util.List<?> list=(java.util.List<?>)a;Object out=java.lang.reflect.Array.newInstance(type.getComponentType(),list.size());for(int i=0;i<list.size();i++)java.lang.reflect.Array.set(out,i,convert(list.get(i),type.getComponentType()));return out;}
  if(type==int.class)return ((java.math.BigDecimal)a).intValueExact();if(type==long.class)return ((java.math.BigDecimal)a).longValueExact();if(type==double.class)return ((java.math.BigDecimal)a).doubleValue();return a;}
 static String emit(Object a){if(a==null)throw new IllegalArgumentException("null return");if(a instanceof String){StringBuilder b=new StringBuilder("\\\"");for(char c:((String)a).toCharArray()){switch(c){case '"':b.append("\\\\\\\"");break;case '\\\\':b.append("\\\\\\\\");break;case '\\n':b.append("\\\\n");break;case '\\r':b.append("\\\\r");break;case '\\t':b.append("\\\\t");break;default:if(c<32)b.append(String.format("\\\\u%04x",(int)c));else b.append(c);}}return b.append('"').toString();}
  if(a.getClass().isArray()){StringBuilder b=new StringBuilder("[");for(int i=0;i<java.lang.reflect.Array.getLength(a);i++){if(i>0)b.append(',');b.append(emit(java.lang.reflect.Array.get(a,i)));}return b.append(']').toString();}
  if(a instanceof Double && !Double.isFinite((Double)a))throw new IllegalArgumentException("nonfinite");return a.toString();}
}
`

export function buildSources(
  rawLanguage: string,
  source: string,
  rawSignature: unknown | null
): Record<string, string> {
  const language = PracticeLanguage.parse(rawLanguage)
  if (!rawSignature)
    return {
      [{ cpp: 'main.cpp', python: 'main.py', java: 'Main.java', javascript: 'main.js' }[language]]:
        source,
    }
  const sig = PracticeSignature.parse(rawSignature)
  if (language === 'cpp') {
    const args = sig.params
      .map((p, i) => `args.at(${i}).get<${native(p.type, 'cpp')}>()`)
      .join(', ')
    return {
      'main.cpp': `#include <nlohmann/json.hpp>\n#include <iostream>\n#include <vector>\n#include <string>\n${source}\nint main(){nlohmann::json args;std::cin>>args;Solution solution;auto result=solution.${sig.name}(${args});std::cout<<nlohmann::json(result).dump();}\n`,
    }
  }
  if (language === 'python')
    return {
      'solution.py': source,
      'main.py': `import json,sys\nfrom solution import Solution\na=json.load(sys.stdin)\nr=Solution().${sig.name}(*a)\nprint(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(',',':')))\n`,
    }
  if (language === 'javascript')
    return {
      'main.js': `${source}\n;(function(){const forgeArgs=JSON.parse(require('fs').readFileSync(0,'utf8'));const forgeResult=${sig.name}(...forgeArgs);process.stdout.write(JSON.stringify(forgeResult));})()\n`,
    }
  const args = sig.params
    .map(
      (p, i) =>
        `(${native(p.type, 'java')})Json.convert(args.get(${i}),${native(p.type, 'java')}.class)`
    )
    .join(', ')
  return {
    'Solution.java': source,
    'Main.java': `public class Main {${javaJson}\npublic static void main(String[] ignored)throws Exception{Json parser=new Json(new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));java.util.List<?> args=(java.util.List<?>)parser.value(0);Object result=new Solution().${sig.name}(${args});System.out.print(Json.emit(result));}}`,
  }
}

export function validFunctionInput(signature: unknown, text: string): boolean {
  const sig = PracticeSignature.parse(signature)
  try {
    const args: unknown = JSON.parse(text)
    return (
      Array.isArray(args) &&
      args.length === sig.params.length &&
      sig.params.every((p, i) => validatePracticeValue(p.type, args[i]))
    )
  } catch {
    return false
  }
}

export function compareFunction(
  signature: unknown,
  expected: string,
  actual: string,
  rawPolicy: unknown
): boolean {
  const sig = PracticeSignature.parse(signature)
  const parsed = PracticeComparison.safeParse(rawPolicy)
  if (!parsed.success) throw new CheckerFailure('Invalid functional comparison policy')
  const policy = parsed.data
  const floating = (sig.returns.kind === 'prim' ? sig.returns : sig.returns.of).name === 'double'
  if (policy.kind === 'float' && !floating)
    throw new CheckerFailure('Functional float checking requires double return values')
  const jury: unknown = JSON.parse(expected)
  if (!validatePracticeValue(sig.returns, jury)) throw new CheckerFailure('Invalid functional jury')
  let value: unknown
  try {
    value = JSON.parse(actual)
  } catch {
    return false
  }
  if (!validatePracticeValue(sig.returns, value)) return false
  const equal = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((v, i) => equal(v, b[i]))
    if (policy.kind === 'float' && floating && typeof a === 'number' && typeof b === 'number')
      return Math.abs(a - b) <= Math.max(policy.absolute, policy.relative * Math.abs(a))
    return a === b
  }
  return equal(jury, value)
}
