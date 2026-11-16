"""Actual follow-up task outcomes, not frequency of self-reported mistake labels."""
import sqlite3
import unittest

from learning_quality import followup_metrics


class DB:
    def __init__(self):
        self.conn=sqlite3.connect(':memory:')
        self.conn.row_factory=sqlite3.Row
        self.conn.executescript('''CREATE TABLE attempts(id INTEGER PRIMARY KEY,student_id INTEGER,task_id TEXT,n INTEGER,
            score REAL,ts REAL,reason TEXT,flags TEXT,answers TEXT,gave_up INTEGER,abandoned INTEGER);
            CREATE TABLE learning_mistakes(student_id INTEGER,attempt_id INTEGER,reason TEXT,ts REAL);''')

    def q(self,sql,args):return self.conn.execute(sql,args).fetchall()


class FollowupTest(unittest.TestCase):
    def setUp(self):
        self.db=DB();self.addCleanup(self.db.conn.close)
        self.tasks={}
        self.ts=1000000

    def add(self,task,score,*,cluster='pairs',n=17,student=1,flags='',reason='new',note=None,gave_up=0,abandoned=0):
        self.tasks[task]={'n':n,'c':cluster}
        self.ts+=1
        aid=self.db.conn.execute('''INSERT INTO attempts(student_id,task_id,n,score,ts,reason,flags,answers,gave_up,abandoned)
            VALUES(?,?,?,?,?,?,?,'["1"]',?,?)''',(student,task,n,score,self.ts,reason,flags,gave_up,abandoned)).lastrowid
        if note:self.db.conn.execute('INSERT INTO learning_mistakes VALUES(?,?,?,?)',(student,aid,note,self.ts))

    def metric(self,student=1):return followup_metrics(self.db,student,self.tasks,now=self.ts+1)

    def test_next_new_matching_task_excludes_assistance_repeats_and_different_type(self):
        self.add('error',0,note='logic')
        self.add('error',1)  # memorised task cannot prove transfer
        self.add('triple',1,cluster='triples')
        self.add('other-number',1,n=18)
        self.add('hinted',1,flags='hint,paste')
        self.add('lesson',1,reason='tog')
        self.add('abandoned',0,abandoned=1)
        self.add('revealed',0,gave_up=1)
        self.add('first-independent',0)
        self.add('later-success',1)
        result=self.metric()
        self.assertEqual((result['evaluated'],result['recovered'],result['recovery_rate']),(1,0,0))
        self.assertEqual(result['items'][0]['failed'],1)

    def test_first_try_success_and_retry_are_distinguished_and_accounts_isolated(self):
        self.add('error-a',0,note='condition')
        self.add('foreign',1,student=2)
        self.assertEqual(self.metric()['evaluated'],0)
        self.add('new-a',1)
        self.add('error-b',0,note='implementation',cluster='triples')
        self.add('new-b',.5,cluster='triples')
        result=self.metric()
        self.assertEqual((result['evaluated'],result['recovered'],result['recovery_rate']),(2,1,.5))
        self.assertEqual(self.metric(2)['evaluated'],0)

    def test_unmatched_and_pending_notes_have_no_invented_rate(self):
        self.add('unknown',0,cluster='misc',note='attention')
        self.add('waiting',0,note='logic')
        result=self.metric()
        self.assertIsNone(result['recovery_rate'])
        states={r['reason']:r for r in result['items']}
        self.assertEqual(states['attention']['unmatched'],1)
        self.assertEqual(states['logic']['pending'],1)
        self.assertTrue(all(r['recovery_rate'] is None for r in states.values()))

    def test_next_task_that_was_seen_before_the_error_is_still_a_repeat(self):
        self.add('old',1)
        self.add('error',0,note='logic')
        self.add('old',1)
        self.assertEqual(self.metric()['evaluated'],0)
        self.add('fresh',1)
        self.assertEqual(self.metric()['recovered'],1)
