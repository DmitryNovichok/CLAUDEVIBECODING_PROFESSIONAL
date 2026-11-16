"""Real Handler + SQLite + local Pyodide, with only disposable synthetic pupils."""
import contextlib
import io
import json
import shutil
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import test_server as fixtures

with contextlib.redirect_stdout(io.StringIO()):
    fixtures.ServerTest.setUpClass()
    fixtures.ServerTest.httpd.daemon_threads = True
    client=fixtures.ServerTest()
    client.setUp()
    tokens=[client.login('Диагностиков Первый'),client.login('Диагностиков Второй')]
try:
    root=fixtures.ServerTest.tmp
    for filename in ('lesson-readiness.js','lesson-readiness.css','python-sandbox.js','python-sandbox.html','py-worker.js'):
        shutil.copyfile(ROOT/filename,root/filename)
    (root/'min').mkdir()
    # Exercise the assets actually selected by production site_asset(), not just sources.
    for filename in ('lesson-readiness.js','lesson-readiness.css','python-sandbox.js'):
        shutil.copyfile(ROOT/'min'/filename,root/'min'/filename)
    shutil.copytree(Path(__file__).parent/'node_modules'/'pyodide',root/'vendor'/'pyodide')
    (root/'index.html').write_text('''<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <link rel="stylesheet" href="lesson-readiness.css"></head><body>
      <button data-lesson-readiness>Проверить перед уроком</button>
      <script src="python-sandbox.js"></script><script src="lesson-readiness.js"></script></body></html>''')
    print(json.dumps({'origin':f'http://127.0.0.1:{fixtures.ServerTest.port}','tokens':tokens}),flush=True)
    sys.stdin.readline()
finally:
    with contextlib.redirect_stdout(io.StringIO()): fixtures.ServerTest.tearDownClass()
    fixtures.ServerTest.httpd.server_close()
