import { spawn } from 'node:child_process'

// Fixed argument vectors; candidate code is sent only as bounded stdin data.
export function command(
  args: string[],
  input = '',
  timeoutMs = 30000,
  maxBytes = 16 * 1024 * 1024,
  onLine?: (line: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const output: Buffer[] = []
    let size = 0
    let failed = false
    let lines = ''
    const timer = setTimeout(() => {
      failed = true
      child.kill()
      reject(new Error('Trusted Docker control timeout'))
    }, timeoutMs)
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (block: Buffer) => {
        size += block.length
        if (size > maxBytes) {
          failed = true
          child.kill()
          reject(new Error('Trusted transport bound exceeded'))
        } else if (stream === child.stdout) {
          output.push(block)
          if (onLine) {
            lines += block.toString('utf8')
            const parts = lines.split('\n')
            lines = parts.pop() ?? ''
            for (const line of parts) onLine(line)
          }
        }
      })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (failed) return
      const text = Buffer.concat(output).toString('utf8')
      if (code === 0) resolve(text)
      else {
        // Only the trusted supervisor's bounded failure envelope is diagnostic.
        // Never include Docker stderr or a partial candidate stream in errors.
        let reason = 'Trusted Docker control failed'
        try {
          const failure = JSON.parse(text.trim().split('\n').at(-1)!) as Record<string, unknown>
          if (
            typeof failure.infrastructureFailure === 'string' &&
            typeof failure.reason === 'string'
          )
            reason +=
              ': ' +
              failure.infrastructureFailure.slice(0, 64) +
              ': ' +
              failure.reason.slice(0, 256)
        } catch {
          /* Non-protocol failures remain generic. */
        }
        reject(new Error(reason))
      }
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}

export function engineName(): string {
  const name = process.env.FORGE_JUDGE_ENGINE ?? ''
  if (
    name !== 'codeforge-p2-engine' &&
    !(
      name.startsWith('codeforge-p2-engine-') &&
      /^[a-z0-9]{1,64}$/.test(name.slice('codeforge-p2-engine-'.length))
    )
  )
    throw new Error('Disposable judge engine identity required')
  return name
}
