import hashlib
import sqlite3
import unittest

import buglab_grading
import buglab_merge


class DB:
    def __init__(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('''CREATE TABLE buglab(student_id INTEGER,case_id TEXT,ok INTEGER DEFAULT 0,
            tries INTEGER DEFAULT 0,star INTEGER DEFAULT 0,seen INTEGER DEFAULT 0,
            first_ts REAL,ok_ts REAL,code TEXT,PRIMARY KEY(student_id,case_id))''')
        buglab_grading.migrate(self.conn)

    def q(self, sql, args=(), one=False):
        rows = self.conn.execute(sql, args).fetchall()
        return (rows[0] if rows else None) if one else rows

    def x(self, sql, args=()):
        self.conn.execute(sql, args)


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.db = DB()
        self.addCleanup(self.db.conn.close)

    def add(self, sid, case='case', verified=False, star=0, seen=0, tries=1, ts=100, code='print(42)', bad_hash=False):
        self.db.x('''INSERT INTO buglab(student_id,case_id,ok,tries,star,seen,first_ts,ok_ts,code,
                     verified,verified_ts,verified_code_hash,verified_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                  (sid, case, 1, tries, star, seen, ts, ts, code, int(verified), ts if verified else None,
                   ('invalid' if bad_hash else hashlib.sha256(code.encode()).hexdigest()) if verified else None,
                   code if verified else None))

    def result(self):
        return dict(self.db.q('SELECT * FROM buglab WHERE student_id=2 AND case_id=?', ('case',), one=True))

    def test_best_real_star_keeps_its_exact_proof_despite_seen_on_other_account(self):
        self.add(1, verified=True, star=1, tries=2, ts=50, code='print(6 * 7)')
        self.add(2, verified=True, star=0, seen=1, tries=3, ts=100, code='print(42)')
        buglab_merge.merge(self.db, 1, 2)
        row = self.result()
        self.assertEqual((row['verified'], row['star'], row['seen'], row['tries']), (1, 1, 1, 5))
        self.assertEqual((row['verified_code'], row['verified_ts'], row['first_ts']), ('print(6 * 7)', 50, 50))
        self.assertEqual(row['verified_code_hash'], hashlib.sha256(row['verified_code'].encode()).hexdigest())
        self.assertEqual(self.db.q('SELECT * FROM buglab WHERE student_id=1'), [])

    def test_browser_stars_and_damaged_hash_cannot_create_verified_credit(self):
        self.add(1, verified=True, star=1, bad_hash=True)
        self.add(2, verified=False, star=1)
        buglab_merge.merge(self.db, 1, 2)
        row = self.result()
        self.assertEqual((row['ok'], row['verified'], row['star']), (1, 0, 0))
        self.assertIsNone(row['verified_code_hash'])

    def test_nonoverlapping_case_and_existing_target_proof_survive(self):
        self.add(1, case='other', verified=True, star=1)
        self.add(1, verified=False, star=1)
        self.add(2, verified=True, star=0)
        buglab_merge.merge(self.db, 1, 2)
        self.assertEqual((self.result()['verified'], self.result()['star']), (1, 0))
        self.assertEqual(len(self.db.q('SELECT * FROM buglab WHERE student_id=2')), 2)
        self.assertTrue(self.db.q("SELECT verified FROM buglab WHERE case_id='other'", one=True)['verified'])

    def test_jobs_keep_quota_history_and_active_old_request_is_cancelled(self):
        for job, sid, status, finished in [('active', 1, 'running', None), ('done', 1, 'complete', 12),
                                            ('expired', 1, 'expired', 13), ('new-account', 2, 'running', None)]:
            self.db.x('INSERT INTO buglab_jobs VALUES(?,?,?,?,?)', (job, sid, 10, finished, status))
        buglab_merge.merge(self.db, 1, 2, now=25)
        jobs = {row['id']: dict(row) for row in self.db.q('SELECT * FROM buglab_jobs')}
        self.assertEqual((jobs['active']['student_id'], jobs['active']['status'], jobs['active']['finished']), (2, 'cancelled', 25))
        self.assertEqual((jobs['done']['status'], jobs['done']['finished']), ('complete', 12))
        self.assertEqual(jobs['expired']['status'], 'expired')
        self.assertEqual(jobs['new-account']['status'], 'running')
        self.assertFalse(buglab_grading.active(self.db, 1, 'active', now=26))

    def test_merge_does_not_commit_and_rollback_restores_both_accounts(self):
        self.add(1, verified=True, star=1); self.add(2, verified=False)
        self.db.conn.commit()
        self.db.conn.execute('BEGIN')
        buglab_merge.merge(self.db, 1, 2)
        self.db.conn.rollback()
        self.assertEqual(len(self.db.q('SELECT * FROM buglab')), 2)
        self.assertEqual(self.result()['verified'], 0)


if __name__ == '__main__':
    unittest.main()
