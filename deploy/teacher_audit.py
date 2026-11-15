"""Что известно о входах в аккаунт учителя из базы — только чтение, ничего не меняет.
Запуск на сервере: sudo -u trainer python3 /opt/trainer/deploy/teacher_audit.py ЛОГИН_ИЛИ_ПОЧТА_ИЛИ_ФАМИЛИЯ
До версии 2.64.0 IP входов учителя не записывались: здесь — косвенные следы (время создания классов,
действующие входы, запросы сброса пароля, адреса учеников этого учителя). С 2.64.0 — вкладка «Входы учителей»."""
import sqlite3, sys, time
DB = "/opt/trainer/server_data/trainer.db" if len(sys.argv) < 3 else sys.argv[2]
if len(sys.argv) < 2:
    sys.exit(__doc__)
T = sys.argv[1]
db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); db.row_factory = sqlite3.Row
f = lambda ts: time.strftime("%d.%m.%Y %H:%M", time.localtime(ts)) if ts else "—"
t = db.execute("SELECT * FROM teachers WHERE lower(login)=lower(?) OR lower(email)=lower(?) OR name LIKE ?", (T, T, f"%{T}%")).fetchone()
if not t: sys.exit("учитель не найден")
tid = t["id"]
print(f"Учитель: {t['name']} (id {tid}), логин {t['login']}, почта {t['email']}, создан {f(t['created'])}, IP согласия {t['consent_ip']}")
print("\nКлассы (когда созданы):")
for r in db.execute("SELECT id,name,created,(SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) n FROM classes c WHERE teacher_id=? ORDER BY created", (tid,)):
    print(f"  {f(r['created'])}  {r['name']}  (учеников {r['n']})")
print("\nДействующие входы в панель (вход ≈ срок − 14 дней):")
for r in db.execute("SELECT expires FROM admin_sessions WHERE teacher_id=? ORDER BY expires", (tid,)):
    print(f"  вход ≈ {f(r['expires'] - 14 * 86400)}")
print("\nЗапросы «Забыли пароль?» (≈ время запроса, использована ли ссылка):")
for r in db.execute("SELECT expires, used FROM pw_resets WHERE kind='t' AND uid=? ORDER BY expires", (tid,)):
    print(f"  {f(r['expires'] - 3600)}  {'использована' if r['used'] else 'не использована'}")
print("\nУченики этого учителя и учительский аккаунт «Решать как ученик» — адреса их входов:")
for s in db.execute("SELECT id,name,is_teacher,created,consent_ip,last_ip FROM students WHERE teacher_id=? ORDER BY created DESC LIMIT 60", (tid,)):
    ips = sorted({r["ip"] for r in db.execute("SELECT ip FROM student_sessions WHERE student_id=? AND ip IS NOT NULL", (s["id"],))})
    print(f"  {f(s['created'])}  {s['name']}{' [учитель]' if s['is_teacher'] else ''}  согласие {s['consent_ip'] or '—'}  последний {s['last_ip'] or '—'}  входы {', '.join(ips) or '—'}")
