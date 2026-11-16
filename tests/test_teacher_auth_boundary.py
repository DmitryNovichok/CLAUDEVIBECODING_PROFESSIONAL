"""HTTP contracts shared by extracted auth routes and teacher business routes."""
import contextlib
import io
import os
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import server
import test_server as fixtures


class AuthModuleImportTest(unittest.TestCase):
    def test_import_needs_neither_server_nor_application_initialization(self):
        root = str(Path(__file__).resolve().parent.parent)
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(
                [sys.executable, '-c', "import sys, teacher_auth_http; assert 'server' not in sys.modules; print('ok')"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': root}, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'ok')
            self.assertEqual(list(Path(folder).iterdir()), [])


class TeacherAuthBoundaryTest(unittest.TestCase):
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
        self.password = 'Synthetic-teacher-password'
        identity = secrets.token_hex(8)
        self.tid = self.db.x('''INSERT INTO teachers(name,login,pw,invite,is_main,created,email,email_ok,moderation)
                               VALUES(?,?,?,?,0,?,?,1,'approved')''',
                            ('Проверка Доступа', identity, server.hash_pw(self.password), identity,
                             time.time(), identity + '@example.invalid'))
        token = secrets.token_urlsafe(24)
        self.cookie = 'egeadm=' + token
        self.db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)',
                  (token, time.time() + 3600, self.tid))
        smtp = mock.patch.object(server, 'smtp_conf', return_value=None)
        smtp.start()
        self.addCleanup(smtp.stop)

    def call(self, method, path, data=None, *, cookie=True):
        return self.client.creq(method, '/api/admin/' + path, data,
                                cookie=self.cookie if cookie else None)

    def row(self):
        return self.db.q('SELECT * FROM teachers WHERE id=?', (self.tid,), one=True)

    def test_anonymous_requests_never_reach_auth_or_business_actions(self):
        old = self.row()['pw']
        for method, path, data in (
            ('GET', 'security', None),
            ('POST', 'password', {'old': self.password, 'new': 'replacement-secret'}),
            ('POST', 'security/recovery', {'password': self.password}),
            ('POST', 'class/save', {'name': 'Не создан'}),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.call(method, path, data, cookie=False)[0], 401)
        self.assertEqual(self.row()['pw'], old)
        self.assertFalse(self.db.q('SELECT 1 FROM classes WHERE teacher_id=?', (self.tid,), one=True))

    def test_email_and_moderation_gate_covers_both_route_families(self):
        old = self.row()['pw']
        for moderation, email_ok, guest in (('pending', 1, 0), ('rejected', 1, 0),
                                            ('approved', 0, 0), ('approved', 1, 1)):
            self.db.x('UPDATE teachers SET moderation=?,email_ok=?,guest=? WHERE id=?',
                      (moderation, email_ok, guest, self.tid))
            for method, path, data in (
                ('GET', 'security', None),
                ('POST', 'password', {'old': self.password, 'new': 'replacement-secret'}),
                ('POST', 'class/save', {'name': 'Не создан'}),
                ('GET', 'email/change', None),
            ):
                with self.subTest(state=(moderation, email_ok, guest), path=path):
                    status, result, _ = self.call(method, path, data)
                    self.assertEqual(status, 403)
                    self.assertTrue(result['need_onboarding'])
            self.assertEqual(self.call('GET', 'status')[0], 200)
            self.assertEqual(self.call('GET', 'me')[0], 200)
        self.assertEqual(self.row()['pw'], old)
        self.assertFalse(self.db.q('SELECT 1 FROM classes WHERE teacher_id=?', (self.tid,), one=True))

    def test_expired_teacher_can_read_and_change_password_but_cannot_create_class(self):
        self.db.x('UPDATE teachers SET until=? WHERE id=?', (time.time() - 1, self.tid))
        self.assertEqual(self.call('GET', 'classes')[0], 200)
        status, result, _ = self.call('POST', 'class/save', {'name': 'Не создан'})
        self.assertEqual(status, 402)
        self.assertTrue(result['expired'])
        self.assertEqual(self.call('POST', 'password',
                                   {'old': self.password, 'new': 'replacement-secret'})[0], 200)
        self.assertTrue(server.check_pw('replacement-secret', self.row()['pw']))
        self.assertFalse(self.db.q('SELECT 1 FROM classes WHERE teacher_id=?', (self.tid,), one=True))

    def test_ordinary_teacher_does_not_gain_principal_security_permissions(self):
        main = server.main_teacher()
        for method, path, data in (
            ('GET', 'security', None), ('POST', 'security/end', {'teacher_id': main['id']}),
            ('POST', 'security/recovery', {'password': self.password}),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.call(method, path, data)[0], 403)
        self.assertEqual(self.call('POST', 'class/save', {'name': 'Разрешённый класс'})[0], 200)
        self.assertEqual(server.main_teacher()['pw'], main['pw'])
        self.assertEqual(self.client.admin('GET', '/api/admin/security')[0], 200)

    def test_existing_cookie_observes_moderation_changes_on_every_request(self):
        self.assertEqual(self.call('GET', 'classes')[0], 200)
        self.db.x("UPDATE teachers SET moderation='rejected' WHERE id=?", (self.tid,))
        self.assertEqual(self.call('GET', 'classes')[0], 403)
        self.assertEqual(self.call('POST', 'password', {'old': self.password, 'new': 'replacement-secret'})[0], 403)
        self.db.x("UPDATE teachers SET moderation='approved' WHERE id=?", (self.tid,))
        self.assertEqual(self.call('GET', 'classes')[0], 200)

    def test_new_early_admin_routes_cannot_bypass_the_common_access_boundary(self):
        """A future handler must be protected before api_route can execute it.

        Cover both a normal route and the atomic batch namespace. The previous
        late guard let this early handler perform writes for every account.
        """
        original = server.Handler.api_route
        routes = ('/api/admin/future-action', '/api/admin/batch/future-action')
        reached = []

        def early_route(handler, method, path, qs, data):
            if path in routes:
                reached.append(path)
                self.db.x('INSERT INTO classes(name,teacher_id) VALUES(?,?)',
                          ('Future route write', self.tid))
                return handler.send_json({'ok': True})
            return original(handler, method, path, qs, data)

        states = (
            ('anonymous', False, 'approved', 1, None, 401),
            ('email', True, 'approved', 0, None, 403),
            ('pending', True, 'pending', 1, None, 403),
            ('rejected', True, 'rejected', 1, None, 403),
            ('expired', True, 'approved', 1, time.time() - 60, 402),
        )
        with mock.patch.object(server.Handler, 'api_route', early_route):
            for label, cookie, moderation, email_ok, until, expected in states:
                self.db.x('UPDATE teachers SET moderation=?,email_ok=?,until=? WHERE id=?',
                          (moderation, email_ok, until, self.tid))
                for path in routes:
                    with self.subTest(state=label, path=path):
                        status, _, _ = self.client.creq('POST', path, {},
                                                       cookie=self.cookie if cookie else None)
                        self.assertEqual(status, expected)
                        self.assertEqual(reached, [])
                        self.assertFalse(self.db.q('SELECT 1 FROM classes WHERE teacher_id=?',
                                                   (self.tid,), one=True))
            self.db.x('UPDATE teachers SET moderation=\'approved\',email_ok=1,until=NULL WHERE id=?', (self.tid,))
            for path in routes:
                # A ready teacher still cannot call an implementation which
                # has not explicitly registered its access policy.
                self.assertEqual(self.client.creq('POST', path, {}, cookie=self.cookie)[0], 404)
            self.assertEqual(reached, [])


if __name__ == '__main__':
    unittest.main()
