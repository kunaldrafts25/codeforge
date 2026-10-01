import assert from 'node:assert/strict'
import test from 'node:test'
import { assessRuntime } from './preflight.mjs'
test('normal Docker is insufficient and runtime presence cannot enable execution', () => {
  assert.equal(
    assessRuntime({ OSType: 'linux', CgroupVersion: '2', Runtimes: { runc: {} } }).runscInstalled,
    false
  )
  const result = assessRuntime({ OSType: 'linux', CgroupVersion: '2', Runtimes: { runsc: {} } })
  assert.equal(result.runscInstalled, true)
  assert.equal(result.executionEnabled, false)
})
