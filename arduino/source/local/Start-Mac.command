#!/bin/bash
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  echo "Python 3 не найден. Установите его: https://www.python.org/downloads/"
fi
read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
