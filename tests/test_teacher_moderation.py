"""Mandatory teacher onboarding, including previously authenticated access paths."""
import contextlib
import hashlib
import http.client
import io
import json
import secrets
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import server
import test_server as fixtures


class TeacherModerationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = server.HERE
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()
        for name in ('teacher-gate.html', 'teacher-gate.js', 'teacher-gate.css', 'admin.html',
                     'min/teacher-gate.js', 'min/teacher-gate.css', 'min/admin.js'):
            dest = server.HERE / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(cls.root / name, dest)

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        self.smtp = mock.patch.object(server, 'smtp_conf', return_value=None)
        self.smtp.start()
        self.addCleanup(self.smtp.stop)
        self.email = secrets.token_hex(8) + '@example.invalid'
        status, result, self.cookie = self.c.creq('POST', '/api/teacher/signup',
            {'name': 'Проверка Учителя', 'email': self.email, 'password': 'test-secret-123', 'accept': True})
        self.assertEqual(status, 200, result)
        self.tid = self.me()['id']

    def call(self, method, path, data=None):
        return self.c.creq(method, '/api/admin/' + path, data, cookie=self.cookie)

    def me(self):
        status, data, _ = self.call('GET', 'me')
        self.assertEqual(status, 200, data)
        return data

    def row(self):
        return self.db.q('SELECT * FROM teachers WHERE id=?', (self.tid,), one=True)

    def moderate(self, decision='approved', note=''):
        status, data = self.c.admin('POST', '/api/admin/teacher/moderate',
                                   {'id': self.tid, 'decision': decision, 'note': note})
        self.assertEqual(status, 200, data)
        return data

    def link(self):
        token = secrets.token_urlsafe(24)
        self.db.x('INSERT INTO pw_resets(token,kind,uid,expires,account_state) VALUES(?,?,?,?,?)',
            (hashlib.sha256(token.encode()).hexdigest(), 'et', self.tid, time.time() + 3600, server.confirm_state(self.row())))
        return token

    def confirm(self):
        status, data = self.c.req('POST', '/api/email/confirm', {'t': self.link()})
        self.assertEqual(status, 200, data)

    def http(self, path, token=None, headers=None, method='GET'):
        connection = http.client.HTTPConnection('127.0.0.1', self.c.port, timeout=10)
        h = {'Cookie': self.cookie, **(headers or {})}
        if token:
            h['X-Token'] = token
        connection.request(method, path, headers=h)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_missing_smtp_does_not_bypass_and_profile_is_minimal(self):
        me = self.me()
        self.assertFalse(me['onboarding']['ready'])
        self.assertTrue(me['email_need'])
        self.assertFalse(me['mail_on'])
        self.assertEqual(me['onboarding']['moderation'], 'pending')
        self.assertIsNone(self.row()['until'])
        for secret in ('invite', 'access', 'steps', 'offer', 'consent_needed'):
            self.assertNotIn(secret, me)
        self.assertEqual(self.call('POST', 'email/resend', {})[0], 503)
        self.assertFalse(self.row()['email_ok'])

    def test_all_admin_operations_are_closed_except_status_and_email(self):
        for method, path, data in (
            ('GET', 'students', None), ('GET', 'classes', None), ('GET', 'info', None),
            ('GET', 'settings', None), ('GET', 'teachers', None), ('GET', 'report/preview', None),
            ('POST', 'class/save', {'name': 'Закрыто'}), ('POST', 'as-student', {}),
            ('POST', 'consent', {'accept': True}), ('POST', 'ui', {}),
            ('POST', 'teacher/moderate', {'id': self.tid, 'decision': 'approved'}),
            ('POST', 'me', {}), ('POST', 'status', {}), ('GET', 'email/change', None)):
            with self.subTest(method=method, path=path):
                status, data, _ = self.call(method, path, data)
                self.assertEqual(status, 403, data)
                self.assertTrue(data['need_onboarding'])
        self.assertEqual(self.call('GET', 'status')[0], 200)

    def test_both_orders_and_one_time_trial(self):
        self.confirm()
        self.assertEqual(self.call('GET', 'classes')[0], 403)
        self.assertIsNone(self.row()['trial_started'])
        self.moderate()
        self.assertEqual(self.call('GET', 'classes')[0], 200)
        started, until = self.row()['trial_started'], self.row()['until']
        self.assertAlmostEqual(until - started, server.TRIAL_DAYS * 86400, delta=1)
        self.moderate('rejected', 'Уточните место работы')
        self.assertEqual(self.call('GET', 'classes')[0], 403)
        self.assertEqual(self.me()['onboarding']['note'], 'Уточните место работы')
        self.moderate('pending')
        self.moderate()
        self.assertEqual(self.row()['until'], until)
        self.assertEqual(self.row()['trial_started'], started)

    def test_approval_before_email_and_paid_time_preserved(self):
        self.moderate()
        self.assertEqual(self.call('GET', 'classes')[0], 403)
        self.assertIsNone(self.row()['trial_started'])
        self.confirm()
        self.assertTrue(self.me()['onboarding']['ready'])
        self.assertIsNotNone(self.row()['trial_started'])
        self.moderate('pending')
        future = time.time() + 90 * 86400
        self.db.x('UPDATE teachers SET paid=1,until=?,trial_started=NULL WHERE id=?', (future, self.tid))
        self.moderate()
        self.assertEqual(self.row()['until'], future)
        self.assertIsNone(self.row()['trial_started'])

    def test_principal_alone_moderates_and_cannot_moderate_itself(self):
        self.confirm(); self.moderate()
        self.assertEqual(self.call('POST', 'teacher/moderate', {'id': self.tid, 'decision': 'approved'})[0], 403)
        self.assertEqual(self.c.admin('POST', '/api/admin/teacher/moderate',
            {'id': server.main_teacher()['id'], 'decision': 'rejected'})[0], 400)
        self.assertEqual(self.c.admin('POST', '/api/admin/teacher/moderate',
            {'id': self.tid, 'decision': 'anything'})[0], 400)
        self.assertTrue(server.teacher_ready(server.main_teacher()))
        self.assertEqual(self.row()['moderated_by'], server.main_teacher()['id'])

    def test_email_change_invalidates_old_proof_and_requires_confirmation(self):
        old_token = self.link()
        self.moderate()
        replacement = secrets.token_hex(8) + '@example.invalid'
        status, result, _ = self.call('POST', 'email/change', {'email': replacement})
        self.assertEqual(status, 200, result)
        self.assertFalse(result['email_sent'])
        self.assertEqual(self.c.req('POST', '/api/email/confirm', {'t': old_token})[0], 404)
        self.confirm()
        self.assertTrue(self.me()['onboarding']['ready'])
        until = self.row()['until']
        status, result, _ = self.call('POST', 'report', {'email': self.email, 'on': True})
        self.assertEqual(status, 200, result)
        self.assertFalse(result['onboarding']['ready'])
        self.assertFalse(self.row()['email_ok'])
        self.assertEqual(self.call('GET', 'classes')[0], 403)
        self.confirm()
        self.assertEqual(self.row()['until'], until)

    def test_real_confirmation_link_is_consumed_once(self):
        self.moderate()
        token = self.link()
        self.assertEqual(self.c.req('POST', '/api/email/confirm', {'t': token})[0], 200)
        until = self.row()['until']
        self.assertEqual(self.c.req('POST', '/api/email/confirm', {'t': token})[0], 404)
        self.assertEqual(self.row()['until'], until)

    def test_gate_replaces_page_and_code_and_cannot_be_cached(self):
        for path in ('/admin', '/admin/', '/admin.html'):
            status, headers, body = self.http(path)
            self.assertEqual(status, 200)
            self.assertIn(b'teacherGateRoot', body)
            self.assertNotIn(b'id="appView"', body)
            self.assertIn('no-store', headers['Cache-Control'])
            self.assertEqual(self.http(path, headers={'If-None-Match': headers['ETag']})[0], 200)
        # скрипты обфусцированы (строки зашифрованы) — сравниваем отданный файл целиком: экран модерации или панель
        gate = server.site_asset('teacher-gate.js').read_bytes()
        panel = server.site_asset('admin.js').read_bytes()
        self.assertNotEqual(gate, panel)
        status, headers, code = self.http('/admin.js')
        self.assertEqual(status, 200)
        self.assertEqual(code, gate)
        self.assertIn('no-store', headers['Cache-Control'])
        self.confirm(); self.moderate()
        self.assertIn(b'id="appView"', self.http('/admin')[2])
        self.assertEqual(self.http('/admin.js')[2], panel)
        self.moderate('pending')
        self.assertEqual(self.http('/admin.js')[2], gate)

    def test_preview_and_live_and_together_access_revoked(self):
        self.confirm(); self.moderate()
        status, data, _ = self.call('POST', 'as-student', {})
        self.assertEqual(status, 200, data)
        token = data['token']
        self.assertEqual(self.c.req('GET', '/api/me', token=token)[0], 200)
        created = time.time()
        sid = self.db.x("INSERT INTO together(teacher_id,created,students,state) VALUES(?,?,?,?)",
                        (self.tid, created, '[]', '{}'))
        session = SimpleNamespace(id=sid, created=created, teacher=self.tid)
        self.assertTrue(server.tog_access(session, ('t', self.tid)))
        opened = server.TOG.get(sid)
        connection = mock.Mock(who=('t', self.tid), cid='moderation-test')
        connection.authorize.return_value = True
        previous = opened.pages['p1'].ans
        self.moderate('rejected')
        server.TOG.handle(opened, connection, {'t': 'ans', 'v': 'forbidden'})
        connection.close.assert_called_once()
        self.assertEqual(opened.pages['p1'].ans, previous)
        self.assertEqual(self.c.req('GET', '/api/me', token=token)[0], 401)
        self.assertEqual(self.http('/data/bank.js', headers={'Cookie': 'egest=' + token})[2], server.LOCKED_BANK)
        self.assertEqual(self.http('/api/html?n=5', token=token)[0], 401)
        self.assertEqual(self.http('/api/admin/live')[0], 403)
        handler = object.__new__(server.Handler)
        handler.headers = {'Cookie': self.cookie}
        self.assertIsNone(handler.together_who(sid, True))
        self.assertIsNone(server.tog_access(session, ('t', self.tid)))

    def test_pending_invite_cannot_register_pupils_and_guest_entry_is_closed(self):
        self.assertEqual(self.c.creq('POST', '/api/teacher/guest', {})[0], 403)
        status, data = self.c.req('POST', '/api/login', {'mode': 'register', 'consent': True,
            'code': self.row()['invite'], 'name': 'Закрытый Ученик', 'new_password': 'password123'})
        self.assertEqual(status, 403, data)

    def test_account_created_by_principal_still_needs_own_email(self):
        login = secrets.token_hex(8)
        status, data = self.c.admin('POST', '/api/admin/teacher/save',
            {'name': 'Ручной Учитель', 'login': login, 'password': 'secret123'})
        self.assertEqual(status, 200, data)
        teacher = self.db.q('SELECT * FROM teachers WHERE id=?', (data['id'],), one=True)
        self.assertEqual(teacher['moderation'], 'approved')
        self.assertFalse(teacher['email_ok'])
        self.assertFalse(server.teacher_ready(teacher))

    def test_migration_preserves_only_proven_email_and_runs_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = server.DB(Path(tmp) / 'migration.db')
            now = time.time()
            try:
                ids = []
                for login in ('autoflag', 'proven', 'missing'):
                    ids.append(db.x('INSERT INTO teachers(name,login,invite,created,email,email_ok,until,self_signup) VALUES(?,?,?,?,?,1,?,1)',
                        (login, login, login, now, login+'@example.invalid' if login != 'missing' else None, now+86400)))
                proven = db.q('SELECT * FROM teachers WHERE id=?', (ids[1],), one=True)
                db.x("INSERT INTO pw_resets(token,kind,uid,expires,used,account_state) VALUES('proof','et',?,?,1,?)",
                     (ids[1], now+86400, server.confirm_state(proven)))
                db.x("DELETE FROM settings WHERE key='teacher_gate_v1'")
                db.conn.close()
                db = server.DB(Path(tmp) / 'migration.db')
                rows = [db.q('SELECT * FROM teachers WHERE id=?', (id,), one=True) for id in ids]
                self.assertEqual([r['email_ok'] for r in rows], [0, 1, 0])
                self.assertTrue(all(r['moderation'] == 'pending' and not server.teacher_ready(r) for r in rows))
                self.assertTrue(all(r['until'] == now+86400 and r['trial_started'] == now for r in rows))
                db.x("UPDATE teachers SET moderation='approved' WHERE id=?", (ids[1],))
                db.conn.close()
                db = server.DB(Path(tmp) / 'migration.db')
                self.assertTrue(server.teacher_ready(db.q('SELECT * FROM teachers WHERE id=?', (ids[1],), one=True)))
            finally:
                db.conn.close()


if __name__ == '__main__':
    unittest.main()
