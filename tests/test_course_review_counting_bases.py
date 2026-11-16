"""Independent combinatorial and positional proofs for reviewed lessons 8/14.

Expected values use counting formulas, rank arithmetic and sparse coefficient
borrowing, rather than copying the lesson's itertools/digits implementations.
Only the displayed examples are covered, not the external task bank.
"""
import contextlib
import io
import itertools
import json
import math
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent


def execute(block):
    output, namespace = io.StringIO(), {'__name__': '__main__'}
    with contextlib.redirect_stdout(output):
        exec(compile(block['code'], '<reviewed-counting-bases>', 'exec'), namespace)
    return output.getvalue().strip(), namespace


def coefficients(base, terms):
    """Normalize a sparse polynomial by carrying/borrowing at each position."""
    values = [0] * (max(terms) + 2)
    for power, coefficient in terms.items():
        values[power] += coefficient
    for power in range(len(values) - 1):
        carry, values[power] = divmod(values[power], base)
        values[power + 1] += carry
    while len(values) > 1 and values[-1] == 0:
        values.pop()
    if not all(0 <= digit < base for digit in values):
        raise AssertionError('Oracle needs a positive polynomial and enough top positions')
    return list(reversed(values))


def numeric_word(digits, base):
    return sum(digit * base ** power for power, digit in enumerate(reversed(digits)))


class CountingBasesReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lessons = {n: json.loads((ROOT / f'course/{n}.json').read_text())
                       for n in (8, 14)}
        cls.slides = {n: {s['h']: s for s in deck['slides']}
                      for n, deck in cls.lessons.items()}

    def check_block(self, block, answer):
        self.assertEqual(block.get('ans') or block.get('out'), str(answer))
        output, namespace = execute(block)
        self.assertEqual(output, str(answer))
        return namespace

    def test_first_even_word_returns_only_requested_rank(self):
        # All starts below Н are forbidden; the first possible Т is at the
        # penultimate position. An even rank needs an odd final base-6 digit.
        answer = numeric_word((3, 0, 0, 4, 1), 6) + 1
        self.assertEqual(answer, 3914)
        for value in range(answer - 1):
            digits = [(value // 6 ** power) % 6 for power in range(4, -1, -1)]
            self.assertFalse(digits[0] >= 3 and 4 in digits and (value + 1) % 2 == 0)
        slide = self.slides[8]['Перебор на Python']
        self.assertIn('Под каким номером', slide['cond'])
        self.check_block(slide, answer)
        self.check_block(self.slides[8]['Номер слова через систему счисления'], answer)

    def test_word_counts_match_combinatorial_formulas(self):
        expected = {
            'Буква ровно один раз': 5 * 4 ** 4,
            'Без двух гласных рядом': math.factorial(3) * math.factorial(2),
            'Числа с условиями на цифры': math.comb(5, 2) * 6 ** 3 - math.comb(4, 2) * 6 ** 2,
            'Приём: гласные → «г», согласные → «с»': 2 * math.factorial(3) ** 2,
            'Одинаковые буквы': math.factorial(4) // math.factorial(2) ** 2,
        }
        self.assertEqual(list(expected.values()), [1280, 12, 1944, 72, 6])
        for title, answer in expected.items():
            with self.subTest(title=title):
                self.check_block(self.slides[8][title], answer)

    def test_octal_leading_zero_removal_and_duplicate_letters(self):
        # Independent count using numeric oct() rather than product(words).
        octal = [oct(n)[2:] for n in range(8 ** 4, 8 ** 5)]
        valid = [s for s in octal if '7' not in s and s.count('6') == 2]
        self.assertEqual(len(valid), 1944)
        # Choose the two positions occupied by А; the other positions are Н.
        words = {''.join('А' if i in positions else 'Н' for i in range(4))
                 for positions in itertools.combinations(range(4), 2)}
        self.assertEqual(words, {'ААНН', 'АНАН', 'АННА', 'НААН', 'НАНА', 'ННАА'})
        self.assertEqual(self.slides[8]['Одинаковые буквы']['ans'], str(len(words)))

    def test_no_adjacent_vowels_cheat_is_an_acceptance_condition(self):
        text = self.slides[8]['Весь №8 на одном слайде']['html']
        code = text.split('<b>Без соседей</b><code>', 1)[1].split('</code>', 1)[0]
        code = code.replace('for i in ...', 'for i in range(len(w) - 1)')
        for word, accepted in (('АКОНЭ', True), ('КАНОЭ', False), ('АЭКНО', False)):
            self.assertIs(eval(code, {'w': word, 'V': 'АОЭ'}), accepted)

    def test_rank_and_practice_answers_use_fixed_word_length(self):
        rank = numeric_word((2, 0, 3, 1), 4) + 1
        word = ''.join('АБВГ'[(99 // 4 ** p) % 4] for p in range(3, -1, -1))
        arrangements = math.factorial(4) * math.comb(5, 2) * math.factorial(2)
        self.assertEqual((rank, word, arrangements), (142, 'БВАГ', 480))
        self.check_block(self.slides[8]['Слово по номеру'], word)
        for block, answer in zip(self.slides[8]['Решения задач 1–3']['blocks'],
                                 (rank, word, arrangements)):
            self.check_block(block, answer)

    def test_digits_zero_and_invalid_domains(self):
        block = self.slides[14]['Перевод в любую систему и обратно']
        ns = self.check_block(block, '26 [1, 10] [1, 0, 0, 0]')
        digits = ns['digits']
        for base in (2, 3, 7, 25, 36, 37, 100):
            self.assertEqual(digits(0, base), [0])
            self.assertEqual(digits(base ** 3 + base - 1, base), [1, 0, 0, base - 1])
            for value in (1, base - 1, base, base ** 4 - 1):
                result = digits(value, base)
                self.assertNotEqual(result[0], 0)
                self.assertTrue(all(0 <= digit < base for digit in result))
                self.assertEqual(numeric_word(result, base), value)
        for n, base in ((-1, 7), (1, 1), (0, 0), (1, -2)):
            with self.assertRaises(ValueError):
                digits(n, base)

    def test_seven_base_maximum_uses_borrowed_tail(self):
        # Positions 100..169 are 70 zeroes; positions 4..99 are sixes.
        # Exactly one zero must occur in the four-digit padded 7**4-x tail.
        candidates = [7 ** 4 - numeric_word(ds, 7)
                      for ds in itertools.product(range(7), repeat=4)
                      if ds.count(0) == 1 and 1 <= 7 ** 4 - numeric_word(ds, 7) <= 2030]
        self.assertEqual(max(candidates), 2029)
        self.assertNotIn(2030, candidates)
        self.check_block(self.slides[14]['Вариант 1: ровно 71 нуль'], max(candidates))

    def test_unknown_digit_outputs_quotient_without_extra_x(self):
        # 22 == 1 mod 21, so all place values reduce to 1.
        candidates = [x for x in range(22) if (75 + 3 * x) % 21 == 0]
        self.assertEqual(candidates, [3, 10, 17])
        x = candidates[0]
        value = (numeric_word((2, 7, x, 9, 8, 8, 7, 6), 22)
                 + numeric_word((2, 6, x, 5, 1), 22)
                 + numeric_word((7, 1, 1, x, 5), 22))
        self.assertEqual(value // 21, 276296118)
        block = self.slides[14]['Вариант 2: неизвестная цифра']
        self.assertIn('запишите частное', block['cond'])
        self.check_block(block, value // 21)

    def test_base25_zeroes_by_sparse_borrowing(self):
        digits = coefficients(25, {20: 3, 14: 2, 12: -4, 7: 15, 4: -2, 0: -2025})
        value = 3 * 3125 ** 8 + 2 * 625 ** 7 - 4 * 625 ** 6 + 3 * 125 ** 5 - 2 * 25 ** 4 - 2025
        self.assertEqual(numeric_word(digits, 25), value)
        self.assertEqual(digits.count(0), 10)
        self.check_block(self.slides[14]['Вариант 3: значащие нули'], digits.count(0))

    def test_long_runs_and_letter_digits_by_position_intervals(self):
        digits = coefficients(15, {1140: 3, 1025: 2, 923: 1, 85: -3, 74: 2, 0: 3})
        longest = max(sum(1 for _ in group) for _, group in itertools.groupby(digits))
        # Borrowing from position 923 fills positions 86..922 with 14.
        self.assertEqual(longest, 922 - 86 + 1)
        self.check_block(self.slides[14]['Серии одинаковых цифр'], longest)
        digits = coefficients(32, {409: 8, 102: 1, 51: -16})
        # Positions 52..101 become 31 and position 51 becomes 16.
        letters = sum(d > 9 for d in digits)
        self.assertEqual(letters, 50 + 1)
        self.check_block(self.slides[14]['«Буквенные» цифры'], letters)

    def test_two_unknown_digits_and_base_are_complete(self):
        fixed = numeric_word((3, 4, 2, 5, 6, 0, 4), 22) + numeric_word((7, 2, 8, 4, 7, 0, 3), 22)
        totals = [total for total in range(43) if (fixed + 22 * total) % 125 == 0]
        self.assertEqual(totals, [16])
        self.assertEqual(sum(0 <= 16 - x < 22 for x in range(22)), 17)
        answer = f'{totals[0]} {(fixed + 22 * totals[0]) // 125}'
        self.check_block(self.slides[14]['Две неизвестные цифры'], answer)
        # b**2+2*b+3=171 is (b+1)**2=169: unique positive base 12.
        base = math.isqrt(171 - 2) - 1
        self.assertEqual((base + 1) ** 2, 169)
        self.check_block(self.slides[14]['Неизвестное основание'], base)

    def test_base_practice_answers_have_independent_polynomial_proofs(self):
        p1 = coefficients(2, {300: 1, 100: 1, 4: -1}).count(1)
        p2 = coefficients(3, {40: 1, 30: 1, 2: -1}).count(2)
        choices = [x for x in range(15) if (2485 + 30 * x) % 13 == 0]
        self.assertEqual(choices, [6])
        p3 = f'{choices[0]} {(2485 + 30 * choices[0]) // 13}'
        p4 = coefficients(5, {15: 1, 2: -1}).count(0)
        self.assertEqual((p1, p2, p3, p4), (97, 28, '6 205', 2))
        for block, answer in zip(self.slides[14]['Решения задач 1–4']['blocks'], (p1, p2, p3, p4)):
            self.check_block(block, answer)

    def test_manual_binary_example_includes_all_fifty_zeroes(self):
        expected = '1' + '0' * 50 + '1' * 50
        self.assertEqual(int(expected, 2), 2 ** 100 + 2 ** 50 - 1)
        self.assertEqual(expected.count('1'), 51)
        text = self.slides[14]['Как устроена запись степеней']['html']
        self.assertIn('50 нулей, 50 единиц', text)
        self.assertNotIn('49 нулей', text)


if __name__ == '__main__':
    unittest.main()
