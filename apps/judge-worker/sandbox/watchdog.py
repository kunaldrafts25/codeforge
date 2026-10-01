"""Trusted engine reaper; independent of worker/database availability."""
import subprocess
import time
while True:
    try:
        result = subprocess.run(['python3', '/opt/forge/executor.py', '--gc'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    except subprocess.TimeoutExpired:
        time.sleep(1)
        continue
    if result.returncode != 0:
        time.sleep(1)
    else:
        time.sleep(5)
