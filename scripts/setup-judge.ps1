$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-JudgeSetup([scriptblock]$Action) { & $Action; if ($LASTEXITCODE -ne 0) { throw 'Disposable judge setup failed' } }
$judgeSuffix = [Guid]::NewGuid().ToString('N')
$judgeName = 'codeforge-p2-engine-' + $judgeSuffix
$judgeArtifactRoot = Join-Path (Get-Location).Path '.judge-artifacts'
New-Item -ItemType Directory -Force -Path $judgeArtifactRoot | Out-Null
$judgeArchive = Join-Path $judgeArtifactRoot ('codeforge-toolchain-' + $judgeSuffix + '.tar')
Invoke-JudgeSetup { docker build -f apps/judge-worker/sandbox/toolchain.Dockerfile -t codeforge-judge-toolchain:p2 apps/judge-worker/sandbox }
Invoke-JudgeSetup { docker build -f apps/judge-worker/sandbox/engine.Dockerfile -t codeforge-judge-engine:p2 apps/judge-worker/sandbox }
# Trusted disposable engine is privileged. It has no host binds/socket,
# application secrets, ports or network. Candidate sandboxes never inherit it.
Invoke-JudgeSetup { docker run -d --name $judgeName --privileged --network none --memory 2560m --cpus 2 --pids-limit 2048 --label codeforge.disposable=phase2-judge codeforge-judge-engine:p2 }
for ($judgeAttempt = 0; $judgeAttempt -lt 30; $judgeAttempt++) {
  docker exec $judgeName docker info --format '{{.ServerVersion}}' 2>$null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
if ($LASTEXITCODE -ne 0) { throw 'Disposable engine did not start' }
Invoke-JudgeSetup { docker save -o $judgeArchive codeforge-judge-toolchain:p2 }
Invoke-JudgeSetup { docker cp $judgeArchive ($judgeName + ':/toolchain.tar') }
Invoke-JudgeSetup { docker exec $judgeName docker load -i /toolchain.tar }
$env:FORGE_JUDGE_ENGINE = $judgeName
$env:FORGE_TOOLCHAIN_IMAGE = docker exec $judgeName docker image inspect --format '{{.Id}}' codeforge-judge-toolchain:p2
if ($LASTEXITCODE -ne 0 -or $env:FORGE_TOOLCHAIN_IMAGE -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Immutable toolchain identity unavailable' }
Invoke-JudgeSetup { pnpm --filter @codeforge/judge-worker run doctor }
Write-Output "Disposable engine ready: $judgeName. Environment variables set in this PowerShell session. Run verify-phase2-judge.ps1."
