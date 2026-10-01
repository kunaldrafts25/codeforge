#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# == 0 ]] || { echo 'Required acceptance cannot skip checks' >&2; exit 1; }
[[ ${FORGE_JUDGE_ENGINE:-} =~ ^codeforge-p2-engine(-[a-z0-9]+)?$ && ${FORGE_TOOLCHAIN_IMAGE:-} =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
suffix="$(openssl rand -hex 16)"
project="codeforge-phase2-$suffix"
database="phase2_$suffix"
export PHASE2_POSTGRES_PASSWORD="$(openssl rand -hex 32)"
compose=(docker compose -p "$project" -f docker-compose.phase2.yml)
worker_pid=''
cleanup() {
  if [[ -n $worker_pid ]]; then kill "$worker_pid" 2>/dev/null || true; wait "$worker_pid" 2>/dev/null || true; fi
  "${compose[@]}" down
  docker rm -fv "$FORGE_JUDGE_ENGINE" >/dev/null
}
trap cleanup EXIT
"${compose[@]}" up -d --wait postgres
address="$("${compose[@]}" port postgres 5432)"
[[ $address =~ ^127\.0\.0\.1:([0-9]+)$ ]] || exit 1
printf -v DATABASE_URL 'postgresql://%s:%s@127.0.0.1:%s/%s' phase2 "$PHASE2_POSTGRES_PASSWORD" "${BASH_REMATCH[1]}" "$database"
export DATABASE_URL
export FORGE_TEST_POSTGRES="$("${compose[@]}" ps -q postgres)"
export NODE_ENV=test COOKIE_SECURE=false COOKIE_DOMAIN=localhost SEED_DISPOSABLE_DATABASE=1 FORGE_PRACTICE_ENABLED=1 FORGE_CAPACITY=1000
export JWT_SECRET="$(openssl rand -hex 32)" JWT_REFRESH_SECRET="$(openssl rand -hex 32)" CSRF_SECRET="$(openssl rand -hex 32)"
export SEED_ADMIN_PASSWORD="$(openssl rand -hex 24)" SEED_REVIEWER_PASSWORD="$(openssl rand -hex 24)"
export SEED_BLOB_ROOT="$(mktemp -d -t codeforge-real-judge-blobs-XXXXXXXX)"
export FRONTEND_URL=http://localhost:3000 ADMIN_URL=http://localhost:3001 PUBLIC_API_URL=http://localhost:5000 NEXT_PUBLIC_API_URL=http://localhost:5000/api
export EMAIL_PROVIDER=sandbox MAIL_SANDBOX_URL=http://127.0.0.1:8025 RESEND_API_KEY='' SENTRY_DSN=''
"${compose[@]}" exec -T postgres createdb -U phase2 "$database"
pnpm --filter @codeforge/db db:generate
pnpm --filter @codeforge/db db:migrate:deploy
pnpm --filter @codeforge/db db:seed
pnpm --filter @codeforge/judge-worker integration
pnpm --filter @codeforge/api exec tsx scripts/verify-phase2-judge.ts
export NODE_ENV=development
node --import ./apps/judge-worker/node_modules/tsx/dist/loader.mjs apps/judge-worker/src/service.ts > /tmp/codeforge-real-worker.log 2>&1 &
worker_pid=$!
pnpm exec playwright test --config playwright.judge.config.ts
kill "$worker_pid"; wait "$worker_pid" || true; worker_pid=''
export FORGE_PRACTICE_ENABLED=0
pnpm exec playwright test
"${compose[@]}" exec -T postgres pg_dump -U phase2 -d "$database" -Fc --no-owner --no-privileges -f /tmp/real-judge.dump
"${compose[@]}" exec -T postgres createdb -U phase2 "${database}_restore"
"${compose[@]}" exec -T postgres pg_restore -U phase2 -d "${database}_restore" --no-owner --no-privileges --exit-on-error /tmp/real-judge.dump
before="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1 < scripts/phase2-restore-fingerprint.sql)"
after="$("${compose[@]}" exec -T postgres psql -U phase2 -d "${database}_restore" -At -v ON_ERROR_STOP=1 < scripts/phase2-restore-fingerprint.sql)"
[[ "$before" == "$after" ]] || { echo 'Real judge restore mismatch' >&2; exit 1; }
printf '%s\n' "$before"
"${compose[@]}" exec -T postgres sha256sum /tmp/real-judge.dump
echo 'PASS: actual judge, recovery, 1000 jobs, live browser, Phase 1 regression, migrations and restore.'
