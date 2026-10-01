import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** @param {{OSType?: string, CgroupVersion?: string | number, Runtimes?: Record<string, unknown>}} info */
export function assessRuntime(info) {
  const runtimes = Object.keys(info.Runtimes ?? {})
  return {
    linux: info.OSType === 'linux',
    cgroupV2: String(info.CgroupVersion) === '2',
    runscInstalled: runtimes.includes('runsc'),
    executionEnabled: false,
    reason:
      'Isolation probes, resource accounting, pinned toolchains and recovery evidence are required before execution.',
  }
}

export function inspectRuntime() {
  // Fixed trusted read-only command; no user input, shell, or candidate code.
  const result = spawnSync('docker', ['info', '--format', '{{json .}}'], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0)
    return { executionEnabled: false, reason: 'Linux Docker metadata is unavailable.' }
  try {
    return assessRuntime(JSON.parse(result.stdout))
  } catch {
    return { executionEnabled: false, reason: 'Invalid Docker metadata.' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(inspectRuntime())}\n`)
  process.exitCode = 1
}
