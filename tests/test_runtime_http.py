"""Real socket regression for bounded requests and a separate long-lived pool."""
import concurrent.futures
import http.client
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler

from runtime_http import BoundedHTTPServer


class RuntimeHTTPTest(unittest.TestCase):
    def setUp(self):
        self.release = threading.Event()
        self.started = threading.Event()
        release, started = self.release, self.started

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/stream':
                    if not self.server.reserve_stream(self.connection):
                        self.send_response(503)
                        self.end_headers()
                        return
                    started.set()
                    release.wait(5)
                elif self.path == '/slow':
                    started.set()
                    release.wait(5)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ok')

        self.server = BoundedHTTPServer(('127.0.0.1', 0), Handler, workers=1, streams=1)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=64)

    def tearDown(self):
        self.release.set()
        self.pool.shutdown(wait=True)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path='/'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request('GET', path)
            response = conn.getresponse()
            response.read()
            return response.status
        finally:
            conn.close()

    def test_overload_fails_fast_and_capacity_recovers(self):
        first = self.pool.submit(self.request, '/slow')
        self.assertTrue(self.started.wait(2))
        self.assertEqual(self.request(), 503)
        self.release.set()
        self.assertEqual(first.result(timeout=3), 200)
        limit = time.monotonic() + 2
        while self.server._buckets and time.monotonic() < limit:
            time.sleep(0.01)
        self.assertEqual(self.request(), 200)

    def test_stream_cannot_starve_http_and_stream_cap_is_enforced(self):
        stream = self.pool.submit(self.request, '/stream')
        self.assertTrue(self.started.wait(2))
        self.assertEqual(self.request(), 200)
        # Normal handler completion releases its slot before the next admission.
        deadline = time.monotonic() + 2
        while len(self.server._buckets) > 1 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.request('/stream'), 503)
        self.release.set()
        self.assertEqual(stream.result(timeout=3), 200)

    def test_sixty_simultaneous_students_complete_with_classroom_capacity(self):
        self.server._normal = threading.BoundedSemaphore(128)
        barrier = threading.Barrier(60)

        def student():
            barrier.wait(5)
            return self.request()

        futures = [self.pool.submit(student) for _ in range(60)]
        self.assertEqual([f.result(timeout=10) for f in futures], [200] * 60)
