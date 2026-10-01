param([switch]$SkipBrowser, [switch]$SkipStatic)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-Phase2Checked([scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Phase 2 verification failed with exit code $LASTEXITCODE" }
}
$phase2Database = 'phase2_' + [Guid]::NewGuid().ToString('N')
$phase2Restore = $phase2Database + '_restore'
$phase2Project = 'codeforge-' + $phase2Database.Replace('_', '-')
$env:PHASE2_POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml up -d --wait postgres }
$phase2Address = docker compose -p $phase2Project -f docker-compose.phase2.yml port postgres 5432
if ($LASTEXITCODE -ne 0 -or $phase2Address -notmatch '^127\.0\.0\.1:([0-9]+)$') { throw 'Disposable loopback endpoint unavailable' }
$phase2Port = $Matches[1]
$env:DATABASE_URL = 'postgresql://{0}:{1}@127.0.0.1:{2}/{3}' -f 'phase2', $env:PHASE2_POSTGRES_PASSWORD, $phase2Port, $phase2Database
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
$env:SEED_BLOB_ROOT = Join-Path $env:TEMP $phase2Database
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $phase2Database }
Invoke-Phase2Checked { pnpm install --offline --frozen-lockfile }
Invoke-Phase2Checked { pnpm --filter @codeforge/db db:generate }
# Apply only the recorded Phase 1 SQL to this newly created empty database,
# record its baseline, seed Phase 1 data, then deploy the additive migration.
foreach ($phase2BaselineId in @('20261001000100_baseline', '20261001000200_phase1_quiz_integrity')) {
  Get-Content -LiteralPath "packages/db/prisma/migrations/$phase2BaselineId/migration.sql" -Raw | docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres psql -q -U phase2 -d $phase2Database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Disposable Phase 1 SQL deployment failed' }
  Invoke-Phase2Checked { pnpm --filter @codeforge/db exec prisma migrate resolve --applied $phase2BaselineId }
}
Invoke-Phase2Checked { pnpm --filter @codeforge/db db:seed }
$phase2CompatibilitySql = ((Get-Content -LiteralPath 'scripts/phase1-restore-fingerprint.sql' | Where-Object { $_ -notmatch '_prisma_migrations' }) -join "`n") + ';'
$phase2Before = $phase2CompatibilitySql | docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase2Database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Compatibility baseline failed' }
Invoke-Phase2Checked { pnpm --filter @codeforge/db db:migrate:deploy }
$phase2After = $phase2CompatibilitySql | docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase2Database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($phase2Before -join "`n") -cne ($phase2After -join "`n")) { throw 'Existing Phase 1 data changed during additive migration' }
Write-Output 'PASS: existing Phase 1 table fingerprints unchanged by additive migration.'
Invoke-Phase2Checked { pnpm --filter @codeforge/api exec tsx scripts/verify-phase2-data.ts }
if (-not $SkipStatic) {
  Invoke-Phase2Checked { pnpm lint }
  Invoke-Phase2Checked { pnpm typecheck }
  Invoke-Phase2Checked { pnpm test }
  Invoke-Phase2Checked { pnpm build }
}
if (-not $SkipBrowser) {
  # Next dev requires development mode; all test credentials remain fresh.
  $env:NODE_ENV = 'development'
  Invoke-Phase2Checked { pnpm exec playwright test }
}
$phase2Dump = "/tmp/$phase2Database.dump"
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres pg_dump -U phase2 -d $phase2Database -Fc --no-owner --no-privileges -f $phase2Dump }
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres createdb -U phase2 $phase2Restore }
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres pg_restore -U phase2 -d $phase2Restore --no-owner --no-privileges --exit-on-error $phase2Dump }
$phase2Sql = Get-Content -LiteralPath 'scripts/phase2-restore-fingerprint.sql' -Raw
$phase2Source = $phase2Sql | docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase2Database -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Source fingerprint failed' }
$phase2Restored = $phase2Sql | docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres psql -U phase2 -d $phase2Restore -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0 -or ($phase2Source -join "`n") -cne ($phase2Restored -join "`n")) { throw 'Restore fingerprints differ' }
$phase2Source
Invoke-Phase2Checked { docker compose -p $phase2Project -f docker-compose.phase2.yml exec -T postgres sha256sum $phase2Dump }
Write-Output "PASS: data checks and restore; browser skipped=$SkipBrowser; static checks skipped=$SkipStatic. Project $phase2Project; databases $phase2Database and $phase2Restore. No candidate code executed."
