"""Activation counts cannot be inflated with demos, repeat runs or another teacher."""
import sqlite3
import unittest

from teacher_journey import teacher_journey, activation_stats


class MemoryDB:
    def __init__(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript('''
            CREATE TABLE teachers(id, created, self_signup, guest, email_ok, moderation, activation_registered_at, admitted_at);
            CREATE TABLE classes(id, teacher_id, is_demo, created);
            CREATE TABLE assignments(id, class_id, created);
            CREATE TABLE students(id, teacher_id, is_teacher, name_key);
            CREATE TABLE asg_runs(asg_id, student_id, finished);
            INSERT INTO teachers VALUES(1,100,0,0,1,'approved',NULL,NULL),
                (2,100,1,0,1,'approved',100,180),(3,100,1,0,0,'pending',100,NULL);
            INSERT INTO classes VALUES(1,2,0,190),(2,2,1,100),(3,3,0,190),(4,NULL,0,190);
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
        end = 180 + 7*86400
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
        self.assertEqual(young['pending_windows'], 1)
        self.assertEqual(young['approved'], 1)
        self.assertIsNone(young['median_first_result_seconds'])
        self.assertEqual(activation_stats(self.db, 500, 1, now=1000)['first_assignments'], 0)

    def test_admitted_teacher_without_class_or_work_remains_in_denominator(self):
        self.db.conn.execute("INSERT INTO teachers VALUES(4,100,1,0,1,'approved',100,180)")
        end = 180 + 7*86400
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,250) for i in range(1,6)])
        stats = activation_stats(self.db, 0, 1, now=end)
        self.assertEqual(stats['matured_windows'], 2)
        self.assertEqual(stats['matured_activated'], 1)
        self.assertEqual(stats['first_assignments'], 1)
        self.assertEqual(stats['median_first_result_seconds'], 70)

    def test_waiting_for_first_assignment_does_not_restart_week(self):
        end = 180 + 7*86400
        self.db.conn.execute('UPDATE assignments SET created=? WHERE class_id=1', (end+10,))
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,end+20) for i in range(1,6)])
        stats = activation_stats(self.db, 0, 1, now=end+100)
        self.assertEqual(stats['first_results'], 1)
        self.assertEqual(stats['matured_windows'], 1)
        self.assertEqual(stats['matured_activated'], 0)
        self.assertEqual(teacher_journey(self.db, 2, 1, now=end+100)['week_results'], 0)

    def test_registration_rate_includes_unapproved_teachers_and_has_own_clock(self):
        # Approval delay is visible in signup conversion, not silently omitted.
        admitted = 100 + 6*86400
        self.db.conn.execute('UPDATE teachers SET admitted_at=? WHERE id=2', (admitted,))
        self.db.conn.execute('UPDATE classes SET created=? WHERE id=1', (admitted+10,))
        self.db.conn.execute('UPDATE assignments SET created=? WHERE class_id=1', (admitted+20,))
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,admitted+2*86400) for i in range(1,6)])
        stats = activation_stats(self.db, 0, 1, now=admitted+7*86400)
        self.assertEqual(stats['registration_matured'], 2)
        self.assertEqual(stats['registration_activated'], 0)
        self.assertEqual(stats['matured_windows'], 1)
        self.assertEqual(stats['matured_activated'], 1)

    def test_legacy_dates_are_unknown_and_demo_does_not_make_teacher_active(self):
        self.db.conn.execute("INSERT INTO teachers VALUES(4,100,1,0,1,'approved',NULL,NULL)")
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(3,i,250) for i in range(1,6)])
        stats = activation_stats(self.db, 0, 1, now=100+8*86400)
        self.assertEqual(stats['registered'], 3)
        self.assertEqual(stats['unknown_admission'], 1)
        self.assertEqual(stats['unknown_registration_windows'], 1)
        self.assertEqual(stats['matured_windows'], 1)
        self.assertEqual(stats['matured_activated'], 0)
        legacy = teacher_journey(self.db, 4, 1, now=100+8*86400)
        self.assertIsNone(legacy['admitted_at'])
        self.assertIsNone(legacy['week_results'])
        self.assertIsNone(legacy['week_complete'])

    def test_guest_conversion_uses_actual_registration_not_old_guest_created_time(self):
        self.db.conn.execute("INSERT INTO teachers VALUES(4,1,1,0,1,'approved',900,950)")
        stats = activation_stats(self.db, 800, 1, now=1000)
        self.assertEqual(stats['registered'], 1)
        self.assertEqual(stats['pending_windows'], 1)
        self.assertEqual(stats['registration_pending'], 1)

    def test_preserved_guest_class_counts_and_later_class_cannot_change_week(self):
        # Conversion preserves real classes, while removing the demo class.
        self.db.conn.execute('UPDATE classes SET created=10 WHERE id=1')
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,250) for i in range(1,6)])
        now = 180 + 11*86400
        before = activation_stats(self.db, 0, 1, now=now)
        self.assertEqual(before['classes_after_admission'], 1)
        self.assertEqual(before['matured_activated'], 1)
        self.assertEqual(before['registration_activated'], 1)
        self.db.conn.execute('INSERT INTO classes VALUES(5,2,0,?)', (180+10*86400,))
        after = activation_stats(self.db, 0, 1, now=now)
        self.assertEqual(after['matured_activated'], before['matured_activated'])
        self.assertEqual(after['registration_activated'], before['registration_activated'])

    def test_late_class_without_qualifying_work_cannot_activate_teacher(self):
        now = 180 + 11*86400
        self.db.conn.execute('UPDATE classes SET is_demo=1 WHERE id=1')
        self.db.conn.executemany('INSERT INTO asg_runs VALUES(?,?,?)', [(1,i,250) for i in range(1,6)])
        self.db.conn.execute('INSERT INTO classes VALUES(5,2,0,?)', (180+10*86400,))
        stats = activation_stats(self.db, 0, 1, now=now)
        self.assertEqual(stats['classes_after_admission'], 1)
        self.assertEqual(stats['matured_activated'], 0)
        self.assertEqual(stats['registration_activated'], 0)


if __name__ == '__main__': unittest.main()
