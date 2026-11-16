#!/usr/bin/env python3
"""Rehearse an upgrade locally without replacing or modifying the installed DB.

Explicitly reads the installed SQLite database through its backup API, copies it
to a private temporary directory and starts only the candidate's DB migrations
there. This is private local processing, not anonymization. No database or row
data is uploaded. Network and mail are disabled in the migration subprocess.
"""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from deploy.acceptance import migration_check, readonly
from deploy.snapshot import release_info


def rehearse(installed_app, candidate, *, private_local_copy=False, timeout=120):
    if not private_local_copy:
        return {'format': 1, 'status': 'pending', 'ok': False,
                'evidence': 'private_local_processing_not_requested'}
    installed, candidate = Path(installed_app).resolve(), Path(candidate).resolve()
    source = installed / 'server_data/trainer.db'
    if source.is_symlink() or not source.is_file() or installed == candidate:
        return {'format': 1, 'status': 'fail', 'ok': False,
                'evidence': 'requires_installed_database_and_separate_candidate'}
    if not (candidate / 'server.py').is_file():
        return {'format': 1, 'status': 'fail', 'ok': False, 'evidence': 'candidate_release_not_found'}
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix='ege-private-upgrade-') as folder:
            snapshot = Path(folder) / 'snapshot.db'
            # Set permissions at creation, even when imported by a caller with a
            # permissive umask. TemporaryDirectory itself has mode 0700.
            fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            def deadline(_status, _remaining, _total):
                if time.monotonic() - started > timeout:
                    raise TimeoutError('snapshot deadline exceeded')
            with closing(readonly(source)) as original, closing(sqlite3.connect(snapshot)) as target:
                original.execute('PRAGMA query_only=ON')
                original.backup(target, pages=512, progress=deadline, sleep=0.1)
                # Only the temporary destination is checkpointed/closed. WAL
                # sidecars on the live source are intentionally supported.
                target.execute('PRAGMA journal_mode=DELETE')
                if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise sqlite3.DatabaseError('snapshot integrity failed')
            result = migration_check(snapshot, candidate, timeout=timeout, private_local_copy=True)
            # No row fingerprints or whole private DB identity leave this local
            # operation. The report only contains aggregate comparison results.
            detail = dict(result.get('detail') or {})
            detail.pop('source_sha256', None)
            if detail:
                result = dict(result, detail=detail)
            return {'format': 1, 'generated_at': time.time(), 'status': result['status'],
                    'ok': result['status'] == 'pass', 'evidence': 'private_local_sqlite_backup_rehearsal',
                    'source_access': 'mode=ro; query_only; SQLite backup API',
                    'installed_version': release_info(installed)['version'],
                    'candidate_version': release_info(candidate)['version'],
                    'elapsed_seconds': round(time.monotonic() - started, 3),
                    'migration': result,
                    'limitations': ['No anonymization was performed; the temporary private copy was removed.',
                                    'A pass covers stored values and relationships, not UI or teaching correctness.',
                                    'Live source data may change concurrently; source_unchanged refers to the closed snapshot.',
                                    'The installed service and database were not replaced.']}
    except Exception as exc:
        # SQLite and release errors can include private filenames or row values.
        return {'format': 1, 'status': 'fail', 'ok': False, 'evidence': 'local_rehearsal_failed',
                'error_type': type(exc).__name__}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installed-app', type=Path, default=Path('/opt/trainer'))
    parser.add_argument('--candidate', type=Path, required=True, help='separate reviewed candidate release directory')
    parser.add_argument('--private-local-copy', action='store_true', help='process the private snapshot only on this machine')
    parser.add_argument('--timeout', type=int, default=120)
    parser.add_argument('--output', type=Path, required=True, help='new private aggregate JSON report')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 3600:
        parser.error('--timeout must be between 1 and 3600 seconds')
    os.umask(0o077)
    # Refuse output overwrite before reading the installed database.
    with args.output.open('x') as output:
        result = rehearse(args.installed_app, args.candidate,
                          private_local_copy=args.private_local_copy, timeout=args.timeout)
        output.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return {'pass': 0, 'fail': 1, 'pending': 2}[result['status']]


if __name__ == '__main__':
    sys.exit(main())
