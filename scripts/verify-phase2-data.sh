#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# -eq 0 || ( $# -eq 1 && "${1:-}" == '--browser' ) ]] || { echo 'Usage: verify-phase2-data.sh [--browser]' >&2; exit 1; }
# This script runs trusted API/data fixtures only. It never executes candidates.
suffix="$(openssl rand -hex 16)"
project="codeforge-phase2-$suffix"
database="phase2_$suffix"
restore="${database}_restore"
export PHASE2_POSTGRES_PASSWORD="$(openssl rand -hex 32)"
compose=(docker compose -p "$project" -f docker-compose.phase2.yml)
trap '"${compose[@]}" down' EXIT
"${compose[@]}" up -d --wait postgres
address="$("${compose[@]}" port postgres 5432)"
[[ "$address" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || { echo 'Expected disposable loopback port' >&2; exit 1; }
printf -v DATABASE_URL 'postgresql://%s:%s@127.0.0.1:%s/%s' phase2 "$PHASE2_POSTGRES_PASSWORD" "${BASH_REMATCH[1]}" "$database"
export DATABASE_URL
export NODE_ENV=test COOKIE_SECURE=false COOKIE_DOMAIN=localhost SEED_DISPOSABLE_DATABASE=1
export JWT_SECRET="$(openssl rand -hex 32)" JWT_REFRESH_SECRET="$(openssl rand -hex 32)" CSRF_SECRET="$(openssl rand -hex 32)"
export SEED_ADMIN_PASSWORD="$(openssl rand -hex 24)" SEED_REVIEWER_PASSWORD="$(openssl rand -hex 24)"
export FRONTEND_URL=http://localhost:3000 ADMIN_URL=http://localhost:3001 PUBLIC_API_URL=http://localhost:5000
export NEXT_PUBLIC_API_URL=http://localhost:5000/api
export EMAIL_PROVIDER=sandbox MAIL_SANDBOX_URL=http://127.0.0.1:8025 SENTRY_DSN='' RESEND_API_KEY=''
export SEED_BLOB_ROOT="$(mktemp -d -t codeforge-phase2-blobs-XXXXXXXX)"
"${compose[@]}" exec -T postgres createdb -U phase2 "$database"
pnpm --filter @codeforge/db db:generate
for migration in 20261001000100_baseline 20261001000200_phase1_quiz_integrity; do
  "${compose[@]}" exec -T postgres psql -q -U phase2 -d "$database" -v ON_ERROR_STOP=1 < "packages/db/prisma/migrations/$migration/migration.sql"
  pnpm --filter @codeforge/db exec prisma migrate resolve --applied "$migration"
done
pnpm --filter @codeforge/db db:seed
fingerprint="$(sed '/_prisma_migrations/d' scripts/phase1-restore-fingerprint.sql);"
before="$(printf '%s\n' "$fingerprint" | "${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1)"
pnpm --filter @codeforge/db db:migrate:deploy
after="$(printf '%s\n' "$fingerprint" | "${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1)"
[[ "$before" == "$after" ]] || { echo 'Existing Phase 1 data changed' >&2; exit 1; }
echo 'PASS: existing Phase 1 fingerprints preserved.'
pnpm --filter @codeforge/api exec tsx scripts/verify-phase2-data.ts
if [[ ${1:-} == '--browser' ]]; then
  export NODE_ENV=development
  pnpm exec playwright test
fi
"${compose[@]}" exec -T postgres pg_dump -U phase2 -d "$database" -Fc --no-owner --no-privileges -f /tmp/phase2.dump
"${compose[@]}" exec -T postgres createdb -U phase2 "$restore"
"${compose[@]}" exec -T postgres pg_restore -U phase2 -d "$restore" --no-owner --no-privileges --exit-on-error /tmp/phase2.dump
source_digest="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1 < scripts/phase2-restore-fingerprint.sql)"
restore_digest="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$restore" -At -v ON_ERROR_STOP=1 < scripts/phase2-restore-fingerprint.sql)"
[[ "$source_digest" == "$restore_digest" ]] || { echo 'Restore mismatch' >&2; exit 1; }
printf '%s\n' "$source_digest"
"${compose[@]}" exec -T postgres sha256sum /tmp/phase2.dump
echo 'PASS: disposable Linux/PostgreSQL data and restore; synthetic lifecycle fixtures only, execution disabled.'
