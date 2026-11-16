#!/usr/bin/env python3
"""Collect deployment evidence without changing the running site.

Default: local reads only. HTTPS GETs, an isolated migration rehearsal and a
runner smoke request require explicit options. Missing evidence is PENDING,
never PASS. Mail is never sent and no account/session/production DB is changed.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from deploy.snapshot import digest, release_info, verify
from deploy.migration_evidence import (PROTECTED_TABLES, changed_values,
                                       relationship_violations, stored_values)

FORMAT = 1


def record(name, status, evidence, detail=None):
    return {'check': name, 'status': status, 'evidence': evidence,
            **({'detail': detail} if detail is not None else {})}


def readonly(database):
    return sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)


def local_checks(app):
    """Return booleans only; never include names, addresses, tokens or settings."""
    checks = []
    config_path = Path(os.environ.get('EGE_PRIVATE_CONFIG') or app / 'server_data/private_config.json')
    config = {}
    try:
        config = json.loads(config_path.read_text())
        if not isinstance(config, dict):
            raise ValueError('invalid policy')
        checks.append(record('private_configuration_permissions',
                             'pass' if not config_path.stat().st_mode & 0o077 else 'fail', 'local_file_mode'))
    except (OSError, ValueError, TypeError):
        config = {}
        checks.append(record('private_configuration_permissions', 'pending', 'configuration_unavailable'))
    # This process may have a different environment than the service. Presence
    # does not establish SMTP connectivity, acceptance, or inbox delivery.
    smtp = {k: os.environ.get('EGE_' + k) or config.get(k) for k in ('SMTP_HOST', 'SMTP_FROM')}
    checks.append(record('smtp_configuration_present', 'pass' if all(smtp.values()) else 'pending',
                         'current_process_configuration_only'))
    try:
        with closing(readonly(app / 'server_data/trainer.db')) as db:
            healthy = db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
            row = db.execute("SELECT value FROM settings WHERE key='main_login_code'").fetchone()
            principal = db.execute('SELECT email FROM teachers WHERE is_main=1').fetchall()
            enabled = row is not None and row[0] == '1' and len(principal) == 1 and bool(principal[0][0])
        checks.append(record('database_quick_check', 'pass' if healthy else 'fail', 'read_only_sqlite'))
        checks.append(record('principal_second_factor_required', 'pass' if enabled else 'fail', 'stored_policy'))
    except (OSError, sqlite3.Error):
        checks.append(record('database_quick_check', 'pending', 'database_unavailable_or_unsupported'))
        checks.append(record('principal_second_factor_required', 'pending', 'database_unavailable_or_unsupported'))
    return checks


def snapshot_check(archive, app, max_age_hours=26):
    """Check contents/creation time, not a mutable archive filesystem timestamp."""
    try:
        manifest = verify(archive)
        age = time.time() - float(manifest['created'])
        expected = release_info(app)
        identity = manifest.get('release') or {}
        matches = bool(expected.get('source_hashes')) and identity == expected
        ok = 0 <= age <= max_age_hours * 3600 and matches
        return record('full_snapshot', 'pass' if ok else 'fail', 'verified_archive_contents',
                      {'age_hours': round(age / 3600, 2), 'release_matches': matches,
                       'files': len(manifest['files']), 'sha256': digest(Path(archive))})
    except Exception as exc:
        # Archive/SQLite exceptions can contain file names or database values.
        return record('full_snapshot', 'fail', 'archive_verification_failed', {'error_type': type(exc).__name__})


def csp_is_restricted(policy, origin):
    """Reject missing/expanded executable policies, including element overrides."""
    directives = {}
    for part in policy.split(';'):
        tokens = part.split()
        if not tokens:
            continue
        if tokens[0] in directives:
            return False
        directives[tokens[0]] = set(tokens[1:])
    for name, expected in (('default-src', {"'none'"}), ('object-src', {"'none'"}),
                           ('base-uri', {"'self'"}), ('frame-ancestors', {"'self'"}),
                           ('form-action', {"'self'"})):
        if directives.get(name) != expected:
            return False
    allowed_script = {"'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"}
    runtime = re.compile(r'https://cdn\.jsdelivr\.net/pyodide/v\d+\.\d+\.\d+/full/')
    scripts = directives.get('script-src', set())
    if "'self'" not in scripts or any(s not in allowed_script and not runtime.fullmatch(s) for s in scripts):
        return False
    for name in ('script-src-elem', 'script-src-attr'):
        if name in directives and not directives[name] <= scripts | {"'none'"}:
            return False
    connections = directives.get('connect-src', set())
    if not connections or "'self'" not in connections:
        return False
    for entry in connections - {"'self'"}:
        if runtime.fullmatch(entry):
            continue
        parsed = urlsplit(entry)
        try:
            same_endpoint = (parsed.scheme == 'wss' and parsed.hostname == origin.hostname
                             and (parsed.port or 443) == (origin.port or 443)
                             and parsed.username is None and parsed.password is None
                             and parsed.path == '/api/together/ws' and not parsed.query and not parsed.fragment)
        except ValueError:
            return False
        if not same_endpoint:
            return False
    return True


def https_checks(url, expected_version):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError('HTTPS origin required')
        port = parsed.port or 443
    except ValueError:
        return [record('public_https', 'fail', 'invalid_https_origin')]
    checks = []
    for route in ('/welcome', '/api/health'):
        connection = http.client.HTTPSConnection(parsed.hostname, port, timeout=10)
        try:
            connection.request('GET', route, headers={'User-Agent': 'Egeshka-deployment-acceptance/1'})
            response = connection.getresponse()
            # Never follow redirects to another service or send cookies/credentials.
            body = response.read(65537)
            if response.status != 200 or len(body) > 65536:
                raise ValueError('unexpected response')
            if route == '/welcome':
                hsts = response.getheader('Strict-Transport-Security', '')
                max_age = re.search(r'(?:^|;)\s*max-age\s*=\s*(\d+)(?:\s*;|\s*$)', hsts, re.I)
                csp = response.getheader('Content-Security-Policy', '')
                # A response policy is evidence of enforcement at this public
                # endpoint; functional browser security remains a separate test.
                hardened = (bool(max_age) and int(max_age[1]) >= 31536000
                            and csp_is_restricted(csp, parsed)
                            and response.getheader('X-Content-Type-Options', '').lower() == 'nosniff')
                checks.append(record('public_https_headers', 'pass' if hardened else 'fail',
                                     'verified_tls_get_welcome'))
            else:
                data = json.loads(body)
                if not isinstance(data, dict):
                    raise ValueError('invalid health response')
                safe_version = lambda value: value if isinstance(value, str) and re.fullmatch(r'\d+\.\d+\.\d+', value) else None
                expected, reported = safe_version(expected_version), safe_version(data.get('version'))
                ok = data.get('ok') is True and expected is not None and reported == expected
                checks.append(record('public_running_release', 'pass' if ok else 'fail', 'verified_tls_get_health',
                                     {'expected_version': expected, 'reported_version': reported}))
        except (OSError, ValueError, TypeError, http.client.HTTPException):
            checks.append(record('public_https_headers' if route == '/welcome' else 'public_running_release',
                                 'fail', 'tls_or_http_check_failed'))
        finally:
            connection.close()
    return checks


def database_inventory(connection):
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return {name: connection.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0]
            for name in PROTECTED_TABLES if name in tables}


def schema_digest(connection):
    rows = connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
    return hashlib.sha256(json.dumps([list(row) for row in rows]).encode()).hexdigest()


def migration_worker(database, output, app):
    # Runs in a separate process with an empty private policy and no inherited
    # EGE_* routing. Importing server does not start the HTTP server or mail loop.
    # Only reviewed application code belongs here. Python audit hooks prevent
    # accidental network/process use, not hostile native-code execution; this
    # subprocess is not an operating-system sandbox for untrusted releases.
    def block_network(event, args):
        if event in ('socket.__new__', 'socket.connect', 'socket.connect_ex',
                     'socket.bind', 'socket.getaddrinfo', 'socket.sendto', 'socket.sendmsg',
                     'subprocess.Popen', 'os.system', 'os.exec', 'os.posix_spawn',
                     'os.spawn', 'os.fork', 'os.forkpty'):
            raise RuntimeError('network and child processes disabled during migration rehearsal')
    sys.addaudithook(block_network)
    sys.path.insert(0, str(app))
    import server
    if Path(server.__file__).resolve() != (Path(app) / 'server.py').resolve():
        raise RuntimeError('migration release not found')
    with closing(sqlite3.connect(database)) as before:
        original = database_inventory(before)
        original_values = stored_values(before)
        original_links = relationship_violations(before)
    first = server.DB(Path(database))
    try:
        migrated = database_inventory(first.conn)
        value_changes = changed_values(original_values, stored_values(first.conn,
            {table: item['columns'] for table, item in original_values.items()}))
        first_values = stored_values(first.conn)
        links = relationship_violations(first.conn)
        schema = schema_digest(first.conn)
        integrity = first.conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    finally:
        first.conn.close()
    second = server.DB(Path(database))
    try:
        second_changes = changed_values(first_values, stored_values(second.conn))
        stable = (migrated == database_inventory(second.conn) and schema == schema_digest(second.conn)
                  and not second_changes and links == relationship_violations(second.conn))
        integrity = integrity and second.conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    finally:
        second.conn.close()
    changes = {name: {'before': count, 'after': migrated.get(name)}
               for name, count in original.items() if migrated.get(name) != count}
    Path(output).write_text(json.dumps({'integrity': integrity, 'second_start_stable': stable,
                                      'record_count_changes': changes, 'record_value_changes': value_changes,
                                      'second_start_value_changes': second_changes,
                                      'relationship_violations': links,
                                      'introduced_relationship_violations': {
                                          key: count for key, count in links.items()
                                          if count > original_links.get(key, 0)},
                                      'protected_tables': len(original),
                                      'protected_table_names': list(original)}))


def migration_check(database, app, anonymized=False, timeout=120, private_local_copy=False):
    source = Path(database)
    if not anonymized and not private_local_copy:
        return record('old_database_migration', 'pending', 'anonymized_input_confirmation_required')
    if source.is_symlink() or not source.is_file() or any(Path(str(source) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
        return record('old_database_migration', 'fail', 'requires_closed_regular_sqlite_copy')
    if not (Path(app) / 'server.py').is_file():
        return record('old_database_migration', 'fail', 'migration_release_not_found')
    try:
        before = digest(source)
        with tempfile.TemporaryDirectory(prefix='ege-migration-acceptance-') as temp:
            temp = Path(temp)
            copy = temp / 'trainer.db'
            shutil.copyfile(source, copy)
            copy.chmod(0o600)
            output = temp / 'result.json'
            policy = temp / 'empty-policy.json'
            policy.write_text('{}')
            env = {k: v for k, v in os.environ.items() if not k.startswith('EGE_') and k not in ('PYTHONPATH', 'PYTHONSTARTUP')}
            env.update(EGE_PRIVATE_CONFIG=str(policy), PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--_migration-worker',
                                     str(copy), str(output), str(Path(app).resolve())],
                                    cwd=temp, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=timeout, check=False)
            if result.returncode != 0 or not output.is_file():
                return record('old_database_migration', 'fail', 'isolated_migration_failed')
            data = json.loads(output.read_text())
            unchanged = digest(source) == before
            ok = (data['integrity'] and data['second_start_stable'] and unchanged
                  and not data['introduced_relationship_violations'])
            # Migrations can intentionally retire invalid attempts. A successful
            # SQL upgrade is not approval of changed educational records.
            changes_need_review = (data['record_count_changes'] or data['record_value_changes']
                                   or data['relationship_violations'])
            status = 'fail' if not ok else ('pending' if changes_need_review else 'pass')
            return record('old_database_migration', status,
                          'isolated_anonymized_copy' if anonymized else 'isolated_private_local_copy',
                          {**data, 'source_unchanged': unchanged, 'source_sha256': before,
                           'scope': 'schema, integrity, protected stored values and ownership links; not educational or UI validation'})
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as exc:
        return record('old_database_migration', 'fail', 'isolated_migration_failed', {'error_type': type(exc).__name__})


def runner_check():
    try:
        from buglab_verifier import Client
        runs = Client().execute('print(6 * 7)', [''])
        ok = len(runs) == 1 and runs[0]['status'] == 'ok' and runs[0]['out'] == '42\n'
        return record('installed_runner_smoke', 'pass' if ok else 'fail', 'authenticated_unix_socket_execution')
    except Exception as exc:
        return record('installed_runner_smoke', 'fail', 'runner_unavailable', {'error_type': type(exc).__name__})


def container_report_check(path, revision=None):
    required = {'test_reference_program_passes_independently_and_broken_program_fails',
                'test_no_host_files_secrets_network_or_root_writes',
                'test_timeout_output_flood_and_memory_limit_never_become_success',
                'test_fresh_container_for_each_test'}
    try:
        report = json.loads(Path(path).read_text())
        timestamp = datetime.fromisoformat(report['generated_at'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('timestamp must include timezone')
        age = (datetime.now(timezone.utc) - timestamp).total_seconds()
        ids = report.get('test_ids', [])
        valid = (report.get('schema') == 'egeshka.python-runner-acceptance.v1'
                 and re.fullmatch(r'sha256:[0-9a-f]{64}', str(report.get('image', '')))
                 and report.get('tests_run') == 4 and report.get('tests_failed') == 0
                 and report.get('tests_skipped') == 0 and report.get('passed') is True
                 and isinstance(ids, list) and len(ids) == 4
                 and {s.rsplit('.', 1)[-1] for s in ids} == required
                 and isinstance(report.get('isolation'), dict) and bool(report['isolation'])
                 and 0 <= age <= 86400)
        if not valid:
            return record('container_isolation_acceptance', 'fail', 'invalid_stale_or_incomplete_container_report')
        if not revision:
            return record('container_isolation_acceptance', 'pending', 'expected_release_revision_not_supplied')
        matches = bool(re.fullmatch(r'[0-9a-f]{40}', revision)) and report.get('source_revision') == revision
        return record('container_isolation_acceptance', 'pass' if matches else 'fail', 'external_container_report',
                      {'tests_run': 4, 'tests_skipped': 0, 'revision_matches': bool(matches),
                       'scope': 'report evidence; installed service is checked separately'})
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return record('container_isolation_acceptance', 'fail', 'invalid_container_report')


def inspect(app, archive=None, url=None, migration_db=None, anonymized=False, probe_runner=False,
            runner_report=None, revision=None, private_local_copy=False, expected_version=None):
    app = Path(app).resolve()
    release = release_info(app)
    checks = local_checks(app)
    checks.append(snapshot_check(archive, app) if archive else record('full_snapshot', 'pending', 'archive_not_supplied'))
    checks += https_checks(url, expected_version if expected_version is not None else release['version']) if url else [record('public_https_headers', 'pending', 'https_origin_not_supplied'),
                                                               record('public_running_release', 'pending', 'https_origin_not_supplied')]
    checks.append(migration_check(migration_db, app, anonymized, private_local_copy=private_local_copy) if migration_db else
                  record('old_database_migration', 'pending', 'anonymized_old_database_not_supplied'))
    checks.append(runner_check() if probe_runner else record('installed_runner_smoke', 'pending', 'runner_probe_not_requested'))
    checks.append(container_report_check(runner_report, revision) if runner_report else
                  record('container_isolation_acceptance', 'pending', 'required_container_test_report_not_supplied'))
    # These cannot be established by a local read, a dummy mail config, or a
    # successful startup. Keep the evidence gap explicit in every report.
    for name, why in (
        ('smtp_delivery_and_second_factor_recovery', 'requires_operator_login_delivery_and_recovery_rehearsal'),
        ('offsite_download_and_clean_host_restore', 'local_archive_does_not_prove_remote_retrieval_or_full_restore'),
        ('backup_schedule_and_monitoring', 'requires_observation_of_scheduled_runs_and_alerts'),
    ):
        checks.append(record(name, 'pending', why))
    status = 'fail' if any(c['status'] == 'fail' for c in checks) else ('pending' if any(c['status'] == 'pending' for c in checks) else 'pass')
    return {'format': FORMAT, 'generated_at': time.time(), 'status': status, 'ok': status == 'pass',
            'version': release['version'], 'checks': checks,
            'limitations': ['A configuration value is not evidence of delivery or recovery.',
                            'A local snapshot does not prove offsite storage or restoration on another host.',
                            'No production data, account state, SMTP messages or service configuration were changed.',
                            'Keep this report private: it describes operational readiness.']}


def main():
    if len(sys.argv) == 5 and sys.argv[1] == '--_migration-worker':
        migration_worker(*sys.argv[2:])
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=Path('/opt/trainer'))
    parser.add_argument('--archive', type=Path, help='retrieved full snapshot; verify only, no production restore')
    parser.add_argument('--url', help='HTTPS origin; sends unauthenticated GETs only')
    parser.add_argument('--expected-version', help='target release for the public health check, for example 2.74.0')
    parser.add_argument('--migration-db', type=Path, help='closed anonymized copy of an old SQLite database')
    parser.add_argument('--anonymized', action='store_true', help='confirm the supplied DB was anonymized outside this tool')
    parser.add_argument('--private-local-copy', action='store_true',
                        help='rehearse a closed private DB snapshot locally; no anonymization or upload is performed')
    parser.add_argument('--probe-runner', action='store_true', help='run fixed harmless program through installed isolated service')
    parser.add_argument('--runner-report', type=Path, help='fresh JSON report of all four mandatory container tests')
    parser.add_argument('--revision', help='expected 40-character Git commit SHA for container report evidence')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    result = inspect(args.app, args.archive, args.url, args.migration_db, args.anonymized,
                     args.probe_runner, args.runner_report, args.revision, args.private_local_copy, args.expected_version)
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        # Do not overwrite a report or accidentally follow a production symlink.
        with args.output.open('x') as output:
            output.write(text)
    print(text, end='')
    return {'pass': 0, 'fail': 1, 'pending': 2}[result['status']]


if __name__ == '__main__':
    sys.exit(main())
