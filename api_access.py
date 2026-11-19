"""Explicit access policy for the HTTP API; importing this module starts nothing.

Every ordinary API request passes ``authorize`` inside Handler.api's existing
transaction boundary. There is deliberately no prefix/default allow rule: a new
route must declare its policy here before its implementation is reachable.
The few non-JSON transports have exact registrations and keep their own live
session/participant checks. Recovery credentials, ownership, course passwords,
principal-only actions and business rules are still validated by their handlers.
"""
from enum import Enum
import json
from types import MappingProxyType


class Access(Enum):
    PUBLIC = 'public'
    CREDENTIAL = 'credential_exchange'
    STUDENT = 'student_session'
    TEACHER = 'admitted_teacher'
    ACCOUNT = 'admitted_account'
    PARENT = 'parent_capability'
    PARTICIPANT = 'lesson_participant'
    LESSON_TEACHER = 'lesson_teacher'


def _paths(text):
    return tuple('/api/' + name for name in text.split())


def _registry():
    routes = {}

    def add(access, methods, names):
        for path in _paths(names):
            for method in methods.split():
                key = (method, path)
                if key in routes:
                    raise ValueError('duplicate API access policy: ' + repr(key))
                routes[key] = access

    # These endpoints must work before login. A credential exchange is not an
    # authenticated session: its password/code/token checks live in that handler.
    add(Access.PUBLIC, 'GET POST', 'ping health net public/offer')
    add(Access.PUBLIC, 'GET', 'status course/coverage')
    add(Access.PUBLIC, 'POST', 'jserr funnel visit logout teacher/guest')
    add(Access.CREDENTIAL, 'POST', '''
        login admin/login teacher/signup email/confirm pw/forgot pw/reset
    ''')

    # Keep legacy GET/POST aliases. Individual handlers retain their stricter
    # method checks (including the task actions' existing 405 responses).
    add(Access.STUDENT, 'GET POST', '''
        account activity arduino/progress arduino/unlock
        asg/answer asg/away asg/finish asg/review asg/start asg/state assignments
        check consent course/lesson course/seen course/sets course/unlock
        daily daily/start dev/unlock
        duel/cancel duel/create duel/find duel/finish duel/rematch duel/respond
        duel/start duel/surrender duels email/resend
        exam/finish exam/save exam/start exam/view exams find forbes freeze/buy
        gifts gifts/bid gifts/buy gifts/list gifts/mbuy gifts/price gifts/seen
        gifts/sell gifts/unlist gifts/upgrade hint history
        im im/check im/task im/trial im/trial/finish im/trial/save im/trial/start im/unlock
        lab lab/bugs lab/bugs/check lab/bugs/explain lab/bugs/verify lab/unlock
        leaderboard learning/mistake learning/mistakes
        mcko mcko/file mcko/finish mcko/run mcko/save mcko/start
        me open password profile profile/badges profile/look progress
        pyc pyc/check pyc/help pyc/level pyc/unlock reveal sessions sessions/end
        solution support support/img support/reply support/seen
        together/history together/mine
        tour tour/finish tour/join tour/leave tour/start tour/surrender tour/vote
    ''')
    add(Access.TEACHER, 'GET POST', '''
        admin/access admin/arduino admin/arduino/student admin/as-student
        admin/asg/all admin/asg/archive admin/asg/close admin/asg/live admin/asg/tasks
        admin/assignment/delete admin/assignment/save admin/assignments admin/authored
        admin/bank admin/bank-audit admin/bank/catalog admin/bank/find admin/bank/fix
        admin/bank/pick admin/bank/search admin/batch/delete admin/batch/due admin/batch/kind
        admin/class/delete admin/class/digest admin/class/goal admin/class/import
        admin/class/journal admin/class/members admin/class/parents admin/class/save
        admin/class/stats admin/class/weak admin/classes admin/competitions admin/consent
        admin/course admin/course/list admin/course/progress admin/duel/cancel admin/econ
        admin/email/change admin/email/resend admin/exam admin/export.csv admin/feed
        admin/gifts admin/gifts/box admin/gifts/give admin/gifts/remove admin/gifts/student
        admin/hints admin/im admin/im/bank admin/info admin/invite admin/jserr
        admin/lab/password admin/logout admin/logout-here
        admin/mcko/bank admin/mcko/file admin/mcko/off admin/mcko/results admin/mcko/results.csv
        admin/mcko/task admin/mcko/task/delete admin/mcko/work admin/mcko/work/delete
        admin/mcko/work/status admin/mcko/works admin/me admin/offer admin/password admin/promo
        admin/pyc admin/pyc/free admin/pyc/password admin/pyc/student admin/renew
        admin/report admin/report/preview admin/security admin/security/end admin/security/recovery
        admin/site-stats admin/solution admin/sounds admin/status admin/steps-off admin/student
        admin/student/delete admin/student/fire admin/student/logout admin/student/newpw
        admin/student/norank admin/student/parent admin/student/password-reset admin/student/rename
        admin/student/role admin/student/teacher admin/student/void admin/student/void-undo
        admin/students admin/supply admin/support/answer admin/support/delete admin/support/img admin/support/reward
        admin/task admin/task-solution admin/teacher/delete admin/teacher/extend
        admin/teacher/moderate admin/teacher/save admin/teachers admin/thermo
        admin/together/delete admin/together/end admin/together/invite admin/together/list
        admin/together/new admin/together/students admin/together/tasks
        admin/tour/match admin/tour/restart admin/ui admin/visitors
    ''')
    add(Access.ACCOUNT, 'GET POST', 'readiness')
    add(Access.PARENT, 'GET POST', 'parent')
    add(Access.PARTICIPANT, 'GET POST', 'together/file')
    add(Access.LESSON_TEACHER, 'POST', 'together/file/delete')
    add(Access.STUDENT, 'GET', 'live')
    add(Access.TEACHER, 'GET', 'admin/live')
    add(Access.STUDENT, 'GET', 'html')
    add(Access.PARTICIPANT, 'GET', 'together/ws')
    add(Access.LESSON_TEACHER, 'POST', 'together/upload')
    return MappingProxyType(routes)


ROUTES = _registry()
PATHS = frozenset(path for method, path in ROUTES)

# A new early transport cannot be enabled by a broad /api/foo prefix. These
# handlers have protocol-specific authentication (including periodic rechecks
# for live connections); ordinary routes can never take this branch.
TRANSPORTS = MappingProxyType({
    ('GET', '/api/live'): lambda h, path, qs: h.live(),
    ('GET', '/api/admin/live'): lambda h, path, qs: h.live_admin(),
    ('GET', '/api/html'): lambda h, path, qs: h.serve_task_html(qs),
    ('GET', '/api/together/ws'): lambda h, path, qs: h.together_ws(qs),
    ('POST', '/api/together/upload'): lambda h, path, qs: h.do_POST_upload(path, qs),
})


def dispatch_http(handler, method, path, qs):
    """The sole API entry from do_GET/do_POST, before any route implementation."""
    transport = TRANSPORTS.get((method, path))
    if transport is not None and (method, path) in ROUTES:
        return transport(handler, path, qs)
    data = {}
    if method == 'POST':
        try:
            body = handler.body_json()
        except (ValueError, json.JSONDecodeError):
            return handler.err(400, 'неверный запрос')
        data = body if isinstance(body, dict) else {}
    return handler.api(method, path, qs, data)


def authorize(handler, method, path, qs, data, *, db, throttle):
    """Run inside the account/economy transaction, before api_route can write.

    The teacher guard intentionally runs even for unregistered admin paths:
    missing sessions remain 401, onboarding 403 and expired writes 402. A ready
    teacher still cannot invoke an unregistered implementation. Resource gates
    preserve their non-disclosing 403/404 responses.
    """
    teacher_route = (path.startswith('/api/admin/')
                     and (method, path) != ('POST', '/api/admin/login'))
    if teacher_route and not handler.guard_teacher_route(method, path):
        return False
    policy = ROUTES.get((method, path))
    if policy is None or (method, path) in TRANSPORTS:
        handler.err(405 if policy is None and path in PATHS else 404, 'нет такого метода')
        return False
    if policy == Access.TEACHER:
        return teacher_route or handler.guard_teacher_route(method, path)
    if policy in (Access.PUBLIC, Access.CREDENTIAL):
        return True
    if policy == Access.STUDENT:
        if handler.student(data):
            return True
        handler.err(401, 'нужно войти')
        return False
    if policy == Access.ACCOUNT:
        return bool(handler.download_account())
    if policy == Access.PARENT:
        # A parent link conveys access to exactly one pupil; a pupil/teacher
        # session alone never substitutes for this separate capability.
        ip = handler.client_ip()
        wait = throttle.blocked('find', ip)
        if wait:
            handler.err(429, handler.wait_msg(wait))
            return False
        token = str(qs.get('t') or '')
        pupil = db.q('SELECT id FROM students WHERE parent_token=? AND COALESCE(is_teacher,0)=0',
                     (token,), one=True) if len(token) >= 16 else None
        if pupil:
            return True
        throttle.fail('find', ip)
        handler.err(404, 'Ссылка устарела — попросите у учителя новую')
        return False
    if policy in (Access.PARTICIPANT, Access.LESSON_TEACHER):
        teacher = policy == Access.LESSON_TEACHER
        source = data if teacher else qs
        try:
            sid = int(source.get('s') or 0)
        except (TypeError, ValueError, OverflowError):
            sid = 0
        if sid and handler.together_who(sid, teacher or qs.get('as') == 't'):
            return True
        handler.err(403, 'Удалять файлы может учитель этого занятия' if teacher else 'Этот файл вам недоступен')
        return False
    # Even a malformed/new policy cannot silently become a public endpoint.
    handler.err(403, 'доступ закрыт')
    return False
