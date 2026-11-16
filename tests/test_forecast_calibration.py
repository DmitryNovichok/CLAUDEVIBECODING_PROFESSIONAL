"""Synthetic data only: no live predictions or pupil outcomes are asserted."""
import csv
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import forecast_calibration as fc

ROOT=Path(__file__).resolve().parent.parent


def row(**changes):
    return dict(zip(fc.FIELDS,('pupil_1','mock_1','2026-01-01T12:00:00Z','2026-01-02T12:00:00Z',
        '2026-01-02T16:00:00Z','60','65','80','27','2.72.0','synthetic')),**{}) | changes


def cohort():
    needed={'train':30,'validation':15,'holdout':15}
    groups={key:[] for key in needed}
    for i in range(10000):
        key=f'synthetic_{i}'
        split=fc.split_for(key)
        if len(groups[split])<needed[split]:
            groups[split].append(fc.Observation(key,'exam',1,2,3,40+i%40,48+i%40,70,27,'test','synthetic'))
        if all(len(groups[k])==needed[k] for k in needed):break
    return [r for values in groups.values() for r in values]


class ImportTest(unittest.TestCase):
    def read(self,rows,fields=fc.FIELDS):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'data.csv'
            with path.open('w',encoding='utf-8',newline='') as out:
                writer=csv.DictWriter(out,fieldnames=fields);writer.writeheader();writer.writerows(rows)
            return fc.read_csv(path)

    def test_import_requires_frozen_predictions_and_unambiguous_valid_outcomes(self):
        self.assertEqual(self.read([row()])[0].actual,65)
        for changes in ({'predicted_at':'2026-01-02T13:00:00Z'}, {'predicted_at':'2026-01-01'},
                        {'prediction':'nan'},{'actual':'65.5'},{'actual':'101'},
                        {'covered_numbers_30d':'27','independent_answers_30d':'2'},
                        {'student_key':'name@example.com'},{'exam_finished_at':'2099-01-02T16:00:00Z'},
                        {'source':'unknown'}):
            with self.subTest(changes=changes),self.assertRaises(fc.DatasetError):self.read([row(**changes)])
        with self.assertRaises(fc.DatasetError):self.read([row(),row()])
        with self.assertRaises(fc.DatasetError):self.read([row(),row(student_key='other',model_version='old')])
        with self.assertRaises(fc.DatasetError):self.read([row(),row(student_key='other',source='external_mock')])
        with self.assertRaises(fc.DatasetError):self.read([row(email='private@example.com')],(*fc.FIELDS,'email'))

    def test_template_is_empty_and_output_never_overwrites_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'template.csv'
            command=[sys.executable,str(ROOT/'tools/calibrate_forecast.py'),'template','--output',str(path)]
            self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(path.read_text().strip(),','.join(fc.FIELDS))
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)


class EvaluationTest(unittest.TestCase):
    def test_student_disjoint_splits_and_synthetic_report_never_claim_real_accuracy(self):
        rows=cohort()
        report=fc.evaluate(rows)
        self.assertEqual(report['status'],'synthetic_test')
        self.assertFalse(report['applied_to_live_model'])
        self.assertIsNone(report['confidence_interval'])
        self.assertEqual(report['selected_offset'],8)
        self.assertEqual(report['selected_holdout']['mae'],0)
        self.assertEqual(report['baseline']['holdout']['mae'],8)
        for r in rows:self.assertEqual(fc.split_for(r.student),fc.split_for(replace(r,exam='second').student))
        text=json.dumps(report)
        self.assertNotIn('synthetic_0',text)
        self.assertIn('не оценка точности сайта',fc.markdown(report))

    def test_holdout_never_selects_or_tunes_the_correction(self):
        rows=cohort()
        rows=[replace(r,actual=r.prediction-10) if fc.split_for(r.student)=='validation' else r for r in rows]
        before=fc.evaluate(rows)
        changed=[replace(r,actual=100) if fc.split_for(r.student)=='holdout' else r for r in rows]
        after=fc.evaluate(changed)
        self.assertEqual(before['selected_offset'],0)
        self.assertEqual(after['selected_offset'],before['selected_offset'])
        self.assertEqual(after['candidate'],before['candidate'])
        self.assertNotEqual(after['selected_holdout'],before['selected_holdout'])

    def test_repeat_exams_do_not_overweight_one_pupil(self):
        a=fc.Observation('a','one',1,2,3,100,0,27,27,'test','synthetic')
        b=replace(a,student='b',prediction=0)
        self.assertEqual(fc.metrics([a,b])['bias'],50)
        self.assertEqual(fc.metrics([replace(a,exam=str(i)) for i in range(100)]+[b])['bias'],50)

    def test_small_real_cohort_is_descriptive_and_never_fits_offset(self):
        rows=[replace(r,source='external_mock') for r in cohort()[:5]]
        report=fc.evaluate(rows)
        self.assertEqual(report['status'],'insufficient_sample')
        self.assertIsNone(report['candidate']['offset'])
        self.assertEqual(report['selected_offset'],0)
