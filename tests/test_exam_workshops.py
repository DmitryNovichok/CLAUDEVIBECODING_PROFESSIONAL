"""Independent solutions and grading checks for the exam workshops."""
import json
import re
import unittest
from collections import Counter
from fractions import Fraction
from itertools import accumulate, combinations
from math import isqrt
from pathlib import Path

from pycourse_grading import grade, public_practice
from server import pyc_norm


COURSE = Path(__file__).resolve().parents[1] / 'pycourse'
TASKS = {t['id']: t for mid in ('m26', 'm33', 'm34', 'm35', 'm36')
         for level in json.loads((COURSE / (mid + '.json')).read_text())['levels'] for t in level['tasks']}


class ExamWorkshopsTest(unittest.TestCase):
    def test_worksheet_requires_every_cell_and_accepts_decimal_comma(self):
        t = TASKS['m36.energy']
        rows = [[v.replace('.', ',') for v in line.split()] for line in t['ans'].splitlines()]
        self.assertEqual(grade(t, {'rows': rows[:2]}, pyc_norm), (False, {'verified_rows': 2}))
        self.assertEqual(grade(t, {'rows': [['0']] + rows[1:]}, pyc_norm), (False, {'cell': {'row': 0, 'column': 0}}))
        self.assertEqual(grade(t, {'rows': rows}, pyc_norm), (True, {}))
        for answers in ([], [[]], [['']], rows + rows):
            with self.assertRaises(ValueError):
                grade(t, {'rows': answers}, pyc_norm)

    def test_program_outputs_are_graded_beyond_the_worked_example(self):
        for t in TASKS.values():
            if not t.get('practice', {}).get('graded'):
                continue
            cases = t['practice']['cases']
            public = public_practice(t['practice'])['cases']
            self.assertEqual(public[0], cases[0])
            self.assertEqual(public[1:], [{'input': c['input']} for c in cases[1:]])
            with self.assertRaises(ValueError):
                grade(t, {'answer': cases[0]['output']}, pyc_norm)
            outputs = [c['output'] for c in cases]
            self.assertEqual(grade(t, {'outputs': outputs}, pyc_norm), (True, {}))
            outputs[-1] += ' extra'
            self.assertEqual(grade(t, {'outputs': outputs}, pyc_norm)[1], {
                'case_error': {'index': len(cases) - 1, 'expected': cases[-1]['output']}})

    def test_numeric_searches(self):
        def is_prime(n):
            return n >= 2 and all(n % d for d in range(2, isqrt(n) + 1))

        pairs = [(n, n // 35) for n in range(1000, 500001) if n % 35 == 0 and re.fullmatch(r'3\d7\d*5', str(n))]
        primes = []
        for n in range(20001, 100001):
            p = next((d for d in range(2, isqrt(n) + 1) if n % d == 0), None)
            if p and is_prime(n // p) and str(p).count('3') == str(n // p).count('3') == 1:
                primes.append((n, p))
                if len(primes) == 5:
                    break
        for key, result in [('exam_mask', pairs[:5]), ('exam_primes', primes)]:
            self.assertEqual([list(x) for x in result], [list(map(int, line.split())) for line in TASKS['m34.' + key]['ans'].splitlines()])

    def test_expression_file_uses_the_longest_valid_substring(self):
        # Parse numbers and operators directly, independently of the course's re pattern.
        text = (COURSE / 'data/m33/file/24.txt').read_text().strip()
        best = 0
        for start in range(len(text)):
            i = start
            while i < len(text) and text[i] in '06789':
                if text[i] == '0':
                    i += 1
                else:
                    while i < len(text) and text[i] in '06789':
                        i += 1
                best = max(best, i - start)
                if i == len(text) or text[i] not in '-*':
                    break
                i += 1
        self.assertEqual(int(TASKS['m33.file']['ans']), best)

    def test_admission_file_admits_whole_score_groups(self):
        header, *rows = (COURSE / 'data/m26/admission_file/26.txt').read_text().splitlines()
        n, places = map(int, header.split())
        self.assertEqual(len(rows), n)
        groups = Counter(sum(map(int, row.split()[1:])) for row in rows)
        admitted, contest = 0, 0
        for score in sorted(groups, reverse=True):
            if admitted == places:
                break
            if groups[score] > places - admitted:
                contest = groups[score]
                break
            admitted += groups[score]
        self.assertEqual(TASKS['m26.admission_file']['ans'], f'{admitted} {contest}')

    def test_locker_file_processes_equal_arrivals_in_input_order(self):
        header, *rows = (COURSE / 'data/m26/locker_file/26.txt').read_text().splitlines()
        lockers, n = map(int, header.split())
        self.assertEqual(len(rows), n)
        arrivals = {}
        for row in rows:
            arrival, pickup = map(int, row.split())
            arrivals.setdefault(arrival, []).append(pickup)
        free = set(range(1, lockers + 1))
        releases = {}
        count = last = 0
        for minute in range(max(arrivals) + 1):
            free.update(releases.pop(minute, []))
            for pickup in arrivals.get(minute, []):
                if free:
                    last = min(free)
                    free.remove(last)
                    releases.setdefault(pickup + 1, []).append(last)
                    count += 1
        self.assertEqual(TASKS['m26.locker_file']['ans'], f'{count} {last}')

    def test_purchase_file_and_practice_check_all_three_priorities(self):
        header, *rows = (COURSE / 'data/m26/purchase_file/26.txt').read_text().splitlines()
        n, budget = map(int, header.split())
        self.assertEqual(len(rows), n)
        prices = [row.split() for row in rows]
        cost_a, cost_b = [list(accumulate(sorted(int(p) for k, p in prices if k == kind), initial=0))
                          for kind in ('A', 'B')]
        _, preferred, left = max((a + b, a, budget - ca - cb)
                                 for a, ca in enumerate(cost_a) for b, cb in enumerate(cost_b)
                                 if ca + cb <= budget)
        self.assertEqual(TASKS['m26.purchase_file']['ans'], f'{preferred} {left}')
        # On the small exercises we can independently try buying each possible subset.
        for case in TASKS['m26.purchase_code']['practice']['cases']:
            header, *rows = case['input'].splitlines()
            n, budget = map(int, header.split())
            best = (0, 0, budget)
            for size in range(1, n + 1):
                for subset in combinations(rows, size):
                    left = budget - sum(int(row.split()[1]) for row in subset)
                    if left >= 0:
                        best = max(best, (size, sum(row.startswith('A ') for row in subset), left))
            self.assertEqual(tuple(map(int, case['output'].split())), best)

    def test_event_file_and_cutoff(self):
        header, *rows = (COURSE / 'data/m35/file/26.txt').read_text().splitlines()
        n, capacity = map(int, header.split())
        self.assertEqual(n, len(rows))
        events = []
        totals = Counter()
        for line in rows:
            time, raw_id, raw_size = line.split()
            h, m, s = map(int, time.split(':'))
            sid, size = int(raw_id), int(raw_size)
            totals[sid] += size
            events.append((3600*h + 60*m + s, size))
        self.assertNotEqual(events, sorted(events))
        room = capacity
        copies = {}
        for time, size in sorted(events):
            if size > room:
                copies[time] = capacity - room
                room = capacity
            room -= size
        noon = 12 * 3600
        self.assertIn(noon - 1, copies)
        self.assertIn(noon, copies)
        best = min(sid for sid in totals if totals[sid] == max(totals.values()))
        total = sum(sorted(size for time, size in copies.items() if time < noon)[-2:])
        self.assertEqual(TASKS['m35.file']['ans'], f'{best} {total}')
        self.assertEqual(TASKS['m35.buffer']['ans'].splitlines(), ['0 6', '0 10', '10 1', '0 10', '10 2'])

    def test_particle_file_using_exact_arithmetic(self):
        groups = {base: [] for base in (1, 4, 7, 10)}
        for line in (COURSE / 'data/m36/file/27.txt').read_text().splitlines():
            *values, tag = line.replace(',', '.').split()
            x, y, vx, vy, mass = map(Fraction, values)
            energy = mass * (vx**2 + vy**2) / 2
            base, = [b for b in groups if b <= energy <= b + 2]
            groups[base].append((energy, x, y, tag))
        centers = []
        squares = []
        for base, points in groups.items():
            energies = [p[0] for p in points]
            self.assertEqual((min(energies), max(energies)), (base, base + 2))
            self.assertEqual(len(energies), len(set(energies)))
            self.assertEqual(len(energies) % 2, 1)
            centers.append(min(energies, key=lambda e: sum(abs(e - other) for other in energies)))
            pairs = combinations([(x, y) for _, x, y, tag in points if tag == 'II'], 2)
            squares.extend((x - u)**2 + (y - v)**2 for (x, y), (u, v) in pairs)
        squared = max(squares) * 10000**2
        self.assertEqual(TASKS['m36.file']['ans'], f'{isqrt(squared.numerator // squared.denominator)} {int(max(centers)*10000)}')
