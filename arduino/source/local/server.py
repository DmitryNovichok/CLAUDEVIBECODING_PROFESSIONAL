#!/usr/bin/env python3
"""MicroLab local server.

Serves the web app from ./web and offers optional Arduino C++ compilation
through Arduino CLI. Standard library only. Listens on 127.0.0.1 only.

Usage: python3 server.py [--port 8765] [--no-browser]
"""
import argparse
import json
import mimetypes
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = pathlib.Path(__file__).resolve().parent / 'web'
BOARDS = {'wokwi-arduino-uno': 'arduino:avr:uno', 'wokwi-arduino-nano': 'arduino:avr:nano:cpu=atmega328'}
DEFAULT_PORT = 8765
compile_lock = threading.Lock()

# Windows registries sometimes map .js to text/plain, which breaks ES modules. Be explicit.
TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8', '.hex': 'text/plain; charset=utf-8', '.uf2': 'application/octet-stream',
    '.png': 'image/png', '.ico': 'image/x-icon', '.zip': 'application/zip', '.gz': 'application/gzip',
}
for ext, mime in TYPES.items():
    mimetypes.add_type(mime.split(';')[0], ext)


def find_arduino_cli():
    """arduino-cli from PATH, or the copy bundled with Arduino IDE 2."""
    found = shutil.which('arduino-cli')
    if found:
        return found
    candidates = []
    system = platform.system()
    if system == 'Windows':
        for base in filter(None, [os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA') and os.path.join(os.environ['LOCALAPPDATA'], 'Programs')]):
            candidates.append(os.path.join(base, 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'))
    elif system == 'Darwin':
        candidates.append('/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli')
    else:
        candidates += [os.path.expanduser('~/bin/arduino-cli'), '/usr/local/bin/arduino-cli', '/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli']
    return next((c for c in candidates if os.path.isfile(c)), None)


class Handler(SimpleHTTPRequestHandler):
    port = DEFAULT_PORT
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed_hosts(self):
        return {f'127.0.0.1:{self.port}', f'localhost:{self.port}'}

    def valid_host(self):
        return self.headers.get('Host') in self.allowed_hosts()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable: only report errors.
        if len(args) > 1 and str(args[1])[:1] in '45':
            sys.stderr.write('  %s\n' % (fmt % args))

    def reply(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.valid_host():
            return self.send_error(403)
        if self.path.split('?')[0] == '/api/status':
            cli = find_arduino_cli()
            return self.reply(200, {'compiler': bool(cli), 'boards': list(BOARDS)})
        super().do_GET()

    def do_POST(self):
        origin = self.headers.get('Origin')
        if not self.valid_host() or (origin and origin not in {'http://' + h for h in self.allowed_hosts()}):
            return self.reply(403, {'error': 'Разрешены только локальные запросы с этой же страницы'})
        if self.path != '/api/compile':
            return self.reply(404, {'error': 'Not found'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'Нужен JSON'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size < 500000:
                return self.reply(413, {'error': 'Размер запроса превышен'})
            data = json.loads(self.rfile.read(size))
            code, board = data.get('code'), BOARDS.get(data.get('board'))
            if not isinstance(code, str) or not board:
                return self.reply(400, {'error': 'Нужен код и плата Arduino Uno / Nano'})
            cli = find_arduino_cli()
            if not cli:
                return self.reply(503, {'error': 'Arduino CLI не найден. Установите Arduino IDE 2 или Arduino CLI (см. README.txt) и перезапустите MicroLab.'})
            if not compile_lock.acquire(blocking=False):
                return self.reply(429, {'error': 'Компиляция уже выполняется'})
            try:
                with tempfile.TemporaryDirectory(prefix='microlab-') as tmp:
                    sketch = pathlib.Path(tmp) / 'sketch'
                    sketch.mkdir()
                    (sketch / 'sketch.ino').write_text(code, encoding='utf-8')
                    output = pathlib.Path(tmp) / 'build'
                    result = subprocess.run([cli, 'compile', '--fqbn', board, '--output-dir', str(output), str(sketch)],
                                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180, shell=False)
                    logs = (result.stdout + '\n' + result.stderr).strip()[-24000:]
                    if result.returncode:
                        if 'platform not installed' in logs.lower() or 'not found' in logs.lower() and 'arduino:avr' in logs:
                            logs += '\n\nПодсказка: выполните  arduino-cli core install arduino:avr'
                        return self.reply(400, {'error': logs})
                    firmware = output / 'sketch.ino.hex'
                    if not firmware.exists():
                        return self.reply(500, {'error': 'HEX не найден после сборки. ' + logs})
                    self.reply(200, {'hex': firmware.read_text(), 'log': logs})
            finally:
                compile_lock.release()
        except subprocess.TimeoutExpired:
            self.reply(408, {'error': 'Компиляция заняла больше 180 секунд'})
        except Exception as e:  # noqa: BLE001 — report any failure to the page
            self.reply(400, {'error': str(e)})


def make_server(port):
    """Bind to the first free port starting at `port`."""
    for candidate in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', candidate), Handler)
            Handler.port = server.server_address[1]
            return server, Handler.port
        except OSError:
            continue
    raise SystemExit(f'Не удалось найти свободный порт в диапазоне {port}–{port + 19}.')


def main():
    parser = argparse.ArgumentParser(description='MicroLab local server')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not (ROOT / 'index.html').exists():
        raise SystemExit(f'Не найдена папка web рядом с server.py ({ROOT}). Распакуйте архив полностью.')
    server, port = make_server(args.port)
    url = f'http://127.0.0.1:{port}'
    cli = find_arduino_cli()
    print(f'MicroLab запущен: {url}')
    print('Arduino CLI: ' + (cli if cli else 'не найден — работает учебный режим и загрузка HEX'))
    print('Остановить: Ctrl+C (или закройте это окно)', flush=True)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nMicroLab остановлен.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
