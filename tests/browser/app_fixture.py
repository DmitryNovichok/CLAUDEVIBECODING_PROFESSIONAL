#!/usr/bin/env python3
"""Real HTTP app with only temporary synthetic accounts/bank for browser tests."""
import contextlib
import functools
import io
import json
import os
import shutil
import signal
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
import server
import test_server as fixtures


def main():
    # The application and its real routes run unmodified. Only its data directory,
    # content fixture and clock-dependent waiting threshold are test-specific.
    count = int(os.environ.get('EGE_SYNTHETIC_TASKS', len(fixtures.BANK['tasks'])))
    if not 5 <= count <= 20000:
        raise ValueError('Synthetic task count must be 5..20000')
    for i in range(max(0, count - len(fixtures.BANK['tasks']))):
        fixtures.BANK['tasks'].append({'id': f'b:fixture-{i}', 'n': i % 27 + 1,
            'src': 'b', 'html': f'<p>Синтетическое условие {i}</p>', 'ans': '42',
            'att': []})
    fixtures.BANK['tasks'][0]['att'] = [{'name': 'sample.txt', 'href': 'media/b/assets/sample.txt'}]
    with contextlib.redirect_stdout(io.StringIO()):
        fixtures.ServerTest.setUpClass()
        # Browser pages keep SSE connections open. Synthetic request threads must
        # not keep this disposable fixture alive after its owner terminates it.
        fixtures.ServerTest.httpd.daemon_threads = True
        helper = fixtures.ServerTest()
        helper.setUp()
        tmp = fixtures.ServerTest.tmp
        # The unavailable-service UI case must never contact a host's real runner.
        import buglab_verifier
        buglab_verifier.Client = functools.partial(buglab_verifier.Client, path=str(tmp / 'absent-verifier.sock'))
        for name in set(server.SITE_FILES) | {'admin-login.js', 'teacher-gate.html'}:
            source = ROOT / name
            if source.is_file():
                target = tmp / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        for name in ('vendor', 'min'):
            shutil.copytree(ROOT / name, tmp / name, dirs_exist_ok=True)
        runtime = Path(__file__).parent / 'node_modules/pyodide'
        if (runtime / 'pyodide.js').is_file():
            shutil.copytree(runtime, tmp / 'vendor/pyodide', dirs_exist_ok=True)
        file = tmp / 'media/b/assets/sample.txt'
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('10\n20\n12\n', encoding='utf-8')
        server.APP.bank.ensure()
        db = server.APP.db
        now = time.time()
        teachers = []
        for email_ok, moderation in ((0, 'pending'), (1, 'pending'), (0, 'approved'), (1, 'approved')):
            key = f'fixture-{email_ok}-{moderation}'
            tid = db.x("""INSERT INTO teachers(name,login,pw,invite,created,email,email_ok,
                moderation,consent_ver,until) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                ('Учитель Пример', key, server.hash_pw('synthetic-password'), key, now,
                 key+'@example.invalid', email_ok, moderation, server.LEGAL_VERSION, now+86400))
            db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)', (key, now+3600, tid))
            teachers.append({'cookie': key, 'id': tid, 'email_ok': bool(email_ok), 'moderation': moderation})
        token = helper.login('Учебный Ученик')
        status, pupil = helper.req('GET', '/api/me', token=token)
        assert status == 200
        # Real entitlement checks still run; synthetic pupils are granted lab access.
        db.setting('lab_pw', server.hash_pw('fixture-only-lab-password'))
        db.x('UPDATE students SET lab=1 WHERE id=?', (pupil['sid'],))
        participants = []
        ready = teachers[-1]
        for name in ('Совместный Ученик Один', 'Совместный Ученик Два'):
            status, body = helper.req('POST', '/api/login', {
                'mode': 'register', 'consent': True, 'code': ready['cookie'],
                'name': name, 'new_password': 'synthetic-student-password'})
            assert status == 200, body
            db.x('UPDATE students SET lab=1 WHERE id=?', (body['sid'],))
            participants.append({'token': body['token'], 'sid': body['sid']})
        status, lesson, _ = helper.creq('POST', '/api/admin/together/new',
            {'students': [s['sid'] for s in participants], 'mode': 'code'},
            cookie='egeadm=' + ready['cookie'])
        assert status == 200, lesson
        origin = f'http://127.0.0.1:{fixtures.ServerTest.port}'
        server.SITE_URL = origin
        # No real SMTP or external requests exist in this fixture.
        server.smtp_conf = lambda: None
    print(json.dumps({'origin': origin, 'teachers': teachers, 'student': {'token': token, 'sid': pupil['sid']},
                      # Teacher bank routes use canonical IDs; pupil routes expose opaque IDs.
                      'task': server.APP.bank.pid('b:5'), 'teacherTask': 'b:5', 'participants': participants,
                      'together': {'id': lesson['id']}, 'taskCount': len(fixtures.BANK['tasks'])}), flush=True)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    try:
        stopped.wait()
    finally:
        fixtures.ServerTest.httpd.shutdown()
        fixtures.ServerTest.httpd.server_close()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
