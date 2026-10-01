import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { command, engineName } from './transport.js'
import { canonical, digest, executeSources, type Policy } from './runner.js'

export async function verifyBoundary(): Promise<{
  policy: Policy
  evidence: Record<string, unknown>
  evidenceHash: string
}> {
  const image = process.env.FORGE_TOOLCHAIN_IMAGE ?? ''
  if (!/^sha256:[0-9a-f]{64}$/.test(image))
    throw new Error('Immutable toolchain content ID required')
  const outer = JSON.parse(
    await command(['inspect', '--format', '{{json .HostConfig}}', engineName()])
  ) as {
    NetworkMode: string
    Binds: unknown
    PortBindings: unknown
    Privileged: boolean
    CgroupnsMode: string
  }
  if (
    outer.NetworkMode !== 'none' ||
    outer.CgroupnsMode !== 'private' ||
    outer.Binds ||
    Object.keys(outer.PortBindings ?? {}).length ||
    !outer.Privileged
  )
    throw new Error('Disposable outer boundary mismatch')
  const localSupervisor = digest(
    await readFile(new URL('../sandbox/executor.py', import.meta.url), 'utf8')
  )
  const actualSupervisor = (
    await command(['exec', engineName(), 'sha256sum', '/opt/forge/executor.py'])
  ).split(' ')[0]
  if (actualSupervisor !== localSupervisor) throw new Error('Supervisor integrity mismatch')
  const runtimeHash = (
    await command(['exec', engineName(), 'sha256sum', '/usr/local/bin/runsc'])
  ).split(' ')[0]!
  if (runtimeHash !== '88a87d5d6d06160d4c144f51f95ec6dd6fe0fc6b02697eb877876683c5b57a91')
    throw new Error('Pinned runsc mismatch')
  const versions = await command([
    'exec',
    engineName(),
    'docker',
    'run',
    '--rm',
    '--runtime=runsc',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=65534:65534',
    '--memory=384m',
    '--memory-swap=384m',
    '--cpus=1',
    '--pids-limit=128',
    image,
    'cat',
    '/toolchain-versions.txt',
  ])
  if (
    !versions.includes('12.2.0') ||
    !versions.includes('Python 3.11.2') ||
    !versions.includes('javac 17.0.20.1') ||
    !versions.includes('v22.20.0')
  )
    throw new Error('Toolchain version mismatch')
  const policy: Policy = {
    image,
    runtimeHash,
    supervisorHash: localSupervisor,
    harnessHash: digest(await readFile(new URL('./harness.ts', import.meta.url), 'utf8')),
    checkerHash: digest(
      await readFile(new URL('../../../packages/checker-lib/src/index.ts', import.meta.url), 'utf8')
    ),
    versions,
    version: 'p2-host-pids-512-guest-controller-63-spawn-64-accounted-66-1',
  }
  // Executed only after the supervisor checks the kernel controls. Expected
  // results are outside the sandbox; no application secret is sent to it.
  const probe = `import os,socket,pathlib,ctypes\nassert os.getuid()==65534\nl=ctypes.CDLL(None,use_errno=True)\nassert l.unshare(0x10000000)==-1 and ctypes.get_errno() in [1,38]\nassert l.unshare(0x20000)==-1 and ctypes.get_errno() in [1,38]\nassert l.syscall(435,0,0)==-1 and ctypes.get_errno()==38\nassert not pathlib.Path('/var/run/docker.sock').exists()\nassert not any(k in os.environ for k in ['DATABASE_URL','JWT_SECRET','FORGE_TOOLCHAIN_IMAGE'])\nassert pathlib.Path('/sys/fs/cgroup/pids/pids.max').read_text().strip()=='63'\nfor path in ['/code/foreign','/root/foreign','/sys/fs/cgroup/pids/pids.max']:\n try:\n  pathlib.Path(path).write_text('1000')\n  raise AssertionError('protected path writable')\n except OSError: pass\ntry:\n pathlib.Path('/proc/1/root/opt/forge/executor.py').read_bytes()\n raise AssertionError('host control file accessible')\nexcept OSError: pass\ntry:\n os.setuid(0)\n raise AssertionError('root elevation')\nexcept OSError: pass\ns=socket.socket();s.settimeout(.2)\ntry:\n s.connect(('1.1.1.1',443))\n raise AssertionError('network allowed')\nexcept OSError: pass\nprint('ISOLATION_OK')\n`
  const probeId = `boundary_${randomUUID()}`
  const tested = await executeSources(policy, {
    language: 'python',
    files: { 'main.py': probe },
    inputs: [''],
    limits: { timeMs: 2000, memoryKb: 65536, outputKb: 4 },
    jobId: probeId,
  })
  if (
    tested.compiled.exitCode ||
    tested.cases[0]?.exitCode ||
    tested.cases[0]?.limit ||
    tested.cases[0]?.stdout.trim() !== 'ISOLATION_OK'
  )
    throw new Error('Isolation probe failed')
  const remaining = await command([
    'exec',
    engineName(),
    'docker',
    'ps',
    '-aq',
    '--filter',
    `label=codeforge.job=${probeId}`,
  ])
  if (remaining.trim()) throw new Error('Isolation probe leaked sandboxes')
  const pressure = `import os,time,signal,json,pathlib\nchildren=[];peak=0;failure=None\ntry:\n for i in range(128):\n  pid=os.fork()\n  if pid==0: time.sleep(10);os._exit(0)\n  children.append(pid);peak=max(peak,int(pathlib.Path('/sys/fs/cgroup/pids/pids.current').read_text()))\nexcept OSError as error: failure=error.errno\nfinally:\n for pid in children:\n  try: os.kill(pid,signal.SIGKILL)\n  except ProcessLookupError: pass\n for pid in children: os.waitpid(pid,0)\nprint(json.dumps({'created':len(children),'peak':peak,'errno':failure}))\n`
  const countProbe = await executeSources(policy, {
    language: 'python',
    files: { 'main.py': pressure },
    inputs: [''],
    limits: { timeMs: 5000, memoryKb: 524288, outputKb: 4 },
    jobId: `pids_${randomUUID()}`,
  })
  const counted = JSON.parse(countProbe.cases[0]?.stdout ?? '{}') as {
    created: number
    peak: number
    errno: number
  }
  if (
    countProbe.compiled.exitCode ||
    countProbe.cases[0]?.exitCode ||
    countProbe.cases[0]?.limit ||
    counted.errno !== 11 ||
    counted.peak > 66 ||
    counted.created > 64
  )
    throw new Error(
      `Guest process ceiling verification failed: ${JSON.stringify({ counted, exitCode: countProbe.cases[0]?.exitCode, limit: countProbe.cases[0]?.limit })}`
    )
  const evidence = {
    policyHash: digest(canonical(policy)),
    probe: tested,
    processPressure: countProbe,
    verifiedAt: new Date().toISOString(),
  }
  return { policy, evidence, evidenceHash: digest(canonical(evidence)) }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verified = await verifyBoundary()
  console.log(
    JSON.stringify({
      policy: verified.policy,
      evidence: verified.evidence,
      evidenceHash: verified.evidenceHash,
    })
  )
}
