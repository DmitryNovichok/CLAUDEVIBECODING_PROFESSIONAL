"""Scoped independent checks of lessons 15 and 23, not of the external bank.

Number theory, exact interval representatives and forward path enumeration are
the oracles; the displayed recursive/search programs are executed separately.
"""
from collections import defaultdict
import contextlib
from fractions import Fraction
import io
from itertools import product
import json
from math import gcd
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent


def execute(block):
    namespace = {'__name__': '__main__'}
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(block['code'], '<reviewed-lesson>', 'exec'), namespace)
    return output.getvalue().strip(), namespace


def forward_count(start, end, commands, *, forbidden=None, required=None):
    """Forward DP on a monotone graph; track required visits after a command."""
    ways = defaultdict(int, {(start, required is None): 1})
    step = 1 if start <= end else -1
    for value in range(start, end, step):
        for seen in (False, True):
            count = ways[value, seen]
            if not count:
                continue
            for command in commands:
                nxt = command(value)
                if nxt is None or nxt == forbidden:
                    continue
                if not min(start, end) <= nxt <= max(start, end):
                    continue
                if (nxt - value) * step <= 0:
                    raise AssertionError('oracle expects strictly monotone commands')
                ways[nxt, seen or nxt == required] += count
    return ways[end, True]


def swapped(value):
    # Decimal string manipulation is independent of the lesson's arithmetic.
    digits = str(value)
    if len(digits) < 2 or digits[-2] >= digits[-1]:
        return None
    return int(digits[:-2] + digits[-1] + digits[-2])


class LogicLessonReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.slides = {s['h']: s for s in json.loads((ROOT / 'course/15.json').read_text())['slides']}
        cls.examples = {title: execute(s) for title, s in cls.slides.items() if 'code' in s}
        cls.practice = cls.slides['Решения задач 1–3']['blocks'] + cls.slides['Решения задач 4–5']['blocks']

    def check_answer(self, title, answer):
        slide = self.slides[title]
        output, _ = self.examples[title]
        self.assertEqual(output, str(answer))
        self.assertEqual(slide.get('ans', slide.get('out')), str(answer))

    def test_divisibility_answers_follow_common_multiple_criteria(self):
        divisors = [a for a in range(1, 13) if 12 % a == 0]
        self.check_answer('Делимость: наибольшее A', max(divisors))
        self.check_answer('Делимость: сколько существует A', len(divisors))
        # Every common multiple of a and 24 is divisible by 36 iff their
        # smallest common multiple is. Compute it via gcd, not the lesson lcm.
        qualifying = [a for a in range(1, 101) if (a * 24 // gcd(a, 24)) % 36 == 0]
        self.assertEqual(qualifying, list(range(9, 101, 9)))
        self.check_answer('Делимость: наименьшее A', min(qualifying))
        self.assertEqual(execute(self.practice[3])[0], str(len(qualifying)))
        f = self.examples['Делимость: наименьшее A'][1]['f']
        # A larger arbitrary grid can still miss a first common multiple.
        self.assertTrue(all(f(x, 997) for x in range(1, 10001)))
        self.assertFalse(f(997 * 24, 997))
        for a in range(1, 40):
            witness = a * 24 // gcd(a, 24)
            self.assertEqual(f(witness, a), a % 9 == 0)

    def test_bit_answers_and_high_bit_counterexamples(self):
        required = sum(1 << bit for bit in range(6)
                       if (53 >> bit) % 2 and not (41 >> bit) % 2)
        allowed = [1, 4, 16]
        subsets = {sum(bit for bit, take in zip(allowed, flags) if take)
                   for flags in product((0, 1), repeat=3)} - {0}
        self.check_answer('Биты: наименьшее A', required)
        self.check_answer('Биты: наибольшее A', max(subsets))
        self.check_answer('Биты: сколько существует A', len(subsets))
        f_min = self.examples['Биты: наименьшее A'][1]['f']
        f_max = self.examples['Биты: наибольшее A'][1]['f']
        for a in range(128):
            self.assertEqual(all(f_min(x, a) for x in range(128)), a & required == required)
            self.assertEqual(all(f_max(x, a) for x in range(128)), a in subsets or a == 0)
        for bit in (7, 10, 30, 90):
            self.assertFalse(f_max(1 << bit, 1 << bit))
            self.assertTrue(f_min((1 << bit) + 4, required))

    def test_exact_interval_representatives_find_a_gap_missed_by_quarter_steps(self):
        self.check_answer('Отрезки: наименьшая длина A', 25 - 10)
        self.check_answer('Отрезки: наибольшая длина A', max(35 - 10, 62 - 40))
        left_end, right_start = Fraction(1, 10), Fraction(11, 100)
        formula = lambda x: not 0 <= x <= 1 or 0 <= x <= left_end or right_start <= x <= 1
        self.assertTrue(all(formula(Fraction(i, 4)) for i in range(5)))
        for title in ('Отрезки: наименьшая длина A', 'Отрезки: наибольшая длина A'):
            probes = self.examples[title][1]['probes']
            points = probes(0, left_end, right_start, 1)
            self.assertFalse(all(formula(x) for x in points))
            self.assertIn(Fraction(21, 200), points)
            self.assertTrue(all(isinstance(x, Fraction) for x in points))
            # Closed endpoints and singleton candidates must also be checked.
            self.assertIn(Fraction(1, 10), probes(left_end, left_end))

    def test_set_formulas_and_requested_scalar_answers(self):
        # For any element there are only eight combinations of P,Q,A membership.
        for p, q, a in product((False, True), repeat=3):
            expression = ((not p) or a) or (a or (not q))
            self.assertEqual(not expression, p and q and not a)
        p, q = set(range(2, 21, 2)), set(range(3, 31, 3))
        self.check_answer('Множества: строим A по одному элементу', sum(p & q))
        self.check_answer('Множества: наибольшее количество элементов', len(p - q))
        self.assertEqual(self.examples['Множества: строим A по одному элементу'][1]['a'], p & q)
        self.assertEqual(self.examples['Множества: наибольшее количество элементов'][1]['a'], p - q)

    def test_inequality_answers_have_extremal_witnesses(self):
        # Derive extrema before comparing the search code's answer.
        cases = (
            ('Неравенства: наименьшее A', 30 + 2 * 30 + 1, (30, 30), -1),
            ('Неравенства: наибольшее A', (85 + 4) // 5 - 1, (17, 17), 1),
            ('Произведение x · y', 10, (10, 10), 1),
            ('Сумма квадратов', 6 ** 2 + 9 ** 2 + 1, (6, 9), -1),
        )
        for title, answer, witness, direction in cases:
            with self.subTest(title=title):
                self.check_answer(title, answer)
                f = self.examples[title][1]['f']
                self.assertTrue(f(*witness, answer))
                self.assertFalse(f(*witness, answer + direction))
        f = self.examples['Неравенства: наименьшее A'][1]['f']
        self.assertTrue(f(10 ** 20, 10 ** 20, 91))
        self.assertTrue(f(0, 10 ** 20, 91))

    def test_practice_answers_have_independent_number_theory_and_extrema(self):
        first = next(a for a in range(1, 43) if (a * 28 // gcd(a, 28)) % 42 == 0)
        bit_minimum = sum(1 << b for b in range(7) if (77 >> b) % 2 and not (12 >> b) % 2)
        expected = [first, bit_minimum, 40 + 2 * 20 + 1, 100 // 9, 5 ** 2 + 12 ** 2 + 1]
        self.assertEqual(expected, [3, 65, 81, 11, 170])
        for block, answer in zip(self.practice, expected):
            self.assertEqual(execute(block)[0], str(answer))
            self.assertEqual(block['ans'], str(answer))
        truth = '\n'.join(f'{int(a)} {int(b)} {int(not a or b)}' for a, b in product((False, True), repeat=2))
        self.check_answer('Как записать импликацию', truth)


class ExecutorLessonReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.slides = {s['h']: s for s in json.loads((ROOT / 'course/23.json').read_text())['slides']}
        cls.examples = {title: execute(s) for title, s in cls.slides.items() if 'code' in s}
        cls.up = (lambda x: x + 1, lambda x: x * 2)

    def check_answer(self, title, answer):
        slide = self.slides[title]
        self.assertEqual(self.examples[title][0], str(answer))
        self.assertEqual(slide.get('ans', slide.get('out')), str(answer))

    def test_main_program_counts_match_independent_forward_paths(self):
        total = forward_count(1, 20, self.up)
        through_ten = forward_count(1, 20, self.up, required=10)
        self.assertEqual((total, through_ten), (60, 28))
        self.check_answer('Классика: +1 и ×2', f'{total} {through_ten}')
        self.check_answer('Запрещённое число', forward_count(1, 20, self.up, forbidden=8))
        self.assertEqual(self.slides['Посчитайте программы']['ans'], str(forward_count(3, 8, self.up)))
        self.check_answer('Рекурсия с новой командой', forward_count(100, 141, (self.up[0], swapped)))
        down = (lambda x: x - 3, lambda x: x - 6, lambda x: x // 2)
        self.check_answer('Уменьшающие команды и запрет', forward_count(86, 12, down, forbidden=36, required=53))
        replace = lambda x: int(str(x).replace('1', '2')) if '1' in str(x) else None
        self.check_answer('Команда-замена цифры', forward_count(11, 92, (self.up[0], replace)))
        self.check_answer('Три команды', forward_count(2, 25, (*self.up, lambda x: x * 3), forbidden=11, required=15))

    def test_forbidden_start_target_and_duplicate_command_results(self):
        g = self.examples['Запрещённое число'][1]['g']
        # Start is not a result of a command; forbidden target is.
        for start, end, forbidden in ((1, 20, 1), (1, 20, 20), (3, 3, 3), (1, 2, 99), (1, 20, 8)):
            self.assertEqual(g(start, end, forbidden), forward_count(start, end, self.up, forbidden=forbidden))
        self.assertEqual(g(1, 20, 1), 60)
        self.assertEqual(g(1, 20, 20), 0)
        self.assertEqual(g(1, 2, 99), 2)  # +1 and ×2 remain different commands.
        three = self.examples['Три команды'][1]['f']
        self.assertEqual(three(2, 11), 0)
        self.assertEqual(three(11, 12), 1)
        down = self.examples['Уменьшающие команды и запрет'][1]['f']
        self.assertEqual(down(36, 33), 1)
        self.assertEqual(down(39, 36), 0)

    def test_required_start_is_not_a_visit_and_target_is(self):
        self.assertEqual(forward_count(1, 20, self.up, required=1), 0)
        self.assertEqual(forward_count(1, 20, self.up, required=20), 60)
        self.assertIn('x &lt; a ≤ y', self.slides['Весь №23 на одном слайде']['html'])

    def test_swap_command_and_practice_answers(self):
        b = self.examples['Рекурсия с новой командой'][1]['B']
        for x in range(100, 1000):
            self.assertEqual(b(x), swapped(x))
            if b(x) is not None:
                self.assertGreater(b(x), x)
        expected = [forward_count(1, 20, self.up), forward_count(1, 20, self.up, required=10),
                    forward_count(1, 20, self.up, forbidden=8),
                    forward_count(100, 141, (self.up[0], swapped), required=120)]
        self.assertEqual(expected, [60, 28, 20, 6])
        for block, answer in zip(self.slides['Решения задач 1–4']['blocks'], expected):
            self.assertEqual(execute(block)[0], str(answer))
            self.assertEqual(block['ans'], str(answer))

    def test_fixed_length_programs_and_distinct_results_are_different_counts(self):
        def outcomes(length):
            values = []
            for commands in product((0, 1), repeat=length):
                value = 1
                for command in commands:
                    value = self.up[command](value)
                values.append(value)
            return values
        six, eight = outcomes(6), outcomes(8)
        self.assertEqual(six.count(20), 4)
        self.assertEqual(len(eight), 256)
        self.assertEqual(len(set(eight)), 80)
        self.check_answer('Длина программы', six.count(20))
        self.check_answer('Сколько различных результатов', len(set(eight)))


if __name__ == '__main__':
    unittest.main()
