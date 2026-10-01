#!/bin/sh
set -eu
"$@" &
daemon_pid=$!
python3 /opt/forge/watchdog.py &
watchdog_pid=$!
trap 'kill "$daemon_pid" "$watchdog_pid" 2>/dev/null || true; wait || true' TERM INT EXIT
while kill -0 "$daemon_pid" 2>/dev/null && kill -0 "$watchdog_pid" 2>/dev/null; do sleep 1; done
exit 1
