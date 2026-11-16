#!/bin/sh
# Копия базы ВНЕ сервера: берёт свежую копию из /opt/trainer-backups, шифрует её паролем и отправляет в облако
# через rclone (Яндекс Диск, Яндекс Object Storage, Google Drive…). Без пароля копию не открыть даже владельцу облака.
# Настройка — в deploy/RELIABILITY.md. Файл /etc/egeshka/offsite.conf:
#   REMOTE=yadisk:egeshka-backups     — имя удалённой папки rclone
#   KEEP_DAYS=30                      — сколько дней хранить копии в облаке
# Пароль шифрования — в /etc/egeshka/backup.pass (одна строка). Сохраните его ещё и у себя: без него копии бесполезны.
set -eu
umask 077
CONF=${EGE_OFFSITE_CONF:-/etc/egeshka/offsite.conf}
PASS=${EGE_BACKUP_PASS:-/etc/egeshka/backup.pass}
BACKUPS=${EGE_BACKUPS:-/opt/trainer-backups}
APP=${EGE_APP:-/opt/trainer}
REMOTE= KEEP_DAYS=30
[ -r "$CONF" ] || { echo "Нет $CONF — копии вне сервера не настроены" >&2; exit 1; }
. "$CONF"
[ -n "$REMOTE" ] || { echo "В $CONF не указан REMOTE" >&2; exit 1; }
[ -s "$PASS" ] || { echo "Нет пароля шифрования $PASS" >&2; exit 1; }
command -v rclone >/dev/null || { echo "rclone не установлен: apt install -y rclone" >&2; exit 1; }
last=$(ls -t "$BACKUPS"/trainer-*.tar.gz 2>/dev/null | head -1)
[ -n "$last" ] || { echo "Нет локальных копий в $BACKUPS" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
name=$(basename "$last")
python3 "$APP/deploy/snapshot.py" verify "$last"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$last" -out "$TMP/$name.enc" -pass "file:$PASS"
rclone copyto "$TMP/$name.enc" "$REMOTE/$name.enc"
rclone delete --include 'trainer-*.tar.gz.enc' --min-age "${KEEP_DAYS}d" "$REMOTE" 2>/dev/null || true
echo "Полная копия вне сервера: $REMOTE/$name.enc"
# Decrypt to snapshot.tar.gz, then use snapshot.py restore into a NEW empty directory.
