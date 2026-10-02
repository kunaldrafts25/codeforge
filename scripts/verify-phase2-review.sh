#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# == 0 ]] || { echo 'Review acceptance cannot skip checks' >&2; exit 1; }
previous_engine="${FORGE_JUDGE_ENGINE:-}"
cleanup() {
  if [[ ${FORGE_JUDGE_ENGINE:-} != "$previous_engine" && ${FORGE_JUDGE_ENGINE:-} =~ ^codeforge-p2-engine-[a-f0-9]+$ ]]; then docker rm -fv "$FORGE_JUDGE_ENGINE" >/dev/null; fi
}
trap cleanup EXIT
pnpm --filter @codeforge/shared build
pnpm --filter @codeforge/checker-lib build
source scripts/setup-judge.sh
pnpm --filter @codeforge/judge-worker exec tsx src/resource-regressions.ts
pnpm --filter @codeforge/judge-worker exec tsx src/review-regressions.ts
echo 'PASS: verified isolated four-language/two-mode resource, checker and boundary-name review regressions.'
