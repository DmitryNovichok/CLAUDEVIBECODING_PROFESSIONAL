#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка банка заданий для тренажёра ЕГЭ по информатике.

Папка trainer кладётся внутрь Biblio (рядом с ege_bank и kompege_bank):

    Biblio/
      ege_bank/        assets/ raw/ tasks/ ...
      kompege_bank/    assets/ raw/ tasks/ ...
      trainer/         index.html  app.js  style.css  build.py  <- этот скрипт

Запуск:
    python build.py                      # собрать ege_bank + kompege_bank
    python build.py --standalone         # скопировать картинки и файлы в trainer/media
                                         # (папку trainer можно выложить на хостинг отдельно)
    python build.py --root "D:/Biblio" --bank ege_bank --bank kompege_bank

Результат: trainer/data/bank.js (задания) и trainer/data/report.txt (отчёт).
Нужен только Python 3.8+, сторонние библиотеки не требуются.
"""
import argparse
import difflib
import hashlib
import html as H
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote

HERE = Path(__file__).resolve().parent
DEFAULT_BANKS = ["ege_bank", "kompege_bank", "openfipi_bank"]
BANK_TITLES = {"ege_bank": "Банк ЕГЭ", "kompege_bank": "КомпЕГЭ", "openfipi_bank": "ФИПИ"}
OPTIONAL_BANKS = {"openfipi_bank"}      # если папки нет — пропускаем молча
KOMPEGE_SITE = "https://kompege.ru"

FILE_EXT = {".txt", ".csv", ".tsv", ".xlsx", ".xls", ".xlsm", ".ods", ".docx", ".doc",
            ".odt", ".rtf", ".pdf", ".zip", ".rar", ".7z", ".py", ".pas", ".cpp", ".dat"}
SERVICE_FILES = {"task.json", "attachments.json", "condition.html", "answer.html",
                 "errors.json", "index.json", "meta.json"}
REMOTE_RE = re.compile(r"^(?:[a-z][a-z0-9+.\-]+:|//|#)", re.I)
TAG_RE = re.compile(r"<(img|a|source|video|audio|iframe|embed|object)\b[^>]*>", re.I | re.S)
ATTR_RE = re.compile(r"(\s(?:src|href|data))\s*=\s*([\"'])(.*?)\2", re.I | re.S)
STYLE_RE = re.compile(r"\sstyle\s*=\s*([\"'])(.*?)\1", re.I | re.S)


# ---------------------------------------------------------------- helpers
def to_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    m = re.search(r"\d+", str(v or ""))
    return int(m.group()) if m else None


def strip_tags(s):
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|tr|li|h\d)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return H.unescape(s)


def clean_answer(a):
    """Ответ приводится к строке: строки ответа через \\n, значения внутри строки через пробел."""
    if a is None:
        return None
    if isinstance(a, bool):
        return None
    if isinstance(a, (int, float)):
        return str(a)
    if isinstance(a, list):
        rows = []
        for r in a:
            if isinstance(r, list):
                rows.append(" ".join(str(x) for x in r if x is not None))
            elif r is not None:
                rows.append(str(r))
        a = "\n".join(rows)
    if isinstance(a, dict):
        for k in ("value", "answer", "key", "text"):
            if a.get(k):
                return clean_answer(a[k])
        return None
    s = str(a)
    if "<" in s:
        s = strip_tags(s)
    s = H.unescape(s).replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    s = re.sub(r"^\s*(ответ|answer)\s*[:.]\s*", "", s, flags=re.I)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.split("\n")]
    s = "\n".join(ln for ln in lines if ln)
    return s or None


def text_to_html(text):
    text = (text or "").replace("\r\n", "\n").strip()
    paras = re.split(r"\n\s*\n", text)
    return "".join("<p>" + H.escape(p).replace("\n", "<br>") + "</p>" for p in paras if p.strip())


def body_inner(doc):
    m = re.search(r"<body[^>]*>(.*)</body>", doc, re.S | re.I)
    s = m.group(1) if m else doc
    s = re.sub(r"<h1[^>]*>.*?</h1>", "", s, count=1, flags=re.S | re.I)
    s = re.sub(r"<footer[^>]*>.*?</footer>", "", s, flags=re.S | re.I)
    return s.strip()


def first_div_block(s):
    """Вернуть (start, end) первого div верхнего уровня или None."""
    m = re.match(r"\s*<div\b[^>]*>", s, re.I)
    if not m:
        return None
    depth, pos = 0, 0
    for t in re.finditer(r"<(/?)div\b[^>]*>", s, re.I):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return (0, t.end())
    return None


def strip_ege_header(h):
    # скрытые дубли подписей
    h = re.sub(r'<span[^>]*aria-hidden="true"[^>]*>.*?</span>', "", h, flags=re.S | re.I)
    # кнопка Яндекс Учебника «Решать со связанными заданиями»
    h = re.sub(r'<a[^>]*data-testid="SolveLinkedButton"[^>]*>.*?</a>', "", h, flags=re.S | re.I)
    blk = first_div_block(h)
    if blk:
        head = h[blk[0]:blk[1]]
        if re.search(r"Автор|Тема|Уровень", head) and not re.search(r"<(p|img|table|pre|ol|ul)\b", head, re.I):
            h = h[blk[1]:]
    # пустые обёртки
    prev = None
    while prev != h:
        prev = h
        h = re.sub(r"<(div|span|p)>\s*</\1>", "", h, flags=re.I)
    return h.strip()


def clean_styles(h):
    def fix(m):
        q, s = m.groups()
        keep = []
        for d in s.split(";"):
            if not d.strip() or ":" not in d:
                continue
            prop, val = d.split(":", 1)
            prop = prop.strip().lower()
            if prop in ("color", "background", "background-color", "font-size", "line-height"):
                continue
            if prop == "font-family" and not re.search(r"mono|courier|consol", val, re.I):
                continue
            keep.append(d.strip())
        return f" style={q}{'; '.join(keep)}{q}" if keep else ""
    h = STYLE_RE.sub(fix, h)
    h = re.sub(r"\s(?:bgcolor|color)\s*=\s*([\"']).*?\1", "", h, flags=re.I)
    return h


def find_topic(text):
    m = re.search(r"Тема:\s*([^\n<]+)", text or "")
    if not m:
        return None
    t = m.group(1).strip().strip("()").strip()
    return t or None


LEVELS = [(r"прост|базов|лёгк|легк", 1, "Простая"),
          (r"средн|повыш", 2, "Средняя"),
          (r"сложн|высок|трудн", 3, "Сложная")]


def parse_level(v):
    """-> (число 1..3 или None, подпись)"""
    if v is None or v == "":
        return None, None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = int(v)
        if n <= 0:
            return None, None
        n = min(n, 3)
        return n, LEVELS[n - 1][2]
    s = re.sub(r"^.*?сложности\s*:\s*", "", str(v), flags=re.I).strip()
    for rx, n, _ in LEVELS:
        if re.search(rx, s, re.I):
            return n, s
    return None, s or None


# ---------------------------------------------------------------- год и актуальность
# С какого года действует нынешний тип задания (по документам ФИПИ об изменениях КИМ).
# Дублируется в app.js (CFG.formatSince) — там он и применяется; здесь только для отчёта.
FIRST_KEGE_YEAR = 2021                   # первый компьютерный ЕГЭ, раньше нумерация другая
FORMAT_SINCE = {6: 2023, 22: 2023, 13: 2024, 27: 2025}

# Признаки нового / старого типа по тексту условия (для номеров, которые меняли тип).
FMT_RULES = {
    6: (r"Черепах|хвост|Вперёд\s*\d|Вперед\s*\d|Направо\s*\d|Налево\s*\d",
        r"введ[её]нном значении|программ[аы]? (выведет|напечатает)|будет напечатано"),
    13: (r"маск[аиуе]|IP-?\s*адрес|адрес[а-я]* сети|узл[а-я]* сети",
         r"различных путей|сколько существует[^.]*пут|пут(ей|и)\s+из\s+город"),
    22: (r"процесс|параллельн|многопроцессор|поток[аио]в?\b",
         r"печатает два числа|\bL\s+и\s+M\b|получив на вход число"),
    27: (r"кластер|звёзд|звезд|центр[а-я]*\s+кластер|аномал",
         r"последовательност|подпоследовательност|пар[ыау]?\s+чисел|пар[ыау]?\s+натуральных"),
}

EXAM_WORDS = re.compile(r"ЕГЭ|КЕГЭ|демо|апробац|досроч|основн|резерв|пробн|статград|вариант|волн|экзамен|kege|\bege\b", re.I)


def exam_year_from_date(y, m):
    """Задания, появившиеся с июля, готовят к экзамену следующего года."""
    return y + (1 if m >= 7 else 0)


def date_in(s):
    """(год, месяц, 'ГГГГ-ММ-ДД') из ISO-даты или дд.мм.гг(гг) в строке."""
    if not isinstance(s, str):
        return None
    m = re.search(r"\b(20\d\d)-(\d\d)-(\d\d)", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return y, mo, f"{y:04d}-{mo:02d}-{d:02d}"
    m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.(20\d\d|\d\d)\b", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = y + 2000 if y < 100 else y
        if 1 <= mo <= 12 and 1 <= d <= 31 and 2015 <= y <= 2035:
            return y, mo, f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def year_from_label(s):
    """Год экзамена из подписи вроде «Демоверсия 2021», «ЕГЭ-2024», «Статград 26.10.2023»."""
    if not isinstance(s, str) or not s.strip():
        return None
    dt = date_in(s)
    if dt:
        return exam_year_from_date(dt[0], dt[1])
    if EXAM_WORDS.search(s):
        m = re.search(r"\b(20[12]\d)\s*[/–-]\s*(?:20)?(\d\d)\b", s)   # «2023/24» — экзамен 2024
        if m:
            return 2000 + int(m.group(2))
        m = re.search(r"\b(20[12]\d)\b", s)
        if m:
            return int(m.group(1))
    return None


def find_dates(d):
    """Поля с датами в записи задания: created*, date*, updated*, publish*, year*."""
    out = {}
    for k, v in d.items():
        kl = k.lower()
        if not re.search(r"creat|date|publish|updat|year|time", kl):
            continue
        if isinstance(v, (int, float)) and "year" in kl and 2015 <= v <= 2035:
            out[k] = (int(v), 1, None)
        elif isinstance(v, (int, float)) and v > 1e9:          # unix time (сек или мс)
            ts = v / 1000 if v > 1e12 else v
            try:
                dtt = datetime.utcfromtimestamp(ts)
                out[k] = (dtt.year, dtt.month, dtt.strftime("%Y-%m-%d"))
            except (OverflowError, OSError, ValueError):
                pass
        else:
            x = date_in(str(v))
            if x:
                out[k] = x
    return out


def classify_format(n, text):
    rule = FMT_RULES.get(n)
    if not rule:
        return None
    cur, old = rule
    if re.search(cur, text, re.I):
        return "cur"
    if re.search(old, text, re.I):
        return "old"
    return None


# ---------------------------------------------------------------- 19–21 одной страницей
SEP = '<hr class="subtask-sep">'


def plain_key(h):
    txt = H.unescape(re.sub(r"<[^>]+>", " ", h or "")).lower().replace("ё", "е")
    return re.sub(r"[^0-9a-zа-я]+", "", txt)


def linked_base_text(h):
    """Текст подставленного условия №19 в задании 20/21 из OpenFIPI."""
    if not h.lstrip().startswith('<div class="linked-task">') or SEP not in h:
        return None
    base = h.split(SEP, 1)[0]
    base = re.sub(r"<p><b>Задание 19 \(условие игры\)</b></p>", "", base, count=1)
    return plain_key(base)


QWORDS = re.compile(r"Будем говорить|Известно|Укажите|Найдите|Определите|Для игры|Выясните|Сколько|Какое|Каком|Какой|Каким|"
                    r"Необходимо|Требуется|Назовите|Запишите|Найти|Определить", re.I)
BLOCK_RE = re.compile(r"<(p|ul|ol|pre|table|blockquote)\b[^>]*>.*?</\1>", re.S | re.I)


def desc_key(h):
    """Описание игры — текст до первого вопроса («Известно…», «Найдите…», «Будем говорить…»)."""
    plain = H.unescape(re.sub(r"<[^>]+>", " ", h or ""))
    k = plain_key(QWORDS.split(plain, maxsplit=1)[0])
    return k if len(k) >= 60 else None


def strip_shared(first_html, h):
    """Убрать из текста части начальные абзацы, которые уже есть в первой части (общее условие игры).
    Абзацы могут быть разбиты по-разному, поэтому проверяем, что текст абзаца входит в текст первой части."""
    first_plain = plain_key(first_html)
    blocks = [b.group(0) for b in BLOCK_RE.finditer(h)]
    k = 0
    while k < len(blocks):
        pk = plain_key(blocks[k])
        if pk and not (len(pk) >= 15 and pk in first_plain):
            break
        k += 1
    if 0 < k < len(blocks):
        return "".join(blocks[k:])
    return h


def make_game(bank, parts):
    """Собрать задание «19–21» из частей (1–3 штуки)."""
    seen, uniq = set(), []
    for p in sorted(parts, key=lambda t: t["n"]):
        if p["n"] in seen:
            continue
        seen.add(p["n"])
        uniq.append(p)
    parts = uniq
    first = parts[0]
    htmls = [p["html"] for p in parts]
    if len(parts) == 1:
        html = first["html"]
    elif all(plain_key(h) == plain_key(htmls[0]) for h in htmls):
        html = first["html"]                      # банк ЕГЭ: одно условие на все три вопроса
    else:
        common, qs = None, []
        for p in parts:
            h = p["html"]
            if h.lstrip().startswith('<div class="linked-task">') and SEP in h:
                base, q = h.split(SEP, 1)
                if common is None and not any(x["n"] == 19 for x in parts):
                    common = base                 # №19 нет — условие игры берём из подстановки
            elif SEP in h:
                c, q = h.split(SEP, 1)            # КомпЕГЭ: общее условие + подвопрос
                common = common if common is not None else c
                q = re.sub(r'^\s*<div class="subtask">(.*)</div>\s*$', r"\1", q, flags=re.S)
            else:
                q = h if not qs else strip_shared(parts[0]["html"], h)   # без повтора условия игры
            qs.append((p["n"], q))
        html = (common or "") + "".join(f'<h3 class="gq-title">Задание {n}</h3>{q}' for n, q in qs)
    raw = first["id"].split(":", 1)[1].split("#")[0]
    g = {"id": f"{bank}:game:{raw}", "n": 19, "bank": bank, "html": html, "parts": []}
    for p in parts:
        part = {"id": p["id"], "n": p["n"], "ans": p["ans"]}
        if p.get("sol"):
            part["sol"] = p["sol"]
        g["parts"].append(part)
    for k in ("topic", "lv", "src", "link", "video", "y", "dt", "fmt"):
        v = next((p[k] for p in parts if p.get(k)), None)
        if v:
            g[k] = v
    ds = [p["d"] for p in parts if p.get("d")]
    if ds:
        g["d"] = max(ds)
    att, hrefs = [], set()
    for p in parts:
        for a in p.get("att") or []:
            if a["href"] not in hrefs:
                hrefs.add(a["href"])
                att.append(a)
    if att:
        g["att"] = att
    return g


def group_games(tasks, debug=None):
    """Задания 19, 20, 21 про одну игру → одно задание с тремя частями."""
    rest, by_bank = [], defaultdict(list)
    for t in tasks:
        (by_bank[t["bank"]] if t["n"] in (19, 20, 21) else rest).append(t)
    games, sizes = [], Counter()
    for bank, ts in by_bank.items():
        key = {}
        # 1) явная связь: подзадачи КомпЕГЭ (id#1, #2, #3) и поле group у OpenFIPI
        bases = {t["id"].split("#")[0] for t in ts if "#" in t["id"]}
        for t in ts:
            if t.get("grp"):
                key[t["id"]] = t["grp"]
            elif t["id"].split("#")[0] in bases:
                key[t["id"]] = t["id"].split("#")[0]
        # 2) одно и то же условие у 19, 20 и 21 (банк ЕГЭ)
        by_text = defaultdict(list)
        for t in ts:
            if t["id"] not in key:
                by_text[plain_key(t["html"])].append(t)
        for k, lst in by_text.items():
            if len(lst) < 2 or len({t["n"] for t in lst}) < 2:
                continue
            h = hashlib.md5(k.encode()).hexdigest()
            per_n = defaultdict(list)
            for t in sorted(lst, key=lambda x: x["id"]):
                per_n[t["n"]].append(t)
            # одна и та же игра может встретиться в банке несколько раз — раскладываем по копиям
            for n_, arr in per_n.items():
                for i, t in enumerate(arr):
                    key[t["id"]] = f"txt:{h}:{i}"
        # 3) OpenFIPI без поля group: в №20/21 подставлено условие №19
        base19 = {plain_key(t["html"]): t for t in ts if t["n"] == 19}
        for t in ts:
            if t["id"] in key or t["n"] == 19:
                continue
            bt = linked_base_text(t["html"])
            b = base19.get(bt) if bt else None
            if b:
                key.setdefault(b["id"], "base:" + b["id"])
                key[t["id"]] = key[b["id"]]
        # 2б) у каждого вопроса своё полное условие (Яндекс Учебник) — склеиваем по описанию игры
        by_desc = defaultdict(list)
        for t in ts:
            if t["id"] not in key and t["n"] in (19, 20, 21) and not t["html"].lstrip().startswith('<div class="linked-task">'):
                dk = desc_key(t["html"])
                if dk:
                    by_desc[dk].append(t)
        for k, lst in by_desc.items():
            if len({t["n"] for t in lst}) < 2:
                continue
            h = hashlib.md5(k.encode()).hexdigest()
            per_n = defaultdict(list)
            for t in sorted(lst, key=lambda x: x["id"]):
                per_n[t["n"]].append(t)
            for n_, arr in per_n.items():
                for i, t in enumerate(arr):
                    key[t["id"]] = f"desc:{h}:{i}"
        # 2в) почти одинаковое описание (опечатки, «е/ё») при совпадении всех чисел игры
        clusters = defaultdict(list)
        for t in ts:
            if not t["html"].lstrip().startswith('<div class="linked-task">'):
                clusters[key.get(t["id"], "solo:" + t["id"])].append(t)
        open_cl = []
        for ck, lst in clusters.items():
            if ck.split(":")[0] not in ("solo", "desc", "txt"):
                continue
            ns = {t["n"] for t in lst}
            d = max((desc_key(t["html"]) or "" for t in lst), key=len)
            if len(ns) < 3 and len(d) >= 80:
                open_cl.append({"key": ck, "ns": ns, "d": d, "nums": re.findall(r"\d+", d), "tasks": lst})
        cand = []
        for i in range(len(open_cl)):
            for j in range(i + 1, len(open_cl)):
                a, c = open_cl[i], open_cl[j]
                if a["ns"] & c["ns"] or a["nums"] != c["nums"] or a["d"][:60] != c["d"][:60]:
                    continue
                r = difflib.SequenceMatcher(None, a["d"], c["d"]).ratio()
                if r >= 0.93:
                    cand.append((r, i, j))
        for r, i, j in sorted(cand, reverse=True):
            a, c = open_cl[i], open_cl[j]
            if a.get("merged") or c.get("merged") or a["ns"] & c["ns"]:
                continue
            new_key = a["key"] if not a["key"].startswith("solo:") else "fuzzy:" + a["tasks"][0]["id"]
            for t in a["tasks"] + c["tasks"]:
                key[t["id"]] = new_key
            a["ns"] |= c["ns"]
            a["tasks"] += c["tasks"]
            a["key"] = new_key
            c["merged"] = True
        # 4) КомпЕГЭ отдельными заданиями подряд: 19 — k, 20 — k+1, 21 — k+2
        num = {}
        for t in ts:
            raw = t["id"].split(":", 1)[1]
            if raw.isdigit():
                num[int(raw)] = t
        for k, t in num.items():
            if t["n"] != 19 or t["id"] in key:
                continue
            for off, nn in ((1, 20), (2, 21)):
                o = num.get(k + off)
                if o and o["n"] == nn and o["id"] not in key and re.search(r"задани[еия]\s*19", strip_tags(o["html"]), re.I):
                    key.setdefault(t["id"], f"seq:{k}")
                    key[o["id"]] = key[t["id"]]
        grp = defaultdict(list)
        for t in ts:
            grp[key.get(t["id"], "solo:" + t["id"])].append(t)
        for gkey, parts in grp.items():
            g = make_game(bank, parts)
            sizes[len(g["parts"])] += 1
            if debug is not None:
                debug.append({"bank": bank, "key": gkey, "game": g["id"],
                              "parts": [(p["id"], p["n"], p["ans"]) for p in parts],
                              "kept": [(p["id"], p["n"]) for p in g["parts"]]})
            games.append(g)
    return rest + games, sizes


def dedup_key(t):
    """Номер + текст без разметки + ответ. Картинки, пробелы и регистр не учитываются.
    Для игр 19–21 — описание игры + ответы всех её вопросов."""
    if t.get("parts"):
        h = re.sub(r'<h3 class="gq-title">.*?</h3>', " ", t["html"])
        h = re.sub(r'<p><b>Задание 19 \(условие игры\)</b></p>', " ", h)
        d = desc_key(h) or plain_key(h)[:400]
        answers = tuple(sorted((p["n"], re.sub(r"\s+", " ", p["ans"].lower()).strip()) for p in t["parts"]))
        return ("game", hashlib.md5(d.encode()).hexdigest(), answers)
    h = t["html"]
    if h.lstrip().startswith('<div class="linked-task">') and '<hr class="subtask-sep">' in h:
        h = h.split('<hr class="subtask-sep">', 1)[1]      # подставленное условие №19 не учитываем
    txt = H.unescape(re.sub(r"<[^>]+>", " ", h)).lower().replace("ё", "е")
    txt = re.sub(r"[^0-9a-zа-я]+", "", txt)
    ans = re.sub(r"\s+", " ", t["ans"].lower()).strip()
    return (t["n"], hashlib.md5(txt.encode()).hexdigest(), ans)


def plural_ru(n, one, few, many):
    a, b = abs(n) % 100, abs(n) % 10
    if 10 < a < 20:
        return many
    return one if b == 1 else few if 1 < b < 5 else many


def is_outdated(t):
    if t.get("fmt") == "cur":
        return False
    if t.get("fmt") == "old":
        return True
    y = t.get("y")
    if not y:
        return False
    return y < max(FIRST_KEGE_YEAR, FORMAT_SINCE.get(t["n"], 0))


def add_age(t, label_year=None, dates=None, text=""):
    """Записать в задание год экзамена (y), дату появления (dt) и тип (fmt)."""
    created = None
    for key in ("createdAt", "created_at", "created", "date", "publishedAt", "published_at"):
        if dates and key in dates:
            created = dates[key]
            break
    if created is None and dates:
        created = next(iter(dates.values()))
    y = label_year
    if not y and created:
        y = exam_year_from_date(created[0], created[1])
    if y:
        t["y"] = y
    if created and created[2]:
        t["dt"] = created[2]
    f = classify_format(t["n"], text)
    if f:
        t["fmt"] = f
    return t


# ---------------------------------------------------------------- builder
class Builder:
    def __init__(self, site_dir: Path, standalone: bool):
        self.site = site_dir.resolve()
        self.standalone = standalone
        self.missing = []          # (id, что не найдено, чем заменили)
        self.skipped = Counter()   # причина -> количество
        self.skipped_examples = defaultdict(list)
        self.errors = []
        self.raw_difficulty = Counter()
        self.bad_numbers = Counter()     # какие значения number встретились у пропущенных
        self.bad_number_examples = []    # несколько пропущенных заданий целиком (сокращённо)
        self.unresolved_examples = []    # записи о файлах, которые не нашлись на диске
        self.found_by = Counter()        # как нашли файлы: путь / имя / хеш ссылки
        self._index = {}

    # --- ссылки на локальные файлы
    def link(self, path: Path, bank_dir: Path):
        path = path.resolve()
        target = path
        if self.standalone:
            try:
                rel = path.relative_to(bank_dir.resolve())
            except ValueError:
                rel = Path(path.name)
            target = self.site / "media" / bank_dir.name / rel
            if not target.exists() or target.stat().st_size != path.stat().st_size:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        try:
            rel = os.path.relpath(target, self.site)
        except ValueError:            # другой диск в Windows
            return target.as_uri()
        return quote(rel.replace(os.sep, "/"), safe="/()!~'-._")

    @staticmethod
    def find_local(value, bases):
        v = unquote(H.unescape(value).split("#")[0].split("?")[0]).replace("\\", "/").strip()
        if not v:
            return None
        variants = [v, v.lstrip("/")] if v.startswith("/") else [v]
        for b in bases:
            for vv in variants:
                p = b / vv
                if p.is_file():
                    return p
        return None

    def rewrite_html(self, h, bases, bank_dir, tid, fallback_imgs=(), remote_base=None):
        img_i = [0]

        def remote_attr(url):
            """Исходная ссылка на картинку: страница подставит её, если локального файла не окажется
            (тренажёр запущен не рядом с банками и без --standalone)."""
            if not url or not re.match(r"^https?://", url, re.I):
                return ""
            return f' data-remote="{H.escape(H.unescape(url), quote=True)}"'

        def fix_attr(tag, m):
            attr, q, val = m.groups()
            is_img = tag == "img" and attr.strip().lower() == "src"
            idx = None
            if is_img:
                idx = img_i[0]
                img_i[0] += 1
            v = val.strip()
            if not v or REMOTE_RE.match(v):
                if v.startswith("//"):
                    v = "https:" + v
                # картинка из сети, но, возможно, уже скачана в assets под хеш-именем
                if is_img and v.startswith("http"):
                    p = self.by_url_hash(v, bank_dir, remote_base)
                    if p:
                        self.found_by["картинки по хешу ссылки"] += 1
                        return f"{attr}={q}{self.link(p, bank_dir)}{q}" + ("" if self.standalone else remote_attr(v))
                return f"{attr}={q}{v}{q}"
            p = self.resolve(v, bases, bank_dir, remote_base)
            if p:
                orig = ""
                if is_img and not self.standalone:
                    if fallback_imgs and idx < len(fallback_imgs) and fallback_imgs[idx]:
                        orig = fallback_imgs[idx]
                    elif remote_base and v.startswith("/"):
                        orig = remote_base + v
                return f"{attr}={q}{self.link(p, bank_dir)}{q}" + remote_attr(orig)
            new = None
            if is_img and fallback_imgs and idx < len(fallback_imgs) and fallback_imgs[idx]:
                new = fallback_imgs[idx]
            elif remote_base and v.startswith("/"):
                new = remote_base + v
            self.missing.append((tid, v, new or ""))
            if new is None:
                return f"{attr}={q}{v}{q}"
            return f"{attr}={q}{H.escape(new, quote=True)}{q}"

        def fix_tag(m):
            tag_html, name = m.group(0), m.group(1).lower()
            tag_html = ATTR_RE.sub(lambda a: fix_attr(name, a), tag_html)
            if name == "a" and "target=" not in tag_html.lower():
                tag_html = tag_html[:-1].rstrip("/") + ' target="_blank" rel="noopener">'
            return tag_html

        return TAG_RE.sub(fix_tag, h)

    # --- индекс файлов в <банк>/assets: имя -> пути, имя без расширения -> пути
    def asset_index(self, bank_dir: Path):
        key = str(bank_dir)
        if key not in self._index:
            by_name, by_stem = defaultdict(list), defaultdict(list)
            adir = bank_dir / "assets"
            if adir.is_dir():
                for f in adir.rglob("*"):
                    if f.is_file():
                        by_name[f.name.lower()].append(f)
                        by_stem[f.stem.lower()].append(f)
            self._index[key] = (by_name, by_stem)
        return self._index[key]

    def by_basename(self, value, bank_dir):
        """Найти файл в assets по имени (только если имя уникальное)."""
        name = unquote(str(value).replace("\\", "/").split("?")[0].split("#")[0].rstrip("/").split("/")[-1]).lower()
        if not name or name in ("orig", "index.html"):
            return None
        by_name, by_stem = self.asset_index(bank_dir)
        hits = by_name.get(name) or (by_stem.get(name) if re.fullmatch(r"[0-9a-f]{16,}", name) else None)
        return hits[0] if hits and len(hits) == 1 else None

    def by_url_hash(self, url, bank_dir, remote_base=None):
        """Файлы в assets часто названы хешем ссылки — пробуем sha256/sha1/md5 разных форм ссылки."""
        if not url:
            return None
        u = H.unescape(url.strip())
        forms = {u, u.split("?")[0], u.split("#")[0]}
        for f in list(forms):
            if f.startswith("//"):
                forms.add("https:" + f)
            if remote_base and f.startswith(remote_base):
                forms.add(f[len(remote_base):])
            if remote_base and f.startswith("/"):
                forms.add(remote_base + f)
            if f.startswith("https://"):
                forms.add("http://" + f[8:])
            forms.add(f.rstrip("/").split("/")[-1])
        _, by_stem = self.asset_index(bank_dir)
        if not by_stem:
            return None
        for f in forms:
            if not f:
                continue
            b = f.encode("utf-8")
            for h in (hashlib.sha256, hashlib.sha1, hashlib.md5):
                hits = by_stem.get(h(b).hexdigest())
                if hits and len(hits) == 1:
                    return hits[0]
        return None

    def resolve(self, value, bases, bank_dir, remote_base=None):
        """Локальный файл для ссылки/пути или None. Запоминает, каким способом нашли."""
        if not isinstance(value, str) or not value.strip():
            return None
        v = value.strip()
        if REMOTE_RE.match(v) and not v.startswith("//"):
            p = self.by_url_hash(v, bank_dir, remote_base)
            if p:
                self.found_by["по хешу ссылки"] += 1
            return p
        p = self.find_local(v, bases)
        if p:
            self.found_by["по пути"] += 1
            return p
        # Windows-путь целиком с другой машины/диска
        if re.match(r"^[a-zA-Z]:[\\/]", v) and Path(v).is_file():
            self.found_by["по полному пути"] += 1
            return Path(v)
        p = self.by_basename(v, bank_dir)
        if p:
            self.found_by["по имени в assets"] += 1
            return p
        if remote_base and v.startswith("/"):
            p = self.by_url_hash(remote_base + v, bank_dir, remote_base)
            if p:
                self.found_by["по хешу ссылки"] += 1
                return p
        return None

    @staticmethod
    def _strings(obj):
        """Все строки внутри записи (в том числе во вложенных словарях/списках)."""
        if isinstance(obj, str):
            yield obj
        elif isinstance(obj, dict):
            for v in obj.values():
                yield from Builder._strings(v)
        elif isinstance(obj, list):
            for v in obj:
                yield from Builder._strings(v)

    def attachments(self, entries, bases, bank_dir, tid, scan_dirs=(), remote_base=None, folder=None):
        found = {}      # имя (нижний регистр) -> {"name", "href"} локальный
        remote = {}     # имя -> {"name", "href"} из сети
        unresolved = []

        def display_name(e, fallback):
            if isinstance(e, dict):
                for k in ("name", "title", "original_name", "originalName", "filename", "fileName", "fname"):
                    if isinstance(e.get(k), str) and e[k].strip():
                        return Path(e[k].strip().replace("\\", "/")).name
            return fallback

        for e in entries or []:
            if not isinstance(e, (str, dict)):
                continue
            strings = [x.strip() for x in self._strings(e) if isinstance(x, str) and x.strip()]
            # сначала поля с известными именами, затем всё остальное
            if isinstance(e, dict):
                pri = [e.get(k) for k in ("local", "local_path", "localPath", "path", "file", "saved", "saved_as",
                                          "savedAs", "asset", "stored", "dst", "dest", "sha256", "hash")]
                strings = [x for x in pri if isinstance(x, str) and x.strip()] + strings
            urls = [x for x in strings if REMOTE_RE.match(x) or x.startswith("/files/")]
            hit = None
            for x in strings:
                if len(x) > 400 or "\n" in x:
                    continue
                hit = self.resolve(x, bases, bank_dir, remote_base)
                if hit:
                    break
            url = next((u for u in urls if not u.startswith("#")), None)
            if url and url.startswith("/") and remote_base:
                url = remote_base + url
            fallback = Path(unquote((url or (hit.name if hit else "файл")).split("?")[0]).replace("\\", "/")).name
            name = display_name(e, fallback)
            if hit:
                found.setdefault(name.lower(), {"name": name, "href": self.link(hit, bank_dir)})
            elif url and REMOTE_RE.match(url):
                same = next((r for r in remote.values() if r["href"] == url), None)
                url_name = Path(unquote(url.split("?")[0])).name
                if same:
                    if same["name"] == url_name and name != url_name:
                        same["name"] = name   # «24.txt» понятнее, чем «C1.txt»
                else:
                    remote[name.lower()] = {"name": name, "href": url}
                unresolved.append((name, e, url))
            else:
                unresolved.append((name, e, None))

        # файлы, просто лежащие рядом с заданием
        for d in scan_dirs:
            if not d.is_dir():
                continue
            for f in sorted(d.rglob("*")):
                if f.is_file() and f.suffix.lower() in FILE_EXT and f.name.lower() not in SERVICE_FILES:
                    found.setdefault(f.name.lower(), {"name": f.name, "href": self.link(f, bank_dir)})

        out = list(found.values())
        remote_hrefs = set()
        for v in remote.values():
            if v["name"].lower() not in found:
                out.append(v)
                remote_hrefs.add(v["href"])
        # в отчёт — только то, чего нет локально ни под каким именем, по одному разу на ссылку
        reported = set()
        for name, e, url in unresolved:
            r = next((v for v in remote.values() if v["href"] == url), None) if url else None
            shown = r["name"] if r else name
            if shown.lower() in found or name.lower() in found:
                continue
            key = url or name.lower()
            if key in reported:
                continue
            reported.add(key)
            self.missing.append((tid, "файл " + shown, url if r and url in remote_hrefs else ""))
            if len(self.unresolved_examples) < 8:
                self.unresolved_examples.append((tid, str(folder or ""), e))
        return out

    def bad_number(self, d, where):
        self.bad_numbers[repr(d.get("number"))] += 1
        if len(self.bad_number_examples) < 3:
            short = {k: (v[:80] + "…" if isinstance(v, str) and len(v) > 80 else v)
                     for k, v in d.items() if k not in ("text", "text_html", "solve_text")}
            self.bad_number_examples.append((str(where), short))
        return self.skip("номер вне 1–27 или не указан", where)

    def skip(self, reason, where):
        self.skipped[reason] += 1
        if len(self.skipped_examples[reason]) < 10:
            self.skipped_examples[reason].append(str(where))

    # --- формат ege_bank: tasks/**/<id>.json
    def parse_ege(self, d, p: Path, bank_dir: Path):
        bank = bank_dir.name
        num = to_int(d.get("number"))
        raw_id = str(d.get("id") or p.stem)
        tid = f"{bank}:{raw_id}"
        if not num or not 1 <= num <= 27:
            return self.bad_number(d, p)
        ans = clean_answer(d.get("answer"))
        if not ans:
            return self.skip("нет ответа", p)
        raw_html = d.get("text_html") or ""
        text = d.get("text") or ""
        if not raw_html.strip():
            raw_html = text_to_html(text)
        topic = find_topic(text) or find_topic(strip_tags(raw_html))
        dnum, dlabel = parse_level(d.get("level"))
        src = re.sub(r"^\s*Автор\s*:\s*", "", str(d.get("source") or "")).strip() or None

        asset_dirs = [x for x in bank_dir.glob(f"assets/*/{raw_id}") if x.is_dir()]
        bases = [bank_dir, p.parent]
        h = strip_ege_header(raw_html)
        h = self.rewrite_html(h, bases, bank_dir, tid, d.get("images_original") or [])
        h = clean_styles(h)
        att = self.attachments(d.get("files"), bases, bank_dir, tid, asset_dirs, folder=p)
        t = {"id": tid, "n": num, "bank": bank, "html": h, "ans": ans}
        if topic: t["topic"] = topic
        if dnum: t["d"] = dnum
        if dlabel: t["lv"] = dlabel
        if src: t["src"] = src
        if att: t["att"] = att
        if d.get("url"): t["link"] = d["url"]
        if d.get("group"): t["grp"] = f"{bank}:{d['group']}"      # OpenFIPI: 19–21 одной игры
        plain = (topic or "") + " " + strip_tags(h)
        label_year = year_from_label(src) or year_from_label(
            " ".join(re.findall(r"(?:ЕГЭ|КЕГЭ|[Дд]емоверси\w*|[Аа]пробаци\w*)[^0-9\n]{0,15}20[12]\d", text or "")))
        add_age(t, label_year, find_dates(d), plain)
        # решение (есть у части заданий OpenFIPI)
        sol = d.get("solution_html") or ""
        if sol.strip():
            t["sol"] = clean_styles(self.rewrite_html(sol, bases, bank_dir, tid))
        # отметка актуальности из открытого банка ФИПИ важнее даты
        if d.get("actual") is True and t.get("fmt") != "old":
            t["fmt"] = "cur"
        elif d.get("actual") is False:
            t["fmt"] = "old"
        return t

    # --- формат kompege_bank: tasks/**/<папка>/task.json + condition.html + answer.html
    def parse_kompege(self, p: Path, bank_dir: Path):
        d = json.loads(p.read_text(encoding="utf-8"))
        return self.parse_kompege_dict(d, p, bank_dir, own_folder=True)

    def parse_kompege_dict(self, d, p: Path, bank_dir: Path, own_folder: bool):
        bank = bank_dir.name
        folder = p.parent
        num = to_int(d.get("number"))
        raw_id = str(d.get("taskId") or d.get("id") or (folder.name if own_folder else p.stem))
        tid = f"{bank}:{raw_id}"
        if not num or not 1 <= num <= 27:
            return [self.bad_number(d, p)]
        cond_file = folder / "condition.html"
        has_subs = bool(d.get("subTask"))
        if has_subs and (d.get("text") or "").strip():
            h = d["text"]                     # в condition.html уже склеены все подзадачи — берём только основной вопрос
        elif own_folder and cond_file.is_file():
            h = body_inner(cond_file.read_text(encoding="utf-8"))
            if has_subs:
                h = re.split(r"<h2[^>]*>\s*Задание", h, maxsplit=1)[0]
        else:
            h = d.get("text") or ""
        bases = [folder, bank_dir]
        scan = ([folder] if own_folder else []) \
            + [x for x in bank_dir.glob(f"assets/*/{raw_id}") if x.is_dir()] \
            + [x for x in bank_dir.glob(f"assets/{raw_id}") if x.is_dir()]
        h = clean_styles(self.rewrite_html(h, bases, bank_dir, tid, remote_base=KOMPEGE_SITE))

        att_entries = []
        af = folder / "attachments.json"
        if own_folder and af.is_file():
            try:
                a = json.loads(af.read_text(encoding="utf-8"))
                att_entries += a if isinstance(a, list) else [a]
            except Exception as e:
                self.errors.append(f"{af}: {e}")
        att_entries += d.get("files") or []
        att = self.attachments(att_entries, bases, bank_dir, tid, scan, remote_base=KOMPEGE_SITE, folder=folder)

        self.raw_difficulty[repr(d.get("difficulty"))] += 1
        dnum, dlabel = parse_level(d.get("difficulty"))
        src = "КомпЕГЭ" + (f" · {d['comment']}" if d.get("comment") else "")
        link = f"{KOMPEGE_SITE}/task?id={d['taskId']}" if d.get("taskId") else None
        video = None
        if d.get("video") and (d.get("videotype") in (None, "", "yt", "youtube")):
            video = {"yt": str(d["video"]), "t": to_int(d.get("timecode")) or 0}
        sol = d.get("solve_text") or ""
        if sol.strip():
            sol = clean_styles(self.rewrite_html(sol, bases, bank_dir, tid, remote_base=KOMPEGE_SITE))

        dates = find_dates(d)
        label_year = year_from_label(d.get("comment"))

        def make(id_, n, html, ans):
            t = {"id": id_, "n": n, "bank": bank, "html": html, "ans": ans, "src": src}
            add_age(t, label_year, dates, strip_tags(html))
            if dnum: t["d"] = dnum
            if dlabel: t["lv"] = dlabel
            if att: t["att"] = att
            if link: t["link"] = link
            if video: t["video"] = video
            if sol.strip(): t["sol"] = sol
            return t

        result = []
        ans = clean_answer(d.get("key"))
        if not ans and own_folder:
            af2 = folder / "answer.html"
            if af2.is_file():
                ah = re.split(r"<h2[^>]*>", body_inner(af2.read_text(encoding="utf-8")), maxsplit=1)[0]
                ans = clean_answer(strip_tags(ah))
        subs = d.get("subTask") or []
        if ans:
            result.append(make(tid, num, h, ans))
        elif not subs:
            return [self.skip("нет ответа", p)]
        # составные задания (например, 19–21): каждая подзадача — отдельное задание
        subs = [st for st in (subs if isinstance(subs, list) else []) if isinstance(st, dict)]
        declared = [to_int(st.get("number")) for st in subs]
        # у подзадач 19–21 номер бывает не указан или везде «19» — тогда нумеруем по порядку
        sequential = num == 19 and subs and (None in declared or len(set(declared)) < len(declared))
        for i, st in enumerate(subs):
            k = clean_answer(st.get("key") or st.get("answer"))
            if not k:
                continue
            sn = (num + i + (1 if ans else 0)) if sequential else (declared[i] or num)
            if sequential and sn > 21:
                continue
            if not 1 <= sn <= 27:
                continue
            st_html = st.get("text") or ""
            if st_html.strip():
                st_html = clean_styles(self.rewrite_html(st_html, bases, bank_dir, tid, remote_base=KOMPEGE_SITE))
            # подзадача 19–21 — только свой вопрос (условие игры — в основном задании); прочие — с общим условием
            if num in (19, 20, 21) and sn in (19, 20, 21) and st_html.strip():
                full = st_html
            else:
                full = h + (f'<hr class="subtask-sep"><div class="subtask">{st_html}</div>' if st_html.strip() else "")
            result.append(make(f"{tid}#{i + 1}", sn, full, k))
        if subs and len(result) > 1:
            for t in result:
                if t["n"] in (19, 20, 21):
                    t["grp"] = tid             # одна игра: основной вопрос и подзадачи
        return result

    def build_bank(self, bank_dir: Path):
        tasks_dir = bank_dir / "tasks"
        if not tasks_dir.is_dir():
            print(f"  ! нет папки {tasks_dir}, пропускаю")
            return []
        out = []
        kompege_dirs = set()
        for p in sorted(tasks_dir.rglob("task.json")):
            kompege_dirs.add(p.parent)
            try:
                out += [t for t in self.parse_kompege(p, bank_dir) if t]
            except Exception as e:
                self.errors.append(f"{p}: {e!r}")
        for p in sorted(tasks_dir.rglob("*.json")):
            if p.parent in kompege_dirs or p.name.lower() in SERVICE_FILES:
                continue
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                self.errors.append(f"{p}: {e!r}")
                continue
            items = data if isinstance(data, list) else [data]
            for d in items:
                if not isinstance(d, dict):
                    continue
                if "key" in d and "text" in d and "text_html" not in d:
                    # формат КомпЕГЭ одним файлом, без отдельной папки
                    try:
                        out += [t for t in self.parse_kompege_dict(d, p, bank_dir, own_folder=False) if t]
                    except Exception as e:
                        self.errors.append(f"{p}: {e!r}")
                    continue
                try:
                    t = self.parse_ege(d, p, bank_dir)
                    if t:
                        out.append(t)
                except Exception as e:
                    self.errors.append(f"{p}: {e!r}")
        return out


# ---------------------------------------------------------------- main
def find_root(banks):
    """Папка с банками, если --root не задан: рядом с тренажёром, выше по папкам или в Biblio там."""
    cands, a = [], HERE
    for _ in range(4):
        cands += [a.parent, a.parent / "Biblio"]
        a = a.parent
    for c in cands:
        if any((c / b).is_dir() for b in banks):
            return c
    return HERE.parent


def main():
    ap = argparse.ArgumentParser(description="Сборка банка заданий для тренажёра")
    ap.add_argument("--root", help="папка Biblio с банками (по умолчанию ищется рядом с тренажёром и выше)")
    ap.add_argument("--bank", action="append", help="имя папки банка (можно несколько раз)")
    ap.add_argument("--site", default=str(HERE), help="папка сайта (где лежит index.html)")
    ap.add_argument("--standalone", action="store_true",
                    help="скопировать картинки и файлы в <site>/media, чтобы сайт не зависел от банков")
    args = ap.parse_args()

    banks = args.bank or DEFAULT_BANKS
    root = Path(args.root).resolve() if args.root else find_root(banks).resolve()
    site = Path(args.site).resolve()
    b = Builder(site, args.standalone)

    all_tasks, bank_meta = [], []
    print(f"Корень: {root}")
    for name in banks:
        bd = root / name
        if not bd.is_dir():
            if name not in OPTIONAL_BANKS or args.bank:
                print(f"  ! папка {bd} не найдена, пропускаю")
            continue
        print(f"→ {name} ...", flush=True)
        ts = b.build_bank(bd)
        # дубли id внутри банка
        seen, uniq = set(), []
        for t in ts:
            if t["id"] in seen:
                b.skip("повтор id", t["id"])
                continue
            seen.add(t["id"])
            uniq.append(t)
        print(f"  заданий: {len(uniq)}")
        all_tasks += uniq
        bank_meta.append({"id": name, "title": BANK_TITLES.get(name, name), "count": len(uniq)})

    if not all_tasks:
        print("Не найдено ни одного задания. Проверьте --root и --bank.")
        sys.exit(1)

    # 19–21 про одну игру — в одно задание (до поиска дублей, чтобы не растерять части игр)
    all_tasks, game_sizes = group_games(all_tasks)

    # одно и то же задание из разных банков (тот же номер, текст и ответ) — оставляем первое
    dup_count = Counter()
    if len(bank_meta) > 1:
        seen_sig, uniq = {}, []
        for t in all_tasks:
            sig = dedup_key(t)
            first = seen_sig.get(sig)
            if first and first["bank"] != t["bank"]:
                dup_count[t["bank"]] += 1
                # у копии могут быть решение или видео — переносим, если у первого их нет
                for k in ("sol", "video"):
                    if t.get(k) and not first.get(k):
                        first[k] = t[k]
                continue
            seen_sig.setdefault(sig, t)
            uniq.append(t)
        all_tasks = uniq
        for m in bank_meta:
            m["count"] -= dup_count[m["id"]]
        if dup_count:
            print("Дубли между банками убраны: " + ", ".join(f"{k} — {v}" for k, v in dup_count.items()))

    for m in bank_meta:
        m["count"] = sum(1 for t in all_tasks if t["bank"] == m["id"])
    all_tasks.sort(key=lambda t: (t["n"], t["bank"], t["id"]))
    payload = {"generated": datetime.now().isoformat(timespec="seconds"),
               "banks": bank_meta, "tasks": all_tasks}
    data_dir = site / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    js = "window.EGE_BANK = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (data_dir / "bank.js").write_text(js, encoding="utf-8")

    # отчёт
    per = defaultdict(Counter)
    for t in all_tasks:
        per[t["bank"]][t["n"]] += 1
    lines = [f"Сборка: {payload['generated']}", f"Всего заданий: {len(all_tasks)}",
             "Задания 19–21 (одна игра — одно задание): " + ", ".join(
                 f"{k} {plural_ru(k, 'вопрос', 'вопроса', 'вопросов')} — {v}" for k, v in sorted(game_sizes.items(), reverse=True)), ""]
    if dup_count:
        lines[-1:-1] = ["Дубли между банками (не вошли, оставлено задание из банка выше по списку): " +
                        ", ".join(f"{k} — {v}" for k, v in dup_count.items())]
    head = "№   " + "".join(f"{m['id'][:14]:>16}" for m in bank_meta) + "       всего"
    lines.append(head)
    for n in range(1, 28):
        row = [per[m["id"]][n] for m in bank_meta]
        lines.append(f"{n:<4}" + "".join(f"{c:>16}" for c in row) + f"{sum(row):>12}")
    with_att = sum(1 for t in all_tasks if t.get("att"))
    with_topic = sum(1 for t in all_tasks if t.get("topic"))
    with_d = sum(1 for t in all_tasks if t.get("d"))
    lines += ["", f"С файлами: {with_att}   С темой: {with_topic}   Со сложностью: {with_d}"]
    # годы и актуальность
    years = defaultdict(Counter)
    for t in all_tasks:
        years[t["bank"]][t.get("y") or "нет"] += 1
    lines += ["", "Год экзамена (по подписи задания или дате появления):"]
    for bank_id, cnt in years.items():
        ks = sorted((k for k in cnt if k != "нет")) + (["нет"] if "нет" in cnt else [])
        lines.append(f"  {bank_id}: " + ", ".join(f"{k}: {cnt[k]}" for k in ks))
    old_per = Counter(t["n"] for t in all_tasks if is_outdated(t))
    fmt_per = defaultdict(Counter)
    for t in all_tasks:
        if t["n"] in FMT_RULES:
            fmt_per[t["n"]][t.get("fmt") or "?"] += 1
    lines.append("Устаревшие (старый тип задания или год до смены формата): " +
                 (", ".join(f"№{n}: {c}" for n, c in sorted(old_per.items())) or "нет"))
    lines.append("Тип по тексту для №6, 13, 22, 27 (cur — новый, old — старый, ? — не распознан): " +
                 "; ".join(f"№{n}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())) for n, c in sorted(fmt_per.items())))
    if b.raw_difficulty:
        lines.append("Значения difficulty в КомпЕГЭ: " +
                     ", ".join(f"{k}: {v}" for k, v in sorted(b.raw_difficulty.items())))
    if b.found_by:
        lines.append("Найдено локально: " + ", ".join(f"{k} — {v}" for k, v in b.found_by.most_common()))
    if b.skipped:
        lines += ["", "Пропущено:"]
        for r, c in b.skipped.items():
            lines.append(f"  {r}: {c}")
            for ex in b.skipped_examples[r]:
                lines.append(f"      {ex}")
    if b.bad_numbers:
        lines += ["", "Значения number у пропущенных по номеру: " +
                  ", ".join(f"{k}: {v}" for k, v in b.bad_numbers.most_common(15))]
        for where, d in b.bad_number_examples:
            lines.append(f"  пример {where}:")
            lines.append("    " + json.dumps(d, ensure_ascii=False)[:1500])
    if b.unresolved_examples:
        lines += ["", "Примеры записей о файлах, которые не нашлись на диске:"]
        for tid, folder, e in b.unresolved_examples:
            lines.append(f"  {tid}  ({folder})")
            lines.append("    " + json.dumps(e, ensure_ascii=False)[:600])
            fp = Path(folder)
            if fp.is_dir():
                aj = fp / "attachments.json"
                if aj.is_file():
                    lines.append("    attachments.json: " + aj.read_text(encoding="utf-8", errors="replace")[:600].replace("\n", " "))
                lines.append("    в папке: " + ", ".join(sorted(x.name for x in fp.iterdir()))[:300])
    if b.missing:
        lines += ["", f"Не найдено локально ({len(b.missing)}), первые 100:"]
        for tid, what, repl in b.missing[:100]:
            lines.append(f"  {tid}: {what}" + (f"  → взято из сети: {repl}" if repl else "  → НЕТ ЗАМЕНЫ"))
    if b.errors:
        lines += ["", f"Ошибки чтения ({len(b.errors)}):"] + [f"  {e}" for e in b.errors[:100]]
    (data_dir / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    size_mb = (data_dir / "bank.js").stat().st_size / 1e6
    print(f"\nГотово: {len(all_tasks)} заданий → {data_dir / 'bank.js'} ({size_mb:.1f} МБ)")
    if b.skipped:
        print("Пропущено: " + ", ".join(f"{r} — {c}" for r, c in b.skipped.items()))
    if b.missing:
        print(f"Не найдено локально картинок/файлов: {len(b.missing)} (подробно в data/report.txt)")
    if b.errors:
        print(f"Ошибок чтения: {len(b.errors)} (подробно в data/report.txt)")
    print("Откройте index.html в браузере.")


if __name__ == "__main__":
    main()
