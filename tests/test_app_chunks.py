"""Shipping boundaries: optional exams are absent from the initial executable."""
import unittest
from tools import build_app


class AppChunksTest(unittest.TestCase):
    def test_exam_implementations_are_separate_and_entry_points_stay_available(self):
        initial, exams = build_app.build(), build_app.build_exams()
        for implementation in ('function mkShow(', 'function imTrialRender(', 'function createImTrialSaver('):
            self.assertNotIn(implementation, initial)
            self.assertIn(implementation, exams)
        self.assertIn('function openMcko()', initial)
        self.assertIn('function openIm()', initial)
        self.assertIn('window.EgeExamSections = function (bridge)', exams)


if __name__ == '__main__':
    unittest.main()
