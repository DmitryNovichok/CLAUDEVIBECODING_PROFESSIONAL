#!/bin/sh
# Ежедневная копия базы тренажёра (ученики, журнал, учителя).
# Кладёт /opt/trainer-backups/trainer-ГГГГ-ММ-ДД.db.gz и хранит последние 14 копий.
# Копия снимается через sqlite3 backup — безопасно, даже когда сервер работает.
# Запуск по расписанию: /etc/cron.d/egeshka-backup (см. deploy/DEPLOY.md, раздел «Резервные копии»).
set -e
SRC=${1:-/opt/trainer/server_data/trainer.db}
DST=${2:-/opt/trainer-backups}
KEEP=14
mkdir -p "$DST"
chmod 700 "$DST"                     # в базе хэши паролей — только для root
F="$DST/trainer-$(date +%F).db"
python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$SRC" "$F"
gzip -f "$F"
ls -1t "$DST"/trainer-*.db.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "копия: $F.gz ($(ls "$DST"/trainer-*.db.gz | wc -l) шт.)"
