"""Private, read-only SQLite comparisons for the migration rehearsal.

Fingerprints stay inside the worker. Reports contain table names and counts,
never row values, primary keys, hashes of individual records or learner code.
This detects changed stored values; it does not certify their educational sense.
"""
import hashlib
import json


PROTECTED_TABLES = (
    'students', 'teachers', 'classes', 'assignments', 'attempts', 'exams',
    'asg_runs', 'asg_events', 'solutions', 'solution_history', 'pyc_progress',
    'buglab', 'support', 'support_msgs', 'together', 'coins', 'xp_adjust',
    'awards', 'gifts', 'bank', 'gift_log',
    'mcko_works', 'mcko_runs', 'im_trials', 'im_attempts',
    'arduino_progress', 'course_seen',
)


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def table_columns(connection):
    present = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    return {table: [row[1] for row in connection.execute('PRAGMA table_info(' + quoted(table) + ')')]
            for table in PROTECTED_TABLES if table in present}


def stored_values(connection, projection=None):
    """Stream a deterministic digest, optionally using only pre-upgrade columns.

    Include identities in every row and sort by all projected columns. Swapping
    two learners' equal-count results changes the digest; mere physical row order
    does not. Added columns are compared on the second startup, not against a
    legacy schema that never contained them.
    """
    columns = table_columns(connection)
    projection = columns if projection is None else projection
    result = {}
    for table, names in projection.items():
        if table not in columns or any(name not in columns[table] for name in names):
            result[table] = None
            continue
        fields = ','.join(quoted(name) for name in names)
        fingerprint, count = hashlib.sha256(), 0
        for row in connection.execute('SELECT ' + fields + ' FROM ' + quoted(table) + ' ORDER BY ' + fields):
            # SQLite only yields None, integer, float, text or bytes here.
            values = [['blob', value.hex()] if isinstance(value, bytes) else [type(value).__name__, value]
                      for value in row]
            fingerprint.update(json.dumps(values, ensure_ascii=True, separators=(',', ':')).encode() + b'\n')
            count += 1
        result[table] = {'columns': names, 'rows': count, 'fingerprint': fingerprint.digest()}
    return result


def changed_values(before, after):
    """Sanitized differences only; do not serialize the private snapshots."""
    return {table: {'before': snapshot['rows'], 'after': after[table]['rows'] if after.get(table) else None,
                    'compared_columns': len(snapshot['columns'])}
            for table, snapshot in before.items() if snapshot != after.get(table)}


def relationship_violations(connection):
    """Count broken links that matter to ownership, results and reward history.

    A pupil may move class after completing work, so historical result ownership
    is deliberately not inferred from their current class membership.
    """
    columns = table_columns(connection)
    links = (
        ('students', 'class_id', 'classes'), ('students', 'teacher_id', 'teachers'),
        ('classes', 'teacher_id', 'teachers'), ('assignments', 'class_id', 'classes'),
        ('assignments', 'student_id', 'students'), ('attempts', 'student_id', 'students'),
        ('exams', 'student_id', 'students'), ('asg_runs', 'asg_id', 'assignments'),
        ('asg_runs', 'student_id', 'students'), ('asg_events', 'asg_id', 'assignments'),
        ('asg_events', 'student_id', 'students'), ('solutions', 'student_id', 'students'),
        ('solution_history', 'student_id', 'students'), ('pyc_progress', 'student_id', 'students'),
        ('buglab', 'student_id', 'students'), ('support', 'student_id', 'students'),
        ('support_msgs', 'support_id', 'support'), ('together', 'teacher_id', 'teachers'),
        ('coins', 'student_id', 'students'), ('xp_adjust', 'student_id', 'students'),
        ('awards', 'student_id', 'students'), ('gifts', 'student_id', 'students'),
        ('mcko_works', 'teacher_id', 'teachers'), ('mcko_works', 'class_id', 'classes'),
        ('mcko_runs', 'work_id', 'mcko_works'), ('mcko_runs', 'student_id', 'students'),
        ('im_trials', 'student_id', 'students'), ('im_attempts', 'student_id', 'students'),
        ('im_attempts', 'trial_id', 'im_trials'), ('arduino_progress', 'student_id', 'students'),
        ('course_seen', 'student_id', 'students'),
    )
    result = {}
    for table, field, target in links:
        if field not in columns.get(table, []) or 'id' not in columns.get(target, []):
            continue
        sql = ('SELECT COUNT(*) FROM ' + quoted(table) + ' AS child WHERE child.' + quoted(field)
               + ' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ' + quoted(target)
               + ' AS parent WHERE parent.id=child.' + quoted(field) + ')')
        count = connection.execute(sql).fetchone()[0]
        if count:
            result[table + '.' + field] = count
    if (set(('class_id', 'teacher_id')) <= set(columns.get('students', []))
            and 'teacher_id' in columns.get('classes', [])
            and set(('id', 'is_main')) <= set(columns.get('teachers', []))):
        principals = connection.execute('SELECT id FROM teachers WHERE is_main=1').fetchall()
        if len(principals) == 1:
            count = connection.execute('''SELECT COUNT(*) FROM students s JOIN classes c ON c.id=s.class_id
                WHERE COALESCE(s.teacher_id, ?) <> COALESCE(c.teacher_id, ?)''',
                (principals[0][0], principals[0][0])).fetchone()[0]
            if count:
                result['students.class_teacher_mismatch'] = count
    return result
