"""Persistent, atomic account quotas and the actual HTTP access boundary."""
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

import bank_delivery as delivery
from storage import Transactional
import server
import test_server as fixtures


class TestDB(Transactional):
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self._tx_depth = 0


class DeliveryQuotaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'quota.db')
        self.db = TestDB(self.path)
        self.addCleanup(self.db.conn.close)
        self.gate = delivery.BankDelivery(self.db)
        self.student = {'id': 1, 'is_teacher': 0}
        self.now = 1000000

    def grant(self, ids, **kw):
        return self.gate.check(self.student, ids, now=kw.pop('now', self.now), **kw)

    def test_unique_conditions_rolling_windows_and_free_reopening(self):
        with mock.patch.object(delivery, 'WINDOWS', ((60, 2), (3600, 3), (86400, 4))):
            self.assertEqual(self.grant(['a', 'a', 'b']).status, 200)
            self.assertEqual(self.grant(['c']).status, 429)
            self.assertEqual(self.grant(['a', 'b']).status, 200)
            self.assertEqual(self.grant(['c'], now=self.now + 61).status, 200)
            self.assertEqual(self.grant(['d'], now=self.now + 62).status, 429)
            self.assertEqual(self.grant(['d'], now=self.now + 3601).status, 200)
            self.assertEqual(self.grant(['e'], now=self.now + 3602).status, 429)
            self.assertEqual(self.grant(['e'], now=self.now + 86401).status, 200)

    def test_quota_and_request_count_survive_reopening_database(self):
        with mock.patch.object(delivery, 'WINDOWS', ((86400, 1),)):
            self.assertEqual(self.grant(['a']).status, 200)
            other_db = TestDB(self.path)
            self.addCleanup(other_db.conn.close)
            reopened = delivery.BankDelivery(other_db)
            self.assertEqual(reopened.check(self.student, ['b'], now=self.now).status, 429)
            with mock.patch.object(delivery, 'REQUESTS_PER_MINUTE', 2):
                self.assertEqual(reopened.check(self.student, ['a'], now=self.now).status, 429)

    def test_denied_batch_is_not_partially_charged(self):
        with mock.patch.object(delivery, 'WINDOWS', ((3600, 3),)):
            self.grant(['a'], now=self.now - 100)
            self.grant(['b'], now=self.now - 80)
            self.grant(['c'], now=self.now - 60)
            d = self.grant(['x', 'y'])
            self.assertEqual((d.status, d.retry_after), (429, 3520))
            self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM bank_html_seen').fetchone()[0], 3)

    def test_accounts_are_separate_and_preview_is_still_bounded(self):
        with mock.patch.object(delivery, 'WINDOWS', ((86400, 1),)):
            self.grant(['a'])
            self.assertEqual(self.gate.check({'id': 2, 'is_teacher': 0}, ['b'], now=self.now).status, 200)
            teacher = {'id': 3, 'is_teacher': 1}
            self.assertEqual(self.gate.check(teacher, ['a', 'b', 'c', 'd'], now=self.now).status, 200)
            self.assertEqual(self.gate.check(teacher, ['e'], now=self.now).status, 429)

    def test_parallel_connections_cannot_overspend(self):
        other_db = TestDB(self.path)
        self.addCleanup(other_db.conn.close)
        other = delivery.BankDelivery(other_db)
        with mock.patch.object(delivery, 'WINDOWS', ((3600, 9),)):
            def hit(i):
                return (self.gate if i % 2 else other).check(self.student, [str(i)], now=self.now).status
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                statuses = list(pool.map(hit, range(20)))
        self.assertEqual(statuses.count(200), 9)
        self.assertEqual(statuses.count(429), 11)
        self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM bank_html_seen').fetchone()[0], 9)

    def test_invalid_requests_and_repeats_are_rate_limited_and_audited(self):
        with mock.patch.object(delivery, 'REQUESTS_PER_MINUTE', 2):
            for _ in range(2):
                self.assertEqual(self.grant([], issue='batch_size', requested=100).status, 400)
            self.assertEqual(self.grant(['a']).status, 429)
        row = self.db.conn.execute("SELECT * FROM bank_html_events WHERE reason='batch_size'").fetchone()
        self.assertEqual((row['n'], row['requested']), (2, 200))
        self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM bank_html_seen').fetchone()[0], 0)

    def test_old_counters_and_audit_are_pruned(self):
        self.grant(['a'])
        self.grant([], issue='invalid_page')
        self.grant(['b'], now=self.now + 31 * 86400)
        self.assertEqual([r[0] for r in self.db.conn.execute('SELECT task_id FROM bank_html_seen')], ['b'])
        self.assertEqual(self.db.conn.execute('SELECT COUNT(*) FROM bank_html_events').fetchone()[0], 0)


class DeliveryHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()
        root = Path(__file__).resolve().parent.parent
        for name in ('bank_delivery.py', 'deploy/BANK_DELIVERY.md'):
            dest = server.HERE / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((root / name).read_bytes())

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        for table in ('bank_html_seen', 'bank_html_requests', 'bank_html_events'):
            self.db.x('DELETE FROM ' + table)
        self.name = 'Читатель ' + secrets.token_hex(6).translate(str.maketrans('0123456789', 'abcdefghij'))
        self.token = self.client.login(self.name)
        self.ids = ['quota-' + str(i) for i in range(75)]
        for tid in self.ids:
            server.APP.bank.html_pub[tid] = '<p>Условие ' + tid + '</p>'
        server.APP.bank.html_n['5'] = tuple(self.ids)

    def request(self, path, *, token=None, headers=None, method='GET'):
        c = http.client.HTTPConnection('127.0.0.1', self.client.port, timeout=10)
        c.request(method, path, headers={'X-Token': token or self.token, **(headers or {})})
        r = c.getresponse()
        body = r.read()
        result = r.status, json.loads(body) if body else {}, dict(r.getheaders())
        c.close()
        return result

    def test_pages_are_bounded_and_do_not_contain_answers_or_limits(self):
        self.assertEqual(self.client.req('GET', '/api/html?n=5')[0], 401)
        a = self.request('/api/html?n=5&limit=999999')
        b = self.request('/api/html?n=5&offset=20')
        self.assertEqual((a[0], len(a[1]['html']), a[1]['next_offset']), (200, 20, 20))
        self.assertFalse(set(a[1]['html']) & set(b[1]['html']))
        self.assertEqual(set(a[1]), {'html', 'next_offset'})
        self.assertEqual(a[2]['Cache-Control'], 'private, no-store')
        self.assertIn('X-Token', a[2]['Vary'])

    def test_ids_pages_cookies_and_sessions_share_one_account_quota(self):
        with mock.patch.object(delivery, 'WINDOWS', ((86400, 21),)):
            self.assertEqual(self.request('/api/html?n=5')[0], 200)
            status, logged = self.client.req('POST', '/api/login',
                {'mode': 'login', 'name': self.name, 'password': 'secret1'})
            self.assertEqual(status, 200)
            r = self.request('/api/html?ids=quota-20,quota-21', token=logged['token'],
                             headers={'If-None-Match': '"old"'})
            self.assertEqual(r[0], 429)
            self.assertGreater(int(r[2]['Retry-After']), 0)
            self.assertEqual(self.request('/api/html?ids=quota-0', token=logged['token'])[0], 200)
            other = self.client.login('Другой ' + secrets.token_hex(6).translate(str.maketrans('0123456789', 'abcdefghij')))
            self.assertEqual(self.request('/api/html?ids=quota-20,quota-21', token=other)[0], 200)
            # Cookie authentication cannot acquire a separate budget.
            self.assertEqual(self.request('/api/html?ids=quota-20,quota-21',
                headers={'X-Token': '', 'Cookie': 'egest=' + self.token})[0], 429)

    def test_oversized_and_malformed_requests_do_not_return_partial_content(self):
        for path in ['/api/html?ids=' + ','.join(self.ids[:31]),
                     '/api/html?ids=' + ','.join(['quota-0'] * 31),
                     '/api/html?n=5&offset=-1', '/api/html?n=500',
                     '/api/html?n=5&ids=quota-0', '/api/html?ids=quota-0&offset=1']:
            r = self.request(path)
            self.assertEqual(r[0], 400, path)
            self.assertNotIn('html', r[1])
        self.assertEqual(self.db.q('SELECT COUNT(*) AS n FROM bank_html_seen', one=True)['n'], 0)

    def test_cached_etag_and_head_cannot_mark_conditions_as_delivered(self):
        self.assertEqual(self.request('/api/html?n=5', method='HEAD')[0], 405)
        self.assertEqual(self.db.q('SELECT COUNT(*) AS n FROM bank_html_seen', one=True)['n'], 0)
        self.assertEqual(self.request('/api/html?ids=quota-0', headers={'If-None-Match': '"old"'})[0], 200)
        self.db.x('UPDATE student_sessions SET ended=1 WHERE token=?', (self.token,))
        self.assertEqual(self.request('/api/html?ids=quota-0', headers={'If-None-Match': '*'})[0], 401)

    def test_audit_is_only_available_to_principal(self):
        self.request('/api/html?ids=' + ','.join(self.ids))
        self.assertEqual(self.client.req('GET', '/api/admin/bank-audit', token=self.token)[0], 401)
        status, report = self.client.admin('GET', '/api/admin/bank-audit')
        self.assertEqual(status, 200)
        self.assertEqual(report['events'][0]['name'].lower(), self.name.lower())
        self.assertEqual(report['events'][0]['reason'], 'batch_size')
        status, result, cookie = self.client.creq('POST', '/api/teacher/signup',
            {'name': 'Учитель Проверка', 'email': secrets.token_hex(6) + '@example.invalid',
             'password': 'test-password', 'accept': True})
        self.assertEqual(status, 200, result)
        status, teacher, _ = self.client.creq('GET', '/api/admin/me', cookie=cookie)
        self.db.x("UPDATE teachers SET email_ok=1, moderation='approved' WHERE id=?", (teacher['id'],))
        self.assertEqual(self.client.creq('GET', '/api/admin/bank-audit', cookie=cookie)[0], 403)

    def test_deleting_account_removes_counters_and_audit(self):
        self.request('/api/html?ids=quota-0')
        self.request('/api/html?ids=' + ','.join(self.ids))
        sid = self.db.q('SELECT student_id FROM student_sessions WHERE token=?', (self.token,), one=True)['student_id']
        self.assertTrue(self.db.q('SELECT * FROM bank_html_events WHERE student_id=?', (sid,)))
        server.delete_student(self.db, sid)
        for table in ('bank_html_seen', 'bank_html_requests', 'bank_html_events'):
            self.assertFalse(self.db.q('SELECT * FROM ' + table + ' WHERE student_id=?', (sid,)))

    def test_policy_and_internal_notes_are_not_served(self):
        for path in ('/bank_delivery.py', '/deploy/BANK_DELIVERY.md'):
            self.assertEqual(self.client.req('GET', path)[0], 404)
            self.assertEqual(self.client.req('GET', path, token=self.token)[0], 404)
