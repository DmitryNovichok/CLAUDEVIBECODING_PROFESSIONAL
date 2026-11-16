"""Independent mathematical checks for the added geometry and tape examples.

The geometrical oracles read commands from conditions and use unit-cell/interval
reasoning, not the shoelace or unit-segment implementations printed on slides.
Tape properties use symbol counts and parity; they are independent of the
state-machine execution used in the displayed answers.
"""
import contextlib
from fractions import Fraction
import html
import io
import itertools
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent


def slide(n, title):
    rows = json.loads((ROOT / 'course' / f'{n}.json').read_text())['slides']
    return next(row for row in rows if row['h'] == title)


def execute(row):
    namespace = {}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(compile(row['code'], '<reviewed-course-example>', 'exec'), namespace)
    return namespace, out.getvalue().strip()


def commands(text):
    """Read only the explicitly supported integer, orthogonal Turtle commands."""
    text = html.unescape(re.sub('<[^>]*>', ' ', text))
    result = []
    for name, n in re.findall(r'(Вперёд|Назад|Направо|Налево|Поднять хвост|Опустить хвост)(?:\s+(\d+))?', text):
        result.append((name, int(n) if n else 0))
    return result


def turtle(commands):
    x = y = direction = 0
    down = True
    points, edges = [(0, 0)], set()
    distance = painted = 0
    for name, n in commands:
        if name in ('Направо', 'Налево'):
            direction = (direction + (n if name == 'Направо' else -n)) % 360
            continue
        if name in ('Поднять хвост', 'Опустить хвост'):
            down = name == 'Опустить хвост'
            continue
        dx, dy = {0: (0, 1), 90: (1, 0), 180: (0, -1), 270: (-1, 0)}[direction]
        if name == 'Назад':
            dx, dy = -dx, -dy
        for _ in range(n):
            next_point = (x + dx, y + dy)
            if down:
                edges.add(tuple(sorted(((x, y), next_point))))
                painted += 1
            x, y = next_point
            distance += 1
        points.append((x, y))
    return points, distance, painted, len(edges)


def vertical_intervals(items):
    """Independent continuous interval union, no unit-segment enumeration."""
    y = distance = painted = 0
    down = True
    intervals = []
    for cmd, n in items:
        if cmd in ('U', 'D'):
            down = cmd == 'D'
            continue
        end = y + n if cmd == 'F' else y - n
        distance += abs(end - y)
        if down:
            intervals.append((min(y, end), max(y, end)))
            painted += abs(end - y)
        y = end
    total, lo, hi = 0, None, None
    for a, b in sorted(intervals):
        if lo is None:
            lo, hi = a, b
        elif a <= hi:
            hi = max(hi, b)
        else:
            total += hi - lo
            lo, hi = a, b
    return distance, painted, total + (hi - lo if lo is not None else 0)


class GeometryAndTapeReviewTest(unittest.TestCase):
    def test_composite_area_matches_the_written_commands_and_unit_cells(self):
        row = slide(6, 'Площадь составной фигуры')
        namespace, printed = execute(row)
        points, _, _, _ = turtle(commands(row['cond']))
        self.assertEqual(points[0], points[-1])
        self.assertEqual(namespace['P'], points[:-1])
        # Separate geometric oracle: union of two non-overlapping rectangles.
        cells = {(x, y) for x in range(4) for y in range(8)}
        cells |= {(x, y) for x in range(4, 10) for y in range(5, 8)}
        self.assertEqual(len(cells), 50)
        self.assertEqual(Fraction(row['ans']), len(cells))
        self.assertEqual(printed, row['ans'])

    def test_area_formula_respects_orientation_and_half_unit_areas(self):
        namespace, _ = execute(slide(6, 'Площадь составной фигуры'))
        area = namespace['polygon_area']
        for width, height, cut_x, cut_y in ((10, 8, 4, 5), (3, 7, 1, 2), (8, 3, 6, 1)):
            points = [(0, 0), (0, height), (width, height), (width, cut_y), (cut_x, cut_y), (cut_x, 0)]
            cells = {(x, y) for x in range(width) for y in range(height)
                     if x < cut_x or y >= cut_y}
            self.assertEqual(area(points), len(cells))
            self.assertEqual(area(points[::-1]), len(cells))
            self.assertEqual(area([(x - 11, y - 7) for x, y in points]), len(cells))
        self.assertEqual(area([(0, 0), (3, 0), (0, 1)]), Fraction(3, 2))

    def test_vertical_trace_matches_condition_and_continuous_union(self):
        row = slide(6, 'Перекрытия и поднятый хвост')
        namespace, printed = execute(row)
        translate = {'Вперёд': 'F', 'Назад': 'B', 'Поднять хвост': 'U', 'Опустить хвост': 'D'}
        parsed = [(translate[name], n) for name, n in commands(row['cond'])]
        self.assertEqual(namespace['commands'], parsed)
        expected = vertical_intervals(parsed)
        self.assertEqual(expected, (21, 17, 9))
        self.assertEqual(tuple(map(int, printed.split())), expected)
        self.assertEqual(printed, row['ans'])
        measure = namespace['measure_vertical']
        cases = [[], [('F', 3), ('B', 5)], [('U', 0), ('F', 3), ('D', 0), ('F', 2),
                  ('U', 0), ('F', 4), ('D', 0), ('B', 1)], [('F', 0), ('B', 0)],
                 [('F', 4), ('B', 4)] * 3]
        for case in cases:
            self.assertEqual(measure(case), vertical_intervals(case))

    def test_repeated_rectangle_practice_counts_retracing_once(self):
        row = slide(6, 'Повторный проход и новый участок')
        count, body = re.search(r'Повтори (\d+) \[([^]]+)\]', row['cond']).groups()
        tail = row['cond'].split(']', 1)[1]
        _, distance, painted, unique = turtle(commands(body) * int(count) + commands(tail))
        self.assertEqual((distance, painted, unique), (53, 47, 25))
        self.assertEqual(tuple(map(int, row['ans'].split(';'))), (distance, painted, unique))
        area_row = slide(6, 'Два обхода одного прямоугольника')
        self.assertEqual(area_row['ans'], '28; 40')
        # 4*7 unit cells, but 5*8 lattice vertices including the boundary.
        self.assertEqual(4 * 7, 28)
        self.assertEqual(len({(x, y) for x in range(8) for y in range(5)}), 40)

    def test_inversion_count_includes_the_write_on_the_halting_step(self):
        row = slide(12, 'Инверсия и запись перед остановкой')
        namespace, printed = execute(row)
        run, prog = namespace['run'], namespace['prog']
        # Exhaustively check a count invariant, rather than another simulator.
        for length in range(8):
            for digits in itertools.product('01', repeat=length):
                word = ''.join(digits)
                result, ticks = run(prog, word, 0)
                self.assertEqual(result.count('1'), word.count('0') + 1)
                self.assertEqual(result.count('0'), word.count('1'))
                self.assertEqual(ticks, length + 1)
                self.assertTrue(result.endswith('1'))
        self.assertEqual(run(prog, '', 0), ('1', 1))
        self.assertEqual(printed, '6')
        self.assertEqual(printed, row['ans'])
        self.assertEqual(namespace['res'], '01011010011')
        self.assertEqual(namespace['steps'], 11)

    def test_alternating_erasure_counts_symbols_not_blank_positions(self):
        row = slide(12, 'Стирание символов и внутренние пробелы')
        namespace, printed = execute(row)
        run, prog = namespace['run'], namespace['prog']
        for n in range(21):
            result, ticks = run(prog, '1' * n, 0)
            self.assertEqual(result.count('1'), (n + 1) // 2)
            self.assertEqual(ticks, n + 1)
            self.assertNotIn('0', result)
            if n > 2:
                self.assertIn('λ', result)
        self.assertEqual(namespace['res'], '1λ1λ1λ1')
        self.assertEqual(len(namespace['res']), 7)
        self.assertEqual(printed, row['ans'])
        self.assertEqual(printed, '4')
        self.assertEqual(namespace['steps'], 9)

    def test_tape_practice_answers_follow_count_and_parity(self):
        row = slide(12, 'Проверьте подсчёт единиц')
        self.assertIn('1010001', row['cond'])
        inversion = '1010001'.count('0') + 1
        retained = len(range(1, 10, 2))
        self.assertEqual(tuple(map(int, row['ans'].split(';'))), (inversion, retained))

    def test_legacy_triangle_answers_have_an_integer_only_oracle(self):
        # Vertices (0,0), (0,12), (6√3,6): x² < 3 min(y,12-y)².
        interior = sum(x*x < 3*min(y, 12-y)**2 for x in range(1, 11) for y in range(1, 12))
        self.assertEqual(interior, 56)
        self.assertEqual(int(slide(6, 'Способ 2: вершины + проверка точки')['ans']), interior)
        practice = slide(6, 'Решения задач 1–3')['blocks'][2]
        self.assertEqual(int(practice['ans']), interior + 13)
        rotated_square = sum(abs(x - 10) + abs(y) <= 10 for x in range(21) for y in range(-10, 11))
        self.assertEqual(int(slide(6, 'Не прямые углы')['ans']), rotated_square)

    def test_intersection_formula_handles_empty_and_touching_regions(self):
        namespace, _ = execute(slide(6, 'Формула пересечения'))
        code = slide(6, 'Формула пересечения')['code']
        expression = next(line for line in code.splitlines() if line.startswith('print('))[6:-1]
        for first, second in (((0, 0, 2, 2), (3, 0, 5, 2)), ((0, 0, 2, 2), (2, 2, 5, 3)),
                              ((0, 0, 30, 24), (10, 2, 81, 77))):
            a, b = first, second
            values = {'x1': max(a[0], b[0]), 'x2': min(a[2], b[2]),
                      'y1': max(a[1], b[1]), 'y2': min(a[3], b[3])}
            lattice_a = {(x, y) for x in range(a[0], a[2] + 1) for y in range(a[1], a[3] + 1)}
            lattice_b = {(x, y) for x in range(b[0], b[2] + 1) for y in range(b[1], b[3] + 1)}
            self.assertEqual(eval(expression, {}, values), len(lattice_a & lattice_b))
        self.assertEqual(namespace['x2'], 30)

    def test_legacy_tape_prefixing_and_increment_match_integer_arithmetic(self):
        prefix, _ = execute(slide(12, 'Эмуляция на Python'))
        increment, _ = execute(slide(12, 'Прибавить 1'))
        for n in range(65):
            word = bin(n)[2:]
            result, ticks = prefix['run'](prefix['prog'], word, len(word))
            self.assertEqual(int(result, 2), 2 ** len(word) + n)
            self.assertEqual(ticks, len(word) + 3)
            result, ticks = increment['run'](increment['prog'], word, len(word) - 1)
            self.assertEqual(int(result, 2), n + 1)
            trailing_ones = len(word) - len(word.rstrip('1'))
            self.assertEqual(ticks, trailing_ones + 1)


if __name__ == '__main__':
    unittest.main()
