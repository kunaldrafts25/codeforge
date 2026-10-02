#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
probe_dir="$(mktemp -d -t codeforge-review-cleanup-XXXXXXXX)"
export FORGE_CONTROL_TRACE="$probe_dir/docker-calls.txt"
export FORGE_JUDGE_ENGINE='codeforge-p2-engine-00000000000000000000000000000000'
# Control-flow test only: fail the first build, and record any attempted Docker
# command without touching a real daemon. This is not judge execution evidence.
pnpm() { return 1; }
docker() { printf '%s\n' "$*" >> "$FORGE_CONTROL_TRACE"; }
export -f pnpm docker
set +e
bash scripts/verify-phase2-review.sh > "$probe_dir/helper-output.txt" 2>&1
probe_status=$?
set -e
[[ $probe_status != 0 ]] || { echo 'Failed build was accepted' >&2; exit 1; }
[[ ! -e $FORGE_CONTROL_TRACE ]] || { echo 'Inherited engine cleanup attempted after failed build' >&2; exit 1; }
echo 'PASS: failed review build preserves inherited engine; control-flow fixture only.'
