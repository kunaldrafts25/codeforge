#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
suffix="$(openssl rand -hex 12)"
export FORGE_JUDGE_ENGINE="codeforge-p2-engine-$suffix"
archive="$(mktemp -t codeforge-toolchain-XXXXXXXX.tar)"
docker build -f apps/judge-worker/sandbox/toolchain.Dockerfile -t codeforge-judge-toolchain:p2 apps/judge-worker/sandbox
docker build -f apps/judge-worker/sandbox/engine.Dockerfile -t codeforge-judge-engine:p2 apps/judge-worker/sandbox
# Dedicated privileged control plane, never candidate privilege or host binds.
docker run -d --name "$FORGE_JUDGE_ENGINE" --privileged --network none --memory 2560m --cpus 2 --pids-limit 2048 --label codeforge.disposable=phase2-judge codeforge-judge-engine:p2
ready=0
for attempt in {1..30}; do if docker exec "$FORGE_JUDGE_ENGINE" docker info >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[[ $ready == 1 ]] || { echo 'Judge engine unavailable' >&2; return 1 2>/dev/null || exit 1; }
docker save -o "$archive" codeforge-judge-toolchain:p2
docker cp "$archive" "$FORGE_JUDGE_ENGINE:/toolchain.tar"
docker exec "$FORGE_JUDGE_ENGINE" docker load -i /toolchain.tar
export FORGE_TOOLCHAIN_IMAGE="$(docker exec "$FORGE_JUDGE_ENGINE" docker image inspect --format '{{.Id}}' codeforge-judge-toolchain:p2)"
pnpm --filter @codeforge/judge-worker run doctor
printf 'Disposable judge ready: %s\n' "$FORGE_JUDGE_ENGINE"
# Source this script to retain its two non-secret engine identity variables.
