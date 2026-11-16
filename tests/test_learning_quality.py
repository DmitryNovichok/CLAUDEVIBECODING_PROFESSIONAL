"""Evidence labels, reflection ownership and current course coverage (synthetic data)."""
import contextlib
import io
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

import learning_quality as quality
from learning_content import course_coverage
import server
import test_server as fixtures

ROOT = Path(__file__).resolve().parent.parent


class EvidenceTest(unittest.TestCase):
    def test_labels_follow_server_records_not_browser_claims(self):
        row = {'answers': '["12"]', 'score': 1, 'flags': '', 'reason': 'new'}
        self.assertEqual(quality.provenance(row), 'independent')
        self.assertEqual(quality.provenance(dict(row, flags='paste,hint')), 'hinted')
        self.assertEqual(quality.provenance(dict(row, reason='tog')), 'together')
        self.assertEqual(quality.provenance(row, repeated=True), 'repeat')
        self.assertEqual(quality.provenance(dict(row, score=.5)), 'retry')
        self.assertEqual(quality.provenance(dict(row, abandoned=1, score=0)), 'unanswered')

    def test_migration_relabels_old_browser_star_without_erasing_practice(self):
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE attempts(id INTEGER, student_id INTEGER, task_id TEXT)')
        conn.execute('CREATE TABLE buglab(star INTEGER, ok INTEGER, tries INTEGER, code TEXT)')
        conn.execute("INSERT INTO buglab VALUES(1,1,3,'saved draft')")
        quality.migrate(conn)
        quality.migrate(conn)
        self.assertEqual(conn.execute('SELECT * FROM buglab').fetchone(), (0,1,3,'saved draft'))

    def test_migration_preserves_only_independently_verified_stars(self):
        conn=sqlite3.connect(':memory:')
        self.addCleanup(conn.close)
        conn.execute('CREATE TABLE attempts(id INTEGER,student_id INTEGER,task_id TEXT)')
        conn.execute('CREATE TABLE buglab(star INTEGER,verified INTEGER)')
        conn.executemany('INSERT INTO buglab VALUES(?,?)',[(1,1),(1,0),(1,None)])
        quality.migrate(conn)
        quality.migrate(conn)
        self.assertEqual(conn.execute('SELECT star,verified FROM buglab').fetchall(),[(1,1),(0,0),(0,None)])


class CourseCoverageTest(unittest.TestCase):
    def test_coverage_matches_files_and_keeps_archive_separate(self):
        report = course_coverage(ROOT)
        self.assertEqual((report['full_count'], report['guide_count'], report['archive_count']), (27,0,1))
        self.assertEqual(sum(not t['archive'] for t in report['topics']),27)
        self.assertEqual(next(t for t in report['topics'] if t['n']==10)['model'],None)
        for row in report['topics']:
            source=ROOT/'course'/f"{row['lesson_n']}.json"
            self.assertEqual(row['kind']=='lesson',source.is_file())
            deck=json.loads(source.read_text())
            self.assertEqual(row['slides'],len(deck['slides']))
            self.assertEqual(row['lesson_n'],19 if row['n'] in (20,21) else row['n'])

    def test_shared_game_lesson_and_missing_files_are_reported_honestly(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'course').mkdir()
            (root/'course'/'19.json').write_text(json.dumps({'n':19,'slides':[{'t':'text','h':'Общий урок'}]}))
            report=course_coverage(root)
            self.assertEqual((report['full_count'],report['guide_count']),(3,24))
            games=[t for t in report['topics'] if t['n'] in (19,20,21)]
            self.assertTrue(all(t['kind']=='lesson' and t['lesson_n']==19 and t['slides']==1 for t in games))
            (root/'course'/'19.json').unlink()
            report=course_coverage(root)
            self.assertEqual((report['full_count'],report['guide_count']),(0,27))


class ReflectionHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()): fixtures.ServerTest.setUpClass()
        cls.client=fixtures.ServerTest()
        course=fixtures.ServerTest.tmp/'course'
        course.mkdir(exist_ok=True)
        (course/'19.json').write_bytes((ROOT/'course'/'19.json').read_bytes())

    @classmethod
    def tearDownClass(cls): fixtures.ServerTest.tearDownClass()

    def test_reflection_is_owned_idempotent_and_history_keeps_provenance(self):
        self.client.setUp()
        with contextlib.redirect_stdout(io.StringIO()):
            token=self.client.login('Аналитиков Первый')
            other=self.client.login('Аналитиков Второй')
        sid=self.client.req('GET','/api/me',token=token)[1]['sid']
        db=server.APP.db
        now=time.time()
        for score,flags,reason in [(0,'','new'),(1,'hint','new'),(1,'','tog')]:
            db.x('''INSERT INTO attempts(student_id,task_id,n,score,ts,answers,flags,reason)
                    VALUES(?,?,?,?,?,?,?,?)''',(sid,'b:5',5,score,now,'["0"]',flags,reason))
            now+=.01
        public=server.APP.bank.pid('b:5')
        req=lambda path,body=None,tok=token:self.client.req('POST' if body is not None else 'GET',path,body,tok)
        self.assertEqual(req('/api/learning/mistake',{'task':public,'reason':'logic'},None)[0],401)
        self.assertEqual(req('/api/learning/mistake',{'task':public,'reason':'logic'},other)[0],404)
        self.assertEqual(req('/api/learning/mistake',{'task':public,'reason':'made_up'})[0],400)
        self.assertEqual(req('/api/learning/mistake',{'task':public,'reason':[]})[0],400)
        for reason in ('logic','attention'):
            self.assertEqual(req('/api/learning/mistake',{'task':public,'reason':reason})[0],200)
        summary=req('/api/learning/mistakes')[1]['items']
        self.assertEqual([(r['reason'],r['count']) for r in summary],[('attention',1)])
        self.assertEqual(req('/api/learning/mistakes',tok=other)[1]['items'],[])
        history=req('/api/history')[1]['h']
        self.assertEqual([r[11] for r in history],['independent','hinted','together'])
        self.assertEqual(req('/api/course/coverage',tok=None)[0],200)
        for n in (20,21):
            self.assertEqual(req(f'/api/course/lesson?n={n}')[0],403)
        db.setting('course_pw',server.hash_pw('synthetic-course-password'))
        db.x('UPDATE students SET course=1 WHERE id=?',(sid,))
        coverage=req('/api/course/coverage')[1]['topics']
        for n in (19,20,21):
            status,lesson=req(f'/api/course/lesson?n={n}')
            self.assertEqual(status,200)
            self.assertEqual(lesson['n'],19)
            meta=next(t for t in coverage if t['n']==n)
            self.assertEqual((meta['lesson_n'],meta['kind'],meta['slides']),(19,'lesson',len(lesson['slides'])))
