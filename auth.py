"""Пароли и отзыв доступа; без зависимости от HTTP-сервера."""
import hashlib
import hmac
import secrets
import time

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
