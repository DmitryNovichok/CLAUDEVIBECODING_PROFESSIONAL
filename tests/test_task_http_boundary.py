"""Real HTTP races and rollback of database + in-memory task progress."""
import concurrent.futures
import contextlib
from copy import deepcopy
import io
import json
import secrets
import sqlite3
import threading
import time
import unittest
from unittest import mock

import economy
import server
import test_server as fixtures


class TaskHTTPBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        suffix = secrets.token_hex(5).translate(str.maketrans('0123456789', 'abcdefghij'))
        self.token = self.client.login('Границын ' + suffix)
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        self.key = (self.sid, 'b:5')
        self.assertEqual(self.request('/api/open')[0], 200)

    def request(self, path, **data):
        return self.client.req('POST', path, dict(task='b:5', **data), self.token)

    def attempt_count(self):
        return self.db.q('SELECT COUNT(*) n FROM attempts WHERE student_id=? AND task_id=?', self.key, one=True)['n']

    def test_concurrent_correct_checks_record_one_attempt_and_one_first_try_win(self):
        entered, release = threading.Event(), threading.Event()
        real_credit = server.answer_credit
        first_lock = threading.Lock()
        calls = 0

        def pause_first(*args):
            nonlocal calls
            with first_lock:
                calls += 1
                first = calls == 1
            if first:
                entered.set()
                if not release.wait(timeout=5):
                    raise TimeoutError('test did not release answer verification')
            return real_credit(*args)

        with mock.patch.object(server, 'answer_credit', side_effect=pause_first):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(self.request, '/api/check', answer='12')
                try:
                    self.assertTrue(entered.wait(timeout=5))
                    b = pool.submit(self.request, '/api/check', answer='12')
                    with self.assertRaises(concurrent.futures.TimeoutError):
                        b.result(timeout=0.2)
                finally:
                    release.set()
                results = [a.result(timeout=5), b.result(timeout=5)]
        self.assertTrue(all(status == 200 and body['correct'] and body['score'] == 1 for status, body in results))
        self.assertEqual(calls, 1)
        self.assertEqual(self.attempt_count(), 1)
        self.assertEqual(server.OPENED.m[self.key]['tries'], ['12'])

    def test_handler_exception_restores_exact_open_state_and_rolls_back_attempt(self):
        before = deepcopy(server.OPENED.m[self.key])
        real_log = server.Handler.log_attempt

        def fail_after_insert(handler, *args, **kwargs):
            real_log(handler, *args, **kwargs)
            raise RuntimeError('synthetic failure after attempt insert')

        with mock.patch.object(server.Handler, 'log_attempt', new=fail_after_insert), \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.request('/api/check', answer='12')[0], 500)
        self.assertEqual(self.attempt_count(), 0)
        self.assertEqual(server.OPENED.m[self.key], before)
        self.assertEqual(len(server.CHECKS.recent[self.sid]), 1)  # throttling is not rolled back
        self.assertEqual(self.request('/api/check', answer='12')[1]['score'], 1)
        self.assertEqual(self.attempt_count(), 1)

    def test_commit_failure_restores_open_state_and_preserves_global_rollback_hook(self):
        before = deepcopy(server.OPENED.m[self.key])
        db, real_connection = self.db, self.db.conn

        class FailFirstTransactionCommit:
            failed = False

            def __getattr__(self, name):
                return getattr(real_connection, name)

            def commit(self):
                if db._tx_depth and not self.failed:
                    self.failed = True
                    raise sqlite3.OperationalError('synthetic commit failure')
                return real_connection.commit()

        proxy = FailFirstTransactionCommit()
        with mock.patch.object(db, 'conn', proxy), \
             mock.patch.object(economy, 'on_rollback', wraps=economy.on_rollback) as hook, \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.request('/api/check', answer='12')[0], 500)
            self.assertTrue(proxy.failed)
            hook.assert_called_once_with()
        self.assertEqual(self.attempt_count(), 0)
        self.assertEqual(server.OPENED.m[self.key], before)
        self.assertEqual(self.request('/api/check', answer='12')[1]['score'], 1)
        self.assertEqual(self.attempt_count(), 1)

    def test_rejected_action_removes_new_open_state_and_does_not_record_progress(self):
        server.OPENED.m.pop(self.key)
        self.assertEqual(self.request('/api/check', answer='')[0], 400)
        self.assertNotIn(self.key, server.OPENED.m)
        self.assertEqual(self.attempt_count(), 0)

    def test_open_commit_failure_restores_previous_completed_state(self):
        self.assertEqual(self.request('/api/check', answer='12')[0], 200)
        before = deepcopy(server.OPENED.m[self.key])
        original_transaction = self.db.transaction

        @contextlib.contextmanager
        def fail_before_commit():
            with original_transaction():
                yield
                raise sqlite3.OperationalError('synthetic open commit failure')

        with mock.patch.object(self.db, 'transaction', new=fail_before_commit), \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.request('/api/open')[0], 500)
        self.assertEqual(server.OPENED.m[self.key], before)
        self.assertEqual(self.attempt_count(), 1)

    def test_all_task_actions_use_authentication_and_strict_assignment_gate(self):
        for path in ('/api/open', '/api/check', '/api/hint', '/api/reveal'):
            with self.subTest(path=path):
                self.assertEqual(self.client.req('POST', path, {'task': 'b:5', 'answer': '12'})[0], 401)
                self.assertEqual(self.client.req('GET', path, token=self.token)[0], 405)
                self.assertEqual(self.client.req('POST', path, {'task': 'unknown'}, self.token)[0], 404)
        cid = self.db.x('INSERT INTO classes(name,teacher_id,created) VALUES(?,?,?)',
                        ('Закрытая проверка', server.main_teacher()['id'], time.time()))
        self.db.x('UPDATE students SET class_id=? WHERE id=?', (cid, self.sid))
        self.db.x('''INSERT INTO assignments(class_id,title,tasks,created,kind,strict)
                     VALUES(?,?,?,?,'self',1)''', (cid, 'Самостоятельная', json.dumps(['b:5']), time.time()))
        before = deepcopy(server.OPENED.m[self.key])
        for path in ('/api/check', '/api/hint', '/api/reveal'):
            self.assertEqual(self.request(path, answer='12')[0], 403)
        self.assertEqual(server.OPENED.m[self.key], before)
        self.assertEqual(self.attempt_count(), 0)
        self.assertEqual(self.request('/api/open')[0], 200)

    def test_learning_followup_requires_current_bank_and_is_returned_to_owner(self):
        with mock.patch.object(server.APP.bank, 'ensure', return_value=False):
            self.assertEqual(self.client.req('GET', '/api/learning/mistakes', token=self.token)[0], 503)
        status, body = self.client.req('GET', '/api/learning/mistakes', token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['followup']['evaluated'], 0)
        self.assertIsNone(body['followup']['recovery_rate'])
        self.assertEqual(self.client.req('GET', '/api/learning/mistakes')[0], 401)


if __name__ == '__main__':
    unittest.main()
