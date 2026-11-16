#!/usr/bin/env python3
"""Verify a snapshot and boot its isolated restored copy, never a production DB.

Copies trusted application code into a new temporary directory, restores data,
disables outbound mail in that copy, binds only loopback and checks health/version.
No account names, tokens or configuration values are printed. The copy is removed.
"""
import argparse
from contextlib import closing
import http.client
import json
import os
import re
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

try:
    from .snapshot import verify, digest, release_info
except ImportError:
    from snapshot import verify, digest, release_info


def copy_code(source, target):
    # Snapshot restores content/data separately. Never copy live server_data.
    for path in source.iterdir():
        if path.is_file() and path.suffix in ('.py', '.js', '.html', '.css') and not path.is_symlink():
            shutil.copy2(path, target / path.name)
    for name in ('min', 'maps'):
        if (source / name).is_dir():
            shutil.copytree(source / name, target / name)


def inventory(root):
    result = {}
    db_path = root / 'server_data/trainer.db'
    with closing(sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for name in ('students', 'assignments', 'attempts', 'solutions', 'support', 'together'):
            if name in tables:
                result[name] = db.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0]
    return result


def request(port, route, token=None):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        conn.request('GET', route, headers={'X-Token': token} if token else {})
        response = conn.getresponse()
        body = response.read()
        return response.status, body
    finally:
        conn.close()


def check(archive, source, probe=None):
    source = Path(source).resolve()
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='egeshka-recovery-') as temp:
        restored = Path(temp) / 'app'
        manifest = verify(archive, restored)
        verified_at = time.perf_counter()
        for name, expected in manifest.get('release', {}).get('source_hashes', {}).items():
            if name not in ('changelog.js', 'min/manifest.json') and not re.fullmatch(r'[A-Za-z0-9_-]+\.py', name):
                raise ValueError('Unsupported release identity entry')
            if not (source / name).is_file() or digest(source / name) != expected:
                raise ValueError('Application code differs from snapshot release: ' + name)
        before = inventory(restored)
        copy_code(source, restored)
        policy_path = restored / 'server_data/private_config.json'
        policy = json.loads(policy_path.read_text())
        for key in list(policy):
            if key.startswith('SMTP_'):
                policy[key] = ''
        # Environment and private policy must not inherit production mail routing.
        policy['SITE_URL'] = ''
        policy_path.write_text(json.dumps(policy))
        env = {k: v for k, v in os.environ.items() if not k.startswith('EGE_')}
        env['PYTHONUNBUFFERED'] = '1'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env['EGE_SITE_URL'] = f'http://127.0.0.1:{port}'
        command = [sys.executable, str(restored / 'server.py'), '--host', '127.0.0.1', '--port', str(port)]
        if (restored / 'banks').is_dir():
            command += ['--banks', str(restored / 'banks')]
        with (Path(temp) / 'private-startup.log').open('wb') as log:
            process = subprocess.Popen(command, cwd=restored, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 30
                health = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError('Isolated restored server exited before health check; no production data changed')
                    try:
                        status, body = request(port, '/api/health')
                        if status == 200:
                            health = json.loads(body)
                            if health.get('ok'):
                                break
                    except (OSError, ValueError, http.client.HTTPException):
                        pass
                    time.sleep(0.1)
                if not health or not health.get('ok'):
                    raise RuntimeError('Isolated restored server health timeout')
                expected = manifest.get('release', {}).get('version') or release_info(source)['version']
                if expected and health.get('version') != expected:
                    raise ValueError('Restored server version does not match snapshot')
                after = inventory(restored)
                if before != after:
                    raise ValueError('Application startup changed protected record counts')
                probes = probe(restored, port) if probe else {}
                return {'ok': True, 'scope': 'isolated restored copy, loopback only, mail disabled',
                        'version': health.get('version'), 'release_identity_recorded': bool(manifest.get('release')),
                        'verified_files': len(manifest['files']), 'banks': len(manifest.get('banks', [])),
                        'records': after, 'archive_verify_seconds': round(verified_at - started, 3),
                        'recovery_to_healthy_seconds': round(time.perf_counter() - started, 3),
                        'probes': probes}
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = check(args.archive, args.source)
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as exc:
        parser.exit(1, 'Recovery check failed: ' + str(exc) + '\n')
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    print(text, end='')
