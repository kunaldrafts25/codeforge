"""Trusted control plane. Source is data; every child command is allowlisted.
No jury output enters this process or candidate filesystem. Runs inside the
disposable engine, never inside a candidate sandbox. Requires cgroup v2.
"""
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import selectors
import socket
import subprocess
import sys
import tarfile
import time
import uuid
from urllib.parse import quote

IMAGE = os.environ.get('FORGE_TOOLCHAIN_IMAGE', '')
RUNSC_HASH = '88a87d5d6d06160d4c144f51f95ec6dd6fe0fc6b02697eb877876683c5b57a91'
SENTRY_HASH = 'e10e6e8072a0822f5e80dc203d156f0602b15fab90b85fac1d7bffd79477b267'
SAFE_NAME = re.compile(r'^(?:main\.(?:cpp|py|js)|solution\.py|Main\.java|Solution\.java|program|[A-Za-z_][A-Za-z0-9_$]*\.class)$')
VOLUMES = {}
CANCEL_ROOT = Path('/opt/forge/cancel')
CANCEL_ROOT.mkdir(exist_ok=True)
HEARTBEAT_ROOT = Path('/opt/forge/heartbeats')
HEARTBEAT_ROOT.mkdir(exist_ok=True)

def verify_identity():
    expected_supervisor = os.environ.get('FORGE_SUPERVISOR_HASH', '')
    if expected_supervisor and hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != expected_supervisor:
        raise RuntimeError('Supervisor integrity mismatch')
    if hashlib.sha256(Path('/usr/local/bin/runsc').read_bytes()).hexdigest() != RUNSC_HASH or hashlib.sha256(Path('/usr/local/bin/gvisor-bin/gvisor_sentry').read_bytes()).hexdigest() != SENTRY_HASH or not re.fullmatch(r'sha256:[a-f0-9]{64}', IMAGE):
        raise RuntimeError('Pinned runtime/image unavailable')
    if api('GET', '/images/' + IMAGE + '/json')['Id'] != IMAGE:
        raise RuntimeError('Immutable image mismatch')
    if api('GET', '/info')['Runtimes'].get('runsc', {}).get('path') != '/usr/local/bin/runsc':
        raise RuntimeError('Runtime configuration mismatch')
    configured = json.loads(Path('/etc/docker/daemon.json').read_text())['runtimes']['runsc']
    if configured.get('path') != '/usr/local/bin/runsc' or configured.get('runtimeArgs') != ['--platform=systrap', '--network=none', '--oci-seccomp']:
        raise RuntimeError('Required runtime security policy unavailable')
    health = Path('/opt/forge/gc.health')
    if not health.exists() or time.time() - health.stat().st_mtime > 20:
        raise RuntimeError('Independent sandbox reaper unavailable')

def cancelled(job):
    pulse = HEARTBEAT_ROOT / job
    return (CANCEL_ROOT / job).exists() or not pulse.exists() or time.time() - pulse.stat().st_mtime > 20

class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(20)
        self.sock.connect('/var/run/docker.sock')

def api(method, path, data=None, binary=False):
    conn = UnixHTTP('localhost')
    body = data if binary else (json.dumps(data).encode() if data is not None else None)
    conn.request(method, '/v1.51' + path, body, {'Content-Type': 'application/x-tar' if binary else 'application/json'})
    response = conn.getresponse()
    payload = response.read(8 * 1024 * 1024 + 1)
    conn.close()
    if method == 'DELETE' and response.status == 404:
        return None
    if response.status >= 300 or len(payload) > 8 * 1024 * 1024:
        raise RuntimeError('Docker control failed: ' + method + ' ' + path.split('?')[0] + ' status=' + str(response.status))
    return payload if binary else (json.loads(payload) if payload else None)

def tar_bytes(files):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w') as archive:
        for name, value in files.items():
            if not SAFE_NAME.fullmatch(name):
                raise RuntimeError('Unsafe artifact name')
            content = value.encode() if isinstance(value, str) else value
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o500 if name == 'program' else 0o400
            info.uid = info.gid = 65534
            archive.addfile(info, io.BytesIO(content))
    return out.getvalue()

def cgroup(cid):
    state = api('GET', '/containers/' + cid + '/json')['State']
    executable = Path('/proc/' + str(state['Pid']) + '/exe').resolve()
    if executable != Path('/usr/local/bin/gvisor-bin/gvisor_sentry'):
        raise RuntimeError('Actual Sentry identity mismatch')
    line = Path('/proc/' + str(state['Pid']) + '/cgroup').read_text().strip()
    if not line.startswith('0::') or '..' in line:
        raise RuntimeError('Required cgroup v2 accounting unavailable')
    root = Path('/sys/fs/cgroup' + line[3:]).resolve()
    if not str(root).startswith('/sys/fs/cgroup/') or not (root / 'memory.peak').exists():
        raise RuntimeError('Required peak accounting unavailable')
    return root

def metrics(root):
    cpu = dict(line.split() for line in (root / 'cpu.stat').read_text().splitlines())
    events = dict(line.split() for line in (root / 'memory.events').read_text().splitlines())
    return {'cpuUs': int(cpu['usage_usec']), 'memoryBytes': int((root / 'memory.peak').read_text()), 'oomKills': int(events.get('oom_kill', '0'))}

def create(files, soft_kb, compile_stage, job):
    if cancelled(job):
        raise RuntimeError('Execution cancelled or fenced')
    volume = 'forge-code-' + uuid.uuid4().hex
    api('POST', '/volumes/create', {'Name': volume, 'Labels': {'codeforge.judge': 'p2', 'codeforge.job': job, 'codeforge.deadline': str(time.time() + 45)}})
    staging = None
    try:
        # Trusted stopped container populates a dedicated Docker-managed volume.
        # It is never started. Candidate containers mount it read-only.
        staging = api('POST', '/containers/create', {
            'Image': IMAGE, 'Cmd': ['/bin/false'],
            'Labels': {'codeforge.judge': 'p2', 'codeforge.job': job, 'codeforge.deadline': str(time.time() + 45)},
            'HostConfig': {'NetworkMode': 'none', 'Mounts': [{'Type': 'volume', 'Source': volume, 'Target': '/code'}]},
        })['Id']
        api('PUT', '/containers/' + staging + '/archive?path=/code', tar_bytes(files), True)
    except BaseException:
        if staging:
            api('DELETE', '/containers/' + staging + '?force=true')
        api('DELETE', '/volumes/' + volume)
        raise
    api('DELETE', '/containers/' + staging + '?force=true')
    cid = api('POST', '/containers/create', {
        'Image': IMAGE, 'User': '0:0', 'WorkingDir': '/work',
        'Cmd': ['/bin/sleep', '300'], 'Env': ['HOME=/work', 'LANG=C.UTF-8', 'LC_ALL=C.UTF-8'],
        'Labels': {'codeforge.judge': 'p2', 'codeforge.job': job, 'codeforge.deadline': str(time.time() + 45)},
        'HostConfig': {
            'Runtime': 'runsc', 'NetworkMode': 'none', 'ReadonlyRootfs': True,
            'Mounts': [{'Type': 'volume', 'Source': volume, 'Target': '/code', 'ReadOnly': True}],
            'CapDrop': ['ALL'], 'CapAdd': ['SETUID', 'SETGID'], 'SecurityOpt': ['no-new-privileges'],
            'Memory': (soft_kb + 131072) * 1024, 'MemorySwap': (soft_kb + 131072) * 1024,
            'NanoCpus': 1000000000, 'PidsLimit': 512,
            'Tmpfs': {'/work': 'rw,nosuid,nodev,size=' + str(134217728 if compile_stage else 16777216) + ',mode=700,uid=65534,gid=65534'},
            'Ulimits': [{'Name': 'nofile', 'Soft': 128, 'Hard': 128}, {'Name': 'nproc', 'Soft': 64, 'Hard': 64}, {'Name': 'fsize', 'Soft': 8388608, 'Hard': 8388608}, {'Name': 'core', 'Soft': 0, 'Hard': 0}],
            'LogConfig': {'Type': 'none'},
        },
    })['Id']
    VOLUMES[cid] = volume
    try:
        api('POST', '/containers/' + cid + '/start')
        root = cgroup(cid)
        config = api('GET', '/containers/' + cid + '/json')['HostConfig']
        if config['Runtime'] != 'runsc' or config['Privileged'] or config.get('Binds') or config['NetworkMode'] != 'none' or not config['ReadonlyRootfs']:
            raise RuntimeError('Isolation control mismatch')
        mounts = api('GET', '/containers/' + cid + '/json')['Mounts']
        if len(mounts) != 1 or mounts[0].get('Name') != volume or mounts[0]['Destination'] != '/code' or mounts[0]['RW'] or mounts[0]['Type'] != 'volume' or set(config.get('Tmpfs', {})) != {'/work'}:
            raise RuntimeError('Filesystem isolation mismatch')
        if set(config['CapAdd']) != {'SETUID', 'SETGID'} or config['CapDrop'] != ['ALL'] or config['SecurityOpt'] != ['no-new-privileges']:
            raise RuntimeError('Bootstrap capability mismatch')
        if int((root / 'memory.max').read_text()) != config['Memory'] or int((root / 'pids.max').read_text()) != 512 or (root / 'cpu.max').read_text().strip() != '100000 100000':
            raise RuntimeError('Kernel resource control mismatch')
        return cid, root
    except BaseException:
        remove(cid)
        raise

def remove(cid):
    try:
        api('DELETE', '/containers/' + cid + '?force=true&v=true')
        volume = VOLUMES.pop(cid, None)
        if volume:
            api('DELETE', '/volumes/' + volume)
    except Exception:
        # Cleanup failure is infrastructure failure, never successful acceptance.
        raise RuntimeError('Sandbox cleanup failed')

BOOTSTRAP = '''import os,sys,pathlib,shutil,resource,ctypes
# Keep Docker's OCI deny rules. The pinned OCI converter discards errnoRet;
# stack another DENY for clone3 with ENOSYS so glibc falls back to filtered
# clone. Filters are inherited and cannot be removed by candidate programs.
assert os.uname().machine=='x86_64'
class Filter(ctypes.Structure):
 _fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint)]
class Program(ctypes.Structure):
 _fields_=[('length',ctypes.c_ushort),('filters',ctypes.POINTER(Filter))]
rules=(Filter*7)(Filter(0x20,0,0,4),Filter(0x15,1,0,0xc000003e),Filter(0x06,0,0,0),Filter(0x20,0,0,0),Filter(0x15,0,1,435),Filter(0x06,0,0,0x00050026),Filter(0x06,0,0,0x7fff0000))
program=Program(7,rules);libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(38,1,0,0,0)==0
assert libc.prctl(22,2,ctypes.byref(program),0,0)==0
assert libc.syscall(435,0,0)==-1 and ctypes.get_errno()==38
cg=pathlib.Path('/sys/fs/cgroup/pids')
(cg/'pids.max').write_text('63')
resource.setrlimit(resource.RLIMIT_NPROC,(64,64))
resource.setrlimit(resource.RLIMIT_NOFILE,(128,128))
resource.setrlimit(resource.RLIMIT_FSIZE,(8388608,8388608))
os.setgroups([]);os.setgid(65534);os.setuid(65534)
status=pathlib.Path('/proc/self/status').read_text().splitlines()
assert os.getuid()==65534 and all(int(line.split()[1],16)==0 for line in status if line.startswith(('CapEff:','CapPrm:','CapAmb:')))
assert (cg/'pids.max').read_text().strip()=='63'
nonce=sys.argv[1];command=sys.argv[2:]
assert command and (shutil.which(command[0]) or pathlib.Path(command[0]).is_file())
sys.stderr.write('_FORGE_READY:'+nonce+'\\n');sys.stderr.flush()
# The controller acknowledges the verified bootstrap before candidate code
# can start. Use an unbuffered one-byte read so candidate stdin is unchanged.
assert os.read(0,1)==b'\\x01'
try: os.execvp(command[0],command)
except OSError:
 sys.stderr.write('_FORGE_BOOT_FAILURE:'+nonce+'\\n');sys.stderr.flush();sys.exit(255)
'''

def execute(cid, root, command, stdin, cpu_ms, wall_ms, soft_kb, output_bytes):
    job = api('GET', '/containers/' + cid + '/json')['Config']['Labels']['codeforge.job']
    begin = metrics(root)
    start = time.monotonic()
    # REST gives an authoritative exec ID and actual exit status. Docker CLI
    # errors (including a Sentry crash) must never be candidate runtime errors.
    nonce = uuid.uuid4().hex
    ready_marker = ('_FORGE_READY:' + nonce + '\n').encode()
    bootstrap_ready = False
    eid = api('POST', '/containers/' + cid + '/exec', {'AttachStdin': True, 'AttachStdout': True, 'AttachStderr': True, 'User': '0:0', 'WorkingDir': '/work', 'Cmd': ['/usr/bin/python3', '-I', '-c', BOOTSTRAP, nonce] + command})['Id']
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(20)
    conn.connect('/var/run/docker.sock')
    body = json.dumps({'Detach': False, 'Tty': False}).encode()
    conn.sendall(('POST /v1.51/exec/' + eid + '/start HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: ' + str(len(body)) + '\r\n\r\n').encode() + body)
    header = bytearray()
    while not header.endswith(b'\r\n\r\n') and len(header) < 8192:
        byte = conn.recv(1)
        if not byte: raise RuntimeError('Exec stream unavailable')
        header.extend(byte)
    if not header.startswith(b'HTTP/1.1 101 '): raise RuntimeError('Exec stream upgrade failed')
    conn.setblocking(False)
    poll = selectors.DefaultSelector()
    pending = b'\x01' + stdin.encode()
    sent = 0
    poll.register(conn, selectors.EVENT_READ)
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    buffered = bytearray()
    reason = None
    peak = begin['memoryBytes']
    cpu = 0
    try:
        eof = False
        while not eof:
            if cancelled(job): raise RuntimeError('Execution cancelled or fenced')
            m = metrics(root)
            peak = max(peak, m['memoryBytes']); cpu = max(cpu, m['cpuUs'] - begin['cpuUs'])
            if m['oomKills'] > begin['oomKills']: raise RuntimeError('Sandbox cgroup OOM: attribution unavailable')
            if not bootstrap_ready:
                if peak > soft_kb * 1024 or cpu > 5000000 or time.monotonic() - start > 10:
                    raise RuntimeError('Trusted bootstrap resource bound exceeded')
            elif peak > soft_kb * 1024: reason = 'MEMORY_LIMIT'
            elif cpu > cpu_ms * 1000 or (time.monotonic() - start) * 1000 > wall_ms: reason = 'TIME_LIMIT'
            if reason: break
            for _, events in poll.select(0.01):
                if events & selectors.EVENT_WRITE:
                    try: sent += conn.send(pending[sent:sent + 4096])
                    except BrokenPipeError: sent = len(pending)
                    if sent == len(pending):
                        poll.modify(conn, selectors.EVENT_READ)
                        try: conn.shutdown(socket.SHUT_WR)
                        except OSError: pass
                if events & selectors.EVENT_READ:
                    block = conn.recv(4096)
                    if not block: eof = True; break
                    buffered.extend(block)
                    while len(buffered) >= 8:
                        length = int.from_bytes(buffered[4:8], 'big')
                        channel = buffered[0]
                        if length > 1048576 or channel not in [1, 2]: raise RuntimeError('Invalid exec stream frame')
                        if len(buffered) < length + 8: break
                        output['stdout' if channel == 1 else 'stderr'].extend(buffered[8:8 + length])
                        del buffered[:8 + length]
                        if not bootstrap_ready and len(output['stderr']) >= len(ready_marker):
                            if not output['stderr'].startswith(ready_marker): raise RuntimeError('Trusted bootstrap refused execution')
                            del output['stderr'][:len(ready_marker)]; bootstrap_ready = True
                            # No candidate execution is possible before this
                            # acknowledgment. Snapshot the whole cgroup now.
                            begin = metrics(root); cpu = 0; start = time.monotonic()
                            poll.modify(conn, selectors.EVENT_READ | selectors.EVENT_WRITE)
                        if bootstrap_ready and ('_FORGE_BOOT_FAILURE:' + nonce).encode() in output['stderr']:
                            raise RuntimeError('Trusted bootstrap artifact failure')
                        if sum(map(len, output.values())) > output_bytes: reason = 'OUTPUT_LIMIT'; break
                if reason: break
            if reason: break
        if reason:
            # Stop consuming an abusive stream before the synchronous kill.
            # Otherwise daemon attach backpressure can block kill acknowledgement.
            poll.unregister(conn)
            conn.close()
            # Snapshot immediately before termination: Docker removes the
            # stopped sandbox's cgroup, so post-kill reads are not reliable.
            final = metrics(root)
            peak = max(peak, final['memoryBytes']); cpu = max(cpu, final['cpuUs'] - begin['cpuUs'])
            if final['oomKills'] > begin['oomKills']:
                raise RuntimeError('Sandbox cgroup OOM: attribution unavailable')
            api('POST', '/containers/' + cid + '/kill?signal=SIGKILL')
        elif buffered:
            raise RuntimeError('Truncated exec stream')
        else:
            final = metrics(root); peak = max(peak, final['memoryBytes']); cpu = max(cpu, final['cpuUs'] - begin['cpuUs'])
            if final['oomKills'] > begin['oomKills']: raise RuntimeError('Sandbox cgroup OOM: attribution unavailable')
            if not api('GET', '/containers/' + cid + '/json')['State']['Running']: raise RuntimeError('Sandbox terminated unexpectedly')
            # Peak accounting also catches short allocations between polls.
            if peak > soft_kb * 1024: reason = 'MEMORY_LIMIT'
            elif cpu > cpu_ms * 1000 or (time.monotonic() - start) * 1000 > wall_ms: reason = 'TIME_LIMIT'
        state = api('GET', '/exec/' + eid + '/json')
        if state['Running'] and not reason: raise RuntimeError('Exec stream lost while program running')
        code = state['ExitCode'] if not state['Running'] and state['ExitCode'] >= 0 else None
        if code is None and not reason: raise RuntimeError('Authoritative program exit unavailable')
        if not bootstrap_ready: raise RuntimeError('Trusted bootstrap did not complete')
        return {'exitCode': code, 'limit': reason, 'timeMs': math.ceil(cpu / 1000), 'memoryKb': math.ceil(peak / 1024), 'wallMs': math.ceil((time.monotonic() - start) * 1000), **{k: bytes(v[:output_bytes]).decode('utf-8', 'replace') for k, v in output.items()}}
    finally:
        poll.close(); conn.close()

def artifacts(cid, language, sources):
    if language in ['python', 'javascript']:
        return sources
    # gVisor owns the tmpfs: Docker's host archive endpoint cannot see it.
    # A fixed trusted serializer runs inside the sandbox, then the outer
    # controller validates each entry. No shell or candidate path is invoked.
    serializer = 'import pathlib,tarfile,sys; files=[p for p in pathlib.Path("/work").iterdir() if p.name=="program" or p.name.endswith(".class")]; assert len(files)<=128 and all(p.is_file() and not p.is_symlink() for p in files) and sum(p.stat().st_size for p in files)<=8*1024*1024; a=tarfile.open(fileobj=sys.stdout.buffer,mode="w|"); [a.add(p,arcname="work/"+p.name,recursive=False) for p in files]; a.close()'
    copied = subprocess.run(['docker', 'exec', '--user', '65534:65534', cid, '/usr/bin/python3', '-I', '-c', serializer], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    if copied.returncode != 0 or len(copied.stdout) > 8 * 1024 * 1024:
        raise RuntimeError('Compiler artifact transfer failed')
    content = copied.stdout
    result = {}
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        members = archive.getmembers()
        if len(members) > 128:
            raise RuntimeError('Artifact count exceeded')
        for member in members:
            name = member.name.removeprefix('work/')
            if member.isdir() and member.name == 'work':
                continue
            if not member.isfile() or not SAFE_NAME.fullmatch(name) or member.size > 8 * 1024 * 1024:
                raise RuntimeError('Unsafe compiler artifact')
            if (language == 'cpp' and name == 'program') or (language == 'java' and name.endswith('.class')):
                result[name] = archive.extractfile(member).read()
    if not result:
        raise RuntimeError('Compiler artifact missing')
    return result

def run(request):
    verify_identity()
    language = request['language']
    sources = request['files']
    if language not in ['cpp', 'python', 'java', 'javascript'] or not 1 <= len(sources) <= 3 or sum(len(v.encode()) for v in sources.values()) > 262144:
        raise RuntimeError('Invalid source bundle')
    limits = request['limits']
    if not 100 <= limits['timeMs'] <= 10000 or not 16384 <= limits['memoryKb'] <= 1048576 or not 1 <= limits['outputKb'] <= 1024 or not 1 <= len(request['inputs']) <= 100 or any(len(v.encode()) > 65536 for v in request['inputs']):
        raise RuntimeError('Invalid execution bounds')
    job = request.get('jobId', str(uuid.uuid4()))
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', job):
        raise RuntimeError('Invalid job identity')
    (HEARTBEAT_ROOT / job).touch()
    compile_cmd = {'cpp': ['g++', '-std=c++17', '-O2', '-pipe', '-fdiagnostics-color=never', '/code/main.cpp', '-o', '/work/program'], 'java': ['javac', '-J-Xmx384m', '-encoding', 'UTF-8', '-d', '/work', '/code/Main.java'] + (['/code/Solution.java'] if 'Solution.java' in sources else []), 'python': ['python3', '-c', 'import pathlib; [compile(p.read_text(),str(p),"exec") for p in pathlib.Path("/code").glob("*.py")]' ], 'javascript': ['node', '--check', '/code/main.js']}[language]
    cid, root = create(sources, 655360, True, job)
    try:
        compiled = execute(cid, root, compile_cmd, '', 20000, 30000, 655360, 32768)
        if compiled['exitCode'] != 0 or compiled['limit']:
            return {'compiled': compiled, 'cases': []}
        prepared = artifacts(cid, language, sources)
    finally:
        remove(cid)
    sys.stdout.write(json.dumps({'event': 'compiled'}) + '\n'); sys.stdout.flush()
    # The authoritative budget is measured whole-cgroup resident peak plus
    # documented runtime allowance, NOT a separate problem-sized heap ceiling.
    # Fixed virtual heap ceilings exceed every supported native memory ceiling;
    # they reserve address space, not 8 GiB of physical memory. Allocation
    # failures/aborts below the measured budget remain runtime errors; neither
    # candidate stderr nor a generic exit code can establish MEMORY_LIMIT.
    command = {'cpp': ['/code/program'], 'python': ['python3', '-B', '/code/main.py'], 'javascript': ['node', '--max-old-space-size=8192', '/code/main.js'], 'java': ['java', '-Xms16m', '-Xmx8192m', '-XX:ActiveProcessorCount=1', '-cp', '/code', 'Main']}[language]
    allowance = {'cpp': 65536, 'python': 65536, 'javascript': 131072, 'java': 196608}[language]
    cases = []
    for value in request['inputs']:
        cid, root = create(prepared, limits['memoryKb'] + allowance, False, job)
        try:
            cases.append(execute(cid, root, command, value, limits['timeMs'], limits['timeMs'] * 3 + 1000, limits['memoryKb'] + allowance, limits['outputKb'] * 1024))
        finally:
            remove(cid)
    return {'compiled': compiled, 'cases': cases, 'artifacts': {name: hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest() for name, value in prepared.items()}}

if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == '--health':
            verify_identity()
            sys.exit(0)
        if len(sys.argv) == 3 and sys.argv[1] == '--touch' and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', sys.argv[2]):
            (HEARTBEAT_ROOT / sys.argv[2]).touch()
            sys.exit(0)
        if len(sys.argv) == 2 and sys.argv[1] == '--gc':
            for container in api('GET', '/containers/json?all=true'):
                labels = container.get('Labels', {})
                if labels.get('codeforge.judge') == 'p2' and (float(labels.get('codeforge.deadline', '0')) < time.time() or cancelled(labels.get('codeforge.job', ''))):
                    job = labels.get('codeforge.job', '')
                    if re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', job):
                        (CANCEL_ROOT / job).touch()
                    api('DELETE', '/containers/' + container['Id'] + '?force=true&v=true')
            filters = quote(json.dumps({'label': ['codeforge.judge=p2'], 'dangling': ['true']}))
            for volume in (api('GET', '/volumes?filters=' + filters).get('Volumes') or []):
                if float(volume.get('Labels', {}).get('codeforge.deadline', '0')) < time.time():
                    api('DELETE', '/volumes/' + volume['Name'])
            for marker in CANCEL_ROOT.iterdir():
                if marker.stat().st_mtime < time.time() - 3600:
                    marker.unlink()
            for pulse in HEARTBEAT_ROOT.iterdir():
                if pulse.stat().st_mtime < time.time() - 3600:
                    pulse.unlink()
            Path('/opt/forge/gc.health').touch()
            sys.exit(0)
        if len(sys.argv) == 3 and sys.argv[1] == '--cancel' and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', sys.argv[2]):
            job = sys.argv[2]
            (CANCEL_ROOT / job).touch()
            containers = api('GET', '/containers/json?all=true')
            for container in containers:
                if container.get('Labels', {}).get('codeforge.job') == job:
                    api('DELETE', '/containers/' + container['Id'] + '?force=true&v=true')
            sys.exit(0)
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise RuntimeError('Request bound exceeded')
        result = run(json.loads(raw))
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        # Fixed error classes only; never copy Docker paths/private payloads.
        sys.stdout.write(json.dumps({'infrastructureFailure': type(error).__name__, 'reason': str(error) if isinstance(error, RuntimeError) else 'Trusted orchestration failure'}))
        sys.exit(1)
