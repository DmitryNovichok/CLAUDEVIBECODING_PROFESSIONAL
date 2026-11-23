"""Course/laboratory HTTP ownership, access, replay and durable progress checks."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import api_access
from auth import hash_pw
import buglab
import learning_progress_http
from learning_access import set_learning_passwords
import server
import test_server as fixtures

ROOT = Path(__file__).resolve().parent.parent


class LearningProgressModuleTest(unittest.TestCase):
    def test_import_has_no_server_or_storage_side_effects(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, '-c',
                "import sys, learning_progress_http; assert 'server' not in sys.modules"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': str(ROOT)},
                capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_exact_policy_and_independent_verifier_transaction_exception(self):
        for path in learning_progress_http.LEARNING_PROGRESS_PATHS:
            if path == '/api/course/coverage':
                self.assertEqual(api_access.ROUTES['GET', path], api_access.Access.PUBLIC)
            elif path == '/api/lab/activity':
                self.assertEqual(api_access.ROUTES['POST', path], api_access.Access.STUDENT)
                self.assertNotIn(('GET', path), api_access.ROUTES)
            else:
                for method in ('GET', 'POST'):
                    self.assertEqual(api_access.ROUTES[method, path], api_access.Access.STUDENT)
        self.assertNotIn('/api/lab/bugs/verify', learning_progress_http.LEARNING_PROGRESS_WRITES)
        self.assertLessEqual(learning_progress_http.LEARNING_PROGRESS_WRITES,
                             learning_progress_http.LEARNING_PROGRESS_PATHS)


class LearningProgressBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()
        (fixtures.ServerTest.tmp / 'pycourse').mkdir()
        for name in ('index.json', 'm01.json'):
            (fixtures.ServerTest.tmp / 'pycourse' / name).write_bytes((ROOT / 'pycourse' / name).read_bytes())

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        suffix = secrets.token_hex(6).translate(str.maketrans('0123456789', 'abcdefghij'))
        with contextlib.redirect_stdout(io.StringIO()):
            self.token = self.client.login('Курсов ' + suffix)
            self.other = self.client.login('Другов ' + suffix)
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        self.other_sid = self.client.req('GET', '/api/me', token=self.other)[1]['sid']
        self.password = 'synthetic-course-pass'
        set_learning_passwords(self.db.conn, self.password)
        self.db.setting('ard_pw', hash_pw('separate-arduino-pass'))
        for bucket in (server._COURSE_TRIES, server._PYC_PW_TRIES, server._LAB_PW_TRIES,
                       server._PYC_TRIES, server._BUG_TRIES):
            bucket.clear()

    def req(self, path, body=None, token=None):
        return self.client.req('GET' if body is None else 'POST', path, body, token or self.token)

    def unlock(self, section):
        password = 'separate-arduino-pass' if section == 'arduino' else self.password
        status, body = self.req('/api/' + section + '/unlock', {'password': password})
        self.assertEqual(status, 200, body)

    def row(self, table, sid=None):
        row = self.db.q('SELECT * FROM ' + table + ' WHERE student_id=?',
                        (self.sid if sid is None else sid,), one=True)
        return dict(row) if row else None

    def test_teacher_learning_sections_scope_and_lab_counts(self):
        activity = '/api/lab/activity'
        report = '/api/admin/lab/stats'
        self.assertEqual(self.req(activity, {'section': 'code'})[0], 403)
        self.unlock('lab')
        self.assertEqual(self.req(activity, {'section': 'model', 'model': []})[0], 400)
        for model in ('net', 'net', 'logic'):
            self.assertEqual(self.req(activity, {'section': 'model', 'model': model, 'student_id': self.other_sid})[0], 200)
        self.assertEqual(self.req(activity, {'section': 'code'})[0], 200)
        teacher = {'name': 'Учитель статистики', 'login': 'labstats', 'password': 'test-secret1', 'invite': 'LABSTATS'}
        status, created = self.client.admin('POST', '/api/admin/teacher/save', teacher)
        self.assertEqual(status, 200, created)
        self.client.approve_fixture_teacher(created['id'])
        status, _, cookie = self.client.teacher_req('', 'POST', '/api/admin/login', teacher)
        self.assertEqual(status, 200)
        self.db.x('UPDATE students SET teacher_id=? WHERE id=?', (created['id'], self.sid))
        self.db.x('UPDATE students SET course=1,lab=1 WHERE id IN (?,?)', (self.sid, self.other_sid))
        # Исторические самопроверки и независимая проверка имеют разное происхождение.
        for case, verified in zip(buglab.CASES, (0, 1)):
            self.db.x('INSERT INTO buglab(student_id,case_id,ok,verified) VALUES(?,?,1,?)',
                      (self.sid, case['id'], verified))
        cookie = cookie.split(';')[0]
        def teacher_get(url):
            status, details, _ = self.client.teacher_req(cookie, 'GET', url)
            self.assertEqual(status, 200, details)
            return details['students']
        rows = teacher_get(report)
        self.assertEqual([r['id'] for r in rows], [self.sid])
        row = rows[0]
        self.assertEqual((row['models'], row['bugs'], row['bugs_ok'], row['bugs_verified']), (2, 2, 2, 1))
        self.assertGreaterEqual(row['code_last'], row['models_last'])
        self.assertNotIn(self.sid, [r['id'] for r in self.client.admin('GET', report)[1]['students']])
        self.assertEqual([r['id'] for r in teacher_get('/api/admin/course/progress')], [self.sid])
        self.assertEqual(teacher_get('/api/admin/course/progress?id=' + str(self.other_sid)), [])

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
                    raise sqlite3.OperationalError('synthetic learning commit failure')
                return real.commit()
        proxy = FailingConnection()
        with mock.patch.object(db, 'conn', proxy), mock.patch.object(server.Handler, 'log_error_safe'):
            yield
        self.assertTrue(proxy.failed)

    def test_public_inventory_and_anonymous_boundaries(self):
        self.assertEqual(self.client.req('GET', '/api/course/coverage')[0], 200)
        for path in sorted(learning_progress_http.LEARNING_PROGRESS_PATHS - {'/api/course/coverage'}):
            with self.subTest(path=path):
                self.assertEqual(self.client.req('GET', path)[0], 405 if path == '/api/lab/activity' else 401)
                self.assertEqual(self.client.req('POST', path, {})[0], 401)

    def test_closed_course_cannot_record_progress_or_read_materials(self):
        for path in ('/api/course/lesson?n=5', '/api/course/sets'):
            self.assertEqual(self.req(path)[0], 403)
        self.assertEqual(self.req('/api/course/seen', {'n': 5, 'slide': 1, 'total': 10})[0], 403)
        self.assertIsNone(self.row('course_seen'))
        self.assertFalse(self.req('/api/pyc')[1]['access'])
        self.assertEqual(self.req('/api/pyc/level?m=m01&l=0')[0], 403)
        self.assertEqual(self.req('/api/pyc/check', {'task': 'm01.print_sum', 'answer': '10'})[0], 403)
        self.assertEqual(self.req('/api/pyc/help', {'task': 'm01.print_sum', 'kind': 'hint'})[0], 403)
        self.assertEqual(self.req('/api/lab/bugs')[0], 403)

    def test_seen_is_scoped_monotone_and_rechecks_revoked_access(self):
        self.unlock('course')
        for slide in (7, 3, 7):
            self.assertEqual(self.req('/api/course/seen', {'n': 5, 'slide': slide, 'total': 10,
                'sid': self.other_sid, 'student_id': self.other_sid})[0], 200)
        self.assertEqual(self.row('course_seen')['slide'], 7)
        self.assertIsNone(self.row('course_seen', self.other_sid))
        before = self.row('course_seen')
        for fields in ({'n': 99, 'slide': 1, 'total': 10}, {'n': 5, 'slide': 0, 'total': 10},
                       {'n': 5, 'slide': 11, 'total': 10}, {'n': 5, 'slide': 1, 'total': 201},
                       {'n': [], 'slide': {}, 'total': None}):
            self.assertEqual(self.req('/api/course/seen', fields)[0], 400)
        self.assertEqual(self.row('course_seen'), before)
        self.db.setting('course_pw', '')
        self.assertEqual(self.req('/api/course/seen', {'n': 5, 'slide': 9, 'total': 10})[0], 403)
        self.assertEqual(self.row('course_seen'), before)

    def test_unlocks_are_separate_idempotent_and_account_scoped(self):
        for section, column in (('course', 'course'), ('pyc', 'pyc'), ('lab', 'lab'), ('arduino', 'ard')):
            with self.subTest(section=section):
                self.assertEqual(self.req('/api/' + section + '/unlock', {'password': 'wrong'})[0], 403)
                self.unlock(section)
                before = dict(self.db.q('SELECT * FROM students WHERE id=?', (self.sid,), one=True))
                # Already admitted: no extra grant, timestamp or ownership change.
                self.assertEqual(self.req('/api/' + section + '/unlock',
                    {'password': 'wrong', 'sid': self.other_sid})[0], 200)
                after = dict(self.db.q('SELECT * FROM students WHERE id=?', (self.sid,), one=True))
                self.assertEqual(after[column], 1)
                for field in ('course_ts', 'pyc_ts'):
                    self.assertEqual(after[field], before[field])
                self.assertEqual(self.db.q('SELECT ' + column + ' AS granted FROM students WHERE id=?',
                                          (self.other_sid,), one=True)['granted'], 0)
        self.assertEqual(self.req('/api/arduino/unlock', {'password': self.password}, self.other)[0], 403)

    def test_other_devices_receive_only_their_accounts_committed_unlocks(self):
        name = self.req('/api/me')[1]['name']
        def login_again():
            status, payload = self.client.req('POST', '/api/login',
                                              {'mode': 'login', 'name': name, 'password': 'secret1'})
            self.assertEqual(status, 200)
            self.assertEqual(payload['sid'], self.sid)
            return payload

        already_open = login_again()['token']
        self.assertNotEqual(already_open, self.token)
        self.db.setting('im_pw', hash_pw('separate-im-pass'))
        sections = [('course', 'course', self.password), ('pyc', 'pyc', self.password),
                    ('lab', 'lab', self.password), ('arduino', 'ard', 'separate-arduino-pass'),
                    ('im', 'im', 'separate-im-pass')]
        columns = [column for _, column, _ in sections]
        received = []
        def notified(sids, topic):
            if topic == 'pyc':
                # A separate SQLite reader sees only durable grants.
                with contextlib.closing(sqlite3.connect(server.DB_PATH)) as reader:
                    grants = reader.execute('SELECT course, pyc, lab, ard, im FROM students WHERE id=?',
                                            (self.sid,)).fetchone()
                received.append((sids, tuple(map(bool, grants))))

        with mock.patch.object(server.LIVE, 'send', side_effect=notified):
            with self.fail_next_commit():
                self.assertEqual(self.req('/api/lab/unlock', {'password': self.password})[0], 500)
            self.assertFalse(self.req('/api/me', token=already_open)[1]['lab'])
            self.assertFalse(received)
            for i, (section, _, password) in enumerate(sections):
                path = '/api/' + section + '/unlock'
                self.assertEqual(self.req(path, {'password': 'wrong'})[0], 403)
                self.assertEqual(self.req(path, {'password': password})[0], 200)
                self.assertEqual(self.req(path, {}, already_open)[0], 200)
                expected = tuple(j <= i for j in range(len(sections)))
                self.assertEqual(len(received), i + 1)
                self.assertEqual(received[-1], ([self.sid], expected))
                me = self.req('/api/me', token=already_open)[1]
                self.assertEqual(tuple(me[col] for col in columns), expected)
        fresh = login_again()
        self.assertNotIn(fresh['token'], (already_open, self.token))
        self.assertTrue(all(fresh[col] for col in columns))
        other = self.req('/api/me', token=self.other)[1]
        self.assertFalse(any(other[col] for col in columns))

    def test_python_level_disclosure_and_repeated_completion(self):
        self.unlock('pyc')
        status, level = self.req('/api/pyc/level?m=m01&l=0')
        self.assertEqual(status, 200)
        for task in level['level']['tasks']:
            self.assertNotIn('ans', task)
            self.assertNotIn('sol', task)
        self.assertEqual(self.req('/api/pyc/level?m=m01&l=1')[0], 403)
        self.assertEqual(self.req('/api/pyc/help', {'task': 'm01.print_sum', 'kind': 'solution'})[0], 403)
        def submit(_):
            return self.req('/api/pyc/check', {'task': 'm01.print_sum', 'answer': '10',
                'sid': self.other_sid, 'star': 999, 'independent': 1})
        with ThreadPoolExecutor(4) as pool:
            results = list(pool.map(submit, range(4)))
        self.assertTrue(all(status == 200 and result['ok'] for status, result in results))
        self.assertEqual(sum(bool(result.get('already')) for _, result in results), 3)
        row = self.row('pyc_progress')
        self.assertEqual((row['ok'], row['tries'], row['independent']), (1, 1, 1))
        self.assertIsNone(self.row('pyc_progress', self.other_sid))
        self.assertEqual(self.req('/api/pyc/check', {'task': 'm01.print_sum', 'answer': '-1'})[0], 200)
        self.assertEqual(self.row('pyc_progress'), row)

    def test_hint_prevents_independent_credit_and_does_not_leak_to_other_student(self):
        self.unlock('pyc')
        self.req('/api/pyc/help', {'task': 'm01.print_sum', 'kind': 'hint', 'sid': self.other_sid})
        self.req('/api/pyc/check', {'task': 'm01.print_sum', 'answer': '10', 'independent': True})
        self.assertEqual((self.row('pyc_progress')['ok'], self.row('pyc_progress')['independent']), (1, 0))
        self.assertIsNone(self.row('pyc_progress', self.other_sid))
        self.req('/api/pyc/unlock', {'password': self.password}, self.other)
        self.assertEqual(self.req('/api/pyc', token=self.other)[1]['progress'], {})

    def test_arduino_progress_validation_ownership_and_idempotency(self):
        tracks = {'junior': [['led', 'Светодиод', True, True, True]]}
        self.assertEqual(self.req('/api/arduino/progress', {'tracks': tracks})[1], {'ok': True, 'skipped': True})
        self.assertIsNone(self.row('arduino_progress'))
        self.unlock('arduino')
        self.assertEqual(self.req('/api/arduino/progress', {'tracks': tracks, 'sid': self.other_sid})[0], 200)
        before = self.row('arduino_progress')
        self.assertEqual((before['junior'], before['senior'], before['steps']), (1, 0, 3))
        self.assertEqual(self.req('/api/arduino/progress', {'tracks': tracks})[0], 200)
        self.assertEqual(self.row('arduino_progress'), before)
        self.assertIsNone(self.row('arduino_progress', self.other_sid))
        for tracks in (None, [], {'junior': 'bad'}, {'junior': [['../secret', '', 1, 1, 1]]}):
            self.assertEqual(self.req('/api/arduino/progress', {'tracks': tracks})[0], 400)
        self.assertEqual(self.row('arduino_progress'), before)
        self.db.x('UPDATE students SET is_teacher=1 WHERE id=?', (self.sid,))
        self.assertEqual(self.req('/api/arduino/progress', {'tracks': {}})[1], {'ok': True, 'skipped': True})
        self.assertEqual(self.row('arduino_progress'), before)

    def test_failed_commits_never_acknowledge_or_persist_short_progress_writes(self):
        # A real SQLite transaction reaches commit after the handler prepared a
        # successful response; the HTTP client must still receive an error.
        for section, column in (('course', 'course'), ('pyc', 'pyc'), ('lab', 'lab'), ('arduino', 'ard')):
            password = 'separate-arduino-pass' if section == 'arduino' else self.password
            with self.subTest(unlock=section), self.fail_next_commit():
                self.assertEqual(self.req('/api/' + section + '/unlock', {'password': password})[0], 500)
            self.assertEqual(self.db.q('SELECT ' + column + ' AS granted FROM students WHERE id=?',
                                      (self.sid,), one=True)['granted'], 0)
            self.unlock(section)
        case = buglab.BY_ID['even-sum']
        operations = [
            ('/api/course/seen', {'n': 5, 'slide': 1, 'total': 10}, 'course_seen'),
            ('/api/pyc/help', {'task': 'm01.print_sum', 'kind': 'hint'}, 'pyc_progress'),
            ('/api/pyc/check', {'task': 'm01.print_sum', 'answer': '10'}, 'pyc_progress'),
            ('/api/arduino/progress', {'tracks': {'junior': [['led', 'LED', 1, 1, 1]]}}, 'arduino_progress'),
            ('/api/lab/bugs/check', {'id': case['id'], 'code': case['ref'],
                                   'runs': [{'out': x} for x in case['expected']]}, 'buglab'),
        ]
        for path, payload, table in operations:
            with self.subTest(path=path), self.fail_next_commit():
                self.assertEqual(self.req(path, payload)[0], 500)
            self.assertIsNone(self.row(table))

    def test_note_and_explanation_commit_failures_preserve_existing_values(self):
        self.db.x('INSERT INTO attempts(student_id,task_id,n,score,ts,answers) VALUES(?,?,?,?,?,?)',
                  (self.sid, 'b:5', 5, 0, time.time(), '["0"]'))
        public = server.APP.bank.pid('b:5')
        self.assertEqual(self.req('/api/learning/mistake', {'task': public, 'reason': 'logic'})[0], 200)
        note = self.row('learning_mistakes')
        with self.fail_next_commit():
            self.assertEqual(self.req('/api/learning/mistake', {'task': public, 'reason': 'attention'})[0], 500)
        self.assertEqual(self.row('learning_mistakes'), note)
        self.assertIsNone(self.row('learning_mistakes', self.other_sid))
        self.unlock('lab')
        case = buglab.BY_ID['even-sum']
        for _ in range(3):
            self.assertEqual(self.req('/api/lab/bugs/check', {'id': case['id'], 'runs': []})[0], 200)
        progress = self.row('buglab')
        self.assertEqual((progress['tries'], progress['seen']), (3, 0))
        with self.fail_next_commit():
            self.assertEqual(self.req('/api/lab/bugs/explain', {'id': case['id']})[0], 500)
        self.assertEqual(self.row('buglab'), progress)
        self.assertEqual(self.req('/api/lab/bugs/explain', {'id': case['id']})[0], 200)
        self.assertEqual(self.row('buglab')['seen'], 1)

    def test_client_buglab_outputs_do_not_grant_verified_star_or_other_progress(self):
        self.unlock('lab')
        case = buglab.BY_ID['even-sum']
        payload = {'id': case['id'], 'code': case['ref'], 'runs': [{'out': x} for x in case['expected']],
                   'sid': self.other_sid, 'star': 1, 'verified': True}
        for _ in range(2):
            status, result = self.req('/api/lab/bugs/check', payload)
            self.assertEqual(status, 200)
            self.assertTrue(result['ok'])
            self.assertFalse(result['verified'])
            self.assertEqual((result['my']['verified'], result['my']['star']), (False, 0))
        self.assertEqual(self.row('buglab')['tries'], 0)
        self.assertIsNone(self.row('buglab', self.other_sid))


if __name__ == '__main__':
    unittest.main()
