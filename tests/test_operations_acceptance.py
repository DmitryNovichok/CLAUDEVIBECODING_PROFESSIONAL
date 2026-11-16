"""Operational evidence must be fresh, scoped and unable to mutate the source DB."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

from deploy import acceptance
from deploy.snapshot import create

ROOT = Path(__file__).resolve().parents[1]


class OperationsAcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        (self.app / 'server_data').mkdir(parents=True)
        (self.app / 'server.py').write_text('# synthetic release\n')
        (self.app / 'changelog.js').write_text('[["1.2.3", "test"]]')
        self.policy = self.app / 'server_data/private_config.json'
        self.policy.write_text(json.dumps({'SMTP_PASS': 'synthetic-secret-never-print',
                                          'SMTP_HOST': 'smtp.synthetic.test', 'SMTP_FROM': 'private@example.test'}))
        self.policy.chmod(0o600)
        self.database = self.app / 'server_data/trainer.db'
        with sqlite3.connect(self.database) as db:
            db.executescript('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);'
                             'CREATE TABLE teachers(id INTEGER PRIMARY KEY, email TEXT, is_main INTEGER);')
            db.execute("INSERT INTO settings VALUES('main_login_code','1')")
            db.execute("INSERT INTO teachers VALUES(1, 'private@example.test',1)")
        self.env = mock.patch.dict(os.environ, {'EGE_PRIVATE_CONFIG': str(self.policy),
                                               'EGE_SMTP_HOST': '', 'EGE_SMTP_FROM': ''})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_missing_operational_evidence_cannot_be_reported_as_pass(self):
        before = hashlib.sha256(self.database.read_bytes()).hexdigest()
        result = acceptance.inspect(self.app)
        self.assertEqual(result['status'], 'pending')
        self.assertFalse(result['ok'])
        self.assertEqual(before, hashlib.sha256(self.database.read_bytes()).hexdigest())
        checks = {c['check']: c for c in result['checks']}
        self.assertEqual(checks['principal_second_factor_required']['status'], 'pass')
        for name in ('full_snapshot', 'installed_runner_smoke', 'container_isolation_acceptance',
                     'old_database_migration', 'smtp_delivery_and_second_factor_recovery'):
            self.assertEqual(checks[name]['status'], 'pending')
        serialized = json.dumps(result)
        for private in ('synthetic-secret-never-print', 'private@example.test', 'smtp.synthetic.test'):
            self.assertNotIn(private, serialized)

    def test_missing_smtp_and_disabled_second_factor_are_not_accepted(self):
        self.policy.write_text('{}')
        with sqlite3.connect(self.database) as db:
            db.execute("UPDATE settings SET value='0' WHERE key='main_login_code'")
        checks = {c['check']: c for c in acceptance.local_checks(self.app)}
        self.assertEqual(checks['smtp_configuration_present']['status'], 'pending')
        self.assertEqual(checks['principal_second_factor_required']['status'], 'fail')

    def test_real_archive_integrity_age_and_release_are_required(self):
        archive = self.root / 'backup.tar.gz'
        create(self.database, archive, self.app)
        self.assertEqual(acceptance.snapshot_check(archive, self.app)['status'], 'pass')
        with mock.patch('deploy.acceptance.time.time', return_value=acceptance.time.time() + 30 * 3600):
            self.assertEqual(acceptance.snapshot_check(archive, self.app)['status'], 'fail')
        (self.app / 'server.py').write_text('# different release\n')
        self.assertEqual(acceptance.snapshot_check(archive, self.app)['status'], 'fail')
        archive.write_bytes(b'not an archive; synthetic-private-content')
        result = acceptance.snapshot_check(archive, self.app)
        self.assertEqual(result['status'], 'fail')
        self.assertNotIn('synthetic-private-content', json.dumps(result))

    def test_https_does_not_follow_redirects_or_accept_wrong_release(self):
        class Response:
            status = 302
            def read(self, _limit):
                return b''
        conn = mock.Mock()
        conn.getresponse.return_value = Response()
        with mock.patch('deploy.acceptance.http.client.HTTPSConnection', return_value=conn):
            checks = acceptance.https_checks('https://example.test', '1.2.3')
        self.assertTrue(all(c['status'] == 'fail' for c in checks))
        self.assertEqual([call.args[:2] for call in conn.request.call_args_list],
                         [('GET', '/welcome'), ('GET', '/api/health')])
        with mock.patch('deploy.acceptance.http.client.HTTPSConnection') as connect:
            result = acceptance.https_checks('https://user:secret@example.test/', '1.2.3')
            connect.assert_not_called()
        self.assertEqual(result[0]['status'], 'fail')
        self.assertNotIn('secret', json.dumps(result))

    def test_https_requires_enforced_headers_and_running_version(self):
        headers = {'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                   'Content-Security-Policy': "default-src 'none'; base-uri 'self'; object-src 'none'; "
                                              "frame-ancestors 'self'; form-action 'self'; "
                                              "script-src 'self' 'unsafe-inline'; connect-src 'self'",
                   'X-Content-Type-Options': 'nosniff'}
        welcome = mock.Mock(status=200)
        welcome.read.return_value = b'<html></html>'
        welcome.getheader.side_effect = lambda name, default='': headers.get(name, default)
        health = mock.Mock(status=200)
        health.read.return_value = b'{"ok":true,"version":"1.2.3"}'
        conn = mock.Mock()
        conn.getresponse.side_effect = [welcome, health]
        with mock.patch('deploy.acceptance.http.client.HTTPSConnection', return_value=conn):
            self.assertTrue(all(c['status'] == 'pass' for c in acceptance.https_checks('https://example.test', '1.2.3')))
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(
            "script-src 'self'", "script-src 'self' 'unsafe-eval'")
        health.read.return_value = b'{"ok":true,"version":"0.0.1"}'
        conn.getresponse.side_effect = [welcome, health]
        with mock.patch('deploy.acceptance.http.client.HTTPSConnection', return_value=conn):
            self.assertTrue(all(c['status'] == 'fail' for c in acceptance.https_checks('https://example.test', '1.2.3')))

    def test_csp_rejects_wildcards_external_scripts_and_element_overrides(self):
        from http_security import content_security_policy
        from urllib.parse import urlsplit
        origin = urlsplit('https://example.test')
        policy = content_security_policy({'Host': 'example.test', 'X-Forwarded-Proto': 'https'}, '127.0.0.1')
        self.assertTrue(acceptance.csp_is_restricted(policy, origin))
        for unsafe in (policy.replace("script-src 'self'", "script-src * 'self'"),
                       policy + '; script-src-elem https://foreign.invalid/',
                       policy.replace("connect-src 'self'", "connect-src 'self' https:"),
                       policy.replace("object-src 'none'", 'object-src *')):
            self.assertFalse(acceptance.csp_is_restricted(unsafe, origin), unsafe)

    def test_actual_old_schema_migrates_only_in_anonymized_temporary_copy(self):
        old = self.root / 'anonymized.db'
        with sqlite3.connect(old) as db:
            db.executescript('CREATE TABLE students(id INTEGER PRIMARY KEY, name TEXT NOT NULL,'
                             'name_key TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL, created REAL,'
                             'last_seen REAL, progress TEXT, progress_ts REAL, forecast INTEGER);')
            db.execute("INSERT INTO students VALUES(1,'Anonymous','anonymous','synthetic-token',1,1,'{}',1,0)")
        before = old.read_bytes()
        denied = acceptance.migration_check(old, ROOT)
        self.assertEqual(denied['status'], 'pending')
        result = acceptance.migration_check(old, ROOT, anonymized=True)
        self.assertEqual(result['status'], 'pass', result)
        self.assertTrue(result['detail']['second_start_stable'])
        self.assertTrue(result['detail']['source_unchanged'])
        self.assertEqual(old.read_bytes(), before)
        self.assertFalse(Path(str(old) + '-wal').exists())
        self.assertNotIn('synthetic-token', json.dumps(result))

    def test_active_or_symlink_database_is_rejected_before_migration(self):
        link = self.root / 'linked.db'
        link.symlink_to(self.database)
        self.assertEqual(acceptance.migration_check(link, ROOT, anonymized=True)['status'], 'fail')
        Path(str(self.database) + '-wal').touch()
        self.assertEqual(acceptance.migration_check(self.database, ROOT, anonymized=True)['status'], 'fail')

    def test_missing_runner_never_uses_host_execution(self):
        from buglab_verifier import VerifierUnavailable
        with mock.patch('buglab_verifier.Client.execute', side_effect=VerifierUnavailable('private-path')):
            result = acceptance.runner_check()
        self.assertEqual(result['status'], 'fail')
        self.assertNotIn('private-path', json.dumps(result))

    def test_container_report_rejects_skips_stale_or_unrelated_results(self):
        revision = 'a' * 40
        report = {'schema': 'egeshka.python-runner-acceptance.v1',
                  'generated_at': datetime.now(timezone.utc).isoformat(), 'image': 'sha256:' + 'b' * 64,
                  'source_revision': revision, 'tests_run': 4, 'tests_failed': 0, 'tests_skipped': 0,
                  'passed': True, 'isolation': {'uid': 65534},
                  'test_ids': ['RealContainerTest.' + s for s in (
                      'test_reference_program_passes_independently_and_broken_program_fails',
                      'test_no_host_files_secrets_network_or_root_writes',
                      'test_timeout_output_flood_and_memory_limit_never_become_success',
                      'test_fresh_container_for_each_test')]}
        path = self.root / 'runner.json'
        path.write_text(json.dumps(report))
        self.assertEqual(acceptance.container_report_check(path, revision)['status'], 'pass')
        self.assertEqual(acceptance.container_report_check(path)['status'], 'pending')
        self.assertEqual(acceptance.container_report_check(path, 'c' * 40)['status'], 'fail')
        for patch in ({'tests_skipped': 1}, {'tests_run': 3}, {'generated_at': '2020-01-01T00:00:00+00:00'},
                      {'test_ids': ['unrelated'] * 4}, {'image': 'python:latest'}):
            path.write_text(json.dumps(dict(report, **patch)))
            self.assertEqual(acceptance.container_report_check(path, revision)['status'], 'fail', patch)


if __name__ == '__main__':
    unittest.main()
