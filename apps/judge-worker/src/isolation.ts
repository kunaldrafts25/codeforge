import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { verifyBoundary } from './doctor.js'
import { executeSources } from './runner.js'
import { command, engineName } from './transport.js'

const verified = await verifyBoundary()
async function probe(name: string, source: string, expected: string) {
  const id = `isolation_${randomUUID()}`
  const r = await executeSources(verified.policy, {
    jobId: id,
    language: 'python',
    files: { 'main.py': source },
    inputs: [''],
    limits: { timeMs: 5000, memoryKb: 524288, outputKb: 4 },
  })
  assert.equal(r.compiled.exitCode, 0)
  assert.equal(r.cases[0]?.exitCode, 0)
  assert.equal(r.cases[0]?.limit, null)
  assert.equal(r.cases[0]?.stdout.trim(), expected)
  assert.equal(
    (
      await command([
        'exec',
        engineName(),
        'docker',
        'ps',
        '-aq',
        '--filter',
        `label=codeforge.job=${id}`,
      ])
    ).trim(),
    ''
  )
  console.log(
    JSON.stringify({
      event: 'isolation.passed',
      name,
      executed: true,
      measurement: { timeMs: r.cases[0]!.timeMs, memoryKb: r.cases[0]!.memoryKb },
    })
  )
}
await probe(
  'namespace-denial',
  `import ctypes,errno\nl=ctypes.CDLL(None,use_errno=True)\nfor flags in [0x10000000,0x20000]:\n assert l.unshare(flags)==-1 and ctypes.get_errno() in [errno.EPERM,errno.ENOSYS]\nassert l.syscall(435,0,0)==-1 and ctypes.get_errno()==errno.ENOSYS\nprint('DENIED')`,
  'DENIED'
)
await probe(
  'thread-pressure',
  `import threading,time,pathlib\nthreads=[];peak=0\ntry:\n for i in range(128):\n  t=threading.Thread(target=lambda: time.sleep(2));t.start();threads.append(t);peak=max(peak,int(pathlib.Path('/sys/fs/cgroup/pids/pids.current').read_text()))\nexcept RuntimeError: pass\nassert 1<=len(threads)<=64 and peak<=66\nfor t in threads: t.join()\nprint('BOUNDED')`,
  'BOUNDED'
)
await probe(
  'temporary-disk-and-file-ceilings',
  `import os,errno\ntry:\n with open('/work/large','wb',buffering=0) as f:\n  for i in range(10): f.write(b'x'*1048576)\n raise AssertionError('file limit missing')\nexcept OSError as e: assert e.errno==errno.EFBIG\nassert os.stat('/work/large').st_size<=8388608\ntry:\n for i in range(20):\n  with open('/work/disk'+str(i),'wb',buffering=0) as f: f.write(b'x'*1048576)\n raise AssertionError('disk limit missing')\nexcept OSError as e: assert e.errno==errno.ENOSPC\nprint('BOUNDED')`,
  'BOUNDED'
)
await probe(
  'descendants-and-first-job-files',
  `import os,time,pathlib\npathlib.Path('/work/foreign').write_text('disposable marker')\nif os.fork()==0:\n for fd in [0,1,2]: os.close(fd)\n time.sleep(60);os._exit(0)\nprint('CREATED')`,
  'CREATED'
)
await probe(
  'cross-job-contamination',
  `import pathlib\nassert not pathlib.Path('/work/foreign').exists()\nassert not pathlib.Path('/code/foreign').exists()\nassert not pathlib.Path('/var/run/docker.sock').exists()\nprint('CLEAN')`,
  'CLEAN'
)
console.log(
  JSON.stringify({
    event: 'isolation.complete',
    executed: true,
    policy: verified.policy,
    evidenceHash: verified.evidenceHash,
  })
)
const abuse = await executeSources(verified.policy, {
  jobId: `compile_abuse_${randomUUID()}`,
  language: 'cpp',
  files: { 'main.cpp': 'asm(".rept 100000000\\n.byte 0\\n.endr");int main(){return 0;}' },
  inputs: [''],
  limits: { timeMs: 2000, memoryKb: 65536, outputKb: 4 },
})
assert(abuse.compiled.exitCode !== 0 || abuse.compiled.limit)
assert.equal(abuse.cases.length, 0)
assert(Buffer.byteLength(abuse.compiled.stdout) + Buffer.byteLength(abuse.compiled.stderr) <= 65536)
assert(abuse.compiled.wallMs <= 35000)
console.log(
  JSON.stringify({
    event: 'isolation.compile_abuse_bounded',
    executed: true,
    limit: abuse.compiled.limit,
    exitCode: abuse.compiled.exitCode,
    timeMs: abuse.compiled.timeMs,
    memoryKb: abuse.compiled.memoryKb,
    wallMs: abuse.compiled.wallMs,
  })
)
