"""Teacher/pupil assignment regressions, using only synthetic accounts."""
import contextlib
import io
import json
import time
import unittest

import server
import test_server as fixtures


class AssignmentRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()
        fixtures.ServerTest.httpd.server_close()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        type(self).serial += 1
        self.token = self.c.login('Макетов Проверка' + chr(0x410 + self.serial))
        self.sid = self.c.req('GET', '/api/me', token=self.token)[1]['sid']
        self.cid = self.c.admin('POST', '/api/admin/class/save', {'name': 'Демо задания'})[1]['id']
        self.c.admin('POST', '/api/admin/class/members', {'class_id': self.cid, 'students': [self.sid]})

    def work(self, personal=False):
        data = {'class_id': self.cid, 'title': 'Проверка удаления', 'kind': 'self', 'tasks': ['b:5']}
        if personal:
            data['students'] = [self.sid]
        status, result = self.c.admin('POST', '/api/admin/assignment/save', data)
        self.assertEqual(status, 200, result)
        return result['id']

    def answer(self, aid):
        for path, data in [('start', {}), ('answer', {'task': server.APP.bank.pid('b:5'), 'answer': '12'}), ('finish', {})]:
            status, result = self.c.req('POST', '/api/asg/' + path, {'id': aid, **data}, self.token)
            self.assertEqual(status, 200, result)

    def test_edit_cannot_reopen_foreign_assignment(self):
        tid = self.db.x('INSERT INTO teachers(name,login,invite,created) VALUES(?,?,?,?)',
                        ('Макетов Другой', 'assignment-outsider', 'synthetic-invite', time.time()))
        cid = self.db.x('INSERT INTO classes(name,created,teacher_id) VALUES(?,?,?)', ('Демо чужой', time.time(), tid))
        deadline = time.time() - 60
        aid = self.db.x('INSERT INTO assignments(class_id,title,tasks,created,due,closed,strict) VALUES(?,?,?,?,?,?,1)',
                        (cid, 'Чужая работа', '["b:5"]', deadline - 600, deadline, deadline))
        status, _ = self.c.admin('POST', '/api/admin/assignment/save',
                                {'id': aid, 'class_id': self.cid, 'title': 'Изменение', 'tasks': ['b:5']})
        self.assertEqual(self.db.q('SELECT closed FROM assignments WHERE id=?', (aid,), one=True)['closed'], deadline)
        self.assertEqual(status, 404)

    def test_edit_deleted_assignment_returns_not_found(self):
        status, _ = self.c.admin('POST', '/api/admin/assignment/save',
                                {'id': 999999, 'class_id': self.cid, 'title': 'Удалена', 'tasks': ['b:5']})
        self.assertEqual(status, 404)

    def test_deleting_class_cannot_restore_old_answers_in_new_work(self):
        aid = self.work()
        self.answer(aid)
        self.assertEqual(self.c.admin('POST', '/api/admin/class/delete', {'id': self.cid})[0], 200)
        self.cid = self.c.admin('POST', '/api/admin/class/save', {'name': 'Демо новый'})[1]['id']
        self.c.admin('POST', '/api/admin/class/members', {'class_id': self.cid, 'students': [self.sid]})
        new_id = self.work()
        self.assertEqual(new_id, aid)  # SQLite can reuse the deleted maximum primary key.
        state = self.c.req('GET', f'/api/asg/state?id={new_id}', token=self.token)[1]
        self.assertFalse(state.get('finished'), state)
        self.assertFalse(state.get('mine'), state)
        self.assertFalse(self.db.q('SELECT 1 FROM asg_events WHERE asg_id=?', (aid,), one=True))

    def test_deleting_personal_batch_removes_runs_and_events(self):
        aid = self.work(personal=True)
        self.answer(aid)
        row = self.db.q('SELECT batch FROM assignments WHERE id=?', (aid,), one=True)
        self.assertEqual(self.c.admin('POST', '/api/admin/batch/delete', {'class_id': self.cid, 'batch': row['batch']})[0], 200)
        self.assertFalse(self.db.q('SELECT 1 FROM asg_runs WHERE asg_id=?', (aid,), one=True))
        self.assertFalse(self.db.q('SELECT 1 FROM asg_events WHERE asg_id=?', (aid,), one=True))

    def test_deleting_single_assignment_removes_events(self):
        aid = self.work()
        self.answer(aid)
        self.assertEqual(self.c.admin('POST', '/api/admin/assignment/delete', {'id': aid})[0], 200)
        self.assertFalse(self.db.q('SELECT 1 FROM asg_events WHERE asg_id=?', (aid,), one=True))

    def test_upgrade_removes_only_orphan_results(self):
        aid = self.work()
        self.answer(aid)
        self.db.x('INSERT INTO asg_runs(asg_id,student_id,answers) VALUES(999999,?,?)', (self.sid, '{}'))
        self.db.x('INSERT INTO asg_events(asg_id,student_id,ts,kind) VALUES(999999,?,?,?)',
                  (self.sid, time.time(), 'start'))
        reopened = server.DB(server.DB_PATH)
        try:
            self.assertFalse(reopened.q('SELECT 1 FROM asg_runs WHERE asg_id=999999', one=True))
            self.assertFalse(reopened.q('SELECT 1 FROM asg_events WHERE asg_id=999999', one=True))
            self.assertTrue(reopened.q('SELECT finished FROM asg_runs WHERE asg_id=? AND student_id=?',
                                       (aid, self.sid), one=True)['finished'])
            self.assertTrue(reopened.q('SELECT 1 FROM asg_events WHERE asg_id=?', (aid,), one=True))
        finally:
            reopened.conn.close()

    def test_archive_limit_keeps_whole_personal_batch(self):
        now = time.time()
        ids = [self.db.x('INSERT INTO assignments(class_id,title,tasks,created,student_id,batch) VALUES(?,?,?,?,?,?)',
                        (self.cid, 'Персональная проверка', '["b:5"]', now - n, self.sid + n, 'synthetic-batch'))
               for n in range(3)]
        rows = server.teacher_asg_archive(self.db, server.main_teacher()['id'], class_id=self.cid, limit=1)
        self.assertEqual(rows[0]['ids'], ids)
        self.assertEqual(rows[0]['students'], 3)

    def test_archive_search_finds_old_work_beyond_recent_rows(self):
        now = time.time()
        aid = self.db.x('INSERT INTO assignments(class_id,title,tasks,created) VALUES(?,?,?,?)',
                        (self.cid, 'Редкая старая подборка', '["b:5"]', now - 10000))
        with self.db.lock, self.db.transaction():
            for n in range(2001):
                self.db.x('INSERT INTO assignments(class_id,title,tasks,created) VALUES(?,?,?,?)',
                          (self.cid, 'Новая подборка', '["b:6"]', now - n))
        rows = server.teacher_asg_archive(self.db, server.main_teacher()['id'], q='редкая старая', class_id=self.cid)
        self.assertEqual([r['id'] for r in rows], [aid])

    def test_game_progress_requires_every_question_and_excludes_exams(self):
        now = time.time()
        self.db.x('INSERT INTO attempts(student_id,ts,task_id,grp,score) VALUES(?,?,?,?,1)',
                  (self.sid, now, 'b:g19', 'b:g'))
        self.db.x('INSERT INTO attempts(student_id,ts,task_id,exam,score) VALUES(?,?,?,?,1)',
                  (self.sid, now, 'b:5', 'synthetic-exam'))
        self.assertEqual(server.assignment_done(self.db, self.sid, ['b:g', 'b:5'], now - 1), set())
        self.db.x('INSERT INTO attempts(student_id,ts,task_id,grp,score) VALUES(?,?,?,?,1)',
                  (self.sid, now, 'b:g20', 'b:g'))
        self.assertEqual(server.assignment_done(self.db, self.sid, ['b:g', 'b:5'], now - 1), {'b:g'})

    def test_together_history_is_not_limited_by_other_pupils_sessions(self):
        now = time.time()
        tid = server.main_teacher()['id']
        own = self.db.x('INSERT INTO together(teacher_id,students,created,updated,state) VALUES(?,?,?,?,?)',
                        (tid, json.dumps([self.sid]), now - 10000, now - 10000, '{}'))
        with self.db.lock, self.db.transaction():
            for n in range(301):
                self.db.x('INSERT INTO together(teacher_id,students,created,updated,state) VALUES(?,?,?,?,?)',
                          (tid, '[]', now - n, now - n, '{}'))
        status, history = self.c.req('GET', '/api/together/history', token=self.token)
        self.assertEqual(status, 200, history)
        self.assertEqual([s['id'] for s in history['sessions']], [own])


if __name__ == '__main__':
    unittest.main()
