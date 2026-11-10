"""Run the exact Python tracer shipped to the browser, using synthetic programs."""
import json
import re
import sys
import unittest
from pathlib import Path


class LabTraceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (Path(__file__).resolve().parent.parent / 'lab-worker.js').read_text()
        python = re.search(r'const LAB_TRACE_PY = String.raw`(.*?)`;', source, re.S).group(1)
        namespace = {}
        exec(compile(python, 'lab-worker.js', 'exec'), namespace)
        cls.run_trace = staticmethod(lambda code, stdin='': json.loads(namespace['_lab_run'](code, stdin)))

    def test_line_means_before_execution_and_final_output_is_present(self):
        r = self.run_trace('x = 1\nx += 2\nprint(x)')
        self.assertEqual(r['error'], '')
        lines = [s for s in r['steps'] if s['event'] == 'line']
        self.assertEqual(lines[0]['variables'], [])
        self.assertEqual(lines[1]['variables'][0]['value'], '1')
        self.assertEqual(lines[2]['variables'][0]['value'], '3')
        self.assertEqual(r['output'][:r['steps'][-1]['out']], '3\n')

    def test_list_snapshots_do_not_change_retroactively(self):
        r = self.run_trace('a = [1, 2]\na[0] = 9\nprint(a)')
        lines = [s for s in r['steps'] if s['event'] == 'line']
        self.assertEqual(lines[1]['variables'][0]['items'], ['1', '2'])
        self.assertEqual(lines[2]['variables'][0]['items'], ['9', '2'])

    def test_functions_have_their_own_locals_and_stack(self):
        r = self.run_trace('def f(n):\n    return n * 2\nx = f(3)\nprint(x)')
        inner = next(s for s in r['steps'] if s['function'] == 'f' and s['event'] == 'line')
        self.assertEqual(inner['variables'][0]['name'], 'n')
        self.assertEqual(inner['variables'][0]['value'], '3')
        self.assertEqual([x['name'] for x in inner['stack']], ['f', '<module>'])
        self.assertEqual(r['output'], '6\n')

    def test_input_exceptions_and_streams_are_restored(self):
        before = (sys.stdin, sys.stdout, sys.stderr, sys.gettrace())
        r = self.run_trace('a = int(input())\nprint(a + 1)\nx = 1 / 0', '4\n')
        self.assertEqual(r['output'], '5\n')
        self.assertIn('ZeroDivisionError', r['error'])
        self.assertEqual(before, (sys.stdin, sys.stdout, sys.stderr, sys.gettrace()))
        self.assertTrue(any(s['event'] == 'exception' for s in r['steps']))

    def test_syntax_error_has_no_steps_and_next_run_starts_clean(self):
        r = self.run_trace('for :')
        self.assertIn('SyntaxError', r['error'])
        self.assertEqual(r['steps'], [])
        self.assertEqual(self.run_trace('print(42)')['output'], '42\n')

    def test_infinite_loop_is_bounded(self):
        r = self.run_trace('while True:\n    x = 1')
        self.assertTrue(r['truncated'])
        self.assertIn(r['stop'], ('steps', 'time'))
        self.assertLessEqual(len(r['steps']), 200000)

    def test_long_program_runs_to_the_end(self):
        r = self.run_trace('s = 0\nfor i in range(3000):\n    s += i\nprint(s)')
        self.assertFalse(r['truncated'])
        self.assertGreater(len(r['steps']), 6000)
        self.assertEqual(r['output'], '4498500\n')
        self.assertEqual(r['output'][:r['steps'][-1]['out']], '4498500\n')

    def test_values_are_bounded_without_calling_user_repr(self):
        r = self.run_trace('class X:\n    def __repr__(self):\n        raise RuntimeError("must not call")\nx = X()\na = list(range(1000))\na.append(a)\nn = 2 ** 10000\ns = "a" * 10000')
        self.assertFalse(r['error'])
        v = {x['name']: x for x in r['steps'][-1]['variables']}
        self.assertEqual(v['x']['value'], '<X>')
        self.assertEqual(len(v['a']['items']), 12)
        self.assertLess(len(v['n']['value']), 80)
        self.assertLess(len(v['s']['value']), 110)

    def test_dict_tuple_and_output_limits(self):
        r = self.run_trace('d = {"a": [1, 2]}\nt = (1, 2)\nprint("x" * 20000)')
        v = {x['name']: x['value'] for x in r['steps'][-1]['variables']}
        self.assertEqual(v['d'], "{'a': [1, 2]}")
        self.assertEqual(v['t'], '(1, 2)')
        self.assertEqual(len(r['output']), 20000)
        self.assertTrue(r['outputTruncated'])
