#!/bin/sh
# Обновление сайта одной командой — с копией базы, проверкой и откатом:
#   sh /opt/trainer/deploy/update.sh <SHA коммита>
# 1) копия базы; 2) скачивает версию с GitHub во временную папку и проверяет её (Python компилируется, банк на месте);
# 3) запоминает текущий код в /opt/trainer-prev; 4) ставит новый код и перезапускает службу;
# 5) ждёт, пока /api/health ответит «ok». Не ответил за 90 секунд — возвращает прежний код и перезапускает снова.
# Данные (server_data) и картинки (media) не трогает. Пока служба перезапускается, Caddy держит запросы учеников
# (lb_try_duration в Caddyfile) — они видят короткую паузу, а не ошибку.
set -eu
SHA=${1:?Укажите SHA коммита: sh update.sh <sha>}
REPO=${EGE_REPO:-DmitryNovichok/CLAUDEVIBECODING_PROFESSIONAL}
APP=${EGE_APP:-/opt/trainer}
PREV=${EGE_PREV:-/opt/trainer-prev}
PORT=${EGE_PORT:-8000}
SERVICE=${EGE_SERVICE:-ege-trainer}
OWNER=${EGE_OWNER:-trainer:trainer}
case "$SHA" in *[!0-9a-f]*|"") echo "SHA — только 0-9 и a-f" >&2; exit 2;; esac

health() {
    python3 - "$PORT" <<'PY'
import json, sys, urllib.error, urllib.request
base = f"http://127.0.0.1:{sys.argv[1]}"
try:
    try:
        with urllib.request.urlopen(base + "/api/health", timeout=5) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        with urllib.request.urlopen(base + "/api/ping", timeout=5) as r:     # версия до 2.35.1 — проверки нет
            d = dict(json.load(r), version="старая")
    print(d.get("version", "?")) if d.get("ok") else sys.exit(1)
except Exception:
    sys.exit(1)
PY
}
wait_health() {
    i=0
    while [ $i -lt 45 ]; do
        if V=$(health); then echo "$V"; return 0; fi
        sleep 2; i=$((i + 1))
    done
    return 1
}

echo "1/5 Копия базы…"
sh "$APP/deploy/backup.sh" "$APP/server_data/trainer.db" "${EGE_BACKUPS:-/opt/trainer-backups}"

echo "2/5 Скачиваю $SHA…"
NEW=$(mktemp -d /tmp/egeshka-new.XXXXXX)
trap 'rm -rf "$NEW"' EXIT HUP INT TERM
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar xz --strip-components=1 -C "$NEW"
[ -s "$NEW/data/bank.js" ] || { echo "В архиве нет data/bank.js — обновление отменено" >&2; exit 1; }
python3 -m py_compile "$NEW/server.py" "$NEW/together.py" || { echo "Новый server.py не компилируется — обновление отменено" >&2; exit 1; }
find "$NEW" -name '__pycache__' -type d -prune -exec rm -rf {} +

echo "3/5 Запоминаю текущую версию в $PREV…"
mkdir -p "$PREV"
rsync -a --delete --exclude=server_data/ --exclude=media/ --exclude=.git/ "$APP/" "$PREV/"

echo "4/5 Ставлю новую версию…"
rsync -a --exclude=server_data/ --exclude=.git/ "$NEW/" "$APP/"
chown -R "$OWNER" "$APP"
systemctl restart "$SERVICE"

echo "5/5 Проверяю, что сайт работает…"
if V=$(wait_health); then
    echo "Готово: работает версия $V"
    exit 0
fi
echo "! Сайт не ответил после обновления — возвращаю прежнюю версию" >&2
rsync -a --exclude=server_data/ --exclude=media/ --exclude=.git/ "$PREV/" "$APP/"
chown -R "$OWNER" "$APP"
systemctl restart "$SERVICE"
if V=$(wait_health); then
    echo "Откат выполнен, работает прежняя версия $V. Посмотрите журнал: journalctl -u $SERVICE -n 80" >&2
else
    echo "!! И прежняя версия не поднялась. Журнал: journalctl -u $SERVICE -n 80" >&2
fi
exit 1
