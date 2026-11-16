"""Real HTTP/SQLite integration; substitute only the isolated runner transport.

Submitted Python never executes in the HTTP server or in these test mocks.
"""
import contextlib
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
from pathlib import Path
import sqlite3
import sys
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
import buglab
import buglab_grading as grading
import buglab_merge
import buglab_verifier as verifier
import learning_quality
from learning_access import set_learning_passwords
import server
import test_server as fixtures


class BugLabGradingHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        server._BUG_TRIES.clear()
        type(self).serial += 1
        with contextlib.redirect_stdout(io.StringIO()):
            self.token = self.client.login('Проверкин ' + chr(1040 + self.serial) + 'ов')
        self.sid = self.req('GET', '/api/me')[1]['sid']
        set_learning_passwords(self.db.conn, 'synthetic-lesson-pass')
        self.assertEqual(self.req('POST', '/api/lab/unlock', {'password': 'synthetic-lesson-pass'})[0], 200)
        self.case = buglab.BY_ID['even-sum']

    def req(self, method, path, body=None):
        return self.client.req(method, path, body, self.token)

    def verify(self, **extra):
        return self.req('POST', '/api/lab/bugs/verify', {'id': self.case['id'], 'code': self.case['ref'], **extra})

    def correct_runs(self, code, inputs):
        self.assertEqual(inputs, self.case['inputs'])
        return [{'out': value} for value in self.case['expected']]

    def row(self):
        row = self.db.q('SELECT * FROM buglab WHERE student_id=? AND case_id=?', (self.sid, self.case['id']), one=True)
        return dict(row) if row else None

    def test_forged_outputs_cannot_replace_independent_execution(self):
        def wrong_runs(code, inputs):
            self.assertEqual(code, self.case['code'])
            self.assertEqual(inputs, self.case['inputs'])
            return [{'out': 'wrong'} for _ in inputs]
        with mock.patch.object(verifier.Client, 'execute', side_effect=wrong_runs) as runner:
            status, result = self.verify(code=self.case['code'], runs=[{'out': x} for x in self.case['expected']],
                                         inputs=['evil'], expected=['wrong'], star=1, verified=True)
        self.assertEqual(status, 200)
        self.assertTrue(result['verified'])  # independent check completed, with a failing verdict
        self.assertFalse(result['ok'])
        self.assertFalse(result['my']['verified'])
        self.assertEqual((result['my']['tries'], result['my']['star']), (1, 0))
        self.assertEqual(result['provenance'], 'server_python')
        runner.assert_called_once()

    def test_verified_star_and_exact_program_survive_selfcheck_failure_and_migration(self):
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            status, result = self.verify()
        self.assertEqual(status, 200)
        self.assertEqual((result['ok'], result['my']['verified'], result['my']['star']), (True, True, 1))
        original = self.row()
        self.assertEqual(original['verified_code'], self.case['ref'])
        self.assertEqual(original['verified_code_hash'], hashlib.sha256(self.case['ref'].encode()).hexdigest())
        # A later successful rewrite cannot detach the star from its minimal proof.
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            status, result = self.verify(code='a=1\nb=2\nc=3\nprint(a+b+c)\n')
        self.assertEqual((status, result['ok'], result['my']['star']), (200, True, 1))
        self.assertGreater(result['changed'], result['par'])
        for runs in ([], [{'out': x} for x in self.case['expected']]):
            status, result = self.req('POST', '/api/lab/bugs/check', {'id': self.case['id'], 'code': 'forged', 'runs': runs})
            self.assertEqual(status, 200)
            self.assertFalse(result['verified'])
            self.assertTrue(result['my']['verified'])
            self.assertEqual(result['my']['star'], 1)
        with mock.patch.object(verifier.Client, 'execute', return_value=[]):
            _, result = self.verify(code='print("wrong")')
        self.assertEqual((result['verified'], result['ok'], result['my']['verified'], result['my']['star']),
                         (True, False, True, 1))
        with self.db.transaction():
            grading.migrate(self.db.conn)
            learning_quality.migrate(self.db.conn)
        stored = self.row()
        for key in ('star', 'verified', 'verified_ts', 'verified_code_hash', 'verified_code', 'code'):
            self.assertEqual(stored[key], original[key], key)

    def test_selfcheck_explanation_and_explicit_explanation_prevent_new_star(self):
        self.req('POST', '/api/lab/bugs/check', {'id': self.case['id'], 'code': self.case['code'],
                                               'runs': [{'out': x} for x in self.case['expected']]})
        self.assertEqual(self.row()['seen'], 1)
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            _, result = self.verify()
        self.assertEqual((result['ok'], result['my']['verified'], result['my']['star']), (True, True, 0))

    def test_explanation_after_nonminimal_verified_solution_blocks_later_star(self):
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            _, first = self.verify(code='a=1\nb=2\nc=3\nprint(a+b+c)\n')
            self.assertEqual((first['ok'], first['my']['star'], first['my']['seen']), (True, 0, 1))
            self.assertIn('explain', first)
            _, later = self.verify()
        self.assertEqual((later['ok'], later['my']['verified'], later['my']['star']), (True, True, 0))

    def test_unavailable_and_busy_do_not_modify_progress_or_consume_hourly_quota(self):
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            self.verify()
        original = self.row()
        for error, status in ((verifier.VerifierUnavailable('недоступна'), 503), (verifier.VerifierBusy('занята'), 429)):
            with mock.patch.object(verifier.Client, 'execute', side_effect=error):
                self.assertEqual(self.verify()[0], status)
            self.assertEqual(self.row(), original)
        rows = self.db.q('SELECT status FROM buglab_jobs WHERE student_id=?', (self.sid,))
        self.assertEqual([r['status'] for r in rows].count('complete'), 1)
        self.assertEqual([r['status'] for r in rows].count('unavailable'), 2)

    def test_invalid_programs_fail_without_reserving_or_executing(self):
        with mock.patch.object(verifier.Client, 'execute') as runner:
            for code in ('', ' ', None, ['print(1)'], 'a\0b', 'я' * 20000):
                with self.subTest(kind=type(code).__name__):
                    self.assertEqual(self.verify(code=code)[0], 400)
        runner.assert_not_called()
        self.assertIsNone(self.row())
        self.assertFalse(self.db.q('SELECT 1 FROM buglab_jobs WHERE student_id=?', (self.sid,)))

    def test_logout_during_grading_revokes_late_credit_without_holding_database_lock(self):
        entered, release = threading.Event(), threading.Event()
        def slow(code, inputs):
            entered.set()
            self.assertTrue(release.wait(5))
            return self.correct_runs(code, inputs)
        with mock.patch.object(verifier.Client, 'execute', side_effect=slow), ThreadPoolExecutor(2) as pool:
            future = pool.submit(self.verify)
            try:
                self.assertTrue(entered.wait(3))
                # Would block if the HTTP wrapper held the DB lock while executing.
                another = pool.submit(self.req, 'GET', '/api/me')
                self.assertEqual(another.result(timeout=2)[0], 200)
                self.db.x('UPDATE student_sessions SET ended=? WHERE token=?', (time.time(), self.token))
            finally:
                release.set()
            self.assertEqual(future.result(timeout=3)[0], 401)
        self.assertIsNone(self.row())

    def test_access_revoked_during_grading_has_no_saved_verdict(self):
        def revoke(code, inputs):
            self.db.x('UPDATE students SET lab=0 WHERE id=?', (self.sid,))
            return self.correct_runs(code, inputs)
        with mock.patch.object(verifier.Client, 'execute', side_effect=revoke):
            self.assertEqual(self.verify()[0], 403)
        self.assertIsNone(self.row())

    def test_completed_but_cancelled_job_still_consumes_persistent_quota(self):
        def revoke(code, inputs):
            self.db.x('UPDATE students SET lab=0 WHERE id=?', (self.sid,))
            return self.correct_runs(code, inputs)
        with mock.patch.object(grading, 'HOUR_LIMIT', 1), mock.patch.object(verifier.Client, 'execute', side_effect=revoke) as runner:
            self.assertEqual(self.verify()[0], 403)
            self.db.x('UPDATE students SET lab=1 WHERE id=?', (self.sid,))
            self.assertEqual(self.verify()[0], 429)
        runner.assert_called_once()
        self.assertIsNone(self.row())

    def test_revocation_before_reservation_does_not_leave_orphan_job(self):
        original_access = server.lab_access
        def revoke_after_first_read(db, student):
            allowed = original_access(db, student)
            server.sessions_end(db, self.sid)
            return allowed
        with mock.patch.object(server, 'lab_access', side_effect=revoke_after_first_read), mock.patch.object(verifier.Client, 'execute') as runner:
            self.assertEqual(self.verify()[0], 401)
        runner.assert_not_called()
        self.assertIsNone(self.row())
        self.assertFalse(self.db.q('SELECT 1 FROM buglab_jobs WHERE student_id=?', (self.sid,)))

    def test_concurrent_requests_have_one_reservation_and_one_runner_job(self):
        entered, release = threading.Event(), threading.Event()
        def slow(code, inputs):
            entered.set()
            self.assertTrue(release.wait(5))
            return self.correct_runs(code, inputs)
        with mock.patch.object(verifier.Client, 'execute', side_effect=slow) as runner, ThreadPoolExecutor(2) as pool:
            first = pool.submit(self.verify)
            try:
                self.assertTrue(entered.wait(3))
                second = pool.submit(self.verify)
                self.assertEqual(second.result(timeout=2)[0], 429)
            finally:
                release.set()
            self.assertEqual(first.result(timeout=3)[0], 200)
        runner.assert_called_once()
        self.assertEqual(self.row()['star'], 1)

    def test_hourly_limit_reads_persistent_rows_not_process_memory(self):
        with mock.patch.object(grading, 'HOUR_LIMIT', 1), mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs) as runner:
            self.assertEqual(self.verify()[0], 200)
            # Reopen the accounting data independently, proving it survives process caches.
            with sqlite3.connect(server.DB_PATH) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM buglab_jobs WHERE student_id=? AND status='complete'", (self.sid,)).fetchone()[0], 1)
            server._BUG_TRIES.clear()
            self.assertEqual(self.verify()[0], 429)
        runner.assert_called_once()

    def test_expired_reservation_cannot_save_late_result(self):
        def expired(code, inputs):
            self.db.x('UPDATE buglab_jobs SET started=? WHERE student_id=?', (time.time() - grading.LEASE_SECONDS - 1, self.sid))
            return self.correct_runs(code, inputs)
        with mock.patch.object(verifier.Client, 'execute', side_effect=expired):
            self.assertEqual(self.verify()[0], 409)
        self.assertIsNone(self.row())

    def test_delete_account_removes_program_and_reservations(self):
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            self.assertEqual(self.verify()[0], 200)
        with self.db.transaction():
            server.delete_student(self.db, self.sid)
        self.assertFalse(self.db.q('SELECT 1 FROM buglab WHERE student_id=?', (self.sid,)))
        self.assertFalse(self.db.q('SELECT 1 FROM buglab_jobs WHERE student_id=?', (self.sid,)))

    def test_http_account_merge_keeps_verified_proof_and_quota_in_one_transaction(self):
        with mock.patch.object(verifier.Client, 'execute', side_effect=self.correct_runs):
            self.assertEqual(self.verify()[0], 200)
        original = self.row()
        target_token = self.client.login('Объединённый Ученик')
        target = self.client.req('GET', '/api/me', token=target_token)[1]['sid']
        real_merge = buglab_merge.merge
        def atomic_merge(db, old_sid, new_sid):
            self.assertGreater(db._tx_depth, 0)
            return real_merge(db, old_sid, new_sid)
        with mock.patch.object(buglab_merge, 'merge', side_effect=atomic_merge) as merger:
            status, result = self.client.admin('POST', '/api/admin/student/rename',
                                               {'id': self.sid, 'name': 'Объединённый Ученик'})
        self.assertEqual((status, result['merged_into']), (200, target))
        merger.assert_called_once()
        self.assertIsNone(self.row())
        row = self.db.q('SELECT * FROM buglab WHERE student_id=? AND case_id=?', (target, self.case['id']), one=True)
        self.assertEqual((row['verified'], row['star'], row['verified_code_hash']), (1, 1, original['verified_code_hash']))
        self.assertFalse(self.db.q('SELECT 1 FROM buglab_jobs WHERE student_id=?', (self.sid,)))
        self.assertEqual(self.req('GET', '/api/me')[0], 401)
        self.assertFalse(self.db.q('SELECT 1 FROM student_sessions WHERE student_id=?', (self.sid,)))


class BugLabMigrationTest(unittest.TestCase):
    def test_legacy_success_never_upgrades_and_tracks_already_exposed_explanation(self):
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE buglab(student_id INTEGER,case_id TEXT,ok INTEGER,tries INTEGER,star INTEGER,seen INTEGER)')
        conn.execute("INSERT INTO buglab VALUES(1,'old',1,0,1,0)")
        grading.migrate(conn)
        grading.migrate(conn)
        self.assertEqual(conn.execute('SELECT verified,seen,verified_ts,verified_code_hash FROM buglab').fetchone(), (0, 1, None, None))
        conn.close()


if __name__ == '__main__':
    unittest.main()
