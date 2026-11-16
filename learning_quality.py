"""Learning evidence and self-reflection. No pupil code is executed by this module."""
import time

REASONS = {
    'condition': 'Не так прочитал условие',
    'logic': 'Ошибка в способе решения',
    'implementation': 'Ошибка в программе',
    'attention': 'Счёт, перенос или невнимательность',
}
PROVENANCE = {
    'independent': 'Без подсказок на сайте',
    'hinted': 'С подсказкой',
    'together': 'На занятии «Вместе»',
    'repeat': 'Повторное решение',
    'retry': 'Со второй попытки',
    'self_check': 'Самопроверка в браузере',
    'unanswered': 'Без ответа',
}


def migrate(conn):
    conn.execute('CREATE INDEX IF NOT EXISTS attempts_learning_task ON attempts(student_id, task_id, id)')
    conn.execute('''CREATE TABLE IF NOT EXISTS learning_mistakes(
        student_id INTEGER NOT NULL, attempt_id INTEGER NOT NULL, reason TEXT NOT NULL,
        ts REAL NOT NULL, PRIMARY KEY(student_id, attempt_id))''')
    # Historical browser output comparisons were never independent code judging.
    # Once an independent judge is installed, preserve its server-verified awards.
    columns={row[1] for row in conn.execute('PRAGMA table_info(buglab)')}
    if 'verified' in columns:
        conn.execute('UPDATE buglab SET star=0 WHERE star<>0 AND COALESCE(verified,0)=0')
    else:
        conn.execute('UPDATE buglab SET star=0 WHERE star<>0')


def provenance(row, repeated=False):
    """Describes recorded assistance; it cannot certify absence of outside help."""
    r = dict(row)
    if r.get('reason') == 'tog':
        return 'together'
    if 'hint' in (r.get('flags') or '').split(','):
        return 'hinted'
    if repeated:
        return 'repeat'
    if r.get('score') == .5:
        return 'retry'
    if r.get('gave_up') or r.get('abandoned') or r.get('answers') in (None, '', '[]'):
        return 'unanswered'
    return 'independent'


def save_mistake(db, sid, task_id, reason):
    if not isinstance(reason, str) or reason not in REASONS:
        raise ValueError('Выберите причину ошибки из списка')
    row = db.q('''SELECT id, n FROM attempts WHERE student_id=? AND task_id=?
                  AND score<1 AND ts>=? ORDER BY ts DESC, id DESC LIMIT 1''',
               (sid, task_id, time.time() - 7 * 86400), one=True)
    if not row:
        raise LookupError('Недавняя попытка с ошибкой не найдена')
    db.x('''INSERT INTO learning_mistakes(student_id, attempt_id, reason, ts) VALUES(?,?,?,?)
            ON CONFLICT(student_id, attempt_id) DO UPDATE SET reason=excluded.reason, ts=excluded.ts''',
         (sid, row['id'], reason, time.time()))
    return {'reason': reason, 'label': REASONS[reason], 'n': row['n']}


def mistake_summary(db, sid):
    rows = db.q('''SELECT reason, SUM(c) AS count, COUNT(*) AS topics, SUM(c>1) AS repeated_topics
                   FROM (SELECT m.reason, a.n, COUNT(*) AS c FROM learning_mistakes m
                         JOIN attempts a ON a.id=m.attempt_id AND a.student_id=m.student_id
                         WHERE m.student_id=? AND a.ts>=? GROUP BY m.reason, a.n)
                   GROUP BY reason''', (sid, time.time() - 30 * 86400))
    return [{'reason': r['reason'], 'label': REASONS.get(r['reason'], ''),
             'count': r['count'], 'topics': r['topics'], 'repeated_topics': r['repeated_topics']} for r in rows]


def followup_metrics(db, sid, tasks, *, now=None):
    """Next *new* independent task of the same number and classified type.

    A correct answer is a proxy for retention, not proof of the original cause
    disappearing. Unknown/misc types stay unmeasured rather than being pooled.
    """
    now=time.time() if now is None else now
    since=now-30*86400
    notes={r['attempt_id']:r['reason'] for r in db.q('''SELECT m.attempt_id,m.reason FROM learning_mistakes m
        JOIN attempts a ON a.id=m.attempt_id AND a.student_id=m.student_id
        WHERE m.student_id=? AND a.ts>=? AND a.ts<=?''',(sid,since,now))}
    rows=db.q('''SELECT a.*, EXISTS(SELECT 1 FROM attempts p WHERE p.student_id=a.student_id
        AND p.task_id=a.task_id AND p.id<a.id) AS repeated FROM attempts a
        WHERE a.student_id=? AND a.ts>=? AND a.ts<=? ORDER BY a.ts DESC,a.id DESC''',(sid,since,now))
    counts={reason:{'reason':reason,'label':label,'evaluated':0,'recovered':0,'failed':0,'pending':0,'unmatched':0}
            for reason,label in REASONS.items()}
    upcoming={}
    for raw in rows:
        row=dict(raw)
        task=tasks.get(row['task_id']) or {}
        cluster=task.get('c') or task.get('topic')
        key=(row['n'],cluster) if cluster and cluster!='misc' else None
        reason=notes.get(row['id'])
        if reason in counts:
            out=counts[reason]
            if key is None: out['unmatched']+=1
            elif key not in upcoming: out['pending']+=1
            else:
                out['evaluated']+=1
                out['recovered' if upcoming[key] else 'failed']+=1
        eligible=(key is not None and not row['repeated'] and row['reason']!='tog'
                  and 'hint' not in (row['flags'] or '').split(',') and not row['gave_up']
                  and not row['abandoned'] and row['answers'] not in (None,'','[]'))
        if eligible: upcoming[key]=row['score']==1
    items=[]
    for row in counts.values():
        if sum(row[k] for k in ('evaluated','pending','unmatched')):
            row['recovery_rate']=round(row['recovered']/row['evaluated'],4) if row['evaluated'] else None
            items.append(row)
    evaluated=sum(r['evaluated'] for r in items)
    recovered=sum(r['recovered'] for r in items)
    return {'days':30,'evaluated':evaluated,'recovered':recovered,
            'recovery_rate':round(recovered/evaluated,4) if evaluated else None,'items':items,
            'method':'Следующее новое задание того же номера и типа, без подсказки и «Вместе»; успех — с первой попытки.',
            'limitation':'Правильный ответ не доказывает исчезновение конкретной причины. Нет подходящей попытки — нет оценки.'}
