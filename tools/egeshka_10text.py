#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Задания №10 КИМ 2027 «Поиск в тексте» для банка Egeshka (Egeshka Malevin D.) — на уровне заданий ФИПИ и КомпЕГЭ.

Тексты — 10 произведений русской классики (общественное достояние): «Поединок», «Отцы и дети», «Капитанская дочка»,
«Дубровский», «Тарас Бульба», «Гранатовый браслет», «Мертвые души», «Алые паруса», «Пиковая дама»,
«Герой нашего времени». Сам текст и сноски лежат в tools/books10/<книга>.json.gz; документы оформляются здесь заново:
к каждому заданию — архив с тремя форматами, как на экзамене: 10.docx (сноски — настоящие сноски Word),
10.odt (сноски LibreOffice) и 10.txt (сноски — [N] в тексте и список «Примечания» в конце файла).

Ответ считает программа по тексту 10.txt — так же, как «Найти» в текстовом редакторе:
  «только слово целиком» — слово не продолжается буквой или цифрой с обеих сторон;
  «учитывать регистр» — заглавные и строчные различаются; без него — нет;
  сочетание букв «в составе других слов» = все вхождения минус вхождения отдельным словом.
Задания составлены так, чтобы спорных мест не было: искомое сочетание не встречается в названии и заголовках глав,
рядом с дефисом, апострофом или знаком сноски, а если в нём есть «е»/«ё» — то и в написании через другую букву.

    python3 tools/egeshka_10text.py      # задания №10 в data/egeshka_bank.json и архивы в media/egeshka_bank/10t/

Задания помечены "kim": 2027 — сервер не переносит их номер. Сид фиксированный: повторный запуск даёт то же самое.
"""
import gzip
import html
import json
import random
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "data" / "egeshka_bank.json"
BOOKS_DIR = ROOT / "tools" / "books10"
MEDIA = ROOT / "media" / "egeshka_bank" / "10t"
SRC = "Egeshka Malevin D."
TODAY = "2026-11-16"
PREFIX = "egeshka_bank:e10b-"
OLD_PREFIXES = ("egeshka_bank:e10t-", PREFIX)
ZIP_DATE = (2026, 11, 16, 0, 0, 0)          # постоянная дата в архивах — файлы не меняются при пересборке

BOOKS = ["duel", "otcy", "kap", "dub", "taras", "gran", "md", "alye", "pik", "geroy"]
AUTHOR_FULL = {"duel": "Александр Куприн", "otcy": "Иван Тургенев", "kap": "Александр Пушкин", "dub": "Александр Пушкин",
               "taras": "Николай Гоголь", "gran": "Александр Куприн", "md": "Николай Гоголь", "alye": "Александр Грин",
               "pik": "Александр Пушкин", "geroy": "Михаил Лермонтов"}
L = "А-Яа-яЁёA-Za-z0-9"
MARK = re.compile("(\\d+)")
NOTES_HEAD = "Примечания"
GEROY_PHRASE = {
    "Предисловие": "в тексте предисловия к роману",
    "Бэла": "в тексте повести «Бэла»",
    "Максим Максимыч": "в тексте повести «Максим Максимыч»",
    "Предисловие к журналу Печорина": "в тексте предисловия к журналу Печорина",
    "Тамань": "в тексте повести «Тамань»",
    "Княжна Мери": "в тексте повести «Княжна Мери»",
    "Фаталист": "в тексте повести «Фаталист»",
}
PAIRS = [("да", "нет"), ("он", "она"), ("тут", "там"), ("здесь", "там"), ("всегда", "никогда"), ("теперь", "тогда"),
         ("день", "ночь"), ("утро", "вечер"), ("отец", "мать"), ("мы", "вы"), ("я", "ты"), ("сказал", "отвечал"),
         ("вдруг", "опять"), ("много", "мало"), ("лучше", "хуже"), ("брат", "сестра"), ("дом", "двор"), ("рука", "нога"),
         ("глаза", "лицо"), ("старый", "молодой"), ("большой", "маленький"), ("вот", "вон"), ("уж", "уже"),
         ("потом", "тогда"), ("очень", "слишком"), ("тихо", "громко"), ("друг", "враг"), ("сударь", "барин")]
NUM_WORD = {2: "двух", 3: "трёх", 4: "четырёх", 5: "пяти", 6: "шести"}
FUNC_WORDS = ["и", "в", "не", "на", "он", "она", "они", "я", "с", "что", "как", "а", "но", "по", "его", "к", "это", "все",
              "так", "за", "же", "вы", "ты", "мы", "у", "от", "из", "бы", "был", "была", "о", "вот", "да", "нет", "уже",
              "еще", "только", "когда", "даже", "ни", "их", "ее", "ему", "сказал", "теперь", "тут", "там", "очень"]


# ================================================================ книга и её текст
def load(key):
    with gzip.open(BOOKS_DIR / f"{key}.json.gz", "rt", encoding="utf-8") as f:
        return json.load(f)


def title_case(s):
    s = s.strip().lower()
    s = s[:1].upper() + s[1:]
    return re.sub(r"«(\w)", lambda m: "«" + m.group(1).upper(), s)


def heading(book, u):
    if book["named"]:
        return u["label"]
    if u["label"] == "Заключение":
        return "Заключение"
    h = f"Глава {u['label']}"
    sub = ""
    if len(u["head"]) > 1:
        sub = u["head"][1]                                   # «Капитанская дочка»: Глава I / Сержант гвардии
    elif u["head"] and re.match(r"^[IVXLCХ]+\.\s+\S", u["head"][0]):
        sub = title_case(u["head"][0].split(".", 1)[1])      # «Алые паруса»: I. ПРЕДСКАЗАНИЕ
    return f"{h}. {sub}" if sub else h


def front(book, key):
    return [AUTHOR_FULL[key], book["title"]]


def as_txt(p):
    return MARK.sub(lambda m: f"[{m.group(1)}]", p)


def unit_texts(book):
    """Текст каждой главы так, как он стоит в 10.txt между заголовками (сноски — [N])."""
    return ["\n" + "\n".join(as_txt(p) for p in u["paras"]) + "\n" for u in book["units"]]


def notes_lines(book):
    return [f"[{i}] {t}" for i, t in enumerate(book["notes"], 1)]


def write_txt(book, key):
    lines = front(book, key) + [""]
    for u in book["units"]:
        lines += [heading(book, u)] + [as_txt(p) for p in u["paras"]]
    if book["notes"]:
        lines += [NOTES_HEAD] + notes_lines(book)
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- .docx со сносками
def _esc(s):
    return html.escape(s, quote=False)


def _runs(text, sz=26):
    out = []
    for i, piece in enumerate(MARK.split(text)):
        if i % 2:
            out.append(f'<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="{piece}"/></w:r>')
        elif piece:
            out.append(f'<w:r><w:rPr><w:sz w:val="{sz}"/></w:rPr><w:t xml:space="preserve">{_esc(piece)}</w:t></w:r>')
    return "".join(out)


def _p(text, head=False):
    if head:
        return ('<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="360" w:after="160"/></w:pPr>'
                f'<w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>')
    return f'<w:p><w:pPr><w:ind w:firstLine="567"/><w:spacing w:after="80"/><w:jc w:val="both"/></w:pPr>{_runs(text)}</w:p>'


NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def docx_bytes(book, key):
    body = [_p(x, True) for x in front(book, key)]
    for u in book["units"]:
        body.append(_p(heading(book, u), True))
        body += [_p(p) for p in u["paras"]]
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS_W}><w:body>' + "".join(body) +
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" '
           'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
    fns = ['<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
           '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>']
    for i, t in enumerate(book["notes"], 1):
        fns.append(f'<w:footnote w:id="{i}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
                   f'<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> {_esc(t)}</w:t></w:r></w:p></w:footnote>')
    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
            '</Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>',
        "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
            '</Relationships>',
        "word/settings.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {NS_W}>'
            '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>',
        "word/footnotes.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes {NS_W}>' + "".join(fns) + "</w:footnotes>",
        "word/document.xml": doc,
    }
    return _zip_bytes(parts)


# ---------------------------------------------------------------- .odt со сносками
def _odt_inline(text):
    out = []
    for i, piece in enumerate(MARK.split(text)):
        if i % 2:
            note = _esc(BOOK_NOTES[int(piece) - 1])
            out.append(f'<text:note text:id="ftn{piece}" text:note-class="footnote"><text:note-citation>{piece}</text:note-citation>'
                       f'<text:note-body><text:p text:style-name="Footnote">{note}</text:p></text:note-body></text:note>')
        elif piece:
            out.append(_esc(piece))
    return "".join(out)


BOOK_NOTES = []


def odt_bytes(book, key):
    BOOK_NOTES[:] = book["notes"]
    body = [f'<text:h text:style-name="H" text:outline-level="1">{_esc(x)}</text:h>' for x in front(book, key)]
    for u in book["units"]:
        body.append(f'<text:h text:style-name="H" text:outline-level="2">{_esc(heading(book, u))}</text:h>')
        body += [f'<text:p text:style-name="P">{_odt_inline(p)}</text:p>' for p in u["paras"]]
    content = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
               'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
               'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
               'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">'
               '<office:automatic-styles>'
               '<style:style style:name="H" style:family="paragraph"><style:paragraph-properties fo:text-align="center" '
               'fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="15pt" fo:font-weight="bold"/></style:style>'
               '<style:style style:name="P" style:family="paragraph"><style:paragraph-properties fo:text-indent="1cm" '
               'fo:text-align="justify" fo:margin-bottom="0.14cm"/><style:text-properties fo:font-size="13pt"/></style:style>'
               '<style:style style:name="Footnote" style:family="paragraph"><style:text-properties fo:font-size="10pt"/></style:style>'
               '</office:automatic-styles><office:body><office:text>' + "".join(body) +
               '</office:text></office:body></office:document-content>')
    manifest = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
                '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                '</manifest:manifest>')
    return _zip_bytes({"mimetype": "application/vnd.oasis.opendocument.text", "content.xml": content,
                       "META-INF/manifest.xml": manifest}, stored_first="mimetype")


def _zip_bytes(parts, stored_first=None):
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_STORED if name == stored_first else zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)
    return buf.getvalue()


def write_archive(book, key):
    MEDIA.mkdir(parents=True, exist_ok=True)
    path = MEDIA / f"{key}.zip"
    files = {"10.docx": docx_bytes(book, key), "10.odt": odt_bytes(book, key), "10.txt": write_txt(book, key)}
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)
    return path


# ================================================================ подсчёт, как «Найти» в редакторе
def _flags(case):
    return 0 if case else re.I


def whole(t, w, case=False):
    return len(re.findall(rf"(?<![{L}]){re.escape(w)}(?![{L}])", t, _flags(case)))


def total(t, w, case=False):
    return len(re.findall(re.escape(w), t, _flags(case)))


def part(t, w, case=False):
    return total(t, w, case) - whole(t, w, case)


def start(t, w, case=False):
    """Слова, которые начинаются с сочетания w, но не само слово w."""
    return len(re.findall(rf"(?<![{L}]){re.escape(w)}(?=[{L}])", t, _flags(case)))


class Book:
    def __init__(self, key):
        self.key = key
        self.b = load(key)
        self.units = unit_texts(self.b)
        self.notes = notes_lines(self.b)
        self.notes_text = "\n".join(self.notes)
        self.heads = "\n".join(front(self.b, key) + [heading(self.b, u) for u in self.b["units"]] + [NOTES_HEAD])
        self.everything = "\n".join(self.units) + "\n" + self.notes_text
        self.numbered = [i for i, u in enumerate(self.b["units"]) if u["label"] not in ("Заключение",) and not self.b["named"]]
        self.tokens = re.findall(rf"[{L}]+", "\n".join(self.units))
        self.upper_tokens = {x for x in re.findall(rf"[{L}]+", self.everything) if len(x) > 1 and x.isupper()}

    def scope(self, idx, with_notes=False):
        t = "".join(self.units[i] for i in idx)
        if with_notes:
            refs = set(re.findall(r"\[(\d+)\]", t))
            t += "\n".join(x for x in self.notes if x[1:].split("]")[0] in refs)
        return t

    def notes_in(self, idx):
        refs = set(re.findall(r"\[(\d+)\]", "".join(self.units[i] for i in idx)))
        return "\n".join(x for x in self.notes if x[1:].split("]")[0] in refs)

    def clean(self, w):
        """Сочетание без спорных мест: нет в заголовках, рядом с дефисом/апострофом/сноской, нет е↔ё и ЗАГЛАВНЫМИ."""
        if re.search(re.escape(w), self.heads, re.I):
            return False
        for m in re.finditer(re.escape(w), self.everything, re.I):
            a, b = m.start(), m.end()
            near = self.everything[a - 1:a] + self.everything[b:b + 1]
            if re.search(r"[-‑'’\[\]]", near):
                return False
        if any(len(x) > 1 and x.isupper() and w.upper() in x for x in self.upper_tokens):
            return False                                     # слова ЗАГЛАВНЫМИ буквами: «x» или «X» было бы неточно
        sw = w.replace("е", "\0").replace("ё", "е").replace("\0", "ё")
        if sw != w and re.search(re.escape(sw), self.everything, re.I):
            return False
        return True


# ================================================================ формулировки
def unit_name(bk, i):
    return bk.b["units"][i]["label"]


def join_ru(xs):
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " и " + xs[-1]


def selector(bk, rnd, kind):
    """-> (номера глав, фраза «в тексте …»). kind: all / one / two / three / range / even / except / first / last."""
    b = bk.b
    n_units = len(b["units"])
    genre = b["genre"]
    if kind == "all":
        return list(range(n_units)), f"в тексте {genre}"
    if b["named"]:
        if kind == "except":
            k = rnd.choice([1, 4])
            return [i for i in range(n_units) if i != k], f"в тексте романа, за исключением {GEROY_PHRASE[unit_name(bk, k)][9:]}"
        if kind in ("two", "three", "range", "even", "first", "last"):
            a = rnd.randrange(n_units - 1)
            ks = [a, a + 1]
            names = [GEROY_PHRASE[unit_name(bk, k)][9:] for k in ks]
            return ks, "в тексте " + " и ".join(names)
        k = rnd.choice([1, 2, 4, 5, 6])
        return [k], GEROY_PHRASE[unit_name(bk, k)]
    nums = bk.numbered
    lab = lambda i: unit_name(bk, i)
    if kind == "one":
        k = rnd.choice(nums)
        return [k], f"в тексте главы {lab(k)}"
    if kind == "two":
        a = rnd.choice(nums[:-1])
        ks = [a, a + 1] if rnd.random() < .6 else sorted(rnd.sample(nums, 2))
        return ks, f"в тексте глав {lab(ks[0])} и {lab(ks[1])}"
    if kind == "three":
        a = rnd.choice(nums[:-2])
        ks = [a, a + 1, a + 2]
        return ks, f"в тексте глав {join_ru([lab(k) for k in ks])}"
    if kind == "range":
        a = rnd.choice(nums[:max(1, len(nums) - 3)])
        z = min(nums[-1], a + rnd.randint(2, 4))
        return list(range(a, z + 1)), f"в тексте глав с {lab(a)} по {lab(z)} включительно"
    if kind == "even":
        ev = rnd.random() < .5
        ks = [i for i in nums if (i + 1) % 2 == (0 if ev else 1)]
        return ks, f"в тексте глав с {'чётными' if ev else 'нечётными'} номерами"
    if kind == "except":
        ks = sorted(rnd.sample(nums, 2))
        return [i for i in range(n_units) if i not in ks], f"в тексте {genre}, за исключением глав {lab(ks[0])} и {lab(ks[1])}"
    if kind in ("first", "last"):
        c = rnd.randint(2, 5)
        if kind == "last" and len(nums) < n_units:
            kind = "first"                                   # «Пиковая дама»: после глав — «Заключение»
        ks = nums[:c] if kind == "first" else nums[-c:]
        return ks, f"в тексте {'первых' if kind == 'first' else 'последних'} {NUM_WORD[c]} глав"
    raise ValueError(kind)


def form_example(bk, w, idx):
    """Пример другой формы слова: «солдат» → «солдаты» (берём из того же текста)."""
    if len(w) < 4 or w in FUNC_WORDS:
        return None                                         # «вы» → «вышла» — не форма слова
    t = bk.scope(idx)
    cands = {}
    for x in re.findall(rf"(?<![{L}]){re.escape(w)}[а-яё]{{1,2}}(?![{L}])", t, re.I):
        x = x.lower()
        if 1 <= len(x) - len(w) <= 2:
            cands[x] = cands.get(x, 0) + 1
    return max(cands, key=cands.get) if cands else None


# ================================================================ задания
KINDS = {
    # тип: (как считать, регистр, текст условия)
    "word": "слово",            # отдельное слово, любой регистр
    "word_low": "строчная",     # отдельное слово со строчной
    "word_cap": "прописная",    # отдельное слово с прописной
    "part": "в составе",        # только в составе других слов, любой регистр
    "part_low": "в составе, строчная",
    "any": "всего",             # и в составе, и отдельно
    "start": "начало слова",    # слова, начинающиеся с сочетания (само слово не считается)
    "pair": "два слова",        # сумма двух отдельных слов
}

# план одной книги: (тип, выбор глав, сноски: None / "без" / "со")
PLAN = [("word", "all", None), ("word_low", "two", None), ("word_cap", "one", None), ("part", "all", None),
        ("part_low", "three", None), ("any", "one", None), ("start", "range", None), ("pair", "even", None),
        ("word", "except", None), ("part", "first", None)]
PLAN_NOTES = [("word", "all", "со"), ("word_low", "two", None), ("word_cap", "one", None), ("part", "all", "без"),
              ("part_low", "three", None), ("any", "one", None), ("start", "range", None), ("pair", "even", None),
              ("word", "except", None), ("part", "last", None)]


def count(bk, kind, w, idx, notes_mode, w2=None):
    t = bk.scope(idx, with_notes=(notes_mode == "со"))
    if kind == "word":
        return whole(t, w)
    if kind in ("word_low", "word_cap"):
        return whole(t, w, case=True)
    if kind == "part":
        return part(t, w)
    if kind == "part_low":
        return part(t, w, case=True)
    if kind == "any":
        return total(t, w)
    if kind == "start":
        return start(t, w)
    if kind == "pair":
        return whole(t, w) + whole(t, w2)
    raise ValueError(kind)


def cap(w):
    return w[:1].upper() + w[1:]


def question(bk, kind, w, sel_phrase, notes_mode, example=None, w2=None):
    b = bk.b
    notes = ""
    if notes_mode == "без":
        notes = ", не считая сносок,"
    elif notes_mode == "со":
        notes = ", учитывая текст сносок,"
    head = f"Текст {b['genre']} {b['author']} «{b['title']}» представлен в виде файлов различных форматов. Откройте один из файлов и определите"
    forms = (f" Другие формы слова «{w}», такие как «{example}», учитывать не следует." if example
             else " Другие формы этого слова учитывать не следует.")
    if kind == "word":
        q = f"{head}, сколько раз{notes} встречается слово «{w}» или «{cap(w)}» {sel_phrase}.{forms}"
    elif kind == "word_low":
        q = f"{head}, сколько раз{notes} встречается отдельное слово «{w}» со строчной буквы {sel_phrase}.{forms}"
    elif kind == "word_cap":
        q = (f"{head}, сколько раз{notes} встречается отдельное слово «{w}», начинающееся с прописной буквы, {sel_phrase}."
             f"{forms}")
    elif kind == "part":
        q = (f"{head}, сколько раз{notes} встречается сочетание букв «{w}» или «{cap(w)}» только в составе других слов, "
             f"но не как отдельное слово, {sel_phrase}.")
    elif kind == "part_low":
        q = (f"{head}, сколько раз{notes} встречается сочетание букв «{w}» со строчной буквы только в составе других слов, "
             f"но не как отдельное слово, {sel_phrase}.")
    elif kind == "any":
        q = (f"{head}, сколько раз{notes} встречается сочетание букв «{w}» или «{cap(w)}» — как в составе других слов, "
             f"так и как отдельное слово, — {sel_phrase}.")
    elif kind == "start":
        q = (f"{head}, сколько{notes} {sel_phrase} слов, которые начинаются с сочетания букв «{w}» или «{cap(w)}». "
             f"Само слово «{w}» («{cap(w)}») не учитывайте; если слово начинается с этого сочетания, считайте его один раз.")
    elif kind == "pair":
        q = (f"{head}, сколько раз{notes} в сумме встречаются отдельные слова «{w}» и «{w2}» (в любом регистре) "
             f"{sel_phrase}. Другие формы этих слов учитывать не следует.")
    else:
        raise ValueError(kind)
    q = q.replace("  ", " ").replace(" ,", ",")
    return ('<p><b><i>Задание выполняется с использованием прилагаемых файлов.</i></b></p>'
            f"<p>{html.escape(q, quote=False)}</p><p>В ответе укажите только число.</p>")


# ---------------------------------------------------------------- разбор
WORD_HOW = {
    "word": "в «Найти» (Ctrl+H → «Больше») отметьте «Только слово целиком», «Учитывать регистр» не отмечайте",
    "word_low": "отметьте «Только слово целиком» и «Учитывать регистр», ищите слово со строчной буквы",
    "word_cap": "отметьте «Только слово целиком» и «Учитывать регистр», ищите слово с прописной буквы",
    "part": "найдите сочетание без «Только слово целиком» (это все вхождения), затем — с «Только слово целиком» "
            "(отдельные слова) и вычтите второе число из первого",
    "part_low": "то же с «Учитывать регистр»: все вхождения сочетания со строчной буквы минус вхождения отдельным словом",
    "any": "ищите сочетание без «Только слово целиком» и без «Учитывать регистр» — это и есть ответ",
    "start": "включите «Подстановочные знаки» и ищите &lt;сочетание (начало слова) — отдельно со строчной и с прописной "
             "буквы, так как с подстановочными знаками регистр учитывается всегда; из суммы вычтите вхождения сочетания "
             "отдельным словом («Только слово целиком»)",
    "pair": "найдите каждое слово с «Только слово целиком» без учёта регистра и сложите",
}


def sol_html(bk, kind, notes_mode, sel_phrase):
    where = ("Выделите нужные главы (через Ctrl — несколько фрагментов) и в «Найти» выберите «Найти в → Текущий фрагмент»."
             if "глав" in sel_phrase or "повести «" in sel_phrase or "предислов" in sel_phrase
             else "Поиск ведите по всему документу.")
    notes = ""
    if notes_mode == "без":
        notes = " Сноски не считаются: в «Найти в» выберите «Основной документ» (в Word сноски — отдельная часть документа)."
    elif notes_mode == "со":
        notes = " Сноски считаются: сложите найденное в «Основном документе» и в «Сносках»."
    elif bk.b["notes"]:
        notes = " Текст сносок к заданию не относится — ищите в «Основном документе»."
    return f"<p>В текстовом редакторе: {where} Затем {WORD_HOW[kind]}.{notes}</p>"


def py_code(bk, kind, w, idx, notes_mode, w2=None):
    b = bk.b
    lines = ["import re", "text = open('10.txt', encoding='utf-8').read()"]
    if b["notes"]:
        lines.append(f"text, _, notes = text.partition('\\n{NOTES_HEAD}\\n')   # сноски — в конце файла")
    if b["named"]:
        names = "|".join(u["label"] for u in b["units"])
        lines.append(f"parts = re.split(r'^(?:{names})$', text, flags=re.M)   # parts[1] — первая часть")
    else:
        lines.append("parts = re.split(r'^(?:Глава [IVXLC]+.*|Заключение)$', text, flags=re.M)   # parts[k] — глава k")
    n = len(b["units"])
    if idx == list(range(n)):
        lines.append("t = ''.join(parts[1:])                     # весь текст без названия и заголовков")
    else:
        labels = [unit_name(bk, i) for i in idx]
        lines.append("t = " + " + ".join(f"parts[{i + 1}]" for i in idx) + f"   # {', '.join(labels)}")
    if notes_mode == "со":
        lines.append("refs = set(re.findall(r'\\[(\\d+)\\]', t))                 # сноски, на которые есть ссылки в этом тексте")
        lines.append("t += '\\n'.join(s for s in notes.splitlines() if s[1:].split(']')[0] in refs)")
    lines.append(f"L = '{L}'")
    flag = ", flags=re.I"
    if kind == "word":
        lines.append(f"print(len(re.findall(rf'(?<![{{L}}]){w}(?![{{L}}])', t{flag})))")
    elif kind in ("word_low", "word_cap"):
        lines.append(f"print(len(re.findall(rf'(?<![{{L}}]){w}(?![{{L}}])', t)))")
    elif kind in ("part", "part_low"):
        f = flag if kind == "part" else ""
        lines.append(f"everywhere = len(re.findall('{w}', t{f}))")
        lines.append(f"alone = len(re.findall(rf'(?<![{{L}}]){w}(?![{{L}}])', t{f}))")
        lines.append("print(everywhere - alone)")
    elif kind == "any":
        lines.append(f"print(len(re.findall('{w}', t{flag})))")
    elif kind == "start":
        lines.append(f"print(len(re.findall(rf'(?<![{{L}}]){w}(?=[{{L}}])', t{flag})))   # начало слова, дальше ещё буква")
    elif kind == "pair":
        lines.append(f"print(sum(len(re.findall(rf'(?<![{{L}}]){{x}}(?![{{L}}])', t{flag})) for x in ('{w}', '{w2}')))")
    return '<pre class="py-sol"><code>' + html.escape("\n".join(lines)) + "</code></pre>"


# ---------------------------------------------------------------- подбор слов
def candidates(bk, kind, rnd):
    toks = bk.tokens
    low = [x for x in toks if x.islower()]
    freq = {}
    for x in low:
        freq[x] = freq.get(x, 0) + 1
    if kind == "pair":
        pool = [a for a, _ in PAIRS]
    elif kind in ("word", "word_low"):
        pool = [w for w in FUNC_WORDS if freq.get(w, 0) >= 3] + [w for w, c in freq.items() if len(w) >= 4 and 4 <= c <= 120]
    elif kind == "word_cap":
        capf = {}
        for x in toks:
            if x[:1].isupper() and x[1:].islower():
                capf[x] = capf.get(x, 0) + 1
        pool = [w for w, c in capf.items() if c >= 3 and freq.get(w.lower(), 0) >= 1] or [w for w, c in capf.items() if c >= 5]
    elif kind in ("part", "part_low", "any"):
        pool = [w for w, c in freq.items() if 2 <= len(w) <= 5 and c >= 1]
    else:                                                     # start
        pool = [w for w, c in freq.items() if 2 <= len(w) <= 5 and c >= 1]
    pool = sorted(set(pool))
    rnd.shuffle(pool)
    return pool


def make_task(bk, rnd, kind, sel_kind, notes_mode, used):
    lo, hi = (8, 600) if sel_kind in ("all", "except") else (3, 250)
    for _ in range(60):
        idx, phrase = selector(bk, rnd, sel_kind)
        if notes_mode and not bk.notes_in(idx):
            continue
        for w in candidates(bk, kind, rnd)[:400]:
            if (kind, w) in used or not bk.clean(w):
                continue
            w2 = None
            if kind == "pair":
                pair = next((p for p in PAIRS if p[0] == w), None)
                if not pair or not bk.clean(pair[1]) or (kind, pair[1]) in used:
                    continue
                w2 = pair[1]
            ans = count(bk, kind, w, idx, notes_mode, w2)
            if not lo <= ans <= hi:
                continue
            # условие должно «работать»: регистр, отдельные слова, сноски меняют ответ
            t = bk.scope(idx)
            if kind == "word_low" and whole(t, cap(w), case=True) == 0:
                continue
            if kind == "word_cap" and whole(t, w.lower(), case=True) == 0:
                continue
            if kind in ("part", "part_low", "start") and whole(t, w, case=(kind == "part_low")) == 0:
                continue
            if kind == "part_low" and part(t, cap(w), case=True) == 0:
                continue
            if notes_mode and count(bk, kind, w, idx, "со" if notes_mode == "без" else None, w2) == ans:
                continue                                      # слово есть и в сносках — иначе оговорка ни на что не влияет
            if kind == "any" and part(t, w) == 0:
                continue
            example = form_example(bk, w.lower(), idx) if kind in ("word", "word_low", "word_cap") else None
            if example and kind == "word_cap":
                example = cap(example)
            used.add((kind, w))
            if w2:
                used.add((kind, w2))
            return {"html": question(bk, kind, w, phrase, notes_mode, example, w2), "ans": str(ans),
                    "sol": sol_html(bk, kind, notes_mode, phrase) + py_code(bk, kind, w, idx, notes_mode, w2),
                    "meta": {"kind": kind, "w": w, "w2": w2, "idx": idx, "notes": notes_mode}}
    raise RuntimeError(f"{bk.key}: не подобрано задание {kind}/{sel_kind}/{notes_mode}")


def build_tasks():
    rnd = random.Random(20261116)
    out, k = [], 0
    for key in BOOKS:
        bk = Book(key)
        path = write_archive(bk.b, key)
        att = [{"name": "10.zip", "href": path.relative_to(ROOT).as_posix()}]
        used = set()
        plan = PLAN_NOTES if bk.b["notes"] else PLAN
        if bk.b["named"]:
            plan = [(kd, s if s in ("all", "one", "two", "except") else "one", nm) for kd, s, nm in plan]
        for kind, sel_kind, notes_mode in plan:
            t = make_task(bk, rnd, kind, sel_kind, notes_mode, used)
            k += 1
            out.append({"id": f"{PREFIX}{k:03d}", "n": 10, "kim": 2027, "bank": "egeshka_bank", "html": t["html"],
                        "ans": t["ans"], "src": SRC, "y": 2027, "dt": TODAY, "topic": "Поиск в тексте",
                        "sol": t["sol"], "att": att, "_meta": dict(t["meta"], book=key)})
    return out


def main():
    data = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    keep = [t for t in data["tasks"] if not t["id"].startswith(OLD_PREFIXES)]
    new = build_tasks()
    meta = [dict(id=t["id"], ans=t["ans"], **t.pop("_meta")) for t in new]
    data["tasks"] = keep + new
    data["bank"]["count"] = len(data["tasks"])
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")   # как tools/gen_egeshka.py
    for old in MEDIA.glob("e10-*"):
        old.unlink()                                          # файлы прежней версии (короткие повести)
    print(f"№10 (КИМ 2027): {len(new)} заданий по {len(BOOKS)} книгам, архивы в {MEDIA.relative_to(ROOT)}")
    return meta


if __name__ == "__main__":
    main()
