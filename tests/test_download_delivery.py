"""Protected files: durable quotas, real HTTP authorization and cache behavior."""
import concurrent.futures
import contextlib
import http.client
import io
import json
import secrets
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import download_delivery as delivery
import http_security
import server
from storage import Transactional
import test_server as fixtures


class DB(Transactional):
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self._tx_depth = 0


class DownloadQuotaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'quota.db')
        self.db = DB(self.path)
        self.addCleanup(self.db.conn.close)
        self.gate = delivery.DownloadDelivery(self.db)
        self.now = 1000000

    def check(self, file='a', size=10, **kwargs):
        return self.gate.check(('student', 1), file, size, now=kwargs.pop('now', self.now), **kwargs)

    def test_reopens_use_bytes_but_not_another_unique_file(self):
        with mock.patch.object(delivery, 'WINDOWS', ((3600, 1, 30),)):
            self.assertEqual(self.check().status, 200)
            self.assertEqual(self.check().status, 200)
            self.assertEqual(self.check('b').status, 429)
            self.assertEqual(self.check().status, 200)
            self.assertEqual(self.check().status, 429)
            self.assertEqual(self.check('b', now=self.now + 3661).status, 200)

    def test_restart_namespaces_and_head(self):
        with mock.patch.object(delivery, 'WINDOWS', ((86400, 1, 10),)):
            self.assertEqual(self.check('a', head=True).status, 200)
            self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM download_seen').fetchone()[0], 0)
            self.assertEqual(self.check().status, 200)
            other = DB(self.path)
            self.addCleanup(other.conn.close)
            gate = delivery.DownloadDelivery(other)
            self.assertEqual(gate.check(('student', 1), 'b', 1, now=self.now).status, 429)
            self.assertEqual(gate.check(('student', 2), 'b', 10, now=self.now).status, 200)
            self.assertEqual(gate.check(('teacher', 1), 'b', 10, now=self.now).status, 200)

    def test_parallel_reservations_cannot_overspend_byte_budget(self):
        other = DB(self.path)
        self.addCleanup(other.conn.close)
        gate = delivery.DownloadDelivery(other)
        with mock.patch.object(delivery, 'WINDOWS', ((3600, 30, 100),)):
            def hit(i):
                return (gate if i % 2 else self.gate).check(('student', 1), str(i), 10, now=self.now).status
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                results = list(pool.map(hit, range(25)))
        self.assertEqual(results.count(200), 10)
        self.assertEqual(results.count(429), 15)
        self.assertEqual(self.db.conn.execute('SELECT SUM(bytes) FROM download_usage').fetchone()[0], 100)

    def test_denied_requests_are_counted_and_pruned(self):
        with mock.patch.object(delivery, 'REQUESTS_PER_MINUTE', 2):
            self.assertEqual(self.check(head=True).status, 200)
            self.assertEqual(self.check(head=True).status, 200)
            self.assertEqual(self.check(head=True).status, 429)
        self.assertEqual(self.db.conn.execute('SELECT reason FROM download_events').fetchone()[0], 'file_request_rate')
        self.check(now=self.now + 31 * 86400)
        self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM download_events').fetchone()[0], 0)


class OriginTest(unittest.TestCase):
    def test_exact_origins_ports_and_opaque_frames(self):
        for origin, allowed in [('https://school.test', True), ('https://school.test:443', True),
                                ('http://school.test', False), ('https://school.test:444', False),
                                ('https://evil.school.test', False), ('null', False), ('', False),
                                ('https://school.test@evil.test', False), ('https://school.test/path', False)]:
            headers = {'Host': '127.0.0.1:8000', 'X-Forwarded-Host': 'school.test',
                       'X-Forwarded-Proto': 'https', 'Origin': origin}
            self.assertEqual(http_security.allows_mutation(headers, '127.0.0.1'), allowed, origin)

    def test_untrusted_forwarded_headers_and_fetch_metadata(self):
        headers = {'Host': 'school.test', 'X-Forwarded-Host': 'evil.test', 'X-Forwarded-Proto': 'https',
                   'Origin': 'https://evil.test'}
        self.assertFalse(http_security.allows_mutation(headers, '192.0.2.1'))
        self.assertFalse(http_security.allows_mutation({'Sec-Fetch-Site': 'cross-site'}, '127.0.0.1'))
        self.assertFalse(http_security.allows_mutation({'Sec-Fetch-Site': 'same-site'}, '127.0.0.1'))
        self.assertTrue(http_security.allows_mutation({'Host': 'localhost'}, '127.0.0.1'))


class DownloadHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        name = 'Загрузкин ' + secrets.token_hex(8).translate(str.maketrans('0123456789', 'abcdefghij'))
        self.token = self.c.login(name)
        self.sid = self.c.req('GET', '/api/me', token=self.token)[1]['sid']
        self.write('media/b/assets/x.xlsx', b'1234567890')
        self.write('course/data/24/a.txt', b'lesson')
        self.write('vendor/pyodide/runtime.js', b'/* runtime */')
        self.write('vendor/ordinary.js', b'/* public */')
        self.write('python-sandbox.html', b'<!doctype html>')
        self.write('pycourse/data/m90/a.txt', b'one')
        self.write('pycourse/data/m90/b.txt', b'two')
        module = {'levels': [
            {'need': 1, 'tasks': [{'id': 'm90.t1', 'files': [{'url': 'pyc-data/m90/a.txt?v=1'}]}]},
            {'need': 1, 'tasks': [{'id': 'm90.t2', 'files': [{'url': 'pyc-data/m90/b.txt'}]}]},
        ]}
        self.write('pycourse/m90.json', json.dumps(module).encode())
        server._PYC.clear()

    def write(self, rel, body):
        p = server.HERE / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)

    def request(self, path, *, token=None, headers=None, method='GET', body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.c.port, timeout=10)
        h = {'Content-Type': 'application/json', **(headers or {})}
        if token:
            h['X-Token'] = token
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        r = conn.getresponse()
        out = r.status, dict(r.getheaders()), r.read()
        conn.close()
        return out

    def test_opaque_raw_and_media_routes_require_live_session(self):
        target = next((key for key, value in server.APP.bank.files.items() if value[0] == 'media/b/assets/x.xlsx'))
        for path in ('/files/' + target + '/5.xlsx', '/media/b/assets/x.xlsx?v=1',
                     '/fip_bank/assets/0079D4-08bc5d/a.gif', '/Documents/Biblio/fip_bank/assets/0079D4-08bc5d/a.gif'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 401)
                status, headers, body = self.request(path, token=self.token)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Cache-Control'], 'private, no-store')
                self.assertIn('X-Token', headers['Vary'])
                self.assertTrue(body)
                self.assertEqual(self.request(path, headers={'If-None-Match': headers.get('ETag', '*')}, method='HEAD')[0], 401)
        self.db.x('UPDATE student_sessions SET ended=1 WHERE token=?', (self.token,))
        self.assertEqual(self.request('/media/b/assets/x.xlsx', token=self.token)[0], 401)

    def test_aliases_and_sessions_share_budget(self):
        target = next((key for key, value in server.APP.bank.files.items() if value[0] == 'media/b/assets/x.xlsx'))
        with mock.patch.object(delivery, 'WINDOWS', ((86400, 1, 20),)):
            self.assertEqual(self.request('/files/' + target + '/5.xlsx', token=self.token)[0], 200)
            self.assertEqual(self.request('/media/b/assets/x.xlsx', headers={'Cookie': 'egest=' + self.token})[0], 200)
            status, headers, body = self.request('/media/b/assets/x.xlsx', token=self.token)
            self.assertEqual(status, 429)
            self.assertGreater(int(headers['Retry-After']), 0)
            self.assertNotIn(b'1234567890', body)

    def test_course_and_programming_permissions_are_rechecked(self):
        self.assertEqual(self.request('/course-data/24/a.txt')[0], 401)
        self.assertEqual(self.request('/course-data/24/a.txt', token=self.token)[0], 403)
        self.db.setting('course_pw', 'synthetic')
        self.db.setting('pyc_pw', 'synthetic')
        self.db.x('UPDATE students SET course=1,pyc=1 WHERE id=?', (self.sid,))
        self.assertEqual(self.request('/course-data/24/a.txt', token=self.token)[0], 200)
        self.assertEqual(self.request('/pyc-data/m90/a.txt', token=self.token)[0], 200)
        self.assertEqual(self.request('/pyc-data/m90/b.txt', token=self.token)[0], 403)
        self.db.x('UPDATE students SET pyc_free=1 WHERE id=?', (self.sid,))
        self.assertEqual(self.request('/pyc-data/m90/b.txt', token=self.token)[0], 200)
        self.db.setting('course_pw', '')
        self.db.setting('pyc_pw', '')
        self.assertEqual(self.request('/course-data/24/a.txt', token=self.token)[0], 403)
        self.assertEqual(self.request('/pyc-data/m90/b.txt', token=self.token)[0], 403)

    def test_teacher_moderation_and_quota_audit_access(self):
        self.c.admin('GET', '/api/admin/students')
        self.assertEqual(self.request('/media/b/assets/x.xlsx', headers={'Cookie': 'egeadm=admtest'})[0], 200)
        status, _, cookie = self.c.creq('POST', '/api/teacher/signup', {
            'name': 'Учитель Файлы', 'email': secrets.token_hex(8) + '@example.invalid',
            'password': 'test-password', 'accept': True})
        self.assertEqual(status, 200)
        self.assertEqual(self.request('/media/b/assets/x.xlsx', headers={'Cookie': cookie})[0], 403)
        with mock.patch.object(delivery, 'REQUESTS_PER_MINUTE', 0):
            self.assertEqual(self.request('/media/b/assets/x.xlsx', token=self.token)[0], 429)
        self.assertEqual(self.c.req('GET', '/api/admin/bank-audit', token=self.token)[0], 401)
        result = self.c.admin('GET', '/api/admin/bank-audit')[1]
        self.assertTrue(any(e['reason'] == 'file_request_rate' and e.get('unit') == 'bytes' for e in result['events']))
        server.delete_student(self.db, self.sid)
        for table in ('download_seen', 'download_usage', 'download_events'):
            self.assertFalse(self.db.q('SELECT * FROM ' + table + " WHERE kind='student' AND account_id=?", (self.sid,)))

    def test_cross_origin_post_and_websocket_are_rejected_before_dispatch(self):
        for origin in ('null', 'https://evil.example', 'http://127.0.0.1:1'):
            self.assertEqual(self.request('/api/ping', method='POST', headers={'Origin': origin}, body={})[0], 403)
            self.assertEqual(self.request('/api/together/upload', method='POST', headers={'Origin': origin}, body={})[0], 403)
            self.assertEqual(self.request('/api/together/ws?id=1', headers={'Origin': origin})[0], 403)
        self.assertEqual(self.request('/api/ping', method='POST', body={},
                                     headers={'Origin': 'http://127.0.0.1:' + str(self.c.port)})[0], 200)

    def test_headers_cors_and_hsts_have_narrow_scope(self):
        status, headers, _ = self.request('/vendor/ordinary.js')
        self.assertEqual(status, 200)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertIn("object-src 'none'", headers['Content-Security-Policy'])
        self.assertNotIn('Content-Security-Policy-Report-Only', headers)
        self.assertNotIn('Strict-Transport-Security', headers)
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(self.request('/vendor/pyodide/runtime.js')[1]['Access-Control-Allow-Origin'], '*')
        self.assertNotIn('Access-Control-Allow-Credentials', self.request('/vendor/pyodide/runtime.js')[1])
        secure = self.request('/api/ping', headers={'X-Forwarded-Proto': 'https'})[1]
        self.assertEqual(secure['Strict-Transport-Security'], 'max-age=31536000')
        self.assertEqual(self.request('/python-sandbox.html')[1]['Cache-Control'], 'private, no-store')


if __name__ == '__main__':
    unittest.main()
