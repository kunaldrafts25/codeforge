param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Invoke-JudgeChecked([scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Phase 3 judge verification failed: exit $LASTEXITCODE" }
}

$judgeCreatedEngine = ''
$judgeInheritedEngine = $env:FORGE_JUDGE_ENGINE
$judgeBrowserWorker = $null
try {
if ($env:FORGE_JUDGE_ENGINE -notmatch '^codeforge-p2-engine(-[a-z0-9]+)?$' -or $env:FORGE_TOOLCHAIN_IMAGE -notmatch '^sha256:[0-9a-f]{64}$') {
  # If environment variables not set, check if setup-judge has run or supply defaults
  Write-Host "Running setup-judge to discover verified isolated judge engine..."
  try { & .\scripts\setup-judge.ps1 }
  finally {
    if ($env:FORGE_JUDGE_ENGINE -ne $judgeInheritedEngine -and $env:FORGE_JUDGE_ENGINE -match '^codeforge-p2-engine(-[a-z0-9]+)?$') {
      $judgeCreatedEngine = $env:FORGE_JUDGE_ENGINE
    }
  }
}

$judgeDatabase = 'phase2_' + [Guid]::NewGuid().ToString('N')
$judgeProject = 'codeforge-phase3-' + [Guid]::NewGuid().ToString('N')
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
$env:SEED_BLOB_ROOT = Join-Path $env:TEMP ('codeforge-real-p3-judge-blobs-' + [Guid]::NewGuid().ToString('N'))
$env:FRONTEND_URL = 'http://localhost:3000'
$env:ADMIN_URL = 'http://localhost:3001'
$env:PUBLIC_API_URL = 'http://localhost:5000'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:5000/api'

Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $judgeDatabase }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:generate }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:migrate:deploy }
Invoke-JudgeChecked { pnpm --filter @codeforge/db db:seed }

# Run the full Phase 3 20-competitor, 100-submission real-judge acceptance suite
Invoke-JudgeChecked { pnpm --filter @codeforge/api exec tsx scripts/verify-phase3-judge.ts }

# Browser candidates and staff use the same genuine worker boundary.
$env:NODE_ENV = 'development'
$judgeBrowserWorker = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--import','./apps/judge-worker/node_modules/tsx/dist/loader.mjs','apps/judge-worker/src/service.ts') -PassThru -WindowStyle Hidden
$env:PLAYWRIGHT_TEST_MATCH = '**/phase3.spec.ts'
Invoke-JudgeChecked { pnpm exec playwright test tests/e2e/phase3.spec.ts }
Stop-Process -Id $judgeBrowserWorker.Id -ErrorAction SilentlyContinue
$judgeBrowserWorker = $null

# Backup & Restore Verification
$judgeRestore = $judgeDatabase + '_restore'
$judgeDump = '/tmp/real-p3-judge.dump'
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres pg_dump -U phase2 -d $judgeDatabase -Fc --no-owner --no-privileges -f $judgeDump }
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $judgeRestore }
Invoke-JudgeChecked { docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres pg_restore -U phase2 -d $judgeRestore --no-owner --no-privileges --exit-on-error $judgeDump }

$judgeSql = Get-Content scripts/phase3-restore-fingerprint.sql -Raw
$judgeBefore = $judgeSql | docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $judgeDatabase -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Source fingerprint failed' }

$judgeAfter = $judgeSql | docker compose -p $judgeProject -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $judgeRestore -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($judgeBefore -join "`n") -cne ($judgeAfter -join "`n")) { throw 'Real judge restore mismatch' }



$judgeBefore
Write-Output "PASS: Gate P3 real judge execution, 100 worker submissions, and restore fingerprint match. Project: $judgeProject. Database: $judgeDatabase."


} finally {
  if ($judgeBrowserWorker -and -not $judgeBrowserWorker.HasExited) { Stop-Process -Id $judgeBrowserWorker.Id -ErrorAction SilentlyContinue }
  Remove-Item Env:PLAYWRIGHT_TEST_MATCH -ErrorAction SilentlyContinue
  if ($judgeProject) { docker compose -p $judgeProject -f docker-compose.phase2.yml down }
  if ($judgeCreatedEngine) { docker rm -fv $judgeCreatedEngine }
}
