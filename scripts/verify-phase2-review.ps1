$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($args.Count -ne 0) { throw 'Review acceptance cannot skip checks' }
$judgeName = $null
try {
  pnpm --filter @codeforge/shared build
  if ($LASTEXITCODE -ne 0) { throw 'Shared build failed' }
  pnpm --filter @codeforge/checker-lib build
  if ($LASTEXITCODE -ne 0) { throw 'Checker build failed' }
  . ./scripts/setup-judge.ps1
  pnpm --filter @codeforge/judge-worker exec tsx src/resource-regressions.ts
  if ($LASTEXITCODE -ne 0) { throw 'Real resource regressions failed' }
  pnpm --filter @codeforge/judge-worker exec tsx src/review-regressions.ts
  if ($LASTEXITCODE -ne 0) { throw 'Real checker/name regressions failed' }
  Write-Output 'PASS: verified isolated four-language/two-mode resource, checker and boundary-name review regressions.'
} finally {
  if ($judgeName -match '^codeforge-p2-engine-[a-f0-9]{32}$') { docker rm -fv $judgeName }
}
