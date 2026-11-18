#!/usr/bin/env python3
"""Complete, verifiable snapshots; restore only into a new, empty directory.

Does not stop or replace the running service. Database uses SQLite's online backup
API; mutable files are checked while copied. Restore is an operator staging step.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def release_info(app):
    """Record matching code identity without archiving application credentials."""
    # Local modules are part of the release, including handlers, the verifier
    # client and its protocol. Pinning only server.py misses extracted modules.
    names = sorted(p.name for p in app.glob('*.py') if p.is_file()) + ['changelog.js', 'min/manifest.json']
    hashes = {name: digest(app / name) for name in names if (app / name).is_file()}
    text = (app / 'changelog.js').read_text(encoding='utf-8') if (app / 'changelog.js').is_file() else ''
    versions = re.findall(r'\[\s*"(\d+)\.(\d+)\.(\d+)"', text)
    version = '.'.join(map(str, max(tuple(map(int, v)) for v in versions))) if versions else None
    return {'version': version, 'source_hashes': hashes}


def bank_locations(app, database):
    roots = []
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
        try:
            row = db.execute("SELECT value FROM settings WHERE key='banks_root'").fetchone()
            if row and row[0]:
                roots.append(Path(row[0]))
        except sqlite3.OperationalError:
            pass
    # Match server.bank_roots exactly: the first bank with a given name wins.
    roots.append(app.parent)
    a = app
    for _ in range(4):
        roots += [a.parent, a.parent / 'Biblio']
        a = a.parent
    roots.append(app)
    report = app / 'data/report.txt'
    if report.is_file():
        roots += [Path(m.group(1).strip()) for m in re.finditer(
            r'(/[^\r\n]*?)/[A-Za-z0-9_\-]+_bank/', report.read_text(errors='replace'))]
    found = {}
    for root in dict.fromkeys(roots):
        if root.is_dir():
            for bank in sorted(root.glob('*_bank')):
                if bank.is_dir() and bank.name not in found:
                    found[bank.name] = bank
    return found


def copy_tree(source, target, excluded=()):
    if not source.exists():
        return
    if source.is_symlink():
        raise ValueError('Symlink is not a portable backup: ' + str(source))
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if relative.parts[0] in excluded or '__pycache__' in relative.parts:
            continue
        if path.is_symlink():
            raise ValueError('Symlink is not a portable backup: ' + str(path))
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError('Unsupported file: ' + str(path))
        before = path.stat()
        out = target / relative
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, out)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('File changed during snapshot, retry: ' + str(path))
        out.chmod(0o600)


def check_references(stage):
    """A concurrent deletion must fail the snapshot, not silently lose a DB attachment."""
    with closing(sqlite3.connect(stage / 'server_data/trainer.db')) as db:
        for table in ('support', 'support_msgs'):
            columns = {row[1] for row in db.execute('PRAGMA table_info(' + table + ')')}
            if 'img' in columns:
                for (name,) in db.execute('SELECT img FROM ' + table + ' WHERE img IS NOT NULL AND img != \'\''):
                    if Path(name).name != name or not (stage / 'server_data/support_img' / name).is_file():
                        raise ValueError('Missing support attachment; retry snapshot after lesson')
        columns = {row[1] for row in db.execute('PRAGMA table_info(together)')}
        if {'id', 'state'} <= columns:
            for sid, state in db.execute('SELECT id, state FROM together WHERE state IS NOT NULL'):
                for page in (json.loads(state or '{}').get('pages') or {}).values():
                    for item in page.get('files') or []:
                        name = str(item.get('id') or '')
                        if not re.fullmatch('[0-9a-f]{16}', name) or not (
                                stage / 'server_data/together_files' / str(int(sid)) / name).is_file():
                            raise ValueError('Missing lesson attachment; retry snapshot after lesson')


def create(database, output, app=None, assets=True):
    """assets=False — быстрая копия: база, server_data и приватные настройки, без банков и учебных материалов
    (они приходят с выпуском и меняются редко; их сохраняет еженедельная полная копия)."""
    database = Path(database).resolve()
    output = Path(output).resolve()
    app = Path(app).resolve() if app else database.parent.parent
    if not database.is_file():
        raise ValueError('Database not found')
    if output.parent.is_relative_to(database.parent):
        raise ValueError('Backup destination must be outside the runtime data directory')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.snapshot-', dir=output.parent) as temp:
        stage = Path(temp)
        target_db = stage / 'server_data/trainer.db'
        target_db.parent.mkdir()
        source = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        dest = sqlite3.connect(target_db)
        try:
            source.backup(dest)
            dest.execute('PRAGMA journal_mode=DELETE')
            if dest.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Backup integrity check failed')
        finally:
            dest.close()
            source.close()
        copy_tree(database.parent, target_db.parent,
                  (database.name, database.name + '-wal', database.name + '-shm', database.name + '-journal'))
        private = os.environ.get('EGE_PRIVATE_CONFIG')
        if private:
            private = Path(private)
            if not private.is_file() or private.is_symlink():
                raise ValueError('Configured private policy is missing or is a symlink')
            shutil.copyfile(private, stage / 'server_data/private_config.json')
        banks = {}
        if assets:
            for name in ('data', 'media', 'course', 'pycourse'):
                copy_tree(app / name, stage / name)
            banks = bank_locations(app, target_db)
            for name, location in banks.items():
                copy_tree(location, stage / 'banks' / name)
        check_references(stage)
        files = {p.relative_to(stage).as_posix(): {'size': p.stat().st_size, 'sha256': digest(p)}
                 for p in sorted(stage.rglob('*')) if p.is_file()}
        manifest = {'format': 1, 'created': time.time(), 'database': 'server_data/trainer.db', 'scope': 'full' if assets else 'quick',
                    'release': release_info(app),
                    'files': files, 'banks': sorted(banks),
                    'restore_note': 'Restore alongside matching application release; configure banks_root to restored banks.'}
        (stage / 'snapshot.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        archive = stage / 'archive.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in ['snapshot.json'] + list(files):
                tar.add(stage / name, arcname=name, recursive=False)
        archive.chmod(0o600)
        verify(archive)
        # A failed snapshot never replaces a previous valid backup.
        if output.exists():
            raise ValueError('Snapshot destination already exists')
        os.replace(archive, output)
    return output


def verify(archive, destination=None):
    with tempfile.TemporaryDirectory(prefix='ege-restore-check-') as temp:
        stage = Path(temp)
        with tarfile.open(archive, 'r:gz') as tar:
            members = tar.getmembers()
            names = set()
            for member in members:
                path = PurePosixPath(member.name)
                if (not member.isfile() or path.is_absolute() or '..' in path.parts
                        or '\\' in member.name or member.name in names):
                    raise ValueError('Unsafe or duplicate archive entry')
                names.add(member.name)
            if 'snapshot.json' not in names:
                raise ValueError('Missing snapshot manifest')
            with tar.extractfile('snapshot.json') as stream:
                manifest = json.load(stream)
            if manifest.get('format') != 1 or manifest.get('database') != 'server_data/trainer.db':
                raise ValueError('Unsupported snapshot format')
            if names != set(manifest['files']) | {'snapshot.json'}:
                raise ValueError('Snapshot file inventory mismatch')
            for member in members:
                if member.name == 'snapshot.json':
                    continue
                record = manifest['files'][member.name]
                if member.size != record['size']:
                    raise ValueError('Snapshot size mismatch: ' + member.name)
                out = stage / member.name
                out.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as inp, out.open('wb') as dest:
                    shutil.copyfileobj(inp, dest)
                out.chmod(0o600)
                if digest(out) != record['sha256']:
                    raise ValueError('Snapshot checksum mismatch: ' + member.name)
        with closing(sqlite3.connect(stage / manifest['database'])) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Restored database integrity check failed')
        if destination is not None:
            destination = Path(destination).resolve()
            if destination.exists() and any(destination.iterdir()):
                raise ValueError('Restore destination must be empty; never overwrite a running site')
            destination.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copytree(stage, destination, dirs_exist_ok=True)
            (destination / 'snapshot.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            (destination / 'snapshot.json').chmod(0o600)
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('create')
    p.add_argument('database')
    p.add_argument('output')
    p.add_argument('--app')
    p.add_argument('--quick', action='store_true', help='без банков и учебных материалов — секунды вместо минут')
    p = sub.add_parser('verify')
    p.add_argument('archive')
    p = sub.add_parser('restore')
    p.add_argument('archive')
    p.add_argument('destination')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == 'create':
            print('Verified quick snapshot:' if args.quick else 'Verified full snapshot:',
                  create(args.database, args.output, args.app, assets=not args.quick))
        else:
            manifest = verify(args.archive, getattr(args, 'destination', None))
            print('Verified files:', len(manifest['files']))
    except (OSError, ValueError, KeyError, sqlite3.Error, tarfile.TarError) as exc:
        parser.exit(1, 'Snapshot failed: ' + str(exc) + '\n')


if __name__ == '__main__':
    main()
