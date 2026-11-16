"""Regressions for registration and recovery, using only synthetic accounts/mail."""
import contextlib
import http.client
import io
import json
import re
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import server
import test_server as fixtures


class AccountRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        type(self).serial += 1
        self.name = 'Макетов Проверка' + chr(0x410 + self.serial)
        self.login = 'mock-account-' + str(self.serial)
        status, self.me = self.register(self.name, self.login)
        self.assertEqual(status, 200, self.me)
        self.token, self.sid = self.me['token'], self.me['sid']

    def register(self, name, login):
        return self.c.req('POST', '/api/login', {'mode': 'register', 'name': name,
            'login': login, 'email': login + '@example.test', 'password': 'synthetic-pass', 'consent': True})

    def recovery(self, who=None, kind='s'):
        sent, ready = [], threading.Event()
        def mail(to, subject, html, plain):
            sent.append(plain)
            ready.set()
            return True
        with mock.patch.object(server, 'SITE_URL', 'https://trainer.example.test'), \
             mock.patch.object(server, 'smtp_conf', return_value={'SMTP_HOST': 'mock'}), \
             mock.patch.object(server, 'send_mail', side_effect=mail):
            status, result = self.c.req('POST', '/api/pw/forgot', {'who': who or self.login, 'kind': kind})
            self.assertEqual(status, 200, result)
            self.assertTrue(ready.wait(2), 'Mock recovery mail was not sent')
        return re.search(r'/reset\?t=([^\s&]+)', sent[0]).group(1)

    def reset(self, token, password='replacement-pass'):
        return self.c.req('POST', '/api/pw/reset', {'t': token, 'password': password})

    def race(self, predicate, calls):
        original, gate = self.db.q, threading.Barrier(2)
        def query(sql, args=(), one=False):
            result = original(sql, args, one)
            if predicate(sql):
                try:
                    gate.wait(timeout=0.2)
                except threading.BrokenBarrierError:
                    pass
            return result
        with mock.patch.object(self.db, 'q', side_effect=query), ThreadPoolExecutor(2) as pool:
            return list(pool.map(lambda fn: fn(), calls))

    def test_account_validation_does_not_save_partial_changes(self):
        self.db.x('UPDATE students SET login=NULL WHERE id=?', (self.sid,))
        status, _ = self.c.req('POST', '/api/account', {'email': 'changed@example.test', 'login': '!bad'}, self.token)
        self.assertEqual(status, 400)
        self.assertEqual(self.db.q('SELECT email FROM students WHERE id=?', (self.sid,), one=True)['email'], self.me['email'])
        status, _ = self.c.req('POST', '/api/account', {'email': 'changed@example.test', 'code': 'INVALID'}, self.token)
        self.assertEqual(status, 403)
        self.assertEqual(self.db.q('SELECT email FROM students WHERE id=?', (self.sid,), one=True)['email'], self.me['email'])

    def test_rejected_multi_field_edit_does_not_send_confirmation(self):
        self.db.x('UPDATE students SET login=NULL WHERE id=?', (self.sid,))
        with mock.patch.object(server, 'send_confirm', return_value=True) as send:
            status, _ = self.c.req('POST', '/api/account',
                {'email':'changed@example.test','login':'!bad'}, self.token)
            self.assertEqual(status, 400)
            send.assert_not_called()
            status, _ = self.c.req('POST', '/api/account',
                {'email':'changed@example.test','code':'INVALID'}, self.token)
            self.assertEqual(status, 403)
            send.assert_not_called()
            row = self.db.q('SELECT email,login,self_reg FROM students WHERE id=?', (self.sid,), one=True)
            self.assertEqual(row['email'], self.me['email'])
            self.assertIsNone(row['login'])
            self.assertTrue(row['self_reg'])
            status, _ = self.c.req('POST', '/api/account',
                {'email':'changed@example.test','login':self.login}, self.token)
            self.assertEqual(status, 200)
            send.assert_called_once()
            self.assertEqual(send.call_args.args[2]['email'], 'changed@example.test')

    def test_join_teacher_requires_email_and_moderation_before_any_changes(self):
        teacher_id = self.db.x('''INSERT INTO teachers(name,login,pw,invite,created,email,email_ok,moderation)
            VALUES(?,?,?,?,?,?,?,?)''', ('Учитель Ожидание',self.login+'-teacher','unused',
            self.login+'-invite',time.time(),self.login+'-teacher@example.test',0,'approved'))
        with mock.patch.object(server, 'send_confirm', return_value=True) as send:
            for email_ok, moderation in ((0,'approved'),(1,'pending'),(1,'rejected')):
                self.db.x('UPDATE teachers SET email_ok=?,moderation=? WHERE id=?', (email_ok,moderation,teacher_id))
                with self.subTest(email_ok=email_ok, moderation=moderation):
                    status, _ = self.c.req('POST', '/api/account',
                        {'email':'changed@example.test','code':self.login+'-invite'}, self.token)
                    self.assertEqual(status, 403)
                    row = self.db.q('SELECT email,teacher_id,self_reg FROM students WHERE id=?', (self.sid,), one=True)
                    self.assertEqual(row['email'], self.me['email'])
                    self.assertNotEqual(row['teacher_id'], teacher_id)
                    self.assertTrue(row['self_reg'])
            send.assert_not_called()
            self.db.x("UPDATE teachers SET email_ok=1,moderation='approved' WHERE id=?", (teacher_id,))
            status, _ = self.c.req('POST', '/api/account', {'code':self.login+'-invite'}, self.token)
            self.assertEqual(status, 200)
            row = self.db.q('SELECT teacher_id,self_reg FROM students WHERE id=?', (self.sid,), one=True)
            self.assertEqual(row['teacher_id'], teacher_id)
            self.assertFalse(row['self_reg'])

    def test_independent_student_cannot_remove_only_recovery_method(self):
        self.assertEqual(self.c.req('POST', '/api/account', {'email': ''}, self.token)[0], 400)
        self.assertEqual(self.c.req('POST', '/api/account', {'email': '', 'code': '1234'}, self.token)[0], 200)

    def test_concurrent_registration_cannot_duplicate_login(self):
        login = self.login + '-shared'
        results = self.race(lambda sql: sql == 'SELECT 1 FROM students WHERE lower(login)=?', [
            lambda: self.register('Макетов Параллельный', login),
            lambda: self.register('Макетова Параллельная', login)])
        self.assertEqual(sorted(r[0] for r in results), [200, 409])
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM students WHERE lower(login)=?', (login,), one=True)['n'], 1)

    def test_failed_login_delay_does_not_block_other_database_requests(self):
        waiting, release = threading.Event(), threading.Event()
        original_sleep = time.sleep
        def delay(seconds):
            if seconds == 1:
                waiting.set()
                release.wait(2)
            else:
                original_sleep(seconds)
        with mock.patch.object(server.time, 'sleep', side_effect=delay), ThreadPoolExecutor(2) as pool:
            request = pool.submit(self.c.req, 'POST', '/api/login',
                                  {'mode': 'login', 'name': self.login, 'password': 'wrong-pass'})
            try:
                self.assertTrue(waiting.wait(2))
                read = pool.submit(self.db.q, 'SELECT id FROM students WHERE id=?', (self.sid,), True)
                self.assertEqual(read.result(timeout=0.5)['id'], self.sid)
            finally:
                release.set()
            self.assertEqual(request.result()[0], 403)

    def test_reset_rejects_concurrent_use(self):
        token = self.recovery()
        results = self.race(lambda sql: sql.startswith('SELECT * FROM pw_resets'),
                            [lambda: self.reset(token, 'replacement-one'), lambda: self.reset(token, 'replacement-two')])
        self.assertEqual(sorted(r[0] for r in results), [200, 404])

    def test_reset_invalidates_other_links(self):
        first, second = self.recovery(), self.recovery()
        self.assertEqual(self.reset(first)[0], 200)
        self.assertEqual(self.reset(second)[0], 404)

    def test_reset_invalid_after_password_change(self):
        token = self.recovery()
        self.assertEqual(self.c.req('POST', '/api/password', {'old': 'synthetic-pass', 'new': 'changed-pass'}, self.token)[0], 200)
        self.assertEqual(self.reset(token)[0], 404)

    def test_reset_invalid_after_email_change(self):
        token = self.recovery()
        self.assertEqual(self.c.req('POST', '/api/account', {'email': 'other@example.test'}, self.token)[0], 200)
        self.assertEqual(self.reset(token)[0], 404)

    def test_reset_closes_legacy_student_token(self):
        legacy = self.db.q('SELECT token FROM students WHERE id=?', (self.sid,), one=True)['token']
        self.assertIsNotNone(server.student_by_token(self.db, legacy, '203.0.113.201')[0])
        self.assertEqual(self.reset(self.recovery())[0], 200)
        self.assertIsNone(server.student_by_token(self.db, legacy, '203.0.113.201')[0])
        self.assertEqual(self.c.req('GET', '/api/me', token=self.token)[0], 401)

    def test_teacher_new_password_closes_legacy_student_token(self):
        legacy = self.db.q('SELECT token FROM students WHERE id=?', (self.sid,), one=True)['token']
        self.assertEqual(self.c.admin('POST', '/api/admin/student/newpw', {'id': self.sid})[0], 200)
        self.assertIsNone(server.student_by_token(self.db, legacy, '203.0.113.201')[0])
        self.assertEqual(self.c.req('GET', '/api/me', token=self.token)[0], 401)

    def test_reset_closes_legacy_main_teacher_session(self):
        main = server.main_teacher()
        self.db.x('UPDATE teachers SET email=? WHERE id=?', ('teacher@example.test', main['id']))
        self.c.admin('GET', '/api/admin/me')
        token = self.recovery('teacher@example.test', 't')
        self.assertEqual(self.reset(token)[0], 200)
        self.assertEqual(self.c.creq('GET', '/api/admin/me', cookie='egeadm=admtest')[0], 401)

    def test_failed_password_write_does_not_consume_link(self):
        token, original = self.recovery(), self.db.x
        def write(sql, args=()):
            if sql.startswith('UPDATE students SET pw='):
                raise RuntimeError('synthetic write failure')
            return original(sql, args)
        with mock.patch.object(self.db, 'x', side_effect=write), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.reset(token)[0], 500)
        self.assertEqual(self.reset(token)[0], 200)

    def test_deleted_student_link_cannot_reset_reused_id(self):
        token = self.recovery()
        server.delete_student(self.db, self.sid)
        self.db.x('INSERT INTO students(id,name,name_key,token,created,pw,email) VALUES(?,?,?,?,?,?,?)',
                  (self.sid, 'Макетов Новый', 'макетов новый', 'synthetic-legacy-token', time.time(),
                   server.hash_pw('unrelated-pass'), 'new@example.test'))
        self.assertEqual(self.reset(token)[0], 404)

    def test_recovery_never_uses_untrusted_host(self):
        sent = []
        with mock.patch.object(server, 'SITE_URL', ''), \
             mock.patch.object(server, 'smtp_conf', return_value={'SMTP_HOST': 'mock'}), \
             mock.patch.object(server, 'send_mail', side_effect=lambda *a: sent.append(a)):
            connection = http.client.HTTPConnection('127.0.0.1', self.c.port, timeout=5)
            connection.request('POST', '/api/pw/forgot', json.dumps({'who': self.login}),
                               headers={'Content-Type': 'application/json', 'Host': 'untrusted.example.test'})
            response = connection.getresponse()
            response.read()
            connection.close()
            self.assertEqual(response.status, 503)
        self.assertEqual(sent, [])

    def test_legacy_password_requires_own_teacher_invite(self):
        self.db.x('UPDATE students SET pw=NULL, self_reg=0 WHERE id=?', (self.sid,))
        self.db.x('INSERT INTO teachers(name,login,pw,invite,created) VALUES(?,?,?,?,?)',
                  ('Учитель Макетов', 'mock-foreign-teacher', 'unused', 'FOREIGN', time.time()))
        data = {'mode': 'register', 'name': self.name, 'code': 'FOREIGN', 'password': 'takeover-pass', 'consent': True}
        self.assertEqual(self.c.req('POST', '/api/login', data)[0], 403)

    def test_login_without_password_returns_existing_identity(self):
        self.db.x('UPDATE students SET pw=NULL WHERE id=?', (self.sid,))
        status, result = self.c.req('POST', '/api/login', {'mode': 'login', 'name': self.login})
        self.assertEqual(status, 409)
        self.assertEqual(result.get('name'), self.name)
        self.assertEqual(result.get('login'), self.login)

    def test_teacher_student_proxy_cannot_be_claimed_by_registration(self):
        self.db.x('UPDATE students SET pw=NULL, is_teacher=1 WHERE id=?', (self.sid,))
        data = {'mode': 'register', 'name': self.name, 'code': '1234', 'password': 'takeover-pass', 'consent': True}
        self.assertEqual(self.c.req('POST', '/api/login', data)[0], 403)
        self.assertIsNone(self.db.q('SELECT pw FROM students WHERE id=?', (self.sid,), one=True)['pw'])

    def test_legacy_duplicate_login_requires_name(self):
        status, other = self.register('Макетов Дубликат', self.login + '-other')
        self.assertEqual(status, 200)
        self.db.x('UPDATE students SET login=? WHERE id=?', (self.login, other['sid']))
        self.assertEqual(self.c.req('POST', '/api/login', {'mode': 'login', 'name': self.login, 'password': 'synthetic-pass'})[0], 409)
        self.assertEqual(self.c.req('POST', '/api/login', {'mode': 'login', 'name': self.name, 'password': 'synthetic-pass'})[0], 200)

    def test_legacy_registration_validates_login_before_setting_password(self):
        self.db.x('UPDATE students SET pw=NULL, login=NULL WHERE id=?', (self.sid,))
        data = {'mode': 'register', 'name': self.name, 'code': '1234', 'login': '!bad',
                'password': 'replacement-pass', 'consent': True}
        self.assertEqual(self.c.req('POST', '/api/login', data)[0], 400)
        self.assertIsNone(self.db.q('SELECT pw FROM students WHERE id=?', (self.sid,), one=True)['pw'])
        data['login'] = self.login + '-new'
        self.assertEqual(self.c.req('POST', '/api/login', data)[0], 200)

    def test_pre_update_recovery_link_without_identity_binding_is_rejected(self):
        import hashlib
        token = 'synthetic-old-recovery'
        self.db.x('INSERT INTO pw_resets(token,kind,uid,expires) VALUES(?,?,?,?)',
                  (hashlib.sha256(token.encode()).hexdigest(), 's', self.sid, time.time() + 600))
        self.assertEqual(self.reset(token)[0], 404)


if __name__ == '__main__':
    unittest.main()
