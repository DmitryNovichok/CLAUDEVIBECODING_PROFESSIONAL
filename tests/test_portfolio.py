"""Регрессии оценки коллекций на небольшом рынке Egeshka."""
import json
from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import server
from tools.portfolio_revaluation import check_snapshot


class PortfolioTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "trainer.db"
        self.db = server.DB(self.path)
        self.addCleanup(self.db.conn.close)
        self.now = time.time()
        with self.db.conn as c:
            c.executemany("INSERT INTO students(id,name,name_key,token) VALUES(?,?,?,?)",
                          ((n, str(n), str(n), str(n)) for n in range(1, 71)))

    def sale(self, gid, seller, buyer, price, instance):
        self.db.x("""INSERT INTO market_deals(gift_id,ts,gift,mkey,tier,price,ref,seller,buyer)
                  VALUES(?,?,?,?,?,?,?,?,?)""",
                  (instance, self.now, gid, gid, server.market_tier(gid, None), price,
                   server.portfolio_nominal(gid), seller, buyer))
        server.invalidate_economy()

    def guide(self, gid):
        return server.market_guide(gid, None, server.market_vals(self.db))

    def redeem(self, sid, gid="dragon", days=0):
        ts = self.now - days * 86400
        instance = self.db.x("INSERT INTO gifts(student_id,gift,ts,sold) VALUES(?,?,?,?)", (sid, gid, ts - 1000, ts))
        server.glog(self.db, "sell", instance, gid, sid, 93, ts=ts)

    def test_small_market_up_down_and_independence(self):
        for price, one, two, three in ((1200, 793, 847, 962), (300, 747, 693, 578)):
            with self.subTest(price=price):
                for table in ("gift_quote_history", "market_deals"):
                    self.db.x("DELETE FROM " + table)
                server.invalidate_economy()
                self.assertEqual(self.guide("dragon"), 770)
                self.sale("dragon", 1, 2, price, 101)
                self.sale("dragon", 1, 3, price, 102)
                self.assertEqual(self.guide("dragon"), one)
                self.sale("dragon", 4, 5, price, 103)
                mv = server.market_vals(self.db)
                self.assertEqual((self.guide("dragon"), server.portfolio_estimate("dragon", None, 770, mv)), (two, two))
                self.assertEqual(server.gift_sell_price("dragon", None, {"idx": 1}, {}, {}, 104, mv=mv,
                                                       acquired=self.now - 7 * 86400, basis=104), 93)
                self.assertEqual(self.guide("cat"), server.portfolio_nominal("cat"))
                self.sale("dragon", 6, 7, price, 104)
                self.assertEqual(self.guide("dragon"), three)
                self.assertEqual(self.db.q("SELECT COUNT(*) FROM gift_quote_history", one=True)[0], 1)
                for _ in range(3):
                    server.invalidate_economy()
                    self.assertEqual(self.guide("dragon"), three)

    def test_redemptions_and_broad_market(self):
        self.redeem(1, days=8)
        self.assertEqual(self.guide("dragon"), 770)
        self.redeem(1)
        self.redeem(1)
        self.assertEqual(self.guide("dragon"), 762)
        for owner in range(2, 10):
            self.redeem(owner)
        self.assertEqual(self.guide("dragon"), 732)
        self.assertEqual(self.guide("castle"), 1100)
        self.sale("robot", 10, 11, 600, 101)
        self.sale("cake", 10, 12, 200, 102)
        self.sale("guitar", 13, 14, 400, 103)
        self.assertEqual(server.market_vals(self.db)["index"]["pct"], 0)
        self.sale("cake", 15, 16, 200, 104)
        self.assertEqual(server.market_vals(self.db)["index"], {"kinds": 3, "pct": 3})
        self.assertEqual(self.guide("castle"), 1133)
        self.db.x("UPDATE market_deals SET price=1")
        server.invalidate_economy()
        self.assertEqual(self.guide("castle"), 1067)
        self.assertNotIn("castle", server.market_vals(self.db)["prices"])

    def test_read_only_revaluation_and_old_receipts(self):
        raw = json.dumps({"n": 1, "bg": "mint", "sym": "dot", "fx": "classic", "pose": "stand"})
        # Старое улучшение из коробки, подаренная покупка и уже улучшенный экземпляр со вторичного рынка.
        self.db.x("INSERT INTO gifts(id,gift,student_id,ts,uniq,kind,paid,redeem_basis) VALUES(1,'dragon',1,?,?,'box',4000,104)",
                  (self.now - 200, raw))
        self.db.x("INSERT INTO gifts(id,gift,student_id,from_sid,ts,paid) VALUES(2,'dragon',2,7,?,900)", (self.now,))
        self.db.x("""INSERT INTO gifts(id,gift,student_id,from_sid,ts,market_from,market_ts,uniq,paid)
                  VALUES(3,'dragon',3,7,?,7,?,?,15000)""", (self.now - 200, self.now, raw))
        for n, sid, t, why, source, amount in ((1, 1, -200, 'issue', 'box', 104), (1, 1, -100, 'upgrade', None, 3895),
                                              (2, 7, -100, 'issue', 'shop', 900), (3, 7, -200, 'issue', 'teacher', None),
                                              (3, 7, -100, 'upgrade', None, 1000)):
            server.glog(self.db, why, n, 'dragon', sid, amount, source, self.now + t)
            if why == 'upgrade':
                self.db.x("INSERT INTO coins(student_id,ts,delta,reason,gift_id) VALUES(?,?,?,'upgrade',?)", (sid, self.now + t, -amount, n))
        with self.db.conn as conn:
            conn.executemany("INSERT INTO gifts(student_id,gift,ts,kind) VALUES(?,'cookie',?,'work')",
                             ((sid, self.now) for sid in range(4, 71)))
        self.db.x("DELETE FROM settings WHERE key='gift_appraisal_107'")
        before = list(self.db.conn.iterdump())
        result = check_snapshot(self.path)
        self.assertEqual((len(result), sum(v[0] for v in result.values())), (70, 70))
        self.assertEqual(list(self.db.conn.iterdump()), before)
        self.assertEqual(check_snapshot(self.path), result)
        self.assertGreater(result[1][3], result[1][2])
        self.assertEqual(result[2][3], 900 - server.market_fee_amt(900, server.MARKET_FEE_SELL, 770))
        self.assertLess(result[3][3], 15000)
        server.restore_gift_appraisals(self.db.conn)
        server.restore_gift_appraisals(self.db.conn)
        self.assertEqual(self.db.q("SELECT upgrade_paid FROM gifts WHERE id=1", one=True)[0], 3895)
        self.assertIsNone(self.db.q("SELECT upgrade_paid FROM gifts WHERE id=3", one=True)[0])
        e, dem = {"idx": 1}, server.gift_demand(self.db)
        for sid in (1, 2, 3):
            rows = server.gift_rows(self.db, sid, prices=(e, {}, dem))
            self.assertEqual(server.gift_value(rows, e, dem)["worth"], result[sid][3])

    def test_history_preserves_both_models_on_update_day(self):
        with self.db.conn as conn:
            conn.execute("DROP TABLE forbes_hist")
            conn.execute("""CREATE TABLE forbes_hist(day TEXT,student_id INTEGER,total INTEGER,
                            PRIMARY KEY(day, student_id))""")
            conn.execute("INSERT INTO forbes_hist VALUES('2026-11-25',1,2345)")
        migrated = server.DB(self.path)
        try:
            migrated.x("INSERT OR REPLACE INTO forbes_hist VALUES('2026-11-25',1,1600,1)")
            self.assertEqual([tuple(r) for r in migrated.q("SELECT model,total FROM forbes_hist ORDER BY model")],
                             [(0, 2345), (1, 1600)])
        finally:
            migrated.conn.close()

    def dragon(self, sid, amount, book):
        raw = json.dumps({"n": sid, "bg": "mint", "sym": "dot", "fx": "classic", "pose": "stand"})
        gift = self.db.x("""INSERT INTO gifts(student_id,gift,ts,uniq,kind,paid,redeem_basis,upgrade_paid,appraisal_base)
            VALUES(?,'dragon',?,?,'box',104,104,?,?)""", (sid, self.now - 20 * 86400, raw, amount, book))
        server.glog(self.db, "upgrade", gift, "dragon", sid, amount, ts=self.now - 18 * 86400)
        return gift

    def reopen(self):
        self.db = server.DB(self.path)
        self.addCleanup(self.db.conn.close)
        server.invalidate_economy()

    def rare_sale(self, n, price, ts=None):
        self.db.x("""INSERT INTO market_deals(gift_id,ts,gift,mkey,price,seller,buyer)
            VALUES(?,?,'dragon','dragon:rare',?,?,?)""", (100+n, ts or self.now, price, n*2+5, n*2+6))
        server.invalidate_economy()

    def at_day(self, n):
        stamp = (datetime.fromtimestamp(self.now) + timedelta(days=n)).timestamp()
        clock = Mock(wraps=time)
        clock.time.return_value = stamp
        clock.strftime.side_effect = lambda fmt, t=None: time.strftime(fmt, time.localtime(stamp) if t is None else t)
        return patch.object(server, "time", clock)

    def gift_row(self, owner):
        return server.gift_rows(self.db, owner, prices=({"idx": 1}, {}, {}))[0]

    def test_legacy_transition_for_owner_only_from_first_confirmation(self):
        legacy = self.dragon(1, 3895, 4665)
        self.dragon(2, 385, 943)
        self.db.x("DELETE FROM settings WHERE key='gift_appraisal_108'")
        self.reopen()
        self.assertEqual(self.gift_row(1)["worth"], 3869)
        for n in (1, 2):
            self.rare_sale(n, 943)
            self.assertNotIn("appraisal_transition", self.gift_row(1))
        self.rare_sale(3, 943)
        for elapsed, worth in ((0, 3869), (7, 2394), (14, 919), (32, 919)):
            with self.subTest(elapsed=elapsed), self.at_day(elapsed):
                self.reopen()
                row = self.gift_row(1)
                self.assertEqual((row["guide"], row["mk_typ"], row["worth"]), (943, 943, worth))
                self.assertEqual(row.get("appraisal_transition"),
                                 {"days": 14-elapsed, "market_net": 919} if elapsed < 14 else None)
                modern = self.gift_row(2)
                self.assertEqual(modern["worth"], 919)
                self.assertNotIn("appraisal_transition", modern)
                self.assertEqual(check_snapshot(self.path)[1][3], worth)
        with self.at_day(7):
            self.db.x("UPDATE students SET teacher_id=1")
            self.db.x("UPDATE gifts SET listed=943,listed_ts=?,bid_sid=3,bid_amt=943 WHERE id=?", (self.now, legacy))
            self.db.x("INSERT INTO coins(student_id,ts,delta,reason,gift_id) VALUES(3,?,?,'bid',?)",
                      (self.now, -943-server.buy_fee(943), legacy))
            lot = self.db.q("SELECT * FROM gifts WHERE id=?", (legacy,), one=True)
            self.assertEqual(server.auc_deal(self.db, lot, 3, 943, server.time.time(), {"idx": 1}), 48)
            buyer = self.gift_row(3)
            self.assertEqual(buyer["worth"], 919)
            self.assertNotIn("appraisal_transition", buyer)
            self.assertEqual(self.db.q("SELECT delta FROM coins WHERE reason='msell'", one=True)[0], 919)
            self.assertFalse(server.gift_rows(self.db, 1))

    def test_upgrade_migration_reprices_existing_quote_and_keeps_remaining_days(self):
        self.dragon(1, 3895, 4665)
        self.dragon(2, 385, 943)
        first = datetime.fromtimestamp(self.now) - timedelta(days=7)
        for n in (1, 2, 3):
            self.rare_sale(n, 943, first.timestamp())
        self.db.x("INSERT INTO gift_quote_history(day,mkey,price,through_id) VALUES(?,'dragon:rare',1155,3)",
                  (first.date().isoformat(),))
        self.db.x("DELETE FROM settings WHERE key='gift_appraisal_108'")
        self.reopen()
        row = self.gift_row(1)
        self.assertEqual((row["guide"], row["worth"], row["appraisal_transition"]["days"]), (943, 1126, 7))
        self.assertEqual(self.gift_row(2)["worth"], 919)
        with self.at_day(7):
            self.reopen()
            self.assertEqual(self.gift_row(1)["worth"], 919)
            self.assertNotIn("appraisal_transition", self.gift_row(1))

    def test_auction_starts_transition_even_if_owner_first_opens_collection_a_week_later(self):
        legacy = self.dragon(1, 3895, 4665)
        third = self.dragon(2, 385, 943)
        self.db.x("DELETE FROM settings WHERE key='gift_appraisal_108'")
        self.reopen()
        for n in (1, 2):
            self.rare_sale(n, 943)
        self.db.x("UPDATE students SET teacher_id=1")
        self.db.x("UPDATE gifts SET listed=943,listed_ts=?,bid_sid=30,bid_amt=943 WHERE id=?", (self.now, third))
        self.db.x("INSERT INTO coins(student_id,ts,delta,reason,gift_id) VALUES(30,?,-967,'bid',?)", (self.now, third))
        lot = self.db.q("SELECT * FROM gifts WHERE id=?", (third,), one=True)
        self.assertEqual(server.auc_deal(self.db, lot, 30, 943, self.now, {"idx": 1}), 48)
        day = datetime.fromtimestamp(self.now).toordinal()
        saved = self.db.q("SELECT legacy_start,legacy_end FROM gifts WHERE id=?", (legacy,), one=True)
        self.assertEqual(tuple(saved), (day, day + 14))
        with self.at_day(7):
            self.reopen()
            self.assertEqual(self.gift_row(1)["worth"], 2394)

    def test_transition_uses_last_preliminary_mark_and_tracks_new_sales_without_restarting(self):
        self.dragon(1, 3895, 4665)
        self.db.x("DELETE FROM settings WHERE key='gift_appraisal_108'")
        self.reopen()
        for n in (1, 2):
            self.rare_sale(n, 500)
            before = self.gift_row(1)["worth"]
        self.rare_sale(3, 943)
        self.assertEqual(self.gift_row(1)["worth"], before)
        with self.at_day(7):
            for n in (4, 5, 6):
                self.rare_sale(n, 1300, self.now + 7 * 86400)
            row = self.gift_row(1)
            market_net = row["appraisal_transition"]["market_net"]
            self.assertEqual(row["appraisal_transition"]["days"], 7)
            self.assertEqual(row["worth"], market_net + (before - market_net + 1)//2)

    def test_upgrading_after_an_auction_purchase(self):
        paid, fee = 100, server.upgrade_tariff("dragon")
        mv = {"prices": {}, "confirmed": set()}
        for tier, multiplier in server.SELL_UNIQ.items():
            u = {"rar": {"k": tier}}
            self.assertEqual(server.portfolio_estimate("dragon", u, None, mv), 770 + int(fee * multiplier))
            args = ("dragon", u, {"idx": 1}, {}, {}, paid, None, mv, self.now - 100, self.now)
            self.assertEqual(server.gift_sell_price(*args, basis=1000), 90)
            self.assertEqual(server.gift_sell_price(*args, basis=paid+fee, owner_upgrade=fee),
                             (paid + min(fee, int(fee * multiplier))) * 90 // 100)
