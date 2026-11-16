"""Persist independent Bug Lab evidence and bounded grading reservations.

No Python executes here. Callers hold a database transaction for reserve/save;
the isolated runner must run between, never inside, those transactions.
"""
import hashlib
import secrets
import time

MINUTE_LIMIT, HOUR_LIMIT, DAY_LIMIT = 6, 60, 300
LEASE_SECONDS = 180


class Limited(Exception):
    def __init__(self, message, retry_after=60):
        super().__init__(message)
        self.retry_after = retry_after


def migrate(conn):
    columns = {row[1] for row in conn.execute('PRAGMA table_info(buglab)')}
    for name, sql_type in (('verified', 'INTEGER NOT NULL DEFAULT 0'), ('verified_ts', 'REAL'),
                           ('verified_code_hash', 'TEXT'), ('verified_code', 'TEXT')):
        if name not in columns:
            conn.execute(f'ALTER TABLE buglab ADD COLUMN {name} {sql_type}')
    # Successful historical browser checks automatically returned the explanation.
    conn.execute('UPDATE buglab SET seen=1 WHERE ok=1 AND COALESCE(verified,0)=0')
    conn.execute('''CREATE TABLE IF NOT EXISTS buglab_jobs(
        id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, started REAL NOT NULL,
        finished REAL, status TEXT NOT NULL)''')
    conn.execute('CREATE INDEX IF NOT EXISTS buglab_jobs_student ON buglab_jobs(student_id,started)')


def state(row=None):
    r = dict(row) if row else {}
    verified = bool(r.get('verified'))
    result = {key: r.get(key, 0) for key in ('ok', 'tries', 'seen')}
    result.update(star=int(bool(r.get('star')) and verified), verified=verified,
                  provenance='server_python' if verified else 'self_check')
    if verified:
        result.update(verified_ts=r.get('verified_ts'), verified_code_hash=r.get('verified_code_hash'))
    return result


def reserve(db, sid, now=None):
    now = time.time() if now is None else now
    db.x('DELETE FROM buglab_jobs WHERE started<?', (now - 86400,))
    db.x("UPDATE buglab_jobs SET status='expired',finished=? WHERE status='running' AND started<=?",
         (now, now - LEASE_SECONDS))
    rows = db.q('SELECT started,status FROM buglab_jobs WHERE student_id=? AND started>?', (sid, now - 86400))
    if any(r['status'] == 'running' for r in rows):
        raise Limited('Предыдущая независимая проверка ещё выполняется.', 5)
    # Failed infrastructure requests still have a short abuse guard, but no daily cost.
    if sum(r['started'] > now - 60 for r in rows) >= MINUTE_LIMIT:
        raise Limited('Слишком много проверок подряд. Подождите минуту.')
    # A completed computation still costs quota when logout/revocation/merge
    # prevents saving it. Otherwise logout/relogin would bypass the daily limit.
    chargeable = [r for r in rows if r['status'] in ('running', 'complete', 'expired', 'cancelled')]
    if sum(r['started'] > now - 3600 for r in chargeable) >= HOUR_LIMIT:
        raise Limited('Лимит независимых проверок за час исчерпан. Попробуйте позже.', 3600)
    if len(chargeable) >= DAY_LIMIT:
        raise Limited('Лимит независимых проверок за сутки исчерпан. Попробуйте позже.', 86400)
    job = secrets.token_hex(16)
    db.x("INSERT INTO buglab_jobs(id,student_id,started,status) VALUES(?,?,?,'running')", (job, sid, now))
    return job


def active(db, sid, job, now=None):
    now = time.time() if now is None else now
    return bool(db.q("SELECT 1 FROM buglab_jobs WHERE id=? AND student_id=? AND status='running' AND started>?",
                     (job, sid, now - LEASE_SECONDS), one=True))


def finish(db, job, status, now=None):
    db.x("UPDATE buglab_jobs SET status=?,finished=? WHERE id=? AND status='running'",
         (status, time.time() if now is None else now, job))


def save(db, sid, case, code, verdict, now=None):
    """Save only a trusted completed verdict; preserve earlier independent proof."""
    now = time.time() if now is None else now
    row = db.q('SELECT * FROM buglab WHERE student_id=? AND case_id=?', (sid, case['id']), one=True)
    was = state(row)
    ok = bool(verdict['ok'])
    star = ok and verdict['changed'] <= case['par'] and not was['seen']
    digest = hashlib.sha256(code.encode('utf-8')).hexdigest() if ok else None
    db.x('''INSERT INTO buglab(student_id,case_id,ok,tries,star,seen,first_ts,ok_ts,code,
            verified,verified_ts,verified_code_hash,verified_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(student_id,case_id) DO UPDATE SET
            ok=MAX(ok,excluded.ok),tries=tries+(1-excluded.ok)*(1-verified),star=MAX(star,excluded.star),
            seen=MAX(seen,excluded.seen),
            ok_ts=COALESCE(ok_ts,excluded.ok_ts),
            code=CASE WHEN excluded.verified AND (NOT verified OR excluded.star>=star) THEN excluded.code ELSE code END,
            verified=MAX(verified,excluded.verified),
            verified_ts=CASE WHEN excluded.verified AND (NOT verified OR excluded.star>=star) THEN excluded.verified_ts ELSE verified_ts END,
            verified_code_hash=CASE WHEN excluded.verified AND (NOT verified OR excluded.star>=star) THEN excluded.verified_code_hash ELSE verified_code_hash END,
            verified_code=CASE WHEN excluded.verified AND (NOT verified OR excluded.star>=star) THEN excluded.verified_code ELSE verified_code END''',
         (sid, case['id'], int(ok), 0 if ok else 1, int(star), int(ok), now, now if ok else None, code if ok else None,
          int(ok), now if ok else None, digest, code if ok else None))
    return state(db.q('SELECT * FROM buglab WHERE student_id=? AND case_id=?', (sid, case['id']), one=True))
