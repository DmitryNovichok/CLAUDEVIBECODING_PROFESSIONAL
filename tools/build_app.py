#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Собирает app.js и отложенные app-exams.js / app-learning.js из модулей src/app/*.js.

Основные модули — куски общей функции-обёртки. МЦКО и Интеллектуальный мегаполис
собираются отдельно и получают только явно переданный интерфейс приложения.
Править нужно src/app/*.js, затем запустить:

    python3 tools/build_app.py          # пересобрать app.js
    python3 tools/build_app.py --check  # только проверить, что app.js собран из текущих модулей

Все готовые скрипты хранятся в репозитории: сайт работает и без сборки,
в том числе при открытии index.html двойным кликом.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "app"
OUT = ROOT / "app.js"
EXAMS_OUT = ROOT / "app-exams.js"
LEARNING_OUT = ROOT / "app-learning.js"
LEARNING_PARTS = ("03b-course-ui.js", "12a-learning.js", "12b-pycourse.js", "12j-labs.js", "12k-buglab.js")
EXAM_PARTS = frozenset(('12n-mcko.js', '12o-im.js'))
BANNER = "// Собрано из src/app/*.js командой python3 tools/build_app.py — правьте модули, а не этот файл.\n"


def build():
    parts = [p for p in sorted(SRC.glob("*.js")) if p.name not in EXAM_PARTS and p.name not in LEARNING_PARTS]
    if not parts:
        raise SystemExit(f"нет модулей в {SRC}")
    out = [BANNER]
    for i, p in enumerate(parts):
        text = p.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        if i:                                   # у первого модуля сначала идёт заголовок файла
            out.append(f"  // ═══════ {p.relative_to(ROOT).as_posix()}\n")
        out.append(text)
    return "".join(out)


def build_exams():
    """An ordinary same-origin script: no eval, shared lexical scope or preload."""
    out = [BANNER, "window.EgeExamSections = function (bridge) {\n  'use strict';\n",
           "  const { $, $$, api, esc, plural, safeHtml, toast, trainerEl, hubRefresh, renderMath, toggleCalc, appState } = bridge;\n"]
    for name in sorted(EXAM_PARTS):
        path = SRC / name
        out += [f"  // ═══════ {path.relative_to(ROOT).as_posix()}\n", path.read_text(encoding='utf-8'), '\n']
    out.append("  return { openMcko, openIm };\n};\n")
    return ''.join(out)


def build_learning():
    """Optional UI receives explicit callbacks and live accessors, never eval."""
    out = [BANNER, "window.EgeLearningSections = function (bridge) {\n  'use strict';\n",
           "  const { $, $$, ARCHIVE, COURSE, COURSE_SETS, COURSE_SET_NOTES, EgePythonWorker, MARK, MARK_BTN, NUM_TOPIC, PY, PY_KW, RULES, SERVER, TASKS, abandonCurrent, api, appState, asgLeft, badgeCls, bdOpen, byId, codeKey, courseSet, esc, highlightPy, htmlWait, isNarrow, leaveExam, loadCourseSets, markAttach, navPush, needHtml, netError, numLabel, numStats, openSetTask, pct, plural, pyOpen, pySync, pycSetAccess, readCode, readJSON, renderMath, renderSidebar, safeHtml, setScope, setSideOpen, toast, toggleBoard, togglePy, trainerEl, visible, writeCode, writeJSON } = bridge;\n"]
    for name in LEARNING_PARTS:
        path = SRC / name
        out += [f"  // ═══════ {path.relative_to(ROOT).as_posix()}\n", path.read_text(encoding='utf-8'), '\n']
    out.append("  return { openCourse, openLesson, openCourseSet, openPyc, openPycLevel, openLab, openLabAssignment, openArdGate, pycStopTests, labStop, pycDockTools, resetLearningState, refreshLearningAccess };\n};\n")
    return ''.join(out)


def main():
    outputs = {OUT: build(), EXAMS_OUT: build_exams(), LEARNING_OUT: build_learning()}
    if "--check" in sys.argv:
        for path, text in outputs.items():
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                raise SystemExit(f"{path.name} не совпадает с src/app/*.js — запустите python3 tools/build_app.py")
        print("app.js, app-exams.js и app-learning.js собраны из текущих модулей")
        return
    for path, text in outputs.items():
        path.write_text(text, encoding="utf-8")
        print(f"{path.name}: {text.count(chr(10))} строк")


if __name__ == "__main__":
    main()
