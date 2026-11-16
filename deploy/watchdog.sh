#!/bin/sh
# Сторож: запускается cron'ом каждую минуту (deploy/install-reliability.sh).
# - сайт не отвечает 3 минуты подряд → перезапускает службу и пишет вам; поднялся → пишет «снова работает»;
# - диска осталось меньше 10% → пишет (раз в сутки);
# - последней копии базы больше 26 часов → пишет (раз в сутки).
# Если упадёт весь сервер, сторож тоже молчит — для этого внешний мониторинг (см. deploy/RELIABILITY.md).
set -u
APP=${EGE_APP:-/opt/trainer}
PORT=${EGE_PORT:-8000}
SERVICE=${EGE_SERVICE:-ege-trainer}
BACKUPS=${EGE_BACKUPS:-/opt/trainer-backups}
STATE=${EGE_STATE:-/var/lib/egeshka}
mkdir -p "$STATE"
ALERT="sh $APP/deploy/alert.sh"
now=$(date +%s)

once_a_day() {          # $1 — ключ; 0, если сегодня по этому поводу ещё не писали
    f="$STATE/said-$1"
    [ -f "$f" ] && [ $((now - $(cat "$f"))) -lt 86400 ] && return 1
    echo "$now" > "$f"
    return 0
}

if curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    if [ -f "$STATE/down" ]; then
        rm -f "$STATE/down" "$STATE/fails"
        $ALERT "сайт снова работает"
    fi
    rm -f "$STATE/fails"
else
    fails=$(( $(cat "$STATE/fails" 2>/dev/null || echo 0) + 1 ))
    echo $fails > "$STATE/fails"
    if [ $fails -eq 3 ]; then
        systemctl restart "$SERVICE"
        touch "$STATE/down"
        $ALERT "сайт не отвечал 3 минуты — служба перезапущена. Журнал: journalctl -u $SERVICE -n 80"
    elif [ $fails -eq 15 ]; then
        $ALERT "сайт не отвечает уже 15 минут, перезапуск не помог — нужен ваш взгляд"
    fi
fi

free=$(df -P "$APP" | awk 'NR==2 {print 100 - $5}' | tr -d '%')
if [ "${free:-100}" -lt 10 ] && once_a_day disk; then
    $ALERT "на диске свободно меньше 10% ($free%) — база может перестать сохраняться"
fi

last=$(ls -t "$BACKUPS"/trainer-*.tar.gz 2>/dev/null | head -1)
if [ -n "$last" ]; then
    age=$(( (now - $(stat -c %Y "$last")) / 3600 ))
    if [ $age -ge 26 ] && once_a_day backup; then
        $ALERT "последней копии базы уже $age ч — проверьте /var/log/ege-backup.log"
    fi
elif once_a_day backup; then
    $ALERT "копий базы нет в $BACKUPS — запустите sh $APP/deploy/install-backup.sh"
fi
