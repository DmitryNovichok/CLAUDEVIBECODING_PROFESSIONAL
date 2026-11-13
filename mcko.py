# -*- coding: utf-8 -*-
"""МЦКО-тренировка: банк заданий, файлы к заданию 13 и проверка ответов.

Банк — data/mcko_bank.json: 390 авторских заданий по информатике (10 класс, углублённый уровень) по типам
демонстрационной работы МЦКО, 13 типов × 30 разновидностей. Это не официальные варианты МЦКО.
Ответы (key) и решения не выходят к ученику: проверка только здесь, на сервере.
Учитель добавляет свои задания (таблица mcko_custom) — они проверяются так же."""
import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANK_PATH = HERE / "data" / "mcko_bank.json"

try:
    BANK = json.loads(BANK_PATH.read_text(encoding="utf-8"))
except (OSError, ValueError):                      # без банка раздел работает только со своими заданиями учителя
    BANK = {"version": "", "title": "", "description": "", "topics": [], "questions": []}
QUESTIONS = BANK["questions"]
BY_ID = {q["id"]: q for q in QUESTIONS}
TYPES = sorted({q["type"] for q in QUESTIONS})
TOPICS = {i + 1: t for i, t in enumerate(BANK.get("topics") or [])}
VARIANTS = sorted({q["variant"] for q in QUESTIONS})
MAX_SCORE = sum(BY_ID[f"inf10-t{t:02d}-v01"]["points"] for t in TYPES) if QUESTIONS else 0


# ---------- файл к заданию 13: та же последовательность, что у генератора банка (линейный конгруэнтный генератор)
def _rng(seed):
    x = seed & 0xFFFFFFFF

    def nxt():
        nonlocal x
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
        return x / 4294967296
    return nxt


def dataset(seed):
    r = _rng(918201 + seed * 731)
    n = 8 if 4 + seed % 13 == 15 else 4 + seed % 13
    out = [n]
    for _ in range(1, 10000):
        x = math.floor(r() * 100000) + n
        if r() < .28:
            x = (x // n) * n
        if r() < .18:
            x = -15 * (1 + math.floor(r() * 6000))
        out.append(max(-100000, min(100000, x)))
    return out


def file_text(q):
    f = q.get("file")
    return "\n".join(map(str, dataset(f["seed"]))) + "\n" if f else None


# ---------- проверка
def norm(x):
    """Как в исходном сервисе: без пробелов и регистра, запятая = точка, ё = е."""
    return re.sub(r"\s+", "", str(x if x is not None else "").strip().lower().replace(",", ".").replace("ё", "е"))


def fields(q):
    """Сколько полей ответа у задания (по числу ключей)."""
    return len(q["key"])


def score(q, values):
    """Баллы за ответ values (список строк по полям). Тип 13 — по баллу за каждое верное поле, остальные — всё или ничего.
    В своём задании учителя ключ поля может перечислять варианты через «|»."""
    values = list(values or [])
    hits = []
    for j, key in enumerate(q["key"]):
        got = norm(values[j] if j < len(values) else "")
        hits.append(bool(got) and got in {norm(k) for k in str(key).split("|")})
    if q.get("partial"):
        return sum(hits)
    return q["points"] if hits and all(hits) else 0


# ---------- задания учителя
INPUT_STYLE = 'autocomplete="off" style="width:150px;text-align:center"'


def custom_question(row):
    """Своё задание учителя в том же виде, что и задания банка. Текст учителя экранируется, поля ответа — наши."""
    import html as _h
    keys = json.loads(row["key"] or "[]") or [""]
    paras = "".join(f'<p class="MsoNormal">{_h.escape(p)}</p>' for p in re.split(r"\n\s*\n", row["text"].strip()) if p.strip())
    paras = paras.replace("\n", "<br>")
    inputs = " ".join(f'<input id="a{j}" aria-label="Ответ {j + 1}" {INPUT_STYLE}>' for j in range(len(keys)))
    return {"id": f"c{row['id']}", "type": row["num"], "variant": 0, "topic": row["topic"] or TOPICS.get(row["num"], "Своё задание"),
            "html": f'{paras}<div class="answer">Ответ: {inputs}.</div>', "key": keys, "points": row["points"] or 1,
            "partial": bool(row["partial"]), "solution": row["solution"] or "", "custom": True}


def public(q, file_url=""):
    """Задание для ученика: без ключа и решения; ссылка на файл — на сервер с проверкой доступа."""
    html = q["html"].replace("__FILE__", file_url) if file_url else q["html"]
    return {"id": q["id"], "type": q["type"], "topic": q["topic"], "html": html, "fields": fields(q),
            "points": max_points(q),
            "file": (q.get("file") or {}).get("name")}


def max_points(q):
    return len(q["key"]) if q.get("partial") or (q["type"] == 13 and not q.get("custom")) else q["points"]


# в банке тип 13 оценивается по полям
for _q in QUESTIONS:
    if _q["type"] == 13:
        _q["partial"] = True
