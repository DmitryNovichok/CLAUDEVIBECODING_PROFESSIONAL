"""Student assignment and exam HTTP workflows.

Handler.api authorizes requests inside its existing transaction before reaching
these handlers. Database writes and result acknowledgement keep that outer
boundary; this module never imports or initializes the application. Shared
attempt logging and answer disclosure are supplied by the HTTP handler.
"""
from dataclasses import dataclass
from typing import Any, Callable, Sequence
import json
import secrets
import time
import lab13


STRICT_ASSIGNMENT_PATHS = frozenset({
    '/api/asg/state', '/api/asg/review', '/api/asg/start',
    '/api/asg/away', '/api/asg/answer', '/api/asg/finish',
})
LAB13_PATHS = frozenset({'/api/asg/lab13/start', '/api/asg/lab13/answer'})
LEARNING_ATTEMPT_PATHS = STRICT_ASSIGNMENT_PATHS | LAB13_PATHS | frozenset({
    '/api/assignments', '/api/exam/start', '/api/exam/save',
    '/api/exam/finish', '/api/exams', '/api/exam/view',
})


@dataclass(frozen=True)
class LearningAttemptServices:
    """Explicit live dependencies, constructed for each handler call."""
    db: Any
    bank: Any
    ege_scale: Sequence[int]
    exam_limit_sec: int
    exam_min_sec_for_answers: int
    exam_per_day: int
    exam_per_day_ip: int
    answer_credit: Callable
    asg_code: Callable
    asg_cutoff: Callable
    asg_expire: Callable
    asg_finish_run: Callable
    asg_items: Callable
    asg_order: Callable
    asg_review_locked: Callable
    asg_run_public: Callable
    assignment_done: Callable
    ege_points: Callable
    exam_input: Callable
    exam_pick: Callable
    game_summary: Callable
    live_teacher: Callable
    n_key: Callable
    practice_score: Callable
    strict_locked: Callable
    to_float: Callable
    to_int: Callable
    tokens: Callable
    trap_hit: Callable
    trap_k: Callable


class LearningAttemptHTTPHandlers:
    def learning_attempt_services(self):
        raise NotImplementedError

    def learning_attempt_route(self, method, path, qs, data):
        svc = self.learning_attempt_services()
        db = svc.db
        if path in LAB13_PATHS:
            if method != "POST":
                return self.err(405, "нужен POST")
            return self.api_lab13(svc, path, data)
        if path == "/api/assignments":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            svc.bank.ensure()
            out = []
            if s["class_id"]:
                svc.asg_expire(self, db, s["class_id"])
                for a in db.q("""SELECT * FROM assignments WHERE class_id=? AND (student_id IS NULL OR student_id=?)
                                 ORDER BY created DESC""", (s["class_id"], s["id"])):
                    real = [i for i in json.loads(a["tasks"] or "[]") if i in svc.bank.tasks]
                    item = {"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                            "kind": a["kind"] or "self", "tasks": [svc.bank.pid(i) for i in real],
                            "closed": a["closed"], "personal": a["batch"].split(":")[0] if a["batch"] else None}
                    if a["kind"] == "lab13":
                        if s["is_teacher"]:
                            continue
                        state = lab13.assignment_state(a, lab13.get_run(db, a["id"], s["id"]), s["id"])
                        item.update(strict=False, started=state["started"], finished=state["finished"], lab13=state, done=[])
                    elif a["strict"]:
                        real = svc.asg_order(real, a["id"], s["id"])      # у каждого ученика свой порядок заданий
                        item["tasks"] = [svc.bank.pid(i) for i in real]
                        item.update(svc.asg_run_public(db, a, s["id"], real))
                    else:
                        done = svc.assignment_done(db, s["id"], real, a["created"], svc.asg_cutoff(a))
                        item["done"] = [svc.bank.pid(i) for i in real if i in done]
                        item["score"] = svc.practice_score(db, a, s["id"], real)      # практическая и домашняя: оценка сама
                    out.append(item)
            return self.send_json({"assignments": out, "in_class": bool(s["class_id"])})

        if path in STRICT_ASSIGNMENT_PATHS:
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            svc.bank.ensure()
            return self.api_strict(s, path, method, data, qs)

        if path == "/api/exam/start" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            return self.api_exam_start(s)

        if path in ("/api/exams", "/api/exam/view"):
            # история вариантов ученика: список и разбор одного (свой ответ, баллы, правильный — если его показывали)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if path == "/api/exams":
                out = []
                for e in db.q("""SELECT id, started, finished, primary_score, test_score, items, result FROM exams
                                 WHERE student_id=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 100""", (s["id"],)):
                    r = json.loads(e["result"] or "{}")
                    res = r.get("results") or []
                    out.append({"id": e["id"], "started": e["started"], "finished": e["finished"], "primary": e["primary_score"] or 0,
                                "test": e["test_score"] or 0, "spent": r.get("spent"), "shown": bool(r.get("shown")),
                                "items": len(res), "full": sum(1 for x in res if x.get("points") == x.get("max") and x.get("max")),
                                "blank": sum(1 for x in res if x.get("blank"))})
                return self.send_json({"exams": out})
            e = db.q("SELECT * FROM exams WHERE id=? AND student_id=? AND finished IS NOT NULL", (str(qs.get("id") or ""), s["id"]), one=True)
            if not e:
                return self.err(404, "Вариант не найден")
            r = json.loads(e["result"] or "{}")
            mine = {}
            for a in db.q("SELECT task_id, answers FROM attempts WHERE student_id=? AND exam=?", (s["id"], e["id"])):
                try:
                    mine[svc.bank.pid(a["task_id"])] = (json.loads(a["answers"] or "[]") or [""])[0]
                except ValueError:
                    pass
            for x in r.get("results") or []:
                x["mine"] = mine.get(x.get("task"), "")
            return self.send_json(dict(r, id=e["id"], started=e["started"], finished=e["finished"]))

        if path == "/api/exam/save" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            e = db.q("SELECT * FROM exams WHERE id=? AND student_id=?", (str(data.get("exam_id") or ""), s["id"]), one=True)
            if not e:
                return self.err(404, "Вариант не найден")
            if e["finished"] or time.time() > e["started"] + svc.exam_limit_sec:
                return self.send_json({"saved": False, "expired": True})
            rev = svc.to_int(data.get("rev"))
            if rev > (e["saved_rev"] or 0):
                db.x("UPDATE exams SET saved_answers=?, saved_rev=? WHERE id=?",
                     (json.dumps(svc.exam_input(data), ensure_ascii=False), rev, e["id"]))
            return self.send_json({"saved": True, "rev": max(rev, e["saved_rev"] or 0)})

        if path == "/api/exam/finish" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not svc.bank.ensure():
                return self.err(503, "банк заданий не собран")
            return self.api_exam_finish(s, data)

        return self.err(404, "нет такого метода")

    def api_lab13(self, svc, path, data):
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        aid = data.get("id")
        if s["is_teacher"] or type(aid) is not int or not (0 < aid < 2**63):
            return self.err(404, "Назначение не найдено")
        db, sid = svc.db, s["id"]
        a = db.q("""SELECT * FROM assignments WHERE id=? AND kind='lab13' AND class_id=?
                    AND (student_id IS NULL OR student_id=?)""", (aid, s["class_id"], sid), one=True)
        if not a:
            return self.err(404, "Назначение не найдено")
        run = lab13.get_run(db, aid, sid)
        state = lab13.assignment_state(a, run, sid)
        if state["finished"] is not None:
            return self.send_json(state)
        if state["closed"]:
            return self.err(409, "Лабораторная закрыта")
        now = time.time()
        if path == "/api/asg/lab13/start":
            if run:
                return self.send_json(state)
            lab13.start(db, aid, sid, now)
        else:
            if not run:
                return self.err(409, "Сначала откройте лабораторную")
            prediction = data.get("prediction")
            if type(prediction) is not int or not 0 <= prediction <= 2**32:
                return self.err(400, "Введите целое число от 0 до 4294967296")
            lab13.submit(db, aid, sid, state, prediction, now)
        self._notify_lab13 = lambda: svc.live_teacher(s)
        return self.send_json(lab13.assignment_state(a, lab13.get_run(db, aid, sid), sid))

    def api_exam_start(self, s):
        svc = self.learning_attempt_services()
        db = svc.db
        now = time.time()
        ip = self.client_ip()
        if db.q("SELECT COUNT(*) c FROM exams WHERE student_id=? AND started>?", (s["id"], now - 86400), one=True)["c"] >= svc.exam_per_day:
            return self.err(429, f"Не больше {svc.exam_per_day} вариантов в сутки. Пока можно тренироваться по номерам.")
        if db.q("SELECT COUNT(*) c FROM exams WHERE ip=? AND started>?", (ip, now - 86400), one=True)["c"] >= svc.exam_per_day_ip:
            return self.err(429, "С этого адреса сегодня начато слишком много вариантов. Попробуйте завтра.")
        if not svc.bank.ensure():
            return self.err(503, "банк заданий не собран")
        tasks = svc.exam_pick(db, s)
        if not tasks:
            return self.err(503, "В банке нет заданий для варианта")
        eid = secrets.token_urlsafe(9)
        db.x("INSERT INTO exams(id,student_id,ip,started,tasks,save_protocol) VALUES(?,?,?,?,?,1)", (eid, s["id"], ip, now, json.dumps(tasks)))
        return self.send_json({"exam_id": eid, "started": now, "limit": svc.exam_limit_sec,
                               "min_for_answers": svc.exam_min_sec_for_answers,
                               "items": [{"id": svc.bank.pid(i), "n": svc.n_key(svc.bank.tasks[i].get("n")), "trap": svc.trap_k(db, s, svc.bank.tasks[i])}
                                         for i in tasks]})

    def api_strict(self, s, path, method, data, qs):
        """Контрольная от учителя: ответ сдаётся один раз и не проверяется до конца, результат — после сдачи."""
        svc = self.learning_attempt_services()
        db = svc.db
        aid = svc.to_int(data.get("id") or qs.get("id"))
        a = db.q("SELECT * FROM assignments WHERE id=? AND strict=1 AND COALESCE(kind,'self') != 'lab13'", (aid,), one=True)
        if not a or a["class_id"] != s["class_id"] or (a["student_id"] and a["student_id"] != s["id"]):
            return self.err(404, "Самостоятельная не найдена")
        if a["due"] and not a["closed"] and time.time() > a["due"]:
            svc.asg_expire(self, db, a["class_id"])           # срок прошёл — работа закрывается, начатая сдаётся сама
            a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
        real = svc.asg_order([i for i in json.loads(a["tasks"] or "[]") if i in svc.bank.tasks], aid, s["id"])
        run = db.q("SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?", (aid, s["id"]), one=True)
        now = time.time()
        if path == "/api/asg/state":
            return self.send_json(svc.asg_run_public(db, a, s["id"], real))
        if path == "/api/asg/review":
            # разбор сданной контрольной: правильные ответы и решения — когда контрольная закончилась для всех
            if not run or not run["finished"]:
                return self.err(409, "Разбор откроется после того, как ты сдашь самостоятельную")
            why = svc.asg_review_locked(db, a)
            if why:
                return self.send_json({"locked": why, "title": a["title"]})
            res = json.loads(run["result"] or "{}")
            answers = json.loads(run["answers"] or "{}")
            items = []
            for k in svc.asg_items(real):
                t = svc.bank.tasks.get(k) or {}
                top = t.get("group") or k
                code = svc.asg_code(db, a, s["id"], top, run)
                it = self.with_answer_s(s, {"task": svc.bank.pid(k), "top": svc.bank.pid(top), "n": t.get("n"),
                                            "mine": (answers.get(k) or {}).get("a") or "", "credit": res.get(k),
                                            "code": code["code"] if code else ""}, t)
                items.append(it)
            return self.send_json({"title": a["title"], "items": items, "result": svc.asg_run_public(db, a, s["id"], real).get("result")})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path == "/api/asg/start":
            if not run:
                if a["closed"]:
                    return self.err(409, "Срок прошёл — самостоятельная закрыта" if a["due"] and a["closed"] >= a["due"]
                                    else "Учитель уже завершил эту самостоятельную")
                db.x("INSERT INTO asg_runs(asg_id, student_id, started, last, answers) VALUES(?,?,?,?,?)", (aid, s["id"], now, now, "{}"))
                db.x("INSERT INTO asg_events(asg_id, student_id, ts, kind) VALUES(?,?,?,'start')", (aid, s["id"], now))
                svc.live_teacher(s)
            return self.send_json(svc.asg_run_public(db, a, s["id"], real))
        if not run:
            return self.err(409, "Сначала начните самостоятельную")
        if path == "/api/asg/away":
            # ушёл со вкладки или вышел из полного экрана — учителю в живую сводку и в ленту
            kind = "fs" if data.get("kind") == "fs" else "away"
            if not run["finished"] and not a["closed"]:
                recent = db.q("SELECT COUNT(*) AS c FROM asg_events WHERE student_id=? AND ts>?", (s["id"], now - 3600), one=True)["c"]
                if recent < 300:
                    db.x(f"UPDATE asg_runs SET {kind}=COALESCE({kind}, 0)+1, last=? WHERE asg_id=? AND student_id=?", (now, aid, s["id"]))
                    db.x("INSERT INTO asg_events(asg_id, student_id, ts, kind, info) VALUES(?,?,?,?,?)",
                         (aid, s["id"], now, kind, str(round(svc.to_float(data.get("dur")))) if data.get("dur") else None))
                    svc.live_teacher(s)
            return self.send_json({"ok": True})
        if run["finished"] or a["closed"]:
            if not run["finished"]:
                svc.asg_finish_run(self, db, a, s, real, forced=1)
            return self.send_json(dict(svc.asg_run_public(db, a, s["id"], real), closed_now=True))
        if path == "/api/asg/answer":
            answers = json.loads(run["answers"] or "{}")
            tid = svc.bank.real(data.get("task")) or ""
            t = svc.bank.tasks.get(tid)
            if not t or (tid not in real and t.get("group") not in real):
                return self.err(404, "Такого задания в самостоятельной нет")
            if t.get("parts"):
                return self.err(400, "вопросы 19–21 сдаются по отдельности")
            ans = str(data.get("answer") or "")[:400]
            cells = data.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            if tid in answers:
                # сданный ответ можно один раз изменить — по кнопке «Изменить ответ»
                if answers[tid].get("ch"):
                    return self.err(409, "Ответ уже изменён один раз — больше изменить нельзя")
                if not data.get("change"):
                    return self.err(409, "Ответ на это задание уже сдан")
                old = answers[tid]
                answers[tid] = {"a": ans, "c": cells, "ts": now, "ms": old.get("ms"), "ch": 1, "prev": old.get("a")}
            else:
                answers[tid] = {"a": ans, "c": cells, "ts": now, "ms": svc.to_int(data.get("spent_ms")) or None}
            db.x("UPDATE asg_runs SET answers=?, last=? WHERE asg_id=? AND student_id=?",
                 (json.dumps(answers, ensure_ascii=False), now, aid, s["id"]))
            svc.live_teacher(s)                      # «● Онлайн» у учителя: сдано на одно задание больше
            return self.send_json(svc.asg_run_public(db, a, s["id"], real))
        if path == "/api/asg/finish":
            svc.asg_finish_run(self, db, a, s, real)
            return self.send_json(dict(svc.asg_run_public(db, a, s["id"], real), game=svc.game_summary(db, s["id"])))
        return self.err(404, "нет такого метода")

    def api_exam_finish(self, s, data):
        svc = self.learning_attempt_services()
        db = svc.db
        e = db.q("SELECT * FROM exams WHERE id=? AND student_id=?", (str(data.get("exam_id") or ""), s["id"]), one=True)
        if not e:
            return self.err(404, "Вариант не найден — начните новый")
        if e["finished"]:
            return self.send_json(json.loads(e["result"] or "{}"))
        now = time.time()
        elapsed = max(0, now - e["started"])
        # Exams already running during the upgrade keep their old submission protocol once.
        spent = min(elapsed, svc.exam_limit_sec) if e["save_protocol"] else elapsed
        expired = bool(e["save_protocol"]) and elapsed > svc.exam_limit_sec
        show = spent >= svc.exam_min_sec_for_answers
        items = json.loads(e["saved_answers"] or "[]") if expired else svc.exam_input(data)
        issued = set(json.loads(e["tasks"])) if e["tasks"] else None    # задания, выданные сервером при старте
        present = {svc.bank.real(it.get("task")) for it in items}
        for tid in svc.asg_items(json.loads(e["tasks"] or "[]")):
            if tid not in present:
                items.append({"task": svc.bank.pid(tid), "answer": ""})
        results, primary, seen, nums = [], 0, set(), set()
        for it in items[:40]:
            if not isinstance(it, dict):
                continue
            tid = svc.bank.real(it.get("task")) or ""
            t = svc.bank.tasks.get(tid)
            if not t or t.get("parts") or tid in seen or t.get("n") in nums:
                continue                      # по одному заданию на номер, как на экзамене
            if issued is not None and (t.get("group") or tid) not in issued:
                continue                      # чужое задание в вариант не подставить — ни балла, ни ответа
            if issued is None and svc.strict_locked(db, s, t.get("group") or tid):
                continue                      # вариант старого образца: задания идущей самостоятельной — без ответа
            seen.add(tid)
            n = t.get("n") or 0
            nums.add(n)
            ans = str(it.get("answer") or "")[:400]
            cells = it.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            blank = not svc.tokens(ans)
            credit = 0.0 if blank else svc.answer_credit(n, t.get("ans", ""), ans, cells)
            pts = svc.ege_points(n) if credit == 1.0 else (1 if credit == 0.5 else 0)
            primary += pts
            if not blank:                     # нетронутое задание варианта — не ошибка: в журнал и статистику не идёт
                self.log_attempt(s, t, [ans], 1.0 if credit == 1.0 else 0.0, reason="exam",
                                 part=credit, revealed=int(show), exam=e["id"], ai=credit < 1.0 and svc.trap_hit(db, s, t, ans))
            r = {"task": svc.bank.pid(tid), "n": n, "points": pts, "max": svc.ege_points(n), "part": credit, "blank": blank, "mine": ans}
            if show and not blank:
                r["answer"] = t.get("ans", "")
            results.append(r)
        test = svc.ege_scale[min(primary, len(svc.ege_scale) - 1)]
        out = {"results": results, "primary": primary, "test": test, "spent": int(spent), "shown": show,
               "min_for_answers": svc.exam_min_sec_for_answers, "expired": expired}
        db.x("UPDATE exams SET finished=?, items=?, primary_score=?, test_score=?, result=? WHERE id=?",
             (e["started"] + spent, len(results), primary, test, json.dumps(out, ensure_ascii=False), e["id"]))
        svc.live_teacher(s)
        return self.send_json(dict(out, game=svc.game_summary(db, s["id"])))
