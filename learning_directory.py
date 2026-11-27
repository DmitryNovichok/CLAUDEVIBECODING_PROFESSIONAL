"""Small, account-scoped summaries for the two student learning directories."""
import buglab
from learning_content import course_progress_total
from learning_catalog import ARDUINO_TOTALS, ARDUINO_TRACKS, LAB_MODELS, PREDICTION_MODELS, TOPICS, TRACE_EXAMPLES, public_catalog

MODEL_LABELS = {m["id"]: m["label"] for m in public_catalog()["labs"]}


def metric(done, total, started=False, target=None):
    return {"done": done, "total": total, "started": bool(started or done), "target": target}


def course_summary(svc, sid):
    lessons = {t["n"]: t for t in TOPICS if t["n"] == t["lesson_n"] and not t["archive"]}
    rows = {r["n"]: r for r in svc.db.q(
        "SELECT n, slide, total FROM course_seen WHERE student_id=? ORDER BY ts DESC, n", (sid,))
        if r["n"] in lessons and r["total"] > 0}
    totals = {n: course_progress_total(svc.root, n, row["total"]) for n, row in rows.items()}
    done = {n for n, r in rows.items() if r["slide"] >= totals[n]}
    n = next((n for n in rows if n not in done), None)
    if n is None:
        n = next((n for n in lessons if n not in done), None)
    target = None
    if n is not None:
        slide = max(1, rows[n]["slide"]) if n in rows else 1
        label = "19–21" if n == 19 else str(n)
        target = {"n": n, "slide": slide, "title": f"№{label} · {lessons[n]['title']}"}
        if n in rows:
            target["title"] += f" · слайд {slide} из {totals[n]}"
    return metric(len(done), len(lessons), bool(rows), target)


def python_summary(svc, s):
    rows = {r["task_id"]: dict(r) for r in svc.db.q(
        "SELECT task_id, ok, last_ts, regex_v1 FROM pyc_progress WHERE student_id=?", (s["id"],))}
    done = total = 0
    target = None
    best_rank = None
    started = False
    for mod in svc.pyc_index():
        opened = svc.pyc_open_levels(mod, rows, bool(s["pyc_free"]))
        module_activity = [rows[tid]["last_ts"] or 0 for level in mod["levels"] for tid in level["tasks"] if tid in rows]
        started |= bool(module_activity)
        for li, level in enumerate(mod["levels"]):
            tasks = level["tasks"]
            pending = [tid for tid in tasks if not rows.get(tid, {}).get("ok")]
            total += len(tasks)
            done += len(tasks) - len(pending)
            if li >= opened or not pending:
                continue
            last_in_level = max((rows[tid]["last_ts"] or 0 for tid in tasks if tid in rows), default=0)
            rank = max(module_activity, default=0), last_in_level
            if best_rank is None or rank > best_rank:
                best_rank = rank
                task = max(pending, key=lambda tid: (rows.get(tid) or {}).get("last_ts") or 0)
                target = {"m": mod["id"], "l": li, "task": task, "title": f"{mod['title']} · {level['title']}",
                          "detail": f"На уровне решено {len(tasks) - len(pending)} из {len(tasks)}"}
    return metric(done, total, started, target)


def lab_summaries(db, sid):
    items = [r["item"] for r in db.q(
        "SELECT item FROM lab_activity WHERE student_id=? ORDER BY last_opened DESC, item", (sid,))]
    models = [key for key in items if key in LAB_MODELS]
    correct = {m for m in PREDICTION_MODELS if "forecast:" + m in items}
    assigned = db.q("""SELECT 1 FROM asg_runs r JOIN assignments a ON a.id=r.asg_id
                        WHERE r.student_id=? AND a.kind='lab13' AND r.finished IS NOT NULL AND r.correct=1 LIMIT 1""",
                    (sid,), one=True)
    if assigned:
        correct.add("net")
    model = models[0] if models else "net"
    target = {"id": model, "title": f"№{MODEL_LABELS[model]} · {LAB_MODELS[model]}"}
    examples = sum("trace:" + key in items for key in TRACE_EXAMPLES)
    next_example = next((title for key, title in TRACE_EXAMPLES.items() if "trace:" + key not in items), None)
    rows = {r["case_id"]: r for r in db.q(
        "SELECT case_id, ok FROM buglab WHERE student_id=? ORDER BY first_ts DESC, case_id", (sid,))}
    cases = {c["id"]: c["title"] for c in buglab.CASES}
    done = {k for k, row in rows.items() if k in cases and row["ok"]}
    pending = next((k for k in rows if k in cases and k not in done), None)
    pending = pending or next((k for k in cases if k not in done), None)
    return {
        "tasks": {**metric(len(correct), len(PREDICTION_MODELS), bool(models), target),
                  "detail": f"Открыто {len(models)} из {len(LAB_MODELS)} моделей"},
        "code": metric(examples, len(TRACE_EXAMPLES), "code" in items,
                       {"title": next_example} if next_example else None),
        "bugs": metric(len(done), len(cases), bool(cases.keys() & rows.keys()),
                       {"id": pending, "title": cases[pending]} if pending else None),
    }


def arduino_summary(tracks):
    done = 0
    next_lesson = None
    track_counts = []
    started = False
    for track, label in ARDUINO_TRACKS.items():
        rows = {r[0]: r for r in tracks.get(track, []) if isinstance(r, list) and len(r) == 5}
        completed = sum(all(r[2:]) for r in rows.values())
        completed = min(completed, ARDUINO_TOTALS[track])
        done += completed
        track_counts.append({"label": label, "done": completed, "total": ARDUINO_TOTALS[track]})
        active_track = any(any(r[2:]) for r in rows.values())
        started |= active_track
        if not active_track:
            continue
        lesson = next((r for r in rows.values() if not all(r[2:])), None)
        if lesson:
            partial = any(lesson[2:])
            stage = next(name for name, ok in zip(("теория", "схема", "запуск"), lesson[2:]) if not ok)
            if not next_lesson or (partial and not next_lesson[0]):
                next_lesson = partial, {"id": lesson[0], "title": f"{label} · {lesson[1]} · {stage}"}
    return {**metric(done, sum(ARDUINO_TOTALS.values()), started, next_lesson[1] if next_lesson else None),
            "tracks": track_counts}


def directory(svc, s, group):
    entries = {}
    if not s["is_teacher"]:
        if group == "courses":
            if svc.course_open(s):
                entries["course"] = course_summary(svc, s["id"])
            if svc.pyc_access(s):
                entries["python"] = python_summary(svc, s)
        else:
            if svc.lab_access(svc.db, s):
                entries.update(lab_summaries(svc.db, s["id"]))
            if svc.ard_access(svc.db, s):
                entries["arduino"] = arduino_summary(svc.arduino_load(svc.db, s["id"]))
    return {"sid": s["id"], "group": group, "entries": entries}
