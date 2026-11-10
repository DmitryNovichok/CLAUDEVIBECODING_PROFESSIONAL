#!/bin/sh
# Сообщение владельцу сайта: sh alert.sh "текст". Куда — в /etc/egeshka/alert.conf (только root может читать):
#   TG_TOKEN=123456:ABC…   TG_CHAT=123456789     — Telegram-бот (@BotFather) и ваш chat id
#   ALERT_EMAIL=you@example.ru                     — письмо через SMTP из private_config.json (тот же, что для отчётов)
# Можно и то и другое. В сообщениях нет личных данных учеников — только состояние сайта.
set -u
MSG=${1:?текст сообщения}
CONF=${EGE_ALERT_CONF:-/etc/egeshka/alert.conf}
APP=${EGE_APP:-/opt/trainer}
TG_TOKEN= TG_CHAT= ALERT_EMAIL=
[ -r "$CONF" ] && . "$CONF"
HOST=$(hostname)
TEXT="Egeshka ($HOST): $MSG"
sent=0
if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -fsS --max-time 15 "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
        --data-urlencode "chat_id=$TG_CHAT" --data-urlencode "text=$TEXT" >/dev/null && sent=1
fi
if [ -n "$ALERT_EMAIL" ]; then
    python3 - "$APP/server_data/private_config.json" "$ALERT_EMAIL" "$TEXT" <<'PY' && sent=1
import json, os, smtplib, ssl, sys
from email.message import EmailMessage
try:
    conf = json.load(open(sys.argv[1], encoding="utf-8"))
except OSError:
    conf = {}
get = lambda k: os.environ.get("EGE_" + k) or str(conf.get(k) or "")
host, sender = get("SMTP_HOST"), get("SMTP_FROM")
if not host or not sender:
    sys.exit(1)
m = EmailMessage()
m["Subject"], m["From"], m["To"] = sys.argv[3][:120], sender, sys.argv[2]
m.set_content(sys.argv[3])
port = int(get("SMTP_PORT") or 465)
srv = smtplib.SMTP_SSL(host, port, timeout=30, context=ssl.create_default_context()) if port == 465 else smtplib.SMTP(host, port, timeout=30)
if port != 465:
    srv.starttls(context=ssl.create_default_context())
if get("SMTP_USER"):
    srv.login(get("SMTP_USER"), get("SMTP_PASS"))
srv.send_message(m)
srv.quit()
PY
fi
logger -t egeshka-alert "$TEXT" 2>/dev/null || true
[ $sent = 1 ] || echo "Не отправлено (настройте $CONF): $TEXT" >&2
