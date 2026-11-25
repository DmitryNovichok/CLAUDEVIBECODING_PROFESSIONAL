"""End-to-end regressions from the 2.23 audit. Synthetic accounts and databases only."""
import contextlib
import io
import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import server
import together
import test_server as fixtures


class AuditRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            fixtures.ServerTest.setUpClass()
        cls.c = fixtures.ServerTest()
        cls.old_hub = server.TOG
        server.TOG = together.Hub(server.tog_load, server.tog_save, server.tog_task,
                                 server.tog_check, server.tog_name, server.tog_credit, access=server.tog_access)
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        server.TOG.close()
        server.TOG = cls.old_hub
        fixtures.ServerTest.tearDownClass()

    def setUp(self):
        self.c.setUp()
        self.db = server.APP.db
        self.token, self.sid = self.student()

    def student(self):
        type(self).serial += 1
        token = self.c.login('Макетов Тест' + chr(0x410 + self.serial // 32) + chr(0x410 + self.serial % 32))
        return token, self.c.req('GET', '/api/me', token=token)[1]['sid']

    def post(self, path, body, token=None):
        status, result = self.c.req('POST', path, body, token or self.token)
        self.assertEqual(status, 200, result)
        return result

    def work(self, kind='self', tasks=None, personal=False):
        cid = self.c.admin('POST', '/api/admin/class/save', {'name': 'Демо проверка'})[1]['id']
        self.c.admin('POST', '/api/admin/class/members', {'class_id': cid, 'students': [self.sid]})
        data = {'class_id': cid, 'title': 'Тестовая работа', 'kind': kind, 'tasks': tasks or ['b:5', 'b:6']}
        if personal:
            data['students'] = [self.sid]
        status, result = self.c.admin('POST', '/api/admin/assignment/save', data)
        self.assertEqual(status, 200, result)
        aid = result.get('id') or self.db.q('SELECT MAX(id) id FROM assignments WHERE class_id=?', (cid,), one=True)['id']
        return cid, aid

    def score(self, aid):
        return next(x for x in self.c.req('GET', '/api/assignments', token=self.token)[1]['assignments'] if x['id'] == aid)

    def archive(self, aid):
        status, page, _ = self.c.creq('GET', '/api/admin/asg/archive?id=' + str(aid), cookie='egeadm=admtest')
        self.assertEqual(status, 200)
        return page.decode() if isinstance(page, bytes) else page

    def race(self, query, calls):
        # Old code released SQLite's lock after its initial read. Force that overlap;
        # fixed transactions serialize it, so the first reader times out this test barrier.
        original = self.db.q
        barrier = threading.Barrier(2)
        def read(sql, args=(), one=False):
            result = original(sql, args, one)
            if sql == query:
                try:
                    barrier.wait(timeout=0.2)
                except threading.BrokenBarrierError:
                    pass
            return result
        with mock.patch.object(self.db, 'q', side_effect=read), ThreadPoolExecutor(2) as pool:
            return list(pool.map(lambda call: call(), calls))

    def test_concurrent_answers_are_both_saved(self):
        _, aid = self.work()
        self.post('/api/asg/start', {'id': aid})
        calls = [lambda task=t, answer=a: self.c.req('POST', '/api/asg/answer',
                  {'id': aid, 'task': server.APP.bank.pid(task), 'answer': answer}, self.token)
                 for t, a in [('b:5', '12'), ('b:6', '7')]]
        results = self.race('SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?', calls)
        self.assertEqual([r[0] for r in results], [200, 200])
        state = self.c.req('GET', f'/api/asg/state?id={aid}', token=self.token)[1]
        self.assertEqual(len(state['mine']), 2)
        result = self.post('/api/asg/finish', {'id': aid})
        self.assertEqual(result['result']['ok'], 2)

    def test_closed_practice_score_and_progress_do_not_change(self):
        _, aid = self.work(kind='practice')
        self.post('/api/open', {'task': server.APP.bank.pid('b:5')})
        self.c.check(self.token, server.APP.bank.pid('b:5'), answer='12', reason='asg')
        self.c.admin('POST', '/api/admin/asg/close', {'id': aid})
        before = self.score(aid)
        self.post('/api/open', {'task': server.APP.bank.pid('b:6')})
        self.c.check(self.token, server.APP.bank.pid('b:6'), answer='7')
        after = self.score(aid)
        self.assertTrue(before['score']['final'])
        self.assertEqual(after['score'], before['score'])
        self.assertEqual(after['done'], before['done'])
        self.assertIn('Результат: 1 / 2 баллов', self.archive(aid))

    def test_past_due_practice_ignores_later_attempts(self):
        _, aid = self.work(kind='practice')
        now = time.time()
        self.db.x('UPDATE assignments SET created=?, due=? WHERE id=?', (now-100, now-10, aid))
        self.db.x("INSERT INTO attempts(student_id,ts,task_id,score) VALUES(?,?,'b:5',1)", (self.sid, now-50))
        self.db.x("INSERT INTO attempts(student_id,ts,task_id,score) VALUES(?,?,'b:6',1)", (self.sid, now))
        self.assertEqual(self.score(aid)['score']['tried'], 1)

    def test_archive_and_review_keep_submitted_program(self):
        _, aid = self.work(tasks=['b:5'])
        self.post('/api/asg/start', {'id': aid})
        self.post('/api/solution', {'task': server.APP.bank.pid('b:5'), 'code': 'print("submitted-test")'})
        self.post('/api/asg/answer', {'id': aid, 'task': server.APP.bank.pid('b:5'), 'answer': '12'})
        self.post('/api/asg/finish', {'id': aid})
        self.c.admin('POST', '/api/admin/asg/close', {'id': aid})
        self.post('/api/solution', {'task': server.APP.bank.pid('b:5'), 'code': 'print("later-test")'})
        self.post('/api/solution', {'task': server.APP.bank.pid('b:5'), 'code': ''})
        review = self.c.req('GET', f'/api/asg/review?id={aid}', token=self.token)[1]
        self.assertEqual(review['items'][0]['code'], 'print("submitted-test")')
        page = self.archive(aid)
        self.assertIn('submitted-test', page)
        self.assertNotIn('later-test', page)

    def test_personal_review_does_not_wait_for_other_students(self):
        cid, aid = self.work(tasks=['b:5'], personal=True)
        token2, sid2 = self.student()
        self.c.admin('POST', '/api/admin/class/members', {'class_id': cid, 'students': [self.sid, sid2]})
        self.post('/api/asg/start', {'id': aid})
        self.post('/api/asg/answer', {'id': aid, 'task': server.APP.bank.pid('b:5'), 'answer': '12'})
        self.post('/api/asg/finish', {'id': aid})
        review = self.c.req('GET', f'/api/asg/review?id={aid}', token=self.token)[1]
        self.assertNotIn('locked', review)
        self.assertEqual(self.c.req('POST', '/api/asg/start', {'id': aid}, token2)[0], 404)

    def test_exam_deadline_uses_only_timely_saved_answers(self):
        eid = self.post('/api/exam/start', {})['exam_id']
        answers = [{'task': server.APP.bank.pid('b:5'), 'answer': '12'}]
        self.post('/api/exam/save', {'exam_id': eid, 'rev': 2, 'answers': answers})
        # A delayed older autosave must not replace the newer one.
        self.post('/api/exam/save', {'exam_id': eid, 'rev': 1, 'answers': []})
        self.db.x('UPDATE exams SET started=? WHERE id=?', (time.time()-server.EXAM_LIMIT_SEC-3600, eid))
        self.assertTrue(self.post('/api/exam/save', {'exam_id': eid, 'rev': 3, 'answers': []})['expired'])
        result = self.post('/api/exam/finish', {'exam_id': eid, 'answers': [
            {'task': server.APP.bank.pid('b:5'), 'answer': '0'}, {'task': server.APP.bank.pid('b:6'), 'answer': '7'}]})
        self.assertEqual(result['primary'], 1)
        self.assertEqual(result['spent'], server.EXAM_LIMIT_SEC)
        self.assertEqual(next(r for r in result['results'] if r['n'] == 5)['mine'], '12')
        self.assertTrue(next(r for r in result['results'] if r['n'] == 6)['blank'])

    def test_upgrade_keeps_already_running_legacy_exam_submittable(self):
        eid = self.post('/api/exam/start', {})['exam_id']
        self.db.x('UPDATE exams SET save_protocol=0, started=? WHERE id=?', (time.time()-server.EXAM_LIMIT_SEC-10,eid))
        result = self.post('/api/exam/finish', {'exam_id': eid, 'answers': [{'task': server.APP.bank.pid('b:5'), 'answer': '12'}]})
        self.assertEqual(result['primary'], 1)
        self.assertFalse(result['expired'])

    def test_concurrent_exam_finish_logs_once(self):
        eid = self.post('/api/exam/start', {})['exam_id']
        body = {'exam_id': eid, 'answers': [{'task': server.APP.bank.pid('b:5'), 'answer': '12'}]}
        call = lambda: self.c.req('POST', '/api/exam/finish', body, self.token)
        results = self.race('SELECT * FROM exams WHERE id=? AND student_id=?', [call, call])
        self.assertEqual([r[0] for r in results], [200, 200])
        self.assertEqual([r[1]['primary'] for r in results], [1, 1])
        self.assertEqual(self.db.q('SELECT COUNT(*) n FROM attempts WHERE exam=?', (eid,), one=True)['n'], 1)

    def test_matching_retry_returns_same_duel_for_both_sides(self):
        self.db.x('DELETE FROM duel_queue')
        token2, _ = self.student()
        self.post('/api/duel/find', {})
        matched = self.post('/api/duel/find', {}, token2)['matched']
        self.assertEqual(self.post('/api/duel/find', {})['matched'], matched)
        self.assertEqual(self.post('/api/duel/find', {}, token2)['matched'], matched)
        self.assertFalse(self.db.q('SELECT 1 FROM duel_queue WHERE student_id=?', (self.sid,)))

    def guest(self):
        return self.c.legacy_guest()

    def legacy_lesson(self, tid):
        # Reconstruct an old guest lesson; new guest access is intentionally closed.
        pupils = [r['id'] for r in self.db.q('SELECT id FROM students WHERE teacher_id=? LIMIT 1', (tid,))]
        state = {'mode':'both', 'cur':'p1', 'follow':True, 'pages':{'p1':{'task':None}}}
        now = time.time()
        return self.db.x('INSERT INTO together(teacher_id,students,created,updated,state) VALUES(?,?,?,?,?)',
                         (tid, json.dumps(pupils), now, now, json.dumps(state)))

    def test_demo_rename_and_conversion_keep_real_work(self):
        me, cookie = self.guest()
        tid = me['id']
        demo = self.db.q('SELECT id FROM classes WHERE teacher_id=? AND is_demo=1', (tid,), one=True)['id']
        self.db.x('UPDATE classes SET name=? WHERE id=?', ('Переименованный пример', demo))
        cid = self.db.x('INSERT INTO classes(name,created,teacher_id) VALUES(?,?,?)', (server.DEMO_CLASS, time.time(), tid))
        aid = self.db.x('INSERT INTO assignments(class_id,title,kind,tasks,created) VALUES(?,?,?,?,?)',
                        (cid, 'Моя работа', 'practice', '["b:5"]', time.time()))
        self.assertTrue(server.teacher_steps(self.db, tid)['class'])
        status, result, _ = self.c.creq('POST', '/api/teacher/signup',
            {'name': 'Макетов Учитель', 'email': f'mock{tid}@example.test', 'password': 'synthetic-pass', 'accept': True}, cookie=cookie)
        self.assertEqual(status, 200, result)
        self.assertIsNone(self.db.q('SELECT 1 FROM classes WHERE id=?', (demo,), one=True))
        self.assertIsNotNone(self.db.q('SELECT 1 FROM classes WHERE id=?', (cid,), one=True))
        self.assertIsNotNone(self.db.q('SELECT 1 FROM assignments WHERE id=?', (aid,), one=True))

    def test_guest_purge_removes_lesson_and_cached_connections(self):
        me, cookie = self.guest()
        sid = self.legacy_lesson(me['id'])
        session = server.TOG.get(sid)
        session.pages['p1'].code = 'print("private-demo-code")'
        session.dirty = True
        self.db.x('UPDATE teachers SET until=? WHERE id=?', (time.time()-server.GUEST_KEEP_SECONDS-5, me['id']))
        server.purge_guests(self.db)
        self.assertIsNone(self.db.q('SELECT 1 FROM together WHERE id=?', (sid,), one=True))
        self.assertIsNone(server.TOG.get(sid))
        new, cookie2 = self.guest()
        self.assertEqual(self.c.creq('GET', '/api/admin/together/list', cookie=cookie2)[0], 403)
        self.assertIsNone(server.tog_access(session, ('t', new['id'])))
        # A stale saver cannot write into a newly reused lesson ID.
        new_sid = self.legacy_lesson(new['id'])
        server.tog_save(sid, session.dump())
        row = self.db.q('SELECT state FROM together WHERE id=?', (new_sid,), one=True)
        self.assertNotIn('private-demo-code', row['state'] or '')

    def test_demo_does_not_change_economy_population(self):
        before = server.econ(self.db, fresh=True)['active']
        server._BTC_RATES['tick'] = 0
        active_before = server.btc_rate_now(self.db)[1]
        me, _ = self.guest()
        demo = self.db.q('SELECT id FROM students WHERE teacher_id=? LIMIT 1', (me['id'],), one=True)['id']
        self.db.x("INSERT INTO attempts(student_id,ts,task_id,score) VALUES(?,?,'b:5',1)", (demo,time.time()))
        after = server.econ(self.db, fresh=True)['active']
        self.assertEqual(after, before)
        server._BTC_RATES['tick'] = 0
        self.assertEqual(server.btc_rate_now(self.db)[1], active_before)

    def test_failed_weekly_report_is_retried(self):
        main = server.main_teacher()['id']
        original = self.db.q('SELECT email,report_ts FROM teachers WHERE id=?', (main,), one=True)
        self.addCleanup(lambda: self.db.x('UPDATE teachers SET email=?,report_ts=? WHERE id=?', (*original, main)))
        self.db.x("UPDATE teachers SET email='mock@example.test', report_ts=NULL WHERE id=?", (main,))
        with mock.patch.object(server, 'smtp_conf', return_value={'mock': True}), \
             mock.patch.object(server, 'report_due_since', return_value=time.time()-100), \
             mock.patch.object(server, 'weekly_report', return_value=('Subject', '<p>test</p>', 'test')), \
             mock.patch.object(server, 'send_mail', side_effect=[OSError('synthetic failure'), True]) as send:
            # Other synthetic teachers must not be eligible for this test.
            self.db.x('UPDATE teachers SET report=0 WHERE id<>?', (main,))
            self.db.x('UPDATE teachers SET report=1 WHERE id=?', (main,))
            self.assertEqual(server.report_tick(self.db, 'https://egeshka.test'), 0)
            self.assertIsNone(self.db.q('SELECT report_ts FROM teachers WHERE id=?', (main,), one=True)['report_ts'])
            self.assertEqual(server.report_tick(self.db, 'https://egeshka.test'), 1)
            self.assertEqual(server.report_tick(self.db, 'https://egeshka.test'), 0)
            self.assertEqual(send.call_count, 2)

    def test_failed_parent_report_is_retried(self):
        self.db.x("UPDATE students SET parent_email='mock-parent@example.test' WHERE id=?", (self.sid,))
        with mock.patch.object(server, 'smtp_conf', return_value={'mock': True}), \
             mock.patch.object(server, 'report_due_since', return_value=time.time()-100), \
             mock.patch.object(server, 'send_mail', side_effect=[OSError('synthetic failure'), True]) as send:
            self.assertEqual(server.parent_tick(self.db, 'https://egeshka.test'), 0)
            self.assertIsNone(self.db.q('SELECT parent_report_ts FROM students WHERE id=?', (self.sid,), one=True)['parent_report_ts'])
            self.assertEqual(server.parent_tick(self.db, 'https://egeshka.test'), 1)
            self.assertEqual(server.parent_tick(self.db, 'https://egeshka.test'), 0)
            self.assertEqual(send.call_count, 2)

    def test_expired_teacher_cannot_edit_existing_connection(self):
        me, cookie = self.guest()
        self.db.x('UPDATE teachers SET guest=0 WHERE id=?', (me['id'],))
        self.c.approve_fixture_teacher(me['id'])
        status, lesson, _ = self.c.creq('POST', '/api/admin/together/new', {'students': [self.db.q('SELECT id FROM students WHERE teacher_id=? LIMIT 1', (me['id'],), one=True)['id']]}, cookie=cookie)
        self.assertEqual(status, 200)
        session = server.TOG.get(lesson['id'])
        conn = mock.Mock(who=('t', me['id']), cid='test')
        conn.name = 'Учитель Демо'
        server.TOG.handle(session, conn, {'t': 'ans', 'v': 'before'})
        self.assertEqual(session.pages['p1'].ans, 'before')
        self.db.x('UPDATE teachers SET until=? WHERE id=?', (time.time()-1, me['id']))
        server.TOG.handle(session, conn, {'t': 'ans', 'v': 'after'})
        self.assertEqual(session.pages['p1'].ans, 'before')
        self.assertEqual(conn.send.call_args[0][0]['t'], 'expired')
        # Reconnect remains read-only, too.
        self.assertIs(server.tog_access(session, ('t', me['id'])), False)

    def test_deleted_student_loses_sessions_and_lesson_membership(self):
        lesson = self.c.admin('POST', '/api/admin/together/new', {'students': [self.sid], 'task': 'b:5'})[1]['id']
        server.delete_student(self.db, self.sid)
        self.assertFalse(self.db.q('SELECT 1 FROM student_sessions WHERE student_id=?', (self.sid,)))
        members = json.loads(self.db.q('SELECT students FROM together WHERE id=?', (lesson,), one=True)['students'])
        self.assertNotIn(self.sid, members)

    def test_together_half_then_full_and_failed_save_retry(self):
        lesson = self.c.admin('POST', '/api/admin/together/new', {'students': [self.sid], 'task': 'b:27'})[1]['id']
        sock, rf, status = self.c.ws(lesson, token=self.token)
        self.addCleanup(sock.close)
        self.addCleanup(rf.close)
        self.assertIn('101', status)
        self.c.recv(rf, 'snap')
        self.c.send(sock, {'t': 'chk', 'v': '10 21'})
        self.assertTrue(self.c.recv(rf, 'res')['half'])
        # Saving failure doesn't consume the right to submit a corrected answer.
        with mock.patch.object(server.TOG, 'credit_fn', side_effect=OSError('synthetic failure')):
            self.c.send(sock, {'t': 'chk', 'v': '10 20'})
            self.assertTrue(self.c.recv(rf, 'res')['save_failed'])
        self.c.send(sock, {'t': 'chk', 'v': '10 20'})
        self.assertTrue(self.c.recv(rf, 'res')['ok'])
        self.c.send(sock, {'t': 'chk', 'v': '10 20'})
        self.c.recv(rf, 'res')
        rows = self.db.q("SELECT score FROM attempts WHERE student_id=? AND reason='tog' ORDER BY id", (self.sid,))
        self.assertEqual([r['score'] for r in rows], [0.5, 1])

    def test_auction_reserves_slots_and_refunds_old_excess_bid(self):
        seller_token, seller = self.student()
        cap = self.db.q("SELECT cap FROM gift_supply WHERE gift='telescope'", one=True)
        self.addCleanup(lambda: self.db.x("UPDATE gift_supply SET cap=? WHERE gift='telescope'", (cap['cap'] if cap else 100,)))
        self.db.x("INSERT INTO gift_supply(gift,cap) VALUES('telescope',10) ON CONFLICT(gift) DO UPDATE SET cap=10")
        server._SUPPLY['t'] = 0
        for sid in (self.sid, seller):
            self.db.x("INSERT INTO coins(student_id,ts,delta,reason) VALUES(?,?,100000,'grant')", (sid, time.time()))
        self.post('/api/gifts/buy', {'gift': 'telescope'})
        for _ in range(2):
            self.post('/api/gifts/buy', {'gift': 'telescope'}, seller_token)
        gifts = self.db.q("SELECT id FROM gifts WHERE student_id=? AND gift='telescope'", (seller,))
        amounts = [self.post('/api/gifts/list', {'id': g['id']}, seller_token)['start'] for g in gifts]
        self.post('/api/gifts/bid', {'id': gifts[0]['id'], 'amount': amounts[0]})
        self.assertEqual(self.c.req('POST', '/api/gifts/bid', {'id': gifts[1]['id'], 'amount': amounts[1]}, self.token)[0], 409)
        self.assertEqual(self.c.req('POST', '/api/gifts/buy', {'gift': 'telescope'}, self.token)[0], 409)
        # Simulate a bid accepted by the old release. Closing both must not exceed the cap.
        old_id, amount = gifts[1]['id'], amounts[1]
        reserved = amount + server.buy_fee(amount)
        self.db.x('UPDATE gifts SET bid_sid=?,bid_amt=? WHERE id=?', (self.sid, amount, old_id))
        self.db.x("INSERT INTO coins(student_id,ts,delta,reason,gift_id) VALUES(?,?,?,'bid',?)", (self.sid,time.time(),-reserved,old_id))
        self.db.x('UPDATE gifts SET auc_end=? WHERE id IN (?,?)', (time.time()-1,gifts[0]['id'],old_id))
        server.market_expire(self.db)
        self.assertEqual(server.own_count(self.db, self.sid, 'telescope'), 2)
        self.assertEqual(self.db.q("SELECT delta FROM coins WHERE gift_id=? AND reason='bidback'", (old_id,), one=True)['delta'], reserved)
        self.assertEqual(self.db.q('SELECT student_id FROM gifts WHERE id=?', (old_id,), one=True)['student_id'], seller)
        server.market_expire(self.db)
        self.assertEqual(len(self.db.q("SELECT 1 FROM coins WHERE gift_id=? AND reason='bidback'", (old_id,))), 1)


    def test_weekly_prizes_share_the_available_bank_and_rollback_together(self):
        db, now = self.db, time.time()
        _, second = self.student()
        teacher = server.main_teacher()["id"]
        ranked = [(20, {"id":81001, "name":"Первый"}, [self.sid]), (10, {"id":81002, "name":"Второй"}, [second])]
        with db.transaction():
            db.setting("class_week", "test-market-week")
            server.bank_move(db, 90 - server.bank_balance(db), "test", ts=now)
            with mock.patch.object(server, "class_week_xp", side_effect=lambda db, tid, *args: ranked if tid == teacher else []):
                with mock.patch.object(server, "bank_move", side_effect=RuntimeError("temporary storage failure")):
                    with self.assertRaises(RuntimeError):
                        server.class_rollover(db)
                self.assertEqual(db.setting("class_week"), "test-market-week")
                self.assertEqual(server.bank_balance(db), 90)
                server.class_rollover(db)
                server.class_rollover(db)
            awards = db.q("SELECT each_btc FROM class_prizes WHERE week='test-market-week' ORDER BY place")
            self.assertEqual([r[0] for r in awards], [60,30])
            self.assertEqual(server.bank_balance(db), 0)
            server.bank_move(db, server.BANK_START, "test", ts=now)

    def test_shop_receipt_and_confirmed_price(self):
        self.db.x("INSERT INTO coins(student_id,ts,delta,reason) VALUES(?,?,1000,'grant')", (self.sid, time.time()))
        def wallet():
            return self.c.req("GET", "/api/gifts", token=self.token)[1]
        start = wallet()
        price = next(x["price"] for x in start["catalog"] if x["id"] == "tea")
        order = {"gift": "tea", "price": price, "request_key": "receipt-for-this-purchase"}
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: self.post("/api/gifts/buy", order), range(2)))
        self.assertEqual([r["got"] for r in results], ["tea", "tea"])
        self.assertEqual(wallet()["coins"], start["coins"] - price)
        self.assertEqual(len(wallet()["mine"]), 1)
        self.assertEqual(self.c.req("POST", "/api/gifts/buy", dict(order, gift="cookie"), self.token)[0], 409)
        new_order = dict(order, price=price+100, request_key="another-ordinary-purchase")
        self.assertEqual(self.c.req("POST", "/api/gifts/buy", new_order, self.token)[0], 409)
        item = wallet()["mine"][0]
        self.assertEqual(self.c.req("POST", "/api/gifts/upgrade", {"id":item["id"], "price":item["up"]+1}, self.token)[0], 409)
        self.assertEqual(wallet()["coins"], start["coins"] - price)

    def test_empty_random_pool_preserves_balance_and_work_entitlement(self):
        self.db.x("INSERT INTO coins(student_id,ts,delta,reason) VALUES(?,?,1000,'grant')", (self.sid, time.time()))
        before = server.game_summary(self.db, self.sid)["coins"]
        supply = {g: dict(v, left=0) for g, v in server.gift_supply(self.db).items()}
        with mock.patch.object(server, "gift_supply", return_value=supply):
            self.assertIsNone(server.gift_random(db=self.db, recipient=self.sid))
            self.assertEqual(self.c.req("POST", "/api/gifts/buy", {"gift":"box"}, self.token)[0], 409)
            self.assertEqual(server.work_gifts(self.db, self.sid, server.WORK_GIFT_EVERY), 0)
        self.assertEqual(server.game_summary(self.db, self.sid)["coins"], before)
        self.assertEqual(server.work_gifts(self.db, self.sid, server.WORK_GIFT_EVERY), 1)
        self.assertEqual(server.work_gifts(self.db, self.sid, server.WORK_GIFT_EVERY), 0)

    def test_closed_transfers_do_not_set_a_new_quote(self):
        key = "rocket:legend"
        for n in range(6):
            self.db.x("""INSERT INTO market_deals(gift_id,ts,gift,mkey,seller,buyer,price)
                         VALUES(?,?,?,?,?,?,?)""", (10000+n, time.time(), "rocket", key, 20000+n, 20000+(n+1)%6, 1000))
        server.invalidate_economy()
        mv = server.market_vals(self.db)
        self.assertEqual(mv["qualified"][key], 0)
        self.assertNotIn(key, mv["prices"])

    def test_old_student_number_and_escrow_are_not_reassigned(self):
        other, holder = self.student()
        gift = self.db.x("INSERT INTO gifts(student_id,gift,ts,listed,listed_ts,bid_sid,bid_amt) VALUES(?, 'tea',?,10,?,?,10)",
                         (holder,time.time(),time.time()-60,self.sid))
        self.db.x("INSERT INTO coins(student_id,ts,delta,reason,gift_id) VALUES(?,?,-11,'bid',?)", (self.sid,time.time(),gift))
        server.delete_student(self.db, holder)
        _, replacement = self.student()
        self.assertGreater(replacement, holder)
        self.assertEqual([r["delta"] for r in self.db.q("SELECT delta FROM coins WHERE gift_id=? AND reason='bidback'", (gift,))], [11])
        item = self.db.q("SELECT sold,listed FROM gifts WHERE id=?", (gift,), one=True)
        self.assertTrue(item["sold"])
        self.assertIsNone(item["listed"])


class AuditMigrationTest(unittest.TestCase):
    def test_existing_gift_keeps_its_original_funding_after_upgrade(self):
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'market.db'
            db = server.DB(path)
            now = time.time()
            item = db.x("INSERT INTO gifts(student_id,gift,ts,paid,market_from) VALUES(1,'tea',?,180,2)", (now,))
            server.glog(db, 'issue', item, 'tea', 2, 40, 'box', now)
            server.glog(db, 'upgrade', item, 'tea', 2, 70, ts=now)
            db.x("ALTER TABLE gifts DROP COLUMN redeem_basis")
            db.conn.close()
            for _ in range(2):
                db = server.DB(path)
                try:
                    row = db.q("SELECT paid,redeem_basis FROM gifts WHERE id=?", (item,), one=True)
                    self.assertEqual(tuple(row), (180, 110))
                    self.assertEqual(db.q("SELECT COUNT(*) FROM coins", one=True)[0], 0)
                finally:
                    db.conn.close()

    def test_legacy_demo_identity_survives_rename_and_membership_changes(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'synthetic.db'
            db = server.DB(path)
            now = time.time()
            tid = db.x("INSERT INTO teachers(name,login,invite,created,guest) VALUES('Учитель Демо','migration','MIGRATION',?,1)", (now,))
            demo = db.x("INSERT INTO classes(name,created,teacher_id) VALUES('Переименован',?,?)", (now-40*86400,tid))
            real = db.x("INSERT INTO classes(name,created,teacher_id) VALUES(?,?,?)", (server.DEMO_CLASS,now,tid))
            db.x("INSERT INTO students(name,name_key,token,class_id,teacher_id) VALUES('Макетов Демо',?,'synthetic',?,?)", (f'demo:{tid}:0',real,tid))
            db.x("DELETE FROM settings WHERE key='demo_identity_seeded'")
            db.conn.close()
            db = server.DB(path)
            try:
                server.drop_demo(db, tid)
                self.assertIsNone(db.q('SELECT 1 FROM classes WHERE id=?', (demo,), one=True))
                self.assertIsNotNone(db.q('SELECT 1 FROM classes WHERE id=?', (real,), one=True))
            finally:
                db.conn.close()

    def test_existing_solution_is_migrated_once(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'synthetic.db'
            db = server.DB(path)
            db.x("INSERT INTO solutions(student_id,task_id,code,ts) VALUES(1,'synthetic','print(42)',100)")
            db.x("DELETE FROM settings WHERE key='solution_history_seeded'")
            db.conn.close()
            for _ in range(2):
                db = server.DB(path)
                try:
                    rows = db.q('SELECT code,ts FROM solution_history')
                    self.assertEqual(len(rows), 1)
                    self.assertEqual((rows[0]['code'],rows[0]['ts']), ('print(42)',100))
                finally:
                    db.conn.close()
