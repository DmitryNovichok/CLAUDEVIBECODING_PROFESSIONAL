"""Canonical display metadata for the approved FIPI 2027 specification.

IDs of lessons, Python modules, exercises and stored progress never change here.
See docs/learning-2027.md for the primary source and verification date.
"""
from copy import deepcopy

EDITION = {"year": 2027, "status": "approved", "label": "КИМ ЕГЭ-2027 · утверждённая демоверсия ФИПИ", "checked": "2026-11-16",
           "source": "https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/inf_11_2027.zip"}

TOPICS = (
    {'n': 1, 'title': 'Графы и таблицы', 'lesson_n': 1, 'archive': False, 'label': '1', 'model': None},
    {'n': 2, 'title': 'Таблица истинности', 'lesson_n': 2, 'archive': False, 'label': '2', 'model': None},
    {'n': 3, 'title': 'Базы данных', 'lesson_n': 3, 'archive': False, 'label': '3', 'model': None},
    {'n': 4, 'title': 'Кодирование и условие Фано', 'lesson_n': 4, 'archive': False, 'label': '4', 'model': None},
    {'n': 5, 'title': 'Алгоритмы преобразования числа', 'lesson_n': 5, 'archive': False, 'label': '5', 'model': 'alg'},
    {'n': 6, 'title': 'Черепаха', 'lesson_n': 6, 'archive': False, 'label': '6', 'model': None},
    {'n': 7, 'title': 'Изображения и звук', 'lesson_n': 7, 'archive': False, 'label': '7', 'model': 'image'},
    {'n': 8, 'title': 'Комбинаторика слов', 'lesson_n': 8, 'archive': False, 'label': '8', 'model': None},
    {'n': 9, 'title': 'Электронные таблицы', 'lesson_n': 9, 'archive': False, 'label': '9', 'model': None},
    {'n': 10, 'title': 'Поиск слова в тексте', 'lesson_n': 10, 'archive': False, 'label': '10', 'model': None},
    {'n': 11, 'title': 'Объём информации', 'lesson_n': 11, 'archive': False, 'label': '11', 'model': None},
    {'n': 12, 'title': 'Машина Тьюринга', 'lesson_n': 12, 'archive': False, 'label': '12', 'model': None},
    {'n': 13, 'title': 'IP-адреса и маски', 'lesson_n': 13, 'archive': False, 'label': '13', 'model': 'net'},
    {'n': 14, 'title': 'Системы счисления', 'lesson_n': 14, 'archive': False, 'label': '14', 'model': None},
    {'n': 15, 'title': 'Логические выражения', 'lesson_n': 15, 'archive': False, 'label': '15', 'model': 'logic'},
    {'n': 16, 'title': 'Рекурсия', 'lesson_n': 16, 'archive': False, 'label': '16', 'model': None},
    {'n': 17, 'title': 'Последовательности и пары', 'lesson_n': 17, 'archive': False, 'label': '17', 'model': 'pairs'},
    {'n': 18, 'title': 'Робот и динамическое программирование', 'lesson_n': 18, 'archive': False, 'label': '18', 'model': None},
    {'n': 19, 'title': 'Игры: позиции и стратегии', 'lesson_n': 19, 'archive': False, 'label': '19', 'model': 'game'},
    {'n': 20, 'title': 'Игры: позиции и стратегии', 'lesson_n': 19, 'archive': False, 'label': '20', 'model': 'game'},
    {'n': 21, 'title': 'Игры: позиции и стратегии', 'lesson_n': 19, 'archive': False, 'label': '21', 'model': 'game'},
    {'n': 22, 'title': 'Параллельные процессы', 'lesson_n': 22, 'archive': False, 'label': '22', 'model': None},
    {'n': 23, 'title': 'Исполнитель: траектории программ', 'lesson_n': 23, 'archive': False, 'label': '23', 'model': None},
    {'n': 24, 'title': 'Обработка строк', 'lesson_n': 24, 'archive': False, 'label': '24', 'model': 'str'},
    {'n': 25, 'title': 'Делители и маски', 'lesson_n': 25, 'archive': False, 'label': '25', 'model': 'mask'},
    {'n': 26, 'title': 'Сортировка и моделирование', 'lesson_n': 26, 'archive': False, 'label': '26', 'model': 'sort'},
    {'n': 27, 'title': 'Анализ данных и кластеризация', 'lesson_n': 27, 'archive': False, 'label': '27', 'model': 'clust'},
    {'n': 28, 'title': 'Архив 23_old · пути в графе', 'lesson_n': 28, 'archive': True, 'label': '23_old', 'model': 'graph'},
)

PYTHON_TOPICS = {
    'm01': [],
    'm00': [],
    'm02': [2],
    'm05': [5],
    'm06': [6],
    'm07': [7, 11],
    'm08': [8],
    'm09': [9],
    'm13': [13],
    'm12': [],
    'm30': [12],
    'm23': [23],
    'm14': [14],
    'm15': [15],
    'm16': [16],
    'm17': [17],
    'm19': [19, 20, 21],
    'm22': [22],
    'm31': [28],
    'm24': [24],
    'm33': [24],
    'm25': [25],
    'm34': [25],
    'm26': [26],
    'm35': [26],
    'm27': [27],
    'm36': [27],
    'm32': [27],
}

ARDUINO_TRACKS = {"junior": "7 класс", "senior": "10–11 классы"}
ARDUINO_TOTALS = {"junior": 36, "senior": 36}
TRACE_EXAMPLES = {"sum": "Сумма чисел", "branch": "Условие и цикл", "list": "Изменение списка", "function": "Вызовы функций"}

LAB_MODELS = {
    "alg": "Алгоритмы", "image": "Изображения", "net": "IP-сети", "logic": "Логика", "pairs": "Пары",
    "game": "Игры", "str": "Строки", "mask": "Маски и делители", "sort": "Сортировка", "clust": "Кластеры",
    "graph": "Графы",
}
# The game tree is explored by playing positions. The other models include a prediction form.
PREDICTION_MODELS = frozenset(LAB_MODELS) - {"game"}


def python_metadata(module):
    """A shallow metadata copy: exercises and their IDs/progress keys are untouched."""
    nums = PYTHON_TOPICS.get(module['id'], module.get('exam_nums') or ([module['n']] if module.get('n') else []))
    n = nums[0] if nums else None
    archive = any(t['n'] == n and t['archive'] for t in TOPICS)
    return {**module, **({'sub': 'Архивная практика: пути в графах и расстояния. Не отдельный номер КИМ-2027.'} if archive else {}),
            'n': n, 'exam_nums': list(nums), 'archive': archive,
            'group': 'extra' if archive or module['id'] == 'm12' else 'ege' if nums else 'base'}


def public_catalog():
    labs = []
    for model, title in LAB_MODELS.items():
        rows = [t for t in TOPICS if t['model'] == model]
        nums = [t['n'] for t in rows]
        label = '19–21' if nums == [19, 20, 21] else ' · '.join(t['label'] for t in rows)
        labs.append({'id': model, 'title': title, 'nums': nums, 'label': label,
                     'archive': all(t['archive'] for t in rows)})
    return {'edition': dict(EDITION), 'topics': deepcopy(TOPICS), 'labs': labs}
