"""HTTP access-policy regressions, including future handlers and real rollback."""
import contextlib
import http.client
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
import server
import student_auth_http
import test_server as fixtures


class RegistryContractTest(unittest.TestCase):
    def test_import_has_no_application_or_filesystem_side_effects(self):
        root = str(Path(__file__).resolve().parent.parent)
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, '-c',
                "import sys, api_access; assert 'server' not in sys.modules"],
                cwd=folder, env={**os.environ, 'PYTHONPATH': root}, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_registry_is_exact_immutable_and_covers_extracted_auth(self):
        with self.assertRaises(TypeError):
            api_access.ROUTES[('GET', '/api/future')] = api_access.Access.PUBLIC
        self.assertTrue(set(student_auth_http.STUDENT_AUTH_ROUTES) <= api_access.ROUTES.keys())
        self.assertTrue(api_access.TRANSPORTS.keys() <= api_access.ROUTES.keys())
        for path in ('/api/public/future', '/api/teacher/future', '/api/pyc/future',
                     '/api/admin/future', '/api/admin/class/save/extra'):
            self.assertNotIn(('POST', path), api_access.ROUTES)
        for path in ('login', 'admin/login', 'teacher/signup', 'email/confirm', 'pw/forgot', 'pw/reset'):
            self.assertEqual(api_access.ROUTES[('POST', '/api/' + path)], api_access.Access.CREDENTIAL)
            self.assertNotIn(('GET', '/api/' + path), api_access.ROUTES)


class ApiAccessHTTPTest(unittest.TestCase):
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
        self.token = self.client.login('Доступов ' + name)
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        self.tid = self.db.x('''INSERT INTO teachers(name,login,pw,invite,is_main,created,email,email_ok,moderation)
                               VALUES(?,?,?,?,0,?,?,1,'approved')''',
                            ('Учитель Доступа', name, server.hash_pw('synthetic-password'), name,
                             time.time(), name + '@example.invalid'))
        token = secrets.token_urlsafe(24)
        self.teacher_cookie = 'egeadm=' + token
        self.db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)',
                  (token, time.time() + 3600, self.tid))
        self.sent = []

    def request(self, method, path, data=None, *, token=None, cookie=None, origin=None):
        connection = http.client.HTTPConnection('127.0.0.1', fixtures.ServerTest.port, timeout=10)
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-Token'] = token
        if cookie:
            headers['Cookie'] = cookie
        if origin:
            headers['Origin'] = origin
        connection.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
        response = connection.getresponse()
        body = response.read()
        connection.close()
        try:
            body = json.loads(body)
        except ValueError:
            pass
        return response.status, body

    @contextlib.contextmanager
    def early_handler(self, paths, *, status=200):
        original = server.Handler.api_route
        def route(handler, method, path, qs, data):
            if path in paths:
                self.sent.append((path, self.db._tx_depth))
                self.db.x('INSERT INTO classes(name,teacher_id) VALUES(?,?)', ('Policy probe', self.tid))
                return handler.send_json({'ok': True}, status)
            return original(handler, method, path, qs, data)
        with mock.patch.object(server.Handler, 'api_route', route):
            yield

    def probe_count(self):
        return self.db.q('SELECT COUNT(*) n FROM classes WHERE teacher_id=?', (self.tid,), one=True)['n']

    def test_unknown_early_routes_are_denied_even_with_valid_credentials(self):
        paths = ('/api/future', '/api/public/future', '/api/teacher/future', '/api/pyc/future',
                 '/api/asg/future', '/api/gifts/future', '/api/admin/future', '/api/admin/batch/future')
        with self.early_handler(paths):
            for path in paths:
                with self.subTest(path=path):
                    status, _ = self.request('POST', path, {}, token=self.token, cookie=self.teacher_cookie)
                    self.assertEqual(status, 404)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.probe_count(), 0)

    def test_student_gate_precedes_new_implementations_of_registered_routes(self):
        paths = ('/api/learning/mistakes', '/api/asg/answer', '/api/account')
        with self.early_handler(paths):
            for path in paths:
                for credentials in ({}, {'token': 'invalid'}, {'cookie': self.teacher_cookie}):
                    with self.subTest(path=path, credentials=tuple(credentials)):
                        self.assertEqual(self.request('POST', path, {}, **credentials)[0], 401)
            self.assertEqual(self.sent, [])
            self.assertEqual(self.probe_count(), 0)
            for path in paths:
                self.assertEqual(self.request('POST', path, {}, token=self.token)[0], 200)
        self.assertEqual(self.probe_count(), len(paths))
        self.assertEqual([bool(depth) for _, depth in self.sent], [False, True, True])

    def test_student_token_sources_and_revocation_are_checked_each_time(self):
        path = '/api/learning/mistakes'
        with self.early_handler((path,)):
            for kwargs in ({'token': self.token}, {'data': {'token': self.token}},
                           {'cookie': 'egest=' + self.token}):
                self.assertEqual(self.request('POST', path, **kwargs)[0], 200)
            self.db.x('UPDATE student_sessions SET ended=? WHERE token=?', (time.time(), self.token))
            self.assertEqual(self.request('POST', path, token=self.token)[0], 401)
            self.assertEqual(self.request('POST', path, cookie='egest=' + self.token)[0], 401)
        self.assertEqual(len(self.sent), 3)

    def test_mixed_credentials_do_not_turn_student_into_teacher(self):
        path = '/api/admin/class/save'
        with self.early_handler((path,)):
            self.assertEqual(self.request('POST', path, {}, token=self.token)[0], 401)
            self.db.x("UPDATE teachers SET moderation='pending' WHERE id=?", (self.tid,))
            self.assertEqual(self.request('POST', path, {}, token=self.token, cookie=self.teacher_cookie)[0], 403)
            self.db.x("UPDATE teachers SET moderation='approved',until=? WHERE id=?", (time.time() - 1, self.tid))
            self.assertEqual(self.request('POST', path, {}, token=self.token, cookie=self.teacher_cookie)[0], 402)
        self.assertEqual(self.sent, [])

    def test_rejected_atomic_handler_rolls_back_and_sends_one_denial_after_unlock(self):
        path = '/api/asg/answer'
        original_send = server.Handler.send_json
        observed = []
        def send(handler, body, code=200, extra=None):
            observed.append((code, self.db._tx_depth))
            return original_send(handler, body, code, extra)
        with self.early_handler((path,), status=403), mock.patch.object(server.Handler, 'send_json', send):
            self.assertEqual(self.request('POST', path, {}, token=self.token)[0], 403)
        self.assertEqual(observed, [(403, 0)])
        self.assertEqual(self.probe_count(), 0)

    def test_authorization_failure_inside_atomic_wrapper_cannot_commit_side_effects(self):
        path = '/api/account'
        def denied(handler, data=None):
            self.assertGreater(self.db._tx_depth, 0)
            self.db.x('INSERT INTO classes(name,teacher_id) VALUES(?,?)', ('Denied probe', self.tid))
            return None
        with self.early_handler((path,)), mock.patch.object(server.Handler, 'student', denied):
            self.assertEqual(self.request('POST', path, {})[0], 401)
        self.assertEqual(self.probe_count(), 0)
        self.assertEqual(self.sent, [])

    def test_commit_failure_never_sends_success_from_authorized_handler(self):
        transaction = self.db.transaction
        @contextlib.contextmanager
        def failed_commit():
            with transaction():
                yield
                raise sqlite3.OperationalError('synthetic commit failure')
        with self.early_handler(('/api/account',)), \
             mock.patch.object(self.db, 'transaction', failed_commit), \
             mock.patch.object(server.Handler, 'log_error_safe'):
            self.assertEqual(self.request('POST', '/api/account', {}, token=self.token)[0], 500)
        self.assertEqual(self.probe_count(), 0)

    def test_readiness_accepts_student_or_ready_teacher_and_preserves_403(self):
        path = '/api/readiness'
        with self.early_handler((path,)):
            self.assertEqual(self.request('GET', path)[0], 401)
            self.assertEqual(self.request('GET', path, token=self.token)[0], 200)
            self.assertEqual(self.request('GET', path, cookie=self.teacher_cookie)[0], 200)
            self.db.x('UPDATE teachers SET email_ok=0 WHERE id=?', (self.tid,))
            self.assertEqual(self.request('GET', path, cookie=self.teacher_cookie)[0], 403)
            # Existing account semantics: a valid pupil credential is sufficient.
            self.assertEqual(self.request('GET', path, token=self.token, cookie=self.teacher_cookie)[0], 200)

    def test_parent_capability_is_required_even_when_route_is_replaced(self):
        capability = secrets.token_urlsafe(24)
        self.db.x('UPDATE students SET parent_token=? WHERE id=?', (capability, self.sid))
        with self.early_handler(('/api/parent',)):
            for query, credentials in (('', {}), ('?t=invalid', {}), ('', {'token': self.token}),
                                       ('', {'cookie': self.teacher_cookie}), ('?t=' + 'x' * 30, {})):
                self.assertEqual(self.request('GET', '/api/parent' + query, **credentials)[0], 404)
            self.assertEqual(self.sent, [])
            self.assertEqual(self.request('GET', '/api/parent?t=' + capability)[0], 200)
        self.assertEqual(len(self.sent), 1)

    def test_together_gates_keep_ownership_checks_before_file_handlers(self):
        sid = self.db.x('INSERT INTO together(teacher_id,students,created,state) VALUES(?,?,?,?)',
                        (self.tid, json.dumps([self.sid]), time.time(), '{}'))
        paths = ('/api/together/file', '/api/together/file/delete')
        with self.early_handler(paths):
            self.assertEqual(self.request('GET', '/api/together/file?s=' + str(sid))[0], 403)
            self.assertEqual(self.request('GET', '/api/together/file?s=' + str(sid), token=self.token)[0], 200)
            self.assertEqual(self.request('GET', '/api/together/file?s=' + str(sid) + '&as=t', cookie=self.teacher_cookie)[0], 200)
            self.assertEqual(self.request('POST', '/api/together/file/delete', {'s': sid}, token=self.token)[0], 403)
            self.assertEqual(self.request('POST', '/api/together/file/delete', {'s': sid}, cookie=self.teacher_cookie)[0], 200)
            self.db.x("UPDATE teachers SET moderation='rejected' WHERE id=?", (self.tid,))
            self.assertEqual(self.request('POST', '/api/together/file/delete', {'s': sid}, cookie=self.teacher_cookie)[0], 403)

    def test_public_and_credential_endpoints_keep_anonymous_entry(self):
        for path in ('/api/ping', '/api/status', '/api/net', '/api/public/offer'):
            self.assertEqual(self.request('GET', path)[0], 200)
        self.assertEqual(self.request('POST', '/api/logout', {})[0], 200)
        with mock.patch.object(server, 'smtp_conf', return_value={'SMTP_HOST': 'synthetic'}), \
             mock.patch.object(server, 'SITE_URL', 'https://trainer.example.invalid'):
            self.assertEqual(self.request('POST', '/api/pw/forgot', {'who': 'nonexistent'})[0], 200)
        self.assertEqual(self.request('GET', '/api/pw/reset')[0], 405)
        self.assertEqual(self.request('POST', '/api/pw/reset', {'t': 'bad', 'password': 'new-password'})[0], 404)
        self.assertEqual(self.request('POST', '/api/email/confirm', {'t': 'bad'})[0], 404)
        self.assertEqual(self.request('POST', '/api/teacher/guest', {})[0], 403)

    def test_transport_paths_keep_real_guards_and_no_prefix_fallback(self):
        for path, expected in (('/api/live', 401), ('/api/admin/live', 401), ('/api/html?id=b:5', 401),
                               ('/api/together/ws?id=1', 403), ('/api/live/future', 404),
                               ('/api/html/future', 404), ('/api/together/ws/future', 404)):
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', path)[0], expected)
        self.assertEqual(self.request('POST', '/api/together/upload?s=1', {})[0], 403)
        self.assertEqual(self.request('POST', '/api/together/upload/future', {})[0], 404)
        self.assertEqual(self.request('POST', '/api/ping', {}, origin='https://foreign.invalid')[0], 403)


if __name__ == '__main__':
    unittest.main()
