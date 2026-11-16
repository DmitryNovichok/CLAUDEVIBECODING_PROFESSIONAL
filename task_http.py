"""Student task actions: one access boundary and durable, serialised attempts.

The HTTP adapter supplies live dependencies; this module never imports server.
Python authored by a pupil is never executed here.
"""
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
import math
import time
from economy import atomic_response

TASK_ACTION_PATHS = frozenset(('/api/open', '/api/check', '/api/hint', '/api/reveal'))

@dataclass(frozen=True)
class TaskHTTPServices:
    app: Any
    opened: Any
    checks: Any
    think_sec: Any
    trap_k: Any
    work_reason: Any
    to_int: Any
    to_float: Any
    tokens: Any
    answer_credit: Any
    trap_hit: Any
    is_daily_of: Any
    answer_min_ms: Any
    last_attempt_skipped: Any
    game_summary: Any
    attempts_per_task: Any
    teacher_of: Any
    hints: Any
    clusters: Any
    strict_locked: Any


class TaskHTTPHandlers:
    def task_http_services(self):
        raise NotImplementedError

    def api_task_action(self, method, path, data):
        if path not in TASK_ACTION_PATHS or method != 'POST':
            return self.err(405, 'используйте POST')
        svc = self.task_http_services()
        pupil = self.student(data)
        if not pupil:
            return self.err(401, 'нужно войти')
        if not svc.app.bank.ensure():
            return self.err(503, 'банк заданий не собран')
        task = svc.app.bank.tasks.get(svc.app.bank.real(data.get('task')))
        if not task:
            return self.err(404, 'задание не найдено — обновите страницу')
        if path == '/api/hint':
            path, data = '/api/check', dict(data, hint=True)

        snapshot = {}
        def restore():
            # atomic_response invokes this after rollback while still holding
            # the DB lock, including when SQLite's final commit itself fails.
            with svc.opened.lock:
                for key, old in snapshot.items():
                    if old is None:
                        svc.opened.m.pop(key, None)
                    else:
                        svc.opened.m[key] = old

        def execute():
            # All standard task actions share the DB lock, including opening and
            # hints. Two simultaneous correct checks cannot both record a win.
            ids = [p['id'] for p in task['parts']] if task.get('parts') else [task['id']]
            keys = [(pupil['id'], tid) for tid in ids]
            with svc.opened.lock:
                snapshot.update({k: deepcopy(svc.opened.m.get(k)) for k in keys})
            if path == '/api/open':
                return self.api_open(pupil, task)
            if svc.strict_locked(svc.app.db, pupil, task.get('group') or task['id']):
                return self.err(403, 'Это задание из самостоятельной работы — ответ сдаётся в ней')
            if task.get('parts'):
                return self.err(400, 'вопросы 19–21 проверяются по отдельности')
            if path == '/api/reveal':
                return self.api_reveal(pupil, task)
            if data.get('hint'):
                return self.api_hint(pupil, task)
            return self.api_check(pupil, task, data)
        # atomic_response releases the DB lock before writing to the socket.
        # Request counters intentionally survive a rejected business action.
        return atomic_response(self, svc.app.db, execute, after_rollback=restore)

    def api_open(self, s, t):
        """Ученик открыл задание: с этого момента идёт время на раздумье.
        Открыл заново, не закончив после неверной попытки, — попытки не обнуляются: ученик продолжает
        с того же места (в подборке можно уйти к другому заданию и вернуться). Новых попыток так не получить."""
        svc = self.task_http_services()
        ids = [p["id"] for p in t["parts"]] if t.get("parts") else [t["id"]]
        used = {}
        for tid in ids:
            st = svc.opened.get(s["id"], tid, create=False)
            if st and st["final"] is None and st["tries"]:
                used[svc.app.bank.pid(tid)] = len(st["tries"])      # уже была неверная попытка — продолжаем с неё
            elif st is None or st["final"] is not None:
                svc.opened.reset(s["id"], tid)
            # открыто и ещё без ответа (например, перезагрузили страницу) — время открытия не сбрасываем
        st = svc.opened.get(s["id"], ids[0])
        return self.send_json({"ok": True, "think": svc.think_sec(t.get("n")), "tries": used, "trap": svc.trap_k(svc.app.db, s, t),
                               "think_left": max(0, math.ceil(st["ts"] + svc.think_sec(t.get("n")) - time.time()))})


    def api_check(self, s, t, data):
        svc = self.task_http_services()
        st = svc.opened.get(s["id"], t["id"])
        if st["final"] is not None:          # повтор того же запроса (например, после обрыва связи)
            return self.send_json(st["final"])
        st["reason"] = str(data.get("reason") or "")[:20]
        if st["reason"] == svc.work_reason:            # эту метку ставит только сервер при сдаче контрольной
            st["reason"] = "asg"
        st["rk"] = str(data.get("rk") or "")[:200] or None
        spent = data.get("spent_ms")
        spent = int(spent) if isinstance(spent, (int, float)) and 0 <= spent < 864e5 else None
        srv = (time.time() - st["ts"]) * 1000          # сколько прошло с открытия задания по часам сервера
        if srv >= 1000:
            spent = int(min(spent, srv)) if spent is not None else int(srv)
        away = svc.to_int(data.get("away"))
        st["away"] = min(max(away or 0, st.get("away") or 0), 999)
        st["away_sec"] = min(max(svc.to_float(data.get("away_sec")), st.get("away_sec") or 0, 0), 86400)
        # сколько секунд назад ученик вернулся после долгого (30+ с) ухода; None — долгих уходов не было
        back = data.get("back_sec")
        st["back_sec"] = round(min(max(float(back), 0), 86400), 1) if isinstance(back, (int, float)) else None
        st["paste"] = bool(st.get("paste") or data.get("paste"))
        n = t.get("n") or 0

        if data.get("abandoned"):
            if not st["tries"]:              # пропустил, не отвечая, — без штрафа
                svc.opened.reset(s["id"], t["id"])
                return self.send_json({"ok": True, "skipped": True})
            self.log_attempt(s, t, st["tries"], 0.0, abandoned=True, reason=st["reason"], rk=st["rk"],
                             part=st.get("part"), spent=spent, away=st["away"], st=st)
            st["final"] = {"correct": False, "final": True, "score": 0.0}
            return self.send_json(st["final"])

        gave_up = bool(data.get("gave_up"))
        if not gave_up:
            ans = str(data.get("answer") or "")[:400]
            if not svc.tokens(ans):
                return self.err(400, "Пустой ответ")
            stop = svc.checks.hit(s["id"], t["id"])
            if stop:
                return self.err(429, stop)
            cells = data.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            st["tries"].append(ans)
            credit = svc.answer_credit(n, t.get("ans", ""), ans, cells)
            if credit < 1.0 and svc.trap_hit(svc.app.db, s, t, ans):
                st["trap"] = True
            if len(st["tries"]) == 1:
                st["part"] = credit          # на экзамене попытка одна — частичный балл считаем по первой
            if credit == 1.0:
                score = 1.0 if len(st["tries"]) == 1 and not st.get("hints") else 0.5      # с подсказкой — как со 2-й
                daily_fast = score == 1.0 and svc.is_daily_of(s["id"], t["id"]) and self.daily_result(s, t, st)
                self.log_attempt(s, t, st["tries"], score, reason=st["reason"], rk=st["rk"], part=st["part"],
                                 revealed=1, spent=spent, away=st["away"], st=st)
                st["final"] = self.with_answer_s(s, {"correct": True, "final": True, "score": score, "part": st["part"],
                                                     "fast": spent is not None and spent < svc.answer_min_ms(n, time.time()),
                                                     "fast_min": svc.answer_min_ms(n, time.time()) // 60000,
                                                     "nocount": svc.last_attempt_skipped(svc.app.db, s["id"])}, t)
                if daily_fast:
                    st["final"]["daily_fast"] = True
                return self.send_json(dict(st["final"], game=svc.game_summary(svc.app.db, s["id"])))
            if len(st["tries"]) < svc.attempts_per_task:
                return self.send_json({"correct": False, "final": False, "attempts_left": svc.attempts_per_task - len(st["tries"]),
                                       "half": credit == 0.5})

        # итог «не решено»: исчерпаны попытки или «Показать ответ»
        block = self.reveal_block(s, t, st)
        part = st.get("part", 0.0) if st["tries"] else 0.0
        aid = self.log_attempt(s, t, st["tries"], 0.0, gave_up=gave_up, reason=st["reason"], rk=st["rk"],
                               part=part, revealed=0 if block else 1, spent=spent, away=st["away"], st=st)
        self.log_reveal(s, t, block)
        res = {"correct": False, "final": True, "score": 0.0, "part": part}
        if block:
            res["hidden"] = block
        else:
            res = self.with_answer_s(s, res, t)
        st["final"] = res
        st["aid"] = aid
        return self.send_json(res)


    def api_hint(self, s, t):
        """Следующая подсказка (1 — идея, 2 — план). С подсказкой верный ответ засчитывается как со второй попытки."""
        svc = self.task_http_services()
        if not svc.teacher_of(s)["hints"]:
            return self.err(403, "Подсказки выключены учителем")
        st = svc.opened.get(s["id"], t["id"])
        if st["final"] is not None:
            return self.err(409, "Задание уже решено")
        step = min(2, (st.get("hints") or 0) + 1)
        text = svc.hints.hint(t.get("n"), step)
        if not text:
            return self.err(404, "Для этого номера подсказок нет")
        st["hints"] = step
        kind = svc.clusters.labels(t.get("n")) if t.get("n") else []
        label = dict(kind).get(t.get("c"), "") if kind else ""
        return self.send_json({"step": step, "of": 2, "title": "Идея" if step == 1 else "План решения",
                               "type": label if step == 1 else "", "text": text})


    def api_reveal(self, s, t):
        """Ответ был скрыт (рано или исчерпан лимит) — показать, если теперь можно."""
        svc = self.task_http_services()
        st = svc.opened.get(s["id"], t["id"], create=False)
        if not st or not st["final"]:
            return self.err(409, "Ответ открывается после попыток или кнопки «Показать ответ»")
        if not st["final"].get("hidden"):
            return self.send_json(st["final"])
        block = self.reveal_block(s, t, st)
        self.log_reveal(s, t, block)
        if block:
            return self.send_json({"hidden": block})
        st["final"] = self.with_answer_s(s, st["final"], t)
        if st.get("aid"):
            svc.app.db.x("UPDATE attempts SET revealed=1 WHERE id=?", (st["aid"],))
        return self.send_json(st["final"])
