"""Regression checks for private assets, release integrity and private downloads."""
import contextlib
import gzip
import http.client
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request

import server
import test_server as fixtures
from deploy import github_release
from tools import check_release


class PrivateAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.c.setUp()
        type(self).serial += 1
        self.token = self.c.login('Макетов Защита' + chr(0x410 + self.serial))
        self.sid = self.c.req('GET', '/api/me', token=self.token)[1]['sid']
        self.db = server.APP.db
        self.db.setting('lab_pw', 'synthetic-lab')
        self.db.setting('ard_pw', 'synthetic-ard')
        self.db.x('UPDATE students SET lab=1, ard=1 WHERE id=?', (self.sid,))
        for name in ('lab-worker.js', 'arduino/app.js', 'arduino/index.html', 'min/admin.js'):
            self.write(name, '/* private */' + 'x' * 3000)
        self.write('admin-login.js', '/* login */')

    def write(self, name, text):
        path = server.HERE / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def get(self, path, headers=None, method='GET'):
        c = http.client.HTTPConnection('127.0.0.1', self.c.port, timeout=10)
        c.request(method, path, headers=headers or {})
        r = c.getresponse()
        result = r.status, dict(r.getheaders()), r.read()
        c.close()
        return result

    def test_private_assets_ignore_conditional_cache_and_recheck_access(self):
        for path in ('/lab-worker.js?v=1', '/arduino/app.js?v=1', '/arduino/'):
            for encoding in ('identity', 'gzip'):
                with self.subTest(path=path, encoding=encoding):
                    headers = {'X-Token': self.token, 'Accept-Encoding': encoding}
                    status, h, body = self.get(path, headers)
                    self.assertEqual(status, 200)
                    self.assertEqual(h['Cache-Control'], 'private, no-store')
                    self.assertIn('Cookie', h['Vary'])
                    self.assertIn('X-Token', h['Vary'])
                    self.assertIn('Accept-Encoding', h['Vary'])
                    if encoding == 'gzip':
                        self.assertIn(b'private', gzip.decompress(body))
                    headers['If-None-Match'] = h['ETag']
                    self.assertEqual(self.get(path, headers)[0], 200)
                    self.assertIn(self.get(path, {'If-None-Match': h['ETag']})[0], (302, 401, 403))
                    self.db.x('UPDATE students SET lab=0, ard=0 WHERE id=?', (self.sid,))
                    self.assertIn(self.get(path, headers, method='HEAD')[0], (302, 403))
                    self.db.x('UPDATE students SET lab=1, ard=1 WHERE id=?', (self.sid,))

    def test_admin_code_is_not_reused_after_logout(self):
        self.c.admin('GET', '/api/admin/students')
        status, h, body = self.get('/admin.js?v=1', {'Cookie': 'egeadm=admtest'})
        self.assertEqual(status, 200)
        self.assertIn(b'private', body)
        self.assertIn('no-store', h['Cache-Control'])
        status, h2, body = self.get('/admin.js?v=1', {'If-None-Match': h['ETag']})
        self.assertEqual(status, 200)
        self.assertIn(b'login', body)
        self.assertNotIn(b'private', body)
        self.assertIn('no-store', h2['Cache-Control'])

    def test_missing_minified_asset_never_exposes_source(self):
        self.write('welcome.js', 'const readableSourceSecret = true;')
        (server.HERE / 'min/welcome.js').unlink(missing_ok=True)
        status, _, body = self.get('/welcome.js')
        self.assertEqual(status, 404)
        self.assertNotIn(b'readableSourceSecret', body)

    def test_service_files_in_static_directories_are_not_downloadable(self):
        paths = ('vendor/x.js.map', 'vendor/x.js.map.gz', 'media/.env', 'promo/private_config.json',
                 'media/users.db', 'media/users.db-wal', 'media/USERS.DB', 'vendor/.git/config',
                 'arduino/source/node_modules/x.js')
        for path in paths:
            self.write(path, 'synthetic-private-file')
            with self.subTest(path=path):
                self.assertEqual(self.get('/' + path, {'X-Token': self.token})[0], 404)

    def test_public_assets_keep_compression_and_conditional_caching(self):
        self.write('min/app.js', '/* public */' + 'x' * 3000)
        status, h, _ = self.get('/app.js?v=test')
        self.assertEqual(status, 200)
        self.assertIn('immutable', h['Cache-Control'])
        self.assertEqual(h['Vary'], 'Accept-Encoding')
        status, cached, body = self.get('/app.js?v=test', {'If-None-Match': h['ETag']})
        self.assertEqual((status, body), (304, b''))
        self.assertEqual(cached['Cache-Control'], h['Cache-Control'])
        self.assertEqual(cached['Vary'], h['Vary'])

    def test_arduino_license_and_corresponding_source_remain_accessible(self):
        for path in ('arduino/LICENSE', 'arduino/source/src/app.js'):
            self.write(path, 'synthetic-license-or-source')
            self.assertEqual(self.get('/' + path, {'X-Token': self.token})[0], 200)


class ReleaseIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'min').mkdir()
        (self.root / 'server.py').write_text('MIN_FILES = ("app.js",)')
        (self.root / 'app.js').write_text('source')
        (self.root / 'min/app.js').write_text('minified')
        (self.root / 'admin-login.js').write_text('login')
        check_release.write_manifest(self.root)

    def test_valid_release(self):
        check_release.validate(self.root)

    def test_gate_page_is_required_when_gate_script_is_shipped(self):
        (self.root / 'server.py').write_text('MIN_FILES = ("app.js", "teacher-gate.js")')
        (self.root / 'teacher-gate.js').write_text('gate source')
        (self.root / 'min/teacher-gate.js').write_text('gate minified')
        check_release.write_manifest(self.root)
        with self.assertRaisesRegex(ValueError, 'teacher-gate.html'):
            check_release.validate(self.root)
        (self.root / 'teacher-gate.html').write_text('<main>gate</main>')
        check_release.validate(self.root)

    def test_changed_source_or_minified_copy_is_rejected(self):
        for name in ('app.js', 'min/app.js'):
            with self.subTest(name=name):
                path = self.root / name
                saved = path.read_text()
                path.write_text(saved + 'changed')
                with self.assertRaises(ValueError):
                    check_release.validate(self.root)
                path.write_text(saved)

    def test_missing_asset_or_login_is_rejected(self):
        for name in ('min/app.js', 'admin-login.js', 'min/manifest.json'):
            with self.subTest(name=name):
                p = self.root / name
                saved = p.read_bytes()
                p.unlink()
                with self.assertRaises((ValueError, OSError)):
                    check_release.validate(self.root)
                p.write_bytes(saved)


class PrivateDownloadTest(unittest.TestCase):
    def archive(self, name='owner-repo/file.txt', kind=None):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tar:
            info = tarfile.TarInfo(name)
            if kind:
                info.type = kind
                info.linkname = '/etc/passwd'
                tar.addfile(info)
            else:
                info.size = 2
                tar.addfile(info, io.BytesIO(b'ok'))
        buf.seek(0)
        return buf

    def test_archive_strips_top_directory(self):
        with tempfile.TemporaryDirectory() as d:
            github_release.extract(self.archive(), Path(d))
            self.assertEqual((Path(d) / 'file.txt').read_bytes(), b'ok')

    def test_archive_rejects_traversal_and_links(self):
        for name, kind in [('repo/../../outside', None), ('/absolute', None),
                           ('repo/link', tarfile.SYMTYPE), ('repo/link', tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ValueError):
                    github_release.extract(self.archive(name, kind), Path(d))
                self.assertEqual(list(Path(d).iterdir()), [])

    def test_failed_token_validation_preserves_existing_token(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'token'
            path.write_text('previous_synthetic')
            with mock.patch.object(github_release, 'request', side_effect=HTTPError('url', 401, 'denied', {}, None)):
                with self.assertRaises(HTTPError):
                    github_release.save_token('bad_synthetic', path, 'owner/repo')
            self.assertEqual(path.read_text(), 'previous_synthetic')

    def test_token_written_privately_only_after_validation(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'token'
            with mock.patch.object(github_release, 'request', return_value=contextlib.nullcontext()):
                github_release.save_token('new_synthetic', path, 'owner/repo')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_text(), 'new_synthetic')

    def test_redirect_drops_token_on_archive_host_and_rejects_unknown_hosts(self):
        req = Request('https://api.github.com/repos/owner/repo/tarball/' + 'a' * 40,
                      headers={'Authorization': 'Bearer synthetic'})
        redirect = github_release.GitHubRedirect()
        forwarded = redirect.redirect_request(req, None, 302, '', {}, 'https://codeload.github.com/owner/repo/archive')
        self.assertIsNone(forwarded.get_header('Authorization'))
        with self.assertRaises(ValueError):
            redirect.redirect_request(req, None, 302, '', {}, 'https://example.com/archive')

    def test_header_injection_is_rejected(self):
        with self.assertRaises(ValueError):
            github_release.headers('token\r\nX-Injected: yes')
