param([switch]$SkipBrowserInstall)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$docker = if ($dockerCommand) { $dockerCommand.Source } else {
  Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
}
if (-not (Test-Path -LiteralPath $docker)) { throw 'Docker CLI is missing' }
$env:PATH = "$(Split-Path -Parent $docker);$env:PATH"

function Invoke-Checked([scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Verification command failed with exit code $LASTEXITCODE" }
}

# Every invocation creates its own disposable database; no existing database is reset.
$database = 'phase1_' + [Guid]::NewGuid().ToString('N')
$restoreDatabase = $database + '_restore'
$env:DATABASE_URL = "postgresql://test:test@localhost:5432/$database"
$env:NODE_ENV = 'development'
$env:JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:JWT_REFRESH_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:CSRF_SECRET = [Guid]::NewGuid().ToString('N')
$env:COOKIE_SECURE = 'false'
$env:COOKIE_DOMAIN = 'localhost'
$env:FRONTEND_URL = 'http://localhost:3000'
$env:ADMIN_URL = 'http://localhost:3001'
$env:PUBLIC_API_URL = 'http://localhost:5000'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:5000/api'
$env:EMAIL_PROVIDER = 'sandbox'
$env:MAIL_SANDBOX_URL = 'http://127.0.0.1:8025'
$env:SEED_DISPOSABLE_DATABASE = '1'
$env:SEED_ADMIN_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:SEED_REVIEWER_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:SEED_BLOB_ROOT = Join-Path $env:TEMP $database

Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml up -d --wait postgres }
Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres createdb -U test $database }
Invoke-Checked { pnpm --filter @codeforge/db db:generate }
Invoke-Checked { pnpm --filter @codeforge/db db:migrate:deploy }
Invoke-Checked { pnpm --filter @codeforge/db db:seed }
Invoke-Checked { pnpm --filter @codeforge/db exec prisma migrate status }
if (-not $SkipBrowserInstall) { Invoke-Checked { pnpm exec playwright install chromium } }
Invoke-Checked { pnpm exec playwright test }

# Rehearse restore after the browser run so the dump includes actual attempts and audits.
$dump = "/tmp/$database.dump"
Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres pg_dump -U test -d $database -Fc --no-owner --no-privileges -f $dump }
Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres createdb -U test $restoreDatabase }
Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres pg_restore -U test -d $restoreDatabase --no-owner --no-privileges --exit-on-error $dump }
$digestSql = Get-Content -LiteralPath 'scripts/phase1-restore-fingerprint.sql' -Raw
$sourceDigest = $digestSql | & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres psql -U test -d $database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Source fingerprint failed' }
$restoreDigest = $digestSql | & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres psql -U test -d $restoreDatabase -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Restored fingerprint failed' }
if (($sourceDigest -join "`n") -cne ($restoreDigest -join "`n")) { throw 'Restore fingerprints differ' }
$sourceDigest
Invoke-Checked { & $docker compose -p codeforge-phase1 -f docker-compose.phase1.yml exec -T postgres sha256sum $dump }
Write-Output "PASS: browser, migrations, and restore; disposable databases $database and $restoreDatabase"
