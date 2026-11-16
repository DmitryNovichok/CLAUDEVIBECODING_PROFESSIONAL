"""Learning content, access controls and progress, synthetic data only."""
import contextlib
import io
import json
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import server
import test_server as fixtures
from auth import check_pw
from learning_access import set_learning_passwords, PASSWORD_KEYS
from learning_content import course_guide

ROOT = Path(__file__).resolve().parent.parent


class PasswordTest(unittest.TestCase):
    def db(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)')
        db.executemany('INSERT INTO settings VALUES(?,?)', [(key, 'before') for key in PASSWORD_KEYS] + [('invite_code', 'keep')])
        db.commit()
        return db

    def test_password_update_is_scoped_and_hashes_are_salted(self):
        with self.db() as db:
            set_learning_passwords(db, 'synthetic-lesson-pass')
            values = dict(db.execute('SELECT * FROM settings'))
            self.assertEqual(values.pop('invite_code'), 'keep')
            self.assertEqual(len(set(values.values())), 3)
            for hashed in values.values():
                self.assertTrue(check_pw('synthetic-lesson-pass', hashed))
                self.assertNotEqual(hashed, 'synthetic-lesson-pass')

    def test_error_rolls_back_all_three_passwords(self):
        with self.db() as db:
            db.execute("CREATE TRIGGER fail BEFORE UPDATE ON settings WHEN NEW.key='pyc_pw' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                set_learning_passwords(db, 'synthetic-lesson-pass')
            self.assertEqual(dict(db.execute('SELECT * FROM settings'))['course_pw'], 'before')

    def test_empty_or_oversized_password_does_not_disable_access(self):
        with self.db() as db:
            for password in ('', 'short', ' leading-space', 'x'*201):
                with self.assertRaises(ValueError): set_learning_passwords(db, password)
            self.assertEqual(dict(db.execute('SELECT * FROM settings'))['lab_pw'], 'before')


class ContentTest(unittest.TestCase):
    def test_every_exam_topic_has_real_material(self):
        for n in range(1, 28):
            guide = course_guide(n)
            self.assertEqual(len(guide['slides']), 4)
            self.assertTrue(guide['slides'][2]['sol'])
        self.assertEqual(course_guide(99)['slides'], [])

    def test_exam_numbering_and_beginner_checks(self):
        modules = {m['id']:m for m in json.loads((ROOT/'pycourse/index.json').read_text())}
        self.assertEqual(modules['m13']['n'], 13)
        self.assertEqual(modules['m23']['n'], 23)
        self.assertEqual(modules['m30']['n'], 12)
        self.assertEqual(modules['m31']['n'], 28)
        self.assertEqual(modules['m31']['group'], 'extra')
        self.assertEqual(modules['m12']['group'], 'extra')
        m = json.loads((ROOT/'pycourse/m01.json').read_text())
        self.assertEqual(len(m['levels']), 10)
        for lv in m['levels']:
            for task in lv['tasks']:
                if 'practice' not in task: continue
                cases = task['practice']['cases']
                self.assertGreaterEqual(len(cases), 3)
                self.assertGreater(len({c['output'] for c in cases}), 1)
                for case in cases:
                    stdout=io.StringIO()
                    with contextlib.redirect_stdout(stdout), unittest.mock.patch('sys.stdin', io.StringIO(case['input'])):
                        exec(task['sol'], {})
                    self.assertEqual(stdout.getvalue().strip(), case['output'])


class LearningHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()): fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()
        (fixtures.ServerTest.tmp/'pycourse').mkdir()
        for name in ('index.json', 'm01.json', 'm30.json'):
            (fixtures.ServerTest.tmp/'pycourse'/name).write_bytes((ROOT/'pycourse'/name).read_bytes())
        (fixtures.ServerTest.tmp/'lab-worker.js').write_bytes((ROOT/'lab-worker.js').read_bytes())
        cls.serial=0

    @classmethod
    def tearDownClass(cls): fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.client.setUp()
        type(self).serial+=1
        self.db=server.APP.db
        with contextlib.redirect_stdout(io.StringIO()): self.token=self.client.login('Макетов '+['Первый','Второй','Третий','Четвертый','Пятый'][self.serial-1])
        self.sid=self.client.req('GET','/api/me',token=self.token)[1]['sid']
        set_learning_passwords(self.db.conn, 'synthetic-lesson-pass')
        server._LAB_PW_TRIES.clear()

    def req(self, path, body=None):
        return self.client.req('POST' if body is not None else 'GET', path, body, self.token)

    def unlock(self):
        self.assertEqual(self.req('/api/pyc/unlock',{'password':'synthetic-lesson-pass'})[0],200)

    def test_lab_access_worker_and_no_session_revocation(self):
        self.assertEqual(self.client.req('GET','/api/lab')[0],401)
        self.assertFalse(self.req('/api/lab')[1]['access'])
        self.assertEqual(self.req('/lab-worker.js')[0],403)
        self.assertEqual(self.req('/api/lab/unlock',{'password':'wrong'})[0],403)
        self.assertTrue(self.req('/api/lab/unlock',{'password':'synthetic-lesson-pass'})[1]['access'])
        self.assertEqual(self.req('/lab-worker.js')[0],200)
        set_learning_passwords(self.db.conn,'replacement-for-test')
        self.assertTrue(self.req('/api/me')[1]['lab'])
        self.assertEqual(self.req('/api/me')[0],200)
        self.db.setting('lab_pw','')
        self.assertFalse(self.req('/api/lab')[1]['access'])
        self.assertEqual(self.req('/lab-worker.js')[0],403)

    def test_lab_throttle_and_teacher_access(self):
        for _ in range(server.COURSE_TRIES): self.req('/api/lab/unlock',{'password':'wrong'})
        self.assertEqual(self.req('/api/lab/unlock',{'password':'synthetic-lesson-pass'})[0],429)
        self.db.x('UPDATE students SET is_teacher=1 WHERE id=?',(self.sid,))
        self.db.setting('lab_pw','')
        self.assertTrue(self.req('/api/lab')[1]['access'])

    def test_course_fallback_requires_access(self):
        self.assertEqual(self.req('/api/course/lesson?n=10')[0],403)
        self.req('/api/course/unlock',{'password':'synthetic-lesson-pass'})
        self.assertEqual(len(self.req('/api/course/lesson?n=10')[1]['slides']),4)

    def test_help_is_recorded_without_granting_answers_or_completion(self):
        self.unlock()
        tid='m01.print_sum'
        self.assertEqual(self.req('/api/pyc/help',{'task':tid,'kind':'solution'})[0],403)
        self.assertEqual(self.req('/api/pyc/help',{'task':'m01.input_double','kind':'hint'})[0],403)
        self.assertEqual(self.req('/api/pyc/help',{'task':tid,'kind':'hint'})[0],200)
        p=self.req('/api/pyc')[1]['progress'][tid]
        self.assertEqual((p['ok'],p['tries'],p['hint_used']),(0,0,1))
        self.req('/api/pyc/check',{'task':tid,'answer':'10'})
        p=self.req('/api/pyc')[1]['progress'][tid]
        self.assertEqual((p['ok'],p['independent']),(1,0))
        self.req('/api/pyc/check',{'task':'m01.change_value','answer':'16'})
        self.assertEqual(self.req('/api/pyc')[1]['progress']['m01.change_value']['independent'],1)
        self.assertEqual(self.req('/api/pyc/level?m=m01&l=1')[0],200)

    def test_parallel_wrong_answer_never_erases_success(self):
        self.unlock()
        def submit(answer): return self.req('/api/pyc/check',{'task':'m01.print_sum','answer':answer})[0]
        with ThreadPoolExecutor(2) as pool: self.assertEqual(list(pool.map(submit,['10','-1'])),[200,200])
        self.assertEqual(self.req('/api/pyc')[1]['progress']['m01.print_sum']['ok'],1)
