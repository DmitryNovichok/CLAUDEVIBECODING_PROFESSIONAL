"""Teacher-only lessons: private access, durable work, and later invitations."""
import contextlib
import io
import json
import time
import unittest
from unittest import mock

import server
import together
import test_server as fixtures


class TogetherSoloTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        self.old_hub = server.TOG
        self.save_interval = mock.patch.object(together, 'SAVE_EVERY', 3600)
        self.save_interval.start()
        server.TOG = together.Hub(server.tog_load, server.tog_save, server.tog_task,
                                 server.tog_check, server.tog_name, server.tog_credit,
                                 access=server.tog_access)
        self.connections = []

    def tearDown(self):
        server.TOG.close()
        for sock, reader in self.connections:
            reader.close()
            sock.close()
        server.TOG = self.old_hub
        self.save_interval.stop()

    def teacher_without_students(self, key):
        tid = self.db.x('INSERT INTO teachers(name,login,pw,invite,created,consent_ver) VALUES(?,?,?,?,?,?)',
                        ('Учитель Макетов', key, server.hash_pw('synthetic-pass'),
                         key, time.time(), server.LEGAL_VERSION))
        self.db.x('INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)',
                  (key, time.time() + 3600, tid))
        return tid, 'egeadm=' + key

    def create(self, **data):
        status, result = self.c.admin('POST', '/api/admin/together/new', data)
        self.assertEqual(status, 200, result)
        return result['id']

    def connect(self, sid, token=None, teacher=True):
        sock, reader, status = self.c.ws(sid, token=token, teacher=teacher)
        self.connections.append((sock, reader))
        return sock, reader, status

    def prepare(self, sid):
        sock, reader, status = self.connect(sid)
        self.assertIn(' 101', status)
        self.c.recv(reader, 'snap')
        self.c.send(sock, {'t': 'op', 'page': 'p1', 'rev': 0, 'ops': ['print(42)']})
        self.assertEqual(self.c.recv(reader, 'ack')['rev'], 1)
        self.c.send(sock, {'t': 's+', 'page': 'p1', 's': {
            'id': 'draft-line', 'c': '#ff0000', 'w': 2, 'k': 'p', 'p': [[10, 10], [20, 20]]}})
        self.c.send(sock, {'t': 'ping'})
        self.c.recv(reader, 'pong')
        return sock, reader

    def test_teacher_with_no_students_can_create_every_mode(self):
        tid, cookie = self.teacher_without_students('solo-modes')
        status, result, _ = self.c.creq('GET', '/api/admin/together/students', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(result['students'], [])
        for mode in ('board', 'code', 'both'):
            with self.subTest(mode=mode):
                status, result, _ = self.c.creq('POST', '/api/admin/together/new',
                                                {'mode': mode, 'students': []}, cookie=cookie)
                self.assertEqual(status, 200, result)
                row = self.db.q('SELECT * FROM together WHERE id=?', (result['id'],), one=True)
                self.assertEqual(row['teacher_id'], tid)
                self.assertEqual(json.loads(row['students']), [])
                self.assertEqual(json.loads(row['state'])['mode'], mode)

    def test_solo_is_private_and_invalid_selection_is_rejected(self):
        sid = self.create(mode='board')  # Omitted participants also means private.
        token = self.c.login('Макетов Посторонний')
        self.assertNotIn(sid, [s['id'] for s in self.c.req('GET', '/api/together/mine', token=token)[1]['sessions']])
        self.assertIn(' 403', self.connect(sid, token=token, teacher=False)[2])
        _, cookie = self.teacher_without_students('solo-outsider')
        self.assertEqual(self.c.creq('GET', f'/api/together/ws?id={sid}&as=t', cookie=cookie)[0], 403)
        self.assertEqual(self.c.creq('POST', '/api/admin/together/invite',
                                    {'id': sid, 'students': []}, cookie=cookie)[0], 404)
        for selected in ([999999], 'invalid', None):
            with self.subTest(selected=selected):
                self.assertEqual(self.c.admin('POST', '/api/admin/together/new', {'students': selected})[0], 400)

    def test_end_and_resume_without_students_preserves_materials(self):
        sid = self.create(students=[], mode='both')
        self.prepare(sid)
        self.assertEqual(self.c.admin('POST', '/api/admin/together/end', {'id': sid})[0], 200)
        row = self.db.q('SELECT * FROM together WHERE id=?', (sid,), one=True)
        state = json.loads(row['state'])
        self.assertIsNotNone(row['ended'])
        self.assertEqual(state['pages']['p1']['code'], 'print(42)')
        self.assertEqual(state['pages']['p1']['strokes'][0]['id'], 'draft-line')
        self.assertEqual(self.c.admin('POST', '/api/admin/together/invite', {'id': sid, 'students': []})[0], 200)
        _, reader, status = self.connect(sid)
        self.assertIn(' 101', status)
        snap = self.c.recv(reader, 'snap')
        self.assertFalse(snap['ended'])
        self.assertEqual(snap['page']['code'], 'print(42)')
        self.assertEqual(snap['page']['strokes'][0]['id'], 'draft-line')
        # The resumed session remains writable.
        sock = self.connections[-1][0]
        self.c.send(sock, {'t': 'op', 'rev': snap['page']['rev'], 'ops': [9, '\n']})
        self.assertEqual(self.c.recv(reader, 'ack')['rev'], 2)

    def test_invite_keeps_unsaved_work_and_existing_connection(self):
        sid = self.create(students=[], mode='both')
        old = time.time() - server.TOG_ACTIVE_SEC - 3600
        self.db.x('UPDATE together SET created=?, updated=? WHERE id=?', (old, old, sid))
        sock, reader = self.prepare(sid)
        session = server.TOG.get(sid)
        self.assertTrue(session.dirty)
        token = self.c.login('Макетов Приглашённый')
        pupil = self.c.req('GET', '/api/me', token=token)[1]['sid']
        self.assertEqual(self.c.admin('POST', '/api/admin/together/invite', {'id': sid, 'students': [pupil]})[0], 200)
        self.assertIs(server.TOG.get(sid), session)
        self.assertEqual(session.created, old)
        self.assertTrue(session.dirty)
        self.c.send(sock, {'t': 'op', 'rev': 1, 'ops': [9, '\n']})
        self.assertEqual(self.c.recv(reader, 'ack')['rev'], 2)
        active = self.c.req('GET', '/api/together/mine', token=token)[1]['sessions']
        self.assertIn(sid, [s['id'] for s in active])
        _, pupil_reader, status = self.connect(sid, token=token, teacher=False)
        self.assertIn(' 101', status)
        snap = self.c.recv(pupil_reader, 'snap')
        self.assertEqual(snap['page']['code'], 'print(42)\n')
        self.assertEqual(snap['page']['strokes'][0]['id'], 'draft-line')
        server.TOG.flush()
        row = self.db.q('SELECT * FROM together WHERE id=?', (sid,), one=True)
        self.assertEqual(row['created'], old)
        self.assertEqual(json.loads(row['state'])['pages']['p1']['code'], 'print(42)\n')


if __name__ == '__main__':
    unittest.main()
