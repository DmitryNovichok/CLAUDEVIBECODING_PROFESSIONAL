"""Teacher roster, student records and account management HTTP boundary.

The common access and account transaction gates stay in Handler.api. Ownership
checks remain beside each operation. The server supplies live dependencies per
request; importing this module does not initialize an application or database.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping
import csv
import io
import json
import re
import secrets
import time

from auth import hash_pw
import buglab_merge
import learning_quality


TEACHER_STUDENTS_PATHS = frozenset({
    '/api/admin/class/import',
    '/api/admin/class/parents',
    '/api/admin/exam',
    '/api/admin/export.csv',
    '/api/admin/feed',
    '/api/admin/logout-here',
    '/api/admin/solution',
    '/api/admin/student',
    '/api/admin/student/delete',
    '/api/admin/student/fire',
    '/api/admin/student/logout',
    '/api/admin/student/newpw',
    '/api/admin/student/norank',
    '/api/admin/student/parent',
    '/api/admin/student/password-reset',
    '/api/admin/student/rename',
    '/api/admin/student/role',
    '/api/admin/student/teacher',
    '/api/admin/student/void',
    '/api/admin/student/void-undo',
    '/api/admin/students',
})


@dataclass(frozen=True)
class TeacherStudentsServices:
    """Explicit dependencies, captured from current server state for each request."""
    db: Any
    bank: Any
    main_teacher: Callable
    game_summary: Callable
    parse_int: Callable
    parse_float: Callable
    legal_version: str
    exam_brief: Callable
    sessions_list: Callable
    support_kinds: Mapping[str, str]
    csv_cell: Callable
    reasons: Mapping[str, str]
    norm_name: Callable
    name_re: Any
    sessions_end: Callable
    attempts_changed: Callable
    live: Any
    game_lock: Any
    leaderboard_cache: dict
    forbes_cache: dict
    restore_fire: Callable
    delete_student: Callable
    parent_token: Callable
    smtp_conf: Callable
    import_max: int
    new_student_pw: Callable
    make_login: Callable


class TeacherStudentsHandlers:
    def teacher_students_services(self):
        raise NotImplementedError

    def handle_teacher_students(self, method, path, qs, data):
        services = self.teacher_students_services()
        db = services.db
        now = time.time()
        day0 = datetime.combine(datetime.now().date(), datetime.min.time()).timestamp()
        if path == "/api/admin/students":
            rows = db.q("""
              SELECT s.id, s.name, s.created, s.last_seen, s.forecast, COALESCE(s.no_rank, 0) AS no_rank,
                     COUNT(a.id) AS total,
                     SUM(a.score = 1) AS ok1, SUM(a.score = 0.5) AS ok2, SUM(a.score = 0) AS bad,
                     SUM(a.ts >= ?) AS today, SUM(a.ts >= ?) AS week,
                     SUM(a.ts >= ? AND a.score = 0) AS bad_week,
                     MAX(a.ts) AS last_attempt,
                     (SELECT COUNT(*) FROM reveal_log r WHERE r.student_id = s.id AND r.granted = 1 AND r.ts >= ?) AS rev_week,
                     (SELECT COUNT(*) FROM reveal_log r WHERE r.student_id = s.id AND r.granted = 0 AND r.why = 'limit' AND r.ts >= ?) AS blocked_week,
                     (SELECT test_score FROM exams e WHERE e.student_id = s.id AND e.finished IS NOT NULL
                       ORDER BY e.finished DESC LIMIT 1) AS exam_last,
                     (SELECT COUNT(*) FROM activity v WHERE v.student_id = s.id AND v.ts >= ?) AS away_week,
                     s.class_id, s.teacher_id
              FROM students s LEFT JOIN attempts a ON a.student_id = s.id
              WHERE {scope}
              GROUP BY s.id ORDER BY COALESCE(MAX(a.ts), s.last_seen) DESC""".replace("{scope}", self.student_scope()[0]),
                        (day0, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400)
                        + self.student_scope()[1])
            cid = qs.get("class_id")
            names = {t["id"]: t["name"] for t in db.q("SELECT id, name FROM teachers")}
            main_id = services.main_teacher()["id"]
            out = []
            for r in rows:
                if cid == "none" and r["class_id"] is not None or cid not in (None, "", "none", "all") and r["class_id"] != services.parse_int(cid):
                    continue
                d = dict(r)
                g = services.game_summary(db, r["id"], brief=True)
                d["level"], d["xp"] = g["level"], g["xp"]
                d["cheat"] = g.get("cheat")                # пользовался лазейкой — опыт за этот период срезан
                d["teacher_id"] = r["teacher_id"] or main_id
                d["teacher"] = names.get(d["teacher_id"], "")
                out.append(d)
            return self.send_json({"students": out, "now": now})

        if path == "/api/admin/student":
            sid = services.parse_int(qs.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            s = db.q("SELECT id,name,created,last_seen,forecast,progress_ts,last_ip,fc,progress FROM students WHERE id=?",
                     (sid,), one=True)
            if not s:
                return self.err(404, "ученик не найден")
            frm = services.parse_float(qs.get("from"))
            voids = [dict(r) for r in db.q("""SELECT batch, MIN(void_ts) AS ts, COUNT(*) AS n, MIN(t_from) AS t_from, MAX(t_to) AS t_to
                                               FROM attempts_void WHERE student_id=? GROUP BY batch ORDER BY ts DESC LIMIT 20""", (sid,))]
            att = db.q("""SELECT a.*, EXISTS(SELECT 1 FROM attempts prev WHERE prev.student_id=a.student_id
                           AND prev.task_id=a.task_id AND prev.id<a.id) AS repeated
                           FROM attempts a WHERE a.student_id=? AND a.ts>=? ORDER BY a.ts DESC LIMIT 5000""", (sid, frm))
            services.bank.ensure()
            out = []
            for a in att:
                d = dict(a)
                d["provenance"] = learning_quality.provenance(a, bool(a["repeated"]))
                d["provenance_label"] = learning_quality.PROVENANCE[d["provenance"]]
                d["answers"] = json.loads(d["answers"] or "[]")
                d["snip"] = services.bank.snippet(d["task_id"])
                out.append(d)
            fc_hist = []
            try:
                fc_hist = json.loads(s["fc"]) if s["fc"] else (json.loads(s["progress"] or "{}").get("fc") or [])
            except (ValueError, AttributeError):
                pass
            rev = db.q("""SELECT SUM(granted = 1) AS granted, SUM(granted = 0 AND why = 'limit') AS blocked,
                                 SUM(granted = 0 AND why = 'think') AS early
                          FROM reveal_log WHERE student_id=? AND ts>=?""", (sid, frm), one=True)
            exams = db.q("""SELECT id, started, finished, primary_score, test_score, items, result,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'away'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS away,
                                   (SELECT COALESCE(SUM(v.dur), 0) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1
                                      AND v.kind = 'away' AND v.ts BETWEEN e.started AND e.finished + 5) AS away_sec,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'fs'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS fs,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'paste'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS paste
                            FROM exams e WHERE student_id=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 20""", (sid,))
            same_ip = []
            if s["last_ip"]:
                scope, args = self.student_scope("peer")
                same_ip = [r["name"] for r in db.q(f"""SELECT peer.name FROM students peer
                             WHERE peer.last_ip=? AND peer.id<>? AND {scope}
                             ORDER BY peer.last_seen DESC LIMIT 30""", (s["last_ip"], sid, *args))]
            student = {k: s[k] for k in ("id", "name", "created", "last_seen", "forecast", "progress_ts", "last_ip")}
            extra_row = db.q("SELECT role, consent_ver, consent_ts, consent_ip, no_rank FROM students WHERE id=?", (sid,), one=True)
            student.update({k: extra_row[k] for k in ("role", "consent_ver", "consent_ts", "consent_ip", "no_rank")} if extra_row else {})
            student["consent_ok"] = bool(extra_row and extra_row["consent_ver"] == services.legal_version)
            student["has_password"] = bool(db.q("SELECT pw FROM students WHERE id=?", (sid,), one=True)["pw"])
            coded = {r["task_id"] for r in db.q("SELECT task_id FROM solutions WHERE student_id=?", (sid,))}
            for d in out:
                d["has_code"] = 1 if d["task_id"] in coded or (d.get("grp") or "") in coded else 0
            act = db.q("""SELECT kind, COUNT(*) AS c, SUM(dur) AS dur, SUM(exam) AS in_exam FROM activity
                          WHERE student_id=? AND ts>=? GROUP BY kind""", (sid, frm))
            # каждый уход со страницы: когда, насколько, на каком задании (сводка «вне тренажёра»)
            away_log = []
            for r in db.q("""SELECT ts, kind, task_id, dur, exam FROM activity WHERE student_id=? AND ts>=?
                             ORDER BY ts DESC LIMIT 300""", (sid, frm)):
                d = dict(r)
                tk = services.bank.tasks.get(d["task_id"]) if d["task_id"] else None
                d["n"] = tk.get("n") if tk else None
                d["snip"] = services.bank.snippet(d["task_id"]) if tk else ""
                away_log.append(d)
            row = db.q("SELECT class_id, teacher_id FROM students WHERE id=?", (sid,), one=True)
            student["class_id"] = row["class_id"]
            student["teacher_id"] = row["teacher_id"] or services.main_teacher()["id"]
            return self.send_json({"student": student, "attempts": out, "forecast_history": fc_hist,
                                   "reveals": {k: rev[k] or 0 for k in ("granted", "blocked", "early")},
                                   "exams": [services.exam_brief(r) for r in exams], "same_ip": same_ip, "sessions": services.sessions_list(db, sid),
                                   "voids": voids,
                                   "activity": {r["kind"]: {"count": r["c"], "sec": round(r["dur"] or 0), "exam": r["in_exam"] or 0} for r in act},
                                   "away_log": away_log,
                                   "game": services.game_summary(db, sid), "rules": self.rules()})

        if path == "/api/admin/feed":
            since = services.parse_float(qs.get("since"))
            cond, args = self.student_scope()
            rows = db.q(f"""SELECT a.*, s.name, EXISTS(SELECT 1 FROM attempts prev WHERE prev.student_id=a.student_id
                             AND prev.task_id=a.task_id AND prev.id<a.id) AS repeated FROM attempts a JOIN students s ON s.id = a.student_id
                            WHERE a.ts > ? AND {cond} ORDER BY a.ts DESC LIMIT 300""", (since, *args))
            services.bank.ensure()
            out = []
            for a in rows:
                d = dict(a)
                d["provenance"] = learning_quality.provenance(a, bool(a["repeated"]))
                d["provenance_label"] = learning_quality.PROVENANCE[d["provenance"]]
                d["answers"] = json.loads(d["answers"] or "[]")
                d["snip"] = services.bank.snippet(d["task_id"])
                out.append(d)
            # события контрольных: начал, ушёл со вкладки, вышел из полного экрана, сдал
            ev = db.q(f"""SELECT e.*, s.name, g.title FROM asg_events e JOIN students s ON s.id = e.student_id
                          JOIN assignments g ON g.id = e.asg_id
                          WHERE e.ts > ? AND {cond} ORDER BY e.ts DESC LIMIT 300""", (since, *args))
            events = [dict(e) for e in ev]
            # сданные варианты ЕГЭ — тоже в уведомления
            for e in db.q(f"""SELECT x.id, x.student_id, x.finished, x.primary_score, x.test_score, s.name FROM exams x
                              JOIN students s ON s.id = x.student_id
                              WHERE x.finished > ? AND {cond} ORDER BY x.finished DESC LIMIT 100""", (since, *args)):
                events.append({"ts": e["finished"], "kind": "exam", "student_id": e["student_id"], "name": e["name"],
                               "title": "Вариант ЕГЭ", "exam": e["id"],
                               "info": json.dumps({"test": e["test_score"], "primary": e["primary_score"]})})
            if self.T["is_main"]:
                # обращения в техподдержку — главному учителю
                for t in db.q("""SELECT x.id, x.ts, x.kind, x.text, x.student_id, s.name FROM support x
                                 JOIN students s ON s.id = x.student_id WHERE x.ts > ? ORDER BY x.ts DESC LIMIT 50""", (since,)):
                    events.append({"ts": t["ts"], "kind": "support", "student_id": t["student_id"], "name": t["name"],
                                   "title": services.support_kinds.get(t["kind"], "Обращение"), "info": (t["text"] or "")[:160]})
                for t in db.q("""SELECT m.ts, m.text, p.kind, p.student_id, s.name FROM support_msgs m JOIN support p ON p.id = m.support_id
                                 JOIN students s ON s.id = p.student_id WHERE m.who='student' AND m.ts > ? ORDER BY m.ts DESC LIMIT 50""", (since,)):
                    events.append({"ts": t["ts"], "kind": "support", "student_id": t["student_id"], "name": t["name"],
                                   "title": "ответ в обращении", "info": (t["text"] or "")[:160]})
            events.sort(key=lambda x: -x["ts"])
            return self.send_json({"attempts": out, "events": events, "now": now})

        if path == "/api/admin/exam":
            # разбор варианта ученика для учителя: ответ ученика, правильный ответ, баллы по каждому заданию
            e = db.q("SELECT * FROM exams WHERE id=? AND finished IS NOT NULL", (str(qs.get("id") or ""),), one=True)
            if not e or not self.sees_student(e["student_id"]):
                return self.err(404, "вариант не найден")
            services.bank.ensure()
            r = json.loads(e["result"] or "{}")
            mine = {}
            for a in db.q("SELECT task_id, answers FROM attempts WHERE student_id=? AND exam=?", (e["student_id"], e["id"])):
                try:
                    mine[a["task_id"]] = (json.loads(a["answers"] or "[]") or [""])[0]
                except ValueError:
                    pass
            rows = []
            for x in r.get("results") or []:
                real = services.bank.real(x.get("task")) or ""
                t = services.bank.tasks.get(real) or {}
                rows.append({"task": real, "n": x.get("n"), "points": x.get("points"), "max": x.get("max"), "blank": x.get("blank"),
                             "mine": mine.get(real, ""), "answer": t.get("ans", ""), "snip": services.bank.snippet(real) if real else ""})
            st = db.q("SELECT name FROM students WHERE id=?", (e["student_id"],), one=True)
            return self.send_json({"id": e["id"], "student": st["name"] if st else "", "started": e["started"], "finished": e["finished"],
                                   "primary": e["primary_score"], "test": e["test_score"], "spent": r.get("spent"),
                                   "shown": bool(r.get("shown")), "rows": rows})

        if path == "/api/admin/solution":
            if not self.sees_student(services.parse_int(qs.get("student"))):
                return self.err(404, "решение не прикреплено")
            r = db.q("SELECT code, ts FROM solutions WHERE student_id=? AND task_id=?",
                     (services.parse_int(qs.get("student")), str(qs.get("task") or "")), one=True)
            if not r:
                return self.err(404, "решение не прикреплено")
            return self.send_json({"code": r["code"], "ts": r["ts"]})

        if path == "/api/admin/export.csv":
            sid = qs.get("student")
            frm = services.parse_float(qs.get("from"))
            args = [frm]
            cond, sargs = self.student_scope()
            sql = f"""SELECT a.*, s.name FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.ts>=? AND {cond}"""
            args += list(sargs)
            if sid:
                sql += " AND a.student_id=?"
                args.append(services.parse_int(sid))
            sql += " ORDER BY s.name, a.ts"
            rows = db.q(sql, args)
            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            w.writerow(["Ученик", "Дата", "Время", "№", "ID задания", "Банк", "Ответ ученика (1-я попытка)",
                        "2-я попытка", "Правильный ответ", "Результат", "Баллы", "Время на задание, с", "Почему выдано"])
            for a in rows:
                answers = json.loads(a["answers"] or "[]")
                dt = datetime.fromtimestamp(a["ts"])
                res = ("верно" if a["score"] == 1 else "верно со 2-й попытки" if a["score"] == 0.5
                       else "показал ответ" if a["gave_up"] else "ушёл после ошибки" if a["abandoned"]
                       else "нет ответа" if a["reason"] == "exam" and not answers else "неверно")
                if a["score"] == 0 and a["part"] == 0.5:
                    res += " (верна половина — 1 балл из 2)"
                w.writerow([services.csv_cell(x) for x in [a["name"], dt.strftime("%d.%m.%Y"), dt.strftime("%H:%M"), a["n"], a["task_id"].split(":", 1)[-1],
                            a["bank"], (answers[0] if answers else "").replace("\n", " "),
                            (answers[1] if len(answers) > 1 else "").replace("\n", " "),
                            (a["correct"] or "").replace("\n", " | "), res,
                            str(a["score"]).replace(".", ","), round((a["spent_ms"] or 0) / 1000), services.reasons.get(a["reason"], a["reason"])]])
            body = ("﻿" + buf.getvalue()).encode("utf-8")
            name = "zhurnal.csv"
            return self.send_bytes(200, body, "text/csv; charset=utf-8",
                                   {"Content-Disposition": f"attachment; filename={name}", "Cache-Control": "no-store"})

        if path == "/api/admin/student/rename" and method == "POST":
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            pretty, key = services.norm_name(data.get("name"))
            if not services.name_re.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Нужны фамилия и имя")
            other = db.q("SELECT id FROM students WHERE name_key=? AND id<>?", (key, sid), one=True)
            if other and not self.sees_student(other["id"]):
                return self.err(409, "Ученик с таким ФИО уже есть у другого учителя — добавьте отчество")
            if other:      # такое ФИО уже есть — объединяем журналы
                for table in ("attempts", "reveal_log", "exams", "activity"):
                    db.x(f"UPDATE {table} SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("UPDATE OR IGNORE solutions SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("DELETE FROM solutions WHERE student_id=?", (sid,))
                db.x("UPDATE solution_history SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("""INSERT INTO lab_activity(student_id, item, last_opened)
                        SELECT ?, item, last_opened FROM lab_activity WHERE student_id=?
                        ON CONFLICT(student_id, item) DO UPDATE SET last_opened=MAX(last_opened, excluded.last_opened)""",
                     (other["id"], sid))
                db.x("DELETE FROM lab_activity WHERE student_id=?", (sid,))
                buglab_merge.merge(db, sid, other["id"])
                db.x("DELETE FROM student_sessions WHERE student_id=?", (sid,))
                db.x("DELETE FROM students WHERE id=?", (sid,))
                return self.send_json({"ok": True, "merged_into": other["id"]})
            db.x("UPDATE students SET name=?, name_key=? WHERE id=?", (pretty, key, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/password-reset" and method == "POST":
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if not db.q("SELECT 1 FROM students WHERE id=?", (sid,), one=True):
                return self.err(404, "ученик не найден")
            # пароль стирается, вход на всех устройствах сбрасывается; ученик задаст новый с кодом приглашения
            db.x("UPDATE students SET pw=NULL WHERE id=?", (sid,))
            services.sessions_end(db, sid)
            return self.send_json({"ok": True})

        if path in ("/api/admin/student/void", "/api/admin/student/void-undo") and method == "POST":
            # отменить ответы ученика за промежуток (в аккаунт зашёл кто-то другой): предпросмотр, затем — в корзину attempts_void;
            # опыт, монеты за труд, точность, огонёк, прогноз и рейтинги пересчитываются сами — они считаются по журналу ответов
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if path == "/api/admin/student/void-undo":
                rows = db.q("SELECT * FROM attempts_void WHERE student_id=? AND batch=?", (sid, str(data.get("batch") or "")))
                if not rows:
                    return self.err(404, "Эта отмена уже возвращена")
                cols = {r[1] for r in db.q("PRAGMA table_info(attempts)")}
                for r in rows:
                    a = {k: v for k, v in json.loads(r["row"]).items() if k in cols}
                    db.x(f"INSERT OR IGNORE INTO attempts({','.join(a)}) VALUES({','.join('?' * len(a))})", tuple(a.values()))
                db.x("DELETE FROM attempts_void WHERE student_id=? AND batch=?", (sid, rows[0]["batch"]))
                services.attempts_changed(sid)
                return self.send_json({"ok": True, "restored": len(rows)})
            t_from, t_to = services.parse_float(data.get("from")), services.parse_float(data.get("to"))
            if not t_from or not t_to or t_to <= t_from or t_to - t_from > 7 * 86400:
                return self.err(400, "Укажите промежуток — не длиннее недели")
            att = db.q("SELECT * FROM attempts WHERE student_id=? AND ts>=? AND ts<=? ORDER BY ts", (sid, t_from, t_to))
            if data.get("preview"):
                services.bank.ensure()
                coins = db.q("SELECT COUNT(*) c FROM coins WHERE student_id=? AND ts>=? AND ts<=? AND reason IN ('gift','upgrade','sell','mbuy')",
                             (sid, t_from, t_to), one=True)["c"]
                return self.send_json({"n": len(att), "ok": sum(1 for a in att if (a["score"] or 0) >= 1),
                                       "bad": sum(1 for a in att if (a["score"] or 0) <= 0), "exam": sum(1 for a in att if a["exam"]),
                                       "nums": sorted({a["n"] for a in att if a["n"]}), "gift_ops": coins,
                                       "list": [{"ts": a["ts"], "n": a["n"], "score": a["score"], "exam": bool(a["exam"]),
                                                 "answer": (json.loads(a["answers"] or "[]") or [""])[-1] if a["answers"] else ""}
                                                for a in att[:60]]})
            if not att:
                return self.err(400, "За этот промежуток ответов нет")
            batch, now = secrets.token_hex(6), time.time()
            for a in att:
                db.x("INSERT INTO attempts_void(batch, student_id, ts, row, void_ts, teacher_id, t_from, t_to) VALUES(?,?,?,?,?,?,?,?)",
                     (batch, sid, a["ts"], json.dumps(dict(a), ensure_ascii=False), now, self.T["id"], t_from, t_to))
            db.x(f"DELETE FROM attempts WHERE id IN ({','.join('?' * len(att))})", tuple(a["id"] for a in att))
            services.attempts_changed(sid)
            return self.send_json({"ok": True, "voided": len(att), "batch": batch})

        if path == "/api/admin/student/logout" and method == "POST":
            # выйти у ученика на всех устройствах (например, вошёл на чужом компьютере)
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            return self.send_json({"ok": True, "ended": services.sessions_end(db, sid)})

        if path == "/api/admin/logout-here" and method == "POST":
            # конец урока: выйти всем вашим ученикам на компьютерах этой сети (адрес — как у учителя сейчас)
            ip = self.client_ip()
            where, args = self.student_scope()
            sids = [r["id"] for r in db.q(f"SELECT s.id FROM students s WHERE {where}", args)]
            n = 0
            for i in range(0, len(sids), 500):
                part = sids[i:i + 500]
                n += db.xn(f"""UPDATE student_sessions SET ended=? WHERE ip=? AND ended IS NULL
                                AND student_id IN ({','.join('?' * len(part))})""", (time.time(), ip, *part))
                # прежний общий токен у тех, кто заходил с этого адреса, — тоже
                db.x(f"UPDATE students SET token=lower(hex(randomblob(18))) WHERE last_ip=? AND id IN ({','.join('?' * len(part))})", (ip, *part))
            services.live.send(sids, "logout")
            return self.send_json({"ok": True, "ended": n, "ip": ip})

        if path == "/api/admin/student/norank" and method == "POST":
            # убрать ученика из рейтингов (лига, ТОПы дня/недели/месяца, корона, битва классов, Forbes, Эло, сезоны) или вернуть
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            db.x("UPDATE students SET no_rank=? WHERE id=?", (1 if data.get("on") else 0, sid))
            with services.game_lock:
                services.leaderboard_cache.clear()
            services.forbes_cache.clear()
            return self.send_json({"ok": True, "no_rank": bool(data.get("on"))})

        if path == "/api/admin/student/role" and method == "POST":
            # плашка 👑 admin рядом с именем ученика — выдаёт и снимает только главный учитель
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            db.x("UPDATE students SET role=? WHERE id=?", ("admin" if data.get("admin") else None, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/fire" and method == "POST":
            # восстановить огонёк ученику (например, после сбоя сервера): серия станет не меньше days
            sid = services.parse_int(data.get("id"))
            days = services.parse_int(data.get("days"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if not days or not 1 <= days <= 365:
                return self.err(400, "Сколько дней огонька — от 1 до 365")
            added, fire = services.restore_fire(db, sid, days)
            return self.send_json({"ok": True, "added": added, "fire": fire})

        if path == "/api/admin/student/delete" and method == "POST":
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            services.delete_student(db, sid)
            return self.send_json({"ok": True})

        if path == "/api/admin/student/parent" and method == "POST":
            # ссылка для родителей ученика (new — выпустить новую, старая перестанет работать) и почта для писем
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if "email" in data:
                email = str(data.get("email") or "").strip().lower()[:120]
                if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s.]{2,}", email):
                    return self.err(400, "Проверьте адрес почты")
                db.x("UPDATE students SET parent_email=? WHERE id=?", (email or None, sid))
            tok = services.parent_token(db, sid, bool(data.get("new")))
            r = db.q("SELECT parent_email FROM students WHERE id=?", (sid,), one=True)
            return self.send_json({"token": tok, "email": r["parent_email"] or "", "mail_on": bool(services.smtp_conf())})

        if path == "/api/admin/class/import" and method == "POST":
            # список класса из Excel: ученики создаются сразу с паролями (их видно один раз — для карточек входа)
            cid = services.parse_int(data.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            names = data.get("names") if isinstance(data.get("names"), list) else []
            if not names or len(names) > services.import_max:
                return self.err(400, f"Вставьте от 1 до {services.import_max} учеников")
            out, seen, now = [], set(), time.time()
            for raw in names:
                pretty, key = services.norm_name(str(raw or "")[:120])
                if not pretty:
                    continue
                if not services.name_re.match(pretty) or len(pretty.split()) < 2:
                    out.append({"name": pretty[:80], "status": "bad"})
                    continue
                if key in seen:
                    continue
                seen.add(key)
                ex = db.q("SELECT id, teacher_id FROM students WHERE name_key=?", (key,), one=True)
                if ex:
                    if self.sees_student(ex["id"]):                  # свой ученик — просто в этот класс
                        db.x("UPDATE students SET class_id=? WHERE id=?", (cid, ex["id"]))
                        out.append({"name": pretty, "status": "mine", "id": ex["id"]})
                    else:
                        out.append({"name": pretty, "status": "taken"})
                    continue
                pw, login = services.new_student_pw(), services.make_login(db, pretty)
                sid = db.x("""INSERT INTO students(name, name_key, token, created, last_seen, pw, teacher_id, class_id, login)
                              VALUES(?,?,?,?,?,?,?,?,?)""", (pretty, key, secrets.token_urlsafe(24), now, now, hash_pw(pw), self.T["id"], cid, login))
                out.append({"name": pretty, "status": "new", "id": sid, "password": pw, "login": login})
            return self.send_json({"rows": out})

        if path == "/api/admin/student/newpw" and method == "POST":
            # новый пароль для карточки входа (ученик забыл): прежний перестаёт действовать, входы закрываются
            sid = services.parse_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            pw = services.new_student_pw()
            db.x("UPDATE students SET pw=? WHERE id=?", (hash_pw(pw), sid))
            services.sessions_end(db, sid)
            r = db.q("SELECT name, login FROM students WHERE id=?", (sid,), one=True)
            login = r["login"] or services.make_login(db, r["name"])
            db.x("UPDATE students SET login=? WHERE id=?", (login, sid))
            return self.send_json({"name": r["name"], "password": pw, "login": login})

        if path == "/api/admin/class/parents":
            # ссылки для родителей всего класса (недостающие создаются)
            cid = services.parse_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            rows = db.q("SELECT id, name, parent_email FROM students WHERE class_id=? AND COALESCE(is_teacher, 0)=0 ORDER BY name", (cid,))
            return self.send_json({"students": [{"id": r["id"], "name": r["name"], "email": r["parent_email"] or "",
                                                 "token": services.parent_token(db, r["id"])} for r in rows]})

        if path == "/api/admin/student/teacher" and method == "POST":
            # главный передаёт ученика другому учителю (класс при этом снимается)
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid, tid = services.parse_int(data.get("id")), services.parse_int(data.get("teacher_id"))
            if not db.q("SELECT 1 FROM teachers WHERE id=?", (tid,), one=True) or not self.sees_student(sid):
                return self.err(404, "не найдено")
            db.x("UPDATE students SET teacher_id=?, class_id=NULL WHERE id=?", (tid, sid))
            return self.send_json({"ok": True})

        return self.err(404, "нет такого метода")
