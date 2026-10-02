#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# -eq 0 || ( $# -eq 1 && "${1:-}" == '--browser' ) ]] || { echo 'Usage: verify-phase3-data.sh [--browser]' >&2; exit 1; }

suffix="$(openssl rand -hex 16)"
project="codeforge-phase3-$suffix"
database="phase3_$suffix"
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
export SEED_BLOB_ROOT="$(mktemp -d -t codeforge-phase3-blobs-XXXXXXXX)"

"${compose[@]}" exec -T postgres createdb -U phase2 "$database"
pnpm --filter @codeforge/db db:generate

# Apply Phase 1 and Phase 2 migrations first to verify baseline preservation
for migration in 20261001000100_baseline 20261001000200_phase1_quiz_integrity 20261001000300_phase2_practice 20261002000100_phase2_judge_runtime; do
  "${compose[@]}" exec -T postgres psql -q -U phase2 -d "$database" -v ON_ERROR_STOP=1 < "packages/db/prisma/migrations/$migration/migration.sql"
  pnpm --filter @codeforge/db exec prisma migrate resolve --applied "$migration"
done
pnpm --filter @codeforge/db db:seed

# Check Phase 2 fingerprint before Phase 3 migration
p2_fingerprint="$(sed '/_prisma_migrations/d' scripts/phase2-restore-fingerprint.sql);"
p2_before="$(printf '%s\n' "$p2_fingerprint" | "${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1)"

# Apply Phase 3 migration
pnpm --filter @codeforge/db db:migrate:deploy

p2_after="$(printf '%s\n' "$p2_fingerprint" | "${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1)"
[[ "$p2_before" == "$p2_after" ]] || { echo 'Existing Phase 2 data changed unexpectedly after Phase 3 migration' >&2; exit 1; }
echo 'PASS: Existing Phase 1 and Phase 2 data fingerprints preserved.'

# Run Phase 3 end-to-end data, rating, scoring, and replay verification
pnpm --filter @codeforge/api exec tsx scripts/verify-phase3-data.ts

if [[ ${1:-} == '--browser' ]]; then
  export NODE_ENV=development
  PLAYWRIGHT_TEST_MATCH='**/phase3.spec.ts' pnpm exec playwright test tests/e2e/phase3.spec.ts
fi

# Test full pg_dump and pg_restore with Phase 3 fingerprint
"${compose[@]}" exec -T postgres pg_dump -U phase2 -d "$database" -Fc --no-owner --no-privileges -f /tmp/phase3.dump
"${compose[@]}" exec -T postgres createdb -U phase2 "$restore"
"${compose[@]}" exec -T postgres pg_restore -U phase2 -d "$restore" --no-owner --no-privileges --exit-on-error /tmp/phase3.dump
source_digest="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$database" -At -v ON_ERROR_STOP=1 < scripts/phase3-restore-fingerprint.sql)"
restore_digest="$("${compose[@]}" exec -T postgres psql -U phase2 -d "$restore" -At -v ON_ERROR_STOP=1 < scripts/phase3-restore-fingerprint.sql)"
[[ "$source_digest" == "$restore_digest" ]] || { echo 'Restore mismatch on Phase 3 tables' >&2; exit 1; }
printf '%s\n' "$source_digest"
"${compose[@]}" exec -T postgres sha256sum /tmp/phase3.dump
echo 'PASS: Phase 3 disposable Linux/PostgreSQL data, scoring, rating, replay, and private restore.'
