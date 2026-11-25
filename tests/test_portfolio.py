"""Регрессии оценки коллекций на небольшом рынке Egeshka."""
import json
from pathlib import Path
import tempfile
import time
import unittest

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
