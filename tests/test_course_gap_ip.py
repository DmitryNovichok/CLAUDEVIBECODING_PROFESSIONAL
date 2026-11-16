"""Independent numerical and IPv4 syntax checks for the reviewed lesson 13.

The lesson's restoration code uses its own octet validator. These tests use the
standard library's IPv4Address as a separate oracle and include ambiguous input.
Subnet answers are derived with integer arithmetic/combinatorics rather than the
lesson's ip_network loops. Only the explicitly reviewed examples are certified.
"""
import contextlib
import io
import ipaddress
import itertools
import json
import math
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent


def execute(block):
    namespace = {'__name__': '__main__'}
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(block['code'], '<reviewed-ip-example>', 'exec'), namespace)
    return output.getvalue().strip(), namespace


def oracle(fragments):
    found = set()
    for order in itertools.permutations(fragments):
        address = ''.join(fragments[label] for label in order)
        try:
            ipaddress.IPv4Address(address)
        except ipaddress.AddressValueError:
            continue
        found.add((''.join(order), address))
    return found


class CourseGapIPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lesson = json.loads((ROOT / 'course/13.json').read_text())
        cls.slides = {slide['h']: slide for slide in cls.lesson['slides']}
        cls.main = cls.slides['Все перестановки и единственность']
        cls.practice, cls.ambiguous = cls.slides['Фрагменты: разбор двух задач']['blocks']

    def test_unique_examples_use_each_fragment_once_and_have_one_answer(self):
        cases = (
            (self.main, {'А': '8.10.', 'Б': '254', 'В': '19', 'Г': '2.16'},
             ('ВГАБ', '192.168.10.254')),
            (self.practice, {'А': '.2', 'Б': '05', 'В': '8.24.16', 'Г': '12'},
             ('ГВАБ', '128.24.16.205')),
        )
        for block, fragments, answer in cases:
            with self.subTest(answer=answer):
                independent = oracle(fragments)
                self.assertEqual(independent, {answer})
                output, ns = execute(block)
                self.assertEqual(ns['fragments'], fragments)
                self.assertEqual(set(ns['restore'](fragments)), independent)
                self.assertEqual(output, ' '.join(answer))
                self.assertEqual(block['ans'], output)

    def test_validator_matches_strict_ipv4_and_does_not_reject_zero_or_255(self):
        _, ns = execute(self.main)
        validate = ns['valid_ipv4']
        cases = ('0.0.0.0', '255.255.255.255', '1.2.3.4', '1.2.3.256',
                 '01.2.3.4', '1.02.3.4', '1.2.003.4', '1.2.3.04',
                 '1..3.4', '1.2.3.', '.1.2.3', '1.2.3.4.5', '1.2.3',
                 '+1.2.3.4', '-1.2.3.4', ' 1.2.3.4', '1.2.3.4\n',
                 '１.2.3.4', '١.2.3.4', '1.2.a.4', '9' * 5000 + '.2.3.4')
        for address in cases:
            try:
                ipaddress.IPv4Address(address)
                expected = True
            except ipaddress.AddressValueError:
                expected = False
            with self.subTest(address=address[:40]):
                self.assertIs(validate(address), expected)

    def test_octet_boundary_and_leading_zero_rules_apply_in_all_four_positions(self):
        _, ns = execute(self.main)
        for position in range(4):
            for value in (0, 1, 9, 10, 99, 100, 254, 255, 256):
                for prefix in ('', '0', '+'):
                    parts = ['1'] * 4
                    parts[position] = prefix + str(value)
                    address = '.'.join(parts)
                    expected = prefix == '' and value <= 255
                    with self.subTest(address=address):
                        self.assertIs(ns['valid_ipv4'](address), expected)

    def test_nonunique_puzzle_does_not_turn_the_first_candidate_into_an_answer(self):
        output, ns = execute(self.ambiguous)
        addresses = {'1.2.3.4', '1.3.2.4', '2.1.3.4',
                     '2.3.1.4', '3.1.2.4', '3.2.1.4'}
        independent = oracle(ns['fragments'])
        self.assertEqual({address for _, address in independent}, addresses)
        self.assertEqual(set(ns['found']), independent)
        self.assertTrue(all(order[-1] == 'Г' for order, _ in ns['found']))
        self.assertEqual(output, '6')
        self.assertEqual(self.ambiguous['ans'], '6')

    def test_manual_rejection_counts_are_exhaustive(self):
        _, ns = execute(self.main)
        endings, excessive, accepted = 0, 0, 0
        for order in itertools.permutations(ns['fragments']):
            address = ''.join(ns['fragments'][label] for label in order)
            if order[-1] == 'А':
                self.assertTrue(address.endswith('.'))
                endings += 1
            elif any(int(part) > 255 for part in address.split('.')):
                excessive += 1
            else:
                accepted += 1
        self.assertEqual((endings, excessive, accepted), (6, 17, 1))

    def test_mask_question_answer_is_the_requested_third_octet(self):
        # One partially masked octet: no prefix enumeration or ip_network here.
        matches = [mask for mask in (0, 128, 192, 224, 240, 248, 252, 254, 255)
                   if 177 & mask == 160]
        self.assertEqual(matches, [224])
        slide = self.slides['Поиск маски']
        self.assertIn('третий байт', slide['cond'])
        self.assertEqual(slide['ans'], str(matches[0]))
        self.assertEqual(execute(slide)[0], str(matches[0]))

    def test_existing_network_examples_have_independent_numerical_answers(self):
        # Fixed first 20 bits and 12 free bits: count via binomial coefficients.
        fixed_ones = ((128 << 12) | (42 << 4) | (208 >> 4)).bit_count()
        divisible_by_three = sum(math.comb(12, k) for k in range(13)
                                 if (fixed_ones + k) % 3 == 0)
        # First differing bit determines the longest common prefix.
        octets_a, octets_b = (112, 117, 107, 70), (112, 117, 121, 80)
        as_integer = lambda octets: sum(octet << (24 - 8 * i) for i, octet in enumerate(octets))
        common_bits = 32 - (as_integer(octets_a) ^ as_integer(octets_b)).bit_length()
        network = tuple(a & m for a, m in zip((95, 106, 135, 150), (255, 255, 255, 0)))
        expected = {
            'Модуль ipaddress': '.'.join(map(str, network)) + ' ' + str(sum(network)),
            'Число адресов с условием': f'{1 << 12} {divisible_by_three}',
            'Одна сеть на Python': str(common_bits),
            'Наибольший адрес узла': f'10.8.{(100 // 8) * 8 + 7}.254 {(1 << 11) - 2}',
        }
        self.assertEqual(divisible_by_three, 1365)
        self.assertEqual(common_bits, 19)
        for title, answer in expected.items():
            with self.subTest(title=title):
                slide = self.slides[title]
                self.assertEqual(slide.get('ans') or slide.get('out'), answer)
                self.assertEqual(execute(slide)[0], answer)
        practice = self.slides['Решения задач 1–4']['blocks']
        expected_practice = (
            str(sum(a & m for a, m in zip((200, 15, 100, 23), (255, 255, 252, 0)))),
            str((1 << 5) - 2),
            f'192.168.32.{(160 // 32) * 32 + 31}',
            str(common_bits + 1),
        )
        for block, answer in zip(practice, expected_practice):
            with self.subTest(answer=answer):
                self.assertEqual(block['ans'], answer)
                self.assertEqual(execute(block)[0], answer)

    def test_supplement_does_not_claim_a_mandatory_current_exam_format(self):
        intro = self.slides['IPv4 из фрагментов']
        self.assertEqual(intro['k'], 'Дополнительный навык')
        self.assertIn('не означает', intro['sub'])
        self.assertIn('ведущие нули', self.slides['Проверяем адрес целиком']['html'])
        # The pre-existing worked /21 and /27 answers stay unchanged; exceptions
        # are explained rather than silently applying num_addresses - 2 to /31.
        theory = self.slides['Возможные байты маски']['html']
        self.assertIn('/31', theory)
        self.assertIn('/32', theory)


if __name__ == '__main__':
    unittest.main()
