"""Student sign-in, account/session maintenance and shared email recovery HTTP.

No server import or application initialization. Current services are injected per
request. Handler.api retains transaction/cookie/delayed-denial boundaries, while
shared password recovery keeps the teacher session and second-factor revocations.
Confirmation and recovery SMTP stay asynchronous; no network operation is waited
for while the request holds the account transaction.
"""
from dataclasses import dataclass
from typing import Any, Callable
import hashlib
import hmac
import html as html_mod
import re
import secrets
import threading
import time

from auth import hash_pw, check_pw, reset_fingerprint, recovery_origin


STUDENT_AUTH_ROUTES = {
    ('POST', '/api/login'): 'student_login',
    ('POST', '/api/account'): 'student_account',
    ('POST', '/api/email/resend'): 'student_email_resend',
    ('POST', '/api/email/confirm'): 'account_email_confirm',
    ('POST', '/api/pw/forgot'): 'account_password_forgot',
    ('POST', '/api/pw/reset'): 'account_password_reset',
    ('POST', '/api/consent'): 'student_consent',
    ('POST', '/api/password'): 'student_password',
    ('GET', '/api/me'): 'student_me',
    ('POST', '/api/me'): 'student_me',
    ('POST', '/api/logout'): 'student_logout',
    ('GET', '/api/net'): 'student_network',
    ('POST', '/api/net'): 'student_network',
    ('GET', '/api/sessions'): 'student_sessions',
    ('POST', '/api/sessions'): 'student_sessions',
    ('GET', '/api/sessions/end'): 'student_sessions',
    ('POST', '/api/sessions/end'): 'student_sessions',
}
STUDENT_AUTH_PATHS = frozenset(path for _, path in STUDENT_AUTH_ROUTES)


@dataclass(frozen=True)
class StudentAuthServices:
    """Explicit live dependencies; never cached across requests."""
    db: Any
    throttle: Any
    student_login_re: Any
    name_re: Any
    email_re: Any
    norm_name: Callable
    teacher_ready: Callable
    make_login: Callable
    reg_allowed: Callable
    main_teacher: Callable
    legal_version: str
    send_confirm: Callable
    shared_ip: Callable
    session_new: Callable
    shared_cache: dict
    live_teacher: Callable
    mail_ready: Callable
    teacher_of: Callable
    confirm_state: Callable
    activate_teacher_trial: Callable
    site_url: str
    smtp_conf: Callable
    send_mail: Callable
    pw_reset_seconds: int
    sessions_end: Callable
    sessions_list: Callable
    parse_int: Callable


class StudentAuthHandlers:
    """Requires the handler's response, identity, cookie and audit primitives."""

    def student_auth_services(self):
        raise NotImplementedError

    def student_auth_route(self, method, path, data):
        target = STUDENT_AUTH_ROUTES.get((method, path))
        if target is None:
            return self.err(404, "нет такого метода")
        return getattr(self, target)(method, path, data)

    def student_login(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # Вход: ФИО или логин + пароль. Регистрация: ФИО, логин, пароль, почта (для восстановления пароля) и, если есть,
        # код приглашения учителя. Без кода ученик занимается сам, к учителю можно присоединиться позже по коду.
        ip = self.client_ip()
        for kind in ("invite", "login"):
            wait = services.throttle.blocked(kind, ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
        register = data.get("mode") == "register"
        now = time.time()
        who = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()
        if not register and services.student_login_re.fullmatch(who.lower()):
            key = "login:" + who.lower()
            matches = db.q("SELECT * FROM students WHERE lower(login)=? LIMIT 2", (who.lower(),))
            if len(matches) > 1:
                return self.err(409, "Этот логин указан у нескольких учеников. Войдите по фамилии и имени и обратитесь к учителю")
            s = matches[0] if matches else None
            pretty = s["name"] if s else who
        else:
            pretty, key = services.norm_name(who)
            if not services.name_re.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Введите фамилию и имя (можно с отчеством)" if register else "Введите логин или фамилию и имя")
            s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
        if s:
            if s["is_teacher"]:
                return self.err(403, "Откройте «Решать как ученик» из панели учителя")
            key = s["name_key"]
        wait = services.throttle.blocked("account", key)
        if wait:
            return self.err(429, self.wait_msg(wait))
        if s and s["pw"]:
            if register:
                return self.err(409, f"«{s['name']}» уже зарегистрирован(а). Войдите с паролем на вкладке «Вход».")
            if not check_pw(str(data.get("password") or ""), s["pw"]):
                services.throttle.fail("login", ip)
                services.throttle.fail("account", key)
                self._account_delay = 1.0
                return self.err(403, "Неверный логин или пароль. Забыли пароль — «Забыли пароль?» ниже или попросите учителя.")
            services.throttle.ok("account", key)
        else:
            code = re.sub(r"\s+", "", str(data.get("code") or ""))
            if not register and not code:
                if s:
                    return self.send_json({"error": "Пароль ещё не задан", "need": "set_password",
                                           "name": s["name"], "login": s["login"] or ""}, 409)
                return self.err(404, "Такого ученика нет. Если вы здесь впервые — откройте вкладку «Регистрация».")
            teacher = None
            if code:
                teacher = next((t for t in db.q("SELECT * FROM teachers")
                                if hmac.compare_digest(code.encode(), t["invite"].encode())), None)
                if teacher and teacher["guest"]:
                    # гостевой час учителя — демо: настоящие ученики по его коду не регистрируются
                    return self.err(403, "Это код демо-доступа учителя. Попросите у учителя код после его регистрации")
                if teacher and not services.teacher_ready(teacher):
                    return self.err(403, "Учитель ещё не прошёл проверку. Попробуйте после открытия его доступа")
                if not teacher:
                    services.throttle.fail("invite", ip)
                    self._account_delay = 1.0
                    return self.err(403, "Неверный код приглашения")
            pw = str(data.get("new_password") or data.get("password") or "")
            if len(pw) < 6:
                return self.err(400, "Пароль — не короче 6 символов")
            if not data.get("consent"):
                return self.err(400, "Чтобы зарегистрироваться, примите соглашение и дайте согласие на обработку персональных данных")
            login = str(data.get("login") or "").strip().lower()
            email = str(data.get("email") or "").strip().lower()[:120]
            if not s or not s["login"]:             # новый ученик или старый без логина
                login = login or services.make_login(db, pretty)
                if not services.student_login_re.fullmatch(login):
                    return self.err(400, "Логин — 3–32 латинские буквы, цифры, точка, дефис или подчёркивание")
                if db.q("SELECT 1 FROM students WHERE lower(login)=?", (login,), one=True):
                    return self.err(409, "Такой логин уже занят — придумайте другой")
            elif login and login != s["login"]:
                return self.err(409, "У этого аккаунта уже есть логин. Используйте его при восстановлении доступа")
            if email and not services.email_re.fullmatch(email):
                return self.err(400, "Проверьте адрес почты")
            if not s and not teacher and not email:
                return self.err(400, "Укажите почту — без кода учителя только по ней можно восстановить пароль")
            if not s:
                if not services.reg_allowed(ip):
                    return self.err(429, "С этого адреса за час зарегистрировалось слишком много учеников. Попробуйте позже.")
                services.reg_allowed(ip, add=True)
                tid = teacher["id"] if teacher else services.main_teacher()["id"]
                db.x("""INSERT INTO students(name,name_key,token,created,last_seen,pw,teacher_id,login,email,self_reg)
                        VALUES(?,?,?,?,?,?,?,?,?,?)""",
                     (pretty, key, secrets.token_urlsafe(24), now, now, hash_pw(pw), tid, login, email or None, 0 if teacher else 1))
                print(f"[ученик] новый: {pretty}{'' if teacher else ' (без кода)'}", flush=True)
            else:                                  # старый ученик без пароля: журнал сохраняется
                if not teacher:
                    return self.err(400, "Введите код приглашения учителя")
                if teacher["id"] != (s["teacher_id"] or services.main_teacher()["id"]):
                    return self.err(403, "Нужен код именно вашего учителя")
                db.x("UPDATE students SET pw=?, teacher_id=COALESCE(teacher_id, ?) WHERE id=?", (hash_pw(pw), teacher["id"], s["id"]))
                if email:
                    db.x("UPDATE students SET email=? WHERE id=?", (email, s["id"]))
                if not s["login"]:
                    db.x("UPDATE students SET login=? WHERE id=?", (login, s["id"]))
                print(f"[ученик] задал пароль: {s['name']}", flush=True)
            s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
            db.x("UPDATE students SET consent_ver=?, consent_ts=?, consent_ip=? WHERE id=?", (services.legal_version, now, ip, s["id"]))
            s = db.q("SELECT * FROM students WHERE id=?", (s["id"],), one=True)
            if email and not s["email_ok"]:
                services.send_confirm(db, "s", s)             # мягко: аккаунт работает сразу, на главной — напоминание
        db.x("UPDATE students SET last_seen=?, last_ip=? WHERE id=?", (now, ip, s["id"]))
        # вход — свой на этом устройстве; в школьной сети (и «Чужой компьютер») — временный
        shared = services.shared_ip(db, ip) or self.headers.get("X-Temp") == "1"
        self.tok = services.session_new(db, s["id"], ip, self.headers.get("User-Agent"), shared)
        self.sess = db.q("SELECT * FROM student_sessions WHERE token=?", (self.tok,), one=True)
        services.shared_cache.pop(ip, None)                      # новый ученик с этого адреса — школьную сеть проверим заново
        return self.send_json(self.me_payload(s), extra={"Set-Cookie": self.student_cookie(self.tok, temp=shared)})

    def student_account(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # ученик: почта для восстановления пароля, логин (если ещё нет) и переход к учителю по коду
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        confirm_new_email = False
        if "email" in data:
            email = str(data.get("email") or "").strip().lower()[:120]
            if email and not services.email_re.fullmatch(email):
                return self.err(400, "Проверьте адрес почты")
            if (email or None) != (s["email"] or None):       # новый адрес — подтверждается заново
                db.x("UPDATE students SET email=?, email_ok=0 WHERE id=?", (email or None, s["id"]))
                confirm_new_email = bool(email)
        if data.get("login") and not s["login"]:
            login = str(data.get("login")).strip().lower()
            if not services.student_login_re.fullmatch(login):
                return self.err(400, "Логин — 3–32 латинские буквы, цифры, точка, дефис или подчёркивание")
            if db.q("SELECT 1 FROM students WHERE lower(login)=?", (login,), one=True):
                return self.err(409, "Такой логин уже занят")
            db.x("UPDATE students SET login=? WHERE id=?", (login, s["id"]))
        if data.get("code"):
            ip = self.client_ip()
            wait = services.throttle.blocked("invite", ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
            if not s["self_reg"]:
                return self.err(403, "Учителя может сменить только ваш учитель")
            code = re.sub(r"\s+", "", str(data.get("code")))
            t = next((t for t in db.q("SELECT * FROM teachers")
                      if hmac.compare_digest(code.encode(), t["invite"].encode())), None)
            if not t or t["guest"]:
                services.throttle.fail("invite", ip)
                self._account_delay = 1.0
                return self.err(403, "Неверный код приглашения")
            if not services.teacher_ready(t):
                return self.err(403, "Учитель ещё не прошёл проверку. Попробуйте после открытия его доступа")
            db.x("UPDATE students SET teacher_id=?, class_id=NULL, self_reg=0 WHERE id=?", (t["id"], s["id"]))
            services.live_teacher(db.q("SELECT * FROM students WHERE id=?", (s["id"],), one=True))
        s = db.q("SELECT * FROM students WHERE id=?", (s["id"],), one=True)
        if s["self_reg"] and not s["email"]:
            return self.err(400, "Без учителя нужна почта для восстановления пароля. Укажите почту или код учителя")
        # Do not send a confirmation for a multi-field edit that will be rejected
        # by a later login/invite/account validation and rolled back by api().
        if confirm_new_email:
            services.send_confirm(db, "s", s)
        return self.send_json({"ok": True, "login": s["login"] or "", "email": s["email"] or "",
                               "email_need": bool(s["email"] and not s["email_ok"] and services.mail_ready()),
                               "teacher": services.teacher_of(s)["name"], "self_reg": bool(s["self_reg"])})

    def student_email_resend(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # ученик просит прислать письмо с подтверждением ещё раз
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        if not s["email"]:
            return self.err(400, "Сначала укажите почту")
        if s["email_ok"]:
            return self.send_json({"ok": True, "confirmed": True})
        r = services.send_confirm(db, "s", s)
        if r == "wait":
            return self.err(429, "Письмо уже отправлено — подождите минуту и проверьте папку «Спам»")
        if not r:
            return self.err(503, "Письма с сайта пока не отправляются")
        return self.send_json({"ok": True, "email": s["email"]})

    def account_email_confirm(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # ссылка из письма «Подтвердите почту»: ученик или учитель
        ip = self.client_ip()
        wait = services.throttle.blocked("find", ip)
        if wait:
            return self.err(429, self.wait_msg(wait))
        tok = str(data.get("t") or "")
        r = db.q("SELECT * FROM pw_resets WHERE token=? AND used=0 AND expires>? AND kind IN ('es','et')",
                 (hashlib.sha256(tok.encode()).hexdigest(), time.time()), one=True) if tok else None
        table = "teachers" if r and r["kind"] == "et" else "students"
        account = db.q(f"SELECT * FROM {table} WHERE id=?", (r["uid"],), one=True) if r else None
        if not account or not hmac.compare_digest(r["account_state"] or "", services.confirm_state(account)):
            services.throttle.fail("find", ip)
            return self.err(404, "Ссылка устарела или адрес почты уже изменён — запросите письмо ещё раз")
        db.x(f"UPDATE {table} SET email_ok=1 WHERE id=?", (r["uid"],))
        db.x("UPDATE pw_resets SET used=1 WHERE kind=? AND uid=?", (r["kind"], r["uid"]))
        if r['kind'] == 'et':
            services.activate_teacher_trial(db, r['uid'])
        return self.send_json({"ok": True, "kind": "t" if r["kind"] == "et" else "s", "email": account["email"]})

    def account_password_forgot(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # «Забыли пароль?»: ссылка на почту. Ответ всегда одинаковый — по нему не узнать, есть ли такой аккаунт
        ip = self.client_ip()
        wait = services.throttle.blocked("find", ip)
        if wait:
            return self.err(429, self.wait_msg(wait))
        services.throttle.fail("find", ip)
        origin = recovery_origin(services.site_url)
        if not services.smtp_conf() or not origin:
            return self.err(503, "Восстановление по почте пока не работает — попросите учителя сбросить пароль")
        who = re.sub(r"\s+", " ", str(data.get("who") or "")).strip().lower()[:120]
        kind = "t" if data.get("kind") == "t" else "s"
        if who:
            if kind == "t":
                rows = db.q("SELECT * FROM teachers WHERE (lower(login)=? OR lower(email)=?) AND COALESCE(guest,0)=0",
                            (who, who))
            else:
                rows = db.q("""SELECT * FROM students WHERE (lower(login)=? OR lower(email)=? OR name_key=?)
                               AND COALESCE(is_teacher, 0)=0""", (who, who, services.norm_name(who)[1]))
            for r in rows[:5]:
                if not r["email"]:
                    continue
                if kind == "t":
                    self.tlog("reset_request", r["id"], login=who, detail="запросили ссылку для нового пароля")
                tok = secrets.token_urlsafe(24)
                db.x("INSERT INTO pw_resets(token, kind, uid, expires, account_state) VALUES(?,?,?,?,?)",
                     (hashlib.sha256(tok.encode()).hexdigest(), kind, r["id"], time.time() + services.pw_reset_seconds, reset_fingerprint(r)))
                link = f"{origin}/reset?t={tok}"

                def mail(to=r["email"], name=r["name"], link=link):
                    try:
                        services.send_mail(to, "Egeshka: восстановление пароля",
                                  f"<p>{html_mod.escape(name)}, чтобы задать новый пароль, откройте ссылку (действует 1 час):</p>"
                                  f"<p><a href='{html_mod.escape(link)}'>{html_mod.escape(link)}</a></p>"
                                  "<p style='color:#888'>Если вы не просили восстановить пароль — просто удалите это письмо.</p>",
                                  f"{name}, чтобы задать новый пароль, откройте ссылку (действует 1 час):\n{link}\n\n"
                                  "Если вы не просили восстановить пароль — просто удалите это письмо.")
                    except Exception as e:
                        print(f"[восстановление пароля] {e!r}", flush=True)
                threading.Thread(target=mail, daemon=True).start()
        db.x("DELETE FROM pw_resets WHERE expires < ?", (time.time() - 86400,))
        return self.send_json({"ok": True})

    def account_password_reset(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        tok = str(data.get("t") or "")
        r = db.q("SELECT * FROM pw_resets WHERE token=? AND used=0 AND expires>? AND kind IN ('s','t')",
                 (hashlib.sha256(tok.encode()).hexdigest(), time.time()), one=True) if tok else None
        if not r:
            return self.err(404, "Ссылка устарела или уже использована — запросите новую")
        table = "teachers" if r["kind"] == "t" else "students"
        account = db.q(f"SELECT * FROM {table} WHERE id=?", (r["uid"],), one=True)
        if not account or not hmac.compare_digest(r["account_state"] or "", reset_fingerprint(account)):
            return self.err(404, "Ссылка устарела или уже использована — запросите новую")
        pw = str(data.get("password") or "")
        if len(pw) < (8 if r["kind"] == "t" else 6):
            return self.err(400, f"Пароль — не короче {8 if r['kind'] == 't' else 6} символов")
        db.x("UPDATE pw_resets SET used=1 WHERE kind=? AND uid=?", (r["kind"], r["uid"]))
        if r["kind"] == "t":
            encoded = hash_pw(pw)
            db.x("UPDATE teachers SET pw=?, email_ok=1 WHERE id=?", (encoded, r["uid"]))    # ссылка пришла на почту — адрес подтверждён
            services.activate_teacher_trial(db, r['uid'])
            self.tlog("reset", r["uid"], detail="новый пароль по ссылке из письма")
            if account["is_main"]:
                db.setting("admin_password", encoded)
            db.x("DELETE FROM admin_sessions WHERE COALESCE(teacher_id, ?)=?", (services.main_teacher()["id"], r["uid"]))
            db.x("DELETE FROM admin_codes WHERE teacher_id=?", (r["uid"],))
            db.x("DELETE FROM admin_recovery_codes WHERE teacher_id=?", (r["uid"],))
        else:
            db.x("UPDATE students SET pw=?, email_ok=1 WHERE id=?", (hash_pw(pw), r["uid"]))
            services.sessions_end(db, r["uid"])
        return self.send_json({"ok": True, "kind": r["kind"]})

    def student_consent(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # уже зарегистрированный ученик принимает (новую редакцию) документов
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        if not data.get("accept"):
            return self.err(400, "Отметьте обе галочки")
        db.x("UPDATE students SET consent_ver=?, consent_ts=?, consent_ip=? WHERE id=?",
             (services.legal_version, time.time(), self.client_ip(), s["id"]))
        return self.send_json({"ok": True, "version": services.legal_version})

    def student_password(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        ip = self.client_ip()
        wait = services.throttle.blocked("login", ip)
        if wait:
            return self.err(429, self.wait_msg(wait))
        if s["pw"] and not check_pw(str(data.get("old") or ""), s["pw"]):
            services.throttle.fail("login", ip)
            self._account_delay = 1.0
            return self.err(403, "Текущий пароль неверный")
        new = str(data.get("new") or "")
        if len(new) < 6:
            return self.err(400, "Пароль — не короче 6 символов")
        db.x("UPDATE students SET pw=? WHERE id=?", (hash_pw(new), s["id"]))
        # вход на других устройствах сбрасывается; это устройство остаётся (прежний общий токен — становится входом устройства)
        tok = self.tok if self.sess else services.session_new(db, s["id"], ip, self.headers.get("User-Agent"), False)
        sess = self.sess or db.q("SELECT * FROM student_sessions WHERE token=?", (tok,), one=True)
        services.sessions_end(db, s["id"], keep=sess["id"])
        return self.send_json({"ok": True, "token": tok}, extra={"Set-Cookie": self.student_cookie(tok, temp=bool(sess["shared"]))})

    def student_me(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        # вход по сохранённому в браузере токену продлевает cookie; вход по одной cookie её срок не трогает
        # (иначе вкладка без «Чужого компьютера» сделала бы временный вход постоянным)
        extra = {"Set-Cookie": self.student_cookie(self.tok, temp=bool(self.sess["shared"]))} if self.headers.get("X-Token") and self.sess else None
        if not self.sess:                          # прежний общий токен — теперь вход этого устройства, со своим токеном
            self.tok = services.session_new(db, s["id"], self.client_ip(), self.headers.get("User-Agent"), False)
            self.sess = db.q("SELECT * FROM student_sessions WHERE token=?", (self.tok,), one=True)
            extra = {"Set-Cookie": self.student_cookie(self.tok)}
        return self.send_json(self.me_payload(s), extra=extra)

    def student_logout(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # выйти: вход этого устройства отзывается на сервере (токен, оставшийся в браузере, больше не пустит)
        if self.student(data) and self.sess:
            db.x("UPDATE student_sessions SET ended=? WHERE id=?", (time.time(), self.sess["id"]))
        return self.send_json({"ok": True}, extra={"Set-Cookie": "egest=; Path=/; Max-Age=0" + self.cookie_attrs()})

    def student_network(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # школьная ли сеть — окно входа не запоминает ФИО и не даёт браузеру сохранить пароль
        return self.send_json({"shared": services.shared_ip(db, self.client_ip())})

    def student_sessions(self, method, path, data):
        services = self.student_auth_services()
        db = services.db
        # где выполнен вход: свои устройства; «Выйти на других устройствах» — все, кроме этого
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        if path == "/api/sessions/end" and method == "POST":
            keep = self.sess["id"] if self.sess else None
            if data.get("id"):
                n = db.xn("UPDATE student_sessions SET ended=? WHERE id=? AND student_id=? AND id<>? AND ended IS NULL",
                          (time.time(), services.parse_int(data.get("id")), s["id"], keep or 0))
            else:
                n = services.sessions_end(db, s["id"], keep=keep)
            return self.send_json({"ok": True, "ended": n, "sessions": services.sessions_list(db, s["id"], keep)})
        return self.send_json({"sessions": services.sessions_list(db, s["id"], self.sess["id"] if self.sess else None)})
