"""Лаборатория исправления ошибок: задачи честные (эталон проходит, «ошибочное» решение — нет),
ответы наружу не выходят, сервер засчитывает решение только по верным выводам на всех тестах."""
import contextlib
import io
import json
import signal
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
import buglab
import server
import test_server as fixtures
from learning_access import set_learning_passwords


def run(code, stdin, limit=3):
    """Выполнить код на входных данных: (вывод, имя исключения или None). Зависшая программа — TimeoutError."""
    out, old = io.StringIO(), sys.stdin

    def stop(*_):
        raise TimeoutError()
    signal.signal(signal.SIGALRM, stop)
    signal.alarm(limit)
    try:
        sys.stdin = io.StringIO(stdin)
        with contextlib.redirect_stdout(out):
            exec(compile(code, '<case>', 'exec'), {'__name__': '__main__'})
        return out.getvalue(), None
    except BaseException as exc:                     # в задачах есть и падения, и бесконечная рекурсия
        return out.getvalue(), type(exc).__name__
    finally:
        signal.alarm(0)
        sys.stdin = old


class BugLabCasesTest(unittest.TestCase):
    def test_every_case_is_fair(self):
        self.assertGreaterEqual(len(buglab.CASES), 12)
        self.assertEqual(len(buglab.BY_ID), len(buglab.CASES))
        for c in buglab.CASES:
            with self.subTest(case=c['id']):
                self.assertIn(c['level'], buglab.LEVELS)
                self.assertIn(c['kind'], buglab.KINDS)
                self.assertGreaterEqual(len(c['inputs']), 4)
                self.assertGreaterEqual(len(c['hints']), 2)
                self.assertTrue(c['explain'])
                self.assertTrue(0 < c['open'] < len(c['inputs']))                      # есть и открытые, и скрытые тесты
                self.assertGreater(len(set(c['expected'])), 1)                          # ответ нельзя угадать одной константой
                runs = [dict(zip(('out', 'err'), run(c['code'], x))) for x in c['inputs']]
                broken = buglab.check(c, [{'out': r['out'], 'err': bool(r['err'])} for r in runs])
                self.assertFalse(all(t['ok'] for t in broken), 'исходное решение уже проходит все тесты')
                fixed = buglab.check(c, [{'out': run(c['ref'], x)[0]} for x in c['inputs']])
                self.assertTrue(all(t['ok'] for t in fixed), 'эталон не проходит свои тесты')
                self.assertLessEqual(buglab.changed_lines(c, c['ref']), c['par'])       # ★ достижима эталонной правкой
                self.assertEqual(buglab.changed_lines(c, c['code']), 0)

    def test_public_view_hides_answers(self):
        for c in buglab.CASES:
            pub = buglab.public(c)
            text = json.dumps(pub, ensure_ascii=False)
            self.assertNotIn('ref', pub)
            self.assertNotIn('explain', pub)
            self.assertNotIn('expected', pub)
            self.assertNotIn(c['ref'].strip(), text)
            for i, t in enumerate(pub['tests']):
                self.assertEqual('exp' in t, i < c['open'])
            self.assertEqual([('exp' in t) for t in buglab.check(c, [])], [i < c['open'] for i in range(len(c['inputs']))])

    def test_output_is_compared_by_words(self):
        c = buglab.BY_ID['pairs']
        runs = [{'out': '  ' + e.replace(' ', '\n') + ' \n\n'} for e in c['expected']]
        self.assertTrue(all(t['ok'] for t in buglab.check(c, runs)))
        runs[0] = {'out': c['expected'][0], 'err': 1}
        runs[1] = {'out': c['expected'][1], 'timeout': 1}
        self.assertEqual([t['ok'] for t in buglab.check(c, runs)][:3], [False, False, True])
        self.assertFalse(any(t['ok'] for t in buglab.check(c, ['x', None])))             # мусор вместо выводов — не падаем


class BugLabHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.client = fixtures.ServerTest()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.client.setUp()
        self.db = server.APP.db
        server._BUG_TRIES.clear()
        type(self).serial += 1                                                           # у каждого теста — свой ученик
        with contextlib.redirect_stdout(io.StringIO()):
            self.token = self.client.login('Ошибкин ' + ['Первый', 'Второй', 'Третий'][self.serial - 1])
        self.sid = self.client.req('GET', '/api/me', token=self.token)[1]['sid']
        set_learning_passwords(self.db.conn, 'synthetic-lesson-pass')

    def req(self, path, body=None, token=True):
        return self.client.req('POST' if body is not None else 'GET', path, body, self.token if token else None)

    def test_flow(self):
        self.assertEqual(self.req('/api/lab/bugs', token=False)[0], 401)
        self.assertEqual(self.req('/api/lab/bugs')[0], 403)                              # лаборатории ещё не открыты
        self.assertEqual(self.req('/api/lab/bugs/check', {'id': 'even-sum', 'runs': []})[0], 403)
        self.assertTrue(self.req('/api/lab/unlock', {'password': 'synthetic-lesson-pass'})[1]['access'])
        st, d = self.req('/api/lab/bugs')
        self.assertEqual((st, len(d['cases'])), (200, len(buglab.CASES)))
        self.assertNotIn('ref', json.dumps(d))
        self.assertEqual(d['cases'][0]['my'], {'ok': 0, 'tries': 0, 'star': 0, 'seen': 0})
        c = buglab.BY_ID['even-sum']
        self.assertEqual(self.req('/api/lab/bugs/check', {'id': 'нет-такой', 'runs': []})[0], 404)
        self.assertEqual(self.req('/api/lab/bugs/explain', {'id': c['id']})[0], 403)     # разбор — не раньше трёх проверок
        wrong = [{'out': run(c['code'], x)[0]} for x in c['inputs']]
        st, r = self.req('/api/lab/bugs/check', {'id': c['id'], 'code': c['code'], 'runs': wrong})
        self.assertEqual((st, r['ok'], r['my']['tries'], r['changed']), (200, False, 1, 0))
        self.assertNotIn('explain', r)
        self.assertEqual([('exp' in t) for t in r['tests']], [True, True, False, False])
        good = [{'out': e} for e in c['expected']]
        st, r = self.req('/api/lab/bugs/check', {'id': c['id'], 'code': c['ref'], 'runs': good})
        self.assertEqual((r['ok'], r['my']['ok'], r['my']['star'], r['my']['tries'], r['changed']), (True, 1, 1, 1, 1))
        self.assertEqual(r['explain'], c['explain'])
        # повторная неудачная проверка решённой задачи ничего не портит
        r = self.req('/api/lab/bugs/check', {'id': c['id'], 'code': c['code'], 'runs': wrong})[1]
        self.assertEqual((r['ok'], r['my']['ok'], r['my']['star'], r['my']['tries']), (False, 1, 1, 1))
        self.assertEqual(self.req('/api/lab/bugs/explain', {'id': c['id']})[1]['explain'], c['explain'])
        mine = {x['id']: x['my'] for x in self.req('/api/lab/bugs')[1]['cases']}
        self.assertEqual(mine['even-sum'], {'ok': 1, 'tries': 1, 'star': 1, 'seen': 0})

    def test_star_needs_small_fix_and_no_peeking(self):
        self.req('/api/lab/unlock', {'password': 'synthetic-lesson-pass'})
        c = buglab.BY_ID['digits']
        good = [{'out': e} for e in c['expected']]
        rewritten = 'print(len(input().strip()))\n'                                      # верно, но это уже не правка чужого кода
        r = self.req('/api/lab/bugs/check', {'id': c['id'], 'code': rewritten, 'runs': good})[1]
        self.assertEqual((r['ok'], r['my']['star']), (True, 0))
        self.assertGreater(r['changed'], r['par'])
        c = buglab.BY_ID['leap']
        bad = [{'out': 'NO'} for _ in c['inputs']]
        for _ in range(3):
            self.req('/api/lab/bugs/check', {'id': c['id'], 'code': c['code'], 'runs': bad})
        self.assertEqual(self.req('/api/lab/bugs/explain', {'id': c['id']})[0], 200)      # подсмотрел разбор
        r = self.req('/api/lab/bugs/check', {'id': c['id'], 'code': c['ref'], 'runs': [{'out': e} for e in c['expected']]})[1]
        self.assertEqual((r['ok'], r['my']['star'], r['my']['seen']), (True, 0, 1))

    def test_check_rate_limit(self):
        self.req('/api/lab/unlock', {'password': 'synthetic-lesson-pass'})
        codes = [self.req('/api/lab/bugs/check', {'id': 'leap', 'code': '', 'runs': []})[0] for _ in range(server.PYC_CHECKS + 1)]
        self.assertEqual((codes[0], codes[-1]), (200, 429))


if __name__ == '__main__':
    unittest.main()
