#!/bin/sh
# SQLite backup includes WAL transactions. Run as root; backups stay outside source.
set -eu
umask 077
SRC=${1:-/opt/trainer/server_data/trainer.db}
DST=${2:-/opt/trainer-backups}
KEEP=14
[ -f "$SRC" ] || { echo "Database not found" >&2; exit 1; }
mkdir -p "$DST"
chmod 700 "$DST"
# Avoid overlapping cron/manual runs.
exec 9>"$DST/.backup.lock"
flock -n 9 || exit 0
TMP=$(mktemp "$DST/.snapshot.XXXXXX")
trap 'rm -f "$TMP" "$TMP.gz"' EXIT HUP INT TERM
python3 - "$SRC" "$TMP" <<'PY'
import sqlite3,sys
from pathlib import Path
s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro', uri=True)
d=sqlite3.connect(sys.argv[2])
try:
    s.backup(d)
    if d.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Backup integrity check failed')
finally:
    d.close(); s.close()
PY
gzip -f "$TMP"
F="$DST/trainer-$(date +%Y-%m-%d-%H%M%S)-${TMP##*.}.db.gz"
# Preserve the private policy alongside this exact snapshot, outside the repository.
python3 - "$SRC" "$F.private.json" <<'PYCODE'
import os,sys
from pathlib import Path
p=Path(sys.argv[1]).parent/'private_config.json'
if p.exists():
    fd=os.open(sys.argv[2], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'wb') as out: out.write(p.read_bytes())
PYCODE
mv "$TMP.gz" "$F"
python3 - "$DST" "$KEEP" <<'PY'
import sys
from pathlib import Path
copies=sorted(Path(sys.argv[1]).glob('trainer-*.db.gz'), key=lambda p:p.stat().st_mtime, reverse=True)
for p in copies[int(sys.argv[2]):]:
    policy=Path(str(p)+'.private.json')
    if policy.exists(): policy.unlink()
    p.unlink()
PY
echo "Verified backup: $F"
