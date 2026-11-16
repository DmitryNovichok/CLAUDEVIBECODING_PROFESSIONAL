"""Teacher activation from real class work; demo pupils never count.

Read-only queries use existing assignment timestamps, so upgrading an old database
does not invent activation events. A result is a finished assigned work, not a
browser visit or an answer that has not reached the server.
"""
import time
from statistics import median


def teacher_journey(db, tid, main_id, now=None):
    now = time.time() if now is None else now
    first = db.q("""SELECT MIN(a.created) first_assignment
        FROM assignments a JOIN classes c ON c.id=a.class_id
        WHERE COALESCE(c.teacher_id,?)=? AND COALESCE(c.is_demo,0)=0""",
        (main_id, tid), one=True)["first_assignment"]
    rows = db.q("""SELECT s.id, MIN(r.finished) first_result
        FROM asg_runs r JOIN assignments a ON a.id=r.asg_id
        JOIN classes c ON c.id=a.class_id JOIN students s ON s.id=r.student_id
        WHERE COALESCE(c.teacher_id,?)=? AND COALESCE(c.is_demo,0)=0
          AND COALESCE(s.teacher_id,?)=? AND COALESCE(s.is_teacher,0)=0
          AND s.name_key NOT LIKE 'demo:%' AND r.finished>=a.created AND r.finished<=?
        GROUP BY s.id""", (main_id, tid, main_id, tid, now))
    first_result = min((r["first_result"] for r in rows), default=None)
    week = sum(1 for r in rows if first is not None and r["first_result"] <= first + 7 * 86400)
    return {"first_assignment_at": first, "first_result_at": first_result,
            "finished_students": len(rows), "week_results": week,
            "week_goal": 5, "week_complete": week >= 5,
            "week_elapsed": bool(first is not None and now >= first + 7 * 86400),
            "time_to_first_result": max(0, first_result - first) if first is not None and first_result is not None else None}


def activation_stats(db, since_ts, main_id, now=None):
    """Signup cohort; the seven-day result window starts at the first assignment.

Only matured windows enter the rate denominator. Younger windows are displayed
as pending instead of silently counting as failed activation.
"""
    now = time.time() if now is None else now
    # One aggregate query for the cohort avoids two additional queries per teacher.
    teachers = db.q("""WITH cohort AS (
        SELECT id, email_ok, moderation FROM teachers
        WHERE self_signup=1 AND COALESCE(guest,0)=0 AND created>=?
      ), works AS (
        SELECT a.id, a.created, t.id teacher_id FROM assignments a
        JOIN classes c ON c.id=a.class_id JOIN cohort t ON t.id=COALESCE(c.teacher_id,?)
        WHERE COALESCE(c.is_demo,0)=0
      ), first_work AS (
        SELECT teacher_id, MIN(created) first_assignment FROM works GROUP BY teacher_id
      ), pupil_results AS (
        SELECT w.teacher_id, s.id, MIN(r.finished) first_result
        FROM works w JOIN asg_runs r ON r.asg_id=w.id JOIN students s ON s.id=r.student_id
        WHERE COALESCE(s.teacher_id,?)=w.teacher_id AND COALESCE(s.is_teacher,0)=0
          AND s.name_key NOT LIKE 'demo:%' AND r.finished>=w.created AND r.finished<=?
        GROUP BY w.teacher_id,s.id
      ) SELECT t.id, t.email_ok, t.moderation, f.first_assignment,
          MIN(p.first_result) first_result,
          SUM(CASE WHEN p.first_result<=f.first_assignment+604800 THEN 1 ELSE 0 END) week_results
        FROM cohort t LEFT JOIN first_work f ON f.teacher_id=t.id
        LEFT JOIN pupil_results p ON p.teacher_id=t.id GROUP BY t.id""", (since_ts, main_id, main_id, now))
    matured = [t for t in teachers if t['first_assignment'] is not None and now >= t['first_assignment'] + 7*86400]
    delays = [max(0, t['first_result']-t['first_assignment']) for t in teachers if t['first_result'] is not None]
    return {"approved": sum(bool(t["email_ok"] and t["moderation"] == "approved") for t in teachers),
            "first_assignments": sum(t["first_assignment"] is not None for t in teachers),
            "first_results": sum(t["first_result"] is not None for t in teachers),
            "activated_in_week": sum(t["week_results"] >= 5 for t in teachers),
            "matured_windows": len(matured),
            "matured_activated": sum(t["week_results"] >= 5 for t in matured),
            "pending_windows": sum(t["first_assignment"] is not None and now < t["first_assignment"] + 7*86400 for t in teachers),
            "median_first_result_seconds": median(delays) if delays else None}
