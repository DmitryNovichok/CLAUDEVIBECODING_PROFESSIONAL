#!/bin/sh
# Ставит сторожа (каждую минуту) и ежедневную копию базы вне сервера (если настроена). Запуск от root:
#   sh /opt/trainer/deploy/install-reliability.sh
set -eu
APP=${EGE_APP:-/opt/trainer}
mkdir -p /etc/egeshka /var/lib/egeshka
chmod 700 /etc/egeshka
[ -f /etc/egeshka/alert.conf ] || { printf '%s\n' '# Куда писать о проблемах сайта (заполните хотя бы одно):' 'TG_TOKEN=' 'TG_CHAT=' 'ALERT_EMAIL=' > /etc/egeshka/alert.conf; chmod 600 /etc/egeshka/alert.conf; }
chmod +x "$APP"/deploy/*.sh
{
    echo "* * * * * root sh $APP/deploy/watchdog.sh >>/var/log/egeshka-watchdog.log 2>&1"
    echo "20 10 * * * root [ -r /etc/egeshka/offsite.conf ] && sh $APP/deploy/offsite.sh >>/var/log/ege-backup.log 2>&1 || true"
} > /etc/cron.d/egeshka-reliability
chmod 644 /etc/cron.d/egeshka-reliability
echo "Сторож включён (проверка каждую минуту). Куда писать о сбоях: nano /etc/egeshka/alert.conf"
echo "Проверить уведомления: sh $APP/deploy/alert.sh 'проверка связи'"
