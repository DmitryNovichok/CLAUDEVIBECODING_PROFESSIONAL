#!/bin/sh
# Full verified snapshot outside the source tree: DB, private settings and files.
set -eu
umask 077
SRC=${1:-/opt/trainer/server_data/trainer.db}
DST=${2:-/opt/trainer-backups}
KEEP=${EGE_BACKUP_KEEP:-14}
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$DST"
chmod 700 "$DST"
exec 9>"$DST/.backup.lock"
flock -n 9 || exit 0
F="$DST/trainer-$(date +%Y-%m-%d-%H%M%S)-$$.tar.gz"
python3 "$DEPLOY_DIR/snapshot.py" create "$SRC" "$F"
python3 - "$DST" "$KEEP" <<'PYCODE'
import sys
from pathlib import Path
keep = int(sys.argv[2])
if keep < 2:
    raise SystemExit('KEEP must be at least 2')
copies = sorted(Path(sys.argv[1]).glob('trainer-*.tar.gz'), key=lambda p: p.stat().st_mtime, reverse=True)
for path in copies[keep:]:
    path.unlink()
# Legacy DB-only snapshots are retained until the operator verifies a full restore.
PYCODE
