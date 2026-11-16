"""Cross-surface numbering and honest material coverage, independent of stored IDs."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from learning_catalog import TOPICS, PYTHON_TOPICS, python_metadata, public_catalog
from learning_content import course_coverage
import server

ROOT = Path(__file__).resolve().parent.parent


class CatalogTest(unittest.TestCase):
    def test_approved_numbering_is_shared_by_python_labs_and_lessons(self):
        catalog = public_catalog()
        self.assertEqual(catalog['edition']['status'], 'approved')
        topics = {t['n']: t for t in catalog['topics']}
        self.assertEqual(set(topics), set(range(1, 29)))
        with patch.object(server, 'HERE', ROOT):
            modules = {m['id']: m for m in server.pyc_index()}
            self.assertEqual(set(modules), set(PYTHON_TOPICS))
            for mid, n in [('m13', 13), ('m23', 23), ('m31', 28)]:
                module = server.pyc_module(mid)
                self.assertEqual(module['n'], n)
                self.assertEqual(modules[mid]['n'], n)
                self.assertIn(mid, [p['id'] for p in course_coverage(ROOT)['topics'][n-1]['python']])
                # Metadata normalization must not alter task identity, order or content.
                stored = json.loads((ROOT/'pycourse'/f'{mid}.json').read_text())
                self.assertEqual(module['id'], stored['id'])
                self.assertEqual(module['levels'], stored['levels'])
        self.assertIn('Поиск', topics[10]['title'])
        self.assertIsNone(topics[10]['model'])
        self.assertEqual(topics[13]['model'], 'net')
        self.assertIn('Исполнитель', topics[23]['title'])
        self.assertEqual(modules['m31']['group'], 'extra')
        for lab in catalog['labs']:
            self.assertEqual(lab['nums'], [t['n'] for t in TOPICS if t['model'] == lab['id']])
            self.assertEqual(lab['archive'], all(topics[n]['archive'] for n in lab['nums']))
        # The generator also uses the canonical map, not the old draft numbers.
        from tools.build_pycourse import load_modules
        sources = {m['id']: m for m in load_modules(set())}
        for mid, module in modules.items():
            self.assertEqual((sources[mid]['n'], sources[mid]['group']), (module['n'], module['group']))

    def test_material_counts_follow_real_files_parts_and_index(self):
        tasks = {'one': {'n': 13}, 'game': {'n': 19, 'parts': [{'n': 19}, {'n': 20}, {'n': 21}]}}
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root/'course').mkdir(); (root/'pycourse').mkdir()
            (root/'course/19.json').write_text(json.dumps({'slides': [{'t': 'text'}]*2}))
            (root/'pycourse/index.json').write_text(json.dumps([{'id': 'm13', 'n': 10, 'title': 'Сети',
                'levels': [{'tasks': ['m13.first', 'm13.second']}]}]))
            result = course_coverage(root, tasks)
            rows = {t['n']: t for t in result['topics']}
            self.assertEqual((result['full_count'], result['unique_lessons'], result['guide_count']), (3, 1, 24))
            for n in [19, 20, 21]:
                self.assertTrue(rows[n]['lesson']); self.assertFalse(rows[n]['guide'])
                self.assertEqual((rows[n]['lesson_n'], rows[n]['slides'], rows[n]['practice_count']), (19, 2, 1))
            self.assertEqual((rows[13]['practice_count'], rows[13]['python_tasks']), (1, 2))
            self.assertEqual((rows[10]['practice_count'], rows[10]['python_tasks']), (0, 0))
            self.assertFalse(rows[13]['lesson']); self.assertTrue(rows[13]['guide'])
            self.assertIsNone(course_coverage(root)['topics'][12]['practice_count'])
            self.assertNotIn('first', json.dumps(result))  # only counts, no exercise IDs/answers
            (root/'course/19.json').unlink()
            self.assertEqual(course_coverage(root, tasks)['full_count'], 0)

    def test_catalog_does_not_change_input_progress_keys(self):
        module = {'id': 'm13', 'n': 10, 'levels': [{'tasks': ['m13.kept']}], 'title': 'Сети'}
        updated = python_metadata(module)
        self.assertEqual(module['n'], 10)
        self.assertEqual(updated['n'], 13)
        self.assertIs(updated['levels'], module['levels'])

    def test_legacy_module_without_id_uses_validated_filename_without_mutating_cache(self):
        for mid, expected_n in [('m90', None), ('m13', 13)]:
            with self.subTest(mid=mid):
                cached = {'levels': [{'need': 1, 'tasks': [{'id': mid + '.kept',
                    'files': [{'url': 'pyc-data/' + mid + '/a.txt'}]}]}]}
                with patch.object(server, 'pyc_load', return_value=cached) as loader:
                    module = server.pyc_module(mid)
                    loader.assert_called_once_with(mid + '.json')
                    self.assertEqual(module['id'], mid)
                    self.assertEqual(module['n'], expected_n)
                    self.assertIs(module['levels'], cached['levels'])
                    self.assertNotIn('id', cached)
                    self.assertNotIn('n', cached)
                    self.assertIsNone(server.pyc_module('../' + mid))
                    loader.assert_called_once()


if __name__ == '__main__':
    unittest.main()
