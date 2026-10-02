param([switch]$SkipBrowser, [switch]$SkipStatic)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-Phase3Checked([scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Phase 3 verification failed with exit code $LASTEXITCODE" }
}
$phase3Database = 'phase3_' + [Guid]::NewGuid().ToString('N')
$phase3Restore = $phase3Database + '_restore'
$phase3Project = 'codeforge-' + $phase3Database.Replace('_', '-')
$env:PHASE3_POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
Invoke-Phase3Checked { docker compose -p $phase3Project -f docker-compose.phase2.yml up -d --wait postgres }
$phase3Address = docker compose -p $phase3Project -f docker-compose.phase2.yml port postgres 5432
if ($LASTEXITCODE -ne 0 -or $phase3Address -notmatch '^127\.0\.0\.1:([0-9]+)$') { throw 'Disposable loopback endpoint unavailable' }
$phase3Port = $Matches[1]
$env:DATABASE_URL = 'postgresql://{0}:{1}@127.0.0.1:{2}/{3}' -f 'phase2', $env:PHASE3_POSTGRES_PASSWORD, $phase3Port, $phase3Database
$env:NODE_ENV = 'test'
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
$env:SENTRY_DSN = ''
$env:RESEND_API_KEY = ''
$env:SEED_DISPOSABLE_DATABASE = '1'
$env:SEED_ADMIN_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:SEED_REVIEWER_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:SEED_BLOB_ROOT = Join-Path $env:TEMP $phase3Database

Invoke-Phase3Checked { docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $phase3Database }
Invoke-Phase3Checked { pnpm install --offline --frozen-lockfile }
Invoke-Phase3Checked { pnpm --filter @codeforge/db db:generate }

# Baseline Phase 1 and Phase 2 migrations applied first
foreach ($pBaselineId in @('20261001000100_baseline', '20261001000200_phase1_quiz_integrity', '20261001000300_phase2_practice', '20261002000100_phase2_judge_runtime')) {
  Get-Content -LiteralPath "packages/db/prisma/migrations/$pBaselineId/migration.sql" -Raw | docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres psql -q -U phase2 -d $phase3Database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Phase baseline migration $pBaselineId failed" }
  Invoke-Phase3Checked { pnpm --filter @codeforge/db exec prisma migrate resolve --applied $pBaselineId }
}
Invoke-Phase3Checked { pnpm --filter @codeforge/db db:seed }

$p2CompatibilitySql = ((Get-Content -LiteralPath 'scripts/phase2-restore-fingerprint.sql' | Where-Object { $_ -notmatch '_prisma_migrations' }) -join "`n") + ';'
$p2Before = $p2CompatibilitySql | docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase3Database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 compatibility baseline failed' }

# Deploy Phase 3 migration
Invoke-Phase3Checked { pnpm --filter @codeforge/db db:migrate:deploy }
$p2After = $p2CompatibilitySql | docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase3Database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($p2Before -join "`n") -cne ($p2After -join "`n")) { throw 'Existing Phase 2 data changed during Phase 3 additive migration' }
Write-Output 'PASS: Existing Phase 1 and Phase 2 table fingerprints unchanged by Phase 3 additive migration.'

# Run Phase 3 verification
Invoke-Phase3Checked { pnpm --filter @codeforge/api exec tsx scripts/verify-phase3-data.ts }

if (-not $SkipStatic) {
  Invoke-Phase3Checked { pnpm typecheck }
  Invoke-Phase3Checked { pnpm test }
  Invoke-Phase3Checked { pnpm build }
}

# Dump and restore verification
docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres pg_dump -U phase2 -d $phase3Database -Fc --no-owner --no-privileges -f /tmp/phase3.dump
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $phase3Restore
if ($LASTEXITCODE -ne 0) { throw 'Create restore database failed' }
docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres pg_restore -U phase2 -d $phase3Restore --no-owner --no-privileges --exit-on-error /tmp/phase3.dump
if ($LASTEXITCODE -ne 0) { throw 'Database restore failed' }

$phase3SourceDigest = Get-Content -LiteralPath 'scripts/phase3-restore-fingerprint.sql' -Raw | docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase3Database -At -v ON_ERROR_STOP=1
$phase3RestoreDigest = Get-Content -LiteralPath 'scripts/phase3-restore-fingerprint.sql' -Raw | docker compose -p $phase3Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase3Restore -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($phase3SourceDigest -join "`n") -cne ($phase3RestoreDigest -join "`n")) { throw 'Restored Phase 3 database does not match original database' }

Write-Output 'PASS: Phase 3 full verification, migrations, replay, dump, and restore fingerprint match.'
