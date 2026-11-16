"""Offline, student-disjoint forecast evaluation. Never changes the live model.

Inputs are frozen predictions and independently recorded mock-exam scores.
No confidence intervals or evidence of real-world accuracy are manufactured.
"""
import csv
import hashlib
import io
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ('student_key', 'exam_key', 'predicted_at', 'exam_started_at', 'exam_finished_at',
          'prediction', 'actual', 'independent_answers_30d', 'covered_numbers_30d', 'model_version', 'source')
KEY = re.compile(r'[A-Za-z0-9_.:-]{1,80}\Z')
SOURCES = {'supervised_mock', 'external_mock', 'platform_mock', 'synthetic'}
MAX_BYTES = 20 * 1024 * 1024
MIN_STUDENTS = {'train': 30, 'validation': 15, 'holdout': 15}
SPLIT_VERSION = 'egeshka-student-disjoint-v1'


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class Observation:
    student: str
    exam: str
    predicted_at: float
    started: float
    finished: float
    prediction: float
    actual: int
    independent_answers: int
    covered: int
    model_version: str
    source: str


def timestamp(value):
    try:
        value = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError()
        return value.timestamp()
    except (TypeError, ValueError, OverflowError):
        raise DatasetError('Дата должна содержать часовой пояс: YYYY-MM-DDTHH:MM:SS+00:00') from None


def number(value, low, high, *, integer=False):
    try:
        result = float(value)
        if not math.isfinite(result) or not low <= result <= high or integer and result != int(result):
            raise ValueError()
        return int(result) if integer else result
    except (TypeError, ValueError, OverflowError):
        raise DatasetError(f'Ожидается {"целое " if integer else ""}число от {low} до {high}') from None


def read_csv(path):
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise DatasetError('CSV превышает 20 Мбайт')
    try:
        content = path.read_text(encoding='utf-8-sig')
    except UnicodeError:
        raise DatasetError('Нужна кодировка UTF-8') from None
    reader = csv.DictReader(io.StringIO(content))
    if reader.fieldnames is None or set(reader.fieldnames) != set(FIELDS) or len(reader.fieldnames) != len(FIELDS):
        raise DatasetError('Набор столбцов не совпадает с шаблоном; ФИО, почта и токены не принимаются')
    rows, seen = [], set()
    for line, raw in enumerate(reader, 2):
        try:
            if None in raw or any(v is None for v in raw.values()):
                raise DatasetError('Неверное число столбцов')
            for key in ('student_key', 'exam_key', 'model_version'):
                if not KEY.fullmatch(raw[key]):
                    raise DatasetError(f'{key}: нужен обезличенный код без пробелов, адреса почты или ссылок')
            predicted, started, finished = (timestamp(raw[k]) for k in FIELDS[2:5])
            if not predicted < started <= finished:
                raise DatasetError('Прогноз должен быть зафиксирован до начала пробника, окончание — не раньше начала')
            if started - predicted > 30 * 86400:
                raise DatasetError('Прогноз старше 30 дней; обновите выборку или оцените старые прогнозы отдельно')
            if finished - started > 24 * 3600:
                raise DatasetError('Продолжительность пробника превышает сутки')
            if finished > datetime.now(timezone.utc).timestamp():
                raise DatasetError('Фактический результат не может относиться к будущему пробнику')
            score = number(raw['prediction'], 0, 100)
            actual = number(raw['actual'], 0, 100, integer=True)
            answers = number(raw['independent_answers_30d'], 0, 1000000, integer=True)
            covered = number(raw['covered_numbers_30d'], 0, 27, integer=True)
            if covered > answers:
                raise DatasetError('Номеров с данными больше, чем самостоятельных ответов')
            if raw['source'] not in SOURCES:
                raise DatasetError('Неизвестный источник результата пробника')
            identity = raw['student_key'], raw['exam_key']
            if identity in seen:
                raise DatasetError('Повтор одного пробника ученика; оставьте один заранее зафиксированный прогноз')
            seen.add(identity)
            rows.append(Observation(raw['student_key'], raw['exam_key'], predicted, started, finished,
                                    score, actual, answers, covered, raw['model_version'], raw['source']))
        except DatasetError as exc:
            raise DatasetError(f'Строка {line}: {exc}') from None
        if len(rows) > 100000:
            raise DatasetError('Больше 100000 наблюдений; разделите импорт по версии модели')
    if not rows:
        raise DatasetError('CSV не содержит наблюдений')
    if len({r.model_version for r in rows}) != 1:
        raise DatasetError('Нельзя смешивать версии модели; подготовьте отдельный CSV для каждой')
    if any(r.source == 'synthetic' for r in rows) and not all(r.source == 'synthetic' for r in rows):
        raise DatasetError('Учебные данные нельзя смешивать с настоящими результатами')
    return rows


def split_for(student):
    # Every examination of one pupil stays in the same immutable partition.
    bucket = int.from_bytes(hashlib.sha256((SPLIT_VERSION + ':' + student).encode()).digest()[:8], 'big') % 10
    return 'train' if bucket < 6 else 'validation' if bucket < 8 else 'holdout'


def weights(rows):
    counts = {}
    for row in rows:
        counts[row.student] = counts.get(row.student, 0) + 1
    return [1 / counts[row.student] for row in rows]


def metrics(rows, offset=0):
    if not rows:
        return {'exams': 0, 'students': 0, 'mae': None, 'rmse': None, 'bias': None, 'within_5': None}
    errors = [max(0, min(100, row.prediction + offset)) - row.actual for row in rows]
    w = weights(rows)
    total = sum(w)
    mean = lambda values: sum(a * b for a, b in zip(values, w)) / total
    return {'exams': len(rows), 'students': len({r.student for r in rows}),
            'mae': round(mean([abs(e) for e in errors]), 3),
            'rmse': round(math.sqrt(mean([e * e for e in errors])), 3),
            'bias': round(mean(errors), 3), 'within_5': round(mean([abs(e) <= 5 for e in errors]), 4)}


def evaluate(rows):
    groups = {name: [r for r in rows if split_for(r.student) == name] for name in MIN_STUDENTS}
    sizes = {name: len({r.student for r in subset}) for name, subset in groups.items()}
    sufficient = all(sizes[name] >= count for name, count in MIN_STUDENTS.items())
    synthetic = all(r.source == 'synthetic' for r in rows)
    baseline = {name: metrics(subset) for name, subset in groups.items()}
    candidate_offset, validation, chosen = None, None, 0
    if sufficient:
        train = groups['train']
        w = weights(train)
        candidate_offset = sum((r.actual-r.prediction)*weight for r,weight in zip(train,w))/sum(w)
        validation = metrics(groups['validation'], candidate_offset)
        # Only validation chooses the candidate. Holdout is never used to tune it.
        if validation['mae'] <= baseline['validation']['mae'] - 0.5:
            chosen = candidate_offset
    holdout = groups['holdout']
    bands = []
    for low, high in ((0,40),(40,60),(60,80),(80,101)):
        subset = [r for r in holdout if low <= r.prediction < high]
        bands.append({'predicted_band': f'{low}–{high-1}', 'baseline': metrics(subset), 'selected': metrics(subset,chosen)})
    adequate = [r for r in rows if r.covered == 27 and r.independent_answers >= 27]
    return {
        'schema': 1, 'model_version': rows[0].model_version,
        'dataset_kind': 'synthetic_only' if synthetic else 'declared_mock_results',
        'status': 'descriptive_holdout' if sufficient and not synthetic else 'synthetic_test' if synthetic else 'insufficient_sample',
        'split_policy': SPLIT_VERSION, 'minimum_students': MIN_STUDENTS, 'student_counts': sizes,
        'weighting': 'Each pupil has total weight one within each reported group.',
        'baseline': baseline,
        'candidate': {'kind': 'train_mean_offset', 'offset': round(candidate_offset,6) if candidate_offset is not None else None,
                      'validation': validation, 'required_mae_improvement': 0.5},
        'selected_offset': round(chosen,6), 'selected_holdout': metrics(holdout,chosen),
        'holdout_by_predicted_band': bands,
        'coverage': {'definition': 'All 27 numbers represented by independent answers in the previous 30 days.',
                     'exams': len(rows), 'adequate_exams': len(adequate), 'fraction': round(len(adequate)/len(rows),4)},
        'applied_to_live_model': False, 'confidence_interval': None,
        'limitations': [
            'Source, timestamps and independence are declarations in the import; this tool cannot attest to proctoring.',
            'The reported accuracy describes this dataset, not future exam performance or a causal effect of studying.',
            'Do not change partitions after viewing holdout results. New tuning requires a new prospective holdout.',
            'No automatic model update occurs; inspect per-band errors and compare a prospective cohort before adoption.',
        ],
    }


def markdown(report):
    title = 'Учебные данные: не оценка точности сайта' if report['dataset_kind'] == 'synthetic_only' else 'Проверка прогноза по импортированным пробникам'
    lines = [f'# {title}', '', f"Версия модели: `{report['model_version']}`. Статус: `{report['status']}`.", '',
             'Группы учеников не пересекаются. Каждый ученик имеет одинаковый суммарный вес внутри группы.', '',
             '| Выборка | Учеников | Пробников | Средняя абсолютная ошибка | Смещение прогноз − факт |',
             '|---|---:|---:|---:|---:|']
    for name in ('train','validation','holdout'):
        m = report['baseline'][name]
        lines.append(f"| {name} | {m['students']} | {m['exams']} | {m['mae'] if m['mae'] is not None else 'нет данных'} | {m['bias'] if m['bias'] is not None else 'нет данных'} |")
    lines += ['', 'Группы подготовки определяются исходным прогнозом, до просмотра результата пробника.', '',
              '| Исходный прогноз | Учеников holdout | Ошибка исходной модели | Ошибка выбранного варианта |', '|---|---:|---:|---:|']
    for band in report['holdout_by_predicted_band']:
        lines.append(f"| {band['predicted_band']} | {band['baseline']['students']} | {band['baseline']['mae']} | {band['selected']['mae']} |")
    c=report['coverage']
    lines += ['', f"Полное свежее покрытие: {c['adequate_exams']} из {c['exams']} пробников. Это 27 номеров за 30 дней; не гарантия точности.",
              f"Проверяемая поправка: {report['candidate']['offset']}; выбранная на validation: {report['selected_offset']} балла.",
              'Для подбора нужно минимум 30 учеников train, 15 validation и 15 holdout. При нехватке данных поправка не подбирается.',
              'Изменения на сайт не применены. Доверительный интервал не рассчитывается.', '',
              'Результаты и время пробников должны быть настоящими и независимо зафиксированными. Инструмент проверяет формат и порядок событий, но не происхождение оценок.',
              'Не подбирайте разбиение под результат. После просмотра holdout дальнейшие изменения проверяйте на новой будущей группе.', '']
    return '\n'.join(lines)
