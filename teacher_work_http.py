"""Teacher classes, assigned work and class results at the HTTP boundary.

The server injects live dependencies; importing this module starts no application.
The common teacher gate and transaction selection stay in Handler.api. Every
resource still checks class ownership here, including archives and live results.
GET/POST read aliases and existing write-method errors are retained deliberately.
"""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping
import json
import re
import time
import lab13


TEACHER_WORK_ROUTES = MappingProxyType({
    ('GET', '/api/admin/classes'): 'teacher_classes',
    ('POST', '/api/admin/classes'): 'teacher_classes',
    ('POST', '/api/admin/class/goal'): 'teacher_class_goal',
    ('POST', '/api/admin/class/save'): 'teacher_class_save',
    ('POST', '/api/admin/class/delete'): 'teacher_class_delete',
    ('POST', '/api/admin/class/members'): 'teacher_class_members',
    ('GET', '/api/admin/class/stats'): 'teacher_class_stats',
    ('POST', '/api/admin/class/stats'): 'teacher_class_stats',
    ('GET', '/api/admin/assignments'): 'teacher_assignments',
    ('POST', '/api/admin/assignments'): 'teacher_assignments',
    ('GET', '/api/admin/class/journal'): 'teacher_class_journal',
    ('POST', '/api/admin/class/journal'): 'teacher_class_journal',
    ('GET', '/api/admin/class/digest'): 'teacher_class_digest',
    ('POST', '/api/admin/class/digest'): 'teacher_class_digest',
    ('POST', '/api/admin/class/weak'): 'teacher_class_weak',
    ('POST', '/api/admin/batch/kind'): 'teacher_batch_kind',
    ('POST', '/api/admin/batch/due'): 'teacher_batch_due',
    ('POST', '/api/admin/batch/delete'): 'teacher_batch_delete',
    ('POST', '/api/admin/assignment/save'): 'teacher_assignment_save',
    ('POST', '/api/admin/assignment/lab13'): 'teacher_lab13_assign',
    ('POST', '/api/admin/assignment/delete'): 'teacher_assignment_delete',
    ('GET', '/api/admin/asg/all'): 'teacher_asg_all',
    ('POST', '/api/admin/asg/all'): 'teacher_asg_all',
    ('GET', '/api/admin/asg/tasks'): 'teacher_asg_tasks',
    ('POST', '/api/admin/asg/tasks'): 'teacher_asg_tasks',
    ('GET', '/api/admin/asg/archive'): 'teacher_asg_archive',
    ('POST', '/api/admin/asg/archive'): 'teacher_asg_archive',
    ('GET', '/api/admin/asg/live'): 'teacher_asg_live_or_close',
    ('POST', '/api/admin/asg/live'): 'teacher_asg_live_or_close',
    ('GET', '/api/admin/asg/close'): 'teacher_asg_live_or_close',
    ('POST', '/api/admin/asg/close'): 'teacher_asg_live_or_close',
})
TEACHER_WORK_PATHS = frozenset(path for _, path in TEACHER_WORK_ROUTES)


@dataclass(frozen=True)
class TeacherWorkServices:
    """Explicit live services, refreshed for each request; no cached server state."""
    db: Any
    bank: Any
    clusters: Any
    kinds: Mapping[str, str]
    grades: Mapping
    asg_archive_html: Callable
    asg_cell: Callable
    asg_cutoff: Callable
    asg_expire: Callable
    asg_finish_run: Callable
    asg_grading: Callable
    asg_items: Callable
    asg_score: Callable
    asg_task_rows: Callable
    assignment_done: Callable
    batch_title: Callable
    class_digest: Callable
    exam_summary: Callable
    forecast_trend: Callable
    live_class: Callable
    main_teacher: Callable
    n_key: Callable
    practice_score: Callable
    teacher_asg_archive: Callable
    to_float: Callable
    to_int: Callable
    weak_sets: Callable
    week_start: Callable


class TeacherWorkHandlers:
    def teacher_work_services(self):
        raise NotImplementedError

    def teacher_work_route(self, method, path, qs, data):
        target = TEACHER_WORK_ROUTES.get((method, path))
        if target is None:
            return self.err(404, "нет такого метода")
        return getattr(self, target)(method, path, qs, data)

    def teacher_classes(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        main_id = svc.main_teacher()["id"]
        ccond = "COALESCE(c.teacher_id, ?) = ?"                 # только свои классы, и у главного тоже
        cargs = (main_id, self.T["id"])
        rows = db.q(f"""SELECT c.id, c.name, c.created, COALESCE(c.teacher_id, ?) AS teacher_id, t.name AS teacher,
                              c.goal_tasks, c.goal_reward, COALESCE(c.battle, 0) AS battle,
                              (SELECT COUNT(*) FROM attempts a JOIN students s2 ON s2.id = a.student_id
                               WHERE s2.class_id = c.id AND a.score > 0 AND a.ts >= {svc.week_start()}) AS week_solved,
                              COUNT(s.id) AS students FROM classes c
                       LEFT JOIN students s ON s.class_id = c.id
                       LEFT JOIN teachers t ON t.id = COALESCE(c.teacher_id, ?)
                       WHERE {ccond} GROUP BY c.id ORDER BY t.is_main DESC, t.name, c.name""", (main_id, main_id, *cargs))
        cond, args = self.student_scope()
        free = db.q(f"SELECT COUNT(*) c FROM students s WHERE class_id IS NULL AND {cond}", args, one=True)["c"]
        return self.send_json({"classes": [dict(r) for r in rows], "unassigned": free})

    def teacher_class_goal(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # битва классов: цель на неделю (сколько заданий решить) и награда, которую обещает учитель
        cid = svc.to_int(data.get("id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        goal = max(0, min(svc.to_int(data.get("goal_tasks")) or 0, 100000))
        reward = re.sub(r"\s+", " ", str(data.get("goal_reward") or "")).strip()[:120]
        battle = 1 if data.get("battle") else 0
        db.x("UPDATE classes SET goal_tasks=?, goal_reward=?, battle=? WHERE id=?", (goal or None, reward or None, battle, cid))
        return self.send_json({"ok": True, "goal_tasks": goal, "goal_reward": reward, "battle": bool(battle)})

    def teacher_class_save(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        now = time.time()
        name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()[:40]
        if not name:
            return self.err(400, "Введите название класса, например «11А»")
        cid = svc.to_int(data.get("id"))
        if cid:
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            db.x("UPDATE classes SET name=? WHERE id=?", (name, cid))
        else:
            cid = db.x("INSERT INTO classes(name, created, teacher_id) VALUES(?,?,?)", (name, now, self.T["id"]))
        return self.send_json({"ok": True, "id": cid})

    def teacher_class_delete(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        cid = svc.to_int(data.get("id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        db.x("UPDATE students SET class_id=NULL WHERE class_id=?", (cid,))      # ученики возвращаются в «нераспределённые»
        db.x("DELETE FROM assignments WHERE class_id=?", (cid,))
        db.x("DELETE FROM classes WHERE id=?", (cid,))
        return self.send_json({"ok": True})

    def teacher_class_members(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        cid = svc.to_int(data.get("class_id")) or None
        if cid and not self.sees_class(cid):
            return self.err(404, "класс не найден")
        ids = [svc.to_int(i) for i in (data.get("students") or []) if svc.to_int(i) and self.sees_student(svc.to_int(i))][:500]
        # ученик в классе — ученик учителя этого класса (главный может так передать ученика другому учителю)
        owner = db.q("SELECT teacher_id FROM classes WHERE id=?", (cid,), one=True)["teacher_id"] if cid else None
        for sid in ids:
            if owner:
                db.x("UPDATE students SET class_id=?, teacher_id=? WHERE id=?", (cid, owner, sid))
            else:
                db.x("UPDATE students SET class_id=? WHERE id=?", (cid, sid))
        return self.send_json({"ok": True, "moved": len(ids)})

    def teacher_class_stats(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        now = time.time()
        # статистика класса за период (урок, день, неделя) — по всем заданиям или по одной подборке: для оценок
        cid = svc.to_int(qs.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        try:
            t0, t1 = float(qs.get("from") or 0), float(qs.get("to") or now)
        except ValueError:
            return self.err(400, "неверный период")
        members = db.q("SELECT id, name FROM students WHERE class_id=? ORDER BY name", (cid,))
        asg_tasks = None
        aid = svc.to_int(qs.get("asg"))
        if aid:
            a = db.q("SELECT tasks FROM assignments WHERE id=? AND class_id=?", (aid, cid), one=True)
            if not a:
                return self.err(404, "подборка не найдена")
            asg_tasks = json.loads(a["tasks"] or "[]")
        rows = {}
        if members:
            ids = [m["id"] for m in members]
            cond, args = f"student_id IN ({','.join('?' * len(ids))}) AND ts>=? AND ts<? AND exam IS NULL", (*ids, t0, t1)
            if asg_tasks is not None:
                qm = ",".join("?" * len(asg_tasks)) or "NULL"
                cond += f" AND (task_id IN ({qm}) OR grp IN ({qm}))"
                args += (*asg_tasks, *asg_tasks)
            for r in db.q(f"""SELECT student_id, COUNT(*) AS answers, COUNT(DISTINCT COALESCE(grp, task_id)) AS tasks,
                                     SUM(score = 1) AS ok1, SUM(score = 0.5) AS ok2, SUM(score = 0) AS bad,
                                     SUM(score = 0 AND gave_up = 1 AND revealed = 1) AS shown,
                                     COUNT(DISTINCT CASE WHEN score > 0 THEN COALESCE(grp, task_id) END) AS solved,
                                     SUM(COALESCE(spent_ms, 0)) AS spent, SUM(COALESCE(away, 0)) AS away,
                                     SUM(',' || COALESCE(flags, '') || ',' LIKE '%,sus,%') AS sus,
                                     SUM(',' || COALESCE(flags, '') || ',' LIKE '%,paste,%') AS paste,
                                     SUM(',' || COALESCE(flags, '') || ',' LIKE '%,ai,%') AS ai,
                                     MIN(ts) AS first, MAX(ts) AS last, GROUP_CONCAT(DISTINCT n) AS nums
                              FROM attempts WHERE {cond} GROUP BY student_id""", args):
                rows[r["student_id"]] = dict(r)
            for r in db.q(f"""SELECT student_id, MAX(test_score) AS exam FROM exams WHERE finished>=? AND finished<?
                              AND student_id IN ({','.join('?' * len(ids))}) GROUP BY student_id""", (t0, t1, *ids)):
                rows.setdefault(r["student_id"], {})["exam"] = r["exam"]
            # вне тренажёра за период: все уходы со страницы (и в заданиях, и в варианте)
            for r in db.q(f"""SELECT student_id, COUNT(*) AS c, SUM(dur) AS sec FROM activity WHERE kind = 'away'
                              AND ts>=? AND ts<? AND student_id IN ({','.join('?' * len(ids))}) GROUP BY student_id""", (t0, t1, *ids)):
                rows.setdefault(r["student_id"], {}).update(out_n=r["c"], out_sec=round(r["sec"] or 0))
        out = []
        for m in members:
            r = rows.get(m["id"], {})
            nums = sorted({int(x) for x in str(r.get("nums") or "").split(",") if x.strip().isdigit()})
            out.append({"id": m["id"], "name": m["name"], "answers": r.get("answers") or 0, "tasks": r.get("tasks") or 0,
                        "solved": r.get("solved") or 0, "ok1": r.get("ok1") or 0, "ok2": r.get("ok2") or 0,
                        "bad": r.get("bad") or 0, "shown": r.get("shown") or 0, "spent": r.get("spent") or 0,
                        "away": r.get("away") or 0, "first": r.get("first"), "last": r.get("last"), "nums": nums,
                        "exam": r.get("exam"), "sus": r.get("sus") or 0, "paste": r.get("paste") or 0, "ai": r.get("ai") or 0,
                        "out_n": r.get("out_n") or 0, "out_sec": r.get("out_sec") or 0})
        return self.send_json({"rows": out, "asg_total": len(asg_tasks) if asg_tasks is not None else None})

    def teacher_assignments(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        cid = svc.to_int(qs.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        svc.bank.ensure()
        members = db.q("SELECT id, name FROM students WHERE class_id=? ORDER BY name", (cid,))
        svc.asg_expire(self, db, cid)
        out = []
        batches = {}
        for a in db.q("SELECT * FROM assignments WHERE class_id=? AND student_id IS NOT NULL ORDER BY created DESC", (cid,)):
            real = json.loads(a["tasks"] or "[]")
            b = batches.setdefault(a["batch"] or f"one:{a['id']}", {"batch": a["batch"] or f"one:{a['id']}", "title": svc.batch_title(a),
                                                                   "kind": a["kind"], "created": a["created"], "due": a["due"],
                                                                   "students": 0, "done": 0, "tasks": 0, "ids": [], "closed": 0})
            b["ids"].append(a["id"])
            b["closed"] += bool(a["closed"])
            if a["due"] and (not b["due"] or a["due"] > b["due"]):
                b["due"] = a["due"]                 # у кого-то продлён — показываем самый поздний срок
            b["students"] += 1
            b["tasks"] += len(real)
            b["done"] += len(svc.assignment_done(db, a["student_id"], real, a["created"], svc.asg_cutoff(a))) >= len(real) > 0
        for a in db.q("SELECT * FROM assignments WHERE class_id=? AND student_id IS NULL ORDER BY created DESC", (cid,)):
            real = json.loads(a["tasks"] or "[]")
            if a["kind"] == "lab13":
                prog = [dict(r) for r in db.q("""SELECT s.id, s.name, r.started, r.finished, (r.finished IS NOT NULL) AS done
                                 FROM students s LEFT JOIN asg_runs r ON r.student_id=s.id AND r.asg_id=?
                                 WHERE s.class_id=? AND COALESCE(s.is_teacher, 0)=0 ORDER BY s.name""", (a["id"], cid))]
            else:
                prog = [{"id": m["id"], "name": m["name"], "done": len(svc.assignment_done(db, m["id"], real, a["created"], svc.asg_cutoff(a)))}
                        for m in members]
            out.append({"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                        "strict": bool(a["strict"]), "kind": a["kind"] or "self", "closed": a["closed"], "grading": svc.asg_grading(a),
                        "tasks": [{"id": i, "n": (svc.bank.tasks.get(i) or {}).get("n"),
                                   "c": (svc.bank.tasks.get(i) or {}).get("c"), "r": (svc.bank.tasks.get(i) or {}).get("r"),
                                   "cname": dict(svc.clusters.labels((svc.bank.tasks.get(i) or {}).get("n"))).get((svc.bank.tasks.get(i) or {}).get("c"), ""),
                                   "snip": svc.bank.snippet(i), "missing": i not in svc.bank.tasks} for i in real],
                        "progress": prog})
        return self.send_json({"assignments": out, "batches": list(batches.values())})

    def teacher_class_journal(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # журнал класса: оценки по всем подборкам и точность по номерам ЕГЭ у каждого ученика
        cid = svc.to_int(qs.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        svc.bank.ensure()
        members = db.q("""SELECT id, name, forecast, fc FROM students WHERE class_id=? AND COALESCE(is_teacher, 0) = 0
                          ORDER BY name""", (cid,))
        svc.asg_expire(self, db, cid)
        cols, cells = [], {m["id"]: {} for m in members}
        by_batch = {}
        for a in db.q("SELECT * FROM assignments WHERE class_id=? ORDER BY created", (cid,)):
            real = [i for i in json.loads(a["tasks"] or "[]") if i in svc.bank.tasks]
            if a["student_id"]:
                # личные подборки одной серии (работа над ошибками, слабые места) — одна колонка
                key = "b:" + (a["batch"] or str(a["id"]))
                if key not in by_batch:
                    by_batch[key] = {"id": key, "title": svc.batch_title(a), "kind": a["kind"] or "practice", "created": a["created"],
                                     "due": a["due"], "closed": a["closed"], "total": len(svc.asg_items(real)), "personal": True}
                    cols.append(by_batch[key])
                if a["student_id"] in cells:
                    cells[a["student_id"]][key] = dict(svc.asg_cell(db, a, a["student_id"], real), asg=a["id"], total=len(svc.asg_items(real)))
                continue
            cols.append({"id": a["id"], "title": a["title"], "kind": a["kind"] or "self", "created": a["created"],
                         "due": a["due"], "closed": a["closed"], "total": 1 if a["kind"] == "lab13" else len(svc.asg_items(real))})
            for m in members:
                cells[m["id"]][a["id"]] = svc.asg_cell(db, a, m["id"], real)
        ids = [m["id"] for m in members]
        nums = {}
        if ids:
            # точность по номерам — первая попытка в тренажёре и подборках, без вариантов ЕГЭ
            for r in db.q(f"""SELECT student_id, n, COUNT(*) AS a, SUM(score = 1) AS ok FROM attempts
                              WHERE student_id IN ({','.join('?' * len(ids))}) AND n IS NOT NULL AND exam IS NULL
                              AND COALESCE(gave_up, 0) = 0 GROUP BY student_id, n""", ids):
                cur = nums.setdefault(r["student_id"], {}).setdefault(svc.n_key(r["n"]), [0, 0])
                cur[0] += r["a"]
                cur[1] += r["ok"] or 0
        return self.send_json({"assignments": cols, "students": [{"id": m["id"], "name": m["name"], "cells": cells[m["id"]],
                                                                  "nums": nums.get(m["id"], {}), "fc": svc.forecast_trend(m),
                                                                  "exam": svc.exam_summary(db, m["id"])}
                                                                 for m in members]})

    def teacher_class_digest(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # сводка недели: кто не занимался, у кого просели номера, кто не сдал работы, кто молодец
        cid = svc.to_int(qs.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        svc.bank.ensure()
        svc.asg_expire(self, db, cid)
        return self.send_json(svc.class_digest(db, cid))

    def teacher_class_weak(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # каждому ученику — своя практическая подборка: по N заданий на его K самых слабых номеров
        cid = svc.to_int(data.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        if not svc.bank.ensure():
            return self.err(503, "банк заданий не собран")
        per = min(max(svc.to_int(data.get("per")) or 3, 1), 10)
        k = min(max(svc.to_int(data.get("nums")) or 3, 1), 5)
        days = min(max(svc.to_int(data.get("days")) or 7, 1), 60)
        made, skipped = svc.weak_sets(db, cid, per, k, days, bool(self.T["authored"]))
        return self.send_json({"ok": True, "made": made, "skipped": skipped})

    def teacher_batch_kind(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # тип личной подборки (персональной, работы над ошибками, слабых мест) — сразу у всех учеников пачки;
        # самостоятельная → практическая/домашняя: начатые сдаются по уже данным ответам, как у подборки класса
        cid = svc.to_int(data.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        kind = data.get("kind")
        if kind not in svc.kinds:
            return self.err(400, "неизвестный тип работы")
        batch = str(data.get("batch") or "")
        rows = (db.q("SELECT * FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (svc.to_int(batch[4:]), cid))
                if batch.startswith("one:") else
                db.q("SELECT * FROM assignments WHERE batch=? AND class_id=? AND student_id IS NOT NULL", (batch, cid)))
        if not rows:
            return self.err(404, "подборка не найдена")
        if any(a["kind"] == "lab13" for a in rows):
            return self.err(409, "Тип лабораторной изменить нельзя")
        svc.bank.ensure()
        ended = 0
        for a in rows:
            if a["strict"] and kind != "self":
                real = [i for i in json.loads(a["tasks"] or "[]") if i in svc.bank.tasks]
                for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (a["id"],)):
                    st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                    if st:
                        svc.asg_finish_run(self, db, a, st, real, forced=1)
                        ended += 1
            db.x("UPDATE assignments SET kind=?, strict=? WHERE id=?", (kind, 1 if kind == "self" else 0, a["id"]))
        svc.live_class(db, cid, [a["student_id"] for a in rows])
        return self.send_json({"ok": True, "changed": len(rows), "ended": ended})

    def teacher_batch_due(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        now = time.time()
        # перенести срок личной подборки: у всех учеников пачки или у одного (asg_id); закрытые по сроку снова открываются
        cid = svc.to_int(data.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        due = svc.to_float(data.get("due")) or None
        if due and due < now:
            return self.err(400, "Этот срок уже прошёл — выберите сегодняшнюю или более позднюю дату")
        batch, one = str(data.get("batch") or ""), svc.to_int(data.get("asg_id"))
        if one:
            rows = db.q("SELECT * FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (one, cid))
        elif batch.startswith("one:"):
            rows = db.q("SELECT * FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (svc.to_int(batch[4:]), cid))
        else:
            rows = db.q("SELECT * FROM assignments WHERE batch=? AND class_id=? AND student_id IS NOT NULL", (batch, cid))
        if not rows:
            return self.err(404, "подборка не найдена")
        reopened = 0
        for a in rows:
            db.x("UPDATE assignments SET due=? WHERE id=?", (due, a["id"]))
            # закрытую по сроку (closed = прежний срок) открываем снова; закрытую учителем вручную — не трогаем
            if a["closed"] and a["due"] and a["closed"] == a["due"]:
                db.x("UPDATE assignments SET closed=NULL WHERE id=?", (a["id"],))
                reopened += 1
        svc.live_class(db, cid, [a["student_id"] for a in rows])
        return self.send_json({"ok": True, "changed": len(rows), "reopened": reopened})

    def teacher_batch_delete(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        cid = svc.to_int(data.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        batch = str(data.get("batch") or "")
        if batch.startswith("one:"):
            db.x("DELETE FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (svc.to_int(batch[4:]), cid))
        else:
            db.x("DELETE FROM assignments WHERE batch=? AND class_id=? AND student_id IS NOT NULL", (batch, cid))
        return self.send_json({"ok": True})

    def teacher_lab13_assign(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db, cid = svc.db, data.get("class_id")
        if type(cid) is not int or not (0 < cid < 2**63):
            return self.err(400, "Выберите класс")
        if not self.sees_class(cid):
            return self.err(404, "Класс не найден")
        request_id, due = data.get("request_id"), data.get("due")
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9_.~-]{8,80}", request_id):
            return self.err(400, "Некорректный идентификатор запроса")
        if due is not None and (type(due) not in (int, float) or not 0 < due <= 253402300799):
            return self.err(400, "Проверьте срок сдачи")
        key = f"{self.T['id']}:{request_id}"
        previous = db.q("SELECT id,class_id,lab_request_due FROM assignments WHERE lab_request_key=?", (key,), one=True)
        if previous:
            if previous["class_id"] != cid or previous["lab_request_due"] != due:
                return self.err(409, "Этот запрос уже использован для другого назначения")
            return self.send_json({"ok": True, "id": previous["id"]})
        now = time.time()
        if due is not None and due <= now:
            return self.err(400, "Срок сдачи уже прошёл")
        aid = db.x("""INSERT INTO assignments(class_id,title,tasks,created,due,strict,kind,lab_request_key,lab_request_due)
                      VALUES(?,?,'[]',?,?,0,'lab13',?,?)""", (cid, lab13.TITLE, now, due, key, due))
        self._notify_lab13 = lambda: svc.live_class(db, cid)
        return self.send_json({"ok": True, "id": aid})

    def teacher_assignment_save(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        now = time.time()
        cid = svc.to_int(data.get("class_id"))
        if not self.sees_class(cid):
            return self.err(404, "класс не найден")
        aid = svc.to_int(data.get("id"))
        if aid:
            old = db.q("SELECT strict, kind, tasks FROM assignments WHERE id=? AND class_id=?", (aid, cid), one=True)
            if not old:
                return self.err(404, "подборка не найдена в этом классе")
            if old["kind"] == "lab13":
                return self.err(409, "Состав и тип лабораторной изменить нельзя")
        if data.get("kind") == "lab13":
            return self.err(400, "Назначьте лабораторную из раздела лабораторий")
        title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip()[:80]
        if not title:
            return self.err(400, "Введите название подборки")
        svc.bank.ensure()
        tasks = []
        for i in data.get("tasks") or []:
            i = str(i)
            i = (svc.bank.tasks.get(i) or {}).get("group") or i      # вопрос 19–21 — в подборку идёт вся игра
            if i in svc.bank.tasks and i not in tasks:
                tasks.append(i)
        if not tasks:
            return self.err(400, "В подборке нет ни одного задания")
        tasks = tasks[:100]
        due = svc.to_float(data.get("due")) or None
        if due and not aid and due < now:
            return self.err(400, "Срок уже прошёл — выберите сегодняшнюю или более позднюю дату")
        kind = data.get("kind") if data.get("kind") in svc.kinds else "self"
        strict = 1 if kind == "self" else 0      # самостоятельная — проверка после сдачи; практическая и домашняя — сразу
        g = data.get("grading") if isinstance(data.get("grading"), dict) else {}
        grading = json.dumps({k: max(0, min(100, svc.to_int(g.get(k, v)))) for k, v in svc.grades.items()})
        if aid:
            ended = 0
            if old["strict"] and db.q("SELECT 1 FROM asg_runs WHERE asg_id=? LIMIT 1", (aid,), one=True):
                if json.loads(old["tasks"]) != tasks:
                    return self.err(409, "Самостоятельную уже начали писать — состав заданий менять нельзя")
                if kind != "self":
                    # самостоятельная → практическая/домашняя: начатые сдаются по уже данным ответам (попадают в журнал),
                    # дальше ученики решают как обычную подборку
                    full = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
                    real = [i for i in tasks if i in svc.bank.tasks]
                    for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (aid,)):
                        st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                        if st:
                            svc.asg_finish_run(self, db, full, st, real, forced=1)
                            ended += 1
            prev = db.q("SELECT closed, due FROM assignments WHERE id=?", (aid,), one=True)
            db.x("UPDATE assignments SET title=?, tasks=?, due=?, strict=?, grading=?, kind=? WHERE id=? AND class_id=?",
                 (title, json.dumps(tasks), due, strict, grading, kind, aid, cid))
            # продлили срок у работы, закрытой по сроку (closed = прежний срок), — она снова открыта;
            # закрытую учителем вручную не трогаем
            if prev and prev["closed"] and prev["due"] and prev["closed"] == prev["due"] and (not due or due > now):
                db.x("UPDATE assignments SET closed=NULL WHERE id=?", (aid,))
            svc.live_class(db, cid)
            return self.send_json({"ok": True, "id": aid, "ended": ended})
        elif data.get("students"):
            # персональная подборка: только выбранным ученикам класса (у каждого своя, в журнале — одна колонка)
            want = {svc.to_int(x) for x in data.get("students") or []}
            members = [r["id"] for r in db.q("SELECT id FROM students WHERE class_id=? AND COALESCE(is_teacher, 0)=0", (cid,))
                       if r["id"] in want]
            if not members:
                return self.err(400, "Выберите хотя бы одного ученика этого класса")
            batch = f"own:{int(now * 1000)}"
            for sid in members:
                aid = db.x("""INSERT INTO assignments(class_id,title,tasks,created,due,strict,grading,kind,student_id,batch)
                              VALUES(?,?,?,?,?,?,?,?,?,?)""", (cid, title, json.dumps(tasks), now, due, strict, grading, kind, sid, batch))
            svc.live_class(db, cid, members)
            return self.send_json({"ok": True, "id": aid, "personal": len(members)})
        else:
            aid = db.x("INSERT INTO assignments(class_id,title,tasks,created,due,strict,grading,kind) VALUES(?,?,?,?,?,?,?,?)",
                       (cid, title, json.dumps(tasks), now, due, strict, grading, kind))
        svc.live_class(db, cid)
        return self.send_json({"ok": True, "id": aid})

    def teacher_assignment_delete(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        a = db.q("SELECT class_id FROM assignments WHERE id=?", (svc.to_int(data.get("id")),), one=True)
        if not a or not self.sees_class(a["class_id"]):
            return self.err(404, "подборка не найдена")
        db.x("DELETE FROM assignments WHERE id=?", (svc.to_int(data.get("id")),))
        db.x("DELETE FROM asg_runs WHERE asg_id=?", (svc.to_int(data.get("id")),))
        svc.live_class(db, a["class_id"])
        return self.send_json({"ok": True})

    def teacher_asg_all(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # архив выданных подборок: все классы учителя, поиск по названию и классу
        svc.bank.ensure()
        cid = svc.to_int(qs.get("class_id"))
        if cid and not self.sees_class(cid):
            return self.err(404, "класс не найден")
        return self.send_json({"items": svc.teacher_asg_archive(db, self.T["id"], qs.get("q") or "", cid)})

    def teacher_asg_tasks(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # задания одной выданной подборки — чтобы отправить её снова (другому классу или ученикам)
        svc.bank.ensure()
        a = db.q("SELECT * FROM assignments WHERE id=?", (svc.to_int(qs.get("id")),), one=True)
        if not a or not self.sees_class(a["class_id"]):
            return self.err(404, "подборка не найдена")
        ids = json.loads(a["tasks"] or "[]")
        rows = svc.asg_task_rows(ids)
        return self.send_json({"id": a["id"], "title": svc.batch_title(a) if a["student_id"] else a["title"], "kind": a["kind"] or "self",
                               "tasks": rows, "missing": len(ids) - len(rows)})

    def teacher_asg_archive(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        # архив работ для печати / PDF: одна подборка (id) или личные подборки пачки (ids=1,2,3)
        ids = [svc.to_int(x) for x in str(qs.get("ids") or qs.get("id") or "").split(",") if svc.to_int(x)]
        ok = [i for i in ids if (lambda a: a and self.sees_class(a["class_id"]))(
            db.q("SELECT class_id FROM assignments WHERE id=?", (i,), one=True))]
        body = svc.asg_archive_html(db, self.T, ok) if ok else None
        if not body:
            return self.err(404, "подборка не найдена")
        return self.send_bytes(200, body.encode("utf-8"), "text/html; charset=utf-8", {"Cache-Control": "no-store"})

    def teacher_asg_live_or_close(self, method, path, qs, data):
        svc = self.teacher_work_services()
        db = svc.db
        now = time.time()
        # контрольная онлайн: кто пишет, сколько сдал, сколько верно; «Завершить для всех»
        aid = svc.to_int(qs.get("id") or data.get("id"))
        a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
        if not a or not self.sees_class(a["class_id"]):
            return self.err(404, "подборка не найдена")
        svc.bank.ensure()
        real = [i for i in json.loads(a["tasks"] or "[]") if i in svc.bank.tasks]
        if path == "/api/admin/asg/close":
            if method != "POST":
                return self.err(405, "нужен POST")
            if data.get("reopen"):
                # открыть снова: прошедший срок снимаем, иначе работа тут же закроется по сроку
                db.x("UPDATE assignments SET closed=NULL, due=CASE WHEN due < ? THEN NULL ELSE due END WHERE id=?", (now, aid))
                svc.live_class(db, a["class_id"])
                return self.send_json({"ok": True})
            db.x("UPDATE assignments SET closed=? WHERE id=?", (now, aid))
            if a["kind"] == "lab13":
                svc.live_class(db, a["class_id"])
                return self.send_json({"ok": True, "finished": 0})
            a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
            n = 0
            for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (aid,)):
                st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                if st:
                    svc.asg_finish_run(self, db, a, st, real, forced=1)
                    n += 1
            svc.live_class(db, a["class_id"])
            return self.send_json({"ok": True, "finished": n})
        if a["kind"] == "lab13":
            rows = []
            for m in db.q("SELECT id, name FROM students WHERE class_id=? AND COALESCE(is_teacher, 0)=0 ORDER BY name", (a["class_id"],)):
                cell = svc.asg_cell(db, a, m["id"], [])
                rows.append({"id": m["id"], "name": m["name"], "status": cell["st"], "label": cell["label"], "lab13": cell["lab13"]})
            return self.send_json({"id": aid, "title": a["title"], "kind": "lab13", "closed": a["closed"],
                                   "due": a["due"], "total": 1, "rows": rows})
        items = svc.asg_items(real)
        # задания работы по порядку — учителю видно, что в подборке и что из этого ученик решил
        item_info = [{"id": k, "n": (svc.bank.tasks.get(k) or {}).get("n")} for k in items]
        sols = {}                              # сколько решений (кода) прикреплено к заданиям работы
        if real:
            for x in db.q(f"""SELECT student_id, COUNT(*) AS c FROM solutions WHERE task_id IN ({','.join('?' * len(real))})
                              AND ts >= ? GROUP BY student_id""", (*real, a["created"] or 0)):
                sols[x["student_id"]] = x["c"]
        if not a["strict"]:
            rows = []
            for m in db.q("SELECT id, name, last_seen FROM students WHERE class_id=? AND (? IS NULL OR id=?) ORDER BY name",
                          (a["class_id"], a["student_id"], a["student_id"])):
                sc = svc.practice_score(db, a, m["id"], real)
                rows.append({"id": m["id"], "name": m["name"], "total": len(items), "answered": sc["tried"],
                             "status": "done" if sc["tried"] >= len(items) else "work" if sc["tried"] else "none",
                             "ok": sc["ok"], "half": sc["half"], "bad": sc["bad"], "pct": sc["pct"], "grade": sc["grade"],
                             "attempts": sc["attempts"], "online": bool(m["last_seen"] and now - m["last_seen"] < 60),
                             "sol": sols.get(m["id"], 0), "tasks": len(real),
                             "cells": [sc["items"].get(svc.bank.pid(k)) for k in items]})   # 1 / 0.5 / 0 / None — не решал
            return self.send_json({"id": aid, "title": a["title"], "strict": False, "kind": a["kind"], "closed": a["closed"], "due": a["due"],
                                   "grading": svc.asg_grading(a), "total": len(items), "items": item_info, "rows": rows})
        runs = {r["student_id"]: r for r in db.q("SELECT * FROM asg_runs WHERE asg_id=?", (aid,))}
        rows = []
        for m in db.q("SELECT id, name, last_seen FROM students WHERE class_id=? AND (? IS NULL OR id=?) ORDER BY name",
                      (a["class_id"], a["student_id"], a["student_id"])):
            r = runs.get(m["id"])
            row = {"id": m["id"], "name": m["name"], "status": "none", "answered": 0, "total": len(items),
                   "sol": sols.get(m["id"], 0), "tasks": len(real), "cells": [None] * len(items)}
            if r:
                answers = json.loads(r["answers"] or "{}")
                res = json.loads(r["result"]) if r["finished"] else svc.asg_score(answers, items)
                got = [v for k, v in res.items() if k in answers]
                row.update(status="done" if r["finished"] else "work", answered=len(answers), started=r["started"],
                           finished=r["finished"], last=r["last"], away=r["away"] or 0, fs=r["fs"] or 0, forced=bool(r["forced"]),
                           ok=sum(1 for v in got if v == 1), half=sum(1 for v in got if v == 0.5),
                           bad=sum(1 for v in got if v == 0 or v is None),
                           pct=r["pct"] if r["finished"] else int(100 * sum(v or 0 for v in res.values()) / len(items) + 0.5) if items else 0,
                           grade=r["grade"], online=bool(m["last_seen"] and now - m["last_seen"] < 60),
                           cells=[(res.get(k) or 0) if k in answers else None for k in items])
            rows.append(row)
        return self.send_json({"id": aid, "title": a["title"], "strict": bool(a["strict"]), "closed": a["closed"], "due": a["due"],
                               "grading": svc.asg_grading(a), "total": len(items), "items": item_info, "rows": rows})
