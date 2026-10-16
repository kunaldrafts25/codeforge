#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# == 0 ]] || { echo 'Required acceptance cannot skip checks' >&2; exit 1; }
inherited_engine="${FORGE_JUDGE_ENGINE:-}"
setup_requested=0
project=''
worker_pid=''
cleanup() {
  if [[ -n $worker_pid ]]; then kill "$worker_pid" 2>/dev/null || true; wait "$worker_pid" 2>/dev/null || true; fi
  if [[ -n $project ]]; then "${compose[@]}" down; fi
  if [[ $setup_requested == 1 && ${FORGE_JUDGE_ENGINE:-} != "$inherited_engine" && ${FORGE_JUDGE_ENGINE:-} =~ ^codeforge-p2-engine(-[a-z0-9]+)?$ ]]; then
    docker rm -fv "$FORGE_JUDGE_ENGINE" >/dev/null
  fi
}
trap cleanup EXIT
if [[ ! ${FORGE_JUDGE_ENGINE:-} =~ ^codeforge-p2-engine(-[a-z0-9]+)?$ || ! ${FORGE_TOOLCHAIN_IMAGE:-} =~ ^sha256:[a-f0-9]{64}$ ]]; then
  setup_requested=1
  source scripts/setup-judge.sh
fi
suffix="$(openssl rand -hex 16)"
project="codeforge-phase3-$suffix"
database="phase2_$suffix" # Existing acceptance-only fault guard permits this fresh namespace.
export PHASE2_POSTGRES_PASSWORD="$(openssl rand -hex 32)"
compose=(docker compose -p "$project" -f docker-compose.phase2.yml)
"${compose[@]}" up -d --wait postgres
address="$("${compose[@]}" port postgres 5432)"
[[ $address =~ ^127\.0\.0\.1:([0-9]+)$ ]] || exit 1
printf -v DATABASE_URL 'postgresql://%s:%s@127.0.0.1:%s/%s' phase2 "$PHASE2_POSTGRES_PASSWORD" "${BASH_REMATCH[1]}" "$database"
export DATABASE_URL
export FORGE_TEST_POSTGRES="$("${compose[@]}" ps -q postgres)"
export NODE_ENV=test COOKIE_SECURE=false COOKIE_DOMAIN=localhost SEED_DISPOSABLE_DATABASE=1 FORGE_PRACTICE_ENABLED=1 FORGE_CAPACITY=1000
export JWT_SECRET="$(openssl rand -hex 32)" JWT_REFRESH_SECRET="$(openssl rand -hex 32)" CSRF_SECRET="$(openssl rand -hex 32)"
export SEED_ADMIN_PASSWORD="$(openssl rand -hex 24)" SEED_REVIEWER_PASSWORD="$(openssl rand -hex 24)"
export SEED_BLOB_ROOT="$(mktemp -d -t codeforge-real-p3-judge-blobs-XXXXXXXX)"
export FRONTEND_URL=http://localhost:3000 ADMIN_URL=http://localhost:3001 PUBLIC_API_URL=http://localhost:5000 NEXT_PUBLIC_API_URL=http://localhost:5000/api
export EMAIL_PROVIDER=sandbox MAIL_SANDBOX_URL=http://127.0.0.1:8025 RESEND_API_KEY='' SENTRY_DSN=''
"${compose[@]}" exec -T postgres createdb -U phase2 "$database"
pnpm --filter @codeforge/db db:generate
pnpm --filter @codeforge/db db:migrate:deploy
pnpm --filter @codeforge/db db:seed
pnpm --filter @codeforge/api exec tsx scripts/verify-phase3-judge.ts
export NODE_ENV=development
node --import ./apps/judge-worker/node_modules/tsx/dist/loader.mjs apps/judge-worker/src/service.ts > /tmp/codeforge-real-p3-worker.log 2>&1 &
worker_pid=$!
PLAYWRIGHT_TEST_MATCH='**/phase3.spec.ts' pnpm exec playwright test tests/e2e/phase3.spec.ts
kill "$worker_pid"; wait "$worker_pid" || true; worker_pid='' 
"${compose[@]}" exec -T postgres pg_dump -U phase2 -d "$database" -Fc --no-owner --no-privileges -f /tmp/real-p3-judge.dump
"${compose[@]}" exec -T postgres createdb -U phase2 "${database}_restore"
"${compose[@]}" exec -T postgres pg_restore -U phase2 -d "${database}_restore" --no-owner --no-privileges --exit-on-error /tmp/real-p3-judge.dump
before="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1 < scripts/phase3-restore-fingerprint.sql)"
after="$("${compose[@]}" exec -T postgres psql -U phase2 -d "${database}_restore" -At -v ON_ERROR_STOP=1 < scripts/phase3-restore-fingerprint.sql)"
[[ "$before" == "$after" ]] || { echo 'Real judge restore mismatch' >&2; exit 1; }
printf '%s\n' "$before"
"${compose[@]}" exec -T postgres sha256sum /tmp/real-p3-judge.dump
echo 'PASS: Gate P3 real judge execution, 100 worker submissions, and restore fingerprint match.'

