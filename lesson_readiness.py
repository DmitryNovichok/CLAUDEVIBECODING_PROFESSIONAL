"""A synthetic save/read round trip; never changes a pupil's work or scores."""
import hashlib
import re
import time

SAMPLE = b"17\n23\n"
NONCE = re.compile(r"[a-f0-9]{32}\Z")


def probe(db, account, nonce, *, write=False, now=None):
    if not isinstance(nonce, str) or not NONCE.fullmatch(nonce):
        return 400, {"error": "Неверный запрос проверки"}
    now = time.time() if now is None else now
    digest = hashlib.sha256(nonce.encode()).hexdigest()
    with db.transaction():
        db.conn.execute("""CREATE TABLE IF NOT EXISTS lesson_readiness (
            account TEXT PRIMARY KEY, receipt TEXT NOT NULL, updated REAL NOT NULL)""")
        row = db.conn.execute("SELECT receipt,updated FROM lesson_readiness WHERE account=?", (account,)).fetchone()
        if write:
            if row and now - row["updated"] < 5:
                return 429, {"error": "Повторите проверку через несколько секунд"}
            db.conn.execute("INSERT INTO lesson_readiness VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET receipt=excluded.receipt,updated=excluded.updated",
                            (account, digest, now))
            db.conn.execute("DELETE FROM lesson_readiness WHERE updated<?", (now - 86400 * 30,))
            return 200, {"ok": True, "receipt": nonce}
        saved = bool(row and row["receipt"] == digest and now - row["updated"] < 300)
        return (200 if saved else 409), {"ok": saved, "saved": saved}
