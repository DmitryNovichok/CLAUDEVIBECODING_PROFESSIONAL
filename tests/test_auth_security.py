"""Principal login races, recovery, mail failures and durable denied-action audit.

All accounts and SMTP calls below are synthetic; no message leaves the test process.
"""
import concurrent.futures
import contextlib
import hashlib
import io
import json
import re
import secrets
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

import server
import test_server as fixtures
from auth import reset_main_password, revoke_access, create_recovery_codes, consume_recovery_code


class AuthSecurityTest(unittest.TestCase):
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
        self.password = 'Owner-password-91'
        self.db.x('UPDATE teachers SET pw=?, email=? WHERE is_main=1',
                  (server.hash_pw(self.password), 'owner@example.invalid'))
        self.t = server.main_teacher()
        self.db.x('DELETE FROM admin_codes')
        self.db.x('DELETE FROM admin_recovery_codes')
        self.db.x('DELETE FROM admin_sessions')
        self.db.x('DELETE FROM teacher_log')
        self.db.x("DELETE FROM settings WHERE key='main_login_code'")
        self.smtp = mock.patch.object(server, 'smtp_conf', return_value={'SMTP_HOST': 'test.invalid'})
        self.smtp.start()
        self.addCleanup(self.smtp.stop)
        self.sent = []
        self.mail = mock.patch.object(server, 'send_mail', side_effect=lambda to, subject, html, text:
                                     self.sent.append((to, subject, text)) or True)
        self.mail_mock = self.mail.start()
        self.addCleanup(self.mail.stop)

    def start_login(self):
        return self.client.creq('POST', '/api/admin/login',
                                {'login': 'owner@example.invalid', 'password': self.password})

    def seed_ticket(self):
        ticket, code = secrets.token_urlsafe(24), '762194'
        t = server.main_teacher()
        self.db.x('''INSERT INTO admin_codes(ticket, teacher_id, code, expires, created, account_state, delivery)
                     VALUES(?,?,?,?,?,?,'accepted')''',
                  (hashlib.sha256(ticket.encode()).hexdigest(), t['id'], server.login_code_hash(ticket, code),
                   time.time() + 600, time.time() - 61, server.reset_fingerprint(t)))
        return {'ticket': ticket, 'code': code}

    def finish(self, body, **kw):
        return self.client.creq('POST', '/api/admin/login', body, **kw)

    def recovery_codes(self):
        status, data, _ = self.start_login()
        self.assertEqual(status, 200)
        code = re.search(r'\b(\d{6})\b', self.sent[-1][1]).group(1)
        status, _, cookie = self.finish({'ticket': data['ticket'], 'code': code})
        self.assertEqual(status, 200)
        status, data, _ = self.client.creq('POST', '/api/admin/security/recovery',
                                         {'password': self.password}, cookie=cookie)
        self.assertEqual(status, 200, data)
        return data['codes'], cookie

    def test_backup_codes_are_shown_once_hashed_and_require_recent_second_factor(self):
        self.assertEqual(self.client.admin('POST', '/api/admin/security/recovery', {'password': self.password})[0], 403)
        codes, cookie = self.recovery_codes()
        self.assertEqual(len(set(codes)), 10)
        rows = self.db.q('SELECT * FROM admin_recovery_codes')
        self.assertEqual(len(rows), 10)
        persisted = json.dumps([dict(r) for r in rows] + [dict(r) for r in self.db.q('SELECT * FROM teacher_log')])
        for code in codes:
            self.assertNotIn(code, persisted)
            self.assertNotIn(code.replace('-', ''), persisted)
        self.assertEqual(self.client.creq('GET', '/api/admin/security', cookie=cookie)[1]['code_login']['recovery_left'], 10)
        self.db.x('UPDATE admin_sessions SET factor_ts=?', (time.time() - 601,))
        self.assertEqual(self.client.creq('POST', '/api/admin/security/recovery',
                                         {'password': self.password}, cookie=cookie)[0], 403)

    def test_backup_login_survives_missing_smtp_but_still_requires_both_factors(self):
        codes, _ = self.recovery_codes()
        with mock.patch.object(server, 'smtp_conf', return_value=None):
            status, data, cookie = self.start_login()
            self.assertEqual((status, data['backup_only'], data['delivery'], cookie), (200, True, 'unavailable', ''))
            status, _, cookie = self.finish({'ticket': data['ticket'], 'code': codes[0]})
            self.assertEqual(status, 200)
            self.assertTrue(cookie)
            self.assertEqual(self.db.setting('main_login_code'), '1')
            self.assertEqual(server.recovery_codes_left(self.db, server.main_teacher()), 9)
            self.db.x('UPDATE admin_codes SET created=created-61')
            status, data, cookie = self.start_login()
            self.assertEqual((status, cookie), (200, ''))
            self.assertEqual(self.finish({'ticket': data['ticket'], 'code': codes[0]})[0], 403)
        self.assertEqual(self.client.creq('POST', '/api/admin/login', {'code': codes[1]})[0], 403)

    def test_configured_smtp_failure_offers_backup_without_claiming_delivery(self):
        codes, _ = self.recovery_codes()
        self.mail_mock.side_effect = OSError('synthetic outage')
        status, data, cookie = self.start_login()
        self.assertEqual((status, data['backup_only'], data['delivery'], cookie), (200, True, 'failed', ''))
        self.assertEqual(self.finish({'ticket': data['ticket'], 'code': codes[0]})[0], 200)

    def test_parallel_recovery_code_cannot_login_twice_even_with_separate_tickets(self):
        codes = create_recovery_codes(self.db, self.t)
        bodies = [dict(self.seed_ticket(), code=codes[0]) for _ in range(2)]
        gate = threading.Barrier(2)
        def hit(body):
            gate.wait(timeout=5)
            return self.finish(body)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(hit, bodies))
        self.assertEqual(sorted(r[0] for r in results), [200, 403])
        self.assertEqual(sum(bool(r[2]) for r in results), 1)
        self.assertEqual(server.recovery_codes_left(self.db, self.t), 9)

    def test_backups_are_invalidated_by_credentials_and_revoke(self):
        codes = create_recovery_codes(self.db, self.t)
        self.db.x('UPDATE teachers SET email=? WHERE is_main=1', ('changed@example.invalid',))
        self.assertFalse(consume_recovery_code(self.db, server.main_teacher(), codes[0]))
        codes = create_recovery_codes(self.db, server.main_teacher())
        revoke_access(self.db)
        self.assertFalse(consume_recovery_code(self.db, server.main_teacher(), codes[0]))

    def test_changed_email_cannot_reactivate_backups_when_changed_back(self):
        codes = create_recovery_codes(self.db, self.t)
        with mock.patch.object(server, 'send_confirm', return_value=False):
            for email in ('changed@example.invalid', self.t['email']):
                self.assertEqual(self.client.admin('POST', '/api/admin/report', {'email': email, 'on': False})[0], 200)
        self.assertFalse(consume_recovery_code(self.db, server.main_teacher(), codes[0]))
    def test_admin_password_reset_revokes_legacy_null_teacher_session(self):
        status, _ = self.client.admin('POST', '/api/admin/teacher/save',
                                     {'id': self.t['id'], 'name': self.t['name'], 'login': self.t['login'],
                                      'invite': self.t['invite'], 'password': 'Replacement-94'})
        self.assertEqual(status, 200)
        self.assertFalse(self.db.q('SELECT 1 FROM admin_sessions WHERE teacher_id IS NULL', one=True))
        self.assertEqual(self.db.setting('admin_password'), server.main_teacher()['pw'])

    def test_parallel_correct_code_creates_exactly_one_session(self):
        body = self.seed_ticket()
        barrier = threading.Barrier(8)

        def hit(i):
            barrier.wait(timeout=5)
            return self.finish(body, ip=f'198.51.100.{i + 10}')

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(hit, range(8)))
        self.assertEqual(sorted(r[0] for r in results), [200] + [410] * 7)
        self.assertEqual(sum(bool(r[2]) for r in results), 1)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM admin_sessions', one=True)['n'], 1)

    def test_parallel_wrong_codes_stop_at_exactly_five_checks(self):
        body = dict(self.seed_ticket(), code='000000')
        barrier = threading.Barrier(8)

        def hit(i):
            barrier.wait(timeout=5)
            return self.finish(body, ip=f'198.51.100.{i + 30}')

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(hit, range(8)))
        self.assertEqual(sorted(r[0] for r in results), [403] * 5 + [410] * 3)
        self.assertEqual(self.db.q('SELECT tries FROM admin_codes', one=True)['tries'], 5)
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM teacher_log WHERE event='login' AND ok=0", one=True)['n'], 5)
        self.assertFalse(any(r[2] for r in results))

    def test_failed_password_change_audit_survives_rollback_once(self):
        before = server.main_teacher()['pw']
        status, _ = self.client.admin('POST', '/api/admin/password', {'old': 'wrong-secret', 'new': 'new-secret-123'})
        self.assertEqual(status, 403)
        self.assertEqual(server.main_teacher()['pw'], before)
        rows = self.db.q("SELECT * FROM teacher_log WHERE event='password' AND ok=0")
        self.assertEqual(len(rows), 1)
        self.assertNotIn('wrong-secret', json.dumps(dict(rows[0])))
        self.assertNotIn('new-secret-123', json.dumps(dict(rows[0])))

    def test_password_change_revokes_outstanding_challenge(self):
        body = self.seed_ticket()
        self.assertEqual(self.client.admin('POST', '/api/admin/password',
                                          {'old': self.password, 'new': 'replacement-91'})[0], 200)
        self.assertEqual(self.finish(body)[0], 410)

    def test_recovery_link_revokes_outstanding_challenge(self):
        body = self.seed_ticket()
        token = secrets.token_urlsafe(24)
        self.db.x("INSERT INTO pw_resets(token,kind,uid,expires,account_state) VALUES(?,'t',?,?,?)",
                  (hashlib.sha256(token.encode()).hexdigest(), self.t['id'], time.time() + 3600,
                   server.reset_fingerprint(self.t)))
        self.assertEqual(self.client.req('POST', '/api/pw/reset', {'t': token, 'password': 'replacement-92'})[0], 200)
        self.assertEqual(self.finish(body)[0], 410)

    def test_email_change_and_bulk_session_revoke_invalidate_challenges(self):
        body = self.seed_ticket()
        with mock.patch.object(server, 'send_confirm', return_value=False):
            self.assertEqual(self.client.admin('POST', '/api/admin/report',
                                              {'email': 'new-owner@example.invalid', 'on': False})[0], 200)
        self.assertEqual(self.finish(body)[0], 410)
        body = self.seed_ticket()
        self.assertEqual(self.client.admin('POST', '/api/admin/security/end', {'teacher_id': self.t['id']})[0], 200)
        self.assertEqual(self.finish(body)[0], 410)

    def test_revoke_access_invalidates_challenge_without_changing_password(self):
        body = self.seed_ticket()
        pw = server.main_teacher()['pw']
        revoke_access(self.db)
        self.assertEqual(server.main_teacher()['pw'], pw)
        self.assertEqual(self.finish(body)[0], 410)

    def test_fingerprint_blocks_stale_challenge_even_if_cleanup_was_missed(self):
        for field, value in [('pw', server.hash_pw('other-secret')), ('email', 'another@example.invalid')]:
            with self.subTest(field=field):
                body = self.seed_ticket()
                self.db.x(f'UPDATE teachers SET {field}=? WHERE is_main=1', (value,))
                self.assertEqual(self.finish(body)[0], 410)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM admin_sessions', one=True)['n'], 0)

    def test_smtp_failure_is_visible_and_retry_is_bounded(self):
        self.mail_mock.side_effect = OSError('test SMTP outage')
        status, data, cookie = self.start_login()
        self.assertEqual((status, data['delivery'], cookie), (503, 'failed', ''))
        self.assertEqual(self.db.q('SELECT delivery FROM admin_codes', one=True)['delivery'], 'failed')
        self.assertEqual(self.db.q("SELECT ok FROM teacher_log WHERE event='code'", one=True)['ok'], 0)
        self.assertEqual(self.start_login()[0], 429)
        self.assertEqual(self.mail_mock.call_count, 1)
        self.db.x('UPDATE admin_codes SET created=created-61')
        self.mail_mock.side_effect = lambda to, subject, html, text: self.sent.append((to, subject, text)) or True
        status, data, cookie = self.start_login()
        self.assertEqual((status, data['delivery'], cookie), (200, 'accepted', ''))
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM admin_codes WHERE delivery='accepted'", one=True)['n'], 1)
        code = re.search(r'\b(\d{6})\b', self.sent[-1][1]).group(1)
        self.assertEqual(self.finish({'ticket': data['ticket'], 'code': code})[0], 200)

    def test_retry_replaces_active_code_and_used_codes_still_count_toward_quota(self):
        old = self.seed_ticket()
        status, _, _ = self.start_login()
        self.assertEqual(status, 200)
        self.assertEqual(self.finish(old)[0], 410)
        for _ in range(3):
            self.db.x('UPDATE admin_codes SET created=created-61')
            self.assertEqual(self.start_login()[0], 200)
        self.db.x('UPDATE admin_codes SET created=created-61')
        self.assertEqual(self.start_login()[0], 429)
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM admin_codes WHERE delivery='accepted'", one=True)['n'], 1)

    def test_smtp_does_not_hold_database_lock(self):
        started, release = threading.Event(), threading.Event()

        def slow_mail(*args):
            started.set()
            if not release.wait(timeout=5):
                raise TimeoutError('test did not release SMTP')
            return True

        self.mail_mock.side_effect = slow_mail
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = pool.submit(self.start_login)
            try:
                self.assertTrue(started.wait(timeout=5))
                query = pool.submit(lambda: self.db.q('SELECT delivery FROM admin_codes', one=True)['delivery'])
                self.assertEqual(query.result(timeout=1), 'queued')
                self.assertFalse(pending.done())
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=5)[0], 200)

    def test_required_factor_survives_missing_smtp_and_explicit_recovery_is_audited(self):
        self.assertEqual(self.start_login()[0], 200)
        self.assertEqual(self.db.setting('main_login_code'), '1')
        with mock.patch.object(server, 'smtp_conf', return_value=None):
            status, _, cookie = self.start_login()
            self.assertEqual((status, cookie), (503, ''))
            reset_main_password(self.db, 'replacement-93')
            self.password = 'replacement-93'
            self.assertEqual(self.start_login()[0], 503)
            reset_main_password(self.db, 'replacement-94', recover_factor=True)
            self.password = 'replacement-94'
            status, _, cookie = self.start_login()
            self.assertEqual(status, 200)
            self.assertTrue(cookie)
        self.assertEqual(self.db.setting('main_login_code'), '0')
        self.assertEqual(self.db.q("SELECT COUNT(*) n FROM teacher_log WHERE event='reset'", one=True)['n'], 2)

    def test_first_setup_without_mail_still_allows_bootstrap(self):
        with mock.patch.object(server, 'smtp_conf', return_value=None):
            status, _, cookie = self.start_login()
        self.assertEqual(status, 200)
        self.assertTrue(cookie)

    def test_factor_enabled_during_password_login_prevents_password_only_session(self):
        self.db.setting('main_login_code', '0')
        checked, proceed = threading.Event(), threading.Event()
        original = server.login_code_required

        def pause_first_check(account):
            required = original(account)
            if not checked.is_set():
                checked.set()
                if not proceed.wait(timeout=5):
                    raise TimeoutError('test did not release policy check')
            return required

        with mock.patch.object(server, 'login_code_required', side_effect=pause_first_check):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(self.start_login)
                try:
                    self.assertTrue(checked.wait(timeout=5))
                    self.db.setting('main_login_code', '1')
                finally:
                    proceed.set()
                status, _, cookie = pending.result(timeout=5)
        self.assertEqual((status, cookie), (409, ''))
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM admin_sessions', one=True)['n'], 0)

    def test_upgrade_latches_previously_used_factor_and_invalidates_old_challenges(self):
        for policy in (None, '0'):
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'legacy.db'
                db = server.DB(path)
                main = db.q('SELECT id FROM teachers WHERE is_main=1', one=True)['id']
                db.x("DELETE FROM settings WHERE key IN ('main_login_code','main_login_code_migrated')")
                if policy is not None:
                    db.setting('main_login_code', policy)
                db.x("INSERT INTO teacher_log(ts, teacher_id, event) VALUES(?,?,'code')", (time.time(), main))
                db.x("""INSERT INTO admin_codes(ticket, teacher_id, code, expires, created, delivery)
                         VALUES('legacy',?,'hash',?,?,'accepted')""", (main, time.time() + 600, time.time()))
                db.conn.close()
                reopened = server.DB(path)
                try:
                    self.assertEqual(reopened.setting('main_login_code'), '1' if policy is None else '0')
                    self.assertEqual(reopened.q('SELECT delivery FROM admin_codes', one=True)['delivery'], 'invalid')
                finally:
                    reopened.conn.close()


if __name__ == '__main__':
    unittest.main()
