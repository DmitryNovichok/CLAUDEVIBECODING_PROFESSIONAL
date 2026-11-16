"""Persistent, account-scoped reservations for protected teaching files.

No IP budgets: a classroom behind one router has independent pupil allowances.
Resource keys are hashes of canonical files, never URLs or bearer credentials.
"""
import hashlib
import math
import time

from bank_delivery import Decision, AUDIT_DAYS

REQUESTS_PER_MINUTE = 240
WINDOWS = ((3600, 240, 2 * 1024 ** 3), (86400, 1000, 8 * 1024 ** 3))


class DownloadDelivery:
    def __init__(self, db):
        self.db = db
        self.next_cleanup = 0
        with db.lock:
            db.conn.executescript("""
                CREATE TABLE IF NOT EXISTS download_seen(
                    kind TEXT NOT NULL, account_id INTEGER NOT NULL, resource TEXT NOT NULL,
                    ts REAL NOT NULL, PRIMARY KEY(kind,account_id,resource));
                CREATE INDEX IF NOT EXISTS download_seen_time ON download_seen(kind,account_id,ts);
                CREATE TABLE IF NOT EXISTS download_usage(
                    kind TEXT NOT NULL, account_id INTEGER NOT NULL, minute INTEGER NOT NULL,
                    requests INTEGER NOT NULL, bytes INTEGER NOT NULL,
                    PRIMARY KEY(kind,account_id,minute));
                CREATE TABLE IF NOT EXISTS download_events(
                    kind TEXT NOT NULL, account_id INTEGER NOT NULL, reason TEXT NOT NULL,
                    bucket INTEGER NOT NULL, first_ts REAL NOT NULL, last_ts REAL NOT NULL,
                    n INTEGER NOT NULL, requested INTEGER NOT NULL,
                    PRIMARY KEY(kind,account_id,reason,bucket));
            """)
            for kind, table in (('student', 'students'), ('teacher', 'teachers')):
                if db.conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    db.conn.executescript(f"""
                        CREATE TRIGGER IF NOT EXISTS download_delete_{kind} AFTER DELETE ON {table}
                        BEGIN
                            DELETE FROM download_seen WHERE kind='{kind}' AND account_id=OLD.id;
                            DELETE FROM download_usage WHERE kind='{kind}' AND account_id=OLD.id;
                            DELETE FROM download_events WHERE kind='{kind}' AND account_id=OLD.id;
                        END;
                    """)

    def check(self, account, resource, size, *, head=False, now=None):
        """Reserve before reading/sending; HEAD counts requests but no file/byte spend.

        Successful reopens do not consume the distinct-file budget again that day.
        Actual bytes are still counted, bounding repeated large downloads as well.
        """
        kind, aid = account
        if kind not in ('student', 'teacher') or size < 0:
            raise ValueError('invalid download reservation')
        now = time.time() if now is None else now
        minute = int(now // 60)
        key = hashlib.sha256(str(resource).encode()).hexdigest()
        multiplier = 4 if kind == 'teacher' else 1
        with self.db.transaction():
            c = self.db.conn
            if now >= self.next_cleanup:
                c.execute('DELETE FROM download_seen WHERE ts<=?', (now - 86400,))
                c.execute('DELETE FROM download_usage WHERE minute<?', (minute - 1441,))
                c.execute('DELETE FROM download_events WHERE last_ts<=?', (now - AUDIT_DAYS * 86400,))
                c.execute('DELETE FROM download_events WHERE rowid IN '
                          '(SELECT rowid FROM download_events ORDER BY last_ts DESC LIMIT -1 OFFSET 10000)')
                self.next_cleanup = now + 3600
            c.execute('INSERT INTO download_usage VALUES(?,?,?,1,0) '
                      'ON CONFLICT(kind,account_id,minute) DO UPDATE SET requests=requests+1', (kind, aid, minute))
            count = c.execute('SELECT requests FROM download_usage WHERE kind=? AND account_id=? AND minute=?',
                              (kind, aid, minute)).fetchone()[0]
            reason, waits = None, []
            if count > REQUESTS_PER_MINUTE:
                reason, waits = 'file_request_rate', [(minute + 1) * 60 - now]
            elif not head:
                seen = c.execute('SELECT ts FROM download_seen WHERE kind=? AND account_id=? AND resource=?',
                                 (kind, aid, key)).fetchone()
                new = not seen or seen[0] <= now - 86400
                for seconds, limit, byte_limit in WINDOWS:
                    if new:
                        stamps = [r[0] for r in c.execute(
                            'SELECT ts FROM download_seen WHERE kind=? AND account_id=? AND ts>? ORDER BY ts',
                            (kind, aid, now - seconds))]
                        if len(stamps) >= limit * multiplier:
                            reason = 'new_files'
                            waits.append(stamps[len(stamps) - limit * multiplier] + seconds - now)
                    # Minute buckets are conservative by at most 59 seconds.
                    rows = list(c.execute('SELECT minute,bytes FROM download_usage WHERE kind=? AND account_id=? '
                                          'AND minute>=? AND bytes>0 ORDER BY minute',
                                          (kind, aid, int((now - seconds) // 60))))
                    excess = sum(r[1] for r in rows) + size - byte_limit * multiplier
                    if excess > 0:
                        reason = 'file_volume'
                        wait = seconds
                        for bucket, amount in rows:
                            excess -= amount
                            if excess <= 0:
                                wait = (bucket + 1) * 60 + seconds - now
                                break
                        waits.append(wait)
            if waits:
                c.execute('INSERT INTO download_events VALUES(?,?,?,?,?,?,1,?) '
                          'ON CONFLICT(kind,account_id,reason,bucket) DO UPDATE SET '
                          'last_ts=excluded.last_ts,n=n+1,requested=requested+excluded.requested',
                          (kind, aid, reason, int(now // 300), now, now, size))
                return Decision(429, max(1, math.ceil(max(waits))))
            if not head:
                c.execute('UPDATE download_usage SET bytes=bytes+? WHERE kind=? AND account_id=? AND minute=?',
                          (size, kind, aid, minute))
                if new:
                    c.execute('INSERT INTO download_seen VALUES(?,?,?,?) '
                              'ON CONFLICT(kind,account_id,resource) DO UPDATE SET ts=excluded.ts', (kind, aid, key, now))
        return Decision()

    def audit(self):
        rows = self.db.q("""SELECT e.*, s.name AS student_name, t.name AS teacher_name,
                           own.name AS owner_name FROM download_events e
                           LEFT JOIN students s ON e.kind='student' AND s.id=e.account_id
                           LEFT JOIN teachers t ON e.kind='teacher' AND t.id=e.account_id
                           LEFT JOIN teachers own ON own.id=s.teacher_id
                           WHERE e.last_ts>? ORDER BY e.last_ts DESC LIMIT 100""", (time.time() - AUDIT_DAYS * 86400,))
        return [dict(row, name=row['student_name'] or row['teacher_name'], unit='bytes',
                     teacher_name=row['owner_name'] or row['teacher_name']) for row in rows]
