#!/bin/sh
# Verified snapshot outside the source tree.
#   backup.sh            — быстрая копия: база, server_data и приватные настройки (секунды). Перед обновлением и каждый день.
#   backup.sh --full     — полная копия: ещё банки, media, data и материалы курса (минуты). Раз в неделю.
set -eu
umask 077
MODE=quick
if [ "${1:-}" = "--full" ]; then MODE=full; shift; fi
SRC=${1:-/opt/trainer/server_data/trainer.db}
DST=${2:-/opt/trainer-backups}
KEEP=${EGE_BACKUP_KEEP:-14}
KEEP_FULL=${EGE_BACKUP_KEEP_FULL:-2}
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$DST"
chmod 700 "$DST"
# Быстрая и полная копии не мешают друг другу. Повторный запуск того же вида ждёт окончания
# предыдущего, а не пропускает копию молча: обновление сайта никогда не идёт без свежей копии.
exec 9>"$DST/.backup-$MODE.lock"
flock -w 1800 9 || { echo "Предыдущая копия ($MODE) не закончилась за 30 минут" >&2; exit 1; }
if [ "$MODE" = full ]; then
    F="$DST/trainer-full-$(date +%Y-%m-%d-%H%M%S)-$$.tar.gz"
    python3 "$DEPLOY_DIR/snapshot.py" create "$SRC" "$F"
else
    F="$DST/trainer-$(date +%Y-%m-%d-%H%M%S)-$$.tar.gz"
    python3 "$DEPLOY_DIR/snapshot.py" create "$SRC" "$F" --quick
fi
python3 - "$DST" "$KEEP" "$KEEP_FULL" <<'PYCODE'
import sys
from pathlib import Path
keep, keep_full = int(sys.argv[2]), int(sys.argv[3])
if keep < 2 or keep_full < 1:
    raise SystemExit('KEEP must be at least 2 and KEEP_FULL at least 1')
copies = sorted(Path(sys.argv[1]).glob('trainer-*.tar.gz'), key=lambda p: p.stat().st_mtime, reverse=True)
full = [p for p in copies if p.name.startswith('trainer-full-')]
quick = [p for p in copies if not p.name.startswith('trainer-full-')]
for path in quick[keep:] + full[keep_full:]:
    path.unlink()
# Legacy DB-only snapshots are retained until the operator verifies a full restore.
PYCODE
