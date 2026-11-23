"""HTTP regressions for assigning, submitting and reporting the subnet laboratory."""
from concurrent.futures import ThreadPoolExecutor
from ipaddress import IPv4Network
from threading import Barrier
import secrets
import time
import unittest

import server
from test_teacher_work_boundary import TeacherWorkFixture


def simultaneous(fn, values):
    gate = Barrier(len(values))

    def run(value):
        gate.wait(timeout=5)
        return fn(value)

    with ThreadPoolExecutor(max_workers=len(values)) as pool:
        return list(pool.map(run, values))


class Lab13AssignmentTest(TeacherWorkFixture, unittest.TestCase):
    def session(self, sid):
        return server.session_new(self.db, sid, '127.0.0.1', 'Synthetic lab device', False)

    def assign(self, **extra):
        payload = {'class_id': self.cid, 'request_id': secrets.token_hex(16), **extra}
        status, data, _ = self.request('POST', 'assignment/lab13', payload)
        self.assertEqual(status, 200, data)
        return data['id']

    def listed(self, token):
        status, data = self.client.req('GET', '/api/assignments', token=token)
        self.assertEqual(status, 200, data)
        return {item['id']: item for item in data['assignments']}

    def lab(self, token, action, aid, **extra):
        return self.client.req('POST', '/api/asg/lab13/' + action, {'id': aid, **extra}, token)

    def cells(self, aid):
        status, data, _ = self.request('GET', f'class/journal?class_id={self.cid}')
        self.assertEqual(status, 200, data)
        column = next(col for col in data['assignments'] if col['id'] == aid)
        self.assertEqual((column['kind'], column['total']), ('lab13', 1))
        return {row['id']: row['cells'][str(aid)] for row in data['students']}

    def test_first_forecast_and_reference_count_reach_both_teacher_reports(self):
        second = self.pupil(self.tid, self.cid)
        aid = self.assign()
        cells = self.cells(aid)
        self.assertEqual([cells[sid]['st'] for sid in (self.sid, second)], ['none', 'none'])
        for sid, correct in ((self.sid, False), (second, True)):
            with self.subTest(sid=sid, correct=correct):
                token = self.session(sid)
                works = self.listed(token)
                self.assertEqual(works[self.aid]['kind'], 'self')
                self.assertEqual(works[aid]['kind'], 'lab13')
                self.assertNotIn('expected', works[aid]['lab13'])
                self.assertEqual(self.lab(token, 'answer', aid, prediction=10)[0], 409)
                status, start = self.lab(token, 'start', aid)
                self.assertEqual(status, 200, start)
                self.assertNotIn('expected', start)
                self.assertEqual(self.cells(aid)[sid]['st'], 'work')
                network = IPv4Network((start['ip'], start['prefix']), strict=False)
                # Count the network and broadcast addresses as well as usable hosts.
                expected = network.num_addresses
                forecast = expected if correct else expected - 2
                status, result = self.lab(token, 'answer', aid, prediction=forecast)
                self.assertEqual(status, 200, result)
                self.assertIs(result['correct'], correct)
                self.assertEqual((result['prediction'], result['expected']), (forecast, expected))
                self.assertLessEqual(result['started'], result['finished'])
                other_device = self.session(sid)
                self.assertEqual(self.listed(other_device)[aid]['lab13'], result)
                self.assertEqual(self.lab(other_device, 'answer', aid, prediction=expected), (200, result))
                cell = self.cells(aid)[sid]
                self.assertEqual((cell['st'], cell['pct'], cell['lab13']), ('done', 100 if correct else 0, result))
                status, live, _ = self.request('GET', f'asg/live?id={aid}')
                self.assertEqual(status, 200, live)
                row = next(row for row in live['rows'] if row['id'] == sid)
                self.assertEqual((row['status'], row['lab13']), ('done', result))
                self.assertFalse(self.db.q('SELECT lab FROM students WHERE id=?', (sid,), one=True)['lab'])
                self.assertFalse(self.db.q('SELECT 1 FROM attempts WHERE student_id=?', (sid,), one=True))

    def test_retry_and_simultaneous_requests_only_create_one_assignment_and_forecast(self):
        key = secrets.token_hex(16)
        aid, duplicate_id = simultaneous(lambda request_id: self.assign(request_id=request_id), [key, key])
        self.assertEqual(aid, duplicate_id)
        payload = {'class_id': self.cid, 'request_id': key, 'due': int(time.time()) + 600}
        self.assertEqual(self.request('POST', 'assignment/lab13', payload)[0], 409)
        self.assertEqual(sum(item['kind'] == 'lab13' for item in self.listed(self.session(self.sid)).values()), 1)
        tokens = [self.session(self.sid), self.session(self.sid)]
        starts = simultaneous(lambda token: self.lab(token, 'start', aid), tokens)
        self.assertEqual(starts[0][0], 200, starts)
        self.assertEqual(starts[0], starts[1])
        expected = IPv4Network((starts[0][1]['ip'], starts[0][1]['prefix']), strict=False).num_addresses
        options = (expected, expected - 2)
        answers = simultaneous(lambda i: self.lab(tokens[i], 'answer', aid, prediction=options[i]), (0, 1))
        self.assertEqual(answers[0][0], 200, answers)
        self.assertEqual(answers[0], answers[1])
        winner = answers[0][1]
        self.assertIn(winner['prediction'], options)
        self.assertIs(winner['correct'], winner['prediction'] == expected)
        self.assertEqual(self.cells(aid)[self.sid]['lab13'], winner)
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM asg_runs WHERE asg_id=? AND student_id=?',
                                  (aid, self.sid), one=True)['n'], 1)

    def test_foreign_class_and_generic_assignments_stay_separate(self):
        aid = self.assign()
        payload = {'class_id': self.cid, 'request_id': secrets.token_hex(16)}
        self.assertEqual(self.request('POST', 'assignment/lab13', payload, cookie=self.other_cookie)[0], 404)
        self.assertEqual(self.request('GET', f'asg/live?id={aid}', cookie=self.other_cookie)[0], 404)
        self.assertEqual(self.request('GET', f'class/journal?class_id={self.cid}', cookie=self.other_cookie)[0], 404)
        foreign = self.session(self.other_sid)
        self.assertNotIn(aid, self.listed(foreign))
        local = self.session(self.sid)
        for action, args in (('start', {}), ('answer', {'prediction': 16})):
            self.assertEqual(self.lab(foreign, action, aid, **args)[0], 404)
            self.assertEqual(self.lab(None, action, aid, **args)[0], 401)
            self.assertEqual(self.lab(local, action, self.aid, **args)[0], 404)
        self.assertEqual(self.client.req('POST', '/api/asg/start', {'id': aid}, local)[0], 404)
        self.assertEqual(self.client.req('POST', '/api/asg/start', {'id': self.aid}, local)[0], 200)
        edit = {'id': aid, 'class_id': self.cid, 'title': 'Обычная работа', 'kind': 'self', 'tasks': ['b:5']}
        self.assertEqual(self.request('POST', 'assignment/save', edit)[0], 409)
        self.assertEqual(self.listed(local)[aid]['kind'], 'lab13')
        self.assertFalse(self.db.q('SELECT 1 FROM asg_runs WHERE asg_id=?', (aid,), one=True))

    def test_invalid_forecast_and_manual_close_do_not_grade_unfinished_pupil(self):
        aid = self.assign()
        token = self.session(self.sid)
        status, started = self.lab(token, 'start', aid)
        self.assertEqual(status, 200, started)
        for invalid in (None, True, -1, 3.5, 2 ** 32 + 1):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.lab(token, 'answer', aid, prediction=invalid)[0], 400)
        self.assertEqual(self.request('POST', 'asg/close', {'id': aid})[0], 200)
        self.assertEqual(self.lab(token, 'answer', aid, prediction=0)[0], 409)
        cell = self.cells(aid)[self.sid]
        self.assertEqual(cell['st'], 'miss')
        self.assertIsNone(cell['lab13']['prediction'])
        self.assertIsNone(cell['lab13']['finished'])
        self.assertEqual(self.request('POST', 'asg/close', {'id': aid, 'reopen': True})[0], 200)
        status, result = self.lab(token, 'answer', aid, prediction=0)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['started'], started['started'])
        self.assertEqual(result['prediction'], 0)

    def test_deadline_blocks_new_forecasts_and_keeps_submitted_result(self):
        aid = self.assign(due=int(time.time()) + 600)
        token = self.session(self.sid)
        self.assertEqual(self.lab(token, 'start', aid)[0], 200)
        with self.failed_commit():
            self.assertEqual(self.lab(token, 'answer', aid, prediction=16)[0], 500)
        self.assertIsNone(self.listed(token)[aid]['lab13']['finished'])
        status, result = self.lab(token, 'answer', aid, prediction=16)
        self.assertEqual(status, 200, result)
        unfinished = self.session(self.pupil(self.tid, self.cid))
        untouched = self.session(self.pupil(self.tid, self.cid))
        self.assertEqual(self.lab(unfinished, 'start', aid)[0], 200)
        self.db.x('UPDATE assignments SET due=? WHERE id=?', (time.time() - 1, aid))
        self.assertEqual(self.lab(untouched, 'start', aid)[0], 409)
        self.assertEqual(self.lab(unfinished, 'answer', aid, prediction=16)[0], 409)
        status, replay = self.lab(token, 'answer', aid, prediction=1)
        self.assertEqual(status, 200, replay)
        for field in ('prediction', 'expected', 'correct', 'finished'):
            self.assertEqual(replay[field], result[field])
        cells = self.cells(aid)
        self.assertEqual(cells[self.sid]['lab13']['finished'], result['finished'])
        for sid, cell in cells.items():
            if sid != self.sid:
                self.assertEqual(cell['st'], 'miss')
                self.assertIsNone(cell['lab13']['finished'])
