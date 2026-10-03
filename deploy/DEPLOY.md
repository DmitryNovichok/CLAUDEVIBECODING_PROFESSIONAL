# Как выложить тренажёр на сервер с доменом

Итог: ученики открывают `https://ваш-домен/`, вводят код приглашения и ФИО, а вы смотрите журнал на `https://ваш-домен/admin`. Компьютер при этом можно выключать.

## Что понадобится

- **VPS с Ubuntu 22.04 или 24.04.** Хватит 1–2 ГБ памяти. Диска нужно столько, сколько весит папка `trainer` после шага 1 (картинки и файлы к заданиям) плюс запас. Подойдёт любой хостинг с VPS.
- **Домен или поддомен**, например `ege.ваш-сайт.ru`. У регистратора добавьте A-запись: домен → IP-адрес VPS.
- **Для загрузки файлов с Windows** удобнее всего WinSCP, для команд — PuTTY или встроенный `ssh` в PowerShell.

## 1. Подготовить папку на своём компьютере

```
cd Biblio\trainer
python build.py --standalone
```

Картинки и файлы к заданиям скопируются в `trainer\media`, и папка `trainer` станет самодостаточной: банки рядом ей больше не нужны.

Если сервер уже работал у вас на компьютере и ученики занимались, возьмите с собой `trainer\server_data\trainer.db`: там ученики и журнал. Если начинаете с нуля, удалите папку `server_data`.

## 2. Загрузить на сервер

Скопируйте папку `trainer` целиком в `/opt/trainer` на сервере (в WinSCP — перетащить папку).

Из PowerShell:

```
scp -r trainer root@IP_СЕРВЕРА:/opt/
```

## 3. Настроить сервер

Подключитесь по ssh (`ssh root@IP_СЕРВЕРА`) и выполните по очереди:

```
# Python и отдельный пользователь для тренажёра
apt update && apt install -y python3
useradd -r -s /usr/sbin/nologin trainer
chown -R trainer:trainer /opt/trainer

# пароль учителя и код приглашения
sudo -u trainer python3 /opt/trainer/server.py --password ВАШ_ПАРОЛЬ
sudo -u trainer python3 /opt/trainer/server.py --invite 16082001

# запуск тренажёра как службы (сам поднимется после перезагрузки)
cp /opt/trainer/deploy/ege-trainer.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ege-trainer
systemctl status ege-trainer --no-pager
```

## 4. HTTPS и домен (Caddy)

Caddy принимает запросы на домен, сам получает сертификат Let's Encrypt и передаёт запросы тренажёру. Установка (официальные команды с caddyserver.com):

```
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Настройка:

```
cp /opt/trainer/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # замените trainer.example.ru на свой домен, сохраните: Ctrl+O, Enter, Ctrl+X
systemctl reload caddy
```

Если на сервере включён брандмауэр, откройте порты 80 и 443: `ufw allow 80,443/tcp`. Порт 8000 открывать не нужно, тренажёр слушает только внутри сервера.

Через минуту откройте `https://ваш-домен/`, должно появиться окно входа. Панель учителя: `https://ваш-домен/admin`.

## Обновление

- **Задания.** На своём компьютере `python openfipi_parser.py` (по желанию), затем `python build.py --standalone`. Загрузите на сервер `trainer/data/bank.js` и новые файлы из `trainer/media` (в WinSCP удобна «Синхронизация»). Перезапуск не нужен, сервер подхватит новый банк сам.
- **Сайт** (`app.js`, `style.css`, `index.html`, `admin.*`): загрузить и обновить страницу.
- **`server.py`:** загрузить и выполнить `systemctl restart ege-trainer`.

После загрузки выполните `chown -R trainer:trainer /opt/trainer`.

## Резервная копия и логи

- Все ученики и журнал лежат в одном файле: `/opt/trainer/server_data/trainer.db`. Скачивайте его время от времени через WinSCP.
- Можно настроить ежедневную копию: `crontab -e` → строка `0 3 * * * cp /opt/trainer/server_data/trainer.db /root/trainer-$(date +\%u).db`. Так на сервере хранятся копии за последние 7 дней.
- Что делает сервер: `journalctl -u ege-trainer -f` (выход: Ctrl+C).

## Безопасность

- **Ответы.** Ответы проверяет сервер, в странице их нет.
- **Вход.** Без кода приглашения задания не отдаются.
- **Перебор.** После 10 неверных паролей учителя или 30 неверных кодов приглашения с одного адреса за 15 минут сервер отвечает «Подождите» до конца этих 15 минут. За Caddy адрес ученика берётся из заголовка `X-Forwarded-For`, поэтому блокируется только тот, кто ошибается.
- **Cookie.** За HTTPS (Caddy передаёт `X-Forwarded-Proto: https`) cookie входа помечаются как `Secure`.
- **Файлы.** Сервер отдаёт только файлы сайта, `vendor/`, `media/` и картинки/файлы заданий из банков. Пути с `..` отклоняются, база `server_data/` и `data/bank.js` с ответами наружу не отдаются.
- **Смена пароля** в панели завершает все остальные сессии учителя.
- **Пароль учителя.** Пароль учителя не должен совпадать с кодом приглашения. Код можно менять в панели, когда он «ушёл» за пределы класса.
