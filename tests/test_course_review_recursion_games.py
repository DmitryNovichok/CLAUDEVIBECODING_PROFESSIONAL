"""Independent algebra/combinatorics and retrograde checks for courses 16 and 19–21.

The game oracle classifies positions from larger heaps downwards instead of
copying the displayed recursive any/all search. Recursion examples use closed
forms, digit compositions or bottom-up values where the slides use recursion.
"""
import contextlib
import html
import io
import itertools
import json
from math import comb
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parent.parent


def slides(number):
    return json.loads((ROOT / 'course' / f'{number}.json').read_text())['slides']


def slide(number, title):
    return next(row for row in slides(number) if row['h'] == title)


def practice(number, index):
    return slide(number, 'Решения задач 1–3')['blocks'][index]


def execute(row):
    namespace, output = {}, io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(row['code'], '<reviewed-recursion-game>', 'exec'), namespace)
    return namespace, output.getvalue().strip()


def normal_labels(states, moves, terminal):
    """Win/loss layers in a DAG, independent of a remaining-plies counter."""
    labels = {}
    for state in sorted(states, key=sum, reverse=True):
        next_states = moves(state)
        if any(terminal(child) for child in next_states):
            label = 'W1'
        else:
            next_labels = [labels[child] for child in next_states]
            if set(next_labels) == {'W1'}:
                label = 'L1'
            elif 'L1' in next_labels:
                label = 'W2'
            elif set(next_labels) <= {'W1', 'W2'}:
                label = 'L2'
            else:
                label = 'later'
        labels[state] = label
    return labels


def two_heap_moves(state):
    a, b = state
    return ((a + 4, b), (2 * a, b), (a, b + 4), (a, 2 * b))


class RecursionSubjectReviewTest(unittest.TestCase):
    def check_output(self, row, expected):
        namespace, output = execute(row)
        self.assertEqual(output, str(expected))
        self.assertEqual(row.get('ans', row.get('out')), str(expected))
        return namespace

    def test_factorial_ratios_reduce_to_small_integer_products(self):
        expected = 3037 * (3038 + 5)
        self.assertEqual(expected, 9241591)
        for title in ('Прогрев кэша', 'Итеративный пересчёт'):
            with self.subTest(title=title):
                self.check_output(slide(16, title), expected)
        self.check_output(practice(16, 1), 2024 * (2025 + 3))

    def test_upward_recursion_matches_two_arithmetic_progressions(self):
        expected = sum(range(2020, 2027, 2)) - sum(range(2023, 2026, 2))
        self.check_output(slide(16, 'Рекурсия «вверх» и разность'), expected)

    def test_two_functions_match_closed_form_and_residue_boundaries(self):
        def g_closed(n):
            count = max(0, (n - 20 + 2) // 3)
            return n - 3 * count + 2 + count
        namespace = self.check_output(slide(16, 'Две функции и глубокая рекурсия'),
                                      3 * g_closed(37811 - 3) + 7)
        for n in (0, 18, 19, 20, 21, 22, 23, 24, 37808):
            self.assertEqual(namespace['g'](n), g_closed(n))

    def test_step_four_ratio_is_exact_after_symbolic_cancellation(self):
        expected = (2 * 13766 - 9) * 2 * 13762
        self.assertEqual(expected, 757543052)
        namespace = self.check_output(slide(16, 'Отношение значений'), expected)
        numerator = namespace['F'](13766) - 9 * namespace['F'](13762)
        self.assertEqual(numerator % namespace['F'](13758), 0)

    def test_bitcount_answer_checks_the_actual_upper_bound(self):
        bound = 500_000_000
        values = {2 ** i + 2 ** j for i, j in itertools.combinations(range(bound.bit_length()), 2)
                  if 2 ** i + 2 ** j < bound}
        self.assertEqual(len(values), 406)
        self.assertLess(max(values), bound)
        self.assertGreaterEqual(2 ** bound.bit_length(), bound)
        row = slide(16, 'Когда перебор невозможен: узнать функцию')
        self.assertIn('500 000 000', row['cond'])
        namespace = self.check_output(row, len(values))
        for value in values:
            self.assertEqual(namespace['F'](value), 3)
        # C(29, 2) does not apply to every upper bound having 29 bits.
        self.assertLess(sum(value < 300_000_000 for value in values), comb(29, 2))

    def test_call_count_from_full_binary_tree_leaf_count(self):
        # Each leaf corresponds to a composition into steps 1/2. A full binary
        # tree has twice the number of leaves minus one nodes/calls.
        leaves = sum(comb(10 - k, k) for k in range(6))
        self.assertEqual(leaves, 89)
        self.check_output(slide(16, 'Число вызовов'), 2 * leaves - 1)

    def test_practice_parity_recurrence_and_digit_compositions(self):
        values = [1] * 21
        for n in range(3, 21):
            values[n] = values[n - 1] + n if n % 2 else values[n - 3] + 2 * n
        self.check_output(practice(16, 0), values[20])
        # Four decimal digits, allowing leading zeros. Sum 9 means no digit
        # can exceed 9, so stars and bars counts all solutions directly.
        self.check_output(practice(16, 2), comb(9 + 4 - 1, 4 - 1))


class GameSubjectReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.labels = normal_labels(
            ((a, b) for a in range(1, 132) for b in range(1, 133 - a)),
            two_heap_moves, lambda state: sum(state) >= 133)

    def test_demo_possible_reply_is_not_a_guaranteed_strategy(self):
        possible = [s for s in range(1, 116)
                    if any(sum(first) < 133 and any(sum(reply) >= 133 for reply in two_heap_moves(first))
                           for first in two_heap_moves((17, s)))]
        row = slide(19, 'Задание 19: «Ваня выиграл первым ходом»')
        namespace, answer = execute(row)
        self.assertEqual(int(answer), min(possible))
        self.assertEqual(answer, row['ans'])
        self.assertEqual(min(possible), 29)
        self.assertEqual([s for s in range(1, 116) if namespace['g'](17, s, 2)], possible)
        guaranteed = [s for s in range(1, 116) if self.labels[17, s] == 'L1']
        self.assertEqual(guaranteed, [56, 57])
        self.assertNotEqual(possible, guaranteed)

    def test_two_heap_program_agrees_with_retrograde_layers_for_every_start(self):
        rows = [slide(19, 'Задание 20: П2, но не П1'), slide(19, 'Задание 21: В2, но не В1')]
        expected_labels = {1: {'W1'}, 2: {'L1'}, 3: {'W1', 'W2'}, 4: {'L1', 'L2'}}
        for row in rows:
            namespace, answer = execute(row)
            for s in range(1, 116):
                for turns, accepted in expected_labels.items():
                    with self.subTest(title=row['h'], s=s, turns=turns):
                        self.assertEqual(namespace['f'](17, s, turns), self.labels[17, s] in accepted)
            self.assertEqual(answer, row['ans'])
        second = [s for s in range(1, 116) if self.labels[17, s] == 'W2']
        vanya = [s for s in range(1, 116) if self.labels[17, s] == 'L2']
        self.assertEqual(second, [28, 48, 49, 52, 53, 54, 55])
        self.assertEqual(rows[0]['ans'], ' '.join(map(str, second[:2])))
        self.assertEqual(vanya, [44, 45, 50, 51])
        self.assertEqual(rows[1]['ans'], str(min(vanya)))

    def test_first_move_example_and_threshold(self):
        row = slide(19, 'П1: выигрыш первым ходом')
        namespace, answer = execute(row)
        expected = [s for s in range(1, 116) if self.labels[17, s] == 'W1']
        self.assertEqual(expected, list(range(58, 116)))
        self.assertEqual(answer, ' '.join(map(str, expected[:5])) + ' …')
        self.assertEqual(answer, row['ans'])
        self.assertEqual(17 + 2 * 58, 133)
        for remaining in range(5):
            self.assertEqual(namespace['f'](17, 116, remaining), remaining % 2 == 0)

    def test_one_heap_practice_matches_retrograde_layers(self):
        labels = normal_labels(((s,) for s in range(1, 30)),
                               lambda state: ((state[0] + 1,), (state[0] * 2,)),
                               lambda state: state[0] >= 30)
        for index, label, expected in ((0, 'L1', [14]), (1, 'W2', [7, 13]), (2, 'L2', [12])):
            positions = [s for s in range(1, 30) if labels[s,] == label]
            self.assertEqual(positions, expected)
            row = practice(19, index)
            namespace, answer = execute(row)
            self.assertEqual(answer, ' '.join(map(str, positions)))
            self.assertEqual(answer, row['ans'])
            for s in range(1, 30):
                self.assertEqual(namespace['f'](s, 1), labels[s,] == 'W1')

    def test_misere_second_reply_excludes_first_reply_wins(self):
        row = slide(19, 'Проигрыш при переходе порога')
        condition = html.unescape(re.sub('<[^>]*>', ' ', row['cond']))
        self.assertIn('не может вынудить Ваню проиграть ответом на первый ход', condition)
        self.assertIn('не позднее ответа на второй ход', condition)
        first = {s for s in range(1, 41)
                 if any(s + step <= 40 and all(s + step + reply > 40 for reply in (1, 3))
                        for step in (1, 3))}
        self.assertEqual(first, {37, 39})
        # Bottom-up sets after a pair of turns, not the slide's recursive tree.
        at_most_second = {s for s in range(1, 41)
                          if any(s + step <= 40 and
                                 all(s + step + reply > 40 or s + step + reply in first
                                     for reply in (1, 3))
                                 for step in (1, 3))}
        expected = sorted(at_most_second - first)
        self.assertEqual(expected, [33, 35])
        namespace, answer = execute(row)
        self.assertEqual(answer, ' '.join(map(str, expected)))
        self.assertEqual(answer, row['ans'])
        for s in range(1, 41):
            self.assertEqual(namespace['f'](s, 2), s in first)
            self.assertEqual(namespace['f'](s, 4), s in at_most_second)
            self.assertFalse(namespace['f'](s, 1))
        self.assertTrue(namespace['f'](41, 0, peter_turn=True))
        self.assertFalse(namespace['f'](41, 0, peter_turn=False))


if __name__ == '__main__':
    unittest.main()
