"""Merge practice records without promoting self-checks to verified evidence.

Call inside the account-merge DB transaction, before deleting old_sid. This
module never commits, executes code or treats browser output as proof.
"""
import hashlib
import math
import time


def _stamp(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 else None


def _earliest(rows, key):
    values = [_stamp(row.get(key)) for row in rows]
    return min((x for x in values if x is not None), default=None)


def _proof(row):
    code = row.get('verified_code')
    if row.get('verified') != 1 or not row.get('ok') or not isinstance(code, str) or not code.strip() or _stamp(row.get('verified_ts')) is None:
        return False
    try:
        return hashlib.sha256(code.encode('utf-8')).hexdigest() == row.get('verified_code_hash')
    except UnicodeEncodeError:
        return False


def merge(db, old_sid, new_sid, now=None):
    if old_sid == new_sid:
        return {'cases': 0, 'jobs': 0}
    now = time.time() if now is None else now
    old = [dict(row) for row in db.q('SELECT * FROM buglab WHERE student_id=?', (old_sid,))]
    for previous in old:
        target = db.q('SELECT * FROM buglab WHERE student_id=? AND case_id=?',
                      (new_sid, previous['case_id']), one=True)
        rows = ([dict(target)] if target else []) + [previous]
        proofs = [row for row in rows if _proof(row)]
        proof = max(proofs, key=lambda row: (int(bool(row.get('star'))), -row['verified_ts'])) if proofs else None
        practiced = next((row for row in rows if row.get('ok') and row.get('code')), None)
        code = proof['verified_code'] if proof else practiced['code'] if practiced else None
        values = {
            'ok': int(any(row.get('ok') for row in rows)),
            'tries': sum(max(0, int(row.get('tries') or 0)) for row in rows),
            'seen': int(any(row.get('seen') for row in rows)),
            'star': int(bool(proof and proof.get('star'))),
            'first_ts': _earliest(rows, 'first_ts'), 'ok_ts': _earliest(rows, 'ok_ts'), 'code': code,
            'verified': int(proof is not None), 'verified_ts': proof['verified_ts'] if proof else None,
            'verified_code_hash': proof['verified_code_hash'] if proof else None,
            'verified_code': proof['verified_code'] if proof else None,
        }
        columns = list(values)
        db.x(f'''INSERT INTO buglab(student_id,case_id,{','.join(columns)})
                 VALUES({','.join('?' for _ in range(len(columns) + 2))})
                 ON CONFLICT(student_id,case_id) DO UPDATE SET
                 {','.join(column + '=excluded.' + column for column in columns)}''',
             (new_sid, previous['case_id'], *values.values()))
    db.x('DELETE FROM buglab WHERE student_id=?', (old_sid,))
    jobs = db.q('SELECT COUNT(*) AS n FROM buglab_jobs WHERE student_id=?', (old_sid,), one=True)['n']
    # Keep completed/expired entries for persistent quota accounting. A running
    # old-account request must no longer match (job id, old sid, running) on save.
    db.x('''UPDATE buglab_jobs SET student_id=?,
            finished=CASE WHEN status='running' THEN ? ELSE finished END,
            status=CASE WHEN status='running' THEN 'cancelled' ELSE status END
            WHERE student_id=?''', (new_sid, now, old_sid))
    return {'cases': len(old), 'jobs': jobs}
