"""Student course and laboratory HTTP boundaries.

Dependencies are passed by Handler for each request; importing this module does
not import server or initialize storage. Short mutations run inside the caller's
atomic_response boundary, including live access checks. Independent BugLab
verification deliberately owns its smaller transactions and never holds the
shared database lock while a submitted program is checked out of process.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
import json
import time

from auth import check_pw
import buglab
import buglab_grading
import buglab_verifier
import kim
import learning_quality
from learning_content import course_coverage, course_guide

LEARNING_PROGRESS_PATHS = frozenset({
    '/api/course/coverage', '/api/course/lesson', '/api/course/sets',
    '/api/course/seen', '/api/course/unlock',
    '/api/pyc', '/api/pyc/level', '/api/pyc/unlock', '/api/pyc/help', '/api/pyc/check',
    '/api/lab', '/api/lab/unlock', '/api/lab/bugs', '/api/lab/bugs/check',
    '/api/lab/bugs/explain', '/api/lab/bugs/verify',
    '/api/arduino/unlock', '/api/arduino/progress',
    '/api/learning/mistake', '/api/learning/mistakes',
})
LEARNING_PROGRESS_WRITES = frozenset({
    '/api/course/seen', '/api/course/unlock',
    '/api/pyc/unlock', '/api/pyc/help', '/api/pyc/check',
    '/api/lab/unlock', '/api/lab/bugs/check', '/api/lab/bugs/explain',
    '/api/arduino/unlock', '/api/arduino/progress', '/api/learning/mistake',
})

@dataclass(frozen=True)
class LearningProgressServices:
    db: Any
    bank: Any
    root: Path
    course_open: Callable
    lab_access: Callable
    ard_access: Callable
    course_sets_all: Callable
    teacher_of: Callable
    parse_int: Callable
    live_teacher: Callable
    course_lock: Any
    course_tries: dict
    course_window: int
    course_limit: int
    pyc_pw_tries: dict
    lab_pw_tries: dict
    pyc_lock: Any
    pyc_tries: dict
    bug_tries: dict
    pyc_window: int
    pyc_limit: int
    pyc_access: Callable
    pyc_solved: Callable
    pyc_index: Callable
    pyc_module: Callable
    pyc_open_levels: Callable
    pyc_task: Callable
    pyc_norm: Callable
    arduino_clean: Callable
    arduino_save: Callable
    arduino_load: Callable


class LearningProgressHTTPHandlers:
    def learning_progress_services(self):
        raise NotImplementedError

    def learning_progress_route(self, method, path, qs, data):
        svc = self.learning_progress_services()
        db = svc.db
        if path == "/api/course/coverage" and method == "GET":
            available = svc.bank.ensure()
            return self.send_json(course_coverage(svc.root, svc.bank.tasks if available else None,
                                                  include_skills=qs.get("skills") == "1"))
        if path == "/api/learning/mistake" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            svc.bank.ensure()
            task = svc.bank.real(str(data.get("task") or ""))
            try:
                return self.send_json(dict(ok=True, **learning_quality.save_mistake(db, s["id"], task, data.get("reason"))))
            except ValueError as exc:
                return self.err(400, str(exc))
            except LookupError as exc:
                return self.err(404, str(exc))
        if path == "/api/learning/mistakes" and method == "GET":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not svc.bank.ensure():
                return self.err(503, "банк заданий не собран")
            return self.send_json({"items": learning_quality.mistake_summary(db, s["id"]), "days": 30,
                                   "followup": learning_quality.followup_metrics(db, s["id"], svc.bank.tasks)})
        if path == "/api/course/lesson":
            # презентация урока — только тем, у кого курс открыт паролем (файлы course/ напрямую не раздаются)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not svc.course_open(s):
                return self.err(403, "курс закрыт")
            n = svc.parse_int(qs.get("n"))
            n = 19 if n in (20, 21) else n
            f = svc.root / "course" / f"{n}.json"
            if not (n in kim.ALL_NUMS and f.is_file()):
                return self.send_json(course_guide(n))
            try:
                return self.send_json(json.loads(f.read_text(encoding="utf-8")))
            except ValueError:
                return self.err(500, "презентация повреждена")

        if path == "/api/course/sets":
            # состав подборок курса (по 20 заданий) — собирает сервер по кластерам, одинаково для ученика и учителя
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not svc.course_open(s):
                return self.err(403, "курс закрыт")
            if not svc.bank.ensure():
                return self.err(503, "банк заданий не собран")
            sets = svc.course_sets_all(bool(svc.teacher_of(s)["authored"]))
            pid = svc.bank.pid
            return self.send_json({"sets": {n: {k: [pid(i) for i in ids] for k, ids in v.items()} for n, v in sets.items()}})

        if path == "/api/course/seen" and method == "POST":
            # докуда ученик долистал презентацию урока — учитель видит в прогрессе курса
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not svc.course_open(s):
                return self.err(403, "курс закрыт")
            n, sl, tot = svc.parse_int(data.get("n")), svc.parse_int(data.get("slide")), svc.parse_int(data.get("total"))
            if not (n in kim.ALL_NUMS and sl and 0 < sl <= (tot or 0) <= 200):
                return self.err(400, "неверные данные")
            db.x("""INSERT INTO course_seen(student_id, n, slide, total, ts) VALUES(?,?,?,?,?)
                    ON CONFLICT(student_id, n) DO UPDATE SET slide=MAX(slide, excluded.slide), total=excluded.total, ts=excluded.ts""",
                 (s["id"], n, sl, tot, time.time()))
            return self.send_json({"ok": True})

        if path == "/api/course/unlock" and method == "POST":
            # курс — по паролю от учителя; попыток немного, чтобы пароль не подбирали
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if svc.course_open(s):
                return self.send_json({"ok": True})
            stored = db.setting("course_pw")
            if not stored:
                return self.err(403, "Учитель ещё не открыл курс")
            now = time.time()
            with svc.course_lock:
                tries = [t for t in svc.course_tries.get(s["id"], []) if now - t < svc.course_window]
                if len(tries) >= svc.course_limit:
                    return self.err(429, f"Слишком много попыток — попробуйте через {int((svc.course_window - (now - tries[0])) // 60) + 1} мин")
                tries.append(now)
                svc.course_tries[s["id"]] = tries
            if not check_pw(str(data.get("password") or "")[:200], stored):
                return self.err(403, "Неверный пароль курса")
            db.x("UPDATE students SET course=1, course_ts=? WHERE id=?", (time.time(), s["id"]))
            return self.send_json({"ok": True})

        if path in ("/api/lab", "/api/lab/unlock", "/api/lab/bugs", "/api/lab/bugs/check", "/api/lab/bugs/explain", "/api/lab/bugs/verify"):
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if path == "/api/lab/unlock" and method == "POST" and not svc.lab_access(db, s):
                stored = db.setting("lab_pw")
                if not stored:
                    return self.err(403, "Лаборатории ещё не открыты учителем")
                now = time.time()
                with svc.course_lock:
                    tries = [t for t in svc.lab_pw_tries.get(s["id"], []) if now - t < svc.course_window]
                    if len(tries) >= svc.course_limit:
                        return self.err(429, "Слишком много попыток — попробуйте позже")
                    tries.append(now)
                    svc.lab_pw_tries[s["id"]] = tries
                if not check_pw(str(data.get("password") or "")[:200], stored):
                    return self.err(403, "Неверный пароль лабораторий")
                db.x("UPDATE students SET lab=1 WHERE id=?", (s["id"],))
                return self.send_json({"access": True})
            if path.startswith("/api/lab/bugs"):
                return self.api_buglab(method, path, data, s)
            return self.send_json({"access": svc.lab_access(db, s), "pw": bool(db.setting("lab_pw"))})

        if path.startswith("/api/pyc"):
            return self.pyc_api(method, path, qs, data)

        if path == "/api/arduino/unlock" and method == "POST":
            # пароль лаборатории Arduino — свой, не пароль лабораторий; попытки ограничены, как у других разделов
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if svc.ard_access(db, s):
                return self.send_json({"access": True})
            stored = db.setting("ard_pw")
            if not stored:
                return self.err(403, "Лабораторию Arduino ещё не открыл учитель")
            now = time.time()
            with svc.course_lock:
                tries = [t for t in svc.lab_pw_tries.get(("ard", s["id"]), []) if now - t < svc.course_window]
                if len(tries) >= svc.course_limit:
                    return self.err(429, "Слишком много попыток — попробуйте позже")
                tries.append(now)
                svc.lab_pw_tries[("ard", s["id"])] = tries
            if not check_pw(str(data.get("password") or "")[:200], stored):
                return self.err(403, "Неверный пароль лаборатории Arduino")
            db.x("UPDATE students SET ard=1 WHERE id=?", (s["id"],))
            return self.send_json({"access": True})

        if path == "/api/arduino/progress" and method == "GET":
            # прогресс с сервера — страница Arduino подтягивает его на любом компьютере и после очистки браузера
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if s["is_teacher"] or not svc.ard_access(svc.db, s):
                return self.send_json({"tracks": {}})
            return self.send_json({"tracks": svc.arduino_load(svc.db, s["id"])})

        if path == "/api/arduino/progress" and method == "POST":
            # страница Arduino присылает сводку прогресса уроков; учитель видит её во вкладке «Arduino»
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if s["is_teacher"] or not svc.ard_access(svc.db, s):
                return self.send_json({"ok": True, "skipped": True})
            clean = svc.arduino_clean(data.get("tracks"))
            if clean is None:
                return self.err(400, "Неверные данные прогресса")
            svc.arduino_save(svc.db, s["id"], clean)
            return self.send_json({"ok": True})

        return self.err(404, "нет такого метода")

    def pyc_api(self, method, path, qs, data):
        """Курс программирования для ученика: план, уровень (слайды и задачи без ответов), проверка ответа."""
        svc = self.learning_progress_services()
        db = svc.db
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        if path == "/api/pyc/unlock" and method == "POST":
            # вход по паролю курса (как у раздела «Курс»): кто знает пароль — тому курс открыт
            if svc.pyc_access(s):
                return self.send_json({"ok": True})
            stored = db.setting("pyc_pw")
            if not stored:
                return self.err(403, "Курс программирования открывает учитель")
            now = time.time()
            with svc.course_lock:
                tries = [t for t in svc.pyc_pw_tries.get(s["id"], []) if now - t < svc.course_window]
                if len(tries) >= svc.course_limit:
                    return self.err(429, f"Слишком много попыток — попробуйте через {int((svc.course_window - (now - tries[0])) // 60) + 1} мин")
                tries.append(now)
                svc.pyc_pw_tries[s["id"]] = tries
            if not check_pw(str(data.get("password") or "").strip()[:200], stored):
                return self.err(403, "Неверный пароль курса")
            db.x("UPDATE students SET pyc=1, pyc_ts=? WHERE id=?", (now, s["id"]))
            svc.live_teacher(s)                       # во вкладке «Программирование» у учителя ученик появится сразу
            return self.send_json({"ok": True})
        if not svc.pyc_access(s):
            if path == "/api/pyc":
                return self.send_json({"access": False, "pw": bool(db.setting("pyc_pw"))})
            return self.err(403, "Курс программирования открывается по паролю от учителя")
        teacher = bool(s["is_teacher"])
        free = teacher or bool(s["pyc_free"])   # все уровни открыты: учителю и ученику, которому учитель так открыл
        prog = svc.pyc_solved(db, s["id"])
        if path == "/api/pyc":
            mods = []
            for m in svc.pyc_index():
                mods.append({**m, "open": svc.pyc_open_levels(m, prog, free)})
            return self.send_json({"access": True, "teacher": teacher, "modules": mods,
                                   "progress": {k: v for k, v in prog.items()}})
        if path == "/api/pyc/level":
            mod = svc.pyc_module(qs.get("m"))
            li = svc.parse_int(qs.get("l"))
            if not mod or li is None or not 0 <= li < len(mod["levels"]):
                return self.err(404, "нет такого уровня")
            if li >= svc.pyc_open_levels(mod, prog, free):
                return self.err(403, "Уровень ещё закрыт: решите задачи предыдущего")
            lv = mod["levels"][li]
            tasks = []
            for t in lv["tasks"]:
                p = prog.get(t["id"]) or {}
                x = {k: t[k] for k in ("id", "h", "cond", "stars", "hint", "note", "files", "practice") if k in t}
                x.update(ok=bool(p.get("ok")), tries=p.get("tries", 0), hint_used=bool(p.get("hint_used")), solution_seen=bool(p.get("solution_seen")), independent=bool(p.get("independent")))
                if p.get("ok") or p.get("tries", 0) >= 3 or teacher:
                    x["sol"] = t["sol"]                 # разбор — после решения или трёх неудачных попыток
                if p.get("ok") or teacher:
                    x["ans"] = t["ans"]
                tasks.append(x)
            return self.send_json({"id": mod["id"], "n": mod["n"], "title": mod["title"], "icon": mod["icon"],
                                   "levels": len(mod["levels"]), "l": li,
                                   "level": {"title": lv["title"], "goal": lv["goal"], "need": lv["need"],
                                             "slides": lv["slides"], "tasks": tasks}})
        if path == "/api/pyc/help" and method == "POST":
            mod, li, task = svc.pyc_task(str(data.get("task") or "")[:40])
            kind = data.get("kind")
            if not task or kind not in ("hint", "solution"):
                return self.err(400, "нет такой подсказки")
            if li >= svc.pyc_open_levels(mod, prog, free):
                return self.err(403, "Уровень ещё закрыт")
            was = prog.get(task["id"]) or {}
            if kind == "solution" and not (teacher or was.get("ok") or was.get("tries", 0) >= 3):
                return self.err(403, "Разбор доступен после решения или трёх попыток")
            field = "hint_used" if kind == "hint" else "solution_seen"
            db.x(f"INSERT INTO pyc_progress(student_id,task_id,{field},first_ts,last_ts) VALUES(?,?,1,?,?) "
                 f"ON CONFLICT(student_id,task_id) DO UPDATE SET {field}=1, last_ts=excluded.last_ts",
                 (s["id"], task["id"], time.time(), time.time()))
            svc.live_teacher(s)
            return self.send_json({"ok": True})
        if path == "/api/pyc/check" and method == "POST":
            tid = str(data.get("task") or "")[:40]
            mod, li, t = svc.pyc_task(tid)
            if not t:
                return self.err(404, "нет такой задачи")
            if li >= svc.pyc_open_levels(mod, prog, free):
                return self.err(403, "Уровень ещё закрыт")
            ans = str(data.get("answer") or "").strip()[:300]
            if not ans:
                return self.err(400, "Введите ответ")
            now = time.time()
            with svc.pyc_lock:
                tries = [x for x in svc.pyc_tries.get(s["id"], []) if now - x < svc.pyc_window]
                if len(tries) >= svc.pyc_limit:
                    return self.err(429, "Слишком много проверок подряд — подождите минуту")
                tries.append(now)
                svc.pyc_tries[s["id"]] = tries
            ok = svc.pyc_norm(ans) == svc.pyc_norm(t["ans"])
            code = str(data.get("code") or "")[:20000] or None
            was = prog.get(tid) or {}
            if was.get("ok"):
                return self.send_json({"ok": ok, "already": True, "tries": was.get("tries", 0), "ans": t["ans"], "sol": t["sol"]})
            db.x("""INSERT INTO pyc_progress(student_id, task_id, ok, tries, first_ts, ok_ts, last_ts, code) VALUES(?,?,?,?,?,?,?,?)
                    ON CONFLICT(student_id, task_id) DO UPDATE SET ok=excluded.ok, tries=tries + 1, last_ts=excluded.last_ts,
                      ok_ts=COALESCE(ok_ts, excluded.ok_ts), code=COALESCE(excluded.code, code)""",
                 (s["id"], tid, int(ok), 1, now, now if ok else None, now, code))
            if ok:
                db.x("UPDATE pyc_progress SET independent=? WHERE student_id=? AND task_id=?",
                     (int(not was.get("hint_used") and not was.get("solution_seen")), s["id"], tid))
            prog = svc.pyc_solved(db, s["id"])
            n_tries = prog[tid]["tries"]
            out = {"ok": ok, "tries": n_tries}
            if ok or n_tries >= 3 or teacher:
                out["sol"] = t["sol"]
            if ok:
                out["ans"] = t["ans"]
                before = li + 1
                out["opened"] = svc.pyc_open_levels(mod, prog, free) > before and before < len(mod["levels"])
                svc.live_teacher(s)                 # у учителя обновится прогресс курса
            return self.send_json(out)
        return self.err(404, "нет такого метода")

    def api_buglab(self, method, path, data, s):
        """Самопроверка в браузере и отдельная проверка доверенным изолированным исполнителем."""
        svc = self.learning_progress_services()
        db = svc.db
        if not svc.lab_access(db, s):
            return self.err(403, "Лаборатории открываются по паролю от учителя")
        mine = {r["case_id"]: r for r in db.q("SELECT * FROM buglab WHERE student_id=?", (s["id"],))}
        def state(cid):
            return buglab_grading.state(mine.get(cid))
        if path == "/api/lab/bugs" and method == "GET":
            return self.send_json({"levels": buglab.LEVELS, "kinds": buglab.KINDS,
                                   "cases": [dict(buglab.public(c), my=state(c["id"])) for c in buglab.CASES]})
        case = buglab.BY_ID.get(str(data.get("id") or ""))
        if not case:
            return self.err(404, "нет такой задачи")
        now = time.time()
        if path == "/api/lab/bugs/verify" and method == "POST":
            code = data.get("code")
            try:
                # Validate without executing or truncating the submitted program.
                buglab_verifier.wire.program(code, list(case["inputs"]))
            except (ValueError, UnicodeEncodeError) as exc:
                return self.err(400, str(exc))
            sid = s["id"]
            denial = None
            try:
                with db.transaction():
                    # Account deletion/revocation can race the initial read too.
                    current = self.student(data)
                    if not current or current["id"] != sid:
                        denial = (401, "Вход завершён. Войдите снова для независимой проверки.")
                    elif not svc.lab_access(db, current):
                        denial = (403, "Доступ к лабораториям закрыт.")
                    else:
                        job = buglab_grading.reserve(db, sid)
            except buglab_grading.Limited as exc:
                return self.send_json({"error": str(exc)}, 429, {"Retry-After": str(exc.retry_after)})
            if denial:
                return self.err(*denial)
            try:
                # No DB lock/transaction may span this potentially slow operation.
                verdict = buglab_verifier.verify(case, code)
            except (buglab_verifier.InvalidProgram, buglab_verifier.VerifierUnavailable) as exc:
                with db.transaction():
                    buglab_grading.finish(db, job, "unavailable")
                status = 400 if isinstance(exc, buglab_verifier.InvalidProgram) else (429 if isinstance(exc, buglab_verifier.VerifierBusy) else 503)
                return self.send_json({"error": str(exc)}, status, {"Retry-After": "5"} if status != 400 else None)
            except BaseException:
                with db.transaction():
                    buglab_grading.finish(db, job, "unavailable")
                raise
            status, result = 200, None
            with db.transaction():
                # Re-read the original session and access after grading. Logout,
                # account deletion and teacher suspension must revoke late credit.
                current = self.student(data)
                if not current or current["id"] != sid:
                    status, result = 401, {"error": "Вход завершён. Войдите снова для независимой проверки."}
                elif not svc.lab_access(db, current):
                    status, result = 403, {"error": "Доступ к лабораториям закрыт. Результат не сохранён."}
                elif not buglab_grading.active(db, sid, job):
                    status, result = 409, {"error": "Время проверки истекло. Повторите проверку."}
                else:
                    my = buglab_grading.save(db, sid, case, code, verdict)
                    result = dict(verdict, my=my)
                    if verdict["ok"]:
                        result["explain"] = case["explain"]
                buglab_grading.finish(db, job, "complete" if status == 200 else "cancelled")
            return self.send_json(result, status)
        if path == "/api/lab/bugs/check" and method == "POST":
            with svc.pyc_lock:                                   # не чаще, чем проверки в курсе Python
                tries = [x for x in svc.bug_tries.get(s["id"], []) if now - x < svc.pyc_window]
                if len(tries) >= svc.pyc_limit:
                    return self.err(429, "Слишком много проверок подряд — подождите минуту")
                tries.append(now)
                svc.bug_tries[s["id"]] = tries
            runs = data.get("runs") if isinstance(data.get("runs"), list) else []
            code = str(data.get("code") or "")[:20000]
            tests = buglab.check(case, runs[:len(case["inputs"])])
            ok = all(t["ok"] for t in tests)
            changed = buglab.changed_lines(case, code)
            # Browser-supplied outputs are useful feedback, never independent proof.
            with db.transaction():
                db.x("""INSERT INTO buglab(student_id, case_id, ok, tries, star, seen, first_ts, ok_ts, code) VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(student_id, case_id) DO UPDATE SET ok=MAX(ok, excluded.ok), tries=tries + (1 - excluded.ok) * (1 - ok),
                      seen=MAX(seen, excluded.seen), ok_ts=COALESCE(ok_ts, excluded.ok_ts),
                      code=CASE WHEN excluded.ok AND NOT verified THEN excluded.code ELSE code END""",
                     (s["id"], case["id"], int(ok), 0 if ok else 1, 0, int(ok), now, now if ok else None, code if ok else None))
                row = db.q("SELECT * FROM buglab WHERE student_id=? AND case_id=?", (s["id"], case["id"]), one=True)
            out = {"ok": ok, "verified": False, "provenance": "self_check", "tests": tests,
                   "changed": changed, "par": case["par"],
                   "my": buglab_grading.state(row)}
            if ok:
                out["explain"] = case["explain"]
            return self.send_json(out)
        if path == "/api/lab/bugs/explain" and method == "POST":
            was = state(case["id"])
            if not was["ok"] and was["tries"] < 3:
                return self.err(403, "Разбор откроется после трёх проверок — сначала попробуй сам и посмотри подсказки")
            db.x("""INSERT INTO buglab(student_id, case_id, seen, first_ts) VALUES(?,?,1,?)
                    ON CONFLICT(student_id, case_id) DO UPDATE SET seen=1""", (s["id"], case["id"], now))
            return self.send_json({"explain": case["explain"]})
        return self.err(404, "нет такого метода")
