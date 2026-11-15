"""Access to paid learning sections; secrets belong only in the runtime database."""
from auth import hash_pw

PASSWORD_KEYS = ('course_pw', 'pyc_pw', 'lab_pw')


def set_learning_passwords(conn, password):
    """Change three passwords atomically without touching sessions or earned access."""
    if not isinstance(password, str) or not 8 <= len(password) <= 200 or password != password.strip():
        raise ValueError('Пароль: 8–200 символов, без пробелов по краям')
    values = [(key, hash_pw(password)) for key in PASSWORD_KEYS]
    with conn:
        conn.executemany('INSERT INTO settings(key,value) VALUES(?,?) '
                         'ON CONFLICT(key) DO UPDATE SET value=excluded.value', values)


def lab_access(db, student):
    return bool(student and (student['is_teacher'] or
                (student['lab'] and db.setting('lab_pw'))))


def ard_access(db, student):
    """Лаборатория Arduino — отдельный раздел со своим паролем (не пароль лабораторий)."""
    return bool(student and (student['is_teacher'] or
                (student['ard'] and db.setting('ard_pw'))))


def im_access(db, student):
    """«Интеллектуальный мегаполис» — отдельный раздел со своим паролем."""
    return bool(student and (student['is_teacher'] or
                (student['im'] and db.setting('im_pw'))))
