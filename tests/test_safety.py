"""Regression tests: synthetic data only, never the repository/runtime database."""
import contextlib
import io
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

import server
import together
import test_server as fixtures


class EconomySafetyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        with contextlib.redirect_stdout(io.StringIO()):
            self.token = self.client.login('Макетов ' + ['Первый', 'Второй', 'Третий', 'Четвертый'][getattr(type(self), 'serial', 0)])
        type(self).serial = getattr(type(self), 'serial', 0) + 1
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        self.gift = self.db.x('INSERT INTO gifts(student_id,gift,ts,seen,paid) VALUES(?,?,?,1,100)',
                              (self.sid, 'telescope', time.time()))

    def test_parallel_sale_credits_once(self):
        gate = threading.Barrier(2)
        def sell():
            gate.wait(timeout=5)
            return self.client.req('POST', '/api/gifts/sell', {'id': self.gift}, self.token)[0]
        with ThreadPoolExecutor(2) as pool:
            statuses = sorted(pool.map(lambda _: sell(), range(2)))
        self.assertEqual(statuses, [200, 404])
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM coins WHERE gift_id=? AND reason='sell'", (self.gift,), one=True)['n'], 1)

    def test_failed_sale_rolls_back_and_can_retry(self):
        original = self.db.x
        def fail(sql, args=()):
            if 'INSERT INTO coins' in sql and "'sell'" in sql:
                raise sqlite3.OperationalError('synthetic failure')
            return original(sql, args)
        with mock.patch.object(self.db, 'x', side_effect=fail), mock.patch.object(server.Handler, 'log_error_safe'):
            status, _ = self.client.req('POST', '/api/gifts/sell', {'id': self.gift}, self.token)
        self.assertEqual(status, 500)
        self.assertIsNone(self.db.q('SELECT sold FROM gifts WHERE id=?', (self.gift,), one=True)['sold'])
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM coins WHERE gift_id=? AND reason='sell'", (self.gift,), one=True)['n'], 0)
        self.assertEqual(self.client.req('POST', '/api/gifts/sell', {'id': self.gift}, self.token)[0], 200)

    def test_forbes_counts_complete_collection(self):
        with self.db.transaction():
            for i in range(200):
                self.db.x('INSERT INTO gifts(student_id,gift,ts,seen,paid) VALUES(?,?,?,1,100)',
                          (self.sid, 'telescope', time.time() + i))
        server._FORBES.clear()
        row = next(r for r in server.forbes_data(self.db)['rows'] if r['sid'] == self.sid)
        self.assertEqual(row['n'], 201)
        e = server.econ(self.db)
        full = server.gift_rows(self.db, self.sid, limit=-1, prices=(e, server.uniq_issued(self.db), server.gift_demand(self.db)))
        self.assertEqual(row['value'], sum(x['worth'] for x in full))


class StorageSafetyTest(unittest.TestCase):
    def test_nested_transaction_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            db = server.DB(Path(d) / 'synthetic.db')
            try:
                with db.transaction():
                    db.setting('outer-test', 'ok')
                    with self.assertRaises(RuntimeError):
                        with db.transaction():
                            db.setting('inner-test', 'bad')
                            raise RuntimeError('rollback')
                self.assertEqual(db.setting('outer-test'), 'ok')
                self.assertIsNone(db.setting('inner-test'))
            finally:
                db.conn.close()

    def test_revoke_does_not_touch_learning_or_balances(self):
        with tempfile.TemporaryDirectory() as d:
            db = server.DB(Path(d) / 'synthetic.db')
            try:
                sid = db.x("INSERT INTO students(name,name_key,token) VALUES('Макетов Первый','synthetic','old')")
                db.x("INSERT INTO admin_sessions(token,expires) VALUES('old-admin',9999999999)")
                db.x("INSERT INTO student_sessions(token,student_id,created,last_seen) VALUES('old-device',?,?,?)", (sid,time.time(),time.time()))
                db.x("INSERT INTO coins(student_id,ts,delta,reason) VALUES(?,0,123,'grant')", (sid,))
                db.x("INSERT INTO attempts(student_id,ts,task_id,score) VALUES(?,0,'synthetic',1)", (sid,))
                server.revoke_access(db)
                self.assertFalse(db.q('SELECT * FROM admin_sessions'))
                self.assertFalse(db.q('SELECT * FROM student_sessions'))
                self.assertNotEqual(db.q('SELECT token FROM students', one=True)['token'], 'old')
                self.assertEqual(db.q('SELECT delta FROM coins', one=True)['delta'], 123)
                self.assertEqual(db.q('SELECT score FROM attempts', one=True)['score'], 1)
            finally:
                db.conn.close()

    def test_shutdown_flushes_latest_code_and_stops_edits(self):
        saved = []
        hub = together.Hub(lambda _: None, lambda sid, data: saved.append(data), None, None, None)
        session = together.Session({'id': 1, 'teacher_id': 1, 'students':'[]', 'ended':None, 'created':0}, {})
        session.pages['p1'].code = 'print(42)'
        session.dirty = True
        hub.sessions[1] = session
        hub.close()
        self.assertEqual(saved[-1]['pages']['p1']['code'], 'print(42)')
        self.assertTrue(hub.stopping.is_set())
        self.assertIsNone(hub.get(1))

    def test_sigterm_saves_dirty_session(self):
        import subprocess
        import json
        import sys
        import textwrap
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            bootstrap = textwrap.dedent("""
                import sys,time,threading,os,json
                from pathlib import Path
                root=Path(sys.argv[1])
                policy=root/'private.json'
                policy.write_text(json.dumps({'TASK_BTC':{str(n):str(n/10) for n in range(1,28)}}))
                os.environ['EGE_PRIVATE_CONFIG']=str(policy)
                import server
                server.DB_PATH=root/'runtime.db'
                server.BANK_JS=root/'missing.js'
                server.EXTRA_BANK=root/'missing.json'
                server.HERE=root
                server.together.SAVE_EVERY=3600
                def prepare():
                    while server.APP is None: time.sleep(.01)
                    db=server.APP.db
                    tid=db.q('SELECT id FROM teachers WHERE is_main=1',one=True)['id']
                    sid=db.x("INSERT INTO together(teacher_id,students,created,state) VALUES(?,'[]',0,'{}')",(tid,))
                    session=server.TOG.get(sid)
                    with session.lock:
                        session.pages['p1'].code='print(12345)'
                        session.dirty=True
                    (root/'ready').touch()
                threading.Thread(target=prepare,daemon=True).start()
                sys.argv=['server','--host','127.0.0.1','--port','0']
                server.main()
            """)
            proc = subprocess.Popen([sys.executable, '-c', bootstrap, str(root)],
                                    cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                end=time.monotonic()+15
                while not (root/'ready').exists() and time.monotonic()<end and proc.poll() is None:
                    time.sleep(.05)
                self.assertTrue((root/'ready').exists(), 'temporary server did not start')
                proc.terminate()
                _, error=proc.communicate(timeout=15)
                self.assertEqual(proc.returncode,0,error.decode())
                with sqlite3.connect(root/'runtime.db') as db:
                    state=json.loads(db.execute('SELECT state FROM together').fetchone()[0])
                self.assertEqual(state['pages']['p1']['code'],'print(12345)')
            finally:
                if proc.poll() is None:
                    proc.kill(); proc.communicate()

    def test_backup_includes_wal_and_checks_integrity(self):
        import gzip
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); src = root / 'synthetic.db'
            db = sqlite3.connect(src)
            try:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE example(value INTEGER)')
                db.execute('INSERT INTO example VALUES(42)'); db.commit()
                subprocess.run(['sh', str(Path(__file__).resolve().parents[1]/'deploy/backup.sh'), str(src), str(root/'copies')], check=True, capture_output=True)
                archive = next((root/'copies').glob('*.db.gz'))
                restored = root/'restored.db'; restored.write_bytes(gzip.decompress(archive.read_bytes()))
                with sqlite3.connect(restored) as copy:
                    self.assertEqual(copy.execute('SELECT value FROM example').fetchone()[0],42)
                    self.assertEqual(copy.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            finally:
                db.close()
