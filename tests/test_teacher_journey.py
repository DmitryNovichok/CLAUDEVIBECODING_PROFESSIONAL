"""Activation counts cannot be inflated with demos, repeat runs or another teacher."""
import sqlite3
import unittest

from teacher_journey import teacher_journey, activation_stats


class MemoryDB:
    def __init__(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript('''
            CREATE TABLE teachers(id, created, self_signup, guest, email_ok, moderation);
            CREATE TABLE classes(id, teacher_id, is_demo);
            CREATE TABLE assignments(id, class_id, created);
            CREATE TABLE students(id, teacher_id, is_teacher, name_key);
            CREATE TABLE asg_runs(asg_id, student_id, finished);
            INSERT INTO teachers VALUES(1,100,0,0,1,'approved'),(2,100,1,0,1,'approved'),(3,100,1,0,0,'pending');
            INSERT INTO classes VALUES(1,2,0),(2,2,1),(3,3,0),(4,NULL,0);
            INSERT INTO assignments VALUES(1,1,200),(2,1,300),(3,2,100),(4,3,200),(5,4,200);
            INSERT INTO students VALUES(1,2,0,'student1'),(2,2,0,'student2'),(3,2,0,'student3'),
                (4,2,0,'student4'),(5,2,0,'student5'),(6,2,1,'teacher2'),(7,2,0,'demo:2:7'),(8,3,0,'other');
        ''')

    def q(self, sql, params=(), one=False):
        cursor = self.conn.execute(sql, params)
        return cursor.fetchone() if one else cursor.fetchall()


class TeacherJourneyTest(unittest.TestCase):
    def setUp(self): self.db = MemoryDB()
    def tearDown(self): self.db.conn.close()

    def test_empty_journey_does_not_invent_results(self):
        j = teacher_journey(self.db, 2, 1, now=1000)
        self.assertEqual(j['first_assignment_at'], 200)
        self.assertIsNone(j['first_result_at'])
        self.assertIsNone(j['time_to_first_result'])
        self.assertFalse(j['week_complete'])

    def test_scope_demo_teacher_pending_repeat_and_future_excluded(self):
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [
            (1,1,250),(2,1,350),(1,2,None),(3,3,150),(1,6,230),(1,7,240),
            (1,8,220),(4,8,260),(1,4,2000),(1,5,150)])
        j = teacher_journey(self.db, 2, 1, now=1000)
        self.assertEqual(j['finished_students'], 1)
        self.assertEqual(j['first_result_at'], 250)
        self.assertEqual(j['time_to_first_result'], 50)
        self.assertEqual(teacher_journey(self.db, 3, 1, now=1000)['finished_students'], 1)

    def test_week_goal_counts_five_different_pupils_and_exact_boundary(self):
        end = 200 + 7*86400
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,end) for i in range(1,6)])
        j = teacher_journey(self.db, 2, 1, now=end)
        self.assertTrue(j['week_complete'])
        self.assertEqual(j['week_results'], 5)
        self.assertTrue(j['week_elapsed'])
        cohort = activation_stats(self.db, 0, 1, now=end)
        self.assertEqual(cohort['first_results'], 1)
        self.assertEqual(cohort['activated_in_week'], 1)
        self.assertEqual(cohort['matured_activated'], 1)
        self.assertEqual(cohort['median_first_result_seconds'], 7*86400)
        self.db.conn.execute('UPDATE asg_runs SET finished=? WHERE student_id=5', (end+1,))
        self.assertFalse(teacher_journey(self.db, 2, 1, now=end+1)['week_complete'])

    def test_recent_cohorts_not_treated_as_failed_and_no_division_by_zero(self):
        young = activation_stats(self.db, 0, 1, now=1000)
        self.assertEqual(young['matured_windows'], 0)
        self.assertEqual(young['pending_windows'], 2)
        self.assertEqual(young['approved'], 1)
        self.assertIsNone(young['median_first_result_seconds'])
        self.assertEqual(activation_stats(self.db, 500, 1, now=1000)['first_assignments'], 0)


if __name__ == '__main__': unittest.main()
