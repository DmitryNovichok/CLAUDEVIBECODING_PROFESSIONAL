#!/usr/bin/env python3
"""Synthetic end-to-end recovery drill. No production paths/accounts are used."""
import argparse
from contextlib import closing, redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import sys
import time
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
import server
import test_server as fixtures
from deploy.snapshot import create
from deploy.recovery_check import check, copy_code, request


def run():
    with redirect_stdout(io.StringIO()):
        fixtures.ServerTest.setUpClass()
        client = fixtures.ServerTest()
        client.setUp()
        token = client.login('Резервный Ученик')
        sid = client.req('GET', '/api/me', token=token)[1]['sid']
    source = fixtures.ServerTest.tmp
    db = server.APP.db
    try:
        copy_code(ROOT, source)
        policy = {'TASK_BTC': {str(n): n / 10 for n in range(1, 28)}}
        (source / 'server_data/private_config.json').write_text(json.dumps(policy))
        db.setting('admin_password', server.hash_pw('synthetic-drill-only'))
        task = server.APP.bank.pid('b:5')
        client.req('POST', '/api/open', {'task': task}, token)
        server.OPENED.get(sid, 'b:5')['ts'] -= 120
        status, answer = client.req('POST', '/api/check', {'task': task, 'answer': '12'}, token)
        if status != 200 or not answer.get('correct'):
            raise ValueError('Synthetic answer setup failed')
        client.req('POST', '/api/solution', {'task': task, 'code': 'print(12) # before snapshot'}, token)
        status, classroom = client.admin('POST', '/api/admin/class/save', {'name': 'Восстановление'})
        if status != 200:
            raise ValueError('Synthetic classroom setup failed')
        client.admin('POST', '/api/admin/class/members', {'class_id': classroom['id'], 'students': [sid]})
        status, assignment = client.admin('POST', '/api/admin/assignment/save',
            {'class_id': classroom['id'], 'title': 'Синтетическая работа', 'kind': 'self', 'tasks': ['b:5', 'b:6']})
        if status != 200:
            raise ValueError('Synthetic assignment setup failed')
        fid = 'abcde01234567890'
        lesson_file = source / 'server_data/together_files/1' / fid
        lesson_file.parent.mkdir(parents=True)
        lesson_file.write_text('10\n20\n12\n')
        state = {'cur': 'p1', 'pages': {'p1': {'code': 'print(42)', 'files': [{'id': fid, 'name': 'lesson.txt', 'size': 9}]}}}
        db.x('INSERT INTO together(id,teacher_id,students,created,state) VALUES(1,1,?,?,?)',
             (json.dumps([sid]), time.time(), json.dumps(state)))
        # Fixture external bank lives beside its source data, independently restored.
        checkpoint = time.time()
        archive = source.parent / (source.name + '-drill.tar.gz')
        backup_started = time.perf_counter()
        with mock.patch.dict('os.environ', {'EGE_PRIVATE_CONFIG': ''}):
            create(source / 'server_data/trainer.db', archive, source)
        backup_seconds = time.perf_counter() - backup_started
        # A committed result AFTER the checkpoint must not appear in the snapshot.
        db.x('INSERT INTO attempts(student_id,ts,task_id,n,score) VALUES(?,?,?,?,?)',
             (sid, time.time(), 'b:6', 6, 1.0))
        db.x('UPDATE solutions SET code=? WHERE student_id=?', ('print(999) # after snapshot', sid))
        simulated_failure = time.time()

        def probe(restored, port):
            checks = {}
            st, body = request(port, '/api/history', token)
            history = json.loads(body) if st == 200 else {}
            checks['saved_answer_visible'] = st == 200 and task in json.dumps(history)
            st, body = request(port, '/api/assignments', token)
            checks['assignment_visible'] = st == 200 and 'Синтетическая работа' in body.decode()
            st, body = request(port, '/api/solution?task=' + task, token)
            checks['checkpoint_code_visible'] = st == 200 and json.loads(body).get('code') == 'print(12) # before snapshot'
            st, body = request(port, '/api/together/file?s=1&f=' + fid, token)
            checks['lesson_attachment_served'] = st == 200 and body == b'10\n20\n12\n'
            st, body = request(port, '/fip_bank/assets/0079D4-08bc5d/a.gif', token)
            checks['external_bank_image_served'] = st == 200 and body == b'GIF89a'
            with closing(sqlite3.connect(restored / 'server_data/trainer.db')) as restored_db:
                checks['post_checkpoint_write_absent'] = restored_db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0] == 1
                latest = restored_db.execute('SELECT MAX(ts) FROM attempts').fetchone()[0]
            if not all(checks.values()):
                raise ValueError('Recovery HTTP probes failed: ' + ', '.join(k for k, v in checks.items() if not v))
            checks['observed_rpo_seconds'] = round(simulated_failure - latest, 3)
            checks['intentionally_lost_post_checkpoint_results'] = 1
            return checks

        result = check(archive, ROOT, probe)
        result['backup_seconds'] = round(backup_seconds, 3)
        result['checkpoint_age_at_simulated_failure_seconds'] = round(simulated_failure - checkpoint, 3)
        result['scope'] = 'synthetic data only; actual restored subprocess and authenticated HTTP probes'
        result['limitations'] = 'Local filesystem and tiny synthetic content; excludes archive download, operator time and DNS/TLS.'
        return result
    finally:
        if 'archive' in locals():
            archive.unlink(missing_ok=True)
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()
        db.conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = run()
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    print(text, end='')
