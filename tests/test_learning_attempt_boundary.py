"""Assignment/exam HTTP ownership, acknowledgement and duplicate-submit regressions."""
import concurrent.futures
import contextlib
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock

import api_access
import learning_attempt_http
import server
import test_server as fixtures


class LearningAttemptModuleTest(unittest.TestCase):
    def test_import_does_not_initialize_server_or_storage(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, '-c',
                "import sys, learning_attempt_http; assert 'server' not in sys.modules"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parent.parent)},
                capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(folder).iterdir()), [])
        for path in learning_attempt_http.LEARNING_ATTEMPT_PATHS:
            for method in ('GET', 'POST'):
                self.assertEqual(api_access.ROUTES[method, path], api_access.Access.STUDENT)


class LearningAttemptBoundaryTest(unittest.TestCase):
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
        name = secrets.token_hex(6).translate(str.maketrans('0123456789', 'abcdefghij'))
        self.token = self.client.login('Попыткин ' + name)
        self.other = self.client.login('Чужов ' + name)
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        self.other_sid = self.client.req('GET', '/api/me', token=self.other)[1]['sid']
        self.cid = self.db.x('INSERT INTO classes(name, teacher_id, created) VALUES(?,?,?)',
                             ('Проверка попыток', server.main_teacher()['id'], time.time()))
        self.db.x('UPDATE students SET class_id=? WHERE id=?', (self.cid, self.sid))
        server.APP.bank.ensure()
        self.task = server.APP.bank.pid('b:5')

    def work(self, personal=False):
        return self.db.x('''INSERT INTO assignments(class_id,title,tasks,created,kind,strict,student_id)
                            VALUES(?,?,?,?,'self',1,?)''',
                         (self.cid, 'Проверка границы', '["b:5"]', time.time(), self.sid if personal else None))

    def assignment(self, action, aid, **data):
        return self.client.req('POST', '/api/asg/' + action, {'id': aid, **data}, self.token)

    def start_and_answer(self):
        aid = self.work()
        self.assertEqual(self.assignment('start', aid)[0], 200)
        self.assertEqual(self.assignment('answer', aid, task=self.task, answer='12')[0], 200)
        return aid

    def attempt_count(self):
        return self.db.q('SELECT COUNT(*) n FROM attempts WHERE student_id=?', (self.sid,), one=True)['n']

    def game(self):
        data = self.client.req('GET', '/api/me', token=self.token)[1]['game']
        return data['xp'], data['coins']

    @contextlib.contextmanager
    def fail_next_commit(self):
        db, real = self.db, self.db.conn
        class FailingConnection:
            failed = False
            def __getattr__(self, name):
                return getattr(real, name)
            def commit(self):
                if db._tx_depth and not self.failed:
                    self.failed = True
                    raise sqlite3.OperationalError('synthetic attempt commit failure')
                return real.commit()
        proxy = FailingConnection()
        with mock.patch.object(db, 'conn', proxy), mock.patch.object(server.Handler, 'log_error_safe'):
            yield
        self.assertTrue(proxy.failed)

    def test_assignment_class_and_personal_ownership_survive_all_actions(self):
        aid = self.start_and_answer()
        routes = ('state', 'review', 'start', 'away', 'answer', 'finish')
        for personal in (False, True):
            if personal:
                self.db.x('UPDATE students SET class_id=? WHERE id=?', (self.cid, self.other_sid))
                self.db.x('UPDATE assignments SET student_id=? WHERE id=?', (self.sid, aid))
            for route in routes:
                with self.subTest(personal=personal, route=route):
                    status, _ = self.client.req('POST', '/api/asg/' + route,
                        {'id': aid, 'task': self.task, 'answer': '12'}, self.other)
                    self.assertEqual(status, 404)
            listed = self.client.req('GET', '/api/assignments', token=self.other)[1]['assignments']
            self.assertNotIn(aid, [item['id'] for item in listed])
        self.assertFalse(self.db.q('SELECT 1 FROM asg_runs WHERE student_id=?', (self.other_sid,), one=True))
        self.assertEqual(self.attempt_count(), 0)

    def test_parallel_answers_accept_only_one_and_acknowledgement_is_durable(self):
        aid = self.work()
        self.assertEqual(self.assignment('start', aid)[0], 200)
        barrier = threading.Barrier(2)
        def answer(value):
            barrier.wait(timeout=5)
            return self.assignment('answer', aid, task=self.task, answer=value)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(answer, ['12', '13']))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        accepted = next(body['mine'][self.task] for status, body in results if status == 200)
        # A different SQLite connection sees the answer as soon as HTTP says saved.
        with sqlite3.connect(server.DB_PATH) as reader:
            saved = reader.execute('SELECT answers FROM asg_runs WHERE asg_id=? AND student_id=?',
                                   (aid, self.sid)).fetchone()[0]
        self.assertEqual(json.loads(saved)['b:5']['a'], accepted)
        self.assertEqual(self.attempt_count(), 0)  # scoring starts only when work is finished

    def test_failed_answer_commit_has_no_success_or_saved_answer(self):
        aid = self.work()
        self.assertEqual(self.assignment('start', aid)[0], 200)
        with self.fail_next_commit():
            self.assertEqual(self.assignment('answer', aid, task=self.task, answer='12')[0], 500)
        status, state = self.client.req('GET', f'/api/asg/state?id={aid}', token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(state['mine'], {})
        self.assertEqual(self.assignment('answer', aid, task=self.task, answer='12')[0], 200)

    def test_failed_finish_commit_rolls_back_score_history_and_reward(self):
        aid = self.start_and_answer()
        before = self.game()
        with self.fail_next_commit():
            self.assertEqual(self.assignment('finish', aid)[0], 500)
        run = self.db.q('SELECT finished, result FROM asg_runs WHERE asg_id=? AND student_id=?',
                        (aid, self.sid), one=True)
        self.assertIsNone(run['finished'])
        self.assertFalse(run['result'])
        self.assertEqual(self.attempt_count(), 0)
        self.assertEqual(self.game(), before)
        self.assertFalse(self.db.q("SELECT 1 FROM asg_events WHERE asg_id=? AND kind='finish'", (aid,), one=True))
        self.assertEqual(self.assignment('finish', aid)[0], 200)
        self.assertEqual(self.attempt_count(), 1)

    def test_parallel_finish_records_one_result_and_preserves_repeat_reward(self):
        aid = self.start_and_answer()
        barrier = threading.Barrier(2)
        def finish(_):
            barrier.wait(timeout=5)
            return self.assignment('finish', aid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(finish, range(2)))
        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertEqual(results[0][1]['result'], results[1][1]['result'])
        self.assertEqual(self.attempt_count(), 1)
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM asg_events WHERE asg_id=? AND kind='finish'",
                                   (aid,), one=True)['n'], 1)
        before = self.game()
        self.assertEqual(self.assignment('finish', aid)[0], 200)
        self.assertEqual(self.game(), before)
        self.assertEqual(self.attempt_count(), 1)

    def test_exam_owner_revision_order_and_expiry_use_last_confirmed_answers(self):
        status, started = self.client.req('POST', '/api/exam/start', {}, self.token)
        self.assertEqual(status, 200, started)
        eid = started['exam_id']
        answers = [{'task': self.task, 'answer': '12'}]
        for route in ('save', 'finish'):
            self.assertEqual(self.client.req('POST', '/api/exam/' + route,
                {'exam_id': eid, 'rev': 99, 'answers': answers}, self.other)[0], 404)
        for rev, value in ((2, '12'), (1, '13')):
            status, saved = self.client.req('POST', '/api/exam/save',
                {'exam_id': eid, 'rev': rev, 'answers': [{'task': self.task, 'answer': value}]}, self.token)
            self.assertEqual((status, saved['rev']), (200, 2))
        self.db.x('UPDATE exams SET started=? WHERE id=?', (time.time() - server.EXAM_LIMIT_SEC - 5, eid))
        late = {'exam_id': eid, 'answers': [{'task': self.task, 'answer': '13'}]}
        status, finished = self.client.req('POST', '/api/exam/finish', late, self.token)
        self.assertEqual(status, 200, finished)
        self.assertTrue(finished['expired'])
        result = next(item for item in finished['results'] if item['task'] == self.task)
        self.assertEqual((result['mine'], result['points']), ('12', result['max']))
        self.assertEqual(self.client.req('GET', '/api/exam/view?id=' + eid, token=self.other)[0], 404)
        self.assertEqual(self.client.req('GET', '/api/exams', token=self.other)[1]['exams'], [])
        before = self.game()
        self.assertEqual(self.client.req('POST', '/api/exam/finish', late, self.token)[1]['results'], finished['results'])
        self.assertEqual(self.attempt_count(), 1)
        self.assertEqual(self.game(), before)

    def test_exam_finish_commit_failure_does_not_publish_result_or_attempts(self):
        status, started = self.client.req('POST', '/api/exam/start', {}, self.token)
        self.assertEqual(status, 200, started)
        eid = started['exam_id']
        data = {'exam_id': eid, 'answers': [{'task': self.task, 'answer': '12'}]}
        with self.fail_next_commit():
            self.assertEqual(self.client.req('POST', '/api/exam/finish', data, self.token)[0], 500)
        self.assertIsNone(self.db.q('SELECT finished FROM exams WHERE id=?', (eid,), one=True)['finished'])
        self.assertEqual(self.attempt_count(), 0)
        self.assertEqual(self.client.req('GET', '/api/exams', token=self.token)[1]['exams'], [])
        self.assertEqual(self.client.req('POST', '/api/exam/finish', data, self.token)[0], 200)
        self.assertEqual(self.attempt_count(), 1)

    def test_new_handler_sources_are_not_served_as_static_files(self):
        for name in ('learning_attempt_http.py', 'teacher_work_http.py', 'teacher_students_http.py'):
            path = server.HERE / name
            path.write_text('synthetic-private-handler-source', encoding='utf-8')
            self.addCleanup(path.unlink, missing_ok=True)
            for token in (None, self.token):
                for method in ('GET', 'HEAD'):
                    with self.subTest(name=name, authenticated=bool(token), method=method):
                        status, body = self.client.req(method, '/' + name, token=token)
                        self.assertEqual(status, 404)
                        self.assertNotIn('synthetic-private-handler-source', str(body))

    def test_extracted_paths_keep_authentication_aliases_and_reject_unknown_routes(self):
        for path in learning_attempt_http.LEARNING_ATTEMPT_PATHS:
            with self.subTest(path=path):
                self.assertEqual(self.client.req('POST', path, {})[0], 401)
        aid = self.work()
        for path in ('/api/assignments', '/api/asg/state', '/api/exams'):
            self.assertEqual(self.client.req('GET', path + f'?id={aid}', token=self.token)[0], 200)
            self.assertEqual(self.client.req('POST', path, {'id': aid}, self.token)[0], 200)
        for route in ('start', 'away', 'answer', 'finish'):
            self.assertEqual(self.client.req('GET', f'/api/asg/{route}?id={aid}', token=self.token)[0], 405)
        for route in ('start', 'save', 'finish'):
            self.assertEqual(self.client.req('GET', '/api/exam/' + route, token=self.token)[0], 404)
        for path in ('/api/asg/future', '/api/exam/future'):
            self.assertEqual(self.client.req('POST', path, {'id': aid}, self.token)[0], 404)
        self.assertFalse(self.db.q('SELECT 1 FROM asg_runs WHERE asg_id=?', (aid,), one=True))


if __name__ == '__main__':
    unittest.main()
