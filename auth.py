"""Пароли и отзыв доступа; без зависимости от HTTP-сервера."""
import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import urlsplit


# Keep validation, writes and token consumption in a single transaction.
ACCOUNT_WRITE_PATHS = frozenset({
    '/api/login', '/api/account', '/api/password', '/api/pw/reset',
    '/api/admin/password', '/api/admin/class/import',
    '/api/admin/student/newpw', '/api/admin/student/password-reset',
    '/api/teacher/signup', '/api/email/confirm', '/api/admin/email/change',
    '/api/admin/email/resend', '/api/admin/report', '/api/admin/teacher/moderate',
    '/api/admin/teacher/save', '/api/admin/teacher/extend',
    '/api/admin/security/end', '/api/admin/security/recovery',
})


def reset_fingerprint(account):
    """A recovery link belongs to this account and its current password/email."""
    state = [account[k] for k in ('id', 'created', 'pw', 'email')]
    return hashlib.sha256(json.dumps(state, ensure_ascii=False).encode()).hexdigest()


def recovery_origin(configured_url):
    """Never construct credential links from request-controlled Host headers."""
    value = str(configured_url or '').rstrip('/')
    try:
        parts = urlsplit(value)
        if (parts.scheme not in ('https', 'http') or not parts.hostname
                or parts.username or parts.password or parts.query or parts.fragment
                or parts.path or any(c.isspace() for c in value)):
            return None
    except ValueError:
        return None
    return value

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode(), 200_000).hex()
    return f"{salt}${h}"


def check_pw(pw, stored):
    if not stored or "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_pw(pw, salt), stored)



def revoke_access(db):
    """Offline incident response. No personal data or new secrets are printed."""
    with db.transaction():
        db.x('DELETE FROM admin_sessions')
        db.x('DELETE FROM admin_codes')
        db.x('DELETE FROM admin_recovery_codes')
        db.x('DELETE FROM student_sessions')
        db.x('UPDATE students SET token=lower(hex(randomblob(32)))')
        db.x('UPDATE teachers SET invite=lower(hex(randomblob(16)))')
        main = db.q('SELECT invite FROM teachers WHERE is_main=1', one=True)
        if main:
            db.setting('invite_code', main['invite'])
        # Disable legacy tokens and revoke the leaked shared course credential.
        db.setting('sessions_since', '1')
        db.setting('pyc_pw', hash_pw(secrets.token_urlsafe(32)))
        db.setting('access_revoked_at', str(time.time()))


def reset_main_password(db, password, *, recover_factor=False):
    """Explicit local operator recovery; normal password resets retain the factor."""
    encoded = hash_pw(password)
    with db.transaction():
        main = db.q('SELECT id FROM teachers WHERE is_main=1', one=True)
        db.setting('admin_password', encoded)
        db.x('UPDATE teachers SET pw=? WHERE is_main=1', (encoded,))
        if main:
            db.x('DELETE FROM admin_sessions WHERE teacher_id=? OR teacher_id IS NULL', (main['id'],))
            db.x('DELETE FROM admin_codes WHERE teacher_id=?', (main['id'],))
            db.x('DELETE FROM admin_recovery_codes WHERE teacher_id=?', (main['id'],))
            db.x("UPDATE pw_resets SET used=1 WHERE kind='t' AND uid=?", (main['id'],))
        if recover_factor:
            db.setting('main_login_code', '0')
        db.x('''INSERT INTO teacher_log(ts, teacher_id, event, ok, detail)
                VALUES(?,?,?,1,?)''', (time.time(), main['id'] if main else None,
                'reset', 'локальное восстановление: новый пароль, второй фактор сброшен явно'
                if recover_factor else 'пароль изменён локальным администратором'))


def recovery_code_hash(code):
    normalized = str(code or '').replace('-', '').replace(' ', '').lower()
    if len(normalized) != 32 or any(c not in '0123456789abcdef' for c in normalized):
        return None
    return hashlib.sha256(('principal-recovery:' + normalized).encode()).hexdigest()


def create_recovery_codes(db, account):
    """Show high-entropy codes once; retain only hashes bound to current credentials."""
    codes = []
    with db.transaction():
        db.x('DELETE FROM admin_recovery_codes WHERE teacher_id=?', (account['id'],))
        db.x('DELETE FROM admin_codes WHERE teacher_id=?', (account['id'],))
        for _ in range(10):
            raw = secrets.token_hex(16)
            code = '-'.join(raw[i:i + 8] for i in range(0, 32, 8))
            db.x('''INSERT INTO admin_recovery_codes(teacher_id, code_hash, account_state, created)
                    VALUES(?,?,?,?)''', (account['id'], recovery_code_hash(code), reset_fingerprint(account), time.time()))
            codes.append(code)
    return codes


def consume_recovery_code(db, account, code):
    digest = recovery_code_hash(code)
    if not digest:
        return False
    with db.transaction():
        changed = db.conn.execute('''UPDATE admin_recovery_codes SET used=? WHERE teacher_id=?
            AND code_hash=? AND account_state=? AND used IS NULL''',
            (time.time(), account['id'], digest, reset_fingerprint(account))).rowcount
        return changed == 1


def recovery_codes_left(db, account):
    return db.q('''SELECT COUNT(*) n FROM admin_recovery_codes
        WHERE teacher_id=? AND account_state=? AND used IS NULL''',
        (account['id'], reset_fingerprint(account)), one=True)['n']
