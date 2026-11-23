"""HTTP ownership, admission and durable work results after handler extraction.

Accounts, classes, answers and commit failures in this suite are synthetic.
"""
import contextlib
import io
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import server
import test_server as fixtures


class TeacherWorkImportTest(unittest.TestCase):
    def test_import_has_no_server_or_filesystem_side_effects(self):
        root = str(Path(__file__).resolve().parent.parent)
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(
                [sys.executable, '-c', "import sys, teacher_work_http; assert 'server' not in sys.modules"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': root},
                text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '')
            self.assertEqual(list(Path(folder).iterdir()), [])


class TeacherWorkFixture:
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
        self.tid, self.cookie = self.teacher()
        self.other_tid, self.other_cookie = self.teacher()
        self.cid = self.request('POST', 'class/save', {'name': 'Свой класс'})[1]['id']
        self.other_cid = self.request('POST', 'class/save', {'name': 'Чужой класс'},
                                      cookie=self.other_cookie)[1]['id']
        self.sid = self.pupil(self.tid, self.cid)
        self.other_sid = self.pupil(self.other_tid, self.other_cid)
        self.aid = self.work(self.cid)
        self.other_aid = self.work(self.other_cid, cookie=self.other_cookie)

    def teacher(self):
        identity = secrets.token_hex(8)
        tid = self.db.x('''INSERT INTO teachers(name,login,invite,created,email,email_ok,moderation)
                           VALUES(?,?,?,?,?,1,'approved')''',
                        ('Учитель ' + identity, identity, identity, time.time(), identity + '@example.invalid'))
        token = secrets.token_urlsafe(24)
        self.db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)',
                  (token, time.time() + 3600, tid))
        return tid, 'egeadm=' + token

    def pupil(self, tid, cid):
        identity = secrets.token_hex(8)
        return self.db.x('''INSERT INTO students(name,name_key,token,created,teacher_id,class_id)
                            VALUES(?,?,?,?,?,?)''',
                         ('Ученик ' + identity, identity, secrets.token_urlsafe(24), time.time(), tid, cid))

    def request(self, method, path, data=None, *, cookie=True):
        if cookie is True:
            cookie = self.cookie
        return self.client.creq(method, '/api/admin/' + path, data, cookie=cookie or None)

    def work(self, cid, *, cookie=True, **extra):
        status, result, _ = self.request('POST', 'assignment/save',
            {'class_id': cid, 'title': 'Работа ' + str(cid), 'kind': 'self', 'tasks': ['b:5'], **extra}, cookie=cookie)
        self.assertEqual(status, 200, result)
        return result['id']

    def assignment(self, aid):
        return dict(self.db.q('SELECT * FROM assignments WHERE id=?', (aid,), one=True))

    @contextlib.contextmanager
    def failed_commit(self):
        db, connection = self.db, self.db.conn

        class FailNextOuterCommit:
            failed = False

            def __getattr__(self, name):
                return getattr(connection, name)

            def commit(self):
                if db._tx_depth and not self.failed:
                    self.failed = True
                    raise sqlite3.OperationalError('synthetic commit failure')
                return connection.commit()

        proxy = FailNextOuterCommit()
        with mock.patch.object(db, 'conn', proxy), mock.patch.object(server.Handler, 'log_error_safe'):
            yield proxy
        self.assertTrue(proxy.failed, 'The request never reached its durable commit')


class TeacherWorkBoundaryTest(TeacherWorkFixture, unittest.TestCase):
    def test_teacher_class_lists_are_scoped_for_both_read_aliases(self):
        for method in ('GET', 'POST'):
            for cookie, cid in ((self.cookie, self.cid), (self.other_cookie, self.other_cid)):
                with self.subTest(method=method, cid=cid):
                    status, result, _ = self.request(method, 'classes', cookie=cookie)
                    self.assertEqual(status, 200)
                    self.assertEqual([row['id'] for row in result['classes']], [cid])

    def test_foreign_class_reads_and_mutations_are_rejected(self):
        before = dict(self.db.q('SELECT * FROM classes WHERE id=?', (self.other_cid,), one=True))
        for path in ('class/stats', 'assignments', 'class/journal', 'class/digest'):
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', f'{path}?class_id={self.other_cid}')[0], 404)
        for path, data in (
            ('class/goal', {'id': self.other_cid, 'goal_tasks': 100}),
            ('class/save', {'id': self.other_cid, 'name': 'Изменён'}),
            ('class/delete', {'id': self.other_cid}),
            ('class/members', {'class_id': self.other_cid, 'students': [self.sid]}),
            ('class/weak', {'class_id': self.other_cid}),
            ('assignment/save', {'class_id': self.other_cid, 'title': 'Чужая', 'tasks': ['b:5']}),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.request('POST', path, data)[0], 404)
        self.assertEqual(dict(self.db.q('SELECT * FROM classes WHERE id=?', (self.other_cid,), one=True)), before)
        self.assertEqual(self.db.q('SELECT class_id FROM students WHERE id=?', (self.sid,), one=True)['class_id'], self.cid)

    def test_assignment_id_does_not_override_class_ownership(self):
        before = self.assignment(self.other_aid)
        for path in ('asg/tasks', 'asg/live', 'asg/archive'):
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', f'{path}?id={self.other_aid}')[0], 404)
        for path, data in (
            ('assignment/save', {'id': self.other_aid, 'class_id': self.cid,
                                 'title': 'Подмена класса', 'tasks': ['b:5']}),
            ('assignment/delete', {'id': self.other_aid}),
            ('asg/close', {'id': self.other_aid}),
            ('asg/close', {'id': self.other_aid, 'reopen': True}),
            ('batch/kind', {'class_id': self.cid, 'batch': f'one:{self.other_aid}', 'kind': 'practice'}),
            ('batch/due', {'class_id': self.cid, 'asg_id': self.other_aid, 'due': time.time() + 86400}),
        ):
            with self.subTest(path=path, data=data):
                self.assertEqual(self.request('POST', path, data)[0], 404)
        # Deletion remains idempotent, but a mismatching class cannot delete a row.
        self.assertEqual(self.request('POST', 'batch/delete',
            {'class_id': self.cid, 'batch': f'one:{self.other_aid}'})[0], 200)
        self.assertEqual(self.assignment(self.other_aid), before)

    def test_membership_move_filters_foreign_pupils(self):
        destination = self.request('POST', 'class/save', {'name': 'Новый свой класс'})[1]['id']
        status, result, _ = self.request('POST', 'class/members',
                                         {'class_id': destination, 'students': [self.sid, self.other_sid]})
        self.assertEqual(status, 200)
        self.assertEqual(result['moved'], 1)
        for sid, tid, cid in ((self.sid, self.tid, destination),
                              (self.other_sid, self.other_tid, self.other_cid)):
            row = self.db.q('SELECT teacher_id,class_id FROM students WHERE id=?', (sid,), one=True)
            self.assertEqual((row['teacher_id'], row['class_id']), (tid, cid))

    def test_admission_precedes_extracted_handlers_and_expired_writes(self):
        denied = (
            ('anonymous', None, 'approved', 1, 401),
            ('email', self.cookie, 'approved', 0, 403),
            ('pending', self.cookie, 'pending', 1, 403),
            ('rejected', self.cookie, 'rejected', 1, 403),
        )
        with mock.patch.object(server.Handler, 'teacher_work_services', side_effect=AssertionError('gate bypass')):
            for label, cookie, moderation, email_ok, expected in denied:
                self.db.x('UPDATE teachers SET moderation=?,email_ok=? WHERE id=?', (moderation, email_ok, self.tid))
                for method, path, data in (
                    ('GET', 'classes', None),
                    ('POST', 'assignment/save', {'class_id': self.cid, 'title': 'Не выдана', 'tasks': ['b:5']}),
                ):
                    with self.subTest(state=label, path=path):
                        self.assertEqual(self.request(method, path, data, cookie=cookie)[0], expected)
            self.db.x("UPDATE teachers SET moderation='approved',email_ok=1,until=? WHERE id=?", (time.time() - 1, self.tid))
            self.assertEqual(self.request('POST', 'assignment/delete', {'id': self.aid})[0], 402)
        self.assertEqual(self.request('GET', 'classes')[0], 200)
        self.assertEqual(self.assignment(self.aid)['class_id'], self.cid)

    def test_get_cannot_execute_write_routes_and_preserves_method_errors(self):
        before = self.assignment(self.aid)
        for path in ('class/goal', 'class/save', 'class/delete', 'class/members', 'class/weak',
                     'batch/kind', 'batch/due', 'batch/delete', 'assignment/save', 'assignment/delete'):
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', f'{path}?id={self.aid}&class_id={self.cid}')[0], 404)
        self.assertEqual(self.request('GET', f'asg/close?id={self.aid}')[0], 405)
        self.assertEqual(self.assignment(self.aid), before)
        self.assertTrue(self.db.q('SELECT 1 FROM classes WHERE id=?', (self.cid,), one=True))

    def test_assignment_creation_does_not_acknowledge_failed_commit(self):
        before = self.db.q('SELECT COUNT(*) n FROM assignments WHERE class_id=?', (self.cid,), one=True)['n']
        with self.failed_commit():
            status, result, _ = self.request('POST', 'assignment/save',
                {'class_id': self.cid, 'title': 'Не сохранена', 'tasks': ['b:5']})
            self.assertEqual(status, 500)
            self.assertNotEqual(result.get('ok'), True)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM assignments WHERE class_id=?', (self.cid,), one=True)['n'], before)
        self.work(self.cid)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM assignments WHERE class_id=?', (self.cid,), one=True)['n'], before + 1)

    def test_weak_work_batch_is_all_or_nothing_and_can_be_retried(self):
        second = self.pupil(self.tid, self.cid)
        for sid in (self.sid, second):
            for _ in range(2):
                self.db.x('INSERT INTO attempts(student_id,ts,task_id,n,score) VALUES(?,?,?,?,0)',
                          (sid, time.time(), 'b:5', 5))
        before = [row['id'] for row in self.db.q('SELECT id FROM assignments WHERE class_id=? ORDER BY id', (self.cid,))]
        real_write, inserted = self.db.x, 0

        def fail_second_assignment(sql, args=()):
            nonlocal inserted
            if sql.lstrip().upper().startswith('INSERT INTO ASSIGNMENTS'):
                inserted += 1
                if inserted == 2:
                    raise sqlite3.OperationalError('synthetic second pupil insert failure')
            return real_write(sql, args)

        with mock.patch.object(self.db, 'x', side_effect=fail_second_assignment), \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.request('POST', 'class/weak', {'class_id': self.cid})[0], 500)
        self.assertEqual(inserted, 2)
        self.assertEqual([row['id'] for row in self.db.q('SELECT id FROM assignments WHERE class_id=? ORDER BY id', (self.cid,))], before)
        status, result, _ = self.request('POST', 'class/weak', {'class_id': self.cid})
        self.assertEqual(status, 200, result)
        self.assertEqual(result['made'], 2)
        rows = self.db.q('SELECT id,student_id FROM assignments WHERE class_id=? AND student_id IS NOT NULL', (self.cid,))
        self.assertEqual(len(rows), 2)
        self.assertEqual({row['student_id'] for row in rows}, {self.sid, second})

    def test_forced_finish_rolls_back_grade_and_attempt_then_retry_is_visible_in_journal(self):
        token = server.session_new(self.db, self.sid, '127.0.0.1', 'Synthetic boundary fixture', False)
        for path, data in (('start', {}), ('answer', {'task': server.APP.bank.pid('b:5'), 'answer': '12'})):
            status, result = self.client.req('POST', '/api/asg/' + path, {'id': self.aid, **data}, token)
            self.assertEqual(status, 200, result)
        before = dict(self.db.q('SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?', (self.aid, self.sid), one=True))
        update = {'id': self.aid, 'class_id': self.cid, 'title': 'Завершённая', 'tasks': ['b:5'], 'kind': 'practice'}
        with self.failed_commit():
            self.assertEqual(self.request('POST', 'assignment/save', update)[0], 500)
        self.assertEqual(dict(self.db.q('SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?', (self.aid, self.sid), one=True)), before)
        self.assertEqual(self.assignment(self.aid)['kind'], 'self')
        self.assertFalse(self.db.q('SELECT 1 FROM attempts WHERE student_id=?', (self.sid,), one=True))
        status, result, _ = self.request('POST', 'assignment/save', update)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['ended'], 1)
        run = self.db.q('SELECT finished,grade,pct FROM asg_runs WHERE asg_id=? AND student_id=?', (self.aid, self.sid), one=True)
        self.assertTrue(run['finished'])
        self.assertEqual((run['grade'], run['pct']), (5, 100))
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM attempts WHERE student_id=?', (self.sid,), one=True)['n'], 1)
        status, journal, _ = self.request('GET', f'class/journal?class_id={self.cid}')
        self.assertEqual(status, 200)
        pupil = next(row for row in journal['students'] if row['id'] == self.sid)
        self.assertEqual(pupil['cells'][str(self.aid)]['grade'], 5)

    def test_class_deletion_rolls_back_pupils_work_and_run_on_commit_failure(self):
        self.db.x('INSERT INTO asg_runs(asg_id,student_id,started,answers) VALUES(?,?,?,?)',
                  (self.aid, self.sid, time.time(), '{}'))
        self.db.x('INSERT INTO asg_events(asg_id,student_id,ts,kind) VALUES(?,?,?,?)',
                  (self.aid, self.sid, time.time(), 'start'))
        with self.failed_commit():
            self.assertEqual(self.request('POST', 'class/delete', {'id': self.cid})[0], 500)
        self.assertTrue(self.db.q('SELECT 1 FROM classes WHERE id=?', (self.cid,), one=True))
        self.assertEqual(self.db.q('SELECT class_id FROM students WHERE id=?', (self.sid,), one=True)['class_id'], self.cid)
        self.assertEqual(self.assignment(self.aid)['class_id'], self.cid)
        self.assertTrue(self.db.q('SELECT 1 FROM asg_runs WHERE asg_id=?', (self.aid,), one=True))
        self.assertTrue(self.db.q('SELECT 1 FROM asg_events WHERE asg_id=?', (self.aid,), one=True))
        self.assertEqual(self.request('POST', 'class/delete', {'id': self.cid})[0], 200)
        self.assertFalse(self.db.q('SELECT 1 FROM asg_runs WHERE asg_id=?', (self.aid,), one=True))
        self.assertFalse(self.db.q('SELECT 1 FROM asg_events WHERE asg_id=?', (self.aid,), one=True))


if __name__ == '__main__':
    unittest.main()
