"""Account-based condition delivery. Policy and audit data stay on the server."""
import math
import time
from dataclasses import dataclass

PAGE_SIZE = 20
MAX_BATCH = 30
REQUESTS_PER_MINUTE = 120
# New conditions in rolling windows. Reopening a condition within a day is free.
WINDOWS = ((60, 80), (3600, 240), (86400, 700))
AUDIT_DAYS = 30


@dataclass(frozen=True)
class Decision:
    status: int = 200
    retry_after: int = 0


class BankDelivery:
    def __init__(self, db):
        self.db = db
        self.next_cleanup = 0
        with db.lock:
            db.conn.executescript("""
                CREATE TABLE IF NOT EXISTS bank_html_seen(
                    student_id INTEGER NOT NULL, task_id TEXT NOT NULL, ts REAL NOT NULL,
                    PRIMARY KEY(student_id, task_id));
                CREATE INDEX IF NOT EXISTS bank_html_seen_time ON bank_html_seen(student_id, ts);
                CREATE INDEX IF NOT EXISTS bank_html_seen_expiry ON bank_html_seen(ts);
                CREATE TABLE IF NOT EXISTS bank_html_requests(
                    student_id INTEGER NOT NULL, minute INTEGER NOT NULL, n INTEGER NOT NULL,
                    PRIMARY KEY(student_id, minute));
                CREATE TABLE IF NOT EXISTS bank_html_events(
                    student_id INTEGER NOT NULL, reason TEXT NOT NULL, bucket INTEGER NOT NULL,
                    first_ts REAL NOT NULL, last_ts REAL NOT NULL, n INTEGER NOT NULL,
                    requested INTEGER NOT NULL,
                    PRIMARY KEY(student_id, reason, bucket));
                CREATE INDEX IF NOT EXISTS bank_html_events_time ON bank_html_events(last_ts);
            """)
            if db.conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='students'").fetchone():
                db.conn.executescript("""
                    CREATE TRIGGER IF NOT EXISTS bank_html_delete_student AFTER DELETE ON students
                    BEGIN
                        DELETE FROM bank_html_seen WHERE student_id=OLD.id;
                        DELETE FROM bank_html_requests WHERE student_id=OLD.id;
                        DELETE FROM bank_html_events WHERE student_id=OLD.id;
                    END;
                """)

    @staticmethod
    def event(c, sid, reason, requested, now):
        # Aggregate repeated requests; never store tokens, addresses or task text.
        c.execute("""INSERT INTO bank_html_events VALUES(?,?,?,?,?,1,?)
                     ON CONFLICT(student_id,reason,bucket) DO UPDATE SET
                     last_ts=excluded.last_ts, n=n+1, requested=requested+excluded.requested""",
                  (sid, reason, int(now // 300), now, now, min(10000, max(0, requested))))

    def check(self, student, ids=(), *, issue=None, requested=None, now=None):
        """Reserve all selected conditions atomically, or return a retry deadline.

        The key is an account ID, never a session or school IP. SQLite records survive
        logout/restart; BEGIN IMMEDIATE also serializes independent connections.
        """
        now = time.time() if now is None else now
        sid, minute = student['id'], int(now // 60)
        ids = tuple(dict.fromkeys(ids))
        requested = len(ids) if requested is None else requested
        multiplier = 4 if student['is_teacher'] else 1
        with self.db.transaction():
            c = self.db.conn
            if now >= self.next_cleanup:
                c.execute('DELETE FROM bank_html_seen WHERE ts<=?', (now - 86400,))
                c.execute('DELETE FROM bank_html_requests WHERE minute<?', (minute - 2,))
                c.execute('DELETE FROM bank_html_events WHERE last_ts<=?', (now - AUDIT_DAYS * 86400,))
                c.execute('DELETE FROM bank_html_events WHERE rowid IN '
                          '(SELECT rowid FROM bank_html_events ORDER BY last_ts DESC LIMIT -1 OFFSET 10000)')
                self.next_cleanup = now + 3600
            c.execute('INSERT INTO bank_html_requests VALUES(?,?,1) '
                      'ON CONFLICT(student_id,minute) DO UPDATE SET n=n+1', (sid, minute))
            count = c.execute('SELECT n FROM bank_html_requests WHERE student_id=? AND minute=?',
                              (sid, minute)).fetchone()[0]
            if count > REQUESTS_PER_MINUTE:
                self.event(c, sid, 'request_rate', requested, now)
                return Decision(429, max(1, math.ceil((minute + 1) * 60 - now)))
            if issue:
                self.event(c, sid, issue, requested, now)
                return Decision(400)
            recent = dict(c.execute('SELECT task_id,ts FROM bank_html_seen WHERE student_id=? AND ts>?',
                                    (sid, now - 86400)).fetchall())
            new = [tid for tid in ids if tid not in recent]
            waits = []
            for seconds, limit in WINDOWS:
                stamps = sorted(ts for ts in recent.values() if ts > now - seconds)
                excess = len(stamps) + len(new) - limit * multiplier
                if new and excess > 0:
                    # Whole batches are retried, never partially charged/delivered.
                    wait = stamps[min(excess, len(stamps)) - 1] + seconds - now if stamps else seconds
                    waits.append(max(1, math.ceil(wait)))
            if waits:
                self.event(c, sid, 'new_conditions', requested, now)
                return Decision(429, max(waits))
            c.executemany('INSERT INTO bank_html_seen VALUES(?,?,?) '
                          'ON CONFLICT(student_id,task_id) DO UPDATE SET ts=excluded.ts',
                          ((sid, tid, now) for tid in new))
        return Decision()

    def audit(self):
        rows = self.db.q("""SELECT e.student_id, e.reason, e.first_ts, e.last_ts, e.n, e.requested,
                           s.name, t.name AS teacher_name
                           FROM bank_html_events e LEFT JOIN students s ON s.id=e.student_id
                           LEFT JOIN teachers t ON t.id=s.teacher_id
                           WHERE e.last_ts>? ORDER BY e.last_ts DESC LIMIT 100""",
                         (time.time() - AUDIT_DAYS * 86400,))
        return [dict(row) for row in rows]
