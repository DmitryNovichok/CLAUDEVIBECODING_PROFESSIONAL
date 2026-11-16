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


    def test_learning_ui_is_optional_while_forecast_and_python_stay_in_main(self):
        initial, learning = build_app.build(), build_app.build_learning()
        for implementation in ('function slideHtml(', 'function pycTaskHtml(', 'function labRenderModel(', 'function bugRenderCase('):
            self.assertNotIn(implementation, initial)
            self.assertIn(implementation, learning)
        for entry in ('openCourse', 'openLesson', 'openCourseSet', 'openPyc', 'openPycLevel', 'openLab', 'openArdGate'):
            self.assertIn('function ' + entry + '(', initial)
        for essential in ('function forecast(', 'function courseSet(', 'function pyDisposeSession(', 'function pySync('):
            self.assertIn(essential, initial)
        self.assertIn('window.EgeLearningSections = function (bridge)', learning)
        self.assertNotIn('eval(', learning)
        self.assertNotIn('new Function(', learning)

if __name__ == '__main__':
    unittest.main()
