"""Teacher authentication and the common teacher API access boundary.

No server import, global application or database initialization. The HTTP server
supplies current services for each call. Existing account transactions remain in
Handler.api(); OTP consumption owns its transaction because denied attempts must
commit. SMTP and response delays remain outside database locks.
"""
from dataclasses import dataclass
from http import cookies
from typing import Any, Callable, AbstractSet
import hashlib
import hmac
import html as html_mod
import math
import secrets
import time

from auth import (hash_pw, check_pw, reset_fingerprint, create_recovery_codes,
                  consume_recovery_code, recovery_codes_left)


TEACHER_AUTH_PATHS = frozenset({
    '/api/admin/password', '/api/admin/security',
    '/api/admin/security/end', '/api/admin/security/recovery',
})


@dataclass(frozen=True)
class TeacherAuthServices:
    """Explicit dependencies; instantiated from current server state, not cached."""
    db: Any
    throttle: Any
    session_seconds: int
    code_seconds: int
    code_tries: int
    code_per_window: int
    code_retry_seconds: int
    code_hash: Callable
    mask_email: Callable
    device_label: Callable
    session_mark: Callable
    main_teacher: Callable
    code_required: Callable
    code_ready: Callable
    send_mail: Callable
    teacher_code_required: Callable
    security_summary: Callable
    parse_int: Callable
    teacher_ready: Callable
    teacher_email_pending: Callable
    teacher_onboarding: Callable
    teacher_access: Callable
    gate_routes: AbstractSet
    readonly_routes: AbstractSet


class TeacherAuthHandlers:
    """Mixin for an HTTP handler exposing send_json, err, cookie and client_ip."""

    def teacher_auth_services(self):
        raise NotImplementedError

    def admin_login(self, tid, seconds, event="login", *, factor=False):
        """Новая сессия учителя: строка Set-Cookie. Вход попадает в журнал безопасности с адресом и устройством."""
        services = self.teacher_auth_services()
        tok = secrets.token_urlsafe(32)
        now, ip, ua = time.time(), self.client_ip(), (self.headers.get("User-Agent") or "")[:300]
        services.db.x("INSERT INTO admin_sessions(token,expires,teacher_id,created,ip,ua,last_seen,last_ip) VALUES(?,?,?,?,?,?,?,?)",
                 (tok, now + seconds, tid, now, ip, ua, now, ip))
        services.db.x("DELETE FROM admin_sessions WHERE expires<?", (now,))
        if factor:
            services.db.x("UPDATE admin_sessions SET factor_ts=? WHERE token=?", (now, tok))
        self.tlog(event, tid, sess=services.session_mark(tok))
        return f"egeadm={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={int(seconds)}{self.cookie_attrs()}"

    def admin_login_send_code(self, t, ip, *, mail_available=True):
        """Пароль верный — второй шаг: код на почту учителя. Сессии ещё нет."""
        services = self.teacher_auth_services()
        db, now = services.db, time.time()
        ticket, code = secrets.token_urlsafe(24), f"{secrets.randbelow(10 ** 6):06d}"
        key, state = hashlib.sha256(ticket.encode()).hexdigest(), reset_fingerprint(t)
        with db.transaction():
            current = db.q("SELECT * FROM teachers WHERE id=?", (t["id"],), one=True)
            if not current or not hmac.compare_digest(state, reset_fingerprint(current)):
                return self.err(410, "Данные аккаунта изменились — войдите заново")
            # Keep consumed and failed rows for the whole sending quota window.
            db.x("DELETE FROM admin_codes WHERE created<? AND expires<?", (now - 900, now))
            recent = db.q("SELECT COUNT(*) n, MAX(created) last FROM admin_codes WHERE teacher_id=? AND created>?",
                          (t["id"], now - 900), one=True)
            if recent["n"] >= services.code_per_window:
                return self.err(429, "Слишком много кодов подряд — подождите 15 минут и войдите снова")
            if recent["last"] and now - recent["last"] < services.code_retry_seconds:
                retry = max(1, math.ceil(services.code_retry_seconds - (now - recent["last"])))
                return self.send_json({"error": f"Повторить отправку можно через {retry} с", "retry_after": retry},
                                      429, {"Retry-After": str(retry)})
            # A retry replaces the earlier challenge, never adds another active code.
            db.x("UPDATE admin_codes SET delivery='invalid' WHERE teacher_id=? AND delivery IN ('queued','accepted','failed','unavailable')", (t["id"],))
            db.x("""INSERT INTO admin_codes(ticket, teacher_id, code, expires, ip, created, account_state, delivery)
                    VALUES(?,?,?,?,?,?,?,'queued')""", (key, t["id"], services.code_hash(ticket, code), now + services.code_seconds, ip, now, state))
        device = services.device_label(self.headers.get("User-Agent") or "")
        when = time.strftime("%d.%m.%Y %H:%M", time.localtime(now))
        safe = html_mod.escape
        to, name = t["email"], t["name"]
        panel = "панель главного учителя" if t["is_main"] else "панель учителя"
        # SMTP is outside the database transaction. Do not report delivery before its result.
        try:
            accepted = mail_available and services.send_mail(to, f"Egeshka: код входа {code}",
                          f"<p>{safe(name)}, код для входа в {panel}:</p>"
                          f"<p style='font-size:28px;font-weight:700;letter-spacing:6px'>{code}</p>"
                          f"<p>Действует {services.code_seconds // 60} минут. Вход: {safe(when)}, адрес {safe(ip)}, {safe(device)}.</p>"
                          "<p style='color:#c53030'>Если это были не вы — кто-то знает ваш пароль: смените его в панели (Настройки) "
                          "и никому не сообщайте этот код.</p>",
                          f"{name}, код для входа в {panel}: {code}\n"
                          f"Действует {services.code_seconds // 60} минут. Вход: {when}, адрес {ip}, {device}.\n"
                          "Если это были не вы — кто-то знает ваш пароль: смените его и никому не сообщайте этот код.") is True
        except Exception:
            accepted = False
        with db.transaction():
            current = db.q("SELECT * FROM teachers WHERE id=?", (t["id"],), one=True)
            row = db.q("SELECT delivery FROM admin_codes WHERE ticket=?", (key,), one=True)
            if (not current or not hmac.compare_digest(state, reset_fingerprint(current))
                    or not row or row["delivery"] != "queued"):
                return self.err(410, "Вход отменён — войдите заново")
            db.x("UPDATE admin_codes SET delivery=?, delivered=? WHERE ticket=?",
                 ("accepted" if accepted else "failed" if mail_available else "unavailable", time.time() if accepted else None, key))
            self.tlog("code", t["id"], ok=accepted,
                      detail="пароль верный, письмо с кодом принято SMTP" if accepted else "не удалось передать письмо с кодом SMTP")
            backups = recovery_codes_left(db, current)
        if not accepted and backups:
            return self.send_json({"need_code": True, "ticket": ticket, "minutes": services.code_seconds // 60,
                                   "delivery": "failed" if mail_available else "unavailable", "backup_only": True})
        if not accepted:
            return self.send_json({"error": "Не удалось отправить письмо с кодом. Повторите вход через минуту; если ошибка повторяется, обратитесь к администратору сервера.",
                                   "delivery": "failed", "retry_after": services.code_retry_seconds}, 503,
                                  {"Retry-After": str(services.code_retry_seconds)})
        return self.send_json({"need_code": True, "ticket": ticket, "to": services.mask_email(t["email"]), "minutes": services.code_seconds // 60,
                               "delivery": "accepted", "backup": bool(backups)})

    def admin_login_code(self, data, ip):
        """Второй шаг входа учителя: код из письма (у главного — или резервный код) → сессия."""
        services = self.teacher_auth_services()
        db, now = services.db, time.time()
        ticket = str(data.get("ticket") or "")
        key = hashlib.sha256(ticket.encode()).hexdigest()
        code = str(data.get("code") or "").strip()
        # The counter, one-use consumption and session creation commit together.
        # Error responses deliberately do not roll back an attempted code.
        with db.transaction():
            r = db.q("SELECT * FROM admin_codes WHERE ticket=?", (key,), one=True)
            t = db.q("SELECT * FROM teachers WHERE id=?", (r["teacher_id"],), one=True) if r else None
            if (not r or r["expires"] < now or r["tries"] >= services.code_tries or r["delivery"] not in ("accepted", "failed", "unavailable")
                    or not t or t["guest"] or not hmac.compare_digest(r["account_state"] or "", reset_fingerprint(t))):
                if r:
                    db.x("UPDATE admin_codes SET delivery='invalid' WHERE ticket=?", (key,))
                status, message, cookie = 410, "Код устарел — войдите заново, придёт новый", None
            elif not ((r["delivery"] == "accepted" and hmac.compare_digest(services.code_hash(ticket, code), r["code"]))
                      or consume_recovery_code(db, t, code)):
                db.x("UPDATE admin_codes SET tries=tries+1 WHERE ticket=?", (key,))
                self.tlog("login", r["teacher_id"], ok=False, detail="неверный код из письма")
                left = services.code_tries - r["tries"] - 1
                status, cookie = 403, None
                message = f"Неверный код — осталось попыток: {left}" if left > 0 else "Неверный код — войдите заново, придёт новый"
            else:
                db.x("UPDATE admin_codes SET delivery='used' WHERE ticket=?", (key,))
                cookie = self.admin_login(r["teacher_id"], services.session_seconds, factor=True)
                status, message = 200, None
        if status != 200:
            if status == 403:
                services.throttle.fail("admin", ip)
                time.sleep(1.0)
            return self.err(status, message)
        services.throttle.ok("admin", ip)
        return self.send_json({"ok": True}, extra={"Set-Cookie": cookie})

    def tlog(self, event, tid=None, *, ok=True, login=None, path=None, detail=None, sess=None):
        """Строка журнала безопасности учителей: что, кто, когда, с какого адреса и устройства."""
        services = self.teacher_auth_services()
        if sess is None:
            sess = services.session_mark(self.cookie("egeadm") or "") if self.cookie("egeadm") else None
        row = (time.time(), tid, event, int(bool(ok)), self.client_ip(), (self.headers.get("User-Agent") or "")[:300],
               (login or "")[:120] or None, path, (detail or "")[:300] or None, sess)
        pending = getattr(self, "_audit_failures", None)
        if not ok and pending is not None:
            pending.append(row)
            return
        services.db.x("""INSERT INTO teacher_log(ts, teacher_id, event, ok, ip, ua, login, path, detail, sess)
                    VALUES(?,?,?,?,?,?,?,?,?,?)""", row)

    def flush_failed_audit(self):
        pending = getattr(self, "_audit_failures", None)
        if pending:
            services = self.teacher_auth_services()
            with services.db.transaction():
                for row in pending:
                    services.db.x("""INSERT INTO teacher_log(ts, teacher_id, event, ok, ip, ua, login, path, detail, sess)
                                VALUES(?,?,?,?,?,?,?,?,?,?)""", row)
            pending.clear()

    def is_admin(self):
        """Вошёл ли учитель; запоминает его в self.T (сессии без учителя — от прежних версий — главного)."""
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        if "egeadm" not in c:
            return False
        services = self.teacher_auth_services()
        r = services.db.q("SELECT expires, teacher_id, last_seen, last_ip FROM admin_sessions WHERE token=?", (c["egeadm"].value,), one=True)
        if not (r and r["expires"] > time.time()):
            return False
        ip = self.client_ip() if getattr(self, "client_address", None) else None
        if ip and (ip != r["last_ip"] or time.time() - (r["last_seen"] or 0) > 120):   # последняя активность сессии и её адрес
            services.db.x("UPDATE admin_sessions SET last_seen=?, last_ip=? WHERE token=?", (time.time(), ip, c["egeadm"].value))
        t = services.db.q("SELECT * FROM teachers WHERE id=?", (r["teacher_id"],), one=True) if r["teacher_id"] else services.main_teacher()
        if not t:
            return False
        self.T = t
        return True

    def handle_teacher_login(self, data):
        services = self.teacher_auth_services()
        db = services.db
        ip = self.client_ip()
        wait = services.throttle.blocked("admin", ip)
        if wait:
            return self.err(429, self.wait_msg(wait))
        if data.get("ticket"):
            return self.admin_login_code(data, ip)
        login = str(data.get("login") or "").strip().lower()
        t = (db.q("SELECT * FROM teachers WHERE (lower(login)=? OR lower(email)=?) AND COALESCE(guest, 0)=0", (login, login), one=True)
             if login else db.q("SELECT * FROM teachers WHERE is_main=1", one=True))
        if t and check_pw(str(data.get("password") or ""), t["pw"]):
            services.throttle.ok("admin", ip)
            if t["is_main"] and services.code_required(t):
                if not services.code_ready(t):
                    if recovery_codes_left(db, t):
                        return self.admin_login_send_code(t, ip, mail_available=False)
                    self.tlog("login", t["id"], ok=False, detail="обязательный второй фактор недоступен: нет настройки почты")
                    return self.err(503, "Вход требует кода из письма, но отправка сейчас недоступна. Обратитесь к администратору сервера для восстановления почты или доступа.")
                return self.admin_login_send_code(t, ip)
            if services.teacher_code_required(t):
                return self.admin_login_send_code(t, ip)
            if t["is_main"]:
                self.tlog("login", t["id"], detail="второй фактор ещё не подключён или явно отключён администратором")
            with db.transaction():
                current = db.q("SELECT * FROM teachers WHERE id=?", (t["id"],), one=True)
                if not current or not hmac.compare_digest(reset_fingerprint(t), reset_fingerprint(current)):
                    return self.err(410, "Данные аккаунта изменились — войдите заново")
                # Enrollment may have made the second factor mandatory while
                # this request was between its policy check and session creation.
                if (current["is_main"] and services.code_required(current)) or services.teacher_code_required(current):
                    return self.err(409, "Требования ко входу изменились — войдите заново")
                cookie = self.admin_login(t["id"], services.session_seconds)
            return self.send_json({"ok": True}, extra={"Set-Cookie": cookie})
        services.throttle.fail("admin", ip)
        self.tlog("login", t["id"] if t else None, ok=False, login=login or "(главный)",
                  detail="неверный пароль" if t else "нет такого учителя")
        time.sleep(1.0)
        return self.err(403, "Неверный логин или пароль")

    def guard_teacher_route(self, method, path):
        """Return True only after session, onboarding and write-access checks."""
        if not self.is_admin():
            self.err(401, "нужен вход учителя")
            return False
        services = self.teacher_auth_services()
        onboarding_route = (method, path) in services.gate_routes
        if not services.teacher_ready(self.T) and not onboarding_route:
            self.send_json({"error": "Для доступа нужны подтверждение почты и одобрение главным учителем",
                            "need_onboarding": True, "need_email": services.teacher_email_pending(self.T),
                            "onboarding": services.teacher_onboarding(self.T)}, 403)
            return False
        if (method == "POST" and path not in services.readonly_routes and not onboarding_route
                and services.teacher_access(self.T)["expired"]):
            self.send_json({"error": "Гостевой час закончился — зарегистрируйтесь, чтобы продолжить" if self.T["guest"]
                            else "Доступ закончился — панель открыта только для чтения. Продлите доступ",
                            "expired": True}, 402)
            return False
        return True

    def handle_teacher_auth(self, method, path, qs, data):
        """Called after guard_teacher_route and the account transaction wrapper."""
        if path == '/api/admin/password' and method == 'POST':
            return self.change_teacher_password(data)
        if path in ('/api/admin/security', '/api/admin/security/end', '/api/admin/security/recovery'):
            return self.teacher_security_route(method, path, qs, data)
        return self.err(404, "нет такого метода")

    def change_teacher_password(self, data):
        services = self.teacher_auth_services()
        db = services.db
        ip = self.client_ip()
        wait = services.throttle.blocked("admin", ip)
        if wait:
            return self.err(429, self.wait_msg(wait))
        if not check_pw(str(data.get("old") or ""), self.T["pw"]):
            services.throttle.fail("admin", ip)
            self._account_delay = 1.0
            self.tlog("password", self.T["id"], ok=False, detail="неверный текущий пароль при смене")
            return self.err(403, "Текущий пароль неверный")
        new = str(data.get("new") or "")
        if len(new) < 6:
            return self.err(400, "Новый пароль — не короче 6 символов")
        db.x("UPDATE teachers SET pw=? WHERE id=?", (hash_pw(new), self.T["id"]))
        db.x("DELETE FROM admin_codes WHERE teacher_id=?", (self.T["id"],))
        db.x("DELETE FROM admin_recovery_codes WHERE teacher_id=?", (self.T["id"],))
        self.tlog("password", self.T["id"], detail="сменил пароль, остальные входы завершены")
        if self.T["is_main"]:
            db.setting("admin_password", hash_pw(new))
        # остальные сессии этого учителя (например, на забытом компьютере) больше не действуют
        cur_tok = self.cookie("egeadm") or ""
        db.x("DELETE FROM admin_sessions WHERE token<>? AND COALESCE(teacher_id, ?)=?",
             (cur_tok, services.main_teacher()["id"], self.T["id"]))
        return self.send_json({"ok": True})

    def teacher_security_route(self, method, path, qs, data):
        services = self.teacher_auth_services()
        db = services.db
        # входы учителей и журнал их действий с адресами — только главному учителю
        if not self.T["is_main"]:
            return self.err(403, "Входы учителей видит главный учитель")
        if path == "/api/admin/security/recovery" and method == "POST":
            ip = self.client_ip()
            wait = services.throttle.blocked("admin", ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
            if not check_pw(str(data.get("password") or ""), self.T["pw"]):
                services.throttle.fail("admin", ip)
                self._account_delay = 1.0
                self.tlog("recovery_codes", self.T["id"], ok=False, detail="неверный пароль при создании резервных кодов")
                return self.err(403, "Текущий пароль неверный")
            session = db.q("SELECT factor_ts FROM admin_sessions WHERE token=?", (self.cookie("egeadm"),), one=True)
            if services.code_required(self.T) and (not session or not session["factor_ts"] or time.time() - session["factor_ts"] > 600):
                self.tlog("recovery_codes", self.T["id"], ok=False, detail="нужен свежий вход со вторым фактором")
                return self.err(403, "Для новых резервных кодов войдите заново с кодом из письма или прежним резервным кодом, затем повторите в течение 10 минут")
            codes = create_recovery_codes(db, self.T)
            db.setting("main_login_code", "1")
            self.tlog("recovery_codes", self.T["id"], detail="создан новый набор; прежние резервные коды отозваны")
            services.throttle.ok("admin", ip)
            return self.send_json({"codes": codes}, extra={"Cache-Control": "private, no-store"})
        if path == "/api/admin/security/end" and method == "POST":
            tid, mark = services.parse_int(data.get("teacher_id")), str(data.get("sess") or "")
            cur = services.session_mark(self.cookie("egeadm") or "")
            ended = 0
            if tid and not mark:
                db.x("DELETE FROM admin_codes WHERE teacher_id=?", (tid,))
                db.x("DELETE FROM admin_recovery_codes WHERE teacher_id=?", (tid,))
            for r in db.q("SELECT token, teacher_id FROM admin_sessions"):
                rt = r["teacher_id"] or services.main_teacher()["id"]
                m = services.session_mark(r["token"])
                if m == cur or not ((mark and m == mark) or (not mark and tid and rt == tid)):
                    continue
                db.x("DELETE FROM admin_sessions WHERE token=?", (r["token"],))
                db.x("DELETE FROM admin_codes WHERE teacher_id=?", (rt,))
                db.x("DELETE FROM admin_recovery_codes WHERE teacher_id=?", (rt,))
                self.tlog("end", rt, detail=f"завершил: {self.T['name']}", sess=m)
                ended += 1
            return self.send_json({"ok": True, "ended": ended})
        return self.send_json(services.security_summary(db, services.parse_int(qs.get("teacher_id")), cur=services.session_mark(self.cookie("egeadm") or "")))
