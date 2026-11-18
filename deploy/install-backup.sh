#!/bin/sh
# Расписание копий: каждый день быстрая (база и файлы учеников), по воскресеньям ночью — полная (ещё банки и материалы).
set -eu
chmod +x /opt/trainer/deploy/backup.sh
printf '%s\n' \
  '50 9 * * * root /opt/trainer/deploy/backup.sh >>/var/log/ege-backup.log 2>&1' \
  '30 3 * * 0 root /opt/trainer/deploy/backup.sh --full >>/var/log/ege-backup.log 2>&1' > /etc/cron.d/egeshka-backup
chmod 644 /etc/cron.d/egeshka-backup
/opt/trainer/deploy/backup.sh
