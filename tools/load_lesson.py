#!/usr/bin/env python3
"""Local classroom workload against real handlers and a disposable SQLite DB.

Never accepts a URL or production database. Creates synthetic logged-in students
and bank entries, synchronises their first lesson requests, checks durable results.
This is a reproducible local measurement, not a production capacity guarantee.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import contextlib
import http.client
import io
import json
import math
from pathlib import Path
import secrets
import resource
import sys
import threading
import time
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
import server
import test_server as fixtures
from runtime_http import BoundedHTTPServer


def percentile(values, ratio):
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * ratio) - 1)] * 1000, 2) if ordered else 0


class MeasuredLock:
    def __init__(self, lock):
        self.lock = lock
        self.local = threading.local()
        self.waits = []

    def acquire(self, *args, **kwargs):
        start = time.perf_counter()
        result = self.lock.acquire(*args, **kwargs)
        if result:
            depth = getattr(self.local, 'depth', 0)
            if not depth:
                self.waits.append(time.perf_counter() - start)
            self.local.depth = depth + 1
        return result

    def release(self):
        self.local.depth -= 1
        self.lock.release()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *args):
        self.release()


def run(students=60, tasks=15000, seconds=0, interval=10):
    bank = json.loads(json.dumps(fixtures.BANK))
    for i in range(max(0, tasks - len(bank['tasks']))):
        bank['tasks'].append({'id': 'load:' + str(i), 'n': i % 27 + 1, 'bank': 'synthetic',
                              'html': '<p>Синтетическое условие для локальной нагрузки.</p>', 'ans': '1'})
    with mock.patch.object(fixtures, 'BANK', bank), mock.patch.object(fixtures, 'ThreadingHTTPServer', BoundedHTTPServer):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
    client = fixtures.ServerTest()
    client.setUp()
    db = server.APP.db
    measured = MeasuredLock(db.lock)
    tokens = []
    for i in range(students):
        token = secrets.token_urlsafe(24)
        sid = db.x('INSERT INTO students(name,name_key,token,created,last_seen,teacher_id) VALUES(?,?,?,?,?,1)',
                   ('Нагрузка Ученик ' + str(i), 'load-' + str(i), token, time.time(), time.time()))
        tokens.append((sid, token))
    task = server.APP.bank.pid('b:5')
    db.lock = measured
    metrics, failures = defaultdict(list), []
    status_counts = Counter()
    barrier = threading.Barrier(students)

    def request(token, method, path, body=None, connection=None):
        start = time.perf_counter()
        conn = connection or http.client.HTTPConnection('127.0.0.1', client.port, timeout=30)
        status = 0
        try:
            conn.request(method, path, json.dumps(body) if body is not None else None,
                         {'Content-Type': 'application/json', 'X-Token': token, 'Cookie': 'egest=' + token})
            result = conn.getresponse()
            data = result.read()
            status = result.status
            if status != 200:
                failures.append({'route': path.split('?')[0], 'status': status, 'body': data[:160].decode(errors='replace')})
            return status
        except Exception as exc:
            failures.append({'route': path.split('?')[0], 'status': 0, 'error': type(exc).__name__})
            return 0
        finally:
            metrics[method + ' ' + path.split('?')[0]].append(time.perf_counter() - start)
            status_counts[status] += 1
            if connection is None:
                conn.close()

    def pupil(item):
        sid, token = item
        barrier.wait(10)
        request(token, 'GET', '/api/me')
        request(token, 'GET', '/data/bank.js')
        request(token, 'GET', '/api/html?ids=' + task)
        request(token, 'POST', '/api/open', {'task': task})
        opened = server.OPENED.get(sid, 'b:5')
        if opened:
            opened['ts'] -= 120  # skip artificial reading delay, not server answer validation
        request(token, 'POST', '/api/solution', {'task': task, 'code': 'print(12)'})
        request(token, 'POST', '/api/check', {'task': task, 'answer': '12'})
        request(token, 'GET', '/api/history')
        request(token, 'GET', '/api/me')
        # Sustained small, realistic read/autosave workload, one keep-alive socket
        # per pupil. No repeated grading, no artificial removal of account quotas.
        conn = http.client.HTTPConnection('127.0.0.1', client.port, timeout=30)
        try:
            revision = 0
            while seconds and time.perf_counter() + interval < started + seconds:
                time.sleep(interval)
                revision += 1
                request(token, 'GET', '/api/me', connection=conn)
                request(token, 'GET', '/api/html?ids=' + task, connection=conn)
                request(token, 'POST', '/api/solution', {'task': task, 'code': f'print(12) # revision {revision}'}, connection=conn)
                request(token, 'GET', '/api/history', connection=conn)
        finally:
            conn.close()

    started = time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=students) as pool:
            list(pool.map(pupil, tokens))
        elapsed = time.perf_counter() - started
        attempts = db.q('SELECT count(*) AS n FROM attempts', one=True)['n']
        solutions = db.q('SELECT count(*) AS n FROM solutions', one=True)['n']
        latencies = [t for times in metrics.values() for t in times]
        return {'scope': 'temporary SQLite, synthetic accounts, real HTTP handlers, local loopback',
                'students': students, 'bank_tasks': len(server.APP.bank.tasks),
                'soak_target_seconds': seconds, 'poll_interval_seconds': interval,
                'peak_rss_mib': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
                'requests': sum(status_counts.values()), 'seconds': round(elapsed, 3),
                'requests_per_second': round(sum(status_counts.values()) / elapsed, 2),
                'status': dict(status_counts), 'p50_ms': percentile(latencies, 0.5),
                'p95_ms': percentile(latencies, 0.95), 'max_ms': percentile(latencies, 1),
                'db_lock': {'acquisitions': len(measured.waits), 'p95_wait_ms': percentile(measured.waits, 0.95),
                            'max_wait_ms': percentile(measured.waits, 1)},
                'durable_attempts': attempts, 'durable_solutions': solutions,
                'ok': not failures and attempts == students and solutions == students,
                'routes': {route: {'count': len(times), 'p95_ms': percentile(times, 0.95)} for route, times in metrics.items()},
                'failures': failures[:10]}
    finally:
        db.lock = measured.lock
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()
        db.conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--students', type=int, choices=(30, 60), default=60)
    parser.add_argument('--tasks', type=int, default=15000)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--seconds', type=int, default=0, help='bounded soak duration; 0 runs one startup burst')
    parser.add_argument('--interval', type=int, default=10, help='pause between pupil read/autosave rounds')
    args = parser.parse_args()
    if not 5 <= args.tasks <= 20000:
        parser.error('--tasks must be between 5 and 20000')
    if not 0 <= args.seconds <= 1800 or not 5 <= args.interval <= 60:
        parser.error('--seconds must be 0..1800, --interval 5..60')
    result = run(args.students, args.tasks, args.seconds, args.interval)
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    print(text, end='')
    sys.exit(0 if result['ok'] else 1)
