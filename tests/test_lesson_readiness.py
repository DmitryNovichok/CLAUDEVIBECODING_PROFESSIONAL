import tempfile
import unittest
import contextlib
import io
from pathlib import Path
from test_bank_delivery import TestDB
from lesson_readiness import probe
import test_server as fixtures


class ReadinessTest(unittest.TestCase):
    def test_committed_receipt_survives_reconnect_and_is_account_scoped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'probe.db'
            db = TestDB(path)
            self.assertEqual(probe(db, 's:1', 'a' * 32, write=True, now=100)[0], 200)
            db.conn.close()
            db = TestDB(path)
            try:
                self.assertEqual(probe(db, 's:1', 'a' * 32, now=101), (200, {'ok': True, 'saved': True}))
                self.assertEqual(probe(db, 't:1', 'a' * 32, now=101)[0], 409)
                self.assertEqual(probe(db, 's:1', 'b' * 32, now=101)[0], 409)
                self.assertEqual(probe(db, 's:1', 'a' * 32, now=401)[0], 409)
                self.assertEqual(probe(db, 's:1', 'b' * 32, write=True, now=102)[0], 429)
                self.assertEqual(probe(db, 's:1', '../bad', write=True, now=102)[0], 400)
            finally:
                db.conn.close()


class ReadinessHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def test_authenticated_round_trip_and_file_without_learning_writes(self):
        import server
        c = self.client
        c.setUp()
        for method in ('GET', 'POST'):
            self.assertEqual(c.req(method, '/api/readiness', {'nonce': 'a' * 32} if method == 'POST' else None)[0], 401)
        token = c.login('Проверкин Пётр')
        before = server.APP.db.q('SELECT COUNT(*) AS n FROM attempts', one=True)['n']
        self.assertEqual(c.req('GET', '/api/readiness', token=token)[0], 200)
        self.assertEqual(c.req('POST', '/api/readiness', {'nonce': 'a' * 32}, token=token)[0], 200)
        self.assertEqual(c.req('GET', '/api/readiness?receipt=' + 'a' * 32, token=token)[1]['saved'], True)
        self.assertEqual(c.req('GET', '/api/readiness?file=1', token=token), (200, b'17\n23\n'))
        self.assertEqual(server.APP.db.q('SELECT COUNT(*) AS n FROM attempts', one=True)['n'], before)
