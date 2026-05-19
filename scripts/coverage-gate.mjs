#!/usr/bin/env node
/**
 * Coverage gate: fail the PR if vitest coverage on touched files inside
 * apps/api drops below 70%. We read `apps/api/coverage/coverage-summary.json`
 * (json-summary reporter, configured in apps/api/vitest.config.ts) and
 * filter to the files modified in this PR.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const THRESHOLD = 70
const SUMMARY = resolve('apps/api/coverage/coverage-summary.json')

function changedFiles() {
  const base = process.env.BASE_REF ?? 'main'
  try {
    execSync(`git fetch origin ${base} --depth=1`, { stdio: 'inherit' })
  } catch {
    /* shallow already */
  }
  const out = execSync(`git diff --name-only origin/${base}...HEAD`, { encoding: 'utf8' })
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('apps/api/src/') && /\.(ts|tsx)$/.test(l) && !l.endsWith('.test.ts'))
}

function main() {
  const files = changedFiles()
  if (files.length === 0) {
    process.stdout.write('coverage-gate: no apps/api files touched — skip.\n')
    return
  }
  if (!existsSync(SUMMARY)) {
    process.stderr.write(`coverage-gate: ${SUMMARY} missing.\n`)
    process.exit(1)
  }
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'))
  const failures = []
  for (const file of files) {
    const abs = resolve(file)
    const row = summary[abs] ?? summary[file]
    if (!row) {
      process.stdout.write(`coverage-gate: no coverage data for ${file}\n`)
      continue
    }
    const pct = row.statements?.pct ?? 0
    if (pct < THRESHOLD) {
      failures.push(`${file}: ${pct}% < ${THRESHOLD}%`)
    } else {
      process.stdout.write(`coverage-gate: ${file} ${pct}% ✓\n`)
    }
  }
  if (failures.length > 0) {
    process.stderr.write(`coverage-gate: FAILURES\n${failures.join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write('coverage-gate: all touched files meet threshold.\n')
}

main()
