#!/bin/sh
set -eu
# The outer container must have a private cgroup namespace. Keep trusted
# control processes in a leaf: cgroup v2 forbids enabling domain controllers
# on a populated root. All writes stay inside this disposable container.
test "$(cat /proc/self/cgroup)" = '0::/'
test -f /sys/fs/cgroup/cgroup.controllers
mkdir -p /sys/fs/cgroup/forge-control
while read -r control_pid; do
  echo "$control_pid" > /sys/fs/cgroup/forge-control/cgroup.procs
done < /sys/fs/cgroup/cgroup.procs
echo '+cpu +memory +pids' > /sys/fs/cgroup/cgroup.subtree_control
"$@" &
daemon_pid=$!
python3 /opt/forge/watchdog.py &
watchdog_pid=$!
trap 'kill "$daemon_pid" "$watchdog_pid" 2>/dev/null || true; wait || true' TERM INT EXIT
while kill -0 "$daemon_pid" 2>/dev/null && kill -0 "$watchdog_pid" 2>/dev/null; do sleep 1; done
exit 1
