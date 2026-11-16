"""Recovery must boot real handlers and preserve checkpoint results/attachments."""
import json
import hashlib
from pathlib import Path
import sqlite3
import shutil
import tempfile
import unittest

from deploy.snapshot import create, release_info
from deploy.recovery_check import check
from deploy.preflight import inspect
from tools.recovery_drill import run
from tools.build_changelog_loader import build
from tools.check_release import write_manifest


class RecoveryChecksTest(unittest.TestCase):
    def test_valid_preflight_is_read_only_and_checks_complete_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'app'
            for name in ('server_data', 'min', 'tools'):
                (app / name).mkdir(parents=True)
            (app / 'server.py').write_text('MIN_FILES = ("app.js",)\n')
            (app / 'app.js').write_text('window.synthetic = 1;')
            (app / 'min/app.js').write_text('window.synthetic=1;')
            (app / 'admin-login.js').write_text('// synthetic login')
            (app / 'changelog.js').write_text('window.EGE_CHANGELOG={student:[["1.2.3","test",[],[]]],teacher:[["1.2.3","test",[],[]]]};')
            shutil.copy(Path(__file__).resolve().parents[1] / 'tools/changelog-loader.template.js', app / 'tools/changelog-loader.template.js')
            (app / 'changelog-loader.js').write_text(build(app))
            write_manifest(app)
            policy = app / 'server_data/private_config.json'
            policy.write_text(json.dumps({'TASK_BTC': {str(i): '1/3' for i in range(1, 28)}}))
            policy.chmod(0o600)
            with sqlite3.connect(app / 'server_data/trainer.db') as db:
                db.execute('CREATE TABLE settings(key TEXT, value TEXT)')
            create(app / 'server_data/trainer.db', root / 'backups/trainer-test.tar.gz')
            before = {p.relative_to(app).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in app.rglob('*') if p.is_file()}
            result = inspect(app, root / 'backups', verify_latest=True)
            after = {p.relative_to(app).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in app.rglob('*') if p.is_file()}
            self.assertTrue(result['ok'], result)
            self.assertEqual(before, after)

    def test_actual_restored_server_keeps_work_files_and_version(self):
        result = run()
        self.assertTrue(result['ok'])
        self.assertEqual(result['records']['assignments'], 1)
        self.assertEqual(result['records']['attempts'], 1)
        self.assertTrue(result['probes']['lesson_attachment_served'])
        self.assertTrue(result['probes']['external_bank_image_served'])
        self.assertTrue(result['probes']['post_checkpoint_write_absent'])
        self.assertEqual(result['version'], release_info(Path(__file__).resolve().parents[1])['version'])

    def test_different_code_is_rejected_before_boot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'app'
            (app / 'server_data').mkdir(parents=True)
            with sqlite3.connect(app / 'server_data/trainer.db') as db:
                db.execute('CREATE TABLE settings(key TEXT, value TEXT)')
            (app / 'server.py').write_text('# matching release\n')
            archive = root / 'snapshot.tar.gz'
            create(app / 'server_data/trainer.db', archive)
            (app / 'server.py').write_text("raise RuntimeError('wrong release must not execute')\n")
            with self.assertRaisesRegex(ValueError, 'code differs'):
                check(archive, app)

    def test_extracted_handler_change_is_part_of_release_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'app'
            (app / 'server_data').mkdir(parents=True)
            with sqlite3.connect(app / 'server_data/trainer.db') as db:
                db.execute('CREATE TABLE settings(key TEXT, value TEXT)')
            (app / 'server.py').write_text('import task_http\n')
            (app / 'task_http.py').write_text('REVISION = 1\n')
            archive = root / 'snapshot.tar.gz'
            create(app / 'server_data/trainer.db', archive)
            (app / 'task_http.py').write_text('REVISION = 2\n')
            with self.assertRaisesRegex(ValueError, 'task_http.py'):
                check(archive, app)

    def test_preflight_reports_missing_requirements_without_private_values(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'app'
            (app / 'server_data').mkdir(parents=True)
            policy = app / 'server_data/private_config.json'
            policy.write_text(json.dumps({'SMTP_PASS': 'never-print-synthetic-secret',
                                         'TASK_BTC': {str(i): '1/3' for i in range(1, 28)}}))
            policy.chmod(0o600)
            result = inspect(app, Path(temp) / 'backups')
            self.assertFalse(result['ok'])
            self.assertNotIn('never-print-synthetic-secret', json.dumps(result))
            self.assertTrue(next(c for c in result['checks'] if c['check'] == 'private_policy')['ok'])
