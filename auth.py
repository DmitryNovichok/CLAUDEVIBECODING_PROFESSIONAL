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
