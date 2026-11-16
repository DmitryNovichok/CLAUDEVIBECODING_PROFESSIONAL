"""Independent enumeration and exact-arithmetic checks of the scoped №27 review."""
import ast
from fractions import Fraction
from itertools import combinations, product
import json
from math import isqrt
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent


def deck():
    return json.loads((ROOT / 'course/27.json').read_text())['slides']


def function_from(slide, name):
    tree = ast.parse(slide['code'])
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    scope = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<reviewed lesson function>', 'exec'), scope)
    return scope[name]


class ArchiveSequenceReviewTest(unittest.TestCase):
    def test_pairs_and_segments_match_exhaustive_index_enumeration(self):
        slides = {s['h']: s for s in deck()}
        pairs = function_from(slides['Архив: пары с суммой, кратной 5'], 'count_pairs')
        segments = function_from(slides['Архив: отрезки с суммой, кратной 5'], 'count_segments')
        # The oracle enumerates positions directly; it uses no remainder buckets
        # or prefix-frequency formula from the lesson implementation.
        for length in range(5):
            for values in product((-2, -1, 0, 1, 2), repeat=length):
                for divisor in (1, 2, 3, 5, 7):
                    want_pairs = sum((values[i] + values[j]) % divisor == 0
                                     for i, j in combinations(range(length), 2))
                    want_segments = sum(sum(values[i:j]) % divisor == 0
                                        for i in range(length) for j in range(i + 1, length + 1))
                    self.assertEqual(pairs(values, divisor), want_pairs, (values, divisor))
                    self.assertEqual(segments(values, divisor), want_segments, (values, divisor))

    def test_file_and_manual_answers_describe_the_same_problems(self):
        slides = deck()
        data = [int(x) for x in (ROOT / 'course/data/27/27-sequence.txt').read_text().split()]
        self.assertEqual(data[0], len(data) - 1)
        values = data[1:]
        self.assertEqual(sum((a + b) % 5 == 0 for a, b in combinations(values, 2)), 9)
        self.assertEqual(slides[24]['ans'], '9')
        values = [2, 3, 1, 4, 5]
        self.assertEqual(sum(sum(values[i:j]) % 5 == 0
                             for i in range(5) for j in range(i + 1, 6)), 6)
        self.assertEqual(slides[25]['ans'], '6')
        self.assertEqual([b['ans'] for b in slides[27]['blocks']], ['5', '6'])

    def test_archive_section_is_explicit_and_does_not_replace_current_analysis(self):
        slides = deck()
        self.assertEqual(slides[20]['h'], 'Решения задач 1–2')
        self.assertEqual(slides[22]['h'], 'Архив: последовательности чисел')
        self.assertIn('не заменяет', slides[22]['sub'])
        self.assertTrue(all('Архив' in s['k'] for s in slides[22:]))
        # A connected chain is not automatically a bounded-diameter cluster.
        energies = [Fraction(0), Fraction(3, 2), Fraction(3)]
        self.assertTrue(all(b - a <= 2 for a, b in zip(energies, energies[1:])))
        self.assertGreater(max(energies) - min(energies), 2)
        self.assertIn('разные условия', slides[12]['html'])
        self.assertIn('соседних энергий', slides[15]['cond'])

    def test_bounded_diameter_example_has_exactly_one_unlabelled_partition(self):
        values = tuple(map(Fraction, ('0', '1', '2', '10', '10.5', '11')))
        partitions = []
        # Fix the first object in the first group to avoid counting a swap of
        # group names as a second solution; otherwise enumerate all subsets.
        for labels in product((0, 1), repeat=len(values) - 1):
            assignment = (0,) + labels
            groups = [[v for v, label in zip(values, assignment) if label == k] for k in (0, 1)]
            if all(g and all(abs(a - b) <= 2 for a, b in combinations(g, 2)) for g in groups):
                partitions.append(groups)
        self.assertEqual(len(partitions), 1)
        centers = []
        for g in partitions[0]:
            costs = {a: sum(abs(a - b) for b in g) for a in g}
            best = min(costs.values())
            winners = [a for a, cost in costs.items() if cost == best]
            self.assertEqual(len(winners), 1)
            centers.append(winners[0])
        self.assertEqual(centers, [Fraction(1), Fraction(21, 2)])
        self.assertEqual(deck()[21]['ans'], '1 10.5')

    def test_current_particle_examples_with_exact_energies_and_median_theorem(self):
        # Fractions preserve input decimals; medians, combinations and integer
        # square roots form an independent oracle for the supplied float code.
        rows = []
        for line in (ROOT / 'course/data/27/27c.txt').read_text().splitlines():
            cells = line.replace(',', '.').split()
            x, y, vx, vy, mass = map(Fraction, cells[:5])
            rows.append((mass * (vx * vx + vy * vy) / 2, x, y, cells[5]))
        energies = sorted(r[0] for r in rows)
        boundaries = [(a + b) / 2 for a, b in zip(energies, energies[1:]) if b - a > 3]
        groups = [[r for r in rows if sum(r[0] > b for b in boundaries) == i]
                  for i in range(len(boundaries) + 1)]
        self.assertEqual([len(g) for g in groups], [191, 231, 181])
        medians = [sorted(r[0] for r in g)[len(g) // 2] for g in groups]
        self.assertTrue(all(len(g) % 2 for g in groups))
        # Odd group sizes alone do not guarantee unique objects if energies tie.
        self.assertTrue(all(sum(r[0] == med for r in g) == 1 for med, g in zip(medians, groups)))
        q2 = int(max(medians) * 10000)
        distance_squared = max((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
                               for g in groups for a, b in combinations([r for r in g if r[3] == 'II'], 2))
        scaled = distance_squared * 10000 ** 2
        q1 = isqrt(scaled.numerator // scaled.denominator)
        self.assertEqual(deck()[15]['ans'], f'{q1} {q2}')
        biggest = max(groups, key=len)
        mean = sum(r[0] for r in biggest) / len(biggest)
        result = f"{sum(r[3] == 'I' for r in biggest)} {int(mean * 10000)}"
        self.assertEqual(deck()[20]['blocks'][1]['ans'], result)


if __name__ == '__main__':
    unittest.main()
