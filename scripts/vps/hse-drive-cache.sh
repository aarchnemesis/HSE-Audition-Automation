#!/usr/bin/env bash
set -uo pipefail
cd /opt/hse-automation || exit 1
export TZ=America/Sao_Paulo
LOG=/var/log/hse-drive-cache.log
echo "===== $(date -Is) hse-drive-cache start" >> "$LOG"
if [ -f src/cli/runDriveInspectorsCache.ts ]; then
  npx tsx src/cli/runDriveInspectorsCache.ts >> "$LOG" 2>&1
else
  python3 scripts/generateTreinamentosCache.py >> "$LOG" 2>&1
fi
status=$?
echo "===== $(date -Is) hse-drive-cache exit $status" >> "$LOG"
exit $status
