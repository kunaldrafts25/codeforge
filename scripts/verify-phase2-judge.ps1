param([switch]$SkipCapacity)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-JudgeChecked([scriptblock]$Action) { & $Action; if ($LASTEXITCODE -ne 0) { throw "Judge verification failed: exit $LASTEXITCODE" } }
if ($env:FORGE_JUDGE_ENGINE -notmatch '^codeforge-p2-engine(-[a-z0-9]+)?$' -or $env:FORGE_TOOLCHAIN_IMAGE -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Run setup-judge.ps1 or supply the verified disposable engine identity.' }
$judgeDatabase = 'phase2_' + [Guid]::NewGuid().ToString('N')
$judgeProject = 'codeforge-' + $judgeDatabase.Replace('_', '-')
$env:PHASE2_POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml up -d --wait postgres }
$judgeAddress = docker compose -p $judgeProject -f docker-compose.phase2.yml port postgres 5432
if ($LASTEXITCODE -ne 0 -or $judgeAddress -notmatch '^127\.0\.0\.1:([0-9]+)$') { throw 'Disposable loopback port required' }
$env:DATABASE_URL = 'postgresql://phase2:{0}@127.0.0.1:{1}/{2}' -f $env:PHASE2_POSTGRES_PASSWORD, $Matches[1], $judgeDatabase
$env:SEED_DISPOSABLE_DATABASE = '1'
$env:NODE_ENV = 'test'
$env:JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:JWT_REFRESH_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:CSRF_SECRET = [Guid]::NewGuid().ToString('N')
$env:COOKIE_SECURE = 'false'
$env:COOKIE_DOMAIN = 'localhost'
$env:EMAIL_PROVIDER = 'sandbox'
$env:MAIL_SANDBOX_URL = 'http://127.0.0.1:8025'
$env:RESEND_API_KEY = ''
$env:SENTRY_DSN = ''
$env:FORGE_PRACTICE_ENABLED = '1'
$env:FORGE_CAPACITY = '1000'
$env:FORGE_TEST_POSTGRES = docker compose -p $judgeProject -f docker-compose.phase2.yml ps -q postgres
$env:SEED_ADMIN_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:SEED_REVIEWER_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:SEED_BLOB_ROOT = Join-Path $env:TEMP ('codeforge-real-judge-blobs-' + [Guid]::NewGuid().ToString('N'))
$env:FRONTEND_URL = 'http://localhost:3000'
$env:ADMIN_URL = 'http://localhost:3001'
$env:PUBLIC_API_URL = 'http://localhost:5000'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:5000/api'
if ($SkipCapacity) { throw 'Capacity cannot be skipped in the required judge acceptance run.' }
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $judgeDatabase }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:generate }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:migrate:deploy }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:seed }
Invoke-JudgeChecked { pnpm --filter @codeforge/judge-worker integration }
Invoke-JudgeChecked { pnpm --filter @codeforge/api exec tsx scripts/verify-phase2-judge.ts }
$env:NODE_ENV = 'development'
$judgeLog = Join-Path $env:TEMP ('codeforge-real-judge-' + [Guid]::NewGuid().ToString('N'))
$judgeWorker = Start-Process -FilePath (Get-Command node).Source -ArgumentList '--import','./apps/judge-worker/node_modules/tsx/dist/loader.mjs','apps/judge-worker/src/service.ts' -WindowStyle Hidden -PassThru -RedirectStandardOutput ($judgeLog + '.out.log') -RedirectStandardError ($judgeLog + '.err.log')
try { Invoke-JudgeChecked { pnpm exec playwright test --config playwright.judge.config.ts } }
finally { if (-not $judgeWorker.HasExited) { Stop-Process -Id $judgeWorker.Id; $judgeWorker.WaitForExit() } }
$env:FORGE_PRACTICE_ENABLED = '0'
Invoke-JudgeChecked { pnpm exec playwright test }
$judgeRestore = $judgeDatabase + '_restore'
$judgeDump = '/tmp/real-judge.dump'
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres pg_dump -U phase2 -d $judgeDatabase -Fc --no-owner --no-privileges -f $judgeDump }
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $judgeRestore }
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres pg_restore -U phase2 -d $judgeRestore --no-owner --no-privileges --exit-on-error $judgeDump }
$judgeSql = Get-Content scripts/phase2-restore-fingerprint.sql -Raw
$judgeBefore = $judgeSql | docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $judgeDatabase -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Source fingerprint failed' }
$judgeAfter = $judgeSql | docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $judgeRestore -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($judgeBefore -join "`n") -cne ($judgeAfter -join "`n")) { throw 'Real judge restore mismatch' }
$judgeBefore
Write-Output "PASS: real judge execution, 1000 jobs and restore. Disposable project: $judgeProject. Database: $judgeDatabase."
