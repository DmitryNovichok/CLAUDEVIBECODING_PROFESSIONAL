"""Account-bound IPv4 assignment. The first submitted prediction is the journal result."""
import hashlib
import json
import time


TITLE = "Лаборатория №13 · Маска сети"


def get_run(db, aid, sid):
    return db.q("SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?", (aid, sid), one=True)


def question(aid, sid):
    # Reopening the card before starting also shows the same question on every device.
    seed = hashlib.sha256(f"lab13-v1/{aid}/{sid}".encode()).digest()
    return {"ip": f"10.{seed[0]}.{seed[1]}.{seed[2]}", "prefix": 20 + seed[3] % 11}


def assignment_state(a, run, sid):
    saved = json.loads(run["answers"] or "{}").get("lab13", {}) if run else {}
    variant = saved if "prefix" in saved else question(a["id"], sid)
    state = {"id": a["id"], "title": a["title"], "due": a["due"],
             "closed": bool(a["closed"] or (a["due"] and a["due"] <= time.time())),
             "ip": variant["ip"], "prefix": variant["prefix"],
             "started": run["started"] if run else None, "finished": run["finished"] if run else None,
             "prediction": None, "correct": None}
    if state["finished"] is not None:
        state.update(prediction=int(saved["a"]), correct=bool(run["correct"]),
                     expected=1 << (32 - state["prefix"]))
    return state


def start(db, aid, sid, now):
    variant = question(aid, sid)
    db.x("INSERT INTO asg_runs(asg_id,student_id,started,last,answers) VALUES(?,?,?,?,?)",
         (aid, sid, now, now, json.dumps({"lab13": variant})))


def submit(db, aid, sid, state, prediction, now):
    expected = 1 << (32 - state["prefix"])  # All IPv4 addresses, including network and broadcast.
    correct = int(prediction == expected)
    answer = {"ip": state["ip"], "prefix": state["prefix"], "a": str(prediction)}
    db.x("""UPDATE asg_runs SET finished=?, last=?, answers=?, result=?, correct=?, total=1, pct=?
            WHERE asg_id=? AND student_id=? AND finished IS NULL""",
         (now, now, json.dumps({"lab13": answer}), json.dumps({"lab13": correct}),
          correct, correct * 100, aid, sid))
