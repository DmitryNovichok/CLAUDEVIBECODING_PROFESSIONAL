"""HTTP smoke checks without requiring an installed Arduino compiler."""
import importlib.util
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('microlab_server', 'local/server.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.ROOT = Path('dist').resolve()
m.find_arduino_cli = lambda: None
server, port = m.make_server(0)
threading.Thread(target=server.serve_forever, daemon=True).start()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
base = f'http://127.0.0.1:{port}'
try:
    for path, mime in [('/', 'text/html'), ('/app.js', 'text/javascript'), ('/classroom.css', 'text/css'), ('/fonts/ibm-plex-sans-cyrillic-400-normal.woff2', 'font/woff2')]:
        with opener.open(base + path) as r:
            assert r.status == 200 and mime in r.headers['Content-Type'], path
            assert len(r.read()) > 0
    with opener.open(base + '/api/status') as r:
        assert json.load(r)['compiler'] is False
    for board, origin, expected in [('wokwi-esp32-devkit-v1', base, 400), ('wokwi-arduino-uno', 'https://example.com', 403), ('wokwi-arduino-uno', base, 503)]:
        req = urllib.request.Request(base + '/api/compile', data=json.dumps({'board': board, 'code': 'void setup(){} void loop(){}'}).encode(), headers={'Content-Type': 'application/json', 'Origin': origin})
        try:
            opener.open(req)
            raise AssertionError('Expected an HTTP error')
        except urllib.error.HTTPError as e:
            assert e.code == expected, (e.code, expected)
            assert json.load(e)['error']
    print('PASS: local server on an allocated port, static assets and fonts, invalid board, cross-origin and missing-compiler handling.')
finally:
    server.shutdown()
    server.server_close()
