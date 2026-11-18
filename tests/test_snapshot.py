"""Recover database WAL state, private config and all lesson attachment classes."""
import io
import json
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path

from deploy.snapshot import create, verify


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.data = self.app / 'server_data'
        self.data.mkdir(parents=True)
        self.db = sqlite3.connect(self.data / 'trainer.db')
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)')
        self.db.execute('CREATE TABLE results(id INTEGER PRIMARY KEY, answer TEXT)')
        self.db.execute("INSERT INTO results VALUES(1, 'saved before backup')")
        self.db.execute('INSERT INTO settings VALUES(?,?)', ('banks_root', str(self.root / 'external')))
        self.db.commit()
        self.files = {
            'server_data/private_config.json': '{"SMTP_PASSWORD":"synthetic"}',
            'server_data/support_img/pupil.png': 'synthetic image',
            'server_data/together_files/4/file-id': 'uploaded lesson input',
            'media/egeshka_bank/file.csv': '2,3',
            'data/bank.js': 'synthetic bank metadata',
            'course/13/lesson.json': 'synthetic lesson',
            'pycourse/files/17.txt': '13\n17',
        }
        for name, content in self.files.items():
            path = self.app / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        bank = self.root / 'external/exam_bank/files'
        bank.mkdir(parents=True)
        (bank / 'input.txt').write_text('outside application folder')
        self.archive = self.root / 'backups/full.tar.gz'

    def test_full_snapshot_restores_data_and_files(self):
        create(self.data / 'trainer.db', self.archive)
        restored = self.root / 'restored'
        manifest = verify(self.archive, restored)
        for name, content in self.files.items():
            self.assertEqual((restored / name).read_text(), content)
        self.assertEqual((restored / 'banks/exam_bank/files/input.txt').read_text(), 'outside application folder')
        self.assertEqual(manifest['banks'], ['exam_bank'])
        self.assertNotIn('server_data/trainer.db-wal', manifest['files'])
        with sqlite3.connect(restored / 'server_data/trainer.db') as db:
            self.assertEqual(db.execute('SELECT answer FROM results').fetchone()[0], 'saved before backup')
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)

    def test_quick_snapshot_has_database_and_pupil_files_but_no_release_assets(self):
        create(self.data / 'trainer.db', self.archive, assets=False)
        restored = self.root / 'restored'
        manifest = verify(self.archive, restored)
        self.assertEqual((manifest['scope'], manifest['banks']), ('quick', []))
        for name, content in self.files.items():
            if name.startswith('server_data/'):
                self.assertEqual((restored / name).read_text(), content)
            else:
                self.assertFalse((restored / name).exists(), name)       # банки и материалы — только в полной копии
        self.assertFalse((restored / 'banks').exists())
        with sqlite3.connect(restored / 'server_data/trainer.db') as db:
            self.assertEqual(db.execute('SELECT answer FROM results').fetchone()[0], 'saved before backup')

    def test_restore_refuses_nonempty_destination(self):
        create(self.data / 'trainer.db', self.archive)
        with self.assertRaisesRegex(ValueError, 'empty'):
            verify(self.archive, self.app)
        self.assertEqual(self.db.execute('SELECT count(*) FROM results').fetchone()[0], 1)

    def test_corrupt_file_rejected_before_any_restore_write(self):
        create(self.data / 'trainer.db', self.archive)
        bad = self.root / 'bad.tar.gz'
        with tarfile.open(self.archive, 'r:gz') as source, tarfile.open(bad, 'w:gz') as dest:
            for member in source.getmembers():
                body = source.extractfile(member).read()
                if member.name == 'media/egeshka_bank/file.csv':
                    body = b'0,0'
                dest.addfile(member, io.BytesIO(body))
        restored = self.root / 'restored'
        with self.assertRaisesRegex(ValueError, 'checksum'):
            verify(bad, restored)
        self.assertFalse(restored.exists())

    def test_archive_traversal_rejected(self):
        with tarfile.open(self.root / 'unsafe.tar.gz', 'w:gz') as tar:
            info = tarfile.TarInfo('../outside')
            info.size = 1
            tar.addfile(info, io.BytesIO(b'x'))
            archive = tar.name
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            verify(archive, self.root / 'restored')

    def test_symlink_does_not_copy_secret_outside_inventory(self):
        (self.data / 'link').symlink_to(self.root / 'external/exam_bank/files/input.txt')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            create(self.data / 'trainer.db', self.archive)
        self.assertFalse(self.archive.exists())

    def test_missing_database_attachment_fails_instead_of_incomplete_success(self):
        self.db.execute('CREATE TABLE support(id INTEGER, img TEXT)')
        self.db.execute("INSERT INTO support VALUES(1, 'deleted.png')")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, 'Missing support attachment'):
            create(self.data / 'trainer.db', self.archive)
        self.assertFalse(self.archive.exists())

    def test_duplicate_bank_name_uses_same_precedence_as_runtime(self):
        self.db.execute("DELETE FROM settings WHERE key='banks_root'")
        self.db.commit()
        for base, text in ((self.root, 'active bank beside application'),
                           (self.app, 'shadowed bank inside application')):
            path = base / 'duplicate_bank/input.txt'
            path.parent.mkdir(parents=True)
            path.write_text(text)
        create(self.data / 'trainer.db', self.archive)
        restored = self.root / 'restored'
        verify(self.archive, restored)
        self.assertEqual((restored / 'banks/duplicate_bank/input.txt').read_text(),
                         'active bank beside application')
