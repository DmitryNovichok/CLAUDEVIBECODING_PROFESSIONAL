"""Уроки раздела «Курс» (№15, 24–27 и архивное 23_old — файл 28.json): собранные course/*.json согласованы с программами и файлами данных."""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSONS = (15, 24, 25, 26, 27, 28)                # 28 — архивное 23_old (kim.py)


def run(code, files):
    """Выполняет программу со слайда в пустой папке, куда положены её файлы данных."""
    tmp, old = tempfile.mkdtemp(), os.getcwd()
    try:
        for f in files:
            name, n = f['name'], f['url'].split('/')[1]
            shutil.copy(ROOT / 'course' / 'data' / n / name, Path(tmp) / name)
        os.chdir(tmp)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(compile(code, '<slide>', 'exec'), {'__name__': '__main__'})
        return out.getvalue().strip()
    finally:
        os.chdir(old)
        shutil.rmtree(tmp, ignore_errors=True)


class CourseLessonsTest(unittest.TestCase):
    def lesson(self, n):
        return json.loads((ROOT / 'course' / f'{n}.json').read_text(encoding='utf-8'))

    def test_structure(self):
        for n in LESSONS:
            d = self.lesson(n)
            self.assertEqual(d['n'], n)
            kinds = [s['t'] for s in d['slides']]
            self.assertEqual(kinds[0], 'title', n)
            self.assertGreaterEqual(len(kinds), 18, n)
            self.assertGreaterEqual(kinds.count('code') + kinds.count('codes'), 5, n)   # урок — это разборы, а не только текст
            self.assertGreaterEqual(kinds.count('section'), 2, n)
            self.assertTrue(all(s['t'] in ('title', 'section', 'text', 'code', 'codes', 'solve') and s.get('h') for s in d['slides']), n)
            titles = [s['h'] for s in d['slides']]
            for must in ('Что это за задание', 'Решите самостоятельно', 'Ответы'):
                self.assertIn(must, titles, n)
            self.assertTrue(any('Шпаргалка' == s.get('k') for s in d['slides']), n)
            self.assertTrue(any('Ловушки' == s.get('k') for s in d['slides']), n)

    def test_every_program_prints_the_answer_on_its_slide(self):
        checked = 0
        for n in LESSONS:
            for s in self.lesson(n)['slides']:
                for b in ([s] if s['t'] == 'code' else s.get('blocks', [])):
                    files = b.get('files', [])
                    for f in files:
                        self.assertRegex(f['url'], rf'^course-data/{n}/[A-Za-z0-9_.-]+\?v=[0-9a-f]{{8}}$')
                        self.assertTrue((ROOT / 'course' / 'data' / str(n) / f['name']).is_file(), f)
                    want = b.get('ans') or b.get('out')
                    self.assertTrue(want, (n, s['h']))
                    self.assertEqual(run(b['code'], files), want, (n, s['h']))
                    checked += 1
        self.assertGreaterEqual(checked, 60)

    def test_data_files_are_small_and_all_used(self):
        used = {(n, f['name']) for n in LESSONS for s in self.lesson(n)['slides']
                for b in ([s] if s['t'] == 'code' else s.get('blocks', [])) for f in b.get('files', [])}
        on_disk = {(int(p.parent.name), p.name) for p in (ROOT / 'course' / 'data').glob('*/*')}
        self.assertEqual(used, on_disk)
        self.assertLess(sum(p.stat().st_size for p in (ROOT / 'course' / 'data').glob('*/*')), 600_000)

    def test_no_real_names_and_no_external_links(self):
        for n in LESSONS:
            text = (ROOT / 'course' / f'{n}.json').read_text(encoding='utf-8')
            self.assertNotIn('http://', text)
            self.assertNotIn('https://', text)
            self.assertNotIn('<script', text.lower())


if __name__ == '__main__':
    unittest.main()
