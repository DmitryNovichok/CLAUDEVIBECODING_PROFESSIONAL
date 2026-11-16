"""Teacher activation from real class work; demo pupils never count.

The activation clock starts when both access requirements are completed, not
when the teacher finally issues an assignment. Teachers who issue no work remain
in the denominator. Legacy admission dates stay unknown rather than being
inferred from a trial, an account creation time or the first visit after upgrade.
A result is a finished assigned work, not a browser visit or an unsaved answer.
"""
import time
from statistics import median


def teacher_journey(db, tid, main_id, now=None):
    now = time.time() if now is None else now
    teacher = db.q('SELECT admitted_at FROM teachers WHERE id=?', (tid,), one=True)
    admitted = teacher['admitted_at'] if teacher else None
    first = db.q("""SELECT MIN(a.created) first_assignment
        FROM assignments a JOIN classes c ON c.id=a.class_id
        WHERE COALESCE(c.teacher_id,?)=? AND COALESCE(c.is_demo,0)=0 AND a.created<=?""",
        (main_id, tid, now), one=True)["first_assignment"]
    rows = db.q("""SELECT s.id, MIN(r.finished) first_result,
          MIN(CASE WHEN a.created>=? THEN r.finished END) admitted_result
        FROM asg_runs r JOIN assignments a ON a.id=r.asg_id
        JOIN classes c ON c.id=a.class_id JOIN students s ON s.id=r.student_id
        WHERE COALESCE(c.teacher_id,?)=? AND COALESCE(c.is_demo,0)=0
          AND COALESCE(s.teacher_id,?)=? AND COALESCE(s.is_teacher,0)=0
          AND s.name_key NOT LIKE 'demo:%' AND r.finished>=a.created AND r.finished<=?
        GROUP BY s.id""", (admitted, main_id, tid, main_id, tid, now))
    first_result = min((r["first_result"] for r in rows), default=None)
    week = sum(1 for r in rows if r['admitted_result'] is not None and r['admitted_result'] <= admitted + 7*86400) if admitted is not None else None
    return {"first_assignment_at": first, "first_result_at": first_result, "admitted_at": admitted,
            "finished_students": len(rows), "week_results": week,
            "week_goal": 5, "week_complete": week >= 5 if week is not None else None,
            "week_elapsed": now >= admitted + 7*86400 if admitted is not None else None,
            "time_to_first_result": max(0, first_result - first) if first is not None and first_result is not None else None}


def activation_stats(db, since_ts, main_id, now=None):
    """Signup cohort, with separate seven-day registration and admission windows.

Only mature windows enter each rate denominator. Admission windows include every
tracked admitted teacher, even without a class or assignment. Registration
windows include teachers still waiting for email/moderation. Unknown legacy
admissions are disclosed separately and cannot fabricate successes or failures.
"""
    now = time.time() if now is None else now
    # One aggregate query for the cohort avoids two additional queries per teacher.
    teachers = db.q("""WITH cohort AS (
        SELECT id, email_ok, moderation, admitted_at, activation_registered_at,
          COALESCE(activation_registered_at,created) registered_at
        FROM teachers WHERE self_signup=1 AND COALESCE(guest,0)=0
          AND COALESCE(activation_registered_at,created)>=?
          AND COALESCE(activation_registered_at,created)<=?
      ), works AS (
        SELECT a.id, a.created, t.id teacher_id FROM assignments a
        JOIN classes c ON c.id=a.class_id JOIN cohort t ON t.id=COALESCE(c.teacher_id,?)
        WHERE COALESCE(c.is_demo,0)=0 AND a.created>=t.admitted_at AND a.created<=?
      ), first_work AS (
        SELECT teacher_id, MIN(created) first_assignment FROM works GROUP BY teacher_id
      ), pupil_results AS (
        SELECT w.teacher_id, s.id, MIN(r.finished) first_result
        FROM works w JOIN asg_runs r ON r.asg_id=w.id JOIN students s ON s.id=r.student_id
        WHERE COALESCE(s.teacher_id,?)=w.teacher_id AND COALESCE(s.is_teacher,0)=0
          AND s.name_key NOT LIKE 'demo:%' AND r.finished>=w.created AND r.finished<=?
        GROUP BY w.teacher_id,s.id
      ) SELECT t.id, t.email_ok, t.moderation, t.registered_at, t.activation_registered_at,
          t.admitted_at, f.first_assignment,
          EXISTS(SELECT 1 FROM classes c WHERE COALESCE(c.teacher_id,?)=t.id
            AND COALESCE(c.is_demo,0)=0 AND t.admitted_at IS NOT NULL AND c.created<=?) has_class,
          MIN(p.first_result) first_result,
          SUM(CASE WHEN p.first_result<=t.admitted_at+604800 THEN 1 ELSE 0 END) week_results,
          SUM(CASE WHEN p.first_result<=t.registered_at+604800 THEN 1 ELSE 0 END) registration_results
        FROM cohort t LEFT JOIN first_work f ON f.teacher_id=t.id
        LEFT JOIN pupil_results p ON p.teacher_id=t.id GROUP BY t.id""",
        (since_ts, now, main_id, now, main_id, now, main_id, now))
    admitted = [t for t in teachers if t['admitted_at'] is not None and t['admitted_at'] <= now]
    matured = [t for t in admitted if now >= t['admitted_at'] + 7*86400]
    registered = [t for t in teachers if t['activation_registered_at'] is not None]
    registration_matured = [t for t in registered if now >= t['registered_at'] + 7*86400]
    delays = [t['first_result']-t['admitted_at'] for t in admitted if t['first_result'] is not None]
    # A qualifying assignment already belongs to a real, owned class. Its class
    # may have been preserved when a guest registered. Unrelated later class
    # creation must never change whether the original seven-day goal was met.
    activated = lambda t, key: bool(t['first_assignment'] is not None and t[key] >= 5)
    return {"registered": len(teachers), "tracked_registered": len(registered),
            "approved": sum(bool(t["email_ok"] and t["moderation"] == "approved") for t in teachers),
            "admitted": len(admitted),
            "unknown_admission": sum(t['admitted_at'] is None and bool(t['email_ok'] and t['moderation'] == 'approved') for t in teachers),
            "unknown_registration_windows": len(teachers) - len(registered),
            "classes_after_admission": sum(bool(t['has_class']) for t in teachers),
            "first_assignments": sum(t["first_assignment"] is not None for t in teachers),
            "first_results": sum(t["first_result"] is not None for t in teachers),
            "activated_in_week": sum(activated(t, 'week_results') for t in admitted),
            "matured_windows": len(matured),
            "matured_activated": sum(activated(t, 'week_results') for t in matured),
            "pending_windows": len(admitted) - len(matured),
            "registration_matured": len(registration_matured),
            "registration_activated": sum(activated(t, 'registration_results') for t in registration_matured),
            "registration_pending": len(registered) - len(registration_matured),
            "median_first_result_seconds": median(delays) if delays else None}
