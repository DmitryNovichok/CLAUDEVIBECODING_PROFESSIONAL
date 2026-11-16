#!/usr/bin/env python3
"""Read-only deployment/recovery readiness checks; never print private values."""
import argparse
from contextlib import closing
from fractions import Fraction
import http.client
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from deploy.snapshot import bank_locations, release_info, verify
from tools.check_release import validate


def inspect(app, backups, port=None, verify_latest=False):
    app, backups = Path(app).resolve(), Path(backups).resolve()
    checks = []

    def record(name, passed, detail=None):
        checks.append({'check': name, 'ok': bool(passed), **({'detail': detail} if detail is not None else {})})

    record('python_version', sys.version_info >= (3, 10), '.'.join(map(str, sys.version_info[:3])))
    try:
        for file in app.glob('*.py'):
            compile(file.read_bytes(), file.name, 'exec')
        validate(app)
        record('release_assets_and_python_syntax', True)
    except (OSError, ValueError, SyntaxError) as exc:
        record('release_assets_and_python_syntax', False, type(exc).__name__)
    expected = release_info(app)['version']
    policy = Path(os.environ.get('EGE_PRIVATE_CONFIG') or app / 'server_data/private_config.json')
    try:
        config = json.loads(policy.read_text())
        rewards = config.get('TASK_BTC') or {}
        record('private_policy', set(map(int, rewards)) == set(range(1, 28)) and all(Fraction(v) >= 0 for v in rewards.values()))
        record('private_file_permissions', not (policy.stat().st_mode & 0o077))
    except (OSError, ValueError, TypeError):
        record('private_policy', False, 'missing_or_invalid')
    db_path = app / 'server_data/trainer.db'
    banks = {}
    try:
        with closing(sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)) as db:
            record('database_quick_check', db.execute('PRAGMA quick_check').fetchone()[0] == 'ok')
        banks = bank_locations(app, db_path)
    except (OSError, sqlite3.Error):
        record('database_quick_check', False, 'database_unavailable')
    paths = [app / n for n in ('server_data', 'media', 'data', 'course', 'pycourse')] + list(banks.values())
    links = [p for base in paths if base.exists() for p in [base, *base.rglob('*')] if p.is_symlink()]
    record('portable_snapshot_inventory', not links, {'symlinks': len(links)})
    inventory = [p for base in paths if base.is_dir() for p in base.rglob('*') if p.is_file() and not p.is_symlink()]
    total = sum(p.stat().st_size for p in inventory)
    target = backups if backups.exists() else backups.parent
    if target.exists():
        free = shutil.disk_usage(target).free
        record('snapshot_space_estimate', free >= max(100 * 1024 * 1024, total * 3),
               {'free_bytes': free, 'data_bytes': total, 'conservative_required_bytes': total * 3})
    else:
        record('snapshot_space_estimate', False, 'backup_parent_missing')
    temporary_free = shutil.disk_usage(tempfile.gettempdir()).free
    record('verification_temp_space', temporary_free >= max(100 * 1024 * 1024, total),
           {'free_bytes': temporary_free, 'required_bytes': total})
    copies = sorted(backups.glob('trainer-*.tar.gz'), key=lambda p: p.stat().st_mtime, reverse=True) if backups.exists() else []
    if copies:
        age = time.time() - copies[0].stat().st_mtime
        record('recent_full_snapshot', age < 26 * 3600, {'age_hours': round(age / 3600, 2)})
        if verify_latest:
            try:
                manifest = verify(copies[0])
                record('latest_snapshot_checksums', True, {'files': len(manifest['files'])})
            except Exception as exc:
                record('latest_snapshot_checksums', False, type(exc).__name__)
    else:
        record('recent_full_snapshot', False, 'no_full_snapshot')
    if port is not None:
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        try:
            conn.request('GET', '/api/health')
            response = conn.getresponse()
            health = json.loads(response.read())
            record('running_health_and_version', response.status == 200 and health.get('ok') and health.get('version') == expected,
                   {'expected_version': expected, 'running_version': health.get('version')})
        except (OSError, ValueError, http.client.HTTPException):
            record('running_health_and_version', False, 'unavailable')
        finally:
            conn.close()
    return {'ok': all(c['ok'] for c in checks), 'version': expected, 'checks': checks,
            'limitations': ['Does not configure cron/systemd, SMTP or offsite storage.',
                            'Service environment may differ from this shell; check service secrets separately without printing them.',
                            'Disk estimate is conservative, not a recovery-time guarantee.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=Path('/opt/trainer'))
    parser.add_argument('--backups', type=Path, default=Path('/opt/trainer-backups'))
    parser.add_argument('--port', type=int)
    parser.add_argument('--verify-latest', action='store_true')
    args = parser.parse_args()
    if args.port is not None and not 1 <= args.port <= 65535:
        parser.error('--port must be 1..65535')
    result = inspect(args.app, args.backups, args.port, args.verify_latest)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['ok'] else 1)
