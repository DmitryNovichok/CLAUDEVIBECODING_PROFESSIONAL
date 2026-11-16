"""Roster/account HTTP boundaries with independent synthetic teachers and pupils."""
import contextlib
import io
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
import server
import teacher_students_http
import test_server as fixtures


class TeacherStudentsImportTest(unittest.TestCase):
    def test_module_import_has_no_server_or_filesystem_side_effects(self):
        root = str(Path(__file__).resolve().parent.parent)
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, '-c',
                "import sys, teacher_students_http; assert 'server' not in sys.modules"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': root}, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(folder).iterdir()), [])
        for path in teacher_students_http.TEACHER_STUDENTS_PATHS:
            self.assertEqual(api_access.ROUTES[('GET', path)], api_access.Access.TEACHER)
            self.assertEqual(api_access.ROUTES[('POST', path)], api_access.Access.TEACHER)


class TeacherStudentsHTTPTest(unittest.TestCase):
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
        self.key = secrets.token_hex(5).translate(str.maketrans('0123456789', 'abcdefghij'))
        self.tid = self.teacher('own')
        self.other_tid = self.teacher('other')
        token = secrets.token_urlsafe(24)
        self.cookie = 'egeadm=' + token
        self.db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)',
                  (token, time.time() + 3600, self.tid))
        self.cid = self.db.x('INSERT INTO classes(name,teacher_id,created) VALUES(?,?,?)',
                             ('Свой класс', self.tid, time.time()))
        self.other_cid = self.db.x('INSERT INTO classes(name,teacher_id,created) VALUES(?,?,?)',
                                   ('Чужой класс', self.other_tid, time.time()))
        self.sid = self.pupil('Первый', self.tid, self.cid)
        self.peer = self.pupil('Второй', self.tid, self.cid)
        self.foreign = self.pupil('Чужой', self.other_tid, self.other_cid)
        self.session = server.session_new(self.db, self.sid, '198.51.100.23', 'synthetic', False)
        self.other_session = server.session_new(self.db, self.foreign, '198.51.100.23', 'synthetic', False)

    def teacher(self, suffix):
        login = self.key + suffix
        return self.db.x('''INSERT INTO teachers(name,login,invite,created,email,email_ok,moderation)
                            VALUES(?,?,?,?,?,1,'approved')''',
                         ('Учитель ' + login, login, login, time.time(), login + '@example.invalid'))

    def pupil(self, name, tid, cid):
        name = 'Ученик ' + name + self.key
        pretty, key = server.norm_name(name)
        return self.db.x('''INSERT INTO students(name,name_key,token,created,last_seen,last_ip,pw,teacher_id,class_id,login)
                            VALUES(?,?,?,?,?,?,?,?,?,?)''',
                         (pretty, key, secrets.token_urlsafe(24), time.time(), time.time(),
                          '198.51.100.23', server.hash_pw('synthetic-pupil-password'), tid, cid, key.replace(' ', '-')))

    def row(self, sid):
        return self.db.q('SELECT * FROM students WHERE id=?', (sid,), one=True)

    def call(self, method, path, data=None, *, cookie=True):
        return self.client.creq(method, '/api/admin/' + path, data, cookie=self.cookie if cookie else None)

    def test_shared_school_ip_never_exposes_another_teachers_pupil(self):
        teacher_pupil = self.pupil('Аккаунтучителя', self.tid, self.cid)
        self.db.x('UPDATE students SET is_teacher=1 WHERE id=?', (teacher_pupil,))
        status, result, _ = self.call('GET', 'student?id=' + str(self.sid))
        self.assertEqual(status, 200, result)
        self.assertEqual(result['same_ip'], [self.row(self.peer)['name']])
        self.assertNotIn(self.row(self.foreign)['name'], str(result))
        self.assertNotIn(self.row(teacher_pupil)['name'], str(result))
        self.assertEqual(result['student']['id'], self.sid)

    def test_roster_csv_and_parent_links_remain_teacher_scoped(self):
        for sid in (self.sid, self.foreign):
            self.db.x('''INSERT INTO attempts(student_id,ts,task_id,n,bank,score,answers)
                         VALUES(?,?,'b:5',5,'b',1,'["12"]')''', (sid, time.time()))
        status, result, _ = self.call('GET', 'students')
        self.assertEqual(status, 200)
        self.assertEqual({r['id'] for r in result['students']}, {self.sid, self.peer})
        status, text, _ = self.call('GET', 'export.csv')
        self.assertEqual(status, 200)
        self.assertTrue(text.startswith('\ufeffУченик;Дата;Время;'))
        self.assertIn(self.row(self.sid)['name'], text)
        self.assertNotIn(self.row(self.foreign)['name'], text)
        status, filtered, _ = self.call('GET', 'export.csv?student=' + str(self.foreign))
        self.assertEqual(status, 200)
        self.assertNotIn(self.row(self.foreign)['name'], filtered)
        self.assertEqual(self.call('GET', 'class/parents?class_id=' + str(self.other_cid))[0], 404)
        self.assertIsNone(self.row(self.foreign)['parent_token'])
        status, links, _ = self.call('GET', 'class/parents?class_id=' + str(self.cid))
        self.assertEqual(status, 200)
        self.assertEqual({r['id'] for r in links['students']}, {self.sid, self.peer})
        self.assertTrue(all(r['token'] for r in links['students']))

    def test_foreign_records_and_mutations_are_denied_without_changes(self):
        before = dict(self.row(self.foreign))
        self.db.x("INSERT INTO solutions(student_id,task_id,code,ts) VALUES(?,'b:5','foreign solution',?)",
                  (self.foreign, time.time()))
        for method, path, data in (
            ('GET', 'student?id=' + str(self.foreign), None),
            ('GET', 'solution?student=' + str(self.foreign) + '&task=b:5', None),
            ('POST', 'student/rename', {'name': 'Изменённая Фамилия'}),
            ('POST', 'student/password-reset', {}),
            ('POST', 'student/newpw', {}),
            ('POST', 'student/logout', {}),
            ('POST', 'student/norank', {'on': True}),
            ('POST', 'student/fire', {'days': 20}),
            ('POST', 'student/parent', {'new': True, 'email': 'changed@example.invalid'}),
            ('POST', 'student/void', {'from': time.time() - 60, 'to': time.time()}),
            ('POST', 'student/void-undo', {'batch': 'absent'}),
            ('POST', 'student/delete', {}),
        ):
            with self.subTest(path=path):
                body = dict(data, id=self.foreign) if data is not None else None
                self.assertEqual(self.call(method, path, body)[0], 404)
        self.assertEqual(dict(self.row(self.foreign)), before)
        self.assertEqual(self.client.req('GET', '/api/me', token=self.other_session)[0], 200)

    def test_account_reset_revokes_all_old_tokens_and_preserves_other_pupils(self):
        for route in ('student/newpw', 'student/password-reset'):
            with self.subTest(route=route):
                token = server.session_new(self.db, self.sid, '198.51.100.23', 'synthetic', False)
                old_token = self.row(self.sid)['token']
                before_foreign = self.row(self.foreign)['pw']
                status, result, _ = self.call('POST', route, {'id': self.sid})
                self.assertEqual(status, 200, result)
                self.assertEqual(self.client.req('GET', '/api/me', token=token)[0], 401)
                self.assertNotEqual(self.row(self.sid)['token'], old_token)
                if route.endswith('newpw'):
                    self.assertTrue(server.check_pw(result['password'], self.row(self.sid)['pw']))
                else:
                    self.assertIsNone(self.row(self.sid)['pw'])
                self.assertEqual(self.row(self.foreign)['pw'], before_foreign)
                self.assertEqual(self.client.req('GET', '/api/me', token=self.other_session)[0], 200)

    def test_import_keeps_foreign_names_and_validates_class_before_writes(self):
        before = self.db.q('SELECT COUNT(*) n FROM students', one=True)['n']
        self.assertEqual(self.call('POST', 'class/import',
            {'class_id': self.other_cid, 'names': ['Новый Ученик' + self.key]})[0], 404)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM students', one=True)['n'], before)
        self.db.x('UPDATE students SET class_id=NULL WHERE id=?', (self.peer,))
        names = [self.row(self.foreign)['name'], self.row(self.peer)['name'],
                 'Новый Ученик' + self.key, 'Новый Ученик' + self.key, '123']
        status, result, _ = self.call('POST', 'class/import', {'class_id': self.cid, 'names': names})
        self.assertEqual(status, 200, result)
        self.assertEqual([r['status'] for r in result['rows']], ['taken', 'mine', 'new', 'bad'])
        self.assertNotIn('password', result['rows'][0])
        self.assertNotIn('id', result['rows'][0])
        self.assertEqual(self.row(self.foreign)['class_id'], self.other_cid)
        self.assertEqual(self.row(self.peer)['class_id'], self.cid)
        self.assertTrue(server.check_pw(result['rows'][2]['password'], self.row(result['rows'][2]['id'])['pw']))

    def test_role_and_transfer_are_principal_only_and_bad_input_does_not_mutate(self):
        before = dict(self.row(self.sid))
        self.assertEqual(self.call('POST', 'student/role', {'id': self.sid, 'admin': True})[0], 403)
        self.assertEqual(self.call('POST', 'student/teacher', {'id': self.sid, 'teacher_id': self.other_tid})[0], 403)
        self.assertEqual(self.call('POST', 'student/rename', {'id': self.sid, 'name': '123'})[0], 400)
        self.assertEqual(self.call('POST', 'student/parent', {'id': self.sid, 'email': 'bad', 'new': True})[0], 400)
        self.assertEqual(self.call('GET', 'student/delete?id=' + str(self.sid))[0], 404)
        self.assertEqual(dict(self.row(self.sid)), before)

    def test_commit_failure_cannot_confirm_or_partially_reset_password(self):
        before = dict(self.row(self.sid))
        transaction = self.db.transaction
        @contextlib.contextmanager
        def failed_commit():
            with transaction():
                yield
                raise sqlite3.OperationalError('synthetic commit failure')
        with mock.patch.object(self.db, 'transaction', failed_commit), \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.call('POST', 'student/newpw', {'id': self.sid})[0], 500)
        self.assertEqual(dict(self.row(self.sid)), before)
        self.assertEqual(self.client.req('GET', '/api/me', token=self.session)[0], 200)

    def test_common_teacher_gates_still_precede_the_extracted_handlers(self):
        self.assertEqual(self.call('GET', 'students', cookie=False)[0], 401)
        self.db.x("UPDATE teachers SET moderation='pending' WHERE id=?", (self.tid,))
        self.assertEqual(self.call('GET', 'students')[0], 403)
        self.assertEqual(self.call('POST', 'student/newpw', {'id': self.sid})[0], 403)
        self.db.x("UPDATE teachers SET moderation='approved', until=? WHERE id=?", (time.time() - 1, self.tid))
        self.assertEqual(self.call('GET', 'students')[0], 200)
        self.assertEqual(self.call('POST', 'student/newpw', {'id': self.sid})[0], 402)
