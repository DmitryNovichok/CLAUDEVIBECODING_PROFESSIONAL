"""Reference presence, private-content boundary and honest skill coverage semantics."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import clusters
from learning_content import course_coverage
from learning_skills import skill_coverage, _file_checks, read_metadata, MAP_PATH

ROOT = Path(__file__).resolve().parent.parent


class LearningSkillsTest(unittest.TestCase):
    def test_every_bank_type_has_an_explicit_inventory_or_gap(self):
        mappings = read_metadata(MAP_PATH)['rows']
        expected = {f'{n}.{key}' for n, rules in clusters.RULES.items() for key, _, _ in rules}
        self.assertTrue(expected <= {m['key'] for m in mappings})
        report = skill_coverage(ROOT, {})
        rows = {r['id']: r for r in report['rows']}
        self.assertFalse([r['id'] for r in rows.values() if r['reference_issues']])
        self.assertEqual(report['summary']['semantically_verified'], 0)
        self.assertTrue(all(not r['semantic_verified'] and r['review_status'] == 'not_reviewed' for r in rows.values()))
        self.assertTrue(all(not r['practice']['answers_verified'] for r in rows.values()))
        for key in ('6.area', '6.trace', '12.count', '13.frag', '23.graph', '27.seq'):
            self.assertEqual(rows[key]['material_status'], 'material_found')
        self.assertTrue(rows['28.count']['archive'])
        self.assertTrue(rows['23.graph']['archive'])
        self.assertTrue(rows['27.seq']['archive'])
        self.assertEqual(rows['23.graph']['archive_label'], '23_old')
        self.assertEqual(rows['27.seq']['archive_label'], 'прежние форматы №27')
        self.assertTrue(all(e['n'] == 28 for e in rows['23.graph']['evidence']))
        self.assertFalse(rows['23.traj']['archive'])
        self.assertFalse(rows['27.clusters']['archive'])
        self.assertEqual(rows['27.seq']['evidence'][0]['label'], 'Архив прежние форматы №27')
        for key in ('counter', 'split', 'window', 'positions', 'regex'):
            row = rows['24.' + key]
            self.assertEqual(row['kind'], 'subskill')
            self.assertTrue(row['evidence'])
            self.assertEqual(row['practice']['scope'], 'parent_type')

    def test_source_changes_and_unavailable_inputs_do_not_keep_a_healthy_badge(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root/'course').mkdir()
            file = root/'course/13.json'
            slide = {'t': 'code', 'h': 'Сети', 'code': 'PRIVATE_PROGRAM', 'ans': 'PRIVATE_ANSWER',
                     'files': [{'name': 'PRIVATE_INPUT_NAME', 'url': 'course-data/13/PRIVATE_INPUT.txt'}]}
            file.write_text(json.dumps({'slides': [slide]}))
            mapping = [{'key': '13.count', 'lesson': {'n': 13, 'slides': [{'index': 0, 'title': 'Сети', 'kind': 'code'}]}}]
            report = skill_coverage(root, {}, mapping)
            row = next(r for r in report['rows'] if r['id'] == '13.count')
            self.assertEqual(row['material_status'], 'partial')
            self.assertEqual(row['evidence'][0]['inputs']['missing'], 1)
            text = json.dumps(report)
            for private in ('PRIVATE_PROGRAM', 'PRIVATE_ANSWER', 'PRIVATE_INPUT_NAME', 'PRIVATE_INPUT.txt'):
                self.assertNotIn(private, text)
            (root/'course/data/13').mkdir(parents=True)
            (root/'course/data/13/PRIVATE_INPUT.txt').write_text('PRIVATE_BYTES')
            healthy = next(r for r in skill_coverage(root, {}, mapping)['rows'] if r['id'] == '13.count')
            self.assertEqual(healthy['material_status'], 'material_found')
            slide['h'] = 'Другая тема'
            file.write_text(json.dumps({'slides': [slide]}))
            stale = next(r for r in skill_coverage(root, {}, mapping)['rows'] if r['id'] == '13.count')
            self.assertEqual(stale['material_status'], 'missing_reference')
            self.assertFalse(stale['evidence'])

    def test_public_report_contains_no_exercise_ids_or_private_fields(self):
        report = skill_coverage(ROOT, {})
        text = json.dumps(report, ensure_ascii=False)
        self.assertNotRegex(text, r'm\d{2}\.[A-Za-z_0-9]+')
        def inspect(node):
            if isinstance(node, dict):
                self.assertFalse(set(node) & {'ans', 'answer', 'sol', 'code', 'html', 'cond', 'url', 'href', 'files', 'task_id', 'student_id'})
                for child in node.values(): inspect(child)
            elif isinstance(node, list):
                for child in node: inspect(child)
        inspect(report)

    def test_parts_match_number_counts_and_subskills_do_not_invent_their_own_classification(self):
        tasks = {'g': {'n': 19, 'c': 'two', 'parts': [{'n': 19}, {'n': 20}, {'n': 21}]},
                 's': {'n': 24, 'c': 'longest'}, 'x': {'n': 13, 'c': 'not-a-type'}}
        with patch('learning_skills.clusters.classify', side_effect=AssertionError('already classified')):
            report = skill_coverage(ROOT, tasks)
        rows = {r['id']: r for r in report['rows']}
        numbers = {r['n']: r['practice_count'] for r in course_coverage(ROOT, tasks)['topics']}
        for n in [19, 20, 21]:
            key = {19:'19.two',20:'20.win2',21:'21.opponent_win2'}[n]
            self.assertEqual(rows[key]['practice']['count'], numbers[n])
        self.assertEqual(rows['24.window']['practice'], {**rows['24.longest']['practice'], 'scope':'parent_type'})
        self.assertEqual(rows['13.misc']['practice']['count'], 1)
        unknown = next(r for r in skill_coverage(ROOT)['rows'] if r['id'] == '13.count')
        self.assertIsNone(unknown['practice']['count'])

    def test_granular_inventory_is_opt_in(self):
        with patch('learning_skills.skill_coverage', side_effect=AssertionError('not requested')):
            self.assertNotIn('skill_coverage', course_coverage(ROOT, {}))
        self.assertIn('skill_coverage', course_coverage(ROOT, {}, include_skills=True))

    def test_bad_input_metadata_is_reported_without_opening_foreign_paths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            cases = [{'files': [{'url': 'http://['}]}, {'files': None}, {'files':'bad'},
                     {'files': [None]}, {'files': [{'url':'course-data/13/../../../outside.txt'}]},
                     {'files': [{'url':'https://example.invalid/private.txt'}]}]
            for value in cases:
                self.assertEqual(_file_checks(root, value)['invalid'], 1)
            (root/'course').mkdir(); (root/'course/13.json').write_text('[]')
            mapping = [{'key': '13.count', 'lesson': {'n':13,'slides':[{'index':0,'title':'X','kind':'code'}]}}]
            report = skill_coverage(root, {}, mapping)
            self.assertEqual(next(r for r in report['rows'] if r['id']=='13.count')['material_status'], 'missing_reference')


if __name__ == '__main__':
    unittest.main()
